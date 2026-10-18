/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * The video fields of a `.bhnode` document, version 5 (D58): what the next
 * generation of a Video node uses, the generation that runs or the last one
 * that ended without a video, and what produced the node's video.
 *
 * The node document module embeds these fields in the document and validates
 * them through the functions here. Nothing in this module reads or writes
 * files. The transitions are pure and keep every field they do not own.
 */

import { BASEHALF_VIDEO_MODE_IDS, BaseHalfVideoModeId, BaseHalfVideoParams, BaseHalfVideoParamValue, IBaseHalfVideoGenerationChoice } from './basehalfVideoCatalog.js';

/** What the next generation of a Video node uses (version 6): ids of the catalog and the values of the model's parameters. */
export type IBaseHalfVideoGeneration = IBaseHalfVideoGenerationChoice;

const MAX_PARAMS = 64;
const MAX_PARAM_TEXT_LENGTH = 16 * 1024;
const PARAM_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;

export type BaseHalfVideoMode = 'frames' | 'reference';
export const BASEHALF_VIDEO_MODES: readonly BaseHalfVideoMode[] = Object.freeze(['frames', 'reference']);

/** The request format of a provider, chosen by the channel's preset. */
export type BaseHalfVideoProviderKind = 'ark' | 'byteplus' | 'dashscope' | 'minimax' | 'gemini' | 'openai';
export const BASEHALF_VIDEO_PROVIDER_KINDS: readonly BaseHalfVideoProviderKind[] = Object.freeze(['ark', 'byteplus', 'dashscope', 'minimax', 'gemini', 'openai']);

/** A duration of -1 lets the model choose the length, where the model allows it. */
export const BASEHALF_VIDEO_AUTO_DURATION = -1;
export const BASEHALF_VIDEO_MAX_DURATION = 120;
export const BASEHALF_VIDEO_PROMPT_MAX_LENGTH = 64 * 1024;
export const BASEHALF_VIDEO_ERROR_MAX_LENGTH = 4 * 1024;
export const BASEHALF_VIDEO_MAX_INPUTS = 64;

const MAX_ID_LENGTH = 128;
const MAX_MODEL_LENGTH = 256;
const MAX_SETTING_LENGTH = 32;
const MAX_PATH_LENGTH = 1024;
const MAX_TIMESTAMP_LENGTH = 64;

/** The settings of one generation, apart from the model. */
export interface IBaseHalfVideoSettings {
	readonly mode: BaseHalfVideoMode;
	/** `16:9`, `9:16`, `1:1`, `4:3`, `3:4`, `21:9`, or `adaptive`. */
	readonly ratio: string;
	/** As the provider names it, such as `720p` or `768P`. */
	readonly resolution: string;
	/** Seconds, or {@link BASEHALF_VIDEO_AUTO_DURATION}. */
	readonly duration: number;
	readonly audio: boolean;
}

/** What the next generation of the node uses. Without `model`, none is chosen yet. */
export interface IBaseHalfVideoGenerationSettings extends IBaseHalfVideoSettings {
	/** The machine-local channel that offered the model when it was chosen. A hint only. */
	readonly channel?: string;
	/** The provider's model id, such as `doubao-seedance-2-5-260628`. */
	readonly model?: string;
}

/** What one generation sent to the provider. */
export interface IBaseHalfVideoGenerationRecord extends IBaseHalfVideoSettings {
	readonly provider: BaseHalfVideoProviderKind;
	readonly model: string;
	/** The node's prompt when the generation started. Text inputs are listed in `inputs`, not copied. */
	readonly prompt: string;
	/** The upstream entries the generation used, in the order it used them. */
	readonly inputs: readonly string[];
}

/**
 * `submitting`: the request is on its way and no provider task id is known.
 * `running`: the provider accepted the task; `remoteId` is set.
 * `failed` and `stopped`: the generation ended without a video.
 */
export type BaseHalfVideoTaskState = 'submitting' | 'running' | 'failed' | 'stopped';

/** The generation that runs, or the last one that ended without a video. */
export interface IBaseHalfVideoTask {
	/** Local identity of the generation; sortable by start time. */
	readonly id: string;
	readonly state: BaseHalfVideoTaskState;
	readonly startedAt: string;
	readonly endedAt?: string;
	/** The machine-local channel that runs it. */
	readonly channel: string;
	/** The provider's task id, written as soon as the provider returns it. */
	readonly remoteId?: string;
	/** Plain text for the card: why it failed or how it ended. */
	readonly error?: string;
	readonly request: IBaseHalfVideoGenerationRecord;
}

/** How a generated video was made. Stored with the node's result. */
export interface IBaseHalfVideoResultGeneration {
	readonly taskId: string;
	readonly remoteId?: string;
	readonly startedAt: string;
	readonly completedAt: string;
	readonly request: IBaseHalfVideoGenerationRecord;
}

/** The single local file a node shows. */
export interface IBaseHalfNodeArtifact {
	readonly kind: string;
	/** Workspace-relative path of the file. */
	readonly path: string;
	readonly size: number;
}

export type IBaseHalfNodeResult =
	| { readonly source: 'imported'; readonly artifact: IBaseHalfNodeArtifact }
	| { readonly source: 'generated'; readonly artifact: IBaseHalfNodeArtifact; readonly generation: IBaseHalfVideoResultGeneration };

/** The fields of a node document that the video transitions read and write. */
export interface IBaseHalfVideoNodeFields {
	readonly prompt?: string;
	readonly generation?: IBaseHalfVideoGenerationSettings;
	readonly task?: IBaseHalfVideoTask;
	readonly result?: IBaseHalfNodeResult;
}

/** What a Video node shows, in the order a card asks. */
export type BaseHalfVideoNodePhase = 'video' | 'generating' | 'failed' | 'stopped' | 'empty';

export function baseHalfVideoNodePhase(node: IBaseHalfVideoNodeFields): BaseHalfVideoNodePhase {
	if (node.result) {
		return 'video';
	}
	switch (node.task?.state) {
		case 'submitting':
		case 'running':
			return 'generating';
		case 'failed':
			return 'failed';
		case 'stopped':
			return 'stopped';
		default:
			return 'empty';
	}
}

export function isBaseHalfVideoTaskActive(task: IBaseHalfVideoTask | undefined): boolean {
	return task?.state === 'submitting' || task?.state === 'running';
}

export class BaseHalfVideoNodeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BaseHalfVideoNodeError';
	}
}

// --- validation ---------------------------------------------------------------------------

/** Validates the `generation` field of a Video node. Throws with the field path. */
export function normalizeBaseHalfVideoGenerationSettings(value: unknown, path = 'generation'): IBaseHalfVideoGenerationSettings {
	const candidate = object(value, path, ['mode', 'ratio', 'resolution', 'duration', 'audio', 'channel', 'model']);
	const settings = normalizeSettings(candidate, path);
	const channel = candidate.channel === undefined ? undefined : id(candidate.channel, `${path}.channel`);
	const model = candidate.model === undefined ? undefined : modelId(candidate.model, `${path}.model`);
	return Object.freeze({
		...settings,
		...(channel !== undefined ? { channel } : {}),
		...(model !== undefined ? { model } : {})
	});
}

/**
 * Validates the shape of a version 6 `generation`: catalog ids for the
 * provider and the model, a mode id, and values that are text, numbers, or
 * booleans. Whether they exist is known from the catalog, not here. Throws
 * with the field path.
 */
export function normalizeBaseHalfVideoGeneration(value: unknown, path = 'generation'): IBaseHalfVideoGeneration {
	const candidate = object(value, path, ['provider', 'model', 'mode', 'params']);
	const provider = candidate.provider === undefined ? undefined : id(candidate.provider, `${path}.provider`);
	const model = candidate.model === undefined ? undefined : id(candidate.model, `${path}.model`);
	if (candidate.mode !== undefined && !BASEHALF_VIDEO_MODE_IDS.includes(candidate.mode as BaseHalfVideoModeId)) {
		throw error(`${path}.mode must be one of ${BASEHALF_VIDEO_MODE_IDS.join(', ')}.`);
	}
	const params = candidate.params === undefined ? undefined : paramValues(candidate.params, `${path}.params`);
	return Object.freeze({
		...(provider !== undefined ? { provider } : {}),
		...(model !== undefined ? { model } : {}),
		...(candidate.mode !== undefined ? { mode: candidate.mode as BaseHalfVideoModeId } : {}),
		...(params !== undefined ? { params } : {})
	});
}

/** Validates a generation record. Throws with the field path. */
export function normalizeBaseHalfVideoGenerationRecord(value: unknown, path = 'request'): IBaseHalfVideoGenerationRecord {
	const candidate = object(value, path, ['provider', 'model', 'prompt', 'inputs', 'mode', 'ratio', 'resolution', 'duration', 'audio']);
	if (!BASEHALF_VIDEO_PROVIDER_KINDS.includes(candidate.provider as BaseHalfVideoProviderKind)) {
		throw error(`${path}.provider must be one of ${BASEHALF_VIDEO_PROVIDER_KINDS.join(', ')}.`);
	}
	if (!Array.isArray(candidate.inputs)) {
		throw error(`${path}.inputs must be an array.`);
	}
	if (candidate.inputs.length > BASEHALF_VIDEO_MAX_INPUTS) {
		throw error(`${path}.inputs has more than ${BASEHALF_VIDEO_MAX_INPUTS} entries.`);
	}
	const inputs = candidate.inputs.map((input, index) => text(input, `${path}.inputs[${index}]`, MAX_PATH_LENGTH, false));
	return Object.freeze({
		provider: candidate.provider as BaseHalfVideoProviderKind,
		model: modelId(candidate.model, `${path}.model`),
		prompt: prompt(candidate.prompt, `${path}.prompt`),
		inputs: Object.freeze(inputs),
		...normalizeSettings(candidate, path)
	});
}

/** Validates the `task` field of a Video node. Throws with the field path. */
export function normalizeBaseHalfVideoTask(value: unknown, path = 'task'): IBaseHalfVideoTask {
	const candidate = object(value, path, ['id', 'state', 'startedAt', 'endedAt', 'channel', 'remoteId', 'error', 'request']);
	const state = candidate.state;
	if (state !== 'submitting' && state !== 'running' && state !== 'failed' && state !== 'stopped') {
		throw error(`${path}.state must be submitting, running, failed, or stopped.`);
	}
	const remoteId = candidate.remoteId === undefined ? undefined : text(candidate.remoteId, `${path}.remoteId`, MAX_MODEL_LENGTH, false);
	const endedAt = candidate.endedAt === undefined ? undefined : timestamp(candidate.endedAt, `${path}.endedAt`);
	const message = candidate.error === undefined ? undefined : text(candidate.error, `${path}.error`, BASEHALF_VIDEO_ERROR_MAX_LENGTH, true);
	if (state === 'running' && remoteId === undefined) {
		throw error(`${path}.remoteId is required while the task is running.`);
	}
	if (state === 'submitting' && remoteId !== undefined) {
		throw error(`${path}.remoteId cannot be set while the task is submitting.`);
	}
	if ((state === 'failed' || state === 'stopped') !== (endedAt !== undefined)) {
		throw error(`${path}.endedAt is required exactly when the task has ended.`);
	}
	if (state === 'failed' && message === undefined) {
		throw error(`${path}.error is required when the task failed.`);
	}
	return Object.freeze({
		id: id(candidate.id, `${path}.id`),
		state,
		startedAt: timestamp(candidate.startedAt, `${path}.startedAt`),
		...(endedAt !== undefined ? { endedAt } : {}),
		channel: id(candidate.channel, `${path}.channel`),
		...(remoteId !== undefined ? { remoteId } : {}),
		...(message !== undefined ? { error: message } : {}),
		request: normalizeBaseHalfVideoGenerationRecord(candidate.request, `${path}.request`)
	});
}

/** Validates the `generation` field of a generated result. Throws with the field path. */
export function normalizeBaseHalfVideoResultGeneration(value: unknown, path = 'result.generation'): IBaseHalfVideoResultGeneration {
	const candidate = object(value, path, ['taskId', 'remoteId', 'startedAt', 'completedAt', 'request']);
	const remoteId = candidate.remoteId === undefined ? undefined : text(candidate.remoteId, `${path}.remoteId`, MAX_MODEL_LENGTH, false);
	return Object.freeze({
		taskId: id(candidate.taskId, `${path}.taskId`),
		...(remoteId !== undefined ? { remoteId } : {}),
		startedAt: timestamp(candidate.startedAt, `${path}.startedAt`),
		completedAt: timestamp(candidate.completedAt, `${path}.completedAt`),
		request: normalizeBaseHalfVideoGenerationRecord(candidate.request, `${path}.request`)
	});
}

/** Validates a prompt. Throws with the field path. */
export function normalizeBaseHalfVideoPrompt(value: unknown, path = 'prompt'): string {
	return prompt(value, path);
}

// --- transitions ----------------------------------------------------------------------------

/** Replaces the prompt. Allowed in every phase: it is what the next generation uses. */
export function setBaseHalfVideoPrompt<T extends IBaseHalfVideoNodeFields>(node: T, value: string): T {
	const next = prompt(value, 'prompt');
	return node.prompt === next ? node : { ...node, prompt: next };
}

/** Replaces the settings of the next generation. Allowed in every phase. */
export function setBaseHalfVideoGenerationSettings<T extends IBaseHalfVideoNodeFields>(node: T, settings: IBaseHalfVideoGenerationSettings): T {
	return { ...node, generation: normalizeBaseHalfVideoGenerationSettings(settings) };
}

export interface IBeginBaseHalfVideoTaskOptions {
	readonly id: string;
	readonly startedAt: string;
	readonly channel: string;
	readonly request: IBaseHalfVideoGenerationRecord;
}

/**
 * Records a new generation as `submitting`. A node that holds a video never
 * runs again: generating from it creates a new node instead. A failed or
 * stopped task is replaced.
 */
export function beginBaseHalfVideoTask<T extends IBaseHalfVideoNodeFields>(node: T, options: IBeginBaseHalfVideoTaskOptions): T {
	if (node.result) {
		throw error('This node already holds a video. Generating again makes a new node.');
	}
	if (isBaseHalfVideoTaskActive(node.task)) {
		throw error('This node is already generating.');
	}
	const task = normalizeBaseHalfVideoTask({
		id: options.id,
		state: 'submitting',
		startedAt: options.startedAt,
		channel: options.channel,
		request: options.request
	});
	return { ...node, task };
}

/** Records the provider's task id. The task becomes `running`. */
export function recordBaseHalfVideoRemoteId<T extends IBaseHalfVideoNodeFields>(node: T, taskId: string, remoteId: string): T {
	const task = activeTask(node, taskId);
	if (task.state !== 'submitting') {
		throw error('The provider task id is already recorded.');
	}
	return { ...node, task: normalizeBaseHalfVideoTask({ ...task, state: 'running', remoteId }) };
}

/** Ends the generation without a video because something failed. */
export function failBaseHalfVideoTask<T extends IBaseHalfVideoNodeFields>(node: T, taskId: string, message: string, endedAt: string): T {
	const task = activeTask(node, taskId);
	return { ...node, task: normalizeBaseHalfVideoTask({ ...task, state: 'failed', error: clip(message), endedAt }) };
}

/** Ends the generation without a video because the user stopped it. */
export function stopBaseHalfVideoTask<T extends IBaseHalfVideoNodeFields>(node: T, taskId: string, endedAt: string): T {
	const task = activeTask(node, taskId);
	const { error: _error, ...rest } = task;
	return { ...node, task: normalizeBaseHalfVideoTask({ ...rest, state: 'stopped', endedAt }) };
}

/** Ends the generation with its video. The task leaves the node; its record moves into the result. */
export function completeBaseHalfVideoTask<T extends IBaseHalfVideoNodeFields>(node: T, taskId: string, artifact: IBaseHalfNodeArtifact, completedAt: string): Omit<T, 'task'> & { readonly result: IBaseHalfNodeResult } {
	const task = activeTask(node, taskId);
	if (task.state !== 'running' || task.remoteId === undefined) {
		throw error('Only a running task can complete.');
	}
	const generation = normalizeBaseHalfVideoResultGeneration({
		taskId: task.id,
		remoteId: task.remoteId,
		startedAt: task.startedAt,
		completedAt,
		request: task.request
	});
	const { task: _task, ...rest } = node;
	const result: IBaseHalfNodeResult = Object.freeze({
		source: 'generated',
		artifact: Object.freeze({ kind: artifact.kind, path: artifact.path, size: artifact.size }),
		generation
	});
	return { ...rest, result };
}

/**
 * Settles a task that a window found `submitting` while no window runs it, for
 * instance after a restart. Whether the provider accepted the request is not
 * known, so the request is never sent again; the user is told to check.
 */
export function settleOrphanedBaseHalfVideoSubmission<T extends IBaseHalfVideoNodeFields>(node: T, message: string, endedAt: string): T {
	if (node.task?.state !== 'submitting') {
		return node;
	}
	return failBaseHalfVideoTask(node, node.task.id, message, endedAt);
}

/** The fields a new node made by generating again from `node` starts with. */
export function baseHalfVideoSiblingFields(node: IBaseHalfVideoNodeFields): IBaseHalfVideoNodeFields {
	return Object.freeze({
		prompt: node.prompt ?? '',
		...(node.generation ? { generation: node.generation } : {})
	});
}

function activeTask(node: IBaseHalfVideoNodeFields, taskId: string): IBaseHalfVideoTask {
	const task = node.task;
	if (!task || task.id !== taskId) {
		throw error('The generation is no longer the node\'s current task.');
	}
	if (!isBaseHalfVideoTaskActive(task)) {
		throw error('The generation has already ended.');
	}
	return task;
}

function clip(message: string): string {
	const trimmed = message.trim() || 'The generation failed.';
	return trimmed.length > BASEHALF_VIDEO_ERROR_MAX_LENGTH ? `${trimmed.slice(0, BASEHALF_VIDEO_ERROR_MAX_LENGTH - 1)}…` : trimmed;
}

// --- field readers ---------------------------------------------------------------------------

function normalizeSettings(candidate: Record<string, unknown>, path: string): IBaseHalfVideoSettings {
	if (candidate.mode !== 'frames' && candidate.mode !== 'reference') {
		throw error(`${path}.mode must be frames or reference.`);
	}
	if (typeof candidate.duration !== 'number' || !Number.isInteger(candidate.duration)
		|| (candidate.duration !== BASEHALF_VIDEO_AUTO_DURATION && (candidate.duration < 1 || candidate.duration > BASEHALF_VIDEO_MAX_DURATION))) {
		throw error(`${path}.duration must be a whole number of seconds from 1 to ${BASEHALF_VIDEO_MAX_DURATION}, or ${BASEHALF_VIDEO_AUTO_DURATION}.`);
	}
	if (typeof candidate.audio !== 'boolean') {
		throw error(`${path}.audio must be true or false.`);
	}
	return {
		mode: candidate.mode,
		ratio: setting(candidate.ratio, `${path}.ratio`),
		resolution: setting(candidate.resolution, `${path}.resolution`),
		duration: candidate.duration,
		audio: candidate.audio
	};
}

function object(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw error(`${path} must be an object.`);
	}
	const candidate = value as Record<string, unknown>;
	for (const key of Object.keys(candidate)) {
		if (!keys.includes(key)) {
			throw error(`${path}.${key} is not a known field.`);
		}
	}
	return candidate;
}

function text(value: unknown, path: string, maxLength: number, allowLineBreaks: boolean): string {
	if (typeof value !== 'string') {
		throw error(`${path} must be a string.`);
	}
	const trimmed = value.trim();
	if (!trimmed) {
		throw error(`${path} cannot be empty.`);
	}
	if (trimmed.length > maxLength) {
		throw error(`${path} is longer than ${maxLength} characters.`);
	}
	if ((allowLineBreaks ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/ : /[\u0000-\u001F]/).test(trimmed)) {
		throw error(`${path} contains control characters.`);
	}
	return trimmed;
}

function prompt(value: unknown, path: string): string {
	if (typeof value !== 'string') {
		throw error(`${path} must be a string.`);
	}
	if (value.length > BASEHALF_VIDEO_PROMPT_MAX_LENGTH) {
		throw error(`${path} is longer than ${BASEHALF_VIDEO_PROMPT_MAX_LENGTH} characters.`);
	}
	if (value.includes('\u0000')) {
		throw error(`${path} cannot contain NUL.`);
	}
	return value;
}

function id(value: unknown, path: string): string {
	const result = text(value, path, MAX_ID_LENGTH, false);
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) {
		throw error(`${path} contains unsupported characters.`);
	}
	return result;
}

function modelId(value: unknown, path: string): string {
	return text(value, path, MAX_MODEL_LENGTH, false);
}

/** Parameter names to text, numbers, or booleans: what a model's parameters take. */
function paramValues(value: unknown, path: string): BaseHalfVideoParams {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw error(`${path} must be an object.`);
	}
	const entries = Object.entries(value as Record<string, unknown>);
	if (entries.length > MAX_PARAMS) {
		throw error(`${path} has more than ${MAX_PARAMS} values.`);
	}
	const params: Record<string, BaseHalfVideoParamValue> = {};
	for (const [name, entry] of entries) {
		if (!PARAM_NAME_PATTERN.test(name)) {
			throw error(`${path}.${name} is not a parameter name.`);
		}
		if (typeof entry === 'string') {
			if (entry.length > MAX_PARAM_TEXT_LENGTH || entry.includes('\u0000')) {
				throw error(`${path}.${name} is longer than ${MAX_PARAM_TEXT_LENGTH} characters or contains NUL.`);
			}
		} else if (typeof entry === 'number') {
			if (!Number.isFinite(entry)) {
				throw error(`${path}.${name} must be a finite number.`);
			}
		} else if (typeof entry !== 'boolean') {
			throw error(`${path}.${name} must be text, a number, or true or false.`);
		}
		params[name] = entry;
	}
	return Object.freeze(params);
}

function setting(value: unknown, path: string): string {
	const result = text(value, path, MAX_SETTING_LENGTH, false);
	if (!/^[A-Za-z0-9][A-Za-z0-9:.*x_-]*$/.test(result)) {
		throw error(`${path} contains unsupported characters.`);
	}
	return result;
}

function timestamp(value: unknown, path: string): string {
	const result = text(value, path, MAX_TIMESTAMP_LENGTH, false);
	if (Number.isNaN(Date.parse(result))) {
		throw error(`${path} must be an ISO date and time.`);
	}
	return result;
}

function error(message: string): BaseHalfVideoNodeError {
	return new BaseHalfVideoNodeError(message);
}
