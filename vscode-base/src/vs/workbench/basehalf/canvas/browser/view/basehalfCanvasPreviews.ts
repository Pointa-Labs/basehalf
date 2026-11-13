/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { basename } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { FileOperationResult, IFileStat, toFileOperationResult } from '../../../../../platform/files/common/files.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import {
	baseHalfCanvasCardToggleConnections,
	baseHalfCanvasItemsShareFileVersion,
	baseHalfCanvasItemsSharePreviewVersion,
	baseHalfCanvasDefaultCardSize,
	baseHalfCanvasGenerationCardSize,
	baseHalfCanvasNewCardSize,
	baseHalfCanvasPictureKind,
	IBaseHalfCanvasItem
} from '../../common/basehalfCanvasModel.js';
import { IBaseHalfCanvasFolderState } from '../../../navigation/common/basehalfCanvasNavigation.js';
import { baseHalfCanvasMarkdownPreviewSource, BASEHALF_CANVAS_NOTE_SHOWN_MAX_BYTES } from '../../common/basehalfCanvasPreview.js';
import { BaseHalfRenderableContentKind, baseHalfRenderableContentKind } from '../../../workspace/common/basehalfContentRendering.js';
import { BaseHalfCanvasCardPresentation } from '../../common/basehalfCanvasCardPresentation.js';
import { IBaseHalfCanvasPreviewHydrationBatch } from '../../common/basehalfCanvasPreviewHydration.js';
import { IBaseHalfCanvasSceneCard, IBaseHalfCanvasSceneCardPresentation, IBaseHalfCanvasSceneViewport } from '../../common/basehalfCanvasScene.js';
import { BASEHALF_CANVAS_DRAFT_PREVIEW, BaseHalfCanvasCardPreview, IBaseHalfCanvasCodePreview } from '../../common/basehalfCanvasCardPreview.js';
import { IBaseHalfWorkspaceMutationStamp } from '../../../workspace/common/basehalfWorkspaceMutation.js';
import { baseHalfMediaVersionQuery } from '../../../playback/browser/basehalfMediaElements.js';
import type { BaseHalfCanvasWorkbenchContribution } from '../basehalfCanvasWorkbench.contribution.js';
import { BASEHALF_CANVAS_PICTURE_MEASURE_TIMEOUT_MS } from '../basehalfCanvasPictureShapes.js';
import { CANVAS_MARKDOWN_FULL_EDITOR_LABEL, badgeType, baseHalfBadgeResourceIdentity } from './basehalfCanvasViewShared.js';
import { baseHalfCodePreviewLines, baseHalfCodePreviewLinesFor } from '../../common/basehalfCanvasCodePreview.js';
import { TokenizationRegistry } from '../../../../../editor/common/languages.js';
import { PLAINTEXT_LANGUAGE_ID } from '../../../../../editor/common/languages/modesRegistry.js';
import { isBaseHalfMarkdownResource } from '../../../workspace/common/basehalfItems.js';

/**
 * How long a face the canvas knows without reading waits for a drawing that
 * takes it. A face holds only for the file at the version it shows, so this
 * only lets go of what no drawing took, as for a move that failed.
 */
const KNOWN_FACE_LIFETIME_MS = 10_000;

/** The version of a file: what its card's face holds for. */
type BaseHalfCanvasFileVersion = Pick<IFileStat, 'etag' | 'mtime' | 'size'>;

function sameFileVersion(left: BaseHalfCanvasFileVersion, right: BaseHalfCanvasFileVersion): boolean {
	if (left.etag !== undefined || right.etag !== undefined) {
		return left.etag !== undefined && left.etag === right.etag;
	}
	return left.mtime !== undefined && left.mtime === right.mtime && left.size === right.size;
}

/**
 * What the card of a file shows before the canvas has read the file: the
 * text BaseHalf wrote into a new note at the version that write made, or what
 * the card of a file that BaseHalf moved showed under its old name.
 */
interface IBaseHalfCanvasKnownFace {
	readonly preview: BaseHalfCanvasCardPreview;
	/** The card of the old name, for a move: the face holds for the file at the version that card showed. */
	readonly movedFrom?: IBaseHalfCanvasItem;
	/** The version the write of a new note made. */
	readonly written?: BaseHalfCanvasFileVersion;
	readonly until: number;
}

/** An excerpt shows the first lines of a file, so only its head is read, whatever its size. */
const CARD_EXCERPT_READ_BYTES = 8192;

/** What the card of a media file says of it where it shows no picture. */
const MEDIA_LABELS: Readonly<Record<BaseHalfRenderableContentKind, string>> = {
	image: 'Image file',
	pdf: 'PDF document',
	book: 'Book',
	video: 'Video file',
	audio: 'Audio file'
};

function markdownPreviewKind(name: string): 'markdown' | 'text' | 'code' {
	if (/\.(md|markdown|mdx)$/i.test(name)) {
		return 'markdown';
	}
	return badgeType(name, false) === 'code' ? 'code' : 'text';
}

/** Any other text than a note and a code file: its first lines, trimmed (note rendering, rule 32). */
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
	/** By the comparison key of the file's resource. */
	private readonly knownFaces = new Map<string, IBaseHalfCanvasKnownFace>();

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
			// A PDF or a book is 300 × 400 without measuring anything.
			return stat ? baseHalfCanvasNewCardSize({ kind: 'file', stat }) : baseHalfCanvasDefaultCardSize('file');
		}
		const picture = { resource, version: `${stat.mtime ?? 0}-${stat.size ?? 0}`, kind };
		await this.view.pictureShapes.measure([picture], BASEHALF_CANVAS_PICTURE_MEASURE_TIMEOUT_MS);
		const ratio = this.view.pictureShapes.ratioOf(picture);
		return baseHalfCanvasGenerationCardSize(kind, typeof ratio === 'number' ? ratio : undefined);
	}

	/**
	 * BaseHalf wrote `text` into the new note `written`: its card is drawn with
	 * that text at once, without reading the file first, as long as the file is
	 * at the version that write made. So a note that is to be edited is drawn
	 * once, with its editor (note title, "From the card's first frame").
	 */
	rememberWrittenNote(written: IFileStat, text: string): void {
		if (!isBaseHalfMarkdownResource(written.resource)) {
			return;
		}
		this.knownFaces.set(this.view.uriIdentityService.extUri.getComparisonKey(written.resource), {
			preview: { kind: 'markdown', text },
			written: { etag: written.etag, mtime: written.mtime, size: written.size },
			until: Date.now() + KNOWN_FACE_LIFETIME_MS
		});
	}

	/**
	 * BaseHalf is about to move these files: the card of each new name is
	 * drawn with what the card of its old name shows now (canvas card name,
	 * "After the rename"), the canvas's own part of the move, as the card
	 * information is the mirror's.
	 */
	carryMovedCards(files: readonly { readonly source?: URI; readonly target: URI }[]): void {
		const extUri = this.view.uriIdentityService.extUri;
		const shown = new Map([...this.view.renderedCardPreviewsByPath.values()].map(entry => [extUri.getComparisonKey(entry.item.stat.resource), entry]));
		for (const { source, target } of files) {
			const entry = source ? shown.get(extUri.getComparisonKey(source)) : undefined;
			if (!entry || entry.preview.kind === 'loading' || entry.preview.kind === 'unavailable' || entry.preview.kind === 'draft') {
				continue;
			}
			this.knownFaces.set(extUri.getComparisonKey(target), {
				preview: entry.preview,
				movedFrom: entry.item,
				until: Date.now() + KNOWN_FACE_LIFETIME_MS
			});
		}
	}

	/** The face the canvas knows for `item` without reading its file, if it knows one for the file at its version. */
	knownCardPreview(item: IBaseHalfCanvasItem): BaseHalfCanvasCardPreview | undefined {
		const key = this.view.uriIdentityService.extUri.getComparisonKey(item.stat.resource);
		const face = this.knownFaces.get(key);
		if (!face) {
			return undefined;
		}
		if (face.until < Date.now()) {
			this.knownFaces.delete(key);
			return undefined;
		}
		if (face.movedFrom) {
			if (!baseHalfCanvasItemsShareFileVersion(face.movedFrom, item)) {
				return undefined;
			}
			// A picture, a video, a sound, a PDF, or a book names its file: its face is the file's at its new name, which reads nothing.
			return face.preview.kind === 'media' ? this.mediaPreview(item) : face.preview;
		}
		return item.kind === 'file' && face.written && sameFileVersion(face.written, item.stat) ? face.preview : undefined;
	}

	/** These cards are drawn: what they show is the canvas's own now. */
	forgetKnownFaces(items: readonly IBaseHalfCanvasItem[]): void {
		if (this.knownFaces.size === 0) {
			return;
		}
		for (const item of items) {
			this.knownFaces.delete(this.view.uriIdentityService.extUri.getComparisonKey(item.stat.resource));
		}
	}

	/** What the card of an item shows of it when there is no file to read: a draft's. */
	cardPreviewWithoutFile(item: IBaseHalfCanvasItem): BaseHalfCanvasCardPreview | undefined {
		return item.generation?.draft ? BASEHALF_CANVAS_DRAFT_PREVIEW : undefined;
	}

	/**
	 * The face of a picture, a video, a sound, a PDF, or a book, which reads
	 * nothing of the file: it names the file at its version. Nothing for
	 * another kind of file.
	 */
	mediaPreview(item: IBaseHalfCanvasItem): BaseHalfCanvasCardPreview | undefined {
		// The canvas shows the files that Card Detail shows (architecture invariants, "Product shell").
		const mediaKind = item.kind === 'file' ? baseHalfRenderableContentKind(item.stat.resource) : undefined;
		if (!mediaKind) {
			return undefined;
		}
		// The face of a PDF or a book draws its cover, which is made from the file's version.
		const resource = mediaKind === 'pdf' || mediaKind === 'book' ? item.stat.resource : item.stat.resource.with({
			query: baseHalfMediaVersionQuery(item.stat)
		});
		return { kind: 'media', text: MEDIA_LABELS[mediaKind], mediaKind, resource };
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

		const media = this.mediaPreview(item);
		if (media) {
			return media;
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

			if (kind === 'markdown') {
				return { kind, text: baseHalfCanvasMarkdownPreviewSource(raw) };
			}
			const languageId = await this.languageOfCode(item.stat.resource, raw);
			if (languageId || kind === 'code') {
				const wholeFile = contents.value.byteLength < CARD_EXCERPT_READ_BYTES;
				const lines = baseHalfCodePreviewLines(raw, wholeFile);
				return {
					kind: 'code',
					text: lines.join('\n'),
					lines,
					wholeFile,
					languageId,
					tabSize: this.view.configurationService.getValue<number>('editor.tabSize', { resource: item.stat.resource, overrideIdentifier: languageId }) ?? 4
				};
			}
			const text = cleanCardPreviewText(item.name, raw);
			return text ? { kind, text } : { kind: 'empty', text: 'Empty file' };
		} catch (error) {
			if (kind === 'markdown' && error instanceof Error && toFileOperationResult(error) === FileOperationResult.FILE_TOO_LARGE) {
				return { kind: 'richRequired', text: CANVAS_MARKDOWN_FULL_EDITOR_LABEL };
			}
			return { kind: 'unavailable', text: 'Preview unavailable' };
		}
	}

	/**
	 * The language of a file that shows as code, which is one the window knows
	 * other than plain text: a note never gets here, and Markdown has no grammar
	 * here (D118). Languages are known once the built-in extensions are registered.
	 */
	private async languageOfCode(resource: URI, head: string): Promise<string | undefined> {
		await this.view.extensionService.whenInstalledExtensionsRegistered();
		const firstLine = head.slice(0, head.indexOf('\n') + 1 || undefined);
		const languageId = this.view.languageService.guessLanguageIdByFilepathOrFirstLine(resource, firstLine);
		return languageId && languageId !== PLAINTEXT_LANGUAGE_ID ? languageId : undefined;
	}

	/**
	 * Colors what the cards of a batch show, so that a drawing only has to read
	 * it. The first card of a language loads its grammar and compiles it on this
	 * thread, tens of milliseconds once per window, so it waits for the end of a
	 * gesture as drawing does.
	 */
	private async colorCodePreviews(previews: readonly (BaseHalfCanvasCardPreview | undefined)[], heightOf: (preview: IBaseHalfCanvasCodePreview) => number): Promise<void> {
		for (const preview of previews) {
			if (preview?.kind !== 'code' || !preview.languageId) {
				continue;
			}
			await TokenizationRegistry.getOrCreate(preview.languageId);
			this.view.cardRenderer.codePreviewTokens.linesOf(preview, baseHalfCodePreviewLinesFor(heightOf(preview)));
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
			const heights = new Map(hydrated.flatMap(({ item, preview }) => preview?.kind === 'code' ? [[preview, this.view.renderedSceneCards.find(card => card.path === item.path)?.height ?? 0] as const] : []));
			await this.colorCodePreviews(hydrated.map(({ preview }) => preview), preview => heights.get(preview) ?? 0);
			while (this.view.canvasScene.isInteracting()) {
				await this.view.renderer.waitForCanvasSceneInteractionEnd();
			}
			if (!this.view.renderer.isRenderCurrent(seq)
				|| !this.view.isCurrentSceneKey(hydrationBatch.sceneKey)
				|| !this.view.cardPreviewHydrationQueue.isCurrent(hydrationBatch)
				|| !this.view.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, structuralStamp)) {
				return false;
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
				if (this.view.activeCanvasNoteEditor?.path === currentItem.path || this.view.codeCards?.isEditing(currentItem.path)) {
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
				const connectionsKey = baseHalfCanvasCardToggleConnections(displayedItem.relationships);
				const cached = this.view.renderedCardsByPath.get(currentItem.path);
				const reused = this.view.renderer.canReuseRenderedCard(cached, displayedItem, preview, visualKey, hydrationBatch.sceneKey);
				if (reused) {
					this.view.renderer.refreshReusedCard(cached, displayedItem, connectionsKey);
				}
				const element = reused
					? cached.element
					: this.view.cardRenderer.createCard(displayedItem, currentCard, preview, hydrationBatch.sceneKey);
				this.view.cardRenderer.applyNoteBackground(element, isBaseHalfMarkdownResource(currentItem.stat.resource) ? this.view.renderedNoteBackgrounds.get(currentItem.path) ?? 'default' : undefined);
				this.view.renderedCardsByPath.set(currentItem.path, {
					item: currentItem,
					preview,
					visualKey,
					connectionsKey,
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
					editsOnCard: this.view.codeCards?.editsOnCard(currentItem, preview) ? true : undefined,
					...(this.view.openBadgeFaces.has(currentItem.path) || this.view.canvasNoteSurfacePath === currentItem.path ? { forceInteractive: true as const } : {}),
					...(this.view.canvasNoteSurfacePath === currentItem.path ? { noteEditing: true as const } : {})
				});
			}
			if (replacements.size === 0) {
				continue;
			}
			this.view.renderedSceneCards = Object.freeze(this.view.renderedSceneCards.map(card => replacements.get(card.path) ?? card));
			// The epoch the view keeps for its features follows every drawing of the scene.
			this.view.renderedSceneStructuralEpoch = structuralStamp.structuralEpoch;
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
