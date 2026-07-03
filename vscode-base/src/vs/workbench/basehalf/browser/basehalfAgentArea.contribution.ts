/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfAgentArea.css';
import './basehalfAgentAreaView.js';

import { $, append, clearNode, Dimension, trackFocus } from '../../../base/browser/dom.js';
import { mainWindow } from '../../../base/browser/window.js';
import { Separator, toAction } from '../../../base/common/actions.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { KeyCode, KeyMod } from '../../../base/common/keyCodes.js';
import { IDisposable, Disposable, DisposableStore, toDisposable } from '../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../base/common/platform.js';
import { isObject } from '../../../base/common/types.js';
import { localize2 } from '../../../nls.js';
import { Action2, registerAction2 } from '../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { ContextKeyExpr, IContextKey, IContextKeyService, RawContextKey } from '../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../platform/contextview/browser/contextView.js';
import { ExtensionIdentifier } from '../../../platform/extensions/common/extensions.js';
import { IInstantiationService, ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { KeybindingWeight } from '../../../platform/keybinding/common/keybindingsRegistry.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../platform/notification/common/notification.js';
import { IWorkspaceTrustManagementService, IWorkspaceTrustRequestService } from '../../../platform/workspace/common/workspaceTrust.js';
import { IViewsService } from '../../services/views/common/viewsService.js';
import { type IShellLaunchConfig, type ITerminalLaunchError, TerminalExitReason } from '../../../platform/terminal/common/terminal.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { IViewDescriptorService } from '../../common/views.js';
import { IWorkbenchLayoutService, Parts } from '../../services/layout/browser/layoutService.js';
import { IExtensionService } from '../../services/extensions/common/extensions.js';
import { TerminalCommandId } from '../../contrib/terminal/common/terminal.js';
import { ICreateTerminalOptions, ITerminalInstance, ITerminalService } from '../../contrib/terminal/browser/terminal.js';
import { ViewPaneContainer } from '../../browser/parts/views/viewPaneContainer.js';
import {
	BASEHALF_AGENT_AREA_TOGGLE_COMMAND_ID,
	BASEHALF_AGENT_AREA_KILL_ACTIVE_COMMAND_ID,
	BASEHALF_AGENT_AREA_RESTART_ACTIVE_COMMAND_ID,
	BASEHALF_AGENT_AREA_NEW_TAB_COMMAND_ID,
	BASEHALF_AGENT_AREA_CLOSE_PANE_COMMAND_ID,
	BASEHALF_AGENT_AREA_CLOSE_TAB_COMMAND_ID,
	BASEHALF_AGENT_AREA_SPLIT_RIGHT_COMMAND_ID,
	BASEHALF_AGENT_AREA_SPLIT_DOWN_COMMAND_ID,
	BASEHALF_AGENT_AREA_FOCUS_PANE_LEFT_COMMAND_ID,
	BASEHALF_AGENT_AREA_FOCUS_PANE_RIGHT_COMMAND_ID,
	BASEHALF_AGENT_AREA_FOCUS_PANE_UP_COMMAND_ID,
	BASEHALF_AGENT_AREA_FOCUS_PANE_DOWN_COMMAND_ID,
	BASEHALF_AGENT_AREA_FOCUS_NEXT_PANE_COMMAND_ID,
	BASEHALF_AGENT_AREA_FOCUS_PREVIOUS_PANE_COMMAND_ID,
	BASEHALF_AGENT_AREA_NEXT_TAB_COMMAND_ID,
	BASEHALF_AGENT_AREA_PREVIOUS_TAB_COMMAND_ID,
	BASEHALF_AGENT_AREA_RESIZE_PANE_LEFT_COMMAND_ID,
	BASEHALF_AGENT_AREA_RESIZE_PANE_RIGHT_COMMAND_ID,
	BASEHALF_AGENT_AREA_RESIZE_PANE_UP_COMMAND_ID,
	BASEHALF_AGENT_AREA_RESIZE_PANE_DOWN_COMMAND_ID,
	BASEHALF_AGENT_AREA_EQUALIZE_PANES_COMMAND_ID,
	BASEHALF_AGENT_AREA_TOGGLE_ZOOM_COMMAND_ID,
	BASEHALF_AGENT_AREA_GOTO_TAB_COMMAND_IDS,
	BASEHALF_AGENT_AREA_LAST_TAB_COMMAND_ID,
	BASEHALF_AGENT_AREA_VIEW_CONTAINER_ID,
	BASEHALF_AGENT_EXTENSION_CANONICAL_VIEW_CONTAINER_IDS,
	BASEHALF_VISIBLE_AGENT_SESSION_CHOICES,
	BaseHalfAgentSessionKind,
	BaseHalfAgentSessionState,
	BaseHalfExtensionAgentSessionKind,
	baseHalfAgentSessionChoiceForKind,
	baseHalfTuiSessionLaunchConfig,
	baseHalfTuiSessionLaunchFailureGuidance,
	IBaseHalfAgentAreaService,
	IBaseHalfAgentAreaSession,
	IBaseHalfAdoptAgentTerminalOptions,
	IBaseHalfCreateAgentTerminalOptions,
	IBaseHalfExtensionAgentProvider,
	IBaseHalfExtensionAgentProviderResult
} from '../common/basehalfAgentArea.js';
import {
	BaseHalfFocusDir,
	BaseHalfSplitDir,
	dropEdge,
	leafRects,
	splitDividers
} from '../common/basehalfAgentSplitTree.js';
import {
	BASEHALF_EMPTY_AGENT_TABS_STATE,
	IBaseHalfAgentTab,
	IBaseHalfAgentTabsState,
	activeAgentTab,
	agentTabForPane,
	closeActiveAgentPane,
	closeAgentTab,
	closeAgentTabsToRight,
	closeOtherAgentTabs,
	closingEntryPaneIds,
	createAgentTab,
	equalizeAgentPanes,
	finalizeAgentClose,
	focusAgentPane,
	gotoAgentPaneDir,
	gotoAgentPaneRing,
	gotoAgentTab,
	lastAgentTab,
	markAgentPaneActivity,
	mountedAgentPaneIds,
	moveAgentPane,
	removeAgentPane,
	reorderAgentTab,
	resizeActiveAgentPane,
	selectAgentTab,
	setAgentSplitFraction,
	setAgentTabTitle,
	splitActiveAgentPane,
	switchAgentTab,
	toggleAgentPaneZoom,
	undoAgentClose
} from '../common/basehalfAgentTabsModel.js';
import { BaseHalfSetting, normalizeBaseHalfAgentDefaultSession } from '../common/basehalfConfiguration.js';

export const BASEHALF_AGENT_AREA_FOCUSED_CONTEXT_KEY = new RawContextKey<boolean>('basehalfAgentAreaFocused', false);

const CLOSE_GRACE_MS = 6000;
const RESIZE_HUD_MS = 750;
const DIVIDER_MIN_PANE_PX = 48;

interface IBaseHalfRuntimeAgentSession {
	id: string;
	kind: BaseHalfAgentSessionKind;
	label: string;
	description: string;
	state: BaseHalfAgentSessionState;
	detail?: string;
	host: HTMLElement;
	surface: HTMLElement;
	statePanel: HTMLElement;
	dimOverlay: HTMLElement;
	grabHandle: HTMLElement;
	dropZone: HTMLElement;
	dropPreview: HTMLElement;
	disposables: DisposableStore;
	terminal?: ITerminalInstance;
	extensionSetVisible?: (visible: boolean) => void;
	extensionLayout?: () => void;
	extensionFocus?: () => void | Promise<void>;
	extensionDispose?: () => void | Promise<void>;
	statePrimaryAction?: { label: string; run: () => void | Promise<void> };
	closing?: boolean;
}

interface IBaseHalfResolvedExtensionAgentSurface {
	readonly viewContainerId: string;
	readonly viewId: string | undefined;
}

class BaseHalfExtensionAgentUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BaseHalfExtensionAgentUnavailableError';
	}
}

class BaseHalfViewContainerExtensionAgentProvider implements IBaseHalfExtensionAgentProvider {
	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IViewDescriptorService private readonly viewDescriptorService: IViewDescriptorService
	) { }

	async createSession(kind: BaseHalfExtensionAgentSessionKind, container: unknown): Promise<IBaseHalfExtensionAgentProviderResult> {
		if (!(container instanceof mainWindow.HTMLElement)) {
			throw new Error('BaseHalf extension-agent sessions require a DOM host.');
		}

		const choice = baseHalfAgentSessionChoiceForKind(kind);
		if (!choice.extensionId) {
			throw new Error(`${choice.label} does not declare a VS Code extension id.`);
		}

		await this.extensionService.whenInstalledExtensionsRegistered();
		const extension = await this.extensionService.getExtension(choice.extensionId);
		if (!extension) {
			throw new BaseHalfExtensionAgentUnavailableError(`${choice.extensionId} is not installed or enabled.`);
		}

		// Activate the extension so it registers its webview view provider, but do
		// NOT fire onView activation: that would reveal the view in its canonical
		// container, whose pane would steal the single webview instance from the
		// Agent Area pane.
		await this.extensionService.activateById(new ExtensionIdentifier(choice.extensionId), {
			startup: false,
			extensionId: new ExtensionIdentifier(choice.extensionId),
			activationEvent: 'basehalf.agentArea.extension'
		});

		const surface = this.resolveSurface(kind);
		if (!surface) {
			const containers = (choice.extensionViewContainerIds ?? []).join(', ') || '<none>';
			const views = (choice.extensionViewIds ?? []).join(', ') || '<none>';
			throw new BaseHalfExtensionAgentUnavailableError(`${choice.extensionId} did not contribute an active Agent Area view surface. Containers: ${containers}. Views: ${views}.`);
		}

		clearNode(container);
		const viewHost = append(container, $('.basehalf-agent-extension-view-host'));
		const viewPaneContainer = this.instantiationService.createInstance(ViewPaneContainer, surface.viewContainerId, { mergeViewWithContainerWhenSingleView: true });
		viewPaneContainer.create(viewHost);

		const layout = () => {
			const width = Math.max(1, Math.floor(viewHost.clientWidth));
			const height = Math.max(1, Math.floor(viewHost.clientHeight));
			viewPaneContainer.layout(new Dimension(width, height));
		};
		const resizeObserver = new mainWindow.ResizeObserver(layout);
		resizeObserver.observe(viewHost);

		viewPaneContainer.setVisible(true);
		layout();
		if (surface.viewId) {
			viewPaneContainer.openView(surface.viewId, false);
		}

		return {
			label: choice.label,
			description: choice.description,
			detail: `Rendering ${choice.extensionId} via VS Code view ${surface.viewId ?? surface.viewContainerId}`,
			focus: () => viewPaneContainer.focus(),
			setVisible: visible => {
				viewPaneContainer.setVisible(visible);
				if (visible) {
					layout();
				}
			},
			layout,
			dispose: () => {
				resizeObserver.disconnect();
				viewPaneContainer.setVisible(false);
				viewPaneContainer.dispose();
				viewHost.remove();
			}
		};
	}

	private resolveSurface(kind: BaseHalfExtensionAgentSessionKind): IBaseHalfResolvedExtensionAgentSurface | undefined {
		const choice = baseHalfAgentSessionChoiceForKind(kind);
		for (const declaredViewContainerId of choice.extensionViewContainerIds ?? []) {
			const viewContainerId = this.resolveViewContainerId(declaredViewContainerId);
			if (!viewContainerId) {
				continue;
			}

			const viewContainer = this.viewDescriptorService.getViewContainerById(viewContainerId);
			if (!viewContainer) {
				continue;
			}

			const model = this.viewDescriptorService.getViewContainerModel(viewContainer);
			const candidateViewIds = choice.extensionViewIds ?? [];
			const activeViewId = candidateViewIds.find(viewId => model.activeViewDescriptors.some(descriptor => descriptor.id === viewId))
				?? candidateViewIds.find(viewId => this.viewDescriptorService.getViewDescriptorById(viewId))
				?? model.activeViewDescriptors[0]?.id
				?? model.allViewDescriptors[0]?.id;

			return { viewContainerId, viewId: activeViewId };
		}

		return undefined;
	}

	private resolveViewContainerId(declaredViewContainerId: string): string | undefined {
		for (const candidate of this.viewContainerIdCandidates(declaredViewContainerId)) {
			if (this.viewDescriptorService.getViewContainerById(candidate)) {
				return candidate;
			}
		}
		return undefined;
	}

	private viewContainerIdCandidates(declaredViewContainerId: string): readonly string[] {
		const extensionPrefix = 'workbench.view.extension.';
		if (declaredViewContainerId.startsWith(extensionPrefix)) {
			return [declaredViewContainerId, declaredViewContainerId.slice(extensionPrefix.length)];
		}
		return [`${extensionPrefix}${declaredViewContainerId}`, declaredViewContainerId];
	}
}

class BaseHalfAgentAreaService extends Disposable implements IBaseHalfAgentAreaService {
	declare readonly _serviceBrand: undefined;

	private static nextId = 1;

	private readonly _onDidChangeVisibility = this._register(new Emitter<boolean>());
	readonly onDidChangeVisibility: Event<boolean> = this._onDidChangeVisibility.event;

	private readonly _onDidChangeSessions = this._register(new Emitter<readonly IBaseHalfAgentAreaSession[]>());
	readonly onDidChangeSessions: Event<readonly IBaseHalfAgentAreaSession[]> = this._onDidChangeSessions.event;

	private readonly root: HTMLElement;
	private readonly tabsBar: HTMLElement;
	private readonly tabStrip: HTMLElement;
	private readonly zoomResetButton: HTMLButtonElement;
	private readonly body: HTMLElement;
	private readonly dividersLayer: HTMLElement;
	private readonly hud: HTMLElement;
	private readonly zoomBadge: HTMLElement;
	private readonly toasts: HTMLElement;
	private readonly empty: HTMLElement;
	private readonly resizeObserver: ResizeObserver;
	private readonly focusedContextKey: IContextKey<boolean>;

	private tabsState: IBaseHalfAgentTabsState = BASEHALF_EMPTY_AGENT_TABS_STATE;
	private readonly runtime = new Map<string, IBaseHalfRuntimeAgentSession>();
	private readonly extensionProviders = new Map<BaseHalfExtensionAgentSessionKind, IBaseHalfExtensionAgentProvider>();
	private readonly graceTimers = new Map<string, number>();

	private editingTabId: string | undefined;
	private editingDraft = '';
	private tabDragId: string | undefined;
	private tabDropIndex: number | undefined;
	private paneDragId: string | undefined;
	private hudTimer: number | undefined;

	constructor(
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@ITerminalService private readonly terminalService: ITerminalService,
		@INotificationService private readonly notificationService: INotificationService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IWorkspaceTrustManagementService private readonly workspaceTrustManagementService: IWorkspaceTrustManagementService,
		@IWorkspaceTrustRequestService private readonly workspaceTrustRequestService: IWorkspaceTrustRequestService,
		@IViewsService private readonly viewsService: IViewsService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();

		const extensionAgentProvider = this.instantiationService.createInstance(BaseHalfViewContainerExtensionAgentProvider);
		this._register(this.registerExtensionAgentProvider('extension-codex', extensionAgentProvider));
		this._register(this.registerExtensionAgentProvider('extension-claude', extensionAgentProvider));

		// The chrome is built detached; the Agent Area view pane (auxiliary bar)
		// adopts it via mountIn() when the part materializes.
		this.root = $('.basehalf-agent-area');
		this.root.setAttribute('aria-label', 'BaseHalf Agent Area');

		this.tabsBar = append(this.root, $('.basehalf-agent-area-tabs'));
		const tabsBar = this.tabsBar;
		this.tabStrip = append(tabsBar, $('.basehalf-agent-tabstrip'));
		this.tabStrip.setAttribute('role', 'tablist');
		this.tabStrip.setAttribute('aria-label', 'Agent sessions');
		this.tabStrip.addEventListener('dblclick', e => {
			if (e.target === this.tabStrip) {
				void this.newTab();
			}
		});
		this.tabStrip.addEventListener('dragover', e => {
			if (this.tabDragId && e.target === this.tabStrip) {
				e.preventDefault();
				this.setTabDropIndex(this.tabsState.tabs.length);
			}
		});
		this.tabStrip.addEventListener('drop', e => {
			if (this.tabDragId && e.target === this.tabStrip) {
				e.preventDefault();
				this.dropDraggedTabAt(this.tabsState.tabs.length);
			}
		});
		this.tabStrip.addEventListener('dragleave', e => {
			if (!this.tabStrip.contains(e.relatedTarget as Node | null)) {
				this.setTabDropIndex(undefined);
			}
		});

		this.zoomResetButton = append(tabsBar, $('button.basehalf-agent-area-icon.basehalf-agent-zoom-reset.codicon.codicon-screen-normal')) as HTMLButtonElement;
		this.zoomResetButton.type = 'button';
		this.zoomResetButton.title = 'Reset Zoom (⌘⇧↵)';
		this.zoomResetButton.setAttribute('aria-label', 'Reset Zoom');
		this.zoomResetButton.addEventListener('click', () => this.togglePaneZoom());

		const plus = append(tabsBar, $('button.basehalf-agent-area-icon.basehalf-agent-new-tab.codicon.codicon-add')) as HTMLButtonElement;
		plus.type = 'button';
		plus.title = 'New Agent Session';
		plus.setAttribute('aria-label', 'New Agent Session');
		plus.addEventListener('click', () => this.showNewSessionMenu(plus));

		this.body = append(this.root, $('.basehalf-agent-area-body'));
		this.empty = append(this.body, $('.basehalf-agent-area-empty'));
		this.buildEmptyStatePicker();
		this.dividersLayer = append(this.body, $('.basehalf-agent-dividers'));
		this.hud = append(this.body, $('.basehalf-agent-resize-hud'));
		this.hud.setAttribute('aria-hidden', 'true');
		this.zoomBadge = append(this.body, $('.basehalf-agent-zoom-badge'));
		this.zoomBadge.setAttribute('aria-hidden', 'true');
		this.zoomBadge.textContent = 'zoomed · ⌘⇧↵';
		this.toasts = append(this.root, $('.basehalf-agent-toasts'));

		this.resizeObserver = new mainWindow.ResizeObserver(() => this.layoutVisiblePanes());
		this.resizeObserver.observe(this.body);

		this.focusedContextKey = BASEHALF_AGENT_AREA_FOCUSED_CONTEXT_KEY.bindTo(contextKeyService);
		const focusTracker = this._register(trackFocus(this.root));
		this._register(focusTracker.onDidFocus(() => {
			this.focusedContextKey.set(true);
			this.root.classList.add('focused');
		}));
		this._register(focusTracker.onDidBlur(() => {
			this.focusedContextKey.set(false);
			this.root.classList.remove('focused');
		}));

		// Visibility belongs to the auxiliary bar part: the grid shows/hides the
		// area, we just mirror the state for sessions and listeners.
		this._register(this.layoutService.onDidChangePartVisibility(event => {
			if (event.partId === Parts.AUXILIARYBAR_PART) {
				this.render();
				this._onDidChangeVisibility.fire(event.visible);
			}
		}));

		// The curated extensions' canonical containers are not product surfaces;
		// if one opens (extension-triggered reveal), the workbench profile guard
		// closes it — its pane steals the single webview instance on the way, so
		// re-assert the Agent Area pane's claim once it is gone.
		this._register(this.viewsService.onDidChangeViewContainerVisibility(event => {
			if (!event.visible && BASEHALF_AGENT_EXTENSION_CANONICAL_VIEW_CONTAINER_IDS.includes(event.id)) {
				this.reassertExtensionClaims();
			}
		}));

		this._register(toDisposable(() => {
			this.resizeObserver.disconnect();
			for (const key of [...this.graceTimers.keys()]) {
				this.cancelGraceTimer(key);
			}
			for (const session of [...this.runtime.values()]) {
				this.runtime.delete(session.id);
				this.disposeRuntimeSession(session, false);
			}
			this.root.remove();
		}));
	}

	mountIn(container: HTMLElement): void {
		container.appendChild(this.root);
		this.render();
	}

	// ── Public state ───────────────────────────────────────────────────────────

	get visible(): boolean {
		return this.layoutService.isVisible(Parts.AUXILIARYBAR_PART);
	}

	get sessions(): readonly IBaseHalfAgentAreaSession[] {
		const out: IBaseHalfAgentAreaSession[] = [];
		for (const paneId of mountedAgentPaneIds(this.tabsState)) {
			const session = this.runtime.get(paneId);
			if (session) {
				out.push(this.snapshotSession(session));
			}
		}
		return out;
	}

	get activeSessionId(): string | undefined {
		return activeAgentTab(this.tabsState)?.activePaneId;
	}

	get activeTerminal(): ITerminalInstance | undefined {
		const id = this.activeSessionId;
		return id ? this.runtime.get(id)?.terminal : undefined;
	}

	// ── Visibility ─────────────────────────────────────────────────────────────

	async show(preserveFocus = false): Promise<void> {
		// Opening the Agent Area view container reveals the auxiliary bar part
		// and materializes the view pane, which adopts the chrome via mountIn().
		await this.viewsService.openViewContainer(BASEHALF_AGENT_AREA_VIEW_CONTAINER_ID, false);
		this.render();
		if (!preserveFocus) {
			await this.focusActivePane();
		}
	}

	hide(): void {
		if (!this.visible) {
			return;
		}

		this.layoutService.setPartHidden(true, Parts.AUXILIARYBAR_PART);
		this.render();
	}

	async toggle(preserveFocus = false): Promise<void> {
		if (this.visible) {
			this.hide();
			return;
		}

		if (!this.tabsState.tabs.length) {
			await this.createSession(this.defaultSessionKind());
			return;
		}

		await this.show(preserveFocus);
	}

	// ── Session creation ───────────────────────────────────────────────────────

	async createSession(kind: BaseHalfAgentSessionKind): Promise<IBaseHalfAgentAreaSession> {
		const choice = baseHalfAgentSessionChoiceForKind(kind);
		if (choice.terminalCommand || kind === 'terminal') {
			return this.createTerminalSession({
				label: choice.label,
				command: choice.terminalCommand,
				source: choice.commandId
			});
		}

		return this.createExtensionAgentSession(kind as BaseHalfExtensionAgentSessionKind);
	}

	async createTerminalSession(options: IBaseHalfCreateAgentTerminalOptions = {}): Promise<IBaseHalfAgentAreaSession> {
		const command = options.command;
		const choice = command === 'codex'
			? baseHalfAgentSessionChoiceForKind('tui-codex')
			: command === 'claude'
				? baseHalfAgentSessionChoiceForKind('tui-claude')
				: baseHalfAgentSessionChoiceForKind('terminal');
		const label = options.label ?? choice.label;
		const session = this.createRuntimeSession(choice.kind, label, choice.description);
		this.openPaneInNewTab(session.id, true);

		await this.show(true);
		await this.initializeTerminalPane(session, options);
		return this.snapshotSession(session);
	}

	async adoptTerminalSession(terminal: unknown, options: IBaseHalfAdoptAgentTerminalOptions = {}): Promise<IBaseHalfAgentAreaSession> {
		if (!this.isTerminalInstance(terminal)) {
			throw new Error('BaseHalf Agent Area can only adopt a VS Code terminal instance.');
		}

		const existing = [...this.runtime.values()].find(session => session.terminal === terminal);
		if (existing) {
			if (options.label && options.label !== existing.label) {
				existing.label = options.label;
			}
			if (options.reveal !== false) {
				const owner = agentTabForPane(this.tabsState, existing.id);
				if (owner) {
					this.mutateTabs(state => focusAgentPane(state, owner.id, existing.id));
				}
				await this.show(options.preserveFocus);
			} else {
				this.render();
			}
			return this.snapshotSession(existing);
		}

		const choice = baseHalfAgentSessionChoiceForKind('terminal');
		const label = options.label ?? terminal.title ?? choice.label;
		const shouldReveal = options.reveal !== false;
		const session = this.createRuntimeSession(choice.kind, label, choice.description);
		this.openPaneInNewTab(session.id, shouldReveal);
		if (shouldReveal) {
			await this.show(options.preserveFocus);
		}

		try {
			await this.attachTerminalToSession(session, terminal, undefined, shouldReveal && options.preserveFocus !== true);
		} catch (error) {
			this.markSessionFailed(session, error);
		}

		return this.snapshotSession(session);
	}

	async revealTerminalSession(terminal: unknown, options: IBaseHalfAdoptAgentTerminalOptions = {}): Promise<IBaseHalfAgentAreaSession | undefined> {
		if (!this.isTerminalInstance(terminal)) {
			return undefined;
		}

		this.setActiveTerminalForVsCodeCompatibility(terminal);
		return this.adoptTerminalSession(terminal, {
			...options,
			label: options.label ?? terminal.title,
			reveal: true
		});
	}

	hideTerminalSession(terminal: unknown): void {
		if (!this.isTerminalInstance(terminal)) {
			return;
		}

		const session = [...this.runtime.values()].find(session => session.terminal === terminal);
		if (session && session.id === this.activeSessionId) {
			this.hide();
		}
	}

	registerExtensionAgentProvider(kind: BaseHalfExtensionAgentSessionKind, provider: IBaseHalfExtensionAgentProvider): IDisposable {
		this.extensionProviders.set(kind, provider);
		return toDisposable(() => {
			if (this.extensionProviders.get(kind) === provider) {
				this.extensionProviders.delete(kind);
			}
		});
	}

	// ── Session lifecycle ──────────────────────────────────────────────────────

	async focusSession(id: string): Promise<void> {
		const owner = agentTabForPane(this.tabsState, id);
		if (!owner) {
			return;
		}

		this.mutateTabs(state => focusAgentPane(state, owner.id, id));
		await this.show(false);
	}

	async restartSession(id: string): Promise<void> {
		const session = this.runtime.get(id);
		if (!session || session.closing || session.state === 'disposed') {
			return;
		}

		if (session.terminal && !session.terminal.isDisposed) {
			session.state = 'starting';
			session.detail = 'Restarting';
			this.clearSessionStatePanel(session);
			this.render();
			session.terminal.relaunch();
			await this.focusSession(session.id);
			return;
		}

		if (session.kind === 'extension-codex' || session.kind === 'extension-claude') {
			await this.initializeExtensionPane(session);
			await this.focusSession(session.id);
			return;
		}

		// A terminal-backed pane whose terminal never launched (or was disposed):
		// start a fresh terminal into the same pane.
		session.state = 'starting';
		session.detail = 'Restarting';
		this.clearSessionStatePanel(session);
		this.render();
		const choice = baseHalfAgentSessionChoiceForKind(session.kind);
		await this.initializeTerminalPane(session, { label: session.label, command: choice.terminalCommand });
		await this.focusSession(session.id);
	}

	async killSession(id: string): Promise<void> {
		const session = this.runtime.get(id);
		if (!session || session.closing) {
			return;
		}

		session.closing = true;
		this.render();
		if (session.terminal && !session.terminal.isDisposed) {
			session.terminal.dispose(TerminalExitReason.User);
			if (!session.terminal.isDisposed) {
				session.closing = false;
				this.render();
			}
			return;
		}

		this.destroySession(id);
		this.mutateTabs(state => removeAgentPane(state, id));
		this.render();
	}

	async closeSession(id: string): Promise<void> {
		this.softClosePane(id);
	}

	// ── Tabs + panes (Ghostty-style layout) ────────────────────────────────────

	async newTab(): Promise<IBaseHalfAgentAreaSession | undefined> {
		return this.createSession(this.defaultSessionKind());
	}

	async splitActivePane(dir: BaseHalfSplitDir): Promise<IBaseHalfAgentAreaSession | undefined> {
		if (!activeAgentTab(this.tabsState)) {
			return this.createSession('terminal');
		}

		const choice = baseHalfAgentSessionChoiceForKind('terminal');
		const session = this.createRuntimeSession('terminal', choice.label, choice.description);
		this.mutateTabs(state => splitActiveAgentPane(state, dir, session.id, this.mintId('split')));
		await this.show(true);
		await this.initializeTerminalPane(session, {});
		return this.snapshotSession(session);
	}

	closeActivePane(): void {
		const tab = activeAgentTab(this.tabsState);
		if (tab) {
			this.softClosePane(tab.activePaneId);
		}
	}

	closeActiveTab(): void {
		const tab = activeAgentTab(this.tabsState);
		if (tab) {
			this.softCloseTab(tab.id);
		}
	}

	async focusPaneDirection(dir: BaseHalfFocusDir): Promise<void> {
		if (this.mutateTabs(state => gotoAgentPaneDir(state, dir))) {
			await this.focusActivePane();
		}
	}

	async cyclePaneFocus(delta: 1 | -1): Promise<void> {
		if (this.mutateTabs(state => gotoAgentPaneRing(state, delta))) {
			await this.focusActivePane();
		}
	}

	async cycleTab(delta: 1 | -1): Promise<void> {
		if (this.mutateTabs(state => switchAgentTab(state, delta))) {
			await this.focusActivePane();
		}
	}

	async gotoTab(index: number): Promise<void> {
		if (this.mutateTabs(state => gotoAgentTab(state, index))) {
			await this.focusActivePane();
		}
	}

	async gotoLastTab(): Promise<void> {
		if (this.mutateTabs(state => lastAgentTab(state))) {
			await this.focusActivePane();
		}
	}

	resizeActivePane(dir: BaseHalfFocusDir): void {
		if (this.mutateTabs(state => resizeActiveAgentPane(state, dir))) {
			this.showResizeHud();
		}
	}

	equalizePanes(): void {
		if (this.mutateTabs(state => equalizeAgentPanes(state))) {
			this.showResizeHud();
		}
	}

	togglePaneZoom(): void {
		this.mutateTabs(state => toggleAgentPaneZoom(state));
	}

	// ── Soft close + undo ──────────────────────────────────────────────────────

	private softClosePane(paneId: string): void {
		const owner = agentTabForPane(this.tabsState, paneId);
		if (!owner) {
			return;
		}
		const key = this.mintId('close');
		if (this.mutateTabs(state => closeActiveAgentPane(selectAgentTab(state, owner.id), key, paneId))) {
			this.startGraceTimer(key);
		}
	}

	private softCloseTab(tabId: string): void {
		const key = this.mintId('close');
		if (this.mutateTabs(state => closeAgentTab(state, tabId, key))) {
			this.startGraceTimer(key);
		}
	}

	private softCloseOtherTabs(tabId: string): void {
		const keys: string[] = [];
		const mint = () => {
			const key = this.mintId('close');
			keys.push(key);
			return key;
		};
		if (this.mutateTabs(state => closeOtherAgentTabs(state, tabId, mint))) {
			keys.forEach(key => this.startGraceTimer(key));
		}
	}

	private softCloseTabsToRight(tabId: string): void {
		const keys: string[] = [];
		const mint = () => {
			const key = this.mintId('close');
			keys.push(key);
			return key;
		};
		if (this.mutateTabs(state => closeAgentTabsToRight(state, tabId, mint))) {
			keys.forEach(key => this.startGraceTimer(key));
		}
	}

	private startGraceTimer(key: string): void {
		this.cancelGraceTimer(key);
		this.graceTimers.set(key, mainWindow.setTimeout(() => this.finalizeClose(key), CLOSE_GRACE_MS));
	}

	private cancelGraceTimer(key: string): void {
		const timer = this.graceTimers.get(key);
		if (timer !== undefined) {
			mainWindow.clearTimeout(timer);
			this.graceTimers.delete(key);
		}
	}

	private undoClose(key: string): void {
		this.cancelGraceTimer(key);
		if (this.mutateTabs(state => undoAgentClose(state, key, () => this.mintId('tab')))) {
			void this.focusActivePane();
		}
	}

	private finalizeClose(key: string): void {
		this.cancelGraceTimer(key);
		const { state, entry } = finalizeAgentClose(this.tabsState, key);
		this.tabsState = state;
		if (entry) {
			for (const paneId of closingEntryPaneIds(entry)) {
				this.destroySession(paneId);
			}
		}
		this.render();
	}

	private destroySession(paneId: string): void {
		const session = this.runtime.get(paneId);
		if (!session) {
			return;
		}
		this.runtime.delete(paneId);
		this.disposeRuntimeSession(session, true);
	}

	// ── Terminal + extension pane wiring ───────────────────────────────────────

	private async createExtensionAgentSession(kind: BaseHalfExtensionAgentSessionKind): Promise<IBaseHalfAgentAreaSession> {
		const choice = baseHalfAgentSessionChoiceForKind(kind);
		const existing = [...this.runtime.values()].find(session => session.kind === kind && !session.closing && session.state !== 'disposed');
		if (existing && agentTabForPane(this.tabsState, existing.id)) {
			if (existing.state === 'failed' || existing.state === 'unavailable') {
				await this.initializeExtensionPane(existing);
			}
			await this.focusSession(existing.id);
			return this.snapshotSession(existing);
		}

		const session = this.createRuntimeSession(kind, choice.label, choice.description);
		this.openPaneInNewTab(session.id, true);
		await this.show(true);
		await this.initializeExtensionPane(session);
		return this.snapshotSession(session);
	}

	/**
	 * A canonical extension container briefly opened and closed again (its pane
	 * steals the single webview instance while visible). Cycle visibility on the
	 * Agent Area's ready extension panes so their view panes re-claim.
	 */
	private reassertExtensionClaims(): void {
		for (const session of this.runtime.values()) {
			if (session.extensionSetVisible && session.state === 'ready' && session.host.classList.contains('active')) {
				session.extensionSetVisible(false);
				session.extensionSetVisible(true);
				session.extensionLayout?.();
			}
		}
	}

	private async initializeExtensionPane(session: IBaseHalfRuntimeAgentSession): Promise<void> {
		const kind = session.kind as BaseHalfExtensionAgentSessionKind;
		const choice = baseHalfAgentSessionChoiceForKind(kind);

		if (session.extensionDispose) {
			const dispose = session.extensionDispose;
			session.extensionDispose = undefined;
			session.extensionSetVisible = undefined;
			session.extensionLayout = undefined;
			session.extensionFocus = undefined;
			await dispose();
		}
		session.state = 'starting';
		session.detail = undefined;
		this.clearSessionStatePanel(session);
		this.render();

		// Curated agent extensions declare they do not support untrusted
		// workspaces, so in Restricted Mode they never register and the session
		// would fail with a confusing "not installed" message. Gate on trust and
		// offer the concrete next step instead.
		if (!this.workspaceTrustManagementService.isWorkspaceTrusted()) {
			session.state = 'unavailable';
			session.detail = `${choice.label} needs a trusted workspace. Trust this folder to let curated agent extensions run.`;
			this.renderSessionStatePanel(session, {
				label: 'Trust Workspace',
				run: async () => {
					const trusted = await this.workspaceTrustRequestService.requestWorkspaceTrust({
						message: `${choice.label} runs as a workspace extension and requires you to trust this folder.`
					});
					if (trusted) {
						await this.initializeExtensionPane(session);
					}
				}
			});
			this.render();
			await this.focusSession(session.id);
			return;
		}

		const provider = this.extensionProviders.get(kind);
		if (!provider) {
			session.state = 'unavailable';
			const extensionClause = choice.extensionId ? ` Install or enable ${choice.extensionId}` : ' Enable the curated extension';
			const slotClause = choice.requiresExtensionSlot ? ` and have it register ${choice.requiresExtensionSlot}` : '';
			session.detail = `${choice.label} is unavailable.${extensionClause}${slotClause}; stock VS Code Chat/Copilot/Sessions UI stays hidden in BaseHalf.`;
			this.renderSessionStatePanel(session);
			this.render();
			return;
		}

		try {
			const result = await provider.createSession(kind, session.surface);
			session.label = result.label ?? session.label;
			session.description = result.description ?? session.description;
			session.detail = result.detail;
			session.extensionSetVisible = result.setVisible;
			session.extensionLayout = result.layout;
			session.extensionFocus = result.focus;
			session.extensionDispose = result.dispose;
			session.state = 'ready';
			this.render();
			await this.focusActivePane();
		} catch (error) {
			if (error instanceof BaseHalfExtensionAgentUnavailableError) {
				session.state = 'unavailable';
				session.detail = error.message;
				this.renderSessionStatePanel(session);
				this.render();
			} else {
				this.markSessionFailed(session, error);
			}
		}
	}

	private async initializeTerminalPane(session: IBaseHalfRuntimeAgentSession, options: IBaseHalfCreateAgentTerminalOptions): Promise<void> {
		try {
			const terminalOptions = this.createTerminalOptions(session.kind, session.label, options);
			const terminal = await this.terminalService.createTerminal(terminalOptions);
			await this.attachTerminalToSession(session, terminal, options.command ?? baseHalfAgentSessionChoiceForKind(session.kind).terminalCommand);
		} catch (error) {
			this.markSessionFailed(session, error);
		}
	}

	private isTerminalInstance(candidate: unknown): candidate is ITerminalInstance {
		return isObject(candidate)
			&& typeof (candidate as Partial<ITerminalInstance>).attachToElement === 'function'
			&& typeof (candidate as Partial<ITerminalInstance>).setVisible === 'function'
			&& typeof (candidate as Partial<ITerminalInstance>).focusWhenReady === 'function';
	}

	private async attachTerminalToSession(session: IBaseHalfRuntimeAgentSession, terminal: ITerminalInstance, command?: string, focus = true): Promise<void> {
		session.terminal = terminal;
		session.disposables.add(terminal.onDisposed(() => this.handleTerminalDisposed(session)));
		session.disposables.add(terminal.onTitleChanged(instance => {
			if (instance.title && session.label !== instance.title) {
				session.label = instance.title;
				this.render();
			}
		}));
		session.disposables.add(terminal.onData(() => {
			this.mutateTabs(state => markAgentPaneActivity(state, session.id));
		}));
		session.disposables.add(terminal.onProcessIdReady(() => {
			this.clearSessionStatePanel(session);
			if (session.state === 'starting' || session.state === 'exited' || session.state === 'failed') {
				session.state = 'ready';
				session.detail = command ? `Running ${command}` : undefined;
				this.render();
			}
		}));
		session.disposables.add(terminal.onExit(exit => this.markTerminalProcessExited(session, exit)));

		terminal.attachToElement(session.surface);
		this.setActiveTerminalForVsCodeCompatibility(terminal);
		if (!command) {
			session.state = 'ready';
			session.detail = undefined;
		}
		this.render();
		if (focus) {
			await this.focusActivePane();
		}
	}

	private handleTerminalDisposed(session: IBaseHalfRuntimeAgentSession): void {
		if (!this.runtime.has(session.id)) {
			return; // already finalized/destroyed
		}
		this.runtime.delete(session.id);
		this.disposeRuntimeSession(session, false);
		this.mutateTabs(state => removeAgentPane(state, session.id));
		this.render();
	}

	private createRuntimeSession(kind: BaseHalfAgentSessionKind, label: string, description: string): IBaseHalfRuntimeAgentSession {
		const host = append(this.body, $('.basehalf-agent-area-session'));
		const session: IBaseHalfRuntimeAgentSession = {
			id: this.mintId('agent'),
			kind,
			label,
			description,
			state: 'starting',
			host,
			surface: append(host, $('.basehalf-agent-session-surface')),
			statePanel: append(host, $('.basehalf-agent-session-state')),
			dimOverlay: append(host, $('.basehalf-agent-pane-dim')),
			grabHandle: append(host, $('.basehalf-agent-pane-handle')),
			dropZone: append(host, $('.basehalf-agent-pane-dropzone')),
			dropPreview: $('.basehalf-agent-pane-drop-preview'),
			disposables: new DisposableStore()
		};
		session.host.setAttribute('role', 'tabpanel');
		session.host.setAttribute('aria-label', label);
		session.host.classList.add(kind === 'extension-codex' || kind === 'extension-claude' ? 'kind-extension' : 'kind-terminal');
		session.dimOverlay.setAttribute('aria-hidden', 'true');
		session.dropZone.appendChild(session.dropPreview);
		session.disposables.add(toDisposable(() => session.host.remove()));

		session.host.addEventListener('mousedown', () => {
			const owner = agentTabForPane(this.tabsState, session.id);
			if (owner) {
				this.mutateTabs(state => focusAgentPane(state, owner.id, session.id));
			}
		}, true);

		this.wirePaneDrag(session);
		this.runtime.set(session.id, session);
		return session;
	}

	private wirePaneDrag(session: IBaseHalfRuntimeAgentSession): void {
		const handle = session.grabHandle;
		handle.title = 'Drag to move this pane';
		handle.setAttribute('aria-label', 'Move pane');
		handle.draggable = true;
		append(handle, $('span.basehalf-agent-pane-handle-dots')).textContent = '⋯';
		handle.addEventListener('dragstart', e => {
			e.dataTransfer?.setData('application/x-basehalf-agent-pane', session.id);
			if (e.dataTransfer) {
				e.dataTransfer.effectAllowed = 'move';
			}
			this.paneDragId = session.id;
			this.render();
		});
		handle.addEventListener('dragend', () => {
			this.paneDragId = undefined;
			this.render();
		});

		const zone = session.dropZone;
		let edge: BaseHalfFocusDir | undefined;
		zone.addEventListener('dragover', e => {
			if (!this.paneDragId || this.paneDragId === session.id) {
				return;
			}
			e.preventDefault();
			if (e.dataTransfer) {
				e.dataTransfer.dropEffect = 'move';
			}
			const box = zone.getBoundingClientRect();
			if (box.width === 0 || box.height === 0) {
				return;
			}
			edge = dropEdge((e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height);
			session.dropPreview.className = `basehalf-agent-pane-drop-preview edge-${edge}`;
			session.dropPreview.classList.add('visible');
		});
		zone.addEventListener('dragleave', e => {
			if (!zone.contains(e.relatedTarget as Node | null)) {
				edge = undefined;
				session.dropPreview.classList.remove('visible');
			}
		});
		zone.addEventListener('drop', e => {
			e.preventDefault();
			const dragged = this.paneDragId;
			session.dropPreview.classList.remove('visible');
			if (dragged && edge) {
				this.mutateTabs(state => moveAgentPane(state, dragged, edge!, session.id, this.mintId('split')));
				void this.focusActivePane();
			}
			edge = undefined;
			this.paneDragId = undefined;
			this.render();
		});
	}

	private openPaneInNewTab(paneId: string, activate: boolean): void {
		const previousActive = this.tabsState.activeTabId;
		this.mutateTabs(state => {
			let next = createAgentTab(state, this.mintId('tab'), paneId);
			if (!activate && previousActive) {
				next = selectAgentTab(next, previousActive);
			}
			return next;
		});
	}

	private disposeRuntimeSession(session: IBaseHalfRuntimeAgentSession, killTerminal: boolean): void {
		if (killTerminal && session.terminal && !session.terminal.isDisposed) {
			void this.terminalService.safeDisposeTerminal(session.terminal);
		}
		session.state = 'disposed';
		session.disposables.dispose();
		void session.extensionDispose?.();
		session.extensionDispose = undefined;
	}

	// ── Rendering ──────────────────────────────────────────────────────────────

	private mutateTabs(fn: (state: IBaseHalfAgentTabsState) => IBaseHalfAgentTabsState): boolean {
		const next = fn(this.tabsState);
		if (next === this.tabsState) {
			return false;
		}
		this.tabsState = next;
		this.render();
		return true;
	}

	private render(): void {
		this.renderActiveSurfaceKind();
		this.renderTabStrip();
		this.renderPanes();
		this.renderDividers();
		this.renderToasts();
		this.layoutVisiblePanes();
		this._onDidChangeSessions.fire(this.sessions);
	}

	private renderActiveSurfaceKind(): void {
		const activePaneId = activeAgentTab(this.tabsState)?.activePaneId;
		const activeKind = activePaneId ? this.runtime.get(activePaneId)?.kind : undefined;
		const terminal = activeKind === 'terminal' || activeKind === 'tui-codex' || activeKind === 'tui-claude';
		const extension = activeKind === 'extension-codex' || activeKind === 'extension-claude';
		this.root.classList.toggle('active-kind-terminal', terminal);
		this.root.classList.toggle('active-kind-extension', extension);
		this.root.classList.toggle('active-kind-empty', !terminal && !extension);
	}

	private renderTabStrip(): void {
		const state = this.tabsState;
		clearNode(this.tabStrip);
		this.tabsBar.classList.toggle('empty', state.tabs.length === 0);
		this.empty.classList.toggle('visible', state.tabs.length === 0);
		this.zoomResetButton.classList.toggle('visible', !!activeAgentTab(state)?.zoomedPaneId);

		state.tabs.forEach((tab, index) => this.tabStrip.appendChild(this.renderTab(tab, index)));
		this.updateTabDensity();
	}

	/**
	 * When tabs get narrow, the label is what identifies a session — the ⌘N
	 * shortcut badge and state text yield entirely instead of crushing it.
	 */
	private updateTabDensity(): void {
		const tabs = this.tabsState.tabs.length;
		const compact = tabs > 0 && this.tabStrip.clientWidth > 0 && this.tabStrip.clientWidth / tabs < 96;
		this.tabsBar.classList.toggle('compact', compact);
	}

	private tabTitle(tab: IBaseHalfAgentTab): string {
		return tab.titleOverride ?? this.runtime.get(tab.activePaneId)?.label ?? '';
	}

	private renderTab(tab: IBaseHalfAgentTab, index: number): HTMLElement {
		const state = this.tabsState;
		const active = tab.id === state.activeTabId;
		const activePane = this.runtime.get(tab.activePaneId);
		const title = this.tabTitle(tab);
		const attention = activePane?.state === 'unavailable' || activePane?.state === 'failed';

		const el = $('.basehalf-agent-tab');
		el.classList.toggle('active', active);
		el.classList.toggle('unavailable', attention);
		el.classList.toggle('drop-before', this.tabDropIndex === index);
		el.classList.toggle('drop-after', this.tabDropIndex === state.tabs.length && index === state.tabs.length - 1);
		el.setAttribute('role', 'tab');
		el.setAttribute('aria-selected', String(active));
		el.setAttribute('aria-label', title ? `Tab ${index + 1}: ${title}` : `Tab ${index + 1}`);
		el.title = activePane?.detail ? `${title || activePane.label} - ${activePane.detail}` : title;

		const editing = this.editingTabId === tab.id;
		el.draggable = !editing;

		el.addEventListener('mousedown', e => {
			if (editing) {
				return;
			}
			if (e.button === 1) {
				e.preventDefault();
				this.softCloseTab(tab.id);
				return;
			}
			if (e.button === 0) {
				this.mutateTabs(s => selectAgentTab(s, tab.id));
				void this.focusActivePane();
			}
		});
		el.addEventListener('dblclick', () => {
			this.editingTabId = tab.id;
			this.editingDraft = tab.titleOverride ?? '';
			this.render();
		});
		el.addEventListener('contextmenu', e => {
			e.preventDefault();
			e.stopPropagation();
			if (!editing) {
				this.showTabContextMenu(tab, e);
			}
		});
		el.addEventListener('dragstart', e => {
			e.dataTransfer?.setData('application/x-basehalf-agent-tab', tab.id);
			if (e.dataTransfer) {
				e.dataTransfer.effectAllowed = 'move';
			}
			this.tabDragId = tab.id;
		});
		el.addEventListener('dragend', () => {
			this.tabDragId = undefined;
			this.setTabDropIndex(undefined);
		});
		el.addEventListener('dragover', e => {
			if (!this.tabDragId) {
				return;
			}
			e.preventDefault();
			const box = el.getBoundingClientRect();
			const after = e.clientX - box.left > box.width / 2;
			this.setTabDropIndex(index + (after ? 1 : 0));
		});
		el.addEventListener('drop', e => {
			if (!this.tabDragId) {
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			const box = el.getBoundingClientRect();
			const after = e.clientX - box.left > box.width / 2;
			this.dropDraggedTabAt(index + (after ? 1 : 0));
		});

		if (editing) {
			const input = append(el, $('input.basehalf-agent-tab-rename')) as HTMLInputElement;
			input.value = this.editingDraft;
			input.placeholder = 'Name this tab…';
			input.addEventListener('input', () => {
				this.editingDraft = input.value;
			});
			input.addEventListener('keydown', e => {
				if (e.key === 'Enter') {
					this.commitTabRename(tab.id, input.value);
				} else if (e.key === 'Escape') {
					this.editingTabId = undefined;
					this.render();
				}
				e.stopPropagation();
			});
			input.addEventListener('blur', () => {
				if (this.editingTabId === tab.id) {
					this.commitTabRename(tab.id, input.value);
				}
			});
			input.addEventListener('mousedown', e => e.stopPropagation());
			mainWindow.setTimeout(() => input.focus(), 0);
			return el;
		}

		const labelWrap = append(el, $('span.basehalf-agent-tab-labelwrap'));
		const shortcut = append(labelWrap, $('span.basehalf-agent-tab-shortcut'));
		shortcut.setAttribute('aria-hidden', 'true');
		shortcut.textContent = index < 9 ? `${isMacintosh ? '⌘' : 'Ctrl+'}${index === 8 ? 9 : index + 1}` : '';
		if (title) {
			const label = append(labelWrap, $('span.basehalf-agent-tab-label'));
			label.textContent = title;
		}
		if (activePane && activePane.state !== 'ready') {
			const stateLabel = append(labelWrap, $('span.basehalf-agent-tab-state'));
			stateLabel.textContent = this.stateLabel(activePane.state);
		}

		const indicator = append(el, $('span.basehalf-agent-tab-indicator'));
		const close = append(indicator, $('button.basehalf-agent-tab-close.codicon.codicon-close')) as HTMLButtonElement;
		close.type = 'button';
		close.title = 'Close Tab';
		close.setAttribute('aria-label', `Close ${title || 'tab'}`);
		close.addEventListener('mousedown', e => {
			e.preventDefault();
			e.stopPropagation();
			this.softCloseTab(tab.id);
		});
		const dot = append(indicator, $('span.basehalf-agent-tab-activity'));
		dot.setAttribute('aria-hidden', 'true');
		indicator.classList.toggle('has-activity', state.activity.includes(tab.id));

		return el;
	}

	private commitTabRename(tabId: string, title: string): void {
		this.editingTabId = undefined;
		if (!this.mutateTabs(state => setAgentTabTitle(state, tabId, title))) {
			this.render();
		}
	}

	private setTabDropIndex(index: number | undefined): void {
		if (this.tabDropIndex !== index) {
			this.tabDropIndex = index;
			this.renderTabStrip();
		}
	}

	private dropDraggedTabAt(index: number): void {
		const dragged = this.tabDragId;
		this.tabDragId = undefined;
		this.tabDropIndex = undefined;
		if (dragged) {
			if (!this.mutateTabs(state => reorderAgentTab(state, dragged, index))) {
				this.renderTabStrip();
			}
		} else {
			this.renderTabStrip();
		}
	}

	private showTabContextMenu(tab: IBaseHalfAgentTab, event: MouseEvent): void {
		const state = this.tabsState;
		const index = state.tabs.findIndex(t => t.id === tab.id);
		const activePane = this.runtime.get(tab.activePaneId);
		this.contextMenuService.showContextMenu({
			getAnchor: () => ({ x: event.clientX, y: event.clientY }),
			getActions: () => [
				toAction({ id: 'basehalf.agentTab.new', label: 'New Agent Tab', run: () => void this.newTab() }),
				toAction({
					id: 'basehalf.agentTab.splitRight', label: 'Split Pane Right', run: () => {
						this.mutateTabs(s => selectAgentTab(s, tab.id));
						void this.splitActivePane('right');
					}
				}),
				toAction({
					id: 'basehalf.agentTab.splitDown', label: 'Split Pane Down', run: () => {
						this.mutateTabs(s => selectAgentTab(s, tab.id));
						void this.splitActivePane('down');
					}
				}),
				new Separator(),
				toAction({
					id: 'basehalf.agentTab.rename', label: 'Rename…', run: () => {
						this.editingTabId = tab.id;
						this.editingDraft = tab.titleOverride ?? '';
						this.render();
					}
				}),
				new Separator(),
				toAction({ id: 'basehalf.agentTab.restartPane', label: 'Restart Pane', enabled: !!activePane, run: () => void this.restartSession(tab.activePaneId) }),
				toAction({ id: 'basehalf.agentTab.killPane', label: 'Kill Pane', enabled: !!activePane, run: () => void this.killSession(tab.activePaneId) }),
				new Separator(),
				toAction({ id: 'basehalf.agentTab.close', label: 'Close Tab', run: () => this.softCloseTab(tab.id) }),
				toAction({ id: 'basehalf.agentTab.closeOthers', label: 'Close Other Tabs', enabled: state.tabs.length > 1, run: () => this.softCloseOtherTabs(tab.id) }),
				toAction({ id: 'basehalf.agentTab.closeRight', label: 'Close Tabs to the Right', enabled: index >= 0 && index < state.tabs.length - 1, run: () => this.softCloseTabsToRight(tab.id) })
			]
		});
	}

	private renderPanes(): void {
		const state = this.tabsState;
		const activeTab = activeAgentTab(state);
		const rects = activeTab ? leafRects(activeTab.tree) : new Map<string, { x: number; y: number; w: number; h: number }>();
		const zoomedPaneId = activeTab?.zoomedPaneId ?? null;
		const multiPane = !!activeTab && activeTab.tree.type === 'split';

		for (const session of this.runtime.values()) {
			const owner = agentTabForPane(state, session.id);
			const inActiveTab = !!owner && owner.id === state.activeTabId;
			const isZoomed = inActiveTab && zoomedPaneId === session.id;
			const rect = inActiveTab ? rects.get(session.id) : undefined;
			const visible = this.visible && inActiveTab && (!zoomedPaneId || isZoomed) && (!!rect || isZoomed);

			session.host.classList.toggle('active', visible);
			session.host.setAttribute('aria-hidden', String(!visible));
			if (isZoomed || !rect) {
				session.host.style.left = '0';
				session.host.style.top = '0';
				session.host.style.width = '100%';
				session.host.style.height = '100%';
			} else {
				session.host.style.left = `${rect.x * 100}%`;
				session.host.style.top = `${rect.y * 100}%`;
				session.host.style.width = `${rect.w * 100}%`;
				session.host.style.height = `${rect.h * 100}%`;
			}

			const isActivePane = inActiveTab && activeTab?.activePaneId === session.id;
			const dim = visible && multiPane && !zoomedPaneId && !isActivePane;
			session.host.classList.toggle('dimmed', dim);
			session.host.classList.toggle('pane-split', visible && multiPane && !zoomedPaneId);
			session.host.classList.toggle('drop-target', visible && !!this.paneDragId && this.paneDragId !== session.id);
			if (!this.paneDragId) {
				session.dropPreview.classList.remove('visible');
			}

			session.terminal?.setVisible(visible);
			session.extensionSetVisible?.(visible);
			if (visible && (session.state === 'unavailable' || session.state === 'failed')) {
				this.renderSessionStatePanel(session);
			}
		}

		this.zoomBadge.classList.toggle('visible', this.visible && !!zoomedPaneId);
	}

	private renderDividers(): void {
		clearNode(this.dividersLayer);
		const activeTab = activeAgentTab(this.tabsState);
		if (!this.visible || !activeTab || activeTab.zoomedPaneId || activeTab.tree.type === 'leaf') {
			return;
		}

		for (const divider of splitDividers(activeTab.tree)) {
			const row = divider.dir === 'row';
			const el = append(this.dividersLayer, $(`.basehalf-agent-divider.${row ? 'row' : 'column'}`));
			if (row) {
				el.style.left = `${divider.rect.x * 100}%`;
			} else {
				el.style.top = `${divider.rect.y * 100}%`;
			}
			append(el, $('.basehalf-agent-divider-line'));
			el.addEventListener('dblclick', () => {
				this.mutateTabs(state => setAgentSplitFraction(state, divider.splitId, 0.5));
				this.showResizeHud();
			});
			el.addEventListener('mousedown', e => {
				e.preventDefault();
				e.stopPropagation();
				el.classList.add('dragging');
				const doc = mainWindow.document;
				const onMove = (ev: MouseEvent) => {
					const box = this.body.getBoundingClientRect();
					if (box.width === 0 || box.height === 0) {
						return;
					}
					const bounds = divider.bounds;
					const areaFraction = row
						? (ev.clientX - box.left) / box.width
						: (ev.clientY - box.top) / box.height;
					const span = row ? bounds.w : bounds.h;
					const origin = row ? bounds.x : bounds.y;
					let local = span > 0 ? (areaFraction - origin) / span : 0.5;
					const splitPx = span * (row ? box.width : box.height);
					const floor = splitPx > 0 ? Math.min(0.45, DIVIDER_MIN_PANE_PX / splitPx) : 0.1;
					local = Math.max(floor, Math.min(1 - floor, local));
					this.mutateTabs(state => setAgentSplitFraction(state, divider.splitId, local));
					this.showResizeHud();
				};
				const onUp = () => {
					doc.removeEventListener('mousemove', onMove);
					doc.removeEventListener('mouseup', onUp);
					doc.body.style.cursor = '';
					doc.body.style.userSelect = '';
				};
				doc.addEventListener('mousemove', onMove);
				doc.addEventListener('mouseup', onUp);
				doc.body.style.cursor = row ? 'col-resize' : 'row-resize';
				doc.body.style.userSelect = 'none';
			});
		}
	}

	private renderToasts(): void {
		clearNode(this.toasts);
		for (const entry of this.tabsState.closing) {
			const name = entry.kind === 'tab'
				? (entry.tab.titleOverride ?? this.runtime.get(entry.tab.activePaneId)?.label ?? 'Agent')
				: (this.runtime.get(entry.paneId)?.label ?? 'Agent');
			const toast = append(this.toasts, $('.basehalf-agent-toast'));
			const text = append(toast, $('span.basehalf-agent-toast-text'));
			text.textContent = `Closed ${entry.kind === 'tab' ? 'tab' : 'pane'} “${name}”`;
			const undo = append(toast, $('button.basehalf-agent-toast-undo')) as HTMLButtonElement;
			undo.type = 'button';
			undo.textContent = 'Undo';
			undo.addEventListener('click', () => this.undoClose(entry.key));
			const dismiss = append(toast, $('button.basehalf-agent-toast-dismiss.codicon.codicon-close')) as HTMLButtonElement;
			dismiss.type = 'button';
			dismiss.setAttribute('aria-label', 'Dismiss');
			dismiss.addEventListener('click', () => this.finalizeClose(entry.key));
		}
	}

	private showResizeHud(): void {
		const activeTab = activeAgentTab(this.tabsState);
		const session = activeTab ? this.runtime.get(activeTab.activePaneId) : undefined;
		if (!activeTab || !session?.terminal || activeTab.tree.type === 'leaf') {
			return;
		}
		const rect = leafRects(activeTab.tree).get(session.id);
		if (!rect) {
			return;
		}
		this.hud.textContent = `${session.terminal.cols} × ${session.terminal.rows}`;
		this.hud.style.left = `${(rect.x + rect.w / 2) * 100}%`;
		this.hud.style.top = `${(rect.y + rect.h / 2) * 100}%`;
		this.hud.classList.add('visible');
		if (this.hudTimer !== undefined) {
			mainWindow.clearTimeout(this.hudTimer);
		}
		this.hudTimer = mainWindow.setTimeout(() => {
			this.hud.classList.remove('visible');
			this.hudTimer = undefined;
		}, RESIZE_HUD_MS);
	}

	async focusActivePane(): Promise<void> {
		const activeTab = activeAgentTab(this.tabsState);
		const session = activeTab ? this.runtime.get(activeTab.activePaneId) : undefined;
		if (!this.visible || !session) {
			return;
		}

		if (session.terminal) {
			this.setActiveTerminalForVsCodeCompatibility(session.terminal);
			session.terminal.setVisible(true);
			this.layoutVisiblePanes();
			await session.terminal.focusWhenReady(true);
			return;
		}

		if (session.extensionFocus) {
			this.layoutVisiblePanes();
			await session.extensionFocus();
			return;
		}

		const focusable = session.statePanel.querySelector<HTMLElement>('button');
		focusable?.focus();
	}

	private layoutVisiblePanes(): void {
		if (!this.visible) {
			return;
		}
		this.updateTabDensity();
		for (const session of this.runtime.values()) {
			if (!session.host.classList.contains('active')) {
				continue;
			}
			if (session.terminal) {
				const width = Math.max(1, Math.floor(session.surface.clientWidth));
				const height = Math.max(1, Math.floor(session.surface.clientHeight));
				session.terminal.layout({ width, height });
			}
			session.extensionLayout?.();
		}
	}

	/**
	 * The empty state doubles as the session picker: the five first-class
	 * choices rendered as labeled buttons, so a fresh Agent Area explains
	 * itself instead of relying on ambiguous header icons.
	 */
	private buildEmptyStatePicker(): void {
		clearNode(this.empty);
		const emptyTitle = append(this.empty, $('.basehalf-agent-empty-title'));
		emptyTitle.textContent = 'Start an agent session';
		const choices = append(this.empty, $('.basehalf-agent-empty-choices'));
		for (const choice of BASEHALF_VISIBLE_AGENT_SESSION_CHOICES) {
			const button = append(choices, $('button.basehalf-agent-empty-choice')) as HTMLButtonElement;
			button.type = 'button';
			button.title = choice.description;
			button.setAttribute('aria-label', choice.label);
			const icon = append(button, $(`span.codicon.${this.choiceIconClass(choice.kind)}`));
			icon.setAttribute('aria-hidden', 'true');
			const text = append(button, $('.basehalf-agent-empty-choice-text'));
			const label = append(text, $('.basehalf-agent-empty-choice-label'));
			label.textContent = choice.label;
			const description = append(text, $('.basehalf-agent-empty-choice-desc'));
			description.textContent = choice.description;
			button.addEventListener('click', () => {
				void this.createSession(choice.kind);
			});
		}
	}

	private showNewSessionMenu(anchor: HTMLElement): void {
		this.contextMenuService.showContextMenu({
			getAnchor: () => anchor,
			getActions: () => BASEHALF_VISIBLE_AGENT_SESSION_CHOICES.map(choice => toAction({
				id: `basehalf.agentArea.menu.${choice.kind}`,
				label: choice.label,
				tooltip: choice.description,
				run: () => void this.createSession(choice.kind)
			}))
		});
	}

	private renderSessionStatePanel(session: IBaseHalfRuntimeAgentSession, primaryAction?: { label: string; run: () => void | Promise<void> }): void {
		// The action is stored on the session so re-renders (layout, visibility)
		// keep it instead of falling back to the default Retry button.
		if (primaryAction) {
			session.statePrimaryAction = primaryAction;
		}
		const action = primaryAction ?? session.statePrimaryAction;
		clearNode(session.statePanel);
		session.host.classList.add('has-state');
		const icon = append(session.statePanel, $(`span.codicon.${this.choiceIconClass(session.kind)}`));
		icon.setAttribute('aria-hidden', 'true');
		const title = append(session.statePanel, $('.basehalf-agent-session-state-title'));
		title.textContent = session.label;
		const message = append(session.statePanel, $('.basehalf-agent-session-state-message'));
		message.textContent = session.detail ?? session.description;
		const actions = append(session.statePanel, $('.basehalf-agent-session-state-actions'));
		const button = append(actions, $('button.basehalf-agent-session-state-retry')) as HTMLButtonElement;
		button.type = 'button';
		if (action) {
			button.textContent = action.label;
			button.setAttribute('aria-label', action.label);
			button.addEventListener('click', () => {
				void action.run();
			});
			return;
		}
		button.textContent = session.state === 'unavailable' ? 'Retry' : 'Restart Session';
		button.setAttribute('aria-label', `Restart ${session.label}`);
		button.addEventListener('click', () => {
			void this.restartSession(session.id);
		});
	}

	private clearSessionStatePanel(session: IBaseHalfRuntimeAgentSession): void {
		session.host.classList.remove('has-state');
		session.statePrimaryAction = undefined;
		clearNode(session.statePanel);
	}

	// ── Terminal plumbing ──────────────────────────────────────────────────────

	private defaultSessionKind(): BaseHalfAgentSessionKind {
		return normalizeBaseHalfAgentDefaultSession(this.configurationService.getValue(BaseHalfSetting.AgentDefaultSession));
	}

	private createTerminalOptions(kind: BaseHalfAgentSessionKind, label: string, options: IBaseHalfCreateAgentTerminalOptions): ICreateTerminalOptions | undefined {
		const tuiConfig = baseHalfTuiSessionLaunchConfig(kind);
		if (tuiConfig) {
			return { config: { ...tuiConfig, name: label } };
		}

		const raw = this.asTerminalOptions(options.rawTerminalOptions);
		const terminalOptions: ICreateTerminalOptions = raw ? { ...raw } : {};
		terminalOptions.config = this.createAgentAreaTerminalConfig(label, terminalOptions.config);
		return terminalOptions;
	}

	private createAgentAreaTerminalConfig(label: string, config: ICreateTerminalOptions['config']): ICreateTerminalOptions['config'] {
		if (!config) {
			return { name: label, hideFromUser: true };
		}

		if ('extensionIdentifier' in config) {
			return config;
		}

		if ('profileName' in config && 'path' in config && config.path) {
			const profile = config;
			return {
				executable: profile.path,
				args: profile.args,
				env: profile.env,
				icon: profile.icon,
				color: profile.color,
				name: profile.overrideName ? profile.profileName : label,
				hideFromUser: true
			};
		}

		const shellLaunchConfig = config as IShellLaunchConfig;
		return {
			...shellLaunchConfig,
			name: shellLaunchConfig.name ?? label,
			hideFromUser: true
		};
	}

	private setActiveTerminalForVsCodeCompatibility(terminal: ITerminalInstance): void {
		if (!terminal.shellLaunchConfig.hideFromUser) {
			this.terminalService.setActiveInstance(terminal);
		}
	}

	private asTerminalOptions(raw: unknown): ICreateTerminalOptions | undefined {
		if (!isObject(raw)) {
			return undefined;
		}
		if ('target' in raw && 'currentTarget' in raw) {
			return undefined;
		}
		return raw as ICreateTerminalOptions;
	}

	private markTerminalProcessExited(session: IBaseHalfRuntimeAgentSession, exit: number | ITerminalLaunchError | undefined): void {
		if (session.closing || session.state === 'disposed') {
			return;
		}

		if (this.isTerminalLaunchError(exit)) {
			session.state = 'failed';
			const message = exit.code === undefined ? exit.message : `${exit.message} (${exit.code})`;
			const guidance = baseHalfTuiSessionLaunchFailureGuidance(session.kind);
			session.detail = guidance ? `${message}. ${guidance}` : message;
			this.renderSessionStatePanel(session);
			this.render();
			this.logService.error(`BaseHalf Agent Area terminal process failed: ${session.detail}`);
			this.notificationService.notify({
				severity: Severity.Error,
				message: `BaseHalf Agent Area terminal process failed for ${session.label}: ${session.detail}`
			});
			return;
		}

		session.state = 'exited';
		session.detail = exit === undefined || exit === 0
			? `${session.label} session ended`
			: `${session.label} exited with code ${exit}`;
		this.render();
	}

	private isTerminalLaunchError(candidate: unknown): candidate is ITerminalLaunchError {
		return isObject(candidate) && typeof (candidate as Partial<ITerminalLaunchError>).message === 'string';
	}

	private markSessionFailed(session: IBaseHalfRuntimeAgentSession, error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		session.state = 'failed';
		session.detail = message;
		this.renderSessionStatePanel(session);
		this.render();
		this.logService.error(error instanceof Error ? error : message);
		this.notificationService.notify({
			severity: Severity.Error,
			message: `BaseHalf Agent Area failed to start ${session.label}: ${message}`
		});
	}

	private snapshotSession(session: IBaseHalfRuntimeAgentSession): IBaseHalfAgentAreaSession {
		return {
			id: session.id,
			kind: session.kind,
			label: session.label,
			description: session.description,
			state: session.state,
			detail: session.detail
		};
	}

	private stateLabel(state: BaseHalfAgentSessionState): string {
		switch (state) {
			case 'starting':
				return 'Starting';
			case 'exited':
				return 'Exited';
			case 'unavailable':
				return 'Unavailable';
			case 'failed':
				return 'Failed';
			case 'disposed':
				return 'Closed';
			case 'ready':
				return '';
		}
	}

	private choiceIconClass(kind: BaseHalfAgentSessionKind): string {
		switch (kind) {
			case 'terminal':
			case 'tui-codex':
			case 'tui-claude':
				return 'codicon-terminal';
			case 'extension-codex':
			case 'extension-claude':
				return 'codicon-extensions';
		}
	}

	private mintId(prefix: string): string {
		return `basehalf-${prefix}-${BaseHalfAgentAreaService.nextId++}`;
	}
}

class BaseHalfAgentAreaWorkbenchContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.basehalf.agentArea';

	constructor(
		@IBaseHalfAgentAreaService agentAreaService: IBaseHalfAgentAreaService
	) {
		super();
		void agentAreaService;
	}
}

registerSingleton(IBaseHalfAgentAreaService, BaseHalfAgentAreaService, InstantiationType.Delayed);

registerAction2(class BaseHalfToggleTerminalAgentAreaAction extends Action2 {
	constructor() {
		super({
			id: TerminalCommandId.Toggle,
			title: localize2('basehalf.toggleAgentAreaTerminal', 'Toggle Agent Area Terminal'),
			category: localize2('basehalf.category', 'BaseHalf'),
			f1: true,
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyCode.Backquote,
				mac: { primary: KeyMod.WinCtrl | KeyCode.Backquote },
				weight: KeybindingWeight.WorkbenchContrib
			}
		});
	}

	run(accessor: ServicesAccessor): Promise<void> {
		return accessor.get(IBaseHalfAgentAreaService).toggle();
	}
});

registerAction2(class BaseHalfToggleAgentAreaAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_AGENT_AREA_TOGGLE_COMMAND_ID,
			title: localize2('basehalf.toggleAgentArea', 'Toggle Agent Area'),
			category: localize2('basehalf.category', 'BaseHalf'),
			f1: true
		});
	}

	run(accessor: ServicesAccessor): Promise<void> {
		return accessor.get(IBaseHalfAgentAreaService).toggle();
	}
});

registerAction2(class BaseHalfRestartActiveAgentSessionAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_AGENT_AREA_RESTART_ACTIVE_COMMAND_ID,
			title: localize2('basehalf.restartActiveAgentAreaSession', 'Restart Active Agent Area Session'),
			category: localize2('basehalf.category', 'BaseHalf'),
			f1: true
		});
	}

	run(accessor: ServicesAccessor): Promise<void> {
		const agentAreaService = accessor.get(IBaseHalfAgentAreaService);
		return agentAreaService.activeSessionId ? agentAreaService.restartSession(agentAreaService.activeSessionId) : Promise.resolve();
	}
});

registerAction2(class BaseHalfKillActiveAgentSessionAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_AGENT_AREA_KILL_ACTIVE_COMMAND_ID,
			title: localize2('basehalf.killActiveAgentAreaSession', 'Kill Active Agent Area Session'),
			category: localize2('basehalf.category', 'BaseHalf'),
			f1: true
		});
	}

	run(accessor: ServicesAccessor): Promise<void> {
		const agentAreaService = accessor.get(IBaseHalfAgentAreaService);
		return agentAreaService.activeSessionId ? agentAreaService.killSession(agentAreaService.activeSessionId) : Promise.resolve();
	}
});

function registerCreateAgentSessionAction(id: string, kind: BaseHalfAgentSessionKind, title: string): void {
	registerAction2(class BaseHalfCreateAgentSessionAction extends Action2 {
		constructor() {
			super({
				id,
				title: actionTitle(title),
				category: localize2('basehalf.category', 'BaseHalf'),
				f1: true
			});
		}

		run(accessor: ServicesAccessor): Promise<IBaseHalfAgentAreaSession> {
			return accessor.get(IBaseHalfAgentAreaService).createSession(kind);
		}
	});
}

function actionTitle(title: string): { value: string; original: string } {
	return { value: title, original: title };
}

for (const choice of BASEHALF_VISIBLE_AGENT_SESSION_CHOICES) {
	registerCreateAgentSessionAction(choice.commandId, choice.kind, createAgentSessionActionLabel(choice.kind));
}

function createAgentSessionActionLabel(kind: BaseHalfAgentSessionKind): string {
	switch (kind) {
		case 'terminal':
			return 'New Agent Area Terminal';
		case 'tui-codex':
			return 'New Codex TUI Session';
		case 'tui-claude':
			return 'New Claude Code TUI Session';
		case 'extension-codex':
			return 'New Codex Extension Session';
		case 'extension-claude':
			return 'New Claude Code Extension Session';
	}
}

// ── Tab strip + pane keybindings (fire only while the Agent Area owns focus) ──

const AGENT_AREA_WHEN = ContextKeyExpr.has('basehalfAgentAreaFocused');
const AGENT_KEYBINDING_WEIGHT = KeybindingWeight.WorkbenchContrib + 51;

interface IBaseHalfAgentPaneActionSpec {
	readonly id: string;
	readonly title: string;
	readonly primary: number;
	readonly run: (service: IBaseHalfAgentAreaService) => unknown;
}

const AGENT_PANE_ACTIONS: readonly IBaseHalfAgentPaneActionSpec[] = [
	{ id: BASEHALF_AGENT_AREA_NEW_TAB_COMMAND_ID, title: 'New Agent Tab', primary: KeyMod.CtrlCmd | KeyCode.KeyT, run: service => service.newTab() },
	{ id: BASEHALF_AGENT_AREA_CLOSE_PANE_COMMAND_ID, title: 'Close Agent Pane', primary: KeyMod.CtrlCmd | KeyCode.KeyW, run: service => service.closeActivePane() },
	{ id: BASEHALF_AGENT_AREA_CLOSE_TAB_COMMAND_ID, title: 'Close Agent Tab', primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyW, run: service => service.closeActiveTab() },
	{ id: BASEHALF_AGENT_AREA_SPLIT_RIGHT_COMMAND_ID, title: 'Split Agent Pane Right', primary: KeyMod.CtrlCmd | KeyCode.KeyD, run: service => service.splitActivePane('right') },
	{ id: BASEHALF_AGENT_AREA_SPLIT_DOWN_COMMAND_ID, title: 'Split Agent Pane Down', primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyD, run: service => service.splitActivePane('down') },
	{ id: BASEHALF_AGENT_AREA_FOCUS_PANE_LEFT_COMMAND_ID, title: 'Focus Agent Pane Left', primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.LeftArrow, run: service => service.focusPaneDirection('left') },
	{ id: BASEHALF_AGENT_AREA_FOCUS_PANE_RIGHT_COMMAND_ID, title: 'Focus Agent Pane Right', primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.RightArrow, run: service => service.focusPaneDirection('right') },
	{ id: BASEHALF_AGENT_AREA_FOCUS_PANE_UP_COMMAND_ID, title: 'Focus Agent Pane Up', primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.UpArrow, run: service => service.focusPaneDirection('up') },
	{ id: BASEHALF_AGENT_AREA_FOCUS_PANE_DOWN_COMMAND_ID, title: 'Focus Agent Pane Down', primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.DownArrow, run: service => service.focusPaneDirection('down') },
	{ id: BASEHALF_AGENT_AREA_FOCUS_NEXT_PANE_COMMAND_ID, title: 'Focus Next Agent Pane', primary: KeyMod.CtrlCmd | KeyCode.BracketRight, run: service => service.cyclePaneFocus(1) },
	{ id: BASEHALF_AGENT_AREA_FOCUS_PREVIOUS_PANE_COMMAND_ID, title: 'Focus Previous Agent Pane', primary: KeyMod.CtrlCmd | KeyCode.BracketLeft, run: service => service.cyclePaneFocus(-1) },
	{ id: BASEHALF_AGENT_AREA_NEXT_TAB_COMMAND_ID, title: 'Next Agent Tab', primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.BracketRight, run: service => service.cycleTab(1) },
	{ id: BASEHALF_AGENT_AREA_PREVIOUS_TAB_COMMAND_ID, title: 'Previous Agent Tab', primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.BracketLeft, run: service => service.cycleTab(-1) },
	{ id: BASEHALF_AGENT_AREA_RESIZE_PANE_LEFT_COMMAND_ID, title: 'Resize Agent Pane Left', primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.LeftArrow, run: service => service.resizeActivePane('left') },
	{ id: BASEHALF_AGENT_AREA_RESIZE_PANE_RIGHT_COMMAND_ID, title: 'Resize Agent Pane Right', primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.RightArrow, run: service => service.resizeActivePane('right') },
	{ id: BASEHALF_AGENT_AREA_RESIZE_PANE_UP_COMMAND_ID, title: 'Resize Agent Pane Up', primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.UpArrow, run: service => service.resizeActivePane('up') },
	{ id: BASEHALF_AGENT_AREA_RESIZE_PANE_DOWN_COMMAND_ID, title: 'Resize Agent Pane Down', primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.DownArrow, run: service => service.resizeActivePane('down') },
	{ id: BASEHALF_AGENT_AREA_EQUALIZE_PANES_COMMAND_ID, title: 'Equalize Agent Panes', primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.Equal, run: service => service.equalizePanes() },
	{ id: BASEHALF_AGENT_AREA_TOGGLE_ZOOM_COMMAND_ID, title: 'Toggle Agent Pane Zoom', primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter, run: service => service.togglePaneZoom() },
	{ id: BASEHALF_AGENT_AREA_LAST_TAB_COMMAND_ID, title: 'Go to Last Agent Tab', primary: KeyMod.CtrlCmd | KeyCode.Digit9, run: service => service.gotoLastTab() }
];

function registerAgentPaneAction(spec: IBaseHalfAgentPaneActionSpec): void {
	registerAction2(class BaseHalfAgentPaneAction extends Action2 {
		constructor() {
			super({
				id: spec.id,
				title: actionTitle(spec.title),
				category: localize2('basehalf.category', 'BaseHalf'),
				f1: true,
				keybinding: {
					primary: spec.primary,
					when: AGENT_AREA_WHEN,
					weight: AGENT_KEYBINDING_WEIGHT
				}
			});
		}

		async run(accessor: ServicesAccessor): Promise<void> {
			await spec.run(accessor.get(IBaseHalfAgentAreaService));
		}
	});
}

for (const spec of AGENT_PANE_ACTIONS) {
	registerAgentPaneAction(spec);
}

const DIGIT_KEY_CODES = [KeyCode.Digit1, KeyCode.Digit2, KeyCode.Digit3, KeyCode.Digit4, KeyCode.Digit5, KeyCode.Digit6, KeyCode.Digit7, KeyCode.Digit8];
BASEHALF_AGENT_AREA_GOTO_TAB_COMMAND_IDS.forEach((commandId, i) => {
	registerAgentPaneAction({
		id: commandId,
		title: `Go to Agent Tab ${i + 1}`,
		primary: KeyMod.CtrlCmd | DIGIT_KEY_CODES[i],
		run: service => service.gotoTab(i + 1)
	});
});

registerWorkbenchContribution2(BaseHalfAgentAreaWorkbenchContribution.ID, BaseHalfAgentAreaWorkbenchContribution, WorkbenchPhase.AfterRestored);
