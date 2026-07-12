/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { URI } from '../../../base/common/uri.js';
import { ITextEditorSelection } from '../../../platform/editor/common/editor.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { BaseHalfCardDetailProjection } from './basehalfCardDetail.js';

export const IBaseHalfCanvasNavigationService = createDecorator<IBaseHalfCanvasNavigationService>('baseHalfCanvasNavigationService');
export const BaseHalfSurfaceActiveContext = 'basehalf.surfaceActive';
export const BaseHalfCanNavigateBackContext = 'basehalf.canNavigateBack';
export const BaseHalfCanNavigateForwardContext = 'basehalf.canNavigateForward';

export type BaseHalfOpenSource =
	| 'explorer'
	| 'explorerCommand'
	| 'search'
	| 'quickAccess'
	| 'fileCommand'
	| 'editorResolver'
	| 'api';

export interface IBaseHalfNavigationHistoryOptions {
	/**
	 * Location history is distinct from view and identity state. Projection
	 * switches and structural resource reconciliation replace the current entry.
	 */
	readonly history?: 'push' | 'replace';
}

export interface IBaseHalfOpenResourceOptions extends IBaseHalfNavigationHistoryOptions {
	readonly source: BaseHalfOpenSource;
	readonly selection?: ITextEditorSelection;
	readonly preserveFocus?: boolean;
	readonly pinned?: boolean;
	readonly projection?: BaseHalfCardDetailProjection;
}

export interface IBaseHalfWorkspaceResource {
	readonly resource: URI;
	readonly workspaceFolder: URI;
	readonly relativePath: string;
}

export interface IBaseHalfCanvasFolderState extends IBaseHalfWorkspaceResource {
	readonly source: BaseHalfOpenSource;
}

export interface IBaseHalfCardDetailState extends IBaseHalfWorkspaceResource {
	readonly source: BaseHalfOpenSource;
	readonly selection?: ITextEditorSelection;
	readonly preserveFocus?: boolean;
	readonly pinned?: boolean;
	readonly projection: BaseHalfCardDetailProjection;
}

export interface IBaseHalfCanvasNavigationState {
	readonly canvasFolder: IBaseHalfCanvasFolderState | undefined;
	readonly cardDetail: IBaseHalfCardDetailState | undefined;
}

export type BaseHalfNavigationResult =
	| { readonly handled: true; readonly target: 'canvasFolder'; readonly state: IBaseHalfCanvasFolderState }
	| { readonly handled: true; readonly target: 'cardDetail'; readonly state: IBaseHalfCardDetailState }
	| { readonly handled: false; readonly reason: 'outsideWorkspace' | 'missingOrUnreadable' | 'unsupportedResource' | 'blockedByDirtyEditor' };

export interface IBaseHalfCanvasNavigationService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeState: Event<IBaseHalfCanvasNavigationState>;
	readonly onDidChangeSurfaceActive: Event<boolean>;
	readonly state: IBaseHalfCanvasNavigationState;
	readonly isSurfaceActive: boolean;
	readonly canGoBack: boolean;
	readonly canGoForward: boolean;
	setSurfaceActive(active: boolean): void;

	openResource(resource: URI, options: IBaseHalfOpenResourceOptions): Promise<BaseHalfNavigationResult>;
	openFolderCanvas(resource: URI, options: IBaseHalfOpenResourceOptions): Promise<BaseHalfNavigationResult>;
	openCardDetail(resource: URI, options: IBaseHalfOpenResourceOptions): Promise<BaseHalfNavigationResult>;
	closeCardDetail(options?: IBaseHalfNavigationHistoryOptions): Promise<boolean>;
	goBack(): Promise<boolean>;
	goForward(): Promise<boolean>;
}
