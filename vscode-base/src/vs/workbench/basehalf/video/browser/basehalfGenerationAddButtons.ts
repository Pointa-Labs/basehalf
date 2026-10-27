/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfGenerationAddButtons.css';
import { $, addDisposableListener, append } from '../../../../base/browser/dom.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize } from '../../../../nls.js';

/** What the two buttons ask of the panel. */
export interface IBaseHalfAddButtonsDelegate {
	/** Starts Pick on Canvas, or ends it while it is on (D71). */
	togglePick(): void;
	/** Copies a file into the card's folder and connects it (D71). */
	importFile(): void;
	/** Gives `element` BaseHalf's tooltip. */
	setupHover(element: HTMLElement, content: string): IDisposable;
}

/**
 * The two buttons that add an input to a draft (generation cards, "The
 * panel"; D71, D91): Pick on Canvas, highlighted while the draft picks, and
 * Import File…, each an icon whose name is its tooltip and its accessible
 * name. It is one part of every kind's panel, which places it: the input row
 * of a video or an audio card holds it at its right end, the footer of an
 * image card at its start. While the draft picks, it tells assistive
 * technology what a click does without showing it.
 */
export class BaseHalfGenerationAddButtons extends Disposable {

	readonly element: HTMLElement;

	private readonly pick: HTMLButtonElement;
	private readonly status: HTMLElement;

	constructor(private readonly delegate: IBaseHalfAddButtonsDelegate) {
		super();
		this.element = $('.bh-add-inputs');
		this.pick = this.button('pick', Codicon.inspect, localize('basehalf.generation.addInputs.pick', "Pick on Canvas"), () => this.delegate.togglePick());
		this.pick.setAttribute('aria-pressed', 'false');
		// A paperclip, as an attachment has: nothing is uploaded anywhere, the file is copied into the folder.
		this.button('import', Codicon.attach, localize('basehalf.generation.addInputs.import', "Import File…"), () => this.delegate.importFile());
		this.status = append(this.element, $('span.bh-add-inputs-status'));
		this.status.setAttribute('role', 'status');
	}

	/** Shows whether the draft picks (D69): Pick on Canvas is highlighted, and what a click does is told. */
	update(picking: boolean): void {
		this.pick.setAttribute('aria-pressed', String(picking));
		const status = picking ? localize('basehalf.generation.addInputs.picking', "Click cards on the canvas. Escape or Done ends.") : '';
		if (this.status.textContent !== status) {
			this.status.textContent = status;
		}
	}

	private button(key: string, icon: ThemeIcon, name: string, run: () => void): HTMLButtonElement {
		const button = append(this.element, $<HTMLButtonElement>('button.bh-add-input'));
		button.type = 'button';
		button.dataset.key = key;
		button.setAttribute('aria-label', name);
		const glyph = renderIcon(icon);
		glyph.setAttribute('aria-hidden', 'true');
		button.append(glyph);
		this._register(this.delegate.setupHover(button, name));
		this._register(addDisposableListener(button, 'click', () => run()));
		return button;
	}
}
