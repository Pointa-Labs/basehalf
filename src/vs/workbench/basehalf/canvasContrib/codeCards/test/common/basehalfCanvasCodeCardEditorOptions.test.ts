/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { IEditorOptions } from '../../../../../../editor/common/config/editorOptions.js';
import { baseHalfCodeCardEditorOptions } from '../../common/basehalfCanvasCodeCardEditorOptions.js';

suite('BaseHalf code card editor options', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const own = { fontFamily: 'Face Mono', readOnly: false, ariaLabel: 'src/a.ts' };

	test('how editing behaves comes from the settings of the file', () => {
		const settings: IEditorOptions = {
			cursorStyle: 'block',
			cursorBlinking: 'solid',
			cursorWidth: 3,
			autoClosingBrackets: 'never',
			autoClosingQuotes: 'never',
			autoSurround: 'never',
			autoIndent: 'keep',
			multiCursorModifier: 'ctrlCmd',
			multiCursorPaste: 'full',
			find: { seedSearchStringFromSelection: 'never', loop: false },
			emptySelectionClipboard: false,
			copyWithSyntaxHighlighting: false,
			wordSeparators: '.,',
			matchBrackets: 'never',
			selectionHighlight: false,
			dragAndDrop: false,
			smoothScrolling: true
		};
		const options = baseHalfCodeCardEditorOptions(settings, own);
		assert.deepStrictEqual(Object.fromEntries(Object.keys(settings).map(key => [key, (options as Record<string, unknown>)[key]])), settings);
		// What the editor is given is its own: it may change it.
		assert.notStrictEqual(options.find, settings.find);
	});

	test('what has to stand where the face stood is not the settings\'', () => {
		const options = baseHalfCodeCardEditorOptions({
			fontFamily: 'Other',
			fontSize: 20,
			lineHeight: 30,
			fontWeight: 'bold',
			letterSpacing: 2,
			fontLigatures: true,
			fontVariations: true,
			mouseWheelZoom: true,
			wordWrap: 'on',
			padding: { top: 40, bottom: 40 },
			scrollBeyondLastLine: true,
			lineNumbers: 'off',
			lineNumbersMinChars: 6,
			renderFinalNewline: 'off',
			lineDecorationsWidth: 30,
			glyphMargin: true,
			folding: true,
			minimap: { enabled: true },
			stickyScroll: { enabled: true },
			overviewRulerLanes: 3,
			overviewRulerBorder: true,
			hideCursorInOverviewRuler: false,
			rulers: [80],
			scrollbar: { verticalScrollbarSize: 20, useShadows: true },
			renderLineHighlight: 'all',
			guides: { indentation: true, bracketPairs: true },
			renderWhitespace: 'all',
			renderValidationDecorations: 'on',
			editContext: true,
			fixedOverflowWidgets: true,
			automaticLayout: true,
			readOnly: true
		}, own);
		assert.deepStrictEqual(options, {
			fontFamily: 'Face Mono',
			fontSize: 12,
			lineHeight: 18,
			fontWeight: 'normal',
			letterSpacing: 0,
			fontLigatures: false,
			fontVariations: false,
			mouseWheelZoom: false,
			wordWrap: 'off',
			padding: { top: 8, bottom: 12 },
			scrollBeyondLastLine: false,
			lineNumbers: 'on',
			lineNumbersMinChars: 3,
			renderFinalNewline: 'on',
			lineDecorationsWidth: 12,
			glyphMargin: false,
			folding: false,
			minimap: { enabled: false },
			stickyScroll: { enabled: false },
			overviewRulerLanes: 0,
			overviewRulerBorder: false,
			hideCursorInOverviewRuler: true,
			rulers: [],
			scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8, useShadows: false, ignoreHorizontalScrollbarInContentHeight: true, alwaysConsumeMouseWheel: true },
			renderLineHighlight: 'none',
			guides: { indentation: false, bracketPairs: false },
			renderWhitespace: 'selection',
			renderValidationDecorations: 'off',
			editContext: false,
			fixedOverflowWidgets: false,
			useShadowDOM: false,
			automaticLayout: false,
			readOnly: false,
			ariaLabel: 'src/a.ts'
		});
	});

	test('whitespace shows in a selection, or never when the setting says so', () => {
		assert.deepStrictEqual(
			(['none', 'boundary', 'selection', 'trailing', 'all', undefined] as const).map(renderWhitespace => baseHalfCodeCardEditorOptions({ renderWhitespace }, own).renderWhitespace),
			['none', 'selection', 'selection', 'selection', 'selection', 'selection']
		);
		assert.strictEqual(baseHalfCodeCardEditorOptions(undefined, { ...own, readOnly: true }).readOnly, true);
	});
});
