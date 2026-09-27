/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	baseHalfCanvasConnectionSummary,
	baseHalfCanvasDeleteImpact,
	baseHalfCanvasResolveSiblingUpstream,
	baseHalfNodeUpstreamWithSourceChanges,
	baseHalfOrderUpstreamPickerCandidates,
	baseHalfUniqueUpstreamNameMatch,
	baseHalfUpstreamEntryMessage,
	IBaseHalfUpstreamPickerCandidate
} from '../../common/basehalfCanvasUpstream.js';
import { IBaseHalfUpstreamIdentity } from '../../common/basehalfReferenceEntries.js';
import { IBaseHalfIndexedStore } from '../../common/basehalfReferenceIndex.js';
import { readBaseHalfMarkdownUpstream } from '../../common/basehalfReferenceStore.js';

const CASE_INSENSITIVE: IBaseHalfUpstreamIdentity = { key: path => path.normalize('NFC').toLowerCase() };

suite('BaseHalfCanvasUpstream', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('orders picker candidates: canvas cards, then the folders above the node and their children, then the rest by path', () => {
		const candidates: IBaseHalfUpstreamPickerCandidate[] = [
			'z.md', 'sources', 'sources/book.pdf', 'a', 'a/overview.md', 'a/b', 'a/b/sibling.md', 'a/b/card.md', 'a/c.md', 'm/deep.md', 'm'
		].map(path => ({ path, kind: path.includes('.') ? 'file' : 'folder' }));

		assert.deepStrictEqual(
			baseHalfOrderUpstreamPickerCandidates(candidates, 'a/b/note.md', ['a/b/card.md', 'missing.md']).map(candidate => candidate.path),
			[
				// Cards on the current canvas first.
				'a/b/card.md',
				// The nearest folder above, then its children.
				'a/b', 'a/b/sibling.md',
				// The next folder up, then its children.
				'a', 'a/c.md', 'a/overview.md',
				// Root children.
				'm', 'sources', 'z.md',
				// Everything else by path.
				'm/deep.md', 'sources/book.pdf'
			]
		);
	});

	test('suggests Relink to <path> only when exactly one node has the entry\'s file name', () => {
		const candidates: IBaseHalfUpstreamPickerCandidate[] = [
			{ path: 'notes/brief.md', kind: 'file' },
			{ path: 'a/dup.md', kind: 'file' },
			{ path: 'b/dup.md', kind: 'file' }
		];
		assert.deepStrictEqual([
			baseHalfUniqueUpstreamNameMatch('old/brief.md', candidates)?.path,
			baseHalfUniqueUpstreamNameMatch('dup.md', candidates)?.path,
			baseHalfUniqueUpstreamNameMatch('gone.md', candidates)?.path
		], ['notes/brief.md', undefined, undefined]);
	});

	test('summarizes connections with issues, loading, and partial states', () => {
		assert.deepStrictEqual([
			baseHalfCanvasConnectionSummary({ upstream: 2, downstream: 1, issues: 0 }),
			baseHalfCanvasConnectionSummary({ upstream: 0, downstream: 3, issues: 1 }),
			baseHalfCanvasConnectionSummary({ upstream: 1, downstream: 0, issues: 2, incomplete: true }),
			baseHalfCanvasConnectionSummary({ upstream: 1, downstream: undefined, issues: 0 })
		], [
			'↑2 upstream · ↓1 downstream',
			'↑0 upstream · ↓3 downstream · 1 issue',
			'↑1 upstream · ↓0 downstream (incomplete) · 2 issues',
			'Loading…'
		]);
	});

	test('explains dangling, historical, and invalid rows without the word reference', () => {
		const messages = [
			baseHalfUpstreamEntryMessage({ status: 'dangling', problem: undefined, historical: false }),
			baseHalfUpstreamEntryMessage({ status: 'dangling', problem: undefined, historical: true }),
			baseHalfUpstreamEntryMessage({ status: 'invalid', problem: 'metadata', historical: false }),
			baseHalfUpstreamEntryMessage({ status: 'invalid', problem: 'empty', historical: false })
		];
		assert.strictEqual(messages[1], 'Moved or deleted since this result was made');
		assert.ok(messages.every(message => message.length > 0 && !/reference/i.test(message)));
	});

	test('resolves entry spelling to sibling card paths by identity', () => {
		assert.deepStrictEqual(
			baseHalfCanvasResolveSiblingUpstream(['Brief.md', 'brief.md', 'docs/far.md'], ['brief.md', 'other.md'], CASE_INSENSITIVE),
			['brief.md', 'docs/far.md']
		);
	});

	test('finds the downstream stores that name deleted items, leaving historical inputs and deleted stores alone', () => {
		const stores: IBaseHalfIndexedStore[] = [
			markdownStore('notes/a.md', ['book.pdf', 'other.md']),
			markdownStore('notes/b.md', ['src', 'src/inner.md', 'book.pdf']),
			// Inside a deleted folder: it goes away with the folder.
			markdownStore('src/inside.md', ['book.pdf']),
			// A sealed node keeps its bound input as history; its unbound entry is removable.
			{
				...markdownStore('video.bhnode', ['book.pdf', 'src/inner.md']),
				storeKind: 'node',
				lifecycle: 'sealed',
				bindings: [{ sourcePath: 'book.pdf', slot: 'reference', order: 0 }]
			},
			// An inactive sidecar contributes nothing.
			{ ...markdownStore('folder', ['book.pdf']), storeKind: 'sidecar', sidecarState: 'missingNode' }
		];
		assert.deepStrictEqual(
			baseHalfCanvasDeleteImpact(stores, ['book.pdf', 'src']).map(store => ({ node: store.node.relativePath, entries: store.entries.map(entry => entry.path) })),
			[
				{ node: 'notes/a.md', entries: ['book.pdf'] },
				{ node: 'notes/b.md', entries: ['src', 'src/inner.md', 'book.pdf'] },
				{ node: 'video.bhnode', entries: ['src/inner.md'] }
			]
		);
	});

	test('updates a node upstream list in place for Composer picks, replacements, and removals', () => {
		const upstream = ['brief.md', { note: 'kept verbatim' }, 'Frame.png', 'old.png'];
		assert.deepStrictEqual(
			// Replace old.png with new.png; pick brief.md again (already listed) and frame.png (listed with other case).
			baseHalfNodeUpstreamWithSourceChanges(upstream, ['old.png'], ['new.png', 'brief.md', 'frame.png'], CASE_INSENSITIVE),
			['brief.md', { note: 'kept verbatim' }, 'Frame.png', 'new.png']
		);
	});

	function markdownStore(relativePath: string, entries: readonly string[]): IBaseHalfIndexedStore {
		const text = `---\nupstream:\n${entries.map(entry => `  - ${entry}`).join('\n')}\n---\n`;
		const resource = URI.file(`/workspace/${relativePath}`);
		return {
			node: { resource, workspaceFolder: URI.file('/workspace'), relativePath },
			storeKind: 'markdown',
			storeResource: resource,
			read: readBaseHalfMarkdownUpstream(text, { nodePath: relativePath })
		};
	}
});
