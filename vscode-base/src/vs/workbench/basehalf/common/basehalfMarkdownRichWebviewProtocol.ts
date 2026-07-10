/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IBaseHalfMarkdownFocusFields } from './basehalfMarkdownFocus.js';
import { IBaseHalfAdhdCommand, IBaseHalfAdhdFile, isBaseHalfAdhdFile } from './basehalfAdhd.js';

export const BASEHALF_MARKDOWN_RICH_WEBVIEW_VIEW_TYPE = 'basehalf.markdownRich';
export const BASEHALF_MARKDOWN_RICH_WEBVIEW_MESSAGE_PREFIX = 'basehalf.markdownRich';

export interface IBaseHalfMarkdownRichTextSelection {
	readonly startLineNumber: number;
	readonly startColumn: number;
	readonly endLineNumber?: number;
	readonly endColumn?: number;
}

export type BaseHalfMarkdownRichWorkbenchCommand = 'quickOpen' | 'showCommands';

/**
 * Editing commands the host forwards into the rich editor. The rich editor's
 * edit history lives in the webview's collaboration undo manager, so
 * workbench-level Undo/Redo (menu, command service) must be delivered as an
 * explicit editor command instead of the generic webview native-undo path,
 * which mutates the DOM behind the editor's transaction model.
 */
export type BaseHalfMarkdownRichEditorCommand = 'undo' | 'redo';

/**
 * A workspace file offered by the `[[` link autocomplete. `path` is
 * workspace-relative (shown as the item's detail); `href` is relative to the
 * document being edited, ready to be written into a Markdown link.
 */
export interface IBaseHalfMarkdownRichFileLink {
	readonly name: string;
	readonly path: string;
	readonly href: string;
}

/**
 * Channel ownership contract:
 * - The Markdown string channel (`init` / `saveRequested` / `saveResult`) is
 *   the authoritative content transport. The text file working copy stays the
 *   single content truth.
 * - The collaboration update channel (`applyYjsUpdate` / `yjsUpdate`) is the
 *   provider-ready replica stream. On `ready` the host replays its replica
 *   state so both sides share one history; after that the webview editor is
 *   the only writer and the host document is a passive replica (the future
 *   collaboration provider attach point). Host code must never push replica
 *   state into a live editor outside that `ready` replay.
 */
/**
 * A prewarmed editor shell boots without a document key (the expensive part —
 * webview process, bundle parse, editor construction — is document
 * independent). It announces itself with `booted` under this sentinel key and
 * stays inert until the host assigns its real document key via `adopt`, at
 * which point it emits the ordinary `ready` and the standard boot flow runs.
 */
export const BASEHALF_MARKDOWN_RICH_WARMUP_KEY = 'basehalf.warmup';

export type BaseHalfMarkdownRichHostMessage =
	| {
		readonly type: 'basehalf.markdownRich.adopt';
		readonly key: string;
	}
	| {
		readonly type: 'basehalf.markdownRich.init';
		readonly key: string;
		readonly resource: string;
		readonly content: string;
		readonly editable: boolean;
		readonly selection?: IBaseHalfMarkdownRichTextSelection;
	}
	| {
		readonly type: 'basehalf.markdownRich.applyYjsUpdate';
		readonly key: string;
		readonly update: ArrayBuffer;
	}
	| {
		readonly type: 'basehalf.markdownRich.setEditable';
		readonly key: string;
		readonly editable: boolean;
	}
	| {
		/** Freeze editor input for the full lifetime of a structural file
		 * operation. The request id is echoed by the webview so the host never
		 * starts serialization before the iframe has observed the fence. */
		readonly type: 'basehalf.markdownRich.setStructuralFreeze';
		readonly key: string;
		readonly requestId: string;
		readonly frozen: boolean;
	}
	| {
		readonly type: 'basehalf.markdownRich.revealSelection';
		readonly key: string;
		readonly selection: IBaseHalfMarkdownRichTextSelection;
	}
	| {
		readonly type: 'basehalf.markdownRich.command';
		readonly key: string;
		readonly command: BaseHalfMarkdownRichEditorCommand;
	}
	| {
		readonly type: 'basehalf.markdownRich.fileSearchResult';
		readonly key: string;
		readonly requestId: string;
		readonly files: readonly IBaseHalfMarkdownRichFileLink[];
	}
	| {
		readonly type: 'basehalf.markdownRich.save';
		readonly key: string;
		readonly requestId: string;
		readonly forceSerialize: boolean;
		readonly forceWrite: boolean;
		readonly structural: boolean;
	}
	| {
		readonly type: 'basehalf.markdownRich.saveResult';
		readonly key: string;
		readonly requestId: string;
		readonly result: 'saved' | 'noop' | 'blockedByConflict' | 'writeFailed';
		readonly content?: string;
		readonly disk?: string;
		readonly message?: string;
	}
	| {
		readonly type: 'basehalf.markdownRich.adhdState';
		readonly key: string;
		readonly readingModeEnabled?: boolean;
		readonly adhd?: IBaseHalfAdhdFile | null;
		readonly error?: string;
	};

export type BaseHalfMarkdownRichWebviewMessage =
	| {
		// A keyless prewarmed shell finished booting; sent under the warmup
		// sentinel key since the shell has no document yet.
		readonly type: 'basehalf.markdownRich.booted';
		readonly key: string;
	}
	| {
		readonly type: 'basehalf.markdownRich.ready';
		readonly key: string;
	}
	| {
		// First meaningful frame: the initial document content has been
		// applied and painted. The host holds the projection swap on this,
		// so a booting editor never becomes visible half-drawn.
		readonly type: 'basehalf.markdownRich.rendered';
		readonly key: string;
	}
	| {
		readonly type: 'basehalf.markdownRich.yjsUpdate';
		readonly key: string;
		readonly update: ArrayBuffer | Uint8Array | readonly number[];
	}
	| {
		readonly type: 'basehalf.markdownRich.saveRequested';
		readonly key: string;
		readonly requestId: string;
		readonly content: string;
		readonly previousContent: string;
		readonly forceWrite: boolean;
	}
	| {
		readonly type: 'basehalf.markdownRich.dirtyChanged';
		readonly key: string;
		readonly dirty: boolean;
	}
	| {
		readonly type: 'basehalf.markdownRich.structuralFreezeChanged';
		readonly key: string;
		readonly requestId: string;
		readonly frozen: boolean;
	}
	| {
		readonly type: 'basehalf.markdownRich.focusChanged';
		readonly key: string;
		readonly fields: IBaseHalfMarkdownFocusFields;
	}
	| {
		readonly type: 'basehalf.markdownRich.editorActivated';
		readonly key: string;
	}
	| {
		readonly type: 'basehalf.markdownRich.workbenchCommand';
		readonly key: string;
		readonly command: BaseHalfMarkdownRichWorkbenchCommand;
	}
	| {
		readonly type: 'basehalf.markdownRich.fileSearch';
		readonly key: string;
		readonly requestId: string;
		readonly query: string;
	}
	| {
		readonly type: 'basehalf.markdownRich.openSource';
		readonly key: string;
		readonly selection: IBaseHalfMarkdownRichTextSelection;
	}
	| {
		readonly type: 'basehalf.markdownRich.adhdCommand';
		readonly key: string;
		readonly command: IBaseHalfAdhdCommand;
	}
	| {
		readonly type: 'basehalf.markdownRich.error';
		readonly key: string;
		readonly message: string;
		readonly stack?: string;
	};

export interface IBaseHalfMarkdownRichTransferableUpdate {
	readonly update: ArrayBuffer;
	readonly transfer: readonly ArrayBuffer[];
}

export function isBaseHalfMarkdownRichHostMessage(message: unknown): message is BaseHalfMarkdownRichHostMessage {
	const candidate = message as Partial<BaseHalfMarkdownRichHostMessage> | undefined;
	if (!isBaseHalfMarkdownRichMessageEnvelope(candidate)) {
		return false;
	}

	switch (candidate.type) {
		case 'basehalf.markdownRich.adopt':
			return true;
		case 'basehalf.markdownRich.init':
			return typeof candidate.resource === 'string'
				&& typeof candidate.content === 'string'
				&& typeof candidate.editable === 'boolean'
				&& (candidate.selection === undefined || isBaseHalfMarkdownRichSelection(candidate.selection));
		case 'basehalf.markdownRich.applyYjsUpdate':
			return candidate.update instanceof ArrayBuffer;
		case 'basehalf.markdownRich.setEditable':
			return typeof candidate.editable === 'boolean';
		case 'basehalf.markdownRich.setStructuralFreeze':
			return typeof candidate.requestId === 'string'
				&& candidate.requestId.length > 0
				&& typeof candidate.frozen === 'boolean';
		case 'basehalf.markdownRich.revealSelection':
			return isBaseHalfMarkdownRichSelection(candidate.selection);
		case 'basehalf.markdownRich.command':
			return candidate.command === 'undo' || candidate.command === 'redo';
		case 'basehalf.markdownRich.fileSearchResult':
			return typeof candidate.requestId === 'string'
				&& candidate.requestId.length > 0
				&& Array.isArray(candidate.files)
				&& candidate.files.every(isBaseHalfMarkdownRichFileLink);
		case 'basehalf.markdownRich.save':
			return typeof candidate.requestId === 'string'
				&& candidate.requestId.length > 0
				&& typeof candidate.forceSerialize === 'boolean'
				&& typeof candidate.forceWrite === 'boolean'
				&& typeof candidate.structural === 'boolean';
		case 'basehalf.markdownRich.saveResult':
			return typeof candidate.requestId === 'string'
				&& candidate.requestId.length > 0
				&& (candidate.result === 'saved'
				|| candidate.result === 'noop'
				|| candidate.result === 'blockedByConflict'
				|| candidate.result === 'writeFailed')
				&& (candidate.content === undefined || typeof candidate.content === 'string')
				&& (candidate.disk === undefined || typeof candidate.disk === 'string')
				&& (candidate.message === undefined || typeof candidate.message === 'string');
		case 'basehalf.markdownRich.adhdState':
			return (candidate.readingModeEnabled === undefined || typeof candidate.readingModeEnabled === 'boolean')
				&& (candidate.adhd === undefined || candidate.adhd === null || isBaseHalfAdhdFile(candidate.adhd))
				&& (candidate.error === undefined || typeof candidate.error === 'string');
		default:
			return false;
	}
}

export function isBaseHalfMarkdownRichWebviewMessage(message: unknown): message is BaseHalfMarkdownRichWebviewMessage {
	const candidate = message as Partial<BaseHalfMarkdownRichWebviewMessage> | undefined;
	if (!isBaseHalfMarkdownRichMessageEnvelope(candidate)) {
		return false;
	}

	switch (candidate.type) {
		case 'basehalf.markdownRich.booted':
		case 'basehalf.markdownRich.ready':
		case 'basehalf.markdownRich.rendered':
			return true;
		case 'basehalf.markdownRich.saveRequested':
			return typeof candidate.requestId === 'string'
				&& candidate.requestId.length > 0
				&& typeof candidate.content === 'string'
				&& typeof candidate.previousContent === 'string'
				&& typeof candidate.forceWrite === 'boolean';
		case 'basehalf.markdownRich.dirtyChanged':
			return typeof candidate.dirty === 'boolean';
		case 'basehalf.markdownRich.structuralFreezeChanged':
			return typeof candidate.requestId === 'string'
				&& candidate.requestId.length > 0
				&& typeof candidate.frozen === 'boolean';
		case 'basehalf.markdownRich.yjsUpdate':
			return isBaseHalfMarkdownRichUpdatePayload(candidate.update);
		case 'basehalf.markdownRich.editorActivated':
			return true;
		case 'basehalf.markdownRich.focusChanged':
			return isBaseHalfMarkdownRichFocusFields(candidate.fields);
		case 'basehalf.markdownRich.workbenchCommand':
			return candidate.command === 'quickOpen' || candidate.command === 'showCommands';
		case 'basehalf.markdownRich.fileSearch':
			return typeof candidate.requestId === 'string'
				&& candidate.requestId.length > 0
				&& typeof candidate.query === 'string';
		case 'basehalf.markdownRich.openSource':
			return isBaseHalfMarkdownRichSelection(candidate.selection);
		case 'basehalf.markdownRich.adhdCommand':
			return isBaseHalfMarkdownRichAdhdCommand(candidate.command);
		case 'basehalf.markdownRich.error':
			return typeof candidate.message === 'string'
				&& (candidate.stack === undefined || typeof candidate.stack === 'string');
		default:
			return false;
	}
}

export function toBaseHalfMarkdownRichTransferableUpdate(update: Uint8Array): IBaseHalfMarkdownRichTransferableUpdate {
	const copy = new Uint8Array(update.byteLength);
	copy.set(update);
	return {
		update: copy.buffer,
		transfer: [copy.buffer]
	};
}

export function baseHalfMarkdownRichUpdateFromPayload(payload: ArrayBuffer | Uint8Array | readonly number[]): Uint8Array {
	if (payload instanceof Uint8Array) {
		return payload;
	}
	if (payload instanceof ArrayBuffer) {
		return new Uint8Array(payload);
	}
	if (Array.isArray(payload)) {
		return Uint8Array.from(payload);
	}
	throw new Error('Unsupported BaseHalf Markdown rich YJS update payload');
}

function isBaseHalfMarkdownRichMessageEnvelope(message: { readonly type?: unknown; readonly key?: unknown } | undefined): message is { readonly type: string; readonly key: string } {
	return typeof message?.type === 'string'
		&& message.type.startsWith(`${BASEHALF_MARKDOWN_RICH_WEBVIEW_MESSAGE_PREFIX}.`)
		&& typeof message.key === 'string'
		&& message.key.length > 0;
}

function isBaseHalfMarkdownRichUpdatePayload(payload: unknown): payload is ArrayBuffer | Uint8Array | readonly number[] {
	return payload instanceof ArrayBuffer
		|| payload instanceof Uint8Array
		|| (Array.isArray(payload) && payload.every(value => Number.isInteger(value) && value >= 0 && value <= 255));
}

function isBaseHalfMarkdownRichFocusFields(value: unknown): value is IBaseHalfMarkdownFocusFields {
	if (!isObject(value)) {
		return false;
	}

	const fields = value as Partial<IBaseHalfMarkdownFocusFields>;
	return (fields.visible_lines === undefined || isBaseHalfMarkdownRichStartField(fields.visible_lines))
		&& (fields.visible_blocks === undefined || isBaseHalfMarkdownRichStartField(fields.visible_blocks))
		&& (fields.cursor === undefined || isBaseHalfMarkdownRichCursor(fields.cursor));
}

function isBaseHalfMarkdownRichStartField(value: unknown): value is { readonly start: number } {
	return isObject(value) && isPositiveInteger((value as { readonly start?: unknown }).start);
}

function isBaseHalfMarkdownRichCursor(value: unknown): value is NonNullable<IBaseHalfMarkdownFocusFields['cursor']> {
	if (!isObject(value)) {
		return false;
	}

	const cursor = value as Partial<NonNullable<IBaseHalfMarkdownFocusFields['cursor']>>;
	return isPositiveInteger(cursor.line)
		&& isPositiveInteger(cursor.column)
		&& (cursor.line_precision === 'exact' || cursor.line_precision === 'block_start' || cursor.line_precision === 'estimated')
		&& (cursor.block === undefined || isPositiveInteger(cursor.block));
}

function isBaseHalfMarkdownRichSelection(value: unknown): value is IBaseHalfMarkdownRichTextSelection {
	if (!isObject(value)) {
		return false;
	}

	const selection = value as Partial<IBaseHalfMarkdownRichTextSelection>;
	return isPositiveInteger(selection.startLineNumber)
		&& isPositiveInteger(selection.startColumn)
		&& (selection.endLineNumber === undefined || isPositiveInteger(selection.endLineNumber))
		&& (selection.endColumn === undefined || isPositiveInteger(selection.endColumn));
}

function isBaseHalfMarkdownRichAdhdCommand(value: unknown): value is IBaseHalfAdhdCommand {
	if (!isObject(value)) {
		return false;
	}

	const command = value as Partial<IBaseHalfAdhdCommand>;
	if (command.command === 'addKeyword' || command.command === 'removeKeyword') {
		return typeof command.keyword === 'string' && command.keyword.trim().length > 0;
	}

	if (command.command === 'markRead' || command.command === 'markUnread') {
		return isPositiveInteger(command.start) && isPositiveInteger(command.end) && command.end >= command.start;
	}

	return false;
}

function isBaseHalfMarkdownRichFileLink(value: unknown): value is IBaseHalfMarkdownRichFileLink {
	if (!isObject(value)) {
		return false;
	}

	const file = value as Partial<IBaseHalfMarkdownRichFileLink>;
	return typeof file.name === 'string'
		&& file.name.length > 0
		&& typeof file.path === 'string'
		&& file.path.length > 0
		&& typeof file.href === 'string'
		&& file.href.length > 0;
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isObject(value: unknown): value is object {
	return typeof value === 'object' && value !== null;
}
