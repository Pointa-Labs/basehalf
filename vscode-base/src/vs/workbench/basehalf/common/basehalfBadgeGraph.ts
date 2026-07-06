/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import {
	BaseHalfBadgeKind,
	IBaseHalfBadgeFile,
	IBaseHalfBadgeMirrorService,
	IBaseHalfBadgeNode,
	IBaseHalfBadgeReadResult
} from './basehalfBadgeMirror.js';
import { createKeyedMutex } from './basehalfKeyedMutex.js';
import { baseHalfIsMirrorSubtree, baseHalfMirrorPathSegments, baseHalfRemapSubtreeRel } from './basehalfMirrorTree.js';

export const IBaseHalfBadgeGraphService = createDecorator<IBaseHalfBadgeGraphService>('baseHalfBadgeGraphService');

/**
 * The badge SEMANTIC layer: every mutation of the reference graph goes through
 * here so its invariants hold no matter which surface (canvas, card detail,
 * file-operation cascade) triggered it:
 *
 *  - A reference A→B is recorded on BOTH ends — A's `references` and B's
 *    `referenced_by` — so "who points at me?" is one read of one badge.yaml.
 *  - The overlay stays SPARSE: a badge that carries no human-authored content
 *    (no description, no graph edges, not orphaned) is deleted, not written
 *    empty. A stub badge materialized only to hold a backlink dies with its
 *    last backlink.
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
	 *  otherwise-empty badge removes the file (sparse overlay). */
	updateDescription(node: IBaseHalfBadgeNode, description: string): Promise<IBaseHalfBadgeFile | null>;
	/** Record source→target on both ends, materializing minimal badges as
	 *  needed. Rejects self-references. Idempotent. */
	addReference(source: IBaseHalfBadgeNode, target: IBaseHalfBadgeNode): Promise<void>;
	/** Remove source→target from both ends, pruning badges the removal
	 *  emptied. Tolerates either side already missing. */
	removeReference(source: IBaseHalfBadgeNode, target: IBaseHalfBadgeNode): Promise<void>;
	/** One node's badge, or null when it has none (delegates to the mirror). */
	readBadge(node: IBaseHalfBadgeNode): Promise<IBaseHalfBadgeFile | null>;
	/** Every badge in the workspace (delegates to the mirror walk). */
	listBadges(workspaceFolder: URI): Promise<IBaseHalfBadgeReadResult>;
	/** Mark an existing badge orphan (disk node gone), preserving all content.
	 *  Missing badge is a no-op. */
	markOrphan(node: IBaseHalfBadgeNode): Promise<void>;
	/** Clear the orphan flag (disk node reappeared). Missing badge is a no-op. */
	clearOrphan(node: IBaseHalfBadgeNode): Promise<void>;
	/** Sweep every badge whose disk target is gone (or changed kind) and mark it
	 *  orphan. Returns the relative paths freshly orphaned. Run on workspace
	 *  open to catch deletions that happened outside the app. */
	pruneDangling(workspaceFolder: URI): Promise<string[]>;
	/** A node moved `from` → `to`: carry its badge (folder: plus every annotated
	 *  descendant), rewrite the graph on both sides, drop the orphan flag, and
	 *  scrub backlinks whose referrer badge no longer exists. Nodes without a
	 *  badge are a quiet no-op (the overlay is sparse). */
	renameNode(workspaceFolder: URI, from: string, to: string, kind: BaseHalfBadgeKind): Promise<void>;
	/** A node was deleted in-app: remove its badge (folder: plus descendants)
	 *  and scrub its backlinks off every outbound target. Dangling INBOUND
	 *  references (a referrer still pointing at the deleted path) are left in
	 *  place — they are the referrer's authored content and derived edges simply
	 *  stop drawing them. */
	deleteNode(workspaceFolder: URI, path: string, kind: BaseHalfBadgeKind): Promise<void>;
}

export class BaseHalfBadgeGraphService implements IBaseHalfBadgeGraphService {
	declare readonly _serviceBrand: undefined;
	private readonly workspaceMutex = createKeyedMutex();

	constructor(
		@IBaseHalfBadgeMirrorService private readonly badgeMirrorService: IBaseHalfBadgeMirrorService,
		@IFileService private readonly fileService: IFileService
	) { }

	updateDescription(node: IBaseHalfBadgeNode, description: string): Promise<IBaseHalfBadgeFile | null> {
		const trimmed = description.trim();
		return this.badgeMirrorService.patchBadge(node, current => {
			if (current === null && !trimmed) {
				return null;
			}

			const base = current ?? emptyBadge(node.relativePath, node.kind);
			return pruneEmpty({
				...base,
				...(trimmed ? { description: trimmed } : { description: undefined })
			});
		});
	}

	addReference(source: IBaseHalfBadgeNode, target: IBaseHalfBadgeNode): Promise<void> {
		if (source.relativePath === target.relativePath) {
			throw new Error(`A badge cannot reference itself: ${source.relativePath}`);
		}

		return this.workspaceMutex.runExclusive(source.workspaceFolder.toString(), async () => {
			await this.badgeMirrorService.patchBadge(source, current => {
				const base = current ?? emptyBadge(source.relativePath, source.kind);
				return {
					...base,
					references: appendUnique(base.references, target.relativePath)
				};
			});
			await this.badgeMirrorService.patchBadge(target, current => {
				const base = current ?? emptyBadge(target.relativePath, target.kind);
				return {
					...base,
					referenced_by: appendUnique(base.referenced_by, source.relativePath)
				};
			});
		});
	}

	removeReference(source: IBaseHalfBadgeNode, target: IBaseHalfBadgeNode): Promise<void> {
		return this.workspaceMutex.runExclusive(source.workspaceFolder.toString(), async () => {
			await this.badgeMirrorService.patchBadge(source, current => {
				if (current === null) {
					return null;
				}

				return pruneEmpty({
					...current,
					references: current.references.filter(candidate => candidate !== target.relativePath)
				});
			});
			await this.badgeMirrorService.patchBadge(target, current => {
				if (current === null) {
					return null;
				}

				return pruneEmpty({
					...current,
					referenced_by: current.referenced_by.filter(candidate => candidate !== source.relativePath)
				});
			});
		});
	}

	readBadge(node: IBaseHalfBadgeNode): Promise<IBaseHalfBadgeFile | null> {
		return this.badgeMirrorService.readBadge(node);
	}

	listBadges(workspaceFolder: URI): Promise<IBaseHalfBadgeReadResult> {
		return this.badgeMirrorService.listBadges(workspaceFolder);
	}

	async markOrphan(node: IBaseHalfBadgeNode): Promise<void> {
		await this.badgeMirrorService.patchBadge(node, current => current === null ? null : { ...current, orphan: true });
	}

	async clearOrphan(node: IBaseHalfBadgeNode): Promise<void> {
		await this.badgeMirrorService.patchBadge(node, current => {
			if (current === null || current.orphan !== true) {
				return current;
			}

			const { orphan: _orphan, ...rest } = current;
			// A stub that existed only to carry the orphan flag dies with it.
			return pruneEmpty(rest);
		});
	}

	async pruneDangling(workspaceFolder: URI): Promise<string[]> {
		const { badges } = await this.badgeMirrorService.listBadges(workspaceFolder);
		const orphaned: string[] = [];
		for (const badge of badges.values()) {
			if (badge.orphan === true) {
				continue;
			}

			if (await this.diskTargetExists(workspaceFolder, badge.path, badge.kind)) {
				continue;
			}

			await this.markOrphan(this.node(workspaceFolder, badge.path, badge.kind));
			orphaned.push(badge.path);
		}

		return orphaned;
	}

	renameNode(workspaceFolder: URI, from: string, to: string, kind: BaseHalfBadgeKind): Promise<void> {
		if (from === to) {
			return Promise.resolve();
		}
		if (kind === 'folder' && baseHalfIsMirrorSubtree(to, from)) {
			// Physically impossible on disk (fs rejects moving a folder into
			// itself); refuse defensively rather than corrupt the graph.
			throw new Error(`Cannot move "${from}" into its own subtree "${to}"`);
		}

		return this.workspaceMutex.runExclusive(workspaceFolder.toString(), async () => {
			await this.moveBadgeAndCascade(workspaceFolder, from, to);

			if (kind === 'folder') {
				// A folder rename must carry every annotated DESCENDANT: the
				// folder's own badge moved above, but children still live at the
				// old prefix. Each move rewrites both graph directions, so
				// intra-subtree references converge once every endpoint has moved.
				const { badges } = await this.badgeMirrorService.listBadges(workspaceFolder);
				const prefix = `${from}/`;
				for (const badge of badges.values()) {
					if (badge.path.startsWith(prefix)) {
						await this.moveBadgeAndCascade(workspaceFolder, badge.path, baseHalfRemapSubtreeRel(badge.path, from, to));
					}
				}
			}
		});
	}

	deleteNode(workspaceFolder: URI, path: string, kind: BaseHalfBadgeKind): Promise<void> {
		return this.workspaceMutex.runExclusive(workspaceFolder.toString(), async () => {
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

	/** Move ONE badge and rewrite its graph neighbourhood. Runs under the
	 *  workspace mutex (callers hold it). */
	private async moveBadgeAndCascade(workspaceFolder: URI, from: string, to: string): Promise<void> {
		const fromNode = this.node(workspaceFolder, from, 'file');
		const source = await this.badgeMirrorService.readBadge(fromNode);
		if (source === null) {
			return;
		}

		// Write the copy BEFORE deleting the source so a crash between the two
		// leaves both (recoverable) rather than neither (the note lost). The
		// orphan flag is dropped — the node just (re)appeared at `to`. A badge
		// already at `to` reflects a node this move overwrote: its authored
		// content dies with the disk overwrite, but its BACKLINKS describe live
		// references still pointing at `to`, so they merge into the moved badge.
		const { orphan: _orphan, ...rest } = source;
		const toNode = this.node(workspaceFolder, to, source.kind);
		const collision = await this.badgeMirrorService.readBadge(toNode);
		const inheritedBacklinks = (collision?.referenced_by ?? []).filter(referrer => !source.referenced_by.includes(referrer) && referrer !== to);
		let moved: IBaseHalfBadgeFile = { ...rest, path: to, referenced_by: [...source.referenced_by, ...inheritedBacklinks] };
		await this.badgeMirrorService.patchBadge(toNode, () => moved);
		await this.badgeMirrorService.patchBadge(fromNode, () => null);

		// Outbound: each target's backlink FROM `from` becomes FROM `to`. A
		// missing target badge is a no-op — never materialize one just to
		// repoint a backlink that isn't there.
		for (const target of moved.references) {
			await this.badgeMirrorService.patchBadge(this.node(workspaceFolder, target, 'file'), current => {
				if (current === null) {
					return null;
				}

				return {
					...current,
					referenced_by: current.referenced_by.map(candidate => candidate === from ? to : candidate)
				};
			});
		}

		// Inbound: each referrer's reference TO `from` becomes TO `to`. Track
		// which referrers actually exist so a backlink whose referrer badge was
		// externally deleted (a phantom) does not survive the move.
		const liveReferrers = new Set<string>();
		for (const referrer of moved.referenced_by) {
			const rewritten = await this.badgeMirrorService.patchBadge(this.node(workspaceFolder, referrer, 'file'), current => {
				if (current === null) {
					return null;
				}

				return {
					...current,
					references: current.references.map(candidate => candidate === from ? to : candidate)
				};
			});
			if (rewritten !== null) {
				liveReferrers.add(referrer);
			}
		}

		if (moved.referenced_by.some(referrer => !liveReferrers.has(referrer))) {
			moved = { ...moved, referenced_by: moved.referenced_by.filter(referrer => liveReferrers.has(referrer)) };
			await this.badgeMirrorService.patchBadge(toNode, () => pruneEmpty(moved));
		}
	}

	/** Delete ONE badge and scrub its backlinks off its outbound targets. Runs
	 *  under the workspace mutex (callers hold it). */
	private async purgeBadge(workspaceFolder: URI, path: string): Promise<void> {
		const node = this.node(workspaceFolder, path, 'file');
		const existing = await this.badgeMirrorService.readBadge(node);
		if (existing === null) {
			return;
		}

		await this.badgeMirrorService.patchBadge(node, () => null);
		for (const target of existing.references) {
			await this.badgeMirrorService.patchBadge(this.node(workspaceFolder, target, 'file'), current => {
				if (current === null) {
					return null;
				}

				return pruneEmpty({
					...current,
					referenced_by: current.referenced_by.filter(candidate => candidate !== path)
				});
			});
		}
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

/** A badge with no human-authored content and no graph edges has no reason to
 *  exist — return null so patchBadge removes the file (sparse overlay). */
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

registerSingleton(IBaseHalfBadgeGraphService, BaseHalfBadgeGraphService, InstantiationType.Delayed);
