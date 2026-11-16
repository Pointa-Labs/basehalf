/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type { BaseHalfReaderTab, IBaseHalfReaderLabels, IBaseHalfReaderPanelState } from '../../../../src/vs/workbench/basehalf/documents/common/basehalfReaderProtocol.js';
import { element, format, readerIcon } from './readerDom.js';

/** The reader is wide enough for the panel to stand beside the document. */
const WIDE_READER = 900;

export interface IReaderSearchMatch {
	readonly before: string;
	readonly match: string;
	readonly after: string;
	readonly go: () => void;
}

export interface IReaderPanelOptions {
	readonly tabs: readonly BaseHalfReaderTab[];
	readonly labels: IBaseHalfReaderLabels;
	readonly searchPlaceholder: string;
	readonly state: IBaseHalfReaderPanelState;
	/** The panel opened, closed, or showed another tab. */
	readonly onState: (state: IBaseHalfReaderPanelState) => void;
	/** Enter in the search field; `run` tells whether this search is still the current one. */
	readonly onSearch: (query: string, results: ReaderSearchResults) => void;
	/** The search ended: its marks go. */
	readonly onClearSearch: () => void;
	readonly onTab?: (tab: BaseHalfReaderTab) => void;
}

/** The matches of a search as the panel lists them, under their page or chapter. */
export class ReaderSearchResults {
	private count = 0;

	constructor(private readonly list: HTMLElement, private readonly statusLine: HTMLElement, private readonly labels: IBaseHalfReaderLabels, private readonly current: () => boolean) { }

	get isCurrent(): boolean {
		return this.current();
	}

	progress(fraction: number): void {
		if (this.current()) {
			this.statusLine.textContent = format(this.labels.searching, `${Math.round(fraction * 100)}%`);
		}
	}

	group(label: string, matches: readonly IReaderSearchMatch[]): void {
		if (!this.current() || matches.length === 0) {
			return;
		}
		const item = element('li', '', this.list);
		element('div', 'result-group', item).textContent = label;
		const list = element('ol', '', item);
		for (const match of matches) {
			this.count++;
			const button = element('button', 'result', element('li', '', list));
			button.type = 'button';
			const mark = document.createElement('mark');
			mark.textContent = match.match;
			button.append(match.before, mark, match.after);
			button.addEventListener('click', () => match.go());
		}
	}

	done(): void {
		if (this.current()) {
			this.statusLine.textContent = this.count === 0 ? this.labels.noMatches : this.count === 1 ? this.labels.oneMatch : format(this.labels.matches, this.count);
		}
	}
}

/**
 * The reader's panel (PDFs and books, "The panel"): a search field and, under
 * it, the tabs of the document, or the matches of a search in their place.
 */
export class ReaderPanel {
	readonly element: HTMLElement;
	private readonly searchField: HTMLInputElement;
	private readonly searchStatus: HTMLElement;
	private readonly tabBar: HTMLElement;
	private readonly tabButtons = new Map<BaseHalfReaderTab, HTMLButtonElement>();
	private readonly sections = new Map<BaseHalfReaderTab, HTMLElement>();
	private readonly results: HTMLElement;
	private tabs: readonly BaseHalfReaderTab[];
	private state: IBaseHalfReaderPanelState;
	private searchRun = 0;

	constructor(private readonly root: HTMLElement, private readonly options: IReaderPanelOptions) {
		this.tabs = options.tabs;
		this.state = { open: options.state.open, tab: options.tabs.includes(options.state.tab) ? options.state.tab : options.tabs[0] };
		this.element = element('aside', 'reader-panel', root);
		this.element.hidden = true;
		const search = element('div', 'reader-search', this.element);
		search.append(readerIcon('search'));
		this.searchField = element('input', '', search);
		this.searchField.type = 'search';
		this.searchField.spellcheck = false;
		this.searchField.placeholder = options.searchPlaceholder;
		this.searchField.setAttribute('aria-label', options.searchPlaceholder);
		this.searchStatus = element('div', 'reader-search-status', this.element);
		this.searchStatus.setAttribute('role', 'status');
		this.searchStatus.setAttribute('aria-live', 'polite');
		this.tabBar = element('div', 'reader-tabs', this.element);
		this.tabBar.setAttribute('role', 'tablist');
		const label: Record<BaseHalfReaderTab, string> = { pages: options.labels.pages, contents: options.labels.contents, comments: options.labels.comments };
		for (const tab of ['pages', 'contents', 'comments'] as const) {
			const button = element('button', 'reader-tab', this.tabBar);
			button.type = 'button';
			button.setAttribute('role', 'tab');
			button.textContent = label[tab];
			button.addEventListener('click', () => this.show(tab));
			this.tabButtons.set(tab, button);
			const section = element('div', `reader-section ${tab}`, this.element);
			section.setAttribute('role', 'tabpanel');
			this.sections.set(tab, section);
		}
		this.results = element('ol', 'reader-results', this.element);
		this.results.hidden = true;

		this.searchField.addEventListener('keydown', event => {
			if (event.key === 'Enter' && !event.isComposing) {
				event.preventDefault();
				this.search(this.searchField.value.trim());
			} else if (event.key === 'Escape' && this.searchField.value) {
				event.preventDefault();
				event.stopPropagation();
				this.searchField.value = '';
				this.endSearch();
			}
		});
		this.searchField.addEventListener('input', () => {
			if (!this.searchField.value.trim()) {
				this.endSearch();
			}
		});
		new ResizeObserver(() => root.classList.toggle('wide', root.clientWidth >= WIDE_READER)).observe(root);
		this.render();
	}

	get isOpen(): boolean {
		return this.state.open;
	}

	/** The panel stands over the document, in a reader too narrow for it to stand beside. */
	get isOver(): boolean {
		return this.state.open && !this.root.classList.contains('wide');
	}

	get isSearching(): boolean {
		return !this.results.hidden;
	}

	section(tab: BaseHalfReaderTab): HTMLElement {
		return this.sections.get(tab)!;
	}

	get tab(): BaseHalfReaderTab {
		return this.state.tab;
	}

	/** The tabs the document has: a PDF without an outline has no Contents. */
	setTabs(tabs: readonly BaseHalfReaderTab[]): void {
		this.tabs = tabs;
		if (!tabs.includes(this.state.tab)) {
			this.state = { ...this.state, tab: tabs[0] };
		}
		this.render();
	}

	show(tab: BaseHalfReaderTab): void {
		this.setState({ open: true, tab: this.tabs.includes(tab) ? tab : this.state.tab });
	}

	toggle(): void {
		this.setState({ ...this.state, open: !this.state.open });
	}

	close(): void {
		this.setState({ ...this.state, open: false });
	}

	/** Over the document, the panel closes once it took the reader somewhere; beside it, it stays. */
	closeWhenOver(): void {
		if (this.isOver) {
			this.close();
		}
	}

	focusSearch(): void {
		if (!this.state.open) {
			this.setState({ ...this.state, open: true });
		}
		this.searchField.focus();
		this.searchField.select();
	}

	endSearch(): void {
		this.searchRun++;
		this.results.replaceChildren();
		this.results.hidden = true;
		this.searchStatus.textContent = '';
		this.render();
		this.options.onClearSearch();
	}

	private search(query: string): void {
		const run = ++this.searchRun;
		this.results.replaceChildren();
		if (!query) {
			this.endSearch();
			return;
		}
		this.results.hidden = false;
		this.render();
		this.options.onSearch(query, new ReaderSearchResults(this.results, this.searchStatus, this.options.labels, () => run === this.searchRun));
	}

	private setState(state: IBaseHalfReaderPanelState): void {
		this.state = state;
		this.render();
		this.options.onState(state);
		if (state.open) {
			this.options.onTab?.(state.tab);
		}
	}

	private render(): void {
		this.element.hidden = !this.state.open;
		this.root.classList.toggle('panel-open', this.state.open);
		this.tabBar.hidden = this.isSearching;
		for (const [tab, button] of this.tabButtons) {
			button.hidden = !this.tabs.includes(tab);
			const selected = tab === this.state.tab;
			button.classList.toggle('selected', selected);
			button.setAttribute('aria-selected', String(selected));
			this.sections.get(tab)!.hidden = !selected || this.isSearching || !this.tabs.includes(tab);
		}
	}
}
