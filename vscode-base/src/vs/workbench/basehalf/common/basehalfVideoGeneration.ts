/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { URI } from '../../../base/common/uri.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { IBaseHalfVideoInputSource } from './basehalfVideoProviders.js';
import { BaseHalfVideoProviderKind, IBaseHalfVideoGenerationSettings, IBaseHalfVideoNodeFields } from './basehalfVideoNode.js';

/**
 * The services a Video node uses (D58). The node store reads and writes the
 * video fields of a `.bhnode`; the channel service holds the providers the
 * user set up on this computer; the generation service runs a generation from
 * the node's file to its video. The panel, the card, the Agent command line,
 * and the tests meet only these interfaces.
 */

// --- node store ------------------------------------------------------------------------------

export interface IBaseHalfVideoNodeSnapshot {
	readonly resource: URI;
	/** Workspace-relative path of the `.bhnode`. */
	readonly path: string;
	readonly id: string;
	readonly title: string;
	/** The valid upstream entries, in document order. */
	readonly upstream: readonly string[];
	readonly fields: IBaseHalfVideoNodeFields;
}

/** One upstream entry resolved for a generation: what it is and which file holds its content. */
export interface IBaseHalfVideoResolvedInput extends IBaseHalfVideoInputSource {
	/** The file to read: the entry itself, or the file a `.bhnode` shows. Absent when unavailable. */
	readonly file?: URI;
}

export const IBaseHalfVideoNodeStore = createDecorator<IBaseHalfVideoNodeStore>('baseHalfVideoNodeStore');

export interface IBaseHalfVideoNodeStore {
	readonly _serviceBrand: undefined;

	/** Fires after BaseHalf wrote a Video node, with its resource. */
	readonly onDidWrite: Event<URI>;

	/** Reads a Video node. Rejects when the file is not a readable Video node. */
	read(resource: URI): Promise<IBaseHalfVideoNodeSnapshot>;

	/**
	 * Applies `mutate` to the node's video fields and writes the file when they
	 * changed. Reads the file again and retries when it changed underneath;
	 * `mutate` may run more than once and must not have side effects. Rejects
	 * with `mutate`'s error, or when the file is gone.
	 *
	 * With `undoLabel`, the write is one step of the canvas undo stack.
	 */
	update(resource: URI, mutate: (fields: IBaseHalfVideoNodeFields) => IBaseHalfVideoNodeFields, options?: { readonly undoLabel?: string }): Promise<IBaseHalfVideoNodeSnapshot>;

	/** Replaces the node's upstream entries with the same entries in a new order, as one undo step. */
	reorderUpstream(resource: URI, upstream: readonly string[]): Promise<IBaseHalfVideoNodeSnapshot>;

	/** Resolves the node's upstream entries in order. */
	resolveInputs(snapshot: IBaseHalfVideoNodeSnapshot): Promise<readonly IBaseHalfVideoResolvedInput[]>;

	/**
	 * Creates a Video node beside `resource`, in the same folder, with the given
	 * fields and upstream entries, and returns its resource. Its card appears to
	 * the right of the original card.
	 */
	createSibling(resource: URI, fields: IBaseHalfVideoNodeFields, upstream: readonly string[]): Promise<URI>;

	/** Where a generated video of the node is written, inside the workspace. */
	videoTarget(snapshot: IBaseHalfVideoNodeSnapshot, taskId: string): URI;
}

// --- channels --------------------------------------------------------------------------------

/** A provider the user set up on this computer. The key is stored apart, encrypted. */
export interface IBaseHalfVideoChannel {
	readonly id: string;
	readonly provider: BaseHalfVideoProviderKind;
	readonly name: string;
	readonly baseUrl: string;
	/** The model ids this channel offers, in the user's order. */
	readonly models: readonly string[];
	readonly hasKey: boolean;
}

export interface IBaseHalfVideoChannelPatch {
	readonly name?: string;
	readonly baseUrl?: string;
	readonly models?: readonly string[];
}

export interface IBaseHalfVideoModelChoice {
	readonly channel: IBaseHalfVideoChannel;
	readonly model: string;
}

export const IBaseHalfVideoChannelService = createDecorator<IBaseHalfVideoChannelService>('baseHalfVideoChannelService');

export interface IBaseHalfVideoChannelService {
	readonly _serviceBrand: undefined;

	readonly onDidChange: Event<void>;

	getChannels(): readonly IBaseHalfVideoChannel[];
	getChannel(id: string): IBaseHalfVideoChannel | undefined;

	/**
	 * The channel that runs a model a node chose: the named channel while it
	 * still offers the model, otherwise the first channel that offers it.
	 */
	resolve(choice: { readonly channel?: string; readonly model?: string }): IBaseHalfVideoModelChoice | undefined;

	/** Adds a channel of a preset, with the preset's endpoint and models and no key. */
	addChannel(provider: BaseHalfVideoProviderKind): Promise<IBaseHalfVideoChannel>;
	updateChannel(id: string, patch: IBaseHalfVideoChannelPatch): Promise<void>;
	/** Stores or, with `undefined`, removes the channel's key. */
	setKey(id: string, key: string | undefined): Promise<void>;
	getKey(id: string): Promise<string | undefined>;
	removeChannel(id: string): Promise<void>;

	/** The model and settings the last generation on this computer used; a new Video node starts with them. */
	getLastUsed(): IBaseHalfVideoGenerationSettings | undefined;
	setLastUsed(settings: IBaseHalfVideoGenerationSettings): void;

	/** Opens the page where the user sets up providers. */
	openSettings(): Promise<void>;
}

// --- generation ------------------------------------------------------------------------------

/**
 * `preparing`: reading and encoding inputs. `submitting`: the request is on
 * its way. `queued` and `generating`: the provider has the task.
 * `downloading`: the video is being written into the workspace.
 */
export type BaseHalfVideoGenerationPhase = 'preparing' | 'submitting' | 'queued' | 'generating' | 'downloading';

export interface IBaseHalfVideoGenerationProgress {
	readonly phase: BaseHalfVideoGenerationPhase;
	/** Milliseconds since the epoch when the generation started. */
	readonly startedAt: number;
	/** 0 to 1 when the provider reports it. */
	readonly fraction?: number;
}

export class BaseHalfVideoGenerationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BaseHalfVideoGenerationError';
	}
}

export const IBaseHalfVideoGenerationService = createDecorator<IBaseHalfVideoGenerationService>('baseHalfVideoGenerationService');

export interface IBaseHalfVideoGenerationService {
	readonly _serviceBrand: undefined;

	/** Fires when a node's progress in this window changes. */
	readonly onDidChangeProgress: Event<URI>;

	/**
	 * Starts a generation from the node's prompt, settings, and inputs as its
	 * file holds them. When the node already holds a video, a new node is made
	 * beside it with the same prompt, settings, and inputs, and the generation
	 * runs there. Resolves with the node that runs, once its task is in its
	 * file. Rejects with a {@link BaseHalfVideoGenerationError} and writes
	 * nothing when the node cannot generate.
	 */
	generate(resource: URI): Promise<URI>;

	/** Stops the node's generation. The node keeps no video and shows that it stopped. */
	stop(resource: URI): Promise<void>;

	/**
	 * Continues a generation that the node's file records and no window runs:
	 * polls a `running` task, and settles a `submitting` one as failed. Safe to
	 * call again; a node already followed is left alone.
	 */
	resume(resource: URI): void;

	isGenerating(resource: URI): boolean;
	getProgress(resource: URI): IBaseHalfVideoGenerationProgress | undefined;
}
