/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, EventType, isHTMLElement } from '../../../../base/browser/dom.js';
import { renderMarkdown } from '../../../../base/browser/markdownRenderer.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { FileAccess } from '../../../../base/common/network.js';
import { dirname, isEqual, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { Range } from '../../../../editor/common/core/range.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { IModelContentChangedEvent } from '../../../../editor/common/textModelEvents.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ITextFileService, TextFileEditorModelState } from '../../../services/textfile/common/textfiles.js';
import { IBaseHalfCardDetailState } from '../../common/basehalfCanvasNavigation.js';
import { IBaseHalfCanvasNoteEditPoint, IBaseHalfCanvasNoteFormatState } from '../../common/basehalfCanvasScene.js';
import type { BaseHalfMarkdownFormatCommand } from '../../common/basehalfMarkdownFormatting.js';
import { IBaseHalfEditorFlushOptions, IBaseHalfEditorFlushService } from '../../common/basehalfEditorFlush.js';
import { segmentBaseHalfMarkdownTopLevelBody, splitBaseHalfMarkdownFrontmatter } from '../../common/basehalfMarkdownProjection.js';

const CANVAS_MARKDOWN_INLINE_VENDOR_ROOT = 'vs/../../extensions/basehalf/canvas-markdown-inline-out';
const CANVAS_MARKDOWN_INLINE_VENDOR_SCRIPT = 'canvasMarkdownInline.js';
const CANVAS_MARKDOWN_INLINE_VENDOR_STYLES = 'canvasMarkdownInline.css';
const CANVAS_MARKDOWN_INLINE_EDIT_GROUP_DELAY = 650;

export function collectBaseHalfCanvasMarkdownReferenceDefinitions(markdown: string): string {
	const definitions: string[] = [];
	const lines = markdown.split(/\r\n?|\n/);
	let fence: { readonly marker: '`' | '~'; readonly length: number } | undefined;
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		const fenceMatch = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
		if (fenceMatch) {
			const marker = fenceMatch[1][0] as '`' | '~';
			if (!fence) {
				fence = { marker, length: fenceMatch[1].length };
			} else if (fence.marker === marker
				&& fenceMatch[1].length >= fence.length
				&& fenceMatch[2].trim().length === 0) {
				fence = undefined;
			}
			continue;
		}
		if (fence || !/^\s{0,3}\[[^\]\n]+\]:/.test(line)) {
			continue;
		}
		definitions.push(line);
		const title = lines[index + 1];
		if (title && /^\s{1,3}(?:["'(])/.test(title)) {
			definitions.push(title);
			index++;
		}
	}
	return definitions.join('\n');
}

export type BaseHalfCanvasMarkdownInlineSaveStatus = 'saving' | 'saved' | 'error';

export interface IBaseHalfCanvasMarkdownInlineSelection {
	readonly anchor: number;
	readonly head: number;
}

interface IBaseHalfCanvasMarkdownInlineRuntime {
	focusAtPoint(clientX: number, clientY: number): boolean;
	focus(): void;
	setReadOnly(readOnly: boolean): void;
	getSelection(): IBaseHalfCanvasMarkdownInlineSelection;
	getMarkdown(): string;
	getFormatState(): IBaseHalfCanvasNoteFormatState;
	runFormatCommand(command: BaseHalfMarkdownFormatCommand): boolean;
	isComposing(): boolean;
	destroy(): void;
}

interface IBaseHalfCanvasMarkdownInlineVendor {
	canEditCanvasMarkdownUnit(markdown: string): boolean;
	createCanvasMarkdownInlineEditor(host: HTMLElement, options: {
		readonly markdown: string;
		readonly units: readonly {
			readonly id: string;
			readonly markdown: string;
			readonly prefix: string;
			readonly separator: string;
			readonly editable: boolean;
			readonly element: HTMLElement;
		}[];
		readonly readOnly?: boolean;
		readonly selection?: IBaseHalfCanvasMarkdownInlineSelection;
		readonly onMarkdownChange?: (markdown: string) => void;
		readonly onCompositionChange?: (composing: boolean) => void;
		readonly onUndoRequest?: () => void;
		readonly onRedoRequest?: () => void;
		readonly onExitRequest?: () => void;
		readonly onToolbarRequest?: () => void;
		readonly onFormatStateChange?: (state: IBaseHalfCanvasNoteFormatState) => void;
	}): IBaseHalfCanvasMarkdownInlineRuntime;
}

interface IBaseHalfCanvasMarkdownRenderedUnit {
	readonly element: HTMLElement;
	readonly supported: boolean;
	readonly markdown: string;
	readonly prefix: string;
	readonly separator: string;
}

export interface IBaseHalfCanvasMarkdownTextEdit {
	readonly offset: number;
	readonly length: number;
	readonly text: string;
}

/** Computes the smallest contiguous TextModel edit that produces `next`. */
export function computeBaseHalfCanvasMarkdownTextEdit(current: string, next: string): IBaseHalfCanvasMarkdownTextEdit | undefined {
	if (current === next) {
		return undefined;
	}
	let prefix = 0;
	const prefixLimit = Math.min(current.length, next.length);
	while (prefix < prefixLimit && current.charCodeAt(prefix) === next.charCodeAt(prefix)) {
		prefix++;
	}
	let currentSuffix = current.length;
	let nextSuffix = next.length;
	while (currentSuffix > prefix
		&& nextSuffix > prefix
		&& current.charCodeAt(currentSuffix - 1) === next.charCodeAt(nextSuffix - 1)) {
		currentSuffix--;
		nextSuffix--;
	}
	return {
		offset: prefix,
		length: currentSuffix - prefix,
		text: next.slice(prefix, nextSuffix)
	};
}

export function transformBaseHalfCanvasMarkdownOffset(
	offset: number,
	changes: readonly { readonly rangeOffset: number; readonly rangeLength: number; readonly text: string }[],
	affinity: 'before' | 'after'
): number {
	let delta = 0;
	for (const change of [...changes].sort((a, b) => a.rangeOffset - b.rangeOffset)) {
		const start = change.rangeOffset;
		const end = start + change.rangeLength;
		if (offset < start || (offset === start && (affinity === 'before' || change.rangeLength > 0))) {
			break;
		}
		if (offset > end || (offset === end && (affinity === 'after' || change.rangeLength > 0))) {
			delta += change.text.length - change.rangeLength;
			continue;
		}
		return Math.max(0, start + delta + (affinity === 'after' ? change.text.length : 0));
	}
	return Math.max(0, offset + delta);
}

export interface IBaseHalfCanvasMarkdownInlineEditorOptions {
	readonly onEditorFocus?: () => void;
	readonly onSaveStatusChange?: (status: BaseHalfCanvasMarkdownInlineSaveStatus) => void;
	readonly onCanvasToolbarRequest?: () => void;
	readonly onCanvasExitRequest?: () => void;
	readonly onSaveRequest?: (save: Promise<boolean>) => void;
	readonly onOpenLink?: (href: string) => void;
	readonly onFormatStateChange?: (state: IBaseHalfCanvasNoteFormatState) => void;
}

let vendorPromise: Promise<IBaseHalfCanvasMarkdownInlineVendor> | undefined;
const stylePromises = new WeakMap<Document, Promise<void>>();

async function loadCanvasMarkdownInlineVendor(): Promise<IBaseHalfCanvasMarkdownInlineVendor> {
	if (!vendorPromise) {
		const root = FileAccess.asBrowserUri(CANVAS_MARKDOWN_INLINE_VENDOR_ROOT);
		const moduleUrl = URI.joinPath(root, CANVAS_MARKDOWN_INLINE_VENDOR_SCRIPT).toString(true);
		vendorPromise = import(moduleUrl).then(
			module => module as unknown as IBaseHalfCanvasMarkdownInlineVendor,
			error => {
				vendorPromise = undefined;
				throw error;
			}
		);
	}
	return vendorPromise;
}

function loadCanvasMarkdownInlineStyles(document: Document): Promise<void> {
	const current = stylePromises.get(document);
	if (current) {
		return current;
	}
	const loading = new Promise<void>((resolve, reject) => {
		const existing = document.querySelector<HTMLLinkElement>('link[data-basehalf-canvas-markdown-inline-vendor]');
		if (existing?.dataset.loaded === 'true' || existing?.sheet) {
			resolve();
			return;
		}
		const link = existing ?? document.createElement('link');
		link.rel = 'stylesheet';
		link.dataset.basehalfCanvasMarkdownInlineVendor = 'true';
		const onLoad = () => {
			link.dataset.loaded = 'true';
			resolve();
		};
		const onError = () => {
			link.remove();
			reject(new Error(`Unable to load BaseHalf Canvas Markdown inline styles from ${link.href}`));
		};
		link.addEventListener('load', onLoad, { once: true });
		link.addEventListener('error', onError, { once: true });
		if (!existing) {
			const root = FileAccess.asBrowserUri(CANVAS_MARKDOWN_INLINE_VENDOR_ROOT);
			link.href = URI.joinPath(root, CANVAS_MARKDOWN_INLINE_VENDOR_STYLES).toString(true);
			document.head.appendChild(link);
		}
	});
	stylePromises.set(document, loading);
	void loading.catch(() => stylePromises.delete(document));
	return loading;
}

/**
 * A low-latency WYSIWYG projection for a Markdown card. Edit mode owns one
 * continuous ProseMirror selection surface; source tiles remain explicit so
 * untouched Markdown is reused byte-for-byte. The TextModel is the sole
 * document and undo owner.
 */
export class BaseHalfCanvasMarkdownInlineEditor extends Disposable {
	private static readonly SAVE_SETTLE_TIMEOUT = 15_000;

	private readonly root: HTMLElement;
	private readonly session = this._register(new MutableDisposable<DisposableStore>());
	private readonly rendered = this._register(new MutableDisposable<DisposableStore>());
	private readonly compositionWaiters = new Set<() => void>();

	private vendor: IBaseHalfCanvasMarkdownInlineVendor | undefined;
	private runtime: IBaseHalfCanvasMarkdownInlineRuntime | undefined;
	private model: ITextModel | undefined;
	private resource: URI | undefined;
	private resourceKey: string | undefined;
	private state: IBaseHalfCardDetailState | undefined;
	private bodyStart = 0;
	private bodyEnd = 0;
	private bodyMarkdown = '';
	private openGeneration = 0;
	private structuralFrozen = false;
	private closeFrozen = false;
	private composing = false;
	private pendingModelRefresh = false;
	private compositionConflict = false;
	private applyingModelEdit = false;
	private saving = false;
	private saveFailed = false;
	private disposed = false;
	private editGroupOpen = false;
	private editGroupTimer: number | undefined;
	private pendingHistoryAction: Promise<void> | undefined;
	private pendingFlush: Promise<boolean> | undefined;
	private pendingPrepareToClose: Promise<boolean> | undefined;

	constructor(
		private readonly container: HTMLElement,
		private readonly onSaveStatusChange: (status: BaseHalfCanvasMarkdownInlineSaveStatus) => void,
		private readonly options: IBaseHalfCanvasMarkdownInlineEditorOptions = {},
		@ITextModelService private readonly textModelService: ITextModelService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IBaseHalfEditorFlushService private readonly editorFlushService: IBaseHalfEditorFlushService,
		@IClipboardService private readonly clipboardService: IClipboardService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.root = append(this.container, $('.basehalf-canvas-markdown-inline.bh-md-preview'));
		this.root.tabIndex = -1;
		this.root.setAttribute('role', 'textbox');
		this.root.setAttribute('aria-multiline', 'true');
		this._register(toDisposable(() => this.root.remove()));
		this._register(addDisposableListener(this.root, EventType.KEY_DOWN, event => this.handleKeyDown(event)));
		this._register(addDisposableListener(this.root, EventType.CLICK, event => this.handleEditableLinkClick(event)));
		this._register(this.textFileService.files.onDidChangeDirty(model => {
			if (this.ownsResource(model.resource)) {
				this.updateStatus();
			}
		}));
		this._register(this.textFileService.files.onDidChangeReadonly(model => {
			if (this.ownsResource(model.resource)) {
				this.updateRuntimeReadOnly();
				this.updateStatus();
			}
		}));
		this._register(this.textFileService.files.onDidSaveError(model => {
			if (this.ownsResource(model.resource)) {
				this.updateStatus();
			}
		}));
		this._register(this.textFileService.files.onDidSave(event => {
			if (this.ownsResource(event.model.resource)) {
				this.updateStatus();
			}
		}));
		this._register(this.textFileService.files.onDidRevert(model => {
			if (this.ownsResource(model.resource)) {
				this.updateRuntimeReadOnly();
				this.updateStatus();
			}
		}));
		this.setSaveStatus('saving');
	}

	async open(state: IBaseHalfCardDetailState, point?: IBaseHalfCanvasNoteEditPoint, selection?: IBaseHalfCanvasMarkdownInlineSelection): Promise<void> {
		if (this.disposed) {
			throw new Error('The Canvas Markdown inline editor has been disposed.');
		}
		const generation = ++this.openGeneration;
		this.finishEditGroup();
		this.settleCompositionWaiters();
		this.state = state;
		this.resource = state.resource;
		this.resourceKey = state.resource.toString();
		this.closeFrozen = false;
		this.saveFailed = false;
		this.compositionConflict = false;
		delete this.root.dataset.compositionConflict;
		this.root.removeAttribute('title');
		this.pendingFlush = undefined;
		this.pendingPrepareToClose = undefined;
		this.root.setAttribute('aria-label', `Quick edit ${state.relativePath}`);
		this.setSaveStatus('saving');

		const session = new DisposableStore();
		this.session.value = session;
		try {
			const modelReference = await this.textModelService.createModelReference(state.resource);
			if (!this.isOpenCurrent(generation, state.resource)) {
				modelReference.dispose();
				return;
			}
			session.add(modelReference);
			const [vendor] = await Promise.all([
				loadCanvasMarkdownInlineVendor(),
				loadCanvasMarkdownInlineStyles(this.root.ownerDocument)
			]);
			if (!this.isOpenCurrent(generation, state.resource)) {
				return;
			}
			this.vendor = vendor;
			this.model = modelReference.object.textEditorModel;
			session.add(this.model.onDidChangeContent(event => this.handleModelContentChange(event)));
			session.add(this.editorFlushService.registerDocumentFlusher(this.resourceKey, options => this.flush(options)));
			if (!this.renderDocument({ point, selection })) {
				throw new Error('This Markdown block needs the full editor. Use Expand to edit it.');
			}
			this.updateRuntimeReadOnly();
			this.updateStatus();
			await new Promise<void>(resolve => mainWindow.requestAnimationFrame(() => resolve()));
		} catch (error) {
			if (!this.isOpenCurrent(generation, state.resource)) {
				return;
			}
			if (this.session.value === session) {
				this.session.clear();
			}
			this.model = undefined;
			this.setSaveStatus('error');
			throw error;
		}
	}

	focus(point?: IBaseHalfCanvasNoteEditPoint): void {
		if (this.disposed) {
			return;
		}
		if (this.compositionConflict) {
			this.runtime?.focus();
			return;
		}
		const clientPoint = point ? this.toClientPoint(point) : undefined;
		if (clientPoint && this.runtime) {
			this.runtime.focusAtPoint(clientPoint.x, clientPoint.y);
			return;
		}
		if (this.runtime) {
			this.runtime.focus();
		} else {
			this.root.focus({ preventScroll: true });
		}
		this.options.onEditorFocus?.();
	}

	hasFocus(): boolean {
		const active = this.root.ownerDocument.activeElement;
		return active === this.root || (!!active && this.root.contains(active));
	}

	canUndo(): boolean {
		return this.model?.canUndo() ?? false;
	}

	canRedo(): boolean {
		return this.model?.canRedo() ?? false;
	}

	undo(): Promise<void> {
		return this.runHistoryAction('undo');
	}

	redo(): Promise<void> {
		return this.runHistoryAction('redo');
	}

	setStructuralFrozen(frozen: boolean): void {
		if (this.disposed || this.structuralFrozen === frozen) {
			return;
		}
		this.structuralFrozen = frozen;
		this.updateRuntimeReadOnly();
		this.updateStatus();
	}

	flush(options: IBaseHalfEditorFlushOptions = {}): Promise<boolean> {
		if (this.pendingFlush) {
			return this.pendingFlush;
		}
		const pending = this.doFlush(options);
		this.pendingFlush = pending;
		void pending.finally(() => {
			if (this.pendingFlush === pending) {
				this.pendingFlush = undefined;
			}
		});
		return pending;
	}

	prepareToClose(): Promise<boolean> {
		if (!this.pendingPrepareToClose) {
			const pending = this.doPrepareToClose();
			this.pendingPrepareToClose = pending;
			void pending.then(ok => {
				if (!ok && this.pendingPrepareToClose === pending) {
					this.pendingPrepareToClose = undefined;
					this.closeFrozen = false;
					this.updateRuntimeReadOnly();
				}
			}, () => {
				if (this.pendingPrepareToClose === pending) {
					this.pendingPrepareToClose = undefined;
					this.closeFrozen = false;
					this.updateRuntimeReadOnly();
				}
			});
		}
		return this.pendingPrepareToClose;
	}

	/** The authoritative working-copy text used for an atomic preview reveal. */
	getDocumentText(): string | undefined {
		return this.model?.getValue();
	}

	getScrollTop(): number {
		return this.root.scrollTop;
	}

	setScrollTop(scrollTop: number): void {
		if (!this.disposed && Number.isFinite(scrollTop)) {
			this.root.scrollTop = Math.max(0, scrollTop);
		}
	}

	getSelection(): IBaseHalfCanvasMarkdownInlineSelection | undefined {
		return this.runtime?.getSelection();
	}

	getFormatState(): IBaseHalfCanvasNoteFormatState | undefined {
		return this.runtime?.getFormatState();
	}

	async runFormatCommand(command: BaseHalfMarkdownFormatCommand): Promise<boolean> {
		if (this.disposed || this.compositionConflict) {
			return false;
		}
		await this.waitForHistorySettled();
		await this.waitForCompositionSettled();
		if (this.disposed || this.compositionConflict || this.isReadOnly()) {
			return false;
		}
		this.finishEditGroup();
		const handled = this.runtime?.runFormatCommand(command) ?? false;
		if (handled) {
			// The runtime reports its source splice synchronously. Close that edit
			// group immediately so one toolbar action is exactly one TextModel undo.
			this.finishEditGroup();
			this.options.onEditorFocus?.();
		}
		return handled;
	}

	async copyDocument(): Promise<void> {
		const text = this.model?.getValue();
		if (text === undefined) {
			throw new Error('The Markdown document is not ready to copy.');
		}
		await this.clipboardService.writeText(text);
	}

	override dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.openGeneration++;
		this.finishEditGroup();
		this.settleCompositionWaiters();
		this.runtime = undefined;
		this.model = undefined;
		super.dispose();
	}

	private renderDocument(options: {
		readonly point?: IBaseHalfCanvasNoteEditPoint;
		readonly clientPoint?: { readonly x: number; readonly y: number };
		readonly selection?: IBaseHalfCanvasMarkdownInlineSelection;
		readonly focus?: boolean;
	} = {}): boolean {
		if (this.compositionConflict && this.runtime) {
			return true;
		}
		const model = this.model;
		const vendor = this.vendor;
		const state = this.state;
		if (!model || !vendor || !state) {
			return false;
		}
		const scrollTop = this.root.scrollTop;
		this.rendered.clear();
		this.runtime = undefined;
		this.root.replaceChildren();
		const renderStore = new DisposableStore();
		this.rendered.value = renderStore;
		const seedRendering = new DisposableStore();
		renderStore.add(seedRendering);

		const content = model.getValue();
		const { frontmatter, body } = splitBaseHalfMarkdownFrontmatter(content);
		this.bodyStart = frontmatter.length;
		this.bodyEnd = content.length;
		this.bodyMarkdown = body;
		const referenceDefinitions = collectBaseHalfCanvasMarkdownReferenceDefinitions(body);
		const segments = segmentBaseHalfMarkdownTopLevelBody(body);
		const sourceSegments = segments.length > 0 ? segments : [{ source: '', raw: '', prefix: '', sep: '' }];
		const units: IBaseHalfCanvasMarkdownRenderedUnit[] = [];
		for (let index = 0; index < sourceSegments.length; index++) {
			const segment = sourceSegments[index];
			// Keep inter-block whitespace with the following source tile. When
			// Backspace/Delete joins two document blocks, ProseMirror keeps the
			// leading wrapper and removes the following wrapper; this ownership
			// model removes the joined boundary while preserving the whitespace
			// after the final joined block byte-for-byte.
			const prefix = index === 0
				? segment.prefix
				: `${sourceSegments[index - 1].sep}${segment.prefix}`;
			const separator = index === sourceSegments.length - 1 ? segment.sep : '';
			const element = append(this.root, $('.basehalf-canvas-markdown-inline-unit'));
			const supported = vendor.canEditCanvasMarkdownUnit(segment.source);
			const unit: IBaseHalfCanvasMarkdownRenderedUnit = {
				element,
				supported,
				markdown: segment.source,
				prefix,
				separator
			};
			units.push(unit);
			if (!supported) {
				element.classList.add('unsupported');
				element.title = 'Use Expand to edit this Markdown block.';
			}
			this.renderStaticUnit(element, segment.source, state, seedRendering, referenceDefinitions);
		}

		const clientPoint = options.clientPoint ?? (options.point ? this.toClientPoint(options.point) : undefined);
		const target = clientPoint ? this.unitAtClientPoint(units, clientPoint.x, clientPoint.y) : units.find(unit => unit.supported);
		if (!target || !target.supported) {
			return false;
		}
		const runtime = vendor.createCanvasMarkdownInlineEditor(this.root, {
			markdown: body,
			units: units.map((unit, index) => ({
				id: String(index),
				markdown: unit.markdown,
				prefix: unit.prefix,
				separator: unit.separator,
				editable: unit.supported,
				element: unit.element
			})),
			readOnly: this.isReadOnly(),
			selection: options.selection,
			onMarkdownChange: markdown => this.applyDocumentMarkdown(markdown),
			onCompositionChange: composing => this.handleCompositionChange(composing),
			onUndoRequest: () => void this.undo(),
			onRedoRequest: () => void this.redo(),
			onExitRequest: () => this.options.onCanvasExitRequest?.(),
			onToolbarRequest: () => this.options.onCanvasToolbarRequest?.(),
			onFormatStateChange: formatState => this.options.onFormatStateChange?.(formatState)
		});
		seedRendering.clear();
		this.runtime = runtime;
		renderStore.add(toDisposable(() => runtime.destroy()));
		const editable = this.root.querySelector<HTMLElement>(':scope > .ProseMirror');
		editable?.setAttribute('aria-label', `Edit ${state.relativePath}`);
		this.root.scrollTop = scrollTop;
		if (options.focus) {
			if (clientPoint && this.runtime) {
				this.runtime.focusAtPoint(clientPoint.x, clientPoint.y);
			} else {
				this.focus();
			}
		}
		return true;
	}

	private renderStaticUnit(
		container: HTMLElement,
		source: string,
		state: IBaseHalfCardDetailState,
		store: DisposableStore,
		referenceDefinitions: string
	): void {
		if (!source) {
			return;
		}
		const contextualSource = referenceDefinitions ? `${source}\n\n${referenceDefinitions}` : source;
		const markdown = new MarkdownString(contextualSource, { isTrusted: false, supportHtml: false });
		markdown.baseUri = state.resource;
		store.add(renderMarkdown(markdown, {
			actionHandler: href => this.options.onOpenLink?.(href),
			fillInIncompleteTokens: true,
			markedOptions: { gfm: true, breaks: true },
			sanitizerConfig: {
				replaceWithPlaintext: true,
				allowedTags: {
					override: ['a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'hr', 'li', 'ol', 'p', 'pre', 'strong', 'ul']
				}
			}
		}, container));
	}

	private applyDocumentMarkdown(markdown: string): void {
		const model = this.model;
		const finishingComposition = this.composing;
		if (!model || (this.isReadOnly() && !finishingComposition)) {
			return;
		}
		const current = model.getValue().slice(this.bodyStart, this.bodyEnd);
		if (current !== this.bodyMarkdown && finishingComposition) {
			this.enterCompositionConflict();
			return;
		} else if (current !== this.bodyMarkdown) {
			this.pendingModelRefresh = true;
			queueMicrotask(() => this.refreshAfterModelChange());
			return;
		}
		const edit = computeBaseHalfCanvasMarkdownTextEdit(current, markdown);
		if (!edit) {
			return;
		}
		if (!this.editGroupOpen) {
			model.pushStackElement();
			this.editGroupOpen = true;
		}
		const editStart = this.bodyStart + edit.offset;
		const start = model.getPositionAt(editStart);
		const end = model.getPositionAt(editStart + edit.length);
		const delta = markdown.length - (this.bodyEnd - this.bodyStart);
		this.applyingModelEdit = true;
		try {
			model.pushEditOperations(null, [{
				range: new Range(start.lineNumber, start.column, end.lineNumber, end.column),
				text: edit.text,
				forceMoveMarkers: true
			}], () => null);
		} finally {
			this.applyingModelEdit = false;
		}
		this.bodyMarkdown = markdown;
		this.bodyEnd += delta;
		this.scheduleEditGroupEnd();
		this.updateStatus();
	}

	private handleModelContentChange(event: IModelContentChangedEvent): void {
		if (this.applyingModelEdit || !this.model || !this.vendor) {
			return;
		}
		if (this.compositionConflict) {
			this.updateStatus();
			return;
		}
		if (this.isComposing()) {
			this.bodyStart = transformBaseHalfCanvasMarkdownOffset(this.bodyStart, event.changes, 'before');
			this.bodyEnd = transformBaseHalfCanvasMarkdownOffset(this.bodyEnd, event.changes, 'after');
			this.pendingModelRefresh = true;
			return;
		}
		const selection = this.runtime?.getSelection();
		const focused = this.hasFocus();
		this.renderDocument({ selection, focus: focused });
		this.updateStatus();
	}

	private handleCompositionChange(composing: boolean): void {
		this.composing = composing;
		if (composing) {
			return;
		}
		this.updateRuntimeReadOnly();
		this.settleCompositionWaiters();
		if (this.pendingModelRefresh) {
			queueMicrotask(() => this.refreshAfterModelChange());
		}
	}

	private refreshAfterModelChange(): void {
		if (!this.pendingModelRefresh || this.disposed || this.isComposing() || this.compositionConflict) {
			return;
		}
		this.pendingModelRefresh = false;
		const selection = this.runtime?.getSelection();
		const focused = this.hasFocus();
		this.renderDocument({ selection, focus: focused });
	}

	private enterCompositionConflict(): void {
		if (this.compositionConflict) {
			return;
		}
		this.compositionConflict = true;
		this.pendingModelRefresh = false;
		const message = 'This document changed elsewhere while you were typing. Your draft is preserved below.';
		this.root.dataset.compositionConflict = 'true';
		this.root.title = message;
		const banner = $('.basehalf-canvas-markdown-conflict');
		const label = append(banner, $('span.basehalf-canvas-markdown-conflict-label'));
		label.textContent = message;
		const actions = append(banner, $('.basehalf-canvas-markdown-conflict-actions'));
		const copy = append(actions, $('button.basehalf-canvas-markdown-conflict-action'));
		copy.setAttribute('type', 'button');
		copy.textContent = 'Copy draft';
		const reload = append(actions, $('button.basehalf-canvas-markdown-conflict-action'));
		reload.setAttribute('type', 'button');
		reload.textContent = 'Discard and reload file';
		this.root.prepend(banner);
		const store = this.rendered.value;
		store?.add(addDisposableListener(copy, EventType.CLICK, event => {
			event.preventDefault();
			event.stopPropagation();
			const draft = this.runtime?.getMarkdown();
			if (draft !== undefined) {
				void this.clipboardService.writeText(draft).catch(error => {
					this.logService.error('[BaseHalf] Could not copy the Canvas Markdown conflict draft', error);
				});
			}
		}));
		store?.add(addDisposableListener(reload, EventType.CLICK, event => {
			event.preventDefault();
			event.stopPropagation();
			this.discardCompositionConflict();
		}));
		this.updateRuntimeReadOnly();
		this.updateStatus();
	}

	private discardCompositionConflict(): void {
		if (!this.compositionConflict) {
			return;
		}
		this.compositionConflict = false;
		this.pendingModelRefresh = false;
		delete this.root.dataset.compositionConflict;
		this.root.removeAttribute('title');
		this.renderDocument({ focus: true });
		this.updateRuntimeReadOnly();
		this.updateStatus();
	}

	private handleEditableLinkClick(event: MouseEvent): void {
		if ((!event.metaKey && !event.ctrlKey) || !isHTMLElement(event.target)) {
			return;
		}
		const anchor = event.target.closest<HTMLAnchorElement>('.ProseMirror a[href]');
		const href = anchor?.getAttribute('href');
		if (!anchor || !href || !this.root.contains(anchor)) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		this.options.onOpenLink?.(this.resolveEditableHref(href));
	}

	private resolveEditableHref(href: string): string {
		const resource = this.resource;
		if (!resource) {
			return href;
		}
		try {
			const parsed = URI.parse(href);
			if (parsed.scheme) {
				return parsed.toString(true);
			}
			return joinPath(dirname(resource), parsed.path).with({ query: parsed.query, fragment: parsed.fragment }).toString(true);
		} catch {
			return href;
		}
	}

	private handleKeyDown(event: KeyboardEvent): void {
		if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 's') {
			event.preventDefault();
			event.stopPropagation();
			const save = this.flush({ forceSerialize: true, forceWrite: false });
			try {
				this.options.onSaveRequest?.(save);
			} catch (error) {
				this.logService.error('[BaseHalf] Canvas Markdown inline save callback failed', error);
			}
			return;
		}
		if (event.isComposing || event.keyCode === 229 || this.isComposing()) {
			return;
		}
		if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey && event.key === 'F10' && !event.defaultPrevented) {
			event.preventDefault();
			event.stopPropagation();
			this.options.onCanvasToolbarRequest?.();
			return;
		}
		if (event.key === 'Escape' && !event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.defaultPrevented) {
			event.preventDefault();
			event.stopPropagation();
			this.options.onCanvasExitRequest?.();
		}
	}

	private toClientPoint(point: IBaseHalfCanvasNoteEditPoint): { readonly x: number; readonly y: number } | undefined {
		const body = this.root.closest<HTMLElement>('.basehalf-canvas-card-body');
		if (!body || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
			return undefined;
		}
		const bounds = body.getBoundingClientRect();
		if (bounds.width <= 0 || bounds.height <= 0 || body.clientWidth <= 0 || body.clientHeight <= 0) {
			return undefined;
		}
		return {
			x: bounds.left + point.x * bounds.width / body.clientWidth,
			y: bounds.top + point.y * bounds.height / body.clientHeight
		};
	}

	private unitAtClientPoint(units: readonly IBaseHalfCanvasMarkdownRenderedUnit[], x: number, y: number): IBaseHalfCanvasMarkdownRenderedUnit | undefined {
		let nearest: { readonly unit: IBaseHalfCanvasMarkdownRenderedUnit; readonly distance: number } | undefined;
		for (const unit of units) {
			const bounds = unit.element.getBoundingClientRect();
			const dx = x < bounds.left ? bounds.left - x : x > bounds.right ? x - bounds.right : 0;
			const dy = y < bounds.top ? bounds.top - y : y > bounds.bottom ? y - bounds.bottom : 0;
			const distance = dx * dx + dy * dy;
			if (!nearest || distance < nearest.distance) {
				nearest = { unit, distance };
			}
		}
		return nearest?.unit;
	}

	private scheduleEditGroupEnd(): void {
		if (this.editGroupTimer !== undefined) {
			mainWindow.clearTimeout(this.editGroupTimer);
		}
		this.editGroupTimer = mainWindow.setTimeout(() => {
			this.editGroupTimer = undefined;
			this.finishEditGroup();
		}, CANVAS_MARKDOWN_INLINE_EDIT_GROUP_DELAY);
	}

	private finishEditGroup(): void {
		if (this.editGroupTimer !== undefined) {
			mainWindow.clearTimeout(this.editGroupTimer);
			this.editGroupTimer = undefined;
		}
		if (this.editGroupOpen) {
			this.model?.pushStackElement();
			this.editGroupOpen = false;
		}
	}

	private async doPrepareToClose(): Promise<boolean> {
		await this.waitForHistorySettled();
		this.closeFrozen = true;
		this.updateRuntimeReadOnly();
		await this.waitForCompositionSettled();
		this.finishEditGroup();
		return this.flush({
			forceSerialize: true,
			forceWrite: false,
			rejectOnError: true,
			structural: true
		});
	}

	private async doFlush(options: IBaseHalfEditorFlushOptions): Promise<boolean> {
		await this.waitForHistorySettled();
		await this.waitForCompositionSettled();
		this.finishEditGroup();
		const resource = this.resource;
		if (!resource) {
			this.updateStatus();
			return true;
		}
		if (options.structural && !this.structuralFrozen && !this.closeFrozen) {
			this.updateStatus();
			return false;
		}
		if (this.compositionConflict || this.hasUnsavableState(resource)) {
			this.updateStatus();
			return false;
		}
		if (!this.textFileService.isDirty(resource)) {
			this.updateStatus();
			return true;
		}
		if (this.isReadonlyResource(resource)) {
			this.updateStatus();
			return false;
		}
		this.saving = true;
		this.saveFailed = false;
		this.setSaveStatus('saving');
		try {
			const savedResource = await this.textFileService.save(resource);
			if ((!savedResource && this.textFileService.isDirty(resource)) || this.hasUnsavableState(resource)) {
				this.saveFailed = true;
				return false;
			}
			const clean = await this.waitForClean(resource);
			this.saveFailed = !clean;
			return clean;
		} catch (error) {
			this.saveFailed = true;
			this.logService.error('[BaseHalf] Canvas Markdown inline save failed', error);
			return false;
		} finally {
			this.saving = false;
			this.updateStatus();
		}
	}

	private runHistoryAction(action: 'undo' | 'redo'): Promise<void> {
		const previousHistory = this.pendingHistoryAction;
		// Capture only a save that already existed when the history request was
		// made. A later close/flush waits for this history action instead. This
		// establishes one direction through the lifecycle queue and avoids both a
		// save/undo race and a circular wait.
		const previousFlush = this.pendingFlush;
		const pending = (previousHistory ?? Promise.resolve()).then(async () => {
			if (previousFlush) {
				await previousFlush;
			}
			await this.waitForCompositionSettled();
			const model = this.model;
			const available = action === 'undo' ? model?.canUndo() : model?.canRedo();
			if (!model || !available || this.isReadOnly()) {
				return;
			}
			this.finishEditGroup();
			if (action === 'undo') {
				await model.undo();
			} else {
				await model.redo();
			}
		});
		this.pendingHistoryAction = pending;
		void pending.then(
			() => {
				if (this.pendingHistoryAction === pending) {
					this.pendingHistoryAction = undefined;
				}
			},
			() => {
				if (this.pendingHistoryAction === pending) {
					this.pendingHistoryAction = undefined;
				}
			}
		);
		return pending;
	}

	private async waitForHistorySettled(): Promise<void> {
		while (this.pendingHistoryAction) {
			await this.pendingHistoryAction;
		}
	}

	private async waitForCompositionSettled(): Promise<void> {
		while (!this.disposed && this.isComposing()) {
			await new Promise<void>(resolve => {
				let settled = false;
				const settle = () => {
					if (settled) {
						return;
					}
					settled = true;
					this.compositionWaiters.delete(settle);
					resolve();
				};
				this.compositionWaiters.add(settle);
				if (!this.isComposing()) {
					settle();
				}
			});
		}
	}

	private isComposing(): boolean {
		return this.composing || this.runtime?.isComposing() === true;
	}

	private settleCompositionWaiters(): void {
		const waiters = [...this.compositionWaiters];
		this.compositionWaiters.clear();
		for (const settle of waiters) {
			settle();
		}
	}

	private waitForClean(resource: URI): Promise<boolean> {
		if (!this.textFileService.isDirty(resource)) {
			return Promise.resolve(true);
		}
		return new Promise<boolean>(resolve => {
			let settled = false;
			const disposables = new DisposableStore();
			const settle = (value: boolean) => {
				if (settled) {
					return;
				}
				settled = true;
				disposables.dispose();
				resolve(value);
			};
			const timer = mainWindow.setTimeout(() => settle(!this.textFileService.isDirty(resource)), BaseHalfCanvasMarkdownInlineEditor.SAVE_SETTLE_TIMEOUT);
			disposables.add(toDisposable(() => mainWindow.clearTimeout(timer)));
			disposables.add(this.textFileService.files.onDidChangeDirty(model => {
				if (isEqual(model.resource, resource) && !model.isDirty()) {
					settle(true);
				}
			}));
			disposables.add(this.textFileService.files.onDidSaveError(model => {
				if (isEqual(model.resource, resource)) {
					settle(false);
				}
			}));
			if (this.hasUnsavableState(resource)) {
				settle(false);
			} else if (!this.textFileService.isDirty(resource)) {
				settle(true);
			}
		});
	}

	private updateRuntimeReadOnly(): void {
		if (!this.runtime || (this.isReadOnly() && this.isComposing())) {
			return;
		}
		this.runtime.setReadOnly(this.isReadOnly());
	}

	private isReadOnly(): boolean {
		return this.compositionConflict || this.structuralFrozen || this.closeFrozen || (!!this.resource && this.isReadonlyResource(this.resource));
	}

	private updateStatus(): void {
		const resource = this.resource;
		if (!resource) {
			this.setSaveStatus('saving');
			return;
		}
		const dirty = this.textFileService.isDirty(resource);
		if (this.compositionConflict || this.saveFailed || this.hasUnsavableState(resource) || (dirty && this.isReadonlyResource(resource))) {
			this.setSaveStatus('error');
			return;
		}
		if (this.saving || dirty) {
			this.setSaveStatus('saving');
			return;
		}
		this.setSaveStatus('saved');
	}

	private setSaveStatus(status: BaseHalfCanvasMarkdownInlineSaveStatus): void {
		if (!this.disposed) {
			this.onSaveStatusChange(status);
			this.options.onSaveStatusChange?.(status);
		}
	}

	private ownsResource(resource: URI): boolean {
		return !!this.resource && isEqual(this.resource, resource);
	}

	private isReadonlyResource(resource: URI): boolean {
		return !!this.textFileService.files.get(resource)?.isReadonly();
	}

	private hasUnsavableState(resource: URI): boolean {
		const model = this.textFileService.files.get(resource);
		return !!model && (model.hasState(TextFileEditorModelState.CONFLICT) || model.hasState(TextFileEditorModelState.ERROR));
	}

	private isOpenCurrent(generation: number, resource: URI): boolean {
		return !this.disposed && generation === this.openGeneration && this.resourceKey === resource.toString();
	}
}
