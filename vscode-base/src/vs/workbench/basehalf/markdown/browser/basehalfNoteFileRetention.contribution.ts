/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IntervalTimer } from '../../../../base/common/async.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { isEqualOrParent } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { FileSystemProviderCapabilities, IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IBaseHalfMovedItemsService } from '../../upkeep/common/basehalfMovedItemsService.js';
import { baseHalfReleaseUnmentionedNoteFiles } from '../common/basehalfNoteFileRetention.js';

/** How often a window that stays open looks whether a folder's day has passed (files in notes, rule 37). */
export const BASEHALF_NOTE_FILE_RESCAN_MS = 60 * 60 * 1000;

/**
 * At the open of each workspace folder, once the comparison of moved items
 * is done, the scan of the files no note mentions runs (files in notes,
 * rule 37), and again every hour while the window stays open; it scans a
 * folder at most once a day, whatever the windows.
 */
export class BaseHalfNoteFileRetentionContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.baseHalfNoteFileRetention';

	private readonly scanned = new Set<string>();
	/** The folders whose scan runs: a look that comes meanwhile waits for the next. */
	private readonly running = new Set<string>();
	private disposed = false;

	constructor(
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IModelService private readonly modelService: IModelService,
		@IBaseHalfMovedItemsService private readonly movedItemsService: IBaseHalfMovedItemsService
	) {
		super();
		this.scanFolders();
		this._register(this.contextService.onDidChangeWorkspaceFolders(() => this.scanFolders()));
		// A window that stays open for days scans once a day too; the scan itself keeps to its day.
		const timer = this._register(new IntervalTimer());
		timer.cancelAndSet(() => this.rescanFolders(), BASEHALF_NOTE_FILE_RESCAN_MS);
	}

	override dispose(): void {
		this.disposed = true;
		super.dispose();
	}

	private scanFolders(): void {
		for (const folder of this.contextService.getWorkspace().folders) {
			const key = folder.uri.toString();
			if (this.scanned.has(key)) {
				continue;
			}
			this.scanned.add(key);
			void this.scan(folder.uri);
		}
	}

	private rescanFolders(): void {
		for (const folder of this.contextService.getWorkspace().folders) {
			if (this.scanned.has(folder.uri.toString())) {
				void this.scan(folder.uri);
			}
		}
	}

	private async scan(workspaceFolder: URI): Promise<void> {
		const key = workspaceFolder.toString();
		if (this.running.has(key)) {
			return;
		}
		this.running.add(key);
		try {
			await this.movedItemsService.whenCompared(workspaceFolder);
			if (!this.disposed) {
				await this.release(workspaceFolder);
			}
		} catch (error) {
			this.logService.warn('[BaseHalf] the scan of the files no note mentions failed', error);
		} finally {
			this.running.delete(key);
		}
	}

	private async release(workspaceFolder: URI): Promise<void> {
		await baseHalfReleaseUnmentionedNoteFiles({
			fileService: this.fileService,
			logService: this.logService,
			trash: this.configurationService.getValue<boolean>('files.enableTrash') !== false && this.fileService.hasCapability(workspaceFolder, FileSystemProviderCapabilities.Trash),
			// The text of open notes, saved or not, mentions their files too (rule 37).
			openTexts: () => this.modelService.getModels().filter(model => isEqualOrParent(model.uri, workspaceFolder)).map(model => model.getValue()),
		}, workspaceFolder);
	}
}

registerWorkbenchContribution2(BaseHalfNoteFileRetentionContribution.ID, BaseHalfNoteFileRetentionContribution, WorkbenchPhase.Eventually);
