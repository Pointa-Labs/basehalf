/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfPluginsView.css';
import { append, $, isHTMLElement } from '../../../base/browser/dom.js';
import { InputBox } from '../../../base/browser/ui/inputbox/inputBox.js';
import { Action, IAction } from '../../../base/common/actions.js';
import { Codicon } from '../../../base/common/codicons.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { getErrorMessage, isCancellationError } from '../../../base/common/errors.js';
import { DelayedPagedModel, PagedModel } from '../../../base/common/paging.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import Severity from '../../../base/common/severity.js';
import { ThemeIcon } from '../../../base/common/themables.js';
import { localize, localize2 } from '../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { ContextKeyExpr, ContextKeyExpression, IContextKeyService } from '../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService, IContextViewService } from '../../../platform/contextview/browser/contextView.js';
import { IDialogService } from '../../../platform/dialogs/common/dialogs.js';
import { IGalleryExtension } from '../../../platform/extensionManagement/common/extensionManagement.js';
import { TargetPlatform } from '../../../platform/extensions/common/extensions.js';
import { IHoverService } from '../../../platform/hover/browser/hover.js';
import { SyncDescriptor } from '../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService, ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../platform/keybinding/common/keybinding.js';
import { WorkbenchPagedList } from '../../../platform/list/browser/listService.js';
import { INotificationService } from '../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../platform/opener/common/opener.js';
import { Registry } from '../../../platform/registry/common/platform.js';
import { defaultInputBoxStyles } from '../../../platform/theme/browser/defaultStyles.js';
import { IThemeService } from '../../../platform/theme/common/themeService.js';
import { HoverPosition } from '../../../base/browser/ui/hover/hoverWidget.js';
import { IViewPaneOptions, ViewPane } from '../../browser/parts/views/viewPane.js';
import { ViewPaneContainer } from '../../browser/parts/views/viewPaneContainer.js';
import { Extensions as ViewContainerExtensions, IViewContainersRegistry, IViewDescriptorService, IViewsRegistry, ViewContainerLocation } from '../../common/views.js';
import { EnablementState } from '../../services/extensionManagement/common/extensionManagement.js';
import { IPreferencesService } from '../../services/preferences/common/preferences.js';
import { ExtensionAction, DropDownExtensionAction } from '../../contrib/extensions/browser/extensionsActions.js';
import { manageExtensionIcon } from '../../contrib/extensions/browser/extensionsIcons.js';
import { Delegate, Renderer } from '../../contrib/extensions/browser/extensionsList.js';
import { Extension } from '../../contrib/extensions/browser/extensionsWorkbenchService.js';
import { ExtensionState, IExtension, IExtensionsViewState, IExtensionsWorkbenchService } from '../../contrib/extensions/common/extensions.js';
import { BASEHALF_MANAGE_PLUGINS_COMMAND_ID, BASEHALF_PLUGINS_VIEW_CONTAINER_ID, BASEHALF_PLUGINS_VIEW_ID } from '../common/basehalfPluginCatalog.js';
import { IBaseHalfManagedPlugin, IBaseHalfPluginManagementService, IBaseHalfPluginOperationResult } from '../common/basehalfPluginManagement.js';
import { baseHalfPluginCatalogStatusLabel, baseHalfPluginStatusLabel } from './basehalfPluginLibrary.js';

export const BASEHALF_PLUGIN_ITEM_CONTEXT_MENU = MenuId.for('BaseHalfPluginItemContext');

const BASEHALF_PLUGIN_CONTEXT_INSTALLED = 'basehalfPluginInstalled';
const BASEHALF_PLUGIN_CONTEXT_ENABLED = 'basehalfPluginEnabled';
const BASEHALF_PLUGIN_CONTEXT_BUSY = 'basehalfPluginBusy';
const BASEHALF_PLUGIN_CONTEXT_CAN_INSTALL = 'basehalfPluginCanInstall';
const BASEHALF_PLUGIN_CONTEXT_CAN_UPDATE = 'basehalfPluginCanUpdate';
const BASEHALF_PLUGIN_CONTEXT_CAN_OPEN = 'basehalfPluginCanOpen';
const BASEHALF_PLUGIN_CONTEXT_HAS_CONFIGURATION = 'basehalfPluginHasConfiguration';

const BASEHALF_PLUGIN_OPEN_DETAILS_COMMAND_ID = 'basehalf.plugins.openDetails';
const BASEHALF_PLUGIN_INSTALL_COMMAND_ID = 'basehalf.plugins.install';
const BASEHALF_PLUGIN_UPDATE_COMMAND_ID = 'basehalf.plugins.update';
const BASEHALF_PLUGIN_ENABLE_COMMAND_ID = 'basehalf.plugins.enable';
const BASEHALF_PLUGIN_DISABLE_COMMAND_ID = 'basehalf.plugins.disable';
const BASEHALF_PLUGIN_UNINSTALL_COMMAND_ID = 'basehalf.plugins.uninstall';
const BASEHALF_PLUGIN_EXECUTE_PRIMARY_COMMAND_ID = 'basehalf.plugins.executePrimary';
const BASEHALF_PLUGIN_CANCEL_COMMAND_ID = 'basehalf.plugins.cancel';
const BASEHALF_PLUGIN_SETTINGS_COMMAND_ID = 'basehalf.plugins.settings';
const BASEHALF_PLUGIN_REFRESH_COMMAND_ID = 'basehalf.plugins.refreshCatalog';

type PluginOperation = 'install' | 'update' | 'enable' | 'disable' | 'uninstall' | 'open' | 'cancel';

const EXTENSION_LIST_ELEMENT_HEIGHT = 72;

interface IBaseHalfPluginListSection {
	readonly root: HTMLElement;
	readonly listContainer: HTMLElement;
	readonly list: WorkbenchPagedList<IExtension>;
	count: number;
}

class BaseHalfPluginsViewState extends Disposable implements IExtensionsViewState {
	private readonly _onFocus = this._register(new Emitter<IExtension>());
	readonly onFocus: Event<IExtension> = this._onFocus.event;
	private readonly _onBlur = this._register(new Emitter<IExtension>());
	readonly onBlur: Event<IExtension> = this._onBlur.event;
	readonly filters = {};
	private focused: readonly IExtension[] = [];

	setFocused(extensions: readonly IExtension[]): void {
		this.focused.forEach(extension => this._onBlur.fire(extension));
		this.focused = extensions;
		this.focused.forEach(extension => this._onFocus.fire(extension));
	}
}

class BaseHalfPluginsViewPane extends ViewPane {
	private root: HTMLElement | undefined;
	private searchInput: InputBox | undefined;
	private catalogStatusElement: HTMLElement | undefined;
	private listElement: HTMLElement | undefined;
	private emptyElement: HTMLElement | undefined;
	private installedSection: IBaseHalfPluginListSection | undefined;
	private availableSection: IBaseHalfPluginListSection | undefined;
	private plugins: readonly IBaseHalfManagedPlugin[] = [];
	private loadGeneration = 0;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService private readonly basehalfContextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService private readonly basehalfContextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService private readonly basehalfInstantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@ICommandService private readonly commandService: ICommandService,
		@IBaseHalfPluginManagementService private readonly pluginManagementService: IBaseHalfPluginManagementService,
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService
	) {
		super(options, keybindingService, basehalfContextMenuService, configurationService, basehalfContextKeyService, viewDescriptorService, basehalfInstantiationService, openerService, themeService, hoverService);
		this._register(this.pluginManagementService.onDidChange(() => void this.reload()));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this.root = append(container, $('.basehalf-plugins-view'));

		const searchContainer = append(this.root, $('.basehalf-plugins-view-search'));
		this.searchInput = this._register(new InputBox(searchContainer, this.contextViewService, {
			ariaLabel: localize('basehalf.plugins.searchAriaLabel', "Search curated plugins"),
			placeholder: localize('basehalf.plugins.searchPlaceholder', "Search Plugins"),
			inputBoxStyles: defaultInputBoxStyles
		}));
		this._register(this.searchInput.onDidChange(() => this.renderPlugins()));

		this.catalogStatusElement = append(this.root, $('.basehalf-plugins-view-catalog-status'));
		this.catalogStatusElement.textContent = localize('basehalf.plugins.loadingCatalog', "Loading verified catalog…");
		this.listElement = append(this.root, $('.basehalf-plugins-view-list'));
		this.listElement.setAttribute('aria-label', localize('basehalf.plugins.curatedList', "Curated plugins"));
		this.installedSection = this.createSection(this.listElement, localize('basehalf.plugins.installed', "Installed"), 'basehalf.plugins.installed');
		this.availableSection = this.createSection(this.listElement, localize('basehalf.plugins.available', "Available"), 'basehalf.plugins.available');
		this.emptyElement = append(this.listElement, $('.basehalf-plugins-view-empty'));
		this.emptyElement.style.display = 'none';

		void this.reload();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.layoutLists(width);
	}

	override focus(): void {
		super.focus();
		this.searchInput?.focus();
	}

	private async reload(): Promise<void> {
		const generation = ++this.loadGeneration;
		try {
			const [plugins, catalogStatus] = await Promise.all([
				this.pluginManagementService.getPlugins(),
				this.pluginManagementService.getCatalogStatus(),
				this.extensionsWorkbenchService.whenInitialized
			]);
			if (generation !== this.loadGeneration) {
				return;
			}
			this.plugins = plugins;
			if (this.catalogStatusElement) {
				this.catalogStatusElement.textContent = baseHalfPluginCatalogStatusLabel(catalogStatus);
				this.catalogStatusElement.classList.toggle('error', !!catalogStatus.error);
			}
			this.renderPlugins();
		} catch (error) {
			if (generation !== this.loadGeneration || !this.emptyElement) {
				return;
			}
			this.setSectionModel(this.installedSection, []);
			this.setSectionModel(this.availableSection, []);
			this.emptyElement.style.display = '';
			this.emptyElement.classList.add('error');
			this.emptyElement.textContent = localize('basehalf.plugins.loadError', "Plugins could not be loaded: {0}", getErrorMessage(error));
		}
	}

	private renderPlugins(): void {
		if (!this.listElement || !this.emptyElement) {
			return;
		}
		const query = this.searchInput?.value.trim().toLowerCase() ?? '';
		const visible = this.plugins.filter(plugin => !query
			|| plugin.label.toLowerCase().includes(query)
			|| plugin.description.toLowerCase().includes(query)
			|| plugin.extensionId.includes(query));
		this.setSectionModel(this.installedSection, visible.filter(plugin => !!plugin.installedVersion));
		this.setSectionModel(this.availableSection, visible.filter(plugin => !plugin.installedVersion));
		if (!visible.length) {
			this.emptyElement.style.display = '';
			this.emptyElement.classList.remove('error');
			this.emptyElement.textContent = query
				? localize('basehalf.plugins.noSearchResults', "No curated plugins match this search.")
				: localize('basehalf.plugins.noPlugins', "No plugins are admitted by this BaseHalf build.");
		} else {
			this.emptyElement.style.display = 'none';
		}
		this.layoutLists(this.listElement.clientWidth);
	}

	private createSection(parent: HTMLElement, label: string, listId: string): IBaseHalfPluginListSection {
		const section = append(parent, $('.basehalf-plugins-view-section'));
		const heading = append(section, $('h3.basehalf-plugins-view-section-title'));
		heading.textContent = label;
		const listContainer = append(section, $('.extensions-list'));
		const viewState = this._register(new BaseHalfPluginsViewState());
		const renderer = this.basehalfInstantiationService.createInstance(Renderer, viewState, {
			hoverOptions: { position: () => HoverPosition.RIGHT },
			includeDefaultStatusAndHover: false,
			actionFactory: () => [
				new BaseHalfPluginPrimaryAction(pluginId => this.findPlugin(pluginId), this.commandService),
				new BaseHalfPluginManageAction(pluginId => this.findPlugin(pluginId), plugin => this.createManageActionGroups(plugin), this.basehalfInstantiationService)
			]
		});
		const list = this._register(this.basehalfInstantiationService.createInstance(WorkbenchPagedList<IExtension>, `${listId}-Extensions`, listContainer, new Delegate(), [renderer], {
			multipleSelectionSupport: false,
			setRowLineHeight: false,
			horizontalScrolling: false,
			openOnSingleClick: true,
			accessibilityProvider: {
				getAriaLabel: extension => {
					const plugin = extension && this.findPlugin(extension.identifier.id);
					return plugin ? `${plugin.label}, ${baseHalfPluginStatusLabel(plugin)}, ${plugin.description}` : '';
				},
				getWidgetAriaLabel: () => label
			}
		}) as WorkbenchPagedList<IExtension>);
		this._register(list.onDidChangeFocus(event => viewState.setFocused(event.elements)));
		this._register(list.onDidOpen(event => {
			const plugin = event.element && this.findPlugin(event.element.identifier.id);
			if (plugin) {
				void this.openDetails(plugin);
			}
		}));
		this._register(list.onContextMenu(event => {
			const plugin = event.element && this.findPlugin(event.element.identifier.id);
			if (plugin) {
				const anchor = isHTMLElement(event.anchor) ? event.anchor : { x: event.anchor.posx, y: event.anchor.posy };
				this.showPluginContextMenu(plugin, anchor);
			}
		}));
		return { root: section, listContainer, list, count: 0 };
	}

	private setSectionModel(section: IBaseHalfPluginListSection | undefined, plugins: readonly IBaseHalfManagedPlugin[]): void {
		if (!section) {
			return;
		}
		section.count = plugins.length;
		section.root.style.display = plugins.length ? '' : 'none';
		section.list.model = new DelayedPagedModel(new PagedModel(plugins.map(plugin => this.toExtension(plugin))));
	}

	private layoutLists(width: number): void {
		for (const section of [this.installedSection, this.availableSection]) {
			if (!section || !section.count) {
				continue;
			}
			const height = section.count * EXTENSION_LIST_ELEMENT_HEIGHT;
			section.listContainer.style.height = `${height}px`;
			section.list.layout(height, Math.max(0, width));
		}
	}

	private toExtension(plugin: IBaseHalfManagedPlugin): IExtension {
		const local = this.extensionsWorkbenchService.local.find(extension => extension.identifier.id.toLowerCase() === plugin.extensionId);
		const gallery = toGalleryExtension(plugin, local?.identifier.uuid);
		const extension = this.basehalfInstantiationService.createInstance(
			Extension,
			() => plugin.installedVersion ? ExtensionState.Installed : plugin.busy ? ExtensionState.Installing : ExtensionState.Uninstalled,
			() => undefined,
			local?.server,
			local?.local,
			gallery,
			undefined
		);
		extension.enablementState = plugin.enabled ? EnablementState.EnabledGlobally : EnablementState.DisabledGlobally;
		return extension;
	}

	private findPlugin(extensionId: string): IBaseHalfManagedPlugin | undefined {
		return this.plugins.find(plugin => plugin.extensionId === extensionId.toLowerCase());
	}

	private createManageActionGroups(plugin: IBaseHalfManagedPlugin): IAction[][] {
		const command = (id: string, label: string) => new Action(id, label, undefined, true, () => this.commandService.executeCommand(id, plugin));
		const groups: IAction[][] = [[command(BASEHALF_PLUGIN_OPEN_DETAILS_COMMAND_ID, localize('basehalf.plugins.openDetails', "Open Details"))]];
		if (plugin.installedVersion && !plugin.busy) {
			groups.push([plugin.enabled
				? command(BASEHALF_PLUGIN_DISABLE_COMMAND_ID, localize('basehalf.plugins.disable', "Disable"))
				: command(BASEHALF_PLUGIN_ENABLE_COMMAND_ID, localize('basehalf.plugins.enable', "Enable"))]);
			if (plugin.hasConfiguration) {
				groups.at(-1)!.push(command(BASEHALF_PLUGIN_SETTINGS_COMMAND_ID, localize('basehalf.plugins.settings', "Settings")));
			}
			groups.push([command(BASEHALF_PLUGIN_UNINSTALL_COMMAND_ID, localize('basehalf.plugins.uninstall', "Uninstall"))]);
		}
		return groups;
	}

	private openDetails(plugin: IBaseHalfManagedPlugin): Promise<unknown> {
		return this.commandService.executeCommand(BASEHALF_MANAGE_PLUGINS_COMMAND_ID, plugin.extensionId);
	}

	private showPluginContextMenu(plugin: IBaseHalfManagedPlugin, anchor: HTMLElement | { x: number; y: number }): void {
		const installed = !!plugin.installedVersion;
		const contextKeyService = this.basehalfContextKeyService.createOverlay([
			[BASEHALF_PLUGIN_CONTEXT_INSTALLED, installed],
			[BASEHALF_PLUGIN_CONTEXT_ENABLED, plugin.enabled],
			[BASEHALF_PLUGIN_CONTEXT_BUSY, plugin.busy],
			[BASEHALF_PLUGIN_CONTEXT_CAN_INSTALL, !installed && !plugin.busy && plugin.state !== 'incompatible' && plugin.state !== 'withdrawn'],
			[BASEHALF_PLUGIN_CONTEXT_CAN_UPDATE, !plugin.busy && (plugin.state === 'updateAvailable' || (plugin.state === 'error' && !!plugin.remoteVersion))],
			[BASEHALF_PLUGIN_CONTEXT_CAN_OPEN, installed && plugin.enabled && !!plugin.primaryCommand && !plugin.busy],
			[BASEHALF_PLUGIN_CONTEXT_HAS_CONFIGURATION, installed && plugin.hasConfiguration]
		]);
		this.basehalfContextMenuService.showContextMenu({
			menuId: BASEHALF_PLUGIN_ITEM_CONTEXT_MENU,
			menuActionOptions: { arg: plugin, shouldForwardArgs: true },
			contextKeyService,
			getAnchor: () => anchor,
		});
	}
}

class BaseHalfPluginPrimaryAction extends ExtensionAction {
	private commandId: string | undefined;
	private plugin: IBaseHalfManagedPlugin | undefined;

	constructor(
		private readonly getPlugin: (extensionId: string) => IBaseHalfManagedPlugin | undefined,
		private readonly commandService: ICommandService
	) {
		super('basehalf.plugins.primary', '', `${ExtensionAction.LABEL_ACTION_CLASS} prominent hide`, false);
	}

	update(): void {
		this.plugin = this.extension ? this.getPlugin(this.extension.identifier.id) : undefined;
		const primary = this.plugin && primaryAction(this.plugin);
		this.commandId = primary?.commandId;
		this.enabled = !!primary;
		this.hidden = !primary;
		this.label = primary?.label ?? '';
		this.tooltip = primary?.label ?? '';
		this.class = `${ExtensionAction.LABEL_ACTION_CLASS} prominent${primary ? '' : ' hide'}`;
	}

	override async run(): Promise<void> {
		if (this.plugin && this.commandId) {
			await this.commandService.executeCommand(this.commandId, this.plugin);
		}
	}
}

class BaseHalfPluginManageAction extends DropDownExtensionAction {
	private static readonly Class = `${ExtensionAction.ICON_ACTION_CLASS} manage ${ThemeIcon.asClassName(manageExtensionIcon)}`;
	private plugin: IBaseHalfManagedPlugin | undefined;

	constructor(
		private readonly getPlugin: (extensionId: string) => IBaseHalfManagedPlugin | undefined,
		private readonly getActionGroups: (plugin: IBaseHalfManagedPlugin) => IAction[][],
		instantiationService: IInstantiationService
	) {
		super('basehalf.plugins.manage', '', BaseHalfPluginManageAction.Class, true, instantiationService);
		this.tooltip = localize('basehalf.plugins.manage', "Manage");
	}

	update(): void {
		this.plugin = this.extension ? this.getPlugin(this.extension.identifier.id) : undefined;
		this.enabled = !!this.plugin;
		this.hidden = !this.plugin;
		this.class = `${BaseHalfPluginManageAction.Class}${this.plugin ? '' : ' hide'}`;
	}

	override async run(): Promise<void> {
		if (this.plugin) {
			await super.run(this.getActionGroups(this.plugin));
		}
	}
}

function toGalleryExtension(plugin: IBaseHalfManagedPlugin, uuid: string | undefined): IGalleryExtension {
	const [publisher, name] = plugin.extensionId.split('.', 2);
	const publishedAt = plugin.remoteVersion ? Date.parse(plugin.remoteVersion.publishedAt) : 0;
	const asset = `basehalf-plugin-library://${plugin.extensionId}`;
	return {
		type: 'gallery',
		name,
		identifier: { id: plugin.extensionId, uuid: uuid ?? plugin.galleryUuid },
		version: plugin.availableVersion ?? plugin.installedVersion ?? '0.0.0',
		displayName: plugin.label,
		publisherId: publisher,
		publisher,
		publisherDisplayName: 'Pointa Labs',
		description: plugin.description,
		installCount: 0,
		rating: 0,
		ratingCount: 0,
		categories: [plugin.category],
		tags: ['basehalf', 'plugin'],
		releaseDate: publishedAt,
		lastUpdated: publishedAt,
		preview: false,
		private: false,
		hasPreReleaseVersion: false,
		hasReleaseVersion: true,
		isSigned: true,
		allTargetPlatforms: [TargetPlatform.UNIVERSAL],
		assets: {
			manifest: null,
			readme: null,
			changelog: null,
			license: null,
			repository: null,
			download: { uri: asset, fallbackUri: asset },
			icon: null,
			signature: null,
			coreTranslations: []
		},
		properties: {
			engine: plugin.remoteVersion?.vscodeRange,
			targetPlatform: TargetPlatform.UNIVERSAL,
			isPreReleaseVersion: false,
			executesCode: true
		}
	};
}

const pluginsViewContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: BASEHALF_PLUGINS_VIEW_CONTAINER_ID,
	title: localize2('basehalf.plugins.viewContainer', "Plugins"),
	icon: Codicon.extensions,
	openCommandActionDescriptor: {
		id: BASEHALF_PLUGINS_VIEW_CONTAINER_ID,
		mnemonicTitle: localize({ key: 'basehalf.plugins.viewContainer.mnemonic', comment: ['&& denotes a mnemonic'] }, "P&&lugins"),
		order: 4
	},
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [BASEHALF_PLUGINS_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: `${BASEHALF_PLUGINS_VIEW_CONTAINER_ID}.state`,
	hideIfEmpty: false,
	order: 4
}, ViewContainerLocation.Sidebar);

Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([{
	id: BASEHALF_PLUGINS_VIEW_ID,
	name: localize2('basehalf.plugins.view', "Plugins"),
	containerIcon: Codicon.extensions,
	ctorDescriptor: new SyncDescriptor(BaseHalfPluginsViewPane),
	canToggleVisibility: false,
	canMoveView: false
}], pluginsViewContainer);

registerAction2(class BaseHalfOpenPluginDetailsAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_PLUGIN_OPEN_DETAILS_COMMAND_ID,
			title: localize2('basehalf.plugins.openDetails', "Open Details"),
			menu: { id: BASEHALF_PLUGIN_ITEM_CONTEXT_MENU, group: '1_navigation', order: 10 }
		});
	}
	override run(accessor: ServicesAccessor, plugin: unknown): Promise<unknown> | undefined {
		if (isManagedPlugin(plugin)) {
			return accessor.get(ICommandService).executeCommand(BASEHALF_MANAGE_PLUGINS_COMMAND_ID, plugin.extensionId);
		}
		return undefined;
	}
});

registerPluginOperationAction(BASEHALF_PLUGIN_EXECUTE_PRIMARY_COMMAND_ID, localize2('basehalf.plugins.open', "Open"), '1_navigation', ContextKeyExpr.has(BASEHALF_PLUGIN_CONTEXT_CAN_OPEN), 'open', 20);
registerPluginOperationAction(BASEHALF_PLUGIN_INSTALL_COMMAND_ID, localize2('basehalf.plugins.install', "Install"), '2_install', ContextKeyExpr.has(BASEHALF_PLUGIN_CONTEXT_CAN_INSTALL), 'install', 10);
registerPluginOperationAction(BASEHALF_PLUGIN_UPDATE_COMMAND_ID, localize2('basehalf.plugins.update', "Update"), '2_install', ContextKeyExpr.has(BASEHALF_PLUGIN_CONTEXT_CAN_UPDATE), 'update', 20);
registerPluginOperationAction(BASEHALF_PLUGIN_CANCEL_COMMAND_ID, localize2('basehalf.plugins.cancel', "Cancel"), '2_install', ContextKeyExpr.has(BASEHALF_PLUGIN_CONTEXT_BUSY), 'cancel', 30);
registerPluginOperationAction(BASEHALF_PLUGIN_ENABLE_COMMAND_ID, localize2('basehalf.plugins.enable', "Enable"), '3_manage', ContextKeyExpr.and(ContextKeyExpr.has(BASEHALF_PLUGIN_CONTEXT_INSTALLED), ContextKeyExpr.not(BASEHALF_PLUGIN_CONTEXT_ENABLED), ContextKeyExpr.not(BASEHALF_PLUGIN_CONTEXT_BUSY)), 'enable', 10);
registerPluginOperationAction(BASEHALF_PLUGIN_DISABLE_COMMAND_ID, localize2('basehalf.plugins.disable', "Disable"), '3_manage', ContextKeyExpr.and(ContextKeyExpr.has(BASEHALF_PLUGIN_CONTEXT_INSTALLED), ContextKeyExpr.has(BASEHALF_PLUGIN_CONTEXT_ENABLED), ContextKeyExpr.not(BASEHALF_PLUGIN_CONTEXT_BUSY)), 'disable', 20);

registerAction2(class BaseHalfPluginSettingsAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_PLUGIN_SETTINGS_COMMAND_ID,
			title: localize2('basehalf.plugins.settings', "Settings"),
			menu: { id: BASEHALF_PLUGIN_ITEM_CONTEXT_MENU, group: '3_manage', order: 30, when: ContextKeyExpr.has(BASEHALF_PLUGIN_CONTEXT_HAS_CONFIGURATION) }
		});
	}
	override run(accessor: ServicesAccessor, plugin: unknown): Promise<unknown> | undefined {
		if (isManagedPlugin(plugin)) {
			return accessor.get(IPreferencesService).openSettings({ jsonEditor: false, query: `@ext:${plugin.extensionId}` });
		}
		return undefined;
	}
});

registerPluginOperationAction(BASEHALF_PLUGIN_UNINSTALL_COMMAND_ID, localize2('basehalf.plugins.uninstall', "Uninstall"), '4_remove', ContextKeyExpr.and(ContextKeyExpr.has(BASEHALF_PLUGIN_CONTEXT_INSTALLED), ContextKeyExpr.not(BASEHALF_PLUGIN_CONTEXT_BUSY)), 'uninstall', 10);

registerAction2(class BaseHalfRefreshPluginCatalogAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_PLUGIN_REFRESH_COMMAND_ID,
			title: localize2('basehalf.plugins.refresh', "Refresh Plugin Catalog"),
			icon: Codicon.refresh,
			menu: { id: MenuId.ViewTitle, group: 'navigation', order: 10, when: ContextKeyExpr.equals('view', BASEHALF_PLUGINS_VIEW_ID) }
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const pluginManagementService = accessor.get(IBaseHalfPluginManagementService);
		const notificationService = accessor.get(INotificationService);
		try {
			await pluginManagementService.refreshCatalog();
		} catch (error) {
			notificationService.notify({ severity: Severity.Error, message: localize('basehalf.plugins.refreshFailed', "Plugin catalog refresh failed: {0}", getErrorMessage(error)) });
		}
	}
});

function registerPluginOperationAction(id: string, title: ReturnType<typeof localize2>, group: string, when: ContextKeyExpression | undefined, operation: PluginOperation, order: number): void {
	registerAction2(class extends Action2 {
		constructor() {
			super({ id, title, menu: { id: BASEHALF_PLUGIN_ITEM_CONTEXT_MENU, group, order, when } });
		}
		override run(accessor: ServicesAccessor, plugin: unknown): Promise<void> {
			return runPluginOperation(accessor, plugin, operation);
		}
	});
}

async function runPluginOperation(accessor: ServicesAccessor, argument: unknown, operation: PluginOperation): Promise<void> {
	if (!isManagedPlugin(argument)) {
		return;
	}
	const plugin = argument;
	const pluginManagementService = accessor.get(IBaseHalfPluginManagementService);
	const notificationService = accessor.get(INotificationService);
	try {
		let result: IBaseHalfPluginOperationResult | undefined;
		switch (operation) {
			case 'install': result = await pluginManagementService.install(plugin.extensionId); break;
			case 'update': result = await pluginManagementService.update(plugin.extensionId); break;
			case 'enable': result = await pluginManagementService.enable(plugin.extensionId); break;
			case 'disable': result = await pluginManagementService.disable(plugin.extensionId); break;
			case 'open': await pluginManagementService.executePrimary(plugin.extensionId); break;
			case 'cancel': pluginManagementService.cancel(plugin.extensionId); break;
			case 'uninstall': {
				const confirmation = await accessor.get(IDialogService).confirm({
					message: localize('basehalf.plugins.confirmUninstall', "Uninstall {0}?", plugin.label),
					detail: localize('basehalf.plugins.confirmUninstallDetail', "The plugin will be removed from this BaseHalf profile. Existing project files and generated outputs stay on disk."),
					primaryButton: localize('basehalf.plugins.uninstallButton', "Uninstall")
				});
				if (confirmation.confirmed) {
					result = await pluginManagementService.uninstall(plugin.extensionId);
				}
				break;
			}
		}
		if (result?.restartRequired) {
			notificationService.info(localize('basehalf.plugins.restartRequired', "Reload BaseHalf to finish updating {0}.", plugin.label));
		}
	} catch (error) {
		if (isCancellationError(error)) {
			return;
		}
		notificationService.notify({ severity: Severity.Error, message: localize('basehalf.plugins.operationFailed', "Plugin operation failed: {0}", getErrorMessage(error)) });
	}
}

function primaryAction(plugin: IBaseHalfManagedPlugin): { readonly label: string; readonly commandId: string } | undefined {
	if (plugin.busy) {
		return plugin.cancellable
			? { label: localize('basehalf.plugins.cancelInline', "Cancel"), commandId: BASEHALF_PLUGIN_CANCEL_COMMAND_ID }
			: undefined;
	}
	if (!plugin.installedVersion && plugin.state !== 'incompatible' && plugin.state !== 'withdrawn') {
		return { label: localize('basehalf.plugins.installInline', "Install"), commandId: BASEHALF_PLUGIN_INSTALL_COMMAND_ID };
	}
	if (plugin.state === 'updateAvailable' || (plugin.state === 'error' && plugin.remoteVersion)) {
		return { label: localize('basehalf.plugins.updateInline', "Update"), commandId: BASEHALF_PLUGIN_UPDATE_COMMAND_ID };
	}
	if (plugin.enabled && plugin.primaryCommand) {
		return { label: localize('basehalf.plugins.openInline', "Open"), commandId: BASEHALF_PLUGIN_EXECUTE_PRIMARY_COMMAND_ID };
	}
	return undefined;
}

function isManagedPlugin(value: unknown): value is IBaseHalfManagedPlugin {
	return !!value && typeof value === 'object'
		&& typeof (value as Partial<IBaseHalfManagedPlugin>).extensionId === 'string'
		&& typeof (value as Partial<IBaseHalfManagedPlugin>).label === 'string';
}
