/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The window at startup: the canvas of a fresh workspace, the product's look, the title bar, and the Welcome of a new window.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { observePage, setNativeWindowContentSize, SMOKE_WINDOW_CONTENT_SIZE } from '../../app.mts';
import { root, workspacePath } from '../../context.mts';
import {
	BH_IGNORE_FILE,
	bhTreeBeforeLaunch,
	gitStatusBeforeLaunch,
	gitStatusOfWorkspace,
	readBhTree
} from '../../fixture.mts';
import { readCanvasCardGeometry, readCanvasCardPlaces } from '../../lib/canvas.mts';
import { runCommand, visibleQuickInput } from '../../lib/quickInput.mts';
import { readLayoutControls } from '../../lib/workbench.mts';

export async function assertNewWindowBaseHalfWelcome(application, workspacePage) {
	await workspacePage.locator('.gettingStartedContainer').waitFor({ state: 'detached', timeout: 30_000 });
	const workspaceEditorPart = workspacePage.locator('.part.editor.basehalf-canvas-host');
	if (!await workspaceEditorPart.evaluate(element => element.classList.contains('basehalf-canvas-on-top'))) {
		throw new Error('A non-empty workspace did not return to the BaseHalf canvas after the competing Welcome editor opened.');
	}

	const existingWindows = new Set(application.windows());
	const [welcomePage] = await Promise.all([
		application.waitForEvent('window', { timeout: 60_000 }),
		runCommand(workspacePage, 'New Window')
	]);
	if (existingWindows.has(welcomePage)) {
		throw new Error('The New Window command did not create a distinct Electron window.');
	}

	observePage(welcomePage, 'new-window');
	await setNativeWindowContentSize(application, welcomePage, SMOKE_WINDOW_CONTENT_SIZE);
	await welcomePage.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });
	const welcome = welcomePage.locator('.gettingStartedContainer');
	await welcome.waitFor({ state: 'visible', timeout: 60_000 });
	const heading = welcome.locator('h1.product-name', { hasText: 'BaseHalf' });
	await heading.waitFor({ state: 'visible', timeout: 15_000 });
	await welcome.locator('button', { hasText: 'Open Folder as Canvas' }).first().waitFor({ state: 'visible', timeout: 15_000 });
	await welcome.getByText('Recent Canvases', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
	await welcomePage.locator('.basehalf-canvas-empty', { hasText: 'No folder' }).waitFor({ state: 'attached', timeout: 15_000 });

	const layerState = await welcomePage.evaluate(() => {
		const editorPart = document.querySelector('.part.editor.basehalf-canvas-host');
		const welcomeContainer = document.querySelector('.gettingStartedContainer');
		const productHeading = welcomeContainer?.querySelector('h1.product-name');
		if (!(productHeading instanceof HTMLElement)) {
			return { canvasOnTop: editorPart?.classList.contains('basehalf-canvas-on-top') ?? false, welcomeTopmost: false };
		}
		const bounds = productHeading.getBoundingClientRect();
		const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
		return {
			canvasOnTop: editorPart?.classList.contains('basehalf-canvas-on-top') ?? false,
			welcomeTopmost: hit?.closest('.gettingStartedContainer') === welcomeContainer
		};
	});
	if (layerState.canvasOnTop || !layerState.welcomeTopmost) {
		throw new Error(`The BaseHalf Welcome surface is obscured by the empty canvas: ${JSON.stringify(layerState)}`);
	}

	await welcomePage.close();
	await workspacePage.bringToFront();
	await workspacePage.locator('.basehalf-canvas-workbench').waitFor({ state: 'visible', timeout: 15_000 });
}

export async function assertProductThemeAndCards(page) {
	// The product color theme comes from the default themes extension. When it
	// is not loaded the window keeps its startup colors, and a color that an
	// extension contributes, such as a Git status color, has no value. The
	// theme loads after the extensions are registered, so wait for it.
	const started = Date.now();
	let state;
	while (Date.now() - started < 20_000) {
		state = await page.evaluate(() => {
			const workbench = document.querySelector('.monaco-workbench');
			const sidebar = document.querySelector('.part.sidebar');
			const editor = document.querySelector('.part.editor');
			return {
				gitModifiedColor: getComputedStyle(workbench).getPropertyValue('--vscode-gitDecoration-modifiedResourceForeground').trim(),
				themeClasses: [...workbench.classList].filter(name => name.startsWith('vscode-theme-')),
				floatingPanels: workbench.classList.contains('floating-panels'),
				sidebarRadius: sidebar ? parseFloat(getComputedStyle(sidebar).borderTopLeftRadius) : 0,
				// The gap between the sidebar card and the canvas card.
				cardGap: sidebar && editor ? Math.round(editor.getBoundingClientRect().left - sidebar.getBoundingClientRect().right) : -1
			};
		});
		if (state.gitModifiedColor && state.themeClasses.length && state.floatingPanels && state.sidebarRadius === 8 && state.cardGap === 4) {
			return;
		}
		await page.waitForTimeout(200);
	}
	throw new Error(`The product theme or the card layout is not applied: ${JSON.stringify(state)}`);
}

export async function assertLayoutControlAtTheLeftEnd(page) {
	const button = page.locator('.part.titlebar .titlebar-left .left-toolbar-container .action-label');
	const sideBar = page.locator('[id="workbench.parts.sidebar"]');
	await button.first().waitFor({ state: 'visible', timeout: 15_000 });
	await sideBar.waitFor({ state: 'visible', timeout: 8_000 });

	// The control of the sidebar is at the left end, once, and not in the
	// right group.
	const shown = await readLayoutControls(page);
	if (shown.left.length !== 1 || !shown.left[0].startsWith('Toggle Primary Side Bar') || !shown.onTop) {
		throw new Error(`The left end of the title bar does not hold the control of the sidebar: ${JSON.stringify(shown)}`);
	}
	if (shown.right.some(label => label.startsWith('Toggle Primary Side Bar'))) {
		throw new Error(`The right group of the title bar still holds the control of the sidebar: ${JSON.stringify(shown.right)}`);
	}
	// The panel's command opens the Agent Area, which has its own control
	// there, so the right group has no control of the panel.
	const firstToggle = shown.right.find(label => label.startsWith('Toggle '));
	if (shown.right.some(label => label.startsWith('Toggle Panel')) || !firstToggle?.startsWith('Toggle Secondary Side Bar')) {
		throw new Error(`The right group of the title bar must start its layout controls with the Agent Area's and hold none of the panel: ${JSON.stringify(shown.right)}`);
	}
	// On macOS it follows the window buttons.
	if (process.platform === 'darwin' && !shown.fullscreen && Math.abs(shown.rect[0] - 80) > 0.5) {
		throw new Error(`The control of the sidebar is not 80 px from the left edge of the window: ${JSON.stringify(shown.rect)}`);
	}

	// It hides the sidebar and stays where it is.
	await button.click();
	await sideBar.waitFor({ state: 'hidden', timeout: 8_000 });
	const hidden = await readLayoutControls(page);
	if (JSON.stringify(hidden.rect) !== JSON.stringify(shown.rect) || !hidden.onTop) {
		throw new Error(`The control of the sidebar moved when the sidebar was hidden: ${JSON.stringify({ shown: shown.rect, hidden: hidden.rect, onTop: hidden.onTop })}`);
	}

	// Leave the window as it was, with the pointer off the control so that its
	// tooltip does not stay over the sidebar.
	await button.click();
	await sideBar.waitFor({ state: 'visible', timeout: 8_000 });
	await page.mouse.move(640, await page.evaluate(() => window.innerHeight - 6));
}

export async function assertBaseHalfRootTitlebarBreadcrumb(page) {
	const breadcrumbs = page.locator('.basehalf-command-center-breadcrumbs');
	await breadcrumbs.waitFor({ state: 'visible', timeout: 15_000 });
	const labels = (await breadcrumbs.locator('.basehalf-command-center-breadcrumb-segment').allTextContents()).map(label => label.trim());
	const workspaceName = path.basename(workspacePath);
	if (labels.length !== 1 || labels[0] !== workspaceName) {
		throw new Error(`Unexpected root canvas breadcrumb path: ${JSON.stringify(labels)}`);
	}
	const current = breadcrumbs.locator('[aria-current="page"]');
	if (await current.textContent() !== workspaceName) {
		throw new Error('The workspace root is not the current breadcrumb segment');
	}
	await page.locator('.basehalf-command-center-search[aria-label]').waitFor({ state: 'visible', timeout: 10_000 });
}

// The location in the title bar is one button for the search, but for its
// folders (docs/specs/title-bar-location.md). A press on it leaves the
// keyboard where it was, and shortcuts work while the keyboard is in it.
export async function assertTitleBarLocationOpensSearch(page) {
	const quickInput = visibleQuickInput(page);
	const quickOpenKey = process.platform === 'darwin' ? 'Meta+P' : 'Control+P';
	const current = page.locator('.basehalf-command-center-breadcrumb-segment.current');
	const search = page.locator('.basehalf-command-center-search');
	await current.waitFor({ state: 'visible', timeout: 15_000 });
	const opensSearch = async (what, act) => {
		await act();
		await quickInput.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {
			throw new Error(`${what} did not open the search`);
		});
		await page.keyboard.press('Escape');
		await quickInput.waitFor({ state: 'hidden', timeout: 10_000 });
	};
	const keyboard = () => page.evaluate(() => ({
		onCanvas: !!document.activeElement?.closest('.basehalf-canvas-cards'),
		active: `${document.activeElement?.tagName}.${document.activeElement?.className}`
	}));

	// The empty room between the current place and the magnifier.
	const room = await page.evaluate(() => {
		const place = document.querySelector('.basehalf-command-center-breadcrumb-segment.current').getBoundingClientRect();
		const magnifier = document.querySelector('.basehalf-command-center-search').getBoundingClientRect();
		return { left: place.right, right: magnifier.left, y: magnifier.top + magnifier.height / 2 };
	});
	if (room.right - room.left < 24) {
		throw new Error(`The location has no empty room to click: ${JSON.stringify(room)}`);
	}
	await page.evaluate(() => document.querySelector('.basehalf-canvas-cards').focus());
	await opensSearch('A click in the empty room of the location', () => page.mouse.click((room.left + room.right) / 2, room.y));
	const afterEscape = await keyboard();
	if (!afterEscape.onCanvas) {
		throw new Error(`Escape from the search did not give the keyboard back to the canvas: ${afterEscape.active}`);
	}
	await opensSearch('Quick Open after the search closed', () => page.keyboard.press(quickOpenKey));
	await opensSearch('A click on the current place', () => current.click());

	// With the keyboard on the magnifier, a shortcut works, and Enter opens
	// the search.
	await opensSearch('Quick Open with the keyboard on the magnifier', async () => {
		await search.focus();
		await page.keyboard.press(quickOpenKey);
	});
	await opensSearch('Enter on the magnifier', async () => {
		await search.focus();
		await page.keyboard.press('Enter');
	});

	// Leave the keyboard on the canvas and the pointer off the title bar.
	await page.evaluate(() => document.querySelector('.basehalf-canvas-cards').focus());
	await page.mouse.move(640, await page.evaluate(() => window.innerHeight - 6));
}

// Opening the workspace and rendering its first canvas write nothing under
// .bh/. Every seeded file keeps its bytes and nothing is added: no focus
// file, no harness, and no canvas.yaml for a folder nobody arranged. A fresh
// folder therefore still has no .bh/ after its first canvas render. The wait
// outlasts the viewport persist debounce and the bounded legacy-import wait,
// so a delayed writer has run by the time the tree is compared.
// Every card has a saved place (canvas card placement). The first drawing of
// a canvas gives the cards that had no row a place and saves it. That is the
// only thing it writes, and git shows none of it.
export async function assertFirstCanvasRenderSavesPlacesOutOfGit(page) {
	const layoutPath = path.join(workspacePath, '.bh', 'mirror', 'canvas.yaml');
	const shown = await page.locator('.basehalf-canvas-card[data-basehalf-card-path]').evaluateAll(cards => cards.map(card => card.getAttribute('data-basehalf-card-path')));
	if (shown.length < 2 || !shown.includes('README.md')) {
		throw new Error(`The root canvas must show the fixture's cards before their places are checked: ${JSON.stringify(shown)}`);
	}
	const rowsOf = () => {
		const raw = fs.readFileSync(layoutPath, 'utf8');
		return Object.fromEntries(shown.map(cardPath => [cardPath, readCanvasCardGeometry(raw, cardPath)]));
	};
	const deadline = Date.now() + 10_000;
	while (Object.values(rowsOf()).some(row => row === undefined)) {
		if (Date.now() > deadline) {
			throw new Error(`Every shown card must get a row in the first drawing: ${JSON.stringify(rowsOf())}`);
		}
		await page.waitForTimeout(100);
	}
	const raw = fs.readFileSync(layoutPath, 'utf8');
	const rows = rowsOf();
	// The row the user had is as it was. Every other row is marked as BaseHalf's choice.
	const expectedReadme = { x: -140, y: -110, width: 300, height: 220 };
	if (JSON.stringify(rows['README.md']) !== JSON.stringify(expectedReadme) || /- path: "README\.md"\n(?: {4}.*\n)* {4}auto: true/.test(raw)) {
		throw new Error(`The first drawing must not change a row that was there: ${JSON.stringify(rows['README.md'])}`);
	}
	const unmarked = shown.filter(cardPath => cardPath !== 'README.md' && !new RegExp(`- path: ${JSON.stringify(cardPath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n(?: {4}.*\\n)*? {4}auto: true`).test(raw));
	if (unmarked.length > 0) {
		throw new Error(`A place BaseHalf chose must be marked as its own choice: ${unmarked.join(', ')}`);
	}
	// What is drawn is what is stored.
	const drawn = await readCanvasCardPlaces(page, shown);
	const off = shown.filter(cardPath => Math.abs(drawn[cardPath].x - rows[cardPath].x) > 1 || Math.abs(drawn[cardPath].y - rows[cardPath].y) > 1);
	if (off.length > 0) {
		throw new Error(`A card must be drawn where its row says: ${JSON.stringify(off.map(cardPath => ({ cardPath, drawn: drawn[cardPath], row: rows[cardPath] })))}`);
	}
	// No two cards that BaseHalf placed meet.
	const meets = (first, second) => first.x < second.x + second.width && second.x < first.x + first.width && first.y < second.y + second.height && second.y < first.y + first.height;
	const overlapping = shown.flatMap((first, index) => shown.slice(index + 1).filter(second => meets(rows[first], rows[second])).map(second => `${first} on ${second}`));
	if (overlapping.length > 0) {
		throw new Error(`The first drawing must not put a card on another card: ${overlapping.join(', ')}`);
	}

	// Showing a canvas writes layouts and nothing else.
	const after = readBhTree();
	const changed = [...new Set([...Object.keys(bhTreeBeforeLaunch), ...Object.keys(after)])]
		.filter(rel => bhTreeBeforeLaunch[rel] !== after[rel] && !rel.endsWith('/canvas.yaml') && !rel.endsWith('/'))
		.sort();
	if (changed.length > 0) {
		throw new Error(`Opening the workspace and rendering its first canvas must write only layouts under .bh/: ${changed.join(', ')}`);
	}
	if (fs.readFileSync(path.join(workspacePath, '.bh', '.gitignore'), 'utf8') !== BH_IGNORE_FILE) {
		throw new Error('The ignore file under .bh/ must be the one BaseHalf writes.');
	}
	// And git shows none of it.
	const status = gitStatusOfWorkspace();
	if (status !== gitStatusBeforeLaunch) {
		throw new Error(`Opening the workspace and rendering its first canvas must change nothing that git shows.\nBefore:\n${gitStatusBeforeLaunch}\nAfter:\n${status}`);
	}
}

export async function assertFreshCanvasFramed(page) {
	await page.locator('.basehalf-canvas-card').first().waitFor({ state: 'visible', timeout: 20_000 });
	await page.waitForFunction(() => {
		const root = document.querySelector('.basehalf-canvas-workbench');
		const cardsLayer = document.querySelector('.basehalf-canvas-cards');
		const viewport = cardsLayer?.querySelector('.react-flow__viewport');
		const cards = Array.from(document.querySelectorAll('.basehalf-canvas-card'));
		if (!(root instanceof HTMLElement) || !(cardsLayer instanceof HTMLElement) || !(viewport instanceof HTMLElement) || cards.length < 2) {
			return false;
		}

		const rootRect = root.getBoundingClientRect();
		const rects = cards
			.map(card => card.getBoundingClientRect())
			.filter(rect => rect.width > 0 && rect.height > 0);
		if (rects.length < 2) {
			return false;
		}
		const negativeCard = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
		if (!(negativeCard instanceof HTMLElement)) {
			return false;
		}
		const negativeNode = negativeCard.closest('.react-flow__node');
		if (!(negativeNode instanceof HTMLElement)) {
			return false;
		}
		const negativeTransform = getComputedStyle(negativeNode).transform;
		const negativeMatrix = negativeTransform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(negativeTransform);
		const viewportTransform = getComputedStyle(viewport).transform;
		const viewportMatrix = viewportTransform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(viewportTransform);
		const reportedZoom = Number(root.dataset.zoom);
		if (negativeMatrix.m41 >= 0 || negativeMatrix.m42 >= 0 || !Number.isFinite(reportedZoom) || Math.abs(viewportMatrix.a - reportedZoom) > 0.01) {
			return false;
		}

		const minLeft = Math.min(...rects.map(rect => rect.left)) - rootRect.left;
		const minTop = Math.min(...rects.map(rect => rect.top)) - rootRect.top;
		const maxRight = Math.max(...rects.map(rect => rect.right)) - rootRect.left;
		const maxBottom = Math.max(...rects.map(rect => rect.bottom)) - rootRect.top;
		return minLeft >= 10
			&& minTop >= 10
			&& maxRight <= rootRect.width - 10
			&& maxBottom <= rootRect.height - 10;
	}, null, { timeout: 20_000 });

	const canvasFocusState = await page.locator('.basehalf-canvas-cards').evaluate(element => {
		if (!(element instanceof HTMLElement)) {
			return { focused: false, outlineStyle: '', outlineWidth: '' };
		}
		element.focus();
		const style = getComputedStyle(element);
		return {
			focused: document.activeElement === element,
			outlineStyle: style.outlineStyle,
			outlineWidth: style.outlineWidth,
		};
	});
	if (!canvasFocusState.focused) {
		throw new Error('Expected the canvas scene host to remain programmatically focusable');
	}
	if (canvasFocusState.outlineStyle !== 'none' && canvasFocusState.outlineWidth !== '0px') {
		throw new Error(`Expected the focused canvas scene host to avoid a full-surface outline: ${JSON.stringify(canvasFocusState)}`);
	}
}

export async function assertCanvasGridScopedToCanvas(page) {
	// React Flow owns the world-space grid inside the same scene as its nodes
	// and edges. It must fill only the island, never become a workbench-level
	// CSS background that can drift independently from the viewport transform.
	await page.waitForFunction(() => {
		const canvas = document.querySelector('.basehalf-canvas-workbench');
		const cards = document.querySelector('.basehalf-canvas-cards');
		if (!(canvas instanceof HTMLElement) || !(cards instanceof HTMLElement)) {
			return false;
		}
		const background = cards.querySelector('.react-flow__background');
		const pattern = background?.querySelector('pattern');
		if (!(background instanceof SVGElement) || !(pattern instanceof SVGElement)) {
			return false;
		}
		const canvasRect = cards.getBoundingClientRect();
		const backgroundRect = background.getBoundingClientRect();
		return background.closest('.basehalf-canvas-react-island') === cards
			&& getComputedStyle(canvas).backgroundImage === 'none'
			&& Math.abs(backgroundRect.left - canvasRect.left) <= 1
			&& Math.abs(backgroundRect.top - canvasRect.top) <= 1
			&& Math.abs(backgroundRect.width - canvasRect.width) <= 1
			&& Math.abs(backgroundRect.height - canvasRect.height) <= 1;
	}, null, { timeout: 10_000 });
}
