/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfVideoClipBitrate, baseHalfVideoClipContainer, baseHalfVideoClipSoundBitrate, planBaseHalfVideoClip } from '../../common/basehalfVideoClipPlan.js';
import { IBaseHalfVideoFile, IBaseHalfVideoSample, IBaseHalfVideoTrack } from '../../common/basehalfVideoFile.js';

function track(kind: 'video' | 'audio', format: string, timescale: number, samples: IBaseHalfVideoSample[], extra?: Partial<IBaseHalfVideoTrack>): IBaseHalfVideoTrack {
	return {
		kind,
		format,
		codec: kind === 'video' ? 'avc1.64001f' : 'mp4a.40.2',
		description: undefined,
		timescale,
		samples,
		width: 854,
		height: 480,
		displayWidth: 854,
		displayHeight: 480,
		matrix: undefined,
		rotation: 0,
		sampleRate: kind === 'audio' ? 44100 : 0,
		channels: kind === 'audio' ? 2 : 0,
		end: undefined,
		...extra
	};
}

/**
 * 150 frames at 30 per second, 1000 bytes each, shown I B B P B B P and
 * decoded I P B B P B B, with a key frame every `keyEvery` frames shown.
 */
function pictureWithBFrames(keyEvery = 150): IBaseHalfVideoSample[] {
	const decodeOrder = [0];
	for (let p = 3; p < 150; p += 3) {
		// The P frame is decoded before the two B frames shown before it.
		decodeOrder.push(p, p - 2, p - 1);
	}
	decodeOrder.push(148, 149);
	return decodeOrder.map((shown, decode) => ({
		offset: decode * 1000,
		size: 1000,
		decodeTime: decode * 512,
		time: shown * 512,
		duration: 512,
		key: shown % keyEvery === 0
	}));
}

/** The sound of AAC at 44.1 kHz, with the 1024 samples of its encoder's delay before 0. */
function sound(seconds: number): IBaseHalfVideoSample[] {
	const count = Math.ceil(seconds * 44100 / 1024) + 1;
	return Array.from({ length: count }, (_, index) => ({ offset: 1_000_000 + index * 300, size: 300, decodeTime: index * 1024, time: index * 1024 - 1024, duration: 1024, key: true }));
}

suite('BaseHalfVideoClipPlan', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('keeps the frames shown between the start and the end, decoded from the key frame they need', () => {
		const file: IBaseHalfVideoFile = { format: 'mp4', video: track('video', 'avc1', 15360, pictureWithBFrames()), audio: track('audio', 'mp4a', 44100, sound(5)), metadata: [] };
		const plan = planBaseHalfVideoClip(file, 'mp4', { start: 1, end: 2 });
		const shownTimes = plan.picture.kept.map(frame => frame.time / 512);
		assert.deepStrictEqual({
			kept: [shownTimes.length, shownTimes[0], shownTimes[shownTimes.length - 1]],
			// From the one key frame at the start to the last frame needed, which is decoded before the frames shown before it.
			decode: [plan.picture.decode.length, plan.picture.decode[0].time / 512, plan.picture.decode[plan.picture.decode.length - 1].time / 512],
			container: plan.container,
			codec: plan.picture.codec,
			sound: plan.sound && { from: plan.sound.from, to: plan.sound.to, fadeIn: plan.sound.fadeIn, fadeOut: plan.sound.fadeOut, firstPacket: plan.sound.decode[0].time, bitrate: plan.sound.bitrate }
		}, {
			kept: [30, 30, 59],
			decode: [61, 0, 59],
			container: 'mp4',
			codec: 'avc',
			// Two packets before the start are decoded, so that the first one kept is whole; 103 kbit/s snaps to 96.
			sound: { from: 1, to: 2, fadeIn: true, fadeOut: true, firstPacket: 1024 * 41, bitrate: 96000 }
		});
	});

	test('a frame shown before its key frame needs the key frame before it, and a cut at the sound\'s own ends does not fade', () => {
		// The key frame shown at 30 is decoded before the frames shown at 28 and 29 (an open group of pictures).
		const file: IBaseHalfVideoFile = { format: 'mp4', video: track('video', 'avc1', 15360, pictureWithBFrames(30)), audio: track('audio', 'mp4a', 44100, sound(5)), metadata: [] };
		const plan = planBaseHalfVideoClip(file, 'mov', { start: 0.95, end: 5 });
		const lastSample = file.audio!.samples[file.audio!.samples.length - 1];
		const soundEnd = (lastSample.time + lastSample.duration) / 44100;
		const whole = planBaseHalfVideoClip(file, 'mov', { start: 0, end: soundEnd });
		assert.deepStrictEqual({
			firstDecoded: plan.picture.decode[0].time / 512,
			firstKept: plan.picture.kept[0].time / 512,
			container: plan.container,
			fades: [whole.sound!.fadeIn, whole.sound!.fadeOut]
		}, {
			// The frame shown at 28 comes after the key frame at 30: decoding starts at the key frame before, at 0.
			firstDecoded: 0,
			firstKept: 28,
			container: 'mov',
			fades: [false, false]
		});
	});

	test('encodes at no lower a bitrate than the video, with more for a codec that keeps less, and at least its bits per pixel', () => {
		const pixels480p = 854 * 480 * 30;
		const pixels1440p60 = 2560 * 1440 * 60;
		assert.deepStrictEqual([
			baseHalfVideoClipBitrate(4_000_000, 'avc', 'avc', pixels480p),
			baseHalfVideoClipBitrate(4_000_000, 'vp9', 'avc', pixels480p),
			baseHalfVideoClipBitrate(4_000_000, 'av1', 'avc', pixels480p),
			baseHalfVideoClipBitrate(4_000_000, 'hevc', 'hevc', pixels480p),
			baseHalfVideoClipBitrate(6_900_000, 'avc', 'avc', pixels1440p60),
			baseHalfVideoClipBitrate(100_000, 'avc', 'avc', 1000),
			baseHalfVideoClipBitrate(500_000_000, 'avc', 'avc', pixels480p),
			baseHalfVideoClipBitrate(4_000_000, 'vp9', 'vp9', pixels480p),
			baseHalfVideoClipBitrate(4_000_000, 'av1', 'vp9', pixels480p),
			baseHalfVideoClipSoundBitrate(44_000),
			baseHalfVideoClipSoundBitrate(127_800),
			baseHalfVideoClipSoundBitrate(320_000)
		], [
			5_000_000,
			6_400_000,
			8_000_000,
			5_000_000,
			Math.round(0.07 * pixels1440p60),
			1_000_000,
			100_000_000,
			5_000_000,
			8_000_000,
			96_000,
			128_000,
			192_000
		]);
	});

	test('keeps the video\'s container, since the trimmed video keeps its name: a WebM in VP9', () => {
		const webm: IBaseHalfVideoFile = { format: 'webm', video: track('video', 'V_VP8', 1_000_000, pictureWithBFrames().map(sample => ({ ...sample, decodeTime: sample.time }))), audio: undefined, metadata: [] };
		const mp4: IBaseHalfVideoFile = { format: 'mp4', video: track('video', 'hvc1', 15360, pictureWithBFrames()), audio: undefined, metadata: [] };
		assert.deepStrictEqual([
			['WEBM', 'm4v', 'MOV', 'mp4'].map(extension => baseHalfVideoClipContainer(extension)),
			[planBaseHalfVideoClip(webm, 'webm', { start: 0, end: 0.002 }).picture.codec, planBaseHalfVideoClip(mp4, 'mov', { start: 0, end: 1 }).picture.codec, planBaseHalfVideoClip({ ...mp4, video: track('video', 'avc1', 15360, pictureWithBFrames()) }, 'm4v', { start: 0, end: 1 }).picture.codec]
		], [
			['webm', 'mp4', 'mov', 'mp4'],
			['vp9', 'hevc', 'avc']
		]);
	});
});
