/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The book reader of Card Detail (PDFs and books, "The reader" and "The book
// reader"), on foliate-js, with the reader's panel, controls, selection menu,
// and comments that it shares with the PDF reader. The book is shown from its
// own file: the page's content security policy runs no script of the book and
// loads nothing from the network, and every link to the web goes to the
// workbench.

import './reader/reader.css';
import './bookReader.css';
import { baseHalfZoomFactor, baseHalfPagePinchFromMessage } from '../../../src/vs/workbench/basehalf/cardDetail/common/basehalfCardDetailZoom.js';
import { makeComicBook } from 'foliate-js/comic-book.js';
import { Overlayer } from 'foliate-js/overlayer.js';
import { BlobReader, BlobWriter, TextWriter, ZipReader, configure } from 'foliate-js/vendor/zip.js';
import { View, type FoliateSearchResult, type IFoliateBookSource, type IFoliateLocation, type IFoliateSearchMatch, type IFoliateTocItem, type IFoliateView } from 'foliate-js/view.js';
import {
	BASEHALF_BOOK_SELECTION_TEXT_LIMIT,
	BASEHALF_BOOK_TEXT_SIZES,
	type IBaseHalfBookReaderLabels,
	type IBaseHalfBookReaderPreferences,
	type IBaseHalfBookSelection,
	normalizeBaseHalfBookReaderPreferences
} from '../../../src/vs/workbench/basehalf/documents/common/basehalfBookReaderProtocol.js';
import { normalizeBaseHalfCommentQuote } from '../../../src/vs/workbench/basehalf/comments/common/basehalfCommentAnchor.js';
import { baseHalfCommentsSetMessage, type BaseHalfCommentStep } from '../../../src/vs/workbench/basehalf/comments/common/basehalfCommentProtocol.js';
import { BASEHALF_COMMENT_DEFAULT_COLOR, baseHalfCommentCut, baseHalfCommentTime, isBaseHalfHighlight, newBaseHalfCommentId, type BaseHalfCommentColor, type IBaseHalfComment } from '../../../src/vs/workbench/basehalf/comments/common/basehalfComments.js';
import { baseHalfReaderCommandMessage, normalizeBaseHalfReaderPanelState, type IBaseHalfReaderLabels } from '../../../src/vs/workbench/basehalf/documents/common/basehalfReaderProtocol.js';
import { contextInSection, drawComment, findInSection, markBox, SectionText } from './bookComments.js';
import { CommentNotes, renderCommentList } from './reader/commentNotes.js';
import { ReaderChrome } from './reader/readerChrome.js';
import { element, isTextField } from './reader/readerDom.js';
import { installReaderHover } from './reader/readerHover.js';
import { closeReaderMenu, isReaderMenuOpen, openReaderMenu } from './reader/readerMenu.js';
import { ReaderPanel, type ReaderSearchResults } from './reader/readerPanel.js';
import { ReaderSelectionMenu } from './reader/readerSelectionMenu.js';

interface VsCodeApi {
	postMessage(message: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

function required<T extends HTMLElement>(id: string): T {
	const found = document.getElementById(id);
	if (!found) {
		throw new Error(`The book reader's element '${id}' is missing.`);
	}
	return found as T;
}

const vscode = acquireVsCodeApi();
const root = required<HTMLElement>('basehalf-reader');
const bookLabels = JSON.parse(root.dataset.labels ?? '{}') as IBaseHalfBookReaderLabels;
const labels = JSON.parse(root.dataset.readerLabels ?? '{}') as IBaseHalfReaderLabels;
const bookHost = required<HTMLElement>('book');
const status = required<HTMLElement>('status');
const statusMessage = required<HTMLElement>('status-message');
const isMac = /Mac/.test(navigator.platform);
const commandKey = isMac ? '⌘' : 'Ctrl+';

const percentFormat = new Intl.NumberFormat(root.dataset.locale || undefined, { style: 'percent' });
let preferences: IBaseHalfBookReaderPreferences = normalizeBaseHalfBookReaderPreferences({
	textSize: Number(root.dataset.textSize),
	flow: root.dataset.flow
});
let view: IFoliateView | undefined;
let selection: IBaseHalfBookSelection | undefined;
let fraction = 0;
statusMessage.textContent = bookLabels.opening;

// #region The parts of the reader

installReaderHover(root);

const chrome = new ReaderChrome(root, { location: labels.place, size: labels.textSize });
chrome.element.hidden = true;
chrome.setSize('Aa');

const panel = new ReaderPanel(root, {
	tabs: ['contents', 'comments'],
	labels,
	searchPlaceholder: labels.searchInBook,
	state: normalizeBaseHalfReaderPanelState(safeJson(root.dataset.panel)),
	onState: state => vscode.postMessage({ type: 'basehalf.reader.panel', state }),
	onSearch: (query, results) => void search(query, results),
	onClearSearch: () => view?.clearSearch(),
	onTab: tab => {
		if (tab === 'comments') {
			renderComments();
		} else {
			tocList().querySelector<HTMLButtonElement>('.toc-entry.current')?.scrollIntoView({ block: 'center' });
		}
	}
});

const notes = new CommentNotes({
	root,
	labels,
	change: (step, comment, remove) => changeComment(step, comment, remove),
	focus: id => vscode.postMessage({ type: 'basehalf.comments.focus', ...(id ? { id } : {}) }),
	grow: comment => vscode.postMessage({ type: 'basehalf.comments.grow', id: comment.id }),
	discard: comment => removeComment(comment.id)
});

const selectionMenu = new ReaderSelectionMenu(root, labels, {
	highlight: () => markSelection(false),
	comment: () => markSelection(true),
	grow: () => growSelection(),
	copy: () => copySelection()
});

// #endregion

// #region Opening the book

void open().catch(error => fail(error instanceof Error ? error.message : String(error)));

async function open(): Promise<void> {
	const source = root.dataset.source;
	if (!source) {
		throw new Error('The book reader has no book.');
	}
	const response = await fetch(source, { credentials: 'same-origin' });
	if (!response.ok) {
		throw new Error(`The book could not be read (${response.status}).`);
	}
	// foliate-js tells a comic book archive and a FictionBook by their names, in lower case.
	const file = new File([await response.blob()], (root.dataset.name || 'book.epub').toLowerCase());
	// The element foliate-js defines for a book.
	const reader: IFoliateView = new View();
	const book = file.name.endsWith('.cbz') ? await comicBook(file) : file;
	bookHost.append(reader);
	reader.addEventListener('load', event => onSectionLoad((event as CustomEvent<{ doc: Document; index: number }>).detail));
	reader.addEventListener('relocate', event => onRelocate((event as CustomEvent<IFoliateLocation>).detail));
	reader.addEventListener('external-link', event => {
		// The workbench opens a link to the web, after its own question; the page never does.
		event.preventDefault();
		const link = (event as CustomEvent<{ a: HTMLAnchorElement; href_: string }>).detail;
		vscode.postMessage({ type: 'basehalf.book.openLink', href: link.a.href || link.href_ });
	});
	// A section's overlay is made when the reader opens the section: its comments are found then.
	reader.addEventListener('create-overlay', event => findComments((event as CustomEvent<{ index: number }>).detail.index));
	reader.addEventListener('draw-annotation', event => {
		const detail = (event as CustomEvent<{ draw: (draw: typeof drawComment, options: object) => void; annotation: { value: string } }>).detail;
		const comment = commentOfCfi(detail.annotation.value);
		if (comment) {
			detail.draw(drawComment, { comment, dark: isDark() });
		}
	});
	await reader.open(book);
	// A script of the book is not even loaded; the page's policy would not run it.
	reader.book.transformTarget?.addEventListener('load', event => {
		const detail = (event as CustomEvent<{ isScript?: boolean; allow: unknown }>).detail;
		if (detail.isScript) {
			detail.allow = false;
		}
	});
	// A page of the book stays where it is: a refresh to another address would
	// only blank it, since the page may load nothing from elsewhere.
	reader.book.transformTarget?.addEventListener('data', event => {
		const detail = (event as CustomEvent<{ data: unknown; type: string }>).detail;
		if (/html|xml/i.test(detail.type)) {
			detail.data = Promise.resolve(detail.data).then(data => typeof data === 'string' ? data.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?\s*refresh[^>]*>/gi, '') : data);
		}
	});
	view = reader;
	root.classList.toggle('fixed-layout', reader.isFixedLayout);
	// A comic book and a book with a fixed layout have no size of text (PDFs and books, rule 24).
	chrome.size.hidden = reader.isFixedLayout;
	applyPreferences();
	renderContents(reader.book.toc ?? []);
	await reader.init({ lastLocation: root.dataset.location || undefined, showTextStart: !root.dataset.location });
	status.hidden = true;
	chrome.element.hidden = false;
	root.dataset.status = 'ready';
	observeTheme();
	vscode.postMessage({ type: 'basehalf.comments.ready' });
}

/**
 * A comic book archive, its pages in natural name order as foliate-js puts
 * them, without the hidden files that the system which packed it added, such
 * as those under `__MACOSX/`, and each page named by its file without the
 * extension.
 */
async function comicBook(file: File): Promise<IFoliateBookSource> {
	configure({ useWebWorkers: false });
	const entries = (await new ZipReader(new BlobReader(file)).getEntries())
		.filter(entry => !entry.directory && !entry.filename.split('/').some(part => part.startsWith('.') || part === '__MACOSX'));
	const byName = new Map(entries.map(entry => [entry.filename, entry]));
	const book = makeComicBook({
		entries,
		loadText: name => byName.get(name)?.getData(new TextWriter()) ?? null,
		loadBlob: (name, type) => byName.get(name)?.getData(new BlobWriter(type)) ?? null,
		getSize: name => byName.get(name)?.uncompressedSize ?? 0
	}, file);
	book.toc = book.toc?.map(item => ({ ...item, label: (item.label ?? '').replace(/^.*\//, '').replace(/\.[^.]+$/, '') }));
	return book;
}

function fail(message: string): void {
	root.dataset.status = 'error';
	status.classList.remove('loading');
	status.classList.add('error');
	status.hidden = false;
	statusMessage.textContent = bookLabels.failed;
	vscode.postMessage({ type: 'basehalf.book.failed', message });
}

function isDark(): boolean {
	return document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');
}

/** The book's own styles, with the editor's colors and the size of text the user chose. */
function bookStyles(): string {
	const style = getComputedStyle(document.documentElement);
	const color = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
	const dark = isDark();
	const foreground = color('--vscode-editor-foreground', dark ? '#cccccc' : '#1f1f1f');
	const link = color('--vscode-textLink-foreground', dark ? '#4daafc' : '#005fb8');
	const selectionBackground = color('--vscode-editor-selectionBackground', dark ? '#264f78' : '#add6ff');
	return `
		@namespace epub "http://www.idpf.org/2007/ops";
		html {
			color-scheme: ${dark ? 'dark' : 'light'};
			color: ${foreground};
			background: transparent !important;
			font-size: ${preferences.textSize}% !important;
		}
		body { background: transparent !important; }
		${dark ? `
		/* A book sets its text in black on white paper: on a dark page it takes the editor's colors. */
		body, body * { background-color: transparent !important; border-color: color-mix(in srgb, ${foreground} 30%, transparent) !important; }
		body, body :not(a, a *, svg, svg *) { color: ${foreground} !important; }
		` : ''}
		a:link, a:visited, a:link *, a:visited * { color: ${link} !important; }
		::selection { background: ${selectionBackground}; }
		p, li, blockquote, dd { line-height: 1.55; }
		pre { white-space: pre-wrap !important; }
		img, svg, video { max-width: 100%; }
		aside[epub|type~="footnote"], aside[epub|type~="endnote"], aside[epub|type~="note"], aside[epub|type~="rearnote"] { display: none; }
	`;
}

function applyPreferences(): void {
	const reader = view;
	if (!reader) {
		return;
	}
	if (!reader.isFixedLayout) {
		reader.renderer.setAttribute('flow', preferences.flow);
		reader.renderer.setAttribute('margin', '44px');
		reader.renderer.setAttribute('gap', '6%');
		reader.renderer.setAttribute('max-inline-size', '680px');
		reader.renderer.setAttribute('max-column-count', '2');
		reader.renderer.setStyles?.(bookStyles());
	}
	root.classList.toggle('scrolled', preferences.flow === 'scrolled');
}

function changePreferences(next: IBaseHalfBookReaderPreferences): void {
	preferences = next;
	applyPreferences();
	vscode.postMessage({ type: 'basehalf.book.preferences', preferences });
}

function observeTheme(): void {
	const observer = new MutationObserver(() => {
		applyPreferences();
		redrawComments();
	});
	observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
	observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
}

// #endregion

// #region The contents

let currentHref: string | undefined;

function tocList(): HTMLElement {
	return panel.section('contents');
}

function renderContents(items: readonly IFoliateTocItem[]): void {
	const container = tocList();
	container.replaceChildren();
	const list = element('ol', '', container);
	const add = (parent: HTMLElement, entries: readonly IFoliateTocItem[], depth: number) => {
		for (const entry of entries) {
			const item = element('li', '', parent);
			const button = element('button', 'toc-entry', item);
			button.type = 'button';
			button.style.setProperty('--depth', String(depth));
			button.textContent = entry.label?.trim() || bookLabels.untitledSection;
			if (entry.href) {
				button.dataset.href = entry.href;
				button.addEventListener('click', () => {
					void view?.goTo(entry.href!);
					panel.closeWhenOver();
				});
			} else {
				button.disabled = true;
			}
			if (entry.subitems?.length) {
				add(element('ol', '', item), entry.subitems, depth + 1);
			}
		}
	};
	add(list, items, 0);
	markCurrentEntry();
}

function markCurrentEntry(): void {
	for (const entry of tocList().querySelectorAll<HTMLButtonElement>('.toc-entry')) {
		const current = !!currentHref && entry.dataset.href === currentHref;
		entry.classList.toggle('current', current);
		if (current) {
			entry.setAttribute('aria-current', 'location');
		} else {
			entry.removeAttribute('aria-current');
		}
	}
}

// #endregion

// #region Search

async function search(query: string, results: ReaderSearchResults): Promise<void> {
	const reader = view;
	if (!reader) {
		return;
	}
	results.progress(0);
	// Matches are marked as the editor marks what Find finds.
	const style = getComputedStyle(document.documentElement);
	const color = style.getPropertyValue('--vscode-editor-findMatchHighlightBackground').trim() || 'rgb(234 92 0 / 33%)';
	for await (const result of reader.search({ query, draw: Overlayer.highlight, drawOptions: { color } })) {
		if (!results.isCurrent) {
			return;
		}
		if (result === 'done') {
			break;
		}
		const progressed = searchProgress(result);
		if (progressed !== undefined) {
			results.progress(progressed);
			continue;
		}
		const section = searchSection(result);
		if (section) {
			results.group(section.label || bookLabels.untitledSection, section.subitems.map(match => ({
				before: match.excerpt.pre,
				match: match.excerpt.match,
				after: match.excerpt.post,
				go: () => {
					void reader.goTo(match.cfi);
					panel.closeWhenOver();
				}
			})));
		}
	}
	results.done();
}

/** How far a search has gone, when a result says so. */
function searchProgress(result: FoliateSearchResult): number | undefined {
	return typeof result === 'object' && typeof (result as { readonly progress?: unknown }).progress === 'number' ? (result as { readonly progress: number }).progress : undefined;
}

/** The matches of one section of the book, when a result holds them. */
function searchSection(result: FoliateSearchResult): { readonly label: string; readonly subitems: readonly IFoliateSearchMatch[] } | undefined {
	const section = result as { readonly label?: unknown; readonly subitems?: unknown };
	return typeof result === 'object' && Array.isArray(section.subitems) ? { label: typeof section.label === 'string' ? section.label : '', subitems: section.subitems as IFoliateSearchMatch[] } : undefined;
}

// #endregion

// #region At the bottom left: the place and the size of the text

chrome.location.addEventListener('click', () => {
	const content = element('div', 'reader-place');
	const slider = element('input', '', content);
	slider.type = 'range';
	slider.min = '0';
	slider.max = '1000';
	slider.step = '1';
	slider.value = String(Math.round(fraction * 1000));
	slider.dir = view?.book.dir ?? 'ltr';
	slider.setAttribute('aria-label', labels.place);
	const shown = element('span', 'percent', content);
	shown.textContent = percentFormat.format(fraction);
	slider.addEventListener('input', () => shown.textContent = percentFormat.format(Number(slider.value) / 1000));
	// Letting go goes there (PDFs and books, rule 23).
	slider.addEventListener('change', () => void view?.goToFraction(Number(slider.value) / 1000));
	openReaderMenu(root, chrome.location, { entries: [], content });
	slider.focus();
});

chrome.size.addEventListener('click', () => {
	const index = BASEHALF_BOOK_TEXT_SIZES.indexOf(preferences.textSize);
	openReaderMenu(root, chrome.size, {
		entries: [
			{ label: labels.largerText, shortcut: `${commandKey}=`, disabled: index >= BASEHALF_BOOK_TEXT_SIZES.length - 1, run: () => textSizeBy(1) },
			{ label: labels.smallerText, shortcut: `${commandKey}-`, disabled: index <= 0, run: () => textSizeBy(-1) },
			'separator',
			{ label: labels.pagesFlow, checked: preferences.flow === 'paginated', run: () => changePreferences({ ...preferences, flow: 'paginated' }) },
			{ label: labels.scrollFlow, checked: preferences.flow === 'scrolled', run: () => changePreferences({ ...preferences, flow: 'scrolled' }) }
		]
	});
});

function textSizeBy(direction: 1 | -1): void {
	if (view?.isFixedLayout) {
		return;
	}
	const index = BASEHALF_BOOK_TEXT_SIZES.indexOf(preferences.textSize);
	const next = BASEHALF_BOOK_TEXT_SIZES[Math.min(BASEHALF_BOOK_TEXT_SIZES.length - 1, Math.max(0, index + direction))];
	if (next !== preferences.textSize) {
		changePreferences({ ...preferences, textSize: next });
	}
}

// A pinch that the window took over the page makes the text larger or smaller,
// a step of Larger Text or Smaller Text each time the fingers have spread or
// closed by as much as that step (PDFs and books, rule 36).
let pinchSpread = 0;
let pinchRest: number | undefined;
function pinchBy(factor: number): void {
	window.clearTimeout(pinchRest);
	pinchRest = window.setTimeout(() => pinchSpread = 0, 300);
	pinchSpread += Math.log(factor);
	const index = BASEHALF_BOOK_TEXT_SIZES.indexOf(preferences.textSize);
	const larger = BASEHALF_BOOK_TEXT_SIZES[index + 1];
	const smaller = BASEHALF_BOOK_TEXT_SIZES[index - 1];
	if (larger !== undefined && pinchSpread >= Math.log(larger / preferences.textSize)) {
		pinchSpread -= Math.log(larger / preferences.textSize);
		textSizeBy(1);
	} else if (smaller !== undefined && pinchSpread <= -Math.log(preferences.textSize / smaller)) {
		pinchSpread += Math.log(preferences.textSize / smaller);
		textSizeBy(-1);
	}
}

function onRelocate(location: IFoliateLocation): void {
	fraction = location.fraction ?? 0;
	chrome.setLocation(percentFormat.format(fraction));
	vscode.postMessage({ type: 'basehalf.reader.chapter', title: location.tocItem?.label?.trim() ?? '' });
	currentHref = location.tocItem?.href;
	markCurrentEntry();
	selectionMenu.hide();
	if (location.cfi) {
		vscode.postMessage({ type: 'basehalf.book.viewState', state: { location: location.cfi, fraction } });
	}
}

// #endregion

// #region Messages of the window and the keyboard

window.addEventListener('message', event => {
	const set = baseHalfCommentsSetMessage(event.data);
	if (set) {
		setComments(set.comments, set.unreadable, set.color);
		notes.update(set.comments);
		return;
	}
	const command = baseHalfReaderCommandMessage(event.data);
	if (command?.command === 'toggleSidebar') {
		panel.toggle();
	} else if (command?.command === 'search') {
		panel.focusSearch();
	}
	const pinch = baseHalfPagePinchFromMessage(event.data);
	if (pinch) {
		pinchBy(baseHalfZoomFactor(pinch));
	}
});

/**
 * The keys of the reader (PDFs and books, rules 26 and 35): Escape closes a
 * menu, a comment note, the search, the panel over the book, and then Card
 * Detail; the arrows, Page Up and Page Down, and Space turn pages.
 */
function onKeydown(event: KeyboardEvent): void {
	if (event.defaultPrevented || event.isComposing) {
		return;
	}
	const target = event.composedPath()[0] ?? event.target;
	const mod = isMac ? event.metaKey : event.ctrlKey;
	if (mod && !event.altKey && (event.key === 'f' || event.key === 'F')) {
		event.preventDefault();
		panel.focusSearch();
		return;
	}
	if (mod && !event.altKey && !isTextField(target) && (event.key === '=' || event.key === '+' || event.key === '-')) {
		event.preventDefault();
		textSizeBy(event.key === '-' ? -1 : 1);
		return;
	}
	if (event.altKey || event.ctrlKey || event.metaKey) {
		return;
	}
	if (event.key === 'Escape') {
		event.preventDefault();
		if (isReaderMenuOpen()) {
			closeReaderMenu();
		} else if (notes.escape()) {
			// The comment note closed.
		} else if (panel.isSearching && root.querySelector('.reader-search')?.contains(document.activeElement)) {
			panel.endSearch();
		} else if (selectionMenu.isShown) {
			clearSelection();
		} else if (panel.isOver) {
			panel.close();
			view?.renderer.focus();
		} else if (!event.shiftKey) {
			vscode.postMessage({ type: 'basehalf.media.escape' });
		}
		return;
	}
	if (isTextField(target) || !view) {
		return;
	}
	const turn = (() => {
		switch (event.key) {
			case 'ArrowLeft': return () => view!.goLeft();
			case 'ArrowRight': return () => view!.goRight();
			case 'PageUp': return () => view!.prev();
			case 'PageDown': return () => view!.next();
			case ' ': return event.shiftKey ? () => view!.prev() : () => view!.next();
			default: return undefined;
		}
	})();
	if (turn) {
		event.preventDefault();
		void turn();
	}
}

window.addEventListener('keydown', onKeydown);

let lastInteraction = 0;
function onInteraction(): void {
	const now = Date.now();
	if (now - lastInteraction > 500) {
		lastInteraction = now;
		vscode.postMessage({ type: 'basehalf.book.userInteraction' });
	}
}

for (const type of ['pointerdown', 'keydown', 'wheel'] as const) {
	window.addEventListener(type, onInteraction, { capture: true, passive: true });
}

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

// #endregion

// #region A section of the book: its keys, the side of the page that turns it, and what is selected in it

/** The sections the reader shows, by their index. */
const sections = new Map<number, { readonly doc: Document; text?: SectionText }>();

function sectionText(index: number): SectionText | undefined {
	const section = sections.get(index);
	if (!section) {
		return undefined;
	}
	section.text ??= new SectionText(section.doc);
	return section.text;
}

function indexOfDoc(doc: Document): number | undefined {
	for (const [index, section] of sections) {
		if (section.doc === doc) {
			return index;
		}
	}
	return undefined;
}

function onSectionLoad({ doc, index }: { doc: Document; index: number }): void {
	sections.set(index, { doc });
	doc.addEventListener('keydown', onKeydown);
	// A press in the book closes an open comment note; the note is in the reader's page, not in the section.
	doc.addEventListener('pointerdown', () => notes.pressedOutside(), true);
	for (const type of ['pointerdown', 'keydown', 'wheel'] as const) {
		doc.addEventListener(type, onInteraction, { capture: true, passive: true });
	}
	doc.addEventListener('click', event => {
		// A click on a comment's passage or mark opens it, and turns no page (comments, rules 9 and 10).
		const hit = (doc.getSelection()?.isCollapsed ?? true) ? commentAt(doc, event.clientX, event.clientY, true) : undefined;
		if (hit) {
			event.preventDefault();
			showComment(hit.comment, hit.range);
			return;
		}
		const reader = view;
		if (!reader || reader.isFixedLayout || preferences.flow !== 'paginated' || event.defaultPrevented
			|| (event.target as Element | null)?.closest?.('a[href]') || !(doc.getSelection()?.isCollapsed ?? true)) {
			return;
		}
		const side = sideOf(doc, event.clientX);
		if (side === 'left') {
			void reader.goLeft();
		} else if (side === 'right') {
			void reader.goRight();
		}
	});
	doc.addEventListener('pointermove', event => {
		// A chevron shows in the outer fifth of the page, which turns it (PDFs and books, rule 35).
		const side = view && !view.isFixedLayout && preferences.flow === 'paginated' ? sideOf(doc, event.clientX) : undefined;
		root.classList.toggle('turn-left', side === 'left');
		root.classList.toggle('turn-right', side === 'right');
		hoverComment(doc, event);
	});
	doc.addEventListener('pointerleave', () => {
		root.classList.remove('turn-left', 'turn-right');
		notes.hoverLeave();
	});
	let settling: number | undefined;
	doc.addEventListener('selectionchange', () => {
		window.clearTimeout(settling);
		settling = window.setTimeout(() => onSelection(doc), 30);
	});
	doc.addEventListener('focusin', reportTextFocus);
}

/** The side of the page a point is on: the outer fifth at the left, at the right, or neither. */
function sideOf(doc: Document, clientX: number): 'left' | 'right' | undefined {
	const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
	const area = bookHost.getBoundingClientRect();
	const x = (frame?.left ?? 0) + clientX - area.left;
	return x < area.width / 5 ? 'left' : x > area.width * 4 / 5 ? 'right' : undefined;
}

/** The passage that Grow branch was pressed for. */
let branchAskedFor: typeof selection;
/** The document and the range of the selection, for Highlight and Comment. */
let selected: { readonly doc: Document; readonly range: Range } | undefined;

function onSelection(doc: Document): void {
	const current = doc.getSelection();
	const text = current && !current.isCollapsed ? current.toString() : '';
	if (!text.trim() || !current) {
		if (!selected || selected.doc === doc) {
			selected = undefined;
			if (selection) {
				selection = undefined;
				vscode.postMessage({ type: 'basehalf.book.selectionChanged' });
			}
			selectionMenu.hide();
		}
		return;
	}
	const range = current.getRangeAt(0);
	const chapter = view?.lastLocation?.tocItem?.label?.trim();
	const next = { text: text.slice(0, BASEHALF_BOOK_SELECTION_TEXT_LIMIT), ...(chapter ? { chapter } : {}) };
	if (selection?.text !== next.text) {
		selection = next;
		vscode.postMessage({ type: 'basehalf.book.selectionChanged', selection });
	}
	selected = { doc, range: range.cloneRange() };
	const rects = range.getClientRects();
	const first = rects[0] ?? range.getBoundingClientRect();
	const last = rects[rects.length - 1] ?? first;
	selectionMenu.show(toReader(doc, first), toReader(doc, last));
}

/** A box of a section's document in the coordinates of the reader's page. */
function toReader(doc: Document, rect: DOMRect): DOMRect {
	const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
	return new DOMRect((frame?.left ?? 0) + rect.left, (frame?.top ?? 0) + rect.top, rect.width, rect.height);
}

function clearSelection(): void {
	selected?.doc.getSelection()?.removeAllRanges();
	selected = undefined;
	selectionMenu.hide();
}

function growSelection(): void {
	// The passage stays selected: Card Detail closes on the page as the user
	// last saw it (reference graph, "Creating connected nodes"). A second press
	// on the same passage grows no second branch.
	if (selection && branchAskedFor !== selection) {
		branchAskedFor = selection;
		vscode.postMessage({ type: 'basehalf.book.createBranch', selection });
	}
}

function copySelection(): void {
	selected?.doc.execCommand('copy');
	selectionMenu.hide();
}

// #endregion

// #region Comments

let comments: IBaseHalfComment[] = [];
const drafts = new Map<string, IBaseHalfComment>();
let unreadable = false;
let color: BaseHalfCommentColor = BASEHALF_COMMENT_DEFAULT_COLOR;
/** Where each comment found its passage, by the canonical fragment that foliate-js names a place of the book by. */
const anchors = new Map<string, { readonly cfi: string; readonly index: number }>();
const cfis = new Map<string, string>();
/** The ranges of the places that the reader shows, for the pointer over them. */
const ranges = new Map<string, Range>();

function allComments(): IBaseHalfComment[] {
	return [...comments.filter(comment => !drafts.has(comment.id)), ...drafts.values()];
}

function commentById(id: string): IBaseHalfComment | undefined {
	return drafts.get(id) ?? comments.find(comment => comment.id === id);
}

function commentOfCfi(cfi: string): IBaseHalfComment | undefined {
	const id = cfis.get(cfi);
	return id ? commentById(id) : undefined;
}

function setComments(next: readonly IBaseHalfComment[], isUnreadable: boolean, nextColor: BaseHalfCommentColor): void {
	const ids = new Set(next.map(comment => comment.id));
	for (const [id, anchor] of [...anchors]) {
		const before = commentById(id);
		const after = next.find(comment => comment.id === id);
		// A comment that is gone, or whose passage was quoted anew, is found again.
		if ((!ids.has(id) && !drafts.has(id)) || (after && before && (after.quote !== before.quote || after.before !== before.before || after.after !== before.after))) {
			void view?.deleteAnnotation({ value: anchor.cfi });
			anchors.delete(id);
			cfis.delete(anchor.cfi);
			ranges.delete(anchor.cfi);
		}
	}
	comments = [...next];
	unreadable = isUnreadable;
	color = nextColor;
	for (const comment of next) {
		drafts.delete(comment.id);
	}
	redrawComments();
	for (const index of sections.keys()) {
		findComments(index);
	}
	renderComments();
}

/** The comments whose passage is in a section the reader has opened, found by their quote (comments, rule 1). */
function findComments(index: number): void {
	const reader = view;
	const section = sections.get(index);
	const text = sectionText(index);
	if (!reader || !section || !text) {
		return;
	}
	for (const comment of allComments()) {
		const anchor = anchors.get(comment.id);
		if (anchor) {
			if (anchor.index === index) {
				void reader.addAnnotation({ value: anchor.cfi });
			}
			continue;
		}
		const range = findInSection(section.doc, text, comment);
		if (!range) {
			continue;
		}
		const cfi = reader.getCFI(index, range);
		anchors.set(comment.id, { cfi, index });
		cfis.set(cfi, comment.id);
		ranges.set(cfi, range);
		void reader.addAnnotation({ value: cfi });
	}
	renderComments();
}

/** Every comment's tint and mark again, as its color or words, or the theme, changed. */
function redrawComments(): void {
	for (const anchor of anchors.values()) {
		void view?.addAnnotation({ value: anchor.cfi });
	}
}

function changeComment(step: BaseHalfCommentStep, comment: IBaseHalfComment | undefined, remove?: string): void {
	if (remove) {
		removeComment(remove);
		vscode.postMessage({ type: 'basehalf.comments.change', step, remove });
		return;
	}
	if (!comment) {
		return;
	}
	drafts.delete(comment.id);
	const index = comments.findIndex(existing => existing.id === comment.id);
	if (index === -1) {
		comments.push(comment);
	} else {
		comments[index] = comment;
	}
	const anchor = anchors.get(comment.id);
	if (anchor) {
		void view?.addAnnotation({ value: anchor.cfi });
	}
	vscode.postMessage({ type: 'basehalf.comments.change', step, comment });
	renderComments();
}

function removeComment(id: string): void {
	drafts.delete(id);
	comments = comments.filter(comment => comment.id !== id);
	const anchor = anchors.get(id);
	if (anchor) {
		void view?.deleteAnnotation({ value: anchor.cfi });
		anchors.delete(id);
		cfis.delete(anchor.cfi);
		ranges.delete(anchor.cfi);
	}
	renderComments();
}

/** Highlight, or Comment, on the selected passage (comments, rule 16). */
function markSelection(withWords: boolean): void {
	const reader = view;
	const current = selected;
	if (!reader || !current || !selection) {
		return;
	}
	const index = indexOfDoc(current.doc);
	const text = index === undefined ? undefined : sectionText(index);
	if (index === undefined || !text) {
		return;
	}
	const context = contextInSection(text, current.range);
	const comment: IBaseHalfComment = {
		id: newBaseHalfCommentId(new Set(allComments().map(existing => existing.id))),
		...(selection.chapter ? { chapter: selection.chapter } : {}),
		quote: baseHalfCommentCut(normalizeBaseHalfCommentQuote(current.range.toString())),
		...(context.before ? { before: context.before } : {}),
		...(context.after ? { after: context.after } : {}),
		color,
		text: '',
		at: baseHalfCommentTime(),
		replies: []
	};
	const cfi = reader.getCFI(index, current.range);
	const mark = markBox(current.range.getClientRects());
	anchors.set(comment.id, { cfi, index });
	cfis.set(cfi, comment.id);
	ranges.set(cfi, current.range);
	const doc = current.doc;
	clearSelection();
	if (withWords) {
		drafts.set(comment.id, comment);
		void reader.addAnnotation({ value: cfi });
		if (mark) {
			notes.open(comment, toReader(doc, mark), { unsaved: true });
		}
		return;
	}
	changeComment('highlight', comment);
}

/** A click on a comment's passage: its note, or the tools of a highlight (comments, rules 9 and 10). */
function showComment(comment: IBaseHalfComment, range: Range): void {
	const doc = range.startContainer.ownerDocument;
	if (!doc) {
		return;
	}
	const rects = range.getClientRects();
	if (isBaseHalfHighlight(comment)) {
		const first = rects[0];
		if (first) {
			notes.tools(comment, toReader(doc, first));
		}
		return;
	}
	const mark = markBox(rects);
	if (mark) {
		notes.open(comment, toReader(doc, mark));
	}
}

/**
 * The comment under a point of a section: its passage, or its mark. Only
 * comments with words count for the pointer that hovers, and every comment
 * for a click.
 */
function commentAt(doc: Document, x: number, y: number, highlights: boolean): { readonly comment: IBaseHalfComment; readonly range: Range; readonly mark: DOMRect | undefined } | undefined {
	const index = indexOfDoc(doc);
	const inside = (box: DOMRect) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
	for (const [id, anchor] of [...anchors].reverse()) {
		const comment = commentById(id);
		const range = ranges.get(anchor.cfi);
		if (anchor.index !== index || !comment || !range || range.startContainer.ownerDocument !== doc || (!highlights && isBaseHalfHighlight(comment))) {
			continue;
		}
		const rects = [...range.getClientRects()];
		const mark = isBaseHalfHighlight(comment) ? undefined : markBox(rects);
		if (rects.some(inside) || (mark && inside(mark))) {
			return { comment, range, mark };
		}
	}
	return undefined;
}

/** The pointer on the passage or the mark of a comment with words shows its note (comments, rule 8). */
let hovered: string | undefined;
function hoverComment(doc: Document, event: PointerEvent): void {
	if (event.buttons) {
		return;
	}
	const found = commentAt(doc, event.clientX, event.clientY, false);
	if (found?.comment.id === hovered) {
		return;
	}
	hovered = found?.comment.id;
	if (found?.mark) {
		const { comment, mark } = found;
		notes.hoverEnter(comment, () => toReader(doc, mark));
	} else {
		notes.hoverLeave();
	}
}

/** The Comments list, in the order of the book (comments, rule 22). */
function renderComments(): void {
	if (panel.tab !== 'comments' || !panel.isOpen) {
		return;
	}
	const items = allComments().filter(comment => !drafts.has(comment.id)).map(comment => {
		const anchor = anchors.get(comment.id);
		return { comment, location: comment.chapter, found: !!anchor || !!comment.chapter, order: anchor?.index ?? Number.MAX_SAFE_INTEGER };
	}).sort((left, right) => left.order - right.order);
	renderCommentList(panel.section('comments'), items, labels, unreadable, comment => void goToComment(comment));
}

/** Goes to a comment's passage and opens its note: where it was found, or where its quote is found in the book. */
async function goToComment(comment: IBaseHalfComment): Promise<void> {
	const reader = view;
	if (!reader) {
		return;
	}
	panel.closeWhenOver();
	let cfi = anchors.get(comment.id)?.cfi;
	if (!cfi && comment.quote) {
		for await (const result of reader.search({ query: comment.quote.slice(0, 200) })) {
			if (result === 'done') {
				break;
			}
			const section = searchSection(result);
			if (section?.subitems[0]) {
				cfi = section.subitems[0].cfi;
				break;
			}
		}
		reader.clearSearch();
	}
	if (!cfi) {
		return;
	}
	await reader.goTo(cfi);
	window.setTimeout(() => {
		const anchor = anchors.get(comment.id);
		const range = anchor ? ranges.get(anchor.cfi) : undefined;
		const current = commentById(comment.id);
		if (range && current) {
			showComment(current, range);
		}
	}, 150);
}

// #endregion

function safeJson(value: string | undefined): unknown {
	try {
		return value ? JSON.parse(value) : undefined;
	} catch {
		return undefined;
	}
}
