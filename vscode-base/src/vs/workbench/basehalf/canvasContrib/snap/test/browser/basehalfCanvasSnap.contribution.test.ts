/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { TestInstantiationService } from '../../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { createBaseHalfTestCanvasView } from '../../../../canvas/test/browser/basehalfCanvasViewFixture.js';
import { BaseHalfCanvasSnapToggle } from '../../browser/basehalfCanvasSnap.contribution.js';

suite('BaseHalfCanvasSnapToggle', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createToggle() {
		const canvas = createBaseHalfTestCanvasView(store);
		const instantiationService = store.add(new TestInstantiationService());
		const toggle = store.add(instantiationService.createInstance(BaseHalfCanvasSnapToggle, { canvas }));
		const button = canvas.viewControls.querySelector<HTMLButtonElement>('[data-testid="canvas-snap-toggle"]');
		assert.ok(button);
		return { canvas, toggle, button };
	}

	test('shows that snapping is on when the canvas starts, without asking the canvas', () => {
		const { canvas, button } = createToggle();
		assert.strictEqual(button.getAttribute('aria-pressed'), 'true');
		assert.ok(button.classList.contains('active'));
		assert.strictEqual(button.getAttribute('aria-label'), 'Snap to cards');
		assert.deepStrictEqual(canvas.calls, []);
	});

	test('turns snapping off and on again', () => {
		const { canvas, button } = createToggle();
		button.click();
		assert.strictEqual(button.getAttribute('aria-pressed'), 'false');
		assert.ok(!button.classList.contains('active'));
		button.click();
		assert.strictEqual(button.getAttribute('aria-pressed'), 'true');
		assert.deepStrictEqual(canvas.calls, ['setSnapEnabled false', 'setSnapEnabled true']);
	});

	test('removes its button when it is disposed', () => {
		const { canvas, toggle, button } = createToggle();
		toggle.dispose();
		assert.strictEqual(button.isConnected, false);
		assert.strictEqual(canvas.viewControls.childElementCount, 0);
	});
});
