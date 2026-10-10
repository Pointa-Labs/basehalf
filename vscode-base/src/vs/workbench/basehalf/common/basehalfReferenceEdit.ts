/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../base/common/buffer.js';
import { Event } from '../../../base/common/event.js';
import { URI } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { INotificationService, Severity } from '../../../platform/notification/common/notification.js';
import { IUndoRedoService, IWorkspaceUndoRedoElement, UndoRedoElementType, UndoRedoGroup, UndoRedoSource } from '../../../platform/undoRedo/common/undoRedo.js';
import { IBaseHalfWorkspaceResource } from './basehalfCanvasNavigation.js';
import { baseHalfUserFacingErrorMessage } from './basehalfPlainFailureReason.js';
import { IBaseHalfNodeDocument, IBaseHalfNodeInputBinding, IBaseHalfNodeUpstreamBindingRequest } from './basehalfNodeDocument.js';
import { IBaseHalfUpstreamItemValue } from './basehalfReferenceEntries.js';
import { BaseHalfUpstreamStoreKind, baseHalfUpstreamItemsEqual } from './basehalfReferenceStore.js';
import { IBaseHalfWorkspaceMutationStamp } from './basehalfWorkspaceMutation.js';

export const IBaseHalfReferenceEditService = createDecorator<IBaseHalfReferenceEditService>('baseHalfReferenceEditService');

/** Application-scope storage key of the one-time first-frontmatter notice. */
export const BASEHALF_REFERENCES_FIRST_FRONTMATTER_NOTICE_STORAGE_KEY = 'basehalf.references.firstFrontmatterNotice.v1';

/** How long a Markdown connect waits for the index's sealed-artifact check. */
export const BASEHALF_REFERENCE_INDEX_WAIT_MS = 10_000;
/** How long the edit service waits for the open projections of a document to flush. */
export const BASEHALF_REFERENCE_FLUSH_TIMEOUT_MS = 2_000;

/**
 * The state of one store as canvas undo compares it: the ordered items
 * (valid and invalid) and, for `.bhnode` documents, the recipe bindings.
 */
export interface IBaseHalfUpstreamStoreSnapshot {
	readonly items: readonly IBaseHalfUpstreamItemValue[];
	/** `.bhnode` only. */
	readonly bindings?: readonly IBaseHalfNodeInputBinding[];
	/**
	 * `.bhnode` only, recorded by a `nodeDocument` operation: the whole
	 * document in its serialized form. A Composer or node-surface save changes
	 * other fields (title, prompt, recipe parameters) in the same write as the
	 * upstream list and bindings, so canvas undo compares and restores the
	 * whole document.
	 */
	readonly document?: string;
}

/** Whether two store snapshots are identical. */
export function baseHalfUpstreamSnapshotsEqual(left: IBaseHalfUpstreamStoreSnapshot, right: IBaseHalfUpstreamStoreSnapshot): boolean {
	return baseHalfUpstreamItemsEqual(left.items, right.items)
		&& JSON.stringify(left.bindings ?? []) === JSON.stringify(right.bindings ?? [])
		&& (left.document ?? null) === (right.document ?? null);
}

/**
 * One reference operation on one downstream store. Entries are
 * workspace-relative paths in the downstream node's workspace folder, written
 * in the Unicode form of the name on disk and without a trailing slash.
 */
export type BaseHalfReferenceEditOperation =
	/** Appends an entry (connect, Add Upstream, Add Downstream, Composer Pick).
	 * `binding` (`.bhnode` Draft with a recipe only) binds it in the same
	 * write; an already listed unbound entry is bound, never listed twice. */
	| { readonly kind: 'add'; readonly entry: string; readonly binding?: IBaseHalfNodeUpstreamBindingRequest }
	/** Removes every item naming the entry (disconnect, ×). */
	| { readonly kind: 'remove'; readonly entry: string }
	/** Replaces the entry in place (source-end reconnect, Relink). */
	| { readonly kind: 'replace'; readonly from: string; readonly to: string }
	/** Replaces several entries in place in one write (rename refactor, Relink
	 * Everywhere). Each replacement follows `replace`; a `.bhnode` binding
	 * whose `sourcePath` names a replaced entry of a Draft is rewritten in the
	 * same write. With `onlyDangling`, the write re-checks under the workspace
	 * mutation lease that the old path of every replacement other than a
	 * spelling-only one still names no node, and refuses the store with
	 * `entryResolves` otherwise. */
	| { readonly kind: 'replaceEntries'; readonly replacements: readonly IBaseHalfUpstreamEntryReplacement[]; readonly onlyDangling?: boolean }
	/** Removes the item at `index` when its text is still `expected` (issue row Remove). */
	| { readonly kind: 'removeAt'; readonly index: number; readonly expected: string }
	/** Replaces the item at `index` when its text is still `expected` (Use Workspace Path, Relink of a row). */
	| { readonly kind: 'replaceAt'; readonly index: number; readonly expected: string; readonly to: string }
	/** Appends the entries the store does not list yet, in order (migration,
	 * Move into File). Entries the store already lists are skipped. */
	| { readonly kind: 'append'; readonly entries: readonly string[] }
	/** **Rebuild List**: writes a list BaseHalf cannot read, or will not edit in
	 * place, again as one block list of the valid entries it holds. Markdown
	 * and sidecar stores only; a store that is readable and writable is left
	 * as it is. */
	| { readonly kind: 'rebuild' }
	/** Canvas undo and redo: when the store holds `from`, write `to`; when it
	 * already holds `to`, complete without writing; otherwise refuse with
	 * `changedSinceEdit`. Across a multi-store operation the rule applies to
	 * every store together. `store` names the store to transition when it is
	 * not the node's own store (undo of Move into File re-creates the node's
	 * misplaced `sidecar`); it defaults to the node's own store. */
	| { readonly kind: 'transition'; readonly from: IBaseHalfUpstreamStoreSnapshot; readonly to: IBaseHalfUpstreamStoreSnapshot; readonly store?: BaseHalfUpstreamStoreKind }
	/** Composer input changes and node-surface saves of a `.bhnode` document:
	 * writes `next`, whose upstream list and bindings change together with its
	 * other fields, in one write when the document on disk still has the bytes
	 * `expected`, and refuses with `changedSinceEdit` otherwise. Its result
	 * snapshots carry the whole document, so canvas undo restores the other
	 * fields with the list. `.bhnode` stores only. */
	| { readonly kind: 'nodeDocument'; readonly expected: VSBuffer; readonly next: IBaseHalfNodeDocument };

/** One in-place entry replacement of a `replaceEntries` operation. */
export interface IBaseHalfUpstreamEntryReplacement {
	readonly from: string;
	readonly to: string;
}

export interface IBaseHalfReferenceStoreEdit {
	/** The downstream node whose store changes. */
	readonly node: IBaseHalfWorkspaceResource;
	readonly operation: BaseHalfReferenceEditOperation;
}

/** The structure of a workspace folder that an operation was planned against. */
export interface IBaseHalfReferenceStructureStamp {
	readonly workspaceFolder: URI;
	readonly stamp: IBaseHalfWorkspaceMutationStamp;
}

export interface IBaseHalfReferenceEditOptions {
	/** User-facing label of the Markdown bulk edit in the document's undo stack. */
	readonly label: string;
	/** Overrides how long an add into Markdown waits for the index (default 10 s). */
	readonly indexWaitMs?: number;
	/**
	 * The folder structure the operation was planned against (the rename
	 * refactor and Relink Everywhere plan from paths). When a structural change
	 * (a workbench move or delete) started in one of these folders since the
	 * stamp was captured, and before the operation holds the folder's
	 * workspace mutation lease, the operation is refused with `beingMoved` and
	 * no blocking store, and writes nothing, so the caller can re-plan.
	 */
	readonly plannedStructure?: readonly IBaseHalfReferenceStructureStamp[];
}

export type BaseHalfReferenceStoreOutcome = 'changed' | 'unchanged' | 'failed' | 'notAttempted';

export interface IBaseHalfReferenceStoreResult {
	readonly node: IBaseHalfWorkspaceResource;
	readonly storeKind: BaseHalfUpstreamStoreKind;
	readonly storeResource: URI;
	readonly outcome: BaseHalfReferenceStoreOutcome;
	/** The store state before the operation (what canvas undo writes back). */
	readonly expected: IBaseHalfUpstreamStoreSnapshot;
	/** The store state the operation wrote (or would have written). */
	readonly next: IBaseHalfUpstreamStoreSnapshot;
	/** A frontmatter block was added to a Markdown file that had none. */
	readonly createdFrontmatter?: boolean;
	readonly error?: string;
}

export interface IBaseHalfReferenceEditResult {
	readonly stores: readonly IBaseHalfReferenceStoreResult[];
	/** True when at least one store changed. */
	readonly changed: boolean;
}

/**
 * Why a reference operation wrote nothing. Every refusal is decided in the
 * preflight, before any store is written.
 */
export type BaseHalfReferenceRefusalReason =
	/** The resource stamp is stale or fenced: "This item is being moved". */
	| 'beingMoved'
	/** The Markdown model is read-only, orphaned, in conflict, in error, or binary. */
	| 'readonly' | 'orphaned' | 'conflict' | 'error' | 'binary'
	/** The frontmatter's closing fence lies beyond the first 64 KiB. */
	| 'frontmatterTooLarge'
	/** "Finish or resolve the unsaved edit in <file> first". */
	| 'flushFailed'
	/** "Save or revert <file> first" (unsaved changes with auto-save off). */
	| 'unsaved'
	/** The store is unreadable. */
	| 'unreadable'
	/** The document is not writable (rejected frontmatter, TOML, flow mapping, …). */
	| 'notWritable'
	/** Another tool keeps a value where the upstream list goes. */
	| 'foreign'
	/** The target is in the reserved outputs tree or is a sealed or imported
	 * Result artifact: BaseHalf never changes its store, including removals. */
	| 'upstreamOnly'
	/** The Markdown or `.bhnode` store is a symbolic link, lies below one, or
	 * resolves outside its workspace folder. BaseHalf never writes through links. */
	| 'symbolicLink'
	/** "Still loading connections": the index did not finish within 10 s. */
	| 'indexLoading'
	/** "This node is running". */
	| 'running'
	/** "This node already has 64 upstream entries". */
	| 'limit'
	/** A bound `.bhnode` entry or binding changes only in a Draft. */
	| 'boundOutsideDraft'
	/** A connect into a `.bhnode` with a recipe and an Attempt or Result:
	 * "Copy its settings to a new Draft". */
	| 'recipeFrozen'
	/** A binding was requested for a node without a Draft recipe, or it conflicts. */
	| 'binding'
	/** A sidecar write in a folder marked with `.basehalf-no-workspace-setup`. */
	| 'markedFolder'
	/** The downstream node does not exist. */
	| 'missingNode'
	/** The entry to write is not a valid entry for this node. */
	| 'invalidEntry'
	/** A replaced or positional entry is no longer listed. */
	| 'entryMissing'
	/** An `onlyDangling` replacement's old path names a node again. */
	| 'entryResolves'
	/** Canvas undo or redo: "<file> changed since this edit". */
	| 'changedSinceEdit';

export interface IBaseHalfReferenceBlockingStore {
	readonly node: IBaseHalfWorkspaceResource;
	readonly storeResource: URI;
	readonly reason: BaseHalfReferenceRefusalReason;
	/** Localized, user-facing explanation naming the file. */
	readonly message: string;
}

/**
 * Thrown when the preflight refuses an operation; nothing was written.
 * `blocking` is empty when no store blocks it: the structure the operation
 * was planned against (`plannedStructure`) changed.
 */
export class BaseHalfReferenceEditRefusal extends Error {
	override readonly name = 'BaseHalfReferenceEditRefusal';

	constructor(
		readonly reason: BaseHalfReferenceRefusalReason,
		message: string,
		/** Every store that blocks the operation, in operation order. */
		readonly blocking: readonly IBaseHalfReferenceBlockingStore[]
	) {
		super(message);
	}
}

/**
 * Thrown when a write failed after the preflight. The result lists exactly
 * which stores changed and which did not. The service has already shown the
 * user-facing notice (and logged the report); callers must not show another.
 */
export class BaseHalfReferenceEditFailure extends Error {
	override readonly name = 'BaseHalfReferenceEditFailure';

	constructor(message: string, readonly result: IBaseHalfReferenceEditResult) {
		super(message);
	}
}

/** The expected and next state of one store changed by an undoable operation. */
export interface IBaseHalfReferenceUndoStore {
	readonly node: IBaseHalfWorkspaceResource;
	/**
	 * The store the operation changed. One operation can change two stores of
	 * the same node (Move into File changes the file and removes its misplaced
	 * sidecar), so undo and redo transition exactly this store.
	 */
	readonly storeKind: BaseHalfUpstreamStoreKind;
	readonly expected: IBaseHalfUpstreamStoreSnapshot;
	readonly next: IBaseHalfUpstreamStoreSnapshot;
}

export type BaseHalfReferenceUndoOutcome = 'applied' | 'alreadyApplied' | 'refused';

export interface IBaseHalfReferenceUndoElementOptions {
	readonly label: string;
	/**
	 * The undo stacks the element joins. Pass the resource the canvas uses for
	 * its other undo elements (the folder's `canvas.yaml`), so a later canvas
	 * action clears this element's redo. Never pass a Markdown document URI:
	 * the document's own undo stack owns its text edit. `pushUndoElement` adds
	 * the node of every node document and sidecar store the step changed.
	 */
	readonly resources: readonly URI[];
	readonly stores: readonly IBaseHalfReferenceUndoStore[];
	/** The canvas undo source (`BASEHALF_CANVAS_UNDO_REDO_SOURCE`). */
	readonly source: UndoRedoSource;
	readonly code?: string;
	/** Called after every undo or redo attempt, e.g. to re-render the canvas. */
	readonly onDidRun?: (direction: 'undo' | 'redo', outcome: BaseHalfReferenceUndoOutcome) => void;
}

export interface IBaseHalfReferenceEditService {
	readonly _serviceBrand: undefined;

	/** Fires after BaseHalf added a frontmatter block to a Markdown file that had none. */
	readonly onDidCreateFrontmatter: Event<IBaseHalfWorkspaceResource>;

	/** Adds `entry` to `node`'s upstream list. */
	add(node: IBaseHalfWorkspaceResource, entry: string, options: IBaseHalfReferenceEditOptions, binding?: IBaseHalfNodeUpstreamBindingRequest): Promise<IBaseHalfReferenceEditResult>;
	/** Removes `entry` from `node`'s upstream list. */
	remove(node: IBaseHalfWorkspaceResource, entry: string, options: IBaseHalfReferenceEditOptions): Promise<IBaseHalfReferenceEditResult>;
	/** Replaces `from` with `to` in place in `node`'s upstream list. */
	replace(node: IBaseHalfWorkspaceResource, from: string, to: string, options: IBaseHalfReferenceEditOptions): Promise<IBaseHalfReferenceEditResult>;
	/**
	 * Moves an edge between downstream nodes (target-end reconnect): adds
	 * `entry` to `to`, and removes it from `from` only after the add is
	 * saved. If the add fails, `from` is not touched; if the removal fails
	 * after the add, both entries remain. Either failure is reported.
	 */
	move(entry: string, from: IBaseHalfWorkspaceResource, to: IBaseHalfWorkspaceResource, options: IBaseHalfReferenceEditOptions, binding?: IBaseHalfNodeUpstreamBindingRequest): Promise<IBaseHalfReferenceEditResult>;
	/**
	 * Runs one operation over several stores: preflight of every store (which
	 * writes nothing on failure), then every Markdown edit in one bulk edit and
	 * its saves, then node documents and sidecars. Non-Markdown stores listed
	 * before the first Markdown edit are written first.
	 *
	 * When the operation both adds and removes entries (a target-end
	 * reconnect, its undo, Move into File), every store that adds entries is
	 * written and saved first. The removals are applied only after all of
	 * them saved, so a failed add leaves both entries in place.
	 */
	apply(edits: readonly IBaseHalfReferenceStoreEdit[], options: IBaseHalfReferenceEditOptions): Promise<IBaseHalfReferenceEditResult>;
	/**
	 * The preflight of `apply` without any write: resolves and validates every
	 * store and returns the stores that would block the operation, in edit
	 * order (empty when it would run). It never flushes projections and never
	 * waits for the index. Migration uses it to exclude failing stores before
	 * the user confirms.
	 */
	check(edits: readonly IBaseHalfReferenceStoreEdit[]): Promise<readonly IBaseHalfReferenceBlockingStore[]>;
	/**
	 * **Move into File**: appends the entries of the node's misplaced
	 * `upstream.yaml` that its Markdown or `.bhnode` store does not already
	 * list, in order, then removes the `upstream.yaml`. The entries and the
	 * removal come from one read of the file: if it changed in between, the
	 * operation is refused. It is refused as well while the file holds an
	 * invalid entry other than a repeated one, so no entry is lost.
	 */
	moveIntoFile(node: IBaseHalfWorkspaceResource, options: IBaseHalfReferenceEditOptions): Promise<IBaseHalfReferenceEditResult>;
	/**
	 * **Rebuild List**: writes the node's list again in BaseHalf's own form,
	 * keeping the valid entries it holds. A Markdown list is rewritten through
	 * its document and belongs to that document's undo stack. A sidecar is
	 * first saved as a recovery copy. The caller has confirmed the operation.
	 */
	rebuild(node: IBaseHalfWorkspaceResource, options: IBaseHalfReferenceEditOptions): Promise<IBaseHalfReferenceEditResult>;
	/** The current snapshot of a node's store (the Markdown model when one is loaded, disk otherwise). */
	readSnapshot(node: IBaseHalfWorkspaceResource): Promise<IBaseHalfUpstreamStoreSnapshot | undefined>;
	/**
	 * Creates and pushes one canvas undo element for the stores an operation
	 * changed. Returns `undefined` (and pushes nothing) when nothing changed.
	 */
	pushUndoElement(result: IBaseHalfReferenceEditResult, options: Omit<IBaseHalfReferenceUndoElementOptions, 'stores'>): IWorkspaceUndoRedoElement | undefined;
}

/**
 * One canvas undo step for a reference operation, over any number of stores.
 *
 * Undo re-resolves every store and compares its current state: when every
 * store holds `next` it writes `expected` through the edit service (same
 * refusal and save rules); when every store holds `expected` it completes
 * without writing; otherwise it refuses with "<file> changed since this
 * edit" and writes nothing. Redo mirrors this.
 *
 * `IUndoRedoService` drops every stack of a failing element, so the element
 * never throws. A refused undo keeps the step: the element pushes a fresh
 * copy of itself back onto the undo stack (the redo history of its resources
 * is cleared), so canvas undo never skips it to undo an older step. A refused
 * redo leaves the step on the undo stack in its undone state: undoing it
 * again completes without writing, and redo can be retried.
 */
export class BaseHalfReferenceUndoElement implements IWorkspaceUndoRedoElement {
	readonly type = UndoRedoElementType.Workspace;
	readonly resources: readonly URI[];
	readonly label: string;
	readonly code: string;

	constructor(
		private readonly options: IBaseHalfReferenceUndoElementOptions,
		private readonly editService: IBaseHalfReferenceEditService,
		private readonly undoRedoService: IUndoRedoService,
		private readonly notificationService: INotificationService
	) {
		this.resources = options.resources;
		this.label = options.label;
		this.code = options.code ?? 'basehalf.references.edit';
	}

	undo(): Promise<void> {
		return this.run('undo');
	}

	redo(): Promise<void> {
		return this.run('redo');
	}

	private async run(direction: 'undo' | 'redo'): Promise<void> {
		const edits: IBaseHalfReferenceStoreEdit[] = this.options.stores.map(store => ({
			node: store.node,
			operation: direction === 'undo'
				? { kind: 'transition', from: store.next, to: store.expected, store: store.storeKind }
				: { kind: 'transition', from: store.expected, to: store.next, store: store.storeKind }
		}));
		let outcome: BaseHalfReferenceUndoOutcome;
		try {
			const result = await this.editService.apply(edits, { label: this.label });
			outcome = result.changed ? 'applied' : 'alreadyApplied';
		} catch (error) {
			outcome = 'refused';
			if (error instanceof BaseHalfReferenceEditFailure) {
				// Something may have been written and the service already showed
				// its notice: the step counts as run.
				this.options.onDidRun?.(direction, outcome);
				return;
			}
			this.notificationService.notify({
				severity: Severity.Warning,
				message: error instanceof Error ? baseHalfUserFacingErrorMessage(error) : localize('basehalf.references.undo.failed', "The connection change could not be undone.")
			});
			if (direction === 'undo') {
				// Nothing was written: keep the step on the undo stack.
				this.undoRedoService.pushElement(new BaseHalfReferenceUndoElement(this.options, this.editService, this.undoRedoService, this.notificationService), UndoRedoGroup.None, this.options.source);
			}
		}
		this.options.onDidRun?.(direction, outcome);
	}
}
