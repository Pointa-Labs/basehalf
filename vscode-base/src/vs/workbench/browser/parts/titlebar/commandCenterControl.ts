/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, EventLike, EventType, isActiveDocument, reset } from '../../../../base/browser/dom.js';
import { BaseActionViewItem, IBaseActionViewItemOptions } from '../../../../base/browser/ui/actionbar/actionViewItems.js';
import { getDefaultHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { IHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegate.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { IAction, SubmenuAction } from '../../../../base/common/actions.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { autorun } from '../../../../base/common/observable.js';
import { basename, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { createActionViewItem } from '../../../../platform/actions/browser/menuEntryActionViewItem.js';
import { HiddenItemStrategy, MenuWorkbenchToolBar, WorkbenchToolBar } from '../../../../platform/actions/browser/toolbar.js';
import { MenuId, MenuRegistry, SubmenuItemAction } from '../../../../platform/actions/common/actions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { WindowTitle } from './windowTitle.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IBaseHalfCanvasNavigationService, IBaseHalfCanvasNavigationState } from '../../../basehalf/common/basehalfCanvasNavigation.js';

const AI_DISABLED_SETTING = 'chat.disableAIFeatures';
const AGENT_STATUS_ENABLED_SETTING = 'chat.agentsControl.enabled';

interface IBaseHalfTitleBreadcrumb {
	readonly label: string;
	readonly resource: URI;
	readonly path: string;
	readonly current: boolean;
}

function baseHalfTitleBreadcrumbs(state: IBaseHalfCanvasNavigationState): readonly IBaseHalfTitleBreadcrumb[] {
	const target = state.cardDetail ?? state.canvasFolder;
	if (!target) {
		return [];
	}

	const parts = target.relativePath.split('/').filter(Boolean);
	const rootLabel = basename(target.workspaceFolder) || target.workspaceFolder.authority || localize('basehalf.breadcrumb.workspace', "Workspace");
	const entries: IBaseHalfTitleBreadcrumb[] = [{
		label: rootLabel,
		resource: target.workspaceFolder,
		path: rootLabel,
		current: parts.length === 0
	}];
	for (let index = 0; index < parts.length; index++) {
		entries.push({
			label: parts[index],
			resource: joinPath(target.workspaceFolder, ...parts.slice(0, index + 1)),
			path: [rootLabel, ...parts.slice(0, index + 1)].join(' / '),
			current: index === parts.length - 1
		});
	}
	return entries;
}

export class CommandCenterControl {

	private readonly _disposables = new DisposableStore();

	private readonly _onDidChangeVisibility = this._disposables.add(new Emitter<void>());
	readonly onDidChangeVisibility: Event<void> = this._onDidChangeVisibility.event;

	readonly element: HTMLElement = document.createElement('div');

	constructor(
		windowTitle: WindowTitle,
		hoverDelegate: IHoverDelegate,
		@IInstantiationService instantiationService: IInstantiationService,
		@IQuickInputService quickInputService: IQuickInputService,
	) {
		this.element.classList.add('command-center');

		const titleToolbar = instantiationService.createInstance(MenuWorkbenchToolBar, this.element, MenuId.CommandCenter, {
			contextMenu: MenuId.TitleBarContext,
			hiddenItemStrategy: HiddenItemStrategy.NoHide,
			toolbarOptions: {
				primaryGroup: () => true,
			},
			telemetrySource: 'commandCenter',
			actionViewItemProvider: (action, options) => {
				if (action instanceof SubmenuItemAction && action.item.submenu === MenuId.CommandCenterCenter) {
					return instantiationService.createInstance(CommandCenterCenterViewItem, action, windowTitle, { ...options, hoverDelegate });
				} else {
					return createActionViewItem(instantiationService, action, { ...options, hoverDelegate });
				}
			}
		});

		let quickInputVisible = false;
		this._disposables.add(Event.filter(quickInputService.onShow, () => isActiveDocument(this.element), this._disposables)(() => {
			quickInputVisible = true;
			this._setVisibility(quickInputService.alignment.get() !== 'top');
		}));
		this._disposables.add(quickInputService.onHide(() => {
			quickInputVisible = false;
			this._setVisibility(true);
		}));
		this._disposables.add(autorun(reader => {
			const alignment = quickInputService.alignment.read(reader);
			if (quickInputVisible) {
				this._setVisibility(alignment !== 'top');
			}
		}));
		this._disposables.add(titleToolbar);
	}

	private _setVisibility(show: boolean): void {
		this.element.classList.toggle('hide', !show);
		this._onDidChangeVisibility.fire();
	}

	dispose(): void {
		this._disposables.dispose();
	}
}


class CommandCenterCenterViewItem extends BaseActionViewItem {

	private static readonly _quickOpenCommandId = 'workbench.action.quickOpenWithModes';

	private readonly _hoverDelegate: IHoverDelegate;

	constructor(
		private readonly _submenu: SubmenuItemAction,
		private readonly _windowTitle: WindowTitle,
		options: IBaseActionViewItemOptions,
		@IHoverService private readonly _hoverService: IHoverService,
		@IKeybindingService private _keybindingService: IKeybindingService,
		@IInstantiationService private _instaService: IInstantiationService,
		@IEditorGroupsService private _editorGroupService: IEditorGroupsService,
		@IConfigurationService private _configurationService: IConfigurationService,
		@IQuickInputService private readonly _quickInputService: IQuickInputService,
		@IBaseHalfCanvasNavigationService private readonly _canvasNavigationService: IBaseHalfCanvasNavigationService,
	) {
		super(undefined, _submenu.actions.find(action => action.id === 'workbench.action.quickOpenWithModes') ?? _submenu.actions[0], options);
		this._hoverDelegate = options.hoverDelegate ?? getDefaultHoverDelegate('mouse');
	}

	override render(container: HTMLElement): void {
		super.render(container);
		container.classList.add('command-center-center');
		container.classList.toggle('multiple', (this._submenu.actions.length > 1));

		const hover = this._store.add(this._hoverService.setupManagedHover(this._hoverDelegate, container, this.getTooltip()));

		// update label & tooltip when window title changes
		this._store.add(this._windowTitle.onDidChange(() => {
			hover.update(this.getTooltip());
		}));

		const groups: (readonly IAction[])[] = [];
		for (const action of this._submenu.actions) {
			if (action instanceof SubmenuAction) {
				groups.push(action.actions);
			} else {
				groups.push([action]);
			}
		}


		for (let i = 0; i < groups.length; i++) {
			const group = groups[i];

			// nested toolbar
			const toolbar = this._instaService.createInstance(WorkbenchToolBar, container, {
				hiddenItemStrategy: HiddenItemStrategy.NoHide,
				telemetrySource: 'commandCenterCenter',
				actionViewItemProvider: (action, options) => {
					options = {
						...options,
						hoverDelegate: this._hoverDelegate,
					};

					if (action.id !== CommandCenterCenterViewItem._quickOpenCommandId) {
						return createActionViewItem(this._instaService, action, options);
					}

					const that = this;

					return this._instaService.createInstance(class CommandCenterQuickPickItem extends BaseActionViewItem {
						private readonly renderDisposables = this._store.add(new MutableDisposable<DisposableStore>());
						private breadcrumbMode = false;

						constructor() {
							super(undefined, action, options);
						}

						override onClick(event: EventLike, preserveFocus = false): void {
							if (this.breadcrumbMode) {
								return;
							}
							super.onClick(event, preserveFocus);
						}

							override render(container: HTMLElement): void {
								super.render(container);
								container.classList.toggle('command-center-quick-pick');
								const renderContents = () => this.renderContents(container);
								renderContents();

								const hover = this._store.add(that._hoverService.setupManagedHover(that._hoverDelegate, container, this.getTooltip()));

								this._store.add(that._windowTitle.onDidChange(() => {
									hover.update(this.getTooltip());
									renderContents();
								}));
								this._store.add(that._editorGroupService.onDidChangeEditorPartOptions(({ newPartOptions, oldPartOptions }) => {
									if (newPartOptions.showTabs !== oldPartOptions.showTabs) {
										hover.update(this.getTooltip());
										renderContents();
									}
								}));
								this._store.add(that._canvasNavigationService.onDidChangeState(renderContents));
								this._store.add(that._canvasNavigationService.onDidChangeSurfaceActive(renderContents));
							}

						private renderContents(container: HTMLElement): void {
							const disposables = new DisposableStore();
							this.renderDisposables.value = disposables;
							this.breadcrumbMode = false;
							const breadcrumbs = that._canvasNavigationService.isSurfaceActive
									? baseHalfTitleBreadcrumbs(that._canvasNavigationService.state)
									: [];
								if (breadcrumbs.length > 0) {
									this.renderBreadcrumbs(container, breadcrumbs, disposables);
									return;
								}

								container.role = 'button';
								container.setAttribute('aria-description', this.getTooltip());
								container.classList.remove('basehalf-location-mode');
								const isCompactMode = this.isCompactMode();
								container.classList.toggle('compact-mode', isCompactMode);
								const searchIcon = document.createElement('span');
								searchIcon.ariaHidden = 'true';
								searchIcon.className = this.action.class ?? '';
								searchIcon.classList.add('search-icon');
								const labelElement = document.createElement('span');
								labelElement.classList.add('search-label');
								labelElement.textContent = this._getLabel();
								reset(container, ...(isCompactMode ? [labelElement] : [searchIcon, labelElement]));
							}

						private renderBreadcrumbs(container: HTMLElement, entries: readonly IBaseHalfTitleBreadcrumb[], disposables: DisposableStore): void {
							this.breadcrumbMode = true;
							container.role = 'group';
								container.setAttribute('aria-label', localize('basehalf.locationAndSearch', "Location and workspace search"));
								container.removeAttribute('aria-description');
								container.classList.add('basehalf-location-mode', 'compact-mode');

							const path = document.createElement('div');
							path.className = 'basehalf-command-center-breadcrumbs';
							path.title = entries[entries.length - 1].path;
							disposables.add(addDisposableListener(path, EventType.MOUSE_DOWN, event => event.stopPropagation()));
							disposables.add(addDisposableListener(path, EventType.CLICK, event => {
								event.preventDefault();
								event.stopPropagation();
							}));
							// The ActionBar listens above this item and otherwise treats Enter or
							// Space anywhere in the breadcrumb group as the parent Quick Open action.
							disposables.add(addDisposableListener(container, EventType.KEY_DOWN, event => event.stopPropagation()));
							disposables.add(addDisposableListener(container, EventType.KEY_UP, event => event.stopPropagation()));
								const displayEntries: Array<IBaseHalfTitleBreadcrumb | readonly IBaseHalfTitleBreadcrumb[]> = entries.length <= 4
									? [...entries]
									: [entries[0], entries.slice(1, -2), ...entries.slice(-2)];

								for (let index = 0; index < displayEntries.length; index++) {
									if (index > 0) {
										const separator = document.createElement('span');
										separator.className = 'basehalf-command-center-breadcrumb-separator codicon codicon-chevron-right';
										separator.ariaHidden = 'true';
										path.appendChild(separator);
									}
									const entry = displayEntries[index];
									if (Array.isArray(entry)) {
										path.appendChild(this.createOverflowButton(entry, disposables));
									} else {
										path.appendChild(this.createBreadcrumbSegment(entry as IBaseHalfTitleBreadcrumb, index === 0, disposables));
									}
								}

								const search = document.createElement('button');
								search.type = 'button';
								search.className = 'basehalf-command-center-search codicon codicon-search';
								search.title = this.getTooltip() ?? localize('basehalf.searchWorkspace', "Search workspace");
								search.setAttribute('aria-label', search.title);
								disposables.add(addDisposableListener(search, EventType.MOUSE_DOWN, event => event.stopPropagation()));
								disposables.add(addDisposableListener(search, EventType.CLICK, event => {
									event.preventDefault();
									event.stopPropagation();
									void this.actionRunner.run(this.action, { preserveFocus: false });
								}));
								reset(container, path, search);
							}

							private createBreadcrumbSegment(entry: IBaseHalfTitleBreadcrumb, root: boolean, disposables: DisposableStore): HTMLElement {
								const element = document.createElement(entry.current ? 'span' : 'button');
								element.className = 'basehalf-command-center-breadcrumb-segment';
								element.classList.toggle('root', root);
								element.classList.toggle('current', entry.current);
								element.textContent = entry.label;
								element.title = entry.path;
								if (entry.current) {
									element.setAttribute('aria-current', 'page');
									return element;
								}

								const button = element as HTMLButtonElement;
								button.type = 'button';
								button.setAttribute('aria-label', localize('basehalf.openFolderCanvas', "Open {0} canvas", entry.path));
								disposables.add(addDisposableListener(button, EventType.MOUSE_DOWN, event => event.stopPropagation()));
								disposables.add(addDisposableListener(button, EventType.CLICK, event => {
									event.preventDefault();
									event.stopPropagation();
									void that._canvasNavigationService.openFolderCanvas(entry.resource, { source: 'api' });
								}));
								return button;
							}

							private createOverflowButton(entries: readonly IBaseHalfTitleBreadcrumb[], disposables: DisposableStore): HTMLButtonElement {
								const button = document.createElement('button');
								button.type = 'button';
								button.className = 'basehalf-command-center-breadcrumb-overflow';
								button.textContent = '\u2026';
								button.title = localize('basehalf.showParentFolders', "Show parent folders");
								button.setAttribute('aria-label', button.title);
								disposables.add(addDisposableListener(button, EventType.MOUSE_DOWN, event => event.stopPropagation()));
								disposables.add(addDisposableListener(button, EventType.CLICK, event => {
									event.preventDefault();
									event.stopPropagation();
									void this.pickOverflowEntry(entries);
								}));
								return button;
							}

							private async pickOverflowEntry(entries: readonly IBaseHalfTitleBreadcrumb[]): Promise<void> {
								type Pick = IQuickPickItem & { readonly entry: IBaseHalfTitleBreadcrumb };
								const picked = await that._quickInputService.pick<Pick>(entries.map(entry => ({
									label: entry.label,
									description: entry.path,
									entry
								})), { placeHolder: localize('basehalf.goToParentFolder', "Go to a parent folder canvas") });
								if (picked) {
									await that._canvasNavigationService.openFolderCanvas(picked.entry.resource, { source: 'api' });
								}
							}

							private isCompactMode(): boolean {
								const aiFeaturesDisabled = that._configurationService.getValue<boolean>(AI_DISABLED_SETTING) === true;
								const aiCustomizationsDisabled = that._configurationService.getValue<boolean>('disableAICustomizations') === true
									|| that._configurationService.getValue<boolean>('workbench.disableAICustomizations') === true;
								const forcedHidden = aiFeaturesDisabled && aiCustomizationsDisabled;
								const agentControlValue = that._configurationService.getValue(AGENT_STATUS_ENABLED_SETTING);
								return !forcedHidden && (agentControlValue === true || agentControlValue === undefined || agentControlValue === 'compact');
							}

						protected override getTooltip() {
							return that.getTooltip();
						}

						private _getLabel(): string {
							const { prefix, suffix } = that._windowTitle.getTitleDecorations();
							let label = that._windowTitle.workspaceName;
							if (that._windowTitle.isCustomTitleFormat()) {
								label = that._windowTitle.getWindowTitle();
							} else if (that._editorGroupService.partOptions.showTabs === 'none') {
								label = that._windowTitle.fileName ?? label;
							}
							if (!label) {
								label = localize('label.dfl', "Search");
							}
							if (prefix) {
								label = localize('label1', "{0} {1}", prefix, label);
							}
							if (suffix) {
								label = localize('label2', "{0} {1}", label, suffix);
							}

							return label.replaceAll(/\r\n|\r|\n/g, '\u23CE');
						}
					});
				}
			});
			toolbar.setActions(group);
			this._store.add(toolbar);


			// spacer
			if (i < groups.length - 1) {
				const icon = renderIcon(Codicon.circleSmallFilled);
				icon.style.padding = '0 8px';
				icon.style.height = '100%';
				icon.style.opacity = '0.5';
				container.appendChild(icon);
			}
		}
	}

	protected override getTooltip() {

		// tooltip: full windowTitle
		const kb = this._keybindingService.lookupKeybinding(this.action.id)?.getLabel();
		const title = kb
			? localize('title', "Search {0} ({1}) \u2014 {2}", this._windowTitle.workspaceName, kb, this._windowTitle.value)
			: localize('title2', "Search {0} \u2014 {1}", this._windowTitle.workspaceName, this._windowTitle.value);

		return title;
	}
}

MenuRegistry.appendMenuItem(MenuId.CommandCenter, {
	submenu: MenuId.CommandCenterCenter,
	title: localize('title3', "Command Center"),
	icon: Codicon.shield,
	order: 101,
});
