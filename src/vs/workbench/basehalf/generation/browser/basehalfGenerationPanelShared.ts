/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { BaseHalfGenerationVoiceMenu } from './basehalfGenerationVoiceMenu.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';


// What the panel under a generation card and its parts share: the menu that is open, the widths of the menus, and
// small pieces of the panel's look.

export const PROMPT_LINE_HEIGHT = 20;

/** The voice menu is as wide as the model menu (D78). */
export const MENU_WIDTHS = { add: 200, model: 300, voice: 300, settings: 300 } as const;

export const HOVER_GROUP = 'basehalf-video-panel';

export type BaseHalfVideoPanelMenuKind = keyof typeof MENU_WIDTHS;

export interface IOpenMenu {
	readonly kind: BaseHalfVideoPanelMenuKind;
	readonly element: HTMLElement;
	/** Where the focus goes back when the menu closes. */
	readonly trigger: HTMLElement;
	readonly store: DisposableStore;
	/** What the menu's current items hold; cleared each time they are drawn again. */
	readonly content: DisposableStore;
	/** The control the menu opened from, for placing it. */
	readonly anchor: () => DOMRect | undefined;
	readonly align: 'start' | 'end';
	/** A click opened it, not a key: it has no current item until an arrow key chooses one. */
	readonly byPointer: boolean;
	/** What the items show, so they are drawn again only when it changes. */
	contentKey?: string;
	/** The voice menu, which draws its own rows and keeps its search while the panel changes. */
	voice?: BaseHalfGenerationVoiceMenu;
}

/** An icon of the codicon font. Its element carries the icon's classes only, never a font of its own. */
export function renderCodicon(icon: ThemeIcon, className?: string): HTMLElement {
	const element = renderIcon(icon);
	if (className) {
		element.classList.add(className);
	}
	element.setAttribute('aria-hidden', 'true');
	return element;
}
