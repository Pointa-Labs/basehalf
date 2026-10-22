/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { parse as parseYaml, YamlNode } from '../../../../../base/common/yaml.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	BASEHALF_AGENT_SELECTION_TEXT_LIMIT,
	baseHalfAgentSelectionFor,
	baseHalfAgentSelectionLabel,
	IBaseHalfAgentSelectionInput,
	serializeBaseHalfAgentSelection
} from '../../common/basehalfAgentSelection.js';
import { baseHalfSelectionLines } from '../../common/basehalfSelectionLines.js';

function toPlain(node: YamlNode | undefined): unknown {
	switch (node?.type) {
		case 'map': return Object.fromEntries(node.properties.map(property => [property.key.value, toPlain(property.value)]));
		case 'sequence': return node.items.map(toPlain);
		case 'scalar': return node.value;
		default: return undefined;
	}
}

suite('BaseHalfAgentSelection', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const canvas: IBaseHalfAgentSelectionInput = {
		workspaceFolder: URI.file('/work/notes'),
		workspaceFolderName: 'notes',
		folderPath: 'courses',
		cards: []
	};
	const note = { path: 'courses/untitled.md', isFolder: false };
	const image = { path: 'courses/cover.png', isFolder: false };
	const text = { path: 'courses/untitled.md', firstLine: 3, lastLine: 5, text: '核心概念\nIR（原始需求）：用户想要什么' };

	test('selected text wins, then the card Card Detail shows, then the selected cards, then the folder', () => {
		assert.deepStrictEqual([
			baseHalfAgentSelectionFor(canvas),
			baseHalfAgentSelectionFor({ ...canvas, folderPath: '.' }),
			baseHalfAgentSelectionFor({ ...canvas, cards: [note] }),
			baseHalfAgentSelectionFor({ ...canvas, cards: [note, image] }),
			baseHalfAgentSelectionFor({ ...canvas, cards: [note, image], detail: note }),
			baseHalfAgentSelectionFor({ ...canvas, cards: [note], text }),
			baseHalfAgentSelectionFor({ ...canvas, cards: [note], text: { ...text, text: '' } }),
		], [
			{ selected: 'folder', path: 'courses', name: 'courses' },
			{ selected: 'folder', path: '.', name: 'notes' },
			{ selected: 'card', path: 'courses/untitled.md', isFolder: false },
			{ selected: 'cards', paths: ['courses/untitled.md', 'courses/cover.png'] },
			{ selected: 'card', path: 'courses/untitled.md', isFolder: false },
			{ selected: 'text', path: 'courses/untitled.md', firstLine: 3, lastLine: 5, text: '核心概念\nIR（原始需求）：用户想要什么', cut: false },
			{ selected: 'card', path: 'courses/untitled.md', isFolder: false },
		]);
	});

	test('the record reads back as the YAML the skill describes, also for paths and text YAML would misread', () => {
		const long = 'a'.repeat(BASEHALF_AGENT_SELECTION_TEXT_LIMIT + 5);
		const records = [
			baseHalfAgentSelectionFor({ ...canvas, folderPath: '.' }),
			baseHalfAgentSelectionFor({ ...canvas, cards: [{ path: 'courses/09: plan #1.md', isFolder: false }] }),
			baseHalfAgentSelectionFor({ ...canvas, cards: [note, { path: 'courses/true', isFolder: true }] }),
			baseHalfAgentSelectionFor({ ...canvas, text: { ...text, text: '- item: "quoted"\n\ttab' } }),
			baseHalfAgentSelectionFor({ ...canvas, text: { ...text, text: long } }),
		].map(selection => {
			const content = serializeBaseHalfAgentSelection(selection);
			return { comment: content.startsWith('# '), endsWithLineBreak: content.endsWith('\n'), fields: toPlain(parseYaml(content, [])) };
		});
		const header = { comment: true, endsWithLineBreak: true };
		assert.deepStrictEqual(records, [
			{ ...header, fields: { selected: 'folder', path: '.' } },
			{ ...header, fields: { selected: 'card', path: 'courses/09: plan #1.md' } },
			{ ...header, fields: { selected: 'cards', paths: ['courses/untitled.md', 'courses/true'] } },
			{ ...header, fields: { selected: 'text', path: 'courses/untitled.md', first_line: '3', last_line: '5', text: '- item: "quoted"\n\ttab' } },
			{ ...header, fields: { selected: 'text', path: 'courses/untitled.md', first_line: '3', last_line: '5', text: 'a'.repeat(BASEHALF_AGENT_SELECTION_TEXT_LIMIT), text_is_cut: 'true' } },
		]);
	});

	test('text that is only white space shows nothing, and a card is shown as its caption', () => {
		assert.deepStrictEqual([
			baseHalfAgentSelectionFor({ ...canvas, cards: [note], text: { ...text, text: '\n \n' } }),
			baseHalfAgentSelectionLabel(baseHalfAgentSelectionFor({ ...canvas, cards: [{ path: 'shots/scene.mp4', isFolder: false, caption: { name: 'scene.mp4', icon: 'video' } }] })),
		], [
			{ selected: 'card', path: 'courses/untitled.md', isFolder: false },
			{ icon: 'video', text: 'scene.mp4' },
		]);
	});

	test('a selected draft is a card by the path its file will have, with draft: true, and among cards it is listed like any card', () => {
		const draft = { path: 'shots/video.mp4', isFolder: false, caption: { name: 'video.mp4', icon: 'video' as const }, draft: true as const };
		const selection = baseHalfAgentSelectionFor({ ...canvas, cards: [draft] });
		const several = baseHalfAgentSelectionFor({ ...canvas, cards: [note, draft] });
		assert.deepStrictEqual({
			selection,
			record: toPlain(parseYaml(serializeBaseHalfAgentSelection(selection), [])),
			several: toPlain(parseYaml(serializeBaseHalfAgentSelection(several), [])),
			label: baseHalfAgentSelectionLabel(selection)
		}, {
			selection: { selected: 'card', path: 'shots/video.mp4', isFolder: false, caption: { name: 'video.mp4', icon: 'video' }, draft: true },
			record: { selected: 'card', path: 'shots/video.mp4', draft: 'true' },
			several: { selected: 'cards', paths: ['courses/untitled.md', 'shots/video.mp4'] },
			label: { icon: 'video', text: 'video.mp4' }
		});
	});

	test('the record escapes what YAML does not allow, and a cut never splits a character', () => {
		const odd = 'a\u2028b\u0085c\u007fd\uffff';
		const record = serializeBaseHalfAgentSelection(baseHalfAgentSelectionFor({ ...canvas, text: { ...text, text: odd } }));
		const cut = baseHalfAgentSelectionFor({ ...canvas, text: { ...text, text: `${'x'.repeat(BASEHALF_AGENT_SELECTION_TEXT_LIMIT - 1)}😀tail` } });
		assert.deepStrictEqual({
			raw: /[\u007f-\u009f\u2028\u2029\uffff]/.test(record),
			readBack: (toPlain(parseYaml(record, [])) as { text?: string }).text,
			cut: cut.selected === 'text' ? { length: cut.text.length, endsWhole: !/[\ud800-\udbff]$/.test(cut.text), marked: cut.cut } : undefined,
		}, { raw: false, readBack: odd, cut: { length: BASEHALF_AGENT_SELECTION_TEXT_LIMIT - 1, endsWhole: true, marked: true } });
	});

	test('narrows the lines of a selection inside its first and last block', () => {
		// Lines 10 to 14 of a note: a heading, then a list.
		const note = ['## 核心概念', '', '- **IR（原始需求）**：用户想要什么', '- **SR（系统需求）**：系统必须做什么', '- AR（分配需求）：[模块](modules.md)来实现'];
		const lineAt = (line: number) => note[line - 10] ?? '';
		const heading = { start: 10, end: 10 };
		const list = { start: 12, end: 14 };
		assert.deepStrictEqual([
			baseHalfSelectionLines(lineAt, list, list, 'SR（系统需求）：系统必须做什么'),
			baseHalfSelectionLines(lineAt, list, list, '需求）：用户想要什么\nSR（系统'),
			baseHalfSelectionLines(lineAt, heading, list, '核心概念\nIR（原始需求）：用户想要什么\nSR（系统需求）：系统必须做什么\nAR'),
			// Text on several lines: the ends stay at the edges of the blocks.
			baseHalfSelectionLines(lineAt, list, list, '需求）'),
			// A link is read as its text.
			baseHalfSelectionLines(lineAt, list, list, '模块来实现'),
		], [
			{ firstLine: 13, lastLine: 13 },
			{ firstLine: 12, lastLine: 13 },
			{ firstLine: 10, lastLine: 14 },
			{ firstLine: 12, lastLine: 14 },
			{ firstLine: 14, lastLine: 14 },
		]);
	});

	test('never narrows to a line that does not hold the start of the selection', () => {
		// The selection starts inside a link's text on line 10 and ends on line
		// 11, whose text holds the same words.
		const note = ['- 参考 [文档](docs.md) 第三章', '- 文档第三章的要点'];
		const list = { start: 10, end: 11 };
		assert.deepStrictEqual(
			baseHalfSelectionLines(line => note[line - 10] ?? '', list, list, '文档 第三章\n文档第三章的要点'),
			{ firstLine: 10, lastLine: 11 }
		);
	});

	test('the status bar shows a name as the caption does, the start of the text, or how many cards', () => {
		assert.deepStrictEqual([
			baseHalfAgentSelectionLabel(baseHalfAgentSelectionFor({ ...canvas, folderPath: '.' })),
			baseHalfAgentSelectionLabel(baseHalfAgentSelectionFor({ ...canvas, cards: [note] })),
			baseHalfAgentSelectionLabel(baseHalfAgentSelectionFor({ ...canvas, cards: [image] })),
			baseHalfAgentSelectionLabel(baseHalfAgentSelectionFor({ ...canvas, cards: [{ path: 'courses/week 1', isFolder: true }] })),
			baseHalfAgentSelectionLabel(baseHalfAgentSelectionFor({ ...canvas, cards: [note, image, note] })),
			baseHalfAgentSelectionLabel(baseHalfAgentSelectionFor({ ...canvas, text: { ...text, text: '  核心概念\n\n- IR（原始需求）：\t用户想要什么  ' } })),
			baseHalfAgentSelectionLabel(baseHalfAgentSelectionFor({ ...canvas, text: { ...text, text: 'x'.repeat(500) } })).text.length,
		], [
			{ icon: 'folder', text: 'notes' },
			{ icon: 'text', text: 'untitled' },
			{ icon: 'image', text: 'cover.png' },
			{ icon: 'folder', text: 'week 1' },
			{ icon: 'cards', text: '', count: 3 },
			{ icon: 'selectedText', text: '核心概念 - IR（原始需求）： 用户想要什么' },
			120,
		]);
	});
});
