/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { Schemas } from '../../../../base/common/network.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { relativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { BASEHALF_CLIPBOARD_RECORD_TYPE, IBaseHalfPasteboardService } from '../../../../platform/basehalfClipboard/common/basehalfPasteboard.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { baseHalfPathHoldsDraft } from '../../video/common/basehalfGenerationDraft.js';
import { baseHalfGenerationKindOfPath } from '../../video/common/basehalfGenerationInfo.js';
import { BaseHalfTransfer, IBaseHalfClipboardService, IBaseHalfTransferItem, baseHalfClipboardRecord, parseBaseHalfClipboardFileNames, parseBaseHalfClipboardRecord } from '../common/basehalfClipboard.js';

/** The list of the files that the clipboard holds as files, in the form the system gives for all of them at once. */
const FILE_NAMES_TYPE = 'NSFilenamesPboardType';

/** Picture data that is read as it is, in this order; any other picture is read as PNG. */
const PICTURE_TYPES: readonly { readonly type: string; readonly extension: string }[] = [
	{ type: 'public.png', extension: 'png' },
	{ type: 'public.jpeg', extension: 'jpg' }
];

export class BaseHalfClipboardService implements IBaseHalfClipboardService {
	declare readonly _serviceBrand: undefined;

	/** The write that is under way: a read waits for it, so that it reads what was copied. */
	private writing: Promise<void> = Promise.resolve();

	constructor(
		@INativeHostService private readonly nativeHostService: INativeHostService,
		@IBaseHalfPasteboardService private readonly pasteboardService: IBaseHalfPasteboardService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService
	) { }

	writeItems(resources: readonly URI[], cut: boolean): Promise<void> {
		if (resources.length === 0) {
			return this.writing;
		}
		const write = async () => {
			const items = await Promise.all(resources.map(async resource => await this.isDraft(resource) ? { resource, draft: true as const } : { resource }));
			const record = baseHalfClipboardRecord(items, cut);
			const files = items.filter(item => !item.draft && item.resource.scheme === Schemas.file).map(item => item.resource.fsPath);
			const text = items.map(item => this.pathOf(item.resource)).join('\n');
			try {
				if (await this.pasteboardService.write({ files, text, record })) {
					return;
				}
			} catch (error) {
				this.logService.warn('[BaseHalf] the clipboard could not be written with files and text; it holds the record only', error);
			}
			// Where the system has no write of several forms, BaseHalf still reads its own.
			await this.nativeHostService.writeClipboardBuffer(BASEHALF_CLIPBOARD_RECORD_TYPE, VSBuffer.fromString(record));
		};
		const written = this.writing.then(write, write);
		this.writing = written.catch(() => undefined);
		return written;
	}

	async read(): Promise<BaseHalfTransfer | undefined> {
		const items = await this.readItems();
		if (items) {
			return { kind: 'items', ...items };
		}
		if (isMacintosh) {
			for (const { type, extension } of PICTURE_TYPES) {
				const data = await this.nativeHostService.readClipboardBuffer(type);
				if (data.byteLength > 0) {
					return { kind: 'picture', data, extension };
				}
			}
		}
		const image = await this.nativeHostService.readImage();
		if (image.byteLength > 0) {
			return { kind: 'picture', data: VSBuffer.wrap(image), extension: 'png' };
		}
		const text = await this.nativeHostService.readClipboardText();
		return text.length > 0 ? { kind: 'text', text } : undefined;
	}

	async readItems(): Promise<{ readonly items: readonly IBaseHalfTransferItem[]; readonly cut: boolean } | undefined> {
		await this.writing;
		const record = parseBaseHalfClipboardRecord((await this.nativeHostService.readClipboardBuffer(BASEHALF_CLIPBOARD_RECORD_TYPE)).toString());
		if (record) {
			return record;
		}
		if (!isMacintosh) {
			return undefined;
		}
		const paths = parseBaseHalfClipboardFileNames((await this.nativeHostService.readClipboardBuffer(FILE_NAMES_TYPE)).toString());
		return paths.length > 0 ? { items: paths.map(path => ({ resource: URI.file(path) })), cut: false } : undefined;
	}

	/** Whether a path that holds no file holds a draft (generation cards, "Drafts and missing files"). */
	private async isDraft(resource: URI): Promise<boolean> {
		const folder = this.workspaceContextService.getWorkspaceFolder(resource);
		const path = folder ? relativePath(folder.uri, resource) : undefined;
		if (!folder || !path || baseHalfGenerationKindOfPath(path) === undefined || await this.fileService.exists(resource)) {
			return false;
		}
		return baseHalfPathHoldsDraft(this.fileService, folder.uri, path);
	}

	/** The path of an item relative to its workspace folder, or on disk when it is in none. */
	private pathOf(resource: URI): string {
		const folder = this.workspaceContextService.getWorkspaceFolder(resource);
		const path = folder ? relativePath(folder.uri, resource) : undefined;
		return path || (resource.scheme === Schemas.file ? resource.fsPath : resource.toString());
	}
}

registerSingleton(IBaseHalfClipboardService, BaseHalfClipboardService, InstantiationType.Delayed);
