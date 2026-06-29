/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import {
	BaseHalfMarkdownRichLiveDocumentRegistry,
	baseHalfMarkdownRichDocumentKey
} from '../../common/basehalfMarkdownRichLiveDocument.js';

suite('BaseHalfMarkdownRichLiveDocumentRegistry', () => {
	test('keys documents by workspace URI and relative path', () => {
		const first = baseHalfMarkdownRichDocumentKey(URI.file('/workspace-a'), 'notes/today.md');
		const sameRelativeDifferentWorkspace = baseHalfMarkdownRichDocumentKey(URI.file('/workspace-b'), 'notes/today.md');
		const differentRelativeSameWorkspace = baseHalfMarkdownRichDocumentKey(URI.file('/workspace-a'), 'notes/other.md');

		assert.notStrictEqual(first, sameRelativeDifferentWorkspace);
		assert.notStrictEqual(first, differentRelativeSameWorkspace);
		assert.ok(first.includes(String.fromCharCode(0)));
		assert.ok(first.startsWith(URI.file('/workspace-a').toString()));
	});

	test('reuses one Y.Doc and BlockNote fragment for every handle of a key', () => {
		const registry = new BaseHalfMarkdownRichLiveDocumentRegistry();
		const first = registry.acquire('workspace\u0000notes.md');
		const second = registry.acquire('workspace\u0000notes.md');

		assert.strictEqual(first.document, second.document);
		assert.strictEqual(first.document.doc.isDestroyed, false);
		assert.strictEqual(first.document.fragment, first.document.doc.getXmlFragment('bn'));
		assert.strictEqual(first.document.holdCount, 2);
		assert.strictEqual(registry.get('workspace\u0000notes.md'), first.document);

		first.dispose();
		second.dispose();
		registry.clear();
	});

	test('does not share documents across different scoped keys', () => {
		const registry = new BaseHalfMarkdownRichLiveDocumentRegistry();
		const first = registry.acquire('workspace-a\u0000notes.md');
		const second = registry.acquire('workspace-b\u0000notes.md');

		assert.notStrictEqual(first.document, second.document);
		assert.notStrictEqual(first.document.doc, second.document.doc);
		assert.notStrictEqual(first.document.fragment, second.document.fragment);

		first.dispose();
		second.dispose();
		registry.clear();
	});

	test('destroys a Y.Doc after the last handle is released', async () => {
		const registry = new BaseHalfMarkdownRichLiveDocumentRegistry();
		const handle = registry.acquire('workspace\u0000notes.md');
		const doc = handle.document.doc;
		let destroyEvents = 0;
		doc.on('destroy', () => destroyEvents++);

		handle.dispose();
		assert.strictEqual(registry.get('workspace\u0000notes.md'), handle.document);
		assert.strictEqual(doc.isDestroyed, false);

		await nextTick();
		assert.strictEqual(registry.get('workspace\u0000notes.md'), undefined);
		assert.strictEqual(doc.isDestroyed, true);
		assert.strictEqual(destroyEvents, 1);
	});

	test('cancels pending destroy when a document is reacquired in the same tick', async () => {
		const registry = new BaseHalfMarkdownRichLiveDocumentRegistry();
		const first = registry.acquire('workspace\u0000notes.md');
		const doc = first.document.doc;
		first.dispose();

		const second = registry.acquire('workspace\u0000notes.md');
		assert.strictEqual(second.document.doc, doc);
		await nextTick();

		assert.strictEqual(doc.isDestroyed, false);
		assert.strictEqual(registry.get('workspace\u0000notes.md'), second.document);
		assert.strictEqual(second.document.holdCount, 1);

		second.dispose();
		await nextTick();
		assert.strictEqual(doc.isDestroyed, true);
	});

	test('makes handle disposal idempotent', async () => {
		const registry = new BaseHalfMarkdownRichLiveDocumentRegistry();
		const first = registry.acquire('workspace\u0000notes.md');
		const second = registry.acquire('workspace\u0000notes.md');
		const doc = first.document.doc;

		first.dispose();
		first.dispose();
		assert.strictEqual(second.document.holdCount, 1);
		assert.strictEqual(doc.isDestroyed, false);

		second.dispose();
		await nextTick();
		assert.strictEqual(doc.isDestroyed, true);
	});

	test('clear immediately destroys every live document and empties the registry', () => {
		const registry = new BaseHalfMarkdownRichLiveDocumentRegistry();
		const first = registry.acquire('workspace\u0000a.md');
		const second = registry.acquire('workspace\u0000b.md');
		const firstDoc = first.document.doc;
		const secondDoc = second.document.doc;

		registry.clear();

		assert.strictEqual(firstDoc.isDestroyed, true);
		assert.strictEqual(secondDoc.isDestroyed, true);
		assert.strictEqual(registry.get('workspace\u0000a.md'), undefined);
		assert.strictEqual(registry.get('workspace\u0000b.md'), undefined);
	});
});

async function nextTick(): Promise<void> {
	await new Promise(resolve => setTimeout(resolve, 0));
}
