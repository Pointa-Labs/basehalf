/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import '../media/basehalfCanvasCard.css';
import '../media/basehalfCanvasCardPreview.css';
import { $, append, clearNode } from '../../../../../base/browser/dom.js';
import { DisposableStore, MutableDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { basename, dirname, isEqual } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { FileAccess } from '../../../../../base/common/network.js';
import { localize } from '../../../../../nls.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { baseHalfCanvasChildPath, baseHalfCanvasItemBounds, baseHalfCanvasShowsDocument, IBaseHalfCanvasBounds, IBaseHalfCanvasItem } from '../../common/basehalfCanvasModel.js';
import { IBaseHalfCanvasFolderState } from '../../../navigation/common/basehalfCanvasNavigation.js';
import { baseHalfItemDisplayName, isBaseHalfMarkdownResource } from '../../../cardDetail/common/basehalfCardDetail.js';
import { BaseHalfItemGlyph, renderBaseHalfItemGlyph } from '../../../shell/browser/basehalfItemGlyph.js';
import { baseHalfPathHoldsDraft } from '../../../video/common/basehalfGenerationDraft.js';
import { IBaseHalfGenerationCardFace, renderBaseHalfGenerationCardFace } from '../../../video/browser/basehalfVideoCard.js';
import { captureBaseHalfVideoFrame, createBaseHalfVideoFrameReader } from '../../../video/browser/basehalfVideoFrameCapture.js';
import { baseHalfGenerationCardToolbarActions, baseHalfGenerationPhase, IBaseHalfGenerationCardPresentation } from '../../../video/common/basehalfVideoCardPresentation.js';
import { BaseHalfCanvasCardPresentation } from '../../common/basehalfCanvasCardPresentation.js';
import { splitBaseHalfMarkdownFrontmatter } from '../../../markdown/common/basehalfMarkdownProjection.js';
import { renderBaseHalfCanvasNoteInParts } from '../basehalfCanvasNoteParts.js';
import { whenBaseHalfCanvasMediaDrawn } from '../basehalfCanvasCardMedia.js';
import { createBaseHalfCanvasCardVideoPlayer, IBaseHalfCanvasCardVideoPlayer } from '../basehalfCanvasCardVideoPlayer.js';
import { IBaseHalfCanvasCardDocumentFace, renderBaseHalfCanvasCardDocument } from '../basehalfCanvasCardDocument.js';
import { baseHalfDocumentVersion } from '../../../documents/common/basehalfDocuments.js';
import { setBaseHalfHover } from '../../../shell/browser/basehalfHover.js';
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
	/** The face drawn last for each generation card, while it is drawn. */
	private readonly generationFaces = new Map<string, IBaseHalfGenerationCardFace>();
	/** Where each card element draws its badge toggle, to draw it again in place when only its connections change. */
	private readonly badgeToggles = new WeakMap<HTMLElement, { readonly container: HTMLElement; readonly listeners: DisposableStore; readonly issueCount: number }>();
	/** The face of the PDF or the book drawn in each card element, and its cover toggle, which a click changes in place. */
	private readonly documentFaces = new WeakMap<HTMLElement, IBaseHalfCanvasCardDocumentFace>();
	private readonly coverToggles = new WeakMap<HTMLElement, () => void>();

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
			case 'openFullPreview':
				// Open shows the card large, as a double click does; its video pauses.
				this.playerOf(path)?.pause();
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
	 * actions of its phase now, and the card whether it takes a connection,
	 * without drawing the canvas again.
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
		// A draft that starts generating takes no connection until it is done (D67).
		const upstreamRefusal = this.view.connections.sceneUpstreamRefusal(item, this.view.renderedUpstreamRefusals);
		if (JSON.stringify(controls) === JSON.stringify(card.controls) && upstreamRefusal === card.upstreamRefusal) {
			return;
		}
		const { upstreamRefusal: _previous, ...rest } = card;
		const next = { ...rest, controls, ...(upstreamRefusal ? { upstreamRefusal } : {}) };
		this.view.renderedSceneCards = Object.freeze(this.view.renderedSceneCards.map(candidate => candidate === card ? next : candidate));
		this.view.canvasScene.update({
			key: this.view.sceneKey(folder),
			structuralEpoch: this.view.renderedSceneStructuralEpoch,
			revision: this.view.renderSeq,
			cards: this.view.renderedSceneCards,
			edges: this.view.renderedSceneEdges
		});
	}

	/**
	 * Draws a card's badge toggle again for the connections the card has now,
	 * in place: a change of connections alone keeps the card (canvas card
	 * interaction continuity, "A change of connections").
	 */
	refreshBadgeToggle(card: HTMLElement, item: IBaseHalfCanvasItem): void {
		const toggle = this.badgeToggles.get(card);
		if (!toggle) {
			return;
		}
		toggle.listeners.clear();
		clearNode(toggle.container);
		this.view.badgeEditor.renderCardBadgeToggle(toggle.container, item, toggle.issueCount, toggle.listeners);
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
		if (!orphan && baseHalfCanvasShowsDocument(item)) {
			// Before the badge toggle, in a box of its own, so that the badge toggle is drawn again without it.
			this.renderCoverToggle(append(captionActions, $('.basehalf-canvas-card-cover-toggle-slot')), item, card, displayName, listeners);
		}
		if (canShowBadgeFace) {
			const toggleListeners = listeners.add(new DisposableStore());
			const badgeSlot = append(captionActions, $('.basehalf-canvas-card-badge-toggle-slot'));
			this.view.badgeEditor.renderCardBadgeToggle(badgeSlot, item, badgeIssueCount, toggleListeners);
			this.badgeToggles.set(card, { container: badgeSlot, listeners: toggleListeners, issueCount: badgeIssueCount });
		}
		const content = append(card, $('.basehalf-canvas-card-content'));
		this.view.creation.renderInlineRenameEditor(card, item);
		this.view.renderedCardElementsByPath.set(item.path, card);
		// The card of a file that was just saved says Saving until its picture can be drawn.
		let carried = item.generation && !draft ? this.generationFaces.get(item.path)?.saving : undefined;

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
				this.renderCardPreview(body, item, preview, orphan, presentationLevel === 'interactive', nextListeners, card, openCard, carried, () => { carried = undefined; });
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
		open: () => void,
		carried?: IBaseHalfGenerationCardPresentation,
		drawn?: () => void
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
		if (carried && item.generation && preview?.kind !== 'media') {
			// The picture of a file that was just saved is on its way: the card keeps saying Saving.
			previewNode.classList.remove(previewKindClass);
			previewNode.classList.add('kind-generation');
			this.trackGenerationFace(item.path, listeners, renderBaseHalfGenerationCardFace(previewNode, this.carriedFaceInput(item, carried), this.generationFaceServices()));
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
		if (preview.kind === 'media' && (preview.mediaKind === 'pdf' || preview.mediaKind === 'book')) {
			this.renderDocumentPreview(previewNode, item, preview, listeners, card);
			return;
		}
		if (preview.kind === 'media') {
			// A generation card with its file shows its image or its video as the
			// card of any such file does; one that cannot be shown says so.
			const unshowable = item.generation ? () => this.renderGenerationFace(previewNode, item, listeners) : undefined;
			// One whose file was just saved says Saving over its picture until the
			// picture can be drawn, so that the card goes from Saving straight to it.
			const cover = item.generation && carried && (preview.mediaKind === 'image' || preview.mediaKind === 'video')
				? this.renderSavingCover(previewNode, item, carried, listeners)
				: undefined;
			this.renderMediaPreview(previewNode, preview, interactive, listeners, open, card, unshowable, cover ? () => {
				cover.dispose();
				drawn?.();
			} : undefined);
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
		this.trackGenerationFace(item.path, listeners, renderBaseHalfGenerationCardFace(container, {
			resource: item.stat.resource,
			path: item.path,
			name: item.name,
			kind: item.generation.kind,
			hasFile: !item.generation.draft
		}, this.generationFaceServices()));
	}

	/**
	 * Draws what the face of a generation card showed while its file was saved
	 * over the card's picture, which is still loading: the cover is disposed
	 * once the picture can be drawn, or with the card's body.
	 */
	private renderSavingCover(container: HTMLElement, item: IBaseHalfCanvasItem, carried: IBaseHalfGenerationCardPresentation, listeners: DisposableStore): DisposableStore {
		const cover = new DisposableStore();
		listeners.add(cover);
		const host = append(container, $('.basehalf-canvas-card-saving-cover'));
		host.setAttribute('aria-hidden', 'true');
		cover.add(toDisposable(() => host.remove()));
		this.trackGenerationFace(item.path, cover, renderBaseHalfGenerationCardFace(host, this.carriedFaceInput(item, carried), this.generationFaceServices()));
		return cover;
	}

	/** The face of the card of a file that was just saved, which shows what the card showed while it was saved. */
	private carriedFaceInput(item: IBaseHalfCanvasItem, carried: IBaseHalfGenerationCardPresentation) {
		return {
			resource: item.stat.resource,
			path: item.path,
			name: item.name,
			kind: item.generation?.kind ?? 'video',
			hasFile: true,
			carried
		};
	}

	/** Keeps the face as the one drawn last for the card while it is drawn, for the drawing that replaces it. */
	private trackGenerationFace(path: string, store: DisposableStore, face: IBaseHalfGenerationCardFace): void {
		store.add(face);
		this.generationFaces.set(path, face);
		store.add(toDisposable(() => {
			if (this.generationFaces.get(path) === face) {
				this.generationFaces.delete(path);
			}
		}));
	}

	private generationFaceServices() {
		return {
			hoverService: this.view.hoverService,
			generationService: this.view.videoGenerationService,
			taskStore: this.view.generationTaskStore
		};
	}

	/** The player of the video that the card of `path` shows, while it shows one. */
	private playerOf(path: string): IBaseHalfCanvasCardVideoPlayer | undefined {
		const element = this.view.renderedCardElementsByPath.get(path);
		return element ? this.mediaVideoPlayers.get(element) : undefined;
	}

	/**
	 * Capture Frame: writes the frame as a PNG into the card's folder, named
	 * after the card and the frame; its card appears to the right of the video
	 * card, connected from it (generation cards, "The toolbar").
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
		// The frame comes from the video: its upstream list names the video (D67).
		const framePath = baseHalfCanvasChildPath(folder.relativePath, basename(image));
		try {
			await this.view.referenceEditService.add(this.view.workspaceNode(folder.workspaceFolder, framePath, 'file'), item.path, {
				label: localize('basehalf.canvas.video.captureConnect', "Capture Frame")
			});
		} catch (error) {
			this.view.logService.warn(`[BaseHalf] the frame ${framePath} was not connected from ${item.path}`, error);
		}
		this.view.requestRender();
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
		unshowable?: () => void,
		drawn?: () => void
	): void {
		container.classList.add(`media-${preview.mediaKind}`);
		if (preview.mediaKind === 'image') {
			const image = $('img.basehalf-canvas-card-media-visual') as HTMLImageElement;
			// Below the cover of a file that was just saved, when there is one.
			container.insertBefore(image, container.firstChild);
			image.alt = '';
			image.draggable = false;
			image.loading = 'lazy';
			if (drawn) {
				whenBaseHalfCanvasMediaDrawn(image, listeners, drawn);
			}
			image.src = FileAccess.uriToBrowserUri(preview.resource).toString(true);
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
		if (preview.mediaKind === 'video' || preview.mediaKind === 'audio') {
			// A video or a sound plays as in the player of every card that shows one (generation cards, "The player").
			const kind = preview.mediaKind;
			const player = createBaseHalfCanvasCardVideoPlayer(container, container.firstChild, {
				source: preview.resource,
				videoClasses: ['basehalf-canvas-card-media-visual'],
				sound: kind === 'audio',
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
					this.renderMediaFallback(container, preview.text, kind, () => {
						clearNode(container);
						this.renderMediaPreview(container, preview, interactive, listeners, open, card);
					});
				},
				hoverService: this.view.hoverService
			});
			player.setSelected(interactive);
			listeners.add(player);
			if (drawn) {
				whenBaseHalfCanvasMediaDrawn(player.video, listeners, drawn);
			}
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
		this.renderMediaFallback(container, preview.text, preview.mediaKind);
	}

	/**
	 * The face of the card of a PDF or a book: its cover, or the grey face
	 * while the cover is hidden (PDFs and books, "The card"). `card` is the
	 * card element, whose cover toggle changes the face in place.
	 */
	private renderDocumentPreview(
		container: HTMLElement,
		item: IBaseHalfCanvasItem,
		preview: Extract<BaseHalfCanvasCardPreview, { readonly kind: 'media' }>,
		listeners: DisposableStore,
		card: HTMLElement
	): void {
		container.classList.add(`media-${preview.mediaKind}`);
		const face = listeners.add(renderBaseHalfCanvasCardDocument(container, {
			resource: item.stat.resource,
			version: baseHalfDocumentVersion(item.stat),
			coverShown: !this.view.renderedHiddenCovers.has(item.path),
			coverService: this.view.documentCoverService,
			renderGlyph: glyph => this.renderGlyph(glyph, preview.mediaKind, 'var(--bh-card-text-tertiary)', 24)
		}));
		this.documentFaces.set(card, face);
		listeners.add(toDisposable(() => {
			if (this.documentFaces.get(card) === face) {
				this.documentFaces.delete(card);
			}
		}));
	}

	/**
	 * The button at the right end of the caption of a PDF's or a book's card
	 * that hides or shows its cover (PDFs and books, "Hiding and showing the
	 * cover"). A click changes the card's face in place and keeps the choice in
	 * the card's `appearance.yaml`; the selection does not change.
	 */
	private renderCoverToggle(container: HTMLElement, item: IBaseHalfCanvasItem, card: HTMLElement, displayName: string, listeners: DisposableStore): void {
		const button = append(container, $('button.basehalf-canvas-card-cover-toggle')) as HTMLButtonElement;
		button.classList.add('nodrag', 'nopan', 'nowheel');
		button.type = 'button';
		const paint = () => {
			const shown = !this.view.renderedHiddenCovers.has(item.path);
			clearNode(button);
			this.renderGlyph(button, shown ? 'coverShown' : 'coverHidden', 'var(--bh-card-text-tertiary)', 15);
			setBaseHalfHover(button, shown ? localize('basehalf.canvas.cover.hide', "Hide Cover") : localize('basehalf.canvas.cover.show', "Show Cover"));
			button.setAttribute('aria-label', shown
				? localize('basehalf.canvas.cover.hideAria', "Hide the cover of {0}", displayName)
				: localize('basehalf.canvas.cover.showAria', "Show the cover of {0}", displayName));
			button.setAttribute('aria-pressed', String(shown));
			button.classList.toggle('hidden-cover', !shown);
		};
		paint();
		this.coverToggles.set(card, paint);
		listeners.add(toDisposable(() => {
			if (this.coverToggles.get(card) === paint) {
				this.coverToggles.delete(card);
			}
		}));
		// The button takes no part in moving or selecting the card.
		listeners.add(this.view.addDisposableListener(button, 'pointerdown', event => event.stopPropagation()));
		listeners.add(this.view.addDisposableListener(button, 'dblclick', event => {
			event.preventDefault();
			event.stopPropagation();
		}));
		listeners.add(this.view.addDisposableListener(button, 'click', event => {
			event.preventDefault();
			event.stopPropagation();
			void this.toggleCover(item, card);
		}));
	}

	private async toggleCover(item: IBaseHalfCanvasItem, card: HTMLElement): Promise<void> {
		const folder = this.view.getCurrentFolder();
		if (!folder) {
			return;
		}
		this.view.markCanvasUserInteraction();
		const hidden = !this.view.renderedHiddenCovers.has(item.path);
		this.setCoverHidden(item.path, card, hidden);
		try {
			await this.view.canvasAppearanceService.setCover(folder.workspaceFolder, item.path, hidden ? 'hidden' : 'shown');
		} catch (error) {
			this.view.logService.warn(`[BaseHalf] the cover of ${item.path} could not be ${hidden ? 'hidden' : 'shown'}`, error);
			this.setCoverHidden(item.path, card, !hidden);
			this.view.queueCanvasWarning(hidden
				? localize('basehalf.canvas.cover.hideFailed', "BaseHalf could not hide the cover of {0}.", cardDisplayName(item))
				: localize('basehalf.canvas.cover.showFailed', "BaseHalf could not show the cover of {0}.", cardDisplayName(item)));
			this.view.requestRender();
		}
	}

	/** Shows or hides a card's cover in place, and keeps the card's element for the next drawing. */
	private setCoverHidden(path: string, card: HTMLElement, hidden: boolean): void {
		const next = new Set(this.view.renderedHiddenCovers);
		if (hidden) {
			next.add(path);
		} else {
			next.delete(path);
		}
		this.view.renderedHiddenCovers = next;
		this.documentFaces.get(card)?.setCoverShown(!hidden);
		this.coverToggles.get(card)?.();
		const cached = this.view.renderedCardsByPath.get(path);
		if (cached?.element === card) {
			this.view.renderedCardsByPath.set(path, { ...cached, visualKey: this.view.renderer.cardVisualKey(cached.item) });
		}
	}

	private renderMediaFallback(container: HTMLElement, label: string, kind: 'image' | 'video' | 'audio' | 'pdf' | 'book', reload?: () => void): void {
		if (container.querySelector('.basehalf-canvas-card-media-fallback')) {
			return;
		}
		const fallback = append(container, $('.basehalf-canvas-card-media-fallback'));
		const glyph = append(fallback, $('.basehalf-canvas-card-media-fallback-glyph'));
		this.renderGlyph(glyph, kind, 'var(--bh-card-text-tertiary)', 24);
		const text = append(fallback, $('span.basehalf-canvas-card-media-fallback-label'));
		text.textContent = reload ? 'Preview unavailable' : label;
		if (reload) {
			const button = append(fallback, $('button.basehalf-canvas-card-media-reload')) as HTMLButtonElement;
			button.type = 'button';
			button.textContent = 'Reload preview';
			button.setAttribute('aria-label', `Reload preview for ${label}`);
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
		coverage.setAttribute('role', 'img');
		coverage.setAttribute('aria-label', `${noted} of ${preview.total} annotated`);
		const fill = append(coverage, $('.basehalf-canvas-card-coverage-fill'));
		fill.style.width = `${Math.max(6, Math.round(share * 100))}%`;
	}
}

/** The name of a card without its extension, which names what is made from it: `shot.mp4` is `shot`. */
export function baseHalfCanvasCardBaseName(name: string): string {
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(0, dot) : name;
}
