/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { registerSingleton, InstantiationType } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { IBaseHalfCanvasActionContext } from './basehalfCanvasActionContext.js';

export const BASEHALF_CANVAS_NEW_NOTE_COMMAND_ID = 'basehalf.canvas.newNote';

export type BaseHalfCanvasCreateKind = 'note' | 'file' | 'folder';

export const IBaseHalfCanvasEditingService = createDecorator<IBaseHalfCanvasEditingService>('baseHalfCanvasEditingService');

export type BaseHalfCanvasEditingRequest =
	| { readonly kind: 'rename'; readonly context: IBaseHalfCanvasActionContext }
	| { readonly kind: 'create'; readonly context: IBaseHalfCanvasActionContext | undefined; readonly createKind: BaseHalfCanvasCreateKind }
	| { readonly kind: 'paste'; readonly context: IBaseHalfCanvasActionContext }
	| { readonly kind: 'import'; readonly context: IBaseHalfCanvasActionContext }
	| { readonly kind: 'select'; readonly folder: URI; readonly resources: readonly URI[] };

export type BaseHalfCanvasEditingHandler = (request: BaseHalfCanvasEditingRequest) => Promise<void>;

export type BaseHalfCanvasInlineEditKeyAction = 'accept' | 'cancel';

export function baseHalfCanvasInlineEditKeyAction(event: { readonly key: string; readonly isComposing: boolean; readonly keyCode: number }): BaseHalfCanvasInlineEditKeyAction | undefined {
	if (event.key === 'Enter') {
		return event.isComposing || event.keyCode === 229 ? undefined : 'accept';
	}
	if (event.key === 'Escape') {
		return 'cancel';
	}
	return undefined;
}

export interface IBaseHalfCanvasEditingService {
	readonly _serviceBrand: undefined;
	registerHandler(handler: BaseHalfCanvasEditingHandler): IDisposable;
	requestRename(context: IBaseHalfCanvasActionContext): Promise<void>;
	requestCreate(context: IBaseHalfCanvasActionContext | undefined, createKind: BaseHalfCanvasCreateKind): Promise<void>;
	requestPaste(context: IBaseHalfCanvasActionContext): Promise<void>;
	requestImport(context: IBaseHalfCanvasActionContext): Promise<void>;
	requestSelection(folder: URI, resources: readonly URI[]): Promise<void>;
}

export class BaseHalfCanvasEditingService implements IBaseHalfCanvasEditingService {
	declare readonly _serviceBrand: undefined;

	private handler: BaseHalfCanvasEditingHandler | undefined;

	registerHandler(handler: BaseHalfCanvasEditingHandler): IDisposable {
		if (this.handler) {
			throw new Error('A BaseHalf canvas editing handler is already registered.');
		}
		this.handler = handler;
		return toDisposable(() => {
			if (this.handler === handler) {
				this.handler = undefined;
			}
		});
	}

	requestRename(context: IBaseHalfCanvasActionContext): Promise<void> {
		return this.dispatch({ kind: 'rename', context });
	}

	requestCreate(context: IBaseHalfCanvasActionContext | undefined, createKind: BaseHalfCanvasCreateKind): Promise<void> {
		return this.dispatch({ kind: 'create', context, createKind });
	}

	requestPaste(context: IBaseHalfCanvasActionContext): Promise<void> {
		return this.dispatch({ kind: 'paste', context });
	}

	requestImport(context: IBaseHalfCanvasActionContext): Promise<void> {
		return this.dispatch({ kind: 'import', context });
	}

	requestSelection(folder: URI, resources: readonly URI[]): Promise<void> {
		return this.dispatch({ kind: 'select', folder, resources });
	}

	private dispatch(request: BaseHalfCanvasEditingRequest): Promise<void> {
		if (!this.handler) {
			return Promise.reject(new Error('The BaseHalf canvas editing surface is not available.'));
		}
		return this.handler(request);
	}
}

registerSingleton(IBaseHalfCanvasEditingService, BaseHalfCanvasEditingService, InstantiationType.Delayed);
