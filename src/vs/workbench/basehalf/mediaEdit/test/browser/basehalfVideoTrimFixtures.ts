/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { IBaseHalfFileClonesService } from '../../../../../platform/basehalfFiles/common/basehalfFileClones.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { readBaseHalfFileRange } from '../../../workspace/common/basehalfFileRange.js';
import { aacEncoderDelay, opusEncoderDelay } from '../../browser/basehalfVideoClipEncoder.js';
import { IBaseHalfMp4SampleInput, writeBaseHalfMp4File } from '../../common/basehalfIsoBmffWriter.js';
import { IBaseHalfVideoByteSource } from '../../common/basehalfVideoFile.js';
import { IBaseHalfWebmFrameInput, writeBaseHalfWebmFile } from '../../common/basehalfWebmWriter.js';

/**
 * Makes a short MP4 for the tests of trimming, with the window's own
 * encoders: a picture whose frame n is filled with the gray `frameShade(n)`,
 * and a sound of a steady tone. Resolves with nothing when the window cannot
 * encode H.264 or AAC.
 */
export async function makeBaseHalfTestVideo(options: { readonly frames: number; readonly fps: number; readonly sound: boolean; readonly metadata?: readonly Uint8Array[] }): Promise<Uint8Array | undefined> {
	const width = 160;
	const height = 96;
	const config: VideoEncoderConfig = { codec: 'avc1.42001f', width, height, bitrate: 2_000_000, framerate: options.fps, avc: { format: 'avc' } };
	if (typeof VideoEncoder === 'undefined' || !(await VideoEncoder.isConfigSupported(config)).supported) {
		return undefined;
	}
	const timescale = 15360;
	const frameUnits = timescale / options.fps;
	const pictures: IBaseHalfMp4SampleInput[] = [];
	let pictureConfig: Uint8Array | undefined;
	const encoder = new VideoEncoder({
		output: (chunk, metadata) => {
			const data = new Uint8Array(chunk.byteLength);
			chunk.copyTo(data);
			const description = metadata?.decoderConfig?.description;
			if (description && !pictureConfig) {
				pictureConfig = ArrayBuffer.isView(description) ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength).slice() : new Uint8Array(description).slice();
			}
			const index = Math.round(chunk.timestamp * options.fps / 1_000_000);
			pictures.push({ data, decodeTime: index * frameUnits, time: index * frameUnits, duration: frameUnits, key: chunk.type === 'key' });
		},
		error: () => { }
	});
	encoder.configure(config);
	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext('2d')!;
	for (let index = 0; index < options.frames; index++) {
		const shade = baseHalfTestFrameShade(index);
		context.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
		context.fillRect(0, 0, width, height);
		const frame = new VideoFrame(canvas, { timestamp: Math.round(index * 1_000_000 / options.fps), duration: Math.round(1_000_000 / options.fps) });
		encoder.encode(frame, { keyFrame: index === 0 });
		frame.close();
	}
	await encoder.flush();
	encoder.close();

	const tracks = [{ kind: 'video' as const, codec: 'avc' as const, description: pictureConfig!, timescale, samples: pictures, width, height, displayWidth: width, displayHeight: height, matrix: undefined }];
	if (!options.sound) {
		return writeBaseHalfMp4File({ format: 'mp4', tracks, metadata: options.metadata ?? [] });
	}
	const soundConfig: AudioEncoderConfig = { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 1, bitrate: 128000 };
	if (typeof AudioEncoder === 'undefined' || !(await AudioEncoder.isConfigSupported(soundConfig)).supported) {
		return undefined;
	}
	const packets: IBaseHalfMp4SampleInput[] = [];
	let soundDescription: Uint8Array | undefined;
	const soundEncoder = new AudioEncoder({
		output: (chunk, metadata) => {
			const data = new Uint8Array(chunk.byteLength);
			chunk.copyTo(data);
			const description = metadata?.decoderConfig?.description;
			if (description && !soundDescription) {
				soundDescription = ArrayBuffer.isView(description) ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength).slice() : new Uint8Array(description).slice();
			}
			packets.push({ data, decodeTime: packets.length * 1024, time: packets.length * 1024, duration: 1024, key: true });
		},
		error: () => { }
	});
	soundEncoder.configure(soundConfig);
	const length = Math.round(options.frames / options.fps * 48000);
	const tone = new Float32Array(length);
	for (let index = 0; index < length; index++) {
		tone[index] = 0.5 * Math.sin(2 * Math.PI * 440 * index / 48000);
	}
	const data = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfChannels: 1, numberOfFrames: length, timestamp: 0, data: tone });
	soundEncoder.encode(data);
	data.close();
	await soundEncoder.flush();
	soundEncoder.close();
	return writeBaseHalfMp4File({
		format: 'mp4',
		tracks: [...tracks, { kind: 'audio', codec: 'aac', description: soundDescription!, timescale: 48000, samples: packets, channels: 1, bitrate: 128000, delay: 0, length }],
		metadata: options.metadata ?? []
	});
}

/**
 * Makes a short WebM for the tests of trimming, as a recording is: a picture in
 * VP9 whose frame n is filled with the gray `frameShade(n)`, and a sound of a
 * steady tone in Opus. Resolves with nothing when the window cannot encode
 * VP9 or Opus.
 */
export async function makeBaseHalfTestWebm(options: { readonly frames: number; readonly fps: number; readonly keyEvery?: number; readonly codec?: 'vp8' | 'vp9' }): Promise<Uint8Array | undefined> {
	const width = 160;
	const height = 96;
	const config: VideoEncoderConfig = { codec: options.codec === 'vp8' ? 'vp8' : 'vp09.00.10.08', width, height, bitrate: 1_000_000, framerate: options.fps };
	const soundConfig: AudioEncoderConfig = { codec: 'opus', sampleRate: 48000, numberOfChannels: 1, bitrate: 96000 };
	if (typeof VideoEncoder === 'undefined' || !(await VideoEncoder.isConfigSupported(config)).supported
		|| typeof AudioEncoder === 'undefined' || !(await AudioEncoder.isConfigSupported(soundConfig)).supported) {
		return undefined;
	}
	const frames: IBaseHalfWebmFrameInput[] = [];
	const encoder = new VideoEncoder({
		output: chunk => {
			const data = new Uint8Array(chunk.byteLength);
			chunk.copyTo(data);
			frames.push({ data, time: chunk.timestamp, duration: chunk.duration ?? Math.round(1_000_000 / options.fps), key: chunk.type === 'key' });
		},
		error: () => { }
	});
	encoder.configure(config);
	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext('2d')!;
	for (let index = 0; index < options.frames; index++) {
		const shade = baseHalfTestFrameShade(index);
		context.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
		context.fillRect(0, 0, width, height);
		// A recording counts in milliseconds.
		const frame = new VideoFrame(canvas, { timestamp: Math.round(index * 1000 / options.fps) * 1000, duration: Math.round(1_000_000 / options.fps) });
		encoder.encode(frame, { keyFrame: index % (options.keyEvery ?? Infinity) === 0 });
		frame.close();
	}
	await encoder.flush();
	encoder.close();

	const packets: Uint8Array[] = [];
	const soundEncoder = new AudioEncoder({
		output: chunk => {
			const data = new Uint8Array(chunk.byteLength);
			chunk.copyTo(data);
			packets.push(data);
		},
		error: () => { }
	});
	soundEncoder.configure(soundConfig);
	const length = Math.round(options.frames / options.fps * 48000);
	const tone = new Float32Array(length);
	for (let index = 0; index < length; index++) {
		tone[index] = 0.5 * Math.sin(2 * Math.PI * 440 * index / 48000);
	}
	const data = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfChannels: 1, numberOfFrames: length, timestamp: 0, data: tone });
	soundEncoder.encode(data);
	data.close();
	await soundEncoder.flush();
	soundEncoder.close();
	return writeBaseHalfWebmFile({
		tracks: [
			{ kind: 'video', codec: options.codec ?? 'vp9', timescale: 1_000_000, frames, width, height },
			{ kind: 'audio', codec: 'opus', packets, channels: 1, inputSampleRate: 48000, delay: 312, length }
		]
	});
}

/**
 * Makes a video of 3 s at 30 frames per second for the tests of sync: dark
 * frames but a white one at 1.5 s, and quiet noise but a click at 1.5 s, as an
 * MP4 in H.264 and AAC or as a WebM in VP9 and Opus, each with the delay its
 * sound encoder put before the sound hidden as the container hides it.
 * Resolves with nothing when the window cannot encode them.
 */
export async function makeBaseHalfTestClickVideo(container: 'mp4' | 'webm'): Promise<Uint8Array | undefined> {
	const fps = 30;
	const frames = 90;
	const width = 160;
	const height = 96;
	const rate = 48000;
	const videoConfig: VideoEncoderConfig = container === 'webm'
		? { codec: 'vp09.00.10.08', width, height, bitrate: 1_000_000, framerate: fps }
		: { codec: 'avc1.42001f', width, height, bitrate: 1_000_000, framerate: fps, avc: { format: 'avc' } };
	const audioConfig: AudioEncoderConfig = { codec: container === 'webm' ? 'opus' : 'mp4a.40.2', sampleRate: rate, numberOfChannels: 1, bitrate: 128000 };
	if (typeof VideoEncoder === 'undefined' || !(await VideoEncoder.isConfigSupported(videoConfig)).supported
		|| typeof AudioEncoder === 'undefined' || !(await AudioEncoder.isConfigSupported(audioConfig)).supported) {
		return undefined;
	}
	const pictures: { data: Uint8Array; time: number; key: boolean }[] = [];
	let pictureConfig: Uint8Array | undefined;
	const encoder = new VideoEncoder({
		output: (chunk, metadata) => {
			const data = new Uint8Array(chunk.byteLength);
			chunk.copyTo(data);
			pictures.push({ data, time: chunk.timestamp, key: chunk.type === 'key' });
			const description = metadata?.decoderConfig?.description;
			if (description && !pictureConfig) {
				pictureConfig = ArrayBuffer.isView(description) ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength).slice() : new Uint8Array(description).slice();
			}
		},
		error: () => { }
	});
	encoder.configure(videoConfig);
	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext('2d')!;
	for (let index = 0; index < frames; index++) {
		context.fillStyle = index === 45 ? '#ffffff' : '#202020';
		context.fillRect(0, 0, width, height);
		const frame = new VideoFrame(canvas, { timestamp: Math.round(index * 1000 / fps) * 1000, duration: Math.round(1_000_000 / fps) });
		encoder.encode(frame, { keyFrame: index % 30 === 0 });
		frame.close();
	}
	await encoder.flush();
	encoder.close();

	const length = frames / fps * rate;
	const sound = new Float32Array(length + 4096);
	for (let index = 0; index < length; index++) {
		// A steady noise that the same seed makes again.
		sound[index] = (((index * 7919) % 1000) / 1000 - 0.5) * 0.02;
	}
	sound[1.5 * rate] = 0.95;
	const packets: Uint8Array[] = [];
	let soundConfig: Uint8Array | undefined;
	const soundEncoder = new AudioEncoder({
		output: (chunk, metadata) => {
			const data = new Uint8Array(chunk.byteLength);
			chunk.copyTo(data);
			packets.push(data);
			const description = metadata?.decoderConfig?.description;
			if (description && !soundConfig) {
				soundConfig = ArrayBuffer.isView(description) ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength).slice() : new Uint8Array(description).slice();
			}
		},
		error: () => { }
	});
	soundEncoder.configure(audioConfig);
	const data = new AudioData({ format: 'f32-planar', sampleRate: rate, numberOfChannels: 1, numberOfFrames: sound.length, timestamp: 0, data: sound });
	soundEncoder.encode(data);
	data.close();
	await soundEncoder.flush();
	soundEncoder.close();
	if (container === 'webm') {
		return writeBaseHalfWebmFile({
			tracks: [
				{ kind: 'video', codec: 'vp9', timescale: 1_000_000, width, height, frames: pictures.map((picture, index) => ({ ...picture, duration: index + 1 < pictures.length ? pictures[index + 1].time - picture.time : Math.round(1_000_000 / fps) })) },
				{ kind: 'audio', codec: 'opus', packets, channels: 1, inputSampleRate: rate, delay: await opusEncoderDelay(audioConfig), length }
			]
		});
	}
	const units = 15360;
	return writeBaseHalfMp4File({
		format: 'mp4',
		metadata: [],
		tracks: [
			{ kind: 'video', codec: 'avc', description: pictureConfig!, timescale: units, samples: pictures.map((picture, index) => ({ data: picture.data, decodeTime: index * units / fps, time: index * units / fps, duration: units / fps, key: picture.key })), width, height, displayWidth: width, displayHeight: height, matrix: undefined },
			{ kind: 'audio', codec: 'aac', description: soundConfig!, timescale: rate, samples: packets.map((packet, index) => ({ data: packet, decodeTime: index * 1024, time: index * 1024, duration: 1024, key: true })), channels: 1, bitrate: 128000, delay: await aacEncoderDelay(audioConfig), length }
		]
	});
}

/** When the loudest sample of a file's sound is, by the window's own decoder of whole files, in seconds to the millisecond. */
export async function baseHalfTestClickTime(bytes: Uint8Array): Promise<number> {
	const buffer = await new OfflineAudioContext(1, 48000, 48000).decodeAudioData(bytes.slice().buffer);
	const samples = buffer.getChannelData(0);
	let peak = 0;
	for (let index = 1; index < samples.length; index++) {
		if (Math.abs(samples[index]) > Math.abs(samples[peak])) {
			peak = index;
		}
	}
	return Math.round(peak / buffer.sampleRate * 1000) / 1000;
}

/** The gray of frame n of a test video: far enough apart that a frame is known by it. */
export function baseHalfTestFrameShade(index: number): number {
	return 20 + (index * 7) % 220;
}

export function baseHalfTestByteSource(bytes: Uint8Array): IBaseHalfVideoByteSource {
	return { size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) };
}

/** `assemble` of the file clones service over a file service, as the shared process does it with files on disk. */
export function baseHalfTestAssemble(fileService: IFileService): IBaseHalfFileClonesService['assemble'] {
	return async (target, parts, append = false) => {
		const pieces: VSBuffer[] = [];
		if (append) {
			pieces.push((await fileService.readFile(target)).value);
		} else if (await fileService.exists(target)) {
			throw new Error(`${target.toString()} is there`);
		}
		for (const part of parts) {
			pieces.push(part instanceof VSBuffer ? part : await readBaseHalfFileRange(fileService, part.source, part.offset, part.length));
		}
		await fileService.writeFile(target, VSBuffer.concat(pieces));
	};
}

/** The gray at the middle of each frame of a picture, decoded with the window's decoder, by the order the frames are shown. */
export async function baseHalfTestShades(codec: string, description: Uint8Array | undefined, chunks: readonly { readonly data: Uint8Array; readonly time: number; readonly key: boolean }[]): Promise<number[]> {
	const shades: { time: number; shade: number }[] = [];
	const canvas = new OffscreenCanvas(8, 8);
	const context = canvas.getContext('2d', { willReadFrequently: true })!;
	const decoder = new VideoDecoder({
		output: frame => {
			context.drawImage(frame, 0, 0, 8, 8);
			shades.push({ time: frame.timestamp, shade: context.getImageData(4, 4, 1, 1).data[0] });
			frame.close();
		},
		error: () => { }
	});
	decoder.configure({ codec, ...(description ? { description } : {}) });
	for (const chunk of chunks) {
		decoder.decode(new EncodedVideoChunk({ type: chunk.key ? 'key' : 'delta', timestamp: chunk.time, data: chunk.data }));
	}
	await decoder.flush();
	decoder.close();
	return shades.sort((a, b) => a.time - b.time).map(entry => entry.shade);
}
