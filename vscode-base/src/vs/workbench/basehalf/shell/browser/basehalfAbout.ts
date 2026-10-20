/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfAbout.css';
import { $, addDisposableListener, append, Dimension } from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IUpdateService, State } from '../../../../platform/update/common/update.js';
import { ISettingsCustomSection } from '../../../contrib/preferences/browser/settingsCustomSections.js';
import { UpdateTooltip } from '../../../contrib/update/browser/updateTooltip.js';
import { BASEHALF_ABOUT_ACTION_COMMANDS, BaseHalfAboutAction, baseHalfAboutAction } from '../common/basehalfAbout.js';

/**
 * The About page of Settings (app update, "Where an update shows"): the
 * status element that the base draws for an update, shown here and not in a
 * card of the title bar, and below it the one action the state calls for.
 */
export class BaseHalfAboutView extends Disposable implements ISettingsCustomSection {
	private root: HTMLElement | undefined;
	private actionButton: HTMLButtonElement | undefined;
	private action: BaseHalfAboutAction | undefined;
	private readonly status: UpdateTooltip;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IUpdateService private readonly updateService: IUpdateService,
		@ICommandService private readonly commandService: ICommandService
	) {
		super();
		this.status = this._register(instantiationService.createInstance(UpdateTooltip));
		this._register(this.updateService.onStateChange(state => this.render(state)));
	}

	create(parent: HTMLElement): void {
		this.root = append(parent, $('.basehalf-about'));
		this.root.setAttribute('role', 'main');
		this.root.setAttribute('aria-labelledby', 'basehalf-about-title');
		this.root.tabIndex = -1;

		const title = append(this.root, $('h1#basehalf-about-title'));
		title.textContent = localize('basehalf.about.title', "About");

		const content = append(this.root, $('.basehalf-about-content'));
		content.appendChild(this.status.domNode);
		const actions = append(content, $('.basehalf-about-actions'));
		this.actionButton = append(actions, $('button.basehalf-about-action')) as HTMLButtonElement;
		this._register(addDisposableListener(this.actionButton, 'click', () => {
			if (this.action) {
				void this.commandService.executeCommand(BASEHALF_ABOUT_ACTION_COMMANDS[this.action]);
			}
		}));

		this.render(this.updateService.state);
	}

	private render(state: State): void {
		this.status.renderState(state);
		this.action = baseHalfAboutAction(state);
		if (this.actionButton) {
			this.actionButton.hidden = !this.action;
			this.actionButton.textContent = this.action ? actionLabel(this.action) : '';
		}
	}

	setInput(): void {
		// The page has one content.
	}

	setVisible(visible: boolean): void {
		if (this.root) {
			this.root.hidden = !visible;
		}
	}

	layout(dimension: Dimension): void {
		if (this.root) {
			this.root.style.width = `${dimension.width}px`;
			this.root.style.height = `${dimension.height}px`;
		}
	}

	focus(): void {
		(this.action ? this.actionButton : this.root)?.focus();
	}
}

function actionLabel(action: BaseHalfAboutAction): string {
	switch (action) {
		case 'check': return localize('basehalf.about.check', "Check for Updates");
		case 'download': return localize('basehalf.about.download', "Download Update");
		case 'install': return localize('basehalf.about.install', "Install Update");
		case 'restart': return localize('basehalf.about.restart', "Restart to Update");
	}
}
