/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

// Where the keyboard returns (docs/specs/keyboard-return.md): a part of the window that the keyboard
// left keeps it when it still has something to take it, as the Agent Area does with the session that comes
// to the front. The canvas view, which gives the keyboard a place when it has none, asks the parts first.

/** A part of the window that keeps the keyboard that left it. */
export interface IBaseHalfKeyboardPart {
	/** The element of the part: the keyboard left the part when it left something in this element. */
	readonly element: HTMLElement;
	/** Gives the keyboard to what the part has for it. Resolves to false when the part has nothing to take it. */
	take(): Promise<boolean>;
}

export const IBaseHalfKeyboardPartsService = createDecorator<IBaseHalfKeyboardPartsService>('baseHalfKeyboardPartsService');

export interface IBaseHalfKeyboardPartsService {
	readonly _serviceBrand: undefined;
	/** The part keeps the keyboard that leaves it until the result is disposed. */
	registerPart(part: IBaseHalfKeyboardPart): IDisposable;
	/** The part among `elements`, which are the element that lost the keyboard and the elements it was in. */
	partOf(elements: readonly EventTarget[]): IBaseHalfKeyboardPart | undefined;
}

class BaseHalfKeyboardPartsService implements IBaseHalfKeyboardPartsService {
	declare readonly _serviceBrand: undefined;

	private readonly parts = new Set<IBaseHalfKeyboardPart>();

	registerPart(part: IBaseHalfKeyboardPart): IDisposable {
		this.parts.add(part);
		return toDisposable(() => this.parts.delete(part));
	}

	partOf(elements: readonly EventTarget[]): IBaseHalfKeyboardPart | undefined {
		for (const part of this.parts) {
			if (elements.includes(part.element)) {
				return part;
			}
		}
		return undefined;
	}
}

registerSingleton(IBaseHalfKeyboardPartsService, BaseHalfKeyboardPartsService, InstantiationType.Delayed);
