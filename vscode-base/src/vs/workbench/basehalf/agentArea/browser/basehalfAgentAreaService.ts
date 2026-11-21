/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfAgentArea.css';
import { RawContextKey, IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { BaseHalfAgentSessionKind, BaseHalfAgentSessionState, BaseHalfAgentLaunchInstructionsMonitor, IBaseHalfAgentAreaService, IBaseHalfAgentAreaSession, BaseHalfExtensionAgentSessionKind, IBaseHalfExtensionAgentProvider, BASEHALF_AGENT_EXTENSION_CANONICAL_VIEW_CONTAINER_IDS, baseHalfAgentSessionCanRequestNodeRuns, BASEHALF_AGENT_AREA_VIEW_CONTAINER_ID, baseHalfAgentSessionChoiceForKind, IBaseHalfCreateAgentTerminalOptions, IBaseHalfAdoptAgentTerminalOptions, baseHalfHasAgentLaunchInstructions } from '../common/basehalfAgentArea.js';
import { DisposableStore, MutableDisposable, IDisposable, Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ITerminalInstance, ITerminalService } from '../../../contrib/terminal/browser/terminal.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IBaseHalfAgentTabsState, BASEHALF_EMPTY_AGENT_TABS_STATE, mountedAgentPaneIds, liveAgentPaneIds, activeAgentTab, agentTabForPane, focusAgentPane, removeAgentPane, splitActiveAgentPane, gotoAgentPaneDir, gotoAgentPaneRing, switchAgentTab, gotoAgentTab, lastAgentTab, resizeActiveAgentPane, equalizeAgentPanes, toggleAgentPaneZoom, closeActiveAgentPane, selectAgentTab, closeAgentTab, closeOtherAgentTabs, closeAgentTabsToRight, agentTabPaneIds, undoAgentClose, finalizeAgentClose, closingEntryPaneIds, moveAgentPane, createAgentTab } from '../common/basehalfAgentTabsModel.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IBaseHalfAgentSkillService } from '../common/basehalfAgentSkill.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IWorkspaceTrustManagementService, IWorkspaceTrustRequestService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IExtensionGalleryService } from '../../../../platform/extensionManagement/common/extensionManagement.js';
import { IExtensionsWorkbenchService } from '../../../contrib/extensions/common/extensions.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IRemoteAgentService } from '../../../services/remote/common/remoteAgentService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { BaseHalfViewContainerExtensionAgentProvider } from './basehalfExtensionAgentProvider.js';
import { $, append, trackFocus } from '../../../../base/browser/dom.js';
import { setBaseHalfHover } from '../../ui/browser/basehalfHover.js';
import { baseHalfMoveStripWithWheel } from '../../ui/browser/basehalfSidewaysStrip.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { TerminalExitReason, TerminalSettingId } from '../../../../platform/terminal/common/terminal.js';
import { stripIcons } from '../../../../base/common/iconLabels.js';
import { IBaseHalfAgentSessionName, baseHalfAgentSessionName } from '../common/basehalfAgentSessionName.js';
import { BASEHALF_AGENT_SESSION_NO_BELL, IBaseHalfAgentSessionBell, baseHalfAgentAreaButtonShowsBell, baseHalfAgentSessionBellAreaShown, baseHalfAgentSessionBellLingered, baseHalfAgentSessionBellSeen } from '../common/basehalfAgentSessionBell.js';
import { disposableTimeout } from '../../../../base/common/async.js';
import { BaseHalfSplitDir, BaseHalfFocusDir, dropEdge } from '../common/basehalfAgentSplitTree.js';
import { baseHalfSplitFolder } from '../common/basehalfAgentSplitFolder.js';
import { normalizeBaseHalfAgentDefaultSession, BaseHalfSetting } from '../../shell/common/basehalfConfiguration.js';
import { BaseHalfAgentAreaTabStrip } from './basehalfAgentAreaTabStrip.js';
import { BaseHalfAgentAreaSurface } from './basehalfAgentAreaSurface.js';
import { BaseHalfAgentAreaExtensionPanes } from './basehalfAgentAreaExtensionPanes.js';
import { BaseHalfAgentAreaTerminalPanes } from './basehalfAgentAreaTerminalPanes.js';
import { BaseHalfAgentAreaClosing } from './basehalfAgentAreaClosing.js';
import { BaseHalfAgentAreaArrangement } from './basehalfAgentAreaArrangement.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';

// The Agent Area: its sessions in tabs and panes, each a terminal or an agent extension's view.

export const BASEHALF_AGENT_AREA_FOCUSED_CONTEXT_KEY = new RawContextKey<boolean>('basehalfAgentAreaFocused', false);
/** A session rang its bell while the Agent Area was hidden, and the area has not been shown since. */
export const BASEHALF_AGENT_AREA_BELL_CONTEXT_KEY = new RawContextKey<boolean>('basehalfAgentAreaBell', false);

const CLOSE_GRACE_MS = 6000;

export interface IBaseHalfRuntimeAgentSession {
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
	/** The edges around the terminal's grid, which take the background of the nearest cell (D86). */
	readonly edges: MutableDisposable<IDisposable>;
	terminal?: ITerminalInstance;
	/** The folder the session was given to start in; a terminal that runs says where it is now. */
	folder?: string;
	/** An extension created the terminal of the session: the arrangement a folder opens with leaves it out. */
	createdByExtension?: boolean;
	/** The keyboard was sent to the session while it waited to start: it takes it once it has started. */
	takesKeyboard?: boolean;
	/** The title that the program of the terminal set for it, while that program runs. */
	programTitle?: string;
	/** The bell of the session, as its tab shows it. */
	bell: IBaseHalfAgentSessionBell;
	/** Ends the bell that lingers after the session came into view. */
	readonly bellLingers: MutableDisposable<IDisposable>;
	terminalPersistentProcessId?: number;
	/** Tracks whether launches carry the BaseHalf launch instruction and falls
	 *  back once when the installed CLI rejects it. */
	readonly launchInstructions: BaseHalfAgentLaunchInstructionsMonitor;
	extensionSetVisible?: (visible: boolean) => void;
	extensionLayout?: () => void;
	extensionFocus?: () => void | Promise<void>;
	extensionDispose?: () => void | Promise<void>;
	statePrimaryAction?: { label: string; run: () => void | Promise<void> };
	closing?: boolean;
}

export class BaseHalfAgentAreaService extends Disposable implements IBaseHalfAgentAreaService {

	// The parts, one concern each; they reach this object as `area`.
	/** The strip of tabs */
	readonly tabs = new BaseHalfAgentAreaTabStrip(this);
	/** What the body shows: panes, dividers, toasts, and the states of a session */
	readonly surface = new BaseHalfAgentAreaSurface(this);
	/** Panes that an agent extension draws */
	readonly extensionPanes = new BaseHalfAgentAreaExtensionPanes(this);
	/** Panes that hold a terminal */
	readonly terminalPanes = new BaseHalfAgentAreaTerminalPanes(this);
	/** The question before sessions or the window close with something running */
	readonly closing = new BaseHalfAgentAreaClosing(this);
	/** The tabs and panes a folder opens with */
	readonly arrangement = new BaseHalfAgentAreaArrangement(this);

	declare readonly _serviceBrand: undefined;

	private static nextId = 1;

	private readonly _onDidChangeVisibility = this._register(new Emitter<boolean>());
	readonly onDidChangeVisibility: Event<boolean> = this._onDidChangeVisibility.event;

	private readonly _onDidChangeSessions = this._register(new Emitter<readonly IBaseHalfAgentAreaSession[]>());
	readonly onDidChangeSessions: Event<readonly IBaseHalfAgentAreaSession[]> = this._onDidChangeSessions.event;
	private readonly _onDidReleaseTerminalProcess = this._register(new Emitter<number>());
	readonly onDidReleaseTerminalProcess: Event<number> = this._onDidReleaseTerminalProcess.event;

	private readonly root: HTMLElement;
	readonly tabsBar: HTMLElement;
	readonly tabStrip: HTMLElement;
	readonly zoomResetButton: HTMLButtonElement;
	readonly body: HTMLElement;
	readonly dividersLayer: HTMLElement;
	readonly hud: HTMLElement;
	readonly zoomBadge: HTMLElement;
	readonly toasts: HTMLElement;
	readonly empty: HTMLElement;
	private readonly resizeObserver: ResizeObserver;
	private readonly focusedContextKey: IContextKey<boolean>;
	private readonly bellContextKey: IContextKey<boolean>;

	tabsState: IBaseHalfAgentTabsState = BASEHALF_EMPTY_AGENT_TABS_STATE;
	readonly runtime = new Map<string, IBaseHalfRuntimeAgentSession>();
	private readonly releasedTerminalProcessIds = new Set<number>();
	readonly extensionProviders = new Map<BaseHalfExtensionAgentSessionKind, IBaseHalfExtensionAgentProvider>();
	private readonly graceTimers = new Map<string, number>();
	tabDragId: string | undefined;
	paneDragId: string | undefined;

	constructor(
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@ITerminalService public readonly terminalService: ITerminalService,
		@INotificationService public readonly notificationService: INotificationService,
		@IConfigurationService public readonly configurationService: IConfigurationService,
		@ILogService public readonly logService: ILogService,
		@IBaseHalfAgentSkillService public readonly agentSkillService: IBaseHalfAgentSkillService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextMenuService public readonly contextMenuService: IContextMenuService,
		@IWorkspaceTrustManagementService public readonly workspaceTrustManagementService: IWorkspaceTrustManagementService,
		@IWorkspaceTrustRequestService public readonly workspaceTrustRequestService: IWorkspaceTrustRequestService,
		@IViewsService private readonly viewsService: IViewsService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IExtensionService public readonly extensionService: IExtensionService,
		@IExtensionGalleryService public readonly extensionGalleryService: IExtensionGalleryService,
		@IExtensionsWorkbenchService public readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IHostService public readonly hostService: IHostService,
		@IRemoteAgentService public readonly remoteAgentService: IRemoteAgentService,
		@IFileService public readonly fileService: IFileService,
		@IWorkspaceContextService public readonly workspaceContextService: IWorkspaceContextService,
		@IDialogService public readonly dialogService: IDialogService,
		@ICommandService public readonly commandService: ICommandService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@IStorageService public readonly storageService: IStorageService,
		@IPathService public readonly pathService: IPathService
	) {
		super();

		this._register(this.tabs);
		this._register(this.arrangement);
		this._register(this.configurationService.onDidChangeConfiguration(event => {
			// The name of an agent's session depends on this setting; the base draws a terminal's title again itself.
			if (event.affectsConfiguration(TerminalSettingId.TabsAllowAgentCliTitle)) {
				this.tabs.namesChanged();
			}
			if (event.affectsConfiguration(BaseHalfSetting.AgentRestoreSessions)) {
				this.arrangement.settingChanged();
			}
			// With the bell off the base keeps none: the bells that show go at once.
			if (event.affectsConfiguration(TerminalSettingId.EnableVisualBell) && this.configurationService.getValue(TerminalSettingId.EnableVisualBell) !== true) {
				this.forgetBells();
			}
		}));
		this._register(lifecycleService.onBeforeShutdown(event => {
			// The arrangement of this moment is what the folder opens with: the terminals end as the window closes.
			this.arrangement.windowCloses();
			event.veto(this.closing.vetoWindowClose(event.reason), 'veto.basehalfAgentArea');
		}));
		this._register(lifecycleService.onShutdownVeto(() => this.arrangement.windowStays()));
		this._register(lifecycleService.onWillShutdown(() => this.arrangement.windowCloses()));

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
		// A wheel that turns up and down moves the tabs sideways: the strip scrolls no other way.
		this._register(baseHalfMoveStripWithWheel(this.tabStrip, () => this.tabStrip));
		this.tabStrip.addEventListener('dragover', e => {
			if (this.tabDragId && e.target === this.tabStrip) {
				e.preventDefault();
				this.tabs.setTabDropIndex(this.tabsState.tabs.length);
			}
		});
		this.tabStrip.addEventListener('drop', e => {
			if (this.tabDragId && e.target === this.tabStrip) {
				e.preventDefault();
				this.tabs.dropDraggedTabAt(this.tabsState.tabs.length);
			}
		});
		this.tabStrip.addEventListener('dragleave', e => {
			if (!this.tabStrip.contains(e.relatedTarget as Node | null)) {
				this.tabs.setTabDropIndex(undefined);
			}
		});

		this.zoomResetButton = append(tabsBar, $('button.basehalf-agent-area-icon.basehalf-agent-zoom-reset.codicon.codicon-screen-normal')) as HTMLButtonElement;
		this.zoomResetButton.type = 'button';
		setBaseHalfHover(this.zoomResetButton, 'Reset Zoom (⌘⇧↵)');
		this.zoomResetButton.setAttribute('aria-label', 'Reset Zoom');
		this.zoomResetButton.addEventListener('click', () => this.togglePaneZoom());

		const plus = append(tabsBar, $('button.basehalf-agent-area-icon.basehalf-agent-new-tab.codicon.codicon-add')) as HTMLButtonElement;
		plus.type = 'button';
		setBaseHalfHover(plus, 'New Agent Session');
		plus.setAttribute('aria-label', 'New Agent Session');
		plus.addEventListener('click', () => this.surface.showNewSessionMenu(plus));

		this.body = append(this.root, $('.basehalf-agent-area-body'));
		this.empty = append(this.body, $('.basehalf-agent-area-empty'));
		this.surface.buildEmptyStatePicker();
		this.dividersLayer = append(this.body, $('.basehalf-agent-dividers'));
		this.hud = append(this.body, $('.basehalf-agent-resize-hud'));
		this.hud.setAttribute('aria-hidden', 'true');
		this.zoomBadge = append(this.body, $('.basehalf-agent-zoom-badge'));
		this.zoomBadge.setAttribute('aria-hidden', 'true');
		this.zoomBadge.textContent = 'zoomed · ⌘⇧↵';
		this.toasts = append(this.root, $('.basehalf-agent-toasts'));

		this.resizeObserver = new mainWindow.ResizeObserver(() => this.surface.layoutVisiblePanes());
		this.resizeObserver.observe(this.body);

		this.focusedContextKey = BASEHALF_AGENT_AREA_FOCUSED_CONTEXT_KEY.bindTo(contextKeyService);
		this.bellContextKey = BASEHALF_AGENT_AREA_BELL_CONTEXT_KEY.bindTo(contextKeyService);
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
				this.extensionPanes.reassertExtensionClaims();
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

		// The folder opens with the tabs it was closed with, in the first frame that shows the Agent Area.
		this.arrangement.restore();
	}

	/** Whether the keyboard is in the Agent Area. */
	get focused(): boolean {
		return this.root.contains(this.root.ownerDocument.activeElement);
	}

	ownsTerminalProcess(persistentProcessId: number): boolean {
		return this.terminalProcessOwnership(persistentProcessId) === 'owned';
	}

	terminalProcessOwnership(persistentProcessId: number): 'owned' | 'released' | 'unknown' {
		for (const session of this.runtime.values()) {
			if (!baseHalfAgentSessionCanRequestNodeRuns(session.kind)) {
				continue;
			}
			const currentProcessId = session.terminal?.persistentProcessId ?? session.terminalPersistentProcessId;
			if (currentProcessId === persistentProcessId) {
				return 'owned';
			}
		}
		return this.releasedTerminalProcessIds.has(persistentProcessId) ? 'released' : 'unknown';
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
			await this.surface.focusActivePane();
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

		return this.extensionPanes.createExtensionAgentSession(kind as BaseHalfExtensionAgentSessionKind);
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
		await this.terminalPanes.initializeTerminalPane(session, options);
		return this.snapshotSession(session);
	}

	async adoptTerminalSession(terminal: unknown, options: IBaseHalfAdoptAgentTerminalOptions = {}): Promise<IBaseHalfAgentAreaSession> {
		if (!this.terminalPanes.isTerminalInstance(terminal)) {
			throw new Error('BaseHalf Agent Area can only adopt a VS Code terminal instance.');
		}

		const existing = [...this.runtime.values()].find(session => session.terminal === terminal);
		if (existing) {
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
		session.createdByExtension = true;
		this.openPaneInNewTab(session.id, shouldReveal);
		if (shouldReveal) {
			await this.show(options.preserveFocus);
		}

		try {
			await this.terminalPanes.attachTerminalToSession(session, terminal, undefined, shouldReveal && options.preserveFocus !== true);
		} catch (error) {
			this.markSessionFailed(session, error);
		}

		return this.snapshotSession(session);
	}

	async revealTerminalSession(terminal: unknown, options: IBaseHalfAdoptAgentTerminalOptions = {}): Promise<IBaseHalfAgentAreaSession | undefined> {
		if (!this.terminalPanes.isTerminalInstance(terminal)) {
			return undefined;
		}

		this.terminalPanes.setActiveTerminalForVsCodeCompatibility(terminal);
		return this.adoptTerminalSession(terminal, {
			...options,
			label: options.label ?? terminal.title,
			reveal: true
		});
	}

	hideTerminalSession(terminal: unknown): void {
		if (!this.terminalPanes.isTerminalInstance(terminal)) {
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

		if (session.state === 'waiting') {
			// A session that waits to start starts when it comes into view.
			await this.focusSession(session.id);
			return;
		}

		if (session.terminal && !session.terminal.isDisposed) {
			session.state = 'starting';
			session.detail = 'Restarting';
			this.surface.clearSessionStatePanel(session);
			this.render();
			// A relaunch reuses the launch configuration, so it keeps (or, after
			// a fallback, keeps omitting) the launch instruction.
			session.launchInstructions.didLaunch(baseHalfHasAgentLaunchInstructions(session.terminal.shellLaunchConfig.args));
			session.terminal.relaunch();
			await this.focusSession(session.id);
			return;
		}

		if (session.kind === 'extension-codex' || session.kind === 'extension-claude') {
			await this.extensionPanes.initializeExtensionPane(session);
			await this.focusSession(session.id);
			return;
		}

		// A terminal-backed pane whose terminal never launched (or was disposed):
		// start a fresh terminal into the same pane.
		session.state = 'starting';
		session.detail = 'Restarting';
		this.surface.clearSessionStatePanel(session);
		this.render();
		const choice = baseHalfAgentSessionChoiceForKind(session.kind);
		await this.terminalPanes.initializeTerminalPane(session, { label: session.label, command: choice.terminalCommand });
		await this.focusSession(session.id);
	}

	async killSession(id: string): Promise<void> {
		if (!await this.closing.confirmEnding([id], 'kill')) {
			return;
		}
		this.endSession(id);
	}

	/** Ends a session at once; whether to ask was settled before. */
	private endSession(id: string): void {
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

	async killTerminalSession(terminal: unknown): Promise<boolean> {
		const session = [...this.runtime.values()].find(candidate => candidate.terminal === terminal);
		if (!session) {
			return false;
		}
		await this.killSession(session.id);
		return true;
	}

	showsTerminal(terminal: unknown): boolean {
		return [...this.runtime.values()].some(session => session.terminal === terminal);
	}

	/**
	 * Kill All Terminals: every terminal session ends, also one whose tab was closed and that has not ended
	 * yet, after one question for all of them. A session that an agent's extension draws is no terminal.
	 */
	async killAllTerminalSessions(): Promise<boolean> {
		const terminalSessions = () => [...this.runtime.values()].filter(session => !session.closing && !!session.terminal && !session.terminal.isDisposed);
		if (!await this.closing.confirmEnding(terminalSessions().map(session => session.id), 'kill')) {
			return false;
		}
		// Read again after the answer: a session may have ended meanwhile.
		for (const session of terminalSessions()) {
			this.endSession(session.id);
		}
		return true;
	}

	closeSession(id: string): Promise<void> {
		return this.softClosePane(id);
	}

	// ── Tabs + panes (Ghostty-style layout) ────────────────────────────────────

	async newTab(): Promise<IBaseHalfAgentAreaSession | undefined> {
		return this.createSession(this.defaultSessionKind());
	}

	async splitActivePane(dir: BaseHalfSplitDir): Promise<IBaseHalfAgentAreaSession | undefined> {
		const tab = activeAgentTab(this.tabsState);
		if (!tab) {
			return this.createSession('terminal');
		}

		const cwd = await this.splitFolder(this.runtime.get(tab.activePaneId)?.terminal);
		const choice = baseHalfAgentSessionChoiceForKind('terminal');
		const session = this.createRuntimeSession('terminal', choice.label, choice.description);
		this.mutateTabs(state => splitActiveAgentPane(state, dir, session.id, this.mintId('split')));
		await this.show(true);
		await this.terminalPanes.initializeTerminalPane(session, cwd ? { rawTerminalOptions: { cwd } } : {});
		return this.snapshotSession(session);
	}

	/**
	 * The folder the session of a split starts in, as `terminal.integrated.splitCwd` says of the session
	 * it splits; none is the workspace folder, where every new session starts.
	 */
	private async splitFolder(terminal: ITerminalInstance | undefined): Promise<string | undefined> {
		const folder = baseHalfSplitFolder(this.configurationService.getValue(TerminalSettingId.SplitCwd), !!terminal);
		if (!terminal || folder === 'workspace') {
			return undefined;
		}
		try {
			return (folder === 'initial' ? await terminal.getInitialCwd() : await terminal.getSpeculativeCwd()) || undefined;
		} catch {
			// A session whose process has ended cannot say where it was.
			return undefined;
		}
	}

	closeActivePane(): void {
		const tab = activeAgentTab(this.tabsState);
		if (tab) {
			void this.softClosePane(tab.activePaneId);
		}
	}

	closeActiveTab(): void {
		const tab = activeAgentTab(this.tabsState);
		if (tab) {
			void this.softCloseTab(tab.id);
		}
	}

	async focusPaneDirection(dir: BaseHalfFocusDir): Promise<void> {
		if (this.mutateTabs(state => gotoAgentPaneDir(state, dir))) {
			await this.surface.focusActivePane();
		}
	}

	async cyclePaneFocus(delta: 1 | -1): Promise<void> {
		if (this.mutateTabs(state => gotoAgentPaneRing(state, delta))) {
			await this.surface.focusActivePane();
		}
	}

	async cycleTab(delta: 1 | -1): Promise<void> {
		if (this.mutateTabs(state => switchAgentTab(state, delta))) {
			await this.surface.focusActivePane();
		}
	}

	async gotoTab(index: number): Promise<void> {
		if (this.mutateTabs(state => gotoAgentTab(state, index))) {
			await this.surface.focusActivePane();
		}
	}

	async gotoLastTab(): Promise<void> {
		if (this.mutateTabs(state => lastAgentTab(state))) {
			await this.surface.focusActivePane();
		}
	}

	resizeActivePane(dir: BaseHalfFocusDir): void {
		if (this.mutateTabs(state => resizeActiveAgentPane(state, dir))) {
			this.surface.showResizeHud();
		}
	}

	equalizePanes(): void {
		if (this.mutateTabs(state => equalizeAgentPanes(state))) {
			this.surface.showResizeHud();
		}
	}

	togglePaneZoom(): void {
		this.mutateTabs(state => toggleAgentPaneZoom(state));
	}

	// ── Soft close + undo ──────────────────────────────────────────────────────

	// Each close asks first when something runs in a session it would end and the setting says so
	// (`closing`); the tabs are read again after the answer, since they may have changed meanwhile.

	private async softClosePane(paneId: string): Promise<void> {
		if (!agentTabForPane(this.tabsState, paneId) || !await this.closing.confirmEnding([paneId], 'close')) {
			return;
		}
		const owner = agentTabForPane(this.tabsState, paneId);
		if (!owner) {
			return;
		}
		const key = this.mintId('close');
		if (this.mutateTabs(state => closeActiveAgentPane(selectAgentTab(state, owner.id), key, paneId))) {
			this.startGraceTimer(key);
		}
	}

	async softCloseTab(tabId: string): Promise<void> {
		if (!await this.closing.confirmEnding(agentTabPaneIds(this.tabsState, [tabId]), 'close')) {
			return;
		}
		const key = this.mintId('close');
		if (this.mutateTabs(state => closeAgentTab(state, tabId, key))) {
			this.startGraceTimer(key);
		}
	}

	async softCloseOtherTabs(tabId: string): Promise<void> {
		const others = this.tabsState.tabs.filter(tab => tab.id !== tabId).map(tab => tab.id);
		if (!await this.closing.confirmEnding(agentTabPaneIds(this.tabsState, others), 'close')) {
			return;
		}
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

	async softCloseTabsToRight(tabId: string): Promise<void> {
		const index = this.tabsState.tabs.findIndex(tab => tab.id === tabId);
		const toRight = index < 0 ? [] : this.tabsState.tabs.slice(index + 1).map(tab => tab.id);
		if (!await this.closing.confirmEnding(agentTabPaneIds(this.tabsState, toRight), 'close')) {
			return;
		}
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

	undoClose(key: string): void {
		this.cancelGraceTimer(key);
		if (this.mutateTabs(state => undoAgentClose(state, key, () => this.mintId('tab')))) {
			void this.surface.focusActivePane();
		}
	}

	finalizeClose(key: string): void {
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

	createRuntimeSession(kind: BaseHalfAgentSessionKind, label: string, description: string, id: string = this.mintId('agent')): IBaseHalfRuntimeAgentSession {
		const host = append(this.body, $('.basehalf-agent-area-session'));
		const session: IBaseHalfRuntimeAgentSession = {
			id,
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
			disposables: new DisposableStore(),
			edges: new MutableDisposable(),
			bell: BASEHALF_AGENT_SESSION_NO_BELL,
			bellLingers: new MutableDisposable(),
			launchInstructions: new BaseHalfAgentLaunchInstructionsMonitor()
		};
		session.disposables.add(session.edges);
		session.disposables.add(session.bellLingers);
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
		session.host.addEventListener('mousemove', event => this.updatePaneHandleReveal(session, event));
		session.host.addEventListener('mouseleave', () => session.host.classList.remove('handle-reveal'));

		this.wirePaneDrag(session);
		this.terminalPanes.installClicks(session);
		this.runtime.set(session.id, session);
		return session;
	}

	private updatePaneHandleReveal(session: IBaseHalfRuntimeAgentSession, event: MouseEvent): void {
		const box = session.host.getBoundingClientRect();
		if (box.width === 0 || box.height === 0) {
			session.host.classList.remove('handle-reveal');
			return;
		}

		const hoverHeight = Math.min(box.height, Math.max(12, box.height * 0.2));
		const y = event.clientY - box.top;
		session.host.classList.toggle('handle-reveal', y >= 0 && y <= hoverHeight);
	}

	private wirePaneDrag(session: IBaseHalfRuntimeAgentSession): void {
		const handle = session.grabHandle;
		handle.setAttribute('aria-label', 'Move pane');
		handle.draggable = true;
		append(handle, $('span.basehalf-agent-pane-handle-dots')).textContent = '⋯';
		handle.addEventListener('dragstart', e => {
			e.dataTransfer?.setData('application/x-basehalf-agent-pane', session.id);
			if (e.dataTransfer) {
				e.dataTransfer.effectAllowed = 'move';
			}
			this.paneDragId = session.id;
			session.host.classList.add('pane-dragging');
			this.render();
		});
		handle.addEventListener('dragend', () => {
			this.paneDragId = undefined;
			session.host.classList.remove('pane-dragging');
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
				void this.surface.focusActivePane();
			}
			edge = undefined;
			this.paneDragId = undefined;
			this.render();
		});
	}

	openPaneInNewTab(paneId: string, activate: boolean): void {
		const previousActive = this.tabsState.activeTabId;
		this.mutateTabs(state => {
			let next = createAgentTab(state, this.mintId('tab'), paneId);
			if (!activate && previousActive) {
				next = selectAgentTab(next, previousActive);
			}
			return next;
		});
	}

	disposeRuntimeSession(session: IBaseHalfRuntimeAgentSession, killTerminal: boolean): void {
		const persistentProcessId = session.terminalPersistentProcessId ?? session.terminal?.persistentProcessId;
		if (persistentProcessId !== undefined && baseHalfAgentSessionCanRequestNodeRuns(session.kind)) {
			this.releaseTerminalProcess(persistentProcessId);
		}
		if (killTerminal && session.terminal && !session.terminal.isDisposed) {
			// Whether to ask was settled before the close began (`closing`): nothing asks once the pane is gone.
			session.terminal.dispose(TerminalExitReason.User);
		}
		session.state = 'disposed';
		session.disposables.dispose();
		void session.extensionDispose?.();
		session.extensionDispose = undefined;
	}

	rememberTerminalProcess(session: IBaseHalfRuntimeAgentSession, terminal: ITerminalInstance): void {
		if (!baseHalfAgentSessionCanRequestNodeRuns(session.kind)) {
			return;
		}
		const persistentProcessId = terminal.persistentProcessId;
		if (persistentProcessId === undefined) {
			return;
		}
		if (session.terminalPersistentProcessId !== undefined && session.terminalPersistentProcessId !== persistentProcessId) {
			this.releaseTerminalProcess(session.terminalPersistentProcessId);
		}
		session.terminalPersistentProcessId = persistentProcessId;
		this.releasedTerminalProcessIds.delete(persistentProcessId);
	}

	private releaseTerminalProcess(persistentProcessId: number): void {
		if (this.releasedTerminalProcessIds.has(persistentProcessId)) {
			return;
		}
		this.releasedTerminalProcessIds.add(persistentProcessId);
		this._onDidReleaseTerminalProcess.fire(persistentProcessId);
	}

	// ── Rendering ──────────────────────────────────────────────────────────────

	mutateTabs(fn: (state: IBaseHalfAgentTabsState) => IBaseHalfAgentTabsState): boolean {
		const next = fn(this.tabsState);
		if (next === this.tabsState) {
			return false;
		}
		this.tabsState = next;
		this.render();
		return true;
	}

	render(): void {
		this.arrangement.startSessionsInView();
		this.seeBells();
		this.renderActiveSurfaceKind();
		this.tabs.renderTabStrip();
		this.surface.renderPanes();
		this.surface.renderDividers();
		this.surface.renderToasts();
		this.surface.layoutVisiblePanes();
		this.arrangement.changed();
		this._onDidChangeSessions.fire(this.sessions);
	}

	/** Whether a session is in view: the Agent Area is shown and the session's tab is in front. */
	sessionInView(session: IBaseHalfRuntimeAgentSession): boolean {
		return this.visible && agentTabForPane(this.tabsState, session.id)?.id === this.tabsState.activeTabId;
	}

	/**
	 * A bell that rang out of view is seen once its session is in view, and shows from then for the time of a
	 * bell, as if it rang at that moment.
	 */
	private seeBells(): void {
		const areaShown = this.visible;
		for (const session of this.runtime.values()) {
			if (areaShown) {
				// The tabs show the bells from now, not the title bar's button.
				session.bell = baseHalfAgentSessionBellAreaShown(session.bell);
			}
			if (session.bell.unseen && this.sessionInView(session)) {
				session.bell = baseHalfAgentSessionBellSeen(session.bell);
				session.bellLingers.value = disposableTimeout(() => {
					session.bell = baseHalfAgentSessionBellLingered(session.bell);
					this.tabs.marksChanged();
				}, Math.max(0, Number(this.configurationService.getValue(TerminalSettingId.BellDuration)) || 0));
			}
		}
		this.showButtonBell();
	}

	/** A session's bell rang or ended: its tab and the title bar's button show it. */
	bellsChanged(): void {
		this.tabs.marksChanged();
		this.showButtonBell();
	}

	/** The title bar's button shows a dot while a session that has a tab rang with the Agent Area hidden. */
	private showButtonBell(): void {
		const bells = liveAgentPaneIds(this.tabsState).map(paneId => this.runtime.get(paneId)?.bell ?? BASEHALF_AGENT_SESSION_NO_BELL);
		this.bellContextKey.set(baseHalfAgentAreaButtonShowsBell(bells));
	}

	private forgetBells(): void {
		for (const session of this.runtime.values()) {
			session.bell = BASEHALF_AGENT_SESSION_NO_BELL;
			session.bellLingers.clear();
		}
		this.bellsChanged();
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

	focusActivePane(): Promise<void> {
		return this.surface.focusActivePane();
	}

	// ── Terminal plumbing ──────────────────────────────────────────────────────

	private defaultSessionKind(): BaseHalfAgentSessionKind {
		return normalizeBaseHalfAgentDefaultSession(this.configurationService.getValue(BaseHalfSetting.AgentDefaultSession));
	}

	markSessionFailed(session: IBaseHalfRuntimeAgentSession, error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		session.state = 'failed';
		session.detail = message;
		this.surface.renderSessionStatePanel(session);
		this.render();
		this.logService.error(error instanceof Error ? error : message);
		this.notificationService.notify({
			severity: Severity.Error,
			message: `BaseHalf Agent Area failed to start ${session.label}: ${message}`
		});
	}

	snapshotSession(session: IBaseHalfRuntimeAgentSession): IBaseHalfAgentAreaSession {
		return {
			id: session.id,
			kind: session.kind,
			label: session.label,
			description: session.description,
			state: session.state,
			detail: session.detail
		};
	}

	/** The name and the description a session shows on its tab, as the settings of a terminal's tab say. */
	sessionNaming(session: IBaseHalfRuntimeAgentSession): IBaseHalfAgentSessionName {
		const terminal = session.terminal && !session.terminal.isDisposed ? session.terminal : undefined;
		return baseHalfAgentSessionName({
			kind: session.kind,
			ownName: session.label,
			terminalTitle: terminal?.title,
			terminalDescription: terminal?.description,
			programTitle: session.state === 'ready' ? session.programTitle : undefined,
			allowAgentCliTitle: this.configurationService.getValue<boolean>(TerminalSettingId.TabsAllowAgentCliTitle) !== false
		});
	}

	/** The name of a session in words, as a toast or a question says it. */
	sessionName(session: IBaseHalfRuntimeAgentSession): string {
		return stripIcons(this.sessionNaming(session).name).trim() || session.label;
	}

	stateLabel(state: BaseHalfAgentSessionState): string {
		switch (state) {
			case 'waiting':
				return '';
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

	choiceIconClass(kind: BaseHalfAgentSessionKind): string {
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

	mintId(prefix: string): string {
		return `basehalf-${prefix}-${BaseHalfAgentAreaService.nextId++}`;
	}
}
