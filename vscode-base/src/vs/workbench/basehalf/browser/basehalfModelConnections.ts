/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfModelConnections.css';
import { addDisposableListener, append, $, clearNode, Dimension, EventType } from '../../../base/browser/dom.js';
import { getErrorMessage } from '../../../base/common/errors.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../base/common/lifecycle.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';
import { IDialogService } from '../../../platform/dialogs/common/dialogs.js';
import { IOpenerService } from '../../../platform/opener/common/opener.js';
import { ISettingsCustomSection } from '../../contrib/preferences/browser/settingsCustomSections.js';
import {
	IBaseHalfModelProviderCatalogService,
	IBaseHalfModelProviderConnectionField,
	IBaseHalfRegisteredModelProviderConnectionSpec
} from '../common/basehalfModelProviderCatalogs.js';
import { completeCapturedBaseHalfModelConnectionRequest, IBaseHalfModelConnectionNavigationService } from '../common/basehalfModelConnectionNavigation.js';
import { IBaseHalfModelServiceDescriptor, IBaseHalfModelServiceService } from '../common/basehalfModelServices.js';
import { IBaseHalfVideoModelCatalogService } from '../common/basehalfVideoModelCatalogs.js';
import { IBaseHalfVideoModelDescriptor } from '../common/basehalfVideoModels.js';

export const BASEHALF_MODEL_CONNECTIONS_SETTINGS_SECTION_ID = 'basehalf/models';

type ModelConnectionFocusTarget = 'provider' | 'firstField';
type ModelProviderConnectionState = 'connected' | 'attention' | 'locked';

interface IBaseHalfModelConnectionFieldControl {
	readonly field: IBaseHalfModelProviderConnectionField;
	readonly control: HTMLInputElement | HTMLSelectElement;
	readonly error: HTMLElement;
}

interface IBaseHalfModelProviderGroup {
	readonly providerId: string;
	readonly label: string;
	readonly specs: readonly IBaseHalfRegisteredModelProviderConnectionSpec[];
	readonly models: readonly IBaseHalfVideoModelDescriptor[];
}

export class BaseHalfModelConnectionsView extends Disposable implements ISettingsCustomSection {
	private root: HTMLElement | undefined;
	private list: HTMLElement | undefined;
	private detail: HTMLElement | undefined;
	private pageStatus: HTMLElement | undefined;
	private selectedProviderRow: HTMLButtonElement | undefined;
	private specs: readonly IBaseHalfRegisteredModelProviderConnectionSpec[] = [];
	private services: readonly IBaseHalfModelServiceDescriptor[] = [];
	private selectedSpecId: string | undefined;
	private announcement = '';
	private intentRequestId: string | undefined;
	private renderGeneration = 0;
	private busy = false;
	private readonly sensitiveControls = new Set<HTMLInputElement>();
	private readonly renderDisposables = this._register(new MutableDisposable<DisposableStore>());

	constructor(
		@IBaseHalfModelProviderCatalogService private readonly providerCatalogService: IBaseHalfModelProviderCatalogService,
		@IBaseHalfVideoModelCatalogService private readonly videoModelCatalogService: IBaseHalfVideoModelCatalogService,
		@IBaseHalfModelServiceService private readonly modelService: IBaseHalfModelServiceService,
		@IBaseHalfModelConnectionNavigationService private readonly connectionNavigationService: IBaseHalfModelConnectionNavigationService,
		@IDialogService private readonly dialogService: IDialogService,
		@IOpenerService private readonly openerService: IOpenerService,
		@ICommandService private readonly commandService: ICommandService
	) {
		super();
		this._register(this.providerCatalogService.onDidChange(() => {
			if (!this.busy) {
				void this.reload();
			}
		}));
		this._register(this.videoModelCatalogService.onDidChange(() => {
			if (!this.busy) {
				void this.reload();
			}
		}));
		this._register(this.modelService.onDidChange(() => {
			if (!this.busy) {
				void this.reload();
			}
		}));
		this._register(this.connectionNavigationService.onDidChangeIntent(intent => {
			if (!intent) {
				this.intentRequestId = undefined;
				return;
			}
			this.intentRequestId = intent.requestId;
			this.selectedSpecId = intent.specId;
			if (this.specs.some(spec => spec.id === intent.specId)) {
				this.render('firstField');
			}
		}));
	}

	create(parent: HTMLElement): void {
		this.root = append(parent, $('.basehalf-model-connections'));
		this.root.setAttribute('role', 'main');
		this.root.setAttribute('aria-labelledby', 'basehalf-model-connections-title');
		this.root.tabIndex = -1;

		const header = append(this.root, $('.basehalf-model-connections-header'));
		const heading = append(header, $('.basehalf-model-connections-heading'));
		const title = append(heading, $('h1#basehalf-model-connections-title'));
		title.textContent = 'Models & Providers';
		const subtitle = append(heading, $('p'));
		subtitle.textContent = 'Connect official video providers with your own API key. Keys are encrypted and stay on this device.';
		this.pageStatus = append(heading, $('p'));
		this.pageStatus.className = 'basehalf-model-connections-page-status';
		this.pageStatus.setAttribute('role', 'status');
		this.pageStatus.setAttribute('aria-live', 'polite');

		const content = append(this.root, $('.basehalf-model-connections-content'));
		this.list = append(content, $('.basehalf-model-provider-list'));
		this.list.setAttribute('aria-label', 'Official model providers');
		this.list.setAttribute('role', 'navigation');
		this.detail = append(content, $('.basehalf-model-connection-detail'));
		this.detail.setAttribute('role', 'region');
		this.detail.setAttribute('aria-label', 'Provider connection details');

		const loadingList = append(this.list, $('.basehalf-model-connections-empty'));
		loadingList.textContent = 'Loading providers…';
		const loadingDetail = append(this.detail, $('.basehalf-model-connections-empty'));
		loadingDetail.textContent = 'Loading connection settings…';
	}

	setInput(specId: string | undefined): void {
		const intent = this.connectionNavigationService.intent;
		this.intentRequestId = intent?.requestId;
		const requestedSpecId = specId?.trim().toLowerCase() || intent?.specId;
		if (requestedSpecId) {
			this.selectedSpecId = requestedSpecId;
		}
		void this.reload(requestedSpecId ? 'firstField' : undefined);
	}

	setVisible(visible: boolean): void {
		if (this.root) {
			this.root.hidden = !visible;
		}
		if (!visible) {
			this.clearSensitiveControls();
			this.cancelPendingIntent();
		}
	}

	override dispose(): void {
		this.clearSensitiveControls();
		this.cancelPendingIntent();
		super.dispose();
	}

	layout(dimension: Dimension): void {
		if (this.root) {
			this.root.style.width = `${dimension.width}px`;
			this.root.style.height = `${dimension.height}px`;
		}
	}

	focus(): void {
		(this.selectedProviderRow ?? this.root)?.focus();
	}

	private async reload(focusTarget?: ModelConnectionFocusTarget): Promise<void> {
		const generation = ++this.renderGeneration;
		this.root?.setAttribute('aria-busy', 'true');
		try {
			const specs = this.providerCatalogService.getConnectionSpecs();
			const services = await this.modelService.getServices();
			if (generation !== this.renderGeneration) {
				return;
			}
			this.specs = [...specs].sort((a, b) => a.providerLabel.localeCompare(b.providerLabel) || a.label.localeCompare(b.label));
			this.services = services;
			const intendedSpecId = this.connectionNavigationService.intent?.specId;
			if (intendedSpecId && this.specs.some(spec => spec.id === intendedSpecId)) {
				this.selectedSpecId = intendedSpecId;
			} else if (!this.selectedSpecId || !this.specs.some(spec => spec.id === this.selectedSpecId)) {
				const groups = this.providerGroups();
				const firstConfigured = groups
					.flatMap(group => group.specs)
					.find(spec => this.serviceForSpec(spec.id)?.configured === true);
				this.selectedSpecId = firstConfigured?.id ?? groups[0]?.specs[0]?.id ?? intendedSpecId;
			}
			this.root?.setAttribute('aria-busy', 'false');
			this.render(focusTarget);
		} catch (error) {
			if (generation !== this.renderGeneration) {
				return;
			}
			this.root?.setAttribute('aria-busy', 'false');
			this.renderError(`Unable to load model connections: ${getErrorMessage(error)}`);
		}
	}

	private render(focusTarget?: ModelConnectionFocusTarget): void {
		if (!this.list || !this.detail) {
			return;
		}
		this.clearSensitiveControls();
		const disposables = new DisposableStore();
		this.renderDisposables.value = disposables;
		clearNode(this.list);
		clearNode(this.detail);
		this.selectedProviderRow = undefined;
		if (this.pageStatus) {
			this.pageStatus.textContent = this.announcement;
		}

		if (!this.specs.length) {
			const empty = append(this.list, $('.basehalf-model-connections-empty'));
			empty.textContent = 'No official model providers are available. Install or enable a reviewed plugin that contributes model connections.';
			const detailEmpty = append(this.detail, $('.basehalf-model-connections-empty'));
			detailEmpty.textContent = 'Provider settings will appear here.';
			return;
		}

		const groups = this.providerGroups();
		let selectedRow: HTMLButtonElement | undefined;
		const providerRows: HTMLButtonElement[] = [];
		for (const group of groups) {
			const selectedSpec = group.specs.find(spec => spec.id === this.selectedSpecId);
			const configuredCount = group.specs.filter(spec => this.serviceForSpec(spec.id)?.configured === true).length;
			const storedCount = group.specs.filter(spec => this.serviceForSpec(spec.id) !== undefined).length;
			const connectionState: ModelProviderConnectionState = configuredCount > 0
				? 'connected'
				: storedCount > 0 ? 'attention' : 'locked';
			const row = append(this.list, $('button.basehalf-model-provider-row')) as HTMLButtonElement;
			providerRows.push(row);
			row.type = 'button';
			row.dataset.providerId = group.providerId;
			row.dataset.specId = selectedSpec?.id ?? group.specs[0].id;
			row.dataset.connectionState = connectionState;
			const selected = selectedSpec !== undefined;
			row.tabIndex = selected ? 0 : -1;
			if (selected) {
				row.setAttribute('aria-current', 'page');
				selectedRow = row;
				this.selectedProviderRow = row;
			}
			const icon = append(row, $('span.basehalf-model-provider-icon.codicon.codicon-cloud'));
			icon.setAttribute('aria-hidden', 'true');
			const copy = append(row, $('.basehalf-model-provider-copy'));
			const title = append(copy, $('.basehalf-model-provider-title'));
			title.textContent = group.label;
			const subtitle = append(copy, $('.basehalf-model-provider-subtitle'));
			subtitle.textContent = `${group.models.length} video ${group.models.length === 1 ? 'model' : 'models'}`;
			const status = append(row, $('.basehalf-model-provider-status'));
			status.classList.add(connectionState);
			const statusLabel = connectionState === 'connected'
				? group.specs.length > 1 ? `${configuredCount} regions connected` : 'Connected'
				: connectionState === 'attention' ? 'Needs attention' : 'Locked';
			status.setAttribute('aria-label', statusLabel);
			status.title = statusLabel;
			const statusIcon = append(status, $(`span.codicon.${connectionState === 'connected' ? 'codicon-check' : connectionState === 'attention' ? 'codicon-warning' : 'codicon-lock'}`));
			statusIcon.setAttribute('aria-hidden', 'true');
			const selectProvider = () => {
				this.selectedSpecId = selectedSpec?.id
					?? group.specs.find(spec => this.serviceForSpec(spec.id)?.configured)?.id
					?? group.specs[0].id;
				this.announcement = '';
				this.render('provider');
			};
			disposables.add(addDisposableListener(row, EventType.CLICK, selectProvider));
			disposables.add(addDisposableListener(row, EventType.KEY_DOWN, event => {
				const currentIndex = providerRows.indexOf(row);
				const nextIndex = event.key === 'ArrowDown' || event.key === 'ArrowRight'
					? (currentIndex + 1) % groups.length
					: event.key === 'ArrowUp' || event.key === 'ArrowLeft'
						? (currentIndex - 1 + groups.length) % groups.length
						: event.key === 'Home' ? 0 : event.key === 'End' ? groups.length - 1 : undefined;
				if (nextIndex === undefined || nextIndex === currentIndex) {
					return;
				}
				event.preventDefault();
				providerRows[nextIndex]?.click();
			}));
		}

		const selectedSpec = this.specs.find(spec => spec.id === this.selectedSpecId) ?? this.specs[0];
		const selectedGroup = groups.find(group => group.specs.some(spec => spec.id === selectedSpec.id)) ?? groups[0];
		const firstField = this.renderDetail(selectedGroup, selectedSpec, this.serviceForSpec(selectedSpec.id), disposables);
		if (focusTarget) {
			queueMicrotask(() => {
				if (focusTarget === 'firstField') {
					(firstField ?? selectedRow)?.focus();
				} else {
					selectedRow?.focus();
				}
			});
		}
	}

	private renderDetail(
		group: IBaseHalfModelProviderGroup,
		spec: IBaseHalfRegisteredModelProviderConnectionSpec,
		descriptor: IBaseHalfModelServiceDescriptor | undefined,
		disposables: DisposableStore
	): HTMLInputElement | HTMLSelectElement | undefined {
		const detail = this.detail!;
		const configured = descriptor?.configured === true;
		const hasStoredConnection = descriptor !== undefined;
		const needsAttention = descriptor !== undefined && !configured;
		const unlocked = this.modelsForSpec(spec);
		const hero = append(detail, $('.basehalf-model-connection-detail-hero'));
		const copy = append(hero, $('.basehalf-model-connection-detail-copy'));
		const title = append(copy, $('h2'));
		title.textContent = group.label;
		const provider = append(copy, $('p'));
		provider.textContent = group.specs.length > 1
			? `${unlocked.length} video ${unlocked.length === 1 ? 'model' : 'models'} in ${connectionScopeLabel(spec)}`
			: `${unlocked.length} video ${unlocked.length === 1 ? 'model' : 'models'}`;

		if (group.specs.length > 1) {
			const scope = append(detail, $('.basehalf-model-connection-scope'));
			const scopeLabel = append(scope, $('span.basehalf-model-connection-scope-label'));
			scopeLabel.textContent = 'API key service region';
			const scopeOptions = append(scope, $('.basehalf-model-connection-scope-options'));
			scopeOptions.setAttribute('role', 'group');
			scopeOptions.setAttribute('aria-label', 'API key service region');
			for (const candidate of group.specs) {
				const button = append(scopeOptions, $('button.basehalf-model-connection-scope-option')) as HTMLButtonElement;
				button.type = 'button';
				button.dataset.specId = candidate.id;
				button.setAttribute('aria-pressed', String(candidate.id === spec.id));
				button.textContent = connectionScopeLabel(candidate);
				disposables.add(addDisposableListener(button, EventType.CLICK, () => {
					this.selectedSpecId = candidate.id;
					this.announcement = '';
					this.render('firstField');
				}));
			}
			const scopeHelp = append(scope, $('p'));
			scopeHelp.textContent = 'Choose where this API key was created. BaseHalf does not route a key across provider regions.';
		}

		const summary = append(detail, $('.basehalf-model-connection-summary'));
		summary.classList.toggle('configured', configured);
		summary.classList.toggle('attention', needsAttention);
		const summaryIcon = append(summary, $(`span.codicon.${configured ? 'codicon-pass-filled' : needsAttention ? 'codicon-warning' : 'codicon-lock'}`));
		summaryIcon.setAttribute('aria-hidden', 'true');
		const summaryCopy = append(summary, $('div'));
		const summaryTitle = append(summaryCopy, $('strong'));
		summaryTitle.textContent = configured ? 'Connected and verified' : needsAttention ? 'Connection needs attention' : 'Connect your account';
		const summaryBody = append(summaryCopy, $('p'));
		summaryBody.textContent = configured
			? 'The verified key is encrypted in your system credential store. Enter a new key only when you want to replace it.'
			: needsAttention
				? 'The saved connection cannot be used. Enter a new key to repair it, or remove the connection.'
				: 'BaseHalf verifies this key with the official provider before saving it. The check does not create a video.';

		const modelSection = append(detail, $('details.basehalf-model-connection-models')) as HTMLDetailsElement;
		const modelHeading = append(modelSection, $('summary'));
		modelHeading.textContent = `${unlocked.length} ${unlocked.length === 1 ? 'model' : 'models'} available with this connection`;
		const modelList = append(modelSection, $('ul'));
		for (const model of unlocked) {
			const item = append(modelList, $('li'));
			item.textContent = model.label;
		}

		const form = append(detail, $('form.basehalf-model-connection-form')) as HTMLFormElement;
		form.dataset.providerId = spec.id;
		form.noValidate = true;
		const controls: IBaseHalfModelConnectionFieldControl[] = [];
		for (const [index, field] of spec.fields.entries()) {
			controls.push(this.renderField(form, spec, field, descriptor, index, disposables));
		}

		const formError = append(form, $('.basehalf-model-connection-form-error'));
		formError.setAttribute('role', 'alert');
		formError.tabIndex = -1;
		formError.hidden = true;

		const help = append(form, $('a.basehalf-model-connection-help')) as HTMLAnchorElement;
		help.href = spec.helpUrl;
		help.target = '_blank';
		help.rel = 'noopener noreferrer';
		const helpIcon = append(help, $('span.codicon.codicon-link-external'));
		helpIcon.setAttribute('aria-hidden', 'true');
		const helpText = append(help, $('span'));
		helpText.textContent = `Open ${spec.providerLabel} API key guide`;
		disposables.add(addDisposableListener(help, EventType.CLICK, event => {
			event.preventDefault();
			void this.openerService.open(spec.helpUrl, { openExternal: true, fromUserGesture: true });
		}));

		const actions = append(form, $('.basehalf-model-connection-actions'));
		const save = connectionButton(actions, hasStoredConnection ? 'Replace Key' : 'Verify & Connect', 'codicon-plug', true);
		save.type = 'submit';
		save.dataset.action = hasStoredConnection ? 'replace' : 'verify';
		let test: HTMLButtonElement | undefined;
		let remove: HTMLButtonElement | undefined;
		if (descriptor) {
			test = connectionButton(actions, 'Test connection', 'codicon-refresh');
			test.dataset.action = 'test';
			disposables.add(addDisposableListener(test, EventType.CLICK, () => void this.testConnection(spec, formError, controls, save, test!, remove)));
			remove = connectionButton(actions, 'Remove', 'codicon-trash');
			remove.classList.add('danger');
			remove.dataset.action = 'remove';
			disposables.add(addDisposableListener(remove, EventType.CLICK, () => void this.removeConnection(spec, descriptor, formError, controls, save, test, remove!)));
		}
		disposables.add(addDisposableListener(form, EventType.SUBMIT, event => {
			event.preventDefault();
			void this.saveConnection(spec, hasStoredConnection, controls, formError, save, test, remove);
		}));

		return controls[0]?.control;
	}

	private renderField(
		form: HTMLFormElement,
		spec: IBaseHalfRegisteredModelProviderConnectionSpec,
		field: IBaseHalfModelProviderConnectionField,
		descriptor: IBaseHalfModelServiceDescriptor | undefined,
		index: number,
		disposables: DisposableStore
	): IBaseHalfModelConnectionFieldControl {
		const fieldRoot = append(form, $('.basehalf-model-connection-field'));
		const idToken = `${sanitizeDomId(spec.id)}-${sanitizeDomId(field.id)}-${index}`;
		const controlId = `basehalf-model-connection-${idToken}`;
		const descriptionId = `basehalf-model-connection-description-${idToken}`;
		const errorId = `basehalf-model-connection-error-${idToken}`;
		const label = append(fieldRoot, $('.basehalf-model-connection-field-label')) as HTMLLabelElement;
		label.htmlFor = controlId;
		label.append(document.createTextNode(field.label));
		if (field.required) {
			const required = append(label, $('span.basehalf-model-connection-required'));
			required.textContent = '*';
			required.setAttribute('aria-hidden', 'true');
		}

		let description: HTMLElement | undefined;
		if (field.description) {
			description = append(fieldRoot, $('p.basehalf-model-connection-field-description'));
			description.id = descriptionId;
			description.textContent = field.description;
		}

		let control: HTMLInputElement | HTMLSelectElement;
		if (field.type === 'select') {
			const select = append(fieldRoot, $('select')) as HTMLSelectElement;
			if (!field.default && !descriptor?.publicValues[field.id]) {
				const placeholder = append(select, $('option')) as HTMLOptionElement;
				placeholder.value = '';
				placeholder.textContent = 'Select an option';
			}
			for (const option of field.options) {
				const element = append(select, $('option')) as HTMLOptionElement;
				element.value = option.value;
				element.textContent = option.label;
			}
			select.value = descriptor?.publicValues[field.id] ?? field.default ?? '';
			control = select;
		} else {
			const input = append(fieldRoot, $('input')) as HTMLInputElement;
			input.type = field.type === 'secret' ? 'password' : field.type === 'url' ? 'url' : 'text';
			input.autocomplete = field.type === 'secret' ? 'new-password' : 'off';
			input.autocapitalize = 'off';
			input.spellcheck = false;
			if (field.placeholder) {
				input.placeholder = field.placeholder;
			}
			if (field.type === 'secret') {
				input.value = '';
				this.sensitiveControls.add(input);
			} else {
				input.value = descriptor?.publicValues[field.id] ?? field.default ?? '';
			}
			control = input;
		}
		control.id = controlId;
		control.required = field.required;
		control.setAttribute('aria-describedby', [description?.id, errorId].filter(Boolean).join(' '));
		const error = append(fieldRoot, $('.basehalf-model-connection-field-error'));
		error.id = errorId;
		error.hidden = true;
		disposables.add(addDisposableListener(control, EventType.INPUT, () => clearFieldError(control, error)));
		disposables.add(addDisposableListener(control, EventType.CHANGE, () => clearFieldError(control, error)));
		return { field, control, error };
	}

	private async saveConnection(
		spec: IBaseHalfRegisteredModelProviderConnectionSpec,
		configured: boolean,
		controls: readonly IBaseHalfModelConnectionFieldControl[],
		formError: HTMLElement,
		save: HTMLButtonElement,
		test: HTMLButtonElement | undefined,
		remove: HTMLButtonElement | undefined
	): Promise<void> {
		if (this.busy) {
			return;
		}
		formError.hidden = true;
		const values: Record<string, string> = {};
		let firstInvalid: HTMLInputElement | HTMLSelectElement | undefined;
		for (const item of controls) {
			clearFieldError(item.control, item.error);
			const value = item.control.value.trim();
			let error: string | undefined;
			if (!value && item.field.required) {
				error = item.field.type === 'secret' && configured
					? `Enter a new ${item.field.label.toLowerCase()} to replace the saved key.`
					: `${item.field.label} is required.`;
			} else if (value && item.field.type === 'url' && !isHttpsUrl(value)) {
				error = 'Enter a complete HTTPS URL without credentials, a query, or a fragment.';
			}
			if (error) {
				showFieldError(item.control, item.error, error);
				firstInvalid ??= item.control;
			} else if (value) {
				values[item.field.id] = value;
			}
		}
		if (firstInvalid) {
			firstInvalid.focus();
			return;
		}

		const intentRequestId = this.intentRequestId;
		this.setBusy(controls, save, test, remove, true);
		setConnectionButtonLabel(save, 'Verifying…');
		try {
			const descriptor = await this.modelService.saveConnection(spec.id, values);
			this.clearSensitiveControls();
			this.announcement = `${spec.providerLabel} connected.`;
			this.busy = false;
			if (completeCapturedBaseHalfModelConnectionRequest(this.connectionNavigationService, intentRequestId, spec.id, descriptor.id)) {
				await this.commandService.executeCommand('workbench.action.closeActiveEditor');
				return;
			}
			await this.reload('firstField');
		} catch (error) {
			this.busy = false;
			this.setBusy(controls, save, test, remove, false);
			setConnectionButtonLabel(save, configured ? 'Replace Key' : 'Verify & Connect');
			formError.textContent = `Unable to connect: ${getErrorMessage(error)}`;
			formError.hidden = false;
			formError.focus();
		}
	}

	private async testConnection(
		spec: IBaseHalfRegisteredModelProviderConnectionSpec,
		formError: HTMLElement,
		controls: readonly IBaseHalfModelConnectionFieldControl[],
		save: HTMLButtonElement,
		test: HTMLButtonElement,
		remove: HTMLButtonElement | undefined
	): Promise<void> {
		if (this.busy) {
			return;
		}
		formError.hidden = true;
		this.setBusy(controls, save, test, remove, true);
		setConnectionButtonLabel(test, 'Testing…');
		try {
			await this.modelService.testConnection(spec.id);
			this.announcement = `${spec.providerLabel} connection verified.`;
			this.busy = false;
			await this.reload('firstField');
		} catch (error) {
			this.busy = false;
			this.setBusy(controls, save, test, remove, false);
			setConnectionButtonLabel(test, 'Test connection');
			formError.textContent = `Connection test failed: ${getErrorMessage(error)}`;
			formError.hidden = false;
			formError.focus();
		}
	}

	private async removeConnection(
		spec: IBaseHalfRegisteredModelProviderConnectionSpec,
		descriptor: IBaseHalfModelServiceDescriptor,
		formError: HTMLElement,
		controls: readonly IBaseHalfModelConnectionFieldControl[],
		save: HTMLButtonElement,
		test: HTMLButtonElement | undefined,
		remove: HTMLButtonElement
	): Promise<void> {
		if (this.busy) {
			return;
		}
		const confirmation = await this.dialogService.confirm({
			message: `Remove the saved ${spec.providerLabel} API key?`,
			detail: 'The key will be deleted from this device. Models that use this connection will be locked until you add a key again.',
			primaryButton: 'Remove'
		});
		if (!confirmation.confirmed) {
			return;
		}
		formError.hidden = true;
		this.setBusy(controls, save, test, remove, true);
		setConnectionButtonLabel(remove, 'Removing…');
		try {
			await this.modelService.remove(descriptor.id);
			this.announcement = 'Saved API key removed.';
			this.busy = false;
			await this.reload('firstField');
		} catch (error) {
			this.busy = false;
			this.setBusy(controls, save, test, remove, false);
			setConnectionButtonLabel(remove, 'Remove');
			formError.textContent = `Unable to remove this API key: ${getErrorMessage(error)}`;
			formError.hidden = false;
			formError.focus();
		}
	}

	private setBusy(
		controls: readonly IBaseHalfModelConnectionFieldControl[],
		save: HTMLButtonElement,
		test: HTMLButtonElement | undefined,
		remove: HTMLButtonElement | undefined,
		busy: boolean
	): void {
		this.busy = busy;
		for (const item of controls) {
			item.control.disabled = busy;
		}
		save.disabled = busy;
		if (test) {
			test.disabled = busy;
		}
		if (remove) {
			remove.disabled = busy;
		}
		if (save.form) {
			save.form.setAttribute('aria-busy', String(busy));
		}
	}

	private serviceForSpec(specId: string): IBaseHalfModelServiceDescriptor | undefined {
		return this.services.find(service => service.specId === specId);
	}

	private providerGroups(): readonly IBaseHalfModelProviderGroup[] {
		const models = this.videoModelCatalogService.getRegistry().models;
		const providerOrder = new Map<string, number>();
		for (const [index, model] of models.entries()) {
			providerOrder.set(model.key.provider, Math.min(providerOrder.get(model.key.provider) ?? index, index));
		}
		const byProvider = new Map<string, IBaseHalfRegisteredModelProviderConnectionSpec[]>();
		for (const spec of this.specs) {
			const bucket = byProvider.get(spec.providerId) ?? [];
			bucket.push(spec);
			byProvider.set(spec.providerId, bucket);
		}
		return [...byProvider.entries()].map(([providerId, specs]) => Object.freeze({
			providerId,
			label: specs[0].providerLabel,
			specs: Object.freeze(specs),
			models: Object.freeze(models.filter(model => specs.some(spec => modelMatchesSpec(model, spec))))
		})).sort((left, right) =>
			(providerOrder.get(left.providerId) ?? Number.MAX_SAFE_INTEGER) - (providerOrder.get(right.providerId) ?? Number.MAX_SAFE_INTEGER)
			|| left.label.localeCompare(right.label));
	}

	private modelsForSpec(spec: IBaseHalfRegisteredModelProviderConnectionSpec): readonly IBaseHalfVideoModelDescriptor[] {
		return this.videoModelCatalogService.getRegistry().models
			.filter(model => modelMatchesSpec(model, spec))
			.sort((left, right) => left.label.localeCompare(right.label));
	}

	private cancelPendingIntent(): void {
		if (this.intentRequestId) {
			this.connectionNavigationService.cancel(this.intentRequestId);
			this.intentRequestId = undefined;
		}
	}

	private clearSensitiveControls(): void {
		for (const control of this.sensitiveControls) {
			control.value = '';
		}
		this.sensitiveControls.clear();
	}

	private renderError(message: string): void {
		if (!this.list || !this.detail) {
			return;
		}
		// A failed reload can detach a form while its listener store still owns
		// closures over the password input. Zeroize before clearing either owner.
		this.clearSensitiveControls();
		this.renderDisposables.clear();
		clearNode(this.list);
		clearNode(this.detail);
		const error = append(this.detail, $('.basehalf-model-connection-form-error'));
		error.setAttribute('role', 'alert');
		error.tabIndex = -1;
		error.textContent = message;
		error.focus();
	}
}

function connectionButton(parent: HTMLElement, label: string, icon: string, primary = false): HTMLButtonElement {
	const element = append(parent, $('button.basehalf-model-connection-button')) as HTMLButtonElement;
	element.type = 'button';
	element.classList.toggle('primary', primary);
	element.title = label;
	element.setAttribute('aria-label', label);
	const iconElement = append(element, $(`span.codicon.${icon}`));
	iconElement.setAttribute('aria-hidden', 'true');
	const copy = append(element, $('span'));
	copy.textContent = label;
	return element;
}

function setConnectionButtonLabel(button: HTMLButtonElement, label: string): void {
	button.title = label;
	button.setAttribute('aria-label', label);
	const copy = button.lastElementChild;
	if (copy) {
		copy.textContent = label;
	}
}

function clearFieldError(control: HTMLInputElement | HTMLSelectElement, error: HTMLElement): void {
	control.removeAttribute('aria-invalid');
	error.textContent = '';
	error.hidden = true;
}

function showFieldError(control: HTMLInputElement | HTMLSelectElement, error: HTMLElement, message: string): void {
	control.setAttribute('aria-invalid', 'true');
	error.textContent = message;
	error.hidden = false;
}

function isHttpsUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
	} catch {
		return false;
	}
}

function modelMatchesSpec(model: IBaseHalfVideoModelDescriptor, spec: IBaseHalfRegisteredModelProviderConnectionSpec): boolean {
	return model.key.provider === spec.providerId
		&& model.key.deployment === spec.deploymentId
		&& model.key.region === spec.region;
}

function connectionScopeLabel(spec: IBaseHalfRegisteredModelProviderConnectionSpec): string {
	const label = spec.label.trim();
	const providerLabel = spec.providerLabel.trim();
	if (label.toLowerCase().startsWith(providerLabel.toLowerCase())) {
		return label.slice(providerLabel.length).trim() || label;
	}
	if (spec.providerId === 'alibaba-cloud' && label.toLowerCase().startsWith('wan ')) {
		return label.slice(4).trim() || label;
	}
	return label;
}

function sanitizeDomId(value: string): string {
	return value.replace(/[^a-z0-9_-]/gi, '-');
}
