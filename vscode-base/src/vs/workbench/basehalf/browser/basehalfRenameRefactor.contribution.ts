/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../base/common/async.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { isEqual, relativePath as getRelativePath } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { ConfigurationTarget, IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { FileOperation, IFileService } from '../../../platform/files/common/files.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { INotificationHandle, INotificationService, IPromptChoice, Severity } from '../../../platform/notification/common/notification.js';
import { IUriIdentityService } from '../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { IWorkingCopyFileOperationPreconditionGuard, IWorkingCopyFileService, SourceTargetPair } from '../../services/workingCopy/common/workingCopyFileService.js';
import { IBaseHalfCanvasMirrorService } from '../common/basehalfCanvasMirror.js';
import { IBaseHalfWorkspaceResource } from '../common/basehalfCanvasNavigation.js';
import { baseHalfIsWorkspaceFolderMarked } from '../common/basehalfLegacyCleanup.js';
import { baseHalfAssertMirrorPathComponentsNotSymbolicLink } from '../common/basehalfMirrorTree.js';
import { baseHalfUpstreamIdentity, IBaseHalfUpstreamIdentity } from '../common/basehalfReferenceEntries.js';
import { IBaseHalfReferenceIndexService } from '../common/basehalfReferenceIndex.js';
import { baseHalfUpstreamSidecarResource, baseHalfUpstreamStoreKind, readBaseHalfSidecarUpstream } from '../common/basehalfReferenceStore.js';
import {
	BASEHALF_REFERENCES_UPDATE_ON_FILE_MOVE_SETTING,
	baseHalfComposeRenamePlan,
	baseHalfEffectiveMoves,
	baseHalfIsSpellingOnlyMove,
	baseHalfPrimaryMoves,
	baseHalfRelocateRenameStores,
	baseHalfUpdateOnFileMove,
	IBaseHalfPathMove,
	IBaseHalfRenamePlanState,
	IBaseHalfRenameStore
} from '../common/basehalfRenameRefactor.js';
import { IBaseHalfReferenceRefactorInput, IBaseHalfReferenceRefactorService } from './basehalfReferenceRefactorService.js';

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
 * Moves outside the workbench are not refactored; Relink Everywhere repairs
 * their entries later.
 */
export class BaseHalfRenameRefactorContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.basehalf.renameRefactor';

	private readonly pending = new Set<IPendingRename>();
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
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@INotificationService private readonly notificationService: INotificationService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this._register(workingCopyFileService.addFileOperationPrecondition({
			prepare: async (files, operation) => this.prepare(files, operation)
		}));
	}

	override dispose(): void {
		this.disposed = true;
		for (const plan of this.pending) {
			plan.answered = true;
			plan.notification?.close();
		}
		this.pending.clear();
		this.releaseSettleWaiters();
		super.dispose();
	}

	//#region Planning

	/**
	 * Snapshots the stores that name a moved path, before anything moves. It
	 * never awaits, so it adds no await boundary ahead of the structural
	 * commit barrier of the mirror cascade.
	 */
	private prepare(files: readonly SourceTargetPair[], operation: FileOperation): IWorkingCopyFileOperationPreconditionGuard | undefined {
		if (operation !== FileOperation.MOVE) {
			return undefined;
		}
		const groups = new Map<string, { readonly workspaceFolder: URI; readonly pairs: { readonly source: URI; readonly target: URI; readonly move: IBaseHalfPathMove }[] }>();
		for (const pair of files) {
			if (!pair.source) {
				continue;
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
		}
		if (groups.size === 0) {
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
				answered: false
			};
			this.pending.add(plan);
			void timeout(0)
				.then(() => this.process(plan))
				.catch(error => this.logService.error('[BaseHalf] the rename refactor failed', error));
		}
	}

	private async process(plan: IPendingRename): Promise<void> {
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
		if (plan.deferred) {
			// The index was building when the move was prepared. Entries still
			// name the old paths, so the index finds the same stores now; a store
			// it still lists at its old path is mapped like a snapshot's.
			plan.deferred = false;
			plan.state = { ...plan.state, stores: baseHalfRelocateRenameStores(this.refactorService.snapshot(folder, plan.state.moves, plan.state.exclude), plan.state.moves, this.identity(folder)) };
		}
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
	private async update(plan: IPendingRename): Promise<void> {
		if (plan.answered || this.disposed) {
			return;
		}
		plan.answered = true;
		const folder = plan.workspaceFolder;
		try {
			await this.refactorService.whenIndexReady(folder);
			const moves = baseHalfPrimaryMoves(plan.state.moves, this.identity(folder));
			if (!this.input(plan) || moves.length === 0) {
				return;
			}
			const storeKindChanges = await this.storeKindChanges(plan);
			const outcome = await this.refactorService.update(folder, () => this.input(plan), {
				label: localize('basehalf.renameRefactor.undoLabel', "Update upstream paths"),
				undoResources: [this.parentCanvasResource(folder, moves[0].to)],
				moveIntoFile: storeKindChanges.map(change => change.node),
				whenMovesSettled: () => this.whenMovesSettled(folder)
			});
			if (outcome) {
				this.refactorService.report(outcome, 'rename');
			}
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

	//#region Helpers

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
