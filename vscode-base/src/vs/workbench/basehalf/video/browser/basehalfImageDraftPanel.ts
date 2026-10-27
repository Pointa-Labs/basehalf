/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../base/browser/dom.js';
import { IBaseHalfInputRowModel } from './basehalfGenerationInputRow.js';
import { BaseHalfVideoNodePanel, IBaseHalfDraftPanelParts } from './basehalfVideoNodePanel.js';

/**
 * The panel of an image draft (generation cards, "The panel of each kind";
 * D91): no input row until the card has an input, and then its tiles alone,
 * since no image model takes a frame or a clip; the prompt; the reason line;
 * and a footer that begins with the two buttons that add an input, Pick on
 * Canvas and Import File…, then the model and the settings, and ends with
 * Generate. With nothing connected it is its prompt and its footer, and no
 * line says what can be added: the two buttons, the `@` menu, and the
 * prompt's placeholder do.
 */
export class BaseHalfImageDraftPanel extends BaseHalfVideoNodePanel {

	protected override arrange(element: HTMLElement, parts: IBaseHalfDraftPanelParts): void {
		element.append(parts.inputRow.element, parts.prompt, parts.notice, parts.reason);
		// The buttons stay where they are when the first input brings the row.
		const footer = append(element, $('.bh-video-panel-footer'));
		footer.append(parts.addButtons.element, parts.model, parts.settings, $('.bh-video-panel-footer-space'), parts.generate);
	}

	protected override showsInputRowBeforeRead(): boolean {
		return false;
	}

	/** The tiles alone, while the card has inputs. */
	protected override inputRowModel(): IBaseHalfInputRowModel | undefined {
		const row = super.inputRowModel();
		return row && row.tiles.length ? Object.freeze({ tiles: row.tiles, editable: row.editable }) : undefined;
	}
}
