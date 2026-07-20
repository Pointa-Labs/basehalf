/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfPluginLibrary.css';
import { addDisposableListener, append, $, clearNode, Dimension, EventType } from '../../../base/browser/dom.js';
import { ActionBar } from '../../../base/browser/ui/actionbar/actionbar.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { getErrorMessage, isCancellationError } from '../../../base/common/errors.js';
import { DisposableStore, MutableDisposable } from '../../../base/common/lifecycle.js';
import { Emitter } from '../../../base/common/event.js';
import Severity from '../../../base/common/severity.js';
import { URI } from '../../../base/common/uri.js';
import { IEditorOptions } from '../../../platform/editor/common/editor.js';
import { IDialogService } from '../../../platform/dialogs/common/dialogs.js';
import { INotificationService } from '../../../platform/notification/common/notification.js';
import { IStorageService } from '../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../platform/theme/common/themeService.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { EditorPane } from '../../browser/parts/editor/editorPane.js';
import { EditorInputCapabilities, IEditorOpenContext, IUntypedEditorInput } from '../../common/editor.js';
import { EditorInput } from '../../common/editor/editorInput.js';
import { IEditorGroup } from '../../services/editor/common/editorGroupsService.js';
import { ExtensionRuntimeStateAction } from '../../contrib/extensions/browser/extensionsActions.js';
import { IExtension, IExtensionsWorkbenchService } from '../../contrib/extensions/common/extensions.js';
import { BASEHALF_PLUGIN_LIBRARY_EDITOR_ID, BASEHALF_PLUGIN_LIBRARY_RESOURCE_SCHEME } from '../common/basehalfPluginCatalog.js';
import { IBaseHalfManagedPlugin, IBaseHalfPluginCatalogStatus, IBaseHalfPluginManagementService, IBaseHalfPluginOperationResult } from '../common/basehalfPluginManagement.js';
import { getBaseHalfPluginVersionChange } from '../common/basehalfPluginManagementService.js';
import { showBaseHalfPluginRuntimeAction } from './basehalfPluginRuntimeAction.js';

const pluginLibrarySelectionEmitter = new Emitter<string>();

export function selectBaseHalfPluginLibraryPlugin(extensionId: string): void {
	pluginLibrarySelectionEmitter.fire(extensionId.toLowerCase());
}

export class BaseHalfPluginLibraryInput extends EditorInput {
	static readonly ID = BASEHALF_PLUGIN_LIBRARY_EDITOR_ID;
	static readonly RESOURCE = URI.from({ scheme: BASEHALF_PLUGIN_LIBRARY_RESOURCE_SCHEME, authority: 'library', path: '/plugins' });

	override get typeId(): string { return BaseHalfPluginLibraryInput.ID; }
	override get capabilities(): EditorInputCapabilities { return super.capabilities | EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton; }
	override get editorId(): string { return BaseHalfPluginLibraryInput.ID; }
	override get resource(): URI { return BaseHalfPluginLibraryInput.RESOURCE; }
	override getName(): string { return 'Plugins'; }
	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		return super.matches(other) || other instanceof BaseHalfPluginLibraryInput;
	}
	override toUntyped(): IUntypedEditorInput {
		return { resource: this.resource, options: { override: this.typeId, pinned: true } };
	}
}

export class BaseHalfPluginLibraryPane extends EditorPane {
	static readonly ID = BASEHALF_PLUGIN_LIBRARY_EDITOR_ID;

	private root: HTMLElement | undefined;
	private searchInput: HTMLInputElement | undefined;
	private list: HTMLElement | undefined;
	private detail: HTMLElement | undefined;
	private catalogStatusElement: HTMLElement | undefined;
	private selectedExtensionId: string | undefined;
	private plugins: readonly IBaseHalfManagedPlugin[] = [];
	private renderGeneration = 0;
	private readonly renderDisposables = this._register(new MutableDisposable<DisposableStore>());

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IBaseHalfPluginManagementService private readonly pluginManagementService: IBaseHalfPluginManagementService,
		@IDialogService private readonly dialogService: IDialogService,
		@INotificationService private readonly notificationService: INotificationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService
	) {
		super(BaseHalfPluginLibraryPane.ID, group, telemetryService, themeService, storageService);
		this._register(this.pluginManagementService.onDidChange(() => void this.reload()));
		this._register(pluginLibrarySelectionEmitter.event(extensionId => {
			this.selectedExtensionId = extensionId;
			this.render();
		}));
	}

	protected override createEditor(parent: HTMLElement): void {
		this.root = append(parent, $('.basehalf-plugin-library'));
		const header = append(this.root, $('.basehalf-plugin-library-header'));
		const heading = append(header, $('.basehalf-plugin-library-heading'));
		const title = append(heading, $('h1'));
		title.textContent = 'Plugins';
		const subtitle = append(heading, $('p'));
		subtitle.textContent = 'Add reviewed capabilities to BaseHalf without changing its fixed shell.';
		this.catalogStatusElement = append(heading, $('p.basehalf-plugin-library-catalog-status'));
		this.catalogStatusElement.textContent = 'Loading verified catalog state…';
		const headerActions = append(header, $('.basehalf-plugin-library-header-actions'));
		const refresh = button(headerActions, 'Refresh catalog', 'codicon-refresh');
		refresh.dataset.action = 'refresh';
		this._register(addDisposableListener(refresh, EventType.CLICK, () => void this.refreshCatalog()));
		const close = button(headerActions, 'Close Plugins', 'codicon-close');
		close.dataset.action = 'close';
		this._register(addDisposableListener(close, EventType.CLICK, () => {
			if (this.input) {
				void this.group.closeEditor(this.input);
			}
		}));

		const search = append(this.root, $('.basehalf-plugin-library-search'));
		const searchIcon = append(search, $('span.codicon.codicon-search'));
		searchIcon.setAttribute('aria-hidden', 'true');
		this.searchInput = append(search, $('input')) as HTMLInputElement;
		this.searchInput.type = 'search';
		this.searchInput.placeholder = 'Search curated plugins';
		this.searchInput.setAttribute('aria-label', 'Search curated plugins');
		this._register(addDisposableListener(this.searchInput, EventType.INPUT, () => this.render()));

		const content = append(this.root, $('.basehalf-plugin-library-content'));
		this.list = append(content, $('.basehalf-plugin-library-list'));
		this.list.setAttribute('aria-label', 'Curated plugins');
		this.detail = append(content, $('.basehalf-plugin-library-detail'));
	}

	override async setInput(input: BaseHalfPluginLibraryInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		await this.reload();
		if (!token.isCancellationRequested) {
			void this.pluginManagementService.refreshCatalog().catch(error => this.showError(error));
		}
	}

	override layout(dimension: Dimension): void {
		if (this.root) {
			this.root.style.width = `${dimension.width}px`;
			this.root.style.height = `${dimension.height}px`;
		}
	}

	override focus(): void {
		(this.searchInput ?? this.root)?.focus();
	}

	private async reload(): Promise<void> {
		const generation = ++this.renderGeneration;
		try {
			const [plugins, catalogStatus] = await Promise.all([
				this.pluginManagementService.getPlugins(),
				this.pluginManagementService.getCatalogStatus()
			]);
			if (generation !== this.renderGeneration) {
				return;
			}
			this.plugins = plugins;
			if (this.catalogStatusElement) {
				this.catalogStatusElement.textContent = baseHalfPluginCatalogStatusLabel(catalogStatus);
				this.catalogStatusElement.classList.toggle('error', !!catalogStatus.error);
			}
			if (!this.selectedExtensionId || !plugins.some(plugin => plugin.extensionId === this.selectedExtensionId)) {
				this.selectedExtensionId = plugins[0]?.extensionId;
			}
			this.render();
		} catch (error) {
			this.showError(error);
		}
	}

	private render(): void {
		if (!this.list || !this.detail) {
			return;
		}
		const disposables = new DisposableStore();
		this.renderDisposables.value = disposables;
		clearNode(this.list);
		const query = this.searchInput?.value.trim().toLowerCase() ?? '';
		const visible = this.plugins.filter(plugin => !query
			|| plugin.label.toLowerCase().includes(query)
			|| plugin.description.toLowerCase().includes(query)
			|| plugin.extensionId.includes(query));
		if (!visible.length) {
			const empty = append(this.list, $('.basehalf-plugin-library-empty'));
			empty.textContent = 'No curated plugins match this search.';
			clearNode(this.detail);
			return;
		}
		const installed = visible.filter(plugin => !!plugin.installedVersion);
		const available = visible.filter(plugin => !plugin.installedVersion);
		this.renderSection(this.list, 'Installed', installed, disposables);
		this.renderSection(this.list, 'Available', available, disposables);
		const selected = visible.find(plugin => plugin.extensionId === this.selectedExtensionId) ?? visible[0];
		this.selectedExtensionId = selected.extensionId;
		this.renderDetail(selected, disposables);
	}

	private renderSection(parent: HTMLElement, label: string, plugins: readonly IBaseHalfManagedPlugin[], disposables: DisposableStore): void {
		if (!plugins.length) {
			return;
		}
		const heading = append(parent, $('h2.basehalf-plugin-library-section-title'));
		heading.textContent = label;
		for (const plugin of plugins) {
			const row = append(parent, $('button.basehalf-plugin-library-row')) as HTMLButtonElement;
			row.type = 'button';
			row.dataset.extensionId = plugin.extensionId;
			row.classList.toggle('selected', plugin.extensionId === this.selectedExtensionId);
			const icon = append(row, $('span.basehalf-plugin-library-row-icon.codicon.codicon-extensions'));
			icon.setAttribute('aria-hidden', 'true');
			const copy = append(row, $('.basehalf-plugin-library-row-copy'));
			const title = append(copy, $('.basehalf-plugin-library-row-title'));
			title.textContent = plugin.label;
			const description = append(copy, $('.basehalf-plugin-library-row-description'));
			description.textContent = plugin.description;
			const status = append(row, $('.basehalf-plugin-library-status'));
			status.textContent = baseHalfPluginStatusLabel(plugin);
			disposables.add(addDisposableListener(row, EventType.CLICK, () => {
				this.selectedExtensionId = plugin.extensionId;
				this.render();
			}));
		}
	}

	private renderDetail(plugin: IBaseHalfManagedPlugin, disposables: DisposableStore): void {
		clearNode(this.detail!);
		const hero = append(this.detail!, $('.basehalf-plugin-library-detail-hero'));
		const icon = append(hero, $('span.basehalf-plugin-library-detail-icon.codicon.codicon-extensions'));
		icon.setAttribute('aria-hidden', 'true');
		const copy = append(hero, $('.basehalf-plugin-library-detail-copy'));
		const title = append(copy, $('h2'));
		title.textContent = plugin.label;
		const id = append(copy, $('code'));
		id.textContent = plugin.extensionId;
		const description = append(this.detail!, $('p.basehalf-plugin-library-detail-description'));
		description.textContent = plugin.description;
		const meta = append(this.detail!, $('.basehalf-plugin-library-meta'));
		metaRow(meta, 'Status', baseHalfPluginStatusLabel(plugin));
		metaRow(meta, 'Installed', plugin.installedVersion ?? 'Not installed');
		metaRow(meta, 'Available', plugin.availableVersion ?? (plugin.bundledAvailable ? 'Bundled with BaseHalf' : 'Unavailable'));
		metaRow(meta, 'Category', plugin.category);
		metaRow(meta, 'Publisher', plugin.publisher.displayName);
		metaRow(meta, 'Trust', plugin.publisher.trust === 'official' ? 'Official' : 'Reviewed');

		const trust = append(this.detail!, $('.basehalf-plugin-library-trust'));
		const trustIcon = append(trust, $('span.codicon.codicon-shield'));
		trustIcon.setAttribute('aria-hidden', 'true');
		const trustCopy = append(trust, $('div'));
		const trustTitle = append(trustCopy, $('strong'));
		trustTitle.textContent = plugin.publisher.trust === 'official' ? 'Official local software' : 'Reviewed community software';
		const trustBody = append(trustCopy, $('p'));
		trustBody.textContent = `Published by ${plugin.publisher.displayName}. This executable plugin runs with trusted local extension privileges. BaseHalf review is a policy—not a runtime sandbox. Removing a plugin never removes project data.`;
		if (plugin.remoteVersion?.releaseNotes) {
			const releaseNotes = append(this.detail!, $('.basehalf-plugin-library-release-notes'));
			const releaseNotesTitle = append(releaseNotes, $('h3'));
			releaseNotesTitle.textContent = `Release notes · ${plugin.remoteVersion.version}`;
			const releaseNotesBody = append(releaseNotes, $('p'));
			releaseNotesBody.textContent = plugin.remoteVersion.releaseNotes;
		}
		if (plugin.state === 'withdrawn') {
			const withdrawal = append(this.detail!, $('.basehalf-plugin-library-error'));
			withdrawal.textContent = plugin.installedVersion
				? 'This installed version has been withdrawn. It remains manageable on this device, but it is no longer offered for installation.'
				: 'This plugin has been withdrawn and cannot be installed.';
		}

		if (plugin.error) {
			const error = append(this.detail!, $('.basehalf-plugin-library-error'));
			error.textContent = plugin.error;
		}

		const actions = append(this.detail!, $('.basehalf-plugin-library-actions'));
		const installedExtension = this.extensionsWorkbenchService.local.find(extension => extension.identifier.id.toLowerCase() === plugin.extensionId);
		if (installedExtension) {
			const runtimeAction = disposables.add(this.instantiationService.createInstance(ExtensionRuntimeStateAction));
			runtimeAction.extension = installedExtension;
			const actionBar = disposables.add(new ActionBar(actions));
			actionBar.push(runtimeAction, { icon: true, label: true });
		}
		for (const action of pluginActions(plugin)) {
			const actionButton = button(actions, action.label, action.icon, action.primary);
			actionButton.dataset.pluginAction = action.id;
			actionButton.dataset.extensionId = plugin.extensionId;
			disposables.add(addDisposableListener(actionButton, EventType.CLICK, () => void this.runAction(plugin, action.id)));
		}
	}

	private async runAction(plugin: IBaseHalfManagedPlugin, action: PluginActionId): Promise<void> {
		try {
			let result: IBaseHalfPluginOperationResult | undefined;
			let capturedRuntimeExtension: IExtension | undefined;
			switch (action) {
				case 'install': result = await this.pluginManagementService.install(plugin.extensionId); break;
				case 'update': result = await this.pluginManagementService.update(plugin.extensionId); break;
				case 'restore': result = await this.pluginManagementService.restore(plugin.extensionId); break;
				case 'enable': result = await this.pluginManagementService.enable(plugin.extensionId); break;
				case 'disable': result = await this.pluginManagementService.disable(plugin.extensionId); break;
				case 'open': await this.pluginManagementService.executePrimary(plugin.extensionId); break;
				case 'cancel': this.pluginManagementService.cancel(plugin.extensionId); break;
				case 'uninstall': {
					capturedRuntimeExtension = (await this.extensionsWorkbenchService.queryLocal())
						.find(candidate => candidate.identifier.id.toLowerCase() === plugin.extensionId.toLowerCase());
					const confirmation = await this.dialogService.confirm({
						message: `Uninstall ${plugin.label}?`,
						detail: 'The plugin will be removed from this BaseHalf profile. Existing project files and generated outputs stay on disk.',
						primaryButton: 'Uninstall'
					});
					if (confirmation.confirmed) {
						result = await this.pluginManagementService.uninstall(plugin.extensionId);
					}
					break;
				}
			}
			if (result?.restartRequired) {
				await showBaseHalfPluginRuntimeAction(this.extensionsWorkbenchService, this.instantiationService, this.notificationService, plugin, action, result, capturedRuntimeExtension);
			}
		} catch (error) {
			if (isCancellationError(error)) {
				return;
			}
			this.showError(error);
		}
	}

	private async refreshCatalog(): Promise<void> {
		try {
			await this.pluginManagementService.refreshCatalog();
			await this.reload();
		} catch (error) {
			this.showError(error);
		}
	}

	private showError(error: unknown): void {
		this.notificationService.notify({ severity: Severity.Error, message: `Plugin operation failed: ${getErrorMessage(error)}` });
	}
}

export function baseHalfPluginCatalogStatusLabel(status: IBaseHalfPluginCatalogStatus): string {
	const sequence = status.sequence === undefined ? '' : ` · catalog ${status.sequence}`;
	const generated = status.generatedAt ? ` · ${new Date(status.generatedAt).toLocaleString()}` : '';
	if (status.source === 'remote') {
		return `Signed remote catalog verified${sequence}${generated}${status.error ? ` · ${status.error}` : ''}`;
	}
	if (status.source === 'cache') {
		return `Offline · showing the last verified catalog${sequence}${generated}${status.error ? ` · ${status.error}` : ''}`;
	}
	return status.error ? `Bundled catalog only · ${status.error}` : 'Bundled catalog · remote distribution is not configured for this build.';
}

type PluginActionId = 'install' | 'update' | 'restore' | 'enable' | 'disable' | 'uninstall' | 'open' | 'cancel';

function pluginActions(plugin: IBaseHalfManagedPlugin): readonly { readonly id: PluginActionId; readonly label: string; readonly icon: string; readonly primary?: boolean }[] {
	if (plugin.busy) {
		return plugin.cancellable ? [{ id: 'cancel', label: 'Cancel', icon: 'codicon-debug-stop' }] : [];
	}
	if (!plugin.installedVersion) {
		if (plugin.state === 'incompatible' || plugin.state === 'withdrawn') {
			return [];
		}
		return [{ id: 'install', label: 'Install', icon: 'codicon-cloud-download', primary: true }];
	}
	const actions: { id: PluginActionId; label: string; icon: string; primary?: boolean }[] = [];
	const versionChange = getBaseHalfPluginVersionChange(plugin.installedVersion, plugin.remoteVersion?.version);
	if (plugin.state === 'updateAvailable' || (plugin.state === 'error' && versionChange === 'update')) {
		actions.push({ id: 'update', label: 'Update', icon: 'codicon-cloud-download', primary: true });
	}
	if (plugin.state === 'restoreAvailable' || (plugin.state === 'error' && versionChange === 'restore')) {
		actions.push({ id: 'restore', label: 'Restore', icon: 'codicon-history', primary: true });
	}
	if (plugin.enabled && plugin.primaryCommand) {
		actions.push({ id: 'open', label: plugin.primaryCommandLabel ?? 'Open', icon: 'codicon-add', primary: actions.length === 0 });
	}
	if (plugin.enabled) {
		actions.push({ id: 'disable', label: 'Disable', icon: 'codicon-circle-slash' });
	} else {
		actions.push({ id: 'enable', label: 'Enable', icon: 'codicon-check' });
	}
	actions.push({ id: 'uninstall', label: 'Uninstall', icon: 'codicon-trash' });
	return actions;
}

export function baseHalfPluginStatusLabel(plugin: IBaseHalfManagedPlugin): string {
	switch (plugin.state) {
		case 'available': return 'Available';
		case 'installing': return 'Installing…';
		case 'enabled': return 'Enabled';
		case 'disabled': return 'Disabled';
		case 'updateAvailable': return 'Update available';
		case 'restoreAvailable': return 'Restore available';
		case 'updating': return 'Working…';
		case 'restoring': return 'Restoring…';
		case 'incompatible': return 'Incompatible';
		case 'withdrawn': return 'Withdrawn';
		case 'error': return 'Error';
	}
}

function button(parent: HTMLElement, label: string, icon: string, primary = false): HTMLButtonElement {
	const element = append(parent, $('button.basehalf-plugin-library-button')) as HTMLButtonElement;
	element.type = 'button';
	element.classList.toggle('primary', primary);
	element.title = label;
	const iconElement = append(element, $(`span.codicon.${icon}`));
	iconElement.setAttribute('aria-hidden', 'true');
	const copy = append(element, $('span'));
	copy.textContent = label;
	return element;
}

function metaRow(parent: HTMLElement, label: string, value: string): void {
	const row = append(parent, $('.basehalf-plugin-library-meta-row'));
	const term = append(row, $('span'));
	term.textContent = label;
	const description = append(row, $('strong'));
	description.textContent = value;
}
