/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../base/common/buffer.js';
import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { localize } from '../../../nls.js';
import { FileOperationResult, IFileService, toFileOperationResult } from '../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IUriIdentityService } from '../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { BASEHALF_CANVAS_UNDO_REDO_SOURCE } from '../common/basehalfCanvasEditing.js';
import { IBaseHalfCanvasMirrorService } from '../common/basehalfCanvasMirror.js';
import { BASEHALF_CANVAS_GRID_COLUMN_GAP, baseHalfCanvasOpenPosition } from '../common/basehalfCanvasModel.js';
import { IBaseHalfCanvasFolderState, IBaseHalfWorkspaceResource } from '../common/basehalfCanvasNavigation.js';
import { baseHalfIsWorkspaceFolderMarked } from '../common/basehalfLegacyCleanup.js';
import {
	analyzeBaseHalfNodeUpstream,
	BASEHALF_NODE_DOCUMENT_EXTENSION,
	BASEHALF_NODE_DOCUMENT_MAX_BYTES,
	BASEHALF_NODE_TITLE_MAX_LENGTH,
	BaseHalfNodeJsonValue,
	baseHalfProjectPathProblem,
	createBaseHalfNodeDocument,
	getBaseHalfNodeVideoFields,
	IBaseHalfNodeDocument,
	parseBaseHalfNodeDocumentBytes,
	serializeBaseHalfNodeDocument,
	setBaseHalfNodeUpstream,
	withBaseHalfNodeVideoFields
} from '../common/basehalfNodeDocument.js';
import { BaseHalfReferenceEditFailure, BaseHalfReferenceEditRefusal, IBaseHalfReferenceEditResult, IBaseHalfReferenceEditService } from '../common/basehalfReferenceEdit.js';
import { baseHalfNormalizeUpstreamEntry, baseHalfUpstreamIdentity, IBaseHalfUpstreamIdentity } from '../common/basehalfReferenceEntries.js';
import { IBaseHalfReferenceIndexService } from '../common/basehalfReferenceIndex.js';
import { IBaseHalfVideoNodeSnapshot, IBaseHalfVideoNodeStore, IBaseHalfVideoResolvedInput } from '../common/basehalfVideoGeneration.js';
import { IBaseHalfVideoNodeFields } from '../common/basehalfVideoNode.js';
import { BaseHalfVideoInputKind, baseHalfVideoInputKindOfPath } from '../common/basehalfVideoCatalog.js';

/** How often a write is planned again when the file changed under it. */
const MAX_WRITE_ATTEMPTS = 8;
/** The size a Video node's card has when it appears (canvas card placement). */
const VIDEO_CARD_SIZE = Object.freeze({ width: 720, height: 405 });
/** The output tree at a workspace folder's root; references never point into it. */
const OUTPUTS_FOLDER = 'outputs';
const SIBLING_NUMBERS_TRIED = 1000;

interface IReadVideoNode {
	readonly node: IBaseHalfWorkspaceResource;
	readonly document: IBaseHalfNodeDocument;
	readonly bytes: VSBuffer;
}

/**
 * Reads and writes the video fields of `.bhnode` files (D58, D59). Every write is
 * an exact-content compare and swap through the reference edit service, the
 * same write path the canvas uses for `.bhnode` documents. A write that finds
 * the file changed reads it again and applies the change again. With an undo
 * label, a write is one step of the canvas undo stack.
 */
export class BaseHalfVideoNodeStore extends Disposable implements IBaseHalfVideoNodeStore {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidWrite = this._register(new Emitter<URI>());
	readonly onDidWrite = this._onDidWrite.event;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IBaseHalfReferenceEditService private readonly referenceEditService: IBaseHalfReferenceEditService,
		@IBaseHalfReferenceIndexService private readonly referenceIndexService: IBaseHalfReferenceIndexService,
		@IBaseHalfCanvasMirrorService private readonly canvasMirrorService: IBaseHalfCanvasMirrorService,
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	async read(resource: URI): Promise<IBaseHalfVideoNodeSnapshot> {
		const current = await this.readVideoNode(resource);
		return this.snapshot(current.node, current.document);
	}

	update(resource: URI, mutate: (fields: IBaseHalfVideoNodeFields) => IBaseHalfVideoNodeFields, options?: { readonly undoLabel?: string }): Promise<IBaseHalfVideoNodeSnapshot> {
		return this.transact(resource, document => withBaseHalfNodeVideoFields(document, mutate(getBaseHalfNodeVideoFields(document))), options?.undoLabel);
	}

	reorderUpstream(resource: URI, upstream: readonly string[]): Promise<IBaseHalfVideoNodeSnapshot> {
		return this.transact(resource, (document, node) => reorderedUpstream(document, upstream, node.relativePath, this.identity(node.workspaceFolder)),
			localize('basehalf.video.store.reorderInputs', "Reorder Video Inputs"));
	}

	async resolveInputs(snapshot: IBaseHalfVideoNodeSnapshot): Promise<readonly IBaseHalfVideoResolvedInput[]> {
		const workspaceFolder = this.workspaceFolderOf(snapshot.resource);
		return Promise.all(snapshot.upstream.map(path => this.resolveInput(workspaceFolder, path)));
	}

	async createSibling(resource: URI, fields: IBaseHalfVideoNodeFields, upstream: readonly string[]): Promise<URI> {
		const original = await this.readVideoNode(resource);
		const folder = this.parentFolder(original.node);
		const layout = await this.canvasMirrorService.readCanvas(folder).catch(error => {
			this.logService.warn(`[BaseHalf] could not read the layout of ${folder.relativePath || '/'} to place a new Video node`, error);
			return null;
		});
		// Numbered as the canvas numbers new files (`video-2`), from the name
		// without the number it already has: a sibling of `video-2` is `video-3`.
		const originalName = this.uriIdentityService.extUri.basename(resource).slice(0, -BASEHALF_NODE_DOCUMENT_EXTENSION.length);
		const numbered = /^(?<base>.+)-(?<number>[1-9]\d*)$/.exec(originalName)?.groups;
		const base = numbered?.base ?? originalName;
		const title = numbered && original.document.title.endsWith(` ${numbered.number}`)
			? original.document.title.slice(0, -(numbered.number.length + 1))
			: original.document.title;
		for (let number = 2; number < SIBLING_NUMBERS_TRIED; number++) {
			const name = `${base}-${number}${BASEHALF_NODE_DOCUMENT_EXTENSION}`;
			const relativePath = folder.relativePath ? `${folder.relativePath}/${name}` : name;
			const target = URI.joinPath(folder.resource, name);
			if (baseHalfProjectPathProblem(relativePath)
				|| await this.fileService.exists(target)
				|| layout?.cards.some(card => card.path === relativePath)) {
				continue;
			}
			const document = createBaseHalfNodeDocument({
				id: generateUuid(),
				kind: 'video',
				title: siblingTitle(title, number),
				upstream: [...upstream],
				prompt: fields.prompt ?? '',
				...(fields.generation !== undefined ? { generation: fields.generation } : {}),
				...(fields.task !== undefined ? { task: fields.task } : {}),
				...(fields.result !== undefined ? { result: fields.result } : {})
			});
			const text = serializeBaseHalfNodeDocument(document);
			try {
				// Nothing is there: `null` makes the write create the file only.
				await this.fileService.writeFileWithExpectedContents(target, VSBuffer.fromString(text), null, { atomic: { postfix: '.basehalf-node-create-tmp' } });
			} catch (error) {
				if (isConcurrentChange(error)) {
					// Another write took the name first.
					continue;
				}
				throw error;
			}
			const node: IBaseHalfWorkspaceResource = { resource: target, workspaceFolder: original.node.workspaceFolder, relativePath };
			// The connections show at once, not after the file event.
			this.referenceIndexService.acceptSavedContent(node, 'node', text);
			await this.placeBeside(folder, original.node.relativePath, relativePath, layout);
			this._onDidWrite.fire(target);
			return target;
		}
		throw new Error(localize('basehalf.video.store.siblingNames', "Too many nodes are named like {0}. Rename some of them and try again.", base));
	}

	videoTarget(snapshot: IBaseHalfVideoNodeSnapshot, taskId: string): URI {
		if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(taskId) || taskId.length > 128) {
			throw new Error(`The generation id '${taskId}' can't name a file.`);
		}
		return URI.joinPath(this.workspaceFolderOf(snapshot.resource), OUTPUTS_FOLDER, snapshot.id, `${taskId}.mp4`);
	}

	/**
	 * Reads the node, plans the next document from it, and writes it when it
	 * changed, with the bytes that were read as the expected content. A file
	 * that changed in between is read again and planned again.
	 */
	private async transact(
		resource: URI,
		plan: (document: IBaseHalfNodeDocument, node: IBaseHalfWorkspaceResource) => IBaseHalfNodeDocument,
		undoLabel: string | undefined
	): Promise<IBaseHalfVideoNodeSnapshot> {
		for (let attempt = 1; ; attempt++) {
			const current = await this.readVideoNode(resource);
			const next = plan(current.document, current.node);
			if (serializeBaseHalfNodeDocument(next) === serializeBaseHalfNodeDocument(current.document)) {
				return this.snapshot(current.node, current.document);
			}
			let result: IBaseHalfReferenceEditResult;
			try {
				result = await this.referenceEditService.apply([{
					node: current.node,
					operation: { kind: 'nodeDocument', expected: current.bytes, next }
				}], {
					label: undoLabel ?? localize('basehalf.video.store.write', "Update Video Node"),
					// The caller reports what went wrong; the edit service only logs it.
					automatic: true
				});
			} catch (error) {
				if (attempt < MAX_WRITE_ATTEMPTS && wroteNothingBecauseTheFileChanged(error)) {
					continue;
				}
				throw error instanceof BaseHalfReferenceEditFailure || error instanceof BaseHalfReferenceEditRefusal
					? new Error(error.message, { cause: error })
					: error;
			}
			if (undoLabel !== undefined) {
				this.referenceEditService.pushUndoElement(result, {
					label: undoLabel,
					resources: [this.canvasMirrorService.canvasResource(this.parentFolder(current.node))],
					source: BASEHALF_CANVAS_UNDO_REDO_SOURCE,
					code: 'basehalf.video.store'
				});
			}
			this._onDidWrite.fire(resource);
			return this.snapshot(current.node, next);
		}
	}

	private async readVideoNode(resource: URI): Promise<IReadVideoNode> {
		const workspaceFolder = this.workspaceFolderOf(resource);
		const relativePath = this.uriIdentityService.extUri.relativePath(workspaceFolder, resource);
		if (!relativePath || !relativePath.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION)) {
			throw new Error(localize('basehalf.video.store.notNode', "{0} is not a node in the open folder.", this.uriIdentityService.extUri.basename(resource)));
		}
		const bytes = (await this.fileService.readFile(resource, { atomic: true, limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES } })).value;
		const document = parseBaseHalfNodeDocumentBytes(bytes.buffer);
		if (document.kind !== 'video') {
			throw new Error(localize('basehalf.video.store.notVideo', "{0} is not a Video node.", relativePath));
		}
		return { node: { resource, workspaceFolder, relativePath }, document, bytes };
	}

	private snapshot(node: IBaseHalfWorkspaceResource, document: IBaseHalfNodeDocument): IBaseHalfVideoNodeSnapshot {
		const upstream = analyzeBaseHalfNodeUpstream(document, node.relativePath, this.identity(node.workspaceFolder))
			.flatMap(item => item.path !== undefined ? [item.path] : []);
		return Object.freeze({
			resource: node.resource,
			path: node.relativePath,
			id: document.id,
			title: document.title,
			upstream: Object.freeze(upstream),
			fields: getBaseHalfNodeVideoFields(document)
		});
	}

	/** An entry stands for the file it names, and a `.bhnode` for the file it shows. */
	private async resolveInput(workspaceFolder: URI, path: string): Promise<IBaseHalfVideoResolvedInput> {
		const resource = URI.joinPath(workspaceFolder, ...path.split('/'));
		let isDirectory: boolean;
		try {
			isDirectory = (await this.fileService.stat(resource)).isDirectory;
		} catch {
			return Object.freeze({ path, kind: baseHalfVideoInputKindOfPath(path), available: false });
		}
		if (isDirectory) {
			return Object.freeze({ path, kind: 'other', available: true });
		}
		if (!path.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION)) {
			return Object.freeze({ path, kind: baseHalfVideoInputKindOfPath(path), available: true, file: resource });
		}
		let document: IBaseHalfNodeDocument;
		try {
			document = parseBaseHalfNodeDocumentBytes((await this.fileService.readFile(resource, { limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES } })).value.buffer);
		} catch {
			return Object.freeze({ path, kind: 'other', available: false });
		}
		const artifact = document.result?.artifact;
		if (!artifact) {
			// A node that shows nothing yet keeps its kind, so the names of the
			// inputs after it stay the same when its file arrives.
			return Object.freeze({ path, kind: inputKindOfNode(document.kind), available: false });
		}
		const file = URI.joinPath(workspaceFolder, ...artifact.path.split('/'));
		const kind = baseHalfVideoInputKindOfPath(artifact.path);
		return await this.fileService.exists(file)
			? Object.freeze({ path, kind, available: true, file })
			: Object.freeze({ path, kind, available: false });
	}

	/**
	 * Puts the card of a new node 40 to the right of the card it was made from,
	 * at the nearest open place (canvas card placement, "Pointing" and "The
	 * nearest open place"). The user's Generate made the node, so the row is
	 * the user's, not a chosen row. Without a row of the original card, the new
	 * card appears at the end of the canvas like any other. A marked folder
	 * gets no row.
	 */
	private async placeBeside(folder: IBaseHalfCanvasFolderState, originalPath: string, path: string, layout: Awaited<ReturnType<IBaseHalfCanvasMirrorService['readCanvas']>>): Promise<void> {
		const original = layout?.cards.find(card => card.path === originalPath);
		if (!layout || !original) {
			return;
		}
		try {
			if (await baseHalfIsWorkspaceFolderMarked(this.fileService, folder.workspaceFolder)) {
				return;
			}
			const place = baseHalfCanvasOpenPosition(
				{ x: original.x + original.width + BASEHALF_CANVAS_GRID_COLUMN_GAP, y: original.y },
				VIDEO_CARD_SIZE,
				layout.cards.filter(card => card.path !== path)
			);
			await this.canvasMirrorService.updateCardGeometry(folder, { path, kind: 'file', x: place.x, y: place.y, ...VIDEO_CARD_SIZE });
		} catch (error) {
			// The node exists; its card appears at the end of the canvas instead.
			this.logService.warn(`[BaseHalf] could not place the card of ${path} beside ${originalPath}`, error);
		}
	}

	private parentFolder(node: IBaseHalfWorkspaceResource): IBaseHalfCanvasFolderState {
		const slash = node.relativePath.lastIndexOf('/');
		const relativePath = slash < 0 ? '' : node.relativePath.slice(0, slash);
		return {
			resource: relativePath ? URI.joinPath(node.workspaceFolder, ...relativePath.split('/')) : node.workspaceFolder,
			workspaceFolder: node.workspaceFolder,
			relativePath,
			source: 'api'
		};
	}

	private workspaceFolderOf(resource: URI): URI {
		const folder = this.workspaceContextService.getWorkspaceFolder(resource);
		if (!folder) {
			throw new Error(localize('basehalf.video.store.outsideWorkspace', "{0} is not in an open folder.", this.uriIdentityService.extUri.basename(resource)));
		}
		return folder.uri;
	}

	private identity(workspaceFolder: URI): IBaseHalfUpstreamIdentity {
		return baseHalfUpstreamIdentity(workspaceFolder, this.uriIdentityService.extUri);
	}
}

/**
 * The node's upstream list with its valid entries in the given order. Every
 * item that is not a valid entry keeps its place; the valid entries take the
 * places valid entries had. Refuses a list that is not the same entries.
 */
function reorderedUpstream(document: IBaseHalfNodeDocument, upstream: readonly string[], nodePath: string, identity: IBaseHalfUpstreamIdentity): IBaseHalfNodeDocument {
	const items = analyzeBaseHalfNodeUpstream(document, nodePath, identity).filter(item => item.path !== undefined);
	const byKey = new Map(items.map(item => [identity.key(item.path!), document.upstream[item.index]]));
	if (upstream.length !== items.length) {
		throw new Error(localize('basehalf.video.store.reorderChanged', "The inputs of {0} changed. Try again.", document.title));
	}
	const reordered: BaseHalfNodeJsonValue[] = [...document.upstream];
	upstream.forEach((entry, position) => {
		const key = identity.key(baseHalfNormalizeUpstreamEntry(entry));
		const item = byKey.get(key);
		if (item === undefined) {
			throw new Error(localize('basehalf.video.store.reorderChanged', "The inputs of {0} changed. Try again.", document.title));
		}
		byKey.delete(key);
		reordered[items[position].index] = item;
	});
	return setBaseHalfNodeUpstream(document, reordered);
}

function inputKindOfNode(kind: IBaseHalfNodeDocument['kind']): BaseHalfVideoInputKind {
	return kind === 'image' || kind === 'video' || kind === 'audio' ? kind : 'other';
}

/** `Shot 1` becomes `Shot 1 2`, within the title's length limit. */
function siblingTitle(title: string, number: number): string {
	const suffix = ` ${number}`;
	return `${title.slice(0, BASEHALF_NODE_TITLE_MAX_LENGTH - suffix.length).trimEnd()}${suffix}`;
}

function isConcurrentChange(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	const result = toFileOperationResult(error);
	return result === FileOperationResult.FILE_MODIFIED_SINCE || result === FileOperationResult.FILE_MOVE_CONFLICT;
}

/** The reference edit service wrote nothing because the file was no longer what was read. */
function wroteNothingBecauseTheFileChanged(error: unknown): boolean {
	if (error instanceof BaseHalfReferenceEditRefusal) {
		return error.reason === 'changedSinceEdit';
	}
	return error instanceof BaseHalfReferenceEditFailure && error.result.stores.every(store => store.outcome !== 'changed');
}

registerSingleton(IBaseHalfVideoNodeStore, BaseHalfVideoNodeStore, InstantiationType.Delayed);
