/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	AUDIO_BRIEF_RECIPE_ID,
	CLIP_BRIEF_RECIPE_ID,
	STORYBOARD_FRAME_RECIPE_ID,
	addAIVideoSequenceItem,
	inspectAIVideoSequence,
	isFilePathInside,
	isOrdinaryFilePathInside,
	isPlainLocalFileResource,
	moveAIVideoSequenceItem,
	parseAIVideoSequenceDocument,
	parseAIVideoShotDocument,
	parseAudioBriefParameters,
	parseClipBriefParameters,
	parseStoryboardFrameParameters,
	portableDescendantVideoNodePath,
	removeAIVideoSequenceItem,
	removeAIVideoSequenceItemsForNodeIdentity,
	resolveAIVideoSequenceCurrentPin,
	resolveAIVideoSequenceVideoNodePath,
	resolveAIVideoShotClipNodePath,
	serializeAIVideoSequenceDocument,
	updateAIVideoSequenceItemPath,
	updateAIVideoSequenceItemVersion,
	validateRecipeInputs,
	type AIVideoRecipeInput,
	type AIVideoSequenceNodeState
} from '../src/domain.ts';

test('requires explicit instructions and supplies only non-content defaults', () => {
	assert.deepEqual(parseStoryboardFrameParameters({ instructions: 'A quiet station at night.' }), {
		instructions: 'A quiet station at night.',
		aspectRatio: '9:16',
		shotLabel: 'Shot'
	});
	assert.deepEqual(parseClipBriefParameters({
		'instructions': 'Slow push in.',
		'duration-seconds': 12,
		'aspect-ratio': '16:9',
		'audio-mode': 'none'
	}), {
		instructions: 'Slow push in.',
		durationSeconds: 12,
		aspectRatio: '16:9',
		audioMode: 'none'
	});
	assert.deepEqual(parseAudioBriefParameters({ instructions: 'A distant train horn.', purpose: 'effect', voice: 'auto' }), {
		instructions: 'A distant train horn.',
		purpose: 'effect',
		durationSeconds: 5,
		voice: 'auto'
	});
});

test('rejects unsupported, out-of-range, and malformed recipe parameters', () => {
	assert.throws(() => parseStoryboardFrameParameters({ unknown: true }), /unsupported field/);
	assert.throws(() => parseStoryboardFrameParameters({}), /instructions.*non-empty text/);
	assert.throws(() => parseClipBriefParameters({ instructions: '   ' }), /instructions.*non-empty text/);
	assert.throws(() => parseAudioBriefParameters({ instructions: '' }), /instructions.*non-empty text/);
	assert.throws(() => parseStoryboardFrameParameters({ instructions: 'Frame', 'aspect-ratio': '4:3' }), /must be one of/);
	assert.throws(() => parseClipBriefParameters({ instructions: 'Motion', 'duration-seconds': 0 }), /integer from 1 to 120/);
	assert.throws(() => parseClipBriefParameters({ instructions: 'Motion', 'duration-seconds': 1.5 }), /integer from 1 to 120/);
	assert.throws(() => parseAudioBriefParameters({ instructions: 'Voice', voice: '' }), /cannot be empty/);
});

test('validates recipe-local input roles without changing the host edge meaning', () => {
	const inputs: readonly AIVideoRecipeInput[] = [
		{ edgeId: 'edge-2', slotId: 'first-frame', order: 1, source: { kind: 'image', path: 'shot/frame.bhnode' } },
		{ edgeId: 'edge-1', slotId: 'prompt', order: 0, source: { kind: 'text', path: 'shot/plan.md' } }
	];
	assert.deepEqual(validateRecipeInputs(CLIP_BRIEF_RECIPE_ID, inputs).map(input => input.edgeId), ['edge-1', 'edge-2']);
	assert.deepEqual(validateRecipeInputs(STORYBOARD_FRAME_RECIPE_ID, []), []);
	assert.deepEqual(validateRecipeInputs(AUDIO_BRIEF_RECIPE_ID, []), []);
	assert.doesNotThrow(() => validateRecipeInputs(CLIP_BRIEF_RECIPE_ID, [
		{ edgeId: 'audio-plan', slotId: 'audio', order: 0, source: { kind: 'file', path: 'shot/audio-plan.bhnode' } }
	]));
	assert.throws(() => validateRecipeInputs(CLIP_BRIEF_RECIPE_ID, [
		{ edgeId: 'shared-edge', slotId: 'first-frame', order: 0, source: { kind: 'image', path: 'shot/frame.bhnode' } },
		{ edgeId: 'shared-edge', slotId: 'style', order: 1, source: { kind: 'image', path: 'shot/frame.bhnode' } }
	]), /same direct connection/);

	assert.throws(() => validateRecipeInputs(CLIP_BRIEF_RECIPE_ID, [
		{ edgeId: 'edge', slotId: 'first-frame', order: 0, source: { kind: 'video', path: 'shot/source.bhnode' } }
	]), /does not accept 'video'/);
	assert.throws(() => validateRecipeInputs(STORYBOARD_FRAME_RECIPE_ID, [
		{ edgeId: 'edge', slotId: 'audio', order: 0, source: { kind: 'audio', path: 'shot/voice.bhnode' } }
	]), /does not accept input slot/);
	assert.throws(() => validateRecipeInputs(AUDIO_BRIEF_RECIPE_ID, [
		{ edgeId: 'edge-1', slotId: 'prompt', order: 0, source: { kind: 'text', path: 'one.md' } },
		{ edgeId: 'edge-2', slotId: 'reference', order: 0, source: { kind: 'audio', path: 'two.bhnode' } }
	]), /continuous, unique input order/);
	assert.throws(() => validateRecipeInputs(CLIP_BRIEF_RECIPE_ID, [
		{ edgeId: 'edge-1', slotId: 'reference', order: 0, source: { kind: 'image', path: 'same.bhnode' } },
		{ edgeId: 'edge-2', slotId: 'reference', order: 1, source: { kind: 'image', path: 'same.bhnode' } }
	]), /same source more than once/);
	assert.throws(() => validateRecipeInputs(CLIP_BRIEF_RECIPE_ID, [
		{ edgeId: 'edge-1', slotId: 'prompt', order: 1, source: { kind: 'text', path: 'one.md' } }
	]), /continuous, unique input order/);
});

test('parses a portable sequence that pins ordered video nodes to exact versions', () => {
	const sequence = parseAIVideoSequenceDocument(JSON.stringify({
		version: 1,
		kind: 'pointa.basehalf-ai-video.sequence',
		items: [
			{ id: 'shot-01', title: 'Opening', nodeId: 'clip-node-01', videoNodePath: 'shot-01/clip.bhnode', versionId: 'run-01' },
			{ id: 'shot-02', title: 'Close', nodeId: 'clip-node-02', videoNodePath: 'shot-02/clip.bhnode', versionId: 'revision-09' }
		]
	}));
	assert.equal(sequence.items[0].videoNodePath, 'shot-01/clip.bhnode');
	assert.equal(sequence.items[0].nodeId, 'clip-node-01');
	assert.equal(sequence.items[1].versionId, 'revision-09');
});

test('resolves sequence pins against exact host-owned Video versions and reports a different Current', async () => {
	const pinnedResource = Object.freeze({ path: '/outputs/opening-pinned.mp4' });
	const currentResource = Object.freeze({ path: '/outputs/opening-current.mp4' });
	const sequence = parseAIVideoSequenceDocument(JSON.stringify({
		version: 1,
		kind: 'pointa.basehalf-ai-video.sequence',
		items: [
			{ id: 'shot-01', title: 'Opening', nodeId: 'clip-node-01', videoNodePath: 'shot-01/clip.bhnode', versionId: 'run-01' },
			{ id: 'shot-02', title: 'Close', nodeId: 'clip-node-02', videoNodePath: 'shot-02/clip.bhnode', versionId: 'revision-01' }
		]
	}));
	const nodes = new Map<string, AIVideoSequenceNodeState>([
		['shot-01/clip.bhnode', videoNode('clip-node-01', 'run-02', [
			videoVersion('run-01', 'succeeded', 'available', pinnedResource),
			videoVersion('run-02', 'succeeded', 'available', currentResource)
		])],
		['shot-02/clip.bhnode', videoNode('clip-node-02', 'revision-01', [videoVersion('revision-01', 'imported')])]
	]);
	const requests: { readonly path: string; readonly versionIds: readonly string[]; readonly includeCurrent: boolean }[] = [];
	const inspection = await inspectAIVideoSequence(sequence, async (path, request) => {
		requests.push({ path, ...request });
		return nodes.get(path);
	});

	assert.equal(inspection.valid, true);
	assert.equal(inspection.updatesAvailable, 1);
	assert.equal(inspection.items[0].state, 'updateAvailable');
	assert.equal(inspection.items[0].availableCurrentVersionId, 'run-02');
	assert.equal(inspection.items[0].pinnedArtifact?.resource, pinnedResource);
	assert.notEqual(inspection.items[0].pinnedArtifact?.resource, currentResource);
	assert.equal(inspection.items[1].state, 'current');
	assert.deepEqual(requests, [
		{ path: 'shot-01/clip.bhnode', versionIds: ['run-01'], includeCurrent: true },
		{ path: 'shot-02/clip.bhnode', versionIds: ['revision-01'], includeCurrent: true }
	]);
});

test('inspects Sequence items with bounded concurrency exactly once and retains the first verified artifact', async () => {
	const itemCount = 24;
	const sequence = parseAIVideoSequenceDocument(JSON.stringify({
		version: 1,
		kind: 'pointa.basehalf-ai-video.sequence',
		items: Array.from({ length: itemCount }, (_, index) => ({
			id: `shot-${index}`,
			title: `Shot ${index}`,
			nodeId: `node-${index}`,
			videoNodePath: `shots/${index}/clip.bhnode`,
			versionId: `run-${index}`
		}))
	}));
	const resources = Array.from({ length: itemCount }, (_, index) => Object.freeze({ path: `/outputs/${index}.mp4` }));
	const calls = new Map<string, number>();
	let active = 0;
	let maximumActive = 0;
	const inspection = await inspectAIVideoSequence(sequence, async path => {
		calls.set(path, (calls.get(path) ?? 0) + 1);
		active++;
		maximumActive = Math.max(maximumActive, active);
		await new Promise<void>(resolve => setImmediate(resolve));
		active--;
		const index = Number(path.split('/')[1]);
		return videoNode(`node-${index}`, `run-${index}`, [
			videoVersion(`run-${index}`, 'succeeded', 'available', resources[index])
		]);
	});

	assert.equal(maximumActive, 8);
	assert.deepEqual([...calls.values()], Array.from({ length: itemCount }, () => 1));
	assert.deepEqual(inspection.items.map(item => item.item.id), sequence.items.map(item => item.id));
	for (let index = 0; index < itemCount; index++) {
		assert.equal(inspection.items[index].pinnedArtifact?.resource, resources[index]);
	}
});

test('stops scheduling new Sequence inspections after cancellation', async () => {
	const itemCount = 24;
	const sequence = parseAIVideoSequenceDocument(JSON.stringify({
		version: 1,
		kind: 'pointa.basehalf-ai-video.sequence',
		items: Array.from({ length: itemCount }, (_, index) => ({
			id: `shot-${index}`,
			title: `Shot ${index}`,
			nodeId: `node-${index}`,
			videoNodePath: `shots/${index}/clip.bhnode`,
			versionId: `run-${index}`
		}))
	}));
	let calls = 0;
	let cancelled = false;
	let releaseFirstWave!: () => void;
	const firstWave = new Promise<void>(resolve => { releaseFirstWave = resolve; });
	const inspection = inspectAIVideoSequence(
		sequence,
		async path => {
			calls++;
			await firstWave;
			const index = Number(path.split('/')[1]);
			return videoNode(`node-${index}`, `run-${index}`, [videoVersion(`run-${index}`, 'succeeded')]);
		},
		undefined,
		() => {
			if (cancelled) {
				throw new Error('Sequence inspection cancelled.');
			}
		}
	);

	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(calls, 8);
	cancelled = true;
	releaseFirstWave();
	await assert.rejects(inspection, /cancelled/);
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(calls, 8);
});

test('offers only a unique moved-node path whose stable identity and exact pin still verify', async () => {
	const sequence = parseAIVideoSequenceDocument(JSON.stringify({
		version: 1,
		kind: 'pointa.basehalf-ai-video.sequence',
		items: [{ id: 'shot', title: 'Shot', nodeId: 'clip-node', videoNodePath: 'old/clip.bhnode', versionId: 'run-1' }]
	}));
	const moved = await inspectAIVideoSequence(
		sequence,
		async () => undefined,
		async (_item, request) => {
			assert.deepEqual(request, { versionIds: ['run-1'], includeCurrent: true });
			return {
				kind: 'unique',
				videoNodePath: 'renamed/clip.bhnode',
				node: videoNode('clip-node', 'run-2', [videoVersion('run-1', 'succeeded'), videoVersion('run-2', 'succeeded')])
			};
		}
	);
	assert.equal(moved.valid, false);
	assert.equal(moved.items[0].state, 'invalid');
	assert.equal(moved.items[0].repairCandidatePath, 'renamed/clip.bhnode');
	assert.match(moved.items[0].message, /moved to 'renamed\/clip\.bhnode'/);

	const repaired = updateAIVideoSequenceItemPath(sequence, 'shot', moved.items[0].repairCandidatePath!);
	assert.equal(repaired.items[0].videoNodePath, 'renamed/clip.bhnode');
	assert.equal(repaired.items[0].nodeId, 'clip-node');
	assert.equal(repaired.items[0].versionId, 'run-1');
});

test('does not suggest path repair for ambiguous identities, bounded scans, unsafe paths, or invalid pins', async () => {
	const sequence = parseAIVideoSequenceDocument(JSON.stringify({
		version: 1,
		kind: 'pointa.basehalf-ai-video.sequence',
		items: [{ id: 'shot', title: 'Shot', nodeId: 'clip-node', videoNodePath: 'old/clip.bhnode', versionId: 'run-1' }]
	}));
	const ambiguous = await inspectAIVideoSequence(sequence, async () => undefined, async () => ({ kind: 'ambiguous', matchCount: 2 }));
	assert.equal(ambiguous.items[0].repairCandidatePath, undefined);
	assert.match(ambiguous.items[0].message, /2 nodes use the same stable identity/);

	const bounded = await inspectAIVideoSequence(sequence, async () => undefined, async () => ({ kind: 'scanLimit', maximum: 256 }));
	assert.equal(bounded.items[0].repairCandidatePath, undefined);
	assert.match(bounded.items[0].message, /exceeded 256 result nodes/);

	const invalidPin = await inspectAIVideoSequence(sequence, async () => undefined, async () => ({
		kind: 'unique',
		videoNodePath: 'renamed/clip.bhnode',
		node: videoNode('clip-node', 'run-1', [videoVersion('run-1', 'succeeded', 'changed')])
	}));
	assert.equal(invalidPin.items[0].repairCandidatePath, undefined);
	assert.match(invalidPin.items[0].message, /changed outside BaseHalf/);

	assert.throws(() => updateAIVideoSequenceItemPath(sequence, 'shot', '../clip.bhnode'), /safe relative path/);
	assert.throws(() => updateAIVideoSequenceItemPath(sequence, 'missing', 'renamed/clip.bhnode'), /does not exist/);
});

test('rejects sequence pins whose node identity, lifecycle, artifact kind, or integrity is not playable', async () => {
	const sequence = (versionId: string, nodeId = 'clip-node') => parseAIVideoSequenceDocument(JSON.stringify({
		version: 1,
		kind: 'pointa.basehalf-ai-video.sequence',
		items: [{ id: 'shot', title: 'Shot', nodeId, videoNodePath: 'clip.bhnode', versionId }]
	}));
	const inspect = (node: AIVideoSequenceNodeState | undefined) => inspectAIVideoSequence(sequence('run-1'), async () => node);

	assert.equal((await inspect(undefined)).items[0].state, 'invalid');
	assert.match((await inspect({ ...videoNode('other-id', 'run-1', [videoVersion('run-1', 'succeeded')]) })).items[0].message, /identity changed/);
	assert.match((await inspect({ ...videoNode('clip-node', 'run-1', [videoVersion('run-1', 'succeeded')]), kind: 'image' })).items[0].message, /not a Video node/);
	assert.match((await inspect(videoNode('clip-node', 'run-1', [videoVersion('run-1', 'failed')]))).items[0].message, /status 'failed'/);
	assert.match((await inspect(videoNode('clip-node', 'run-1', [{ id: 'run-1', status: 'succeeded' }]))).items[0].message, /primary Video artifact/);
	assert.match((await inspect(videoNode('clip-node', 'run-1', [videoVersion('run-1', 'succeeded', 'missing')]))).items[0].message, /missing its local artifact/);
	assert.match((await inspect(videoNode('clip-node', 'run-1', [videoVersion('run-1', 'succeeded', 'changed')]))).items[0].message, /changed outside BaseHalf/);
	assert.equal((await inspectAIVideoSequence(sequence('missing'), async () => videoNode('clip-node', 'run-1', [videoVersion('run-1', 'succeeded')]))).items[0].state, 'invalid');
});

test('reorders clips and updates only the explicit pinned version', () => {
	const sequence = parseAIVideoSequenceDocument(JSON.stringify({
		version: 1,
		kind: 'pointa.basehalf-ai-video.sequence',
		items: [
			{ id: 'one', title: 'One', nodeId: 'node-1', videoNodePath: 'one.bhnode', versionId: 'run-1' },
			{ id: 'two', title: 'Two', nodeId: 'node-2', videoNodePath: 'two.bhnode', versionId: 'run-2' }
		]
	}));
	const moved = moveAIVideoSequenceItem(sequence, 'two', 'up');
	assert.deepEqual(moved.items.map(item => item.id), ['two', 'one']);
	const updated = updateAIVideoSequenceItemVersion(moved, 'one', 'run-3');
	assert.equal(updated.items.find(item => item.id === 'one')?.versionId, 'run-3');
	assert.equal(updated.items.find(item => item.id === 'two')?.versionId, 'run-2');
	assert.deepEqual(parseAIVideoSequenceDocument(serializeAIVideoSequenceDocument(updated)), updated);
	assert.throws(() => moveAIVideoSequenceItem(sequence, 'missing', 'up'), /does not exist/);
	assert.throws(() => updateAIVideoSequenceItemVersion(sequence, 'missing', 'run-3'), /does not exist/);
});

test('adds and removes exact Sequence references without changing any node result', () => {
	const empty = parseAIVideoSequenceDocument(JSON.stringify({
		version: 1,
		kind: 'pointa.basehalf-ai-video.sequence',
		items: []
	}));
	const item = {
		id: 'sequence-item-01',
		title: 'Opening',
		nodeId: 'clip-node-01',
		videoNodePath: 'shots/shot-01/clip.bhnode',
		versionId: 'run-01'
	};
	const added = addAIVideoSequenceItem(empty, item);
	assert.deepEqual(added.items, [item]);
	assert.deepEqual(empty.items, []);
	assert.throws(() => addAIVideoSequenceItem(added, item), /already in the Sequence/);
	assert.throws(() => addAIVideoSequenceItem(added, { ...item, id: 'another-id', versionId: 'run-02' }), /already in the Sequence/);

	const removed = removeAIVideoSequenceItem(added, item.id);
	assert.deepEqual(removed.items, []);
	assert.equal(added.items[0].versionId, 'run-01');
	assert.throws(() => removeAIVideoSequenceItem(removed, item.id), /does not exist/);
});

test('deleting a Video removes only Sequence memberships with the same stable identity and exact rooted path', () => {
	const sequence = parseAIVideoSequenceDocument(JSON.stringify({
		version: 1,
		kind: 'pointa.basehalf-ai-video.sequence',
		items: [
			{ id: 'exact', title: 'Exact', nodeId: 'video-node', videoNodePath: 'shots/clip.bhnode', versionId: 'run-1' },
			{ id: 'exact-again', title: 'Exact again', nodeId: 'video-node', videoNodePath: 'shots/clip.bhnode', versionId: 'run-4' },
			{ id: 'same-identity-other-path', title: 'Other path', nodeId: 'video-node', videoNodePath: 'other/clip.bhnode', versionId: 'run-2' },
			{ id: 'same-path-other-identity', title: 'Other identity', nodeId: 'other-node', videoNodePath: 'shots/clip.bhnode', versionId: 'run-3' }
		]
	}));
	const cleaned = removeAIVideoSequenceItemsForNodeIdentity(sequence, 'video-node', 'shots/clip.bhnode');
	assert.deepEqual(cleaned.items.map(item => item.id), ['same-identity-other-path', 'same-path-other-identity']);
	assert.throws(() => removeAIVideoSequenceItemsForNodeIdentity(sequence, 'video-node', '../clip.bhnode'), /safe relative path/);
});

test('allows Sequence additions only from a verified Video Current', () => {
	assert.deepEqual(
		resolveAIVideoSequenceCurrentPin(videoNode('clip-node', 'run-2', [videoVersion('run-1', 'succeeded'), videoVersion('run-2', 'succeeded')])),
		{ nodeId: 'clip-node', versionId: 'run-2' }
	);
	assert.deepEqual(
		resolveAIVideoSequenceCurrentPin(videoNode('clip-node', 'revision-2', [videoVersion('revision-2', 'imported')])),
		{ nodeId: 'clip-node', versionId: 'revision-2' }
	);
	assert.throws(
		() => resolveAIVideoSequenceCurrentPin({ ...videoNode('clip-node', 'run-1', [videoVersion('run-1', 'succeeded')]), kind: 'image' }),
		/not a Video node/
	);
	assert.throws(
		() => resolveAIVideoSequenceCurrentPin({ id: 'clip-node', kind: 'video', versions: [] }),
		/does not have a Current/
	);
	assert.throws(
		() => resolveAIVideoSequenceCurrentPin(videoNode('clip-node', 'run-1', [videoVersion('run-1', 'failed')])),
		/status 'failed'/
	);
	assert.throws(
		() => resolveAIVideoSequenceCurrentPin(videoNode('clip-node', 'run-1', [videoVersion('run-1', 'succeeded', 'changed')])),
		/changed outside BaseHalf/
	);
});

test('uses the directory containing video-sequence.json as the workflow root', () => {
	assert.equal(isPlainLocalFileResource('file', '', ''), true);
	assert.equal(isPlainLocalFileResource('untitled', '', ''), false);
	assert.equal(isPlainLocalFileResource('file', 'view=source', ''), false);
	assert.equal(isPlainLocalFileResource('file', '', 'selection'), false);
	assert.equal(isFilePathInside('/workspace', '/workspace/video/video-sequence.json'), true);
	assert.equal(isFilePathInside('/workspace', '/workspace-other/video-sequence.json'), false);
	assert.equal(isFilePathInside('/workspace', '/workspace'), false);
	assert.equal(isFilePathInside('/workspace/project', '/workspace/project/../outside/video-sequence.json'), false);
	assert.equal(isOrdinaryFilePathInside('/workspace', '/workspace/video/video-sequence.json', true, false), true);
	assert.equal(isOrdinaryFilePathInside('/workspace', '/workspace/video/video-sequence.json', false, false), false);
	assert.equal(isOrdinaryFilePathInside('/workspace', '/workspace/video/video-sequence.json', true, true), false);
	assert.equal(isOrdinaryFilePathInside('/workspace', '/outside/video-sequence.json', true, false), false);
	assert.equal(
		portableDescendantVideoNodePath('/workspace/projects/episode-01', '/workspace/projects/episode-01/shots/shot-01/clip.bhnode'),
		'shots/shot-01/clip.bhnode'
	);
	assert.equal(
		resolveAIVideoSequenceVideoNodePath(
			'/workspace/projects/episode-01/video-sequence.json',
			'shots/shot-01/clip.bhnode'
		),
		'/workspace/projects/episode-01/shots/shot-01/clip.bhnode'
	);
	assert.throws(
		() => portableDescendantVideoNodePath('/workspace/projects/episode-01', '/workspace/projects/episode-02/clip.bhnode'),
		/inside the workflow root/
	);
	assert.throws(
		() => portableDescendantVideoNodePath('/workspace/video', '/workspace/video/clip.mp4'),
		/ending in '.bhnode'/
	);
});

test('parses a shot as portable domain metadata around one host video node', () => {
	const shot = parseAIVideoShotDocument(JSON.stringify({
		version: 1,
		kind: 'pointa.basehalf-ai-video.shot',
		id: 'shot-01',
		title: 'Opening',
		clipNodePath: 'clip.bhnode'
	}));
	assert.equal(shot.id, 'shot-01');
	assert.equal(shot.clipNodePath, 'clip.bhnode');
	assert.equal(
		resolveAIVideoShotClipNodePath('/workspace/projects/episode-01/shots/shot-01/shot.json', shot.clipNodePath),
		'/workspace/projects/episode-01/shots/shot-01/clip.bhnode'
	);
	assert.throws(() => parseAIVideoShotDocument(JSON.stringify({
		version: 1,
		kind: 'pointa.basehalf-ai-video.shot',
		id: 'shot-01',
		title: 'Opening',
		clipNodePath: 'clip.mp4'
	})), /ending in '.bhnode'/);
});

test('rejects ambiguous or unsafe sequence documents', () => {
	assert.throws(() => parseAIVideoSequenceDocument('{'), /not valid JSON/);
	assert.throws(() => parseAIVideoSequenceDocument(JSON.stringify({ version: 2, kind: 'pointa.basehalf-ai-video.sequence', items: [] })), /supported version 1/);
	assert.throws(() => parseAIVideoSequenceDocument(JSON.stringify({
		version: 1,
		kind: 'pointa.basehalf-ai-video.sequence',
		items: [
			{ id: 'same', title: 'One', nodeId: 'node-1', videoNodePath: 'one.bhnode', versionId: 'run-1' },
			{ id: 'same', title: 'Two', nodeId: 'node-2', videoNodePath: 'two.bhnode', versionId: 'run-2' }
		]
	})), /duplicate item id/);
	assert.throws(() => parseAIVideoSequenceDocument(JSON.stringify({
		version: 1,
		kind: 'pointa.basehalf-ai-video.sequence',
		items: [{ id: 'shot', title: 'Shot', nodeId: 'node-1', videoNodePath: '../clip.bhnode', versionId: 'run-1' }]
	})), /safe relative path/);
	assert.throws(() => parseAIVideoSequenceDocument(JSON.stringify({
		version: 1,
		kind: 'pointa.basehalf-ai-video.sequence',
		items: [{ id: 'shot', title: 'Shot', nodeId: 'node-1', videoNodePath: '.BH/clip.bhnode', versionId: 'run-1' }]
	})), /safe relative path/);
	assert.throws(() => parseAIVideoSequenceDocument(JSON.stringify({
		version: 1,
		kind: 'pointa.basehalf-ai-video.sequence',
		items: [{ id: 'shot', title: 'Shot', nodeId: 'node-1', videoNodePath: 'clip.bhnode', runId: 'run-1' }]
	})), /unsupported field 'runId'/);
});

test('uses the host portable-path contract for domain document references', () => {
	for (const videoNodePath of [
		'shots/.BH/clip.bhnode',
		'shots/e\u0301/clip.bhnode',
		'shots/\u0085clip.bhnode',
		'shots/AUX/clip.bhnode',
		'shots/draft./clip.bhnode',
		'shots/name</clip.bhnode',
		' shots/clip.bhnode '
	]) {
		assert.throws(() => parseAIVideoSequenceDocument(JSON.stringify({
			version: 1,
			kind: 'pointa.basehalf-ai-video.sequence',
			items: [{ id: 'shot', title: 'Shot', nodeId: 'node-1', videoNodePath, versionId: 'run-1' }]
		})), /safe relative path/);
	}
});

function videoNode(id: string, currentVersionId: string, versions: AIVideoSequenceNodeState['versions']): AIVideoSequenceNodeState {
	return { id, kind: 'video', currentVersionId, versions };
}

function videoVersion(
	id: string,
	status: AIVideoSequenceNodeState['versions'][number]['status'],
	integrity: 'available' | 'missing' | 'changed' = 'available',
	resource?: unknown
): AIVideoSequenceNodeState['versions'][number] {
	return { id, status, primaryArtifact: { kind: 'video', integrity, ...(resource === undefined ? {} : { resource }) } };
}
