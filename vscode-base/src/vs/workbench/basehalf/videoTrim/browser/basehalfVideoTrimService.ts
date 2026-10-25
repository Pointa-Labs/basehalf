/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { basename, extname, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IBaseHalfWorkspaceResource } from '../../navigation/common/basehalfCanvasNavigation.js';
import { BASEHALF_GENERATION_MADE_FILE, baseHalfGenerationMadeTrimmed, parseBaseHalfGenerationMade, serializeBaseHalfGenerationMade } from '../../video/common/basehalfGenerationInfo.js';
import { IBaseHalfFileReplacement, IBaseHalfKeptVersionsService } from '../../workspace/browser/basehalfKeptVersions.js';
import { baseHalfIsWorkspaceFolderMarked } from '../../workspace/common/basehalfLegacyCleanup.js';
import { baseHalfEnsureMirrorIgnoreFile } from '../../workspace/common/basehalfMirrorIgnore.js';
import { baseHalfMirrorResource } from '../../workspace/common/basehalfMirrorTree.js';
import { readBaseHalfIsoBmffFile } from '../common/basehalfIsoBmffReader.js';
import { planBaseHalfVideoClip } from '../common/basehalfVideoClipPlan.js';
import { BaseHalfVideoFileError, IBaseHalfVideoByteSource, IBaseHalfVideoFile } from '../common/basehalfVideoFile.js';
import { formatBaseHalfVideoTrimLength, IBaseHalfVideoTrimRange } from '../common/basehalfVideoTrimSelection.js';
import { readBaseHalfWebmFile } from '../common/basehalfWebmReader.js';
import { encodeBaseHalfVideoClip } from './basehalfVideoClipEncoder.js';

/**
 * Trims videos (trimming a video, "Trimming"): reads the video, encodes the
 * selection, writes it into the workspace's cache folder, and puts it in the
 * video's place, with the record of a generated video, in one step of the
 * canvas undo (D82). A trim goes on when Card Detail closes; its end is a
 * notification when no trim bar shows the video. It also keeps each video's
 * selection while the window is open.
 */

export const IBaseHalfVideoTrimService = createDecorator<IBaseHalfVideoTrimService>('baseHalfVideoTrimService');

export interface IBaseHalfVideoTrimProgress {
	readonly video: URI;
	readonly range: IBaseHalfVideoTrimRange;
	/** From 0 to 1. */
	readonly done: number;
}

export interface IBaseHalfVideoTrimmed {
	/** The part of the video before that it holds now. */
	readonly range: IBaseHalfVideoTrimRange;
	/** The video's sound could not be decoded or encoded: it has none now. */
	readonly soundDropped: boolean;
	/** The version of the trimmed file. */
	readonly version: string;
}

export interface IBaseHalfVideoTrimService {
	readonly _serviceBrand: undefined;
	/** A trim of the video started, moved on, or ended. */
	readonly onDidChangeTrim: Event<URI>;
	/** Reads the video as a trim reads it, with the source of its bytes; rejects with a `BaseHalfVideoFileError`. */
	readVideo(resource: URI): Promise<{ readonly file: IBaseHalfVideoFile; readonly source: IBaseHalfVideoByteSource }>;
	/** The trim of the video that runs. */
	runningTrim(video: URI): IBaseHalfVideoTrimProgress | undefined;
	/** Replaces the video with its selection, in one step of the canvas undo. */
	trimVideo(video: IBaseHalfWorkspaceResource, range: IBaseHalfVideoTrimRange): Promise<IBaseHalfVideoTrimmed>;
	/** The trim that made this version of the video's file, while the window is open. */
	lastTrim(video: URI, version: string): IBaseHalfVideoTrimmed | undefined;
	/** A trim bar shows the video: the end of its trim is shown there, not in a notification. */
	showVideo(video: URI): IDisposable;
	/** The selection kept for the video at this version of its file. */
	keptSelection(video: URI, version: string): IBaseHalfVideoTrimRange | undefined;
	keepSelection(video: URI, version: string, range: IBaseHalfVideoTrimRange): void;
}

/** Why a trim ends with the video as it was, in the words of the status line. */
export class BaseHalfVideoTrimError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BaseHalfVideoTrimError';
	}
}

/** How many videos the window keeps a selection and a trim for. */
const MAX_KEPT_VIDEOS = 100;
/** A file in the cache folder of trims this old was left by a trim that a closed window stopped. */
const LEFTOVER_AGE_MS = 60 * 60 * 1000;

/** Keeps the value of a video, and those of the last videos before it. */
function keepLast<T>(map: ResourceMap<T>, video: URI, value: T): void {
	map.delete(video);
	map.set(video, value);
	for (const key of map.keys()) {
		if (map.size <= MAX_KEPT_VIDEOS) {
			break;
		}
		map.delete(key);
	}
}

/** The bytes of a file, read a part at a time. */
export function baseHalfVideoFileByteSource(fileService: IFileService, resource: URI, size: number): IBaseHalfVideoByteSource {
	return {
		size,
		async read(offset: number, length: number): Promise<Uint8Array> {
			const clamped = Math.max(0, Math.min(length, size - offset));
			if (clamped === 0) {
				return new Uint8Array(0);
			}
			const content = await fileService.readFile(resource, { position: offset, length: clamped });
			return content.value.buffer;
		}
	};
}

/** The version of a video's file that a kept selection and a trim belong to. */
export function baseHalfVideoVersion(stat: { readonly mtime?: number; readonly size?: number }): string {
	return `${stat.mtime ?? 0}-${stat.size ?? 0}`;
}

export class BaseHalfVideoTrimService extends Disposable implements IBaseHalfVideoTrimService {
	declare readonly _serviceBrand: undefined;

	private readonly onDidChangeTrimEmitter = this._register(new Emitter<URI>());
	readonly onDidChangeTrim = this.onDidChangeTrimEmitter.event;

	private readonly trims = new ResourceMap<IBaseHalfVideoTrimProgress>();
	private readonly trimmed = new ResourceMap<IBaseHalfVideoTrimmed>();
	private readonly shown = new ResourceMap<number>();
	private readonly selections = new ResourceMap<{ readonly version: string; readonly range: IBaseHalfVideoTrimRange }>();

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IBaseHalfKeptVersionsService private readonly keptVersionsService: IBaseHalfKeptVersionsService,
		@INotificationService private readonly notificationService: INotificationService,
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	async readVideo(resource: URI): Promise<{ readonly file: IBaseHalfVideoFile; readonly source: IBaseHalfVideoByteSource }> {
		let size: number;
		try {
			size = (await this.fileService.stat(resource)).size;
		} catch {
			throw new BaseHalfVideoFileError('read');
		}
		const source = baseHalfVideoFileByteSource(this.fileService, resource, size);
		const extension = extname(resource).slice(1).toLowerCase();
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

	runningTrim(video: URI): IBaseHalfVideoTrimProgress | undefined {
		return this.trims.get(video);
	}

	lastTrim(video: URI, version: string): IBaseHalfVideoTrimmed | undefined {
		const trimmed = this.trimmed.get(video);
		return trimmed?.version === version ? trimmed : undefined;
	}

	showVideo(video: URI): IDisposable {
		this.shown.set(video, (this.shown.get(video) ?? 0) + 1);
		return toDisposable(() => {
			const count = (this.shown.get(video) ?? 1) - 1;
			if (count > 0) {
				this.shown.set(video, count);
			} else {
				this.shown.delete(video);
			}
		});
	}

	keptSelection(video: URI, version: string): IBaseHalfVideoTrimRange | undefined {
		const kept = this.selections.get(video);
		return kept?.version === version ? kept.range : undefined;
	}

	keepSelection(video: URI, version: string, range: IBaseHalfVideoTrimRange): void {
		keepLast(this.selections, video, { version, range });
	}

	async trimVideo(video: IBaseHalfWorkspaceResource, range: IBaseHalfVideoTrimRange): Promise<IBaseHalfVideoTrimmed> {
		if (this.trims.has(video.resource)) {
			throw new BaseHalfVideoTrimError(localize('basehalf.videoTrim.trim.running', "the video is being trimmed."));
		}
		this.setProgress(video.resource, range, 0);
		try {
			const trimmed = await this.doTrimVideo(video, range);
			keepLast(this.trimmed, video.resource, trimmed);
			this.endTrim(video.resource);
			if (!this.shown.has(video.resource)) {
				this.notificationService.info(localize('basehalf.videoTrim.trim.trimmedNotification', "Trimmed {0} to {1}.", basename(video.resource), formatBaseHalfVideoTrimLength(range.end - range.start)));
			}
			return trimmed;
		} catch (error) {
			this.endTrim(video.resource);
			const message = error instanceof Error ? error.message : String(error);
			if (!this.shown.has(video.resource)) {
				this.notificationService.error(localize('basehalf.videoTrim.trim.failedNotification', "BaseHalf could not trim {0}: {1}", basename(video.resource), message));
			}
			throw error instanceof BaseHalfVideoTrimError ? error : new BaseHalfVideoTrimError(message);
		}
	}

	private setProgress(video: URI, range: IBaseHalfVideoTrimRange, done: number): void {
		this.trims.set(video, { video, range, done });
		this.onDidChangeTrimEmitter.fire(video);
	}

	private endTrim(video: URI): void {
		this.trims.delete(video);
		this.onDidChangeTrimEmitter.fire(video);
	}

	private async doTrimVideo(video: IBaseHalfWorkspaceResource, range: IBaseHalfVideoTrimRange): Promise<IBaseHalfVideoTrimmed> {
		const changed = () => new BaseHalfVideoTrimError(localize('basehalf.videoTrim.trim.changed', "the video changed while it was being trimmed."));
		const before = await this.fileService.stat(video.resource).catch(() => undefined);
		if (!before) {
			throw changed();
		}
		const { file, source } = await this.readVideo(video.resource);
		const plan = planBaseHalfVideoClip(file, extname(video.resource).slice(1), range);
		let lastReport = 0;
		const encoding = await encodeBaseHalfVideoClip({
			source,
			file,
			plan,
			onProgress: done => {
				// A few steps a second are enough for the status line.
				const now = Date.now();
				if (now - lastReport > 100 || done >= 1) {
					lastReport = now;
					this.setProgress(video.resource, range, done);
				}
			}
		});

		const after = await this.fileService.stat(video.resource).catch(() => undefined);
		if (!after || after.size !== before.size || after.mtime !== before.mtime) {
			throw changed();
		}
		const changes: IBaseHalfFileReplacement[] = [];
		const record = await this.trimmedRecord(video, range);
		let temporary: URI | undefined;
		try {
			if (await baseHalfIsWorkspaceFolderMarked(this.fileService, video.workspaceFolder)) {
				changes.push({ resource: video.resource, contents: VSBuffer.wrap(encoding.bytes) });
			} else {
				// The trimmed video is written whole beside the workspace's files, then moved into the video's place.
				await baseHalfEnsureMirrorIgnoreFile(this.fileService, video.workspaceFolder);
				const folder = joinPath(video.workspaceFolder, '.bh', 'cache', 'trim');
				await this.deleteLeftovers(folder);
				temporary = joinPath(folder, `${generateUuid()}${extname(video.resource)}`);
				await this.fileService.createFile(temporary, VSBuffer.wrap(encoding.bytes), { overwrite: true });
				changes.push({ resource: video.resource, contents: temporary });
			}
			if (record) {
				changes.push(record);
			}
			await this.keptVersionsService.replaceFiles(changes, { label: localize('basehalf.videoTrim.trim.step', "Trim {0}", basename(video.resource)) });
			temporary = undefined;
		} finally {
			if (temporary) {
				await this.fileService.del(temporary).catch(() => undefined);
			}
		}
		const stat = await this.fileService.stat(video.resource);
		return { range, soundDropped: encoding.soundDropped, version: baseHalfVideoVersion(stat) };
	}

	/** Deletes what trims that a closed window stopped left in the cache folder: nothing that runs is this old. */
	private async deleteLeftovers(folder: URI): Promise<void> {
		const listing = await this.fileService.resolve(folder, { resolveMetadata: true }).catch(() => undefined);
		const now = Date.now();
		for (const child of listing?.children ?? []) {
			if (child.isFile && now - child.mtime > LEFTOVER_AGE_MS) {
				await this.fileService.del(child.resource).catch(error => this.logService.warn(`[BaseHalf] could not delete what a trim left: ${child.resource.toString()}`, error));
			}
		}
	}

	/** The record of a generated video with the part it holds after the trim; none for a video without a record that can be read. */
	private async trimmedRecord(video: IBaseHalfWorkspaceResource, range: IBaseHalfVideoTrimRange): Promise<IBaseHalfFileReplacement | undefined> {
		const resource = baseHalfMirrorResource(video.workspaceFolder, video.relativePath, BASEHALF_GENERATION_MADE_FILE);
		let text: string;
		try {
			text = (await this.fileService.readFile(resource)).value.toString();
		} catch {
			return undefined;
		}
		const made = parseBaseHalfGenerationMade(text);
		if (!made) {
			// A record that cannot be read is left as it is (generation cards, "`made.yaml`").
			this.logService.info(`[BaseHalf] the record of ${video.relativePath} cannot be read; the video is trimmed without it`);
			return undefined;
		}
		return { resource, contents: VSBuffer.fromString(serializeBaseHalfGenerationMade(baseHalfGenerationMadeTrimmed(made, range.start, range.end))) };
	}
}
