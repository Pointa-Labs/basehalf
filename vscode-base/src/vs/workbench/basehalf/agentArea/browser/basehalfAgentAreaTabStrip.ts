/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { activeAgentTab, selectAgentTab, IBaseHalfAgentTab, setAgentTabTitle, reorderAgentTab } from '../common/basehalfAgentTabsModel.js';
import { $, append, clearNode, reset, scheduleAtNextAnimationFrame } from '../../../../base/browser/dom.js';
import { renderLabelWithIcons } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { stripIcons } from '../../../../base/common/iconLabels.js';
import { IDisposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { IBaseHalfAgentSessionName, baseHalfAgentTabName } from '../common/basehalfAgentSessionName.js';
import { baseHalfAgentSessionShowsBell } from '../common/basehalfAgentSessionBell.js';
import { orderedLeafIds } from '../common/basehalfAgentSplitTree.js';
import { setBaseHalfHover } from '../../ui/browser/basehalfHover.js';
import { baseHalfRevealInStrip } from '../../ui/browser/basehalfSidewaysStrip.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { toAction, Separator } from '../../../../base/common/actions.js';
import type { BaseHalfAgentAreaService } from './basehalfAgentAreaService.js';

/** A tab as the strip drew it: the elements that hold its name, and the name they show. */
interface IBaseHalfDrawnAgentTab {
	readonly element: HTMLElement;
	readonly label: HTMLElement;
	readonly description: HTMLElement;
	readonly close: HTMLElement;
	readonly indicator: HTMLElement;
	readonly index: number;
	shown: IBaseHalfAgentSessionName;
}

/**
 * The strip of tabs of the Agent Area: each tab with its name, state, and close button, renaming a tab in place,
 * dragging a tab to another place, and a tab's context menu.
 *
 * A part of the Agent Area (`basehalfAgentAreaService.ts`): it keeps its own state, and reaches the
 * Agent Area's as `area`.
 */
export class BaseHalfAgentAreaTabStrip implements IDisposable {
	/** The tabs that show a name, by their id; a tab that is being renamed shows its field. */
	private readonly drawn = new Map<string, IBaseHalfDrawnAgentTab>();
	private readonly namesFrame = new MutableDisposable();
	private editingTabId: string | undefined;
	private editingDraft = '';
	private tabDropIndex: number | undefined;
	/** The tab that was active when the strip was drawn last. */
	private drawnActiveTabId: string | null = null;

	constructor(private readonly area: BaseHalfAgentAreaService) { }

	dispose(): void {
		this.namesFrame.dispose();
	}

	/**
	 * A session's name or description changed. Only the text of its tab changes, at the next frame: the strip
	 * is not drawn again, so it keeps its place and its tabs keep their elements, with a press, a drag, or the
	 * rename field that is under way on them. A program may set its title many times a second.
	 */
	namesChanged(): void {
		this.marksChanged();
	}

	/** A session's bell rang or ended: only the mark of its tab changes, as its name does. */
	marksChanged(): void {
		if (!this.namesFrame.value) {
			this.namesFrame.value = scheduleAtNextAnimationFrame(mainWindow, () => {
				this.namesFrame.clear();
				this.updateDrawnTabs();
			});
		}
	}

	private updateDrawnTabs(): void {
		for (const tab of this.area.tabsState.tabs) {
			const drawn = this.drawn.get(tab.id);
			if (!drawn) {
				continue;
			}
			const name = this.tabName(tab);
			if (drawn.shown.name !== name.name || drawn.shown.description !== name.description) {
				this.showName(drawn, name);
			}
			drawn.indicator.classList.toggle('has-bell', this.tabShowsBell(tab));
		}
	}

	/** A tab shows the bell of any of its panes. */
	private tabShowsBell(tab: IBaseHalfAgentTab): boolean {
		return orderedLeafIds(tab.tree).some(paneId => {
			const session = this.area.runtime.get(paneId);
			return !!session && baseHalfAgentSessionShowsBell(session.bell);
		});
	}

	private showName(drawn: IBaseHalfDrawnAgentTab, name: IBaseHalfAgentSessionName): void {
		if (drawn.shown.name !== name.name) {
			reset(drawn.label, ...renderLabelWithIcons(name.name));
		}
		if (drawn.shown.description !== name.description) {
			reset(drawn.description, ...renderLabelWithIcons(name.description));
		}
		drawn.shown = name;
		const words = stripIcons(`${name.name} ${name.description}`).trim();
		drawn.element.setAttribute('aria-label', words ? `Tab ${drawn.index + 1}: ${words}` : `Tab ${drawn.index + 1}`);
		drawn.close.setAttribute('aria-label', `Close ${stripIcons(name.name).trim() || 'tab'}`);
	}

	/**
	 * Draws the tabs. A strip with more tabs than it has room for scrolls
	 * sideways: it keeps its place when it is drawn again, and brings the tab
	 * that became active into view.
	 */
	renderTabStrip(): void {
		const state = this.area.tabsState;
		const strip = this.area.tabStrip;
		const scrolled = strip.scrollLeft;
		clearNode(strip);
		this.drawn.clear();
		this.area.tabsBar.classList.toggle('empty', state.tabs.length === 0);
		this.area.empty.classList.toggle('visible', state.tabs.length === 0);
		this.area.zoomResetButton.classList.toggle('visible', !!activeAgentTab(state)?.zoomedPaneId);

		let activeElement: HTMLElement | undefined;
		state.tabs.forEach((tab, index) => {
			const element = strip.appendChild(this.renderTab(tab, index));
			if (tab.id === state.activeTabId) {
				activeElement = element;
			}
		});
		this.updateTabDensity();
		strip.scrollLeft = scrolled;
		if (activeElement && state.activeTabId !== this.drawnActiveTabId) {
			baseHalfRevealInStrip(strip, activeElement);
		}
		this.drawnActiveTabId = state.activeTabId;
	}

	/**
	 * When tabs get narrow, the label is what identifies a session — the ⌘N
	 * shortcut badge and state text yield entirely instead of crushing it.
	 */
	updateTabDensity(): void {
		const tabs = this.area.tabsState.tabs.length;
		const compact = tabs > 0 && this.area.tabStrip.clientWidth > 0 && this.area.tabStrip.clientWidth / tabs < 96;
		this.area.tabsBar.classList.toggle('compact', compact);
	}

	/** What a tab shows: the name the user gave it, or the name and the description of the session in front. */
	private tabName(tab: IBaseHalfAgentTab): IBaseHalfAgentSessionName {
		const session = this.area.runtime.get(tab.activePaneId);
		return baseHalfAgentTabName(tab.titleOverride, session ? this.area.sessionNaming(session) : undefined);
	}

	private renderTab(tab: IBaseHalfAgentTab, index: number): HTMLElement {
		const state = this.area.tabsState;
		const active = tab.id === state.activeTabId;
		const activePane = this.area.runtime.get(tab.activePaneId);
		const attention = activePane?.state === 'unavailable' || activePane?.state === 'failed';

		const el = $('.basehalf-agent-tab');
		el.classList.toggle('active', active);
		el.classList.toggle('unavailable', attention);
		el.classList.toggle('drop-before', this.tabDropIndex === index);
		el.classList.toggle('drop-after', this.tabDropIndex === state.tabs.length && index === state.tabs.length - 1);
		el.setAttribute('role', 'tab');
		el.setAttribute('aria-selected', String(active));
		el.setAttribute('aria-label', `Tab ${index + 1}`);

		// The sides and the shoulders of the active tab, which open it into the session below (workbench
		// appearance, rule 14); the stylesheet shows them only while this tab is active.
		append(el, $('span.basehalf-agent-tab-edge')).setAttribute('aria-hidden', 'true');
		const curlLeft = append(el, $('span.basehalf-agent-tab-curl.left'));
		curlLeft.setAttribute('aria-hidden', 'true');
		const curlRight = append(el, $('span.basehalf-agent-tab-curl.right'));
		curlRight.setAttribute('aria-hidden', 'true');

		const editing = this.editingTabId === tab.id;
		el.draggable = !editing;

		el.addEventListener('mousedown', e => {
			if (editing) {
				return;
			}
			if (e.button === 1) {
				e.preventDefault();
				void this.area.softCloseTab(tab.id);
				return;
			}
			if (e.button === 0) {
				this.area.mutateTabs(s => selectAgentTab(s, tab.id));
				// After the press has had its own effect: a press on a tab, which takes no keyboard, takes the
				// keyboard away from wherever it is, also from the pane that was just given it. Not once the
				// second press of a double click has opened the field that renames a tab: the keyboard is
				// the field's then.
				mainWindow.setTimeout(() => {
					if (this.editingTabId === undefined) {
						void this.area.surface.focusActivePane();
					}
				}, 0);
			}
		});
		el.addEventListener('dblclick', () => {
			this.editingTabId = tab.id;
			this.editingDraft = tab.titleOverride ?? '';
			this.area.render();
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
			this.area.tabDragId = tab.id;
		});
		el.addEventListener('dragend', () => {
			this.area.tabDragId = undefined;
			this.setTabDropIndex(undefined);
		});
		el.addEventListener('dragover', e => {
			if (!this.area.tabDragId) {
				return;
			}
			e.preventDefault();
			const box = el.getBoundingClientRect();
			const after = e.clientX - box.left > box.width / 2;
			this.setTabDropIndex(index + (after ? 1 : 0));
		});
		el.addEventListener('drop', e => {
			if (!this.area.tabDragId) {
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
					this.area.render();
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
		const label = append(labelWrap, $('span.basehalf-agent-tab-label'));
		const description = append(labelWrap, $('span.basehalf-agent-tab-description'));
		// A session that runs, and one that waits to start, show no word of a state.
		const stateText = activePane ? this.area.stateLabel(activePane.state) : '';
		if (stateText) {
			const stateLabel = append(labelWrap, $('span.basehalf-agent-tab-state'));
			stateLabel.textContent = stateText;
		}

		const indicator = append(el, $('span.basehalf-agent-tab-indicator'));
		const close = append(indicator, $('button.basehalf-agent-tab-close.codicon.codicon-close')) as HTMLButtonElement;
		close.type = 'button';
		setBaseHalfHover(close, 'Close Tab');
		close.addEventListener('mousedown', e => {
			e.preventDefault();
			e.stopPropagation();
			void this.area.softCloseTab(tab.id);
		});
		const dot = append(indicator, $('span.basehalf-agent-tab-activity'));
		dot.setAttribute('aria-hidden', 'true');
		indicator.classList.toggle('has-activity', state.activity.includes(tab.id));
		const bell = append(indicator, $('span.basehalf-agent-tab-bell.codicon.codicon-bell'));
		bell.setAttribute('aria-hidden', 'true');
		indicator.classList.toggle('has-bell', this.tabShowsBell(tab));

		const drawn: IBaseHalfDrawnAgentTab = { element: el, label, description, close, indicator, index, shown: { name: '', description: '' } };
		this.showName(drawn, this.tabName(tab));
		this.drawn.set(tab.id, drawn);

		return el;
	}

	private commitTabRename(tabId: string, title: string): void {
		this.editingTabId = undefined;
		if (!this.area.mutateTabs(state => setAgentTabTitle(state, tabId, title))) {
			this.area.render();
		}
	}

	setTabDropIndex(index: number | undefined): void {
		if (this.tabDropIndex !== index) {
			this.tabDropIndex = index;
			this.renderTabStrip();
		}
	}

	dropDraggedTabAt(index: number): void {
		const dragged = this.area.tabDragId;
		this.area.tabDragId = undefined;
		this.tabDropIndex = undefined;
		if (dragged) {
			if (!this.area.mutateTabs(state => reorderAgentTab(state, dragged, index))) {
				this.renderTabStrip();
			}
		} else {
			this.renderTabStrip();
		}
	}

	private showTabContextMenu(tab: IBaseHalfAgentTab, event: MouseEvent): void {
		const state = this.area.tabsState;
		const index = state.tabs.findIndex(t => t.id === tab.id);
		const activePane = this.area.runtime.get(tab.activePaneId);
		this.area.contextMenuService.showContextMenu({
			getAnchor: () => ({ x: event.clientX, y: event.clientY }),
			getActions: () => [
				toAction({ id: 'basehalf.agentTab.new', label: 'New Agent Tab', run: () => void this.area.newTab() }),
				toAction({
					id: 'basehalf.agentTab.splitRight', label: 'Split Pane Right', run: () => {
						this.area.mutateTabs(s => selectAgentTab(s, tab.id));
						void this.area.splitActivePane('right');
					}
				}),
				toAction({
					id: 'basehalf.agentTab.splitDown', label: 'Split Pane Down', run: () => {
						this.area.mutateTabs(s => selectAgentTab(s, tab.id));
						void this.area.splitActivePane('down');
					}
				}),
				new Separator(),
				toAction({
					id: 'basehalf.agentTab.rename', label: 'Rename…', run: () => {
						this.editingTabId = tab.id;
						this.editingDraft = tab.titleOverride ?? '';
						this.area.render();
					}
				}),
				new Separator(),
				toAction({ id: 'basehalf.agentTab.restartPane', label: 'Restart Pane', enabled: !!activePane, run: () => void this.area.restartSession(tab.activePaneId) }),
				toAction({ id: 'basehalf.agentTab.killPane', label: 'Kill Pane', enabled: !!activePane, run: () => void this.area.killSession(tab.activePaneId) }),
				new Separator(),
				toAction({ id: 'basehalf.agentTab.close', label: 'Close Tab', run: () => void this.area.softCloseTab(tab.id) }),
				toAction({ id: 'basehalf.agentTab.closeOthers', label: 'Close Other Tabs', enabled: state.tabs.length > 1, run: () => void this.area.softCloseOtherTabs(tab.id) }),
				toAction({ id: 'basehalf.agentTab.closeRight', label: 'Close Tabs to the Right', enabled: index >= 0 && index < state.tabs.length - 1, run: () => void this.area.softCloseTabsToRight(tab.id) })
			]
		});
	}
}
