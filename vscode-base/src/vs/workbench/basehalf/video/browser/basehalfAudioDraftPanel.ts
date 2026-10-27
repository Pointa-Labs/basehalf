/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../base/browser/dom.js';
import { BaseHalfVideoNodePanel, IBaseHalfDraftPanelParts } from './basehalfVideoNodePanel.js';

/**
 * The panel of an audio draft (generation cards, "The panel of each kind";
 * D91): the input row whenever the card has inputs or its mode takes any,
 * with its inputs, what a row without inputs says, and at its right end, the
 * panel's top right, the two buttons that add an input (D71); the prompt; the
 * reason line; and a footer of the model, the voice of a model that speaks
 * (D78), the settings, and Generate.
 */
export class BaseHalfAudioDraftPanel extends BaseHalfVideoNodePanel {

	protected override arrange(element: HTMLElement, parts: IBaseHalfDraftPanelParts): void {
		parts.inputRow.holdAddButtons(parts.addButtons);
		element.append(parts.inputRow.element, parts.prompt, parts.notice, parts.reason);
		const footer = append(element, $('.bh-video-panel-footer'));
		footer.append(parts.model, parts.voice, parts.settings, $('.bh-video-panel-footer-space'), parts.generate);
	}

	/** An audio card's row says what its models take, also for a new card. */
	protected override showsInputRowBeforeRead(): boolean {
		return true;
	}
}
