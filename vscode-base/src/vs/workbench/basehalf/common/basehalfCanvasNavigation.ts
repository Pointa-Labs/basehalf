/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { URI } from '../../../base/common/uri.js';
import { ITextEditorSelection } from '../../../platform/editor/common/editor.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';

export const IBaseHalfCanvasNavigationService = createDecorator<IBaseHalfCanvasNavigationService>('baseHalfCanvasNavigationService');

export type BaseHalfOpenSource =
	| 'explorer'
	| 'explorerCommand'
	| 'search'
	| 'quickAccess'
	| 'fileCommand'
	| 'editorResolver'
	| 'api';

export interface IBaseHalfOpenResourceOptions {
	readonly source: BaseHalfOpenSource;
	readonly selection?: ITextEditorSelection;
	readonly preserveFocus?: boolean;
	readonly pinned?: boolean;
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
}

export interface IBaseHalfCanvasNavigationState {
	readonly canvasFolder: IBaseHalfCanvasFolderState | undefined;
	readonly cardDetail: IBaseHalfCardDetailState | undefined;
}

export type BaseHalfNavigationResult =
	| { readonly handled: true; readonly target: 'canvasFolder'; readonly state: IBaseHalfCanvasFolderState }
	| { readonly handled: true; readonly target: 'cardDetail'; readonly state: IBaseHalfCardDetailState }
	| { readonly handled: false; readonly reason: 'outsideWorkspace' | 'missingOrUnreadable' | 'unsupportedResource' };

export interface IBaseHalfCanvasNavigationService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeState: Event<IBaseHalfCanvasNavigationState>;
	readonly state: IBaseHalfCanvasNavigationState;

	openResource(resource: URI, options: IBaseHalfOpenResourceOptions): Promise<BaseHalfNavigationResult>;
	openFolderCanvas(resource: URI, options: IBaseHalfOpenResourceOptions): BaseHalfNavigationResult;
	openCardDetail(resource: URI, options: IBaseHalfOpenResourceOptions): BaseHalfNavigationResult;
	closeCardDetail(): void;
}
