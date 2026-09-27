/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { basename } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { IDialogService } from '../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { INotificationService, IPromptChoice, Severity } from '../../../platform/notification/common/notification.js';
import { IProgressService, ProgressLocation } from '../../../platform/progress/common/progress.js';
import { IWorkspaceUndoRedoElement } from '../../../platform/undoRedo/common/undoRedo.js';
import { IUriIdentityService } from '../../../platform/uriIdentity/common/uriIdentity.js';
import { ITextFileService } from '../../services/textfile/common/textfiles.js';
import { BASEHALF_CANVAS_UNDO_REDO_SOURCE } from '../common/basehalfCanvasEditing.js';
import { IBaseHalfCanvasMirrorService } from '../common/basehalfCanvasMirror.js';
import { IBaseHalfWorkspaceResource } from '../common/basehalfCanvasNavigation.js';
import { baseHalfAssertMirrorPathComponentsNotSymbolicLink } from '../common/basehalfMirrorTree.js';
import { BASEHALF_NODE_DOCUMENT_MAX_BYTES, extractBaseHalfNodeUpstreamLenient } from '../common/basehalfNodeDocument.js';
import {
	BaseHalfReferenceEditFailure,
	BaseHalfReferenceEditRefusal,
	IBaseHalfReferenceEditResult,
	IBaseHalfReferenceEditService,
	IBaseHalfReferenceStoreEdit,
	IBaseHalfReferenceStoreResult,
	IBaseHalfReferenceUndoStore
} from '../common/basehalfReferenceEdit.js';
import { baseHalfUpstreamIdentity, baseHalfUpstreamResourceKey, IBaseHalfUpstreamIdentity } from '../common/basehalfReferenceEntries.js';
import { BaseHalfReferenceIndexState, baseHalfNodeUpstreamStoreRead, IBaseHalfReferenceIndexService } from '../common/basehalfReferenceIndex.js';
import { BASEHALF_UPSTREAM_FRONTMATTER_WINDOW_BYTES, baseHalfUpstreamSidecarResource, baseHalfUpstreamStoreKind, IBaseHalfUpstreamStoreRead, readBaseHalfMarkdownUpstream, readBaseHalfSidecarUpstream } from '../common/basehalfReferenceStore.js';
import {
	baseHalfPathIsCovered,
	baseHalfPlanRenameUpdate,
	baseHalfRemapMovedPath,
	baseHalfSnapshotRenameStores,
	IBaseHalfPathMove,
	IBaseHalfRenameLeftAlone,
	IBaseHalfRenameSkip,
	IBaseHalfRenameStore,
	IBaseHalfRenameStoreState,
	IBaseHalfRenameUpdatePlan
} from '../common/basehalfRenameRefactor.js';
import { IBaseHalfWorkspaceMutationCoordinator } from '../common/basehalfWorkspaceMutation.js';

export const IBaseHalfReferenceRefactorService = createDecorator<IBaseHalfReferenceRefactorService>('baseHalfReferenceRefactorService');

const SIDECAR_MAX_BYTES = 64 * 1024;
/** Files named in a report or a confirmation before "and N more". */
const REPORT_MAX_NAMES = 5;
/** How often an update re-plans after a move or an entry change refused its write. */
const MAX_REPLANS = 3;
const utf8Decoder = new TextDecoder('utf-8', { ignoreBOM: true });

/** What a refactor plans from: the moves and the stores snapshotted for them. */
export interface IBaseHalfReferenceRefactorInput {
	readonly moves: readonly IBaseHalfPathMove[];
	readonly stores: readonly IBaseHalfRenameStore[];
	/** Old paths that earlier unanswered plans own: entries they cover are never rewritten. */
	readonly exclude?: readonly string[];
}

export interface IBaseHalfReferenceRefactorApplyOptions {
	/** The label of the operation in the documents' undo stacks and in canvas undo. */
	readonly label: string;
	/** The resources the canvas undo element joins (a folder's `canvas.yaml`). */
	readonly undoResources: readonly URI[];
	/** Nodes whose `upstream.yaml` now belongs in their own file: their entries
	 * move into it in the same step, as **Move into file** does. */
	readonly moveIntoFile?: readonly IBaseHalfWorkspaceResource[];
	/** Called after the operation and after each undo or redo of it. */
	readonly onDidChange?: () => void;
	/**
	 * Resolves once the workbench moves in progress in the folder are composed
	 * into the input. The update waits for it before each attempt.
	 */
	readonly whenMovesSettled?: () => Promise<void>;
}

export interface IBaseHalfReferenceRefactorOutcome {
	readonly plan: IBaseHalfRenameUpdatePlan;
	/** Downstream nodes whose upstream list changed. */
	readonly updated: readonly IBaseHalfWorkspaceResource[];
	/** Nodes whose entries moved from BaseHalf metadata into their own file. */
	readonly movedIntoFile: readonly IBaseHalfWorkspaceResource[];
	/** The canvas undo element of the operation, when anything changed. */
	readonly undo?: IWorkspaceUndoRedoElement;
	/** The expected and next state of every store the operation changed. */
	readonly changedStores: readonly IBaseHalfReferenceUndoStore[];
	/** The label of the operation. */
	readonly label: string;
	/** Why the operation, or part of it, did not complete. */
	readonly errors: readonly unknown[];
}

export interface IBaseHalfRelinkEverywhereOptions {
	readonly undoResources?: readonly URI[];
	readonly onDidChange?: () => void;
}

/**
 * The multi-document side of the rename refactor and Relink Everywhere
 * (reference graph, "Rename refactor", "Relink Everywhere…"). Both re-plan
 * from the stores' current content, exclude the stores the reference edit
 * service refuses, before the user confirms or when the write finds them
 * (and list them as skipped), write every remaining store as one
 * multi-document operation, and push one canvas undo element.
 */
export interface IBaseHalfReferenceRefactorService {
	readonly _serviceBrand: undefined;

	/** Waits, with progress, until the folder's index finished a scan. */
	whenIndexReady(workspaceFolder: URI): Promise<BaseHalfReferenceIndexState | undefined>;
	/** Every indexed store whose entries name a moved path (outside `exclude`), at the paths the index has now. */
	snapshot(workspaceFolder: URI, moves: readonly IBaseHalfPathMove[], exclude?: readonly string[]): IBaseHalfRenameStore[];
	/** Re-plans from the stores' current content, without writing (the preview before the user confirms). */
	plan(workspaceFolder: URI, input: IBaseHalfReferenceRefactorInput): Promise<IBaseHalfRenameUpdatePlan>;
	/**
	 * Re-plans from `input()` and the stores' current content, and writes the
	 * plan as one multi-document operation and one canvas undo step. Never
	 * throws.
	 * - A store the edit service refuses at write time is excluded and listed
	 *   as skipped, and the others are written.
	 * - When a workbench move or delete in the folder started after planning
	 *   and before the write held the workspace lease, or an entry changed,
	 *   nothing was written: it waits for the move to settle and re-plans from
	 *   `input()`, which then includes the move.
	 * Resolves `undefined`, having written nothing, when `input()` returns
	 * `undefined` (a later move undid the rename).
	 */
	update(workspaceFolder: URI, input: () => IBaseHalfReferenceRefactorInput | undefined, options: IBaseHalfReferenceRefactorApplyOptions): Promise<IBaseHalfReferenceRefactorOutcome | undefined>;
	/** Shows the result: "Updated K items" with Undo, the skipped stores, and the entries left alone. */
	report(outcome: IBaseHalfReferenceRefactorOutcome, kind: 'rename' | 'relink'): void;
	/** Localized sentences naming the stores and entries a plan leaves out, with their reasons. */
	describeExclusions(plan: IBaseHalfRenameUpdatePlan): string[];
	/** Each skipped store as "name (reason)". */
	skippedNames(plan: IBaseHalfRenameUpdatePlan): string[];
	/** Joins names, with "and N more" past the first few. */
	names(values: readonly string[]): string;
	/**
	 * **Relink Everywhere…**: replaces the dangling path `from` with `to` in
	 * every store that names it, including entries below it when it was a
	 * folder, after the user confirms. Returns whether anything changed.
	 */
	relinkEverywhere(workspaceFolder: URI, from: string, to: string, options?: IBaseHalfRelinkEverywhereOptions): Promise<boolean>;
}

export class BaseHalfReferenceRefactorService implements IBaseHalfReferenceRefactorService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IBaseHalfReferenceIndexService private readonly referenceIndexService: IBaseHalfReferenceIndexService,
		@IBaseHalfReferenceEditService private readonly referenceEditService: IBaseHalfReferenceEditService,
		@IBaseHalfWorkspaceMutationCoordinator private readonly workspaceMutationCoordinator: IBaseHalfWorkspaceMutationCoordinator,
		@IBaseHalfCanvasMirrorService private readonly canvasMirrorService: IBaseHalfCanvasMirrorService,
		@IFileService private readonly fileService: IFileService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@INotificationService private readonly notificationService: INotificationService,
		@IDialogService private readonly dialogService: IDialogService,
		@IProgressService private readonly progressService: IProgressService,
		@ILogService private readonly logService: ILogService
	) { }

	async whenIndexReady(workspaceFolder: URI): Promise<BaseHalfReferenceIndexState | undefined> {
		if (this.referenceIndexService.getState(workspaceFolder) !== 'building') {
			return this.referenceIndexService.getState(workspaceFolder);
		}
		return this.progressService.withProgress({
			location: ProgressLocation.Window,
			title: localize('basehalf.references.refactor.loading', "Checking connections…")
		}, () => this.referenceIndexService.whenReady(workspaceFolder));
	}

	snapshot(workspaceFolder: URI, moves: readonly IBaseHalfPathMove[], exclude: readonly string[] = []): IBaseHalfRenameStore[] {
		return baseHalfSnapshotRenameStores(
			this.referenceIndexService.getStores(workspaceFolder),
			moves,
			this.identity(workspaceFolder),
			node => !!this.referenceIndexService.getUpstreamOnlyReason(node),
			exclude
		);
	}

	async plan(workspaceFolder: URI, input: IBaseHalfReferenceRefactorInput): Promise<IBaseHalfRenameUpdatePlan> {
		const { moves } = input;
		const exclude = input.exclude ?? [];
		const identity = this.identity(workspaceFolder);
		const states = await Promise.all(input.stores.map(store => this.readStoreState(workspaceFolder, identity, store)));
		// Which old paths name a node now: those entries are left alone.
		const existing = new Set<string>();
		await Promise.all(states.flatMap(state => (state.items ?? []).flatMap(item => {
			const path = item.path;
			if (path === undefined || baseHalfPathIsCovered(path, exclude, identity) || baseHalfRemapMovedPath(path, moves, identity) === undefined) {
				return [];
			}
			return [this.fileService.exists(this.node(workspaceFolder, path).resource).then(exists => {
				if (exists) {
					existing.add(identity.key(path));
				}
			}, () => undefined)];
		})));
		const planInput = { moves, identity, exclude, exists: (path: string) => existing.has(identity.key(path)) };
		const candidate = baseHalfPlanRenameUpdate({ ...planInput, stores: states });
		if (candidate.edits.length === 0) {
			return candidate;
		}
		// Exclude the stores the edit service would refuse, and list them.
		const blocking = await this.referenceEditService.check(candidate.edits.map(edit => this.storeEdit(edit)));
		if (blocking.length === 0) {
			return candidate;
		}
		const byNode = new Map(blocking.map(store => [this.key(store.node.resource), { reason: store.reason, message: store.message }]));
		return baseHalfPlanRenameUpdate({
			...planInput,
			stores: states.map(state => {
				const refusal = byNode.get(this.key(state.node.resource));
				return refusal ? { ...state, blocking: refusal } : state;
			})
		});
	}

	async update(workspaceFolder: URI, input: () => IBaseHalfReferenceRefactorInput | undefined, options: IBaseHalfReferenceRefactorApplyOptions): Promise<IBaseHalfReferenceRefactorOutcome | undefined> {
		const errors: unknown[] = [];
		const stores: IBaseHalfReferenceStoreResult[] = [];
		const collect = (result: IBaseHalfReferenceEditResult) => stores.push(...result.stores);
		// Stores the edit service refused at write time, by node.
		const refused = new Map<string, IBaseHalfRenameSkip>();
		let plan: IBaseHalfRenameUpdatePlan | undefined;
		for (let replans = 0; ;) {
			// The input and the structure it is planned against are taken
			// together, once the moves in progress are composed into the input:
			// a workbench move or delete in the folder after this point refuses
			// the write below, which then re-plans.
			await options.whenMovesSettled?.();
			const structure = { workspaceFolder, stamp: this.workspaceMutationCoordinator.capture(workspaceFolder) };
			const current = input();
			if (!current) {
				// Nothing was written (a refused write writes nothing): nothing to report.
				return undefined;
			}
			plan = this.withRefused(await this.plan(workspaceFolder, current), refused);
			if (plan.edits.length === 0) {
				break;
			}
			try {
				collect(await this.referenceEditService.apply(plan.edits.map(edit => this.storeEdit(edit)), { label: options.label, plannedStructure: [structure] }));
				break;
			} catch (error) {
				if (error instanceof BaseHalfReferenceEditRefusal) {
					const retry = this.retryAfterRefusal(error, plan, refused, replans >= MAX_REPLANS);
					if (retry === 'moved' || retry === 'replan') {
						replans++;
						if (retry === 'moved') {
							// Let the structural change that refused the write release the lease.
							await this.workspaceMutationCoordinator.runExclusive(workspaceFolder, async () => { });
						}
						continue;
					}
					if (retry === 'skip') {
						continue;
					}
				}
				errors.push(error);
				if (error instanceof BaseHalfReferenceEditFailure) {
					// The service told the user which files changed; keep that part undoable.
					collect(error.result);
				}
				break;
			}
		}
		if (stores.length === 0 && errors.length === 0 && !input()) {
			// A later move undid the rename while it was planned: nothing to report.
			return undefined;
		}
		const updated = this.changedNodes(stores);
		const edited = new Set(plan.edits.map(edit => this.key(edit.node.resource)));
		const movedIntoFile: IBaseHalfWorkspaceResource[] = [];
		for (const node of options.moveIntoFile ?? []) {
			if (edited.has(this.key(node.resource))) {
				// One step changes a store once; the list stays an issue with Move into File.
				continue;
			}
			try {
				const result = await this.referenceEditService.moveIntoFile(node, { label: options.label });
				collect(result);
				if (result.changed) {
					movedIntoFile.push(node);
				}
			} catch (error) {
				errors.push(error);
				if (error instanceof BaseHalfReferenceEditFailure) {
					collect(error.result);
				}
			}
		}
		const undo = this.referenceEditService.pushUndoElement({ stores, changed: stores.some(store => store.outcome === 'changed') }, {
			label: options.label,
			resources: options.undoResources,
			source: BASEHALF_CANVAS_UNDO_REDO_SOURCE,
			code: 'basehalf.references.refactor',
			onDidRun: () => options.onDidChange?.()
		});
		options.onDidChange?.();
		const changedStores = stores
			.filter(store => store.outcome === 'changed')
			.map(store => ({ node: store.node, storeKind: store.storeKind, expected: store.expected, next: store.next }));
		return { plan, updated, movedIntoFile, ...(undo ? { undo } : {}), changedStores, label: options.label, errors };
	}

	/**
	 * What a refused write means for the next attempt:
	 * - `moved`: a planned store or the folder's structure changed; re-plan
	 *   once the change released the lease and the moves are composed;
	 * - `replan`: an entry changed or its old path names a node again; re-plan
	 *   from the current content, which leaves it alone and reports it;
	 * - `skip`: the refused stores join `refused` and are listed as skipped;
	 *   the remaining stores are written;
	 * - `stop`: nothing new to exclude.
	 * Stores refused for a lasting reason are excluded in every case. Once the
	 * re-plans are `exhausted`, every refused store is excluded instead.
	 */
	private retryAfterRefusal(error: BaseHalfReferenceEditRefusal, plan: IBaseHalfRenameUpdatePlan, refused: Map<string, IBaseHalfRenameSkip>, exhausted: boolean): 'moved' | 'replan' | 'skip' | 'stop' {
		if (error.blocking.length === 0) {
			return exhausted ? 'stop' : 'moved';
		}
		const planned = new Map(plan.edits.map(edit => [this.key(edit.node.resource), edit.node]));
		let moved = false;
		let replan = false;
		let skipped = false;
		for (const store of error.blocking) {
			const transient = store.reason === 'beingMoved' || store.reason === 'entryMissing' || store.reason === 'entryResolves';
			if (transient && !exhausted) {
				moved ||= store.reason === 'beingMoved';
				replan = true;
				continue;
			}
			const key = this.key(store.node.resource);
			const node = planned.get(key);
			if (node && !refused.has(key)) {
				refused.set(key, { node, reason: store.reason, message: store.message });
				skipped = true;
			}
		}
		return moved ? 'moved' : replan ? 'replan' : skipped ? 'skip' : 'stop';
	}

	/** Moves the stores refused at write time from the plan's edits to its skipped stores. */
	private withRefused(plan: IBaseHalfRenameUpdatePlan, refused: ReadonlyMap<string, IBaseHalfRenameSkip>): IBaseHalfRenameUpdatePlan {
		if (refused.size === 0) {
			return plan;
		}
		const excluded = plan.edits.flatMap(edit => {
			const skip = refused.get(this.key(edit.node.resource));
			return skip ? [{ ...skip, node: edit.node }] : [];
		});
		if (excluded.length === 0) {
			return plan;
		}
		return {
			...plan,
			edits: plan.edits.filter(edit => !refused.has(this.key(edit.node.resource))),
			skipped: [...plan.skipped, ...excluded].sort((left, right) => left.node.relativePath.localeCompare(right.node.relativePath))
		};
	}

	report(outcome: IBaseHalfReferenceRefactorOutcome, kind: 'rename' | 'relink'): void {
		const parts: string[] = [];
		const count = outcome.updated.length;
		if (count > 0) {
			parts.push(kind === 'relink'
				? count === 1 ? localize('basehalf.references.relinked.one', "Relinked 1 item.") : localize('basehalf.references.relinked', "Relinked {0} items.", count)
				: count === 1 ? localize('basehalf.references.updated.one', "Updated 1 item.") : localize('basehalf.references.updated', "Updated {0} items.", count));
		}
		for (const node of outcome.movedIntoFile) {
			parts.push(localize('basehalf.references.movedIntoFile', "{0} now keeps its upstream list in the file.", basename(node.resource)));
		}
		if (count === 0 && outcome.movedIntoFile.length === 0) {
			parts.push(kind === 'relink'
				? localize('basehalf.references.relinked.none', "No upstream entries were relinked.")
				: localize('basehalf.references.updated.none', "No upstream entries were updated."));
		}
		parts.push(...this.describeExclusions(outcome.plan));
		for (const error of outcome.errors) {
			if (error instanceof BaseHalfReferenceEditRefusal) {
				parts.push(error.message);
			} else if (!(error instanceof BaseHalfReferenceEditFailure)) {
				// A failure already told the user which files changed.
				this.logService.error('[BaseHalf] upstream refactor failed', error);
				parts.push(error instanceof Error ? error.message : String(error));
			}
		}
		const choices: IPromptChoice[] = [];
		if (outcome.changedStores.length > 0) {
			choices.push({ label: localize('basehalf.references.undo', "Undo"), run: () => this.undo(outcome) });
		}
		const incomplete = outcome.errors.length > 0 || (count === 0 && outcome.movedIntoFile.length === 0);
		this.notificationService.prompt(incomplete ? Severity.Warning : Severity.Info, parts.join(' '), choices);
	}

	skippedNames(plan: IBaseHalfRenameUpdatePlan): string[] {
		return plan.skipped.map(skip => this.skipText(skip));
	}

	describeExclusions(plan: IBaseHalfRenameUpdatePlan): string[] {
		const out: string[] = [];
		if (plan.skipped.length > 0) {
			out.push(plan.skipped.length === 1
				? localize('basehalf.references.skipped.one', "1 item was skipped: {0}.", this.names(this.skippedNames(plan)))
				: localize('basehalf.references.skipped', "{0} items were skipped: {1}.", plan.skipped.length, this.names(this.skippedNames(plan))));
		}
		if (plan.leftAlone.length > 0) {
			out.push(plan.leftAlone.length === 1
				? localize('basehalf.references.leftAlone.one', "1 entry was left as it is: {0}.", this.names(plan.leftAlone.map(entry => this.leftAloneText(entry))))
				: localize('basehalf.references.leftAlone', "{0} entries were left as they are: {1}.", plan.leftAlone.length, this.names(plan.leftAlone.map(entry => this.leftAloneText(entry)))));
		}
		return out;
	}

	async relinkEverywhere(workspaceFolder: URI, from: string, to: string, options: IBaseHalfRelinkEverywhereOptions = {}): Promise<boolean> {
		const state = await this.whenIndexReady(workspaceFolder);
		const moves = [{ from, to }];
		const input = () => ({ moves, stores: this.snapshot(workspaceFolder, moves) });
		const plan = await this.plan(workspaceFolder, input());
		const count = plan.edits.length;
		if (count === 0) {
			const exclusions = this.describeExclusions(plan);
			this.notificationService.prompt(exclusions.length > 0 ? Severity.Warning : Severity.Info, [
				exclusions.length > 0
					? localize('basehalf.references.relinked.none', "No upstream entries were relinked.")
					: localize('basehalf.references.relinkEverywhere.nothing', "Nothing lists {0} as upstream any more.", from),
				...exclusions
			].join(' '), []);
			return false;
		}
		const atLeast = state === 'partial';
		const message = count === 1
			? atLeast
				? localize('basehalf.references.relinkEverywhere.confirm.atLeastOne', "Replace {0} with {1} in at least 1 item?", from, to)
				: localize('basehalf.references.relinkEverywhere.confirm.one', "Replace {0} with {1} in 1 item?", from, to)
			: atLeast
				? localize('basehalf.references.relinkEverywhere.confirm.atLeast', "Replace {0} with {1} in at least {2} items?", from, to, count)
				: localize('basehalf.references.relinkEverywhere.confirm', "Replace {0} with {1} in {2} items?", from, to, count);
		const detail = [
			this.names(plan.edits.map(edit => edit.node.relativePath)),
			...this.describeExclusions(plan)
		].join('\n');
		const { confirmed } = await this.dialogService.confirm({
			type: 'question',
			message,
			detail,
			primaryButton: localize({ key: 'basehalf.references.relinkEverywhere.button', comment: ['&& denotes a mnemonic'] }, "&&Relink Everywhere")
		});
		if (!confirmed) {
			return false;
		}
		// The confirmation may have waited: re-plan from the current content.
		const outcome = await this.update(workspaceFolder, input, {
			label: localize('basehalf.references.relinkEverywhere.undo', "Relink everywhere"),
			undoResources: options.undoResources ?? [this.canvasResource(workspaceFolder, '')],
			...(options.onDidChange ? { onDidChange: options.onDidChange } : {})
		});
		if (!outcome) {
			return false;
		}
		this.report(outcome, 'relink');
		return outcome.updated.length > 0;
	}

	//#region Helpers

	/** Reads one planned store at its current path: the Markdown model when loaded, disk otherwise. */
	private async readStoreState(workspaceFolder: URI, identity: IBaseHalfUpstreamIdentity, store: IBaseHalfRenameStore): Promise<IBaseHalfRenameStoreState> {
		const node = this.node(workspaceFolder, store.nodePath);
		const base = {
			node,
			snapshotEntries: store.entries,
			upstreamOnly: store.upstreamOnly || !!this.referenceIndexService.getUpstreamOnlyReason(node)
		};
		let isDirectory: boolean;
		try {
			isDirectory = (await this.fileService.stat(node.resource)).isDirectory;
		} catch {
			return {
				...base,
				storeKind: store.storeKind,
				items: undefined,
				blocking: { reason: 'missingNode', message: localize('basehalf.references.refactor.missing', "{0} no longer exists.", basename(node.resource)) }
			};
		}
		const storeKind = baseHalfUpstreamStoreKind(store.nodePath, isDirectory);
		const options = { nodePath: store.nodePath, identity };
		try {
			let read: IBaseHalfUpstreamStoreRead;
			if (storeKind === 'markdown') {
				const model = this.textFileService.files.get(node.resource);
				const text = model?.isResolved()
					? model.textEditorModel.getValue()
					: utf8Decoder.decode((await this.fileService.readFile(node.resource, { length: BASEHALF_UPSTREAM_FRONTMATTER_WINDOW_BYTES })).value.buffer);
				read = readBaseHalfMarkdownUpstream(text, options);
			} else if (storeKind === 'node') {
				const text = utf8Decoder.decode((await this.fileService.readFile(node.resource, { limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES } })).value.buffer);
				const extract = extractBaseHalfNodeUpstreamLenient(text);
				read = baseHalfNodeUpstreamStoreRead(extract, store.nodePath, identity);
				if (extract.readable) {
					return { ...base, storeKind, items: read.readable ? read.items : undefined, lifecycle: extract.lifecycle, bindings: extract.bindings };
				}
			} else {
				const sidecar = baseHalfUpstreamSidecarResource(workspaceFolder, store.nodePath);
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, sidecar);
				let text: string | undefined;
				try {
					text = utf8Decoder.decode((await this.fileService.readFile(sidecar, { limits: { size: SIDECAR_MAX_BYTES } })).value.buffer);
				} catch {
					text = undefined;
				}
				read = readBaseHalfSidecarUpstream(text, options);
			}
			return { ...base, storeKind, items: read.readable ? read.items : undefined };
		} catch (error) {
			this.logService.warn(`[BaseHalf] could not read the upstream list of ${store.nodePath}`, error);
			return { ...base, storeKind, items: undefined };
		}
	}

	private storeEdit(edit: IBaseHalfRenameUpdatePlan['edits'][number]): IBaseHalfReferenceStoreEdit {
		// The write re-checks under the lease that every old path still names no node.
		return { node: edit.node, operation: { kind: 'replaceEntries', replacements: edit.replacements, onlyDangling: true } };
	}

	private changedNodes(stores: readonly IBaseHalfReferenceStoreResult[]): IBaseHalfWorkspaceResource[] {
		const nodes = new Map<string, IBaseHalfWorkspaceResource>();
		for (const store of stores) {
			if (store.outcome === 'changed') {
				nodes.set(this.key(store.node.resource), store.node);
			}
		}
		return [...nodes.values()];
	}

	/**
	 * The report's **Undo**: restores every changed store under the rules of
	 * canvas undo (each store must still hold what the operation wrote). The
	 * canvas undo step stays on its stack; when canvas undo reaches it, it
	 * finds the stores restored and completes without writing, and redo then
	 * applies the operation again.
	 */
	private async undo(outcome: IBaseHalfReferenceRefactorOutcome): Promise<void> {
		try {
			await this.referenceEditService.apply(outcome.changedStores.map(store => ({
				node: store.node,
				operation: { kind: 'transition', from: store.next, to: store.expected, store: store.storeKind }
			})), { label: outcome.label });
		} catch (error) {
			if (error instanceof BaseHalfReferenceEditFailure) {
				// The edit service told the user which files changed.
				return;
			}
			this.notificationService.notify({
				severity: Severity.Warning,
				message: error instanceof Error ? error.message : localize('basehalf.references.undoFailed', "The upstream change could not be undone.")
			});
		}
	}

	private skipText(skip: IBaseHalfRenameSkip): string {
		const name = basename(skip.node.resource);
		switch (skip.reason) {
			case 'historical':
				return localize('basehalf.references.skip.historical', "{0} (its assigned inputs keep the paths they had when its attempt or result was made)", name);
			case 'upstreamOnly':
				return localize('basehalf.references.skip.upstreamOnly', "{0} (a result or output file, which can't receive upstream context)", name);
			case 'unreadable':
				return localize('basehalf.references.skip.unreadable', "{0} (its upstream list can't be read)", name);
			default:
				return skip.message ? localize('basehalf.references.skip.reason', "{0} ({1})", name, skip.message.replace(/\.$/, '')) : name;
		}
	}

	private leftAloneText(entry: IBaseHalfRenameLeftAlone): string {
		const name = basename(entry.node.resource);
		return entry.reason === 'resolves'
			? localize('basehalf.references.leftAlone.resolves', "{0} in {1} (that path names an item again)", entry.entry, name)
			: localize('basehalf.references.leftAlone.changed', "{0} in {1} (the entry changed since the move)", entry.entry, name);
	}

	/** Joins names, with "and N more" past the first few. */
	names(values: readonly string[]): string {
		if (values.length <= REPORT_MAX_NAMES) {
			return values.join(', ');
		}
		return localize('basehalf.references.andMore', "{0}, and {1} more", values.slice(0, REPORT_MAX_NAMES).join(', '), values.length - REPORT_MAX_NAMES);
	}

	private canvasResource(workspaceFolder: URI, relativePath: string): URI {
		return this.canvasMirrorService.canvasResource({
			resource: relativePath ? URI.joinPath(workspaceFolder, ...relativePath.split('/')) : workspaceFolder,
			workspaceFolder,
			relativePath,
			source: 'api'
		});
	}

	private node(workspaceFolder: URI, relativePath: string): IBaseHalfWorkspaceResource {
		return { resource: URI.joinPath(workspaceFolder, ...relativePath.split('/')), workspaceFolder, relativePath };
	}

	private identity(workspaceFolder: URI): IBaseHalfUpstreamIdentity {
		return baseHalfUpstreamIdentity(workspaceFolder, this.uriIdentityService.extUri);
	}

	private key(resource: URI): string {
		return baseHalfUpstreamResourceKey(resource, this.uriIdentityService.extUri);
	}

	//#endregion
}

registerSingleton(IBaseHalfReferenceRefactorService, BaseHalfReferenceRefactorService, InstantiationType.Delayed);
