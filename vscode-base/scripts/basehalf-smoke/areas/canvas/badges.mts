/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The badge of a card: its preview, its editor's Upstream and Downstream, and a description file that cannot be read.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { AGENT_CREATED_CARD_CONTENT, AGENT_CREATED_CARD_PATH } from './agents.mts';
import { frameCanvasCardsForConnection } from './connections.mts';
import { centerCanvasCards } from './creation.mts';
import { root, workspacePath } from '../../context.mts';
import { readBhTree } from '../../fixture.mts';
import { assertCanvasEdgeGone, assertCanvasEdgeVisible, zoomCanvas } from '../../lib/canvas.mts';
import { expectNotification } from '../../lib/notifications.mts';
import { visibleQuickInput } from '../../lib/quickInput.mts';
import { waitUntil } from '../../lib/steps.mts';
import { readWorkspaceFile } from '../../lib/workspace.mts';

export async function assertCanvasCardBadgePreviewAndConnectors(page) {
	const checkoutConflictDialog = page.locator('.monaco-dialog-box', { hasText: 'Your local changes would be overwritten by checkout' }).first();
	if (await checkoutConflictDialog.isVisible({ timeout: 5_000 }).catch(() => false)) {
		await checkoutConflictDialog.locator('.monaco-button', { hasText: 'Cancel' }).click();
		await checkoutConflictDialog.waitFor({ state: 'hidden', timeout: 10_000 });
	}

	const canvasPath = path.join(workspacePath, '.bh', 'mirror', 'canvas.yaml');
	const readmeBadgePath = path.join(workspacePath, '.bh', 'mirror', 'README.md', 'badge.yaml');
	await zoomCanvas(page, 'reset');
	await page.waitForFunction(() => Number(document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom')) >= 0.5, null, { timeout: 10_000 });

	const readme = page.locator('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
	await readme.waitFor({ state: 'visible', timeout: 20_000 });
	await centerCanvasCards(page, [readme]);
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]')?.getAttribute('data-preview-level') === 'preview', null, { timeout: 10_000 });
	const captionMetrics = await page.waitForFunction(() => {
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
		const caption = card?.querySelector('.basehalf-canvas-card-caption');
		const content = card?.querySelector('.basehalf-canvas-card-content');
		const badge = caption?.querySelector('.basehalf-canvas-card-caption-actions .basehalf-canvas-card-badge-toggle');
		if (!(card instanceof HTMLElement) || !(caption instanceof HTMLElement) || !(content instanceof HTMLElement)
			|| !(badge instanceof HTMLElement) || !caption.isConnected || caption.getBoundingClientRect().height <= 0) {
			return false;
		}
		const cardRect = card.getBoundingClientRect();
		const captionRect = caption.getBoundingClientRect();
		return {
			height: captionRect.height,
			gap: cardRect.top - captionRect.bottom,
			leftDelta: captionRect.left - cardRect.left,
			rightDelta: captionRect.right - cardRect.right,
			cardRadius: Number.parseFloat(getComputedStyle(card).borderTopLeftRadius),
			contentRadius: Number.parseFloat(getComputedStyle(content).borderTopLeftRadius),
			hasInternalHeader: card.querySelector('.basehalf-canvas-card-header, .basehalf-canvas-card-path') !== null
		};
	}, null, { timeout: 10_000 }).then(handle => handle.jsonValue());
	if (Math.abs(captionMetrics.height - 24) > 1
		|| Math.abs(captionMetrics.gap - 8) > 1
		|| Math.abs(captionMetrics.leftDelta) > 1
		|| Math.abs(captionMetrics.rightDelta) > 1
		|| Math.abs(captionMetrics.cardRadius - 22) > 0.5
		|| Math.abs(captionMetrics.contentRadius - 21) > 0.5
		|| captionMetrics.hasInternalHeader) {
		throw new Error(`Expected one external 24px caption and unified 22px card frame, got ${JSON.stringify(captionMetrics)}`);
	}
	await readme.locator('.basehalf-canvas-card-badge-toggle.lit:visible').waitFor({ state: 'visible', timeout: 10_000 });
	await readme.locator('.basehalf-canvas-card-preview', { hasText: /Smoke README|needle-basehalf-routing/ }).waitFor({ state: 'visible', timeout: 10_000 });
	await readme.locator('.basehalf-canvas-card-badge-toggle:visible').click();
	const badgePrompt = readme.locator('.basehalf-canvas-card-badge-prompt');
	await badgePrompt.waitFor({ state: 'visible', timeout: 10_000 });
	await page.waitForFunction(() => document.activeElement?.classList.contains('basehalf-canvas-card-badge-prompt'), null, { timeout: 10_000 });
	const compositionDraft = '中文组合输入尚未结束';
	await badgePrompt.evaluate((prompt, value) => {
		prompt.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		prompt.value = value;
		prompt.dispatchEvent(new InputEvent('input', {
			bubbles: true,
			data: value,
			inputType: 'insertCompositionText',
			isComposing: true
		}));
	}, compositionDraft);
	await page.waitForTimeout(450);
	if (fs.readFileSync(readmeBadgePath, 'utf8').includes(compositionDraft)) {
		throw new Error('Canvas Badge persisted an unfinished IME composition');
	}
	await badgePrompt.evaluate((prompt, value) => prompt.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: value })), compositionDraft);
	await waitUntil(() => fs.readFileSync(readmeBadgePath, 'utf8').includes(compositionDraft), 'canvas Badge to persist a completed IME composition');
	await badgePrompt.fill('Smoke file badge');
	await badgePrompt.evaluate(prompt => prompt.blur());
	await waitUntil(() => fs.readFileSync(readmeBadgePath, 'utf8').includes('description: "Smoke file badge"'), 'canvas Badge to restore the fixture after IME composition');
	await badgePrompt.focus();
	await page.keyboard.press('Escape');
	await readme.locator('.basehalf-canvas-card-preview', { hasText: /Smoke README|needle-basehalf-routing/ }).waitFor({ state: 'visible', timeout: 10_000 });
	await page.waitForFunction(() => {
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
		return document.activeElement?.classList.contains('basehalf-canvas-card-badge-toggle')
			&& card?.contains(document.activeElement);
	}, null, { timeout: 10_000 });
	await page.keyboard.press('Enter');
	await badgePrompt.waitFor({ state: 'visible', timeout: 10_000 });
	await page.waitForFunction(() => document.activeElement?.classList.contains('basehalf-canvas-card-badge-prompt'), null, { timeout: 10_000 });
	const promptValue = await badgePrompt.inputValue();
	if (promptValue !== 'Smoke file badge') {
		throw new Error(`Expected card badge face to load prompt, got ${JSON.stringify(promptValue)}`);
	}
	await badgePrompt.fill('First prompt line');
	await badgePrompt.press('Enter');
	await page.keyboard.type('Second prompt line');
	if (await badgePrompt.inputValue() !== 'First prompt line\nSecond prompt line'
		|| await readme.getAttribute('data-projection') !== 'badge') {
		throw new Error('Enter did not behave exclusively as a newline in the canvas Badge prompt');
	}
	await badgePrompt.evaluate(prompt => prompt.blur());
	await waitUntil(() => {
		const badgeYaml = fs.readFileSync(readmeBadgePath, 'utf8');
		return badgeYaml.includes('First prompt line') && badgeYaml.includes('Second prompt line');
	}, 'multiline canvas Badge prompt to persist');
	await clickCanvasBadgeToggle(readme);
	try {
		await readme.locator('.basehalf-canvas-card-preview', { hasText: /Smoke README|needle-basehalf-routing/ }).waitFor({ state: 'visible', timeout: 10_000 });
	} catch (error) {
		const state = await readme.evaluate(card => ({
			previewLevel: card.getAttribute('data-preview-level'),
			projection: card.getAttribute('data-projection'),
			text: card.textContent,
			activeElement: card.ownerDocument.activeElement?.className,
			previewCount: card.querySelectorAll('.basehalf-canvas-card-preview').length,
			badgeFaceCount: card.querySelectorAll('.basehalf-canvas-card-badge-face').length
		}));
		throw new Error(`Canvas Badge did not close after persisting a multiline prompt: ${JSON.stringify(state)}`, { cause: error });
	}
	await readme.locator('.basehalf-canvas-card-badge-toggle:visible').click();
	await badgePrompt.waitFor({ state: 'visible', timeout: 10_000 });
	const reloadedMultilinePrompt = await badgePrompt.evaluate(prompt => ({
		value: prompt.value,
		clientHeight: prompt.clientHeight,
		scrollHeight: prompt.scrollHeight
	}));
	if (reloadedMultilinePrompt.value !== 'First prompt line\nSecond prompt line'
		|| reloadedMultilinePrompt.clientHeight < 36
		|| Math.abs(reloadedMultilinePrompt.scrollHeight - reloadedMultilinePrompt.clientHeight) > 1) {
		throw new Error(`Reloaded canvas Badge prompt collapsed its multiline content: ${JSON.stringify(reloadedMultilinePrompt)}`);
	}
	await badgePrompt.fill(Array.from({ length: 12 }, (_, index) => `Long Badge prompt line ${index + 1}`).join('\n'));
	const longPromptLayout = await badgePrompt.evaluate(prompt => {
		const body = prompt.closest('.basehalf-canvas-card-badge-scroll');
		return {
			clientHeight: prompt.clientHeight,
			scrollHeight: prompt.scrollHeight,
			scrollable: prompt.classList.contains('scrollable'),
			outlineStyle: getComputedStyle(prompt).outlineStyle,
			bodyClientHeight: body?.clientHeight ?? 0,
			bodyScrollHeight: body?.scrollHeight ?? 0
		};
	});
	if (longPromptLayout.scrollable
		|| Math.abs(longPromptLayout.scrollHeight - longPromptLayout.clientHeight) > 1
		|| longPromptLayout.bodyScrollHeight <= longPromptLayout.bodyClientHeight
		|| longPromptLayout.outlineStyle !== 'none') {
		throw new Error(`Long canvas Badge prompt did not expand to its complete content: ${JSON.stringify(longPromptLayout)}`);
	}
	const lastBadgeActionVisibleAfterLongPrompt = await readme.locator('[data-testid="badge-add-downstream"]').evaluate(button => {
		const card = button.closest('.basehalf-canvas-card');
		const body = button.closest('.basehalf-canvas-card-badge-scroll');
		if (!(card instanceof HTMLElement) || !(body instanceof HTMLElement)) {
			return false;
		}
		body.scrollTop = body.scrollHeight;
		const buttonBox = button.getBoundingClientRect();
		const cardBox = card.getBoundingClientRect();
		return buttonBox.top >= cardBox.top && buttonBox.bottom <= cardBox.bottom;
	});
	if (!lastBadgeActionVisibleAfterLongPrompt) {
		throw new Error('The canvas Badge body could not scroll from a complete prompt to its last action, Add Downstream');
	}
	const canvasBadgeDraft = 'Canvas Badge prompt survives refresh and zoom';
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
	await page.keyboard.type(canvasBadgeDraft);
	await badgePrompt.evaluate(prompt => prompt.setAttribute('data-smoke-editor-instance', 'retained'));
	fs.appendFileSync(readmeBadgePath, '\n# trigger a background Badge refresh while the prompt is focused\n', 'utf8');
	await page.waitForTimeout(750);
	const retainedPromptState = await page.evaluate(expected => {
		const prompt = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"] .basehalf-canvas-card-badge-prompt');
		return prompt instanceof HTMLTextAreaElement
			&& document.activeElement === prompt
			&& prompt.getAttribute('data-smoke-editor-instance') === 'retained'
			&& prompt.value === expected;
	}, canvasBadgeDraft);
	if (!retainedPromptState) {
		throw new Error('Background Badge refresh replaced or unfocused the active canvas prompt');
	}
	for (let attempt = 0; attempt < 4; attempt++) {
		await zoomCanvas(page, 'out', { preserveFocus: true });
		await page.waitForTimeout(80);
	}
	await page.waitForFunction(([expected, marker]) => {
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
		const prompt = card?.querySelector('.basehalf-canvas-card-badge-prompt');
		return card?.getAttribute('data-preview-level') === 'interactive'
			&& card.getAttribute('data-projection') === 'badge'
			&& prompt instanceof HTMLTextAreaElement
			&& document.activeElement === prompt
			&& prompt.getAttribute('data-smoke-editor-instance') === marker
			&& prompt.value === expected;
	}, [canvasBadgeDraft, 'retained'], { timeout: 10_000 });
	await zoomCanvas(page, 'reset', { preserveFocus: true });
	await page.waitForFunction(expected => {
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
		const prompt = card?.querySelector('.basehalf-canvas-card-badge-prompt');
		return card?.getAttribute('data-preview-level') === 'interactive'
			&& prompt instanceof HTMLTextAreaElement
			&& prompt.value === expected;
	}, canvasBadgeDraft, { timeout: 10_000 });
	await badgePrompt.fill('Smoke file badge');
	await badgePrompt.evaluate(prompt => prompt.blur());
	await page.waitForFunction(() => !document.activeElement?.classList.contains('basehalf-canvas-card-badge-prompt'), null, { timeout: 10_000 });
	await waitUntil(() => fs.readFileSync(readmeBadgePath, 'utf8').includes('description: "Smoke file badge"'), 'canvas Badge prompt fixture value to be restored');
	await readme.locator('.basehalf-canvas-card-badge-toggle:visible').click();
	await readme.locator('.basehalf-canvas-card-preview', { hasText: /Smoke README|needle-basehalf-routing/ }).waitFor({ state: 'visible', timeout: 10_000 });

	const canvasBeforeZoom = fs.readFileSync(canvasPath, 'utf8');
	await page.locator('.react-flow__pane').click({ position: { x: 16, y: 16 } });
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]')?.getAttribute('data-preview-level') === 'preview', null, { timeout: 10_000 });
	await readme.evaluate(card => {
		card.querySelector('.basehalf-canvas-card-active')?.setAttribute('data-smoke-zoom-identity', 'active');
		card.querySelector('.basehalf-canvas-card-preview')?.setAttribute('data-smoke-zoom-identity', 'preview');
	});
	for (let attempt = 0; attempt < 12; attempt++) {
		if (!await zoomCanvas(page, 'out')) {
			break;
		}
		await page.waitForTimeout(80);
	}
	await page.waitForFunction(() => {
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
		const root = document.querySelector('.basehalf-canvas-workbench');
		return Number(root?.getAttribute('data-zoom')) <= 0.21
			&& card?.getAttribute('data-preview-level') === 'preview'
			&& card.querySelectorAll('.basehalf-canvas-card-active[data-smoke-zoom-identity="active"]').length === 1
			&& card.querySelectorAll('.basehalf-canvas-card-preview[data-smoke-zoom-identity="preview"]').length === 1
			&& card.querySelector('.basehalf-canvas-card-overview') === null
			&& card.querySelector('video, audio, textarea') === null;
	}, null, { timeout: 10_000 });
	await zoomCanvas(page, 'reset');
	await page.waitForFunction(() => {
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
		return card?.getAttribute('data-preview-level') === 'preview'
			&& card.querySelectorAll('.basehalf-canvas-card-active[data-smoke-zoom-identity="active"]').length === 1
			&& card.querySelectorAll('.basehalf-canvas-card-preview[data-smoke-zoom-identity="preview"]').length === 1
			&& card.querySelector('.basehalf-canvas-card-overview') === null;
	}, null, { timeout: 10_000 });
	await readme.locator('.basehalf-canvas-card-preview', { hasText: /Smoke README|needle-basehalf-routing/ }).waitFor({ state: 'visible', timeout: 10_000 });
	if (fs.readFileSync(canvasPath, 'utf8') !== canvasBeforeZoom) {
		throw new Error('Zooming the canvas changed persisted card geometry');
	}

	const readmeNode = page.locator('.react-flow__node', { has: readme });
	const readmeHandles = readmeNode.locator(':scope > .basehalf-canvas-card-connect-handle');
	const handleCount = await readmeHandles.count();
	if (handleCount !== 4) {
		throw new Error(`Expected four card connection handles, got ${handleCount}`);
	}
	await readme.hover();
	const visibleReadmeHandles = await page.waitForFunction(() => {
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
		const node = card?.closest('.react-flow__node');
		if (!node) {
			return false;
		}
		const count = Array.from(node.querySelectorAll(':scope > .basehalf-canvas-card-connect-handle')).filter(handle => {
			const style = getComputedStyle(handle);
			return Number(style.opacity) > 0.5 && style.pointerEvents !== 'none';
		}).length;
		return count === 4 ? count : false;
	}, null, { timeout: 10_000 }).then(handle => handle.jsonValue());
	if (visibleReadmeHandles !== 4) {
		throw new Error(`Expected all four React Flow handles on card hover, got ${visibleReadmeHandles}`);
	}
}

// The agent-created note with an `upstream` frontmatter list naming `entries`,
// exactly as the BaseHalf planner writes it; with no entries, the note's own
// bytes (the planner removes an emptied block together with its fences).
export function agentNoteWithUpstream(entries) {
	return entries.length === 0
		? AGENT_CREATED_CARD_CONTENT
		: `---\nupstream:\n${entries.map(entry => `  - ${entry}\n`).join('')}---\n${AGENT_CREATED_CARD_CONTENT}`;
}

// Paths under .bh/ whose bytes differ from `before` (a readBhTree() snapshot).
// Machine-local runtime state under .bh/cache/ is not project metadata.
export function bhTreeChangesSince(before) {
	const after = readBhTree();
	return [...new Set([...Object.keys(before), ...Object.keys(after)])]
		.filter(rel => before[rel] !== after[rel] && !rel.startsWith('.bh/cache/'))
		.sort();
}

export async function assertCanvasUnreadableBadgeRecovers(page) {
	const badgePath = path.join(workspacePath, '.bh', 'mirror', 'README.md', 'badge.yaml');
	const recoveryRoot = path.join(workspacePath, '.bh', 'cache', 'recovered');
	const recoveryDir = path.join(recoveryRoot, 'mirror', 'README.md');
	const readme = page.locator('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
	const fixture = fs.readFileSync(badgePath, 'utf8');
	// A toggle click that lands while the canvas re-renders after a file change
	// is dropped, so the face is opened and closed until it is in the wanted state.
	const setBadgeFace = async open => {
		for (let attempt = 0; attempt < 6; attempt++) {
			if ((await readme.getAttribute('data-projection') === 'badge') === open) {
				return;
			}
			await clickCanvasBadgeToggle(readme);
			await page.waitForFunction(wanted => {
				const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
				return (card?.getAttribute('data-projection') === 'badge') === wanted;
			}, open, { timeout: 2_000 }).catch(() => undefined);
		}
		throw new Error(`The README badge face did not ${open ? 'open' : 'close'}`);
	};
	const conflicted = 'path: "README.md"\nkind: file\n<<<<<<< HEAD\ndescription: "Ours"\n=======\ndescription: "Theirs"\n>>>>>>> feature\n';
	fs.writeFileSync(badgePath, conflicted, 'utf8');

	// The toggle is lit by a description or by an issue: the card now has neither.
	await page.waitForFunction(() => {
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
		const toggle = card?.querySelector('.basehalf-canvas-card-badge-toggle');
		return toggle instanceof HTMLElement && !toggle.classList.contains('lit');
	}, null, { timeout: 10_000 });
	await setBadgeFace(true);
	const badgePrompt = readme.locator('.basehalf-canvas-card-badge-prompt');
	await badgePrompt.waitFor({ state: 'visible', timeout: 10_000 });
	if (await badgePrompt.inputValue() !== '' || await readme.locator('[data-testid="badge-metadata-issue"]').count() !== 0) {
		throw new Error('A description file that cannot be read was shown as an issue instead of an empty description field');
	}

	await badgePrompt.fill('Recovered badge');
	await badgePrompt.evaluate(prompt => prompt.blur());
	await waitUntil(() => {
		const saved = fs.readFileSync(badgePath, 'utf8');
		return saved.includes('description: "Recovered badge"') && !saved.includes('<<<<<<<');
	}, 'a new description to replace the description file that could not be read');
	const copies = fs.existsSync(recoveryDir) ? fs.readdirSync(recoveryDir) : [];
	if (copies.length !== 1 || !/^badge\.[0-9a-f]{12}\.yaml$/.test(copies[0]) || fs.readFileSync(path.join(recoveryDir, copies[0]), 'utf8') !== conflicted) {
		throw new Error(`The description file that could not be read was not kept as one recovery copy: ${JSON.stringify(copies)}`);
	}
	await expectNotification(page, 'could not read the saved description of README.md');

	// Hand the fixture back as the next steps expect it.
	await badgePrompt.fill('Smoke file badge');
	await badgePrompt.evaluate(prompt => prompt.blur());
	await waitUntil(() => fs.readFileSync(badgePath, 'utf8').includes('description: "Smoke file badge"'), 'the fixture description to be restored');
	await setBadgeFace(false);
	await readme.locator('.basehalf-canvas-card-preview', { hasText: /Smoke README|needle-basehalf-routing/ }).waitFor({ state: 'visible', timeout: 10_000 });
	fs.writeFileSync(badgePath, fixture, 'utf8');
	fs.rmSync(recoveryRoot, { recursive: true, force: true });

	// Criterion 11: when the file system refuses to read the file, a line with
	// the cause takes the place of the description field, and nothing there
	// leads into `.bh/`. Permission bits do not refuse a read on Windows.
	if (process.platform === 'win32') {
		return;
	}
	const canvasPath = path.join(workspacePath, '.bh', 'mirror', 'canvas.yaml');
	const refreshMirror = () => fs.writeFileSync(canvasPath, fs.readFileSync(canvasPath));
	const issueNotice = page.locator('.basehalf-canvas-warning', { hasText: '1 description could not be loaded' });
	fs.chmodSync(badgePath, 0o000);
	try {
		refreshMirror();
		await issueNotice.waitFor({ state: 'visible', timeout: 10_000 });
		await setBadgeFace(true);
		const issue = readme.locator('[data-testid="badge-metadata-issue"]');
		await issue.waitFor({ state: 'visible', timeout: 10_000 });
		const shown = {
			text: (await issue.innerText()).replace(/\s+/g, ' '),
			buttons: await issue.locator('button').count(),
			prompts: await readme.locator('.basehalf-canvas-card-badge-prompt').count()
		};
		if (!shown.text.includes('BaseHalf could not load it:') || shown.buttons !== 0 || shown.prompts !== 0) {
			throw new Error(`A description the file system refuses to read was not shown as one line without a button: ${JSON.stringify(shown)}`);
		}
	} finally {
		fs.chmodSync(badgePath, 0o644);
	}
	refreshMirror();
	await issueNotice.waitFor({ state: 'detached', timeout: 10_000 });
	await badgePrompt.waitFor({ state: 'visible', timeout: 10_000 });
	await setBadgeFace(false);
	await readme.locator('.basehalf-canvas-card-preview', { hasText: /Smoke README|needle-basehalf-routing/ }).waitFor({ state: 'visible', timeout: 10_000 });
}

// Clicks a card's badge toggle by script. A locator resolves its element in
// one step and runs the script in the next; a re-render in between leaves the
// script holding a card that is no longer in the document, where a click does
// nothing. So the card on screen is looked up and clicked in the same step.
async function clickCanvasBadgeToggle(card) {
	await card.locator('.basehalf-canvas-card-badge-toggle:visible').waitFor({ state: 'visible', timeout: 10_000 });
	await card.evaluate(element => {
		const path = element.getAttribute('data-basehalf-card-path') ?? '';
		const live = element.isConnected ? element : document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"]`);
		const toggle = Array.from(live?.querySelectorAll('.basehalf-canvas-card-badge-toggle') ?? []).find(button => button.getClientRects().length > 0);
		if (!(toggle instanceof HTMLElement)) {
			throw new Error(`No visible badge toggle on the card ${path}`);
		}
		toggle.click();
	});
}

// Opens the badge face of a canvas card and waits for its Upstream section.
export async function openCanvasBadgeFace(card) {
	await clickCanvasBadgeToggle(card);
	await card.locator('[data-testid="badge-upstream"]').waitFor({ state: 'visible', timeout: 10_000 });
}

export async function closeCanvasBadgeFace(card) {
	await clickCanvasBadgeToggle(card);
	await card.locator('[data-testid="badge-upstream"]').waitFor({ state: 'detached', timeout: 10_000 });
}

// The Upstream rows of a canvas card's badge face, in list order, as
// `status:path` (a valid row names its target, an issue row its entry text).
export async function canvasBadgeUpstreamRows(card) {
	return card.locator('[data-testid="badge-upstream-row"]').evaluateAll(rows => rows.map(row => {
		const name = row.querySelector('.basehalf-canvas-card-badge-link, .basehalf-canvas-card-badge-entry-text')?.getAttribute('title');
		return `${row.getAttribute('data-upstream-status')}:${name}`;
	}));
}

// The badge editor edits a card's own Upstream list and shows its derived
// Downstream list. Add Upstream picks from the whole workspace folder (here a
// file in another folder) and writes only the note; × removes the entry.
// Downstream × and Add Downstream write the other card's list exactly as a
// canvas disconnect or connect would.
export async function assertBadgeEditorUpstreamDownstream(page) {
	const note = AGENT_CREATED_CARD_PATH;
	const noteCard = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${note}"]`);
	const readme = page.locator('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
	const docs = page.locator('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
	await frameCanvasCardsForConnection(page, [readme, docs, noteCard]);
	if (readWorkspaceFile(note) !== agentNoteWithUpstream(['docs', 'README.md'])) {
		throw new Error(`${note} must list docs and README.md before the badge editor checks`);
	}
	const readmeBefore = readWorkspaceFile('README.md');
	const pickFromQuickInput = async (title, query, rowText) => {
		const widget = page.locator('.quick-input-widget:visible');
		await widget.locator('.quick-input-title', { hasText: title }).waitFor({ state: 'visible', timeout: 10_000 });
		await visibleQuickInput(page).fill(query);
		const row = widget.locator('.quick-input-list .monaco-list-row[role="option"]', { hasText: rowText }).first();
		await row.waitFor({ state: 'visible', timeout: 15_000 });
		await row.click();
		await widget.waitFor({ state: 'hidden', timeout: 10_000 });
	};

	await openCanvasBadgeFace(noteCard);
	const helper = await noteCard.locator('[data-testid="badge-upstream"] .basehalf-canvas-card-badge-helper').textContent();
	if (!helper?.includes('Saved inside this file')) {
		throw new Error(`The note's Upstream helper does not name its own store: ${JSON.stringify(helper)}`);
	}
	await noteCard.locator('[data-testid="badge-add-upstream"]').click();
	await pickFromQuickInput(`Add upstream to ${note}`, 'app.ts', 'src/app.ts');
	await waitUntil(() => readWorkspaceFile(note) === agentNoteWithUpstream(['docs', 'README.md', 'src/app.ts']), 'Add Upstream to append the picked workspace file to the note');
	const appRow = noteCard.locator('[data-testid="badge-upstream-row"][data-upstream-status="valid"]', { hasText: 'app.ts' });
	await appRow.waitFor({ state: 'visible', timeout: 10_000 });
	const appRemove = appRow.locator('.basehalf-canvas-card-badge-remove');
	if (await appRemove.getAttribute('aria-label') !== 'Remove src/app.ts from upstream') {
		throw new Error(`The Upstream × has the wrong accessible name: ${await appRemove.getAttribute('aria-label')}`);
	}
	await appRemove.click();
	await waitUntil(() => readWorkspaceFile(note) === agentNoteWithUpstream(['docs', 'README.md']), 'Upstream × to remove only that entry from the note');
	await closeCanvasBadgeFace(noteCard);

	await openCanvasBadgeFace(readme);
	const readmeDownstream = readme.locator(`[data-testid="badge-downstream-row"][data-downstream-path="${note}"]`);
	await readmeDownstream.waitFor({ state: 'visible', timeout: 10_000 });
	const downstreamRemove = readmeDownstream.locator('.basehalf-canvas-card-badge-remove');
	if (await downstreamRemove.getAttribute('title') !== `Remove from the upstream of ${note}`) {
		throw new Error(`The Downstream × tooltip does not name the file it writes: ${await downstreamRemove.getAttribute('title')}`);
	}
	await downstreamRemove.click();
	await waitUntil(() => readWorkspaceFile(note) === agentNoteWithUpstream(['docs']), 'Downstream × to remove README.md from the note\'s upstream list');
	await assertCanvasEdgeGone(page, 'README.md', note);
	await readme.locator('[data-testid="badge-downstream-empty"]').waitFor({ state: 'visible', timeout: 10_000 });
	await readme.locator('[data-testid="badge-add-downstream"]').click();
	await pickFromQuickInput('Add downstream of README.md', 'agent-angle', note);
	await waitUntil(() => readWorkspaceFile(note) === agentNoteWithUpstream(['docs', 'README.md']), 'Add Downstream to add README.md to the note\'s upstream list');
	await readmeDownstream.waitFor({ state: 'visible', timeout: 10_000 });
	await assertCanvasEdgeVisible(page, 'README.md', note);
	await closeCanvasBadgeFace(readme);
	if (readWorkspaceFile('README.md') !== readmeBefore) {
		throw new Error('Downstream edits on README changed README itself instead of the downstream note');
	}
}
