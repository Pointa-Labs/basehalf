/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfVideoProviders.css';
import { $, addDisposableListener, append, clearNode, EventType, getActiveElement, isHTMLElement, isHTMLInputElement } from '../../../../base/browser/dom.js';
import { disposableTimeout } from '../../../../base/common/async.js';
import { getErrorMessage } from '../../../../base/common/errors.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { DEFAULT_CUSTOM_VOICES, isCustomProviderId } from '../../../../platform/basehalfProviders/common/basehalfCustomProviders.js';
import type { CustomProviderDefinition } from '../../../../platform/basehalfProviders/common/basehalfProviderTypes.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { ISettingsCustomSection, ISettingsCustomSectionLayout } from '../../../contrib/preferences/browser/settingsCustomSections.js';
import { BASEHALF_MODEL_KINDS, BaseHalfModelKind, BaseHalfVideoCatalogState, baseHalfVideoListedModels, baseHalfVideoRegionOffersModel, IBaseHalfVideoCatalogCredential, IBaseHalfVideoCatalogProvider } from '../common/basehalfVideoCatalog.js';
import { IBaseHalfCustomProviderChange, IBaseHalfVideoCatalogService, IBaseHalfVideoProviderSettingsService, IBaseHalfVideoProviderStatus } from '../common/basehalfVideoGeneration.js';
import { BASEHALF_VIDEO_ENDPOINT_MAX_LENGTH, BaseHalfVideoProviderSettingsError, IBaseHalfProvidersPageTarget, parseBaseHalfProvidersPageInput } from '../common/basehalfVideoProviderSettings.js';

type BaseHalfVideoProvidersStatusKind = 'success' | 'warning';

/**
 * A control whose text survives a render: the endpoint, the field of one
 * credential, a field of a custom provider, or a field of the form that adds
 * one (D108).
 */
type BaseHalfVideoProviderControl = 'endpoint' | `credential:${string}` | `custom:${string}` | `add:${string}`;

/** What a render keeps of the page before it: the control that had the focus, its selection, and text being typed. */
interface IBaseHalfVideoProvidersKept {
	readonly focus?: string;
	readonly selection?: readonly [number, number];
	readonly values: ReadonlyMap<BaseHalfVideoProviderControl, string>;
}

/** The outcome of a change, shown once it ends, and only while its provider is the one shown. */
interface IBaseHalfVideoProvidersSaveOutcome {
	readonly success: string;
	readonly onSuccess?: () => void;
	readonly onFailure?: () => void;
}

/** What the page shows of one provider's settings. */
interface IBaseHalfVideoProviderShown {
	readonly region: string;
	readonly setUp: boolean;
	readonly endpoint: string;
	readonly customEndpoint: boolean;
	readonly credentials: string;
}

/** Numbers the pages: Settings can show the page twice, in two editor groups, and each page's ids are its own. */
let pageCount = 0;

/**
 * The Providers page of Settings (D59, D64, D107, providers, "Credentials,
 * regions, and endpoints"), drawn from the model catalog: a choice of the
 * card types, Image, Video, and Audio, the providers of the type chosen in
 * the catalog's order, and for the one selected which cards its key serves,
 * its models under Images, Videos, and Audio, those of the type chosen first,
 * its region, a link to the region's console, one masked field per credential
 * it declares, and its endpoint. A provider of several types is in the list
 * of each, and is set up once for all of them. Saving checks nothing with the
 * provider; the first generation tells whether the credentials work. A stored
 * value is never read here and never shown: the page knows only whether one
 * is set.
 *
 * The page is drawn again only when what it shows changed, and keeps the
 * control that had the focus, or the one that took its place (settings pages,
 * "While a page is shown").
 */
export class BaseHalfVideoProvidersPage extends Disposable implements ISettingsCustomSection {
	private readonly idPrefix = `basehalf-video-providers-${++pageCount}`;
	private root: HTMLElement | undefined;
	private status: HTMLElement | undefined;
	private content: HTMLElement | undefined;
	/** The card types above the list of providers. */
	private kindsBar: HTMLElement | undefined;
	private list: HTMLElement | undefined;
	private editor: HTMLElement | undefined;
	private selectedId: string | undefined;
	/** The card type whose providers the list holds (D107). */
	private selectedKind: BaseHalfModelKind | undefined;
	/** The card type of the list as last drawn: the list keeps its scroll only while the type stays. */
	private renderedKind: BaseHalfModelKind | undefined;
	/** What an opening asked to show, kept until the catalog has providers to show it with. */
	private pendingTarget: IBaseHalfProvidersPageTarget | undefined;
	/** The provider selected is to be brought into view in its list, once the list has its height. */
	private revealPending = false;
	/** The card type whose form that adds a custom provider is shown in place of a provider (D108). */
	private adding: BaseHalfModelKind | undefined;
	/** A pointer is pressed on the page: a render waits until the click it begins has landed. */
	private pointerDown = false;
	private renderAfterPointer = false;
	private readonly pointerRender = this._register(new MutableDisposable());
	/** The provider the editor currently shows; typed text is kept only while it stays the same. */
	private renderedId: string | undefined;
	/** The catalog and each provider's settings as last drawn: a change of anything else, such as the last model used, draws nothing. */
	private renderedCatalog: BaseHalfVideoCatalogState | undefined;
	private renderedSettings: ReadonlyMap<string, IBaseHalfVideoProviderShown> | undefined;
	/** The credentials whose value is being replaced. */
	private readonly replacing = new Set<string>();
	/** The changes under way, by what they change: a second click on Set is not a second change. */
	private readonly saving = new Set<string>();
	/** How many changes, the endpoint's too, are still being saved; the last one to end draws the page. */
	private pendingSaves = 0;
	/** A change ended while others were saved and has an outcome to draw, such as an error under its field. */
	private outcomeToDraw = false;
	/** The endpoint text saved as the page closed, so that hiding and then disposing the page saves it once. */
	private endpointSavedOnClose: string | undefined;
	private disposed = false;
	private readonly fieldErrors = new Map<BaseHalfVideoProviderControl, string>();
	private readonly renderDisposables = this._register(new MutableDisposable<DisposableStore>());
	/** The elements of the current render, reached directly instead of by selectors. */
	private readonly rows = new Map<string, HTMLButtonElement>();
	private readonly controls = new Map<BaseHalfVideoProviderControl, HTMLInputElement>();
	private readonly errors = new Map<BaseHalfVideoProviderControl, HTMLElement>();
	/** Every element that can have the focus, by a key that the same control keeps from one render to the next. */
	private readonly focusables = new Map<string, HTMLElement>();
	private readonly sensitiveInputs = new Set<HTMLInputElement>();

	constructor(
		@IBaseHalfVideoCatalogService private readonly catalogService: IBaseHalfVideoCatalogService,
		@IBaseHalfVideoProviderSettingsService private readonly providerSettings: IBaseHalfVideoProviderSettingsService,
		@IDialogService private readonly dialogService: IDialogService,
		@IHoverService private readonly hoverService: IHoverService,
		@IOpenerService private readonly openerService: IOpenerService
	) {
		super();
		// While a change is saved, the render that ends it shows what changed meanwhile.
		const refresh = () => {
			if (!this.pendingSaves && this.changedSinceRender()) {
				this.renderWhenFree();
			}
		};
		this._register(this.providerSettings.onDidChange(refresh));
		this._register(this.catalogService.onDidChange(refresh));
	}

	create(parent: HTMLElement): void {
		this.root = append(parent, $('.basehalf-video-providers'));
		this.root.setAttribute('role', 'region');
		this.root.setAttribute('aria-labelledby', this.id('title'));
		this.root.tabIndex = -1;

		const header = append(this.root, $('.basehalf-video-providers-header'));
		const heading = append(header, $('.basehalf-video-providers-heading'));
		const title = append(heading, $('h1'));
		title.id = this.id('title');
		title.textContent = localize('basehalf.video.providers.title', "Providers");
		const subtitle = append(heading, $('p'));
		subtitle.textContent = localize('basehalf.video.providers.subtitle', "Image, video, and audio cards are generated by these providers with your own credentials, and you pay each provider directly. A provider's key serves every type of card it makes. Credentials are encrypted and stay on this computer; nothing is checked with a provider until its first generation.");

		this.status = append(this.root, $('p.basehalf-video-providers-status'));
		this.status.setAttribute('role', 'status');
		this.status.setAttribute('aria-live', 'polite');

		this.content = append(this.root, $('.basehalf-video-providers-content'));
		const side = append(this.content, $('.basehalf-video-providers-side'));
		this.kindsBar = append(side, $('.basehalf-video-providers-kinds'));
		this.kindsBar.setAttribute('role', 'tablist');
		this.kindsBar.setAttribute('aria-label', localize('basehalf.video.providers.kindsLabel', "Card types"));
		this.list = append(side, $('.basehalf-video-providers-list'));
		this.list.id = this.id('list');
		this.editor = append(this.content, $('.basehalf-video-provider-editor'));
		this.editor.setAttribute('role', 'region');
		this.editor.setAttribute('aria-label', localize('basehalf.video.providers.editorLabel', "Provider settings"));
		// A field saved as the pointer leaves it is drawn again only after the click
		// that took the focus has landed, so that it reaches what it clicked.
		this._register(addDisposableListener(this.root, EventType.POINTER_DOWN, () => this.pointerDown = true, true));
		const release = () => {
			if (!this.pointerDown) {
				return;
			}
			this.pointerDown = false;
			if (this.renderAfterPointer) {
				this.renderAfterPointer = false;
				this.pointerRender.value = disposableTimeout(() => this.render(), 0);
			}
		};
		this._register(addDisposableListener(this.root.ownerDocument, EventType.POINTER_UP, release, true));
		this._register(addDisposableListener(this.root.ownerDocument, 'pointercancel', release, true));
		// A catalog that could not be loaded is asked for again when the page opens.
		this.catalogService.load();
		this.render();
	}

	/** Draws the page now, or once the pointer that is pressed on it is released. */
	private renderWhenFree(): void {
		if (this.pointerDown) {
			this.renderAfterPointer = true;
			return;
		}
		this.render();
	}

	/**
	 * Shows what an opening asks for (settings pages, "Opening Settings at a
	 * page"): a card type, a provider, both, or, with neither, the page as it
	 * is. The catalog may still load: the type and the provider are shown once
	 * it is there.
	 */
	setInput(input: string | undefined): void {
		const target = parseBaseHalfProvidersPageInput(input);
		if (target.provider !== undefined && target.provider !== this.selectedId) {
			this.setStatus('');
		}
		if (target.kind !== undefined || target.provider !== undefined) {
			this.pendingTarget = target;
			this.revealPending = true;
			this.adding = undefined;
		}
		this.render();
	}

	setVisible(visible: boolean): void {
		if (this.root) {
			this.root.hidden = !visible;
		}
		if (!visible) {
			this.saveTypedEndpoint();
			this.clearSensitiveInputs();
			if (this.replacing.size) {
				this.replacing.clear();
				this.render();
			}
		}
	}

	layout(dimension: ISettingsCustomSectionLayout): void {
		if (this.root) {
			this.root.style.width = `${dimension.width}px`;
			this.root.style.height = `${dimension.height}px`;
		}
		// An opening draws the page before Settings gives it its size: the list scrolls only now.
		this.revealSelectedRow();
	}

	focus(): void {
		const selected = this.selectedId !== undefined ? this.rows.get(this.selectedId) : undefined;
		(selected ?? this.focusables.get('retry') ?? this.root)?.focus();
	}

	override dispose(): void {
		if (!this.disposed) {
			this.saveTypedEndpoint();
			this.disposed = true;
		}
		this.clearSensitiveInputs();
		super.dispose();
	}

	private providers(): readonly IBaseHalfVideoCatalogProvider[] {
		const state = this.catalogService.state;
		return state.kind === 'ready' ? state.catalog.providers : [];
	}

	private select(providerId: string): void {
		if (this.selectedId !== providerId) {
			this.selectedId = providerId;
			this.replacing.clear();
			this.fieldErrors.clear();
		}
	}

	/**
	 * Shows what an opening asked for, once the catalog has its providers: the
	 * provider under the type asked for, or under the first type that lists it
	 * when that type does not; a type alone keeps the provider shown when it
	 * lists it, as choosing the type does.
	 */
	private applyTarget(target: IBaseHalfProvidersPageTarget, providers: readonly IBaseHalfVideoCatalogProvider[], kinds: readonly BaseHalfModelKind[]): void {
		const provider = target.provider !== undefined ? providers.find(candidate => candidate.id === target.provider) : undefined;
		if (provider) {
			const types = kindsOf(provider);
			this.selectedKind = target.kind !== undefined && types.includes(target.kind) ? target.kind : types[0] ?? this.selectedKind;
			this.select(provider.id);
		} else if (target.kind !== undefined && kinds.includes(target.kind)) {
			this.selectedKind = target.kind;
		}
	}

	/** Shows the providers of another card type, and keeps the provider shown when the type lists it (D107). */
	private chooseKind(kind: BaseHalfModelKind): void {
		if (kind === this.selectedKind) {
			return;
		}
		this.selectedKind = kind;
		if (this.adding) {
			// The form adds a provider of the type shown.
			this.adding = kind;
		}
		const listed = providersOf(this.providers(), kind);
		if (listed.length && !listed.some(provider => provider.id === this.selectedId)) {
			this.select(listed[0].id);
			this.setStatus('');
		}
		this.revealPending = true;
		this.render();
	}

	/** The id of an element of this page. */
	private id(name: string): string {
		return `${this.idPrefix}-${name}`;
	}

	/** What the page shows of every provider's settings, to tell whether a change needs a render. */
	private shownSettings(): ReadonlyMap<string, IBaseHalfVideoProviderShown> {
		return new Map(this.providers().map(provider => {
			const status = this.providerSettings.getStatus(provider);
			return [provider.id, {
				region: status.region.id,
				setUp: status.setUp,
				endpoint: status.endpoint,
				customEndpoint: status.customEndpoint,
				credentials: [...status.credentials].sort().join('\n')
			}];
		}));
	}

	private changedSinceRender(): boolean {
		const rendered = this.renderedSettings;
		if (this.catalogService.state !== this.renderedCatalog || !rendered) {
			return true;
		}
		const now = this.shownSettings();
		if (now.size !== rendered.size) {
			return true;
		}
		for (const [id, shown] of now) {
			const before = rendered.get(id);
			if (!before || before.region !== shown.region || before.setUp !== shown.setUp || before.endpoint !== shown.endpoint
				|| before.customEndpoint !== shown.customEndpoint || before.credentials !== shown.credentials) {
				return true;
			}
		}
		return false;
	}

	private render(): void {
		if (!this.root || !this.content || !this.kindsBar || !this.list || !this.editor || this.disposed) {
			return;
		}
		const providers = this.providers();
		const kinds = offeredKinds(providers);
		if (this.pendingTarget && providers.length) {
			this.applyTarget(this.pendingTarget, providers, kinds);
			this.pendingTarget = undefined;
		}
		if (kinds.length && (this.selectedKind === undefined || !kinds.includes(this.selectedKind))) {
			this.selectedKind = kinds[0];
		}
		// The providers of the type chosen; all of them while no provider has a model to list.
		const listed = this.selectedKind !== undefined && kinds.length ? providersOf(providers, this.selectedKind) : providers;
		if (listed.length && !listed.some(provider => provider.id === this.selectedId)) {
			this.selectedId = listed[0].id;
			this.replacing.clear();
			this.fieldErrors.clear();
		}
		// Text typed for one provider never moves to another one, nor into the form that adds one.
		const shownId = this.adding ? `add:${this.adding}` : this.selectedId;
		const sameProvider = shownId !== undefined && shownId === this.renderedId;
		const sameKind = this.selectedKind === this.renderedKind;
		const kept = this.capture(sameProvider);
		const listScroll = this.list.scrollTop;
		this.clearSensitiveInputs();
		const disposables = new DisposableStore();
		this.renderDisposables.value = disposables;
		this.rows.clear();
		this.controls.clear();
		this.errors.clear();
		this.focusables.clear();
		clearNode(this.kindsBar);
		clearNode(this.list);
		clearNode(this.editor);
		this.renderedId = shownId;
		this.renderedKind = this.selectedKind;

		const state = this.catalogService.state;
		this.renderedCatalog = state;
		this.renderedSettings = this.shownSettings();
		this.outcomeToDraw = false;
		this.root.dataset.catalog = state.kind;
		const empty = state.kind !== 'ready' || !providers.length;
		this.content.classList.toggle('empty', empty);
		if (empty) {
			this.renderNoProviders(state, disposables);
		} else {
			this.renderKinds(kinds.length > 1 ? kinds : [], disposables);
			this.renderList(listed, disposables);
			const selected = providers.find(provider => provider.id === this.selectedId);
			if (this.adding) {
				this.renderAddForm(this.adding, disposables);
			} else if (selected) {
				this.renderEditor(selected, disposables);
			}
		}
		// The list keeps its place while it holds the same type; another type starts at its top. It is
		// scrolled only when its place changes, so that a floating scrollbar shows only then.
		const listTop = sameKind ? listScroll : 0;
		if (this.list.scrollTop !== listTop) {
			this.list.scrollTop = listTop;
		}
		if (!sameKind) {
			this.revealPending = true;
		}
		this.restore(kept);
		if (!sameProvider) {
			this.editor.scrollTop = 0;
		}
		this.revealSelectedRow();
	}

	/**
	 * Brings the provider selected into view in its list, after an opening or a
	 * change of the type, once the list has a height of its own: only the list
	 * scrolls, never the page around it.
	 */
	private revealSelectedRow(): void {
		const list = this.list;
		const row = this.selectedId !== undefined ? this.rows.get(this.selectedId) : undefined;
		if (!this.revealPending || !list || !row || !list.clientHeight || list.scrollHeight <= list.clientHeight) {
			return;
		}
		this.revealPending = false;
		const listBox = list.getBoundingClientRect();
		const rowBox = row.getBoundingClientRect();
		if (rowBox.top < listBox.top) {
			list.scrollTop -= listBox.top - rowBox.top;
		} else if (rowBox.bottom > listBox.bottom) {
			list.scrollTop += rowBox.bottom - listBox.bottom;
		}
	}

	/**
	 * The card types, Image, Video, and Audio, that the catalog's providers
	 * make (D107): one chosen, its providers in the list below. With one type
	 * there is nothing to choose, and nothing is drawn.
	 */
	private renderKinds(kinds: readonly BaseHalfModelKind[], disposables: DisposableStore): void {
		const bar = this.kindsBar!;
		const list = this.list!;
		bar.hidden = !kinds.length;
		if (!kinds.length) {
			list.setAttribute('role', 'navigation');
			list.setAttribute('aria-label', localize('basehalf.video.providers.listLabel', "Providers"));
			list.removeAttribute('aria-labelledby');
			delete list.dataset.kind;
			return;
		}
		list.setAttribute('role', 'tabpanel');
		list.removeAttribute('aria-label');
		const tabs: HTMLButtonElement[] = [];
		for (const kind of kinds) {
			const tab = append(bar, $('button.basehalf-video-providers-kind')) as HTMLButtonElement;
			tabs.push(tab);
			this.focusable(tab, `kind:${kind}`);
			tab.type = 'button';
			tab.id = this.id(`kind-${kind}`);
			tab.dataset.kind = kind;
			tab.textContent = cardTypeLabel(kind);
			const chosen = kind === this.selectedKind;
			tab.setAttribute('role', 'tab');
			tab.setAttribute('aria-selected', String(chosen));
			tab.setAttribute('aria-controls', list.id);
			tab.tabIndex = chosen ? 0 : -1;
			if (chosen) {
				list.setAttribute('aria-labelledby', tab.id);
				list.dataset.kind = kind;
			}
			disposables.add(addDisposableListener(tab, EventType.CLICK, () => this.chooseKind(kind)));
			disposables.add(addDisposableListener(tab, EventType.KEY_DOWN, (event: KeyboardEvent) => {
				const index = tabs.indexOf(tab);
				const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
					: event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
						: event.key === 'Home' ? 0
							: event.key === 'End' ? tabs.length - 1 : undefined;
				if (next === undefined || next === index) {
					return;
				}
				event.preventDefault();
				// The focus moves first, so that the page drawn for the type keeps it on the type.
				tabs[next].focus();
				tabs[next].click();
			}));
		}
	}

	/** While the catalog loads or after it failed, the message takes the place of the list and the provider, with a way to ask again. */
	private renderNoProviders(state: BaseHalfVideoCatalogState, disposables: DisposableStore): void {
		const empty = append(this.editor!, $('.basehalf-video-providers-empty'));
		append(empty, $('p')).textContent = state.kind === 'loading'
			? localize('basehalf.video.providers.loading', "Loading the providers…")
			: state.kind === 'failed'
				? localize('basehalf.video.providers.failed', "BaseHalf could not load the providers: {0}", state.message)
				: localize('basehalf.video.providers.none', "BaseHalf offers no providers.");
		if (state.kind === 'failed') {
			const retry = this.button(empty, localize('basehalf.video.providers.retry', "Try Again"), 'codicon-refresh', 'retry');
			disposables.add(addDisposableListener(retry, EventType.CLICK, () => this.catalogService.load()));
		}
	}

	private renderList(providers: readonly IBaseHalfVideoCatalogProvider[], disposables: DisposableStore): void {
		const list = this.list!;
		const rows: HTMLButtonElement[] = [];
		for (const provider of providers) {
			const status = this.providerSettings.getStatus(provider);
			const row = append(list, $('button.basehalf-video-provider-row')) as HTMLButtonElement;
			rows.push(row);
			this.rows.set(provider.id, row);
			this.focusable(row, `row:${provider.id}`);
			row.type = 'button';
			row.dataset.provider = provider.id;
			const selected = provider.id === this.selectedId && !this.adding;
			row.tabIndex = selected ? 0 : -1;
			if (selected) {
				row.setAttribute('aria-current', 'page');
			}
			const copy = append(row, $('.basehalf-video-provider-row-copy'));
			append(copy, $('.basehalf-video-provider-row-name')).textContent = provider.label;
			const detail = append(copy, $('.basehalf-video-provider-row-detail'));
			detail.textContent = provider.regions.length > 1 ? status.region.label : modelCount(provider, this.selectedKind);
			const setUpLabel = status.setUp
				? localize('basehalf.video.providers.setUp', "Set up")
				: localize('basehalf.video.providers.notSetUp', "Not set up");
			const mark = append(row, $(`span.basehalf-video-provider-row-state.codicon.${status.setUp ? 'codicon-pass-filled' : 'codicon-key'}`));
			mark.classList.toggle('missing', !status.setUp);
			mark.setAttribute('role', 'img');
			mark.setAttribute('aria-label', setUpLabel);
			row.dataset.setUp = String(status.setUp);
			disposables.add(this.hoverService.setupDelayedHover(mark, { content: setUpLabel }));
			disposables.add(addDisposableListener(row, EventType.CLICK, () => {
				if (this.selectedId !== provider.id || this.adding) {
					this.select(provider.id);
					this.adding = undefined;
					this.setStatus('');
					this.render();
					this.rows.get(provider.id)?.focus();
				}
			}));
		}
		// Add Provider ends the list: a custom provider of the type shown (D108).
		const add = append(list, $('button.basehalf-video-provider-add')) as HTMLButtonElement;
		rows.push(add);
		this.focusable(add, 'add');
		add.type = 'button';
		add.tabIndex = this.adding || !providers.length ? 0 : -1;
		if (this.adding) {
			add.setAttribute('aria-current', 'page');
		}
		append(add, $('span.codicon.codicon-add')).setAttribute('aria-hidden', 'true');
		append(add, $('span')).textContent = localize('basehalf.video.providers.addProvider', "Add Provider");
		disposables.add(addDisposableListener(add, EventType.CLICK, () => {
			if (!this.adding) {
				this.adding = this.selectedKind ?? 'image';
				this.fieldErrors.clear();
				this.setStatus('');
				this.render();
				this.focusables.get('add')?.focus();
			}
		}));
		for (const row of rows) {
			disposables.add(addDisposableListener(row, EventType.KEY_DOWN, (event: KeyboardEvent) => {
				const index = rows.indexOf(row);
				const next = event.key === 'ArrowDown' ? index + 1
					: event.key === 'ArrowUp' ? index - 1
						: event.key === 'Home' ? 0
							: event.key === 'End' ? rows.length - 1 : undefined;
				if (next === undefined || next < 0 || next >= rows.length || next === index) {
					return;
				}
				event.preventDefault();
				rows[next].click();
				// The row drawn again for the choice takes the keyboard.
				(next === rows.length - 1 ? this.focusables.get('add') : this.focusables.get(`row:${rows[next].dataset.provider}`))?.focus();
			}));
		}
	}

	private renderEditor(provider: IBaseHalfVideoCatalogProvider, disposables: DisposableStore): void {
		const editor = this.editor!;
		const status = this.providerSettings.getStatus(provider);
		const custom = this.customDefinition(provider.id);
		editor.dataset.provider = provider.id;
		delete editor.dataset.adding;
		const heading = append(editor, $('.basehalf-video-provider-editor-heading'));
		append(heading, $('h2')).textContent = provider.label;
		const summary = append(heading, $('p.basehalf-video-provider-summary'));
		// A provider of several types says which cards its one key serves (D107).
		const types = kindsOf(provider);
		const scope = types.length > 1
			? localize('basehalf.video.providers.oneKey', "One key for {0}", cardsOf(types))
			: modelCount(provider);
		summary.textContent = status.setUp
			? localize('basehalf.video.providers.summarySetUp', "Set up · {0}", scope)
			: localize('basehalf.video.providers.summaryNotSetUp', "Not set up · {0}", scope);
		// The models by name, under Images, Videos, and Audio, so that the user can tell which provider to get
		// credentials from: those of the type chosen first, then what else the same key makes.
		const chosen = this.selectedKind;
		for (const kind of chosen !== undefined ? [chosen, ...BASEHALF_MODEL_KINDS.filter(other => other !== chosen)] : BASEHALF_MODEL_KINDS) {
			const listed = baseHalfVideoListedModels(provider, undefined, kind);
			if (!listed.length) {
				continue;
			}
			const models = append(heading, $('p.basehalf-video-provider-models'));
			models.dataset.kind = kind;
			append(models, $('span.basehalf-video-provider-models-kind')).textContent = modelsHeading(kind);
			for (const [index, model] of listed.entries()) {
				if (index > 0) {
					models.append(' · ');
				}
				const name = append(models, $('span.basehalf-video-provider-model'));
				name.textContent = model.label;
				name.dataset.model = model.id;
				if (custom && custom.models.length > 1) {
					// A custom provider's model can be removed, its last one excepted (D108).
					this.renderRemoveModel(models, provider, custom, model.label, disposables);
				}
				if (!baseHalfVideoRegionOffersModel(model, status.region.id)) {
					// Dimmed: the region does not offer it.
					const notOffered = localize('basehalf.video.providers.modelNotOffered', "{0} is not offered in {1}.", model.label, status.region.label);
					name.classList.add('unavailable');
					name.setAttribute('aria-description', notOffered);
					disposables.add(this.hoverService.setupDelayedHover(name, { content: notOffered }));
				}
			}
		}

		if (custom) {
			this.renderCustomFields(editor, provider, custom, status, disposables);
			return;
		}
		if (provider.regions.length > 1) {
			this.renderRegions(editor, provider, status, disposables);
		}
		// The console of the region chosen, before the credentials, where the user looks for a key (D94).
		if (status.region.console) {
			const consoleUrl = status.region.console;
			const link = append(editor, $('a.basehalf-video-provider-console')) as HTMLAnchorElement;
			this.focusable(link, 'console');
			link.href = consoleUrl;
			// Named by the provider: a region alone is named like "China" or "Global".
			link.textContent = provider.regions.length > 1
				? localize('basehalf.video.providers.consoleOfRegion', "Get credentials in the console of {0} ({1})", provider.label, status.region.label)
				: localize('basehalf.video.providers.console', "Get credentials in the console of {0}", provider.label);
			disposables.add(addDisposableListener(link, EventType.CLICK, event => {
				event.preventDefault();
				void this.openerService.open(URI.parse(consoleUrl), { openExternal: true });
			}));
		}
		for (const credential of provider.credentials) {
			this.renderCredential(editor, provider, credential, status, disposables);
		}
		this.renderEndpoint(editor, provider, status, disposables);
	}

	/** What the user entered for a custom provider (D108), or nothing for a built-in one. */
	private customDefinition(providerId: string | undefined): CustomProviderDefinition | undefined {
		return providerId !== undefined && isCustomProviderId(providerId) ? this.providerSettings.customProviders.find(provider => provider.id === providerId) : undefined;
	}

	/** A labeled text field whose text a render keeps while it is typed in, with an optional hint and its error. */
	private textField(parent: HTMLElement, control: BaseHalfVideoProviderControl, label: string, options: { readonly type?: 'text' | 'url' | 'password'; readonly value?: string; readonly placeholder?: string; readonly hint?: string; readonly maxLength?: number } = {}): HTMLInputElement {
		const field = append(parent, $('.basehalf-video-provider-field'));
		field.dataset.control = control;
		const labelElement = append(field, $('label.basehalf-video-provider-field-label')) as HTMLLabelElement;
		labelElement.textContent = label;
		const input = append(field, $('input')) as HTMLInputElement;
		this.focusable(input, control);
		input.id = this.id(cssId(control));
		labelElement.htmlFor = input.id;
		input.type = options.type ?? 'text';
		input.spellcheck = false;
		input.autocapitalize = 'off';
		input.autocomplete = options.type === 'password' ? 'new-password' : 'off';
		if (options.maxLength) {
			input.maxLength = options.maxLength;
		}
		input.value = options.value ?? '';
		if (options.placeholder) {
			input.placeholder = options.placeholder;
		}
		this.controls.set(control, input);
		if (options.type === 'password') {
			this.sensitiveInputs.add(input);
		}
		const described: string[] = [];
		if (options.hint) {
			const hint = append(field, $('p.basehalf-video-provider-field-hint'));
			hint.id = this.id(`${cssId(control)}-hint`);
			hint.textContent = options.hint;
			described.push(hint.id);
		}
		described.push(this.errorElement(field, control).id);
		input.setAttribute('aria-describedby', described.join(' '));
		return input;
	}

	/** Runs `run` on Enter in a field, unless an input method uses the Enter to choose its text. */
	private onEnter(input: HTMLInputElement, run: () => void, disposables: DisposableStore): void {
		disposables.add(addDisposableListener(input, EventType.KEY_DOWN, (event: KeyboardEvent) => {
			if (event.key === 'Enter' && !isComposing(event)) {
				event.preventDefault();
				run();
			}
		}));
	}

	/**
	 * The form that adds a custom provider of a card type (D108; providers,
	 * "On the Providers page"), in place of a provider: Name, API Address, API
	 * Key, and the id of its first model, of the type shown.
	 */
	private renderAddForm(kind: BaseHalfModelKind, disposables: DisposableStore): void {
		const editor = this.editor!;
		delete editor.dataset.provider;
		editor.dataset.adding = kind;
		const heading = append(editor, $('.basehalf-video-provider-editor-heading'));
		append(heading, $('h2')).textContent = localize('basehalf.video.providers.addTitle', "Add Provider");
		append(heading, $('p.basehalf-video-provider-summary')).textContent = formatOf(kind);
		const fields: HTMLInputElement[] = [
			this.textField(editor, 'add:label', localize('basehalf.video.providers.customName', "Name"), { placeholder: localize('basehalf.video.providers.customNamePlaceholder', "My Relay"), maxLength: 64 }),
			this.textField(editor, 'add:address', localize('basehalf.video.providers.customAddress', "API Address"), { type: 'url', placeholder: 'https://api.example.com/v1', hint: addressHint(kind), maxLength: BASEHALF_VIDEO_ENDPOINT_MAX_LENGTH }),
			this.textField(editor, 'add:apiKey', localize('basehalf.video.providers.customApiKey', "API Key"), { type: 'password', placeholder: localize('basehalf.video.providers.customApiKeyPlaceholder', "Paste the API Key") }),
			this.textField(editor, 'add:model', modelFieldLabel(kind), { placeholder: modelPlaceholder(kind), hint: localize('basehalf.video.providers.customModelHint', "The id the provider gives the model. Add its other models once the provider is added.") })
		];
		const submitField = append(editor, $('.basehalf-video-provider-field.add-submit'));
		const row = append(submitField, $('.basehalf-video-provider-key-row'));
		const submit = this.button(row, localize('basehalf.video.providers.addSubmit', "Add Provider"), 'codicon-add', 'add:submit', true);
		submit.dataset.action = 'add';
		this.errorElement(submitField, 'add:form');
		disposables.add(addDisposableListener(submit, EventType.CLICK, () => void this.addProvider(kind)));
		for (const field of fields) {
			this.onEnter(field, () => void this.addProvider(kind), disposables);
		}
	}

	/** Adds the custom provider of the form; what cannot be taken is said under the form, and nothing is added. */
	private async addProvider(kind: BaseHalfModelKind): Promise<void> {
		if (this.saving.has('add')) {
			return;
		}
		const value = (control: BaseHalfVideoProviderControl) => this.controls.get(control)?.value ?? '';
		const label = value('add:label').trim();
		const entry = { label, baseUrl: value('add:address'), apiKey: value('add:apiKey'), model: { id: value('add:model').trim(), kind } };
		this.saving.add('add');
		this.pendingSaves++;
		this.fieldErrors.delete('add:form');
		this.showFieldError('add:form', undefined);
		let added: string | undefined;
		let failure: string | undefined;
		try {
			added = await this.providerSettings.addCustomProvider(entry);
		} catch (error) {
			failure = saveFailure(error);
		} finally {
			this.saving.delete('add');
			this.pendingSaves--;
		}
		if (this.disposed) {
			return;
		}
		if (added !== undefined) {
			this.adding = undefined;
			this.select(added);
			this.revealPending = true;
			this.clearSensitiveInputs();
			this.setStatus(localize('basehalf.video.providers.customAdded', "{0} added.", label), 'success');
			this.render();
			this.rows.get(added)?.focus();
			return;
		}
		this.fieldErrors.set('add:form', failure!);
		this.showFieldError('add:form', failure);
		this.setStatus(localize('basehalf.video.providers.notSaved', "Not saved."), 'warning');
		if (!this.pendingSaves && (this.outcomeToDraw || this.changedSinceRender())) {
			this.render();
		}
	}

	/** The button that removes a model of a custom provider, after its name. */
	private renderRemoveModel(parent: HTMLElement, provider: IBaseHalfVideoCatalogProvider, custom: CustomProviderDefinition, serviceId: string, disposables: DisposableStore): void {
		const remove = append(parent, $('button.basehalf-video-provider-model-remove')) as HTMLButtonElement;
		remove.type = 'button';
		this.focusable(remove, `custom:remove:${serviceId}`);
		const label = localize('basehalf.video.providers.removeModel', "Remove {0}", serviceId);
		remove.setAttribute('aria-label', label);
		append(remove, $('span.codicon.codicon-close')).setAttribute('aria-hidden', 'true');
		disposables.add(this.hoverService.setupDelayedHover(remove, { content: label }));
		disposables.add(addDisposableListener(remove, EventType.CLICK, () => {
			void this.save(provider, `remove:${serviceId}`, undefined, () => this.providerSettings.updateCustomProvider(provider.id, { models: custom.models.filter(model => model.id !== serviceId) }), {
				success: localize('basehalf.video.providers.modelRemoved', "{0} removed.", serviceId)
			});
		}));
	}

	/**
	 * What a custom provider's page holds after its models (D108): Add Model,
	 * its Name and API Address, its key, its Voices when it has a speech model,
	 * and Remove Provider. Each change is saved as the page saves the others.
	 */
	private renderCustomFields(editor: HTMLElement, provider: IBaseHalfVideoCatalogProvider, custom: CustomProviderDefinition, status: IBaseHalfVideoProviderStatus, disposables: DisposableStore): void {
		const chosen = this.selectedKind ?? 'image';
		// Add Model: an id and its card type, the type shown first.
		const field = append(editor, $('.basehalf-video-provider-field.add-model'));
		const label = append(field, $('label.basehalf-video-provider-field-label')) as HTMLLabelElement;
		label.textContent = localize('basehalf.video.providers.addModel', "Add Model");
		const row = append(field, $('.basehalf-video-provider-key-row'));
		const input = append(row, $('input')) as HTMLInputElement;
		this.focusable(input, 'custom:model');
		input.id = this.id('custom-model');
		label.htmlFor = input.id;
		input.type = 'text';
		input.spellcheck = false;
		input.autocapitalize = 'off';
		input.autocomplete = 'off';
		input.placeholder = localize('basehalf.video.providers.addModelPlaceholder', "The id the provider gives the model");
		this.controls.set('custom:model', input);
		const kindSelect = append(row, $('select.basehalf-video-provider-kind-select')) as HTMLSelectElement;
		this.focusable(kindSelect, 'custom:modelKind');
		kindSelect.setAttribute('aria-label', localize('basehalf.video.providers.addModelKind', "Card type of the model"));
		for (const kind of [chosen, ...BASEHALF_MODEL_KINDS.filter(other => other !== chosen)]) {
			const option = append(kindSelect, $('option')) as HTMLOptionElement;
			option.value = kind;
			option.textContent = cardTypeLabel(kind);
		}
		const addModel = this.button(row, localize('basehalf.video.providers.addModelButton', "Add Model"), 'codicon-add', 'custom:addModel');
		addModel.dataset.action = 'add-model';
		const error = this.errorElement(field, 'custom:model');
		input.setAttribute('aria-describedby', error.id);
		const submitModel = () => {
			const id = input.value.trim();
			const kind = BASEHALF_MODEL_KINDS.find(candidate => candidate === kindSelect.value) ?? chosen;
			void this.save(provider, 'models', 'custom:model', () => this.providerSettings.updateCustomProvider(provider.id, { models: [...custom.models, { id, kind }] }), {
				success: localize('basehalf.video.providers.modelAdded', "{0} added.", id),
				onSuccess: () => input.value = ''
			});
		};
		disposables.add(addDisposableListener(addModel, EventType.CLICK, submitModel));
		this.onEnter(input, submitModel, disposables);

		const nameField = this.textField(editor, 'custom:label', localize('basehalf.video.providers.customName', "Name"), { value: custom.label, maxLength: 64 });
		this.saveOnChange(nameField, provider, 'custom:label', () => custom.label, value => ({ label: value }), localize('basehalf.video.providers.nameSaved', "Name saved."), disposables);
		const kinds = custom.models.map(model => model.kind);
		const addressField = this.textField(editor, 'custom:address', localize('basehalf.video.providers.customAddress', "API Address"), { type: 'url', value: custom.baseUrl, hint: addressHint(kinds.includes(chosen) ? chosen : kinds[0]), maxLength: BASEHALF_VIDEO_ENDPOINT_MAX_LENGTH });
		this.saveOnChange(addressField, provider, 'custom:address', () => custom.baseUrl, value => ({ baseUrl: value }), localize('basehalf.video.providers.addressSaved', "API Address saved."), disposables);
		for (const credential of provider.credentials) {
			this.renderCredential(editor, provider, credential, status, disposables);
		}
		if (kinds.includes('audio')) {
			const voices = this.textField(editor, 'custom:voices', localize('basehalf.video.providers.customVoices', "Voices"), {
				value: (custom.voices ?? []).join(', '),
				placeholder: DEFAULT_VOICE_LIST,
				hint: localize('basehalf.video.providers.customVoicesHint', "The ids of the voices its speech models speak in, separated by commas. Empty, they speak in the six voices of OpenAI's speech API.")
			});
			this.saveOnChange(voices, provider, 'custom:voices', () => (custom.voices ?? []).join(', '), value => ({ voices: value.split(/[\s,]+/).filter(voice => voice) }), localize('basehalf.video.providers.voicesSaved', "Voices saved."), disposables);
		}
		const removeField = append(editor, $('.basehalf-video-provider-field.remove-provider'));
		const remove = this.button(removeField, localize('basehalf.video.providers.removeProvider', "Remove Provider"), 'codicon-trash', 'custom:removeProvider');
		remove.dataset.action = 'remove-provider';
		disposables.add(addDisposableListener(remove, EventType.CLICK, () => void this.removeCustomProvider(provider, custom)));
	}

	/** Saves a field of a custom provider when it is left or on Enter, unless it holds what is stored. */
	private saveOnChange(input: HTMLInputElement, provider: IBaseHalfVideoCatalogProvider, control: BaseHalfVideoProviderControl, stored: () => string, change: (value: string) => IBaseHalfCustomProviderChange, success: string, disposables: DisposableStore): void {
		const run = () => {
			if (input.value.trim() === stored().trim() && !this.fieldErrors.has(control)) {
				return;
			}
			void this.save(provider, control, control, () => this.providerSettings.updateCustomProvider(provider.id, change(input.value)), { success });
		};
		disposables.add(addDisposableListener(input, EventType.CHANGE, run));
		this.onEnter(input, run, disposables);
	}

	private async removeCustomProvider(provider: IBaseHalfVideoCatalogProvider, custom: CustomProviderDefinition): Promise<void> {
		const { confirmed } = await this.dialogService.confirm({
			message: localize('basehalf.video.providers.removeProviderConfirm', "Remove {0}?", custom.label),
			detail: localize('basehalf.video.providers.removeProviderDetail', "Its API Key is deleted from this computer, and {0} that use its models cannot generate until you choose another model.", cardsOf(kindsOf(provider))),
			primaryButton: localize({ key: 'basehalf.video.providers.removeProviderButton', comment: ['&& denotes a mnemonic'] }, "&&Remove")
		});
		if (confirmed) {
			await this.save(provider, 'removeProvider', undefined, () => this.providerSettings.removeCustomProvider(provider.id), {
				success: localize('basehalf.video.providers.providerRemoved', "{0} removed.", custom.label)
			});
		}
	}

	private renderRegions(editor: HTMLElement, provider: IBaseHalfVideoCatalogProvider, status: IBaseHalfVideoProviderStatus, disposables: DisposableStore): void {
		const field = append(editor, $('.basehalf-video-provider-field.region'));
		const label = append(field, $('.basehalf-video-provider-field-label'));
		label.id = this.id('region-label');
		label.textContent = localize('basehalf.video.providers.region', "Region");
		// A key works only in the region whose console made it: the user chooses the region of their key (D94).
		const hint = append(field, $('p.basehalf-video-provider-field-hint'));
		hint.id = this.id('region-hint');
		hint.textContent = localize('basehalf.video.providers.regionHint', "Each region has its own console, keys, and models. Choose the region your key comes from.");
		const group = append(field, $('.basehalf-video-provider-regions'));
		group.setAttribute('role', 'radiogroup');
		group.setAttribute('aria-labelledby', label.id);
		group.setAttribute('aria-describedby', hint.id);
		const buttons: HTMLButtonElement[] = [];
		for (const region of provider.regions) {
			const button = append(group, $('button.basehalf-video-provider-region')) as HTMLButtonElement;
			buttons.push(button);
			this.focusable(button, `region:${region.id}`);
			button.type = 'button';
			button.dataset.region = region.id;
			const checked = region.id === status.region.id;
			button.setAttribute('role', 'radio');
			button.setAttribute('aria-checked', String(checked));
			button.tabIndex = checked ? 0 : -1;
			append(button, $('span.basehalf-video-provider-region-label')).textContent = region.label;
			disposables.add(addDisposableListener(button, EventType.CLICK, () => {
				if (region.id !== this.providerSettings.getStatus(provider).region.id) {
					void this.save(provider, `region:${region.id}`, undefined, () => this.providerSettings.setRegion(provider, region.id), {
						success: localize('basehalf.video.providers.regionSaved', "Region saved.")
					});
				}
			}));
			disposables.add(addDisposableListener(button, EventType.KEY_DOWN, (event: KeyboardEvent) => {
				const index = buttons.indexOf(button);
				const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (index + 1) % buttons.length
					: event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (index - 1 + buttons.length) % buttons.length
						: undefined;
				if (next === undefined) {
					return;
				}
				event.preventDefault();
				buttons[next].focus();
				buttons[next].click();
			}));
		}
	}

	private renderCredential(editor: HTMLElement, provider: IBaseHalfVideoCatalogProvider, credential: IBaseHalfVideoCatalogCredential, status: IBaseHalfVideoProviderStatus, disposables: DisposableStore): void {
		const control: BaseHalfVideoProviderControl = `credential:${credential.id}`;
		const isSet = status.credentials.has(credential.id);
		const field = append(editor, $('.basehalf-video-provider-field.credential'));
		field.dataset.credential = credential.id;
		const label = append(field, $('.basehalf-video-provider-field-label'));
		label.id = this.id(`credential-${cssId(credential.id)}-label`);
		label.textContent = credential.label;
		const state = append(field, $('.basehalf-video-provider-key-state'));
		state.classList.toggle('set', isSet);
		append(state, $(`span.codicon.${isSet ? 'codicon-pass-filled' : 'codicon-key'}`)).setAttribute('aria-hidden', 'true');
		append(state, $('span')).textContent = isSet
			? localize('basehalf.video.providers.credentialSet', "Set. It is encrypted on this computer and never shown.")
			: localize('basehalf.video.providers.credentialMissing', "Not set. Paste it from the provider's console.");

		const row = append(field, $('.basehalf-video-provider-key-row'));
		if (!isSet || this.replacing.has(credential.id)) {
			const input = append(row, $('input')) as HTMLInputElement;
			this.focusable(input, `${control}:input`);
			input.type = 'password';
			input.autocomplete = 'new-password';
			input.spellcheck = false;
			input.autocapitalize = 'off';
			input.placeholder = credential.placeholder ?? localize('basehalf.video.providers.credentialPlaceholder', "Paste the {0}", credential.label);
			input.setAttribute('aria-labelledby', label.id);
			this.controls.set(control, input);
			this.sensitiveInputs.add(input);
			const saveButton = this.button(row, isSet
				? localize('basehalf.video.providers.replaceSave', "Save New Value")
				: localize('basehalf.video.providers.set', "Set"), 'codicon-check', `${control}:set`, true);
			saveButton.dataset.action = 'set';
			saveButton.setAttribute('aria-label', isSet
				? localize('basehalf.video.providers.replaceSaveLabel', "Save the new {0}", credential.label)
				: localize('basehalf.video.providers.setLabel', "Set {0}", credential.label));
			const submit = () => {
				if (this.saving.has(saveKey(provider, control))) {
					// The value is being saved: a second click is not a second change.
					return;
				}
				const value = input.value;
				input.value = '';
				void this.save(provider, control, control, () => this.providerSettings.setCredential(provider, credential.id, value), {
					success: localize('basehalf.video.providers.credentialSaved', "{0} saved.", credential.label),
					onSuccess: () => this.replacing.delete(credential.id),
					onFailure: () => {
						// Not saved: give the pasted text back so the user can correct it.
						const current = this.controls.get(control);
						if (current && !current.value) {
							current.value = value;
						}
					}
				});
			};
			disposables.add(addDisposableListener(saveButton, EventType.CLICK, submit));
			disposables.add(addDisposableListener(input, EventType.KEY_DOWN, (event: KeyboardEvent) => {
				if (isComposing(event)) {
					return;
				}
				if (event.key === 'Enter') {
					event.preventDefault();
					submit();
				} else if (event.key === 'Escape' && this.replacing.has(credential.id)) {
					event.preventDefault();
					event.stopPropagation();
					this.cancelReplacing(credential.id);
				}
			}));
			if (isSet) {
				const cancel = this.button(row, localize('basehalf.video.providers.cancel', "Cancel"), 'codicon-close', `${control}:cancel`);
				cancel.dataset.action = 'cancel';
				cancel.setAttribute('aria-label', localize('basehalf.video.providers.cancelLabel', "Keep the current {0}", credential.label));
				disposables.add(addDisposableListener(cancel, EventType.CLICK, () => this.cancelReplacing(credential.id)));
			}
		} else {
			const replace = this.button(row, localize('basehalf.video.providers.replace', "Replace"), 'codicon-edit', `${control}:replace`);
			replace.dataset.action = 'replace';
			replace.setAttribute('aria-label', localize('basehalf.video.providers.replaceLabel', "Replace {0}", credential.label));
			disposables.add(addDisposableListener(replace, EventType.CLICK, () => {
				this.replacing.add(credential.id);
				this.render();
				this.controls.get(control)?.focus();
			}));
			const remove = this.button(row, localize('basehalf.video.providers.remove', "Remove"), 'codicon-trash', `${control}:remove`);
			remove.dataset.action = 'remove';
			remove.setAttribute('aria-label', localize('basehalf.video.providers.removeLabel', "Remove {0}", credential.label));
			disposables.add(addDisposableListener(remove, EventType.CLICK, () => void this.removeCredential(provider, credential)));
		}
		const error = this.errorElement(field, control);
		this.controls.get(control)?.setAttribute('aria-describedby', error.id);
	}

	private renderEndpoint(editor: HTMLElement, provider: IBaseHalfVideoCatalogProvider, status: IBaseHalfVideoProviderStatus, disposables: DisposableStore): void {
		const field = append(editor, $('.basehalf-video-provider-field.endpoint'));
		const label = append(field, $('label.basehalf-video-provider-field-label')) as HTMLLabelElement;
		label.textContent = localize('basehalf.video.providers.endpoint', "Endpoint");
		const input = append(field, $('input')) as HTMLInputElement;
		this.focusable(input, 'endpoint');
		input.id = this.id('endpoint');
		label.htmlFor = input.id;
		input.type = 'url';
		input.spellcheck = false;
		input.autocapitalize = 'off';
		input.autocomplete = 'off';
		input.maxLength = BASEHALF_VIDEO_ENDPOINT_MAX_LENGTH;
		input.value = status.endpoint;
		input.placeholder = status.region.baseUrl;
		input.dataset.custom = String(status.customEndpoint);
		this.controls.set('endpoint', input);
		const hint = append(field, $('p.basehalf-video-provider-field-hint'));
		hint.id = this.id('endpoint-hint');
		hint.textContent = localize('basehalf.video.providers.endpointHint', "Requests go to the region's address. For a relay or a private gateway that mirrors the API of {0}, enter its address; clear the field to go back to the region's.", provider.label);
		input.setAttribute('aria-describedby', `${hint.id} ${this.errorElement(field, 'endpoint').id}`);
		disposables.add(addDisposableListener(input, EventType.CHANGE, () => void this.saveEndpoint(provider, input)));
		disposables.add(addDisposableListener(input, EventType.KEY_DOWN, (event: KeyboardEvent) => {
			if (event.key === 'Enter' && !isComposing(event)) {
				event.preventDefault();
				// Saved where the focus is: taking the focus away would leave the page, where
				// Escape no longer closes Settings.
				void this.saveEndpoint(provider, input);
			}
		}));
	}

	private errorElement(field: HTMLElement, control: BaseHalfVideoProviderControl): HTMLElement {
		const error = append(field, $('.basehalf-video-provider-field-error'));
		error.id = this.id(`${cssId(control)}-error`);
		error.setAttribute('role', 'alert');
		this.errors.set(control, error);
		this.showFieldError(control, this.fieldErrors.get(control));
		return error;
	}

	/** Shows the error of a control, or none, where the control is. */
	private showFieldError(control: BaseHalfVideoProviderControl, message: string | undefined): void {
		const error = this.errors.get(control);
		if (error) {
			error.textContent = message ?? '';
			error.hidden = message === undefined;
		}
		const input = this.controls.get(control);
		if (message !== undefined) {
			input?.setAttribute('aria-invalid', 'true');
		} else {
			input?.removeAttribute('aria-invalid');
		}
	}

	/**
	 * Runs one change and shows its outcome. Nothing here talks to the provider.
	 * Changes run one after another in the provider settings service; a second
	 * change waits for the first instead of being dropped, the same change of
	 * the same provider is not made twice, and the outcome of a change touches
	 * the fields only while its provider is the one shown.
	 */
	private async save(provider: IBaseHalfVideoCatalogProvider, key: string, control: BaseHalfVideoProviderControl | undefined, operation: () => Promise<void>, outcome: IBaseHalfVideoProvidersSaveOutcome): Promise<void> {
		const saving = saveKey(provider, key);
		if (this.saving.has(saving)) {
			return;
		}
		this.saving.add(saving);
		this.pendingSaves++;
		if (control) {
			this.fieldErrors.delete(control);
		}
		let failure: string | undefined;
		try {
			await operation();
		} catch (error) {
			failure = saveFailure(error);
		} finally {
			this.saving.delete(saving);
			this.pendingSaves--;
		}
		if (this.disposed) {
			return;
		}
		const shown = provider.id === this.selectedId;
		if (failure === undefined) {
			if (shown) {
				outcome.onSuccess?.();
				this.setStatus(outcome.success, 'success');
			} else {
				this.setStatus(outcomeFor(provider, outcome.success), 'success');
			}
		} else if (shown && control) {
			this.fieldErrors.set(control, failure);
			this.setStatus(localize('basehalf.video.providers.notSaved', "Not saved."), 'warning');
		} else {
			this.setStatus(shown ? failure : outcomeFor(provider, failure), 'warning');
		}
		// The last change to end draws the page, with what the others changed.
		if (this.pendingSaves) {
			this.outcomeToDraw = true;
		} else {
			this.renderWhenFree();
		}
		if (failure !== undefined && shown) {
			outcome.onFailure?.();
			if (control) {
				this.controls.get(control)?.focus();
			}
		}
	}

	/**
	 * Saves the endpoint as typed, and shows the outcome in place: the page is
	 * not drawn again for it, so the click that took the focus from the field
	 * reaches what it clicked, and a field being typed in keeps its caret. What
	 * other changes did meanwhile is drawn.
	 */
	private async saveEndpoint(provider: IBaseHalfVideoCatalogProvider, input: HTMLInputElement): Promise<void> {
		this.pendingSaves++;
		let failure: string | undefined;
		try {
			await this.providerSettings.setEndpoint(provider, input.value);
		} catch (error) {
			failure = saveFailure(error);
		} finally {
			this.pendingSaves--;
		}
		if (this.disposed) {
			return;
		}
		const inPlace = this.controls.get('endpoint') === input;
		if (!inPlace) {
			// Another provider is shown now, or the page was drawn again meanwhile.
			this.setStatus(outcomeFor(provider, failure ?? localize('basehalf.video.providers.saved', "Saved.")), failure === undefined ? 'success' : 'warning');
		} else if (failure !== undefined) {
			this.fieldErrors.set('endpoint', failure);
			this.showFieldError('endpoint', failure);
			this.setStatus(localize('basehalf.video.providers.notSaved', "Not saved."), 'warning');
		} else {
			this.fieldErrors.delete('endpoint');
			this.showFieldError('endpoint', undefined);
			const status = this.providerSettings.getStatus(provider);
			if (getActiveElement() !== input) {
				// The address as it is stored: without a trailing slash, or the region's.
				input.value = status.endpoint;
			}
			input.dataset.custom = String(status.customEndpoint);
			this.setStatus(localize('basehalf.video.providers.saved', "Saved."), 'success');
			// The field shows this provider's endpoint now: only it counts as drawn.
			const rendered = this.renderedSettings?.get(provider.id);
			if (this.renderedSettings && rendered) {
				this.renderedSettings = new Map(this.renderedSettings).set(provider.id, { ...rendered, endpoint: status.endpoint, customEndpoint: status.customEndpoint });
			}
		}
		if (!this.pendingSaves && (this.outcomeToDraw || this.changedSinceRender())) {
			this.render();
		}
	}

	/**
	 * An endpoint typed and not saved yet is saved when the page closes or is
	 * left, as leaving its field saves it: Escape or Cmd+W close Settings
	 * without taking the focus from the field. The page is gone by then, so an
	 * address it cannot take is not kept, and nothing is said.
	 */
	private saveTypedEndpoint(): void {
		const input = this.controls.get('endpoint');
		const provider = this.providers().find(candidate => candidate.id === this.renderedId);
		// Settings hides the page and then disposes it: the same text is saved once.
		if (!input || !provider || this.disposed || input.value === this.endpointSavedOnClose) {
			return;
		}
		const status = this.providerSettings.getStatus(provider);
		const typed = input.value.trim();
		if (typed === status.endpoint || (!typed && !status.customEndpoint)) {
			return;
		}
		this.endpointSavedOnClose = input.value;
		try {
			this.providerSettings.setEndpoint(provider, input.value).catch(() => undefined);
		} catch {
			// The settings of the providers are gone with the window.
		}
	}

	private cancelReplacing(credentialId: string): void {
		this.replacing.delete(credentialId);
		this.fieldErrors.delete(`credential:${credentialId}`);
		this.render();
	}

	private async removeCredential(provider: IBaseHalfVideoCatalogProvider, credential: IBaseHalfVideoCatalogCredential): Promise<void> {
		const { confirmed } = await this.dialogService.confirm({
			message: localize('basehalf.video.providers.removeConfirm', "Remove the {0} of {1}?", credential.label, provider.label),
			// The cards of every type the key serves lose it, not only those of the type shown (D107).
			detail: localize('basehalf.video.providers.removeDetail', "It is deleted from this computer, and {0} cannot use {1} until you set it again.", cardsOf(kindsOf(provider)), provider.label),
			primaryButton: localize({ key: 'basehalf.video.providers.removeButton', comment: ['&& denotes a mnemonic'] }, "&&Remove")
		});
		if (confirmed) {
			const control: BaseHalfVideoProviderControl = `credential:${credential.id}`;
			await this.save(provider, control, control, () => this.providerSettings.setCredential(provider, credential.id, undefined), {
				success: localize('basehalf.video.providers.credentialRemoved', "{0} removed.", credential.label)
			});
		}
	}

	private button(parent: HTMLElement, label: string, icon: string, focusKey: string, primary = false): HTMLButtonElement {
		const element = append(parent, $('button.basehalf-video-providers-button')) as HTMLButtonElement;
		this.focusable(element, focusKey);
		element.type = 'button';
		element.classList.toggle('primary', primary);
		append(element, $(`span.codicon.${icon}`)).setAttribute('aria-hidden', 'true');
		append(element, $('span')).textContent = label;
		return element;
	}

	/** Records an element that can have the focus, under a key that the same control keeps from one render to the next. */
	private focusable(element: HTMLElement, key: string): void {
		element.dataset.focus = key;
		this.focusables.set(key, element);
	}

	private setStatus(message: string, kind?: BaseHalfVideoProvidersStatusKind): void {
		if (!this.status) {
			return;
		}
		this.status.textContent = message;
		if (message && kind) {
			this.status.dataset.state = kind;
		} else {
			delete this.status.dataset.state;
		}
	}

	/**
	 * What a render keeps: the control that has the focus, with its selection,
	 * and the text of fields being edited for the provider still shown.
	 */
	private capture(sameProvider: boolean): IBaseHalfVideoProvidersKept {
		const active = getActiveElement();
		const inPage = isHTMLElement(active) && !!this.root?.contains(active);
		const focus = inPage ? (active === this.root ? 'page' : active.dataset.focus) : undefined;
		const selection = inPage && isHTMLInputElement(active) && active.selectionStart !== null && active.selectionEnd !== null
			? [active.selectionStart, active.selectionEnd] as const
			: undefined;
		const values = new Map<BaseHalfVideoProviderControl, string>();
		if (sameProvider) {
			for (const [control, input] of this.controls) {
				// A focused field keeps what is being typed when another window changes the
				// provider, a credential field and the form that adds a provider keep unsaved
				// text, and a field of what is stored keeps text that its error is about.
				const unsaved = control.startsWith('credential:') || control.startsWith('add:') || control === 'custom:model';
				if (input.value && (input === active || unsaved || this.fieldErrors.has(control))) {
					values.set(control, input.value);
				}
			}
		}
		return { focus, selection, values };
	}

	private restore(kept: IBaseHalfVideoProvidersKept): void {
		for (const [control, value] of kept.values) {
			const input = this.controls.get(control);
			if (input) {
				input.value = value;
			}
		}
		if (kept.focus === undefined) {
			return;
		}
		const target = kept.focus === 'page' ? this.root : this.focusTarget(kept.focus);
		if (!target) {
			return;
		}
		target.focus();
		if (kept.selection && isHTMLInputElement(target) && target.dataset.focus === kept.focus) {
			try {
				target.setSelectionRange(kept.selection[0], kept.selection[1]);
			} catch {
				// A field of type url keeps no selection.
			}
		}
	}

	/**
	 * The element of a focus key, or the one that took its place: after Set,
	 * the field's Replace; after Remove, its input; and otherwise the selected
	 * provider.
	 */
	private focusTarget(key: string): HTMLElement | undefined {
		const exact = this.focusables.get(key);
		if (exact) {
			return exact;
		}
		const family = key.slice(0, key.lastIndexOf(':') + 1);
		if (family.startsWith('credential:')) {
			for (const [candidate, element] of this.focusables) {
				if (candidate.startsWith(family)) {
					return element;
				}
			}
		}
		// While the catalog loads after Try Again there is neither: the page keeps the focus.
		return (this.selectedId !== undefined ? this.rows.get(this.selectedId) : undefined) ?? this.focusables.get('retry') ?? this.root;
	}

	private clearSensitiveInputs(): void {
		for (const input of this.sensitiveInputs) {
			input.value = '';
		}
		this.sensitiveInputs.clear();
	}
}

/** The heading of a provider's models of a kind: Images, Videos, or Audio. */
function modelsHeading(kind: BaseHalfModelKind): string {
	switch (kind) {
		case 'image': return localize('basehalf.video.providers.images', "Images");
		case 'video': return localize('basehalf.video.providers.videos', "Videos");
		case 'audio': return localize('basehalf.video.providers.audio', "Audio");
	}
}

/** How many models a provider lists, of a card type when one is given. */
function modelCount(provider: IBaseHalfVideoCatalogProvider, kind?: BaseHalfModelKind): string {
	const count = baseHalfVideoListedModels(provider, undefined, kind).length;
	return count === 1
		? localize('basehalf.video.providers.modelOne', "1 model")
		: localize('basehalf.video.providers.models', "{0} models", count);
}

/** The card types a provider makes: those it lists a model of, which is not deprecated (D107). */
function kindsOf(provider: IBaseHalfVideoCatalogProvider): BaseHalfModelKind[] {
	return BASEHALF_MODEL_KINDS.filter(kind => baseHalfVideoListedModels(provider, undefined, kind).length > 0);
}

/** The card types the page offers: those that a provider of the catalog makes. */
function offeredKinds(providers: readonly IBaseHalfVideoCatalogProvider[]): BaseHalfModelKind[] {
	return BASEHALF_MODEL_KINDS.filter(kind => providers.some(provider => baseHalfVideoListedModels(provider, undefined, kind).length > 0));
}

/** The providers of a card type, in the catalog's order. */
function providersOf(providers: readonly IBaseHalfVideoCatalogProvider[], kind: BaseHalfModelKind): IBaseHalfVideoCatalogProvider[] {
	return providers.filter(provider => baseHalfVideoListedModels(provider, undefined, kind).length > 0);
}

/** The name of a card type in the choice above the list: Image, Video, or Audio. */
function cardTypeLabel(kind: BaseHalfModelKind): string {
	switch (kind) {
		case 'image': return localize('basehalf.video.providers.kindImage', "Image");
		case 'video': return localize('basehalf.video.providers.kindVideo', "Video");
		case 'audio': return localize('basehalf.video.providers.kindAudio', "Audio");
	}
}

/** The cards of some types, as a sentence names them: "image and video cards". */
function cardsOf(kinds: readonly BaseHalfModelKind[]): string {
	const image = kinds.includes('image');
	const video = kinds.includes('video');
	const audio = kinds.includes('audio');
	if (image && video && audio) {
		return localize('basehalf.video.providers.cardsImageVideoAudio', "image, video, and audio cards");
	} else if (image && video) {
		return localize('basehalf.video.providers.cardsImageVideo', "image and video cards");
	} else if (image && audio) {
		return localize('basehalf.video.providers.cardsImageAudio', "image and audio cards");
	} else if (video && audio) {
		return localize('basehalf.video.providers.cardsVideoAudio', "video and audio cards");
	} else if (image) {
		return localize('basehalf.video.providers.cardsImage', "image cards");
	} else if (video) {
		return localize('basehalf.video.providers.cardsVideo', "video cards");
	} else if (audio) {
		return localize('basehalf.video.providers.cardsAudio', "audio cards");
	}
	return localize('basehalf.video.providers.cards', "cards");
}

/** What the changes of the providers are known by on the page: the same change of the same provider is not made twice. */
function saveKey(provider: IBaseHalfVideoCatalogProvider, key: string): string {
	return `${provider.id}:${key}`;
}

/** The outcome of a change of a provider that is not the one shown, with the provider's name. */
function outcomeFor(provider: IBaseHalfVideoCatalogProvider, message: string): string {
	return localize('basehalf.video.providers.outcomeFor', "{0}: {1}", provider.label, message);
}

/** The voices a custom speech model speaks in when the user entered none (D108). */
const DEFAULT_VOICE_LIST = DEFAULT_CUSTOM_VOICES.join(', ');

/** The format a custom provider's models of a card type are called in (D108; providers, "Formats"). */
function formatOf(kind: BaseHalfModelKind): string {
	switch (kind) {
		case 'image': return localize('basehalf.video.providers.formatImage', "A provider BaseHalf does not integrate, whose image models are called in OpenAI's Image API format. One key serves all of its models.");
		case 'video': return localize('basehalf.video.providers.formatVideo', "A provider BaseHalf does not integrate, whose video models are called in the video format that relays share. One key serves all of its models.");
		case 'audio': return localize('basehalf.video.providers.formatAudio', "A provider BaseHalf does not integrate, whose speech models are called in OpenAI's speech API format. One key serves all of its models.");
	}
}

/** Where the calls of a card type go under the API address. */
function addressHint(kind: BaseHalfModelKind): string {
	switch (kind) {
		case 'image': return localize('basehalf.video.providers.addressHintImage', "The address before /images/generations; it usually ends in /v1. https://, or http:// on this computer.");
		case 'video': return localize('basehalf.video.providers.addressHintVideo', "The address before /video/generations; it usually ends in /v1. https://, or http:// on this computer.");
		case 'audio': return localize('basehalf.video.providers.addressHintAudio', "The address before /audio/speech; it usually ends in /v1. https://, or http:// on this computer.");
	}
}

function modelFieldLabel(kind: BaseHalfModelKind): string {
	switch (kind) {
		case 'image': return localize('basehalf.video.providers.imageModelId', "Image Model ID");
		case 'video': return localize('basehalf.video.providers.videoModelId', "Video Model ID");
		case 'audio': return localize('basehalf.video.providers.speechModelId', "Speech Model ID");
	}
}

function modelPlaceholder(kind: BaseHalfModelKind): string {
	switch (kind) {
		case 'image': return localize('basehalf.video.providers.imageModelPlaceholder', "Such as gpt-image-1");
		case 'video': return localize('basehalf.video.providers.videoModelPlaceholder', "The id the provider gives the model");
		case 'audio': return localize('basehalf.video.providers.speechModelPlaceholder', "Such as tts-1");
	}
}

/** The plain words of a change that was not saved. */
function saveFailure(error: unknown): string {
	return error instanceof BaseHalfVideoProviderSettingsError
		? error.message
		: localize('basehalf.video.providers.saveFailed', "BaseHalf could not save this change: {0}", getErrorMessage(error));
}

/** Enter while an input method composes text chooses the composed text, and is not for the page. */
function isComposing(event: KeyboardEvent): boolean {
	return event.isComposing || event.keyCode === 229;
}

/** An id that can name an element: only letters, digits, and hyphens. */
function cssId(value: string): string {
	return value.replace(/[^A-Za-z0-9-]/g, '-');
}
