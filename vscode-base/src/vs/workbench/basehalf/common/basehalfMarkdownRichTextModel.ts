/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { IPosition } from '../../../editor/common/core/position.js';
import { ICursorStateComputer, IIdentifiedSingleEditOperation } from '../../../editor/common/model.js';
import { Selection } from '../../../editor/common/core/selection.js';
import {
	BaseHalfMarkdownRichDiskChangedError,
	IBaseHalfMarkdownRichDisk,
	IBaseHalfMarkdownRichDiskWriteOptions
} from './basehalfMarkdownRichSession.js';

export interface IBaseHalfMarkdownRichTextModel {
	readonly uri: URI;

	getValue(): string;
	getEOL(): string;
	getPositionAt(offset: number): IPosition;
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

export interface IBaseHalfMarkdownRichTextEdit {
	readonly offset: number;
	readonly length: number;
	readonly text: string;
}

/**
 * The smallest single replacement that turns `current` into `next`. A range
 * boundary never splits a CRLF pair or a UTF-16 surrogate pair. Returns
 * `undefined` when the texts are equal.
 */
export function computeBaseHalfMarkdownRichTextEdit(current: string, next: string): IBaseHalfMarkdownRichTextEdit | undefined {
	if (current === next) {
		return undefined;
	}

	const limit = Math.min(current.length, next.length);
	let prefix = 0;
	while (prefix < limit && current.charCodeAt(prefix) === next.charCodeAt(prefix)) {
		prefix++;
	}
	while (prefix > 0 && (splitsPair(current, prefix) || splitsPair(next, prefix))) {
		prefix--;
	}

	let suffix = 0;
	while (suffix < limit - prefix
		&& current.charCodeAt(current.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)) {
		suffix++;
	}
	while (suffix > 0 && (splitsPair(current, current.length - suffix) || splitsPair(next, next.length - suffix))) {
		suffix--;
	}

	return {
		offset: prefix,
		length: current.length - suffix - prefix,
		text: next.slice(prefix, next.length - suffix)
	};
}

/** True when a boundary at `offset` falls inside a CRLF or surrogate pair. */
function splitsPair(value: string, offset: number): boolean {
	if (offset <= 0 || offset >= value.length) {
		return false;
	}
	const before = value.charCodeAt(offset - 1);
	const after = value.charCodeAt(offset);
	return (before === 13 /* \r */ && after === 10 /* \n */)
		|| (before >= 0xD800 && before <= 0xDBFF && after >= 0xDC00 && after <= 0xDFFF);
}

/**
 * Applies `content` to the text model as one undoable minimal-range edit, so
 * bytes outside the changed range (the frontmatter of a body-only save, for
 * example) are never rewritten, and cursors and decorations of other
 * projections outside the range keep their places. The text is first brought
 * to the model's line ending, which the model would otherwise apply itself.
 * Returns the model text after the edit.
 */
export function applyBaseHalfMarkdownRichTextModelContent(model: IBaseHalfMarkdownRichTextModel, content: string): string {
	const current = model.getValue();
	const edit = computeBaseHalfMarkdownRichTextEdit(current, normalizeBaseHalfMarkdownRichEol(content, model.getEOL()));
	if (!edit) {
		return current;
	}

	const start = model.getPositionAt(edit.offset);
	const end = model.getPositionAt(edit.offset + edit.length);
	model.pushEditOperations(null, [{
		range: {
			startLineNumber: start.lineNumber,
			startColumn: start.column,
			endLineNumber: end.lineNumber,
			endColumn: end.column
		},
		text: edit.text
	}], () => null);
	return model.getValue();
}

function normalizeBaseHalfMarkdownRichEol(content: string, eol: string): string {
	return eol === '\r\n' || eol === '\n' ? content.replace(/\r\n|\r|\n/g, eol) : content;
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

	async write(content: string, options: IBaseHalfMarkdownRichDiskWriteOptions = {}): Promise<string> {
		this.assertModelAlive();
		if (this.textFileService.isReadonly(this.model.uri)) {
			throw new BaseHalfMarkdownRichTextModelReadonlyError(this.model.uri);
		}
		if (options.expected !== undefined && this.model.getValue() !== options.expected) {
			throw new BaseHalfMarkdownRichDiskChangedError();
		}

		const written = applyBaseHalfMarkdownRichTextModelContent(this.model, content);

		this.assertModelAlive();
		const saved = await this.textFileService.save(this.model.uri, { ignoreErrorHandler: true });
		if (!saved) {
			throw new BaseHalfMarkdownRichTextModelSaveCancelledError(this.model.uri);
		}

		this.assertModelAlive();
		if (this.textFileService.isDirty(this.model.uri)) {
			throw new BaseHalfMarkdownRichTextModelDirtyAfterSaveError(this.model.uri);
		}
		return written;
	}

	private assertModelAlive(): void {
		if (this.model.isDisposed()) {
			throw new BaseHalfMarkdownRichTextModelDisposedError(this.model.uri);
		}
	}
}

/**
 * Tracks rich writes into the shared text model. The model's content listener
 * must ignore the rich projection's own edits, but a change that another
 * projection, a reference operation, or a disk reload makes while a rich save
 * is in flight must still reach the webview: it is queued and replayed once
 * after the last write settles.
 */
export class BaseHalfMarkdownRichTextModelWriteGate {
	private writes = 0;
	private changedDuringWrite = false;

	constructor(private readonly replay: () => void) { }

	get writing(): boolean {
		return this.writes > 0;
	}

	/** Returns true when the caller handles the change now; false when it is queued. */
	acceptChange(): boolean {
		if (this.writes > 0) {
			this.changedDuringWrite = true;
			return false;
		}
		return true;
	}

	async run<T>(task: () => Promise<T>): Promise<T> {
		this.writes++;
		try {
			return await task();
		} finally {
			this.writes--;
			if (this.writes === 0 && this.changedDuringWrite) {
				this.changedDuringWrite = false;
				this.replay();
			}
		}
	}
}
