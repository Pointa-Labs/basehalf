/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { safeIntl } from '../../../../../base/common/date.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { VoicesResult } from '../../../../../platform/basehalfProviders/common/basehalfProviderTypes.js';
import { baseHalfGenerationProvenance } from '../../browser/basehalfMediaCardDetail.js';
import { baseHalfGenerationMadeCopy, baseHalfGenerationMadeTrimmed, IBaseHalfGenerationMade } from '../../../video/common/basehalfGenerationInfo.js';
import { TEST_AUDIO_CATALOG, TEST_GENERATION_CATALOG } from '../../../video/test/common/basehalfVideoCatalogFixture.js';

const startedAt = '2026-10-15T08:00:00.000Z';
const finishedAt = '2026-10-15T08:02:31.000Z';

const video: IBaseHalfGenerationMade = {
	id: '20261015T080000-1a2b3c4d',
	startedAt,
	finishedAt,
	remoteId: 'cgt-1',
	provider: 'acme',
	region: 'west',
	model: 'acme-motion-2',
	providerModel: 'acme-motion-2-w-260101',
	mode: 'reference',
	params: { resolution: '720p', ratio: '21:9', duration: -1, sound: true, seed: 42, retired: 'x' },
	prompt: '@[frames/start.png] rides along the sea, as @[notes/scene.md] says.',
	inputs: ['frames/start.png', 'shots/hero.mp4', 'notes/scene.md', 'frames/end.png']
};

const image: IBaseHalfGenerationMade = {
	id: '20261015T080000-1a2b3c4d-2',
	startedAt,
	finishedAt,
	provider: 'corvid',
	region: 'north',
	model: 'corvid-paint',
	providerModel: 'paint-n-1',
	mode: 'reference',
	params: { resolution: '2k', count: 4 },
	prompt: 'A heron at dusk.',
	inputs: [],
	output: 2,
	outputs: 4
};

const song: IBaseHalfGenerationMade = {
	id: '20261025T080000-50e6a1b2-1',
	startedAt,
	finishedAt,
	remoteId: 'song-task-1',
	provider: 'dunlin',
	region: 'main',
	model: 'dunlin-song',
	providerModel: 'song-1',
	mode: 'lyrics',
	params: { style: 'sea shanty', count: 2 },
	prompt: '@[notes/lyrics.md]',
	inputs: ['notes/lyrics.md', 'refs/tune.mp3', 'refs/cover.png'],
	output: 1,
	outputs: 2
};

const speech: IBaseHalfGenerationMade = {
	id: '20261025T080500-50e6a1b3',
	startedAt,
	finishedAt,
	provider: 'dunlin',
	region: 'main',
	model: 'dunlin-voice',
	providerModel: 'voice-1',
	mode: 'reference',
	params: { voice: 'vx-pike', speed: 1.25 },
	prompt: '@[notes/intro.md]',
	inputs: ['notes/intro.md']
};

suite('BaseHalfGenerationProvenance', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('says what made a generated file: model, provider, mode, settings, the prompt with its mentions as file names, which image of how many, when, and the inputs in order with what each was used as, named by the catalog', () => {
		const format = safeIntl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'medium' }).value;
		const started = { label: 'Started', value: format.format(new Date(startedAt)) };
		const finished = { label: 'Finished', value: `${format.format(new Date(finishedAt))}, after 2:31` };
		assert.deepStrictEqual({
			video: baseHalfGenerationProvenance({ kind: 'video', made: video }, 'en', TEST_GENERATION_CATALOG),
			image: baseHalfGenerationProvenance({ kind: 'image', made: image }, 'en', TEST_GENERATION_CATALOG)
		}, {
			video: {
				heading: 'Generated',
				rows: [
					{ label: 'Model', value: 'Acme Motion 2 (acme-motion-2-w-260101)' },
					{ label: 'Provider', value: 'Acme Video · West · Acme Global' },
					{ label: 'Mode', value: 'References' },
					{ label: 'Settings', value: 'Resolution 720p · Ratio 21:9 · Duration Auto · Sound On · Seed 42 · retired: x' },
					{ label: 'Prompt', value: 'start.png rides along the sea, as scene says.' },
					started,
					finished
				],
				inputs: [
					{ name: 'Image', path: 'frames/start.png' },
					{ name: 'Video', path: 'shots/hero.mp4' },
					{ name: 'Note', path: 'notes/scene.md' },
					{ name: 'Image', path: 'frames/end.png' }
				]
			},
			image: {
				heading: 'Generated',
				rows: [
					{ label: 'Model', value: 'Corvid Paint (paint-n-1)' },
					{ label: 'Provider', value: 'Corvid Studio · North' },
					{ label: 'Mode', value: 'References' },
					{ label: 'Settings', value: 'Resolution 2K · Images 4' },
					{ label: 'Prompt', value: 'A heron at dusk.' },
					{ label: 'Image', value: '2 of 4' },
					started,
					finished
				],
				inputs: []
			}
		});
	});

	test('without the catalog, the recorded ids; frames by their places', () => {
		const frames = baseHalfGenerationProvenance({ kind: 'video', made: { ...video, mode: 'frames', inputs: ['frames/start.png', 'frames/end.png'] } }, 'en');
		assert.deepStrictEqual(frames.inputs.map(input => input.name), ['Start frame', 'End frame']);
		assert.deepStrictEqual(baseHalfGenerationProvenance({ kind: 'video', made: video }, 'en').rows.slice(0, 4), [
			{ label: 'Model', value: 'acme-motion-2 (acme-motion-2-w-260101)' },
			{ label: 'Provider', value: 'acme · west' },
			{ label: 'Mode', value: 'reference' },
			{ label: 'Settings', value: 'resolution: 720p · ratio: 21:9 · duration: -1 · sound: true · seed: 42 · retired: x' }
		]);
	});

	test('a file without a record was not generated by BaseHalf, one whose record cannot be read says so, and a copy says that the record is its original\'s', () => {
		const copy = baseHalfGenerationProvenance({ kind: 'video', made: baseHalfGenerationMadeCopy(video, '20261016T090000-feedbeef') }, 'en', TEST_GENERATION_CATALOG);
		assert.deepStrictEqual({
			uploaded: baseHalfGenerationProvenance({ kind: 'image' }, 'en'),
			unreadable: baseHalfGenerationProvenance({ kind: 'image', madeUnreadable: true }, 'en'),
			copy: { note: copy.note, model: copy.rows[0] }
		}, {
			uploaded: { heading: 'Not generated by BaseHalf', rows: [], inputs: [] },
			unreadable: { heading: 'Generated', note: 'BaseHalf could not read what made this file.', rows: [], inputs: [] },
			copy: {
				note: 'This video is a copy of a generated video; this is what made that one.',
				model: { label: 'Model', value: 'Acme Motion 2 (acme-motion-2-w-260101)' }
			}
		});
	});

	test('says which part of the generated video a trimmed video holds, before when it was made (D79)', () => {
		const rows = baseHalfGenerationProvenance({ kind: 'video', made: baseHalfGenerationMadeTrimmed(video, 1, 4.5) }, 'en', TEST_GENERATION_CATALOG).rows;
		assert.deepStrictEqual(rows.slice(4, 6), [
			{ label: 'Prompt', value: 'start.png rides along the sea, as scene says.' },
			{ label: 'Trimmed', value: '1.0s–4.5s of the generated video' }
		]);
	});

	test('says what made a sound: which song of how many, the voice it spoke in, its references, and that a copy is a copy of a sound (D78)', () => {
		const songShown = baseHalfGenerationProvenance({ kind: 'audio', made: song }, 'en', TEST_AUDIO_CATALOG);
		const speechShown = baseHalfGenerationProvenance({ kind: 'audio', made: speech }, 'en', TEST_AUDIO_CATALOG);
		assert.deepStrictEqual({
			song: songShown.rows.filter(row => ['Mode', 'Settings', 'Song', 'Prompt'].includes(row.label)),
			inputs: songShown.inputs,
			speech: speechShown.rows.find(row => row.label === 'Settings'),
			// Without the catalog, a sound's inputs are still its references.
			withoutCatalog: baseHalfGenerationProvenance({ kind: 'audio', made: { ...song, mode: 'reference' } }, 'en').inputs.map(input => input.name),
			copy: baseHalfGenerationProvenance({ kind: 'audio', made: baseHalfGenerationMadeCopy(song, '20261026T090000-feedbeef') }, 'en', TEST_AUDIO_CATALOG).note
		}, {
			song: [
				{ label: 'Mode', value: 'From Lyrics' },
				{ label: 'Settings', value: 'Style sea shanty · Songs 2' },
				{ label: 'Prompt', value: 'lyrics' },
				{ label: 'Song', value: '1 of 2' }
			],
			inputs: [
				{ name: 'Note', path: 'notes/lyrics.md' },
				{ name: 'Sound', path: 'refs/tune.mp3' },
				{ name: 'Image', path: 'refs/cover.png' }
			],
			speech: { label: 'Settings', value: 'Voice Pike · Speed 1.25' },
			withoutCatalog: ['Note', 'Sound', 'Image'],
			copy: 'This sound is a copy of a generated sound; this is what made that one.'
		});
	});

	test('names a voice of the account as the provider\'s last list of the region it was made in names it, as the panel of the card does, and by its id without such a list (D78)', () => {
		const lists = new Map<string, VoicesResult>([
			['dunlin/main', { voices: [{ id: 'narrator-7', label: 'My Narrator', own: true }, { id: 'vx-pike', label: 'Pike of the account', own: false }] }],
			['dunlin/elsewhere', { voices: [{ id: 'gone-since', label: 'Elsewhere', own: true }] }]
		]);
		const voices = (provider: string, region: string) => lists.get(`${provider}/${region}`);
		const settings = (voice: string, list: typeof voices = voices) => baseHalfGenerationProvenance({ kind: 'audio', made: { ...speech, params: { voice, speed: 1.25 } } }, 'en', TEST_AUDIO_CATALOG, list).rows.find(row => row.label === 'Settings')?.value;
		assert.deepStrictEqual({
			byList: settings('narrator-7'),
			byCatalog: settings('vx-pike'),
			withoutList: settings('narrator-7', () => undefined),
			// The list of another region names none of this one's voices.
			notListed: settings('gone-since')
		}, {
			byList: 'Voice My Narrator · Speed 1.25',
			byCatalog: 'Voice Pike · Speed 1.25',
			withoutList: 'Voice narrator-7 · Speed 1.25',
			notListed: 'Voice gone-since · Speed 1.25'
		});
	});
});
