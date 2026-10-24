/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The book reader of Card Detail (PDFs and books, "The book reader"), on
// foliate-js. The book is shown from its own file: the page's content
// security policy runs no script of the book and loads nothing from the
// network, and every link to the web goes to the workbench.

import './bookReader.css';
import { makeComicBook } from 'foliate-js/comic-book.js';
import { Overlayer } from 'foliate-js/overlayer.js';
import { BlobReader, BlobWriter, TextWriter, ZipReader, configure } from 'foliate-js/vendor/zip.js';
import { View, type FoliateSearchResult, type IFoliateBookSource, type IFoliateLocation, type IFoliateSearchMatch, type IFoliateTocItem, type IFoliateView } from 'foliate-js/view.js';
import {
	BASEHALF_BOOK_SELECTION_TEXT_LIMIT,
	BASEHALF_BOOK_TEXT_SIZES,
	type BaseHalfBookReaderMessage,
	type IBaseHalfBookReaderLabels,
	type IBaseHalfBookReaderPreferences,
	type IBaseHalfBookSelection,
	normalizeBaseHalfBookReaderPreferences
} from '../../../src/vs/workbench/basehalf/documents/common/basehalfBookReaderProtocol.js';

interface VsCodeApi {
	postMessage(message: BaseHalfBookReaderMessage): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

function element<T extends HTMLElement>(id: string): T {
	const found = document.getElementById(id);
	if (!found) {
		throw new Error(`The book reader's element '${id}' is missing.`);
	}
	return found as T;
}

const vscode = acquireVsCodeApi();
const root = element<HTMLElement>('basehalf-book-reader');
const labels = JSON.parse(root.dataset.labels ?? '{}') as IBaseHalfBookReaderLabels;
const bookHost = element<HTMLElement>('book');
const chapterTitle = element<HTMLElement>('chapter');
const contentsButton = element<HTMLButtonElement>('contents');
const searchButton = element<HTMLButtonElement>('search');
const smallerButton = element<HTMLButtonElement>('smaller');
const largerButton = element<HTMLButtonElement>('larger');
const flowButton = element<HTMLButtonElement>('flow');
const panel = element<HTMLElement>('panel');
const searchBox = element<HTMLElement>('search-box');
const searchInput = element<HTMLInputElement>('search-input');
const searchStatus = element<HTMLElement>('search-status');
const tocList = element<HTMLElement>('toc');
const results = element<HTMLElement>('results');
const previousButton = element<HTMLButtonElement>('previous');
const nextButton = element<HTMLButtonElement>('next');
const progress = element<HTMLInputElement>('progress');
const percent = element<HTMLElement>('percent');
const growButton = element<HTMLButtonElement>('grow');
const status = element<HTMLElement>('status');
const statusMessage = element<HTMLElement>('status-message');
const hover = element<HTMLElement>('hover');

const percentFormat = new Intl.NumberFormat(root.dataset.locale || undefined, { style: 'percent' });
let preferences: IBaseHalfBookReaderPreferences = normalizeBaseHalfBookReaderPreferences({
	textSize: Number(root.dataset.textSize),
	flow: root.dataset.flow
});
let view: IFoliateView | undefined;
let selection: IBaseHalfBookSelection | undefined;
let draggingProgress = false;
let searchRun = 0;

growButton.textContent = labels.growBranch;
statusMessage.textContent = labels.opening;
searchInput.placeholder = labels.searchPlaceholder;
for (const [button, label] of [
	[contentsButton, labels.contents], [searchButton, labels.search], [smallerButton, labels.smallerText],
	[largerButton, labels.largerText], [previousButton, labels.previousPage], [nextButton, labels.nextPage]
] as const) {
	button.setAttribute('aria-label', label);
	button.dataset.hover = label;
}
progress.setAttribute('aria-label', labels.place);

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
	reader.addEventListener('load', event => onSectionLoad((event as CustomEvent<{ doc: Document }>).detail.doc));
	reader.addEventListener('relocate', event => onRelocate((event as CustomEvent<IFoliateLocation>).detail));
	reader.addEventListener('external-link', event => {
		// The workbench opens a link to the web, after its own question; the page never does.
		event.preventDefault();
		const link = (event as CustomEvent<{ a: HTMLAnchorElement; href_: string }>).detail;
		vscode.postMessage({ type: 'basehalf.book.openLink', href: link.a.href || link.href_ });
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
	progress.dir = reader.book.dir ?? 'ltr';
	applyPreferences();
	renderContents(reader.book.toc ?? []);
	await reader.init({ lastLocation: root.dataset.location || undefined, showTextStart: !root.dataset.location });
	status.hidden = true;
	root.dataset.status = 'ready';
	observeTheme();
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
	statusMessage.textContent = labels.failed;
	vscode.postMessage({ type: 'basehalf.book.failed', message });
}

/** The book's own styles, with the editor's colors and the size of text the user chose. */
function bookStyles(): string {
	const style = getComputedStyle(document.documentElement);
	const color = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
	const dark = document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');
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
	const index = BASEHALF_BOOK_TEXT_SIZES.indexOf(preferences.textSize);
	smallerButton.disabled = index <= 0;
	largerButton.disabled = index >= BASEHALF_BOOK_TEXT_SIZES.length - 1;
	const flowLabel = preferences.flow === 'paginated' ? labels.scroll : labels.pages;
	flowButton.setAttribute('aria-label', flowLabel);
	flowButton.dataset.hover = flowLabel;
	flowButton.classList.toggle('scrolled', preferences.flow === 'scrolled');
}

function changePreferences(next: IBaseHalfBookReaderPreferences): void {
	preferences = next;
	applyPreferences();
	vscode.postMessage({ type: 'basehalf.book.preferences', preferences });
}

function observeTheme(): void {
	const observer = new MutationObserver(() => applyPreferences());
	observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
	observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
}

// The contents.

let currentHref: string | undefined;

function renderContents(items: readonly IFoliateTocItem[]): void {
	tocList.replaceChildren();
	const list = document.createElement('ol');
	const add = (parent: HTMLElement, entries: readonly IFoliateTocItem[], depth: number) => {
		for (const entry of entries) {
			const item = document.createElement('li');
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'toc-entry';
			button.style.setProperty('--depth', String(depth));
			button.textContent = entry.label?.trim() || labels.untitledSection;
			if (entry.href) {
				button.dataset.href = entry.href;
				button.addEventListener('click', () => {
					void view?.goTo(entry.href!);
					closePanelWhenNarrow();
				});
			} else {
				button.disabled = true;
			}
			item.append(button);
			parent.append(item);
			if (entry.subitems?.length) {
				const sublist = document.createElement('ol');
				item.append(sublist);
				add(sublist, entry.subitems, depth + 1);
			}
		}
	};
	add(list, items, 0);
	tocList.append(list);
	markCurrentEntry();
}

function markCurrentEntry(): void {
	for (const entry of tocList.querySelectorAll<HTMLButtonElement>('.toc-entry')) {
		const current = !!currentHref && entry.dataset.href === currentHref;
		entry.classList.toggle('current', current);
		if (current) {
			entry.setAttribute('aria-current', 'location');
		} else {
			entry.removeAttribute('aria-current');
		}
	}
}

function openPanel(search: boolean): void {
	panel.hidden = false;
	root.classList.add('panel-open');
	searchBox.hidden = !search;
	contentsButton.setAttribute('aria-expanded', String(!search));
	searchButton.setAttribute('aria-expanded', String(search));
	if (search) {
		searchInput.focus();
		searchInput.select();
	} else {
		showResults(false);
		tocList.querySelector<HTMLButtonElement>('.toc-entry.current')?.scrollIntoView({ block: 'center' });
	}
}

function closePanel(): void {
	panel.hidden = true;
	root.classList.remove('panel-open');
	contentsButton.setAttribute('aria-expanded', 'false');
	searchButton.setAttribute('aria-expanded', 'false');
	searchRun++;
	view?.clearSearch();
}

/** Card Detail is wide enough for the panel to stand beside the book. */
const WIDE_READER = 900;
new ResizeObserver(() => root.classList.toggle('wide', root.clientWidth >= WIDE_READER)).observe(root);

/** Over the book, the panel closes once it took the reader somewhere; beside the book, it stays. */
function closePanelWhenNarrow(): void {
	if (!root.classList.contains('wide')) {
		closePanel();
	}
}

contentsButton.addEventListener('click', () => panel.hidden || !searchBox.hidden ? openPanel(false) : closePanel());
searchButton.addEventListener('click', () => panel.hidden || searchBox.hidden ? openPanel(true) : closePanel());

// Search.

function showResults(shown: boolean): void {
	results.hidden = !shown;
	tocList.hidden = shown;
}

searchInput.addEventListener('keydown', event => {
	if (event.key === 'Enter' && !event.isComposing) {
		event.preventDefault();
		void search(searchInput.value.trim());
	}
});
searchInput.addEventListener('input', () => {
	if (!searchInput.value.trim()) {
		searchRun++;
		view?.clearSearch();
		searchStatus.textContent = '';
		showResults(false);
	}
});

async function search(query: string): Promise<void> {
	const reader = view;
	const run = ++searchRun;
	results.replaceChildren();
	if (!reader || !query) {
		showResults(false);
		return;
	}
	showResults(true);
	searchStatus.textContent = labels.searching.replace('{0}', percentFormat.format(0));
	let count = 0;
	// Matches are marked as the editor marks what Find finds.
	const style = getComputedStyle(document.documentElement);
	const color = style.getPropertyValue('--vscode-editor-findMatchHighlightBackground').trim() || 'rgb(234 92 0 / 33%)';
	for await (const result of reader.search({ query, draw: Overlayer.highlight, drawOptions: { color } })) {
		if (run !== searchRun) {
			return;
		}
		if (result === 'done') {
			break;
		}
		const progressed = searchProgress(result);
		if (progressed !== undefined) {
			searchStatus.textContent = labels.searching.replace('{0}', percentFormat.format(progressed));
			continue;
		}
		const section = searchSection(result);
		if (!section) {
			continue;
		}
		const group = document.createElement('li');
		const heading = document.createElement('div');
		heading.className = 'result-section';
		heading.textContent = section.label || labels.untitledSection;
		const list = document.createElement('ol');
		for (const match of section.subitems) {
			count++;
			const item = document.createElement('li');
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'result';
			const mark = document.createElement('mark');
			mark.textContent = match.excerpt.match;
			button.append(match.excerpt.pre, mark, match.excerpt.post);
			button.addEventListener('click', () => {
				void reader.goTo(match.cfi);
				closePanelWhenNarrow();
			});
			item.append(button);
			list.append(item);
		}
		group.append(heading, list);
		results.append(group);
	}
	if (run === searchRun) {
		searchStatus.textContent = count === 0 ? labels.noMatches : count === 1 ? labels.oneMatch : labels.matches.replace('{0}', String(count));
	}
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

// Text, flow, and turning pages.

smallerButton.addEventListener('click', () => {
	const index = BASEHALF_BOOK_TEXT_SIZES.indexOf(preferences.textSize);
	changePreferences({ ...preferences, textSize: BASEHALF_BOOK_TEXT_SIZES[Math.max(0, index - 1)] });
});
largerButton.addEventListener('click', () => {
	const index = BASEHALF_BOOK_TEXT_SIZES.indexOf(preferences.textSize);
	changePreferences({ ...preferences, textSize: BASEHALF_BOOK_TEXT_SIZES[Math.min(BASEHALF_BOOK_TEXT_SIZES.length - 1, index + 1)] });
});
flowButton.addEventListener('click', () => changePreferences({ ...preferences, flow: preferences.flow === 'paginated' ? 'scrolled' : 'paginated' }));
previousButton.addEventListener('click', () => void view?.goLeft());
nextButton.addEventListener('click', () => void view?.goRight());

let goingTo: number | undefined;
progress.addEventListener('pointerdown', () => draggingProgress = true);
window.addEventListener('pointerup', () => draggingProgress = false);
progress.addEventListener('input', () => {
	percent.textContent = percentFormat.format(Number(progress.value) / 1000);
	window.clearTimeout(goingTo);
	goingTo = window.setTimeout(() => void view?.goToFraction(Number(progress.value) / 1000), 120);
});

function onRelocate(location: IFoliateLocation): void {
	const fraction = location.fraction ?? 0;
	if (!draggingProgress) {
		progress.value = String(Math.round(fraction * 1000));
		percent.textContent = percentFormat.format(fraction);
	}
	chapterTitle.textContent = location.tocItem?.label?.trim() ?? '';
	currentHref = location.tocItem?.href;
	markCurrentEntry();
	hideGrowButton();
	if (location.cfi) {
		vscode.postMessage({ type: 'basehalf.book.viewState', state: { location: location.cfi, fraction } });
	}
}

// The keyboard: Escape closes Card Detail unless the panel or a field takes it.

function isField(target: EventTarget | null): boolean {
	return target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
}

function onKeydown(event: KeyboardEvent): void {
	if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) {
		return;
	}
	if (event.key === 'Escape') {
		event.preventDefault();
		if (!panel.hidden) {
			closePanel();
			view?.renderer.focus();
		} else if (!event.shiftKey) {
			vscode.postMessage({ type: 'basehalf.media.escape' });
		}
		return;
	}
	if (isField(event.composedPath()[0] ?? event.target) || !view) {
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

// A section of the book: its keys, the side of the page that turns it, and what is selected in it.

function onSectionLoad(doc: Document): void {
	doc.addEventListener('keydown', onKeydown);
	for (const type of ['pointerdown', 'keydown', 'wheel'] as const) {
		doc.addEventListener(type, onInteraction, { capture: true, passive: true });
	}
	doc.addEventListener('click', event => {
		const reader = view;
		if (!reader || reader.isFixedLayout || preferences.flow !== 'paginated' || event.defaultPrevented
			|| (event.target as Element | null)?.closest?.('a[href]') || !(doc.getSelection()?.isCollapsed ?? true)) {
			return;
		}
		const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
		const area = bookHost.getBoundingClientRect();
		const x = (frame?.left ?? 0) + event.clientX - area.left;
		if (x < area.width / 5) {
			void reader.goLeft();
		} else if (x > area.width * 4 / 5) {
			void reader.goRight();
		}
	});
	let settling: number | undefined;
	doc.addEventListener('selectionchange', () => {
		window.clearTimeout(settling);
		settling = window.setTimeout(() => onSelection(doc), 30);
	});
}

function onSelection(doc: Document): void {
	const selected = doc.getSelection();
	const text = selected && !selected.isCollapsed ? selected.toString() : '';
	if (!text.trim() || !selected) {
		if (selection) {
			selection = undefined;
			vscode.postMessage({ type: 'basehalf.book.selectionChanged' });
		}
		hideGrowButton();
		return;
	}
	const chapter = view?.lastLocation?.tocItem?.label?.trim();
	selection = { text: text.slice(0, BASEHALF_BOOK_SELECTION_TEXT_LIMIT), ...(chapter ? { chapter } : {}) };
	vscode.postMessage({ type: 'basehalf.book.selectionChanged', selection });
	const rect = selected.getRangeAt(0).getClientRects()[0] ?? selected.getRangeAt(0).getBoundingClientRect();
	const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
	const reader = root.getBoundingClientRect();
	const top = (frame?.top ?? 0) + rect.top - reader.top;
	const left = (frame?.left ?? 0) + rect.left - reader.left;
	growButton.hidden = false;
	const width = growButton.offsetWidth;
	growButton.style.left = `${Math.min(Math.max(8, left), reader.width - width - 8)}px`;
	growButton.style.top = `${top > 48 ? top - 38 : top + rect.height + 8}px`;
}

function hideGrowButton(): void {
	growButton.hidden = true;
}

growButton.addEventListener('pointerdown', event => event.preventDefault());
growButton.addEventListener('click', () => {
	if (selection) {
		vscode.postMessage({ type: 'basehalf.book.createBranch', selection });
	}
	view?.deselect();
	selection = undefined;
	vscode.postMessage({ type: 'basehalf.book.selectionChanged' });
	hideGrowButton();
});

// The name of a button that shows only an icon, under the pointer.

let hoverTimer: number | undefined;
document.addEventListener('pointerover', event => {
	const target = (event.target as Element | null)?.closest?.<HTMLElement>('[data-hover]');
	window.clearTimeout(hoverTimer);
	if (!target) {
		hover.hidden = true;
		return;
	}
	hoverTimer = window.setTimeout(() => {
		hover.textContent = target.dataset.hover ?? '';
		hover.hidden = false;
		const box = target.getBoundingClientRect();
		const below = box.bottom + 6 + hover.offsetHeight < window.innerHeight;
		hover.style.top = `${below ? box.bottom + 6 : box.top - hover.offsetHeight - 6}px`;
		hover.style.left = `${Math.min(Math.max(6, box.left + box.width / 2 - hover.offsetWidth / 2), window.innerWidth - hover.offsetWidth - 6)}px`;
	}, 500);
});
document.addEventListener('pointerdown', () => {
	window.clearTimeout(hoverTimer);
	hover.hidden = true;
}, { capture: true });
