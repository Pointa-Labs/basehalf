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
import { compare } from 'foliate-js/epubcfi.js';
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
import { baseHalfReaderCommandMessage, normalizeBaseHalfReaderPanelState, type IBaseHalfReaderLabels, type IBaseHalfReaderPanelState } from '../../../src/vs/workbench/basehalf/documents/common/basehalfReaderProtocol.js';
import { contextInSection, drawPassages, findInSection, SectionText } from './bookComments.js';
import { CommentNotes, COMMENT_MARK_SIZE, stackCommentMarks } from './reader/commentNotes.js';
import { ReaderChrome } from './reader/readerChrome.js';
import { ReaderCommentsPanel, type ICommentsPanelItem } from './reader/readerComments.js';
import { element, isTextField } from './reader/readerDom.js';
import { ReaderFindBar } from './reader/readerFind.js';
import { installReaderHover } from './reader/readerHover.js';
import { closeReaderMenu, isReaderMenuOpen, openReaderMenu } from './reader/readerMenu.js';
import { observeReaderWidth, ReaderPanel } from './reader/readerPanel.js';
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

observeReaderWidth(root);

/** How the panels stand, which Card Detail keeps for the next book (PDFs and books, rule 18). */
let panels: IBaseHalfReaderPanelState = normalizeBaseHalfReaderPanelState(safeJson(root.dataset.panel));
function keepPanels(change: Partial<IBaseHalfReaderPanelState>): void {
	panels = { ...panels, ...change };
	vscode.postMessage({ type: 'basehalf.reader.panel', state: panels });
}

const panel = new ReaderPanel(root, {
	tabs: ['contents'],
	labels,
	state: panels,
	onState: state => keepPanels(state),
	onTab: () => tocList().querySelector<HTMLButtonElement>('.toc-entry.current')?.scrollIntoView({ block: 'center' })
});

const commentsPanel = new ReaderCommentsPanel(root, {
	labels,
	open: panels.comments,
	items: () => commentItems(),
	onOpen: open => keepPanels({ comments: open }),
	go: (comment, anchor) => void goToComment(comment, anchor)
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
	grow: comment => vscode.postMessage({ type: 'basehalf.comments.grow', id: comment.id }),
	discard: comment => removeComment(comment.id),
	closed: () => scheduleMarks(),
	commentOn: highlight => commentOn(highlight)
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
	// A section's overlay is made when the reader opens the section: its comments are found then, and the match of Find shown is drawn again.
	reader.addEventListener('create-overlay', event => {
		findComments((event as CustomEvent<{ index: number }>).detail.index);
		if (activeMatch) {
			void reader.addAnnotation({ value: activeMatch });
		}
	});
	reader.addEventListener('draw-annotation', event => {
		const detail = (event as CustomEvent<{ draw: (draw: typeof drawPassages, options: Parameters<typeof drawPassages>[1]) => void; annotation: { value: string }; range?: unknown }>).detail;
		const value = detail.annotation.value;
		// A section opened again is a new document: its passages are ranges of that one, made by its own window.
		const range = detail.range as Range | undefined;
		if (typeof range?.getClientRects === 'function' && commentsAt(value).length) {
			ranges.set(value, range);
			scheduleMarks();
		}
		const shown = commentsAt(value);
		const match = value === activeMatch ? findColors().active : undefined;
		if (shown.length || match) {
			detail.draw(drawPassages, { comments: shown, isComment, dark: isDark(), ...(match ? { match } : {}) });
		}
	});
	await reader.open(book);
	// The marks of comments move with the text: the page turns, or the text scrolls (comments, rule 7).
	reader.renderer.addEventListener('scroll', () => scheduleMarks());
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
	// The kind of the theme decides (light and dark, rule 2): a high contrast light theme also has the class of high contrast.
	return !document.body.classList.contains('vscode-light') && !document.body.classList.contains('vscode-high-contrast-light');
}

/** The book's own styles, with the editor's colors and the size of text the user chose. */
function bookStyles(): string {
	const style = getComputedStyle(document.documentElement);
	// The theme's colors always have a value in a page (light and dark, rule 1).
	const color = (name: string) => style.getPropertyValue(name).trim();
	const dark = isDark();
	const foreground = color('--vscode-editor-foreground');
	const link = color('--vscode-textLink-foreground');
	const selectionBackground = color('--vscode-editor-selectionBackground');
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

// #region Find

let findRun = 0;
/** The matches found so far, in the order of the book, by their canonical fragments. */
let matches: string[] = [];
let matchIndex = -1;
let findDone = false;
/** The match shown, marked more strongly than the others. */
let activeMatch: string | undefined;

/** The colors of the matches of Find, as the editor marks them. */
function findColors(): { readonly all: string; readonly active: string } {
	const style = getComputedStyle(document.documentElement);
	return {
		all: style.getPropertyValue('--vscode-editor-findMatchHighlightBackground').trim(),
		active: style.getPropertyValue('--vscode-editor-findMatchBackground').trim()
	};
}

/**
 * Searches the whole book, a section at a time, and goes to the first match
 * at or after the place shown as soon as it is found; the count grows as the
 * sections are searched (PDFs and books, rule 19).
 */
async function findAll(query: string): Promise<void> {
	const reader = view;
	if (!reader) {
		return;
	}
	const run = ++findRun;
	reader.clearSearch();
	setActiveMatch(undefined);
	matches = [];
	matchIndex = -1;
	findDone = false;
	find.setCount(undefined, 0, false);
	find.setProgress(undefined);
	if (!query) {
		return;
	}
	find.setProgress(0);
	const here = selectionCfi(reader, query) ?? reader.lastLocation?.cfi;
	let went = false;
	for await (const result of reader.search({ query, draw: Overlayer.highlight, drawOptions: { color: findColors().all } })) {
		if (run !== findRun) {
			return;
		}
		if (result === 'done') {
			break;
		}
		const progress = (result as { readonly progress?: unknown }).progress;
		if (typeof progress === 'number') {
			find.setProgress(progress);
		}
		const section = searchSection(result);
		if (!section) {
			continue;
		}
		matches.push(...section.subitems.map(match => match.cfi));
		if (!went) {
			const at = here ? matches.findIndex(cfi => safeCompare(cfi, here) >= 0) : 0;
			if (at !== -1) {
				went = true;
				showMatch(at);
			}
		}
		find.setCount(matchIndex >= 0 ? matchIndex + 1 : undefined, matches.length, false);
	}
	if (run !== findRun) {
		return;
	}
	findDone = true;
	find.setProgress(undefined);
	if (!went && matches.length) {
		// None after the place shown: the first of the book.
		showMatch(0);
	}
	find.setCount(matchIndex >= 0 ? matchIndex + 1 : undefined, matches.length, true);
}

/** Where the selected text starts, when Find took it as its words: the match marked first is the one selected. */
function selectionCfi(reader: IFoliateView, query: string): string | undefined {
	const current = selected;
	const index = current ? indexOfDoc(current.doc) : undefined;
	if (!current || index === undefined || selection?.text.trim() !== query) {
		return undefined;
	}
	const start = current.range.cloneRange();
	start.collapse(true);
	return reader.getCFI(index, start);
}

function safeCompare(a: string, b: string): number {
	try {
		return compare(a, b);
	} catch {
		return 0;
	}
}

/** Enter and Shift+Enter: the next or the previous match, round from the last to the first. */
function goToMatch(direction: 1 | -1): void {
	if (matches.length === 0) {
		return;
	}
	const current = matchIndex < 0 ? (direction === 1 ? -1 : 0) : matchIndex;
	showMatch((current + direction + matches.length) % matches.length);
}

function showMatch(index: number): void {
	const cfi = matches[index];
	if (!cfi || !view) {
		return;
	}
	matchIndex = index;
	setActiveMatch(cfi);
	void view.goTo(cfi);
	find.setCount(index + 1, matches.length, findDone);
}

/** Draws the match shown more strongly, and the one before as the others again. */
function setActiveMatch(cfi: string | undefined): void {
	const previous = activeMatch;
	activeMatch = cfi;
	if (previous && previous !== cfi) {
		void (commentsAt(previous).length ? view?.addAnnotation({ value: previous }) : view?.deleteAnnotation({ value: previous }));
	}
	if (cfi) {
		void view?.addAnnotation({ value: cfi });
	}
}

/** The find bar closed: its marks go. */
function stopFind(): void {
	findRun++;
	view?.clearSearch();
	setActiveMatch(undefined);
	matches = [];
	matchIndex = -1;
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
	scheduleMarks();
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
	} else if (command?.command === 'find') {
		find.open(selection?.text);
	} else if (command?.command === 'toggleComments') {
		commentsPanel.toggle();
	}
	const pinch = baseHalfPagePinchFromMessage(event.data);
	if (pinch) {
		pinchBy(baseHalfZoomFactor(pinch));
	}
});

/**
 * The keys of the reader (PDFs and books, rules 26 and 35): Escape closes a
 * menu, a comment note or the tools of a highlight, the find bar, the
 * selection, a panel over the book, and then Card Detail; the arrows, Page Up
 * and Page Down, and Space turn pages.
 */
function onKeydown(event: KeyboardEvent): void {
	if (event.isComposing) {
		return;
	}
	const mod = isMac ? event.metaKey : event.ctrlKey;
	// Cmd+F shows the find bar. The page that holds the reader prevents its default first, so that the browser's own find does not open.
	if (mod && !event.altKey && !event.shiftKey && (event.key === 'f' || event.key === 'F')) {
		event.preventDefault();
		find.open(selection?.text);
		return;
	}
	// Cmd+G and Shift+Cmd+G go from match to match while the find bar shows, wherever the keyboard is in the reader (PDFs and books, rule 19).
	if (mod && !event.altKey && (event.key === 'g' || event.key === 'G') && find.hasQuery) {
		event.preventDefault();
		find.go(event.shiftKey ? -1 : 1);
		return;
	}
	if (event.defaultPrevented) {
		return;
	}
	const target = event.composedPath()[0] ?? event.target;
	// The keys of the size of the text are the book's wherever the keyboard is in the reader; the window does not zoom (PDFs and books, rule 24).
	if (mod && !event.altKey && (event.key === '=' || event.key === '+' || event.key === '-')) {
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
			// The comment note or the tools closed.
		} else if (find.isOpen) {
			find.close();
			view?.renderer.focus();
		} else if (selectionMenu.isShown) {
			clearSelection();
		} else if (commentsPanel.isOver) {
			commentsPanel.close();
			view?.renderer.focus();
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
	// The back and forward buttons of a mouse go back and forward wherever the pointer is (the shown place and the
	// workbench, rule 2). The window hears them from this page by itself, and not from the book's text, which is
	// a frame inside the page: the page tells the window, which takes them as pressed on the page.
	for (const type of ['mousedown', 'mouseup'] as const) {
		doc.addEventListener(type, event => {
			if (event.isTrusted && (event.button === 3 || event.button === 4)) {
				event.preventDefault();
				vscode.postMessage({ type: 'basehalf.book.mouseButton', event: type, button: event.button });
			}
		}, { capture: true });
	}
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
/** Where each highlight and comment found its passage, by the canonical fragment that foliate-js names a place of the book by. */
const anchors = new Map<string, { readonly cfi: string; readonly index: number }>();
/** The ranges of the places that the reader shows, for the pointer over them. */
const ranges = new Map<string, Range>();
/** The title of the contents of a section, as the overlay of the section said it. */
const sectionLabels = new Map<number, string>();

function allComments(): IBaseHalfComment[] {
	return [...comments.filter(comment => !drafts.has(comment.id)), ...drafts.values()];
}

function commentById(id: string): IBaseHalfComment | undefined {
	return drafts.get(id) ?? comments.find(comment => comment.id === id);
}

/** Whether an entry is drawn as a comment: one with words or replies, and one just made by Comment (comments, rules 6 and 7). */
function isComment(comment: IBaseHalfComment): boolean {
	return drafts.has(comment.id) || !isBaseHalfHighlight(comment);
}

/** The highlights and comments whose passage is this place of the book: one place draws them all. */
function commentsAt(cfi: string): IBaseHalfComment[] {
	const found: IBaseHalfComment[] = [];
	for (const [id, anchor] of anchors) {
		const comment = anchor.cfi === cfi ? commentById(id) : undefined;
		if (comment) {
			found.push(comment);
		}
	}
	return found;
}

/** Draws a place again, or takes its drawing away when nothing stands there any more. */
function redrawPlace(cfi: string): void {
	if (commentsAt(cfi).length || cfi === activeMatch) {
		void view?.addAnnotation({ value: cfi });
	} else {
		void view?.deleteAnnotation({ value: cfi });
		ranges.delete(cfi);
	}
}

function anchor(id: string, cfi: string, index: number): void {
	anchors.set(id, { cfi, index });
	void view?.addAnnotation({ value: cfi }).then(shown => {
		const label = (shown as { readonly label?: unknown } | undefined)?.label;
		if (typeof label === 'string' && label) {
			sectionLabels.set(index, label);
		}
	});
}

function unanchor(id: string): void {
	const anchored = anchors.get(id);
	if (anchored) {
		anchors.delete(id);
		redrawPlace(anchored.cfi);
		scheduleMarks();
	}
}

function setComments(next: readonly IBaseHalfComment[], isUnreadable: boolean, nextColor: BaseHalfCommentColor): void {
	const ids = new Set(next.map(comment => comment.id));
	for (const id of [...anchors.keys()]) {
		const before = commentById(id);
		const after = next.find(comment => comment.id === id);
		// A comment that is gone, or whose passage was quoted anew, is found again.
		if ((!ids.has(id) && !drafts.has(id)) || (after && before && (after.quote !== before.quote || after.before !== before.before || after.after !== before.after))) {
			unanchor(id);
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
	commentsPanel.refresh();
}

/** The highlights and comments whose passage is in a section the reader has opened, found by their quote (comments, rule 1). */
function findComments(index: number): void {
	const reader = view;
	const section = sections.get(index);
	const text = sectionText(index);
	if (!reader || !section || !text) {
		return;
	}
	for (const comment of allComments()) {
		const anchored = anchors.get(comment.id);
		if (anchored) {
			if (anchored.index === index) {
				void reader.addAnnotation({ value: anchored.cfi });
			}
			continue;
		}
		const range = findInSection(section.doc, text, comment);
		if (!range) {
			continue;
		}
		const cfi = reader.getCFI(index, range);
		ranges.set(cfi, ranges.get(cfi) ?? range);
		anchor(comment.id, cfi, index);
	}
	commentsPanel.refresh();
}

/** Every passage drawn again, as a color or words, or the theme, changed. */
function redrawComments(): void {
	for (const cfi of new Set([...anchors.values()].map(anchored => anchored.cfi))) {
		void view?.addAnnotation({ value: cfi });
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
	const anchored = anchors.get(comment.id);
	if (anchored) {
		void view?.addAnnotation({ value: anchored.cfi });
	}
	vscode.postMessage({ type: 'basehalf.comments.change', step, comment });
	commentsPanel.refresh();
}

function removeComment(id: string): void {
	drafts.delete(id);
	comments = comments.filter(comment => comment.id !== id);
	unanchor(id);
	commentsPanel.refresh();
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
		// A highlight takes the color used last; a comment has none (comments, rules 16 and 19).
		color: withWords ? BASEHALF_COMMENT_DEFAULT_COLOR : color,
		text: '',
		at: baseHalfCommentTime(),
		replies: []
	};
	const cfi = reader.getCFI(index, current.range);
	const first = current.range.getClientRects()[0];
	ranges.set(cfi, ranges.get(cfi) ?? current.range);
	const doc = current.doc;
	clearSelection();
	if (withWords) {
		drafts.set(comment.id, comment);
		anchor(comment.id, cfi, index);
		const mark = markRect(comment.id) ?? (first ? toReader(doc, first) : undefined);
		if (mark) {
			notes.open(comment, mark, { unsaved: true });
		}
		return;
	}
	anchor(comment.id, cfi, index);
	changeComment('highlight', comment);
}

/**
 * Comment in the tools of a highlight (comments, rule 10): the note of a
 * comment on its passage, or a comment made on the passage, which keeps its
 * highlight.
 */
function commentOn(highlight: IBaseHalfComment): void {
	const anchored = anchors.get(highlight.id);
	const range = anchored ? ranges.get(anchored.cfi) : undefined;
	if (!anchored || !range) {
		return;
	}
	const existing = allComments().find(other => {
		const otherAnchor = other.id !== highlight.id && isComment(other) ? anchors.get(other.id) : undefined;
		const otherRange = otherAnchor ? ranges.get(otherAnchor.cfi) : undefined;
		return !!otherRange && overlaps(range, otherRange);
	});
	if (existing) {
		const existingRange = ranges.get(anchors.get(existing.id)!.cfi)!;
		showComment(existing, existingRange);
		return;
	}
	const { color: _color, at: _at, ...passage } = highlight;
	const comment: IBaseHalfComment = {
		...passage,
		id: newBaseHalfCommentId(new Set(allComments().map(other => other.id))),
		color: BASEHALF_COMMENT_DEFAULT_COLOR,
		text: '',
		at: baseHalfCommentTime(),
		replies: []
	};
	drafts.set(comment.id, comment);
	anchor(comment.id, anchored.cfi, anchored.index);
	const doc = range.startContainer.ownerDocument;
	const first = range.getClientRects()[0];
	const mark = markRect(comment.id) ?? (doc && first ? toReader(doc, first) : undefined);
	if (mark) {
		notes.open(comment, mark, { unsaved: true });
	}
}

/** Whether two passages of one section share text. */
function overlaps(a: Range, b: Range): boolean {
	if (a.startContainer.ownerDocument !== b.startContainer.ownerDocument) {
		return false;
	}
	try {
		return a.compareBoundaryPoints(Range.START_TO_END, b) > 0 && a.compareBoundaryPoints(Range.END_TO_START, b) < 0;
	} catch {
		return false;
	}
}

/** A click on a passage: the tools of its highlight, or the note of its comment (comments, rules 9 and 10). */
function showComment(comment: IBaseHalfComment, range: Range): void {
	const doc = range.startContainer.ownerDocument;
	if (!doc) {
		return;
	}
	const rects = range.getClientRects();
	if (!isComment(comment)) {
		const first = rects[0];
		if (first) {
			notes.tools(comment, toReader(doc, first));
		}
		return;
	}
	const mark = markRect(comment.id) ?? (rects[0] ? toReader(doc, rects[0]) : undefined);
	if (mark) {
		notes.open(comment, mark, { unsaved: drafts.has(comment.id) });
	}
}

/**
 * The highlight or the comment whose passage is under a point of a section.
 * With `highlights`, a highlight there comes first, as a click finds it;
 * without, only comments count, as for the pointer that hovers. A comment's
 * mark stands outside the section, in the reader's own layer.
 */
function commentAt(doc: Document, x: number, y: number, highlights: boolean): { readonly comment: IBaseHalfComment; readonly range: Range } | undefined {
	const index = indexOfDoc(doc);
	const inside = (box: DOMRect) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
	let commentHit: { readonly comment: IBaseHalfComment; readonly range: Range } | undefined;
	for (const [id, anchored] of [...anchors].reverse()) {
		const comment = commentById(id);
		const range = ranges.get(anchored.cfi);
		if (anchored.index !== index || !comment || !range || range.startContainer.ownerDocument !== doc) {
			continue;
		}
		const rects = [...range.getClientRects()];
		if (!isComment(comment)) {
			if (highlights && rects.some(inside)) {
				return { comment, range };
			}
			continue;
		}
		if (!commentHit && rects.some(inside)) {
			commentHit = { comment, range };
		}
	}
	return commentHit;
}

/** The pointer on the passage or the mark of a comment shows its note (comments, rule 8). */
let hovered: string | undefined;
function hoverComment(doc: Document, event: PointerEvent): void {
	if (event.buttons) {
		return;
	}
	const found = commentAt(doc, event.clientX, event.clientY, false);
	const id = found && !drafts.has(found.comment.id) ? found.comment.id : undefined;
	if (id === hovered) {
		return;
	}
	hovered = id;
	if (found && id) {
		const { comment, range } = found;
		notes.hoverEnter(comment, () => markRect(id) ?? (range.getClientRects()[0] ? toReader(doc, range.getClientRects()[0]) : undefined));
	} else {
		notes.hoverLeave();
	}
}

/**
 * The highlights and comments of the Comments panel, in the order of the
 * book (comments, rule 22): by section, and in a section by where the passage
 * begins. One with a chapter whose section the reader has not opened is
 * listed under its chapter, after those found.
 */
function commentItems(): { readonly items: readonly ICommentsPanelItem[]; readonly unreadable: boolean } {
	const listed = allComments().filter(comment => !drafts.has(comment.id)).map(comment => {
		const anchored = anchors.get(comment.id);
		return {
			comment,
			location: comment.chapter ?? (anchored ? sectionLabels.get(anchored.index) : undefined),
			found: !!anchored || !!comment.chapter,
			index: anchored?.index ?? Number.MAX_SAFE_INTEGER,
			range: anchored ? ranges.get(anchored.cfi) : undefined
		};
	});
	listed.sort((left, right) => left.index - right.index || (left.range && right.range && left.range.startContainer.ownerDocument === right.range.startContainer.ownerDocument ? safeBoundary(left.range, right.range) : 0));
	return { items: listed, unreadable };
}

function safeBoundary(a: Range, b: Range): number {
	try {
		return a.compareBoundaryPoints(Range.START_TO_START, b);
	} catch {
		return 0;
	}
}

/** Goes to a passage and opens its note or tools: where it was found, or where its quote is found in the book; one not found opens beside the panel. */
async function goToComment(comment: IBaseHalfComment, item: DOMRect): Promise<void> {
	const reader = view;
	if (!reader) {
		return;
	}
	const current = commentById(comment.id) ?? comment;
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
		if (isComment(current)) {
			notes.open(current, item, { status: labels.passageNotFound });
		} else {
			notes.tools(current, item, { status: labels.passageNotFound });
		}
		return;
	}
	await reader.goTo(cfi);
	window.setTimeout(() => {
		const anchored = anchors.get(comment.id);
		const range = anchored ? ranges.get(anchored.cfi) : undefined;
		const latest = commentById(comment.id);
		if (range && latest) {
			showComment(latest, range);
		}
	}, 150);
}


/** The marks of comments, over the book, each in the blank to the right of the column its passage begins in (comments, rule 7). */
const marksLayer = element('div', 'book-marks', bookHost);
const markElements = new Map<string, HTMLButtonElement>();
let marksFrame: number | undefined;
new ResizeObserver(() => scheduleMarks()).observe(bookHost);

/** The marks stand anew at the next frame: the page turned or scrolled, the text was laid out again, or a comment changed. */
function scheduleMarks(): void {
	if (marksFrame === undefined) {
		marksFrame = window.requestAnimationFrame(() => {
			marksFrame = undefined;
			renderMarks();
		});
	}
}

function renderMarks(): void {
	const reader = view;
	const area = bookHost.getBoundingClientRect();
	const placed: { readonly id: string; readonly left: number; readonly top: number }[] = [];
	for (const [id, anchored] of reader ? anchors : []) {
		const comment = commentById(id);
		const range = ranges.get(anchored.cfi);
		const place = comment && range && isComment(comment) ? markPlace(reader!, range, area) : undefined;
		if (place) {
			placed.push({ id, ...place });
		}
	}
	// Marks of one column that would cover one another stand one under the other.
	const columns = new Map<number, typeof placed>();
	for (const mark of placed) {
		const column = Math.round(mark.left);
		columns.set(column, [...columns.get(column) ?? [], mark]);
	}
	const shown = new Set<string>();
	for (const mark of [...columns.values()].flatMap(column => stackCommentMarks(column))) {
		shown.add(mark.id);
		let button = markElements.get(mark.id);
		if (!button) {
			button = makeMark(mark.id);
			markElements.set(mark.id, button);
		}
		button.style.left = `${mark.left}px`;
		button.style.top = `${mark.top}px`;
		button.classList.toggle('open', notes.openId === mark.id);
	}
	for (const [id, button] of markElements) {
		if (!shown.has(id)) {
			button.remove();
			markElements.delete(id);
		}
	}
}

/**
 * Where a comment's mark stands in the layer, its middle and its top: in
 * the middle of the blank between the column its passage begins in and the
 * next column or the edge of the reader, at most 24 px from the column, on
 * the passage's first line; nowhere while that line is on another page.
 */
function markPlace(reader: IFoliateView, range: Range, area: DOMRect): { readonly left: number; readonly top: number } | undefined {
	const doc = range.startContainer.ownerDocument;
	const frameElement = doc?.defaultView?.frameElement;
	const first = [...range.getClientRects()].find(rect => rect.width > 0 && rect.height > 0);
	if (!doc || !frameElement?.isConnected || !first) {
		return undefined;
	}
	const frame = frameElement.getBoundingClientRect();
	const column = columnOf(reader, doc, first);
	if (!column) {
		return undefined;
	}
	const right = frame.left + column.right - area.left;
	const blank = Math.min(column.next === undefined ? Infinity : frame.left + column.next - area.left, area.width) - right;
	const distance = Math.max(4, Math.min(24, (blank - COMMENT_MARK_SIZE) / 2));
	return {
		left: right + distance + COMMENT_MARK_SIZE / 2,
		top: frame.top + first.top - area.top + Math.max(0, (first.height - COMMENT_MARK_SIZE) / 2)
	};
}

/**
 * The right edge of the column of text that a line of a section is in, and
 * where the next column begins, in the coordinates of the section's
 * document; undefined while the line is on a page not shown.
 */
function columnOf(reader: IFoliateView, doc: Document, line: DOMRect): { readonly right: number; readonly next?: number } | undefined {
	if (reader.isFixedLayout) {
		return { right: doc.documentElement.getBoundingClientRect().right };
	}
	if (preferences.flow === 'scrolled') {
		return { right: doc.body.getBoundingClientRect().right };
	}
	const renderer = reader.renderer;
	const style = doc.defaultView!.getComputedStyle(doc.documentElement);
	const size = renderer.size;
	const start = renderer.start;
	if (size === undefined || start === undefined || style.writingMode.startsWith('vertical')) {
		return { right: line.right };
	}
	// The section's columns stand side by side, one page of them before the first, the page shown from `start`.
	const shownLeft = start - size;
	const middle = line.left + line.width / 2;
	if (middle < shownLeft || middle > shownLeft + size) {
		return undefined;
	}
	const gap = parseFloat(style.columnGap) || 0;
	const padding = parseFloat(style.paddingLeft) || 0;
	const width = parseFloat(style.columnWidth) || size;
	const pitch = size / Math.max(1, Math.round(size / (width + gap)));
	const index = Math.floor((middle - padding + gap / 2) / pitch);
	const right = padding + index * pitch + pitch - gap;
	return { right, next: right + gap };
}

function makeMark(id: string): HTMLButtonElement {
	const button = element('button', 'comment-mark', marksLayer);
	button.type = 'button';
	button.dataset.comment = id;
	button.addEventListener('pointerenter', () => {
		const comment = commentById(id);
		if (comment && !drafts.has(id)) {
			notes.hoverEnter(comment, () => markRect(id));
		}
	});
	button.addEventListener('pointerleave', () => notes.hoverLeave());
	// The selection and the caret stay where they are.
	button.addEventListener('mousedown', event => event.preventDefault());
	button.addEventListener('click', () => {
		const comment = commentById(id);
		if (comment) {
			notes.open(comment, button.getBoundingClientRect(), { unsaved: drafts.has(id) });
			scheduleMarks();
		}
	});
	return button;
}

/** Where the mark of a comment stands, laid out now, for its note. */
function markRect(id: string): DOMRect | undefined {
	if (marksFrame !== undefined) {
		window.cancelAnimationFrame(marksFrame);
		marksFrame = undefined;
	}
	renderMarks();
	return markElements.get(id)?.getBoundingClientRect();
}

// #endregion

function safeJson(value: string | undefined): unknown {
	try {
		return value ? JSON.parse(value) : undefined;
	} catch {
		return undefined;
	}
}
