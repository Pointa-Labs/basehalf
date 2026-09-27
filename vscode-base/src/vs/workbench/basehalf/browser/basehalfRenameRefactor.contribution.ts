/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise, timeout } from '../../../base/common/async.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { CancellationError } from '../../../base/common/errors.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { basename, dirname, isEqual, relativePath as getRelativePath } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { ResourceFileEdit } from '../../../editor/browser/services/bulkEditService.js';
import { CommandsRegistry } from '../../../platform/commands/common/commands.js';
import { ConfigurationTarget, IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { FileOperation, IFileService } from '../../../platform/files/common/files.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { INotificationHandle, INotificationService, IPromptChoice, Severity } from '../../../platform/notification/common/notification.js';
import { IUriIdentityService } from '../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { IFileOperationUndoRedoInfo, IWorkingCopyFileOperationPreconditionGuard, IWorkingCopyFileService, SourceTargetPair } from '../../services/workingCopy/common/workingCopyFileService.js';
import { IExplorerService } from '../../contrib/files/browser/files.js';
import { IFilesConfiguration, UndoConfirmLevel } from '../../contrib/files/common/files.js';
import { IBaseHalfCanvasMirrorService } from '../common/basehalfCanvasMirror.js';
import { IBaseHalfWorkspaceResource } from '../common/basehalfCanvasNavigation.js';
import { baseHalfIsWorkspaceFolderMarked } from '../common/basehalfLegacyCleanup.js';
import { baseHalfAssertMirrorPathComponentsNotSymbolicLink } from '../common/basehalfMirrorTree.js';
import { baseHalfUpstreamIdentity, IBaseHalfUpstreamIdentity } from '../common/basehalfReferenceEntries.js';
import { BaseHalfReferenceIndexState, IBaseHalfReferenceIndexService } from '../common/basehalfReferenceIndex.js';
import { baseHalfUpstreamSidecarResource, baseHalfUpstreamStoreKind, readBaseHalfSidecarUpstream } from '../common/basehalfReferenceStore.js';
import {
	BASEHALF_REFERENCES_UPDATE_ON_FILE_MOVE_SETTING,
	baseHalfComposeRenamePlan,
	baseHalfEffectiveMoves,
	baseHalfIsSpellingOnlyMove,
	baseHalfPrimaryMoves,
	baseHalfRelocateRenameStores,
	baseHalfUpdateOnFileMove,
	BASEHALF_WORKSPACE_AGENT_MOVE_COMMAND_ID,
	IBaseHalfAgentMoveArgument,
	IBaseHalfAgentMoveResult,
	IBaseHalfAgentMoveUpstreamResult,
	IBaseHalfPathMove,
	IBaseHalfRenameUpdatePlan,
	IBaseHalfRenamePlanState,
	IBaseHalfRenameStore
} from '../common/basehalfRenameRefactor.js';
import { IBaseHalfReferenceRefactorInput, IBaseHalfReferenceRefactorOutcome, IBaseHalfReferenceRefactorService } from './basehalfReferenceRefactorService.js';

const SIDECAR_MAX_BYTES = 64 * 1024;
/** How long an update that a move interrupted waits for moves in progress to finish. */
const MOVE_SETTLE_TIMEOUT_MS = 10_000;
const utf8Decoder = new TextDecoder('utf-8', { ignoreBOM: true });

/** One workspace folder's part of a prepared move. */
interface IPreparedRename {
	readonly workspaceFolder: URI;
	readonly pairs: readonly { readonly source: URI; readonly target: URI; readonly move: IBaseHalfPathMove }[];
	/** The index snapshot, or `undefined` while the index was still building. */
	readonly snapshot: readonly IBaseHalfRenameStore[] | undefined;
	/** The old paths of the plans that were unanswered when the move was prepared: they own those entries. */
	readonly exclude: readonly string[];
	/** Set when the move is an agent move: its plan answers itself and reports here. */
	readonly agent?: IAgentMoveRequest;
}

/** An agent move between its request and the end of its plan (reference graph, "Agent moves"). */
interface IAgentMoveRequest {
	/** What the plan did, or `undefined` when the move did not complete. */
	readonly result: DeferredPromise<IBaseHalfAgentMoveUpstreamResult | undefined>;
	/** Cancelled when the caller went away; the plan then reports like any other move. */
	readonly token: CancellationToken;
}

/** A node whose store kind changed to its own file, with the entries its moved `upstream.yaml` holds. */
interface IStoreKindChange {
	readonly node: IBaseHalfWorkspaceResource;
	readonly entries: number;
}

interface IPromptInfo {
	readonly atLeast: boolean;
	readonly storeKindChanges: readonly IStoreKindChange[];
	/** Stores the edit service would refuse, as "name (reason)". */
	readonly skipped: readonly string[];
}

/**
 * An unanswered rename in one workspace folder. It stays pending, and keeps
 * composing with later moves, until it is skipped or its update is written.
 */
interface IPendingRename {
	readonly workspaceFolder: URI;
	state: IBaseHalfRenamePlanState;
	/** The index was building when the move was prepared: snapshot once it is ready. */
	deferred: boolean;
	/** The user answered (or the plan settled): the prompt's actions do nothing any more. */
	answered: boolean;
	notification?: INotificationHandle;
	promptInfo?: IPromptInfo;
	/** An agent move: the plan never prompts and reports its result here. */
	readonly agent?: IAgentMoveRequest;
	/** The update's report is shown only when something needs the user's attention. */
	reportQuietly?: boolean;
}

/** The most items one list of an agent move result holds. */
const AGENT_MOVE_RESULT_MAX_ITEMS = 200;

export function capAgentMoveList(items: readonly string[]): string[] {
	return items.length <= AGENT_MOVE_RESULT_MAX_ITEMS
		? [...items]
		: [...items.slice(0, AGENT_MOVE_RESULT_MAX_ITEMS - 1), `… and ${items.length - AGENT_MOVE_RESULT_MAX_ITEMS + 1} more`];
}

/**
 * The rename refactor (reference graph, "Rename refactor"). When a node or
 * folder is moved or renamed through the workbench (any
 * `IWorkingCopyFileService` move: Explorer, canvas rename, drag-move,
 * paste-move, and undo or redo of a move), it offers to update the upstream
 * entries that name it:
 *
 * - The working-copy prepare step snapshots, from the index, every store whose
 *   entries name a moved path or a path inside a moved folder.
 * - After the move and its mirror cascade, the stores are mapped to their
 *   current paths. Unanswered plans compose with later moves.
 * - `basehalf.references.updateOnFileMove` decides: `prompt` shows one sticky
 *   notification per operation (closing it is Skip), `always` updates and
 *   reports with Undo, and `never` does nothing. A folder marked with the
 *   source-tree marker always prompts.
 * - Update re-plans from the stores' current content and runs as one
 *   multi-document operation and one canvas undo step. A plan being updated
 *   keeps composing with later moves until its write holds the workspace
 *   lease; a move that lands first makes it re-plan.
 * - A plan never rewrites entries that name the old paths of an earlier
 *   unanswered plan: that plan owns them and maps them through both moves.
 *
 * - An agent move (`basehalf.workspace.move`, reference graph "Agent moves")
 *   is a workbench move whose plan never prompts: it updates unless the
 *   setting is `never`, and reports what it did to the waiting operation.
 *
 * Moves outside the workbench are not refactored; Relink Everywhere repairs
 * their entries later.
 */
export class BaseHalfRenameRefactorContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.basehalf.renameRefactor';

	private readonly pending = new Set<IPendingRename>();
	/** Agent moves between their request and their prepare step, by source and target. */
	private readonly agentMoves = new Map<string, IAgentMoveRequest>();
	/** Workbench moves prepared but not yet composed, by workspace folder. */
	private readonly movesInFlight = new Map<string, number>();
	private settleWaiters: (() => void)[] = [];
	private disposed = false;

	constructor(
		@IWorkingCopyFileService workingCopyFileService: IWorkingCopyFileService,
		@IBaseHalfReferenceRefactorService private readonly refactorService: IBaseHalfReferenceRefactorService,
		@IBaseHalfReferenceIndexService private readonly referenceIndexService: IBaseHalfReferenceIndexService,
		@IBaseHalfCanvasMirrorService private readonly canvasMirrorService: IBaseHalfCanvasMirrorService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IFileService private readonly fileService: IFileService,
		@IExplorerService private readonly explorerService: IExplorerService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@INotificationService private readonly notificationService: INotificationService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this._register(workingCopyFileService.addFileOperationPrecondition({
			prepare: async (files, operation, undoInfo) => this.prepare(files, operation, undoInfo)
		}));
		this._register(CommandsRegistry.registerCommand(BASEHALF_WORKSPACE_AGENT_MOVE_COMMAND_ID, (_accessor, argument: IBaseHalfAgentMoveArgument, token?: CancellationToken) => this.agentMove(argument, token ?? CancellationToken.None)));
	}

	override dispose(): void {
		this.disposed = true;
		for (const plan of this.pending) {
			plan.answered = true;
			plan.notification?.close();
			plan.agent?.result.complete({ updated: [], skipped: [], notUpdated: 'BaseHalf closed the window before the entries were updated' });
		}
		this.pending.clear();
		for (const request of this.agentMoves.values()) {
			request.result.complete(undefined);
		}
		this.agentMoves.clear();
		this.releaseSettleWaiters();
		super.dispose();
	}

	//#region Planning

	/**
	 * Snapshots the stores that name a moved path, before anything moves. It
	 * never awaits, so it adds no await boundary ahead of the structural
	 * commit barrier of the mirror cascade.
	 */
	private prepare(files: readonly SourceTargetPair[], operation: FileOperation, undoInfo: IFileOperationUndoRedoInfo | undefined): IWorkingCopyFileOperationPreconditionGuard | undefined {
		if (operation !== FileOperation.MOVE) {
			return undefined;
		}
		const groups = new Map<string, { readonly workspaceFolder: URI; readonly pairs: { readonly source: URI; readonly target: URI; readonly move: IBaseHalfPathMove }[]; agent?: IAgentMoveRequest }>();
		let unplanned: IAgentMoveRequest | undefined;
		for (const pair of files) {
			if (!pair.source) {
				continue;
			}
			// An agent move is recognized by its source and target. Undo and redo of
			// it run as undoing, so they follow the setting like any other move.
			const agentKey = this.agentMoveKey(pair.source, pair.target);
			const agent = undoInfo?.isUndoing ? undefined : this.agentMoves.get(agentKey);
			if (agent) {
				this.agentMoves.delete(agentKey);
				unplanned = agent;
			}
			const from = this.location(pair.source);
			const to = this.location(pair.target);
			// Moves between workspace folders are refused by the mirror cascade.
			if (!from || !to || !isEqual(from.workspaceFolder, to.workspaceFolder) || from.relativePath === to.relativePath) {
				continue;
			}
			const key = from.workspaceFolder.toString();
			let group = groups.get(key);
			if (!group) {
				group = { workspaceFolder: from.workspaceFolder, pairs: [] };
				groups.set(key, group);
			}
			group.pairs.push({ source: pair.source, target: pair.target, move: { from: from.relativePath, to: to.relativePath } });
			if (agent) {
				group.agent = agent;
				unplanned = undefined;
			}
		}
		if (groups.size === 0) {
			// Nothing to plan: an agent move reports that nothing named it.
			unplanned?.result.complete({ updated: [], skipped: [] });
			return undefined;
		}
		const prepared: IPreparedRename[] = [...groups.values()].map(group => {
			const state = this.referenceIndexService.getState(group.workspaceFolder);
			const exclude = this.pendingOldPaths(group.workspaceFolder);
			return {
				...group,
				exclude,
				snapshot: state === 'ready' || state === 'partial' ? this.refactorService.snapshot(group.workspaceFolder, group.pairs.map(pair => pair.move), exclude) : undefined
			};
		});
		for (const group of prepared) {
			const key = group.workspaceFolder.toString();
			this.movesInFlight.set(key, (this.movesInFlight.get(key) ?? 0) + 1);
		}
		let completed: readonly SourceTargetPair[] = [];
		let disposed = false;
		return {
			didRun: async files => { completed = files; },
			didFail: async files => { completed = files; },
			// Guards are disposed after every guard of the operation finished, so
			// the mirror cascade has released its fences by the time a plan runs.
			dispose: () => {
				if (disposed) {
					return;
				}
				disposed = true;
				try {
					if (completed.length > 0 && !this.disposed) {
						this.didMove(prepared, completed);
					} else {
						for (const group of prepared) {
							group.agent?.result.complete(undefined);
						}
					}
				} finally {
					for (const group of prepared) {
						const key = group.workspaceFolder.toString();
						const count = (this.movesInFlight.get(key) ?? 1) - 1;
						if (count > 0) {
							this.movesInFlight.set(key, count);
						} else {
							this.movesInFlight.delete(key);
						}
					}
					this.releaseSettleWaiters();
				}
			}
		};
	}

	/** The old paths of every pending plan in the folder, including plans being updated. */
	private pendingOldPaths(workspaceFolder: URI): string[] {
		const paths = new Set<string>();
		for (const plan of this.pending) {
			if (isEqual(plan.workspaceFolder, workspaceFolder)) {
				for (const move of plan.state.moves) {
					paths.add(move.from);
				}
			}
		}
		return [...paths];
	}

	/** Resolves once no workbench move in the folder is between prepare and composition, or after a time limit. */
	private async whenMovesSettled(workspaceFolder: URI): Promise<void> {
		const key = workspaceFolder.toString();
		const deadline = Date.now() + MOVE_SETTLE_TIMEOUT_MS;
		while (!this.disposed && (this.movesInFlight.get(key) ?? 0) > 0) {
			const remaining = deadline - Date.now();
			if (remaining <= 0) {
				return;
			}
			const timer = timeout(remaining);
			try {
				await Promise.race([new Promise<void>(resolve => this.settleWaiters.push(resolve)), timer.then(undefined, () => undefined)]);
			} finally {
				timer.cancel();
			}
		}
	}

	private releaseSettleWaiters(): void {
		const waiters = this.settleWaiters;
		this.settleWaiters = [];
		for (const resolve of waiters) {
			resolve();
		}
	}

	/** Registers the plan of a completed move, synchronously, so later moves compose in order. */
	private didMove(prepared: readonly IPreparedRename[], completed: readonly SourceTargetPair[]): void {
		for (const group of prepared) {
			const moves = group.pairs
				.filter(pair => completed.some(file => file.source && isEqual(file.source, pair.source) && isEqual(file.target, pair.target)))
				.map(pair => pair.move);
			if (moves.length === 0) {
				group.agent?.result.complete(undefined);
				continue;
			}
			const identity = this.identity(group.workspaceFolder);
			// Pending moves compose: entries of an unanswered plan, or of one whose
			// update has not written yet, map through this move too.
			for (const plan of [...this.pending]) {
				if (!isEqual(plan.workspaceFolder, group.workspaceFolder)) {
					continue;
				}
				plan.state = baseHalfComposeRenamePlan(plan.state, moves, identity);
				if (baseHalfEffectiveMoves(plan.state.moves).length === 0) {
					this.settle(plan);
					plan.agent?.result.complete({ updated: [], skipped: [], notUpdated: 'a later move put the item back where it was' });
					plan.notification?.close();
				} else if (!plan.answered && plan.notification && plan.promptInfo) {
					plan.notification.updateMessage(this.promptMessage(plan, plan.promptInfo));
				}
			}
			const plan: IPendingRename = {
				workspaceFolder: group.workspaceFolder,
				state: {
					moves,
					stores: group.snapshot ? baseHalfRelocateRenameStores(group.snapshot, moves, identity) : [],
					storeKindChanges: moves.map(move => move.to),
					...(group.exclude.length > 0 ? { exclude: group.exclude } : {})
				},
				deferred: !group.snapshot,
				answered: false,
				...(group.agent ? { agent: group.agent } : {})
			};
			this.pending.add(plan);
			void timeout(0)
				.then(() => this.process(plan))
				.catch(error => this.logService.error('[BaseHalf] the rename refactor failed', error));
		}
	}

	private async process(plan: IPendingRename): Promise<void> {
		if (plan.agent) {
			return this.processAgentMove(plan, plan.agent);
		}
		return this.processWithSetting(plan);
	}

	/** Answers a plan as the setting says: update, prompt, or do nothing. */
	private async processWithSetting(plan: IPendingRename): Promise<void> {
		if (plan.answered || this.disposed) {
			return;
		}
		const folder = plan.workspaceFolder;
		const setting = baseHalfUpdateOnFileMove(this.configurationService.getValue(BASEHALF_REFERENCES_UPDATE_ON_FILE_MOVE_SETTING, { resource: folder }));
		if (setting === 'never') {
			this.settle(plan);
			return;
		}
		const indexState = await this.refactorService.whenIndexReady(folder);
		if (plan.answered || this.disposed) {
			return;
		}
		this.snapshotDeferred(plan);
		const storeKindChanges = await this.storeKindChanges(plan);
		if (plan.answered || this.disposed) {
			return;
		}
		if (plan.state.stores.length === 0 && storeKindChanges.length === 0) {
			this.settle(plan);
			return;
		}
		// A folder marked with the source-tree marker always prompts.
		const marked = await baseHalfIsWorkspaceFolderMarked(this.fileService, folder);
		if (plan.answered || this.disposed) {
			return;
		}
		if (setting === 'always' && !marked) {
			await this.update(plan);
			return;
		}
		// Stores the edit service would refuse are listed before the user confirms.
		const input = this.input(plan);
		const preview = input && input.stores.length > 0 ? await this.refactorService.plan(folder, input) : undefined;
		if (plan.answered || this.disposed) {
			return;
		}
		this.prompt(plan, {
			atLeast: indexState === 'partial',
			storeKindChanges,
			skipped: preview ? this.refactorService.skippedNames(preview) : []
		});
	}

	private snapshotDeferred(plan: IPendingRename): void {
		if (!plan.deferred) {
			return;
		}
		// The index was building when the move was prepared. Entries still
		// name the old paths, so the index finds the same stores now; a store
		// it still lists at its old path is mapped like a snapshot's.
		const folder = plan.workspaceFolder;
		plan.deferred = false;
		plan.state = { ...plan.state, stores: baseHalfRelocateRenameStores(this.refactorService.snapshot(folder, plan.state.moves, plan.state.exclude), plan.state.moves, this.identity(folder)) };
	}

	/**
	 * Nodes whose store kind changed from BaseHalf metadata to their own file
	 * (`notes.txt` → `notes.md`) and whose moved `upstream.yaml` holds entries.
	 */
	private async storeKindChanges(plan: IPendingRename): Promise<IStoreKindChange[]> {
		const folder = plan.workspaceFolder;
		const out: IStoreKindChange[] = [];
		for (const path of plan.state.storeKindChanges) {
			const move = plan.state.moves.find(candidate => candidate.to === path);
			const node = this.node(folder, path);
			try {
				const stat = await this.fileService.stat(node.resource);
				if (!move || stat.isDirectory || baseHalfUpstreamStoreKind(path, false) === 'sidecar' || baseHalfUpstreamStoreKind(move.from, false) !== 'sidecar') {
					continue;
				}
				const sidecar = baseHalfUpstreamSidecarResource(folder, path);
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, folder, sidecar);
				const text = utf8Decoder.decode((await this.fileService.readFile(sidecar, { limits: { size: SIDECAR_MAX_BYTES } })).value.buffer);
				const read = readBaseHalfSidecarUpstream(text, { nodePath: path, identity: this.identity(folder) });
				const entries = read.items.filter(item => item.path !== undefined).length;
				if (entries > 0) {
					out.push({ node, entries });
				}
			} catch {
				// No node, no moved upstream.yaml, or one that can't be read: nothing to offer.
			}
		}
		return out;
	}

	//#endregion

	//#region Prompt and update

	private prompt(plan: IPendingRename, info: IPromptInfo): void {
		plan.promptInfo = info;
		const count = plan.state.stores.length;
		const spelling = count > 0 && baseHalfIsSpellingOnlyMove(baseHalfEffectiveMoves(plan.state.moves), this.identity(plan.workspaceFolder));
		const choices: IPromptChoice[] = [
			{
				label: spelling
					? count === 1 ? localize('basehalf.renameRefactor.updateSpelling.one', "Update spelling in 1 item") : localize('basehalf.renameRefactor.updateSpelling', "Update spelling in {0} items", count)
					: localize('basehalf.renameRefactor.update', "Update"),
				run: () => this.update(plan)
			},
			{
				label: localize('basehalf.renameRefactor.alwaysUpdate', "Always Update"),
				run: async () => {
					await this.configurationService.updateValue(BASEHALF_REFERENCES_UPDATE_ON_FILE_MOVE_SETTING, 'always', ConfigurationTarget.USER);
					await this.update(plan);
				}
			},
			{
				label: localize('basehalf.renameRefactor.skip', "Skip"),
				run: () => this.settle(plan)
			}
		];
		plan.notification = this.notificationService.prompt(Severity.Info, this.promptMessage(plan, info), choices, {
			sticky: true,
			// Closing the notification without choosing is Skip.
			onCancel: () => this.settle(plan)
		});
	}

	private promptMessage(plan: IPendingRename, info: IPromptInfo): string {
		const identity = this.identity(plan.workspaceFolder);
		const moves = baseHalfPrimaryMoves(plan.state.moves, identity);
		const count = plan.state.stores.length;
		const parts: string[] = [];
		if (count > 0) {
			const spelling = baseHalfIsSpellingOnlyMove(baseHalfEffectiveMoves(plan.state.moves), identity);
			if (moves.length === 1) {
				const oldName = moves[0].from.slice(moves[0].from.lastIndexOf('/') + 1);
				parts.push(spelling
					? localize('basehalf.renameRefactor.renamed', "{0} was renamed to {1}.", oldName, moves[0].to)
					: localize('basehalf.renameRefactor.moved', "{0} moved to {1}.", oldName, moves[0].to));
			} else {
				parts.push(localize('basehalf.renameRefactor.movedMany', "{0} items moved.", moves.length));
			}
			if (spelling) {
				parts.push(count === 1 && !info.atLeast
					? localize('basehalf.renameRefactor.spelling.one', "1 item lists it with the old spelling, which tools that match exact spelling won't find.")
					: info.atLeast
						? localize('basehalf.renameRefactor.spelling.atLeast', "At least {0} items list it with the old spelling, which tools that match exact spelling won't find.", count)
						: localize('basehalf.renameRefactor.spelling', "{0} items list it with the old spelling, which tools that match exact spelling won't find.", count));
			} else if (moves.length === 1) {
				parts.push(count === 1 && !info.atLeast
					? localize('basehalf.renameRefactor.count.one', "1 item lists it as upstream. Update it?")
					: info.atLeast
						? localize('basehalf.renameRefactor.count.atLeast', "At least {0} items list it as upstream. Update them?", count)
						: localize('basehalf.renameRefactor.count', "{0} items list it as upstream. Update them?", count));
			} else {
				parts.push(count === 1 && !info.atLeast
					? localize('basehalf.renameRefactor.countMany.one', "1 item lists them as upstream. Update it?")
					: info.atLeast
						? localize('basehalf.renameRefactor.countMany.atLeast', "At least {0} items list them as upstream. Update them?", count)
						: localize('basehalf.renameRefactor.countMany', "{0} items list them as upstream. Update them?", count));
			}
			if (info.skipped.length > 0) {
				parts.push(info.skipped.length === 1
					? localize('basehalf.renameRefactor.skipped.one', "1 of them can't be updated: {0}.", this.refactorService.names(info.skipped))
					: localize('basehalf.renameRefactor.skipped', "{0} of them can't be updated: {1}.", info.skipped.length, this.refactorService.names(info.skipped)));
			}
			parts.push(localize('basehalf.renameRefactor.skipNote', "If you skip, they keep the old path and will show a broken upstream entry."));
		}
		for (const change of info.storeKindChanges) {
			const name = change.node.relativePath.slice(change.node.relativePath.lastIndexOf('/') + 1);
			parts.push(change.entries === 1
				? localize('basehalf.renameRefactor.storeKind.one', "{0} now keeps its upstream list in the file. Move its 1 entry?", name)
				: localize('basehalf.renameRefactor.storeKind', "{0} now keeps its upstream list in the file. Move its {1} entries?", name, change.entries));
		}
		return parts.join(' ');
	}

	/**
	 * Update: re-plans from the stores' current content and writes them as one
	 * step. The plan stays pending, so later moves keep composing into it, until
	 * the write is done; a move that lands before the write holds the lease
	 * makes it re-plan from the composed plan.
	 */
	private async update(plan: IPendingRename): Promise<IBaseHalfReferenceRefactorOutcome | undefined> {
		if (plan.answered || this.disposed) {
			return undefined;
		}
		plan.answered = true;
		const folder = plan.workspaceFolder;
		try {
			await this.refactorService.whenIndexReady(folder);
			const moves = baseHalfPrimaryMoves(plan.state.moves, this.identity(folder));
			if (!this.input(plan) || moves.length === 0) {
				return undefined;
			}
			const storeKindChanges = await this.storeKindChanges(plan);
			const outcome = await this.refactorService.update(folder, () => this.input(plan), {
				label: localize('basehalf.renameRefactor.undoLabel', "Update upstream paths"),
				undoResources: [this.parentCanvasResource(folder, moves[0].to)],
				moveIntoFile: storeKindChanges.map(change => change.node),
				whenMovesSettled: () => this.whenMovesSettled(folder)
			});
			// An agent move reports through its result; the notification appears
			// only when something needs the user's attention.
			const quiet = plan.reportQuietly && !plan.agent?.token.isCancellationRequested
				&& outcome?.errors.length === 0 && outcome.plan.skipped.length === 0 && outcome.plan.leftAlone.length === 0;
			if (outcome && !quiet) {
				this.refactorService.report(outcome, 'rename');
			}
			return outcome;
		} finally {
			this.pending.delete(plan);
		}
	}

	/** What the plan updates now, or `undefined` once later moves undid it (or it was settled). */
	private input(plan: IPendingRename): IBaseHalfReferenceRefactorInput | undefined {
		if (this.disposed || !this.pending.has(plan) || baseHalfEffectiveMoves(plan.state.moves).length === 0) {
			return undefined;
		}
		return { moves: plan.state.moves, stores: plan.state.stores, ...(plan.state.exclude ? { exclude: plan.state.exclude } : {}) };
	}

	private settle(plan: IPendingRename): void {
		plan.answered = true;
		this.pending.delete(plan);
	}

	//#endregion

	//#region Agent moves

	/**
	 * Runs one agent move as an Explorer move and waits for its plan (reference
	 * graph, "Agent moves"). The node command handler has validated both paths
	 * and resolved them to their spelling on disk.
	 */
	private async agentMove(argument: IBaseHalfAgentMoveArgument, token: CancellationToken): Promise<IBaseHalfAgentMoveResult> {
		if (token.isCancellationRequested || this.disposed) {
			throw new CancellationError();
		}
		const key = this.agentMoveKey(argument.source, argument.target);
		if (this.agentMoves.has(key)) {
			throw new Error(`'${argument.from}' is already being moved to '${argument.to}'.`);
		}
		const request: IAgentMoveRequest = { result: new DeferredPromise(), token };
		this.agentMoves.set(key, request);
		const oldName = basename(argument.source);
		const renamed = this.uriIdentityService.extUri.isEqual(dirname(argument.source), dirname(argument.target));
		let failure: { readonly error: unknown } | undefined;
		try {
			// From here on the move is committed: it and its plan complete even if
			// the caller goes away, so the token is not passed on.
			await this.explorerService.applyBulkEdit([new ResourceFileEdit(argument.source, argument.target, { overwrite: false })], {
				undoLabel: renamed
					? localize('basehalf.agentMove.renameUndo', "Rename {0} to {1}", oldName, basename(argument.target))
					: localize('basehalf.agentMove.moveUndo', "Move {0}", oldName),
				progressLabel: renamed
					? localize('basehalf.agentMove.renameProgress', "Renaming {0}", oldName)
					: localize('basehalf.agentMove.moveProgress', "Moving {0}", oldName),
				confirmBeforeUndo: this.configurationService.getValue<IFilesConfiguration>()?.explorer?.confirmUndo === UndoConfirmLevel.Verbose
			});
		} catch (error) {
			failure = { error };
		} finally {
			// The prepare step claims the request; one it never saw had nothing to plan.
			if (this.agentMoves.get(key) === request) {
				this.agentMoves.delete(key);
				request.result.complete(failure ? undefined : { updated: [], skipped: [] });
			}
		}
		const upstream = await request.result.p;
		if (!upstream) {
			throw failure?.error ?? new Error('The move did not complete.');
		}
		// A later stage that failed after the item moved does not undo the move: it is
		// reported first, and each list is capped once.
		const failureLine = failure ? [`the move completed, but BaseHalf then reported: ${failure.error instanceof Error ? failure.error.message : String(failure.error)}`] : [];
		return {
			from: argument.from,
			to: argument.to,
			upstream: {
				...upstream,
				updated: capAgentMoveList(upstream.updated),
				skipped: capAgentMoveList([...failureLine, ...upstream.skipped])
			}
		};
	}

	/** The plan of an agent move: never prompts, updates unless the setting is `never`, and always reports. */
	private async processAgentMove(plan: IPendingRename, request: IAgentMoveRequest): Promise<void> {
		let result: IBaseHalfAgentMoveUpstreamResult = { updated: [], skipped: [] };
		let promptInstead = false;
		try {
			if (plan.answered || this.disposed) {
				return;
			}
			const folder = plan.workspaceFolder;
			const setting = baseHalfUpdateOnFileMove(this.configurationService.getValue(BASEHALF_REFERENCES_UPDATE_ON_FILE_MOVE_SETTING, { resource: folder }));
			if (setting === 'never') {
				this.settle(plan);
				result = { updated: [], skipped: [], notUpdated: `${BASEHALF_REFERENCES_UPDATE_ON_FILE_MOVE_SETTING} is never` };
				return;
			}
			if (await baseHalfIsWorkspaceFolderMarked(this.fileService, folder)) {
				// The marker appeared after validation: a marked folder always prompts.
				promptInstead = true;
				result = { updated: [], skipped: [], notUpdated: 'the workspace folder is marked as a BaseHalf source tree, so BaseHalf asks the user if any entries name the old path' };
				return;
			}
			const indexState = await this.refactorService.whenIndexReady(folder);
			if (plan.answered || this.disposed) {
				return;
			}
			this.snapshotDeferred(plan);
			const waiting = this.agentMoveWaitingEntries(plan);
			if (plan.state.stores.length === 0 && (await this.storeKindChanges(plan)).length === 0) {
				this.settle(plan);
				result = this.agentMoveResult(undefined, waiting, indexState);
				return;
			}
			plan.reportQuietly = true;
			result = this.agentMoveResult(await this.update(plan), waiting, indexState);
		} catch (error) {
			result = { updated: [], skipped: [`the update failed: ${error instanceof Error ? error.message : String(error)}`] };
		} finally {
			request.result.complete(result);
		}
		if (promptInstead) {
			await this.processWithSetting(plan);
		}
	}

	/**
	 * Stores whose entries name a moved path but that this plan leaves alone,
	 * because the entries fall under the old path of an earlier plan that is
	 * not settled yet (the `exclude` of the prepare step).
	 */
	private agentMoveWaitingEntries(plan: IPendingRename): string[] {
		const exclude = plan.state.exclude;
		if (!exclude?.length) {
			return [];
		}
		const moves = baseHalfEffectiveMoves(plan.state.moves);
		const taken = new Set(this.refactorService.snapshot(plan.workspaceFolder, moves, exclude).map(store => store.nodePath));
		const owned = new Set<string>();
		for (const other of this.pending) {
			if (other !== plan && isEqual(other.workspaceFolder, plan.workspaceFolder)) {
				for (const store of other.state.stores) {
					owned.add(store.nodePath);
				}
			}
		}
		return this.refactorService.snapshot(plan.workspaceFolder, moves)
			.filter(store => !taken.has(store.nodePath))
			.map(store => owned.has(store.nodePath)
				? `${store.nodePath} (its entry was left as it is: an earlier move of that path, not settled yet in BaseHalf, will update it)`
				: `${store.nodePath} (its entry was left as it is because it names the old path of an earlier move that is not settled yet in BaseHalf; it stays broken until relinked)`);
	}

	private agentMoveResult(outcome: IBaseHalfReferenceRefactorOutcome | undefined, waiting: readonly string[], indexState: BaseHalfReferenceIndexState | undefined): IBaseHalfAgentMoveUpstreamResult {
		const updated = [...new Set([...(outcome?.updated ?? []), ...(outcome?.movedIntoFile ?? [])].map(node => node.relativePath))];
		const skipped = [
			...(outcome ? this.agentMoveExclusions(outcome.plan) : []),
			...waiting,
			...(outcome?.errors ?? []).map(error => `the update failed: ${error instanceof Error ? error.message : String(error)}`)
		];
		return {
			updated,
			skipped,
			...(indexState === 'partial' ? { incomplete: 'the reference index is partial, so stores it could not read may still name the old path' } : {})
		};
	}

	/** Skipped stores and entries left alone, by workspace-relative path, for the agent's result. */
	private agentMoveExclusions(plan: IBaseHalfRenameUpdatePlan): string[] {
		return [
			...plan.skipped.map(skip => {
				switch (skip.reason) {
					case 'historical':
						return `${skip.node.relativePath} (its assigned inputs keep the paths they had when its attempt or result was made)`;
					case 'upstreamOnly':
						return `${skip.node.relativePath} (a result or output file, which can't receive upstream context)`;
					case 'unreadable':
						return `${skip.node.relativePath} (its upstream list can't be read)`;
					default:
						return skip.message ? `${skip.node.relativePath} (${skip.message.replace(/\.$/, '')})` : skip.node.relativePath;
				}
			}),
			...plan.leftAlone.map(entry => entry.reason === 'resolves'
				? `${entry.node.relativePath}: entry ${entry.entry} left as it is (that path names an item again)`
				: `${entry.node.relativePath}: entry ${entry.entry} left as it is (the entry changed since the move)`)
		];
	}

	//#endregion

	//#region Helpers

	private agentMoveKey(source: URI, target: URI): string {
		return `${this.uriIdentityService.extUri.getComparisonKey(source)}\n${this.uriIdentityService.extUri.getComparisonKey(target)}`;
	}

	private location(resource: URI): { readonly workspaceFolder: URI; readonly relativePath: string } | undefined {
		const folder = this.contextService.getWorkspaceFolder(resource);
		if (!folder) {
			return undefined;
		}
		const relativePath = getRelativePath(folder.uri, resource);
		if (!relativePath || relativePath === '.bh' || relativePath.startsWith('.bh/')) {
			return undefined;
		}
		return { workspaceFolder: folder.uri, relativePath };
	}

	private parentCanvasResource(workspaceFolder: URI, relativePath: string): URI {
		const parent = relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : '';
		return this.canvasMirrorService.canvasResource({
			resource: parent ? URI.joinPath(workspaceFolder, ...parent.split('/')) : workspaceFolder,
			workspaceFolder,
			relativePath: parent,
			source: 'api'
		});
	}

	private node(workspaceFolder: URI, relativePath: string): IBaseHalfWorkspaceResource {
		return { resource: URI.joinPath(workspaceFolder, ...relativePath.split('/')), workspaceFolder, relativePath };
	}

	private identity(workspaceFolder: URI): IBaseHalfUpstreamIdentity {
		return baseHalfUpstreamIdentity(workspaceFolder, this.uriIdentityService.extUri);
	}

	//#endregion
}

registerWorkbenchContribution2(BaseHalfRenameRefactorContribution.ID, BaseHalfRenameRefactorContribution, WorkbenchPhase.AfterRestored);
