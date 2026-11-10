/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { posix } from '../../../../base/common/path.js';
import { basename, isEqualOrParent, relativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { QueryBuilder } from '../../../services/search/common/queryBuilder.js';
import { IBaseHalfCardDetailState } from '../../navigation/common/basehalfCanvasNavigation.js';
import { BaseHalfMarkdownRichWorkbenchCommand, IBaseHalfMarkdownRichFocusPoint } from '../../markdown/common/basehalfMarkdownRichWebviewProtocol.js';
import { baseHalfNoteFileFailure, baseHalfNoteStoresAbove } from '../../markdown/common/basehalfMarkdownAttachment.js';
import { baseHalfNoteLinkServices, openBaseHalfNoteLink } from '../../markdown/browser/basehalfNoteLinkRouter.js';
import { baseHalfDragHoldsFilesItems, baseHalfTransferFromDrop } from '../../clipboard/browser/basehalfTransfer.js';
import { getPathForFile } from '../../../../platform/dnd/browser/dnd.js';
import { baseHalfMarkdownPathHref } from '../../markdown/common/basehalfNoteMarkdownText.js';
import type { BaseHalfMarkdownRichCardDetail } from './basehalfMarkdownRichCardDetail.js';

/**
 * What the page of the Rich editor asks of the workbench, which a page cannot do itself: searching the
 * workspace's files, keeping a file that was put into the note, listing the items of a folder, taking a drop and
 * showing where it would go, the files of a copy, opening a resource, and running a command.
 *
 * A part of the Rich projection of Card Detail (`basehalfMarkdownRichCardDetail.ts`): it keeps its own state,
 * and reaches the projection's as `detail`.
 */
export class BaseHalfMarkdownRichRequests {
	/** Where a drag that the window holds is over the page, and the frame that tells the page. */
	private dragPoint: IBaseHalfMarkdownRichFocusPoint | undefined;
	private dragPointFrame: number | undefined;

	constructor(private readonly detail: BaseHalfMarkdownRichCardDetail) { }

	// Backs the rich editor's `[[` link autocomplete: resolves workspace files
	// for the typed query, with hrefs already relative to the document being
	// edited so the webview can write them straight into a Markdown link.
	async handleFileSearch(state: IBaseHalfCardDetailState, requestId: string, query: string): Promise<void> {
		try {
			const fileQuery = this.detail.instantiationService.createInstance(QueryBuilder).file([state.workspaceFolder], {
				filePattern: query,
				sortByScore: true,
				maxResults: 12
			});
			const result = await this.detail.searchService.fileSearch(fileQuery, CancellationToken.None);
			const documentDir = posix.dirname(posix.sep + state.relativePath);
			const files = result.results.flatMap(match => {
				const workspaceRelative = relativePath(state.workspaceFolder, match.resource);
				if (!workspaceRelative || workspaceRelative === state.relativePath) {
					return [];
				}
				return [{
					name: basename(match.resource),
					path: workspaceRelative,
					// The characters a path segment cannot hold in a link, encoded (note formats, rule 18).
					href: baseHalfMarkdownPathHref(posix.relative(documentDir, posix.sep + workspaceRelative))
				}];
			});
			await this.detail.bridge?.sendFileSearchResult(requestId, files);
		} catch (error) {
			this.detail.logService.error(error);
			await this.detail.bridge?.sendFileSearchResult(requestId, []);
		}
	}

	// A file put into the note goes into the note's own folder in the store
	// (files in notes, rules 12 and 13); a failure says why in plain words,
	// with no path under `.bh` (rule 49).
	async handleAttachmentUpload(state: IBaseHalfCardDetailState, requestId: string, name: string, mediaType: string, data: ArrayBuffer): Promise<void> {
		if (!this.detail.isEditable() || this.detail.structuralFrozen) {
			await this.detail.bridge?.sendAttachmentResult(requestId, { error: `Could not add ${name}: the note is read-only.` });
			return;
		}
		try {
			const stored = await this.detail.attachmentService.store(state.resource, this.detail.model?.getValue() ?? '', name, mediaType, data);
			await this.detail.bridge?.sendAttachmentResult(requestId, { url: stored.href, name: stored.name });
		} catch (error) {
			this.detail.logService.error('[BaseHalf] a file could not be put into the note', error);
			await this.detail.bridge?.sendAttachmentResult(requestId, { error: baseHalfNoteFileFailure(name, error) });
		}
	}

	/**
	 * Items that a paste or a drop brought with their paths go into the note
	 * as the input row of a draft takes them (files in notes, rules 12, 14,
	 * and 15): an item of the workspace is linked where it is, a file from
	 * elsewhere is cloned into the note's folder. A paste reads the
	 * clipboard's items; a drop, the items dragged from Files, or the paths of
	 * the files dragged from another app, all of them or none. With none, the
	 * page pastes or copies the files as it would.
	 */
	async handleItemsRequest(state: IBaseHalfCardDetailState, requestId: string, source: 'paste' | 'drop' | 'rebase', uris: readonly string[] | undefined, files: readonly File[] | undefined): Promise<void> {
		if (source === 'rebase') {
			// Blocks copied in another note keep working here (files in notes, rule 35).
			const resources = (uris ?? []).map(uri => URI.parse(uri));
			const rebased = this.detail.isEditable() && !this.detail.structuralFrozen ? await this.detail.attachmentService.rebase(state.resource, this.detail.model?.getValue() ?? '', resources) : undefined;
			await this.detail.bridge?.sendItemsResult(requestId, rebased ? { items: rebased.urls.map((url, index) => ({ kind: 'file', url, name: basename(resources[index]) || url })), failures: rebased.failures } : {});
			return;
		}
		let resources: URI[] = [];
		if (this.detail.isEditable() && !this.detail.structuralFrozen) {
			try {
				if (source === 'paste') {
					// A draft has no file to link; nothing is moved, also when the items were cut.
					resources = ((await this.detail.clipboardService.readItems())?.items ?? []).filter(item => !item.draft).map(item => item.resource);
				} else if (files) {
					const paths = files.map(file => getPathForFile(file));
					resources = paths.every(path => !!path) ? paths.map(path => URI.file(path!)) : [];
				} else {
					resources = (uris ?? []).map(uri => URI.parse(uri));
				}
			} catch (error) {
				this.detail.logService.error('[BaseHalf] the items of a paste or a drop could not be read', error);
			}
		}
		if (resources.length === 0) {
			await this.detail.bridge?.sendItemsResult(requestId, {});
			return;
		}
		const result = await this.detail.attachmentService.items(state.resource, this.detail.model?.getValue() ?? '', resources);
		await this.detail.bridge?.sendItemsResult(requestId, result);
	}

	/**
	 * A point of the window in the page's measure. The page's frame fills its
	 * element from the top left; the element can be scrolled a few pixels as
	 * focus moves in it, and the frame with it.
	 */
	pagePoint(clientX: number, clientY: number): IBaseHalfMarkdownRichFocusPoint {
		const box = this.detail.webviewHost.getBoundingClientRect();
		return { x: clientX - box.left + this.detail.webviewHost.scrollLeft, y: clientY - box.top + this.detail.webviewHost.scrollTop };
	}

	/** Tells the page where a drag the window holds is, once a frame, or that it is gone. */
	showDragPoint(point: IBaseHalfMarkdownRichFocusPoint | undefined): void {
		const shown = this.dragPoint;
		this.dragPoint = point;
		if (!point) {
			if (shown) {
				void this.detail.bridge?.sendDragPoint(undefined);
			}
			return;
		}
		if (shown && shown.x === point.x && shown.y === point.y || this.dragPointFrame !== undefined) {
			return;
		}
		this.dragPointFrame = mainWindow.requestAnimationFrame(() => {
			this.dragPointFrame = undefined;
			if (this.dragPoint) {
				void this.detail.bridge?.sendDragPoint(this.dragPoint);
			}
		});
	}

	/** Whether a drag over the page's element holds items of Files or files of another app, and the note takes them. */
	takesDrag(event: DragEvent): boolean {
		return (baseHalfDragHoldsFilesItems(event.dataTransfer) || [...event.dataTransfer?.types ?? []].some(type => type.toLowerCase() === 'files'))
			&& this.detail.isEditable() && !this.detail.structuralFrozen;
	}

	/**
	 * Items of Files and files of another app dropped on the note go in
	 * where they were let go; a picture with no file is first kept in the
	 * note's folder (files in notes, rules 12 to 15).
	 */
	async handleDrop(dataTransfer: DataTransfer, clientX: number, clientY: number): Promise<void> {
		const state = this.detail.state;
		const point = this.pagePoint(clientX, clientY);
		const transfer = await baseHalfTransferFromDrop(dataTransfer);
		if (!state || !transfer || transfer.kind === 'text') {
			return;
		}
		let uris: string[];
		if (transfer.kind === 'items') {
			uris = transfer.items.map(item => item.resource.toString());
		} else {
			const name = transfer.name ?? `image.${transfer.extension}`;
			const bytes = transfer.data.buffer;
			try {
				const stored = await this.detail.attachmentService.store(state.resource, this.detail.model?.getValue() ?? '', name, `image/${transfer.extension === 'jpg' ? 'jpeg' : transfer.extension}`, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
				uris = [stored.resource.toString()];
			} catch (error) {
				this.detail.logService.error('[BaseHalf] a dropped picture could not be put into the note', error);
				return;
			}
		}
		await this.detail.bridge?.sendDropItems(point, uris);
	}

	/**
	 * A link of the note opened from Rich, or a file block's file: what it goes
	 * to (note formats, rule 53). A heading of this note is shown in Rich.
	 */
	/**
	 * A copy of blocks that are all files puts the files themselves on the
	 * clipboard as well, for a file manager, the canvas, or another app
	 * (files in notes, rule 35): only files of the workspace folder or of a
	 * store above it, all of them or none.
	 */
	async handleCopiedFiles(state: IBaseHalfCardDetailState, uris: readonly string[], text: string, mark: string): Promise<void> {
		const places = [state.workspaceFolder, ...baseHalfNoteStoresAbove(state.workspaceFolder)];
		const resources = uris.map(uri => URI.parse(uri));
		if (resources.every(resource => resource.scheme === state.workspaceFolder.scheme && places.some(place => isEqualOrParent(resource, place)))) {
			await this.detail.clipboardService.addFiles(resources, text, mark);
		}
	}

	async handleOpenResource(state: IBaseHalfCardDetailState, href: string): Promise<void> {
		await this.detail.instantiationService.invokeFunction(accessor => openBaseHalfNoteLink(baseHalfNoteLinkServices(accessor), state.resource, href, heading => {
			void this.detail.bridge?.sendRevealHeading(heading);
		}));
	}

	async handleWorkbenchCommand(command: BaseHalfMarkdownRichWorkbenchCommand): Promise<void> {
		switch (command) {
			case 'quickOpen':
				await this.detail.commandService.executeCommand('workbench.action.quickOpen');
				break;
			case 'showCommands':
				await this.detail.commandService.executeCommand('workbench.action.showCommands');
				break;
		}
	}
}
