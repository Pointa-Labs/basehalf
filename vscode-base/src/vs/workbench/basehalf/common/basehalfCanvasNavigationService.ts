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
import { DEFAULT_BASEHALF_CARD_DETAIL_PROJECTION } from './basehalfCardDetail.js';

export class BaseHalfCanvasNavigationService extends Disposable implements IBaseHalfCanvasNavigationService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeState = this._register(new Emitter<IBaseHalfCanvasNavigationState>());
	readonly onDidChangeState: Event<IBaseHalfCanvasNavigationState> = this._onDidChangeState.event;

	private _state: IBaseHalfCanvasNavigationState = {
		canvasFolder: undefined,
		cardDetail: undefined
	};

	get state(): IBaseHalfCanvasNavigationState {
		return this._state;
	}

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService
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

	openFolderCanvas(resource: URI, options: IBaseHalfOpenResourceOptions): BaseHalfNavigationResult {
		const workspaceResource = this.toWorkspaceResource(resource);
		if (!workspaceResource) {
			return { handled: false, reason: 'outsideWorkspace' };
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

	openCardDetail(resource: URI, options: IBaseHalfOpenResourceOptions): BaseHalfNavigationResult {
		const workspaceResource = this.toWorkspaceResource(resource);
		if (!workspaceResource) {
			return { handled: false, reason: 'outsideWorkspace' };
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
			projection: options.projection ?? DEFAULT_BASEHALF_CARD_DETAIL_PROJECTION
		};
		this.updateState({
			canvasFolder,
			cardDetail
		});
		return { handled: true, target: 'cardDetail', state: cardDetail };
	}

	closeCardDetail(): void {
		if (!this._state.cardDetail) {
			return;
		}

		this.updateState({
			canvasFolder: this._state.canvasFolder,
			cardDetail: undefined
		});
	}

	private updateState(state: IBaseHalfCanvasNavigationState): void {
		this._state = state;
		this._onDidChangeState.fire(state);
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
