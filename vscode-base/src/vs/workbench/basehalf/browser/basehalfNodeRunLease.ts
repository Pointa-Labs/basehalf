/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { encodeBase64, VSBuffer } from '../../../base/common/buffer.js';
import { dirname, extUri } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { FileOperationError, FileOperationResult, IFileContent, IFileService } from '../../../platform/files/common/files.js';
import { assertBaseHalfWorkspaceFilePath, ensureBaseHalfWorkspaceDirectory } from './basehalfWorkspacePathSafety.js';

const LEASE_VERSION = 1;
const LEASE_DIRECTORY = '.bh/cache/node-run-leases';
const LEASE_MAX_BYTES = 16 * 1024;
const LEASE_WRITE_MAX_ATTEMPTS = 8;
const LEASE_WRITE_TEMP_POSTFIX = '.basehalf-run-lease-tmp';

export type BaseHalfNodeRunLeaseState = 'active' | 'recovering' | 'released';

export interface IBaseHalfNodeRunLeaseRecord {
	readonly version: 1;
	readonly nodeId: string;
	readonly nodePath: string;
	readonly state: BaseHalfNodeRunLeaseState;
	readonly ownerId: string;
	readonly runId: string;
	readonly epoch: string;
	readonly acquiredAt: string;
	readonly heartbeatAt: string;
	readonly releasedAt?: string;
}

export interface IBaseHalfNodeRunLeaseHandle {
	readonly workspaceFolder: URI;
	readonly resource: URI;
	readonly record: IBaseHalfNodeRunLeaseRecord;
}

export type BaseHalfNodeRunLeaseAcquireResult =
	| { readonly kind: 'acquired'; readonly handle: IBaseHalfNodeRunLeaseHandle }
	| { readonly kind: 'recovery'; readonly handle: IBaseHalfNodeRunLeaseHandle; readonly abandonedRunId: string }
	| { readonly kind: 'busy'; readonly record: IBaseHalfNodeRunLeaseRecord };

export interface IBaseHalfNodeRunLeaseClock {
	now(): number;
}

const systemClock: IBaseHalfNodeRunLeaseClock = Object.freeze({ now: () => Date.now() });

export function baseHalfNodeRunLeaseResource(workspaceFolder: URI, nodeId: string): URI {
	const segment = encodeBase64(VSBuffer.fromString(nodeId), false, true);
	return URI.joinPath(workspaceFolder, ...LEASE_DIRECTORY.split('/'), `${segment}.json`);
}

/**
 * Coordinates one node run across workbench hosts through a project-local,
 * compare-and-swap lease. Lease records are retained after release so an old
 * owner can never erase or overwrite a newer owner's claim.
 */
export class BaseHalfNodeRunLeaseStore {
	constructor(
		private readonly fileService: IFileService,
		private readonly staleAfterMs: number,
		private readonly clock: IBaseHalfNodeRunLeaseClock = systemClock
	) {
		if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) {
			throw new Error('The node run lease timeout must be a positive duration.');
		}
	}

	async acquire(
		workspaceFolder: URI,
		nodeId: string,
		nodePath: string,
		ownerId: string,
		runId: string,
		persistedRunningRunId: string | undefined
	): Promise<BaseHalfNodeRunLeaseAcquireResult> {
		const resource = baseHalfNodeRunLeaseResource(workspaceFolder, nodeId);
		await ensureBaseHalfWorkspaceDirectory(this.fileService, workspaceFolder, dirname(resource), 'node run lease directory');
		await assertBaseHalfWorkspaceFilePath(this.fileService, workspaceFolder, resource, 'node run lease', true);

		for (let attempt = 0; attempt < LEASE_WRITE_MAX_ATTEMPTS; attempt++) {
			const existing = await this.read(workspaceFolder, resource);
			if (!existing) {
				const next = persistedRunningRunId
					? this.newRecord(nodeId, nodePath, ownerId, persistedRunningRunId, 'recovering')
					: this.newRecord(nodeId, nodePath, ownerId, runId, 'active');
				try {
					await assertBaseHalfWorkspaceFilePath(this.fileService, workspaceFolder, resource, 'node run lease', true);
					await this.fileService.createFile(resource, serializeLease(next), { overwrite: false });
					await assertBaseHalfWorkspaceFilePath(this.fileService, workspaceFolder, resource, 'node run lease', false);
					const handle = Object.freeze({ workspaceFolder, resource, record: next });
					return persistedRunningRunId
						? Object.freeze({ kind: 'recovery', handle, abandonedRunId: persistedRunningRunId })
						: Object.freeze({ kind: 'acquired', handle });
				} catch (error) {
					if (isFileExists(error)) {
						continue;
					}
					throw error;
				}
			}

			if (existing.record.nodeId !== nodeId) {
				this.assertIdentity(existing.record, nodeId, nodePath);
			}
			const reusable = existing.record.state === 'released' || this.isStale(existing.record);
			if (!reusable) {
				return Object.freeze({ kind: 'busy', record: existing.record });
			}
			if (existing.record.nodePath !== nodePath
				&& !await this.canRebindReleasedPath(workspaceFolder, existing.record.nodePath, nodePath)) {
				this.assertIdentity(existing.record, nodeId, nodePath);
			}

			const next = persistedRunningRunId
				? this.newRecord(nodeId, nodePath, ownerId, persistedRunningRunId, 'recovering')
				: this.newRecord(nodeId, nodePath, ownerId, runId, 'active');
			try {
					await this.compareAndSwap(workspaceFolder, resource, existing.content.value, next);
				const handle = Object.freeze({ workspaceFolder, resource, record: next });
				return persistedRunningRunId
					? Object.freeze({ kind: 'recovery', handle, abandonedRunId: persistedRunningRunId })
					: Object.freeze({ kind: 'acquired', handle });
			} catch (error) {
				if (isModifiedSince(error) || isFileNotFound(error)) {
					continue;
				}
				throw error;
			}
		}
		throw new Error('The node run owner changed repeatedly. Try again.');
	}

	async activateRecovered(handle: IBaseHalfNodeRunLeaseHandle, runId: string): Promise<IBaseHalfNodeRunLeaseHandle | undefined> {
		if (handle.record.state !== 'recovering') {
			return undefined;
		}
		const current = await this.read(handle.workspaceFolder, handle.resource);
		if (!current || !sameOwner(current.record, handle.record, 'recovering')) {
			return undefined;
		}
		const now = this.timestamp();
		const next: IBaseHalfNodeRunLeaseRecord = Object.freeze({
			...current.record,
			state: 'active',
			runId,
			epoch: generateUuid(),
			acquiredAt: now,
			heartbeatAt: now
		});
		try {
			await this.compareAndSwap(handle.workspaceFolder, handle.resource, current.content.value, next);
			return Object.freeze({ workspaceFolder: handle.workspaceFolder, resource: handle.resource, record: next });
		} catch (error) {
			if (isModifiedSince(error) || isFileNotFound(error)) {
				return undefined;
			}
			throw error;
		}
	}

	async heartbeat(handle: IBaseHalfNodeRunLeaseHandle): Promise<IBaseHalfNodeRunLeaseHandle | undefined> {
		if (handle.record.state === 'released') {
			return undefined;
		}
		const current = await this.read(handle.workspaceFolder, handle.resource);
		if (!current || !sameOwner(current.record, handle.record, handle.record.state)) {
			return undefined;
		}
		const next: IBaseHalfNodeRunLeaseRecord = Object.freeze({
			...current.record,
			heartbeatAt: this.timestamp()
		});
		try {
			await this.compareAndSwap(handle.workspaceFolder, handle.resource, current.content.value, next);
			return Object.freeze({ workspaceFolder: handle.workspaceFolder, resource: handle.resource, record: next });
		} catch (error) {
			if (isModifiedSince(error) || isFileNotFound(error)) {
				return undefined;
			}
			throw error;
		}
	}

	async release(handle: IBaseHalfNodeRunLeaseHandle): Promise<boolean> {
		const current = await this.read(handle.workspaceFolder, handle.resource);
		if (!current || !sameOwner(current.record, handle.record, handle.record.state)) {
			return false;
		}
		const now = this.timestamp();
		const next: IBaseHalfNodeRunLeaseRecord = Object.freeze({
			...current.record,
			state: 'released',
			heartbeatAt: now,
			releasedAt: now
		});
		try {
			await this.compareAndSwap(handle.workspaceFolder, handle.resource, current.content.value, next);
			return true;
		} catch (error) {
			if (isModifiedSince(error) || isFileNotFound(error)) {
				return false;
			}
			throw error;
		}
	}

	async inspect(workspaceFolder: URI, nodeId: string): Promise<IBaseHalfNodeRunLeaseRecord | undefined> {
		const resource = baseHalfNodeRunLeaseResource(workspaceFolder, nodeId);
		if (!await this.fileService.exists(dirname(resource))) {
			return undefined;
		}
		return (await this.read(workspaceFolder, resource))?.record;
	}

	isStale(record: IBaseHalfNodeRunLeaseRecord): boolean {
		return record.state !== 'released' && this.clock.now() - Date.parse(record.heartbeatAt) > this.staleAfterMs;
	}

	private newRecord(
		nodeId: string,
		nodePath: string,
		ownerId: string,
		runId: string,
		state: 'active' | 'recovering'
	): IBaseHalfNodeRunLeaseRecord {
		const now = this.timestamp();
		return Object.freeze({
			version: LEASE_VERSION,
			nodeId,
			nodePath,
			state,
			ownerId,
			runId,
			epoch: generateUuid(),
			acquiredAt: now,
			heartbeatAt: now
		});
	}

	private async read(workspaceFolder: URI, resource: URI): Promise<{ readonly content: IFileContent; readonly record: IBaseHalfNodeRunLeaseRecord } | undefined> {
		try {
			await assertBaseHalfWorkspaceFilePath(this.fileService, workspaceFolder, resource, 'node run lease', true);
			const content = await this.fileService.readFile(resource, {
				atomic: true,
				limits: { size: LEASE_MAX_BYTES }
			});
			return Object.freeze({ content, record: parseLease(content.value.toString()) });
		} catch (error) {
			if (isFileNotFound(error)) {
				return undefined;
			}
			throw error;
		}
	}

	private async compareAndSwap(workspaceFolder: URI, resource: URI, expected: VSBuffer, next: IBaseHalfNodeRunLeaseRecord): Promise<void> {
		await assertBaseHalfWorkspaceFilePath(this.fileService, workspaceFolder, resource, 'node run lease', false);
		await this.fileService.writeFileWithExpectedContents(resource, serializeLease(next), expected, {
			atomic: { postfix: LEASE_WRITE_TEMP_POSTFIX }
		});
		await assertBaseHalfWorkspaceFilePath(this.fileService, workspaceFolder, resource, 'node run lease', false);
	}

	/**
	 * A node keeps its stable id when it is moved, while the retained lease keeps
	 * the last known path. Rebind only after that owner is released/stale and the
	 * old path no longer names a distinct workspace resource. This preserves the
	 * duplicate-id guard while making ordinary moves and case-only renames usable.
	 */
	private async canRebindReleasedPath(workspaceFolder: URI, previousPath: string, nextPath: string): Promise<boolean> {
		const previous = this.workspaceNodeResource(workspaceFolder, previousPath);
		const next = this.workspaceNodeResource(workspaceFolder, nextPath);
		if (!previous || !next) {
			return false;
		}
		if (!await this.fileService.exists(previous)) {
			return true;
		}
		try {
			const [previousRealpath, nextRealpath] = await Promise.all([
				this.fileService.realpath(previous),
				this.fileService.realpath(next)
			]);
			return !!previousRealpath && !!nextRealpath && extUri.isEqual(previousRealpath, nextRealpath);
		} catch {
			return false;
		}
	}

	private workspaceNodeResource(workspaceFolder: URI, nodePath: string): URI | undefined {
		const resource = URI.joinPath(workspaceFolder, ...nodePath.split('/'));
		return extUri.isEqualOrParent(resource, workspaceFolder) && !extUri.isEqual(resource, workspaceFolder)
			? resource
			: undefined;
	}

	private assertIdentity(record: IBaseHalfNodeRunLeaseRecord, nodeId: string, nodePath: string): void {
		if (record.nodeId !== nodeId || record.nodePath !== nodePath) {
			throw new Error('The node run owner record does not match this node. Repair the project cache before running it.');
		}
	}

	private timestamp(): string {
		return new Date(this.clock.now()).toISOString();
	}
}

function serializeLease(record: IBaseHalfNodeRunLeaseRecord): VSBuffer {
	return VSBuffer.fromString(`${JSON.stringify(record, null, '\t')}\n`);
}

function parseLease(source: string): IBaseHalfNodeRunLeaseRecord {
	let value: unknown;
	try {
		value = JSON.parse(source);
	} catch {
		throw new Error('The node run owner record is not valid JSON.');
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('The node run owner record must be an object.');
	}
	const candidate = value as Record<string, unknown>;
	const allowed = new Set(['version', 'nodeId', 'nodePath', 'state', 'ownerId', 'runId', 'epoch', 'acquiredAt', 'heartbeatAt', 'releasedAt']);
	if (Object.keys(candidate).some(key => !allowed.has(key)) || candidate.version !== LEASE_VERSION) {
		throw new Error('The node run owner record has an unsupported shape.');
	}
	const nodeId = requiredString(candidate.nodeId, 'nodeId');
	const nodePath = requiredString(candidate.nodePath, 'nodePath');
	const ownerId = requiredString(candidate.ownerId, 'ownerId');
	const runId = requiredString(candidate.runId, 'runId');
	const epoch = requiredString(candidate.epoch, 'epoch');
	const state = candidate.state;
	if (state !== 'active' && state !== 'recovering' && state !== 'released') {
		throw new Error('The node run owner record has an invalid state.');
	}
	const acquiredAt = requiredTimestamp(candidate.acquiredAt, 'acquiredAt');
	const heartbeatAt = requiredTimestamp(candidate.heartbeatAt, 'heartbeatAt');
	const releasedAt = candidate.releasedAt === undefined ? undefined : requiredTimestamp(candidate.releasedAt, 'releasedAt');
	if ((state === 'released') !== (releasedAt !== undefined)) {
		throw new Error('The node run owner record has an invalid release state.');
	}
	return Object.freeze({
		version: LEASE_VERSION,
		nodeId,
		nodePath,
		state,
		ownerId,
		runId,
		epoch,
		acquiredAt,
		heartbeatAt,
		...(releasedAt === undefined ? {} : { releasedAt })
	});
}

function requiredString(value: unknown, field: string): string {
	if (typeof value !== 'string' || value.trim() !== value || value.length === 0 || value.length > 1024 || value.includes('\0')) {
		throw new Error(`The node run owner record has an invalid ${field}.`);
	}
	return value;
}

function requiredTimestamp(value: unknown, field: string): string {
	const timestamp = requiredString(value, field);
	if (!Number.isFinite(Date.parse(timestamp))) {
		throw new Error(`The node run owner record has an invalid ${field}.`);
	}
	return timestamp;
}

function sameOwner(
	current: IBaseHalfNodeRunLeaseRecord,
	expected: IBaseHalfNodeRunLeaseRecord,
	state: BaseHalfNodeRunLeaseState
): boolean {
	return current.state === state
		&& current.nodeId === expected.nodeId
		&& current.nodePath === expected.nodePath
		&& current.ownerId === expected.ownerId
		&& current.runId === expected.runId
		&& current.epoch === expected.epoch;
}

function isModifiedSince(error: unknown): boolean {
	return error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_MODIFIED_SINCE;
}

function isFileNotFound(error: unknown): boolean {
	return error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND;
}

function isFileExists(error: unknown): boolean {
	return error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_MOVE_CONFLICT;
}
