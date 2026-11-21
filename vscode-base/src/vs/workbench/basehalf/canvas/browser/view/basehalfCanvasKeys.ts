/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../../base/browser/keyboardEvent.js';
import { DisposableStore, IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { IContextKey } from '../../../../../platform/contextkey/common/contextkey.js';
import { ResultKind } from '../../../../../platform/keybinding/common/keybindingResolver.js';
import {
	BaseHalfCanvasCommandId,
	BaseHalfCanvasConnectionsSelectedContext,
	BaseHalfCanvasFocusContext,
	baseHalfCanvasKeyContext,
	BaseHalfCanvasKeyboardByToolbarContext,
	BaseHalfCanvasKeyboardOnContext,
	BaseHalfCanvasKeyboardOnSelectedCardContext,
	BaseHalfCanvasPickingContext,
	BaseHalfCanvasSelectedCardEditsOnCardContext,
	BaseHalfCanvasSelectedCardsContext,
	baseHalfCanvasStopsArrowKey,
	BaseHalfCanvasTextFocusContext,
	getBaseHalfCanvasKeyCommand,
	IBaseHalfCanvasKeyContext,
	IBaseHalfCanvasKeyFacts
} from '../../common/basehalfCanvasKeys.js';
import { BASEHALF_CANVAS_CARD_TOOLBAR_FOCUS_EVENT } from '../../common/basehalfCanvasScene.js';
import type { BaseHalfCanvasWorkbenchContribution } from '../basehalfCanvasWorkbench.contribution.js';
import {
	baseHalfCanvasTargetBlocksGraphShortcuts,
	baseHalfCanvasTargetOwnsSelectedEdgeShortcuts,
	baseHalfCanvasTargetOwnsSelectionShortcuts
} from '../scene/basehalfCanvasSceneKeyboard.js';
import { IBaseHalfCanvasSceneKeySelection } from '../scene/basehalfCanvasSceneShared.js';

/** What the keys of a card do, which the drawing of the card knows: Rename Card, Open Card, and Select Card. */
export interface IBaseHalfCanvasCardKeys {
	rename(): void;
	open(): void;
	select(): void;
}

const NO_SELECTION: IBaseHalfCanvasSceneKeySelection = { cards: [], connections: 0, toolbar: 'none' };
const ARROW_KEYS: readonly string[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

/**
 * The keys of the canvas (docs/specs/canvas-keys.md). At each key that enters
 * the canvas area, before any control of it, this part says where the keyboard
 * is and what is selected through the canvas's context keys, asks the base's
 * key bindings which command the key has there, and runs it when it is a
 * command of the canvas. It also runs a command of the canvas that comes
 * from the Command Palette, on the selection.
 */
export class BaseHalfCanvasKeys {

	private contextKeys: {
		readonly focus: IContextKey<boolean>;
		readonly keyboardOn: IContextKey<string>;
		readonly textFocus: IContextKey<boolean>;
		readonly selectedCards: IContextKey<number>;
		readonly connectionsSelected: IContextKey<boolean>;
		readonly keyboardOnSelectedCard: IContextKey<boolean>;
		readonly selectedCardEditsOnCard: IContextKey<boolean>;
		readonly picking: IContextKey<boolean>;
		readonly keyboardByToolbar: IContextKey<boolean>;
	} | undefined;
	/** What the context keys were last told. */
	private said: IBaseHalfCanvasKeyContext | undefined;
	/** The key press a command is being run for: the card that had the keyboard, and where the keyboard was. */
	private keyPress: { readonly command: BaseHalfCanvasCommandId; readonly card: HTMLElement | undefined; readonly context: IBaseHalfCanvasKeyContext } | undefined;
	/** The key presses that ran a command and went on to the canvas library. */
	private readonly passedOn = new WeakSet<KeyboardEvent>();
	private readonly cardKeys = new WeakMap<HTMLElement, IBaseHalfCanvasCardKeys>();
	private readonly featureCommands = new Map<BaseHalfCanvasCommandId, () => void | Promise<void>>();

	constructor(private readonly view: BaseHalfCanvasWorkbenchContribution) { }

	/** Starts hearing the keys of the canvas area. The view calls it once its elements are made. */
	start(): IDisposable {
		const store = new DisposableStore();
		const service = this.view.contextKeyService;
		this.contextKeys = {
			focus: BaseHalfCanvasFocusContext.bindTo(service),
			keyboardOn: BaseHalfCanvasKeyboardOnContext.bindTo(service),
			textFocus: BaseHalfCanvasTextFocusContext.bindTo(service),
			selectedCards: BaseHalfCanvasSelectedCardsContext.bindTo(service),
			connectionsSelected: BaseHalfCanvasConnectionsSelectedContext.bindTo(service),
			keyboardOnSelectedCard: BaseHalfCanvasKeyboardOnSelectedCardContext.bindTo(service),
			selectedCardEditsOnCard: BaseHalfCanvasSelectedCardEditsOnCardContext.bindTo(service),
			picking: BaseHalfCanvasPickingContext.bindTo(service),
			keyboardByToolbar: BaseHalfCanvasKeyboardByToolbarContext.bindTo(service)
		};
		const root = this.view.root;
		// Before any control of the canvas, as the keys of the scene were heard.
		store.add(DOM.addDisposableListener(root, DOM.EventType.KEY_DOWN, event => this.onKeyDown(event), true));
		// A menu and the Command Palette read the conditions while the keyboard is elsewhere.
		store.add(DOM.addDisposableListener(root, DOM.EventType.FOCUS_IN, event => this.say(event.target)));
		store.add(DOM.addDisposableListener(root, DOM.EventType.FOCUS_OUT, event => this.say(event.relatedTarget)));
		// A command that comes after another key or a press was not run for the last key of the canvas.
		store.add(DOM.addDisposableListener(root.ownerDocument, DOM.EventType.POINTER_DOWN, () => { this.keyPress = undefined; }, true));
		store.add(DOM.addDisposableListener(root.ownerDocument, DOM.EventType.KEY_DOWN, event => {
			this.keyPress = undefined;
			// The keyboard can leave the canvas without an event, as when the element that had it is taken
			// away: a key pressed elsewhere is never judged by where the keyboard was.
			if (this.said?.keyboardOn && !(DOM.isHTMLElement(event.target) && root.contains(event.target))) {
				this.say(event.target);
			}
		}, true));
		store.add(this.view.canvasKeyCommandService.registerCanvas(id => this.run(id)));
		store.add(toDisposable(() => this.say(null)));
		return store;
	}

	/** The selection changed: the conditions follow while no key is pressed. */
	selectionChanged(): void {
		this.say(this.view.root.ownerDocument.activeElement);
	}

	/** Whether the key press ran a command of the canvas and went on to the canvas library: no one after the canvas takes it. */
	ran(event: KeyboardEvent): boolean {
		return this.passedOn.has(event);
	}

	setCardKeys(card: HTMLElement, keys: IBaseHalfCanvasCardKeys): void {
		this.cardKeys.set(card, keys);
	}

	/** A feature of the canvas runs its own command (`IBaseHalfCanvasView.registerCommand`). */
	registerFeatureCommand(id: BaseHalfCanvasCommandId, run: () => void | Promise<void>): IDisposable {
		this.featureCommands.set(id, run);
		return toDisposable(() => {
			if (this.featureCommands.get(id) === run) {
				this.featureCommands.delete(id);
			}
		});
	}

	private onKeyDown(event: KeyboardEvent): void {
		// An input method's own keys.
		if (event.isComposing || event.keyCode === 229) {
			return;
		}
		const target = DOM.isHTMLElement(event.target) || DOM.isSVGElement(event.target) ? event.target : undefined;
		const context = this.say(target ?? null);
		const keyboardEvent = new StandardKeyboardEvent(event);
		const resolved = target ? this.view.keybindingService.softDispatch(keyboardEvent, target) : undefined;
		const command = resolved?.kind === ResultKind.KbFound ? getBaseHalfCanvasKeyCommand(resolved.commandId) : undefined;
		if (command && target) {
			this.keyPress = { command: command.id, card: this.cardOf(target), context };
			this.view.keybindingService.dispatchEvent(keyboardEvent, target);
			event.preventDefault();
			if (command.passesKeyOn) {
				// The canvas library selects the card that has the keyboard at Enter and at Space.
				this.passedOn.add(event);
			} else {
				event.stopPropagation();
			}
			return;
		}
		if (ARROW_KEYS.includes(event.key) && baseHalfCanvasStopsArrowKey(context, { ctrlOrMeta: event.metaKey || event.ctrlKey, alt: event.altKey })) {
			// The canvas library would move every selected card by the arrow keys
			// of a card that has the keyboard, by steps of its own. A set is not
			// moved by keys, and one card only by Move Card.
			event.preventDefault();
			event.stopPropagation();
		}
	}

	/** Reads where the keyboard is and what is selected, and says it through the context keys. */
	private say(target: EventTarget | null): IBaseHalfCanvasKeyContext {
		const context = baseHalfCanvasKeyContext(this.facts(target));
		this.said = context;
		const keys = this.contextKeys;
		if (keys) {
			keys.focus.set(context.focus);
			keys.keyboardOn.set(context.keyboardOn);
			keys.textFocus.set(context.textFocus);
			keys.selectedCards.set(context.selectedCards);
			keys.connectionsSelected.set(context.connectionsSelected);
			keys.keyboardOnSelectedCard.set(context.keyboardOnSelectedCard);
			keys.selectedCardEditsOnCard.set(context.selectedCardEditsOnCard);
			keys.picking.set(context.picking);
			keys.keyboardByToolbar.set(context.keyboardByToolbar);
		}
		return context;
	}

	private facts(target: EventTarget | null): IBaseHalfCanvasKeyFacts {
		const root = this.view.root;
		const scene = this.view.cards;
		const element = DOM.isHTMLElement(target) || DOM.isSVGElement(target) ? target : undefined;
		const inCanvas = !!element && root.contains(element);
		const selection = this.view.canvasScene.sceneKeys()?.selection() ?? NO_SELECTION;
		const selectedPath = selection.cards.length === 1 ? selection.cards[0] : undefined;
		const selectedItem = selectedPath !== undefined ? this.view.renderedItemsByPath.get(selectedPath) : undefined;
		const card = inCanvas ? this.cardOf(element) : undefined;
		return {
			inCanvas,
			cardDetailOpen: !!this.view.canvasNavigationService.state.cardDetail,
			cardDetailDrawn: root.classList.contains('basehalf-card-detail-open'),
			inScene: inCanvas && scene.contains(element),
			isScene: element === scene,
			inToolbar: inCanvas && baseHalfCanvasTargetOwnsSelectionShortcuts(element),
			onSelectedConnection: inCanvas && baseHalfCanvasTargetOwnsSelectedEdgeShortcuts(element),
			inControl: inCanvas && baseHalfCanvasTargetBlocksGraphShortcuts(element),
			isCard: !!card && card === element,
			cardPath: card?.dataset.basehalfCardPath,
			inText: DOM.isHTMLElement(element) && (DOM.isEditableElement(element) || element.isContentEditable),
			inNameEditor: inCanvas && !!element.closest('.basehalf-canvas-inline-name-input'),
			inCardWithToolbar: inCanvas && selection.toolbar === 'video' && selectedPath !== undefined
				&& !!this.view.renderedCardElementsByPath.get(selectedPath)?.contains(element),
			selectedCards: selection.cards,
			selectedConnections: selection.connections,
			selectedCardEditsOnCard: !!selectedItem && !!this.view.codeCards?.editsOnCard(selectedItem, this.view.renderedCardPreviewsByPath.get(selectedItem.path)?.preview),
			picking: !!scene.dataset.videoInputPickActive
		};
	}

	private cardOf(target: EventTarget): HTMLElement | undefined {
		return DOM.isHTMLElement(target) || DOM.isSVGElement(target)
			? target.closest<HTMLElement>('.basehalf-canvas-card[data-basehalf-card-path]') ?? undefined
			: undefined;
	}

	/** Runs a command of the canvas: for the key that was just pressed, or, from a list, on the selection. */
	private async run(id: BaseHalfCanvasCommandId): Promise<void> {
		const press = this.keyPress?.command === id ? this.keyPress : undefined;
		this.keyPress = undefined;
		// A list may run a command while no canvas is shown or Card Detail covers it.
		if (!this.view.getCurrentFolder() || this.view.canvasNavigationService.state.cardDetail) {
			return;
		}
		const feature = this.featureCommands.get(id);
		if (feature) {
			await feature();
			return;
		}
		const scene = this.view.canvasScene.sceneKeys();
		const selection = scene?.selection() ?? NO_SELECTION;
		const selectedPath = selection.cards.length === 1 ? selection.cards[0] : undefined;
		const selectedCard = selectedPath !== undefined ? this.view.renderedCardElementsByPath.get(selectedPath) : undefined;
		// The card that had the keyboard, or, for a command from a list, the one selected card.
		const card = press ? press.card : selectedCard;
		const move = getBaseHalfCanvasKeyCommand(id)?.move;
		if (move) {
			scene?.moveSelectedCard(move.x, move.y);
			return;
		}
		switch (id) {
			case BaseHalfCanvasCommandId.ZoomIn:
				this.view.geometry.zoomBy(1);
				break;
			case BaseHalfCanvasCommandId.ZoomOut:
				this.view.geometry.zoomBy(-1);
				break;
			case BaseHalfCanvasCommandId.ZoomTo100:
				this.view.geometry.setCanvasZoom(1);
				break;
			case BaseHalfCanvasCommandId.FitToScreen:
				this.view.geometry.fitCanvasToScreen();
				break;
			case BaseHalfCanvasCommandId.DuplicateSelection:
				scene?.duplicateSelection();
				break;
			case BaseHalfCanvasCommandId.DeleteSelection:
				scene?.deleteSelection();
				break;
			case BaseHalfCanvasCommandId.RenameCard:
				if (card) {
					this.cardKeys.get(card)?.rename();
				}
				break;
			case BaseHalfCanvasCommandId.OpenCard:
				if (press && press.context.keyboardOn !== 'card') {
					// Enter edits the selected code card from its place, wherever on the canvas the keyboard is (code cards, rule 18).
					if (selectedPath !== undefined) {
						await this.view.codeCards?.edit(selectedPath);
					}
				} else if (card) {
					this.cardKeys.get(card)?.open();
				}
				break;
			case BaseHalfCanvasCommandId.SelectCard:
				if (card) {
					this.cardKeys.get(card)?.select();
				}
				break;
			case BaseHalfCanvasCommandId.FocusCardToolbar:
				if (selectedCard && selection.toolbar === 'video') {
					selectedCard.dispatchEvent(new (DOM.getWindow(selectedCard).Event)(BASEHALF_CANVAS_CARD_TOOLBAR_FOCUS_EVENT));
				}
				break;
		}
	}
}
