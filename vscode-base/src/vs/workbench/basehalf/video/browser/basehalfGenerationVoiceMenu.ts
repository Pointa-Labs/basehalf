/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfGenerationVoiceMenu.css';
import { $, addDisposableListener, append, clearNode } from '../../../../base/browser/dom.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { getErrorMessage } from '../../../../base/common/errors.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import type { VoiceParameter, VoicesResult } from '../../../../platform/basehalfProviders/common/basehalfProviderTypes.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IBaseHalfVideoCatalogModel, IBaseHalfVideoCatalogProvider } from '../common/basehalfVideoCatalog.js';
import { IBaseHalfVideoProviderSettingsService } from '../common/basehalfVideoGeneration.js';
import {
	BaseHalfVoiceMenuRow,
	baseHalfVoiceMenuRows,
	baseHalfVoiceMenuStatus,
	IBaseHalfGenerationVoiceService,
	IBaseHalfVoiceMenuVoice,
	IBaseHalfVoiceSample
} from '../common/basehalfGenerationVoices.js';

/** What the voice menu lists from: the card's model, its voice parameter, and the card's voice. */
export interface IBaseHalfVoiceMenuTarget {
	readonly provider: IBaseHalfVideoCatalogProvider;
	readonly model: IBaseHalfVideoCatalogModel;
	readonly parameter: VoiceParameter;
	/** The card's voice. */
	readonly voice: string;
}

export interface IBaseHalfVoiceMenuDelegate {
	/** A voice was chosen: the panel saves it, closes the menu, and gives the keyboard back. */
	choose(voice: string): void;
	/** Escape, or Tab out of the menu. */
	dismiss(): void;
	/** What the menu shows changed its height: the panel places it again. */
	layout(): void;
}

const HOVER_GROUP = 'basehalf-video-panel';

/**
 * The menu of the voice button (generation cards, "The panel", D78), drawn
 * into a menu of the panel: a search field that has the keyboard, the voices
 * of the account under Your Voices and the provider's under Voices, each with
 * its description, a play button for its sample, and a check on the card's
 * voice. Up and Down move the current voice, Enter chooses it, Space plays its
 * sample, and Escape closes the menu. It asks the provider for the voices each
 * time it opens, and again when the provider becomes set up or moves to
 * another region or endpoint while it is open, and shows the last list
 * meanwhile; closing it stops a sample.
 */
export class BaseHalfGenerationVoiceMenu extends Disposable {

	private readonly search: HTMLInputElement;
	private readonly status: HTMLElement;
	private readonly statusText: HTMLElement;
	private readonly statusAction: HTMLButtonElement;
	private readonly sampleStatus: HTMLElement;
	private readonly list: HTMLElement;
	private readonly rowsStore = this._register(new DisposableStore());
	private readonly id = `bh-voice-menu-${generateUuid()}`;
	/** The voices drawn, by key. */
	private readonly options = new Map<string, { readonly element: HTMLElement; readonly voice: IBaseHalfVoiceMenuVoice; readonly play?: HTMLButtonElement }>();
	private rows: readonly BaseHalfVoiceMenuRow[] = [];
	/** What the rows were drawn from, so that they are drawn again only when it changes. */
	private drawn: { readonly parameter: VoiceParameter; readonly voice: string; readonly list: VoicesResult | undefined; readonly query: string } | undefined;
	/** The current voice, by key. */
	private activeKey: string | undefined;
	private statusKind: 'setUp' | 'retry' | undefined;
	private query = '';
	private composing = false;
	/** Where the menu last asked, or would have asked, for the voices: the provider set up or not, its region, and its endpoint. */
	private askedOf: string;

	constructor(
		element: HTMLElement,
		private target: IBaseHalfVoiceMenuTarget,
		private readonly delegate: IBaseHalfVoiceMenuDelegate,
		@IBaseHalfGenerationVoiceService private readonly voices: IBaseHalfGenerationVoiceService,
		@IBaseHalfVideoProviderSettingsService private readonly providerSettings: IBaseHalfVideoProviderSettingsService,
		@IHoverService private readonly hoverService: IHoverService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		element.classList.add('bh-voice-menu');
		element.setAttribute('role', 'dialog');
		element.setAttribute('aria-label', localize('basehalf.generation.voices.menu', "Voices"));
		const field = append(element, $('.bh-voice-menu-search'));
		field.append(renderGlyph(Codicon.search));
		this.search = append(field, $<HTMLInputElement>('input'));
		this.search.type = 'text';
		this.search.spellcheck = false;
		this.search.placeholder = localize('basehalf.generation.voices.search', "Search");
		this.search.setAttribute('role', 'combobox');
		this.search.setAttribute('aria-autocomplete', 'list');
		this.search.setAttribute('aria-expanded', 'true');
		this.search.setAttribute('aria-controls', `${this.id}-list`);
		this.status = append(element, $('.bh-voice-menu-status'));
		this.statusText = append(this.status, $('span.bh-voice-menu-status-text'));
		this.statusText.setAttribute('role', 'status');
		this.statusAction = append(this.status, $<HTMLButtonElement>('button.bh-voice-menu-status-action'));
		this.statusAction.type = 'button';
		this.sampleStatus = append(element, $('.bh-voice-menu-status.sample'));
		this.sampleStatus.setAttribute('role', 'status');
		this.list = append(element, $('.bh-voice-menu-list'));
		this.list.id = `${this.id}-list`;
		this.list.setAttribute('role', 'listbox');
		this.list.setAttribute('aria-label', localize('basehalf.generation.voices.menu', "Voices"));

		this._register(addDisposableListener(this.search, 'input', event => {
			if ((event as InputEvent).isComposing || this.composing) {
				return;
			}
			this.setQuery(this.search.value);
		}));
		this._register(addDisposableListener(this.search, 'compositionstart', () => { this.composing = true; }));
		this._register(addDisposableListener(this.search, 'compositionend', () => {
			this.composing = false;
			this.setQuery(this.search.value);
		}));
		this._register(addDisposableListener(element, 'keydown', event => this.onKeyDown(event)));
		this._register(addDisposableListener(element, 'pointerdown', event => {
			// The search field keeps the keyboard while the pointer chooses and plays.
			if (event.target !== this.search) {
				event.preventDefault();
			}
		}));
		this._register(addDisposableListener(this.statusAction, 'click', () => this.runStatusAction()));
		this._register(this.voices.onDidChangeVoices(() => this.render()));
		this._register(this.voices.onDidChangeSample(() => this.renderSample()));
		this._register(this.providerSettings.onDidChange(() => this.onDidChangeProviderSettings()));
		this.askedOf = this.accessOf();
		this.render();
		this.ask();
	}

	/** Moves the keyboard into the search field, with the current voice in view. */
	focus(): void {
		this.search.focus({ preventScroll: true });
		this.updateActive(true);
	}

	/** Lists for the card as it is now: another voice, or another model, keeping the search. */
	update(target: IBaseHalfVoiceMenuTarget): void {
		const otherModel = target.provider.id !== this.target.provider.id || target.model.id !== this.target.model.id;
		this.target = target;
		this.render();
		if (otherModel) {
			this.askedOf = this.accessOf();
			this.ask();
		}
	}

	override dispose(): void {
		// Closing the menu stops its sample.
		this.voices.stopSample();
		super.dispose();
	}

	/** Whether the provider is set up, its region, and its endpoint: what the list of voices the menu asks for depends on. */
	private accessOf(): string {
		const status = this.providerSettings.getStatus(this.target.provider);
		return JSON.stringify([status.setUp, status.region.id, status.endpoint]);
	}

	/**
	 * The settings of a provider changed, perhaps in another window: when the
	 * menu's provider became set up, or moved to another region or endpoint,
	 * while the menu is open, the menu asks for its voices there, and says
	 * that they load until they come.
	 */
	private onDidChangeProviderSettings(): void {
		const access = this.accessOf();
		if (access !== this.askedOf) {
			this.askedOf = access;
			this.ask();
		}
		this.render();
	}

	/** The menu asks the provider for the voices each time it opens, when the provider lists them and is set up. */
	private ask(): void {
		if (this.target.parameter.listed === true && this.providerSettings.getStatus(this.target.provider).setUp) {
			void this.voices.refresh(this.target.provider, this.target.model).catch(error => this.logService.warn(`[BaseHalf voices] ${getErrorMessage(error)}`));
		}
	}

	private setQuery(query: string): void {
		if (query === this.query) {
			return;
		}
		this.query = query;
		this.activeKey = undefined;
		this.render();
	}

	//#region Drawing

	private render(): void {
		const status = this.providerSettings.getStatus(this.target.provider);
		const listed = this.target.parameter.listed === true;
		const voices = this.voices.voices(this.target.provider.id, status.region.id);
		// A provider that is not set up shows the catalog's voices: the account's are not known here.
		const list = listed && status.setUp ? voices.list : undefined;
		const line = baseHalfVoiceMenuStatus({ listed, setUp: status.setUp, providerLabel: this.target.provider.label, voices });
		this.statusKind = line?.action;
		this.status.hidden = !line;
		this.statusText.textContent = line?.text ?? '';
		this.statusAction.hidden = !line?.action;
		this.statusAction.textContent = line?.action === 'setUp'
			? localize('basehalf.generation.voices.setUpAction', "Set Up")
			: line?.action === 'retry' ? localize('basehalf.generation.voices.retry', "Try Again") : '';
		const drawn = this.drawn;
		// A list that arrives, or the card's voice that changes, keeps where the list was scrolled; a search starts at its top.
		const scrollTop = drawn?.query === this.query ? this.list.scrollTop : 0;
		if (!drawn || drawn.parameter !== this.target.parameter || drawn.voice !== this.target.voice || drawn.list !== list || drawn.query !== this.query) {
			this.drawn = { parameter: this.target.parameter, voice: this.target.voice, list, query: this.query };
			this.rows = baseHalfVoiceMenuRows({ parameter: this.target.parameter, voice: this.target.voice, ...(list ? { list } : {}) }, this.query);
			this.renderRows();
		}
		this.renderSample();
		this.delegate.layout();
		this.list.scrollTop = scrollTop;
	}

	private renderRows(): void {
		this.rowsStore.clear();
		this.options.clear();
		clearNode(this.list);
		// A play button keeps a column of its own, so that the names line up, when any voice has one.
		const samples = this.rows.some(row => row.type === 'voice' && row.voice.sample !== undefined);
		let group: HTMLElement | undefined;
		for (const row of this.rows) {
			if (row.type === 'header') {
				group = append(this.list, $('.bh-voice-menu-group'));
				group.setAttribute('role', 'group');
				group.setAttribute('aria-label', row.text);
				const header = append(group, $('.bh-voice-menu-header'));
				header.textContent = row.text;
				header.setAttribute('aria-hidden', 'true');
			} else if (row.type === 'note') {
				group = undefined;
				append(this.list, $('.bh-voice-menu-note')).textContent = row.text;
			} else {
				this.renderVoice(group ?? this.list, row.voice, samples);
			}
		}
		const keys = [...this.options.keys()];
		if (!this.activeKey || !this.options.has(this.activeKey)) {
			// The current voice is the card's, and after a search the first that it found.
			this.activeKey = (this.query ? undefined : [...this.options.values()].find(option => option.voice.checked)?.voice.key) ?? keys[0];
		}
		this.updateActive(false);
	}

	private renderVoice(parent: HTMLElement, voice: IBaseHalfVoiceMenuVoice, samples: boolean): void {
		const option = append(parent, $('.bh-voice-menu-option'));
		option.id = this.optionId(voice.key);
		option.dataset.key = voice.key;
		option.setAttribute('role', 'option');
		option.setAttribute('aria-checked', String(voice.checked));
		// Named by its voice alone, with its description read after it, as a model of the model menu is.
		option.setAttribute('aria-label', voice.label);
		if (voice.description) {
			option.setAttribute('aria-description', voice.description);
		}
		let play: HTMLButtonElement | undefined;
		if (voice.sample) {
			play = append(option, $<HTMLButtonElement>('button.bh-voice-menu-play'));
			play.type = 'button';
			play.tabIndex = -1;
			const button = play;
			this.rowsStore.add(addDisposableListener(button, 'click', event => {
				event.preventDefault();
				event.stopPropagation();
				this.toggleSample(voice);
			}));
			this.rowsStore.add(this.hoverService.setupDelayedHover(button, () => ({ content: this.playing(voice) ? localize('basehalf.generation.voices.stopSample', "Stop Sample") : localize('basehalf.generation.voices.playSample', "Play Sample") }), { groupId: HOVER_GROUP }));
		} else if (samples) {
			append(option, $('span.bh-voice-menu-play-space'));
		}
		const text = append(option, $('.bh-voice-menu-text'));
		append(text, $('span.bh-voice-menu-name')).textContent = voice.label;
		if (voice.description) {
			append(text, $('span.bh-voice-menu-description')).textContent = voice.description;
		}
		if (voice.checked) {
			option.append(renderGlyph(Codicon.check, 'bh-voice-menu-check'));
		}
		this.rowsStore.add(addDisposableListener(option, 'pointermove', () => {
			if (this.activeKey !== voice.key) {
				this.activeKey = voice.key;
				this.updateActive(false);
			}
		}));
		this.rowsStore.add(addDisposableListener(option, 'click', () => this.delegate.choose(voice.id)));
		this.options.set(voice.key, { element: option, voice, ...(play ? { play } : {}) });
	}

	/** The play buttons show whether their sample loads or plays, and the line under the search field why one could not be played. */
	private renderSample(): void {
		for (const { voice, play } of this.options.values()) {
			if (!play) {
				continue;
			}
			const sample = this.playing(voice);
			const icon = sample ? Codicon.primitiveSquare : Codicon.play;
			if (play.dataset.icon !== icon.id) {
				play.dataset.icon = icon.id;
				play.replaceChildren(renderGlyph(icon));
			}
			play.classList.toggle('playing', !!sample);
			play.classList.toggle('loading', sample?.phase === 'loading');
			play.setAttribute('aria-label', sample
				? localize('basehalf.generation.voices.stopSampleOf', "Stop the Sample of {0}", voice.label)
				: localize('basehalf.generation.voices.playSampleOf', "Play the Sample of {0}", voice.label));
		}
		const failure = this.voices.sampleFailure;
		const shown = failure?.provider === this.target.provider.id ? failure : undefined;
		this.sampleStatus.hidden = !shown;
		this.sampleStatus.textContent = shown
			? localize('basehalf.generation.voices.sampleFailed', "The sample of {0} could not be played: {1}", this.nameOf(shown.voice), shown.message)
			: '';
	}

	/** The sample of the voice that loads or plays, when it is this voice's. */
	private playing(voice: IBaseHalfVoiceMenuVoice): IBaseHalfVoiceSample | undefined {
		const sample = this.voices.sample;
		return sample && sample.provider === this.target.provider.id && sample.voice === voice.id && sample.sample === voice.sample ? sample : undefined;
	}

	private nameOf(id: string): string {
		return [...this.options.values()].find(option => option.voice.id === id)?.voice.label ?? id;
	}

	/** Marks the current voice, and tells assistive technology which one it is. */
	private updateActive(scroll: boolean): void {
		for (const [key, { element }] of this.options) {
			const current = key === this.activeKey;
			element.classList.toggle('active', current);
			element.setAttribute('aria-selected', String(current));
			if (current && scroll) {
				this.reveal(element);
			}
		}
		if (this.activeKey && this.options.has(this.activeKey)) {
			this.search.setAttribute('aria-activedescendant', this.optionId(this.activeKey));
		} else {
			this.search.removeAttribute('aria-activedescendant');
		}
	}

	/** Scrolls the list, and nothing around it, so that the voice shows. */
	private reveal(option: HTMLElement): void {
		const top = option.offsetTop;
		const bottom = top + option.offsetHeight;
		if (top < this.list.scrollTop) {
			this.list.scrollTop = top;
		} else if (bottom > this.list.scrollTop + this.list.clientHeight) {
			this.list.scrollTop = bottom - this.list.clientHeight;
		}
	}

	//#endregion

	//#region Keys, choosing, and samples

	private onKeyDown(event: KeyboardEvent): void {
		if (event.isComposing || event.keyCode === 229) {
			return;
		}
		const handled = () => {
			event.preventDefault();
			event.stopPropagation();
		};
		if (event.key === 'Escape') {
			handled();
			this.delegate.dismiss();
			return;
		}
		if (event.key === 'Tab') {
			// The keyboard reaches Set Up and Try Again; past them it leaves the menu, which closes.
			handled();
			const action = this.statusAction.hidden ? undefined : this.statusAction;
			if (action && event.target === this.search && !event.shiftKey) {
				action.focus();
			} else if (action && event.target === action && event.shiftKey) {
				this.search.focus();
			} else {
				this.delegate.dismiss();
			}
			return;
		}
		if (event.target !== this.search) {
			return;
		}
		const keys = [...this.options.keys()];
		const index = this.activeKey ? keys.indexOf(this.activeKey) : -1;
		switch (event.key) {
			case 'ArrowDown':
			case 'ArrowUp': {
				handled();
				if (keys.length) {
					const step = event.key === 'ArrowDown' ? 1 : -1;
					this.activeKey = keys[index < 0 ? (step > 0 ? 0 : keys.length - 1) : (index + step + keys.length) % keys.length];
					this.updateActive(true);
				}
				return;
			}
			case 'Home':
			case 'End':
				if (keys.length && !this.search.value) {
					handled();
					this.activeKey = keys[event.key === 'Home' ? 0 : keys.length - 1];
					this.updateActive(true);
				}
				return;
			case 'Enter': {
				handled();
				const option = this.activeKey ? this.options.get(this.activeKey) : undefined;
				if (option) {
					this.delegate.choose(option.voice.id);
				}
				return;
			}
			case ' ': {
				// Space plays the current voice's sample: the search takes no spaces, and finds names without them.
				handled();
				const option = this.activeKey ? this.options.get(this.activeKey) : undefined;
				if (option?.voice.sample) {
					this.toggleSample(option.voice);
				}
				return;
			}
		}
	}

	private toggleSample(voice: IBaseHalfVoiceMenuVoice): void {
		if (this.playing(voice)) {
			this.voices.stopSample();
		} else if (voice.sample) {
			void this.voices.playSample(this.target.provider, this.target.model, voice.id, voice.sample);
		}
	}

	private runStatusAction(): void {
		if (this.statusKind === 'setUp') {
			// As the panel's other Set Up does: Providers, at the provider, under Audio (D107).
			void this.providerSettings.openSettings(this.target.provider.id, 'audio').catch(error => this.logService.error(error));
		} else if (this.statusKind === 'retry') {
			this.ask();
		}
	}

	//#endregion

	private optionId(key: string): string {
		return `${this.id}-${encodeURIComponent(key).replace(/%/g, '_')}`;
	}
}

function renderGlyph(icon: ThemeIcon, className?: string): HTMLElement {
	const element = renderIcon(icon);
	if (className) {
		element.classList.add(className);
	}
	element.setAttribute('aria-hidden', 'true');
	return element;
}
