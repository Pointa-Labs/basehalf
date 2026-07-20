/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { basename } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { SourceTargetPair } from '../../services/workingCopy/common/workingCopyFileService.js';
import {
	BASEHALF_NODE_DOCUMENT_EXTENSION,
	BASEHALF_NODE_DOCUMENT_MAX_BYTES,
	forkBaseHalfNodeDocument,
	parseBaseHalfNodeDocumentBytes,
	serializeBaseHalfNodeDocument
} from '../common/basehalfNodeDocument.js';

const NODE_COPY_WRITE_POSTFIX = '.basehalf-node-copy-tmp';
export const BASEHALF_NODE_COPY_MAX_SCAN_ENTRIES = 100_000;
export const BASEHALF_NODE_COPY_MAX_DEPTH = 512;
export const BASEHALF_NODE_COPY_MAX_CANDIDATES = 4096;
export const BASEHALF_NODE_COPY_MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;

export interface IBaseHalfNodeCopyPlan {
	readonly source: URI;
	readonly target: URI;
	/** Candidates that belong to the source tree, never the pre-existing target tree. */
	readonly candidates: readonly IBaseHalfNodeCopyCandidate[];
}

interface IBaseHalfNodeCopyCandidate {
	readonly relativePath: readonly string[];
	readonly sourceBefore: IBaseHalfNodeCopySnapshot;
	readonly targetBefore: IBaseHalfNodeCopyTargetSnapshot;
}

type IBaseHalfNodeCopySnapshot =
	| { readonly state: 'missing' }
	| { readonly state: 'content'; readonly content: VSBuffer }
	| { readonly state: 'opaque'; readonly etag: string; readonly size: number };

type IBaseHalfNodeCopyTargetSnapshot = IBaseHalfNodeCopySnapshot;

interface IBaseHalfNodeCopyScanBudget {
	entries: number;
	candidates: number;
	snapshotBytes: number;
}

/**
 * Captures only `.bhnode` candidate paths that the requested COPY can add or
 * replace. The finalizer must not scan a merge target, because unrelated nodes
 * may already live there.
 */
export async function prepareBaseHalfNodeCopyPlans(
	fileService: IFileService,
	files: readonly SourceTargetPair[]
): Promise<readonly IBaseHalfNodeCopyPlan[]> {
	const plans: IBaseHalfNodeCopyPlan[] = [];
	for (const file of files) {
		if (!file.source) {
			continue;
		}
		const budget: IBaseHalfNodeCopyScanBudget = { entries: 0, candidates: 0, snapshotBytes: 0 };
		const candidatePaths: string[][] = [];
		await collectNodeCandidatesIfPresent(fileService, file.source, candidatePaths, budget);
		const candidates: IBaseHalfNodeCopyCandidate[] = [];
		for (const relativePath of candidatePaths) {
			const source = relativePath.length === 0 ? file.source : URI.joinPath(file.source, ...relativePath);
			const target = relativePath.length === 0 ? file.target : URI.joinPath(file.target, ...relativePath);
			const sourceBefore = await snapshotCopyResource(fileService, source);
			const targetBefore = await snapshotCopyResource(fileService, target);
			countSnapshotBytes(budget, sourceBefore);
			countSnapshotBytes(budget, targetBefore);
			candidates.push(Object.freeze({
				relativePath: Object.freeze(relativePath),
				sourceBefore,
				targetBefore
			}));
		}
		plans.push(Object.freeze({
			source: file.source,
			target: file.target,
			candidates: Object.freeze(candidates)
		}));
	}
	return Object.freeze(plans);
}

/**
 * Separates every valid result container in the completed prefix of one
 * working-copy COPY. Ordinary files and malformed `.bhnode` files remain
 * byte-for-byte copies.
 */
export async function forkCopiedBaseHalfNodeTrees(
	fileService: IFileService,
	plans: readonly IBaseHalfNodeCopyPlan[],
	completedFiles: readonly SourceTargetPair[],
	createId: () => string = generateUuid
): Promise<readonly URI[]> {
	const planByPair = new Map(plans.map(plan => [copyPairKey(plan.source, plan.target), plan]));
	const candidates = new Map<string, { readonly resource: URI; readonly expected: VSBuffer }>();
	for (const file of completedFiles) {
		if (!file.source) {
			continue;
		}
		const plan = planByPair.get(copyPairKey(file.source, file.target));
		if (!plan) {
			continue;
		}
		await collectForkCandidatesForPlan(fileService, plan, candidates);
	}

	const forked: URI[] = [];
	for (const candidate of [...candidates.values()].sort((left, right) => left.resource.toString().localeCompare(right.resource.toString()))) {
		if (await forkCopiedNode(fileService, candidate.resource, candidate.expected, createId)) {
			forked.push(candidate.resource);
		}
	}
	return Object.freeze(forked);
}

/**
 * A provider can fail after partially materializing a directory. Separate only
 * planned candidate targets that changed during the failed pair; untouched
 * merge-target nodes retain their identity.
 */
export async function forkPartiallyCopiedBaseHalfNodeTrees(
	fileService: IFileService,
	plans: readonly IBaseHalfNodeCopyPlan[],
	_completedFiles: readonly SourceTargetPair[],
	createId: () => string = generateUuid
): Promise<readonly URI[]> {
	const candidates = new Map<string, { readonly resource: URI; readonly expected: VSBuffer }>();
	for (const plan of plans) {
		await collectForkCandidatesForPlan(fileService, plan, candidates);
	}
	const forked: URI[] = [];
	for (const candidate of [...candidates.values()].sort((left, right) => left.resource.toString().localeCompare(right.resource.toString()))) {
		if (await forkCopiedNode(fileService, candidate.resource, candidate.expected, createId)) {
			forked.push(candidate.resource);
		}
	}
	return Object.freeze(forked);
}

async function collectNodeCandidatesIfPresent(
	fileService: IFileService,
	resource: URI,
	result: string[][],
	budget: IBaseHalfNodeCopyScanBudget
): Promise<void> {
	if (!await fileService.exists(resource)) {
		return;
	}
	await collectSourceNodeCandidates(fileService, resource, [], result, budget, 0);
}

async function collectSourceNodeCandidates(
	fileService: IFileService,
	resource: URI,
	relativePath: readonly string[],
	result: string[][],
	budget: IBaseHalfNodeCopyScanBudget,
	depth: number
): Promise<void> {
	if (++budget.entries > BASEHALF_NODE_COPY_MAX_SCAN_ENTRIES) {
		throw new Error(`A single copy can inspect at most ${BASEHALF_NODE_COPY_MAX_SCAN_ENTRIES.toLocaleString()} entries for result nodes. Copy a smaller folder.`);
	}
	const stat = await fileService.resolve(resource, { resolveMetadata: true });
	if (stat.isSymbolicLink) {
		return;
	}
	if (stat.isFile) {
		if (basename(resource).toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION)) {
			if (++budget.candidates > BASEHALF_NODE_COPY_MAX_CANDIDATES) {
				throw new Error(`A single copy can contain at most ${BASEHALF_NODE_COPY_MAX_CANDIDATES.toLocaleString()} result nodes. Copy a smaller folder.`);
			}
			result.push([...relativePath]);
		}
		return;
	}
	if (!stat.isDirectory) {
		return;
	}
	if ((stat.children?.length ?? 0) > 0 && depth >= BASEHALF_NODE_COPY_MAX_DEPTH) {
		throw new Error(`A copied folder can be nested at most ${BASEHALF_NODE_COPY_MAX_DEPTH.toLocaleString()} levels deep.`);
	}
	for (const child of stat.children ?? []) {
		await collectSourceNodeCandidates(fileService, child.resource, [...relativePath, basename(child.resource)], result, budget, depth + 1);
	}
}

function copyPairKey(source: URI, target: URI): string {
	return `${source.toString()}\0${target.toString()}`;
}

function relativePathKey(relativePath: readonly string[]): string {
	return relativePath.join('\0');
}

async function snapshotCopyResource(fileService: IFileService, resource: URI): Promise<IBaseHalfNodeCopySnapshot> {
	if (!await fileService.exists(resource)) {
		return Object.freeze({ state: 'missing' });
	}
	const stat = await fileService.resolve(resource, { resolveMetadata: true });
	if (!stat.isFile || stat.isSymbolicLink) {
		return Object.freeze({ state: 'opaque', etag: stat.etag, size: stat.size });
	}
	try {
		const content = await fileService.readFile(resource, {
			atomic: true,
			limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES }
		});
		return Object.freeze({ state: 'content', content: content.value.clone() });
	} catch {
		return Object.freeze({ state: 'opaque', etag: stat.etag, size: stat.size });
	}
}

function countSnapshotBytes(budget: IBaseHalfNodeCopyScanBudget, snapshot: IBaseHalfNodeCopySnapshot): void {
	if (snapshot.state !== 'content') {
		return;
	}
	budget.snapshotBytes += snapshot.content.byteLength;
	if (budget.snapshotBytes > BASEHALF_NODE_COPY_MAX_SNAPSHOT_BYTES) {
		throw new Error(`A single copy can snapshot at most ${Math.floor(BASEHALF_NODE_COPY_MAX_SNAPSHOT_BYTES / (1024 * 1024))} MiB of result-node declarations. Copy a smaller folder.`);
	}
}

function snapshotsEqual(left: IBaseHalfNodeCopySnapshot, right: IBaseHalfNodeCopySnapshot): boolean {
	if (left.state !== right.state) {
		return false;
	}
	if (left.state === 'missing') {
		return true;
	}
	if (left.state === 'opaque' && right.state === 'opaque') {
		return left.etag === right.etag && left.size === right.size;
	}
	return left.state === 'content' && right.state === 'content' && left.content.equals(right.content);
}

function nodeId(snapshot: IBaseHalfNodeCopySnapshot): string | undefined {
	if (snapshot.state !== 'content') {
		return undefined;
	}
	try {
		return parseBaseHalfNodeDocumentBytes(snapshot.content.buffer).id;
	} catch {
		return undefined;
	}
}

async function collectForkCandidatesForPlan(
	fileService: IFileService,
	plan: IBaseHalfNodeCopyPlan,
	result: Map<string, { readonly resource: URI; readonly expected: VSBuffer }>
): Promise<void> {
	const budget: IBaseHalfNodeCopyScanBudget = { entries: 0, candidates: 0, snapshotBytes: 0 };
	const latestPaths: string[][] = [];
	await collectNodeCandidatesIfPresent(fileService, plan.source, latestPaths, budget);
	const prepared = new Map(plan.candidates.map(candidate => [relativePathKey(candidate.relativePath), candidate]));
	const latest = new Map<string, { readonly relativePath: readonly string[]; readonly snapshot: IBaseHalfNodeCopySnapshot }>();
	for (const relativePath of latestPaths) {
		const source = relativePath.length === 0 ? plan.source : URI.joinPath(plan.source, ...relativePath);
		const snapshot = await snapshotCopyResource(fileService, source);
		countSnapshotBytes(budget, snapshot);
		latest.set(relativePathKey(relativePath), { relativePath, snapshot });
	}
	const latePath = [...latest.keys()].find(key => !prepared.has(key));
	if (latePath !== undefined) {
		const relativePath = latest.get(latePath)!.relativePath;
		throw new Error(`The copy source gained result node '${relativePath.join('/')}' after the operation began. No result-node identities were changed; undo the copy and try again after source edits finish.`);
	}
	const paths = new Map<string, readonly string[]>();
	for (const candidate of plan.candidates) {
		paths.set(relativePathKey(candidate.relativePath), candidate.relativePath);
	}
	for (const [key, relativePath] of paths) {
		const resource = relativePath.length === 0 ? plan.target : URI.joinPath(plan.target, ...relativePath);
		const current = await snapshotCopyResource(fileService, resource);
		countSnapshotBytes(budget, current);
		if (current.state !== 'content') {
			continue;
		}
		const before = prepared.get(key)?.targetBefore;
		if (before && snapshotsEqual(before, current)) {
			continue;
		}
		const sources = [prepared.get(key)?.sourceBefore, latest.get(key)?.snapshot].filter((value): value is IBaseHalfNodeCopySnapshot => value !== undefined);
		const exactSource = sources.some(source => source.state === 'content' && source.content.equals(current.content));
		if (!exactSource) {
			const currentId = nodeId(current);
			const sourceIds = new Set(sources.map(nodeId).filter((value): value is string => value !== undefined));
			if (currentId && sourceIds.has(currentId)) {
				throw new Error(`Copied result node '${resource.path}' changed while the copy was being finalized. Its content was left untouched; undo the copy or review that file before continuing.`);
			}
			continue;
		}
		const existing = result.get(resource.toString());
		if (existing && !existing.expected.equals(current.content)) {
			throw new Error(`Two overlapping copy operations produced different contents for '${resource.path}'. Its content was left untouched.`);
		}
		result.set(resource.toString(), Object.freeze({ resource, expected: current.content }));
	}
}

async function forkCopiedNode(fileService: IFileService, resource: URI, expected: VSBuffer, createId: () => string): Promise<boolean> {
	let document;
	try {
		document = parseBaseHalfNodeDocumentBytes(expected.buffer);
	} catch {
		return false;
	}
	const separated = forkBaseHalfNodeDocument(document, createId());
	try {
		await fileService.writeFileWithExpectedContents(
			resource,
			VSBuffer.fromString(serializeBaseHalfNodeDocument(separated)),
			expected,
			{ atomic: { postfix: NODE_COPY_WRITE_POSTFIX } }
		);
		return true;
	} catch (error) {
		throw new Error(`Copied result node '${resource.path}' changed before its independent identity could be saved. Its newer content was left untouched; undo the copy or review that file before continuing.`, { cause: error });
	}
}
