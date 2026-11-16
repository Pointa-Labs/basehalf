/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { element } from './readerDom.js';

/** The name of a control that shows only an icon, under the pointer after half a second, as the workbench's hovers come. */
export function installReaderHover(root: HTMLElement): void {
	const hover = element('div', 'reader-hover', root);
	hover.setAttribute('role', 'tooltip');
	hover.hidden = true;
	let timer: number | undefined;
	document.addEventListener('pointerover', event => {
		const target = (event.target as Element | null)?.closest?.<HTMLElement>('[data-hover]');
		window.clearTimeout(timer);
		if (!target) {
			hover.hidden = true;
			return;
		}
		timer = window.setTimeout(() => {
			if (!target.isConnected) {
				return;
			}
			hover.textContent = target.dataset.hover ?? '';
			hover.hidden = false;
			const box = target.getBoundingClientRect();
			const below = box.bottom + 6 + hover.offsetHeight < window.innerHeight;
			hover.style.top = `${below ? box.bottom + 6 : box.top - hover.offsetHeight - 6}px`;
			hover.style.left = `${Math.min(Math.max(6, box.left + box.width / 2 - hover.offsetWidth / 2), window.innerWidth - hover.offsetWidth - 6)}px`;
		}, 500);
	});
	document.addEventListener('pointerdown', () => {
		window.clearTimeout(timer);
		hover.hidden = true;
	}, { capture: true });
}
