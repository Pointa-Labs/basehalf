/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type { BaseHalfReaderTab, IBaseHalfReaderLabels } from '../../../../src/vs/workbench/basehalf/documents/common/basehalfReaderProtocol.js';
import { element } from './readerDom.js';

/** The reader is wide enough for a panel to stand beside the document (PDFs and books, rule 17). */
export const WIDE_READER = 900;

/** Whether the panel at the left is open, and its tab. */
export interface IReaderPanelState {
	readonly open: boolean;
	readonly tab: BaseHalfReaderTab;
}

export interface IReaderPanelOptions {
	readonly tabs: readonly BaseHalfReaderTab[];
	readonly labels: IBaseHalfReaderLabels;
	readonly state: IReaderPanelState;
	/** The panel opened, closed, or showed another tab. */
	readonly onState: (state: IReaderPanelState) => void;
	readonly onTab?: (tab: BaseHalfReaderTab) => void;
}

/** Marks the reader wide while it is wide enough for a panel to stand beside the document. */
export function observeReaderWidth(root: HTMLElement): void {
	new ResizeObserver(() => root.classList.toggle('wide', root.clientWidth >= WIDE_READER)).observe(root);
}

/**
 * The reader's panel at the left (PDFs and books, "The panels"): the tabs
 * that take the reader somewhere, Pages and Contents. A panel with one tab
 * shows no tabs.
 */
export class ReaderPanel {
	readonly element: HTMLElement;
	private readonly tabBar: HTMLElement;
	private readonly tabButtons = new Map<BaseHalfReaderTab, HTMLButtonElement>();
	private readonly sections = new Map<BaseHalfReaderTab, HTMLElement>();
	private tabs: readonly BaseHalfReaderTab[];
	private state: IReaderPanelState;

	constructor(private readonly root: HTMLElement, private readonly options: IReaderPanelOptions) {
		this.tabs = options.tabs;
		this.state = { open: options.state.open, tab: options.tabs.includes(options.state.tab) ? options.state.tab : options.tabs[0] };
		this.element = element('aside', 'reader-panel', root);
		this.element.hidden = true;
		this.tabBar = element('div', 'reader-tabs', this.element);
		this.tabBar.setAttribute('role', 'tablist');
		const label: Record<BaseHalfReaderTab, string> = { pages: options.labels.pages, contents: options.labels.contents };
		for (const tab of ['pages', 'contents'] as const) {
			const button = element('button', 'reader-tab', this.tabBar);
			button.type = 'button';
			button.setAttribute('role', 'tab');
			button.textContent = label[tab];
			button.addEventListener('click', () => this.show(tab));
			this.tabButtons.set(tab, button);
			const section = element('div', `reader-section ${tab}`, this.element);
			section.setAttribute('role', 'tabpanel');
			section.setAttribute('aria-label', label[tab]);
			this.sections.set(tab, section);
		}
		this.render();
	}

	get isOpen(): boolean {
		return this.state.open;
	}

	/** The panel stands over the document, in a reader too narrow for it to stand beside. */
	get isOver(): boolean {
		return this.state.open && !this.root.classList.contains('wide');
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

	private setState(state: IReaderPanelState): void {
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
		this.tabBar.hidden = this.tabs.length < 2;
		for (const [tab, button] of this.tabButtons) {
			button.hidden = !this.tabs.includes(tab);
			const selected = tab === this.state.tab;
			button.classList.toggle('selected', selected);
			button.setAttribute('aria-selected', String(selected));
			this.sections.get(tab)!.hidden = !selected || !this.tabs.includes(tab);
		}
	}
}
