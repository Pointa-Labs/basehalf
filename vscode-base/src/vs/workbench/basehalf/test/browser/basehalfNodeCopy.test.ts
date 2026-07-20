/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { FileService } from '../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { BASEHALF_NODE_COPY_MAX_CANDIDATES, forkCopiedBaseHalfNodeTrees, forkPartiallyCopiedBaseHalfNodeTrees, prepareBaseHalfNodeCopyPlans } from '../../browser/basehalfNodeCopy.js';
import {
	beginBaseHalfNodeRun,
	createBaseHalfNodeDocument,
	failBaseHalfNodeRun,
	IBaseHalfNodeDocument,
	IBaseHalfNodeImportedRevision,
	importBaseHalfNodeCurrent,
	parseBaseHalfNodeDocument,
	serializeBaseHalfNodeDocument
} from '../../common/basehalfNodeDocument.js';
import { baseHalfNodeTestId } from '../common/basehalfNodeTestFixtures.js';

suite('BaseHalfNodeCopy', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const root = URI.from({ scheme: 'basehalf-node-copy-test', path: '/workspace' });
	let fileService: FileService;

	setup(async () => {
		fileService = disposables.add(new FileService(new NullLogService()));
		disposables.add(fileService.registerProvider(root.scheme, disposables.add(new InMemoryFileSystemProvider())));
		await fileService.createFolder(root);
	});

	test('turns every valid copied node into independent settings while leaving ordinary files untouched', async () => {
		const source = URI.joinPath(root, 'Original shot');
		const sourceNested = URI.joinPath(source, 'nested');
		const target = URI.joinPath(root, 'Copied shot');
		const nested = URI.joinPath(target, 'nested');
		await fileService.createFolder(sourceNested);
		await fileService.createFolder(nested);
		const sourceNodeResource = URI.joinPath(sourceNested, 'Frame.BHNODE');
		const nodeResource = URI.joinPath(nested, 'Frame.BHNODE');
		const sourceInvalidResource = URI.joinPath(source, 'draft.bhnode');
		const invalidResource = URI.joinPath(target, 'draft.bhnode');
		const ordinaryResource = URI.joinPath(target, 'brief.md');
		const existingResource = URI.joinPath(target, 'existing.bhnode');
		const original = nodeWithHistory();
		const existing = createBaseHalfNodeDocument({ id: baseHalfNodeTestId(2), kind: 'image', title: 'Existing', role: 'Keep' });
		await fileService.writeFile(sourceNodeResource, VSBuffer.fromString(serializeBaseHalfNodeDocument(original)));
		await fileService.writeFile(sourceInvalidResource, VSBuffer.fromString('{ not a node }'));
		const plans = await prepareBaseHalfNodeCopyPlans(fileService, [{ source, target }]);

		// Simulate the completed copy without replacing unrelated target entries.
		await fileService.writeFile(nodeResource, VSBuffer.fromString(serializeBaseHalfNodeDocument(nodeWithHistory())));
		await fileService.writeFile(invalidResource, VSBuffer.fromString('{ not a node }'));
		await fileService.writeFile(ordinaryResource, VSBuffer.fromString('Keep me'));
		await fileService.writeFile(existingResource, VSBuffer.fromString(serializeBaseHalfNodeDocument(existing)));

		const ids = [baseHalfNodeTestId(3)];
		const forked = await forkCopiedBaseHalfNodeTrees(
			fileService,
			plans,
			[{ source, target }],
			() => ids.shift()!
		);
		const copied = parseBaseHalfNodeDocument((await fileService.readFile(nodeResource)).value.toString());
		const retained = parseBaseHalfNodeDocument((await fileService.readFile(existingResource)).value.toString());

		assert.deepStrictEqual(forked.map(resource => resource.toString()), [nodeResource.toString()]);
		assert.strictEqual(copied.id, baseHalfNodeTestId(3));
		assert.strictEqual(copied.kind, 'image');
		assert.strictEqual(copied.title, 'Hero frame');
		assert.strictEqual(copied.role, 'Key visual');
		assert.deepStrictEqual(copied.current, { source: 'empty', outputPaths: [] });
		assert.deepStrictEqual(copied.revisions, []);
		assert.deepStrictEqual(copied.runs, []);
		assert.deepStrictEqual(copied.recipe, {
			recipeId: 'official.image.generate',
			modelServiceId: 'studio.image',
			modelId: 'image-v2',
			parameters: { aspectRatio: '16:9' },
			inputBindings: []
		});
		assert.strictEqual((await fileService.readFile(invalidResource)).value.toString(), '{ not a node }');
		assert.strictEqual((await fileService.readFile(ordinaryResource)).value.toString(), 'Keep me');
		assert.strictEqual(retained.id, baseHalfNodeTestId(2));
		assert.strictEqual(retained.title, 'Existing');
	});

	test('forks the exact valid contents copied after prepare instead of restoring a stale source snapshot', async () => {
		const source = URI.joinPath(root, 'source.bhnode');
		const target = URI.joinPath(root, 'target.bhnode');
		await fileService.writeFile(source, VSBuffer.fromString(serializeBaseHalfNodeDocument(nodeWithHistory())));
		const plans = await prepareBaseHalfNodeCopyPlans(fileService, [{ source, target }]);

		const changed = createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(4),
			kind: 'video',
			title: 'Changed before copy',
			role: 'Motion',
			recipe: {
				recipeId: 'official.video.generate',
				modelServiceId: 'studio.video',
				modelId: 'video-v3',
				parameters: { seconds: 8 },
				inputBindings: [{ sourcePath: 'frame.bhnode', slot: 'image', order: 0 }]
			}
		});
		await fileService.writeFile(source, VSBuffer.fromString(serializeBaseHalfNodeDocument(changed)));
		await fileService.writeFile(target, VSBuffer.fromString(serializeBaseHalfNodeDocument(changed)));

		await forkCopiedBaseHalfNodeTrees(fileService, plans, [{ source, target }], () => baseHalfNodeTestId(5));
		const copied = parseBaseHalfNodeDocument((await fileService.readFile(target)).value.toString());
		assert.strictEqual(copied.id, baseHalfNodeTestId(5));
		assert.strictEqual(copied.kind, 'video');
		assert.strictEqual(copied.title, 'Changed before copy');
		assert.deepStrictEqual(copied.recipe, {
			recipeId: 'official.video.generate',
			modelServiceId: 'studio.video',
			modelId: 'video-v3',
			parameters: { seconds: 8 },
			inputBindings: []
		});
	});

	test('fails closed when the source gains a result node after copy preparation', async () => {
		const source = URI.joinPath(root, 'source');
		const target = URI.joinPath(root, 'target');
		await fileService.createFolder(source);
		const plans = await prepareBaseHalfNodeCopyPlans(fileService, [{ source, target }]);
		const lateSource = URI.joinPath(source, 'late.bhnode');
		const lateTarget = URI.joinPath(target, 'late.bhnode');
		await fileService.writeFile(lateSource, VSBuffer.fromString(serializeBaseHalfNodeDocument(nodeWithHistory())));
		await fileService.createFolder(target);
		await fileService.writeFile(lateTarget, VSBuffer.fromString(serializeBaseHalfNodeDocument(nodeWithHistory())));

		await assert.rejects(
			forkCopiedBaseHalfNodeTrees(fileService, plans, [{ source, target }], () => baseHalfNodeTestId(8)),
			/gained result node/
		);
		const copied = parseBaseHalfNodeDocument((await fileService.readFile(lateTarget)).value.toString());
		assert.strictEqual(copied.id, baseHalfNodeTestId(1));
	});

	test('does not touch an identical pre-existing target when a matching source appears late', async () => {
		const source = URI.joinPath(root, 'source');
		const target = URI.joinPath(root, 'target');
		await fileService.createFolder(source);
		await fileService.createFolder(target);
		const targetNode = URI.joinPath(target, 'late.bhnode');
		await fileService.writeFile(targetNode, VSBuffer.fromString(serializeBaseHalfNodeDocument(nodeWithHistory())));
		const plans = await prepareBaseHalfNodeCopyPlans(fileService, [{ source, target }]);
		await fileService.writeFile(URI.joinPath(source, 'late.bhnode'), VSBuffer.fromString(serializeBaseHalfNodeDocument(nodeWithHistory())));

		await assert.rejects(
			forkCopiedBaseHalfNodeTrees(fileService, plans, [{ source, target }], () => baseHalfNodeTestId(15)),
			/gained result node/
		);
		const retained = parseBaseHalfNodeDocument((await fileService.readFile(targetNode)).value.toString());
		assert.strictEqual(retained.id, baseHalfNodeTestId(1));
		assert.strictEqual(retained.title, 'Hero frame');
		assert.notDeepStrictEqual(retained.current, { source: 'empty', outputPaths: [] });
	});

	test('keeps a newly materialized target unchanged when an unobserved late source disappeared', async () => {
		const source = URI.joinPath(root, 'source');
		const target = URI.joinPath(root, 'target');
		await fileService.createFolder(source);
		const plans = await prepareBaseHalfNodeCopyPlans(fileService, [{ source, target }]);
		const lateSource = URI.joinPath(source, 'late.bhnode');
		const lateTarget = URI.joinPath(target, 'late.bhnode');
		await fileService.writeFile(lateSource, VSBuffer.fromString(serializeBaseHalfNodeDocument(nodeWithHistory())));
		await fileService.createFolder(target);
		await fileService.writeFile(lateTarget, VSBuffer.fromString(serializeBaseHalfNodeDocument(nodeWithHistory())));
		await fileService.del(lateSource);

		const forked = await forkCopiedBaseHalfNodeTrees(fileService, plans, [{ source, target }], () => baseHalfNodeTestId(9));
		const copied = parseBaseHalfNodeDocument((await fileService.readFile(lateTarget)).value.toString());
		assert.deepStrictEqual(forked, []);
		assert.strictEqual(copied.id, baseHalfNodeTestId(1));
	});

	test('does not change an untouched merge target after the prepared source entry disappears', async () => {
		const source = URI.joinPath(root, 'source');
		const target = URI.joinPath(root, 'target');
		await fileService.createFolder(source);
		await fileService.createFolder(target);
		const sourceNode = URI.joinPath(source, 'removed.bhnode');
		const targetNode = URI.joinPath(target, 'removed.bhnode');
		const existing = createBaseHalfNodeDocument({ id: baseHalfNodeTestId(10), kind: 'image', title: 'Keep', role: 'Existing' });
		await fileService.writeFile(sourceNode, VSBuffer.fromString(serializeBaseHalfNodeDocument(nodeWithHistory())));
		await fileService.writeFile(targetNode, VSBuffer.fromString(serializeBaseHalfNodeDocument(existing)));
		const plans = await prepareBaseHalfNodeCopyPlans(fileService, [{ source, target }]);
		await fileService.del(sourceNode);

		const forked = await forkCopiedBaseHalfNodeTrees(fileService, plans, [{ source, target }], () => baseHalfNodeTestId(11));
		const retained = parseBaseHalfNodeDocument((await fileService.readFile(targetNode)).value.toString());
		assert.deepStrictEqual(forked, []);
		assert.strictEqual(retained.id, baseHalfNodeTestId(10));
		assert.strictEqual(retained.title, 'Keep');
	});

	test('does not change an untouched merge target across a prepared-source path ABA', async () => {
		const source = URI.joinPath(root, 'source');
		const target = URI.joinPath(root, 'target');
		await fileService.createFolder(source);
		await fileService.createFolder(target);
		const sourceNode = URI.joinPath(source, 'frame.bhnode');
		const targetNode = URI.joinPath(target, 'frame.bhnode');
		const existing = createBaseHalfNodeDocument({ id: baseHalfNodeTestId(12), kind: 'image', title: 'Existing target', role: 'Keep' });
		await fileService.writeFile(sourceNode, VSBuffer.fromString(serializeBaseHalfNodeDocument(nodeWithHistory())));
		await fileService.writeFile(targetNode, VSBuffer.fromString(serializeBaseHalfNodeDocument(existing)));
		const plans = await prepareBaseHalfNodeCopyPlans(fileService, [{ source, target }]);

		// The provider enumerated the source while this path was absent. The same
		// pathname reappeared before the finalizer, but the merge target was never
		// materialized by the copy.
		await fileService.del(sourceNode);
		await fileService.writeFile(sourceNode, VSBuffer.fromString(serializeBaseHalfNodeDocument(nodeWithHistory())));

		const forked = await forkCopiedBaseHalfNodeTrees(fileService, plans, [{ source, target }], () => baseHalfNodeTestId(13));
		const retained = parseBaseHalfNodeDocument((await fileService.readFile(targetNode)).value.toString());
		assert.deepStrictEqual(forked, []);
		assert.strictEqual(retained.id, baseHalfNodeTestId(12));
		assert.strictEqual(retained.title, 'Existing target');
	});

	test('fails closed when a copied node with the source identity was edited before finalization', async () => {
		const source = URI.joinPath(root, 'source.bhnode');
		const target = URI.joinPath(root, 'target.bhnode');
		const original = nodeWithHistory();
		await fileService.writeFile(source, VSBuffer.fromString(serializeBaseHalfNodeDocument(original)));
		const plans = await prepareBaseHalfNodeCopyPlans(fileService, [{ source, target }]);
		const edited = { ...original, title: 'Edited copied node' };
		await fileService.writeFile(target, VSBuffer.fromString(serializeBaseHalfNodeDocument(edited)));

		await assert.rejects(
			forkCopiedBaseHalfNodeTrees(fileService, plans, [{ source, target }], () => baseHalfNodeTestId(14)),
			/changed while the copy was being finalized/
		);
		const retained = parseBaseHalfNodeDocument((await fileService.readFile(target)).value.toString());
		assert.strictEqual(retained.id, original.id);
		assert.strictEqual(retained.title, 'Edited copied node');
		assert.deepStrictEqual(retained.current, original.current);
	});

	test('bounds the number of result declarations inspected before a copy', async () => {
		const source = URI.joinPath(root, 'large-source');
		await fileService.createFolder(source);
		for (let index = 0; index <= BASEHALF_NODE_COPY_MAX_CANDIDATES; index++) {
			await fileService.writeFile(URI.joinPath(source, `${index}.bhnode`), VSBuffer.fromString('{}'));
		}

		await assert.rejects(
			prepareBaseHalfNodeCopyPlans(fileService, [{ source, target: URI.joinPath(root, 'large-target') }]),
			/contain at most/
		);
	});

	test('separates a partially copied node after failure without touching an unchanged merge-target node', async () => {
		const source = URI.joinPath(root, 'source');
		const target = URI.joinPath(root, 'target');
		await fileService.createFolder(source);
		await fileService.createFolder(target);
		const sourceCopied = URI.joinPath(source, 'copied.bhnode');
		const sourceUntouched = URI.joinPath(source, 'untouched.bhnode');
		const targetCopied = URI.joinPath(target, 'copied.bhnode');
		const targetUntouched = URI.joinPath(target, 'untouched.bhnode');
		const copiedSource = nodeWithHistory();
		const untouchedTarget = createBaseHalfNodeDocument({ id: baseHalfNodeTestId(6), kind: 'audio', title: 'Existing', role: 'Keep' });
		await fileService.writeFile(sourceCopied, VSBuffer.fromString(serializeBaseHalfNodeDocument(copiedSource)));
		await fileService.writeFile(sourceUntouched, VSBuffer.fromString(serializeBaseHalfNodeDocument(copiedSource)));
		await fileService.writeFile(targetUntouched, VSBuffer.fromString(serializeBaseHalfNodeDocument(untouchedTarget)));
		const plans = await prepareBaseHalfNodeCopyPlans(fileService, [{ source, target }]);

		// The provider materialized one candidate and then rejected the pair.
		await fileService.writeFile(targetCopied, VSBuffer.fromString(serializeBaseHalfNodeDocument(copiedSource)));
		const forked = await forkPartiallyCopiedBaseHalfNodeTrees(fileService, plans, [], () => baseHalfNodeTestId(7));
		const separated = parseBaseHalfNodeDocument((await fileService.readFile(targetCopied)).value.toString());
		const retained = parseBaseHalfNodeDocument((await fileService.readFile(targetUntouched)).value.toString());

		assert.deepStrictEqual(forked.map(resource => resource.toString()), [targetCopied.toString()]);
		assert.strictEqual(separated.id, baseHalfNodeTestId(7));
		assert.deepStrictEqual(separated.current, { source: 'empty', outputPaths: [] });
		assert.deepStrictEqual(separated.runs, []);
		assert.strictEqual(retained.id, baseHalfNodeTestId(6));
		assert.strictEqual(retained.title, 'Existing');
	});

	function nodeWithHistory(): IBaseHalfNodeDocument {
		const revision: IBaseHalfNodeImportedRevision = {
			id: 'revision-1',
			source: 'imported',
			createdAt: '2026-07-18T10:00:00Z',
			artifacts: [{
				id: 'artifact-1',
				outputId: 'imported',
				kind: 'image',
				path: 'assets/original/reference.png',
				sha256: 'A'.repeat(43),
				size: 100
			}],
			primaryArtifactId: 'artifact-1'
		};
		let document = createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(1),
			kind: 'image',
			title: 'Hero frame',
			role: 'Key visual',
			recipe: {
				recipeId: 'official.image.generate',
				modelServiceId: 'studio.image',
				modelId: 'image-v2',
				parameters: { aspectRatio: '16:9' },
				inputBindings: [{ sourcePath: 'brief.md', slot: 'prompt', order: 0 }]
			}
		});
		document = importBaseHalfNodeCurrent(document, revision);
		document = beginBaseHalfNodeRun(document, {
			id: 'run-1',
			createdAt: '2026-07-18T10:01:00Z',
			startedAt: '2026-07-18T10:01:00Z',
			model: {
				source: 'service',
				connection: 'unavailable',
				serviceId: 'studio.image',
				capability: 'image',
				modelId: 'image-v2'
			},
			inputs: []
		});
		return failBaseHalfNodeRun(document, 'run-1', {
			completedAt: '2026-07-18T10:01:01Z',
			error: 'Stopped'
		});
	}
});
