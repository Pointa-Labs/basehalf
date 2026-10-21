/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Card Detail: its header, its badge, what it covers, and the source, media, and PDF projections.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { root, workspacePath } from '../../context.mts';
import {
	assertCanvasEdgeVisible,
	assertCanvasFolder,
	emptyCanvasPoint,
	waitForCanvasCardSelection,
	waitForCanvasNoteInlineEditor
} from '../../lib/canvas.mts';
import { assertCardDetail, clickCommandCenterNavigationButton } from '../../lib/cardDetail.mts';
import { activeMarkdownRichFrame } from '../../lib/markdownRich.mts';
import { quickOpen, visibleQuickInput } from '../../lib/quickInput.mts';
import { waitUntil } from '../../lib/steps.mts';
import { readLayoutControls } from '../../lib/workbench.mts';

let canvasViewportBeforeCardDetail;

export async function assertMediaCardDetail(page) {
	await assertCardDetail(page, 'concept.svg');
	const active = page.locator('.basehalf-card-detail-surface.active');
	await active.locator('.basehalf-card-detail-media-webview').waitFor({ state: 'visible', timeout: 8_000 });
	const pressed = page.locator('.basehalf-card-detail-projection[aria-label="View"]');
	if (await pressed.count() > 0 && await pressed.getAttribute('aria-pressed') !== 'true') {
		throw new Error('Supported media did not select the registered View projection by default');
	}
	if (await page.locator('.basehalf-card-detail-projection[aria-label="Source"]').count() > 0) {
		throw new Error('Direct-render image media exposed the raw Source projection');
	}

	const started = Date.now();
	while (Date.now() - started < 8_000) {
		for (const frame of page.frames()) {
			if (await frame.locator('img#media').count().catch(() => 0) > 0) {
				return;
			}
		}
		await page.waitForTimeout(100);
	}
	throw new Error('Media projection webview did not render the local SVG');
}

export async function assertCardDetailHoldsNoLayoutControl(page) {
	await page.locator('.basehalf-card-detail.visible').waitFor({ state: 'visible', timeout: 8_000 });
	// The header of a card holds what acts on the card: its views and Close.
	const header = await page.evaluate(() => Array.from(document.querySelectorAll('.basehalf-card-detail.visible .basehalf-card-detail-actions button'))
		.filter(node => node.getBoundingClientRect().width > 0)
		.map(node => node.getAttribute('aria-label') ?? ''));
	if (header.some(label => /side ?bar/i.test(label) || label === 'Focus on document') || header.at(-1) !== 'Close') {
		throw new Error(`The header of Card Detail holds a layout control: ${JSON.stringify(header)}`);
	}
	if (await page.locator('.basehalf-card-detail-focus').count()) {
		throw new Error('The header of Card Detail still holds the button that hides the sidebar');
	}
	// The control of the sidebar is in the title bar while a card is open.
	const controls = await readLayoutControls(page);
	if (controls.left.length !== 1 || !controls.left[0].startsWith('Toggle Primary Side Bar') || !controls.onTop) {
		throw new Error(`The title bar does not hold the control of the sidebar while a card is open: ${JSON.stringify(controls)}`);
	}
}

export async function assertPdfCardDetail(page, expectedName = 'textbook.pdf') {
	await assertCardDetail(page, expectedName);
	const pressed = page.locator('.basehalf-card-detail-projection[aria-label="View"]');
	if (await pressed.count() > 0 && await pressed.getAttribute('aria-pressed') !== 'true') {
		throw new Error('PDF did not select the registered View projection by default');
	}
	if (await page.locator('.basehalf-card-detail-projection[aria-label="Source"]').count() > 0) {
		throw new Error('A binary PDF exposed the raw Source projection');
	}

	const started = Date.now();
	let diagnostic = '';
	while (Date.now() - started < 15_000) {
		for (const frame of page.frames()) {
			const root = frame.locator('#basehalf-pdf-viewer');
			if (await root.count().catch(() => 0) === 0) {
				continue;
			}
			const container = root.locator('embedpdf-container');
			const documentContent = container.locator('#document-content');
			const status = await root.getAttribute('data-status');
			const pageCount = await root.getAttribute('data-page-count');
			if (status === 'ready' && pageCount === '1' && await container.count() > 0 && await documentContent.count() > 0) {
				return;
			}
			diagnostic = await frame.locator('body').evaluate(body => {
				const viewer = body.querySelector('#basehalf-pdf-viewer');
				const error = body.querySelector('#basehalf-pdf-error');
				return JSON.stringify({
					source: viewer?.getAttribute('data-source'),
					status: viewer?.getAttribute('data-status'),
					pageCount: viewer?.getAttribute('data-page-count'),
					container: viewer?.querySelector('embedpdf-container') !== null,
					error: error?.textContent,
					errorHidden: error?.hasAttribute('hidden'),
					body: body.textContent?.replace(/\s+/g, ' ').trim()
				});
			});
		}
		await page.waitForTimeout(100);
	}
	throw new Error(`PDF projection webview did not render the local fixture: ${diagnostic}`);
}

// Each branch note is created with the PDF in its `upstream` frontmatter, in
// its first saved bytes (D37): the PDF → note edge appears and nothing else is
// written for the connection.
export async function assertPdfGrowsThreeBranches(page) {
	const sourcePath = path.join(workspacePath, 'docs', 'textbook.pdf');
	const sourceMirrorPath = path.join(workspacePath, '.bh', 'mirror', 'docs', 'textbook.pdf');
	const branchNames = ['textbook-note.md', 'textbook-note-2.md', 'textbook-note-3.md'];

	for (let index = 0; index < branchNames.length; index++) {
		if (index > 0) {
			await quickOpen(page, 'textbook.pdf');
			await assertPdfCardDetail(page);
		}

		const action = await selectPdfFixtureText(page);
		await action.click();
		const name = branchNames[index];
		const branchPath = path.join(workspacePath, 'docs', name);
		await waitUntil(() => fs.existsSync(branchPath), `${name} to be created from the PDF selection`, 15_000);
		await assertCanvasFolder(page, 'docs');
		const branchCard = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="docs/${name}"]`);
		await branchCard.waitFor({ state: 'visible', timeout: 15_000 });
		await waitForCanvasCardSelection(page, `docs/${name}`, 15_000);
		if (await page.locator('.basehalf-card-detail.visible').isVisible().catch(() => false)) {
			throw new Error(`${name} opened Card Detail instead of returning to the PDF canvas`);
		}
		const branchEditor = await waitForCanvasNoteInlineEditor(page, `docs/${name}`);
		const markdown = fs.readFileSync(branchPath, 'utf8');
		if (!markdown.includes('> BaseHalf PDF') || !markdown.includes('Source: [textbook.pdf](./textbook.pdf), page 1')) {
			throw new Error(`${name} did not preserve the selected passage and source page as ordinary Markdown`);
		}
		if (!markdown.startsWith('---\nupstream:\n  - docs/textbook.pdf\n---\n')) {
			throw new Error(`${name} did not list the PDF as upstream in its first bytes: ${JSON.stringify(markdown.slice(0, 120))}`);
		}
		await assertCanvasEdgeVisible(page, 'docs/textbook.pdf', `docs/${name}`);
		for (const mirrorPath of [
			path.join(sourceMirrorPath, 'badge.yaml'),
			path.join(sourceMirrorPath, 'upstream.yaml'),
			path.join(workspacePath, '.bh', 'mirror', 'docs', name, 'badge.yaml'),
			path.join(workspacePath, '.bh', 'mirror', 'docs', name, 'upstream.yaml')
		]) {
			if (fs.existsSync(mirrorPath)) {
				throw new Error(`Growing ${name} wrote ${path.relative(workspacePath, mirrorPath)}; the connection belongs only in the note`);
			}
		}
		await page.keyboard.press('Escape');
		await branchEditor.host.waitFor({ state: 'detached', timeout: 10_000 });
	}

	if (!fs.existsSync(sourcePath)) {
		throw new Error('Growing PDF branches unexpectedly moved or removed the source document');
	}
	for (const name of branchNames) {
		await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="docs/${name}"]`).waitFor({ state: 'visible', timeout: 15_000 });
	}
}

async function selectPdfFixtureText(page) {
	let diagnostic = '';
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		for (const frame of page.frames()) {
			const root = frame.locator('#basehalf-pdf-viewer[data-status="ready"]');
			if (await root.count().catch(() => 0) === 0) {
				continue;
			}
			const images = root.locator('embedpdf-container').locator('#document-content img');
			const candidates = [];
			for (let index = 0; index < await images.count(); index++) {
				const box = await images.nth(index).boundingBox();
				if (box) {
					candidates.push({ box, area: box.width * box.height });
				}
			}
			const pageImage = candidates.sort((a, b) => b.area - a.area)[0]?.box;
			if (!pageImage) {
				diagnostic = JSON.stringify({ status: 'ready', renderedPageImages: await images.count() });
				continue;
			}

			const action = frame.locator('button', { hasText: 'Grow branch' }).last();
			// Both ends of an EmbedPDF text-selection drag must land on glyphs.
			// The fixture line starts at x=40pt and has a 120pt baseline on a
			// 300x200pt page, so keep the drag comfortably inside the rendered text
			// instead of ending in the large blank area to its right.
			for (const yRatio of [0.39, 0.36, 0.42]) {
				await page.mouse.move(pageImage.x + pageImage.width * 0.15, pageImage.y + pageImage.height * yRatio);
				await page.mouse.down();
				await page.mouse.move(pageImage.x + pageImage.width * 0.66, pageImage.y + pageImage.height * yRatio, { steps: 24 });
				await page.mouse.up();
				if (await action.waitFor({ state: 'visible', timeout: 1_500 }).then(() => true, () => false)) {
					return action;
				}
			}
			diagnostic = await root.locator('embedpdf-container').evaluate(async element => {
				const registry = await element.registry;
				const interaction = registry.getPlugin('interaction-manager')?.provides();
				const selection = registry.getPlugin('selection')?.provides();
				return JSON.stringify({
					plugins: registry.getAllPlugins().map(plugin => plugin.id),
					mode: interaction?.forDocument('basehalf-document').getActiveMode(),
					selection: selection?.getState('basehalf-document')
				});
			});
		}
		await page.waitForTimeout(100);
	}
	throw new Error(`The PDF selection menu did not expose Grow branch for the fixture text: ${diagnostic}`);
}

export async function assertBaseHalfTitlebarBreadcrumbs(page) {
	const breadcrumbs = page.locator('.basehalf-command-center-breadcrumbs');
	await breadcrumbs.waitFor({ state: 'visible', timeout: 15_000 });
	const labels = (await breadcrumbs.locator('.basehalf-command-center-breadcrumb-segment').allTextContents()).map(label => label.trim());
	if (labels.length !== 2 || labels[0] !== path.basename(workspacePath) || labels[1] !== 'README') {
		throw new Error(`Unexpected README breadcrumb path: ${JSON.stringify(labels)}`);
	}
	const current = breadcrumbs.locator('[aria-current="page"]');
	if (await current.textContent() !== 'README') {
		throw new Error('The current breadcrumb segment is not the name of README.md');
	}
	// The name of the open note has no extension in the title either.
	const detailTitle = (await page.locator('.basehalf-card-detail-title').first().textContent())?.trim();
	if (detailTitle !== 'README') {
		throw new Error(`Card Detail names the open note ${JSON.stringify(detailTitle)}`);
	}
	const search = page.locator('.basehalf-command-center-search[aria-label]');
	await search.waitFor({ state: 'visible', timeout: 10_000 });

	// Passive breadcrumb chrome must never bubble into the parent Quick Open
	// action, whether activated by pointer or by the ActionBar keyboard path.
	const quickInput = visibleQuickInput(page);
	await current.click();
	await quickInput.waitFor({ state: 'hidden', timeout: 1_000 });
	await breadcrumbs.locator('.basehalf-command-center-breadcrumb-separator').first().click();
	await quickInput.waitFor({ state: 'hidden', timeout: 1_000 });
	const locationGroup = page.locator('.command-center-quick-pick.basehalf-location-mode');
	await locationGroup.focus();
	await page.keyboard.press('Enter');
	await quickInput.waitFor({ state: 'hidden', timeout: 1_000 });
	await assertCardDetail(page, 'README.md');

	// Search remains an explicit action inside the otherwise passive group.
	await search.click();
	await quickInput.waitFor({ state: 'visible', timeout: 10_000 });
	await page.keyboard.press('Escape');
	await quickInput.waitFor({ state: 'hidden', timeout: 10_000 });

	await breadcrumbs.locator('button.basehalf-command-center-breadcrumb-segment').first().click();
	await page.locator('.basehalf-card-detail.visible').waitFor({ state: 'hidden', timeout: 20_000 });
	await page.locator('.basehalf-canvas-cards').waitFor({ state: 'visible', timeout: 15_000 });

	await clickCommandCenterNavigationButton(page, 'arrow-left', 'Go Back');
	await assertCardDetail(page, 'README.md');
}

export async function assertCardDetailCompactHeader(page) {
	const chrome = await page.evaluate(() => {
		const header = document.querySelector('.basehalf-card-detail-header');
		const projections = document.querySelector('.basehalf-card-detail-projections.visible');
		const buttons = Array.from(document.querySelectorAll('.basehalf-card-detail-projection'));
		const activeButton = document.querySelector('.basehalf-card-detail-projection.checked');
		const close = document.querySelector('.basehalf-card-detail-close');
		if (!(header instanceof HTMLElement) || !(projections instanceof HTMLElement) || !(activeButton instanceof HTMLElement) || !(close instanceof HTMLElement) || buttons.length !== 3) {
			throw new Error('Missing Markdown card detail header projection controls');
		}

		const projectionStyle = getComputedStyle(projections);
		return {
			headerHeight: header.getBoundingClientRect().height,
			projectionBackground: projectionStyle.backgroundColor,
			projectionBorderWidths: [projectionStyle.borderTopWidth, projectionStyle.borderRightWidth, projectionStyle.borderBottomWidth, projectionStyle.borderLeftWidth],
			projectionPadding: [projectionStyle.paddingTop, projectionStyle.paddingRight, projectionStyle.paddingBottom, projectionStyle.paddingLeft],
			projectionGap: projectionStyle.columnGap,
			activeBackground: getComputedStyle(activeButton).backgroundColor,
			closeMarginLeft: getComputedStyle(close).marginLeft,
			buttonSizes: buttons.map(button => {
				const rect = button.getBoundingClientRect();
				return { width: rect.width, height: rect.height };
			})
		};
	});

	if (chrome.headerHeight > 36.5
		|| chrome.projectionBackground !== 'rgba(0, 0, 0, 0)'
		|| chrome.projectionBorderWidths.some(width => width !== '0px')
		|| chrome.projectionPadding.some(padding => padding !== '0px')
		|| chrome.projectionGap !== '0px'
		|| chrome.activeBackground === 'rgba(0, 0, 0, 0)'
		|| chrome.closeMarginLeft !== '2px'
		|| chrome.buttonSizes.some(size => Math.abs(size.width - 24) > 0.5 || Math.abs(size.height - 24) > 0.5)) {
		throw new Error(`Card detail header is not compact and unboxed: ${JSON.stringify(chrome)}`);
	}

	const hoverTarget = page.locator('.basehalf-card-detail-projection:not(.checked)').first();
	await hoverTarget.hover();
	const hoverOutline = await hoverTarget.evaluate(element => {
		const style = getComputedStyle(element);
		return { style: style.outlineStyle, width: style.outlineWidth };
	});
	if (hoverOutline.style !== 'none' && hoverOutline.width !== '0px') {
		throw new Error(`Card detail projection hover must not look like keyboard focus: ${JSON.stringify(hoverOutline)}`);
	}
}

// The card detail's Badge zone: expand it, author a note (flush-on-blur writes
// .bh/mirror), confirm the persisted value survives the zone's re-render, and
// cycle the collapse toggle.
export async function assertCardDetailBadgeZone(page) {
	const toggle = page.locator('[data-testid="card-detail-badge-toggle"]');
	await toggle.waitFor({ state: 'visible', timeout: 20_000 });
	if (!(await page.locator('.basehalf-card-detail-badge-body').isVisible().catch(() => false))) {
		await toggle.click();
		await page.locator('.basehalf-card-detail-badge-body').waitFor({ state: 'visible', timeout: 20_000 });
	}

	const prompt = page.locator('.basehalf-card-detail-badge .basehalf-canvas-card-badge-prompt');
	await prompt.waitFor({ state: 'visible', timeout: 20_000 });
	await prompt.click();
	await prompt.fill('Badge smoke note for agents');
	await prompt.blur();
	await page.waitForFunction(() => {
		const el = document.querySelector('.basehalf-card-detail-badge .basehalf-canvas-card-badge-prompt');
		return el instanceof HTMLTextAreaElement && el.value.includes('Badge smoke note for agents');
	}, undefined, { timeout: 20_000 });

	await toggle.click();
	await page.locator('.basehalf-card-detail-badge-body').waitFor({ state: 'detached', timeout: 20_000 });
	await page.locator('[data-testid="card-detail-badge-toggle"]').click();
	await page.locator('.basehalf-card-detail-badge-body').waitFor({ state: 'visible', timeout: 20_000 });
}

// Clicking into the rich Markdown document while the centered Badge popover is
// open should use that same first click for the editor, not leave the popover
// hanging around until a second click.
export async function assertBadgeClosesOnRichEditorActivation(page) {
	await quickOpen(page, 'README.md');
	await assertCardDetail(page, 'README.md');
	const rich = page.locator('.basehalf-card-detail-projection[aria-label="Rich"]');
	if (await rich.count()) {
		const pressed = await rich.getAttribute('aria-pressed').catch(() => 'false');
		if (pressed !== 'true') {
			await rich.click();
		}
	}
	const toggle = page.locator('[data-testid="card-detail-badge-toggle"]');
	await toggle.waitFor({ state: 'visible', timeout: 20_000 });
	if (!(await page.locator('.basehalf-card-detail-badge-body').isVisible().catch(() => false))) {
		await toggle.click({ force: true });
	}
	await page.locator('.basehalf-card-detail-badge-body').waitFor({ state: 'visible', timeout: 20_000 });
	const frame = await activeMarkdownRichFrame(page);
	const editable = frame.locator('.bn-editor [contenteditable="true"], .bn-editor[contenteditable="true"], .ProseMirror[contenteditable="true"]').first();
	await editable.waitFor({ state: 'visible', timeout: 20_000 });
	await editable.click({ position: { x: 24, y: 180 } });
	await page.locator('.basehalf-card-detail-badge-body').waitFor({ state: 'detached', timeout: 5_000 });
}

// `badge ` quick access finds the note authored above and routes back into the
// card detail — the full write-to-search loop over .bh/mirror.
export async function assertBadgeQuickAccessFindsNote(page) {
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
	const quickInput = visibleQuickInput(page);
	await quickInput.waitFor({ state: 'visible', timeout: 15_000 });
	await quickInput.fill('badge smoke note for agents');
	const row = page.locator('.quick-input-list .monaco-list-row[role="option"]', { hasText: 'Badge smoke note for agents' }).first();
	await row.waitFor({ state: 'visible', timeout: 15_000 });
	await page.keyboard.press('Enter');
	await quickInput.waitFor({ state: 'hidden', timeout: 15_000 });
	await assertCardDetail(page, 'README.md');
}

export async function scrollCanvasWorkbenchForCardDetail(page) {
	const before = await page.evaluate(() => {
		const root = document.querySelector('.basehalf-canvas-workbench');
		const viewport = document.querySelector('.basehalf-canvas-cards .react-flow__viewport');
		if (!(root instanceof HTMLElement) || !(viewport instanceof HTMLElement)) {
			throw new Error('Missing React Flow canvas viewport');
		}
		return { transform: getComputedStyle(viewport).transform };
	});
	// On a card the pointer could be on a long note, which takes such a scroll.
	const emptyCanvas = await emptyCanvasPoint(page);
	await page.mouse.move(emptyCanvas.x, emptyCanvas.y);
	await page.mouse.wheel(90, 180);
	await page.waitForFunction(previous => {
		const viewport = document.querySelector('.basehalf-canvas-cards .react-flow__viewport');
		return viewport instanceof HTMLElement && getComputedStyle(viewport).transform !== previous;
	}, before.transform, { timeout: 10_000 });
	canvasViewportBeforeCardDetail = await page.locator('.basehalf-canvas-cards .react-flow__viewport').evaluate(viewport => getComputedStyle(viewport).transform);
}

export async function assertCardDetailCoversCanvasViewport(page) {
	const geometry = await page.evaluate(() => {
		const root = document.querySelector('.basehalf-canvas-workbench');
		const detail = document.querySelector('.basehalf-card-detail.visible');
		const viewport = document.querySelector('.basehalf-canvas-cards .react-flow__viewport');
		const canvasChrome = root?.querySelector('.basehalf-canvas-chrome');
		if (!(root instanceof HTMLElement) || !(detail instanceof HTMLElement) || !(viewport instanceof HTMLElement) || !(canvasChrome instanceof HTMLElement)) {
			throw new Error('Missing visible BaseHalf card detail');
		}

		const rootRect = root.getBoundingClientRect();
		const detailRect = detail.getBoundingClientRect();
		const bottomProbe = document.elementFromPoint(rootRect.left + rootRect.width / 2, rootRect.bottom - 24);
		return {
			rootTop: rootRect.top,
			rootLeft: rootRect.left,
			rootBottom: rootRect.bottom,
			rootRight: rootRect.right,
			detailTop: detailRect.top,
			detailLeft: detailRect.left,
			detailBottom: detailRect.bottom,
			detailRight: detailRect.right,
			viewportTransform: getComputedStyle(viewport).transform,
			locked: root.classList.contains('basehalf-card-detail-open'),
			bottomProbeIsCanvas: !!bottomProbe?.closest('.basehalf-canvas-card, .basehalf-canvas-surface'),
			canvasChromeHidden: getComputedStyle(canvasChrome).display === 'none',
			zoomMenuVisible: Array.from(document.querySelectorAll('.basehalf-canvas-zoom-menu')).some(menu => menu instanceof HTMLElement && menu.offsetParent !== null)
		};
	});

	const tolerance = 1;
	if (!geometry.locked || geometry.viewportTransform !== canvasViewportBeforeCardDetail) {
		throw new Error(`Card detail did not preserve the React Flow viewport: ${JSON.stringify({ geometry, canvasViewportBeforeCardDetail })}`);
	}
	if (Math.abs(geometry.detailTop - geometry.rootTop) > tolerance
		|| Math.abs(geometry.detailLeft - geometry.rootLeft) > tolerance
		|| Math.abs(geometry.detailBottom - geometry.rootBottom) > tolerance
		|| Math.abs(geometry.detailRight - geometry.rootRight) > tolerance) {
		throw new Error(`Card detail does not cover canvas viewport: ${JSON.stringify(geometry)}`);
	}
	if (geometry.bottomProbeIsCanvas) {
		throw new Error(`Card detail leaves canvas visible at the bottom: ${JSON.stringify(geometry)}`);
	}
	if (!geometry.canvasChromeHidden || geometry.zoomMenuVisible) {
		throw new Error(`Card detail left Canvas zoom chrome interactive: ${JSON.stringify(geometry)}`);
	}
}

export async function assertSourceCardFlushesBeforeNavigation(page) {
	const marker = 'export const sourceFlushSmoke = true;';
	const appPath = path.join(workspacePath, 'src', 'app.ts');
	await page.locator('.basehalf-card-detail-source-editor .monaco-editor').click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
	await page.keyboard.insertText(`\n${marker}\n`);

	// The fixture workspace parks delay-based auto-save beyond the test
	// timeouts, so the ONLY thing that can put the marker on disk below is
	// the flush-before-navigation gate this step exists to prove.
	if (fs.readFileSync(appPath, 'utf8').includes(marker)) {
		throw new Error('Marker reached disk before navigation — the fixture auto-save override is not in effect and this step cannot prove the navigation flush');
	}

	await quickOpen(page, 'README.md');
	await waitUntil(() => fs.readFileSync(appPath, 'utf8').includes(marker), 'source card detail to flush before navigation');
}

export async function assertSourceCardSaveActionHidden(page) {
	await page.locator('.basehalf-card-detail-source-editor .monaco-editor').waitFor({ state: 'visible', timeout: 15_000 });
	const sourceActionsCount = await page.locator('.basehalf-card-detail-source-actions').count();
	if (sourceActionsCount !== 0) {
		throw new Error(`Source card detail should not render a dedicated save actions container, count=${sourceActionsCount}`);
	}

	const saveButtonCount = await page.locator(
		'.basehalf-card-detail-actions .basehalf-card-detail-source-save, .basehalf-card-detail-actions button[aria-label="Save"], .basehalf-card-detail-actions button[title="Save"]'
	).count();
	if (saveButtonCount !== 0) {
		throw new Error(`Source card detail should not expose a manual Save button, count=${saveButtonCount}`);
	}
}
