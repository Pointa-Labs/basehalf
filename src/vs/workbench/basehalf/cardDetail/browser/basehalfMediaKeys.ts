/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { isHTMLElement } from '../../../../base/browser/dom.js';
import { BaseHalfPlayheadMove } from '../../mediaEdit/browser/basehalfMediaEditor.js';

// The keys of a video's or a sound's player and editor (editing media, "The
// keyboard"), which Card Detail's media and the editor of a note's video or
// sound (D114) share.

/** A field of text, which takes every key and the pointer's press itself. */
const TEXT_FIELDS = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
/** What takes the arrow keys, Home, and End itself: a field of text, a slider such as a handle of the frame viewer, a menu, a list, or tabs. */
const OWN_ARROW_KEYS = `${TEXT_FIELDS}, [role="slider"], [role="spinbutton"], [role="textbox"], [role="combobox"], [role="listbox"], [role="menu"], [role="menubar"], [role="radiogroup"], [role="tablist"], [role="tree"], [role="grid"]`;
/** What takes Space itself: a button that Tab took the keyboard to presses itself, and a handle plays and pauses. */
const OWN_SPACE = `${OWN_ARROW_KEYS}, button, [role="button"], [role="checkbox"], [role="switch"], [role="menuitem"], [role="option"], [role="tab"]`;
/** The controls of the media that a press with the pointer gives no keyboard to: buttons, sliders such as the handles, and the crop frame (D100). */
const PRESSED_CONTROLS = 'button, [role="button"], [role="slider"], [role="application"]';

/** The nearest element around `target`, up to `within`, that `selector` matches: an element around `within` does not count. */
function closestWithin(target: EventTarget | null, selector: string, within: Element): Element | undefined {
	const found = isHTMLElement(target) ? target.closest(selector) : null;
	return found && within.contains(found) ? found : undefined;
}

/**
 * What a key does to a video's or a sound's player or editor, with the
 * keyboard anywhere in `within` but on a control or a field that takes the key
 * itself (editing media, "The keyboard"): Space plays and pauses; Left and
 * Right move the playhead a second, with Shift a frame of a video that
 * BaseHalf can edit; Home and End move it to the start and the end. Nothing
 * for another key, a key held for a repeat of Space, or a key with Option,
 * Control, or Command.
 */
export function baseHalfMediaKeyAction(event: KeyboardEvent, within: Element): 'play' | BaseHalfPlayheadMove | undefined {
	if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) {
		return undefined;
	}
	const key = event.key;
	if (key === ' ') {
		return event.shiftKey || event.repeat || closestWithin(event.target, OWN_SPACE, within) ? undefined : 'play';
	}
	const move: BaseHalfPlayheadMove | undefined = key === 'ArrowLeft' || key === 'ArrowRight'
		? { kind: 'step', by: event.shiftKey ? 'frame' : 'second', direction: key === 'ArrowLeft' ? -1 : 1 }
		: (key === 'Home' || key === 'End') && !event.shiftKey ? { kind: 'jump', to: key === 'Home' ? 'start' : 'end' } : undefined;
	return move && !closestWithin(event.target, OWN_ARROW_KEYS, within) ? move : undefined;
}

/**
 * Whether a press of the pointer at `target` is on a control of the media that
 * leaves the keyboard where it was, on the media, as the system's own buttons
 * do: only Tab takes the keyboard to a control, which then shows its ring
 * (D100). A field of text takes its press.
 */
export function baseHalfMediaPressKeepsKeyboard(target: EventTarget | null, within: Element): boolean {
	return !!closestWithin(target, PRESSED_CONTROLS, within) && !closestWithin(target, TEXT_FIELDS, within);
}
