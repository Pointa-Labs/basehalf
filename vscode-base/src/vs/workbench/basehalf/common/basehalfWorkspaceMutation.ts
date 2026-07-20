/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { AsyncEmitter, Emitter, Event, IWaitUntil, IWaitUntilData } from '../../../base/common/event.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { isEqualOrParent, joinPath, relativePath as getRelativePath } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { FileOperation } from '../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';

export const IBaseHalfWorkspaceMutationCoordinator = createDecorator<IBaseHalfWorkspaceMutationCoordinator>('baseHalfWorkspaceMutationCoordinator');

/**
 * A lease spans one logical path-addressed transaction. In-app file moves hold
 * it from the working-copy `will` event through the complete mirror cascade;
 * canvas and badge intents enter the same FIFO before doing any asynchronous
 * validation. This makes issuance order, rather than IO completion order, the
 * commit order.
 */
export interface IBaseHalfWorkspaceMutationLease {
	readonly workspaceKeys: readonly string[];
	release(): void;
}

export interface IBaseHalfWorkspaceMutationStamp {
	readonly workspaceKey: string;
	readonly structuralEpoch: number;
}

export interface IBaseHalfWorkspaceResourceMutationStamp {
	readonly workspaceKey: string;
	readonly relativePath: string;
	readonly structuralEpoch: number;
}

export interface IBaseHalfStructuralMutationPath {
	readonly workspace: URI;
	readonly relativePath: string;
}

export type BaseHalfStructuralMutationOutcomeKind = 'committed' | 'aborted' | 'reconciled' | 'cancelled';

export interface IBaseHalfCompletedStructuralMutation {
	readonly operation: FileOperation.MOVE | FileOperation.DELETE;
	readonly source?: URI;
	readonly target: URI;
}

/**
 * The terminal result of one structural reservation. `committed` means the
 * working-copy operation completed normally, `aborted` means no member of a
 * failed sequential batch reached disk, and `reconciled` means a failed batch
 * left a landed prefix whose derived mirrors were brought into line before the
 * reservation was released.
 */
export interface IBaseHalfStructuralMutationOutcome extends IWaitUntil {
	readonly kind: BaseHalfStructuralMutationOutcomeKind;
	readonly workspaces: readonly URI[];
	readonly affectedPaths: readonly IBaseHalfStructuralMutationPath[];
	readonly completed: readonly IBaseHalfCompletedStructuralMutation[];
}

interface IBaseHalfPendingStructuralOutcome {
	readonly sequence: number;
	readonly outcome: IWaitUntilData<IBaseHalfStructuralMutationOutcome>;
	publishRequested: boolean;
	publishPromise?: Promise<void>;
}

const MAX_STRUCTURAL_OUTCOME_PUBLISH_ATTEMPTS = 2;

export type BaseHalfStructuralResourceOutcome =
	| { readonly kind: 'none' }
	| { readonly kind: 'recreate' }
	| { readonly kind: 'close' }
	| { readonly kind: 'move'; readonly resource: URI };

export interface IBaseHalfStructuralMutationReservation {
	readonly ready: Promise<void>;
	/** Runs preparation while the structural reservation owns its workspace
	 * lease, without settling or publishing the reservation. */
	runPrepared<T>(task: (lease: IBaseHalfWorkspaceMutationLease) => Promise<T>): Promise<T>;
	finish(task: (lease: IBaseHalfWorkspaceMutationLease) => Promise<void>, completed?: readonly IBaseHalfCompletedStructuralMutation[]): Promise<void>;
	reconcile(completed: readonly IBaseHalfCompletedStructuralMutation[], task: (lease: IBaseHalfWorkspaceMutationLease) => Promise<void>): Promise<void>;
	abort(): Promise<void>;
	/** Release a reservation that never entered physical IO. Publishes a
	 * non-destructive `cancelled` notification so scenes refresh their epoch;
	 * retained resource identity is unchanged. */
	cancel(): Promise<void>;
	/** Internal post-IO variants release the commit barrier immediately but
	 * defer the retained-surface outcome until `publish()` after public file
	 * listeners have reconciled native working copies. */
	finishInternal(task: (lease: IBaseHalfWorkspaceMutationLease) => Promise<void>, completed?: readonly IBaseHalfCompletedStructuralMutation[]): Promise<void>;
	reconcileInternal(completed: readonly IBaseHalfCompletedStructuralMutation[], task: (lease: IBaseHalfWorkspaceMutationLease) => Promise<void>): Promise<void>;
	abortInternal(): Promise<void>;
	publish(): Promise<void>;
}

export interface IBaseHalfWorkspaceMutationCoordinator {
	readonly _serviceBrand: undefined;
	readonly onDidFinishStructuralMutation: Event<IBaseHalfStructuralMutationOutcome>;
	readonly onDidChangeResourceMutationFence: Event<IBaseHalfStructuralMutationPath>;
	capture(workspace: URI): IBaseHalfWorkspaceMutationStamp;
	isStampCurrent(workspace: URI, stamp: IBaseHalfWorkspaceMutationStamp): boolean;
	captureResource(workspace: URI, relativePath: string): IBaseHalfWorkspaceResourceMutationStamp;
	isResourceStampCurrent(workspace: URI, stamp: IBaseHalfWorkspaceResourceMutationStamp): boolean;
	acquireResourceMutationFence(workspace: URI, relativePath: string): IDisposable;
	isResourceMutationFenced(workspace: URI, relativePath: string): boolean;
	acquire(workspaces: URI | readonly URI[]): Promise<IBaseHalfWorkspaceMutationLease>;
	assertLease(lease: IBaseHalfWorkspaceMutationLease, workspace: URI): void;
	runExclusive<T>(workspace: URI, task: (lease: IBaseHalfWorkspaceMutationLease) => Promise<T>): Promise<T>;
	runSceneMutation<T>(workspace: URI, stamp: IBaseHalfWorkspaceMutationStamp, task: (lease: IBaseHalfWorkspaceMutationLease) => Promise<T>): Promise<T>;
	runResourceMutation<T>(workspace: URI, stamp: IBaseHalfWorkspaceResourceMutationStamp | readonly IBaseHalfWorkspaceResourceMutationStamp[], task: (lease: IBaseHalfWorkspaceMutationLease) => Promise<T>): Promise<T>;
	reserveStructural(workspaces: URI | readonly URI[], affectedPaths?: readonly IBaseHalfStructuralMutationPath[]): IBaseHalfStructuralMutationReservation;
}

export class BaseHalfWorkspaceMutationCoordinator implements IBaseHalfWorkspaceMutationCoordinator {
	declare readonly _serviceBrand: undefined;

	private readonly tailByWorkspace = new Map<string, Promise<void>>();
	private readonly structuralEpochByWorkspace = new Map<string, number>();
	private readonly pendingStructuralByWorkspace = new Map<string, number>();
	private readonly structuralEpochByPath = new Map<string, Map<string, number>>();
	private readonly pendingStructuralPaths = new Map<string, Map<string, number>>();
	private readonly resourceMutationFences = new Map<string, Map<string, number>>();
	private structuralOutcomeSequence = 0;
	private readonly pendingStructuralOutcomes = new Set<IBaseHalfPendingStructuralOutcome>();
	private readonly _onDidFinishStructuralMutation = new AsyncEmitter<IBaseHalfStructuralMutationOutcome>();
	readonly onDidFinishStructuralMutation = this._onDidFinishStructuralMutation.event;
	private readonly _onDidChangeResourceMutationFence = new Emitter<IBaseHalfStructuralMutationPath>();
	readonly onDidChangeResourceMutationFence = this._onDidChangeResourceMutationFence.event;

	capture(workspace: URI): IBaseHalfWorkspaceMutationStamp {
		const workspaceKey = workspace.toString();
		return {
			workspaceKey,
			structuralEpoch: this.structuralEpochByWorkspace.get(workspaceKey) ?? 0
		};
	}

	isStampCurrent(workspace: URI, stamp: IBaseHalfWorkspaceMutationStamp): boolean {
		const current = this.capture(workspace);
		return stamp.workspaceKey === current.workspaceKey
			&& stamp.structuralEpoch === current.structuralEpoch
			&& (this.pendingStructuralByWorkspace.get(current.workspaceKey) ?? 0) === 0;
	}

	captureResource(workspace: URI, relativePath: string): IBaseHalfWorkspaceResourceMutationStamp {
		const workspaceKey = workspace.toString();
		return {
			workspaceKey,
			relativePath,
			structuralEpoch: this.resourceStructuralEpoch(workspaceKey, relativePath)
		};
	}

	isResourceStampCurrent(workspace: URI, stamp: IBaseHalfWorkspaceResourceMutationStamp): boolean {
		const workspaceKey = workspace.toString();
		return stamp.workspaceKey === workspaceKey
			&& stamp.structuralEpoch === this.resourceStructuralEpoch(workspaceKey, stamp.relativePath)
			&& !this.pathIsPending(workspaceKey, stamp.relativePath)
			&& !this.pathIsResourceMutationFenced(workspaceKey, stamp.relativePath);
	}

	acquireResourceMutationFence(workspace: URI, relativePath: string): IDisposable {
		const workspaceKey = workspace.toString();
		let fences = this.resourceMutationFences.get(workspaceKey);
		if (!fences) {
			fences = new Map();
			this.resourceMutationFences.set(workspaceKey, fences);
		}
		fences.set(relativePath, (fences.get(relativePath) ?? 0) + 1);
		const event = { workspace, relativePath };
		this._onDidChangeResourceMutationFence.fire(event);

		let released = false;
		return toDisposable(() => {
			if (released) {
				return;
			}
			released = true;
			const current = this.resourceMutationFences.get(workspaceKey);
			if (current) {
				const next = (current.get(relativePath) ?? 1) - 1;
				if (next <= 0) {
					current.delete(relativePath);
				} else {
					current.set(relativePath, next);
				}
				if (current.size === 0) {
					this.resourceMutationFences.delete(workspaceKey);
				}
			}
			this._onDidChangeResourceMutationFence.fire(event);
		});
	}

	isResourceMutationFenced(workspace: URI, relativePath: string): boolean {
		return this.pathIsResourceMutationFenced(workspace.toString(), relativePath);
	}

	async acquire(workspaces: URI | readonly URI[]): Promise<IBaseHalfWorkspaceMutationLease> {
		const values: readonly URI[] = workspaces instanceof URI ? [workspaces] : workspaces;
		const keys = [...new Set(values.map(workspace => workspace.toString()))].sort();
		// Reserve every queue position synchronously. `onWillRun...` therefore
		// places the structural barrier before any later scene intent can enter.
		const reservations = keys.map(key => this.reserveOne(key));
		await Promise.all(reservations.map(reservation => reservation.ready));

		let released = false;
		return {
			workspaceKeys: keys,
			release: () => {
				if (released) {
					return;
				}
				released = true;
				for (const reservation of reservations.reverse()) {
					reservation.release();
				}
			}
		};
	}

	assertLease(lease: IBaseHalfWorkspaceMutationLease, workspace: URI): void {
		if (!lease.workspaceKeys.includes(workspace.toString())) {
			throw new Error('A BaseHalf workspace mutation lease cannot be used for another workspace.');
		}
	}

	async runExclusive<T>(workspace: URI, task: (lease: IBaseHalfWorkspaceMutationLease) => Promise<T>): Promise<T> {
		const lease = await this.acquire(workspace);
		try {
			return await task(lease);
		} finally {
			lease.release();
		}
	}

	runSceneMutation<T>(workspace: URI, stamp: IBaseHalfWorkspaceMutationStamp, task: (lease: IBaseHalfWorkspaceMutationLease) => Promise<T>): Promise<T> {
		if (!this.isStampCurrent(workspace, stamp)) {
			return Promise.reject(new Error('The workspace structure changed before this canvas interaction completed.'));
		}

		// `runExclusive` reserves its FIFO position synchronously. A structural
		// reservation created after this point is ordered after this intent and
		// will relocate/purge its result; one created before was rejected above.
		return this.runExclusive(workspace, task);
	}

	runResourceMutation<T>(workspace: URI, stamp: IBaseHalfWorkspaceResourceMutationStamp | readonly IBaseHalfWorkspaceResourceMutationStamp[], task: (lease: IBaseHalfWorkspaceMutationLease) => Promise<T>): Promise<T> {
		const stamps = Array.isArray(stamp) ? stamp : [stamp];
		if (stamps.length === 0 || stamps.some(candidate => !this.isResourceStampCurrent(workspace, candidate))) {
			return Promise.reject(new Error('The resource identity changed before this BaseHalf interaction completed.'));
		}
		return this.runExclusive(workspace, task);
	}

	reserveStructural(workspaces: URI | readonly URI[], affectedPaths: readonly IBaseHalfStructuralMutationPath[] = []): IBaseHalfStructuralMutationReservation {
		const values: readonly URI[] = workspaces instanceof URI ? [workspaces] : workspaces;
		const paths = [...new Map(affectedPaths.map(path => [`${path.workspace.toString()}\0${path.relativePath}`, path])).values()];
		const unique = [...new Map([...values, ...paths.map(path => path.workspace)].map(workspace => [workspace.toString(), workspace])).values()];
		for (const workspace of unique) {
			const key = workspace.toString();
			this.pendingStructuralByWorkspace.set(key, (this.pendingStructuralByWorkspace.get(key) ?? 0) + 1);
			this.bumpStructuralEpoch(workspace);
		}
		for (const path of paths) {
			this.bumpStructuralPath(path.workspace, path.relativePath);
			this.changePendingStructuralPath(path.workspace, path.relativePath, 1);
		}
		const leasePromise = this.acquire(unique);
		let settled = false;
		let pendingOutcome: IBaseHalfPendingStructuralOutcome | undefined;
		const publish = (): Promise<void> => {
			if (!pendingOutcome) {
				return Promise.resolve();
			}
			return this.publishStructuralOutcome(pendingOutcome);
		};

		const settle = async (
			kind: BaseHalfStructuralMutationOutcomeKind,
			completed: readonly IBaseHalfCompletedStructuralMutation[],
			task?: (lease: IBaseHalfWorkspaceMutationLease) => Promise<void>,
			publishMode: 'immediate' | 'deferred' | 'none' = 'immediate'
		): Promise<void> => {
			if (settled) {
				return;
			}
			settled = true;
			const completedSnapshot = [...completed];
			const lease = await leasePromise;
			try {
				await task?.(lease);
			} finally {
				for (const workspace of unique) {
					this.bumpStructuralEpoch(workspace);
					const key = workspace.toString();
					const pending = (this.pendingStructuralByWorkspace.get(key) ?? 1) - 1;
					if (pending === 0) {
						this.pendingStructuralByWorkspace.delete(key);
					} else {
						this.pendingStructuralByWorkspace.set(key, pending);
					}
				}
				for (const path of paths) {
					this.bumpStructuralPath(path.workspace, path.relativePath);
					this.changePendingStructuralPath(path.workspace, path.relativePath, -1);
				}
				lease.release();
				if (publishMode !== 'none') {
					pendingOutcome = {
						sequence: this.structuralOutcomeSequence++,
						publishRequested: false,
						outcome: {
							kind,
							workspaces: unique,
							affectedPaths: paths,
							completed: completedSnapshot
						}
					};
					this.pendingStructuralOutcomes.add(pendingOutcome);
					if (publishMode === 'immediate') {
						await publish();
					}
				}
			}
		};

		return {
			ready: leasePromise.then(() => undefined),
			runPrepared: async task => {
				if (settled) {
					throw new Error('A settled structural reservation cannot run more preparation.');
				}
				return task(await leasePromise);
			},
			finish: (task, completed = []) => settle('committed', completed, task),
			reconcile: (completed, task) => {
				if (completed.length === 0) {
					return settle('aborted', []);
				}
				return settle('reconciled', completed, task);
			},
			abort: () => settle('aborted', []),
			cancel: () => settle('cancelled', []),
			finishInternal: (task, completed = []) => settle('committed', completed, task, 'deferred'),
			reconcileInternal: (completed, task) => {
				if (completed.length === 0) {
					return settle('aborted', [], undefined, 'deferred');
				}
				return settle('reconciled', completed, task, 'deferred');
			},
			abortInternal: () => settle('aborted', [], undefined, 'deferred'),
			publish
		};
	}

	private publishStructuralOutcome(record: IBaseHalfPendingStructuralOutcome): Promise<void> {
		if (!this.pendingStructuralOutcomes.has(record)) {
			return Promise.resolve();
		}
		record.publishRequested = true;
		if (record.publishPromise) {
			return record.publishPromise;
		}
		if (this.hasEarlierPendingStructuralOutcome(record)) {
			// A nested/public-listener operation may complete while its predecessor
			// is still inside public did listeners. Do not deadlock it by awaiting
			// that predecessor; the predecessor's later publish composes both chains.
			return Promise.resolve();
		}

		record.publishPromise = this.publishStructuralOutcomeHead(record);
		return record.publishPromise;
	}

	private async publishStructuralOutcomeHead(head: IBaseHalfPendingStructuralOutcome): Promise<void> {
		const candidates: IBaseHalfPendingStructuralOutcome[] = [];
		const workspaceKeys = new Set(head.outcome.workspaces.map(workspace => workspace.toString()));
		for (const candidate of [...this.pendingStructuralOutcomes].sort((a, b) => a.sequence - b.sequence)) {
			if (candidate.sequence < head.sequence || !this.outcomeTouchesWorkspace(candidate, workspaceKeys)) {
				continue;
			}
			if (!candidate.publishRequested) {
				// Never publish an operation whose native public listeners have not
				// completed. It remains the ordering barrier for later outcomes.
				break;
			}
			if (candidate !== head && this.hasEarlierPendingStructuralOutcome(candidate, new Set(candidates))) {
				// Do not pull a multi-workspace successor ahead of an earlier pending
				// outcome on one of its other workspaces. That earlier head will compose
				// the successor after this independent publication completes.
				continue;
			}
			candidates.push(candidate);
			for (const workspace of candidate.outcome.workspaces) {
				workspaceKeys.add(workspace.toString());
			}
		}
		if (candidates.length === 0) {
			return;
		}

		const nonCancelled = candidates.filter(candidate => candidate.outcome.kind !== 'cancelled');
		const effective = nonCancelled.length > 0 ? nonCancelled : candidates;
		const terminal = nonCancelled.at(-1) ?? candidates[candidates.length - 1];
		const workspaces = [...new Map(candidates.flatMap(candidate => candidate.outcome.workspaces).map(workspace => [workspace.toString(), workspace])).values()];
		// A cancelled pre-IO attempt refreshes scene epochs but must not turn into
		// a destructive recreate merely because it is composed with a later commit.
		const affectedPaths = [...new Map(effective.flatMap(candidate => candidate.outcome.affectedPaths).map(path => [`${path.workspace.toString()}\0${path.relativePath}`, path])).values()];
		const completed = effective.flatMap(candidate => candidate.outcome.completed);

		let publicationError: unknown;
		try {
			for (let attempt = 0; attempt < MAX_STRUCTURAL_OUTCOME_PUBLISH_ATTEMPTS; attempt++) {
				const listenerErrors: unknown[] = [];
				await this._onDidFinishStructuralMutation.fireAsync({
					kind: terminal.outcome.kind,
					workspaces,
					affectedPaths,
					completed
				}, CancellationToken.None, promise => promise.catch(error => {
					listenerErrors.push(error);
				}));
				if (listenerErrors.length === 0) {
					publicationError = undefined;
					break;
				}
				publicationError = listenerErrors.length === 1
					? listenerErrors[0]
					: new AggregateError(listenerErrors, 'Structural outcome listeners failed.');
			}
		} finally {
			// Physical IO is already terminal. A broken retained-surface listener
			// must be reported, but it must not leave an ordering barrier that can
			// permanently suppress every later structural outcome.
			for (const candidate of candidates) {
				this.pendingStructuralOutcomes.delete(candidate);
			}
		}

		// A publish request can arrive while the listener barrier above is
		// running. Drain any now-unblocked head without requiring another caller.
		for (const candidate of [...this.pendingStructuralOutcomes].sort((a, b) => a.sequence - b.sequence)) {
			if (candidate.publishRequested && !candidate.publishPromise && !this.hasEarlierPendingStructuralOutcome(candidate)) {
				await this.publishStructuralOutcome(candidate);
				break;
			}
		}
		if (publicationError !== undefined) {
			throw publicationError;
		}
	}

	private hasEarlierPendingStructuralOutcome(record: IBaseHalfPendingStructuralOutcome, ignored: ReadonlySet<IBaseHalfPendingStructuralOutcome> = new Set()): boolean {
		const workspaces = new Set(record.outcome.workspaces.map(workspace => workspace.toString()));
		return [...this.pendingStructuralOutcomes].some(candidate =>
			!ignored.has(candidate) && candidate.sequence < record.sequence && this.outcomeTouchesWorkspace(candidate, workspaces)
		);
	}

	private outcomeTouchesWorkspace(record: IBaseHalfPendingStructuralOutcome, workspaceKeys: ReadonlySet<string>): boolean {
		return record.outcome.workspaces.some(workspace => workspaceKeys.has(workspace.toString()));
	}

	private reserveOne(key: string): { readonly ready: Promise<void>; readonly release: () => void } {
		const previous = this.tailByWorkspace.get(key) ?? Promise.resolve();
		let openGate!: () => void;
		const gate = new Promise<void>(resolve => openGate = resolve);
		this.tailByWorkspace.set(key, gate);

		let released = false;
		return {
			ready: previous,
			release: () => {
				if (released) {
					return;
				}
				released = true;
				openGate();
				if (this.tailByWorkspace.get(key) === gate) {
					this.tailByWorkspace.delete(key);
				}
			}
		};
	}

	private bumpStructuralEpoch(workspace: URI): void {
		const key = workspace.toString();
		this.structuralEpochByWorkspace.set(key, (this.structuralEpochByWorkspace.get(key) ?? 0) + 1);
	}

	private bumpStructuralPath(workspace: URI, relativePath: string): void {
		const workspaceKey = workspace.toString();
		let epochs = this.structuralEpochByPath.get(workspaceKey);
		if (!epochs) {
			epochs = new Map();
			this.structuralEpochByPath.set(workspaceKey, epochs);
		}
		epochs.set(relativePath, this.structuralEpochByWorkspace.get(workspaceKey) ?? 0);
	}

	private changePendingStructuralPath(workspace: URI, relativePath: string, delta: 1 | -1): void {
		const workspaceKey = workspace.toString();
		let pending = this.pendingStructuralPaths.get(workspaceKey);
		if (!pending) {
			pending = new Map();
			this.pendingStructuralPaths.set(workspaceKey, pending);
		}
		const next = (pending.get(relativePath) ?? 0) + delta;
		if (next <= 0) {
			pending.delete(relativePath);
		} else {
			pending.set(relativePath, next);
		}
		if (pending.size === 0) {
			this.pendingStructuralPaths.delete(workspaceKey);
		}
	}

	private resourceStructuralEpoch(workspaceKey: string, relativePath: string): number {
		let epoch = 0;
		for (const [root, candidate] of this.structuralEpochByPath.get(workspaceKey) ?? []) {
			if (isSameOrDescendantPath(relativePath, root)) {
				epoch = Math.max(epoch, candidate);
			}
		}
		return epoch;
	}

	private pathIsPending(workspaceKey: string, relativePath: string): boolean {
		for (const root of this.pendingStructuralPaths.get(workspaceKey)?.keys() ?? []) {
			if (isSameOrDescendantPath(relativePath, root)) {
				return true;
			}
		}
		return false;
	}

	private pathIsResourceMutationFenced(workspaceKey: string, relativePath: string): boolean {
		for (const root of this.resourceMutationFences.get(workspaceKey)?.keys() ?? []) {
			if (isSameOrDescendantPath(relativePath, root)) {
				return true;
			}
		}
		return false;
	}
}

function isSameOrDescendantPath(path: string, root: string): boolean {
	return path === root || path.startsWith(`${root}/`);
}

/**
 * Resolve what a completed structural transaction means for one retained
 * path-owned surface. Source identities follow a completed move chain;
 * deletes and destination overwrites destroy the old identity; attempted but
 * uncompleted members require a validated rebuild at the original URI.
 */
export function baseHalfStructuralResourceOutcome(
	outcome: IBaseHalfStructuralMutationOutcome,
	workspace: URI,
	relativePath: string,
	resource: URI
): BaseHalfStructuralResourceOutcome {
	if (outcome.kind === 'cancelled') {
		return { kind: 'none' };
	}
	let mapped = resource;
	let followedMove = false;
	for (const completed of outcome.completed) {
		if (completed.operation === FileOperation.DELETE) {
			if (isEqualOrParent(mapped, completed.target)) {
				return { kind: 'close' };
			}
			continue;
		}

		if (completed.source && isEqualOrParent(mapped, completed.source)) {
			const suffix = getRelativePath(completed.source, mapped);
			mapped = suffix ? joinPath(completed.target, ...suffix.split('/')) : completed.target;
			followedMove = true;
			continue;
		}

		// The retained surface belonged to the old destination identity. A move
		// that lands on that path replaces it; silently reopening the incoming
		// file would present a different document as though it were the same one.
		if (isEqualOrParent(mapped, completed.target)) {
			return { kind: 'close' };
		}
	}

	if (followedMove) {
		return mapped.toString() === resource.toString() ? { kind: 'recreate' } : { kind: 'move', resource: mapped };
	}

	const workspaceKey = workspace.toString();
	return outcome.affectedPaths.some(path => path.workspace.toString() === workspaceKey && isSameOrDescendantPath(relativePath, path.relativePath))
		? { kind: 'recreate' }
		: { kind: 'none' };
}

registerSingleton(IBaseHalfWorkspaceMutationCoordinator, BaseHalfWorkspaceMutationCoordinator, InstantiationType.Delayed);
