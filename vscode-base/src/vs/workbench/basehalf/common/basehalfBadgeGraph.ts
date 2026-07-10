/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { FileOperationError, FileOperationResult, IFileService } from '../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import {
	BaseHalfBadgeKind,
	IBaseHalfBadgeFile,
	IBaseHalfBadgeMirrorService,
	IBaseHalfBadgeNode,
	IBaseHalfBadgeReadResult,
	IBaseHalfBadgeSnapshot
} from './basehalfBadgeMirror.js';
import { createKeyedMutex } from './basehalfKeyedMutex.js';
import { baseHalfIsMirrorSubtree, baseHalfMirrorPathSegments, baseHalfRemapSubtreeRel, baseHalfWalkMirror } from './basehalfMirrorTree.js';
import { IBaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceMutationLease } from './basehalfWorkspaceMutation.js';

export const IBaseHalfBadgeGraphService = createDecorator<IBaseHalfBadgeGraphService>('baseHalfBadgeGraphService');

export type BaseHalfReferenceReconnectResult = 'replaced' | 'already-connected';

export interface IBaseHalfBadgeIdentityReplacementOptions {
	readonly incomingKind: BaseHalfBadgeKind;
	readonly replacedKind?: BaseHalfBadgeKind;
	readonly sameResourceIdentity?: boolean;
}

const BADGE_GRAPH_TRANSACTION_MAX_ATTEMPTS = 3;
const BADGE_GRAPH_DISCOVERY_MAX_ATTEMPTS = 4;

interface IBaseHalfBadgeTransactionStep {
	readonly node: IBaseHalfBadgeNode;
	readonly before: IBaseHalfBadgeSnapshot;
	readonly after: IBaseHalfBadgeFile | null;
	readonly allowKindChange?: boolean;
}

interface IBaseHalfBadgeTransactionPlan<T> {
	readonly result: T;
	readonly steps: readonly IBaseHalfBadgeTransactionStep[];
	/** Every exact read the semantic plan depended on, including absent/skipped
	 * neighbours. Success is valid only while all observations are still current. */
	readonly observations?: readonly Pick<IBaseHalfBadgeTransactionStep, 'node' | 'before'>[];
}

interface IBaseHalfCommittedBadgeStep extends IBaseHalfBadgeTransactionStep {
	readonly written: IBaseHalfBadgeSnapshot;
}

/**
 * The badge SEMANTIC layer: every mutation of the reference graph goes through
 * here so its invariants hold no matter which surface (canvas, card detail,
 * file-operation cascade) triggered it:
 *
 *  - A reference A→B is recorded on BOTH ends — A's `references` and B's
 *    `referenced_by` — so "who points at me?" is one read of one badge.yaml.
 *  - The overlay stays LOGICALLY SPARSE: a badge that carries no authored
 *    content (no description, no graph edges, not orphaned) reads as absent.
 *    Once materialized it retires to canonical empty YAML, which preserves a
 *    CAS boundary without exposing an empty badge in product listings.
 *  - A node's badge FOLLOWS the node: renames carry the badge (and a folder's
 *    annotated descendants) and rewrite both directions of the graph; deletes
 *    scrub the node's backlinks off its former targets.
 *  - A badge whose disk node vanished is marked `orphan` — the human note is
 *    preserved for resurrection or explicit deletion, never silently lost.
 *
 * Multi-file graph mutations are serialized per WORKSPACE (a rename touches
 * the moved badge plus every neighbour), while each individual file write is
 * additionally atomic under the mirror layer's per-file lock.
 */
export interface IBaseHalfBadgeGraphService {
	readonly _serviceBrand: undefined;

	/** Write the node's human-authored one-liner. An empty description on an
	 *  otherwise-empty badge retires it to a logically absent tombstone. */
	updateDescription(node: IBaseHalfBadgeNode, description: string, lease?: IBaseHalfWorkspaceMutationLease): Promise<IBaseHalfBadgeFile | null>;
	/** Record source→target on both ends, materializing minimal badges as
	 *  needed. Rejects self-references. Idempotent. */
	addReference(source: IBaseHalfBadgeNode, target: IBaseHalfBadgeNode, lease?: IBaseHalfWorkspaceMutationLease): Promise<void>;
	/** Remove source→target from both ends, pruning badges the removal
	 *  emptied. Returns whether the canonical source edge still existed when
	 *  the transaction acquired the graph mutex. */
	removeReference(source: IBaseHalfBadgeNode, target: IBaseHalfBadgeNode, lease?: IBaseHalfWorkspaceMutationLease): Promise<boolean>;
	/** Replace one reference with another under one workspace transaction.
	 *  Synchronous write failures restore every badge already changed. */
	reconnectReference(
		previousSource: IBaseHalfBadgeNode,
		previousTarget: IBaseHalfBadgeNode,
		nextSource: IBaseHalfBadgeNode,
		nextTarget: IBaseHalfBadgeNode,
		lease?: IBaseHalfWorkspaceMutationLease
	): Promise<BaseHalfReferenceReconnectResult>;
	/** Run a derived-layer mutation only while the canonical semantic edge is
	 * still present, under the same workspace graph mutex. */
	runWithReference<T>(source: IBaseHalfBadgeNode, target: IBaseHalfBadgeNode, task: () => Promise<T>, lease?: IBaseHalfWorkspaceMutationLease): Promise<T>;
	/** One node's badge, or null when it has none (delegates to the mirror). */
	readBadge(node: IBaseHalfBadgeNode): Promise<IBaseHalfBadgeFile | null>;
	/** Every badge in the workspace (delegates to the mirror walk). */
	listBadges(workspaceFolder: URI): Promise<IBaseHalfBadgeReadResult>;
	/** Mark an existing badge orphan (disk node gone), preserving all content.
	 *  Missing badge is a no-op. */
	markOrphan(node: IBaseHalfBadgeNode, lease?: IBaseHalfWorkspaceMutationLease): Promise<void>;
	/** Clear the orphan flag (disk node reappeared). Missing badge is a no-op. */
	clearOrphan(node: IBaseHalfBadgeNode, lease?: IBaseHalfWorkspaceMutationLease): Promise<void>;
	/** Sweep every badge whose disk target is gone (or changed kind) and mark it
	 *  orphan. Returns the relative paths freshly orphaned. Run on workspace
	 *  open to catch deletions that happened outside the app. */
	pruneDangling(workspaceFolder: URI, lease?: IBaseHalfWorkspaceMutationLease): Promise<string[]>;
	/** A node moved `from` → `to`: carry its badge (folder: plus every annotated
	 *  descendant), rewrite the graph on both sides, drop the orphan flag, and
	 *  scrub backlinks whose referrer badge no longer exists. Nodes without a
	 *  badge are a quiet no-op (the overlay is sparse). */
	renameNode(workspaceFolder: URI, from: string, to: string, kind: BaseHalfBadgeKind, lease?: IBaseHalfWorkspaceMutationLease): Promise<void>;
	/** Atomically retire the destination identity and relocate the incoming
	 * source graph. Case-only moves use one physical badge snapshot. */
	replaceNodeIdentity(
		workspaceFolder: URI,
		from: string,
		to: string,
		options: IBaseHalfBadgeIdentityReplacementOptions,
		lease?: IBaseHalfWorkspaceMutationLease
	): Promise<void>;
	/** A node was deleted in-app: remove its badge (folder: plus descendants)
	 *  and scrub its backlinks off every outbound target. Dangling INBOUND
	 *  references (a referrer still pointing at the deleted path) are left in
	 *  place — they are the referrer's authored content and derived edges simply
	 *  stop drawing them. */
	deleteNode(workspaceFolder: URI, path: string, kind: BaseHalfBadgeKind, lease?: IBaseHalfWorkspaceMutationLease): Promise<void>;
	/** A move is replacing the identity already owned by its destination path.
	 * Retire its authored fields/outbound edges, but preserve the inbound
	 * backlink stub because those references are authored by other nodes and
	 * still canonically point at the destination path. */
	retireReplacedNode(workspaceFolder: URI, path: string, kind: BaseHalfBadgeKind, lease?: IBaseHalfWorkspaceMutationLease): Promise<void>;
}

export class BaseHalfBadgeGraphService implements IBaseHalfBadgeGraphService {
	declare readonly _serviceBrand: undefined;
	private readonly workspaceMutex = createKeyedMutex();

	constructor(
		@IBaseHalfBadgeMirrorService private readonly badgeMirrorService: IBaseHalfBadgeMirrorService,
		@IFileService private readonly fileService: IFileService,
		@IBaseHalfWorkspaceMutationCoordinator private readonly workspaceMutationCoordinator: IBaseHalfWorkspaceMutationCoordinator
	) { }

	private runWorkspaceMutation<T>(workspaceFolder: URI, lease: IBaseHalfWorkspaceMutationLease | undefined, task: () => Promise<T>): Promise<T> {
		if (lease) {
			this.workspaceMutationCoordinator.assertLease(lease, workspaceFolder);
			return this.workspaceMutex.runExclusive(workspaceFolder.toString(), task);
		}
		return this.workspaceMutationCoordinator.runExclusive(workspaceFolder, () =>
			this.workspaceMutex.runExclusive(workspaceFolder.toString(), task)
		);
	}

	updateDescription(node: IBaseHalfBadgeNode, description: string, lease?: IBaseHalfWorkspaceMutationLease): Promise<IBaseHalfBadgeFile | null> {
		const trimmed = description.trim();
		return this.runWorkspaceMutation(node.workspaceFolder, lease, () =>
			this.badgeMirrorService.patchBadge(node, current => {
				if (current === null && !trimmed) {
					return null;
				}

				const base = current ?? emptyBadge(node.relativePath, node.kind);
				return pruneEmpty({
					...base,
					...(trimmed ? { description: trimmed } : { description: undefined })
				});
			})
		);
	}

	addReference(source: IBaseHalfBadgeNode, target: IBaseHalfBadgeNode, lease?: IBaseHalfWorkspaceMutationLease): Promise<void> {
		if (source.relativePath === target.relativePath) {
			throw new Error(`A badge cannot reference itself: ${source.relativePath}`);
		}

		this.assertOneWorkspace([source, target]);
		return this.runWorkspaceMutation(source.workspaceFolder, lease, async () => {
			await this.transactBadges([source, target], source.relativePath, current => {
				const sourceBadge = current.get(source.relativePath) ?? emptyBadge(source.relativePath, source.kind);
				const targetBadge = current.get(target.relativePath) ?? emptyBadge(target.relativePath, target.kind);
				return {
					result: undefined,
					updates: new Map([
						[source.relativePath, { ...sourceBadge, references: appendUnique(sourceBadge.references, target.relativePath) }],
						[target.relativePath, { ...targetBadge, referenced_by: appendUnique(targetBadge.referenced_by, source.relativePath) }]
					])
				};
			});
		});
	}

	removeReference(source: IBaseHalfBadgeNode, target: IBaseHalfBadgeNode, lease?: IBaseHalfWorkspaceMutationLease): Promise<boolean> {
		this.assertOneWorkspace([source, target]);
		return this.runWorkspaceMutation(source.workspaceFolder, lease, async () => {
			return this.transactBadges([source, target], source.relativePath, current => {
				const sourceBadge = current.get(source.relativePath) ?? null;
				const targetBadge = current.get(target.relativePath) ?? null;
				return {
					result: sourceBadge?.references.includes(target.relativePath) ?? false,
					updates: new Map([
						[source.relativePath, sourceBadge ? pruneEmpty({ ...sourceBadge, references: sourceBadge.references.filter(candidate => candidate !== target.relativePath) }) : null],
						[target.relativePath, targetBadge ? pruneEmpty({ ...targetBadge, referenced_by: targetBadge.referenced_by.filter(candidate => candidate !== source.relativePath) }) : null]
					])
				};
			});
		});
	}

	reconnectReference(
		previousSource: IBaseHalfBadgeNode,
		previousTarget: IBaseHalfBadgeNode,
		nextSource: IBaseHalfBadgeNode,
		nextTarget: IBaseHalfBadgeNode,
		lease?: IBaseHalfWorkspaceMutationLease
	): Promise<BaseHalfReferenceReconnectResult> {
		if (nextSource.relativePath === nextTarget.relativePath) {
			throw new Error(`A badge cannot reference itself: ${nextSource.relativePath}`);
		}
		const nodes = [previousSource, previousTarget, nextSource, nextTarget];
		this.assertOneWorkspace(nodes);
		return this.runWorkspaceMutation(previousSource.workspaceFolder, lease, async () => {
			const sameEdge = previousSource.relativePath === nextSource.relativePath && previousTarget.relativePath === nextTarget.relativePath;
			if (sameEdge) {
				return 'already-connected';
			}
			return this.transactBadges(nodes, previousSource.relativePath, current => {
				const previousBadge = current.get(previousSource.relativePath) ?? null;
				const nextBadge = current.get(nextSource.relativePath) ?? null;
				const previousExists = previousBadge?.references.includes(previousTarget.relativePath) ?? false;
				const nextExists = nextBadge?.references.includes(nextTarget.relativePath) ?? false;
				if (!previousExists && nextExists) {
					// A prior optimistic reconnect failed but the desired canonical pair
					// already exists. Preserve its unrelated style; the scene refresh will
					// roll the optimistic overlay back to the canonical snapshot.
					return { result: 'already-connected' as const, updates: new Map() };
				}
				if (!previousExists) {
					throw new Error(`Cannot reconnect a stale reference: ${previousSource.relativePath} no longer references ${previousTarget.relativePath}.`);
				}
				if (nextExists) {
					throw new Error(`Cannot reconnect onto an existing reference: ${nextSource.relativePath} already references ${nextTarget.relativePath}.`);
				}

				const updates = new Map<string, IBaseHalfBadgeFile | null>();
				for (const path of new Set(nodes.map(node => node.relativePath))) {
					let next = current.get(path) ?? null;
					if (path === previousSource.relativePath && next) {
						next = pruneEmpty({ ...next, references: next.references.filter(candidate => candidate !== previousTarget.relativePath) });
					}
					if (path === previousTarget.relativePath && next) {
						next = pruneEmpty({ ...next, referenced_by: next.referenced_by.filter(candidate => candidate !== previousSource.relativePath) });
					}
					if (path === nextSource.relativePath) {
						const base = next ?? emptyBadge(nextSource.relativePath, nextSource.kind);
						next = { ...base, references: appendUnique(base.references, nextTarget.relativePath) };
					}
					if (path === nextTarget.relativePath) {
						const base = next ?? emptyBadge(nextTarget.relativePath, nextTarget.kind);
						next = { ...base, referenced_by: appendUnique(base.referenced_by, nextSource.relativePath) };
					}
					updates.set(path, next);
				}
				return { result: 'replaced' as const, updates };
			});
		});
	}

	runWithReference<T>(source: IBaseHalfBadgeNode, target: IBaseHalfBadgeNode, task: () => Promise<T>, lease?: IBaseHalfWorkspaceMutationLease): Promise<T> {
		this.assertOneWorkspace([source, target]);
		return this.runWorkspaceMutation(source.workspaceFolder, lease, async () => {
			const current = await this.badgeMirrorService.readBadge(source);
			if (!current?.references.includes(target.relativePath)) {
				throw new Error(`The reference ${source.relativePath} → ${target.relativePath} no longer exists.`);
			}
			return task();
		});
	}

	private assertOneWorkspace(nodes: readonly IBaseHalfBadgeNode[]): void {
		const workspace = nodes[0]?.workspaceFolder.toString();
		if (workspace === undefined || nodes.some(node => node.workspaceFolder.toString() !== workspace)) {
			throw new Error('A badge reference transaction cannot cross workspaces.');
		}
	}

	/** Apply a graph mutation from one set of exact-byte snapshots. The semantic
	 * owner commits last: if any earlier file or the owner itself conflicts, all
	 * already-written files are conditionally restored before the WHOLE graph
	 * plan is recomputed from latest snapshots. */
	private transactBadges<T>(
		nodes: readonly IBaseHalfBadgeNode[],
		commitLastPath: string,
		prepare: (current: ReadonlyMap<string, IBaseHalfBadgeFile | null>) => {
			readonly result: T;
			readonly updates: ReadonlyMap<string, IBaseHalfBadgeFile | null>;
		}
	): Promise<T> {
		const nodeByPath = new Map<string, IBaseHalfBadgeNode>();
		for (const node of nodes) {
			nodeByPath.set(node.relativePath, node);
		}
		return this.runBadgeTransaction(async () => {
			const snapshots = await this.readBadgeSnapshots(nodeByPath);
			const current = new Map<string, IBaseHalfBadgeFile | null>();
			for (const [path, snapshot] of snapshots) {
				current.set(path, snapshot.badge);
			}
			const mutation = prepare(current);
			const order = [...nodeByPath.keys()].filter(path => path !== commitLastPath);
			if (nodeByPath.has(commitLastPath)) {
				order.push(commitLastPath);
			}
				return {
					result: mutation.result,
					steps: this.transactionSteps(order, nodeByPath, snapshots, mutation.updates),
					observations: this.transactionObservations(nodeByPath, snapshots)
				};
		});
	}

	private async runBadgeTransaction<T>(prepare: () => Promise<IBaseHalfBadgeTransactionPlan<T>>): Promise<T> {
		for (let attempt = 0; attempt < BADGE_GRAPH_TRANSACTION_MAX_ATTEMPTS; attempt++) {
			const plan = await prepare();
			const committed: IBaseHalfCommittedBadgeStep[] = [];
			const committedByPath = new Map<string, IBaseHalfCommittedBadgeStep>();
			try {
				for (const step of plan.steps) {
					if (badgeEquals(step.before.badge, step.after)) {
						continue;
					}
					const written = await this.badgeMirrorService.commitBadgeSnapshot(step.node, step.before, step.after, {
						allowKindChange: step.allowKindChange
					});
					const committedStep = { ...step, written };
					committed.push(committedStep);
					committedByPath.set(step.node.relativePath, committedStep);
				}
				// Validate the whole read set, not only files we wrote. A semantic-equal
				// skipped owner or an absent phantom referrer can change after planning
				// just as destructively as an early committed destination.
				const observations = plan.observations ?? plan.steps.map(step => ({ node: step.node, before: step.before }));
				for (const observation of observations) {
					const written = committedByPath.get(observation.node.relativePath)?.written;
					await this.badgeMirrorService.assertBadgeSnapshotCurrent(observation.node, written ?? observation.before);
				}
				return plan.result;
			} catch (error) {
				const rollbackErrors: unknown[] = [];
				for (const step of committed.reverse()) {
					try {
						await this.badgeMirrorService.restoreBadgeSnapshot(step.node, step.written, step.before);
					} catch (rollbackError) {
						rollbackErrors.push(rollbackError);
					}
				}
				if (rollbackErrors.length > 0) {
					throw new AggregateError([error, ...rollbackErrors], 'Badge graph mutation and conditional compensation both failed');
				}
				if (isBadgeGraphConflict(error) && attempt < BADGE_GRAPH_TRANSACTION_MAX_ATTEMPTS - 1) {
					continue;
				}
				throw error;
			}
		}
		throw new Error(`Unable to commit badge graph after ${BADGE_GRAPH_TRANSACTION_MAX_ATTEMPTS} attempts`);
	}

	private async readBadgeSnapshots(nodes: ReadonlyMap<string, IBaseHalfBadgeNode>): Promise<Map<string, IBaseHalfBadgeSnapshot>> {
		const snapshots = new Map<string, IBaseHalfBadgeSnapshot>();
		for (const [path, node] of nodes) {
			snapshots.set(path, await this.badgeMirrorService.readBadgeSnapshot(node));
		}
		return snapshots;
	}

	private transactionSteps(
		order: readonly string[],
		nodes: ReadonlyMap<string, IBaseHalfBadgeNode>,
		snapshots: ReadonlyMap<string, IBaseHalfBadgeSnapshot>,
		updates: ReadonlyMap<string, IBaseHalfBadgeFile | null>,
		allowKindChangePaths: ReadonlySet<string> = new Set()
	): IBaseHalfBadgeTransactionStep[] {
		const steps: IBaseHalfBadgeTransactionStep[] = [];
		const uniqueOrder: string[] = [];
		for (const path of order) {
			if (!updates.has(path)) {
				continue;
			}
			const previous = uniqueOrder.indexOf(path);
			if (previous !== -1) {
				uniqueOrder.splice(previous, 1);
			}
			uniqueOrder.push(path);
		}
		for (const path of uniqueOrder) {
			steps.push({
					node: nodes.get(path)!,
					before: snapshots.get(path)!,
					after: updates.get(path) ?? null,
					allowKindChange: allowKindChangePaths.has(path)
				});
		}
		return steps;
	}

	private transactionObservations(
		nodes: ReadonlyMap<string, IBaseHalfBadgeNode>,
		snapshots: ReadonlyMap<string, IBaseHalfBadgeSnapshot>
	): Array<Pick<IBaseHalfBadgeTransactionStep, 'node' | 'before'>> {
		return [...nodes].map(([path, node]) => ({ node, before: snapshots.get(path)! }));
	}

	readBadge(node: IBaseHalfBadgeNode): Promise<IBaseHalfBadgeFile | null> {
		return this.badgeMirrorService.readBadge(node);
	}

	listBadges(workspaceFolder: URI): Promise<IBaseHalfBadgeReadResult> {
		return this.badgeMirrorService.listBadges(workspaceFolder);
	}

	async markOrphan(node: IBaseHalfBadgeNode, lease?: IBaseHalfWorkspaceMutationLease): Promise<void> {
		await this.runWorkspaceMutation(node.workspaceFolder, lease, () =>
			this.badgeMirrorService.patchBadge(node, current => current === null ? null : { ...current, orphan: true })
		);
	}

	async clearOrphan(node: IBaseHalfBadgeNode, lease?: IBaseHalfWorkspaceMutationLease): Promise<void> {
		await this.runWorkspaceMutation(node.workspaceFolder, lease, () =>
			this.badgeMirrorService.patchBadge(node, current => {
				if (current === null || current.orphan !== true) {
					return current;
				}

				const { orphan: _orphan, ...rest } = current;
				// A stub that existed only to carry the orphan flag dies with it.
				return pruneEmpty(rest);
			})
		);
	}

	pruneDangling(workspaceFolder: URI, lease?: IBaseHalfWorkspaceMutationLease): Promise<string[]> {
		return this.runWorkspaceMutation(workspaceFolder, lease, async () => {
			const { badges } = await this.badgeMirrorService.listBadges(workspaceFolder);
			const orphaned: string[] = [];
			for (const badge of badges.values()) {
				if (badge.orphan === true || await this.diskTargetExists(workspaceFolder, badge.path, badge.kind)) {
					continue;
				}
				await this.badgeMirrorService.patchBadge(
					this.node(workspaceFolder, badge.path, badge.kind),
					current => current === null ? null : { ...current, orphan: true }
				);
				orphaned.push(badge.path);
			}
			return orphaned;
		});
	}

	renameNode(workspaceFolder: URI, from: string, to: string, kind: BaseHalfBadgeKind, lease?: IBaseHalfWorkspaceMutationLease): Promise<void> {
		return this.replaceNodeIdentity(workspaceFolder, from, to, { incomingKind: kind }, lease);
	}

	replaceNodeIdentity(
		workspaceFolder: URI,
		from: string,
		to: string,
		options: IBaseHalfBadgeIdentityReplacementOptions,
		lease?: IBaseHalfWorkspaceMutationLease
	): Promise<void> {
		if (from === to) {
			return Promise.resolve();
		}
		if (options.incomingKind === 'folder' && baseHalfIsMirrorSubtree(to, from)) {
			// Physically impossible on disk (fs rejects moving a folder into
			// itself); refuse defensively rather than corrupt the graph.
			throw new Error(`Cannot move "${from}" into its own subtree "${to}"`);
		}

		return this.runWorkspaceMutation(workspaceFolder, lease, async () => {
			const entries = await baseHalfWalkMirror(this.fileService, workspaceFolder, 'badge.yaml');
			if (options.sameResourceIdentity) {
				// The mirror directory has already received its case-only physical
				// rename. Walk actual `to` casing without parsing old-path YAML, then
				// address that same physical file through its old logical identity.
				const actualTargets = entries
					.map(entry => entry.relativePath)
					.filter(path => options.incomingKind === 'folder' ? baseHalfIsMirrorSubtree(path, to) : path === to)
					.sort(compareMirrorPathDepth);
				await this.moveSameResourceSubtreeAndCascade(
					workspaceFolder,
					new Map(actualTargets.map(actualTarget => [baseHalfRemapSubtreeRel(actualTarget, to, from), actualTarget])),
					from,
					options.incomingKind
				);
				return;
			}

			await this.moveBadgeSubtreeAndCascade(workspaceFolder, from, to, options, entries.map(entry => entry.relativePath));
		});
	}

	/**
	 * Plan an ordinary file/folder identity replacement as ONE badge transaction.
	 *
	 * The previous implementation committed the root, every annotated descendant,
	 * and every destination-only retirement through separate transactions. A hard
	 * failure half way through therefore left a graph whose paths described both
	 * the pre- and post-move trees. Here we replay the exact same per-node semantic
	 * transition against an in-memory graph, then commit the combined final state
	 * with the existing exact-byte compensation machinery.
	 */
	private async moveBadgeSubtreeAndCascade(
		workspaceFolder: URI,
		from: string,
		to: string,
		options: IBaseHalfBadgeIdentityReplacementOptions,
		allPaths: readonly string[]
	): Promise<void> {
		const incomingPaths = [
			from,
			...(options.incomingKind === 'folder'
				? allPaths.filter(path => path !== from && baseHalfIsMirrorSubtree(path, from)).sort(compareMirrorPathDepth)
				: [])
		];
		const mappedTargets = new Set(incomingPaths.map(path => baseHalfRemapSubtreeRel(path, from, to)));
		// Destination disk state is not proof that the sparse mirror subtree is
		// empty: an absent target may still own orphan metadata from an earlier
		// delete. Any ordinary identity replacement retires destination-only
		// owners; mapped incoming owners are handled by the merge loop below.
		const targetOnlyPaths = allPaths
			.filter(path => baseHalfIsMirrorSubtree(path, to) && !mappedTargets.has(path))
			.sort(compareMirrorPathDepth);
		const anchors = uniqueStrings([
			...incomingPaths,
			...mappedTargets,
			...targetOnlyPaths
		]);

		await this.runBadgeTransaction(async () => {
			const discovered = await this.discoverBadgeBatchNeighborhood(workspaceFolder, anchors);
			const current = new Map<string, IBaseHalfBadgeFile | null>();
			const storedKinds = new Map<string, BaseHalfBadgeKind>();
			const materialized = new Set<string>();
			for (const [path, snapshot] of discovered.snapshots) {
				current.set(path, snapshot.badge);
				if (snapshot.storedKind) {
					storedKinds.set(path, snapshot.storedKind);
				}
				if (snapshot.materialized) {
					materialized.add(path);
				}
			}

			const updates = new Map<string, IBaseHalfBadgeFile | null>();
			const allowKindChange = new Set<string>();
			const order: string[] = [];
			const write = (path: string, value: IBaseHalfBadgeFile | null, options: { readonly changeKind?: BaseHalfBadgeKind } = {}): void => {
				updates.set(path, value);
				// A committed canonical-empty object reads back as logical null. Keep
				// the simulation aligned with the next formerly-separate transaction.
				current.set(path, value === null ? null : pruneEmpty(value));
				if (value !== null || materialized.has(path)) {
					materialized.add(path);
				}
				if (options.changeKind) {
					storedKinds.set(path, options.changeKind);
					allowKindChange.add(path);
				}
				order.push(path);
			};

			for (const sourcePath of incomingPaths) {
				const targetPath = baseHalfRemapSubtreeRel(sourcePath, from, to);
				const source = current.get(sourcePath) ?? null;
				const collision = current.get(targetPath) ?? null;
				if (source === null && collision === null && !materialized.has(sourcePath) && !materialized.has(targetPath)) {
					continue;
				}

				const resolvedIncomingKind = sourcePath === from
					? options.incomingKind
					: source?.kind ?? storedKinds.get(sourcePath) ?? 'file';
				const incomingTargets = uniqueStrings((source?.references ?? []).filter(target => target !== sourcePath && target !== targetPath));
				const retiredTargets = uniqueStrings((collision?.references ?? []).filter(target => target !== sourcePath && target !== targetPath));
				const affectedTargets = uniqueStrings([...incomingTargets, ...retiredTargets]);
				const sourceBacklinks = (source?.referenced_by ?? []).filter(referrer => referrer !== sourcePath && referrer !== targetPath);
				const inheritedBacklinks = (collision?.referenced_by ?? []).filter(referrer =>
					!sourceBacklinks.includes(referrer) && referrer !== sourcePath && referrer !== targetPath
				);
				const liveReferrers = uniqueStrings([...sourceBacklinks, ...inheritedBacklinks]).filter(referrer =>
					(current.get(referrer) ?? null) !== null
				);
				const { orphan: _orphan, ...rest } = source ?? emptyBadge(sourcePath, resolvedIncomingKind);
				const moved: IBaseHalfBadgeFile = {
					...rest,
					path: targetPath,
					kind: resolvedIncomingKind,
					references: incomingTargets,
					referenced_by: liveReferrers
				};

				for (const target of affectedTargets) {
					const targetBadge = current.get(target) ?? null;
					if (targetBadge) {
						write(target, {
							...targetBadge,
							referenced_by: remapOwnedBacklinks(targetBadge.referenced_by, sourcePath, targetPath, incomingTargets.includes(target))
						});
					}
				}
				for (const referrer of liveReferrers) {
					const referrerBadge = current.get(referrer) ?? null;
					if (referrerBadge) {
						write(referrer, {
							...referrerBadge,
							references: uniqueStrings(referrerBadge.references.map(candidate => candidate === sourcePath ? targetPath : candidate))
						});
					}
				}
				write(targetPath, moved, { changeKind: resolvedIncomingKind });
				if (source !== null) {
					write(sourcePath, null);
				}
			}

			for (const path of targetOnlyPaths) {
				const existing = current.get(path) ?? null;
				if (!existing) {
					continue;
				}
				const targets = existing.references.filter(target => target !== path);
				for (const target of targets) {
					const targetBadge = current.get(target) ?? null;
					if (targetBadge) {
						write(target, pruneEmpty({
							...targetBadge,
							referenced_by: targetBadge.referenced_by.filter(candidate => candidate !== path)
						}));
					}
				}
				write(path, pruneEmpty({
					...emptyBadge(path, existing.kind),
					referenced_by: existing.referenced_by.filter(referrer => referrer !== path)
				}));
			}

			return {
				result: undefined,
				steps: this.transactionSteps(order, discovered.nodes, discovered.snapshots, updates, allowKindChange),
				observations: this.transactionObservations(discovered.nodes, discovered.snapshots)
			};
		});
	}

	deleteNode(workspaceFolder: URI, path: string, kind: BaseHalfBadgeKind, lease?: IBaseHalfWorkspaceMutationLease): Promise<void> {
		return this.runWorkspaceMutation(workspaceFolder, lease, async () => {
			await this.purgeBadge(workspaceFolder, path);

			if (kind === 'folder') {
				const { badges } = await this.badgeMirrorService.listBadges(workspaceFolder);
				const prefix = `${path}/`;
				for (const badge of badges.values()) {
					if (badge.path.startsWith(prefix)) {
						await this.purgeBadge(workspaceFolder, badge.path);
					}
				}
			}
		});
	}

	retireReplacedNode(workspaceFolder: URI, path: string, kind: BaseHalfBadgeKind, lease?: IBaseHalfWorkspaceMutationLease): Promise<void> {
		return this.runWorkspaceMutation(workspaceFolder, lease, async () => {
			await this.retireReplacedBadge(workspaceFolder, path);
			if (kind === 'folder') {
				const { badges } = await this.badgeMirrorService.listBadges(workspaceFolder);
				const prefix = `${path}/`;
				for (const badge of badges.values()) {
					if (badge.path.startsWith(prefix)) {
						await this.retireReplacedBadge(workspaceFolder, badge.path);
					}
				}
			}
		});
	}

	/** Rewrite a case-only subtree from one exact snapshot PER physical badge.
	 * Every owner is read before any YAML path changes, so intra-subtree edges
	 * never attempt to parse a neighbour that has already adopted target case. */
	private async moveSameResourceSubtreeAndCascade(
		workspaceFolder: URI,
		identityMap: ReadonlyMap<string, string>,
		rootSource: string,
		rootKind: BaseHalfBadgeKind
	): Promise<void> {
		if (identityMap.size === 0) {
			return;
		}
		await this.runBadgeTransaction(async () => {
			const discovered = await this.discoverSameResourceSubtreeNeighborhood(workspaceFolder, identityMap);
			const inverseIdentityMap = new Map([...identityMap].map(([source, target]) => [target, source]));
			const updates = new Map<string, IBaseHalfBadgeFile | null>();
			for (const [path, snapshot] of discovered.snapshots) {
				if (identityMap.has(path)) {
					continue;
				}
				const current = snapshot.badge;
				if (current) {
					updates.set(path, {
						...current,
						references: uniqueStrings(current.references.map(candidate => identityMap.get(candidate) ?? candidate)),
						referenced_by: uniqueStrings(current.referenced_by.map(candidate => identityMap.get(candidate) ?? candidate))
					});
				}
			}

			for (const [sourcePath, targetPath] of identityMap) {
				const snapshot = discovered.snapshots.get(sourcePath)!;
				const source = snapshot.badge;
				if (source === null && !snapshot.materialized) {
					continue;
				}
				const kind = sourcePath === rootSource ? rootKind : source?.kind ?? snapshot.storedKind ?? 'file';
				const { orphan: _orphan, ...rest } = source ?? emptyBadge(sourcePath, kind);
				const references = uniqueStrings(rest.references.map(candidate => identityMap.get(candidate) ?? candidate))
					.filter(candidate => candidate !== targetPath);
				const referencedBy = uniqueStrings(rest.referenced_by.map(candidate => identityMap.get(candidate) ?? candidate))
					.filter(candidate => candidate !== targetPath)
					.filter(candidate => {
						const snapshotPath = inverseIdentityMap.get(candidate) ?? candidate;
						return (discovered.snapshots.get(snapshotPath)?.badge ?? null) !== null;
					});
				updates.set(sourcePath, {
					...rest,
					path: targetPath,
					kind,
					references,
					referenced_by: referencedBy
				});
			}

			const ownerPaths = [...identityMap.keys()].sort(compareMirrorPathDepth);
			const externalPaths = [...discovered.nodes.keys()].filter(path => !identityMap.has(path));
			return {
				result: undefined,
				steps: this.transactionSteps(
					[...externalPaths, ...ownerPaths],
					discovered.nodes,
					discovered.snapshots,
					updates,
					new Set(ownerPaths)
				),
				observations: this.transactionObservations(discovered.nodes, discovered.snapshots)
			};
		});
	}

	/** Delete ONE badge and scrub its backlinks off its outbound targets. Runs
	 *  under the workspace mutex (callers hold it). */
	private async purgeBadge(workspaceFolder: URI, path: string): Promise<void> {
		await this.runBadgeTransaction(async () => {
			const discovered = await this.discoverBadgeNeighborhood(workspaceFolder, path);
			const existing = discovered.snapshots.get(path)!.badge;
			if (existing === null) {
				return {
					result: undefined,
					steps: [],
					observations: this.transactionObservations(discovered.nodes, discovered.snapshots)
				};
			}
			const updates = new Map<string, IBaseHalfBadgeFile | null>();
			for (const target of existing.references) {
				const current = discovered.snapshots.get(target)?.badge ?? null;
				if (current) {
					updates.set(target, pruneEmpty({
						...current,
						referenced_by: current.referenced_by.filter(candidate => candidate !== path)
					}));
				}
			}
			updates.set(path, null);
			return {
				result: undefined,
				steps: this.transactionSteps([...existing.references, path], discovered.nodes, discovered.snapshots, updates),
				observations: this.transactionObservations(discovered.nodes, discovered.snapshots)
			};
		});
	}

	/** Retire only facts owned by the replaced node. `referenced_by` mirrors
	 * other badges' authored outbound references, so keep it as a sparse stub
	 * for the incoming identity to merge. */
	private async retireReplacedBadge(workspaceFolder: URI, path: string): Promise<void> {
		await this.runBadgeTransaction(async () => {
			const discovered = await this.discoverBadgeNeighborhood(workspaceFolder, path);
			const existing = discovered.snapshots.get(path)!.badge;
			if (existing === null) {
				return {
					result: undefined,
					steps: [],
					observations: this.transactionObservations(discovered.nodes, discovered.snapshots)
				};
			}
			const targets = existing.references.filter(target => target !== path);
			const updates = new Map<string, IBaseHalfBadgeFile | null>();
			for (const target of targets) {
				const current = discovered.snapshots.get(target)?.badge ?? null;
				if (current) {
					updates.set(target, pruneEmpty({
						...current,
						referenced_by: current.referenced_by.filter(candidate => candidate !== path)
					}));
				}
			}
			updates.set(path, pruneEmpty({
				...emptyBadge(path, existing.kind),
				referenced_by: existing.referenced_by.filter(referrer => referrer !== path)
			}));
			return {
				result: undefined,
				steps: this.transactionSteps([...targets, path], discovered.nodes, discovered.snapshots, updates),
				observations: this.transactionObservations(discovered.nodes, discovered.snapshots)
			};
		});
	}

	/** Discover the variable neighbourhood from fresh exact snapshots. The
	 * anchor is re-read together with every newly discovered neighbour, so a
	 * source edit during discovery either expands this round or conflicts at the
	 * owner-last commit; a stale outer read never becomes a constant patch. */
	private async discoverBadgeNeighborhood(
		workspaceFolder: URI,
		path: string,
		destination?: string
	): Promise<{
		readonly nodes: ReadonlyMap<string, IBaseHalfBadgeNode>;
		readonly snapshots: ReadonlyMap<string, IBaseHalfBadgeSnapshot>;
	}> {
		let paths = new Set<string>(destination === undefined ? [path] : [path, destination]);
		for (let attempt = 0; attempt < BADGE_GRAPH_DISCOVERY_MAX_ATTEMPTS; attempt++) {
			const nodes = new Map<string, IBaseHalfBadgeNode>();
			for (const candidate of paths) {
				nodes.set(candidate, this.node(workspaceFolder, candidate, 'file'));
			}
			const snapshots = await this.readBadgeSnapshots(nodes);
			const source = snapshots.get(path)!.badge;
			const collision = destination === undefined ? null : snapshots.get(destination)!.badge;
			const required = new Set<string>(destination === undefined ? [path] : [path, destination]);
			for (const target of source?.references ?? []) {
				required.add(target);
			}
			if (destination !== undefined) {
				for (const target of collision?.references ?? []) {
					required.add(target);
				}
				for (const referrer of source?.referenced_by ?? []) {
					required.add(referrer);
				}
				for (const referrer of collision?.referenced_by ?? []) {
					required.add(referrer);
				}
			}

			if ([...required].every(candidate => paths.has(candidate))) {
				return { nodes, snapshots };
			}
			paths = required;
		}
		throw new Error(`Badge graph neighbourhood for ${path} changed too frequently to update safely`);
	}

	/** Read every structural owner plus the one-hop neighbours its move can
	 * rewrite. Neighbour badges are not recursively expanded: their outbound
	 * graph is not authored by this structural operation. The owner snapshots are
	 * nevertheless re-read with the expanded set, so an owner that changes its
	 * neighbourhood during discovery forces another complete plan. */
	private async discoverBadgeBatchNeighborhood(
		workspaceFolder: URI,
		anchors: readonly string[]
	): Promise<{
		readonly nodes: ReadonlyMap<string, IBaseHalfBadgeNode>;
		readonly snapshots: ReadonlyMap<string, IBaseHalfBadgeSnapshot>;
	}> {
		let paths = new Set(anchors);
		for (let attempt = 0; attempt < BADGE_GRAPH_DISCOVERY_MAX_ATTEMPTS; attempt++) {
			const nodes = new Map<string, IBaseHalfBadgeNode>();
			for (const path of paths) {
				nodes.set(path, this.node(workspaceFolder, path, 'file'));
			}
			const snapshots = await this.readBadgeSnapshots(nodes);
			const required = new Set(anchors);
			for (const anchor of anchors) {
				const badge = snapshots.get(anchor)?.badge ?? null;
				for (const target of badge?.references ?? []) {
					required.add(target);
				}
				for (const referrer of badge?.referenced_by ?? []) {
					required.add(referrer);
				}
			}
			if ([...required].every(path => paths.has(path))) {
				return { nodes, snapshots };
			}
			paths = required;
		}
		throw new Error('Badge structural batch neighbourhood changed too frequently to update safely');
	}

	private async discoverSameResourceSubtreeNeighborhood(
		workspaceFolder: URI,
		identityMap: ReadonlyMap<string, string>
	): Promise<{
		readonly nodes: ReadonlyMap<string, IBaseHalfBadgeNode>;
		readonly snapshots: ReadonlyMap<string, IBaseHalfBadgeSnapshot>;
	}> {
		const inverseIdentityMap = new Map([...identityMap].map(([source, target]) => [target, source]));
		let paths = new Set<string>(identityMap.keys());
		for (let attempt = 0; attempt < BADGE_GRAPH_DISCOVERY_MAX_ATTEMPTS; attempt++) {
			const nodes = new Map<string, IBaseHalfBadgeNode>();
			for (const path of paths) {
				nodes.set(path, this.node(workspaceFolder, path, 'file'));
			}
			const snapshots = await this.readBadgeSnapshots(nodes);
			const required = new Set<string>(identityMap.keys());
			for (const owner of identityMap.keys()) {
				const source = snapshots.get(owner)!.badge;
				for (const target of source?.references ?? []) {
					required.add(inverseIdentityMap.get(target) ?? target);
				}
				for (const referrer of source?.referenced_by ?? []) {
					required.add(inverseIdentityMap.get(referrer) ?? referrer);
				}
			}
			if ([...required].every(path => paths.has(path))) {
				return { nodes, snapshots };
			}
			paths = required;
		}
		throw new Error('Case-only badge graph subtree changed too frequently to update safely');
	}

	private async diskTargetExists(workspaceFolder: URI, relativePath: string, kind: BaseHalfBadgeKind): Promise<boolean> {
		try {
			const stat = await this.fileService.stat(URI.joinPath(workspaceFolder, ...baseHalfMirrorPathSegments(relativePath)));
			return kind === 'folder' ? stat.isDirectory : stat.isFile;
		} catch {
			return false;
		}
	}

	private node(workspaceFolder: URI, relativePath: string, kind: BaseHalfBadgeKind): IBaseHalfBadgeNode {
		return {
			resource: URI.joinPath(workspaceFolder, ...baseHalfMirrorPathSegments(relativePath)),
			workspaceFolder,
			relativePath,
			kind
		};
	}
}

function emptyBadge(relativePath: string, kind: BaseHalfBadgeKind): IBaseHalfBadgeFile {
	return {
		path: relativePath,
		kind,
		references: [],
		referenced_by: []
	};
}

/** A badge with no human-authored content and no graph edges is logically
 *  absent — return null so patchBadge commits or retains its empty tombstone. */
function pruneEmpty(badge: IBaseHalfBadgeFile): IBaseHalfBadgeFile | null {
	const empty = !badge.description
		&& badge.references.length === 0
		&& badge.referenced_by.length === 0
		&& badge.orphan !== true;
	return empty ? null : badge;
}

function appendUnique(values: readonly string[], value: string): string[] {
	return [...values.filter(candidate => candidate !== value), value];
}

function uniqueStrings(values: readonly string[]): string[] {
	return [...new Set(values)];
}

function remapOwnedBacklinks(values: readonly string[], from: string, to: string, retainDestination: boolean): string[] {
	const out: string[] = [];
	for (const value of values) {
		if (value === from || value === to) {
			if (retainDestination && !out.includes(to)) {
				out.push(to);
			}
		} else if (!out.includes(value)) {
			out.push(value);
		}
	}
	if (retainDestination && !out.includes(to)) {
		out.push(to);
	}
	return out;
}

function compareMirrorPathDepth(left: string, right: string): number {
	return left.split('/').length - right.split('/').length || left.localeCompare(right);
}

function badgeEquals(left: IBaseHalfBadgeFile | null, right: IBaseHalfBadgeFile | null): boolean {
	return left === right || (
		left !== null
		&& right !== null
		&& left.path === right.path
		&& left.kind === right.kind
		&& left.description === right.description
		&& left.orphan === right.orphan
		&& arrayEquals(left.references, right.references)
		&& arrayEquals(left.referenced_by, right.referenced_by)
	);
}

function arrayEquals(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isBadgeGraphConflict(error: unknown): boolean {
	return error instanceof FileOperationError && (
		error.fileOperationResult === FileOperationResult.FILE_MODIFIED_SINCE
		|| error.fileOperationResult === FileOperationResult.FILE_MOVE_CONFLICT
		|| error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND
	);
}

registerSingleton(IBaseHalfBadgeGraphService, BaseHalfBadgeGraphService, InstantiationType.Delayed);
