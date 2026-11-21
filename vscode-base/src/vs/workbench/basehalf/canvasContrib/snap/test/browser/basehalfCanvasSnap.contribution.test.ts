/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../../../../base/common/async.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { TestInstantiationService } from '../../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { createBaseHalfTestCanvasView } from '../../../../canvas/test/browser/basehalfCanvasViewFixture.js';
import { BaseHalfSetting } from '../../../../shell/common/basehalfConfiguration.js';
import { BaseHalfCanvasSnapToggle, baseHalfCanvasSnapFromSetting } from '../../browser/basehalfCanvasSnap.contribution.js';

suite('BaseHalfCanvasSnapToggle', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	/** The magnet on a canvas whose setting has `value`; with `refuseWrites`, in a settings file that cannot be written. */
	function createToggle(value?: unknown, refuseWrites = false) {
		const canvas = createBaseHalfTestCanvasView(store);
		const configurationService = new TestConfigurationService(value === undefined ? {} : { [BaseHalfSetting.CanvasSnap]: value });
		const written: unknown[] = [];
		const updateValue = configurationService.updateValue.bind(configurationService);
		configurationService.updateValue = async (key: string, next: unknown, ...rest: unknown[]) => {
			// No target is given: the base writes where the value in effect comes from.
			written.push([key, next, ...rest]);
			if (refuseWrites) {
				throw new Error('The settings file cannot be written.');
			}
			await updateValue(key, next);
			changeSetting(next);
		};
		/** The setting changes, as when a row of Settings or a settings file changes it. */
		const changeSetting = (next: unknown) => {
			configurationService.setUserConfiguration(BaseHalfSetting.CanvasSnap, next);
			configurationService.onDidChangeConfigurationEmitter.fire({
				affectsConfiguration: (key: string) => key === BaseHalfSetting.CanvasSnap,
				affectedKeys: new Set([BaseHalfSetting.CanvasSnap]),
				change: { keys: [BaseHalfSetting.CanvasSnap], overrides: [] },
				source: ConfigurationTarget.USER
			});
		};
		const instantiationService = store.add(new TestInstantiationService());
		instantiationService.stub(IConfigurationService, configurationService);
		const toggle = store.add(instantiationService.createInstance(BaseHalfCanvasSnapToggle, { canvas }));
		const button = canvas.viewControls.querySelector<HTMLButtonElement>('[data-testid="canvas-snap-toggle"]');
		assert.ok(button);
		const state = () => `${button.getAttribute('aria-pressed')}${button.classList.contains('active') ? ' active' : ''}`;
		return { canvas, toggle, button, written, changeSetting, state };
	}

	test('cards snap unless the setting says that they do not', () => {
		assert.deepStrictEqual(
			[undefined, true, false, 'no', 0].map(baseHalfCanvasSnapFromSetting),
			[true, true, false, true, true]
		);
	});

	test('the magnet shows the setting when the canvas starts, and tells the canvas', () => {
		const on = createToggle();
		const off = createToggle(false);
		assert.deepStrictEqual({
			on: [on.state(), on.button.getAttribute('aria-label'), on.canvas.calls],
			off: [off.state(), off.canvas.calls]
		}, {
			on: ['true active', 'Snap to Cards', ['setSnapEnabled true']],
			off: ['false', ['setSnapEnabled false']]
		});
	});

	test('a click shows the new state at once and writes the setting with no target, as a row of Settings does', async () => {
		const { canvas, button, written, state } = createToggle();
		button.click();
		const atOnce = state();
		await timeout(0);
		button.click();
		await timeout(0);
		assert.deepStrictEqual({ atOnce, after: state(), written, calls: canvas.calls }, {
			atOnce: 'false',
			after: 'true active',
			written: [[BaseHalfSetting.CanvasSnap, false], [BaseHalfSetting.CanvasSnap, true]],
			calls: ['setSnapEnabled true', 'setSnapEnabled false', 'setSnapEnabled true']
		});
	});

	test('the setting changed elsewhere changes the magnet and the canvas at once', () => {
		const { canvas, changeSetting, state } = createToggle();
		changeSetting(false);
		const off = state();
		changeSetting(true);
		assert.deepStrictEqual({ off, on: state(), calls: canvas.calls }, {
			off: 'false',
			on: 'true active',
			calls: ['setSnapEnabled true', 'setSnapEnabled false', 'setSnapEnabled true']
		});
	});

	test('a write that fails leaves the setting: the magnet shows it again, and the canvas says so', async () => {
		const { canvas, button, state } = createToggle(undefined, true);
		button.click();
		const atOnce = state();
		await timeout(0);
		assert.deepStrictEqual({ atOnce, after: state(), calls: canvas.calls }, {
			atOnce: 'false',
			after: 'true active',
			calls: ['setSnapEnabled true', 'setSnapEnabled false', 'setSnapEnabled true', 'reportError The settings file cannot be written.']
		});
	});

	test('removes its button when it is disposed', () => {
		const { canvas, toggle, button } = createToggle();
		toggle.dispose();
		assert.strictEqual(button.isConnected, false);
		assert.strictEqual(canvas.viewControls.childElementCount, 0);
	});
});
