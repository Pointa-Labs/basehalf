/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { localize } from '../../../../nls.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { IBaseHalfCanvasNavigationService } from '../../navigation/common/basehalfCanvasNavigation.js';
import { baseHalfNoteStoreGitCheck, baseHalfWithoutEarlyGitIgnoreLines } from '../common/basehalfNoteFileGit.js';
import { BASEHALF_NO_WORKSPACE_SETUP_MARKER, BASEHALF_NOTE_FILES_STORE_PATH } from '../common/basehalfNoteFiles.js';

/** The homes whose notice was shown, or kept, on this machine: `{ [home]: 'shown' | 'kept' }`. */
export const BASEHALF_NOTE_FILES_GIT_NOTICE_KEY = 'basehalf.noteFiles.gitNotice';

const STORE_MARK = `/${BASEHALF_NOTE_FILES_STORE_PATH.join('/')}/`;

/**
 * When the ignore files git reads leave a home's store out, one notice per
 * home and machine says so, without a path (files in notes, rule 46). When
 * the cause is the two lines early versions of BaseHalf wrote into a user's
 * `.gitignore`, it offers Remove, which deletes exactly them after the user
 * confirms, Show, which opens the file at them, and Keep, which is
 * remembered. A home is read when the window opens on it with a store, and
 * when a file first appears in a store during the window.
 */
export class BaseHalfNoteFileGitContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.baseHalfNoteFileGit';

	private readonly reads = new ResourceMap<Promise<void>>();

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IStorageService private readonly storageService: IStorageService,
		@INotificationService private readonly notificationService: INotificationService,
		@IDialogService private readonly dialogService: IDialogService,
		@IPathService private readonly pathService: IPathService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IBaseHalfCanvasNavigationService private readonly navigationService: IBaseHalfCanvasNavigationService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		for (const folder of contextService.getWorkspace().folders) {
			void this.check(folder.uri);
		}
		this._register(this.fileService.onDidFilesChange(event => {
			for (const resource of event.rawAdded) {
				const at = resource.path.indexOf(STORE_MARK);
				if (at >= 0) {
					void this.check(resource.with({ path: resource.path.slice(0, at) || '/' }));
				}
			}
		}));
	}

	/** Reads the ignore files of a home with a store once a window, and says when they leave the store out. */
	check(home: URI): Promise<void> {
		let read = this.reads.get(home);
		if (!read) {
			read = this.doCheck(home);
			this.reads.set(home, read);
		}
		return read;
	}

	private async doCheck(home: URI): Promise<void> {
		try {
			if (this.remembered()[home.toString()] || !await this.fileService.exists(joinPath(home, ...BASEHALF_NOTE_FILES_STORE_PATH)) || await this.fileService.exists(joinPath(home, BASEHALF_NO_WORKSPACE_SETUP_MARKER))) {
				return;
			}
			const userHome = await this.pathService.userHome({ preferLocal: true });
			const result = await baseHalfNoteStoreGitCheck({ fileService: this.fileService, userHome }, home);
			if (!result.ignored) {
				return;
			}
			const early = result.early;
			if (!early) {
				this.remember(home, 'shown');
				this.notificationService.notify({
					severity: Severity.Info,
					message: localize('basehalf.noteFiles.gitIgnored', "Git leaves out the files put into notes here: an ignore file names them, so the repository does not keep them."),
				});
				return;
			}
			this.notificationService.prompt(Severity.Info, localize('basehalf.noteFiles.gitIgnoredEarly', "Git leaves out the files put into notes here: an early version of BaseHalf wrote two lines into .gitignore that leave out .bh."), [
				{ label: localize('basehalf.noteFiles.gitRemove', "Remove"), run: () => void this.remove(home, early.file, early.line) },
				{ label: localize('basehalf.noteFiles.gitShow', "Show"), run: () => void this.navigationService.openResource(early.file, { source: 'api', selection: { startLineNumber: early.line, startColumn: 1, endLineNumber: early.line + 1, endColumn: Number.MAX_SAFE_INTEGER } }) },
				{ label: localize('basehalf.noteFiles.gitKeep', "Keep"), run: () => this.remember(home, 'kept') },
			]);
		} catch (error) {
			this.logService.warn('[BaseHalf] could not read whether git keeps the files of notes', error);
		}
	}

	/** Deletes the two lines, and nothing else, once the user confirms. */
	private async remove(home: URI, file: URI, line: number): Promise<void> {
		const { confirmed } = await this.dialogService.confirm({
			message: localize('basehalf.noteFiles.gitRemoveConfirm', "Remove the two lines from .gitignore?"),
			detail: localize('basehalf.noteFiles.gitRemoveDetail', "\"# BaseHalf derived cache\" and \".bh/\" go, and git keeps the files put into notes from then on. The rest of the file stays as it is."),
			primaryButton: localize({ key: 'basehalf.noteFiles.gitRemoveButton', comment: ['&& denotes a mnemonic'] }, "&&Remove"),
		});
		if (!confirmed) {
			return;
		}
		if (this.textFileService.isDirty(file)) {
			this.notificationService.info(localize('basehalf.noteFiles.gitRemoveDirty', "Save or revert .gitignore first."));
			return;
		}
		try {
			const content = await this.fileService.readFile(file);
			const text = baseHalfWithoutEarlyGitIgnoreLines(content.value.toString(), line);
			if (text !== undefined) {
				await this.fileService.writeFile(file, VSBuffer.fromString(text), { etag: content.etag, mtime: content.mtime });
			}
		} catch (error) {
			this.logService.warn('[BaseHalf] could not remove the two lines early versions wrote into .gitignore', error);
			this.notificationService.warn(localize('basehalf.noteFiles.gitRemoveFailed', "The two lines could not be removed from .gitignore."));
			return;
		}
		this.reads.delete(home);
	}

	private remembered(): Record<string, 'shown' | 'kept'> {
		try {
			const value: unknown = JSON.parse(this.storageService.get(BASEHALF_NOTE_FILES_GIT_NOTICE_KEY, StorageScope.APPLICATION, '{}'));
			return value && typeof value === 'object' ? value as Record<string, 'shown' | 'kept'> : {};
		} catch {
			return {};
		}
	}

	private remember(home: URI, state: 'shown' | 'kept'): void {
		this.storageService.store(BASEHALF_NOTE_FILES_GIT_NOTICE_KEY, JSON.stringify({ ...this.remembered(), [home.toString()]: state }), StorageScope.APPLICATION, StorageTarget.MACHINE);
	}
}

registerWorkbenchContribution2(BaseHalfNoteFileGitContribution.ID, BaseHalfNoteFileGitContribution, WorkbenchPhase.Eventually);
