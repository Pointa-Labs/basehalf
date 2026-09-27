/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { splitBaseHalfMarkdownFrontmatter } from '../../common/basehalfMarkdownProjection.js';
import {
	baseHalfTransitionChangesUpstream,
	BaseHalfUpstreamListOperation,
	BaseHalfUpstreamTextPlan,
	baseHalfUpstreamStoreKind,
	isBaseHalfUpstreamReservedOutput,
	planBaseHalfMarkdownUpstreamEdit,
	planBaseHalfSidecarUpstreamEdit,
	readBaseHalfMarkdownUpstream,
	readBaseHalfSidecarUpstream
} from '../../common/basehalfReferenceStore.js';

function planText(plan: BaseHalfUpstreamTextPlan): string {
	if (plan.kind !== 'edit') {
		throw new Error(`Expected an edit plan, got ${JSON.stringify(plan)}`);
	}
	const before = plan.text.length - plan.edit.text.length + plan.edit.length;
	assert.ok(before >= 0);
	return plan.text;
}

function markdown(text: string, operation: BaseHalfUpstreamListOperation, nodePath = 'note.md'): string {
	const plan = planBaseHalfMarkdownUpstreamEdit(text, operation, { nodePath });
	const next = planText(plan);
	if (plan.kind === 'edit') {
		// The single minimal edit reproduces the planned text.
		assert.strictEqual(text.slice(0, plan.edit.offset) + plan.edit.text + text.slice(plan.edit.offset + plan.edit.length), next);
	}
	return next;
}

function entries(text: string, nodePath = 'note.md'): (string | null)[] {
	return readBaseHalfMarkdownUpstream(text, { nodePath }).items.map(item => item.path ?? null);
}

suite('BaseHalfReferenceStore', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	suite('Markdown reader', () => {
		test('reads block, flow, scalar, empty, and null values from source text', () => {
			assert.deepStrictEqual([
				entries('---\nupstream:\n  - a.md\n  - "b, c.md"\n  - \'d.md\'\n  - 2024\n---\n'),
				entries('---\nupstream: [a.md, "b.md"]\n---\n'),
				entries('---\nupstream: a.md\n---\n'),
				entries('---\nupstream:\n---\n'),
				entries('---\nupstream: ~\n---\n'),
				entries('---\nupstream: null\n---\n'),
				entries('---\nupstream: NULL\n---\n'),
				entries('---\nupstream: []\n---\n'),
				entries('---\nupstream:\n  - "null"\n  - true\n---\n'),
				entries('---\nupstream:\n  - docs/\n---\n'),
				entries('# no frontmatter\n')
			], [
				['a.md', 'b, c.md', 'd.md', '2024'],
				['a.md', 'b.md'],
				['a.md'],
				[],
				[],
				[],
				[],
				[],
				['null', 'true'],
				['docs'],
				[]
			]);
		});

		test('accepts an upstream key with no value and keeps the block recognized', () => {
			const text = '---\ntitle: Note\nupstream:\n---\n# Body\n';
			assert.deepStrictEqual(splitBaseHalfMarkdownFrontmatter(text), { frontmatter: '---\ntitle: Note\nupstream:\n---\n', body: '# Body\n' });
			assert.deepStrictEqual(readBaseHalfMarkdownUpstream(text), { readable: true, writable: true, items: [], hasKey: true, issue: false });
		});

		test('makes aliases, anchors, tags, duplicate keys, mapping values, and block scalars unreadable', () => {
			const read = (text: string) => {
				const result = readBaseHalfMarkdownUpstream(text);
				return [result.readable, result.writable, result.problem, result.issue, result.items.length];
			};
			assert.deepStrictEqual([
				read('---\nupstream: *a\n---\n'),
				read('---\nupstream: &a x.md\n---\n'),
				read('---\nupstream: !tag x.md\n---\n'),
				read('---\nupstream:\n  - *a\n  - b.md\n---\n'),
				read('---\nupstream: a.md\nupstream: b.md\n---\n'),
				read('---\nupstream:\n  key: value\n---\n'),
				read('---\nupstream: {a: b}\n---\n'),
				read('---\nupstream: |\n  a.md\n---\n'),
				read('---\nupstream: >\n  a.md\n---\n')
			], [
				[false, false, 'anchorAliasTag', true, 0],
				[false, false, 'anchorAliasTag', true, 0],
				[false, false, 'anchorAliasTag', true, 0],
				[false, false, 'anchorAliasTag', true, 0],
				[false, false, 'duplicateKey', true, 0],
				[false, false, 'mappingValue', true, 0],
				[false, false, 'mappingValue', true, 0],
				[false, false, 'blockScalar', true, 0],
				[false, false, 'blockScalar', true, 0]
			]);
		});

		test('reports `- ~` as one invalid entry and keeps the others valid', () => {
			const result = readBaseHalfMarkdownUpstream('---\nupstream:\n  - a.md\n  - ~\n  - [x]\n  - note.md\n  - b.md\n  - a.md\n---\n', { nodePath: 'note.md' });
			assert.deepStrictEqual(result.items.map(item => [item.text, item.path ?? null, item.problem ?? null]), [
				['a.md', 'a.md', null],
				['~', null, 'empty'],
				['[x]', null, 'notScalar'],
				['note.md', null, 'self'],
				['b.md', 'b.md', null],
				['a.md', null, 'duplicate']
			]);
			assert.strictEqual(result.readable, true);
		});

		test('reports a single invalid scalar as a value used by another tool', () => {
			const result = readBaseHalfMarkdownUpstream('---\nupstream: https://example.com/feed\n---\n');
			assert.deepStrictEqual([result.readable, result.writable, result.problem, result.issue], [false, false, 'foreignValue', true]);
			assert.deepStrictEqual(planBaseHalfMarkdownUpstreamEdit('---\nupstream: /abs/feed\n---\n', { kind: 'add', entry: 'a.md' }), { kind: 'refused', reason: 'foreignValue' });
		});

		test('shows a thematic-break note without an issue and refuses to connect into it', () => {
			const breakNote = '---\nJust a quote.\n---\nBody\n';
			assert.deepStrictEqual(readBaseHalfMarkdownUpstream(breakNote), {
				readable: true, writable: false, items: [], hasKey: false, problem: 'frontmatterRejected', issue: false
			});
			assert.deepStrictEqual(planBaseHalfMarkdownUpstreamEdit(breakNote, { kind: 'add', entry: 'a.md' }), { kind: 'refused', reason: 'frontmatterRejected' });
			// Removing an entry that is not listed still succeeds without writing.
			assert.deepStrictEqual(planBaseHalfMarkdownUpstreamEdit(breakNote, { kind: 'remove', entry: 'a.md' }), { kind: 'noop' });

			const rejectedWithUpstream = '---\nupstream: [a.md\n---\nBody\n';
			assert.deepStrictEqual(readBaseHalfMarkdownUpstream(rejectedWithUpstream).issue, true);
			const toml = '+++\nupstream = ["a.md"]\n+++\nBody\n';
			assert.deepStrictEqual([readBaseHalfMarkdownUpstream(toml).problem, readBaseHalfMarkdownUpstream(toml).issue], ['tomlFrontmatter', false]);
			assert.deepStrictEqual(readBaseHalfMarkdownUpstream('+++\nupstream: x\n+++\n').issue, true);
		});

		test('treats a fence that closes beyond 64 KiB as no frontmatter and refuses writes', () => {
			const large = `---\ntitle: x\nnotes: ${'y'.repeat(70 * 1024)}\n---\nBody\n`;
			assert.deepStrictEqual(readBaseHalfMarkdownUpstream(large), {
				readable: true, writable: false, items: [], hasKey: false, problem: 'frontmatterBeyondWindow', issue: false
			});
			assert.deepStrictEqual(planBaseHalfMarkdownUpstreamEdit(large, { kind: 'add', entry: 'a.md' }), { kind: 'refused', reason: 'frontmatterBeyondWindow' });
			// The index reads only the first 64 KiB: no closing fence there means no frontmatter.
			assert.deepStrictEqual(readBaseHalfMarkdownUpstream(large.slice(0, 64 * 1024)).writable, true);
		});

		test('strips a leading BOM before recognition', () => {
			assert.deepStrictEqual(entries('\uFEFF---\r\nupstream:\r\n  - a.md\r\n---\r\n'), ['a.md']);
		});

		test('reads entries in a flow mapping but refuses to write them', () => {
			const text = '---\n{title: x, upstream: [a.md]}\n---\n';
			const result = readBaseHalfMarkdownUpstream(text);
			assert.deepStrictEqual([result.readable, result.writable, result.items.map(item => item.path)], [true, false, ['a.md']]);
			assert.deepStrictEqual(planBaseHalfMarkdownUpstreamEdit(text, { kind: 'add', entry: 'b.md' }), { kind: 'refused', reason: 'mappingNotBlock' });
		});
	});

	suite('Markdown planner', () => {
		test('inserts a frontmatter block into a document without one', () => {
			const plan = planBaseHalfMarkdownUpstreamEdit('# Title\n\nBody\n', { kind: 'add', entry: 'sources/book.pdf' });
			assert.deepStrictEqual(plan.kind === 'edit' && plan.createdFrontmatter, true);
			assert.strictEqual(planText(plan), '---\nupstream:\n  - sources/book.pdf\n---\n# Title\n\nBody\n');
			assert.strictEqual(markdown('', { kind: 'add', entry: 'a.md' }), '---\nupstream:\n  - a.md\n---\n');
			assert.strictEqual(markdown('\uFEFF# T\r\nBody\r\n', { kind: 'add', entry: 'a.md' }), '\uFEFF---\r\nupstream:\r\n  - a.md\r\n---\r\n# T\r\nBody\r\n');
			// A leading thematic break without a closing fence is body text.
			assert.strictEqual(markdown('---\nBody\n', { kind: 'add', entry: 'a.md' }), '---\nupstream:\n  - a.md\n---\n---\nBody\n');
		});

		test('inserts the key before the closing fence and keeps other keys, comments, and block scalars byte-exact', () => {
			const text = [
				'---',
				'title: "Kept"   # a comment',
				'# standalone comment',
				'tags: [a, b]',
				'summary: |',
				'  line one',
				'',
				'  line two',
				'---',
				'# Body',
				''
			].join('\n');
			const next = markdown(text, { kind: 'add', entry: '2024' });
			assert.strictEqual(next, text.replace('  line two\n---\n', '  line two\nupstream:\n  - "2024"\n---\n'));
			assert.deepStrictEqual(entries(next), ['2024']);
			assert.deepStrictEqual(splitBaseHalfMarkdownFrontmatter(next).body, '# Body\n');
			// Removing the only entry restores the original bytes.
			assert.strictEqual(markdown(next, { kind: 'remove', entry: '2024' }), text);
		});

		test('adds, removes, and replaces block list items line by line, keeping indent and comments', () => {
			const text = '---\ntitle: x\nupstream:\n    - a.md  # first\n    # between\n    - b.md\n---\nBody\n';
			assert.strictEqual(markdown(text, { kind: 'add', entry: 'c.md' }), '---\ntitle: x\nupstream:\n    - a.md  # first\n    # between\n    - b.md\n    - c.md\n---\nBody\n');
			assert.strictEqual(markdown(text, { kind: 'remove', entry: 'a.md' }), '---\ntitle: x\nupstream:\n    # between\n    - b.md\n---\nBody\n');
			assert.strictEqual(markdown(text, { kind: 'replace', from: 'a.md', to: 'z.md' }), '---\ntitle: x\nupstream:\n    - z.md  # first\n    # between\n    - b.md\n---\nBody\n');
			// Replacing with an entry that is already listed removes the source entry instead.
			assert.strictEqual(markdown(text, { kind: 'replace', from: 'a.md', to: 'b.md' }), '---\ntitle: x\nupstream:\n    # between\n    - b.md\n---\nBody\n');
			assert.strictEqual(markdown('---\nupstream:\n- a.md\n---\n', { kind: 'add', entry: 'b.md' }), '---\nupstream:\n- a.md\n- b.md\n---\n');
		});

		test('converts a single valid scalar or a flow list into a block list', () => {
			assert.strictEqual(markdown('---\nupstream: a.md # why\ntitle: x\n---\n', { kind: 'add', entry: 'b.md' }), '---\nupstream:\n  - a.md\n  - b.md # why\ntitle: x\n---\n');
			assert.strictEqual(markdown('---\nupstream: [a.md, "b.md"]\n---\n', { kind: 'add', entry: 'c.md' }), '---\nupstream:\n  - a.md\n  - b.md\n  - c.md\n---\n');
			assert.strictEqual(markdown('---\nupstream: [a.md, b.md]\n---\n', { kind: 'remove', entry: 'a.md' }), '---\nupstream:\n  - b.md\n---\n');
			assert.strictEqual(markdown('---\nupstream:  # later\ntitle: x\n---\n', { kind: 'add', entry: 'a.md' }), '---\nupstream:  # later\n  - a.md\ntitle: x\n---\n');
			assert.strictEqual(markdown('---\nupstream: ~\n---\n', { kind: 'add', entry: 'a.md' }), '---\nupstream:\n  - a.md\n---\n');
			assert.strictEqual(markdown('---\nupstream: []\ntitle: x\n---\n', { kind: 'add', entry: 'a.md' }), '---\nupstream:\n  - a.md\ntitle: x\n---\n');
		});

		test('quotes typed entries and reads them back as paths', () => {
			let text = '# T\n';
			for (const entry of ['2024', 'true', 'null', 'a, b', 'why?.md', 'a#b.md']) {
				text = markdown(text, { kind: 'add', entry });
			}
			assert.strictEqual(text, '---\nupstream:\n  - "2024"\n  - "true"\n  - "null"\n  - "a, b"\n  - why?.md\n  - a#b.md\n---\n# T\n');
			assert.deepStrictEqual(entries(text), ['2024', 'true', 'null', 'a, b', 'why?.md', 'a#b.md']);
		});

		test('removes the empty key when other keys remain and the empty block when nothing remains', () => {
			assert.strictEqual(markdown('---\ntitle: x\nupstream:\n  - a.md\ndate: y\n---\nBody\n', { kind: 'remove', entry: 'a.md' }), '---\ntitle: x\ndate: y\n---\nBody\n');
			assert.strictEqual(markdown('---\nupstream:\n  - a.md\n---\nBody\n', { kind: 'remove', entry: 'a.md' }), 'Body\n');
			assert.strictEqual(markdown('---\r\nupstream: [a.md]\r\n---\r\n', { kind: 'remove', entry: 'a.md' }), '');
			assert.strictEqual(markdown('\uFEFF---\nupstream: a.md\n\n---\nBody', { kind: 'remove', entry: 'a.md' }), '\uFEFFBody');
		});

		test('keeps a comment-only remainder byte-exact and writes `upstream: []`', () => {
			const text = '---\n# Keep this note\nupstream:\n  # sources\n  - a.md\n---\nBody\n';
			const next = markdown(text, { kind: 'remove', entry: 'a.md' });
			assert.strictEqual(next, '---\n# Keep this note\nupstream: []\n  # sources\n---\nBody\n');
			assert.deepStrictEqual(readBaseHalfMarkdownUpstream(next), { readable: true, writable: true, items: [], hasKey: true, issue: false });
			assert.strictEqual(markdown('---\nupstream: [a.md] # keep\n# note\n---\n', { kind: 'remove', entry: 'a.md' }), '---\nupstream: [] # keep\n# note\n---\n');
		});

		test('preserves CRLF line endings on every edit', () => {
			const text = '---\r\ntitle: x\r\nupstream:\r\n  - a.md\r\n---\r\nBody\r\n';
			assert.strictEqual(markdown(text, { kind: 'add', entry: 'b.md' }), '---\r\ntitle: x\r\nupstream:\r\n  - a.md\r\n  - b.md\r\n---\r\nBody\r\n');
			assert.strictEqual(markdown(text, { kind: 'remove', entry: 'a.md' }), '---\r\ntitle: x\r\n---\r\nBody\r\n');
			assert.strictEqual(markdown('---\r\ntitle: x\r\n---\r\n', { kind: 'add', entry: 'a.md' }), '---\r\ntitle: x\r\nupstream:\r\n  - a.md\r\n---\r\n');
		});

		test('is idempotent by identity', () => {
			const text = '---\nupstream:\n  - "docs"\n---\n';
			assert.deepStrictEqual([
				planBaseHalfMarkdownUpstreamEdit(text, { kind: 'add', entry: 'docs/' }),
				planBaseHalfMarkdownUpstreamEdit(text, { kind: 'add', entry: 'docs' }),
				planBaseHalfMarkdownUpstreamEdit(text, { kind: 'remove', entry: 'other.md' }),
				planBaseHalfMarkdownUpstreamEdit('# none\n', { kind: 'remove', entry: 'other.md' }),
				planBaseHalfMarkdownUpstreamEdit(text, { kind: 'replace', from: 'gone.md', to: 'docs' }),
				planBaseHalfMarkdownUpstreamEdit(text, { kind: 'replace', from: 'gone.md', to: 'new.md' })
			], [{ kind: 'noop' }, { kind: 'noop' }, { kind: 'noop' }, { kind: 'noop' }, { kind: 'noop' }, { kind: 'refused', reason: 'entryMissing' }]);
		});

		test('removes and replaces one positional item for issue rows', () => {
			const text = '---\nupstream:\n  - a.md\n  - ~\n  - ../b.md\n---\n';
			assert.strictEqual(markdown(text, { kind: 'removeAt', index: 1, expected: '~' }), '---\nupstream:\n  - a.md\n  - ../b.md\n---\n');
			assert.strictEqual(markdown(text, { kind: 'replaceAt', index: 2, expected: '../b.md', to: 'b.md' }), '---\nupstream:\n  - a.md\n  - ~\n  - b.md\n---\n');
			assert.deepStrictEqual(planBaseHalfMarkdownUpstreamEdit(text, { kind: 'removeAt', index: 1, expected: 'x' }), { kind: 'refused', reason: 'entryMissing' });
		});

		test('sets a whole list for undo and redo while keeping unchanged items verbatim', () => {
			const text = '---\nupstream:\n  - \'a.md\' # keep\n  - ~\n  - b.md\n---\n';
			const next = markdown(text, { kind: 'set', items: [{ text: 'a.md', scalar: true }, { text: '~', scalar: false }, { text: 'c.md', scalar: true }, { text: 'b.md', scalar: true }] });
			assert.strictEqual(next, '---\nupstream:\n  - \'a.md\' # keep\n  - ~\n  - c.md\n  - b.md\n---\n');
			assert.strictEqual(markdown(next, { kind: 'set', items: [{ text: 'a.md', scalar: true }, { text: '~', scalar: false }, { text: 'b.md', scalar: true }] }), text);
			assert.strictEqual(markdown(text, { kind: 'set', items: [{ text: 'z.md', scalar: true }] }), '---\nupstream:\n  - z.md\n---\n');
			assert.strictEqual(markdown(text, { kind: 'set', items: [] }), '');
		});
	});

	suite('Sidecar store', () => {
		test('creates, edits, and deletes an upstream.yaml with the Markdown value rules', () => {
			const created = planBaseHalfSidecarUpstreamEdit(undefined, { kind: 'add', entry: 'notes/a.md' }, { nodePath: 'book.pdf' });
			assert.strictEqual(planText(created), 'upstream:\n  - notes/a.md\n');
			assert.deepStrictEqual(readBaseHalfSidecarUpstream('upstream: [a.md, ~]\n', { nodePath: 'x' }).items.map(item => item.problem ?? item.path), ['a.md', 'empty']);
			assert.strictEqual(planText(planBaseHalfSidecarUpstreamEdit('# agent note\nupstream:\n  - a.md\n', { kind: 'add', entry: 'b.md' })), '# agent note\nupstream:\n  - a.md\n  - b.md\n');
			assert.deepStrictEqual(planBaseHalfSidecarUpstreamEdit('upstream:\n  - a.md\n', { kind: 'remove', entry: 'a.md' }), { kind: 'delete' });
			assert.strictEqual(planText(planBaseHalfSidecarUpstreamEdit('# keep\nupstream: [a.md]', { kind: 'remove', entry: 'a.md' })), '# keep\nupstream: []');
			assert.strictEqual(planText(planBaseHalfSidecarUpstreamEdit('extra: 1\nupstream:\n  - a.md', { kind: 'remove', entry: 'a.md' })), 'extra: 1\n');
			assert.strictEqual(planText(planBaseHalfSidecarUpstreamEdit('extra: 1', { kind: 'add', entry: 'a.md' })), 'extra: 1\nupstream:\n  - a.md\n');
		});

		test('reports an empty entry and an entry under .bh as invalid, and garbage as unreadable', () => {
			assert.deepStrictEqual(readBaseHalfSidecarUpstream('upstream:\n  - ""\n  - .bh/mirror/x\n  - ok.md\n').items.map(item => item.problem ?? 'valid'), ['empty', 'metadata', 'valid']);
			const garbage = readBaseHalfSidecarUpstream('upstream: [a.md\n');
			assert.deepStrictEqual([garbage.readable, garbage.problem], [false, 'invalidDocument']);
			assert.deepStrictEqual(readBaseHalfSidecarUpstream('- a.md\n').problem, 'invalidDocument');
		});
	});

	test('detects plugin transitions that change an upstream value, including a broken fence', () => {
		const note = '---\ntitle: x\nupstream:\n  - a.md\n---\nBody\n';
		const node = JSON.stringify({ version: 4, title: 'x', upstream: ['a.md'] });
		assert.deepStrictEqual([
			baseHalfTransitionChangesUpstream('n.md', note, note.replace('Body', 'New body')),
			baseHalfTransitionChangesUpstream('n.md', note, note.replace('title: x', 'title: y')),
			baseHalfTransitionChangesUpstream('n.md', note, note.replace('  - a.md\n', '  - b.md\n')),
			baseHalfTransitionChangesUpstream('n.md', note, note.replace('---\nBody', '--\nBody')),
			baseHalfTransitionChangesUpstream('n.md', note, note.replace('  - a.md', '  - *alias')),
			baseHalfTransitionChangesUpstream('n.md', note, undefined),
			baseHalfTransitionChangesUpstream('n.md', undefined, '# new\n'),
			baseHalfTransitionChangesUpstream('n.bhnode', node, node.replace('"x"', '"y"')),
			baseHalfTransitionChangesUpstream('n.bhnode', node, node.replace('a.md', 'b.md')),
			baseHalfTransitionChangesUpstream('n.bhnode', node, '{'),
			baseHalfTransitionChangesUpstream('image.png', 'a', 'b')
		], [false, false, true, true, true, true, false, false, true, true, false]);
	});

	test('chooses the store kind and upstream-only outputs', () => {
		assert.deepStrictEqual([
			baseHalfUpstreamStoreKind('a/Note.MD', false),
			baseHalfUpstreamStoreKind('a/n.markdown', false),
			baseHalfUpstreamStoreKind('clip.BHNODE', false),
			baseHalfUpstreamStoreKind('book.pdf', false),
			baseHalfUpstreamStoreKind('folder.md', true),
			isBaseHalfUpstreamReservedOutput('outputs/run/x.md'),
			isBaseHalfUpstreamReservedOutput('Outputs/x:y.md'),
			isBaseHalfUpstreamReservedOutput('notes/outputs/x.md')
		], ['markdown', 'markdown', 'node', 'sidecar', 'sidecar', true, true, false]);
	});
});
