/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise, Limiter, timeout } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { basename, relativePath as getRelativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { FileChangesEvent, FileOperationResult, IFileService, IFileStat, toFileOperationResult } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IFileQuery, ISearchService, QueryType } from '../../../services/search/common/search.js';
import { IBaseHalfWorkspaceResource } from '../../navigation/common/basehalfCanvasNavigation.js';
import { baseHalfIsCanvasEligiblePath } from '../../canvas/common/basehalfCanvasModel.js';
import { baseHalfAssertMirrorPathComponentsNotSymbolicLink, baseHalfMirrorResource, baseHalfMirrorRoot } from '../../workspace/common/basehalfMirrorTree.js';
import { baseHalfPlainFailureReason } from '../../shell/common/basehalfPlainFailureReason.js';
import { BASEHALF_GENERATION_INFO_FILE, BASEHALF_GENERATION_MADE_FILE, baseHalfGenerationKindOfPath } from '../../video/common/basehalfGenerationInfo.js';
import { baseHalfIsDraft, baseHalfIsDraftInformation } from '../../video/common/basehalfGenerationDraft.js';
import {
	BASEHALF_NODE_DOCUMENT_MAX_BYTES,
	baseHalfNodeUpstreamItemValues,
	BaseHalfNodeUpstreamExtract,
	extractBaseHalfNodeUpstreamLenient
} from '../../video/common/basehalfNodeDocument.js';
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
	/** Sidecars only. Only `active` sidecars contribute edges. */
	readonly sidecarState?: BaseHalfUpstreamSidecarState;
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
	/**
	 * The entry names a draft: a generation card whose file does not exist
	 * yet (reference graph, "Drafts"). It is not dangling; as an input it is
	 * unavailable until the draft has its file.
	 */
	readonly draft?: true;
}

export type BaseHalfUpstreamEntryStatus = 'valid' | 'dangling' | 'invalid';

/** One row of a node's Upstream list. */
export interface IBaseHalfUpstreamEntryView extends IBaseHalfUpstreamItem {
	readonly status: BaseHalfUpstreamEntryStatus;
	/** The node a `valid` entry names. */
	readonly target?: IBaseHalfUpstreamTarget;
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
	/**
	 * @deprecated Never set since D63: every node can be downstream, a
	 * generated file and a file under `outputs/` included. Kept until the
	 * canvas stops reading it; a later cleanup removes it.
	 */
	readonly upstreamOnly?: 'reservedOutput' | 'resultArtifact';
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

	/**
	 * The drafts of a workspace folder that are shown: generation cards whose
	 * file does not exist yet, in folders that exist (reference graph,
	 * "Drafts"), as workspace-relative paths in path order. Complete once the
	 * folder is `ready` or `partial`.
	 */
	getDrafts(workspaceFolder: URI): readonly string[];
	/** Whether the node is a draft the index knows ({@link getDrafts}). */
	isDraft(node: IBaseHalfWorkspaceResource): boolean;
	/**
	 * @deprecated Always `undefined` since D63: every node can be downstream,
	 * a generated file and a file under `outputs/` included (reference graph,
	 * "Stores"). Kept until the canvas stops asking; a later cleanup removes it.
	 */
	getUpstreamOnlyReason(node: IBaseHalfWorkspaceResource): 'reservedOutput' | 'resultArtifact' | undefined;

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
	/** node key → workspace-relative path of every draft that is shown */
	readonly drafts: Map<string, string>;
	generation: number;
	scanned: DeferredPromise<void>;
	pending: { readonly added: URI[]; readonly updated: URI[]; readonly deleted: URI[] } | undefined;
	disposed: boolean;
}

interface INodeStat {
	readonly resource: URI;
	readonly isFile: boolean;
	readonly isDirectory: boolean;
	readonly isSymbolicLink: boolean;
}

/** What one walk of `.bh/mirror/` found: the sidecar stores, and the paths whose card information is a draft's. */
interface IMirrorWalk {
	readonly sidecars: URI[];
	readonly drafts: string[];
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
export const BASEHALF_SEARCH_EXCLUDED_DIRECTORY_NAMES = [
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
		const draft = !stat && await this.holdsDraft(node.workspaceFolder, node.relativePath);
		const result = await this.readStore(node.workspaceFolder, identity, node, storeKind, storeResource, stat, draft);
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
				issueCount: 1
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
				issueCount: 1
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

	getDrafts(workspaceFolder: URI): readonly string[] {
		return [...(this.folderIndex(workspaceFolder)?.drafts.values() ?? [])].sort();
	}

	isDraft(node: IBaseHalfWorkspaceResource): boolean {
		return this.folderIndex(node.workspaceFolder)?.drafts.has(this.resourceKey(node.resource)) ?? false;
	}

	getUpstreamOnlyReason(_node: IBaseHalfWorkspaceResource): 'reservedOutput' | 'resultArtifact' | undefined {
		return undefined;
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
			drafts: new Map(),
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
		let drafts: readonly string[] = [];
		try {
			const enumerated = await this.enumerate(index, index.folder, partialReasons);
			await this.readAll(index, enumerated.resources, results, problems);
			drafts = await this.shownDrafts(index, enumerated.drafts);
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
		index.problems.clear();
		index.drafts.clear();
		for (const path of drafts) {
			index.drafts.set(this.resourceKey(URI.joinPath(index.folder, ...path.split('/'))), path);
		}
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

	/**
	 * Enumerates candidate store resources below `root` (a folder or a
	 * subtree), and the paths below it whose card information is a draft's
	 * (whether each is shown is decided by {@link shownDrafts}).
	 */
	private async enumerate(index: IFolderIndex, root: URI, partialReasons: Set<BaseHalfReferenceIndexPartialReason>): Promise<{ readonly resources: URI[]; readonly drafts: readonly string[] }> {
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
			excludePattern: Object.fromEntries(BASEHALF_SEARCH_EXCLUDED_DIRECTORY_NAMES.map(name => [`**/${name}`, true])),
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
		let drafts: readonly string[] = [];
		try {
			const walk = await this.walkMirror(index.folder, rootRelative);
			resources.push(...walk.sidecars);
			drafts = walk.drafts;
		} catch (error) {
			this.logService.warn('[BaseHalf] upstream sidecar walk failed', error);
			partialReasons.add('readError');
		}
		if (resources.length > BASEHALF_REFERENCE_INDEX_STORE_LIMIT) {
			partialReasons.add('storeLimit');
			resources.length = BASEHALF_REFERENCE_INDEX_STORE_LIMIT;
		}
		return { resources, drafts };
	}

	/** Of the paths whose card information is a draft's, those that hold a draft that is shown. */
	private async shownDrafts(index: IFolderIndex, candidates: readonly string[]): Promise<string[]> {
		const shown = await Promise.all(candidates.map(async path => await this.holdsDraft(index.folder, path) ? path : undefined));
		return shown.filter((path): path is string => path !== undefined);
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

	/**
	 * Walks `.bh/mirror/<root>/**` without following links, for the
	 * `upstream.yaml` files and for the directories that hold a draft's card
	 * information: a `generation.yaml` and no `made.yaml`, under a name with a
	 * generation extension (reference graph, "Sources").
	 */
	private async walkMirror(workspaceFolder: URI, rootRelative: string): Promise<IMirrorWalk> {
		const mirrorRoot = baseHalfMirrorRoot(workspaceFolder);
		const rootSidecar = URI.joinPath(mirrorRoot, BASEHALF_UPSTREAM_SIDECAR_FILE_NAME).toString();
		const walk: IMirrorWalk = { sidecars: [], drafts: [] };
		const stack: { readonly resource: URI; readonly path: string }[] = [{ resource: rootRelative ? URI.joinPath(mirrorRoot, ...rootRelative.split('/')) : mirrorRoot, path: rootRelative }];
		while (stack.length > 0) {
			const current = stack.pop()!;
			let children: readonly IFileStat[];
			try {
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, current.resource);
				const resolved = await this.fileService.resolve(current.resource);
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
			let hasGenerationInfo = false;
			let hasMade = false;
			for (const child of children) {
				if (child.isSymbolicLink) {
					continue;
				}
				if (child.isDirectory) {
					stack.push({ resource: child.resource, path: current.path ? `${current.path}/${child.name}` : child.name });
				} else if (child.isFile && child.name === BASEHALF_UPSTREAM_SIDECAR_FILE_NAME && child.resource.toString() !== rootSidecar) {
					walk.sidecars.push(child.resource);
				} else if (child.isFile && child.name === BASEHALF_GENERATION_INFO_FILE) {
					hasGenerationInfo = true;
				} else if (child.isFile && child.name === BASEHALF_GENERATION_MADE_FILE) {
					hasMade = true;
				}
			}
			if (current.path && baseHalfIsDraftInformation({ path: current.path, hasGenerationInfo, hasMade })) {
				walk.drafts.push(current.path);
			}
		}
		return walk;
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
			const draft = !stat && await this.holdsDraft(index.folder, nodePath);
			return this.readStore(index.folder, index.identity, { resource: nodeResource, workspaceFolder: index.folder, relativePath: nodePath }, 'sidecar', resource, stat, draft);
		}
		const relativePath = getRelativePath(index.folder, resource);
		if (relativePath === undefined) {
			return { kind: 'missing' };
		}
		const storeKind = baseHalfUpstreamStoreKind(relativePath, false);
		return this.readStore(index.folder, index.identity, { resource, workspaceFolder: index.folder, relativePath }, storeKind, resource, undefined);
	}

	/**
	 * Reads one store from disk. `nodeStat` is required for sidecars, and
	 * `nodeIsDraft` tells a node without a file or folder that is a draft,
	 * whose sidecar is live (reference graph, "Sidecar store"), from one that
	 * is missing.
	 */
	private async readStore(
		workspaceFolder: URI,
		identity: IBaseHalfUpstreamIdentity,
		node: IBaseHalfWorkspaceResource,
		storeKind: BaseHalfUpstreamStoreKind,
		storeResource: URI,
		nodeStat: INodeStat | undefined,
		nodeIsDraft = false
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
					? nodeIsDraft ? 'active' : 'missingNode'
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
		if (storeKind === 'markdown') {
			read = readBaseHalfMarkdownUpstream(content, { nodePath: node.relativePath, identity });
		} else if (storeKind === 'sidecar') {
			read = readBaseHalfSidecarUpstream(content, { nodePath: node.relativePath, identity });
		} else {
			read = baseHalfNodeUpstreamStoreRead(extractBaseHalfNodeUpstreamLenient(content), node.relativePath, identity);
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
		return {
			node,
			storeKind,
			storeResource,
			read,
			...(sidecarState ? { sidecarState } : {}),
			storeKey: this.resourceKey(storeResource),
			nodeKey: this.resourceKey(node.resource),
			// Only the upstream state matters: a body edit, a BOM, or a different
			// read window never counts as a store change.
			content: JSON.stringify(read),
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
		if (record.storeKind !== 'sidecar' || !isBaseHalfUpstreamMarkdownName(record.node.relativePath)) {
			return record;
		}
		// The note's own record means the note exists, also for a sidecar
		// that was read while the note was away.
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
		changed.push(...this.dropSubtrees(index, batch.deleted));
		// The paths whose draft has to be looked at again (reference graph, "Events").
		const draftChecks = this.draftChecksOfDeleted(index, batch.deleted);
		const reads: URI[] = [];
		const subtrees: URI[] = [];
		// The sidecars of notes that were added: deleting a note drops its
		// sidecar's record, so a note that comes back reads its sidecar again.
		const noteSidecars: URI[] = [];
		for (const resource of [...batch.added, ...batch.updated]) {
			const kind = this.classifyEvent(index, resource);
			if (kind === 'store') {
				reads.push(resource);
				const relativePath = getRelativePath(index.folder, resource);
				if (relativePath !== undefined && batch.added.includes(resource) && isBaseHalfUpstreamMarkdownName(relativePath) && this.sidecarNodePath(index, resource) === undefined) {
					noteSidecars.push(baseHalfUpstreamSidecarResource(index.folder, relativePath));
				}
			} else if (kind === 'draftInformation') {
				// A `generation.yaml` or `made.yaml` came or changed: the path may hold a draft now, or no longer.
				draftChecks.add(this.mirrorNodePath(index, resource)!);
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
		for (const resource of noteSidecars) {
			if (index.disposed || generation !== index.generation) {
				return;
			}
			const result = await this.readStoreResource(index, resource);
			if (index.disposed || generation !== index.generation) {
				return;
			}
			// A note without a sidecar is the usual case and changes nothing.
			if ((result.kind !== 'missing' || index.records.has(this.resourceKey(resource))) && this.applyRead(index, resource, result, false)) {
				changed.push(result.kind === 'record' ? result.record.node.resource : resource);
			}
		}
		for (const root of subtrees) {
			if (index.disposed || generation !== index.generation) {
				return;
			}
			changed.push(...await this.rescanSubtree(index, root));
		}
		if (index.disposed || generation !== index.generation) {
			return;
		}
		changed.push(...await this.recheckDrafts(index, draftChecks));
		if (changed.length > 0 && !index.disposed && generation === index.generation) {
			this.fire(index, changed);
		}
	}

	/**
	 * The paths whose draft the deleted paths may have changed: a draft below
	 * a deleted folder is not shown any more, a draft whose card information
	 * was deleted is gone, and a file without a record that was deleted leaves
	 * a draft behind at its own path.
	 */
	private draftChecksOfDeleted(index: IFolderIndex, deleted: readonly URI[]): Set<string> {
		const checks = new Set<string>();
		const mirrorRoot = baseHalfMirrorRoot(index.folder);
		const extUri = this.uriIdentityService.extUri;
		for (const resource of deleted) {
			let below: string | undefined;
			if (extUri.isEqualOrParent(mirrorRoot, resource)) {
				// `.bh` or its mirror: every draft goes with it.
				below = '';
			} else if (extUri.isEqualOrParent(resource, mirrorRoot)) {
				// A `generation.yaml` or `made.yaml` that is gone, or a directory with drafts below it.
				const nodePath = this.mirrorNodePath(index, resource);
				if (nodePath !== undefined) {
					checks.add(nodePath);
				}
				below = nodePath ?? getRelativePath(mirrorRoot, resource);
			} else {
				const relativePath = getRelativePath(index.folder, resource);
				if (relativePath === undefined || relativePath === '' || relativePath === '.bh' || relativePath.startsWith('.bh/')) {
					continue;
				}
				checks.add(relativePath);
				below = relativePath;
			}
			if (below === undefined) {
				continue;
			}
			for (const path of index.drafts.values()) {
				if (below === '' || path === below || path.startsWith(`${below}/`)) {
					checks.add(path);
				}
			}
		}
		return checks;
	}

	/**
	 * Looks again at whether each path holds a draft that is shown, keeps the
	 * index's drafts in step, and reads the path's sidecar again: a draft's
	 * sidecar is live, and that of a path that holds nothing is not. Returns
	 * the node resources whose state changed.
	 */
	private async recheckDrafts(index: IFolderIndex, paths: Iterable<string>): Promise<URI[]> {
		const changed: URI[] = [];
		for (const path of paths) {
			if (index.disposed) {
				break;
			}
			if (baseHalfGenerationKindOfPath(path) === undefined || !this.isIndexable(index, path)) {
				continue;
			}
			const resource = URI.joinPath(index.folder, ...path.split('/'));
			const key = this.resourceKey(resource);
			const holds = await this.holdsDraft(index.folder, path);
			const sidecar = baseHalfUpstreamSidecarResource(index.folder, path);
			const known = index.records.has(this.resourceKey(sidecar));
			if (holds === index.drafts.has(key) && !known) {
				// Nothing to look at again: most deleted files never were drafts.
				continue;
			}
			if (holds !== index.drafts.has(key)) {
				if (holds) {
					index.drafts.set(key, path);
				} else {
					index.drafts.delete(key);
				}
				changed.push(resource);
			}
			const result = await this.readStoreResource(index, sidecar);
			if ((result.kind !== 'missing' || known) && this.applyRead(index, sidecar, result, false)) {
				changed.push(resource);
			}
		}
		return changed;
	}

	/** For a file in a node's directory under `.bh/mirror/` (not `upstream.yaml` alone), the node's workspace-relative path. */
	private mirrorNodePath(index: IFolderIndex, resource: URI): string | undefined {
		const relative = getRelativePath(baseHalfMirrorRoot(index.folder), resource);
		if (relative === undefined || !relative.includes('/') || relative.startsWith('../')) {
			return undefined;
		}
		const name = relative.slice(relative.lastIndexOf('/') + 1);
		return name === BASEHALF_GENERATION_INFO_FILE || name === BASEHALF_GENERATION_MADE_FILE ? relative.slice(0, relative.lastIndexOf('/')) : undefined;
	}

	private classifyEvent(index: IFolderIndex, resource: URI): 'store' | 'draftInformation' | 'unknown' | 'ignored' {
		const relativePath = getRelativePath(index.folder, resource);
		if (relativePath === undefined || relativePath === '') {
			return 'ignored';
		}
		const first = relativePath.split('/')[0];
		if (first === '.bh') {
			if (!this.uriIdentityService.extUri.isEqualOrParent(resource, baseHalfMirrorRoot(index.folder))) {
				return 'ignored';
			}
			if (this.mirrorNodePath(index, resource) !== undefined) {
				return 'draftInformation';
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

	/**
	 * Drops every store at or under the deleted paths, including sidecars under
	 * the matching mirror paths. One pass over the stores serves all the paths:
	 * a store is looked up among them by its own key and the keys above it, so
	 * many files deleted at once cost no more than one (reference graph, "Events").
	 */
	private dropSubtrees(index: IFolderIndex, deleted: readonly URI[]): URI[] {
		if (deleted.length === 0) {
			return [];
		}
		const paths = new Set<string>();
		const mirrorPaths = new Set<string>();
		for (const resource of deleted) {
			paths.add(this.resourceKey(resource));
			const relativePath = getRelativePath(index.folder, resource);
			if (relativePath && !relativePath.startsWith('.bh/') && relativePath !== '.bh') {
				mirrorPaths.add(this.resourceKey(URI.joinPath(baseHalfMirrorRoot(index.folder), ...relativePath.split('/'))));
			}
		}
		// A key is its resource as text, and the key of a folder is the start of
		// the keys below it. An event names a path at or below the workspace folder.
		const shortest = this.resourceKey(index.folder).length;
		const atOrBelow = (key: string, among: ReadonlySet<string>): boolean => {
			for (let end = key.length; end >= shortest; end = key.lastIndexOf('/', end - 1)) {
				if (among.has(end === key.length ? key : key.slice(0, end))) {
					return true;
				}
			}
			return false;
		};
		const changed: URI[] = [];
		for (const record of [...index.records.values()]) {
			if (atOrBelow(record.storeKey, paths) || atOrBelow(record.nodeKey, paths) || atOrBelow(record.storeKey, mirrorPaths)) {
				this.deleteRecord(index, record.storeKey);
				changed.push(record.node.resource);
			}
		}
		for (const [key, problem] of [...index.problems]) {
			if (atOrBelow(this.resourceKey(problem.resource), paths)) {
				index.problems.delete(key);
			}
		}
		changed.push(...deleted);
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
		// Every draft below the subtree is looked at again: those its walk finds,
		// and those the index knew there.
		const draftChecks = new Set<string>();
		let below: string | undefined;
		const inMirror = this.uriIdentityService.extUri.isEqualOrParent(root, baseHalfMirrorRoot(index.folder));
		if (inMirror) {
			const mirrorRelative = getRelativePath(baseHalfMirrorRoot(index.folder), root) ?? '';
			below = mirrorRelative;
			try {
				const walk = await this.walkMirror(index.folder, mirrorRelative);
				resources.push(...walk.sidecars);
				walk.drafts.forEach(path => draftChecks.add(path));
			} catch (error) {
				partialReasons.add('readError');
			}
		} else if (this.isIndexable(index, relativePath)) {
			below = relativePath;
			const stat = await this.statNode(root);
			if (stat && this.isCanvasEligible(index, relativePath, stat.isDirectory)) {
				if (stat.isDirectory) {
					const enumerated = await this.enumerate(index, root, partialReasons);
					resources.push(...enumerated.resources);
					enumerated.drafts.forEach(path => draftChecks.add(path));
				} else {
					resources.push(baseHalfUpstreamSidecarResource(index.folder, relativePath));
				}
			}
		}
		if (below !== undefined) {
			for (const path of index.drafts.values()) {
				if (below === '' || path === below || path.startsWith(`${below}/`)) {
					draftChecks.add(path);
				}
			}
		}
		for (const resource of resources) {
			const result = await this.readStoreResource(index, resource);
			if (this.applyRead(index, resource, result, false)) {
				changed.push(result.kind === 'record' ? result.record.node.resource : resource);
			}
		}
		changed.push(...await this.recheckDrafts(index, draftChecks));
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
				issueCount: read.issue ? 1 : 0
			};
		}
		const entries: IBaseHalfUpstreamEntryView[] = [];
		for (const item of read.items) {
			if (item.path !== undefined) {
				const target = await this.resolveTarget(node.workspaceFolder, item.path);
				entries.push({
					...item,
					status: target ? 'valid' : 'dangling',
					...(target ? { target } : {}),
					issue: !target
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
			...(misplacedSidecar ? { misplacedSidecar } : {}),
			...(readError !== undefined ? { readError } : {}),
			issueCount: entries.filter(entry => entry.issue).length + (storeIssue ? 1 : 0) + (misplacedSidecar ? 1 : 0)
		};
	}

	/** The node an entry path names, or `undefined` when it is dangling. A draft is a node (reference graph, "Drafts"). */
	private async resolveTarget(workspaceFolder: URI, path: string): Promise<IBaseHalfUpstreamTarget | undefined> {
		const index = this.folderIndex(workspaceFolder);
		const normalized = path.normalize('NFC');
		const resource = URI.joinPath(workspaceFolder, ...normalized.split('/'));
		if (index && this.ownerIndex(resource) !== index) {
			return undefined;
		}
		const stat = await this.statNode(resource);
		if (!stat) {
			return await this.holdsDraft(workspaceFolder, normalized) ? { resource, workspaceFolder, relativePath: path, kind: 'file', draft: true } : undefined;
		}
		if (!stat.isFile && !stat.isDirectory) {
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
				stat => ({ resource: stat.resource, isFile: stat.isFile, isDirectory: stat.isDirectory, isSymbolicLink: !!stat.isSymbolicLink }),
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

	/**
	 * Whether `path` holds a draft that is shown: a generation card whose file
	 * does not exist yet, in a folder that exists (reference graph, "Drafts").
	 * It is decided from the stats this event batch has cached.
	 */
	private async holdsDraft(workspaceFolder: URI, path: string): Promise<boolean> {
		if (baseHalfGenerationKindOfPath(path) === undefined) {
			return false;
		}
		const index = this.folderIndex(workspaceFolder);
		if (path === '.bh' || path.startsWith('.bh/') || (index && (!this.isIndexable(index, path) || !this.isCanvasEligible(index, path, false)))) {
			return false;
		}
		let information: URI;
		let made: URI;
		try {
			information = baseHalfMirrorResource(workspaceFolder, path, BASEHALF_GENERATION_INFO_FILE);
			made = baseHalfMirrorResource(workspaceFolder, path, BASEHALF_GENERATION_MADE_FILE);
		} catch {
			// A path with `.` or `..` segments names no node.
			return false;
		}
		const slash = path.lastIndexOf('/');
		const [item, folder, informationStat, madeStat] = await Promise.all([
			this.statNode(URI.joinPath(workspaceFolder, ...path.split('/'))),
			slash < 0 ? Promise.resolve(undefined) : this.statNode(URI.joinPath(workspaceFolder, ...path.slice(0, slash).split('/'))),
			this.statNode(information),
			this.statNode(made)
		]);
		const isMirrorFile = (stat: INodeStat | undefined) => !!stat?.isFile && !stat.isSymbolicLink;
		return baseHalfIsDraft({ path, hasGenerationInfo: isMirrorFile(informationStat), hasMade: isMirrorFile(madeStat), itemExists: !!item })
			&& (slash < 0 || !!folder?.isDirectory);
	}

	/** Paths below `.bh/` and in nested workspace folders are not stores of this folder. */
	private isIndexable(index: IFolderIndex, relativePath: string): boolean {
		if (relativePath === '' || relativePath === '.bh' || relativePath.startsWith('.bh/')) {
			return false;
		}
		const resource = URI.joinPath(index.folder, ...relativePath.split('/'));
		return this.ownerIndex(resource) === index;
	}

	/** Whether every segment is one the canvas could show as a card. */
	private isCanvasEligible(index: IFolderIndex, relativePath: string, isDirectory: boolean): boolean {
		return baseHalfIsCanvasEligiblePath(index.folder, relativePath, isDirectory);
	}

	//#endregion
}

function toIndexedStore(record: IStoreRecord): IBaseHalfIndexedStore {
	return {
		node: record.node,
		storeKind: record.storeKind,
		storeResource: record.storeResource,
		read: record.read,
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

/** A store that is not there: no file, or a folder whose name looks like a store's. */
function isFileNotFound(error: unknown): boolean {
	const result = error instanceof Error ? toFileOperationResult(error) : undefined;
	return result === FileOperationResult.FILE_NOT_FOUND || result === FileOperationResult.FILE_IS_DIRECTORY;
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
