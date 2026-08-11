/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../base/common/buffer.js';
import { dirname } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { parse as parseYaml, YamlNode, YamlParseError, YamlScalarNode } from '../../../base/common/yaml.js';
import { FileOperationError, FileOperationResult, IFileService } from '../../../platform/files/common/files.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import {
	IBaseHalfCanvasCard,
	IBaseHalfCanvasEdge,
	IBaseHalfCanvasFile,
	IBaseHalfCanvasSize
} from './basehalfCanvasModel.js';
import { IBaseHalfCanvasFolderState } from './basehalfCanvasNavigation.js';
import { createKeyedMutex } from './basehalfKeyedMutex.js';
import { baseHalfCommitMirrorFile } from './basehalfMirrorFileCommit.js';
import { baseHalfAssertMirrorPathComponentsNotSymbolicLink, baseHalfIsMirrorSubtree, baseHalfMirrorPathSegments, baseHalfRemapSubtreeRel, baseHalfWalkMirror } from './basehalfMirrorTree.js';
import { IBaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceMutationLease } from './basehalfWorkspaceMutation.js';

export const IBaseHalfCanvasMirrorService = createDecorator<IBaseHalfCanvasMirrorService>('baseHalfCanvasMirrorService');

const CANVAS_YAML_MAX_BYTES = 512 * 1024;
const CANVAS_PATCH_MAX_ATTEMPTS = 3;
const CANVAS_STRUCTURAL_TRANSACTION_MAX_ATTEMPTS = 3;
const CANVAS_ANCHORS = new Set(['north', 'east', 'south', 'west']);

interface IBaseHalfCanvasAbsentReadState {
	readonly exists: false;
	readonly canvas: null;
}

interface IBaseHalfCanvasExistingReadState {
	readonly exists: true;
	readonly canvas: IBaseHalfCanvasFile | null;
	readonly contents: VSBuffer;
}

type IBaseHalfCanvasReadState = IBaseHalfCanvasAbsentReadState | IBaseHalfCanvasExistingReadState;

export interface IBaseHalfCanvasRelocateOptions {
	/** Explicit call-site acknowledgement of the invariant below. Every ordinary
	 * move retires destination canvas state—even when the user path was absent
	 * and only orphan mirror metadata remains—inside the SAME transaction before
	 * installing the incoming identity. */
	readonly retireDestination?: true;
}

interface IBaseHalfCanvasStructuralResource {
	readonly resource: URI;
	/** Logical path currently expected inside this canvas. */
	readonly relativePath: string;
	/** Case-only recovery accepts a canvas already rewritten by an older partial
	 * implementation, while new operations remain all-or-nothing. */
	readonly alternateRelativePath?: string;
	/** Destination state is committed before the source/semantic owner. */
	readonly order: number;
}

interface IBaseHalfCanvasStructuralSnapshot extends IBaseHalfCanvasStructuralResource {
	readonly readPath: string;
	readonly read: IBaseHalfCanvasReadState;
	readonly current: IBaseHalfCanvasFile;
	next: IBaseHalfCanvasFile;
}

interface IBaseHalfCanvasCommittedWrite {
	readonly snapshot: IBaseHalfCanvasStructuralSnapshot;
	readonly contents: VSBuffer;
}

export class BaseHalfCanvasMirrorCorrupt extends Error {
	override readonly name = 'BaseHalfCanvasMirrorCorrupt';

	constructor(
		readonly resource: URI,
		readonly reason: string,
		options?: { cause?: unknown }
	) {
		super(`Corrupt canvas.yaml at ${resource.toString()}: ${reason}`, options);
	}
}

export class BaseHalfCanvasStateConflict extends Error {
	override readonly name = 'BaseHalfCanvasStateConflict';
}

export interface IBaseHalfCanvasCardStateTransition {
	readonly path: string;
	readonly expected: IBaseHalfCanvasCard | null;
	readonly next: IBaseHalfCanvasCard | null;
}

export interface IBaseHalfCanvasEdgeStateTransition {
	readonly from: string;
	readonly to: string;
	readonly expected: IBaseHalfCanvasEdge | null;
	readonly next: IBaseHalfCanvasEdge | null;
}

export interface IBaseHalfCanvasStateTransition {
	readonly cards?: readonly IBaseHalfCanvasCardStateTransition[];
	readonly edges?: readonly IBaseHalfCanvasEdgeStateTransition[];
}

export interface IBaseHalfCanvasMirrorService {
	readonly _serviceBrand: undefined;

	readCanvas(folder: IBaseHalfCanvasFolderState): Promise<IBaseHalfCanvasFile | null>;
	updateCardGeometry(folder: IBaseHalfCanvasFolderState, card: IBaseHalfCanvasCard, lease?: IBaseHalfWorkspaceMutationLease): Promise<IBaseHalfCanvasFile>;
	/** Atomically upsert a set of card geometries by path. An empty set is a
	 *  read-only no-op and returns the current canvas (or null when absent). */
	updateCardGeometries(folder: IBaseHalfCanvasFolderState, cards: readonly IBaseHalfCanvasCard[], lease?: IBaseHalfWorkspaceMutationLease): Promise<IBaseHalfCanvasFile | null>;
	upsertCanvasEdge(folder: IBaseHalfCanvasFolderState, edge: IBaseHalfCanvasEdge, lease?: IBaseHalfWorkspaceMutationLease): Promise<IBaseHalfCanvasFile>;
	reconnectCanvasEdge(folder: IBaseHalfCanvasFolderState, previous: Pick<IBaseHalfCanvasEdge, 'from' | 'to'>, edge: IBaseHalfCanvasEdge, lease?: IBaseHalfWorkspaceMutationLease): Promise<IBaseHalfCanvasFile>;
	removeCanvasEdge(folder: IBaseHalfCanvasFolderState, edge: Pick<IBaseHalfCanvasEdge, 'from' | 'to'>, lease?: IBaseHalfWorkspaceMutationLease): Promise<IBaseHalfCanvasFile>;
	/** Apply exact card and edge transitions together. Only the addressed rows
	 *  are compared, so unrelated layout edits survive; a touched row mismatch
	 *  rejects the whole update without overwriting the newer state. */
	transitionCanvasState(folder: IBaseHalfCanvasFolderState, transition: IBaseHalfCanvasStateTransition, lease?: IBaseHalfWorkspaceMutationLease): Promise<IBaseHalfCanvasFile>;
	/** A node moved `from` → `to`: re-root its own canvas subtree (a folder's
	 *  child layouts), rewriting card paths and edge endpoints, and carry the
	 *  PARENT folder's card for it — geometry kept on a same-parent rename,
	 *  re-seeded into the new parent on a cross-folder move (in-parent edges to
	 *  it drop there; its siblings changed). Style-only: the semantic reference
	 *  graph is carried by the badge layer. */
	relocateNode(workspaceFolder: URI, from: string, to: string, options?: IBaseHalfCanvasRelocateOptions, lease?: IBaseHalfWorkspaceMutationLease): Promise<void>;
	/** A case-only rename after the cascade has renamed the physical mirror
	 * entity directory to target casing: source and target are the same provider
	 * identity, so parse the still-old YAML and rewrite it in place. */
	relocateNodeIdentity(workspaceFolder: URI, from: string, to: string, lease?: IBaseHalfWorkspaceMutationLease): Promise<void>;
	/** A node was deleted: drop its own canvas subtree plus the parent folder's
	 *  card and any edges touching it. */
	purgeNode(workspaceFolder: URI, path: string, lease?: IBaseHalfWorkspaceMutationLease): Promise<void>;
	canvasResource(folder: IBaseHalfCanvasFolderState): URI;
}

export class BaseHalfCanvasMirrorService implements IBaseHalfCanvasMirrorService {
	declare readonly _serviceBrand: undefined;
	private readonly mutex = createKeyedMutex();

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IBaseHalfWorkspaceMutationCoordinator private readonly workspaceMutationCoordinator: IBaseHalfWorkspaceMutationCoordinator
	) { }

	private runWorkspaceMutation<T>(workspaceFolder: URI, lease: IBaseHalfWorkspaceMutationLease | undefined, task: () => Promise<T>): Promise<T> {
		if (lease) {
			this.workspaceMutationCoordinator.assertLease(lease, workspaceFolder);
			return task();
		}
		return this.workspaceMutationCoordinator.runExclusive(workspaceFolder, task);
	}

	async readCanvas(folder: IBaseHalfCanvasFolderState): Promise<IBaseHalfCanvasFile | null> {
		return this.readCanvasAt(folder.workspaceFolder, this.canvasResource(folder), folder.relativePath);
	}

	async updateCardGeometry(folder: IBaseHalfCanvasFolderState, card: IBaseHalfCanvasCard, lease?: IBaseHalfWorkspaceMutationLease): Promise<IBaseHalfCanvasFile> {
		const updated = await this.updateCardGeometries(folder, [card], lease);
		if (!updated) {
			throw new Error('A non-empty card geometry update must produce a canvas');
		}

		return updated;
	}

	updateCardGeometries(folder: IBaseHalfCanvasFolderState, cards: readonly IBaseHalfCanvasCard[], lease?: IBaseHalfWorkspaceMutationLease): Promise<IBaseHalfCanvasFile | null> {
		if (cards.length === 0) {
			return this.readCanvas(folder);
		}

		return this.runWorkspaceMutation(folder.workspaceFolder, lease, () =>
			this.patchCanvas(folder.workspaceFolder, folder.relativePath, existing => upsertCanvasCards(existing, cards))
		);
	}

	upsertCanvasEdge(folder: IBaseHalfCanvasFolderState, edge: IBaseHalfCanvasEdge, lease?: IBaseHalfWorkspaceMutationLease): Promise<IBaseHalfCanvasFile> {
		return this.runWorkspaceMutation(folder.workspaceFolder, lease, () =>
			this.patchCanvas(folder.workspaceFolder, folder.relativePath, existing => upsertCanvasEdge(existing, edge))
		);
	}

	reconnectCanvasEdge(folder: IBaseHalfCanvasFolderState, previous: Pick<IBaseHalfCanvasEdge, 'from' | 'to'>, edge: IBaseHalfCanvasEdge, lease?: IBaseHalfWorkspaceMutationLease): Promise<IBaseHalfCanvasFile> {
		return this.runWorkspaceMutation(folder.workspaceFolder, lease, () =>
			this.patchCanvas(folder.workspaceFolder, folder.relativePath, existing =>
				upsertCanvasEdge(removeCanvasEdge(existing, previous), edge)
			)
		);
	}

	removeCanvasEdge(folder: IBaseHalfCanvasFolderState, edge: Pick<IBaseHalfCanvasEdge, 'from' | 'to'>, lease?: IBaseHalfWorkspaceMutationLease): Promise<IBaseHalfCanvasFile> {
		return this.runWorkspaceMutation(folder.workspaceFolder, lease, () =>
			this.patchCanvas(folder.workspaceFolder, folder.relativePath, existing => removeCanvasEdge(existing, edge))
		);
	}

	transitionCanvasState(folder: IBaseHalfCanvasFolderState, transition: IBaseHalfCanvasStateTransition, lease?: IBaseHalfWorkspaceMutationLease): Promise<IBaseHalfCanvasFile> {
		validateCanvasStateTransition(transition);
		return this.runWorkspaceMutation(folder.workspaceFolder, lease, () =>
			this.patchCanvas(folder.workspaceFolder, folder.relativePath, existing => {
				for (const card of transition.cards ?? []) {
					const actual = existing.cards.find(candidate => candidate.path === card.path) ?? null;
					if (!nullableCanvasCardsEqual(actual, card.expected)) {
						throw new BaseHalfCanvasStateConflict(`The canvas card '${card.path}' changed before this operation could be applied.`);
					}
				}
				for (const edge of transition.edges ?? []) {
					const actual = existing.edges.find(candidate => candidate.from === edge.from && candidate.to === edge.to) ?? null;
					if (!nullableCanvasEdgesEqual(actual, edge.expected)) {
						throw new BaseHalfCanvasStateConflict(`The canvas connection '${edge.from}' → '${edge.to}' changed before this operation could be applied.`);
					}
				}

				let cards = [...existing.cards];
				for (const card of transition.cards ?? []) {
					cards = cards.filter(candidate => candidate.path !== card.path);
					if (card.next) {
						cards.push(card.next);
					}
				}
				let edges = [...existing.edges];
				for (const edge of transition.edges ?? []) {
					edges = edges.filter(candidate => candidate.from !== edge.from || candidate.to !== edge.to);
					if (edge.next) {
						edges.push(edge.next);
					}
				}
				const next = {
					path: existing.path,
					...(existing.size ? { size: existing.size } : {}),
					cards,
					edges
				};
				return canvasFilesEqual(existing, next) ? existing : next;
			})
		);
	}

	relocateNode(workspaceFolder: URI, from: string, to: string, options: IBaseHalfCanvasRelocateOptions = {}, lease?: IBaseHalfWorkspaceMutationLease): Promise<void> {
		if (from === to || baseHalfIsMirrorSubtree(to, from)) {
			return Promise.resolve();
		}
		return this.runWorkspaceMutation(workspaceFolder, lease, () => this.relocateNodeLocked(workspaceFolder, from, to, options));
	}

	relocateNodeIdentity(workspaceFolder: URI, from: string, to: string, lease?: IBaseHalfWorkspaceMutationLease): Promise<void> {
		if (from === to) {
			return Promise.resolve();
		}
		return this.runWorkspaceMutation(workspaceFolder, lease, () => this.relocateNodeIdentityLocked(workspaceFolder, from, to));
	}

	private async relocateNodeLocked(workspaceFolder: URI, from: string, to: string, options: IBaseHalfCanvasRelocateOptions): Promise<void> {
		const retireDestination = options.retireDestination ?? true;
		const entries = await baseHalfWalkMirror(this.fileService, workspaceFolder, 'canvas.yaml');
		const sourceEntries = entries.filter(entry => baseHalfIsMirrorSubtree(entry.relativePath, from));
		const destinationEntries = retireDestination
			? entries.filter(entry => baseHalfIsMirrorSubtree(entry.relativePath, to))
			: [];
		const oldParent = parentRel(from);
		const newParent = parentRel(to);
		const resources = new Map<string, IBaseHalfCanvasStructuralResource>();
		const addResource = (resource: URI, relativePath: string, order: number): void => {
			const key = resource.toString();
			const previous = resources.get(key);
			if (previous && previous.relativePath !== relativePath) {
				throw new Error(`Canvas relocation aliases two logical paths at ${key}`);
			}
			resources.set(key, { resource, relativePath, order: Math.max(previous?.order ?? order, order) });
		};

		for (const entry of destinationEntries) {
			addResource(entry.resource, entry.relativePath, 10);
		}
		for (const entry of sourceEntries) {
			const targetRel = baseHalfRemapSubtreeRel(entry.relativePath, from, to);
			addResource(this.canvasResourceFor(workspaceFolder, targetRel), targetRel, 20);
			addResource(entry.resource, entry.relativePath, 80);
		}
		addResource(this.canvasResourceFor(workspaceFolder, newParent), newParent, oldParent === newParent ? 90 : 30);
		addResource(this.canvasResourceFor(workspaceFolder, oldParent), oldParent, 90);

		await this.executeCanvasStructuralTransaction(workspaceFolder, [...resources.values()], snapshots => {
			const snapshotFor = (resource: URI): IBaseHalfCanvasStructuralSnapshot => {
				const snapshot = snapshots.get(resource.toString());
				if (!snapshot) {
					throw new Error(`Missing canvas transaction snapshot for ${resource.toString()}`);
				}
				return snapshot;
			};
			const swap = (path: string): string => baseHalfIsMirrorSubtree(path, from) ? baseHalfRemapSubtreeRel(path, from, to) : path;

			// Retirement and relocation are computed from ONE immutable snapshot set.
			// Destination state is cleared first, every source is tombstoned second,
			// and transformed source state wins at its mapped destination last.
			for (const entry of destinationEntries) {
				snapshotFor(entry.resource).next = emptyCanvas(entry.relativePath);
			}
			for (const entry of sourceEntries) {
				snapshotFor(entry.resource).next = emptyCanvas(entry.relativePath);
			}
			for (const entry of sourceEntries) {
				const source = snapshotFor(entry.resource).current;
				const targetRel = baseHalfRemapSubtreeRel(entry.relativePath, from, to);
				snapshotFor(this.canvasResourceFor(workspaceFolder, targetRel)).next = {
					path: targetRel,
					...(source.size ? { size: source.size } : {}),
					cards: source.cards.map(card => ({ ...card, path: swap(card.path) })),
					edges: source.edges.map(edge => ({ ...edge, from: swap(edge.from), to: swap(edge.to) }))
				};
			}

			const oldParentSnapshot = snapshotFor(this.canvasResourceFor(workspaceFolder, oldParent));
			if (oldParent === newParent) {
				oldParentSnapshot.next = relocateNodeWithinParent(oldParentSnapshot.next, from, to, retireDestination);
				return;
			}

			const newParentSnapshot = snapshotFor(this.canvasResourceFor(workspaceFolder, newParent));
			const carried = oldParentSnapshot.next.cards.find(card => card.path === from);
			oldParentSnapshot.next = removeNodeFromParentCanvas(oldParentSnapshot.next, from);
			if (retireDestination) {
				newParentSnapshot.next = removeNodeFromParentCanvas(newParentSnapshot.next, to);
			}
			if (carried) {
				newParentSnapshot.next = upsertCanvasCard(newParentSnapshot.next, { ...carried, path: to });
			}
		});
	}

	private async relocateNodeIdentityLocked(workspaceFolder: URI, from: string, to: string): Promise<void> {
		const oldParent = parentRel(from);
		const newParent = parentRel(to);
		if (oldParent !== newParent) {
			throw new Error('A same-resource canvas identity rewrite must keep the same logical parent.');
		}

		const entries = (await baseHalfWalkMirror(this.fileService, workspaceFolder, 'canvas.yaml'))
			.filter(entry => baseHalfIsMirrorSubtree(entry.relativePath, to));
		const resources = new Map<string, IBaseHalfCanvasStructuralResource>();
		for (const entry of entries) {
			const oldRel = baseHalfRemapSubtreeRel(entry.relativePath, to, from);
			resources.set(entry.resource.toString(), {
				resource: entry.resource,
				relativePath: oldRel,
				alternateRelativePath: entry.relativePath,
				order: 20
			});
		}
		const parentResource = this.canvasResourceFor(workspaceFolder, oldParent);
		resources.set(parentResource.toString(), { resource: parentResource, relativePath: oldParent, order: 90 });

		await this.executeCanvasStructuralTransaction(workspaceFolder, [...resources.values()], snapshots => {
			const swap = (path: string): string => baseHalfIsMirrorSubtree(path, from) ? baseHalfRemapSubtreeRel(path, from, to) : path;
			for (const entry of entries) {
				const snapshot = snapshots.get(entry.resource.toString())!;
				const newRel = entry.relativePath;
				// A valid target-path snapshot means an older partial implementation had
				// already completed this file. Keep it byte-for-byte and finish the rest.
				if (snapshot.readPath === newRel) {
					continue;
				}
				snapshot.next = {
					path: newRel,
					...(snapshot.current.size ? { size: snapshot.current.size } : {}),
					cards: snapshot.current.cards.map(card => ({ ...card, path: swap(card.path) })),
					edges: snapshot.current.edges.map(edge => ({ ...edge, from: swap(edge.from), to: swap(edge.to) }))
				};
			}

			const parent = snapshots.get(parentResource.toString())!;
			parent.next = relocateNodeWithinParent(parent.next, from, to, false);
		});
	}

	/** Commit a complete structural canvas plan destination-first and its
	 * semantic/source owners last. Any failure conditionally restores EVERY
	 * completed write in reverse order; a clean conflict compensation replays
	 * the whole plan from fresh exact snapshots. */
	private async executeCanvasStructuralTransaction(
		workspaceFolder: URI,
		resourceSpecs: readonly IBaseHalfCanvasStructuralResource[],
		prepare: (snapshots: ReadonlyMap<string, IBaseHalfCanvasStructuralSnapshot>) => void
	): Promise<void> {
		const orderedSpecs = [...resourceSpecs].sort((first, second) => first.order - second.order || first.resource.toString().localeCompare(second.resource.toString()));
		await this.withCanvasResourceLocks(orderedSpecs.map(spec => spec.resource), async () => {
			for (let attempt = 0; attempt < CANVAS_STRUCTURAL_TRANSACTION_MAX_ATTEMPTS; attempt++) {
				const snapshots = new Map<string, IBaseHalfCanvasStructuralSnapshot>();
				for (const spec of orderedSpecs) {
					const { readPath, read } = await this.readCanvasStructuralState(workspaceFolder, spec);
					const current = read.canvas ?? emptyCanvas(readPath);
					snapshots.set(spec.resource.toString(), { ...spec, readPath, read, current, next: current });
				}
				prepare(snapshots);

				const writes = orderedSpecs
					.map(spec => snapshots.get(spec.resource.toString())!)
					.filter(snapshot => !canvasStructuralStateEqual(snapshot));
				const committed: IBaseHalfCanvasCommittedWrite[] = [];
				let commitError: unknown;
				try {
					for (const snapshot of writes) {
						const contents = await this.commitCanvasState(workspaceFolder, snapshot.resource, snapshot.next, snapshot.read);
						committed.push({ snapshot, contents });
					}
				} catch (error) {
					commitError = error;
				}

				if (commitError !== undefined) {
					const rollbackErrors = await this.compensateCanvasWrites(workspaceFolder, committed);
					if (rollbackErrors.length > 0) {
						throw new AggregateError([commitError, ...rollbackErrors], 'Canvas structural commit and reverse conditional compensation both failed');
					}
					if (isCanvasPatchConflict(commitError) && attempt < CANVAS_STRUCTURAL_TRANSACTION_MAX_ATTEMPTS - 1) {
						continue;
					}
					throw commitError;
				}

				try {
					const committedByResource = new Map(committed.map(write => [write.snapshot.resource.toString(), write]));
					for (const spec of orderedSpecs) {
						const snapshot = snapshots.get(spec.resource.toString())!;
						await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, snapshot.resource);
						const write = committedByResource.get(spec.resource.toString());
						if (write) {
							await this.assertCanvasContents(workspaceFolder, snapshot.resource, write.contents);
						} else {
							// A semantically equal destination is still a transaction
							// precondition. If it drifts after the exact snapshot while a
							// source tombstone commits, accepting success loses the incoming
							// state even though this resource needed no write of its own.
							await this.assertCanvasSnapshotUnchanged(workspaceFolder, snapshot);
						}
					}
					return;
				} catch (error) {
					const rollbackErrors = await this.compensateCanvasWrites(workspaceFolder, committed);
					if (rollbackErrors.length > 0) {
						throw new AggregateError([error, ...rollbackErrors], 'Canvas structural verification and reverse conditional compensation both failed');
					}
					throw error;
				}
			}
		});
	}

	private async readCanvasStructuralState(workspaceFolder: URI, spec: IBaseHalfCanvasStructuralResource): Promise<{ readonly readPath: string; readonly read: IBaseHalfCanvasReadState }> {
		try {
			return { readPath: spec.relativePath, read: await this.readCanvasStateAt(workspaceFolder, spec.resource, spec.relativePath) };
		} catch (error) {
			if (!(error instanceof BaseHalfCanvasMirrorCorrupt) || spec.alternateRelativePath === undefined) {
				throw error;
			}
			try {
				return { readPath: spec.alternateRelativePath, read: await this.readCanvasStateAt(workspaceFolder, spec.resource, spec.alternateRelativePath) };
			} catch {
				throw error;
			}
		}
	}

	private async compensateCanvasWrites(workspaceFolder: URI, writes: readonly IBaseHalfCanvasCommittedWrite[]): Promise<unknown[]> {
		const errors: unknown[] = [];
		for (const write of [...writes].reverse()) {
			try {
				await this.restoreCanvasState(workspaceFolder, write.snapshot.resource, write.snapshot.readPath, write.contents, write.snapshot.read);
			} catch (error) {
				errors.push(error);
			}
		}
		return errors;
	}

	private async commitCanvasState(workspaceFolder: URI, resource: URI, canvas: IBaseHalfCanvasFile, expected: IBaseHalfCanvasReadState): Promise<VSBuffer> {
		const contents = VSBuffer.fromString(serializeCanvasFile(canvas));
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
		await this.fileService.createFolder(dirname(resource));
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
		await baseHalfCommitMirrorFile(this.fileService, resource, contents, expected.exists ? expected.contents : null);
		return contents;
	}

	private async restoreCanvasState(workspaceFolder: URI, resource: URI, relativePath: string, written: VSBuffer, original: IBaseHalfCanvasReadState): Promise<void> {
		const contents = original.exists
			? original.contents
			: VSBuffer.fromString(serializeCanvasFile({ path: relativePath, cards: [], edges: [] }));
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
		await this.fileService.createFolder(dirname(resource));
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
		await baseHalfCommitMirrorFile(this.fileService, resource, contents, written);
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
	}

	private async assertCanvasContents(workspaceFolder: URI, resource: URI, expected: VSBuffer): Promise<void> {
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
		let current: VSBuffer;
		try {
			current = (await this.fileService.readFile(resource, { limits: { size: CANVAS_YAML_MAX_BYTES }, atomic: true })).value;
		} catch (error) {
			if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				throw new FileOperationError(`Canvas disappeared after relocation commit: ${resource.toString()}`, FileOperationResult.FILE_MODIFIED_SINCE);
			}
			throw error;
		}
		if (!current.equals(expected)) {
			throw new FileOperationError(`Canvas changed after relocation commit: ${resource.toString()}`, FileOperationResult.FILE_MODIFIED_SINCE);
		}
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
	}

	private async assertCanvasSnapshotUnchanged(workspaceFolder: URI, snapshot: IBaseHalfCanvasStructuralSnapshot): Promise<void> {
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, snapshot.resource);
		let current: VSBuffer;
		try {
			current = (await this.fileService.readFile(snapshot.resource, { limits: { size: CANVAS_YAML_MAX_BYTES }, atomic: true })).value;
		} catch (error) {
			if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				if (!snapshot.read.exists) {
					await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, snapshot.resource);
					return;
				}
				throw new FileOperationError(`Canvas disappeared after structural snapshot: ${snapshot.resource.toString()}`, FileOperationResult.FILE_MODIFIED_SINCE);
			}
			throw error;
		}

		if (!snapshot.read.exists || !current.equals(snapshot.read.contents)) {
			throw new FileOperationError(`Canvas changed after structural snapshot: ${snapshot.resource.toString()}`, FileOperationResult.FILE_MODIFIED_SINCE);
		}
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, snapshot.resource);
	}

	private withCanvasResourceLocks<T>(resources: readonly URI[], task: () => Promise<T>): Promise<T> {
		const keys = [...new Set(resources.map(resource => resource.toString()))].sort();
		const run = (index: number): Promise<T> => index === keys.length
			? task()
			: this.mutex.runExclusive(keys[index], () => run(index + 1));
		return run(0);
	}

	purgeNode(workspaceFolder: URI, path: string, lease?: IBaseHalfWorkspaceMutationLease): Promise<void> {
		return this.runWorkspaceMutation(workspaceFolder, lease, () => this.purgeNodeLocked(workspaceFolder, path));
	}

	private async purgeNodeLocked(workspaceFolder: URI, path: string): Promise<void> {
		for (const entry of await baseHalfWalkMirror(this.fileService, workspaceFolder, 'canvas.yaml')) {
			if (!baseHalfIsMirrorSubtree(entry.relativePath, path)) {
				continue;
			}

			let snapshot: IBaseHalfCanvasFile | null;
			try {
				snapshot = await this.readCanvasAt(workspaceFolder, entry.resource, entry.relativePath);
			} catch (error) {
				if (error instanceof BaseHalfCanvasMirrorCorrupt) {
					// Preserve a corrupt layout file for recovery instead of turning a
					// node delete into unrelated layout data loss.
					continue;
				}
				throw error;
			}

			if (snapshot) {
				await this.retireCanvasSnapshot(workspaceFolder, entry.relativePath, snapshot);
			}
		}

		await this.patchCanvas(workspaceFolder, parentRel(path), existing => ({
			...existing,
			cards: existing.cards.filter(card => card.path !== path),
			edges: existing.edges.filter(candidate => candidate.from !== path && candidate.to !== path)
		}));
	}

	canvasResource(folder: IBaseHalfCanvasFolderState): URI {
		return this.canvasResourceFor(folder.workspaceFolder, folder.relativePath);
	}

	private canvasResourceFor(workspaceFolder: URI, relativePath: string): URI {
		return URI.joinPath(workspaceFolder, '.bh', 'mirror', ...baseHalfMirrorPathSegments(relativePath), 'canvas.yaml');
	}

	/** Retire a structural source only while it still denotes the exact snapshot
	 *  that was moved or purged. A newer external edit wins and remains in place. */
	private async retireCanvasSnapshot(workspaceFolder: URI, folderRel: string, snapshot: IBaseHalfCanvasFile): Promise<void> {
		await this.patchCanvas(workspaceFolder, folderRel, current => {
			if (!canvasFilesEqual(current, snapshot)) {
				return current;
			}
			return { path: folderRel, cards: [], edges: [] };
		});
	}

	/** Optimistic read-modify-write of one folder's canvas.yaml under its local
	 *  lock. Existing files use exact-byte guarded atomic replace; absent files
	 *  use provider-exclusive create. Conflicts replay the pure update on the newest
	 *  file. A materialized canvas that becomes empty stays as canonical YAML,
	 *  avoiding an unguarded delete after the guarded commit. */
	private patchCanvas(workspaceFolder: URI, folderRel: string, update: (existing: IBaseHalfCanvasFile) => IBaseHalfCanvasFile): Promise<IBaseHalfCanvasFile> {
		const resource = this.canvasResourceFor(workspaceFolder, folderRel);
		return this.mutex.runExclusive(resource.toString(), async () => {
			for (let attempt = 0; attempt < CANVAS_PATCH_MAX_ATTEMPTS; attempt++) {
				const read = await this.readCanvasStateAt(workspaceFolder, resource, folderRel);
				const existing = read.canvas ?? { path: folderRel, cards: [], edges: [] };
				const next = update(existing);
				if (next === existing) {
					return next;
				}
				const isEmpty = next.cards.length === 0 && next.edges.length === 0 && !next.size;
				if (isEmpty && read.canvas === null) {
					return next;
				}

				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
				await this.fileService.createFolder(dirname(resource));
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
				try {
					const contents = VSBuffer.fromString(serializeCanvasFile(next));
					await baseHalfCommitMirrorFile(this.fileService, resource, contents, read.exists ? read.contents : null);
					return next;
				} catch (error) {
					if (!isCanvasPatchConflict(error) || attempt === CANVAS_PATCH_MAX_ATTEMPTS - 1) {
						throw error;
					}
				}
			}
			throw new Error(`Unable to update ${resource.toString()} after ${CANVAS_PATCH_MAX_ATTEMPTS} attempts`);
		});
	}

	private async readCanvasAt(workspaceFolder: URI, resource: URI, relativePath: string): Promise<IBaseHalfCanvasFile | null> {
		return (await this.readCanvasStateAt(workspaceFolder, resource, relativePath)).canvas;
	}

	private async readCanvasStateAt(workspaceFolder: URI, resource: URI, relativePath: string): Promise<IBaseHalfCanvasReadState> {
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
		let content;
		try {
			content = await this.fileService.readFile(resource, {
				limits: { size: CANVAS_YAML_MAX_BYTES },
				atomic: true
			});
		} catch (error) {
			if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
				return { exists: false, canvas: null };
			}

			throw error;
		}
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);

		const parsed = parseCanvasYaml(content.value.toString(), resource);
		if (parsed === null) {
			return { exists: true, canvas: null, contents: content.value };
		}

		const canvas = normalizeCanvasFile(parsed, resource, relativePath);
		return {
			exists: true,
			canvas: isEmptyCanvas(canvas) ? null : canvas,
			contents: content.value
		};
	}
}

function isCanvasPatchConflict(error: unknown): boolean {
	return error instanceof FileOperationError && (
		error.fileOperationResult === FileOperationResult.FILE_MODIFIED_SINCE
		|| error.fileOperationResult === FileOperationResult.FILE_MOVE_CONFLICT
		|| error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND
	);
}

function isEmptyCanvas(canvas: IBaseHalfCanvasFile): boolean {
	return canvas.cards.length === 0 && canvas.edges.length === 0 && !canvas.size;
}

function validateCanvasStateTransition(transition: IBaseHalfCanvasStateTransition): void {
	const cardPaths = new Set<string>();
	for (const card of transition.cards ?? []) {
		if (!card.path || cardPaths.has(card.path)) {
			throw new Error(`A canvas state transition contains an invalid or duplicate card path: ${card.path}`);
		}
		cardPaths.add(card.path);
		if (card.expected?.path !== undefined && card.expected.path !== card.path) {
			throw new Error(`The expected canvas card identity does not match '${card.path}'.`);
		}
		if (card.next?.path !== undefined && card.next.path !== card.path) {
			throw new Error(`The next canvas card identity does not match '${card.path}'.`);
		}
	}

	const edgeKeys = new Set<string>();
	for (const edge of transition.edges ?? []) {
		const key = `${edge.from}\0${edge.to}`;
		if (!edge.from || !edge.to || edge.from === edge.to || edgeKeys.has(key)) {
			throw new Error(`A canvas state transition contains an invalid or duplicate connection: ${edge.from} → ${edge.to}`);
		}
		edgeKeys.add(key);
		for (const state of [edge.expected, edge.next]) {
			if (state && (state.from !== edge.from || state.to !== edge.to)) {
				throw new Error(`A canvas connection state does not match '${edge.from}' → '${edge.to}'.`);
			}
		}
	}
}

function nullableCanvasCardsEqual(first: IBaseHalfCanvasCard | null, second: IBaseHalfCanvasCard | null): boolean {
	return first === second || !!first && !!second
		&& first.path === second.path
		&& first.kind === second.kind
		&& first.x === second.x
		&& first.y === second.y
		&& first.width === second.width
		&& first.height === second.height;
}

function nullableCanvasEdgesEqual(first: IBaseHalfCanvasEdge | null, second: IBaseHalfCanvasEdge | null): boolean {
	return first === second || !!first && !!second
		&& first.from === second.from
		&& first.from_anchor === second.from_anchor
		&& first.to === second.to
		&& first.to_anchor === second.to_anchor;
}

function canvasFilesEqual(first: IBaseHalfCanvasFile, second: IBaseHalfCanvasFile): boolean {
	return serializeCanvasFile(first) === serializeCanvasFile(second);
}

function emptyCanvas(path: string): IBaseHalfCanvasFile {
	return { path, cards: [], edges: [] };
}

function canvasStructuralStateEqual(snapshot: IBaseHalfCanvasStructuralSnapshot): boolean {
	if (snapshot.read.canvas) {
		return canvasFilesEqual(snapshot.read.canvas, snapshot.next);
	}
	// Absent and materialized-empty states are both logical tombstones. They are
	// unchanged only while the embedded identity is unchanged; a case-only move
	// must still rewrite `path` even when the canvas has no cards or edges.
	return snapshot.next.path === snapshot.readPath && isEmptyCanvas(snapshot.next);
}

function removeNodeFromParentCanvas(canvas: IBaseHalfCanvasFile, path: string): IBaseHalfCanvasFile {
	return {
		...canvas,
		cards: canvas.cards.filter(card => card.path !== path),
		edges: canvas.edges.filter(edge => edge.from !== path && edge.to !== path)
	};
}

/** Rename one card identity in a shared parent canvas. On overwrite, target
 * state is retired before the incoming source card/edges are mapped, so there
 * is exactly one target card and its geometry is the source identity's. */
function relocateNodeWithinParent(canvas: IBaseHalfCanvasFile, from: string, to: string, retireDestination: boolean): IBaseHalfCanvasFile {
	const incomingCard = canvas.cards.find(card => card.path === from);
	const cards: IBaseHalfCanvasCard[] = [];
	for (const card of canvas.cards) {
		if (card.path === to && (retireDestination || incomingCard !== undefined)) {
			continue;
		}
		cards.push(card.path === from ? { ...card, path: to } : card);
	}

	const sourceEdges: IBaseHalfCanvasEdge[] = [];
	const retainedEdges: IBaseHalfCanvasEdge[] = [];
	for (const edge of canvas.edges) {
		const touchesSource = edge.from === from || edge.to === from;
		const touchesDestination = edge.from === to || edge.to === to;
		if (touchesSource) {
			// A source↔destination edge becomes a self-edge during overwrite and is
			// destination-owned styling; retire it instead of manufacturing a loop.
			if (!(retireDestination && touchesDestination)) {
				sourceEdges.push(edge);
			}
		} else if (!(retireDestination && touchesDestination)) {
			retainedEdges.push(edge);
		}
	}

	const remappedSourceEdges = sourceEdges
		.map(edge => ({
			...edge,
			from: edge.from === from ? to : edge.from,
			to: edge.to === from ? to : edge.to
		}))
		.filter(edge => edge.from !== edge.to);

	return {
		...canvas,
		cards: lastByKey(cards, card => card.path),
		// Incoming edge geometry is appended last and therefore wins any stale
		// destination collision under the parser's established last-wins rule.
		edges: lastByKey([...retainedEdges, ...remappedSourceEdges], edge => `${edge.from}\u0000${edge.to}`)
	};
}

/** The folder a node lives in (its parent), as a canvas rel (`''` = root). */
function parentRel(relativePath: string): string {
	const index = relativePath.lastIndexOf('/');
	return index === -1 ? '' : relativePath.slice(0, index);
}

export function upsertCanvasCard(canvas: IBaseHalfCanvasFile, card: IBaseHalfCanvasCard): IBaseHalfCanvasFile {
	return upsertCanvasCards(canvas, [card]);
}

function upsertCanvasCards(canvas: IBaseHalfCanvasFile, updates: readonly IBaseHalfCanvasCard[]): IBaseHalfCanvasFile {
	const cards = [...canvas.cards];
	const indexByPath = new Map<string, number>();
	for (let index = 0; index < cards.length; index++) {
		if (!indexByPath.has(cards[index].path)) {
			indexByPath.set(cards[index].path, index);
		}
	}

	for (const card of updates) {
		const index = indexByPath.get(card.path);
		if (index !== undefined) {
			cards[index] = card;
		} else {
			indexByPath.set(card.path, cards.length);
			cards.push(card);
		}
	}

	return {
		path: canvas.path,
		...(canvas.size ? { size: canvas.size } : {}),
		cards,
		edges: canvas.edges
	};
}

export function upsertCanvasEdge(canvas: IBaseHalfCanvasFile, edge: IBaseHalfCanvasEdge): IBaseHalfCanvasFile {
	if (edge.from === edge.to) {
		return canvas;
	}

	const edges = [...canvas.edges];
	const index = edges.findIndex(existing => existing.from === edge.from && existing.to === edge.to);
	if (index >= 0) {
		edges[index] = edge;
	} else {
		edges.push(edge);
	}

	return {
		path: canvas.path,
		...(canvas.size ? { size: canvas.size } : {}),
		cards: canvas.cards,
		edges
	};
}

export function removeCanvasEdge(canvas: IBaseHalfCanvasFile, edge: Pick<IBaseHalfCanvasEdge, 'from' | 'to'>): IBaseHalfCanvasFile {
	return {
		path: canvas.path,
		...(canvas.size ? { size: canvas.size } : {}),
		cards: canvas.cards,
		edges: canvas.edges.filter(candidate => candidate.from !== edge.from || candidate.to !== edge.to)
	};
}

export function serializeCanvasFile(canvas: IBaseHalfCanvasFile): string {
	assertCanvasGeometrySerializable(canvas);
	const lines = [
		`path: ${yamlString(canvas.path)}`
	];

	if (canvas.size) {
		lines.push(
			'size:',
			`  width: ${formatNumber(canvas.size.width)}`,
			`  height: ${formatNumber(canvas.size.height)}`
		);
	}

	lines.push('cards:');
	if (canvas.cards.length === 0) {
		lines[lines.length - 1] = 'cards: []';
	} else {
		for (const card of canvas.cards) {
			lines.push(
				`  - path: ${yamlString(card.path)}`,
				`    kind: ${card.kind}`,
				`    x: ${formatNumber(card.x)}`,
				`    y: ${formatNumber(card.y)}`,
				`    width: ${formatNumber(card.width)}`,
				`    height: ${formatNumber(card.height)}`
			);
		}
	}

	lines.push('edges:');
	if (canvas.edges.length === 0) {
		lines[lines.length - 1] = 'edges: []';
	} else {
		for (const edge of canvas.edges) {
			lines.push(
				`  - from: ${yamlString(edge.from)}`,
				`    from_anchor: ${edge.from_anchor}`,
				`    to: ${yamlString(edge.to)}`,
				`    to_anchor: ${edge.to_anchor}`
			);
		}
	}

	lines.push('');
	return lines.join('\n');
}

function assertCanvasGeometrySerializable(canvas: IBaseHalfCanvasFile): void {
	if (canvas.size) {
		assertCanvasFinitePositive(canvas.size.width, 'canvas size width');
		assertCanvasFinitePositive(canvas.size.height, 'canvas size height');
	}
	for (const card of canvas.cards) {
		assertCanvasFinite(card.x, `card '${card.path}' x`);
		assertCanvasFinite(card.y, `card '${card.path}' y`);
		assertCanvasFinitePositive(card.width, `card '${card.path}' width`);
		assertCanvasFinitePositive(card.height, `card '${card.path}' height`);
	}
}

function assertCanvasFinite(value: number, label: string): void {
	if (!Number.isFinite(value)) {
		throw new RangeError(`Cannot serialize canvas: ${label} must be a finite number`);
	}
}

function assertCanvasFinitePositive(value: number, label: string): void {
	assertCanvasFinite(value, label);
	if (value <= 0) {
		throw new RangeError(`Cannot serialize canvas: ${label} must be positive`);
	}
}

function yamlString(value: string): string {
	return JSON.stringify(value);
}

function formatNumber(value: number): string {
	return String(Number(value.toFixed(4)));
}

function normalizeCanvasFile(value: unknown, resource: URI, expectedPath: string): IBaseHalfCanvasFile {
	const record = asRecord(value, resource, 'canvas root must be an object');
	const path = stringField(record, 'path', resource);
	if (path !== expectedPath) {
		throw new BaseHalfCanvasMirrorCorrupt(resource, `path must be "${expectedPath}"`);
	}

	const size = optionalSize(record.size, resource);
	const cards = lastByKey(
		arrayField(record, 'cards', resource).map((card, index) => normalizeCanvasCard(card, resource, index)),
		card => card.path
	);
	const edges = lastByKey(
		arrayField(record, 'edges', resource).map((edge, index) => normalizeCanvasEdge(edge, resource, index)),
		edge => `${edge.from}\u0000${edge.to}`
	);

	return {
		path,
		...(size ? { size } : {}),
		cards,
		edges
	};
}

function lastByKey<T>(values: readonly T[], keyOf: (value: T) => string): T[] {
	const byKey = new Map<string, T>();
	for (const value of values) {
		byKey.set(keyOf(value), value);
	}
	return [...byKey.values()];
}

function normalizeCanvasCard(value: unknown, resource: URI, index: number): IBaseHalfCanvasCard {
	const record = asRecord(value, resource, `cards[${index}] must be an object`);
	const kind = stringField(record, 'kind', resource);
	if (kind !== 'file' && kind !== 'folder') {
		throw new BaseHalfCanvasMirrorCorrupt(resource, `cards[${index}].kind must be file or folder`);
	}

	return {
		path: stringField(record, 'path', resource),
		kind,
		x: numberField(record, 'x', resource),
		y: numberField(record, 'y', resource),
		width: positiveNumberField(record, 'width', resource),
		height: positiveNumberField(record, 'height', resource)
	};
}

function normalizeCanvasEdge(value: unknown, resource: URI, index: number): IBaseHalfCanvasEdge {
	const record = asRecord(value, resource, `edges[${index}] must be an object`);
	const fromAnchor = anchorField(record, 'from_anchor', resource, index);
	const toAnchor = anchorField(record, 'to_anchor', resource, index);

	return {
		from: stringField(record, 'from', resource),
		from_anchor: fromAnchor,
		to: stringField(record, 'to', resource),
		to_anchor: toAnchor
	};
}

function optionalSize(value: unknown, resource: URI): IBaseHalfCanvasSize | undefined {
	if (value === undefined) {
		return undefined;
	}

	const record = asRecord(value, resource, 'size must be an object');
	return {
		width: positiveNumberField(record, 'width', resource),
		height: positiveNumberField(record, 'height', resource)
	};
}

function asRecord(value: unknown, resource: URI, reason: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new BaseHalfCanvasMirrorCorrupt(resource, reason);
	}

	return value as Record<string, unknown>;
}

function arrayField(record: Record<string, unknown>, key: string, resource: URI): readonly unknown[] {
	const value = record[key];
	if (value === undefined) {
		return [];
	}

	if (!Array.isArray(value)) {
		throw new BaseHalfCanvasMirrorCorrupt(resource, `${key} must be an array`);
	}

	return value;
}

function stringField(record: Record<string, unknown>, key: string, resource: URI): string {
	const value = record[key];
	if (typeof value !== 'string') {
		throw new BaseHalfCanvasMirrorCorrupt(resource, `${key} must be a string`);
	}

	return value;
}

function numberField(record: Record<string, unknown>, key: string, resource: URI): number {
	const value = record[key];
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new BaseHalfCanvasMirrorCorrupt(resource, `${key} must be a finite number`);
	}

	return value;
}

function positiveNumberField(record: Record<string, unknown>, key: string, resource: URI): number {
	const value = numberField(record, key, resource);
	if (value <= 0) {
		throw new BaseHalfCanvasMirrorCorrupt(resource, `${key} must be positive`);
	}

	return value;
}

function anchorField(record: Record<string, unknown>, key: string, resource: URI, edgeIndex: number): IBaseHalfCanvasEdge['from_anchor'] {
	const value = stringField(record, key, resource);
	if (!CANVAS_ANCHORS.has(value)) {
		throw new BaseHalfCanvasMirrorCorrupt(resource, `edges[${edgeIndex}].${key} must be a canvas anchor`);
	}

	return value as IBaseHalfCanvasEdge['from_anchor'];
}

registerSingleton(IBaseHalfCanvasMirrorService, BaseHalfCanvasMirrorService, InstantiationType.Delayed);

function parseCanvasYaml(raw: string, resource: URI): Record<string, unknown> | null {
	const errors: YamlParseError[] = [];
	const node = parseYaml(raw, errors);
	if (errors.length > 0) {
		throw new BaseHalfCanvasMirrorCorrupt(resource, errors[0].message);
	}

	if (!node) {
		return null;
	}

	return asRecord(yamlNodeToValue(node), resource, 'canvas root must be an object');
}

function yamlNodeToValue(node: YamlNode): unknown {
	if (node.type === 'map') {
		const value: Record<string, unknown> = {};
		for (const property of node.properties) {
			value[property.key.value] = yamlNodeToValue(property.value);
		}
		return value;
	}

	if (node.type === 'sequence') {
		return node.items.map(item => yamlNodeToValue(item));
	}

	return yamlScalarValue(node);
}

function yamlScalarValue(node: YamlScalarNode): string | number | boolean | null {
	const value = node.value;
	const trimmed = value.trim();
	if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
		return Number(trimmed);
	}

	if (trimmed === 'true') {
		return true;
	}

	if (trimmed === 'false') {
		return false;
	}

	if (trimmed === 'null' || trimmed === '~') {
		return null;
	}

	return value;
}
