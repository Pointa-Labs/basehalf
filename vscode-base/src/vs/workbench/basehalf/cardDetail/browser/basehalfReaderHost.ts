/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append } from '../../../../base/browser/dom.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { BaseHalfAgentSelectionDetail } from '../../agentArea/common/basehalfAgentSelection.js';
import { IBaseHalfCommentsTarget } from '../../comments/browser/basehalfCommentService.js';
import { IBaseHalfDocumentSelection } from '../../documents/common/basehalfDocumentBranch.js';
import { baseHalfReaderPageMessage, IBaseHalfReaderCommandMessage, IBaseHalfReaderPanelState, normalizeBaseHalfReaderPanelState } from '../../documents/common/basehalfReaderProtocol.js';
import { setBaseHalfHover } from '../../ui/browser/basehalfHover.js';
import { BaseHalfCommentsBridge } from './basehalfCommentsBridge.js';

/** The schemes of a link in a document that the browser opens (PDFs and books, rules 30 and 39). */
const LINK_SCHEMES = new Set(['http', 'https', 'mailto']);

export type BaseHalfReaderKind = 'pdf' | 'book';

/** Where the reader's panel stood when the last document of a kind closed (PDFs and books, rule 18). */
function panelStorageKey(kind: BaseHalfReaderKind): string {
	return `basehalf.reader.panel.${kind}`;
}

export function readBaseHalfReaderPanelState(storageService: IStorageService, kind: BaseHalfReaderKind): IBaseHalfReaderPanelState {
	return normalizeBaseHalfReaderPanelState(storageService.getObject(panelStorageKey(kind), StorageScope.PROFILE));
}

export interface IBaseHalfReaderHostOptions {
	readonly kind: BaseHalfReaderKind;
	readonly target: IBaseHalfCommentsTarget;
	/** Sends a message to the reader's page. */
	readonly post: (message: unknown) => void;
	/** Where the header holds Sidebar, before the name. */
	readonly leadingActions: HTMLElement | undefined;
	/** Where the header holds Search, before Close. */
	readonly trailingActions: HTMLElement | undefined;
	/** What agents can see: an open comment, or nothing. */
	readonly onComment: (selected: BaseHalfAgentSelectionDetail | undefined) => void;
	/** Grow branch of a comment. */
	readonly growBranch: (selection: IBaseHalfDocumentSelection) => void;
	/** The element that holds the page: it says whether a field of text of the page has the keyboard. */
	readonly pageHost: HTMLElement;
	/** Where the header holds, after the name, the title of the chapter a book shows. */
	readonly titleActions: HTMLElement | undefined;
}

/**
 * What Card Detail does for the reader of a PDF or a book: the reader's
 * Sidebar and Search in its header (PDFs and books, rule 15), the state of
 * its panel, its links to websites, and the comments of the document, which
 * it reads, keeps, and follows (comments).
 */
export class BaseHalfReaderHost extends Disposable {
	private readonly sidebarButton: HTMLButtonElement | undefined;
	private readonly searchButton: HTMLButtonElement | undefined;
	private readonly chapter: HTMLElement | undefined;
	private readonly comments: BaseHalfCommentsBridge;
	private visible = true;

	constructor(
		private readonly options: IBaseHalfReaderHostOptions,
		@IStorageService private readonly storageService: IStorageService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super();
		const panel = readBaseHalfReaderPanelState(storageService, options.kind);
		// The page of a reader is no editor of text: Cmd+Z there undoes the steps of the canvas (comments, rule 26).
		options.pageHost.classList.add('basehalf-reader-page');
		this._register(toDisposable(() => options.pageHost.classList.remove('basehalf-reader-page', 'text-focused')));
		if (options.leadingActions) {
			const button = this.sidebarButton = append(options.leadingActions, $<HTMLButtonElement>('button.basehalf-card-detail-reader-button.codicon.codicon-list-unordered'));
			button.type = 'button';
			this._register(addDisposableListener(button, 'mousedown', event => event.preventDefault()));
			this._register(addDisposableListener(button, 'click', () => this.command('toggleSidebar')));
			this._register(toDisposable(() => button.remove()));
			this.showPanelState(panel);
		}
		if (options.titleActions && options.kind === 'book') {
			const chapter = this.chapter = append(options.titleActions, $('span.basehalf-card-detail-chapter'));
			this._register(toDisposable(() => chapter.remove()));
		}
		if (options.trailingActions) {
			const button = this.searchButton = append(options.trailingActions, $<HTMLButtonElement>('button.basehalf-card-detail-reader-button.codicon.codicon-search'));
			button.type = 'button';
			const label = localize('basehalf.reader.search', "Search");
			setBaseHalfHover(button, label);
			button.setAttribute('aria-label', label);
			this._register(addDisposableListener(button, 'mousedown', event => event.preventDefault()));
			this._register(addDisposableListener(button, 'click', () => this.command('search')));
			this._register(toDisposable(() => button.remove()));
		}
		this.comments = this._register(instantiationService.createInstance(BaseHalfCommentsBridge, {
			target: options.target,
			post: options.post,
			onSelection: options.onComment,
			growBranch: options.growBranch
		}));
	}

	/** The panel's state that the page starts with. */
	get panelState(): IBaseHalfReaderPanelState {
		return readBaseHalfReaderPanelState(this.storageService, this.options.kind);
	}

	setVisible(visible: boolean): void {
		this.visible = visible;
		if (this.sidebarButton) {
			this.sidebarButton.hidden = !visible;
		}
		if (this.searchButton) {
			this.searchButton.hidden = !visible;
		}
	}

	/** Handles a message of the page about its panel, a link, or comments; false for any other. */
	handleMessage(value: unknown): boolean {
		const reader = baseHalfReaderPageMessage(value);
		if (reader?.type === 'basehalf.reader.panel') {
			this.storageService.store(panelStorageKey(this.options.kind), reader.state, StorageScope.PROFILE, StorageTarget.MACHINE);
			this.showPanelState(reader.state);
			return true;
		}
		if (reader?.type === 'basehalf.reader.openLink') {
			this.openLink(reader.href);
			return true;
		}
		if (reader?.type === 'basehalf.reader.chapter') {
			if (this.chapter) {
				this.chapter.textContent = reader.title;
				this.chapter.hidden = !reader.title;
			}
			return true;
		}
		if (reader?.type === 'basehalf.reader.textFocus') {
			this.options.pageHost.classList.toggle('text-focused', reader.focused);
			return true;
		}
		return this.comments.handleMessage(value);
	}

	/** The text selected in the document, or none; an open comment wins over it. */
	setSelectedText(selected: BaseHalfAgentSelectionDetail | undefined): void {
		this.comments.setSelectedText(selected);
	}

	private command(command: IBaseHalfReaderCommandMessage['command']): void {
		const message: IBaseHalfReaderCommandMessage = { type: 'basehalf.reader.command', command };
		this.options.post(message);
	}

	private showPanelState(state: IBaseHalfReaderPanelState): void {
		const button = this.sidebarButton;
		if (!button) {
			return;
		}
		const label = state.open
			? localize('basehalf.reader.hideSidebar', "Hide Sidebar")
			: localize('basehalf.reader.showSidebar', "Show Sidebar");
		setBaseHalfHover(button, label);
		button.setAttribute('aria-label', label);
		button.setAttribute('aria-pressed', String(state.open));
		button.classList.toggle('checked', state.open);
		button.hidden = !this.visible;
	}

	private openLink(href: string): void {
		let link: URI;
		try {
			link = URI.parse(href);
		} catch {
			return;
		}
		if (LINK_SCHEMES.has(link.scheme)) {
			// The opener asks first, as for every link to a website.
			void this.openerService.open(link, { openExternal: true, allowCommands: false, fromUserGesture: true });
		}
	}
}
