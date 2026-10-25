/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { BaseHalfByteWriter } from './basehalfVideoBytes.js';

/**
 * Writes the MP4 or MOV file of a clip (trimming a video, "Its format"): a
 * picture in H.264 or HEVC and a sound in AAC, with the movie's index before
 * its data, so that the clip plays while it is still being read; the samples
 * of both tracks in chunks of about half a second, one after the other in
 * time; an edit list on each track that says where it starts to be shown and
 * how long, which hides the delay of the sound's encoder; and the movie's
 * information boxes of the video it was cut from, unchanged.
 */

/** A compressed sample to write. */
export interface IBaseHalfMp4SampleInput {
	readonly data: Uint8Array;
	/** When it is decoded and when it is shown, in the track's units. */
	readonly decodeTime: number;
	readonly time: number;
	readonly duration: number;
	readonly key: boolean;
}

export interface IBaseHalfMp4VideoTrackInput {
	readonly kind: 'video';
	readonly codec: 'avc' | 'hevc';
	/** `avcC` or `hvcC`, as the encoder gives it. */
	readonly description: Uint8Array;
	readonly timescale: number;
	readonly samples: readonly IBaseHalfMp4SampleInput[];
	/** The coded size of the picture. */
	readonly width: number;
	readonly height: number;
	/** The size it is shown at before its matrix, and the matrix of the video it was cut from. */
	readonly displayWidth: number;
	readonly displayHeight: number;
	readonly matrix: readonly number[] | undefined;
}

export interface IBaseHalfMp4AudioTrackInput {
	readonly kind: 'audio';
	readonly codec: 'aac';
	/** The AudioSpecificConfig the encoder gives. */
	readonly description: Uint8Array;
	/** The sample rate: a sample of AAC is a packet of 1024 of them. */
	readonly timescale: number;
	readonly samples: readonly IBaseHalfMp4SampleInput[];
	readonly channels: number;
	readonly bitrate: number;
	/** The encoder's delay, in the track's units: the samples before it are not shown. */
	readonly delay: number;
	/** How long the sound is shown, in the track's units. */
	readonly length: number;
}

export type BaseHalfMp4TrackInput = IBaseHalfMp4VideoTrackInput | IBaseHalfMp4AudioTrackInput;

export interface IBaseHalfMp4FileInput {
	readonly format: 'mp4' | 'mov';
	readonly tracks: readonly BaseHalfMp4TrackInput[];
	/** Whole `udta` and `meta` boxes of the movie of the video, which the clip keeps. */
	readonly metadata: readonly Uint8Array[];
}

const MOVIE_TIMESCALE = 1000;
const CHUNK_SECONDS = 0.5;
const IDENTITY = [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000];

interface IChunk {
	readonly track: number;
	readonly first: number;
	readonly count: number;
	readonly bytes: number;
	readonly seconds: number;
}

/** The bytes of the clip's file. */
export function writeBaseHalfMp4File(input: IBaseHalfMp4FileInput): Uint8Array {
	const tracks = input.tracks.filter(track => track.samples.length > 0);
	const chunks: IChunk[] = [];
	tracks.forEach((track, trackIndex) => {
		let first = 0;
		while (first < track.samples.length) {
			const start = track.samples[first].decodeTime;
			let count = 0;
			let bytes = 0;
			while (first + count < track.samples.length
				&& (count === 0 || track.samples[first + count].decodeTime - start < CHUNK_SECONDS * track.timescale)) {
				bytes += track.samples[first + count].data.length;
				count++;
			}
			chunks.push({ track: trackIndex, first, count, bytes, seconds: start / track.timescale });
			first += count;
		}
	});
	chunks.sort((a, b) => a.seconds - b.seconds || a.track - b.track);
	const dataSize = chunks.reduce((total, chunk) => total + chunk.bytes, 0);
	const largeData = dataSize + 16 > 0xFFFF_FFFF;
	const mdatHeader = largeData ? 16 : 8;

	const ftyp = writeFtyp(input.format);
	// The index is written once to learn its size, then again with the chunks' places.
	const placeholder = chunks.map(() => 0);
	const sizeOfMoov = writeMoov(input, tracks, chunks, placeholder, largeData).length;
	let position = ftyp.length + sizeOfMoov + mdatHeader;
	const offsets = chunks.map(chunk => {
		const at = position;
		position += chunk.bytes;
		return at;
	});
	const moov = writeMoov(input, tracks, chunks, offsets, largeData);
	if (moov.length !== sizeOfMoov) {
		throw new Error('The size of the movie index changed while it was written.');
	}

	const file = new Uint8Array(ftyp.length + moov.length + mdatHeader + dataSize);
	file.set(ftyp, 0);
	file.set(moov, ftyp.length);
	const view = new DataView(file.buffer);
	let at = ftyp.length + moov.length;
	if (largeData) {
		view.setUint32(at, 1);
		file.set([0x6D, 0x64, 0x61, 0x74], at + 4);
		const size = mdatHeader + dataSize;
		view.setUint32(at + 8, Math.floor(size / 0x1_0000_0000));
		view.setUint32(at + 12, size >>> 0);
	} else {
		view.setUint32(at, mdatHeader + dataSize);
		file.set([0x6D, 0x64, 0x61, 0x74], at + 4);
	}
	at += mdatHeader;
	for (const chunk of chunks) {
		const track = tracks[chunk.track];
		for (let index = chunk.first; index < chunk.first + chunk.count; index++) {
			const data = track.samples[index].data;
			file.set(data, at);
			at += data.length;
		}
	}
	return file;
}

function writeFtyp(format: 'mp4' | 'mov'): Uint8Array {
	const writer = new BaseHalfByteWriter();
	writer.box('ftyp', box => {
		if (format === 'mov') {
			box.fourcc('qt  ').u32(0x200).fourcc('qt  ');
		} else {
			box.fourcc('isom').u32(0x200).fourcc('isom').fourcc('iso2').fourcc('avc1').fourcc('mp41');
		}
	});
	return writer.result();
}

/** A track's length in the movie's units, as its edit list shows it. */
function shownMovieDuration(track: BaseHalfMp4TrackInput): number {
	return Math.round(shownTrackDuration(track) * MOVIE_TIMESCALE / track.timescale);
}

function shownTrackDuration(track: BaseHalfMp4TrackInput): number {
	if (track.kind === 'audio') {
		return track.length;
	}
	let end = -Infinity;
	for (const sample of track.samples) {
		end = Math.max(end, sample.time + sample.duration);
	}
	return end - firstShownTime(track.samples);
}

/** The earliest time a sample of a picture is shown at: its frames may be decoded in another order. */
function firstShownTime(samples: readonly IBaseHalfMp4SampleInput[]): number {
	let first = Infinity;
	for (const sample of samples) {
		first = Math.min(first, sample.time);
	}
	return first;
}

function writeMoov(input: IBaseHalfMp4FileInput, tracks: readonly BaseHalfMp4TrackInput[], chunks: readonly IChunk[], offsets: readonly number[], large: boolean): Uint8Array {
	const writer = new BaseHalfByteWriter();
	let movieDuration = 0;
	for (const track of tracks) {
		movieDuration = Math.max(movieDuration, shownMovieDuration(track));
	}
	writer.box('moov', moov => {
		moov.fullBox('mvhd', 0, 0, mvhd => {
			mvhd.u32(0).u32(0).u32(MOVIE_TIMESCALE).u32(movieDuration);
			mvhd.u32(0x00010000).u16(0x0100).zeros(10);
			for (const value of IDENTITY) {
				mvhd.i32(value);
			}
			mvhd.zeros(24).u32(tracks.length + 1);
		});
		tracks.forEach((track, trackIndex) => {
			const trackChunks = chunks.map((chunk, index) => ({ chunk, offset: offsets[index] })).filter(entry => entry.chunk.track === trackIndex);
			writeTrak(moov, track, trackIndex + 1, trackChunks, large);
		});
		for (const box of input.metadata) {
			moov.bytes(box);
		}
	});
	return writer.result();
}

function writeTrak(writer: BaseHalfByteWriter, track: BaseHalfMp4TrackInput, id: number, chunks: readonly { readonly chunk: IChunk; readonly offset: number }[], large: boolean): void {
	const isVideo = track.kind === 'video';
	const samples = track.samples;
	const mediaDuration = samples.reduce((total, sample) => total + sample.duration, 0);
	const firstShown = isVideo ? firstShownTime(samples) : track.delay;
	writer.box('trak', trak => {
		trak.fullBox('tkhd', 0, 3, tkhd => {
			tkhd.u32(0).u32(0).u32(id).u32(0).u32(shownMovieDuration(track));
			tkhd.zeros(8).u16(0).u16(isVideo ? 0 : 1).u16(isVideo ? 0 : 0x0100).u16(0);
			for (const value of (isVideo ? track.matrix ?? IDENTITY : IDENTITY)) {
				tkhd.i32(value);
			}
			tkhd.u32(isVideo ? Math.round(track.displayWidth * 0x10000) : 0);
			tkhd.u32(isVideo ? Math.round(track.displayHeight * 0x10000) : 0);
		});
		trak.box('edts', edts => {
			edts.fullBox('elst', 0, 0, elst => {
				elst.u32(1).u32(shownMovieDuration(track)).i32(firstShown).i16(1).u16(0);
			});
		});
		trak.box('mdia', mdia => {
			mdia.fullBox('mdhd', 0, 0, mdhd => {
				// The language is `und`, packed in three letters of five bits.
				mdhd.u32(0).u32(0).u32(track.timescale).u32(mediaDuration).u16(0x55C4).u16(0);
			});
			mdia.fullBox('hdlr', 0, 0, hdlr => {
				const name = isVideo ? 'VideoHandler' : 'SoundHandler';
				hdlr.u32(0).fourcc(isVideo ? 'vide' : 'soun').zeros(12);
				for (let index = 0; index < name.length; index++) {
					hdlr.u8(name.charCodeAt(index));
				}
				hdlr.u8(0);
			});
			mdia.box('minf', minf => {
				if (isVideo) {
					minf.fullBox('vmhd', 0, 1, vmhd => vmhd.zeros(8));
				} else {
					minf.fullBox('smhd', 0, 0, smhd => smhd.zeros(4));
				}
				minf.box('dinf', dinf => {
					dinf.fullBox('dref', 0, 0, dref => {
						dref.u32(1);
						dref.fullBox('url ', 0, 1, () => { });
					});
				});
				minf.box('stbl', stbl => {
					stbl.fullBox('stsd', 0, 0, stsd => {
						stsd.u32(1);
						if (track.kind === 'video') {
							writeVisualSampleEntry(stsd, track);
						} else {
							writeAudioSampleEntry(stsd, track);
						}
					});
					writeTimeTables(stbl, samples);
					writeChunkTables(stbl, samples, chunks, large);
				});
			});
		});
	});
}

function writeVisualSampleEntry(writer: BaseHalfByteWriter, track: IBaseHalfMp4VideoTrackInput): void {
	writer.box(track.codec === 'avc' ? 'avc1' : 'hvc1', entry => {
		entry.zeros(6).u16(1).u16(0).u16(0).zeros(12);
		entry.u16(track.width).u16(track.height).u32(0x00480000).u32(0x00480000).u32(0).u16(1);
		entry.zeros(32).u16(0x0018).i16(-1);
		entry.box(track.codec === 'avc' ? 'avcC' : 'hvcC', config => config.bytes(track.description));
	});
}

function writeAudioSampleEntry(writer: BaseHalfByteWriter, track: IBaseHalfMp4AudioTrackInput): void {
	writer.box('mp4a', entry => {
		entry.zeros(6).u16(1).zeros(8).u16(track.channels).u16(16).u16(0).u16(0).u32(Math.min(track.timescale, 0xFFFF) * 0x10000);
		entry.fullBox('esds', 0, 0, esds => {
			const config = track.description;
			const decoderSpecific = descriptor(0x05, config);
			const decoderConfig = descriptor(0x04, concat(
				Uint8Array.of(0x40, 0x15, 0, 0, 0),
				u32(Math.round(track.bitrate)),
				u32(Math.round(track.bitrate)),
				decoderSpecific
			));
			const layer = descriptor(0x06, Uint8Array.of(0x02));
			esds.bytes(descriptor(0x03, concat(Uint8Array.of(0, 0, 0), decoderConfig, layer)));
		});
	});
}

/** An MPEG-4 descriptor: its tag, its length in the four-byte form, and its body. */
function descriptor(tag: number, body: Uint8Array): Uint8Array {
	const length = body.length;
	return concat(Uint8Array.of(tag, 0x80 | ((length >> 21) & 0x7F), 0x80 | ((length >> 14) & 0x7F), 0x80 | ((length >> 7) & 0x7F), length & 0x7F), body);
}

function u32(value: number): Uint8Array {
	const bytes = new Uint8Array(4);
	new DataView(bytes.buffer).setUint32(0, value >>> 0);
	return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array {
	const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
	let at = 0;
	for (const part of parts) {
		result.set(part, at);
		at += part.length;
	}
	return result;
}

function writeTimeTables(writer: BaseHalfByteWriter, samples: readonly IBaseHalfMp4SampleInput[]): void {
	const durations: [number, number][] = [];
	for (const sample of samples) {
		const last = durations[durations.length - 1];
		if (last && last[1] === sample.duration) {
			last[0]++;
		} else {
			durations.push([1, sample.duration]);
		}
	}
	writer.fullBox('stts', 0, 0, stts => {
		stts.u32(durations.length);
		for (const [count, duration] of durations) {
			stts.u32(count).u32(duration);
		}
	});
	const offsets = samples.map(sample => sample.time - sample.decodeTime);
	if (offsets.some(offset => offset !== 0)) {
		const negative = offsets.some(offset => offset < 0);
		const runs: [number, number][] = [];
		for (const offset of offsets) {
			const last = runs[runs.length - 1];
			if (last && last[1] === offset) {
				last[0]++;
			} else {
				runs.push([1, offset]);
			}
		}
		writer.fullBox('ctts', negative ? 1 : 0, 0, ctts => {
			ctts.u32(runs.length);
			for (const [count, offset] of runs) {
				ctts.u32(count).i32(offset);
			}
		});
	}
	if (samples.some(sample => !sample.key)) {
		const keys = samples.map((sample, index) => sample.key ? index + 1 : 0).filter(number => number > 0);
		writer.fullBox('stss', 0, 0, stss => {
			stss.u32(keys.length);
			for (const number of keys) {
				stss.u32(number);
			}
		});
	}
}

function writeChunkTables(writer: BaseHalfByteWriter, samples: readonly IBaseHalfMp4SampleInput[], chunks: readonly { readonly chunk: IChunk; readonly offset: number }[], large: boolean): void {
	const runs: [number, number][] = [];
	chunks.forEach(({ chunk }, index) => {
		const last = runs[runs.length - 1];
		if (!last || last[1] !== chunk.count) {
			runs.push([index + 1, chunk.count]);
		}
	});
	writer.fullBox('stsc', 0, 0, stsc => {
		stsc.u32(runs.length);
		for (const [first, count] of runs) {
			stsc.u32(first).u32(count).u32(1);
		}
	});
	writer.fullBox('stsz', 0, 0, stsz => {
		stsz.u32(0).u32(samples.length);
		for (const sample of samples) {
			stsz.u32(sample.data.length);
		}
	});
	if (large) {
		writer.fullBox('co64', 0, 0, co64 => {
			co64.u32(chunks.length);
			for (const { offset } of chunks) {
				co64.u64(offset);
			}
		});
	} else {
		writer.fullBox('stco', 0, 0, stco => {
			stco.u32(chunks.length);
			for (const { offset } of chunks) {
				stco.u32(offset);
			}
		});
	}
}
