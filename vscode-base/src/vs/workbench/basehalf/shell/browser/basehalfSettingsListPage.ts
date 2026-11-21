/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, EventType, getActiveElement } from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { equals } from '../../../../base/common/objects.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IBaseHalfSettingsPage, IBaseHalfSettingsPageLayout } from '../../ui/browser/basehalfSettingsPage.js';
import { BaseHalfSettingsListPageId } from '../common/basehalfSettings.js';
import { baseHalfShownSettings, IBaseHalfSettingOption, IBaseHalfShownSetting } from './basehalfShownSettings.js';

/** Numbers the pages, so that the ids of each page's elements are its own. */
let pageCount = 0;

/**
 * One setting on a page: its name, a line about it where its name does not say enough, and its
 * control. The control shows the value in effect and writes where that value comes from, as the
 * base writes a setting it is given no place for: the settings file of the folder when the folder
 * sets it, and the user's otherwise, where a value equal to the default is written as no value.
 */
export class BaseHalfSettingRow extends Disposable {
	readonly element: HTMLElement;
	private readonly control: HTMLInputElement | HTMLSelectElement | HTMLButtonElement;

	constructor(
		parent: HTMLElement,
		private readonly setting: IBaseHalfShownSetting,
		id: string,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();
		this.element = append(parent, $('.basehalf-settings-row'));
		this.element.dataset.setting = setting.key;
		const text = append(this.element, $('.basehalf-settings-row-text'));
		const label = append(text, $('label.basehalf-settings-row-label')) as HTMLLabelElement;
		label.textContent = setting.label;
		label.htmlFor = id;
		label.id = `${id}-label`;
		let descriptionId: string | undefined;
		if (setting.description) {
			const description = append(text, $('.basehalf-settings-row-description'));
			description.textContent = setting.description;
			description.id = descriptionId = `${id}-description`;
		}

		this.control = this.createControl(append(this.element, $('.basehalf-settings-row-control')));
		this.control.id = id;
		if (descriptionId) {
			this.control.setAttribute('aria-describedby', descriptionId);
		}
		this.refresh();
	}

	/** Shows the value in effect, unless the user is typing it. */
	refresh(): void {
		const value = this.configurationService.getValue(this.setting.key);
		const control = this.control;
		const kind = this.setting.control.kind;
		if (kind === 'switch') {
			control.setAttribute('aria-checked', String(value === true));
		} else if (kind === 'choice') {
			this.showChoice(control as HTMLSelectElement, value);
		} else if (getActiveElement() !== control) {
			(control as HTMLInputElement).value = value === undefined || value === null ? '' : String(value);
		}
	}

	focus(): void {
		this.control.focus();
	}

	private createControl(parent: HTMLElement): HTMLInputElement | HTMLSelectElement | HTMLButtonElement {
		const control = this.setting.control;
		switch (control.kind) {
			case 'switch': {
				const button = append(parent, $('button.basehalf-settings-switch')) as HTMLButtonElement;
				button.type = 'button';
				button.setAttribute('role', 'switch');
				append(button, $('span.basehalf-settings-switch-thumb')).setAttribute('aria-hidden', 'true');
				this._register(addDisposableListener(button, EventType.CLICK, () => {
					// The switch moves as it is clicked, so that a second click is its way back and not the same change again.
					const next = button.getAttribute('aria-checked') !== 'true';
					button.setAttribute('aria-checked', String(next));
					this.write(next);
				}));
				return button;
			}
			case 'choice': {
				// The system draws the list of choices; the field and its mark are the page's own.
				const field = append(parent, $('.basehalf-settings-choice'));
				const select = append(field, $('select.basehalf-settings-select')) as HTMLSelectElement;
				append(field, $('span.codicon.codicon-chevron-down')).setAttribute('aria-hidden', 'true');
				this._register(addDisposableListener(select, EventType.CHANGE, () => {
					const option = control.options.find(candidate => String(candidate.value) === select.value);
					if (option) {
						this.write(option.value);
					}
				}));
				return select;
			}
			case 'text': {
				const input = append(parent, $('input.basehalf-settings-input')) as HTMLInputElement;
				input.type = 'text';
				input.spellcheck = false;
				input.autocapitalize = 'off';
				input.autocomplete = 'off';
				if (control.placeholder) {
					input.placeholder = control.placeholder;
				}
				// An emptied text is no value: the default holds again.
				this._register(addDisposableListener(input, EventType.CHANGE, () => this.write(input.value.trim() || undefined)));
				this._register(addDisposableListener(input, EventType.BLUR, () => this.refresh()));
				return input;
			}
			case 'number': {
				const input = append(parent, $('input.basehalf-settings-input.number')) as HTMLInputElement;
				input.type = 'number';
				input.min = String(control.minimum);
				input.max = String(control.maximum);
				input.step = '1';
				this._register(addDisposableListener(input, EventType.CHANGE, () => {
					const typed = Number(input.value);
					if (input.value.trim() === '' || !Number.isFinite(typed)) {
						// Nothing that is a number: the value in effect comes back.
						input.value = String(this.configurationService.getValue(this.setting.key) ?? '');
						return;
					}
					const value = Math.min(control.maximum, Math.max(control.minimum, typed));
					input.value = String(value);
					this.write(value);
				}));
				this._register(addDisposableListener(input, EventType.BLUR, () => this.refresh()));
				return input;
			}
		}
	}

	/** The choices, and with them the value in effect when it is none of them, named as they are or as it is written. */
	private showChoice(select: HTMLSelectElement, value: unknown): void {
		const control = this.setting.control;
		if (control.kind !== 'choice') {
			return;
		}
		const options: IBaseHalfSettingOption[] = [...control.options];
		if ((typeof value === 'string' || typeof value === 'number') && !options.some(option => option.value === value)) {
			options.push({ value, label: control.name?.(value) ?? String(value) });
			if (options.every(option => typeof option.value === 'number')) {
				options.sort((a, b) => Number(a.value) - Number(b.value));
			}
		}
		const shown = Array.from(select.options).map(option => `${option.value}\n${option.textContent}`);
		if (!equals(shown, options.map(option => `${option.value}\n${option.label}`))) {
			select.textContent = '';
			for (const option of options) {
				const element = append(select, $('option')) as HTMLOptionElement;
				element.value = String(option.value);
				element.textContent = option.label;
			}
		}
		select.value = String(value);
	}

	private write(value: unknown): void {
		this.configurationService.updateValue(this.setting.key, value).then(undefined, () => undefined).finally(() => this.refresh());
	}
}

/**
 * A group of settings: rows in one box, a line between them, under a heading when the group has
 * a name of its own. A group without one is named by `labelledBy`, the page's title.
 */
export function renderBaseHalfSettingsSection(parent: HTMLElement, id: string, title: string | undefined, labelledBy?: string): HTMLElement {
	const section = append(parent, $('section.basehalf-settings-section'));
	const group = $('.basehalf-settings-group');
	group.setAttribute('role', 'group');
	if (title !== undefined) {
		const heading = append(section, $('h2'));
		heading.id = `${id}-heading`;
		heading.textContent = title;
		group.setAttribute('aria-labelledby', heading.id);
	} else {
		section.classList.add('untitled');
		if (labelledBy) {
			group.setAttribute('aria-labelledby', labelledBy);
		}
	}
	return append(section, group);
}

/**
 * A page of BaseHalf's Settings that is a list of settings (BaseHalf's Settings, "The pages"):
 * the shown settings of the catalog that belong to the page, under BaseHalf's own names.
 */
export class BaseHalfSettingsListPage extends Disposable implements IBaseHalfSettingsPage {
	private readonly idPrefix: string;
	private root: HTMLElement | undefined;
	private readonly rows: BaseHalfSettingRow[] = [];

	constructor(
		private readonly page: BaseHalfSettingsListPageId,
		private readonly title: string,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();
		this.idPrefix = `basehalf-settings-${page}-${++pageCount}`;
	}

	create(parent: HTMLElement): void {
		const root = this.root = append(parent, $(`.basehalf-settings-page.basehalf-settings-list.basehalf-settings-${this.page}`));
		root.tabIndex = -1;
		const title = append(root, $('h1'));
		title.id = `${this.idPrefix}-title`;
		title.textContent = this.title;

		const store = this._register(new DisposableStore());
		for (const section of baseHalfShownSettings(this.page)) {
			const group = renderBaseHalfSettingsSection(root, `${this.idPrefix}-${section.id}`, section.title, title.id);
			for (const setting of section.settings) {
				this.rows.push(store.add(new BaseHalfSettingRow(group, setting, `${this.idPrefix}-${setting.key.replace(/[^A-Za-z0-9]/g, '-')}`, this.configurationService)));
			}
		}
		this._register(this.configurationService.onDidChangeConfiguration(event => {
			for (const row of this.rows) {
				if (event.affectsConfiguration(row.element.dataset.setting!)) {
					row.refresh();
				}
			}
		}));
	}

	setInput(): void {
		// The page has one content.
	}

	setVisible(visible: boolean): void {
		if (this.root) {
			this.root.hidden = !visible;
		}
	}

	layout(dimension: IBaseHalfSettingsPageLayout): void {
		if (this.root) {
			this.root.style.width = `${dimension.width}px`;
			this.root.style.height = `${dimension.height}px`;
		}
	}

	focus(): void {
		this.root?.focus();
	}
}
