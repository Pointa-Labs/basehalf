/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, append, addDisposableListener, clearNode } from '../../../../../base/browser/dom.js';
import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { Disposable, DisposableStore, IReference, MutableDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { IAttachedView, ITextModel } from '../../../../../editor/common/model.js';
import { IResolvedTextEditorModel } from '../../../../../editor/common/services/resolverService.js';
import { BASEHALF_CANVAS_SIDEWAYS_BOX_CLASS } from '../../../canvas/common/basehalfCanvasWheelGesture.js';
import { IBaseHalfCanvasCodeFace } from '../../../canvas/browser/basehalfCanvasExtensions.js';
import { IBaseHalfCanvasCodePreview } from '../../../canvas/common/basehalfCanvasCardPreview.js';
import { IBaseHalfCodePreviewPiece, baseHalfCodePiecesOfLine } from '../../../canvas/common/basehalfCanvasCodePreview.js';
import { IBaseHalfFilePlace } from '../../../cardDetail/common/basehalfFilePlaces.js';
import {
	BASEHALF_CODE_CARD_LARGEST_FILE_BYTES,
	BASEHALF_CODE_FACE_FONT_SIZE,
	BASEHALF_CODE_FACE_GUTTER_START,
	BASEHALF_CODE_FACE_LINE_HEIGHT,
	BASEHALF_CODE_FACE_LINE_LENGTH_LIMIT,
	BASEHALF_CODE_FACE_LINES_AROUND_A_SCROLL,
	BASEHALF_CODE_FACE_LOWEST_SCROLLING_ZOOM,
	BASEHALF_CODE_FACE_MARK_LANE,
	BASEHALF_CODE_FACE_NO_MARKS,
	baseHalfCodeFaceContentHeight,
	baseHalfCodeFaceDigits,
	baseHalfCodeFaceEstimatedLines,
	baseHalfCodeFaceLineAt,
	baseHalfCodeFaceLinesInView,
	baseHalfCodeFaceScrollTopOfLine,
	baseHalfCodeFaceTickBox,
	baseHalfCodeFaceTopOfLine,
	IBaseHalfCodeFaceMarks
} from '../common/basehalfCanvasCodeFaceLayout.js';

/** How long the view stays in the ruler after lines stop moving (code cards, rule 8). */
const RULER_FADES_AFTER_MS = 800;
/** A scroll in Card Detail is many small moves, and the card under it needs only the last. */
const PLACE_SETTLES_MS = 60;

/** What a face needs of the feature that holds the faces of a window. */
export interface IBaseHalfCanvasCodeFaceHost {
	/** The file's text model, for as long as the face keeps the reference. */
	acquireModel(resource: URI): Promise<IReference<IResolvedTextEditorModel> | undefined>;
	/** The face took its model or used it: faces beyond the limit let theirs go, those used longest ago first. */
	didUseModel(face: BaseHalfCanvasCodeFace): void;
	/** The colored first `count` lines of what the card read of the file. */
	headLines(preview: IBaseHalfCanvasCodePreview, count: number): readonly (readonly IBaseHalfCodePreviewPiece[])[] | undefined;
	placeOf(resource: URI): IBaseHalfFilePlace | undefined;
	setPlace(resource: URI, line: number, from: object): void;
	onDidChangePlace(resource: URI, listener: () => void, from: object): { dispose(): void };
	readonly fontFamily: string;
	readonly digitWidth: number;
}

interface IDrawnLine {
	readonly number: HTMLElement;
	readonly text: HTMLElement;
	/** Whether it shows colors it can keep, or waits for them. */
	colored: boolean;
}

/**
 * What a code card draws at rest (code cards, "The face"): the lines in view of a tall
 * scrolled box, with numbers beside them, and a ruler over its edge. It is a drawing. No
 * editor runs, and a text model comes only with a gesture, a place, or marks.
 */
export class BaseHalfCanvasCodeFace extends Disposable implements IBaseHalfCanvasCodeFace {
	readonly scrollableContent: HTMLElement;

	private readonly spacer: HTMLElement;
	private readonly gutter: HTMLElement;
	private readonly text: HTMLElement;
	private readonly sidewaysRoom: HTMLElement;
	private readonly ruler: HTMLElement;
	private readonly rulerView: HTMLElement;
	private readonly drawn = new Map<number, IDrawnLine>();
	private readonly marksDrawn: HTMLElement[] = [];
	private readonly ticksDrawn: HTMLElement[] = [];
	private readonly modelStore = this._register(new MutableDisposable<DisposableStore>());
	private readonly rulerFades = this._register(new RunOnceScheduler(() => this.ruler.classList.remove('moving'), RULER_FADES_AFTER_MS));
	private readonly placeSettles = this._register(new RunOnceScheduler(() => this.goToPlace(), PLACE_SETTLES_MS));

	private model: ITextModel | undefined;
	private attachedView: IAttachedView | undefined;
	private modelAsked: Promise<ITextModel | undefined> | undefined;
	/** The whole file is not read: it is too large, or could not be read as text. */
	private keepsHead: boolean;
	private marks: IBaseHalfCodeFaceMarks = BASEHALF_CODE_FACE_NO_MARKS;
	private digits = 0;
	private lastCount = 0;
	private linesOfLastModel = 0;
	private spacerHeight = -1;
	/** A line past what was read, where the face stands until its model can draw it. */
	private lineAwaited: number | undefined;
	/** Where something other than a gesture left the lines: that moves no place. */
	private settledAt: number | undefined;
	private hasScrolled = false;

	constructor(
		readonly container: HTMLElement,
		readonly path: string,
		readonly resource: URI,
		private size: number | undefined,
		private preview: IBaseHalfCanvasCodePreview,
		readonly host: IBaseHalfCanvasCodeFaceHost
	) {
		super();
		this.keepsHead = (size ?? 0) > BASEHALF_CODE_CARD_LARGEST_FILE_BYTES;
		container.style.setProperty('--basehalf-code-font', host.fontFamily);
		container.style.tabSize = String(preview.tabSize);
		this.scrollableContent = append(container, $('.basehalf-canvas-code-scroller'));
		// A gesture on a face below this zoom moves the canvas (code cards, rule 7).
		this.scrollableContent.dataset.basehalfLowestScrollingZoom = String(BASEHALF_CODE_FACE_LOWEST_SCROLLING_ZOOM);
		this.spacer = append(this.scrollableContent, $('.basehalf-canvas-code-spacer'));
		this.gutter = append(this.spacer, $('.basehalf-canvas-code-gutter'));
		this.text = append(this.spacer, $(`.basehalf-canvas-code-text.${BASEHALF_CANVAS_SIDEWAYS_BOX_CLASS}`));
		this.sidewaysRoom = append(this.text, $('.basehalf-canvas-code-sideways-room'));
		this.ruler = append(container, $('.basehalf-canvas-code-ruler'));
		this.rulerView = append(this.ruler, $('.basehalf-canvas-code-ruler-view'));

		this._register(toDisposable(() => this.letModelGo()));
		this._register(addDisposableListener(this.scrollableContent, 'scroll', () => this.onScroll()));
		this._register(addDisposableListener(this.text, 'scroll', () => this.keepSidewaysRoom(this.text.scrollLeft)));
		this._register(host.onDidChangePlace(resource, () => this.placeSettles.schedule(), this));
		const resizeObserver = new ResizeObserver(() => this.setHeight());
		resizeObserver.observe(this.scrollableContent);
		this._register(toDisposable(() => resizeObserver.disconnect()));

		this.layout();
		this.goToPlace();
		this.draw();
	}

	get isDisposed(): boolean {
		return this._store.isDisposed;
	}

	get lineCount(): number {
		return this.model?.getLineCount() ?? Math.max(this.preview.lines.length, this.linesOfLastModel);
	}

	get scrollTop(): number {
		return this.scrollableContent.scrollTop;
	}

	get scrollLeft(): number {
		return this.text.scrollLeft;
	}

	/** Whether the whole file can come into a model. */
	get canHoldModel(): boolean {
		return !this.keepsHead;
	}

	setHeight(): void {
		this.layout();
		// A face that had no height could not stand at its place yet.
		this.goToPlace();
		this.draw();
	}

	/** The setting of the font changed. */
	fontChanged(): void {
		this.container.style.setProperty('--basehalf-code-font', this.host.fontFamily);
		this.digits = 0;
		this.layout();
	}

	setPreview(preview: IBaseHalfCanvasCodePreview, size: number | undefined): void {
		if (preview === this.preview) {
			return;
		}
		this.preview = preview;
		this.size = size;
		if (!this.model) {
			this.keepsHead = (size ?? 0) > BASEHALF_CODE_CARD_LARGEST_FILE_BYTES;
			this.container.style.tabSize = String(preview.tabSize);
			this.layout();
			this.redraw();
		}
	}

	redraw(): void {
		for (const line of [...this.drawn.keys()]) {
			this.removeLine(line);
		}
		this.draw();
	}

	/** The editor of the card goes away and leaves its place here. */
	standAt(scrollTop: number, scrollLeft: number): void {
		const before = this.scrollTop;
		this.layout();
		this.scrollableContent.scrollTop = scrollTop;
		this.settle();
		this.keepSidewaysRoom(scrollLeft);
		this.text.scrollLeft = scrollLeft;
		this.redraw();
		if (this.scrollTop !== before) {
			this.host.setPlace(this.resource, baseHalfCodeFaceLineAt(this.scrollTop), this);
		}
	}

	setMarks(marks: IBaseHalfCodeFaceMarks): void {
		this.marks = marks;
		this.drawMarks();
		this.drawTicks();
	}

	/** The text model of the file, which comes once. Nothing while the file is too large or is not text. */
	ensureModel(): Promise<ITextModel | undefined> {
		if (this.model) {
			return Promise.resolve(this.model);
		}
		if (this.keepsHead || this._store.isDisposed) {
			return Promise.resolve(undefined);
		}
		this.modelAsked ??= this.takeModel();
		return this.modelAsked;
	}

	/** Lets the model go, for a face that was used longest ago. What it drew and where it stands stay until it is used again. */
	letModelGo(): void {
		if (this.model) {
			this.linesOfLastModel = this.model.getLineCount();
		}
		if (this.model && this.attachedView) {
			this.model.onBeforeDetached(this.attachedView);
		}
		this.attachedView = undefined;
		this.model = undefined;
		this.modelAsked = undefined;
		this.modelStore.clear();
	}

	private async takeModel(): Promise<ITextModel | undefined> {
		const reference = await this.host.acquireModel(this.resource);
		if (!reference) {
			this.keepsHead = true;
			this.modelAsked = undefined;
			this.lineAwaited = undefined;
			this.layout();
			this.goToPlace();
			this.draw();
			return undefined;
		}
		if (this._store.isDisposed) {
			reference.dispose();
			return undefined;
		}
		const store = new DisposableStore();
		store.add(reference);
		const model = reference.object.textEditorModel;
		this.modelStore.value = store;
		this.model = model;
		this.lineAwaited = undefined;
		store.add(model.onDidChangeContent(() => {
			this.layout();
			this.redraw();
		}));
		store.add(model.onDidChangeTokens(event => {
			const shown = baseHalfCodeFaceLinesInView(this.scrollTop, this.scrollableContent.clientHeight, this.lineCount);
			if (event.ranges.some(range => range.fromLineNumber <= shown.last && range.toLineNumber >= shown.first)) {
				this.redrawColors();
			}
		}));
		store.add(model.onDidChangeOptions(() => {
			this.container.style.tabSize = String(model.getOptions().tabSize);
		}));
		this.container.style.tabSize = String(model.getOptions().tabSize);
		this.host.didUseModel(this);
		this.layout();
		this.goToPlace();
		this.redraw();
		return model;
	}

	private onScroll(): void {
		const top = this.scrollTop;
		const gesture = top !== this.settledAt;
		if (gesture) {
			this.settledAt = undefined;
			this.hasScrolled = true;
		}
		this.draw();
		this.drawRulerView();
		if (!gesture) {
			return;
		}
		this.ruler.classList.add('moving');
		this.rulerFades.schedule();
		this.host.setPlace(this.resource, baseHalfCodeFaceLineAt(top), this);
		if (this.model) {
			this.host.didUseModel(this);
		} else if (!this.keepsHead) {
			void this.ensureModel();
		}
	}

	/**
	 * The lines stand where they stand now by something other than a gesture: a place that came
	 * from another view or a drawing, or a file that became shorter. The file's place stays as it was.
	 */
	private settle(): void {
		this.settledAt = this.scrollableContent.scrollTop;
	}

	/** Lines that go out of view do not take the sideways position with them, as in an editor. */
	private keepSidewaysRoom(scrollLeft: number): void {
		this.sidewaysRoom.style.width = scrollLeft > 0 ? `${scrollLeft + this.text.clientWidth}px` : '';
	}

	/** Comes to the file's place: this card's own after a drawing, or what another view read. */
	private goToPlace(): void {
		const place = this.host.placeOf(this.resource);
		if (!place) {
			if (baseHalfCodeFaceLineAt(this.scrollTop) !== 1) {
				this.scrollableContent.scrollTop = 0;
				this.settle();
			}
			return;
		}
		// What was read stands a little below the top of a card, which shows far fewer lines than the view it was read in.
		const line = place.focus !== undefined ? Math.max(1, place.focus - 2) : place.top;
		if (baseHalfCodeFaceLineAt(this.scrollTop) === line) {
			return;
		}
		if (line > this.lineCount && !this.model && !this.keepsHead) {
			this.lineAwaited = line;
			void this.ensureModel();
		}
		this.layout();
		this.scrollableContent.scrollTop = baseHalfCodeFaceScrollTopOfLine(line);
		this.settle();
		this.draw();
		this.drawRulerView();
	}

	/** The height of what scrolls and the width of the gutter, from what is known of the file. */
	private layout(): void {
		const count = this.lineCount;
		// A file with more than was read scrolls on, so that a gesture can ask for the rest.
		const knownHeight = baseHalfCodeFaceContentHeight(count);
		const clientHeight = this.scrollableContent.clientHeight;
		const expectsMore = !this.model && !this.keepsHead && !this.preview.wholeFile;
		const height = Math.max(
			knownHeight,
			expectsMore ? clientHeight + 2 * BASEHALF_CODE_FACE_LINE_HEIGHT : 0,
			this.lineAwaited !== undefined ? baseHalfCodeFaceTopOfLine(this.lineAwaited) + clientHeight : 0
		);
		if (height !== this.spacerHeight) {
			this.spacerHeight = height;
			this.spacer.style.height = `${height}px`;
			this.settle();
		}
		const estimate = this.model ? count : baseHalfCodeFaceEstimatedLines(count, this.preview.text.length, this.preview.wholeFile, this.size);
		const digits = baseHalfCodeFaceDigits(estimate);
		if (digits !== this.digits) {
			this.digits = digits;
			const numbers = Math.round(digits * this.host.digitWidth);
			this.container.style.setProperty('--basehalf-code-numbers', `${numbers}px`);
			this.container.style.setProperty('--basehalf-code-gutter', `${BASEHALF_CODE_FACE_GUTTER_START + numbers + BASEHALF_CODE_FACE_MARK_LANE}px`);
		}
		if (count !== this.lastCount) {
			this.lastCount = count;
			this.drawTicks();
			this.drawRulerView();
		}
	}

	private draw(): void {
		const clientHeight = this.scrollableContent.clientHeight || BASEHALF_CODE_FACE_FONT_SIZE * 20;
		const count = this.lineCount;
		const { first, last } = baseHalfCodeFaceLinesInView(this.scrollTop, clientHeight, count, this.hasScrolled ? BASEHALF_CODE_FACE_LINES_AROUND_A_SCROLL : 0);
		for (const line of [...this.drawn.keys()]) {
			if (line < first || line > last) {
				this.removeLine(line);
			}
		}
		// What moves into view, and what the model holds in view, is what its colors are worked out for first.
		this.attachedViewOf()?.setVisibleLines([{ startLineNumber: Math.max(1, first), endLineNumber: Math.max(1, last) }], true);
		for (let line = first; line <= last; line++) {
			if (!this.drawn.has(line)) {
				this.drawLine(line);
			}
		}
		this.drawMarks();
	}

	private attachedViewOf(): IAttachedView | undefined {
		// A face that only shows marks has no use for the colors of the whole file.
		if (this.model && !this.attachedView && (this.scrollTop > 0 || this.lineCount <= this.preview.lines.length)) {
			this.attachedView = this.model.onBeforeAttached();
		}
		return this.attachedView;
	}

	private drawLine(line: number): void {
		const top = `${baseHalfCodeFaceTopOfLine(line)}px`;
		const number = append(this.gutter, $('.basehalf-canvas-code-number'));
		number.style.top = top;
		number.textContent = String(line);
		const text = append(this.text, $('.basehalf-canvas-code-line'));
		text.style.top = top;
		const entry: IDrawnLine = { number, text, colored: false };
		this.drawn.set(line, entry);
		this.fillLine(line, entry);
	}

	private fillLine(line: number, entry: IDrawnLine): void {
		const pieces = this.piecesOf(line);
		clearNode(entry.text);
		if (pieces) {
			for (const piece of pieces.pieces) {
				const span = append(entry.text, $('span'));
				span.className = piece.className;
				span.textContent = piece.text;
			}
			entry.colored = pieces.final;
		} else {
			entry.text.textContent = this.plainLine(line);
			entry.colored = false;
		}
	}

	/** The colors of a line: of the model when it has reached the line, of what the card read until then. */
	private piecesOf(line: number): { readonly pieces: readonly IBaseHalfCodePreviewPiece[]; readonly final: boolean } | undefined {
		const model = this.model;
		if (model && line <= model.getLineCount()) {
			if (model.tokenization.hasAccurateTokensForLine(line) || line > this.preview.lines.length) {
				return {
					pieces: baseHalfCodePiecesOfLine(model.getLineContent(line).slice(0, BASEHALF_CODE_FACE_LINE_LENGTH_LIMIT), model.tokenization.getLineTokens(line)),
					final: model.tokenization.hasAccurateTokensForLine(line)
				};
			}
		}
		if (line <= this.preview.lines.length && (!model || model.getLineContent(line).slice(0, BASEHALF_CODE_FACE_LINE_LENGTH_LIMIT) === this.preview.lines[line - 1])) {
			const known = this.host.headLines(this.preview, line)?.[line - 1];
			return known ? { pieces: known, final: !model } : undefined;
		}
		return undefined;
	}

	private plainLine(line: number): string {
		if (this.model) {
			return line <= this.model.getLineCount() ? this.model.getLineContent(line).slice(0, BASEHALF_CODE_FACE_LINE_LENGTH_LIMIT) : '';
		}
		return this.preview.lines[line - 1] ?? '';
	}

	private redrawColors(): void {
		for (const [line, entry] of this.drawn) {
			if (!entry.colored) {
				this.fillLine(line, entry);
			}
		}
	}

	private removeLine(line: number): void {
		const entry = this.drawn.get(line);
		entry?.number.remove();
		entry?.text.remove();
		this.drawn.delete(line);
	}

	private drawMarks(): void {
		for (const mark of this.marksDrawn.splice(0)) {
			mark.remove();
		}
		if (this.marks === BASEHALF_CODE_FACE_NO_MARKS) {
			return;
		}
		for (const line of this.drawn.keys()) {
			const kind = this.marks.lines.get(line);
			if (kind) {
				this.drawMark(kind, baseHalfCodeFaceTopOfLine(line));
			}
			if (this.marks.deletedAfter.has(line)) {
				this.drawMark('deleted', baseHalfCodeFaceTopOfLine(line + 1));
			}
		}
		if (this.marks.deletedAfter.has(0) && this.drawn.has(1)) {
			this.drawMark('deleted', baseHalfCodeFaceTopOfLine(1));
		}
	}

	private drawMark(kind: string, top: number): void {
		const mark = append(this.gutter, $(`.basehalf-canvas-code-mark.${kind}`));
		mark.style.top = `${top}px`;
		this.marksDrawn.push(mark);
	}

	private drawTicks(): void {
		const count = Math.max(1, this.lineCount);
		for (const tick of this.ticksDrawn.splice(0)) {
			tick.remove();
		}
		for (const tick of this.marks.ticks) {
			const box = baseHalfCodeFaceTickBox(tick, count);
			const element = append(this.ruler, $(`.basehalf-canvas-code-tick.${tick.kind}`));
			element.style.setProperty('--basehalf-code-ruler-top', `${box.top * 100}%`);
			element.style.height = `${box.height * 100}%`;
			this.ticksDrawn.push(element);
		}
	}

	private drawRulerView(): void {
		const scrollHeight = this.scrollableContent.scrollHeight || 1;
		this.rulerView.style.setProperty('--basehalf-code-ruler-top', `${this.scrollTop / scrollHeight * 100}%`);
		this.rulerView.style.height = `${this.scrollableContent.clientHeight / scrollHeight * 100}%`;
	}

	/** The width of a digit in the font of a face, for its gutter. */
	static measureDigitWidth(reference: HTMLElement, fontFamily: string): number {
		const context = reference.ownerDocument.createElement('canvas').getContext('2d');
		if (!context) {
			return 7.2;
		}
		context.font = `${BASEHALF_CODE_FACE_FONT_SIZE}px ${fontFamily}`;
		return context.measureText('0').width || 7.2;
	}
}
