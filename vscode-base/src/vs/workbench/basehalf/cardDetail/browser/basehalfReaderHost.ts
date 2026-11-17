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
import { BaseHalfReaderCommand, baseHalfReaderPageMessage, IBaseHalfReaderCommandMessage, IBaseHalfReaderPanelState, normalizeBaseHalfReaderPanelState } from '../../documents/common/basehalfReaderProtocol.js';
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
	/** Where the header holds Find and Comments, before Close. */
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
 * Sidebar, Find, and Comments in its header (PDFs and books, rule 15), the
 * state of its panels, its links to websites, and the comments of the
 * document, which it reads, keeps, and follows (comments).
 */
export class BaseHalfReaderHost extends Disposable {
	private readonly sidebarButton: HTMLButtonElement | undefined;
	private readonly findButton: HTMLButtonElement | undefined;
	private readonly commentsButton: HTMLButtonElement | undefined;
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
			this.sidebarButton = this.button(options.leadingActions, 'codicon-list-unordered', 'toggleSidebar');
		}
		if (options.titleActions && options.kind === 'book') {
			const chapter = this.chapter = append(options.titleActions, $('span.basehalf-card-detail-chapter'));
			this._register(toDisposable(() => chapter.remove()));
		}
		if (options.trailingActions) {
			const find = this.findButton = this.button(options.trailingActions, 'codicon-search', 'find');
			const label = localize('basehalf.reader.find', "Find");
			setBaseHalfHover(find, label);
			find.setAttribute('aria-label', label);
			this.commentsButton = this.button(options.trailingActions, 'codicon-comment', 'toggleComments');
		}
		this.showPanelState(panel);
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
		for (const button of [this.sidebarButton, this.findButton, this.commentsButton]) {
			if (button) {
				button.hidden = !visible;
			}
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

	private command(command: BaseHalfReaderCommand): void {
		const message: IBaseHalfReaderCommandMessage = { type: 'basehalf.reader.command', command };
		this.options.post(message);
	}

	/** A button of the header that the page carries out; a press keeps the keyboard where it is. */
	private button(parent: HTMLElement, icon: string, command: BaseHalfReaderCommand): HTMLButtonElement {
		const button = append(parent, $<HTMLButtonElement>(`button.basehalf-card-detail-reader-button.codicon.${icon}`));
		button.type = 'button';
		this._register(addDisposableListener(button, 'mousedown', event => event.preventDefault()));
		this._register(addDisposableListener(button, 'click', () => this.command(command)));
		this._register(toDisposable(() => button.remove()));
		return button;
	}

	/** Sidebar and Comments show whether their panel is open (PDFs and books, rule 15). */
	private showPanelState(state: IBaseHalfReaderPanelState): void {
		if (this.sidebarButton) {
			this.showToggle(this.sidebarButton, state.open, state.open
				? localize('basehalf.reader.hideSidebar', "Hide Sidebar")
				: localize('basehalf.reader.showSidebar', "Show Sidebar"));
		}
		if (this.commentsButton) {
			this.showToggle(this.commentsButton, state.comments, state.comments
				? localize('basehalf.reader.hideComments', "Hide Comments")
				: localize('basehalf.reader.showComments', "Show Comments"));
		}
	}

	private showToggle(button: HTMLButtonElement, checked: boolean, label: string): void {
		setBaseHalfHover(button, label);
		button.setAttribute('aria-label', label);
		button.setAttribute('aria-pressed', String(checked));
		button.classList.toggle('checked', checked);
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
