/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { ILocalizedString } from '../../../../platform/action/common/action.js';
import { ContextKeyExpr, ContextKeyExpression, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { BaseHalfCardDetailOpenContext, BaseHalfSurfaceActiveContext } from '../../navigation/common/basehalfCanvasNavigation.js';

// The keys of the canvas are commands (docs/specs/canvas-keys.md): their names, their default keys, and
// where each key acts. This module names no element: the canvas view reads where the keyboard is from the
// page and hands it over as facts.

/** The canvas has the keyboard: the element with the keyboard focus is in the canvas area, Card Detail is closed, and no name is being edited. */
export const BaseHalfCanvasFocusContext = new RawContextKey<boolean>('basehalfCanvasFocus', false, localize('basehalf.canvas.keys.focus', "Whether the canvas has the keyboard"));
/** What in the canvas has the keyboard (`BaseHalfCanvasKeyboardPlace`), or nothing while the keyboard is elsewhere. */
export const BaseHalfCanvasKeyboardOnContext = new RawContextKey<string>('basehalfCanvasKeyboardOn', '', localize('basehalf.canvas.keys.keyboardOn', "What in the canvas has the keyboard: canvas, card, insideCard, connection, toolbar, control, scene, or frame"));
export const BaseHalfCanvasTextFocusContext = new RawContextKey<boolean>('basehalfCanvasTextFocus', false, localize('basehalf.canvas.keys.textFocus', "Whether the keyboard is in a place for text on the canvas"));
export const BaseHalfCanvasSelectedCardsContext = new RawContextKey<number>('basehalfCanvasSelectedCards', 0, localize('basehalf.canvas.keys.selectedCards', "How many cards are selected on the canvas"));
export const BaseHalfCanvasConnectionsSelectedContext = new RawContextKey<boolean>('basehalfCanvasConnectionsSelected', false, localize('basehalf.canvas.keys.connectionsSelected', "Whether connections are selected on the canvas"));
export const BaseHalfCanvasKeyboardOnSelectedCardContext = new RawContextKey<boolean>('basehalfCanvasKeyboardOnSelectedCard', false, localize('basehalf.canvas.keys.keyboardOnSelectedCard', "Whether the card that has the keyboard is the one selected card"));
export const BaseHalfCanvasSelectedCardEditsOnCardContext = new RawContextKey<boolean>('basehalfCanvasSelectedCardEditsOnCard', false, localize('basehalf.canvas.keys.selectedCardEditsOnCard', "Whether the one selected card is a code card that is edited on its card"));
export const BaseHalfCanvasPickingContext = new RawContextKey<boolean>('basehalfCanvasPicking', false, localize('basehalf.canvas.keys.picking', "Whether a generation card waits for a pick on the canvas"));
export const BaseHalfCanvasKeyboardByToolbarContext = new RawContextKey<boolean>('basehalfCanvasKeyboardByToolbar', false, localize('basehalf.canvas.keys.keyboardByToolbar', "Whether the keyboard is in the selected image or video card, whose toolbar a key reaches"));

/**
 * What in the canvas has the keyboard:
 * - `canvas`: the blank canvas, the scene itself;
 * - `card`: a card itself;
 * - `insideCard`: something of a card that is no control;
 * - `connection`: a selected connection;
 * - `toolbar`: the toolbar of the selection;
 * - `control`: a button, a field, a link, a player, a handle, or anything else that takes a press for itself;
 * - `scene`: elsewhere among the cards, as the frame the canvas library draws around a card;
 * - `frame`: the rest of the canvas area, and everything under Card Detail while it is drawn.
 */
export type BaseHalfCanvasKeyboardPlace = 'canvas' | 'card' | 'insideCard' | 'connection' | 'toolbar' | 'control' | 'scene' | 'frame';

/** What the canvas view reads from the page at a key press. */
export interface IBaseHalfCanvasKeyFacts {
	/** The element with the keyboard is in the canvas area. */
	readonly inCanvas: boolean;
	/** Navigation says that Card Detail is open. */
	readonly cardDetailOpen: boolean;
	/** Card Detail is drawn over the canvas: it follows navigation by the frames of its fade. */
	readonly cardDetailDrawn: boolean;
	/** The element is the scene or in it. */
	readonly inScene: boolean;
	/** The element is the scene itself. */
	readonly isScene: boolean;
	readonly inToolbar: boolean;
	readonly onSelectedConnection: boolean;
	readonly inControl: boolean;
	/** The element is a card itself. */
	readonly isCard: boolean;
	/** The path of the card the element is, or is in. */
	readonly cardPath: string | undefined;
	/** The element takes typed text. */
	readonly inText: boolean;
	/** The element is the editor of an item's name, which keeps every key to itself: also the keys of the window. */
	readonly inNameEditor: boolean;
	/** The element is in the selected image or video card, whose toolbar stands by it. */
	readonly inCardWithToolbar: boolean;
	readonly selectedCards: readonly string[];
	readonly selectedConnections: number;
	/** The one selected card is a code card that is edited on its card. */
	readonly selectedCardEditsOnCard: boolean;
	/** A generation card waits for a pick. */
	readonly picking: boolean;
}

/** The values of the canvas's context keys. */
export interface IBaseHalfCanvasKeyContext {
	readonly focus: boolean;
	readonly keyboardOn: BaseHalfCanvasKeyboardPlace | '';
	readonly textFocus: boolean;
	readonly selectedCards: number;
	readonly connectionsSelected: boolean;
	readonly keyboardOnSelectedCard: boolean;
	readonly selectedCardEditsOnCard: boolean;
	readonly picking: boolean;
	readonly keyboardByToolbar: boolean;
}

function keyboardPlace(facts: IBaseHalfCanvasKeyFacts): BaseHalfCanvasKeyboardPlace | '' {
	if (!facts.inCanvas) {
		return '';
	}
	if (!facts.inScene || facts.cardDetailDrawn) {
		return facts.inControl ? 'control' : 'frame';
	}
	// The toolbar of the selection and a selected connection take the keys of the selection, though
	// each is also something that takes no drag.
	if (facts.inToolbar) {
		return 'toolbar';
	}
	if (facts.onSelectedConnection) {
		return 'connection';
	}
	if (facts.inControl) {
		return 'control';
	}
	if (facts.isScene) {
		return 'canvas';
	}
	if (facts.isCard) {
		return 'card';
	}
	return facts.cardPath !== undefined ? 'insideCard' : 'scene';
}

/** Where the keyboard is and what is selected, as the conditions of the commands read it. */
export function baseHalfCanvasKeyContext(facts: IBaseHalfCanvasKeyFacts): IBaseHalfCanvasKeyContext {
	const keyboardOn = keyboardPlace(facts);
	const oneSelected = facts.selectedCards.length === 1 ? facts.selectedCards[0] : undefined;
	return {
		focus: facts.inCanvas && !facts.cardDetailOpen && !facts.inNameEditor,
		keyboardOn,
		textFocus: facts.inCanvas && facts.inText,
		selectedCards: facts.selectedCards.length,
		connectionsSelected: facts.selectedConnections > 0,
		keyboardOnSelectedCard: (keyboardOn === 'card' || keyboardOn === 'insideCard') && oneSelected !== undefined && facts.cardPath === oneSelected,
		selectedCardEditsOnCard: oneSelected !== undefined && facts.selectedCardEditsOnCard,
		picking: facts.picking,
		keyboardByToolbar: facts.inCanvas && !facts.cardDetailDrawn && facts.inScene && facts.inCardWithToolbar
	};
}

/** The values as the base's conditions evaluate them, by the names of the context keys. */
export function baseHalfCanvasKeyContextValues(context: IBaseHalfCanvasKeyContext): ReadonlyMap<string, boolean | number | string> {
	return new Map<string, boolean | number | string>([
		[BaseHalfCanvasFocusContext.key, context.focus],
		[BaseHalfCanvasKeyboardOnContext.key, context.keyboardOn],
		[BaseHalfCanvasTextFocusContext.key, context.textFocus],
		[BaseHalfCanvasSelectedCardsContext.key, context.selectedCards],
		[BaseHalfCanvasConnectionsSelectedContext.key, context.connectionsSelected],
		[BaseHalfCanvasKeyboardOnSelectedCardContext.key, context.keyboardOnSelectedCard],
		[BaseHalfCanvasSelectedCardEditsOnCardContext.key, context.selectedCardEditsOnCard],
		[BaseHalfCanvasPickingContext.key, context.picking],
		[BaseHalfCanvasKeyboardByToolbarContext.key, context.keyboardByToolbar]
	]);
}

export const enum BaseHalfCanvasCommandId {
	ZoomIn = 'basehalf.canvas.zoomIn',
	ZoomOut = 'basehalf.canvas.zoomOut',
	ZoomTo100 = 'basehalf.canvas.zoomTo100',
	FitToScreen = 'basehalf.canvas.fitToScreen',
	Tidy = 'basehalf.canvas.tidy',
	MoveCardLeft = 'basehalf.canvas.moveCardLeft',
	MoveCardRight = 'basehalf.canvas.moveCardRight',
	MoveCardUp = 'basehalf.canvas.moveCardUp',
	MoveCardDown = 'basehalf.canvas.moveCardDown',
	MoveCardLeftBy10 = 'basehalf.canvas.moveCardLeftBy10',
	MoveCardRightBy10 = 'basehalf.canvas.moveCardRightBy10',
	MoveCardUpBy10 = 'basehalf.canvas.moveCardUpBy10',
	MoveCardDownBy10 = 'basehalf.canvas.moveCardDownBy10',
	DuplicateSelection = 'basehalf.canvas.duplicateSelection',
	DeleteSelection = 'basehalf.canvas.deleteSelection',
	RenameCard = 'basehalf.canvas.renameCard',
	OpenCard = 'basehalf.canvas.openCard',
	SelectCard = 'basehalf.canvas.selectCard',
	FocusCardToolbar = 'basehalf.canvas.focusCardToolbar'
}

export interface IBaseHalfCanvasKeys {
	readonly primary: number;
	readonly secondary?: readonly number[];
	/** The keys on a system with a Command key, where they differ. */
	readonly mac?: { readonly primary: number; readonly secondary?: readonly number[] };
}

export interface IBaseHalfCanvasKeyCommand {
	readonly id: BaseHalfCanvasCommandId;
	readonly title: ILocalizedString;
	/** The keys the command has until the user changes them. */
	readonly keys?: IBaseHalfCanvasKeys;
	/** Where the key acts. */
	readonly when: ContextKeyExpression;
	/** The Command Palette lists the command while this holds. Without it, the palette never lists it. */
	readonly palette?: ContextKeyExpression;
	/** After the command, the key goes on to the canvas library, which selects the card that has the keyboard. */
	readonly passesKeyOn?: boolean;
	/** How far Move Card moves the card. */
	readonly move?: { readonly x: number; readonly y: number };
}

const keyboardOn = (...places: BaseHalfCanvasKeyboardPlace[]): ContextKeyExpression => places.length === 1
	? BaseHalfCanvasKeyboardOnContext.isEqualTo(places[0])
	: ContextKeyExpr.regex(BaseHalfCanvasKeyboardOnContext.key, new RegExp(`^(${places.join('|')})$`));

// Where the keys of the selection act: on the canvas outside a control, or in the toolbar of the selection.
const onSelection = keyboardOn('canvas', 'card', 'insideCard', 'scene', 'connection', 'toolbar');
const cardsSelected = ContextKeyExpr.greater(BaseHalfCanvasSelectedCardsContext.key, 0);
const oneCardSelected = BaseHalfCanvasSelectedCardsContext.isEqualTo(1);
const all = (...expressions: (ContextKeyExpression | undefined)[]): ContextKeyExpression => ContextKeyExpr.and(...expressions)!;
const any = (...expressions: (ContextKeyExpression | undefined)[]): ContextKeyExpression => ContextKeyExpr.or(...expressions)!;

const whenCanvasFocus: ContextKeyExpression = BaseHalfCanvasFocusContext;
const whenMoveCard = all(
	BaseHalfCanvasFocusContext,
	oneCardSelected,
	BaseHalfCanvasPickingContext.negate(),
	any(keyboardOn('canvas'), BaseHalfCanvasKeyboardOnSelectedCardContext)
);
const whenOnCard = all(BaseHalfCanvasFocusContext, keyboardOn('card'));

// The palette lists a command of the canvas while a canvas is shown and nothing covers it.
const canvasShown = all(ContextKeyExpr.has(BaseHalfSurfaceActiveContext), ContextKeyExpr.not(BaseHalfCardDetailOpenContext));

const moveCard = (id: BaseHalfCanvasCommandId, title: ILocalizedString, key: number, x: number, y: number): IBaseHalfCanvasKeyCommand => (
	{ id, title, keys: { primary: key }, when: whenMoveCard, move: { x, y } }
);

/** The commands of the canvas, in the order Keyboard Shortcuts is read: the view, then the cards. */
export const BASEHALF_CANVAS_KEY_COMMANDS: readonly IBaseHalfCanvasKeyCommand[] = [
	{
		id: BaseHalfCanvasCommandId.ZoomIn,
		title: localize2('basehalf.canvas.command.zoomIn', "Zoom Canvas In"),
		// The keys that zoom the window (`workbench.action.zoomIn`): on the canvas they zoom the canvas.
		keys: { primary: KeyMod.CtrlCmd | KeyCode.Equal, secondary: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Equal, KeyMod.CtrlCmd | KeyCode.NumpadAdd] },
		when: whenCanvasFocus,
		palette: canvasShown
	},
	{
		id: BaseHalfCanvasCommandId.ZoomOut,
		title: localize2('basehalf.canvas.command.zoomOut', "Zoom Canvas Out"),
		// Every key of the window's zoom out (`workbench.action.zoomOut`), as Zoom Canvas In has every key of its zoom in.
		keys: { primary: KeyMod.CtrlCmd | KeyCode.Minus, secondary: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Minus, KeyMod.CtrlCmd | KeyCode.NumpadSubtract] },
		when: whenCanvasFocus,
		palette: canvasShown
	},
	{
		id: BaseHalfCanvasCommandId.ZoomTo100,
		title: localize2('basehalf.canvas.command.zoomTo100', "Zoom Canvas to 100%"),
		keys: { primary: KeyMod.CtrlCmd | KeyCode.Digit0, secondary: [KeyMod.CtrlCmd | KeyCode.Numpad0] },
		when: whenCanvasFocus,
		palette: canvasShown
	},
	{
		id: BaseHalfCanvasCommandId.FitToScreen,
		title: localize2('basehalf.canvas.command.fitToScreen', "Fit Canvas to Screen"),
		when: whenCanvasFocus,
		palette: canvasShown
	},
	{
		id: BaseHalfCanvasCommandId.Tidy,
		title: localize2('basehalf.canvas.command.tidy', "Tidy Canvas"),
		keys: { primary: KeyMod.Shift | KeyMod.Alt | KeyCode.KeyF },
		when: all(BaseHalfCanvasFocusContext, BaseHalfCanvasTextFocusContext.negate()),
		palette: canvasShown
	},
	moveCard(BaseHalfCanvasCommandId.MoveCardLeft, localize2('basehalf.canvas.command.moveCardLeft', "Move Card Left"), KeyCode.LeftArrow, -1, 0),
	moveCard(BaseHalfCanvasCommandId.MoveCardRight, localize2('basehalf.canvas.command.moveCardRight', "Move Card Right"), KeyCode.RightArrow, 1, 0),
	moveCard(BaseHalfCanvasCommandId.MoveCardUp, localize2('basehalf.canvas.command.moveCardUp', "Move Card Up"), KeyCode.UpArrow, 0, -1),
	moveCard(BaseHalfCanvasCommandId.MoveCardDown, localize2('basehalf.canvas.command.moveCardDown', "Move Card Down"), KeyCode.DownArrow, 0, 1),
	moveCard(BaseHalfCanvasCommandId.MoveCardLeftBy10, localize2('basehalf.canvas.command.moveCardLeftBy10', "Move Card Left by 10"), KeyMod.Shift | KeyCode.LeftArrow, -10, 0),
	moveCard(BaseHalfCanvasCommandId.MoveCardRightBy10, localize2('basehalf.canvas.command.moveCardRightBy10', "Move Card Right by 10"), KeyMod.Shift | KeyCode.RightArrow, 10, 0),
	moveCard(BaseHalfCanvasCommandId.MoveCardUpBy10, localize2('basehalf.canvas.command.moveCardUpBy10', "Move Card Up by 10"), KeyMod.Shift | KeyCode.UpArrow, 0, -10),
	moveCard(BaseHalfCanvasCommandId.MoveCardDownBy10, localize2('basehalf.canvas.command.moveCardDownBy10', "Move Card Down by 10"), KeyMod.Shift | KeyCode.DownArrow, 0, 10),
	{
		id: BaseHalfCanvasCommandId.DuplicateSelection,
		title: localize2('basehalf.canvas.command.duplicateSelection', "Duplicate Selected Cards"),
		keys: { primary: KeyMod.CtrlCmd | KeyCode.KeyD },
		when: all(BaseHalfCanvasFocusContext, cardsSelected, onSelection),
		palette: all(canvasShown, cardsSelected)
	},
	{
		id: BaseHalfCanvasCommandId.DeleteSelection,
		title: localize2('basehalf.canvas.command.deleteSelection', "Delete Selected Cards or Connections"),
		// Command+Backspace is the key that deletes in a file manager and in Files.
		keys: { primary: KeyCode.Delete, secondary: [KeyCode.Backspace], mac: { primary: KeyCode.Delete, secondary: [KeyCode.Backspace, KeyMod.CtrlCmd | KeyCode.Backspace] } },
		when: all(BaseHalfCanvasFocusContext, any(
			all(cardsSelected, onSelection),
			all(BaseHalfCanvasConnectionsSelectedContext, keyboardOn('canvas', 'connection'))
		)),
		palette: all(canvasShown, any(cardsSelected, BaseHalfCanvasConnectionsSelectedContext))
	},
	{
		id: BaseHalfCanvasCommandId.RenameCard,
		title: localize2('basehalf.canvas.command.renameCard', "Rename Card"),
		keys: { primary: KeyCode.F2 },
		when: whenOnCard,
		palette: all(canvasShown, oneCardSelected)
	},
	{
		id: BaseHalfCanvasCommandId.OpenCard,
		title: localize2('basehalf.canvas.command.openCard', "Open Card"),
		keys: { primary: KeyCode.Enter },
		// On a card itself; or, for the selected code card, wherever on the canvas outside a control the keyboard is.
		when: all(BaseHalfCanvasFocusContext, any(
			keyboardOn('card'),
			all(BaseHalfCanvasSelectedCardEditsOnCardContext, keyboardOn('canvas', 'insideCard', 'scene', 'connection', 'frame'))
		)),
		passesKeyOn: true
	},
	{
		id: BaseHalfCanvasCommandId.SelectCard,
		title: localize2('basehalf.canvas.command.selectCard', "Select Card"),
		keys: { primary: KeyCode.Space },
		when: whenOnCard,
		passesKeyOn: true
	},
	{
		id: BaseHalfCanvasCommandId.FocusCardToolbar,
		title: localize2('basehalf.canvas.command.focusCardToolbar', "Focus Card Toolbar"),
		keys: { primary: KeyMod.Alt | KeyCode.F10 },
		when: all(BaseHalfCanvasFocusContext, BaseHalfCanvasKeyboardByToolbarContext)
	}
];

const COMMANDS_BY_ID = new Map<string, IBaseHalfCanvasKeyCommand>(BASEHALF_CANVAS_KEY_COMMANDS.map(command => [command.id, command]));

/** The command of the canvas with this id, or `undefined` for any other command. */
export function getBaseHalfCanvasKeyCommand(id: string | null | undefined): IBaseHalfCanvasKeyCommand | undefined {
	return id ? COMMANDS_BY_ID.get(id) : undefined;
}

/**
 * Whether the scene stops an arrow key before the canvas library, which would move the selected cards
 * by its own steps: while a set is selected, wherever among the cards outside the toolbar the keyboard
 * is; where Move Card acts, when the key is not Move Card's any more; and, while one card is selected,
 * on the frame the library draws around a card, where the Tab key can put the keyboard.
 */
export function baseHalfCanvasStopsArrowKey(context: IBaseHalfCanvasKeyContext, modifiers: { readonly ctrlOrMeta: boolean; readonly alt: boolean }): boolean {
	if (context.keyboardOn !== 'canvas' && context.keyboardOn !== 'card' && context.keyboardOn !== 'insideCard' && context.keyboardOn !== 'scene' && context.keyboardOn !== 'connection') {
		return false;
	}
	if (context.selectedCards >= 2 || (context.selectedCards === 1 && context.keyboardOn === 'scene')) {
		return true;
	}
	return !modifiers.ctrlOrMeta && !modifiers.alt && context.selectedCards === 1 && !context.picking
		&& (context.keyboardOn === 'canvas' || context.keyboardOnSelectedCard);
}

export const IBaseHalfCanvasKeyCommandService = createDecorator<IBaseHalfCanvasKeyCommandService>('baseHalfCanvasKeyCommandService');

/** Hands a command of the canvas to the canvas view of the window. */
export interface IBaseHalfCanvasKeyCommandService {
	readonly _serviceBrand: undefined;
	/** The canvas view takes the commands until the result is disposed. */
	registerCanvas(run: (id: BaseHalfCanvasCommandId) => void | Promise<void>): IDisposable;
	/** Runs the command on the canvas. Nothing happens while no canvas takes commands. */
	run(id: BaseHalfCanvasCommandId): Promise<void>;
}

class BaseHalfCanvasKeyCommandService implements IBaseHalfCanvasKeyCommandService {
	declare readonly _serviceBrand: undefined;

	private canvas: ((id: BaseHalfCanvasCommandId) => void | Promise<void>) | undefined;

	registerCanvas(run: (id: BaseHalfCanvasCommandId) => void | Promise<void>): IDisposable {
		this.canvas = run;
		return toDisposable(() => {
			if (this.canvas === run) {
				this.canvas = undefined;
			}
		});
	}

	async run(id: BaseHalfCanvasCommandId): Promise<void> {
		await this.canvas?.(id);
	}
}

registerSingleton(IBaseHalfCanvasKeyCommandService, BaseHalfCanvasKeyCommandService, InstantiationType.Delayed);
