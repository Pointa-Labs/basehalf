/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	BASEHALF_RAW_PASSTHROUGH_BLOCK,
	baseHalfMarkdownContentTokens,
	baseHalfMarkdownLosesContent,
	buildBaseHalfMarkdownLoadProjection,
	IBaseHalfMarkdownEditorApi,
	IBaseHalfMarkdownSegment,
	joinBaseHalfMarkdownFrontmatter,
	segmentBaseHalfMarkdownBody,
	spliceBaseHalfMarkdownSave,
	splitBaseHalfMarkdownFrontmatter
} from '../../common/basehalfMarkdownProjection.js';

suite('BaseHalfMarkdownProjection', () => {
	suite('frontmatter', () => {
		test('splits and rejoins standard frontmatter verbatim', () => {
			const content = '---\ntitle: Hi\ntags: [a, b]\n---\n\n# Body\n\ntext\n';
			const { frontmatter, body } = splitBaseHalfMarkdownFrontmatter(content);

			assert.strictEqual(frontmatter, '---\ntitle: Hi\ntags: [a, b]\n---\n');
			assert.strictEqual(body, '\n# Body\n\ntext\n');
			assert.strictEqual(joinBaseHalfMarkdownFrontmatter(frontmatter, body), content);
		});

		test('preserves CRLF frontmatter and EOF closing fences', () => {
			assert.deepStrictEqual(splitBaseHalfMarkdownFrontmatter('---\r\ntitle: Hi\r\n---\r\nbody\r\n'), {
				frontmatter: '---\r\ntitle: Hi\r\n---\r\n',
				body: 'body\r\n'
			});
			assert.deepStrictEqual(splitBaseHalfMarkdownFrontmatter('---\nk: v\n---'), {
				frontmatter: '---\nk: v\n---',
				body: ''
			});
		});

		test('does not treat leading horizontal rules or setext headings as frontmatter', () => {
			const hr = '---\n\nJust a thematic break above, then prose.\n';
			assert.deepStrictEqual(splitBaseHalfMarkdownFrontmatter(hr), { frontmatter: '', body: hr });

			const setext = 'Title\n---\n\nbody\n';
			assert.deepStrictEqual(splitBaseHalfMarkdownFrontmatter(setext), { frontmatter: '', body: setext });
		});
	});

	suite('segmentBaseHalfMarkdownBody', () => {
		const tiles = (body: string): IBaseHalfMarkdownSegment[] => {
			const segments = segmentBaseHalfMarkdownBody(body);
			assert.strictEqual(segments.map(segment => segment.raw).join(''), body);
			for (const segment of segments) {
				assert.strictEqual(segment.prefix + segment.source + segment.sep, segment.raw);
				assert.ok(segment.raw.includes(segment.source));
			}
			return segments;
		};

		const fixtures: Record<string, string> = {
			'plain multi-paragraph': 'First paragraph.\n\nSecond paragraph here.\n',
			headings: '# Title\n\nIntro.\n\n## Section\n\nBody text.\n',
			'fenced code with blank lines inside': [
				'Before.',
				'',
				'```js',
				'const a = 1;',
				'',
				'const b = 2;',
				'```',
				'',
				'After.',
				''
			].join('\n'),
			'gfm table': ['| a | b |', '| - | - |', '| 1 | 2 |', '', 'Tail.', ''].join('\n'),
			'bullet list': '- one\n- two\n- three\n',
			'ordered list': '1. first\n2. second\n3. third\n',
			'task list': '- [ ] todo\n- [x] done\n',
			blockquote: '> a quoted line\n> continued\n\nOutside.\n',
			'html comment': '# Doc\n\n<!-- bh:workspace-hint -->\n\nBody.\n',
			'raw html details': '<details>\n<summary>more</summary>\nhidden\n</details>\n\nNext.\n',
			'leading blank lines': '\n\n# After blanks\n\ntext\n',
			'no trailing newline': '# A\n\nlast line with no newline',
			crlf: '# A\r\n\r\nLine one.\r\n\r\nLine two.\r\n',
			mixed: [
				'# Title',
				'',
				'<!-- a comment -->',
				'',
				'A paragraph with **bold**.',
				'',
				'- item 1',
				'- item 2',
				'',
				'```',
				'raw code',
				'```',
				'',
				'> quote',
				''
			].join('\n')
		};

		for (const [name, body] of Object.entries(fixtures)) {
			test(`reproduces ${name} byte-for-byte from raw tiles`, () => {
				tiles(body);
			});
		}

		test('returns an empty segment list for an empty body', () => {
			assert.deepStrictEqual(segmentBaseHalfMarkdownBody(''), []);
		});

		test('descends one level into lists and keeps item separators outside source', () => {
			const segments = tiles('- alpha\n- beta\n- gamma\n');

			assert.deepStrictEqual(segments.map(segment => segment.source), ['- alpha', '- beta', '- gamma']);
			assert.deepStrictEqual(segments.map(segment => segment.sep), ['\n', '\n', '\n']);
		});

		test('keeps loose list spacing in the edited item separator', () => {
			const segments = tiles('- alpha\n\n- beta\n');

			assert.deepStrictEqual(segments.map(segment => segment.source), ['- alpha', '- beta']);
			assert.deepStrictEqual(segments.map(segment => segment.sep), ['\n\n', '\n']);
		});
	});

	suite('content loss detection', () => {
		test('extracts letter and digit runs as content tokens', () => {
			assert.strictEqual(baseHalfMarkdownContentTokens('Keep <!-- x --> this'), 'Keep x this');
			assert.strictEqual(baseHalfMarkdownContentTokens('**bold** and _em_'), 'bold and em');
			assert.strictEqual(baseHalfMarkdownContentTokens('中文 ok 123'), '中文 ok 123');
		});

		test('flags dropped inline HTML comments, including symbol-only comments', () => {
			assert.strictEqual(baseHalfMarkdownLosesContent('Keep <!-- secret --> this', 'Keep  this'), true);
			assert.strictEqual(baseHalfMarkdownLosesContent('Keep <!-- !!! --> this', 'Keep  this'), true);
			assert.strictEqual(baseHalfMarkdownLosesContent('a <!-- --> b', 'a  b'), true);
		});

		test('flags dropped raw HTML but not standard Markdown normalization', () => {
			assert.strictEqual(baseHalfMarkdownLosesContent('Keep <span data-x="1">this</span>', 'Keep this'), true);
			assert.strictEqual(baseHalfMarkdownLosesContent('See [docs](docs/guide.md)', 'See docs'), false);
			assert.strictEqual(baseHalfMarkdownLosesContent('> [docs/decisions.md D19](docs/decisions.md)', '> docs/decisions.md D19'), false);
		});

		test('does not flag formatting-only churn', () => {
			assert.strictEqual(baseHalfMarkdownLosesContent('* a\n* b', '- a\n- b'), false);
			assert.strictEqual(baseHalfMarkdownLosesContent('soft\nwrap', 'soft wrap'), false);
			assert.strictEqual(baseHalfMarkdownLosesContent('Plain **bold** here', 'Plain **bold** here'), false);
		});
	});

	suite('load projection and splice save', () => {
		test('creates passthrough blocks for dropped segments and seeds an editable paragraph', async () => {
			const projection = await buildBaseHalfMarkdownLoadProjection(new FakeMarkdownEditor(), '<!-- bh:workspace-hint -->\n');

			assert.strictEqual(projection.blocks.length, 2);
			assert.strictEqual((projection.blocks[0] as { type?: string }).type, BASEHALF_RAW_PASSTHROUGH_BLOCK);
			assert.deepStrictEqual((projection.blocks[0] as { props?: unknown }).props, {
				raw: '<!-- bh:workspace-hint -->\n',
				source: '<!-- bh:workspace-hint -->',
				hidden: true
			});
			assert.strictEqual((projection.blocks[1] as { type?: string }).type, 'paragraph');
		});

		test('creates passthrough blocks when normalization would drop inline content', async () => {
			const projection = await buildBaseHalfMarkdownLoadProjection(new FakeMarkdownEditor(), 'Keep <!-- secret --> this\n');

			assert.strictEqual(projection.blocks.length, 2);
			assert.strictEqual((projection.blocks[0] as { type?: string }).type, BASEHALF_RAW_PASSTHROUGH_BLOCK);
			assert.deepStrictEqual((projection.blocks[0] as { props?: unknown }).props, {
				raw: 'Keep <!-- secret --> this\n',
				source: 'Keep <!-- secret --> this',
				hidden: false
			});
			assert.strictEqual((projection.blocks[1] as { type?: string }).type, 'paragraph');
		});

		test('keeps standard blockquotes editable even when Markdown syntax normalizes', async () => {
			const projection = await buildBaseHalfMarkdownLoadProjection(
				new FakeMarkdownEditor(),
				'> [docs/decisions.md D19](docs/decisions.md)\n'
			);

			assert.strictEqual(projection.blocks.length, 1);
			assert.strictEqual((projection.blocks[0] as { type?: string }).type, 'quote');
			assert.strictEqual(projection.byId.size, 1);
		});

		test('marks multi-block parsed segments as line-accounting-only reuse entries', async () => {
			const projection = await buildBaseHalfMarkdownLoadProjection(new FakeMarkdownEditor(), '> one\n>\n> two\n');

			assert.strictEqual(projection.blocks.length, 2);
			assert.strictEqual(projection.byId.get('multi-1')?.multi, true);
			assert.strictEqual(projection.byId.get('multi-2')?.multi, true);
			assert.strictEqual(projection.byId.get('multi-1')?.raw, '');
			assert.strictEqual(projection.byId.get('multi-2')?.raw, '> one\n>\n> two\n');
		});

		test('reuses unchanged raw tiles and confines normalization to edited blocks', async () => {
			const editor = new FakeMarkdownEditor();
			const byId = new Map([
				['a', { key: 'Alpha', raw: 'Alpha  \n\n', prefix: '', sep: '\n\n' }],
				['b', { key: 'Beta', raw: 'Beta\n', prefix: '', sep: '\n' }]
			]);

			const out = await spliceBaseHalfMarkdownSave(editor, [
				{ id: 'a', type: 'paragraph', markdown: 'Alpha' },
				{ id: 'b', type: 'paragraph', markdown: 'Beta changed' }
			], '', byId);

			assert.strictEqual(out, 'Alpha  \n\nBeta changed\n');
		});

		test('uses list-tight separators for new list item blocks', async () => {
			const editor = new FakeMarkdownEditor();

			const out = await spliceBaseHalfMarkdownSave(editor, [
				{ id: 'a', type: 'bulletListItem', markdown: '- Alpha' },
				{ id: 'b', type: 'bulletListItem', markdown: '- Beta' }
			], '', new Map());

			assert.strictEqual(out, '- Alpha\n- Beta\n');
		});

		test('keeps frontmatter fences separated from newly serialized body content', async () => {
			const editor = new FakeMarkdownEditor();

			assert.strictEqual(
				await spliceBaseHalfMarkdownSave(editor, [{ id: 'a', type: 'paragraph', markdown: 'hello' }], '---\nk: v\n---', new Map()),
				'---\nk: v\n---\nhello\n'
			);
			assert.strictEqual(
				await spliceBaseHalfMarkdownSave(editor, [{ id: 'a', type: 'paragraph', markdown: 'hello' }], '---\r\nk: v\r\n---', new Map()),
				'---\r\nk: v\r\n---\r\nhello\n'
			);
		});

		test('ignores multi reuse entries during save', async () => {
			const editor = new FakeMarkdownEditor();
			const blocks = [
				{ id: 'multi-1', type: 'paragraph', markdown: 'one' },
				{ id: 'multi-2', type: 'paragraph', markdown: 'two' }
			];
			const multiMap = new Map([
				['multi-1', { key: 'x', raw: '> one\n>\n> two\n', prefix: '', sep: '\n', multi: true }],
				['multi-2', { key: 'x', raw: '', prefix: '', sep: '', multi: true }]
			]);

			assert.strictEqual(
				await spliceBaseHalfMarkdownSave(editor, blocks, '', multiMap),
				await spliceBaseHalfMarkdownSave(editor, blocks, '', new Map())
			);
		});
	});
});

class FakeMarkdownEditor implements IBaseHalfMarkdownEditorApi {
	private nextId = 1;

	tryParseMarkdownToBlocks(markdown: string): unknown[] {
		if (/^<!--/.test(markdown)) {
			return [];
		}

		if (markdown.startsWith('> one')) {
			return [
				{ id: 'multi-1', type: 'paragraph', content: [{ type: 'text', text: 'one' }], markdown: 'one' },
				{ id: 'multi-2', type: 'paragraph', content: [{ type: 'text', text: 'two' }], markdown: 'two' }
			];
		}

		if (markdown.includes('<!-- secret -->')) {
			return [block(`b${this.nextId++}`, 'paragraph', markdown.replace('<!-- secret -->', ''))];
		}

		if (markdown.startsWith('> [docs/decisions.md D19]')) {
			return [block(`b${this.nextId++}`, 'quote', '> docs/decisions.md D19')];
		}

		return [block(`b${this.nextId++}`, blockTypeFor(markdown), markdown.trimEnd())];
	}

	blocksToMarkdownLossy(blocks: unknown[]): string {
		return blocks.map(block => (block as { markdown?: string }).markdown ?? '').join('\n');
	}
}

function block(id: string, type: string, markdown: string): unknown {
	return {
		id,
		type,
		content: [{ type: 'text', text: markdown }],
		markdown
	};
}

function blockTypeFor(markdown: string): string {
	if (/^\s*(?:[-*+]|\d+\.)\s/.test(markdown)) {
		return 'bulletListItem';
	}

	return 'paragraph';
}
