/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../base/common/buffer.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { dirname } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { YamlMapNode, YamlNode } from '../../../base/common/yaml.js';
import { FileOperationError, FileOperationResult, IFileService } from '../../../platform/files/common/files.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import {
	baseHalfCanvasEndPlace,
	baseHalfCanvasIsOpen,
	baseHalfCanvasRowSpan,
	IBaseHalfCanvasCard,
	IBaseHalfCanvasEdge,
	IBaseHalfCanvasFile,
	IBaseHalfCanvasSize
} from './basehalfCanvasModel.js';
import { IBaseHalfCanvasFolderState } from './basehalfCanvasNavigation.js';
import { createKeyedMutex } from './basehalfKeyedMutex.js';
import { baseHalfCommitMirrorFile } from './basehalfMirrorFileCommit.js';
import { baseHalfEnsureMirrorIgnoreFile } from './basehalfMirrorIgnore.js';
import { baseHalfPreserveMirrorBytes } from './basehalfMirrorRecovery.js';
import { baseHalfAssertMirrorPathComponentsNotSymbolicLink, baseHalfIsMirrorSubtree, baseHalfMirrorPathSegments, baseHalfRemapSubtreeRel, baseHalfWalkMirror } from './basehalfMirrorTree.js';
import {
	baseHalfMirrorPathNamesNode,
	BaseHalfMirrorWriteRejected,
	baseHalfMirrorYamlAbsent,
	baseHalfMirrorYamlBoolean,
	baseHalfMirrorYamlItems,
	baseHalfMirrorYamlMap,
	baseHalfMirrorYamlNumber,
	baseHalfMirrorYamlProperty,
	baseHalfMirrorYamlQuote,
	baseHalfMirrorYamlString,
	BaseHalfMirrorYamlUnreadable,
	baseHalfParseMirrorYaml,
	IBaseHalfMirrorYamlDocument
} from './basehalfMirrorYaml.js';
import { IBaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceMutationLease } from './basehalfWorkspaceMutation.js';

export const IBaseHalfCanvasMirrorService = createDecorator<IBaseHalfCanvasMirrorService>('baseHalfCanvasMirrorService');

const CANVAS_YAML_MAX_BYTES = 512 * 1024;
const CANVAS_PATCH_MAX_ATTEMPTS = 3;
const CANVAS_STRUCTURAL_TRANSACTION_MAX_ATTEMPTS = 3;
const CANVAS_ROWS_THAT_LEFT_LIMIT = 200;
const CANVAS_ANCHORS = new Set(['north', 'east', 'south', 'west']);

interface IBaseHalfCanvasAbsentReadState {
	readonly exists: false;
	readonly canvas: null;
}

interface IBaseHalfCanvasExistingReadState {
	readonly exists: true;
	readonly canvas: IBaseHalfCanvasFile | null;
	readonly contents: VSBuffer;
	/** What the read could not use from `contents`. */
	readonly damage?: IBaseHalfCanvasDamage;
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

export interface IBaseHalfCanvasFollowedMove {
	readonly from: string;
	readonly to: string;
	/** The item has no directory under `.bh/mirror/`, so it has no layouts of its own: none are looked for. */
	readonly withoutMirrorDirectory?: boolean;
}

/** A layout that takes rows in is written before one that rows leave. */
const CANVAS_FOLLOW_ORDER = { layoutBelowNewPath: 20, newParent: 30, layoutBelowOldPath: 80, oldParent: 90 };
const takesCanvasRows = (order: number): boolean => order < CANVAS_FOLLOW_ORDER.layoutBelowOldPath;
const laterCanvasFollowOrder = (first: number | undefined, second: number | undefined): number | undefined => first === undefined ? second : second === undefined ? first : Math.max(first, second);

/** What one followed move reads and writes: the layouts of the item and below it, and those of its parent folders. */
interface IBaseHalfCanvasFollowPlan {
	readonly from: string;
	readonly to: string;
	readonly sourceEntries: readonly { readonly relativePath: string; readonly resource: URI }[];
	/**
	 * By resource. Without an `order` it is the layout of a move inside one
	 * folder: the row changes its path there in one write, so the layout can be
	 * written at any time.
	 */
	readonly resources: ReadonlyMap<string, { readonly resource: URI; readonly relativePath: string; readonly order?: number }>;
}

interface IBaseHalfCanvasStructuralSnapshot extends IBaseHalfCanvasStructuralResource {
	readonly readPath: string;
	readonly read: IBaseHalfCanvasReadState;
	readonly current: IBaseHalfCanvasFile;
	next: IBaseHalfCanvasFile;
}

interface IBaseHalfCanvasCommit {
	readonly contents: VSBuffer;
	/** Set when the commit replaced bytes that could not be fully read. */
	readonly preserved?: IBaseHalfCanvasPreservedEvent;
}

interface IBaseHalfCanvasCommittedWrite extends IBaseHalfCanvasCommit {
	readonly snapshot: IBaseHalfCanvasStructuralSnapshot;
}

export type BaseHalfCanvasDamageKind = 'partial' | 'unreadable';

/**
 * What a read could not use from a stored `canvas.yaml` (mirror file
 * resilience, "Layout files"). `partial`: rows or the size were skipped.
 * `unreadable`: the file has no readable layout and reads as no layout.
 */
export interface IBaseHalfCanvasDamage {
	readonly kind: BaseHalfCanvasDamageKind;
	/** The first cause, for the log. */
	readonly reason: string;
}

export interface IBaseHalfCanvasRead {
	readonly canvas: IBaseHalfCanvasFile | null;
	readonly damage?: IBaseHalfCanvasDamage;
}

/** A write replaced canvas bytes that could not be fully read. */
export interface IBaseHalfCanvasPreservedEvent {
	readonly workspaceFolder: URI;
	/** The folder whose `canvas.yaml` was replaced (`''` is the workspace root). */
	readonly relativePath: string;
	readonly damage: IBaseHalfCanvasDamage;
	/** The replaced bytes, under `.bh/cache/recovered/`. */
	readonly recoveryCopy: URI;
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

export interface IBaseHalfCanvasSaveAppearedOptions {
	/** Save the places as they were drawn, also where a row written since lies on one. */
	readonly asDrawn?: boolean;
	/**
	 * Rows whose item is spelled differently now, on a volume where both
	 * spellings are the same path. Each takes the new spelling.
	 */
	readonly respelled?: readonly { readonly from: string; readonly to: string }[];
}

export interface IBaseHalfCanvasMirrorService {
	readonly _serviceBrand: undefined;

	/** Fires after a write replaced canvas bytes that could not be fully read. */
	readonly onDidPreserveUnreadableCanvas: Event<IBaseHalfCanvasPreservedEvent>;

	/** The readable layout. It never rejects because of the file's content:
	 *  rows that cannot be read are skipped, and a file with no readable layout
	 *  reads as no layout. It rejects only on an environmental failure. */
	readCanvas(folder: IBaseHalfCanvasFolderState): Promise<IBaseHalfCanvasFile | null>;
	/** `readCanvas` plus what the read could not use. */
	inspectCanvas(folder: IBaseHalfCanvasFolderState): Promise<IBaseHalfCanvasRead>;
	updateCardGeometry(folder: IBaseHalfCanvasFolderState, card: IBaseHalfCanvasCard, lease?: IBaseHalfWorkspaceMutationLease): Promise<IBaseHalfCanvasFile>;
	/** Atomically upsert a set of card geometries by path. An empty set is a
	 *  read-only no-op and returns the current canvas (or null when absent). */
	updateCardGeometries(folder: IBaseHalfCanvasFolderState, cards: readonly IBaseHalfCanvasCard[], lease?: IBaseHalfWorkspaceMutationLease): Promise<IBaseHalfCanvasFile | null>;
	/**
	 * Saves the places BaseHalf chose for the cards that appeared in one drawing
	 * (canvas card placement, "How a place is saved"). It only adds rows: a row
	 * that is there for a path stays as it is. In the same write it removes the
	 * rows of `gone` that BaseHalf chose and nobody changed, whose items are no
	 * longer in the folder.
	 *
	 * BaseHalf does not write over content it could not read by itself: for a
	 * layout that cannot be read in full nothing is written and the result is
	 * `undefined`. Otherwise the result is the layout as it is now.
	 *
	 * A place that a row written since the drawing lies on is chosen again, at
	 * the end of the canvas. With `asDrawn` the places are saved as they are:
	 * that is for a change the user made on the canvas they were drawn on.
	 */
	saveAppearedCards(folder: IBaseHalfCanvasFolderState, appeared: readonly IBaseHalfCanvasCard[], gone: readonly string[], lease?: IBaseHalfWorkspaceMutationLease, options?: IBaseHalfCanvasSaveAppearedOptions): Promise<IBaseHalfCanvasFile | null | undefined>;
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
	/**
	 * A node was found at `to` after it was moved outside BaseHalf (following
	 * moved items, "Relocation"). Each row moves on its own: its card row, the
	 * rows of its own canvas subtree, and on a same-parent rename the edge rows
	 * that name it. A row moves only when its place at the new path is free.
	 * When the new place holds exactly that row, only the old one is removed.
	 * Anything else stays where it is, on both sides. Unlike
	 * {@link relocateNode} it replaces nothing and can be run again.
	 */
	followNode(workspaceFolder: URI, from: string, to: string, lease?: IBaseHalfWorkspaceMutationLease): Promise<void>;
	/**
	 * {@link followNode} for the moves of one relocation run (following moved
	 * items, "Many items at once"). The result is the one that following each
	 * move by itself, in the given order, gives. Every layout is read once and
	 * written once. Returns the moves whose rows could not follow, by their
	 * index in `moves`, with the reason.
	 *
	 * The caller has checked each move: its old path names nothing and its new
	 * path names the item. The layouts below an old path are looked for before
	 * any move is written, and that is only right when no move of the same
	 * call can put a layout there.
	 */
	followNodes(workspaceFolder: URI, moves: readonly IBaseHalfCanvasFollowedMove[], lease?: IBaseHalfWorkspaceMutationLease): Promise<ReadonlyMap<number, unknown>>;
	/** A node was deleted: drop its own canvas subtree plus the parent folder's
	 *  card and any edges touching it. */
	purgeNode(workspaceFolder: URI, path: string, lease?: IBaseHalfWorkspaceMutationLease): Promise<void>;
	canvasResource(folder: IBaseHalfCanvasFolderState): URI;
}

export class BaseHalfCanvasMirrorService extends Disposable implements IBaseHalfCanvasMirrorService {
	declare readonly _serviceBrand: undefined;
	private readonly mutex = createKeyedMutex();
	/** By workspace folder, then by the path the row had: the row, and where its item went. */
	private readonly rowsThatLeft = new Map<string, Map<string, { readonly row: IBaseHalfCanvasCard; readonly wentTo: string }>>();

	private readonly _onDidPreserveUnreadableCanvas = this._register(new Emitter<IBaseHalfCanvasPreservedEvent>());
	readonly onDidPreserveUnreadableCanvas = this._onDidPreserveUnreadableCanvas.event;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IBaseHalfWorkspaceMutationCoordinator private readonly workspaceMutationCoordinator: IBaseHalfWorkspaceMutationCoordinator
	) {
		super();
	}

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

	async inspectCanvas(folder: IBaseHalfCanvasFolderState): Promise<IBaseHalfCanvasRead> {
		const read = await this.readCanvasStateAt(folder.workspaceFolder, this.canvasResource(folder), folder.relativePath);
		return { canvas: read.canvas, ...(read.exists && read.damage ? { damage: read.damage } : {}) };
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

	async saveAppearedCards(folder: IBaseHalfCanvasFolderState, appeared: readonly IBaseHalfCanvasCard[], gone: readonly string[], lease?: IBaseHalfWorkspaceMutationLease, options: IBaseHalfCanvasSaveAppearedOptions = {}): Promise<IBaseHalfCanvasFile | null | undefined> {
		const respelled = options.respelled ?? [];
		if (appeared.length === 0 && gone.length === 0 && respelled.length === 0) {
			return this.readCanvas(folder);
		}
		let damaged = false;
		const saved = await this.runWorkspaceMutation(folder.workspaceFolder, lease, () =>
			this.patchCanvas(folder.workspaceFolder, folder.relativePath, (existing, read) => {
				damaged = read.exists && read.damage !== undefined;
				if (damaged) {
					return existing;
				}
				// A row whose item is spelled differently now takes the new spelling,
				// with the edge rows that name it. Nothing at the new spelling is replaced.
				const taken = new Set(existing.cards.map(card => card.path));
				const spelling = new Map(respelled.filter(row => taken.has(row.from) && !taken.has(row.to)).map(row => [row.from, row.to]));
				const spell = (path: string) => spelling.get(path) ?? path;
				const goneRows = new Set(gone);
				const kept = existing.cards
					.filter(card => !(card.auto && goneRows.has(card.path) && !spelling.has(card.path)))
					.map(card => spelling.has(card.path) ? { ...card, path: spell(card.path) } : card);
				const present = new Set(kept.map(card => card.path));
				// The places were chosen against the layout as a drawing read it. A row
				// that another window or a move wrote since can lie on one of them: that
				// card is given the end of the canvas as it is now. With a change of the
				// user's they are saved as drawn: the user saw them there.
				const cards = [...kept];
				for (const card of appeared) {
					if (present.has(card.path)) {
						continue;
					}
					cards.push(options.asDrawn || baseHalfCanvasIsOpen(card, cards)
						? card
						: { ...card, ...baseHalfCanvasEndPlace(cards, { width: card.width, height: card.height }, baseHalfCanvasRowSpan(cards, 1)) });
				}
				if (cards.length === kept.length && kept.length === existing.cards.length && spelling.size === 0) {
					return existing;
				}
				return {
					...existing,
					cards,
					edges: spelling.size === 0 ? existing.edges : existing.edges.map(edge => ({ ...edge, from: spell(edge.from), to: spell(edge.to) }))
				};
			})
		);
		return damaged ? undefined : saved;
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

		// The row the card had at `to` before a move made in BaseHalf took it to
		// `from`: undo puts the card back where it was (canvas card placement).
		// Another item that happens to arrive at that path is a new card there.
		const remembered = this.rowsThatLeft.get(workspaceFolder.toString())?.get(to);
		const back = remembered?.wentTo === from ? remembered.row : undefined;
		let left: IBaseHalfCanvasCard | undefined;

		await this.executeCanvasStructuralTransaction(workspaceFolder, [...resources.values()], snapshots => {
			const snapshotFor = (resource: URI): IBaseHalfCanvasStructuralSnapshot => {
				const snapshot = snapshots.get(resource.toString());
				if (!snapshot) {
					throw new Error(`Missing canvas transaction snapshot for ${resource.toString()}`);
				}
				return snapshot;
			};
			const swap = (path: string): string => baseHalfIsMirrorSubtree(path, from) ? baseHalfRemapSubtreeRel(path, from, to) : path;
			left = undefined;

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
			left = oldParentSnapshot.next.cards.find(card => card.path === from);
			oldParentSnapshot.next = removeNodeFromParentCanvas(oldParentSnapshot.next, from);
			if (retireDestination) {
				newParentSnapshot.next = removeNodeFromParentCanvas(newParentSnapshot.next, to);
			}
			const incoming = carriedCanvasCard(newParentSnapshot.next, left, to, back);
			if (incoming) {
				newParentSnapshot.next = upsertCanvasCard(newParentSnapshot.next, incoming);
			}
		});

		this.rememberRowThatLeft(workspaceFolder, from, to, left);
	}

	/** Kept while the window is open and stored nowhere: the last rows that a move made in BaseHalf took out of a layout. */
	private rememberRowThatLeft(workspaceFolder: URI, from: string, to: string, left: IBaseHalfCanvasCard | undefined): void {
		const key = workspaceFolder.toString();
		const rows = this.rowsThatLeft.get(key) ?? new Map<string, { readonly row: IBaseHalfCanvasCard; readonly wentTo: string }>();
		this.rowsThatLeft.set(key, rows);
		// The card is at `to` now: what was remembered for that path is used up.
		rows.delete(to);
		if (left) {
			rows.delete(from);
			rows.set(from, { row: left, wentTo: to });
			if (rows.size > CANVAS_ROWS_THAT_LEFT_LIMIT) {
				rows.delete(rows.keys().next().value!);
			}
		}
	}

	followNode(workspaceFolder: URI, from: string, to: string, lease?: IBaseHalfWorkspaceMutationLease): Promise<void> {
		if (from === to || baseHalfIsMirrorSubtree(to, from) || baseHalfIsMirrorSubtree(from, to)) {
			return Promise.resolve();
		}
		return this.runWorkspaceMutation(workspaceFolder, lease, async () => this.followPlans(workspaceFolder, [await this.planFollowNode(workspaceFolder, { from, to })]));
	}

	followNodes(workspaceFolder: URI, moves: readonly IBaseHalfCanvasFollowedMove[], lease?: IBaseHalfWorkspaceMutationLease): Promise<ReadonlyMap<number, unknown>> {
		return this.runWorkspaceMutation(workspaceFolder, lease, () => this.followNodesLocked(workspaceFolder, moves));
	}

	private async followNodesLocked(workspaceFolder: URI, moves: readonly IBaseHalfCanvasFollowedMove[]): Promise<ReadonlyMap<number, unknown>> {
		const failed = new Map<number, unknown>();
		// The moves whose layouts can be written in one go, new places before old ones.
		let step: { readonly index: number; readonly move: IBaseHalfCanvasFollowedMove; readonly plan: IBaseHalfCanvasFollowPlan }[] = [];
		const takesRows = new Set<string>();
		const losesRows = new Set<string>();
		const write = async (): Promise<void> => {
			const together = step;
			step = [];
			takesRows.clear();
			losesRows.clear();
			if (together.length === 0) {
				return;
			}
			try {
				await this.followPlans(workspaceFolder, together.map(one => one.plan));
				return;
			} catch (error) {
				if (together.length === 1) {
					failed.set(together[0].index, error);
					return;
				}
			}
			// One layout that cannot be written does not hold the others: each move by itself.
			for (const one of together) {
				try {
					await this.followPlans(workspaceFolder, [await this.planFollowNode(workspaceFolder, one.move)]);
				} catch (error) {
					failed.set(one.index, error);
				}
			}
		};
		for (const [index, move] of moves.entries()) {
			if (move.from === move.to || baseHalfIsMirrorSubtree(move.to, move.from) || baseHalfIsMirrorSubtree(move.from, move.to)) {
				continue;
			}
			try {
				let plan = await this.planFollowNode(workspaceFolder, move);
				const ordered = (): [string, number][] => [...plan.resources].flatMap(([key, resource]) => resource.order === undefined ? [] : [[key, resource.order] as [string, number]]);
				// A layout that this move takes a row out of and an earlier one puts a
				// row into, or the other way round, has no place in one order: what
				// was collected is written first.
				if (ordered().some(([key, order]) => (takesCanvasRows(order) ? losesRows : takesRows).has(key))) {
					await write();
					plan = await this.planFollowNode(workspaceFolder, move);
				}
				for (const [key, order] of ordered()) {
					(takesCanvasRows(order) ? takesRows : losesRows).add(key);
				}
				step.push({ index, move, plan });
			} catch (error) {
				failed.set(index, error);
			}
		}
		await write();
		return failed;
	}

	private async planFollowNode(workspaceFolder: URI, move: IBaseHalfCanvasFollowedMove): Promise<IBaseHalfCanvasFollowPlan> {
		const { from, to } = move;
		// Only the layouts of the item and below it: the rest of the tree is not read for one item's move.
		const sourceEntries = move.withoutMirrorDirectory ? [] : await baseHalfWalkMirror(this.fileService, workspaceFolder, 'canvas.yaml', from);
		const oldParent = parentRel(from);
		const newParent = parentRel(to);
		const resources = new Map<string, { readonly resource: URI; readonly relativePath: string; readonly order?: number }>();
		const addResource = (resource: URI, relativePath: string, order?: number): void => {
			const key = resource.toString();
			const previous = resources.get(key);
			if (previous && previous.relativePath !== relativePath) {
				throw new Error(`Canvas relocation aliases two logical paths at ${key}`);
			}
			resources.set(key, { resource, relativePath, order: laterCanvasFollowOrder(previous?.order, order) });
		};
		// The new places are written before the old ones are cleared, so a run
		// that stops in between leaves a row in both, never in neither.
		for (const entry of sourceEntries) {
			const targetRel = baseHalfRemapSubtreeRel(entry.relativePath, from, to);
			addResource(this.canvasResourceFor(workspaceFolder, targetRel), targetRel, CANVAS_FOLLOW_ORDER.layoutBelowNewPath);
			addResource(entry.resource, entry.relativePath, CANVAS_FOLLOW_ORDER.layoutBelowOldPath);
		}
		if (oldParent === newParent) {
			addResource(this.canvasResourceFor(workspaceFolder, oldParent), oldParent);
		} else {
			addResource(this.canvasResourceFor(workspaceFolder, newParent), newParent, CANVAS_FOLLOW_ORDER.newParent);
			addResource(this.canvasResourceFor(workspaceFolder, oldParent), oldParent, CANVAS_FOLLOW_ORDER.oldParent);
		}
		return { from, to, sourceEntries, resources };
	}

	/** One read and one write of every layout, for all the moves: each is applied to what the one before left. */
	private async followPlans(workspaceFolder: URI, plans: readonly IBaseHalfCanvasFollowPlan[]): Promise<void> {
		const resources = new Map<string, { readonly resource: URI; readonly relativePath: string; readonly order?: number }>();
		for (const plan of plans) {
			for (const [key, resource] of plan.resources) {
				const previous = resources.get(key);
				if (previous && previous.relativePath !== resource.relativePath) {
					throw new Error(`Canvas relocation aliases two logical paths at ${key}`);
				}
				resources.set(key, { ...resource, order: laterCanvasFollowOrder(previous?.order, resource.order) });
			}
		}
		const specs = [...resources.values()].map(resource => ({ ...resource, order: resource.order ?? CANVAS_FOLLOW_ORDER.oldParent }));
		await this.executeCanvasStructuralTransaction(workspaceFolder, specs, snapshots => {
			for (const plan of plans) {
				this.applyFollowPlan(workspaceFolder, plan, snapshots);
			}
		});
	}

	private applyFollowPlan(workspaceFolder: URI, plan: IBaseHalfCanvasFollowPlan, snapshots: ReadonlyMap<string, IBaseHalfCanvasStructuralSnapshot>): void {
		const { from, to, sourceEntries } = plan;
		const oldParent = parentRel(from);
		const newParent = parentRel(to);
		const snapshotFor = (resource: URI): IBaseHalfCanvasStructuralSnapshot => {
			const snapshot = snapshots.get(resource.toString());
			if (!snapshot) {
				throw new Error(`Missing canvas transaction snapshot for ${resource.toString()}`);
			}
			return snapshot;
		};
		const swap = (path: string): string => baseHalfIsMirrorSubtree(path, from) ? baseHalfRemapSubtreeRel(path, from, to) : path;

		// A layout that cannot be read in full is left as it is, on both sides:
		// moving its readable rows would rewrite it, and filling it would replace it.
		const damaged = (snapshot: IBaseHalfCanvasStructuralSnapshot): boolean => snapshot.read.exists && snapshot.read.damage !== undefined;
		for (const entry of sourceEntries) {
			const source = snapshotFor(entry.resource);
			const target = snapshotFor(this.canvasResourceFor(workspaceFolder, baseHalfRemapSubtreeRel(entry.relativePath, from, to)));
			if (damaged(source) || damaged(target)) {
				continue;
			}
			const filled = fillFreeCanvasRows(target.next, source.next, swap);
			target.next = filled.target;
			source.next = filled.source;
		}

		const oldParentSnapshot = snapshotFor(this.canvasResourceFor(workspaceFolder, oldParent));
		if (damaged(oldParentSnapshot)) {
			return;
		}
		if (oldParent === newParent) {
			oldParentSnapshot.next = followNodeWithinParent(oldParentSnapshot.next, from, to);
			return;
		}
		const newParentSnapshot = snapshotFor(this.canvasResourceFor(workspaceFolder, newParent));
		if (damaged(newParentSnapshot)) {
			return;
		}
		const carried = oldParentSnapshot.next.cards.find(card => card.path === from);
		if (!carried) {
			return;
		}
		const existing = newParentSnapshot.next.cards.find(card => card.path === to);
		if (existing && !existing.auto) {
			// A row of the user's stands, and the row that would follow stays at the old path.
			return;
		}
		// A row BaseHalf chose is there when the item was drawn as a new card
		// before it was known to be a moved one, or when an earlier run of this
		// move stopped after this write. It keeps its place and takes the size of
		// the row that follows, so a second run changes nothing here. A larger
		// size that would reach a neighbour is given the end of the canvas.
		const sized = existing ? { ...existing, width: carried.width, height: carried.height } : undefined;
		const incoming = sized && baseHalfCanvasIsOpen(sized, newParentSnapshot.next.cards.filter(card => card.path !== to))
			? sized
			: carriedCanvasCard(newParentSnapshot.next, carried, to);
		if (incoming) {
			newParentSnapshot.next = upsertCanvasCard(newParentSnapshot.next, incoming);
		}
		// Its edge rows connected it to the cards of the old folder: they drop there, as on a workbench move.
		oldParentSnapshot.next = removeNodeFromParentCanvas(oldParentSnapshot.next, from);
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
						committed.push({ snapshot, ...await this.commitCanvasState(workspaceFolder, snapshot.resource, snapshot.next, snapshot.read) });
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
					this.reportPreserved(committed);
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
		const read = await this.readCanvasStateAt(workspaceFolder, spec.resource, spec.relativePath);
		if (spec.alternateRelativePath !== undefined && read.exists && read.damage?.kind === 'unreadable') {
			// The same bytes may already carry the alternate identity.
			const alternate = canvasReadStateOf(read.contents, spec.alternateRelativePath);
			if (alternate.damage?.kind !== 'unreadable') {
				return { readPath: spec.alternateRelativePath, read: alternate };
			}
		}
		return { readPath: spec.relativePath, read };
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

	/** Commits `canvas` against the exact bytes of `expected`. Bytes that could
	 * not be fully read are saved as a recovery copy before they are replaced;
	 * if that copy cannot be saved, the canvas file is left unchanged. */
	private async commitCanvasState(workspaceFolder: URI, resource: URI, canvas: IBaseHalfCanvasFile, expected: IBaseHalfCanvasReadState): Promise<IBaseHalfCanvasCommit> {
		const contents = encodeCanvasFile(canvas, resource);
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
		// Layouts stay out of git: the ignore file is there before any layout is.
		await baseHalfEnsureMirrorIgnoreFile(this.fileService, workspaceFolder);
		await this.fileService.createFolder(dirname(resource));
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
		let preserved: IBaseHalfCanvasPreservedEvent | undefined;
		if (expected.exists && expected.damage) {
			preserved = {
				workspaceFolder,
				relativePath: canvas.path,
				damage: expected.damage,
				recoveryCopy: await baseHalfPreserveMirrorBytes(this.fileService, workspaceFolder, resource, expected.contents)
			};
		}
		await baseHalfCommitMirrorFile(this.fileService, resource, contents, expected.exists ? expected.contents : null);
		return { contents, ...(preserved ? { preserved } : {}) };
	}

	private reportPreserved(commits: readonly IBaseHalfCanvasCommit[]): void {
		for (const commit of commits) {
			if (commit.preserved) {
				this._onDidPreserveUnreadableCanvas.fire(commit.preserved);
			}
		}
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

			// A file with no readable layout reads as no layout and is left in
			// place, byte for byte, instead of turning a node delete into
			// unrelated layout data loss.
			const snapshot = await this.readCanvasAt(workspaceFolder, entry.resource, entry.relativePath);
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
	 *  avoiding an unguarded delete after the guarded commit. The update applies
	 *  to the readable layout, so content that cannot be read never refuses it. */
	private patchCanvas(workspaceFolder: URI, folderRel: string, update: (existing: IBaseHalfCanvasFile, read: IBaseHalfCanvasReadState) => IBaseHalfCanvasFile): Promise<IBaseHalfCanvasFile> {
		const resource = this.canvasResourceFor(workspaceFolder, folderRel);
		return this.mutex.runExclusive(resource.toString(), async () => {
			for (let attempt = 0; attempt < CANVAS_PATCH_MAX_ATTEMPTS; attempt++) {
				const read = await this.readCanvasStateAt(workspaceFolder, resource, folderRel);
				const existing = read.canvas ?? { path: folderRel, cards: [], edges: [] };
				const next = update(existing, read);
				if (next === existing) {
					return next;
				}
				const isEmpty = next.cards.length === 0 && next.edges.length === 0 && !next.size;
				if (isEmpty && read.canvas === null) {
					return next;
				}

				try {
					this.reportPreserved([await this.commitCanvasState(workspaceFolder, resource, next, read)]);
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

		return canvasReadStateOf(content.value, relativePath);
	}
}

/** The read state of stored bytes for the folder `relativePath`. */
function canvasReadStateOf(contents: VSBuffer, relativePath: string): IBaseHalfCanvasExistingReadState {
	const decoded = decodeCanvasFile(contents.toString(), relativePath);
	return {
		exists: true,
		canvas: isEmptyCanvas(decoded.canvas) ? null : decoded.canvas,
		contents,
		...(decoded.damage ? { damage: decoded.damage } : {})
	};
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
	if (snapshot.read.exists && snapshot.read.damage?.kind === 'unreadable') {
		// A file with no readable layout is replaced only by incoming layout.
		// An empty next state leaves it in place, byte for byte.
		return isEmptyCanvas(snapshot.next);
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
/**
 * The row of a card that goes to another folder (canvas card placement). It
 * keeps its size and goes to the end of that canvas, as a row BaseHalf chose:
 * the coordinates it had belong to the canvas it left.
 *
 * - `back` is the row the card had in this folder before a move made in
 *   BaseHalf took it away. It is restored when its place is still open, so
 *   that undo puts the card where it was.
 * - A folder without card rows gets none: the card appears with the others
 *   when that canvas is first drawn.
 *
 * The place depends only on the other rows of the layout, so relocation of a
 * followed item stays safe to repeat.
 */
function carriedCanvasCard(canvas: IBaseHalfCanvasFile, carried: IBaseHalfCanvasCard | undefined, to: string, back?: IBaseHalfCanvasCard): IBaseHalfCanvasCard | undefined {
	const taken = canvas.cards.filter(card => card.path !== to);
	if (back && baseHalfCanvasIsOpen(back, taken)) {
		return { ...back, path: to };
	}
	// The place it had is taken: it goes to the end, with the size it has, or
	// had here when the other folder kept no row for it.
	const source = carried ?? back;
	if (!source || taken.length === 0) {
		return undefined;
	}
	const size = { width: source.width, height: source.height };
	return { path: to, kind: source.kind, ...baseHalfCanvasEndPlace(taken, size, baseHalfCanvasRowSpan(taken, 1)), ...size, auto: true };
}

/**
 * What a row does that follows its item to a path where a row may already be
 * (following moved items, "Relocation"):
 * - `move`: nothing is there;
 * - `drop`: the same row is there, as an earlier run of this move left it;
 * - `replace`: a row BaseHalf chose is there. The item was drawn as a new card
 *   before it was known to be a moved one, and that row gives way;
 * - `keep`: a row of the user's is there. It stands, and the row that would
 *   follow stays at the old path.
 */
function followingRow(incoming: IBaseHalfCanvasCard, existing: IBaseHalfCanvasCard | undefined): 'move' | 'drop' | 'replace' | 'keep' {
	if (!existing) {
		return 'move';
	}
	if (canvasCardsEqual(existing, incoming)) {
		return 'drop';
	}
	return existing.auto ? 'replace' : 'keep';
}

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

function canvasCardsEqual(first: IBaseHalfCanvasCard, second: IBaseHalfCanvasCard): boolean {
	return first.path === second.path && first.kind === second.kind && first.x === second.x && first.y === second.y && first.width === second.width && first.height === second.height;
}

function canvasEdgesEqual(first: IBaseHalfCanvasEdge, second: IBaseHalfCanvasEdge): boolean {
	return first.from === second.from && first.to === second.to && first.from_anchor === second.from_anchor && first.to_anchor === second.to_anchor;
}

/**
 * Moves the rows of `source` into the free places of `target`, with their
 * paths mapped by `swap`. A row whose place holds exactly that row leaves the
 * source too. A row whose place holds anything else stays in the source, and
 * the target keeps what it has.
 */
function fillFreeCanvasRows(target: IBaseHalfCanvasFile, source: IBaseHalfCanvasFile, swap: (path: string) => string): { readonly target: IBaseHalfCanvasFile; readonly source: IBaseHalfCanvasFile } {
	let cards = [...target.cards];
	const keptCards: IBaseHalfCanvasCard[] = [];
	for (const card of source.cards) {
		const incoming = { ...card, path: swap(card.path) };
		const existing = cards.find(other => other.path === incoming.path);
		switch (followingRow(incoming, existing)) {
			case 'move': cards.push(incoming); break;
			case 'replace': cards = cards.map(other => other === existing ? incoming : other); break;
			case 'keep': keptCards.push(card); break;
			case 'drop': break;
		}
	}
	const edges = [...target.edges];
	const keptEdges: IBaseHalfCanvasEdge[] = [];
	for (const edge of source.edges) {
		const incoming = { ...edge, from: swap(edge.from), to: swap(edge.to) };
		const existing = edges.find(other => other.from === incoming.from && other.to === incoming.to);
		if (!existing) {
			edges.push(incoming);
		} else if (!canvasEdgesEqual(existing, incoming)) {
			keptEdges.push(edge);
		}
	}
	const sizeMoves = source.size !== undefined && (target.size === undefined || (target.size.width === source.size.width && target.size.height === source.size.height));
	const { size: targetSize, ...targetRest } = target;
	const { size: sourceSize, ...sourceRest } = source;
	const nextSize = targetSize ?? (sizeMoves ? sourceSize : undefined);
	return {
		target: { ...targetRest, ...(nextSize ? { size: nextSize } : {}), cards, edges },
		source: { ...sourceRest, ...(sourceSize && !sizeMoves ? { size: sourceSize } : {}), cards: keptCards, edges: keptEdges }
	};
}

/** {@link fillFreeCanvasRows} for one card that changed its name inside one canvas. */
function followNodeWithinParent(canvas: IBaseHalfCanvasFile, from: string, to: string): IBaseHalfCanvasFile {
	const swap = (path: string): string => path === from ? to : path;
	let cards = canvas.cards;
	const carried = cards.find(card => card.path === from);
	if (carried) {
		const incoming = { ...carried, path: to };
		const existing = cards.find(card => card.path === to);
		switch (followingRow(incoming, existing)) {
			case 'move': cards = cards.map(card => card === carried ? incoming : card); break;
			// The card has the place and the size it had under its old path.
			case 'replace': cards = cards.filter(card => card !== existing).map(card => card === carried ? incoming : card); break;
			case 'drop': cards = cards.filter(card => card !== carried); break;
			case 'keep': break;
		}
	}
	const edges: IBaseHalfCanvasEdge[] = [];
	for (const edge of canvas.edges) {
		if (edge.from !== from && edge.to !== from) {
			edges.push(edge);
			continue;
		}
		const incoming = { ...edge, from: swap(edge.from), to: swap(edge.to) };
		if (incoming.from === incoming.to) {
			continue;
		}
		const existing = canvas.edges.find(other => other.from === incoming.from && other.to === incoming.to);
		if (!existing) {
			edges.push(incoming);
		} else if (!canvasEdgesEqual(existing, incoming)) {
			edges.push(edge);
		}
	}
	return { ...canvas, cards, edges };
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
		`path: ${baseHalfMirrorYamlQuote(canvas.path)}`
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
				`  - path: ${baseHalfMirrorYamlQuote(card.path)}`,
				`    kind: ${card.kind}`,
				`    x: ${formatNumber(card.x)}`,
				`    y: ${formatNumber(card.y)}`,
				`    width: ${formatNumber(card.width)}`,
				`    height: ${formatNumber(card.height)}`
			);
			if (card.auto) {
				lines.push('    auto: true');
			}
		}
	}

	lines.push('edges:');
	if (canvas.edges.length === 0) {
		lines[lines.length - 1] = 'edges: []';
	} else {
		for (const edge of canvas.edges) {
			lines.push(
				`  - from: ${baseHalfMirrorYamlQuote(edge.from)}`,
				`    from_anchor: ${edge.from_anchor}`,
				`    to: ${baseHalfMirrorYamlQuote(edge.to)}`,
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
	// The written precision decides: a size that rounds to zero would be
	// written as a row the reader skips.
	if (Number(formatNumber(value)) <= 0) {
		throw new RangeError(`Cannot serialize canvas: ${label} must be positive`);
	}
}

function formatNumber(value: number): string {
	return String(Number(value.toFixed(4)));
}

/**
 * The bytes of a canvas after the write check: the reader must accept all of
 * them and return what was serialized, or nothing is written (mirror file
 * resilience, "Write check"). Rows are made canonical first, as on reading.
 */
function encodeCanvasFile(canvas: IBaseHalfCanvasFile, resource: URI): VSBuffer {
	const text = serializeCanvasFile({
		path: canvas.path,
		...(canvas.size ? { size: canvas.size } : {}),
		cards: lastByKey(canvas.cards, card => card.path),
		edges: lastByKey(canvas.edges, edge => `${edge.from}\u0000${edge.to}`)
	});
	const decoded = decodeCanvasFile(text, canvas.path);
	if (decoded.damage) {
		throw new BaseHalfMirrorWriteRejected(resource, decoded.damage.reason);
	}
	if (serializeCanvasFile(decoded.canvas) !== text) {
		throw new BaseHalfMirrorWriteRejected(resource, 'the layout changed when it was read back');
	}
	return VSBuffer.fromString(text);
}

interface IBaseHalfCanvasDecoded {
	/** The readable layout; empty when nothing could be read. */
	readonly canvas: IBaseHalfCanvasFile;
	readonly damage?: IBaseHalfCanvasDamage;
}

/**
 * Reads stored canvas text for the folder `expectedPath`. It never throws for
 * content: rows that cannot be read are skipped (`partial` damage), and text
 * that is not this folder's canvas reads as no layout (`unreadable` damage).
 */
function decodeCanvasFile(raw: string, expectedPath: string): IBaseHalfCanvasDecoded {
	const unreadable = (reason: string): IBaseHalfCanvasDecoded => ({ canvas: emptyCanvas(expectedPath), damage: { kind: 'unreadable', reason } });
	let document: IBaseHalfMirrorYamlDocument;
	try {
		document = baseHalfParseMirrorYaml(raw, 'canvas');
	} catch (error) {
		if (error instanceof BaseHalfMirrorYamlUnreadable) {
			return unreadable(error.reason);
		}
		throw error;
	}
	const root = document.root;
	if (root === null) {
		return { canvas: emptyCanvas(expectedPath) };
	}

	const path = baseHalfMirrorYamlString(baseHalfMirrorYamlProperty(root, 'path'));
	if (path === undefined) {
		return unreadable('path must be a string');
	}
	if (!baseHalfMirrorPathNamesNode(path, expectedPath)) {
		return unreadable(`path must be "${expectedPath}"`);
	}
	// The folder was renamed outside BaseHalf in case or normalization only:
	// its rows name their cards under the old spelling of the folder.
	const respell = (rowPath: string) => path !== expectedPath && path !== '' && rowPath.startsWith(`${path}/`)
		? `${expectedPath}${rowPath.slice(path.length)}`
		: rowPath;

	// Rows after the line the parser stopped at were never read.
	const skipped: string[] = document.unparsed ? [document.unparsed] : [];
	const size = decodeCanvasSize(baseHalfMirrorYamlProperty(root, 'size'), skipped);
	const cards = decodeCanvasRows(root, 'cards', decodeCanvasCard, skipped).map(card => ({ ...card, path: respell(card.path) }));
	const edges = decodeCanvasRows(root, 'edges', decodeCanvasEdge, skipped).map(edge => ({ ...edge, from: respell(edge.from), to: respell(edge.to) }));
	return {
		canvas: {
			path: expectedPath,
			...(size ? { size } : {}),
			cards: lastByKey(cards, card => card.path),
			edges: lastByKey(edges, edge => `${edge.from}\u0000${edge.to}`)
		},
		...(skipped.length > 0 ? { damage: { kind: 'partial', reason: skipped[0] } } : {})
	};
}

function lastByKey<T>(values: readonly T[], keyOf: (value: T) => string): T[] {
	const byKey = new Map<string, T>();
	for (const value of values) {
		byKey.set(keyOf(value), value);
	}
	return [...byKey.values()];
}

/** The readable rows of a list. `decode` returns a row or why it cannot be
 * read, and every such cause is added to `skipped`. */
function decodeCanvasRows<T extends object>(root: YamlMapNode, key: 'cards' | 'edges', decode: (node: YamlNode) => T | string, skipped: string[]): T[] {
	const items = baseHalfMirrorYamlItems(baseHalfMirrorYamlProperty(root, key));
	if (!items) {
		skipped.push(`${key} must be an array`);
		return [];
	}

	const rows: T[] = [];
	items.forEach((item, index) => {
		const row = decode(item);
		if (typeof row === 'string') {
			skipped.push(`${key}[${index}]${row}`);
		} else {
			rows.push(row);
		}
	});
	return rows;
}

function decodeCanvasCard(node: YamlNode): IBaseHalfCanvasCard | string {
	const map = baseHalfMirrorYamlMap(node);
	if (!map) {
		return ' must be an object';
	}
	const path = baseHalfMirrorYamlString(baseHalfMirrorYamlProperty(map, 'path'));
	if (path === undefined) {
		return '.path must be a string';
	}
	const kind = baseHalfMirrorYamlString(baseHalfMirrorYamlProperty(map, 'kind'));
	if (kind !== 'file' && kind !== 'folder') {
		return '.kind must be file or folder';
	}
	const x = baseHalfMirrorYamlNumber(baseHalfMirrorYamlProperty(map, 'x'));
	const y = baseHalfMirrorYamlNumber(baseHalfMirrorYamlProperty(map, 'y'));
	if (x === undefined || y === undefined) {
		return ' must have a finite x and y';
	}
	const size = decodeCanvasPositiveSize(map);
	if (!size) {
		return ' must have a positive width and height';
	}
	// Anything but `true` reads as a row of the user's, which BaseHalf never replaces.
	const auto = baseHalfMirrorYamlBoolean(baseHalfMirrorYamlProperty(map, 'auto')) === true;
	return { path, kind, x, y, width: size.width, height: size.height, ...(auto ? { auto } : {}) };
}

function decodeCanvasEdge(node: YamlNode): IBaseHalfCanvasEdge | string {
	const map = baseHalfMirrorYamlMap(node);
	if (!map) {
		return ' must be an object';
	}
	const from = baseHalfMirrorYamlString(baseHalfMirrorYamlProperty(map, 'from'));
	const to = baseHalfMirrorYamlString(baseHalfMirrorYamlProperty(map, 'to'));
	if (from === undefined || to === undefined) {
		return ' must have a string from and to';
	}
	const fromAnchor = baseHalfMirrorYamlString(baseHalfMirrorYamlProperty(map, 'from_anchor'));
	const toAnchor = baseHalfMirrorYamlString(baseHalfMirrorYamlProperty(map, 'to_anchor'));
	if (!isCanvasAnchor(fromAnchor) || !isCanvasAnchor(toAnchor)) {
		return ' must have a canvas anchor at both ends';
	}
	return { from, from_anchor: fromAnchor, to, to_anchor: toAnchor };
}

function isCanvasAnchor(value: string | undefined): value is IBaseHalfCanvasEdge['from_anchor'] {
	return value !== undefined && CANVAS_ANCHORS.has(value);
}

function decodeCanvasSize(node: YamlNode | undefined, skipped: string[]): IBaseHalfCanvasSize | undefined {
	if (baseHalfMirrorYamlAbsent(node)) {
		return undefined;
	}
	const map = baseHalfMirrorYamlMap(node);
	const size = map && decodeCanvasPositiveSize(map);
	if (!size) {
		skipped.push('size must have a positive width and height');
	}
	return size;
}

function decodeCanvasPositiveSize(map: YamlMapNode): IBaseHalfCanvasSize | undefined {
	const width = baseHalfMirrorYamlNumber(baseHalfMirrorYamlProperty(map, 'width'));
	const height = baseHalfMirrorYamlNumber(baseHalfMirrorYamlProperty(map, 'height'));
	// The written precision decides, as it does when the file is written: a
	// size that would be written as zero is not a size.
	return width !== undefined && height !== undefined && Number(formatNumber(width)) > 0 && Number(formatNumber(height)) > 0 ? { width, height } : undefined;
}

registerSingleton(IBaseHalfCanvasMirrorService, BaseHalfCanvasMirrorService, InstantiationType.Delayed);
