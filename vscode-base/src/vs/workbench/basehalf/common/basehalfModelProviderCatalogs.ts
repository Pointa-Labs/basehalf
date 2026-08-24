/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../base/common/event.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { Disposable, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import {
	IBaseHalfModelProviderCatalog,
	IBaseHalfRegisteredModelProviderConnectionSpec,
	IBaseHalfResolvedModelProviderConnection,
	parseBaseHalfModelProviderCatalog
} from './basehalfModelProviderCatalogContract.js';

export * from './basehalfModelProviderCatalogContract.js';

const EXTENSION_ID_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;
const CONTRIBUTION_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2,}$/;

export const IBaseHalfModelProviderCatalogService = createDecorator<IBaseHalfModelProviderCatalogService>('baseHalfModelProviderCatalogService');

export interface IBaseHalfModelProviderCatalogService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;
	registerCatalog(extensionId: string, contributionId: string, value: unknown): IDisposable;
	getConnectionSpecs(): readonly IBaseHalfRegisteredModelProviderConnectionSpec[];
	getConnectionSpec(specId: string): IBaseHalfRegisteredModelProviderConnectionSpec | undefined;
	registerConnectionValidator(specId: string, extensionId: string, validator: IBaseHalfModelProviderConnectionValidator): IDisposable;
	validateConnection(specId: string, connection: IBaseHalfResolvedModelProviderConnection, token: CancellationToken): Promise<void>;
}

export interface IBaseHalfModelProviderConnectionValidator {
	validate(connection: IBaseHalfResolvedModelProviderConnection, token: CancellationToken): Promise<void>;
}

interface IBaseHalfRegisteredModelProviderConnectionValidator {
	readonly extensionId: string;
	readonly validator: IBaseHalfModelProviderConnectionValidator;
}

interface IBaseHalfRegisteredModelProviderCatalog {
	readonly id: string;
	readonly extensionId: string;
	readonly catalog: IBaseHalfModelProviderCatalog;
}

export class BaseHalfModelProviderCatalogService extends Disposable implements IBaseHalfModelProviderCatalogService {
	declare readonly _serviceBrand: undefined;

	private readonly catalogs = new Map<string, IBaseHalfRegisteredModelProviderCatalog>();
	private connectionSpecs: readonly IBaseHalfRegisteredModelProviderConnectionSpec[] = Object.freeze([]);
	private connectionSpecById = new Map<string, IBaseHalfRegisteredModelProviderConnectionSpec>();
	private readonly validators = new Map<string, IBaseHalfRegisteredModelProviderConnectionValidator>();
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	registerCatalog(extensionId: string, contributionId: string, value: unknown): IDisposable {
		const owner = extensionId.trim().toLowerCase();
		const id = contributionId.trim().toLowerCase();
		if (!EXTENSION_ID_PATTERN.test(owner) || !CONTRIBUTION_ID_PATTERN.test(id) || !id.startsWith(`${owner}.`)) {
			throw new Error(`Model provider catalog '${contributionId}' must use its extension id as a prefix.`);
		}
		if (this.catalogs.has(id)) {
			throw new Error(`A model provider catalog with id '${id}' is already registered.`);
		}

		const parsed = parseBaseHalfModelProviderCatalog(value);
		for (const spec of parsed.connections) {
			if (!spec.id.startsWith(`${owner}.`)) {
				throw new Error(`Model provider connection '${spec.id}' must use its extension id as a prefix.`);
			}
		}
		const catalog = Object.freeze({ id, extensionId: owner, catalog: parsed });
		this.catalogs.set(id, catalog);
		try {
			this.rebuildConnectionSpecs();
		} catch (error) {
			this.catalogs.delete(id);
			this.rebuildConnectionSpecs();
			throw error;
		}
		this._onDidChange.fire();

		return toDisposable(() => {
			if (this.catalogs.get(id) !== catalog) {
				return;
			}
			this.catalogs.delete(id);
			this.rebuildConnectionSpecs();
			this._onDidChange.fire();
		});
	}

	getConnectionSpecs(): readonly IBaseHalfRegisteredModelProviderConnectionSpec[] {
		return this.connectionSpecs;
	}

	getConnectionSpec(specId: string): IBaseHalfRegisteredModelProviderConnectionSpec | undefined {
		return this.connectionSpecById.get(specId.trim().toLowerCase());
	}

	registerConnectionValidator(specId: string, extensionId: string, validator: IBaseHalfModelProviderConnectionValidator): IDisposable {
		const id = specId.trim().toLowerCase();
		const owner = extensionId.trim().toLowerCase();
		const spec = this.connectionSpecById.get(id);
		if (!spec || spec.extensionId !== owner) {
			throw new Error(`Model provider connection '${id}' is not declared by extension '${owner}'.`);
		}
		if (this.validators.has(id)) {
			throw new Error(`A validator for model provider connection '${id}' is already registered.`);
		}
		const entry = { extensionId: owner, validator };
		this.validators.set(id, entry);
		return toDisposable(() => {
			if (this.validators.get(id) === entry) {
				this.validators.delete(id);
			}
		});
	}

	async validateConnection(specId: string, connection: IBaseHalfResolvedModelProviderConnection, token: CancellationToken): Promise<void> {
		const id = specId.trim().toLowerCase();
		const spec = this.connectionSpecById.get(id);
		const entry = this.validators.get(id);
		if (!spec || !entry || entry.extensionId !== spec.extensionId) {
			throw new Error(`No validator is registered for model provider connection '${id}'.`);
		}
		if (connection.specId !== id) {
			throw new Error(`Model provider connection validation does not match '${id}'.`);
		}
		await entry.validator.validate(connection, token);
	}

	private rebuildConnectionSpecs(): void {
		const next = new Map<string, IBaseHalfRegisteredModelProviderConnectionSpec>();
		for (const catalog of [...this.catalogs.values()].sort((left, right) => left.id.localeCompare(right.id))) {
			for (const spec of catalog.catalog.connections) {
				if (next.has(spec.id)) {
					throw new Error(`A model provider connection with id '${spec.id}' is already registered.`);
				}
				next.set(spec.id, deepFreeze({ ...spec, extensionId: catalog.extensionId, catalogId: catalog.id }));
			}
		}
		const connectionSpecs = [...next.values()].sort((left, right) =>
			left.providerLabel.localeCompare(right.providerLabel)
			|| left.label.localeCompare(right.label)
			|| left.id.localeCompare(right.id));
		this.connectionSpecs = Object.freeze(connectionSpecs);
		this.connectionSpecById = new Map(connectionSpecs.map(spec => [spec.id, spec]));
		for (const [id, entry] of this.validators) {
			if (this.connectionSpecById.get(id)?.extensionId !== entry.extensionId) {
				this.validators.delete(id);
			}
		}
	}
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const child of Object.values(value as Record<string, unknown>)) {
			deepFreeze(child);
		}
		Object.freeze(value);
	}
	return value;
}

registerSingleton(IBaseHalfModelProviderCatalogService, BaseHalfModelProviderCatalogService, InstantiationType.Delayed);
