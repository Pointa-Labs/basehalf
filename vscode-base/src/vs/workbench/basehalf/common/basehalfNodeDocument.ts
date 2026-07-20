/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { isUUID } from '../../../base/common/uuid.js';

export const BASEHALF_NODE_DOCUMENT_EXTENSION = '.bhnode';
export const BASEHALF_CANVAS_RUN_NODE_COMMAND_ID = 'basehalf.canvas.runNode';
export const BASEHALF_NODE_DOCUMENT_VERSION = 2;
export const BASEHALF_NODE_DOCUMENT_MAX_BYTES = 2 * 1024 * 1024;
export const BASEHALF_NODE_MAX_ID_LENGTH = 128;
export const BASEHALF_NODE_MAX_BINDINGS = 64;
export const BASEHALF_NODE_MAX_ARTIFACTS = 64;
export const BASEHALF_PROJECT_PATH_MAX_LENGTH = 1024;

const MAX_ID_LENGTH = BASEHALF_NODE_MAX_ID_LENGTH;
const MAX_TITLE_LENGTH = 240;
const MAX_ROLE_LENGTH = 120;
const MAX_PATH_LENGTH = BASEHALF_PROJECT_PATH_MAX_LENGTH;
const MAX_SLOT_LENGTH = 120;
const MAX_MESSAGE_LENGTH = 16 * 1024;
const MAX_TIMESTAMP_LENGTH = 64;
export const BASEHALF_NODE_MAX_RUNS = 1024;
export const BASEHALF_NODE_MAX_REVISIONS = 1024;
const MAX_BINDINGS = BASEHALF_NODE_MAX_BINDINGS;
const MAX_OUTPUT_PATHS = BASEHALF_NODE_MAX_ARTIFACTS;
const MAX_INPUT_REVISION_LENGTH = 256;
const MAX_MODEL_ID_LENGTH = 256;
const MAX_COST_AMOUNT_LENGTH = 32;
const MAX_JSON_DEPTH = 12;
const MAX_JSON_COLLECTION_SIZE = 256;
const MAX_JSON_NODES = 4096;
const MAX_JSON_KEY_LENGTH = 128;
const MAX_JSON_STRING_LENGTH = 16 * 1024;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

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

const NODE_KINDS = ['file', 'image', 'video', 'audio', 'pdf', 'presentation'] as const;
const ARTIFACT_KINDS = NODE_KINDS;
const CURRENT_SOURCES = ['empty', 'imported', 'run'] as const;
const RUN_STATUSES = ['running', 'succeeded', 'failed', 'cancelled', 'interrupted'] as const;
const MODEL_CAPABILITIES = ['text', 'image', 'video', 'audio'] as const;
const COST_KINDS = ['actual', 'estimated'] as const;

export type BaseHalfNodeKind = typeof NODE_KINDS[number];
export type BaseHalfNodeArtifactKind = typeof ARTIFACT_KINDS[number];
export type BaseHalfNodeCurrentSource = typeof CURRENT_SOURCES[number];
export type BaseHalfNodeRunStatus = typeof RUN_STATUSES[number];
export type BaseHalfNodeRunModelCapability = typeof MODEL_CAPABILITIES[number];
export type BaseHalfNodeRunCostKind = typeof COST_KINDS[number];

export interface IBaseHalfNodeJsonObject {
	readonly [key: string]: BaseHalfNodeJsonValue;
}

export interface IBaseHalfNodeJsonArray extends ReadonlyArray<BaseHalfNodeJsonValue> { }

export type BaseHalfNodeJsonValue = null | boolean | number | string | IBaseHalfNodeJsonArray | IBaseHalfNodeJsonObject;

export interface IBaseHalfNodeInputBinding {
	/** A direct inbound workspace-relative node or file path. */
	readonly sourcePath: string;
	/** Recipe-defined input role. */
	readonly slot: string;
	/** Stable display and execution order within this recipe. */
	readonly order: number;
}

export interface IBaseHalfNodeRecipe {
	readonly recipeId: string;
	/** Omitted for deterministic local recipes that need no model connection. */
	readonly modelServiceId?: string;
	/** Optional provider model identifier selected for the next run. */
	readonly modelId?: string;
	readonly parameters: Readonly<Record<string, BaseHalfNodeJsonValue>>;
	readonly inputBindings: readonly IBaseHalfNodeInputBinding[];
}

export interface IBaseHalfNodeRunInput extends IBaseHalfNodeInputBinding {
	/** Opaque content revision captured by the host when the run starts. */
	readonly revision: string;
}

export interface IBaseHalfNodeRunLocalModel {
	readonly source: 'local';
}

export interface IBaseHalfNodeRunResolvedServiceModel {
	readonly source: 'service';
	readonly connection: 'resolved';
	readonly serviceId: string;
	readonly serviceLabel: string;
	/** SHA-256 identity of non-secret connection settings. The endpoint itself is not project data. */
	readonly connectionIdentity: string;
	readonly capability: BaseHalfNodeRunModelCapability;
	readonly modelId?: string;
}

/** A selected model capability whose connection could not be resolved for this attempt. */
export interface IBaseHalfNodeRunUnavailableServiceModel {
	readonly source: 'service';
	readonly connection: 'unavailable';
	readonly serviceId?: string;
	readonly capability: BaseHalfNodeRunModelCapability;
	readonly modelId?: string;
}

/** Immutable identity of the execution backend selected before a run starts. */
export type BaseHalfNodeRunModel = IBaseHalfNodeRunLocalModel | IBaseHalfNodeRunResolvedServiceModel | IBaseHalfNodeRunUnavailableServiceModel;

export interface IBaseHalfNodeRunUsage {
	readonly inputTokens?: number;
	readonly outputTokens?: number;
	readonly cachedInputTokens?: number;
	readonly images?: number;
	readonly videoSeconds?: number;
	readonly audioSeconds?: number;
}

export interface IBaseHalfNodeRunCost {
	/** Uppercase ISO-style three-letter currency identifier. */
	readonly currency: string;
	/** Canonical non-negative decimal string. */
	readonly amount: string;
	readonly kind: BaseHalfNodeRunCostKind;
}

/** One immutable ordinary-file artifact accepted from a completed recipe run. */
export interface IBaseHalfNodeRunArtifact {
	readonly id: string;
	readonly outputId: string;
	readonly kind: BaseHalfNodeArtifactKind;
	readonly path: string;
	/** Unpadded Base64 SHA-256 of the accepted file contents. */
	readonly sha256: string;
	readonly size: number;
	readonly label?: string;
}

/** One immutable, user-imported content version. Imports are revisions, never recipe runs. */
export interface IBaseHalfNodeImportedRevision {
	readonly id: string;
	readonly source: 'imported';
	readonly createdAt: string;
	readonly artifacts: readonly IBaseHalfNodeRunArtifact[];
	readonly primaryArtifactId: string;
}

export interface IBaseHalfNodeRun {
	readonly id: string;
	readonly status: BaseHalfNodeRunStatus;
	readonly createdAt: string;
	readonly startedAt?: string;
	readonly completedAt?: string;
	/** Immutable recipe snapshot used by this run. */
	readonly recipe: IBaseHalfNodeRecipe;
	/** Immutable local or external model-service identity selected before execution. */
	readonly model: BaseHalfNodeRunModel;
	/** Immutable direct-input snapshots used by this run. */
	readonly inputs: readonly IBaseHalfNodeRunInput[];
	/** Immutable accepted outputs. Artifact kind is the content truth. */
	readonly artifacts: readonly IBaseHalfNodeRunArtifact[];
	readonly primaryArtifactId?: string;
	readonly providerRequestId?: string;
	readonly usage?: IBaseHalfNodeRunUsage;
	readonly cost?: IBaseHalfNodeRunCost;
	readonly outputPaths: readonly string[];
	readonly error?: string;
}

export interface IBaseHalfNodeCurrent {
	readonly source: BaseHalfNodeCurrentSource;
	readonly runId?: string;
	readonly revisionId?: string;
	readonly outputPaths: readonly string[];
}

export interface IBaseHalfNodeDocument {
	readonly version: typeof BASEHALF_NODE_DOCUMENT_VERSION;
	/** Canonical lowercase UUID retained across file moves and renames. */
	readonly id: string;
	readonly kind: BaseHalfNodeKind;
	readonly title: string;
	readonly role: string;
	readonly current: IBaseHalfNodeCurrent;
	readonly recipe?: IBaseHalfNodeRecipe;
	/** Append-only imported versions. Their files remain ordinary project data. */
	readonly revisions: readonly IBaseHalfNodeImportedRevision[];
	/** Append-only historical records. Selecting Current never mutates these records. */
	readonly runs: readonly IBaseHalfNodeRun[];
}

export interface ICreateBaseHalfNodeDocumentOptions {
	readonly id: string;
	readonly kind: BaseHalfNodeKind;
	readonly title: string;
	readonly role: string;
	readonly current?: IBaseHalfNodeCurrent;
	readonly recipe?: IBaseHalfNodeRecipe;
	readonly revisions?: readonly IBaseHalfNodeImportedRevision[];
	readonly runs?: readonly IBaseHalfNodeRun[];
}

/**
 * Returns the exact agent-authorable subset of a node document. Examples are
 * built through the production validator so capability publication cannot
 * drift from the document reader.
 */
export function getBaseHalfNodeAgentAuthoringContract(): Readonly<Record<string, BaseHalfNodeJsonValue>> {
	const empty = createBaseHalfNodeDocument({
		id: '6f690fa8-04ab-49c1-a6c8-44df124dedf3',
		kind: 'image',
		title: 'Result',
		role: 'Generated image'
	});
	const configured = createBaseHalfNodeDocument({
		id: '861a9f21-9d06-4ba2-9b0b-24ae31e25870',
		kind: 'image',
		title: 'Result',
		role: 'Generated image',
		recipe: {
			recipeId: 'replace-with-installed-recipe-id',
			parameters: {},
			inputBindings: [{ sourcePath: 'brief.md', slot: 'replace-with-declared-slot', order: 0 }]
		}
	});
	const validatedExample = (document: IBaseHalfNodeDocument): BaseHalfNodeJsonValue =>
		JSON.parse(serializeBaseHalfNodeDocument(document)) as BaseHalfNodeJsonValue;
	return Object.freeze({
		contractVersion: 1,
		schema: {
			'$schema': 'https://json-schema.org/draft/2020-12/schema',
			type: 'object',
			additionalProperties: false,
			required: ['version', 'id', 'kind', 'title', 'role', 'current', 'revisions', 'runs'],
			properties: {
				version: { const: BASEHALF_NODE_DOCUMENT_VERSION },
				id: { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', minLength: 36, maxLength: 36 },
				kind: { enum: [...NODE_KINDS] },
				title: { type: 'string', minLength: 1, maxLength: MAX_TITLE_LENGTH },
				role: { type: 'string', minLength: 1, maxLength: MAX_ROLE_LENGTH },
				current: {
					type: 'object',
					additionalProperties: false,
					required: ['source', 'outputPaths'],
					properties: { source: { const: 'empty' }, outputPaths: { type: 'array', maxItems: 0 } }
				},
				recipe: {
					type: 'object',
					additionalProperties: false,
					required: ['recipeId', 'parameters', 'inputBindings'],
					properties: {
						recipeId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$', maxLength: MAX_ID_LENGTH },
						modelServiceId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$', maxLength: MAX_ID_LENGTH },
						modelId: { type: 'string', maxLength: MAX_MODEL_ID_LENGTH },
						parameters: { type: 'object' },
						inputBindings: {
							type: 'array',
							maxItems: MAX_BINDINGS,
							items: {
								type: 'object',
								additionalProperties: false,
								required: ['sourcePath', 'slot', 'order'],
								properties: {
									sourcePath: { type: 'string', minLength: 1, maxLength: MAX_PATH_LENGTH, format: 'basehalf-project-relative-path' },
									slot: { type: 'string', minLength: 1, maxLength: MAX_SLOT_LENGTH },
									order: { type: 'integer', minimum: 0, maximum: MAX_BINDINGS - 1 }
								}
							}
						}
					}
				},
				revisions: { type: 'array', maxItems: 0 },
				runs: { type: 'array', maxItems: 0 }
			}
		},
		examples: {
			empty: validatedExample(empty),
			configured: validatedExample(configured)
		},
		hostOwnedFields: ['current', 'revisions', 'runs'],
		rules: [
			'Use only recipe, slot, parameter, and model service ids published for the open workspace.',
			'Create reciprocal context references separately; each recipe binding must match one direct inbound reference.',
			'Never author generated lifecycle state.'
		]
	});
}

export interface IBeginBaseHalfNodeRunOptions {
	readonly id: string;
	readonly createdAt: string;
	readonly startedAt: string;
	readonly model: BaseHalfNodeRunModel;
	readonly inputs: readonly IBaseHalfNodeRunInput[];
}

export interface ICompleteBaseHalfNodeRunOptions {
	readonly completedAt: string;
	readonly artifacts: readonly IBaseHalfNodeRunArtifact[];
	readonly primaryArtifactId: string;
	readonly providerRequestId?: string;
	readonly usage?: IBaseHalfNodeRunUsage;
	readonly cost?: IBaseHalfNodeRunCost;
	/** Defaults to true. A false value records an accepted result without replacing Current. */
	readonly selectCurrent?: boolean;
}

export interface IFailBaseHalfNodeRunOptions {
	readonly completedAt: string;
	readonly error: string;
	readonly artifacts?: readonly IBaseHalfNodeRunArtifact[];
	readonly primaryArtifactId?: string;
	readonly providerRequestId?: string;
	readonly usage?: IBaseHalfNodeRunUsage;
	readonly cost?: IBaseHalfNodeRunCost;
}

export interface ICancelBaseHalfNodeRunOptions {
	readonly completedAt: string;
	readonly error?: string;
	readonly artifacts?: readonly IBaseHalfNodeRunArtifact[];
	readonly primaryArtifactId?: string;
	readonly providerRequestId?: string;
	readonly usage?: IBaseHalfNodeRunUsage;
	readonly cost?: IBaseHalfNodeRunCost;
}

export interface IInterruptBaseHalfNodeRunOptions {
	readonly completedAt?: string;
	readonly error?: string;
}

export interface IBaseHalfNodeReadinessContext {
	/** Omit to perform structural readiness checks only. */
	readonly availableModelServiceIds?: readonly string[];
	/** Omit when direct source availability has not been resolved yet. */
	readonly availableSourcePaths?: readonly string[];
}

export type BaseHalfNodeReadinessCode =
	| 'ready'
	| 'notExecutable'
	| 'busy'
	| 'modelServiceUnavailable'
	| 'sourceUnavailable';

export interface IBaseHalfNodeReadiness {
	readonly ready: boolean;
	readonly code: BaseHalfNodeReadinessCode;
	readonly missingSourcePaths?: readonly string[];
}

export class BaseHalfNodeDocumentError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BaseHalfNodeDocumentError';
	}
}

/**
 * Parses a user-owned node document. Unsupported or malformed data is rejected
 * rather than partially accepted. Persisted lifecycle state is never rewritten
 * in memory: host ownership recovery must first be committed to the document.
 */
export function parseBaseHalfNodeDocument(source: string): IBaseHalfNodeDocument {
	return parseNodeDocumentSource(source);
}

export function parseBaseHalfNodeDocumentBytes(source: Uint8Array): IBaseHalfNodeDocument {
	return parseNodeDocumentSource(decodeNodeDocumentBytes(source));
}

/**
 * Kept as the host-internal spelling at existing call sites. Both readers
 * preserve the exact persisted lifecycle state; the execution owner lease is
 * the sole authority allowed to recover an abandoned run.
 */
export function parseBaseHalfNodeDocumentForActiveHost(source: string): IBaseHalfNodeDocument {
	return parseNodeDocumentSource(source);
}

export function parseBaseHalfNodeDocumentBytesForActiveHost(source: Uint8Array): IBaseHalfNodeDocument {
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
	return normalizeDocument(value, false);
}

/** Serializes a validated document without changing an active in-memory run. */
export function serializeBaseHalfNodeDocument(document: IBaseHalfNodeDocument): string {
	const normalized = normalizeDocument(document, false);
	const serialized = `${JSON.stringify(normalized, null, '\t')}\n`;
	if (utf8ByteLength(serialized) > BASEHALF_NODE_DOCUMENT_MAX_BYTES) {
		throw invalid(`The node document exceeds ${BASEHALF_NODE_DOCUMENT_MAX_BYTES} bytes.`);
	}
	return serialized;
}

/** Creates a validated, deeply frozen v2 document. The caller supplies the stable UUID. */
export function createBaseHalfNodeDocument(options: ICreateBaseHalfNodeDocumentOptions): IBaseHalfNodeDocument {
	return normalizeDocument({
		version: BASEHALF_NODE_DOCUMENT_VERSION,
		id: options.id,
		kind: options.kind,
		title: options.title,
		role: options.role,
		current: options.current ?? { source: 'empty', outputPaths: [] },
		...(options.recipe ? { recipe: options.recipe } : {}),
		revisions: options.revisions ?? [],
		runs: options.runs ?? []
	}, false);
}

/**
 * Creates an independent node from a copied result container. A copy keeps the
 * authored setup, but receives a new stable identity and no inherited
 * connections, Current selection, imports, or run history.
 */
export function forkBaseHalfNodeDocument(document: IBaseHalfNodeDocument, id: string): IBaseHalfNodeDocument {
	const normalized = normalizeDocument(document, false);
	return createBaseHalfNodeDocument({
		id,
		kind: normalized.kind,
		title: normalized.title,
		role: normalized.role,
		...(normalized.recipe ? {
			recipe: {
				...normalized.recipe,
				inputBindings: []
			}
		} : {})
	});
}

/** Starts one explicit run and appends its immutable running record. */
export function beginBaseHalfNodeRun(
	document: IBaseHalfNodeDocument,
	options: IBeginBaseHalfNodeRunOptions
): IBaseHalfNodeDocument {
	const normalized = normalizeDocument(document, false);
	if (!normalized.recipe) {
		throw invalid('A node without a recipe cannot start a run.');
	}
	if (normalized.runs.some(run => run.status === 'running')) {
		throw invalid('The node already has an active run.');
	}
	const id = requiredId(options.id, 'run.id');
	if (normalized.runs.some(run => run.id === id)) {
		throw invalid(`Run '${id}' already exists.`);
	}
	return normalizeDocument({
		...normalized,
		runs: [...normalized.runs, {
			id,
			status: 'running',
			createdAt: options.createdAt,
				startedAt: options.startedAt,
				recipe: normalized.recipe,
				model: options.model,
				inputs: options.inputs,
			artifacts: [],
			outputPaths: []
		}]
	}, false);
}

/** Freezes the provider connection snapshot after the explicit attempt is durable. */
export function freezeBaseHalfNodeRunModel(
	document: IBaseHalfNodeDocument,
	runId: string,
	model: BaseHalfNodeRunModel
): IBaseHalfNodeDocument {
	return replaceRunningRun(document, runId, run => ({ ...run, model }));
}

/** Freezes the direct-input revisions for a running record before its executor can start. */
export function freezeBaseHalfNodeRunInputs(
	document: IBaseHalfNodeDocument,
	runId: string,
	inputs: readonly IBaseHalfNodeRunInput[]
): IBaseHalfNodeDocument {
	return replaceRunningRun(document, runId, run => {
		if (run.inputs.length > 0) {
			throw invalid(`Run '${run.id}' already has frozen inputs.`);
		}
		return { ...run, inputs };
	});
}

/** Completes a running record and selects its output as Current. */
export function completeBaseHalfNodeRun(
	document: IBaseHalfNodeDocument,
	runId: string,
	options: ICompleteBaseHalfNodeRunOptions
): IBaseHalfNodeDocument {
	const completed = replaceRunningRun(document, runId, run => ({
		...run,
		status: 'succeeded',
		completedAt: options.completedAt,
		artifacts: options.artifacts,
		primaryArtifactId: options.primaryArtifactId,
		...(options.providerRequestId !== undefined ? { providerRequestId: options.providerRequestId } : {}),
		...(options.usage !== undefined ? { usage: options.usage } : {}),
		...(options.cost !== undefined ? { cost: options.cost } : {}),
		outputPaths: options.artifacts.map(artifact => artifact.path)
	}));
	return options.selectCurrent === false ? completed : selectBaseHalfNodeCurrent(completed, runId);
}

/** Fails a running record while leaving the previous Current untouched. */
export function failBaseHalfNodeRun(
	document: IBaseHalfNodeDocument,
	runId: string,
	options: IFailBaseHalfNodeRunOptions
): IBaseHalfNodeDocument {
	return replaceRunningRun(document, runId, run => ({
		...run,
		status: 'failed',
		completedAt: options.completedAt,
		artifacts: options.artifacts ?? [],
		...(options.primaryArtifactId !== undefined ? { primaryArtifactId: options.primaryArtifactId } : {}),
		...(options.providerRequestId !== undefined ? { providerRequestId: options.providerRequestId } : {}),
		...(options.usage !== undefined ? { usage: options.usage } : {}),
		...(options.cost !== undefined ? { cost: options.cost } : {}),
		outputPaths: (options.artifacts ?? []).map(artifact => artifact.path),
		error: options.error
	}));
}

/** Cancels a running record while leaving the previous Current untouched. */
export function cancelBaseHalfNodeRun(
	document: IBaseHalfNodeDocument,
	runId: string,
	options: ICancelBaseHalfNodeRunOptions
): IBaseHalfNodeDocument {
	return replaceRunningRun(document, runId, run => ({
		...run,
		status: 'cancelled',
		completedAt: options.completedAt,
		artifacts: options.artifacts ?? [],
		...(options.primaryArtifactId !== undefined ? { primaryArtifactId: options.primaryArtifactId } : {}),
		...(options.providerRequestId !== undefined ? { providerRequestId: options.providerRequestId } : {}),
		...(options.usage !== undefined ? { usage: options.usage } : {}),
		...(options.cost !== undefined ? { cost: options.cost } : {}),
		outputPaths: (options.artifacts ?? []).map(artifact => artifact.path),
		...(options.error !== undefined ? { error: options.error } : {})
	}));
}

/** Records an executor or host interruption without changing Current. */
export function interruptBaseHalfNodeRun(
	document: IBaseHalfNodeDocument,
	runId: string,
	options: IInterruptBaseHalfNodeRunOptions = {}
): IBaseHalfNodeDocument {
	return replaceRunningRun(document, runId, run => ({
		...run,
		status: 'interrupted',
		...(options.completedAt !== undefined ? { completedAt: options.completedAt } : {}),
		...(options.error !== undefined ? { error: options.error } : {})
	}));
}

export function getBaseHalfNodeReadiness(
	document: IBaseHalfNodeDocument,
	context: IBaseHalfNodeReadinessContext = {}
): IBaseHalfNodeReadiness {
	const normalized = normalizeDocument(document, false);
	if (!normalized.recipe) {
		return Object.freeze({ ready: false, code: 'notExecutable' });
	}
	if (normalized.runs.some(run => run.status === 'running')) {
		return Object.freeze({ ready: false, code: 'busy' });
	}

	if (normalized.recipe.modelServiceId && context.availableModelServiceIds) {
		const available = new Set(context.availableModelServiceIds.map(value => value.trim().toLowerCase()));
		if (!available.has(normalized.recipe.modelServiceId.toLowerCase())) {
			return Object.freeze({ ready: false, code: 'modelServiceUnavailable' });
		}
	}

	if (context.availableSourcePaths) {
		const available = new Set(context.availableSourcePaths);
		const missingSourcePaths = [...new Set(normalized.recipe.inputBindings
			.map(binding => binding.sourcePath)
			.filter(sourcePath => !available.has(sourcePath)))];
		if (missingSourcePaths.length) {
			return Object.freeze({
				ready: false,
				code: 'sourceUnavailable',
				missingSourcePaths: Object.freeze(missingSourcePaths)
			});
		}
	}

	return Object.freeze({ ready: true, code: 'ready' });
}

/**
 * Returns whether the selected generated Current is older than the active
 * recipe or the caller-provided direct-input revisions. Imported Current
 * values are never marked stale by execution state.
 */
export function isBaseHalfNodeDocumentStale(
	document: IBaseHalfNodeDocument,
	currentInputs?: readonly IBaseHalfNodeRunInput[]
): boolean {
	const normalized = normalizeDocument(document, false);
	if (normalized.current.source !== 'run' || !normalized.current.runId || !normalized.recipe) {
		return false;
	}
	const selectedRun = normalized.runs.find(run => run.id === normalized.current.runId);
	if (!selectedRun) {
		return false;
	}
	if (!recipesEqual(normalized.recipe, selectedRun.recipe)) {
		return true;
	}
	if (currentInputs === undefined) {
		return false;
	}
	const normalizedInputs = normalizeRunInputs(currentInputs, 'currentInputs');
	return !runInputsEqual(selectedRun.inputs, normalizedInputs);
}

/** Rewrites only the live recipe bindings after an explicit project move. Immutable run history is retained verbatim. */
export function remapBaseHalfNodeRecipeInputBindings(
	document: IBaseHalfNodeDocument,
	fromPath: string,
	toPath: string
): IBaseHalfNodeDocument {
	const normalized = normalizeDocument(document, false);
	if (!normalized.recipe) {
		return document;
	}
	const from = projectPath(fromPath, 'fromPath');
	const to = projectPath(toPath, 'toPath');
	const fromKey = baseHalfProjectPathKey(from);
	let changed = false;
	const inputBindings = normalized.recipe.inputBindings.map(binding => {
		const sourceKey = baseHalfProjectPathKey(binding.sourcePath);
		if (sourceKey !== fromKey && !sourceKey.startsWith(`${fromKey}/`)) {
			return binding;
		}
		changed = true;
		const suffix = binding.sourcePath.slice(from.length);
		return { ...binding, sourcePath: `${to}${suffix}` };
	});
	if (!changed) {
		return document;
	}
	return normalizeDocument({
		...normalized,
		recipe: { ...normalized.recipe, inputBindings }
	}, false);
}

/** Returns whether the live recipe directly references a file or descendant. */
export function baseHalfNodeRecipeReferencesPath(
	document: IBaseHalfNodeDocument,
	path: string
): boolean {
	const normalized = normalizeDocument(document, false);
	const rootKey = baseHalfProjectPathKey(projectPath(path, 'path'));
	return normalized.recipe?.inputBindings.some(binding => {
		const sourceKey = baseHalfProjectPathKey(binding.sourcePath);
		return sourceKey === rootKey || sourceKey.startsWith(`${rootKey}/`);
	}) ?? false;
}

/** Removes only live recipe bindings whose source was explicitly deleted. */
export function removeBaseHalfNodeRecipeInputBindings(
	document: IBaseHalfNodeDocument,
	deletedPath: string
): IBaseHalfNodeDocument {
	const normalized = normalizeDocument(document, false);
	if (!normalized.recipe) {
		return document;
	}
	const rootKey = baseHalfProjectPathKey(projectPath(deletedPath, 'deletedPath'));
	const retained = normalized.recipe.inputBindings.filter(binding => {
		const sourceKey = baseHalfProjectPathKey(binding.sourcePath);
		return sourceKey !== rootKey && !sourceKey.startsWith(`${rootKey}/`);
	});
	if (retained.length === normalized.recipe.inputBindings.length) {
		return document;
	}
	const inputBindings = retained.map((binding, order) => ({ ...binding, order }));
	return normalizeDocument({
		...normalized,
		recipe: { ...normalized.recipe, inputBindings }
	}, false);
}

/** Selects a successful historical run as Current without changing History. */
export function selectBaseHalfNodeCurrent(document: IBaseHalfNodeDocument, versionId: string): IBaseHalfNodeDocument {
	const normalized = normalizeDocument(document, false);
	const normalizedRunId = requiredId(versionId, 'versionId');
	const run = normalized.runs.find(candidate => candidate.id === normalizedRunId);
	if (run) {
		if (run.status !== 'succeeded') {
			throw invalid(`Run '${normalizedRunId}' is not successful and cannot become Current.`);
		}
		return freezeDocument({
			...normalized,
			current: freezeCurrent({
				source: 'run',
				runId: run.id,
				outputPaths: run.outputPaths
			})
		});
	}
	const revision = normalized.revisions.find(candidate => candidate.id === normalizedRunId);
	if (!revision) {
		throw invalid(`Version '${normalizedRunId}' does not exist.`);
	}
	return freezeDocument({
		...normalized,
		current: freezeCurrent({
			source: 'imported',
			revisionId: revision.id,
			outputPaths: revision.artifacts.map(artifact => artifact.path)
		})
	});
}

/** Appends one immutable imported revision and selects it as Current. */
export function importBaseHalfNodeCurrent(document: IBaseHalfNodeDocument, revision: IBaseHalfNodeImportedRevision): IBaseHalfNodeDocument {
	const normalized = normalizeDocument(document, false);
	const next = normalizeDocument({
		...normalized,
		revisions: [...normalized.revisions, revision]
	}, false);
	return selectBaseHalfNodeCurrent(next, revision.id);
}

/** Returns the immutable artifacts selected by a generated or imported Current. */
export function getBaseHalfNodeCurrentArtifacts(document: IBaseHalfNodeDocument): readonly IBaseHalfNodeRunArtifact[] {
	const normalized = normalizeDocument(document, false);
	if (normalized.current.source === 'run' && normalized.current.runId) {
		return normalized.runs.find(run => run.id === normalized.current.runId)?.artifacts ?? Object.freeze([]);
	}
	if (normalized.current.source === 'imported' && normalized.current.revisionId) {
		return normalized.revisions.find(revision => revision.id === normalized.current.revisionId)?.artifacts ?? Object.freeze([]);
	}
	return Object.freeze([]);
}

/** Returns the exact accepted artifact used as the generated or imported Current. */
export function getBaseHalfNodeCurrentPrimaryArtifact(document: IBaseHalfNodeDocument): IBaseHalfNodeRunArtifact | undefined {
	const normalized = normalizeDocument(document, false);
	if (normalized.current.source === 'run' && normalized.current.runId) {
		const run = normalized.runs.find(candidate => candidate.id === normalized.current.runId);
		return run?.artifacts.find(artifact => artifact.id === run.primaryArtifactId);
	}
	if (normalized.current.source === 'imported' && normalized.current.revisionId) {
		const revision = normalized.revisions.find(candidate => candidate.id === normalized.current.revisionId);
		return revision?.artifacts.find(artifact => artifact.id === revision.primaryArtifactId);
	}
	return undefined;
}

function replaceRunningRun(
	document: IBaseHalfNodeDocument,
	runId: string,
	update: (run: IBaseHalfNodeRun) => IBaseHalfNodeRun
): IBaseHalfNodeDocument {
	const normalized = normalizeDocument(document, false);
	const normalizedRunId = requiredId(runId, 'runId');
	const index = normalized.runs.findIndex(run => run.id === normalizedRunId);
	if (index < 0) {
		throw invalid(`Run '${normalizedRunId}' does not exist.`);
	}
	if (normalized.runs[index].status !== 'running') {
		throw invalid(`Run '${normalizedRunId}' is not running.`);
	}
	const runs = [...normalized.runs];
	runs[index] = update(normalized.runs[index]);
	return normalizeDocument({ ...normalized, runs }, false);
}

function normalizeDocument(value: unknown, recoverRunning: boolean): IBaseHalfNodeDocument {
	const candidate = record(value, 'document');
	assertOnlyKeys(candidate, ['version', 'id', 'kind', 'title', 'role', 'current', 'recipe', 'revisions', 'runs'], 'document');
	if (candidate.version !== BASEHALF_NODE_DOCUMENT_VERSION) {
		throw invalid(`Unsupported node document version '${String(candidate.version)}'.`);
	}

	const id = requiredNodeDocumentId(candidate.id);
	const kind = oneOf(candidate.kind, NODE_KINDS, 'document.kind');
	const title = requiredString(candidate.title, MAX_TITLE_LENGTH, 'document.title');
	const role = requiredString(candidate.role, MAX_ROLE_LENGTH, 'document.role');
	const recipe = candidate.recipe === undefined ? undefined : normalizeRecipe(candidate.recipe, 'document.recipe');
	const revisionsValue = array(candidate.revisions, 'document.revisions', BASEHALF_NODE_MAX_REVISIONS);
	const revisions = revisionsValue.map((revision, index) => normalizeImportedRevision(revision, `document.revisions[${index}]`));
	assertUnique(revisions.map(revision => revision.id), 'document.revisions ids');
	const runsValue = array(candidate.runs, 'document.runs', BASEHALF_NODE_MAX_RUNS);
	const runs = runsValue.map((run, index) => normalizeRun(run, `document.runs[${index}]`, recoverRunning));
	assertUnique(runs.map(run => run.id), 'document.runs ids');
	assertUnique([...revisions.map(revision => revision.id), ...runs.map(run => run.id)], 'document version ids');
	if (runsValue.filter(run => hasRunStatus(run, 'running')).length > 1) {
		throw invalid('document.runs cannot contain more than one active run.');
	}
	const current = normalizeCurrent(candidate.current, 'document.current');
	for (const run of runs) {
		if (run.status !== 'succeeded') {
			continue;
		}
		const primary = run.artifacts.find(artifact => artifact.id === run.primaryArtifactId);
		if (primary?.kind !== kind) {
			throw invalid(`Run '${run.id}' primary artifact must match document.kind '${kind}'.`);
		}
	}
	for (const revision of revisions) {
		const primary = revision.artifacts.find(artifact => artifact.id === revision.primaryArtifactId);
		if (primary?.kind !== kind) {
			throw invalid(`Revision '${revision.id}' primary artifact must match document.kind '${kind}'.`);
		}
	}

	if (current.source === 'run') {
		const selectedRun = runs.find(run => run.id === current.runId);
		if (!selectedRun || selectedRun.status !== 'succeeded') {
			throw invalid('document.current must point to a successful run.');
		}
		if (!stringArraysEqual(current.outputPaths, selectedRun.outputPaths)) {
			throw invalid('document.current content must match its selected run output.');
		}
	}
	if (current.source === 'imported') {
		const selectedRevision = revisions.find(revision => revision.id === current.revisionId);
		if (!selectedRevision) {
			throw invalid('document.current must point to an imported revision.');
		}
		if (!stringArraysEqual(current.outputPaths, selectedRevision.artifacts.map(artifact => artifact.path))) {
			throw invalid('document.current content must match its selected imported revision.');
		}
	}

	return freezeDocument({
		version: BASEHALF_NODE_DOCUMENT_VERSION,
		id,
		kind,
		title,
		role,
		current,
		...(recipe ? { recipe } : {}),
		revisions: Object.freeze(revisions),
		runs: Object.freeze(runs)
	});
}

function normalizeCurrent(value: unknown, path: string): IBaseHalfNodeCurrent {
	const candidate = record(value, path);
	assertOnlyKeys(candidate, ['source', 'runId', 'revisionId', 'outputPaths'], path);
	const source = oneOf(candidate.source, CURRENT_SOURCES, `${path}.source`);
	const runId = candidate.runId === undefined ? undefined : requiredId(candidate.runId, `${path}.runId`);
	const revisionId = candidate.revisionId === undefined ? undefined : requiredId(candidate.revisionId, `${path}.revisionId`);
	const outputPaths = normalizeProjectPaths(candidate.outputPaths, `${path}.outputPaths`);

	if (source === 'empty' && (runId !== undefined || revisionId !== undefined || outputPaths.length)) {
		throw invalid(`${path} with source 'empty' cannot contain content.`);
	}
	if (source === 'run' && runId === undefined) {
		throw invalid(`${path} with source 'run' requires runId.`);
	}
	if (source !== 'run' && runId !== undefined) {
		throw invalid(`${path}.runId is only valid when source is 'run'.`);
	}
	if (source === 'imported' && revisionId === undefined) {
		throw invalid(`${path} with source 'imported' requires revisionId.`);
	}
	if (source !== 'imported' && revisionId !== undefined) {
		throw invalid(`${path}.revisionId is only valid when source is 'imported'.`);
	}
	return freezeCurrent({
		source,
		...(runId !== undefined ? { runId } : {}),
		...(revisionId !== undefined ? { revisionId } : {}),
		outputPaths
	});
}

function normalizeImportedRevision(value: unknown, path: string): IBaseHalfNodeImportedRevision {
	const candidate = record(value, path);
	assertOnlyKeys(candidate, ['id', 'source', 'createdAt', 'artifacts', 'primaryArtifactId'], path);
	const id = requiredId(candidate.id, `${path}.id`);
	if (candidate.source !== 'imported') {
		throw invalid(`${path}.source must be 'imported'.`);
	}
	const createdAt = timestamp(candidate.createdAt, `${path}.createdAt`);
	const artifacts = normalizeRunArtifacts(candidate.artifacts, `${path}.artifacts`);
	const primaryArtifactId = requiredId(candidate.primaryArtifactId, `${path}.primaryArtifactId`);
	if (artifacts.length === 0 || !artifacts.some(artifact => artifact.id === primaryArtifactId)) {
		throw invalid(`${path} requires a valid primaryArtifactId.`);
	}
	return freezeRevision({ id, source: 'imported', createdAt, artifacts, primaryArtifactId });
}

function normalizeRecipe(value: unknown, path: string): IBaseHalfNodeRecipe {
	const candidate = record(value, path);
	assertOnlyKeys(candidate, ['recipeId', 'modelServiceId', 'modelId', 'parameters', 'inputBindings'], path);
	const recipeId = requiredId(candidate.recipeId, `${path}.recipeId`);
	const modelServiceId = candidate.modelServiceId === undefined ? undefined : requiredId(candidate.modelServiceId, `${path}.modelServiceId`);
	const modelId = candidate.modelId === undefined ? undefined : auditIdentifier(candidate.modelId, MAX_MODEL_ID_LENGTH, `${path}.modelId`);
	if (modelId !== undefined && modelServiceId === undefined) {
		throw invalid(`${path}.modelId requires modelServiceId.`);
	}
	const parameters = normalizeParameters(candidate.parameters, `${path}.parameters`);
	const inputBindingsValue = array(candidate.inputBindings, `${path}.inputBindings`, MAX_BINDINGS);
	const inputBindings = inputBindingsValue
		.map((binding, index) => normalizeBinding(binding, `${path}.inputBindings[${index}]`))
		.sort((left, right) => left.order - right.order);
	validateBindingSet(inputBindings, `${path}.inputBindings`);
	return Object.freeze({
		recipeId,
		...(modelServiceId !== undefined ? { modelServiceId } : {}),
		...(modelId !== undefined ? { modelId } : {}),
		parameters,
		inputBindings: Object.freeze(inputBindings)
	});
}

function normalizeRun(value: unknown, path: string, recoverRunning: boolean): IBaseHalfNodeRun {
	const candidate = record(value, path);
	assertOnlyKeys(candidate, ['id', 'status', 'createdAt', 'startedAt', 'completedAt', 'recipe', 'model', 'inputs', 'artifacts', 'primaryArtifactId', 'providerRequestId', 'usage', 'cost', 'outputPaths', 'error'], path);
	const id = requiredId(candidate.id, `${path}.id`);
	const persistedStatus = oneOf(candidate.status, RUN_STATUSES, `${path}.status`);
	const createdAt = timestamp(candidate.createdAt, `${path}.createdAt`);
	const startedAt = candidate.startedAt === undefined ? undefined : timestamp(candidate.startedAt, `${path}.startedAt`);
	const completedAt = candidate.completedAt === undefined ? undefined : timestamp(candidate.completedAt, `${path}.completedAt`);
	const recipe = normalizeRecipe(candidate.recipe, `${path}.recipe`);
	const model = normalizeRunModel(candidate.model, `${path}.model`);
	validateRunModelRecipe(model, recipe, path);
	const inputs = normalizeRunInputs(candidate.inputs, `${path}.inputs`);
	// The host lands a running record before fallible input preparation. An
	// empty list therefore records that preparation never finished; once
	// present, inputs must exactly match the immutable recipe snapshot.
	if (inputs.length > 0 && !bindingsEqual(recipe.inputBindings, inputs)) {
		throw invalid(`${path}.inputs must match the run recipe input bindings.`);
	}
	if (persistedStatus === 'succeeded' && !bindingsEqual(recipe.inputBindings, inputs)) {
		throw invalid(`${path}.inputs must match the run recipe input bindings.`);
	}
	const artifacts = normalizeRunArtifacts(candidate.artifacts, `${path}.artifacts`);
	const primaryArtifactId = candidate.primaryArtifactId === undefined ? undefined : requiredId(candidate.primaryArtifactId, `${path}.primaryArtifactId`);
	const providerRequestId = candidate.providerRequestId === undefined ? undefined : auditIdentifier(candidate.providerRequestId, MAX_ID_LENGTH, `${path}.providerRequestId`);
	const usage = candidate.usage === undefined ? undefined : normalizeRunUsage(candidate.usage, `${path}.usage`);
	const cost = candidate.cost === undefined ? undefined : normalizeRunCost(candidate.cost, `${path}.cost`);
	const outputPaths = normalizeProjectPaths(candidate.outputPaths, `${path}.outputPaths`);
	const error = candidate.error === undefined ? undefined : requiredString(candidate.error, MAX_MESSAGE_LENGTH, `${path}.error`);

	validateRunLifecycle(persistedStatus, { createdAt, startedAt, completedAt, outputPaths, artifacts, primaryArtifactId, providerRequestId, usage, cost, error }, path);
	if (persistedStatus === 'succeeded' && model.source === 'service' && model.connection !== 'resolved') {
		throw invalid(`${path} successful runs require a resolved model connection.`);
	}
	const status: BaseHalfNodeRunStatus = recoverRunning && persistedStatus === 'running' ? 'interrupted' : persistedStatus;

	return freezeRun({
		id,
		status,
		createdAt,
		...(startedAt !== undefined ? { startedAt } : {}),
		...(completedAt !== undefined ? { completedAt } : {}),
		recipe,
		model,
		inputs,
		artifacts,
		...(primaryArtifactId !== undefined ? { primaryArtifactId } : {}),
		...(providerRequestId !== undefined ? { providerRequestId } : {}),
		...(usage !== undefined ? { usage } : {}),
		...(cost !== undefined ? { cost } : {}),
		outputPaths,
		...(error !== undefined ? { error } : {})
	});
}

function normalizeRunModel(value: unknown, path: string): BaseHalfNodeRunModel {
	const candidate = record(value, path);
	const source = candidate.source;
	if (source === 'local') {
		assertOnlyKeys(candidate, ['source'], path);
		return Object.freeze({ source: 'local' });
	}
	if (source !== 'service') {
		throw invalid(`${path}.source must be 'local' or 'service'.`);
	}
	const connection = oneOf(candidate.connection, ['resolved', 'unavailable'] as const, `${path}.connection`);
	if (connection === 'unavailable') {
		assertOnlyKeys(candidate, ['source', 'connection', 'serviceId', 'capability', 'modelId'], path);
		return Object.freeze({
			source: 'service',
			connection,
			...(candidate.serviceId === undefined ? {} : { serviceId: requiredId(candidate.serviceId, `${path}.serviceId`) }),
			capability: oneOf(candidate.capability, MODEL_CAPABILITIES, `${path}.capability`),
			...(candidate.modelId === undefined ? {} : { modelId: auditIdentifier(candidate.modelId, MAX_MODEL_ID_LENGTH, `${path}.modelId`) })
		});
	}
	assertOnlyKeys(candidate, ['source', 'connection', 'serviceId', 'serviceLabel', 'connectionIdentity', 'capability', 'modelId'], path);
	const connectionIdentity = requiredString(candidate.connectionIdentity, 80, `${path}.connectionIdentity`);
	if (!/^sha256:[A-Za-z0-9_-]{43}$/.test(connectionIdentity)) {
		throw invalid(`${path}.connectionIdentity must be a SHA-256 connection identity.`);
	}
	return Object.freeze({
		source: 'service',
		connection,
		serviceId: requiredId(candidate.serviceId, `${path}.serviceId`),
		serviceLabel: auditText(candidate.serviceLabel, 80, `${path}.serviceLabel`),
		connectionIdentity,
		capability: oneOf(candidate.capability, MODEL_CAPABILITIES, `${path}.capability`),
		...(candidate.modelId === undefined ? {} : { modelId: auditIdentifier(candidate.modelId, MAX_MODEL_ID_LENGTH, `${path}.modelId`) })
	});
}

function validateRunModelRecipe(model: BaseHalfNodeRunModel, recipe: IBaseHalfNodeRecipe, path: string): void {
	if (model.source === 'local') {
		if (recipe.modelServiceId !== undefined || recipe.modelId !== undefined) {
			throw invalid(`${path}.model must identify the recipe's configured model service.`);
		}
		return;
	}
	if ((recipe.modelServiceId?.toLowerCase() ?? undefined) !== (model.serviceId?.toLowerCase() ?? undefined) || recipe.modelId !== model.modelId) {
		throw invalid(`${path}.model must identify the recipe's configured model service and model.`);
	}
}

function normalizeRunUsage(value: unknown, path: string): IBaseHalfNodeRunUsage {
	const candidate = record(value, path);
	const keys = ['inputTokens', 'outputTokens', 'cachedInputTokens', 'images', 'videoSeconds', 'audioSeconds'] as const;
	assertOnlyKeys(candidate, keys, path);
	const result: Record<string, number> = {};
	for (const key of keys) {
		const raw = candidate[key];
		if (raw === undefined) {
			continue;
		}
		result[key] = key.endsWith('Seconds')
			? finiteNumber(raw, 0, Number.MAX_SAFE_INTEGER, `${path}.${key}`)
			: integer(raw, 0, Number.MAX_SAFE_INTEGER, `${path}.${key}`);
	}
	if (Object.keys(result).length === 0) {
		throw invalid(`${path} must contain at least one usage value.`);
	}
	return Object.freeze(result);
}

function normalizeRunCost(value: unknown, path: string): IBaseHalfNodeRunCost {
	const candidate = record(value, path);
	assertOnlyKeys(candidate, ['currency', 'amount', 'kind'], path);
	const currency = requiredString(candidate.currency, 3, `${path}.currency`);
	if (!/^[A-Z]{3}$/.test(currency)) {
		throw invalid(`${path}.currency must use three uppercase letters.`);
	}
	const amount = requiredString(candidate.amount, MAX_COST_AMOUNT_LENGTH, `${path}.amount`);
	if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,9})?$/.test(amount)) {
		throw invalid(`${path}.amount must be a canonical non-negative decimal string.`);
	}
	return Object.freeze({
		currency,
		amount,
		kind: oneOf(candidate.kind, COST_KINDS, `${path}.kind`)
	});
}

function normalizeRunArtifacts(value: unknown, path: string): readonly IBaseHalfNodeRunArtifact[] {
	const values = array(value, path, MAX_OUTPUT_PATHS);
	const artifacts = values.map((entry, index) => {
		const artifactPath = `${path}[${index}]`;
		const candidate = record(entry, artifactPath);
		assertOnlyKeys(candidate, ['id', 'outputId', 'kind', 'path', 'sha256', 'size', 'label'], artifactPath);
		const sha256 = requiredString(candidate.sha256, 64, `${artifactPath}.sha256`);
		if (!/^[A-Za-z0-9_-]{43}$/.test(sha256)) {
			throw invalid(`${artifactPath}.sha256 must be an unpadded Base64 SHA-256 digest.`);
		}
		return Object.freeze({
			id: requiredId(candidate.id, `${artifactPath}.id`),
			outputId: requiredId(candidate.outputId, `${artifactPath}.outputId`),
			kind: oneOf(candidate.kind, ARTIFACT_KINDS, `${artifactPath}.kind`),
			path: projectPath(candidate.path, `${artifactPath}.path`),
			sha256,
			size: integer(candidate.size, 0, Number.MAX_SAFE_INTEGER, `${artifactPath}.size`),
			...(candidate.label === undefined ? {} : { label: requiredString(candidate.label, 160, `${artifactPath}.label`) })
		});
	});
	assertUnique(artifacts.map(artifact => artifact.id), `${path} ids`);
	assertUnique(artifacts.map(artifact => baseHalfProjectPathKey(artifact.path)), `${path} paths`);
	return Object.freeze(artifacts);
}

function normalizeRunInputs(value: unknown, path: string): readonly IBaseHalfNodeRunInput[] {
	const values = array(value, path, MAX_BINDINGS);
	const inputs = values.map((input, index) => {
		const inputPath = `${path}[${index}]`;
		const candidate = record(input, inputPath);
		assertOnlyKeys(candidate, ['sourcePath', 'slot', 'order', 'revision'], inputPath);
		const binding = normalizeBinding(candidate, inputPath, true);
		return Object.freeze({
			...binding,
			revision: requiredString(candidate.revision, MAX_INPUT_REVISION_LENGTH, `${inputPath}.revision`)
		});
	}).sort((left, right) => left.order - right.order);
	validateBindingSet(inputs, path);
	return Object.freeze(inputs);
}

function normalizeBinding(value: unknown, path: string, allowRevision = false): IBaseHalfNodeInputBinding {
	const candidate = record(value, path);
	assertOnlyKeys(candidate, allowRevision ? ['sourcePath', 'slot', 'order', 'revision'] : ['sourcePath', 'slot', 'order'], path);
	return Object.freeze({
		sourcePath: projectPath(candidate.sourcePath, `${path}.sourcePath`),
		slot: requiredString(candidate.slot, MAX_SLOT_LENGTH, `${path}.slot`),
		order: integer(candidate.order, 0, MAX_BINDINGS - 1, `${path}.order`)
	});
}

function normalizeProjectPaths(value: unknown, path: string): readonly string[] {
	const values = array(value, path, MAX_OUTPUT_PATHS);
	const result = values.map((candidate, index) => projectPath(candidate, `${path}[${index}]`));
	assertUnique(result.map(baseHalfProjectPathKey), path);
	return Object.freeze(result);
}

function normalizeParameters(value: unknown, path: string): Readonly<Record<string, BaseHalfNodeJsonValue>> {
	const candidate = record(value, path);
	const budget = { nodes: MAX_JSON_NODES };
	const result = normalizeJsonObject(candidate, path, 0, budget);
	return deepFreezeJson(result) as Readonly<Record<string, BaseHalfNodeJsonValue>>;
}

function normalizeJsonValue(value: unknown, path: string, depth: number, budget: { nodes: number }): BaseHalfNodeJsonValue {
	consumeJsonBudget(budget, path);
	if (value === null || typeof value === 'boolean') {
		return value;
	}
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) {
			throw invalid(`${path} must contain only finite numbers.`);
		}
		return value;
	}
	if (typeof value === 'string') {
		return boundedString(value, MAX_JSON_STRING_LENGTH, path);
	}
	if (depth >= MAX_JSON_DEPTH) {
		throw invalid(`${path} exceeds the maximum JSON nesting depth.`);
	}
	if (Array.isArray(value)) {
		if (value.length > MAX_JSON_COLLECTION_SIZE) {
			throw invalid(`${path} contains too many items.`);
		}
		return Object.freeze(value.map((item, index) => normalizeJsonValue(item, `${path}[${index}]`, depth + 1, budget)));
	}
	return normalizeJsonObject(record(value, path), path, depth + 1, budget);
}

function normalizeJsonObject(value: Record<string, unknown>, path: string, depth: number, budget: { nodes: number }): Readonly<Record<string, BaseHalfNodeJsonValue>> {
	consumeJsonBudget(budget, path);
	const entries = Object.entries(value);
	if (entries.length > MAX_JSON_COLLECTION_SIZE) {
		throw invalid(`${path} contains too many properties.`);
	}
	const result: Record<string, BaseHalfNodeJsonValue> = {};
	for (const [key, candidate] of entries.sort(([a], [b]) => a.localeCompare(b))) {
		if (!key || key.length > MAX_JSON_KEY_LENGTH || key === '__proto__' || key === 'prototype' || key === 'constructor') {
			throw invalid(`${path} contains an invalid property name.`);
		}
		result[key] = normalizeJsonValue(candidate, `${path}.${key}`, depth, budget);
	}
	return Object.freeze(result);
}

function validateRunLifecycle(
	status: BaseHalfNodeRunStatus,
	value: Pick<IBaseHalfNodeRun, 'createdAt' | 'startedAt' | 'completedAt' | 'outputPaths' | 'artifacts' | 'primaryArtifactId' | 'providerRequestId' | 'usage' | 'cost' | 'error'>,
	path: string
): void {
	const created = Date.parse(value.createdAt);
	const started = value.startedAt === undefined ? undefined : Date.parse(value.startedAt);
	const completed = value.completedAt === undefined ? undefined : Date.parse(value.completedAt);
	if (started !== undefined && started < created) {
		throw invalid(`${path}.startedAt cannot precede createdAt.`);
	}
	if (completed !== undefined && completed < (started ?? created)) {
		throw invalid(`${path}.completedAt cannot precede the run start.`);
	}

	if (status === 'running' && (value.startedAt === undefined || value.completedAt !== undefined)) {
		throw invalid(`${path} running runs require startedAt and cannot have completedAt.`);
	}
	if ((status === 'succeeded' || status === 'failed') && (value.startedAt === undefined || value.completedAt === undefined)) {
		throw invalid(`${path} ${status} runs require startedAt and completedAt.`);
	}
	if (status === 'cancelled' && value.completedAt === undefined) {
		throw invalid(`${path} cancelled runs require completedAt.`);
	}
	if (status === 'interrupted' && value.startedAt === undefined) {
		throw invalid(`${path} interrupted runs require startedAt.`);
	}
	if (status === 'succeeded' && value.artifacts.length === 0) {
		throw invalid(`${path} successful runs require a file artifact.`);
	}
	if (value.artifacts.length > 0) {
		const primary = value.artifacts.find(artifact => artifact.id === value.primaryArtifactId);
		if (!primary) {
			throw invalid(`${path} runs with accepted artifacts require a valid primaryArtifactId.`);
		}
		if (!stringArraysEqual(value.outputPaths, value.artifacts.map(artifact => artifact.path))) {
			throw invalid(`${path}.outputPaths must match the accepted artifact paths.`);
		}
	} else if (value.primaryArtifactId !== undefined || value.outputPaths.length > 0) {
		throw invalid(`${path} runs without accepted artifacts cannot name a primary artifact or output path.`);
	}
	if (status === 'running' && (value.artifacts.length > 0 || value.providerRequestId !== undefined || value.usage !== undefined || value.cost !== undefined)) {
		throw invalid(`${path} running runs cannot contain accepted output or a completed provider disclosure.`);
	}
	if (status === 'failed' && value.error === undefined) {
		throw invalid(`${path} failed runs require an error message.`);
	}
	if ((status === 'running' || status === 'succeeded') && value.error !== undefined) {
		throw invalid(`${path} ${status} runs cannot contain an error message.`);
	}
}

function validateBindingSet(bindings: readonly IBaseHalfNodeInputBinding[], path: string): void {
	assertUnique(bindings.map(binding => String(binding.order)), `${path} orders`);
	assertUnique(bindings.map(binding => baseHalfProjectPathKey(binding.sourcePath)), `${path} source paths`);
}

function bindingsEqual(left: readonly IBaseHalfNodeInputBinding[], right: readonly IBaseHalfNodeInputBinding[]): boolean {
	return left.length === right.length && left.every((binding, index) => {
		const candidate = right[index];
		return binding.sourcePath === candidate.sourcePath && binding.slot === candidate.slot && binding.order === candidate.order;
	});
}

function recipesEqual(left: IBaseHalfNodeRecipe, right: IBaseHalfNodeRecipe): boolean {
	return left.recipeId === right.recipeId
		&& left.modelServiceId === right.modelServiceId
		&& left.modelId === right.modelId
		&& bindingsEqual(left.inputBindings, right.inputBindings)
		&& JSON.stringify(left.parameters) === JSON.stringify(right.parameters);
}

function runInputsEqual(left: readonly IBaseHalfNodeRunInput[], right: readonly IBaseHalfNodeRunInput[]): boolean {
	return bindingsEqual(left, right)
		&& left.every((input, index) => input.revision === right[index].revision);
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw invalid(`${path} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function hasRunStatus(value: unknown, status: BaseHalfNodeRunStatus): boolean {
	return !!value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).status === status;
}

function array(value: unknown, path: string, maxLength: number): readonly unknown[] {
	if (!Array.isArray(value)) {
		throw invalid(`${path} must be an array.`);
	}
	if (value.length > maxLength) {
		throw invalid(`${path} contains too many items.`);
	}
	return value;
}

function requiredId(value: unknown, path: string): string {
	const result = requiredString(value, MAX_ID_LENGTH, path);
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) {
		throw invalid(`${path} contains unsupported characters.`);
	}
	return result;
}

function requiredNodeDocumentId(value: unknown): string {
	const result = requiredString(value, 36, 'document.id');
	if (!isUUID(result) || result !== result.toLowerCase()) {
		throw invalid('document.id must be a canonical lowercase UUID.');
	}
	return result;
}

function requiredString(value: unknown, maxLength: number, path: string): string {
	const result = boundedString(value, maxLength, path).trim();
	if (!result) {
		throw invalid(`${path} cannot be empty.`);
	}
	return result;
}

function auditText(value: unknown, maxLength: number, path: string): string {
	const result = requiredString(value, maxLength, path);
	if (/\p{Cc}/u.test(result)) {
		throw invalid(`${path} cannot contain control characters.`);
	}
	return result;
}

function auditIdentifier(value: unknown, maxLength: number, path: string): string {
	const result = requiredString(value, maxLength, path);
	if (!/^[A-Za-z0-9][A-Za-z0-9._:/@+~-]*$/.test(result)) {
		throw invalid(`${path} contains unsupported characters.`);
	}
	return result;
}

function boundedString(value: unknown, maxLength: number, path: string): string {
	if (typeof value !== 'string') {
		throw invalid(`${path} must be a string.`);
	}
	if (value.length > maxLength) {
		throw invalid(`${path} is too long.`);
	}
	if (value.includes('\u0000')) {
		throw invalid(`${path} cannot contain NUL.`);
	}
	return value;
}

function projectPath(value: unknown, path: string): string {
	const result = requiredString(value, MAX_PATH_LENGTH, path);
	const problem = baseHalfProjectPathProblem(result);
	if (problem) {
		throw invalid(`${path} ${problem}`);
	}
	return result;
}

/** Returns a portable, case-insensitive identity key for a validated project path. */
export function baseHalfProjectPathKey(value: string): string {
	return value.normalize('NFC').toLowerCase();
}

/** Describes why a project-relative path cannot safely round-trip across supported hosts. */
export function baseHalfProjectPathProblem(value: string): string | undefined {
	if (value !== value.normalize('NFC')) {
		return 'must use Unicode NFC normalization.';
	}
	if (value.includes('\\') || value.startsWith('/') || /[<>:"|?*\u0000-\u001F\u007F-\u009F]/.test(value) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
		return 'must be a portable project-relative path.';
	}
	const segments = value.split('/');
	if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
		return 'cannot contain empty, current, or parent path segments.';
	}
	if (segments.some(segment => segment.toLowerCase() === '.bh')) {
		return 'cannot target BaseHalf derived workspace metadata.';
	}
	if (segments.some(segment => /[. ]$/.test(segment))) {
		return 'cannot contain a segment ending in a dot or space.';
	}
	if (segments.some(segment => /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment))) {
		return 'cannot contain a reserved device-name segment.';
	}
	return undefined;
}

function timestamp(value: unknown, path: string): string {
	const result = requiredString(value, MAX_TIMESTAMP_LENGTH, path);
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(result) || Number.isNaN(Date.parse(result))) {
		throw invalid(`${path} must be an ISO-8601 timestamp.`);
	}
	return result;
}

function integer(value: unknown, minimum: number, maximum: number, path: string): number {
	if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		throw invalid(`${path} must be an integer between ${minimum} and ${maximum}.`);
	}
	return value as number;
}

function finiteNumber(value: unknown, minimum: number, maximum: number, path: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
		throw invalid(`${path} must be a finite number between ${minimum} and ${maximum}.`);
	}
	return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
	if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
		throw invalid(`${path} must be one of: ${allowed.join(', ')}.`);
	}
	return value as T;
}

function assertOnlyKeys(
	value: Record<string, unknown>,
	allowed: readonly string[],
	path: string
): void {
	const accepted = new Set(allowed);
	const unknown = Object.keys(value).find(key => !accepted.has(key));
	if (unknown) {
		throw invalid(`${path} contains unsupported property '${unknown}'.`);
	}
}

function assertUnique(values: readonly string[], path: string): void {
	if (new Set(values).size !== values.length) {
		throw invalid(`${path} must not contain duplicates.`);
	}
}

function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function consumeJsonBudget(budget: { nodes: number }, path: string): void {
	budget.nodes--;
	if (budget.nodes < 0) {
		throw invalid(`${path} exceeds the maximum parameter complexity.`);
	}
}

function deepFreezeJson(value: BaseHalfNodeJsonValue): BaseHalfNodeJsonValue {
	if (Array.isArray(value)) {
		for (const item of value) {
			deepFreezeJson(item);
		}
		return Object.freeze(value);
	}
	if (value && typeof value === 'object') {
		for (const item of Object.values(value)) {
			deepFreezeJson(item);
		}
		return Object.freeze(value);
	}
	return value;
}

function freezeCurrent(value: IBaseHalfNodeCurrent): IBaseHalfNodeCurrent {
	return Object.freeze({ ...value, outputPaths: Object.freeze([...value.outputPaths]) });
}

function freezeRun(value: IBaseHalfNodeRun): IBaseHalfNodeRun {
	return Object.freeze({
		...value,
		inputs: Object.freeze([...value.inputs]),
		artifacts: Object.freeze([...value.artifacts]),
		outputPaths: Object.freeze([...value.outputPaths])
	});
}

function freezeRevision(value: IBaseHalfNodeImportedRevision): IBaseHalfNodeImportedRevision {
	return Object.freeze({ ...value, artifacts: Object.freeze([...value.artifacts]) });
}

function freezeDocument(value: IBaseHalfNodeDocument): IBaseHalfNodeDocument {
	return Object.freeze({
		...value,
		current: freezeCurrent(value.current),
		revisions: Object.freeze(value.revisions.map(freezeRevision)),
		runs: Object.freeze([...value.runs])
	});
}

function invalid(message: string): BaseHalfNodeDocumentError {
	return new BaseHalfNodeDocumentError(message);
}

function utf8ByteLength(value: string): number {
	return textEncoder.encode(value).byteLength;
}
