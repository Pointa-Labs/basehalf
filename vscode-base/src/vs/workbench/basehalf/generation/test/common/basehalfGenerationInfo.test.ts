/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	BASEHALF_GENERATION_MAX_FILE_BYTES,
	baseHalfGenerationCandidateName,
	baseHalfGenerationClaimWinner,
	baseHalfGenerationDraftExtension,
	baseHalfGenerationDraftNameRule,
	baseHalfGenerationDraftRenameExtension,
	baseHalfGenerationExtensionMatchesFormat,
	baseHalfGenerationFileFormat,
	baseHalfGenerationFormatExtension,
	baseHalfGenerationInfoChangedFields,
	baseHalfGenerationInfoOfMade,
	baseHalfGenerationKindOfPath,
	baseHalfGenerationNameOrdinal,
	baseHalfGenerationMadeCopy,
	baseHalfGenerationMadeOfTask,
	baseHalfGenerationNameParts,
	baseHalfGenerationNextFreeName,
	baseHalfGenerationWithExtension,
	BaseHalfGenerationInfoError,
	BASEHALF_GENERATION_STALE_MS,
	createBaseHalfGenerationTask,
	createBaseHalfGenerationTaskId,
	failBaseHalfGenerationCard,
	failBaseHalfGenerationTask,
	heartbeatBaseHalfGenerationTask,
	IBaseHalfGenerationRequest,
	isBaseHalfGenerationFileAccepted,
	isBaseHalfGenerationTaskSettled,
	isBaseHalfGenerationTaskStale,
	landBaseHalfGenerationTask,
	parseBaseHalfGenerationInfo,
	parseBaseHalfGenerationMade,
	parseBaseHalfGenerationTask,
	recordBaseHalfGenerationLanded,
	recordBaseHalfGenerationLanding,
	retargetBaseHalfGenerationTask,
	runBaseHalfGenerationTask,
	serializeBaseHalfGenerationInfo,
	serializeBaseHalfGenerationMade,
	serializeBaseHalfGenerationTask,
	setBaseHalfGenerationChoice,
	setBaseHalfGenerationPrompt,
	stopBaseHalfGenerationTask,
	submitBaseHalfGenerationTask,
	writeBaseHalfGenerationInfoFields
} from '../../common/basehalfGenerationInfo.js';
import { CORVID_PAINT, CORVID_PRINT, CORVID_REEL, DUNLIN_FOLEY, DUNLIN_SONG, DUNLIN_VOICE } from './basehalfVideoCatalogFixture.js';

suite('BaseHalfGenerationInfo', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const request: IBaseHalfGenerationRequest = {
		provider: 'acme',
		region: 'east',
		model: 'acme-image-2',
		providerModel: 'acme-image-2-e-260101',
		mode: 'reference',
		params: { resolution: '2k', count: 2, transparent: false },
		prompt: '图片1里的人站在海边',
		inputs: ['refs/hero.png', 'notes/scene.md']
	};

	suite('kinds and names', () => {
		test('a card\'s kind comes from its extension, without regard to case', () => {
			assert.deepStrictEqual(
				['a.png', 'b.JPG', 'c.jpeg', 'd.webp', 'e.gif', 'f.avif', 'g.bmp', 'h.mp4', 'i.MOV', 'j.m4v', 'k.webm', 'l.md', 'm', 'n.png.txt', '.png'].map(baseHalfGenerationKindOfPath),
				['image', 'image', 'image', 'image', 'image', 'image', 'image', 'video', 'video', 'video', 'video', undefined, undefined, undefined, undefined]
			);
			// Sounds are the third kind (D78), of the formats BaseHalf lands and plays: no AAC without a container.
			assert.deepStrictEqual(
				['a.mp3', 'b.WAV', 'c.flac', 'd.m4a', 'e.aac', 'f.Ogg', 'g.opus', 'h.mp3.md'].map(baseHalfGenerationKindOfPath),
				['audio', 'audio', 'audio', 'audio', undefined, 'audio', undefined, undefined]
			);
		});

		test('a new draft takes its model\'s format when the model is of its kind, and png, mp4, or mp3 otherwise; choosing a model of another format renames an image or an audio draft (D78)', () => {
			assert.deepStrictEqual({
				extensions: [
					baseHalfGenerationDraftExtension('image'),
					baseHalfGenerationDraftExtension('image', CORVID_PRINT),
					baseHalfGenerationDraftExtension('video', CORVID_REEL),
					baseHalfGenerationDraftExtension('audio'),
					baseHalfGenerationDraftExtension('audio', DUNLIN_SONG),
					baseHalfGenerationDraftExtension('audio', DUNLIN_VOICE),
					// A model of another kind tells nothing of the format.
					baseHalfGenerationDraftExtension('audio', CORVID_PRINT)
				],
				renames: [
					baseHalfGenerationDraftRenameExtension('shots/audio.mp3', 'audio', DUNLIN_SONG),
					baseHalfGenerationDraftRenameExtension('shots/audio.wav', 'audio', DUNLIN_FOLEY),
					baseHalfGenerationDraftRenameExtension('shots/audio.mp3', 'audio', DUNLIN_VOICE),
					baseHalfGenerationDraftRenameExtension('shots/image.png', 'image', CORVID_PRINT),
					baseHalfGenerationDraftRenameExtension('shots/image.jpeg', 'image', CORVID_PRINT),
					baseHalfGenerationDraftRenameExtension('shots/image.png', 'image', CORVID_PAINT),
					baseHalfGenerationDraftRenameExtension('shots/video.mov', 'video', CORVID_REEL),
					baseHalfGenerationDraftRenameExtension('shots/audio.mp3', 'audio', CORVID_PRINT)
				]
			}, {
				extensions: ['png', 'jpg', 'mp4', 'mp3', 'wav', 'mp3', 'mp3'],
				renames: ['wav', 'mp3', undefined, 'jpg', undefined, undefined, undefined, undefined]
			});
		});

		test('a draft keeps a name of its kind, and says which extensions it takes', () => {
			assert.deepStrictEqual((['image', 'video', 'audio'] as const).map(baseHalfGenerationDraftNameRule), [
				'An image card needs a name that ends in .png, .jpg, .jpeg, .webp, .gif, .avif, or .bmp.',
				'A video card needs a name that ends in .mp4, .mov, .m4v, or .webm.',
				'An audio card needs a name that ends in .mp3, .wav, .flac, .m4a, or .ogg.'
			]);
		});

		test('names are numbered as the canvas numbers what it creates', () => {
			assert.deepStrictEqual(baseHalfGenerationNameParts('shot-3.mp4'), { base: 'shot', extension: 'mp4' });
			assert.deepStrictEqual(baseHalfGenerationNameParts('image.png'), { base: 'image', extension: 'png' });
			assert.strictEqual(baseHalfGenerationCandidateName('shot', 'mp4', 1), 'shot.mp4');
			assert.strictEqual(baseHalfGenerationCandidateName('shot', 'mp4', 3), 'shot-3.mp4');
			const taken = new Set(['shot.mp4', 'shot-2.mp4']);
			assert.strictEqual(baseHalfGenerationNextFreeName('shot', 'mp4', name => taken.has(name)), 'shot-3.mp4');
			assert.strictEqual(baseHalfGenerationWithExtension('shots/image.png', 'jpg'), 'shots/image.jpg');
			assert.deepStrictEqual(['shot-3.mp4', 'shot.mp4', 'take-two.png', 'x-12'].map(baseHalfGenerationNameOrdinal), [3, 1, 1, 12]);
		});

		test('a task id is sortable by its start and unique enough between windows', () => {
			assert.strictEqual(createBaseHalfGenerationTaskId(Date.parse('2026-10-22T08:00:00.123Z'), () => 'AB12-cd34-ef56'), '20261022T080000-ab12cd34');
		});
	});

	suite('generated files', () => {
		const bytes = (...values: (number | string)[]) => Uint8Array.from(values.flatMap(value => typeof value === 'string' ? [...value].map(character => character.charCodeAt(0)) : [value]));

		test('a file\'s format is read from its first bytes, and decides its extension', () => {
			assert.deepStrictEqual([
				bytes(0x89, 'PNG', 0x0D, 0x0A, 0x1A, 0x0A),
				bytes(0xFF, 0xD8, 0xFF, 0xE0),
				bytes('RIFF', 0, 0, 0, 0, 'WEBP'),
				bytes(0, 0, 0, 24, 'ftypisom'),
				bytes('GIF89a'),
				bytes(0x89, 'PN')
			].map(head => baseHalfGenerationFileFormat(head)), ['png', 'jpeg', 'webp', 'mp4', undefined, undefined]);
			assert.deepStrictEqual((['png', 'jpeg', 'webp', 'mp4'] as const).map(baseHalfGenerationFormatExtension), ['png', 'jpg', 'webp', 'mp4']);
			assert.deepStrictEqual([
				baseHalfGenerationExtensionMatchesFormat('shots/a.jpeg', 'jpeg'),
				baseHalfGenerationExtensionMatchesFormat('shots/a.JPG', 'jpeg'),
				baseHalfGenerationExtensionMatchesFormat('shots/a.png', 'jpeg'),
				baseHalfGenerationExtensionMatchesFormat('shots/a.mov', 'mp4')
			], [true, true, false, false]);
		});

		test('a sound is an MP3, a WAV, a FLAC, an Ogg, or an M4A by its first bytes, and an AAC stream is none of them (D78)', () => {
			assert.deepStrictEqual({
				sounds: [
					bytes('ID3', 4, 0, 0, 0, 0, 0, 0),
					bytes(0xFF, 0xFB, 0x90, 0x64),
					bytes(0xFF, 0xF3, 0x28, 0xC4),
					bytes('RIFF', 36, 0, 0, 0, 'WAVE', 'fmt '),
					bytes('fLaC', 0, 0, 0, 34),
					bytes('OggS', 0, 2),
					// An ADTS stream of AAC has the sync of an MPEG audio frame without a layer.
					bytes(0xFF, 0xF1, 0x50, 0x80),
					bytes('RIFF', 36, 0, 0, 0, 'AVI ')
				].map(head => baseHalfGenerationFileFormat(head, 'audio')),
				// An ISO media file is an M4A on an audio card and an MP4 on any other.
				isoMedia: (['audio', 'video', undefined] as const).map(kind => baseHalfGenerationFileFormat(bytes(0, 0, 0, 28, 'ftypM4A '), kind)),
				extensions: (['mp3', 'wav', 'flac', 'ogg', 'm4a'] as const).map(baseHalfGenerationFormatExtension),
				matches: [
					baseHalfGenerationExtensionMatchesFormat('shots/audio.WAV', 'wav'),
					baseHalfGenerationExtensionMatchesFormat('shots/audio.mp3', 'wav')
				]
			}, {
				sounds: ['mp3', 'mp3', 'mp3', 'wav', 'flac', 'ogg', undefined, undefined],
				isoMedia: ['m4a', 'mp4', 'mp4'],
				extensions: ['mp3', 'wav', 'flac', 'ogg', 'm4a'],
				matches: [true, false]
			});
		});

		test('a video lands as an MP4 of at most 512 MiB, an image as a PNG, JPEG, or WebP of at most 64 MiB', () => {
			assert.deepStrictEqual([
				isBaseHalfGenerationFileAccepted('video', 'mp4', BASEHALF_GENERATION_MAX_FILE_BYTES.video),
				isBaseHalfGenerationFileAccepted('video', 'mp4', BASEHALF_GENERATION_MAX_FILE_BYTES.video + 1),
				isBaseHalfGenerationFileAccepted('video', 'png', 10),
				isBaseHalfGenerationFileAccepted('image', 'webp', 10),
				isBaseHalfGenerationFileAccepted('image', 'jpeg', 64 * 1024 * 1024 + 1),
				isBaseHalfGenerationFileAccepted('image', undefined, 10),
				isBaseHalfGenerationFileAccepted('image', 'png', 0)
			], [true, false, false, true, false, false, false]);
		});

		test('a sound lands as an MP3, a WAV, a FLAC, an Ogg, or an M4A of at most 256 MiB (D78)', () => {
			assert.deepStrictEqual([
				isBaseHalfGenerationFileAccepted('audio', 'mp3', 256 * 1024 * 1024),
				isBaseHalfGenerationFileAccepted('audio', 'wav', 256 * 1024 * 1024 + 1),
				isBaseHalfGenerationFileAccepted('audio', 'flac', 10),
				isBaseHalfGenerationFileAccepted('audio', 'ogg', 10),
				isBaseHalfGenerationFileAccepted('audio', 'm4a', 10),
				isBaseHalfGenerationFileAccepted('audio', 'mp4', 10),
				isBaseHalfGenerationFileAccepted('video', 'mp3', 10),
				isBaseHalfGenerationFileAccepted('image', 'wav', 10)
			], [true, false, true, true, true, false, false, false]);
		});
	});

	suite('generation.yaml', () => {
		test('reads what it writes', () => {
			const info = setBaseHalfGenerationChoice(setBaseHalfGenerationPrompt({ prompt: '' }, 'A cyclist at dawn\nslow pan'), {
				provider: 'acme',
				model: 'acme-motion-2',
				mode: 'frames',
				params: { resolution: '720p', duration: 5, sound: true, label: '09' }
			});
			const text = serializeBaseHalfGenerationInfo(info);
			assert.deepStrictEqual(parseBaseHalfGenerationInfo(text), { info, readable: true, ignored: [] });
		});

		test('reads Lyrics mode and the voice of a speech model, which is text (D78)', () => {
			const song = setBaseHalfGenerationChoice({ prompt: 'The tide comes in' }, { provider: 'dunlin', model: 'dunlin-song', mode: 'lyrics', params: { count: 2, style: 'sea shanty' } });
			const speech = parseBaseHalfGenerationInfo('prompt: "Welcome"\nmode: "reference"\nparams:\n  voice: "vx-ember"\n', name => name === 'voice' ? 'string' : undefined);
			assert.deepStrictEqual({ song: parseBaseHalfGenerationInfo(serializeBaseHalfGenerationInfo(song)).info, voice: speech.info.params }, {
				song,
				voice: { voice: 'vx-ember' }
			});
		});

		test('reads field by field: a field with the wrong shape is absent and the others are used', () => {
			const read = parseBaseHalfGenerationInfo('prompt: "keep me"\nprovider: [1, 2]\nmode: "sideways"\nmodel: "m"\nparams:\n  duration: 5\n  "bad name": 1\n');
			assert.deepStrictEqual(read, {
				info: { prompt: 'keep me', model: 'm', params: { duration: 5 } },
				readable: true,
				ignored: ['provider', 'mode', 'params.bad name']
			});
		});

		test('a value is read by its declared type; a plain value without one by how it looks', () => {
			const text = 'prompt: ""\nparams:\n  resolution: 720\n  seed: "7"\n  sound: true\n  style: "true"\n';
			assert.deepStrictEqual(parseBaseHalfGenerationInfo(text).info.params, { resolution: 720, seed: '7', sound: true, style: 'true' });
			const declared = parseBaseHalfGenerationInfo(text, name => name === 'resolution' ? 'string' : name === 'seed' ? 'number' : undefined);
			assert.deepStrictEqual(declared.info.params, { resolution: '720', seed: 7, sound: true, style: 'true' });
		});

		test('a file that is not YAML at all, as one with git\'s conflict markers, reads as unreadable with no prompt', () => {
			const text = 'prompt: "a"\n<<<<<<< HEAD\nmodel: "x"\n=======\nmodel: "y"\n>>>>>>> branch\n';
			assert.deepStrictEqual(parseBaseHalfGenerationInfo(text), { info: { prompt: '' }, readable: false, ignored: [] });
		});

		test('an empty file is a draft with an empty prompt', () => {
			assert.deepStrictEqual(parseBaseHalfGenerationInfo(''), { info: { prompt: '' }, readable: true, ignored: [] });
		});

		test('writes only the fields that changed, and keeps every other byte: a value an agent wrote, a comment, and a field BaseHalf does not know', () => {
			const text = '# notes of the agent\nprompt: "old"\nmodel: "acme-still"\nprovider: "acme"\nlook: [warm, soft]\nparams:\n  duration: 5\n';
			const before = parseBaseHalfGenerationInfo(text).info;
			const prompt = writeBaseHalfGenerationInfoFields(text, before, setBaseHalfGenerationPrompt(before, '图片1 at dawn\n"slow"'));
			const added = writeBaseHalfGenerationInfoFields(prompt, parseBaseHalfGenerationInfo(prompt).info, { ...parseBaseHalfGenerationInfo(prompt).info, mode: 'frames' });
			const removed = writeBaseHalfGenerationInfoFields(added, parseBaseHalfGenerationInfo(added).info, { prompt: '图片1 at dawn\n"slow"', provider: 'acme', model: 'acme-still', mode: 'frames' });
			assert.deepStrictEqual({ prompt, added, removed }, {
				prompt: '# notes of the agent\nprompt: "图片1 at dawn\\n\\"slow\\""\nmodel: "acme-still"\nprovider: "acme"\nlook: [warm, soft]\nparams:\n  duration: 5\n',
				added: '# notes of the agent\nprompt: "图片1 at dawn\\n\\"slow\\""\nmodel: "acme-still"\nprovider: "acme"\nlook: [warm, soft]\nparams:\n  duration: 5\nmode: "frames"\n',
				removed: '# notes of the agent\nprompt: "图片1 at dawn\\n\\"slow\\""\nmodel: "acme-still"\nprovider: "acme"\nlook: [warm, soft]\nmode: "frames"\n'
			});
			assert.deepStrictEqual(baseHalfGenerationInfoChangedFields(before, parseBaseHalfGenerationInfo(removed).info), ['prompt', 'mode', 'params']);
		});

		test('a prompt typed in the panel and a model an agent wrote meanwhile both stay', () => {
			const read = parseBaseHalfGenerationInfo('prompt: ""\nprovider: "acme"\nmodel: "acme-motion-2"\n').info;
			// The agent changed the model after the panel read the file; the panel plans its prompt again from the new bytes.
			const agent = 'prompt: ""\nprovider: "acme"\nmodel: "acme-still"\n';
			const again = writeBaseHalfGenerationInfoFields(agent, parseBaseHalfGenerationInfo(agent).info, setBaseHalfGenerationPrompt(parseBaseHalfGenerationInfo(agent).info, 'Rain'));
			assert.deepStrictEqual([read.model, parseBaseHalfGenerationInfo(again).info], ['acme-motion-2', { prompt: 'Rain', provider: 'acme', model: 'acme-still' }]);
		});

		test('no text, and a mapping in braces, are written whole; line breaks of the file are kept', () => {
			const info = { prompt: 'p', provider: 'acme', params: { sound: true, duration: 5 } };
			assert.deepStrictEqual([
				writeBaseHalfGenerationInfoFields(undefined, { prompt: '' }, info),
				writeBaseHalfGenerationInfoFields('{prompt: "q", extra: 1}', { prompt: 'q' }, info),
				writeBaseHalfGenerationInfoFields('prompt: "q"\r\nmodel: "m"\r\n', { prompt: 'q', model: 'm' }, { prompt: 'r', model: 'm' })
			], [
				'prompt: "p"\nprovider: "acme"\nparams:\n  duration: 5\n  sound: true\n',
				'prompt: "p"\nprovider: "acme"\nparams:\n  duration: 5\n  sound: true\n',
				'prompt: "r"\r\nmodel: "m"\r\n'
			]);
			assert.strictEqual(writeBaseHalfGenerationInfoFields('prompt: "q"\n', { prompt: 'q' }, { prompt: 'q' }), 'prompt: "q"\n');
		});
	});

	suite('made.yaml', () => {
		test('reads what it writes, the text of notes left out', () => {
			const made = {
				...request,
				id: '20261022T080000-k3f9-2',
				startedAt: '2026-10-22T08:00:00.000Z',
				finishedAt: '2026-10-22T08:00:40.000Z',
				output: 2,
				outputs: 2
			};
			assert.deepStrictEqual(parseBaseHalfGenerationMade(serializeBaseHalfGenerationMade(made)), made);
		});

		test('a record that cannot be read whole is undefined and left as it is', () => {
			assert.strictEqual(parseBaseHalfGenerationMade('id: "x"\n'), undefined);
			assert.strictEqual(parseBaseHalfGenerationMade('<<<<<<< HEAD\n'), undefined);
		});

		test('a copy has a new id and says which record it copies', () => {
			const made = { ...request, id: 't1', startedAt: '2026-10-22T08:00:00.000Z', finishedAt: '2026-10-22T08:00:40.000Z' };
			const copy = baseHalfGenerationMadeCopy(made, 't2');
			assert.deepStrictEqual([copy.id, copy.copyOf, baseHalfGenerationMadeCopy(copy, 't3').copyOf], ['t2', 't1', 't1']);
		});

		test('a new version generates what made the file, without the seed (D67)', () => {
			const made = { ...request, params: { ...request.params, seed: 42 }, id: 't1', startedAt: '2026-10-22T08:00:00.000Z', finishedAt: '2026-10-22T08:00:40.000Z', output: 2, outputs: 2 };
			assert.deepStrictEqual(baseHalfGenerationInfoOfMade(made), {
				prompt: '图片1里的人站在海边',
				provider: 'acme',
				model: 'acme-image-2',
				mode: 'reference',
				params: { resolution: '2k', count: 2, transparent: false }
			});
		});
	});

	suite('task records', () => {
		const now = '2026-10-22T08:00:00.000Z';
		const later = '2026-10-22T08:01:00.000Z';
		const task = createBaseHalfGenerationTask({ id: '20261022T080000-k3f9', kind: 'image', cards: ['shots/image.png', 'shots/image-2.png'], follower: 'window-1', now });

		test('a generation goes from preparing to landed, card by card', () => {
			const submitted = submitBaseHalfGenerationTask(task, request, '图片1里的人站在海边\n\nscene text', false);
			const running = runBaseHalfGenerationTask(submitted, 'remote-1');
			let landing = landBaseHalfGenerationTask(running);
			landing = recordBaseHalfGenerationLanding(landing, 0, { path: 'shots/image.png', size: 10, sha256: 'a'.repeat(64) });
			landing = recordBaseHalfGenerationLanded(landing, 0);
			assert.strictEqual(isBaseHalfGenerationTaskSettled(landing), false);
			landing = failBaseHalfGenerationCard(landing, 1, 'The provider refused this image.');
			assert.strictEqual(isBaseHalfGenerationTaskSettled(landing), true);
			assert.deepStrictEqual(landing.cards, [
				{ path: 'shots/image.png', state: 'landed' },
				{ path: 'shots/image-2.png', state: 'failed', error: 'The provider refused this image.' }
			]);
			assert.deepStrictEqual(parseBaseHalfGenerationTask(serializeBaseHalfGenerationTask(landing)), landing);
		});

		test('each landed image has its own record, the text of notes left out', () => {
			const running = runBaseHalfGenerationTask(submitBaseHalfGenerationTask(task, request, 'whole prompt with notes', false), 'remote-1');
			const made = baseHalfGenerationMadeOfTask(running, 1, later);
			assert.deepStrictEqual([made.id, made.output, made.outputs, made.prompt, made.remoteId], ['20261022T080000-k3f9-2', 2, 2, request.prompt, 'remote-1']);
		});

		test('a running task needs the provider\'s task id, and ended tasks keep their landed cards', () => {
			assert.throws(() => runBaseHalfGenerationTask(task, 'r'), BaseHalfGenerationInfoError);
			const failed = failBaseHalfGenerationTask(submitBaseHalfGenerationTask(task, request, 'p', true), 'Refused.', later);
			assert.deepStrictEqual([failed.state, failed.endedAt, failed.cards.map(card => card.state)], ['failed', later, ['failed', 'failed']]);
			const stopped = stopBaseHalfGenerationTask(task, later);
			assert.deepStrictEqual([stopped.state, stopped.error], ['stopped', undefined]);
		});

		test('a move writes the card\'s new path, also of a card below a moved folder', () => {
			assert.deepStrictEqual(retargetBaseHalfGenerationTask(task, 'shots', 'scenes').cards.map(card => card.path), ['scenes/image.png', 'scenes/image-2.png']);
			assert.deepStrictEqual(retargetBaseHalfGenerationTask(task, 'shots/image.png', 'shots/hero.png').cards.map(card => card.path), ['shots/hero.png', 'shots/image-2.png']);
			assert.strictEqual(retargetBaseHalfGenerationTask(task, 'shot', 'x'), task);
			const landing = recordBaseHalfGenerationLanding(landBaseHalfGenerationTask(runBaseHalfGenerationTask(submitBaseHalfGenerationTask(task, request, request.prompt, false), 'r-1')), 0, { path: 'shots/image.png', size: 10, sha256: 'a'.repeat(64) });
			assert.deepStrictEqual(retargetBaseHalfGenerationTask(landing, 'shots', 'scenes').cards[0], { path: 'scenes/image.png', state: 'waiting', landing: { path: 'scenes/image.png', size: 10, sha256: 'a'.repeat(64) } });
		});

		test('another window takes a task over only when it has not been said alive for 90 seconds', () => {
			const start = Date.parse(now);
			assert.strictEqual(isBaseHalfGenerationTaskStale(task, start + BASEHALF_GENERATION_STALE_MS - 1), false);
			assert.strictEqual(isBaseHalfGenerationTaskStale(task, start + BASEHALF_GENERATION_STALE_MS), true);
			assert.strictEqual(heartbeatBaseHalfGenerationTask(task, 'window-2', later).follower, 'window-2');
		});

		test('of two records that claim the same card, the one that started first keeps it', () => {
			const first = createBaseHalfGenerationTask({ id: 'b', kind: 'image', cards: ['x.png'], follower: 'w1', now });
			const second = createBaseHalfGenerationTask({ id: 'a', kind: 'image', cards: ['x.png'], follower: 'w2', now: later });
			const tie = createBaseHalfGenerationTask({ id: 'a', kind: 'image', cards: ['x.png'], follower: 'w2', now });
			assert.strictEqual(baseHalfGenerationClaimWinner([second, first]), first);
			assert.strictEqual(baseHalfGenerationClaimWinner([first, tie]), tie);
			assert.strictEqual(baseHalfGenerationClaimWinner([stopBaseHalfGenerationTask(first, later)]), undefined);
		});

		test('a record that is not valid reads as undefined', () => {
			assert.strictEqual(parseBaseHalfGenerationTask('{'), undefined);
			assert.strictEqual(parseBaseHalfGenerationTask(JSON.stringify({ ...task, state: 'running' })), undefined);
			assert.strictEqual(parseBaseHalfGenerationTask(JSON.stringify({ ...task, extra: 1 })), undefined);
			assert.strictEqual(parseBaseHalfGenerationTask(JSON.stringify({ ...task, kind: 'pdf' })), undefined);
		});

		test('a generation of songs is recorded as one of the kind audio, with a record of each song (D78)', () => {
			const songs = createBaseHalfGenerationTask({ id: '20261025T080000-50e6', kind: 'audio', cards: ['songs/audio.wav', 'songs/audio-2.wav'], follower: 'window-1', now });
			const landing = landBaseHalfGenerationTask(runBaseHalfGenerationTask(submitBaseHalfGenerationTask(songs, { ...request, mode: 'lyrics', params: { count: 2, style: 'sea shanty' } }, 'The tide comes in.', false), 'remote-2'));
			const read = parseBaseHalfGenerationTask(serializeBaseHalfGenerationTask(landing));
			const made = baseHalfGenerationMadeOfTask(landing, 1, later);
			assert.deepStrictEqual({ kind: read?.kind, mode: read?.request?.mode, made: [made.id, made.output, made.outputs] }, {
				kind: 'audio',
				mode: 'lyrics',
				made: ['20261025T080000-50e6-2', 2, 2]
			});
		});
	});
});
