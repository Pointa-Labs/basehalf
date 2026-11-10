/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, append, getWindow } from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { basename, dirname, joinPath } from '../../../../base/common/resources.js';
import { localize } from '../../../../nls.js';
import { Severity } from '../../../../platform/notification/common/notification.js';
import { baseHalfUserFacingErrorMessage } from '../../workspace/common/basehalfPlainFailureReason.js';
import { BaseHalfVideoModeId, BaseHalfVideoParamValue, baseHalfVideoChangeParam, baseHalfVideoChooseMode, baseHalfVideoChooseModel, findBaseHalfVideoModel, IBaseHalfVideoCatalogModel, IBaseHalfVideoGenerationChoice, IBaseHalfVideoModelRef } from '../common/basehalfVideoCatalog.js';
import { baseHalfGenerationChoice, baseHalfGenerationDraftRenameExtension, baseHalfGenerationNameOrdinal, baseHalfGenerationNameParts, IBaseHalfGenerationInfo, setBaseHalfGenerationChoice } from '../common/basehalfGenerationInfo.js';
import { BaseHalfVideoPanelControl, IBaseHalfVideoPanelAuto, IBaseHalfVideoPanelChoice } from '../common/basehalfVideoNodePanelPresentation.js';
import { BaseHalfGenerationVoiceMenu, IBaseHalfVoiceMenuTarget } from './basehalfGenerationVoiceMenu.js';
import { HOVER_GROUP, renderCodicon, IOpenMenu } from './basehalfGenerationPanelShared.js';
import type { BaseHalfVideoNodePanel } from './basehalfVideoNodePanel.js';

function addInputLabel(): string {
	return localize('basehalf.video.panel.addInput', "Add Input");
}

/**
 * What the panel's menus hold: what to add as an input, the models and the voices to choose from, and the settings
 * of the model with their controls, and what choosing one of them writes.
 *
 * A part of the panel under a generation card (`basehalfVideoNodePanel.ts`): it keeps its own state, and reaches
 * the panel's as `panel`.
 */
export class BaseHalfGenerationPanelChoices {
	/** A text value typed into the settings and not saved yet. */
	private pendingText: { readonly name: string; readonly value: string } | undefined;

	constructor(private readonly panel: BaseHalfVideoNodePanel) { }

	fillAddMenu(element: HTMLElement): void {
		element.setAttribute('role', 'menu');
		element.setAttribute('aria-label', addInputLabel());
		this.panel.menus.menuItem(element, localize('basehalf.video.panel.pickOnCanvas', "Pick on Canvas"), () => {
			this.panel.menus.closeMenu(false);
			this.panel.inputChanges.startPick();
		}, { key: 'pick', icon: Codicon.inspect });
		this.panel.menus.menuItem(element, localize('basehalf.video.panel.importFile', "Import File…"), () => {
			this.panel.menus.closeMenu(false);
			void this.panel.inputChanges.importFile();
		}, { key: 'import', icon: Codicon.attach });
	}

	fillModelMenu(element: HTMLElement): void {
		const presentation = this.panel.presentation;
		if (!presentation) {
			return;
		}
		const menu = presentation.modelMenu;
		element.setAttribute('role', 'menu');
		element.setAttribute('aria-label', localize('basehalf.video.panel.models', "Models"));
		if (menu.message) {
			const message = append(element, $('.bh-video-panel-menu-empty'));
			message.textContent = menu.message;
			message.setAttribute('role', 'status');
		}
		for (const group of menu.groups) {
			const section = append(element, $('.bh-video-panel-menu-group'));
			section.setAttribute('role', 'group');
			section.setAttribute('aria-label', group.detail ? `${group.label}, ${group.detail}` : group.label);
			section.dataset.provider = group.provider;
			const heading = append(section, $('.bh-video-panel-menu-heading'));
			heading.setAttribute('aria-hidden', 'true');
			append(heading, $('span.bh-video-panel-menu-heading-label')).textContent = group.label;
			if (group.detail) {
				append(heading, $('span.bh-video-panel-menu-heading-detail')).textContent = group.detail;
			}
			for (const item of group.items) {
				const button = this.panel.menus.menuItem(section, item.label, () => {
					this.panel.menus.closeMenu(true);
					this.chooseModel(item.provider, item.model);
				}, { role: 'menuitemradio', checked: item.checked, key: `model:${item.provider}:${item.model}`, title: item.title, detail: item.detail });
				if (item.unavailable) {
					// Dimmed with the reason; it can still be chosen.
					button.classList.add('unavailable');
					button.setAttribute('aria-description', item.detail ? `${item.unavailable}. ${item.detail}` : item.unavailable);
				}
			}
		}
		append(element, $('.bh-video-panel-menu-separator')).setAttribute('role', 'separator');
		this.panel.menus.menuItem(element, menu.settingsLabel, () => {
			this.panel.menus.closeMenu(false);
			void this.panel.providerSettings.openSettings(this.panel.info().provider, this.panel.snapshot?.kind).catch(error => this.panel.logService.error(error));
		}, { key: 'providers', icon: Codicon.settingsGear });
	}

	/**
	 * The voice menu (D78): the voices of the card's model, which it asks the
	 * provider for each time it opens. Choosing one saves it as any value of
	 * the settings is saved, closes the menu, and gives the keyboard back.
	 */
	fillVoiceMenu(menu: IOpenMenu): void {
		const target = this.voiceTarget();
		if (!target) {
			return;
		}
		menu.voice = menu.content.add(this.panel.instantiationService.createInstance(BaseHalfGenerationVoiceMenu, menu.element, target, {
			choose: voice => {
				this.panel.menus.closeMenu(true);
				this.changeParam(target.parameter.name, voice);
			},
			dismiss: () => this.panel.menus.closeMenu(true),
			layout: () => {
				if (this.panel.openMenu === menu) {
					this.panel.menus.placeMenu(menu);
				}
			}
		}));
	}

	/** What the voice menu lists from: the card's model and its voice, while the model speaks. */
	voiceTarget(): IBaseHalfVoiceMenuTarget | undefined {
		const presentation = this.panel.presentation;
		const voice = presentation?.voice;
		return presentation?.ref && voice
			? Object.freeze({ provider: presentation.ref.provider, model: presentation.ref.model, parameter: voice.parameter, voice: voice.value })
			: undefined;
	}

	/** Chooses a model of the catalog: every value it accepts is kept, the others take its defaults. */
	private chooseModel(providerId: string, modelId: string): void {
		const catalog = this.panel.catalogService.state;
		const ref = catalog.kind === 'ready' ? findBaseHalfVideoModel(catalog.catalog, providerId, modelId) : undefined;
		if (ref) {
			void this.panel.writeSettings(info => setBaseHalfGenerationChoice(info, baseHalfVideoChooseModel(baseHalfGenerationChoice(info), ref)))
				.then(() => this.followModelFormat(ref.model));
		}
	}

	/**
	 * A draft's extension follows its model (generation cards, "Creating a
	 * generation card"): an image or an audio model that delivers another
	 * format renames the draft to that format's extension at once, with the
	 * next free number when that name is taken, as a rename does.
	 */
	private async followModelFormat(model: IBaseHalfVideoCatalogModel): Promise<void> {
		const snapshot = this.panel.snapshot;
		const extension = !this.panel.disposed && snapshot && !snapshot.hasFile && !snapshot.made ? baseHalfGenerationDraftRenameExtension(snapshot.path, snapshot.kind, model) : undefined;
		if (extension === undefined) {
			return;
		}
		const name = basename(this.panel.resource);
		const folder = dirname(this.panel.resource);
		try {
			const next = await this.panel.store.nextFreeName(folder, baseHalfGenerationNameParts(name).base, extension, baseHalfGenerationNameOrdinal(name));
			const target = joinPath(folder, next);
			await this.panel.draftOperations.move(this.panel.resource, target);
			this.panel.host.didRenameCard?.(target);
		} catch (error) {
			this.panel.logService.warn('[BaseHalf] the panel could not rename the draft to the format of its model', error);
			this.panel.notificationService.notify({ severity: Severity.Warning, message: baseHalfUserFacingErrorMessage(error) });
		}
	}

	/** Saves one value of the card's model, for the mode that is used: the panel shows the change at once. */
	private changeParam(name: string, value: BaseHalfVideoParamValue | undefined): void {
		const ref = this.panel.presentation?.ref;
		const usedMode = this.panel.presentation?.mode?.id;
		if (ref) {
			void this.panel.writeSettings(info => setBaseHalfGenerationChoice(info, baseHalfVideoChangeParam(this.generationOf(info, ref), ref.model, name, value, usedMode)));
		}
	}

	private changeMode(mode: BaseHalfVideoModeId): void {
		const ref = this.panel.presentation?.ref;
		if (ref) {
			void this.panel.writeSettings(info => setBaseHalfGenerationChoice(info, baseHalfVideoChooseMode(this.generationOf(info, ref), ref.model, mode)));
		}
	}

	/** The card's generation of `ref`, as a change starts from it. */
	private generationOf(info: IBaseHalfGenerationInfo, ref: IBaseHalfVideoModelRef): IBaseHalfVideoGenerationChoice {
		const choice = baseHalfGenerationChoice(info);
		return choice.model ? choice : { ...choice, provider: ref.provider.id, model: ref.model.id };
	}

	/** Saves a text value typed into the settings, now. */
	saveTextParam(): void {
		const pending = this.pendingText;
		this.pendingText = undefined;
		if (pending) {
			this.changeParam(pending.name, pending.value);
		}
	}

	fillSettings(element: HTMLElement): void {
		const view = this.panel.presentation?.settingsView;
		if (!view) {
			return;
		}
		element.setAttribute('role', 'dialog');
		element.setAttribute('aria-label', localize('basehalf.video.panel.settingsTitle', "Settings"));
		if (view.modes) {
			this.radioGroup(element, localize('basehalf.video.panel.setting.mode', "Mode"), view.modes, 'buttons', mode => {
				if (mode !== undefined) {
					this.changeMode(mode);
				}
			});
		}
		for (const control of view.controls) {
			this.renderControl(element, control);
		}
		if (view.advanced.length) {
			const more = append(element, $<HTMLButtonElement>('button.bh-video-panel-more'));
			more.type = 'button';
			more.dataset.key = 'more';
			more.setAttribute('aria-expanded', String(this.panel.moreOpen));
			more.append(renderCodicon(this.panel.moreOpen ? Codicon.chevronDown : Codicon.chevronRight));
			append(more, $('span')).textContent = localize('basehalf.video.panel.more', "More");
			more.addEventListener('click', () => {
				this.panel.moreOpen = !this.panel.moreOpen;
				this.panel.menus.refreshMenu();
				this.panel.findByKey(this.panel.openMenu?.element ?? element, 'more')?.focus({ preventScroll: true });
			});
			if (this.panel.moreOpen) {
				const advanced = append(element, $('.bh-video-panel-advanced'));
				for (const control of view.advanced) {
					this.renderControl(advanced, control);
				}
			}
		}
	}

	/**
	 * Why a number goes less far than its model declares, under it, and read
	 * with its slider or field (generation cards, "Settings"; D70). A button
	 * beyond the range has the reason itself.
	 */
	private renderLimit(section: HTMLElement, control: BaseHalfVideoPanelControl, described?: HTMLElement): void {
		if (control.limit) {
			append(section, $('.bh-video-panel-setting-note.limit')).textContent = control.limit;
			described?.setAttribute('aria-description', control.limit);
		}
	}

	/** One parameter, drawn as the specification says for its kind (generation cards, "Settings"). */
	private renderControl(parent: HTMLElement, control: BaseHalfVideoPanelControl): void {
		switch (control.kind) {
			case 'buttons':
			case 'list':
			case 'ratio': {
				const section = this.radioGroup(parent, control.label, control.choices, control.kind, value => this.changeParam(control.name, value), control.tooltip, control.columns);
				section.dataset.parameter = control.name;
				this.renderLimit(section, control);
				return;
			}
			case 'slider': {
				const section = this.settingSection(parent, control.label, control.tooltip);
				section.dataset.parameter = control.name;
				const row = append(section, $('.bh-video-panel-number'));
				const slider = append(row, $<HTMLInputElement>('input.bh-video-panel-slider'));
				slider.type = 'range';
				slider.min = String(control.min);
				slider.max = String(control.max);
				slider.step = String(control.step);
				slider.value = String(control.value);
				slider.dataset.key = `${control.name}:slider`;
				slider.setAttribute('aria-label', control.label);
				slider.disabled = control.auto?.selected === true;
				const value = append(row, $('span.bh-video-panel-number-value'));
				value.textContent = control.valueLabel;
				slider.addEventListener('input', () => {
					value.textContent = control.unit === 'seconds'
						? localize('basehalf.video.panel.secondsValue', "{0}s", slider.value)
						: slider.value;
				});
				slider.addEventListener('change', () => this.changeParam(control.name, Number(slider.value)));
				if (control.auto) {
					this.autoSwitch(row, control.name, control.auto);
				}
				this.renderLimit(section, control, slider);
				return;
			}
			case 'number': {
				const section = this.settingSection(parent, control.label, control.tooltip);
				section.dataset.parameter = control.name;
				const row = append(section, $('.bh-video-panel-number'));
				const field = append(row, $<HTMLInputElement>('input.bh-video-panel-field'));
				field.type = 'text';
				field.inputMode = control.integer && control.min >= 0 ? 'numeric' : 'decimal';
				field.spellcheck = false;
				field.value = control.text;
				field.placeholder = control.placeholder;
				field.dataset.key = `${control.name}:field`;
				field.setAttribute('aria-label', control.unit === 'seconds' ? localize('basehalf.video.panel.secondsField', "{0}, in seconds", control.label) : control.label);
				field.disabled = control.auto?.selected === true;
				if (control.unit === 'seconds') {
					const unit = append(row, $('span.bh-video-panel-number-unit'));
					unit.textContent = localize('basehalf.video.panel.secondsUnit', "s");
					unit.setAttribute('aria-hidden', 'true');
				}
				const commit = () => {
					const text = field.value.trim();
					if (!text) {
						this.changeParam(control.name, undefined);
						return;
					}
					const number = Number(text);
					// A value the parameter does not take is given back its default by the normalization.
					this.changeParam(control.name, Number.isFinite(number) ? number : undefined);
				};
				field.addEventListener('change', commit);
				field.addEventListener('keydown', event => {
					if (event.key === 'Enter' && !event.isComposing) {
						event.preventDefault();
						commit();
					}
				});
				if (control.auto) {
					this.autoSwitch(row, control.name, control.auto);
				}
				this.renderLimit(section, control, field);
				return;
			}
			case 'fixed': {
				const section = this.settingSection(parent, control.label, control.tooltip);
				section.dataset.parameter = control.name;
				section.classList.add('fixed');
				append(section, $('.bh-video-panel-setting-note')).textContent = control.text;
				return;
			}
			case 'switch': {
				const section = this.settingSection(parent, control.label, control.tooltip);
				section.dataset.parameter = control.name;
				this.switchButton(section, control.on
					? localize('basehalf.video.panel.switchOn', "On")
					: localize('basehalf.video.panel.switchOff', "Off"), control.on, control.name, on => this.changeParam(control.name, on), control.label);
				return;
			}
			case 'text': {
				const section = this.settingSection(parent, control.label, control.tooltip);
				section.dataset.parameter = control.name;
				const field = control.multiline
					? append(section, $<HTMLTextAreaElement>('textarea.bh-video-panel-field.multiline'))
					: append(section, $<HTMLInputElement>('input.bh-video-panel-field'));
				field.value = this.pendingText?.name === control.name ? this.pendingText.value : control.text;
				field.maxLength = control.maxLength;
				field.spellcheck = false;
				field.dataset.key = `${control.name}:text`;
				field.setAttribute('aria-label', control.label);
				// Saved when the field loses the focus, on Enter, and when the popover
				// closes: a save draws the popover again, which must not happen while
				// the user types.
				field.addEventListener('input', () => {
					this.pendingText = { name: control.name, value: field.value };
				});
				field.addEventListener('change', () => this.saveTextParam());
				const element: HTMLElement = field;
				element.addEventListener('keydown', event => {
					if (event.key === 'Enter' && !event.isComposing && !control.multiline) {
						event.preventDefault();
						this.saveTextParam();
					}
				});
				return;
			}
		}
	}

	private autoSwitch(parent: HTMLElement, name: string, auto: IBaseHalfVideoPanelAuto): void {
		const toggle = this.switchButton(parent, auto.label, auto.selected, `${name}:auto`, on => this.changeParam(name, on ? auto.value : auto.fallback));
		toggle.classList.add('auto');
	}

	private settingSection(parent: HTMLElement, label: string, tooltip?: string): HTMLElement {
		const section = append(parent, $('.bh-video-panel-setting'));
		const title = append(section, $('.bh-video-panel-setting-label'));
		title.textContent = label;
		if (tooltip) {
			this.panel.openMenu?.content.add(this.panel.hoverService.setupDelayedHover(title, () => ({ content: tooltip }), { groupId: HOVER_GROUP }));
		}
		return section;
	}

	private radioGroup<T extends BaseHalfVideoParamValue>(
		parent: HTMLElement,
		label: string,
		choices: readonly IBaseHalfVideoPanelChoice<T>[],
		kind: 'buttons' | 'list' | 'ratio',
		choose: (value: T | undefined) => void,
		tooltip?: string,
		columns?: number
	): HTMLElement {
		// Returns the section, which holds the label and the choices.
		const section = this.settingSection(parent, label, tooltip);
		section.classList.add(kind === 'ratio' ? 'ratios' : kind);
		const group = append(section, $('.bh-video-panel-choices'));
		group.setAttribute('role', 'radiogroup');
		group.setAttribute('aria-label', label);
		if (columns) {
			// Buttons that wrap into rows, as a long count's (D91).
			group.classList.add('rows');
			group.style.setProperty('--bh-video-panel-choice-columns', String(columns));
		}
		const buttons: HTMLButtonElement[] = [];
		const selectedIndex = Math.max(0, choices.findIndex(choice => choice.selected));
		choices.forEach((choice, index) => {
			const button = append(group, $<HTMLButtonElement>('button.bh-video-panel-choice'));
			button.type = 'button';
			button.dataset.key = choice.key;
			button.setAttribute('role', 'radio');
			button.setAttribute('aria-checked', String(choice.selected));
			button.tabIndex = index === selectedIndex ? 0 : -1;
			if (kind === 'ratio') {
				const shape = append(button, $('span.bh-video-panel-ratio-shape'));
				if (choice.shape) {
					const scale = 16 / Math.max(choice.shape.width, choice.shape.height);
					shape.style.width = `${Math.max(4, Math.round(choice.shape.width * scale))}px`;
					shape.style.height = `${Math.max(4, Math.round(choice.shape.height * scale))}px`;
				} else {
					shape.classList.add('free');
				}
			}
			append(button, $('span.bh-video-panel-choice-label')).textContent = choice.label;
			const reason = choice.disabled ?? choice.unavailable;
			if (reason) {
				// Dimmed with the reason. A mode the region does not offer can still be chosen; one that cannot use every input cannot.
				button.classList.add('unavailable');
				button.setAttribute('aria-description', reason);
				this.panel.openMenu?.content.add(this.panel.hoverService.setupDelayedHover(button, () => ({ content: reason }), { groupId: HOVER_GROUP }));
			}
			if (choice.disabled) {
				button.setAttribute('aria-disabled', 'true');
			}
			button.addEventListener('click', () => {
				if (!choice.selected && !choice.disabled) {
					choose(choice.value);
				}
			});
			buttons.push(button);
		});
		group.addEventListener('keydown', event => {
			const index = buttons.findIndex(button => button === getWindow(this.panel.element).document.activeElement);
			if (index < 0) {
				return;
			}
			let next: number | undefined;
			if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
				next = (index + 1) % buttons.length;
			} else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
				next = (index - 1 + buttons.length) % buttons.length;
			} else if (event.key === 'Home') {
				next = 0;
			} else if (event.key === 'End') {
				next = buttons.length - 1;
			}
			if (next === undefined) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			buttons[next].focus({ preventScroll: true });
			buttons[next].scrollIntoView({ block: 'nearest' });
			const choice = choices[next];
			if (!choice.selected && !choice.disabled) {
				choose(choice.value);
			}
		});
		return section;
	}

	private switchButton(parent: HTMLElement, label: string, on: boolean, key: string, toggle: (on: boolean) => void, accessibleName?: string): HTMLButtonElement {
		const button = append(parent, $<HTMLButtonElement>('button.bh-video-panel-switch'));
		button.type = 'button';
		button.dataset.key = key;
		button.setAttribute('role', 'switch');
		button.setAttribute('aria-checked', String(on));
		if (accessibleName) {
			button.setAttribute('aria-label', accessibleName);
		}
		append(button, $('span.bh-video-panel-switch-track')).append($('span.bh-video-panel-switch-thumb'));
		append(button, $('span.bh-video-panel-switch-label')).textContent = label;
		button.addEventListener('click', () => toggle(!on));
		return button;
	}
}
