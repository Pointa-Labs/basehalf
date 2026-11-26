/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { deepClone } from '../../../../../base/common/objects.js';
import { IEditorOptions } from '../../../../../editor/common/config/editorOptions.js';
import { BASEHALF_CODE_FACE_BOTTOM_PADDING, BASEHALF_CODE_FACE_FONT_SIZE, BASEHALF_CODE_FACE_LINE_HEIGHT, BASEHALF_CODE_FACE_MARK_LANE, BASEHALF_CODE_FACE_TOP_PADDING } from './basehalfCanvasCodeFaceLayout.js';

/** What the card's editor takes from its card and its file, and not from the settings. */
export interface IBaseHalfCodeCardEditorOwn {
	/** The font of the face. */
	readonly fontFamily: string;
	readonly readOnly: boolean;
	readonly ariaLabel: string;
}

/**
 * The options of the editor on a code card (code cards, rules 30 to 32): the settings `editor.*`
 * for the file and its language, and over them what has to stand where the face stood.
 */
export function baseHalfCodeCardEditorOptions(settings: IEditorOptions | undefined, own: IBaseHalfCodeCardEditorOwn): IEditorOptions {
	const followed = deepClone(settings ?? {});
	return {
		...followed,

		// A line of the editor is the line the face drew.
		fontFamily: own.fontFamily,
		fontSize: BASEHALF_CODE_FACE_FONT_SIZE,
		lineHeight: BASEHALF_CODE_FACE_LINE_HEIGHT,
		fontWeight: 'normal',
		letterSpacing: 0,
		fontLigatures: false,
		fontVariations: false,
		mouseWheelZoom: false,

		// A line stands at the height it had, and the file ends where the face ends.
		wordWrap: 'off',
		padding: { top: BASEHALF_CODE_FACE_TOP_PADDING, bottom: BASEHALF_CODE_FACE_BOTTOM_PADDING },
		scrollBeyondLastLine: false,

		// The gutter is as wide as the face's, with the same numbers.
		lineNumbers: 'on',
		lineNumbersMinChars: 3,
		renderFinalNewline: 'on',
		lineDecorationsWidth: BASEHALF_CODE_FACE_MARK_LANE,
		glyphMargin: false,
		folding: false,

		// Beside and over its lines a face has only its own ruler.
		minimap: { enabled: false },
		stickyScroll: { enabled: false },
		overviewRulerLanes: 0,
		overviewRulerBorder: false,
		hideCursorInOverviewRuler: true,
		rulers: [],
		scrollbar: {
			verticalScrollbarSize: 8,
			horizontalScrollbarSize: 8,
			useShadows: false,
			ignoreHorizontalScrollbarInContentHeight: true,
			alwaysConsumeMouseWheel: true
		},

		// Nothing comes onto a line with the editor that the face did not draw.
		renderLineHighlight: 'none',
		guides: { indentation: false, bracketPairs: false },
		renderWhitespace: followed.renderWhitespace === 'none' ? 'none' : 'selection',
		renderValidationDecorations: 'off',

		// The card is scaled by the canvas. A text area stands at the caret in a card of any zoom, so an input
		// method's candidates do; the other way reports places as if nothing were scaled. Its widgets scale
		// with the card, and its menus stand over the window, not inside the card.
		editContext: false,
		fixedOverflowWidgets: false,
		useShadowDOM: false,
		automaticLayout: false,

		readOnly: own.readOnly,
		ariaLabel: own.ariaLabel
	};
}
