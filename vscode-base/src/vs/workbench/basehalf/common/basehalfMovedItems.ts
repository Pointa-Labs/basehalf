/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../base/common/buffer.js';
import { stringHash } from '../../../base/common/hash.js';
import { posix } from '../../../base/common/path.js';
import { BaseHalfCanvasItemKind } from './basehalfCanvasModel.js';
import { baseHalfIsMirrorSubtree, baseHalfRemapSubtreeRel } from './basehalfMirrorTree.js';

/**
 * Recognizing items that were renamed or moved outside BaseHalf (following
 * moved items, "Recognition"). BaseHalf does what git does: it compares what
 * it last saw with what is there now, and pairs an item that disappeared with
 * one that appeared when their content is the same or mostly the same. This
 * module is the part that touches no service.
 */

/** A file up to this size is hashed whole; a larger one in three windows. */
export const BASEHALF_FINGERPRINT_FULL_HASH_MAX_BYTES = 16 * 1024 * 1024;
export const BASEHALF_FINGERPRINT_WINDOW_BYTES = 1024 * 1024;
/** A text file up to this size also gets its pieces, for similarity. */
export const BASEHALF_FINGERPRINT_TEXT_MAX_BYTES = 1024 * 1024;
/** A file is text when this many leading bytes hold no NUL. */
export const BASEHALF_FINGERPRINT_TEXT_SAMPLE_BYTES = 8 * 1024;
/** A file with more distinct words keeps those with the smallest hashes. */
export const BASEHALF_FINGERPRINT_MAX_PIECES = 512;
/**
 * Two text files are the same file when they share at least this much, and
 * at least this much of what was particular to the old one is in the new one.
 */
export const BASEHALF_MOVED_ITEM_SIMILARITY_MINIMUM = 0.5;
/** ... and the words they share are at least this many characters. */
export const BASEHALF_MOVED_ITEM_SHARED_MINIMUM = 32;
/** Similarity is skipped beyond this many pairs of files to compare. */
export const BASEHALF_MOVED_ITEM_SIMILARITY_PAIR_LIMIT = 1_000_000;

/**
 * What BaseHalf remembers of a file's content. `pieces` holds, for each kept
 * word of a text file, its 32-bit hash and its weight, as consecutive
 * numbers.
 */
export interface IBaseHalfFileFingerprint {
	readonly size: number;
	/** Hex SHA-256 of the content, or of the three windows of a large file. */
	readonly hash: string;
	readonly pieces?: readonly number[];
	/** True when the file had more pieces than are kept. */
	readonly sampled?: boolean;
}

/** Reads a part of a file's saved content. */
export interface IBaseHalfFingerprintSource {
	readonly size: number;
	read(position: number, length: number): Promise<VSBuffer>;
}

/**
 * The fingerprint of a file. An empty file has none: it has no content to
 * recognize.
 */
export async function baseHalfComputeFileFingerprint(source: IBaseHalfFingerprintSource, withPieces = true): Promise<IBaseHalfFileFingerprint | undefined> {
	const size = source.size;
	if (size <= 0) {
		return undefined;
	}
	if (size > BASEHALF_FINGERPRINT_FULL_HASH_MAX_BYTES) {
		const window = BASEHALF_FINGERPRINT_WINDOW_BYTES;
		const middle = Math.floor(size / 2) - window / 2;
		const parts = [
			await source.read(0, window),
			await source.read(middle, window),
			await source.read(size - window, window)
		];
		return { size, hash: await sha256(VSBuffer.concat(parts)) };
	}
	const bytes = await source.read(0, size);
	const hash = await sha256(bytes);
	if (!withPieces || size > BASEHALF_FINGERPRINT_TEXT_MAX_BYTES || !isText(bytes)) {
		return { size, hash };
	}
	return { size, hash, ...baseHalfTextPieces(bytes.toString()) };
}

async function sha256(bytes: VSBuffer): Promise<string> {
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes.buffer as Uint8Array<ArrayBuffer>));
	let hex = '';
	for (const byte of digest) {
		hex += byte.toString(16).padStart(2, '0');
	}
	return hex;
}

function isText(bytes: VSBuffer): boolean {
	const end = Math.min(bytes.byteLength, BASEHALF_FINGERPRINT_TEXT_SAMPLE_BYTES);
	for (let index = 0; index < end; index++) {
		if (bytes.readUInt8(index) === 0) {
			return false;
		}
	}
	return true;
}

/** Scripts that are written without spaces between words: their characters are taken in pairs. */
const UNSPACED_SCRIPT = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u;

/**
 * The pieces of a text are its words, in lower case, and for text in a
 * script without spaces each pair of neighboring characters. A piece weighs
 * its length times how often it occurs.
 *
 * Words and not lines or sentences: an agent that is asked to tighten a note
 * rewords every sentence and keeps most of the words, and the note is still
 * the same note. Beyond {@link BASEHALF_FINGERPRINT_MAX_PIECES} distinct
 * pieces, those with the smallest hashes are kept, so that two versions of a
 * file keep the same ones.
 */
export function baseHalfTextPieces(text: string): Pick<IBaseHalfFileFingerprint, 'pieces' | 'sampled'> {
	const weights = new Map<number, number>();
	const add = (piece: string): void => {
		const hash = stringHash(piece, 0) >>> 0;
		weights.set(hash, (weights.get(hash) ?? 0) + piece.length);
	};
	for (const run of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
		let word = '';
		let previous = '';
		for (const character of run) {
			if (UNSPACED_SCRIPT.test(character)) {
				if (word) {
					add(word);
					word = '';
				}
				if (previous) {
					add(previous + character);
				}
				previous = character;
			} else {
				previous = '';
				word += character;
			}
		}
		if (word) {
			add(word);
		}
	}
	const found = [...weights].sort((a, b) => a[0] - b[0]);
	const sampled = found.length > BASEHALF_FINGERPRINT_MAX_PIECES;
	const pieces: number[] = [];
	for (const [hash, weight] of sampled ? found.slice(0, BASEHALF_FINGERPRINT_MAX_PIECES) : found) {
		pieces.push(hash, weight);
	}
	return sampled ? { pieces, sampled } : { pieces };
}

/**
 * In how many files each piece occurs. A piece that other files also have is
 * an ordinary word, a shared heading, a template, or the frame of a generated
 * file: the more files have it, the less it says about which file a file is.
 */
export type BaseHalfPieceFrequency = ReadonlyMap<number, number>;

export function baseHalfPieceFrequency(fingerprints: Iterable<IBaseHalfFileFingerprint>): Map<number, number> {
	const frequency = new Map<number, number>();
	for (const fingerprint of fingerprints) {
		for (const hash of pieceHashes(fingerprint)) {
			frequency.set(hash, (frequency.get(hash) ?? 0) + 1);
		}
	}
	return frequency;
}

/**
 * How much of the larger of two text files the two share, from 0 to 1: the
 * weight of their common pieces over the weight of the pieces of the larger
 * file.
 */
export function baseHalfFingerprintSimilarity(a: IBaseHalfFileFingerprint, b: IBaseHalfFileFingerprint): number {
	return sharedText(a, b, undefined).similarity;
}

/**
 * What two text files share. `similarity` is how much of the larger file the
 * two share, as written. `particular` is how much of what was particular to
 * `gone` is in `appeared`: a piece that `n` other files also have counts with
 * one part in `n + 1` of its weight, and `frequency` must count both files.
 *
 * Only the old file is weighed that way. New text in the new file is counted
 * by the similarity, as what it is: weighed, a few new words that no other
 * file has would outweigh the ordinary words that stayed.
 */
function sharedText(gone: IBaseHalfFileFingerprint, appeared: IBaseHalfFileFingerprint, frequency: BaseHalfPieceFrequency | undefined): { readonly similarity: number; readonly shared: number; readonly particular: number } {
	if (!gone.pieces || !appeared.pieces) {
		return { similarity: 0, shared: 0, particular: 0 };
	}
	// A sampled file kept its smallest hashes: compare within the range both cover.
	const limit = Math.min(pieceHashLimit(gone), pieceHashLimit(appeared));
	const first = pieceWeights(gone.pieces, limit);
	const second = pieceWeights(appeared.pieces, limit);
	let firstTotal = 0;
	let secondTotal = 0;
	let shared = 0;
	let own = 0;
	let ownKept = 0;
	for (const [hash, weight] of first) {
		const other = second.get(hash);
		// The two files themselves are not other files.
		const part = frequency ? 1 / Math.max(1, (frequency.get(hash) ?? 0) - (other === undefined ? 0 : 1)) : 1;
		firstTotal += weight;
		own += weight * part;
		if (other !== undefined) {
			shared += Math.min(weight, other);
			ownKept += Math.min(weight, other) * part;
		}
	}
	for (const weight of second.values()) {
		secondTotal += weight;
	}
	const larger = Math.max(firstTotal, secondTotal);
	return { similarity: larger === 0 ? 0 : shared / larger, shared, particular: own === 0 ? 0 : ownKept / own };
}

function pieceHashes(fingerprint: IBaseHalfFileFingerprint): Set<number> {
	const hashes = new Set<number>();
	for (let index = 0; index < (fingerprint.pieces?.length ?? 0); index += 2) {
		hashes.add(fingerprint.pieces![index]);
	}
	return hashes;
}

function pieceHashLimit(fingerprint: IBaseHalfFileFingerprint): number {
	if (!fingerprint.sampled || !fingerprint.pieces) {
		return Number.POSITIVE_INFINITY;
	}
	let limit = 0;
	for (let index = 0; index < fingerprint.pieces.length; index += 2) {
		limit = Math.max(limit, fingerprint.pieces[index]);
	}
	return limit;
}

function pieceWeights(pieces: readonly number[], limit: number): Map<number, number> {
	const weights = new Map<number, number>();
	for (let index = 0; index < pieces.length; index += 2) {
		const hash = pieces[index];
		if (hash <= limit) {
			weights.set(hash, (weights.get(hash) ?? 0) + pieces[index + 1]);
		}
	}
	return weights;
}

/** Which rule of "Recognition" paired an item. */
export type BaseHalfMovedItemRule = 'sameContent' | 'similarContent' | 'folderFiles' | 'belowFolder';

export interface IBaseHalfMovedItem {
	readonly from: string;
	readonly to: string;
	readonly kind: BaseHalfCanvasItemKind;
	readonly rule: BaseHalfMovedItemRule;
}

export interface IBaseHalfFollowedItem {
	readonly path: string;
	readonly kind: BaseHalfCanvasItemKind;
}

/**
 * One comparison: what disappeared from the snapshot and what appeared since.
 * Paths are relative to the workspace folder.
 */
export interface IBaseHalfMovedItemsComparison {
	/** The followed items that are gone. */
	readonly disappeared: readonly IBaseHalfFollowedItem[];
	/** Every file the snapshot holds a fingerprint for that is gone, followed or not. */
	readonly disappearedFingerprints: ReadonlyMap<string, IBaseHalfFileFingerprint>;
	/**
	 * The files that appeared, with their sizes. One that is `earlier` appeared
	 * before an earlier comparison ran: BaseHalf saw it next to what disappears
	 * now, as two items, so it is a new place only as a copy with the same
	 * content.
	 */
	readonly appearedFiles: readonly { readonly path: string; readonly size: number; readonly earlier?: boolean }[];
	/** The folders that appeared. */
	readonly appearedFolders: ReadonlySet<string>;
	/**
	 * Files that were paired earlier in the same window. They are in
	 * `disappearedFingerprints` and count for a folder, and are not paired or
	 * reported again.
	 */
	readonly earlierPairs?: ReadonlyMap<string, string>;
	/** The fingerprints of the files that are where the snapshot has them. */
	readonly presentFingerprints?: Iterable<IBaseHalfFileFingerprint>;
	/** The fingerprint of a file that appeared. */
	fingerprint(path: string, withPieces: boolean): Promise<IBaseHalfFileFingerprint | undefined>;
}

/**
 * The followed items of a comparison that were moved, in the order to
 * relocate them: first the files that left a moved folder for somewhere else,
 * then the folders from the outermost in, then the other files. An item that
 * only moved along with a folder above it is not listed; the folder's move
 * covers it (see {@link baseHalfMovedItemPath}).
 */
export async function baseHalfRecognizeMovedItems(comparison: IBaseHalfMovedItemsComparison): Promise<IBaseHalfMovedItem[]> {
	const filePairs = await pairFiles(comparison);

	// Rule 3: a folder follows its files. Outermost first, so that what is
	// below a paired folder needs no pairing of its own.
	const folders = comparison.disappeared.filter(item => item.kind === 'folder').sort((a, b) => depth(a.path) - depth(b.path) || compare(a.path, b.path));
	const folderMoves: IBaseHalfMovedItem[] = [];
	for (const folder of folders) {
		if (movedAlong(folderMoves, folder.path)) {
			continue;
		}
		const to = folderDestination(folder.path, filePairs, comparison);
		if (to !== undefined) {
			folderMoves.push({ from: folder.path, to, kind: 'folder', rule: 'folderFiles' });
		}
	}

	const leaving: IBaseHalfMovedItem[] = [];
	const others: IBaseHalfMovedItem[] = [];
	for (const item of comparison.disappeared) {
		if (comparison.earlierPairs?.has(item.path)) {
			continue;
		}
		const pair = item.kind === 'file' ? filePairs.get(item.path) : undefined;
		const along = movedAlong(folderMoves, item.path);
		if (along === undefined) {
			if (pair) {
				others.push({ from: item.path, to: pair.to, kind: 'file', rule: pair.rule });
			}
			continue;
		}
		const expected = baseHalfRemapSubtreeRel(item.path, along.from, along.to);
		if (pair && pair.to !== expected) {
			leaving.push({ from: item.path, to: pair.to, kind: 'file', rule: pair.rule });
		}
		// Rule 4 needs no entry: an item below a paired folder takes the same
		// relative path, and relocation of the folder moves it.
	}
	return [...leaving.sort(byFrom), ...folderMoves, ...others.sort(byFrom)];
}

/**
 * Where a path of the snapshot is after `moves`, or undefined when it did not
 * move. A path below a moved folder moves with it.
 */
export function baseHalfMovedItemPath(moves: readonly IBaseHalfMovedItem[], path: string): string | undefined {
	const own = moves.find(move => move.from === path);
	if (own) {
		return own.to;
	}
	const along = movedAlong(moves.filter(move => move.kind === 'folder'), path);
	return along ? baseHalfRemapSubtreeRel(path, along.from, along.to) : undefined;
}

interface IFilePair {
	readonly to: string;
	readonly rule: 'sameContent' | 'similarContent';
}

/** Rules 1 and 2 for every fingerprinted file that disappeared. */
async function pairFiles(comparison: IBaseHalfMovedItemsComparison): Promise<Map<string, IFilePair>> {
	const pairs = new Map<string, IFilePair>();
	const taken = new Set<string>();
	const pair = (from: string, to: string, rule: IFilePair['rule']) => {
		pairs.set(from, { to, rule });
		taken.add(to);
	};
	for (const [from, to] of comparison.earlierPairs ?? []) {
		pair(from, to, 'sameContent');
	}

	// Rule 1: same content. Only a file of the same size can have it.
	const bySize = new Map<number, string[]>();
	for (const [path, fingerprint] of comparison.disappearedFingerprints) {
		if (!pairs.has(path)) {
			bySize.set(fingerprint.size, [...(bySize.get(fingerprint.size) ?? []), path]);
		}
	}
	const sameContent = new Map<string, { gone: string[]; appeared: string[] }>();
	for (const file of comparison.appearedFiles) {
		const gone = bySize.get(file.size);
		if (!gone || taken.has(file.path)) {
			continue;
		}
		const fingerprint = await comparison.fingerprint(file.path, false);
		if (!fingerprint) {
			continue;
		}
		for (const path of gone) {
			if (comparison.disappearedFingerprints.get(path)!.hash === fingerprint.hash) {
				const group = sameContent.get(fingerprint.hash) ?? { gone: [], appeared: [] };
				if (!group.gone.includes(path)) {
					group.gone.push(path);
				}
				if (!group.appeared.includes(file.path)) {
					group.appeared.push(file.path);
				}
				sameContent.set(fingerprint.hash, group);
			}
		}
	}
	for (const group of sameContent.values()) {
		// Files of the same name belong together; what is left over is paired
		// only when one file is left on each side.
		let gone = group.gone.sort(compare);
		let appeared = group.appeared.sort(compare);
		for (const from of [...gone]) {
			const named = appeared.filter(to => posix.basename(to) === posix.basename(from));
			if (named.length === 1 && gone.filter(other => posix.basename(other) === posix.basename(from)).length === 1) {
				pair(from, named[0], 'sameContent');
				gone = gone.filter(other => other !== from);
				appeared = appeared.filter(other => other !== named[0]);
			}
		}
		if (gone.length === 1 && appeared.length === 1) {
			pair(gone[0], appeared[0], 'sameContent');
		}
	}

	// Rule 2: mostly the same content, for the text files still unpaired.
	const goneText = [...comparison.disappearedFingerprints].filter(([path, fingerprint]) => !pairs.has(path) && fingerprint.pieces);
	const appearedText = comparison.appearedFiles.filter(file => !taken.has(file.path) && !file.earlier && file.size > 0 && file.size <= BASEHALF_FINGERPRINT_TEXT_MAX_BYTES);
	if (goneText.length === 0 || goneText.length * appearedText.length > BASEHALF_MOVED_ITEM_SIMILARITY_PAIR_LIMIT) {
		return pairs;
	}
	const appearedFingerprints = new Map<string, IBaseHalfFileFingerprint>();
	for (const file of appearedText) {
		const fingerprint = await comparison.fingerprint(file.path, true);
		if (fingerprint?.pieces) {
			appearedFingerprints.set(file.path, fingerprint);
		}
	}
	// What other files also have counts less: count every fingerprint once.
	const frequency = baseHalfPieceFrequency([...comparison.presentFingerprints ?? [], ...comparison.disappearedFingerprints.values(), ...appearedFingerprints.values()]);
	const candidates: { readonly from: string; readonly to: string; readonly score: number; readonly sameName: boolean }[] = [];
	for (const [to, appeared] of appearedFingerprints) {
		for (const [from, gone] of goneText) {
			if (gone.hash === appeared.hash) {
				// The same content is rule 1's to decide, and it found several places.
				continue;
			}
			const { similarity, shared, particular } = sharedText(gone, appeared, frequency);
			if (similarity >= BASEHALF_MOVED_ITEM_SIMILARITY_MINIMUM && particular >= BASEHALF_MOVED_ITEM_SIMILARITY_MINIMUM && shared >= BASEHALF_MOVED_ITEM_SHARED_MINIMUM) {
				candidates.push({ from, to, score: similarity, sameName: posix.basename(from) === posix.basename(to) });
			}
		}
	}
	candidates.sort((a, b) => b.score - a.score || Number(b.sameName) - Number(a.sameName) || compare(a.from, b.from) || compare(a.to, b.to));
	for (const candidate of candidates) {
		if (!pairs.has(candidate.from) && !taken.has(candidate.to)) {
			pair(candidate.from, candidate.to, 'similarContent');
		}
	}
	return pairs;
}

/**
 * Rule 3: the folder that appeared and received more than half of the files
 * the snapshot holds a fingerprint for below `folder`, each at the same path
 * relative to it.
 */
function folderDestination(folder: string, filePairs: ReadonlyMap<string, IFilePair>, comparison: IBaseHalfMovedItemsComparison): string | undefined {
	let files = 0;
	const received = new Map<string, number>();
	for (const path of comparison.disappearedFingerprints.keys()) {
		if (path === folder || !baseHalfIsMirrorSubtree(path, folder)) {
			continue;
		}
		files++;
		const to = filePairs.get(path)?.to;
		const relative = path.slice(folder.length);
		if (to !== undefined && to.endsWith(relative) && to.length > relative.length) {
			const destination = to.slice(0, to.length - relative.length);
			received.set(destination, (received.get(destination) ?? 0) + 1);
		}
	}
	for (const [destination, count] of received) {
		if (count * 2 > files && comparison.appearedFolders.has(destination)) {
			return destination;
		}
	}
	return undefined;
}

/** The move of the folder that `path` is below, if any. */
function movedAlong(folderMoves: readonly IBaseHalfMovedItem[], path: string): IBaseHalfMovedItem | undefined {
	return folderMoves.find(move => move.from !== path && baseHalfIsMirrorSubtree(path, move.from));
}

function depth(path: string): number {
	return path.split('/').length;
}

function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function byFrom(a: IBaseHalfMovedItem, b: IBaseHalfMovedItem): number {
	return compare(a.from, b.from);
}
