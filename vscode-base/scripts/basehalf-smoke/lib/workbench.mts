/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The window's own controls.

// Where the title bar shows the layout controls (docs/specs/layout-controls.md).
export function readLayoutControls(page) {
	return page.evaluate(() => {
		const labels = selector => Array.from(document.querySelectorAll(selector)).map(node => node.getAttribute('aria-label') ?? '');
		const button = document.querySelector('.part.titlebar .titlebar-left .left-toolbar-container .action-label');
		const rect = button?.getBoundingClientRect();
		const topmost = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
		return {
			left: labels('.part.titlebar .titlebar-left .left-toolbar-container .action-label'),
			right: labels('.part.titlebar .titlebar-right .action-toolbar-container .action-label'),
			rect: rect ? [rect.left, rect.top, rect.width, rect.height] : undefined,
			// "Visible" does not see a control that another element covers.
			onTop: !!button && !!topmost && (topmost === button || button.contains(topmost)),
			fullscreen: !!document.querySelector('.monaco-workbench.fullscreen')
		};
	});
}
