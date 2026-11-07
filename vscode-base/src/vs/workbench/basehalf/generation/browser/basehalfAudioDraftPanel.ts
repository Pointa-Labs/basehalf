/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../base/browser/dom.js';
import { BaseHalfVideoNodePanel, IBaseHalfDraftPanelParts } from './basehalfVideoNodePanel.js';

/**
 * The panel of an audio draft (generation cards, "The panel of each kind";
 * D91): the input row whenever the card has inputs or its mode takes any,
 * with its inputs and what a row without inputs says; the prompt; the reason
 * line; and a footer that begins with the two buttons that add an input,
 * also for a model that takes no input, as a speech model, and ends with the
 * settings, the voice of a model that speaks (D78), the model, and Generate
 * (D106).
 */
export class BaseHalfAudioDraftPanel extends BaseHalfVideoNodePanel {

	protected override arrange(element: HTMLElement, parts: IBaseHalfDraftPanelParts): void {
		element.append(parts.inputRow.element, parts.prompt, parts.notice, parts.reason);
		const footer = append(element, $('.bh-video-panel-footer'));
		footer.append(parts.addButtons.element, $('.bh-video-panel-footer-space'), parts.settings, parts.voice, parts.model, parts.generate);
	}

	/** An audio card's row says what its models take, also for a new card. */
	protected override showsInputRowBeforeRead(): boolean {
		return true;
	}
}
