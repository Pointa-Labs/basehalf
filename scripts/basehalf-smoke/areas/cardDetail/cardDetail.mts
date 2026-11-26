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
import { cardFramesFailing, stopCardFrames, watchCardFrames } from '../../lib/cardFrames.mts';
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
	if (controls.left.length !== 1 || !controls.left[0].startsWith('Toggle Sidebar') || !controls.onTop) {
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

	// The header is the reader's only bar: Sidebar before the name, Find and Comments before Close (PDFs and books, criterion 19).
	if (await page.locator('.basehalf-card-detail-leading .basehalf-card-detail-reader-button.codicon-list-unordered').count() !== 1
		|| await page.locator('.basehalf-card-detail-actions .basehalf-card-detail-reader-button.codicon-search').count() !== 1
		|| await page.locator('.basehalf-card-detail-actions .basehalf-card-detail-reader-button.codicon-comment').count() !== 1) {
		throw new Error('The header of Card Detail does not hold the reader\'s Sidebar, Find, and Comments');
	}

	const started = Date.now();
	let diagnostic = '';
	while (Date.now() - started < 15_000) {
		for (const frame of page.frames()) {
			const root = frame.locator('#basehalf-reader.pdf');
			if (await root.count().catch(() => 0) === 0) {
				continue;
			}
			const status = await root.getAttribute('data-status');
			const shown = await frame.evaluate(() => ({
				pages: document.querySelectorAll('.pdf-page').length,
				drawn: [...document.querySelectorAll('.pdf-page img')].some(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0),
				chrome: document.querySelector('.reader-chrome')?.textContent ?? '',
				// No screen of the library the reader is built on.
				library: document.querySelector('embedpdf-container') !== null
			}));
			if (shown.library) {
				throw new Error('The PDF reader still shows the screens of the library it is built on');
			}
			if (status === 'ready' && shown.pages === 1 && shown.drawn && /^1 \/ 1/.test(shown.chrome)) {
				return;
			}
			diagnostic = JSON.stringify({ status, ...shown });
		}
		await page.waitForTimeout(100);
	}
	throw new Error(`PDF projection webview did not render the local fixture: ${diagnostic}`);
}

/**
 * Highlight marks a passage beside the PDF, never in it; Cmd+Z and
 * Shift+Cmd+Z in the reader take it away and bring it back; and a comment
 * that an agent writes into the file shows in the open reader with its wavy
 * line, its mark, and its entry in the Comments panel (comments, criteria 1,
 * 5, 6, and 15).
 */
export async function assertPdfComments(page) {
	const pdfPath = path.join(workspacePath, 'docs', 'textbook.pdf');
	const file = path.join(workspacePath, '.bh', 'mirror', 'docs', 'textbook.pdf', 'comments.yaml');
	const pdfBytes = fs.readFileSync(pdfPath);
	const read = () => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
	const action = await selectPdfFixtureText(page, 'Highlight');
	await action.click();
	await waitUntil(() => /quote: "BaseHalf/.test(read()) && /page: 1\n/.test(read()), 'Highlight to write the passage into comments.yaml', 10_000);
	if (!fs.readFileSync(pdfPath).equals(pdfBytes)) {
		throw new Error('Highlight changed the bytes of the PDF');
	}
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
	await waitUntil(() => !/quote:/.test(read()), 'Cmd+Z in the reader to take the highlight away', 10_000);
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Shift+Z');
	await waitUntil(() => /quote: "BaseHalf/.test(read()), 'Shift+Cmd+Z in the reader to bring the highlight back', 10_000);

	// What an agent writes shows at once, with its wavy line and its mark, and the highlight keeps its tint.
	fs.writeFileSync(file, `${read()}  - page: 1\n    quote: "smoke"\n    text: "Written by an agent"\n    by: "Smoke Agent"\n`);
	const shown = async () => {
		for (const frame of page.frames()) {
			const found = await frame.evaluate(() => document.querySelector('#basehalf-reader') ? {
				marks: document.querySelectorAll('#basehalf-reader .comment-mark').length,
				markLeft: document.querySelector('#basehalf-reader .comment-mark:not(.pin)')?.getBoundingClientRect().left,
				pageRight: document.querySelector('#basehalf-reader .pdf-page')?.getBoundingClientRect().right,
				waves: document.querySelectorAll('#basehalf-reader .comment-wave').length,
				tints: document.querySelectorAll('#basehalf-reader .comment-tint').length,
				listed: [...document.querySelectorAll('.reader-comments-item')].map(item => item.classList.contains('highlight') ? 'highlight' : 'comment')
			} : undefined).catch(() => undefined);
			if (found) {
				return found;
			}
		}
		return undefined;
	};
	let seen = await shown();
	const deadline = Date.now() + 10_000;
	while ((seen?.marks !== 1 || !seen.waves) && Date.now() < deadline) {
		await page.waitForTimeout(100);
		seen = await shown();
	}
	if (seen?.marks !== 1 || !seen.waves || !seen.tints) {
		throw new Error(`The comment an agent wrote did not show its wavy line and its mark beside the highlight's tint: ${JSON.stringify(seen)}`);
	}
	// The mark stands in the blank outside the page, never on it (comments, rule 7 and criterion 18).
	if (!(seen.markLeft >= seen.pageRight)) {
		throw new Error(`The comment's mark stands on the page instead of beside it: ${JSON.stringify(seen)}`);
	}
	// The Comments panel at the right lists both (comments, criterion 15).
	await page.locator('.basehalf-card-detail-actions .basehalf-card-detail-reader-button.codicon-comment').click();
	const listedBy = Date.now() + 5_000;
	while (JSON.stringify(seen?.listed) !== JSON.stringify(['highlight', 'comment']) && Date.now() < listedBy) {
		await page.waitForTimeout(100);
		seen = await shown();
	}
	if (JSON.stringify(seen?.listed) !== JSON.stringify(['highlight', 'comment'])) {
		throw new Error(`Comments did not list the highlight and the comment in the panel at the right: ${JSON.stringify(seen)}`);
	}
	await page.locator('.basehalf-card-detail-actions .basehalf-card-detail-reader-button.codicon-comment').click();
	fs.rmSync(file);
}

/**
 * Find in the header shows the find bar with the keyboard in its field;
 * typing a word of the PDF in another case marks its match strongly and
 * counts it; Escape takes the marks away and hides the bar (PDFs and books,
 * rule 19 and criterion 22).
 */
export async function assertPdfFind(page) {
	await page.locator('.basehalf-card-detail-actions .basehalf-card-detail-reader-button.codicon-search').click();
	const state = async () => {
		for (const frame of page.frames()) {
			const found = await frame.evaluate(() => document.querySelector('#basehalf-reader.pdf') ? {
				open: !(document.querySelector('.reader-find') as HTMLElement | null)?.hidden,
				focused: document.activeElement?.classList.contains('reader-find-field') ?? false,
				count: document.querySelector('.reader-find-count')?.textContent ?? '',
				matches: document.querySelectorAll('.find-match').length,
				active: document.querySelectorAll('.find-match.active').length
			} : undefined).catch(() => undefined);
			if (found) {
				return found;
			}
		}
		return undefined;
	};
	let seen = await state();
	const openBy = Date.now() + 5_000;
	while (!(seen?.open && seen.focused) && Date.now() < openBy) {
		await page.waitForTimeout(100);
		seen = await state();
	}
	if (!seen?.open || !seen.focused) {
		throw new Error(`Find did not show the find bar with the keyboard in its field: ${JSON.stringify(seen)}`);
	}
	await page.keyboard.type('pdf', { delay: 60 });
	const countBy = Date.now() + 5_000;
	while (!(seen?.count === '1 of 1' && seen.active) && Date.now() < countBy) {
		await page.waitForTimeout(100);
		seen = await state();
	}
	if (seen?.count !== '1 of 1' || !seen.active) {
		throw new Error(`Find did not mark and count the word of the PDF: ${JSON.stringify(seen)}`);
	}
	await page.keyboard.press('Escape');
	const closeBy = Date.now() + 5_000;
	while ((seen?.open || seen?.matches) && Date.now() < closeBy) {
		await page.waitForTimeout(100);
		seen = await state();
	}
	if (seen?.open || seen?.matches) {
		throw new Error(`Escape did not hide the find bar and take its marks away: ${JSON.stringify(seen)}`);
	}
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
		// The note's card comes with its text and its line in the frame it
		// appears in (reference graph, "Creating connected nodes").
		await watchCardFrames(page);
		await action.click();
		const name = branchNames[index];
		const branchPath = path.join(workspacePath, 'docs', name);
		await waitUntil(() => fs.existsSync(branchPath), `${name} to be created from the PDF selection`, 15_000);
		await assertCanvasFolder(page, 'docs');
		const branchCard = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="docs/${name}"]`);
		await branchCard.waitFor({ state: 'visible', timeout: 15_000 });
		await page.waitForTimeout(300);
		const frames = await stopCardFrames(page);
		const appearing = cardFramesFailing(frames, [`docs/${name}`], (shown, frame) => !shown.loading && shown.text.length > 0
			&& frame.lines.includes(`docs/textbook.pdf\u0000docs/${name}`));
		if (appearing.wrong.length) {
			throw new Error(`${name} must appear with its text and its line in its first frame: of ${appearing.shown} frames, ${appearing.wrong.length} did not, first ${JSON.stringify(appearing.wrong[0])}`);
		}
		// Card Detail closes, and the canvas takes the keyboard back, without a ring (Opening and closing Card Detail, criterion 8).
		const ringed = frames.filter(frame => frame.ring);
		if (ringed.length) {
			throw new Error(`Growing ${name}: ${ringed.length} of ${frames.length} frames drew a focus ring, first on ${ringed[0].ring}`);
		}
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

async function selectPdfFixtureText(page, label = 'Grow branch') {
	let diagnostic = '';
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		for (const frame of page.frames()) {
			const root = frame.locator('#basehalf-reader.pdf[data-status="ready"]');
			if (await root.count().catch(() => 0) === 0) {
				continue;
			}
			const pageImage = await frame.locator('.pdf-page').first().boundingBox();
			if (!pageImage) {
				diagnostic = JSON.stringify({ status: 'ready', pages: await frame.locator('.pdf-page').count() });
				continue;
			}

			const action = frame.locator('.reader-selection-menu button', { hasText: label });
			// Both ends of a text-selection drag must land on glyphs. The fixture
			// line starts at x=40pt and has a 120pt baseline on a 300x200pt page,
			// so keep the drag comfortably inside the rendered text instead of
			// ending in the large blank area to its right.
			for (const yRatio of [0.39, 0.36, 0.42]) {
				await page.mouse.move(pageImage.x + pageImage.width * 0.15, pageImage.y + pageImage.height * yRatio);
				await page.mouse.down();
				await page.mouse.move(pageImage.x + pageImage.width * 0.66, pageImage.y + pageImage.height * yRatio, { steps: 24 });
				await page.mouse.up();
				if (await action.waitFor({ state: 'visible', timeout: 1_500 }).then(() => true, () => false)) {
					return action;
				}
			}
			diagnostic = JSON.stringify({ menu: await frame.locator('.reader-selection-menu').isVisible().catch(() => false) });
		}
		await page.waitForTimeout(100);
	}
	throw new Error(`The PDF selection menu did not expose ${label} for the fixture text: ${diagnostic}`);
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

	// The location is one button for the search, but for its folders
	// (docs/specs/title-bar-location.md): a chevron, Enter on the location
	// itself, and the magnifier open the search, and Card Detail stays open.
	const quickInput = visibleQuickInput(page);
	const locationGroup = page.locator('.command-center-quick-pick.basehalf-location-mode');
	const opensSearch = [
		['A click on a chevron', () => breadcrumbs.locator('.basehalf-command-center-breadcrumb-separator').first().click()],
		['Enter on the location', async () => {
			await locationGroup.focus();
			await page.keyboard.press('Enter');
		}],
		['A click on the magnifier', () => search.click()]
	];
	for (const [what, act] of opensSearch) {
		await act();
		await quickInput.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {
			throw new Error(`${what} did not open the search`);
		});
		await page.keyboard.press('Escape');
		await quickInput.waitFor({ state: 'hidden', timeout: 10_000 });
	}
	await assertCardDetail(page, 'README.md');

	// A folder button opens its canvas, and only that.
	await breadcrumbs.locator('button.basehalf-command-center-breadcrumb-segment').first().click();
	await page.locator('.basehalf-card-detail.visible').waitFor({ state: 'hidden', timeout: 20_000 });
	await page.locator('.basehalf-canvas-cards').waitFor({ state: 'visible', timeout: 15_000 });
	if (await quickInput.isVisible()) {
		throw new Error('The folder button of the workspace opened the search as well as its canvas');
	}

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
		// The fixture's README has changes, so Changes stands with the three once Source Control knows them.
		if (!(header instanceof HTMLElement) || !(projections instanceof HTMLElement) || !(activeButton instanceof HTMLElement) || !(close instanceof HTMLElement) || buttons.length < 3) {
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

// Canvas card name, criterion 28: a rename in the title of Card Detail is a
// step of the canvas's undo once Card Detail is closed.
export async function assertCardDetailRenameIsCanvasUndo(page) {
	await quickOpen(page, 'README.md');
	await assertCardDetail(page, 'README.md');
	await page.locator('.basehalf-card-detail-title-button').click();
	const input = page.locator('.basehalf-card-detail-title-input input');
	await input.waitFor({ state: 'visible', timeout: 10_000 });
	await input.fill('README-detail');
	await input.press('Enter');
	const readme = path.join(workspacePath, 'README.md');
	const renamed = path.join(workspacePath, 'README-detail.md');
	await waitUntil(() => fs.existsSync(renamed) && !fs.existsSync(readme), 'the title of Card Detail to rename the note');
	await assertCardDetail(page, 'README-detail.md');
	await page.locator('.basehalf-card-detail-close').click();
	await page.locator('.basehalf-card-detail.visible').waitFor({ state: 'hidden', timeout: 10_000 });
	const card = page.locator('.basehalf-canvas-card[data-basehalf-card-path="README-detail.md"]');
	await card.waitFor({ state: 'visible', timeout: 10_000 });
	await card.focus();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
	await waitUntil(() => fs.existsSync(readme) && !fs.existsSync(renamed), 'undo on the canvas to give the note its old name back');
	await page.locator('.basehalf-canvas-card[data-basehalf-card-path="README.md"]').waitFor({ state: 'visible', timeout: 10_000 });
}
