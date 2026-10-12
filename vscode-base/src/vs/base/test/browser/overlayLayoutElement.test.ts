/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { OverlayLayoutElement } from '../../browser/overlayLayoutElement.js';
import { mainWindow } from '../../browser/window.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../common/utils.js';

suite('OverlayLayoutElement', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('an overlay that clips takes the level itself, because the level of its content does not reach outside an element that clips', () => {
		// An area with a level, as the editor area of BaseHalf has one, and what the overlay is placed over inside it.
		const area = mainWindow.document.createElement('div');
		area.style.position = 'relative';
		area.style.zIndex = '1';
		const anchor = area.appendChild(mainWindow.document.createElement('div'));
		const clippingContainer = mainWindow.document.createElement('div');
		mainWindow.document.body.append(area, clippingContainer);
		store.add({ dispose: () => { area.remove(); clippingContainer.remove(); } });

		const clipped = store.add(new OverlayLayoutElement());
		const free = store.add(new OverlayLayoutElement());
		const levels = (overlay: OverlayLayoutElement) => ({ root: overlay.root.style.zIndex, content: overlay.content.style.zIndex, clips: overlay.root.style.clipPath });

		clipped.setAnchorElement(anchor, { clippingContainer });
		free.setAnchorElement(anchor);
		const first = { clipped: levels(clipped), free: levels(free) };

		// The level of the area changes, and the next layout follows it.
		area.style.zIndex = '4';
		clipped.setAnchorElement(anchor, { clippingContainer });
		const afterTheAreaChanged = levels(clipped);
		// It stops clipping: its content carries the level again.
		clipped.setAnchorElement(anchor);

		assert.deepStrictEqual({ first, afterTheAreaChanged, withoutClipping: levels(clipped) }, {
			first: {
				clipped: { root: '2', content: '2', clips: 'content-box' },
				free: { root: '', content: '2', clips: '' }
			},
			afterTheAreaChanged: { root: '5', content: '5', clips: 'content-box' },
			withoutClipping: { root: '', content: '5', clips: '' }
		});
	});
});
