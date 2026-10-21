/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import '../media/basehalfCanvasCard.css';
import '../media/basehalfCanvasCardPreview.css';
import { $, append, clearNode } from '../../../../../base/browser/dom.js';
import { DisposableStore, MutableDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { basename, dirname, joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { FileAccess } from '../../../../../base/common/network.js';
import { localize } from '../../../../../nls.js';
import { Parts } from '../../../../services/layout/browser/layoutService.js';
import { findValidPasteFileTargetForResource } from '../../../../contrib/files/browser/fileActions.js';
import { IFilesConfiguration } from '../../../../contrib/files/common/files.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { baseHalfCanvasItemBounds, IBaseHalfCanvasBounds, IBaseHalfCanvasItem } from '../../common/basehalfCanvasModel.js';
import { IBaseHalfCanvasFolderState } from '../../../navigation/common/basehalfCanvasNavigation.js';
import { baseHalfItemDisplayName, isBaseHalfMarkdownResource } from '../../../cardDetail/common/basehalfCardDetail.js';
import { BaseHalfItemGlyph, renderBaseHalfItemGlyph } from '../../../shell/browser/basehalfItemGlyph.js';
import {
	BASEHALF_NODE_DOCUMENT_EXTENSION,
	BASEHALF_NODE_DOCUMENT_MAX_BYTES,
	getBaseHalfNodeResultArtifact,
	IBaseHalfNodeDocument,
	importBaseHalfNodeResult,
	parseBaseHalfNodeDocumentBytes,
	serializeBaseHalfNodeDocument
} from '../../../video/common/basehalfNodeDocument.js';
import { baseHalfCanvasContentKindForPath, baseHalfNodeAcceptsContentKind } from '../../common/basehalfCanvasContentKind.js';
import { baseHalfVideoNodePhase, IBaseHalfNodeArtifact } from '../../../video/common/basehalfVideoNode.js';
import { IBaseHalfVideoCard, IBaseHalfVideoCardInput, renderBaseHalfVideoCard } from '../../../video/browser/basehalfVideoCard.js';
import { captureBaseHalfVideoFrame, createBaseHalfVideoFrameReader } from '../../../video/browser/basehalfVideoFrameCapture.js';
import { baseHalfVideoCardToolbarActions } from '../../../video/common/basehalfVideoCardPresentation.js';
import { BaseHalfCanvasCardPresentation } from '../../common/basehalfCanvasCardPresentation.js';
import { splitBaseHalfMarkdownFrontmatter } from '../../../markdown/common/basehalfMarkdownProjection.js';
import { renderBaseHalfCanvasNoteInParts } from '../basehalfCanvasNoteParts.js';
import { rememberBaseHalfVideoDetailNode } from '../../../cardDetail/browser/basehalfMediaCardDetail.js';
import { releaseBaseHalfCanvasCardMedia } from '../basehalfCanvasCardMedia.js';
import {
	BaseHalfCanvasSceneCardControls,
	BaseHalfCanvasSceneVideoAction,
	BaseHalfCanvasSceneVideoFrame,
	BaseHalfCanvasNoteBackground,
	BASEHALF_CANVAS_NOTE_DEFAULT_FORMAT_STATE,
	IBaseHalfCanvasSceneCardPresentation
} from '../../common/basehalfCanvasScene.js';
import { BaseHalfCanvasCardPreview, BaseHalfCanvasNodePreview } from '../../common/basehalfCanvasCardPreview.js';
import { IBaseHalfWorkspaceMutationStamp } from '../../../workspace/common/basehalfWorkspaceMutation.js';
import type { BaseHalfCanvasWorkbenchContribution } from '../basehalfCanvasWorkbench.contribution.js';
import { BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_HEIGHT, BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_WIDTH, appendCanvasNoteFullEditorLabel, badgeType, baseHalfReferenceLabel, canvasResultNodeKindLabel, cardDisplayName, isVideoNodePreview } from './basehalfCanvasViewShared.js';

type BaseHalfCanvasGlyphType = BaseHalfItemGlyph;

function nodeResultLabel(document: IBaseHalfNodeDocument, outputText?: string): string {
	const text = outputText?.trim().replace(/\s+/g, ' ');
	if (text) {
		return text.length > 240 ? `${text.slice(0, 237)}...` : text;
	}
	const artifact = getBaseHalfNodeResultArtifact(document);
	if (artifact) {
		return baseHalfReferenceLabel(artifact.path);
	}
	return localize('basehalf.canvas.node.empty', "Empty");
}

function nodePreviewResultLabel(preview: Extract<BaseHalfCanvasCardPreview, { readonly kind: 'node' }>): string {
	if (preview.document.result && preview.resultMissing) {
		return localize('basehalf.canvas.node.missing', "The file is missing");
	}
	return preview.verificationPending && !!preview.document.result
		? localize('basehalf.canvas.node.checking', "Checking the file…")
		: nodeResultLabel(preview.document, preview.resultOutputText);
}

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
 * note, a file, media, a folder, or a node, including Video cards and their
 * actions.
 *
 * A part of the canvas view (README.md in this folder): it keeps its own state,
 * and reaches the state the view shares and the other parts through `view`.
 */
export class BaseHalfCanvasCardRenderer {
	/** The drawn Video cards, for the time their players show. */
	private readonly videoCards = new Map<string, IBaseHalfVideoCard>();
	/** The Video card drawn in each card element. */
	private readonly videoCardBodies = new WeakMap<HTMLElement, IBaseHalfVideoCard>();

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
			throw new Error(localize('basehalf.canvas.video.actionUnavailable', "That video action is no longer available."));
		}
		this.view.markCanvasUserInteraction();
		switch (action) {
			case 'importResult':
				await this.importCanvasNodeResult(item);
				return;
			case 'openFullPreview': {
				const video = this.videoFileOf(item, preview);
				if (video) {
					rememberBaseHalfVideoDetailNode(video, item.stat.resource);
				}
				await this.view.selectionActions.openResultNodeContent(folder, item);
				return;
			}
			case 'revealVideo': {
				const video = this.videoFileOf(item, preview);
				if (video) {
					await this.view.commandService.executeCommand('revealFileInOS', video);
				}
				return;
			}
			case 'captureFrame':
				await this.captureVideoFrame(folder, item, preview, frame ?? 'first');
				return;
		}
	}

	sceneCardControls(item: IBaseHalfCanvasItem, preview: BaseHalfCanvasCardPreview | undefined): BaseHalfCanvasSceneCardControls | undefined {
		if (isBaseHalfMarkdownResource(item.stat.resource)) {
			return {
				kind: 'note',
				formatState: this.view.canvasNoteFormatStates.get(this.view.uriIdentityService.extUri.getComparisonKey(item.stat.resource)) ?? BASEHALF_CANVAS_NOTE_DEFAULT_FORMAT_STATE,
				background: this.view.renderedNoteBackgrounds.get(item.path) ?? 'default'
			};
		}
		if (preview?.kind === 'nodeLoading') {
			return { kind: 'pending' };
		}
		if (preview?.kind !== 'node' || preview.document.kind !== 'video') {
			return undefined;
		}
		if (preview.dirty || (preview.document.result && preview.verificationPending)) {
			return { kind: 'video', actions: Object.freeze([]) };
		}
		return {
			kind: 'video',
			actions: baseHalfVideoCardToolbarActions(preview.document, {
				generating: this.view.videoGenerationService.isGenerating(item.stat.resource),
				videoExists: preview.resultMissing ? false : undefined
			})
		};
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
		structuralStamp: IBaseHalfWorkspaceMutationStamp,
		sceneKey: string
	): HTMLElement {
		const card = $('.basehalf-canvas-card');
		// The element this one replaces stays on screen, with its listeners,
		// until the scene mounts this one.
		const listeners = this.view.cardListenerStores.replace(item.path, card);
		const presentationListeners = new MutableDisposable<DisposableStore>();
		listeners.add(presentationListeners);
		const displayName = cardDisplayName(item, preview);
		const resultNode = item.name.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION);
		const markdownNote = isBaseHalfMarkdownResource(item.stat.resource);
		card.tabIndex = 0;
		card.setAttribute('role', 'group');
		card.dataset.basehalfCardPath = item.path;
		card.dataset.cardHeight = String(bounds.height);
		const badgeOpen = this.view.openBadgeFaces.has(item.path);
		card.dataset.previewLevel = 'shell';
		card.dataset.projection = badgeOpen ? 'badge' : 'preview';
		card.classList.add(item.kind);
		card.classList.toggle('badge-open', badgeOpen);
		card.setAttribute('aria-label', `${displayName} card`);
		card.title = resultNode
			? `${item.path} - click to select; double-click to open the file it shows`
			: item.kind === 'folder'
			? `${item.path} - click to select; double-click to enter this folder`
			: markdownNote
				? `${item.path} - click to select; double-click the content to edit`
				: `${item.path} - click to select; double-click to open the editor`;

		const type = preview?.kind === 'node' ? preview.document.kind : preview?.kind === 'nodeLoading' ? 'generic' : badgeType(item.name, item.kind === 'folder');
		if (preview?.kind === 'node') {
			card.dataset.nodeKind = preview.document.kind;
			card.classList.add(`node-kind-${preview.document.kind}`);
		}
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
		const canShowBadgeFace = !(item.kind === 'folder' && orphan);
		const caption = append(card, $('.basehalf-canvas-card-caption'));
		const captionIdentity = append(caption, $('.basehalf-canvas-card-caption-identity'));
		const icon = append(captionIdentity, $('.basehalf-canvas-card-caption-icon'));
		icon.setAttribute('aria-hidden', 'true');
		this.renderGlyph(icon, type, glyphTone(type, orphan), 15);
		const label = append(captionIdentity, $('.basehalf-canvas-card-label'));
		label.textContent = displayName;
		label.title = displayName;
		label.classList.toggle('danger', orphan);
		// The name is the file name of a file that is there: a double click on
		// it renames in place. A video card shows the title of its document.
		label.classList.toggle('renamable', !orphan && !resultNode);
		if (!orphan && !resultNode) {
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

		// What the card shows. The card of a Video node takes the new state of its
		// node in place (retainVideoNodeCard).
		const shown = { item, preview };
		let renderedPresentation: BaseHalfCanvasCardPresentation | undefined;
		let renderedHeight: number | undefined;
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
			// A Video card that is selected or deselected keeps its player: only
			// the player's controls come and go.
			if (renderedPresentation !== undefined && renderedPresentation !== 'shell' && presentationLevel !== 'shell'
				&& !badgeOpen && isVideoNodePreview(shown.preview) && this.videoCardBodies.has(card)) {
				renderedPresentation = presentationLevel;
				card.dataset.previewLevel = presentationLevel;
				this.updateVideoNodePreview(card, shown.item, shown.preview, presentationLevel === 'interactive');
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
				this.renderCardPreview(body, shown.item, shown.preview, orphan, presentationLevel === 'interactive', nextListeners, card);
			}
			this.renderFolderCoverage(active, shown.item, shown.preview);
			this.view.badgeEditor.restorePendingCanvasBadgeFocus(card, item.path);
		};
		this.view.cardPresentationUpdaters.set(card, updatePresentation);
		if (isVideoNodePreview(preview)) {
			this.view.videoCardRetainers.set(card, (nextItem, nextPreview) => {
				shown.item = nextItem;
				shown.preview = nextPreview;
				const name = cardDisplayName(nextItem, nextPreview);
				label.textContent = name;
				label.title = name;
				if (renderedPresentation !== undefined && renderedPresentation !== 'shell' && !badgeOpen) {
					this.updateVideoNodePreview(card, nextItem, nextPreview, renderedPresentation === 'interactive');
				}
			});
		}
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
				if (resultNode) {
					this.view.selectionActions.selectCard(item.path);
					const folder = this.view.getCurrentFolder();
					if (folder) {
						this.view.selectionActions.cancelPendingNodeActivation();
						void this.view.selectionActions.openResultNodeContent(folder, item);
					}
				} else if (markdownNote) {
					this.view.selectionActions.selectCard(item.path);
					void this.view.noteEditing.beginSceneNoteEdit(sceneKey, structuralStamp.structuralEpoch, item.path);
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
		preview: BaseHalfCanvasCardPreview | undefined
	): IBaseHalfCanvasBounds {
		const bounds = baseHalfCanvasItemBounds(item, index, total);
		if (!item.card && preview?.kind === 'node' && preview.document.kind === 'video') {
			return {
				...bounds,
				width: BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_WIDTH,
				height: BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_HEIGHT
			};
		}
		return bounds;
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
		card: HTMLElement
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
		if (preview.kind === 'folder') {
			this.renderFolderPreview(previewNode, preview, item.badge?.description);
			return;
		}
		if (preview.kind === 'markdown') {
			this.view.noteEditing.renderMarkdownPreview(previewNode, item, preview.text, listeners, card);
			return;
		}
		if (preview.kind === 'media') {
			this.renderMediaPreview(previewNode, preview, interactive, listeners);
			return;
		}
		if (preview.kind === 'node') {
			this.renderNodePreview(previewNode, item, preview, interactive, listeners, card);
			return;
		}
		if (preview.kind === 'invalidNode') {
			this.renderInvalidNodePreview(previewNode, item, preview.text, listeners);
			return;
		}
		previewNode.textContent = preview.text;
	}

	private renderInvalidNodePreview(container: HTMLElement, item: IBaseHalfCanvasItem, message: string, listeners: DisposableStore): void {
		const title = append(container, $('.basehalf-canvas-invalid-node-title'));
		title.textContent = localize('basehalf.canvas.node.unreadable', "Unreadable node");
		const detail = append(container, $('.basehalf-canvas-invalid-node-message'));
		detail.textContent = message;
		const action = append(container, $('button.basehalf-canvas-invalid-node-action')) as HTMLButtonElement;
		action.classList.add('nodrag', 'nopan', 'nowheel');
		action.type = 'button';
		action.textContent = 'Open source';
		action.title = 'Open the local JSON source without changing it';
		listeners.add(this.view.addDisposableListener(action, 'pointerdown', event => event.stopPropagation()));
		listeners.add(this.view.addDisposableListener(action, 'dblclick', event => {
			event.preventDefault();
			event.stopPropagation();
		}));
		listeners.add(this.view.addDisposableListener(action, 'click', event => {
			event.preventDefault();
			event.stopPropagation();
			void this.view.canvasNavigationService.openResource(item.stat.resource, {
				source: 'api',
				pinned: true,
				projection: 'source'
			});
		}));
	}

	private renderNodePreview(
		container: HTMLElement,
		item: IBaseHalfCanvasItem,
		preview: Extract<BaseHalfCanvasCardPreview, { readonly kind: 'node' }>,
		interactive: boolean,
		listeners: DisposableStore,
		card: HTMLElement
	): void {
		card.dataset.nodeLifecycle = preview.document.result ? 'result' : preview.document.task ? 'task' : 'empty';
		if (preview.document.kind === 'video') {
			this.renderVideoNodePreview(container, item, preview, interactive, listeners, card);
			return;
		}
		const result = append(container, $('.basehalf-canvas-node-result'));
		const resultLabel = append(result, $('.basehalf-canvas-node-result-label'));
		resultLabel.textContent = localize('basehalf.canvas.node.result', "Result");
		if (preview.resultMedia) {
			const media = append(result, $('.basehalf-canvas-node-result-media'));
			this.renderMediaPreview(media, { kind: 'media', ...preview.resultMedia }, interactive, listeners);
		} else {
			const resultValue = append(result, $('.basehalf-canvas-node-result-value'));
			resultValue.textContent = nodePreviewResultLabel(preview);
			resultValue.title = resultValue.textContent;
		}
		this.renderNodeActions(container, item, preview, listeners);
	}

	/**
	 * The card of a Video node, drawn by the Video card module in every phase
	 * (video node, "The card"). The card follows a generation in this window by
	 * itself, and continues one that the node's file records and no window
	 * follows.
	 */
	private renderVideoNodePreview(
		container: HTMLElement,
		item: IBaseHalfCanvasItem,
		preview: BaseHalfCanvasNodePreview,
		interactive: boolean,
		listeners: DisposableStore,
		card: HTMLElement
	): void {
		const handle = renderBaseHalfVideoCard(container, this.videoCardInput(item, preview, interactive), { hoverService: this.view.hoverService, generationService: this.view.videoGenerationService });
		listeners.add(handle);
		this.videoCards.set(item.path, handle);
		this.videoCardBodies.set(card, handle);
		listeners.add(toDisposable(() => {
			if (this.videoCards.get(item.path) === handle) {
				this.videoCards.delete(item.path);
			}
			if (this.videoCardBodies.get(card) === handle) {
				this.videoCardBodies.delete(card);
			}
		}));
		this.applyVideoNodeCardState(card, preview);
	}

	/** Shows a newer state of a Video node, or the card selected or not, in the Video card drawn in `card`. */
	private updateVideoNodePreview(card: HTMLElement, item: IBaseHalfCanvasItem, preview: BaseHalfCanvasNodePreview, interactive: boolean): void {
		const handle = this.videoCardBodies.get(card);
		if (!handle) {
			return;
		}
		card.dataset.nodeLifecycle = preview.document.result ? 'result' : preview.document.task ? 'task' : 'empty';
		handle.update(this.videoCardInput(item, preview, interactive));
		this.applyVideoNodeCardState(card, preview);
	}

	private videoCardInput(item: IBaseHalfCanvasItem, preview: BaseHalfCanvasNodePreview, interactive: boolean): IBaseHalfVideoCardInput {
		const video = this.videoFileOf(item, preview);
		return {
			resource: item.stat.resource,
			title: preview.document.title,
			fields: preview.document,
			...(video ? { video } : {}),
			...(preview.resultMissing ? { videoExists: false } : {}),
			interactive
		};
	}

	private applyVideoNodeCardState(card: HTMLElement, preview: BaseHalfCanvasNodePreview): void {
		card.dataset.videoPhase = baseHalfVideoNodePhase(preview.document);
		card.classList.toggle('empty-video-draft', card.dataset.videoPhase === 'empty');
		card.setAttribute('aria-label', localize('basehalf.canvas.videoCard.label', "{0}, Video", preview.document.title));
	}

	/** The video file a Video node shows, in its workspace folder. */
	private videoFileOf(item: IBaseHalfCanvasItem, preview: BaseHalfCanvasCardPreview | undefined): URI | undefined {
		if (preview?.kind !== 'node' || !preview.document.result) {
			return undefined;
		}
		const workspaceFolder = this.view.workspaceContextService.getWorkspaceFolder(item.stat.resource)?.uri;
		return workspaceFolder ? joinPath(workspaceFolder, ...preview.document.result.artifact.path.split('/')) : undefined;
	}

	/** Capture Frame: writes the frame as a PNG beside the node; its card appears to the right of the video card. */
	private async captureVideoFrame(folder: IBaseHalfCanvasFolderState, item: IBaseHalfCanvasItem, preview: BaseHalfCanvasCardPreview | undefined, frame: BaseHalfCanvasSceneVideoFrame): Promise<void> {
		const video = this.videoFileOf(item, preview);
		if (!video || preview?.kind !== 'node') {
			return;
		}
		let image: URI;
		try {
			image = await captureBaseHalfVideoFrame(this.view.fileService, {
				video,
				node: item.stat.resource,
				title: preview.document.title,
				frame,
				currentTime: this.videoCards.get(item.path)?.currentTime
			}, createBaseHalfVideoFrameReader(mainWindow));
		} catch (error) {
			this.view.logService.warn(error);
			this.view.queueCanvasWarning(localize('basehalf.canvas.video.captureFailed', "BaseHalf could not capture that frame: {0}", error instanceof Error ? error.message : String(error)));
			this.view.requestRender();
			return;
		}
		await this.view.creation.placeNewCardBeside(folder, item.path, image);
	}

	/**
	 * The one action of an image, audio, file, PDF, or presentation node: an
	 * empty node takes a file the user brings in, and a node with a file opens it.
	 */
	private renderNodeActions(
		container: HTMLElement,
		item: IBaseHalfCanvasItem,
		preview: Extract<BaseHalfCanvasCardPreview, { readonly kind: 'node' }>,
		listeners: DisposableStore
	): void {
		const document = preview.document;
		const actions = append(container, $('.basehalf-canvas-node-actions'));
		const action = append(actions, $('button.basehalf-canvas-node-action')) as HTMLButtonElement;
		action.classList.add('nodrag', 'nopan', 'nowheel');
		action.type = 'button';
		const opens = !!document.result;
		action.textContent = opens
			? localize('basehalf.canvas.node.open', "Open")
			: localize('basehalf.canvas.node.import', "Import {0}", canvasResultNodeKindLabel(document.kind));
		const unavailable = opens ? preview.resultMissing === true : preview.dirty;
		action.setAttribute('aria-disabled', String(unavailable));
		action.title = opens && preview.resultMissing
			? localize('basehalf.canvas.node.fileMissing', "The file this node shows is missing: {0}", document.result?.artifact.path ?? '')
			: action.textContent;
		action.setAttribute('aria-label', action.title);
		listeners.add(this.view.addDisposableListener(action, 'pointerdown', event => event.stopPropagation()));
		listeners.add(this.view.addDisposableListener(action, 'dblclick', event => {
			event.preventDefault();
			event.stopPropagation();
		}));
		listeners.add(this.view.addDisposableListener(action, 'click', event => {
			event.preventDefault();
			event.stopPropagation();
			if (action.getAttribute('aria-disabled') === 'true') {
				return;
			}
			this.view.selectionActions.selectCard(item.path);
			const folder = this.view.getCurrentFolder();
			if (opens && folder) {
				void this.view.selectionActions.openResultNodeContent(folder, item);
			} else if (!opens) {
				void this.importCanvasNodeResult(item);
			}
		}));
	}

	/**
	 * Brings a file the user chooses into an empty node as its result (Upload
	 * Video for a Video node): the file is copied to `assets/<node id>/` in the
	 * workspace folder and the node records it. Only a node with no result and,
	 * for a Video node, no generation takes one.
	 */
	private async importCanvasNodeResult(item: IBaseHalfCanvasItem): Promise<void> {
		const folder = this.view.getCurrentFolder();
		if (!folder || this.view.canvasNavigationService.state.cardDetail) {
			return;
		}
		try {
			if (this.view.workingCopyService.isDirty(item.stat.resource)) {
				throw new Error(localize('basehalf.canvas.import.dirty', "Save {0} before importing a file into it.", item.name));
			}
			const content = await this.view.fileService.readFile(item.stat.resource, {
				atomic: true,
				limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES }
			});
			const document = parseBaseHalfNodeDocumentBytes(content.value.buffer);
			if (document.result || document.task) {
				throw new Error(localize('basehalf.canvas.import.notEmpty', "{0} already shows a file or has a generation. Import into a new empty node.", document.title));
			}
			await this.importNodeResult(folder, item, content.value, document);
		} catch (error) {
			this.view.logService.warn(error);
			this.view.queueCanvasWarning(error instanceof Error ? error.message : String(error));
			this.view.requestRender();
		}
	}

	private async importNodeResult(
		folder: IBaseHalfCanvasFolderState,
		item: IBaseHalfCanvasItem,
		expectedContents: VSBuffer,
		document: IBaseHalfNodeDocument
	): Promise<void> {
		const importLabel = localize('basehalf.canvas.node.import', "Import {0}", canvasResultNodeKindLabel(document.kind));
		const resources = await this.view.fileDialogService.showOpenDialog({
			title: importLabel,
			openLabel: importLabel,
			defaultUri: folder.resource,
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: false
		});
		const source = resources?.[0];
		if (!source) {
			return;
		}
		try {
			if (this.view.workingCopyService.isDirty(item.stat.resource)) {
				throw new Error(localize('basehalf.canvas.import.dirty', "Save {0} before importing a file into it.", item.name));
			}
			const stat = await this.view.fileService.resolve(source, { resolveMetadata: true });
			if (!stat.isFile || stat.isSymbolicLink) {
				throw new Error(localize('basehalf.canvas.import.notFile', "Choose a regular file."));
			}
			const importedKind = baseHalfCanvasContentKindForPath(basename(source), false);
			if (!baseHalfNodeAcceptsContentKind(document.kind, importedKind)) {
				throw new Error(localize('basehalf.canvas.import.wrongKind', "Choose a file of the node's kind. {0} is not one.", basename(source)));
			}
			const incrementalNaming = this.view.configurationService.getValue<IFilesConfiguration>().explorer.incrementalNaming;
			const target = await findValidPasteFileTargetForResource(
				this.view.fileService,
				this.view.dialogService,
				joinPath(folder.workspaceFolder, 'assets', document.id),
				{ resource: source, isDirectory: false, allowOverwrite: false },
				incrementalNaming === 'disabled' ? 'smart' : incrementalNaming
			);
			if (!target) {
				return;
			}
			const targetPath = this.view.uriIdentityService.extUri.relativePath(folder.workspaceFolder, target);
			if (!targetPath || await this.view.fileService.exists(target)) {
				throw new Error(localize('basehalf.canvas.import.targetTaken', "The file could not be copied into this folder."));
			}
			const copied = await this.view.fileService.copy(source, target, false);
			const artifact: IBaseHalfNodeArtifact = { kind: document.kind, path: targetPath, size: copied.size };
			try {
				await this.view.fileService.writeFileWithExpectedContents(
					item.stat.resource,
					VSBuffer.fromString(serializeBaseHalfNodeDocument(importBaseHalfNodeResult(document, artifact))),
					expectedContents,
					{ atomic: { postfix: '.basehalf-node-import-tmp' } }
				);
			} catch (error) {
				throw new Error(localize('basehalf.canvas.import.changed', "{0} changed before the import could be saved. The copied file {1} was kept.", item.name, targetPath), { cause: error });
			}
			this.view.contextViewService.hideContextView();
			this.view.requestRender();
		} catch (error) {
			this.view.logService.warn(error);
			this.view.queueCanvasWarning(error instanceof Error ? error.message : String(error));
			this.view.requestRender();
		}
	}

	async openNodeArtifactPath(folder: IBaseHalfCanvasFolderState, path: string): Promise<void> {
		const resource = joinPath(folder.workspaceFolder, ...path.split('/'));
		this.view.contextViewService.hideContextView();
		try {
			await this.view.fileService.resolve(resource);
			await this.view.canvasNavigationService.openResource(resource, { source: 'api', pinned: true });
		} catch {
			this.view.layoutService.setPartHidden(false, Parts.SIDEBAR_PART);
			await this.view.explorerService.select(dirname(resource), 'force');
			this.view.queueCanvasWarning(`The recorded output '${path}' is missing.`);
			this.view.requestRender();
		}
	}

	private renderMediaPreview(
		container: HTMLElement,
		preview: Extract<BaseHalfCanvasCardPreview, { readonly kind: 'media' }>,
		interactive: boolean,
		listeners: DisposableStore
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
				this.renderMediaFallback(container, preview.text, 'image', () => {
					clearNode(container);
					this.renderMediaPreview(container, preview, interactive, listeners);
				});
			}, { once: true });
			return;
		}
			if (preview.mediaKind === 'video') {
				const video = append(container, $('video.basehalf-canvas-card-media-visual')) as HTMLVideoElement;
			video.src = FileAccess.uriToBrowserUri(preview.resource).toString(true);
			video.preload = 'metadata';
			video.controls = interactive;
			video.tabIndex = interactive ? 0 : -1;
				if (interactive) {
					video.classList.add('nodrag', 'nopan', 'nowheel');
				}
			video.playsInline = true;
			if (interactive) {
				video.setAttribute('aria-label', localize('basehalf.canvas.videoPreview.player', "Video player for {0}", preview.text));
				} else {
					video.setAttribute('aria-hidden', 'true');
					video.style.pointerEvents = 'none';
				}
			listeners.add(toDisposable(() => releaseBaseHalfCanvasCardMedia(video)));
			if (interactive) {
				this.configureCardMediaTransport(video);
			}
			video.addEventListener('error', () => {
				video.remove();
				this.renderMediaFallback(container, preview.text, 'video', () => {
					clearNode(container);
					this.renderMediaPreview(container, preview, interactive, listeners);
				});
			}, { once: true });
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
					this.renderMediaPreview(container, preview, interactive, listeners);
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
		media.addEventListener('play', () => {
			for (const other of this.view.cards.querySelectorAll<HTMLMediaElement>('video, audio')) {
				if (other !== media && !other.paused) {
					other.pause();
				}
			}
		});
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
		const resource = rendered?.stat.resource ?? (relativePath ? joinPath(workspaceFolder, ...relativePath.split('/')) : workspaceFolder);
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
