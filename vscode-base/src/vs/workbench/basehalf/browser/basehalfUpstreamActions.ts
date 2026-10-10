/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, EventType } from '../../../base/browser/dom.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { Disposable, IDisposable } from '../../../base/common/lifecycle.js';
import { basename, relativePath as getRelativePath } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { IDialogService } from '../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../platform/notification/common/notification.js';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from '../../../platform/quickinput/common/quickInput.js';
import { IUriIdentityService } from '../../../platform/uriIdentity/common/uriIdentity.js';
import { IFileQuery, ISearchService, QueryType } from '../../services/search/common/search.js';
import { IBaseHalfBadgeMirrorService } from '../common/basehalfBadgeMirror.js';
import { BASEHALF_CANVAS_UNDO_REDO_SOURCE } from '../common/basehalfCanvasEditing.js';
import { IBaseHalfCanvasMirrorService } from '../common/basehalfCanvasMirror.js';
import { BASEHALF_CANVAS_SKIP_NAMES, isBaseHalfCanvasPathEligible } from '../common/basehalfCanvasModel.js';
import { IBaseHalfWorkspaceResource } from '../common/basehalfCanvasNavigation.js';
import { baseHalfUserFacingErrorMessage } from '../common/basehalfPlainFailureReason.js';
import {
	baseHalfCanvasConnectionSummary,
	baseHalfOrderUpstreamPickerCandidates,
	baseHalfUniqueUpstreamNameMatch,
	baseHalfUpstreamEntryMessage,
	baseHalfUpstreamRebuildCarriesOver,
	baseHalfUpstreamStoreCanRebuild,
	baseHalfUpstreamStoreProblemMessage,
	IBaseHalfUpstreamPickerCandidate
} from '../common/basehalfCanvasUpstream.js';
import { IBaseHalfNodeUpstreamBindingRequest } from '../common/basehalfNodeDocument.js';
import {
	BaseHalfReferenceEditFailure,
	BaseHalfReferenceEditRefusal,
	IBaseHalfReferenceEditResult,
	IBaseHalfReferenceEditService
} from '../common/basehalfReferenceEdit.js';
import { baseHalfUpstreamIdentity } from '../common/basehalfReferenceEntries.js';
import {
	BaseHalfReferenceIndexState,
	IBaseHalfIndexedDownstream,
	IBaseHalfReferenceIndexService,
	IBaseHalfUpstreamEntryView,
	IBaseHalfUpstreamIssue,
	IBaseHalfUpstreamView
} from '../common/basehalfReferenceIndex.js';
import { IBaseHalfReferenceRefactorService } from './basehalfReferenceRefactorService.js';

/** A node an upstream action works on. */
export interface IBaseHalfUpstreamActionNode extends IBaseHalfWorkspaceResource {
	readonly kind: 'file' | 'folder';
}

/** One node offered by the workspace-wide picker (`path` equals `relativePath`). */
export interface IBaseHalfUpstreamNodeCandidate extends IBaseHalfUpstreamPickerCandidate, IBaseHalfUpstreamActionNode {
	readonly description?: string;
}

/** The role picked for a connection into a `.bhnode` Draft with a recipe. */
export type BaseHalfUpstreamBindingChoice =
	| { readonly kind: 'proceed'; readonly binding?: IBaseHalfNodeUpstreamBindingRequest }
	| { readonly kind: 'cancel' };

export interface IBaseHalfUpstreamActionContext {
	/** Paths of the cards on the current canvas, in canvas order, for picker ordering. */
	readonly canvasCardPaths?: readonly string[];
	/**
	 * The resources the canvas undo element joins (the current `canvas.yaml`).
	 * Defaults to the `canvas.yaml` of the downstream node's parent folder.
	 */
	readonly undoResources?: readonly URI[];
	/** Asks for the input role when a connection enters a `.bhnode` Draft with a recipe. */
	readonly chooseBinding?: (target: IBaseHalfUpstreamActionNode, sourcePath: string) => Promise<BaseHalfUpstreamBindingChoice>;
	/** Called after an action wrote or was refused, and after each undo or redo of it. */
	readonly onDidChange?: () => void;
}

export type BaseHalfBadgeConnectionsFocusTarget = 'add-upstream' | 'add-downstream';

export interface IBaseHalfBadgeConnectionsOptions {
	readonly node: IBaseHalfUpstreamActionNode;
	/** The node's own Upstream list, or `undefined` when it could not be read. */
	readonly upstream: IBaseHalfUpstreamView | undefined;
	readonly downstream: readonly IBaseHalfIndexedDownstream[];
	readonly indexState: BaseHalfReferenceIndexState | undefined;
	readonly context: IBaseHalfUpstreamActionContext;
	readonly addListener: (disposable: IDisposable) => void;
	/** Navigates to a workspace-relative path. */
	readonly openNode: (relativePath: string) => void;
	/** Re-renders the editor after an action, moving focus to `focus`. */
	readonly refresh: (focus: BaseHalfBadgeConnectionsFocusTarget) => void;
	/** `.bhnode` only: the label of an input role. */
	readonly roleLabel?: (slot: string) => string;
}

export interface IBaseHalfBadgeConnectionsControls {
	readonly addUpstream?: HTMLButtonElement;
	readonly addDownstream?: HTMLButtonElement;
}

const PICKER_MAX_RESULTS = 20_000;
const NODE_CACHE_MS = 5_000;

type ActionPick = IQuickPickItem & { readonly run: () => Promise<unknown> };

/**
 * The upstream and downstream actions shared by the canvas card badge face,
 * the Card Detail badge zone, and **BaseHalf: Show Upstream Issues** (D37).
 * Every write goes through the reference edit service and is one canvas undo
 * step. UI copy says "upstream", "downstream", and "connection".
 */
export class BaseHalfUpstreamActions extends Disposable {
	private readonly nodeCache = new Map<string, { readonly at: number; readonly nodes: Promise<readonly IBaseHalfUpstreamNodeCandidate[]> }>();

	constructor(
		@IBaseHalfReferenceEditService private readonly referenceEditService: IBaseHalfReferenceEditService,
		@IBaseHalfReferenceIndexService private readonly referenceIndexService: IBaseHalfReferenceIndexService,
		@IBaseHalfReferenceRefactorService private readonly referenceRefactorService: IBaseHalfReferenceRefactorService,
		@IBaseHalfBadgeMirrorService private readonly badgeMirrorService: IBaseHalfBadgeMirrorService,
		@IBaseHalfCanvasMirrorService private readonly canvasMirrorService: IBaseHalfCanvasMirrorService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@INotificationService private readonly notificationService: INotificationService,
		@ISearchService private readonly searchService: ISearchService,
		@IFileService private readonly fileService: IFileService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IDialogService private readonly dialogService: IDialogService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this._register(this.fileService.onDidFilesChange(event => {
			if (event.gotAdded() || event.gotDeleted()) {
				this.nodeCache.clear();
			}
		}));
	}

	//#region Running operations

	/**
	 * Runs one reference operation and pushes its canvas undo step. Returns the
	 * result, or `undefined` when the operation was refused or failed (the user
	 * has been told why).
	 */
	async run(
		label: string,
		node: IBaseHalfWorkspaceResource,
		context: IBaseHalfUpstreamActionContext,
		operation: () => Promise<IBaseHalfReferenceEditResult>
	): Promise<IBaseHalfReferenceEditResult | undefined> {
		try {
			const result = await operation();
			this.pushUndo(result, label, node, context);
			return result;
		} catch (error) {
			if (error instanceof BaseHalfReferenceEditFailure) {
				// The service already told the user which files changed. Keep the
				// changed part undoable.
				this.pushUndo(error.result, label, node, context);
				return undefined;
			}
			this.reportError(error);
			return undefined;
		} finally {
			context.onDidChange?.();
		}
	}

	/** Pushes one canvas undo element for the stores a result changed. */
	pushUndo(result: IBaseHalfReferenceEditResult, label: string, node: IBaseHalfWorkspaceResource, context: IBaseHalfUpstreamActionContext): void {
		this.referenceEditService.pushUndoElement(result, {
			label,
			resources: context.undoResources ?? [this.parentCanvasResource(node)],
			source: BASEHALF_CANVAS_UNDO_REDO_SOURCE,
			onDidRun: () => context.onDidChange?.()
		});
	}

	/** Tells the user why a reference operation did not run. It never offers to
	 * open a file: users are not expected to read a file's source (D41). */
	reportError(error: unknown): void {
		if (error instanceof BaseHalfReferenceEditFailure) {
			return;
		}
		if (error instanceof BaseHalfReferenceEditRefusal) {
			this.notificationService.prompt(Severity.Warning, error.message, []);
			return;
		}
		this.logService.error(error instanceof Error ? error : String(error));
		this.notificationService.error(baseHalfUserFacingErrorMessage(error));
	}

	private parentCanvasResource(node: IBaseHalfWorkspaceResource): URI {
		const slash = node.relativePath.lastIndexOf('/');
		const parent = slash < 0 ? '' : node.relativePath.slice(0, slash);
		return this.canvasMirrorService.canvasResource({
			resource: parent ? URI.joinPath(node.workspaceFolder, ...parent.split('/')) : node.workspaceFolder,
			workspaceFolder: node.workspaceFolder,
			relativePath: parent,
			source: 'api'
		});
	}

	//#endregion

	//#region Actions

	/** **Add Upstream**: picks any node of the workspace folder and lists it in this node's store. */
	async addUpstream(node: IBaseHalfUpstreamActionNode, view: IBaseHalfUpstreamView | undefined, context: IBaseHalfUpstreamActionContext): Promise<boolean> {
		const excluded = this.keys(node, [node.relativePath, ...(view?.entries ?? []).flatMap(entry => entry.path !== undefined ? [entry.path] : [])]);
		const picked = await this.pickNode(node, {
			title: localize('basehalf.upstream.addUpstream.title', "Add upstream to {0}", basename(node.resource)),
			placeholder: localize('basehalf.upstream.addUpstream.placeholder', "Choose what flows into this card"),
			include: candidate => !excluded.has(this.key(node, candidate.path))
		}, context);
		if (!picked) {
			return false;
		}
		const binding = context.chooseBinding ? await context.chooseBinding(node, picked.path) : { kind: 'proceed' as const };
		if (binding.kind === 'cancel') {
			return false;
		}
		const label = localize('basehalf.upstream.addUpstream.undo', "Add upstream");
		return !!await this.run(label, node, context, () => this.referenceEditService.add(node, picked.path, { label }, binding.binding));
	}

	/** **Add Downstream**: picks a node that can be downstream and lists this node in its store. */
	async addDownstream(node: IBaseHalfUpstreamActionNode, downstream: readonly IBaseHalfIndexedDownstream[], context: IBaseHalfUpstreamActionContext): Promise<boolean> {
		const excluded = this.keys(node, [node.relativePath, ...downstream.map(entry => entry.node.relativePath)]);
		const picked = await this.pickNode(node, {
			title: localize('basehalf.upstream.addDownstream.title', "Add downstream of {0}", basename(node.resource)),
			placeholder: localize('basehalf.upstream.addDownstream.placeholder', "Choose a card this one flows into"),
			include: candidate => !excluded.has(this.key(node, candidate.path))
				&& !this.referenceIndexService.getUpstreamOnlyReason(candidate)
		}, context);
		if (!picked) {
			return false;
		}
		const binding = context.chooseBinding ? await context.chooseBinding(picked, node.relativePath) : { kind: 'proceed' as const };
		if (binding.kind === 'cancel') {
			return false;
		}
		const label = localize('basehalf.upstream.addDownstream.undo', "Add downstream");
		return !!await this.run(label, picked, context, () => this.referenceEditService.add(picked, node.relativePath, { label }, binding.binding));
	}

	/** × on a Downstream row: removes this node from the other node's store. */
	async removeDownstream(node: IBaseHalfWorkspaceResource, downstream: IBaseHalfWorkspaceResource, context: IBaseHalfUpstreamActionContext): Promise<boolean> {
		const label = localize('basehalf.upstream.removeDownstream.undo', "Remove downstream");
		return !!await this.run(label, downstream, context, () => this.referenceEditService.remove(downstream, node.relativePath, { label }));
	}

	/** × on an Upstream row and **Remove** on an issue row: removes the item at its position. */
	async removeEntry(node: IBaseHalfWorkspaceResource, entry: Pick<IBaseHalfUpstreamEntryView, 'index' | 'text'>, context: IBaseHalfUpstreamActionContext): Promise<boolean> {
		const label = localize('basehalf.upstream.remove.undo', "Remove upstream");
		return !!await this.run(label, node, context, () => this.referenceEditService.apply([{
			node,
			operation: { kind: 'removeAt', index: entry.index, expected: entry.text }
		}], { label }));
	}

	/** **Relink…**, **Relink to <path>**, and **Use <workspace path>**: replaces the item in place. */
	async relinkEntry(
		node: IBaseHalfUpstreamActionNode,
		view: IBaseHalfUpstreamView | undefined,
		entry: Pick<IBaseHalfUpstreamEntryView, 'index' | 'text'>,
		context: IBaseHalfUpstreamActionContext,
		to?: string
	): Promise<boolean> {
		let target = to;
		if (target === undefined) {
			const excluded = this.keys(node, [node.relativePath, ...(view?.entries ?? []).flatMap(candidate => candidate.path !== undefined ? [candidate.path] : [])]);
			const picked = await this.pickNode(node, {
				title: localize('basehalf.upstream.relink.title', "Relink {0}", entry.text),
				placeholder: localize('basehalf.upstream.relink.placeholder', "Choose the file or folder this entry should name"),
				include: candidate => !excluded.has(this.key(node, candidate.path))
			}, context);
			if (!picked) {
				return false;
			}
			target = picked.path;
		}
		const label = localize('basehalf.upstream.relink.undo', "Relink upstream");
		const next = target;
		return !!await this.run(label, node, context, () => this.referenceEditService.apply([{
			node,
			operation: { kind: 'replaceAt', index: entry.index, expected: entry.text, to: next }
		}], { label }));
	}

	/**
	 * **Relink Everywhere…**: picks the item a dangling path should name, then
	 * replaces that path in every store of the workspace folder that names it,
	 * including entries below it when it was a folder. The refactor service
	 * asks for confirmation, lists the stores it skips, and makes the change
	 * one canvas undo step.
	 */
	async relinkEverywhere(
		node: IBaseHalfUpstreamActionNode,
		entry: Pick<IBaseHalfUpstreamEntryView, 'path'>,
		context: IBaseHalfUpstreamActionContext
	): Promise<boolean> {
		const from = entry.path;
		if (from === undefined) {
			return false;
		}
		const fromKey = this.key(node, from);
		const picked = await this.pickNode(node, {
			title: localize('basehalf.upstream.relinkEverywhere.title', "Relink {0} everywhere", from),
			placeholder: localize('basehalf.upstream.relinkEverywhere.placeholder', "Choose the file or folder every entry for this path should name"),
			include: candidate => this.key(node, candidate.path) !== fromKey
		}, context);
		if (!picked) {
			return false;
		}
		try {
			return await this.referenceRefactorService.relinkEverywhere(node.workspaceFolder, from, picked.path, {
				undoResources: context.undoResources ?? [this.parentCanvasResource(node)],
				...(context.onDidChange ? { onDidChange: context.onDidChange } : {})
			});
		} catch (error) {
			this.reportError(error);
			return false;
		} finally {
			context.onDidChange?.();
		}
	}

	/**
	 * **Rebuild List**: after the user confirms, writes a list BaseHalf cannot
	 * use again in its own form, keeping the connections it can read. A
	 * Markdown list changes through its document and is undone there, so this
	 * pushes no canvas undo step.
	 */
	async rebuildList(node: IBaseHalfWorkspaceResource, context: IBaseHalfUpstreamActionContext, carriesOver = false): Promise<boolean> {
		const label = localize('basehalf.upstream.rebuildList', "Rebuild List");
		const { confirmed } = await this.dialogService.confirm({
			type: 'question',
			message: localize('basehalf.upstream.rebuildList.message', "Rebuild the upstream list of {0}?", basename(node.resource)),
			detail: carriesOver
				? localize('basehalf.upstream.rebuildList.carryOverDetail', "BaseHalf will keep the connections it can read from this note for you. The note itself is not changed.")
				: localize('basehalf.upstream.rebuildList.detail', "BaseHalf will write the list again in a form it can use. It keeps the connections it can read. Anything else in the list is removed."),
			primaryButton: label
		});
		if (!confirmed) {
			return false;
		}
		try {
			return (await this.referenceEditService.rebuild(node, { label })).changed;
		} catch (error) {
			this.reportError(error);
			return false;
		} finally {
			context.onDidChange?.();
		}
	}

	/** **Move into File**: moves a misplaced `upstream.yaml` into the node's own file. */
	async moveIntoFile(node: IBaseHalfWorkspaceResource, context: IBaseHalfUpstreamActionContext): Promise<boolean> {
		const label = localize('basehalf.upstream.moveIntoFile.undo', "Move upstream into file");
		return !!await this.run(label, node, context, () => this.referenceEditService.moveIntoFile(node, { label }));
	}

	/**
	 * The one node of the workspace folder whose file name equals a dangling
	 * entry's file name, for **Relink to <path>**.
	 */
	async findRelinkSuggestion(node: IBaseHalfUpstreamActionNode, view: IBaseHalfUpstreamView | undefined, entryPath: string): Promise<string | undefined> {
		const excluded = this.keys(node, [node.relativePath, ...(view?.entries ?? []).flatMap(entry => entry.status === 'valid' && entry.path !== undefined ? [entry.path] : [])]);
		const nodes = await this.listNodes(node.workspaceFolder);
		const match = baseHalfUniqueUpstreamNameMatch(entryPath, nodes);
		return match && !excluded.has(this.key(node, match.path)) ? match.path : undefined;
	}

	//#endregion

	//#region Picker

	private async pickNode(
		node: IBaseHalfUpstreamActionNode,
		options: { readonly title: string; readonly placeholder: string; readonly include: (candidate: IBaseHalfUpstreamNodeCandidate) => boolean },
		context: IBaseHalfUpstreamActionContext
	): Promise<IBaseHalfUpstreamNodeCandidate | undefined> {
		type NodePick = IQuickPickItem & { readonly candidate?: IBaseHalfUpstreamNodeCandidate };
		const items = this.listNodes(node.workspaceFolder).then(nodes => {
			const ordered = baseHalfOrderUpstreamPickerCandidates(nodes.filter(options.include), node.relativePath, context.canvasCardPaths ?? []);
			if (ordered.length === 0) {
				return [{ label: localize('basehalf.upstream.picker.empty', "Nothing else to choose in this workspace folder.") }] as NodePick[];
			}
			return ordered.map((candidate): NodePick => ({
				label: basename(candidate.resource),
				description: candidate.path,
				...(candidate.description ? { detail: candidate.description } : {}),
				candidate
			}));
		});
		const picked = await this.quickInputService.pick<NodePick>(items, {
			title: options.title,
			placeHolder: options.placeholder,
			matchOnDescription: true,
			matchOnDetail: false,
			sortByLabel: false
		});
		return picked?.candidate;
	}

	/**
	 * Every node the canvas could show in a workspace folder: files from file
	 * search (ignore files and exclude settings disregarded, symbolic links
	 * ignored) and the folders that contain them.
	 */
	listNodes(workspaceFolder: URI): Promise<readonly IBaseHalfUpstreamNodeCandidate[]> {
		const key = this.uriIdentityService.extUri.getComparisonKey(workspaceFolder);
		const cached = this.nodeCache.get(key);
		if (cached && Date.now() - cached.at < NODE_CACHE_MS) {
			return cached.nodes;
		}
		const nodes = this.searchNodes(workspaceFolder);
		this.nodeCache.set(key, { at: Date.now(), nodes });
		nodes.catch(() => this.nodeCache.delete(key));
		return nodes;
	}

	private async searchNodes(workspaceFolder: URI): Promise<readonly IBaseHalfUpstreamNodeCandidate[]> {
		const query: IFileQuery = {
			type: QueryType.File,
			_reason: 'basehalfUpstreamPicker',
			folderQueries: [{
				folder: workspaceFolder,
				disregardIgnoreFiles: true,
				disregardGlobalIgnoreFiles: true,
				disregardParentIgnoreFiles: true,
				ignoreSymlinks: true
			}],
			excludePattern: Object.fromEntries([...BASEHALF_CANVAS_SKIP_NAMES].map(name => [`**/${name}`, true])),
			maxResults: PICKER_MAX_RESULTS
		};
		const [complete, badges] = await Promise.all([
			this.searchService.fileSearch(query, CancellationToken.None),
			this.badgeMirrorService.listBadges(workspaceFolder).catch(error => {
				this.logService.warn('[BaseHalf] badge descriptions unavailable for the upstream picker', error);
				return undefined;
			})
		]);
		const byPath = new Map<string, IBaseHalfUpstreamNodeCandidate>();
		const add = (path: string, kind: 'file' | 'folder') => {
			if (byPath.has(path) || !isBaseHalfCanvasPathEligible(path, kind === 'folder')) {
				return;
			}
			const description = badges?.badges.get(path)?.description;
			byPath.set(path, {
				path,
				relativePath: path,
				kind,
				resource: URI.joinPath(workspaceFolder, ...path.split('/')),
				workspaceFolder,
				...(description ? { description } : {})
			});
		};
		for (const match of complete.results) {
			const path = getRelativePath(workspaceFolder, match.resource);
			if (!path || !isBaseHalfCanvasPathEligible(path, false)) {
				continue;
			}
			add(path, 'file');
			let parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
			while (parent) {
				add(parent, 'folder');
				parent = parent.includes('/') ? parent.slice(0, parent.lastIndexOf('/')) : '';
			}
		}
		return [...byPath.values()];
	}

	private key(node: IBaseHalfWorkspaceResource, path: string): string {
		return baseHalfUpstreamIdentity(node.workspaceFolder, this.uriIdentityService.extUri).key(path);
	}

	private keys(node: IBaseHalfWorkspaceResource, paths: readonly string[]): Set<string> {
		return new Set(paths.map(path => this.key(node, path)));
	}

	//#endregion

	//#region Badge editor sections

	/**
	 * Renders the Upstream and Downstream sections of the badge editor shared
	 * by the card flip face and the Card Detail badge zone.
	 */
	renderConnections(container: HTMLElement, options: IBaseHalfBadgeConnectionsOptions): IBaseHalfBadgeConnectionsControls {
		const { node, upstream: view, context } = options;
		const listen = <K extends keyof HTMLElementEventMap>(element: HTMLElement, type: K, handler: (event: HTMLElementEventMap[K]) => void) => {
			options.addListener(addDisposableListener(element, type, handler as (event: Event) => void));
		};
		const button = (parent: HTMLElement, className: string, label: string, run: () => Promise<unknown>, focus?: BaseHalfBadgeConnectionsFocusTarget): HTMLButtonElement => {
			const element = append(parent, $(`button.${className}`)) as HTMLButtonElement;
			element.type = 'button';
			element.textContent = label;
			listen(element, EventType.CLICK, event => {
				event.preventDefault();
				event.stopPropagation();
				if (element.disabled) {
					return;
				}
				element.disabled = true;
				element.setAttribute('aria-busy', 'true');
				void run().then(changed => {
					if (changed && focus) {
						options.refresh(focus);
					}
				}).catch(error => this.reportError(error)).finally(() => {
					element.disabled = false;
					element.removeAttribute('aria-busy');
				});
			});
			return element;
		};
		const upstreamOnly = view?.upstreamOnly;
		const readOnly = !!upstreamOnly;

		// Upstream: this node's own, editable list.
		const upstreamSection = append(container, $('.basehalf-canvas-card-badge-section.upstream'));
		upstreamSection.setAttribute('data-testid', 'badge-upstream');
		const upstreamTitle = append(upstreamSection, $('.basehalf-canvas-card-badge-section-title'));
		upstreamTitle.textContent = localize('basehalf.upstream.section.upstream', "Upstream");
		const helper = append(upstreamSection, $('.basehalf-canvas-card-badge-helper'));
		helper.textContent = readOnly
			? node.kind === 'folder'
				? localize('basehalf.upstream.readOnly.folder', "This folder can't receive upstream context.")
				: localize('basehalf.upstream.readOnly.file', "This file can't receive upstream context.")
			: view?.storeKind === 'sidecar'
				? `${localize('basehalf.upstream.helper.lead', "Context that flows into this card.")} ${node.kind === 'folder'
					? localize('basehalf.upstream.helper.sidecarFolder', "BaseHalf keeps this list for this folder.")
					: localize('basehalf.upstream.helper.sidecar', "BaseHalf keeps this list for this file.")}`
				: `${localize('basehalf.upstream.helper.lead', "Context that flows into this card.")} ${localize('basehalf.upstream.helper.file', "Saved inside this file, so agents reading it see it too.")}`;
		if (!view) {
			const unavailable = append(upstreamSection, $('.basehalf-canvas-card-badge-empty'));
			unavailable.textContent = localize('basehalf.upstream.unavailable', "The upstream list could not be read.");
		} else {
			if (view.storeIssue) {
				// The reason, with a repair inside BaseHalf when there is one.
				// The user is never sent to the file.
				const row = this.issueRow(upstreamSection, baseHalfUpstreamStoreProblemMessage(view.storeKind, view.problem, view.readError), 'store');
				if (!readOnly && baseHalfUpstreamStoreCanRebuild(view.storeKind, view.problem, view.readError)) {
					button(row, 'basehalf-canvas-card-badge-issue-action', localize('basehalf.upstream.rebuildList', "Rebuild List"), () => this.rebuildList(node, context, baseHalfUpstreamRebuildCarriesOver(view.storeKind, view.problem)), 'add-upstream')
						.setAttribute('data-testid', 'badge-upstream-rebuild');
				}
			}
			if (view.misplacedSidecar) {
				const row = this.issueRow(upstreamSection, localize('basehalf.upstream.misplacedSidecar', "An upstream list for this note is saved outside the note."), 'misplaced');
				if (!readOnly) {
					button(row, 'basehalf-canvas-card-badge-issue-action', localize('basehalf.upstream.moveIntoFile', "Move into File"), () => this.moveIntoFile(node, context), 'add-upstream');
				}
			}
			const list = append(upstreamSection, $('.basehalf-canvas-card-badge-list.upstream'));
			for (const entry of view.entries) {
				this.renderUpstreamEntry(list, entry, options, readOnly, button, listen);
			}
			if (view.entries.length === 0 && !view.storeIssue) {
				if (!readOnly) {
					const empty = append(upstreamSection, $('.basehalf-canvas-card-badge-empty'));
					empty.setAttribute('data-testid', 'badge-upstream-empty');
					empty.textContent = localize('basehalf.upstream.empty', "Nothing flows into this card yet. Add upstream, or drag a connection into it on the canvas.");
				}
			}
		}
		const addUpstream = readOnly ? undefined : button(
			upstreamSection,
			'basehalf-canvas-card-add-reference',
			localize('basehalf.upstream.addUpstream', "+ Add Upstream"),
			() => this.addUpstream(node, view, context),
			'add-upstream'
		);
		addUpstream?.setAttribute('data-testid', 'badge-add-upstream');

		// Downstream: derived; each × writes the other node's store.
		const downstreamSection = append(container, $('.basehalf-canvas-card-badge-section.downstream'));
		downstreamSection.setAttribute('data-testid', 'badge-downstream');
		const downstreamTitle = append(downstreamSection, $('.basehalf-canvas-card-badge-section-title'));
		downstreamTitle.textContent = localize('basehalf.upstream.section.downstream', "Downstream");
		if (options.indexState === 'building') {
			const loading = append(downstreamSection, $('.basehalf-canvas-card-badge-empty'));
			loading.textContent = localize('basehalf.upstream.downstream.loading', "Loading…");
		} else {
			if (options.downstream.length > 0) {
				const list = append(downstreamSection, $('.basehalf-canvas-card-badge-list.downstream'));
				for (const downstream of options.downstream) {
					const row = append(list, $('.basehalf-canvas-card-badge-row'));
					row.setAttribute('data-testid', 'badge-downstream-row');
					row.setAttribute('data-downstream-path', downstream.node.relativePath);
					const direction = append(row, $('span.basehalf-canvas-card-badge-direction.downstream'));
					direction.textContent = '↓';
					direction.setAttribute('aria-hidden', 'true');
					const link = append(row, $('button.basehalf-canvas-card-badge-link')) as HTMLButtonElement;
					link.type = 'button';
					link.textContent = basename(downstream.node.resource);
					link.title = downstream.node.relativePath;
					listen(link, EventType.CLICK, event => {
						event.preventDefault();
						event.stopPropagation();
						options.openNode(downstream.node.relativePath);
					});
					// A sealed or imported Result artifact keeps the bytes its node
					// pins: BaseHalf never removes entries from it.
					if (this.referenceIndexService.getUpstreamOnlyReason(downstream.node)) {
						continue;
					}
					const remove = append(row, $('button.basehalf-canvas-card-badge-remove.codicon.codicon-close')) as HTMLButtonElement;
					remove.type = 'button';
					remove.title = localize('basehalf.upstream.removeDownstream', "Remove from the upstream of {0}", downstream.node.relativePath);
					remove.setAttribute('aria-label', remove.title);
					listen(remove, EventType.CLICK, event => {
						event.preventDefault();
						event.stopPropagation();
						if (remove.disabled) {
							return;
						}
						remove.disabled = true;
						row.setAttribute('aria-busy', 'true');
						void this.removeDownstream(node, downstream.node, context).then(changed => {
							if (changed) {
								options.refresh('add-downstream');
							}
						}).finally(() => {
							remove.disabled = false;
							row.removeAttribute('aria-busy');
						});
					});
				}
			} else {
				const empty = append(downstreamSection, $('.basehalf-canvas-card-badge-empty'));
				empty.setAttribute('data-testid', 'badge-downstream-empty');
				empty.textContent = localize('basehalf.upstream.downstream.empty', "Nothing draws on this card yet.");
			}
			if (options.indexState === 'partial') {
				const note = append(downstreamSection, $('.basehalf-canvas-card-badge-helper'));
				note.textContent = localize('basehalf.upstream.downstream.partial', "Some files weren't scanned, so this list may be incomplete.");
			}
		}
		const addDownstream = button(
			downstreamSection,
			'basehalf-canvas-card-add-downstream',
			localize('basehalf.upstream.addDownstream', "+ Add Downstream"),
			() => this.addDownstream(node, options.downstream, context),
			'add-downstream'
		);
		addDownstream.setAttribute('data-testid', 'badge-add-downstream');
		return { ...(addUpstream ? { addUpstream } : {}), addDownstream };
	}

	private renderUpstreamEntry(
		list: HTMLElement,
		entry: IBaseHalfUpstreamEntryView,
		options: IBaseHalfBadgeConnectionsOptions,
		readOnly: boolean,
		button: (parent: HTMLElement, className: string, label: string, run: () => Promise<unknown>, focus?: BaseHalfBadgeConnectionsFocusTarget) => HTMLButtonElement,
		listen: <K extends keyof HTMLElementEventMap>(element: HTMLElement, type: K, handler: (event: HTMLElementEventMap[K]) => void) => void
	): void {
		const { node, upstream: view, context } = options;
		const bindingBlocked = view?.storeKind === 'node' && !!entry.binding && view.lifecycle !== 'draft';
		const row = append(list, $('.basehalf-canvas-card-badge-row'));
		row.setAttribute('data-testid', 'badge-upstream-row');
		row.setAttribute('data-upstream-status', entry.historical ? 'historical' : entry.status);
		row.setAttribute('data-upstream-index', String(entry.index));
		const direction = append(row, $('span.basehalf-canvas-card-badge-direction.upstream'));
		direction.textContent = '↑';
		direction.setAttribute('aria-hidden', 'true');
		if (entry.status === 'valid' && entry.target) {
			const target = entry.target;
			const link = append(row, $('button.basehalf-canvas-card-badge-link')) as HTMLButtonElement;
			link.type = 'button';
			link.textContent = basename(target.resource);
			link.title = target.relativePath;
			listen(link, EventType.CLICK, event => {
				event.preventDefault();
				event.stopPropagation();
				options.openNode(target.relativePath);
			});
		} else {
			row.classList.add(entry.historical ? 'historical' : 'upstream-issue');
			const text = append(row, $('span.basehalf-canvas-card-badge-entry-text'));
			text.textContent = entry.text || localize('basehalf.upstream.entry.emptyText', "(empty)");
			text.title = entry.text;
		}
		if (view?.storeKind === 'node') {
			const role = append(row, $('span.basehalf-canvas-card-badge-role'));
			role.textContent = entry.binding?.slot
				? options.roleLabel?.(entry.binding.slot) ?? entry.binding.slot
				: localize('basehalf.upstream.unassigned', "Unassigned");
		}
		if (entry.status === 'valid' && !readOnly) {
			const remove = append(row, $('button.basehalf-canvas-card-badge-remove.codicon.codicon-close')) as HTMLButtonElement;
			remove.type = 'button';
			remove.title = bindingBlocked
				? localize('basehalf.upstream.boundOutsideDraft', "This input is part of a result. Copy the settings into a new Draft to change it.")
				: localize('basehalf.upstream.removeUpstream', "Remove {0} from upstream", entry.target?.relativePath ?? entry.text);
			remove.setAttribute('aria-label', remove.title);
			remove.disabled = bindingBlocked;
			listen(remove, EventType.CLICK, event => {
				event.preventDefault();
				event.stopPropagation();
				if (remove.disabled) {
					return;
				}
				remove.disabled = true;
				row.setAttribute('aria-busy', 'true');
				void this.removeEntry(node, entry, context).then(changed => {
					if (changed) {
						options.refresh('add-upstream');
					}
				}).finally(() => {
					remove.disabled = bindingBlocked;
					row.removeAttribute('aria-busy');
				});
			});
			return;
		}
		if (entry.status === 'valid') {
			return;
		}
		const message = append(row, $('span.basehalf-canvas-card-badge-issue-message'));
		message.textContent = baseHalfUpstreamEntryMessage(entry);
		if (entry.historical) {
			return;
		}
		const actions = append(row, $('span.basehalf-canvas-card-badge-issue-actions'));
		if (entry.status === 'dangling' && entry.path !== undefined && !readOnly) {
			const entryPath = entry.path;
			const relinkTo = append(actions, $('span.basehalf-canvas-card-badge-relink-slot'));
			void this.findRelinkSuggestion(node, view, entryPath).then(suggestion => {
				if (!suggestion || !relinkTo.isConnected) {
					return;
				}
				const suggested = button(relinkTo, 'basehalf-canvas-card-badge-issue-action', localize('basehalf.upstream.relinkTo', "Relink to {0}", suggestion), () => this.relinkEntry(node, view, entry, context, suggestion), 'add-upstream');
				suggested.setAttribute('data-testid', 'badge-upstream-relink-to');
			}, error => this.logService.warn('[BaseHalf] could not look for a relink suggestion', error));
			button(actions, 'basehalf-canvas-card-badge-issue-action', localize('basehalf.upstream.relink', "Relink…"), () => this.relinkEntry(node, view, entry, context), 'add-upstream')
				.setAttribute('data-testid', 'badge-upstream-relink');
			button(actions, 'basehalf-canvas-card-badge-issue-action', localize('basehalf.upstream.relinkEverywhere', "Relink Everywhere…"), () => this.relinkEverywhere(node, entry, context), 'add-upstream')
				.setAttribute('data-testid', 'badge-upstream-relink-everywhere');
		}
		if (entry.status === 'invalid' && entry.workspacePath !== undefined && !readOnly) {
			const workspacePath = entry.workspacePath;
			button(actions, 'basehalf-canvas-card-badge-issue-action', localize('basehalf.upstream.useWorkspacePath', "Use {0}", workspacePath), () => this.relinkEntry(node, view, entry, context, workspacePath), 'add-upstream')
				.setAttribute('data-testid', 'badge-upstream-use-workspace-path');
		}
		if (!readOnly) {
			const remove = button(actions, 'basehalf-canvas-card-badge-issue-action.subtle', localize('basehalf.upstream.removeAction', "Remove"), () => this.removeEntry(node, entry, context), 'add-upstream');
			remove.setAttribute('data-testid', 'badge-upstream-remove');
			if (bindingBlocked) {
				remove.disabled = true;
				remove.title = localize('basehalf.upstream.boundOutsideDraft', "This input is part of a result. Copy the settings into a new Draft to change it.");
			}
		}
	}

	private issueRow(parent: HTMLElement, text: string, kind: string): HTMLElement {
		const row = append(parent, $('.basehalf-canvas-card-badge-issue-row.upstream-issue'));
		row.setAttribute('data-testid', 'badge-upstream-store-issue');
		row.setAttribute('data-upstream-issue', kind);
		const message = append(row, $('span.basehalf-canvas-card-badge-issue-message'));
		message.textContent = text;
		return row;
	}

	/** The toggle and collapsed-summary text for a node's connections. */
	summary(view: IBaseHalfUpstreamView | undefined, downstream: readonly IBaseHalfIndexedDownstream[], indexState: BaseHalfReferenceIndexState | undefined): string {
		return baseHalfCanvasConnectionSummary({
			upstream: view?.entries.filter(entry => entry.status === 'valid').length ?? 0,
			downstream: indexState === 'building' ? undefined : downstream.length,
			issues: view?.issueCount ?? 0,
			incomplete: indexState === 'partial'
		});
	}

	//#endregion

	//#region Show Upstream Issues

	/** **BaseHalf: Show Upstream Issues**: every issue in the workspace, grouped by file, with its actions. */
	async showIssues(context: IBaseHalfUpstreamActionContext = {}): Promise<void> {
		type IssuePick = IQuickPickItem & { readonly issue: IBaseHalfUpstreamIssue };
		const issues = await this.referenceIndexService.getIssues();
		if (issues.length === 0) {
			this.notificationService.info(localize('basehalf.upstream.issues.none', "No upstream issues in this workspace."));
			return;
		}
		const picks: (IssuePick | IQuickPickSeparator)[] = [];
		let currentFile: string | undefined;
		for (const issue of issues) {
			const file = issue.node.relativePath;
			if (file !== currentFile) {
				currentFile = file;
				picks.push({ type: 'separator', label: file });
			}
			picks.push({
				label: this.issueLabel(issue),
				description: this.issueDescription(issue),
				issue
			});
		}
		const picked = await this.quickInputService.pick<IssuePick>(picks, {
			title: localize('basehalf.upstream.issues.title', "Upstream Issues"),
			placeHolder: localize('basehalf.upstream.issues.placeholder', "Choose an issue to fix"),
			matchOnDescription: true,
			sortByLabel: false
		});
		if (!picked) {
			return;
		}
		const actions = await this.issueActions(picked.issue, context);
		if (actions.length === 0) {
			// Nothing in the product repairs this issue: say what it is.
			this.notificationService.info(`${this.issueLabel(picked.issue)}: ${this.issueDescription(picked.issue)}`);
			return;
		}
		const action = await this.quickInputService.pick<ActionPick>(actions, {
			title: this.issueLabel(picked.issue),
			placeHolder: this.issueDescription(picked.issue)
		});
		if (action) {
			await action.run();
		}
	}

	private issueLabel(issue: IBaseHalfUpstreamIssue): string {
		switch (issue.kind) {
			case 'entry': return issue.entry?.text || localize('basehalf.upstream.entry.emptyText', "(empty)");
			case 'misplacedSidecar': return localize('basehalf.upstream.issues.misplacedLabel', "Upstream list saved outside the note");
			default: return localize('basehalf.upstream.issues.storeLabel', "Upstream list");
		}
	}

	private issueDescription(issue: IBaseHalfUpstreamIssue): string {
		switch (issue.kind) {
			case 'entry': return issue.entry ? baseHalfUpstreamEntryMessage(issue.entry) : '';
			case 'misplacedSidecar': return localize('basehalf.upstream.misplacedSidecar', "An upstream list for this note is saved outside the note.");
			case 'readError': return baseHalfUpstreamStoreProblemMessage(issue.storeKind, undefined, issue.message ?? '');
			default: return baseHalfUpstreamStoreProblemMessage(issue.storeKind, issue.problem);
		}
	}

	private async issueActions(issue: IBaseHalfUpstreamIssue, context: IBaseHalfUpstreamActionContext): Promise<ActionPick[]> {
		const node = await this.actionNode(issue.node);
		const view = issue.kind === 'entry' ? await this.referenceIndexService.resolveUpstream(issue.node).catch(() => undefined) : undefined;
		const actions: ActionPick[] = [];
		const entry = issue.entry;
		// A node that can't be downstream (reserved outputs, sealed or imported
		// Result artifacts) is read-only: its issues offer no action.
		const readOnly = !!this.referenceIndexService.getUpstreamOnlyReason(issue.node);
		if (issue.kind === 'entry' && entry && !readOnly) {
			if (entry.status === 'dangling' && entry.path !== undefined) {
				const suggestion = await this.findRelinkSuggestion(node, view, entry.path).catch(() => undefined);
				if (suggestion) {
					actions.push({ label: localize('basehalf.upstream.relinkTo', "Relink to {0}", suggestion), run: () => this.relinkEntry(node, view, entry, context, suggestion) });
				}
				actions.push({ label: localize('basehalf.upstream.relink', "Relink…"), run: () => this.relinkEntry(node, view, entry, context) });
				actions.push({ label: localize('basehalf.upstream.relinkEverywhere', "Relink Everywhere…"), run: () => this.relinkEverywhere(node, entry, context) });
			}
			if (entry.status === 'invalid' && entry.workspacePath !== undefined) {
				const workspacePath = entry.workspacePath;
				actions.push({ label: localize('basehalf.upstream.useWorkspacePath', "Use {0}", workspacePath), run: () => this.relinkEntry(node, view, entry, context, workspacePath) });
			}
			actions.push({ label: localize('basehalf.upstream.removeAction', "Remove"), run: () => this.removeEntry(issue.node, entry, context) });
		}
		if (issue.kind === 'misplacedSidecar' && !readOnly) {
			actions.push({ label: localize('basehalf.upstream.moveIntoFile', "Move into File"), run: () => this.moveIntoFile(issue.node, context) });
		}
		if (issue.kind === 'store' && !readOnly && baseHalfUpstreamStoreCanRebuild(issue.storeKind, issue.problem)) {
			actions.push({ label: localize('basehalf.upstream.rebuildList', "Rebuild List"), run: () => this.rebuildList(issue.node, context, baseHalfUpstreamRebuildCarriesOver(issue.storeKind, issue.problem)) });
		}
		return actions;
	}

	private async actionNode(node: IBaseHalfWorkspaceResource): Promise<IBaseHalfUpstreamActionNode> {
		try {
			const stat = await this.fileService.stat(node.resource);
			return { ...node, kind: stat.isDirectory ? 'folder' : 'file' };
		} catch {
			return { ...node, kind: 'file' };
		}
	}

	//#endregion
}
