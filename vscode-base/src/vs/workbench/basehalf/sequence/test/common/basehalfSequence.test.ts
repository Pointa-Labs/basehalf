/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	addBaseHalfSequenceItem,
	BASEHALF_SEQUENCE_INSPECTION_CONCURRENCY,
	baseHalfSequenceVideoPathOf,
	IBaseHalfSequenceDocument,
	IBaseHalfSequenceItem,
	IBaseHalfSequenceVideoState,
	inspectBaseHalfSequence,
	isBaseHalfPlainLocalFile,
	isBaseHalfResourceInside,
	isBaseHalfSequenceVideoPath,
	moveBaseHalfSequenceItem,
	parseBaseHalfSequenceDocument,
	parseBaseHalfShotDocument,
	removeBaseHalfSequenceItem,
	resolveBaseHalfSequenceVideo,
	resolveBaseHalfSequenceVideoCard,
	resolveBaseHalfShotClip,
	serializeBaseHalfSequenceDocument,
	updateBaseHalfSequenceItemPath
} from '../../common/basehalfSequence.js';

suite('BaseHalfSequence', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('parses a portable Sequence of video files, with the id of the made.yaml of a generated one', () => {
		const sequence = sequenceDocument([
			sequenceItem('shot-01', 'shots/shot-01/clip.mp4', '20261019T080000-k3f9'),
			sequenceItem('shot-02', 'shots/shot-02/imported.MOV')
		]);
		assert.deepStrictEqual(sequence.items, [
			{ id: 'shot-01', title: 'Shot 01', videoPath: 'shots/shot-01/clip.mp4', generationId: '20261019T080000-k3f9' },
			{ id: 'shot-02', title: 'Shot 02', videoPath: 'shots/shot-02/imported.MOV' }
		]);
		assert.deepStrictEqual(parseBaseHalfSequenceDocument(serializeBaseHalfSequenceDocument(sequence)), sequence);
		assert.strictEqual(serializeBaseHalfSequenceDocument(sequence).includes('generationId'), true);
		// The retired fields of a clip that named a Video node are not read (D63).
		for (const retired of [{ nodeId: 'clip-node' }, { videoNodePath: 'shots/clip.bhnode' }, { versionId: 'run-1' }]) {
			assert.throws(() => parseBaseHalfSequenceDocument(JSON.stringify({ ...sequence, items: [{ ...sequence.items[0], ...retired }] })), /unsupported field/);
		}
		assert.throws(() => parseBaseHalfSequenceDocument(JSON.stringify({ ...sequence, items: [{ id: 'old', title: 'Old', nodeId: 'n', videoNodePath: 'shots/clip.bhnode' }] })), /unsupported field 'nodeId'/);
	});

	test('an item is available when its path is a video file and, with a generationId, that file\'s made.yaml has it', async () => {
		const generated = sequenceItem('generated', 'clip.mp4', 'task-1');
		const imported = sequenceItem('imported', 'imported.mp4');
		const resource = URI.file('/project/clip.mp4');
		const available = await inspectBaseHalfSequence(sequenceDocument([generated, imported]), async path => path === 'clip.mp4'
			? { isVideoFile: true, generationId: 'task-1', resource }
			: { isVideoFile: true });
		assert.deepStrictEqual(available, {
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
			const inspection = await inspectBaseHalfSequence(sequenceDocument([generated]), async () => video);
			assert.strictEqual(inspection.valid, false);
			assert.strictEqual(inspection.items[0].state, state);
			assert.match(inspection.items[0].message, message);
			assert.strictEqual(inspection.items[0].video, undefined);
		}
		const failing = await inspectBaseHalfSequence(sequenceDocument([imported]), async () => { throw new Error('The disk is gone.'); });
		assert.deepStrictEqual([failing.items[0].state, failing.items[0].message], ['missing', 'The disk is gone.']);
	});

	test('inspects each clip once with bounded concurrency', async () => {
		const items = Array.from({ length: BASEHALF_SEQUENCE_INSPECTION_CONCURRENCY * 3 }, (_, index) => sequenceItem(`shot-${index}`, `shot-${index}.mp4`, `task-${index}`));
		let active = 0;
		let maximumActive = 0;
		const calls = new Map<string, number>();
		const inspection = await inspectBaseHalfSequence(sequenceDocument(items), async path => {
			calls.set(path, (calls.get(path) ?? 0) + 1);
			active++;
			maximumActive = Math.max(maximumActive, active);
			await new Promise(resolve => setTimeout(resolve, 1));
			active--;
			return { isVideoFile: true, generationId: `task-${Number(path.slice('shot-'.length, -'.mp4'.length))}` };
		});
		assert.strictEqual(inspection.valid, true);
		assert.strictEqual(calls.size, items.length);
		assert.strictEqual([...calls.values()].every(count => count === 1), true);
		assert.strictEqual(maximumActive <= BASEHALF_SEQUENCE_INSPECTION_CONCURRENCY, true);
	});

	test('stops scheduling new inspections after cancellation', async () => {
		const items = Array.from({ length: 100 }, (_, index) => sequenceItem(`shot-${index}`, `shot-${index}.mp4`));
		let calls = 0;
		let cancelled = false;
		await assert.rejects(() => inspectBaseHalfSequence(
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
		assert.strictEqual(calls <= BASEHALF_SEQUENCE_INSPECTION_CONCURRENCY, true);
	});

	test('offers to repair the path of a missing or changed clip only when exactly one video of its generation is found', async () => {
		const item = sequenceItem('shot', 'old/clip.mp4', 'task-1');
		const missing: IBaseHalfSequenceVideoState = { isVideoFile: false };
		const located: string[] = [];
		const repair = await inspectBaseHalfSequence(sequenceDocument([item]), async () => missing, async candidate => {
			located.push(candidate.generationId!);
			return { kind: 'unique', videoPath: 'moved/clip.mp4' };
		});
		assert.deepStrictEqual([repair.valid, repair.items[0].state, repair.items[0].repairCandidatePath, located], [false, 'missing', 'moved/clip.mp4', ['task-1']]);
		assert.match(repair.items[0].message, /moved to 'moved\/clip\.mp4'/);
		const changed = await inspectBaseHalfSequence(sequenceDocument([item]), async () => ({ isVideoFile: true, generationId: 'task-9' }), async () => ({ kind: 'unique', videoPath: 'moved/clip.mp4' }));
		assert.deepStrictEqual([changed.items[0].state, changed.items[0].repairCandidatePath], ['changed', 'moved/clip.mp4']);

		for (const [relocation, message] of [
			[undefined, /No video of its generation was found/],
			[{ kind: 'ambiguous' as const, matchCount: 2 }, /2 videos/],
			[{ kind: 'scanLimit' as const, maximum: 256 }, /more than 256 videos/],
			[{ kind: 'unique' as const, videoPath: '../unsafe.mp4' }, /safe relative path/],
			[{ kind: 'unique' as const, videoPath: 'moved/clip.bhnode' }, /safe relative path/],
			[{ kind: 'unique' as const, videoPath: 'old/clip.mp4' }, /is missing/]
		] as const) {
			const invalid = await inspectBaseHalfSequence(sequenceDocument([item]), async () => missing, async () => relocation);
			assert.strictEqual(invalid.items[0].repairCandidatePath, undefined);
			assert.match(invalid.items[0].message, message);
		}
		// A clip without a generationId is never looked for.
		const plain = await inspectBaseHalfSequence(sequenceDocument([sequenceItem('plain', 'old/clip.mp4')]), async () => missing, async () => {
			throw new Error('must not look');
		});
		assert.deepStrictEqual([plain.items[0].state, plain.items[0].repairCandidatePath], ['missing', undefined]);
	});

	test('adds, moves, repairs, and removes clips without changing their videos; Repair Moved changes only the path', () => {
		const empty = sequenceDocument([]);
		const one = sequenceItem('one', 'one.mp4', 'task-1');
		const two = sequenceItem('two', 'two.mp4');
		const added = addBaseHalfSequenceItem(addBaseHalfSequenceItem(empty, one), two);
		assert.deepStrictEqual(added.items.map(item => item.id), ['one', 'two']);
		assert.throws(() => addBaseHalfSequenceItem(added, { ...one, id: 'same-path' }), /already in the Sequence/);
		assert.throws(() => addBaseHalfSequenceItem(added, { ...one, id: 'same-generation', videoPath: 'copy.mp4' }), /already in the Sequence/);
		assert.deepStrictEqual(moveBaseHalfSequenceItem(added, 'two', 'up').items.map(item => item.id), ['two', 'one']);
		assert.deepStrictEqual(updateBaseHalfSequenceItemPath(added, 'one', 'moved/one.mp4').items[0], { ...one, videoPath: 'moved/one.mp4' });
		assert.deepStrictEqual(removeBaseHalfSequenceItem(added, 'one').items, [two]);
		assert.throws(() => moveBaseHalfSequenceItem(added, 'missing', 'up'), /does not exist/);
		assert.throws(() => updateBaseHalfSequenceItemPath(added, 'missing', 'moved.mp4'), /does not exist/);
		assert.throws(() => updateBaseHalfSequenceItemPath(added, 'one', 'moved.bhnode'), /safe relative path/);
		assert.throws(() => removeBaseHalfSequenceItem(empty, 'missing'), /does not exist/);
	});

	test('adds a video card with its file, with the id of its made.yaml when it has one', () => {
		assert.deepStrictEqual(resolveBaseHalfSequenceVideoCard('clip.mp4', true, { kind: 'video', hasFile: true, generationId: 'task-1' }), { generationId: 'task-1' });
		assert.deepStrictEqual(resolveBaseHalfSequenceVideoCard('uploaded.mp4', true, { kind: 'video', hasFile: true }), {});
		assert.deepStrictEqual(resolveBaseHalfSequenceVideoCard('imported.mp4', true, undefined), {});
		assert.throws(() => resolveBaseHalfSequenceVideoCard('draft.mp4', false, { kind: 'video', hasFile: false }), /has no video yet/);
		assert.throws(() => resolveBaseHalfSequenceVideoCard('frame.png', true, { kind: 'image', hasFile: true }), /image card/);
		assert.throws(() => resolveBaseHalfSequenceVideoCard('song.wav', true, { kind: 'audio', hasFile: true }), /'song\.wav' is an audio card, not a video\./);
		assert.throws(() => resolveBaseHalfSequenceVideoCard('gone.mp4', false, undefined), /not a video file/);
	});

	test('uses the directory containing video-sequence.json as the workflow root', () => {
		assert.strictEqual(isBaseHalfPlainLocalFile(URI.file('/workspace/video-sequence.json')), true);
		assert.strictEqual(isBaseHalfPlainLocalFile(URI.from({ scheme: 'untitled', path: '/video-sequence.json' })), false);
		assert.strictEqual(isBaseHalfPlainLocalFile(URI.file('/workspace/video-sequence.json').with({ query: 'view=source' })), false);
		assert.strictEqual(isBaseHalfResourceInside(URI.file('/workspace'), URI.file('/workspace/video/video-sequence.json')), true);
		assert.strictEqual(isBaseHalfResourceInside(URI.file('/workspace'), URI.file('/workspace-other/video-sequence.json')), false);
		assert.strictEqual(isBaseHalfResourceInside(URI.file('/workspace'), URI.file('/workspace')), false);
		assert.strictEqual(baseHalfSequenceVideoPathOf(URI.file('/workspace/project'), URI.file('/workspace/project/shots/clip.mp4')), 'shots/clip.mp4');
		assert.strictEqual(resolveBaseHalfSequenceVideo(URI.file('/workspace/project/video-sequence.json'), 'shots/clip.mp4').toString(), URI.file('/workspace/project/shots/clip.mp4').toString());
		assert.throws(() => baseHalfSequenceVideoPathOf(URI.file('/workspace/one'), URI.file('/workspace/two/clip.mp4')), /inside the folder of the Sequence/);
		assert.throws(() => baseHalfSequenceVideoPathOf(URI.file('/workspace/one'), URI.file('/workspace/one/notes.md')), /video file/);
		assert.throws(() => resolveBaseHalfSequenceVideo(URI.file('/workspace/project/video-sequence.json'), '../clip.mp4'), /safe relative path/);
		assert.deepStrictEqual(['a.mp4', 'a.MOV', 'b/c.m4v', 'd.webm', 'e.bhnode', 'f.mp4.md', '.mp4', 'g/.mp4'].map(isBaseHalfSequenceVideoPath), [true, true, true, true, false, false, false, false]);
	});

	test('parses a shot as portable metadata around its video card, a draft until it generates', () => {
		const shot = parseBaseHalfShotDocument(JSON.stringify({
			version: 1,
			kind: 'pointa.basehalf-ai-video.shot',
			id: 'shot-01',
			title: 'Opening',
			clipNodePath: 'clip.mp4'
		}));
		assert.strictEqual(shot.clipNodePath, 'clip.mp4');
		assert.strictEqual(resolveBaseHalfShotClip(URI.file('/workspace/shots/shot-01/shot.json'), shot.clipNodePath).toString(), URI.file('/workspace/shots/shot-01/clip.mp4').toString());
		assert.throws(() => parseBaseHalfShotDocument(JSON.stringify({ ...shot, clipNodePath: 'clip.bhnode' })), /video file/);
	});

	test('rejects ambiguous, legacy, and unsafe Sequence documents', () => {
		assert.throws(() => parseBaseHalfSequenceDocument('{'), /not valid JSON/);
		assert.throws(() => parseBaseHalfSequenceDocument(JSON.stringify({ version: 2, kind: 'pointa.basehalf-ai-video.sequence', items: [] })), /supported version 1/);
		assert.throws(() => parseBaseHalfSequenceDocument(JSON.stringify({
			version: 1,
			kind: 'pointa.basehalf-ai-video.sequence',
			items: [sequenceItem('same', 'one.mp4'), sequenceItem('same', 'two.mp4')]
		})), /duplicate item id/);
		for (const videoPath of ['../clip.mp4', '.BH/clip.mp4', 'shots/.BH/clip.mp4', 'shots/é/clip.mp4', 'shots/AUX/clip.mp4', ' shots/clip.mp4 ', 'shots/clip.bhnode', 'shots/notes.md']) {
			assert.throws(() => parseBaseHalfSequenceDocument(JSON.stringify({
				version: 1,
				kind: 'pointa.basehalf-ai-video.sequence',
				items: [sequenceItem('shot', videoPath)]
			})), /safe relative path/, videoPath);
		}
		for (const generationId of ['', ' task', 'task/1', 'x'.repeat(129), 42]) {
			assert.throws(() => parseBaseHalfSequenceDocument(JSON.stringify({
				version: 1,
				kind: 'pointa.basehalf-ai-video.sequence',
				items: [{ ...sequenceItem('shot', 'clip.mp4'), generationId }]
			})), /generationId/, String(generationId));
		}
		assert.throws(() => parseBaseHalfSequenceDocument(JSON.stringify({
			version: 1,
			kind: 'pointa.basehalf-ai-video.sequence',
			items: [{ ...sequenceItem('shot', 'clip.mp4'), runId: 'run-1' }]
		})), /unsupported field 'runId'/);
	});
});

function sequenceDocument(items: readonly IBaseHalfSequenceItem[]): IBaseHalfSequenceDocument {
	return parseBaseHalfSequenceDocument(JSON.stringify({
		version: 1,
		kind: 'pointa.basehalf-ai-video.sequence',
		items
	}));
}

function sequenceItem(id: string, videoPath: string, generationId?: string): IBaseHalfSequenceItem {
	return {
		id,
		title: id.replace(/^./, character => character.toUpperCase()).replace(/-/g, ' '),
		videoPath,
		...(generationId === undefined ? {} : { generationId })
	};
}
