/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfCanvasSnap.css';
import { $, addDisposableListener, append } from '../../../../../base/browser/dom.js';
import { Disposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IBaseHalfCanvasContribution, IBaseHalfCanvasContributionContext, IBaseHalfCanvasView, registerBaseHalfCanvasContribution } from '../../../canvas/browser/basehalfCanvasExtensions.js';
import { BaseHalfSetting } from '../../../shell/common/basehalfConfiguration.js';
import { setBaseHalfHover } from '../../../ui/browser/basehalfHover.js';

/**
 * Whether cards snap, from the value of `basehalf.canvas.snap` as it is read:
 * they do unless the setting says that they do not.
 */
export function baseHalfCanvasSnapFromSetting(value: unknown): boolean {
	return value !== false;
}

/**
 * The magnet among the canvas view controls (canvas selection and
 * arrangement, "Snap to Cards"): whether a card that is moved or resized
 * lines up with the cards near it. The magnet and the setting
 * `basehalf.canvas.snap` are one value: the magnet shows the setting, a click
 * on it writes the setting, and the canvas follows it as it changes.
 */
export class BaseHalfCanvasSnapToggle extends Disposable implements IBaseHalfCanvasContribution {
	static readonly ID = 'basehalf.canvas.snapToggle';

	private readonly canvas: IBaseHalfCanvasView;
	private readonly button: HTMLButtonElement;
	private enabled: boolean | undefined;

	constructor(
		context: IBaseHalfCanvasContributionContext,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();
		this.canvas = context.canvas;
		this.button = append(this.canvas.viewControls, $('button.basehalf-canvas-chrome-button.basehalf-canvas-snap-toggle')) as HTMLButtonElement;
		this.button.type = 'button';
		this.button.setAttribute('data-testid', 'canvas-snap-toggle');
		const icon = append(this.button, $('span.codicon.codicon-magnet'));
		icon.setAttribute('aria-hidden', 'true');
		const label = localize('basehalf.canvas.snapToCards', "Snap to Cards");
		setBaseHalfHover(this.button, label);
		this.button.setAttribute('aria-label', label);
		this._register(addDisposableListener(this.button, 'click', () => this.toggle()));
		this._register(toDisposable(() => this.button.remove()));
		this._register(this.configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(BaseHalfSetting.CanvasSnap)) {
				this.followSetting();
			}
		}));
		this.followSetting();
	}

	private followSetting(): void {
		this.show(baseHalfCanvasSnapFromSetting(this.configurationService.getValue(BaseHalfSetting.CanvasSnap)));
	}

	/**
	 * A click shows the new state at once and writes the setting, where a row
	 * of Settings writes it: no target is given, so the base writes it where
	 * the value in effect comes from, and a value equal to the default as no
	 * value. A write that fails leaves the setting, which the magnet shows again.
	 */
	private toggle(): void {
		const enabled = !this.enabled;
		this.show(enabled);
		this.configurationService.updateValue(BaseHalfSetting.CanvasSnap, enabled).then(undefined, error => {
			if (!this._store.isDisposed) {
				this.followSetting();
				this.canvas.reportError(error);
			}
		});
	}

	private show(enabled: boolean): void {
		if (this.enabled === enabled) {
			return;
		}
		this.enabled = enabled;
		this.canvas.setSnapEnabled(enabled);
		this.button.setAttribute('aria-pressed', String(enabled));
		this.button.classList.toggle('active', enabled);
	}
}

registerBaseHalfCanvasContribution(BaseHalfCanvasSnapToggle.ID, BaseHalfCanvasSnapToggle);
