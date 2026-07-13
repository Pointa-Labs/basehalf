/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { extname } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { BASEHALF_RENDERABLE_CONTENT_EXTENSIONS, isBaseHalfRenderableContentResource } from './basehalfContentRendering.js';

/**
 * Stable projection identifier persisted in navigation/focus state. Built-in
 * identifiers are ordinary strings so a domain plugin can add a projection
 * without widening a product-core union type.
 */
export type BaseHalfCardDetailProjection = string;

export const DEFAULT_BASEHALF_CARD_DETAIL_PROJECTION: BaseHalfCardDetailProjection = 'source';

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);

export interface IBaseHalfCardProjectionSelector {
	/** Lower-case extensions including the leading dot. Omit to match every file. */
	readonly extensions?: readonly string[];
}

/** Product chrome owned by BaseHalf for one center-area projection. */
export interface IBaseHalfCardProjectionDescriptor {
	readonly id: BaseHalfCardDetailProjection;
	readonly label: string;
	readonly icon: string;
	readonly selector?: IBaseHalfCardProjectionSelector;
	/** Higher values appear first in the projection switcher. */
	readonly order: number;
	/** Higher values win when a resource is opened without an explicit projection. */
	readonly defaultPriority?: number;
}

export const BASEHALF_BUILTIN_CARD_PROJECTIONS: readonly IBaseHalfCardProjectionDescriptor[] = [
	{
		id: 'rich',
		label: 'Rich',
		icon: 'codicon-edit',
		selector: { extensions: ['.md', '.markdown'] },
		order: 300,
		defaultPriority: 200
	},
	{
		id: 'preview',
		label: 'Preview',
		icon: 'codicon-preview',
		selector: { extensions: ['.md', '.markdown'] },
		order: 200
	},
	{
		id: 'media',
		label: 'View',
		icon: 'codicon-file-media',
		selector: { extensions: BASEHALF_RENDERABLE_CONTENT_EXTENSIONS },
		order: 300,
		defaultPriority: 200
	},
	{
		id: DEFAULT_BASEHALF_CARD_DETAIL_PROJECTION,
		label: 'Source',
		icon: 'codicon-code',
		order: 100,
		defaultPriority: 0
	}
];

export const IBaseHalfCardProjectionRegistryService = createDecorator<IBaseHalfCardProjectionRegistryService>('baseHalfCardProjectionRegistryService');

export interface IBaseHalfCardProjectionRegistryService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeProjections: Event<void>;

	registerProjection(descriptor: IBaseHalfCardProjectionDescriptor): IDisposable;
	getProjection(id: BaseHalfCardDetailProjection): IBaseHalfCardProjectionDescriptor | undefined;
	getProjections(resource: URI): readonly IBaseHalfCardProjectionDescriptor[];
	defaultProjection(resource: URI): BaseHalfCardDetailProjection;
	normalizeProjection(resource: URI, projection: BaseHalfCardDetailProjection | undefined): BaseHalfCardDetailProjection;
}

export class BaseHalfCardProjectionRegistryService extends Disposable implements IBaseHalfCardProjectionRegistryService {
	declare readonly _serviceBrand: undefined;

	private readonly projections = new Map<BaseHalfCardDetailProjection, IBaseHalfCardProjectionDescriptor>();
	private readonly _onDidChangeProjections = this._register(new Emitter<void>());
	readonly onDidChangeProjections = this._onDidChangeProjections.event;

	constructor() {
		super();
		for (const descriptor of BASEHALF_BUILTIN_CARD_PROJECTIONS) {
			this.addProjection(descriptor);
		}
	}

	registerProjection(descriptor: IBaseHalfCardProjectionDescriptor): IDisposable {
		this.validateDescriptor(descriptor);
		if (this.projections.has(descriptor.id)) {
			throw new Error(`A BaseHalf card projection with id '${descriptor.id}' is already registered.`);
		}

		const normalized = this.addProjection(descriptor);
		this._onDidChangeProjections.fire();
		return toDisposable(() => {
			if (this.projections.get(normalized.id) === normalized) {
				this.projections.delete(normalized.id);
				this._onDidChangeProjections.fire();
			}
		});
	}

	getProjection(id: BaseHalfCardDetailProjection): IBaseHalfCardProjectionDescriptor | undefined {
		return this.projections.get(id);
	}

	getProjections(resource: URI): readonly IBaseHalfCardProjectionDescriptor[] {
		return baseHalfCardProjectionsFor(resource, this.projections.values());
	}

	defaultProjection(resource: URI): BaseHalfCardDetailProjection {
		return defaultBaseHalfCardProjectionFrom(resource, this.projections.values());
	}

	normalizeProjection(resource: URI, projection: BaseHalfCardDetailProjection | undefined): BaseHalfCardDetailProjection {
		if (projection) {
			const descriptor = this.projections.get(projection);
			if (descriptor && baseHalfCardProjectionMatches(resource, descriptor)) {
				return projection;
			}
		}
		return this.defaultProjection(resource);
	}

	private addProjection(descriptor: IBaseHalfCardProjectionDescriptor): IBaseHalfCardProjectionDescriptor {
		this.validateDescriptor(descriptor);
		const normalized: IBaseHalfCardProjectionDescriptor = {
			...descriptor,
			selector: descriptor.selector?.extensions
				? { extensions: descriptor.selector.extensions.map(extension => extension.toLowerCase()) }
				: descriptor.selector
		};
		this.projections.set(normalized.id, normalized);
		return normalized;
	}

	private validateDescriptor(descriptor: IBaseHalfCardProjectionDescriptor): void {
		if (!/^[a-z][a-z0-9.-]*$/.test(descriptor.id)) {
			throw new Error(`Invalid BaseHalf card projection id '${descriptor.id}'.`);
		}
		if (!descriptor.label.trim()) {
			throw new Error(`BaseHalf card projection '${descriptor.id}' must have a label.`);
		}
		if (!descriptor.icon.startsWith('codicon-')) {
			throw new Error(`BaseHalf card projection '${descriptor.id}' must use a codicon class.`);
		}
		for (const extension of descriptor.selector?.extensions ?? []) {
			if (!/^\.[a-z0-9]+$/i.test(extension)) {
				throw new Error(`Invalid extension '${extension}' in BaseHalf card projection '${descriptor.id}'.`);
			}
		}
	}
}

export function baseHalfCardProjectionMatches(resource: URI, descriptor: IBaseHalfCardProjectionDescriptor): boolean {
	const extensions = descriptor.selector?.extensions;
	return !extensions || extensions.length === 0 || extensions.includes(extname(resource).toLowerCase());
}

function baseHalfCardProjectionsFor(resource: URI, descriptors: Iterable<IBaseHalfCardProjectionDescriptor>): IBaseHalfCardProjectionDescriptor[] {
	return [...descriptors]
		.filter(descriptor => baseHalfCardProjectionMatches(resource, descriptor))
		.sort((a, b) => b.order - a.order || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

function defaultBaseHalfCardProjectionFrom(resource: URI, descriptors: Iterable<IBaseHalfCardProjectionDescriptor>): BaseHalfCardDetailProjection {
	const matching = baseHalfCardProjectionsFor(resource, descriptors);
	let winner = matching[0];
	for (const descriptor of matching) {
		if ((descriptor.defaultPriority ?? Number.NEGATIVE_INFINITY) > (winner?.defaultPriority ?? Number.NEGATIVE_INFINITY)) {
			winner = descriptor;
		}
	}
	return winner?.id ?? DEFAULT_BASEHALF_CARD_DETAIL_PROJECTION;
}

export function isBaseHalfMarkdownResource(resource: URI): boolean {
	return MARKDOWN_EXTENSIONS.has(extname(resource).toLowerCase());
}

export function isBaseHalfMediaResource(resource: URI): boolean {
	return isBaseHalfRenderableContentResource(resource);
}

export function defaultBaseHalfCardDetailProjection(resource: URI): BaseHalfCardDetailProjection {
	return defaultBaseHalfCardProjectionFrom(resource, BASEHALF_BUILTIN_CARD_PROJECTIONS);
}

export function normalizeBaseHalfCardDetailProjection(resource: URI, projection: BaseHalfCardDetailProjection | undefined): BaseHalfCardDetailProjection {
	if (projection) {
		const descriptor = BASEHALF_BUILTIN_CARD_PROJECTIONS.find(candidate => candidate.id === projection);
		if (descriptor && baseHalfCardProjectionMatches(resource, descriptor)) {
			return projection;
		}
	}
	return defaultBaseHalfCardDetailProjection(resource);
}

registerSingleton(IBaseHalfCardProjectionRegistryService, BaseHalfCardProjectionRegistryService, InstantiationType.Delayed);
