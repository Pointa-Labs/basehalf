/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	AUDIO_BRIEF_RECIPE_ID,
	CLIP_BRIEF_RECIPE_ID,
	SEQUENCE_INSPECTION_CONCURRENCY,
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
	resolveAIVideoSequenceVideoNodePath,
	resolveAIVideoSequenceVideoResult,
	resolveAIVideoShotClipNodePath,
	serializeAIVideoSequenceDocument,
	updateAIVideoSequenceItemPath,
	validateRecipeInputs,
	type AIVideoRecipeInput,
	type AIVideoSequenceDocument,
	type AIVideoSequenceItem,
	type AIVideoSequenceNodeState
} from '../src/domain.ts';

test('keeps the host-owned prompt out of recipe parameters and supplies non-content defaults', () => {
	assert.deepEqual(parseStoryboardFrameParameters({}), {
		aspectRatio: '9:16',
		shotLabel: 'Shot'
	});
	assert.deepEqual(parseClipBriefParameters({
		'duration-seconds': 12,
		'aspect-ratio': '16:9',
		'audio-mode': 'none'
	}), {
		durationSeconds: 12,
		aspectRatio: '16:9',
		audioMode: 'none'
	});
	assert.deepEqual(parseAudioBriefParameters({ purpose: 'effect', voice: 'auto' }), {
		purpose: 'effect',
		durationSeconds: 5,
		voice: 'auto'
	});
});

test('rejects unsupported, out-of-range, and malformed recipe parameters', () => {
	assert.throws(() => parseStoryboardFrameParameters({ unknown: true }), /unsupported field/);
	assert.throws(() => parseStoryboardFrameParameters({ instructions: 'Retired duplicate prompt' }), /unsupported field/);
	assert.throws(() => parseStoryboardFrameParameters({ 'aspect-ratio': '4:3' }), /must be one of/);
	assert.throws(() => parseClipBriefParameters({ 'duration-seconds': 0 }), /integer from 1 to 120/);
	assert.throws(() => parseClipBriefParameters({ 'duration-seconds': 1.5 }), /integer from 1 to 120/);
	assert.throws(() => parseAudioBriefParameters({ voice: '' }), /cannot be empty/);
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
});

test('parses a portable Sequence of sealed Video Result nodes without version pins', () => {
	const sequence = sequenceDocument([
		sequenceItem('shot-01', 'clip-node-01', 'shots/shot-01/clip.bhnode'),
		sequenceItem('shot-02', 'clip-node-02', 'shots/shot-02/clip.bhnode')
	]);
	assert.deepEqual(sequence.items, [
		{ id: 'shot-01', title: 'Shot 01', nodeId: 'clip-node-01', videoNodePath: 'shots/shot-01/clip.bhnode' },
		{ id: 'shot-02', title: 'Shot 02', nodeId: 'clip-node-02', videoNodePath: 'shots/shot-02/clip.bhnode' }
	]);
	assert.deepEqual(parseAIVideoSequenceDocument(serializeAIVideoSequenceDocument(sequence)), sequence);
	assert.throws(() => parseAIVideoSequenceDocument(JSON.stringify({
		...sequence,
		items: [{ ...sequence.items[0], versionId: 'run-1' }]
	})), /unsupported field 'versionId'/);
});

test('validates only sealed result lifecycle and one available Video artifact', async () => {
	const sequence = sequenceDocument([sequenceItem('shot', 'clip-node', 'clip.bhnode')]);
	const resource = Object.freeze({ scheme: 'file', path: '/project/clip.mp4' });
	const inspection = await inspectAIVideoSequence(sequence, async () => videoResultNode('clip-node', videoArtifact('available', resource)));
	assert.deepEqual(inspection, {
		valid: true,
		items: [{
			item: sequence.items[0],
			state: 'result',
			message: 'Sealed Video Result is available.',
			artifact: { kind: 'video', integrity: 'available', resource }
		}]
	});

	for (const [node, message] of [
		[{ ...videoResultNode('clip-node'), kind: 'image' as const }, /not a Video node/],
		[videoResultNode('other-node'), /identity changed/],
		[videoResultNode('clip-node', videoArtifact(), 'running'), /lifecycle 'running'/],
		[videoResultNode('clip-node', null), /does not have/],
		[videoResultNode('clip-node', videoArtifact('missing')), /does not have/],
		[videoResultNode('clip-node', { kind: 'image', integrity: 'available' }), /does not have/]
	] as const) {
		const invalid = await inspectAIVideoSequence(sequence, async () => node);
		assert.equal(invalid.valid, false);
		assert.equal(invalid.items[0].state, 'invalid');
		assert.match(invalid.items[0].message, message);
	}
});

test('inspects each Sequence result once with bounded concurrency', async () => {
	const items = Array.from({ length: SEQUENCE_INSPECTION_CONCURRENCY * 3 }, (_, index) =>
		sequenceItem(`shot-${index}`, `node-${index}`, `shot-${index}.bhnode`));
	let active = 0;
	let maximumActive = 0;
	const calls = new Map<string, number>();
	const inspection = await inspectAIVideoSequence(sequenceDocument(items), async path => {
		calls.set(path, (calls.get(path) ?? 0) + 1);
		active++;
		maximumActive = Math.max(maximumActive, active);
		await new Promise(resolve => setTimeout(resolve, 1));
		active--;
		const index = Number(path.slice('shot-'.length, -'.bhnode'.length));
		return videoResultNode(`node-${index}`);
	});
	assert.equal(inspection.valid, true);
	assert.equal(calls.size, items.length);
	assert.equal([...calls.values()].every(count => count === 1), true);
	assert.equal(maximumActive <= SEQUENCE_INSPECTION_CONCURRENCY, true);
});

test('stops scheduling new Sequence inspections after cancellation', async () => {
	const items = Array.from({ length: 100 }, (_, index) => sequenceItem(`shot-${index}`, `node-${index}`, `shot-${index}.bhnode`));
	let calls = 0;
	let cancelled = false;
	await assert.rejects(() => inspectAIVideoSequence(
		sequenceDocument(items),
		async path => {
			calls++;
			cancelled = true;
			const index = Number(path.slice('shot-'.length, -'.bhnode'.length));
			return videoResultNode(`node-${index}`);
		},
		undefined,
		() => {
			if (cancelled) {
				throw new Error('cancelled');
			}
		}
	), /cancelled/);
	assert.equal(calls <= SEQUENCE_INSPECTION_CONCURRENCY, true);
});

test('offers only a unique moved sealed-result path for explicit repair', async () => {
	const sequence = sequenceDocument([sequenceItem('shot', 'clip-node', 'old/clip.bhnode')]);
	const inspection = await inspectAIVideoSequence(
		sequence,
		async () => undefined,
		async () => ({ kind: 'unique', videoNodePath: 'moved/clip.bhnode', node: videoResultNode('clip-node') })
	);
	assert.equal(inspection.valid, false);
	assert.equal(inspection.items[0].repairCandidatePath, 'moved/clip.bhnode');
	assert.match(inspection.items[0].message, /Video Result moved/);

	for (const relocation of [
		{ kind: 'ambiguous' as const, matchCount: 2 },
		{ kind: 'scanLimit' as const, maximum: 256 },
		{ kind: 'unique' as const, videoNodePath: '../unsafe.bhnode', node: videoResultNode('clip-node') },
		{ kind: 'unique' as const, videoNodePath: 'moved/clip.bhnode', node: videoResultNode('other-node') },
		{ kind: 'unique' as const, videoNodePath: 'moved/clip.bhnode', node: videoResultNode('clip-node', null, 'running') }
	]) {
		const invalid = await inspectAIVideoSequence(sequence, async () => undefined, async () => relocation);
		assert.equal(invalid.items[0].repairCandidatePath, undefined);
	}
});

test('adds, moves, repairs, and removes node references without changing Video Results', () => {
	const empty = sequenceDocument([]);
	const one = sequenceItem('one', 'node-1', 'one.bhnode');
	const two = sequenceItem('two', 'node-2', 'two.bhnode');
	const added = addAIVideoSequenceItem(addAIVideoSequenceItem(empty, one), two);
	assert.deepEqual(added.items.map(item => item.id), ['one', 'two']);
	assert.throws(() => addAIVideoSequenceItem(added, { ...one, id: 'duplicate' }), /already in the Sequence/);
	assert.deepEqual(moveAIVideoSequenceItem(added, 'two', 'up').items.map(item => item.id), ['two', 'one']);
	assert.equal(updateAIVideoSequenceItemPath(added, 'one', 'moved/one.bhnode').items[0].videoNodePath, 'moved/one.bhnode');
	assert.deepEqual(removeAIVideoSequenceItem(added, 'one').items, [two]);
	assert.throws(() => moveAIVideoSequenceItem(added, 'missing', 'up'), /does not exist/);
	assert.throws(() => updateAIVideoSequenceItemPath(added, 'missing', 'moved.bhnode'), /does not exist/);
	assert.throws(() => removeAIVideoSequenceItem(empty, 'missing'), /does not exist/);
});

test('deleting a Video Result removes only memberships with its identity and rooted path', () => {
	const sequence = sequenceDocument([
		sequenceItem('exact', 'video-node', 'shots/clip.bhnode'),
		sequenceItem('same-identity-other-path', 'video-node', 'other/clip.bhnode'),
		sequenceItem('same-path-other-identity', 'other-node', 'shots/clip.bhnode')
	]);
	const cleaned = removeAIVideoSequenceItemsForNodeIdentity(sequence, 'video-node', 'shots/clip.bhnode');
	assert.deepEqual(cleaned.items.map(item => item.id), ['same-identity-other-path', 'same-path-other-identity']);
	assert.throws(() => removeAIVideoSequenceItemsForNodeIdentity(sequence, 'video-node', '../clip.bhnode'), /safe relative path/);
});

test('allows Sequence additions only from a sealed Video Result with one playable artifact', () => {
	assert.deepEqual(resolveAIVideoSequenceVideoResult(videoResultNode('clip-node')), {
		nodeId: 'clip-node',
		artifact: { kind: 'video', integrity: 'available' }
	});
	assert.throws(() => resolveAIVideoSequenceVideoResult({ ...videoResultNode('clip-node'), kind: 'image' }), /not a Video node/);
	assert.throws(() => resolveAIVideoSequenceVideoResult(videoResultNode('clip-node', null, 'draft')), /lifecycle 'draft'/);
	assert.throws(() => resolveAIVideoSequenceVideoResult(videoResultNode('clip-node', null)), /does not have/);
	assert.throws(() => resolveAIVideoSequenceVideoResult(videoResultNode('clip-node', videoArtifact('changed'))), /does not have/);
});

test('uses the directory containing video-sequence.json as the workflow root', () => {
	assert.equal(isPlainLocalFileResource('file', '', ''), true);
	assert.equal(isPlainLocalFileResource('untitled', '', ''), false);
	assert.equal(isPlainLocalFileResource('file', 'view=source', ''), false);
	assert.equal(isFilePathInside('/workspace', '/workspace/video/video-sequence.json'), true);
	assert.equal(isFilePathInside('/workspace', '/workspace-other/video-sequence.json'), false);
	assert.equal(isFilePathInside('/workspace', '/workspace'), false);
	assert.equal(isOrdinaryFilePathInside('/workspace', '/workspace/video/video-sequence.json', true, false), true);
	assert.equal(isOrdinaryFilePathInside('/workspace', '/workspace/video/video-sequence.json', true, true), false);
	assert.equal(portableDescendantVideoNodePath('/workspace/project', '/workspace/project/shots/clip.bhnode'), 'shots/clip.bhnode');
	assert.equal(resolveAIVideoSequenceVideoNodePath('/workspace/project/video-sequence.json', 'shots/clip.bhnode'), '/workspace/project/shots/clip.bhnode');
	assert.throws(() => portableDescendantVideoNodePath('/workspace/one', '/workspace/two/clip.bhnode'), /inside the workflow root/);
});

test('parses a shot as portable metadata around one Video Result node', () => {
	const shot = parseAIVideoShotDocument(JSON.stringify({
		version: 1,
		kind: 'pointa.basehalf-ai-video.shot',
		id: 'shot-01',
		title: 'Opening',
		clipNodePath: 'clip.bhnode'
	}));
	assert.equal(shot.clipNodePath, 'clip.bhnode');
	assert.equal(resolveAIVideoShotClipNodePath('/workspace/shots/shot-01/shot.json', shot.clipNodePath), '/workspace/shots/shot-01/clip.bhnode');
	assert.throws(() => parseAIVideoShotDocument(JSON.stringify({ ...shot, clipNodePath: 'clip.mp4' })), /ending in '.bhnode'/);
});

test('rejects ambiguous, legacy, and unsafe Sequence documents', () => {
	assert.throws(() => parseAIVideoSequenceDocument('{'), /not valid JSON/);
	assert.throws(() => parseAIVideoSequenceDocument(JSON.stringify({ version: 2, kind: 'pointa.basehalf-ai-video.sequence', items: [] })), /supported version 1/);
	assert.throws(() => parseAIVideoSequenceDocument(JSON.stringify({
		version: 1,
		kind: 'pointa.basehalf-ai-video.sequence',
		items: [sequenceItem('same', 'node-1', 'one.bhnode'), sequenceItem('same', 'node-2', 'two.bhnode')]
	})), /duplicate item id/);
	for (const videoNodePath of ['../clip.bhnode', '.BH/clip.bhnode', 'shots/.BH/clip.bhnode', 'shots/e\u0301/clip.bhnode', 'shots/AUX/clip.bhnode', ' shots/clip.bhnode ']) {
		assert.throws(() => parseAIVideoSequenceDocument(JSON.stringify({
			version: 1,
			kind: 'pointa.basehalf-ai-video.sequence',
			items: [sequenceItem('shot', 'node-1', videoNodePath)]
		})), /safe relative path/);
	}
	assert.throws(() => parseAIVideoSequenceDocument(JSON.stringify({
		version: 1,
		kind: 'pointa.basehalf-ai-video.sequence',
		items: [{ ...sequenceItem('shot', 'node-1', 'clip.bhnode'), runId: 'run-1' }]
	})), /unsupported field 'runId'/);
});

function sequenceDocument(items: readonly AIVideoSequenceItem[]): AIVideoSequenceDocument {
	return parseAIVideoSequenceDocument(JSON.stringify({
		version: 1,
		kind: 'pointa.basehalf-ai-video.sequence',
		items
	}));
}

function sequenceItem(id: string, nodeId: string, videoNodePath: string): AIVideoSequenceItem {
	return { id, title: id.replace(/^./, character => character.toUpperCase()).replace(/-/g, ' '), nodeId, videoNodePath };
}

function videoResultNode(
	id: string,
	artifact: NonNullable<AIVideoSequenceNodeState['result']>['artifact'] | null = videoArtifact(),
	lifecycle: AIVideoSequenceNodeState['lifecycle'] = 'result'
): AIVideoSequenceNodeState {
	return { id, kind: 'video', lifecycle, ...(artifact === null ? {} : { result: { artifact } }) };
}

function videoArtifact(
	integrity: 'available' | 'missing' | 'changed' = 'available',
	resource?: unknown
): NonNullable<AIVideoSequenceNodeState['result']>['artifact'] {
	return { kind: 'video', integrity, ...(resource === undefined ? {} : { resource }) };
}
