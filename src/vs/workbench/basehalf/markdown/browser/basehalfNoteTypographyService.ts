/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { getWindow } from '../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { BASEHALF_NOTES_FONT_SIZE, BASEHALF_NOTES_FONT_SIZE_MAX, BASEHALF_NOTES_FONT_SIZE_MIN, BaseHalfSetting } from '../../shell/common/basehalfConfiguration.js';
import { applyBaseHalfNoteTypography, baseHalfNoteTypographiesEqual, baseHalfNoteTypography, IBaseHalfNoteTextSizes, IBaseHalfNoteTypography } from '../common/basehalfNoteTypography.js';

/** The setting of the font of code, which code in a note is in (note rendering, rule 37). */
const CODE_FONT_FAMILY_SETTING = 'editor.fontFamily';

/** The text sizes a note takes: the limits and the default of `basehalf.notes.fontSize`. */
export const BASEHALF_NOTE_TEXT_SIZES: IBaseHalfNoteTextSizes = {
	initial: BASEHALF_NOTES_FONT_SIZE,
	minimum: BASEHALF_NOTES_FONT_SIZE_MIN,
	maximum: BASEHALF_NOTES_FONT_SIZE_MAX
};

/** What stands for the font of the window while the window's element is not drawn. */
const WINDOW_FONT_UNKNOWN = 'sans-serif';

export const IBaseHalfNoteTypographyService = createDecorator<IBaseHalfNoteTypographyService>('baseHalfNoteTypographyService');

/**
 * What a note is set in, in this window (note rendering, "The typography of
 * a note"). The service is the one reader of the settings a note's typography
 * follows. It keeps the typography on the element of the window, where the
 * stylesheets of the card and of Preview read it, so those surfaces follow a
 * change without code of their own; a surface that is another document, as
 * Rich's page, or that measures what it drew, as a card built in parts, asks
 * the service and hears when the typography changed.
 */
export interface IBaseHalfNoteTypographyService {
	readonly _serviceBrand: undefined;
	readonly typography: IBaseHalfNoteTypography;
	/** The typography is about to change: the notes of the window are still drawn in the old one. */
	readonly onWillChange: Event<void>;
	/** The typography changed, and the element of the window holds the new one. */
	readonly onDidChange: Event<IBaseHalfNoteTypography>;
}

export class BaseHalfNoteTypographyService extends Disposable implements IBaseHalfNoteTypographyService {
	declare readonly _serviceBrand: undefined;

	private readonly _onWillChange = this._register(new Emitter<void>());
	readonly onWillChange = this._onWillChange.event;
	private readonly _onDidChange = this._register(new Emitter<IBaseHalfNoteTypography>());
	readonly onDidChange = this._onDidChange.event;

	private current: IBaseHalfNoteTypography;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILayoutService private readonly layoutService: ILayoutService
	) {
		super();
		this.current = this.read();
		applyBaseHalfNoteTypography(this.layoutService.mainContainer.style, this.current);
		if (!this.layoutService.mainContainer.isConnected) {
			// A window that is starting has its element, but has not drawn it yet:
			// the element has no font to read. Its first layout comes once it is
			// drawn, and before anything is restored into it.
			this._register(Event.once(this.layoutService.onDidLayoutMainContainer)(() => this.follow()));
		}
		this._register(this.configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(BaseHalfSetting.NotesFontFamily)
				|| event.affectsConfiguration(BaseHalfSetting.NotesFontSize)
				|| event.affectsConfiguration(CODE_FONT_FAMILY_SETTING)) {
				this.follow();
			}
		}));
	}

	get typography(): IBaseHalfNoteTypography {
		return this.current;
	}

	/** Takes the typography that the settings and the window give now, and tells it when it is another. */
	private follow(): void {
		const next = this.read();
		if (baseHalfNoteTypographiesEqual(next, this.current)) {
			return;
		}
		// One task of the window: no frame is drawn between the three.
		this._onWillChange.fire();
		this.current = next;
		applyBaseHalfNoteTypography(this.layoutService.mainContainer.style, next);
		this._onDidChange.fire(next);
	}

	private read(): IBaseHalfNoteTypography {
		return baseHalfNoteTypography({
			fontFamily: this.configurationService.getValue(BaseHalfSetting.NotesFontFamily),
			fontSize: this.configurationService.getValue(BaseHalfSetting.NotesFontSize),
			codeFontFamily: this.configurationService.getValue(CODE_FONT_FAMILY_SETTING)
		}, this.windowFontFamily(), BASEHALF_NOTE_TEXT_SIZES);
	}

	/**
	 * The font of the window as its element is drawn in: the list of the
	 * system, or the one the window has for the user's language. The typography
	 * is written to the element's own style, which never sets its font.
	 */
	private windowFontFamily(): string {
		const container = this.layoutService.mainContainer;
		return getWindow(container).getComputedStyle(container).fontFamily || WINDOW_FONT_UNKNOWN;
	}
}
