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

export interface IBaseHalfMarkdownRichDisk {
	read(): Promise<string>;
	write(content: string): Promise<void>;
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
	| { readonly kind: 'writeFailed'; readonly content: string; readonly error: unknown };

export type BaseHalfMarkdownRichExternalChangeResult =
	| { readonly kind: 'echo' }
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

		const content = await spliceBaseHalfMarkdownSave(this.editor, this.document.blocks, this.frontmatter, this.byId);
		if (content === this.lastDisk && options.forceWrite !== true) {
			this.pendingEdits = false;
			this.writeFailedError = undefined;
			return { kind: 'noop' };
		}

		if (!options.forceWrite) {
			try {
				const currentDisk = await disk.read();
				if (currentDisk !== this.lastDisk) {
					this.conflictDisk = currentDisk;
					return { kind: 'blockedByConflict', disk: currentDisk };
				}
			} catch {
				// Match the old rich editor: a vanished/racy read is not enough to drop
				// local edits. Let the write path surface the real outcome.
			}
		}

		try {
			await disk.write(content);
			this.lastDisk = content;
			this.pendingEdits = false;
			this.conflictDisk = undefined;
			this.writeFailedError = undefined;
			return { kind: 'saved', content };
		} catch (error) {
			this.writeFailedError = error;
			this.pendingEdits = true;
			return { kind: 'writeFailed', content, error };
		}
	}

	async handleExternalContent(content: string): Promise<BaseHalfMarkdownRichExternalChangeResult> {
		if (content === this.lastDisk) {
			return { kind: 'echo' };
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
