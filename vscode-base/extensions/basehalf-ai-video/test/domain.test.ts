/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	SEQUENCE_INSPECTION_CONCURRENCY,
	addAIVideoSequenceItem,
	inspectAIVideoSequence,
	isAIVideoSequenceVideoPath,
	isFilePathInside,
	isOrdinaryFilePathInside,
	isPlainLocalFileResource,
	moveAIVideoSequenceItem,
	parseAIVideoSequenceDocument,
	parseAIVideoShotDocument,
	portableDescendantVideoPath,
	removeAIVideoSequenceItem,
	resolveAIVideoSequenceVideo,
	resolveAIVideoSequenceVideoPath,
	resolveAIVideoShotClipNodePath,
	serializeAIVideoSequenceDocument,
	updateAIVideoSequenceItemPath,
	type AIVideoSequenceDocument,
	type AIVideoSequenceItem,
	type AIVideoSequenceVideoState
} from '../src/domain.ts';

test('parses a portable Sequence of video files, with the id of the made.yaml of a generated one', () => {
	const sequence = sequenceDocument([
		sequenceItem('shot-01', 'shots/shot-01/clip.mp4', '20261019T080000-k3f9'),
		sequenceItem('shot-02', 'shots/shot-02/imported.MOV')
	]);
	assert.deepEqual(sequence.items, [
		{ id: 'shot-01', title: 'Shot 01', videoPath: 'shots/shot-01/clip.mp4', generationId: '20261019T080000-k3f9' },
		{ id: 'shot-02', title: 'Shot 02', videoPath: 'shots/shot-02/imported.MOV' }
	]);
	assert.deepEqual(parseAIVideoSequenceDocument(serializeAIVideoSequenceDocument(sequence)), sequence);
	assert.equal(serializeAIVideoSequenceDocument(sequence).includes('generationId'), true);
	// The retired fields of a clip that named a Video node are not read (D63).
	for (const retired of [{ nodeId: 'clip-node' }, { videoNodePath: 'shots/clip.bhnode' }, { versionId: 'run-1' }]) {
		assert.throws(() => parseAIVideoSequenceDocument(JSON.stringify({ ...sequence, items: [{ ...sequence.items[0], ...retired }] })), /unsupported field/);
	}
	assert.throws(() => parseAIVideoSequenceDocument(JSON.stringify({ ...sequence, items: [{ id: 'old', title: 'Old', nodeId: 'n', videoNodePath: 'shots/clip.bhnode' }] })), /unsupported field 'nodeId'/);
});

test('an item is available when its path is a video file and, with a generationId, that file\'s made.yaml has it', async () => {
	const generated = sequenceItem('generated', 'clip.mp4', 'task-1');
	const imported = sequenceItem('imported', 'imported.mp4');
	const resource = Object.freeze({ scheme: 'file', path: '/project/clip.mp4' });
	const available = await inspectAIVideoSequence(sequenceDocument([generated, imported]), async path => path === 'clip.mp4'
		? { isVideoFile: true, generationId: 'task-1', resource }
		: { isVideoFile: true });
	assert.deepEqual(available, {
		valid: true,
		items: [
			{ item: generated, state: 'available', message: 'The video is available.', video: { resource } },
			{ item: imported, state: 'available', message: 'The video is available.', video: {} }
		]
	});

	for (const [video, state, message] of [
		[{ isVideoFile: false }, 'missing', /'clip\.mp4' is missing/],
		// Another video took its path: one without a record, and one of another generation.
		[{ isVideoFile: true }, 'changed', /not the one this clip names/],
		[{ isVideoFile: true, generationId: 'task-2' }, 'changed', /not the one this clip names/]
	] as const) {
		const inspection = await inspectAIVideoSequence(sequenceDocument([generated]), async () => video);
		assert.equal(inspection.valid, false);
		assert.equal(inspection.items[0].state, state);
		assert.match(inspection.items[0].message, message);
		assert.equal(inspection.items[0].video, undefined);
	}
	const failing = await inspectAIVideoSequence(sequenceDocument([imported]), async () => { throw new Error('The disk is gone.'); });
	assert.deepEqual([failing.items[0].state, failing.items[0].message], ['missing', 'The disk is gone.']);
});

test('inspects each clip once with bounded concurrency', async () => {
	const items = Array.from({ length: SEQUENCE_INSPECTION_CONCURRENCY * 3 }, (_, index) => sequenceItem(`shot-${index}`, `shot-${index}.mp4`, `task-${index}`));
	let active = 0;
	let maximumActive = 0;
	const calls = new Map<string, number>();
	const inspection = await inspectAIVideoSequence(sequenceDocument(items), async path => {
		calls.set(path, (calls.get(path) ?? 0) + 1);
		active++;
		maximumActive = Math.max(maximumActive, active);
		await new Promise(resolve => setTimeout(resolve, 1));
		active--;
		return { isVideoFile: true, generationId: `task-${Number(path.slice('shot-'.length, -'.mp4'.length))}` };
	});
	assert.equal(inspection.valid, true);
	assert.equal(calls.size, items.length);
	assert.equal([...calls.values()].every(count => count === 1), true);
	assert.equal(maximumActive <= SEQUENCE_INSPECTION_CONCURRENCY, true);
});

test('stops scheduling new inspections after cancellation', async () => {
	const items = Array.from({ length: 100 }, (_, index) => sequenceItem(`shot-${index}`, `shot-${index}.mp4`));
	let calls = 0;
	let cancelled = false;
	await assert.rejects(() => inspectAIVideoSequence(
		sequenceDocument(items),
		async () => {
			calls++;
			cancelled = true;
			return { isVideoFile: true };
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

test('offers to repair the path of a missing or changed clip only when exactly one video of its generation is found', async () => {
	const item = sequenceItem('shot', 'old/clip.mp4', 'task-1');
	const missing: AIVideoSequenceVideoState = { isVideoFile: false };
	const located: string[] = [];
	const repair = await inspectAIVideoSequence(sequenceDocument([item]), async () => missing, async candidate => {
		located.push(candidate.generationId!);
		return { kind: 'unique', videoPath: 'moved/clip.mp4' };
	});
	assert.deepEqual([repair.valid, repair.items[0].state, repair.items[0].repairCandidatePath, located], [false, 'missing', 'moved/clip.mp4', ['task-1']]);
	assert.match(repair.items[0].message, /moved to 'moved\/clip\.mp4'/);
	const changed = await inspectAIVideoSequence(sequenceDocument([item]), async () => ({ isVideoFile: true, generationId: 'task-9' }), async () => ({ kind: 'unique', videoPath: 'moved/clip.mp4' }));
	assert.deepEqual([changed.items[0].state, changed.items[0].repairCandidatePath], ['changed', 'moved/clip.mp4']);

	for (const [relocation, message] of [
		[undefined, /No video of its generation was found/],
		[{ kind: 'ambiguous' as const, matchCount: 2 }, /2 videos/],
		[{ kind: 'scanLimit' as const, maximum: 256 }, /more than 256 videos/],
		[{ kind: 'unique' as const, videoPath: '../unsafe.mp4' }, /safe relative path/],
		[{ kind: 'unique' as const, videoPath: 'moved/clip.bhnode' }, /safe relative path/],
		[{ kind: 'unique' as const, videoPath: 'old/clip.mp4' }, /is missing/]
	] as const) {
		const invalid = await inspectAIVideoSequence(sequenceDocument([item]), async () => missing, async () => relocation);
		assert.equal(invalid.items[0].repairCandidatePath, undefined);
		assert.match(invalid.items[0].message, message);
	}
	// A clip without a generationId is never looked for.
	const plain = await inspectAIVideoSequence(sequenceDocument([sequenceItem('plain', 'old/clip.mp4')]), async () => missing, async () => {
		throw new Error('must not look');
	});
	assert.deepEqual([plain.items[0].state, plain.items[0].repairCandidatePath], ['missing', undefined]);
});

test('adds, moves, repairs, and removes clips without changing their videos; Repair Moved changes only the path', () => {
	const empty = sequenceDocument([]);
	const one = sequenceItem('one', 'one.mp4', 'task-1');
	const two = sequenceItem('two', 'two.mp4');
	const added = addAIVideoSequenceItem(addAIVideoSequenceItem(empty, one), two);
	assert.deepEqual(added.items.map(item => item.id), ['one', 'two']);
	assert.throws(() => addAIVideoSequenceItem(added, { ...one, id: 'same-path' }), /already in the Sequence/);
	assert.throws(() => addAIVideoSequenceItem(added, { ...one, id: 'same-generation', videoPath: 'copy.mp4' }), /already in the Sequence/);
	assert.deepEqual(moveAIVideoSequenceItem(added, 'two', 'up').items.map(item => item.id), ['two', 'one']);
	assert.deepEqual(updateAIVideoSequenceItemPath(added, 'one', 'moved/one.mp4').items[0], { ...one, videoPath: 'moved/one.mp4' });
	assert.deepEqual(removeAIVideoSequenceItem(added, 'one').items, [two]);
	assert.throws(() => moveAIVideoSequenceItem(added, 'missing', 'up'), /does not exist/);
	assert.throws(() => updateAIVideoSequenceItemPath(added, 'missing', 'moved.mp4'), /does not exist/);
	assert.throws(() => updateAIVideoSequenceItemPath(added, 'one', 'moved.bhnode'), /safe relative path/);
	assert.throws(() => removeAIVideoSequenceItem(empty, 'missing'), /does not exist/);
});

test('adds a video card with its file, with the id of its made.yaml when it has one', () => {
	assert.deepEqual(resolveAIVideoSequenceVideo('clip.mp4', true, { kind: 'video', hasFile: true, generationId: 'task-1' }), { generationId: 'task-1' });
	assert.deepEqual(resolveAIVideoSequenceVideo('uploaded.mp4', true, { kind: 'video', hasFile: true }), {});
	assert.deepEqual(resolveAIVideoSequenceVideo('imported.mp4', true, undefined), {});
	assert.throws(() => resolveAIVideoSequenceVideo('draft.mp4', false, { kind: 'video', hasFile: false }), /has no video yet/);
	assert.throws(() => resolveAIVideoSequenceVideo('frame.png', true, { kind: 'image', hasFile: true }), /image card/);
	assert.throws(() => resolveAIVideoSequenceVideo('gone.mp4', false, undefined), /not a video file/);
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
	assert.equal(portableDescendantVideoPath('/workspace/project', '/workspace/project/shots/clip.mp4'), 'shots/clip.mp4');
	assert.equal(resolveAIVideoSequenceVideoPath('/workspace/project/video-sequence.json', 'shots/clip.mp4'), '/workspace/project/shots/clip.mp4');
	assert.throws(() => portableDescendantVideoPath('/workspace/one', '/workspace/two/clip.mp4'), /inside the folder of the Sequence/);
	assert.throws(() => portableDescendantVideoPath('/workspace/one', '/workspace/one/notes.md'), /video file/);
	assert.deepEqual(['a.mp4', 'a.MOV', 'b/c.m4v', 'd.webm', 'e.bhnode', 'f.mp4.md', '.mp4', 'g/.mp4'].map(isAIVideoSequenceVideoPath), [true, true, true, true, false, false, false, false]);
});

test('parses a shot as portable metadata around its video card, a draft until it generates', () => {
	const shot = parseAIVideoShotDocument(JSON.stringify({
		version: 1,
		kind: 'pointa.basehalf-ai-video.shot',
		id: 'shot-01',
		title: 'Opening',
		clipNodePath: 'clip.mp4'
	}));
	assert.equal(shot.clipNodePath, 'clip.mp4');
	assert.equal(resolveAIVideoShotClipNodePath('/workspace/shots/shot-01/shot.json', shot.clipNodePath), '/workspace/shots/shot-01/clip.mp4');
	assert.throws(() => parseAIVideoShotDocument(JSON.stringify({ ...shot, clipNodePath: 'clip.bhnode' })), /video file/);
});

test('rejects ambiguous, legacy, and unsafe Sequence documents', () => {
	assert.throws(() => parseAIVideoSequenceDocument('{'), /not valid JSON/);
	assert.throws(() => parseAIVideoSequenceDocument(JSON.stringify({ version: 2, kind: 'pointa.basehalf-ai-video.sequence', items: [] })), /supported version 1/);
	assert.throws(() => parseAIVideoSequenceDocument(JSON.stringify({
		version: 1,
		kind: 'pointa.basehalf-ai-video.sequence',
		items: [sequenceItem('same', 'one.mp4'), sequenceItem('same', 'two.mp4')]
	})), /duplicate item id/);
	for (const videoPath of ['../clip.mp4', '.BH/clip.mp4', 'shots/.BH/clip.mp4', 'shots/é/clip.mp4', 'shots/AUX/clip.mp4', ' shots/clip.mp4 ', 'shots/clip.bhnode', 'shots/notes.md']) {
		assert.throws(() => parseAIVideoSequenceDocument(JSON.stringify({
			version: 1,
			kind: 'pointa.basehalf-ai-video.sequence',
			items: [sequenceItem('shot', videoPath)]
		})), /safe relative path/, videoPath);
	}
	for (const generationId of ['', ' task', 'task/1', 'x'.repeat(129), 42]) {
		assert.throws(() => parseAIVideoSequenceDocument(JSON.stringify({
			version: 1,
			kind: 'pointa.basehalf-ai-video.sequence',
			items: [{ ...sequenceItem('shot', 'clip.mp4'), generationId }]
		})), /generationId/, String(generationId));
	}
	assert.throws(() => parseAIVideoSequenceDocument(JSON.stringify({
		version: 1,
		kind: 'pointa.basehalf-ai-video.sequence',
		items: [{ ...sequenceItem('shot', 'clip.mp4'), runId: 'run-1' }]
	})), /unsupported field 'runId'/);
});

function sequenceDocument(items: readonly AIVideoSequenceItem[]): AIVideoSequenceDocument {
	return parseAIVideoSequenceDocument(JSON.stringify({
		version: 1,
		kind: 'pointa.basehalf-ai-video.sequence',
		items
	}));
}

function sequenceItem(id: string, videoPath: string, generationId?: string): AIVideoSequenceItem {
	return {
		id,
		title: id.replace(/^./, character => character.toUpperCase()).replace(/-/g, ' '),
		videoPath,
		...(generationId === undefined ? {} : { generationId })
	};
}
