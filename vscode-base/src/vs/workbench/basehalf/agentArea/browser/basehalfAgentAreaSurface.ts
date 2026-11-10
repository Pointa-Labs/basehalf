/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { BASEHALF_VISIBLE_AGENT_SESSION_CHOICES } from '../common/basehalfAgentArea.js';
import { activeAgentTab, agentTabForPane, setAgentSplitFraction } from '../common/basehalfAgentTabsModel.js';
import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { leafRects, splitDividers } from '../common/basehalfAgentSplitTree.js';
import { toAction } from '../../../../base/common/actions.js';
import type { BaseHalfAgentAreaService, IBaseHalfRuntimeAgentSession } from './basehalfAgentAreaService.js';

const RESIZE_HUD_MS = 750;

const DIVIDER_MIN_PANE_PX = 48;

/**
 * What the body of the Agent Area shows: the panes of the active tab and the dividers between them, the toasts
 * of closed panes, the size shown while a pane is resized, the empty state with its choices, and the panel that
 * says what a session waits for or why it failed.
 *
 * A part of the Agent Area (`basehalfAgentAreaService.ts`): it keeps its own state, and reaches the
 * Agent Area's as `area`.
 */
export class BaseHalfAgentAreaSurface {
	private hudTimer: number | undefined;

	constructor(private readonly area: BaseHalfAgentAreaService) { }

	renderPanes(): void {
		const state = this.area.tabsState;
		const activeTab = activeAgentTab(state);
		const rects = activeTab ? leafRects(activeTab.tree) : new Map<string, { x: number; y: number; w: number; h: number }>();
		const zoomedPaneId = activeTab?.zoomedPaneId ?? null;
		const multiPane = !!activeTab && activeTab.tree.type === 'split';

		for (const session of this.area.runtime.values()) {
			const owner = agentTabForPane(state, session.id);
			const inActiveTab = !!owner && owner.id === state.activeTabId;
			const isZoomed = inActiveTab && zoomedPaneId === session.id;
			const rect = inActiveTab ? rects.get(session.id) : undefined;
			const visible = this.area.visible && inActiveTab && (!zoomedPaneId || isZoomed) && (!!rect || isZoomed);

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
			session.host.classList.toggle('drop-target', visible && !!this.area.paneDragId && this.area.paneDragId !== session.id);
			if (!this.area.paneDragId) {
				session.host.classList.remove('pane-dragging');
				session.dropPreview.classList.remove('visible');
			}

			session.terminal?.setVisible(visible);
			session.extensionSetVisible?.(visible);
			if (visible && (session.state === 'unavailable' || session.state === 'failed')) {
				this.renderSessionStatePanel(session);
			}
		}

		this.area.zoomBadge.classList.toggle('visible', this.area.visible && !!zoomedPaneId);
	}

	renderDividers(): void {
		clearNode(this.area.dividersLayer);
		const activeTab = activeAgentTab(this.area.tabsState);
		if (!this.area.visible || !activeTab || activeTab.zoomedPaneId || activeTab.tree.type === 'leaf') {
			return;
		}

		for (const divider of splitDividers(activeTab.tree)) {
			const row = divider.dir === 'row';
			const el = append(this.area.dividersLayer, $(`.basehalf-agent-divider.${row ? 'row' : 'column'}`));
			if (row) {
				el.style.left = `${divider.rect.x * 100}%`;
			} else {
				el.style.top = `${divider.rect.y * 100}%`;
			}
			append(el, $('.basehalf-agent-divider-line'));
			el.addEventListener('dblclick', () => {
				this.area.mutateTabs(state => setAgentSplitFraction(state, divider.splitId, 0.5));
				this.showResizeHud();
			});
			el.addEventListener('mousedown', e => {
				e.preventDefault();
				e.stopPropagation();
				el.classList.add('dragging');
				const doc = mainWindow.document;
				const onMove = (ev: MouseEvent) => {
					const box = this.area.body.getBoundingClientRect();
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
					this.area.mutateTabs(state => setAgentSplitFraction(state, divider.splitId, local));
					this.showResizeHud();
				};
				const onUp = () => {
					doc.removeEventListener('mousemove', onMove);
					doc.removeEventListener('mouseup', onUp);
					el.classList.remove('dragging');
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

	renderToasts(): void {
		clearNode(this.area.toasts);
		for (const entry of this.area.tabsState.closing) {
			const name = entry.kind === 'tab'
				? (entry.tab.titleOverride ?? this.area.runtime.get(entry.tab.activePaneId)?.label ?? 'Agent')
				: (this.area.runtime.get(entry.paneId)?.label ?? 'Agent');
			const toast = append(this.area.toasts, $('.basehalf-agent-toast'));
			const text = append(toast, $('span.basehalf-agent-toast-text'));
			text.textContent = `Closed ${entry.kind === 'tab' ? 'tab' : 'pane'} “${name}”`;
			const undo = append(toast, $('button.basehalf-agent-toast-undo')) as HTMLButtonElement;
			undo.type = 'button';
			undo.textContent = 'Undo';
			undo.addEventListener('click', () => this.area.undoClose(entry.key));
			const dismiss = append(toast, $('button.basehalf-agent-toast-dismiss.codicon.codicon-close')) as HTMLButtonElement;
			dismiss.type = 'button';
			dismiss.setAttribute('aria-label', 'Dismiss');
			dismiss.addEventListener('click', () => this.area.finalizeClose(entry.key));
		}
	}

	showResizeHud(): void {
		const activeTab = activeAgentTab(this.area.tabsState);
		const session = activeTab ? this.area.runtime.get(activeTab.activePaneId) : undefined;
		if (!activeTab || !session?.terminal || activeTab.tree.type === 'leaf') {
			return;
		}
		const rect = leafRects(activeTab.tree).get(session.id);
		if (!rect) {
			return;
		}
		this.area.hud.textContent = `${session.terminal.cols} x ${session.terminal.rows}`;
		this.area.hud.style.left = `${(rect.x + rect.w / 2) * 100}%`;
		this.area.hud.style.top = `${(rect.y + rect.h / 2) * 100}%`;
		this.area.hud.classList.add('visible');
		if (this.hudTimer !== undefined) {
			mainWindow.clearTimeout(this.hudTimer);
		}
		this.hudTimer = mainWindow.setTimeout(() => {
			this.area.hud.classList.remove('visible');
			this.hudTimer = undefined;
		}, RESIZE_HUD_MS);
	}

	async focusActivePane(): Promise<void> {
		const activeTab = activeAgentTab(this.area.tabsState);
		const session = activeTab ? this.area.runtime.get(activeTab.activePaneId) : undefined;
		if (!this.area.visible || !session) {
			return;
		}

		if (session.terminal) {
			this.area.terminalPanes.setActiveTerminalForVsCodeCompatibility(session.terminal);
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

	layoutVisiblePanes(): void {
		if (!this.area.visible) {
			return;
		}
		this.area.tabs.updateTabDensity();
		for (const session of this.area.runtime.values()) {
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
	buildEmptyStatePicker(): void {
		clearNode(this.area.empty);
		const emptyTitle = append(this.area.empty, $('.basehalf-agent-empty-title'));
		emptyTitle.textContent = 'Start an agent session';
		const choices = append(this.area.empty, $('.basehalf-agent-empty-choices'));
		for (const choice of BASEHALF_VISIBLE_AGENT_SESSION_CHOICES) {
			const button = append(choices, $('button.basehalf-agent-empty-choice')) as HTMLButtonElement;
			button.type = 'button';
			button.setAttribute('aria-label', choice.label);
			const icon = append(button, $(`span.codicon.${this.area.choiceIconClass(choice.kind)}`));
			icon.setAttribute('aria-hidden', 'true');
			const text = append(button, $('.basehalf-agent-empty-choice-text'));
			const label = append(text, $('.basehalf-agent-empty-choice-label'));
			label.textContent = choice.label;
			const description = append(text, $('.basehalf-agent-empty-choice-desc'));
			description.textContent = choice.description;
			button.addEventListener('click', () => {
				void this.area.createSession(choice.kind);
			});
		}
	}

	showNewSessionMenu(anchor: HTMLElement): void {
		this.area.contextMenuService.showContextMenu({
			getAnchor: () => anchor,
			getActions: () => BASEHALF_VISIBLE_AGENT_SESSION_CHOICES.map(choice => toAction({
				id: `basehalf.agentArea.menu.${choice.kind}`,
				label: choice.label,
				tooltip: choice.description,
				run: () => void this.area.createSession(choice.kind)
			}))
		});
	}

	renderSessionStatePanel(session: IBaseHalfRuntimeAgentSession, primaryAction?: { label: string; run: () => void | Promise<void> }): void {
		// The action is stored on the session so re-renders (layout, visibility)
		// keep it instead of falling back to the default Retry button.
		if (primaryAction) {
			session.statePrimaryAction = primaryAction;
		}
		const action = primaryAction ?? session.statePrimaryAction;
		clearNode(session.statePanel);
		session.host.classList.add('has-state');
		// While a session is progressing (e.g. installing its extension) the
		// panel is a progress surface: spinner icon, no action button.
		const inProgress = session.state === 'starting';
		const iconClasses = inProgress ? 'codicon-loading.codicon-modifier-spin' : this.area.choiceIconClass(session.kind);
		const icon = append(session.statePanel, $(`span.codicon.${iconClasses}`));
		icon.setAttribute('aria-hidden', 'true');
		const title = append(session.statePanel, $('.basehalf-agent-session-state-title'));
		title.textContent = session.label;
		const message = append(session.statePanel, $('.basehalf-agent-session-state-message'));
		message.textContent = session.detail ?? session.description;
		if (inProgress && !action) {
			return;
		}
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
			void this.area.restartSession(session.id);
		});
	}

	clearSessionStatePanel(session: IBaseHalfRuntimeAgentSession): void {
		session.host.classList.remove('has-state');
		session.statePrimaryAction = undefined;
		clearNode(session.statePanel);
	}
}
