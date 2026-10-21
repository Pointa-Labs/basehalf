/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfVideoProviders.css';
import { $, addDisposableListener, append, clearNode, EventType, getActiveElement, isHTMLElement, isHTMLInputElement } from '../../../../base/browser/dom.js';
import { getErrorMessage } from '../../../../base/common/errors.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { ISettingsCustomSection, ISettingsCustomSectionLayout } from '../../../contrib/preferences/browser/settingsCustomSections.js';
import { BaseHalfVideoCatalogState, baseHalfVideoListedModels, baseHalfVideoRegionOffersModel, IBaseHalfVideoCatalogCredential, IBaseHalfVideoCatalogProvider } from '../common/basehalfVideoCatalog.js';
import { IBaseHalfVideoCatalogService, IBaseHalfVideoProviderSettingsService, IBaseHalfVideoProviderStatus } from '../common/basehalfVideoGeneration.js';
import { BASEHALF_VIDEO_ENDPOINT_MAX_LENGTH, BaseHalfVideoProviderSettingsError } from '../common/basehalfVideoProviderSettings.js';

type BaseHalfVideoProvidersStatusKind = 'success' | 'warning';

/** A control whose text survives a render: the endpoint, or the field of one credential. */
type BaseHalfVideoProviderControl = 'endpoint' | `credential:${string}`;

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
 * The Video Providers page of Settings (D59, video providers, "Credentials,
 * regions, and endpoints"), drawn from the model catalog: the providers in
 * the catalog's order, and for the one selected its region, one masked field
 * per credential it declares, its endpoint, and a link to the region's
 * console. Saving checks nothing with the provider; the first generation tells
 * whether the credentials work. A stored value is never read here and never
 * shown: the page knows only whether one is set.
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
	private list: HTMLElement | undefined;
	private editor: HTMLElement | undefined;
	private selectedId: string | undefined;
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
				this.render();
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
		title.textContent = localize('basehalf.video.providers.title', "Video Providers");
		const subtitle = append(heading, $('p'));
		subtitle.textContent = localize('basehalf.video.providers.subtitle', "Video nodes run on these providers with your own credentials, and you pay each provider directly. Credentials are encrypted and stay on this computer. Nothing is checked with a provider until its first generation.");

		this.status = append(this.root, $('p.basehalf-video-providers-status'));
		this.status.setAttribute('role', 'status');
		this.status.setAttribute('aria-live', 'polite');

		this.content = append(this.root, $('.basehalf-video-providers-content'));
		this.list = append(this.content, $('.basehalf-video-providers-list'));
		this.list.setAttribute('role', 'navigation');
		this.list.setAttribute('aria-label', localize('basehalf.video.providers.listLabel', "Providers"));
		this.editor = append(this.content, $('.basehalf-video-provider-editor'));
		this.editor.setAttribute('role', 'region');
		this.editor.setAttribute('aria-label', localize('basehalf.video.providers.editorLabel', "Provider settings"));
		// A catalog that could not be loaded is asked for again when the page opens.
		this.catalogService.load();
		this.render();
	}

	setInput(input: string | undefined): void {
		if (input && input !== this.selectedId) {
			this.setStatus('');
		}
		if (input && this.providers().some(provider => provider.id === input)) {
			this.select(input);
		} else if (input) {
			// The catalog may still load: show the provider once it is there.
			this.selectedId = input;
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
		if (!this.root || !this.content || !this.list || !this.editor || this.disposed) {
			return;
		}
		const providers = this.providers();
		if (providers.length && !providers.some(provider => provider.id === this.selectedId)) {
			this.selectedId = providers[0].id;
			this.replacing.clear();
			this.fieldErrors.clear();
		}
		// Text typed for one provider never moves to another one.
		const sameProvider = this.selectedId !== undefined && this.selectedId === this.renderedId;
		const kept = this.capture(sameProvider);
		this.clearSensitiveInputs();
		const disposables = new DisposableStore();
		this.renderDisposables.value = disposables;
		this.rows.clear();
		this.controls.clear();
		this.errors.clear();
		this.focusables.clear();
		clearNode(this.list);
		clearNode(this.editor);
		this.renderedId = this.selectedId;

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
			this.renderList(providers, disposables);
			const selected = providers.find(provider => provider.id === this.selectedId);
			if (selected) {
				this.renderEditor(selected, disposables);
			}
		}
		this.restore(kept);
		if (!sameProvider) {
			this.editor.scrollTop = 0;
		}
	}

	/** While the catalog loads or after it failed, the message takes the place of the list and the provider, with a way to ask again. */
	private renderNoProviders(state: BaseHalfVideoCatalogState, disposables: DisposableStore): void {
		const empty = append(this.editor!, $('.basehalf-video-providers-empty'));
		append(empty, $('p')).textContent = state.kind === 'loading'
			? localize('basehalf.video.providers.loading', "Loading the video providers…")
			: state.kind === 'failed'
				? localize('basehalf.video.providers.failed', "BaseHalf could not load the video providers: {0}", state.message)
				: localize('basehalf.video.providers.none', "AI Video offers no video providers.");
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
			const selected = provider.id === this.selectedId;
			row.tabIndex = selected ? 0 : -1;
			if (selected) {
				row.setAttribute('aria-current', 'page');
			}
			const copy = append(row, $('.basehalf-video-provider-row-copy'));
			append(copy, $('.basehalf-video-provider-row-name')).textContent = provider.label;
			const detail = append(copy, $('.basehalf-video-provider-row-detail'));
			detail.textContent = provider.regions.length > 1 ? status.region.label : modelCount(provider);
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
				if (this.selectedId !== provider.id) {
					this.select(provider.id);
					this.setStatus('');
					this.render();
					this.rows.get(provider.id)?.focus();
				}
			}));
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
			}));
		}
	}

	private renderEditor(provider: IBaseHalfVideoCatalogProvider, disposables: DisposableStore): void {
		const editor = this.editor!;
		const status = this.providerSettings.getStatus(provider);
		editor.dataset.provider = provider.id;
		const heading = append(editor, $('.basehalf-video-provider-editor-heading'));
		append(heading, $('h2')).textContent = provider.label;
		const summary = append(heading, $('p'));
		summary.textContent = status.setUp
			? localize('basehalf.video.providers.summarySetUp', "Set up · {0}", modelCount(provider))
			: localize('basehalf.video.providers.summaryNotSetUp', "Not set up · {0}", modelCount(provider));
		// The models by name, so that the user can tell which provider to get credentials from.
		const models = append(heading, $('p.basehalf-video-provider-models'));
		for (const [index, model] of baseHalfVideoListedModels(provider, undefined).entries()) {
			if (index > 0) {
				models.append(' · ');
			}
			const name = append(models, $('span.basehalf-video-provider-model'));
			name.textContent = model.label;
			name.dataset.model = model.id;
			if (!baseHalfVideoRegionOffersModel(model, status.region.id)) {
				// Dimmed: the region does not offer it.
				const notOffered = localize('basehalf.video.providers.modelNotOffered', "{0} is not offered in {1}.", model.label, status.region.label);
				name.classList.add('unavailable');
				name.setAttribute('aria-description', notOffered);
				disposables.add(this.hoverService.setupDelayedHover(name, { content: notOffered }));
			}
		}

		if (provider.regions.length > 1) {
			this.renderRegions(editor, provider, status, disposables);
		}
		for (const credential of provider.credentials) {
			this.renderCredential(editor, provider, credential, status, disposables);
		}
		this.renderEndpoint(editor, provider, status, disposables);
		if (status.region.console) {
			const consoleUrl = status.region.console;
			const link = append(editor, $('a.basehalf-video-provider-console')) as HTMLAnchorElement;
			this.focusable(link, 'console');
			link.href = consoleUrl;
			link.textContent = localize('basehalf.video.providers.console', "Get credentials in the console of {0}", status.region.label);
			disposables.add(addDisposableListener(link, EventType.CLICK, event => {
				event.preventDefault();
				void this.openerService.open(URI.parse(consoleUrl), { openExternal: true });
			}));
		}
	}

	private renderRegions(editor: HTMLElement, provider: IBaseHalfVideoCatalogProvider, status: IBaseHalfVideoProviderStatus, disposables: DisposableStore): void {
		const field = append(editor, $('.basehalf-video-provider-field'));
		const label = append(field, $('.basehalf-video-provider-field-label'));
		label.id = this.id('region-label');
		label.textContent = localize('basehalf.video.providers.region', "Region");
		const hint = append(field, $('p.basehalf-video-provider-field-hint'));
		hint.textContent = localize('basehalf.video.providers.regionHint', "The region sets where requests go, the currency of the estimates, and which models are offered.");
		const group = append(field, $('.basehalf-video-provider-regions'));
		group.setAttribute('role', 'radiogroup');
		group.setAttribute('aria-labelledby', label.id);
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
			append(button, $('span.basehalf-video-provider-region-currency')).textContent = region.currency;
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
			this.render();
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
			detail: localize('basehalf.video.providers.removeDetail', "It is deleted from this computer. Video nodes cannot use {0} until you set it again.", provider.label),
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
				// provider, a credential field keeps unsaved text, and the endpoint keeps text
				// that its error is about.
				if (input.value && (input === active || control !== 'endpoint' || this.fieldErrors.has(control))) {
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

function modelCount(provider: IBaseHalfVideoCatalogProvider): string {
	const count = baseHalfVideoListedModels(provider, undefined).length;
	return count === 1
		? localize('basehalf.video.providers.modelOne', "1 model")
		: localize('basehalf.video.providers.models', "{0} models", count);
}

/** What the changes of the providers are known by on the page: the same change of the same provider is not made twice. */
function saveKey(provider: IBaseHalfVideoCatalogProvider, key: string): string {
	return `${provider.id}:${key}`;
}

/** The outcome of a change of a provider that is not the one shown, with the provider's name. */
function outcomeFor(provider: IBaseHalfVideoCatalogProvider, message: string): string {
	return localize('basehalf.video.providers.outcomeFor', "{0}: {1}", provider.label, message);
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
