/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { basename } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { FileOperationResult, IFileStat, toFileOperationResult } from '../../../../../platform/files/common/files.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import {
	baseHalfCanvasItemsSharePreviewVersion,
	baseHalfCanvasDefaultCardSize,
	baseHalfCanvasGenerationCardSize,
	baseHalfCanvasPictureKind,
	IBaseHalfCanvasItem
} from '../../common/basehalfCanvasModel.js';
import { IBaseHalfCanvasFolderState } from '../../../navigation/common/basehalfCanvasNavigation.js';
import { baseHalfCanvasMarkdownPreviewSource, BASEHALF_CANVAS_NOTE_SHOWN_MAX_BYTES } from '../../common/basehalfCanvasPreview.js';
import { isBaseHalfMarkdownResource } from '../../../cardDetail/common/basehalfCardDetail.js';
import { BaseHalfRenderableContentKind, baseHalfRenderableContentKind } from '../../../cardDetail/common/basehalfContentRendering.js';
import { BaseHalfCanvasCardPresentation } from '../../common/basehalfCanvasCardPresentation.js';
import { IBaseHalfCanvasPreviewHydrationBatch } from '../../common/basehalfCanvasPreviewHydration.js';
import { IBaseHalfCanvasSceneCard, IBaseHalfCanvasSceneCardPresentation, IBaseHalfCanvasSceneViewport } from '../../common/basehalfCanvasScene.js';
import { BASEHALF_CANVAS_DRAFT_PREVIEW, BaseHalfCanvasCardPreview } from '../../common/basehalfCanvasCardPreview.js';
import { IBaseHalfWorkspaceMutationStamp } from '../../../workspace/common/basehalfWorkspaceMutation.js';
import type { BaseHalfCanvasWorkbenchContribution } from '../basehalfCanvasWorkbench.contribution.js';
import { BASEHALF_CANVAS_PICTURE_MEASURE_TIMEOUT_MS } from '../basehalfCanvasPictureShapes.js';
import { CANVAS_MARKDOWN_FULL_EDITOR_LABEL, badgeType, baseHalfBadgeResourceIdentity } from './basehalfCanvasViewShared.js';

/** An excerpt shows the first lines of a file, so only its head is read, whatever its size. */
const CARD_EXCERPT_READ_BYTES = 8192;

/** What the card of a media file says of it where it shows no picture. */
const MEDIA_LABELS: Readonly<Record<BaseHalfRenderableContentKind, string>> = {
	image: 'Image file',
	pdf: 'PDF document',
	video: 'Video file',
	audio: 'Audio file'
};

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
 * after a drawing, and sizes the cards of new files.
 *
 * A part of the canvas view (README.md in this folder): it keeps its own state,
 * and reaches the state the view shares and the other parts through `view`.
 */
export class BaseHalfCanvasPreviews {
	private cardPreviewHydrationRunning = false;

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
	 * The size at which the card of a new file is drawn: an image or a video
	 * has the shape of its picture, which the window measures first, and every
	 * other file has the size of a file card (canvas card placement, "When a
	 * card appears").
	 */
	async sizeOfNewFileCard(resource: URI): Promise<{ readonly width: number; readonly height: number }> {
		const stat = await this.view.fileService.stat(resource).catch(() => undefined);
		const kind = stat && baseHalfCanvasPictureKind({ kind: 'file', stat });
		if (!kind || !stat) {
			return baseHalfCanvasDefaultCardSize('file');
		}
		const picture = { resource, version: `${stat.mtime ?? 0}-${stat.size ?? 0}`, kind };
		await this.view.pictureShapes.measure([picture], BASEHALF_CANVAS_PICTURE_MEASURE_TIMEOUT_MS);
		const ratio = this.view.pictureShapes.ratioOf(picture);
		return baseHalfCanvasGenerationCardSize(kind, typeof ratio === 'number' ? ratio : undefined);
	}

	/** What the card of an item shows of it when there is no file to read: a draft's. */
	cardPreviewWithoutFile(item: IBaseHalfCanvasItem): BaseHalfCanvasCardPreview | undefined {
		return item.generation?.draft ? BASEHALF_CANVAS_DRAFT_PREVIEW : undefined;
	}

	private async readCardPreview(item: IBaseHalfCanvasItem): Promise<BaseHalfCanvasCardPreview> {
		const withoutFile = this.cardPreviewWithoutFile(item);
		if (withoutFile) {
			return withoutFile;
		}
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

		// The canvas shows the files that Card Detail shows (architecture invariants, "Product shell").
		const mediaKind = baseHalfRenderableContentKind(item.stat.resource);
		if (mediaKind) {
			const resource = mediaKind === 'pdf' ? item.stat.resource : item.stat.resource.with({
				query: `basehalfCanvasVersion=${item.stat.mtime ?? 0}-${item.stat.size ?? 0}`
			});
			return { kind: 'media', text: MEDIA_LABELS[mediaKind], mediaKind, resource };
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
		if (current?.kind !== 'loading') {
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
		if (current?.kind !== 'loading') {
			this.view.cardPreviewHydrationQueue.delete(path);
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
		this.view.cardPreviewHydrationQueue.prune(path => this.view.renderedCardPreviewsByPath.get(path)?.preview?.kind === 'loading');
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
				const batch = this.view.cardPreviewHydrationQueue.take(4, () => 0);
				if (!batch) {
					return;
				}
				if (batch.sceneKey !== sceneKey || !this.view.cardPreviewHydrationQueue.isCurrent(batch)) {
					return;
				}
				const items = batch.paths.flatMap(path => {
					const item = this.view.renderedItemsByPath.get(path);
					const preview = this.view.renderedCardPreviewsByPath.get(path)?.preview;
					return item && preview?.kind === 'loading' ? [item] : [];
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
		const loading = items.filter(item => this.view.renderedCardPreviewsByPath.get(item.path)?.preview?.kind === 'loading');
		if (loading.length > 0) {
			await this.hydrateCardPreviewItems(folder, loading, structuralStamp, seq, batch);
		}
	}

	private async hydrateCardPreviewItems(
		folder: IBaseHalfCanvasFolderState,
		items: readonly IBaseHalfCanvasItem[],
		structuralStamp: IBaseHalfWorkspaceMutationStamp,
		seq: number,
		hydrationBatch: IBaseHalfCanvasPreviewHydrationBatch
	): Promise<boolean> {
		const batchSize = 4;
		for (let start = 0; start < items.length; start += batchSize) {
			if (!this.view.renderer.isRenderCurrent(seq)
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
					const preview = await this.readCardPreview(versionedItem);
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
			if (!this.view.renderer.isRenderCurrent(seq)
				|| !this.view.isCurrentSceneKey(hydrationBatch.sceneKey)
				|| !this.view.cardPreviewHydrationQueue.isCurrent(hydrationBatch)
				|| !this.view.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, structuralStamp)) {
				return false;
			}
			while (this.view.canvasScene.isInteracting()) {
				await this.view.renderer.waitForCanvasSceneInteractionEnd();
				if (!this.view.renderer.isRenderCurrent(seq)
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
}
