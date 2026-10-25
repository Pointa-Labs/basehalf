/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import '../media/basehalfCanvasCardDetail.css';
import * as DOM from '../../../../../base/browser/dom.js';
import { $, append, clearNode } from '../../../../../base/browser/dom.js';
import { InputBox, MessageType } from '../../../../../base/browser/ui/inputbox/inputBox.js';
import { IKeyboardEvent } from '../../../../../base/browser/keyboardEvent.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { basename, dirname, extname, joinPath } from '../../../../../base/common/resources.js';
import { raceTimeout } from '../../../../../base/common/async.js';
import { ResourceFileEdit } from '../../../../../editor/browser/services/bulkEditService.js';
import { localize } from '../../../../../nls.js';
import { IFileStat } from '../../../../../platform/files/common/files.js';
import { defaultInputBoxStyles } from '../../../../../platform/theme/browser/defaultStyles.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { IBaseHalfCardDetailState } from '../../../navigation/common/basehalfCanvasNavigation.js';
import { baseHalfCanvasInlineEditKeyAction } from '../../common/basehalfCanvasEditing.js';
import { BaseHalfCardDetailProjection, baseHalfItemDisplayName, baseHalfNoteFileName, baseHalfNoteNameExtension, isBaseHalfMarkdownResource } from '../../../cardDetail/common/basehalfCardDetail.js';
import { IBaseHalfAgentSelectionDocumentText, IBaseHalfAgentSelectionText } from '../../../agentArea/common/basehalfAgentSelection.js';
import { BaseHalfMarkdownPreviewCardDetail } from '../../../cardDetail/browser/basehalfMarkdownPreviewCardDetail.js';
import { BaseHalfMarkdownRichCardDetail } from '../../../cardDetail/browser/basehalfMarkdownRichCardDetail.js';
import { BaseHalfSourceCardDetail } from '../../../cardDetail/browser/basehalfSourceCardDetail.js';
import { IBaseHalfCardDetailSurfaceInstance } from '../../../cardDetail/browser/basehalfCardDetailSurface.js';
import { BaseHalfMediaCardDetail } from '../../../cardDetail/browser/basehalfMediaCardDetail.js';
import { setBaseHalfHover } from '../../../shell/browser/basehalfHover.js';
import { BaseHalfStructuralResourceOutcome } from '../../../workspace/common/basehalfWorkspaceMutation.js';
import type { BaseHalfCanvasWorkbenchContribution } from '../basehalfCanvasWorkbench.contribution.js';
import { BASEHALF_CARD_DETAIL_DRAWN_WAIT_MS, BaseHalfCardDetailTransition } from './basehalfCanvasCardDetailTransition.js';

type BaseHalfCardDetailSaveStatus = 'saving' | 'saved' | 'error';

interface IBaseHalfCardDetailSurface {
	readonly host: HTMLElement;
	readonly store: DisposableStore;
	readonly instance: IBaseHalfCardDetailSurfaceInstance;
	readonly whenRendered: Promise<unknown>;
}

/**
 * Card Detail inside the canvas: its header, title, and save status, the
 * projections that draw a file, and keeping the open item when it is renamed
 * or moved.
 *
 * A part of the canvas view (README.md in this folder): it keeps its own state,
 * and reaches the state the view shares and the other parts through `view`.
 */
export class BaseHalfCanvasCardDetailHost {
	private readonly detailChromeDisposables = this.view.register(new DisposableStore());
	private readonly detailTitleDisposables = this.view.register(new DisposableStore());
	private detailBadgeResourceKey: string | undefined;
	private readonly detailSurfaces = new Map<BaseHalfCardDetailProjection, IBaseHalfCardDetailSurface>();
	private detailSurfaceResourceKey: string | undefined;
	private detailSwapSeq = 0;
	private detailIdentityReconcileSeq = 0;
	private detailIdentityPendingResourceKey: string | undefined;
	private pendingDetailNameEditResourceKey: string | undefined;
	private pendingDetailEditorFocusResourceKey: string | undefined;
	/** Card Detail fades in and out where it is (opening and closing Card Detail). */
	private readonly transition = new BaseHalfCardDetailTransition();
	/** A projection that was not drawn when Card Detail faded in: it stays out of the transition. */
	private surfaceOutOfTransition: HTMLElement | undefined;
	/** Card Detail that has opened, and where the keyboard was then, until it takes the keyboard. */
	private keyboardPending: { readonly cardDetail: IBaseHalfCardDetailState; readonly activeAtOpen: Element | null } | undefined;
	private drewOnce = false;

	constructor(private readonly view: BaseHalfCanvasWorkbenchContribution) { }

	async reconcileRetainedDetailIdentity(
		openedDetail: IBaseHalfCardDetailState,
		effect: Exclude<BaseHalfStructuralResourceOutcome, { readonly kind: 'none' }>
	): Promise<void> {
		const resourceKey = openedDetail.resource.toString();
		if (this.view.canvasNavigationService.state.cardDetail !== openedDetail) {
			return;
		}

		const seq = ++this.detailIdentityReconcileSeq;
		this.detailIdentityPendingResourceKey = resourceKey;
		this.view.badgeEditor.flushBadgeDescriptionWrite(openedDetail.workspaceFolder, openedDetail.relativePath);
		this.view.detailResourceMutationStamp = undefined;
		this.detailBadgeResourceKey = undefined;
		this.view.detailBadgeOpen = false;
		this.view.detailBadgeRefreshAfterFocusLeaves = false;
		this.view.detailBadgeSeq++;
		this.view.detailBadgeDisposables.clear();
		clearNode(this.view.detailBadgeZone);
		this.detailChromeDisposables.clear();
		this.detailTitleDisposables.clear();
		clearNode(this.view.detailProjectionActions);
		this.disposeDetailSurfaces();
		this.setDetailSaveStatus(undefined);

		if (effect.kind === 'close') {
			await this.closeInvalidatedDetail(seq, resourceKey, openedDetail);
			return;
		}

		const nextResource = effect.kind === 'move' ? effect.resource : openedDetail.resource;
		let stat: IFileStat;
		try {
			stat = await this.view.fileService.resolve(nextResource);
		} catch {
			await this.closeInvalidatedDetail(seq, resourceKey, openedDetail);
			return;
		}
		if (!this.isPendingDetailIdentity(seq, resourceKey, openedDetail)) {
			return;
		}
		if (!stat.isFile) {
			await this.closeInvalidatedDetail(seq, resourceKey, openedDetail);
			return;
		}

		if (effect.kind === 'move') {
			const result = await this.view.canvasNavigationService.openCardDetail(nextResource, {
				source: openedDetail.source,
				selection: openedDetail.selection,
				preserveFocus: openedDetail.preserveFocus,
				pinned: openedDetail.pinned,
				projection: openedDetail.projection,
				history: 'replace',
				expectedCardDetail: openedDetail
			});
			if (!result.handled && this.isPendingDetailIdentity(seq, resourceKey, openedDetail)) {
				await this.closeInvalidatedDetail(seq, resourceKey, openedDetail);
			}
			return;
		}

		// No member touching this URI completed. Rebuild only after the URI has
		// been resolved as a file; the old retained model/webview never inherits
		// a freshly captured generation.
		this.detailIdentityPendingResourceKey = undefined;
		this.view.requestRender();
	}

	private isPendingDetailIdentity(
		seq: number,
		resourceKey: string,
		openedDetail: IBaseHalfCardDetailState
	): boolean {
		return !this.view.disposed
			&& seq === this.detailIdentityReconcileSeq
			&& this.detailIdentityPendingResourceKey === resourceKey
			&& this.view.canvasNavigationService.state.cardDetail === openedDetail;
	}

	private async closeInvalidatedDetail(
		seq: number,
		resourceKey: string,
		openedDetail: IBaseHalfCardDetailState
	): Promise<void> {
		if (!this.isPendingDetailIdentity(seq, resourceKey, openedDetail)) {
			return;
		}
		await this.view.canvasNavigationService.closeCardDetail({ history: 'replace', expectedCardDetail: openedDetail });
	}

	/**
	 * Draws Card Detail as navigation has it. When it opens or closes, it
	 * fades in or out where it is, and the window shows the canvas until Card
	 * Detail is drawn (opening and closing Card Detail).
	 */
	renderDetail(): void {
		if (this.transition.drawing) {
			// The transition that started draws Card Detail as it is then.
			return;
		}
		const cardDetail = this.view.canvasNavigationService.state.cardDetail;
		const shown = this.view.detail.classList.contains('visible');
		if (this.drewOnce && !!cardDetail !== shown && this.transition.run({
			direction: cardDetail ? 'open' : 'close',
			detail: this.view.detail,
			draw: () => this.drawDetail(true),
			// Closing shows the canvas under Card Detail as it is.
			ready: () => cardDetail ? this.whenDetailDrawn() : Promise.resolve(),
			// Waiting for Card Detail decides itself what to do when it is late, a little sooner.
			wait: BASEHALF_CARD_DETAIL_DRAWN_WAIT_MS + 50,
			reducedMotion: this.view.accessibilityService.isMotionReduced(),
			finished: () => {
				this.surfaceOutOfTransition?.style.removeProperty('visibility');
				this.surfaceOutOfTransition = undefined;
				this.giveKeyboard();
			},
			onError: error => this.view.logService.error(error instanceof Error ? error : new Error(String(error)))
		})) {
			return;
		}
		this.drawDetail(false);
	}

	/**
	 * Card Detail shows its file: the projection that is shown has drawn it.
	 * One that does not draw in transitions, or is not drawn in time, stays
	 * out of the transition and shows itself once it is over
	 * (`drawsInTransitions`).
	 */
	private async whenDetailDrawn(): Promise<void> {
		const projection = this.view.activeDetailProjection;
		const surface = projection ? this.detailSurfaces.get(projection) : undefined;
		if (!surface) {
			return;
		}
		const drawn = surface.instance.drawsInTransitions === true
			&& await raceTimeout(surface.whenRendered.then(() => true), BASEHALF_CARD_DETAIL_DRAWN_WAIT_MS);
		if (!drawn) {
			surface.host.style.visibility = 'hidden';
			this.surfaceOutOfTransition = surface.host;
		}
	}

	/**
	 * Card Detail that has opened takes the keyboard once its projection is
	 * drawn and its transition is over, unless it was opened to keep the
	 * keyboard where it was, or the keyboard has gone into Card Detail or out
	 * of the canvas since (opening and closing Card Detail, "The keyboard").
	 */
	private giveKeyboard(): void {
		const pending = this.keyboardPending;
		this.keyboardPending = undefined;
		const surface = pending && this.detailSurfaces.get(pending.cardDetail.projection);
		if (!pending || !surface) {
			return;
		}
		void surface.whenRendered.then(() => {
			const ownerDocument = this.view.detail.ownerDocument;
			const active = ownerDocument.activeElement;
			const inDetail = !!active && active !== this.view.detail && this.view.detail.contains(active);
			const elsewhere = !!active && active !== pending.activeAtOpen && active !== ownerDocument.body && !this.view.root.contains(active);
			if (this.view.disposed || inDetail || elsewhere
				|| this.view.canvasNavigationService.state.cardDetail?.resource.toString() !== pending.cardDetail.resource.toString()
				|| this.detailSurfaces.get(pending.cardDetail.projection) !== surface) {
				return;
			}
			surface.instance.focus?.();
		});
	}

	/** `fromTransition`: drawn by a transition, after the drawing of the canvas that asked for it. */
	private drawDetail(fromTransition: boolean): void {
		this.drewOnce = true;
		const cardDetail = this.view.canvasNavigationService.state.cardDetail;
		const opening = !!cardDetail && !this.view.detail.classList.contains('visible');
		const chromeHidden = !!cardDetail || !this.view.getCurrentFolder();
		if (chromeHidden) {
			this.view.onDidHideViewControlsEmitter.fire();
		}
		this.view.detail.classList.toggle('visible', !!cardDetail);
		this.view.createButton.classList.toggle('hidden', chromeHidden);
		this.view.chrome.classList.toggle('hidden', chromeHidden);
		if (cardDetail) {
			this.view.fileDragDepth = 0;
			this.view.root.classList.remove('basehalf-canvas-file-dragging');
		}
		this.syncDetailScrollLock(!!cardDetail);
		if (!cardDetail) {
			this.keyboardPending = undefined;
			// The keyboard that was in Card Detail goes back to the canvas.
			const active = this.view.detail.ownerDocument.activeElement;
			const hadKeyboard = !!active && active !== this.view.detail && this.view.detail.contains(active);
			this.pendingDetailNameEditResourceKey = undefined;
			this.pendingDetailEditorFocusResourceKey = undefined;
			this.view.detail.inert = false;
			this.view.detail.removeAttribute('aria-busy');
			this.detailIdentityReconcileSeq++;
			this.detailIdentityPendingResourceKey = undefined;
			const wasOpen = this.detailSurfaceResourceKey !== undefined;
			this.view.detailBadgeOpen = false;
			this.view.detailBadgeRefreshAfterFocusLeaves = false;
			this.detailBadgeResourceKey = undefined;
			this.view.detailResourceMutationStamp = undefined;
			this.disposeDetailSurfaces();
			this.detailChromeDisposables.clear();
			this.detailTitleDisposables.clear();
			this.view.detailBadgeSeq++;
			this.view.detailBadgeDisposables.clear();
			clearNode(this.view.detailBadgeZone);
			this.setDetailSaveStatus(undefined);
			clearNode(this.view.detailProjectionActions);
			// Projection surfaces own and remove their hosts on dispose; there is
			// deliberately no document-less rich editor parked in this container.
			clearNode(this.view.detailTitle);
			this.view.detailMeta.textContent = '';
			if (wasOpen) {
				// Selected Notes were rendered as static previews underneath the detail
				// surface. Recreate the retained cards of notes once so the static
				// selected Note and its controls are current when detail closes. The
				// pictures of images and videos stay as they are: drawn anew, a video
				// shows no picture until it loads again (opening and closing Card Detail).
				let redrawn = false;
				for (const [path, card] of this.view.renderedCardsByPath) {
					if (isBaseHalfMarkdownResource(card.item.stat.resource)) {
						this.view.renderedCardsByPath.delete(path);
						redrawn = true;
					}
				}
				if (fromTransition && redrawn) {
					// The drawing that closed Card Detail has drawn the canvas already.
					this.view.requestRender();
				}
			}
			if (hadKeyboard) {
				this.view.cards.focus({ preventScroll: true });
			}
			return;
		}

		const resourceKey = cardDetail.resource.toString();
		if (this.detailIdentityPendingResourceKey && this.detailIdentityPendingResourceKey !== resourceKey) {
			this.detailIdentityReconcileSeq++;
			this.detailIdentityPendingResourceKey = undefined;
		}
		if (this.detailIdentityPendingResourceKey === resourceKey) {
			return;
		}
		this.syncDetailMutationFence();

		this.renderDetailTitle(cardDetail);
		this.view.detailMeta.textContent = this.detailSelectionMetaFor(cardDetail.selection);
		this.renderProjectionActions(cardDetail);
		const detailBadgeResourceKey = resourceKey;
		if (this.detailBadgeResourceKey !== detailBadgeResourceKey) {
			// A detail switch owns a new badge focus/defer lifecycle. Retire the
			// previous resource's listeners before its focused prompt can suppress
			// the first render of the new badge.
			this.view.detailBadgeSeq++;
			this.view.detailBadgeDisposables.clear();
			this.view.detailBadgeRefreshAfterFocusLeaves = false;
			clearNode(this.view.detailBadgeZone);
			this.detailBadgeResourceKey = detailBadgeResourceKey;
			this.view.detailResourceMutationStamp = this.view.workspaceMutationCoordinator.captureResource(cardDetail.workspaceFolder, cardDetail.relativePath);
			this.view.detailBadgeOpen = false;
		}
		void this.view.badgeEditor.renderDetailBadge(cardDetail);

		this.renderDetailSurface(cardDetail);
		this.focusPendingDetailEditor(cardDetail);
		if (opening && !cardDetail.preserveFocus) {
			this.keyboardPending = { cardDetail, activeAtOpen: this.view.detail.ownerDocument.activeElement };
		}
		if (!this.transition.running) {
			// A transition gives it once it is over: a projection shows itself only then.
			this.giveKeyboard();
		}
	}

	reconcileCardProjectionRegistrations(): void {
		if (this.view.disposed) {
			return;
		}
		const cardDetail = this.view.canvasNavigationService.state.cardDetail;
		if (!cardDetail) {
			this.view.requestRender();
			return;
		}

		const normalized = this.view.cardProjectionRegistryService.normalizeProjection(cardDetail.resource, cardDetail.projection);
		const projection = this.view.cardDetailSurfaceRegistryService.hasProvider(normalized) ? normalized : 'source';
		if (projection === cardDetail.projection) {
			this.view.requestRender();
			return;
		}

		void this.view.canvasNavigationService.openCardDetail(cardDetail.resource, {
			source: 'api',
			selection: cardDetail.selection,
			preserveFocus: cardDetail.preserveFocus,
			pinned: cardDetail.pinned,
			projection,
			history: 'replace'
		});
	}

	private renderDetailTitle(cardDetail: IBaseHalfCardDetailState): void {
		this.detailTitleDisposables.clear();
		clearNode(this.view.detailTitle);
		const resourceKey = cardDetail.resource.toString();
		if (this.pendingDetailNameEditResourceKey !== resourceKey) {
			const button = append(this.view.detailTitle, $('button.basehalf-card-detail-title-button')) as HTMLButtonElement;
			button.type = 'button';
			button.textContent = baseHalfItemDisplayName(basename(cardDetail.resource), false);
			button.setAttribute('aria-label', localize('basehalf.cardDetail.renameFile', "Rename {0}", baseHalfItemDisplayName(basename(cardDetail.resource), false)));
			this.detailTitleDisposables.add(this.view.addDisposableListener(button, 'click', () => {
				this.pendingDetailNameEditResourceKey = resourceKey;
				this.view.requestRender();
			}));
			return;
		}

		// A note is renamed by its name, as on its card (canvas card name).
		const fileName = basename(cardDetail.resource);
		const noteExtension = baseHalfNoteNameExtension(fileName);
		const fileNameOf = (typed: string) => noteExtension ? baseHalfNoteFileName(typed, noteExtension) : typed;
		const initialValue = baseHalfItemDisplayName(fileName, false);
		const inputHost = append(this.view.detailTitle, $('.basehalf-card-detail-title-input'));
		const inputBox = new InputBox(inputHost, this.view.contextViewService, {
			ariaLabel: localize('basehalf.cardDetail.nameInput', "File name. Press Enter to confirm or Escape to keep the current name."),
			inputBoxStyles: defaultInputBoxStyles
		});
		this.detailTitleDisposables.add(inputBox);
		inputBox.value = initialValue;
		let finishing = false;
		let validationSequence = 0;

		const validate = async (show: boolean): Promise<{ readonly content: string; readonly type: MessageType } | undefined> => {
			const sequence = ++validationSequence;
			const typed = inputBox.value;
			const result = await this.view.creation.validateCanvasEntryName(dirname(cardDetail.resource), typed.trim().length === 0 ? typed : fileNameOf(typed), cardDetail.resource);
			if (sequence === validationSequence && this.pendingDetailNameEditResourceKey === resourceKey && show) {
				if (result) {
					inputBox.showMessage({ content: result.content, type: result.type });
				} else {
					inputBox.hideMessage();
				}
			}
			return result;
		};

		const cancel = () => {
			if (this.pendingDetailNameEditResourceKey !== resourceKey) {
				return;
			}
			this.pendingDetailNameEditResourceKey = undefined;
			this.pendingDetailEditorFocusResourceKey = resourceKey;
			this.view.requestRender();
		};
		const finish = async (keepOpenOnError: boolean) => {
			if (finishing || this.pendingDetailNameEditResourceKey !== resourceKey) {
				return;
			}
			finishing = true;
			inputBox.disable();
			let validation: { readonly content: string; readonly type: MessageType } | undefined;
			try {
				validation = await validate(false);
			} catch (error) {
				validation = { content: error instanceof Error ? error.message : String(error), type: MessageType.ERROR };
			}
			if (this.pendingDetailNameEditResourceKey !== resourceKey) {
				return;
			}
			if (validation?.type === MessageType.ERROR) {
				finishing = false;
				if (!keepOpenOnError) {
					cancel();
					return;
				}
				inputBox.enable();
				inputBox.showMessage({ content: validation.content, type: validation.type }, true);
				inputBox.focus();
				return;
			}

			const name = fileNameOf(inputBox.value);
			if (inputBox.value === initialValue || name === fileName) {
				cancel();
				return;
			}
			const target = joinPath(dirname(cardDetail.resource), name);
			this.pendingDetailNameEditResourceKey = undefined;
			this.pendingDetailEditorFocusResourceKey = target.toString();
			try {
				// A step of the canvas's undo, as a rename on the canvas is.
				await this.view.explorerService.applyBulkEdit([new ResourceFileEdit(cardDetail.resource, target)], {
					undoLabel: localize('basehalf.cardDetail.rename.undo', "Rename {0} to {1}", fileName, name),
					progressLabel: localize('basehalf.cardDetail.rename.progress', "Renaming {0}", fileName),
					confirmBeforeUndo: this.view.creation.confirmExplorerUndo(),
					undoRedoSource: this.view.canvasUndoRedoSource
				});
			} catch (error) {
				this.pendingDetailEditorFocusResourceKey = undefined;
				this.pendingDetailNameEditResourceKey = resourceKey;
				finishing = false;
				if (inputBox.element.isConnected) {
					inputBox.enable();
					inputBox.showMessage({ content: error instanceof Error ? error.message : String(error), type: MessageType.ERROR }, true);
					inputBox.focus();
				} else {
					this.view.requestRender();
				}
			}
		};

		this.detailTitleDisposables.add(inputBox.onDidChange(() => void validate(true)));
		this.detailTitleDisposables.add(DOM.addStandardDisposableListener(inputBox.inputElement, DOM.EventType.KEY_DOWN, (event: IKeyboardEvent) => {
			event.stopPropagation();
			const browserEvent = event.browserEvent;
			const action = baseHalfCanvasInlineEditKeyAction({
				key: browserEvent.key === 'Enter' ? 'Enter' : browserEvent.key === 'Escape' || browserEvent.key === 'Esc' ? 'Escape' : '',
				isComposing: browserEvent.isComposing,
				keyCode: browserEvent.keyCode
			});
			if (!action) {
				return;
			}
			event.preventDefault();
			if (action === 'accept') {
				void finish(true);
			} else {
				cancel();
			}
		}));
		this.detailTitleDisposables.add(this.view.addDisposableListener(inputBox.inputElement, 'blur', () => {
			mainWindow.setTimeout(() => {
				if (inputBox.element.isConnected && !finishing && this.pendingDetailNameEditResourceKey === resourceKey
					&& inputBox.inputElement.ownerDocument.activeElement !== inputBox.inputElement) {
					void finish(false);
				}
			}, 0);
		}));
		mainWindow.setTimeout(() => {
			if (this.pendingDetailNameEditResourceKey !== resourceKey || !inputBox.element.isConnected) {
				return;
			}
			inputBox.focus();
			const extension = noteExtension ? '' : extname(cardDetail.resource);
			inputBox.select({ start: 0, end: extension.length > 0 ? initialValue.length - extension.length : initialValue.length });
		}, 0);
	}

	private focusPendingDetailEditor(cardDetail: IBaseHalfCardDetailState): void {
		const resourceKey = cardDetail.resource.toString();
		if (this.pendingDetailEditorFocusResourceKey !== resourceKey) {
			return;
		}
		this.pendingDetailEditorFocusResourceKey = undefined;
		const surface = this.detailSurfaces.get(cardDetail.projection);
		if (!surface) {
			return;
		}
		void surface.whenRendered.then(() => {
			if (this.view.canvasNavigationService.state.cardDetail?.resource.toString() !== resourceKey) {
				return;
			}
			surface.instance.focus?.();
		});
	}

	syncDetailMutationFence(): void {
		const detail = this.view.canvasNavigationService.state.cardDetail;
		const fenced = !!detail && this.view.workspaceMutationCoordinator.isResourceMutationFenced(detail.workspaceFolder, detail.relativePath);
		this.view.detail.inert = fenced;
		this.view.detail.toggleAttribute('aria-busy', fenced);
		for (const surface of this.detailSurfaces.values()) {
			surface.instance.setStructuralFrozen?.(fenced);
		}
		const activeNote = this.view.activeCanvasNoteEditor;
		if (activeNote) {
			const noteFenced = this.view.workspaceMutationCoordinator.isResourceMutationFenced(
				activeNote.state.workspaceFolder,
				activeNote.state.relativePath
			);
			activeNote.card.toggleAttribute('aria-busy', noteFenced);
			activeNote.instance.setStructuralFrozen(noteFenced);
		}
	}

	/**
	 * Projection surfaces are retained-mode objects (a webview is an
	 * out-of-process iframe, Monaco a heavyweight widget), so the card detail
	 * keeps one layered surface per projection of the open document instead
	 * of clearing and rebuilding on every switch. Retention is correct by
	 * construction: all projections are views over the same text model, and
	 * each already reconciles external content changes. Switching to a
	 * retained projection is an instant layer swap; a first boot stays
	 * hidden until its open() resolves at the first meaningful frame, then
	 * swaps atomically — the previous projection stays visible throughout.
	 * Surfaces are disposed together when the card closes or the resource
	 * changes.
	 */
	private renderDetailSurface(cardDetail: IBaseHalfCardDetailState): void {
		const resourceKey = cardDetail.resource.toString();
		if (this.detailSurfaceResourceKey !== resourceKey) {
			this.disposeDetailSurfaces();
			this.detailSurfaceResourceKey = resourceKey;
		}

		const projection = cardDetail.projection;
		const existing = this.detailSurfaces.get(projection);
		if (existing) {
			if (this.view.activeDetailProjection === projection) {
				existing.instance.applySelection(cardDetail.selection);
			} else {
				this.detailSwapSeq++;
				existing.instance.activate(cardDetail);
				this.setActiveDetailSurface(projection);
			}
			return;
		}

		const seq = ++this.detailSwapSeq;
		const surface = this.createDetailSurface(projection, cardDetail);
		this.detailSurfaces.set(projection, surface);
		if (this.view.activeDetailProjection === undefined) {
			// First surface for this card: there is no previous content to
			// hold on screen, so show the boot immediately — opening responds
			// instantly, and a visible iframe loads at normal priority
			// (hidden ones are deprioritized, which starves a cold boot).
			this.setActiveDetailSurface(projection);
			return;
		}
		// Switching projections: hold the swap until the new surface has its
		// first frame, so the current projection stays visible throughout and
		// nothing half-drawn ever appears.
		void surface.whenRendered.then(() => {
			if (!this.view.disposed && seq === this.detailSwapSeq && this.detailSurfaces.get(projection) === surface) {
				this.setActiveDetailSurface(projection);
			}
		});
	}

	private createDetailSurface(projection: BaseHalfCardDetailProjection, cardDetail: IBaseHalfCardDetailState): IBaseHalfCardDetailSurface {
		const created = this.view.cardDetailSurfaceRegistryService.create(projection, this.view.detailBody, cardDetail);
		const { host, instance } = created;
		const store = new DisposableStore();
		store.add(toDisposable(() => host.remove()));
		store.add(instance);

		const whenRendered = instance.open(cardDetail).catch(error => this.view.logService.error(error));
		instance.setStructuralFrozen?.(this.view.workspaceMutationCoordinator.isResourceMutationFenced(cardDetail.workspaceFolder, cardDetail.relativePath));
		return { host, store, instance, whenRendered };
	}

	registerCardDetailSurfaceProviders(): void {
		this.view.register(this.view.cardDetailSurfaceRegistryService.registerProvider('rich', {
			create: (parent, state) => {
				const host = append(parent, $('.basehalf-card-detail-surface'));
				const instance = this.view.instantiationService.createInstance(
					BaseHalfMarkdownRichCardDetail,
					host,
					() => this.view.badgeEditor.closeDetailBadgePopover(state, false),
					status => this.setDetailSaveStatus(status),
					{
						onSelectionChange: selected => this.setAgentSelectionDetailText('rich', selected),
						onDetailCloseRequest: () => void this.view.canvasNavigationService.closeCardDetail()
					}
				);
				for (const command of this.view.noteEditing.takeMarkdownRichFormatCommands(state.resource)) {
					instance.runEditorCommand(command);
				}
				return {
					host,
					instance
				};
			}
		}));
		this.view.register(this.view.cardDetailSurfaceRegistryService.registerProvider('preview', {
			create: parent => {
				const host = append(parent, $('.basehalf-card-detail-surface'));
				return {
					host,
					instance: this.view.instantiationService.createInstance(
						BaseHalfMarkdownPreviewCardDetail,
						host,
						status => this.setDetailSaveStatus(status)
					)
				};
			}
		}));
		this.view.register(this.view.cardDetailSurfaceRegistryService.registerProvider('media', {
			create: parent => {
				const host = append(parent, $('.basehalf-card-detail-surface'));
				this.setDetailSaveStatus('saved');
				return {
					host,
					instance: this.view.instantiationService.createInstance(
						BaseHalfMediaCardDetail,
						host,
						(resource, selection) => this.view.creation.createDocumentBranch(resource, selection),
						() => this.view.markCanvasUserInteraction(),
						() => void this.view.canvasNavigationService.closeCardDetail(),
						selected => this.setAgentSelectionDetailText('media', selected),
						this.view.detailEditActions
					)
				};
			}
		}));
		this.view.register(this.view.cardDetailSurfaceRegistryService.registerProvider('source', {
			create: parent => {
				const host = append(parent, $('.basehalf-card-detail-surface'));
				return {
					host,
					instance: this.view.instantiationService.createInstance(
						BaseHalfSourceCardDetail,
						host,
						status => this.setDetailSaveStatus(status),
						selected => this.setAgentSelectionDetailText('source', selected)
					)
				};
			}
		}));
	}

	private setActiveDetailSurface(projection: BaseHalfCardDetailProjection): void {
		this.view.activeDetailProjection = projection;
		for (const [key, surface] of this.detailSurfaces) {
			const active = key === projection;
			surface.host.classList.toggle('active', active);
			surface.instance.setVisible(active);
		}
		// The projection shown now decides what agents can see.
		this.view.selectionActions.reportAgentSelection();
	}

	disposeDetailSurfaces(): void {
		this.detailSwapSeq++;
		this.view.activeDetailProjection = undefined;
		this.detailSurfaceResourceKey = undefined;
		for (const surface of this.detailSurfaces.values()) {
			surface.store.dispose();
		}
		this.detailSurfaces.clear();
		if (this.view.agentSelectionDetailText.size > 0) {
			this.view.agentSelectionDetailText.clear();
			this.view.selectionActions.reportAgentSelection();
		}
	}

	private setAgentSelectionDetailText(projection: BaseHalfCardDetailProjection, selected: IBaseHalfAgentSelectionText | IBaseHalfAgentSelectionDocumentText | undefined): void {
		if (selected) {
			this.view.agentSelectionDetailText.set(projection, selected);
		} else if (!this.view.agentSelectionDetailText.delete(projection)) {
			return;
		}
		this.view.selectionActions.reportAgentSelection();
	}

	private setDetailSaveStatus(status: BaseHalfCardDetailSaveStatus | undefined): void {
		if (status === 'error') {
			const label = 'Not saved';
			this.view.detailSaveStatusIcon.className = 'basehalf-card-detail-save-status-icon codicon codicon-warning';
			this.view.detailSaveStatusLabel.textContent = label;
			this.view.detailSaveStatus.setAttribute('data-save-state', 'error');
			this.view.detailSaveStatus.setAttribute('aria-label', 'Changes could not be saved to disk. Click to retry saving.');
			this.view.detailSaveStatus.removeAttribute('aria-hidden');
			return;
		}

		// 'saving'/'saved' intentionally render nothing: auto-save is the
		// product surface, not a status ticker.
		this.view.detailSaveStatusIcon.className = 'basehalf-card-detail-save-status-icon codicon';
		this.view.detailSaveStatusLabel.textContent = '';
		this.view.detailSaveStatus.removeAttribute('data-save-state');
		this.view.detailSaveStatus.removeAttribute('aria-label');
		this.view.detailSaveStatus.setAttribute('aria-hidden', 'true');
	}

	private syncDetailScrollLock(detailVisible: boolean): void {
		this.view.root.classList.toggle('basehalf-card-detail-open', detailVisible);
	}

	private renderProjectionActions(cardDetail: IBaseHalfCardDetailState): void {
		this.detailChromeDisposables.clear();
		clearNode(this.view.detailProjectionActions);
		const projections = this.view.cardProjectionRegistryService.getProjections(cardDetail.resource);
		this.view.detailProjectionActions.classList.toggle('visible', projections.length > 1);
		if (projections.length <= 1) {
			return;
		}

		for (const projection of projections) {
			this.renderProjectionButton(cardDetail, projection.id, projection.label, projection.icon);
		}
	}

	private renderProjectionButton(cardDetail: IBaseHalfCardDetailState, projection: BaseHalfCardDetailProjection, title: string, icon: string): void {
		const button = append(this.view.detailProjectionActions, $(`button.basehalf-card-detail-projection.codicon.${icon}`)) as HTMLButtonElement;
		button.type = 'button';
		setBaseHalfHover(button, title);
		button.setAttribute('aria-label', title);
		button.setAttribute('aria-pressed', String(cardDetail.projection === projection));
		button.classList.toggle('checked', cardDetail.projection === projection);
		this.detailChromeDisposables.add(this.view.addDisposableListener(button, 'click', () => {
			if (cardDetail.projection === projection) {
				return;
			}

			void this.view.canvasNavigationService.openCardDetail(cardDetail.resource, {
				source: 'api',
				selection: cardDetail.selection,
				preserveFocus: cardDetail.preserveFocus,
				pinned: cardDetail.pinned,
				projection,
				history: 'replace'
			});
		}));
	}

	private detailSelectionMetaFor(selection: { startLineNumber: number; startColumn: number } | undefined): string {
		if (!selection) {
			return '';
		}

		return `L${selection.startLineNumber}:${selection.startColumn}`;
	}
}
