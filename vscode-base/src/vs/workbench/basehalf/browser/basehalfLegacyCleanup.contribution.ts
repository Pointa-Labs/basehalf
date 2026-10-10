/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { dirname, isEqual } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { localize, localize2 } from '../../../nls.js';
import { Action2, registerAction2 } from '../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator, ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { INotificationHandle, INotificationService, Severity } from '../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../platform/storage/common/storage.js';
import { IUriIdentityService } from '../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { IEditorService } from '../../services/editor/common/editorService.js';
import { IBaseHalfCanvasNavigationService } from '../common/basehalfCanvasNavigation.js';
import {
	BaseHalfAgentGuideNotTrashedReason,
	BaseHalfAgentGuideSkipReason,
	IBaseHalfAgentGuide,
	IBaseHalfAgentGuideRemovalReport,
	IBaseHalfLegacyCleanupReport,
	IBaseHalfLegacyCleanupService
} from '../common/basehalfLegacyCleanup.js';
import { IBaseHalfLegacyMigrationGate } from '../common/basehalfLegacyMigrationGate.js';

/** Workspace folders already told (on this machine) about removed `.bh/` files. */
export const BASEHALF_CLEANUP_MIRROR_NOTICE_STORAGE_KEY = 'basehalf.cleanup.mirrorNotice.v1';
/** Workspace folders where the user chose Keep for old agent guides (this machine). */
export const BASEHALF_CLEANUP_AGENT_GUIDES_KEPT_STORAGE_KEY = 'basehalf.cleanup.agentGuides.kept.v1';
export const BASEHALF_REMOVE_OLD_AGENT_INSTRUCTIONS_COMMAND_ID = 'basehalf.cleanup.removeOldAgentInstructions';

const SHOW_SCM_COMMAND_ID = 'workbench.view.scm';
const MAX_GIT_ANCESTORS = 64;

export const IBaseHalfLegacyCleanupNotifier = createDecorator<IBaseHalfLegacyCleanupNotifier>('baseHalfLegacyCleanupNotifier');

/**
 * The user-facing half of legacy cleanup: runs the automatic `.bh/` pass and
 * discloses it, and offers (never performs unasked) removal of the sections
 * earlier versions wrote into root agent guides.
 */
export interface IBaseHalfLegacyCleanupNotifier {
	readonly _serviceBrand: undefined;

	/** Run the automatic `.bh/` cleanup for one workspace folder. */
	cleanFolder(workspaceFolder: URI): Promise<IBaseHalfLegacyCleanupReport | undefined>;
	/** Offer the one sticky old-agent-instructions notification, at most once
	 *  per session and only after the migration prompt settled. */
	offerAgentGuideRemoval(): Promise<void>;
	/** `BaseHalf: Remove Old Agent Instructions`: Remove on demand, regardless of Keep. */
	removeOldAgentInstructions(): Promise<void>;
}

export class BaseHalfLegacyCleanupNotifier extends Disposable implements IBaseHalfLegacyCleanupNotifier {
	declare readonly _serviceBrand: undefined;

	private agentGuideNoticeOffered = false;
	private agentGuideNotice: INotificationHandle | undefined;
	private disposed = false;

	constructor(
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IBaseHalfLegacyCleanupService private readonly cleanupService: IBaseHalfLegacyCleanupService,
		@IBaseHalfLegacyMigrationGate private readonly migrationGate: IBaseHalfLegacyMigrationGate,
		@INotificationService private readonly notificationService: INotificationService,
		@IStorageService private readonly storageService: IStorageService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IFileService private readonly fileService: IFileService,
		@ICommandService private readonly commandService: ICommandService,
		@IBaseHalfCanvasNavigationService private readonly canvasNavigationService: IBaseHalfCanvasNavigationService,
		@IEditorService private readonly editorService: IEditorService,
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	override dispose(): void {
		this.disposed = true;
		super.dispose();
	}

	async cleanFolder(workspaceFolder: URI): Promise<IBaseHalfLegacyCleanupReport | undefined> {
		let report: IBaseHalfLegacyCleanupReport;
		try {
			report = await this.cleanupService.cleanWorkspaceFolder(workspaceFolder);
		} catch (error) {
			// Best-effort: cleanup must never block the workbench. The next open retries.
			this.logService.error(`[BaseHalf] legacy cleanup of ${workspaceFolder.toString()} failed`, error);
			return undefined;
		}

		if (!report.skipped && report.removedFiles.length > 0) {
			await this.discloseMirrorRemoval(workspaceFolder, report.removedFiles.length);
		}
		return report;
	}

	async offerAgentGuideRemoval(): Promise<void> {
		await this.migrationGate.whenMigrationPromptSettled();
		if (this.agentGuideNoticeOffered) {
			return;
		}

		const kept = this.readFolderSet(BASEHALF_CLEANUP_AGENT_GUIDES_KEPT_STORAGE_KEY);
		const guides: IBaseHalfAgentGuide[] = [];
		for (const folder of this.contextService.getWorkspace().folders) {
			if (kept.has(this.folderKey(folder.uri))) {
				continue;
			}
			try {
				guides.push(...(await this.cleanupService.findAgentGuides(folder.uri)).guides);
			} catch (error) {
				this.logService.warn(`[BaseHalf] could not look for old agent instructions in ${folder.uri.toString()}`, error);
			}
		}
		if (guides.length === 0 || this.agentGuideNoticeOffered || this.disposed) {
			return;
		}

		this.agentGuideNoticeOffered = true;
		const files = guides.map(guide => this.label(guide)).join(', ');
		const trashed = guides.filter(guide => guide.moveToTrash).map(guide => this.label(guide));
		const message = trashed.length > 0
			? localize('basehalf.cleanup.agentGuides.offerWithTrash', "Earlier BaseHalf versions added agent instructions to {0}. They point agents at files BaseHalf no longer uses. Remove them? {1} will be moved to the trash.", files, trashed.join(', '))
			: localize('basehalf.cleanup.agentGuides.offer', "Earlier BaseHalf versions added agent instructions to {0}. They point agents at files BaseHalf no longer uses. Remove them?", files);
		const handle = this.notificationService.prompt(Severity.Info, message, [
			{
				label: localize('basehalf.cleanup.agentGuides.remove', "Remove"),
				run: () => void this.removeAndReport(guides)
			},
			{
				label: localize('basehalf.cleanup.agentGuides.show', "Show"),
				keepOpen: true,
				run: () => void this.showGuides(guides)
			},
			{
				label: localize('basehalf.cleanup.agentGuides.keep', "Keep"),
				run: () => this.keepFolders(guides)
			}
		], {
			// Closing without a choice stores nothing: the notification returns
			// next session.
			sticky: true
		});
		this.agentGuideNotice = handle;
		this._register(handle.onDidClose(() => {
			if (this.agentGuideNotice === handle) {
				this.agentGuideNotice = undefined;
			}
		}));
	}

	async removeOldAgentInstructions(): Promise<void> {
		const guides: IBaseHalfAgentGuide[] = [];
		for (const folder of this.contextService.getWorkspace().folders) {
			guides.push(...(await this.cleanupService.findAgentGuides(folder.uri)).guides);
		}
		if (guides.length === 0) {
			this.notificationService.info(localize('basehalf.cleanup.agentGuides.none', "No agent instructions from earlier BaseHalf versions were found."));
			return;
		}
		this.agentGuideNotice?.close();
		await this.removeAndReport(guides);
	}

	private async removeAndReport(guides: readonly IBaseHalfAgentGuide[]): Promise<void> {
		let report: IBaseHalfAgentGuideRemovalReport;
		try {
			report = await this.cleanupService.removeAgentGuideSections(guides);
		} catch (error) {
			this.logService.error('[BaseHalf] removing old agent instructions failed', error);
			this.notificationService.error(localize('basehalf.cleanup.agentGuides.failed', "Could not remove the old BaseHalf agent instructions."));
			return;
		}

		this.notificationService.info(localize(
			'basehalf.cleanup.agentGuides.report',
			"Removed the BaseHalf section from {0} files ({1} moved to the trash).",
			report.removed.length,
			report.trashed.length
		));
		for (const { guide, reason } of report.skipped) {
			this.notificationService.prompt(Severity.Warning, localize(
				'basehalf.cleanup.agentGuides.skipped',
				"{0} was not changed: {1}",
				this.label(guide),
				skipReasonLabel(reason)
			), [this.openChoice(guide)]);
		}
		for (const { guide, reason } of report.notTrashed) {
			this.notificationService.prompt(Severity.Warning, localize(
				'basehalf.cleanup.agentGuides.notTrashed',
				"The BaseHalf section was removed from {0}, but the file was not moved to the trash: {1}",
				this.label(guide),
				notTrashedReasonLabel(reason)
			), [this.openChoice(guide)]);
		}
	}

	private async showGuides(guides: readonly IBaseHalfAgentGuide[]): Promise<void> {
		for (const guide of guides) {
			try {
				const result = await this.canvasNavigationService.openCardDetail(guide.resource, {
					source: 'api',
					projection: 'source',
					selection: guide.selection,
					history: 'push'
				});
				if (!result.handled) {
					await this.editorService.openEditor({ resource: guide.resource, options: { selection: guide.selection, pinned: true } });
				}
			} catch (error) {
				this.logService.error(`[BaseHalf] could not show ${guide.resource.toString()}`, error);
			}
		}
	}

	private keepFolders(guides: readonly IBaseHalfAgentGuide[]): void {
		const kept = this.readFolderSet(BASEHALF_CLEANUP_AGENT_GUIDES_KEPT_STORAGE_KEY);
		for (const guide of guides) {
			kept.add(this.folderKey(guide.workspaceFolder));
		}
		this.writeFolderSet(BASEHALF_CLEANUP_AGENT_GUIDES_KEPT_STORAGE_KEY, kept);
	}

	private openChoice(guide: IBaseHalfAgentGuide) {
		return {
			label: localize('basehalf.cleanup.agentGuides.open', "Open"),
			run: () => {
				this.editorService.openEditor({ resource: guide.resource, options: { pinned: true } }).catch(error => this.logService.error(error));
			}
		};
	}

	private async discloseMirrorRemoval(workspaceFolder: URI, count: number): Promise<void> {
		const told = this.readFolderSet(BASEHALF_CLEANUP_MIRROR_NOTICE_STORAGE_KEY);
		const key = this.folderKey(workspaceFolder);
		if (told.has(key)) {
			// Collaborators on older builds can recreate these files through
			// git; later removals are only logged.
			return;
		}
		told.add(key);
		this.writeFolderSet(BASEHALF_CLEANUP_MIRROR_NOTICE_STORAGE_KEY, told);

		const multiRoot = this.contextService.getWorkspace().folders.length > 1;
		const folderName = this.contextService.getWorkspaceFolder(workspaceFolder)?.name ?? workspaceFolder.path;
		const message = multiRoot
			? localize('basehalf.cleanup.mirror.removedInFolder', "BaseHalf removed {0} files in {1} that earlier versions kept for itself and no longer uses. Your notes and canvas layout were not changed.", count, folderName)
			: localize('basehalf.cleanup.mirror.removed', "BaseHalf removed {0} files that earlier versions kept for itself and no longer uses. Your notes and canvas layout were not changed.", count);
		const choices = await this.isGitRepository(workspaceFolder)
			? [{
				label: localize('basehalf.cleanup.mirror.showScm', "Show in Source Control"),
				run: () => {
					this.commandService.executeCommand(SHOW_SCM_COMMAND_ID).catch(error => this.logService.error(error));
				}
			}]
			: [];
		this.notificationService.prompt(Severity.Info, message, choices);
	}

	private async isGitRepository(workspaceFolder: URI): Promise<boolean> {
		let current = workspaceFolder;
		for (let depth = 0; depth < MAX_GIT_ANCESTORS; depth++) {
			try {
				if (await this.fileService.exists(URI.joinPath(current, '.git'))) {
					return true;
				}
			} catch {
				return false;
			}
			const parent = dirname(current);
			if (isEqual(parent, current)) {
				return false;
			}
			current = parent;
		}
		return false;
	}

	private label(guide: IBaseHalfAgentGuide): string {
		if (this.contextService.getWorkspace().folders.length > 1) {
			const folderName = this.contextService.getWorkspaceFolder(guide.workspaceFolder)?.name;
			if (folderName) {
				return `${folderName}/${guide.file}`;
			}
		}
		return guide.file;
	}

	private folderKey(folder: URI): string {
		return this.uriIdentityService.asCanonicalUri(folder).toString();
	}

	private readFolderSet(key: string): Set<string> {
		const raw = this.storageService.get(key, StorageScope.WORKSPACE);
		if (!raw) {
			return new Set();
		}
		try {
			const parsed: unknown = JSON.parse(raw);
			return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []);
		} catch {
			return new Set();
		}
	}

	private writeFolderSet(key: string, folders: ReadonlySet<string>): void {
		this.storageService.store(key, JSON.stringify([...folders]), StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}
}

function skipReasonLabel(reason: BaseHalfAgentGuideSkipReason): string {
	switch (reason) {
		case 'marker': return localize('basehalf.cleanup.agentGuides.reason.marker', "its folder opts out of BaseHalf changes");
		case 'dirty': return localize('basehalf.cleanup.agentGuides.reason.dirty', "it has unsaved changes");
		case 'symbolicLink': return localize('basehalf.cleanup.agentGuides.reason.symbolicLink', "it is a symbolic link");
		case 'unreadable': return localize('basehalf.cleanup.agentGuides.reason.unreadable', "it could not be read");
		case 'notText': return localize('basehalf.cleanup.agentGuides.reason.notText', "it is not a text file");
		case 'unrecognized': return localize('basehalf.cleanup.agentGuides.reason.unrecognized', "its BaseHalf section was edited, so the lines BaseHalf added cannot be told apart");
		case 'changed': return localize('basehalf.cleanup.agentGuides.reason.changed', "it changed while BaseHalf was updating it");
		case 'writeFailed': return localize('basehalf.cleanup.agentGuides.reason.writeFailed', "it could not be written");
	}
}

function notTrashedReasonLabel(reason: BaseHalfAgentGuideNotTrashedReason): string {
	switch (reason) {
		case 'trashUnavailable': return localize('basehalf.cleanup.agentGuides.reason.trashUnavailable', "the trash is not available");
		case 'trashFailed': return localize('basehalf.cleanup.agentGuides.reason.trashFailed', "moving it to the trash failed");
		case 'changed': return localize('basehalf.cleanup.agentGuides.reason.changedBeforeTrash', "it changed before it could be moved");
	}
}

registerSingleton(IBaseHalfLegacyCleanupNotifier, BaseHalfLegacyCleanupNotifier, InstantiationType.Delayed);

/**
 * Runs legacy cleanup for every workspace folder when it is opened or added.
 * Nothing is installed anymore: no agent guide section, no `.bh/agent-harness`,
 * no `.gitignore` line, and opening a folder never creates `.bh/`.
 */
export class BaseHalfLegacyCleanupContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.basehalf.legacyCleanup';

	constructor(
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IBaseHalfLegacyCleanupNotifier private readonly notifier: IBaseHalfLegacyCleanupNotifier
	) {
		super();

		this._register(contextService.onDidChangeWorkspaceFolders(event => {
			void Promise.all(event.added.map(folder => this.notifier.cleanFolder(folder.uri))).then(() => this.notifier.offerAgentGuideRemoval());
		}));

		void Promise.all(contextService.getWorkspace().folders.map(folder => this.notifier.cleanFolder(folder.uri))).then(() => this.notifier.offerAgentGuideRemoval());
	}
}

registerWorkbenchContribution2(BaseHalfLegacyCleanupContribution.ID, BaseHalfLegacyCleanupContribution, WorkbenchPhase.AfterRestored);

registerAction2(class BaseHalfRemoveOldAgentInstructionsAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_REMOVE_OLD_AGENT_INSTRUCTIONS_COMMAND_ID,
			title: localize2('basehalf.removeOldAgentInstructions', 'Remove Old Agent Instructions'),
			category: localize2('basehalf.category', 'BaseHalf'),
			f1: true
		});
	}

	run(accessor: ServicesAccessor): Promise<void> {
		return accessor.get(IBaseHalfLegacyCleanupNotifier).removeOldAgentInstructions();
	}
});
