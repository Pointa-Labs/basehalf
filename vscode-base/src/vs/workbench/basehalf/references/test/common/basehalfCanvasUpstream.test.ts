/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	baseHalfCanvasConnectionSummary,
	baseHalfCanvasDeleteImpact,
	baseHalfCanvasResolveSiblingUpstream,
	baseHalfOrderUpstreamPickerCandidates,
	baseHalfUniqueUpstreamNameMatch,
	baseHalfUpstreamEntryMessage,
	baseHalfUpstreamStoreProblemMessage,
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

	test('explains dangling and invalid rows without the word reference', () => {
		const messages = [
			baseHalfUpstreamEntryMessage({ status: 'dangling', problem: undefined }),
			baseHalfUpstreamEntryMessage({ status: 'invalid', problem: 'metadata' }),
			baseHalfUpstreamEntryMessage({ status: 'invalid', problem: 'empty' })
		];
		assert.strictEqual(messages[0], 'Nothing at this path. It was moved or deleted.');
		assert.ok(messages.every(message => message.length > 0 && !/reference/i.test(message)));
	});

	test('states every store and entry problem without code words', () => {
		const storeProblems = ['mappingValue', 'duplicateKey', 'anchorAliasTag', 'blockScalar', 'invalidDocument', 'foreignValue', 'frontmatterRejected', 'tomlFrontmatter', 'mappingNotBlock', 'frontmatterBeyondWindow', 'multilineItem', undefined] as const;
		const entryProblems = ['empty', 'notScalar', 'notString', 'absolute', 'backslash', 'controlCharacter', 'invalidSegment', 'metadata', 'self', 'duplicate', 'overLimit', undefined] as const;
		const messages = [
			...(['markdown', 'sidecar'] as const).flatMap(storeKind => storeProblems.map(problem => baseHalfUpstreamStoreProblemMessage(storeKind, problem))),
			baseHalfUpstreamStoreProblemMessage('sidecar', undefined, 'permission denied'),
			...entryProblems.map(problem => baseHalfUpstreamEntryMessage({ status: 'invalid', problem }))
		];
		assert.deepStrictEqual(messages.filter(message => message === '' || /`|frontmatter|yaml|toml|json|metadata|sidecar|\.bh|\bkey\b|mapping|anchor|alias|scalar/i.test(message)), []);
		assert.deepStrictEqual({
			unreadableSidecar: baseHalfUpstreamStoreProblemMessage('sidecar', 'invalidDocument'),
			foreign: baseHalfUpstreamStoreProblemMessage('markdown', 'foreignValue'),
			readButNotEditable: [baseHalfUpstreamStoreProblemMessage('markdown', 'multilineItem'), baseHalfUpstreamStoreProblemMessage('sidecar', 'mappingNotBlock')],
			blockEntries: baseHalfUpstreamStoreProblemMessage('sidecar', 'frontmatterRejected'),
			notEditable: baseHalfUpstreamStoreProblemMessage('markdown', 'tomlFrontmatter'),
			readError: baseHalfUpstreamStoreProblemMessage('sidecar', undefined, 'permission denied')
		}, {
			unreadableSidecar: 'BaseHalf can\'t read this upstream list.',
			foreign: 'Another tool keeps something else where this upstream list goes.',
			// Their entries are read and shown; only editing in place is refused.
			readButNotEditable: new Array(2).fill('BaseHalf can\'t change this upstream list the way it is written.'),
			blockEntries: 'The connections written at the top of this note are not in use.',
			notEditable: 'BaseHalf can\'t save connections into this note because of how the file begins.',
			readError: 'The upstream list could not be read: permission denied'
		});
	});

	test('resolves entry spelling to sibling card paths by identity', () => {
		assert.deepStrictEqual(
			baseHalfCanvasResolveSiblingUpstream(['Brief.md', 'brief.md', 'docs/far.md'], ['brief.md', 'other.md'], CASE_INSENSITIVE),
			['brief.md', 'docs/far.md']
		);
	});

	test('finds the downstream stores that name deleted items, generation cards included, leaving deleted stores alone', () => {
		const stores: IBaseHalfIndexedStore[] = [
			markdownStore('notes/a.md', ['book.pdf', 'other.md']),
			markdownStore('notes/b.md', ['src', 'src/inner.md', 'book.pdf']),
			// Inside a deleted folder: it goes away with the folder.
			markdownStore('src/inside.md', ['book.pdf']),
			// A generation card's entries are removed whatever its phase.
			{ ...markdownStore('shots/video.mp4', ['book.pdf', 'src/inner.md']), storeKind: 'sidecar', sidecarState: 'active' },
			// An inactive sidecar contributes nothing.
			{ ...markdownStore('folder', ['book.pdf']), storeKind: 'sidecar', sidecarState: 'missingNode' }
		];
		assert.deepStrictEqual(
			baseHalfCanvasDeleteImpact(stores, ['book.pdf', 'src']).map(store => ({ node: store.node.relativePath, entries: store.entries.map(entry => entry.path) })),
			[
				{ node: 'notes/a.md', entries: ['book.pdf'] },
				{ node: 'notes/b.md', entries: ['src', 'src/inner.md', 'book.pdf'] },
				{ node: 'shots/video.mp4', entries: ['book.pdf', 'src/inner.md'] }
			]
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
