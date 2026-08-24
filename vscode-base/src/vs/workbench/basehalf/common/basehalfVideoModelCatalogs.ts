/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import {
	createBaseHalfVideoModelRegistry,
	IBaseHalfVideoModelRegistry,
	IBaseHalfVideoModelSelection,
	parseBaseHalfVideoModelCatalog
} from './basehalfVideoModels.js';

const CONTRIBUTION_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2,}$/;
const EXTENSION_ID_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;

export interface IBaseHalfVideoModelCatalogContribution {
	readonly id: string;
	readonly resource: string;
}

interface IBaseHalfRegisteredVideoModelCatalog {
	readonly id: string;
	readonly extensionId: string;
	readonly registry: IBaseHalfVideoModelRegistry;
}

export const IBaseHalfVideoModelCatalogService = createDecorator<IBaseHalfVideoModelCatalogService>('baseHalfVideoModelCatalogService');

export interface IBaseHalfVideoModelCatalogService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;
	registerCatalog(extensionId: string, contributionId: string, value: unknown): IDisposable;
	/** Host-global aggregate reserved for connection management. */
	getRegistry(): IBaseHalfVideoModelRegistry;
	/** Exact catalog registry, fail-closed when the id is absent or its owner does not match. */
	getRegistry(catalogId: string, expectedExtensionId: string): IBaseHalfVideoModelRegistry;
}

export class BaseHalfVideoModelCatalogService extends Disposable implements IBaseHalfVideoModelCatalogService {
	declare readonly _serviceBrand: undefined;

	private readonly catalogs = new Map<string, IBaseHalfRegisteredVideoModelCatalog>();
	private readonly emptyRegistry = createBaseHalfVideoModelRegistry({ schemaVersion: 1, models: [] });
	private registry = this.emptyRegistry;
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	registerCatalog(extensionId: string, contributionId: string, value: unknown): IDisposable {
		const owner = extensionId.trim().toLowerCase();
		const id = contributionId.trim().toLowerCase();
		if (!EXTENSION_ID_PATTERN.test(owner) || !CONTRIBUTION_ID_PATTERN.test(id) || !id.startsWith(`${owner}.`)) {
			throw new Error(`Video model catalog '${contributionId}' must use its extension id as a prefix.`);
		}
		if (this.catalogs.has(id)) {
			throw new Error(`A video model catalog with id '${id}' is already registered.`);
		}

		const parsed = parseBaseHalfVideoModelCatalog(value);
		const catalog = Object.freeze({ id, extensionId: owner, registry: createBaseHalfVideoModelRegistry(parsed) });
		const previousRegistry = this.registry;
		this.catalogs.set(id, catalog);
		try {
			this.rebuildRegistries();
		} catch (error) {
			this.catalogs.delete(id);
			this.registry = previousRegistry;
			this.rebuildRegistries();
			throw error;
		}
		this._onDidChange.fire();

		return toDisposable(() => {
			if (this.catalogs.get(id) !== catalog) {
				return;
			}
			this.catalogs.delete(id);
			this.rebuildRegistries();
			this._onDidChange.fire();
		});
	}

	getRegistry(): IBaseHalfVideoModelRegistry;
	getRegistry(catalogId: string, expectedExtensionId: string): IBaseHalfVideoModelRegistry;
	getRegistry(catalogId?: string, expectedExtensionId?: string): IBaseHalfVideoModelRegistry {
		if (catalogId === undefined && expectedExtensionId === undefined) {
			return this.registry;
		}
		if (catalogId === undefined || expectedExtensionId === undefined) {
			return this.emptyRegistry;
		}
		const catalog = this.catalogs.get(catalogId.trim().toLowerCase());
		return catalog?.extensionId === expectedExtensionId.trim().toLowerCase()
			? catalog.registry
			: this.emptyRegistry;
	}

	private rebuildRegistries(): void {
		// The global registry exists only to discover connection scopes. Exact
		// execution always resolves the recipe-owned catalog below, so two trusted
		// plugins may legitimately review the same provider/model revision. Keep a
		// deterministic first entry here instead of imposing a false host-global
		// uniqueness constraint on independently owned catalogs.
		const models = new Map<string, IBaseHalfVideoModelRegistry['models'][number]>();
		const owners = new Map<string, IBaseHalfVideoModelRegistry>();
		for (const catalog of this.catalogs.values()) {
			for (const model of catalog.registry.models) {
				const key = videoModelKey([
					model.key.provider,
					model.key.deployment,
					model.key.region,
					model.key.modelId,
					model.key.revision
				]);
				if (!models.has(key)) {
					models.set(key, model);
					owners.set(key, catalog.registry);
				}
			}
		}
		const aggregateModels = Object.freeze([...models.values()]);
		const emptyRegistry = this.emptyRegistry;
		this.registry = Object.freeze({
			models: aggregateModels,
			resolve(selection: IBaseHalfVideoModelSelection) {
				return (owners.get(videoModelKey([
					selection.provider,
					selection.deployment,
					selection.region,
					selection.modelId,
					selection.revision
				])) ?? emptyRegistry).resolve(selection);
			}
		});
	}
}

function videoModelKey(parts: readonly string[]): string {
	return JSON.stringify(parts);
}

registerSingleton(IBaseHalfVideoModelCatalogService, BaseHalfVideoModelCatalogService, InstantiationType.Delayed);
