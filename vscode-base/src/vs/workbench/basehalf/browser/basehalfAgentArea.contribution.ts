/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfAgentArea.css';

import { $, append, clearNode } from '../../../base/browser/dom.js';
import { mainWindow } from '../../../base/browser/window.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { IDisposable, Disposable, DisposableStore, toDisposable } from '../../../base/common/lifecycle.js';
import { isObject } from '../../../base/common/types.js';
import { localize2 } from '../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { KeyCode, KeyMod } from '../../../base/common/keyCodes.js';
import { KeybindingWeight } from '../../../platform/keybinding/common/keybindingsRegistry.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../platform/notification/common/notification.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { IWorkbenchLayoutService, Parts } from '../../services/layout/browser/layoutService.js';
import { TerminalCommandId } from '../../contrib/terminal/common/terminal.js';
import { ICreateTerminalOptions, ITerminalInstance, ITerminalService } from '../../contrib/terminal/browser/terminal.js';
import {
	BASEHALF_AGENT_AREA_TOGGLE_COMMAND_ID,
	BASEHALF_VISIBLE_AGENT_SESSION_CHOICES,
	BaseHalfAgentSessionKind,
	BaseHalfAgentSessionState,
	BaseHalfExtensionAgentSessionKind,
	baseHalfAgentSessionChoiceForKind,
	IBaseHalfAgentAreaService,
	IBaseHalfAgentAreaSession,
	IBaseHalfAdoptAgentTerminalOptions,
	IBaseHalfCreateAgentTerminalOptions,
	IBaseHalfExtensionAgentProvider,
	IBaseHalfExtensionAgentProviderResult
} from '../common/basehalfAgentArea.js';

interface IBaseHalfRuntimeAgentSession {
	id: string;
	kind: BaseHalfAgentSessionKind;
	label: string;
	description: string;
	state: BaseHalfAgentSessionState;
	detail?: string;
	host: HTMLElement;
	disposables: DisposableStore;
	terminal?: ITerminalInstance;
	extensionFocus?: () => void | Promise<void>;
	extensionDispose?: () => void | Promise<void>;
	closing?: boolean;
}

class BaseHalfAgentAreaService extends Disposable implements IBaseHalfAgentAreaService {
	declare readonly _serviceBrand: undefined;

	private static nextSessionId = 1;

	private readonly _onDidChangeVisibility = this._register(new Emitter<boolean>());
	readonly onDidChangeVisibility: Event<boolean> = this._onDidChangeVisibility.event;

	private readonly _onDidChangeSessions = this._register(new Emitter<readonly IBaseHalfAgentAreaSession[]>());
	readonly onDidChangeSessions: Event<readonly IBaseHalfAgentAreaSession[]> = this._onDidChangeSessions.event;

	private readonly root: HTMLElement;
	private readonly choices: HTMLElement;
	private readonly tabs: HTMLElement;
	private readonly body: HTMLElement;
	private readonly empty: HTMLElement;
	private readonly resizeObserver: ResizeObserver;
	private readonly runtimeSessions: IBaseHalfRuntimeAgentSession[] = [];
	private readonly extensionProviders = new Map<BaseHalfExtensionAgentSessionKind, IBaseHalfExtensionAgentProvider>();

	private _visible = false;
	private _activeSessionId: string | undefined;

	constructor(
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@ITerminalService private readonly terminalService: ITerminalService,
		@INotificationService private readonly notificationService: INotificationService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		const editorContainer = this.layoutService.getContainer(mainWindow, Parts.EDITOR_PART);
		if (!editorContainer) {
			throw new Error('BaseHalf Agent Area requires the main editor part container.');
		}

		editorContainer.classList.add('basehalf-agent-area-host');
		this.root = $('.basehalf-agent-area');
		this.root.setAttribute('aria-label', 'BaseHalf Agent Area');
		this.root.setAttribute('aria-hidden', 'true');

		const header = append(this.root, $('.basehalf-agent-area-header'));
		const title = append(header, $('.basehalf-agent-area-title'));
		title.textContent = 'AGENT';
		this.choices = append(header, $('.basehalf-agent-area-choices'));
		const hide = append(header, $('button.basehalf-agent-area-icon.codicon.codicon-chevron-right')) as HTMLButtonElement;
		hide.type = 'button';
		hide.title = 'Hide Agent Area';
		hide.setAttribute('aria-label', 'Hide Agent Area');
		this._register(this.addDisposableListener(hide, 'click', () => this.hide()));

		this.renderChoices();

		this.tabs = append(this.root, $('.basehalf-agent-area-tabs'));
		this.body = append(this.root, $('.basehalf-agent-area-body'));
		this.empty = append(this.body, $('.basehalf-agent-area-empty'));
		this.empty.textContent = 'Choose an agent session';

		editorContainer.appendChild(this.root);
		this.resizeObserver = new mainWindow.ResizeObserver(() => this.layoutActiveTerminal());
		this.resizeObserver.observe(this.body);

		this._register(toDisposable(() => {
			this.resizeObserver.disconnect();
			for (const session of [...this.runtimeSessions]) {
				this.disposeRuntimeSession(session, false);
			}
			this.root.remove();
			editorContainer.classList.remove('basehalf-agent-area-host', 'basehalf-agent-area-visible');
		}));
	}

	get visible(): boolean {
		return this._visible;
	}

	get sessions(): readonly IBaseHalfAgentAreaSession[] {
		return this.runtimeSessions.map(session => this.snapshotSession(session));
	}

	get activeSessionId(): string | undefined {
		return this._activeSessionId;
	}

	async show(preserveFocus = false): Promise<void> {
		if (!this._visible) {
			this._visible = true;
			this.root.classList.add('visible');
			this.root.setAttribute('aria-hidden', 'false');
			this.root.parentElement?.classList.add('basehalf-agent-area-visible');
			this._onDidChangeVisibility.fire(true);
		}

		this.updateActiveSessionVisibility();
		if (!preserveFocus) {
			await this.focusActiveSession();
		}
	}

	hide(): void {
		if (!this._visible) {
			return;
		}

		this._visible = false;
		this.root.classList.remove('visible');
		this.root.setAttribute('aria-hidden', 'true');
		this.root.parentElement?.classList.remove('basehalf-agent-area-visible');
		this.updateActiveSessionVisibility();
		this._onDidChangeVisibility.fire(false);
	}

	async toggle(preserveFocus = false): Promise<void> {
		if (this._visible) {
			this.hide();
			return;
		}

		if (!this.runtimeSessions.length) {
			await this.createTerminalSession({ source: TerminalCommandId.Toggle });
			return;
		}

		await this.show(preserveFocus);
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

		await this.show(true);
		try {
			const terminalOptions = this.createTerminalOptions(label, options);
			const terminal = await this.terminalService.createTerminal(terminalOptions);
			await this.attachTerminalToSession(session, terminal, command);
		} catch (error) {
			this.markSessionFailed(session, error);
		}

		return this.snapshotSession(session);
	}

	async adoptTerminalSession(terminal: unknown, options: IBaseHalfAdoptAgentTerminalOptions = {}): Promise<IBaseHalfAgentAreaSession> {
		if (!this.isTerminalInstance(terminal)) {
			throw new Error('BaseHalf Agent Area can only adopt a VS Code terminal instance.');
		}

		const existing = this.runtimeSessions.find(session => session.terminal === terminal);
		if (existing) {
			if (options.label && options.label !== existing.label) {
				existing.label = options.label;
				this.fireSessionsChanged();
			}
			if (options.reveal !== false) {
				this._activeSessionId = existing.id;
				this.fireSessionsChanged();
				await this.show(options.preserveFocus);
			}
			return this.snapshotSession(existing);
		}

		const choice = baseHalfAgentSessionChoiceForKind('terminal');
		const label = options.label ?? terminal.title ?? choice.label;
		const shouldReveal = options.reveal !== false;
		const session = this.createRuntimeSession(choice.kind, label, choice.description, shouldReveal);
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

	hideTerminalSession(terminal: unknown): void {
		if (!this.isTerminalInstance(terminal)) {
			return;
		}

		const session = this.runtimeSessions.find(session => session.terminal === terminal);
		if (session?.id === this._activeSessionId) {
			this.hide();
		}
	}

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

	registerExtensionAgentProvider(kind: BaseHalfExtensionAgentSessionKind, provider: IBaseHalfExtensionAgentProvider): IDisposable {
		this.extensionProviders.set(kind, provider);
		return toDisposable(() => {
			if (this.extensionProviders.get(kind) === provider) {
				this.extensionProviders.delete(kind);
			}
		});
	}

	async focusSession(id: string): Promise<void> {
		if (!this.runtimeSessions.some(session => session.id === id)) {
			return;
		}

		this._activeSessionId = id;
		this.fireSessionsChanged();
		await this.show(false);
	}

	async closeSession(id: string): Promise<void> {
		const session = this.runtimeSessions.find(session => session.id === id);
		if (!session || session.closing) {
			return;
		}

		session.closing = true;
		if (session.terminal && !session.terminal.isDisposed) {
			await this.terminalService.safeDisposeTerminal(session.terminal);
			if (!session.terminal.isDisposed) {
				session.closing = false;
				this.fireSessionsChanged();
				return;
			}
		}

		this.removeRuntimeSession(id, true);
	}

	private async createExtensionAgentSession(kind: BaseHalfExtensionAgentSessionKind): Promise<IBaseHalfAgentAreaSession> {
		const choice = baseHalfAgentSessionChoiceForKind(kind);
		const session = this.createRuntimeSession(kind, choice.label, choice.description);
		await this.show(true);

		const provider = this.extensionProviders.get(kind);
		if (!provider) {
			session.state = 'unavailable';
			session.detail = `${choice.label} is not registered in the BaseHalf Agent Area yet.`;
			this.renderExtensionState(session);
			this.fireSessionsChanged();
			await this.focusSession(session.id);
			return this.snapshotSession(session);
		}

		try {
			const result = await provider.createSession(kind, session.host);
			this.applyExtensionAgentProviderResult(session, result);
			session.state = 'ready';
			this.fireSessionsChanged();
			await this.focusSession(session.id);
		} catch (error) {
			this.markSessionFailed(session, error);
		}

		return this.snapshotSession(session);
	}

	private isTerminalInstance(candidate: unknown): candidate is ITerminalInstance {
		return isObject(candidate)
			&& typeof (candidate as Partial<ITerminalInstance>).attachToElement === 'function'
			&& typeof (candidate as Partial<ITerminalInstance>).setVisible === 'function'
			&& typeof (candidate as Partial<ITerminalInstance>).focusWhenReady === 'function';
	}

	private async attachTerminalToSession(session: IBaseHalfRuntimeAgentSession, terminal: ITerminalInstance, command?: string, focus = true): Promise<void> {
		session.terminal = terminal;
		session.disposables.add(terminal.onDisposed(() => this.removeRuntimeSession(session.id, false)));
		session.disposables.add(terminal.onTitleChanged(instance => {
			if (instance.title) {
				session.label = instance.title;
				this.fireSessionsChanged();
			}
		}));

		terminal.attachToElement(session.host);
		this.terminalService.setActiveInstance(terminal);
		session.state = 'ready';
		session.detail = command ? `Started ${command}` : undefined;
		this.fireSessionsChanged();
		this.updateActiveSessionVisibility();
		if (command) {
			await terminal.sendText(command, true);
		}
		if (focus) {
			await this.focusActiveSession();
		}
	}

	private applyExtensionAgentProviderResult(session: IBaseHalfRuntimeAgentSession, result: IBaseHalfExtensionAgentProviderResult): void {
		session.label = result.label ?? session.label;
		session.description = result.description ?? session.description;
		session.detail = result.detail;
		session.extensionFocus = result.focus;
		session.extensionDispose = result.dispose;
		if (result.dispose) {
			session.disposables.add(toDisposable(() => {
				void result.dispose?.();
			}));
		}
	}

	private createRuntimeSession(kind: BaseHalfAgentSessionKind, label: string, description: string, activate = true): IBaseHalfRuntimeAgentSession {
		const session: IBaseHalfRuntimeAgentSession = {
			id: `basehalf-agent-${BaseHalfAgentAreaService.nextSessionId++}`,
			kind,
			label,
			description,
			state: 'starting',
			host: append(this.body, $('.basehalf-agent-area-session')),
			disposables: new DisposableStore()
		};
		session.host.setAttribute('role', 'tabpanel');
		session.host.setAttribute('aria-label', label);
		session.disposables.add(toDisposable(() => session.host.remove()));
		this.runtimeSessions.push(session);
		if (activate) {
			this._activeSessionId = session.id;
		}
		this.fireSessionsChanged();
		this.updateActiveSessionVisibility();
		return session;
	}

	private removeRuntimeSession(id: string, dispose: boolean): void {
		const index = this.runtimeSessions.findIndex(session => session.id === id);
		if (index === -1) {
			return;
		}

		const [session] = this.runtimeSessions.splice(index, 1);
		if (dispose) {
			this.disposeRuntimeSession(session, false);
		}

		if (this._activeSessionId === id) {
			const next = this.runtimeSessions[Math.min(index, this.runtimeSessions.length - 1)];
			this._activeSessionId = next?.id;
		}

		this.fireSessionsChanged();
		this.updateActiveSessionVisibility();
	}

	private disposeRuntimeSession(session: IBaseHalfRuntimeAgentSession, killTerminal: boolean): void {
		if (killTerminal && session.terminal && !session.terminal.isDisposed) {
			void this.terminalService.safeDisposeTerminal(session.terminal);
		}
		session.state = 'disposed';
		session.disposables.dispose();
	}

	private renderChoices(): void {
		clearNode(this.choices);
		for (const choice of BASEHALF_VISIBLE_AGENT_SESSION_CHOICES) {
			const button = append(this.choices, $('button.basehalf-agent-choice')) as HTMLButtonElement;
			button.type = 'button';
			button.title = choice.description;
			button.setAttribute('aria-label', choice.label);
			const icon = append(button, $(`span.codicon.${this.choiceIconClass(choice.kind)}`));
			icon.setAttribute('aria-hidden', 'true');
			const label = append(button, $('span.basehalf-agent-choice-label'));
			label.textContent = choice.label;
			this._register(this.addDisposableListener(button, 'click', () => {
				void this.createSession(choice.kind);
			}));
		}
	}

	private renderTabs(): void {
		clearNode(this.tabs);
		this.tabs.classList.toggle('empty', this.runtimeSessions.length === 0);
		this.empty.classList.toggle('visible', this.runtimeSessions.length === 0);

		for (const session of this.runtimeSessions) {
			const tab = append(this.tabs, $('.basehalf-agent-tab'));
			tab.classList.toggle('active', session.id === this._activeSessionId);
			tab.classList.toggle('starting', session.state === 'starting');
			tab.classList.toggle('unavailable', session.state === 'unavailable' || session.state === 'failed');

			const select = append(tab, $('button.basehalf-agent-tab-select')) as HTMLButtonElement;
			select.type = 'button';
			select.title = session.detail ? `${session.label} - ${session.detail}` : session.label;
			select.setAttribute('aria-selected', String(session.id === this._activeSessionId));
			const icon = append(select, $(`span.codicon.${this.choiceIconClass(session.kind)}`));
			icon.setAttribute('aria-hidden', 'true');
			const label = append(select, $('span.basehalf-agent-tab-label'));
			label.textContent = session.label;
			const state = append(select, $('span.basehalf-agent-tab-state'));
			state.textContent = this.stateLabel(session.state);
			select.addEventListener('click', () => {
				void this.focusSession(session.id);
			});

			const close = append(tab, $('button.basehalf-agent-tab-close.codicon.codicon-close')) as HTMLButtonElement;
			close.type = 'button';
			close.title = 'Close Session';
			close.setAttribute('aria-label', `Close ${session.label}`);
			close.disabled = session.closing === true;
			close.addEventListener('click', event => {
				event.stopPropagation();
				void this.closeSession(session.id);
			});
		}
	}

	private renderExtensionState(session: IBaseHalfRuntimeAgentSession): void {
		clearNode(session.host);
		const panel = append(session.host, $('.basehalf-agent-extension-state'));
		const icon = append(panel, $(`span.codicon.${this.choiceIconClass(session.kind)}`));
		icon.setAttribute('aria-hidden', 'true');
		const title = append(panel, $('.basehalf-agent-extension-title'));
		title.textContent = session.label;
		const message = append(panel, $('.basehalf-agent-extension-message'));
		message.textContent = session.detail ?? session.description;
	}

	private updateActiveSessionVisibility(): void {
		for (const session of this.runtimeSessions) {
			const active = this._visible && session.id === this._activeSessionId;
			session.host.classList.toggle('active', active);
			session.host.setAttribute('aria-hidden', String(!active));
			session.terminal?.setVisible(active);
			if (active && (session.state === 'unavailable' || session.state === 'failed')) {
				this.renderExtensionState(session);
			}
		}

		this.layoutActiveTerminal();
	}

	private async focusActiveSession(): Promise<void> {
		const session = this.runtimeSessions.find(session => session.id === this._activeSessionId);
		if (!this._visible || !session) {
			return;
		}

		if (session.terminal) {
			this.terminalService.setActiveInstance(session.terminal);
			session.terminal.setVisible(true);
			this.layoutActiveTerminal();
			await session.terminal.focusWhenReady(true);
			return;
		}

		if (session.extensionFocus) {
			await session.extensionFocus();
			return;
		}

		const focusable = session.host.querySelector<HTMLElement>('button, [tabindex]:not([tabindex="-1"])');
		focusable?.focus();
	}

	private layoutActiveTerminal(): void {
		const session = this.runtimeSessions.find(session => session.id === this._activeSessionId);
		if (!this._visible || !session?.terminal || !session.host.classList.contains('active')) {
			return;
		}

		const width = Math.max(1, Math.floor(session.host.clientWidth));
		const height = Math.max(1, Math.floor(session.host.clientHeight));
		session.terminal.layout({ width, height });
	}

	private createTerminalOptions(label: string, options: IBaseHalfCreateAgentTerminalOptions): ICreateTerminalOptions | undefined {
		const raw = this.asTerminalOptions(options.rawTerminalOptions);
		const terminalOptions: ICreateTerminalOptions = raw ? { ...raw } : {};
		if (!terminalOptions.config) {
			terminalOptions.config = { name: label };
		}
		return terminalOptions;
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

	private markSessionFailed(session: IBaseHalfRuntimeAgentSession, error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		session.state = 'failed';
		session.detail = message;
		this.renderExtensionState(session);
		this.fireSessionsChanged();
		this.logService.error(error instanceof Error ? error : message);
		this.notificationService.notify({
			severity: Severity.Error,
			message: `BaseHalf Agent Area failed to start ${session.label}: ${message}`
		});
	}

	private fireSessionsChanged(): void {
		this.renderTabs();
		this._onDidChangeSessions.fire(this.sessions);
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

	private addDisposableListener<K extends keyof HTMLElementEventMap>(node: HTMLElement, type: K, listener: (event: HTMLElementEventMap[K]) => void) {
		node.addEventListener(type, listener);
		return {
			dispose: () => node.removeEventListener(type, listener)
		};
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
			},
			menu: [{ id: MenuId.CommandPalette }]
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
			f1: true,
			menu: [{ id: MenuId.CommandPalette }]
		});
	}

	run(accessor: ServicesAccessor): Promise<void> {
		return accessor.get(IBaseHalfAgentAreaService).toggle();
	}
});

function registerCreateAgentSessionAction(id: string, kind: BaseHalfAgentSessionKind, title: string): void {
	registerAction2(class BaseHalfCreateAgentSessionAction extends Action2 {
		constructor() {
			super({
				id,
				title: actionTitle(title),
				category: localize2('basehalf.category', 'BaseHalf'),
				f1: true,
				menu: [{ id: MenuId.CommandPalette }]
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

registerWorkbenchContribution2(BaseHalfAgentAreaWorkbenchContribution.ID, BaseHalfAgentAreaWorkbenchContribution, WorkbenchPhase.AfterRestored);

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
