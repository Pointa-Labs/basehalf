/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Editing a Note in its card: the editor, its caret and selection, and its toolbar.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { pageErrors } from '../../app.mts';
import {
	assertCanvasCardChromeDoesNotUseIntent,
	assertCanvasCardHasRoundedCornerResizeTargets,
	assertCanvasCardPaintEqual,
	assertCanvasCardResizeChromeIsNeutral,
	assertCanvasCardUsesActiveBorder,
	assertCanvasPointerChromeHasNoOutline,
	assertCanvasStillOnTop,
	captureCanvasCardComputedChrome
} from './cardChrome.mts';
import { centerCanvasCards } from './creation.mts';
import {
	assertCanvasMalformedParagraphTransition,
	assertCanvasNoteEditTransitionFrames,
	assertCanvasNoteExitTransitionFrames,
	assertCanvasNoteProgrammaticZoomLayoutInvariantSequence,
	cancelCanvasNoteEditTransitionProbe,
	cancelCanvasNoteExitTransitionProbe,
	finishCanvasNoteEditTransitionProbe,
	finishCanvasNoteExitTransitionProbe,
	startCanvasNoteEditTransitionProbe,
	startCanvasNoteExitTransitionProbe
} from './noteTransitions.mts';
import { assertAdjacentChromeSurfaceState, captureAdjacentChromeSurface, waitForAdjacentChromeAnimations } from './selectionChrome.mts';
import { root, workspacePath } from '../../context.mts';
import { CANVAS_MALFORMED_EMPHASIS_PARAGRAPH } from '../../fixture.mts';
import { canvasNoteInlineEditor, waitForCanvasNoteInlineEditor, zoomCanvas } from '../../lib/canvas.mts';
import { assertCardDetail, assertNoEditorTabFor, closeCardDetailIfOpen } from '../../lib/cardDetail.mts';
import { activeMarkdownRichFrame, markdownRichFrameBelongsTo } from '../../lib/markdownRich.mts';
import { waitUntil } from '../../lib/steps.mts';

const CANVAS_MALFORMED_EMPHASIS_NEEDLE = '异常茂盛**，';

export async function placeCanvasInlineCaretAfter(editable, token) {
	await editable.evaluate(async (root, expectedToken) => {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let node;
		while ((node = walker.nextNode())) {
			const offset = node.textContent?.indexOf(expectedToken) ?? -1;
			if (offset < 0) {
				continue;
			}
			node.parentElement?.scrollIntoView({ block: 'center', inline: 'nearest' });
			const range = document.createRange();
			range.setStart(node, offset + expectedToken.length);
			range.collapse(true);
			root.focus();
			const selection = root.ownerDocument.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);
			await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			return;
		}
		throw new Error(`Inline editor did not render visible token: ${expectedToken}`);
	}, token);
}

async function placeCanvasInlineCaretBefore(editable, token) {
	await editable.evaluate(async (root, expectedToken) => {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let node;
		while ((node = walker.nextNode())) {
			const offset = node.textContent?.indexOf(expectedToken) ?? -1;
			if (offset < 0) {
				continue;
			}
			const range = document.createRange();
			range.setStart(node, offset);
			range.collapse(true);
			root.focus();
			const selection = root.ownerDocument.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);
			root.ownerDocument.dispatchEvent(new Event('selectionchange'));
			await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			return;
		}
		throw new Error(`Inline editor did not render visible token: ${expectedToken}`);
	}, token);
}

export async function selectCanvasInlineToken(editable, token) {
	await editable.evaluate(async (root, expectedToken) => {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let node;
		while ((node = walker.nextNode())) {
			const offset = node.textContent?.indexOf(expectedToken) ?? -1;
			if (offset < 0) {
				continue;
			}
			const range = document.createRange();
			range.setStart(node, offset);
			range.setEnd(node, offset + expectedToken.length);
			root.focus();
			const selection = root.ownerDocument.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);
			root.ownerDocument.dispatchEvent(new Event('selectionchange'));
			await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			return;
		}
		throw new Error(`Inline editor did not render selectable token: ${expectedToken}`);
	}, token);
}

async function clickCanvasInlineCaretAfter(page, editable, token) {
	const point = await editable.evaluate((root, expectedToken) => {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let node;
		while ((node = walker.nextNode())) {
			const offset = node.textContent?.indexOf(expectedToken) ?? -1;
			if (offset < 0) {
				continue;
			}
			const range = document.createRange();
			range.setStart(node, offset + expectedToken.length - 1);
			range.setEnd(node, offset + expectedToken.length);
			const rect = range.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) {
				throw new Error(`Inline token has no clickable text bounds: ${expectedToken}`);
			}
			return { x: rect.right - 0.25, y: rect.top + rect.height / 2 };
		}
		throw new Error(`Inline editor did not render visible token: ${expectedToken}`);
	}, token);
	await page.mouse.click(point.x, point.y);
}

async function dragSelectCanvasInline(page, editable, fromToken, toToken) {
	const points = await editable.evaluate(async (root, tokens) => {
		const scroller = root.parentElement;
		if (!(scroller instanceof HTMLElement)) {
			throw new Error('Inline editor has no scrolling surface');
		}
		const rangeFor = expectedToken => {
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
			let node;
			while ((node = walker.nextNode())) {
				const offset = node.textContent?.indexOf(expectedToken) ?? -1;
				if (offset < 0) {
					continue;
				}
				const character = Math.max(offset, offset + Math.floor(expectedToken.length / 2));
				const range = document.createRange();
				range.setStart(node, character);
				range.setEnd(node, Math.min((node.textContent?.length ?? 0), character + 1));
				const rect = range.getBoundingClientRect();
				if (rect.width <= 0 || rect.height <= 0) {
					throw new Error(`Inline token has no selectable text bounds: ${expectedToken}`);
				}
				return { node, offset, rect };
			}
			throw new Error(`Inline editor did not render selection token: ${expectedToken}`);
		};
		const from = rangeFor(tokens.fromToken);
		const to = rangeFor(tokens.toToken);
		const scrollerBounds = scroller.getBoundingClientRect();
		const fromTop = scroller.scrollTop + from.rect.top - scrollerBounds.top;
		const fromBottom = fromTop + from.rect.height;
		const toTop = scroller.scrollTop + to.rect.top - scrollerBounds.top;
		const toBottom = toTop + to.rect.height;
		const contentTop = Math.min(fromTop, toTop);
		const contentBottom = Math.max(fromBottom, toBottom);
		if (contentBottom - contentTop > scroller.clientHeight - 8) {
			throw new Error(`Inline selection endpoints do not fit in one visible viewport: ${tokens.fromToken} -> ${tokens.toToken}`);
		}
		const targetScrollTop = Math.max(0, contentBottom - scroller.clientHeight + 4);
		scroller.scrollTop = Math.min(scroller.scrollHeight - scroller.clientHeight, targetScrollTop);
		await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		const visiblePoint = expectedToken => {
			const refreshed = rangeFor(expectedToken);
			const viewport = scroller.getBoundingClientRect();
			const x = refreshed.rect.left + refreshed.rect.width / 2;
			const y = refreshed.rect.top + refreshed.rect.height / 2;
			const hit = document.elementFromPoint(x, y);
			if (refreshed.rect.bottom <= viewport.top + 2
				|| refreshed.rect.top >= viewport.bottom - 2
				|| !root.contains(hit)) {
				throw new Error(`Inline selection endpoint is not topmost and visible: ${expectedToken}`);
			}
			return { x, y };
		};
		return { from: visiblePoint(tokens.fromToken), to: visiblePoint(tokens.toToken) };
	}, { fromToken, toToken });
	await page.waitForFunction(({ x, y }) => {
		const hit = document.elementFromPoint(x, y);
		return !!hit?.closest('.basehalf-canvas-markdown-inline > .ProseMirror');
	}, points.from, { timeout: 2_000 });
	// Collapse any previous directional selection first. Starting a second drag
	// on an existing selection endpoint can invoke the browser's drag-selection
	// gesture instead of creating a new range.
	await page.mouse.click(points.from.x, points.from.y);
	await page.mouse.move(points.from.x, points.from.y);
	await page.mouse.down();
	await page.mouse.move(points.to.x, points.to.y, { steps: 12 });
	await page.mouse.up();
	return editable.evaluate(root => {
		const selection = root.ownerDocument.getSelection();
		const unitFor = node => {
			const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
			return element?.closest?.('[data-basehalf-markdown-unit]')?.getAttribute('data-basehalf-markdown-unit');
		};
		return {
			collapsed: selection?.isCollapsed ?? true,
			text: selection?.toString() ?? '',
			anchorUnit: unitFor(selection?.anchorNode),
			focusUnit: unitFor(selection?.focusNode)
		};
	});
}

export async function assertNoCanvasNoteHeavyEditor(page, cardSelector, phase) {
	const canvasDom = await page.locator(cardSelector).locator([
		'.monaco-editor',
		'.bn-editor',
		'.basehalf-card-detail-markdown-rich',
		'.basehalf-card-detail-markdown-rich-webview',
		'iframe',
		'webview'
	].join(', ')).count();
	const richFrames = await markdownRichEditorFrameCount(page, cardSelector);
	const detailOpen = await page.locator('.basehalf-card-detail.visible').isVisible().catch(() => false);
	const parkedDom = detailOpen ? 0 : await page.locator('.basehalf-card-detail-body .basehalf-card-detail-markdown-rich').count();
	const parkedFrames = detailOpen ? 0 : await markdownRichEditorFrameCount(page, '.basehalf-card-detail-body');
	if (canvasDom !== 0 || richFrames !== 0 || parkedDom !== 0 || parkedFrames !== 0) {
		throw new Error(`Canvas Note mounted Monaco, BlockNote, or a rich Webview during ${phase}: ${JSON.stringify({ canvasDom, richFrames, parkedDom, parkedFrames })}`);
	}
}

export async function assertCanvasNoteInlineWysiwygEditor(page) {
	await closeCardDetailIfOpen(page);
	const pane = page.locator('.react-flow__pane');
	const cardSelector = '.basehalf-canvas-card[data-basehalf-card-path="README.md"]';
	const note = page.locator(cardSelector);
	const folder = page.locator('.basehalf-canvas-card[data-basehalf-card-path="src"]');
	const readmePath = path.join(workspacePath, 'README.md');
	const originalMarkdown = fs.readFileSync(readmePath, 'utf8');
	const inlineEditor = canvasNoteInlineEditor(page, 'README.md');

	await zoomCanvas(page, 'reset');
	await note.waitFor({ state: 'visible', timeout: 20_000 });
	await folder.waitFor({ state: 'visible', timeout: 20_000 });
	await centerCanvasCards(page, [note]);
	await pane.click({ position: { x: 16, y: 16 } });

	const staticPreview = note.locator('.basehalf-canvas-card-preview .bh-md-preview').first();
	await staticPreview.waitFor({ state: 'visible', timeout: 20_000 });
	const staticPreviewIdentity = await staticPreview.evaluate(preview => {
		const identity = `preview-${Date.now()}-${Math.random()}`;
		preview.setAttribute('data-smoke-preview-identity', identity);
		return identity;
	});
	const staticPreviewHtml = await staticPreview.evaluate(preview => preview.innerHTML);
	const staticCardBox = await note.boundingBox();
	const softLineTokens = ['soft-line-alpha', 'soft-line-beta', 'soft-line-gamma'];
	const transitionTokens = ['Smoke README', ...softLineTokens];
	const visibleNeedle = 'soft-line-beta';
	const scrolledTransitionTokens = [CANVAS_MALFORMED_EMPHASIS_PARAGRAPH.slice(0, 12), CANVAS_MALFORMED_EMPHASIS_NEEDLE];
	const sourceParagraph = () => note.locator('.bh-md-preview p', { hasText: visibleNeedle }).first();
	const malformedParagraph = () => note.locator('.bh-md-preview p', { hasText: CANVAS_MALFORMED_EMPHASIS_NEEDLE }).first();
	const toolbar = page.getByRole('toolbar', { name: 'Actions for README.md', exact: true });
	const measureSoftLines = root => root.evaluate((content, tokens) => {
		const body = content.closest('.basehalf-canvas-card-body');
		if (!(body instanceof HTMLElement)) {
			throw new Error('Note content is not inside its card body');
		}
		const bodyBounds = body.getBoundingClientRect();
		return tokens.map(token => {
			const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
			let node;
			while ((node = walker.nextNode())) {
				const offset = node.textContent?.indexOf(token) ?? -1;
				if (offset < 0) {
					continue;
				}
				const range = document.createRange();
				range.setStart(node, offset);
				range.setEnd(node, offset + token.length);
				const bounds = range.getBoundingClientRect();
				return {
					x: bounds.left - bodyBounds.left,
					y: bounds.top - bodyBounds.top,
					height: bounds.height
				};
			}
			throw new Error(`Note content did not render soft-line token: ${token}`);
		});
	}, softLineTokens);
	const unselectedSoftLines = await measureSoftLines(staticPreview);
	if (new Set(unselectedSoftLines.map(metric => Math.round(metric.y * 10))).size !== softLineTokens.length) {
		throw new Error(`Static Note collapsed source soft lines: ${JSON.stringify(unselectedSoftLines)}`);
	}
	const restingCursor = await staticPreview.evaluate(preview => getComputedStyle(preview).cursor);
	if (restingCursor !== 'grab') {
		throw new Error(`A resting Note must remain a draggable card, got cursor=${restingCursor}`);
	}
	const restingChrome = await captureCanvasCardComputedChrome(note);
	assertCanvasCardChromeDoesNotUseIntent(restingChrome, 'resting Note pointer state');
	assertCanvasPointerChromeHasNoOutline(restingChrome, 'resting Note pointer state');
	if (restingChrome.cardSelected
		|| restingChrome.nodeSelected
		|| restingChrome.paintedResizeLines !== 0
		|| restingChrome.visibleResizeHandles !== 0
		|| restingChrome.interactiveResizeHandles !== 0) {
		throw new Error(`A resting Note exposed active structural chrome: ${JSON.stringify(restingChrome)}`);
	}
	const [restingGutterCardBefore, restingGutterBox] = await Promise.all([note.boundingBox(), staticPreview.boundingBox()]);
	const restingGutterScrollBefore = await staticPreview.evaluate(preview => preview.scrollTop);
	if (!restingGutterCardBefore || !restingGutterBox) {
		throw new Error('Could not measure the resting Note scrollbar gutter drag target');
	}
	const restingGutterPoint = {
		x: restingGutterBox.x + restingGutterBox.width - 5,
		y: restingGutterBox.y + Math.min(restingGutterBox.height - 16, Math.max(16, restingGutterBox.height * 0.78))
	};
	await page.mouse.move(restingGutterPoint.x, restingGutterPoint.y);
	await page.mouse.down();
	let coldDragChrome;
	try {
		await page.mouse.move(restingGutterPoint.x + 48, restingGutterPoint.y + 24, { steps: 8 });
		coldDragChrome = await page.waitForFunction(path => {
			const card = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"]`);
			const node = card?.closest('.react-flow__node');
			const canvas = card?.closest('.basehalf-canvas-cards');
			if (!(node instanceof HTMLElement)
				|| !(canvas instanceof HTMLElement)
				|| !node.classList.contains('dragging')
				|| canvas.dataset.nodeDragChrome !== 'dragging') {
				return false;
			}
			const surfaces = Array.from(document.querySelectorAll('.basehalf-canvas-adjacent-chrome'));
			const invalid = surfaces.filter(surface => {
				if (!(surface instanceof HTMLElement)) {
					return true;
				}
				const style = getComputedStyle(surface);
				const translateNumbers = style.translate === 'none'
					? []
					: style.translate.match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
				const translateY = translateNumbers.length >= 2 ? translateNumbers[1] : 0;
				const zoom = Number.parseFloat(style.getPropertyValue('--basehalf-canvas-zoom')) || 1;
				const screenTranslateY = translateY * zoom;
				const placement = surface.dataset.placement;
				return surface.dataset.chromeState !== 'suppressed'
					|| !surface.inert
					|| surface.getAttribute('aria-hidden') !== 'true'
					|| style.pointerEvents !== 'none'
					|| style.visibility !== 'hidden'
					|| Math.abs(Number.parseFloat(style.opacity || '1') - 1) > 0.001
					|| style.scale !== 'none'
					|| (placement === 'above' ? screenTranslateY <= 0 : placement === 'below' ? screenTranslateY >= 0 : true)
					|| Math.abs(Math.abs(screenTranslateY) - 6) > 0.75;
			});
			return invalid.length === 0 ? {
				mountedCount: surfaces.length,
				visibleCount: surfaces.filter(surface => getComputedStyle(surface).visibility !== 'hidden').length,
				selectedPaths: Array.from(document.querySelectorAll('.react-flow__node.selected')).flatMap(selected => {
					const selectedCard = selected.querySelector('.basehalf-canvas-card');
					return selectedCard instanceof HTMLElement && selectedCard.dataset.basehalfCardPath ? [selectedCard.dataset.basehalfCardPath] : [];
				})
			} : false;
		}, 'README.md', { timeout: 10_000 }).then(handle => handle.jsonValue());
		await waitForAdjacentChromeAnimations(page, coldDragChrome.mountedCount);
	} finally {
		await page.mouse.up();
	}
	if (coldDragChrome.visibleCount !== 0) {
		throw new Error(`An unselected Note exposed adjacent chrome during direct drag: ${JSON.stringify(coldDragChrome)}`);
	}
	await page.waitForFunction(path => {
		const card = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"]`);
		const node = card?.closest('.react-flow__node');
		const canvas = card?.closest('.basehalf-canvas-cards');
		const toolbar = document.querySelector('.basehalf-canvas-note-toolbar.basehalf-canvas-adjacent-chrome');
		const selected = Array.from(document.querySelectorAll('.react-flow__node.selected'));
		if (!(node instanceof HTMLElement)
			|| !(canvas instanceof HTMLElement)
			|| !(toolbar instanceof HTMLElement)
			|| selected.length !== 1
			|| selected[0] !== node
			|| node.classList.contains('dragging')
			|| canvas.dataset.nodeDragChrome !== undefined) {
			return false;
		}
		const style = getComputedStyle(toolbar);
		return toolbar.dataset.chromeState === 'present'
			&& !toolbar.inert
			&& toolbar.getAttribute('aria-hidden') !== 'true'
			&& style.pointerEvents !== 'none'
			&& style.visibility === 'visible'
			&& Math.abs(Number.parseFloat(style.opacity || '1') - 1) <= 0.001;
	}, 'README.md', { timeout: 10_000 });
	await waitForAdjacentChromeAnimations(page);
	const coldDropToolbar = page.locator('.basehalf-canvas-note-toolbar.basehalf-canvas-adjacent-chrome');
	assertAdjacentChromeSurfaceState(await captureAdjacentChromeSurface(coldDropToolbar), 'present', 'after directly dragging an unselected Note');
	const [restingGutterCardAfter, restingGutterScrollAfter] = await Promise.all([
		note.boundingBox(),
		staticPreview.evaluate(preview => preview.scrollTop)
	]);
	if (!restingGutterCardAfter
		|| Math.hypot(restingGutterCardAfter.x - restingGutterCardBefore.x, restingGutterCardAfter.y - restingGutterCardBefore.y) < 20
		|| Math.abs(restingGutterScrollAfter - restingGutterScrollBefore) > 1) {
		throw new Error(`The resting Note right gutter intercepted card dragging: ${JSON.stringify({ restingGutterCardBefore, restingGutterCardAfter, restingGutterScrollBefore, restingGutterScrollAfter })}`);
	}
	await pane.click({ position: { x: 16, y: 16 } });
	await toolbar.waitFor({ state: 'hidden', timeout: 10_000 });
	await centerCanvasCards(page, [note]);
	const restingZoomScrollTop = await staticPreview.evaluate(preview => {
		const maximum = Math.max(0, preview.scrollHeight - preview.clientHeight);
		const target = Math.min(32, Math.floor(maximum / 3));
		preview.scrollTop = target;
		return { maximum, target, actual: preview.scrollTop };
	});
	if (restingZoomScrollTop.maximum < 48
		|| restingZoomScrollTop.actual < 16
		|| Math.abs(restingZoomScrollTop.actual - restingZoomScrollTop.target) > 1) {
		throw new Error(`Could not establish a non-zero resting Note zoom position: ${JSON.stringify(restingZoomScrollTop)}`);
	}
	await assertCanvasNoteProgrammaticZoomLayoutInvariantSequence(page, staticPreview, 'resting', [visibleNeedle, CANVAS_MALFORMED_EMPHASIS_NEEDLE]);
	if (fs.readFileSync(readmePath, 'utf8') !== originalMarkdown) {
		throw new Error('Zooming the resting Canvas Note changed its Markdown source');
	}

	// Exercise the user's cold path before a preparatory selection can warm the
	// editor: the first click of this double-click selects the card, while the
	// second enters editing. Neither phase may replace or reflow the preview.
	await malformedParagraph().waitFor({ state: 'visible', timeout: 20_000 });
	const restingScrollState = await staticPreview.evaluate((preview, expectedParagraph) => {
		const maximum = Math.max(0, preview.scrollHeight - preview.clientHeight);
		const paragraph = Array.from(preview.querySelectorAll('p')).find(candidate => candidate.textContent === expectedParagraph);
		if (!(paragraph instanceof HTMLElement)) {
			throw new Error('Could not find the malformed emphasis paragraph in the resting Note');
		}
		const previewBounds = preview.getBoundingClientRect();
		const paragraphBounds = paragraph.getBoundingClientRect();
		const centered = preview.scrollTop + paragraphBounds.top - previewBounds.top - Math.max(0, (preview.clientHeight - paragraphBounds.height) / 2);
		const target = Math.max(0, Math.min(maximum, Math.round(centered)));
		preview.scrollTop = target;
		return { maximum, target, actual: preview.scrollTop, paragraphHeight: paragraphBounds.height, clientHeight: preview.clientHeight };
	}, CANVAS_MALFORMED_EMPHASIS_PARAGRAPH);
	if (restingScrollState.maximum < 48
		|| restingScrollState.actual < 24
		|| restingScrollState.paragraphHeight > restingScrollState.clientHeight
		|| Math.abs(restingScrollState.actual - restingScrollState.target) > 1) {
		throw new Error(`The long resting Note could not establish a meaningful scroll position: ${JSON.stringify(restingScrollState)}`);
	}
	const scrolledEntryPoint = await staticPreview.evaluate((preview, token) => {
		const body = preview.closest('.basehalf-canvas-card-body');
		if (!(body instanceof HTMLElement)) {
			throw new Error('Scrolled Note entry target is not inside its card body');
		}
		const bodyBounds = body.getBoundingClientRect();
		const previewBounds = preview.getBoundingClientRect();
		const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT);
		let node;
		while ((node = walker.nextNode())) {
			const offset = node.textContent?.indexOf(token) ?? -1;
			const parent = node.parentElement;
			if (offset < 0 || !(parent instanceof HTMLElement)) {
				continue;
			}
			const range = document.createRange();
			range.setStart(node, offset);
			range.setEnd(node, offset + token.length);
			for (const bounds of range.getClientRects()) {
				const left = Math.max(bounds.left, previewBounds.left, bodyBounds.left, 0);
				const top = Math.max(bounds.top, previewBounds.top, bodyBounds.top, 0);
				const right = Math.min(bounds.right, previewBounds.right, bodyBounds.right, window.innerWidth);
				const bottom = Math.min(bounds.bottom, previewBounds.bottom, bodyBounds.bottom, window.innerHeight);
				if (right - left <= 1 || bottom - top <= 1) {
					continue;
				}
				const point = { x: (left + right) / 2, y: (top + bottom) / 2 };
				const hit = document.elementFromPoint(point.x, point.y);
				if (hit && preview.contains(hit) && (hit === parent || parent.contains(hit) || hit.contains(parent))) {
					return point;
				}
			}
		}
		throw new Error(`Could not find a topmost visible Range for the scrolled Note token: ${token}`);
	}, CANVAS_MALFORMED_EMPHASIS_NEEDLE);
	await startCanvasNoteEditTransitionProbe(note, scrolledTransitionTokens, staticPreviewIdentity, 'enter', CANVAS_MALFORMED_EMPHASIS_PARAGRAPH);
	let directTransition;
	try {
		await page.mouse.dblclick(scrolledEntryPoint.x, scrolledEntryPoint.y);
		await waitForCanvasNoteInlineEditor(page, 'README.md');
		directTransition = await finishCanvasNoteEditTransitionProbe(page);
	} catch (error) {
		await cancelCanvasNoteEditTransitionProbe(page).catch(() => undefined);
		throw error;
	}
	assertCanvasNoteEditTransitionFrames(directTransition, scrolledTransitionTokens, staticPreviewIdentity);
	assertCanvasMalformedParagraphTransition(directTransition, CANVAS_MALFORMED_EMPHASIS_PARAGRAPH);
	if (fs.readFileSync(readmePath, 'utf8') !== originalMarkdown) {
		throw new Error('Opening the malformed Canvas Note paragraph changed its Markdown source');
	}
	await startCanvasNoteExitTransitionProbe(note, scrolledTransitionTokens, staticPreviewIdentity);
	let directExitTransition;
	try {
		await pane.click({ position: { x: 16, y: 16 } });
		await inlineEditor.host.waitFor({ state: 'detached', timeout: 15_000 });
		directExitTransition = await finishCanvasNoteExitTransitionProbe(page);
	} finally {
		await cancelCanvasNoteExitTransitionProbe(page).catch(() => undefined);
	}
	assertCanvasNoteExitTransitionFrames(directExitTransition, scrolledTransitionTokens, staticPreviewIdentity);
	await toolbar.waitFor({ state: 'hidden', timeout: 10_000 });
	const returnedRestingScrollTop = await staticPreview.evaluate(preview => preview.scrollTop);
	if (Math.abs(returnedRestingScrollTop - restingScrollState.actual) > 1
		|| await staticPreview.getAttribute('data-smoke-preview-identity') !== staticPreviewIdentity
		|| fs.readFileSync(readmePath, 'utf8') !== originalMarkdown) {
		throw new Error(`Cold direct Note editing changed its preview, scroll position, or Markdown: ${JSON.stringify({ restingScrollState, returnedRestingScrollTop })}`);
	}
	await staticPreview.evaluate(preview => preview.scrollTop = 0);

	await note.click();
	await toolbar.waitFor({ state: 'visible', timeout: 10_000 });
	const toolbarIdentity = `toolbar-${Date.now()}-${Math.random()}`;
	await toolbar.evaluate((element, identity) => element.setAttribute('data-smoke-toolbar-identity', identity), toolbarIdentity);
	const toolbarLabels = await toolbar.locator('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')));
	const expectedToolbarLabels = ['Background color', 'Heading 1', 'Heading 2', 'Heading 3', 'Paragraph', 'Bold', 'Italic', 'Bulleted list', 'Numbered list', 'Divider', 'Copy all', 'Expand README.md'];
	if (JSON.stringify(toolbarLabels) !== JSON.stringify(expectedToolbarLabels)) {
		throw new Error(`The Note toolbar has an unexpected action contract: ${JSON.stringify(toolbarLabels)}`);
	}
	const toolbarIconContract = {
		'Heading 1': 'heading1',
		'Heading 2': 'heading2',
		'Heading 3': 'heading3',
		Paragraph: 'paragraph',
		Bold: 'bold',
		Italic: 'italic',
		'Bulleted list': 'bulletList',
		'Numbered list': 'orderedList',
		Divider: 'divider',
		'Copy all': 'copy',
		'Expand README.md': 'expand'
	};
	for (const [label, iconName] of Object.entries(toolbarIconContract)) {
		const iconButton = toolbar.getByRole('button', { name: label, exact: true });
		const iconState = await iconButton.evaluate((button, expectedName) => {
			const iconElement = button.querySelector(':scope > svg.basehalf-canvas-note-toolbar-icon');
			return {
				name: iconElement?.getAttribute('data-basehalf-icon'),
				ariaHidden: iconElement?.getAttribute('aria-hidden'),
				focusable: iconElement?.getAttribute('focusable'),
				size: iconElement ? { width: getComputedStyle(iconElement).width, height: getComputedStyle(iconElement).height } : undefined,
				expectedName
			};
		}, iconName);
		if (iconState.name !== iconName
			|| iconState.ariaHidden !== 'true'
			|| iconState.focusable !== 'false'
			|| iconState.size?.width !== '18px'
			|| iconState.size?.height !== '18px') {
			throw new Error(`The Note toolbar icon contract is broken for ${label}: ${JSON.stringify({ iconName, iconState })}`);
		}
	}
	const expandButton = toolbar.getByRole('button', { name: 'Expand README.md', exact: true });
	if (!await expandButton.locator(':scope > svg[data-basehalf-icon="expand"]').count()) {
		throw new Error('The Note Expand action is not a screen-full toolbar button');
	}
	if (await page.locator('.basehalf-canvas-note-views, .basehalf-canvas-selection-toolbar').count() !== 0) {
		throw new Error('A selected Note rendered retired views or generic selection controls');
	}
	if (await note.getAttribute('data-preview-level') !== 'preview'
		|| await inlineEditor.host.count() !== 0
		|| await note.locator('.basehalf-canvas-note-editor-fallback').count() !== 0) {
		throw new Error('Selecting a Note replaced its static preview with an editor surface');
	}
	const selectedPreviewState = await staticPreview.evaluate((preview, expectedIdentity) => ({
		identity: preview.getAttribute('data-smoke-preview-identity'),
		html: preview.innerHTML,
		expectedIdentity
	}), staticPreviewIdentity);
	if (selectedPreviewState.identity !== selectedPreviewState.expectedIdentity || selectedPreviewState.html !== staticPreviewHtml) {
		throw new Error(`Selecting a Note replaced or rewrote its static preview: ${JSON.stringify(selectedPreviewState)}`);
	}
	const selectedSoftLines = await measureSoftLines(staticPreview);
	if (unselectedSoftLines.some((metric, index) => Math.abs(metric.x - selectedSoftLines[index].x) > 1
		|| Math.abs(metric.y - selectedSoftLines[index].y) > 1
		|| Math.abs(metric.height - selectedSoftLines[index].height) > 1)) {
		throw new Error(`Selecting a Note changed its soft-line layout: ${JSON.stringify({ unselectedSoftLines, selectedSoftLines })}`);
	}
	if (fs.readFileSync(readmePath, 'utf8') !== originalMarkdown) {
		throw new Error('Selecting a Note changed its Markdown source');
	}
	await assertNoCanvasNoteHeavyEditor(page, cardSelector, 'single-click selection');
	const backgroundButton = toolbar.getByRole('button', { name: 'Background color', exact: true });
	await backgroundButton.click();
	const blueBackground = page.getByRole('menuitemradio', { name: 'Blue background', exact: true });
	await blueBackground.click();
	await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute('data-note-background') === 'blue', cardSelector, { timeout: 3_000 });
	const appearancePath = path.join(workspacePath, '.bh', 'mirror', 'README.md', 'appearance.yaml');
	await waitUntil(() => fs.existsSync(appearancePath) && fs.readFileSync(appearancePath, 'utf8') === 'background: blue\n', 'Canvas Note background to persist');
	await backgroundButton.click();
	await page.getByRole('menuitemradio', { name: 'Default background', exact: true }).click();
	await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute('data-note-background') === 'default', cardSelector, { timeout: 3_000 });
	await waitUntil(() => fs.readFileSync(appearancePath, 'utf8') === 'background: default\n', 'Canvas Note background reset to persist');
	await page.waitForFunction(selector => {
		const card = document.querySelector(selector);
		if (!(card instanceof HTMLElement)) {
			return false;
		}
		const probe = document.createElement('span');
		probe.style.backgroundColor = 'var(--bh-card-surface)';
		card.appendChild(probe);
		const settled = getComputedStyle(card).backgroundColor === getComputedStyle(probe).backgroundColor;
		probe.remove();
		return settled;
	}, cardSelector, { timeout: 3_000 });
	let selectedNoteChrome = await captureCanvasCardComputedChrome(note);
	assertCanvasCardResizeChromeIsNeutral(selectedNoteChrome, 'selected Note pointer state');
	assertCanvasCardHasRoundedCornerResizeTargets(selectedNoteChrome, 'selected Note pointer state');
	if (!selectedNoteChrome.cardSelected
		|| !selectedNoteChrome.nodeSelected
		|| selectedNoteChrome.visibleResizeHandles !== 4
		|| selectedNoteChrome.interactiveResizeHandles !== 4) {
		throw new Error(`A selected Note did not expose four corner resize hit targets: ${JSON.stringify(selectedNoteChrome)}`);
	}
	try {
		await page.emulateMedia({ forcedColors: 'active' });
		await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
		const forcedSelectedChrome = await captureCanvasCardComputedChrome(note);
		if (forcedSelectedChrome.cardFocusVisible
			|| forcedSelectedChrome.cardPaint.outlineStyle === 'none'
			|| Number.parseFloat(forcedSelectedChrome.cardPaint.outlineWidth) !== 1
			|| forcedSelectedChrome.cardPaint.outlineColor !== forcedSelectedChrome.colors.activeBorder) {
			throw new Error(`Forced-colors selection did not render a one-pixel CanvasText outline: ${JSON.stringify(forcedSelectedChrome)}`);
		}
		await page.keyboard.press('Tab');
		await note.evaluate(card => {
			const node = card.closest('.react-flow__node-basehalf-card');
			if (!(node instanceof HTMLElement)) {
				throw new Error('Selected Note is missing its React Flow focus owner');
			}
			node.focus();
		});
		const forcedKeyboardChrome = await captureCanvasCardComputedChrome(note);
		if (!forcedKeyboardChrome.nodeFocusVisible
			|| forcedKeyboardChrome.cardFocusVisible
			|| (forcedKeyboardChrome.nodePaint.outlineStyle !== 'none' && forcedKeyboardChrome.nodePaint.outlineWidth !== '0px')
			|| forcedKeyboardChrome.cardPaint.outlineStyle === 'none'
			|| Number.parseFloat(forcedKeyboardChrome.cardPaint.outlineWidth) !== 2
			|| forcedKeyboardChrome.cardPaint.outlineColor !== forcedKeyboardChrome.colors.focusRing
			|| forcedKeyboardChrome.cardPaint.outlineColor === forcedSelectedChrome.cardPaint.outlineColor) {
			throw new Error(`Forced-colors keyboard focus did not replace selection with a two-pixel Highlight outline: ${JSON.stringify({ forcedSelectedChrome, forcedKeyboardChrome })}`);
		}
	} finally {
		await page.emulateMedia({ forcedColors: 'none' });
		await note.evaluate(async card => {
			await Promise.allSettled(card.getAnimations().map(animation => animation.finished));
		});
	}
	await note.evaluate(card => card.blur());
	await note.click();
	selectedNoteChrome = await captureCanvasCardComputedChrome(note);
	assertCanvasCardResizeChromeIsNeutral(selectedNoteChrome, 'pointer-restored selected Note after forced-colors');
	await page.keyboard.press('Tab');
	await note.evaluate(card => card.focus());
	const keyboardFocusedNoteChrome = await captureCanvasCardComputedChrome(note);
	if (!keyboardFocusedNoteChrome.cardFocusVisible
		|| keyboardFocusedNoteChrome.cardPaint.outlineStyle === 'none'
		|| keyboardFocusedNoteChrome.cardPaint.outlineWidth === '0px'
		|| keyboardFocusedNoteChrome.cardPaint.outlineColor !== keyboardFocusedNoteChrome.colors.focusRing) {
		throw new Error(`Keyboard focus did not render the Canvas focus ring: ${JSON.stringify(keyboardFocusedNoteChrome)}`);
	}
	assertCanvasCardUsesActiveBorder(keyboardFocusedNoteChrome, 'keyboard-focused selected Note');
	await note.evaluate(card => card.blur());
	await page.keyboard.press('Tab');
	await note.evaluate(card => {
		const node = card.closest('.react-flow__node-basehalf-card');
		if (!(node instanceof HTMLElement)) {
			throw new Error('Selected Note is missing its React Flow focus owner');
		}
		node.focus();
	});
	const keyboardFocusedNodeChrome = await captureCanvasCardComputedChrome(note);
	if (!keyboardFocusedNodeChrome.nodeFocusVisible
		|| keyboardFocusedNodeChrome.cardFocusVisible
		|| (keyboardFocusedNodeChrome.nodePaint.outlineStyle !== 'none' && keyboardFocusedNodeChrome.nodePaint.outlineWidth !== '0px')
		|| keyboardFocusedNodeChrome.cardPaint.outlineStyle === 'none'
		|| keyboardFocusedNodeChrome.cardPaint.outlineWidth === '0px'
		|| keyboardFocusedNodeChrome.cardPaint.outlineColor !== keyboardFocusedNodeChrome.colors.focusRing) {
		throw new Error(`React Flow focus owner did not project exactly one Canvas focus ring onto its card: ${JSON.stringify(keyboardFocusedNodeChrome)}`);
	}
	assertCanvasCardUsesActiveBorder(keyboardFocusedNodeChrome, 'keyboard-focused selected Note through React Flow owner');
	await note.evaluate(card => (card.closest('.react-flow__node-basehalf-card') as HTMLElement | null)?.blur());
	await note.click();
	selectedNoteChrome = await captureCanvasCardComputedChrome(note);
	assertCanvasCardResizeChromeIsNeutral(selectedNoteChrome, 'pointer-restored selected Note');

	const [selectedNoteBox, initialToolbarBox] = await Promise.all([note.boundingBox(), toolbar.boundingBox()]);
	if (!selectedNoteBox || !initialToolbarBox) {
		throw new Error('Could not measure the selected Note toolbar');
	}
	const toolbarIsSeparated = initialToolbarBox.y + initialToolbarBox.height <= selectedNoteBox.y - 8
		|| initialToolbarBox.y >= selectedNoteBox.y + selectedNoteBox.height + 8;
	if (!toolbarIsSeparated) {
		throw new Error('The Note toolbar overlaps the selected card or its connection area');
	}
	const stacking = await note.evaluate(card => {
		const node = card.closest('.react-flow__node');
		const controls = document.querySelector('.basehalf-canvas-note-toolbar');
		return {
			node: node ? Number(getComputedStyle(node).zIndex) : Number.NaN,
			controls: controls ? Number(getComputedStyle(controls).zIndex) : Number.NaN
		};
	});
	if (!Number.isFinite(stacking.node) || !Number.isFinite(stacking.controls) || stacking.controls <= stacking.node) {
		throw new Error(`Note controls do not stay above the selected node: ${JSON.stringify(stacking)}`);
	}
	for (let attempt = 0; attempt < 12; attempt++) {
		if (!await zoomCanvas(page, 'out')) {
			break;
		}
		await page.waitForTimeout(50);
	}
	await page.waitForFunction(() => Number(document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom')) <= 0.21, null, { timeout: 10_000 });
	const zoomedToolbarBox = await toolbar.boundingBox();
	if (!zoomedToolbarBox
		|| Math.abs(zoomedToolbarBox.width - initialToolbarBox.width) > 1
		|| Math.abs(zoomedToolbarBox.height - initialToolbarBox.height) > 1) {
		throw new Error('The Note toolbar changed screen size with canvas zoom');
	}
	if (await inlineEditor.host.count() !== 0) {
		throw new Error('Zooming a selected Note mounted its inline editor');
	}
	await zoomCanvas(page, 'reset');
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '1', null, { timeout: 10_000 });

	// The glyph, not the name: a double click on the name renames in place.
	await note.locator('.basehalf-canvas-card-caption-icon').dblclick();
	await page.waitForTimeout(250);
	if (await inlineEditor.host.count() !== 0
		|| await staticPreview.getAttribute('data-smoke-preview-identity') !== staticPreviewIdentity) {
		throw new Error('Double-clicking the Note header entered content editing or replaced its static preview');
	}

	// Use a block that is physically inside the clipped card viewport. A locator
	// can report later paragraphs as visible even when the card's overflow clips
	// their click point to an earlier block.
	await sourceParagraph().waitFor({ state: 'visible', timeout: 20_000 });
	await startCanvasNoteEditTransitionProbe(note, transitionTokens, staticPreviewIdentity);
	let activeInlineEditor;
	let editTransition;
	try {
		await sourceParagraph().dblclick();
		activeInlineEditor = await waitForCanvasNoteInlineEditor(page, 'README.md');
		editTransition = await finishCanvasNoteEditTransitionProbe(page);
	} catch (error) {
		await cancelCanvasNoteEditTransitionProbe(page).catch(() => undefined);
		throw error;
	}
	assertCanvasNoteEditTransitionFrames(editTransition, transitionTokens, staticPreviewIdentity);
	await assertNoCanvasNoteHeavyEditor(page, cardSelector, 'inline WYSIWYG editing');
	if (await toolbar.getAttribute('data-smoke-toolbar-identity') !== toolbarIdentity
		|| JSON.stringify(await toolbar.locator('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))) !== JSON.stringify(expectedToolbarLabels)) {
		throw new Error('Entering Note editing replaced or changed the selected-card toolbar');
	}
	const editingFallback = note.locator('.basehalf-canvas-note-editor-fallback');
	if (await editingFallback.count() !== 1 || await editingFallback.getAttribute('aria-hidden') !== 'true') {
		throw new Error('The ready Canvas inline editor did not retain one accessibility-hidden atomic exit frame');
	}
	const editingCursor = await activeInlineEditor.editable.evaluate(editable => getComputedStyle(editable).cursor);
	if (editingCursor !== 'text') {
		throw new Error(`The active Note editor must advertise text input, got cursor=${editingCursor}`);
	}
	await placeCanvasInlineCaretAfter(activeInlineEditor.editable, visibleNeedle);
	const activeZoomScrollTop = await activeInlineEditor.surface.evaluate(surface => {
		const maximum = Math.max(0, surface.scrollHeight - surface.clientHeight);
		const target = Math.min(24, Math.floor(maximum / 4));
		surface.scrollTop = target;
		return { maximum, target, actual: surface.scrollTop };
	});
	if (activeZoomScrollTop.maximum < 48
		|| activeZoomScrollTop.actual < 12
		|| Math.abs(activeZoomScrollTop.actual - activeZoomScrollTop.target) > 1) {
		throw new Error(`Could not establish a non-zero active Note zoom position: ${JSON.stringify(activeZoomScrollTop)}`);
	}
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	await assertCanvasNoteProgrammaticZoomLayoutInvariantSequence(page, activeInlineEditor.surface, 'active', transitionTokens);
	if (fs.readFileSync(readmePath, 'utf8') !== originalMarkdown) {
		throw new Error('Zooming the active Canvas Note changed its Markdown source');
	}
	await activeInlineEditor.surface.evaluate(surface => surface.scrollTop = 0);
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	const editingChrome = await captureCanvasCardComputedChrome(note);
	assertCanvasCardResizeChromeIsNeutral(editingChrome, 'active Note editing');
	assertCanvasCardPaintEqual(selectedNoteChrome.cardPaint, editingChrome.cardPaint, 'selected-to-editing transition');
	if (editingChrome.cardSelected
		|| editingChrome.paintedResizeLines !== 0
		|| editingChrome.resizeHandles.some(handle => handle.indicatorVisible)
		|| editingChrome.liveConnectionHandles !== 0) {
		throw new Error(`Editing a Note exposed structural selection chrome: ${JSON.stringify(editingChrome)}`);
	}
	// It keeps its resize targets, which paint nothing at rest (canvas card
	// resize, "While a Note is edited").
	assertCanvasCardHasRoundedCornerResizeTargets(editingChrome, 'active Note editing');
	const editingCardBox = await note.boundingBox();
	if (!staticCardBox || !editingCardBox
		|| Math.abs(staticCardBox.width - editingCardBox.width) > 1
		|| Math.abs(staticCardBox.height - editingCardBox.height) > 1) {
		throw new Error(`Opening the Canvas inline editor changed card geometry: ${JSON.stringify({ staticCardBox, editingCardBox })}`);
	}
	const editingSoftLines = await measureSoftLines(activeInlineEditor.surface);
	if (selectedSoftLines.some((metric, index) => Math.abs(metric.x - editingSoftLines[index].x) > 1
		|| Math.abs(metric.y - editingSoftLines[index].y) > 1
		|| Math.abs(metric.height - editingSoftLines[index].height) > 1)) {
		throw new Error(`Opening the Canvas inline editor changed its soft-line layout: ${JSON.stringify({ selectedSoftLines, editingSoftLines })}`);
	}
	await selectCanvasInlineToken(activeInlineEditor.editable, visibleNeedle);
	const boldButton = toolbar.getByRole('button', { name: 'Bold', exact: true });
	await boldButton.click();
	await page.waitForFunction(token => Array.from(document.querySelectorAll('.basehalf-canvas-markdown-inline > .ProseMirror strong')).some(element => element.textContent?.includes(token)), visibleNeedle, { timeout: 3_000 });
	const toolbarFormatFocus = await activeInlineEditor.editable.evaluate(editable => ({
		contenteditable: editable.getAttribute('contenteditable'),
		focused: document.activeElement === editable || editable.contains(document.activeElement),
		selection: document.getSelection()?.toString()
	}));
	if (toolbarFormatFocus.contenteditable !== 'true' || !toolbarFormatFocus.focused || toolbarFormatFocus.selection !== visibleNeedle) {
		throw new Error(`A toolbar format command lost the active editor selection: ${JSON.stringify(toolbarFormatFocus)}`);
	}
	await boldButton.click();
	await page.waitForFunction(token => !Array.from(document.querySelectorAll('.basehalf-canvas-markdown-inline > .ProseMirror strong')).some(element => element.textContent?.includes(token)), visibleNeedle, { timeout: 3_000 });
	const editingDragBefore = await note.boundingBox();
	const editingDragTarget = await activeInlineEditor.editable.boundingBox();
	if (!editingDragBefore || !editingDragTarget) {
		throw new Error('Could not measure the active Note drag fence');
	}
	await page.mouse.move(editingDragTarget.x + 12, editingDragTarget.y + Math.min(12, editingDragTarget.height / 2));
	await page.mouse.down();
	await page.mouse.move(editingDragTarget.x + 52, editingDragTarget.y + Math.min(30, editingDragTarget.height / 2 + 18), { steps: 6 });
	await page.mouse.up();
	const editingDragAfter = await note.boundingBox();
	if (!editingDragAfter
		|| Math.abs(editingDragBefore.x - editingDragAfter.x) > 1
		|| Math.abs(editingDragBefore.y - editingDragAfter.y) > 1) {
		throw new Error(`Dragging inside the active editor moved the canvas card: ${JSON.stringify({ editingDragBefore, editingDragAfter })}`);
	}
	const siblingQuote = activeInlineEditor.surface.locator('.basehalf-canvas-markdown-inline-unit blockquote', { hasText: 'Smoke editable quote.' }).first();
	await siblingQuote.click();
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-markdown-inline > .ProseMirror strong')?.textContent?.includes('Smoke editable quote.'), null, { timeout: 3_000 });
	const siblingSoftLines = activeInlineEditor.surface.locator('.basehalf-canvas-markdown-inline-unit p', { hasText: visibleNeedle }).first();
	await siblingSoftLines.click();
	await page.waitForFunction(token => document.querySelector('.basehalf-canvas-markdown-inline > .ProseMirror')?.textContent?.includes(token), visibleNeedle, { timeout: 3_000 });
	// Keep both endpoints in one clipped card viewport. This still crosses two
	// real top-level Markdown units, while leaving native pointer selection—not
	// programmatic scrolling during pointerdown—to own the directional range.
	const crossUnitSelectionToken = CANVAS_MALFORMED_EMPHASIS_PARAGRAPH.slice(0, 12);
	const upwardSelection = await dragSelectCanvasInline(page, activeInlineEditor.editable, crossUnitSelectionToken, 'soft-line-alpha');
	if (upwardSelection.collapsed
		|| !upwardSelection.text.includes('soft-line-beta')
		|| upwardSelection.anchorUnit === upwardSelection.focusUnit) {
		throw new Error(`Bottom-up Canvas Markdown selection stopped at a unit boundary: ${JSON.stringify(upwardSelection)}`);
	}
	const downwardSelection = await dragSelectCanvasInline(page, activeInlineEditor.editable, 'soft-line-alpha', crossUnitSelectionToken);
	if (downwardSelection.collapsed
		|| !downwardSelection.text.includes('soft-line-beta')
		|| downwardSelection.anchorUnit === downwardSelection.focusUnit) {
		throw new Error(`Top-down Canvas Markdown selection stopped at a unit boundary: ${JSON.stringify(downwardSelection)}`);
	}
	if (fs.readFileSync(readmePath, 'utf8') !== originalMarkdown) {
		throw new Error('Moving the caret or selecting across Markdown units changed source bytes without a text edit');
	}
	const crossUnitReplacement = 'canvas-cross-unit-replacement';
	await page.keyboard.insertText(crossUnitReplacement);
	await page.waitForFunction(marker => {
		const text = document.querySelector('.basehalf-canvas-markdown-inline > .ProseMirror')?.textContent ?? '';
		return text.includes(marker) && !text.includes('soft-line-beta');
	}, crossUnitReplacement, { timeout: 3_000 });
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
	await page.waitForFunction(marker => {
		const text = document.querySelector('.basehalf-canvas-markdown-inline > .ProseMirror')?.textContent ?? '';
		return !text.includes(marker) && text.includes('soft-line-beta') && text.includes('Smoke editable quote.');
	}, crossUnitReplacement, { timeout: 3_000 });

	await placeCanvasInlineCaretBefore(activeInlineEditor.editable, 'needle-basehalf-second');
	await page.keyboard.press('Backspace');
	await page.waitForFunction(() => {
		const root = document.querySelector('.basehalf-canvas-markdown-inline > .ProseMirror');
		if (!(root instanceof HTMLElement)) {
			return false;
		}
		const unitFor = token => {
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
			let node;
			while ((node = walker.nextNode())) {
				if (node.textContent?.includes(token)) {
					return node.parentElement?.closest('[data-basehalf-markdown-unit]')?.getAttribute('data-basehalf-markdown-unit');
				}
			}
			return undefined;
		};
		const first = unitFor('needle-basehalf-routing');
		const second = unitFor('needle-basehalf-second');
		return first !== undefined && first === second;
	}, null, { timeout: 3_000 });
	const joinedBoundaryMarkdown = originalMarkdown.replace(
		'needle-basehalf-routing\n\nneedle-basehalf-second',
		'needle-basehalf-routingneedle-basehalf-second'
	);
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S');
	await waitUntil(
		() => fs.readFileSync(readmePath, 'utf8') === joinedBoundaryMarkdown,
		'Backspace at a paragraph boundary to save one joined Markdown paragraph',
		15_000
	);
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
	await page.waitForFunction(() => {
		const units = Array.from(document.querySelectorAll('.basehalf-canvas-markdown-inline > .ProseMirror > [data-basehalf-markdown-unit]'));
		return units.some(unit => unit.textContent?.includes('needle-basehalf-routing'))
			&& units.some(unit => unit.textContent?.includes('needle-basehalf-second'))
			&& !units.some(unit => unit.textContent?.includes('needle-basehalf-routing') && unit.textContent?.includes('needle-basehalf-second'));
	}, null, { timeout: 3_000 });
	await pane.click({ position: { x: 16, y: 16 } });
	await inlineEditor.host.waitFor({ state: 'detached', timeout: 15_000 });
	await waitUntil(
		() => fs.readFileSync(readmePath, 'utf8') === originalMarkdown,
		'paragraph-boundary undo to restore exact Markdown bytes',
		15_000
	).catch(error => {
		throw new Error(`Paragraph-boundary undo saved unexpected Markdown: ${JSON.stringify(fs.readFileSync(readmePath, 'utf8'))}`, { cause: error });
	});
	await sourceParagraph().dblclick();
	await waitForCanvasNoteInlineEditor(page, 'README.md');

	const firstCaretMarker = ' canvas-inline-first';
	const secondCaretMarker = ' canvas-inline-second';
	await clickCanvasInlineCaretAfter(page, activeInlineEditor.editable, visibleNeedle);
	await page.keyboard.insertText(firstCaretMarker);
	// Let the first model edit close its undo group and deliberately cross VS
	// Code's 800 ms dirty-file tracker window. A BaseHalf-owned working copy must
	// stay on the Canvas instead of being opened in a native Monaco editor.
	await page.waitForTimeout(1_000);
	await page.keyboard.insertText(secondCaretMarker);
	await assertCanvasStillOnTop(page, 'before inline undo');
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
	await page.waitForFunction(({ first, second }) => {
		const text = document.querySelector('.basehalf-canvas-markdown-inline > .ProseMirror')?.textContent ?? '';
		return text.includes(first) && !text.includes(second);
	}, { first: firstCaretMarker, second: secondCaretMarker }, { timeout: 3_000 });
	await assertCanvasStillOnTop(page, 'after inline undo');
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y');
	await page.waitForFunction(({ first, second }) => {
		const text = document.querySelector('.basehalf-canvas-markdown-inline > .ProseMirror')?.textContent ?? '';
		return text.includes(first) && text.includes(second);
	}, { first: firstCaretMarker, second: secondCaretMarker }, { timeout: 3_000 });
	await assertCanvasStillOnTop(page, 'after inline redo');
	await startCanvasNoteExitTransitionProbe(note, transitionTokens, staticPreviewIdentity);
	let exitTransition;
	try {
		await pane.click({ position: { x: 16, y: 16 } });
		await inlineEditor.host.waitFor({ state: 'detached', timeout: 15_000 });
		exitTransition = await finishCanvasNoteExitTransitionProbe(page);
	} finally {
		await cancelCanvasNoteExitTransitionProbe(page).catch(() => undefined);
	}
	assertCanvasNoteExitTransitionFrames(exitTransition, transitionTokens, staticPreviewIdentity);
	await assertCanvasStillOnTop(page, 'after inline click-away');
	const caretMarker = `${firstCaretMarker}${secondCaretMarker}`;
	const expectedCaretMarkdown = originalMarkdown.replace(visibleNeedle, `${visibleNeedle}${caretMarker}`);
	await waitUntil(() => fs.readFileSync(readmePath, 'utf8') === expectedCaretMarkdown, 'click-away to durably save the localized Canvas inline edit', 15_000);
	const caretMarkdown = fs.readFileSync(readmePath, 'utf8');
	if (caretMarkdown !== expectedCaretMarkdown
		|| caretMarkdown.slice(0, caretMarkdown.indexOf(caretMarker)) + caretMarkdown.slice(caretMarkdown.indexOf(caretMarker) + caretMarker.length) !== originalMarkdown) {
		throw new Error('The Canvas inline editor changed bytes outside the visible needle edit');
	}
	await note.locator('.bh-md-preview', { hasText: caretMarker }).waitFor({ state: 'visible', timeout: 10_000 });
	await assertNoCanvasNoteHeavyEditor(page, cardSelector, 'inline click-away exit');

	const restoreReadmeFixture = async () => {
		// Test cleanup intentionally arrives as an external write. This also
		// verifies that the resting preview reconciles the same file after its
		// inline editor has been disposed.
		fs.writeFileSync(readmePath, originalMarkdown, 'utf8');
		await waitUntil(() => fs.readFileSync(readmePath, 'utf8') === originalMarkdown, 'README fixture cleanup', 15_000);
		await note.locator('.bh-md-preview p', { hasText: 'needle-basehalf-routing' }).first().waitFor({ state: 'visible', timeout: 15_000 });
	};
	await restoreReadmeFixture();
	await assertCanvasStillOnTop(page, 'after inline fixture restore');

	const quotePreview = () => note.locator('.bh-md-preview blockquote', { hasText: 'Smoke editable quote.' }).first();
	await quotePreview().waitFor({ state: 'visible', timeout: 10_000 });
	await quotePreview().dblclick();
	const quoteEditor = await waitForCanvasNoteInlineEditor(page, 'README.md');
	const activeQuote = quoteEditor.surface.locator('.basehalf-canvas-markdown-inline-unit blockquote', { hasText: 'Smoke editable quote.' }).first();
	await activeQuote.locator('strong', { hasText: 'Smoke editable quote.' }).waitFor({ state: 'visible', timeout: 5_000 });
	await activeQuote.locator('a', { hasText: 'guide link' }).waitFor({ state: 'visible', timeout: 5_000 });
	const visibleQuoteText = await activeQuote.innerText();
	if (visibleQuoteText.includes('**') || visibleQuoteText.includes('docs/guide.md')) {
		throw new Error(`Canvas inline WYSIWYG exposed Markdown markers or a link destination: ${JSON.stringify(visibleQuoteText)}`);
	}
	await assertNoCanvasNoteHeavyEditor(page, cardSelector, 'formatted inline WYSIWYG unit');
	// A press on the margin around the text leaves the keyboard in the text,
	// and the frame of the card stays the only frame: the editor's own element
	// never holds the focus and never draws the ring of a focused element.
	const quoteSurfaceBox = await quoteEditor.surface.boundingBox();
	if (!quoteSurfaceBox) {
		throw new Error('The Canvas inline editor has no box for the margin press');
	}
	await page.mouse.click(quoteSurfaceBox.x + 3, quoteSurfaceBox.y + quoteSurfaceBox.height / 2);
	await page.waitForTimeout(150);
	const afterMarginPress = await quoteEditor.surface.evaluate(surface => ({
		focusInText: !!document.activeElement?.closest('.basehalf-canvas-markdown-inline > .ProseMirror'),
		focusOnSurface: document.activeElement === surface,
		ring: getComputedStyle(surface).outlineStyle
	}));
	if (!afterMarginPress.focusInText || afterMarginPress.focusOnSurface || afterMarginPress.ring !== 'none') {
		throw new Error(`A press on the margin of the Canvas inline editor took the keyboard from the text: ${JSON.stringify(afterMarginPress)}`);
	}
	await page.keyboard.press('Escape');
	await inlineEditor.host.waitFor({ state: 'detached', timeout: 15_000 });
	if (fs.readFileSync(readmePath, 'utf8') !== originalMarkdown) {
		throw new Error('Opening and closing a formatted Canvas inline unit normalized its Markdown bytes');
	}
	await quotePreview().waitFor({ state: 'visible', timeout: 10_000 });
	await assertNoCanvasNoteHeavyEditor(page, cardSelector, 'formatted static preview');

	await sourceParagraph().waitFor({ state: 'visible', timeout: 10_000 });
	await sourceParagraph().dblclick();
	const expandInlineEditor = await waitForCanvasNoteInlineEditor(page, 'README.md');
	const expandMarker = ' canvas-expand-inline-marker';
	await placeCanvasInlineCaretAfter(expandInlineEditor.editable, visibleNeedle);
	await page.keyboard.insertText(expandMarker);
	await expandButton.click();
	await assertCardDetail(page, 'README.md');
	await inlineEditor.host.waitFor({ state: 'detached', timeout: 15_000 });
	const expectedExpandedMarkdown = originalMarkdown.replace(visibleNeedle, `${visibleNeedle}${expandMarker}`);
	await waitUntil(() => fs.readFileSync(readmePath, 'utf8') === expectedExpandedMarkdown, 'Expand to durably save Canvas inline edit before opening rich detail', 15_000);
	const expandedMarkdown = fs.readFileSync(readmePath, 'utf8');
	if (expandedMarkdown !== expectedExpandedMarkdown) {
		throw new Error('Expand did not preserve the exact Markdown bytes outside the active inline unit');
	}
	const detailFrame = await activeMarkdownRichFrame(page, '.basehalf-card-detail-surface.active');
	await detailFrame.locator('.bn-editor', { hasText: expandMarker }).waitFor({ state: 'visible', timeout: 15_000 });
	if (await markdownRichEditorFrameCount(page, '.basehalf-card-detail-surface.active') !== 1) {
		throw new Error('Expand did not leave exactly one rich editor in Card Detail');
	}
	await assertNoCanvasNoteHeavyEditor(page, cardSelector, 'expanded Card Detail');
	await assertNoEditorTabFor(page, 'README.md');
	await closeCardDetailIfOpen(page);
	await page.locator('.basehalf-canvas-cards').waitFor({ state: 'visible', timeout: 15_000 });
	await centerCanvasCards(page, [note]);
	await restoreReadmeFixture();

	await pane.click({ position: { x: 16, y: 16 } });
	await note.click();
	await toolbar.waitFor({ state: 'visible', timeout: 10_000 });
	await sourceParagraph().dblclick();
	await waitForCanvasNoteInlineEditor(page, 'README.md');
	await centerCanvasCards(page, [folder]);
	await folder.click({ modifiers: ['Shift'] });
	await page.getByRole('toolbar', { name: 'Actions for 2 selected cards', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
	await inlineEditor.host.waitFor({ state: 'detached', timeout: 15_000 });
	if (await page.locator('.basehalf-canvas-note-toolbar, [data-testid^="canvas-note-editor-"]').count() !== 0) {
		throw new Error('A multi-selection retained single-Note controls or its inline editor');
	}
	if (fs.readFileSync(readmePath, 'utf8') !== originalMarkdown) {
		throw new Error('Closing an unchanged inline editor for multi-selection changed Markdown');
	}
	await assertNoCanvasNoteHeavyEditor(page, cardSelector, 'multi-selection');

	await pane.click({ position: { x: 16, y: 16 } });
	await centerCanvasCards(page, [folder]);
	await folder.click();
	await page.getByRole('toolbar', { name: 'Selected card actions', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
	if (await page.locator('.basehalf-canvas-note-toolbar, [data-testid^="canvas-note-editor-"]').count() !== 0) {
		throw new Error('A non-Note card rendered Note controls or a Note inline editor');
	}

	const inlineSelectionErrors = pageErrors.filter(error => /Position \d+ out of range/.test(error.message));
	if (inlineSelectionErrors.length > 0) {
		throw new Error(`The Canvas inline editor produced an invalid document selection: ${inlineSelectionErrors.map(error => error.message).join('; ')}`);
	}
	if (fs.readFileSync(readmePath, 'utf8') !== originalMarkdown) {
		throw new Error('Canvas Note inline smoke did not restore the README fixture exactly');
	}
}

async function markdownRichEditorFrameCount(page, ownerSelector) {
	const counts = await Promise.all(page.frames().map(async frame => {
		if (!await markdownRichFrameBelongsTo(frame, ownerSelector)) {
			return 0;
		}
		return frame.locator('.basehalf-markdown-rich.ready .bn-editor').count().catch(() => 0);
	}));
	return counts.reduce((total, count) => total + count, 0);
}
