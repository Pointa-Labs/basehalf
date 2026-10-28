/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { basename, dirname, isEqualOrParent, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { BaseHalfFilePart, IBaseHalfFileClonesService } from '../../../../platform/basehalfFiles/common/basehalfFileClones.js';
import { IBaseHalfFileTimesService } from '../../../../platform/basehalfFiles/common/basehalfFileTimes.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { FileOperation, FileSystemProviderCapabilities, IFileService } from '../../../../platform/files/common/files.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IUndoRedoService, IWorkspaceUndoRedoElement, UndoRedoElementType, UndoRedoGroup } from '../../../../platform/undoRedo/common/undoRedo.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import { BASEHALF_CANVAS_UNDO_REDO_SOURCE } from '../../canvas/common/basehalfCanvasEditing.js';
import { IBaseHalfWorkspaceResource } from '../../navigation/common/basehalfCanvasNavigation.js';
import { readBaseHalfFileRange } from '../../workspace/common/basehalfFileRange.js';
import { baseHalfIsWorkspaceFolderMarked } from '../../workspace/common/basehalfLegacyCleanup.js';
import { baseHalfEnsureMirrorIgnoreFile } from '../../workspace/common/basehalfMirrorIgnore.js';
import { baseHalfPreserveMirrorBytes } from '../../workspace/common/basehalfMirrorRecovery.js';
import { baseHalfMirrorResource } from '../../workspace/common/basehalfMirrorTree.js';
import { baseHalfComputeFileFingerprint } from '../../workspace/common/basehalfMovedItems.js';
import { IBaseHalfMovedItemsService } from '../../workspace/common/basehalfMovedItemsService.js';
import { IBaseHalfWorkspaceMutationCoordinator } from '../../workspace/common/basehalfWorkspaceMutation.js';
import {
	BASEHALF_EDIT_RECORD_FILE,
	BaseHalfMediaKind,
	baseHalfEditOriginalName,
	baseHalfIsEditOriginalName,
	IBaseHalfEditRecord,
	IBaseHalfEditResult,
	IBaseHalfMediaChoices,
	IBaseHalfMediaPart,
	normalizeBaseHalfMediaChoices,
	parseBaseHalfEditRecord,
	serializeBaseHalfEditRecord
} from '../common/basehalfEditRecord.js';
import { baseHalfReleaseEditOriginal } from '../common/basehalfGoneOriginals.js';
import { baseHalfOrientedSize, IBaseHalfImageInfo, readBaseHalfImageInfo } from '../common/basehalfImageFile.js';
import { readBaseHalfIsoBmffFile } from '../common/basehalfIsoBmffReader.js';
import { IBaseHalfMp4CopyLayout, writeBaseHalfMp4Copy } from '../common/basehalfIsoBmffWriter.js';
import { baseHalfMediaChoicesAreNoEdit, baseHalfMediaEditExtension, baseHalfMediaEditKind, baseHalfMediaEditRefusal } from '../common/basehalfMediaEditFormats.js';
import { baseHalfSoundShown, planBaseHalfVideoClip } from '../common/basehalfVideoClipPlan.js';
import { baseHalfCanCopyVideo, baseHalfCanCopyWebm, planBaseHalfMp4Copy, planBaseHalfWebmCopy } from '../common/basehalfVideoCopy.js';
import { baseHalfVideoFrameEdges, BaseHalfVideoFileError, IBaseHalfVideoByteSource, IBaseHalfVideoFile } from '../common/basehalfVideoFile.js';
import { BaseHalfVideoTrimTimeline } from '../common/basehalfVideoTrimSelection.js';
import { readBaseHalfWebmFile } from '../common/basehalfWebmReader.js';
import { BASEHALF_IMAGE_MAX_PIXELS, BASEHALF_IMAGE_MAX_SIDE, BaseHalfImageCropError, encodeBaseHalfImageCrop } from './basehalfImageCropEncoder.js';
import { BASEHALF_SOUND_MAX_SECONDS, BaseHalfSoundEditError, encodeBaseHalfSoundParts, IBaseHalfSoundInfo, readBaseHalfSoundInfo } from './basehalfSoundEncoder.js';
import { BaseHalfVideoClipError, encodeBaseHalfVideoClip, encodeBaseHalfWebmCopy } from './basehalfVideoClipEncoder.js';

/**
 * Edits media as the user changes it in Card Detail (editing media, "Changes
 * save themselves"): reads what an editor starts from, the original of an
 * edited file or the file itself; takes each change as one step of the canvas
 * undo, whose undo and redo put back choices; and writes the file after the
 * choices once they rest, one write of a file at a time, the file as it was
 * becoming the original at its first change. What it wrote for the last
 * choices of a file stays in the cache until the window closes, so that undo
 * and redo put back the very bytes.
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

/** What an editor starts from. */
export interface IBaseHalfMediaEditState {
	readonly kind: BaseHalfMediaKind;
	/** The version of the file when it was read: a write refuses a file that changed since. */
	readonly version: string;
	/** What a write encodes from: the original of an edited file, or the file. */
	readonly source: URI;
	/** The edit of an edited file, whose original is there and which the file is still the result of. */
	readonly record?: IBaseHalfEditRecord;
	/** The video of `source`, read. */
	readonly video?: IBaseHalfEditVideo;
	/** The image of `source`, read. */
	readonly image?: IBaseHalfEditImage;
	/** The sound of `source`, read. */
	readonly sound?: IBaseHalfSoundInfo;
	/** Why the file cannot be edited. */
	readonly unavailable?: string;
}

/** A copy of what an editor shows, which no write changes. */
export interface IBaseHalfMediaSourceCopy extends IDisposable {
	readonly resource: URI;
}

/** Where the writing of a file stands, as the line under its editor says it. */
export interface IBaseHalfMediaWriting {
	readonly state: 'writing' | 'failed';
	/** The share of a write done, from 0 to 1. */
	readonly done?: number;
	/** When the writes that run began, by `Date.now()`: the line says "Saving…" once they have run 1 s (D99). */
	readonly since?: number;
	/** Why the last write failed. */
	readonly failure?: string;
}

export interface IBaseHalfMediaEditService {
	readonly _serviceBrand: undefined;
	/** The choices of a file changed: by a change, an undo, a redo, or Revert to Original, or because they were dropped. */
	readonly onDidChangeChoices: Event<URI>;
	/** The writing of a file started, moved on, ended, or failed. */
	readonly onDidChangeWriting: Event<URI>;
	/** A write found the file changed outside BaseHalf, and dropped what was not written yet: Card Detail shows the file anew. */
	readonly onDidDropChoices: Event<URI>;
	/** What an editor of the file starts from, as the writes of this window leave it; never rejects. */
	readEditState(file: IBaseHalfWorkspaceResource): Promise<IBaseHalfMediaEditState>;
	/** Reads a video as an edit reads it; rejects with a `BaseHalfVideoFileError`. */
	readVideo(resource: URI): Promise<IBaseHalfEditVideo>;
	/**
	 * A copy of the source of a state in the cache folder, for its editor to
	 * read until it closes: a write replaces the file, and Revert to Original
	 * removes the original. Rejects when the file changed since the state.
	 */
	copySource(file: IBaseHalfWorkspaceResource, state: IBaseHalfMediaEditState): Promise<IBaseHalfMediaSourceCopy>;
	/** The choices that an editor of the file shows: those of this window's last change of it, or of its record. */
	choicesOf(file: URI, state: IBaseHalfMediaEditState): IBaseHalfMediaChoices;
	/** A change in an editor: one step of the canvas undo, named `label`, that the file follows once the choices rest. */
	change(file: IBaseHalfWorkspaceResource, state: IBaseHalfMediaEditState, choices: IBaseHalfMediaChoices, label: string): void;
	/** Revert to Original: one step that puts the original back in the file's place. */
	revertToOriginal(file: IBaseHalfWorkspaceResource, state: IBaseHalfMediaEditState): void;
	/** Where the writing of the file stands; nothing while no write runs or failed. */
	writing(file: URI): IBaseHalfMediaWriting | undefined;
	/** Whether the last write of the file left the sound out, as where the window has no encoder for it. */
	soundDropped(file: URI): boolean;
	/** Writes what waits for its rest now, and resolves when the file holds its choices or its write failed. */
	flush(file?: URI): Promise<void>;
	/** Flushes the files at or under these resources, as before they are moved, copied, or deleted. */
	flushBelow(resources: readonly URI[]): Promise<void>;
	/** Writes again after a failure. */
	retry(file: URI): void;
	/** Whether this version of the file is one this window wrote, or a write of it runs: Card Detail does not show it anew. */
	wrote(file: URI, version: string): boolean;
	/** Card Detail shows the file: a failure of its write is said there, not in a notification. */
	showFile(file: URI): IDisposable;
}

/** Why a write leaves the file as it was, in the words of the line under the editor. */
export class BaseHalfMediaEditError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BaseHalfMediaEditError';
	}
}

/** The file changed outside BaseHalf since the choices were made: they are dropped. */
class BaseHalfMediaChangedMeanwhile extends Error { }

/** How long the choices of a file rest before the file is written. */
const REST_MS = 1_000;
/** Changes of the same name to one file within this time are one step of undo. */
const MERGE_MS = 600;
/** How many writes of each file stay in the cache for undo and redo. */
const KEPT_WRITES = 8;
/** The first bytes of an image, which hold its size and its information in nearly every file. */
const IMAGE_HEADER_BYTES = 256 * 1024;
/** The largest sound file an edit reads: it is read whole. */
const SOUND_MAX_BYTES = 256 * 1024 * 1024;
/** A file in the cache folder of edits made this long ago is of a write that a closed window stopped, or kept by a window that is gone. */
const LEFTOVER_AGE_MS = 60 * 60 * 1000;
/** The copies that editors read, in the cache folder of edits. */
const COPIES_FOLDER = 'shown';
/** A copy that an editor reads made this long ago is of a window that is gone. */
const COPY_LEFTOVER_AGE_MS = 24 * 60 * 60 * 1000;

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

/** The version of a file that the state of an edit belongs to. */
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

/** How many bytes of a copy the shared process copies in one go, between two reports of the share done. */
const COPY_BATCH_BYTES = 128 * 1024 * 1024;

/** A copy of a trim (D99): the ranges of its source after its index, as the shared process writes them. */
interface IBaseHalfMediaCopy {
	readonly source: URI;
	readonly layout: IBaseHalfMp4CopyLayout;
}

/** What an edit makes: the bytes of the edited file, or the copy that the shared process writes. */
type BaseHalfMediaMade =
	| { readonly kind: 'bytes'; readonly bytes: Uint8Array; readonly soundDropped: boolean }
	| { readonly kind: 'copy'; readonly copy: IBaseHalfMediaCopy };

/** What was written, or is to be written, for a set of choices, kept in the cache folder. */
interface IWritten {
	readonly resource: URI;
	readonly result: IBaseHalfEditResult;
	readonly soundDropped: boolean;
}

/** The edit of a file that this window changed, and the writes that follow it. */
interface IEditEntry {
	readonly file: IBaseHalfWorkspaceResource;
	/** What the edit is made from, as the last write left it. */
	state: IBaseHalfMediaEditState;
	/** The choices that the file holds. */
	written: IBaseHalfMediaChoices;
	/** The choices that the editor shows: the file follows them. */
	desired: IBaseHalfMediaChoices;
	/** The version of the file as this window last wrote or read it. */
	version: string;
	/** The versions of the file that this window read or wrote. */
	readonly versions: Set<string>;
	/** The file changed outside BaseHalf: the edit is over, and its steps change nothing. */
	stale: boolean;
	timer?: ReturnType<typeof setTimeout>;
	/** The writes that run, until the file holds the choices; those of an edit before go first. */
	running?: Promise<void>;
	done?: number;
	/** When the writes that run began, by `Date.now()`. */
	since?: number;
	failure?: string;
	soundDropped: boolean;
	/** What was written for the last choices, by the choices, the latest last. */
	readonly writes: Map<string, IWritten>;
	/** The last step of undo, which a change of the same name within a moment joins. */
	last?: { readonly step: BaseHalfMediaEditStep; readonly at: number };
}

export class BaseHalfMediaEditService extends Disposable implements IBaseHalfMediaEditService {
	declare readonly _serviceBrand: undefined;

	private readonly onDidChangeChoicesEmitter = this._register(new Emitter<URI>());
	readonly onDidChangeChoices = this.onDidChangeChoicesEmitter.event;
	private readonly onDidChangeWritingEmitter = this._register(new Emitter<URI>());
	readonly onDidChangeWriting = this.onDidChangeWritingEmitter.event;
	private readonly onDidDropChoicesEmitter = this._register(new Emitter<URI>());
	readonly onDidDropChoices = this.onDidDropChoicesEmitter.event;

	private readonly entries = new ResourceMap<IEditEntry>();
	private readonly shown = new ResourceMap<number>();
	private readonly copies = new Set<string>();
	/** How long choices rest, and within what time changes of one name are one step: the tests shorten them. */
	private timings = { rest: REST_MS, merge: MERGE_MS };

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IBaseHalfFileClonesService private readonly fileClonesService: IBaseHalfFileClonesService,
		@IBaseHalfFileTimesService private readonly fileTimesService: IBaseHalfFileTimesService,
		@IBaseHalfWorkspaceMutationCoordinator private readonly workspaceMutationCoordinator: IBaseHalfWorkspaceMutationCoordinator,
		@IBaseHalfMovedItemsService private readonly movedItemsService: IBaseHalfMovedItemsService,
		@IUndoRedoService private readonly undoRedoService: IUndoRedoService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@INotificationService private readonly notificationService: INotificationService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		// A window that closes or reloads waits for its writes; what it kept for undo goes with it.
		this._register(lifecycleService.onWillShutdown(event => event.join(this.flush().then(() => this.clearCache()), {
			id: 'basehalf.mediaEdit',
			label: localize('basehalf.mediaEdit.shutdown', "Saving edits")
		})));
	}

	/** For tests: how long choices rest before a write, and the time within which changes of one name are one step. */
	setTimingsForTest(timings: { readonly rest: number; readonly merge: number }): void {
		this.timings = timings;
	}

	// #region Reading

	async readEditState(file: IBaseHalfWorkspaceResource): Promise<IBaseHalfMediaEditState> {
		const entry = this.entries.get(file.resource);
		if (entry) {
			// While this window's writes are what the file holds, an editor starts where they leave it.
			if (entry.running) {
				return entry.state;
			}
			const stat = await this.fileService.stat(file.resource).catch(() => undefined);
			if (stat && !entry.stale && (entry.running || baseHalfMediaVersion(stat) === entry.version)) {
				// A write may have started meanwhile.
				return entry.state;
			}
		}
		return this.readFromDisk(file);
	}

	private async readFromDisk(file: IBaseHalfWorkspaceResource): Promise<IBaseHalfMediaEditState> {
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

	/** The sound that the editor shows, or why it cannot. */
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

	/** The image that the editor shows, or why it cannot. */
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

	/** The video that the editor shows, or why it cannot. */
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

	async copySource(file: IBaseHalfWorkspaceResource, state: IBaseHalfMediaEditState): Promise<IBaseHalfMediaSourceCopy> {
		const folder = joinPath(await this.cacheFolder(file), COPIES_FOLDER);
		await this.fileService.createFolder(folder);
		const resource = joinPath(folder, `${generateUuid()}.${baseHalfMediaEditExtension(file.resource)}`);
		// Under the lease of writes, from where the source is then: the same bytes, wherever a write moved them.
		await this.workspaceMutationCoordinator.runExclusive(file.workspaceFolder, async () => {
			const entry = this.entryOf(file.resource, state);
			const stat = await this.fileService.stat(file.resource).catch(() => undefined);
			if (!stat || baseHalfMediaVersion(stat) !== (entry?.version ?? state.version)) {
				throw new BaseHalfMediaEditError(localize('basehalf.mediaEdit.copy.changed', "the file changed meanwhile."));
			}
			await this.fileClonesService.clone(entry?.state.source ?? state.source, resource);
		});
		this.copies.add(resource.toString());
		let disposed = false;
		return {
			resource,
			dispose: () => {
				if (!disposed) {
					disposed = true;
					this.copies.delete(resource.toString());
					void this.fileService.del(resource).catch(() => undefined);
				}
			}
		};
	}

	// #endregion

	// #region Changes and their steps

	/** The edit of a file that this window changed, while the state is of a version of the file that it read or wrote. */
	private entryOf(file: URI, state: IBaseHalfMediaEditState): IEditEntry | undefined {
		const entry = this.entries.get(file);
		return entry && !entry.stale && entry.versions.has(state.version) ? entry : undefined;
	}

	choicesOf(file: URI, state: IBaseHalfMediaEditState): IBaseHalfMediaChoices {
		return this.entryOf(file, state)?.desired ?? (state.record ? normalizeBaseHalfMediaChoices(state.record) : {});
	}

	change(file: IBaseHalfWorkspaceResource, state: IBaseHalfMediaEditState, choices: IBaseHalfMediaChoices, label: string): void {
		if (state.unavailable) {
			return;
		}
		const entry = this.entryFor(file, state);
		const next = normalizeBaseHalfMediaChoices(choices);
		if (sameChoices(next, entry.desired)) {
			return;
		}
		const now = Date.now();
		const last = entry.last;
		if (last && last.step.label === label && last.step.isDone && now - last.at < this.timings.merge) {
			// A key that repeats, or a tool used again at once, is one step.
			last.step.after = next;
			entry.last = { step: last.step, at: now };
		} else {
			const step = new BaseHalfMediaEditStep(label, entry, entry.desired, next, this);
			this.undoRedoService.pushElement(step, UndoRedoGroup.None, BASEHALF_CANVAS_UNDO_REDO_SOURCE);
			entry.last = { step, at: now };
		}
		this.setDesired(entry, next);
	}

	revertToOriginal(file: IBaseHalfWorkspaceResource, state: IBaseHalfMediaEditState): void {
		this.change(file, state, {}, localize('basehalf.mediaEdit.step.revert', "Revert {0} to Original", basename(file.resource)));
	}

	/** The undo or the redo of a step: the choices it puts back, or why it cannot, which it says. */
	async applyStep(entry: IEditEntry, choices: IBaseHalfMediaChoices): Promise<boolean> {
		const name = basename(entry.file.resource);
		const stat = await this.fileService.stat(entry.file.resource).catch(() => undefined);
		if (!stat) {
			this.notificationService.info(localize('basehalf.mediaEdit.step.gone', "'{0}' is not there any more.", name));
			return false;
		}
		if (entry.stale || this.entries.get(entry.file.resource) !== entry || (!entry.running && baseHalfMediaVersion(stat) !== entry.version)) {
			this.notificationService.info(localize('basehalf.mediaEdit.step.changed', "'{0}' changed meanwhile. Undo did not change it.", name));
			return false;
		}
		entry.last = undefined;
		this.setDesired(entry, choices);
		return true;
	}

	/** The edit of a file that this window changes: a new one when the file changed outside BaseHalf since. */
	private entryFor(file: IBaseHalfWorkspaceResource, state: IBaseHalfMediaEditState): IEditEntry {
		const known = this.entries.get(file.resource);
		if (known && !known.stale && known.versions.has(state.version)) {
			return known;
		}
		const before = known?.running;
		if (known) {
			// What this window did not write of the file before is dropped, and its steps change nothing.
			this.endEntry(known, false);
		}
		const written = state.record ? normalizeBaseHalfMediaChoices(state.record) : {};
		const entry: IEditEntry = {
			file, state, written, desired: written, version: state.version, versions: new Set([state.version]),
			stale: false, soundDropped: false, writes: new Map()
		};
		if (before) {
			// A file is written once at a time: a write of the edit before that runs goes first.
			entry.running = before.then(() => {
				if (entry.running) {
					entry.running = undefined;
					this.schedule(entry, 0);
				}
			});
		}
		this.entries.set(file.resource, entry);
		return entry;
	}

	private setDesired(entry: IEditEntry, choices: IBaseHalfMediaChoices): void {
		entry.desired = normalizeBaseHalfMediaChoices(choices);
		entry.failure = undefined;
		this.onDidChangeChoicesEmitter.fire(entry.file.resource);
		this.schedule(entry, this.timings.rest);
	}

	/** The file changed outside BaseHalf: what this window did not write of it is dropped, which a write that finds it tells. */
	private endEntry(entry: IEditEntry, tell: boolean): void {
		entry.stale = true;
		clearTimeout(entry.timer);
		entry.timer = undefined;
		if (this.entries.get(entry.file.resource) === entry) {
			this.entries.delete(entry.file.resource);
		}
		// What was written for it goes once no write of it runs: one that runs may read it.
		const writes = [...entry.writes.values()];
		entry.writes.clear();
		void Promise.resolve(entry.running).then(() => Promise.all(writes.map(written => this.fileService.del(written.resource).catch(() => undefined))));
		this.onDidChangeWritingEmitter.fire(entry.file.resource);
		if (tell) {
			this.onDidDropChoicesEmitter.fire(entry.file.resource);
		}
	}

	// #endregion

	// #region Writing

	writing(file: URI): IBaseHalfMediaWriting | undefined {
		const entry = this.entries.get(file);
		if (entry?.failure) {
			return { state: 'failed', failure: entry.failure };
		}
		return entry?.done !== undefined ? { state: 'writing', done: entry.done, since: entry.since } : undefined;
	}

	soundDropped(file: URI): boolean {
		return !!this.entries.get(file)?.soundDropped;
	}

	wrote(file: URI, version: string): boolean {
		const entry = this.entries.get(file);
		return !!entry && !entry.stale && (!!entry.running || entry.versions.has(version));
	}

	retry(file: URI): void {
		const entry = this.entries.get(file);
		if (entry?.failure) {
			entry.failure = undefined;
			this.schedule(entry, 0);
		}
	}

	async flush(file?: URI): Promise<void> {
		const entries = file ? [this.entries.get(file)].filter((entry): entry is IEditEntry => !!entry) : [...this.entries.values()];
		await Promise.all(entries.map(async entry => {
			// A write of the edit before goes first, and the writes of this one after it.
			for (; ;) {
				if (entry.timer !== undefined) {
					clearTimeout(entry.timer);
					entry.timer = undefined;
					this.start(entry);
				}
				if (!entry.running) {
					return;
				}
				await entry.running;
			}
		}));
	}

	async flushBelow(resources: readonly URI[]): Promise<void> {
		await Promise.all([...this.entries.keys()]
			.filter(file => resources.some(resource => isEqualOrParent(file, resource)))
			.map(file => this.flush(file)));
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

	/** Writes the file after the choices once they rested this long, unless writes run: they go on with them. */
	private schedule(entry: IEditEntry, delay: number): void {
		clearTimeout(entry.timer);
		entry.timer = undefined;
		if (!entry.running && !entry.stale && !entry.failure && !sameChoices(entry.desired, entry.written)) {
			entry.timer = setTimeout(() => {
				entry.timer = undefined;
				this.start(entry);
			}, delay);
		}
		this.onDidChangeWritingEmitter.fire(entry.file.resource);
	}

	/** Writes the file until it holds the choices the editor shows; a change during a write is written after it. */
	private start(entry: IEditEntry): void {
		if (entry.running || entry.stale) {
			return;
		}
		let running: Promise<void> | undefined = undefined;
		running = (async () => {
			// The writes begin once they are the entry's: the end below then knows them.
			await Promise.resolve();
			try {
				while (!entry.stale && !entry.failure && !sameChoices(entry.desired, entry.written)) {
					const target = entry.desired;
					try {
						await this.writeOnce(entry, target);
					} catch (error) {
						if (error instanceof BaseHalfMediaChangedMeanwhile) {
							this.logService.info(`[BaseHalf] ${entry.file.relativePath} changed outside BaseHalf; its edit that was not written yet is dropped`);
							this.endEntry(entry, true);
						} else {
							this.fail(entry, error);
						}
					}
				}
			} finally {
				entry.done = undefined;
				entry.since = undefined;
				if (entry.running === running) {
					entry.running = undefined;
				}
				this.onDidChangeWritingEmitter.fire(entry.file.resource);
			}
		})();
		entry.running = running;
		this.onDidChangeWritingEmitter.fire(entry.file.resource);
	}

	private fail(entry: IEditEntry, error: unknown): void {
		if (entry.stale) {
			// The file changed outside BaseHalf: what this write did is dropped, not a failure to tell.
			return;
		}
		const message = error instanceof Error ? error.message : String(error);
		if (!(error instanceof BaseHalfMediaEditError)) {
			this.logService.warn(`[BaseHalf] could not save the edit of ${entry.file.relativePath}`, error);
		}
		entry.failure = message;
		if (!this.shown.has(entry.file.resource)) {
			this.notificationService.prompt(Severity.Error, localize('basehalf.mediaEdit.save.failedNotification', "BaseHalf could not save the edit of {0}: {1}", basename(entry.file.resource), message), [{
				label: localize('basehalf.mediaEdit.save.tryAgain', "Try Again"),
				run: () => this.retry(entry.file.resource)
			}]);
		}
	}

	private progress(entry: IEditEntry, done: number): void {
		entry.since ??= Date.now();
		entry.done = done;
		this.onDidChangeWritingEmitter.fire(entry.file.resource);
	}

	/**
	 * One write of the file after `target`: the original's own bytes for
	 * choices that are no edit, or the edit of the original, from what was
	 * written for these choices when the cache keeps it. The first change
	 * keeps the file as it is as the original. A write that fails leaves the
	 * file, its original, and its record as they were.
	 */
	private async writeOnce(entry: IEditEntry, target: IBaseHalfMediaChoices): Promise<void> {
		const { file } = entry;
		const noEdit = baseHalfMediaChoicesAreNoEdit(target);
		if (noEdit && !entry.state.record) {
			// The file is its original already.
			entry.written = target;
			return;
		}
		this.progress(entry, 0);
		// A file that was never edited is its own source: one that changed is not encoded.
		await this.assertUnchanged(entry);
		let encoded: IWritten | undefined;
		try {
			encoded = noEdit ? undefined : await this.encoded(entry, target);
		} catch (error) {
			// What the encoder could not read may be what another program wrote meanwhile.
			await this.assertUnchanged(entry);
			throw error;
		}
		await this.workspaceMutationCoordinator.runExclusive(file.workspaceFolder, async () => {
			await this.assertUnchanged(entry);
			const folder = this.cardInformation(file);
			const record = joinPath(folder, BASEHALF_EDIT_RECORD_FILE);
			const original = joinPath(folder, baseHalfEditOriginalName(baseHalfMediaEditExtension(file.resource)));
			// The file as it is stays in the cache, as what was written for its choices: undo to them puts it back, and so does a write that fails.
			const before = await this.keepWritten(entry);
			if (!encoded) {
				await this.replaceFile(file, original);
				await this.fileService.del(original).catch(error => this.logService.warn(`[BaseHalf] could not remove the original of ${file.relativePath}`, error));
				await this.fileService.del(record).catch(error => this.logService.warn(`[BaseHalf] could not remove the edit record of ${file.relativePath}`, error));
				entry.state = withSource(this.fileService, entry.state, file.resource, undefined);
			} else {
				const first = !entry.state.record;
				if (first) {
					// The first change keeps the file as it is as the original.
					await this.letGoOfOldEdit(file, folder);
					await this.fileService.createFolder(folder);
					const copy = await this.cloneTemporary(file, file.resource);
					await this.fileService.move(copy, original, false, FileOperation.CREATE).catch(async error => {
						await this.fileService.del(copy).catch(() => undefined);
						throw error;
					});
				}
				const written: IBaseHalfEditRecord = { original: basename(original), result: encoded.result, ...target };
				try {
					await this.replaceFile(file, encoded.resource);
					try {
						await this.fileService.writeFile(record, VSBuffer.fromString(serializeBaseHalfEditRecord(written)));
					} catch (error) {
						// The file goes back as it was: without its record, the edit could not be reverted.
						await this.replaceFile(file, before?.resource ?? original);
						throw error;
					}
				} catch (error) {
					if (first) {
						await this.fileService.del(original).catch(() => undefined);
					}
					throw error;
				}
				entry.state = withSource(this.fileService, entry.state, original, written);
			}
			entry.soundDropped = !!encoded?.soundDropped;
			entry.version = baseHalfMediaVersion(await this.fileService.stat(file.resource));
			entry.versions.add(entry.version);
			entry.state = { ...entry.state, version: entry.version };
		});
		entry.written = target;
	}

	/** The file is the version that this window last wrote or read, or it changed outside BaseHalf. */
	private async assertUnchanged(entry: IEditEntry): Promise<void> {
		const stat = await this.fileService.stat(entry.file.resource).catch(() => undefined);
		if (!stat?.isFile || baseHalfMediaVersion(stat) !== entry.version) {
			throw new BaseHalfMediaChangedMeanwhile();
		}
	}

	/**
	 * Puts a copy of `source` in the file's place: the window is told one write
	 * of the file, and nothing of the moves that carry it out. The file as it
	 * was goes aside first, as kept versions do: a move over it would delete it
	 * first, which Files shows. The file takes the time of now, so that the
	 * watcher of macOS tells the change.
	 */
	private async replaceFile(file: IBaseHalfWorkspaceResource, source: URI): Promise<void> {
		const copy = await this.cloneTemporary(file, source);
		const aside = joinPath(await this.cacheFolder(file), `${generateUuid()}.${baseHalfMediaEditExtension(file.resource)}`);
		try {
			await this.fileService.move(file.resource, aside, false, 'nothing');
		} catch (error) {
			await this.fileService.del(copy).catch(() => undefined);
			throw error;
		}
		try {
			await this.fileService.move(copy, file.resource, false, FileOperation.WRITE);
		} catch (error) {
			await this.fileService.move(aside, file.resource, false, 'nothing').catch(rollbackError => this.logService.error(`[BaseHalf] could not put ${file.relativePath} back as it was`, rollbackError));
			await this.fileService.del(copy).catch(() => undefined);
			throw error;
		}
		await this.fileService.del(aside).catch(() => undefined);
		await this.fileTimesService.touch([file.resource]).catch(error => this.logService.warn(`[BaseHalf] could not give ${file.relativePath} the time of now`, error));
	}

	/**
	 * What was written for the choices the file holds, kept: the file as it is
	 * is cloned into the cache when the cache does not keep it, as after an
	 * edit of an earlier window. Nothing while the file is its original.
	 */
	private async keepWritten(entry: IEditEntry): Promise<IWritten | undefined> {
		const record = entry.state.record;
		if (!record) {
			return undefined;
		}
		const key = choicesKey(entry.written);
		const kept = entry.writes.get(key);
		if (kept && await this.fileService.exists(kept.resource)) {
			return kept;
		}
		const written: IWritten = { resource: await this.cloneTemporary(entry.file, entry.file.resource), result: record.result, soundDropped: entry.soundDropped };
		this.keep(entry, key, written);
		return written;
	}

	/** What is written for the choices: kept from a write before, or encoded from the original and kept. */
	private async encoded(entry: IEditEntry, choices: IBaseHalfMediaChoices): Promise<IWritten> {
		const key = choicesKey(choices);
		const kept = entry.writes.get(key);
		if (kept && await this.fileService.exists(kept.resource)) {
			this.keep(entry, key, kept);
			return kept;
		}
		const made = await this.encode(entry, choices);
		const resource = joinPath(await this.cacheFolder(entry.file), `${generateUuid()}.${baseHalfMediaEditExtension(entry.file.resource)}`);
		let written: IWritten;
		if (made.kind === 'copy') {
			written = { resource, result: await this.writeCopy(entry, resource, made.copy), soundDropped: false };
		} else {
			await this.fileService.createFile(resource, VSBuffer.wrap(made.bytes), { overwrite: false });
			written = { resource, result: await baseHalfEditResultOf(made.bytes), soundDropped: made.soundDropped };
		}
		this.keep(entry, key, written);
		return written;
	}

	/**
	 * Writes a copy into the cache (editing media, "While it is saved, and
	 * after", D99): its index, then the ranges of its source, which the shared
	 * process copies a batch at a time, so that the line under the editor can
	 * say the share done; then its fingerprint, read back.
	 */
	private async writeCopy(entry: IEditEntry, resource: URI, copy: IBaseHalfMediaCopy): Promise<IBaseHalfEditResult> {
		const { layout, source } = copy;
		let parts: BaseHalfFilePart[] = [VSBuffer.wrap(layout.head)];
		let batch = layout.head.length;
		let written = 0;
		let append = false;
		const send = async () => {
			await this.fileClonesService.assemble(resource, parts, append);
			append = true;
			written += batch;
			parts = [];
			batch = 0;
			this.progress(entry, written / layout.size);
		};
		try {
			for (const range of layout.ranges) {
				let offset = range.offset;
				let left = range.length;
				while (left > 0) {
					const length = Math.min(left, COPY_BATCH_BYTES - batch);
					parts.push({ source, offset, length });
					batch += length;
					offset += length;
					left -= length;
					if (batch >= COPY_BATCH_BYTES) {
						await send();
					}
				}
			}
			if (parts.length) {
				await send();
			}
			const size = (await this.fileService.stat(resource)).size;
			if (size !== layout.size) {
				throw new Error(`The copy of ${source.toString()} holds ${size} bytes, not ${layout.size}.`);
			}
		} catch (error) {
			await this.fileService.del(resource).catch(() => undefined);
			throw error;
		}
		const fingerprint = await baseHalfComputeFileFingerprint({
			size: layout.size,
			read: (position, length) => readBaseHalfFileRange(this.fileService, resource, position, length)
		}, false);
		if (!fingerprint) {
			throw new BaseHalfMediaEditError(localize('basehalf.mediaEdit.save.empty', "the edited file would be empty."));
		}
		return { size: fingerprint.size, hash: fingerprint.hash };
	}

	/** Keeps what was written for choices as the latest, and lets go of the oldest beyond the last few. */
	private keep(entry: IEditEntry, key: string, written: IWritten): void {
		entry.writes.delete(key);
		entry.writes.set(key, written);
		for (const [oldest, kept] of entry.writes) {
			if (entry.writes.size <= KEPT_WRITES) {
				break;
			}
			entry.writes.delete(oldest);
			void this.fileService.del(kept.resource).catch(() => undefined);
		}
	}

	/** Makes the edit of the state's source: its bytes, or the copy that the shared process writes. */
	private encode(entry: IEditEntry, choices: IBaseHalfMediaChoices): Promise<BaseHalfMediaMade> {
		const state = entry.state;
		const progress = (done: number) => this.progress(entry, done);
		switch (state.kind) {
			case 'video': return this.encodeVideo(state, choices, progress);
			case 'image': return this.encodeImage(state, choices, progress);
			case 'sound': return this.encodeSound(state, choices, progress);
		}
	}

	/** Keeps the parts of a sound, joined, in its format: one part of an M4A is copied (D99). */
	private async encodeSound(state: IBaseHalfMediaEditState, choices: IBaseHalfMediaChoices, progress: (done: number) => void): Promise<BaseHalfMediaMade> {
		const info = state.sound;
		if (!info) {
			throw new BaseHalfMediaEditError(localize('basehalf.mediaEdit.save.noSound', "the sound could not be read."));
		}
		const parts = choices.keep ?? [{ start: 0, end: info.duration }];
		if (info.format === 'm4a' && parts.length === 1) {
			const copy = await this.copyOfSound(state.source, parts[0]);
			if (copy) {
				return { kind: 'copy', copy };
			}
		}
		const bytes = (await this.fileService.readFile(state.source)).value.buffer;
		progress(0.3);
		try {
			const encoded = await encodeBaseHalfSoundParts(bytes, info, parts);
			progress(0.9);
			return { kind: 'bytes', bytes: encoded, soundDropped: false };
		} catch (error) {
			throw error instanceof BaseHalfSoundEditError ? new BaseHalfMediaEditError(error.message) : error;
		}
	}

	/**
	 * The copy of one part of an M4A's sound; nothing for one whose packets
	 * cannot be copied, which is encoded again. The editor's times count from
	 * where the sound is first shown.
	 */
	private async copyOfSound(source: URI, part: IBaseHalfMediaPart): Promise<IBaseHalfMediaCopy | undefined> {
		const size = (await this.fileService.stat(source)).size;
		const file = await readBaseHalfIsoBmffFile(baseHalfMediaFileByteSource(this.fileService, source, size), 'mp4', { soundOnly: true });
		if (file.video || !file.audio || !baseHalfCanCopyVideo(file)) {
			return undefined;
		}
		const soundStart = baseHalfSoundShown(file.audio).start;
		const plan = planBaseHalfMp4Copy(file, { start: soundStart + part.start, end: soundStart + part.end });
		return { source, layout: writeBaseHalfMp4Copy(plan) };
	}

	/** Crops, turns, flips, and straightens an image, in its format, with its information. */
	private async encodeImage(state: IBaseHalfMediaEditState, choices: IBaseHalfMediaChoices, progress: (done: number) => void): Promise<BaseHalfMediaMade> {
		const bytes = (await this.fileService.readFile(state.source)).value.buffer;
		const info = readBaseHalfImageInfo(bytes);
		if (!info) {
			throw new BaseHalfMediaEditError(localize('basehalf.mediaEdit.save.formatImage', "the image could not be read as PNG, JPEG, or WebP."));
		}
		progress(0.3);
		try {
			const encoding = await encodeBaseHalfImageCrop(bytes, info, choices);
			progress(0.9);
			return { kind: 'bytes', bytes: encoding.bytes, soundDropped: false };
		} catch (error) {
			throw error instanceof BaseHalfImageCropError ? new BaseHalfMediaEditError(error.message) : error;
		}
	}

	/**
	 * Trims a video (D99): an MP4 or a MOV by copying its frames; a WebM by
	 * copying its frames from the first key frame at or after the start and
	 * encoding those before it; a WebM that the window cannot encode in its own
	 * codec by encoding it whole.
	 */
	private async encodeVideo(state: IBaseHalfMediaEditState, choices: IBaseHalfMediaChoices, progress: (done: number) => void): Promise<BaseHalfMediaMade> {
		const video = state.video ?? await this.readVideo(state.source);
		const picture = video.file.video;
		if (!picture) {
			throw new BaseHalfMediaEditError(localize('basehalf.mediaEdit.save.noPicture', "the video has no picture."));
		}
		// The parts of a record are to the millisecond: the frames kept are those between the frame edges nearest to them.
		const timeline = new BaseHalfVideoTrimTimeline(baseHalfVideoFrameEdges(picture));
		const range = timeline.normalize(choices.keep?.[0]);
		if (baseHalfCanCopyVideo(video.file)) {
			return { kind: 'copy', copy: { source: state.source, layout: writeBaseHalfMp4Copy(planBaseHalfMp4Copy(video.file, range)) } };
		}
		let lastReport = 0;
		const onProgress = (done: number) => {
			// A few steps a second are enough for the line under the editor.
			const now = Date.now();
			if (now - lastReport > 100 || done >= 1) {
				lastReport = now;
				progress(done * 0.95);
			}
		};
		try {
			const encoding = baseHalfCanCopyWebm(video.file)
				? await encodeBaseHalfWebmCopy({ source: video.source, file: video.file, plan: planBaseHalfWebmCopy(video.file, range), onProgress })
				: await encodeBaseHalfVideoClip({ source: video.source, file: video.file, plan: planBaseHalfVideoClip(video.file, baseHalfMediaEditExtension(state.source), range), onProgress });
			return { kind: 'bytes', bytes: encoding.bytes, soundDropped: encoding.soundDropped };
		} catch (error) {
			throw error instanceof BaseHalfVideoClipError ? new BaseHalfMediaEditError(error.message) : error;
		}
	}

	/**
	 * Before a first change, what the card information holds of an edit is of
	 * no version of the file that the change makes (editing media, "A file that
	 * changed outside BaseHalf"): an original, also one of another extension
	 * that a renamed file left, goes to the Trash beside the file, and a record
	 * that cannot be read is kept as a recovery copy.
	 */
	private async letGoOfOldEdit(file: IBaseHalfWorkspaceResource, folder: URI): Promise<void> {
		const listing = await this.fileService.resolve(folder).catch(() => undefined);
		const trash = this.configurationService.getValue<boolean>('files.enableTrash') !== false && this.fileService.hasCapability(file.workspaceFolder, FileSystemProviderCapabilities.Trash);
		for (const child of listing?.children ?? []) {
			if (child.isFile && baseHalfIsEditOriginalName(child.name)) {
				await baseHalfReleaseEditOriginal({
					fileService: this.fileService,
					trash,
					acceptWorkbenchDelete: (workspaceFolder, path) => this.movedItemsService.acceptWorkbenchDelete(workspaceFolder, path)
				}, file.workspaceFolder, file.relativePath, child.resource);
			} else if (child.isFile && child.name === BASEHALF_EDIT_RECORD_FILE) {
				const bytes = (await this.fileService.readFile(child.resource)).value;
				if (!parseBaseHalfEditRecord(bytes.toString())) {
					await baseHalfPreserveMirrorBytes(this.fileService, file.workspaceFolder, child.resource, bytes);
				}
			}
		}
	}

	/** The cache folder of edits, made ready, with what writes that a closed window stopped left in it deleted. */
	private async cacheFolder(file: IBaseHalfWorkspaceResource): Promise<URI> {
		await baseHalfEnsureMirrorIgnoreFile(this.fileService, file.workspaceFolder);
		const folder = joinPath(file.workspaceFolder, '.bh', 'cache', 'edit');
		const listing = await this.fileService.resolve(folder, { resolveMetadata: true }).catch(() => undefined);
		const now = Date.now();
		const kept = new Set([...this.entries.values()].flatMap(entry => [...entry.writes.values()].map(written => written.resource.toString())));
		for (const child of listing?.children ?? []) {
			// A write that runs made its files a moment ago; `ctime` is when a file was made, also a clone.
			if (child.isFile && now - child.ctime > LEFTOVER_AGE_MS && !kept.has(child.resource.toString())) {
				await this.fileService.del(child.resource).catch(error => this.logService.warn(`[BaseHalf] could not delete what an edit left: ${child.resource.toString()}`, error));
			}
		}
		const copies = await this.fileService.resolve(joinPath(folder, COPIES_FOLDER), { resolveMetadata: true }).catch(() => undefined);
		for (const child of copies?.children ?? []) {
			if (child.isFile && now - child.ctime > COPY_LEFTOVER_AGE_MS && !this.copies.has(child.resource.toString())) {
				await this.fileService.del(child.resource).catch(() => undefined);
			}
		}
		await this.fileService.createFolder(folder);
		return folder;
	}

	/** Clones a file into the cache folder: a clone takes no room on a disk that can make one. */
	private async cloneTemporary(file: IBaseHalfWorkspaceResource, source: URI): Promise<URI> {
		const temporary = joinPath(await this.cacheFolder(file), `${generateUuid()}.${baseHalfMediaEditExtension(file.resource)}`);
		await this.fileClonesService.clone(source, temporary);
		return temporary;
	}

	/** What this window kept for undo, and the copies its editors read, go with it. */
	private async clearCache(): Promise<void> {
		const resources = [...this.entries.values()].flatMap(entry => [...entry.writes.values()].map(written => written.resource));
		for (const entry of this.entries.values()) {
			entry.writes.clear();
		}
		resources.push(...[...this.copies].map(copy => URI.parse(copy)));
		this.copies.clear();
		await Promise.all(resources.map(resource => this.fileService.del(resource).catch(() => undefined)));
	}

	// #endregion
}

/** One change of an edit, a step of the canvas undo: undo puts back the choices before it, and redo those after it. */
class BaseHalfMediaEditStep implements IWorkspaceUndoRedoElement {
	readonly type = UndoRedoElementType.Workspace;
	readonly code = 'basehalf.mediaEdit';
	/** A resource of the step's own: the step stands in the canvas undo, by its source. */
	readonly resources: readonly URI[] = [URI.from({ scheme: 'basehalf-media-edit', path: `/${generateUuid()}` })];
	private state: 'done' | 'undone' | 'over' = 'done';

	constructor(
		readonly label: string,
		private readonly entry: IEditEntry,
		private readonly before: IBaseHalfMediaChoices,
		/** A change of the same name a moment later joins this step. */
		public after: IBaseHalfMediaChoices,
		private readonly service: BaseHalfMediaEditService
	) { }

	get isDone(): boolean {
		return this.state === 'done';
	}

	async undo(): Promise<void> {
		if (this.state === 'done') {
			this.state = await this.service.applyStep(this.entry, this.before) ? 'undone' : 'over';
		}
	}

	async redo(): Promise<void> {
		if (this.state === 'undone') {
			this.state = await this.service.applyStep(this.entry, this.after) ? 'done' : 'over';
		}
	}
}

/** The state of an edit with another source: the original, or the file. */
function withSource(fileService: IFileService, state: IBaseHalfMediaEditState, source: URI, record: IBaseHalfEditRecord | undefined): IBaseHalfMediaEditState {
	const { record: _record, ...rest } = state;
	return {
		...rest,
		source,
		...(record ? { record } : {}),
		// The index of the video is that of the same bytes; they are read from where they are now.
		...(state.video ? { video: { file: state.video.file, source: baseHalfMediaFileByteSource(fileService, source, state.video.source.size) } } : {})
	};
}

/** The choices as a record holds them, as text, by which what was written for them is kept. */
function choicesKey(choices: IBaseHalfMediaChoices): string {
	return JSON.stringify(normalizeBaseHalfMediaChoices(choices));
}

function sameChoices(a: IBaseHalfMediaChoices, b: IBaseHalfMediaChoices): boolean {
	return choicesKey(a) === choicesKey(b);
}
