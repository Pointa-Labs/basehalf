/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { stableStringify } from '../../../../../base/common/objects.js';
import { basename, joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { FileOperationResult, IFileStat, toFileOperationResult } from '../../../../../platform/files/common/files.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import {
	baseHalfCanvasItemsSharePreviewVersion,
	baseHalfCanvasChildPath,
	BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT,
	BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH,
	IBaseHalfCanvasCard,
	IBaseHalfCanvasFile,
	IBaseHalfCanvasItem
} from '../../common/basehalfCanvasModel.js';
import { IBaseHalfCanvasFolderState } from '../../../navigation/common/basehalfCanvasNavigation.js';
import { baseHalfCanvasMarkdownPreviewSource, BASEHALF_CANVAS_NOTE_SHOWN_MAX_BYTES } from '../../common/basehalfCanvasPreview.js';
import { isBaseHalfMarkdownResource } from '../../../cardDetail/common/basehalfCardDetail.js';
import {
	BASEHALF_NODE_DOCUMENT_EXTENSION,
	BASEHALF_NODE_DOCUMENT_MAX_BYTES,
	BaseHalfNodeDocumentError,
	BaseHalfNodeKind,
	getBaseHalfNodeResultArtifact,
	IBaseHalfNodeDocument,
	parseBaseHalfNodeDocumentBytes
} from '../../../video/common/basehalfNodeDocument.js';
import { baseHalfCanvasContentKindForPath } from '../../common/basehalfCanvasContentKind.js';
import { BaseHalfCanvasCardPresentation } from '../../common/basehalfCanvasCardPresentation.js';
import { IBaseHalfCanvasPreviewHydrationBatch } from '../../common/basehalfCanvasPreviewHydration.js';
import { IBaseHalfCanvasSceneCard, IBaseHalfCanvasSceneCardPresentation, IBaseHalfCanvasSceneViewport } from '../../common/basehalfCanvasScene.js';
import { BaseHalfCanvasCardPreview, IBaseHalfCanvasMediaPreview } from '../../common/basehalfCanvasCardPreview.js';
import { IBaseHalfWorkspaceMutationStamp } from '../../../workspace/common/basehalfWorkspaceMutation.js';
import type { BaseHalfCanvasWorkbenchContribution } from '../basehalfCanvasWorkbench.contribution.js';
import { BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_HEIGHT, BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_WIDTH, CANVAS_MARKDOWN_FULL_EDITOR_LABEL, badgeType, baseHalfBadgeResourceIdentity, baseHalfReferenceLabel } from './basehalfCanvasViewShared.js';

/** An excerpt shows the first lines of a file, so only its head is read, whatever its size. */
const CARD_EXCERPT_READ_BYTES = 8192;

/** A node file is read to learn its kind before its card gets a place. A larger file keeps the default size. */
const BASEHALF_CANVAS_NEW_NODE_READ_LIMIT = 1024 * 1024;

const BASEHALF_CANVAS_NEW_NODE_KINDS_KEPT = 2000;

/**
 * The head of a text file. The head may end inside a character; streaming
 * leaves that character out instead of refusing the head.
 */
function decodeTextExcerpt(contents: VSBuffer): string | undefined {
	try {
		const raw = new TextDecoder('utf-8', { fatal: true }).decode(contents.buffer, { stream: true });
		return raw.includes('\u0000') ? undefined : raw;
	} catch {
		return undefined;
	}
}

function mediaPreview(name: string): { readonly kind: 'image' | 'video' | 'audio' | 'pdf'; readonly label: string } | undefined {
	const lower = name.toLowerCase();
	if (/\.(png|jpg|jpeg|gif|webp|svg|avif)$/.test(lower)) {
		return { kind: 'image', label: 'Image file' };
	}
	if (/\.pdf$/.test(lower)) {
		return { kind: 'pdf', label: 'PDF document' };
	}
	if (/\.(mp4|mov|webm|mkv)$/.test(lower)) {
		return { kind: 'video', label: 'Video file' };
	}
	if (/\.(mp3|wav|m4a|flac|ogg)$/.test(lower)) {
		return { kind: 'audio', label: 'Audio file' };
	}
	return undefined;
}

function mediaPreviewFromArtifact(kind: BaseHalfNodeKind, label: string): { readonly kind: 'image' | 'video' | 'audio' | 'pdf'; readonly label: string } | undefined {
	if (kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'pdf') {
		return { kind, label };
	}
	return undefined;
}

function markdownPreviewKind(name: string): 'markdown' | 'text' | 'code' {
	if (/\.(md|markdown|mdx)$/i.test(name)) {
		return 'markdown';
	}
	return badgeType(name, false) === 'code' ? 'code' : 'text';
}

function cleanCardPreviewText(name: string, raw: string): string {
	let text = raw.replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
	if (/\.mdx?$/i.test(name)) {
		text = text
			.replace(/```[\s\S]*?```/g, ' ')
			.replace(/^\s{0,3}#{1,6}\s+/gm, '')
			.replace(/^\s{0,3}>\s?/gm, '')
			.replace(/[*_`~]/g, '')
			.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
	}

	const lines = text
		.split('\n')
		.map(line => line.trim())
		.filter(Boolean)
		.slice(0, 8);
	const preview = lines.join('\n');
	return preview.length > 520 ? `${preview.slice(0, 517)}...` : preview;
}

/**
 * What each card shows of its item: reads previews, hydrates them in batches
 * after a drawing, and sizes the cards of new files and nodes.
 *
 * A part of the canvas view (README.md in this folder): it keeps its own state,
 * and reaches the state the view shares and the other parts through `view`.
 */
export class BaseHalfCanvasPreviews {
	private cardPreviewHydrationRunning = false;
	/** Whether a node file is a video node, by resource, for the version of the file that was read. */
	private readonly newNodeKinds = new Map<string, { readonly version: string; readonly video: boolean }>();

	constructor(private readonly view: BaseHalfCanvasWorkbenchContribution) { }

	scheduleOverscanCardPreviews(viewport: IBaseHalfCanvasSceneViewport): void {
		this.view.cardPreviewHydrationQueue.resetViewport();
		const width = this.view.cards.clientWidth / viewport.zoom;
		const height = this.view.cards.clientHeight / viewport.zoom;
		if (width <= 0 || height <= 0) {
			this.ensureCardPreviewHydrationScheduled();
			return;
		}
		const left = -viewport.x / viewport.zoom;
		const top = -viewport.y / viewport.zoom;
		const overscanX = width * 0.75;
		const overscanY = height * 0.75;
		const right = left + width;
		const bottom = top + height;
		for (const card of this.view.renderedSceneCards) {
			if (card.x + card.width < left - overscanX
				|| card.x > right + overscanX
				|| card.y + card.height < top - overscanY
				|| card.y > bottom + overscanY) {
				continue;
			}
			this.scheduleCardPreviewHydration(card.path);
		}
		this.ensureCardPreviewHydrationScheduled();
	}

	/**
	 * The sizes of the node cards that are about to appear and are not drawn at
	 * the default size. A video node is wider than a cell, and the place of a
	 * card depends on its size. A file that cannot be read keeps the default.
	 */
	async sizesOfNewNodeCards(
		folder: IBaseHalfCanvasFolderState,
		stat: IFileStat,
		canvas: IBaseHalfCanvasFile | null,
		waiting: ReadonlyMap<string, IBaseHalfCanvasCard> | undefined
	): Promise<Map<string, { readonly width: number; readonly height: number }>> {
		const sizes = new Map<string, { readonly width: number; readonly height: number }>();
		const placed = new Set((canvas?.cards ?? []).map(card => card.path));
		await Promise.all((stat.children ?? []).map(async child => {
			const name = basename(child.resource);
			const path = baseHalfCanvasChildPath(folder.relativePath, name);
			if (child.isDirectory || !name.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION) || placed.has(path) || waiting?.has(path)) {
				return;
			}
			if (await this.isVideoNodeFile(child.resource, `${child.mtime ?? ''}:${child.size ?? ''}`)) {
				sizes.set(path, { width: BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_WIDTH, height: BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_HEIGHT });
			}
		}));
		return sizes;
	}

	/** The size at which the card of a new file is drawn: a video node is larger than other files. */
	async sizeOfNewFileCard(resource: URI): Promise<{ readonly width: number; readonly height: number }> {
		return basename(resource).toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION) && await this.isVideoNodeFile(resource)
			? { width: BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_WIDTH, height: BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_HEIGHT }
			: { width: BASEHALF_CANVAS_DEFAULT_FILE_CARD_WIDTH, height: BASEHALF_CANVAS_DEFAULT_FILE_CARD_HEIGHT };
	}

	/**
	 * Whether a node file is a video node. With a `version` of the file the
	 * answer is kept, so that a node file that never gets a card, beyond what a
	 * canvas shows, is not read again at every drawing. A file that cannot be
	 * read as a node is not one.
	 */
	private async isVideoNodeFile(resource: URI, version?: string): Promise<boolean> {
		const key = resource.toString();
		const known = version === undefined ? undefined : this.newNodeKinds.get(key);
		if (known && known.version === version) {
			return known.video;
		}
		let video = false;
		try {
			const content = await this.view.fileService.readFile(resource, { limits: { size: BASEHALF_CANVAS_NEW_NODE_READ_LIMIT } });
			video = parseBaseHalfNodeDocumentBytes(content.value.buffer).kind === 'video';
		} catch {
			// Not a node BaseHalf can read: its card is drawn at the default size.
		}
		if (version !== undefined) {
			if (this.newNodeKinds.size >= BASEHALF_CANVAS_NEW_NODE_KINDS_KEPT) {
				this.newNodeKinds.clear();
			}
			this.newNodeKinds.set(key, { version, video });
		}
		return video;
	}

	private async readCardPreview(
		item: IBaseHalfCanvasItem,
		verifyNodeState: boolean
	): Promise<BaseHalfCanvasCardPreview> {
		if (item.kind === 'folder') {
			let stat: IFileStat;
			try {
				stat = item.stat.children ? item.stat : await this.view.fileService.resolve(item.stat.resource);
			} catch {
				// External file operations can invalidate a render snapshot between
				// enumeration and preview resolution. The next file event rerenders the
				// canvas without the removed card; avoid surfacing that expected race.
				return { kind: 'unavailable', text: 'Preview unavailable' };
			}
			const children = (stat.children ?? [])
				.filter(child => child.isDirectory || child.isFile)
				.sort((a, b) => {
					if (a.isDirectory !== b.isDirectory) {
						return a.isDirectory ? -1 : 1;
					}
					return basename(a.resource).localeCompare(basename(b.resource));
				});
			return {
				kind: 'folder',
				total: children.length,
				items: children.slice(0, 6).map(child => ({
					name: basename(child.resource),
					kind: child.isDirectory ? 'folder' : 'file'
				}))
			};
		}

		if (item.name.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION)) {
			try {
				const raw = (await this.view.fileService.readFile(item.stat.resource, {
					limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES }
				})).value.buffer;
				const document = parseBaseHalfNodeDocumentBytes(raw);
				const folder = this.view.getCurrentFolder();
				const artifact = getBaseHalfNodeResultArtifact(document);
				const previousPreview = this.view.renderedCardPreviewsByPath.get(item.path)?.preview;
				const previousArtifact = previousPreview?.kind === 'node'
					? getBaseHalfNodeResultArtifact(previousPreview.document)
					: undefined;
				const retainsVerifiedResultPreview = !verifyNodeState
					&& previousPreview?.kind === 'node'
					&& previousPreview.verificationPending !== true
					&& artifact !== undefined
					&& previousArtifact !== undefined
					&& stableStringify(artifact) === stableStringify(previousArtifact);
				// A corrected node stat or another unrelated render must not demote the
				// same result to a verification-pending face. Fresh hydration still
				// follows and replaces this retained result if its file went missing.
				const resultPreview = retainsVerifiedResultPreview
					? {
						...(previousPreview.resultMedia ? { resultMedia: previousPreview.resultMedia } : {}),
						...(previousPreview.resultOutputText ? { resultOutputText: previousPreview.resultOutputText } : {}),
						...(previousPreview.resultMissing ? { resultMissing: true as const } : {})
					}
					: folder ? await this.readNodeResultPreview(folder, document, verifyNodeState) : {};
				return {
					kind: 'node',
					document,
					...(verifyNodeState || retainsVerifiedResultPreview ? {} : { verificationPending: true }),
					dirty: this.view.workingCopyService.isDirty(item.stat.resource),
					...resultPreview
				};
			} catch (error) {
				// A node BaseHalf cannot read, a version 4 node among them, shows
				// that it is unreadable; nothing reads it as something else (D58).
				const reason = !(error instanceof BaseHalfNodeDocumentError)
					? localize('basehalf.canvas.node.unreadableReason', "The node could not be read.")
					: error.earlierVersion !== undefined
						? localize('basehalf.canvas.node.earlierVersion', "An earlier BaseHalf saved this node in a form this version no longer reads.")
						: error.message;
				return {
					kind: 'invalidNode',
					text: reason.slice(0, 240)
				};
			}
		}

		const media = mediaPreview(item.name);
		if (media) {
			const resource = media.kind === 'pdf' ? item.stat.resource : item.stat.resource.with({
				query: `basehalfCanvasVersion=${item.stat.mtime ?? 0}-${item.stat.size ?? 0}`
			});
			return { kind: 'media', text: media.label, mediaKind: media.kind, resource };
		}

		const kind = markdownPreviewKind(item.name);
		if (kind === 'markdown' && item.stat.size !== undefined && item.stat.size > BASEHALF_CANVAS_NOTE_SHOWN_MAX_BYTES) {
			return { kind: 'richRequired', text: CANVAS_MARKDOWN_FULL_EDITOR_LABEL };
		}
		try {
			// A note is all or nothing: an oversized Markdown file requires the
			// full editor; no partial source may masquerade as the stored projection.
			// The excerpt of any other text needs only the head of the file.
			const contents = await this.view.fileService.readFile(item.stat.resource, kind === 'markdown'
				? { limits: { size: BASEHALF_CANVAS_NOTE_SHOWN_MAX_BYTES } }
				: { length: CARD_EXCERPT_READ_BYTES });
			const raw = contents.value.toString();
			if (raw.includes('\u0000')) {
				return { kind: 'unavailable', text: 'Binary file' };
			}

			const text = kind === 'markdown' ? baseHalfCanvasMarkdownPreviewSource(raw) : cleanCardPreviewText(item.name, raw);
			if (kind === 'markdown') {
				return { kind, text };
			}
			return text ? { kind, text } : { kind: 'empty', text: 'Empty file' };
		} catch (error) {
			if (kind === 'markdown' && error instanceof Error && toFileOperationResult(error) === FileOperationResult.FILE_TOO_LARGE) {
				return { kind: 'richRequired', text: CANVAS_MARKDOWN_FULL_EDITOR_LABEL };
			}
			return { kind: 'unavailable', text: 'Preview unavailable' };
		}
	}

	scheduleCardPreviewHydration(path: string, priority = 1): void {
		const current = this.view.renderedCardPreviewsByPath.get(path)?.preview;
		const resultNode = this.view.renderedItemsByPath.get(path)?.name.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION) === true;
		if (current?.kind !== 'loading' && current?.kind !== 'nodeLoading' && !resultNode) {
			this.view.cardPreviewHydrationQueue.delete(path);
			return;
		}
		this.view.cardPreviewHydrationQueue.enqueue(path, priority === 2 ? 2 : 1);
		this.ensureCardPreviewHydrationScheduled();
	}

	updateCardPreviewHydrationPresentation(path: string, presentation: BaseHalfCanvasCardPresentation, sceneKey: string): void {
		if (!this.view.isCurrentSceneKey(sceneKey)) {
			return;
		}
		const current = this.view.renderedCardPreviewsByPath.get(path)?.preview;
		if (current?.kind !== 'loading' && current?.kind !== 'nodeLoading') {
			if (this.view.renderedItemsByPath.get(path)?.name.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION) !== true) {
				this.view.cardPreviewHydrationQueue.delete(path);
			}
			return;
		}
		// A newly created Note can enter its editing projection before the first
		// complete Markdown preview exists. React Flow deliberately presents an
		// editing Note at `preview` level, but its hydration is still interactive
		// work: a trailing viewport reset must not discard the only path that can
		// mount the inline editor.
		if (this.view.canvasNoteSurfacePath === path) {
			this.view.cardPreviewHydrationQueue.enqueue(path, 2);
		} else {
			this.view.cardPreviewHydrationQueue.setPresentation(path, presentation);
		}
		this.ensureCardPreviewHydrationScheduled();
	}

	private ensureCardPreviewHydrationScheduled(): void {
		this.view.cardPreviewHydrationQueue.prune(path => {
			const preview = this.view.renderedCardPreviewsByPath.get(path)?.preview;
			return preview?.kind === 'loading'
				|| preview?.kind === 'nodeLoading'
				|| this.view.renderedItemsByPath.get(path)?.name.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION) === true;
		});
		if (this.view.cardPreviewHydrationQueue.size === 0
			|| this.cardPreviewHydrationRunning
			|| this.view.cardPreviewHydrationTimer !== undefined
			|| this.view.disposed) {
			return;
		}
		this.view.cardPreviewHydrationTimer = mainWindow.setTimeout(() => {
			this.view.cardPreviewHydrationTimer = undefined;
			void this.drainCardPreviewHydration();
		}, 0);
	}

	private async drainCardPreviewHydration(): Promise<void> {
		if (this.cardPreviewHydrationRunning || this.view.disposed) {
			return;
		}
		this.cardPreviewHydrationRunning = true;
		try {
			while (!this.view.disposed && this.view.cardPreviewHydrationQueue.size > 0) {
				const folder = this.view.getCurrentFolder();
				if (!folder || this.view.canvasNavigationService.state.cardDetail) {
					this.view.cardPreviewHydrationQueue.clear();
					return;
				}
				const seq = this.view.renderSeq;
				const sceneKey = this.view.sceneKey(folder);
				const structuralStamp = this.view.workspaceMutationCoordinator.capture(folder.workspaceFolder);
				const batch = this.view.cardPreviewHydrationQueue.take(4, path =>
					this.view.renderedItemsByPath.get(path)?.name.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION) ? 1 : 0
				);
				if (!batch) {
					return;
				}
				if (batch.sceneKey !== sceneKey || !this.view.cardPreviewHydrationQueue.isCurrent(batch)) {
					return;
				}
				const items = batch.paths.flatMap(path => {
					const item = this.view.renderedItemsByPath.get(path);
					const preview = this.view.renderedCardPreviewsByPath.get(path)?.preview;
					return item && (preview?.kind === 'loading'
						|| preview?.kind === 'nodeLoading'
						|| item.name.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION)) ? [item] : [];
				});
				if (items.length === 0) {
					continue;
				}
				await this.hydrateCardPreviews(folder, items, structuralStamp, seq, batch);
				if (!this.view.renderer.isRenderCurrent(seq)
					|| !this.view.isCurrentSceneKey(sceneKey)
					|| !this.view.cardPreviewHydrationQueue.isCurrent(batch)) {
					return;
				}
			}
		} catch (error) {
			if (!this.view.disposed) {
				this.view.logService.warn(error);
			}
		} finally {
			this.cardPreviewHydrationRunning = false;
			this.ensureCardPreviewHydrationScheduled();
		}
	}

	private async hydrateCardPreviews(
		folder: IBaseHalfCanvasFolderState,
		items: readonly IBaseHalfCanvasItem[],
		structuralStamp: IBaseHalfWorkspaceMutationStamp,
		seq: number,
		batch: IBaseHalfCanvasPreviewHydrationBatch
	): Promise<void> {
		// New nodes get a verification-pending face first. A node with a complete
		// cached face keeps that face until fresh verification completes, so its
		// media element is never downgraded to a loading or verification-pending
		// frame during unrelated canvas work.
		const initialItems = items.filter(item => {
			const preview = this.view.renderedCardPreviewsByPath.get(item.path)?.preview;
			return preview?.kind === 'loading' || preview?.kind === 'nodeLoading';
		});
		if (initialItems.length > 0
			&& !await this.hydrateCardPreviewItems(folder, initialItems, false, structuralStamp, seq, batch)) {
			return;
		}

		const resultNodes = items.filter(item => item.name.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION));
		if (resultNodes.length === 0) {
			return;
		}

		void this.view.cardPreviewVerificationQueue.enqueue(async isCurrent => {
			if (!isCurrent()
				|| !this.view.renderer.isRenderCurrent(seq)
				|| !this.view.isCurrentSceneKey(batch.sceneKey)
				|| !this.view.cardPreviewHydrationQueue.isCurrent(batch)) {
				return;
			}
			await this.hydrateCardPreviewItems(folder, resultNodes, true, structuralStamp, seq, batch, isCurrent);
		}, error => {
			if (!this.view.disposed) {
				this.view.logService.warn(error instanceof Error ? error.message : String(error));
			}
		});
	}

	private async hydrateCardPreviewItems(
		folder: IBaseHalfCanvasFolderState,
		items: readonly IBaseHalfCanvasItem[],
		verifyNodeState: boolean,
		structuralStamp: IBaseHalfWorkspaceMutationStamp,
		seq: number,
		hydrationBatch: IBaseHalfCanvasPreviewHydrationBatch,
		isStageCurrent: () => boolean = () => true
	): Promise<boolean> {
		const batchSize = 4;
		for (let start = 0; start < items.length; start += batchSize) {
			if (!isStageCurrent()
				|| !this.view.renderer.isRenderCurrent(seq)
				|| !this.view.isCurrentSceneKey(hydrationBatch.sceneKey)
				|| !this.view.cardPreviewHydrationQueue.isCurrent(hydrationBatch)) {
				return false;
			}
			const batch = items.slice(start, start + batchSize);
			const hydrated = await Promise.all(batch.map(async item => {
				try {
					const before = await this.view.fileService.stat(item.stat.resource);
					const versionedItem: IBaseHalfCanvasItem = {
						...item,
						stat: { ...item.stat, ...before, children: item.stat.children }
					};
					const preview = await this.readCardPreview(versionedItem, verifyNodeState);
					const after = await this.view.fileService.stat(item.stat.resource);
					if (before.etag !== after.etag
						|| before.size !== after.size
						|| before.isFile !== after.isFile
						|| before.isDirectory !== after.isDirectory
						|| before.isSymbolicLink !== after.isSymbolicLink) {
						return { item };
					}
					return { item, preview };
				} catch {
					return { item };
				}
			}));
			if (!isStageCurrent()
				|| !this.view.renderer.isRenderCurrent(seq)
				|| !this.view.isCurrentSceneKey(hydrationBatch.sceneKey)
				|| !this.view.cardPreviewHydrationQueue.isCurrent(hydrationBatch)
				|| !this.view.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, structuralStamp)) {
				return false;
			}
			while (this.view.canvasScene.isInteracting()) {
				await this.view.renderer.waitForCanvasSceneInteractionEnd();
				if (!isStageCurrent()
					|| !this.view.renderer.isRenderCurrent(seq)
					|| !this.view.isCurrentSceneKey(hydrationBatch.sceneKey)
					|| !this.view.cardPreviewHydrationQueue.isCurrent(hydrationBatch)
					|| !this.view.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, structuralStamp)) {
					return false;
				}
			}
			if (this.view.badgeInteractionRenderGate.defer()) {
				return false;
			}

			const replacements = new Map<string, IBaseHalfCanvasSceneCard>();
			for (const { item, preview } of hydrated) {
				const currentItem = this.view.renderedItemsByPath.get(item.path);
				if (!preview || !currentItem || !baseHalfCanvasItemsSharePreviewVersion(item, currentItem)) {
					continue;
				}
				const currentCard = this.view.renderedSceneCards.find(card => card.path === item.path);
				if (!currentCard) {
					continue;
				}
				this.view.renderedCardPreviewsByPath.set(item.path, { item: currentItem, preview });
				if (this.view.activeCanvasNoteEditor?.path === currentItem.path) {
					continue;
				}
				const badge = this.view.badgeEditor.badgeMetadataWithDraft(
					folder.workspaceFolder,
					currentItem.path,
					currentItem.badge,
					baseHalfBadgeResourceIdentity(currentItem.stat)
				);
				const displayedItem = badge === currentItem.badge ? currentItem : { ...currentItem, badge };
				const visualKey = this.view.renderer.cardVisualKey(displayedItem);
				const cached = this.view.renderedCardsByPath.get(currentItem.path);
				const element = this.view.renderer.canReuseRenderedCard(cached, displayedItem, preview, visualKey, hydrationBatch.sceneKey)
					|| this.view.renderer.retainVideoNodeCard(cached, displayedItem, preview, visualKey, hydrationBatch.sceneKey)
					? cached.element
					: this.view.cardRenderer.createCard(displayedItem, currentCard, preview, hydrationBatch.sceneKey);
				this.view.cardRenderer.applyNoteBackground(element, isBaseHalfMarkdownResource(currentItem.stat.resource) ? this.view.renderedNoteBackgrounds.get(currentItem.path) ?? 'default' : undefined);
				this.view.renderedCardsByPath.set(currentItem.path, {
					item: currentItem,
					preview,
					visualKey,
					sceneKey: hydrationBatch.sceneKey,
					element
				});
				const controls = this.view.cardRenderer.sceneCardControls(displayedItem, preview);
				replacements.set(currentItem.path, {
					...currentCard,
					controls,
					element,
					updatePresentation: (presentation: IBaseHalfCanvasSceneCardPresentation) => this.view.cardPresentationUpdaters.get(element)?.(presentation),
					didMountElement: () => this.view.cardRenderer.didMountCardElement(currentItem.path, element),
					...(this.view.openBadgeFaces.has(currentItem.path) || this.view.canvasNoteSurfacePath === currentItem.path ? { forceInteractive: true as const } : {}),
					...(this.view.canvasNoteSurfacePath === currentItem.path ? { noteEditing: true as const } : {})
				});
			}
			if (replacements.size === 0) {
				continue;
			}
			this.view.renderedSceneCards = Object.freeze(this.view.renderedSceneCards.map(card => replacements.get(card.path) ?? card));
			this.view.canvasScene.update({
				key: hydrationBatch.sceneKey,
				structuralEpoch: structuralStamp.structuralEpoch,
				revision: seq,
				cards: this.view.renderedSceneCards,
				edges: this.view.renderedSceneEdges
			});
		}
		return true;
	}

	/** What a node's card shows of the file the node shows, and whether that file is there. */
	private async readNodeResultPreview(folder: IBaseHalfCanvasFolderState, document: IBaseHalfNodeDocument, verifyIntegrity: boolean): Promise<{
		readonly resultMedia?: IBaseHalfCanvasMediaPreview;
		readonly resultOutputText?: string;
		readonly resultMissing?: true;
	}> {
		const artifact = getBaseHalfNodeResultArtifact(document);
		if (!artifact || !verifyIntegrity) {
			return {};
		}
		const outputPath = artifact.path;
		const resource = joinPath(folder.workspaceFolder, ...outputPath.split('/'));
		let stat: IFileStat;
		try {
			stat = await this.view.fileService.resolve(resource, { resolveMetadata: true });
		} catch {
			return { resultMissing: true };
		}
		if (stat.isDirectory) {
			return { resultMissing: true };
		}
		const media = mediaPreviewFromArtifact(document.kind, baseHalfReferenceLabel(outputPath));
		if (media) {
			const resolvedResource = media.kind === 'pdf'
				? resource
				: resource.with({ query: `basehalfCanvasVersion=${stat.mtime ?? 0}-${stat.size ?? 0}` });
			return { resultMedia: { text: media.label, mediaKind: media.kind, resource: resolvedResource } };
		}
		const contentKind = baseHalfCanvasContentKindForPath(outputPath, false);
		if (document.kind !== 'file' || (contentKind !== 'text' && contentKind !== 'code')) {
			return {};
		}
		try {
			const contents = (await this.view.fileService.readFile(resource, { length: CARD_EXCERPT_READ_BYTES })).value;
			const raw = decodeTextExcerpt(contents);
			if (raw === undefined) {
				return {};
			}
			const text = markdownPreviewKind(outputPath) === 'markdown' ? raw : cleanCardPreviewText(outputPath, raw);
			return text ? { resultOutputText: text } : {};
		} catch {
			return { resultMissing: true };
		}
	}
}
