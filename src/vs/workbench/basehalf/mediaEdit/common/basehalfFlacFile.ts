/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * A FLAC file as a sound edit reads and writes it (editing media, "A
 * sound"): what its stream information says, and its comments, pictures,
 * and application blocks, which an edited FLAC keeps; and BaseHalf's own
 * encoder of FLAC without loss: frames of 4096 samples, each channel predicted
 * by the best of the fixed predictors and coded with Rice codes, stereo as
 * left and right, left and side, right and side, or mid and side, whichever
 * is smallest. A seek table and a cue sheet name places in the samples, and
 * are left out; the checksum of the samples is left at zero, which a decoder
 * reads as not given.
 */

export interface IBaseHalfFlacInfo {
	readonly sampleRate: number;
	readonly channels: number;
	readonly bitsPerSample: number;
	readonly totalSamples: number;
	/** The metadata blocks an edited FLAC keeps, each with its type and its body. */
	readonly blocks: readonly { readonly type: number; readonly body: Uint8Array }[];
}

/** Vorbis comments, pictures, and application blocks. */
const KEPT_BLOCKS = new Set([2, 4, 6]);
const BLOCK_SIZE = 4096;

/** Reads the stream information and the blocks of a FLAC; nothing for any other file. */
export function readBaseHalfFlacInfo(bytes: Uint8Array): IBaseHalfFlacInfo | undefined {
	if (bytes.length < 42 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'fLaC') {
		return undefined;
	}
	let info: Omit<IBaseHalfFlacInfo, 'blocks'> | undefined;
	const blocks: { type: number; body: Uint8Array }[] = [];
	for (let offset = 4; offset + 4 <= bytes.length;) {
		const last = (bytes[offset] & 0x80) !== 0;
		const type = bytes[offset] & 0x7f;
		const length = (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
		const body = bytes.subarray(offset + 4, offset + 4 + length);
		if (body.length < length) {
			return undefined;
		}
		if (type === 0 && length >= 34) {
			const sampleRate = (body[10] << 12) | (body[11] << 4) | (body[12] >> 4);
			const channels = ((body[12] >> 1) & 7) + 1;
			const bitsPerSample = (((body[12] & 1) << 4) | (body[13] >> 4)) + 1;
			const totalSamples = (body[13] & 0x0f) * 2 ** 32 + ((body[14] << 24) >>> 0) + (body[15] << 16) + (body[16] << 8) + body[17];
			info = { sampleRate, channels, bitsPerSample, totalSamples };
		} else if (KEPT_BLOCKS.has(type)) {
			blocks.push({ type, body });
		}
		offset += 4 + length;
		if (last) {
			break;
		}
	}
	return info ? { ...info, blocks } : undefined;
}

// #region Bits

class BitWriter {
	private buffer = new Uint8Array(1 << 16);
	private length = 0;
	private bits = 0;
	private count = 0;

	get byteLength(): number {
		return this.length;
	}

	private ensure(extra: number): void {
		if (this.length + extra > this.buffer.length) {
			const larger = new Uint8Array(Math.max(this.buffer.length * 2, this.length + extra));
			larger.set(this.buffer.subarray(0, this.length));
			this.buffer = larger;
		}
	}

	/** Writes the low `count` bits of a value, the highest first; up to 32 bits. */
	write(value: number, count: number): void {
		if (count > 24) {
			this.write(Math.floor(value / 2 ** 16) & ((1 << (count - 16)) - 1), count - 16);
			this.write(value & 0xffff, 16);
			return;
		}
		this.bits = (this.bits * (1 << count)) + (value & ((1 << count) - 1));
		this.count += count;
		while (this.count >= 8) {
			this.ensure(1);
			this.count -= 8;
			this.buffer[this.length++] = Math.floor(this.bits / 2 ** this.count) & 0xff;
		}
		this.bits &= (1 << this.count) - 1;
	}

	/** `count` zero bits and a one. */
	unary(count: number): void {
		while (count >= 24) {
			this.write(0, 24);
			count -= 24;
		}
		this.write(1, count + 1);
	}

	/** Zero bits up to the next whole byte. */
	align(): void {
		if (this.count) {
			this.write(0, 8 - this.count);
		}
	}

	bytes(from = 0): Uint8Array {
		return this.buffer.slice(from, this.length);
	}
}

const CRC8 = (() => {
	const table = new Uint8Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
		}
		table[n] = c;
	}
	return table;
})();

const CRC16 = (() => {
	const table = new Uint16Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n << 8;
		for (let k = 0; k < 8; k++) {
			c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff;
		}
		table[n] = c;
	}
	return table;
})();

function crc8(bytes: Uint8Array): number {
	let crc = 0;
	for (const byte of bytes) {
		crc = CRC8[crc ^ byte];
	}
	return crc;
}

function crc16(bytes: Uint8Array): number {
	let crc = 0;
	for (const byte of bytes) {
		crc = ((crc << 8) & 0xffff) ^ CRC16[(crc >> 8) ^ byte];
	}
	return crc;
}

// #endregion

// #region Prediction and Rice codes

/** The residual of a fixed predictor of an order. */
function fixedResidual(samples: Int32Array, order: number): Int32Array {
	const residual = new Int32Array(samples.length - order);
	for (let n = order; n < samples.length; n++) {
		const x = samples;
		let e: number;
		switch (order) {
			case 0: e = x[n]; break;
			case 1: e = x[n] - x[n - 1]; break;
			case 2: e = x[n] - 2 * x[n - 1] + x[n - 2]; break;
			case 3: e = x[n] - 3 * x[n - 1] + 3 * x[n - 2] - x[n - 3]; break;
			default: e = x[n] - 4 * x[n - 1] + 6 * x[n - 2] - 4 * x[n - 3] + x[n - 4];
		}
		residual[n - order] = e;
	}
	return residual;
}

const zigzag = (value: number) => value >= 0 ? value * 2 : -value * 2 - 1;

/** The Rice parameter of a run of residuals, and the bits they take with it. */
function riceParameter(residual: Int32Array, from: number, to: number, limit: number): { readonly parameter: number; readonly bits: number } {
	let sum = 0;
	for (let index = from; index < to; index++) {
		sum += zigzag(residual[index]);
	}
	const count = Math.max(1, to - from);
	let best = { parameter: 0, bits: Infinity };
	const guess = Math.max(0, Math.floor(Math.log2(Math.max(1, sum / count))));
	for (let parameter = Math.max(0, guess - 1); parameter <= Math.min(limit, guess + 1); parameter++) {
		// Each residual takes its quotient in ones, a stop bit, and the parameter's low bits.
		let bits = 0;
		for (let index = from; index < to; index++) {
			bits += Math.floor(zigzag(residual[index]) / 2 ** parameter) + 1 + parameter;
		}
		if (bits < best.bits) {
			best = { parameter, bits };
		}
	}
	return best;
}

interface IResidualPlan {
	readonly order: number;
	readonly partitionOrder: number;
	readonly parameters: readonly number[];
	readonly bits: number;
}

/** The best partitioning of a residual into runs of one Rice parameter each. */
function planResidual(residual: Int32Array, blockSize: number, order: number, limit: number): IResidualPlan {
	let best: IResidualPlan = { order, partitionOrder: 0, parameters: [], bits: Infinity };
	for (let partitionOrder = 0; partitionOrder <= 6; partitionOrder++) {
		const partitions = 1 << partitionOrder;
		if (blockSize % partitions || (blockSize >> partitionOrder) <= order) {
			break;
		}
		const parameters: number[] = [];
		let bits = 0;
		let at = 0;
		for (let partition = 0; partition < partitions; partition++) {
			const length = (blockSize >> partitionOrder) - (partition === 0 ? order : 0);
			const rice = riceParameter(residual, at, at + length, limit);
			parameters.push(rice.parameter);
			bits += rice.bits + (limit > 14 ? 5 : 4);
			at += length;
		}
		if (bits < best.bits) {
			best = { order, partitionOrder, parameters, bits };
		}
	}
	return best;
}

/** Writes the subframe of a channel: constant, the best fixed prediction, or the samples as they are, whichever is smallest. */
function writeSubframe(writer: BitWriter, samples: Int32Array, bits: number): void {
	if (samples.every(sample => sample === samples[0])) {
		writer.write(0, 8);
		writer.write(samples[0], bits);
		return;
	}
	// Rice parameters up to 14 in four bits, or up to 30 in five for wide samples.
	const limit = bits > 16 ? 30 : 14;
	let best: IResidualPlan | undefined;
	let bestResidual: Int32Array | undefined;
	for (let order = 0; order <= Math.min(4, samples.length - 1); order++) {
		const residual = fixedResidual(samples, order);
		const plan = planResidual(residual, samples.length, order, limit);
		const total = plan.bits + order * bits;
		if (!best || total < best.bits + best.order * bits) {
			best = plan;
			bestResidual = residual;
		}
	}
	if (!best || !bestResidual || best.bits + best.order * bits >= samples.length * bits) {
		writer.write(0x02, 8);
		for (const sample of samples) {
			writer.write(sample, bits);
		}
		return;
	}
	writer.write(0x10 | (best.order << 1), 8);
	for (let index = 0; index < best.order; index++) {
		writer.write(samples[index], bits);
	}
	const wide = limit > 14;
	writer.write(wide ? 1 : 0, 2);
	writer.write(best.partitionOrder, 4);
	let at = 0;
	for (const [partition, parameter] of best.parameters.entries()) {
		writer.write(parameter, wide ? 5 : 4);
		const length = (samples.length >> best.partitionOrder) - (partition === 0 ? best.order : 0);
		for (let index = at; index < at + length; index++) {
			const value = zigzag(bestResidual[index]);
			writer.unary(Math.floor(value / 2 ** parameter));
			if (parameter) {
				writer.write(value % 2 ** parameter, parameter);
			}
		}
		at += length;
	}
}

// #endregion

const SAMPLE_RATE_CODES = new Map([[88200, 1], [176400, 2], [192000, 3], [8000, 4], [16000, 5], [22050, 6], [24000, 7], [32000, 8], [44100, 9], [48000, 10], [96000, 11]]);
const SAMPLE_SIZE_CODES = new Map([[8, 1], [12, 2], [16, 4], [20, 5], [24, 6]]);

/** The code of a sample rate in a frame header, with the rate after the header when no code names it. */
function sampleRateCode(rate: number): { readonly code: number; readonly extra?: { readonly value: number; readonly bits: number } } {
	const code = SAMPLE_RATE_CODES.get(rate);
	if (code !== undefined) {
		return { code };
	}
	if (rate % 1000 === 0 && rate / 1000 < 256) {
		return { code: 0b1100, extra: { value: rate / 1000, bits: 8 } };
	}
	if (rate < 65536) {
		return { code: 0b1101, extra: { value: rate, bits: 16 } };
	}
	return rate % 10 === 0 && rate / 10 < 65536 ? { code: 0b1110, extra: { value: rate / 10, bits: 16 } } : { code: 0 };
}

/** The frame number as FLAC codes it, in the manner of UTF-8. */
function codedNumber(value: number): number[] {
	if (value < 0x80) {
		return [value];
	}
	const bytes: number[] = [];
	let remaining = value;
	let room = 0x3f;
	while (remaining > room) {
		bytes.unshift(0x80 | (remaining & 0x3f));
		remaining = Math.floor(remaining / 64);
		room >>= 1;
	}
	const lead = (0xff << (7 - bytes.length)) & 0xff;
	return [lead | remaining, ...bytes];
}

function sumAbs(values: Int32Array): number {
	let sum = 0;
	for (const value of values) {
		sum += Math.abs(value);
	}
	return sum;
}

/** Encodes channels of samples as whole numbers into a FLAC with the blocks given. */
export function encodeBaseHalfFlac(channels: readonly Int32Array[], sampleRate: number, bitsPerSample: number, blocks: IBaseHalfFlacInfo['blocks']): Uint8Array {
	const total = channels[0]?.length ?? 0;
	const rateCode = sampleRateCode(sampleRate);
	const writer = new BitWriter();
	let minFrame = Infinity;
	let maxFrame = 0;
	for (let start = 0, frame = 0; start < total; start += BLOCK_SIZE, frame++) {
		const size = Math.min(BLOCK_SIZE, total - start);
		const block = channels.map(channel => channel.subarray(start, start + size));
		// Stereo is coded as the pair whose second order residuals are smallest.
		let assignment = channels.length - 1;
		let coded: { samples: Int32Array; bits: number }[] = block.map(samples => ({ samples, bits: bitsPerSample }));
		if (channels.length === 2) {
			const [left, right] = block;
			const side = new Int32Array(size);
			const mid = new Int32Array(size);
			for (let index = 0; index < size; index++) {
				side[index] = left[index] - right[index];
				mid[index] = (left[index] + right[index]) >> 1;
			}
			const cost = (samples: Int32Array) => size > 2 ? sumAbs(fixedResidual(samples, 2)) : 0;
			const [l, r, s, m] = [cost(left), cost(right), cost(side), cost(mid)];
			const options = [
				{ assignment: 1, cost: l + r, coded: [{ samples: left, bits: bitsPerSample }, { samples: right, bits: bitsPerSample }] },
				{ assignment: 8, cost: l + s, coded: [{ samples: left, bits: bitsPerSample }, { samples: side, bits: bitsPerSample + 1 }] },
				{ assignment: 9, cost: s + r, coded: [{ samples: side, bits: bitsPerSample + 1 }, { samples: right, bits: bitsPerSample }] },
				{ assignment: 10, cost: m + s, coded: [{ samples: mid, bits: bitsPerSample }, { samples: side, bits: bitsPerSample + 1 }] }
			];
			const chosen = options.reduce((a, b) => b.cost < a.cost ? b : a);
			assignment = chosen.assignment;
			coded = chosen.coded;
		}
		const frameStart = writer.byteLength;
		// The frame header: fixed block size, the size coded or given at the end, and the rate and the sample size
		// in every frame, as decoders that read frame by frame need them.
		const sizeCode = size === BLOCK_SIZE ? 0b1100 : size <= 256 ? 0b0110 : 0b0111;
		writer.write(0xfff8, 16);
		writer.write(sizeCode, 4);
		writer.write(rateCode.code, 4);
		writer.write(assignment, 4);
		writer.write(SAMPLE_SIZE_CODES.get(bitsPerSample) ?? 0, 3);
		writer.write(0, 1);
		for (const byte of codedNumber(frame)) {
			writer.write(byte, 8);
		}
		if (sizeCode === 0b0110) {
			writer.write(size - 1, 8);
		} else if (sizeCode === 0b0111) {
			writer.write(size - 1, 16);
		}
		if (rateCode.extra) {
			writer.write(rateCode.extra.value, rateCode.extra.bits);
		}
		writer.write(crc8(writer.bytes(frameStart)), 8);
		for (const channel of coded) {
			writeSubframe(writer, channel.samples, channel.bits);
		}
		writer.align();
		writer.write(crc16(writer.bytes(frameStart)), 16);
		const length = writer.byteLength - frameStart;
		minFrame = Math.min(minFrame, length);
		maxFrame = Math.max(maxFrame, length);
	}
	const audio = writer.bytes();
	// The stream information, then the blocks kept, the last one marked.
	const info = new Uint8Array(34);
	const view = new DataView(info.buffer);
	view.setUint16(0, BLOCK_SIZE);
	view.setUint16(2, BLOCK_SIZE);
	const frames = Number.isFinite(minFrame) ? minFrame : 0;
	info.set([(frames >> 16) & 0xff, (frames >> 8) & 0xff, frames & 0xff, (maxFrame >> 16) & 0xff, (maxFrame >> 8) & 0xff, maxFrame & 0xff], 4);
	info[10] = (sampleRate >> 12) & 0xff;
	info[11] = (sampleRate >> 4) & 0xff;
	info[12] = ((sampleRate & 0x0f) << 4) | ((channels.length - 1) << 1) | (((bitsPerSample - 1) >> 4) & 1);
	info[13] = (((bitsPerSample - 1) & 0x0f) << 4) | (Math.floor(total / 2 ** 32) & 0x0f);
	view.setUint32(14, total >>> 0);
	const metadata = [{ type: 0, body: info }, ...blocks];
	const parts: Uint8Array[] = [Uint8Array.from([0x66, 0x4c, 0x61, 0x43])];
	metadata.forEach((block, index) => {
		const header = new Uint8Array(4);
		header[0] = (index === metadata.length - 1 ? 0x80 : 0) | block.type;
		header.set([(block.body.length >> 16) & 0xff, (block.body.length >> 8) & 0xff, block.body.length & 0xff], 1);
		parts.push(header, block.body);
	});
	parts.push(audio);
	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

// #region Decoding

class BitReader {
	private position: number;

	constructor(private readonly bytes: Uint8Array, offset: number) {
		this.position = offset * 8;
	}

	get byteOffset(): number {
		return this.position >> 3;
	}

	get done(): boolean {
		return this.position >= this.bytes.length * 8;
	}

	read(count: number): number {
		let value = 0;
		for (let index = 0; index < count; index++) {
			const byte = this.bytes[this.position >> 3];
			if (byte === undefined) {
				throw new RangeError('The stream ends inside a frame.');
			}
			value = value * 2 + ((byte >> (7 - (this.position & 7))) & 1);
			this.position++;
		}
		return value;
	}

	signed(count: number): number {
		const value = this.read(count);
		return count && value >= 2 ** (count - 1) ? value - 2 ** count : value;
	}

	unary(): number {
		let count = 0;
		while (this.read(1) === 0) {
			count++;
		}
		return count;
	}

	align(): void {
		this.position = Math.ceil(this.position / 8) * 8;
	}
}

/** The samples of a FLAC, as the whole numbers it holds, channel by channel. */
export interface IBaseHalfFlacSamples {
	readonly sampleRate: number;
	readonly bitsPerSample: number;
	readonly channels: Int32Array[];
}

/**
 * Decodes a FLAC exactly, with BaseHalf's own decoder: every subframe type,
 * every channel assignment, wasted bits, and frames of any size. The window's
 * decoder gives samples as fractions scaled differently above and below zero,
 * from which the file's whole numbers cannot always be read back.
 */
export function decodeBaseHalfFlac(bytes: Uint8Array): IBaseHalfFlacSamples | undefined {
	const info = readBaseHalfFlacInfo(bytes);
	if (!info) {
		return undefined;
	}
	let offset = 4;
	for (; ;) {
		const last = (bytes[offset] & 0x80) !== 0;
		offset += 4 + ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]);
		if (last) {
			break;
		}
	}
	const output = Array.from({ length: info.channels }, () => [] as Int32Array[]);
	const reader = new BitReader(bytes, offset);
	try {
		while (reader.byteOffset + 2 < bytes.length) {
			if (reader.read(14) !== 0x3ffe) {
				break;
			}
			reader.read(2);
			const sizeCode = reader.read(4);
			const rateCode = reader.read(4);
			const assignment = reader.read(4);
			const sizeOfSample = reader.read(3);
			reader.read(1);
			// The frame or sample number, coded as UTF-8 codes characters.
			const lead = reader.read(8);
			let extra = 0;
			while (extra < 7 && lead & (0x80 >> extra)) {
				extra++;
			}
			for (let index = 1; index < extra; index++) {
				reader.read(8);
			}
			const blockSize = sizeCode === 1 ? 192
				: sizeCode >= 2 && sizeCode <= 5 ? 576 << (sizeCode - 2)
					: sizeCode === 6 ? reader.read(8) + 1
						: sizeCode === 7 ? reader.read(16) + 1
							: sizeCode >= 8 ? 256 << (sizeCode - 8) : 0;
			if (rateCode === 12) {
				reader.read(8);
			} else if (rateCode === 13 || rateCode === 14) {
				reader.read(16);
			}
			reader.read(8);
			const bits = [0, 8, 12, 0, 16, 20, 24, 32][sizeOfSample] || info.bitsPerSample;
			const count = assignment < 8 ? assignment + 1 : 2;
			const decoded: Int32Array[] = [];
			for (let channel = 0; channel < count; channel++) {
				// A side channel takes a bit more.
				const side = (assignment === 8 && channel === 1) || (assignment === 9 && channel === 0) || (assignment === 10 && channel === 1);
				decoded.push(readSubframe(reader, blockSize, bits + (side ? 1 : 0)));
			}
			reader.align();
			reader.read(16);
			if (assignment >= 8) {
				const [a, b] = decoded;
				for (let index = 0; index < blockSize; index++) {
					if (assignment === 8) {
						b[index] = a[index] - b[index];
					} else if (assignment === 9) {
						a[index] = a[index] + b[index];
					} else {
						const mid = a[index] * 2 + (b[index] & 1);
						a[index] = (mid + b[index]) >> 1;
						b[index] = (mid - b[index]) >> 1;
					}
				}
			}
			decoded.forEach((channel, index) => output[index]?.push(channel));
		}
	} catch {
		// A stream cut short keeps the frames before the cut.
	}
	return {
		sampleRate: info.sampleRate,
		bitsPerSample: info.bitsPerSample,
		channels: output.map(blocks => {
			const all = new Int32Array(blocks.reduce((sum, block) => sum + block.length, 0));
			let at = 0;
			for (const block of blocks) {
				all.set(block, at);
				at += block.length;
			}
			return all;
		})
	};
}

function readSubframe(reader: BitReader, size: number, bits: number): Int32Array {
	reader.read(1);
	const type = reader.read(6);
	let wasted = 0;
	if (reader.read(1)) {
		wasted = reader.unary() + 1;
	}
	const width = bits - wasted;
	const samples = new Int32Array(size);
	if (type === 0) {
		samples.fill(reader.signed(width));
	} else if (type === 1) {
		for (let index = 0; index < size; index++) {
			samples[index] = reader.signed(width);
		}
	} else if (type >= 8 && type <= 12) {
		const order = type - 8;
		for (let index = 0; index < order; index++) {
			samples[index] = reader.signed(width);
		}
		readResidual(reader, samples, order);
		for (let index = order; index < size; index++) {
			const x = samples;
			switch (order) {
				case 1: x[index] += x[index - 1]; break;
				case 2: x[index] += 2 * x[index - 1] - x[index - 2]; break;
				case 3: x[index] += 3 * x[index - 1] - 3 * x[index - 2] + x[index - 3]; break;
				case 4: x[index] += 4 * x[index - 1] - 6 * x[index - 2] + 4 * x[index - 3] - x[index - 4]; break;
			}
		}
	} else if (type >= 32) {
		const order = type - 31;
		for (let index = 0; index < order; index++) {
			samples[index] = reader.signed(width);
		}
		const precision = reader.read(4) + 1;
		const shift = reader.signed(5);
		const coefficients: number[] = [];
		for (let index = 0; index < order; index++) {
			coefficients.push(reader.signed(precision));
		}
		readResidual(reader, samples, order);
		for (let index = order; index < size; index++) {
			let sum = 0;
			for (let k = 0; k < order; k++) {
				sum += coefficients[k] * samples[index - 1 - k];
			}
			// The sum can pass 2^53 only for samples and coefficients no encoder writes.
			samples[index] += Math.floor(sum / 2 ** shift);
		}
	} else {
		throw new RangeError(`A reserved subframe type: ${type}.`);
	}
	if (wasted) {
		for (let index = 0; index < size; index++) {
			samples[index] *= 2 ** wasted;
		}
	}
	return samples;
}

/** Reads the residual of a predicted subframe into `samples` after its warm-up. */
function readResidual(reader: BitReader, samples: Int32Array, order: number): void {
	const method = reader.read(2);
	const parameterBits = method === 1 ? 5 : 4;
	const escape = method === 1 ? 31 : 15;
	const partitionOrder = reader.read(4);
	const partitions = 1 << partitionOrder;
	let at = order;
	for (let partition = 0; partition < partitions; partition++) {
		const count = (samples.length >> partitionOrder) - (partition === 0 ? order : 0);
		const parameter = reader.read(parameterBits);
		if (parameter === escape) {
			const raw = reader.read(5);
			for (let index = 0; index < count; index++) {
				samples[at++] = reader.signed(raw);
			}
			continue;
		}
		for (let index = 0; index < count; index++) {
			const quotient = reader.unary();
			const value = quotient * 2 ** parameter + (parameter ? reader.read(parameter) : 0);
			samples[at++] = value % 2 ? -(value + 1) / 2 : value / 2;
		}
	}
}

// #endregion
