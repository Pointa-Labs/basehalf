/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ITextEditorSelection } from '../../../../platform/editor/common/editor.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IBaseHalfCardDetailState } from '../../common/basehalfCanvasNavigation.js';
import { BaseHalfCardDetailProjection } from '../../common/basehalfCardDetail.js';

/**
 * Lifecycle contract for a projection hosted in BaseHalf's center surface.
 * Providers own only the body; Card Detail chrome and navigation remain core.
 */
export interface IBaseHalfCardDetailSurfaceInstance extends IDisposable {
	open(state: IBaseHalfCardDetailState): Promise<void>;
	activate(state: IBaseHalfCardDetailState): void;
	applySelection(selection: ITextEditorSelection | undefined): void;
	setVisible(visible: boolean): void;
	focus?(): void;
	setStructuralFrozen?(frozen: boolean): void;
}

export interface IBaseHalfCardDetailSurfaceProvider {
	create(parent: HTMLElement, state: IBaseHalfCardDetailState): IBaseHalfCardDetailSurface;
}

export interface IBaseHalfCardDetailSurface {
	readonly host: HTMLElement;
	readonly instance: IBaseHalfCardDetailSurfaceInstance;
}

export const IBaseHalfCardDetailSurfaceRegistryService = createDecorator<IBaseHalfCardDetailSurfaceRegistryService>('baseHalfCardDetailSurfaceRegistryService');

export interface IBaseHalfCardDetailSurfaceRegistryService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeProviders: Event<BaseHalfCardDetailProjection>;

	registerProvider(projection: BaseHalfCardDetailProjection, provider: IBaseHalfCardDetailSurfaceProvider): IDisposable;
	hasProvider(projection: BaseHalfCardDetailProjection): boolean;
	create(projection: BaseHalfCardDetailProjection, parent: HTMLElement, state: IBaseHalfCardDetailState): IBaseHalfCardDetailSurface;
}

export class BaseHalfCardDetailSurfaceRegistryService extends Disposable implements IBaseHalfCardDetailSurfaceRegistryService {
	declare readonly _serviceBrand: undefined;

	private readonly providers = new Map<BaseHalfCardDetailProjection, IBaseHalfCardDetailSurfaceProvider>();
	private readonly _onDidChangeProviders = this._register(new Emitter<BaseHalfCardDetailProjection>());
	readonly onDidChangeProviders = this._onDidChangeProviders.event;

	registerProvider(projection: BaseHalfCardDetailProjection, provider: IBaseHalfCardDetailSurfaceProvider): IDisposable {
		if (this.providers.has(projection)) {
			throw new Error(`A BaseHalf card detail surface provider for '${projection}' is already registered.`);
		}
		this.providers.set(projection, provider);
		this._onDidChangeProviders.fire(projection);
		return toDisposable(() => {
			if (this.providers.get(projection) === provider) {
				this.providers.delete(projection);
				this._onDidChangeProviders.fire(projection);
			}
		});
	}

	hasProvider(projection: BaseHalfCardDetailProjection): boolean {
		return this.providers.has(projection);
	}

	create(projection: BaseHalfCardDetailProjection, parent: HTMLElement, state: IBaseHalfCardDetailState): IBaseHalfCardDetailSurface {
		const provider = this.providers.get(projection);
		if (!provider) {
			throw new Error(`No BaseHalf card detail surface provider is registered for '${projection}'.`);
		}
		return provider.create(parent, state);
	}
}

registerSingleton(IBaseHalfCardDetailSurfaceRegistryService, BaseHalfCardDetailSurfaceRegistryService, InstantiationType.Delayed);
