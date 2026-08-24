/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { isUUID } from '../../../base/common/uuid.js';

export const BASEHALF_NODE_DOCUMENT_EXTENSION = '.bhnode';
export const BASEHALF_CANVAS_RUN_NODE_COMMAND_ID = 'basehalf.canvas.runNode';
export const BASEHALF_NODE_DOCUMENT_VERSION = 3;
export const BASEHALF_NODE_DOCUMENT_MAX_BYTES = 2 * 1024 * 1024;
export const BASEHALF_NODE_MAX_ID_LENGTH = 128;
export const BASEHALF_NODE_MAX_BINDINGS = 64;
export const BASEHALF_PROJECT_PATH_MAX_LENGTH = 1024;

const MAX_ID_LENGTH = BASEHALF_NODE_MAX_ID_LENGTH;
const MAX_TITLE_LENGTH = 240;
const MAX_ROLE_LENGTH = 120;
export const BASEHALF_NODE_PROMPT_MAX_LENGTH = 64 * 1024;
const MAX_PATH_LENGTH = BASEHALF_PROJECT_PATH_MAX_LENGTH;
const MAX_SLOT_LENGTH = 120;
const MAX_MESSAGE_LENGTH = 16 * 1024;
const MAX_TIMESTAMP_LENGTH = 64;
export const BASEHALF_NODE_MAX_ATTEMPTS = 1024;
const MAX_BINDINGS = BASEHALF_NODE_MAX_BINDINGS;
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

/**
 * Validates an identifier that will be persisted in a `.bhnode` document.
 *
 * Recipe executors are an extension boundary, so their returned artifact ids
 * must obey this same contract before an Attempt can be sealed. Keep this in
 * lockstep with {@link requiredId}, which validates persisted node fields.
 */
export function validateBaseHalfNodePersistentId(value: unknown, path: string): string {
	if (typeof value !== 'string') {
		throw new Error(`${path} must be a string.`);
	}
	if (value.length > BASEHALF_NODE_MAX_ID_LENGTH) {
		throw new Error(`${path} is too long.`);
	}
	if (value.includes('\u0000')) {
		throw new Error(`${path} cannot contain NUL.`);
	}
	const result = value.trim();
	if (!result) {
		throw new Error(`${path} cannot be empty.`);
	}
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) {
		throw new Error(`${path} contains unsupported characters.`);
	}
	return result;
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

const NODE_KINDS = ['file', 'image', 'video', 'audio', 'pdf', 'presentation'] as const;
const ARTIFACT_KINDS = NODE_KINDS;
const RESULT_SOURCES = ['imported', 'attempt'] as const;
const ATTEMPT_STATUSES = ['running', 'succeeded', 'failed', 'cancelled', 'interrupted'] as const;
const MODEL_CAPABILITIES = ['text', 'image', 'video', 'audio'] as const;
const COST_KINDS = ['actual', 'estimated'] as const;
const ATTEMPT_FAILURE_KINDS = [
	'preparation', 'submission-rejected', 'submission-ambiguous', 'remote-id-uncommitted',
	'poll-interrupted', 'poll-window-exhausted', 'remote-failed', 'remote-cancelled',
	'protocol', 'download', 'artifact-invalid', 'artifact-commit', 'execution-ownership'
] as const;
const ATTEMPT_RETRY_POLICIES = ['fresh-submit', 'resume-existing', 'replace-after-terminal-proof', 'blocked'] as const;
const SNAPSHOT_CONTENT_KINDS = ['text', 'code', 'file', 'folder', 'image', 'video', 'audio', 'pdf', 'presentation'] as const;

export type BaseHalfNodeKind = typeof NODE_KINDS[number];
export type BaseHalfNodeArtifactKind = typeof ARTIFACT_KINDS[number];
export type BaseHalfNodeResultSource = typeof RESULT_SOURCES[number];
export type BaseHalfNodeAttemptStatus = typeof ATTEMPT_STATUSES[number];
export type BaseHalfNodeAttemptModelCapability = typeof MODEL_CAPABILITIES[number];
export type BaseHalfNodeAttemptCostKind = typeof COST_KINDS[number];
export type BaseHalfNodeAttemptFailureKind = typeof ATTEMPT_FAILURE_KINDS[number];
export type BaseHalfNodeAttemptRetryPolicy = typeof ATTEMPT_RETRY_POLICIES[number];
export type BaseHalfNodeSnapshotContentKind = typeof SNAPSHOT_CONTENT_KINDS[number];

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
	/** Stable source/result identity captured when the binding is created, when available. */
	readonly sourceId?: string;
	/** Host-computed source revision captured when the binding is created. */
	readonly sourceRevision?: string;
}

export interface IBaseHalfNodeRecipe {
	readonly recipeId: string;
	/** Omitted for deterministic local recipes that need no model connection. */
	readonly modelServiceId?: string;
	/** Optional provider model identifier selected for the first attempt. */
	readonly modelId?: string;
	readonly parameters: Readonly<Record<string, BaseHalfNodeJsonValue>>;
	readonly inputBindings: readonly IBaseHalfNodeInputBinding[];
}

export interface IBaseHalfNodeAttemptInput extends IBaseHalfNodeInputBinding {
	/** Opaque content revision captured by the host when the attempt starts. */
	readonly revision: string;
}

export interface IBaseHalfNodeAttemptLocalModel {
	readonly source: 'local';
}

export interface IBaseHalfNodeAttemptResolvedServiceModel {
	readonly source: 'service';
	readonly connection: 'resolved';
	readonly serviceId: string;
	readonly serviceLabel: string;
	/** SHA-256 identity of non-secret connection settings. The endpoint itself is not project data. */
	readonly connectionIdentity: string;
	readonly capability: BaseHalfNodeAttemptModelCapability;
	readonly modelId?: string;
}

/** A selected model capability whose connection could not be resolved for this attempt. */
export interface IBaseHalfNodeAttemptUnavailableServiceModel {
	readonly source: 'service';
	readonly connection: 'unavailable';
	readonly serviceId?: string;
	readonly capability: BaseHalfNodeAttemptModelCapability;
	readonly modelId?: string;
}

/** Immutable identity of the execution backend selected for one attempt. */
export type BaseHalfNodeAttemptModel = IBaseHalfNodeAttemptLocalModel | IBaseHalfNodeAttemptResolvedServiceModel | IBaseHalfNodeAttemptUnavailableServiceModel;

export interface IBaseHalfNodeAttemptUsage {
	readonly inputTokens?: number;
	readonly outputTokens?: number;
	readonly cachedInputTokens?: number;
	readonly images?: number;
	readonly videoSeconds?: number;
	readonly audioSeconds?: number;
}

export interface IBaseHalfNodeAttemptCost {
	/** Uppercase ISO-style three-letter currency identifier. */
	readonly currency: string;
	/** Canonical non-negative decimal string. */
	readonly amount: string;
	readonly kind: BaseHalfNodeAttemptCostKind;
}

export interface IBaseHalfNodeAttemptFailure {
	readonly kind: BaseHalfNodeAttemptFailureKind;
	readonly retry: BaseHalfNodeAttemptRetryPolicy;
	/** A host-durable id that may be read by recovery. */
	readonly providerRequestId?: string;
	/** An accepted id that was not durably acknowledged and cannot authorize Retry. */
	readonly uncommittedProviderRequestId?: string;
}

export type BaseHalfNodeAttemptExecutionIntent =
	| { readonly kind: 'new' }
	| {
		readonly kind: 'recover';
		readonly providerRequestId: string;
	}
	| {
		readonly kind: 'exact-retry';
		readonly sourceAttemptId: string;
		readonly providerRequestId?: string;
		readonly replacementAuthorized: boolean;
	};

export interface IBaseHalfNodeAttemptExecution {
	readonly requestFingerprint: string;
	readonly intent: BaseHalfNodeAttemptExecutionIntent;
}

export interface IBaseHalfNodeAttemptSnapshotManifestInput {
	readonly edgeId: string;
	readonly slot: string;
	readonly order: number;
	readonly revision: string;
	readonly sourceId: string;
	readonly sourcePath: string;
	readonly sourceKind: BaseHalfNodeSnapshotContentKind;
	readonly snapshotPath: string;
	readonly snapshotDigest: string;
	readonly resultId: string;
	readonly resultKind: BaseHalfNodeSnapshotContentKind;
	readonly sourceAttemptId?: string;
}

/** Durable, provider-neutral mapping from one Attempt to its exact immutable executor inputs. */
export interface IBaseHalfNodeAttemptSnapshotManifest {
	readonly version: 1;
	readonly nodePath: string;
	readonly frozenNodePath: string;
	readonly frozenNodeDigest: string;
	readonly executorExtensionId: string;
	readonly videoModelCatalogId: string;
	readonly inputs: readonly IBaseHalfNodeAttemptSnapshotManifestInput[];
}

/** The single immutable ordinary-file artifact sealed into a result node. */
export interface IBaseHalfNodeResultArtifact {
	readonly id: string;
	readonly outputId: string;
	readonly kind: BaseHalfNodeArtifactKind;
	readonly path: string;
	/** Unpadded Base64 SHA-256 of the accepted file contents. */
	readonly sha256: string;
	readonly size: number;
	readonly label?: string;
}

/** A result seals the node. It is either one imported file or the output of the
 * node's unique successful attempt. */
export type IBaseHalfNodeResult =
	| {
		readonly source: 'imported';
		readonly artifact: IBaseHalfNodeResultArtifact;
	}
	| {
		readonly source: 'attempt';
		readonly attemptId: string;
		readonly artifact: IBaseHalfNodeResultArtifact;
	};

export interface IBaseHalfNodeAttempt {
	readonly id: string;
	readonly status: BaseHalfNodeAttemptStatus;
	readonly createdAt: string;
	readonly startedAt?: string;
	readonly completedAt?: string;
	/** Immutable host-owned generation intent used by this attempt. */
	readonly prompt: string;
	/** Immutable recipe snapshot used by this attempt. */
	readonly recipe: IBaseHalfNodeRecipe;
	/** Immutable local or external model-service identity selected before execution. */
	readonly model: BaseHalfNodeAttemptModel;
	/** Immutable direct-input snapshots used by this attempt. */
	readonly inputs: readonly IBaseHalfNodeAttemptInput[];
	readonly providerRequestId?: string;
	readonly usage?: IBaseHalfNodeAttemptUsage;
	readonly cost?: IBaseHalfNodeAttemptCost;
	readonly error?: string;
	/** Host-frozen provider request identity and billing intent. */
	readonly execution?: IBaseHalfNodeAttemptExecution;
	/** Durable mapping needed to recover this exact running provider Attempt after restart. */
	readonly snapshotManifest?: IBaseHalfNodeAttemptSnapshotManifest;
	/** Structured terminal evidence; never inferred from localized error text. */
	readonly failure?: IBaseHalfNodeAttemptFailure;
}

export interface IBaseHalfNodeDocument {
	readonly version: typeof BASEHALF_NODE_DOCUMENT_VERSION;
	/** Canonical lowercase UUID retained across file moves and renames. */
	readonly id: string;
	readonly kind: BaseHalfNodeKind;
	readonly title: string;
	readonly role: string;
	/** Host-owned generation intent, editable only while this node is a Draft. */
	readonly prompt: string;
	readonly recipe?: IBaseHalfNodeRecipe;
	/** Present exactly once after an import or the unique successful attempt. */
	readonly result?: IBaseHalfNodeResult;
	/** Append-only immutable execution attempts. */
	readonly attempts: readonly IBaseHalfNodeAttempt[];
}

export interface ICreateBaseHalfNodeDocumentOptions {
	readonly id: string;
	readonly kind: BaseHalfNodeKind;
	readonly title: string;
	readonly role: string;
	/** Defaults to an empty Draft prompt. Persisted documents always contain the field. */
	readonly prompt?: string;
	readonly recipe?: IBaseHalfNodeRecipe;
	readonly result?: IBaseHalfNodeResult;
	readonly attempts?: readonly IBaseHalfNodeAttempt[];
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
		role: 'Generated image',
		prompt: ''
	});
	const configured = createBaseHalfNodeDocument({
		id: '861a9f21-9d06-4ba2-9b0b-24ae31e25870',
		kind: 'image',
		title: 'Result',
		role: 'Generated image',
		prompt: 'Describe the intended result.',
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
			required: ['version', 'id', 'kind', 'title', 'role', 'prompt', 'attempts'],
			properties: {
				version: { const: BASEHALF_NODE_DOCUMENT_VERSION },
				id: { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', minLength: 36, maxLength: 36 },
				kind: { enum: [...NODE_KINDS] },
				title: { type: 'string', minLength: 1, maxLength: MAX_TITLE_LENGTH },
				role: { type: 'string', minLength: 1, maxLength: MAX_ROLE_LENGTH },
				prompt: { type: 'string', maxLength: BASEHALF_NODE_PROMPT_MAX_LENGTH },
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
									order: { type: 'integer', minimum: 0, maximum: MAX_BINDINGS - 1 },
									sourceId: { type: 'string', minLength: 1, maxLength: MAX_ID_LENGTH },
									sourceRevision: { type: 'string', minLength: 1, maxLength: MAX_INPUT_REVISION_LENGTH }
								}
							}
						}
					}
				},
				result: false,
				attempts: { type: 'array', maxItems: 0 }
			}
		},
		examples: {
			empty: validatedExample(empty),
			configured: validatedExample(configured)
		},
		hostOwnedFields: ['result', 'attempts'],
		rules: [
			'Use only recipe, slot, parameter, and model service ids published for the open workspace.',
			'Use prompt for the node-wide generation intent; do not duplicate it in recipe parameters.',
			'Create reciprocal context references separately; each recipe binding must match one direct inbound reference.',
			'Never author generated lifecycle state.'
		]
	});
}

export interface IBeginBaseHalfNodeAttemptOptions {
	readonly id: string;
	readonly createdAt: string;
	readonly startedAt: string;
	readonly model: BaseHalfNodeAttemptModel;
	readonly inputs: readonly IBaseHalfNodeAttemptInput[];
}

export interface ICompleteBaseHalfNodeAttemptOptions {
	readonly completedAt: string;
	readonly artifact: IBaseHalfNodeResultArtifact;
	readonly providerRequestId?: string;
	readonly usage?: IBaseHalfNodeAttemptUsage;
	readonly cost?: IBaseHalfNodeAttemptCost;
}

export interface IFailBaseHalfNodeAttemptOptions {
	readonly completedAt: string;
	readonly error: string;
	readonly providerRequestId?: string;
	readonly usage?: IBaseHalfNodeAttemptUsage;
	readonly cost?: IBaseHalfNodeAttemptCost;
	readonly failure?: IBaseHalfNodeAttemptFailure;
}

export interface ICancelBaseHalfNodeAttemptOptions {
	readonly completedAt: string;
	readonly error?: string;
	readonly providerRequestId?: string;
	readonly usage?: IBaseHalfNodeAttemptUsage;
	readonly cost?: IBaseHalfNodeAttemptCost;
	readonly failure?: IBaseHalfNodeAttemptFailure;
}

export interface IInterruptBaseHalfNodeAttemptOptions {
	readonly completedAt?: string;
	readonly error?: string;
	readonly providerRequestId?: string;
	readonly usage?: IBaseHalfNodeAttemptUsage;
	readonly cost?: IBaseHalfNodeAttemptCost;
	readonly failure?: IBaseHalfNodeAttemptFailure;
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
	| 'sealed'
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
 * the sole authority allowed to recover an abandoned attempt.
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
	return normalizeDocument(value);
}

/** Serializes a validated document without changing an active in-memory attempt. */
export function serializeBaseHalfNodeDocument(document: IBaseHalfNodeDocument): string {
	const normalized = normalizeDocument(document);
	const serialized = `${JSON.stringify(normalized, null, '\t')}\n`;
	if (utf8ByteLength(serialized) > BASEHALF_NODE_DOCUMENT_MAX_BYTES) {
		throw invalid(`The node document exceeds ${BASEHALF_NODE_DOCUMENT_MAX_BYTES} bytes.`);
	}
	return serialized;
}

/** Creates a validated, deeply frozen v3 document. The caller supplies the stable UUID. */
export function createBaseHalfNodeDocument(options: ICreateBaseHalfNodeDocumentOptions): IBaseHalfNodeDocument {
	return normalizeDocument({
		version: BASEHALF_NODE_DOCUMENT_VERSION,
		id: options.id,
		kind: options.kind,
		title: options.title,
		role: options.role,
		prompt: options.prompt ?? '',
		...(options.recipe ? { recipe: options.recipe } : {}),
		...(options.result ? { result: options.result } : {}),
		attempts: options.attempts ?? []
	});
}

/**
 * Creates an independent node from a copied result container. A copy keeps the
 * authored setup, but receives a new stable identity and no inherited
 * connections, sealed result, imports, or attempt history.
 */
export function forkBaseHalfNodeDocument(document: IBaseHalfNodeDocument, id: string): IBaseHalfNodeDocument {
	const normalized = normalizeDocument(document);
	return createBaseHalfNodeDocument({
		id,
		kind: normalized.kind,
		title: normalized.title,
		role: normalized.role,
		prompt: normalized.prompt,
		...(normalized.recipe ? {
			recipe: {
				...normalized.recipe,
				inputBindings: []
			}
		} : {})
	});
}

/** Starts one explicit attempt and appends its immutable running record. */
export function beginBaseHalfNodeAttempt(
	document: IBaseHalfNodeDocument,
	options: IBeginBaseHalfNodeAttemptOptions
): IBaseHalfNodeDocument {
	const normalized = normalizeDocument(document);
	if (normalized.result) {
		throw invalid('A sealed result node cannot start another attempt.');
	}
	if (!normalized.recipe) {
		throw invalid('A node without a recipe cannot start an attempt.');
	}
	if (normalized.attempts.some(attempt => attempt.status === 'running')) {
		throw invalid('The node already has an active attempt.');
	}
	if (normalized.attempts.some(attempt => attempt.status === 'succeeded')) {
		throw invalid('A successful attempt seals the node.');
	}
	if (normalized.attempts.length >= BASEHALF_NODE_MAX_ATTEMPTS) {
		throw invalid(`The node cannot contain more than ${BASEHALF_NODE_MAX_ATTEMPTS} attempts.`);
	}
	const id = requiredId(options.id, 'attempt.id');
	if (normalized.attempts.some(attempt => attempt.id === id)) {
		throw invalid(`Attempt '${id}' already exists.`);
	}
	return normalizeDocument({
		...normalized,
		attempts: [...normalized.attempts, {
			id,
			status: 'running',
			createdAt: options.createdAt,
			startedAt: options.startedAt,
			prompt: normalized.prompt,
			recipe: normalized.recipe,
				model: options.model,
				inputs: options.inputs
		}]
	});
}

/** Freezes the provider connection snapshot after the explicit attempt is durable. */
export function freezeBaseHalfNodeAttemptModel(
	document: IBaseHalfNodeDocument,
	attemptId: string,
	model: BaseHalfNodeAttemptModel
): IBaseHalfNodeDocument {
	return replaceRunningAttempt(document, attemptId, attempt => ({ ...attempt, model }));
}

/** Freezes the direct-input revisions for a running record before its executor can start. */
export function freezeBaseHalfNodeAttemptInputs(
	document: IBaseHalfNodeDocument,
	attemptId: string,
	inputs: readonly IBaseHalfNodeAttemptInput[]
): IBaseHalfNodeDocument {
	return replaceRunningAttempt(document, attemptId, attempt => {
		if (attempt.inputs.length > 0) {
			throw invalid(`Attempt '${attempt.id}' already has frozen inputs.`);
		}
		return { ...attempt, inputs };
	});
}

/** Freezes the exact provider execution fingerprint and intent before executor activation. */
export function freezeBaseHalfNodeAttemptExecution(
	document: IBaseHalfNodeDocument,
	attemptId: string,
	execution: IBaseHalfNodeAttemptExecution
): IBaseHalfNodeDocument {
	const normalizedExecution = normalizeAttemptExecution(execution, 'attempt.execution');
	return replaceRunningAttempt(document, attemptId, attempt => {
		if (attempt.execution !== undefined) {
			if (JSON.stringify(attempt.execution) !== JSON.stringify(normalizedExecution)) {
				throw invalid(`Attempt '${attempt.id}' already has different execution authorization.`);
			}
			return attempt;
		}
		return { ...attempt, execution: normalizedExecution };
	});
}

/** Freezes the verified run-snapshot mapping before a provider executor can create a task. */
export function freezeBaseHalfNodeAttemptSnapshotManifest(
	document: IBaseHalfNodeDocument,
	attemptId: string,
	manifest: IBaseHalfNodeAttemptSnapshotManifest
): IBaseHalfNodeDocument {
	const normalizedManifest = normalizeAttemptSnapshotManifest(manifest, 'attempt.snapshotManifest');
	return replaceRunningAttempt(document, attemptId, attempt => {
		assertSnapshotManifestMatchesAttempt(normalizedManifest, attempt, 'attempt.snapshotManifest');
		if (attempt.snapshotManifest !== undefined) {
			if (JSON.stringify(attempt.snapshotManifest) !== JSON.stringify(normalizedManifest)) {
				throw invalid(`Attempt '${attempt.id}' already has a different snapshot manifest.`);
			}
			return attempt;
		}
		return { ...attempt, snapshotManifest: normalizedManifest };
	});
}

/** Persists the provider's asynchronous task identity while the attempt is still running. */
export function freezeBaseHalfNodeAttemptProviderRequestId(
	document: IBaseHalfNodeDocument,
	attemptId: string,
	providerRequestId: string
): IBaseHalfNodeDocument {
	const normalizedId = auditIdentifier(providerRequestId, MAX_ID_LENGTH, 'attempt.providerRequestId');
	return replaceRunningAttempt(document, attemptId, attempt => {
		if (attempt.providerRequestId !== undefined && attempt.providerRequestId !== normalizedId) {
			throw invalid(`Attempt '${attempt.id}' already has a different provider request id.`);
		}
		return attempt.providerRequestId === normalizedId ? attempt : { ...attempt, providerRequestId: normalizedId };
	});
}

/** Replaces an inherited Retry task id after the provider proves that task is terminal and submits a new one. */
export function replaceBaseHalfNodeAttemptProviderRequestId(
	document: IBaseHalfNodeDocument,
	attemptId: string,
	expectedProviderRequestId: string,
	providerRequestId: string
): IBaseHalfNodeDocument {
	const expectedId = auditIdentifier(expectedProviderRequestId, MAX_ID_LENGTH, 'attempt.expectedProviderRequestId');
	const normalizedId = auditIdentifier(providerRequestId, MAX_ID_LENGTH, 'attempt.providerRequestId');
	if (expectedId === normalizedId) {
		return document;
	}
	return replaceRunningAttempt(document, attemptId, attempt => {
		if (attempt.providerRequestId !== expectedId) {
			throw invalid(`Attempt '${attempt.id}' no longer has the expected provider request id.`);
		}
		return { ...attempt, providerRequestId: normalizedId };
	});
}

/** Completes the running attempt and atomically seals its single artifact. */
export function completeBaseHalfNodeAttempt(
	document: IBaseHalfNodeDocument,
	attemptId: string,
	options: ICompleteBaseHalfNodeAttemptOptions
): IBaseHalfNodeDocument {
	return replaceRunningAttempt(document, attemptId, attempt => ({
		...attempt,
		status: 'succeeded',
		completedAt: options.completedAt,
		...(options.providerRequestId !== undefined ? { providerRequestId: options.providerRequestId } : {}),
		...(options.usage !== undefined ? { usage: options.usage } : {}),
		...(options.cost !== undefined ? { cost: options.cost } : {})
	}), options.artifact);
}

/** Fails a running attempt without creating a result. */
export function failBaseHalfNodeAttempt(
	document: IBaseHalfNodeDocument,
	attemptId: string,
	options: IFailBaseHalfNodeAttemptOptions
): IBaseHalfNodeDocument {
	return replaceRunningAttempt(document, attemptId, attempt => ({
		...attempt,
		status: 'failed',
		completedAt: options.completedAt,
		...(options.providerRequestId !== undefined ? { providerRequestId: options.providerRequestId } : {}),
		...(options.usage !== undefined ? { usage: options.usage } : {}),
		...(options.cost !== undefined ? { cost: options.cost } : {}),
		...(options.failure !== undefined ? { failure: options.failure } : {}),
		error: options.error
	}));
}

/** Cancels a running attempt without creating a result. */
export function cancelBaseHalfNodeAttempt(
	document: IBaseHalfNodeDocument,
	attemptId: string,
	options: ICancelBaseHalfNodeAttemptOptions
): IBaseHalfNodeDocument {
	return replaceRunningAttempt(document, attemptId, attempt => ({
		...attempt,
		status: 'cancelled',
		completedAt: options.completedAt,
		...(options.providerRequestId !== undefined ? { providerRequestId: options.providerRequestId } : {}),
		...(options.usage !== undefined ? { usage: options.usage } : {}),
		...(options.cost !== undefined ? { cost: options.cost } : {}),
		...(options.failure !== undefined ? { failure: options.failure } : {}),
		...(options.error !== undefined ? { error: options.error } : {})
	}));
}

/** Records an executor or host interruption without creating a result. */
export function interruptBaseHalfNodeAttempt(
	document: IBaseHalfNodeDocument,
	attemptId: string,
	options: IInterruptBaseHalfNodeAttemptOptions = {}
): IBaseHalfNodeDocument {
	return replaceRunningAttempt(document, attemptId, attempt => ({
		...attempt,
		status: 'interrupted',
		...(options.completedAt !== undefined ? { completedAt: options.completedAt } : {}),
		...(options.providerRequestId !== undefined ? { providerRequestId: options.providerRequestId } : {}),
		...(options.usage !== undefined ? { usage: options.usage } : {}),
		...(options.cost !== undefined ? { cost: options.cost } : {}),
		...(options.failure !== undefined ? { failure: options.failure } : {}),
		...(options.error !== undefined ? { error: options.error } : {})
	}));
}

export function getBaseHalfNodeReadiness(
	document: IBaseHalfNodeDocument,
	context: IBaseHalfNodeReadinessContext = {}
): IBaseHalfNodeReadiness {
	const normalized = normalizeDocument(document);
	if (normalized.result) {
		return Object.freeze({ ready: false, code: 'sealed' });
	}
	if (!normalized.recipe) {
		return Object.freeze({ ready: false, code: 'notExecutable' });
	}
	if (normalized.attempts.some(attempt => attempt.status === 'running')) {
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

/** Replaces the host-owned generation intent only while the node is a Draft. */
export function updateBaseHalfNodePrompt(
	document: IBaseHalfNodeDocument,
	prompt: string
): IBaseHalfNodeDocument {
	const normalized = normalizeDocument(document);
	if (normalized.result || normalized.attempts.length > 0) {
		throw invalid('The prompt is frozen after the first attempt or sealed result.');
	}
	return normalizeDocument({
		...normalized,
		prompt: promptText(prompt, 'prompt')
	});
}

/** Rewrites recipe bindings only while the node is an unattempted draft. */
export function remapBaseHalfNodeRecipeInputBindings(
	document: IBaseHalfNodeDocument,
	fromPath: string,
	toPath: string
): IBaseHalfNodeDocument {
	const normalized = normalizeDocument(document);
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
	assertDraftRecipeIsMutable(normalized);
	return normalizeDocument({
		...normalized,
		recipe: { ...normalized.recipe, inputBindings }
	});
}

/** Returns whether the live recipe directly references a file or descendant. */
export function baseHalfNodeRecipeReferencesPath(
	document: IBaseHalfNodeDocument,
	path: string
): boolean {
	const normalized = normalizeDocument(document);
	const rootKey = baseHalfProjectPathKey(projectPath(path, 'path'));
	return normalized.recipe?.inputBindings.some(binding => {
		const sourceKey = baseHalfProjectPathKey(binding.sourcePath);
		return sourceKey === rootKey || sourceKey.startsWith(`${rootKey}/`);
	}) ?? false;
}

/** Removes recipe bindings only while the node is an unattempted draft. */
export function removeBaseHalfNodeRecipeInputBindings(
	document: IBaseHalfNodeDocument,
	deletedPath: string
): IBaseHalfNodeDocument {
	const normalized = normalizeDocument(document);
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
	assertDraftRecipeIsMutable(normalized);
	const inputBindings = retained.map((binding, order) => ({ ...binding, order }));
	return normalizeDocument({
		...normalized,
		recipe: { ...normalized.recipe, inputBindings }
	});
}

/** Seals one imported ordinary-file artifact into a completely empty draft. */
export function importBaseHalfNodeResult(
	document: IBaseHalfNodeDocument,
	artifact: IBaseHalfNodeResultArtifact
): IBaseHalfNodeDocument {
	const normalized = normalizeDocument(document);
	if (normalized.result) {
		throw invalid('A sealed result cannot be replaced.');
	}
	if (normalized.recipe || normalized.attempts.length > 0) {
		throw invalid('An imported result requires an empty draft with no recipe or attempts.');
	}
	return normalizeDocument({ ...normalized, result: { source: 'imported', artifact } });
}

/** Returns the node's single sealed artifact, if one exists. */
export function getBaseHalfNodeResultArtifact(document: IBaseHalfNodeDocument): IBaseHalfNodeResultArtifact | undefined {
	return normalizeDocument(document).result?.artifact;
}

function replaceRunningAttempt(
	document: IBaseHalfNodeDocument,
	attemptId: string,
	update: (attempt: IBaseHalfNodeAttempt) => IBaseHalfNodeAttempt,
	sealArtifact?: IBaseHalfNodeResultArtifact
): IBaseHalfNodeDocument {
	const normalized = normalizeDocument(document);
	const normalizedAttemptId = requiredId(attemptId, 'attemptId');
	const index = normalized.attempts.findIndex(attempt => attempt.id === normalizedAttemptId);
	if (index < 0) {
		throw invalid(`Attempt '${normalizedAttemptId}' does not exist.`);
	}
	if (normalized.attempts[index].status !== 'running') {
		throw invalid(`Attempt '${normalizedAttemptId}' is not running.`);
	}
	const attempts = [...normalized.attempts];
	attempts[index] = update(normalized.attempts[index]);
	return normalizeDocument({
		...normalized,
		attempts,
		...(sealArtifact ? { result: { source: 'attempt', attemptId: normalizedAttemptId, artifact: sealArtifact } } : {})
	});
}

function assertDraftRecipeIsMutable(document: IBaseHalfNodeDocument): void {
	if (document.result || document.attempts.length > 0) {
		throw invalid('The recipe is frozen after the first attempt or sealed result.');
	}
}

function normalizeDocument(value: unknown): IBaseHalfNodeDocument {
	const candidate = record(value, 'document');
	assertOnlyKeys(candidate, ['version', 'id', 'kind', 'title', 'role', 'prompt', 'recipe', 'result', 'attempts'], 'document');
	if (candidate.version !== BASEHALF_NODE_DOCUMENT_VERSION) {
		throw invalid(`Unsupported node document version '${String(candidate.version)}'.`);
	}

	const id = requiredNodeDocumentId(candidate.id);
	const kind = oneOf(candidate.kind, NODE_KINDS, 'document.kind');
	const title = requiredString(candidate.title, MAX_TITLE_LENGTH, 'document.title');
	const role = requiredString(candidate.role, MAX_ROLE_LENGTH, 'document.role');
	const prompt = promptText(candidate.prompt, 'document.prompt');
	const recipe = candidate.recipe === undefined ? undefined : normalizeRecipe(candidate.recipe, 'document.recipe');
	const attemptsValue = array(candidate.attempts, 'document.attempts', BASEHALF_NODE_MAX_ATTEMPTS);
	const attempts = attemptsValue.map((attempt, index) => normalizeAttempt(attempt, `document.attempts[${index}]`));
	assertUnique(attempts.map(attempt => attempt.id), 'document.attempts ids');

	const running = attempts.filter(attempt => attempt.status === 'running');
	if (running.length > 1) {
		throw invalid('document.attempts cannot contain more than one running attempt.');
	}
	if (running.length === 1 && attempts[attempts.length - 1] !== running[0]) {
		throw invalid('The running attempt must be the last attempt.');
	}
	const succeeded = attempts.filter(attempt => attempt.status === 'succeeded');
	if (succeeded.length > 1) {
		throw invalid('document.attempts cannot contain more than one successful attempt.');
	}
	if (attempts.length > 0 && !recipe) {
		throw invalid('document.recipe is required after the first attempt.');
	}
	if (attempts.some(attempt => attempt.prompt !== prompt)) {
		throw invalid('document.prompt is frozen after the first attempt and must match every attempt snapshot.');
	}
	if (recipe && attempts.some(attempt => !recipesEqual(recipe, attempt.recipe))) {
		throw invalid('document.recipe is frozen after the first attempt and must match every attempt snapshot.');
	}

	const result = candidate.result === undefined ? undefined : normalizeResult(candidate.result, 'document.result');
	if (result && result.artifact.kind !== kind) {
		throw invalid(`document.result.artifact.kind must match document.kind '${kind}'.`);
	}
	if (result?.source === 'imported' && (recipe || attempts.length > 0)) {
		throw invalid('An imported result requires an empty draft with no recipe or attempts.');
	}
	if (result?.source === 'attempt') {
		if (succeeded.length !== 1 || succeeded[0].id !== result.attemptId) {
			throw invalid('An attempt result must point to the unique successful attempt.');
		}
		if (attempts[attempts.length - 1] !== succeeded[0]) {
			throw invalid('The successful attempt must be the last attempt.');
		}
	}
	if (succeeded.length === 1 && result?.source !== 'attempt') {
		throw invalid('A successful attempt requires its sealed attempt result.');
	}
	if (result && running.length > 0) {
		throw invalid('A sealed result cannot coexist with a running attempt.');
	}

	return freezeDocument({
		version: BASEHALF_NODE_DOCUMENT_VERSION,
		id,
		kind,
		title,
		role,
		prompt,
		...(recipe ? { recipe } : {}),
		...(result ? { result } : {}),
		attempts: Object.freeze(attempts)
	});
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

function normalizeAttempt(value: unknown, path: string): IBaseHalfNodeAttempt {
	const candidate = record(value, path);
	assertOnlyKeys(candidate, ['id', 'status', 'createdAt', 'startedAt', 'completedAt', 'prompt', 'recipe', 'model', 'inputs', 'providerRequestId', 'usage', 'cost', 'error', 'execution', 'snapshotManifest', 'failure'], path);
	const id = requiredId(candidate.id, `${path}.id`);
	const status = oneOf(candidate.status, ATTEMPT_STATUSES, `${path}.status`);
	const createdAt = timestamp(candidate.createdAt, `${path}.createdAt`);
	const startedAt = candidate.startedAt === undefined ? undefined : timestamp(candidate.startedAt, `${path}.startedAt`);
	const completedAt = candidate.completedAt === undefined ? undefined : timestamp(candidate.completedAt, `${path}.completedAt`);
	const prompt = promptText(candidate.prompt, `${path}.prompt`);
	const recipe = normalizeRecipe(candidate.recipe, `${path}.recipe`);
	const model = normalizeAttemptModel(candidate.model, `${path}.model`);
	validateAttemptModelRecipe(model, recipe, path);
	const inputs = normalizeAttemptInputs(candidate.inputs, `${path}.inputs`);
	// The host lands a running record before fallible input preparation. An
	// empty list therefore records that preparation never finished; once
	// present, inputs must exactly match the immutable recipe snapshot.
	if (inputs.length > 0 && !bindingsEqual(recipe.inputBindings, inputs)) {
		throw invalid(`${path}.inputs must match the attempt recipe input bindings.`);
	}
	if (status === 'succeeded' && !bindingsEqual(recipe.inputBindings, inputs)) {
		throw invalid(`${path}.inputs must match the attempt recipe input bindings.`);
	}
	const providerRequestId = candidate.providerRequestId === undefined ? undefined : auditIdentifier(candidate.providerRequestId, MAX_ID_LENGTH, `${path}.providerRequestId`);
	const usage = candidate.usage === undefined ? undefined : normalizeAttemptUsage(candidate.usage, `${path}.usage`);
	const cost = candidate.cost === undefined ? undefined : normalizeAttemptCost(candidate.cost, `${path}.cost`);
	const error = candidate.error === undefined ? undefined : requiredString(candidate.error, MAX_MESSAGE_LENGTH, `${path}.error`);
	const execution = candidate.execution === undefined ? undefined : normalizeAttemptExecution(candidate.execution, `${path}.execution`);
	const snapshotManifest = candidate.snapshotManifest === undefined ? undefined : normalizeAttemptSnapshotManifest(candidate.snapshotManifest, `${path}.snapshotManifest`);
	if (snapshotManifest !== undefined) {
		assertSnapshotManifestMatchesAttempt(snapshotManifest, { id, inputs }, `${path}.snapshotManifest`);
	}
	const failure = candidate.failure === undefined ? undefined : normalizeBaseHalfNodeAttemptFailure(candidate.failure, `${path}.failure`);
	if (failure?.providerRequestId !== undefined && failure.providerRequestId !== providerRequestId) {
		throw invalid(`${path}.failure.providerRequestId must match the durable Attempt provider request id.`);
	}

	validateAttemptLifecycle(status, { createdAt, startedAt, completedAt, providerRequestId, usage, cost, error, failure }, path);
	if (status === 'succeeded' && model.source === 'service' && model.connection !== 'resolved') {
		throw invalid(`${path} successful attempts require a resolved model connection.`);
	}

	return freezeAttempt({
		id,
		status,
		createdAt,
		...(startedAt !== undefined ? { startedAt } : {}),
		...(completedAt !== undefined ? { completedAt } : {}),
		prompt,
		recipe,
		model,
		inputs,
		...(providerRequestId !== undefined ? { providerRequestId } : {}),
		...(usage !== undefined ? { usage } : {}),
		...(cost !== undefined ? { cost } : {}),
		...(error !== undefined ? { error } : {}),
		...(execution !== undefined ? { execution } : {}),
		...(snapshotManifest !== undefined ? { snapshotManifest } : {}),
		...(failure !== undefined ? { failure } : {})
	});
}

export function normalizeBaseHalfNodeAttemptFailure(value: unknown, path = 'attempt.failure'): IBaseHalfNodeAttemptFailure {
	const candidate = record(value, path);
	assertOnlyKeys(candidate, ['kind', 'retry', 'providerRequestId', 'uncommittedProviderRequestId'], path);
	const kind = oneOf(candidate.kind, ATTEMPT_FAILURE_KINDS, `${path}.kind`);
	const retry = oneOf(candidate.retry, ATTEMPT_RETRY_POLICIES, `${path}.retry`);
	const providerRequestId = candidate.providerRequestId === undefined
		? undefined
		: auditIdentifier(candidate.providerRequestId, MAX_ID_LENGTH, `${path}.providerRequestId`);
	const uncommittedProviderRequestId = candidate.uncommittedProviderRequestId === undefined
		? undefined
		: auditIdentifier(candidate.uncommittedProviderRequestId, MAX_ID_LENGTH, `${path}.uncommittedProviderRequestId`);
	if (providerRequestId !== undefined && uncommittedProviderRequestId !== undefined) {
		throw invalid(`${path} cannot contain both durable and uncommitted provider request ids.`);
	}
	const expectedRetry = baseHalfNodeAttemptRetryPolicy(kind, providerRequestId !== undefined);
	if (retry !== expectedRetry) {
		throw invalid(`${path}.retry must be '${expectedRetry}' for '${kind}'.`);
	}
	if ((kind === 'remote-id-uncommitted') !== (uncommittedProviderRequestId !== undefined)) {
		throw invalid(`${path}.uncommittedProviderRequestId is required only for remote-id-uncommitted failures.`);
	}
	return Object.freeze({
		kind,
		retry,
		...(providerRequestId === undefined ? {} : { providerRequestId }),
		...(uncommittedProviderRequestId === undefined ? {} : { uncommittedProviderRequestId })
	});
}

export function baseHalfNodeAttemptRetryPolicy(
	kind: BaseHalfNodeAttemptFailureKind,
	hasDurableProviderRequestId: boolean
): BaseHalfNodeAttemptRetryPolicy {
	if (kind === 'preparation' || kind === 'submission-rejected') {
		return 'fresh-submit';
	}
	if (kind === 'remote-failed' || kind === 'remote-cancelled') {
		return hasDurableProviderRequestId ? 'replace-after-terminal-proof' : 'blocked';
	}
	if (kind === 'poll-interrupted' || kind === 'poll-window-exhausted'
		|| kind === 'protocol' || kind === 'download' || kind === 'artifact-invalid'
		|| kind === 'artifact-commit' || kind === 'execution-ownership') {
		return hasDurableProviderRequestId ? 'resume-existing' : 'blocked';
	}
	return 'blocked';
}

function normalizeAttemptExecution(value: unknown, path: string): IBaseHalfNodeAttemptExecution {
	const candidate = record(value, path);
	assertOnlyKeys(candidate, ['requestFingerprint', 'intent'], path);
	const requestFingerprint = requiredString(candidate.requestFingerprint, 64, `${path}.requestFingerprint`);
	if (!/^v1:[A-Za-z0-9_-]{43}$/.test(requestFingerprint)) {
		throw invalid(`${path}.requestFingerprint must be a version 1 SHA-256 fingerprint.`);
	}
	const intentCandidate = record(candidate.intent, `${path}.intent`);
	const kind = intentCandidate.kind;
	let intent: BaseHalfNodeAttemptExecutionIntent;
	if (kind === 'new') {
		assertOnlyKeys(intentCandidate, ['kind'], `${path}.intent`);
		intent = Object.freeze({ kind });
	} else if (kind === 'recover') {
		assertOnlyKeys(intentCandidate, ['kind', 'providerRequestId'], `${path}.intent`);
		intent = Object.freeze({
			kind,
			providerRequestId: auditIdentifier(intentCandidate.providerRequestId, MAX_ID_LENGTH, `${path}.intent.providerRequestId`)
		});
	} else if (kind === 'exact-retry') {
		assertOnlyKeys(intentCandidate, ['kind', 'sourceAttemptId', 'providerRequestId', 'replacementAuthorized'], `${path}.intent`);
		if (typeof intentCandidate.replacementAuthorized !== 'boolean') {
			throw invalid(`${path}.intent.replacementAuthorized must be a boolean.`);
		}
		intent = Object.freeze({
			kind,
			sourceAttemptId: requiredId(intentCandidate.sourceAttemptId, `${path}.intent.sourceAttemptId`),
			...(intentCandidate.providerRequestId === undefined ? {} : {
				providerRequestId: auditIdentifier(intentCandidate.providerRequestId, MAX_ID_LENGTH, `${path}.intent.providerRequestId`)
			}),
			replacementAuthorized: intentCandidate.replacementAuthorized
		});
	} else {
		throw invalid(`${path}.intent.kind must be 'new', 'recover', or 'exact-retry'.`);
	}
	return Object.freeze({ requestFingerprint, intent });
}

function normalizeAttemptSnapshotManifest(value: unknown, path: string): IBaseHalfNodeAttemptSnapshotManifest {
	const candidate = record(value, path);
	assertOnlyKeys(candidate, ['version', 'nodePath', 'frozenNodePath', 'frozenNodeDigest', 'executorExtensionId', 'videoModelCatalogId', 'inputs'], path);
	if (candidate.version !== 1) {
		throw invalid(`${path}.version must be 1.`);
	}
	const values = array(candidate.inputs, `${path}.inputs`, MAX_BINDINGS);
	const inputs = values.map((value, index) => {
		const inputPath = `${path}.inputs[${index}]`;
		const input = record(value, inputPath);
		assertOnlyKeys(input, [
			'edgeId', 'slot', 'order', 'revision', 'sourceId', 'sourcePath', 'sourceKind',
			'snapshotPath', 'snapshotDigest', 'resultId', 'resultKind', 'sourceAttemptId'
		], inputPath);
		return Object.freeze({
			edgeId: requiredString(input.edgeId, MAX_PATH_LENGTH * 2 + 2, `${inputPath}.edgeId`),
			slot: requiredString(input.slot, MAX_SLOT_LENGTH, `${inputPath}.slot`),
			order: integer(input.order, 0, MAX_BINDINGS - 1, `${inputPath}.order`),
			revision: requiredString(input.revision, MAX_INPUT_REVISION_LENGTH, `${inputPath}.revision`),
			sourceId: requiredString(input.sourceId, MAX_PATH_LENGTH, `${inputPath}.sourceId`),
			sourcePath: projectPath(input.sourcePath, `${inputPath}.sourcePath`),
			sourceKind: oneOf(input.sourceKind, SNAPSHOT_CONTENT_KINDS, `${inputPath}.sourceKind`),
			snapshotPath: projectPath(input.snapshotPath, `${inputPath}.snapshotPath`),
			snapshotDigest: snapshotDigest(input.snapshotDigest, `${inputPath}.snapshotDigest`),
			resultId: requiredString(input.resultId, MAX_PATH_LENGTH, `${inputPath}.resultId`),
			resultKind: oneOf(input.resultKind, SNAPSHOT_CONTENT_KINDS, `${inputPath}.resultKind`),
			...(input.sourceAttemptId === undefined ? {} : {
				sourceAttemptId: requiredId(input.sourceAttemptId, `${inputPath}.sourceAttemptId`)
			})
		});
	}).sort((left, right) => left.order - right.order);
	validateBindingSet(inputs, `${path}.inputs`);
	return Object.freeze({
		version: 1,
		nodePath: projectPath(candidate.nodePath, `${path}.nodePath`),
		frozenNodePath: projectPath(candidate.frozenNodePath, `${path}.frozenNodePath`),
		frozenNodeDigest: snapshotDigest(candidate.frozenNodeDigest, `${path}.frozenNodeDigest`),
		executorExtensionId: requiredId(candidate.executorExtensionId, `${path}.executorExtensionId`),
		videoModelCatalogId: requiredId(candidate.videoModelCatalogId, `${path}.videoModelCatalogId`),
		inputs: Object.freeze(inputs)
	});
}

function assertSnapshotManifestMatchesAttempt(
	manifest: IBaseHalfNodeAttemptSnapshotManifest,
	attempt: Pick<IBaseHalfNodeAttempt, 'id' | 'inputs'>,
	path: string
): void {
	if (manifest.inputs.length !== attempt.inputs.length) {
		throw invalid(`${path}.inputs must map every frozen Attempt input exactly once.`);
	}
	for (let index = 0; index < attempt.inputs.length; index++) {
		const frozen = attempt.inputs[index];
		const mapped = manifest.inputs[index];
		if (mapped.order !== frozen.order || mapped.slot !== frozen.slot || mapped.revision !== frozen.revision
			|| mapped.sourcePath !== frozen.sourcePath) {
			throw invalid(`${path}.inputs[${index}] must match the frozen Attempt input tuple.`);
		}
		if (mapped.edgeId !== `${frozen.sourcePath}->${manifest.nodePath}`) {
			throw invalid(`${path}.inputs[${index}].edgeId must match the frozen source and node paths.`);
		}
	}
}

function snapshotDigest(value: unknown, path: string): string {
	const digest = requiredString(value, 64, path);
	if (!/^[A-Za-z0-9_-]{43}$/.test(digest)) {
		throw invalid(`${path} must be an unpadded Base64 SHA-256 digest.`);
	}
	return digest;
}

function normalizeAttemptModel(value: unknown, path: string): BaseHalfNodeAttemptModel {
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

function validateAttemptModelRecipe(model: BaseHalfNodeAttemptModel, recipe: IBaseHalfNodeRecipe, path: string): void {
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

function normalizeAttemptUsage(value: unknown, path: string): IBaseHalfNodeAttemptUsage {
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

function normalizeAttemptCost(value: unknown, path: string): IBaseHalfNodeAttemptCost {
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

function normalizeResult(value: unknown, path: string): IBaseHalfNodeResult {
	const candidate = record(value, path);
	const source = oneOf(candidate.source, RESULT_SOURCES, `${path}.source`);
	if (source === 'imported') {
		assertOnlyKeys(candidate, ['source', 'artifact'], path);
		return Object.freeze({ source, artifact: normalizeResultArtifact(candidate.artifact, `${path}.artifact`) });
	}
	assertOnlyKeys(candidate, ['source', 'attemptId', 'artifact'], path);
	return Object.freeze({
		source,
		attemptId: requiredId(candidate.attemptId, `${path}.attemptId`),
		artifact: normalizeResultArtifact(candidate.artifact, `${path}.artifact`)
	});
}

function normalizeResultArtifact(value: unknown, path: string): IBaseHalfNodeResultArtifact {
	const candidate = record(value, path);
	assertOnlyKeys(candidate, ['id', 'outputId', 'kind', 'path', 'sha256', 'size', 'label'], path);
	const sha256 = requiredString(candidate.sha256, 64, `${path}.sha256`);
	if (!/^[A-Za-z0-9_-]{43}$/.test(sha256)) {
		throw invalid(`${path}.sha256 must be an unpadded Base64 SHA-256 digest.`);
	}
	return Object.freeze({
		id: requiredId(candidate.id, `${path}.id`),
		outputId: requiredId(candidate.outputId, `${path}.outputId`),
		kind: oneOf(candidate.kind, ARTIFACT_KINDS, `${path}.kind`),
		path: projectPath(candidate.path, `${path}.path`),
		sha256,
		size: integer(candidate.size, 0, Number.MAX_SAFE_INTEGER, `${path}.size`),
		...(candidate.label === undefined ? {} : { label: requiredString(candidate.label, 160, `${path}.label`) })
	});
}

function normalizeAttemptInputs(value: unknown, path: string): readonly IBaseHalfNodeAttemptInput[] {
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
	assertOnlyKeys(candidate, allowRevision
		? ['sourcePath', 'slot', 'order', 'sourceId', 'sourceRevision', 'revision']
		: ['sourcePath', 'slot', 'order', 'sourceId', 'sourceRevision'], path);
	return Object.freeze({
		sourcePath: projectPath(candidate.sourcePath, `${path}.sourcePath`),
		slot: requiredString(candidate.slot, MAX_SLOT_LENGTH, `${path}.slot`),
		order: integer(candidate.order, 0, MAX_BINDINGS - 1, `${path}.order`),
		...(candidate.sourceId === undefined ? {} : { sourceId: auditIdentifier(candidate.sourceId, MAX_ID_LENGTH, `${path}.sourceId`) }),
		...(candidate.sourceRevision === undefined ? {} : { sourceRevision: requiredString(candidate.sourceRevision, MAX_INPUT_REVISION_LENGTH, `${path}.sourceRevision`) })
	});
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

function validateAttemptLifecycle(
	status: BaseHalfNodeAttemptStatus,
	value: Pick<IBaseHalfNodeAttempt, 'createdAt' | 'startedAt' | 'completedAt' | 'providerRequestId' | 'usage' | 'cost' | 'error' | 'failure'>,
	path: string
): void {
	const created = Date.parse(value.createdAt);
	const started = value.startedAt === undefined ? undefined : Date.parse(value.startedAt);
	const completed = value.completedAt === undefined ? undefined : Date.parse(value.completedAt);
	if (started !== undefined && started < created) {
		throw invalid(`${path}.startedAt cannot precede createdAt.`);
	}
	if (completed !== undefined && completed < (started ?? created)) {
		throw invalid(`${path}.completedAt cannot precede the attempt start.`);
	}

	if (status === 'running' && (value.startedAt === undefined || value.completedAt !== undefined)) {
		throw invalid(`${path} running attempts require startedAt and cannot have completedAt.`);
	}
	if ((status === 'succeeded' || status === 'failed') && (value.startedAt === undefined || value.completedAt === undefined)) {
		throw invalid(`${path} ${status} attempts require startedAt and completedAt.`);
	}
	if (status === 'cancelled' && value.completedAt === undefined) {
		throw invalid(`${path} cancelled attempts require completedAt.`);
	}
	if (status === 'interrupted' && value.startedAt === undefined) {
		throw invalid(`${path} interrupted attempts require startedAt.`);
	}
	if (status === 'running' && (value.usage !== undefined || value.cost !== undefined)) {
		throw invalid(`${path} running attempts cannot contain completed usage or cost.`);
	}
	if (status === 'failed' && value.error === undefined) {
		throw invalid(`${path} failed attempts require an error message.`);
	}
	if ((status === 'running' || status === 'succeeded') && value.error !== undefined) {
		throw invalid(`${path} ${status} attempts cannot contain an error message.`);
	}
	if ((status === 'running' || status === 'succeeded') && value.failure !== undefined) {
		throw invalid(`${path} ${status} attempts cannot contain failure evidence.`);
	}
}

function validateBindingSet(bindings: readonly IBaseHalfNodeInputBinding[], path: string): void {
	assertUnique(bindings.map(binding => String(binding.order)), `${path} orders`);
	assertUnique(bindings.map(binding => baseHalfProjectPathKey(binding.sourcePath)), `${path} source paths`);
}

function bindingsEqual(left: readonly IBaseHalfNodeInputBinding[], right: readonly IBaseHalfNodeInputBinding[]): boolean {
	return left.length === right.length && left.every((binding, index) => {
		const candidate = right[index];
		return binding.sourcePath === candidate.sourcePath && binding.slot === candidate.slot && binding.order === candidate.order
			&& binding.sourceId === candidate.sourceId && binding.sourceRevision === candidate.sourceRevision;
	});
}

function recipesEqual(left: IBaseHalfNodeRecipe, right: IBaseHalfNodeRecipe): boolean {
	return left.recipeId === right.recipeId
		&& left.modelServiceId === right.modelServiceId
		&& left.modelId === right.modelId
		&& bindingsEqual(left.inputBindings, right.inputBindings)
		&& JSON.stringify(left.parameters) === JSON.stringify(right.parameters);
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw invalid(`${path} must be an object.`);
	}
	return value as Record<string, unknown>;
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
	try {
		return validateBaseHalfNodePersistentId(value, path);
	} catch (error) {
		throw invalid(error instanceof Error ? error.message : `${path} is invalid.`);
	}
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

function promptText(value: unknown, path: string): string {
	const result = boundedString(value, BASEHALF_NODE_PROMPT_MAX_LENGTH, path);
	if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(result)) {
		throw invalid(`${path} cannot contain control characters other than tab or line breaks.`);
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

function freezeAttempt(value: IBaseHalfNodeAttempt): IBaseHalfNodeAttempt {
	return Object.freeze({
		...value,
		recipe: Object.freeze({
			...value.recipe,
			parameters: deepFreezeJson(value.recipe.parameters as IBaseHalfNodeJsonObject) as Readonly<Record<string, BaseHalfNodeJsonValue>>,
			inputBindings: Object.freeze([...value.recipe.inputBindings])
		}),
		inputs: Object.freeze([...value.inputs]),
		...(value.usage ? { usage: Object.freeze({ ...value.usage }) } : {}),
		...(value.cost ? { cost: Object.freeze({ ...value.cost }) } : {}),
		...(value.execution ? { execution: Object.freeze({ ...value.execution, intent: Object.freeze({ ...value.execution.intent }) }) } : {}),
		...(value.snapshotManifest ? {
			snapshotManifest: Object.freeze({
				...value.snapshotManifest,
				inputs: Object.freeze(value.snapshotManifest.inputs.map(input => Object.freeze({ ...input })))
			})
		} : {}),
		...(value.failure ? { failure: Object.freeze({ ...value.failure }) } : {})
	});
}

function freezeDocument(value: IBaseHalfNodeDocument): IBaseHalfNodeDocument {
	return Object.freeze({
		...value,
		...(value.recipe ? {
			recipe: Object.freeze({
				...value.recipe,
				parameters: deepFreezeJson(value.recipe.parameters as IBaseHalfNodeJsonObject) as Readonly<Record<string, BaseHalfNodeJsonValue>>,
				inputBindings: Object.freeze([...value.recipe.inputBindings])
			})
		} : {}),
		...(value.result ? {
			result: Object.freeze({ ...value.result, artifact: Object.freeze({ ...value.result.artifact }) })
		} : {}),
		attempts: Object.freeze(value.attempts.map(freezeAttempt))
	});
}

function invalid(message: string): BaseHalfNodeDocumentError {
	return new BaseHalfNodeDocumentError(message);
}

function utf8ByteLength(value: string): number {
	return textEncoder.encode(value).byteLength;
}
