/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { decodeBase64, encodeBase64, VSBuffer } from '../../../base/common/buffer.js';
import { IBaseHalfPluginCatalogPublicKey, IBaseHalfPluginCatalogSignature } from './basehalfPluginCatalog.js';

export async function verifyBaseHalfPluginCatalogSignature(
	catalogBytes: Uint8Array,
	signature: IBaseHalfPluginCatalogSignature,
	publicKeys: readonly IBaseHalfPluginCatalogPublicKey[],
	webCrypto: Crypto = globalThis.crypto
): Promise<boolean> {
	const publicKey = publicKeys.find(candidate => candidate.keyId === signature.keyId);
	if (!publicKey || signature.algorithm !== 'ECDSA_P256_SHA256_DER') {
		return false;
	}
	const key = await webCrypto.subtle.importKey(
		'spki',
		arrayBuffer(pemSubjectPublicKeyInfo(publicKey.publicKey)),
		{ name: 'ECDSA', namedCurve: 'P-256' },
		false,
		['verify']
	);
	const derSignature = decodeBase64(signature.signature).buffer;
	const p1363Signature = ecdsaDerToP1363(derSignature, 32);
	for (const candidate of [p1363Signature, derSignature]) {
		try {
			if (await webCrypto.subtle.verify(
				{ name: 'ECDSA', hash: 'SHA-256' },
				key,
				arrayBuffer(candidate),
				arrayBuffer(catalogBytes)
			)) {
				return true;
			}
		} catch {
			// Web Crypto implementations differ in the accepted ECDSA signature encoding.
		}
	}
	return false;
}

export function sha256HexToChecksumBase64(hex: string): string {
	if (!/^[a-fA-F0-9]{64}$/.test(hex)) {
		throw new Error('SHA-256 must contain exactly 64 hexadecimal characters.');
	}
	const bytes = VSBuffer.alloc(32);
	for (let index = 0; index < bytes.byteLength; index++) {
		bytes.buffer[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
	}
	return encodeBase64(bytes).replace(/=+$/, '');
}

export function ecdsaDerToP1363(der: Uint8Array, coordinateLength: number): Uint8Array {
	let offset = 0;
	if (der[offset++] !== 0x30) {
		throw new Error('ECDSA signature must start with a DER sequence.');
	}
	const sequenceLength = readDerLength(der, offset);
	offset = sequenceLength.offset;
	if (sequenceLength.length !== der.length - offset) {
		throw new Error('ECDSA signature DER sequence length is invalid.');
	}
	const r = readDerInteger(der, offset);
	offset = r.offset;
	const s = readDerInteger(der, offset);
	offset = s.offset;
	if (offset !== der.length) {
		throw new Error('ECDSA signature contains trailing DER data.');
	}
	const result = new Uint8Array(coordinateLength * 2);
	copyCoordinate(r.value, result, 0, coordinateLength);
	copyCoordinate(s.value, result, coordinateLength, coordinateLength);
	return result;
}

function pemSubjectPublicKeyInfo(pem: string): Uint8Array {
	if (!pem.includes('-----BEGIN PUBLIC KEY-----') || !pem.includes('-----END PUBLIC KEY-----')) {
		throw new Error('Plugin catalog public key must be a PEM SubjectPublicKeyInfo key.');
	}
	const encoded = pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '');
	return decodeBase64(encoded).buffer;
}

function readDerInteger(der: Uint8Array, offset: number): { readonly value: Uint8Array; readonly offset: number } {
	if (der[offset++] !== 0x02) {
		throw new Error('ECDSA signature DER sequence must contain two integers.');
	}
	const integerLength = readDerLength(der, offset);
	offset = integerLength.offset;
	if (integerLength.length < 1 || offset + integerLength.length > der.length) {
		throw new Error('ECDSA signature DER integer length is invalid.');
	}
	const value = der.subarray(offset, offset + integerLength.length);
	if ((value[0] & 0x80) !== 0 || (value.length > 1 && value[0] === 0 && (value[1] & 0x80) === 0)) {
		throw new Error('ECDSA signature DER integer is not minimally encoded and positive.');
	}
	return { value, offset: offset + integerLength.length };
}

function readDerLength(der: Uint8Array, offset: number): { readonly length: number; readonly offset: number } {
	if (offset >= der.length) {
		throw new Error('ECDSA signature DER length is missing.');
	}
	const first = der[offset++];
	if ((first & 0x80) === 0) {
		return { length: first, offset };
	}
	const bytes = first & 0x7f;
	if (bytes < 1 || bytes > 2 || offset + bytes > der.length) {
		throw new Error('ECDSA signature DER length uses an unsupported encoding.');
	}
	let length = 0;
	for (let index = 0; index < bytes; index++) {
		length = (length << 8) | der[offset++];
	}
	if (length < 128) {
		throw new Error('ECDSA signature DER length is not minimally encoded.');
	}
	return { length, offset };
}

function copyCoordinate(value: Uint8Array, target: Uint8Array, offset: number, coordinateLength: number): void {
	const normalized = value[0] === 0 ? value.subarray(1) : value;
	if (normalized.length > coordinateLength) {
		throw new Error('ECDSA signature coordinate is too large for P-256.');
	}
	target.set(normalized, offset + coordinateLength - normalized.length);
}

function arrayBuffer(value: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(value.byteLength);
	copy.set(value);
	return copy.buffer;
}
