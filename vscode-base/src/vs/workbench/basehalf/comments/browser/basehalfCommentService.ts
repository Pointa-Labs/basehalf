/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { basename, dirname } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { FileOperationError, FileOperationResult, IFileService } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IUndoRedoService, IWorkspaceUndoRedoElement, UndoRedoElementType, UndoRedoGroup } from '../../../../platform/undoRedo/common/undoRedo.js';
import { BASEHALF_CANVAS_UNDO_REDO_SOURCE } from '../../canvas/common/basehalfCanvasEditing.js';
import { createKeyedMutex } from '../../workspace/common/basehalfKeyedMutex.js';
import { baseHalfCommitMirrorFile } from '../../workspace/common/basehalfMirrorFileCommit.js';
import { baseHalfPreserveMirrorBytes } from '../../workspace/common/basehalfMirrorRecovery.js';
import { baseHalfAssertMirrorPathComponentsNotSymbolicLink, baseHalfMirrorResource } from '../../workspace/common/basehalfMirrorTree.js';
import { IBaseHalfWorkspaceMutationCoordinator } from '../../workspace/common/basehalfWorkspaceMutation.js';
import { BaseHalfCommentStep } from '../common/basehalfCommentProtocol.js';
import { BASEHALF_COMMENT_DEFAULT_COLOR, BaseHalfCommentColor, IBaseHalfComment, isBaseHalfCommentColor, isBaseHalfHighlight } from '../common/basehalfComments.js';
import { applyBaseHalfCommentChange, BASEHALF_COMMENTS_FILE_NAME, BaseHalfCommentChange, baseHalfCommentIndex, baseHalfShownComments, baseHalfStoredComment, EMPTY_BASEHALF_COMMENTS_FILE, IBaseHalfCommentsFile, parseBaseHalfComments, serializeBaseHalfComments } from '../common/basehalfCommentsFile.js';

export const IBaseHalfCommentService = createDecorator<IBaseHalfCommentService>('baseHalfCommentService');

/** A commentable file: a PDF, a book, or a note, in its workspace folder. */
export interface IBaseHalfCommentsTarget {
	readonly resource: URI;
	readonly workspaceFolder: URI;
	readonly relativePath: string;
}

/** The comments of a file as its pages show them. */
export interface IBaseHalfCommentsOfFile {
	/** The comments that can be shown, in the order of the file. */
	readonly comments: readonly IBaseHalfComment[];
	/** The file is not YAML at all: no comments show, and the Comments list says so. */
	readonly unreadable: boolean;
}

/** A change of one comment, by its id: the comment as it is to be, or the id of one to take away. */
export type BaseHalfCommentEdit = { readonly comment: IBaseHalfComment; readonly remove?: undefined } | { readonly comment?: undefined; readonly remove: string };

export interface IBaseHalfCommentService {
	readonly _serviceBrand: undefined;
	/** The color of the next highlight: the one used last on this computer. */
	readonly color: BaseHalfCommentColor;
	/** The file whose comments changed, by this window or outside it. */
	readonly onDidChange: Event<URI>;
	read(target: IBaseHalfCommentsTarget): Promise<IBaseHalfCommentsOfFile>;
	/** Follows the changes of a file's comments made outside this window while the result lives. */
	watch(target: IBaseHalfCommentsTarget): IDisposable;
	/** Keeps a change of the user, as one step of the canvas undo (comments, "Undo"). */
	change(target: IBaseHalfCommentsTarget, step: BaseHalfCommentStep, edit: BaseHalfCommentEdit): Promise<void>;
	/** Where the comments of a file are kept. */
	commentsResource(target: IBaseHalfCommentsTarget): URI;
}

const COLOR_STORAGE_KEY = 'basehalf.comments.color';
/** A file of comments larger than this is not read. */
const COMMENTS_MAX_BYTES = 16 * 1024 * 1024;
const WRITE_MAX_ATTEMPTS = 3;
/** Words saved in one comment within this time are one step (exact undo, "Comments"). */
const EDIT_MERGE_MS = 600;

interface IReadState {
	readonly contents: VSBuffer | null;
	readonly file: IBaseHalfCommentsFile;
}

export class BaseHalfCommentService extends Disposable implements IBaseHalfCommentService {
	declare readonly _serviceBrand: undefined;

	private readonly onDidChangeEmitter = this._register(new Emitter<URI>());
	readonly onDidChange = this.onDidChangeEmitter.event;
	private readonly mutex = createKeyedMutex();
	/** The last step of each file, which words saved again at once join. */
	private readonly lastSteps = new Map<string, { readonly step: BaseHalfCommentUndoStep; readonly at: number }>();
	/** The bytes this window wrote last, whose report by the watcher is no change from outside. */
	private readonly written = new Map<string, string>();

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IBaseHalfWorkspaceMutationCoordinator private readonly workspaceMutationCoordinator: IBaseHalfWorkspaceMutationCoordinator,
		@IUndoRedoService private readonly undoRedoService: IUndoRedoService,
		@IStorageService private readonly storageService: IStorageService,
		@INotificationService private readonly notificationService: INotificationService,
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	get color(): BaseHalfCommentColor {
		const stored = this.storageService.get(COLOR_STORAGE_KEY, StorageScope.PROFILE);
		return isBaseHalfCommentColor(stored) ? stored : BASEHALF_COMMENT_DEFAULT_COLOR;
	}

	commentsResource(target: IBaseHalfCommentsTarget): URI {
		return baseHalfMirrorResource(target.workspaceFolder, target.relativePath, BASEHALF_COMMENTS_FILE_NAME);
	}

	async read(target: IBaseHalfCommentsTarget): Promise<IBaseHalfCommentsOfFile> {
		const { file } = await this.readState(target);
		return { comments: baseHalfShownComments(file), unreadable: !!file.unreadable };
	}

	watch(target: IBaseHalfCommentsTarget): IDisposable {
		const resource = this.commentsResource(target);
		// The workspace's watcher reports the mirror folders, as the canvas reads
		// them. A report of the bytes this window wrote is no change from outside.
		return this.fileService.onDidFilesChange(event => {
			if (!event.affects(resource)) {
				return;
			}
			void this.fileService.readFile(resource, { limits: { size: COMMENTS_MAX_BYTES } }).then(content => content.value.toString(), () => '').then(text => {
				if (this.written.get(resource.toString()) !== text) {
					this.onDidChangeEmitter.fire(target.resource);
				}
			});
		});
	}

	change(target: IBaseHalfCommentsTarget, step: BaseHalfCommentStep, edit: BaseHalfCommentEdit): Promise<void> {
		return this.workspaceMutationCoordinator.runExclusive(target.workspaceFolder, () => {
			const resource = this.commentsResource(target);
			return this.mutex.runExclusive(resource.toString(), async () => {
				const after = edit.comment;
				const id = after ? after.id : edit.remove!;
				const { before, index } = await this.write(target, file => applyBaseHalfCommentChange(file, after ? { kind: 'put', comment: after } : { kind: 'remove', id }), id);
				if (step === 'highlight' || step === 'color') {
					const color = after?.color;
					if (color) {
						this.storageService.store(COLOR_STORAGE_KEY, color, StorageScope.PROFILE, StorageTarget.USER);
					}
				}
				// A comment that follows its edited passage is no step of its own: the edit of the note is.
				if (step !== 'follow') {
					this.pushStep(target, step, id, before, after, index);
				}
				this.onDidChangeEmitter.fire(target.resource);
			});
		});
	}

	/** Puts a comment back as a step of undo or redo has it, when the file still holds `expected` of it. */
	async applyStep(target: IBaseHalfCommentsTarget, id: string, expected: IBaseHalfComment | undefined, next: IBaseHalfComment | undefined, index: number): Promise<boolean> {
		return this.workspaceMutationCoordinator.runExclusive(target.workspaceFolder, () => {
			const resource = this.commentsResource(target);
			return this.mutex.runExclusive(resource.toString(), async () => {
				const current = await this.readState(target);
				if (!sameComment(baseHalfStoredComment(current.file, id), expected)) {
					this.notificationService.info(localize('basehalf.comments.changedMeanwhile', "The comment changed meanwhile. Undo did not change it."));
					return false;
				}
				const change: BaseHalfCommentChange = next ? { kind: 'put', comment: next, ...(index >= 0 ? { index } : {}) } : { kind: 'remove', id };
				await this.write(target, file => applyBaseHalfCommentChange(file, change), id);
				this.onDidChangeEmitter.fire(target.resource);
				return true;
			});
		});
	}

	private pushStep(target: IBaseHalfCommentsTarget, kind: BaseHalfCommentStep, id: string, before: IBaseHalfComment | undefined, after: IBaseHalfComment | undefined, index: number): void {
		const key = this.commentsResource(target).toString();
		const now = Date.now();
		const last = this.lastSteps.get(key);
		if (kind === 'edit' && last && last.step.kind === 'edit' && last.step.id === id && last.step.isDone && now - last.at < EDIT_MERGE_MS) {
			last.step.after = after;
			this.lastSteps.set(key, { step: last.step, at: now });
			return;
		}
		const step = new BaseHalfCommentUndoStep(stepLabel(kind, basename(target.resource), before), kind, target, id, before, after, index, this);
		this.undoRedoService.pushElement(step, UndoRedoGroup.None, BASEHALF_CANVAS_UNDO_REDO_SOURCE);
		this.lastSteps.set(key, { step, at: now });
	}

	/**
	 * Writes the file with one comment changed, against the bytes read; when
	 * the file changed meanwhile it is read again and changed there. Over a
	 * file that is not YAML, its bytes are kept first (comments, "Writing").
	 */
	private async write(target: IBaseHalfCommentsTarget, change: (file: IBaseHalfCommentsFile) => IBaseHalfCommentsFile, id: string): Promise<{ readonly before: IBaseHalfComment | undefined; readonly index: number }> {
		const resource = this.commentsResource(target);
		for (let attempt = 0; ; attempt++) {
			const current = await this.readState(target);
			const before = baseHalfStoredComment(current.file, id);
			const index = baseHalfCommentIndex(current.file, id);
			const next = change(current.file.unreadable ? EMPTY_BASEHALF_COMMENTS_FILE : current.file);
			const text = serializeBaseHalfComments(next);
			// The write check: the bytes read back as the comments that were meant.
			const readBack = parseBaseHalfComments(text);
			if (readBack.unreadable || JSON.stringify(baseHalfShownComments(readBack)) !== JSON.stringify(baseHalfShownComments(next))) {
				throw new Error(`BaseHalf refused to write ${resource.toString()} because it could not read the result back.`);
			}
			const contents = VSBuffer.fromString(text);
			try {
				if (current.file.unreadable && current.contents) {
					await baseHalfPreserveMirrorBytes(this.fileService, target.workspaceFolder, resource, current.contents);
					this.notificationService.info(localize('basehalf.comments.recovered', "BaseHalf could not read the saved comments of {0}, so it saved the new ones. A copy of the old ones is kept.", basename(target.resource)));
				}
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, target.workspaceFolder, resource);
				await this.fileService.createFolder(dirname(resource));
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, target.workspaceFolder, resource);
				this.written.set(resource.toString(), text);
				await baseHalfCommitMirrorFile(this.fileService, resource, contents, current.contents);
				return { before, index };
			} catch (error) {
				if (!isConflict(error) || attempt === WRITE_MAX_ATTEMPTS - 1) {
					this.logService.error(`[BaseHalf] could not write the comments of ${target.resource.toString()}`, error);
					throw error;
				}
			}
		}
	}

	private async readState(target: IBaseHalfCommentsTarget): Promise<IReadState> {
		const resource = this.commentsResource(target);
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, target.workspaceFolder, resource);
		try {
			const content = await this.fileService.readFile(resource, { limits: { size: COMMENTS_MAX_BYTES }, atomic: true });
			return { contents: content.value, file: parseBaseHalfComments(content.value.toString()) };
		} catch (error) {
			if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				return { contents: null, file: EMPTY_BASEHALF_COMMENTS_FILE };
			}
			throw error;
		}
	}
}

/** The name of a step of undo (exact undo, "Comments"): deleting a highlight is Delete Highlight. */
function stepLabel(kind: BaseHalfCommentStep, name: string, before: IBaseHalfComment | undefined): string {
	switch (kind) {
		case 'highlight': return localize('basehalf.comments.step.highlight', "Highlight in {0}", name);
		case 'comment': return localize('basehalf.comments.step.comment', "Add Comment to {0}", name);
		case 'edit': return localize('basehalf.comments.step.edit', "Edit Comment in {0}", name);
		case 'color': return localize('basehalf.comments.step.color', "Change Color in {0}", name);
		case 'reply': return localize('basehalf.comments.step.reply', "Reply in {0}", name);
		case 'delete': return before && isBaseHalfHighlight(before)
			? localize('basehalf.comments.step.deleteHighlight', "Delete Highlight in {0}", name)
			: localize('basehalf.comments.step.delete', "Delete Comment in {0}", name);
		case 'follow': return name;
	}
}

function sameComment(left: IBaseHalfComment | undefined, right: IBaseHalfComment | undefined): boolean {
	return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function isConflict(error: unknown): boolean {
	return error instanceof FileOperationError && (
		error.fileOperationResult === FileOperationResult.FILE_MODIFIED_SINCE
		|| error.fileOperationResult === FileOperationResult.FILE_MOVE_CONFLICT
		|| error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND
	);
}

/** One change of a comment, a step of the canvas undo: undo puts back the comment before it, and redo the one after it. */
class BaseHalfCommentUndoStep implements IWorkspaceUndoRedoElement {
	readonly type = UndoRedoElementType.Workspace;
	readonly code = 'basehalf.comments';
	/** A resource of the step's own: the step stands in the canvas undo, by its source. */
	readonly resources: readonly URI[] = [URI.from({ scheme: 'basehalf-comment', path: `/${generateUuid()}` })];
	private state: 'done' | 'undone' | 'over' = 'done';

	constructor(
		readonly label: string,
		readonly kind: BaseHalfCommentStep,
		private readonly target: IBaseHalfCommentsTarget,
		readonly id: string,
		private readonly before: IBaseHalfComment | undefined,
		/** Words saved again a moment later join this step. */
		public after: IBaseHalfComment | undefined,
		private readonly index: number,
		private readonly service: BaseHalfCommentService
	) { }

	get isDone(): boolean {
		return this.state === 'done';
	}

	async undo(): Promise<void> {
		if (this.state === 'done') {
			this.state = await this.service.applyStep(this.target, this.id, this.after, this.before, this.index) ? 'undone' : 'over';
		}
	}

	async redo(): Promise<void> {
		if (this.state === 'undone') {
			this.state = await this.service.applyStep(this.target, this.id, this.before, this.after, this.index) ? 'done' : 'over';
		}
	}
}

registerSingleton(IBaseHalfCommentService, BaseHalfCommentService, InstantiationType.Delayed);
