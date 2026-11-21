/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfSettings.css';
import { $, addDisposableListener, append, Dimension, EventType } from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { BaseHalfVideoProvidersPage } from '../../generation/browser/basehalfVideoProvidersPage.js';
import { IBaseHalfSettingsPage } from '../../ui/browser/basehalfSettingsPage.js';
import { BASEHALF_OPEN_ADVANCED_SETTINGS_COMMAND_ID, BASEHALF_SETTINGS_PAGES, BaseHalfSettingsPageId, isBaseHalfSettingsPageId } from '../common/basehalfSettings.js';
import { BaseHalfAboutView } from './basehalfAbout.js';
import { BaseHalfGeneralSettingsPage } from './basehalfGeneralSettingsPage.js';
import { IBaseHalfSettingsEditorOptions } from './basehalfSettingsEditorInput.js';

/** The width of the list of pages. */
const NAVIGATION_WIDTH = 196;

/** Numbers the editors, so that the ids of each one's elements are its own. */
let editorCount = 0;

function pageLabel(page: BaseHalfSettingsPageId): string {
	switch (page) {
		case 'general': return localize('basehalf.settings.page.general', "General");
		case 'providers': return localize('basehalf.settings.page.providers', "Providers");
		case 'about': return localize('basehalf.settings.page.about', "About");
	}
}

/**
 * BaseHalf's Settings (BaseHalf's pages in Settings): the list of its pages at the left, with
 * the way to the Settings editor of the base under it, and the page chosen beside it. A page is
 * created when it is first shown and stays while Settings is open, so what was typed in it does.
 */
export class BaseHalfSettingsEditor extends EditorPane {

	static readonly ID = 'workbench.editor.basehalfSettings';

	private readonly idPrefix = `basehalf-settings-${++editorCount}`;
	private body: HTMLElement | undefined;
	private readonly tabs = new Map<BaseHalfSettingsPageId, HTMLButtonElement>();
	private readonly pages = new Map<BaseHalfSettingsPageId, IBaseHalfSettingsPage>();
	private current: BaseHalfSettingsPageId | undefined;
	private dimension: Dimension | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ICommandService private readonly commandService: ICommandService
	) {
		super(BaseHalfSettingsEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		const root = append(parent, $('.basehalf-settings'));
		const navigation = append(root, $('nav.basehalf-settings-navigation'));
		navigation.style.width = `${NAVIGATION_WIDTH}px`;
		const list = append(navigation, $('.basehalf-settings-pages'));
		list.setAttribute('role', 'tablist');
		list.setAttribute('aria-orientation', 'vertical');
		list.setAttribute('aria-label', localize('basehalf.settings.pages', "Settings"));
		for (const page of BASEHALF_SETTINGS_PAGES) {
			const tab = append(list, $('button.basehalf-settings-page-tab')) as HTMLButtonElement;
			tab.type = 'button';
			tab.dataset.page = page;
			tab.id = `${this.idPrefix}-tab-${page}`;
			tab.textContent = pageLabel(page);
			tab.setAttribute('role', 'tab');
			tab.setAttribute('aria-controls', `${this.idPrefix}-panel`);
			this.tabs.set(page, tab);
			this._register(addDisposableListener(tab, EventType.CLICK, () => this.show(page)));
			this._register(addDisposableListener(tab, EventType.KEY_DOWN, (event: KeyboardEvent) => this.onTabKey(page, event)));
		}
		const advanced = append(navigation, $('button.basehalf-settings-advanced')) as HTMLButtonElement;
		advanced.type = 'button';
		advanced.textContent = localize('basehalf.settings.advanced', "Advanced Settings…");
		this._register(addDisposableListener(advanced, EventType.CLICK, () => void this.commandService.executeCommand(BASEHALF_OPEN_ADVANCED_SETTINGS_COMMAND_ID)));

		this.body = append(root, $('.basehalf-settings-body'));
		this.body.id = `${this.idPrefix}-panel`;
		this.body.setAttribute('role', 'tabpanel');
	}

	override async setInput(input: EditorInput, options: IBaseHalfSettingsEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		// The page stands in the first frame: it is shown before the input is awaited.
		this.showFor(options);
		await super.setInput(input, options, context, token);
	}

	override setOptions(options: IEditorOptions | undefined): void {
		super.setOptions(options);
		this.showFor(options);
	}

	/** Shows the page an opening asks for; one that names none leaves the page that is shown, or shows General. */
	private showFor(options: IBaseHalfSettingsEditorOptions | undefined): void {
		const asked = options?.basehalfSettingsPage;
		const page = isBaseHalfSettingsPageId(asked) ? asked : this.current ?? 'general';
		this.show(page, options?.basehalfSettingsPageInput, isBaseHalfSettingsPageId(asked));
	}

	private show(page: BaseHalfSettingsPageId, input?: string, asked = false): void {
		if (!this.body) {
			return;
		}
		let shown = this.pages.get(page);
		if (!shown) {
			shown = this._register(this.createPage(page));
			shown.create(this.body);
			this.pages.set(page, shown);
		}
		if (this.current !== page) {
			this.pages.get(this.current!)?.setVisible(false);
			this.current = page;
			for (const [id, tab] of this.tabs) {
				tab.setAttribute('aria-selected', String(id === page));
				tab.tabIndex = id === page ? 0 : -1;
			}
			this.body.setAttribute('aria-labelledby', `${this.idPrefix}-tab-${page}`);
		}
		if (asked || input !== undefined) {
			shown.setInput(input);
		}
		shown.setVisible(true);
		this.layoutPage();
	}

	private createPage(page: BaseHalfSettingsPageId): IBaseHalfSettingsPage {
		switch (page) {
			case 'general': return this.instantiationService.createInstance(BaseHalfGeneralSettingsPage);
			case 'providers': return this.instantiationService.createInstance(BaseHalfVideoProvidersPage);
			case 'about': return this.instantiationService.createInstance(BaseHalfAboutView);
		}
	}

	/** The arrow keys choose a page and keep the keyboard in the list; Enter moves it into the page. */
	private onTabKey(page: BaseHalfSettingsPageId, event: KeyboardEvent): void {
		const index = BASEHALF_SETTINGS_PAGES.indexOf(page);
		const next = event.key === 'ArrowDown' ? index + 1
			: event.key === 'ArrowUp' ? index - 1
				: event.key === 'Home' ? 0
					: event.key === 'End' ? BASEHALF_SETTINGS_PAGES.length - 1 : undefined;
		if (event.key === 'Enter') {
			event.preventDefault();
			this.show(page);
			this.pages.get(page)?.focus();
			return;
		}
		if (next === undefined || next < 0 || next >= BASEHALF_SETTINGS_PAGES.length || next === index) {
			return;
		}
		event.preventDefault();
		const target = BASEHALF_SETTINGS_PAGES[next];
		this.show(target);
		this.tabs.get(target)?.focus();
	}

	layout(dimension: Dimension): void {
		this.dimension = dimension;
		this.layoutPage();
	}

	private layoutPage(): void {
		const page = this.current !== undefined ? this.pages.get(this.current) : undefined;
		if (page && this.dimension) {
			page.layout({ width: Math.max(0, this.dimension.width - NAVIGATION_WIDTH), height: this.dimension.height });
		}
	}

	override focus(): void {
		super.focus();
		(this.current !== undefined ? this.pages.get(this.current) : undefined)?.focus();
	}

	override clearInput(): void {
		// A page saves what is typed in it and clears what must not stay when it is hidden.
		for (const page of this.pages.values()) {
			page.setVisible(false);
		}
		super.clearInput();
	}
}
