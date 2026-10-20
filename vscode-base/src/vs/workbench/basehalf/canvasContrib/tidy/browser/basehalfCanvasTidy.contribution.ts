/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfCanvasTidy.css';
import { $, addDisposableListener, append, isEditableElement, isHTMLElement } from '../../../../../base/browser/dom.js';
import { status } from '../../../../../base/browser/ui/aria/aria.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../../base/common/platform.js';
import { localize } from '../../../../../nls.js';
import { IBaseHalfCanvasContribution, IBaseHalfCanvasContributionContext, IBaseHalfCanvasView, IBaseHalfCanvasViewScene, registerBaseHalfCanvasContribution } from '../../../canvas/browser/basehalfCanvasExtensions.js';
import { baseHalfCanvasTidy } from '../../../canvas/common/basehalfCanvasArrangement.js';
import { IBaseHalfCanvasCard } from '../../../canvas/common/basehalfCanvasModel.js';
import { IBaseHalfCanvasSceneGeometry, IBaseHalfCanvasSceneViewport } from '../../../canvas/common/basehalfCanvasScene.js';
import { IBaseHalfCanvasNavigationService } from '../../../navigation/common/basehalfCanvasNavigation.js';

/** The question after a tidy, and what it needs to put the cards back. */
interface IBaseHalfCanvasTidyQuestion {
	readonly token: number;
	readonly sceneKey: string;
	/** The rows of the cards that the tidy moved, as they were before it. */
	readonly previous: ReadonlyMap<string, IBaseHalfCanvasCard>;
	/** What the view showed before the tidy. */
	readonly viewport: IBaseHalfCanvasSceneViewport;
	readonly element: HTMLElement;
	readonly listeners: DisposableStore;
}

/**
 * Tidy Canvas (canvas selection and arrangement): its button among the view
 * controls and Shift+Alt+F lay out every card of the canvas along its
 * connections. When a card moved, a question asks whether to keep the result.
 */
export class BaseHalfCanvasTidy extends Disposable implements IBaseHalfCanvasContribution {
	static readonly ID = 'basehalf.canvas.tidy';

	private readonly canvas: IBaseHalfCanvasView;
	private readonly button: HTMLButtonElement;
	private running = false;
	private sequence = 0;
	private question: IBaseHalfCanvasTidyQuestion | undefined;

	constructor(
		context: IBaseHalfCanvasContributionContext,
		@IBaseHalfCanvasNavigationService private readonly canvasNavigationService: IBaseHalfCanvasNavigationService,
	) {
		super();
		this.canvas = context.canvas;
		this.button = append(this.canvas.viewControls, $('button.basehalf-canvas-chrome-button.basehalf-canvas-tidy')) as HTMLButtonElement;
		this.button.type = 'button';
		this.button.setAttribute('data-testid', 'canvas-tidy');
		const icon = append(this.button, $('span.codicon.codicon-type-hierarchy'));
		icon.setAttribute('aria-hidden', 'true');
		const label = localize('basehalf.canvas.tidy', "Tidy Canvas ({0})", isMacintosh ? '⇧⌥F' : localize('basehalf.canvas.tidyKey', "Shift+Alt+F"));
		this.button.title = label;
		this.button.setAttribute('aria-label', label);
		this._register(addDisposableListener(this.button, 'click', () => void this.tidy()));
		this._register(this.canvas.onKeyDown(event => this.onKeyDown(event)));
		this._register(this.canvas.onDidChangeScene(scene => this.onDidChangeScene(scene)));
		this._register(toDisposable(() => {
			this.closeQuestion();
			this.button.remove();
		}));
		this.updateButton(this.canvas.scene);
	}

	private onKeyDown(event: KeyboardEvent): void {
		if (!this.canvasNavigationService.state.cardDetail && event.shiftKey && event.altKey && !event.metaKey && !event.ctrlKey
			&& event.code === 'KeyF' && !event.isComposing
			&& !(isHTMLElement(event.target) && (isEditableElement(event.target) || event.target.isContentEditable))) {
			event.preventDefault();
			event.stopPropagation();
			void this.tidy();
		}
	}

	private onDidChangeScene(scene: IBaseHalfCanvasViewScene): void {
		this.updateButton(scene);
		if (this.question && this.question.sceneKey !== scene.key) {
			// The user left the canvas that was tidied: the result is kept.
			this.closeQuestion();
		}
	}

	private updateButton(scene: IBaseHalfCanvasViewScene): void {
		this.button.disabled = scene.cards.length < 2;
	}

	/**
	 * Lays out every card of the canvas along its connections (canvas selection
	 * and arrangement). It does not look at the selection. When a card moved,
	 * the user is asked whether to keep the result.
	 */
	private async tidy(): Promise<void> {
		if (!this.canvas.isCurrentScene(this.canvas.scene.key) || this.running || this.canvasNavigationService.state.cardDetail) {
			return;
		}
		this.running = true;
		try {
			// A Note that is being edited is closed first, as a click elsewhere
			// closes it.
			if (!await this.canvas.closeNoteEditor()) {
				return;
			}
			const scene = this.canvas.scene;
			if (!this.canvas.isCurrentScene(scene.key) || scene.cards.length < 2) {
				return;
			}
			// A place is saved with the decimal places that the layout keeps.
			const stored = (value: number): number => Number(value.toFixed(4));
			const placeOf = new Map(baseHalfCanvasTidy(scene.cards, scene.edges).map(place => [place.path, { x: stored(place.x), y: stored(place.y) }]));
			const places: IBaseHalfCanvasSceneGeometry[] = [];
			for (const card of scene.cards) {
				const place = placeOf.get(card.path);
				if (place) {
					places.push({ path: card.path, kind: card.kind, x: place.x, y: place.y, width: card.width, height: card.height });
				}
			}
			const viewport = this.canvas.getViewport();
			const token = ++this.sequence;
			// Tidying again keeps the result of the tidy before.
			this.closeQuestion();
			// The layout says which cards move. What the canvas draws can be a
			// moment behind it, for example right after an undo.
			const moved = await this.canvas.moveCards(scene, places, localize('basehalf.canvas.tidy.undo', "Tidy canvas"), undone => {
				// Undo of the tidy leaves nothing to keep or revert.
				if (undone && this.question?.token === token) {
					this.closeQuestion();
				}
			});
			if (!this.canvas.isCurrentScene(scene.key)) {
				return;
			}
			// The scene draws the new places in its next frames, and the view is
			// fitted to what is drawn.
			await this.canvas.whenDrawn();
			if (!this.canvas.isCurrentScene(scene.key)) {
				return;
			}
			this.canvas.fitToScreen();
			if (moved.length > 0) {
				this.ask({ token, sceneKey: scene.key, previous: new Map(moved.map(card => [card.path, card.before])), viewport });
			}
		} catch (error) {
			this.canvas.reportError(error);
		} finally {
			this.running = false;
		}
	}

	/** Asks whether to keep a tidy. The canvas stays usable while the question is open. */
	private ask(tidy: Omit<IBaseHalfCanvasTidyQuestion, 'element' | 'listeners'>): void {
		this.closeQuestion();
		const text = localize('basehalf.canvas.tidy.question', "Keep this arrangement?");
		const listeners = new DisposableStore();
		const element = append(this.canvas.viewControlsCorner, $('.basehalf-canvas-tidy-question'));
		element.setAttribute('role', 'group');
		element.setAttribute('aria-label', text);
		element.setAttribute('data-testid', 'canvas-tidy-question');
		append(element, $('span.basehalf-canvas-tidy-question-text')).textContent = text;
		const actions = append(element, $('.basehalf-canvas-tidy-question-actions'));
		const revert = append(actions, $('button.basehalf-canvas-tidy-question-button')) as HTMLButtonElement;
		revert.type = 'button';
		revert.textContent = localize('basehalf.canvas.tidy.revert', "Revert");
		revert.setAttribute('data-testid', 'canvas-tidy-revert');
		const keep = append(actions, $('button.basehalf-canvas-tidy-question-button.primary')) as HTMLButtonElement;
		keep.type = 'button';
		keep.textContent = localize('basehalf.canvas.tidy.keep', "Keep");
		keep.setAttribute('data-testid', 'canvas-tidy-keep');
		const question: IBaseHalfCanvasTidyQuestion = { ...tidy, element, listeners };
		listeners.add(addDisposableListener(revert, 'click', () => void this.revert(question)));
		listeners.add(addDisposableListener(keep, 'click', () => this.closeQuestion()));
		listeners.add(addDisposableListener(element, 'keydown', event => {
			if (event.key === 'Escape' && !event.isComposing) {
				event.preventDefault();
				event.stopPropagation();
				this.closeQuestion();
			}
		}));
		this.question = question;
		status(text);
	}

	/** Closes the question after a tidy. The tidied places stay. */
	private closeQuestion(): void {
		const question = this.question;
		if (!question) {
			return;
		}
		this.question = undefined;
		question.listeners.dispose();
		// A button of the question may hold the focus. Without it the focus
		// would fall to the window, where the canvas takes no undo and no key.
		const heldFocus = question.element.contains(question.element.ownerDocument.activeElement);
		question.element.remove();
		if (heldFocus) {
			this.canvas.focus();
		}
	}

	/**
	 * Puts every card that the tidy moved back at the place it had before, also
	 * a card that was moved again since, and the view back to what it showed.
	 * Only places go back: a size that changed since stays, and a card that is
	 * gone is passed over.
	 */
	private async revert(question: IBaseHalfCanvasTidyQuestion): Promise<void> {
		if (this.question !== question) {
			return;
		}
		this.closeQuestion();
		const { sceneKey } = question;
		if (!this.canvas.isCurrentScene(sceneKey)) {
			return;
		}
		try {
			await this.canvas.restoreCardPlaces(sceneKey, question.previous, localize('basehalf.canvas.tidy.revertUndo', "Revert tidy"));
			if (!this.canvas.isCurrentScene(sceneKey)) {
				return;
			}
			// The view goes back to what it showed before the tidy.
			await this.canvas.setViewport(sceneKey, question.viewport);
		} catch (error) {
			this.canvas.reportError(error);
		}
	}
}

registerBaseHalfCanvasContribution(BaseHalfCanvasTidy.ID, BaseHalfCanvasTidy);
