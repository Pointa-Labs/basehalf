/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { SelectAllCommand } from '../../../../../editor/browser/editorExtensions.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { BaseHalfGenerationPromptEditor, IBaseHalfPromptEditorOptions } from '../../browser/basehalfGenerationPromptEditor.js';

/** Two images and a video are connected: a.png has a picture, b.png has none yet; anything else is a file that is not connected. */
const CHIPS: IBaseHalfPromptEditorOptions['chipOf'] = mention => {
	switch (mention.path) {
		case 'a.png': return { kind: 'image', label: 'a.png', picture: 'data:image/png;base64,iVBORw0KGgo=', known: true };
		case 'b.png': return { kind: 'image', label: 'b.png', known: true };
		case 'v.mp4': return { kind: 'video', label: 'v.mp4', known: true };
		default: return { kind: 'image', label: mention.path, known: false };
	}
};

/** What the field draws: text, chips by the names they show, those of files that are not connected, and the holder of an empty last line. */
function drawn(editor: BaseHalfGenerationPromptEditor): string[] {
	return [...editor.element.childNodes].map(node => {
		if (node.nodeType === node.TEXT_NODE) {
			return node.textContent === '​' ? 'caret holder' : `text ${node.textContent}`;
		}
		const element = node as HTMLElement;
		if (element.classList.contains('bh-prompt-chip')) {
			return `${element.classList.contains('unknown') ? 'unknown' : 'chip'} ${element.querySelector('.bh-prompt-chip-name')?.textContent}${element.querySelector('img') ? ' with picture' : ''}`;
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

suite('BaseHalfGenerationPromptEditor (D68, D74)', () => {
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

	test('shows each mention as a chip with its file\'s name, one of a file that is not connected with a warning, and reads back the same text', () => {
		const editor = create({ maxLength: 128 });
		editor.setValue('@[a.png]骑车经过@[v.mp4]，@[b.png] and @[shots/z.png] or 图片1\n');
		assert.deepStrictEqual({ drawn: drawn(editor), value: editor.value }, {
			drawn: ['chip a.png with picture', 'text 骑车经过', 'chip v.mp4', 'text ，', 'chip b.png', 'text  and ', 'unknown shots/z.png', 'text  or 图片1\n', 'br'],
			value: '@[a.png]骑车经过@[v.mp4]，@[b.png] and @[shots/z.png] or 图片1\n'
		});
	});

	test('a mention typed by hand turns into a chip once its ] is typed', () => {
		const editor = create();
		editor.setValue('骑车');
		editor.focus();
		let changes = 0;
		disposables.add(editor.onDidChange(() => changes++));
		type(editor, '@[a.png');
		const open = drawn(editor);
		type(editor, ']');
		// Drawn again with the chip, the caret stays at the end of what was typed.
		assert.deepStrictEqual({ open, typed: drawn(editor), caret: editor.selection(), value: editor.value, changes }, {
			open: ['text 骑车@[a.png'],
			typed: ['text 骑车', 'chip a.png with picture', 'caret holder'],
			caret: { start: 10, end: 10 },
			value: '骑车@[a.png]',
			changes: 2
		});
	});

	test('nothing turns into a chip while an input method composes', () => {
		const editor = create();
		editor.setValue('');
		editor.focus();
		editor.element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		editor.element.append(mainWindow.document.createTextNode('@[a.png]'));
		editor.element.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', isComposing: true, bubbles: true }));
		const composing = { drawn: drawn(editor), value: editor.value, composing: editor.composing };
		editor.element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
		assert.deepStrictEqual({ composing, ended: drawn(editor), value: editor.value }, {
			composing: { drawn: ['text @[a.png]'], value: '', composing: true },
			ended: ['chip a.png with picture', 'caret holder'],
			value: '@[a.png]'
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
		const editor = create({ maxLength: 22 });
		editor.setValue('@[a.png] ');
		editor.focus();
		const data = new DataTransfer();
		data.setData('text/plain', 'and @[v.mp4]\r\nrides on and on');
		data.setData('text/html', '<b>bold</b>');
		const paste = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
		editor.element.dispatchEvent(paste);
		assert.deepStrictEqual({ prevented: paste.defaultPrevented, value: editor.value, drawn: drawn(editor) }, {
			prevented: true,
			value: '@[a.png] and @[v.mp4]\n',
			drawn: ['chip a.png with picture', 'text  and ', 'chip v.mp4', 'caret holder', 'text \n', 'br']
		});
	});

	test('copy and cut take the selection as text, chips as their mentions', () => {
		const editor = create();
		editor.setValue('从@[a.png]到@[b.png]');
		editor.focus();
		editor.setSelection({ start: 1, end: 18 });
		const copied = new DataTransfer();
		editor.element.dispatchEvent(new ClipboardEvent('copy', { clipboardData: copied, bubbles: true, cancelable: true }));
		const cut = new DataTransfer();
		editor.setSelection({ start: 0, end: 9 });
		editor.element.dispatchEvent(new ClipboardEvent('cut', { clipboardData: cut, bubbles: true, cancelable: true }));
		assert.deepStrictEqual({ copied: copied.getData('text/plain'), cut: cut.getData('text/plain'), value: editor.value }, {
			copied: '@[a.png]到@[b.png]',
			cut: '从@[a.png]',
			value: '到@[b.png]'
		});
	});

	test('the caret steps over a chip: a place inside it is the place after it', () => {
		const editor = create();
		editor.setValue('a@[a.png]b');
		editor.focus();
		editor.setSelection({ start: 4, end: 4 });
		const inside = editor.selection();
		editor.setSelection({ start: 1, end: 9 });
		assert.deepStrictEqual({ inside, around: editor.selection() }, { inside: { start: 9, end: 9 }, around: { start: 1, end: 9 } });
	});

	test('text typed after a chip at the end takes the place of the caret holder, and the caret goes to each place of the text', () => {
		const editor = create();
		editor.setValue('ride @[a.png]');
		editor.focus();
		type(editor, ' @');
		const typed = drawn(editor);
		const places: number[] = [];
		for (let offset = 0; offset <= editor.value.length; offset++) {
			editor.focus(offset);
			places.push(editor.selection()!.start);
		}
		assert.deepStrictEqual({ typed, places }, {
			typed: ['text ride ', 'chip a.png with picture', 'text  @'],
			places: [0, 1, 2, 3, 4, 5, 13, 13, 13, 13, 13, 13, 13, 13, 14, 15]
		});
	});

	test('a caret holder the browser takes out is drawn again, and the text has not changed', () => {
		const editor = create();
		editor.setValue('ride @[a.png]');
		editor.focus();
		let changes = 0;
		disposables.add(editor.onDidChange(() => changes++));
		editor.element.lastChild!.remove();
		editor.element.dispatchEvent(new InputEvent('input', { inputType: 'deleteContentForward', bubbles: true }));
		assert.deepStrictEqual({ drawn: drawn(editor), value: editor.value, changes, undone: editor.undo() }, {
			drawn: ['text ride ', 'chip a.png with picture', 'caret holder'],
			value: 'ride @[a.png]',
			changes: 0,
			undone: false
		});
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
		editor.replace(0, 0, '@[a.png] ');
		const steps: string[] = [editor.value];
		while (editor.undo()) {
			steps.push(editor.value);
		}
		editor.redo();
		const redone = editor.value;
		editor.setValue('from the file');
		assert.deepStrictEqual({ steps, redone, canUndo: editor.undo() }, {
			steps: ['@[a.png] 骑车abc', '骑车abc', '骑车ab', '骑车'],
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

	test('Select All selects the whole prompt, not the text of another editor', () => {
		const editor = create();
		editor.setValue('ride @[a.png]\nnext');
		editor.focus(2);
		const services = disposables.add(new TestInstantiationService());
		services.set(ILogService, new NullLogService());
		services.set(IContextKeyService, new MockContextKeyService());
		services.invokeFunction(accessor => SelectAllCommand.runCommand(accessor, undefined));
		assert.deepStrictEqual(editor.selection(), { start: 0, end: 18 });
	});

	test('a prompt that is read only can be selected but not changed, and its mentions are still chips', () => {
		const editor = create();
		editor.setValue('@[a.png] at dawn');
		editor.readOnly = true;
		editor.replace(0, 0, 'no ');
		const paste = new DataTransfer();
		paste.setData('text/plain', 'no');
		editor.element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: paste, bubbles: true, cancelable: true }));
		assert.deepStrictEqual({ editable: editor.element.contentEditable, value: editor.value, drawn: drawn(editor) }, {
			editable: 'false',
			value: '@[a.png] at dawn',
			drawn: ['chip a.png with picture', 'text  at dawn']
		});
	});

	test('Backspace after a chip and Delete before one take out the whole mention, also at the end of the text', () => {
		const editor = create();
		editor.setValue('骑着@[a.png]');
		editor.focus();
		const backspace = new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true });
		editor.element.dispatchEvent(backspace);
		const afterBackspace = { value: editor.value, caret: editor.selection(), prevented: backspace.defaultPrevented };
		editor.setValue('@[a.png]和@[v.mp4]');
		editor.focus(0);
		editor.element.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentForward', bubbles: true, cancelable: true }));
		const afterDelete = editor.value;
		editor.undo();
		assert.deepStrictEqual({ afterBackspace, afterDelete, undone: editor.value }, {
			afterBackspace: { value: '骑着', caret: { start: 2, end: 2 }, prevented: true },
			afterDelete: '和@[v.mp4]',
			undone: '@[a.png]和@[v.mp4]'
		});
	});

	test('Delete with the caret before the holder after a chip at the end of a line joins the next line in one press', () => {
		const editor = create();
		editor.setValue('ride @[a.png]\nnext');
		editor.focus();
		const holder = [...editor.element.childNodes].find(node => node.textContent === '\u200b')!;
		mainWindow.getSelection()!.collapse(holder, 0);
		const press = new InputEvent('beforeinput', { inputType: 'deleteContentForward', bubbles: true, cancelable: true, targetRanges: [new StaticRange({ startContainer: holder, startOffset: 0, endContainer: holder, endOffset: 1 })] });
		editor.element.dispatchEvent(press);
		assert.deepStrictEqual({ prevented: press.defaultPrevented, value: editor.value, caret: editor.selection(), drawn: drawn(editor) }, {
			prevented: true,
			value: 'ride @[a.png]next',
			caret: { start: 13, end: 13 },
			drawn: ['text ride ', 'chip a.png with picture', 'text next']
		});
	});

	test('a delete of a word that reaches into a chip takes out the whole chip; one that does not is left to the browser', () => {
		const editor = create();
		editor.setValue('ride @[a.png] now');
		editor.focus();
		const first = editor.element.firstChild!;
		const plain = new InputEvent('beforeinput', { inputType: 'deleteWordBackward', bubbles: true, cancelable: true, targetRanges: [new StaticRange({ startContainer: first, startOffset: 0, endContainer: first, endOffset: 4 })] });
		editor.element.dispatchEvent(plain);
		const plainValue = editor.value;
		const last = editor.element.lastChild!;
		const reaching = new InputEvent('beforeinput', { inputType: 'deleteWordBackward', bubbles: true, cancelable: true, targetRanges: [new StaticRange({ startContainer: editor.element, startOffset: 1, endContainer: last, endOffset: 1 })] });
		editor.element.dispatchEvent(reaching);
		assert.deepStrictEqual({ plain: plain.defaultPrevented, plainValue, reaching: reaching.defaultPrevented, value: editor.value }, {
			plain: false,
			plainValue: 'ride @[a.png] now',
			reaching: true,
			value: 'ride now'
		});
	});

	test('a line break the browser leaves as a placeholder holds no text', () => {
		const editor = create();
		editor.setValue('@[a.png] at dawn');
		editor.focus();
		editor.element.append(mainWindow.document.createElement('br'));
		editor.element.dispatchEvent(new InputEvent('input', { inputType: 'deleteContentBackward', bubbles: true }));
		assert.deepStrictEqual({ value: editor.value, drawn: drawn(editor) }, { value: '@[a.png] at dawn', drawn: ['chip a.png with picture', 'text  at dawn'] });
	});

	test('a chip drawn again keeps its picture, so it does not blink', () => {
		const editor = create();
		editor.setValue('@[a.png] and @[b.png]');
		const before = editor.element.querySelector('img.bh-prompt-chip-picture');
		editor.refreshChips();
		editor.replace(0, 0, 'Look: ');
		assert.deepStrictEqual([before !== null, editor.element.querySelector('img.bh-prompt-chip-picture') === before, editor.value], [true, true, 'Look: @[a.png] and @[b.png]']);
	});

	test('a chip at the start of a line begins where the text does; one after text keeps its space', () => {
		const editor = create();
		editor.setValue('@[a.png] rides\n@[b.png] and @[a.png]');
		const chips = [...editor.element.querySelectorAll<HTMLElement>('.bh-prompt-chip')].map(chip => `${chip.dataset.text} ${chip.classList.contains('starts-line')}`);
		editor.replace(0, 0, 'Look: ');
		const after = [...editor.element.querySelectorAll<HTMLElement>('.bh-prompt-chip')].map(chip => `${chip.dataset.text} ${chip.classList.contains('starts-line')}`);
		assert.deepStrictEqual({ chips, after }, {
			chips: ['@[a.png] true', '@[b.png] true', '@[a.png] false'],
			after: ['@[a.png] false', '@[b.png] true', '@[a.png] false']
		});
	});

	test('replace puts a mention in place of what was typed and the caret after it', () => {
		const editor = create();
		editor.setValue('look at @');
		editor.focus();
		editor.replace(8, 9, '@[v.mp4] ');
		assert.deepStrictEqual({ value: editor.value, caret: editor.selection(), drawn: drawn(editor) }, {
			value: 'look at @[v.mp4] ',
			caret: { start: 17, end: 17 },
			drawn: ['text look at ', 'chip v.mp4', 'text  ']
		});
	});
});
