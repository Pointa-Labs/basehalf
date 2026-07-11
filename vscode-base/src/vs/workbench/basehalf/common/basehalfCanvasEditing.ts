/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { IBaseHalfCanvasActionContext } from './basehalfCanvasActionContext.js';

export const IBaseHalfCanvasEditingService = createDecorator<IBaseHalfCanvasEditingService>('baseHalfCanvasEditingService');

export type BaseHalfCanvasEditingRequest =
	| { readonly kind: 'rename'; readonly context: IBaseHalfCanvasActionContext }
	| { readonly kind: 'create'; readonly context: IBaseHalfCanvasActionContext; readonly folder: boolean };

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
	readonly onDidRequestEdit: Event<BaseHalfCanvasEditingRequest>;
	requestRename(context: IBaseHalfCanvasActionContext): void;
	requestCreate(context: IBaseHalfCanvasActionContext, folder: boolean): void;
}

class BaseHalfCanvasEditingService extends Disposable implements IBaseHalfCanvasEditingService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidRequestEdit = this._register(new Emitter<BaseHalfCanvasEditingRequest>());
	readonly onDidRequestEdit = this._onDidRequestEdit.event;

	requestRename(context: IBaseHalfCanvasActionContext): void {
		this._onDidRequestEdit.fire({ kind: 'rename', context });
	}

	requestCreate(context: IBaseHalfCanvasActionContext, folder: boolean): void {
		this._onDidRequestEdit.fire({ kind: 'create', context, folder });
	}
}

registerSingleton(IBaseHalfCanvasEditingService, BaseHalfCanvasEditingService, InstantiationType.Delayed);
