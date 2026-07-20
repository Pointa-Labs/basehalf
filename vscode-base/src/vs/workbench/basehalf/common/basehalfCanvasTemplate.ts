/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../base/common/buffer.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { URI } from '../../../base/common/uri.js';
import { BaseHalfCanvasAnchor } from './basehalfCanvasModel.js';
import {
	BASEHALF_NODE_MAX_BINDINGS,
	BASEHALF_NODE_MAX_ID_LENGTH,
	BASEHALF_PROJECT_PATH_MAX_LENGTH,
	BaseHalfNodeJsonValue,
	BaseHalfNodeKind,
	baseHalfProjectPathKey,
	baseHalfProjectPathProblem,
	IBaseHalfNodeInputBinding
} from './basehalfNodeDocument.js';

export const BASEHALF_CANVAS_TEMPLATE_VERSION = 1;
export const BASEHALF_CANVAS_TEMPLATE_MAX_BYTES = 512 * 1024;
export const BASEHALF_CANVAS_CREATE_FROM_TEMPLATE_COMMAND_ID = 'basehalf.canvas.createFromTemplate';

export interface IBaseHalfCanvasCreateFromTemplateCommandArguments {
	readonly templateId: string;
	readonly targetFolder: URI;
	/** Internal host cancellation propagated by the Agent Area command bridge. */
	readonly cancellationToken?: CancellationToken;
}

export interface IBaseHalfCanvasCreateFromTemplateCommandResult {
	readonly templateId: string;
	readonly projectPath: string;
}

const MAX_ENTRIES = 100;
const MAX_TEXT_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_PARAMETERS = 128;
const MAX_PARAMETER_DEPTH = 12;
const ANCHORS = new Set<BaseHalfCanvasAnchor>(['north', 'east', 'south', 'west']);
const NODE_KINDS = new Set<BaseHalfNodeKind>(['file', 'image', 'video', 'audio', 'pdf', 'presentation']);

export interface IBaseHalfCanvasTemplateTextFile {
	readonly path: string;
	readonly contents: string;
}

export interface IBaseHalfCanvasTemplateRecipe {
	readonly recipeId: string;
	readonly parameters: Readonly<Record<string, BaseHalfNodeJsonValue>>;
	readonly inputBindings: readonly IBaseHalfNodeInputBinding[];
}

export interface IBaseHalfCanvasTemplateNode {
	readonly path: string;
	readonly kind: BaseHalfNodeKind;
	readonly title: string;
	readonly role: string;
	readonly recipe?: IBaseHalfCanvasTemplateRecipe;
}

export interface IBaseHalfCanvasTemplateCard {
	readonly path: string;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface IBaseHalfCanvasTemplateReference {
	readonly from: string;
	readonly to: string;
	readonly fromAnchor: BaseHalfCanvasAnchor;
	readonly toAnchor: BaseHalfCanvasAnchor;
}

export interface IBaseHalfCanvasTemplate {
	readonly version: typeof BASEHALF_CANVAS_TEMPLATE_VERSION;
	readonly files: readonly IBaseHalfCanvasTemplateTextFile[];
	readonly nodes: readonly IBaseHalfCanvasTemplateNode[];
	readonly cards: readonly IBaseHalfCanvasTemplateCard[];
	readonly references: readonly IBaseHalfCanvasTemplateReference[];
}

export class BaseHalfCanvasTemplateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BaseHalfCanvasTemplateError';
	}
}

/**
 * Parses the static, declarative template format accepted from reviewed
 * extensions. Templates create host-owned files and references; they cannot
 * carry run history, credentials, executable code, or private extension state.
 */
export function parseBaseHalfCanvasTemplate(source: string): IBaseHalfCanvasTemplate {
	if (typeof source !== 'string' || VSBuffer.fromString(source).byteLength > BASEHALF_CANVAS_TEMPLATE_MAX_BYTES) {
		throw invalid(`The canvas template must be UTF-8 JSON no larger than ${BASEHALF_CANVAS_TEMPLATE_MAX_BYTES} bytes.`);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(source.charCodeAt(0) === 0xFEFF ? source.slice(1) : source);
	} catch {
		throw invalid('The canvas template is not valid JSON.');
	}
	const root = record(parsed, 'template');
	assertOnlyKeys(root, ['version', 'files', 'nodes', 'cards', 'references'], 'template');
	if (root.version !== BASEHALF_CANVAS_TEMPLATE_VERSION) {
		throw invalid(`Unsupported canvas template version '${String(root.version)}'.`);
	}

	const files = array(root.files, 'template.files').map((value, index) => parseTextFile(value, `template.files[${index}]`));
	const nodes = array(root.nodes, 'template.nodes').map((value, index) => parseNode(value, `template.nodes[${index}]`));
	const cards = array(root.cards, 'template.cards').map((value, index) => parseCard(value, `template.cards[${index}]`));
	const references = array(root.references, 'template.references').map((value, index) => parseReference(value, `template.references[${index}]`));
	const paths = [...files.map(file => file.path), ...nodes.map(node => node.path)];
	if (files.some(file => file.path.toLowerCase().endsWith('.bhnode'))) {
		throw invalid('Template text files cannot use the reserved .bhnode extension.');
	}
	assertUnique(paths.map(baseHalfProjectPathKey), 'template file and node paths');
	assertNoPathPrefixCollisions(paths, 'template file and node paths');
	const pathSet = new Set(paths);
	if (paths.length === 0) {
		throw invalid('The canvas template must create at least one file or node.');
	}
	for (const node of nodes) {
		if (!node.path.toLowerCase().endsWith('.bhnode')) {
			throw invalid(`Template node '${node.path}' must use the .bhnode extension.`);
		}
		for (const binding of node.recipe?.inputBindings ?? []) {
			if (!pathSet.has(binding.sourcePath)) {
				throw invalid(`Template node '${node.path}' binds missing source '${binding.sourcePath}'.`);
			}
		}
	}
	assertUnique(cards.map(card => baseHalfProjectPathKey(card.path)), 'template card paths');
	for (const card of cards) {
		if (!pathSet.has(card.path)) {
			throw invalid(`Template card '${card.path}' does not have a matching file or node.`);
		}
	}
	assertUnique(references.map(reference => `${baseHalfProjectPathKey(reference.from)}\u0000${baseHalfProjectPathKey(reference.to)}`), 'template references');
	const referenceSet = new Set(references.map(reference => `${reference.from}\u0000${reference.to}`));
	for (const reference of references) {
		if (!pathSet.has(reference.from) || !pathSet.has(reference.to)) {
			throw invalid(`Template reference '${reference.from}' to '${reference.to}' must connect created resources.`);
		}
		if (reference.from === reference.to) {
			throw invalid(`Template reference '${reference.from}' cannot connect a resource to itself.`);
		}
	}
	for (const node of nodes) {
		const recipe = node.recipe;
		for (const binding of recipe?.inputBindings ?? []) {
			if (!referenceSet.has(`${binding.sourcePath}\u0000${node.path}`)) {
				throw invalid(`Template node '${node.path}' binds '${binding.sourcePath}' without a matching direct reference.`);
			}
		}
	}

	const totalTextBytes = files.reduce((total, file) => total + VSBuffer.fromString(file.contents).byteLength, 0);
	if (totalTextBytes > MAX_TOTAL_TEXT_BYTES) {
		throw invalid(`Template text files exceed ${MAX_TOTAL_TEXT_BYTES} bytes in total.`);
	}
	return Object.freeze({
		version: BASEHALF_CANVAS_TEMPLATE_VERSION,
		files: Object.freeze(files),
		nodes: Object.freeze(nodes),
		cards: Object.freeze(cards),
		references: Object.freeze(references)
	});
}

function parseTextFile(value: unknown, path: string): IBaseHalfCanvasTemplateTextFile {
	const candidate = record(value, path);
	assertOnlyKeys(candidate, ['path', 'contents'], path);
	const contents = text(candidate.contents, `${path}.contents`, 256 * 1024, true);
	if (VSBuffer.fromString(contents).byteLength > MAX_TEXT_FILE_BYTES) {
		throw invalid(`${path}.contents exceeds ${MAX_TEXT_FILE_BYTES} bytes.`);
	}
	return Object.freeze({ path: projectPath(candidate.path, `${path}.path`), contents });
}

function parseNode(value: unknown, path: string): IBaseHalfCanvasTemplateNode {
	const candidate = record(value, path);
	assertOnlyKeys(candidate, ['path', 'kind', 'title', 'role', 'recipe'], path);
	const kind = text(candidate.kind, `${path}.kind`, 16) as BaseHalfNodeKind;
	if (!NODE_KINDS.has(kind)) {
		throw invalid(`${path}.kind is not a supported node content kind.`);
	}
	const recipe = candidate.recipe === undefined ? undefined : parseRecipe(candidate.recipe, `${path}.recipe`);
	return Object.freeze({
		path: projectPath(candidate.path, `${path}.path`),
		kind,
		title: text(candidate.title, `${path}.title`, 240),
		role: text(candidate.role, `${path}.role`, 120),
		...(recipe ? { recipe } : {})
	});
}

function parseRecipe(value: unknown, path: string): IBaseHalfCanvasTemplateRecipe {
	const candidate = record(value, path);
	assertOnlyKeys(candidate, ['recipeId', 'parameters', 'inputBindings'], path);
	const parameters = jsonObject(candidate.parameters, `${path}.parameters`, 0, { remaining: MAX_PARAMETERS });
	const inputBindings = array(candidate.inputBindings, `${path}.inputBindings`, BASEHALF_NODE_MAX_BINDINGS).map((entry, index) => {
		const bindingPath = `${path}.inputBindings[${index}]`;
		const binding = record(entry, bindingPath);
		assertOnlyKeys(binding, ['sourcePath', 'slot', 'order'], bindingPath);
		return Object.freeze({
			sourcePath: projectPath(binding.sourcePath, `${bindingPath}.sourcePath`),
			slot: text(binding.slot, `${bindingPath}.slot`, 120),
			order: integer(binding.order, `${bindingPath}.order`, 0, 63)
		});
	});
	assertUnique(inputBindings.map(binding => String(binding.order)), `${path} binding order`);
	assertUnique(inputBindings.map(binding => baseHalfProjectPathKey(binding.sourcePath)), `${path} binding source path`);
	return Object.freeze({
		recipeId: identifier(candidate.recipeId, `${path}.recipeId`),
		parameters: Object.freeze(parameters),
		inputBindings: Object.freeze(inputBindings.sort((left, right) => left.order - right.order))
	});
}

function parseCard(value: unknown, path: string): IBaseHalfCanvasTemplateCard {
	const candidate = record(value, path);
	assertOnlyKeys(candidate, ['path', 'x', 'y', 'width', 'height'], path);
	return Object.freeze({
		path: projectPath(candidate.path, `${path}.path`),
		x: finite(candidate.x, `${path}.x`, -1_000_000, 1_000_000),
		y: finite(candidate.y, `${path}.y`, -1_000_000, 1_000_000),
		width: finite(candidate.width, `${path}.width`, 140, 2400),
		height: finite(candidate.height, `${path}.height`, 48, 1800)
	});
}

function parseReference(value: unknown, path: string): IBaseHalfCanvasTemplateReference {
	const candidate = record(value, path);
	assertOnlyKeys(candidate, ['from', 'to', 'fromAnchor', 'toAnchor'], path);
	const fromAnchor = anchor(candidate.fromAnchor, `${path}.fromAnchor`);
	const toAnchor = anchor(candidate.toAnchor, `${path}.toAnchor`);
	return Object.freeze({
		from: projectPath(candidate.from, `${path}.from`),
		to: projectPath(candidate.to, `${path}.to`),
		fromAnchor,
		toAnchor
	});
}

function jsonObject(value: unknown, path: string, depth: number, budget: { remaining: number }): Record<string, BaseHalfNodeJsonValue> {
	if (depth > MAX_PARAMETER_DEPTH) {
		throw invalid(`${path} exceeds the maximum nesting depth.`);
	}
	const candidate = record(value, path);
	const result: Record<string, BaseHalfNodeJsonValue> = {};
	for (const [key, entry] of Object.entries(candidate)) {
		consume(budget, path);
		if (!key || key.length > 128 || key === '__proto__' || key === 'constructor' || key === 'prototype') {
			throw invalid(`${path} contains an invalid parameter name.`);
		}
		result[key] = jsonValue(entry, `${path}.${key}`, depth + 1, budget);
	}
	return result;
}

function jsonValue(value: unknown, path: string, depth: number, budget: { remaining: number }): BaseHalfNodeJsonValue {
	consume(budget, path);
	if (value === null || typeof value === 'boolean') {
		return value;
	}
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) {
			throw invalid(`${path} must be finite.`);
		}
		return value;
	}
	if (typeof value === 'string') {
		return text(value, path, 16 * 1024, true);
	}
	if (Array.isArray(value)) {
		if (depth > MAX_PARAMETER_DEPTH || value.length > MAX_PARAMETERS) {
			throw invalid(`${path} is too complex.`);
		}
		return Object.freeze(value.map((entry, index) => jsonValue(entry, `${path}[${index}]`, depth + 1, budget)));
	}
	return Object.freeze(jsonObject(value, path, depth, budget));
}

function projectPath(value: unknown, path: string): string {
	const result = text(value, path, BASEHALF_PROJECT_PATH_MAX_LENGTH);
	const problem = baseHalfProjectPathProblem(result);
	if (problem) {
		throw invalid(`${path} ${problem}`);
	}
	return result;
}

function identifier(value: unknown, path: string): string {
	if (typeof value !== 'string' || value.length > BASEHALF_NODE_MAX_ID_LENGTH || value.includes('\u0000')) {
		throw invalid(`${path} is not a valid contribution identifier.`);
	}
	const result = value.trim();
	if (result !== value || !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){2,}$/.test(result)) {
		throw invalid(`${path} is not a valid contribution identifier.`);
	}
	return result;
}

function anchor(value: unknown, path: string): BaseHalfCanvasAnchor {
	if (typeof value !== 'string' || !ANCHORS.has(value as BaseHalfCanvasAnchor)) {
		throw invalid(`${path} must be north, east, south, or west.`);
	}
	return value as BaseHalfCanvasAnchor;
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw invalid(`${path} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function array(value: unknown, path: string, maximum = MAX_ENTRIES): unknown[] {
	if (!Array.isArray(value) || value.length > maximum) {
		throw invalid(`${path} must be an array of no more than ${maximum} entries.`);
	}
	return [...value];
}

function text(value: unknown, path: string, maximum: number, allowEmpty = false): string {
	if (typeof value !== 'string' || value.length > maximum || value.includes('\u0000')) {
		throw invalid(`${path} must be text no longer than ${maximum} characters.`);
	}
	const result = allowEmpty ? value : value.trim();
	if (!allowEmpty && !result) {
		throw invalid(`${path} cannot be empty.`);
	}
	return result;
}

function integer(value: unknown, path: string, minimum: number, maximum: number): number {
	if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		throw invalid(`${path} must be an integer from ${minimum} to ${maximum}.`);
	}
	return value as number;
}

function finite(value: unknown, path: string, minimum: number, maximum: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
		throw invalid(`${path} must be a finite number from ${minimum} to ${maximum}.`);
	}
	return value;
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
	const accepted = new Set(allowed);
	const unexpected = Object.keys(value).find(key => !accepted.has(key));
	if (unexpected) {
		throw invalid(`${path} contains unsupported property '${unexpected}'.`);
	}
}

function assertUnique(values: readonly string[], path: string): void {
	if (new Set(values).size !== values.length) {
		throw invalid(`${path} must not contain duplicates.`);
	}
}

function assertNoPathPrefixCollisions(paths: readonly string[], path: string): void {
	const keys = [...paths.map(baseHalfProjectPathKey)].sort();
	for (let index = 1; index < keys.length; index++) {
		if (keys[index].startsWith(`${keys[index - 1]}/`)) {
			throw invalid(`${path} cannot create a file inside another created file.`);
		}
	}
}

function consume(budget: { remaining: number }, path: string): void {
	budget.remaining--;
	if (budget.remaining < 0) {
		throw invalid(`${path} exceeds the parameter complexity limit.`);
	}
}

function invalid(message: string): BaseHalfCanvasTemplateError {
	return new BaseHalfCanvasTemplateError(message);
}
