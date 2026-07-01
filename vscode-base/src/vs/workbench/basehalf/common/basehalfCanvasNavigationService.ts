/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { IUriIdentityService } from '../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspaceContextService, IWorkspaceFolder } from '../../../platform/workspace/common/workspace.js';
import {
	BaseHalfNavigationResult,
	IBaseHalfCanvasFolderState,
	IBaseHalfCanvasNavigationService,
	IBaseHalfCanvasNavigationState,
	IBaseHalfCardDetailState,
	IBaseHalfOpenResourceOptions
} from './basehalfCanvasNavigation.js';
import { normalizeBaseHalfCardDetailProjection } from './basehalfCardDetail.js';
import { BASEHALF_CARD_DETAIL_PANE_ID, IBaseHalfEditorFlushService } from './basehalfEditorFlush.js';

export class BaseHalfCanvasNavigationService extends Disposable implements IBaseHalfCanvasNavigationService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeState = this._register(new Emitter<IBaseHalfCanvasNavigationState>());
	readonly onDidChangeState: Event<IBaseHalfCanvasNavigationState> = this._onDidChangeState.event;
	private readonly backStack: IBaseHalfCanvasNavigationState[] = [];
	private readonly forwardStack: IBaseHalfCanvasNavigationState[] = [];

	private _state: IBaseHalfCanvasNavigationState = {
		canvasFolder: undefined,
		cardDetail: undefined
	};

	get state(): IBaseHalfCanvasNavigationState {
		return this._state;
	}

	get canGoBack(): boolean {
		return this.backStack.length > 0;
	}

	get canGoForward(): boolean {
		return this.forwardStack.length > 0;
	}

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IBaseHalfEditorFlushService private readonly editorFlushService: IBaseHalfEditorFlushService
	) {
		super();
	}

	async openResource(resource: URI, options: IBaseHalfOpenResourceOptions): Promise<BaseHalfNavigationResult> {
		const workspaceResource = this.toWorkspaceResource(resource);
		if (!workspaceResource) {
			return { handled: false, reason: 'outsideWorkspace' };
		}

		let stat;
		try {
			stat = await this.fileService.resolve(resource);
		} catch {
			return { handled: false, reason: 'missingOrUnreadable' };
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
		if (!await this.flushActiveCardDetail()) {
			return { handled: false, reason: 'blockedByDirtyEditor' };
		}

		const canvasFolder: IBaseHalfCanvasFolderState = {
			...workspaceResource,
			source: options.source
		};
		this.updateState({
			canvasFolder,
			cardDetail: undefined
		});
		return { handled: true, target: 'canvasFolder', state: canvasFolder };
	}

	async openCardDetail(resource: URI, options: IBaseHalfOpenResourceOptions): Promise<BaseHalfNavigationResult> {
		const workspaceResource = this.toWorkspaceResource(resource);
		if (!workspaceResource) {
			return { handled: false, reason: 'outsideWorkspace' };
		}
		if (!await this.flushActiveCardDetail()) {
			return { handled: false, reason: 'blockedByDirtyEditor' };
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
			projection: normalizeBaseHalfCardDetailProjection(resource, options.projection)
		};
		this.updateState({
			canvasFolder,
			cardDetail
		});
		return { handled: true, target: 'cardDetail', state: cardDetail };
	}

	async closeCardDetail(): Promise<boolean> {
		if (!this._state.cardDetail) {
			return true;
		}
		if (!await this.flushActiveCardDetail()) {
			return false;
		}

		this.updateState({
			canvasFolder: this._state.canvasFolder,
			cardDetail: undefined
		});
		return true;
	}

	async goBack(): Promise<boolean> {
		const previous = this.backStack.pop();
		if (!previous) {
			return false;
		}
		if (!await this.flushActiveCardDetail()) {
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
		if (!await this.flushActiveCardDetail()) {
			this.forwardStack.push(next);
			return false;
		}

		this.backStack.push(this._state);
		this.updateState(next, { recordHistory: false });
		return true;
	}

	private async flushActiveCardDetail(): Promise<boolean> {
		if (!this._state.cardDetail) {
			return true;
		}
		return this.editorFlushService.flushPane(BASEHALF_CARD_DETAIL_PANE_ID);
	}

	private updateState(state: IBaseHalfCanvasNavigationState, options: { readonly recordHistory: boolean } = { recordHistory: true }): void {
		if (this.statesEqual(this._state, state)) {
			this._state = state;
			this._onDidChangeState.fire(state);
			return;
		}
		if (options.recordHistory && this.isNavigableState(this._state)) {
			this.pushDistinct(this.backStack, this._state);
			this.forwardStack.length = 0;
		}
		this._state = state;
		this._onDidChangeState.fire(state);
	}

	private pushDistinct(stack: IBaseHalfCanvasNavigationState[], state: IBaseHalfCanvasNavigationState): void {
		const last = stack[stack.length - 1];
		if (last && this.statesEqual(last, state)) {
			return;
		}
		stack.push(state);
	}

	private isNavigableState(state: IBaseHalfCanvasNavigationState): boolean {
		return !!state.canvasFolder || !!state.cardDetail;
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
			&& left.relativePath === right.relativePath
			&& left.projection === right.projection
			&& this.selectionsEqual(left.selection, right.selection);
	}

	private selectionsEqual(left: IBaseHalfCardDetailState['selection'], right: IBaseHalfCardDetailState['selection']): boolean {
		if (!left || !right) {
			return left === right;
		}
		return left.startLineNumber === right.startLineNumber
			&& left.startColumn === right.startColumn
			&& left.endLineNumber === right.endLineNumber
			&& left.endColumn === right.endColumn;
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
