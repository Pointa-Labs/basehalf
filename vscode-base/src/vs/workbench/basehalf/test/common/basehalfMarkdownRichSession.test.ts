/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	BaseHalfMarkdownRichSession,
	BaseHalfMarkdownRichSessionRegistry,
	IBaseHalfMarkdownRichDisk,
	IBaseHalfMarkdownRichDocument,
	IBaseHalfMarkdownRichView
} from '../../common/basehalfMarkdownRichSession.js';

suite('BaseHalfMarkdownRichSession', () => {
	test('seeds frontmatter, editor blocks, reuse state, and ready waiters', async () => {
		const { session, document } = createSession();
		let readyCalls = 0;
		const offReady = session.onReady(() => readyCalls++);

		assert.strictEqual(session.claimSeed(), true);
		assert.strictEqual(session.claimSeed(), false);
		await session.seedFromContent('---\ntitle: A\n---\n\nAlpha  \n\nBeta\n');

		assert.strictEqual(readyCalls, 1);
		assert.strictEqual(session.snapshot.seeded, true);
		assert.strictEqual(session.snapshot.ready, true);
		assert.strictEqual(session.snapshot.pendingEdits, false);
		assert.strictEqual(session.snapshot.frontmatter, '---\ntitle: A\n---\n');
		assert.strictEqual(session.snapshot.lastDisk, '---\ntitle: A\n---\n\nAlpha  \n\nBeta\n');
		assert.deepStrictEqual(document.blocks.map(block => (block as { markdown?: string }).markdown), ['Alpha', 'Beta']);

		session.onReady(() => readyCalls++);
		assert.strictEqual(readyCalls, 2);
		offReady();
	});

	test('marks a failed seed as ready so joining rich views are not stuck', async () => {
		const { session, document } = createSession();
		let readyCalls = 0;

		assert.strictEqual(session.claimSeed(), true);
		session.onReady(() => readyCalls++);
		session.markSeedFailed();

		assert.strictEqual(readyCalls, 1);
		assert.strictEqual(session.snapshot.seeded, true);
		assert.strictEqual(session.snapshot.ready, true);
		assert.deepStrictEqual(document.blocks, []);
		assert.strictEqual(session.snapshot.lastDisk, '');
	});

	test('does not serialize or touch disk when there are no pending edits', async () => {
		const { session, editor } = createSession();
		await session.seedFromContent('Alpha\n');
		editor.serializeCalls = 0;

		const result = await session.save({
			read: async () => assert.fail('read should not run for a clean rich session'),
			write: async () => assert.fail('write should not run for a clean rich session')
		});

		assert.deepStrictEqual(result, { kind: 'noop' });
		assert.strictEqual(editor.serializeCalls, 0);
		assert.strictEqual(session.snapshot.pendingEdits, false);
	});

	test('saves an edited block through byte-stable splice output', async () => {
		const { session, document } = createSession();
		await session.seedFromContent('Alpha  \n\nBeta\n');
		(document.blocks[1] as { markdown: string }).markdown = 'Beta changed';
		session.markEdited();

		const disk = new TestDisk('Alpha  \n\nBeta\n');
		const result = await session.save(disk);

		assert.strictEqual(result.kind, 'saved');
		assert.deepStrictEqual(disk.writes, ['Alpha  \n\nBeta changed\n']);
		assert.strictEqual(session.snapshot.lastDisk, 'Alpha  \n\nBeta changed\n');
		assert.strictEqual(session.snapshot.pendingEdits, false);
		assert.strictEqual(session.snapshot.writeFailed, false);
	});

	test('still attempts the write when the pre-save drift read fails', async () => {
		const { session, document } = createSession();
		await session.seedFromContent('Alpha\n');
		(document.blocks[0] as { markdown: string }).markdown = 'Local';
		session.markEdited();

		const disk = new TestDisk('Alpha\n');
		disk.failReads = true;
		const result = await session.save(disk);

		assert.strictEqual(result.kind, 'saved');
		assert.deepStrictEqual(disk.writes, ['Local\n']);
		assert.strictEqual(session.snapshot.pendingEdits, false);
		assert.strictEqual(session.snapshot.conflict, false);
	});

	test('blocks save on disk drift until the user keeps local content explicitly', async () => {
		const { session, document } = createSession();
		await session.seedFromContent('Alpha\n');
		(document.blocks[0] as { markdown: string }).markdown = 'Local';
		session.markEdited();

		const drifted = new TestDisk('External\n');
		const blocked = await session.save(drifted);

		assert.deepStrictEqual(blocked, { kind: 'blockedByConflict', disk: 'External\n' });
		assert.deepStrictEqual(drifted.writes, []);
		assert.strictEqual(session.snapshot.conflict, true);
		assert.strictEqual(session.snapshot.pendingEdits, true);

		const keepDisk = new TestDisk('External\n');
		const kept = await session.keepLocalContent(keepDisk);

		assert.strictEqual(kept.kind, 'saved');
		assert.deepStrictEqual(keepDisk.reads, 0);
		assert.deepStrictEqual(keepDisk.writes, ['Local\n']);
		assert.strictEqual(session.snapshot.conflict, false);
		assert.strictEqual(session.snapshot.pendingEdits, false);
	});

	test('reloads external content when clean and conflicts when local edits are pending', async () => {
		const { session, document } = createSession();
		await session.seedFromContent('Alpha\n');

		assert.deepStrictEqual(await session.handleExternalContent('Beta\n'), { kind: 'reloaded' });
		assert.deepStrictEqual(document.blocks.map(block => (block as { markdown?: string }).markdown), ['Beta']);
		assert.strictEqual(session.snapshot.lastDisk, 'Beta\n');

		(document.blocks[0] as { markdown: string }).markdown = 'Local beta';
		session.markEdited();
		assert.deepStrictEqual(await session.handleExternalContent('External beta\n'), { kind: 'conflict', disk: 'External beta\n' });
		assert.deepStrictEqual(document.blocks.map(block => (block as { markdown?: string }).markdown), ['Local beta']);
		assert.strictEqual(session.snapshot.conflict, true);

		await session.acceptExternalContent();
		assert.deepStrictEqual(document.blocks.map(block => (block as { markdown?: string }).markdown), ['External beta']);
		assert.strictEqual(session.snapshot.pendingEdits, false);
		assert.strictEqual(session.snapshot.conflict, false);
	});

	test('keeps pending edits after write failure so navigation can stay blocked', async () => {
		const { session, document } = createSession();
		await session.seedFromContent('Alpha\n');
		(document.blocks[0] as { markdown: string }).markdown = 'Local';
		session.markEdited();

		const disk = new TestDisk('Alpha\n');
		disk.failWrites = true;
		const result = await session.save(disk);

		assert.strictEqual(result.kind, 'writeFailed');
		assert.strictEqual(session.snapshot.pendingEdits, true);
		assert.strictEqual(session.snapshot.writeFailed, true);

		assert.deepStrictEqual(await session.handleExternalContent('External\n'), { kind: 'conflict', disk: 'External\n' });
	});

	test('hands rich persistence ownership to the highest-priority mounted view', async () => {
		const { session } = createSession('doc');
		const low = new TestView('doc', 0);
		const high = new TestView('doc', 2);
		const peer = new TestView('doc', 2);

		session.acquireView(low);
		assert.strictEqual(session.isOwner(low), true);
		assert.deepStrictEqual(low.ownerStates, [true]);

		session.acquireView(high);
		assert.strictEqual(session.isOwner(high), true);
		assert.deepStrictEqual(low.ownerStates, [true, false]);
		assert.deepStrictEqual(high.ownerStates, [true]);

		session.acquireView(peer);
		assert.strictEqual(session.isOwner(high), true);
		assert.deepStrictEqual(peer.ownerStates, []);

		session.releaseView(high);
		assert.strictEqual(session.isOwner(peer), true);
		assert.deepStrictEqual(high.ownerStates, [true, false]);
		assert.deepStrictEqual(peer.ownerStates, [true]);

		session.releaseView(peer);
		assert.strictEqual(session.isOwner(low), true);
		assert.deepStrictEqual(low.ownerStates, [true, false, true]);
	});

	test('registry reuses sessions by document key and releases them after the last view leaves', async () => {
		const registry = new BaseHalfMarkdownRichSessionRegistry();
		let creates = 0;
		const create = () => {
			creates++;
			return createParts();
		};
		const first = new TestView('workspace\u0000notes/a.md', 1);
		const second = new TestView('workspace\u0000notes/a.md', 1);

		const a = registry.acquireView(first, create);
		const b = registry.acquireView(second, create);
		assert.strictEqual(a, b);
		assert.strictEqual(creates, 1);
		assert.strictEqual(a.snapshot.viewCount, 2);

		registry.releaseView(first);
		assert.strictEqual(registry.get(first.key), a);
		registry.releaseView(second);
		await nextTick();
		assert.strictEqual(registry.get(first.key), undefined);
	});
});

function createSession(key = 'workspace\u0000README.md'): { session: BaseHalfMarkdownRichSession; editor: FakeMarkdownEditor; document: TestRichDocument } {
	const parts = createParts();
	return {
		session: new BaseHalfMarkdownRichSession(key, parts.editor, parts.document),
		editor: parts.editor,
		document: parts.document
	};
}

function createParts(): { editor: FakeMarkdownEditor; document: TestRichDocument } {
	return {
		editor: new FakeMarkdownEditor(),
		document: new TestRichDocument()
	};
}

class TestRichDocument implements IBaseHalfMarkdownRichDocument {
	blocks: unknown[] = [];

	replaceBlocks(blocks: readonly unknown[]): void {
		this.blocks = [...blocks];
	}
}

class TestDisk implements IBaseHalfMarkdownRichDisk {
	reads = 0;
	readonly writes: string[] = [];
	failReads = false;
	failWrites = false;

	constructor(private content: string) { }

	async read(): Promise<string> {
		this.reads++;
		if (this.failReads) {
			throw new Error('missing');
		}
		return this.content;
	}

	async write(content: string): Promise<void> {
		if (this.failWrites) {
			throw new Error('disk full');
		}
		this.writes.push(content);
		this.content = content;
	}
}

class TestView implements IBaseHalfMarkdownRichView {
	readonly ownerStates: boolean[] = [];

	constructor(
		readonly key: string,
		private priority: number
	) { }

	ownerPriority(): number {
		return this.priority;
	}

	setOwner(isOwner: boolean): void {
		this.ownerStates.push(isOwner);
	}
}

class FakeMarkdownEditor {
	private nextId = 1;
	serializeCalls = 0;

	tryParseMarkdownToBlocks(markdown: string): unknown[] {
		if (/^<!--/.test(markdown)) {
			return [];
		}

		return [this.block(`b${this.nextId++}`, blockTypeFor(markdown), markdown.trimEnd())];
	}

	blocksToMarkdownLossy(blocks: unknown[]): string {
		this.serializeCalls++;
		return blocks.map(block => (block as { markdown?: string }).markdown ?? '').join('\n');
	}

	private block(id: string, type: string, markdown: string): unknown {
		return {
			id,
			type,
			content: [{ type: 'text', text: markdown }],
			markdown
		};
	}
}

function blockTypeFor(markdown: string): string {
	if (/^\s*(?:[-*+]|\d+\.)\s/.test(markdown)) {
		return 'bulletListItem';
	}

	return 'paragraph';
}

async function nextTick(): Promise<void> {
	await new Promise(resolve => setTimeout(resolve, 0));
}
