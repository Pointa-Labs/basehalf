/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfVideoNode.css';
import { $, append, clearNode, disposableWindowInterval, getWindow } from '../../../../base/browser/dom.js';
import { Disposable, IDisposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { renderBaseHalfItemGlyph } from '../../shell/browser/basehalfItemGlyph.js';
import { BaseHalfGenerationKind } from '../common/basehalfGenerationInfo.js';
import { baseHalfGenerationCardPresentation, BaseHalfGenerationCardState, baseHalfGenerationPhaseOfTask, formatBaseHalfVideoElapsed, IBaseHalfGenerationCardPresentation } from '../common/basehalfVideoCardPresentation.js';
import { IBaseHalfGenerationTaskStore, IBaseHalfVideoGenerationService } from '../common/basehalfVideoGeneration.js';

/** What a generation card shows in the place of its file. */
export interface IBaseHalfGenerationCardFaceInput {
	/** The card's file, whether or not it exists. */
	readonly resource: URI;
	/** Workspace-relative path of the card. */
	readonly path: string;
	/** The card's name: the name its file has, or will have. */
	readonly name: string;
	readonly kind: BaseHalfGenerationKind;
	/** Whether the file exists. A card whose file is there shows the face only when the file cannot be shown. */
	readonly hasFile: boolean;
	/**
	 * What the face of the card showed while its file was saved, for a card
	 * drawn again with that file: the face shows it, its time counting on,
	 * until it is disposed, so that the card goes from Saving straight to its
	 * picture.
	 */
	readonly carried?: IBaseHalfGenerationCardPresentation;
}

export interface IBaseHalfGenerationCardFaceServices {
	readonly hoverService: IHoverService;
	/** The phase and progress of a generation this window follows. */
	readonly generationService: IBaseHalfVideoGenerationService;
	/** The task records of this computer, which decide the phase. */
	readonly taskStore: IBaseHalfGenerationTaskStore;
}

/** A drawn face of a generation card. Dispose it with the card's body. */
export interface IBaseHalfGenerationCardFace extends IDisposable {
	readonly element: HTMLElement;
	/** What the face shows now. */
	readonly state: BaseHalfGenerationCardState;
	/**
	 * What the face shows while the card's file is saved, and keeps showing
	 * once it is: the record goes when the file is there, and the card is
	 * drawn again with it. `undefined` at any other time.
	 */
	readonly saving: IBaseHalfGenerationCardPresentation | undefined;
}

/**
 * Draws the face of a generation card into `container` (D63, D64, generation
 * cards, "The card"): the glyph of its kind for a draft; the glyph, the phase
 * in words, the time since the start, and a progress bar while it generates;
 * the error in at most two lines, with the whole text in its tooltip, when the
 * generation failed; "Stopped"; and, for a file this computer cannot show,
 * that it cannot, with its path in the tooltip. The face follows the task
 * records of this computer and the progress of a generation in this window by
 * itself, so the card around it stays as it is. A card with its file that can
 * be shown draws its image or its video as the card of any such file does.
 * Saving stays when the record goes once the file is saved: the card is drawn
 * again with its file, and shows Saving until its picture can be drawn
 * (`carried`).
 */
export function renderBaseHalfGenerationCardFace(container: HTMLElement, input: IBaseHalfGenerationCardFaceInput, services: IBaseHalfGenerationCardFaceServices): IBaseHalfGenerationCardFace {
	return new BaseHalfGenerationCardFace(container, input, services);
}

class BaseHalfGenerationCardFace extends Disposable implements IBaseHalfGenerationCardFace {

	readonly element: HTMLElement;
	private readonly hover = this._register(new MutableDisposable());
	private readonly ticker = this._register(new MutableDisposable());
	private elapsed: HTMLElement | undefined;
	private tooltip: string | undefined;
	private renderedKey: string | undefined;
	private current: IBaseHalfGenerationCardPresentation | undefined;
	private savingShown: IBaseHalfGenerationCardPresentation | undefined;

	constructor(
		container: HTMLElement,
		private readonly input: IBaseHalfGenerationCardFaceInput,
		private readonly services: IBaseHalfGenerationCardFaceServices
	) {
		super();
		this.element = append(container, $('.bh-generation-card'));
		this.element.dataset.kind = input.kind;
		this._register(services.generationService.onDidChangeProgress(resource => {
			if (isEqual(resource, this.input.resource)) {
				this.render();
			}
		}));
		this._register(services.taskStore.onDidChange(() => this.render()));
		this._register(toDisposable(() => this.element.remove()));
		this.render();
	}

	get state(): BaseHalfGenerationCardState {
		return this.current?.state ?? 'draft';
	}

	get saving(): IBaseHalfGenerationCardPresentation | undefined {
		return this.savingShown;
	}

	private render(): void {
		const carried = this.input.carried;
		if (carried) {
			this.savingShown = carried;
			this.show(carried.startedAt !== undefined ? { ...carried, elapsedText: formatBaseHalfVideoElapsed(Date.now() - carried.startedAt) } : carried);
			return;
		}
		const progress = this.services.generationService.getProgress(this.input.resource);
		const task = this.services.taskStore.forCard(this.input.resource);
		if (!task && this.savingShown) {
			// The record goes once the file is saved: the card is drawn again
			// with its file, and says Saving until then.
			return;
		}
		const presentation = baseHalfGenerationCardPresentation({
			path: this.input.path,
			name: this.input.name,
			kind: this.input.kind,
			// A card whose file is there shows its face only when the file cannot be shown.
			hasFile: this.input.hasFile,
			...(this.input.hasFile ? { fileShowable: false } : {}),
			...(task ? { task } : {}),
			...(progress ? { progress } : {}),
			now: Date.now()
		});
		this.savingShown = presentation.state === 'generating' && task && (progress?.phase ?? baseHalfGenerationPhaseOfTask(task, this.input.path)) === 'saving'
			? presentation
			: undefined;
		this.show(presentation);
	}

	private show(presentation: IBaseHalfGenerationCardPresentation): void {
		this.current = presentation;
		this.element.dataset.state = presentation.state;
		this.element.setAttribute('role', 'img');
		this.element.setAttribute('aria-label', presentation.ariaLabel);
		// The face is drawn again only when what it shows changed; the time counts up by itself.
		const key = JSON.stringify([presentation.state, presentation.phaseText, presentation.fraction, presentation.message, presentation.tooltip, presentation.startedAt]);
		if (key !== this.renderedKey) {
			this.renderedKey = key;
			this.renderFace(presentation);
		}
		this.updateTicker(presentation);
	}

	private renderFace(presentation: IBaseHalfGenerationCardPresentation): void {
		clearNode(this.element);
		this.elapsed = undefined;
		const glyph = append(this.element, $('.bh-generation-card-glyph'));
		renderBaseHalfItemGlyph(glyph, this.input.kind, 'currentColor', presentation.state === 'draft' ? 40 : 30);
		if (presentation.state === 'generating') {
			const status = append(this.element, $('.bh-generation-card-status'));
			append(status, $('span.bh-generation-card-phase')).textContent = presentation.phaseText ?? '';
			if (presentation.elapsedText !== undefined) {
				this.elapsed = append(status, $('span.bh-generation-card-elapsed'));
				this.elapsed.textContent = presentation.elapsedText;
			}
			const bar = append(this.element, $('.bh-generation-card-progress'));
			const value = append(bar, $('.bh-generation-card-progress-value'));
			bar.setAttribute('role', 'progressbar');
			bar.setAttribute('aria-label', presentation.phaseText ?? '');
			bar.setAttribute('aria-valuemin', '0');
			bar.setAttribute('aria-valuemax', '100');
			if (presentation.fraction === undefined) {
				bar.classList.add('indeterminate');
			} else {
				const percent = Math.round(presentation.fraction * 100);
				value.style.width = `${percent}%`;
				bar.setAttribute('aria-valuenow', String(percent));
			}
		} else if (presentation.message !== undefined) {
			append(this.element, $('.bh-generation-card-message')).textContent = presentation.message;
		}
		this.tooltip = presentation.tooltip;
		if (this.tooltip !== undefined && !this.hover.value) {
			this.hover.value = this.services.hoverService.setupDelayedHover(this.element, () => ({ content: this.tooltip ?? '' }));
		} else if (this.tooltip === undefined) {
			this.hover.clear();
		}
	}

	/** While the card generates, the time since it started counts up each second. */
	private updateTicker(presentation: IBaseHalfGenerationCardPresentation): void {
		const startedAt = presentation.startedAt;
		if (presentation.state !== 'generating' || startedAt === undefined) {
			this.ticker.clear();
			return;
		}
		if (!this.ticker.value) {
			this.ticker.value = disposableWindowInterval(getWindow(this.element), () => {
				if (this.elapsed && this.current?.startedAt !== undefined) {
					this.elapsed.textContent = formatBaseHalfVideoElapsed(Date.now() - this.current.startedAt);
				}
			}, 1000);
		}
	}
}
