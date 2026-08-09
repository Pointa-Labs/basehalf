/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { baseHalfMarkdownRichColdFlushResult } from '../../common/basehalfMarkdownRichFlush.js';
import {
	applyBaseHalfMarkdownRichFirstFrameState,
	baseHalfMarkdownRichColdGenerationAction,
	baseHalfMarkdownRichFirstFrameAcknowledgement,
	baseHalfMarkdownRichShouldGuardQuickInput,
	BaseHalfMarkdownRichQuickInputFocusGuard,
	setBaseHalfMarkdownRichInteractionEnabled
} from '../../browser/cardDetail/basehalfMarkdownRichCardDetail.js';

suite('BaseHalfMarkdownRichCardDetail', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('keeps a cold rich webview inert until its focus boundary settles', () => {
		const surface = document.createElement('div');
		const host = document.createElement('div');
		surface.append(host);

		applyBaseHalfMarkdownRichFirstFrameState(surface, host, 'booting');
		assert.strictEqual(host.inert, true);
		assert.strictEqual(host.getAttribute('aria-busy'), 'true');
		assert.strictEqual(host.dataset.basehalfRenderState, 'booting');
		assert.strictEqual(surface.dataset.basehalfRenderState, 'booting');
		assert.strictEqual(host.hasAttribute('data-basehalf-rendered'), false);
		assert.strictEqual(surface.hasAttribute('data-basehalf-rendered'), false);
		assert.strictEqual(baseHalfMarkdownRichColdFlushResult(false, false), true);

		applyBaseHalfMarkdownRichFirstFrameState(surface, host, 'settling');
		assert.strictEqual(host.inert, true);
		assert.strictEqual(host.getAttribute('aria-busy'), 'true');
		assert.strictEqual(host.dataset.basehalfRenderState, 'settling');
		assert.strictEqual(surface.dataset.basehalfRenderState, 'settling');
		assert.strictEqual(host.hasAttribute('data-basehalf-rendered'), false);
		assert.strictEqual(surface.hasAttribute('data-basehalf-rendered'), false);

		applyBaseHalfMarkdownRichFirstFrameState(surface, host, 'rendered');
		assert.strictEqual(host.inert, false);
		assert.strictEqual(host.hasAttribute('aria-busy'), false);
		assert.strictEqual(host.dataset.basehalfRenderState, 'rendered');
		assert.strictEqual(surface.dataset.basehalfRenderState, 'rendered');
		assert.strictEqual(host.hasAttribute('data-basehalf-rendered'), true);
		assert.strictEqual(surface.hasAttribute('data-basehalf-rendered'), true);
	});

	test('keeps a paused cold generation inert without claiming a rendered editor', () => {
		const surface = document.createElement('div');
		const host = document.createElement('div');
		surface.append(host);

		applyBaseHalfMarkdownRichFirstFrameState(surface, host, 'booting');
		applyBaseHalfMarkdownRichFirstFrameState(surface, host, 'paused');

		assert.strictEqual(host.inert, true);
		assert.strictEqual(host.getAttribute('aria-busy'), 'true');
		assert.strictEqual(host.dataset.basehalfRenderState, 'paused');
		assert.strictEqual(surface.dataset.basehalfRenderState, 'paused');
		assert.strictEqual(host.hasAttribute('data-basehalf-rendered'), false);
		assert.strictEqual(surface.hasAttribute('data-basehalf-rendered'), false);

		applyBaseHalfMarkdownRichFirstFrameState(surface, host, 'booting');
		setBaseHalfMarkdownRichInteractionEnabled(host, true);
		assert.strictEqual(host.inert, false);
		assert.strictEqual(host.dataset.basehalfRenderState, 'booting');
	});

	test('only runs a cold iframe generation while Quick Input is absent', () => {
		assert.strictEqual(baseHalfMarkdownRichColdGenerationAction('booting', false, false), 'mount');
		assert.strictEqual(baseHalfMarkdownRichColdGenerationAction('settling', false, false), 'mount');
		assert.strictEqual(baseHalfMarkdownRichColdGenerationAction('paused', false, false), 'mount');
		assert.strictEqual(baseHalfMarkdownRichColdGenerationAction('booting', false, true), 'pause');
		assert.strictEqual(baseHalfMarkdownRichColdGenerationAction('settling', false, true), 'pause');
		assert.strictEqual(baseHalfMarkdownRichColdGenerationAction('paused', false, true), 'pause');
		for (const terminal of ['rendered', 'error', 'timeout'] as const) {
			assert.strictEqual(baseHalfMarkdownRichColdGenerationAction(terminal, false, false), 'keep');
			assert.strictEqual(baseHalfMarkdownRichColdGenerationAction(terminal, false, true), 'keep');
		}
		assert.strictEqual(baseHalfMarkdownRichColdGenerationAction('booting', true, true), 'keep');
		assert.strictEqual(baseHalfMarkdownRichColdGenerationAction('settling', true, true), 'keep');
	});

	test('requires the rendered commit before accepting the focus-boundary acknowledgement', () => {
		assert.strictEqual(baseHalfMarkdownRichFirstFrameAcknowledgement('booting', 'focusBoundarySettled'), 'booting');
		assert.strictEqual(baseHalfMarkdownRichFirstFrameAcknowledgement('booting', 'rendered'), 'settling');
		assert.strictEqual(baseHalfMarkdownRichFirstFrameAcknowledgement('settling', 'focusBoundarySettled'), 'rendered');
		assert.strictEqual(baseHalfMarkdownRichFirstFrameAcknowledgement('paused', 'rendered'), 'paused');
		assert.strictEqual(baseHalfMarkdownRichFirstFrameAcknowledgement('rendered', 'focusBoundarySettled'), 'rendered');
	});

	test('restores each guarded Quick Input focus-out policy exactly', () => {
		const guard = new BaseHalfMarkdownRichQuickInputFocusGuard<{ ignoreFocusOut: boolean }, object>();
		const first = { ignoreFocusOut: false };
		const second = { ignoreFocusOut: true };
		const firstGeneration = {};
		const secondGeneration = {};

		guard.guard(first, firstGeneration);
		assert.strictEqual(guard.target, first);
		assert.strictEqual(first.ignoreFocusOut, true);
		guard.guard(second, secondGeneration);
		assert.strictEqual(first.ignoreFocusOut, false);
		assert.strictEqual(second.ignoreFocusOut, true);
		assert.strictEqual(guard.target, second);

		guard.restore();
		assert.strictEqual(second.ignoreFocusOut, true);
		assert.strictEqual(guard.target, undefined);
	});

	test('retains picker ownership through a late webview focus after the boundary acknowledgement', () => {
		const guard = new BaseHalfMarkdownRichQuickInputFocusGuard<{ ignoreFocusOut: boolean }, object>();
		const picker = { ignoreFocusOut: false };
		const generation = {};

		guard.guard(picker, generation);
		// The boundary acknowledgement moves the host to paused, but does not
		// end this ownership guard: WebviewElement.onDidFocus may arrive later.
		assert.strictEqual(guard.owns(picker, generation), true);
		assert.strictEqual(picker.ignoreFocusOut, true);
		assert.strictEqual(guard.owns(picker, {}), false);

		guard.restore();
		assert.strictEqual(picker.ignoreFocusOut, false);
		assert.strictEqual(guard.owns(picker, generation), false);
	});

	test('guards Quick Input opened after the first frame rendered before a late webview focus', () => {
		const guard = new BaseHalfMarkdownRichQuickInputFocusGuard<{ ignoreFocusOut: boolean }, object>();
		const picker = { ignoreFocusOut: false };
		const renderedGeneration = {};

		assert.strictEqual(baseHalfMarkdownRichShouldGuardQuickInput(true, true, true), true);
		guard.guard(picker, renderedGeneration);
		assert.strictEqual(guard.owns(picker, renderedGeneration), true);
		assert.strictEqual(picker.ignoreFocusOut, true);

		assert.strictEqual(baseHalfMarkdownRichShouldGuardQuickInput(false, true, true), false);
		assert.strictEqual(baseHalfMarkdownRichShouldGuardQuickInput(true, false, true), false);
		assert.strictEqual(baseHalfMarkdownRichShouldGuardQuickInput(true, true, false), false);
		guard.restore();
		assert.strictEqual(picker.ignoreFocusOut, false);
	});

	test('releases error and timeout notices without claiming a rendered editor', () => {
		for (const state of ['error', 'timeout'] as const) {
			const surface = document.createElement('div');
			const host = document.createElement('div');
			applyBaseHalfMarkdownRichFirstFrameState(surface, host, 'booting');
			applyBaseHalfMarkdownRichFirstFrameState(surface, host, state);

			assert.strictEqual(host.inert, false);
			assert.strictEqual(host.hasAttribute('aria-busy'), false);
			assert.strictEqual(host.dataset.basehalfRenderState, state);
			assert.strictEqual(surface.dataset.basehalfRenderState, state);
			assert.strictEqual(host.hasAttribute('data-basehalf-rendered'), false);
			assert.strictEqual(surface.hasAttribute('data-basehalf-rendered'), false);
		}
	});
});
