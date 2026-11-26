/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/** Reads big-endian numbers and bytes from a buffer, from a position that moves on. */
export class BaseHalfByteReader {
	private readonly view: DataView;
	position: number;

	constructor(readonly bytes: Uint8Array, start = 0, readonly end = bytes.length) {
		this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		this.position = start;
	}

	get remaining(): number {
		return this.end - this.position;
	}

	private take(length: number): number {
		const at = this.position;
		if (at + length > this.end) {
			throw new RangeError(`read of ${length} bytes at ${at} passes ${this.end}`);
		}
		this.position += length;
		return at;
	}

	u8(): number {
		return this.view.getUint8(this.take(1));
	}

	u16(): number {
		return this.view.getUint16(this.take(2));
	}

	i16(): number {
		return this.view.getInt16(this.take(2));
	}

	u24(): number {
		const at = this.take(3);
		return (this.view.getUint8(at) << 16) | this.view.getUint16(at + 1);
	}

	u32(): number {
		return this.view.getUint32(this.take(4));
	}

	i32(): number {
		return this.view.getInt32(this.take(4));
	}

	u64(): number {
		const at = this.take(8);
		return this.view.getUint32(at) * 0x1_0000_0000 + this.view.getUint32(at + 4);
	}

	i64(): number {
		const at = this.take(8);
		return this.view.getInt32(at) * 0x1_0000_0000 + this.view.getUint32(at + 4);
	}

	f64(): number {
		return this.view.getFloat64(this.take(8));
	}

	fourcc(): string {
		const at = this.take(4);
		return String.fromCharCode(this.bytes[at], this.bytes[at + 1], this.bytes[at + 2], this.bytes[at + 3]);
	}

	slice(length: number): Uint8Array {
		const at = this.take(length);
		return this.bytes.subarray(at, at + length);
	}

	skip(length: number): void {
		this.take(length);
	}
}

/** Writes big-endian numbers and bytes into a buffer that grows as it is written. */
export class BaseHalfByteWriter {
	private buffer = new Uint8Array(1024);
	private view = new DataView(this.buffer.buffer);
	private length = 0;

	get size(): number {
		return this.length;
	}

	private reserve(count: number): number {
		const at = this.length;
		if (at + count > this.buffer.length) {
			let capacity = this.buffer.length * 2;
			while (capacity < at + count) {
				capacity *= 2;
			}
			const next = new Uint8Array(capacity);
			next.set(this.buffer.subarray(0, this.length));
			this.buffer = next;
			this.view = new DataView(next.buffer);
		}
		this.length += count;
		return at;
	}

	// Each write reserves its bytes before it reads `view`: reserving can replace the buffer.

	u8(value: number): this {
		const at = this.reserve(1);
		this.view.setUint8(at, value);
		return this;
	}

	u16(value: number): this {
		const at = this.reserve(2);
		this.view.setUint16(at, value);
		return this;
	}

	i16(value: number): this {
		const at = this.reserve(2);
		this.view.setInt16(at, value);
		return this;
	}

	u24(value: number): this {
		const at = this.reserve(3);
		this.view.setUint8(at, (value >>> 16) & 0xFF);
		this.view.setUint16(at + 1, value & 0xFFFF);
		return this;
	}

	u32(value: number): this {
		const at = this.reserve(4);
		this.view.setUint32(at, value >>> 0);
		return this;
	}

	i32(value: number): this {
		const at = this.reserve(4);
		this.view.setInt32(at, value | 0);
		return this;
	}

	u64(value: number): this {
		const at = this.reserve(8);
		this.view.setUint32(at, Math.floor(value / 0x1_0000_0000));
		this.view.setUint32(at + 4, value >>> 0);
		return this;
	}

	i64(value: number): this {
		const at = this.reserve(8);
		const high = Math.floor(value / 0x1_0000_0000);
		this.view.setInt32(at, high);
		this.view.setUint32(at + 4, (value - high * 0x1_0000_0000) >>> 0);
		return this;
	}

	fourcc(value: string): this {
		for (let index = 0; index < 4; index++) {
			this.u8(value.charCodeAt(index) & 0xFF);
		}
		return this;
	}

	bytes(value: Uint8Array): this {
		const at = this.reserve(value.length);
		this.buffer.set(value, at);
		return this;
	}

	zeros(count: number): this {
		this.reserve(count);
		return this;
	}

	/** Writes a box: its size, its type, and what `body` writes. */
	box(type: string, body: (writer: this) => void): this {
		const at = this.reserve(4);
		this.fourcc(type);
		body(this);
		this.view.setUint32(at, this.length - at);
		return this;
	}

	/** Writes a full box, with its version and flags. */
	fullBox(type: string, version: number, flags: number, body: (writer: this) => void): this {
		return this.box(type, writer => {
			writer.u8(version).u24(flags);
			body(writer);
		});
	}

	result(): Uint8Array {
		return this.buffer.slice(0, this.length);
	}
}
