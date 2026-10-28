/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { baseHalfAvcLevels, baseHalfHevcLevels, baseHalfVp9Levels } from '../common/basehalfVideoCodecs.js';
import { baseHalfVideoClipBitrate, BaseHalfVideoClipCodec, baseHalfVideoCodecFamily, baseHalfVideoTrackBitrate, IBaseHalfVideoClipPlan, planBaseHalfSoundPart } from '../common/basehalfVideoClipPlan.js';
import { IBaseHalfWebmCopyPlan } from '../common/basehalfVideoCopy.js';
import { IBaseHalfVideoByteSource, IBaseHalfVideoFile, IBaseHalfVideoSample, IBaseHalfVideoTrack } from '../common/basehalfVideoFile.js';
import { IBaseHalfMp4AudioTrackInput, IBaseHalfMp4SampleInput, writeBaseHalfMp4File } from '../common/basehalfIsoBmffWriter.js';
import { baseHalfOpusPacketDuration } from '../common/basehalfWebmReader.js';
import { IBaseHalfWebmAudioTrackInput, IBaseHalfWebmFrameInput, writeBaseHalfWebmFile } from '../common/basehalfWebmWriter.js';

/**
 * Encodes the clip that a trim makes of a video with the window's own
 * decoders and encoders (WebCodecs), as its plan says (trimming a video,
 * "What the trimmed video holds"): the picture from the key frame it needs,
 * keeping the frames shown between the start and the end, each at its own
 * time; the sound decoded and cut to the same range, faded where it is cut,
 * and encoded in AAC, with the encoder's delay hidden by the clip's edit list,
 * or in Opus, with the delay written as its codec delay; and the MP4, MOV, or
 * WebM file of both.
 */

export type BaseHalfVideoClipErrorReason = 'pictureUnsupported' | 'encoderUnsupported' | 'encode' | 'tooLarge';

export class BaseHalfVideoClipError extends Error {
	constructor(readonly reason: BaseHalfVideoClipErrorReason, detail?: string) {
		super(baseHalfVideoClipErrorMessage(reason, detail));
		this.name = 'BaseHalfVideoClipError';
	}
}

function baseHalfVideoClipErrorMessage(reason: BaseHalfVideoClipErrorReason, detail?: string): string {
	switch (reason) {
		case 'pictureUnsupported': return localize('basehalf.videoTrim.clip.decode', "this system cannot decode its picture.");
		case 'encoderUnsupported': return localize('basehalf.videoTrim.clip.encoder', "this system cannot encode a picture of this size.");
		case 'tooLarge': return localize('basehalf.videoTrim.clip.tooLarge', "the trimmed video would be larger than 2 GB.");
		case 'encode': return detail
			? localize('basehalf.videoTrim.clip.encodeDetail', "the encoder stopped: {0}", detail)
			: localize('basehalf.videoTrim.clip.encodeStopped', "the encoder stopped.");
	}
}

/** A clip larger than this is not encoded: it is built in memory before it is written. */
export const BASEHALF_VIDEO_CLIP_MAX_BYTES = 2 * 1024 * 1024 * 1024;

export interface IBaseHalfVideoClipEncoding {
	readonly bytes: Uint8Array;
	/** The video's sound could not be decoded or encoded: the clip has none. */
	readonly soundDropped: boolean;
	readonly codec: BaseHalfVideoClipCodec;
}

export interface IBaseHalfVideoClipEncodeRequest {
	readonly source: IBaseHalfVideoByteSource;
	readonly file: IBaseHalfVideoFile;
	readonly plan: IBaseHalfVideoClipPlan;
	readonly onProgress?: (fraction: number) => void;
}

/** How many samples of the file are read at once, at most. */
const READ_BATCH_BYTES = 8 * 1024 * 1024;
/** How many frames may wait in a decoder or an encoder before the next is given. */
const QUEUE_LIMIT = 6;
/** A key frame about this often in the clip. */
const KEY_FRAME_SECONDS = 2;
/** How long a fade is where the clip cuts into the sound. */
const FADE_SECONDS = 0.005;
const AAC_FRAME = 1024;
/** Opus always decodes at 48 kHz (RFC 7845, section 4). */
const OPUS_RATE = 48_000;
/** The delays the encoders put before the sound when they cannot be measured, in samples. */
const AAC_DELAY_FALLBACK = 2112;
const OPUS_DELAY_FALLBACK = 312;

/** Encodes a clip. */
export async function encodeBaseHalfVideoClip(request: IBaseHalfVideoClipEncodeRequest): Promise<IBaseHalfVideoClipEncoding> {
	const { plan, file } = request;
	if (plan.estimatedBytes > BASEHALF_VIDEO_CLIP_MAX_BYTES) {
		throw new BaseHalfVideoClipError('tooLarge');
	}
	const video = file.video!;
	const picture = await encodePicture(request, video);
	request.onProgress?.(0.9);
	let soundDropped = false;
	let sound: IBaseHalfEncodedSound | undefined;
	if (plan.sound && file.audio) {
		try {
			sound = await encodeSound(request.source, file.audio, plan.sound, plan.container === 'webm' ? 'opus' : 'aac');
		} catch {
			// A sound the window cannot decode or encode leaves the clip without sound, which the trim bar says.
			soundDropped = true;
		}
	}
	request.onProgress?.(0.97);
	const bytes = plan.container === 'webm'
		? writeBaseHalfWebmFile({
			tracks: [
				{ kind: 'video', codec: 'vp9', timescale: picture.timescale, width: picture.width, height: picture.height, frames: picture.samples },
				...(sound?.kind === 'opus' ? [sound.track] : [])
			]
		})
		: writeBaseHalfMp4File({
			format: plan.container,
			tracks: [
				{
					kind: 'video',
					codec: picture.codec === 'hevc' ? 'hevc' : 'avc',
					description: picture.description!,
					timescale: picture.timescale,
					samples: picture.samples,
					width: picture.width,
					height: picture.height,
					// The size before the matrix, which turns it as it turned the video.
					displayWidth: picture.width,
					displayHeight: picture.height,
					matrix: video.matrix
				},
				...(sound?.kind === 'aac' ? [sound.track] : [])
			],
			metadata: file.format === 'webm' ? [] : file.metadata
		});
	if (bytes.length > BASEHALF_VIDEO_CLIP_MAX_BYTES) {
		throw new BaseHalfVideoClipError('tooLarge');
	}
	request.onProgress?.(1);
	return { bytes, soundDropped, codec: picture.codec };
}

export interface IBaseHalfWebmCopyRequest {
	readonly source: IBaseHalfVideoByteSource;
	readonly file: IBaseHalfVideoFile;
	readonly plan: IBaseHalfWebmCopyPlan;
	readonly onProgress?: (fraction: number) => void;
}

/**
 * Trims a WebM as its plan says (editing media, "What the edited file holds",
 * D99): the frames from the part's start to the first key frame after it
 * encoded again in the video's codec, the first of them a key frame; the
 * frames from that key frame on, and the packets of an Opus sound, copied as
 * they are; and a sound of another codec encoded again in Opus. Only the frames
 * of the head take an encoder's time.
 */
export async function encodeBaseHalfWebmCopy(request: IBaseHalfWebmCopyRequest): Promise<IBaseHalfVideoClipEncoding> {
	const { plan, file, source } = request;
	const video = file.video!;
	// The file is built in memory, as an encoded clip is: what it copies tells its size before anything is read.
	let copiedBytes = 0;
	for (const sample of [...plan.copied, ...plan.sound?.packets ?? []]) {
		copiedBytes += sample.size;
	}
	if (copiedBytes > BASEHALF_VIDEO_CLIP_MAX_BYTES) {
		throw new BaseHalfVideoClipError('tooLarge');
	}
	const milliseconds = (seconds: number) => Math.round(seconds * 1000);
	const frames: IBaseHalfWebmFrameInput[] = [];
	let width = video.width;
	let height = video.height;
	if (plan.head) {
		const sourceBitrate = baseHalfVideoTrackBitrate(video);
		const frameRate = plan.head.end > plan.start ? plan.head.kept.length / (plan.head.end - plan.start) : 30;
		const pixelsPerSecond = video.width * video.height * frameRate;
		const headPlan: IBaseHalfVideoClipPlan = {
			start: plan.start,
			end: plan.head.end,
			container: 'webm',
			picture: {
				decode: plan.head.decode,
				kept: plan.head.kept,
				codec: plan.codec,
				sourceFamily: baseHalfVideoCodecFamily(video.format),
				sourceBitrate,
				pixelsPerSecond,
				bitrate: baseHalfVideoClipBitrate(sourceBitrate, baseHalfVideoCodecFamily(video.format), plan.codec, pixelsPerSecond),
				frameRate
			},
			sound: undefined,
			estimatedBytes: 0
		};
		// The head's share of the work: the frames it encodes, against all that are read.
		const share = plan.head.decode.length / (plan.head.decode.length + plan.copied.length / 20);
		const picture = await encodePicture({ source, file, plan: headPlan, onProgress: done => request.onProgress?.(done * share) }, video);
		width = picture.width;
		height = picture.height;
		for (const sample of picture.samples) {
			frames.push({ data: sample.data, time: sample.time, duration: sample.duration, key: sample.key });
		}
	}
	const endMilliseconds = milliseconds(plan.end - plan.start);
	for await (const { sample, data } of readSamples(source, plan.copied)) {
		const time = milliseconds(sample.time / video.timescale - plan.start);
		const until = Math.min(endMilliseconds, milliseconds((sample.time + sample.duration) / video.timescale - plan.start));
		frames.push({ data: data.slice(), time, duration: Math.max(1, until - time), key: sample.key });
	}
	request.onProgress?.(0.9);

	let soundDropped = false;
	let sound: IBaseHalfWebmAudioTrackInput | undefined;
	const audio = file.audio;
	if (plan.sound && audio) {
		const packets: Uint8Array[] = [];
		for await (const { data } of readSamples(source, plan.sound.packets)) {
			packets.push(data.slice());
		}
		const head = audio.description;
		const inputSampleRate = head && head.length >= 16 ? new DataView(head.buffer, head.byteOffset, head.byteLength).getUint32(12, true) : audio.sampleRate;
		sound = {
			kind: 'audio',
			codec: 'opus',
			packets,
			channels: audio.channels,
			inputSampleRate: inputSampleRate || OPUS_RATE,
			delay: plan.sound.delay,
			length: plan.sound.length,
			start: milliseconds(plan.sound.from - plan.start)
		};
	} else if (audio) {
		const part = planBaseHalfSoundPart(audio, plan.start, plan.end);
		if (part) {
			try {
				const encoded = await encodeSound(source, audio, part, 'opus');
				sound = encoded.kind === 'opus' ? { ...encoded.track, start: milliseconds(part.from - plan.start) } : undefined;
			} catch {
				// A sound the window cannot decode or encode leaves the clip without sound, which the line under the editor says.
				soundDropped = true;
			}
		}
	}
	request.onProgress?.(0.97);
	const bytes = writeBaseHalfWebmFile({
		tracks: [
			{ kind: 'video', codec: plan.codec, timescale: 1000, width, height, frames },
			...(sound ? [sound] : [])
		]
	});
	if (bytes.length > BASEHALF_VIDEO_CLIP_MAX_BYTES) {
		throw new BaseHalfVideoClipError('tooLarge');
	}
	request.onProgress?.(1);
	return { bytes, soundDropped, codec: plan.codec };
}

/** A copy of what a decoder's configuration gives as bytes. */
function copyBytes(source: AllowSharedBufferSource): Uint8Array {
	const view = ArrayBuffer.isView(source) ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength) : new Uint8Array(source);
	return view.slice();
}

/** Reads samples' bytes, several at a time where they lie together. */
async function* readSamples(source: IBaseHalfVideoByteSource, samples: readonly IBaseHalfVideoSample[]): AsyncGenerator<{ readonly sample: IBaseHalfVideoSample; readonly data: Uint8Array }> {
	let index = 0;
	while (index < samples.length) {
		const first = samples[index];
		let end = first.offset + first.size;
		let last = index;
		while (last + 1 < samples.length) {
			const next = samples[last + 1];
			if (next.offset < end || next.offset > end + 64 * 1024 || next.offset + next.size - first.offset > READ_BATCH_BYTES) {
				break;
			}
			end = next.offset + next.size;
			last++;
		}
		const bytes = await source.read(first.offset, end - first.offset);
		for (let at = index; at <= last; at++) {
			const sample = samples[at];
			yield { sample, data: bytes.subarray(sample.offset - first.offset, sample.offset - first.offset + sample.size) };
		}
		index = last + 1;
	}
}

/**
 * Wakes what waits for room in the queues of decoders and encoders: their
 * `dequeue` events, and a frame the encoder took. Timers are not used to
 * wait, because a window in the background runs them once a second.
 */
class BaseHalfQueueSignal {
	private waiters: (() => void)[] = [];

	listen(codec: VideoDecoder | VideoEncoder | AudioDecoder | AudioEncoder): void {
		codec.addEventListener('dequeue', () => this.fire());
	}

	fire(): void {
		const waiters = this.waiters;
		this.waiters = [];
		for (const waiter of waiters) {
			waiter();
		}
	}

	/** Resolves once `size` is at most `limit`. */
	async whenAtMost(size: () => number, limit: number): Promise<void> {
		while (size() > limit) {
			await new Promise<void>(resolve => {
				this.waiters.push(resolve);
				// A last resort when no event comes.
				setTimeout(resolve, 250);
			});
		}
	}
}

function microseconds(track: Pick<IBaseHalfVideoTrack, 'timescale'>, units: number): number {
	return Math.round(units * 1_000_000 / track.timescale);
}

/** The clip's picture: its frames in the order they are decoded, with their times in `timescale`. */
interface IEncodedPicture {
	readonly codec: BaseHalfVideoClipCodec;
	/** `avcC` or `hvcC` for H.264 and HEVC; VP8 and VP9 have none. */
	readonly description: Uint8Array | undefined;
	readonly timescale: number;
	readonly samples: readonly IBaseHalfMp4SampleInput[];
	/** The coded size of the picture. */
	readonly width: number;
	readonly height: number;
}

/** The window's encoders take how HEVC is written too, which the DOM's types do not name yet. */
interface IBaseHalfVideoEncoderConfig extends VideoEncoderConfig {
	readonly hevc?: { readonly format: 'hevc' | 'annexb' };
}

interface IPictureEncoderSetup {
	readonly codec: BaseHalfVideoClipCodec;
	readonly config: IBaseHalfVideoEncoderConfig;
	readonly width: number;
	readonly height: number;
}

/** The codec string of an encoder at a level, as `baseHalfAvcLevels`, `baseHalfHevcLevels`, and `baseHalfVp9Levels` give it. */
function encoderCodec(codec: BaseHalfVideoClipCodec, level: number): string {
	switch (codec) {
		case 'hevc': return `hvc1.1.6.L${level}.B0`;
		case 'vp9': return `vp09.00.${level}.08`;
		case 'vp8': return 'vp8';
		case 'avc': return `avc1.6400${level.toString(16).padStart(2, '0')}`;
	}
}

/** The first configuration of the encoder that the window supports, in the codec of the plan, else for HEVC in H.264. */
async function chooseEncoder(plan: IBaseHalfVideoClipPlan, width: number, height: number): Promise<IPictureEncoderSetup> {
	const sizes = [{ width, height }];
	if (width % 2 || height % 2) {
		// An encoder may refuse an odd size: one pixel less then.
		sizes.push({ width: width - (width % 2), height: height - (height % 2) });
	}
	// A WebM holds no H.264: a VP9 that cannot be encoded is not encoded.
	const codecs: BaseHalfVideoClipCodec[] = plan.picture.codec === 'hevc' ? ['hevc', 'avc'] : [plan.picture.codec];
	for (const codec of codecs) {
		const bitrate = baseHalfVideoClipBitrate(plan.picture.sourceBitrate, plan.picture.sourceFamily, codec, plan.picture.pixelsPerSecond);
		for (const size of sizes) {
			// VP8 has no levels.
			const levels = codec === 'hevc'
				? baseHalfHevcLevels(size.width, size.height, plan.picture.frameRate, bitrate)
				: codec === 'vp9'
					? baseHalfVp9Levels(size.width, size.height, plan.picture.frameRate, bitrate)
					: codec === 'vp8'
						? [0]
						: baseHalfAvcLevels(size.width, size.height, plan.picture.frameRate, bitrate);
			for (const level of levels) {
				const config: IBaseHalfVideoEncoderConfig = {
					codec: encoderCodec(codec, level),
					width: size.width,
					height: size.height,
					bitrate,
					bitrateMode: 'variable',
					framerate: Math.max(1, Math.round(plan.picture.frameRate)),
					latencyMode: 'quality',
					hardwareAcceleration: 'no-preference',
					...(codec === 'hevc' ? { hevc: { format: 'hevc' } } : codec === 'avc' ? { avc: { format: 'avc' } } : {})
				};
				try {
					const support = await VideoEncoder.isConfigSupported(config);
					if (support.supported) {
						return { codec, config, width: size.width, height: size.height };
					}
				} catch {
					// A configuration the window cannot read is one it does not support.
				}
			}
		}
	}
	throw new BaseHalfVideoClipError('encoderUnsupported');
}

/** Whether a frame is not plain 8-bit standard range, and is drawn as the window draws it before it is encoded. */
function needsDrawing(frame: VideoFrame, width: number, height: number): boolean {
	const format = frame.format;
	if (format !== 'I420' && format !== 'NV12' && format !== 'I420A') {
		return true;
	}
	// The DOM's types do not name the high dynamic ranges yet; the window does.
	const transfer: string | null | undefined = frame.colorSpace?.transfer;
	const primaries: string | null | undefined = frame.colorSpace?.primaries;
	if (transfer === 'pq' || transfer === 'hlg' || primaries === 'bt2020') {
		return true;
	}
	return frame.visibleRect !== null && (frame.visibleRect.width !== width || frame.visibleRect.height !== height);
}

async function encodePicture(request: IBaseHalfVideoClipEncodeRequest, video: IBaseHalfVideoTrack): Promise<IEncodedPicture> {
	const { plan, source } = request;
	if (!video.codec) {
		throw new BaseHalfVideoClipError('pictureUnsupported');
	}
	const decoderConfig: VideoDecoderConfig = {
		codec: video.codec,
		...(video.description ? { description: video.description } : {}),
		...(video.width && video.height ? { codedWidth: video.width, codedHeight: video.height } : {}),
		hardwareAcceleration: 'no-preference'
	};
	try {
		if (!(await VideoDecoder.isConfigSupported(decoderConfig)).supported) {
			throw new BaseHalfVideoClipError('pictureUnsupported');
		}
	} catch (error) {
		throw error instanceof BaseHalfVideoClipError ? error : new BaseHalfVideoClipError('pictureUnsupported');
	}

	const startMicros = Math.round(plan.start * 1_000_000);
	const endMicros = Math.round(plan.end * 1_000_000);
	const kept = plan.picture.kept;
	const keptTimes = kept.map(frame => microseconds(video, frame.time));
	const keptIndex = new Map<number, number>();
	keptTimes.forEach((time, index) => keptIndex.set(time, index));
	// Each kept frame is shown from its time, or the start, until the next one, or the end.
	const shownFrom = keptTimes.map(time => Math.max(time, startMicros) - startMicros);
	const shownTo = keptTimes.map((time, index) => Math.min(index + 1 < keptTimes.length ? keptTimes[index + 1] : microseconds(video, kept[index].time + kept[index].duration), endMicros) - startMicros);

	// A WebM counts in milliseconds; an MP4 or MOV keeps the video's units of time when it has them, so that every frame keeps its exact time.
	const timescale = plan.container === 'webm' ? 1000 : request.file.format === 'webm' || video.timescale > 1_000_000 ? 90_000 : video.timescale;
	const units = (micros: number) => Math.round(micros * timescale / 1_000_000);

	let setup: IPictureEncoderSetup | undefined;
	let encoder: VideoEncoder | undefined;
	let failure: Error | undefined;
	let description: Uint8Array | undefined;
	const encoded: { data: Uint8Array; time: number; key: boolean }[] = [];
	let encodedFrames = 0;
	let lastKey = -Infinity;
	let canvas: OffscreenCanvas | undefined;
	// Decoded frames waiting for the encoder: a decoder stops giving frames while too many are held.
	let waiting = 0;
	const signal = new BaseHalfQueueSignal();

	const fail = (error: unknown) => {
		failure ??= error instanceof Error ? error : new Error(String(error));
		signal.fire();
	};

	const encodeFrame = async (frame: VideoFrame, index: number) => {
		try {
			if (!setup) {
				const width = frame.visibleRect?.width ?? frame.codedWidth;
				const height = frame.visibleRect?.height ?? frame.codedHeight;
				setup = await chooseEncoder(plan, width, height);
				encoder = new VideoEncoder({
					output: (chunk, metadata) => {
						const data = new Uint8Array(chunk.byteLength);
						chunk.copyTo(data);
						const config = metadata?.decoderConfig?.description;
						if (config && !description) {
							description = copyBytes(config);
						}
						encoded.push({ data, time: chunk.timestamp, key: chunk.type === 'key' });
						encodedFrames++;
						request.onProgress?.(0.9 * encodedFrames / kept.length);
					},
					error: fail
				});
				signal.listen(encoder);
				encoder.configure(setup.config);
			}
			const timestamp = shownFrom[index];
			const duration = Math.max(1, shownTo[index] - shownFrom[index]);
			let input: VideoFrame;
			if (needsDrawing(frame, setup.width, setup.height)) {
				canvas ??= new OffscreenCanvas(setup.width, setup.height);
				const context = canvas.getContext('2d')!;
				const visible = frame.visibleRect;
				context.drawImage(frame, visible?.x ?? 0, visible?.y ?? 0, setup.width, setup.height, 0, 0, setup.width, setup.height);
				input = new VideoFrame(canvas, { timestamp, duration });
			} else {
				input = new VideoFrame(frame, { timestamp, duration });
			}
			const key = index === 0 || timestamp - lastKey >= KEY_FRAME_SECONDS * 1_000_000;
			if (key) {
				lastKey = timestamp;
			}
			await signal.whenAtMost(() => encoder!.encodeQueueSize, QUEUE_LIMIT);
			encoder!.encode(input, { keyFrame: key });
			input.close();
		} catch (error) {
			fail(error);
		} finally {
			frame.close();
			waiting--;
			signal.fire();
		}
	};

	// Frames come out of the decoder in the order they are shown; they are encoded in that order.
	let chain = Promise.resolve();
	const decoder = new VideoDecoder({
		output: frame => {
			const index = keptIndex.get(frame.timestamp);
			if (index === undefined || failure) {
				frame.close();
				return;
			}
			waiting++;
			chain = chain.then(() => encodeFrame(frame, index));
		},
		error: fail
	});
	signal.listen(decoder);
	decoder.configure(decoderConfig);
	try {
		for await (const { sample, data } of readSamples(source, plan.picture.decode)) {
			if (failure) {
				break;
			}
			await signal.whenAtMost(() => decoder.decodeQueueSize + waiting, QUEUE_LIMIT);
			decoder.decode(new EncodedVideoChunk({
				type: sample.key ? 'key' : 'delta',
				timestamp: microseconds(video, sample.time),
				duration: microseconds(video, sample.duration),
				data
			}));
		}
		if (!failure) {
			await decoder.flush();
		}
		await chain;
		if (!failure && encoder) {
			await encoder.flush();
		}
	} catch (error) {
		fail(error);
	} finally {
		if (decoder.state !== 'closed') {
			decoder.close();
		}
		if (encoder && encoder.state !== 'closed') {
			encoder.close();
		}
	}
	if (failure) {
		throw failure instanceof BaseHalfVideoClipError ? failure : new BaseHalfVideoClipError('encode', failure.message);
	}
	if (!setup || (setup.codec !== 'vp9' && setup.codec !== 'vp8' && !description) || !encoded.length) {
		throw new BaseHalfVideoClipError('encode');
	}

	// The encoder gives the frames in the order they are decoded; their decode times are their shown times in order.
	const shownTimes = encoded.map(sample => sample.time).sort((a, b) => a - b);
	let shift = 0;
	encoded.forEach((sample, index) => {
		shift = Math.max(shift, shownTimes[index] - sample.time);
	});
	const lastShown = shownTo[shownTo.length - 1];
	const samples: IBaseHalfMp4SampleInput[] = encoded.map((sample, index) => {
		const decodeTime = units(shownTimes[index] - shift);
		const nextDecode = index + 1 < encoded.length ? units(shownTimes[index + 1] - shift) : units(lastShown - shift);
		return {
			data: sample.data,
			decodeTime,
			time: units(sample.time),
			duration: Math.max(1, nextDecode - decodeTime),
			key: sample.key
		};
	});
	return { codec: setup.codec, description, timescale, samples, width: setup.width, height: setup.height };
}

export type IBaseHalfEncodedSound =
	| { readonly kind: 'aac'; readonly track: IBaseHalfMp4AudioTrackInput }
	| { readonly kind: 'opus'; readonly track: IBaseHalfWebmAudioTrackInput };

/** The sound of a clip, decoded, cut, faded, and encoded in AAC or in Opus. */
async function encodeSound(source: IBaseHalfVideoByteSource, audio: IBaseHalfVideoTrack, sound: NonNullable<IBaseHalfVideoClipPlan['sound']>, codec: 'aac' | 'opus'): Promise<IBaseHalfEncodedSound> {
	const pcm = await decodeBaseHalfSound(source, audio, sound);
	baseHalfFadeSound(pcm, 0, pcm.data[0].length, sound.fadeIn, sound.fadeOut);
	return encodeBaseHalfSound(pcm, codec, sound.bitrate);
}

/** Fades sound in over its first 5 ms after `from`, and out over its last 5 ms before `to`, in samples. */
export function baseHalfFadeSound(pcm: IBaseHalfDecodedSound, from: number, to: number, fadeIn: boolean, fadeOut: boolean): void {
	const fade = Math.min(Math.round(FADE_SECONDS * pcm.rate), Math.floor((to - from) / 2));
	for (const channel of pcm.data) {
		for (let index = 0; index < fade; index++) {
			const gain = (index + 1) / (fade + 1);
			if (fadeIn) {
				channel[from + index] *= gain;
			}
			if (fadeOut) {
				channel[to - 1 - index] *= gain;
			}
		}
	}
}

/**
 * Encodes decoded sound in AAC, as an MP4 and an M4A hold it, or in Opus, as a
 * WebM and an Ogg do, at a bitrate: at the sample rate and in the channels
 * the window's encoder takes, the encoder's delay measured.
 */
export async function encodeBaseHalfSound(pcm: IBaseHalfDecodedSound, codec: 'aac' | 'opus', bitrate: number): Promise<IBaseHalfEncodedSound> {
	let { rate, channels, data } = pcm;
	const config = codec === 'opus' ? await chooseOpusEncoder(channels, bitrate) : await chooseAudioEncoder(rate, channels, bitrate);
	if (config.sampleRate !== rate || config.numberOfChannels !== channels) {
		data = await resample(data, rate, config.sampleRate, config.numberOfChannels);
		rate = config.sampleRate;
		channels = config.numberOfChannels;
	}
	const frames = data[0].length;
	if (frames === 0) {
		throw new Error('No sound in the range.');
	}
	if (codec === 'opus') {
		const delay = await opusEncoderDelay(config);
		// Silence after the sound brings its last samples out of the encoder; the packets that hold only silence are left out.
		const encoded = await encodeAudio(config, data.map(channel => padded(channel, delay + OPUS_RATE / 50)));
		const packets: Uint8Array[] = [];
		let decoded = 0;
		for (const packet of encoded.packets) {
			if (decoded >= delay + frames) {
				break;
			}
			packets.push(packet);
			decoded += Math.round((baseHalfOpusPacketDuration(packet) ?? 20_000) * OPUS_RATE / 1_000_000);
		}
		return { kind: 'opus', track: { kind: 'audio', codec: 'opus', packets, channels, inputSampleRate: pcm.rate, delay, length: frames } };
	}
	const delay = await aacEncoderDelay(config);
	const encoded = await encodeAudio(config, data);
	if (!encoded.description) {
		throw new Error('The encoder gave no configuration of its sound.');
	}
	return {
		kind: 'aac',
		track: {
			kind: 'audio',
			codec: 'aac',
			description: encoded.description,
			timescale: rate,
			samples: encoded.packets.map((packet, index) => ({ data: packet, decodeTime: index * AAC_FRAME, time: index * AAC_FRAME, duration: AAC_FRAME, key: true })),
			channels,
			bitrate: config.bitrate ?? bitrate,
			delay,
			length: frames
		}
	};
}

function padded(channel: Float32Array<ArrayBuffer>, extra: number): Float32Array<ArrayBuffer> {
	const longer = new Float32Array(channel.length + extra);
	longer.set(channel);
	return longer;
}

export interface IBaseHalfDecodedSound {
	readonly rate: number;
	readonly channels: number;
	/** One array per channel, the samples from the clip's start to its end. */
	readonly data: Float32Array<ArrayBuffer>[];
}

/** Decodes the sound of a track that a plan says, with the window's decoder, placed exactly to the sample by its packets' times. */
export async function decodeBaseHalfSound(source: IBaseHalfVideoByteSource, audio: IBaseHalfVideoTrack, sound: NonNullable<IBaseHalfVideoClipPlan['sound']>): Promise<IBaseHalfDecodedSound> {
	if (!audio.codec) {
		throw new Error('No decoder for this sound.');
	}
	const config: AudioDecoderConfig = {
		codec: audio.codec,
		sampleRate: audio.sampleRate,
		numberOfChannels: audio.channels,
		...(audio.description ? { description: audio.codec === 'opus' ? withoutPreSkip(audio.description) : audio.description } : {})
	};
	if (!(await AudioDecoder.isConfigSupported(config)).supported) {
		throw new Error('The window cannot decode this sound.');
	}
	let failure: Error | undefined;
	const outputs: { time: number; rate: number; planes: Float32Array[] }[] = [];
	const signal = new BaseHalfQueueSignal();
	const decoder = new AudioDecoder({
		output: data => {
			try {
				const planes: Float32Array[] = [];
				for (let channel = 0; channel < data.numberOfChannels; channel++) {
					const plane = new Float32Array(data.numberOfFrames);
					data.copyTo(plane, { planeIndex: channel, format: 'f32-planar' });
					planes.push(plane);
				}
				outputs.push({ time: data.timestamp / 1_000_000, rate: data.sampleRate, planes });
			} catch (error) {
				failure ??= error instanceof Error ? error : new Error(String(error));
			} finally {
				data.close();
			}
		},
		error: error => {
			failure ??= error;
			signal.fire();
		}
	});
	signal.listen(decoder);
	decoder.configure(config);
	try {
		for await (const { sample, data } of readSamples(source, sound.decode)) {
			if (failure) {
				break;
			}
			await signal.whenAtMost(() => decoder.decodeQueueSize, 16);
			decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: microseconds(audio, sample.time), duration: microseconds(audio, sample.duration), data }));
		}
		if (!failure) {
			await decoder.flush();
		}
	} finally {
		if (decoder.state !== 'closed') {
			decoder.close();
		}
	}
	if (failure || !outputs.length) {
		throw failure ?? new Error('The sound decoded to nothing.');
	}
	const rate = outputs[0].rate;
	const channels = outputs[0].planes.length;
	const frames = Math.round((sound.to - sound.from) * rate);
	const data = Array.from({ length: channels }, () => new Float32Array(frames));
	// Each output goes where its time says, so that the cut is exact to the sample.
	for (const output of outputs) {
		const at = Math.round((output.time - sound.from) * rate);
		for (let channel = 0; channel < channels; channel++) {
			const plane = output.planes[Math.min(channel, output.planes.length - 1)];
			const from = Math.max(0, -at);
			const to = Math.min(plane.length, frames - at);
			if (to > from) {
				data[channel].set(plane.subarray(from, to), at + from);
			}
		}
	}
	return { rate, channels, data };
}

/**
 * The identification header of Opus with no samples to skip at the start: the
 * times of the packets, from the codec delay or the edit list, already place
 * them, and the window's decoder would drop the header's samples once more
 * while it keeps the first packet's time (measured on 2026-10-25: a trimmed
 * WebM's sound came 6.5 ms early, the encoder's delay of 312 samples).
 */
function withoutPreSkip(head: Uint8Array): Uint8Array {
	const isHead = head.length >= 19 && String.fromCharCode(...head.subarray(0, 8)) === 'OpusHead';
	if (!isHead) {
		return head;
	}
	const copy = head.slice();
	copy[10] = 0;
	copy[11] = 0;
	return copy;
}

/**
 * The configuration of the AAC encoder for a sound (trimming a video, "Its
 * format"): the sound's sample rate when it is 44.1 or 48 kHz, 48 kHz
 * otherwise, in stereo or mono as the sound is, and the bitrate of the plan.
 */
async function chooseAudioEncoder(rate: number, channels: number, bitrate: number): Promise<AudioEncoderConfig> {
	const sampleRate = rate === 44100 || rate === 48000 ? rate : 48000;
	const numberOfChannels = channels === 1 ? 1 : 2;
	const candidates: AudioEncoderConfig[] = [
		{ codec: 'mp4a.40.2', sampleRate, numberOfChannels, bitrate },
		{ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 128_000 }
	];
	for (const candidate of candidates) {
		try {
			if ((await AudioEncoder.isConfigSupported(candidate)).supported) {
				return candidate;
			}
		} catch {
			// Not supported.
		}
	}
	throw new Error('The window cannot encode AAC.');
}

/** The configuration of the Opus encoder for a sound: 48 kHz, in stereo or mono as the sound is, and the bitrate of the plan. */
async function chooseOpusEncoder(channels: number, bitrate: number): Promise<AudioEncoderConfig> {
	const config: AudioEncoderConfig = { codec: 'opus', sampleRate: OPUS_RATE, numberOfChannels: channels === 1 ? 1 : 2, bitrate };
	if (!(await AudioEncoder.isConfigSupported(config)).supported) {
		throw new Error('The window cannot encode Opus.');
	}
	return config;
}

/** Sound at another sample rate or with another number of channels, as the window's audio resamples and mixes it. */
async function resample(data: Float32Array<ArrayBuffer>[], from: number, to: number, channels: number): Promise<Float32Array<ArrayBuffer>[]> {
	const frames = Math.max(1, Math.round(data[0].length * to / from));
	const context = new OfflineAudioContext(channels, frames, to);
	const buffer = context.createBuffer(data.length, data[0].length, from);
	data.forEach((channel, index) => buffer.copyToChannel(channel, index));
	const node = context.createBufferSource();
	node.buffer = buffer;
	node.connect(context.destination);
	node.start();
	const rendered = await context.startRendering();
	return Array.from({ length: channels }, (_, index) => rendered.getChannelData(index).slice());
}

async function encodeAudio(config: AudioEncoderConfig, data: Float32Array[]): Promise<{ readonly packets: Uint8Array[]; readonly description: Uint8Array | undefined }> {
	const packets: Uint8Array[] = [];
	let description: Uint8Array | undefined;
	let failure: Error | undefined;
	const signal = new BaseHalfQueueSignal();
	const encoder = new AudioEncoder({
		output: (chunk, metadata) => {
			const bytes = new Uint8Array(chunk.byteLength);
			chunk.copyTo(bytes);
			packets.push(bytes);
			const value = metadata?.decoderConfig?.description;
			if (value && !description) {
				description = copyBytes(value);
			}
		},
		error: error => {
			failure ??= error;
			signal.fire();
		}
	});
	signal.listen(encoder);
	encoder.configure(config);
	try {
		const frames = data[0].length;
		const block = AAC_FRAME * 16;
		for (let at = 0; at < frames && !failure; at += block) {
			const count = Math.min(block, frames - at);
			const planar = new Float32Array(count * data.length);
			data.forEach((channel, index) => planar.set(channel.subarray(at, at + count), index * count));
			const audioData = new AudioData({
				format: 'f32-planar',
				sampleRate: config.sampleRate,
				numberOfChannels: data.length,
				numberOfFrames: count,
				timestamp: Math.round(at * 1_000_000 / config.sampleRate),
				data: planar
			});
			await signal.whenAtMost(() => encoder.encodeQueueSize, 16);
			encoder.encode(audioData);
			audioData.close();
		}
		if (!failure) {
			await encoder.flush();
		}
	} finally {
		if (encoder.state !== 'closed') {
			encoder.close();
		}
	}
	if (failure || !packets.length) {
		throw failure ?? new Error('The sound encoded to nothing.');
	}
	return { packets, description };
}

const encoderDelays = new Map<string, Promise<number>>();

/**
 * The delay the window's AAC encoder adds before the sound, in samples: the
 * clip's edit list hides it. It differs between systems, so it is measured
 * once for each sample rate and number of channels: a click after silence is
 * encoded and decoded, and found again.
 */
export function aacEncoderDelay(config: AudioEncoderConfig): Promise<number> {
	return encoderDelay(config, AAC_DELAY_FALLBACK);
}

/** The delay the window's Opus encoder adds before the sound, in samples at 48 kHz: the WebM's codec delay. */
export function opusEncoderDelay(config: AudioEncoderConfig): Promise<number> {
	return encoderDelay(config, OPUS_DELAY_FALLBACK);
}

function encoderDelay(config: AudioEncoderConfig, fallback: number): Promise<number> {
	const key = `${config.codec}/${config.sampleRate}/${config.numberOfChannels}`;
	let delay = encoderDelays.get(key);
	if (!delay) {
		delay = measureEncoderDelay(config).catch(() => fallback);
		encoderDelays.set(key, delay);
	}
	return delay;
}

async function measureEncoderDelay(config: AudioEncoderConfig): Promise<number> {
	const rate = config.sampleRate;
	const at = AAC_FRAME * 4;
	const frames = AAC_FRAME * 16;
	const channel = new Float32Array(frames);
	channel[at] = 0.9;
	const data = Array.from({ length: config.numberOfChannels }, () => channel.slice());
	const encoded = await encodeAudio(config, data);
	const decoded: Float32Array[] = [];
	let failure: Error | undefined;
	const decoder = new AudioDecoder({
		output: audioData => {
			const plane = new Float32Array(audioData.numberOfFrames);
			audioData.copyTo(plane, { planeIndex: 0, format: 'f32-planar' });
			decoded.push(plane);
			audioData.close();
		},
		error: error => { failure ??= error; }
	});
	// Opus is decoded without a header, so that the decoder drops nothing at the start.
	decoder.configure({
		codec: config.codec,
		sampleRate: rate,
		numberOfChannels: config.numberOfChannels,
		...(config.codec !== 'opus' && encoded.description ? { description: encoded.description } : {})
	});
	let time = 0;
	for (const packet of encoded.packets) {
		const duration = config.codec === 'opus' ? baseHalfOpusPacketDuration(packet) ?? 20_000 : Math.round(AAC_FRAME * 1_000_000 / rate);
		decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: time, data: packet }));
		time += duration;
	}
	await decoder.flush();
	decoder.close();
	if (failure) {
		throw failure;
	}
	let peak = -1;
	let peakValue = 0;
	let position = 0;
	for (const plane of decoded) {
		for (let index = 0; index < plane.length; index++) {
			const value = Math.abs(plane[index]);
			if (value > peakValue) {
				peakValue = value;
				peak = position + index;
			}
		}
		position += plane.length;
	}
	if (peak < at) {
		throw new Error('The click was not found again.');
	}
	return peak - at;
}
