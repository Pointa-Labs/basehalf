/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise, Limiter, timeout } from '../../../base/common/async.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { basename, relativePath as getRelativePath } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { FileChangesEvent, FileOperationResult, IFileService, IFileStat, toFileOperationResult } from '../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IUriIdentityService } from '../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { IFileQuery, ISearchService, QueryType } from '../../services/search/common/search.js';
import { IBaseHalfWorkspaceResource } from './basehalfCanvasNavigation.js';
import { isBaseHalfCanvasEntry } from './basehalfCanvasModel.js';
import { baseHalfAssertMirrorPathComponentsNotSymbolicLink, baseHalfMirrorRoot } from './basehalfMirrorTree.js';
import { baseHalfPlainFailureReason } from './basehalfPlainFailureReason.js';
import {
	BASEHALF_NODE_DOCUMENT_MAX_BYTES,
	baseHalfNodeUpstreamItemValues,
	BaseHalfNodeUpstreamExtract,
	BaseHalfNodeUpstreamLifecycle,
	extractBaseHalfNodeUpstreamLenient
} from './basehalfNodeDocument.js';
import {
	BASEHALF_UPSTREAM_MAX_NODE_ENTRIES,
	baseHalfAnalyzeUpstreamItems,
	baseHalfResolveFileRelativeUpstreamEntry,
	baseHalfUpstreamIdentity,
	baseHalfUpstreamResourceKey,
	IBaseHalfUpstreamIdentity,
	IBaseHalfUpstreamItem
} from './basehalfReferenceEntries.js';
import {
	BASEHALF_UPSTREAM_FRONTMATTER_WINDOW_BYTES,
	BASEHALF_UPSTREAM_SIDECAR_FILE_NAME,
	BaseHalfUpstreamStoreKind,
	BaseHalfUpstreamStoreProblem,
	baseHalfMarkdownNoteUsesSidecar,
	baseHalfUpstreamSidecarResource,
	baseHalfUpstreamStoreKind,
	IBaseHalfUpstreamStoreRead,
	isBaseHalfUpstreamMarkdownName,
	isBaseHalfUpstreamNodeDocumentName,
	isBaseHalfUpstreamReservedOutput,
	readBaseHalfMarkdownUpstream,
	readBaseHalfSidecarUpstream
} from './basehalfReferenceStore.js';

export const IBaseHalfReferenceIndexService = createDecorator<IBaseHalfReferenceIndexService>('baseHalfReferenceIndexService');

/** The index of one workspace folder reaches `partial` at this many stores. */
export const BASEHALF_REFERENCE_INDEX_STORE_LIMIT = 50_000;
/** An event batch touching more paths than this triggers a full rescan. */
export const BASEHALF_REFERENCE_INDEX_RESCAN_THRESHOLD = 1000;
/** Largest sidecar the index reads. */
const SIDECAR_MAX_BYTES = 64 * 1024;
const READ_CONCURRENCY = 16;

/**
 * - `building`: the initial scan or a full rescan is running.
 * - `ready`: the scan finished.
 * - `partial`: the scan finished but missed something (see
 *   {@link BaseHalfReferenceIndexPartialReason}).
 */
export type BaseHalfReferenceIndexState = 'building' | 'ready' | 'partial';

export type BaseHalfReferenceIndexPartialReason =
	/** File search hit its limit. */
	| 'searchLimit'
	/** The store count reached {@link BASEHALF_REFERENCE_INDEX_STORE_LIMIT}. */
	| 'storeLimit'
	/** A store could not be read because of an I/O error (see `getStoreProblems`). */
	| 'readError'
	/** The file watcher reported an error. */
	| 'watcherError';

/** A sidecar is active, belongs in its Markdown or `.bhnode` file, or names no node. */
export type BaseHalfUpstreamSidecarState = 'active' | 'wrongOwner' | 'missingNode';

/** The saved-disk state of one indexed store. */
export interface IBaseHalfIndexedStore {
	/** The downstream node that owns the list. */
	readonly node: IBaseHalfWorkspaceResource;
	readonly storeKind: BaseHalfUpstreamStoreKind;
	/** The Markdown file, the `.bhnode` document, or the `upstream.yaml`. */
	readonly storeResource: URI;
	readonly read: IBaseHalfUpstreamStoreRead;
	/** `.bhnode` only: the node's lifecycle and bindings (lenient read). */
	readonly lifecycle?: BaseHalfNodeUpstreamLifecycle;
	readonly bindings?: readonly IBaseHalfIndexedBinding[];
	/** Sidecars only. Only `active` sidecars contribute edges. */
	readonly sidecarState?: BaseHalfUpstreamSidecarState;
}

export interface IBaseHalfIndexedBinding {
	readonly sourcePath: string;
	readonly slot?: string;
	readonly order?: number;
}

/** One downstream node of a given node, derived from the stores. */
export interface IBaseHalfIndexedDownstream {
	readonly node: IBaseHalfWorkspaceResource;
	readonly storeKind: BaseHalfUpstreamStoreKind;
	/** The item index of the entry that names the upstream node. */
	readonly entryIndex: number;
}

/** The node a valid, non-dangling entry names. */
export interface IBaseHalfUpstreamTarget extends IBaseHalfWorkspaceResource {
	readonly kind: 'file' | 'folder';
}

export type BaseHalfUpstreamEntryStatus = 'valid' | 'dangling' | 'invalid';

/** One row of a node's Upstream list. */
export interface IBaseHalfUpstreamEntryView extends IBaseHalfUpstreamItem {
	readonly status: BaseHalfUpstreamEntryStatus;
	/** The node a `valid` entry names. */
	readonly target?: IBaseHalfUpstreamTarget;
	/** `.bhnode`: the binding that uses this entry. */
	readonly binding?: IBaseHalfIndexedBinding;
	/** A dangling bound entry of an attempted or sealed `.bhnode`: a
	 * historical input ("Moved or deleted since this result was made"),
	 * shown in a neutral style and not counted as an issue. */
	readonly historical: boolean;
	/** An invalid entry that, read relative to the downstream file, names an
	 * existing node: the workspace path for "Use <workspace path>". */
	readonly workspacePath?: string;
	/** Whether this row is a warning row that counts as an issue. */
	readonly issue: boolean;
}

/** A node's own Upstream list with diagnostics. */
export interface IBaseHalfUpstreamView {
	readonly node: IBaseHalfWorkspaceResource;
	readonly storeKind: BaseHalfUpstreamStoreKind;
	readonly storeResource: URI;
	readonly readable: boolean;
	readonly writable: boolean;
	readonly problem?: BaseHalfUpstreamStoreProblem;
	/** One issue row for an unreadable, foreign, or not-writable store. */
	readonly storeIssue: boolean;
	readonly entries: readonly IBaseHalfUpstreamEntryView[];
	/** Set when the node cannot be downstream: Upstream is read-only. */
	readonly upstreamOnly?: 'reservedOutput' | 'sealedArtifact';
	readonly lifecycle?: BaseHalfNodeUpstreamLifecycle;
	/** A sidecar whose list could live in this Markdown or `.bhnode` file (the
	 * issue offers Move into File). It contributes no edges when the file has
	 * an `upstream` key of its own; otherwise it is this note's store, and
	 * `storeKind` is `sidecar`. */
	readonly misplacedSidecar?: { readonly resource: URI; readonly items: readonly IBaseHalfUpstreamItem[] };
	/** The store could not be read (I/O error). */
	readonly readError?: string;
	/** Warning rows plus one for a store-level issue and one for a misplaced sidecar. */
	readonly issueCount: number;
}

export type BaseHalfUpstreamIssueKind = 'store' | 'entry' | 'misplacedSidecar' | 'readError';

/** One entry of **BaseHalf: Show Upstream Issues**. */
export interface IBaseHalfUpstreamIssue {
	readonly kind: BaseHalfUpstreamIssueKind;
	readonly node: IBaseHalfWorkspaceResource;
	readonly storeKind: BaseHalfUpstreamStoreKind;
	readonly storeResource: URI;
	readonly problem?: BaseHalfUpstreamStoreProblem;
	readonly entry?: IBaseHalfUpstreamEntryView;
	readonly message?: string;
}

export interface IBaseHalfReferenceStoreProblem {
	readonly resource: URI;
	readonly message: string;
}

export interface IBaseHalfReferenceIndexChangeEvent {
	readonly workspaceFolder: URI;
	readonly state: BaseHalfReferenceIndexState;
	/** Node resources whose own store was added, re-read, or dropped, and
	 * resources that appeared or disappeared (dangling status may change). */
	readonly resources: readonly URI[];
	/** True when every store of the folder may have changed (scan, rescan, removal). */
	readonly full: boolean;
}

/**
 * The derived reference graph (D37). It is rebuilt in memory from saved disk
 * content and never persisted. Unsaved buffers are never indexed.
 */
export interface IBaseHalfReferenceIndexService {
	readonly _serviceBrand: undefined;

	/** Fires after a store changed, a scan finished, or a folder changed state.
	 * A BaseHalf save fires it before the edit operation resolves. */
	readonly onDidChange: Event<IBaseHalfReferenceIndexChangeEvent>;

	/** `undefined` for a folder that is not a workspace folder. */
	getState(workspaceFolder: URI): BaseHalfReferenceIndexState | undefined;
	getPartialReasons(workspaceFolder: URI): readonly BaseHalfReferenceIndexPartialReason[];
	/** Resolves with `ready` or `partial` once the folder's scan finished, or
	 * with `building` when `timeoutMs` elapses first. */
	whenReady(workspaceFolder: URI, timeoutMs?: number): Promise<BaseHalfReferenceIndexState | undefined>;
	/** Full rescan of one folder, or every folder (**BaseHalf: Rebuild Upstream Index**). */
	rebuild(workspaceFolder?: URI): Promise<void>;

	/** The node's indexed store (saved disk content), or `undefined` when not indexed. */
	getStore(node: IBaseHalfWorkspaceResource): IBaseHalfIndexedStore | undefined;
	/** Every indexed store of a folder, including inactive sidecars. */
	getStores(workspaceFolder: URI): readonly IBaseHalfIndexedStore[];
	/** Every node whose active store lists this node as a valid entry. */
	getDownstream(node: IBaseHalfWorkspaceResource): readonly IBaseHalfIndexedDownstream[];
	/** The node's Upstream list from the index, with dangling and target
	 * resolution. Falls back to a direct read when the node is not indexed. */
	resolveUpstream(node: IBaseHalfWorkspaceResource): Promise<IBaseHalfUpstreamView>;
	/** Reads the node's own store directly from disk, so a badge editor or Card
	 * Detail never depends on enumeration. The index is updated too. */
	readUpstream(node: IBaseHalfWorkspaceResource): Promise<IBaseHalfUpstreamView>;
	/** Every issue in one folder, or in the workspace. */
	getIssues(workspaceFolder?: URI): Promise<readonly IBaseHalfUpstreamIssue[]>;
	/** Stores that could not be read in the last scan or event. */
	getStoreProblems(workspaceFolder: URI): readonly IBaseHalfReferenceStoreProblem[];

	/** Workspace-relative paths of every sealed or imported Result artifact. */
	getSealedArtifacts(workspaceFolder: URI): readonly string[];
	/** Why a node can never be downstream, if it cannot. The sealed-artifact
	 * answer is complete only once the folder is `ready` or `partial`. */
	getUpstreamOnlyReason(node: IBaseHalfWorkspaceResource): 'reservedOutput' | 'sealedArtifact' | undefined;

	/**
	 * The reference edit service calls this after a BaseHalf save succeeds,
	 * with the saved text (`undefined` when the store file was removed). The
	 * index updates that store and fires `onDidChange` synchronously; the
	 * watcher event that follows for identical content does nothing.
	 */
	acceptSavedContent(node: IBaseHalfWorkspaceResource, storeKind: BaseHalfUpstreamStoreKind, content: string | undefined): void;
}

interface IStoreRecord extends IBaseHalfIndexedStore {
	readonly storeKey: string;
	readonly nodeKey: string;
	readonly content: string;
	/** Target keys of valid entries; empty unless the store is active. */
	readonly targets: readonly (readonly [string, number])[];
	readonly sealedArtifactPath?: string;
}

interface IFolderIndex {
	readonly folder: URI;
	readonly identity: IBaseHalfUpstreamIdentity;
	state: BaseHalfReferenceIndexState;
	readonly partialReasons: Set<BaseHalfReferenceIndexPartialReason>;
	readonly records: Map<string, IStoreRecord>;
	/** node key → store key of the node's active store */
	readonly activeByNode: Map<string, string>;
	/** node key → store keys of sidecars in the node's mirror directory */
	readonly sidecarsByNode: Map<string, string>;
	/** target key → store key → entry index */
	readonly downstream: Map<string, Map<string, number>>;
	readonly problems: Map<string, IBaseHalfReferenceStoreProblem>;
	/** artifact key → number of node documents sealing it */
	readonly sealed: Map<string, { path: string; count: number }>;
	generation: number;
	scanned: DeferredPromise<void>;
	pending: { readonly added: URI[]; readonly updated: URI[]; readonly deleted: URI[] } | undefined;
	disposed: boolean;
}

interface INodeStat {
	readonly resource: URI;
	readonly isFile: boolean;
	readonly isDirectory: boolean;
}

type StoreReadResult =
	| { readonly kind: 'record'; readonly record: IStoreRecord }
	| { readonly kind: 'missing' }
	| { readonly kind: 'error'; readonly message: string };

/**
 * Store names that the canvas never shows as directories. File search uses
 * them only to avoid walking large trees; `isBaseHalfCanvasEntry` remains the
 * authoritative eligibility check for every result.
 */
const SEARCH_EXCLUDED_DIRECTORY_NAMES = [
	'.git', '.bh', '.idea', '.vscode', '.turbo', '.next', '.nuxt', '.svelte-kit',
	'node_modules', 'dist', 'build', 'out', '__pycache__', '.pytest_cache', 'target', 'vendor'
];

export class BaseHalfReferenceIndexService extends Disposable implements IBaseHalfReferenceIndexService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<IBaseHalfReferenceIndexChangeEvent>());
	readonly onDidChange = this._onDidChange.event;

	private readonly folders = new Map<string, IFolderIndex>();
	private readonly existence = new Map<string, Promise<INodeStat | undefined>>();

	constructor(
		@IFileService private readonly fileService: IFileService,
		@ISearchService private readonly searchService: ISearchService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this._register(this.fileService.onDidFilesChange(event => this.onDidFilesChange(event)));
		this._register(this.fileService.onDidWatchError(error => this.onDidWatchError(error)));
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(event => {
			for (const removed of event.removed) {
				this.removeFolder(removed.uri);
			}
			for (const added of event.added) {
				this.addFolder(added.uri);
			}
		}));
		for (const folder of this.workspaceContextService.getWorkspace().folders) {
			this.addFolder(folder.uri);
		}
	}

	override dispose(): void {
		for (const index of this.folders.values()) {
			index.disposed = true;
			index.scanned.complete();
		}
		this.folders.clear();
		super.dispose();
	}

	//#region Public API

	getState(workspaceFolder: URI): BaseHalfReferenceIndexState | undefined {
		return this.folderIndex(workspaceFolder)?.state;
	}

	getPartialReasons(workspaceFolder: URI): readonly BaseHalfReferenceIndexPartialReason[] {
		return [...(this.folderIndex(workspaceFolder)?.partialReasons ?? [])];
	}

	async whenReady(workspaceFolder: URI, timeoutMs?: number): Promise<BaseHalfReferenceIndexState | undefined> {
		const index = this.folderIndex(workspaceFolder);
		if (!index) {
			return undefined;
		}
		while (index.state === 'building' && !index.disposed) {
			const scanned = index.scanned.p;
			if (timeoutMs === undefined) {
				await scanned;
			} else {
				const timer = timeout(timeoutMs);
				try {
					const finished = await Promise.race([scanned.then(() => true), timer.then(() => false, () => false)]);
					if (!finished) {
						return index.state;
					}
				} finally {
					timer.cancel();
				}
			}
		}
		return index.state;
	}

	async rebuild(workspaceFolder?: URI): Promise<void> {
		const indexes = workspaceFolder ? [this.folderIndex(workspaceFolder)].filter((index): index is IFolderIndex => !!index) : [...this.folders.values()];
		await Promise.all(indexes.map(index => this.scan(index)));
	}

	getStore(node: IBaseHalfWorkspaceResource): IBaseHalfIndexedStore | undefined {
		const index = this.folderIndex(node.workspaceFolder);
		if (!index) {
			return undefined;
		}
		const nodeKey = this.resourceKey(node.resource);
		const storeKey = index.activeByNode.get(nodeKey);
		const record = storeKey ? index.records.get(storeKey) : undefined;
		if (record) {
			return toIndexedStore(record);
		}
		const sidecarKey = index.sidecarsByNode.get(nodeKey);
		const sidecar = sidecarKey ? index.records.get(sidecarKey) : undefined;
		return sidecar ? toIndexedStore(sidecar) : undefined;
	}

	getStores(workspaceFolder: URI): readonly IBaseHalfIndexedStore[] {
		const index = this.folderIndex(workspaceFolder);
		return index ? [...index.records.values()].map(toIndexedStore) : [];
	}

	getDownstream(node: IBaseHalfWorkspaceResource): readonly IBaseHalfIndexedDownstream[] {
		const index = this.folderIndex(node.workspaceFolder);
		if (!index) {
			return [];
		}
		const result: IBaseHalfIndexedDownstream[] = [];
		for (const [storeKey, entryIndex] of index.downstream.get(this.resourceKey(node.resource)) ?? []) {
			const record = index.records.get(storeKey);
			if (record) {
				result.push({ node: record.node, storeKind: record.storeKind, entryIndex });
			}
		}
		return result.sort((left, right) => left.node.relativePath.localeCompare(right.node.relativePath));
	}

	async resolveUpstream(node: IBaseHalfWorkspaceResource): Promise<IBaseHalfUpstreamView> {
		const index = this.folderIndex(node.workspaceFolder);
		const nodeKey = this.resourceKey(node.resource);
		const storeKey = index?.activeByNode.get(nodeKey);
		const record = storeKey ? index?.records.get(storeKey) : undefined;
		if (!index || !record) {
			return this.readUpstream(node);
		}
		return this.view(index, node, record, undefined);
	}

	async readUpstream(node: IBaseHalfWorkspaceResource): Promise<IBaseHalfUpstreamView> {
		const index = this.folderIndex(node.workspaceFolder);
		const identity = index?.identity ?? baseHalfUpstreamIdentity(node.workspaceFolder, this.uriIdentityService.extUri);
		const stat = await this.statNode(node.resource);
		const storeKind = baseHalfUpstreamStoreKind(node.relativePath, stat?.isDirectory ?? false);
		const storeResource = storeKind === 'sidecar' ? baseHalfUpstreamSidecarResource(node.workspaceFolder, node.relativePath) : node.resource;
		const result = await this.readStore(node.workspaceFolder, identity, node, storeKind, storeResource, stat);
		if (result.kind === 'error') {
			return {
				node,
				storeKind,
				storeResource,
				readable: false,
				writable: false,
				storeIssue: true,
				entries: [],
				readError: result.message,
				issueCount: 1,
				...this.upstreamOnly(index, node)
			};
		}
		if (index && !index.disposed && index.state !== 'building' && this.isIndexable(index, node.relativePath)) {
			this.applyRead(index, storeResource, result, true);
		}
		const record = result.kind === 'record' ? result.record : emptyRecord(node, storeKind, storeResource, this.resourceKey(storeResource), this.resourceKey(node.resource));
		if (storeKind === 'markdown' && result.kind === 'record' && !record.read.hasKey) {
			const sidecarView = await this.readNoteSidecar(index, identity, node, stat, record.read);
			if (sidecarView) {
				return sidecarView;
			}
		}
		return this.view(index, node, record, undefined);
	}

	/**
	 * The view of a note whose list lives in its sidecar, read from disk, or
	 * `undefined` when the note has no sidecar. `own` is the note's own read,
	 * which has no `upstream` key.
	 */
	private async readNoteSidecar(index: IFolderIndex | undefined, identity: IBaseHalfUpstreamIdentity, node: IBaseHalfWorkspaceResource, stat: INodeStat | undefined, own: IBaseHalfUpstreamStoreRead): Promise<IBaseHalfUpstreamView | undefined> {
		const storeResource = baseHalfUpstreamSidecarResource(node.workspaceFolder, node.relativePath);
		const result = await this.readStore(node.workspaceFolder, identity, node, 'sidecar', storeResource, stat);
		if (result.kind === 'missing') {
			return undefined;
		}
		if (index && !index.disposed && index.state !== 'building' && this.isIndexable(index, node.relativePath)) {
			this.applyRead(index, storeResource, result, true);
		}
		if (result.kind === 'error') {
			return {
				node,
				storeKind: 'sidecar',
				storeResource,
				readable: false,
				writable: false,
				storeIssue: true,
				entries: [],
				readError: result.message,
				issueCount: 1,
				...this.upstreamOnly(index, node)
			};
		}
		return this.view(index, node, withSidecarState(identity, result.record, 'active'), undefined, own);
	}

	async getIssues(workspaceFolder?: URI): Promise<readonly IBaseHalfUpstreamIssue[]> {
		const indexes = workspaceFolder ? [this.folderIndex(workspaceFolder)].filter((index): index is IFolderIndex => !!index) : [...this.folders.values()];
		const issues: IBaseHalfUpstreamIssue[] = [];
		for (const index of indexes) {
			for (const problem of index.problems.values()) {
				// A sidecar that cannot be read is reported for its node, never
				// under its own path in `.bh/`.
				const sidecarNodePath = this.sidecarNodePath(index, problem.resource);
				const relativePath = sidecarNodePath ?? getRelativePath(index.folder, problem.resource) ?? problem.resource.path;
				const node = {
					resource: sidecarNodePath === undefined ? problem.resource : URI.joinPath(index.folder, ...sidecarNodePath.split('/')),
					workspaceFolder: index.folder,
					relativePath
				};
				issues.push({ kind: 'readError', node, storeKind: sidecarNodePath === undefined ? baseHalfUpstreamStoreKind(relativePath, false) : 'sidecar', storeResource: problem.resource, message: problem.message });
			}
			const records = [...index.records.values()].sort((left, right) => left.node.relativePath.localeCompare(right.node.relativePath));
			for (const record of records) {
				if (record.sidecarState === 'missingNode') {
					continue;
				}
				if (record.sidecarState === 'wrongOwner') {
					issues.push({ kind: 'misplacedSidecar', node: record.node, storeKind: 'sidecar', storeResource: record.storeResource });
					continue;
				}
				if (record.storeKind !== 'sidecar' && index.activeByNode.get(record.nodeKey) !== record.storeKey) {
					// A note whose list lives in its sidecar is reported there.
					continue;
				}
				const view = await this.view(index, record.node, record, undefined);
				if (view.misplacedSidecar && record.storeKind === 'sidecar') {
					issues.push({ kind: 'misplacedSidecar', node: record.node, storeKind: 'sidecar', storeResource: record.storeResource });
				}
				if (view.storeIssue) {
					issues.push({ kind: 'store', node: view.node, storeKind: view.storeKind, storeResource: view.storeResource, problem: view.problem });
				}
				for (const entry of view.entries) {
					if (entry.issue) {
						issues.push({ kind: 'entry', node: view.node, storeKind: view.storeKind, storeResource: view.storeResource, entry });
					}
				}
			}
		}
		return issues;
	}

	getStoreProblems(workspaceFolder: URI): readonly IBaseHalfReferenceStoreProblem[] {
		return [...(this.folderIndex(workspaceFolder)?.problems.values() ?? [])];
	}

	getSealedArtifacts(workspaceFolder: URI): readonly string[] {
		return [...(this.folderIndex(workspaceFolder)?.sealed.values() ?? [])].map(entry => entry.path).sort();
	}

	getUpstreamOnlyReason(node: IBaseHalfWorkspaceResource): 'reservedOutput' | 'sealedArtifact' | undefined {
		return this.upstreamOnly(this.folderIndex(node.workspaceFolder), node).upstreamOnly;
	}

	acceptSavedContent(node: IBaseHalfWorkspaceResource, storeKind: BaseHalfUpstreamStoreKind, content: string | undefined): void {
		const index = this.folderIndex(node.workspaceFolder);
		if (!index || index.disposed || !this.isIndexable(index, node.relativePath)) {
			return;
		}
		const storeResource = storeKind === 'sidecar' ? baseHalfUpstreamSidecarResource(node.workspaceFolder, node.relativePath) : node.resource;
		const storeKey = this.resourceKey(storeResource);
		if (content === undefined) {
			this.applyRead(index, storeResource, { kind: 'missing' }, true);
			return;
		}
		const previous = index.records.get(storeKey);
		const sidecarState = storeKind === 'sidecar' ? previous?.sidecarState ?? 'active' : undefined;
		const record = this.createRecord(index.identity, node, storeKind, storeResource, content, sidecarState);
		this.applyRead(index, storeResource, { kind: 'record', record }, true);
		if (index.pending) {
			// A scan is running: re-read this store after it, in case its snapshot is older.
			index.pending.updated.push(storeResource);
		}
	}

	//#endregion

	//#region Folders and scans

	private folderIndex(workspaceFolder: URI): IFolderIndex | undefined {
		return this.folders.get(this.resourceKey(workspaceFolder));
	}

	private addFolder(folder: URI): void {
		const key = this.resourceKey(folder);
		if (this.folders.has(key)) {
			return;
		}
		const index: IFolderIndex = {
			folder,
			identity: baseHalfUpstreamIdentity(folder, this.uriIdentityService.extUri),
			state: 'building',
			partialReasons: new Set(),
			records: new Map(),
			activeByNode: new Map(),
			sidecarsByNode: new Map(),
			downstream: new Map(),
			problems: new Map(),
			sealed: new Map(),
			generation: 0,
			scanned: new DeferredPromise<void>(),
			pending: undefined,
			disposed: false
		};
		this.folders.set(key, index);
		void this.scan(index);
	}

	private removeFolder(folder: URI): void {
		const key = this.resourceKey(folder);
		const index = this.folders.get(key);
		if (!index) {
			return;
		}
		index.disposed = true;
		index.scanned.complete();
		this.folders.delete(key);
		this._onDidChange.fire({ workspaceFolder: folder, state: index.state, resources: [], full: true });
	}

	private async scan(index: IFolderIndex): Promise<void> {
		const generation = ++index.generation;
		this.existence.clear();
		if (index.state !== 'building') {
			index.state = 'building';
			index.scanned = new DeferredPromise<void>();
			this._onDidChange.fire({ workspaceFolder: index.folder, state: 'building', resources: [], full: true });
		}
		index.pending = { added: [], updated: [], deleted: [] };
		const partialReasons = new Set<BaseHalfReferenceIndexPartialReason>();
		const problems = new Map<string, IBaseHalfReferenceStoreProblem>();
		const results: StoreReadResult[] = [];
		try {
			const resources = await this.enumerate(index, index.folder, partialReasons);
			await this.readAll(index, resources, results, problems);
		} catch (error) {
			this.logService.error('[BaseHalf] upstream index scan failed', error);
			partialReasons.add('readError');
		}
		if (index.disposed || generation !== index.generation) {
			return;
		}
		index.records.clear();
		index.activeByNode.clear();
		index.sidecarsByNode.clear();
		index.downstream.clear();
		index.sealed.clear();
		index.problems.clear();
		for (const [key, problem] of problems) {
			index.problems.set(key, problem);
		}
		for (const result of results) {
			if (result.kind === 'record') {
				this.insertRecord(index, result.record);
			}
		}
		// With every note read, decide which sidecars are their notes' stores.
		for (const nodeKey of [...index.sidecarsByNode.keys()]) {
			this.refreshNoteSidecar(index, nodeKey);
		}
		if (index.problems.size > 0) {
			partialReasons.add('readError');
		}
		const watcherError = index.partialReasons.has('watcherError') && index.state !== 'building';
		index.partialReasons.clear();
		for (const reason of partialReasons) {
			index.partialReasons.add(reason);
		}
		if (watcherError) {
			index.partialReasons.add('watcherError');
		}
		index.state = index.partialReasons.size > 0 ? 'partial' : 'ready';
		const pending = index.pending;
		index.pending = undefined;
		index.scanned.complete();
		this._onDidChange.fire({ workspaceFolder: index.folder, state: index.state, resources: [], full: true });
		if (pending && (pending.added.length || pending.updated.length || pending.deleted.length)) {
			await this.applyEvents(index, pending);
		}
	}

	/** Enumerates candidate store resources below `root` (a folder or a subtree). */
	private async enumerate(index: IFolderIndex, root: URI, partialReasons: Set<BaseHalfReferenceIndexPartialReason>): Promise<URI[]> {
		const query: IFileQuery = {
			type: QueryType.File,
			_reason: 'basehalfReferenceIndex',
			folderQueries: [{
				folder: root,
				disregardIgnoreFiles: true,
				disregardGlobalIgnoreFiles: true,
				disregardParentIgnoreFiles: true,
				ignoreSymlinks: true,
				ignoreGlobCase: true
			}],
			includePattern: { '**/*.md': true, '**/*.markdown': true, '**/*.bhnode': true },
			excludePattern: Object.fromEntries(SEARCH_EXCLUDED_DIRECTORY_NAMES.map(name => [`**/${name}`, true])),
			ignoreGlobCase: true,
			maxResults: BASEHALF_REFERENCE_INDEX_STORE_LIMIT + 1
		};
		const complete = await this.searchService.fileSearch(query, CancellationToken.None);
		if (complete.limitHit) {
			partialReasons.add('searchLimit');
		}
		const resources: URI[] = [];
		for (const match of complete.results) {
			const relativePath = getRelativePath(index.folder, match.resource);
			if (relativePath !== undefined && this.isIndexable(index, relativePath) && this.isStoreFileName(relativePath) && this.isCanvasEligible(index, relativePath, false)) {
				resources.push(match.resource);
			}
		}
		const rootRelative = getRelativePath(index.folder, root) ?? '';
		try {
			for (const sidecar of await this.walkSidecars(index.folder, rootRelative)) {
				resources.push(sidecar);
			}
		} catch (error) {
			this.logService.warn('[BaseHalf] upstream sidecar walk failed', error);
			partialReasons.add('readError');
		}
		if (resources.length > BASEHALF_REFERENCE_INDEX_STORE_LIMIT) {
			partialReasons.add('storeLimit');
			resources.length = BASEHALF_REFERENCE_INDEX_STORE_LIMIT;
		}
		return resources;
	}

	private async readAll(index: IFolderIndex, resources: readonly URI[], results: StoreReadResult[], problems: Map<string, IBaseHalfReferenceStoreProblem>): Promise<void> {
		const limiter = new Limiter<void>(READ_CONCURRENCY);
		try {
			await Promise.all(resources.map(resource => limiter.queue(async () => {
				const result = await this.readStoreResource(index, resource);
				if (result.kind === 'error') {
					problems.set(this.resourceKey(resource), { resource, message: result.message });
				}
				results.push(result);
			})));
		} finally {
			limiter.dispose();
		}
	}

	/** Walks `.bh/mirror/<root>/**` for `upstream.yaml` files without following links. */
	private async walkSidecars(workspaceFolder: URI, rootRelative: string): Promise<URI[]> {
		const mirrorRoot = baseHalfMirrorRoot(workspaceFolder);
		const start = rootRelative ? URI.joinPath(mirrorRoot, ...rootRelative.split('/')) : mirrorRoot;
		const out: URI[] = [];
		const stack = [start];
		while (stack.length > 0) {
			const current = stack.pop()!;
			let children: readonly IFileStat[];
			try {
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, current);
				const resolved = await this.fileService.resolve(current);
				if (!resolved.isDirectory) {
					continue;
				}
				children = resolved.children ?? [];
			} catch (error) {
				if (isFileNotFound(error)) {
					continue;
				}
				throw error;
			}
			for (const child of children) {
				if (child.isSymbolicLink) {
					continue;
				}
				if (child.isDirectory) {
					stack.push(child.resource);
				} else if (child.isFile && child.name === BASEHALF_UPSTREAM_SIDECAR_FILE_NAME && child.resource.toString() !== URI.joinPath(mirrorRoot, BASEHALF_UPSTREAM_SIDECAR_FILE_NAME).toString()) {
					out.push(child.resource);
				}
			}
		}
		return out;
	}

	//#endregion

	//#region Reading

	private sidecarNodePath(index: IFolderIndex, resource: URI): string | undefined {
		const relative = getRelativePath(baseHalfMirrorRoot(index.folder), resource);
		if (relative === undefined || !relative.endsWith(`/${BASEHALF_UPSTREAM_SIDECAR_FILE_NAME}`)) {
			return undefined;
		}
		return relative.slice(0, -(BASEHALF_UPSTREAM_SIDECAR_FILE_NAME.length + 1));
	}

	private async readStoreResource(index: IFolderIndex, resource: URI): Promise<StoreReadResult> {
		const nodePath = this.sidecarNodePath(index, resource);
		if (nodePath !== undefined) {
			if (!this.isIndexable(index, nodePath)) {
				return { kind: 'missing' };
			}
			const nodeResource = URI.joinPath(index.folder, ...nodePath.split('/'));
			const stat = await this.statNode(nodeResource);
			return this.readStore(index.folder, index.identity, { resource: nodeResource, workspaceFolder: index.folder, relativePath: nodePath }, 'sidecar', resource, stat);
		}
		const relativePath = getRelativePath(index.folder, resource);
		if (relativePath === undefined) {
			return { kind: 'missing' };
		}
		const storeKind = baseHalfUpstreamStoreKind(relativePath, false);
		return this.readStore(index.folder, index.identity, { resource, workspaceFolder: index.folder, relativePath }, storeKind, resource, undefined);
	}

	/** Reads one store from disk. `nodeStat` is required for sidecars. */
	private async readStore(
		workspaceFolder: URI,
		identity: IBaseHalfUpstreamIdentity,
		node: IBaseHalfWorkspaceResource,
		storeKind: BaseHalfUpstreamStoreKind,
		storeResource: URI,
		nodeStat: INodeStat | undefined
	): Promise<StoreReadResult> {
		try {
			let content: string;
			if (storeKind === 'markdown') {
				const file = await this.fileService.readFile(storeResource, { length: BASEHALF_UPSTREAM_FRONTMATTER_WINDOW_BYTES });
				content = decodeUtf8(file.value.buffer);
			} else if (storeKind === 'node') {
				const file = await this.fileService.readFile(storeResource, { limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES } });
				content = decodeUtf8(file.value.buffer);
			} else {
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, storeResource);
				const file = await this.fileService.readFile(storeResource, { limits: { size: SIDECAR_MAX_BYTES } });
				content = decodeUtf8(file.value.buffer);
			}
			let sidecarState: BaseHalfUpstreamSidecarState | undefined;
			if (storeKind === 'sidecar') {
				sidecarState = !nodeStat
					? 'missingNode'
					: !nodeStat.isDirectory && (isBaseHalfUpstreamMarkdownName(node.relativePath) || isBaseHalfUpstreamNodeDocumentName(node.relativePath))
						? 'wrongOwner'
						: 'active';
			}
			return { kind: 'record', record: this.createRecord(identity, node, storeKind, storeResource, content, sidecarState) };
		} catch (error) {
			if (isFileNotFound(error)) {
				return { kind: 'missing' };
			}
			this.logService.warn(`[BaseHalf] the upstream list of ${node.relativePath} could not be read`, error);
			return { kind: 'error', message: baseHalfPlainFailureReason(error) };
		}
	}

	private createRecord(
		identity: IBaseHalfUpstreamIdentity,
		node: IBaseHalfWorkspaceResource,
		storeKind: BaseHalfUpstreamStoreKind,
		storeResource: URI,
		content: string,
		sidecarState: BaseHalfUpstreamSidecarState | undefined
	): IStoreRecord {
		let read: IBaseHalfUpstreamStoreRead;
		let extract: BaseHalfNodeUpstreamExtract | undefined;
		if (storeKind === 'markdown') {
			read = readBaseHalfMarkdownUpstream(content, { nodePath: node.relativePath, identity });
		} else if (storeKind === 'sidecar') {
			read = readBaseHalfSidecarUpstream(content, { nodePath: node.relativePath, identity });
		} else {
			extract = extractBaseHalfNodeUpstreamLenient(content);
			read = baseHalfNodeUpstreamStoreRead(extract, node.relativePath, identity);
		}
		const active = storeKind !== 'sidecar' || sidecarState === 'active';
		const targets: (readonly [string, number])[] = [];
		if (active && read.readable) {
			for (const item of read.items) {
				if (item.path !== undefined) {
					targets.push([identity.key(item.path), item.index]);
				}
			}
		}
		const lifecycle = extract?.readable ? extract.lifecycle : undefined;
		const bindings = extract?.readable ? extract.bindings : undefined;
		const sealedArtifactPath = extract?.readable && extract.lifecycle === 'sealed' ? extract.resultArtifactPath : undefined;
		return {
			node,
			storeKind,
			storeResource,
			read,
			...(lifecycle ? { lifecycle } : {}),
			...(bindings ? { bindings } : {}),
			...(sealedArtifactPath !== undefined ? { sealedArtifactPath } : {}),
			...(sidecarState ? { sidecarState } : {}),
			storeKey: this.resourceKey(storeResource),
			nodeKey: this.resourceKey(node.resource),
			// Only the upstream state matters: a body edit, a BOM, or a different
			// read window never counts as a store change.
			content: JSON.stringify([read, lifecycle ?? null, bindings ?? null, sealedArtifactPath ?? null]),
			targets
		};
	}

	//#endregion

	//#region Records

	private insertRecord(index: IFolderIndex, record: IStoreRecord): void {
		index.records.set(record.storeKey, record);
		if (record.storeKind === 'sidecar') {
			index.sidecarsByNode.set(record.nodeKey, record.storeKey);
		}
		this.updateActive(index, record.nodeKey);
		for (const [target, entryIndex] of record.targets) {
			let stores = index.downstream.get(target);
			if (!stores) {
				stores = new Map();
				index.downstream.set(target, stores);
			}
			if (!stores.has(record.storeKey)) {
				stores.set(record.storeKey, entryIndex);
			}
		}
		if (record.sealedArtifactPath !== undefined) {
			const key = index.identity.key(record.sealedArtifactPath);
			const current = index.sealed.get(key);
			index.sealed.set(key, { path: record.sealedArtifactPath, count: (current?.count ?? 0) + 1 });
		}
	}

	private deleteRecord(index: IFolderIndex, storeKey: string): IStoreRecord | undefined {
		const record = index.records.get(storeKey);
		if (!record) {
			return undefined;
		}
		index.records.delete(storeKey);
		if (index.sidecarsByNode.get(record.nodeKey) === storeKey) {
			index.sidecarsByNode.delete(record.nodeKey);
		}
		this.updateActive(index, record.nodeKey);
		for (const [target] of record.targets) {
			const stores = index.downstream.get(target);
			stores?.delete(storeKey);
			if (stores?.size === 0) {
				index.downstream.delete(target);
			}
		}
		if (record.sealedArtifactPath !== undefined) {
			const key = index.identity.key(record.sealedArtifactPath);
			const current = index.sealed.get(key);
			if (current && current.count > 1) {
				index.sealed.set(key, { path: current.path, count: current.count - 1 });
			} else {
				index.sealed.delete(key);
			}
		}
		return record;
	}

	/**
	 * The store a node's list lives in: its sidecar while that is active,
	 * otherwise the node's own file. A Markdown note can have both records.
	 */
	private updateActive(index: IFolderIndex, nodeKey: string): void {
		const sidecarKey = index.sidecarsByNode.get(nodeKey);
		const sidecar = sidecarKey ? index.records.get(sidecarKey) : undefined;
		// A node's own-file store has the node's resource as its key.
		const own = index.records.get(nodeKey);
		const active = sidecar?.sidecarState === 'active' ? sidecar : own && own.storeKind !== 'sidecar' ? own : undefined;
		if (active) {
			index.activeByNode.set(nodeKey, active.storeKey);
		} else {
			index.activeByNode.delete(nodeKey);
		}
	}

	/**
	 * A sidecar that belongs to a Markdown note is the note's store while the
	 * note has no `upstream` key of its own (reference graph, "A note that
	 * cannot hold its list"), and is ignored once the note has one. Until the
	 * note itself has been read, the sidecar keeps the state it was read with.
	 */
	private withNoteSidecarState(index: IFolderIndex, record: IStoreRecord): IStoreRecord {
		if (record.storeKind !== 'sidecar' || record.sidecarState === 'missingNode' || !isBaseHalfUpstreamMarkdownName(record.node.relativePath)) {
			return record;
		}
		const own = index.records.get(record.nodeKey);
		if (own?.storeKind !== 'markdown') {
			return record;
		}
		const sidecarState: BaseHalfUpstreamSidecarState = own.read.hasKey ? 'wrongOwner' : 'active';
		return sidecarState === record.sidecarState ? record : withSidecarState(index.identity, record, sidecarState);
	}

	/** Re-derives the state of a note's sidecar after the note's own read changed. */
	private refreshNoteSidecar(index: IFolderIndex, nodeKey: string): boolean {
		const sidecarKey = index.sidecarsByNode.get(nodeKey);
		const sidecar = sidecarKey ? index.records.get(sidecarKey) : undefined;
		const next = sidecar ? this.withNoteSidecarState(index, sidecar) : undefined;
		if (!sidecar || !next || next === sidecar) {
			return false;
		}
		this.deleteRecord(index, sidecar.storeKey);
		this.insertRecord(index, next);
		return true;
	}

	/** Applies one read to the index; returns whether anything changed. */
	private applyRead(index: IFolderIndex, storeResource: URI, result: StoreReadResult, fire: boolean): boolean {
		const changed = this.applyStoreRead(index, storeResource, result, fire);
		// A note's own read decides whether its sidecar is its store. For an
		// own-file store the store key is the node key.
		const nodeKey = this.resourceKey(storeResource);
		const node = index.sidecarsByNode.has(nodeKey) ? index.records.get(index.sidecarsByNode.get(nodeKey)!)?.node : undefined;
		if (!node || !this.refreshNoteSidecar(index, nodeKey)) {
			return changed;
		}
		if (fire && !changed) {
			this.fire(index, [node.resource]);
		}
		return true;
	}

	private applyStoreRead(index: IFolderIndex, storeResource: URI, result: StoreReadResult, fire: boolean): boolean {
		const storeKey = this.resourceKey(storeResource);
		const previous = index.records.get(storeKey);
		if (result.kind === 'error') {
			const changed = !!previous || !index.problems.has(storeKey);
			this.deleteRecord(index, storeKey);
			index.problems.set(storeKey, { resource: storeResource, message: result.message });
			index.partialReasons.add('readError');
			if (index.state === 'ready') {
				index.state = 'partial';
			}
			if (changed && fire) {
				this.fire(index, previous ? [previous.node.resource] : [storeResource]);
			}
			return changed;
		}
		const hadProblem = index.problems.delete(storeKey);
		if (result.kind === 'missing') {
			if (!previous) {
				return hadProblem;
			}
			this.deleteRecord(index, storeKey);
			if (fire) {
				this.fire(index, [previous.node.resource]);
			}
			return true;
		}
		const record = this.withNoteSidecarState(index, result.record);
		if (previous && previous.content === record.content && previous.sidecarState === record.sidecarState) {
			return hadProblem;
		}
		if (!previous && this.activeStoreCount(index) >= BASEHALF_REFERENCE_INDEX_STORE_LIMIT) {
			index.partialReasons.add('storeLimit');
			if (index.state === 'ready') {
				index.state = 'partial';
			}
			return false;
		}
		this.deleteRecord(index, storeKey);
		this.insertRecord(index, record);
		if (fire) {
			this.fire(index, [record.node.resource]);
		}
		return true;
	}

	private activeStoreCount(index: IFolderIndex): number {
		return index.records.size;
	}

	private fire(index: IFolderIndex, resources: readonly URI[]): void {
		this._onDidChange.fire({ workspaceFolder: index.folder, state: index.state, resources, full: false });
	}

	//#endregion

	//#region Events

	private onDidWatchError(error: Error): void {
		this.logService.warn('[BaseHalf] file watcher error; rescanning upstream index', error);
		for (const index of this.folders.values()) {
			index.partialReasons.add('watcherError');
			void this.scan(index).then(() => {
				if (!index.disposed && index.state === 'ready') {
					index.state = 'partial';
					index.partialReasons.add('watcherError');
					this._onDidChange.fire({ workspaceFolder: index.folder, state: index.state, resources: [], full: true });
				}
			});
		}
	}

	private onDidFilesChange(event: FileChangesEvent): void {
		const byFolder = new Map<IFolderIndex, { added: URI[]; updated: URI[]; deleted: URI[] }>();
		const route = (resources: readonly URI[], kind: 'added' | 'updated' | 'deleted') => {
			for (const resource of resources) {
				const index = this.ownerIndex(resource);
				if (!index) {
					continue;
				}
				let batch = byFolder.get(index);
				if (!batch) {
					batch = { added: [], updated: [], deleted: [] };
					byFolder.set(index, batch);
				}
				batch[kind].push(resource);
			}
		};
		route(event.rawAdded, 'added');
		route(event.rawUpdated, 'updated');
		route(event.rawDeleted, 'deleted');
		if (event.rawAdded.length || event.rawDeleted.length) {
			this.existence.clear();
		}
		for (const [index, batch] of byFolder) {
			const total = batch.added.length + batch.updated.length + batch.deleted.length;
			if (total > BASEHALF_REFERENCE_INDEX_RESCAN_THRESHOLD) {
				void this.scan(index);
				continue;
			}
			if (index.pending) {
				index.pending.added.push(...batch.added);
				index.pending.updated.push(...batch.updated);
				index.pending.deleted.push(...batch.deleted);
				continue;
			}
			void this.applyEvents(index, batch).catch(error => this.logService.error('[BaseHalf] upstream index update failed', error));
		}
	}

	/** The innermost workspace folder index that owns a resource. */
	private ownerIndex(resource: URI): IFolderIndex | undefined {
		let owner: IFolderIndex | undefined;
		for (const index of this.folders.values()) {
			if (this.uriIdentityService.extUri.isEqualOrParent(resource, index.folder)
				&& (!owner || index.folder.path.length > owner.folder.path.length)) {
				owner = index;
			}
		}
		return owner;
	}

	private async applyEvents(index: IFolderIndex, batch: { readonly added: readonly URI[]; readonly updated: readonly URI[]; readonly deleted: readonly URI[] }): Promise<void> {
		const changed: URI[] = [];
		const generation = index.generation;
		for (const deleted of batch.deleted) {
			changed.push(...this.dropSubtree(index, deleted));
		}
		const reads: URI[] = [];
		const subtrees: URI[] = [];
		for (const resource of [...batch.added, ...batch.updated]) {
			const kind = this.classifyEvent(index, resource);
			if (kind === 'store') {
				reads.push(resource);
			} else if (kind === 'unknown' && batch.added.includes(resource)) {
				subtrees.push(resource);
			}
		}
		for (const resource of batch.added) {
			changed.push(resource);
		}
		for (const resource of reads) {
			if (index.disposed || generation !== index.generation) {
				return;
			}
			const result = await this.readStoreResource(index, resource);
			if (index.disposed || generation !== index.generation) {
				return;
			}
			if (result.kind === 'missing' && !index.records.has(this.resourceKey(resource))) {
				// A folder with a store-like name, or a file that is gone again.
				subtrees.push(resource);
				continue;
			}
			if (this.applyRead(index, resource, result, false)) {
				changed.push(result.kind === 'record' ? result.record.node.resource : resource);
			}
		}
		for (const root of subtrees) {
			if (index.disposed || generation !== index.generation) {
				return;
			}
			changed.push(...await this.rescanSubtree(index, root));
		}
		if (changed.length > 0 && !index.disposed && generation === index.generation) {
			this.fire(index, changed);
		}
	}

	private classifyEvent(index: IFolderIndex, resource: URI): 'store' | 'unknown' | 'ignored' {
		const relativePath = getRelativePath(index.folder, resource);
		if (relativePath === undefined || relativePath === '') {
			return 'ignored';
		}
		const first = relativePath.split('/')[0];
		if (first === '.bh') {
			if (!this.uriIdentityService.extUri.isEqualOrParent(resource, baseHalfMirrorRoot(index.folder))) {
				return 'ignored';
			}
			return basename(resource) === BASEHALF_UPSTREAM_SIDECAR_FILE_NAME ? 'store' : 'unknown';
		}
		if (!this.isIndexable(index, relativePath)) {
			return 'ignored';
		}
		// Every ancestor must be a folder the canvas shows; the leaf may still
		// be a skipped folder name, which the subtree rescan checks by type.
		const parent = relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : '';
		if (parent && !this.isCanvasEligible(index, parent, true)) {
			return 'ignored';
		}
		return this.isStoreFileName(relativePath) && this.isCanvasEligible(index, relativePath, false) ? 'store' : 'unknown';
	}

	/** Drops every store at or under a deleted path, including sidecars under the matching mirror path. */
	private dropSubtree(index: IFolderIndex, deleted: URI): URI[] {
		const changed: URI[] = [];
		const relativePath = getRelativePath(index.folder, deleted);
		const mirror = relativePath && !relativePath.startsWith('.bh/') && relativePath !== '.bh'
			? URI.joinPath(baseHalfMirrorRoot(index.folder), ...relativePath.split('/'))
			: undefined;
		const extUri = this.uriIdentityService.extUri;
		for (const record of [...index.records.values()]) {
			if (extUri.isEqualOrParent(record.storeResource, deleted)
				|| extUri.isEqualOrParent(record.node.resource, deleted)
				|| (mirror && extUri.isEqualOrParent(record.storeResource, mirror))) {
				this.deleteRecord(index, record.storeKey);
				changed.push(record.node.resource);
			}
		}
		for (const [key, problem] of [...index.problems]) {
			if (extUri.isEqualOrParent(problem.resource, deleted)) {
				index.problems.delete(key);
			}
		}
		changed.push(deleted);
		return changed;
	}

	/** Re-scans a subtree (and its mirror subtree) after a folder or a path of unknown type appeared. */
	private async rescanSubtree(index: IFolderIndex, root: URI): Promise<URI[]> {
		const relativePath = getRelativePath(index.folder, root);
		if (relativePath === undefined) {
			return [];
		}
		const changed: URI[] = [];
		const partialReasons = new Set<BaseHalfReferenceIndexPartialReason>();
		const resources: URI[] = [];
		const inMirror = this.uriIdentityService.extUri.isEqualOrParent(root, baseHalfMirrorRoot(index.folder));
		if (inMirror) {
			const mirrorRelative = getRelativePath(baseHalfMirrorRoot(index.folder), root) ?? '';
			try {
				resources.push(...await this.walkSidecars(index.folder, mirrorRelative));
			} catch (error) {
				partialReasons.add('readError');
			}
		} else if (this.isIndexable(index, relativePath)) {
			const stat = await this.statNode(root);
			if (stat && this.isCanvasEligible(index, relativePath, stat.isDirectory)) {
				if (stat.isDirectory) {
					resources.push(...await this.enumerate(index, root, partialReasons));
				} else {
					resources.push(baseHalfUpstreamSidecarResource(index.folder, relativePath));
				}
			}
		}
		for (const resource of resources) {
			const result = await this.readStoreResource(index, resource);
			if (this.applyRead(index, resource, result, false)) {
				changed.push(result.kind === 'record' ? result.record.node.resource : resource);
			}
		}
		for (const reason of partialReasons) {
			index.partialReasons.add(reason);
			if (index.state === 'ready') {
				index.state = 'partial';
			}
		}
		return changed;
	}

	//#endregion

	//#region Views

	/** `noteRead` is the own read of the note a sidecar `record` belongs to; it defaults to the indexed one. */
	private async view(index: IFolderIndex | undefined, node: IBaseHalfWorkspaceResource, record: IStoreRecord, readError: string | undefined, noteRead?: IBaseHalfUpstreamStoreRead): Promise<IBaseHalfUpstreamView> {
		const read = record.read;
		if (record.storeKind === 'markdown' && readError === undefined && baseHalfMarkdownNoteUsesSidecar(read, false) && !index?.sidecarsByNode.has(record.nodeKey)) {
			// The note cannot hold a list and has none yet: this is the empty
			// list BaseHalf will keep for it. Entries it can read in the note's
			// unrecognized leading block are an issue until they are carried over.
			return {
				node,
				storeKind: 'sidecar',
				storeResource: baseHalfUpstreamSidecarResource(node.workspaceFolder, node.relativePath),
				readable: true,
				writable: true,
				...(read.issue && read.problem ? { problem: read.problem } : {}),
				storeIssue: read.issue,
				entries: [],
				...this.upstreamOnly(index, node),
				issueCount: read.issue ? 1 : 0
			};
		}
		const identity = index?.identity ?? baseHalfUpstreamIdentity(node.workspaceFolder, this.uriIdentityService.extUri);
		const bindingsByKey = new Map<string, IBaseHalfIndexedBinding>();
		for (const binding of record.bindings ?? []) {
			bindingsByKey.set(identity.key(binding.sourcePath), binding);
		}
		const historicalAllowed = record.lifecycle === 'attempted' || record.lifecycle === 'sealed';
		const entries: IBaseHalfUpstreamEntryView[] = [];
		for (const item of read.items) {
			const binding = item.path !== undefined ? bindingsByKey.get(identity.key(item.path)) : undefined;
			if (item.path !== undefined) {
				const target = await this.resolveTarget(node.workspaceFolder, item.path);
				const historical = !target && historicalAllowed && !!binding;
				entries.push({
					...item,
					status: target ? 'valid' : 'dangling',
					...(target ? { target } : {}),
					...(binding ? { binding } : {}),
					historical,
					issue: !target && !historical
				});
				continue;
			}
			let workspacePath: string | undefined;
			if (item.scalar && read.readable && item.problem !== 'duplicate' && item.problem !== 'self') {
				const candidate = baseHalfResolveFileRelativeUpstreamEntry(item.text, node.relativePath);
				if (candidate !== undefined && candidate !== node.relativePath && await this.resolveTarget(node.workspaceFolder, candidate)) {
					workspacePath = candidate;
				}
			}
			entries.push({
				...item,
				status: 'invalid',
				...(binding ? { binding } : {}),
				historical: false,
				...(workspacePath !== undefined ? { workspacePath } : {}),
				issue: true
			});
		}
		const sidecarKey = record.storeKind !== 'sidecar' && index ? index.sidecarsByNode.get(record.nodeKey) : undefined;
		const sidecar = sidecarKey ? index?.records.get(sidecarKey) : undefined;
		// A sidecar that is a note's store could move into the note once the
		// note can take a list; it stays in use until the user moves it.
		const ownerRecord = record.storeKind === 'sidecar' && record.sidecarState === 'active' ? index?.records.get(record.nodeKey) : undefined;
		const owner = record.storeKind === 'sidecar' && record.sidecarState === 'active'
			? noteRead ?? (ownerRecord?.storeKind === 'markdown' ? ownerRecord.read : undefined)
			: undefined;
		const misplacedSidecar = owner && owner.writable && !owner.hasKey
			? { resource: record.storeResource, items: read.items }
			: sidecar?.sidecarState === 'wrongOwner'
				? { resource: sidecar.storeResource, items: sidecar.read.items }
				: undefined;
		const storeIssue = read.issue || readError !== undefined;
		return {
			node,
			storeKind: record.storeKind,
			storeResource: record.storeResource,
			readable: read.readable,
			writable: read.writable,
			...(read.problem ? { problem: read.problem } : {}),
			storeIssue,
			entries,
			...this.upstreamOnly(index, node),
			...(record.lifecycle ? { lifecycle: record.lifecycle } : {}),
			...(misplacedSidecar ? { misplacedSidecar } : {}),
			...(readError !== undefined ? { readError } : {}),
			issueCount: entries.filter(entry => entry.issue).length + (storeIssue ? 1 : 0) + (misplacedSidecar ? 1 : 0)
		};
	}

	private upstreamOnly(index: IFolderIndex | undefined, node: IBaseHalfWorkspaceResource): { readonly upstreamOnly?: 'reservedOutput' | 'sealedArtifact' } {
		if (isBaseHalfUpstreamReservedOutput(node.relativePath)) {
			return { upstreamOnly: 'reservedOutput' };
		}
		if (index?.sealed.has(index.identity.key(node.relativePath))) {
			return { upstreamOnly: 'sealedArtifact' };
		}
		return {};
	}

	/** The node an entry path names, or `undefined` when it is dangling. */
	private async resolveTarget(workspaceFolder: URI, path: string): Promise<IBaseHalfUpstreamTarget | undefined> {
		const index = this.folderIndex(workspaceFolder);
		const resource = URI.joinPath(workspaceFolder, ...path.normalize('NFC').split('/'));
		if (index && this.ownerIndex(resource) !== index) {
			return undefined;
		}
		const stat = await this.statNode(resource);
		if (!stat || (!stat.isFile && !stat.isDirectory)) {
			return undefined;
		}
		if (index && !this.isCanvasEligible(index, path, stat.isDirectory)) {
			return undefined;
		}
		return { resource: stat.resource, workspaceFolder, relativePath: path, kind: stat.isDirectory ? 'folder' : 'file' };
	}

	private statNode(resource: URI): Promise<INodeStat | undefined> {
		const key = this.resourceKey(resource);
		let pending = this.existence.get(key);
		if (!pending) {
			pending = this.fileService.stat(resource).then(
				stat => ({ resource: stat.resource, isFile: stat.isFile, isDirectory: stat.isDirectory }),
				() => undefined
			);
			this.existence.set(key, pending);
		}
		return pending;
	}

	//#endregion

	//#region Eligibility

	private resourceKey(resource: URI): string {
		return baseHalfUpstreamResourceKey(resource, this.uriIdentityService.extUri);
	}

	private isStoreFileName(relativePath: string): boolean {
		const name = relativePath.slice(relativePath.lastIndexOf('/') + 1);
		return isBaseHalfUpstreamMarkdownName(name) || isBaseHalfUpstreamNodeDocumentName(name);
	}

	/** Paths below `.bh/`, the reserved outputs tree, and nested workspace folders are not stores of this folder. */
	private isIndexable(index: IFolderIndex, relativePath: string): boolean {
		if (relativePath === '' || relativePath === '.bh' || relativePath.startsWith('.bh/') || isBaseHalfUpstreamReservedOutput(relativePath)) {
			return false;
		}
		const resource = URI.joinPath(index.folder, ...relativePath.split('/'));
		return this.ownerIndex(resource) === index;
	}

	/** Whether every segment is one the canvas could show as a card. */
	private isCanvasEligible(index: IFolderIndex, relativePath: string, isDirectory: boolean): boolean {
		const segments = relativePath.split('/');
		let current = index.folder;
		for (let position = 0; position < segments.length; position++) {
			current = URI.joinPath(current, segments[position]);
			const directory = position < segments.length - 1 || isDirectory;
			const stat: IFileStat = { resource: current, name: segments[position], isFile: !directory, isDirectory: directory, isSymbolicLink: false, children: undefined };
			if (!isBaseHalfCanvasEntry(stat, position === 0)) {
				return false;
			}
		}
		return true;
	}

	//#endregion
}

function toIndexedStore(record: IStoreRecord): IBaseHalfIndexedStore {
	return {
		node: record.node,
		storeKind: record.storeKind,
		storeResource: record.storeResource,
		read: record.read,
		...(record.lifecycle ? { lifecycle: record.lifecycle } : {}),
		...(record.bindings ? { bindings: record.bindings } : {}),
		...(record.sidecarState ? { sidecarState: record.sidecarState } : {})
	};
}

/** The same sidecar record in another state. Only an active sidecar contributes edges. */
function withSidecarState(identity: IBaseHalfUpstreamIdentity, record: IStoreRecord, sidecarState: BaseHalfUpstreamSidecarState): IStoreRecord {
	const targets: (readonly [string, number])[] = [];
	if (sidecarState === 'active' && record.read.readable) {
		for (const item of record.read.items) {
			if (item.path !== undefined) {
				targets.push([identity.key(item.path), item.index]);
			}
		}
	}
	return { ...record, sidecarState, targets };
}

function emptyRecord(node: IBaseHalfWorkspaceResource, storeKind: BaseHalfUpstreamStoreKind, storeResource: URI, storeKey: string, nodeKey: string): IStoreRecord {
	return {
		node,
		storeKind,
		storeResource,
		read: { readable: true, writable: true, items: [], hasKey: false, issue: false },
		storeKey,
		nodeKey,
		content: '',
		targets: []
	};
}

const utf8Decoder = new TextDecoder('utf-8', { ignoreBOM: true });

function decodeUtf8(bytes: Uint8Array): string {
	return utf8Decoder.decode(bytes);
}

function isFileNotFound(error: unknown): boolean {
	return error instanceof Error && toFileOperationResult(error) === FileOperationResult.FILE_NOT_FOUND;
}

/**
 * The store read of a `.bhnode` document from the lenient extractor. Every
 * item problem (non-string, grammar, self, duplicate, past the 64th) is per
 * entry; an unreadable document is an unreadable store.
 */
export function baseHalfNodeUpstreamStoreRead(extract: BaseHalfNodeUpstreamExtract, nodePath: string, identity: IBaseHalfUpstreamIdentity): IBaseHalfUpstreamStoreRead {
	if (!extract.readable) {
		return { readable: false, writable: false, items: [], hasKey: true, problem: 'invalidDocument', issue: true };
	}
	const items = baseHalfAnalyzeUpstreamItems(baseHalfNodeUpstreamItemValues(extract.upstream), nodePath, identity, {
		maxEntries: BASEHALF_UPSTREAM_MAX_NODE_ENTRIES,
		nonScalarProblem: 'notString'
	});
	return { readable: true, writable: true, items, hasKey: true, issue: false };
}

registerSingleton(IBaseHalfReferenceIndexService, BaseHalfReferenceIndexService, InstantiationType.Delayed);
