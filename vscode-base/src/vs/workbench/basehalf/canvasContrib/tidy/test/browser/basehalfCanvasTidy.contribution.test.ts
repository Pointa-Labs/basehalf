/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../../base/browser/window.js';
import { timeout } from '../../../../../../base/common/async.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { TestInstantiationService } from '../../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IBaseHalfCanvasViewScene } from '../../../../canvas/browser/basehalfCanvasExtensions.js';
import { baseHalfCanvasTidy } from '../../../../canvas/common/basehalfCanvasArrangement.js';
import { baseHalfTestSceneCard, baseHalfTestSceneEdge, createBaseHalfTestCanvasView, IBaseHalfTestCanvasView } from '../../../../canvas/test/browser/basehalfCanvasViewFixture.js';
import { IBaseHalfCanvasNavigationService, IBaseHalfCanvasNavigationState } from '../../../../navigation/common/basehalfCanvasNavigation.js';
import { BaseHalfCanvasTidy } from '../../browser/basehalfCanvasTidy.contribution.js';

/** Three connected cards in a row that a tidy lays out again. */
function untidyScene(key = 'folder'): IBaseHalfCanvasViewScene {
	return {
		key,
		structuralEpoch: 3,
		cards: [baseHalfTestSceneCard('a.md', 500, 400), baseHalfTestSceneCard('b.md', 0, 0), baseHalfTestSceneCard('c.md', 900, 50)],
		edges: [baseHalfTestSceneEdge('a.md', 'b.md'), baseHalfTestSceneEdge('b.md', 'c.md')]
	};
}

/** The place a tidy gives each card of a scene, as the layout keeps it. */
function tidyPlaceOf(scene: IBaseHalfCanvasViewScene): Map<string, { readonly x: number; readonly y: number }> {
	const stored = (value: number) => Number(value.toFixed(4));
	return new Map(baseHalfCanvasTidy(scene.cards, scene.edges).map(place => [place.path, { x: stored(place.x), y: stored(place.y) }]));
}

function tidyPlaces(scene: IBaseHalfCanvasViewScene): string {
	const placeOf = tidyPlaceOf(scene);
	return scene.cards.map(card => `${card.path} ${placeOf.get(card.path)!.x},${placeOf.get(card.path)!.y}`).join('; ');
}

/** The cards a tidy moves, at the places they had before it. */
function placesBeforeTidy(scene: IBaseHalfCanvasViewScene): string {
	const placeOf = tidyPlaceOf(scene);
	return scene.cards.filter(card => placeOf.get(card.path)!.x !== card.x || placeOf.get(card.path)!.y !== card.y).map(card => `${card.path} ${card.x},${card.y}`).join('; ');
}

suite('BaseHalfCanvasTidy', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let navigationState: IBaseHalfCanvasNavigationState;

	function createTidy(scene: IBaseHalfCanvasViewScene = untidyScene()) {
		navigationState = { canvasFolder: undefined, cardDetail: undefined };
		const canvas = createBaseHalfTestCanvasView(store, { scene, viewport: { x: 10, y: 20, zoom: 0.5 } });
		const instantiationService = store.add(new TestInstantiationService());
		instantiationService.stub(IBaseHalfCanvasNavigationService, { get state() { return navigationState; } });
		const tidy = store.add(instantiationService.createInstance(BaseHalfCanvasTidy, { canvas }));
		const button = canvas.viewControls.querySelector<HTMLButtonElement>('[data-testid="canvas-tidy"]');
		assert.ok(button);
		return { canvas, tidy, button };
	}

	function questionOf(canvas: IBaseHalfTestCanvasView): HTMLElement | null {
		return canvas.viewControlsCorner.querySelector<HTMLElement>('[data-testid="canvas-tidy-question"]');
	}

	async function tidyByClick(canvas: IBaseHalfTestCanvasView, button: HTMLButtonElement): Promise<HTMLElement> {
		button.click();
		await timeout(0);
		const question = questionOf(canvas);
		assert.ok(question, 'a tidy that moved a card asks whether to keep it');
		return question;
	}

	test('can be used once the canvas has two cards', () => {
		const { canvas, button } = createTidy({ key: 'folder', structuralEpoch: 1, cards: [baseHalfTestSceneCard('a.md', 0, 0)], edges: [] });
		assert.strictEqual(button.disabled, true);
		assert.match(button.getAttribute('aria-label') ?? '', /^Tidy Canvas \(/);
		canvas.showScene(untidyScene());
		assert.strictEqual(button.disabled, false);
	});

	test('closes the note being edited, lays the cards out in one step of undo, fits the view, and asks', async () => {
		const scene = untidyScene();
		const { canvas, button } = createTidy(scene);
		const question = await tidyByClick(canvas, button);
		assert.deepStrictEqual(canvas.calls, ['closeNoteEditor', `moveCards folder@3 Tidy canvas: ${tidyPlaces(scene)}`, 'fitToScreen']);
		assert.strictEqual(question.getAttribute('role'), 'group');
		assert.strictEqual(question.getAttribute('aria-label'), 'Keep this arrangement?');
	});

	test('asks nothing when no card had to move', async () => {
		const untidy = untidyScene();
		const placeOf = tidyPlaceOf(untidy);
		const tidied: IBaseHalfCanvasViewScene = {
			...untidy,
			cards: untidy.cards.map(card => baseHalfTestSceneCard(card.path, placeOf.get(card.path)!.x, placeOf.get(card.path)!.y))
		};
		const { canvas, button } = createTidy(tidied);
		button.click();
		await timeout(0);
		assert.strictEqual(questionOf(canvas), null);
		assert.ok(canvas.calls.includes('fitToScreen'));
	});

	test('Keep closes the question, changes no place, and gives the focus back to the canvas', async () => {
		const { canvas, button } = createTidy();
		const question = await tidyByClick(canvas, button);
		const keep = question.querySelector<HTMLButtonElement>('[data-testid="canvas-tidy-keep"]');
		assert.ok(keep);
		keep.focus();
		keep.click();
		assert.strictEqual(questionOf(canvas), null);
		assert.strictEqual(canvas.calls.at(-1), 'focus');
		assert.ok(!canvas.calls.some(call => call.startsWith('restoreCardPlaces')));
	});

	test('Revert puts every moved card back and shows what the view showed before', async () => {
		const scene = untidyScene();
		const { canvas, button } = createTidy(scene);
		const question = await tidyByClick(canvas, button);
		canvas.calls.length = 0;
		question.querySelector<HTMLButtonElement>('[data-testid="canvas-tidy-revert"]')!.click();
		await timeout(0);
		assert.strictEqual(questionOf(canvas), null);
		assert.notStrictEqual(placesBeforeTidy(scene), '');
		assert.deepStrictEqual(canvas.calls, [
			`restoreCardPlaces folder Revert tidy: ${placesBeforeTidy(scene)}`,
			'setViewport folder 10,20,0.5'
		]);
	});

	test('undo of the tidy closes the question', async () => {
		const { canvas, button } = createTidy();
		await tidyByClick(canvas, button);
		canvas.undoOrRedoLastMove(false);
		assert.ok(questionOf(canvas), 'doing the tidy again leaves the question');
		canvas.undoOrRedoLastMove(true);
		assert.strictEqual(questionOf(canvas), null);
	});

	test('keeps the question while the canvas is drawn again, and closes it when another canvas is shown', async () => {
		const { canvas, button } = createTidy();
		await tidyByClick(canvas, button);
		canvas.showScene(untidyScene());
		assert.ok(questionOf(canvas));
		canvas.showScene(untidyScene('another folder'));
		assert.strictEqual(questionOf(canvas), null);
	});

	test('Shift+Alt+F tidies, but not in a field the user types in, and not over Card Detail', async () => {
		const { canvas } = createTidy();
		const input = mainWindow.document.createElement('input');
		const typed = canvas.pressKey({ code: 'KeyF', key: 'Ï', shiftKey: true, altKey: true }, input);
		assert.strictEqual(typed.defaultPrevented, false);
		navigationState = { canvasFolder: undefined, cardDetail: {} as never };
		const overDetail = canvas.pressKey({ code: 'KeyF', key: 'Ï', shiftKey: true, altKey: true });
		assert.strictEqual(overDetail.defaultPrevented, false);
		await timeout(0);
		assert.deepStrictEqual(canvas.calls, []);

		navigationState = { canvasFolder: undefined, cardDetail: undefined };
		const pressed = canvas.pressKey({ code: 'KeyF', key: 'Ï', shiftKey: true, altKey: true });
		assert.strictEqual(pressed.defaultPrevented, true);
		await timeout(0);
		assert.ok(questionOf(canvas));
	});

	test('does nothing when the note being edited stays open', async () => {
		const { canvas, button } = createTidy();
		canvas.noteEditorCloses = false;
		button.click();
		await timeout(0);
		assert.deepStrictEqual(canvas.calls, ['closeNoteEditor']);
		assert.strictEqual(questionOf(canvas), null);
	});

	test('says why when the new places cannot be saved, and asks nothing', async () => {
		const { canvas, button } = createTidy();
		canvas.failNextMove(new Error('Couldn\'t save the card position: the disk is full'));
		button.click();
		await timeout(0);
		assert.strictEqual(canvas.calls.at(-1), 'reportError Couldn\'t save the card position: the disk is full');
		assert.strictEqual(questionOf(canvas), null);
	});

	test('removes its button and its question when it is disposed', async () => {
		const { canvas, tidy, button } = createTidy();
		await tidyByClick(canvas, button);
		tidy.dispose();
		assert.strictEqual(button.isConnected, false);
		assert.strictEqual(questionOf(canvas), null);
	});
});
