/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	adoptBaseHalfMarkdownLoadProjection,
	BASEHALF_RAW_PASSTHROUGH_BLOCK,
	buildBaseHalfMarkdownLoadProjection,
	collectBaseHalfMarkdownSaveContributions,
	IBaseHalfMarkdownLoadProjection,
	IBaseHalfMarkdownSegment,
	joinBaseHalfMarkdownFrontmatter,
	segmentBaseHalfMarkdownBody,
	segmentBaseHalfMarkdownTopLevelBody,
	segmentBaseHalfMarkdownTopLevelBodyWithToggles,
	spliceBaseHalfMarkdownSave,
	splitBaseHalfMarkdownFrontmatter
} from '../../common/basehalfMarkdownProjection.js';
import { BaseHalfNoteTestEditor } from './basehalfNoteTestEditor.js';


suite('BaseHalfMarkdownProjection', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

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

			const separatedBody = '---\n\nprose\n\n---\n\ntail';
			assert.deepStrictEqual(splitBaseHalfMarkdownFrontmatter(separatedBody), {
				frontmatter: '',
				body: separatedBody
			});

			const setext = 'Title\n---\n\nbody\n';
			assert.deepStrictEqual(splitBaseHalfMarkdownFrontmatter(setext), { frontmatter: '', body: setext });
		});

		test('recognizes parsed top-level YAML mappings conservatively', () => {
			const content = [
				'---',
				'# document metadata',
				'title: A note',
				'tags:',
				'  - alpha',
				'  - beta',
				'---',
				'body'
			].join('\n');

			assert.deepStrictEqual(splitBaseHalfMarkdownFrontmatter(content), {
				frontmatter: content.slice(0, content.indexOf('body')),
				body: 'body'
			});

			for (const mapping of [
				'{ title: Note, tags: [alpha, beta] }',
				'{}',
				'defaults: &defaults\n  theme: dark\npage:\n  <<: *defaults',
				'"complex: # key with \\"quote\\"": value',
				`'single: # key with ''quote''': value`,
				'# leading trivia\ntitle: Note\n# trailing trivia',
			]) {
				for (const eol of ['\n', '\r\n']) {
					const frontmatter = `---${eol}${mapping.replace(/\n/g, eol)}${eol}---`;
					const withBody = `${frontmatter}${eol}body`;
					assert.deepStrictEqual(splitBaseHalfMarkdownFrontmatter(withBody), {
						frontmatter: `${frontmatter}${eol}`,
						body: 'body'
					});
					assert.deepStrictEqual(splitBaseHalfMarkdownFrontmatter(frontmatter), {
						frontmatter,
						body: ''
					});
				}
			}

			for (const body of [
				'---\n\n---\nbody',
				'---\n\ntitle: prose\n\n---\ntail',
				'---\r\n\r\ntitle: prose\r\n\r\n---\r\ntail',
				'---\n- list item\n---\nbody',
				'---\nordinary prose\n---\nbody',
				'---\nscalar\n---\nbody',
				'---\ntitle: metadata\nordinary prose\n---\nbody',
				'---\n{ title: metadata } trailing prose\n---\nbody',
				'---\ntitle: [unterminated\n---\nbody'
			]) {
				assert.deepStrictEqual(splitBaseHalfMarkdownFrontmatter(body), { frontmatter: '', body });
			}
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

		test('segments CRLF bodies per unit instead of one whole-body tile', () => {
			const segments = tiles('# T\r\n\r\npara one\r\n\r\n- a\r\n- b\r\n');

			assert.deepStrictEqual(segments.map(segment => segment.source), ['# T', 'para one', '- a', '- b']);
			assert.deepStrictEqual(segments.map(segment => segment.sep), ['\r\n\r\n', '\r\n\r\n', '\r\n', '\r\n']);
		});
	});

	suite('segmentBaseHalfMarkdownTopLevelBody', () => {
		const tiles = (body: string): IBaseHalfMarkdownSegment[] => {
			const segments = segmentBaseHalfMarkdownTopLevelBody(body);
			assert.strictEqual(segments.map(segment => segment.raw).join(''), body);
			for (const segment of segments) {
				assert.strictEqual(segment.prefix + segment.source + segment.sep, segment.raw);
			}
			return segments;
		};

		test('keeps paragraphs and paragraph soft breaks in top-level segments', () => {
			const segments = tiles('First paragraph.\n\nsoft-line-one\nsoft-line-two\n\nLast paragraph.\n');

			assert.deepStrictEqual(segments.map(segment => segment.source), [
				'First paragraph.',
				'soft-line-one\nsoft-line-two',
				'Last paragraph.'
			]);
		});

		test('keeps a toggle whose parts are blocks of their own as one segment for the card\'s editor (note formats, rule 82)', () => {
			const body = 'Before.\n\n<details open>\n<summary>Title</summary>\n\nchild one\n\nchild two\n\n</details>\n\nAfter.\n';
			const grouped = segmentBaseHalfMarkdownTopLevelBodyWithToggles(body);
			assert.strictEqual(grouped.map(segment => segment.raw).join(''), body);
			assert.deepStrictEqual(grouped.map(segment => segment.source), [
				'Before.',
				'<details open>\n<summary>Title</summary>\n\nchild one\n\nchild two\n\n</details>',
				'After.'
			]);
			assert.strictEqual(tiles(body).length > grouped.length, true);
		});

		test('keeps an entire top-level list in one segment', () => {
			const segments = tiles('Before.\n\n- alpha\n- beta\n- gamma\n\nAfter.\n');

			assert.deepStrictEqual(segments.map(segment => segment.source), [
				'Before.',
				'- alpha\n- beta\n- gamma',
				'After.'
			]);
		});

		test('keeps blockquotes and fenced code as distinct top-level segments', () => {
			const body = '> quote one\n> quote two\n\n```ts\nconst value = 1;\n```\n';
			const segments = tiles(body);

			assert.deepStrictEqual(segments.map(segment => segment.source), [
				'> quote one\n> quote two',
				'```ts\nconst value = 1;\n```'
			]);
		});

		test('maps CRLF offsets back to original bytes', () => {
			const body = '# Title\r\n\r\nline one\r\nline two\r\n\r\n- alpha\r\n- beta\r\n';
			const segments = tiles(body);

			assert.deepStrictEqual(segments.map(segment => segment.source), [
				'# Title',
				'line one\r\nline two',
				'- alpha\r\n- beta'
			]);
			assert.deepStrictEqual(segments.map(segment => segment.sep), ['\r\n\r\n', '\r\n\r\n', '\r\n']);
		});

		test('assigns leading and trailing separators without losing bytes', () => {
			const body = '\n\nFirst.\n\nSecond.\n\n\n';
			const segments = tiles(body);

			assert.deepStrictEqual(segments.map(segment => ({ prefix: segment.prefix, sep: segment.sep })), [
				{ prefix: '\n\n', sep: '\n\n' },
				{ prefix: '', sep: '\n\n\n' }
			]);
		});
	});

	suite('load projection and splice save', () => {
		const typeOf = (block: unknown) => (block as { type?: string }).type;
		const idOf = (block: unknown) => (block as { id: string }).id;
		const withText = (block: unknown, text: string) => ({ ...(block as object), content: [{ type: 'text', text, styles: {} }] });
		const save = (editor: BaseHalfNoteTestEditor, projection: IBaseHalfMarkdownLoadProjection, document: readonly unknown[] = projection.blocks) =>
			spliceBaseHalfMarkdownSave(editor, document, '', projection.byId, projection.note);

		test('a note saved without an edit keeps every byte', async () => {
			for (const body of [
				'# Title\nFirst line.\n',
				'Steps:\n- one\n- two\n',
				'- a\n- [ ] b\n',
				'text\n```sh\nls\n```\n',
				'\n\nLeading lines\n\n\n\nand gaps  \n',
				'*a*\n\n_b_\n\n1) one\n2) two\n',
				'* star\n+ plus\n\n3. three\n4. four\n',
				'CRLF\r\n\r\n- item\r\n',
				'no final line break'
			]) {
				const editor = new BaseHalfNoteTestEditor();
				const projection = await buildBaseHalfMarkdownLoadProjection(editor, body);
				assert.strictEqual(await save(editor, projection), body, body);
				const contributions = await collectBaseHalfMarkdownSaveContributions(editor, projection.blocks, projection.byId, projection.note);
				assert.strictEqual(contributions.map(contribution => contribution.text).join(''), body, body);
			}
		});

		test('a block Rich cannot write so that it shows the same is a fixed block, with an id and its bytes', async () => {
			const editor = new BaseHalfNoteTestEditor();
			const projection = await buildBaseHalfMarkdownLoadProjection(editor, '[a](u "T")\n\nplain\n');

			const fixed = projection.blocks[0] as { id: string; type: string; props: unknown };
			assert.strictEqual(fixed.type, BASEHALF_RAW_PASSTHROUGH_BLOCK);
			assert.deepStrictEqual(fixed.props, { raw: '[a](u "T")\n\n', source: '[a](u "T")', hidden: false });
			assert.strictEqual(projection.byId.get(fixed.id)?.fixed, true);
			assert.strictEqual(typeOf(projection.blocks[1]), 'paragraph');
			assert.strictEqual(await save(editor, projection), '[a](u "T")\n\nplain\n');
		});

		test('a comment of BaseHalf alone is a hidden fixed block, with a paragraph to type into', async () => {
			const projection = await buildBaseHalfMarkdownLoadProjection(new BaseHalfNoteTestEditor(), '<!-- bh:workspace-hint -->\n');

			assert.deepStrictEqual(projection.blocks.map(typeOf), [BASEHALF_RAW_PASSTHROUGH_BLOCK, 'paragraph']);
			assert.strictEqual((projection.blocks[0] as { props: { hidden: boolean } }).props.hidden, true);
		});

		test('a part that cannot be read or written is a fixed block, and the rest of the note loads', async () => {
			const unreadable = new BaseHalfNoteTestEditor({ failRead: markdown => markdown.startsWith('bad') });
			const read = await buildBaseHalfMarkdownLoadProjection(unreadable, 'good\n\nbad\n\ngood too\n');
			assert.deepStrictEqual(read.blocks.map(typeOf), ['paragraph', BASEHALF_RAW_PASSTHROUGH_BLOCK, 'paragraph']);
			assert.strictEqual(await save(unreadable, read), 'good\n\nbad\n\ngood too\n');

			const unwritable = new BaseHalfNoteTestEditor({ failWrite: block => JSON.stringify(block).includes('"bad"') });
			const written = await buildBaseHalfMarkdownLoadProjection(unwritable, 'good\n\nbad\n\ngood too\n');
			assert.deepStrictEqual(written.blocks.map(typeOf), ['paragraph', BASEHALF_RAW_PASSTHROUGH_BLOCK, 'paragraph']);
		});

		test('a block the writer cannot write at a save keeps the bytes it stood for', async () => {
			let fail = false;
			const editor = new BaseHalfNoteTestEditor({ failWrite: block => fail && JSON.stringify(block).includes('"Beta"') });
			const projection = await buildBaseHalfMarkdownLoadProjection(editor, 'Alpha\n\nBeta\n');
			fail = true;
			const document = [withText(projection.blocks[0], 'Alpha!'), projection.blocks[1]];

			assert.strictEqual(await save(editor, projection, document), 'Alpha!\n\nBeta\n');
		});

		test('an edit changes the bytes of its block alone', async () => {
			const editor = new BaseHalfNoteTestEditor();
			const projection = await buildBaseHalfMarkdownLoadProjection(editor, 'Alpha  \n\nBeta\n');

			assert.strictEqual(await save(editor, projection, [projection.blocks[0], withText(projection.blocks[1], 'Beta changed')]), 'Alpha  \n\nBeta changed\n');
		});

		test('a change of format alone is saved', async () => {
			const editor = new BaseHalfNoteTestEditor();
			const projection = await buildBaseHalfMarkdownLoadProjection(editor, 'word\n');
			const underlined = { ...(projection.blocks[0] as object), content: [{ type: 'text', text: 'word', styles: { underline: true } }] };

			assert.strictEqual(await save(editor, projection, [underlined]), '<u>word</u>\n');
		});

		test('a block that changes its kind is set apart from its neighbours (rule 67)', async () => {
			const editor = new BaseHalfNoteTestEditor();
			const list = await buildBaseHalfMarkdownLoadProjection(editor, '- a\n- b\n- c\n');
			const paragraph = { ...(list.blocks[1] as object), type: 'paragraph', props: {} };
			assert.strictEqual(await save(editor, list, [list.blocks[0], paragraph, list.blocks[2]]), '- a\n\nb\n\n- c\n');

			const heading = await buildBaseHalfMarkdownLoadProjection(editor, '# Title\nFirst line.');
			const title = { ...(heading.blocks[0] as object), type: 'paragraph', props: {} };
			assert.strictEqual(await save(editor, heading, [title, heading.blocks[1]]), 'Title\n\nFirst line.');
		});

		test('neighbours that stay keep the line breaks the file has between them', async () => {
			for (const head of ['Steps:\n- one\n', '# Title\nFirst\n', '- a\n- [ ] b\n', 'text\n```sh\nls\n```\n']) {
				const editor = new BaseHalfNoteTestEditor();
				const projection = await buildBaseHalfMarkdownLoadProjection(editor, `${head}\nend\n`);
				const document = [...projection.blocks];
				document[document.length - 1] = withText(document[document.length - 1], 'end!');

				assert.strictEqual(await save(editor, projection, document), `${head}\nend!\n`, head);
			}
		});

		test('a new block gets the line breaks Markdown needs around it', async () => {
			const editor = new BaseHalfNoteTestEditor();
			const projection = await buildBaseHalfMarkdownLoadProjection(editor, 'Para one\n\nPara two\n');
			const bullet = { id: 'new', type: 'bulletListItem', props: {}, content: [{ type: 'text', text: 'x', styles: {} }], children: [] };

			assert.strictEqual(await save(editor, projection, [projection.blocks[0], bullet, projection.blocks[1]]), 'Para one\n\n- x\n\nPara two\n');
			assert.strictEqual(await save(editor, projection, [...projection.blocks, bullet]), 'Para one\n\nPara two\n\n- x\n');
		});

		test('a new list item takes the marker of the item before it', async () => {
			const editor = new BaseHalfNoteTestEditor();
			const projection = await buildBaseHalfMarkdownLoadProjection(editor, '* a\n');
			const item = { id: 'new', type: 'bulletListItem', props: {}, content: [{ type: 'text', text: 'b', styles: {} }], children: [] };

			assert.strictEqual(await save(editor, projection, [...projection.blocks, item]), '* a\n* b\n');
		});

		test('a block moved to the end keeps its own line, and the note ends with one line break', async () => {
			const editor = new BaseHalfNoteTestEditor();
			const projection = await buildBaseHalfMarkdownLoadProjection(editor, 'A\n\nB\n\nC');
			const [a, b, c] = projection.blocks;

			assert.strictEqual(await save(editor, projection, [b, c, a]), 'B\n\nC\n\nA\n');
			assert.strictEqual(await save(editor, projection, [a, b, c]), 'A\n\nB\n\nC');
		});

		test('a list keeps its items one line apart when one of them goes', async () => {
			const editor = new BaseHalfNoteTestEditor();
			const projection = await buildBaseHalfMarkdownLoadProjection(editor, '- a\n- b\n- c\n');

			assert.strictEqual(await save(editor, projection, [projection.blocks[0], projection.blocks[2]]), '- a\n- c\n');
		});

		test('a fixed block pasted or copied within the note stands for its source', async () => {
			const editor = new BaseHalfNoteTestEditor();
			const projection = await buildBaseHalfMarkdownLoadProjection(editor, '[a](u "T")\n\nplain\n');
			const copy = { ...(projection.blocks[0] as object), id: 'copy' };

			assert.strictEqual(await save(editor, projection, [...projection.blocks, copy]), '[a](u "T")\n\nplain\n\n[a](u "T")\n');
		});

		test('new blocks of a CRLF note get CRLF line breaks', async () => {
			const editor = new BaseHalfNoteTestEditor();
			const projection = await buildBaseHalfMarkdownLoadProjection(editor, 'A\r\n\r\nB\r\n');
			const paragraph = { id: 'new', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'C', styles: {} }], children: [] };

			assert.strictEqual(await save(editor, projection, [...projection.blocks, paragraph]), 'A\r\n\r\nB\r\n\r\nC\r\n');
		});

		test('an empty paragraph stores nothing', async () => {
			const editor = new BaseHalfNoteTestEditor();
			const projection = await buildBaseHalfMarkdownLoadProjection(editor, 'A\n\nB\n');
			const empty = { id: 'empty', type: 'paragraph', props: {}, content: [], children: [] };

			assert.strictEqual(await save(editor, projection, [projection.blocks[0], empty, projection.blocks[1]]), 'A\n\nB\n');
		});

		test('keeps frontmatter fences separated from newly written body content', async () => {
			const editor = new BaseHalfNoteTestEditor();
			const paragraph = { id: 'a', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'hello', styles: {} }], children: [] };

			assert.strictEqual(await spliceBaseHalfMarkdownSave(editor, [paragraph], '---\nk: v\n---', new Map()), '---\nk: v\n---\nhello\n');
			assert.strictEqual(await spliceBaseHalfMarkdownSave(editor, [paragraph], '---\r\nk: v\r\n---', new Map()), '---\r\nk: v\r\n---\r\nhello\n');
		});

		test('the note keeps what the file wrote of its list items, and the blocks carry none of it', async () => {
			const editor = new BaseHalfNoteTestEditor();
			const projection = await buildBaseHalfMarkdownLoadProjection(editor, '3. three\n4. four\n');

			assert.deepStrictEqual([...projection.note.listHints.values()].map(hint => hint.marker), ['3.', '4.']);
			assert.ok(projection.blocks.every(block => (block as { basehalfHints?: unknown }).basehalfHints === undefined));
			const renumbered = { ...(projection.blocks[1] as object), content: [{ type: 'text', text: 'four!', styles: {} }] };
			assert.strictEqual(await save(editor, projection, [projection.blocks[0], renumbered]), '3. three\n4. four!\n');
		});

		suite('a toggle whose parts are blocks of their own (rules 41 to 43)', () => {
			const loose = '<details>\n<summary>Title</summary>\n\nchild one\n\nchild two\n\n</details>\n\nafter\n';
			const childrenOf = (block: unknown) => (block as { children: unknown[] }).children;

			test('is one toggle holding its blocks, and is saved byte for byte', async () => {
				const editor = new BaseHalfNoteTestEditor();
				const projection = await buildBaseHalfMarkdownLoadProjection(editor, loose);

				assert.deepStrictEqual(projection.blocks.map(typeOf), ['toggleListItem', 'paragraph']);
				assert.strictEqual(childrenOf(projection.blocks[0]).length, 2);
				assert.ok(projection.byId.get(idOf(projection.blocks[0]))?.toggle);
				assert.strictEqual(await save(editor, projection), loose);
			});

			test('an edit of one child changes that child alone', async () => {
				const editor = new BaseHalfNoteTestEditor();
				const projection = await buildBaseHalfMarkdownLoadProjection(editor, loose);
				const toggle = projection.blocks[0] as { children: unknown[] };
				const edited = { ...toggle, children: [toggle.children[0], withText(toggle.children[1], 'child two!')] };

				assert.strictEqual(await save(editor, projection, [edited, projection.blocks[1]]), loose.replace('child two', 'child two!'));
			});

			test('a new last child and a new title keep the toggle together', async () => {
				const editor = new BaseHalfNoteTestEditor();
				const projection = await buildBaseHalfMarkdownLoadProjection(editor, loose);
				const toggle = projection.blocks[0] as { children: unknown[]; content: unknown };
				const third = { id: 'third', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'child three', styles: {} }], children: [] };

				assert.strictEqual(
					await save(editor, projection, [{ ...toggle, children: [...toggle.children, third] }, projection.blocks[1]]),
					'<details>\n<summary>Title</summary>\n\nchild one\n\nchild two\n\nchild three\n\n</details>\n\nafter\n'
				);
				assert.strictEqual(
					await save(editor, projection, [{ ...toggle, content: [{ type: 'text', text: 'New', styles: {} }] }, projection.blocks[1]]),
					loose.replace('Title', 'New')
				);
			});

			test('a toggle stored open keeps open, and is saved byte for byte', async () => {
				const editor = new BaseHalfNoteTestEditor();
				const body = '<details open>\n<summary>Open</summary>\n\ninside\n\n</details>\n';
				const projection = await buildBaseHalfMarkdownLoadProjection(editor, body);
				const toggle = projection.blocks[0] as { children: unknown[] };

				assert.ok(projection.note.open.has(idOf(toggle)));
				assert.strictEqual(await save(editor, projection), body);
				assert.strictEqual(await save(editor, projection, [{ ...toggle, children: [withText(toggle.children[0], 'inside!')] }]), body.replace('inside', 'inside!'));
			});

			test('two toggles on lines one after the other are two toggles', async () => {
				const editor = new BaseHalfNoteTestEditor();
				const body = '<details>\n<summary>Q1</summary>\n\nA1\n\n</details>\n<details>\n<summary>Q2</summary>\n\nA2\n\n</details>\n';
				const projection = await buildBaseHalfMarkdownLoadProjection(editor, body);

				assert.deepStrictEqual(projection.blocks.map(typeOf), ['toggleListItem', 'toggleListItem']);
				assert.strictEqual(await save(editor, projection), body);
			});

			test('a toggle Rich cannot read as one is read as its parts, as before', async () => {
				for (const body of [
					'<details class="x">\n<summary>Title</summary>\n\nchild\n\n</details>\n',
					'<details>\n<summary>Title</summary>\n\nchild\n',
					'<details>\n<summary>Title</summary>\n\nchild\n\n</details> trailing\n'
				]) {
					const editor = new BaseHalfNoteTestEditor();
					const projection = await buildBaseHalfMarkdownLoadProjection(editor, body);

					assert.ok(projection.blocks.every(block => typeOf(block) !== 'toggleListItem'), body);
					assert.ok(projection.blocks.some(block => typeOf(block) === 'paragraph'), body);
					assert.strictEqual(await save(editor, projection), body, body);
				}
			});

			test('the parts of a toggle\'s contribution give each child its own lines', async () => {
				const editor = new BaseHalfNoteTestEditor();
				const projection = await buildBaseHalfMarkdownLoadProjection(editor, loose);
				const [toggle] = await collectBaseHalfMarkdownSaveContributions(editor, projection.blocks, projection.byId, projection.note);
				const children = childrenOf(projection.blocks[0]);

				assert.deepStrictEqual(toggle.parts?.map(part => part.id), [idOf(projection.blocks[0]), idOf(children[0]), idOf(children[1]), undefined]);
				assert.strictEqual(toggle.parts?.map(part => part.text).join(''), toggle.text);
				assert.strictEqual(toggle.parts?.[3].text, '</details>\n\n');
			});
		});

		test('a document that holds the projection under other ids is adopted', async () => {
			const editor = new BaseHalfNoteTestEditor();
			const projection = await buildBaseHalfMarkdownLoadProjection(editor, '1) one\n2) two\n\ntext\n');
			const held = projection.blocks.map((block, index) => ({ ...(block as object), id: `held-${index}` }));

			const adopted = adoptBaseHalfMarkdownLoadProjection(editor, held, projection);
			assert.ok(adopted);
			assert.deepStrictEqual([...adopted.byId.keys()], ['held-0', 'held-1', 'held-2']);
			assert.strictEqual(await spliceBaseHalfMarkdownSave(editor, held, '', adopted.byId, adopted.note), '1) one\n2) two\n\ntext\n');
			assert.strictEqual(adoptBaseHalfMarkdownLoadProjection(editor, [held[0], withText(held[1], 'other'), held[2]], projection), undefined);
			assert.strictEqual(adoptBaseHalfMarkdownLoadProjection(editor, held.slice(1), projection), undefined);
			assert.deepStrictEqual(projection.blocks.map(idOf), [...projection.byId.keys()]);
		});
	});
});
