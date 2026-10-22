/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import '../media/basehalfCanvasCard.css';
import '../media/basehalfCanvasCardPreview.css';
import { $, append, clearNode } from '../../../../../base/browser/dom.js';
import { DisposableStore, MutableDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { dirname, isEqual } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { FileAccess } from '../../../../../base/common/network.js';
import { localize } from '../../../../../nls.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { baseHalfCanvasItemBounds, IBaseHalfCanvasBounds, IBaseHalfCanvasItem } from '../../common/basehalfCanvasModel.js';
import { IBaseHalfCanvasFolderState } from '../../../navigation/common/basehalfCanvasNavigation.js';
import { baseHalfItemDisplayName, isBaseHalfMarkdownResource } from '../../../cardDetail/common/basehalfCardDetail.js';
import { BaseHalfItemGlyph, renderBaseHalfItemGlyph } from '../../../shell/browser/basehalfItemGlyph.js';
import { BASEHALF_GENERATION_EXTENSIONS } from '../../../video/common/basehalfGenerationInfo.js';
import { baseHalfPathHoldsDraft } from '../../../video/common/basehalfGenerationDraft.js';
import { renderBaseHalfGenerationCardFace } from '../../../video/browser/basehalfVideoCard.js';
import { captureBaseHalfVideoFrame, createBaseHalfVideoFrameReader } from '../../../video/browser/basehalfVideoFrameCapture.js';
import { baseHalfGenerationCardToolbarActions, baseHalfGenerationPhase } from '../../../video/common/basehalfVideoCardPresentation.js';
import { BaseHalfCanvasCardPresentation } from '../../common/basehalfCanvasCardPresentation.js';
import { splitBaseHalfMarkdownFrontmatter } from '../../../markdown/common/basehalfMarkdownProjection.js';
import { renderBaseHalfCanvasNoteInParts } from '../basehalfCanvasNoteParts.js';
import { releaseBaseHalfCanvasCardMedia } from '../basehalfCanvasCardMedia.js';
import { createBaseHalfCanvasCardVideoPlayer, IBaseHalfCanvasCardVideoPlayer } from '../basehalfCanvasCardVideoPlayer.js';
import {
	BaseHalfCanvasSceneCardControls,
	BaseHalfCanvasSceneVideoAction,
	BaseHalfCanvasSceneVideoFrame,
	BaseHalfCanvasNoteBackground,
	BASEHALF_CANVAS_NOTE_DEFAULT_FORMAT_STATE,
	IBaseHalfCanvasSceneCardPresentation
} from '../../common/basehalfCanvasScene.js';
import { BaseHalfCanvasCardPreview } from '../../common/basehalfCanvasCardPreview.js';
import type { BaseHalfCanvasWorkbenchContribution } from '../basehalfCanvasWorkbench.contribution.js';
import { appendCanvasNoteFullEditorLabel, badgeType, cardDisplayName, isVideoMediaPreview } from './basehalfCanvasViewShared.js';

type BaseHalfCanvasGlyphType = BaseHalfItemGlyph;

function glyphTone(type: BaseHalfCanvasGlyphType, orphan: boolean): string {
	if (orphan) {
		return 'var(--bh-card-danger)';
	}
	if (type === 'folder') {
		return 'var(--bh-card-folder-glyph)';
	}
	return 'var(--bh-card-text-tertiary)';
}

/**
 * Builds the element of each card: its caption and glyph, and the body for a
 * note, a file, media, a folder, or a generation card, and runs the actions
 * of a generation card's toolbar.
 *
 * A part of the canvas view (README.md in this folder): it keeps its own state,
 * and reaches the state the view shares and the other parts through `view`.
 */
export class BaseHalfCanvasCardRenderer {
	/** The player of the video file drawn in each card element. */
	private readonly mediaVideoPlayers = new WeakMap<HTMLElement, IBaseHalfCanvasCardVideoPlayer>();

	constructor(private readonly view: BaseHalfCanvasWorkbenchContribution) { }

	async invokeSceneVideoAction(
		sceneKey: string,
		structuralEpoch: number,
		path: string,
		action: BaseHalfCanvasSceneVideoAction,
		_anchor: HTMLElement,
		frame?: BaseHalfCanvasSceneVideoFrame
	): Promise<void> {
		const { folder, items } = await this.view.selectionActions.resolveSceneSelection(sceneKey, structuralEpoch, [path]);
		const item = items[0];
		const preview = this.view.renderedCardPreviewsByPath.get(path)?.preview;
		const controls = this.sceneCardControls(item, preview);
		if (controls?.kind !== 'video' || !controls.actions.includes(action)) {
			throw new Error(localize('basehalf.canvas.video.actionUnavailable', "That action is no longer available."));
		}
		this.view.markCanvasUserInteraction();
		switch (action) {
			case 'importResult':
				await this.uploadToDraft(folder, item);
				return;
			case 'openFullPreview':
				// Open shows the card large, as a double click does; its video pauses.
				this.playerOf(path)?.video.pause();
				await this.view.selectionActions.openSceneCard(sceneKey, structuralEpoch, path);
				return;
			case 'revealVideo':
				await this.view.commandService.executeCommand('revealFileInOS', item.stat.resource);
				return;
			case 'captureFrame':
				await this.captureVideoFrame(folder, item, frame ?? 'first');
				return;
		}
	}

	sceneCardControls(item: IBaseHalfCanvasItem, _preview: BaseHalfCanvasCardPreview | undefined): BaseHalfCanvasSceneCardControls | undefined {
		if (isBaseHalfMarkdownResource(item.stat.resource)) {
			return {
				kind: 'note',
				formatState: this.view.canvasNoteFormatStates.get(this.view.uriIdentityService.extUri.getComparisonKey(item.stat.resource)) ?? BASEHALF_CANVAS_NOTE_DEFAULT_FORMAT_STATE,
				background: this.view.renderedNoteBackgrounds.get(item.path) ?? 'default'
			};
		}
		const generation = item.generation;
		if (!generation) {
			return undefined;
		}
		// The toolbar of a generation card follows its phase, which the task record of this computer decides.
		const phase = baseHalfGenerationPhase({ path: item.path, hasFile: !generation.draft, task: this.view.generationTaskStore.forCard(item.stat.resource) });
		return { kind: 'video', media: generation.kind, actions: baseHalfGenerationCardToolbarActions(generation.kind, phase) };
	}

	/**
	 * A generation of a card on the canvas changed (generation cards, "The
	 * card"): the card's face follows by itself, and its toolbar is given the
	 * actions of its phase now, without drawing the canvas again.
	 */
	refreshGenerationControls(resource: URI): void {
		const folder = this.view.getCurrentFolder();
		const item = folder && isEqual(dirname(resource), folder.resource)
			? [...this.view.renderedItemsByPath.values()].find(candidate => isEqual(candidate.stat.resource, resource))
			: undefined;
		const card = item?.generation ? this.view.renderedSceneCards.find(candidate => candidate.path === item.path) : undefined;
		if (!folder || !item || !card) {
			return;
		}
		const controls = this.sceneCardControls(item, this.view.renderedCardPreviewsByPath.get(item.path)?.preview);
		if (JSON.stringify(controls) === JSON.stringify(card.controls)) {
			return;
		}
		this.view.renderedSceneCards = Object.freeze(this.view.renderedSceneCards.map(candidate => candidate === card ? { ...card, controls } : candidate));
		this.view.canvasScene.update({
			key: this.view.sceneKey(folder),
			structuralEpoch: this.view.renderedSceneStructuralEpoch,
			revision: this.view.renderSeq,
			cards: this.view.renderedSceneCards,
			edges: this.view.renderedSceneEdges
		});
	}

	/** The scene has put a card's element into the document in place of the previous one. */
	didMountCardElement(path: string, element: HTMLElement): void {
		this.view.cardListenerStores.didMount(path, element);
		this.view.creation.mountInlineRenameEditor(path, element);
	}

	applyNoteBackground(card: HTMLElement, background: BaseHalfCanvasNoteBackground | undefined): void {
		if (background === undefined) {
			delete card.dataset.noteBackground;
			return;
		}
		card.dataset.noteBackground = background;
	}

	createCard(
		item: IBaseHalfCanvasItem,
		bounds: IBaseHalfCanvasBounds,
		preview: BaseHalfCanvasCardPreview | undefined,
		sceneKey: string
	): HTMLElement {
		const card = $('.basehalf-canvas-card');
		// The element this one replaces stays on screen, with its listeners,
		// until the scene mounts this one.
		const listeners = this.view.cardListenerStores.replace(item.path, card);
		const presentationListeners = new MutableDisposable<DisposableStore>();
		listeners.add(presentationListeners);
		const displayName = cardDisplayName(item);
		const markdownNote = isBaseHalfMarkdownResource(item.stat.resource);
		const draft = item.generation?.draft === true;
		card.tabIndex = 0;
		card.setAttribute('role', 'group');
		card.dataset.basehalfCardPath = item.path;
		card.dataset.cardHeight = String(bounds.height);
		const badgeOpen = this.view.openBadgeFaces.has(item.path);
		card.dataset.previewLevel = 'shell';
		card.dataset.projection = badgeOpen ? 'badge' : 'preview';
		card.classList.add(item.kind);
		card.classList.toggle('badge-open', badgeOpen);
		if (item.generation) {
			// A generation card, of an image or a video: a draft has no file yet.
			card.dataset.generation = draft ? 'draft' : 'file';
			card.dataset.generationKind = item.generation.kind;
		}
		card.setAttribute('aria-label', `${displayName} card`);
		card.title = draft
			? localize('basehalf.canvas.card.draftTitle', "{0} - click to select; it has no file yet", item.path)
			: item.kind === 'folder'
				? `${item.path} - click to select; double-click to enter this folder`
				: markdownNote
					? `${item.path} - click to select; double-click the content to edit`
					: `${item.path} - click to select; double-click to open the editor`;

		const type = badgeType(item.name, item.kind === 'folder');
		const orphan = item.badge?.orphan === true;
		const badgeIssueCount = (item.relationships?.issueCount ?? 0) + (this.view.renderedBadgeProblems.has(item.path) ? 1 : 0);
		card.classList.toggle('has-reference-issues', badgeIssueCount > 0);
		card.dataset.referenceIssueCount = String(badgeIssueCount);
		const issueText = badgeIssueCount === 0
			? ''
			: badgeIssueCount === 1
				? localize('basehalf.canvas.card.oneIssue', "1 issue")
				: localize('basehalf.canvas.card.issues', "{0} issues", badgeIssueCount);
		card.setAttribute('aria-label', `${displayName} card${orphan ? ', missing' : ''}${issueText ? `, ${issueText}` : ''}`);
		// A draft has no file whose description its badge would edit.
		const canShowBadgeFace = !(item.kind === 'folder' && orphan) && !draft;
		const caption = append(card, $('.basehalf-canvas-card-caption'));
		const captionIdentity = append(caption, $('.basehalf-canvas-card-caption-identity'));
		const icon = append(captionIdentity, $('.basehalf-canvas-card-caption-icon'));
		icon.setAttribute('aria-hidden', 'true');
		this.renderGlyph(icon, type, glyphTone(type, orphan), 15);
		const label = append(captionIdentity, $('.basehalf-canvas-card-label'));
		label.textContent = displayName;
		label.title = displayName;
		label.classList.toggle('danger', orphan);
		// The name is the file name of a file that is there, or the name a
		// draft's file will have: a double click on it renames in place.
		label.classList.toggle('renamable', !orphan);
		if (!orphan) {
			// The name is text. A click on it selects no card: the first click of
			// the double click that edits it would bring the card's toolbar up
			// over the name. A drag from it still moves the card.
			listeners.add(this.view.addDisposableListener(label, 'click', event => event.stopPropagation()));
		}
		const captionActions = append(caption, $('.basehalf-canvas-card-caption-actions'));
		if (canShowBadgeFace) {
			this.view.badgeEditor.renderCardBadgeToggle(captionActions, item, badgeIssueCount, listeners);
		}
		const content = append(card, $('.basehalf-canvas-card-content'));
		this.view.creation.renderInlineRenameEditor(card, item);
		this.view.renderedCardElementsByPath.set(item.path, card);

		let renderedPresentation: BaseHalfCanvasCardPresentation | undefined;
		let renderedHeight: number | undefined;
		// The Open of a card's video player does what a double click on the card
		// does. A card outlives the drawings that keep it, so the epoch is the
		// scene's when Open is pressed, the one the scene's own double click reports.
		const openCard = (): void => {
			const structuralEpoch = this.view.canvasScene.structuralEpochOf(sceneKey);
			if (structuralEpoch !== undefined) {
				void this.view.selectionActions.openSceneCard(sceneKey, structuralEpoch, item.path).catch(error => this.view.logService.warn(error));
			}
		};
		const updatePresentation = (presentation: IBaseHalfCanvasSceneCardPresentation): void => {
			// A live Note editor is an overlay on the retained preview. Even a stale
			// scene callback must not dispose that preview's rendering/listener owner.
			const presentationLevel = this.view.activeCanvasNoteEditor?.card === card
				? 'preview'
				: presentation.level;
			this.view.previews.updateCardPreviewHydrationPresentation(item.path, presentationLevel, sceneKey);
			if (renderedHeight !== presentation.height) {
				renderedHeight = presentation.height;
				card.dataset.cardHeight = String(presentation.height);
			}
			if (renderedPresentation === presentationLevel) {
				card.dataset.previewLevel = presentationLevel;
				if (this.view.canvasNoteSurfacePath === item.path) {
					this.view.noteEditing.tryMountCanvasNoteEditor(item.path);
				}
				return;
			}
			// The card of a video file, and the face of a draft, that is selected or
			// deselected keeps what it shows: only the player's controls come and go.
			const mediaPlayer = this.mediaVideoPlayers.get(card);
			if (renderedPresentation !== undefined && renderedPresentation !== 'shell' && presentationLevel !== 'shell' && !badgeOpen
				&& ((isVideoMediaPreview(preview) && mediaPlayer) || preview?.kind === 'draft')) {
				renderedPresentation = presentationLevel;
				card.dataset.previewLevel = presentationLevel;
				mediaPlayer?.setSelected(presentationLevel === 'interactive');
				return;
			}
			renderedPresentation = presentationLevel;
			card.dataset.previewLevel = presentationLevel;
			const nextListeners = new DisposableStore();
			presentationListeners.value = nextListeners;
			clearNode(content);
			if (presentationLevel === 'shell') {
				return;
			}

			const active = append(content, $('.basehalf-canvas-card-active'));
			const body = append(active, $('.basehalf-canvas-card-body'));
			if (badgeOpen && canShowBadgeFace) {
				this.view.badgeEditor.renderCardBadgeFace(body, item, nextListeners);
			} else {
				this.renderCardPreview(body, item, preview, orphan, presentationLevel === 'interactive', nextListeners, card, openCard);
			}
			this.renderFolderCoverage(active, item, preview);
			this.view.badgeEditor.restorePendingCanvasBadgeFocus(card, item.path);
		};
		this.view.cardPresentationUpdaters.set(card, updatePresentation);
		updatePresentation({
			level: 'shell',
			height: bounds.height
		});

		listeners.add(this.view.addDisposableListener(card, 'keydown', event => {
			if (event.target !== card) {
				return;
			}
			if (event.key === 'F2') {
				event.preventDefault();
				event.stopPropagation();
				void this.view.creation.requestInlineRename(item);
			} else if (event.key === 'Enter') {
				event.preventDefault();
				if (draft) {
					// A draft has no file to open: Enter selects it, and its panel shows.
					this.view.selectionActions.selectCard(item.path);
				} else if (markdownNote) {
					this.view.selectionActions.selectCard(item.path);
					const structuralEpoch = this.view.canvasScene.structuralEpochOf(sceneKey);
					if (structuralEpoch !== undefined) {
						void this.view.noteEditing.beginSceneNoteEdit(sceneKey, structuralEpoch, item.path);
					}
				} else {
					void this.view.canvasNavigationService.openResource(item.stat.resource, { source: 'api', pinned: true });
				}
			} else if (event.key === ' ') {
				event.preventDefault();
				this.view.selectionActions.selectCard(item.path);
			}
		}));
		return card;
	}

	cardBoundsForPreview(
		item: IBaseHalfCanvasItem,
		index: number,
		total: number,
		_preview: BaseHalfCanvasCardPreview | undefined
	): IBaseHalfCanvasBounds {
		return baseHalfCanvasItemBounds(item, index, total);
	}

	renderGlyph(container: Element, type: BaseHalfCanvasGlyphType, tone: string, size: number | string): void {
		renderBaseHalfItemGlyph(container, type, tone, size);
	}

	private renderCardPreview(
		container: HTMLElement,
		item: IBaseHalfCanvasItem,
		preview: BaseHalfCanvasCardPreview | undefined,
		orphan: boolean,
		interactive: boolean,
		listeners: DisposableStore,
		card: HTMLElement,
		open: () => void
	): void {
		const previewNode = append(container, $('.basehalf-canvas-card-preview'));
		const previewKindClass = `kind-${preview?.kind ?? 'unavailable'}`;
		previewNode.classList.add(previewKindClass);
		if (orphan) {
			previewNode.textContent = item.kind === 'folder' ? item.badge?.description ?? '' : 'Missing file';
			return;
		}
		if (this.view.canvasNoteSurfacePath === item.path
			&& isBaseHalfMarkdownResource(item.stat.resource)) {
			previewNode.classList.remove(previewKindClass);
			previewNode.classList.add('kind-markdown');
			this.view.noteEditing.renderMarkdownPreview(previewNode, item, preview?.kind === 'markdown' ? preview.text : '', listeners, card);
			return;
		}
		if (!preview) {
			previewNode.textContent = 'Preview unavailable';
			return;
		}
		if (preview.kind === 'draft') {
			this.renderGenerationFace(previewNode, item, listeners);
			return;
		}
		if (preview.kind === 'folder') {
			this.renderFolderPreview(previewNode, preview, item.badge?.description);
			return;
		}
		if (preview.kind === 'markdown') {
			this.view.noteEditing.renderMarkdownPreview(previewNode, item, preview.text, listeners, card);
			return;
		}
		if (preview.kind === 'media') {
			// A generation card with its file shows its image or its video as the
			// card of any such file does; one that cannot be shown says so.
			const unshowable = item.generation ? () => this.renderGenerationFace(previewNode, item, listeners) : undefined;
			this.renderMediaPreview(previewNode, preview, interactive, listeners, open, card, unshowable);
			return;
		}
		previewNode.textContent = preview.text;
	}

	/**
	 * The face of a generation card without a file that can be shown: a draft,
	 * a generation, its end, or a file that cannot be shown (generation cards,
	 * "The card"). It follows the generation by itself.
	 */
	private renderGenerationFace(container: HTMLElement, item: IBaseHalfCanvasItem, listeners: DisposableStore): void {
		if (!item.generation) {
			return;
		}
		clearNode(container);
		container.classList.add('kind-generation');
		listeners.add(renderBaseHalfGenerationCardFace(container, {
			resource: item.stat.resource,
			path: item.path,
			name: item.name,
			kind: item.generation.kind,
			hasFile: !item.generation.draft
		}, {
			hoverService: this.view.hoverService,
			generationService: this.view.videoGenerationService,
			taskStore: this.view.generationTaskStore
		}));
	}

	/** The player of the video that the card of `path` shows, while it shows one. */
	private playerOf(path: string): IBaseHalfCanvasCardVideoPlayer | undefined {
		const element = this.view.renderedCardElementsByPath.get(path);
		return element ? this.mediaVideoPlayers.get(element) : undefined;
	}

	/**
	 * Upload Image or Upload Video (generation cards, "The toolbar"): the user
	 * chooses a file of the draft's kind, which is copied to the draft's path.
	 * A file of another kind is refused with the reason.
	 */
	private async uploadToDraft(folder: IBaseHalfCanvasFolderState, item: IBaseHalfCanvasItem): Promise<void> {
		const generation = item.generation;
		if (!generation?.draft || this.view.canvasNavigationService.state.cardDetail) {
			return;
		}
		const title = generation.kind === 'image'
			? localize('basehalf.canvas.upload.imageTitle', "Upload Image")
			: localize('basehalf.canvas.upload.videoTitle', "Upload Video");
		const picked = await this.view.fileDialogService.showOpenDialog({
			title,
			openLabel: localize('basehalf.canvas.upload.openLabel', "Upload"),
			defaultUri: folder.resource,
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: false,
			filters: [{
				name: generation.kind === 'image'
					? localize('basehalf.canvas.upload.images', "Images")
					: localize('basehalf.canvas.upload.videos', "Videos"),
				extensions: [...BASEHALF_GENERATION_EXTENSIONS[generation.kind]]
			}]
		});
		const source = picked?.[0];
		if (!source) {
			return;
		}
		try {
			await this.view.generationCardActions.upload(item.stat.resource, source);
		} catch (error) {
			this.view.reportCanvasMutationError(error);
			return;
		}
		this.view.requestRender();
	}

	/**
	 * Capture Frame: writes the frame as a PNG into the card's folder, named
	 * after the card and the frame; its card appears to the right of the video
	 * card (generation cards, "The toolbar").
	 */
	private async captureVideoFrame(folder: IBaseHalfCanvasFolderState, item: IBaseHalfCanvasItem, frame: BaseHalfCanvasSceneVideoFrame): Promise<void> {
		let image: URI;
		try {
			image = await captureBaseHalfVideoFrame(this.view.fileService, {
				video: item.stat.resource,
				folder: folder.resource,
				title: baseHalfCanvasCardBaseName(item.name),
				frame,
				currentTime: this.playerOf(item.path)?.currentTime,
				// A draft's path is taken, as for every name the canvas chooses.
				isNameTaken: target => this.isDraftPath(folder, target)
			}, createBaseHalfVideoFrameReader(mainWindow));
		} catch (error) {
			this.view.logService.warn(error);
			this.view.queueCanvasWarning(localize('basehalf.canvas.video.captureFailed', "BaseHalf could not capture that frame: {0}", error instanceof Error ? error.message : String(error)));
			this.view.requestRender();
			return;
		}
		await this.view.creation.placeNewCardBeside(folder, item.path, image);
	}

	/** Whether a path of the canvas's folder holds a draft, which takes its name. */
	private isDraftPath(folder: IBaseHalfCanvasFolderState, resource: URI): Promise<boolean> {
		const relativePath = this.view.uriIdentityService.extUri.relativePath(folder.workspaceFolder, resource);
		return relativePath ? baseHalfPathHoldsDraft(this.view.fileService, folder.workspaceFolder, relativePath) : Promise.resolve(false);
	}

	/**
	 * What the card of a media file shows. `card` is given for the card whose
	 * preview this is, so that its video player stays while the card is
	 * selected or deselected. `unshowable` draws the card instead when the file
	 * cannot be shown, for a generation card; otherwise the card says so and
	 * offers to try again.
	 */
	private renderMediaPreview(
		container: HTMLElement,
		preview: Extract<BaseHalfCanvasCardPreview, { readonly kind: 'media' }>,
		interactive: boolean,
		listeners: DisposableStore,
		open: () => void,
		card?: HTMLElement,
		unshowable?: () => void
	): void {
		container.classList.add(`media-${preview.mediaKind}`);
		if (preview.mediaKind === 'image') {
			const image = append(container, $('img.basehalf-canvas-card-media-visual')) as HTMLImageElement;
			image.src = FileAccess.uriToBrowserUri(preview.resource).toString(true);
			image.alt = '';
			image.draggable = false;
			image.loading = 'lazy';
			image.addEventListener('error', () => {
				image.remove();
				if (unshowable) {
					unshowable();
					return;
				}
				this.renderMediaFallback(container, preview.text, 'image', () => {
					clearNode(container);
					this.renderMediaPreview(container, preview, interactive, listeners, open, card);
				});
			}, { once: true });
			return;
		}
		if (preview.mediaKind === 'video') {
			// The video plays as the player of every card that shows a video does (generation cards, "The player").
			const player = createBaseHalfCanvasCardVideoPlayer(container, null, {
				source: preview.resource,
				videoClasses: ['basehalf-canvas-card-media-visual'],
				open,
				onError: () => {
					player.dispose();
					// No player stays: selecting the card draws its preview again, which tries the video again.
					if (card && this.mediaVideoPlayers.get(card) === player) {
						this.mediaVideoPlayers.delete(card);
					}
					if (unshowable) {
						unshowable();
						return;
					}
					this.renderMediaFallback(container, preview.text, 'video', () => {
						clearNode(container);
						this.renderMediaPreview(container, preview, interactive, listeners, open, card);
					});
				},
				hoverService: this.view.hoverService
			});
			player.setSelected(interactive);
			listeners.add(player);
			if (card) {
				this.mediaVideoPlayers.set(card, player);
				listeners.add(toDisposable(() => {
					if (this.mediaVideoPlayers.get(card) === player) {
						this.mediaVideoPlayers.delete(card);
					}
				}));
			}
			return;
		}
		if (preview.mediaKind === 'audio') {
			if (!interactive) {
				this.renderMediaFallback(container, preview.text, 'audio');
				return;
			}
			const idle = append(container, $('.basehalf-canvas-card-media-idle'));
			idle.setAttribute('aria-hidden', 'true');
			const glyph = append(idle, $('.basehalf-canvas-card-media-idle-glyph'));
			this.renderGlyph(glyph, 'audio', 'var(--bh-card-text-tertiary)', 24);
			const label = append(idle, $('.basehalf-canvas-card-media-idle-label'));
			label.textContent = preview.text;
			const audio = append(container, $('audio.basehalf-canvas-card-media-transport')) as HTMLAudioElement;
			audio.src = FileAccess.uriToBrowserUri(preview.resource).toString(true);
			audio.preload = 'metadata';
			audio.controls = true;
			audio.tabIndex = 0;
			audio.classList.add('nodrag', 'nopan', 'nowheel');
			listeners.add(toDisposable(() => releaseBaseHalfCanvasCardMedia(audio)));
			this.configureCardMediaTransport(audio);
			audio.addEventListener('error', () => {
				audio.remove();
				this.renderMediaFallback(container, preview.text, 'audio', () => {
					clearNode(container);
					this.renderMediaPreview(container, preview, interactive, listeners, open, card);
				});
			}, { once: true });
			return;
		}
		this.renderMediaFallback(container, preview.text, preview.mediaKind);
	}

	private configureCardMediaTransport(media: HTMLMediaElement): void {
		for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'wheel'] as const) {
			media.addEventListener(type, event => {
				// An idle preview behaves like the rest of its card: it can be
				// selected, dragged, opened, and panned across. The scene enables
				// controls only for the selected card; only then does the media
				// transport own these gestures.
				if (media.controls) {
					event.stopPropagation();
				}
			});
		}
	}

	private renderMediaFallback(container: HTMLElement, label: string, kind: 'image' | 'video' | 'audio' | 'pdf', reload?: () => void): void {
		if (container.querySelector('.basehalf-canvas-card-media-fallback')) {
			return;
		}
		const fallback = append(container, $('.basehalf-canvas-card-media-fallback'));
		const glyph = append(fallback, $('.basehalf-canvas-card-media-fallback-glyph'));
		this.renderGlyph(glyph, kind, 'var(--bh-card-text-tertiary)', 24);
		const text = append(fallback, $('span.basehalf-canvas-card-media-fallback-label'));
		text.textContent = reload ? 'Preview unavailable' : label;
		if (reload) {
			text.title = label;
			const button = append(fallback, $('button.basehalf-canvas-card-media-reload')) as HTMLButtonElement;
			button.type = 'button';
			button.textContent = 'Reload preview';
			button.title = `Reload preview for ${label}`;
			button.addEventListener('pointerdown', event => event.stopPropagation());
			button.addEventListener('click', event => {
				event.preventDefault();
				event.stopPropagation();
				reload();
			}, { once: true });
		}
	}

	private renderFolderPreview(container: HTMLElement, preview: Extract<BaseHalfCanvasCardPreview, { readonly kind: 'folder' }>, description: string | undefined): void {
		if (preview.total === 0) {
			const empty = append(container, $('span.basehalf-canvas-folder-empty'));
			empty.textContent = 'Empty folder';
		} else {
			const list = append(container, $('.basehalf-canvas-folder-preview-list'));
			for (const child of preview.items) {
				const row = append(list, $('.basehalf-canvas-folder-preview-row'));
				const glyph = append(row, $('.basehalf-canvas-folder-preview-glyph'));
				this.renderGlyph(glyph, badgeType(child.name, child.kind === 'folder'), child.kind === 'folder' ? 'var(--bh-card-folder-glyph)' : 'var(--bh-card-text-tertiary)', 12);
				const label = append(row, $('.basehalf-canvas-folder-preview-label'));
				const name = baseHalfItemDisplayName(child.name, child.kind === 'folder');
				label.textContent = child.kind === 'folder' ? `${name}/` : name;
				label.classList.toggle('folder', child.kind === 'folder');
			}
			const remaining = preview.total - preview.items.length;
			if (remaining > 0) {
				const more = append(list, $('.basehalf-canvas-folder-preview-more'));
				more.textContent = `+${remaining} more`;
			}
		}
		if (description) {
			const note = append(container, $('.basehalf-canvas-folder-note'));
			note.textContent = description;
		}
	}

	renderStaticMarkdownPreview(
		container: HTMLElement,
		item: IBaseHalfCanvasItem,
		text: string,
		listeners: DisposableStore
	): void {
		this.renderStaticMarkdownSource(container, item.stat.resource, text, listeners);
	}

	renderStaticMarkdownSource(
		container: HTMLElement,
		resource: URI,
		text: string,
		listeners: DisposableStore
	): void {
		const { body } = splitBaseHalfMarkdownFrontmatter(text);
		if (!body.trim()) {
			const empty = append(container, $('span.basehalf-canvas-note-empty'));
			empty.textContent = localize('basehalf.canvas.note.empty', "Double-click to edit");
			return;
		}
		const rendering = renderBaseHalfCanvasNoteInParts(
			container,
			resource,
			text,
			href => this.openStaticMarkdownPreviewLink(href)
		);
		if (rendering) {
			listeners.add(rendering);
		} else {
			appendCanvasNoteFullEditorLabel(container);
		}
	}

	/** The text of a note whose whole projection its card holds, if it holds one. */
	shownMarkdownPreview(path: string): string | undefined {
		const preview = this.view.renderedCardPreviewsByPath.get(path)?.preview;
		return preview?.kind === 'markdown' ? preview.text : undefined;
	}

	openStaticMarkdownPreviewLink(href: string): void {
		const folder = this.view.getCurrentFolder();
		if (!folder) {
			return;
		}
		let resource: URI;
		try {
			resource = URI.parse(href).with({ query: null, fragment: null });
		} catch {
			return;
		}
		if (!this.view.uriIdentityService.extUri.isEqualOrParent(resource, folder.workspaceFolder)) {
			return;
		}
		void this.view.canvasNavigationService.openResource(resource, { source: 'api', pinned: true })
			.catch(error => this.view.logService.error(error));
	}

	/** Open a workspace-relative path in BaseHalf navigation — via the rendered
	 *  canvas item when it is on the current canvas, else straight from the URI
	 *  (a cross-folder reference target is still one click away). */
	openWorkspaceRelative(workspaceFolder: URI, relativePath: string): void {
		const rendered = this.view.renderedItemsByPath.get(relativePath);
		if (rendered?.generation?.draft) {
			// A draft has no file to open: its card is selected, where its panel is.
			this.view.selectionActions.selectCard(relativePath);
			return;
		}
		const resource = rendered?.stat.resource ?? (relativePath ? URI.joinPath(workspaceFolder, ...relativePath.split('/')) : workspaceFolder);
		void this.view.canvasNavigationService.openResource(resource, { source: 'api', pinned: true });
	}

	/** A folder card's coverage heat: how many of its DIRECT children carry a
	 *  human note. Rendered only once something is annotated — an untouched
	 *  folder stays clean. Direct children (this canvas's granularity), not a
	 *  recursive census, so rendering never walks the workspace. */
	private renderFolderCoverage(container: HTMLElement, item: IBaseHalfCanvasItem, preview: BaseHalfCanvasCardPreview | undefined): void {
		if (item.kind !== 'folder' || preview?.kind !== 'folder' || preview.total === 0) {
			return;
		}

		const childPrefix = `${item.path}/`;
		let noted = 0;
		for (const [path, badge] of this.view.renderedBadges) {
			if (badge.description && path.startsWith(childPrefix) && !path.slice(childPrefix.length).includes('/')) {
				noted++;
			}
		}
		if (noted === 0) {
			return;
		}

		const share = Math.min(1, noted / preview.total);
		const coverage = append(container, $('.basehalf-canvas-card-coverage'));
		coverage.title = `${noted} of ${preview.total} annotated`;
		const fill = append(coverage, $('.basehalf-canvas-card-coverage-fill'));
		fill.style.width = `${Math.max(6, Math.round(share * 100))}%`;
	}
}

/** The name of a card without its extension, which names what is made from it: `shot.mp4` is `shot`. */
export function baseHalfCanvasCardBaseName(name: string): string {
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(0, dot) : name;
}
