/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { readBaseHalfIsoBmffFile } from '../../common/basehalfIsoBmffReader.js';
import { IBaseHalfMp4SampleInput, writeBaseHalfMp4File } from '../../common/basehalfIsoBmffWriter.js';
import { BaseHalfByteWriter } from '../../common/basehalfVideoBytes.js';
import { baseHalfAv1Codec, baseHalfAvcCodec, baseHalfAvcLevels, baseHalfHevcCodec, baseHalfHevcLevels, baseHalfMpeg4AudioCodec, baseHalfOpusHeadFromDops, baseHalfVp9Codec } from '../../common/basehalfVideoCodecs.js';
import { BaseHalfVideoFileError, baseHalfVideoFrameEdges, IBaseHalfVideoByteSource, IBaseHalfVideoTrack } from '../../common/basehalfVideoFile.js';

/** An `avcC` of H.264 High at level 3.1. */
const AVCC = Uint8Array.of(1, 0x64, 0x00, 0x1F, 0xFF, 0xE1, 0, 4, 0x67, 0x64, 0x00, 0x1F, 1, 0, 2, 0x68, 0xEE);
/** The AudioSpecificConfig of AAC-LC at 44.1 kHz in stereo. */
const AAC_CONFIG = Uint8Array.of(0x12, 0x10);

function sourceOf(bytes: Uint8Array): IBaseHalfVideoByteSource {
	return { size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) };
}

function frames(count: number, duration: number, keyEvery: number): IBaseHalfMp4SampleInput[] {
	return Array.from({ length: count }, (_, index) => ({
		data: Uint8Array.of(index & 0xFF, 1, 2, 3, 4),
		decodeTime: index * duration,
		time: index * duration,
		duration,
		key: index % keyEvery === 0
	}));
}

function summary(track: IBaseHalfVideoTrack | undefined) {
	return track && {
		format: track.format,
		codec: track.codec,
		timescale: track.timescale,
		count: track.samples.length,
		keys: track.samples.filter(sample => sample.key).length,
		first: [track.samples[0].time, track.samples[1].time],
		end: track.end,
		size: [track.width, track.height, track.displayWidth, track.displayHeight],
		rotation: track.rotation,
		sound: [track.sampleRate, track.channels]
	};
}

suite('BaseHalfIsoBmff', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('a clip it writes is read back with the same samples, edit lists, matrix, and information of the file', async () => {
		const turned = [0, 0x10000, 0, -0x10000, 0, 0, 480 * 0x10000, 0, 0x40000000];
		const udta = new BaseHalfByteWriter().box('udta', box => box.box('meta', meta => meta.u32(0).fourcc('AIGC'))).result();
		const bytes = writeBaseHalfMp4File({
			format: 'mp4',
			tracks: [
				{ kind: 'video', codec: 'avc', description: AVCC, timescale: 15360, samples: frames(60, 512, 30), width: 854, height: 480, displayWidth: 854, displayHeight: 480, matrix: turned },
				{ kind: 'audio', codec: 'aac', description: AAC_CONFIG, timescale: 44100, samples: frames(90, 1024, 1), channels: 2, bitrate: 128000, delay: 2112, length: 88200 }
			],
			metadata: [udta]
		});
		const file = await readBaseHalfIsoBmffFile(sourceOf(bytes), 'mp4');
		const firstVideo = file.video!.samples[0];
		const data = bytes.subarray(firstVideo.offset, firstVideo.offset + firstVideo.size);
		assert.deepStrictEqual({
			video: summary(file.video),
			audio: summary(file.audio),
			metadata: file.metadata.map(box => Array.from(box)),
			firstSampleData: Array.from(data),
			matrix: file.video!.matrix,
			edges: [baseHalfVideoFrameEdges(file.video!).length, baseHalfVideoFrameEdges(file.video!).at(-1)]
		}, {
			video: { format: 'avc1', codec: 'avc1.64001f', timescale: 15360, count: 60, keys: 2, first: [0, 512], end: 30720, size: [854, 480, 480, 854], rotation: 90, sound: [0, 0] },
			// The sound's edit list hides the delay of its encoder.
			audio: { format: 'mp4a', codec: 'mp4a.40.2', timescale: 44100, count: 90, keys: 90, first: [-2112, -1088], end: 88200, size: [0, 0, 0, 0], rotation: 0, sound: [44100, 2] },
			metadata: [Array.from(udta)],
			firstSampleData: [0, 1, 2, 3, 4],
			matrix: turned,
			edges: [61, 2]
		});
	});

	test('reads composition offsets, sync samples, and an edit list that starts the picture after its B-frames\' delay', async () => {
		// Four frames decoded I P B B, shown I B B P, with the first shown 1024 units after it is decoded.
		const decodeTimes = [0, 512, 1024, 1536];
		const offsets = [1024, 2560, 512, 512];
		const bytes = movieWith(writer => {
			writer.box('trak', trak => {
				trak.fullBox('tkhd', 0, 3, tkhd => tkhd.u32(0).u32(0).u32(1).u32(0).u32(1000).zeros(8).u16(0).u16(0).u16(0).u16(0).i32(0x10000).i32(0).i32(0).i32(0).i32(0x10000).i32(0).i32(0).i32(0).i32(0x40000000).u32(640 << 16).u32(360 << 16));
				// A segment of 0 runs to the end of the track.
				trak.box('edts', edts => edts.fullBox('elst', 0, 0, elst => elst.u32(1).u32(0).i32(1024).i16(1).u16(0)));
				mdia(trak, 'vide', 15360, stbl => {
					stbl.fullBox('stsd', 0, 0, stsd => stsd.u32(1).box('avc1', entry => entry.zeros(6).u16(1).zeros(16).u16(640).u16(360).zeros(50).box('avcC', config => config.bytes(AVCC))));
					stbl.fullBox('stts', 0, 0, stts => stts.u32(1).u32(4).u32(512));
					stbl.fullBox('ctts', 0, 0, ctts => {
						ctts.u32(4);
						for (const offset of offsets) {
							ctts.u32(1).u32(offset);
						}
					});
					stbl.fullBox('stss', 0, 0, stss => stss.u32(1).u32(1));
					stbl.fullBox('stsc', 0, 0, stsc => stsc.u32(1).u32(1).u32(4).u32(1));
					stbl.fullBox('stsz', 0, 0, stsz => stsz.u32(0).u32(4).u32(10).u32(20).u32(30).u32(40));
					stbl.fullBox('stco', 0, 0, stco => stco.u32(1).u32(5000));
				});
			});
		});
		const file = await readBaseHalfIsoBmffFile(sourceOf(bytes), 'mp4');
		assert.deepStrictEqual({
			times: file.video!.samples.map(sample => sample.time),
			decode: file.video!.samples.map(sample => sample.decodeTime),
			offsets: file.video!.samples.map(sample => sample.offset),
			keys: file.video!.samples.map(sample => sample.key),
			edges: baseHalfVideoFrameEdges(file.video!).map(edge => Math.round(edge * 15360))
		}, {
			times: decodeTimes.map((time, index) => time + offsets[index] - 1024),
			decode: decodeTimes,
			offsets: [5000, 5010, 5030, 5060],
			keys: [true, false, false, false],
			edges: [0, 512, 1024, 2048, 2560]
		});
	});

	test('reads the samples of movie fragments, and refuses an edit list of several parts and a file without a movie', async () => {
		const fragmented = movieWith(writer => {
			writer.box('mvex', mvex => mvex.fullBox('trex', 0, 0, trex => trex.u32(1).u32(1).u32(1000).u32(0).u32(0x10000)));
			writer.box('trak', trak => {
				trak.fullBox('tkhd', 0, 3, tkhd => tkhd.u32(0).u32(0).u32(1).u32(0).u32(0).zeros(8).zeros(8).i32(0x10000).i32(0).i32(0).i32(0).i32(0x10000).i32(0).i32(0).i32(0).i32(0x40000000).u32(320 << 16).u32(240 << 16));
				mdia(trak, 'vide', 30000, stbl => {
					stbl.fullBox('stsd', 0, 0, stsd => stsd.u32(1).box('avc1', entry => entry.zeros(6).u16(1).zeros(16).u16(320).u16(240).zeros(50).box('avcC', config => config.bytes(AVCC))));
					stbl.fullBox('stts', 0, 0, stts => stts.u32(0));
					stbl.fullBox('stsc', 0, 0, stsc => stsc.u32(0));
					stbl.fullBox('stsz', 0, 0, stsz => stsz.u32(0).u32(0));
					stbl.fullBox('stco', 0, 0, stco => stco.u32(0));
				});
			});
		}, writer => {
			// One fragment of three samples, the first a key frame, from the start of the fragment.
			writer.box('moof', moof => moof.box('traf', traf => {
				traf.fullBox('tfhd', 0, 0x020000 | 0x08, tfhd => tfhd.u32(1).u32(1000));
				traf.fullBox('tfdt', 1, 0, tfdt => tfdt.u64(0));
				traf.fullBox('trun', 0, 0x01 | 0x04 | 0x200, trun => trun.u32(3).i32(200).u32(0).u32(11).u32(12).u32(13));
			}));
		});
		const file = await readBaseHalfIsoBmffFile(sourceOf(fragmented), 'mp4');
		const twoEdits = movieWith(writer => {
			writer.box('trak', trak => {
				trak.box('edts', edts => edts.fullBox('elst', 0, 0, elst => elst.u32(2).u32(500).i32(0).i16(1).u16(0).u32(500).i32(3000).i16(1).u16(0)));
				mdia(trak, 'vide', 1000, stbl => {
					stbl.fullBox('stsd', 0, 0, stsd => stsd.u32(1).box('avc1', entry => entry.zeros(6).u16(1).zeros(16).u16(8).u16(8).zeros(50)));
					stbl.fullBox('stts', 0, 0, stts => stts.u32(1).u32(1).u32(40));
					stbl.fullBox('stsc', 0, 0, stsc => stsc.u32(1).u32(1).u32(1).u32(1));
					stbl.fullBox('stsz', 0, 0, stsz => stsz.u32(4).u32(1));
					stbl.fullBox('stco', 0, 0, stco => stco.u32(1).u32(0));
				});
			});
		});
		const refusal = async (bytes: Uint8Array) => {
			try {
				await readBaseHalfIsoBmffFile(sourceOf(bytes), 'mp4');
				return 'read';
			} catch (error) {
				return error instanceof BaseHalfVideoFileError ? error.reason : 'other';
			}
		};
		const fragmentStart = boxStart(fragmented, 'moof');
		assert.deepStrictEqual({
			samples: file.video!.samples.map(sample => [sample.offset - fragmentStart, sample.size, sample.decodeTime, sample.key]),
			twoEdits: await refusal(twoEdits),
			noMovie: await refusal(new BaseHalfByteWriter().box('ftyp', box => box.fourcc('isom')).box('mdat', box => box.zeros(8)).result()),
			notAFile: await refusal(Uint8Array.of(0, 0, 0, 1))
		}, {
			samples: [[200, 11, 0, true], [211, 12, 1000, false], [223, 13, 2000, false]],
			twoEdits: 'unsupportedEditList',
			noMovie: 'format',
			notAFile: 'format'
		});
	});

	test('names codecs as the window\'s decoders do, and chooses the lowest level a picture fits in', () => {
		const hvcC = Uint8Array.of(1, 0x01, 0x60, 0, 0, 0, 0x90, 0, 0, 0, 0, 0, 93, 0xF0, 0, 0xFC);
		const vpcC = Uint8Array.of(1, 0, 0, 0, 0, 31, 0x80, 1, 1, 1, 0, 0);
		const av1C = Uint8Array.of(0x81, 0x08, 0x0C, 0);
		const dOps = Uint8Array.of(0, 2, 0x01, 0x38, 0, 0, 0xBB, 0x80, 0, 0, 0);
		assert.deepStrictEqual({
			avc: baseHalfAvcCodec('avc1', AVCC),
			hevc: baseHalfHevcCodec('hvc1', hvcC),
			vp9: [baseHalfVp9Codec(vpcC), baseHalfVp9Codec(undefined, 2)],
			av1: baseHalfAv1Codec(av1C),
			audio: [baseHalfMpeg4AudioCodec(0x40, AAC_CONFIG), baseHalfMpeg4AudioCodec(0x40, Uint8Array.of(0x2B, 0x92, 0x08, 0x00)), baseHalfMpeg4AudioCodec(0x6B, undefined), baseHalfMpeg4AudioCodec(0xA5, undefined)],
			opusHead: Array.from(baseHalfOpusHeadFromDops(dOps)!),
			avcLevels: [baseHalfAvcLevels(854, 480, 30, 5e6)[0], baseHalfAvcLevels(1920, 1080, 30, 8e6)[0], baseHalfAvcLevels(2560, 1440, 60, 15e6)[0], baseHalfAvcLevels(1920, 1080, 30, 40e6)[0]],
			hevcLevels: [baseHalfHevcLevels(854, 480, 30, 5e6)[0], baseHalfHevcLevels(3840, 2160, 30, 20e6)[0]]
		}, {
			avc: 'avc1.64001f',
			hevc: 'hvc1.1.6.L93.90',
			vp9: ['vp09.00.31.08', 'vp09.02.10.10'],
			av1: 'av01.0.08M.08',
			audio: ['mp4a.40.2', 'mp4a.40.5', 'mp3', undefined],
			opusHead: [0x4F, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1, 2, 0x38, 0x01, 0x80, 0xBB, 0, 0, 0, 0, 0],
			avcLevels: [0x1F, 0x28, 0x33, 0x29],
			hevcLevels: [90, 150]
		});
	});
});

/** An MP4 whose movie `moov` writes, and boxes after it that `after` writes. */
function movieWith(moov: (writer: BaseHalfByteWriter) => void, after?: (writer: BaseHalfByteWriter) => void): Uint8Array {
	const writer = new BaseHalfByteWriter();
	writer.box('ftyp', box => box.fourcc('isom').u32(0x200).fourcc('isom'));
	writer.box('moov', box => {
		box.fullBox('mvhd', 0, 0, mvhd => mvhd.u32(0).u32(0).u32(1000).u32(0).u32(0x10000).u16(0x100).zeros(10).zeros(36).zeros(24).u32(2));
		moov(box);
	});
	after?.(writer);
	return writer.result();
}

/** Where the first box of a type starts in a file. */
function boxStart(bytes: Uint8Array, type: string): number {
	for (let index = 4; index + 4 <= bytes.length; index++) {
		if (String.fromCharCode(bytes[index], bytes[index + 1], bytes[index + 2], bytes[index + 3]) === type) {
			return index - 4;
		}
	}
	return -1;
}

/** A track's `mdia` with its handler and sample table. */
function mdia(writer: BaseHalfByteWriter, handler: string, timescale: number, stbl: (writer: BaseHalfByteWriter) => void): void {
	writer.box('mdia', box => {
		box.fullBox('mdhd', 0, 0, mdhd => mdhd.u32(0).u32(0).u32(timescale).u32(0).u16(0x55C4).u16(0));
		box.fullBox('hdlr', 0, 0, hdlr => hdlr.u32(0).fourcc(handler).zeros(12).u8(0));
		box.box('minf', minf => minf.box('stbl', stbl));
	});
}
