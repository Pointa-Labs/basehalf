/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The PDF reader of Card Detail (PDFs and books, "The reader" and "The PDF
// reader"): BaseHalf's own reader on the engine and the headless parts of
// EmbedPDF, with comments (comments).

import './reader/reader.css';
import './pdfViewer.css';
import { render } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useState } from 'preact/hooks';
import { createPluginRegistration, type PluginRegistry } from '@embedpdf/core';
import { EmbedPDF, useDocumentState } from '@embedpdf/core/preact';
import { usePdfiumEngine } from '@embedpdf/engines/preact';
import { FontCharset, PdfActionType, PdfAnnotationSubtype, PdfErrorCode, type PdfDocumentObject, type PdfLinkAnnoObject, type PdfLinkTarget, type PdfBookmarkObject, type PdfPageGeometry, type Rect } from '@embedpdf/models';
import { BookmarkPlugin, BookmarkPluginPackage } from '@embedpdf/plugin-bookmark/preact';
import { DocumentContent, DocumentManagerPlugin, DocumentManagerPluginPackage } from '@embedpdf/plugin-document-manager/preact';
import { InteractionManagerPluginPackage, PagePointerProvider } from '@embedpdf/plugin-interaction-manager/preact';
import { RenderLayer, RenderPluginPackage } from '@embedpdf/plugin-render/preact';
import { Scroller, ScrollPlugin, ScrollPluginPackage, type PageLayout } from '@embedpdf/plugin-scroll/preact';
import { SearchLayer, SearchPlugin, SearchPluginPackage } from '@embedpdf/plugin-search/preact';
import { rectsWithinSlice, SelectionLayer, SelectionPlugin, SelectionPluginPackage, type SelectionCapability } from '@embedpdf/plugin-selection/preact';
import { ThumbImg, ThumbnailPluginPackage, ThumbnailsPane } from '@embedpdf/plugin-thumbnail/preact';
import { TilingLayer, TilingPluginPackage } from '@embedpdf/plugin-tiling/preact';
import { Viewport, ViewportPluginPackage } from '@embedpdf/plugin-viewport/preact';
import { ZoomGestureWrapper, ZoomMode, ZoomPlugin, ZoomPluginPackage, type ZoomLevel } from '@embedpdf/plugin-zoom/preact';
import { baseHalfPagePinchFromMessage, baseHalfZoomFactor, isBaseHalfZoomWheel, type IBaseHalfZoomDelta } from '../../../src/vs/workbench/basehalf/cardDetail/common/basehalfCardDetailZoom.js';
import { BASEHALF_PDF_AUTOMATIC_ZOOM_MAX, BASEHALF_PDF_SELECTION_TEXT_LIMIT, type BaseHalfPdfZoom, type IBaseHalfPdfSelection } from '../../../src/vs/workbench/basehalf/cardDetail/common/basehalfMediaViewState.js';
import { baseHalfCommentContext, normalizeBaseHalfCommentQuote } from '../../../src/vs/workbench/basehalf/comments/common/basehalfCommentAnchor.js';
import { baseHalfCommentsSetMessage, type BaseHalfCommentStep } from '../../../src/vs/workbench/basehalf/comments/common/basehalfCommentProtocol.js';
import { BASEHALF_COMMENT_DEFAULT_COLOR, baseHalfCommentCut, baseHalfCommentTime, type IBaseHalfComment, isBaseHalfHighlight, newBaseHalfCommentId } from '../../../src/vs/workbench/basehalf/comments/common/basehalfComments.js';
import { baseHalfReaderCommandMessage, normalizeBaseHalfReaderPanelState, type IBaseHalfReaderLabels, type IBaseHalfReaderPanelState } from '../../../src/vs/workbench/basehalf/documents/common/basehalfReaderProtocol.js';
import { PdfCommentStore } from './pdfComments.js';
import { CommentNotes, stackCommentMarks } from './reader/commentNotes.js';
import { ReaderChrome } from './reader/readerChrome.js';
import { ReaderCommentsPanel, type ICommentsPanelItem } from './reader/readerComments.js';
import { element, format, isTextField } from './reader/readerDom.js';
import { ReaderFindBar } from './reader/readerFind.js';
import { installReaderHover } from './reader/readerHover.js';
import { closeReaderMenu, isReaderMenuOpen, openReaderMenu } from './reader/readerMenu.js';
import { observeReaderWidth, ReaderPanel } from './reader/readerPanel.js';
import { ReaderSelectionMenu } from './reader/readerSelectionMenu.js';

interface VsCodeApi {
	postMessage(message: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const DOCUMENT_ID = 'basehalf-document';
const INITIALIZATION_TIMEOUT_MS = 20_000;
/** The longest the reader waits for the picture of the page it opens at before it shows itself anyway. */
const FIRST_PAGE_WAIT_MS = 3_000;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.15;
/** The room the pages keep from the sides of the reader, where the marks of comments stand outside a page (comments, rule 7). */
const VIEWPORT_GAP = 30;
/** How far a mark of a comment stands from the right edge of its page. */
const MARK_GAP = 8;
/** The width of a mark, as comments.css draws it. */
const MARK_SIZE = 14;

function required<T extends HTMLElement>(id: string): T {
	const found = document.getElementById(id);
	if (!found) {
		throw new Error(`BaseHalf PDF reader element '${id}' is missing.`);
	}
	return found as T;
}

const root = required<HTMLElement>('basehalf-reader');
const documentHost = required<HTMLElement>('basehalf-pdf-document');
const status = required<HTMLElement>('basehalf-pdf-status');
const statusMessage = required<HTMLElement>('basehalf-pdf-status-message');
const vscode = acquireVsCodeApi();
const labels = JSON.parse(root.dataset.labels ?? '{}') as IBaseHalfReaderLabels;
const isMac = /Mac/.test(navigator.platform);
const commandKey = isMac ? '⌘' : 'Ctrl+';

let page = positiveInteger(root.dataset.page, 1);
/** How the user zoomed; none while the PDF fits the width of Card Detail, at most 125 % (PDFs and books, rule 27). */
let zoom = storedZoom(root.dataset.zoom);
/** The zoom that this page asked for, whose change is not the user's. */
let automaticRequest: ZoomLevel | undefined;
/** A PDF opens at a fit, and then at the scale the user chose for it. */
let restoredZoom = typeof zoom === 'number' ? zoom : undefined;
let ready = false;
let locked = false;
/** When the user last pressed, typed, or scrolled in the page: a zoom right after it is the user's. */
let lastUserInput = 0;
let registry: PluginRegistry | undefined;
let pdfDocument: PdfDocumentObject | undefined;
let totalPages = 1;
/** The text of the selection, kept for a copy, which the clipboard takes at once. */
let selectedText = '';
let selectedPages: number[] = [];

// #region The parts of the reader

installReaderHover(root);

const chrome = new ReaderChrome(root, { location: labels.goToPage, size: labels.zoom });
chrome.element.hidden = true;

observeReaderWidth(root);

/** How the panels stand, which Card Detail keeps for the next PDF (PDFs and books, rule 18). */
let panels: IBaseHalfReaderPanelState = normalizeBaseHalfReaderPanelState(safeJson(root.dataset.panel));
function keepPanels(change: Partial<IBaseHalfReaderPanelState>): void {
	panels = { ...panels, ...change };
	vscode.postMessage({ type: 'basehalf.reader.panel', state: panels });
}

const panel = new ReaderPanel(root, {
	tabs: ['pages', 'contents'],
	labels,
	state: panels,
	onState: state => keepPanels(state)
});

const comments = new PdfCommentStore(index => pageText(index), () => pdfDocument?.pageCount ?? totalPages);

const commentsPanel = new ReaderCommentsPanel(root, {
	labels,
	open: panels.comments,
	items: () => commentItems(),
	onOpen: open => keepPanels({ comments: open }),
	go: (comment, anchor, found) => goToComment(comment, anchor, found)
});

const find = new ReaderFindBar(root, {
	labels,
	search: query => void findAll(query),
	next: () => goToMatch(1),
	previous: () => goToMatch(-1),
	closed: () => stopFind()
});

const notes = new CommentNotes({
	root,
	labels,
	change: (step, comment, remove) => changeComment(step, comment, remove),
	focus: id => vscode.postMessage({ type: 'basehalf.comments.focus', ...(id ? { id } : {}) }),
	grow: comment => {
		if (comment.quote) {
			vscode.postMessage({ type: 'basehalf.comments.grow', id: comment.id });
		}
	},
	discard: comment => comments.remove(comment.id),
	closed: () => renderMarksFocus(),
	commentOn: highlight => commentOn(highlight)
});

const selectionMenu = new ReaderSelectionMenu(root, labels, {
	highlight: () => void markSelection(false),
	comment: () => void markSelection(true),
	grow: () => growSelection(),
	copy: () => copySelection()
});

comments.subscribe(() => commentsPanel.refresh());

// #endregion

// #region Messages of the window

window.addEventListener('message', event => {
	const set = baseHalfCommentsSetMessage(event.data);
	if (set) {
		comments.setComments(set.comments, set.unreadable, set.color);
		notes.update(set.comments);
		return;
	}
	const command = baseHalfReaderCommandMessage(event.data);
	if (command?.command === 'toggleSidebar') {
		panel.toggle();
	} else if (command?.command === 'find') {
		find.open();
	} else if (command?.command === 'toggleComments') {
		commentsPanel.toggle();
	}
	const pinch = baseHalfPagePinchFromMessage(event.data);
	if (pinch && !locked) {
		zoomGesture(pinch, pinch.x, pinch.y);
	}
});

// The wheel with Ctrl held inside the page zooms as a pinch does, one step of Card Detail's zoom an event.
window.addEventListener('wheel', event => {
	if (event.isTrusted && !locked && isBaseHalfZoomWheel(event, isMac)) {
		event.preventDefault();
		event.stopPropagation();
		zoomGesture(event, event.clientX, event.clientY);
	}
}, { capture: true, passive: false });

for (const type of ['pointerdown', 'keydown', 'wheel'] as const) {
	window.addEventListener(type, () => {
		if (!locked) {
			lastUserInput = Date.now();
		}
		vscode.postMessage({ type: 'basehalf.pdf.userInteraction' });
	}, { capture: true, passive: true });
}

// The keyboard (PDFs and books, rule 26): Escape closes a menu, a comment
// note or the tools of a highlight, the find bar, the selection, a panel over
// the document, and then Card Detail.
window.addEventListener('keydown', event => {
	if (event.isComposing) {
		return;
	}
	const mod = isMac ? event.metaKey : event.ctrlKey;
	// Cmd+F shows the find bar. The page that holds the reader prevents its default first, so that the browser's own find does not open.
	if (mod && !event.altKey && !event.shiftKey && (event.key === 'f' || event.key === 'F')) {
		event.preventDefault();
		find.open();
		return;
	}
	if (event.defaultPrevented) {
		return;
	}

	// The keys of the zoom are the PDF's wherever the keyboard is in the reader; the window does not zoom (PDFs and books, rule 22).
	if (mod && !event.altKey && (event.key === '=' || event.key === '+' || event.key === '-' || event.key === '0')) {
		event.preventDefault();
		lastUserInput = Date.now();
		if (event.key === '0') {
			zoomTo(1);
		} else {
			zoomBy(event.key === '-' ? -1 : 1);
		}
		return;
	}
	if (event.key !== 'Escape' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
		return;
	}
	if (isReaderMenuOpen()) {
		closeReaderMenu();
	} else if (notes.escape()) {
		// The comment note or the tools closed.
	} else if (find.isOpen) {
		find.close();
	} else if (selectionMenu.isShown) {
		clearSelection();
	} else if (commentsPanel.isOver) {
		commentsPanel.close();
	} else if (panel.isOver) {
		panel.close();
	} else if (!locked) {
		vscode.postMessage({ type: 'basehalf.media.escape' });
	}
	event.preventDefault();
});

// Whether a field of text, such as a comment note, has the keyboard: there
// Cmd+Z undoes the typing, and elsewhere the steps of the canvas (comments, rule 26).
let textFocused = false;
function reportTextFocus(): void {
	const focused = isTextField(document.activeElement);
	if (focused !== textFocused) {
		textFocused = focused;
		vscode.postMessage({ type: 'basehalf.reader.textFocus', focused });
	}
}
document.addEventListener('focusin', reportTextFocus);
document.addEventListener('focusout', () => window.setTimeout(reportTextFocus, 0));

// A copy, by Cmd+C or by Copy, takes the text of the selection (PDFs and books, rule 25).
document.addEventListener('copy', event => {
	if (selectedText && !isTextField(document.activeElement)) {
		event.clipboardData?.setData('text/plain', selectedText);
		event.preventDefault();
	}
});

// #endregion

// #region Opening the PDF

const initialization = window.setTimeout(() => {
	if (!ready && !locked) {
		showError();
	}
}, INITIALIZATION_TIMEOUT_MS);

void start().catch(error => {
	console.error('[BaseHalf] the PDF reader could not start', error);
	showError(error instanceof Error ? error.message : String(error));
});

async function start(): Promise<void> {
	// VS Code's signed local-resource URL is resolved by the webview service
	// worker. A nested blob worker cannot use that service-worker route, so
	// resolve PDFium once here and give the renderer worker a same-origin blob.
	const response = await fetch(requiredData('wasm'), { credentials: 'same-origin' });
	if (!response.ok) {
		throw new Error(`The local PDF engine could not be loaded (${response.status}).`);
	}
	const wasm = await response.arrayBuffer();
	const magic = new Uint8Array(wasm, 0, Math.min(4, wasm.byteLength));
	if (magic.length !== 4 || magic[0] !== 0 || magic[1] !== 97 || magic[2] !== 115 || magic[3] !== 109) {
		throw new Error('The local PDF engine returned invalid data.');
	}
	const wasmUrl = URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' }));
	let fontUrl: string | undefined;
	const fontSource = root.dataset.fontSc;
	if (fontSource) {
		try {
			const font = await fetch(fontSource, { credentials: 'same-origin' });
			if (font.ok) {
				fontUrl = URL.createObjectURL(new Blob([await font.arrayBuffer()], { type: 'font/otf' }));
			}
		} catch (error) {
			// A font package must never prevent an otherwise valid PDF from
			// opening. Embedded document fonts continue to work without it.
			console.warn('[BaseHalf] simplified Chinese PDF fallback font is unavailable', error);
		}
	}
	window.addEventListener('unload', () => {
		URL.revokeObjectURL(wasmUrl);
		if (fontUrl) {
			URL.revokeObjectURL(fontUrl);
		}
	}, { once: true });
	// The engine is made once: its hook makes another one whenever its settings are another object.
	const fontFallback = fontUrl ? { fonts: { [FontCharset.GB2312]: [{ url: fontUrl, weight: 400 }] } } : null;
	render(<Reader wasmUrl={wasmUrl} fontFallback={fontFallback} />, documentHost);
}

const plugins = [
	createPluginRegistration(DocumentManagerPluginPackage, {
		initialDocuments: [{ url: requiredData('source'), documentId: DOCUMENT_ID, name: root.dataset.name || 'Document.pdf', mode: 'auto', autoActivate: true }],
		maxDocuments: 1
	}),
	// The pages keep 30 px from the sides, the room where the marks of comments stand outside the page (PDFs and books, rule 27).
	createPluginRegistration(ViewportPluginPackage, { viewportGap: VIEWPORT_GAP }),
	createPluginRegistration(ScrollPluginPackage, { defaultPageGap: 14, defaultBufferSize: 2 }),
	createPluginRegistration(RenderPluginPackage, { withAnnotations: true }),
	createPluginRegistration(TilingPluginPackage, { tileSize: 768, overlapPx: 2.5, extraRings: 0 }),
	createPluginRegistration(ZoomPluginPackage, { defaultZoomLevel: zoom === 'fit-page' ? ZoomMode.FitPage : ZoomMode.FitWidth, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, zoomStep: ZOOM_STEP }),
	createPluginRegistration(InteractionManagerPluginPackage),
	createPluginRegistration(SelectionPluginPackage, { marquee: { enabled: false }, minSelectionDragDistance: 3 }),
	createPluginRegistration(SearchPluginPackage),
	createPluginRegistration(ThumbnailPluginPackage, { width: 150, gap: 10, labelHeight: 18, autoScroll: true, scrollBehavior: 'auto', paddingY: 8 }),
	createPluginRegistration(BookmarkPluginPackage)
];

function Reader({ wasmUrl, fontFallback }: { readonly wasmUrl: string; readonly fontFallback: Parameters<typeof usePdfiumEngine>[0] extends infer C ? C extends { fontFallback?: infer F } ? F : never : never }) {
	const { engine, error } = usePdfiumEngine({ wasmUrl, worker: true, fontFallback });
	useEffect(() => {
		if (error) {
			showError(error.message);
		}
	}, [error]);
	if (!engine) {
		return null;
	}
	return (
		<EmbedPDF engine={engine} plugins={plugins} onInitialized={async next => initialize(next)}>
			{({ activeDocumentId }) => activeDocumentId ? (
				<DocumentContent documentId={activeDocumentId}>
					{({ isLoaded }) => isLoaded ? <Document documentId={activeDocumentId} /> : null}
				</DocumentContent>
			) : null}
		</EmbedPDF>
	);
}

function Document({ documentId }: { readonly documentId: string }) {
	const state = useDocumentState(documentId);
	const scale = state?.scale ?? 1;
	return (
		<>
			<Viewport documentId={documentId} class='pdf-viewport'>
				<ZoomGestureWrapper documentId={documentId} enablePinch={false}>
					<Scroller documentId={documentId} renderPage={layout => <Page documentId={documentId} layout={layout} scale={scale} />} />
				</ZoomGestureWrapper>
			</Viewport>
			{createPortal(<Thumbnails documentId={documentId} />, panel.section('pages'))}
		</>
	);
}

function Thumbnails({ documentId }: { readonly documentId: string }) {
	const [current, setCurrent] = useState(page);
	useEffect(() => {
		const scroll = registry?.getPlugin<ScrollPlugin>(ScrollPlugin.id)?.provides();
		return scroll?.onPageChange(event => {
			if (event.documentId === documentId) {
				setCurrent(event.pageNumber);
			}
		});
	}, [documentId]);
	return (
		<ThumbnailsPane documentId={documentId} class='thumbnails' style={{ height: '100%' }}>
			{meta => (
				<div key={meta.pageIndex} style={{ position: 'absolute', top: meta.top, left: 0, right: 0, height: meta.wrapperHeight }}>
					<button type='button' class={`thumbnail${meta.pageIndex + 1 === current ? ' current' : ''}`} onClick={() => {
						goToPage(meta.pageIndex + 1);
						panel.closeWhenOver();
					}}>
						<ThumbImg documentId={documentId} meta={meta} style={{ width: meta.width, height: meta.height }} />
						<span>{meta.pageIndex + 1}</span>
					</button>
				</div>
			)}
		</ThumbnailsPane>
	);
}

function Page({ documentId, layout, scale }: { readonly documentId: string; readonly layout: PageLayout; readonly scale: number }) {
	const pageIndex = layout.pageIndex;
	const [, setVersion] = useState(comments.version);
	const [geometry, setGeometry] = useState<PdfPageGeometry | undefined>(undefined);
	const [links, setLinks] = useState<readonly PdfLinkAnnoObject[]>([]);
	useEffect(() => comments.subscribe(() => setVersion(comments.version)), []);
	useEffect(() => {
		let live = true;
		void pageGeometry(pageIndex).then(found => live && setGeometry(found));
		void pageLinks(pageIndex).then(found => live && setLinks(found));
		return () => {
			live = false;
		};
	}, [pageIndex]);
	// Highlights are tints under the text, comments wavy lines under it (comments, rule 6).
	const passages = geometry ? comments.rangesOn(pageIndex).map(range => ({ ...range, rects: rectsWithinSlice(geometry, range.start, range.end, true) })) : [];
	const tints = passages.filter(passage => !comments.isComment(passage.comment));
	const waves = passages.filter(passage => comments.isComment(passage.comment));
	const pins = comments.pinsOn(pageIndex);
	const box = (rect: Rect) => ({ left: rect.origin.x * scale, top: rect.origin.y * scale, width: rect.size.width * scale, height: rect.size.height * scale });
	// The wave's middle under the baseline, where an underline stands, a tenth of the line's height above its box's bottom: a paper's lines are close, and lower it would cross the tall letters of the next line.
	const underline = (rect: Rect) => ({ left: rect.origin.x * scale, top: (rect.origin.y + rect.size.height * 0.9) * scale - 2, width: rect.size.width * scale });
	return (
		<div class='pdf-page' data-page={layout.pageNumber} style={{ width: layout.width, height: layout.height }}
			onPointerMove={event => hoverPage(event, waves, scale)}
			onPointerLeave={() => notes.hoverLeave()}
			onClick={event => clickPage(event, tints, waves, scale)}
			onContextMenu={event => offerPageComment(event, pageIndex)}>
			<PagePointerProvider documentId={documentId} pageIndex={pageIndex} class='pdf-page-content'>
				<RenderLayer documentId={documentId} pageIndex={pageIndex} scale={1} class='pdf-render' />
				<TilingLayer documentId={documentId} pageIndex={pageIndex} class='pdf-tiles' />
				<div class='pdf-tints'>
					{tints.flatMap(tint => tint.rects.map((rect, index) => <div key={`${tint.comment.id}-${index}`} class='comment-tint' data-color={tint.comment.color} style={box(rect)} />))}
				</div>
				<SearchLayer documentId={documentId} pageIndex={pageIndex} highlightColor='rgb(255 166 0 / 32%)' activeHighlightColor='rgb(255 120 0 / 55%)' />
				<SelectionLayer documentId={documentId} pageIndex={pageIndex} textStyle={{ background: 'rgb(51 136 255 / 30%)' }} />
				<div class='pdf-waves'>
					{waves.flatMap(wave => wave.rects.map((rect, index) => <div key={`${wave.comment.id}-${index}`} class='comment-wave' data-comment={wave.comment.id} style={underline(rect)} />))}
				</div>
				{links.map((link, index) => <a key={index} class='pdf-link' style={box(link.rect)} onClick={event => followLink(event, link.target)} />)}
			</PagePointerProvider>
			{stackCommentMarks(waves.filter(wave => wave.first && wave.rects.length).map(wave => ({ wave, top: Math.max(2, wave.rects[0].origin.y * scale) }))).map(({ wave, top }) => (
				<button key={wave.comment.id} type='button' class='comment-mark' data-comment={wave.comment.id}
					style={{ left: layout.width + MARK_GAP + MARK_SIZE / 2, top }}
					onPointerEnter={() => notes.hoverEnter(wave.comment, () => markRect(wave.comment.id))}
					onPointerLeave={() => notes.hoverLeave()}
					onPointerDown={event => event.stopPropagation()}
					onClick={event => {
						event.stopPropagation();
						notes.open(comments.get(wave.comment.id) ?? wave.comment, (event.currentTarget as HTMLElement).getBoundingClientRect(), { unsaved: comments.isDraft(wave.comment.id) });
					}} />
			))}
			{pins.map(pin => (
				<button key={pin.comment.id} type='button' class='comment-mark pin' data-comment={pin.comment.id}
					style={{ left: pin.x * layout.width, top: pin.y * layout.height }}
					onPointerEnter={() => notes.hoverEnter(pin.comment, () => markRect(pin.comment.id))}
					onPointerLeave={() => notes.hoverLeave()}
					onPointerDown={event => event.stopPropagation()}
					onClick={event => {
						event.stopPropagation();
						notes.open(comments.get(pin.comment.id) ?? pin.comment, (event.currentTarget as HTMLElement).getBoundingClientRect(), { unsaved: comments.isDraft(pin.comment.id) });
					}} />
			))}
		</div>
	);
}

async function initialize(next: PluginRegistry): Promise<void> {
	registry = next;
	await next.pluginsReady();
	const documentManager = next.getPlugin<DocumentManagerPlugin>(DocumentManagerPlugin.id)?.provides();
	const scroll = next.getPlugin<ScrollPlugin>(ScrollPlugin.id)?.provides();
	const zoomCapability = next.getPlugin<ZoomPlugin>(ZoomPlugin.id)?.provides();
	const selection = next.getPlugin<SelectionPlugin>(SelectionPlugin.id)?.provides();
	if (!documentManager || !scroll || !zoomCapability || !selection) {
		throw new Error('The PDF reader did not provide its required capabilities.');
	}
	documentManager.onDocumentOpened(event => {
		if (event.id === DOCUMENT_ID) {
			pdfDocument = documentManager.getDocumentState(DOCUMENT_ID)?.document ?? undefined;
			markReady();
		}
	});
	documentManager.onDocumentError(event => {
		if (event.documentId === DOCUMENT_ID) {
			documentFailed(event.code, event.message);
		}
	});
	scroll.onLayoutReady(event => {
		if (event.documentId !== DOCUMENT_ID || !event.isInitial) {
			return;
		}
		totalPages = event.totalPages;
		page = Math.min(Math.max(1, page), event.totalPages);
		scroll.forDocument(DOCUMENT_ID).scrollToPage({ pageNumber: page, behavior: 'instant', alignY: 0 });
		showPage();
		emitViewState();
		void renderOutline();
	});
	scroll.onPageChange(event => {
		if (event.documentId !== DOCUMENT_ID) {
			return;
		}
		totalPages = event.totalPages;
		if (event.pageNumber !== page) {
			page = event.pageNumber;
			emitViewState();
		}
		showPage();
	});
	scroll.onScroll(() => placeSelectionMenu());
	const zoomScope = zoomCapability.forDocument(DOCUMENT_ID);
	zoomCapability.onZoomChange(event => {
		if (event.documentId !== DOCUMENT_ID) {
			return;
		}
		chrome.setSize(`${Math.round(event.newZoom * 100)}%`);
		window.requestAnimationFrame(() => placeSelectionMenu());
		if (restoredZoom !== undefined) {
			// The first fit shows the document: now the scale the user chose, at their page.
			const level = restoredZoom;
			restoredZoom = undefined;
			requestAutomaticZoom(level);
			window.requestAnimationFrame(() => scroll.forDocument(DOCUMENT_ID).scrollToPage({ pageNumber: page, behavior: 'instant', alignY: 0 }));
			return;
		}
		// A zoom that this page asked for, or the reader's own fit to a new width, is not the user's.
		const requested = automaticRequest !== undefined && event.level === automaticRequest;
		automaticRequest = undefined;
		if (zoom === undefined && (requested || Date.now() - lastUserInput > 1000)) {
			// The width of Card Detail, but at most 125 %, until the user zooms.
			if (event.newZoom > BASEHALF_PDF_AUTOMATIC_ZOOM_MAX + 0.001) {
				requestAutomaticZoom(BASEHALF_PDF_AUTOMATIC_ZOOM_MAX);
			}
			return;
		}
		zoom = event.level === ZoomMode.FitWidth || event.level === ZoomMode.Automatic ? 'fit-width'
			: event.level === ZoomMode.FitPage ? 'fit-page'
				: boundedNumber(String(event.newZoom), 1, MIN_ZOOM, MAX_ZOOM);
		emitViewState();
	});
	// While the PDF fits the width of Card Detail, it follows the width.
	new ResizeObserver(() => {
		if (zoom === undefined && ready) {
			requestAutomaticZoom(ZoomMode.FitWidth);
		}
	}).observe(documentHost);
	observeSelection(selection);
	const state = documentManager.getDocumentState(DOCUMENT_ID);
	if (state?.status === 'loaded') {
		pdfDocument = state.document ?? undefined;
		markReady();
	} else if (state?.status === 'error') {
		documentFailed(state.errorCode, state.error ?? undefined);
	}
	function requestAutomaticZoom(level: ZoomLevel): void {
		automaticRequest = level;
		zoomScope.requestZoom(level);
	}
}

function markReady(): void {
	ready = true;
	locked = false;
	window.clearTimeout(initialization);
	root.dataset.status = 'ready';
	root.querySelector('.pdf-password')?.remove();
	vscode.postMessage({ type: 'basehalf.comments.ready' });
	showWhenPageDrawn();
}

/**
 * The reader shows itself once the page it opens at has its picture: until
 * then the status covers it, so that no frame shows a white page, or a page
 * at the zoom it starts at (PDFs and books, rule 28).
 */
function showWhenPageDrawn(): void {
	const started = performance.now();
	const check = (): void => {
		if (root.dataset.status !== 'ready') {
			return;
		}
		if (shownPageIsDrawn() || performance.now() - started > FIRST_PAGE_WAIT_MS) {
			status.hidden = true;
			chrome.element.hidden = false;
			return;
		}
		window.requestAnimationFrame(check);
	};
	check();
}

/** Whether a page in sight has its picture: a page is drawn as pictures, white until the first of them has come. */
function shownPageIsDrawn(): boolean {
	const shown = documentHost.getBoundingClientRect();
	for (const image of documentHost.querySelectorAll<HTMLImageElement>('.pdf-page img')) {
		if (!image.complete || image.naturalWidth === 0) {
			continue;
		}
		const box = image.getBoundingClientRect();
		if (box.width > 0 && box.height > 0 && box.bottom > shown.top && box.top < shown.bottom && box.right > shown.left && box.left < shown.right) {
			return true;
		}
	}
	return false;
}

/**
 * A PDF that a password locks asks for it in place of the PDF; any other PDF
 * that does not open says that BaseHalf could not open it, and the reason
 * goes to the log (PDFs and books, rule 31).
 */
function documentFailed(code: number | undefined, message: string | undefined): void {
	if (code === PdfErrorCode.Password) {
		const wrong = locked;
		locked = true;
		window.clearTimeout(initialization);
		root.dataset.status = 'locked';
		askPassword(wrong);
		return;
	}
	vscode.postMessage({ type: 'basehalf.pdf.failed', message: message ?? '' });
	showError();
}

function askPassword(wrong: boolean): void {
	status.hidden = true;
	root.querySelector('.pdf-password')?.remove();
	const form = element('form', 'pdf-password', root);
	element('label', 'pdf-password-label', form).textContent = labels.password;
	const field = element('input', '', form);
	field.type = 'password';
	field.autocomplete = 'off';
	field.setAttribute('aria-label', labels.password);
	const problem = element('div', 'pdf-password-problem', form);
	problem.textContent = wrong ? labels.passwordWrong : '';
	const buttons = element('div', 'pdf-password-buttons', form);
	const cancel = element('button', 'secondary', buttons);
	cancel.type = 'button';
	cancel.textContent = labels.cancel;
	const open = element('button', 'primary', buttons);
	open.type = 'submit';
	open.textContent = labels.open;
	cancel.addEventListener('click', () => vscode.postMessage({ type: 'basehalf.media.escape' }));
	form.addEventListener('submit', event => {
		event.preventDefault();
		const documentManager = registry?.getPlugin<DocumentManagerPlugin>(DocumentManagerPlugin.id)?.provides();
		open.disabled = true;
		documentManager?.retryDocument(DOCUMENT_ID, { password: field.value });
	});
	form.addEventListener('keydown', event => {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			vscode.postMessage({ type: 'basehalf.media.escape' });
		}
	});
	field.focus();
}

function showError(reason?: string): void {
	window.clearTimeout(initialization);
	if (reason) {
		vscode.postMessage({ type: 'basehalf.pdf.failed', message: reason });
	}
	root.dataset.status = 'error';
	status.classList.remove('loading');
	status.classList.add('error');
	status.hidden = false;
	statusMessage.textContent = labels.failed;
}

// #endregion

// #region Pages, zoom, and the outline

function showPage(): void {
	chrome.setLocation(`${page} / ${totalPages}`);
}

chrome.location.addEventListener('click', () => chrome.editPage(page, totalPages, target => goToPage(target)));
chrome.size.addEventListener('click', () => {
	const zoomScope = registry?.getPlugin<ZoomPlugin>(ZoomPlugin.id)?.provides().forDocument(DOCUMENT_ID);
	if (!zoomScope) {
		return;
	}
	const shown = Math.round(zoomScope.getState().currentZoomLevel * 100);
	openReaderMenu(root, chrome.size, {
		field: {
			value: String(shown),
			suffix: '%',
			label: format(labels.zoomPercentage, `${MIN_ZOOM * 100}%-${MAX_ZOOM * 100}%`),
			commit: value => {
				const number = Number.parseFloat(value.replace('%', '').trim());
				if (!Number.isFinite(number) || number < MIN_ZOOM * 100 || number > MAX_ZOOM * 100) {
					return false;
				}
				lastUserInput = Date.now();
				zoomTo(number / 100);
				return true;
			}
		},
		entries: [
			{ label: labels.zoomIn, shortcut: `${commandKey}=`, run: () => zoomBy(1) },
			{ label: labels.zoomOut, shortcut: `${commandKey}-`, run: () => zoomBy(-1) },
			{ label: labels.fitWidth, run: () => zoomTo(ZoomMode.FitWidth) },
			{ label: labels.fitPage, run: () => zoomTo(ZoomMode.FitPage) },
			'separator',
			{ label: format(labels.zoomTo, 50), run: () => zoomTo(0.5) },
			{ label: format(labels.zoomTo, 100), shortcut: `${commandKey}0`, run: () => zoomTo(1) },
			{ label: format(labels.zoomTo, 200), run: () => zoomTo(2) }
		]
	});
});

function zoomTo(level: ZoomLevel): void {
	lastUserInput = Date.now();
	registry?.getPlugin<ZoomPlugin>(ZoomPlugin.id)?.provides().forDocument(DOCUMENT_ID).requestZoom(level);
}

/** One step of Zoom In or Zoom Out, as the wheel with Ctrl held zooms. */
function zoomBy(direction: 1 | -1): void {
	const scope = registry?.getPlugin<ZoomPlugin>(ZoomPlugin.id)?.provides().forDocument(DOCUMENT_ID);
	if (!scope) {
		return;
	}
	lastUserInput = Date.now();
	const shown = scope.getState().currentZoomLevel;
	scope.requestZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((shown + direction * ZOOM_STEP) * 100) / 100)));
}

/**
 * A pinch zooms the PDF around the fingers (PDFs and books, rule 29): the
 * pages are magnified while the fingers move and take the new zoom once they
 * rest. The zoom library's gesture does both; it gets every pinch as a wheel
 * with Ctrl held, one step of Card Detail's zoom each, whether the window took
 * the pinch over the page or the wheel turned inside it. A zoom asked once a
 * frame instead lost the place under the fingers: each asked from a scroll
 * that the one before had not reached yet.
 */
function zoomGesture(delta: IBaseHalfZoomDelta, clientX: number, clientY: number): void {
	const viewport = documentHost.querySelector<HTMLElement>('.pdf-viewport');
	if (!viewport) {
		return;
	}
	lastUserInput = Date.now();
	// The library zooms a wheel by 1 - deltaY / 100.
	const deltaY = (1 - baseHalfZoomFactor(delta)) * 100;
	viewport.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY, deltaMode: 0, clientX, clientY, bubbles: true, cancelable: true }));
}

function goToPage(target: number): void {
	registry?.getPlugin<ScrollPlugin>(ScrollPlugin.id)?.provides().forDocument(DOCUMENT_ID).scrollToPage({ pageNumber: target, behavior: 'instant', alignY: 0 });
}

async function renderOutline(): Promise<void> {
	const bookmarks = registry?.getPlugin<BookmarkPlugin>(BookmarkPlugin.id)?.provides().forDocument(DOCUMENT_ID);
	let outline: PdfBookmarkObject[] = [];
	try {
		outline = (await bookmarks?.getBookmarks().toPromise())?.bookmarks ?? [];
	} catch (error) {
		console.warn('[BaseHalf] the outline of the PDF could not be read', error);
	}
	const section = panel.section('contents');
	section.replaceChildren();
	if (outline.length === 0) {
		panel.setTabs(['pages']);
		return;
	}
	panel.setTabs(['pages', 'contents']);
	const list = element('ol', '', section);
	const add = (parent: HTMLElement, entries: readonly PdfBookmarkObject[], depth: number) => {
		for (const entry of entries) {
			const item = element('li', '', parent);
			const button = element('button', 'toc-entry', item);
			button.type = 'button';
			button.style.setProperty('--depth', String(depth));
			button.textContent = entry.title?.trim() || labels.untitledSection;
			const target = targetPage(entry.target);
			if (target === undefined) {
				button.disabled = true;
			} else {
				button.addEventListener('click', () => {
					goToPage(target);
					panel.closeWhenOver();
				});
			}
			if (entry.children?.length) {
				add(element('ol', '', item), entry.children, depth + 1);
			}
		}
	};
	add(list, outline, 0);
}

/** The page, from 1, that a link or an entry of the outline goes to. */
function targetPage(target: PdfLinkTarget | undefined): number | undefined {
	if (!target) {
		return undefined;
	}
	const destination = target.type === 'destination' ? target.destination
		: target.action.type === PdfActionType.Goto ? target.action.destination : undefined;
	return destination ? destination.pageIndex + 1 : undefined;
}

/** A link of the PDF (PDFs and books, rule 30): a place in the PDF, or a website after the window's question. */
function followLink(event: MouseEvent, target: PdfLinkTarget | undefined): void {
	if (selectedText || !target) {
		return;
	}
	event.preventDefault();
	event.stopPropagation();
	const pageNumber = targetPage(target);
	if (pageNumber !== undefined) {
		goToPage(pageNumber);
	} else if (target.type === 'action' && target.action.type === PdfActionType.URI && /^(https?|mailto):/i.test(target.action.uri)) {
		vscode.postMessage({ type: 'basehalf.reader.openLink', href: target.action.uri });
	}
}

// #endregion

// #region The text of pages

const texts = new Map<number, Promise<string | undefined>>();
const geometries = new Map<number, Promise<PdfPageGeometry | undefined>>();
/** The geometry of the pages read so far, for the boxes of passages. */
const readGeometries = new Map<number, PdfPageGeometry>();
const linkCache = new Map<number, Promise<readonly PdfLinkAnnoObject[]>>();

function engine() {
	return registry?.getEngine();
}

function pageGeometry(pageIndex: number): Promise<PdfPageGeometry | undefined> {
	let found = geometries.get(pageIndex);
	if (!found) {
		const pdf = pdfDocument;
		const pdfPage = pdf?.pages[pageIndex];
		found = pdf && pdfPage ? engine()!.getPageGeometry(pdf, pdfPage).toPromise().then(geometry => {
			readGeometries.set(pageIndex, geometry);
			return geometry;
		}, () => undefined) : Promise.resolve(undefined);
		geometries.set(pageIndex, found);
	}
	return found;
}

/** The text of a page, one character of the string for each character the engine counts on it. */
function pageText(pageIndex: number): Promise<string | undefined> {
	let found = texts.get(pageIndex);
	if (!found) {
		found = (async () => {
			const geometry = await pageGeometry(pageIndex);
			const last = geometry?.runs[geometry.runs.length - 1];
			const count = last ? last.charStart + last.glyphs.length : 0;
			if (!pdfDocument || count === 0) {
				return '';
			}
			try {
				const [text] = await engine()!.getTextSlices(pdfDocument, [{ pageIndex, charIndex: 0, charCount: count }]).toPromise();
				return text ?? '';
			} catch {
				return undefined;
			}
		})();
		texts.set(pageIndex, found);
	}
	return found;
}

function pageLinks(pageIndex: number): Promise<readonly PdfLinkAnnoObject[]> {
	let found = linkCache.get(pageIndex);
	if (!found) {
		const pdf = pdfDocument;
		const pdfPage = pdf?.pages[pageIndex];
		found = pdf && pdfPage
			? engine()!.getPageAnnotations(pdf, pdfPage).toPromise().then(annotations => annotations.filter((annotation): annotation is PdfLinkAnnoObject => annotation.type === PdfAnnotationSubtype.LINK), () => [])
			: Promise.resolve([]);
		linkCache.set(pageIndex, found);
	}
	return found;
}

// #endregion

// #region Selecting

function observeSelection(selection: SelectionCapability): void {
	let settling: number | undefined;
	let run = 0;
	let sent = false;
	selection.onSelectionChange(event => {
		if (event.documentId !== DOCUMENT_ID) {
			return;
		}
		if (!event.selection) {
			selectedText = '';
			selectedPages = [];
			selectionMenu.hide();
		}
		window.clearTimeout(settling);
		settling = window.setTimeout(async () => {
			const current = ++run;
			const scope = selection.forDocument(DOCUMENT_ID);
			const pages = [...new Set(scope.getFormattedSelection().map(item => item.pageIndex + 1))].sort((left, right) => left - right);
			let text = '';
			if (pages.length > 0) {
				try {
					text = (await scope.getSelectedText().toPromise()).join('\n\n');
				} catch (error) {
					console.error('[BaseHalf] failed to read the PDF selection', error);
				}
			}
			if (current !== run) {
				return;
			}
			selectedText = text.trim() ? text : '';
			selectedPages = pages;
			// What agents can see (PDFs and books, "What agents can see").
			if (!selectedText) {
				if (sent) {
					sent = false;
					vscode.postMessage({ type: 'basehalf.pdf.selectionChanged' });
				}
				return;
			}
			sent = true;
			vscode.postMessage({ type: 'basehalf.pdf.selectionChanged', selection: { text: text.slice(0, BASEHALF_PDF_SELECTION_TEXT_LIMIT), pages } });
			if (!scope.getState().selecting) {
				placeSelectionMenu();
			}
		}, 30);
	});
	selection.onEndSelection(event => {
		if (event.documentId === DOCUMENT_ID && selectedText) {
			placeSelectionMenu();
		}
	});
}

/** The menu of the selection, over its first line, as long as text is selected and no button is pressed (PDFs and books, rule 25). */
function placeSelectionMenu(): void {
	const scope = registry?.getPlugin<SelectionPlugin>(SelectionPlugin.id)?.provides().forDocument(DOCUMENT_ID);
	const formatted = scope?.getFormattedSelection() ?? [];
	if (!selectedText || formatted.length === 0 || scope?.getState().selecting) {
		selectionMenu.hide();
		return;
	}
	const scale = currentScale();
	const rectOf = (pageIndex: number, rect: Rect): DOMRect | undefined => {
		const pageElement = documentHost.querySelector<HTMLElement>(`.pdf-page[data-page="${pageIndex + 1}"]`);
		if (!pageElement) {
			return undefined;
		}
		const box = pageElement.getBoundingClientRect();
		return new DOMRect(box.left + rect.origin.x * scale, box.top + rect.origin.y * scale, rect.size.width * scale, rect.size.height * scale);
	};
	const first = formatted[0];
	const last = formatted[formatted.length - 1];
	const firstRect = rectOf(first.pageIndex, first.segmentRects[0] ?? first.rect);
	const lastRect = rectOf(last.pageIndex, last.segmentRects[last.segmentRects.length - 1] ?? last.rect);
	const shown = documentHost.getBoundingClientRect();
	if (!firstRect || !lastRect || lastRect.bottom < shown.top || firstRect.top > shown.bottom) {
		selectionMenu.hide();
		return;
	}
	selectionMenu.show(firstRect, lastRect);
}

function clearSelection(): void {
	registry?.getPlugin<SelectionPlugin>(SelectionPlugin.id)?.provides().forDocument(DOCUMENT_ID).clear();
	selectedText = '';
	selectionMenu.hide();
}

function currentScale(): number {
	return registry?.getPlugin<ZoomPlugin>(ZoomPlugin.id)?.provides().forDocument(DOCUMENT_ID).getState().currentZoomLevel ?? 1;
}

function copySelection(): void {
	document.execCommand('copy');
	selectionMenu.hide();
}

function growSelection(): void {
	if (!selectedText || selectedPages.length === 0) {
		return;
	}
	const selected: IBaseHalfPdfSelection = { text: selectedText.trim(), pages: selectedPages };
	vscode.postMessage({ type: 'basehalf.pdf.createBranch', selection: selected });
}

/** Highlight, or Comment, on the selected passage (comments, rule 16). */
async function markSelection(withWords: boolean): Promise<void> {
	const scope = registry?.getPlugin<SelectionPlugin>(SelectionPlugin.id)?.provides().forDocument(DOCUMENT_ID);
	const range = scope?.getState().selection;
	if (!scope || !range || !selectedText) {
		return;
	}
	const start = range.start.page <= range.end.page ? range.start : range.end;
	const end = range.start.page <= range.end.page ? range.end : range.start;
	const ranges: { pageIndex: number; start: number; end: number }[] = [];
	for (let pageIndex = start.page; pageIndex <= end.page; pageIndex++) {
		const text = await pageText(pageIndex) ?? '';
		const from = pageIndex === start.page ? Math.min(start.index, pageIndex === end.page ? end.index : start.index) : 0;
		const to = pageIndex === end.page ? Math.max(end.index, pageIndex === start.page ? start.index : end.index) : Math.max(0, text.length - 1);
		ranges.push({ pageIndex, start: from, end: to });
	}
	const firstText = await pageText(start.page) ?? '';
	const lastText = await pageText(end.page) ?? '';
	const context = { before: baseHalfCommentContext(firstText, ranges[0].start, ranges[0].start).before, after: baseHalfCommentContext(lastText, ranges[ranges.length - 1].end + 1, ranges[ranges.length - 1].end + 1).after };
	const taken = new Set(comments.all().map(comment => comment.id));
	const comment: IBaseHalfComment = {
		id: newBaseHalfCommentId(taken),
		page: start.page + 1,
		quote: baseHalfCommentCut(normalizeBaseHalfCommentQuote(selectedText)),
		...(context.before ? { before: context.before } : {}),
		...(context.after ? { after: context.after } : {}),
		// A highlight takes the color used last; a comment has none (comments, rules 16 and 19).
		color: withWords ? BASEHALF_COMMENT_DEFAULT_COLOR : comments.color,
		text: '',
		at: baseHalfCommentTime(),
		replies: []
	};
	clearSelection();
	comments.put(comment, { kind: 'text', ranges }, { draft: withWords });
	if (!withWords) {
		changeComment('highlight', comment);
		return;
	}
	openNewComment(comment);
}

/** The note of a comment just made opens at its mark, once the page has drawn it. */
function openNewComment(comment: IBaseHalfComment): void {
	window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
		const anchor = markRect(comment.id);
		if (anchor) {
			notes.open(comment, anchor, { unsaved: true });
		}
	}));
}

/**
 * Comment in the tools of a highlight (comments, rule 10): the note of a
 * comment on its passage, or a comment made on the passage, which keeps its
 * highlight.
 */
function commentOn(highlight: IBaseHalfComment): void {
	const existing = comments.commentOver(highlight.id);
	if (existing) {
		const anchor = markRect(existing.id);
		if (anchor) {
			notes.open(existing, anchor, { unsaved: comments.isDraft(existing.id) });
		}
		return;
	}
	const place = comments.place(highlight.id);
	if (place?.kind !== 'text') {
		return;
	}
	const { color: _color, at: _at, ...passage } = highlight;
	const comment: IBaseHalfComment = {
		...passage,
		id: newBaseHalfCommentId(new Set(comments.all().map(existing => existing.id))),
		color: BASEHALF_COMMENT_DEFAULT_COLOR,
		text: '',
		at: baseHalfCommentTime(),
		replies: []
	};
	comments.put(comment, place, { draft: true });
	openNewComment(comment);
}

/** Add Comment on a place of a page (comments, rule 18). */
function offerPageComment(event: MouseEvent, pageIndex: number): void {
	if (selectedText || (event.target as Element | null)?.closest('.comment-mark')) {
		return;
	}
	event.preventDefault();
	const pageElement = event.currentTarget as HTMLElement;
	const box = pageElement.getBoundingClientRect();
	const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
	const y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
	const anchor = document.createElement('div');
	anchor.style.cssText = `position:fixed;left:${event.clientX}px;top:${event.clientY}px;width:1px;height:1px`;
	document.body.append(anchor);
	openReaderMenu(root, anchor, {
		entries: [{
			label: labels.addComment, run: () => {
				const comment: IBaseHalfComment = {
					id: newBaseHalfCommentId(new Set(comments.all().map(existing => existing.id))),
					page: pageIndex + 1,
					place: [x, y],
					color: BASEHALF_COMMENT_DEFAULT_COLOR,
					text: '',
					at: baseHalfCommentTime(),
					replies: []
				};
				comments.put(comment, { kind: 'place', pageIndex, x, y }, { draft: true });
				openNewComment(comment);
			}
		}],
		onClose: () => anchor.remove()
	});
}

// #endregion

// #region Comments

function changeComment(step: BaseHalfCommentStep, comment: IBaseHalfComment | undefined, remove?: string): void {
	if (remove) {
		comments.remove(remove);
		vscode.postMessage({ type: 'basehalf.comments.change', step, remove });
		return;
	}
	if (comment) {
		comments.put(comment);
		vscode.postMessage({ type: 'basehalf.comments.change', step, comment });
	}
}

/** Where a comment's mark stands, or will stand once its first words are kept: at the right edge of its page, on its passage's first line. */
function markRect(id: string): DOMRect | undefined {
	const mark = documentHost.querySelector<HTMLElement>(`.comment-mark[data-comment="${id}"]`);
	if (mark) {
		return mark.getBoundingClientRect();
	}
	const passage = passageRect(id);
	const pageIndex = comments.pageOf(id);
	const pageElement = pageIndex === undefined ? undefined : documentHost.querySelector<HTMLElement>(`.pdf-page[data-page="${pageIndex + 1}"]`);
	if (!passage || !pageElement) {
		return passage;
	}
	const box = pageElement.getBoundingClientRect();
	return new DOMRect(box.right - 20, passage.top, 14, 14);
}

/** The box of the first line of a comment's passage, where its tools stand. */
function passageRect(id: string): DOMRect | undefined {
	const pageIndex = comments.pageOf(id);
	if (pageIndex === undefined) {
		return undefined;
	}
	const pageElement = documentHost.querySelector<HTMLElement>(`.pdf-page[data-page="${pageIndex + 1}"]`);
	const range = comments.rangesOn(pageIndex).find(entry => entry.comment.id === id);
	const geometry = readGeometries.get(pageIndex);
	const rect = range && geometry ? rectsWithinSlice(geometry, range.start, range.end, true)[0] : undefined;
	if (!pageElement || !rect) {
		return pageElement?.getBoundingClientRect();
	}
	const box = pageElement.getBoundingClientRect();
	const scale = currentScale();
	return new DOMRect(box.left + rect.origin.x * scale, box.top + rect.origin.y * scale, rect.size.width * scale, rect.size.height * scale);
}

type PagePassages = readonly { readonly comment: IBaseHalfComment; readonly rects: readonly Rect[] }[];

/** The highlight or the comment whose passage is under the point, in the coordinates of its page. */
function passageAt(event: MouseEvent, passages: PagePassages, scale: number): { comment: IBaseHalfComment; rect: Rect } | undefined {
	const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
	const x = (event.clientX - box.left) / scale;
	const y = (event.clientY - box.top) / scale;
	for (const passage of [...passages].reverse()) {
		const rect = passage.rects.find(candidate => x >= candidate.origin.x && x <= candidate.origin.x + candidate.size.width && y >= candidate.origin.y && y <= candidate.origin.y + candidate.size.height);
		if (rect) {
			return { comment: comments.get(passage.comment.id) ?? passage.comment, rect };
		}
	}
	return undefined;
}

/** The pointer on the passage of a comment shows its note (comments, rule 8). */
let hovered: string | undefined;
function hoverPage(event: PointerEvent, waves: PagePassages, scale: number): void {
	if (event.buttons || (event.target as Element | null)?.closest('.comment-mark')) {
		return;
	}
	const hit = passageAt(event, waves, scale);
	const id = hit && !comments.isDraft(hit.comment.id) ? hit.comment.id : undefined;
	if (id === hovered) {
		return;
	}
	hovered = id;
	if (hit && id) {
		notes.hoverEnter(hit.comment, () => markRect(id));
	} else {
		notes.hoverLeave();
	}
}

/** A click on a highlight shows its tools; on a comment's passage where no highlight is, its note (comments, rules 9 and 10). */
function clickPage(event: MouseEvent, tints: PagePassages, waves: PagePassages, scale: number): void {
	if (selectedText || event.defaultPrevented) {
		return;
	}
	const highlight = passageAt(event, tints, scale);
	const hit = highlight ?? passageAt(event, waves, scale);
	if (!hit) {
		return;
	}
	const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
	const anchor = new DOMRect(box.left + hit.rect.origin.x * scale, box.top + hit.rect.origin.y * scale, hit.rect.size.width * scale, hit.rect.size.height * scale);
	if (highlight) {
		notes.tools(highlight.comment, anchor);
	} else {
		notes.open(hit.comment, markRect(hit.comment.id) ?? anchor, { unsaved: comments.isDraft(hit.comment.id) });
	}
}

function renderMarksFocus(): void {
	for (const mark of documentHost.querySelectorAll<HTMLElement>('.comment-mark')) {
		mark.classList.toggle('open', mark.dataset.comment === notes.openId);
	}
}

/**
 * The highlights and comments of the Comments panel, in the order of the
 * document: by page, and on a page by where the passage begins; page
 * comments after the passages of their page (comments, rule 22). One whose
 * passage is still being looked for is not listed yet.
 */
function commentItems(): { readonly items: readonly ICommentsPanelItem[]; readonly unreadable: boolean } {
	const listed: (ICommentsPanelItem & { readonly order: readonly number[] })[] = [];
	for (const comment of comments.all()) {
		const place = comments.place(comment.id);
		if (!place || comments.isDraft(comment.id)) {
			continue;
		}
		const pageIndex = comments.pageOf(comment.id);
		const order = place.kind === 'text' ? [place.ranges[0].pageIndex, 0, place.ranges[0].start]
			: place.kind === 'place' ? [place.pageIndex, 1, place.y]
				: [Number.MAX_SAFE_INTEGER, 0, 0];
		listed.push({ comment, location: pageIndex !== undefined ? format(labels.page, pageIndex + 1) : undefined, found: place.kind !== 'missing', order });
	}
	listed.sort((left, right) => left.order[0] - right.order[0] || left.order[1] - right.order[1] || left.order[2] - right.order[2]);
	return { items: listed, unreadable: comments.unreadable };
}

/** A click in the Comments panel: the reader goes to the passage and opens its note or tools; one not found opens beside the panel. */
function goToComment(comment: IBaseHalfComment, item: DOMRect, found: boolean): void {
	const current = comments.get(comment.id) ?? comment;
	const highlight = isBaseHalfHighlight(current);
	if (!found) {
		if (highlight) {
			notes.tools(current, item, { status: labels.passageNotFound });
		} else {
			notes.open(current, item, { status: labels.passageNotFound });
		}
		return;
	}
	const pageIndex = comments.pageOf(comment.id);
	if (pageIndex === undefined) {
		return;
	}
	const passage = passagePageRect(comment.id);
	const place = comments.place(comment.id);
	const scroll = registry?.getPlugin<ScrollPlugin>(ScrollPlugin.id)?.provides().forDocument(DOCUMENT_ID);
	const target = passage ?? (place?.kind === 'place' ? { x: place.x * (pdfDocument?.pages[pageIndex]?.size.width ?? 0), y: place.y * (pdfDocument?.pages[pageIndex]?.size.height ?? 0) } : undefined);
	if (!isShown(pageIndex, target)) {
		scroll?.scrollToPage({ pageNumber: pageIndex + 1, ...(target ? { pageCoordinates: target, alignY: 35 } : { alignY: 0 }), behavior: 'instant' });
	}
	window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
		const latest = comments.get(comment.id) ?? current;
		if (isBaseHalfHighlight(latest)) {
			const anchor = passageRect(comment.id);
			if (anchor) {
				notes.tools(latest, anchor);
			}
		} else {
			const anchor = markRect(comment.id) ?? passageRect(comment.id);
			if (anchor) {
				notes.open(latest, anchor);
			}
		}
	}));
}

/** Where a passage begins on its page, in the page's coordinates. */
function passagePageRect(id: string): { readonly x: number; readonly y: number } | undefined {
	const pageIndex = comments.pageOf(id);
	const range = pageIndex === undefined ? undefined : comments.rangesOn(pageIndex).find(entry => entry.comment.id === id);
	const geometry = pageIndex === undefined ? undefined : readGeometries.get(pageIndex);
	const rect = range && geometry ? rectsWithinSlice(geometry, range.start, range.end, true)[0] : undefined;
	return rect ? { x: rect.origin.x, y: rect.origin.y } : undefined;
}

/** Whether a place of a page, in the page's coordinates, is in sight; without a place, whether the page is. */
function isShown(pageIndex: number, point: { readonly x: number; readonly y: number } | undefined): boolean {
	const pageElement = documentHost.querySelector<HTMLElement>(`.pdf-page[data-page="${pageIndex + 1}"]`);
	if (!pageElement) {
		return false;
	}
	const shown = documentHost.getBoundingClientRect();
	const box = pageElement.getBoundingClientRect();
	if (!point) {
		return box.top >= shown.top && box.top < shown.bottom;
	}
	const scale = currentScale();
	const x = box.left + point.x * scale;
	const y = box.top + point.y * scale;
	return y >= shown.top + 40 && y <= shown.bottom - 60 && x >= shown.left && x <= shown.right;
}

// #endregion

// #region Find

let findRun = 0;

function searchScope() {
	return registry?.getPlugin<SearchPlugin>(SearchPlugin.id)?.provides().forDocument(DOCUMENT_ID);
}

/**
 * Searches the whole PDF and goes to the first match at or after the page
 * shown (PDFs and books, rule 19). The count grows while pages are searched.
 */
async function findAll(query: string): Promise<void> {
	const scope = searchScope();
	if (!scope) {
		return;
	}
	const run = ++findRun;
	if (!query) {
		scope.stopSearch();
		find.setCount(undefined, 0, false);
		return;
	}
	find.setCount(undefined, 0, false);
	try {
		const task = scope.searchAllPages(query);
		task.onProgress(() => {
			if (run === findRun) {
				find.setCount(undefined, scope.getState().results.length, false);
			}
		});
		const found = await task.toPromise();
		if (run !== findRun) {
			return;
		}
		if (found.results.length === 0) {
			find.setCount(undefined, 0, true);
			return;
		}
		const first = found.results.findIndex(result => result.pageIndex >= page - 1);
		showMatch(first === -1 ? 0 : first);
	} catch (error) {
		if (run === findRun) {
			console.warn('[BaseHalf] the search of the PDF failed', error);
			find.setCount(undefined, 0, true);
		}
	}
}

/** Enter and Shift+Enter: the next or the previous match, round from the last to the first. */
function goToMatch(direction: 1 | -1): void {
	const state = searchScope()?.getState();
	const count = state?.results.length ?? 0;
	if (!state || count === 0) {
		return;
	}
	const current = state.activeResultIndex < 0 ? (direction === 1 ? -1 : 0) : state.activeResultIndex;
	showMatch((current + direction + count) % count);
}

/** Marks a match more strongly than the others and brings it into sight when it is not. */
function showMatch(index: number): void {
	const scope = searchScope();
	const state = scope?.getState();
	const result = state?.results[index];
	if (!scope || !state || !result) {
		return;
	}
	scope.goToResult(index);
	const rect = result.rects[0];
	const point = rect ? { x: rect.origin.x, y: rect.origin.y } : undefined;
	if (!isShown(result.pageIndex, point)) {
		registry?.getPlugin<ScrollPlugin>(ScrollPlugin.id)?.provides().forDocument(DOCUMENT_ID).scrollToPage({ pageNumber: result.pageIndex + 1, ...(point ? { pageCoordinates: point, alignY: 40 } : {}), behavior: 'instant' });
	}
	find.setCount(index + 1, state.results.length, true);
}

/** The find bar closed: its marks go. */
function stopFind(): void {
	findRun++;
	searchScope()?.stopSearch();
}

// #endregion

// #region Helpers

function emitViewState(): void {
	vscode.postMessage({ type: 'basehalf.pdf.viewState', state: zoom === undefined ? { page } : { page, zoom } });
}

function requiredData(name: string): string {
	const value = root.dataset[name];
	if (!value) {
		showError('The local PDF renderer is incomplete.');
		throw new Error(`BaseHalf PDF reader data '${name}' is missing.`);
	}
	return value;
}

function storedZoom(value: string | undefined): BaseHalfPdfZoom | undefined {
	if (value === 'fit-width' || value === 'fit-page') {
		return value;
	}
	return value ? boundedNumber(value, 1, MIN_ZOOM, MAX_ZOOM) : undefined;
}

function positiveInteger(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

function boundedNumber(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function safeJson(value: string | undefined): unknown {
	try {
		return value ? JSON.parse(value) : undefined;
	} catch {
		return undefined;
	}
}

// #endregion
