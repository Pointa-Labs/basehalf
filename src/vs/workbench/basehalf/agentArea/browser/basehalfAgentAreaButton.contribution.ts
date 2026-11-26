/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfAgentAreaButton.css';
import { $, append } from '../../../../base/browser/dom.js';
import { IActionViewItemOptions } from '../../../../base/browser/ui/actionbar/actionViewItems.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IActionViewItemService } from '../../../../platform/actions/browser/actionViewItemService.js';
import { MenuEntryActionViewItem } from '../../../../platform/actions/browser/menuEntryActionViewItem.js';
import { MenuId, MenuItemAction } from '../../../../platform/actions/common/actions.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ToggleAuxiliaryBarAction } from '../../../browser/parts/auxiliarybar/auxiliaryBarActions.js';
import { BASEHALF_AGENT_AREA_BELL_CONTEXT_KEY } from './basehalfAgentAreaService.js';

const BELL_KEYS = new Set([BASEHALF_AGENT_AREA_BELL_CONTEXT_KEY.key]);

/**
 * The button of the title bar that shows and hides the Agent Area. It is the base's button, and shows a dot
 * while a session rang its bell with the Agent Area hidden (docs/specs/agent-area-terminal.md, The bell). The
 * Agent Area says so through a context key, so that the button needs nothing else of it.
 */
export class BaseHalfAgentAreaButtonViewItem extends MenuEntryActionViewItem {

	override render(container: HTMLElement): void {
		super.render(container);
		container.classList.add('basehalf-agent-area-button');
		const dot = append(container, $('span.basehalf-agent-area-button-bell'));
		dot.setAttribute('aria-hidden', 'true');
		this.showBell();
		this._register(this._contextKeyService.onDidChangeContext(event => {
			if (event.affectsSome(BELL_KEYS)) {
				this.showBell();
			}
		}));
	}

	private get hasBell(): boolean {
		return this._contextKeyService.getContextKeyValue<boolean>(BASEHALF_AGENT_AREA_BELL_CONTEXT_KEY.key) === true;
	}

	private showBell(): void {
		this.element?.classList.toggle('has-bell', this.hasBell);
		// The name of the button says it too, for a screen reader.
		this.updateTooltip();
	}

	protected override getTooltip(): string {
		const tooltip = super.getTooltip();
		return this.hasBell ? localize('basehalf.agentArea.buttonBell', "{0}. A session rang its bell.", tooltip) : tooltip;
	}
}

/**
 * Gives the title bar the Agent Area's button, at either end of the title bar (docs/specs/layout-controls.md).
 * Registered before the title bar is drawn.
 */
class BaseHalfAgentAreaButtonContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.basehalf.agentAreaButton';

	constructor(@IActionViewItemService actionViewItemService: IActionViewItemService) {
		super();
		for (const menu of [MenuId.LayoutControlMenu, MenuId.TitleBarLeft]) {
			this._register(actionViewItemService.register(menu, ToggleAuxiliaryBarAction.ID, (action, options: IActionViewItemOptions, instantiationService) =>
				action instanceof MenuItemAction ? instantiationService.createInstance(BaseHalfAgentAreaButtonViewItem, action, options) : undefined));
		}
	}
}

registerWorkbenchContribution2(BaseHalfAgentAreaButtonContribution.ID, BaseHalfAgentAreaButtonContribution, WorkbenchPhase.BlockStartup);
