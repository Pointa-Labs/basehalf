/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfVideoProviders.css';
import { $, addDisposableListener, append, clearNode, EventType, getActiveElement } from '../../../base/browser/dom.js';
import { toAction } from '../../../base/common/actions.js';
import { getErrorMessage } from '../../../base/common/errors.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../base/common/lifecycle.js';
import { localize } from '../../../nls.js';
import { IContextMenuService } from '../../../platform/contextview/browser/contextView.js';
import { IDialogService } from '../../../platform/dialogs/common/dialogs.js';
import { IHoverService } from '../../../platform/hover/browser/hover.js';
import { ISettingsCustomSection, ISettingsCustomSectionLayout } from '../../contrib/preferences/browser/settingsCustomSections.js';
import { BASEHALF_VIDEO_CHANNEL_NAME_MAX_LENGTH, BaseHalfVideoChannelError, normalizeBaseHalfVideoChannelModel } from '../common/basehalfVideoChannels.js';
import { IBaseHalfVideoChannel, IBaseHalfVideoChannelService } from '../common/basehalfVideoGeneration.js';
import { BaseHalfVideoProviderKind } from '../common/basehalfVideoNode.js';
import { baseHalfVideoModelLabel, getBaseHalfVideoProviderPreset, getBaseHalfVideoProviderPresets } from '../common/basehalfVideoProviders.js';

type BaseHalfVideoProvidersStatusKind = 'success' | 'warning';

/** The editable controls of the page; their text and focus survive a render. */
type BaseHalfVideoProviderControl = 'name' | 'endpoint' | 'key' | 'model';

/**
 * The Video Providers page of Settings (D58): the channels the user set up on
 * this computer and an editor for one of them. Saving checks nothing with the
 * provider; the first generation tells whether a key works. A stored key is
 * never read here and never shown: the page knows only whether one is set.
 */
export class BaseHalfVideoProvidersPage extends Disposable implements ISettingsCustomSection {
	private root: HTMLElement | undefined;
	private status: HTMLElement | undefined;
	private list: HTMLElement | undefined;
	private editor: HTMLElement | undefined;
	private selectedId: string | undefined;
	/** The channel the editor currently shows; typed text is kept only while it stays the same. */
	private renderedId: string | undefined;
	private replacingKey = false;
	private busy = false;
	private renderPending = false;
	private readonly fieldErrors = new Map<BaseHalfVideoProviderControl, string>();
	private readonly renderDisposables = this._register(new MutableDisposable<DisposableStore>());
	/** The elements of the current render, reached directly instead of by selectors. */
	private readonly rows = new Map<string, HTMLButtonElement>();
	private readonly controls = new Map<BaseHalfVideoProviderControl, HTMLInputElement>();
	private readonly errors = new Map<BaseHalfVideoProviderControl, HTMLElement>();
	private readonly sensitiveInputs = new Set<HTMLInputElement>();

	constructor(
		@IBaseHalfVideoChannelService private readonly channelService: IBaseHalfVideoChannelService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IDialogService private readonly dialogService: IDialogService,
		@IHoverService private readonly hoverService: IHoverService
	) {
		super();
		this._register(this.channelService.onDidChange(() => {
			if (this.busy) {
				this.renderPending = true;
			} else {
				this.render();
			}
		}));
	}

	create(parent: HTMLElement): void {
		this.root = append(parent, $('.basehalf-video-providers'));
		this.root.setAttribute('role', 'main');
		this.root.setAttribute('aria-labelledby', 'basehalf-video-providers-title');
		this.root.tabIndex = -1;

		const header = append(this.root, $('.basehalf-video-providers-header'));
		const heading = append(header, $('.basehalf-video-providers-heading'));
		const title = append(heading, $('h1#basehalf-video-providers-title'));
		title.textContent = localize('basehalf.video.providers.title', "Video Providers");
		const subtitle = append(heading, $('p'));
		subtitle.textContent = localize('basehalf.video.providers.subtitle', "Video nodes run on the providers you set up here, with your own API key. Keys are encrypted and stay on this computer.");
		const add = this.button(header, localize('basehalf.video.providers.add', "Add Provider…"), 'codicon-add', true);
		add.classList.add('basehalf-video-providers-add');
		add.setAttribute('aria-haspopup', 'menu');
		this._register(addDisposableListener(add, EventType.CLICK, () => this.showAddMenu(add)));

		this.status = append(this.root, $('p.basehalf-video-providers-status'));
		this.status.setAttribute('role', 'status');
		this.status.setAttribute('aria-live', 'polite');

		const content = append(this.root, $('.basehalf-video-providers-content'));
		this.list = append(content, $('.basehalf-video-providers-list'));
		this.list.setAttribute('role', 'navigation');
		this.list.setAttribute('aria-label', localize('basehalf.video.providers.listLabel', "Providers"));
		this.editor = append(content, $('.basehalf-video-provider-editor'));
		this.editor.setAttribute('role', 'region');
		this.editor.setAttribute('aria-label', localize('basehalf.video.providers.editorLabel', "Provider settings"));
		this.render();
	}

	setInput(input: string | undefined): void {
		if (input && this.channelService.getChannel(input)) {
			this.selectedId = input;
			this.replacingKey = false;
			this.fieldErrors.clear();
		}
		this.render();
	}

	setVisible(visible: boolean): void {
		if (this.root) {
			this.root.hidden = !visible;
		}
		if (!visible) {
			this.clearSensitiveInputs();
			if (this.replacingKey) {
				this.replacingKey = false;
				this.render();
			}
		}
	}

	layout(dimension: ISettingsCustomSectionLayout): void {
		if (this.root) {
			this.root.style.width = `${dimension.width}px`;
			this.root.style.height = `${dimension.height}px`;
		}
	}

	focus(): void {
		const selected = this.selectedId !== undefined ? this.rows.get(this.selectedId) : undefined;
		(selected ?? this.root)?.focus();
	}

	override dispose(): void {
		this.clearSensitiveInputs();
		super.dispose();
	}

	private render(): void {
		if (!this.root || !this.list || !this.editor) {
			return;
		}
		this.renderPending = false;
		const channels = this.channelService.getChannels();
		if (!channels.some(channel => channel.id === this.selectedId)) {
			this.selectedId = channels[0]?.id;
			this.replacingKey = false;
			this.fieldErrors.clear();
		}
		// Text typed for one provider never moves to another one.
		const sameChannel = this.selectedId !== undefined && this.selectedId === this.renderedId;
		const kept = sameChannel ? this.captureControls() : { values: new Map<BaseHalfVideoProviderControl, string>() };
		this.clearSensitiveInputs();
		const disposables = new DisposableStore();
		this.renderDisposables.value = disposables;
		this.rows.clear();
		this.controls.clear();
		this.errors.clear();
		clearNode(this.list);
		clearNode(this.editor);
		this.renderedId = this.selectedId;

		this.renderList(channels, disposables);
		const selected = channels.find(channel => channel.id === this.selectedId);
		if (selected) {
			this.renderEditor(selected, disposables);
		} else {
			this.renderEmpty(disposables);
		}
		this.restoreControls(kept);
		if (!sameChannel) {
			this.editor.scrollTop = 0;
		}
	}

	private renderList(channels: readonly IBaseHalfVideoChannel[], disposables: DisposableStore): void {
		const list = this.list!;
		if (!channels.length) {
			const empty = append(list, $('.basehalf-video-providers-empty'));
			empty.textContent = localize('basehalf.video.providers.listEmpty', "No providers yet.");
			return;
		}
		const rows: HTMLButtonElement[] = [];
		for (const channel of channels) {
			const row = append(list, $('button.basehalf-video-provider-row')) as HTMLButtonElement;
			rows.push(row);
			this.rows.set(channel.id, row);
			row.type = 'button';
			row.dataset.channelId = channel.id;
			const selected = channel.id === this.selectedId;
			row.tabIndex = selected ? 0 : -1;
			if (selected) {
				row.setAttribute('aria-current', 'page');
			}
			const copy = append(row, $('.basehalf-video-provider-row-copy'));
			const name = append(copy, $('.basehalf-video-provider-row-name'));
			name.textContent = channel.name;
			const detail = append(copy, $('.basehalf-video-provider-row-detail'));
			const presetLabel = getBaseHalfVideoProviderPreset(channel.provider).label;
			const models = channel.models.length === 1
				? localize('basehalf.video.providers.rowModelsOne', "1 model")
				: localize('basehalf.video.providers.rowModels', "{0} models", channel.models.length);
			// The preset is named only when the channel was renamed.
			detail.textContent = channel.name === presetLabel ? models : localize('basehalf.video.providers.rowDetail', "{0} · {1}", presetLabel, models);
			const keyLabel = channel.hasKey
				? localize('basehalf.video.providers.keySetShort', "Key set")
				: localize('basehalf.video.providers.keyMissingShort', "No key");
			const keyState = append(row, $(`span.basehalf-video-provider-row-key.codicon.${channel.hasKey ? 'codicon-pass-filled' : 'codicon-key'}`));
			keyState.classList.toggle('missing', !channel.hasKey);
			keyState.setAttribute('role', 'img');
			keyState.setAttribute('aria-label', keyLabel);
			disposables.add(this.hoverService.setupDelayedHover(keyState, { content: keyLabel }));
			disposables.add(addDisposableListener(row, EventType.CLICK, () => {
				if (this.selectedId !== channel.id) {
					this.selectedId = channel.id;
					this.replacingKey = false;
					this.fieldErrors.clear();
					this.setStatus('');
					this.render();
					this.rows.get(channel.id)?.focus();
				}
			}));
			disposables.add(addDisposableListener(row, EventType.KEY_DOWN, (event: KeyboardEvent) => {
				const index = rows.indexOf(row);
				const next = event.key === 'ArrowDown' ? index + 1
					: event.key === 'ArrowUp' ? index - 1
						: event.key === 'Home' ? 0
							: event.key === 'End' ? rows.length - 1 : undefined;
				if (next === undefined || next < 0 || next >= rows.length || next === index) {
					return;
				}
				event.preventDefault();
				rows[next].click();
			}));
		}
	}

	private renderEmpty(disposables: DisposableStore): void {
		const empty = append(this.editor!, $('.basehalf-video-provider-editor-empty'));
		const text = append(empty, $('p'));
		text.textContent = localize('basehalf.video.providers.editorEmpty', "Add a provider to choose its models in Video nodes. You need an API key from the provider's console.");
		const add = this.button(empty, localize('basehalf.video.providers.add', "Add Provider…"), 'codicon-add', true);
		add.setAttribute('aria-haspopup', 'menu');
		disposables.add(addDisposableListener(add, EventType.CLICK, () => this.showAddMenu(add)));
	}

	private renderEditor(channel: IBaseHalfVideoChannel, disposables: DisposableStore): void {
		const editor = this.editor!;
		const preset = getBaseHalfVideoProviderPreset(channel.provider);
		const heading = append(editor, $('.basehalf-video-provider-editor-heading'));
		const title = append(heading, $('h2'));
		title.textContent = channel.name;
		const format = append(heading, $('p'));
		format.textContent = localize('basehalf.video.providers.format', "{0} · {1}", preset.label, baseHalfVideoProviderFormatLabel(channel.provider));

		const nameInput = this.textField(editor, 'name', localize('basehalf.video.providers.name', "Name"), channel.name, undefined, disposables);
		nameInput.maxLength = BASEHALF_VIDEO_CHANNEL_NAME_MAX_LENGTH;
		disposables.add(addDisposableListener(nameInput, EventType.CHANGE, () => {
			void this.save('name', () => this.channelService.updateChannel(channel.id, { name: nameInput.value }));
		}));

		const endpointInput = this.textField(editor, 'endpoint', localize('basehalf.video.providers.endpoint', "Endpoint"), channel.baseUrl,
			localize('basehalf.video.providers.endpointHint', "A relay that speaks the same request format works too: enter its address here."), disposables);
		endpointInput.type = 'url';
		disposables.add(addDisposableListener(endpointInput, EventType.CHANGE, () => {
			void this.save('endpoint', () => this.channelService.updateChannel(channel.id, { baseUrl: endpointInput.value }));
		}));

		this.renderKey(editor, channel, disposables);
		this.renderModels(editor, channel, disposables);

		const footer = append(editor, $('.basehalf-video-provider-editor-footer'));
		const remove = this.button(footer, localize('basehalf.video.providers.remove', "Remove Provider"), 'codicon-trash');
		remove.classList.add('danger');
		disposables.add(addDisposableListener(remove, EventType.CLICK, () => void this.removeChannel(channel)));
	}

	private renderKey(editor: HTMLElement, channel: IBaseHalfVideoChannel, disposables: DisposableStore): void {
		const field = append(editor, $('.basehalf-video-provider-field'));
		const label = append(field, $('.basehalf-video-provider-field-label#basehalf-video-provider-key-label'));
		label.textContent = localize('basehalf.video.providers.key', "API Key");
		const state = append(field, $('.basehalf-video-provider-key-state'));
		state.classList.toggle('set', channel.hasKey);
		const stateIcon = append(state, $(`span.codicon.${channel.hasKey ? 'codicon-pass-filled' : 'codicon-key'}`));
		stateIcon.setAttribute('aria-hidden', 'true');
		const stateText = append(state, $('span'));
		stateText.textContent = channel.hasKey
			? localize('basehalf.video.providers.keySet', "A key is set. It is encrypted on this computer and never shown.")
			: localize('basehalf.video.providers.keyMissing', "No key yet. Paste the API key from the provider's console.");

		const row = append(field, $('.basehalf-video-provider-key-row'));
		if (!channel.hasKey || this.replacingKey) {
			const input = append(row, $('input')) as HTMLInputElement;
			input.type = 'password';
			input.autocomplete = 'new-password';
			input.spellcheck = false;
			input.autocapitalize = 'off';
			input.placeholder = localize('basehalf.video.providers.keyPlaceholder', "Paste the API key");
			input.setAttribute('aria-labelledby', 'basehalf-video-provider-key-label');
			this.controls.set('key', input);
			this.sensitiveInputs.add(input);
			const saveKey = this.button(row, channel.hasKey
				? localize('basehalf.video.providers.replaceKeySave', "Save New Key")
				: localize('basehalf.video.providers.setKey', "Set Key"), 'codicon-check', true);
			const submit = () => {
				const value = input.value;
				input.value = '';
				void this.save('key', async () => {
					await this.channelService.setKey(channel.id, value);
					this.replacingKey = false;
				}, localize('basehalf.video.providers.keySaved', "Key saved."), () => {
					// Not saved: give the pasted text back so the user can correct it.
					const current = this.controls.get('key');
					if (current && !current.value) {
						current.value = value;
					}
				});
			};
			disposables.add(addDisposableListener(saveKey, EventType.CLICK, submit));
			disposables.add(addDisposableListener(input, EventType.KEY_DOWN, (event: KeyboardEvent) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					submit();
				} else if (event.key === 'Escape' && this.replacingKey) {
					event.preventDefault();
					event.stopPropagation();
					this.cancelReplacingKey();
				}
			}));
			if (channel.hasKey) {
				const cancel = this.button(row, localize('basehalf.video.providers.cancel', "Cancel"), 'codicon-close');
				disposables.add(addDisposableListener(cancel, EventType.CLICK, () => this.cancelReplacingKey()));
			}
		} else {
			const replace = this.button(row, localize('basehalf.video.providers.replaceKey', "Replace Key"), 'codicon-edit');
			disposables.add(addDisposableListener(replace, EventType.CLICK, () => {
				this.replacingKey = true;
				this.render();
				this.controls.get('key')?.focus();
			}));
			const removeKey = this.button(row, localize('basehalf.video.providers.removeKey', "Remove Key"), 'codicon-trash');
			disposables.add(addDisposableListener(removeKey, EventType.CLICK, () => void this.removeKey(channel)));
		}
		const error = this.errorElement(field, 'key');
		this.controls.get('key')?.setAttribute('aria-describedby', error.id);
	}

	private renderModels(editor: HTMLElement, channel: IBaseHalfVideoChannel, disposables: DisposableStore): void {
		const field = append(editor, $('.basehalf-video-provider-field'));
		const label = append(field, $('.basehalf-video-provider-field-label#basehalf-video-provider-models-label'));
		label.textContent = localize('basehalf.video.providers.models', "Models");
		const hint = append(field, $('p.basehalf-video-provider-field-hint'));
		hint.textContent = localize('basehalf.video.providers.modelsHint', "Video nodes can choose these models, in this order. Add any model id the provider accepts.");

		const chips = append(field, $('ul.basehalf-video-provider-models'));
		chips.setAttribute('aria-labelledby', 'basehalf-video-provider-models-label');
		if (!channel.models.length) {
			const none = append(chips, $('li.basehalf-video-provider-models-empty'));
			none.textContent = localize('basehalf.video.providers.modelsEmpty', "No models yet.");
		}
		for (const model of channel.models) {
			const chip = append(chips, $('li.basehalf-video-provider-model'));
			chip.dataset.model = model;
			const name = append(chip, $('span.basehalf-video-provider-model-name'));
			const modelLabel = baseHalfVideoModelLabel(model);
			name.textContent = modelLabel;
			if (modelLabel !== model) {
				disposables.add(this.hoverService.setupDelayedHover(name, { content: model }));
			}
			const remove = append(chip, $('button.basehalf-video-provider-model-remove')) as HTMLButtonElement;
			remove.type = 'button';
			remove.setAttribute('aria-label', localize('basehalf.video.providers.removeModel', "Remove {0}", modelLabel));
			const icon = append(remove, $('span.codicon.codicon-close'));
			icon.setAttribute('aria-hidden', 'true');
			disposables.add(addDisposableListener(remove, EventType.CLICK, () => {
				void this.save('model', () => this.channelService.updateChannel(channel.id, { models: channel.models.filter(candidate => candidate !== model) }));
			}));
		}

		const row = append(field, $('.basehalf-video-provider-model-add'));
		const input = append(row, $('input')) as HTMLInputElement;
		input.type = 'text';
		input.spellcheck = false;
		input.autocapitalize = 'off';
		input.autocomplete = 'off';
		input.placeholder = localize('basehalf.video.providers.modelPlaceholder', "Add a model id, such as doubao-seedance-2-5-260628");
		input.setAttribute('aria-label', localize('basehalf.video.providers.modelInput', "Model id to add"));
		this.controls.set('model', input);
		const add = this.button(row, localize('basehalf.video.providers.addModel', "Add"), 'codicon-add');
		const error = this.errorElement(field, 'model');
		input.setAttribute('aria-describedby', error.id);
		const submit = () => {
			let model: string;
			try {
				model = normalizeBaseHalfVideoChannelModel(input.value);
			} catch (error) {
				this.showFieldError('model', getErrorMessage(error));
				return;
			}
			if (channel.models.includes(model)) {
				this.showFieldError('model', localize('basehalf.video.providers.modelTaken', "This provider already lists {0}.", model));
				return;
			}
			input.value = '';
			void this.save('model', () => this.channelService.updateChannel(channel.id, { models: [...channel.models, model] }), undefined, () => {
				// Not saved: give the text back so the user can correct it.
				const current = this.controls.get('model');
				if (current && !current.value) {
					current.value = model;
				}
			});
		};
		disposables.add(addDisposableListener(add, EventType.CLICK, submit));
		disposables.add(addDisposableListener(input, EventType.KEY_DOWN, (event: KeyboardEvent) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				submit();
			}
		}));
	}

	private textField(parent: HTMLElement, control: BaseHalfVideoProviderControl, labelText: string, value: string, hintText: string | undefined, disposables: DisposableStore): HTMLInputElement {
		const field = append(parent, $('.basehalf-video-provider-field'));
		const inputId = `basehalf-video-provider-${control}`;
		const label = append(field, $('label.basehalf-video-provider-field-label')) as HTMLLabelElement;
		label.htmlFor = inputId;
		label.textContent = labelText;
		const input = append(field, $('input')) as HTMLInputElement;
		input.id = inputId;
		input.type = 'text';
		input.spellcheck = false;
		input.autocapitalize = 'off';
		input.autocomplete = 'off';
		input.value = value;
		this.controls.set(control, input);
		const describedBy: string[] = [];
		if (hintText) {
			const hint = append(field, $('p.basehalf-video-provider-field-hint'));
			hint.id = `${inputId}-hint`;
			hint.textContent = hintText;
			describedBy.push(hint.id);
		}
		describedBy.push(this.errorElement(field, control).id);
		input.setAttribute('aria-describedby', describedBy.join(' '));
		disposables.add(addDisposableListener(input, EventType.KEY_DOWN, (event: KeyboardEvent) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				input.blur();
			}
		}));
		return input;
	}

	private errorElement(field: HTMLElement, control: BaseHalfVideoProviderControl): HTMLElement {
		const error = append(field, $('.basehalf-video-provider-field-error'));
		error.id = `basehalf-video-provider-${control}-error`;
		error.setAttribute('role', 'alert');
		this.errors.set(control, error);
		const message = this.fieldErrors.get(control);
		error.textContent = message ?? '';
		error.hidden = message === undefined;
		if (message !== undefined) {
			this.controls.get(control)?.setAttribute('aria-invalid', 'true');
		}
		return error;
	}

	private showFieldError(control: BaseHalfVideoProviderControl, message: string): void {
		this.fieldErrors.set(control, message);
		const error = this.errors.get(control);
		if (error) {
			error.textContent = message;
			error.hidden = false;
		}
		this.controls.get(control)?.setAttribute('aria-invalid', 'true');
	}

	/** Runs one change and shows its outcome. Nothing here talks to the provider. */
	private async save(control: BaseHalfVideoProviderControl, operation: () => Promise<void>, success?: string, onFailure?: () => void): Promise<void> {
		if (this.busy) {
			return;
		}
		this.busy = true;
		this.fieldErrors.delete(control);
		try {
			await operation();
			this.busy = false;
			this.setStatus(success ?? localize('basehalf.video.providers.saved', "Saved."), 'success');
			this.render();
		} catch (error) {
			this.busy = false;
			const message = error instanceof BaseHalfVideoChannelError
				? error.message
				: localize('basehalf.video.providers.saveFailed', "BaseHalf could not save this change: {0}", getErrorMessage(error));
			// The field keeps what the user typed, so it can be corrected.
			const typed = control === 'name' || control === 'endpoint' ? this.controls.get(control)?.value : undefined;
			this.fieldErrors.set(control, message);
			this.render();
			const current = this.controls.get(control);
			if (current && typed !== undefined) {
				current.value = typed;
			}
			onFailure?.();
			this.setStatus(localize('basehalf.video.providers.notSaved', "Not saved."), 'warning');
			this.controls.get(control)?.focus();
		}
	}

	private cancelReplacingKey(): void {
		this.replacingKey = false;
		this.fieldErrors.delete('key');
		this.render();
	}

	private showAddMenu(anchor: HTMLElement): void {
		this.contextMenuService.showContextMenu({
			getAnchor: () => anchor,
			getActions: () => getBaseHalfVideoProviderPresets().map(preset => toAction({
				id: `basehalf.video.providers.add.${preset.kind}`,
				label: preset.label,
				tooltip: baseHalfVideoProviderFormatLabel(preset.kind),
				run: () => this.addChannel(preset.kind)
			}))
		});
	}

	private async addChannel(provider: BaseHalfVideoProviderKind): Promise<void> {
		try {
			this.busy = true;
			const channel = await this.channelService.addChannel(provider);
			this.busy = false;
			this.selectedId = channel.id;
			this.replacingKey = false;
			this.fieldErrors.clear();
			this.setStatus(localize('basehalf.video.providers.added', "{0} added. Paste its API key to use it.", channel.name), 'success');
			this.render();
			this.controls.get('key')?.focus();
		} catch (error) {
			this.busy = false;
			this.setStatus(getErrorMessage(error), 'warning');
			if (this.renderPending) {
				this.render();
			}
		}
	}

	private async removeKey(channel: IBaseHalfVideoChannel): Promise<void> {
		const { confirmed } = await this.dialogService.confirm({
			message: localize('basehalf.video.providers.removeKeyConfirm', "Remove the API key of {0}?", channel.name),
			detail: localize('basehalf.video.providers.removeKeyDetail', "The key is deleted from this computer. Video nodes cannot use this provider until you set a key again."),
			primaryButton: localize({ key: 'basehalf.video.providers.removeKeyButton', comment: ['&& denotes a mnemonic'] }, "&&Remove Key")
		});
		if (confirmed) {
			await this.save('key', () => this.channelService.setKey(channel.id, undefined), localize('basehalf.video.providers.keyRemoved', "Key removed."));
		}
	}

	private async removeChannel(channel: IBaseHalfVideoChannel): Promise<void> {
		const { confirmed } = await this.dialogService.confirm({
			message: localize('basehalf.video.providers.removeConfirm', "Remove {0}?", channel.name),
			detail: localize('basehalf.video.providers.removeDetail', "Its key is deleted from this computer. Video nodes that chose its models show that no provider offers them."),
			primaryButton: localize({ key: 'basehalf.video.providers.removeButton', comment: ['&& denotes a mnemonic'] }, "&&Remove Provider")
		});
		if (!confirmed) {
			return;
		}
		this.busy = true;
		try {
			await this.channelService.removeChannel(channel.id);
			this.fieldErrors.clear();
			this.setStatus(localize('basehalf.video.providers.removed', "{0} removed.", channel.name), 'success');
		} catch (error) {
			this.setStatus(localize('basehalf.video.providers.removeFailed', "BaseHalf could not remove {0}: {1}", channel.name, getErrorMessage(error)), 'warning');
		} finally {
			this.busy = false;
		}
		this.render();
	}

	private button(parent: HTMLElement, label: string, icon: string, primary = false): HTMLButtonElement {
		const element = append(parent, $('button.basehalf-video-providers-button')) as HTMLButtonElement;
		element.type = 'button';
		element.classList.toggle('primary', primary);
		const iconElement = append(element, $(`span.codicon.${icon}`));
		iconElement.setAttribute('aria-hidden', 'true');
		const text = append(element, $('span'));
		text.textContent = label;
		return element;
	}

	private setStatus(message: string, kind?: BaseHalfVideoProvidersStatusKind): void {
		if (!this.status) {
			return;
		}
		this.status.textContent = message;
		if (message && kind) {
			this.status.dataset.state = kind;
		} else {
			delete this.status.dataset.state;
		}
	}

	/** The text of fields being edited and the focused field, so a render keeps them. */
	private captureControls(): { readonly focused?: BaseHalfVideoProviderControl; readonly values: ReadonlyMap<BaseHalfVideoProviderControl, string> } {
		const values = new Map<BaseHalfVideoProviderControl, string>();
		let focused: BaseHalfVideoProviderControl | undefined;
		const active = getActiveElement();
		for (const [control, input] of this.controls) {
			if (input === active) {
				focused = control;
			}
			// A focused field keeps what the user is typing when another window
			// changes the provider; the add-model and key fields keep unsaved text.
			if (input.value && (input === active || control === 'model' || control === 'key')) {
				values.set(control, input.value);
			}
		}
		return { focused, values };
	}

	private restoreControls(kept: { readonly focused?: BaseHalfVideoProviderControl; readonly values: ReadonlyMap<BaseHalfVideoProviderControl, string> }): void {
		for (const [control, value] of kept.values) {
			const input = this.controls.get(control);
			if (input) {
				input.value = value;
			}
		}
		if (kept.focused) {
			this.controls.get(kept.focused)?.focus();
		}
	}

	private clearSensitiveInputs(): void {
		for (const input of this.sensitiveInputs) {
			input.value = '';
		}
		this.sensitiveInputs.clear();
	}
}

/** The request format of a provider, as the page names it. */
export function baseHalfVideoProviderFormatLabel(provider: BaseHalfVideoProviderKind): string {
	switch (provider) {
		case 'ark':
		case 'byteplus':
			return localize('basehalf.video.providers.format.seedance', "Seedance task API");
		case 'dashscope':
			return localize('basehalf.video.providers.format.wan', "Wan video synthesis");
		case 'minimax':
			return localize('basehalf.video.providers.format.minimax', "MiniMax video generation");
		case 'gemini':
			return localize('basehalf.video.providers.format.veo', "Veo long-running prediction");
		case 'openai':
			return localize('basehalf.video.providers.format.openai', "/videos tasks");
	}
}
