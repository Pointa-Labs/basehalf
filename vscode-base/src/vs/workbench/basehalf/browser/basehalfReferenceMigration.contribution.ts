/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../base/common/async.js';
import { Event } from '../../../base/common/event.js';
import { Disposable, DisposableMap, IDisposable } from '../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../base/common/map.js';
import { basename, dirname, relativePath as getRelativePath } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { localize, localize2 } from '../../../nls.js';
import { Action2, registerAction2 } from '../../../platform/actions/common/actions.js';
import { IContextKey, IContextKeyService, RawContextKey } from '../../../platform/contextkey/common/contextkey.js';
import { FileChangesEvent, IFileService } from '../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator, ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { INotificationHandle, INotificationService, Severity } from '../../../platform/notification/common/notification.js';
import { IProgressService, ProgressLocation } from '../../../platform/progress/common/progress.js';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from '../../../platform/quickinput/common/quickInput.js';
import { IUriIdentityService } from '../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { IEditorService } from '../../services/editor/common/editorService.js';
import { IBaseHalfBadgeMirrorService } from '../common/basehalfBadgeMirror.js';
import { IBaseHalfCanvasNavigationService } from '../common/basehalfCanvasNavigation.js';
import { IBaseHalfLegacyMigrationGate } from '../common/basehalfLegacyMigrationGate.js';
import { baseHalfMirrorRoot } from '../common/basehalfMirrorTree.js';
import {
	BaseHalfLegacyReportSection,
	baseHalfLegacyPromptCounts,
	baseHalfLegacyReasonLabel,
	baseHalfLegacyReportRows,
	IBaseHalfLegacyFolderPlan,
	IBaseHalfLegacyFolderResult,
	IBaseHalfLegacyMigrationResult,
	IBaseHalfLegacyPromptCounts,
	IBaseHalfLegacyReportRow,
	IBaseHalfReferenceMigrationService
} from '../common/basehalfReferenceMigration.js';

/** Command id of **BaseHalf: Move Earlier Connections…**. */
export const BASEHALF_MOVE_EARLIER_CONNECTIONS_COMMAND_ID = 'basehalf.references.moveEarlierConnections';

/** True while a workspace folder has legacy pairs that are not settled yet. */
export const BaseHalfHasEarlierConnectionsContext = new RawContextKey<boolean>('basehalf.references.hasEarlierConnections', false, localize('basehalf.migration.context', "Whether connections from an earlier BaseHalf version still need to be moved"));

/** How long detection waits after a `badge.yaml` changed. */
const DETECTION_DEBOUNCE_MS = 1000;
const BADGE_FILE_NAME = 'badge.yaml';

export const IBaseHalfReferenceMigrationController = createDecorator<IBaseHalfReferenceMigrationController>('baseHalfReferenceMigrationController');

/**
 * The user-facing half of the migration from legacy badge pairs: detection
 * triggers, the one prompt per session, the read-only report, the command,
 * and the completion notification. The migration writes nothing until the
 * user chooses **Move Connections**; settling pairs that need no write only
 * appends to `.bh/legacy-references.yaml`.
 */
export interface IBaseHalfReferenceMigrationController {
	readonly _serviceBrand: undefined;

	/** Runs detection for every open folder, and later for added folders and changed badges. */
	start(): void;
	/** **BaseHalf: Move Earlier Connections…** and **Preview**: the read-only report, which offers Move Connections. */
	showPreview(): Promise<void>;
	/** **Move Connections**. While a run is in progress, shows its progress. */
	moveConnections(): Promise<void>;
}

interface IBaseHalfLegacyReportItem extends IQuickPickItem {
	readonly move?: true;
	readonly resource?: URI;
}

export class BaseHalfReferenceMigrationController extends Disposable implements IBaseHalfReferenceMigrationController {
	declare readonly _serviceBrand: undefined;

	private started = false;
	private disposed = false;
	/** Folders with pairs that are not settled yet (to write, or deferred). */
	private readonly plans = new ResourceMap<IBaseHalfLegacyFolderPlan>();
	private promptState: 'none' | 'open' | 'answered' = 'none';
	private prompt: INotificationHandle | undefined;
	private promptHold: IDisposable | undefined;
	private running: Promise<IBaseHalfLegacyMigrationResult> | undefined;
	private readonly detectionSchedulers = this._register(new DisposableMap<string, RunOnceScheduler>());
	private readonly changedBadges = new ResourceMap<URI[]>();
	private readonly hasEarlierConnections: IContextKey<boolean>;

	constructor(
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IBaseHalfReferenceMigrationService private readonly migrationService: IBaseHalfReferenceMigrationService,
		@IBaseHalfLegacyMigrationGate private readonly gate: IBaseHalfLegacyMigrationGate,
		@IBaseHalfBadgeMirrorService private readonly badgeMirrorService: IBaseHalfBadgeMirrorService,
		@INotificationService private readonly notificationService: INotificationService,
		@IProgressService private readonly progressService: IProgressService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IFileService private readonly fileService: IFileService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IBaseHalfCanvasNavigationService private readonly canvasNavigationService: IBaseHalfCanvasNavigationService,
		@IEditorService private readonly editorService: IEditorService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.hasEarlierConnections = BaseHalfHasEarlierConnectionsContext.bindTo(contextKeyService);
	}

	override dispose(): void {
		this.disposed = true;
		this.promptHold?.dispose();
		this.promptHold = undefined;
		super.dispose();
	}

	start(): void {
		if (this.started) {
			return;
		}
		this.started = true;
		// Take the startup detection's hold before the gate's own startup hold
		// is released, so the old agent-instructions notification never slips
		// in before the migration prompt.
		const startupHold = this.gate.hold();
		this.gate.releaseStartupHold();
		this._register(this.contextService.onDidChangeWorkspaceFolders(event => {
			for (const removed of event.removed) {
				this.plans.delete(removed.uri);
				this.changedBadges.delete(removed.uri);
				this.detectionSchedulers.deleteAndDispose(this.folderKey(removed.uri));
			}
			if (event.removed.length > 0) {
				this.updateState();
				this.offerPrompt();
			}
			if (event.added.length > 0) {
				void this.detectFolders(event.added.map(folder => folder.uri), this.gate.hold());
			}
		}));
		this._register(this.fileService.onDidFilesChange(event => this.onDidFilesChange(event)));
		void this.detectFolders(this.contextService.getWorkspace().folders.map(folder => folder.uri), startupHold);
	}

	//#region Detection

	private async detectFolders(folders: readonly URI[], hold: IDisposable): Promise<void> {
		try {
			await Promise.all(folders.map(folder => this.detectFolder(folder)));
			// One notification covers every folder with pending pairs. It takes
			// its own hold before the detection hold is released.
			this.offerPrompt();
		} finally {
			hold.dispose();
		}
	}

	private async detectFolder(folder: URI): Promise<void> {
		try {
			this.setPlan(folder, await this.migrationService.detect(folder));
		} catch (error) {
			this.logService.error(`[BaseHalf] detecting earlier connections in ${folder.toString()} failed`, error);
		}
	}

	/**
	 * A `badge.yaml` changed: detect again (debounced) when it holds legacy
	 * keys, or when the folder has pending pairs. A deleted mirror directory
	 * of a folder with pending pairs counts too, since its badges went with it.
	 */
	private onDidFilesChange(event: FileChangesEvent): void {
		const changes = [
			...event.rawAdded.map(resource => ({ resource, deleted: false })),
			...event.rawUpdated.map(resource => ({ resource, deleted: false })),
			...event.rawDeleted.map(resource => ({ resource, deleted: true }))
		];
		for (const { resource, deleted } of changes) {
			const folder = this.contextService.getWorkspaceFolder(resource)?.uri;
			if (!folder || !this.uriIdentityService.extUri.isEqualOrParent(resource, baseHalfMirrorRoot(folder))) {
				continue;
			}
			const name = basename(resource);
			if (name !== BADGE_FILE_NAME && !(deleted && !name.endsWith('.yaml') && this.plans.has(folder))) {
				continue;
			}
			const changed = this.changedBadges.get(folder) ?? [];
			changed.push(resource);
			this.changedBadges.set(folder, changed);
			const key = this.folderKey(folder);
			let scheduler = this.detectionSchedulers.get(key);
			if (!scheduler) {
				scheduler = new RunOnceScheduler(() => void this.detectAfterChange(folder), DETECTION_DEBOUNCE_MS);
				this.detectionSchedulers.set(key, scheduler);
			}
			scheduler.schedule();
		}
	}

	private async detectAfterChange(folder: URI): Promise<void> {
		const changed = this.changedBadges.get(folder) ?? [];
		this.changedBadges.delete(folder);
		if (this.disposed || (!this.plans.has(folder) && !await this.holdsLegacyKeys(folder, changed))) {
			return;
		}
		await this.detectFolder(folder);
		this.offerPrompt();
	}

	private async holdsLegacyKeys(folder: URI, badges: readonly URI[]): Promise<boolean> {
		for (const badge of badges) {
			if (basename(badge) !== BADGE_FILE_NAME) {
				continue;
			}
			const relativePath = getRelativePath(baseHalfMirrorRoot(folder), dirname(badge));
			if (relativePath === undefined) {
				continue;
			}
			try {
				const legacy = await this.badgeMirrorService.readLegacyReferences({ resource: URI.joinPath(folder, ...relativePath.split('/').filter(Boolean)), workspaceFolder: folder, relativePath, kind: 'file' });
				if (legacy) {
					return true;
				}
			} catch {
				// An unreadable badge holds no pair the migration could move.
			}
		}
		return false;
	}

	private setPlan(folder: URI, plan: IBaseHalfLegacyFolderPlan | undefined): void {
		if (plan && plan.pairs.some(pair => pair.status.kind === 'write' || pair.status.kind === 'deferred')) {
			this.plans.set(folder, plan);
		} else {
			this.plans.delete(folder);
		}
		this.updateState();
	}

	private updateState(): void {
		if (!this.disposed) {
			this.hasEarlierConnections.set(this.plans.size > 0);
		}
	}

	//#endregion

	//#region Prompt

	/**
	 * Shows the one migration prompt of this session, or updates the open one.
	 * Later, or closing it without choosing, hides it until the next session.
	 */
	private offerPrompt(): void {
		if (this.disposed) {
			return;
		}
		const counts = baseHalfLegacyPromptCounts([...this.plans.values()]);
		if (counts.connections === 0) {
			this.prompt?.close();
			return;
		}
		if (this.promptState === 'answered' || this.running) {
			return;
		}
		const message = this.promptMessage(counts);
		if (this.promptState === 'open') {
			this.prompt?.updateMessage(message);
			return;
		}
		this.promptState = 'open';
		this.promptHold = this.gate.hold();
		const handle = this.notificationService.prompt(Severity.Info, message, [
			{
				label: localize('basehalf.migration.moveConnections', "Move Connections"),
				run: () => void this.moveConnections()
			},
			{
				label: localize('basehalf.migration.preview', "Preview"),
				keepOpen: true,
				run: () => void this.showPreview()
			},
			{
				label: localize('basehalf.migration.later', "Later"),
				run: () => { }
			}
		], { sticky: true });
		this.prompt = handle;
		this._register(Event.once(handle.onDidClose)(() => {
			if (this.prompt === handle) {
				this.prompt = undefined;
			}
			this.promptState = 'answered';
			this.promptHold?.dispose();
			this.promptHold = undefined;
		}));
	}

	private promptMessage(counts: IBaseHalfLegacyPromptCounts): string {
		const { connections, notes, metadataItems, nodeDocuments } = counts;
		let message: string;
		if (notes > 0 && metadataItems > 0) {
			message = localize('basehalf.migration.prompt', "Connections from an earlier BaseHalf version are hidden until they are moved into your files. Move {0} connections? BaseHalf will save them inside {1} notes and in the lists it keeps for {2} other items.", connections, notes, metadataItems);
		} else if (notes > 0) {
			message = localize('basehalf.migration.prompt.notes', "Connections from an earlier BaseHalf version are hidden until they are moved into your files. Move {0} connections? BaseHalf will save them inside {1} notes.", connections, notes);
		} else if (metadataItems > 0) {
			message = localize('basehalf.migration.prompt.metadata', "Connections from an earlier BaseHalf version are hidden until they are moved into your files. Move {0} connections? BaseHalf will save them in the lists it keeps for {1} items.", connections, metadataItems);
		} else {
			message = localize('basehalf.migration.prompt.plain', "Connections from an earlier BaseHalf version are hidden until they are moved into your files. Move {0} connections?", connections);
		}
		if (nodeDocuments > 0) {
			message = localize('basehalf.migration.prompt.nodeDocuments', "{0} It will also update {1} nodes.", message, nodeDocuments);
		}
		return message;
	}

	//#endregion

	//#region Move Connections

	async moveConnections(): Promise<void> {
		if (this.running) {
			// One migration runs at a time: choosing it again shows the progress.
			void this.progressService.withProgress({ location: ProgressLocation.Notification, title: progressTitle() }, () => this.running!);
			return;
		}
		this.prompt?.close();
		const folders = this.contextService.getWorkspace().folders.map(folder => folder.uri);
		const run = this.progressService.withProgress({ location: ProgressLocation.Notification, title: progressTitle() }, progress =>
			this.migrationService.migrate(folders, (completed, total) => {
				if (total > 0) {
					progress.report({ message: localize('basehalf.migration.progress', "{0} of {1}", completed, total) });
				}
			})
		);
		this.running = run;
		let result: IBaseHalfLegacyMigrationResult;
		try {
			result = await run;
		} catch (error) {
			this.logService.error('[BaseHalf] moving earlier connections failed', error);
			this.notificationService.error(localize('basehalf.migration.failed', "The earlier connections could not be moved: {0}", error instanceof Error ? error.message : String(error)));
			return;
		} finally {
			if (this.running === run) {
				this.running = undefined;
			}
		}
		await this.refreshPlans(folders);
		if (this.disposed) {
			return;
		}
		this.showCompletion(result);
	}

	private async refreshPlans(folders: readonly URI[]): Promise<void> {
		await Promise.all(folders.map(async folder => {
			try {
				this.setPlan(folder, await this.migrationService.plan(folder));
			} catch (error) {
				this.logService.warn(`[BaseHalf] could not re-read earlier connections in ${folder.toString()}`, error);
			}
		}));
	}

	private showCompletion(result: IBaseHalfLegacyMigrationResult): void {
		if (result.moved === 0 && result.notMoved === 0 && result.folders.every(folder => folder.pairs.length === 0)) {
			this.notificationService.info(localize('basehalf.migration.nothing', "No connections from an earlier BaseHalf version were found."));
			return;
		}
		if (result.notMoved > 0) {
			this.notificationService.prompt(Severity.Info, localize('basehalf.migration.donePartly', "Moved {0} connections into {1} files. {2} couldn't be moved.", result.moved, result.files, result.notMoved), [{
				label: localize('basehalf.migration.show', "Show"),
				run: () => void this.showReport(result.folders, 'result')
			}]);
			return;
		}
		this.notificationService.info(localize('basehalf.migration.done', "Moved {0} connections into {1} files.", result.moved, result.files));
	}

	//#endregion

	//#region Report

	async showPreview(): Promise<void> {
		const folders = this.contextService.getWorkspace().folders.map(folder => folder.uri);
		const plans = await this.progressService.withProgress({ location: ProgressLocation.Window, title: localize('basehalf.migration.loading', "Loading earlier connections…") }, async () => {
			const loaded: IBaseHalfLegacyFolderPlan[] = [];
			for (const folder of folders) {
				try {
					const plan = await this.migrationService.plan(folder);
					this.setPlan(folder, plan);
					if (plan) {
						loaded.push(plan);
					}
				} catch (error) {
					this.logService.warn(`[BaseHalf] could not read earlier connections in ${folder.toString()}`, error);
				}
			}
			return loaded;
		});
		await this.showReport(plans, 'preview');
	}

	/**
	 * The read-only report, grouped by downstream node in three sections:
	 * "Will be added" ("Added" after a run), "Already present", and "Can't be
	 * moved" with each reason.
	 */
	private async showReport(folders: readonly (IBaseHalfLegacyFolderPlan | IBaseHalfLegacyFolderResult)[], phase: 'preview' | 'result'): Promise<void> {
		const rows = baseHalfLegacyReportRows(folders);
		if (rows.length === 0) {
			this.notificationService.info(localize('basehalf.migration.nothing', "No connections from an earlier BaseHalf version were found."));
			return;
		}
		const items: (IBaseHalfLegacyReportItem | IQuickPickSeparator)[] = [];
		if (phase === 'preview' && rows.some(row => row.section === 'add')) {
			items.push({
				label: localize('basehalf.migration.report.move', "Move Connections"),
				description: localize('basehalf.migration.report.moveDescription', "Adds the connections below to their files"),
				alwaysShow: true,
				move: true
			});
		}
		for (const section of ['add', 'present', 'cannot'] as const) {
			const sectionRows = rows.filter(row => row.section === section);
			if (sectionRows.length === 0) {
				continue;
			}
			const count = sectionRows.reduce((sum, row) => sum + Math.max(1, row.upstreams.length), 0);
			items.push({ type: 'separator', label: sectionLabel(section, phase, count) });
			for (const row of sectionRows) {
				items.push(this.reportItem(row));
			}
		}
		const picked = await this.quickInputService.pick(items, {
			title: phase === 'preview'
				? localize('basehalf.migration.report.title', "Connections from an Earlier BaseHalf Version")
				: localize('basehalf.migration.report.resultTitle', "Moved Connections"),
			placeHolder: localize('basehalf.migration.report.placeholder', "Moving connections can't be undone with Undo."),
			matchOnDescription: true,
			matchOnDetail: true
		});
		if (picked?.move) {
			await this.moveConnections();
		} else if (picked?.resource) {
			await this.open(picked.resource);
		}
	}

	private reportItem(row: IBaseHalfLegacyReportRow): IBaseHalfLegacyReportItem {
		const label = this.contextService.getWorkspace().folders.length > 1
			? `${this.contextService.getWorkspaceFolder(row.workspaceFolder)?.name ?? basename(row.workspaceFolder)}/${row.downstream}`
			: row.downstream;
		const description = row.key
			? localize('basehalf.migration.report.key', "an earlier connection list in its badge")
			: localize('basehalf.migration.report.from', "from {0}", row.upstreams.join(', '));
		return {
			label,
			description,
			...(row.reason ? { detail: baseHalfLegacyReasonLabel(row.reason) } : {}),
			...(row.downstream ? { resource: URI.joinPath(row.workspaceFolder, ...row.downstream.split('/').filter(Boolean)) } : {})
		};
	}

	private async open(resource: URI): Promise<void> {
		try {
			const result = await this.canvasNavigationService.openResource(resource, { source: 'api' });
			if (result.handled) {
				return;
			}
		} catch (error) {
			this.logService.warn(`[BaseHalf] could not open ${resource.toString()}`, error);
		}
		await this.editorService.openEditor({ resource, options: { pinned: true } });
	}

	//#endregion

	private folderKey(folder: URI): string {
		return this.uriIdentityService.extUri.getComparisonKey(folder);
	}
}

function progressTitle(): string {
	return localize('basehalf.migration.progressTitle', "Moving connections from an earlier BaseHalf version");
}

function sectionLabel(section: BaseHalfLegacyReportSection, phase: 'preview' | 'result', count: number): string {
	switch (section) {
		case 'add':
			return phase === 'preview'
				? localize('basehalf.migration.report.willBeAdded', "Will be added ({0})", count)
				: localize('basehalf.migration.report.added', "Added ({0})", count);
		case 'present':
			return localize('basehalf.migration.report.present', "Already present ({0})", count);
		case 'cannot':
			return localize('basehalf.migration.report.cannot', "Can't be moved ({0})", count);
	}
}

registerSingleton(IBaseHalfReferenceMigrationController, BaseHalfReferenceMigrationController, InstantiationType.Delayed);

/** Starts migration detection when the workbench has restored. */
export class BaseHalfReferenceMigrationContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.basehalf.referenceMigration';

	constructor(
		@IBaseHalfReferenceMigrationController controller: IBaseHalfReferenceMigrationController
	) {
		controller.start();
	}
}

registerWorkbenchContribution2(BaseHalfReferenceMigrationContribution.ID, BaseHalfReferenceMigrationContribution, WorkbenchPhase.AfterRestored);

registerAction2(class BaseHalfMoveEarlierConnectionsAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_MOVE_EARLIER_CONNECTIONS_COMMAND_ID,
			title: localize2('basehalf.migration.command', 'Move Earlier Connections…'),
			category: localize2('basehalf.category', 'BaseHalf'),
			f1: true,
			precondition: BaseHalfHasEarlierConnectionsContext
		});
	}

	run(accessor: ServicesAccessor): Promise<void> {
		return accessor.get(IBaseHalfReferenceMigrationController).showPreview();
	}
});
