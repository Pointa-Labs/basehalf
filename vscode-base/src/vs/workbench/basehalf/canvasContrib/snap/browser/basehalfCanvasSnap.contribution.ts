/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfCanvasSnap.css';
import { $, addDisposableListener, append } from '../../../../../base/browser/dom.js';
import { Disposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IBaseHalfCanvasContribution, IBaseHalfCanvasContributionContext, IBaseHalfCanvasView, registerBaseHalfCanvasContribution } from '../../../canvas/browser/basehalfCanvasExtensions.js';
import { setBaseHalfHover } from '../../../shell/browser/basehalfHover.js';

/**
 * The button among the canvas view controls that turns snapping on and off:
 * whether a card that is moved snaps to the edges and centers of other cards.
 * Snapping is on when the canvas starts.
 */
export class BaseHalfCanvasSnapToggle extends Disposable implements IBaseHalfCanvasContribution {
	static readonly ID = 'basehalf.canvas.snapToggle';

	private readonly canvas: IBaseHalfCanvasView;
	private readonly button: HTMLButtonElement;
	private enabled = true;

	constructor(context: IBaseHalfCanvasContributionContext) {
		super();
		this.canvas = context.canvas;
		this.button = append(this.canvas.viewControls, $('button.basehalf-canvas-chrome-button.basehalf-canvas-snap-toggle')) as HTMLButtonElement;
		this.button.type = 'button';
		this.button.setAttribute('data-testid', 'canvas-snap-toggle');
		const icon = append(this.button, $('span.codicon.codicon-magnet'));
		icon.setAttribute('aria-hidden', 'true');
		const label = localize('basehalf.canvas.snapToCards', "Snap to cards");
		setBaseHalfHover(this.button, label);
		this.button.setAttribute('aria-label', label);
		this._register(addDisposableListener(this.button, 'click', () => this.toggle()));
		this._register(toDisposable(() => this.button.remove()));
		this.update();
	}

	private toggle(): void {
		this.enabled = !this.enabled;
		this.canvas.setSnapEnabled(this.enabled);
		this.update();
	}

	private update(): void {
		this.button.setAttribute('aria-pressed', String(this.enabled));
		this.button.classList.toggle('active', this.enabled);
	}
}

registerBaseHalfCanvasContribution(BaseHalfCanvasSnapToggle.ID, BaseHalfCanvasSnapToggle);
