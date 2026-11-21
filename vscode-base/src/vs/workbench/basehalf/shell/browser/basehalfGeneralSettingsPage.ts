/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, EventType, getActiveElement } from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { equals } from '../../../../base/common/objects.js';
import { localize } from '../../../../nls.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { BASEHALF_AGENT_SESSION_CHOICES } from '../../agentArea/common/basehalfAgentArea.js';
import { IBaseHalfSettingsPage, IBaseHalfSettingsPageLayout } from '../../ui/browser/basehalfSettingsPage.js';
import { BaseHalfSetting } from '../common/basehalfConfiguration.js';

/** How a setting is changed on the page. */
export type BaseHalfSettingControl =
	| { readonly kind: 'switch' }
	| { readonly kind: 'choice'; readonly options: readonly IBaseHalfSettingOption[] }
	| { readonly kind: 'text'; readonly placeholder?: string }
	| { readonly kind: 'number'; readonly minimum: number; readonly maximum: number };

export interface IBaseHalfSettingOption {
	readonly value: string | number;
	readonly label: string;
}

/** A shown setting of the catalog (the settings BaseHalf offers, "Shown"), under BaseHalf's own name and words. */
export interface IBaseHalfShownSetting {
	readonly key: string;
	readonly label: string;
	readonly description?: string;
	readonly control: BaseHalfSettingControl;
}

export interface IBaseHalfShownSettingsSection {
	readonly id: string;
	readonly title: string;
	readonly settings: readonly IBaseHalfShownSetting[];
}

/** The zoom of the window is a level, each a fifth larger than the one before; the page names it by its percentage. */
function windowZoomOptions(): IBaseHalfSettingOption[] {
	return [-3, -2, -1, 0, 1, 2, 3, 4, 5].map(level => ({ value: level, label: percentage(Math.pow(1.2, level)) }));
}

function percentage(factor: number): string {
	return localize('basehalf.settings.percentage', "{0}%", Math.round(factor * 100));
}

/** The settings of the General page, in its order. `update.mode` is on the About page, with the state of an update. */
export function baseHalfGeneralSettings(): IBaseHalfShownSettingsSection[] {
	return [
		{
			id: 'window',
			title: localize('basehalf.settings.window', "Window"),
			settings: [{
				key: 'window.zoomLevel',
				label: localize('basehalf.settings.zoom', "Zoom"),
				control: { kind: 'choice', options: windowZoomOptions() }
			}]
		},
		{
			id: 'canvas',
			title: localize('basehalf.settings.canvas', "Canvas"),
			settings: [{
				key: BaseHalfSetting.CanvasDefaultZoom,
				label: localize('basehalf.settings.canvasZoom', "Zoom of a New Folder"),
				description: localize('basehalf.settings.canvasZoomDescription', "The largest zoom at which a folder first shows all its cards."),
				control: { kind: 'choice', options: [0.25, 0.33, 0.5, 0.67, 0.75, 1].map(zoom => ({ value: zoom, label: percentage(zoom) })) }
			}]
		},
		{
			id: 'notes',
			title: localize('basehalf.settings.notes', "Notes"),
			settings: [{
				key: BaseHalfSetting.EditorReadingMode,
				label: localize('basehalf.settings.readingAids', "Reading Aids"),
				description: localize('basehalf.settings.readingAidsDescription', "Keywords stand out, and a paragraph can be marked as read."),
				control: { kind: 'switch' }
			}]
		},
		{
			id: 'code',
			title: localize('basehalf.settings.code', "Code"),
			settings: [{
				key: 'editor.fontFamily',
				label: localize('basehalf.settings.codeFont', "Font"),
				control: { kind: 'text' }
			}, {
				key: 'editor.fontSize',
				label: localize('basehalf.settings.codeFontSize', "Font Size"),
				description: localize('basehalf.settings.codeFontSizeDescription', "In Source. A code card keeps its size."),
				control: { kind: 'number', minimum: 6, maximum: 100 }
			}, {
				key: 'editor.wordWrap',
				label: localize('basehalf.settings.wordWrap', "Wrap Long Lines"),
				description: localize('basehalf.settings.wordWrapDescription', "In Source."),
				control: {
					kind: 'choice', options: [
						{ value: 'off', label: localize('basehalf.settings.off', "Off") },
						{ value: 'on', label: localize('basehalf.settings.on', "On") }
					]
				}
			}]
		},
		{
			id: 'files',
			title: localize('basehalf.settings.files', "Files"),
			settings: [{
				key: BaseHalfSetting.FilesShowHiddenFolder,
				label: localize('basehalf.settings.showHiddenFolder', "Show the .bh Folder"),
				description: localize('basehalf.settings.showHiddenFolderDescription', "It holds the files of notes and the records of cards."),
				control: { kind: 'switch' }
			}]
		},
		{
			id: 'agentArea',
			title: localize('basehalf.settings.agentArea', "Agent Area"),
			settings: [{
				key: BaseHalfSetting.AgentDefaultSession,
				label: localize('basehalf.settings.defaultSession', "First Session"),
				description: localize('basehalf.settings.defaultSessionDescription', "Started when the Agent Area opens with no session."),
				control: { kind: 'choice', options: BASEHALF_AGENT_SESSION_CHOICES.map(choice => ({ value: choice.kind, label: choice.label })) }
			}, {
				key: 'terminal.integrated.fontFamily',
				label: localize('basehalf.settings.terminalFont', "Terminal Font"),
				control: { kind: 'text', placeholder: localize('basehalf.settings.terminalFontPlaceholder', "Same as Code") }
			}, {
				key: 'terminal.integrated.fontSize',
				label: localize('basehalf.settings.terminalFontSize', "Terminal Font Size"),
				control: { kind: 'number', minimum: 6, maximum: 100 }
			}, {
				key: BaseHalfSetting.AgentsOfferSkill,
				label: localize('basehalf.settings.offerSkill', "Offer the BaseHalf Skill"),
				description: localize('basehalf.settings.offerSkillDescription', "The skill tells agents what is selected and how cards connect."),
				control: { kind: 'switch' }
			}]
		}
	];
}

/** Numbers the pages, so that the ids of each page's elements are its own. */
let pageCount = 0;

/**
 * One setting on a page: its name, a line about it where its name does not say enough, and its
 * control. The control shows the value in effect and writes the user's settings; a value equal to
 * the default is written as no value, as the Settings editor of the base writes it.
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
				this._register(addDisposableListener(button, EventType.CLICK, () => this.write(button.getAttribute('aria-checked') !== 'true')));
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
				this._register(addDisposableListener(input, EventType.CHANGE, () => this.write(input.value.trim())));
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
				return input;
			}
		}
	}

	/** The choices, and with them the value in effect when it is none of them, named as it is written. */
	private showChoice(select: HTMLSelectElement, value: unknown): void {
		const control = this.setting.control;
		if (control.kind !== 'choice') {
			return;
		}
		const options: IBaseHalfSettingOption[] = [...control.options];
		if ((typeof value === 'string' || typeof value === 'number') && !options.some(option => option.value === value)) {
			options.push({ value, label: String(value) });
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
		const schema = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).getConfigurationProperties()[this.setting.key];
		const written = equals(value, schema?.default) ? undefined : value;
		this.configurationService.updateValue(this.setting.key, written, ConfigurationTarget.USER).then(undefined, () => undefined).finally(() => this.refresh());
	}
}

/** A group of settings under a heading: rows in one box, a line between them. */
export function renderBaseHalfSettingsSection(parent: HTMLElement, id: string, title: string): HTMLElement {
	const section = append(parent, $('section.basehalf-settings-section'));
	const heading = append(section, $('h2'));
	heading.id = `${id}-heading`;
	heading.textContent = title;
	const group = append(section, $('.basehalf-settings-group'));
	group.setAttribute('role', 'group');
	group.setAttribute('aria-labelledby', heading.id);
	return group;
}

/**
 * The General page of BaseHalf's Settings (BaseHalf's pages in Settings): the shown settings of
 * the catalog under BaseHalf's own names, by what they belong to.
 */
export class BaseHalfGeneralSettingsPage extends Disposable implements IBaseHalfSettingsPage {
	private readonly idPrefix = `basehalf-settings-general-${++pageCount}`;
	private root: HTMLElement | undefined;
	private readonly rows: BaseHalfSettingRow[] = [];

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();
	}

	create(parent: HTMLElement): void {
		const root = this.root = append(parent, $('.basehalf-settings-page.basehalf-settings-general'));
		root.setAttribute('role', 'region');
		root.setAttribute('aria-labelledby', `${this.idPrefix}-title`);
		root.tabIndex = -1;
		const title = append(root, $('h1'));
		title.id = `${this.idPrefix}-title`;
		title.textContent = localize('basehalf.settings.general', "General");

		const store = this._register(new DisposableStore());
		for (const section of baseHalfGeneralSettings()) {
			const group = renderBaseHalfSettingsSection(root, `${this.idPrefix}-${section.id}`, section.title);
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
