/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfVideoProviders.css';
import { $, addDisposableListener, append, clearNode, EventType, getActiveElement } from '../../../base/browser/dom.js';
import { getErrorMessage } from '../../../base/common/errors.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { IDialogService } from '../../../platform/dialogs/common/dialogs.js';
import { IHoverService } from '../../../platform/hover/browser/hover.js';
import { IOpenerService } from '../../../platform/opener/common/opener.js';
import { ISettingsCustomSection, ISettingsCustomSectionLayout } from '../../contrib/preferences/browser/settingsCustomSections.js';
import { baseHalfVideoListedModels, IBaseHalfVideoCatalogCredential, IBaseHalfVideoCatalogProvider } from '../common/basehalfVideoCatalog.js';
import { IBaseHalfVideoCatalogService, IBaseHalfVideoProviderSettingsService, IBaseHalfVideoProviderStatus } from '../common/basehalfVideoGeneration.js';
import { BASEHALF_VIDEO_ENDPOINT_MAX_LENGTH, BaseHalfVideoProviderSettingsError } from '../common/basehalfVideoProviderSettings.js';

type BaseHalfVideoProvidersStatusKind = 'success' | 'warning';

/** A control whose text and focus survive a render: the endpoint, or the field of one credential. */
type BaseHalfVideoProviderControl = 'endpoint' | `credential:${string}`;

/**
 * The Video Providers page of Settings (D59, video providers, "Credentials,
 * regions, and endpoints"), drawn from the model catalog: the providers in
 * the catalog's order, and for the one selected its region, one masked field
 * per credential it declares, its endpoint, and a link to the region's
 * console. Saving checks nothing with the provider; the first generation tells
 * whether the credentials work. A stored value is never read here and never
 * shown: the page knows only whether one is set.
 */
export class BaseHalfVideoProvidersPage extends Disposable implements ISettingsCustomSection {
	private root: HTMLElement | undefined;
	private status: HTMLElement | undefined;
	private list: HTMLElement | undefined;
	private editor: HTMLElement | undefined;
	private selectedId: string | undefined;
	/** The provider the editor currently shows; typed text is kept only while it stays the same. */
	private renderedId: string | undefined;
	/** The credentials whose value is being replaced. */
	private readonly replacing = new Set<string>();
	private busy = false;
	private readonly fieldErrors = new Map<BaseHalfVideoProviderControl, string>();
	private readonly renderDisposables = this._register(new MutableDisposable<DisposableStore>());
	/** The elements of the current render, reached directly instead of by selectors. */
	private readonly rows = new Map<string, HTMLButtonElement>();
	private readonly controls = new Map<BaseHalfVideoProviderControl, HTMLInputElement>();
	private readonly errors = new Map<BaseHalfVideoProviderControl, HTMLElement>();
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
		const rerender = () => {
			if (!this.busy) {
				this.render();
			}
		};
		this._register(this.providerSettings.onDidChange(rerender));
		this._register(this.catalogService.onDidChange(rerender));
	}

	create(parent: HTMLElement): void {
		this.root = append(parent, $('.basehalf-video-providers'));
		this.root.setAttribute('role', 'main');
		this.root.setAttribute('aria-labelledby', 'basehalf-video-providers-title');
		this.root.tabIndex = -1;

		const header = append(this.root, $('.basehalf-video-providers-header'));
		const heading = append(header, $('.basehalf-video-providers-heading'));
		const title = append(heading, $('h1#basehalf-video-providers-title'));
		title.textContent = localize('basehalf.video.providers.title', "Video Providers");
		const subtitle = append(heading, $('p'));
		subtitle.textContent = localize('basehalf.video.providers.subtitle', "Video nodes run on these providers with your own credentials, and you pay each provider directly. Credentials are encrypted and stay on this computer. Nothing is checked with a provider until its first generation.");

		this.status = append(this.root, $('p.basehalf-video-providers-status'));
		this.status.setAttribute('role', 'status');
		this.status.setAttribute('aria-live', 'polite');

		const content = append(this.root, $('.basehalf-video-providers-content'));
		this.list = append(content, $('.basehalf-video-providers-list'));
		this.list.setAttribute('role', 'navigation');
		this.list.setAttribute('aria-label', localize('basehalf.video.providers.listLabel', "Providers"));
		this.editor = append(content, $('.basehalf-video-provider-editor'));
		this.editor.setAttribute('role', 'region');
		this.editor.setAttribute('aria-label', localize('basehalf.video.providers.editorLabel', "Provider settings"));
		// A catalog that could not be loaded is asked for again when the page opens.
		this.catalogService.load();
		this.render();
	}

	setInput(input: string | undefined): void {
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
		(selected ?? this.root)?.focus();
	}

	override dispose(): void {
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

	private render(): void {
		if (!this.root || !this.list || !this.editor) {
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
		const kept = sameProvider ? this.captureControls() : { values: new Map<BaseHalfVideoProviderControl, string>() };
		this.clearSensitiveInputs();
		const disposables = new DisposableStore();
		this.renderDisposables.value = disposables;
		this.rows.clear();
		this.controls.clear();
		this.errors.clear();
		clearNode(this.list);
		clearNode(this.editor);
		this.renderedId = this.selectedId;

		const state = this.catalogService.state;
		this.root.dataset.catalog = state.kind;
		if (state.kind !== 'ready' || !providers.length) {
			this.renderNoProviders(state.kind === 'loading'
				? localize('basehalf.video.providers.loading', "Loading the video providers…")
				: state.kind === 'failed'
					? localize('basehalf.video.providers.failed', "BaseHalf could not load the video providers: {0}", state.message)
					: localize('basehalf.video.providers.none', "AI Video offers no video providers."));
			return;
		}
		this.renderList(providers, disposables);
		const selected = providers.find(provider => provider.id === this.selectedId);
		if (selected) {
			this.renderEditor(selected, disposables);
		}
		this.restoreControls(kept);
		if (!sameProvider) {
			this.editor.scrollTop = 0;
		}
	}

	private renderNoProviders(message: string): void {
		const empty = append(this.list!, $('.basehalf-video-providers-empty'));
		empty.textContent = message;
	}

	private renderList(providers: readonly IBaseHalfVideoCatalogProvider[], disposables: DisposableStore): void {
		const list = this.list!;
		const rows: HTMLButtonElement[] = [];
		for (const provider of providers) {
			const status = this.providerSettings.getStatus(provider);
			const row = append(list, $('button.basehalf-video-provider-row')) as HTMLButtonElement;
			rows.push(row);
			this.rows.set(provider.id, row);
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
		const label = append(field, $('.basehalf-video-provider-field-label#basehalf-video-provider-region-label'));
		label.textContent = localize('basehalf.video.providers.region', "Region");
		const hint = append(field, $('p.basehalf-video-provider-field-hint'));
		hint.textContent = localize('basehalf.video.providers.regionHint', "The region sets where requests go, the currency of the estimates, and which models are offered.");
		const group = append(field, $('.basehalf-video-provider-regions'));
		group.setAttribute('role', 'radiogroup');
		group.setAttribute('aria-labelledby', 'basehalf-video-provider-region-label');
		const buttons: HTMLButtonElement[] = [];
		for (const region of provider.regions) {
			const button = append(group, $('button.basehalf-video-provider-region')) as HTMLButtonElement;
			buttons.push(button);
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
					void this.save(undefined, () => this.providerSettings.setRegion(provider, region.id), localize('basehalf.video.providers.regionSaved', "Region saved."));
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
		const labelId = `basehalf-video-provider-credential-${cssId(credential.id)}-label`;
		const label = append(field, $('.basehalf-video-provider-field-label'));
		label.id = labelId;
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
			input.type = 'password';
			input.autocomplete = 'new-password';
			input.spellcheck = false;
			input.autocapitalize = 'off';
			input.placeholder = credential.placeholder ?? localize('basehalf.video.providers.credentialPlaceholder', "Paste the {0}", credential.label);
			input.setAttribute('aria-labelledby', labelId);
			this.controls.set(control, input);
			this.sensitiveInputs.add(input);
			const saveButton = this.button(row, isSet
				? localize('basehalf.video.providers.replaceSave', "Save New Value")
				: localize('basehalf.video.providers.set', "Set"), 'codicon-check', true);
			saveButton.dataset.action = 'set';
			const submit = () => {
				const value = input.value;
				input.value = '';
				void this.save(control, async () => {
					await this.providerSettings.setCredential(provider, credential.id, value);
					this.replacing.delete(credential.id);
				}, localize('basehalf.video.providers.credentialSaved', "{0} saved.", credential.label), () => {
					// Not saved: give the pasted text back so the user can correct it.
					const current = this.controls.get(control);
					if (current && !current.value) {
						current.value = value;
					}
				});
			};
			disposables.add(addDisposableListener(saveButton, EventType.CLICK, submit));
			disposables.add(addDisposableListener(input, EventType.KEY_DOWN, (event: KeyboardEvent) => {
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
				const cancel = this.button(row, localize('basehalf.video.providers.cancel', "Cancel"), 'codicon-close');
				cancel.dataset.action = 'cancel';
				disposables.add(addDisposableListener(cancel, EventType.CLICK, () => this.cancelReplacing(credential.id)));
			}
		} else {
			const replace = this.button(row, localize('basehalf.video.providers.replace', "Replace"), 'codicon-edit');
			replace.dataset.action = 'replace';
			replace.setAttribute('aria-label', localize('basehalf.video.providers.replaceLabel', "Replace {0}", credential.label));
			disposables.add(addDisposableListener(replace, EventType.CLICK, () => {
				this.replacing.add(credential.id);
				this.render();
				this.controls.get(control)?.focus();
			}));
			const remove = this.button(row, localize('basehalf.video.providers.remove', "Remove"), 'codicon-trash');
			remove.dataset.action = 'remove';
			remove.setAttribute('aria-label', localize('basehalf.video.providers.removeLabel', "Remove {0}", credential.label));
			disposables.add(addDisposableListener(remove, EventType.CLICK, () => void this.removeCredential(provider, credential)));
		}
		const error = this.errorElement(field, control);
		this.controls.get(control)?.setAttribute('aria-describedby', error.id);
	}

	private renderEndpoint(editor: HTMLElement, provider: IBaseHalfVideoCatalogProvider, status: IBaseHalfVideoProviderStatus, disposables: DisposableStore): void {
		const field = append(editor, $('.basehalf-video-provider-field.endpoint'));
		const inputId = 'basehalf-video-provider-endpoint';
		const label = append(field, $('label.basehalf-video-provider-field-label')) as HTMLLabelElement;
		label.htmlFor = inputId;
		label.textContent = localize('basehalf.video.providers.endpoint', "Endpoint");
		const input = append(field, $('input')) as HTMLInputElement;
		input.id = inputId;
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
		hint.id = `${inputId}-hint`;
		hint.textContent = localize('basehalf.video.providers.endpointHint', "Requests go to the region's address. For a relay or a private gateway that mirrors the API of {0}, enter its address; clear the field to go back to the region's.", provider.label);
		input.setAttribute('aria-describedby', `${hint.id} ${this.errorElement(field, 'endpoint').id}`);
		disposables.add(addDisposableListener(input, EventType.CHANGE, () => {
			void this.save('endpoint', () => this.providerSettings.setEndpoint(provider, input.value));
		}));
		disposables.add(addDisposableListener(input, EventType.KEY_DOWN, (event: KeyboardEvent) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				input.blur();
			}
		}));
	}

	private errorElement(field: HTMLElement, control: BaseHalfVideoProviderControl): HTMLElement {
		const error = append(field, $('.basehalf-video-provider-field-error'));
		error.id = `basehalf-video-provider-${cssId(control)}-error`;
		error.setAttribute('role', 'alert');
		this.errors.set(control, error);
		const message = this.fieldErrors.get(control);
		error.textContent = message ?? '';
		error.hidden = message === undefined;
		if (message !== undefined) {
			this.controls.get(control)?.setAttribute('aria-invalid', 'true');
		}
		return error;
	}

	/** Runs one change and shows its outcome. Nothing here talks to the provider. */
	private async save(control: BaseHalfVideoProviderControl | undefined, operation: () => Promise<void>, success?: string, onFailure?: () => void): Promise<void> {
		if (this.busy) {
			return;
		}
		this.busy = true;
		if (control) {
			this.fieldErrors.delete(control);
		}
		try {
			await operation();
			this.busy = false;
			this.setStatus(success ?? localize('basehalf.video.providers.saved', "Saved."), 'success');
			this.render();
		} catch (error) {
			this.busy = false;
			const message = error instanceof BaseHalfVideoProviderSettingsError
				? error.message
				: localize('basehalf.video.providers.saveFailed', "BaseHalf could not save this change: {0}", getErrorMessage(error));
			// The endpoint field keeps what the user typed, so it can be corrected.
			const typed = control === 'endpoint' ? this.controls.get(control)?.value : undefined;
			if (control) {
				this.fieldErrors.set(control, message);
			}
			this.render();
			const current = control ? this.controls.get(control) : undefined;
			if (current && typed !== undefined) {
				current.value = typed;
			}
			onFailure?.();
			this.setStatus(control ? localize('basehalf.video.providers.notSaved', "Not saved.") : message, 'warning');
			current?.focus();
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
			await this.save(`credential:${credential.id}`, () => this.providerSettings.setCredential(provider, credential.id, undefined), localize('basehalf.video.providers.credentialRemoved', "{0} removed.", credential.label));
		}
	}

	private button(parent: HTMLElement, label: string, icon: string, primary = false): HTMLButtonElement {
		const element = append(parent, $('button.basehalf-video-providers-button')) as HTMLButtonElement;
		element.type = 'button';
		element.classList.toggle('primary', primary);
		append(element, $(`span.codicon.${icon}`)).setAttribute('aria-hidden', 'true');
		append(element, $('span')).textContent = label;
		return element;
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

	/** The text of fields being edited and the focused field, so a render keeps them. */
	private captureControls(): { readonly focused?: BaseHalfVideoProviderControl; readonly values: ReadonlyMap<BaseHalfVideoProviderControl, string> } {
		const values = new Map<BaseHalfVideoProviderControl, string>();
		let focused: BaseHalfVideoProviderControl | undefined;
		const active = getActiveElement();
		for (const [control, input] of this.controls) {
			if (input === active) {
				focused = control;
			}
			// A focused field keeps what the user is typing when another window
			// changes the provider; a credential field keeps unsaved text.
			if (input.value && (input === active || control !== 'endpoint')) {
				values.set(control, input.value);
			}
		}
		return { focused, values };
	}

	private restoreControls(kept: { readonly focused?: BaseHalfVideoProviderControl; readonly values: ReadonlyMap<BaseHalfVideoProviderControl, string> }): void {
		for (const [control, value] of kept.values) {
			const input = this.controls.get(control);
			if (input) {
				input.value = value;
			}
		}
		if (kept.focused) {
			this.controls.get(kept.focused)?.focus();
		}
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

/** An id that can name an element: only letters, digits, and hyphens. */
function cssId(value: string): string {
	return value.replace(/[^A-Za-z0-9-]/g, '-');
}
