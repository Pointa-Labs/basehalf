/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../base/common/buffer.js';
import { posix } from '../../../base/common/path.js';
import { dirname, joinPath, relativePath } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { BaseHalfSetting } from './basehalfConfiguration.js';
import { BASEHALF_MARKDOWN_ATTACHMENT_MAX_BYTES } from './basehalfMarkdownRichWebviewProtocol.js';

export const BASEHALF_DEFAULT_ATTACHMENTS_DIRECTORY = 'attachments';
export interface IBaseHalfStoredMarkdownAttachment {
	readonly resource: URI;
	/** Markdown-safe path relative to the document directory. */
	readonly href: string;
}

export const IBaseHalfMarkdownAttachmentService = createDecorator<IBaseHalfMarkdownAttachmentService>('baseHalfMarkdownAttachmentService');

export interface IBaseHalfMarkdownAttachmentService {
	readonly _serviceBrand: undefined;

	store(documentResource: URI, name: string, data: ArrayBuffer): Promise<IBaseHalfStoredMarkdownAttachment>;
}

export class BaseHalfMarkdownAttachmentService implements IBaseHalfMarkdownAttachmentService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) { }

	async store(documentResource: URI, name: string, data: ArrayBuffer): Promise<IBaseHalfStoredMarkdownAttachment> {
		if (data.byteLength > BASEHALF_MARKDOWN_ATTACHMENT_MAX_BYTES) {
			throw new Error(`Attachments must be ${Math.floor(BASEHALF_MARKDOWN_ATTACHMENT_MAX_BYTES / 1024 / 1024)} MB or smaller.`);
		}

		const configuredDirectory = this.configurationService.getValue<string>(
			BaseHalfSetting.AttachmentsDirectory,
			{ resource: documentResource }
		);
		const directory = normalizeBaseHalfAttachmentsDirectory(configuredDirectory);
		const parent = joinPath(dirname(documentResource), ...directory.split('/'));
		await this.fileService.createFolder(parent);

		const safeName = sanitizeBaseHalfAttachmentName(name);
		let target = joinPath(parent, safeName);
		for (let attempt = 2; await this.fileService.exists(target); attempt++) {
			target = joinPath(parent, baseHalfAttachmentNameWithSuffix(safeName, attempt));
		}

		await this.fileService.createFile(target, VSBuffer.wrap(new Uint8Array(data)), { overwrite: false });
		return {
			resource: target,
			href: baseHalfMarkdownAttachmentHref(documentResource, target)
		};
	}
}

export function normalizeBaseHalfAttachmentsDirectory(value: unknown): string {
	if (typeof value !== 'string') {
		return BASEHALF_DEFAULT_ATTACHMENTS_DIRECTORY;
	}
	const normalized = value.trim().replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/g, '');
	const segments = normalized.split('/');
	if (!normalized || normalized.startsWith('/') || segments.some(segment => !isPortableAttachmentDirectorySegment(segment))) {
		return BASEHALF_DEFAULT_ATTACHMENTS_DIRECTORY;
	}
	return segments.join('/');
}

function isPortableAttachmentDirectorySegment(segment: string): boolean {
	return !!segment
		&& segment !== '.'
		&& segment !== '..'
		&& segment.length <= 160
		&& !/[\u0000-\u001f<>:"|?*]/.test(segment)
		&& !/[. ]$/.test(segment)
		&& !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment);
}

export function sanitizeBaseHalfAttachmentName(value: string): string {
	const replaced = value
		.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '-')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/[. ]+$/g, '');
	let name = replaced && replaced !== '.' && replaced !== '..' ? replaced : 'attachment';
	const extension = posix.extname(name);
	const stem = name.slice(0, name.length - extension.length);
	if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) {
		name = `_${name}`;
	}
	if (name.length > 160) {
		name = `${name.slice(0, Math.max(1, 160 - extension.length))}${extension}`;
	}
	return name;
}

export function baseHalfAttachmentNameWithSuffix(name: string, attempt: number): string {
	const extension = posix.extname(name);
	const stem = name.slice(0, name.length - extension.length);
	return `${stem}-${Math.max(2, Math.trunc(attempt))}${extension}`;
}

export function baseHalfMarkdownAttachmentHref(documentResource: URI, attachmentResource: URI): string {
	const path = relativePath(dirname(documentResource), attachmentResource) ?? attachmentResource.path;
	return path.split('/').map(segment => segment === '..' ? segment : encodeURIComponent(segment)).join('/');
}

registerSingleton(IBaseHalfMarkdownAttachmentService, BaseHalfMarkdownAttachmentService, InstantiationType.Delayed);
