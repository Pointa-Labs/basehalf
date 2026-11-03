/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The page of Rich's bundle test (test.markdownRichFormats.mts). It builds the
// editor of a note as Card Detail builds it: the note's schema, collaboration
// over Yjs, Rich's undo, and the load and the save through the projection.
// The parts of the test are plain functions at the end of this file; the
// runner calls each by name, on an editor of its own.

import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import '../markdown-rich-src/editor.css';

import { BlockNoteEditor, type ExtensionFactoryInstance } from '@blocknote/core';
import { en } from '@blocknote/core/locales';
import { BlockNoteView } from '@blocknote/mantine';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ySyncPluginKey, yUndoPluginKey } from 'y-prosemirror';
import { Doc as YDoc, type UndoManager, type XmlFragment } from 'yjs';
import {
	BASEHALF_RAW_PASSTHROUGH_BLOCK,
	buildBaseHalfMarkdownLoadProjection,
	createBaseHalfMarkdownNote,
	spliceBaseHalfMarkdownSave,
	splitBaseHalfMarkdownFrontmatter,
	type IBaseHalfMarkdownEditorApi,
	type IBaseHalfMarkdownNote,
	type IBaseHalfMarkdownReuseEntry,
} from '../../../src/vs/workbench/basehalf/markdown/common/basehalfMarkdownProjection.js';
import { joinBaseHalfMarkdownRichFrontmatter } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfMarkdownRichSession.js';
import { makeBaseHalfAdhdDecorationExtension } from '../markdown-rich-src/adhdDecorations.js';
import { createBaseHalfNoteEditorApi } from '../markdown-rich-src/noteConversions.js';
import { installBaseHalfNoteCopy } from '../markdown-rich-src/noteCopy.js';
import { addBaseHalfNoteMediaFile, installBaseHalfNoteResizeUnderZoom } from '../markdown-rich-src/noteMedia.js';
import { baseHalfNotePasteHandler, installBaseHalfNotePaste } from '../markdown-rich-src/notePaste.js';
import { makeBaseHalfNoteShapeExtension } from '../markdown-rich-src/noteShape.js';
import { baseHalfNoteSchema, renderedNote } from '../markdown-rich-src/noteSchema.js';
import { baseHalfNoteToggleState, installBaseHalfNoteToggleState } from '../markdown-rich-src/noteToggleState.js';
import { createBaseHalfNoteUndo, type IBaseHalfNoteUndo } from '../markdown-rich-src/noteUndo.js';
import { makeBaseHalfSelectionRevealExtension } from '../markdown-rich-src/selectionRevealDecorations.js';

/**
 * How the test runs Rich: `basehalf`, as BaseHalf builds Rich, or `baseline`
 * (BASEHALF_FORMATS_BASELINE=1), with BlockNote's own reader and writer and
 * none of D110's extensions, as Rich ran before D110, so that a part shows
 * what it catches in the editor before D110.
 */
export type NoteFormatsMode = 'basehalf' | 'baseline';

/**
 * The copy of a file put into a note, as the host makes it: under
 * `attachments/`. A name that starts with `fail` cannot be copied, and one
 * that starts with `slow` takes 300 ms.
 */
async function uploadTestFile(file: File): Promise<string> {
	if (file.name.startsWith('slow')) {
		await new Promise(resolve => setTimeout(resolve, 300));
	}
	if (file.name.startsWith('fail')) {
		throw new Error(`${file.name} cannot be copied.`);
	}
	return `attachments/${encodeURIComponent(file.name)}`;
}

/** The folder of the note the test opens. Nothing is served there, so a picture of a note loads nothing. */
const NOTE_FOLDER = `${location.origin}/notes/`;

/** The editor of a note, as Card Detail creates it (useCreateBlockNote in editor.tsx). */
function createNoteEditor(fragment: XmlFragment, extensions: readonly ExtensionFactoryInstance[], uploadFile: (file: File) => Promise<string>, pasteHandler?: typeof baseHalfNotePasteHandler) {
	return BlockNoteEditor.create({
		schema: baseHalfNoteSchema,
		dictionary: en,
		uploadFile,
		...(pasteHandler ? { pasteHandler } : {}),
		resolveFileUrl: async url => !url || /^(?:[a-z][a-z0-9+.-]*:|#)/i.test(url) ? url : new URL(url, NOTE_FOLDER).toString(),
		extensions: [makeBaseHalfAdhdDecorationExtension(), makeBaseHalfSelectionRevealExtension(), ...extensions],
		collaboration: {
			fragment,
			user: { name: 'BaseHalf', color: 'var(--vscode-textLink-foreground)' },
		},
	});
}

type NoteEditor = ReturnType<typeof createNoteEditor>;

/** BlockNote's view of a note's blocks: createElement cannot infer the schema of the generic view itself. */
const NoteView = BlockNoteView<typeof baseHalfNoteSchema.blockSchema, typeof baseHalfNoteSchema.inlineContentSchema, typeof baseHalfNoteSchema.styleSchema>;

/** BlockNote's own reader and writer, as Rich read and wrote a note before D110, under the projection of D110. */
function blockNoteEditorApi(editor: NoteEditor): IBaseHalfMarkdownEditorApi {
	const decoder = document.createElement('textarea');
	return {
		tryParseMarkdownToBlocks: markdown => editor.tryParseMarkdownToBlocks(markdown),
		writeBlock: block => editor.blocksToMarkdownLossy([block] as Parameters<typeof editor.blocksToMarkdownLossy>[0]).trimEnd(),
		decodeCharacterReferences: text => {
			decoder.innerHTML = text.replace(/</g, '&lt;');
			return decoder.value;
		},
	};
}

interface INoteFormatsModeSetup {
	/** The reader and the writer of a note's blocks. */
	readonly editorApi: (editor: NoteEditor) => IBaseHalfMarkdownEditorApi;
	/** Extensions of the editor besides those Rich has always had, made for each editor. */
	readonly extensions: () => readonly ExtensionFactoryInstance[];
	/** Rich's paste, as editor.tsx installs it (notePaste.ts), or the editor's own. */
	readonly paste?: { readonly handler: typeof baseHalfNotePasteHandler; install(editor: NoteEditor, api: IBaseHalfMarkdownEditorApi): void };
	/** Rich's copy, as editor.tsx installs it (noteCopy.ts): what removes it. */
	readonly copy?: (editor: NoteEditor) => () => void;
}

/**
 * What each mode runs. BaseHalf's mode takes D110's reader and writer
 * (noteConversions.ts) and, when they land, its extensions (noteShape.ts,
 * noteToggleState.ts); the baseline keeps BlockNote's and none.
 */
/** The addresses of the links that the note's keys opened, in order. */
const openedLinks: string[] = [];

/** Rich's undo of the note open now, and whether a load reads it: the shape extension asks for them as editor.tsx's does. */
const openNow: { history?: IBaseHalfNoteUndo; reading: boolean } = { reading: false };

const MODES: Record<NoteFormatsMode, INoteFormatsModeSetup> = {
	basehalf: {
		editorApi: editor => createBaseHalfNoteEditorApi(editor),
		extensions: () => [makeBaseHalfNoteShapeExtension({
			openLink: href => openedLinks.push(href),
			undoManager: () => openNow.history?.ensure(),
			reading: () => openNow.reading,
		})],
		paste: { handler: baseHalfNotePasteHandler, install: (editor, api) => installBaseHalfNotePaste(editor, api) },
		copy: editor => installBaseHalfNoteCopy(editor, document.body),
	},
	baseline: { editorApi: blockNoteEditorApi, extensions: () => [] },
};

/** A block in short, for a check: its type, its text, and its children. */
export interface IShortBlock {
	readonly type: string;
	readonly text?: string;
	readonly children?: readonly IShortBlock[];
}

/** One step of real input, which the runner gives the page with the browser's own events (page.exposeFunction). */
interface IInputStep {
	readonly device: 'keyboard' | 'mouse';
	readonly method: string;
	readonly args: readonly unknown[];
}

function input(step: IInputStep): Promise<void> {
	return (globalThis as unknown as { baseHalfFormatsInput(step: IInputStep): Promise<void> }).baseHalfFormatsInput(step);
}

/** What a part works with: a note open in a fresh editor, and the means to load, save, type, and check. */
export interface INoteFormatsTest {
	readonly mode: NoteFormatsMode;
	readonly editor: NoteEditor;
	/** The shared document of the note, as the host's replica holds it. */
	readonly fragment: XmlFragment;
	/** Rich's undo (noteUndo.ts). */
	readonly history: IBaseHalfNoteUndo;
	/** The reader and the writer of this mode. */
	readonly api: IBaseHalfMarkdownEditorApi;
	/** Whether the editor's view was made anew when it became editable, as Card Detail's is after the first load. */
	readonly mountedAgain: boolean;
	/** Loads a note as Card Detail loads it into an open editor: the projection, the blocks replaced, and no step of undo. */
	load(content: string): Promise<void>;
	/** The note as Rich would write it now. */
	save(): Promise<string>;
	/** Runs Undo or Redo as Card Detail's command (and Mod+Z) runs it. */
	command(command: 'undo' | 'redo'): boolean;
	/** The document in short. */
	blocks(): IShortBlock[];
	/**
	 * Puts the caret at the start or the end of the first text that matches,
	 * or of the block at that index of the note, and gives the editor the
	 * keyboard.
	 */
	caret(target: string | number, edge?: 'start' | 'end'): void;
	readonly keyboard: {
		type(text: string): Promise<void>;
		press(key: string): Promise<void>;
		down(key: string): Promise<void>;
		up(key: string): Promise<void>;
	};
	readonly mouse: {
		click(x: number, y: number): Promise<void>;
		move(x: number, y: number, steps?: number): Promise<void>;
		down(): Promise<void>;
		up(): Promise<void>;
	};
	/** Waits for frames of the page: what a key or a click changes is drawn by then. */
	frames(count?: number): Promise<void>;
	/** Records a check: the runner asserts that `actual` deep-equals `expected`. */
	check(name: string, actual: unknown, expected: unknown): void;
	/** Records a value to print, such as a time. */
	log(name: string, value: unknown): void;
}

export interface INoteFormatsPartResult {
	readonly checks: { readonly name: string; readonly actual: unknown; readonly expected: unknown }[];
	readonly logs: { readonly name: string; readonly value: unknown }[];
	error?: string;
	milliseconds: number;
}

function nextFrame(): Promise<void> {
	return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function until(what: string, condition: () => boolean, timeout = 5000): Promise<void> {
	const end = performance.now() + timeout;
	while (!condition()) {
		if (performance.now() > end) {
			throw new Error(`Timed out waiting until ${what}.`);
		}
		await nextFrame();
	}
}

/** The editor's view once it is in the page and Yjs is bound to it; before its mount the editor has only a stand-in. */
function mountedView(editor: NoteEditor): EditorView | undefined {
	try {
		const view = editor.prosemirrorView;
		const sync = ySyncPluginKey.getState(view.state) as { binding?: { prosemirrorView?: unknown } } | undefined;
		return view.dom.isConnected && sync?.binding?.prosemirrorView === view ? view : undefined;
	} catch {
		return undefined;
	}
}

function inlineText(content: readonly unknown[]): string {
	return content.map(item => {
		const { text, content: inner } = item as { readonly text?: unknown; readonly content?: unknown };
		return typeof text === 'string' ? text : Array.isArray(inner) ? inlineText(inner) : '';
	}).join('');
}

function shortBlocks(blocks: readonly unknown[]): IShortBlock[] {
	return blocks.map(block => {
		const { type, content, children } = block as { readonly type: string; readonly content?: unknown; readonly children?: readonly unknown[] };
		return {
			type,
			...(Array.isArray(content) ? { text: inlineText(content) } : {}),
			...(children && children.length > 0 ? { children: shortBlocks(children) } : {}),
		};
	});
}

interface IOpenNote {
	readonly test: INoteFormatsTest;
	dispose(): void;
}

/**
 * Opens a note as Card Detail does: the editor is mounted read-only, the host's
 * first payload is loaded, and the editor is mounted again, editable. That
 * second mount tears the plugin views down and builds them again, which is
 * what Rich's undo has to outlive.
 */
async function openNote(mode: NoteFormatsMode, result: INoteFormatsPartResult): Promise<IOpenNote> {
	const setup = MODES[mode];
	const ydoc = new YDoc();
	// The fragment name of editor.tsx (BLOCKNOTE_FRAGMENT_NAME).
	const fragment = ydoc.getXmlFragment('bn');
	const editor = createNoteEditor(fragment, setup.extensions(), uploadTestFile, setup.paste?.handler);
	const api = setup.editorApi(editor);
	setup.paste?.install(editor, api);
	const offCopy = setup.copy?.(editor);
	const history = createBaseHalfNoteUndo(editor);
	openNow.history = history;
	// As editor.tsx's change listener, which keeps the undo manager live first.
	const offChange = editor.onChange(() => {
		history.ensure();
	});
	const note: { frontmatter: string; byId: ReadonlyMap<string, IBaseHalfMarkdownReuseEntry>; note: IBaseHalfMarkdownNote } = { frontmatter: '', byId: new Map(), note: createBaseHalfMarkdownNote('') };
	renderedNote.baseUri = NOTE_FOLDER;

	// The page of Card Detail's webview, as editor.tsx lays it out.
	const shell = document.createElement('div');
	shell.className = 'basehalf-markdown-rich surface-detail';
	const portal = document.createElement('div');
	portal.className = 'basehalf-markdown-rich-portal bn-root bn-mantine';
	const scroll = document.createElement('div');
	scroll.className = 'basehalf-markdown-rich-scroll';
	const page = document.createElement('div');
	page.className = 'basehalf-markdown-rich-page';
	scroll.append(page);
	shell.append(portal, scroll);
	document.getElementById('root')?.append(shell);
	const root = createRoot(page);
	const portalElements = {
		formattingToolbar: portal,
		linkToolbar: portal,
		slashMenu: portal,
		emojiPicker: portal,
		sideMenu: portal,
		filePanel: portal,
		tableHandles: portal,
		comments: portal,
	};
	// The toolbar of a selection, the side menu, and the menu of `[[` are
	// BaseHalf's own controllers in editor.tsx; they join the page when
	// noteToolbars.tsx holds them.
	const render = (editable: boolean) => root.render(createElement(NoteView, {
		editor,
		editable,
		sideMenu: false,
		formattingToolbar: false,
		linkToolbar: true,
		slashMenu: true,
		filePanel: true,
		tableHandles: true,
		emojiPicker: true,
		comments: true,
		portalElements,
	}));

	let mountedAgain = false;
	const test: INoteFormatsTest = {
		mode,
		editor,
		fragment,
		history,
		api,
		get mountedAgain() {
			return mountedAgain;
		},
		load: async content => {
			// As applyContent in editor.tsx loads a note into an editor that is ready.
			const { frontmatter, body } = splitBaseHalfMarkdownFrontmatter(content);
			const { blocks, byId, note: projected } = await buildBaseHalfMarkdownLoadProjection(api, body, content);
			const view = editor.prosemirrorView;
			openNow.reading = true;
			try {
				view.dispatch(view.state.tr.setSelection(TextSelection.atStart(view.state.doc)));
				history.discardSelectionForNextSharedTransaction();
				baseHalfNoteToggleState.initiallyOpen = projected.open;
				baseHalfNoteToggleState.folds.clear();
				editor.replaceBlocks(editor.document, blocks as Parameters<typeof editor.replaceBlocks>[1]);
			} finally {
				openNow.reading = false;
			}
			(history.ensure() ?? history.current)?.clear();
			note.frontmatter = frontmatter;
			note.byId = byId;
			note.note = projected;
		},
		// As serializeAndRequestSave in editor.tsx: the body from the blocks, under the note's front matter.
		save: async () => joinBaseHalfMarkdownRichFrontmatter(note.frontmatter, await spliceBaseHalfMarkdownSave(api, editor.document, '', note.byId, note.note)),
		command: command => {
			// As executeEditorCommand in editor.tsx.
			history.ensure();
			editor.focus();
			return command === 'undo' ? history.undo() : history.redo();
		},
		blocks: () => shortBlocks(editor.document),
		caret: (target, edge = 'end') => {
			if (typeof target === 'number') {
				editor.setTextCursorPosition(editor.document[target], edge);
			} else {
				const view = editor.prosemirrorView;
				let at: number | undefined;
				view.state.doc.descendants((node, position) => {
					const offset = at === undefined && node.isText ? (node.text ?? '').indexOf(target) : -1;
					if (offset >= 0) {
						at = position + offset + (edge === 'end' ? target.length : 0);
					}
					return at === undefined;
				});
				if (at === undefined) {
					throw new Error(`The note has no text "${target}".`);
				}
				view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
			}
			editor.focus();
		},
		keyboard: {
			type: text => input({ device: 'keyboard', method: 'type', args: [text] }),
			press: key => input({ device: 'keyboard', method: 'press', args: [key] }),
			down: key => input({ device: 'keyboard', method: 'down', args: [key] }),
			up: key => input({ device: 'keyboard', method: 'up', args: [key] }),
		},
		mouse: {
			click: (x, y) => input({ device: 'mouse', method: 'click', args: [x, y] }),
			move: (x, y, steps = 1) => input({ device: 'mouse', method: 'move', args: [x, y, { steps }] }),
			down: () => input({ device: 'mouse', method: 'down', args: [] }),
			up: () => input({ device: 'mouse', method: 'up', args: [] }),
		},
		frames: async (count = 2) => {
			for (let frame = 0; frame < count; frame++) {
				await nextFrame();
			}
		},
		check: (name, actual, expected) => {
			result.checks.push({ name, actual, expected });
		},
		log: (name, value) => {
			result.logs.push({ name, value });
		},
	};
	const dispose = () => {
		offCopy?.();
		offChange();
		root.unmount();
		ydoc.destroy();
		shell.remove();
	};

	try {
		render(false);
		await until('the editor is in the page', () => mountedView(editor) !== undefined);
		const first = mountedView(editor);
		await test.load('');
		shell.classList.add('ready');
		render(true);
		await until('the editor is in the page again, editable', () => {
			const view = mountedView(editor);
			return view !== undefined && view !== first && editor.isEditable;
		});
		mountedAgain = true;
		return { test, dispose };
	} catch (error) {
		dispose();
		throw error;
	}
}

/**
 * Part 0, the test bed itself: the editor is mounted as Card Detail mounts it,
 * with collaboration and Rich's undo; text typed with real keys is one step
 * of undo; a load is no step of undo (exact undo, rule 80 of note formats);
 * and the editor's blocks are those of the note's own schema.
 */
async function testBed(t: INoteFormatsTest): Promise<void> {
	const view = t.editor.prosemirrorView;
	const sync = ySyncPluginKey.getState(view.state) as { type?: unknown; binding?: { prosemirrorView?: unknown } } | undefined;
	const undoPlugin = yUndoPluginKey.getState(view.state) as { undoManager?: UndoManager } | undefined;
	const steps = () => ({ undo: t.history.current?.undoStack.length, redo: t.history.current?.redoStack.length });
	const shared = (text: string) => t.fragment.toString().includes(text);
	t.check('the editor is mounted again, editable, after the first load, with collaboration and Rich\'s undo', {
		mountedAgain: t.mountedAgain,
		editable: t.editor.isEditable,
		syncsTheSharedDocument: sync?.type === t.fragment,
		bindsThisView: sync?.binding?.prosemirrorView === view,
		undoPluginHoldsRichsManager: undoPlugin?.undoManager !== undefined && undoPlugin.undoManager === t.history.current,
		undoTracksTheSharedDocument: t.history.current?.scope.includes(t.fragment),
		steps: steps(),
		blocks: t.blocks(),
	}, {
		mountedAgain: true,
		editable: true,
		syncsTheSharedDocument: true,
		bindsThisView: true,
		undoPluginHoldsRichsManager: true,
		undoTracksTheSharedDocument: true,
		steps: { undo: 0, redo: 0 },
		blocks: [{ type: 'paragraph', text: '' }],
	});

	const empty = await t.save();
	t.caret(0);
	const focused = document.activeElement === t.editor.domElement;
	await t.keyboard.type('abc');
	await t.frames();
	t.check('abc typed with real keys is in the editor and the shared document, as one step of undo', {
		focused,
		blocks: t.blocks(),
		shared: shared('abc'),
		steps: steps(),
		saved: await t.save() !== empty,
	}, {
		focused: true,
		blocks: [{ type: 'paragraph', text: 'abc' }],
		shared: true,
		steps: { undo: 1, redo: 0 },
		saved: true,
	});

	const undone = t.command('undo');
	await t.frames();
	t.check('one undo leaves the note empty', {
		undone,
		blocks: t.blocks(),
		shared: shared('abc'),
		steps: steps(),
		saved: await t.save() === empty,
	}, {
		undone: true,
		blocks: [{ type: 'paragraph', text: '' }],
		shared: false,
		steps: { undo: 0, redo: 1 },
		saved: true,
	});

	const redone = t.command('redo');
	await t.frames();
	t.check('redo brings abc back', { redone, blocks: t.blocks(), steps: steps() }, {
		redone: true,
		blocks: [{ type: 'paragraph', text: 'abc' }],
		steps: { undo: 1, redo: 0 },
	});

	const note = '# Title\n\nFirst paragraph.\n';
	await t.load(note);
	await t.frames();
	const loaded = t.blocks();
	t.check('a load replaces the blocks, is no step of undo, and saves the file as it was', {
		blocks: loaded,
		steps: steps(),
		saved: await t.save(),
	}, {
		blocks: [{ type: 'heading', text: 'Title' }, { type: 'paragraph', text: 'First paragraph.' }],
		steps: { undo: 0, redo: 0 },
		saved: note,
	});

	t.caret('First paragraph.');
	await t.keyboard.type('xyz');
	await t.frames();
	const edited = await t.save();
	const undoneEdit = t.command('undo');
	await t.frames();
	const afterEditUndone = { blocks: t.blocks(), saved: await t.save() };
	const undoneLoad = t.command('undo');
	await t.frames();
	t.check('undo takes back a typed edit and stops at the load', {
		edited,
		undoneEdit,
		afterEditUndone,
		undoneLoad,
		afterLoadUndo: { blocks: t.blocks(), saved: await t.save() },
	}, {
		edited: '# Title\n\nFirst paragraph.xyz\n',
		undoneEdit: true,
		afterEditUndone: { blocks: loaded, saved: note },
		undoneLoad: false,
		afterLoadUndo: { blocks: loaded, saved: note },
	});

	// The editor is built from the note's own schema (noteSchema.ts): Markdown
	// that Rich cannot edit is a fixed block, drawn as the card draws it, with
	// a relative picture read from the note's folder (renderedNote).
	const fixedNote = '# Fixed\n\n<div><img src="pic.png" alt="pic"> Kept as written</div>\n\nAfter.\n';
	await t.load(fixedNote);
	await t.frames();
	const fixed = t.editor.domElement?.querySelector('[data-basehalf-raw-passthrough=""]');
	t.check('Markdown Rich cannot edit is a fixed block of the note\'s schema, drawn as on the card, and saved as it was', {
		blocks: t.blocks(),
		drawn: fixed?.querySelector('.basehalf-raw-passthrough-rendered')?.textContent?.trim(),
		picture: fixed?.querySelector('.basehalf-raw-passthrough-rendered img')?.getAttribute('src'),
		editInSource: fixed?.querySelector('button.basehalf-raw-passthrough-edit')?.textContent,
		saved: await t.save(),
	}, {
		blocks: [{ type: 'heading', text: 'Fixed' }, { type: BASEHALF_RAW_PASSTHROUGH_BLOCK }, { type: 'paragraph', text: 'After.' }],
		drawn: 'Kept as written',
		picture: new URL('pic.png', NOTE_FOLDER).toString(),
		editInSource: 'Edit in source',
		saved: fixedNote,
	});
}

/**
 * Part e, keys (note formats, rules 45, 61, 63, 70, and 71), with real key
 * presses: Tab and Shift-Tab nest only where a block may hold another and
 * keep the keyboard in the note; Tab moves through a table and adds a row at
 * its end; Enter in a toggle's title keeps its blocks; Mod-Enter folds a
 * toggle, checks a check item, and opens a link (rule 54); letters typed
 * after Command-→ at a line before a fixed block go into that line; and a
 * key that arrives on a busy page acts at the caret the page shows.
 */
async function keys(t: INoteFormatsTest): Promise<void> {
	const focused = () => document.activeElement === t.editor.domElement;
	await t.load('First paragraph.\n\nSecond paragraph.\n\n- one\n- two\n');
	await t.frames();
	t.caret('Second paragraph.');
	await t.keyboard.press('Tab');
	await t.frames();
	const paragraphTab = { saved: await t.save(), focused: focused() };
	t.caret('two');
	await t.keyboard.press('Tab');
	await t.frames();
	const bulletTab = await t.save();
	await t.keyboard.press('Shift+Tab');
	await t.frames();
	t.caret('First paragraph.');
	await t.keyboard.press('Shift+Tab');
	await t.frames();
	t.check('Tab nests a block only under one that may hold it, Shift-Tab takes it out, and the keyboard stays in the note', {
		paragraphTab,
		bulletTab,
		afterShiftTab: await t.save(),
		focusedAtTheTop: focused(),
	}, {
		paragraphTab: { saved: 'First paragraph.\n\nSecond paragraph.\n\n- one\n- two\n', focused: true },
		bulletTab: 'First paragraph.\n\nSecond paragraph.\n\n- one\n  - two\n',
		afterShiftTab: 'First paragraph.\n\nSecond paragraph.\n\n- one\n- two\n',
		focusedAtTheTop: true,
	});

	await t.load('| A   | B   |\n| --- | --- |\n| a   | b   |\n');
	await t.frames();
	t.caret('b');
	await t.keyboard.press('Tab');
	await t.keyboard.type('c');
	await t.frames();
	t.check('Tab in the last cell of a table adds a row and moves into it', { blocks: t.blocks().map(block => block.type), saved: await t.save() }, {
		blocks: ['table'],
		saved: '| A   | B   |\n| --- | --- |\n| a   | b   |\n| c   |     |\n',
	});

	const toggles = '<details open>\n<summary>Open</summary>\n\ninside\n\n</details>\n\n<details>\n<summary>Closed</summary>\n\nhidden\n\n</details>\n';
	await t.load(toggles);
	await t.frames();
	t.caret('Open');
	await t.keyboard.press('Enter');
	await t.keyboard.type('first');
	t.caret('Closed');
	await t.keyboard.press('Enter');
	await t.keyboard.type('after');
	await t.frames();
	t.check('Enter at the end of a toggle\'s title adds its first block when it is open, and a block after it when it is closed', t.blocks(), [
		{ type: 'toggleListItem', text: 'Open', children: [{ type: 'paragraph', text: 'first' }, { type: 'paragraph', text: 'inside' }] },
		{ type: 'toggleListItem', text: 'Closed', children: [{ type: 'paragraph', text: 'hidden' }] },
		{ type: 'toggleListItem', text: 'after' },
	]);

	await t.load(toggles);
	await t.frames();
	t.caret('Op');
	await t.keyboard.press('Enter');
	await t.frames();
	t.check('Enter inside a toggle\'s title cuts it in two, and its blocks stay with the first part', t.blocks().slice(0, 2), [
		{ type: 'toggleListItem', text: 'Op', children: [{ type: 'paragraph', text: 'inside' }] },
		{ type: 'toggleListItem', text: 'en' },
	]);

	await t.load('<details>\n<summary>Fold me</summary>\n\ninside\n\n</details>\n\n- [ ] a task\n');
	await t.frames();
	const shown = () => t.editor.domElement?.querySelector('.bn-toggle-wrapper')?.getAttribute('data-show-children');
	t.caret('Fold me');
	await t.keyboard.press('Meta+Enter');
	await t.frames();
	const opened = shown();
	await t.keyboard.press('Meta+Enter');
	await t.frames();
	const closed = shown();
	t.caret('a task');
	await t.keyboard.press('Meta+Enter');
	await t.frames();
	t.check('Mod-Enter opens and closes a toggle, writing nothing, and checks a check item', { opened, closed, saved: await t.save() }, {
		opened: 'true',
		closed: 'false',
		saved: '<details>\n<summary>Fold me</summary>\n\ninside\n\n</details>\n\n- [x] a task\n',
	});

	const linked = 'See [a link](my%20file.md) and [another](#setup) here.\n';
	await t.load(linked);
	await t.frames();
	openedLinks.length = 0;
	t.caret('a li');
	await t.keyboard.press('Meta+Enter');
	t.caret('another');
	await t.keyboard.press('Meta+Enter');
	t.caret('here');
	await t.keyboard.press('Meta+Enter');
	await t.frames();
	t.check('Mod-Enter opens the link that holds the caret, at its address as stored, and does nothing elsewhere', { opened: [...openedLinks], saved: await t.save() }, {
		opened: ['my%20file.md', '#setup'],
		saved: linked,
	});

	await t.load('Line before.\n\n<div>fixed</div>\n\nLine after.\n');
	await t.frames();
	t.caret('Line before.');
	await t.keyboard.press('Meta+ArrowRight');
	await t.keyboard.type('xy');
	t.caret('Line after.', 'start');
	await t.keyboard.press('Meta+ArrowLeft');
	await t.keyboard.type('z');
	await t.frames();
	t.check('letters typed after Command-→ at a line before a fixed block, and after Command-← at one after it, go into that line', await t.save(), 'Line before.xy\n\n<div>fixed</div>\n\nzLine after.\n');

	// A busy page can give the editor a key before it tells the editor that a
	// click moved the caret: the key acts at the caret the page shows.
	await t.load('Line before.\n\n<div>fixed</div>\n\nLine after.\n');
	await t.frames();
	t.caret('Line after.');
	await t.frames();
	const shownText = (text: string): Text => {
		const walker = document.createTreeWalker(t.editor.domElement ?? document.body, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			if (node.textContent?.includes(text)) {
				return node as Text;
			}
		}
		throw new Error(`The note shows no text "${text}".`);
	};
	const before = shownText('Line before.');
	document.getSelection()?.collapse(before, before.length);
	const pressed = t.keyboard.press('ArrowRight');
	const busyUntil = performance.now() + 300;
	while (performance.now() < busyUntil) {
		// The page is busy while the key arrives.
	}
	await pressed;
	await t.keyboard.type('c');
	await t.frames();
	t.check('a key that arrives before the page reports a moved caret acts at the moved caret', await t.save(), 'Line before.\n\n<div>fixed</div>\n\nc\n\nLine after.\n');

	const toggle = '<details open>\n<summary>Title</summary>\n\nfirst\n\nsecond\n\n</details>\n';
	await t.load(toggle);
	await t.frames();
	t.caret('first', 'start');
	await t.keyboard.press('Backspace');
	await t.frames();
	const joinedToTitle = t.blocks();
	await t.load(toggle);
	await t.frames();
	t.caret('Title');
	await t.keyboard.press('Enter');
	await t.keyboard.press('Backspace');
	await t.keyboard.type('!');
	await t.frames();
	const emptyDeleted = t.blocks();
	await t.load('- item\n\n  first\n\n  second\n\n  third\n');
	await t.frames();
	t.caret('second', 'start');
	await t.keyboard.press('Backspace');
	await t.frames();
	t.check('Backspace at the start of a block inside another joins it to the line above, deletes it when empty, and leaves the blocks after it where they are', {
		joinedToTitle,
		emptyDeleted,
		joinedToSibling: t.blocks(),
	}, {
		joinedToTitle: [{ type: 'toggleListItem', text: 'Titlefirst', children: [{ type: 'paragraph', text: 'second' }] }],
		emptyDeleted: [{ type: 'toggleListItem', text: 'Title!', children: [{ type: 'paragraph', text: 'first' }, { type: 'paragraph', text: 'second' }] }],
		joinedToSibling: [{ type: 'bulletListItem', text: 'item', children: [{ type: 'paragraph', text: 'firstsecond' }, { type: 'paragraph', text: 'third' }] }],
	});
}

/** Pastes `data`, by type, as Command-V does: the editor's paste handler reads the clipboard's data. */
async function paste(t: INoteFormatsTest, data: Readonly<Record<string, string>>): Promise<void> {
	const transfer = new DataTransfer();
	for (const [type, value] of Object.entries(data)) {
		transfer.setData(type, value);
	}
	t.editor.domElement?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
	// A paste of Markdown reads it before it pastes.
	await t.frames(3);
}

/**
 * Part d, paste (note formats, rules 72 to 74): what Command-V brings, from
 * another application, as Markdown, or from a code editor, comes in as what
 * the note can store, the same as the note's file would show it.
 */
async function pastes(t: INoteFormatsTest): Promise<void> {
	const into = async (data: Readonly<Record<string, string>>): Promise<{ readonly saved: string; readonly blocks: readonly string[] }> => {
		await t.load('Start.\n');
		await t.frames();
		t.caret('Start.');
		await t.keyboard.press('Enter');
		await paste(t, data);
		return { saved: await t.save(), blocks: t.blocks().map(block => block.type) };
	};
	t.check('HTML from another application keeps underline but over a whole link and palette colors, and drops other colors, alignment, and a picture\'s width', {
		formats: (await into({
			'text/html': '<p style="text-align:center;background-color:yellow"><u>under</u>, <a href="https://example.com/a"><u>a whole link</u></a>, <span style="color: rgb(232, 112, 107)">red</span>, and <span style="color:#123456">other</span>.</p>',
			'text/plain': 'under, a whole link, red, and other.',
		})).saved,
		picture: (await into({ 'text/html': '<img src="https://example.com/pic.png" width="200">', 'text/plain': '' })).saved,
	}, {
		formats: 'Start.\n\n<u>under</u>, [a whole link](https://example.com/a), <span style="color:#e8706b;">red</span>, and other.\n',
		picture: 'Start.\n\n![](https://example.com/pic.png)\n',
	});
	t.check('a pasted toggle is stored closed, and a pasted table has one header row and no merged cells', {
		toggle: (await into({ 'text/html': '<details open><summary>Title</summary><p>child</p></details>', 'text/plain': 'Title child' })).saved,
		table: (await into({
			'text/html': '<table><tr><td colspan="2" style="background-color:red">wide</td></tr><tr><td>x</td><td>y</td></tr></table>',
			'text/plain': 'wide x y',
		})).saved,
	}, {
		toggle: 'Start.\n\n<details>\n<summary>Title</summary>\n\nchild\n\n</details>\n',
		table: 'Start.\n\n|      |     |\n| ---- | --- |\n| wide |     |\n| x    | y   |\n',
	});
	t.check('pasted Markdown is read as the note\'s file is: what Rich cannot edit is a fixed block, and a paragraph that is one link to a file a file block', {
		markdown: await into({ 'text/plain': '# Heading\n\n<div>raw</div>\n\n- one\n- two\n' }),
		fileLink: (await into({ 'text/plain': '[handout.pdf](handout.pdf) and [a link](https://example.com/b)\n\n[handout.pdf](handout.pdf)\n' })).blocks,
		plain: (await into({ 'text/plain': 'plain * words' })).saved,
	}, {
		markdown: { saved: 'Start.\n\n# Heading\n\n<div>raw</div>\n\n- one\n- two\n', blocks: ['paragraph', 'heading', 'rawPassthrough', 'bulletListItem', 'bulletListItem'] },
		fileLink: ['paragraph', 'paragraph', 'file'],
		plain: 'Start.\n\nplain * words\n',
	});
	const typescript = { 'vscode-editor-data': JSON.stringify({ mode: 'typescript' }), 'text/plain': 'const a = 1;' };
	const fromSource = {
		markdown: (await into({ 'vscode-editor-data': JSON.stringify({ mode: 'markdown' }), 'text/plain': '- a\n- b' })).saved,
		code: (await into(typescript)).saved,
	};
	await t.load('abcdef\n');
	await t.frames();
	t.caret('abc');
	await paste(t, typescript);
	t.check('Markdown copied from a code editor is read as Markdown, and code of another language is one block of code, also in the middle of a line', {
		...fromSource,
		midLine: await t.save(),
	}, {
		markdown: 'Start.\n\n- a\n- b\n',
		code: 'Start.\n\n```typescript\nconst a = 1;\n```\n',
		midLine: 'abc\n\n```typescript\nconst a = 1;\n```\n\ndef\n',
	});

	// A fixed block copied within Rich: the editor's own HTML of it.
	await t.load('Start.\n\n<div>raw</div>\n');
	await t.frames();
	const fixedHtml = t.editor.blocksToFullHTML([t.editor.document[1]]);
	await t.load('Start.\n');
	await t.frames();
	t.caret('Start.');
	await t.keyboard.press('Enter');
	await paste(t, { 'blocknote/html': fixedHtml, 'text/html': fixedHtml, 'text/plain': '<div>raw</div>' });
	t.check('a fixed block copied within Rich is pasted as a fixed block of its text', { saved: await t.save(), blocks: t.blocks().map(block => block.type) }, {
		saved: 'Start.\n\n<div>raw</div>\n',
		blocks: ['paragraph', 'rawPassthrough'],
	});
}

/** Selects from the start of the first text `from` to the end of the first text `to` after it, and gives the editor the keyboard. */
function selectBetween(t: INoteFormatsTest, from: string, to: string): void {
	const view = t.editor.prosemirrorView;
	let start: number | undefined;
	let end: number | undefined;
	view.state.doc.descendants((node, position) => {
		if (node.isText && node.text) {
			if (start === undefined && node.text.includes(from)) {
				start = position + node.text.indexOf(from);
			}
			if (start !== undefined && end === undefined && node.text.includes(to) && position + node.text.indexOf(to) >= start) {
				end = position + node.text.indexOf(to) + to.length;
			}
		}
		return end === undefined;
	});
	if (start === undefined || end === undefined) {
		throw new Error(`The note has no text from "${from}" to "${to}".`);
	}
	view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start, end)));
	t.editor.focus();
}

/** Copies or cuts the selection as Command-C or Command-X does, and gives what the clipboard holds. */
async function copy(t: INoteFormatsTest, kind: 'copy' | 'cut' = 'copy'): Promise<{ readonly text: string; readonly html: string }> {
	const transfer = new DataTransfer();
	t.editor.domElement?.dispatchEvent(new ClipboardEvent(kind, { clipboardData: transfer, bubbles: true, cancelable: true }));
	await t.frames();
	return { text: transfer.getData('text/plain'), html: transfer.getData('text/html') };
}

/**
 * Part f, copy (note formats, rules 75 to 77): what Command-C and Command-X
 * put on the clipboard as text is the Markdown the note stores for the
 * selection, with toggles closed and fixed blocks as their text, and the
 * HTML for another application has the palette's values; code is copied as
 * its code, and a cut is a step of undo of its own.
 */
async function copies(t: INoteFormatsTest): Promise<void> {
	await t.load('Some **bold**, <u>under</u>, and <span style="color:#e8706b;">red</span> text.\n');
	await t.frames();
	selectBetween(t, 'Some', 'text.');
	const inline = await copy(t);
	t.check('a copy within one block puts its text with its formats as the note stores them, and its HTML with the palette\'s values', {
		text: inline.text,
		red: /<span [^>]*style="color:#e8706b;"[^>]*>red<\/span>/.test(inline.html),
	}, { text: 'Some **bold**, <u>under</u>, and <span style="color:#e8706b;">red</span> text.', red: true });

	await t.load('<details open>\n<summary>Title</summary>\n\nchild\n\n</details>\n\n<div>raw</div>\n\n- one\n- two\n');
	await t.frames();
	selectBetween(t, 'Title', 'two');
	const blocks = await copy(t);
	await t.load('```js\nconst x = 1;\n```\n');
	await t.frames();
	selectBetween(t, 'const', '1;');
	const code = await copy(t);
	t.check('a copy of blocks puts the Markdown the note stores for them, a toggle closed and a fixed block as its text; a copy in code puts its code', {
		blocks: blocks.text,
		code: code.text,
	}, {
		blocks: '<details>\n<summary>Title</summary>\n\nchild\n\n</details>\n\n<div>raw</div>\n\n- one\n- two',
		code: 'const x = 1;',
	});

	await t.load('First line.\n\nSecond line.\n');
	await t.frames();
	t.caret('Second line.');
	await t.keyboard.type(' more');
	selectBetween(t, 'First', 'line.');
	const cut = await copy(t, 'cut');
	const afterCut = await t.save();
	t.command('undo');
	await t.frames();
	t.check('a cut puts the same text, deletes what it took, and is a step of undo of its own', { text: cut.text, afterCut, undone: await t.save() }, {
		text: 'First line.',
		afterCut: 'Second line. more\n',
		undone: 'First line.\n\nSecond line. more\n',
	});
}

/**
 * Part h, files added from the slash menu (note formats, rule 49): a
 * placeholder that is no part of the note shows the file while it is
 * copied, then the block takes the place of the empty block the menu was
 * in, in one step of undo; a note chosen for File is a link; a file that
 * cannot be copied adds nothing.
 */
async function media(t: INoteFormatsTest): Promise<void> {
	const placeholder = () => t.editor.domElement?.querySelector('.basehalf-note-media-placeholder')?.textContent ?? null;
	await t.load('Start.\n');
	await t.frames();
	t.caret('Start.');
	await t.keyboard.press('Enter');
	await t.keyboard.type('typed');
	await t.keyboard.press('Enter');
	const adding = addBaseHalfNoteMediaFile(t.editor, 'video', new File(['x'], 'slow clip.mp4', { type: 'video/mp4' }));
	await t.frames();
	const whileCopied = { placeholder: placeholder(), saved: await t.save() };
	await adding;
	await t.frames();
	const added = { placeholder: placeholder(), blocks: t.blocks().map(block => block.type) };
	await t.keyboard.type('after');
	await t.frames();
	const typedBelow = await t.save();
	t.command('undo');
	t.command('undo');
	await t.frames();
	t.check('a file added from the slash menu shows a placeholder while it is copied, then is one block where the menu was, the caret in the line below it, in one step of undo', {
		whileCopied,
		added,
		typedBelow,
		undone: await t.save(),
	}, {
		whileCopied: { placeholder: 'Adding slow clip.mp4…', saved: 'Start.\n\ntyped\n' },
		added: { placeholder: null, blocks: ['paragraph', 'paragraph', 'video', 'paragraph'] },
		typedBelow: 'Start.\n\ntyped\n\n<video src="attachments/slow%20clip.mp4" controls></video>\n\nafter\n',
		undone: 'Start.\n\ntyped\n',
	});

	await t.load('Start.\n');
	await t.frames();
	t.caret('Start.');
	await addBaseHalfNoteMediaFile(t.editor, 'file', new File(['# x'], 'notes.md', { type: 'text/markdown' }));
	await addBaseHalfNoteMediaFile(t.editor, 'file', new File(['x'], 'handout.pdf', { type: 'application/pdf' }));
	await t.frames();
	const files = { saved: await t.save(), blocks: t.blocks().map(block => block.type) };
	await addBaseHalfNoteMediaFile(t.editor, 'image', new File(['x'], 'fail.png', { type: 'image/png' }));
	await t.frames();
	t.check('a note chosen for File is added as a link, another file as a file block, one after the other, and a file that cannot be copied adds nothing', {
		files,
		failed: { placeholder: placeholder(), saved: await t.save() },
	}, {
		files: { saved: 'Start.\n\n[notes.md](attachments/notes.md)\n\n[handout.pdf](attachments/handout.pdf)\n', blocks: ['paragraph', 'paragraph', 'file', 'paragraph'] },
		failed: { placeholder: 'Could not add fail.png.', saved: 'Start.\n\n[notes.md](attachments/notes.md)\n\n[handout.pdf](attachments/handout.pdf)\n' },
	});
}

/** A picture of 200 by 80 pixels, of one color. */
const WIDE_PICTURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAABQCAIAAADTD63nAAAA6UlEQVR4nO3SQQkAIADAQNMZzEwGtIRDkIMLsMfGXBuuG88L+JKxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi8QB5TvLZS9xqhUAAAAASUVORK5CYII=';

/**
 * Part i, a picture's edge on a magnified page (note formats, rule 28,
 * criterion 10): with the page drawn at 200%, the edge the pointer drags
 * stays within 1 pixel of the pointer, and the width is stored as a whole
 * number of pixels.
 */
async function magnifiedResize(t: INoteFormatsTest): Promise<void> {
	await t.load('Resize below.\n');
	await t.frames();
	const [first] = t.editor.document;
	t.editor.insertBlocks([{ type: 'image', props: { url: WIDE_PICTURE } }] as Parameters<typeof t.editor.insertBlocks>[0], first, 'after');
	await until('the picture loads', () => (t.editor.domElement?.querySelector('img') as HTMLImageElement | null)?.naturalWidth === 200);
	// As Card Detail magnifies a note (zoom and outline of a note): the page drawn larger, nothing laid out anew.
	const notePage = document.querySelector<HTMLElement>('.basehalf-markdown-rich-page');
	if (!notePage) {
		throw new Error('The test bed has no page.');
	}
	notePage.style.transformOrigin = '0 0';
	notePage.style.transform = 'scale(2)';
	const removeZoom = installBaseHalfNoteResizeUnderZoom(window, () => 2);
	try {
		await t.frames(4);
		const picture = t.editor.domElement?.querySelector('img')?.getBoundingClientRect();
		if (!picture) {
			throw new Error('The picture is not shown.');
		}
		await t.mouse.move(picture.left + picture.width / 2, picture.top + picture.height / 2);
		await t.frames(4);
		const rightHandle = () => [...document.querySelectorAll('.bn-resize-handle')].map(handle => handle.getBoundingClientRect()).sort((a, b) => b.left - a.left)[0];
		const handle = rightHandle();
		const x = handle.left + handle.width / 2;
		const y = handle.top + handle.height / 2;
		await t.mouse.move(x, y);
		await t.mouse.down();
		const drift: number[] = [];
		for (let step = 1; step <= 4; step++) {
			await t.mouse.move(x + step * 10, y);
			await t.frames(2);
			const now = rightHandle();
			drift.push(Math.round(now.left + now.width / 2 - (x + step * 10)));
		}
		await t.mouse.up();
		await t.frames();
		t.check('at 200% the dragged edge of a picture stays under the pointer, and its width is stored as a whole number', {
			drift,
			saved: await t.save(),
		}, {
			drift: [0, 0, 0, 0],
			saved: `Resize below.\n\n<img src="${WIDE_PICTURE}" width="220">\n`,
		});
	} finally {
		removeZoom();
		notePage.style.transform = '';
		notePage.style.transformOrigin = '';
	}
}

/** Selects the first text that matches, and gives the editor the keyboard. */
function selectText(t: INoteFormatsTest, text: string): void {
	const view = t.editor.prosemirrorView;
	let at: number | undefined;
	view.state.doc.descendants((node, position) => {
		const offset = at === undefined && node.isText ? (node.text ?? '').indexOf(text) : -1;
		if (offset >= 0) {
			at = position + offset;
		}
		return at === undefined;
	});
	if (at === undefined) {
		throw new Error(`The note has no text "${text}".`);
	}
	view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at, at + text.length)));
	t.editor.focus();
}

/**
 * Part n, what Rich adjusts after a change and the steps of undo (note
 * formats, rules 28, 29, 58 to 60, 66, and 78): a change that leaves the
 * note in a shape its file cannot store is followed by the least that gives
 * it that shape, in the same step of undo; a format, a nest, a move, a
 * paste, and a change of a block's kind are a step each, and the letters of
 * one caption are one step.
 */
async function shape(t: INoteFormatsTest): Promise<void> {
	// A list item that becomes a paragraph gives its blocks to the note.
	await t.load('- item\n  - sub\n');
	await t.frames();
	t.caret('item', 'start');
	await t.keyboard.press('Backspace');
	await t.frames();
	const madeParagraph = { shown: t.blocks(), saved: await t.save() };
	t.command('undo');
	await t.frames();
	t.check('a block that may not hold blocks gives them to the note after it, in the same step of undo', { madeParagraph, undone: await t.save() }, {
		madeParagraph: { shown: [{ type: 'paragraph', text: 'item' }, { type: 'bulletListItem', text: 'sub' }], saved: 'item\n\n- sub\n' },
		undone: '- item\n  - sub\n',
	});

	await t.load('Some red text.\n');
	await t.frames();
	selectText(t, 'red');
	t.editor.addStyles({ textColor: 'rgb(232, 112, 107)' });
	selectText(t, 'text');
	t.editor.addStyles({ textColor: '#123456' });
	await t.frames();
	t.check('a color of text is a palette color, the one it stands for, or none', await t.save(), 'Some <span style="color:#e8706b;">red</span> text.\n');

	await t.load('Before.\n');
	await t.frames();
	const [before] = t.editor.document;
	t.editor.insertBlocks([
		{ type: 'table', content: { type: 'tableContent', rows: [{ cells: ['a', 'b'] }, { cells: ['c', 'd'] }] } },
		{ type: 'image', props: { url: 'clip.mp4', previewWidth: 300.6 } },
	] as Parameters<typeof t.editor.insertBlocks>[0], before, 'after');
	await t.frames();
	const [, table, video] = t.editor.document as unknown as readonly { readonly type: string; readonly props: Record<string, unknown>; readonly content?: { readonly headerRows?: number } }[];
	t.check('a table\'s first row is its header, and a picture of a video is a video at a whole width', {
		headerRows: table?.content?.headerRows,
		media: { type: video?.type, previewWidth: video?.props.previewWidth },
	}, { headerRows: 1, media: { type: 'video', previewWidth: 301 } });

	t.editor.insertBlocks([{ type: 'table', content: { type: 'tableContent', rows: [{ cells: [{ type: 'tableCell', props: { colspan: 2 }, content: ['wide'] }] }, { cells: ['x', 'y'] }] } }] as Parameters<typeof t.editor.insertBlocks>[0], before, 'after');
	await t.frames();
	const merged = t.editor.document[1] as unknown as { readonly content: { readonly rows: readonly { readonly cells: readonly { readonly props: { readonly colspan?: number } }[] }[] } };
	t.check('a merged cell is split, its content in its first cell', merged.content.rows.map(row => row.cells.map(cell => cell.props.colspan)), [[1, 1], [1, 1]]);

	// Steps of undo by kind.
	await t.load('Some text here.\n');
	await t.frames();
	t.caret('here.');
	await t.keyboard.type(' more');
	selectText(t, 'text');
	await t.keyboard.press('Meta+u');
	await t.frames();
	const underlined = await t.save();
	t.command('undo');
	await t.frames();
	const formatUndone = await t.save();
	t.caret('more');
	await t.keyboard.type(' typed');
	t.editor.pasteText(' pasted');
	await t.frames();
	t.command('undo');
	await t.frames();
	t.check('a format and a paste are a step each: undo takes back only them, and not the letters typed before', {
		underlined,
		formatUndone,
		pasteUndone: await t.save(),
	}, {
		underlined: 'Some <u>text</u> here. more\n',
		formatUndone: 'Some text here. more\n',
		pasteUndone: 'Some text here. more typed\n',
	});

	await t.load('- one\n- two\n- three\n');
	await t.frames();
	t.caret('three');
	await t.keyboard.type('!');
	await t.keyboard.press('Shift+Meta+ArrowUp');
	await t.frames();
	const moved = await t.save();
	t.command('undo');
	await t.frames();
	t.check('a move of a block by keys is a step of its own', { moved, undone: await t.save() }, {
		moved: '- one\n- three!\n- two\n',
		undone: '- one\n- two\n- three!\n',
	});

	await t.load('![](pic.png)\n');
	await t.frames();
	const [picture] = t.editor.document;
	for (const caption of ['a', 'ab', 'abc']) {
		const update: Parameters<typeof t.editor.updateBlock>[1] = { props: { caption } };
		t.editor.updateBlock(picture, update);
	}
	await t.frames();
	const captioned = (t.editor.document[0] as unknown as { readonly props: { readonly caption: string } }).props.caption;
	t.command('undo');
	await t.frames();
	t.check('the letters of one caption, one change after another, are one step', {
		captioned,
		undone: (t.editor.document[0] as unknown as { readonly props: { readonly caption: string } }).props.caption,
	}, { captioned: 'abc', undone: '' });
}

/**
 * Part g, toggles (note formats, rules 39 to 41): a `<details>` whose parts
 * are blocks of their own is one toggle, open or closed as its file stores
 * it; folding it writes nothing and is no step of undo; a letter typed into
 * one of its blocks changes that block alone.
 */
async function toggles(t: INoteFormatsTest): Promise<void> {
	const note = '<details open>\n<summary>Open one</summary>\n\nfirst child\n\n</details>\n\n<details>\n<summary>Closed one</summary>\n\nsecond child\n\nthird child\n\n</details>\n';
	await t.load(note);
	await t.frames();
	const shown = () => [...(t.editor.domElement?.querySelectorAll('.bn-toggle-wrapper') ?? [])].map(wrapper => wrapper.getAttribute('data-show-children'));
	t.check('two toggles hold their blocks, open and closed as the file stores them, and save as they were', {
		blocks: t.blocks(),
		shown: shown(),
		saved: await t.save(),
	}, {
		blocks: [
			{ type: 'toggleListItem', text: 'Open one', children: [{ type: 'paragraph', text: 'first child' }] },
			{ type: 'toggleListItem', text: 'Closed one', children: [{ type: 'paragraph', text: 'second child' }, { type: 'paragraph', text: 'third child' }] },
		],
		shown: ['true', 'false'],
		saved: note,
	});

	t.editor.domElement?.querySelectorAll<HTMLButtonElement>('.bn-toggle-button')[1]?.click();
	await t.frames();
	t.check('opening a closed toggle shows its blocks, writes nothing, and is no step of undo', {
		shown: shown(),
		saved: await t.save(),
		steps: t.history.current?.undoStack.length,
		stored: Object.keys(localStorage).filter(key => key.startsWith('toggle-')),
	}, { shown: ['true', 'true'], saved: note, steps: 0, stored: [] });

	t.caret('third child');
	await t.keyboard.type('!');
	await t.frames();
	t.check('a letter typed into one block of a toggle changes that block alone', await t.save(), note.replace('third child', 'third child!'));

	const closed = '<details>\n<summary>Closed</summary>\n\nhidden\n\n</details>\n\nafter\n';
	await t.load(closed);
	await t.frames();
	t.caret('after', 'start');
	await t.keyboard.press('Backspace');
	await t.frames();
	t.check('Backspace after a closed toggle opens it, as its hidden block now holds the caret', { shown: shown(), saved: await t.save() }, {
		shown: ['true'],
		saved: '<details>\n<summary>Closed</summary>\n\nhiddenafter\n\n</details>\n',
	});
}

/**
 * Part c, the schema (note formats, rules 1 to 3): no block holds a color of
 * its own or an alignment, and a file holds no caption; the editor draws and
 * writes no such attribute, and a paste brings none.
 */
async function schema(t: INoteFormatsTest): Promise<void> {
	await t.load('A paragraph.\n\n![pic](pic.png)\n\n[handout.pdf](handout.pdf)\n');
	await t.frames();
	const props = (type: string) => Object.keys(t.editor.schema.blockSpecs[type as keyof typeof t.editor.schema.blockSpecs].config.propSchema).sort();
	const drawn = t.editor.domElement?.innerHTML ?? '';
	const html = t.editor.blocksToFullHTML(t.editor.document);
	const pasted = t.editor.tryParseHTMLToBlocks('<p style="text-align:center;color:red;background-color:yellow">centered red</p><img src="pic.png" style="text-align:right">');
	t.check('no block holds a color of its own or an alignment, and a file holds no caption', {
		paragraph: props('paragraph'),
		heading: props('heading'),
		image: props('image'),
		video: props('video'),
		audio: props('audio'),
		file: props('file'),
	}, {
		paragraph: [],
		heading: ['isToggleable', 'level'],
		image: ['caption', 'name', 'previewWidth', 'showPreview', 'url'],
		video: ['caption', 'name', 'previewWidth', 'showPreview', 'url'],
		audio: ['caption', 'name', 'showPreview', 'url'],
		file: ['name', 'url'],
	});
	const looks = /data-(?:text-color|background-color|text-alignment)=/;
	t.check('the editor draws and writes no color of a block and no alignment, and a paste brings none', {
		drawn: looks.test(drawn),
		html: looks.test(html),
		pasted: pasted.map(block => ({ type: block.type, looks: Object.keys(block.props).filter(name => ['textColor', 'backgroundColor', 'textAlignment'].includes(name)) })),
	}, {
		drawn: false,
		html: false,
		pasted: [{ type: 'paragraph', looks: [] }, { type: 'image', looks: [] }],
	});
}

/**
 * Part k, fixed blocks (note formats, rules 47, 57, and 81; criterion 25): a
 * block Rich cannot edit draws a stored color, a sound, and an open toggle as
 * the card does, and no link or picture in it has a title.
 */
async function fixedBlocks(t: INoteFormatsTest): Promise<void> {
	const note = '<mark>Marked</mark> and <span style="color:#e8706b;">red</span> [a link](x.md "Title")\n\n<div>\n<audio src="sound.mp3" controls></audio>\n</div>\n\n<details open class="kept">\n<summary>Open</summary>\n\nInside.\n\n</details>\n';
	await t.load(note);
	await t.frames();
	const fixed = [...(t.editor.domElement?.querySelectorAll('.basehalf-raw-passthrough-rendered') ?? [])];
	const span = fixed[0]?.querySelector<HTMLElement>('span[style]');
	t.check('a fixed block draws a stored color, a sound, and an open toggle, and no title', {
		fixed: fixed.length,
		color: span ? getComputedStyle(span).color : undefined,
		sound: fixed.some(block => block.querySelector('audio') !== null),
		open: fixed.some(block => block.querySelector('details')?.hasAttribute('open') === true),
		titles: fixed.reduce((count, block) => count + block.querySelectorAll('[title]').length, 0),
		saved: await t.save(),
	// The toggle has an attribute Rich cannot write: its first lines and its last line are fixed blocks (rule 42).
	}, { fixed: 4, color: 'rgb(232, 112, 107)', sound: true, open: true, titles: 0, saved: note });
}

/**
 * The parts of the test, by name. Each runs on a note of its own and records
 * its checks with `t.check`. Parts a to i of D110 join here.
 */
const PARTS: Record<string, (t: INoteFormatsTest) => Promise<void>> = {
	'0': testBed,
	c: schema,
	d: pastes,
	f: copies,
	e: keys,
	g: toggles,
	h: media,
	i: magnifiedResize,
	k: fixedBlocks,
	n: shape,
};

// As editor.tsx does before the first note is drawn.
installBaseHalfNoteToggleState();

async function run(name: string, mode: NoteFormatsMode): Promise<INoteFormatsPartResult> {
	const result: INoteFormatsPartResult = { checks: [], logs: [], milliseconds: 0 };
	const part = PARTS[name];
	if (!part) {
		result.error = `There is no part "${name}". The parts are ${Object.keys(PARTS).join(', ')}.`;
		return result;
	}
	// BlockNote keeps the fold of a toggle in localStorage; each part starts without one.
	localStorage.clear();
	const started = performance.now();
	let open: IOpenNote | undefined;
	try {
		open = await openNote(mode, result);
		await part(open.test);
	} catch (error) {
		result.error = error instanceof Error ? error.stack ?? error.message : String(error);
	} finally {
		open?.dispose();
	}
	result.milliseconds = Math.round(performance.now() - started);
	return result;
}

Object.assign(globalThis, {
	baseHalfFormats: { parts: Object.keys(PARTS), run },
});
