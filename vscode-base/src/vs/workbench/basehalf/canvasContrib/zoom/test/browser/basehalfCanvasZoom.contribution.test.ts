/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../../base/browser/window.js';
import { Emitter } from '../../../../../../base/common/event.js';
import { DisposableStore, IDisposable, toDisposable } from '../../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { IContextViewDelegate, IContextViewService } from '../../../../../../platform/contextview/browser/contextView.js';
import { TestInstantiationService } from '../../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IBaseHalfCanvasView } from '../../../../canvas/browser/basehalfCanvasExtensions.js';
import { BaseHalfCanvasZoomControls, baseHalfCanvasZoomFromPercentInput, formatBaseHalfCanvasZoomPercent } from '../../browser/basehalfCanvasZoom.contribution.js';

interface ITestCanvas extends IBaseHalfCanvasView {
	readonly calls: string[];
	reportZoom(zoom: number): void;
	hideViewControls(): void;
}

function createTestCanvas(store: Pick<DisposableStore, 'add'>, zoom = 1): ITestCanvas {
	const onDidChangeZoom = store.add(new Emitter<number>());
	const onDidHideViewControls = store.add(new Emitter<void>());
	const viewControls = mainWindow.document.createElement('div');
	mainWindow.document.body.appendChild(viewControls);
	store.add(toDisposable(() => viewControls.remove()));
	const calls: string[] = [];
	let current = zoom;
	return {
		calls,
		get zoom() { return current; },
		onDidChangeZoom: onDidChangeZoom.event,
		setZoom: value => calls.push(`setZoom ${value}`),
		zoomBy: direction => calls.push(`zoomBy ${direction}`),
		fitToScreen: () => calls.push('fitToScreen'),
		viewControls,
		onDidHideViewControls: onDidHideViewControls.event,
		reportZoom: value => {
			current = value;
			onDidChangeZoom.fire(value);
		},
		hideViewControls: () => onDidHideViewControls.fire(),
	};
}

/** Renders a context view into the page the way the workbench does, and hides it again. */
class TestContextViewService implements Partial<IContextViewService> {
	private shown: { readonly delegate: IContextViewDelegate; readonly container: HTMLElement; readonly rendered: IDisposable | undefined } | undefined;

	get menu(): HTMLElement | undefined {
		return this.shown?.container.querySelector<HTMLElement>('[data-testid="canvas-zoom-menu"]') ?? undefined;
	}

	showContextView(delegate: IContextViewDelegate) {
		this.hideContextView();
		const container = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(container);
		const rendered = delegate.render(container) ?? undefined;
		this.shown = { delegate, container, rendered };
		delegate.focus?.();
		return { close: () => this.hideContextView() };
	}

	hideContextView(data?: unknown): void {
		const shown = this.shown;
		if (!shown) {
			return;
		}
		this.shown = undefined;
		// As the workbench's context view: the delegate hears of it first, then its content goes.
		shown.delegate.onHide?.(data);
		shown.rendered?.dispose();
		shown.container.remove();
	}
}

suite('BaseHalfCanvasZoomControls', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createControls(zoom = 1): { canvas: ITestCanvas; contextView: TestContextViewService; controls: BaseHalfCanvasZoomControls; trigger: HTMLButtonElement } {
		const canvas = createTestCanvas(store, zoom);
		const contextView = new TestContextViewService();
		const instantiationService = store.add(new TestInstantiationService());
		instantiationService.stub(IContextViewService, contextView);
		const controls = store.add(instantiationService.createInstance(BaseHalfCanvasZoomControls, { canvas }));
		const trigger = canvas.viewControls.querySelector<HTMLButtonElement>('[data-testid="canvas-zoom-trigger"]');
		assert.ok(trigger);
		return { canvas, contextView, controls, trigger };
	}

	function menuAction(contextView: TestContextViewService, action: string): HTMLButtonElement {
		const button = contextView.menu?.querySelector<HTMLButtonElement>(`[data-zoom-action="${action}"]`);
		assert.ok(button, `the menu has the action ${action}`);
		return button;
	}

	function typeZoom(contextView: TestContextViewService, value: string): HTMLInputElement {
		const input = contextView.menu?.querySelector<HTMLInputElement>('[data-testid="canvas-zoom-input"]');
		assert.ok(input);
		input.value = value;
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		return input;
	}

	test('shows the zoom of the canvas on its button and follows it', () => {
		const { canvas, trigger } = createControls(1);
		assert.strictEqual(trigger.textContent, '100%');
		assert.strictEqual(trigger.getAttribute('aria-label'), 'Zoom options, 100%');

		canvas.reportZoom(0.5);
		assert.strictEqual(trigger.textContent, '50%');
		assert.strictEqual(trigger.title, 'Zoom options, 50%');
	});

	test('opens a menu whose actions step the zoom, fit the canvas, and choose a preset', () => {
		const { canvas, contextView, trigger } = createControls(1);
		trigger.click();
		assert.ok(contextView.menu);
		assert.strictEqual(trigger.getAttribute('aria-expanded'), 'true');
		assert.ok(trigger.classList.contains('open'));

		menuAction(contextView, 'in').click();
		assert.strictEqual(contextView.menu, undefined);
		assert.strictEqual(trigger.getAttribute('aria-expanded'), 'false');

		trigger.click();
		menuAction(contextView, 'out').click();
		trigger.click();
		menuAction(contextView, 'fit').click();
		trigger.click();
		menuAction(contextView, 'preset-50').click();
		trigger.click();
		menuAction(contextView, 'reset').click();
		assert.deepStrictEqual(canvas.calls, ['zoomBy 1', 'zoomBy -1', 'fitToScreen', 'setZoom 0.5', 'setZoom 1']);
	});

	test('takes a typed percentage and refuses one outside the zoom range', () => {
		const { canvas, contextView, trigger } = createControls(1);
		trigger.click();
		const input = typeZoom(contextView, '1000');
		assert.strictEqual(input.getAttribute('aria-invalid'), 'true');
		assert.ok(contextView.menu, 'the menu stays open on a value it refuses');
		assert.deepStrictEqual(canvas.calls, []);

		typeZoom(contextView, '250%');
		assert.strictEqual(contextView.menu, undefined);
		assert.deepStrictEqual(canvas.calls, ['setZoom 2.5']);
	});

	test('cannot step past the zoom range and marks the preset that is current', () => {
		const { contextView, trigger } = createControls(4);
		trigger.click();
		assert.strictEqual(menuAction(contextView, 'in').disabled, true);
		assert.strictEqual(menuAction(contextView, 'out').disabled, false);
		assert.strictEqual(menuAction(contextView, 'preset-400').getAttribute('aria-current'), 'true');
		assert.strictEqual(menuAction(contextView, 'reset').getAttribute('aria-current'), null);
	});

	test('follows a zoom that changes while its menu is open, but not into a percentage being typed', () => {
		const { canvas, contextView, trigger } = createControls(1);
		trigger.click();
		const input = contextView.menu?.querySelector<HTMLInputElement>('[data-testid="canvas-zoom-input"]');
		assert.ok(input);
		assert.strictEqual(input.ownerDocument.activeElement, input, 'the menu opens with the focus in its input');
		input.value = '3';
		canvas.reportZoom(0.2);
		assert.strictEqual(input.value, '3', 'what the user is typing stays');
		assert.strictEqual(menuAction(contextView, 'out').disabled, true);

		menuAction(contextView, 'in').focus();
		canvas.reportZoom(0.5);
		assert.strictEqual(input.value, '50');
		assert.strictEqual(menuAction(contextView, 'out').disabled, false);
	});

	test('closes its menu when the view controls are hidden', () => {
		const { canvas, contextView, trigger } = createControls(1);
		trigger.click();
		canvas.hideViewControls();
		assert.strictEqual(contextView.menu, undefined);
		assert.strictEqual(trigger.getAttribute('aria-expanded'), 'false');
	});

	test('closes its menu and removes its button when it is disposed', () => {
		const { canvas, contextView, controls, trigger } = createControls(1);
		trigger.click();
		controls.dispose();
		assert.strictEqual(contextView.menu, undefined);
		assert.strictEqual(trigger.isConnected, false);
		assert.strictEqual(canvas.viewControls.childElementCount, 0);
	});

	test('accepts bounded canvas zoom percentages without turning invalid input into reset', () => {
		assert.strictEqual(baseHalfCanvasZoomFromPercentInput('20'), 0.2);
		assert.strictEqual(baseHalfCanvasZoomFromPercentInput(' 37.5% '), 0.375);
		assert.strictEqual(baseHalfCanvasZoomFromPercentInput('400'), 4);
		assert.strictEqual(baseHalfCanvasZoomFromPercentInput('19.9'), undefined);
		assert.strictEqual(baseHalfCanvasZoomFromPercentInput('401%'), undefined);
		assert.strictEqual(baseHalfCanvasZoomFromPercentInput(''), undefined);
		assert.strictEqual(baseHalfCanvasZoomFromPercentInput('fit'), undefined);
		assert.strictEqual(formatBaseHalfCanvasZoomPercent(0.375), '37.5');
		assert.strictEqual(formatBaseHalfCanvasZoomPercent(1), '100');
		assert.strictEqual(formatBaseHalfCanvasZoomPercent(4), '400');
	});
});
