/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { IRange } from '../../../editor/common/core/range.js';
import { ICursorStateComputer, IIdentifiedSingleEditOperation } from '../../../editor/common/model.js';
import { Selection } from '../../../editor/common/core/selection.js';
import { IBaseHalfMarkdownRichDisk } from './basehalfMarkdownRichSession.js';

export interface IBaseHalfMarkdownRichTextModel {
	readonly uri: URI;

	getValue(): string;
	getFullModelRange(): IRange;
	isDisposed(): boolean;
	pushEditOperations(
		beforeCursorState: Selection[] | null,
		editOperations: IIdentifiedSingleEditOperation[],
		cursorStateComputer: ICursorStateComputer
	): Selection[] | null;
}

export interface IBaseHalfMarkdownRichTextFileService {
	isDirty(resource: URI): boolean;
	isReadonly(resource: URI): boolean;
	save(resource: URI, options?: IBaseHalfMarkdownRichTextFileSaveOptions): Promise<URI | undefined>;
}

export interface IBaseHalfMarkdownRichTextFileSaveOptions {
	readonly ignoreErrorHandler?: boolean;
}

export class BaseHalfMarkdownRichTextModelDisposedError extends Error {
	constructor(readonly resource: URI) {
		super(`Markdown rich text model is disposed: ${resource.toString()}`);
	}
}

export class BaseHalfMarkdownRichTextModelReadonlyError extends Error {
	constructor(readonly resource: URI) {
		super(`Markdown rich text model is readonly: ${resource.toString()}`);
	}
}

export class BaseHalfMarkdownRichTextModelSaveCancelledError extends Error {
	constructor(readonly resource: URI) {
		super(`Markdown rich text model save was cancelled: ${resource.toString()}`);
	}
}

export class BaseHalfMarkdownRichTextModelDirtyAfterSaveError extends Error {
	constructor(readonly resource: URI) {
		super(`Markdown rich text model remained dirty after save: ${resource.toString()}`);
	}
}

export class BaseHalfMarkdownRichTextModelDisk implements IBaseHalfMarkdownRichDisk {
	constructor(
		private readonly model: IBaseHalfMarkdownRichTextModel,
		private readonly textFileService: IBaseHalfMarkdownRichTextFileService
	) { }

	async read(): Promise<string> {
		this.assertModelAlive();
		return this.model.getValue();
	}

	async write(content: string): Promise<void> {
		this.assertModelAlive();
		if (this.textFileService.isReadonly(this.model.uri)) {
			throw new BaseHalfMarkdownRichTextModelReadonlyError(this.model.uri);
		}

		if (this.model.getValue() !== content) {
			this.model.pushEditOperations(null, [{
				range: this.model.getFullModelRange(),
				text: content
			}], () => null);
		}

		this.assertModelAlive();
		const saved = await this.textFileService.save(this.model.uri, { ignoreErrorHandler: true });
		if (!saved) {
			throw new BaseHalfMarkdownRichTextModelSaveCancelledError(this.model.uri);
		}

		this.assertModelAlive();
		if (this.textFileService.isDirty(this.model.uri)) {
			throw new BaseHalfMarkdownRichTextModelDirtyAfterSaveError(this.model.uri);
		}
	}

	private assertModelAlive(): void {
		if (this.model.isDisposed()) {
			throw new BaseHalfMarkdownRichTextModelDisposedError(this.model.uri);
		}
	}
}
