/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import {
	IBaseHalfMarkdownEditorApi,
	IBaseHalfMarkdownReuseEntry,
	buildBaseHalfMarkdownLoadProjection,
	spliceBaseHalfMarkdownSave,
	splitBaseHalfMarkdownFrontmatter
} from './basehalfMarkdownProjection.js';

export interface IBaseHalfMarkdownRichDocument {
	readonly blocks: readonly unknown[];
	replaceBlocks(blocks: readonly unknown[]): void;
}

export interface IBaseHalfMarkdownRichDiskWriteOptions {
	/**
	 * Compare and swap: the write is refused with
	 * {@link BaseHalfMarkdownRichDiskChangedError} unless the store still holds
	 * exactly this text when the write starts.
	 */
	readonly expected?: string;
}

export interface IBaseHalfMarkdownRichDisk {
	read(): Promise<string>;
	/**
	 * Resolves with the text the store holds right after this write when the
	 * store can report it (for example after line-ending normalization), and
	 * with nothing otherwise.
	 */
	write(content: string, options?: IBaseHalfMarkdownRichDiskWriteOptions): Promise<string | void>;
}

/** The store no longer holds the text a compare-and-swap write expected. */
export class BaseHalfMarkdownRichDiskChangedError extends Error {
	constructor() {
		super('The Markdown document changed before the rich editor could write it.');
	}
}

/**
 * The part of a Markdown document that the rich projection owns: everything
 * after the frontmatter the shared recognizer accepts.
 */
export function baseHalfMarkdownRichBody(content: string): string {
	return splitBaseHalfMarkdownFrontmatter(content).body;
}

/**
 * Joins frontmatter bytes and a rich body with the separator rule of
 * `spliceBaseHalfMarkdownSave`: a closing fence that ends the file gains the
 * frontmatter's line ending before a non-empty body.
 */
export function joinBaseHalfMarkdownRichFrontmatter(frontmatter: string, body: string): string {
	if (frontmatter !== '' && body !== '' && !/\n$/.test(frontmatter)) {
		const eol = frontmatter.includes('\r\n') ? '\r\n' : '\n';
		return frontmatter + eol + body;
	}
	return frontmatter + body;
}

/**
 * Rebases a rich body onto the frontmatter that `current` holds now. The rich
 * projection never writes frontmatter bytes from its own cache, so every save,
 * force-write, and projection handoff composes through this function.
 */
export function composeBaseHalfMarkdownRichContent(current: string, body: string): string {
	return joinBaseHalfMarkdownRichFrontmatter(splitBaseHalfMarkdownFrontmatter(current).frontmatter, body);
}

/**
 * Rich conflict detection compares bodies only: two texts that differ only in
 * their frontmatter never conflict.
 */
export function baseHalfMarkdownRichBodiesDiffer(a: string, b: string): boolean {
	return a !== b && baseHalfMarkdownRichBody(a) !== baseHalfMarkdownRichBody(b);
}

export interface IBaseHalfMarkdownRichBodyWriteRequest {
	/** The rich body, serialized without any frontmatter. */
	readonly body: string;
	/** The document text the rich projection last observed. Only its body is compared. */
	readonly previousContent: string;
	/** "Keep my edits": write the body even when the current body diverged. */
	readonly forceWrite: boolean;
}

export type BaseHalfMarkdownRichBodyWriteResult =
	| { readonly kind: 'noop'; readonly content: string }
	| { readonly kind: 'saved'; readonly content: string }
	| { readonly kind: 'blockedByConflict'; readonly disk: string }
	| { readonly kind: 'writeFailed'; readonly error: unknown };

const BASEHALF_MARKDOWN_RICH_WRITE_ATTEMPTS = 3;

/**
 * Writes a rich body under the document's current frontmatter.
 *
 * - The current text is read first. Without `forceWrite`, a body that diverged
 *   from `previousContent` is a conflict; a frontmatter-only change is not.
 * - The written text is the current frontmatter joined with the rich body, so
 *   an upstream edit made by an agent or by BaseHalf survives the save.
 * - The write carries a compare-and-swap guard. When the store changes between
 *   the read and the write, the save is planned again from the new text.
 */
export async function writeBaseHalfMarkdownRichBody(
	disk: IBaseHalfMarkdownRichDisk,
	request: IBaseHalfMarkdownRichBodyWriteRequest
): Promise<BaseHalfMarkdownRichBodyWriteResult> {
	for (let attempt = 1; ; attempt++) {
		let current: string;
		try {
			current = await disk.read();
		} catch (error) {
			return { kind: 'writeFailed', error };
		}

		if (!request.forceWrite && baseHalfMarkdownRichBodiesDiffer(current, request.previousContent)) {
			return { kind: 'blockedByConflict', disk: current };
		}

		const content = composeBaseHalfMarkdownRichContent(current, request.body);
		if (!request.forceWrite && content === current) {
			return { kind: 'noop', content: current };
		}

		try {
			const written = await disk.write(content, { expected: current });
			return { kind: 'saved', content: typeof written === 'string' ? written : content };
		} catch (error) {
			if (error instanceof BaseHalfMarkdownRichDiskChangedError && attempt < BASEHALF_MARKDOWN_RICH_WRITE_ATTEMPTS) {
				continue;
			}
			return { kind: 'writeFailed', error };
		}
	}
}

export interface IBaseHalfMarkdownRichView {
	readonly key: string;
	ownerPriority?(): number;
	setOwner(isOwner: boolean): void;
}

export interface IBaseHalfMarkdownRichSessionSnapshot {
	readonly key: string;
	readonly seeded: boolean;
	readonly ready: boolean;
	readonly pendingEdits: boolean;
	readonly conflict: boolean;
	readonly writeFailed: boolean;
	readonly frontmatter: string;
	readonly lastDisk: string;
	readonly viewCount: number;
	readonly owner: IBaseHalfMarkdownRichView | undefined;
}

export type BaseHalfMarkdownRichSaveResult =
	| { readonly kind: 'noop' }
	| { readonly kind: 'saved'; readonly content: string }
	| { readonly kind: 'blockedByConflict'; readonly disk: string }
	| { readonly kind: 'writeFailed'; readonly error: unknown };

export type BaseHalfMarkdownRichExternalChangeResult =
	| { readonly kind: 'echo' }
	| { readonly kind: 'frontmatterUpdated' }
	| { readonly kind: 'reloaded' }
	| { readonly kind: 'conflict'; readonly disk: string };

export interface IBaseHalfMarkdownRichSaveOptions {
	readonly forceSerialize?: boolean;
	readonly forceWrite?: boolean;
}

export class BaseHalfMarkdownRichSession {
	private readonly views = new Set<IBaseHalfMarkdownRichView>();
	private owner: IBaseHalfMarkdownRichView | undefined;
	private seeded = false;
	private ready = false;
	private pendingEdits = false;
	private conflictDisk: string | undefined;
	private writeFailedError: unknown;
	private frontmatter = '';
	private byId = new Map<string, IBaseHalfMarkdownReuseEntry>();
	private lastDisk = '';
	private readonly readyWaiters = new Set<() => void>();
	private destroyTimer: TimeoutHandle | undefined;

	constructor(
		readonly key: string,
		private readonly editor: IBaseHalfMarkdownEditorApi,
		private readonly document: IBaseHalfMarkdownRichDocument
	) { }

	get snapshot(): IBaseHalfMarkdownRichSessionSnapshot {
		return {
			key: this.key,
			seeded: this.seeded,
			ready: this.ready,
			pendingEdits: this.pendingEdits,
			conflict: this.conflictDisk !== undefined,
			writeFailed: this.writeFailedError !== undefined,
			frontmatter: this.frontmatter,
			lastDisk: this.lastDisk,
			viewCount: this.views.size,
			owner: this.owner
		};
	}

	acquireView(view: IBaseHalfMarkdownRichView): void {
		if (view.key !== this.key) {
			throw new Error(`View key ${view.key} cannot acquire rich session ${this.key}`);
		}

		if (this.destroyTimer !== undefined) {
			clearTimeout(this.destroyTimer);
			this.destroyTimer = undefined;
		}
		this.views.add(view);
		this.rebalanceOwner();
	}

	releaseView(view: IBaseHalfMarkdownRichView, onLastRelease?: () => void): void {
		if (!this.views.delete(view)) {
			return;
		}

		if (this.owner === view) {
			this.assignOwner(this.bestOwner());
		}
		if (this.views.size === 0 && this.destroyTimer === undefined) {
			this.destroyTimer = setTimeout(() => {
				this.destroyTimer = undefined;
				onLastRelease?.();
			}, 0);
		}
	}

	refreshOwner(view: IBaseHalfMarkdownRichView): void {
		if (!this.views.has(view)) {
			return;
		}
		this.rebalanceOwner();
	}

	isOwner(view: IBaseHalfMarkdownRichView): boolean {
		return this.owner === view;
	}

	claimSeed(): boolean {
		if (this.seeded) {
			return false;
		}
		this.seeded = true;
		return true;
	}

	onReady(callback: () => void): () => void {
		if (this.ready) {
			callback();
			return () => undefined;
		}

		this.readyWaiters.add(callback);
		return () => this.readyWaiters.delete(callback);
	}

	async seedFromContent(content: string): Promise<void> {
		const { frontmatter, body } = splitBaseHalfMarkdownFrontmatter(content);
		const { blocks, byId } = await buildBaseHalfMarkdownLoadProjection(this.editor, body);
		this.seeded = true;
		this.frontmatter = frontmatter;
		this.byId = byId;
		this.lastDisk = content;
		this.pendingEdits = false;
		this.conflictDisk = undefined;
		this.writeFailedError = undefined;
		this.document.replaceBlocks(blocks);
		this.markReady();
	}

	markSeedFailed(): void {
		this.seeded = true;
		this.markReady();
	}

	markEdited(): void {
		this.pendingEdits = true;
		this.writeFailedError = undefined;
	}

	async save(disk: IBaseHalfMarkdownRichDisk, options: IBaseHalfMarkdownRichSaveOptions = {}): Promise<BaseHalfMarkdownRichSaveResult> {
		if (this.conflictDisk !== undefined && !options.forceWrite) {
			return { kind: 'blockedByConflict', disk: this.conflictDisk };
		}

		const shouldSerialize = this.pendingEdits || options.forceSerialize === true || options.forceWrite === true;
		if (!shouldSerialize) {
			this.writeFailedError = undefined;
			return { kind: 'noop' };
		}

		// The block model never holds frontmatter. Serialize the body alone and
		// let the write rebase it onto the frontmatter the document holds now.
		const body = await spliceBaseHalfMarkdownSave(this.editor, this.document.blocks, '', this.byId);
		if (body === baseHalfMarkdownRichBody(this.lastDisk) && options.forceWrite !== true) {
			this.pendingEdits = false;
			this.writeFailedError = undefined;
			return { kind: 'noop' };
		}

		const result = await writeBaseHalfMarkdownRichBody(disk, {
			body,
			previousContent: this.lastDisk,
			forceWrite: options.forceWrite === true
		});
		switch (result.kind) {
			case 'noop':
				this.acceptDiskContent(result.content);
				this.pendingEdits = false;
				this.writeFailedError = undefined;
				return { kind: 'noop' };
			case 'saved':
				this.acceptDiskContent(result.content);
				this.pendingEdits = false;
				this.conflictDisk = undefined;
				this.writeFailedError = undefined;
				return { kind: 'saved', content: result.content };
			case 'blockedByConflict':
				this.conflictDisk = result.disk;
				return { kind: 'blockedByConflict', disk: result.disk };
			case 'writeFailed':
				// A vanished or racy read is not enough to drop local edits, and the
				// cached frontmatter is never a fallback: keep the edits pending.
				this.writeFailedError = result.error;
				this.pendingEdits = true;
				return { kind: 'writeFailed', error: result.error };
		}
	}

	async handleExternalContent(content: string): Promise<BaseHalfMarkdownRichExternalChangeResult> {
		if (content === this.lastDisk) {
			return { kind: 'echo' };
		}

		if (!baseHalfMarkdownRichBodiesDiffer(content, this.lastDisk)) {
			// A frontmatter-only change (an upstream edit, for example) never
			// touches the block model and never conflicts with local edits.
			this.acceptDiskContent(content);
			return { kind: 'frontmatterUpdated' };
		}

		if (this.pendingEdits || this.writeFailedError !== undefined) {
			this.conflictDisk = content;
			return { kind: 'conflict', disk: content };
		}

		await this.seedFromContent(content);
		return { kind: 'reloaded' };
	}

	async acceptExternalContent(): Promise<void> {
		if (this.conflictDisk === undefined) {
			return;
		}

		const disk = this.conflictDisk;
		await this.seedFromContent(disk);
	}

	/**
	 * "Keep my edits": write the local body over the diverged body, under the
	 * frontmatter the document holds now.
	 */
	async keepLocalContent(disk: IBaseHalfMarkdownRichDisk): Promise<BaseHalfMarkdownRichSaveResult> {
		this.conflictDisk = undefined;
		return this.save(disk, { forceWrite: true });
	}

	cancelPendingDestroy(): void {
		if (this.destroyTimer === undefined) {
			return;
		}
		clearTimeout(this.destroyTimer);
		this.destroyTimer = undefined;
	}

	dispose(): void {
		this.cancelPendingDestroy();
		this.readyWaiters.clear();
		this.assignOwner(undefined);
		this.views.clear();
	}

	/** A save result or a frontmatter-only change refreshes the cached frontmatter. */
	private acceptDiskContent(content: string): void {
		this.lastDisk = content;
		this.frontmatter = splitBaseHalfMarkdownFrontmatter(content).frontmatter;
	}

	private markReady(): void {
		if (this.ready) {
			return;
		}

		this.ready = true;
		for (const waiter of this.readyWaiters) {
			waiter();
		}
		this.readyWaiters.clear();
	}

	private ownerPriority(view: IBaseHalfMarkdownRichView): number {
		return view.ownerPriority?.() ?? 1;
	}

	private bestOwner(): IBaseHalfMarkdownRichView | undefined {
		let best: IBaseHalfMarkdownRichView | undefined;
		let bestPriority = Number.NEGATIVE_INFINITY;
		for (const view of this.views) {
			const priority = this.ownerPriority(view);
			if (priority > bestPriority) {
				best = view;
				bestPriority = priority;
			}
		}
		if (this.owner && this.views.has(this.owner) && this.ownerPriority(this.owner) === bestPriority) {
			return this.owner;
		}
		return best;
	}

	private rebalanceOwner(): void {
		this.assignOwner(this.bestOwner());
	}

	private assignOwner(next: IBaseHalfMarkdownRichView | undefined): void {
		const previous = this.owner;
		if (previous === next) {
			return;
		}

		this.owner = next;
		previous?.setOwner(false);
		next?.setOwner(true);
	}
}

export class BaseHalfMarkdownRichSessionRegistry {
	private readonly sessions = new Map<string, BaseHalfMarkdownRichSession>();

	get(key: string): BaseHalfMarkdownRichSession | undefined {
		return this.sessions.get(key);
	}

	ensure(key: string, create: () => { editor: IBaseHalfMarkdownEditorApi; document: IBaseHalfMarkdownRichDocument }): BaseHalfMarkdownRichSession {
		let session = this.sessions.get(key);
		if (!session) {
			const { editor, document } = create();
			session = new BaseHalfMarkdownRichSession(key, editor, document);
			this.sessions.set(key, session);
		}
		return session;
	}

	acquireView(
		view: IBaseHalfMarkdownRichView,
		create: () => { editor: IBaseHalfMarkdownEditorApi; document: IBaseHalfMarkdownRichDocument }
	): BaseHalfMarkdownRichSession {
		const session = this.ensure(view.key, create);
		session.acquireView(view);
		return session;
	}

	releaseView(view: IBaseHalfMarkdownRichView): void {
		const session = this.sessions.get(view.key);
		if (!session) {
			return;
		}

		session.releaseView(view, () => {
			if (session.snapshot.viewCount === 0) {
				this.sessions.delete(view.key);
				session.dispose();
			}
		});
	}

	clear(): void {
		for (const session of this.sessions.values()) {
			session.dispose();
		}
		this.sessions.clear();
	}
}

type TimeoutHandle = ReturnType<typeof setTimeout>;
