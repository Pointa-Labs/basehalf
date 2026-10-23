/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BaseHalfGenerationPromptEditor, IBaseHalfPromptEditorOptions } from '../../browser/basehalfGenerationPromptEditor.js';

/** Two images and a video are connected: 图片1 has a picture, 图片2 has none yet. */
const CHIPS: IBaseHalfPromptEditorOptions['chipOf'] = name => {
	if (name.kind === 'image' && name.ordinal === 1) {
		return { kind: 'image', picture: 'data:image/png;base64,iVBORw0KGgo=' };
	}
	if (name.kind === 'image' && name.ordinal === 2) {
		return { kind: 'image' };
	}
	if (name.kind === 'video' && name.ordinal === 1) {
		return { kind: 'video' };
	}
	return undefined;
};

/** What the field draws: text, chips by name, unknown names, and the holder of an empty last line. */
function drawn(editor: BaseHalfGenerationPromptEditor): string[] {
	return [...editor.element.childNodes].map(node => {
		if (node.nodeType === node.TEXT_NODE) {
			return node.textContent === '​' ? 'caret holder' : `text ${node.textContent}`;
		}
		const element = node as HTMLElement;
		if (element.classList.contains('bh-prompt-chip')) {
			return `chip ${element.dataset.name}${element.querySelector('img') ? ' with picture' : ''}`;
		}
		if (element.classList.contains('bh-prompt-name')) {
			return `unknown ${element.textContent}`;
		}
		return element.tagName.toLowerCase();
	});
}

/** Changes the text of the field's last text node as typing does, and says so. */
function type(editor: BaseHalfGenerationPromptEditor, text: string): void {
	const before = new InputEvent('beforeinput', { inputType: 'insertText', data: text, bubbles: true, cancelable: true });
	editor.element.dispatchEvent(before);
	let last = editor.element.lastChild;
	if (!last || last.nodeType !== last.TEXT_NODE) {
		last = editor.element.appendChild(mainWindow.document.createTextNode(''));
	}
	last.textContent = (last.textContent ?? '') + text;
	caretAtEnd(editor);
	editor.element.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: text, bubbles: true }));
}

/** Puts the browser's caret after the field's last element, as typing at the end leaves it. */
function caretAtEnd(editor: BaseHalfGenerationPromptEditor): void {
	const selection = mainWindow.getSelection()!;
	const range = mainWindow.document.createRange();
	range.selectNodeContents(editor.element);
	range.collapse(false);
	selection.removeAllRanges();
	selection.addRange(range);
}

suite('BaseHalfGenerationPromptEditor (D68)', () => {
	const disposables = new DisposableStore();
	let time = 0;

	function create(options?: Partial<IBaseHalfPromptEditorOptions>): BaseHalfGenerationPromptEditor {
		const editor = disposables.add(new BaseHalfGenerationPromptEditor({
			ariaLabel: 'Prompt',
			placeholder: 'Describe the video.',
			maxLength: 64,
			chipOf: CHIPS,
			now: () => time,
			...options
		}));
		mainWindow.document.body.appendChild(editor.element);
		disposables.add({ dispose: () => editor.element.remove() });
		return editor;
	}

	setup(() => { time = 0; });
	teardown(() => disposables.clear());
	ensureNoDisposablesAreLeakedInTestSuite();

	test('shows the names of inputs as chips and other names as warnings, and reads back the same text', () => {
		const editor = create();
		editor.setValue('图片1骑车经过视频1，Image 2 and 图片9\n');
		assert.deepStrictEqual({ drawn: drawn(editor), value: editor.value }, {
			drawn: ['chip 图片1 with picture', 'text 骑车经过', 'chip 视频1', 'text ，', 'chip Image 2', 'text  and ', 'unknown 图片9', 'text \n', 'br'],
			value: '图片1骑车经过视频1，Image 2 and 图片9\n'
		});
	});

	test('a name typed by hand turns into a chip, and one more digit makes it the name it now spells', () => {
		const editor = create();
		editor.setValue('骑车');
		editor.focus();
		let changes = 0;
		disposables.add(editor.onDidChange(() => changes++));
		type(editor, '图片1');
		const typed = drawn(editor);
		type(editor, '0');
		assert.deepStrictEqual({ typed, then: drawn(editor), value: editor.value, changes }, {
			typed: ['text 骑车', 'chip 图片1 with picture', 'caret holder'],
			then: ['text 骑车', 'unknown 图片10'],
			value: '骑车图片10',
			changes: 2
		});
	});

	test('nothing turns into a chip while an input method composes', () => {
		const editor = create();
		editor.setValue('');
		editor.focus();
		editor.element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		editor.element.append(mainWindow.document.createTextNode('图片1'));
		editor.element.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', isComposing: true, bubbles: true }));
		const composing = { drawn: drawn(editor), value: editor.value, composing: editor.composing };
		editor.element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
		assert.deepStrictEqual({ composing, ended: drawn(editor), value: editor.value }, {
			composing: { drawn: ['text 图片1'], value: '', composing: true },
			ended: ['chip 图片1 with picture', 'caret holder'],
			value: '图片1'
		});
	});

	test('Enter and Shift+Enter put in a new line as text', () => {
		const editor = create();
		editor.setValue('ab');
		editor.focus(1);
		const enter = new InputEvent('beforeinput', { inputType: 'insertParagraph', bubbles: true, cancelable: true });
		editor.element.dispatchEvent(enter);
		editor.element.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertLineBreak', bubbles: true, cancelable: true }));
		assert.deepStrictEqual({ prevented: enter.defaultPrevented, value: editor.value, caret: editor.selection() }, {
			prevented: true,
			value: 'a\n\nb',
			caret: { start: 3, end: 3 }
		});
	});

	test('paste puts in the text alone, as far as the longest prompt', () => {
		const editor = create({ maxLength: 12 });
		editor.setValue('图片1 ');
		editor.focus();
		const data = new DataTransfer();
		data.setData('text/plain', 'and 视频1\r\nrides on and on');
		data.setData('text/html', '<b>bold</b>');
		const paste = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
		editor.element.dispatchEvent(paste);
		assert.deepStrictEqual({ prevented: paste.defaultPrevented, value: editor.value, drawn: drawn(editor) }, {
			prevented: true,
			value: '图片1 and 视频1\n',
			drawn: ['chip 图片1 with picture', 'text  and ', 'chip 视频1', 'caret holder', 'text \n', 'br']
		});
	});

	test('copy and cut take the selection as text, chips as their names', () => {
		const editor = create();
		editor.setValue('从图片1到图片2');
		editor.focus();
		editor.setSelection({ start: 1, end: 8 });
		const copied = new DataTransfer();
		editor.element.dispatchEvent(new ClipboardEvent('copy', { clipboardData: copied, bubbles: true, cancelable: true }));
		const cut = new DataTransfer();
		editor.setSelection({ start: 0, end: 4 });
		editor.element.dispatchEvent(new ClipboardEvent('cut', { clipboardData: cut, bubbles: true, cancelable: true }));
		assert.deepStrictEqual({ copied: copied.getData('text/plain'), cut: cut.getData('text/plain'), value: editor.value }, {
			copied: '图片1到图片2',
			cut: '从图片1',
			value: '到图片2'
		});
	});

	test('the caret steps over a chip: a place inside it is the place after it', () => {
		const editor = create();
		editor.setValue('a图片1b');
		editor.focus();
		editor.setSelection({ start: 2, end: 2 });
		const inside = editor.selection();
		editor.setSelection({ start: 1, end: 4 });
		assert.deepStrictEqual({ inside, around: editor.selection() }, { inside: { start: 4, end: 4 }, around: { start: 1, end: 4 } });
	});

	test('undo and redo go back through its own edits, typing in a run is one step, and new text from the file starts again', () => {
		const editor = create();
		editor.setValue('骑车');
		editor.focus();
		type(editor, 'a');
		time += 100;
		type(editor, 'b');
		time += 5000;
		type(editor, 'c');
		editor.replace(0, 0, '图片1 ');
		const steps: string[] = [editor.value];
		while (editor.undo()) {
			steps.push(editor.value);
		}
		editor.redo();
		const redone = editor.value;
		editor.setValue('from the file');
		assert.deepStrictEqual({ steps, redone, canUndo: editor.undo() }, {
			steps: ['图片1 骑车abc', '骑车abc', '骑车ab', '骑车'],
			redone: '骑车ab',
			canUndo: false
		});
	});

	test('the browser\'s own undo of the field runs the field\'s undo', () => {
		const editor = create();
		editor.setValue('');
		editor.focus();
		type(editor, 'x');
		const undo = new InputEvent('beforeinput', { inputType: 'historyUndo', bubbles: true, cancelable: true });
		editor.element.dispatchEvent(undo);
		assert.deepStrictEqual({ prevented: undo.defaultPrevented, value: editor.value }, { prevented: true, value: '' });
	});

	test('a prompt that is read only can be selected but not changed, and its names are still chips', () => {
		const editor = create();
		editor.setValue('图片1 at dawn');
		editor.readOnly = true;
		editor.replace(0, 0, 'no ');
		const paste = new DataTransfer();
		paste.setData('text/plain', 'no');
		editor.element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: paste, bubbles: true, cancelable: true }));
		assert.deepStrictEqual({ editable: editor.element.contentEditable, value: editor.value, drawn: drawn(editor) }, {
			editable: 'false',
			value: '图片1 at dawn',
			drawn: ['chip 图片1 with picture', 'text  at dawn']
		});
	});

	test('replace puts a name in place of what was typed and the caret after it', () => {
		const editor = create();
		editor.setValue('look at @');
		editor.focus();
		editor.replace(8, 9, '视频1 ');
		assert.deepStrictEqual({ value: editor.value, caret: editor.selection(), drawn: drawn(editor) }, {
			value: 'look at 视频1 ',
			caret: { start: 12, end: 12 },
			drawn: ['text look at ', 'chip 视频1', 'text  ']
		});
	});
});
