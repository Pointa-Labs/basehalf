/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { relativePath as getRelativePath } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { FileOperation, FileOperationError, FileOperationResult, IFileService } from '../../../platform/files/common/files.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { IWorkingCopyFileService, SourceTargetPair } from '../../services/workingCopy/common/workingCopyFileService.js';
import { IBaseHalfAdhdFile } from '../common/basehalfAdhd.js';
import { IBaseHalfAdhdMirrorService } from '../common/basehalfAdhdMirror.js';
import { IBaseHalfBadgeGraphService } from '../common/basehalfBadgeGraph.js';
import { IBaseHalfCanvasMirrorService } from '../common/basehalfCanvasMirror.js';
import { IBaseHalfWorkspaceResource } from '../common/basehalfCanvasNavigation.js';
import {
	baseHalfIsMirrorSubtree,
	baseHalfMirrorPathSegments,
	baseHalfMirrorResource,
	baseHalfRemapSubtreeRel,
	baseHalfWalkMirror
} from '../common/basehalfMirrorTree.js';

/**
 * Keeps `.bh/mirror/` in step with the files it annotates. The mirror is
 * DERIVED state addressed by workspace-relative path, so when a node moves or
 * dies its mirror data must follow or fall away — otherwise the human-authored
 * badge notes and reference graph silently go stale at the old path.
 *
 * In-app file operations (Explorer rename/delete, card renames, extension
 * `workspace.fs` calls) all flow through `IWorkingCopyFileService`; this
 * contribution listens there and cascades:
 *
 *  - MOVE   → badge graph rename (badge + descendants + both graph directions),
 *             canvas relocate (geometry + edge styling), adhd reading-aids
 *             relocate, stale focus mirrors dropped (they self-heal on the next
 *             view).
 *  - DELETE → badge graph purge (badge + descendants + backlink scrub), canvas
 *             purge, adhd + focus mirrors dropped.
 *
 * Operations that happen OUTSIDE the app (a terminal `mv`, an agent's tools)
 * don't pass through the working-copy service. Deletions are caught by the
 * orphan sweep — on workspace open every badge whose disk node is gone is
 * marked `orphan`, preserving the note — and a file reappearing (including the
 * "external rename looks like delete+add" case for the ADD half) clears the
 * flag again via file events. An external rename therefore degrades to
 * orphan-at-old-path rather than following the file; the note is never lost,
 * and adopting a rename heuristic over raw file events remains a possible
 * later refinement.
 *
 * All cascades run on one FIFO queue so two rapid operations (rename A→B, then
 * B→C) can never interleave their multi-file rewrites.
 */
class BaseHalfMirrorCascadeContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.basehalf.mirrorCascade';

	private queue: Promise<void> = Promise.resolve();

	constructor(
		@IWorkingCopyFileService workingCopyFileService: IWorkingCopyFileService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService,
		@IBaseHalfBadgeGraphService private readonly badgeGraphService: IBaseHalfBadgeGraphService,
		@IBaseHalfCanvasMirrorService private readonly canvasMirrorService: IBaseHalfCanvasMirrorService,
		@IBaseHalfAdhdMirrorService private readonly adhdMirrorService: IBaseHalfAdhdMirrorService
	) {
		super();

		this._register(workingCopyFileService.onDidRunWorkingCopyFileOperation(event => {
			if (event.operation === FileOperation.MOVE || event.operation === FileOperation.DELETE) {
				this.handleOperation(event.operation, event.files);
			}
		}));

		this._register(this.fileService.onDidFilesChange(event => {
			for (const resource of event.rawAdded) {
				this.handleAppeared(resource);
			}
		}));

		this._register(this.contextService.onDidChangeWorkspaceFolders(event => {
			for (const added of event.added) {
				this.enqueue(() => this.sweepOrphans(added.uri));
			}
		}));

		for (const folder of this.contextService.getWorkspace().folders) {
			this.enqueue(() => this.sweepOrphans(folder.uri));
		}
	}

	private handleOperation(operation: FileOperation.MOVE | FileOperation.DELETE, files: readonly SourceTargetPair[]): void {
		for (const pair of files) {
			if (operation === FileOperation.MOVE && pair.source) {
				const source = pair.source;
				const target = pair.target;
				this.enqueue(() => this.cascadeMove(source, target));
			} else if (operation === FileOperation.DELETE) {
				const target = pair.target;
				this.enqueue(() => this.cascadeDelete(target));
			}
		}
	}

	private async cascadeMove(source: URI, target: URI): Promise<void> {
		const from = this.workspaceLocation(source);
		const to = this.workspaceLocation(target);
		if (from && !to) {
			// Moved OUT of the workspace: the mirror cannot follow — same as a delete.
			await this.cascadeDelete(source);
			return;
		}
		if (!from || !to || from.workspaceFolder.toString() !== to.workspaceFolder.toString()) {
			return;
		}

		// Every step is best-effort: the disk move already happened, so a hiccup
		// in one derived layer must not stop the others from following.
		const workspaceFolder = from.workspaceFolder;
		await this.step('badge rename', () => this.badgeGraphService.renameNode(workspaceFolder, from.relativePath, to.relativePath, 'folder'));
		await this.step('canvas relocate', () => this.canvasMirrorService.relocateNode(workspaceFolder, from.relativePath, to.relativePath));
		await this.step('adhd relocate', () => this.relocateAdhd(workspaceFolder, from.relativePath, to.relativePath));
		await this.step('focus drop', () => this.dropMirrorFiles(workspaceFolder, from.relativePath, 'focus.yaml'));
	}

	private async cascadeDelete(resource: URI): Promise<void> {
		const location = this.workspaceLocation(resource);
		if (!location) {
			return;
		}

		const { workspaceFolder, relativePath } = location;
		await this.step('badge purge', () => this.badgeGraphService.deleteNode(workspaceFolder, relativePath, 'folder'));
		await this.step('canvas purge', () => this.canvasMirrorService.purgeNode(workspaceFolder, relativePath));
		await this.step('adhd purge', () => this.dropMirrorFiles(workspaceFolder, relativePath, 'adhd.yaml'));
		await this.step('focus purge', () => this.dropMirrorFiles(workspaceFolder, relativePath, 'focus.yaml'));
	}

	/** A file/folder appeared on disk (in-app or external): if it has an
	 *  orphaned badge, the node is back — clear the flag so the note rejoins
	 *  the live overlay. Guarded by a cheap existence probe of the badge.yaml
	 *  so bulk file creations don't schedule graph work. */
	private handleAppeared(resource: URI): void {
		const location = this.workspaceLocation(resource);
		if (!location) {
			return;
		}

		this.enqueue(async () => {
			const badgeResource = baseHalfMirrorResource(location.workspaceFolder, location.relativePath, 'badge.yaml');
			if (!(await this.fileService.exists(badgeResource))) {
				return;
			}

			await this.badgeGraphService.clearOrphan({
				...this.workspaceNode(location.workspaceFolder, location.relativePath),
				kind: 'file'
			});
		});
	}

	private async sweepOrphans(workspaceFolder: URI): Promise<void> {
		const orphaned = await this.badgeGraphService.pruneDangling(workspaceFolder);
		if (orphaned.length > 0) {
			this.logService.info(`BaseHalf mirror cascade: marked ${orphaned.length} badge(s) orphan (disk node gone): ${orphaned.join(', ')}`);
		}
	}

	/** Move every adhd.yaml under the subtree to the remapped location. Reading
	 *  aids are authored user state (keywords + read ranges), so they follow the
	 *  file like the badge does. Corrupt files are left behind. */
	private async relocateAdhd(workspaceFolder: URI, from: string, to: string): Promise<void> {
		for (const entry of await baseHalfWalkMirror(this.fileService, workspaceFolder, 'adhd.yaml')) {
			if (!baseHalfIsMirrorSubtree(entry.relativePath, from)) {
				continue;
			}

			let fields: IBaseHalfAdhdFile | null;
			try {
				fields = await this.adhdMirrorService.readAdhd(this.workspaceNode(workspaceFolder, entry.relativePath));
			} catch (error) {
				this.logService.warn(`BaseHalf mirror cascade: leaving unreadable adhd.yaml behind at ${entry.relativePath}`, error);
				continue;
			}
			if (!fields) {
				continue;
			}

			const newRel = baseHalfRemapSubtreeRel(entry.relativePath, from, to);
			await this.adhdMirrorService.setAdhd(this.workspaceNode(workspaceFolder, newRel), {
				highlight_keywords: fields.highlight_keywords,
				read_paragraphs: fields.read_paragraphs
			});
			await this.deleteIgnoreMissing(entry.resource);
		}
	}

	/** Drop every `<fileName>` mirror file under the subtree. Used for focus
	 *  mirrors on move/delete (a viewport for a path that no longer exists is
	 *  stale data an agent must not read; it self-heals on the next view) and
	 *  for adhd mirrors on delete. */
	private async dropMirrorFiles(workspaceFolder: URI, subtree: string, fileName: string): Promise<void> {
		for (const entry of await baseHalfWalkMirror(this.fileService, workspaceFolder, fileName)) {
			if (baseHalfIsMirrorSubtree(entry.relativePath, subtree)) {
				await this.deleteIgnoreMissing(entry.resource);
			}
		}
	}

	private async deleteIgnoreMissing(resource: URI): Promise<void> {
		try {
			await this.fileService.del(resource);
		} catch (error) {
			if (!(error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND)) {
				throw error;
			}
		}
	}

	private workspaceLocation(resource: URI): { workspaceFolder: URI; relativePath: string } | undefined {
		const folder = this.contextService.getWorkspaceFolder(resource);
		if (!folder) {
			return undefined;
		}

		const relative = getRelativePath(folder.uri, resource);
		if (!relative) {
			// The folder root itself, or an unrelated scheme — nothing to cascade.
			return undefined;
		}

		// Mirror-internal writes (the app or an agent editing `.bh/` itself) must
		// never recurse back into the cascade.
		if (relative === '.bh' || relative.startsWith('.bh/')) {
			return undefined;
		}

		return { workspaceFolder: folder.uri, relativePath: relative };
	}

	private workspaceNode(workspaceFolder: URI, relativePath: string): IBaseHalfWorkspaceResource {
		return {
			resource: URI.joinPath(workspaceFolder, ...baseHalfMirrorPathSegments(relativePath)),
			workspaceFolder,
			relativePath
		};
	}

	private enqueue(task: () => Promise<void>): void {
		this.queue = this.queue
			.then(task)
			.catch(error => this.logService.error('BaseHalf mirror cascade step failed', error));
	}

	private async step(label: string, task: () => Promise<void>): Promise<void> {
		try {
			await task();
		} catch (error) {
			this.logService.error(`BaseHalf mirror cascade: ${label} failed`, error);
		}
	}
}

registerWorkbenchContribution2(BaseHalfMirrorCascadeContribution.ID, BaseHalfMirrorCascadeContribution, WorkbenchPhase.AfterRestored);
