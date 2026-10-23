/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { BrandedService, IConstructorSignature } from '../../../../platform/instantiation/common/instantiation.js';
import { IBaseHalfCanvasFolderState } from '../../navigation/common/basehalfCanvasNavigation.js';
import { BaseHalfCanvasCardPreview } from '../common/basehalfCanvasCardPreview.js';
import { IBaseHalfCanvasCard, IBaseHalfCanvasItem } from '../common/basehalfCanvasModel.js';
import { IBaseHalfCanvasSceneCard, IBaseHalfCanvasSceneEdge, IBaseHalfCanvasSceneGeometry, IBaseHalfCanvasSceneViewport } from '../common/basehalfCanvasScene.js';

/** The cards and connections of the canvas as they were drawn last. */
export interface IBaseHalfCanvasViewScene {
	/** Names the canvas the scene belongs to. It changes when another folder's canvas is shown. */
	readonly key: string;
	/** Changes when cards come or go. A change for an older epoch is refused. */
	readonly structuralEpoch: number;
	readonly cards: readonly IBaseHalfCanvasSceneCard[];
	readonly edges: readonly IBaseHalfCanvasSceneEdge[];
}

/** The scene was drawn anew (IBaseHalfCanvasView.onDidChangeScene). */
export interface IBaseHalfCanvasViewSceneChange {
	readonly scene: IBaseHalfCanvasViewScene;
	/** The folder was read and its cards drawn; false when no folder is shown or the folder could not be read. */
	readonly drawn: boolean;
	/** The cards the drawing selected, such as cards the user just created. */
	readonly selection?: readonly string[];
}

/** The cards the user selected on a canvas. */
export interface IBaseHalfCanvasViewSelection {
	readonly sceneKey: string;
	readonly paths: readonly string[];
}

/** A card whose place a change moved, with its row of the layout before and after. */
export interface IBaseHalfCanvasMovedCard {
	readonly path: string;
	readonly before: IBaseHalfCanvasCard;
	readonly after: IBaseHalfCanvasCard;
}

/**
 * The canvas as its features see it (docs/harness/code-organization.md, "The
 * canvas: a core and its features"). The canvas view implements it; a feature
 * gets it when the view creates the feature and uses nothing else of the view.
 */
export interface IBaseHalfCanvasView {
	/** The zoom of the canvas that is shown, between the lowest and the highest zoom. */
	readonly zoom: number;
	readonly onDidChangeZoom: Event<number>;
	setZoom(zoom: number): void;
	/** One zoom step in or out. */
	zoomBy(direction: -1 | 1): void;
	fitToScreen(): void;
	/** The part of the canvas that is shown. */
	getViewport(): IBaseHalfCanvasSceneViewport;
	/**
	 * Shows the canvas of the scene with this key at a viewport the user had,
	 * and saves it as theirs. Nothing happens when another canvas is shown.
	 */
	setViewport(sceneKey: string, viewport: IBaseHalfCanvasSceneViewport): Promise<void>;

	/** Whether a card that is moved snaps to the edges and centers of other cards. It does when the canvas starts. */
	setSnapEnabled(enabled: boolean): void;

	/** The folder whose canvas is shown. */
	getFolder(): IBaseHalfCanvasFolderState | undefined;
	/** The scene of the canvas that is shown; without a folder, one without cards. */
	readonly scene: IBaseHalfCanvasViewScene;
	/**
	 * The scene was drawn anew from the folder and its layout: another folder's
	 * canvas is shown, or its items or layout changed. It also fires when no
	 * folder is shown or the folder cannot be read, with a scene without cards.
	 */
	readonly onDidChangeScene: Event<IBaseHalfCanvasViewSceneChange>;
	/** Whether the canvas of the scene with this key is the one shown. */
	isCurrentScene(sceneKey: string): boolean;
	/** The item of a card as it was drawn last, by its workspace-relative path. */
	getItem(path: string): IBaseHalfCanvasItem | undefined;
	/** What the card of an item shows of it, as the canvas read it last. */
	getCardPreview(path: string): BaseHalfCanvasCardPreview | undefined;
	/** Draws the canvas again from its folder, soon. */
	requestRender(): void;

	/** The user changed which cards are selected, and the canvas took the change. */
	readonly onDidChangeSelection: Event<IBaseHalfCanvasViewSelection>;
	/** Selects these cards. `onDidChangeSelection` does not fire for it. */
	select(paths: readonly string[]): void;
	/**
	 * Selects a card of this canvas that the user just created at a place
	 * BaseHalf chose, once it is drawn: the view goes to it when it is not in
	 * sight, and its panel takes the focus when it first shows (canvas card
	 * placement, "A card the user just created is shown"). The drawing that
	 * selects it reports the selection in `onDidChangeScene`.
	 */
	selectCreatedCard(path: string): void;
	/** Whether a gesture of the pointer is going on on the canvas, such as a drag. */
	isInteracting(): boolean;
	/** Moves the keyboard focus to a card. */
	focusCard(path: string): void;
	/**
	 * Pick on Canvas: lets the user click a card and resolves with its path.
	 * The click selects or moves nothing. A click on the blank canvas, Escape,
	 * or `cancelCardPick` resolves with undefined; a click on `exceptPath` or
	 * on a folder keeps waiting.
	 */
	pickCard(exceptPath: string): Promise<string | undefined>;
	cancelCardPick(): void;
	/**
	 * Shows an element as the panel under a selected card, such as the Video
	 * panel. The scene places it; `screenHeight` is its height in screen
	 * pixels, and its width is fixed.
	 */
	showCardPanel(sceneKey: string, path: string, element: HTMLElement, screenHeight: number): void;
	/** Takes away the panel with this element. */
	clearCardPanel(element: HTMLElement): void;
	/**
	 * Whether the user just created the node at this path, so that its panel
	 * takes the focus when it first shows. Asking forgets it.
	 */
	takeCreatedNodeFocus(path: string): boolean;
	/** Resolves once the scene has drawn, in its next frames, what was changed before. */
	whenDrawn(): Promise<void>;
	/**
	 * Moves cards of the scene to new places, as one change of the canvas's
	 * layout and one step of undo, and draws them there. Sizes stay as the
	 * layout holds them. Returns the cards whose place changed. `onUndoOrRedo`
	 * hears when that step is undone or done again. Throws with a reason in
	 * plain words when the change cannot be saved.
	 */
	moveCards(scene: IBaseHalfCanvasViewScene, places: readonly IBaseHalfCanvasSceneGeometry[], undoLabel: string, onUndoOrRedo?: (undone: boolean) => void): Promise<readonly IBaseHalfCanvasMovedCard[]>;
	/**
	 * Puts cards back at the places of their rows, as one change of the layout
	 * and one step of undo. Only places go back: a size that changed since
	 * stays, a card that is gone is passed over, and a place that BaseHalf had
	 * chosen is again one it chose. Nothing happens when another canvas is shown.
	 */
	restoreCardPlaces(sceneKey: string, rows: ReadonlyMap<string, IBaseHalfCanvasCard>, undoLabel: string): Promise<void>;

	/** Closes the note that is being edited on its card, as a click elsewhere does. False when it stays open. */
	closeNoteEditor(): Promise<boolean>;
	/** Gives the keyboard focus to the canvas, where its keys and undo work. */
	focus(): void;
	/** A key pressed on the canvas, before the view's own keys. A feature that handles a key prevents its default and stops it. */
	readonly onKeyDown: Event<KeyboardEvent>;
	/** Says on the canvas that what the user did could not be done, and logs the error. */
	reportError(error: unknown): void;

	/**
	 * The group of view controls at the corner of the canvas. A feature appends
	 * its controls to it when it is created, after the controls of the view
	 * itself and those of features registered before it.
	 */
	readonly viewControls: HTMLElement;
	/**
	 * The corner of the canvas that holds the view controls. A feature may show
	 * a passing element above them there, such as a question about its last
	 * action. It is hidden with the controls.
	 */
	readonly viewControlsCorner: HTMLElement;
	/**
	 * The view controls can no longer be used: Card Detail opened, no folder is
	 * shown, or an editor covers the canvas. What a control opened closes.
	 */
	readonly onDidHideViewControls: Event<void>;
}

/** A feature of the canvas, created once for the canvas view and disposed with it. */
export interface IBaseHalfCanvasContribution extends IDisposable { }

export interface IBaseHalfCanvasContributionContext {
	readonly canvas: IBaseHalfCanvasView;
}

export type BaseHalfCanvasContributionCtor = IConstructorSignature<IBaseHalfCanvasContribution, [IBaseHalfCanvasContributionContext]>;

export interface IBaseHalfCanvasContributionDescription {
	readonly id: string;
	readonly ctor: BaseHalfCanvasContributionCtor;
}

/**
 * Registers a feature of the canvas, as VS Code's code editor and terminal
 * register theirs (`registerEditorContribution`, `registerTerminalContribution`).
 * The canvas view creates each registered feature through dependency injection,
 * in the order of registration. Features live in `canvasContrib/<feature>/`,
 * which the canvas core never imports.
 */
export function registerBaseHalfCanvasContribution<Services extends BrandedService[]>(
	id: string,
	ctor: { new(context: IBaseHalfCanvasContributionContext, ...services: Services): IBaseHalfCanvasContribution }
): void {
	BaseHalfCanvasContributionRegistry.INSTANCE.register({ id, ctor: ctor as BaseHalfCanvasContributionCtor });
}

export namespace BaseHalfCanvasExtensionsRegistry {
	export function getCanvasContributions(): readonly IBaseHalfCanvasContributionDescription[] {
		return BaseHalfCanvasContributionRegistry.INSTANCE.getCanvasContributions();
	}
}

class BaseHalfCanvasContributionRegistry {
	static readonly INSTANCE = new BaseHalfCanvasContributionRegistry();

	private readonly contributions: IBaseHalfCanvasContributionDescription[] = [];

	register(description: IBaseHalfCanvasContributionDescription): void {
		if (this.contributions.some(contribution => contribution.id === description.id)) {
			throw new Error(`A canvas feature with the id ${description.id} is registered already.`);
		}
		this.contributions.push(description);
	}

	getCanvasContributions(): readonly IBaseHalfCanvasContributionDescription[] {
		return this.contributions.slice(0);
	}
}
