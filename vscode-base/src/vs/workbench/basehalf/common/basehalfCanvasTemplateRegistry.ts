/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { extUri } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';

/**
 * The canvas templates that admitted extensions contribute through
 * `contributes.basehalfCanvasTemplates`. A template is a static JSON resource
 * of its extension; `basehalfCanvasTemplate.ts` parses it when a project is
 * made from it.
 */

const CONTRIBUTION_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2,}$/;
const MAX_CONTRIBUTION_ID_LENGTH = 128;

export interface IBaseHalfCanvasTemplateContribution {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	/** The extension-relative path of the template's JSON. */
	readonly resource: string;
}

export interface IBaseHalfCanvasTemplateDescriptor extends Omit<IBaseHalfCanvasTemplateContribution, 'resource'> {
	readonly extensionId: string;
	readonly resource: URI;
}

export const IBaseHalfCanvasTemplateRegistryService = createDecorator<IBaseHalfCanvasTemplateRegistryService>('baseHalfCanvasTemplateRegistryService');

export interface IBaseHalfCanvasTemplateRegistryService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;
	registerTemplate(extensionId: string, extensionLocation: URI, contribution: IBaseHalfCanvasTemplateContribution): IDisposable;
	getTemplate(id: string): IBaseHalfCanvasTemplateDescriptor | undefined;
	getTemplates(): readonly IBaseHalfCanvasTemplateDescriptor[];
}

export class BaseHalfCanvasTemplateRegistryService extends Disposable implements IBaseHalfCanvasTemplateRegistryService {
	declare readonly _serviceBrand: undefined;

	private readonly templates = new Map<string, IBaseHalfCanvasTemplateDescriptor>();
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	registerTemplate(extensionId: string, extensionLocation: URI, contribution: IBaseHalfCanvasTemplateContribution): IDisposable {
		const descriptor = validateBaseHalfCanvasTemplateContribution(extensionId, extensionLocation, contribution);
		if (this.templates.has(descriptor.id)) {
			throw new Error(`A BaseHalf canvas template with id '${descriptor.id}' is already registered.`);
		}
		this.templates.set(descriptor.id, descriptor);
		this._onDidChange.fire();
		return toDisposable(() => {
			if (this.templates.get(descriptor.id) === descriptor) {
				this.templates.delete(descriptor.id);
				this._onDidChange.fire();
			}
		});
	}

	getTemplate(id: string): IBaseHalfCanvasTemplateDescriptor | undefined {
		return this.templates.get(id.toLowerCase());
	}

	getTemplates(): readonly IBaseHalfCanvasTemplateDescriptor[] {
		return [...this.templates.values()].sort((first, second) => first.label.localeCompare(second.label) || first.id.localeCompare(second.id));
	}
}

export function validateBaseHalfCanvasTemplateContribution(extensionId: string, extensionLocation: URI, contribution: IBaseHalfCanvasTemplateContribution): IBaseHalfCanvasTemplateDescriptor {
	const owner = normalizeExtensionId(extensionId);
	const id = normalizeContributionId(owner, contribution.id);
	const label = boundedText(contribution.label, `${id}.label`, 80);
	const description = contribution.description === undefined ? undefined : boundedText(contribution.description, `${id}.description`, 500);
	const relativeResource = validateRelativeTemplateResource(contribution.resource, id);
	const resource = URI.joinPath(extensionLocation, ...relativeResource.split('/'));
	if (!extUri.isEqualOrParent(resource, extensionLocation) || extUri.isEqual(resource, extensionLocation)) {
		throw new Error(`BaseHalf canvas template '${id}' resolves outside its extension.`);
	}
	return Object.freeze({
		id,
		extensionId: owner,
		label,
		...(description === undefined ? {} : { description }),
		resource
	});
}

function validateRelativeTemplateResource(value: string, templateId: string): string {
	const resource = boundedText(value, `${templateId}.resource`, 500);
	if (resource.startsWith('/') || resource.startsWith('\\') || resource.includes('\\') || resource.includes('?') || resource.includes('#') || /^[a-z][a-z0-9+.-]*:/i.test(resource)) {
		throw new Error(`BaseHalf canvas template '${templateId}' resource must be an extension-relative path.`);
	}
	const segments = resource.split('/');
	if (segments.some(segment => !segment || segment === '.' || segment === '..') || !resource.toLowerCase().endsWith('.json')) {
		throw new Error(`BaseHalf canvas template '${templateId}' resource must be a canonical relative JSON path.`);
	}
	return resource;
}

function normalizeExtensionId(value: string): string {
	const id = value.trim().toLowerCase();
	if (!/^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/.test(id)) {
		throw new Error(`Invalid BaseHalf extension id '${value}'.`);
	}
	return id;
}

function normalizeContributionId(extensionId: string, value: string): string {
	const id = typeof value === 'string' ? value : '';
	if (id.length > MAX_CONTRIBUTION_ID_LENGTH || !CONTRIBUTION_ID_PATTERN.test(id) || !id.startsWith(`${extensionId}.`)) {
		throw new Error(`BaseHalf canvas template '${id || value}' must be prefixed by '${extensionId}.'.`);
	}
	return id;
}

function boundedText(value: string, field: string, maximum: number): string {
	if (typeof value !== 'string') {
		throw new Error(`BaseHalf canvas field '${field}' must be text.`);
	}
	const text = value.trim();
	if (!text || text.length > maximum) {
		throw new Error(`BaseHalf canvas field '${field}' must contain 1-${maximum} characters.`);
	}
	return text;
}

registerSingleton(IBaseHalfCanvasTemplateRegistryService, BaseHalfCanvasTemplateRegistryService, InstantiationType.Delayed);
