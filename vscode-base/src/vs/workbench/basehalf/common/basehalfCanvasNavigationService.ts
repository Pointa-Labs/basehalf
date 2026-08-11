/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { INotificationService, Severity } from '../../../platform/notification/common/notification.js';
import { IUriIdentityService } from '../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspaceContextService, IWorkspaceFolder } from '../../../platform/workspace/common/workspace.js';
import {
	BaseHalfNavigationResult,
	IBaseHalfCanvasFolderState,
	IBaseHalfCanvasNavigationService,
	IBaseHalfCanvasNavigationState,
	IBaseHalfActiveCanvasEditor,
	IBaseHalfCardDetailState,
	IBaseHalfCloseCardDetailOptions,
	IBaseHalfOpenResourceOptions
} from './basehalfCanvasNavigation.js';
import { IBaseHalfCardProjectionRegistryService } from './basehalfCardDetail.js';
import { BASEHALF_CARD_DETAIL_PANE_ID, IBaseHalfEditorFlushService } from './basehalfEditorFlush.js';

export class BaseHalfCanvasNavigationService extends Disposable implements IBaseHalfCanvasNavigationService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeState = this._register(new Emitter<IBaseHalfCanvasNavigationState>());
	readonly onDidChangeState: Event<IBaseHalfCanvasNavigationState> = this._onDidChangeState.event;
	private readonly _onDidChangeSurfaceActive = this._register(new Emitter<boolean>());
	readonly onDidChangeSurfaceActive: Event<boolean> = this._onDidChangeSurfaceActive.event;
	private readonly backStack: IBaseHalfCanvasNavigationState[] = [];
	private readonly forwardStack: IBaseHalfCanvasNavigationState[] = [];
	private _isSurfaceActive = false;
	private _activeCanvasEditor: IBaseHalfActiveCanvasEditor | undefined;

	private _state: IBaseHalfCanvasNavigationState;
	private stateVersion = 0;

	get state(): IBaseHalfCanvasNavigationState {
		return this._state;
	}

	get activeCanvasEditor(): IBaseHalfActiveCanvasEditor | undefined {
		return this._activeCanvasEditor;
	}

	get isSurfaceActive(): boolean {
		return this._isSurfaceActive;
	}

	get canGoBack(): boolean {
		return this.backStack.length > 0;
	}

	get canGoForward(): boolean {
		return this.forwardStack.length > 0;
	}

	isResourceOpen(resource: URI): boolean {
		return (!!this._activeCanvasEditor
			&& this.uriIdentityService.extUri.isEqual(this._activeCanvasEditor.resource, resource))
			|| (!!this._state.cardDetail
				&& this.uriIdentityService.extUri.isEqual(this._state.cardDetail.resource, resource));
	}

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IBaseHalfEditorFlushService private readonly editorFlushService: IBaseHalfEditorFlushService,
		@IBaseHalfCardProjectionRegistryService private readonly cardProjectionRegistryService: IBaseHalfCardProjectionRegistryService,
		@INotificationService private readonly notificationService: INotificationService
	) {
		super();
		this._state = this.initialVisibleCanvasState() ?? {
			canvasFolder: undefined,
			cardDetail: undefined
		};
	}

	setSurfaceActive(active: boolean): void {
		if (this._isSurfaceActive === active) {
			return;
		}
		this._isSurfaceActive = active;
		this._onDidChangeSurfaceActive.fire(active);
	}

	setActiveCanvasEditor(editor: IBaseHalfActiveCanvasEditor | undefined): void {
		this._activeCanvasEditor = editor;
	}

	async openResource(resource: URI, options: IBaseHalfOpenResourceOptions): Promise<BaseHalfNavigationResult> {
		const workspaceResource = this.toWorkspaceResource(resource);
		if (!workspaceResource) {
			return { handled: false, reason: 'outsideWorkspace' };
		}
		const acceptedCanvasEditor = this._activeCanvasEditor;

		let stat;
		try {
			stat = await this.fileService.resolve(resource);
		} catch {
			return { handled: false, reason: 'missingOrUnreadable' };
		}
		if (acceptedCanvasEditor && !await this.flushActiveEditor(acceptedCanvasEditor)) {
			return { handled: false, reason: 'blockedByDirtyEditor' };
		}

		if (stat.isDirectory) {
			return this.openFolderCanvas(resource, options);
		}

		if (stat.isFile) {
			return this.openCardDetail(resource, options);
		}

		return { handled: false, reason: 'unsupportedResource' };
	}

	async openFolderCanvas(resource: URI, options: IBaseHalfOpenResourceOptions): Promise<BaseHalfNavigationResult> {
		const workspaceResource = this.toWorkspaceResource(resource);
		if (!workspaceResource) {
			return { handled: false, reason: 'outsideWorkspace' };
		}
		if ((this._activeCanvasEditor || this._state.cardDetail) && !await this.flushActiveEditor()) {
			return { handled: false, reason: 'blockedByDirtyEditor' };
		}

		const canvasFolder: IBaseHalfCanvasFolderState = {
			...workspaceResource,
			source: options.source
		};
		this.updateState({
			canvasFolder,
			cardDetail: undefined
		}, {
			recordHistory: options.history !== 'replace',
			collapseHistoryBoundary: options.history === 'replace'
		});
		return { handled: true, target: 'canvasFolder', state: canvasFolder };
	}

	async openCardDetail(resource: URI, options: IBaseHalfOpenResourceOptions): Promise<BaseHalfNavigationResult> {
		const workspaceResource = this.toWorkspaceResource(resource);
		if (!workspaceResource) {
			return { handled: false, reason: 'outsideWorkspace' };
		}
		const acceptedCardDetail = this._state.cardDetail;
		const acceptedVersion = this.stateVersion;
		if (options.expectedCardDetail && acceptedCardDetail !== options.expectedCardDetail) {
			return { handled: false, reason: 'superseded' };
		}
		const adoptsCanvasProjection = options.canvasProjectionHandoff === true
			&& !this._state.cardDetail
			&& !!this._activeCanvasEditor
			&& this._activeCanvasEditor.supportsCanvasProjectionHandoff !== false
			&& this.uriIdentityService.extUri.isEqual(this._activeCanvasEditor.resource, resource);
		if (!adoptsCanvasProjection
			&& (this._activeCanvasEditor || this._state.cardDetail)
			&& !await this.flushActiveEditor()) {
			return { handled: false, reason: 'blockedByDirtyEditor' };
		}
		if (options.expectedCardDetail
			&& (this.stateVersion !== acceptedVersion || this._state.cardDetail !== acceptedCardDetail)) {
			return { handled: false, reason: 'superseded' };
		}

		const canvasFolder = this.toParentCanvasFolder(resource, options);
		if (!canvasFolder) {
			return { handled: false, reason: 'outsideWorkspace' };
		}

		const cardDetail: IBaseHalfCardDetailState = {
			...workspaceResource,
			source: options.source,
			selection: options.selection,
			preserveFocus: options.preserveFocus,
			pinned: options.pinned,
			projection: this.cardProjectionRegistryService.normalizeProjection(resource, options.projection)
		};
		this.updateState({
			canvasFolder,
			cardDetail
		}, {
			recordHistory: options.history !== 'replace',
			collapseHistoryBoundary: options.history === 'replace'
		});
		return { handled: true, target: 'cardDetail', state: cardDetail };
	}

	async closeCardDetail(options: IBaseHalfCloseCardDetailOptions = {}): Promise<boolean> {
		const accepted = this._state.cardDetail;
		const acceptedVersion = this.stateVersion;
		if (!accepted) {
			return options.expectedCardDetail === undefined;
		}
		if (options.expectedCardDetail && accepted !== options.expectedCardDetail) {
			return false;
		}
		if (!await this.flushActiveEditor()) {
			return false;
		}
		if (this.stateVersion !== acceptedVersion || this._state.cardDetail !== accepted) {
			return false;
		}

		this.updateState({
			canvasFolder: this._state.canvasFolder,
			cardDetail: undefined
		}, {
			recordHistory: options.history !== 'replace',
			collapseHistoryBoundary: options.history === 'replace'
		});
		return true;
	}

	async goBack(): Promise<boolean> {
		const previous = this.backStack.pop();
		if (!previous) {
			return false;
		}
		if (!await this.flushActiveEditor()) {
			this.backStack.push(previous);
			return false;
		}

		this.forwardStack.push(this._state);
		this.updateState(previous, { recordHistory: false });
		return true;
	}

	async goForward(): Promise<boolean> {
		const next = this.forwardStack.pop();
		if (!next) {
			return false;
		}
		if (!await this.flushActiveEditor()) {
			this.forwardStack.push(next);
			return false;
		}

		this.backStack.push(this._state);
		this.updateState(next, { recordHistory: false });
		return true;
	}

	async flushActiveEditor(acceptedCanvasEditor?: IBaseHalfActiveCanvasEditor): Promise<boolean> {
		if (acceptedCanvasEditor && this._activeCanvasEditor !== acceptedCanvasEditor) {
			const prepared = await acceptedCanvasEditor.prepareToClose();
			if (!prepared) {
				this.notifyBlockedEditor();
				return false;
			}
		}
		while (this._activeCanvasEditor) {
			const inlineEditor = this._activeCanvasEditor;
			const prepared = await inlineEditor.prepareToClose();
			if (!prepared || this._activeCanvasEditor === inlineEditor) {
				this.notifyBlockedEditor();
				return false;
			}
		}
		const flushed = this._state.cardDetail
			? await this.editorFlushService.flushPane(BASEHALF_CARD_DETAIL_PANE_ID)
			: true;
		if (!flushed) {
			this.notifyBlockedEditor();
		}
		return flushed;
	}

	private notifyBlockedEditor(): void {
		// Identical notifications coalesce, so repeated attempts do not stack.
		this.notificationService.notify({
			severity: Severity.Warning,
			message: 'The active editor has changes that could not be saved to disk, so it stays open. Resolve the conflict shown in the editor, or save manually, then navigate again.'
		});
	}

	private updateState(
		state: IBaseHalfCanvasNavigationState,
		options: { readonly recordHistory: boolean; readonly collapseHistoryBoundary?: boolean } = { recordHistory: true }
	): void {
		this.stateVersion++;
		if (this.statesEqual(this._state, state)) {
			this._state = state;
			if (options.collapseHistoryBoundary) {
				this.collapseHistoryBoundary();
			}
			this._onDidChangeState.fire(state);
			return;
		}
		const previousState = this.isNavigableState(this._state) ? this._state : this.initialVisibleCanvasState();
		if (options.recordHistory && previousState && !this.statesEqual(previousState, state)) {
			this.pushDistinct(this.backStack, previousState);
			this.forwardStack.length = 0;
		}
		this._state = state;
		if (options.collapseHistoryBoundary) {
			this.collapseHistoryBoundary();
		}
		this._onDidChangeState.fire(state);
	}

	private pushDistinct(stack: IBaseHalfCanvasNavigationState[], state: IBaseHalfCanvasNavigationState): void {
		const last = stack[stack.length - 1];
		if (last && this.statesEqual(last, state)) {
			return;
		}
		stack.push(state);
	}

	private collapseHistoryBoundary(): void {
		while (this.backStack.length > 0 && this.statesEqual(this.backStack[this.backStack.length - 1], this._state)) {
			this.backStack.pop();
		}
		while (this.forwardStack.length > 0 && this.statesEqual(this.forwardStack[this.forwardStack.length - 1], this._state)) {
			this.forwardStack.pop();
		}
	}

	private isNavigableState(state: IBaseHalfCanvasNavigationState): boolean {
		return !!state.canvasFolder || !!state.cardDetail;
	}

	private initialVisibleCanvasState(): IBaseHalfCanvasNavigationState | undefined {
		const folder = this.workspaceContextService.getWorkspace().folders[0];
		if (!folder) {
			return undefined;
		}

		return {
			canvasFolder: {
				resource: folder.uri,
				workspaceFolder: folder.uri,
				relativePath: '',
				source: 'api'
			},
			cardDetail: undefined
		};
	}

	private statesEqual(left: IBaseHalfCanvasNavigationState, right: IBaseHalfCanvasNavigationState): boolean {
		return this.canvasFolderStatesEqual(left.canvasFolder, right.canvasFolder)
			&& this.cardDetailStatesEqual(left.cardDetail, right.cardDetail);
	}

	private canvasFolderStatesEqual(left: IBaseHalfCanvasFolderState | undefined, right: IBaseHalfCanvasFolderState | undefined): boolean {
		if (!left || !right) {
			return left === right;
		}
		return this.uriIdentityService.extUri.isEqual(left.resource, right.resource)
			&& this.uriIdentityService.extUri.isEqual(left.workspaceFolder, right.workspaceFolder)
			&& left.relativePath === right.relativePath;
	}

	private cardDetailStatesEqual(left: IBaseHalfCardDetailState | undefined, right: IBaseHalfCardDetailState | undefined): boolean {
		if (!left || !right) {
			return left === right;
		}
		return this.uriIdentityService.extUri.isEqual(left.resource, right.resource)
			&& this.uriIdentityService.extUri.isEqual(left.workspaceFolder, right.workspaceFolder)
			&& left.relativePath === right.relativePath;
	}

	private toWorkspaceResource(resource: URI): { resource: URI; workspaceFolder: URI; relativePath: string } | undefined {
		let folder: IWorkspaceFolder | undefined;
		let relativePath: string | undefined;
		for (const candidate of this.workspaceContextService.getWorkspace().folders) {
			if (!this.uriIdentityService.extUri.isEqualOrParent(resource, candidate.uri)) {
				continue;
			}

			const candidateRelativePath = this.uriIdentityService.extUri.relativePath(candidate.uri, resource) ?? '';
			if (relativePath === undefined || candidateRelativePath.length < relativePath.length) {
				folder = candidate;
				relativePath = candidateRelativePath;
			}
		}

		if (!folder) {
			return undefined;
		}

		return {
			resource,
			workspaceFolder: folder.uri,
			relativePath: relativePath ?? ''
		};
	}

	private toParentCanvasFolder(resource: URI, options: IBaseHalfOpenResourceOptions): IBaseHalfCanvasFolderState | undefined {
		const workspaceResource = this.toWorkspaceResource(resource);
		if (!workspaceResource) {
			return undefined;
		}

		const parent = this.uriIdentityService.extUri.dirname(resource);
		const parentWorkspaceResource = this.toWorkspaceResource(parent);
		if (!parentWorkspaceResource) {
			return undefined;
		}

		return {
			...parentWorkspaceResource,
			source: options.source
		};
	}
}

registerSingleton(IBaseHalfCanvasNavigationService, BaseHalfCanvasNavigationService, InstantiationType.Delayed);
