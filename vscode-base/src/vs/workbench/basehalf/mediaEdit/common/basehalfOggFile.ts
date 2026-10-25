/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * An Ogg file as a sound edit reads and writes it (editing media, "A
 * sound"): the codec of its first stream, Opus or Vorbis, its sample rate and
 * channels, and its comments, which an edited Ogg keeps; and the Ogg Opus
 * file of the packets the window's encoder gives, with the encoder's delay
 * as its pre-skip and the sound's length as its last granule position.
 */

export interface IBaseHalfOggInfo {
	readonly codec: 'opus' | 'vorbis';
	readonly channels: number;
	/** The rate the sound was made at: 48 kHz for Opus as it is decoded. */
	readonly sampleRate: number;
	/** The output gain of an Opus stream, in its own units. */
	readonly outputGain: number;
	readonly comments: readonly string[];
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** The packets of the first stream of an Ogg, as far as `count`. */
function oggPackets(bytes: Uint8Array, count: number): Uint8Array[] {
	const packets: Uint8Array[] = [];
	let pending: Uint8Array[] = [];
	let serial: number | undefined;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let offset = 0; offset + 27 <= bytes.length && packets.length < count;) {
		if (String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]) !== 'OggS') {
			break;
		}
		const pageSerial = view.getUint32(offset + 14, true);
		const segments = bytes[offset + 26];
		const table = bytes.subarray(offset + 27, offset + 27 + segments);
		let at = offset + 27 + segments;
		serial ??= pageSerial;
		for (const lacing of table) {
			if (pageSerial === serial) {
				pending.push(bytes.subarray(at, at + lacing));
				if (lacing < 255) {
					const length = pending.reduce((sum, part) => sum + part.length, 0);
					const packet = new Uint8Array(length);
					let position = 0;
					for (const part of pending) {
						packet.set(part, position);
						position += part.length;
					}
					packets.push(packet);
					pending = [];
				}
			}
			at += lacing;
		}
		offset = at;
	}
	return packets;
}

/** Comments as Vorbis comments hold them: a vendor, then each comment with its length. */
function readComments(bytes: Uint8Array, offset: number): string[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let at = offset;
	const vendor = view.getUint32(at, true);
	at += 4 + vendor;
	const count = view.getUint32(at, true);
	at += 4;
	const comments: string[] = [];
	for (let index = 0; index < count && at + 4 <= bytes.length; index++) {
		const length = view.getUint32(at, true);
		at += 4;
		comments.push(decoder.decode(bytes.subarray(at, at + length)));
		at += length;
	}
	return comments;
}

/** Reads the first stream of an Ogg of Opus or Vorbis; nothing for any other file. */
export function readBaseHalfOggInfo(bytes: Uint8Array): IBaseHalfOggInfo | undefined {
	try {
		const [head, tags] = oggPackets(bytes, 2);
		if (!head) {
			return undefined;
		}
		const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
		if (head.length >= 19 && String.fromCharCode(...head.subarray(0, 8)) === 'OpusHead') {
			const comments = tags && String.fromCharCode(...tags.subarray(0, 8)) === 'OpusTags' ? readComments(tags, 8) : [];
			return { codec: 'opus', channels: head[9], sampleRate: 48_000, outputGain: view.getInt16(16, true), comments };
		}
		if (head.length >= 30 && head[0] === 1 && String.fromCharCode(...head.subarray(1, 7)) === 'vorbis') {
			const comments = tags && tags[0] === 3 && String.fromCharCode(...tags.subarray(1, 7)) === 'vorbis' ? readComments(tags, 7) : [];
			return { codec: 'vorbis', channels: head[11], sampleRate: view.getUint32(12, true), outputGain: 0, comments };
		}
	} catch {
		// A header that runs past its end is not one that can be read.
	}
	return undefined;
}

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n << 24;
		for (let k = 0; k < 8; k++) {
			c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
		}
		table[n] = c >>> 0;
	}
	return table;
})();

function crc(bytes: Uint8Array): number {
	let value = 0;
	for (const byte of bytes) {
		value = ((value << 8) ^ CRC_TABLE[((value >>> 24) ^ byte) & 0xff]) >>> 0;
	}
	return value;
}

export interface IBaseHalfOggOpusInput {
	readonly packets: readonly Uint8Array[];
	/** The samples at 48 kHz of each packet. */
	readonly durations: readonly number[];
	readonly channels: number;
	/** The encoder's delay, in samples at 48 kHz. */
	readonly preSkip: number;
	/** The sound's length, in samples at 48 kHz. */
	readonly length: number;
	readonly inputSampleRate: number;
	readonly outputGain: number;
	readonly comments: readonly string[];
}

/** Writes an Ogg Opus file: its header, its comments, and its packets in pages of about a second. */
export function writeBaseHalfOggOpus(input: IBaseHalfOggOpusInput): Uint8Array {
	const serial = 0x42484f4f;
	const pages: Uint8Array[] = [];
	let sequence = 0;
	const page = (packets: readonly Uint8Array[], granule: number, flags: number): void => {
		const table: number[] = [];
		for (const packet of packets) {
			let length = packet.length;
			while (length >= 255) {
				table.push(255);
				length -= 255;
			}
			table.push(length);
		}
		const body = packets.reduce((sum, packet) => sum + packet.length, 0);
		const bytes = new Uint8Array(27 + table.length + body);
		const view = new DataView(bytes.buffer);
		bytes.set([0x4f, 0x67, 0x67, 0x53, 0, flags]);
		view.setUint32(6, granule >>> 0, true);
		view.setUint32(10, Math.floor(granule / 2 ** 32), true);
		view.setUint32(14, serial, true);
		view.setUint32(18, sequence++, true);
		bytes[26] = table.length;
		bytes.set(table, 27);
		let at = 27 + table.length;
		for (const packet of packets) {
			bytes.set(packet, at);
			at += packet.length;
		}
		view.setUint32(22, crc(bytes), true);
		pages.push(bytes);
	};
	const head = new Uint8Array(19);
	const headView = new DataView(head.buffer);
	head.set(encoder.encode('OpusHead'));
	head[8] = 1;
	head[9] = input.channels;
	headView.setUint16(10, input.preSkip, true);
	headView.setUint32(12, input.inputSampleRate, true);
	headView.setInt16(16, input.outputGain, true);
	head[18] = 0;
	page([head], 0, 0x02);
	const vendor = encoder.encode('BaseHalf');
	const comments = input.comments.map(comment => encoder.encode(comment));
	const tags = new Uint8Array(8 + 4 + vendor.length + 4 + comments.reduce((sum, comment) => sum + 4 + comment.length, 0));
	const tagsView = new DataView(tags.buffer);
	tags.set(encoder.encode('OpusTags'));
	tagsView.setUint32(8, vendor.length, true);
	tags.set(vendor, 12);
	let at = 12 + vendor.length;
	tagsView.setUint32(at, comments.length, true);
	at += 4;
	for (const comment of comments) {
		tagsView.setUint32(at, comment.length, true);
		tags.set(comment, at + 4);
		at += 4 + comment.length;
	}
	page([tags], 0, 0);
	// Pages of about a second; the last one ends the stream at the sound's length.
	let granule = 0;
	let pending: Uint8Array[] = [];
	let segments = 0;
	const end = input.preSkip + input.length;
	input.packets.forEach((packet, index) => {
		const lacing = Math.floor(packet.length / 255) + 1;
		if (pending.length && (segments + lacing > 255 || pending.length >= 50)) {
			page(pending, Math.min(granule, end), 0);
			pending = [];
			segments = 0;
		}
		pending.push(packet);
		segments += lacing;
		granule += input.durations[index];
	});
	page(pending, end, 0x04);
	const out = new Uint8Array(pages.reduce((sum, bytes) => sum + bytes.length, 0));
	let offset = 0;
	for (const bytes of pages) {
		out.set(bytes, offset);
		offset += bytes.length;
	}
	return out;
}
