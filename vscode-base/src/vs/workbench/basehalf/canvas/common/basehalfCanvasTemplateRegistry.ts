/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { extUri } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

/**
 * The canvas templates: BaseHalf's own, whose JSON is part of the
 * application's code (D75), and those that admitted extensions contribute
 * through `contributes.basehalfCanvasTemplates`, whose JSON is a static
 * resource of the extension. `basehalfCanvasTemplate.ts` parses it when a
 * project is made from it.
 */

const CONTRIBUTION_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2,}$/;
const MAX_CONTRIBUTION_ID_LENGTH = 128;
/** The most of a template's JSON that is read. */
export const BASEHALF_CANVAS_TEMPLATE_MAX_BYTES = 512 * 1024;

export interface IBaseHalfCanvasTemplateContribution {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	/** The extension-relative path of the template's JSON. */
	readonly resource: string;
}

/** A template of BaseHalf's own, whose ids are prefixed by `namespace` as an extension's are by its id. */
export interface IBaseHalfCanvasBuiltInTemplate extends Omit<IBaseHalfCanvasTemplateContribution, 'resource'> {
	readonly namespace: string;
	/** The template's JSON. */
	readonly source: string;
}

export interface IBaseHalfCanvasTemplateDescriptor extends Omit<IBaseHalfCanvasTemplateContribution, 'resource'> {
	/** The extension that contributed it, or the namespace of BaseHalf's own. */
	readonly extensionId: string;
	/** The template's JSON: a file of its extension, or the text of BaseHalf's own. */
	readonly source: URI | string;
}

export const IBaseHalfCanvasTemplateRegistryService = createDecorator<IBaseHalfCanvasTemplateRegistryService>('baseHalfCanvasTemplateRegistryService');

export interface IBaseHalfCanvasTemplateRegistryService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;
	registerTemplate(extensionId: string, extensionLocation: URI, contribution: IBaseHalfCanvasTemplateContribution): IDisposable;
	registerBuiltInTemplate(template: IBaseHalfCanvasBuiltInTemplate): IDisposable;
	getTemplate(id: string): IBaseHalfCanvasTemplateDescriptor | undefined;
	getTemplates(): readonly IBaseHalfCanvasTemplateDescriptor[];
}

export class BaseHalfCanvasTemplateRegistryService extends Disposable implements IBaseHalfCanvasTemplateRegistryService {
	declare readonly _serviceBrand: undefined;

	private readonly templates = new Map<string, IBaseHalfCanvasTemplateDescriptor>();
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	registerTemplate(extensionId: string, extensionLocation: URI, contribution: IBaseHalfCanvasTemplateContribution): IDisposable {
		return this.add(validateBaseHalfCanvasTemplateContribution(extensionId, extensionLocation, contribution));
	}

	registerBuiltInTemplate(template: IBaseHalfCanvasBuiltInTemplate): IDisposable {
		const owner = normalizeExtensionId(template.namespace);
		const id = normalizeContributionId(owner, template.id);
		if (VSBuffer.fromString(template.source).byteLength > BASEHALF_CANVAS_TEMPLATE_MAX_BYTES) {
			throw new Error(`BaseHalf canvas template '${id}' is larger than a template may be.`);
		}
		return this.add(Object.freeze({
			id,
			extensionId: owner,
			label: boundedText(template.label, `${id}.label`, 80),
			...(template.description === undefined ? {} : { description: boundedText(template.description, `${id}.description`, 500) }),
			source: template.source
		}));
	}

	private add(descriptor: IBaseHalfCanvasTemplateDescriptor): IDisposable {
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
		source: resource
	});
}

/** The JSON of a template, as the canvas parses it. */
export async function readBaseHalfCanvasTemplateSource(fileService: IFileService, descriptor: IBaseHalfCanvasTemplateDescriptor): Promise<string> {
	if (typeof descriptor.source === 'string') {
		return descriptor.source;
	}
	return (await fileService.readFile(descriptor.source, { limits: { size: BASEHALF_CANVAS_TEMPLATE_MAX_BYTES } })).value.toString();
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
