/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from 'assert';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from '../../../../base/common/path.js';
import { checkCounts, checkLimits, checkParams, checkPrompt, fitParams, keptLimits, measureItems, resolveParams } from '../../node/check.js';
import { ProviderFailure } from '../../node/failure.js';
import { audioFormatOf, bufferSource, createMediaInspector, dataUrlOf, imageFormatOf, measure, pcmToWav, plannedItems, readMedia } from '../../node/media.js';
import type { CatalogModel, Media, PlannedMedia } from '../../common/basehalfProviderTypes.js';
import { flacHeader, gifHeader, isoMedia, jpegHeader, mp3, oggHeader, png, testProvider, tinyJpeg, tinyMp3, tinyPng, tinyWav, wav, webpHeader } from './providerTestKit.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('BaseHalf providers: providerMedia', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const folder = mkdtempSync(join(tmpdir(), 'basehalf-provider-media-'));
	suiteTeardown(() => rmSync(folder, { recursive: true, force: true }));

	function file(name: string, bytes: Buffer, mimeType = 'application/octet-stream'): Media {
		const fsPath = join(folder, name);
		writeFileSync(fsPath, bytes);
		return { fsPath, mimeType };
	}

	const MODEL = testProvider().models[0] as CatalogModel;
	const FRAMES = MODEL.modes[0];
	const REFERENCE = MODEL.modes[1];

	test('image sizes come from PNG, JPEG, WebP, and GIF headers, in files and in data URLs', async () => {
		const inspector = createMediaInspector();
		const facts = await Promise.all([
			inspector.inspect(file('a.png', png(640, 360))),
			inspector.inspect(file('b.jpg', jpegHeader(1920, 1080))),
			inspector.inspect(file('c.webp', webpHeader('VP8 ', 800, 600))),
			inspector.inspect(file('d.webp', webpHeader('VP8L', 1000, 1500))),
			inspector.inspect(file('e.webp', webpHeader('VP8X', 4000, 3000))),
			inspector.inspect(file('f.gif', gifHeader(320, 200))),
			inspector.inspect({ dataUrl: `data:image/png;base64,${png(300, 400).toString('base64')}` })
		]);
		assert.deepEqual(facts.map(fact => [fact.name ?? null, fact.format, fact.width, fact.height]), [
			['a.png', 'png', 640, 360],
			['b.jpg', 'jpeg', 1920, 1080],
			['c.webp', 'webp', 800, 600],
			['d.webp', 'webp', 1000, 1500],
			['e.webp', 'webp', 4000, 3000],
			['f.gif', 'gif', 320, 200],
			[null, 'png', 300, 400]
		]);
	});

	test('a generated image is told from its signature: a PNG, a JPEG, or a WebP, and nothing else', async () => {
		assert.deepEqual([
			imageFormatOf(png(4, 4)),
			imageFormatOf(jpegHeader(4, 4)),
			imageFormatOf(webpHeader('VP8 ', 4, 4)),
			imageFormatOf(gifHeader(4, 4)),
			imageFormatOf(isoMedia(1)),
			imageFormatOf(png(4, 4).subarray(0, 7)),
			imageFormatOf(new Uint8Array(0))
		], ['png', 'jpeg', 'webp', undefined, undefined, undefined, undefined]);
		// The tiny images of the test kit are what they say.
		assert.deepEqual([await measure(bufferSource(tinyPng())), await measure(bufferSource(tinyJpeg()))], [
			{ format: 'png', width: 2, height: 2 },
			{ format: 'jpeg', width: 2, height: 2 }
		]);
	});

	test('lengths come from MP4, MOV, and M4A movie headers, WAV headers, and MP3 frames', async () => {
		const inspector = createMediaInspector();
		const facts = await Promise.all([
			inspector.inspect(file('a.mp4', isoMedia(5))),
			inspector.inspect(file('b.mp4', isoMedia(12.5, { mediaFirst: true }))),
			inspector.inspect(file('c.mov', isoMedia(7.25, { brand: 'qt  ', version: 1 }))),
			inspector.inspect(file('d.m4a', isoMedia(3, { brand: 'M4A ' }))),
			inspector.inspect(file('e.wav', wav(2.5))),
			// 130 frames of 1152 samples at 44.1 kHz: 3.396 seconds.
			inspector.inspect(file('f.mp3', mp3(130))),
			inspector.inspect(file('g.mp3', mp3(130, { id3: true }))),
			// A Xing header says 1000 frames: 26.122 seconds, whatever follows.
			inspector.inspect(file('h.mp3', mp3(10, { xingFrames: 1000 })))
		]);
		assert.deepEqual(facts.map(fact => [fact.format, Math.round((fact.seconds ?? Number.NaN) * 1000) / 1000]), [
			['mp4', 5],
			['mp4', 12.5],
			['mov', 7.25],
			['m4a', 3],
			['wav', 2.5],
			['mp3', 3.396],
			['mp3', 3.396],
			['mp3', 26.122]
		]);
	});

	test('a generated sound is told from its first bytes: an MP3, a WAV, a FLAC, an Ogg of a sound, or an M4A of an audio brand (D78)', async () => {
		// A frame header of MPEG audio, then enough of the frame to read.
		const frame = (header: readonly number[]) => Buffer.concat([Buffer.from(header), Buffer.alloc(60)]);
		assert.deepEqual({
			id3: audioFormatOf(mp3(2, { id3: true })),
			mpeg1: audioFormatOf(tinyMp3()),
			mpeg2: audioFormatOf(frame([0xff, 0xf3, 0x84, 0xc4])),
			mpeg25: audioFormatOf(frame([0xff, 0xe3, 0x18, 0xc4])),
			wav: audioFormatOf(tinyWav()),
			flac: audioFormatOf(flacHeader()),
			opus: audioFormatOf(oggHeader('opus')),
			vorbis: audioFormatOf(oggHeader('vorbis')),
			oggFlac: audioFormatOf(oggHeader('flac')),
			m4a: audioFormatOf(isoMedia(2, { brand: 'M4A ' })),
			m4b: audioFormatOf(isoMedia(2, { brand: 'M4B ', compatible: ['M4B ', 'isom'] })),
			listsM4a: audioFormatOf(isoMedia(2, { brand: 'mp42', compatible: ['isom', 'M4A '] }))
		}, {
			id3: 'mp3',
			mpeg1: 'mp3',
			mpeg2: 'mp3',
			mpeg25: 'mp3',
			wav: 'wav',
			flac: 'flac',
			opus: 'ogg',
			vorbis: 'ogg',
			oggFlac: 'ogg',
			m4a: 'm4a',
			m4b: 'm4a',
			listsM4a: 'm4a'
		});
		assert.deepEqual({
			// General ISO brands alone may be a video.
			mp4: audioFormatOf(isoMedia(2)),
			mp42: audioFormatOf(isoMedia(2, { brand: 'mp42', compatible: ['mp42', 'isom'] })),
			theora: audioFormatOf(oggHeader('theora')),
			// AAC in ADTS has the sync of MPEG audio and the layer bits 00, which MPEG audio reserves.
			adts: audioFormatOf(frame([0xff, 0xf1, 0x50, 0x80])),
			layerTwo: audioFormatOf(frame([0xff, 0xfd, 0x90, 0x44])),
			freeBitRate: audioFormatOf(frame([0xff, 0xfb, 0x00, 0x44])),
			id3Text: audioFormatOf(Buffer.from('ID3 tags are what many MP3 files start with.')),
			webp: audioFormatOf(webpHeader('VP8 ', 4, 4)),
			png: audioFormatOf(png(4, 4)),
			page: audioFormatOf(Buffer.from('<html>expired</html>')),
			empty: audioFormatOf(new Uint8Array(0))
		}, {
			mp4: undefined,
			mp42: undefined,
			theora: undefined,
			adts: undefined,
			layerTwo: undefined,
			freeBitRate: undefined,
			id3Text: undefined,
			webp: undefined,
			png: undefined,
			page: undefined,
			empty: undefined
		});
		// The tiny sounds of the test kit are what they say.
		assert.deepEqual({ mp3: await measure(bufferSource(tinyMp3())), wav: await measure(bufferSource(tinyWav())), sizes: [tinyMp3().byteLength, tinyWav().byteLength, flacHeader().byteLength] }, {
			mp3: { format: 'mp3', seconds: 4 * 1152 / 44100 },
			wav: { format: 'wav', seconds: 0.01 },
			sizes: [1670, 220, 78]
		});
	});

	test('an input of an ISO media file of a general brand whose tracks hold sound and no video is measured as an M4A, as afconvert writes one with -f m4af or -f mp4f; one with a video track stays a video (D78)', async () => {
		const measured = async (bytes: Buffer) => measure(bufferSource(bytes));
		// `afconvert -f m4af`: the audio brand M4A, then mp42 and isom.
		const m4af = isoMedia(31, { brand: 'M4A ', compatible: ['M4A ', 'mp42', 'isom'], tracks: ['soun'] });
		// `afconvert -f mp4f`, and the recorders of phones: the general brand mp42 alone.
		const mp4f = isoMedia(31, { brand: 'mp42', compatible: ['mp42', 'isom'], tracks: ['soun'] });
		assert.deepEqual({
			m4af: await measured(m4af),
			mp4f: await measured(mp4f),
			isom: await measured(isoMedia(4.5, { tracks: ['soun'] })),
			mediaFirst: await measured(isoMedia(6, { brand: 'mp42', compatible: ['mp42', 'isom'], tracks: ['soun'], mediaFirst: true })),
			// A video with its sound, a video without sound, and a movie whose track names no handler stay videos.
			movie: await measured(isoMedia(5, { brand: 'mp42', compatible: ['mp42', 'isom'], tracks: ['vide', 'soun'] })),
			soundThenPicture: await measured(isoMedia(5, { tracks: ['soun', 'vide'] })),
			silent: await measured(isoMedia(5, { tracks: ['vide'] })),
			unnamed: await measured(isoMedia(5, { brand: 'mp42' })),
			// A QuickTime movie of sound alone is still a movie: only the general brands are looked into.
			quickTime: await measured(isoMedia(5, { brand: 'qt  ', tracks: ['soun'] }))
		}, {
			m4af: { format: 'm4a', seconds: 31 },
			mp4f: { format: 'm4a', seconds: 31 },
			isom: { format: 'm4a', seconds: 4.5 },
			mediaFirst: { format: 'm4a', seconds: 6 },
			movie: { format: 'mp4', seconds: 5 },
			soundThenPicture: { format: 'mp4', seconds: 5 },
			silent: { format: 'mp4', seconds: 5 },
			unnamed: { format: 'mp4', seconds: 5 },
			quickTime: { format: 'mov', seconds: 5 }
		});
		// Every audio limit takes it as a sound, and a video slot does not take it as a video.
		const limits = checkLimits({ ...REFERENCE, limits: { ...REFERENCE.limits, videoSeconds: [2, 15] } }, await measureItems({
			images: [file('cover.png', png(400, 400))],
			videos: [file('voice-memo.mp4', isoMedia(5, { brand: 'mp42', compatible: ['mp42', 'isom'], tracks: ['soun'] }))],
			audios: [file('voice.m4a', isoMedia(4, { brand: 'mp42', compatible: ['mp42', 'isom'], tracks: ['soun'] })), file('hum.m4a', mp4f)]
		}, createMediaInspector()));
		assert.deepEqual(limits, [
			'Reference video 1 voice-memo.mp4 is not a video whose length BaseHalf can read (MP4 or MOV).',
			'Reference audio 2 hum.m4a is 31 seconds long; an audio clip must be 2 to 15 seconds.',
			'The audio clips are 35 seconds long together; at most 15 seconds are allowed.'
		]);
		// A download is still told from its first bytes alone, where general brands may hold a video.
		assert.equal(audioFormatOf(mp4f), undefined);
	});

	test('raw samples written as a WAV start like a sound and last as long as the samples do (D78)', async () => {
		// 1.5 seconds of 16-bit mono at 24 kHz.
		const written = pcmToWav(Buffer.alloc(72_000), { sampleRate: 24_000, channels: 1, bitsPerSample: 16 });
		const odd = pcmToWav(Buffer.alloc(3), { sampleRate: 8000, channels: 1, bitsPerSample: 8 });
		assert.deepEqual({
			format: audioFormatOf(written),
			measured: await measure(bufferSource(written)),
			size: written.byteLength,
			// An odd count of bytes is padded to an even chunk, as RIFF asks.
			odd: [odd.byteLength, odd.readUInt32LE(4), odd.readUInt32LE(40)]
		}, {
			format: 'wav',
			measured: { format: 'wav', seconds: 1.5 },
			size: 44 + 72_000,
			odd: [48, 40, 3]
		});
		assert.throws(() => pcmToWav(Buffer.alloc(2), { sampleRate: 0, channels: 1, bitsPerSample: 16 }), /a positive sample rate/);
	});

	test('what is not an image, a video, or audio has no format, and a missing file is refused', async () => {
		const inspector = createMediaInspector();
		assert.deepEqual(await measure(bufferSource(Buffer.from('%PDF-1.7 not media'))), {});
		assert.deepEqual(await measure(bufferSource(Buffer.alloc(0))), {});
		await assert.rejects(inspector.inspect({ fsPath: join(folder, 'missing.png'), mimeType: 'image/png' }), (caught: ProviderFailure) => caught.code === 'rejected' && caught.message === 'missing.png is missing.');
	});

	test('inputs are read whole under a byte cap, and sent as data URLs of the format they are', async () => {
		const image = file('small.png', png(10, 10), 'IMAGE/PNG');
		const read = await readMedia(image, 1024 * 1024, 'The start frame small.png');
		assert.equal(read.mimeType, 'image/png');
		assert.equal(dataUrlOf(read), `data:image/png;base64,${png(10, 10).toString('base64')}`);
		assert.equal(dataUrlOf(read, 'image/jpeg').slice(0, 23), 'data:image/jpeg;base64,');
		await assert.rejects(readMedia(image, 10, 'The start frame small.png'), /^ProviderFailure: The start frame small.png is \d+ bytes, more than the 10 bytes allowed\.$/);
		await assert.rejects(readMedia({ dataUrl: 'data:text/plain,hello' }, 100, 'The start frame'), /The start frame is not an encoded file BaseHalf can read\./);
		await assert.rejects(readMedia({ dataUrl: `data:image/png;base64,${Buffer.alloc(300).toString('base64')}` }, 100, 'The start frame'), /The start frame is larger than 100 bytes\./);
		assert.deepEqual(plannedItems({ startFrame: image, images: [{ dataUrl: 'data:image/png;base64,' }], videos: [], audios: [image] }).map(item => item.label), [
			'The start frame small.png', 'Reference image 1', 'Reference audio 1 small.png'
		]);
	});

	test('the mode\'s limits name each file and the limit', async () => {
		const inputs: PlannedMedia = {
			startFrame: file('narrow.png', png(200, 900)),
			endFrame: file('wide.jpg', jpegHeader(3000, 1000)),
			images: [],
			videos: [],
			audios: []
		};
		const frames = checkLimits(FRAMES, await measureItems(inputs, createMediaInspector()));
		assert.deepEqual(frames, [
			'The start frame narrow.png is 200 × 900 px; each side must be between 300 and 6000 px.',
			'The start frame narrow.png has an aspect ratio (width to height) of 0.22; it must be between 0.4 and 2.5.',
			'The end frame wide.jpg has an aspect ratio (width to height) of 3.00; it must be between 0.4 and 2.5.'
		]);
		const references = checkLimits(REFERENCE, await measureItems({
			images: [file('fine.png', png(400, 400)), file('notes.txt', Buffer.from('plain text'))],
			videos: [],
			audios: [file('long.wav', wav(16)), file('short.mp3', mp3(40)), file('voice.ogg', Buffer.from('OggS\0\x02'))]
		}, createMediaInspector()));
		assert.deepEqual(references, [
			'Reference image 2 notes.txt is not an image BaseHalf can read (PNG, JPEG, WebP, or GIF).',
			'Reference audio 1 long.wav is 16 seconds long; an audio clip must be 2 to 15 seconds.',
			'Reference audio 2 short.mp3 is 1.0 seconds long; an audio clip must be 2 to 15 seconds.',
			'Reference audio 3 voice.ogg is not audio whose length BaseHalf can read (WAV, MP3, or M4A).',
			'The audio clips are 17.0 seconds long together; at most 15 seconds are allowed.'
		]);
		const tooLarge = checkLimits(FRAMES, await measureItems({ startFrame: file('large.png', Buffer.concat([png(400, 400), Buffer.alloc(2 * 1024 * 1024)])), images: [], videos: [], audios: [] }, createMediaInspector()));
		assert.deepEqual(tooLarge, ['The start frame large.png is 2.0 MiB; an image may be at most 1 MiB.']);
	});

	test('the inputs a mode takes, the prompt rule, and the parameter values are checked from the declarations', () => {
		const counts = { startFrame: false, endFrame: false, images: 0, videos: 0, audios: 0, source: false };
		assert.deepEqual(checkCounts(MODEL, REFERENCE, counts), ['Clip 1 in References mode needs at least 1 reference image.']);
		assert.deepEqual(checkCounts(MODEL, REFERENCE, { ...counts, startFrame: true, images: 4, audios: 3, videos: 1 }), [
			'Clip 1 in References mode takes no start frame.',
			'Clip 1 in References mode takes at most 3 reference images; 4 are planned.',
			'Clip 1 in References mode takes no reference videos.',
			'Clip 1 in References mode takes at most 2 reference audio clips; 3 are planned.'
		]);
		assert.deepEqual(checkCounts(MODEL, FRAMES, { ...counts, endFrame: true }), ['An end frame needs a start frame.']);
		assert.deepEqual(checkPrompt(MODEL, FRAMES, ' ', counts), ['Write a prompt or connect an image: Clip 1 needs one or the other.']);
		assert.deepEqual(checkPrompt(MODEL, FRAMES, '', { ...counts, startFrame: true }), []);
		assert.deepEqual(checkPrompt(MODEL, FRAMES, '画'.repeat(51), counts), ['The prompt is 51 characters long; Clip 1 takes at most 50.']);
		// Characters, not UTF-16 units: 50 emoji fit.
		assert.deepEqual(checkPrompt(MODEL, FRAMES, '🎬'.repeat(50), counts), []);
		assert.deepEqual(checkParams(MODEL, FRAMES, { resolution: '720p', duration: 5 }), []);
		assert.deepEqual(checkParams(MODEL, FRAMES, { resolution: '1080p', duration: 4.5, ratio: '16:9', style: 'noir', seed: 101 }), [
			'Ratio does not apply in Frames mode.',
			'Clip 1 has no setting named "style".',
			'Resolution cannot be 1080p for Clip 1; choose 480p, 720p.',
			'Duration must be a whole number.',
			'Seed must be between 0 and 100.'
		]);
		assert.deepEqual(checkParams(MODEL, REFERENCE, { duration: 20, ratio: 1 }), ['Duration must be between 4 and 12 seconds, or Auto.', 'Ratio cannot be 1 for Clip 1; choose 16:9, 9:16.']);
		assert.deepEqual(checkParams(MODEL, REFERENCE, { duration: -1 }), []);
		assert.deepEqual(resolveParams(MODEL, 'reference', { duration: 8 }), { resolution: '720p', duration: 8, ratio: '16:9' });
		assert.deepEqual(resolveParams(MODEL, 'frames', { seed: 3 }), { resolution: '720p', duration: 5, seed: 3 });
	});

	test('a value beyond a limit is fitted to its end on the parameter\'s steps; Auto and a value inside are kept; only a limit that can be used is kept (D70)', () => {
		const limits = keptLimits(MODEL, { duration: { max: 9.5, reason: ' Room. ' }, ratio: { max: 1, reason: 'Not a number.' }, seed: { min: 3, max: 2, reason: 'No room.' } });
		const tenths = { ...MODEL, parameters: [{ name: 'strength', label: 'Strength', kind: 'number', min: 0, max: 1, step: 0.1, default: 0.5 }] } as CatalogModel;
		assert.deepEqual({
			limits,
			over: fitParams(MODEL, { duration: 12 }, limits),
			inside: fitParams(MODEL, { duration: 6 }, limits),
			auto: fitParams(MODEL, { duration: -1 }, limits),
			byDefault: fitParams(MODEL, {}, keptLimits(MODEL, { duration: { max: 4, reason: 'Short.' } })),
			under: fitParams(MODEL, { duration: 4 }, keptLimits(MODEL, { duration: { min: 6.2, reason: 'Long.' } })),
			// On the steps without their sum's error: 0.3, not 0.30000000000000004.
			tenths: fitParams(tenths, { strength: 0.1 }, keptLimits(tenths, { strength: { min: 0.25, reason: 'Strong.' } })),
			none: fitParams(MODEL, { duration: 12 }, undefined)
		}, {
			limits: { duration: { max: 9.5, reason: 'Room.' } },
			over: { duration: 9 },
			inside: { duration: 6 },
			auto: { duration: -1 },
			byDefault: { duration: 4 },
			under: { duration: 7 },
			tenths: { strength: 0.3 },
			none: { duration: 12 }
		});
	});
});
