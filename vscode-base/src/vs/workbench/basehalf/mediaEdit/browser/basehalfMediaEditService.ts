/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { basename, dirname, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { IBaseHalfFileClonesService } from '../../../../platform/basehalfFiles/common/basehalfFileClones.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { FileOperation, IFileService } from '../../../../platform/files/common/files.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { findValidPasteFileTargetForResource, incrementFileName } from '../../../contrib/files/browser/fileActions.js';
import { IFilesConfiguration } from '../../../contrib/files/common/files.js';
import { IBaseHalfCanvasMirrorService } from '../../canvas/common/basehalfCanvasMirror.js';
import { baseHalfCanvasDefaultCardSize, baseHalfCanvasGenerationCardSize, IBaseHalfCanvasSize } from '../../canvas/common/basehalfCanvasModel.js';
import { IBaseHalfWorkspaceResource } from '../../navigation/common/basehalfCanvasNavigation.js';
import { IBaseHalfReferenceEditService } from '../../references/common/basehalfReferenceEdit.js';
import { baseHalfParentCanvasFolder, placeBaseHalfCardsBeside } from '../../video/browser/basehalfGenerationPlacement.js';
import { baseHalfPathHoldsDraft } from '../../video/common/basehalfGenerationDraft.js';
import { IBaseHalfFileReplacement, IBaseHalfKeptVersionsService } from '../../workspace/browser/basehalfKeptVersions.js';
import { readBaseHalfFileRange } from '../../workspace/common/basehalfFileRange.js';
import { baseHalfIsWorkspaceFolderMarked } from '../../workspace/common/basehalfLegacyCleanup.js';
import { baseHalfEnsureMirrorIgnoreFile } from '../../workspace/common/basehalfMirrorIgnore.js';
import { baseHalfMirrorResource } from '../../workspace/common/basehalfMirrorTree.js';
import { baseHalfComputeFileFingerprint } from '../../workspace/common/basehalfMovedItems.js';
import { IBaseHalfWorkspaceMutationCoordinator } from '../../workspace/common/basehalfWorkspaceMutation.js';
import {
	BASEHALF_EDIT_RECORD_FILE,
	BaseHalfMediaKind,
	baseHalfEditOriginalName,
	baseHalfIsEditOriginalName,
	IBaseHalfEditRecord,
	IBaseHalfEditResult,
	IBaseHalfMediaChoices,
	normalizeBaseHalfMediaChoices,
	parseBaseHalfEditRecord,
	serializeBaseHalfEditRecord
} from '../common/basehalfEditRecord.js';
import { baseHalfOrientedSize, IBaseHalfImageInfo, readBaseHalfImageInfo } from '../common/basehalfImageFile.js';
import { readBaseHalfIsoBmffFile } from '../common/basehalfIsoBmffReader.js';
import { baseHalfMediaChoicesAreNoEdit, baseHalfMediaEditExtension, baseHalfMediaEditKind, baseHalfMediaEditRefusal } from '../common/basehalfMediaEditFormats.js';
import { planBaseHalfVideoClip } from '../common/basehalfVideoClipPlan.js';
import { baseHalfVideoFrameEdges, BaseHalfVideoFileError, IBaseHalfVideoByteSource, IBaseHalfVideoFile } from '../common/basehalfVideoFile.js';
import { BaseHalfVideoTrimTimeline } from '../common/basehalfVideoTrimSelection.js';
import { readBaseHalfWebmFile } from '../common/basehalfWebmReader.js';
import { BASEHALF_IMAGE_MAX_PIXELS, BASEHALF_IMAGE_MAX_SIDE, BaseHalfImageCropError, encodeBaseHalfImageCrop } from './basehalfImageCropEncoder.js';
import { BASEHALF_SOUND_MAX_SECONDS, BaseHalfSoundEditError, encodeBaseHalfSoundParts, IBaseHalfSoundInfo, readBaseHalfSoundInfo } from './basehalfSoundEncoder.js';
import { encodeBaseHalfVideoClip } from './basehalfVideoClipEncoder.js';

/**
 * Saves the edits of Card Detail's edit mode (editing media, "The edit
 * model"): reads what Edit starts from, the original of an edited file or the
 * file itself; encodes the edit of it in memory, writes it into the
 * workspace's cache folder, and puts it in the file's place with the edit
 * record, the file as it was becoming the original at its first edit; saves
 * an edit as a new file beside the file instead; and puts the original back.
 * Each is one step of the canvas undo (exact undo, "Changing files in
 * place"). A save goes on when Card Detail closes; its end is a notification
 * when no Card Detail shows the file.
 */

export const IBaseHalfMediaEditService = createDecorator<IBaseHalfMediaEditService>('baseHalfMediaEditService');

/** A video read as an edit reads it: its index, and the source of its bytes. */
export interface IBaseHalfEditVideo {
	readonly file: IBaseHalfVideoFile;
	readonly source: IBaseHalfVideoByteSource;
}

/** An image read as an edit reads it: what its file says, and its size upright as its camera gave it. */
export interface IBaseHalfEditImage {
	readonly info: IBaseHalfImageInfo;
	readonly width: number;
	readonly height: number;
}

/** What Edit starts from. */
export interface IBaseHalfMediaEditState {
	readonly kind: BaseHalfMediaKind;
	/** The version of the file when it was read: a save refuses a file that changed since. */
	readonly version: string;
	/** What the editor shows and a save encodes from: the original of an edited file, or the file. */
	readonly source: URI;
	/** The edit of an edited file, whose original is there and which the file is still the result of. */
	readonly record?: IBaseHalfEditRecord;
	/** The video of `source`, read. */
	readonly video?: IBaseHalfEditVideo;
	/** The image of `source`, read. */
	readonly image?: IBaseHalfEditImage;
	/** The sound of `source`, read. */
	readonly sound?: IBaseHalfSoundInfo;
	/** Why the file cannot be edited, in the words of Edit's hover. */
	readonly unavailable?: string;
}

export type BaseHalfMediaSaveKind = 'edit' | 'new' | 'revert';

export interface IBaseHalfMediaSaveProgress {
	readonly file: URI;
	readonly kind: BaseHalfMediaSaveKind;
	/** From 0 to 1. */
	readonly done: number;
}

export interface IBaseHalfMediaSaved {
	readonly kind: BaseHalfMediaSaveKind;
	/** The file the step wrote: the file, or the new file of Save as New. */
	readonly resource: URI;
	/** The version of the edited file after the step, which Save as New leaves as it was. */
	readonly version: string;
	/** The video's sound could not be decoded or encoded: what was saved has none. */
	readonly soundDropped: boolean;
}

export interface IBaseHalfMediaEditService {
	readonly _serviceBrand: undefined;
	/** A save of a file started, moved on, or ended. */
	readonly onDidChangeSave: Event<URI>;
	/** What Edit starts from for the file; never rejects. */
	readEditState(file: IBaseHalfWorkspaceResource): Promise<IBaseHalfMediaEditState>;
	/** Reads a video as an edit reads it; rejects with a `BaseHalfVideoFileError`. */
	readVideo(resource: URI): Promise<IBaseHalfEditVideo>;
	/** The save of the file that runs. */
	runningSave(file: URI): IBaseHalfMediaSaveProgress | undefined;
	/** Done: writes the edit of the source into the file, with its record, in one step of the canvas undo. */
	save(file: IBaseHalfWorkspaceResource, state: IBaseHalfMediaEditState, choices: IBaseHalfMediaChoices): Promise<IBaseHalfMediaSaved>;
	/** Save as New: writes the edit of the source into a new file beside the file, its card connected from the file's. */
	saveAsNew(file: IBaseHalfWorkspaceResource, state: IBaseHalfMediaEditState, choices: IBaseHalfMediaChoices): Promise<IBaseHalfMediaSaved>;
	/** Revert: puts the original back in the file's place, and removes it and the record. */
	revert(file: IBaseHalfWorkspaceResource, state: IBaseHalfMediaEditState): Promise<IBaseHalfMediaSaved>;
	/** The step that made this version of the file, while the window is open. */
	lastSave(file: URI, version: string): IBaseHalfMediaSaved | undefined;
	/** Card Detail shows the file: the end of its save is shown there, not in a notification. */
	showFile(file: URI): IDisposable;
}

/** Why a save ends with the file as it was, in the words of the status line. */
export class BaseHalfMediaEditError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BaseHalfMediaEditError';
	}
}

/** How many files the window keeps the last step for. */
const MAX_KEPT_FILES = 100;
/** The first bytes of an image, which hold its size and its information in nearly every file. */
const IMAGE_HEADER_BYTES = 256 * 1024;
/** The largest sound file an edit reads: it is read whole. */
const SOUND_MAX_BYTES = 256 * 1024 * 1024;
/** A file in the cache folder of edits this old was left by a save that a closed window stopped. */
const LEFTOVER_AGE_MS = 60 * 60 * 1000;

/** The bytes of a file, read a part at a time from the disk. */
export function baseHalfMediaFileByteSource(fileService: IFileService, resource: URI, size: number): IBaseHalfVideoByteSource {
	return {
		size,
		async read(offset: number, length: number): Promise<Uint8Array> {
			const clamped = Math.max(0, Math.min(length, size - offset));
			if (clamped === 0) {
				return new Uint8Array(0);
			}
			return (await readBaseHalfFileRange(fileService, resource, offset, clamped)).buffer;
		}
	};
}

/** The version of a file that the state of an edit and a step's status belong to. */
export function baseHalfMediaVersion(stat: { readonly mtime?: number; readonly size?: number }): string {
	return `${stat.mtime ?? 0}-${stat.size ?? 0}`;
}

/** The fingerprint of bytes, as following moved items takes one of a file. */
export async function baseHalfEditResultOf(bytes: Uint8Array): Promise<IBaseHalfEditResult> {
	const fingerprint = await baseHalfComputeFileFingerprint({
		size: bytes.byteLength,
		read: (position, length) => Promise.resolve(VSBuffer.wrap(bytes.subarray(position, position + length)))
	}, false);
	if (!fingerprint) {
		throw new BaseHalfMediaEditError(localize('basehalf.mediaEdit.save.empty', "the edited file would be empty."));
	}
	return { size: fingerprint.size, hash: fingerprint.hash };
}

interface IRenderedEdit {
	readonly bytes: Uint8Array;
	readonly soundDropped: boolean;
	/** The size the card of a new file of it is drawn at. */
	readonly cardSize: IBaseHalfCanvasSize;
}

export class BaseHalfMediaEditService extends Disposable implements IBaseHalfMediaEditService {
	declare readonly _serviceBrand: undefined;

	private readonly onDidChangeSaveEmitter = this._register(new Emitter<URI>());
	readonly onDidChangeSave = this.onDidChangeSaveEmitter.event;

	private readonly saves = new ResourceMap<IBaseHalfMediaSaveProgress>();
	private readonly saved = new ResourceMap<IBaseHalfMediaSaved>();
	private readonly shown = new ResourceMap<number>();

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IBaseHalfKeptVersionsService private readonly keptVersionsService: IBaseHalfKeptVersionsService,
		@IBaseHalfFileClonesService private readonly fileClonesService: IBaseHalfFileClonesService,
		@IBaseHalfCanvasMirrorService private readonly canvasMirrorService: IBaseHalfCanvasMirrorService,
		@IBaseHalfReferenceEditService private readonly referenceEditService: IBaseHalfReferenceEditService,
		@IBaseHalfWorkspaceMutationCoordinator private readonly workspaceMutationCoordinator: IBaseHalfWorkspaceMutationCoordinator,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IDialogService private readonly dialogService: IDialogService,
		@INotificationService private readonly notificationService: INotificationService,
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	// #region Reading

	async readEditState(file: IBaseHalfWorkspaceResource): Promise<IBaseHalfMediaEditState> {
		const kind = baseHalfMediaEditKind(file.resource);
		const stat = await this.fileService.stat(file.resource).catch(() => undefined);
		const version = stat ? baseHalfMediaVersion(stat) : '';
		const refuse = (unavailable: string): IBaseHalfMediaEditState => ({ kind: kind ?? 'image', version, source: file.resource, unavailable });
		if (!kind) {
			return refuse(baseHalfMediaEditRefusal(file.resource));
		}
		if (!stat?.isFile) {
			return refuse(localize('basehalf.mediaEdit.unavailable.read', "BaseHalf can't edit this file: it could not be read."));
		}
		if (await baseHalfIsWorkspaceFolderMarked(this.fileService, file.workspaceFolder)) {
			// The source tree of BaseHalf itself keeps no card information (spec-driven development).
			return refuse(localize('basehalf.mediaEdit.unavailable.marked', "BaseHalf keeps no card information in this folder, so it can't keep an original."));
		}
		const record = await this.readRecord(file, stat.size);
		const read = { kind, version, source: record ? joinPath(this.cardInformation(file), record.original) : file.resource, ...(record ? { record } : {}) };
		switch (kind) {
			case 'video': return { ...read, ...await this.videoState(read.source) };
			case 'image': return { ...read, ...await this.imageState(read.source) };
			case 'sound': return { ...read, ...await this.soundState(read.source) };
		}
	}

	/** The sound that Edit shows, or why it cannot. */
	private async soundState(source: URI): Promise<Pick<IBaseHalfMediaEditState, 'sound' | 'unavailable'>> {
		const refusal = (reason: string) => ({ unavailable: localize('basehalf.mediaEdit.unavailable.sound', "BaseHalf can't edit this sound: {0}", reason) });
		try {
			const stat = await this.fileService.stat(source);
			if (stat.size > SOUND_MAX_BYTES) {
				return refusal(localize('basehalf.mediaEdit.unavailable.largeSound', "its file is larger than 256 MB."));
			}
			const sound = await readBaseHalfSoundInfo((await this.fileService.readFile(source)).value.buffer, baseHalfMediaEditExtension(source));
			if (sound.duration > BASEHALF_SOUND_MAX_SECONDS) {
				return refusal(localize('basehalf.mediaEdit.unavailable.longSound', "it is longer than 30 minutes."));
			}
			return { sound };
		} catch (error) {
			if (!(error instanceof BaseHalfSoundEditError)) {
				this.logService.warn(`[BaseHalf] could not read ${source.toString()} for an edit`, error);
			}
			return refusal(error instanceof BaseHalfSoundEditError ? error.message : localize('basehalf.mediaEdit.unavailable.readSound', "its file could not be read."));
		}
	}

	/** The image that Edit shows, or why it cannot. */
	private async imageState(source: URI): Promise<Pick<IBaseHalfMediaEditState, 'image' | 'unavailable'>> {
		const refusal = (reason: string) => ({ unavailable: localize('basehalf.mediaEdit.unavailable.image', "BaseHalf can't edit this image: {0}", reason) });
		let info: IBaseHalfImageInfo | undefined;
		try {
			// Its header is enough: the size, the orientation, and the information it keeps.
			info = readBaseHalfImageInfo((await readBaseHalfFileRange(this.fileService, source, 0, IMAGE_HEADER_BYTES)).buffer)
				?? readBaseHalfImageInfo((await this.fileService.readFile(source)).value.buffer);
		} catch (error) {
			this.logService.warn(`[BaseHalf] could not read ${source.toString()} for an edit`, error);
			return refusal(localize('basehalf.mediaEdit.unavailable.readImage', "its file could not be read."));
		}
		if (!info) {
			return refusal(localize('basehalf.mediaEdit.unavailable.formatImage', "its file could not be read as PNG, JPEG, or WebP."));
		}
		const { width, height } = baseHalfOrientedSize(info);
		if (width > BASEHALF_IMAGE_MAX_SIDE || height > BASEHALF_IMAGE_MAX_SIDE || width * height > BASEHALF_IMAGE_MAX_PIXELS) {
			return refusal(localize('basehalf.mediaEdit.unavailable.largeImage', "it is larger than 16,384 pixels on a side or 256 million pixels."));
		}
		return { image: { info, width, height } };
	}

	/** The video that Edit shows, or why it cannot. */
	private async videoState(source: URI): Promise<Pick<IBaseHalfMediaEditState, 'video' | 'unavailable'>> {
		const refusal = (reason: string) => ({ unavailable: localize('basehalf.mediaEdit.unavailable.video', "BaseHalf can't edit this video: {0}", reason) });
		try {
			const video = await this.readVideo(source);
			if (!video.file.video) {
				return refusal(localize('basehalf.mediaEdit.unavailable.noPicture', "it has no picture."));
			}
			if (!video.file.video.codec) {
				return refusal(localize('basehalf.mediaEdit.unavailable.decode', "this system cannot decode its picture."));
			}
			return { video };
		} catch (error) {
			if (!(error instanceof BaseHalfVideoFileError)) {
				this.logService.warn(`[BaseHalf] could not read ${source.toString()} for an edit`, error);
			}
			return refusal(error instanceof BaseHalfVideoFileError ? error.message : localize('basehalf.mediaEdit.unavailable.readVideo', "its file could not be read."));
		}
	}

	async readVideo(resource: URI): Promise<IBaseHalfEditVideo> {
		let size: number;
		try {
			size = (await this.fileService.stat(resource)).size;
		} catch {
			throw new BaseHalfVideoFileError('read');
		}
		const source = baseHalfMediaFileByteSource(this.fileService, resource, size);
		const extension = baseHalfMediaEditExtension(resource);
		try {
			const file = extension === 'webm'
				? await readBaseHalfWebmFile(source)
				: await readBaseHalfIsoBmffFile(source, extension === 'mov' ? 'mov' : 'mp4');
			return { file, source };
		} catch (error) {
			if (error instanceof BaseHalfVideoFileError) {
				throw error;
			}
			// A box or an element that runs past what it holds is a damaged index.
			throw new BaseHalfVideoFileError(error instanceof RangeError ? 'format' : 'read');
		}
	}

	/** The folder of the file's card information, which holds its original and its edit record. */
	private cardInformation(file: IBaseHalfWorkspaceResource): URI {
		return dirname(baseHalfMirrorResource(file.workspaceFolder, file.relativePath, BASEHALF_EDIT_RECORD_FILE));
	}

	/**
	 * The edit record of a file that is still the result of it and whose
	 * original is there (editing media, "A file that changed outside
	 * BaseHalf"); nothing for any other file, which is treated as not edited.
	 */
	private async readRecord(file: IBaseHalfWorkspaceResource, size: number): Promise<IBaseHalfEditRecord | undefined> {
		const folder = this.cardInformation(file);
		let text: string;
		try {
			text = (await this.fileService.readFile(joinPath(folder, BASEHALF_EDIT_RECORD_FILE))).value.toString();
		} catch {
			return undefined;
		}
		const record = parseBaseHalfEditRecord(text);
		if (!record) {
			// A record that cannot be read is left as it is, byte for byte.
			this.logService.info(`[BaseHalf] the edit record of ${file.relativePath} cannot be read; it is edited from the file as it is`);
			return undefined;
		}
		// The original of a file is named by its own extension: one of another is of another file.
		if (record.original !== baseHalfEditOriginalName(baseHalfMediaEditExtension(file.resource)) || record.result.size !== size) {
			return undefined;
		}
		const original = await this.fileService.stat(joinPath(folder, record.original)).catch(() => undefined);
		if (!original?.isFile) {
			return undefined;
		}
		const fingerprint = await baseHalfComputeFileFingerprint({
			size,
			read: (position, length) => readBaseHalfFileRange(this.fileService, file.resource, position, length)
		}, false).catch(() => undefined);
		return fingerprint?.hash === record.result.hash ? record : undefined;
	}

	// #endregion

	// #region Saving

	runningSave(file: URI): IBaseHalfMediaSaveProgress | undefined {
		return this.saves.get(file);
	}

	lastSave(file: URI, version: string): IBaseHalfMediaSaved | undefined {
		const saved = this.saved.get(file);
		return saved?.version === version ? saved : undefined;
	}

	showFile(file: URI): IDisposable {
		this.shown.set(file, (this.shown.get(file) ?? 0) + 1);
		return toDisposable(() => {
			const count = (this.shown.get(file) ?? 1) - 1;
			if (count > 0) {
				this.shown.set(file, count);
			} else {
				this.shown.delete(file);
			}
		});
	}

	save(file: IBaseHalfWorkspaceResource, state: IBaseHalfMediaEditState, choices: IBaseHalfMediaChoices): Promise<IBaseHalfMediaSaved> {
		if (baseHalfMediaChoicesAreNoEdit(normalizeBaseHalfMediaChoices(choices))) {
			// Choices that leave the original as it was are no edit: an edited file is reverted.
			return state.record
				? this.revert(file, state)
				: Promise.resolve({ kind: 'edit', resource: file.resource, version: state.version, soundDropped: false });
		}
		return this.run(file, 'edit', () => this.doSave(file, state, choices));
	}

	saveAsNew(file: IBaseHalfWorkspaceResource, state: IBaseHalfMediaEditState, choices: IBaseHalfMediaChoices): Promise<IBaseHalfMediaSaved> {
		if (baseHalfMediaChoicesAreNoEdit(normalizeBaseHalfMediaChoices(choices))) {
			return Promise.reject(new BaseHalfMediaEditError(localize('basehalf.mediaEdit.saveAsNew.noEdit', "make an edit first.")));
		}
		return this.run(file, 'new', () => this.doSaveAsNew(file, state, choices));
	}

	revert(file: IBaseHalfWorkspaceResource, state: IBaseHalfMediaEditState): Promise<IBaseHalfMediaSaved> {
		if (!state.record) {
			return Promise.reject(new BaseHalfMediaEditError(localize('basehalf.mediaEdit.revert.notEdited', "the file has no original to go back to.")));
		}
		return this.run(file, 'revert', () => this.doRevert(file, state));
	}

	/** Runs one save of a file at a time, with its progress, and its end as a notification when Card Detail does not show the file. */
	private async run(file: IBaseHalfWorkspaceResource, kind: BaseHalfMediaSaveKind, task: () => Promise<IBaseHalfMediaSaved>): Promise<IBaseHalfMediaSaved> {
		if (this.saves.has(file.resource)) {
			throw new BaseHalfMediaEditError(localize('basehalf.mediaEdit.save.running', "the file is being saved."));
		}
		this.setProgress(file.resource, kind, 0);
		try {
			const saved = await task();
			this.keep(file.resource, saved);
			this.endSave(file.resource);
			if (!this.shown.has(file.resource)) {
				this.notificationService.info(savedNotification(saved, basename(file.resource)));
			}
			return saved;
		} catch (error) {
			this.endSave(file.resource);
			const message = error instanceof Error ? error.message : String(error);
			if (!(error instanceof BaseHalfMediaEditError)) {
				this.logService.warn(`[BaseHalf] could not save the edit of ${file.relativePath}`, error);
			}
			if (!this.shown.has(file.resource)) {
				this.notificationService.error(localize('basehalf.mediaEdit.save.failedNotification', "BaseHalf could not save the edit of {0}: {1}", basename(file.resource), message));
			}
			throw error instanceof BaseHalfMediaEditError ? error : new BaseHalfMediaEditError(message);
		}
	}

	private keep(file: URI, saved: IBaseHalfMediaSaved): void {
		this.saved.delete(file);
		this.saved.set(file, saved);
		for (const key of this.saved.keys()) {
			if (this.saved.size <= MAX_KEPT_FILES) {
				break;
			}
			this.saved.delete(key);
		}
	}

	private setProgress(file: URI, kind: BaseHalfMediaSaveKind, done: number): void {
		this.saves.set(file, { file, kind, done });
		this.onDidChangeSaveEmitter.fire(file);
	}

	private endSave(file: URI): void {
		this.saves.delete(file);
		this.onDidChangeSaveEmitter.fire(file);
	}

	private async doSave(file: IBaseHalfWorkspaceResource, state: IBaseHalfMediaEditState, choices: IBaseHalfMediaChoices): Promise<IBaseHalfMediaSaved> {
		const rendered = await this.render(file, state, choices, 'edit');
		await this.assertUnchanged(file, state);
		const folder = this.cardInformation(file);
		const originalName = baseHalfEditOriginalName(baseHalfMediaEditExtension(file.resource));
		const record: IBaseHalfEditRecord = { original: originalName, result: await baseHalfEditResultOf(rendered.bytes), ...choices };
		const temporaries: URI[] = [];
		try {
			const edited = await this.writeTemporary(file, rendered.bytes);
			temporaries.push(edited);
			const changes: IBaseHalfFileReplacement[] = [
				{ resource: file.resource, contents: edited },
				{ resource: joinPath(folder, BASEHALF_EDIT_RECORD_FILE), contents: VSBuffer.fromString(serializeBaseHalfEditRecord(record)) }
			];
			if (!state.record) {
				// The first edit keeps the file as it is as the original; an original before goes with the step's kept versions.
				const original = await this.cloneTemporary(file, file.resource);
				temporaries.push(original);
				changes.push({ resource: joinPath(folder, originalName), contents: original });
				for (const stray of await this.otherOriginals(folder, originalName)) {
					changes.push({ resource: stray, contents: null });
				}
			}
			await this.keptVersionsService.replaceFiles(changes, { label: localize('basehalf.mediaEdit.save.step', "Edit {0}", basename(file.resource)) });
			temporaries.length = 0;
		} finally {
			await this.deleteTemporaries(temporaries);
		}
		return { kind: 'edit', resource: file.resource, version: await this.versionOf(file.resource), soundDropped: rendered.soundDropped };
	}

	private async doRevert(file: IBaseHalfWorkspaceResource, state: IBaseHalfMediaEditState): Promise<IBaseHalfMediaSaved> {
		await this.assertUnchanged(file, state);
		const folder = this.cardInformation(file);
		const original = joinPath(folder, state.record!.original);
		const temporaries: URI[] = [];
		try {
			// The original is copied into the cache: a file of the workspace never moves from one path of a step to another.
			const copy = await this.cloneTemporary(file, original);
			temporaries.push(copy);
			this.setProgress(file.resource, 'revert', 0.5);
			await this.keptVersionsService.replaceFiles([
				{ resource: file.resource, contents: copy },
				{ resource: original, contents: null },
				{ resource: joinPath(folder, BASEHALF_EDIT_RECORD_FILE), contents: null }
			], { label: localize('basehalf.mediaEdit.revert.step', "Revert {0}", basename(file.resource)) });
			temporaries.length = 0;
		} finally {
			await this.deleteTemporaries(temporaries);
		}
		return { kind: 'revert', resource: file.resource, version: await this.versionOf(file.resource), soundDropped: false };
	}

	private async doSaveAsNew(file: IBaseHalfWorkspaceResource, state: IBaseHalfMediaEditState, choices: IBaseHalfMediaChoices): Promise<IBaseHalfMediaSaved> {
		const rendered = await this.render(file, state, choices, 'new');
		await this.assertUnchanged(file, state);
		const temporaries: URI[] = [];
		let target: URI | undefined;
		try {
			const edited = await this.writeTemporary(file, rendered.bytes);
			temporaries.push(edited);
			const canvasFolder = baseHalfParentCanvasFolder(file);
			target = await this.workspaceMutationCoordinator.runExclusive(file.workspaceFolder, async lease => {
				const free = await this.newFileTarget(file);
				// The window is told the new file's creation, and nothing of the move from the cache.
				await this.fileService.move(edited, free, false, FileOperation.CREATE);
				temporaries.length = 0;
				// Its card is 40 to the right of the file's, at the nearest open place (canvas card placement, "Pointing").
				await placeBaseHalfCardsBeside(
					{ fileService: this.fileService, canvasMirrorService: this.canvasMirrorService, logService: this.logService },
					canvasFolder, file.relativePath, [{ path: siblingPath(file, basename(free)), size: rendered.cardSize }], { lease });
				return free;
			});
		} finally {
			await this.deleteTemporaries(temporaries);
		}
		const name = basename(target);
		const relativePath = siblingPath(file, name);
		try {
			// The new file is made from the file: its connection comes from it, kept with the file by the step's undo.
			await this.referenceEditService.add({ resource: target, workspaceFolder: file.workspaceFolder, relativePath }, file.relativePath, {
				label: localize('basehalf.mediaEdit.saveAsNew.connect', "Save {0}", name)
			});
		} catch (error) {
			this.logService.warn(`[BaseHalf] ${relativePath} was not connected from ${file.relativePath}`, error);
		}
		// One step of the canvas undo: undo keeps the new file with its card information, and redo brings it back (exact undo, "What the canvas made").
		this.keptVersionsService.recordMade([target], { label: localize('basehalf.mediaEdit.saveAsNew.step', "Save {0}", name) });
		// The file itself is as it was.
		return { kind: 'new', resource: target, version: state.version, soundDropped: rendered.soundDropped };
	}

	/** The name of the new file of Save as New, as Duplicate names a copy, never one that a draft has. */
	private async newFileTarget(file: IBaseHalfWorkspaceResource): Promise<URI> {
		const configured = this.configurationService.getValue<IFilesConfiguration>().explorer?.incrementalNaming ?? 'simple';
		// A copy never replaces an item: undo could not give it back (exact undo, "What the canvas made").
		const naming = configured === 'disabled' ? 'smart' : configured;
		const folder = dirname(file.resource);
		let target = await findValidPasteFileTargetForResource(this.fileService, this.dialogService, folder, { resource: file.resource, isDirectory: false, allowOverwrite: false }, naming);
		for (let attempt = 0; target && attempt < 1000; attempt++) {
			if (!await this.fileService.exists(target) && !await baseHalfPathHoldsDraft(this.fileService, file.workspaceFolder, siblingPath(file, basename(target))).catch(() => false)) {
				return target;
			}
			target = joinPath(folder, incrementFileName(basename(target), false, naming));
		}
		throw new BaseHalfMediaEditError(localize('basehalf.mediaEdit.saveAsNew.noName', "no free name is left beside the file."));
	}

	/** Encodes the edit of the state's source, with the progress of the save. */
	private async render(file: IBaseHalfWorkspaceResource, state: IBaseHalfMediaEditState, choices: IBaseHalfMediaChoices, kind: BaseHalfMediaSaveKind): Promise<IRenderedEdit> {
		if (state.unavailable) {
			throw new BaseHalfMediaEditError(state.unavailable);
		}
		switch (state.kind) {
			case 'video': return this.renderVideo(file, state, choices, kind);
			case 'image': return this.renderImage(file, state, choices, kind);
			case 'sound': return this.renderSound(file, state, choices, kind);
		}
	}

	/** Keeps the parts of a sound, joined, in its format. */
	private async renderSound(file: IBaseHalfWorkspaceResource, state: IBaseHalfMediaEditState, choices: IBaseHalfMediaChoices, kind: BaseHalfMediaSaveKind): Promise<IRenderedEdit> {
		const info = state.sound;
		if (!info) {
			throw new BaseHalfMediaEditError(localize('basehalf.mediaEdit.save.noSound', "the sound could not be read."));
		}
		const bytes = (await this.fileService.readFile(state.source)).value.buffer;
		this.setProgress(file.resource, kind, 0.3);
		try {
			const encoded = await encodeBaseHalfSoundParts(bytes, info, choices.keep ?? [{ start: 0, end: info.duration }]);
			this.setProgress(file.resource, kind, 0.9);
			return { bytes: encoded, soundDropped: false, cardSize: baseHalfCanvasGenerationCardSize('audio') };
		} catch (error) {
			throw error instanceof BaseHalfSoundEditError ? new BaseHalfMediaEditError(error.message) : error;
		}
	}

	/** Crops, turns, flips, and straightens an image, in its format, with its information. */
	private async renderImage(file: IBaseHalfWorkspaceResource, state: IBaseHalfMediaEditState, choices: IBaseHalfMediaChoices, kind: BaseHalfMediaSaveKind): Promise<IRenderedEdit> {
		const bytes = (await this.fileService.readFile(state.source)).value.buffer;
		const info = readBaseHalfImageInfo(bytes);
		if (!info) {
			throw new BaseHalfMediaEditError(localize('basehalf.mediaEdit.save.formatImage', "the image could not be read as PNG, JPEG, or WebP."));
		}
		this.setProgress(file.resource, kind, 0.3);
		try {
			const encoding = await encodeBaseHalfImageCrop(bytes, info, choices);
			this.setProgress(file.resource, kind, 0.9);
			return { bytes: encoding.bytes, soundDropped: false, cardSize: baseHalfCanvasGenerationCardSize('image', encoding.width / encoding.height) };
		} catch (error) {
			throw error instanceof BaseHalfImageCropError ? new BaseHalfMediaEditError(error.message) : error;
		}
	}

	/** Trims a video, and takes its sound away when it is muted. */
	private async renderVideo(file: IBaseHalfWorkspaceResource, state: IBaseHalfMediaEditState, choices: IBaseHalfMediaChoices, kind: BaseHalfMediaSaveKind): Promise<IRenderedEdit> {
		const video = state.video ?? await this.readVideo(state.source);
		const picture = video.file.video;
		if (!picture) {
			throw new BaseHalfMediaEditError(localize('basehalf.mediaEdit.save.noPicture', "the video has no picture."));
		}
		// The parts of a record are to the millisecond: the frames kept are those between the frame edges nearest to them.
		const timeline = new BaseHalfVideoTrimTimeline(baseHalfVideoFrameEdges(picture));
		const range = timeline.normalize(choices.keep?.[0]);
		const plan = planBaseHalfVideoClip(video.file, baseHalfMediaEditExtension(state.source), range, { mute: !!choices.mute });
		let lastReport = 0;
		const encoding = await encodeBaseHalfVideoClip({
			source: video.source,
			file: video.file,
			plan,
			onProgress: done => {
				// A few steps a second are enough for the status line.
				const now = Date.now();
				if (now - lastReport > 100 || done >= 1) {
					lastReport = now;
					this.setProgress(file.resource, kind, done * 0.95);
				}
			}
		});
		const turned = picture.rotation === 90 || picture.rotation === 270;
		const ratio = turned ? picture.displayHeight / picture.displayWidth : picture.displayWidth / picture.displayHeight;
		return {
			bytes: encoding.bytes,
			soundDropped: encoding.soundDropped,
			cardSize: Number.isFinite(ratio) && ratio > 0 ? baseHalfCanvasGenerationCardSize('video', ratio) : baseHalfCanvasDefaultCardSize('file')
		};
	}

	/** Refuses a file that changed, moved, or went away since its state was read. */
	private async assertUnchanged(file: IBaseHalfWorkspaceResource, state: IBaseHalfMediaEditState): Promise<void> {
		const stat = await this.fileService.stat(file.resource).catch(() => undefined);
		if (!stat || baseHalfMediaVersion(stat) !== state.version || (state.record && !await this.fileService.exists(state.source))) {
			throw new BaseHalfMediaEditError(localize('basehalf.mediaEdit.save.changed', "the file changed meanwhile."));
		}
	}

	/** The originals of other extensions beside the record, left by a file whose extension changed: they go with the step. */
	private async otherOriginals(folder: URI, name: string): Promise<URI[]> {
		const listing = await this.fileService.resolve(folder).catch(() => undefined);
		return (listing?.children ?? []).filter(child => child.isFile && child.name !== name && baseHalfIsEditOriginalName(child.name)).map(child => child.resource);
	}

	/** The cache folder of edits, made ready, with what saves that a closed window stopped left in it deleted. */
	private async cacheFolder(file: IBaseHalfWorkspaceResource): Promise<URI> {
		await baseHalfEnsureMirrorIgnoreFile(this.fileService, file.workspaceFolder);
		const folder = joinPath(file.workspaceFolder, '.bh', 'cache', 'edit');
		const listing = await this.fileService.resolve(folder, { resolveMetadata: true }).catch(() => undefined);
		const now = Date.now();
		for (const child of listing?.children ?? []) {
			// Nothing that runs is this old.
			if (child.isFile && now - child.mtime > LEFTOVER_AGE_MS) {
				await this.fileService.del(child.resource).catch(error => this.logService.warn(`[BaseHalf] could not delete what an edit left: ${child.resource.toString()}`, error));
			}
		}
		await this.fileService.createFolder(folder);
		return folder;
	}

	/** Writes the bytes of an edit whole into the cache folder, to be moved into place. */
	private async writeTemporary(file: IBaseHalfWorkspaceResource, bytes: Uint8Array): Promise<URI> {
		const temporary = joinPath(await this.cacheFolder(file), `${generateUuid()}.${baseHalfMediaEditExtension(file.resource)}`);
		await this.fileService.createFile(temporary, VSBuffer.wrap(bytes), { overwrite: false });
		return temporary;
	}

	/** Clones a file of the workspace into the cache folder: a clone takes no room on a disk that can make one. */
	private async cloneTemporary(file: IBaseHalfWorkspaceResource, source: URI): Promise<URI> {
		const temporary = joinPath(await this.cacheFolder(file), `${generateUuid()}.${baseHalfMediaEditExtension(file.resource)}`);
		await this.fileClonesService.clone(source, temporary);
		return temporary;
	}

	private async deleteTemporaries(temporaries: readonly URI[]): Promise<void> {
		for (const temporary of temporaries) {
			await this.fileService.del(temporary).catch(() => undefined);
		}
	}

	private async versionOf(resource: URI): Promise<string> {
		const stat = await this.fileService.stat(resource).catch(() => undefined);
		return stat ? baseHalfMediaVersion(stat) : '';
	}

	// #endregion
}

/** The workspace path of a file beside the file. */
function siblingPath(file: IBaseHalfWorkspaceResource, name: string): string {
	const slash = file.relativePath.lastIndexOf('/');
	return slash < 0 ? name : `${file.relativePath.slice(0, slash)}/${name}`;
}

function savedNotification(saved: IBaseHalfMediaSaved, name: string): string {
	switch (saved.kind) {
		case 'edit': return saved.soundDropped
			? localize('basehalf.mediaEdit.save.editedNoSound', "Edited {0}, without sound: BaseHalf can't read or write its sound here.", name)
			: localize('basehalf.mediaEdit.save.edited', "Edited {0}.", name);
		case 'new': return localize('basehalf.mediaEdit.save.savedAsNew', "Saved {0}.", basename(saved.resource));
		case 'revert': return localize('basehalf.mediaEdit.save.reverted', "Reverted {0} to its original.", name);
	}
}
