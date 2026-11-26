/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../base/common/lifecycle.js';

export interface IBaseHalfSettingsPageLayout {
	readonly width: number;
	readonly height: number;
}

/**
 * A page of BaseHalf's Settings (BaseHalf's pages in Settings). Settings creates a page when it is
 * first shown and keeps it while Settings is open.
 */
export interface IBaseHalfSettingsPage extends IDisposable {
	create(parent: HTMLElement): void;
	/** What an opening asks the page to show, in the page's own form; nothing leaves the page as it is. */
	setInput(input: string | undefined): void;
	setVisible(visible: boolean): void;
	layout(dimension: IBaseHalfSettingsPageLayout): void;
	/** Puts the keyboard on the page: on what is selected in it, or on the page itself. */
	focus(): void;
}
