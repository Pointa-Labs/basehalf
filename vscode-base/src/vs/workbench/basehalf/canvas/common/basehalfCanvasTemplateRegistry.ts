/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

/**
 * The canvas templates. Each is BaseHalf's own, and its JSON is part of the
 * application's code (D75); no extension contributes one (D76).
 * `basehalfCanvasTemplate.ts` parses the JSON when a project is made from it.
 */

const TEMPLATE_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2,}$/;
const MAX_TEMPLATE_ID_LENGTH = 128;
/** The most a template's JSON may be. */
export const BASEHALF_CANVAS_TEMPLATE_MAX_BYTES = 512 * 1024;

export interface IBaseHalfCanvasTemplate {
	/** The feature the template belongs to; its id starts with `<namespace>.`. */
	readonly namespace: string;
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	/** The template's JSON. */
	readonly source: string;
}

export const IBaseHalfCanvasTemplateRegistryService = createDecorator<IBaseHalfCanvasTemplateRegistryService>('baseHalfCanvasTemplateRegistryService');

export interface IBaseHalfCanvasTemplateRegistryService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;
	registerTemplate(template: IBaseHalfCanvasTemplate): IDisposable;
	getTemplate(id: string): IBaseHalfCanvasTemplate | undefined;
	getTemplates(): readonly IBaseHalfCanvasTemplate[];
}

export class BaseHalfCanvasTemplateRegistryService extends Disposable implements IBaseHalfCanvasTemplateRegistryService {
	declare readonly _serviceBrand: undefined;

	private readonly templates = new Map<string, IBaseHalfCanvasTemplate>();
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	registerTemplate(template: IBaseHalfCanvasTemplate): IDisposable {
		const namespace = normalizeNamespace(template.namespace);
		const id = normalizeTemplateId(namespace, template.id);
		if (VSBuffer.fromString(template.source).byteLength > BASEHALF_CANVAS_TEMPLATE_MAX_BYTES) {
			throw new Error(`BaseHalf canvas template '${id}' is larger than a template may be.`);
		}
		if (this.templates.has(id)) {
			throw new Error(`A BaseHalf canvas template with id '${id}' is already registered.`);
		}
		const registered: IBaseHalfCanvasTemplate = Object.freeze({
			namespace,
			id,
			label: boundedText(template.label, `${id}.label`, 80),
			...(template.description === undefined ? {} : { description: boundedText(template.description, `${id}.description`, 500) }),
			source: template.source
		});
		this.templates.set(id, registered);
		this._onDidChange.fire();
		return toDisposable(() => {
			if (this.templates.get(id) === registered) {
				this.templates.delete(id);
				this._onDidChange.fire();
			}
		});
	}

	getTemplate(id: string): IBaseHalfCanvasTemplate | undefined {
		return this.templates.get(id.toLowerCase());
	}

	getTemplates(): readonly IBaseHalfCanvasTemplate[] {
		return [...this.templates.values()].sort((first, second) => first.label.localeCompare(second.label) || first.id.localeCompare(second.id));
	}
}

function normalizeNamespace(value: string): string {
	const namespace = value.trim().toLowerCase();
	if (!/^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/.test(namespace)) {
		throw new Error(`Invalid BaseHalf canvas template namespace '${value}'.`);
	}
	return namespace;
}

function normalizeTemplateId(namespace: string, value: string): string {
	const id = typeof value === 'string' ? value : '';
	if (id.length > MAX_TEMPLATE_ID_LENGTH || !TEMPLATE_ID_PATTERN.test(id) || !id.startsWith(`${namespace}.`)) {
		throw new Error(`BaseHalf canvas template '${id || value}' must be prefixed by '${namespace}.'.`);
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
