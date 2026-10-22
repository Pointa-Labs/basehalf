/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { isUUID } from '../../../../base/common/uuid.js';
import { BASEHALF_PROJECT_PATH_MAX_LENGTH, baseHalfProjectPathKey, baseHalfProjectPathProblem } from '../../workspace/common/basehalfProjectPath.js';
import {
	BASEHALF_UPSTREAM_MAX_NODE_ENTRIES,
	baseHalfAnalyzeUpstreamItems,
	baseHalfNormalizeUpstreamEntry,
	IBaseHalfUpstreamIdentity,
	IBaseHalfUpstreamItem,
	IBaseHalfUpstreamItemValue
} from '../../references/common/basehalfReferenceEntries.js';
import {
	BaseHalfVideoNodeError,
	IBaseHalfNodeArtifact,
	IBaseHalfNodeResult,
	IBaseHalfVideoGeneration,
	IBaseHalfVideoNodeFields,
	IBaseHalfVideoTask,
	normalizeBaseHalfVideoGeneration,
	normalizeBaseHalfVideoPrompt,
	normalizeBaseHalfVideoResultGeneration,
	normalizeBaseHalfVideoTask
} from './basehalfVideoNode.js';

/**
 * The `.bhnode` document, version 6 (D58, D59). Every kind holds `version`,
 * `id`, `kind`, `title`, `upstream`, and an optional `result`. A Video node
 * adds `prompt`, `generation`, and `task`, which `basehalfVideoNode.ts`
 * defines and validates. Earlier versions are not read: the product has not
 * launched.
 */

export const BASEHALF_NODE_DOCUMENT_EXTENSION = '.bhnode';
export const BASEHALF_NODE_DOCUMENT_VERSION = 6;
export const BASEHALF_NODE_DOCUMENT_MAX_BYTES = 2 * 1024 * 1024;
export const BASEHALF_NODE_TITLE_MAX_LENGTH = 240;

const NODE_KINDS = ['file', 'image', 'video', 'audio', 'pdf', 'presentation'] as const;
const RESULT_SOURCES = ['imported', 'generated'] as const;
/** The fields of a Video node, in the order they are written. */
const VIDEO_FIELDS = ['prompt', 'generation', 'task'] as const;
const DOCUMENT_FIELDS = ['version', 'id', 'kind', 'title', 'prompt', 'upstream', 'generation', 'task', 'result'] as const;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export type BaseHalfNodeKind = typeof NODE_KINDS[number];
export type BaseHalfNodeArtifactKind = BaseHalfNodeKind;

/** The kinds of node a `.bhnode` can be, in the order menus list them. */
export const BASEHALF_NODE_KINDS: readonly BaseHalfNodeKind[] = Object.freeze([...NODE_KINDS]);

export interface IBaseHalfNodeJsonObject {
	readonly [key: string]: BaseHalfNodeJsonValue;
}

export interface IBaseHalfNodeJsonArray extends ReadonlyArray<BaseHalfNodeJsonValue> { }

/** An `upstream` item is kept verbatim, whatever JSON value it is. */
export type BaseHalfNodeJsonValue = null | boolean | number | string | IBaseHalfNodeJsonArray | IBaseHalfNodeJsonObject;

export interface IBaseHalfNodeDocument extends IBaseHalfVideoNodeFields {
	readonly version: typeof BASEHALF_NODE_DOCUMENT_VERSION;
	/** Canonical lowercase UUID retained across file moves and renames. */
	readonly id: string;
	readonly kind: BaseHalfNodeKind;
	readonly title: string;
	/**
	 * The node's upstream list, the only reference truth for this node and, for
	 * a Video node, its inputs in order. Items are kept verbatim: a non-string,
	 * invalid, self, duplicate, or over-limit item is a problem of that entry,
	 * never a reason to refuse the document.
	 */
	readonly upstream: readonly BaseHalfNodeJsonValue[];
	/** Video only, and always present on a Video node: what the next generation sends. */
	readonly prompt?: string;
	/** Video only: the provider, model, mode, and values of the next generation. */
	readonly generation?: IBaseHalfVideoGeneration;
	/** Video only: the generation that runs, or the last one that ended without a video. */
	readonly task?: IBaseHalfVideoTask;
	/** The file the node shows. */
	readonly result?: IBaseHalfNodeResult;
}

export interface ICreateBaseHalfNodeDocumentOptions extends IBaseHalfVideoNodeFields {
	readonly id: string;
	readonly kind: BaseHalfNodeKind;
	readonly title: string;
	/** Defaults to no entries. */
	readonly upstream?: readonly BaseHalfNodeJsonValue[];
}

export class BaseHalfNodeDocumentError extends Error {
	/**
	 * @param earlierVersion The document is of a version an earlier BaseHalf
	 * wrote (3, 4, or 5), so its card can say that in words.
	 */
	constructor(message: string, readonly earlierVersion?: number) {
		super(message);
		this.name = 'BaseHalfNodeDocumentError';
	}
}

/** Returns whether a portable project path belongs to the host-owned output
 * tree. Ordinary folders named `outputs` below another project folder are
 * intentionally not reserved. */
export function baseHalfIsReservedOutputTreePath(relativePath: string): boolean {
	if (baseHalfProjectPathProblem(relativePath)) {
		return false;
	}
	const segments = relativePath.split('/');
	return segments[0].toLowerCase() === 'outputs';
}

// --- reading and writing ------------------------------------------------------------------------

/**
 * Parses a node document. Unsupported or malformed data is refused, naming the
 * field that is wrong, rather than partly accepted.
 */
export function parseBaseHalfNodeDocument(source: string): IBaseHalfNodeDocument {
	return parseNodeDocumentSource(source);
}

export function parseBaseHalfNodeDocumentBytes(source: Uint8Array): IBaseHalfNodeDocument {
	return parseNodeDocumentSource(decodeNodeDocumentBytes(source));
}

function decodeNodeDocumentBytes(source: Uint8Array): string {
	try {
		return textDecoder.decode(source);
	} catch {
		throw invalid('The node document must be valid UTF-8 JSON text.');
	}
}

function parseNodeDocumentSource(source: string): IBaseHalfNodeDocument {
	if (typeof source !== 'string') {
		throw invalid('The node document must be UTF-8 JSON text.');
	}
	if (source.length > BASEHALF_NODE_DOCUMENT_MAX_BYTES || utf8ByteLength(source) > BASEHALF_NODE_DOCUMENT_MAX_BYTES) {
		throw invalid(`The node document exceeds ${BASEHALF_NODE_DOCUMENT_MAX_BYTES} bytes.`);
	}
	let value: unknown;
	try {
		value = JSON.parse(source.charCodeAt(0) === 0xFEFF ? source.slice(1) : source);
	} catch {
		throw invalid('The node document is not valid JSON.');
	}
	return normalizeDocument(value);
}

/** Serializes a validated document, fields in their documented order. */
export function serializeBaseHalfNodeDocument(document: IBaseHalfNodeDocument): string {
	const normalized = normalizeDocument(document);
	const ordered: Record<string, unknown> = {};
	for (const key of DOCUMENT_FIELDS) {
		const value = (normalized as unknown as Record<string, unknown>)[key];
		if (value !== undefined) {
			ordered[key] = value;
		}
	}
	const serialized = `${JSON.stringify(ordered, null, '\t')}\n`;
	if (utf8ByteLength(serialized) > BASEHALF_NODE_DOCUMENT_MAX_BYTES) {
		throw invalid(`The node document exceeds ${BASEHALF_NODE_DOCUMENT_MAX_BYTES} bytes.`);
	}
	return serialized;
}

/**
 * Creates a validated, deeply frozen version 6 document. The caller supplies
 * the stable UUID. A Video node starts with an empty prompt unless one is given.
 */
export function createBaseHalfNodeDocument(options: ICreateBaseHalfNodeDocumentOptions): IBaseHalfNodeDocument {
	return normalizeDocument({
		version: BASEHALF_NODE_DOCUMENT_VERSION,
		id: options.id,
		kind: options.kind,
		title: options.title,
		...(options.kind === 'video' ? { prompt: options.prompt ?? '' } : options.prompt !== undefined ? { prompt: options.prompt } : {}),
		upstream: options.upstream ?? [],
		...(options.generation !== undefined ? { generation: options.generation } : {}),
		...(options.task !== undefined ? { task: options.task } : {}),
		...(options.result !== undefined ? { result: options.result } : {})
	});
}

/**
 * The node a copy of `document` starts as: a new identity, the same title, and
 * for a Video node the same prompt and settings. A copy has no upstream
 * entries, task, or result.
 */
export function forkBaseHalfNodeDocument(document: IBaseHalfNodeDocument, id: string): IBaseHalfNodeDocument {
	const normalized = normalizeDocument(document);
	return createBaseHalfNodeDocument({
		id,
		kind: normalized.kind,
		title: normalized.title,
		...(normalized.kind === 'video' ? { prompt: normalized.prompt ?? '' } : {}),
		...(normalized.generation !== undefined ? { generation: normalized.generation } : {})
	});
}

/** Replaces the video fields of a Video node, keeping every other field. */
export function withBaseHalfNodeVideoFields(document: IBaseHalfNodeDocument, fields: IBaseHalfVideoNodeFields): IBaseHalfNodeDocument {
	const normalized = normalizeDocument(document);
	if (normalized.kind !== 'video') {
		throw invalid(`document.kind must be video to hold a prompt, settings, or a task; it is ${normalized.kind}.`);
	}
	return normalizeDocument({
		version: normalized.version,
		id: normalized.id,
		kind: normalized.kind,
		title: normalized.title,
		prompt: fields.prompt ?? '',
		upstream: normalized.upstream,
		...(fields.generation !== undefined ? { generation: fields.generation } : {}),
		...(fields.task !== undefined ? { task: fields.task } : {}),
		...(fields.result !== undefined ? { result: fields.result } : {})
	});
}

/** The video fields of a node document. */
export function getBaseHalfNodeVideoFields(document: IBaseHalfNodeDocument): IBaseHalfVideoNodeFields {
	return Object.freeze({
		...(document.prompt !== undefined ? { prompt: document.prompt } : {}),
		...(document.generation !== undefined ? { generation: document.generation } : {}),
		...(document.task !== undefined ? { task: document.task } : {}),
		...(document.result !== undefined ? { result: document.result } : {})
	});
}

/**
 * Records a file the user brought in as the node's result. Only an empty node
 * takes one: no result, and for a Video node no task.
 */
export function importBaseHalfNodeResult(document: IBaseHalfNodeDocument, artifact: IBaseHalfNodeArtifact): IBaseHalfNodeDocument {
	const normalized = normalizeDocument(document);
	if (normalized.result) {
		throw invalid('This node already shows a file. Import into a new empty node.');
	}
	if (normalized.task) {
		throw invalid('This node has a generation. Import into a new empty node.');
	}
	return normalizeDocument({ ...normalized, result: { source: 'imported', artifact } });
}

/** Returns the file the node shows, if it shows one. */
export function getBaseHalfNodeResultArtifact(document: IBaseHalfNodeDocument): IBaseHalfNodeArtifact | undefined {
	return document.result?.artifact;
}

// --- upstream -------------------------------------------------------------------------------------

/** Case-insensitive NFC identity of portable project paths. */
export const BASEHALF_PROJECT_PATH_IDENTITY: IBaseHalfUpstreamIdentity = Object.freeze({
	key: (path: string) => baseHalfProjectPathKey(path)
});

/** Converts `.bhnode` upstream items to store-independent item values. */
export function baseHalfNodeUpstreamItemValues(upstream: readonly BaseHalfNodeJsonValue[]): IBaseHalfUpstreamItemValue[] {
	return upstream.map(item => typeof item === 'string'
		? { text: item, scalar: true }
		: { text: safeJsonText(item), scalar: false });
}

/**
 * The upstream items of a node document for the node at `nodePath`, valid and
 * invalid, in document order. Every problem is one of an entry: a non-string
 * item is `notString`, and an item past the 64th is `overLimit`.
 */
export function analyzeBaseHalfNodeUpstream(
	document: Pick<IBaseHalfNodeDocument, 'upstream'>,
	nodePath: string,
	identity: IBaseHalfUpstreamIdentity = BASEHALF_PROJECT_PATH_IDENTITY
): readonly IBaseHalfUpstreamItem[] {
	return Object.freeze(baseHalfAnalyzeUpstreamItems(baseHalfNodeUpstreamItemValues(document.upstream), nodePath, identity, {
		maxEntries: BASEHALF_UPSTREAM_MAX_NODE_ENTRIES,
		nonScalarProblem: 'notString'
	}));
}

export type BaseHalfNodeUpstreamEditRefusal =
	/** A write that would exceed 64 entries. */
	| 'limit'
	/** A `replace` whose source entry is not listed. */
	| 'entryMissing';

export class BaseHalfNodeUpstreamEditError extends BaseHalfNodeDocumentError {
	constructor(readonly refusal: BaseHalfNodeUpstreamEditRefusal, message: string) {
		super(message);
		this.name = 'BaseHalfNodeUpstreamEditError';
	}
}

function entryKey(identity: IBaseHalfUpstreamIdentity, value: BaseHalfNodeJsonValue): string | undefined {
	return typeof value === 'string' ? identity.key(baseHalfNormalizeUpstreamEntry(value)) : undefined;
}

/**
 * Appends an upstream entry. An entry that is already listed is never listed
 * twice. Every node accepts entries in every state. Returns the input document
 * when nothing changes.
 */
export function addBaseHalfNodeUpstreamEntry(
	document: IBaseHalfNodeDocument,
	entry: string,
	identity: IBaseHalfUpstreamIdentity = BASEHALF_PROJECT_PATH_IDENTITY
): IBaseHalfNodeDocument {
	const normalized = normalizeDocument(document);
	const path = baseHalfNormalizeUpstreamEntry(entry);
	const key = identity.key(path);
	if (normalized.upstream.some(item => entryKey(identity, item) === key)) {
		return document;
	}
	if (normalized.upstream.length >= BASEHALF_UPSTREAM_MAX_NODE_ENTRIES) {
		throw new BaseHalfNodeUpstreamEditError('limit', `This node already has ${BASEHALF_UPSTREAM_MAX_NODE_ENTRIES} upstream entries.`);
	}
	return normalizeDocument({ ...normalized, upstream: [...normalized.upstream, path] });
}

/** Removes every item naming the entry. Returns the input document when nothing changes. */
export function removeBaseHalfNodeUpstreamEntry(
	document: IBaseHalfNodeDocument,
	entry: string,
	identity: IBaseHalfUpstreamIdentity = BASEHALF_PROJECT_PATH_IDENTITY
): IBaseHalfNodeDocument {
	const normalized = normalizeDocument(document);
	const key = identity.key(baseHalfNormalizeUpstreamEntry(entry));
	const upstream = normalized.upstream.filter(item => entryKey(identity, item) !== key);
	if (upstream.length === normalized.upstream.length) {
		return document;
	}
	return normalizeDocument({ ...normalized, upstream });
}

/**
 * Replaces the first item naming `from` in place, so its position, and for a
 * Video node the input's place in the order, stay. When `to` is already listed
 * the `from` item is removed instead. Returns the input document when nothing
 * changes.
 */
export function replaceBaseHalfNodeUpstreamEntry(
	document: IBaseHalfNodeDocument,
	from: string,
	to: string,
	identity: IBaseHalfUpstreamIdentity = BASEHALF_PROJECT_PATH_IDENTITY
): IBaseHalfNodeDocument {
	const normalized = normalizeDocument(document);
	const fromKey = identity.key(baseHalfNormalizeUpstreamEntry(from));
	const toPath = baseHalfNormalizeUpstreamEntry(to);
	const toKey = identity.key(toPath);
	const index = normalized.upstream.findIndex(item => entryKey(identity, item) === fromKey);
	const toListed = normalized.upstream.some(item => entryKey(identity, item) === toKey);
	if (index < 0) {
		if (toListed) {
			return document;
		}
		throw new BaseHalfNodeUpstreamEditError('entryMissing', `'${from}' is no longer listed as upstream.`);
	}
	if (toListed && fromKey !== toKey) {
		return removeBaseHalfNodeUpstreamEntry(normalized, from, identity);
	}
	if (normalized.upstream[index] === toPath) {
		return document;
	}
	return normalizeDocument({ ...normalized, upstream: normalized.upstream.map((item, candidate) => candidate === index ? toPath : item) });
}

/**
 * Replaces the upstream items wholesale (canvas undo and redo, positional
 * issue actions, a new order of a Video node's inputs). A list above 64 items
 * is refused unless it shrinks the list.
 */
export function setBaseHalfNodeUpstream(
	document: IBaseHalfNodeDocument,
	upstream: readonly BaseHalfNodeJsonValue[]
): IBaseHalfNodeDocument {
	const normalized = normalizeDocument(document);
	if (JSON.stringify(upstream) === JSON.stringify(normalized.upstream)) {
		return document;
	}
	if (upstream.length > BASEHALF_UPSTREAM_MAX_NODE_ENTRIES && upstream.length > normalized.upstream.length) {
		throw new BaseHalfNodeUpstreamEditError('limit', `This node already has ${BASEHALF_UPSTREAM_MAX_NODE_ENTRIES} upstream entries.`);
	}
	return normalizeDocument({ ...normalized, upstream });
}

/** What the lenient extractor could read from `.bhnode` text. */
export type BaseHalfNodeUpstreamExtract =
	| {
		readonly readable: true;
		/** Upstream items verbatim. */
		readonly upstream: readonly BaseHalfNodeJsonValue[];
		/** The path of the file the node shows, when it records a result. */
		readonly resultArtifactPath?: string;
	}
	| { readonly readable: false; readonly reason: string };

/**
 * Reads the upstream list of version 6 `.bhnode` text without validating the
 * rest of the document. The reference index and the plugin guard use it, so a
 * malformed unrelated field never hides a node's upstream list.
 */
export function extractBaseHalfNodeUpstreamLenient(source: string): BaseHalfNodeUpstreamExtract {
	let value: unknown;
	try {
		value = JSON.parse(source.charCodeAt(0) === 0xFEFF ? source.slice(1) : source);
	} catch {
		return { readable: false, reason: 'The node document is not valid JSON.' };
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return { readable: false, reason: 'The node document must be an object.' };
	}
	const candidate = value as Record<string, unknown>;
	if (candidate.version !== BASEHALF_NODE_DOCUMENT_VERSION) {
		return { readable: false, reason: unsupportedVersionMessage(candidate.version) };
	}
	if (!Array.isArray(candidate.upstream)) {
		return { readable: false, reason: 'document.upstream must be an array.' };
	}
	const result = candidate.result && typeof candidate.result === 'object' ? candidate.result as Record<string, unknown> : undefined;
	const artifact = result?.artifact && typeof result.artifact === 'object' ? result.artifact as Record<string, unknown> : undefined;
	return {
		readable: true,
		upstream: candidate.upstream as BaseHalfNodeJsonValue[],
		...(typeof artifact?.path === 'string' ? { resultArtifactPath: artifact.path } : {})
	};
}

// --- validation -------------------------------------------------------------------------------------

function normalizeDocument(value: unknown): IBaseHalfNodeDocument {
	const candidate = record(value, 'document');
	if (candidate.version !== BASEHALF_NODE_DOCUMENT_VERSION) {
		throw new BaseHalfNodeDocumentError(unsupportedVersionMessage(candidate.version), isEarlierVersion(candidate.version) ? candidate.version : undefined);
	}
	for (const key of Object.keys(candidate)) {
		if (!(DOCUMENT_FIELDS as readonly string[]).includes(key)) {
			throw invalid(`document.${key} is not a known field.`);
		}
	}
	const id = requiredNodeDocumentId(candidate.id);
	const kind = oneOf(candidate.kind, NODE_KINDS, 'document.kind');
	const title = requiredString(candidate.title, BASEHALF_NODE_TITLE_MAX_LENGTH, 'document.title');
	const upstream = upstreamItems(candidate.upstream);
	if (kind !== 'video') {
		for (const field of VIDEO_FIELDS) {
			if (candidate[field] !== undefined) {
				throw invalid(`document.${field} is allowed only on a Video node.`);
			}
		}
	} else if (candidate.prompt === undefined) {
		throw invalid('document.prompt is required on a Video node.');
	}
	const prompt = kind === 'video' ? video(() => normalizeBaseHalfVideoPrompt(candidate.prompt, 'document.prompt')) : undefined;
	const generation = candidate.generation === undefined ? undefined : video(() => normalizeBaseHalfVideoGeneration(candidate.generation, 'document.generation'));
	const task = candidate.task === undefined ? undefined : video(() => normalizeBaseHalfVideoTask(candidate.task, 'document.task'));
	const result = candidate.result === undefined ? undefined : normalizeResult(candidate.result, kind);
	if (task && result) {
		throw invalid('document.task cannot be set while document.result is set: a node with a video never runs again.');
	}
	return Object.freeze({
		version: BASEHALF_NODE_DOCUMENT_VERSION,
		id,
		kind,
		title,
		...(prompt !== undefined ? { prompt } : {}),
		upstream: Object.freeze([...upstream]),
		...(generation !== undefined ? { generation } : {}),
		...(task !== undefined ? { task } : {}),
		...(result !== undefined ? { result } : {})
	});
}

function normalizeResult(value: unknown, kind: BaseHalfNodeKind): IBaseHalfNodeResult {
	const path = 'document.result';
	const candidate = record(value, path);
	const source = oneOf(candidate.source, RESULT_SOURCES, `${path}.source`);
	assertOnlyKeys(candidate, source === 'imported' ? ['source', 'artifact'] : ['source', 'artifact', 'generation'], path);
	const artifact = normalizeArtifact(candidate.artifact, `${path}.artifact`);
	if (artifact.kind !== kind) {
		throw invalid(`${path}.artifact.kind must match document.kind '${kind}'.`);
	}
	if (source === 'imported') {
		return Object.freeze({ source, artifact });
	}
	if (kind !== 'video') {
		throw invalid(`${path}.source 'generated' is allowed only on a Video node.`);
	}
	const generation = video(() => normalizeBaseHalfVideoResultGeneration(candidate.generation, `${path}.generation`));
	return Object.freeze({ source, artifact, generation });
}

function normalizeArtifact(value: unknown, path: string): IBaseHalfNodeArtifact {
	const candidate = record(value, path);
	assertOnlyKeys(candidate, ['kind', 'path', 'size'], path);
	return Object.freeze({
		kind: oneOf(candidate.kind, NODE_KINDS, `${path}.kind`),
		path: projectPath(candidate.path, `${path}.path`),
		size: integer(candidate.size, 0, Number.MAX_SAFE_INTEGER, `${path}.size`)
	});
}

/** The strict reader requires an array and keeps every item verbatim. */
function upstreamItems(value: unknown): readonly BaseHalfNodeJsonValue[] {
	if (!Array.isArray(value)) {
		throw invalid('document.upstream must be an array.');
	}
	return value as BaseHalfNodeJsonValue[];
}

/** Versions 3, 4, and 5 were written by earlier BaseHalf builds and are not read. */
function isEarlierVersion(version: unknown): version is 3 | 4 | 5 {
	return version === 3 || version === 4 || version === 5;
}

function unsupportedVersionMessage(version: unknown): string {
	return isEarlierVersion(version)
		? `document.version ${version} is no longer supported: this node was saved by an earlier BaseHalf.`
		: `document.version must be ${BASEHALF_NODE_DOCUMENT_VERSION}; it is '${String(version)}'.`;
}

/** Runs a validator of the video fields and reports its error as a document error. */
function video<T>(read: () => T): T {
	try {
		return read();
	} catch (error) {
		if (error instanceof BaseHalfVideoNodeError) {
			throw invalid(error.message);
		}
		throw error;
	}
}

function safeJsonText(value: BaseHalfNodeJsonValue): string {
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw invalid(`${path} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function requiredNodeDocumentId(value: unknown): string {
	const result = requiredString(value, 36, 'document.id');
	if (!isUUID(result) || result !== result.toLowerCase()) {
		throw invalid('document.id must be a canonical lowercase UUID.');
	}
	return result;
}

function requiredString(value: unknown, maxLength: number, path: string): string {
	if (typeof value !== 'string') {
		throw invalid(`${path} must be a string.`);
	}
	if (value.length > maxLength) {
		throw invalid(`${path} is too long.`);
	}
	if (value.includes('\u0000')) {
		throw invalid(`${path} cannot contain NUL.`);
	}
	const result = value.trim();
	if (!result) {
		throw invalid(`${path} cannot be empty.`);
	}
	return result;
}

function projectPath(value: unknown, path: string): string {
	const result = requiredString(value, BASEHALF_PROJECT_PATH_MAX_LENGTH, path);
	const problem = baseHalfProjectPathProblem(result);
	if (problem) {
		throw invalid(`${path} ${problem}`);
	}
	return result;
}

function integer(value: unknown, minimum: number, maximum: number, path: string): number {
	if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		throw invalid(`${path} must be an integer between ${minimum} and ${maximum}.`);
	}
	return value as number;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
	if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
		throw invalid(`${path} must be one of: ${allowed.join(', ')}.`);
	}
	return value as T;
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
	const unknownKey = Object.keys(value).find(key => !allowed.includes(key));
	if (unknownKey) {
		throw invalid(`${path}.${unknownKey} is not a known field.`);
	}
}

function invalid(message: string): BaseHalfNodeDocumentError {
	return new BaseHalfNodeDocumentError(message);
}

function utf8ByteLength(value: string): number {
	return textEncoder.encode(value).byteLength;
}
