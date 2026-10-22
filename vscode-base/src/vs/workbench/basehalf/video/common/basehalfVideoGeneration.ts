/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import {
	BaseHalfVideoCatalogState,
	BaseHalfVideoImageFormat,
	IBaseHalfVideoCatalog,
	IBaseHalfVideoCatalogProvider,
	IBaseHalfVideoCheckRequest,
	IBaseHalfVideoCheckResult,
	IBaseHalfVideoGenerationChoice,
	IBaseHalfVideoInputPlanItem,
	IBaseHalfVideoInputSource,
	IBaseHalfVideoPlannedMedia,
	IBaseHalfVideoProviderAccess,
	IBaseHalfVideoProviderSetup
} from './basehalfVideoCatalog.js';
import { IBaseHalfVideoNodeFields } from './basehalfVideoNode.js';
import { BaseHalfGenerationKind, IBaseHalfGenerationInfo, IBaseHalfGenerationMade, IBaseHalfGenerationTask } from './basehalfGenerationInfo.js';

/**
 * The services a Video node uses (D58, D59). The node store reads and writes
 * the video fields of a `.bhnode`; the catalog service holds the model
 * catalog of AI Video; the provider settings service holds how the user set
 * up each provider on this computer; the generation service runs a generation
 * from the node's file to its video. The panel, the card, the Video Providers
 * page, the Agent command line, and the tests meet only these interfaces.
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

// --- catalog ---------------------------------------------------------------------------------

export const IBaseHalfVideoCatalogService = createDecorator<IBaseHalfVideoCatalogService>('baseHalfVideoCatalogService');

/**
 * The model catalog of this window (D59, video providers, "The catalog"). It
 * asks AI Video once, keeps the answer, and tries once more at once when the
 * request fails.
 */
export interface IBaseHalfVideoCatalogService {
	readonly _serviceBrand: undefined;

	/** Fires when the state changes: the catalog arrived, or it could not be loaded. */
	readonly onDidChange: Event<void>;

	/** What the window knows of the catalog. Reading it the first time starts loading it. */
	readonly state: BaseHalfVideoCatalogState;

	/** Asks for the catalog when there is none and no request is on its way: at the start, and again after one failed. */
	load(): void;

	/**
	 * Resolves with the catalog, waiting while it loads, for at most
	 * `timeout` milliseconds. Rejects with the reason it is not there.
	 */
	whenReady(timeout?: number): Promise<IBaseHalfVideoCatalog>;

	/** Has the provider module check a planned generation. Resolves `undefined` when AI Video does not answer. */
	check(request: IBaseHalfVideoCheckRequest): Promise<IBaseHalfVideoCheckResult | undefined>;
}

// --- provider settings -----------------------------------------------------------------------

/** How a provider of the catalog is set up on this computer. */
export interface IBaseHalfVideoProviderStatus extends IBaseHalfVideoProviderSetup {
	/** Where requests go: the endpoint the user entered, or the region's base URL. */
	readonly endpoint: string;
	/** Whether the user entered the endpoint. */
	readonly customEndpoint: boolean;
	/** The ids of the declared credentials whose value is set. */
	readonly credentials: ReadonlySet<string>;
}

export const IBaseHalfVideoProviderSettingsService = createDecorator<IBaseHalfVideoProviderSettingsService>('baseHalfVideoProviderSettingsService');

/**
 * The providers the user set up on this computer (D59, video providers,
 * "Credentials, regions, and endpoints"), and the last generation's values.
 * Credential values are read only when a request is sent.
 */
export interface IBaseHalfVideoProviderSettingsService {
	readonly _serviceBrand: undefined;

	/** Fires when a provider's settings or the last values change, also from another window. */
	readonly onDidChange: Event<void>;

	getStatus(provider: IBaseHalfVideoCatalogProvider): IBaseHalfVideoProviderStatus;

	setRegion(provider: IBaseHalfVideoCatalogProvider, regionId: string): Promise<void>;

	/** Stores the endpoint. Empty, or the region's base URL, goes back to the region's base URL. */
	setEndpoint(provider: IBaseHalfVideoCatalogProvider, endpoint: string): Promise<void>;

	/** Stores one credential value, or removes it with `undefined`. */
	setCredential(provider: IBaseHalfVideoCatalogProvider, credentialId: string, value: string | undefined): Promise<void>;

	/**
	 * Where a request goes and with what, read from the encrypted store; for a
	 * `region` other than the one in use, that region's base URL. `undefined`
	 * when a credential value is not set. Throws, with plain words for the
	 * user, when the stored values cannot be read.
	 */
	getAccess(provider: IBaseHalfVideoCatalogProvider, region?: string): Promise<IBaseHalfVideoProviderAccess | undefined>;

	/** The provider, model, mode, and values the last generation on this computer used; a new Video node starts with them. */
	getLastUsed(): IBaseHalfVideoGenerationChoice | undefined;
	setLastUsed(generation: IBaseHalfVideoGenerationChoice): void;

	/** Opens the page where the user sets up providers, on a provider when one is given. */
	openSettings(providerId?: string): Promise<void>;
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

	/**
	 * The planned inputs as a generation sends them (video node specification,
	 * "The panel"): images in a format the mode takes, or drawn to PNG, and
	 * videos and audio as files, for the panel's check. Rejects with a
	 * `BaseHalfVideoGenerationError` naming an input that is missing or not a
	 * file on this computer.
	 */
	prepareInputMedia(plan: readonly IBaseHalfVideoInputPlanItem[], inputs: readonly IBaseHalfVideoResolvedInput[], imageFormats: readonly BaseHalfVideoImageFormat[]): Promise<IBaseHalfVideoPlannedMedia>;

	isGenerating(resource: URI): boolean;
	getProgress(resource: URI): IBaseHalfVideoGenerationProgress | undefined;
}

// --- generation cards (D63) -----------------------------------------------------------------
//
// The services of a generation card: the card store reads and writes its
// generation information and lists drafts; the task record store keeps the
// records of `.bh/cache/generation/` of this computer; the draft operations
// rename, move, and delete a draft with all of its card information. They
// replace the node store above, which goes once nothing reads `.bhnode` files.

/** What a window knows of a generation card. */
export interface IBaseHalfGenerationCardSnapshot {
	/** The card's file, whether or not it exists. */
	readonly resource: URI;
	/** Workspace-relative path of the card. */
	readonly path: string;
	readonly kind: BaseHalfGenerationKind;
	/** Whether the file exists. A draft has none and no `made.yaml`. */
	readonly hasFile: boolean;
	/** What the next generation uses, field by field as far as it could be read. */
	readonly info: IBaseHalfGenerationInfo;
	/** `false` when `generation.yaml` was not YAML at all; a save keeps a recovery copy first. */
	readonly infoReadable: boolean;
	/** The record of the generation that made the file. */
	readonly made?: IBaseHalfGenerationMade;
	/** A `made.yaml` is there but cannot be read; it is left as it is. */
	readonly madeUnreadable?: boolean;
	/** The valid upstream entries, in order: the card's inputs. */
	readonly upstream: readonly string[];
}

/** A draft of a folder, as its canvas lists it. */
export interface IBaseHalfGenerationDraft {
	readonly resource: URI;
	/** The name its file will have. */
	readonly name: string;
	readonly kind: BaseHalfGenerationKind;
}

export const IBaseHalfGenerationCardStore = createDecorator<IBaseHalfGenerationCardStore>('baseHalfGenerationCardStore');

/** Reads and writes the generation information of cards (generation cards, "Card information"). */
export interface IBaseHalfGenerationCardStore {
	readonly _serviceBrand: undefined;

	/** Fires when the generation information of a card changed, written by BaseHalf, an agent, or git, with the card's resource. */
	readonly onDidChange: Event<URI>;

	/** Whether the item at `resource` is a generation card: a draft, or a file with a generation extension that has generation information. */
	isGenerationCard(resource: URI): Promise<boolean>;

	/** Reads a generation card. Rejects when `resource` is not one. */
	read(resource: URI): Promise<IBaseHalfGenerationCardSnapshot>;

	/** The drafts of a folder: generation information without `made.yaml` whose path names no item there. */
	listDrafts(folder: URI): Promise<readonly IBaseHalfGenerationDraft[]>;

	/**
	 * Changes what the card's next generation uses. Writes only the fields that
	 * `mutate` changed, against the bytes it read, and plans again when the file
	 * changed underneath; `mutate` may run more than once and must not have side
	 * effects. A file that is not YAML at all is first kept as a recovery copy.
	 */
	update(resource: URI, mutate: (info: IBaseHalfGenerationInfo) => IBaseHalfGenerationInfo): Promise<IBaseHalfGenerationCardSnapshot>;

	/** Replaces the card's upstream entries with the same entries in a new order, as one undo step. */
	reorderUpstream(resource: URI, upstream: readonly string[]): Promise<IBaseHalfGenerationCardSnapshot>;

	/** Resolves the card's upstream entries in order. An entry that names a draft resolves without a file. */
	resolveInputs(snapshot: IBaseHalfGenerationCardSnapshot): Promise<readonly IBaseHalfVideoResolvedInput[]>;

	/**
	 * The first free name in `folder` from `base` and `extension`, numbered as
	 * the canvas numbers what it creates, where a file, a folder, and a draft
	 * all count as taken.
	 */
	nextFreeName(folder: URI, base: string, extension: string, startOrdinal?: number): Promise<string>;

	/**
	 * Makes a draft: its `generation.yaml`, and its `upstream.yaml` when
	 * `upstream` is given, written first. Places no card; the caller does.
	 * Rejects when the name is taken.
	 */
	createDraft(folder: URI, name: string, info: IBaseHalfGenerationInfo, upstream?: readonly string[]): Promise<URI>;

	/** Writes the card's `made.yaml` once. Rejects when the card has one. */
	writeMade(resource: URI, made: IBaseHalfGenerationMade): Promise<void>;
}

export const IBaseHalfGenerationTaskStore = createDecorator<IBaseHalfGenerationTaskStore>('baseHalfGenerationTaskStore');

/** The task records of this computer (generation cards, "The task record"). */
export interface IBaseHalfGenerationTaskStore {
	readonly _serviceBrand: undefined;

	/** Fires when a record was written or removed, by this window or another one. */
	readonly onDidChange: Event<void>;

	/** The records of the open workspace folders, kept current by watching `.bh/cache/generation/`. */
	list(): readonly IBaseHalfGenerationTask[];

	/** The record that names the card: one that is not ended, or else the last one that ended. */
	forCard(resource: URI): IBaseHalfGenerationTask | undefined;

	/** Writes a record into `.bh/cache/generation/` of the workspace folder that holds its cards. */
	write(task: IBaseHalfGenerationTask): Promise<void>;

	/** Removes a record and its partial downloads. */
	remove(taskId: string): Promise<void>;

	/** Where the `index`-th output of a generation is downloaded: `.bh/cache/generation/<task id>-<n>.part`. */
	partFile(task: IBaseHalfGenerationTask, index: number): URI;

	/**
	 * Writes the new path of a card, or of every card below a folder, into the
	 * records that name it, after a move or a rename (generation cards, "Moving,
	 * renaming, copying, and undo"). Called inside the exclusive run of the move.
	 */
	retarget(from: URI, to: URI): Promise<void>;
}

/** What undoing a draft operation needs: every piece of the draft's card information. */
export interface IBaseHalfDraftSnapshot {
	readonly resource: URI;
	/** The draft's card information files by name (`generation.yaml`, `upstream.yaml`, `badge.yaml`, …), as bytes. */
	readonly files: ReadonlyMap<string, Uint8Array>;
}

export const IBaseHalfDraftOperations = createDecorator<IBaseHalfDraftOperations>('baseHalfDraftOperations');

/**
 * Renames, moves, and deletes drafts. A draft has no file, so these move or
 * remove its card information, its card row, and the task record that names
 * it, and rewrite the entries that name it, as a move of a file does
 * (generation cards, "Moving, renaming, copying, and undo").
 */
export interface IBaseHalfDraftOperations {
	readonly _serviceBrand: undefined;

	/** Renames or moves a draft to `target`, which must be free and keep the draft's kind. Resolves with `target`. */
	move(draft: URI, target: URI): Promise<URI>;

	/** Removes a draft's card information and card row. Resolves with what an undo needs. */
	delete(draft: URI): Promise<IBaseHalfDraftSnapshot>;

	/** Writes back a deleted draft, for undo. Rejects when its path is taken. */
	restore(snapshot: IBaseHalfDraftSnapshot): Promise<void>;
}
