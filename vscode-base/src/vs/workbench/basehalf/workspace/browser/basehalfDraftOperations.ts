/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { basename, relativePath as getRelativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { FileOperationResult, IFileService, IFileStat, toFileOperationResult } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { BaseHalfCanvasStateConflict, IBaseHalfCanvasMirrorService } from '../../canvas/common/basehalfCanvasMirror.js';
import { IBaseHalfCanvasCard, IBaseHalfCanvasEdge } from '../../canvas/common/basehalfCanvasModel.js';
import { IBaseHalfCanvasFolderState } from '../../navigation/common/basehalfCanvasNavigation.js';
import { IBaseHalfBadgeMirrorService } from '../../references/common/basehalfBadgeMirror.js';
import { baseHalfIsDraft, baseHalfIsDraftInformation, baseHalfReadDraftFacts } from '../../video/common/basehalfGenerationDraft.js';
import { BASEHALF_GENERATION_INFO_FILE, baseHalfGenerationKindOfPath, isBaseHalfGenerationTaskEnded } from '../../video/common/basehalfGenerationInfo.js';
import { IBaseHalfDraftMoveOptions, IBaseHalfDraftOperations, IBaseHalfDraftSnapshot, IBaseHalfGenerationTaskStore } from '../../video/common/basehalfVideoGeneration.js';
import { baseHalfIsWorkspaceFolderMarked } from '../common/basehalfLegacyCleanup.js';
import { baseHalfRelocateBadgeText } from '../common/basehalfMirrorCascadeOperation.js';
import { baseHalfDeleteMirrorFile, baseHalfReadMirrorFile, baseHalfWriteMirrorFile } from '../common/basehalfMirrorFiles.js';
import { baseHalfAssertMirrorPathComponentsNotSymbolicLink, baseHalfMirrorPathSegments, baseHalfMirrorRoot, baseHalfPruneEmptyMirrorDirectories } from '../common/basehalfMirrorTree.js';
import { IBaseHalfMovedItemsService } from '../common/basehalfMovedItemsService.js';
import { IBaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceMutationLease } from '../common/basehalfWorkspaceMutation.js';

const BADGE_FILE_NAME = 'badge.yaml';
/** How long a move waits for the entries that name the draft to be rewritten before it resolves. */
const ENTRIES_WAIT_MS = 5000;

/** A draft operation that BaseHalf refused, with the reason in plain words. Nothing was changed. */
export class BaseHalfDraftOperationError extends Error {
	override readonly name = 'BaseHalfDraftOperationError';
}

interface IDraftLocation {
	readonly workspaceFolder: URI;
	readonly path: string;
}

/** A mirror file a move wrote at the new path: what was there before (`null` for nothing), and what it wrote. */
interface IWrittenFile {
	readonly resource: URI;
	readonly previous: VSBuffer | null;
	readonly next: VSBuffer;
}

/**
 * Renames, moves, and deletes drafts, and writes back a deleted one
 * (generation cards, "Moving, renaming, copying, and undo" and "Deleting").
 * A draft has no file, so each operation works on what it has: every file of
 * its directory under `.bh/mirror/`, its card row and the edge anchor rows that
 * name it in its folder's layout, and the task records that name it. Each runs
 * as one exclusive run under the workspace mutation lease. A move keeps the
 * draft's `generation.yaml` at the path its task records name at every step,
 * so that a generation never lands on a path that has lost its card. After a
 * move the entries that name the draft are rewritten as after any move:
 * following moved items owes them, and the rename refactor writes them. A
 * draft that generates is not deleted.
 */
export class BaseHalfDraftOperations implements IBaseHalfDraftOperations {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IBaseHalfWorkspaceMutationCoordinator private readonly workspaceMutationCoordinator: IBaseHalfWorkspaceMutationCoordinator,
		@IBaseHalfCanvasMirrorService private readonly canvasMirrorService: IBaseHalfCanvasMirrorService,
		@IBaseHalfBadgeMirrorService private readonly badgeMirrorService: IBaseHalfBadgeMirrorService,
		@IBaseHalfGenerationTaskStore private readonly taskStore: IBaseHalfGenerationTaskStore,
		@IBaseHalfMovedItemsService private readonly movedItemsService: IBaseHalfMovedItemsService,
		@ILogService private readonly logService: ILogService
	) { }

	async move(draft: URI, target: URI, options: IBaseHalfDraftMoveOptions = {}): Promise<URI> {
		const from = this.location(draft);
		const to = this.location(target);
		if (!from || !to) {
			throw new BaseHalfDraftOperationError(localize('basehalf.draft.outsideWorkspace', "{0} is not in a folder of this workspace.", basename(from ? target : draft)));
		}
		if (from.workspaceFolder.toString() !== to.workspaceFolder.toString()) {
			throw new BaseHalfDraftOperationError(localize('basehalf.draft.otherWorkspaceFolder', "A draft moves only within its own workspace folder."));
		}
		if (from.path === to.path) {
			return target;
		}
		if (options.lease) {
			this.workspaceMutationCoordinator.assertLease(options.lease, from.workspaceFolder);
			await this.moveLocked(from.workspaceFolder, from.path, to.path, options.lease, !!options.aside);
			return target;
		}
		await this.workspaceMutationCoordinator.runExclusive(from.workspaceFolder, lease => this.moveLocked(from.workspaceFolder, from.path, to.path, lease, !!options.aside));
		// The rename refactor holds the folder unsettled while it writes the entries that name the draft.
		await this.movedItemsService.whenSettled(from.workspaceFolder, ENTRIES_WAIT_MS);
		return target;
	}

	async delete(draft: URI): Promise<IBaseHalfDraftSnapshot> {
		const location = this.location(draft);
		if (!location) {
			throw new BaseHalfDraftOperationError(localize('basehalf.draft.outsideWorkspace', "{0} is not in a folder of this workspace.", basename(draft)));
		}
		return this.workspaceMutationCoordinator.runExclusive(location.workspaceFolder, async lease => {
			const { workspaceFolder, path } = location;
			await this.assertDraft(workspaceFolder, path);
			await this.assertNotGenerating(workspaceFolder, draft, path);
			const files = await this.readDirectory(workspaceFolder, path);
			const layout = await this.layoutOf(workspaceFolder, path);
			// The card row and the edge anchor rows that name it go with it.
			await this.canvasMirrorService.purgeNode(workspaceFolder, path, lease);
			for (const [name, contents] of files) {
				await baseHalfDeleteMirrorFile(this.fileService, workspaceFolder, this.mirrorFile(workspaceFolder, path, name), contents);
			}
			await this.prune(workspaceFolder, path);
			this.logService.info(`[BaseHalf] deleted the draft ${path}`);
			return {
				resource: draft,
				files: new Map([...files].map(([name, contents]) => [name, contents.buffer])),
				...(layout.row ? { row: layout.row } : {}),
				...(layout.edges.length ? { edges: layout.edges } : {})
			};
		});
	}

	async restore(snapshot: IBaseHalfDraftSnapshot): Promise<void> {
		const location = this.location(snapshot.resource);
		if (!location) {
			throw new BaseHalfDraftOperationError(localize('basehalf.draft.outsideWorkspace', "{0} is not in a folder of this workspace.", basename(snapshot.resource)));
		}
		await this.workspaceMutationCoordinator.runExclusive(location.workspaceFolder, async lease => {
			const { workspaceFolder, path } = location;
			const facts = await baseHalfReadDraftFacts(this.fileService, workspaceFolder, path);
			const taken = facts.itemExists || facts.hasGenerationInfo || facts.hasMade
				|| (await Promise.all([...snapshot.files.keys()].map(name => baseHalfReadMirrorFile(this.fileService, workspaceFolder, this.mirrorFile(workspaceFolder, path, name))))).some(current => current !== null);
			if (taken) {
				throw new BaseHalfDraftOperationError(localize('basehalf.draft.restoreTaken', "{0} can't come back: something else is there now.", basename(snapshot.resource)));
			}
			const written: URI[] = [];
			try {
				for (const [name, contents] of snapshot.files) {
					const resource = this.mirrorFile(workspaceFolder, path, name);
					await baseHalfWriteMirrorFile(this.fileService, workspaceFolder, resource, VSBuffer.wrap(contents), null);
					written.push(resource);
				}
			} catch (error) {
				// Nothing is half written back.
				for (const resource of written) {
					await baseHalfDeleteMirrorFile(this.fileService, workspaceFolder, resource).catch(cleanupError => this.logService.warn(`[BaseHalf] could not take back ${resource.toString()}`, cleanupError));
				}
				throw error;
			}
			await this.restoreLayout(workspaceFolder, path, snapshot, lease);
			this.logService.info(`[BaseHalf] restored the draft ${path}`);
		});
	}

	/**
	 * Moves the draft at `from` to `to` inside the lease: its mirror files,
	 * its card row, and its task records; then following moved items owes the
	 * entries that name it. A file, a folder, a draft, or the card information
	 * of a generated file that is in the trash or missing (a `generation.yaml`
	 * or a `made.yaml`) at `to` refuses the move; the rest of what an item that
	 * is gone left at `to` gives way, as it does to a move through the
	 * workbench. With `aside`, an item has arrived at `from`, and only the card
	 * information there has to be a draft's.
	 *
	 * The path that the task records name always holds the draft's
	 * `generation.yaml`: every file is written at the new path first,
	 * `generation.yaml` last, and the card row moves; then the task records
	 * take the new path; only then does the old path give up its files. A
	 * failure before the records name the new path takes back what was
	 * written, and the draft is whole at its old path.
	 */
	private async moveLocked(workspaceFolder: URI, from: string, to: string, lease: IBaseHalfWorkspaceMutationLease, aside: boolean): Promise<void> {
		await this.assertDraft(workspaceFolder, from, aside);
		const kind = baseHalfGenerationKindOfPath(from);
		if (baseHalfGenerationKindOfPath(to) !== kind) {
			throw new BaseHalfDraftOperationError(kind === 'image'
				? localize('basehalf.draft.imageName', "An image card needs a name that ends in .png, .jpg, .jpeg, .webp, .gif, .avif, or .bmp.")
				: localize('basehalf.draft.videoName', "A video card needs a name that ends in .mp4, .mov, .m4v, or .webm."));
		}
		const facts = await baseHalfReadDraftFacts(this.fileService, workspaceFolder, to);
		// A generated file that is in the trash or missing keeps its record: its card comes back with the file.
		if (facts.itemExists || facts.hasGenerationInfo || facts.hasMade) {
			throw new BaseHalfDraftOperationError(localize('basehalf.draft.taken', "{0} is already taken.", basename(this.resource(workspaceFolder, to))));
		}
		const slash = to.lastIndexOf('/');
		if (slash > 0 && !(await this.stat(this.resource(workspaceFolder, to.slice(0, slash))))?.isDirectory) {
			throw new BaseHalfDraftOperationError(localize('basehalf.draft.noFolder', "The folder {0} does not exist.", to.slice(0, slash)));
		}

		const files = await this.readDirectory(workspaceFolder, from);
		const leftovers = await this.readDirectory(workspaceFolder, to);
		const written = await this.writeAtNewPath(workspaceFolder, to, files, leftovers);
		try {
			await this.canvasMirrorService.relocateNode(workspaceFolder, from, to, { retireDestination: true }, lease);
		} catch (error) {
			await this.takeBack(workspaceFolder, written);
			throw error;
		}
		try {
			// A generation that runs on the draft lands where the draft is now.
			await this.taskStore.retarget(this.resource(workspaceFolder, from), this.resource(workspaceFolder, to));
		} catch (error) {
			await this.undoMove(workspaceFolder, from, to, written, lease);
			throw error;
		}
		await this.giveUpOldPath(workspaceFolder, from, to, files, leftovers);
		await this.prune(workspaceFolder, from);
		this.movedItemsService.acceptDraftMove(workspaceFolder, from, to);
		this.logService.info(`[BaseHalf] moved the draft ${from} to ${to}`);
	}

	/**
	 * Writes every file of the draft at the new path against what is there,
	 * `generation.yaml` last, so that the new path holds no draft before all
	 * of it is there; a relocated `badge.yaml` gets its new `path`. Resolves
	 * with what was written. A failure takes it back and rejects.
	 */
	private async writeAtNewPath(workspaceFolder: URI, to: string, files: ReadonlyMap<string, VSBuffer>, leftovers: ReadonlyMap<string, VSBuffer>): Promise<IWrittenFile[]> {
		const written: IWrittenFile[] = [];
		try {
			for (const name of [...files.keys()].sort((a, b) => Number(a === BASEHALF_GENERATION_INFO_FILE) - Number(b === BASEHALF_GENERATION_INFO_FILE))) {
				const resource = this.mirrorFile(workspaceFolder, to, name);
				const previous = leftovers.get(name) ?? null;
				let next = files.get(name)!;
				if (name === BADGE_FILE_NAME) {
					const relocated = baseHalfRelocateBadgeText(next.toString(), to);
					if (relocated !== undefined) {
						next = VSBuffer.fromString(relocated);
					}
				}
				if (previous?.equals(next)) {
					continue;
				}
				await baseHalfWriteMirrorFile(this.fileService, workspaceFolder, resource, next, previous);
				written.push({ resource, previous, next });
			}
		} catch (error) {
			await this.takeBack(workspaceFolder, written);
			throw error;
		}
		return written;
	}

	/** Takes back what {@link writeAtNewPath} wrote, the last first: a file that was there gets its bytes again. Best effort. */
	private async takeBack(workspaceFolder: URI, written: readonly IWrittenFile[]): Promise<void> {
		for (const file of [...written].reverse()) {
			try {
				if (file.previous) {
					await baseHalfWriteMirrorFile(this.fileService, workspaceFolder, file.resource, file.previous, file.next);
				} else {
					await baseHalfDeleteMirrorFile(this.fileService, workspaceFolder, file.resource, file.next);
				}
			} catch (error) {
				this.logService.warn(`[BaseHalf] could not take back ${file.resource.toString()}`, error);
			}
		}
	}

	/**
	 * The task records could not all take the new path. Those that did move
	 * back, and then the card row and the files: the draft is whole at its old
	 * path again. When the records cannot be moved back, the draft's card
	 * information stays at both paths, so that every record still names a path
	 * that holds its `generation.yaml`.
	 */
	private async undoMove(workspaceFolder: URI, from: string, to: string, written: readonly IWrittenFile[], lease: IBaseHalfWorkspaceMutationLease): Promise<void> {
		try {
			await this.taskStore.retarget(this.resource(workspaceFolder, to), this.resource(workspaceFolder, from));
		} catch (error) {
			this.logService.warn(`[BaseHalf] the task records of the draft ${from} could not be moved back from ${to}; its card information stays at both paths`, error);
			return;
		}
		try {
			await this.canvasMirrorService.relocateNode(workspaceFolder, to, from, { retireDestination: true }, lease);
		} catch (error) {
			this.logService.warn(`[BaseHalf] could not move the card row of the draft ${from} back from ${to}`, error);
		}
		await this.takeBack(workspaceFolder, written);
	}

	/**
	 * Once the task records name the new path, the old path gives up the
	 * draft's files, `generation.yaml` first, so that no draft is left there
	 * when a removal fails; and what an item that is gone left at the new path,
	 * which no file of the draft replaced, gives way. The draft has moved by
	 * then: a file that cannot be removed is logged and left.
	 */
	private async giveUpOldPath(workspaceFolder: URI, from: string, to: string, files: ReadonlyMap<string, VSBuffer>, leftovers: ReadonlyMap<string, VSBuffer>): Promise<void> {
		for (const name of [...files.keys()].sort((a, b) => Number(b === BASEHALF_GENERATION_INFO_FILE) - Number(a === BASEHALF_GENERATION_INFO_FILE))) {
			const resource = this.mirrorFile(workspaceFolder, from, name);
			try {
				await baseHalfDeleteMirrorFile(this.fileService, workspaceFolder, resource, files.get(name));
			} catch (error) {
				this.logService.warn(`[BaseHalf] the draft moved to ${to}, but ${resource.toString()} could not be removed`, error);
			}
		}
		for (const [name, contents] of leftovers) {
			if (files.has(name)) {
				continue;
			}
			try {
				if (name === BADGE_FILE_NAME) {
					await this.badgeMirrorService.patchBadge({ resource: this.resource(workspaceFolder, to), workspaceFolder, relativePath: to, kind: 'file' }, () => null);
				} else {
					await baseHalfDeleteMirrorFile(this.fileService, workspaceFolder, this.mirrorFile(workspaceFolder, to, name), contents);
				}
			} catch (error) {
				this.logService.warn(`[BaseHalf] the draft moved to ${to}, but the ${name} that was left there could not be retired`, error);
			}
		}
	}

	private async assertDraft(workspaceFolder: URI, path: string, aside = false): Promise<void> {
		const facts = await baseHalfReadDraftFacts(this.fileService, workspaceFolder, path);
		if (!(aside ? baseHalfIsDraftInformation(facts) : baseHalfIsDraft(facts))) {
			throw new BaseHalfDraftOperationError(localize('basehalf.draft.notDraft', "{0} is not a draft any more.", basename(this.resource(workspaceFolder, path))));
		}
	}

	/**
	 * A draft is not deleted while a generation that has not ended still lands
	 * on it (generation cards, "Deleting"): its file would be paid for and then
	 * have nowhere to go. The canvas releases the card first, which stops the
	 * generation, or, for one of several cards, gives up that card's file.
	 */
	private async assertNotGenerating(workspaceFolder: URI, draft: URI, path: string): Promise<void> {
		await this.taskStore.refresh(workspaceFolder);
		const task = this.taskStore.forCard(draft);
		if (task && !isBaseHalfGenerationTaskEnded(task) && task.cards.some(card => card.path === path && card.state === 'waiting')) {
			throw new BaseHalfDraftOperationError(localize('basehalf.draft.generating', "This card is generating. Stop it first."));
		}
	}

	/** Every file of the node's directory under `.bh/mirror/`, by name. Directories below it are not card information of this node. */
	private async readDirectory(workspaceFolder: URI, path: string): Promise<Map<string, VSBuffer>> {
		const directory = URI.joinPath(baseHalfMirrorRoot(workspaceFolder), ...baseHalfMirrorPathSegments(path));
		const files = new Map<string, VSBuffer>();
		let children: readonly IFileStat[];
		try {
			await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, directory);
			children = (await this.fileService.resolve(directory)).children ?? [];
		} catch (error) {
			if (error instanceof Error && toFileOperationResult(error) === FileOperationResult.FILE_NOT_FOUND) {
				return files;
			}
			throw error;
		}
		for (const child of children) {
			if (!child.isFile || child.isSymbolicLink) {
				continue;
			}
			const contents = await baseHalfReadMirrorFile(this.fileService, workspaceFolder, child.resource);
			if (contents) {
				files.set(child.name, contents);
			}
		}
		return files;
	}

	/** The draft's card row and the edge anchor rows that name it, in its folder's layout. */
	private async layoutOf(workspaceFolder: URI, path: string): Promise<{ readonly row?: IBaseHalfCanvasCard; readonly edges: readonly IBaseHalfCanvasEdge[] }> {
		try {
			const canvas = await this.canvasMirrorService.readCanvas(this.folderState(workspaceFolder, path));
			return {
				row: canvas?.cards.find(card => card.path === path),
				edges: canvas?.edges.filter(edge => edge.from === path || edge.to === path) ?? []
			};
		} catch (error) {
			// A layout that cannot be loaded keeps no place to give back.
			this.logService.warn(`[BaseHalf] could not read the place of the draft ${path}`, error);
			return { edges: [] };
		}
	}

	/** Puts the card row and the edge anchor rows back, where nothing else took their place. */
	private async restoreLayout(workspaceFolder: URI, path: string, snapshot: IBaseHalfDraftSnapshot, lease: IBaseHalfWorkspaceMutationLease): Promise<void> {
		if (!snapshot.row && !snapshot.edges?.length) {
			return;
		}
		if (await baseHalfIsWorkspaceFolderMarked(this.fileService, workspaceFolder)) {
			return;
		}
		const folder = this.folderState(workspaceFolder, path);
		const card = snapshot.row ? [{ path, expected: null, next: { ...snapshot.row, path } }] : [];
		const edges = (snapshot.edges ?? []).map(edge => ({ from: edge.from, to: edge.to, expected: null, next: edge }));
		for (const transition of [{ cards: card, edges }, { cards: card }]) {
			try {
				await this.canvasMirrorService.transitionCanvasState(folder, transition, lease);
				return;
			} catch (error) {
				if (!(error instanceof BaseHalfCanvasStateConflict)) {
					throw error;
				}
			}
		}
		// Another row took the place: the card is placed again when its canvas is drawn.
		this.logService.info(`[BaseHalf] the place of the restored draft ${path} was taken; it gets a new one`);
	}

	private async prune(workspaceFolder: URI, path: string): Promise<void> {
		try {
			if (!await baseHalfIsWorkspaceFolderMarked(this.fileService, workspaceFolder)) {
				await baseHalfPruneEmptyMirrorDirectories(this.fileService, workspaceFolder, path);
			}
		} catch (error) {
			this.logService.warn(`[BaseHalf] could not remove the empty mirror directories of ${path}`, error);
		}
	}

	private location(resource: URI): IDraftLocation | undefined {
		const folder = this.contextService.getWorkspaceFolder(resource);
		const path = folder ? getRelativePath(folder.uri, resource) : undefined;
		if (!folder || !path || path === '.bh' || path.startsWith('.bh/')) {
			return undefined;
		}
		return { workspaceFolder: folder.uri, path };
	}

	/** The folder of the item at `path`, as the canvas mirror addresses its layout. */
	private folderState(workspaceFolder: URI, path: string): IBaseHalfCanvasFolderState {
		const slash = path.lastIndexOf('/');
		const relativePath = slash < 0 ? '' : path.slice(0, slash);
		return { resource: relativePath ? this.resource(workspaceFolder, relativePath) : workspaceFolder, workspaceFolder, relativePath, source: 'api' };
	}

	private mirrorFile(workspaceFolder: URI, path: string, name: string): URI {
		return URI.joinPath(baseHalfMirrorRoot(workspaceFolder), ...baseHalfMirrorPathSegments(path), name);
	}

	private resource(workspaceFolder: URI, path: string): URI {
		return URI.joinPath(workspaceFolder, ...path.split('/'));
	}

	private async stat(resource: URI): Promise<{ readonly isDirectory: boolean } | undefined> {
		try {
			return await this.fileService.stat(resource);
		} catch {
			return undefined;
		}
	}
}

registerSingleton(IBaseHalfDraftOperations, BaseHalfDraftOperations, InstantiationType.Delayed);
