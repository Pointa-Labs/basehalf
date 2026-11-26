/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { FileAccess } from '../../../../../base/common/network.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { encodeBaseHalfSoundParts, readBaseHalfSoundInfo } from '../../browser/basehalfSoundEncoder.js';
import { encodeBaseHalfSound } from '../../browser/basehalfVideoClipEncoder.js';
import { encodeBaseHalfFlac, readBaseHalfFlacInfo } from '../../common/basehalfFlacFile.js';
import { writeBaseHalfMp4File } from '../../common/basehalfIsoBmffWriter.js';
import { baseHalfMp3FrameData, readBaseHalfMp3File } from '../../common/basehalfMp3File.js';
import { readBaseHalfOggInfo, writeBaseHalfOggOpus } from '../../common/basehalfOggFile.js';
import { baseHalfOpusPacketDuration } from '../../common/basehalfWebmReader.js';

async function decode(bytes: Uint8Array, rate: number): Promise<AudioBuffer> {
	const context = new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: rate });
	return context.decodeAudioData(bytes.slice().buffer);
}

/** A sine of 440 Hz, at a level in each channel. */
function sine(rate: number, seconds: number, channels: number): Float32Array<ArrayBuffer>[] {
	return Array.from({ length: channels }, (_, channel) => {
		const data = new Float32Array(Math.round(rate * seconds));
		for (let index = 0; index < data.length; index++) {
			data[index] = 0.5 * Math.sin(2 * Math.PI * 440 * index / rate) * (channel ? 0.6 : 1);
		}
		return data;
	});
}

suite('BaseHalfSoundEncoder', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('an MP3 is cut at frame edges, keeps its ID3 tag, decodes in the window, and each frame kept holds its own data byte for byte (D84)', async function () {
		this.timeout(30_000);
		const bytes = new Uint8Array(await (await fetch(FileAccess.asFileUri('vs/platform/accessibilitySignal/browser/media/break.mp3').toString(true))).arrayBuffer());
		const info = await readBaseHalfSoundInfo(bytes, 'mp3');
		const original = readBaseHalfMp3File(bytes)!;
		const frame = original.samplesPerFrame / original.sampleRate;
		// Two parts on frame edges: frames 0 to 9 and 20 to the end.
		const parts = [{ start: 0, end: 10 * frame }, { start: 20 * frame, end: info.duration }];
		const out = await encodeBaseHalfSoundParts(bytes, info, parts);
		const edited = readBaseHalfMp3File(out)!;
		const before = baseHalfMp3FrameData(bytes, original);
		const after = baseHalfMp3FrameData(out, edited);
		const kept = [...before.slice(0, 10), ...before.slice(20)];
		const sameData = kept.every((data, index) => {
			const now = after[index];
			// The granules at a cut give up gain in their side information; their data stays as it was.
			return !!data && !!now && data.length === now.length && data.every((byte, at) => byte === now[at]);
		});
		const decoded = await decode(out, original.sampleRate);
		assert.deepStrictEqual({
			frames: [edited.frames.length, kept.length],
			head: Buffer.from(edited.head).equals(Buffer.from(original.head)),
			sameData,
			// The window plays it for as long as its frames last, give or take the decoder's delay.
			length: Math.abs(decoded.duration - (original.frames.length - 10) * frame) < 2 * frame
		}, { frames: [original.frames.length - 10, original.frames.length - 10], head: true, sameData: true, length: true });
	});

	test('a FLAC encoded by BaseHalf decodes in the window to the very samples it was made of, and keeps its comments (D84)', async function () {
		this.timeout(30_000);
		const rate = 44100;
		const channels = sine(rate, 0.5, 2).map(channel => Int32Array.from(channel, value => Math.round(value * 32767)));
		// A third channel's worth of noise in the left: every predictor has to work.
		for (let index = 0; index < channels[0].length; index += 7) {
			channels[0][index] += (index * 7919) % 301 - 150;
		}
		const comment = Uint8Array.from('\x08\x00\x00\x00BaseHalf\x01\x00\x00\x00\x0b\x00\x00\x00TITLE=Take1', character => character.charCodeAt(0));
		const flac = encodeBaseHalfFlac(channels, rate, 16, [{ type: 4, body: comment }]);
		const decoded = await decode(flac, rate);
		// The window's decoder scales samples above zero by 32767 and below by 32768.
		let differences = 0;
		for (let channel = 0; channel < 2; channel++) {
			const data = decoded.getChannelData(channel);
			for (let index = 0; index < data.length; index++) {
				differences += Math.round(data[index] * (data[index] < 0 ? 32768 : 32767)) !== channels[channel][index] ? 1 : 0;
			}
		}
		const info = readBaseHalfFlacInfo(flac)!;
		const cut = await encodeBaseHalfSoundParts(flac, await readBaseHalfSoundInfo(flac, 'flac'), [{ start: 0.1, end: 0.3 }]);
		assert.deepStrictEqual({
			length: decoded.length,
			differences,
			info: [info.sampleRate, info.channels, info.bitsPerSample, info.totalSamples, info.blocks.length],
			cut: [(await decode(cut, rate)).length, readBaseHalfFlacInfo(cut)?.blocks.length],
			smaller: flac.length < channels[0].length * 4
		}, { length: 22050, differences: 0, info: [44100, 2, 16, 22050, 1], cut: [Math.round(0.2 * rate), 1], smaller: true });
	});

	test('an Ogg of Opus keeps its parts, its comments, and its length; an M4A keeps its parts in AAC (D84)', async function () {
		this.timeout(60_000);
		const opus = await encodeBaseHalfSound({ rate: 48000, channels: 2, data: sine(48000, 1, 2) }, 'opus', 96_000);
		assert.strictEqual(opus.kind, 'opus');
		const track = opus.kind === 'opus' ? opus.track : undefined!;
		const ogg = writeBaseHalfOggOpus({
			packets: track.packets,
			durations: track.packets.map(packet => Math.round((baseHalfOpusPacketDuration(packet) ?? 20_000) * 48_000 / 1_000_000)),
			channels: track.channels,
			preSkip: track.delay,
			length: track.length,
			inputSampleRate: 48000,
			outputGain: 0,
			comments: ['TITLE=Take 1', 'ARTIST=BaseHalf']
		});
		const oggInfo = await readBaseHalfSoundInfo(ogg, 'ogg');
		const oggCut = await encodeBaseHalfSoundParts(ogg, oggInfo, [{ start: 0, end: 0.25 }, { start: 0.5, end: 0.75 }]);

		const aac = await encodeBaseHalfSound({ rate: 48000, channels: 2, data: sine(48000, 1, 2) }, 'aac', 128_000);
		const m4a = aac.kind === 'aac' ? writeBaseHalfMp4File({ format: 'mp4', tracks: [aac.track], metadata: [] }) : undefined;
		const m4aInfo = m4a && await readBaseHalfSoundInfo(m4a, 'm4a').catch(() => undefined);
		const m4aCut = m4a && m4aInfo && await encodeBaseHalfSoundParts(m4a, m4aInfo, [{ start: 0.25, end: 0.75 }]);
		assert.deepStrictEqual({
			ogg: [Math.round(oggInfo.duration * 1000), Math.round((await decode(ogg, 48000)).duration * 1000)],
			oggCut: [Math.round((await decode(oggCut, 48000)).duration * 1000), readBaseHalfOggInfo(oggCut)?.comments],
			// Where the window has no AAC encoder, as on Linux, an M4A is not edited. The window's decoder keeps the
			// encoder's padding after the end that the edit list gives: at most one frame of AAC, 21 ms at 48 kHz.
			m4a: m4aCut ? Math.abs((await decode(m4aCut, 48000)).duration - 0.5) < 1024 / 48000 : true
		}, {
			ogg: [1000, 1000],
			oggCut: [500, ['TITLE=Take 1', 'ARTIST=BaseHalf']],
			m4a: true
		});
	});
});
