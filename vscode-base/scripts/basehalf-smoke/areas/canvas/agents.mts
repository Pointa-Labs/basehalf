/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// What agents do on the canvas: a card they create, a connection they write, and the selection they can see.

import fs from 'fs';
import path from 'path';
import { agentNoteWithUpstream, canvasBadgeUpstreamRows, closeCanvasBadgeFace, openCanvasBadgeFace } from './badges.mts';
import { frameCanvasCardsForConnection } from './connections.mts';
import { centerCanvasCards } from './creation.mts';
import { root, smokeHome, workspacePath } from '../../context.mts';
import { gitStatusOfWorkspace } from '../../fixture.mts';
import { assertCanvasEdgeVisible, waitForCanvasCardSelection, waitForCanvasNoteInlineEditor, zoomCanvas } from '../../lib/canvas.mts';
import { assertCardDetail, closeCardDetailIfOpen } from '../../lib/cardDetail.mts';
import { activeMarkdownRichFrame } from '../../lib/markdownRich.mts';
import { quickOpen, runCommand } from '../../lib/quickInput.mts';
import { waitUntil } from '../../lib/steps.mts';
import { openExplorerRow, readWorkspaceFile } from '../../lib/workspace.mts';

export const AGENT_CREATED_CARD_PATH = 'agent-angle.md';
export const AGENT_CREATED_CARD_CONTENT = [
	'# Agent angle',
	'',
	'Created externally as another context-consuming document.',
	''
].join('\n');

// The selection agents can see: what the user selected is recorded in
// .bh/cache/selection.yaml while the current skill is installed, the status
// bar under the Agent Area shows it, and nothing reaches git.
export async function assertAgentSeesSelection(page) {
	await closeCardDetailIfOpen(page);
	const recordPath = path.join(workspacePath, '.bh', 'cache', 'selection.yaml');
	const skillPath = path.join(smokeHome, '.claude', 'skills', 'basehalf', 'SKILL.md');
	const header = '# What the user selected last in BaseHalf. BaseHalf rewrites this file; see the basehalf skill.\n';
	const readRecord = () => {
		try {
			return fs.readFileSync(recordPath, 'utf8');
		} catch {
			return undefined;
		}
	};
	const statusText = () => page.evaluate(() => document.querySelector('.basehalf-agent-selection-text')?.textContent ?? null);
	const expectSelection = async (record, shown, what) => {
		await waitUntil(() => readRecord() === record, what, 10_000).catch(error => {
			throw new Error(`${what}: the record is ${JSON.stringify(readRecord())}`, { cause: error });
		});
		await page.waitForFunction(text => (document.querySelector('.basehalf-agent-selection-text')?.textContent ?? null) === text, shown, { timeout: 10_000 }).catch(async error => {
			throw new Error(`${what}: the status bar shows ${JSON.stringify(await statusText())}`, { cause: error });
		});
	};
	const pane = page.locator('.react-flow__pane');
	const readme = page.locator('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
	const src = page.locator('.basehalf-canvas-card[data-basehalf-card-path="src"]');

	// Without the skill there is no record and nothing in the status bar.
	await pane.click({ position: { x: 16, y: 16 } });
	await page.waitForTimeout(500);
	if (readRecord() !== undefined || await statusText() !== null) {
		throw new Error(`Without the skill, nothing may be recorded or shown: ${JSON.stringify({ record: readRecord(), shown: await statusText() })}`);
	}

	await runCommand(page, 'BaseHalf: Install Agent Skill');
	await waitUntil(() => fs.existsSync(skillPath), 'the skill in the window\'s home folder', 10_000);
	await zoomCanvas(page, 'reset');
	await readme.waitFor({ state: 'visible', timeout: 20_000 });
	await src.waitFor({ state: 'visible', timeout: 20_000 });
	await centerCanvasCards(page, [readme, src]);
	await pane.click({ position: { x: 16, y: 16 } });
	await expectSelection(`${header}selected: "folder"\npath: "."\n`, path.basename(workspacePath), 'nothing selected records the folder of the canvas');

	// The entry is in the status bar and has no command. With the Agent Area
	// hidden it is as wide as its text; with the Agent Area shown it starts
	// under the Agent Area's left edge.
	const measureEntry = () => page.evaluate(() => {
		const content = document.querySelector('.basehalf-agent-selection');
		const item = content?.parentElement;
		const statusbar = document.querySelector('.part.statusbar');
		const agentArea = document.querySelector('.part.auxiliarybar');
		const label = item?.querySelector('.statusbar-item-label');
		const text = document.querySelector('.basehalf-agent-selection-text')?.getBoundingClientRect();
		return {
			inStatusbar: !!item && !!statusbar?.contains(item),
			left: item?.getBoundingClientRect().left,
			width: item?.getBoundingClientRect().width,
			textWidth: text?.width,
			agentAreaLeft: agentArea instanceof HTMLElement && agentArea.offsetParent !== null ? agentArea.getBoundingClientRect().left : undefined,
			labelShown: label instanceof HTMLElement && getComputedStyle(label).display !== 'none',
			cursor: content ? getComputedStyle(content).cursor : undefined
		};
	});
	const agentArea = page.locator('.part.auxiliarybar');
	const agentAreaWasShown = await agentArea.isVisible();
	if (agentAreaWasShown) {
		await runCommand(page, 'Toggle Agent Area');
		await agentArea.waitFor({ state: 'hidden', timeout: 10_000 });
	}
	await page.waitForTimeout(300);
	const alone = await measureEntry();
	await runCommand(page, 'Toggle Agent Area');
	await agentArea.waitFor({ state: 'visible', timeout: 10_000 });
	await page.waitForTimeout(500);
	const underAgentArea = await measureEntry();
	if (!agentAreaWasShown) {
		await runCommand(page, 'Toggle Agent Area');
		await agentArea.waitFor({ state: 'hidden', timeout: 10_000 });
	}
	// Under the Agent Area the entry is as wide as its text and takes at most
	// 60% of the room there, from its right end.
	const room = underAgentArea.agentAreaLeft === undefined ? 0 : underAgentArea.left + underAgentArea.width - (underAgentArea.agentAreaLeft + 8);
	if (!alone.inStatusbar || alone.labelShown || alone.cursor !== 'default' || !(alone.textWidth > 20) || alone.width > 241
		|| !underAgentArea.inStatusbar || underAgentArea.agentAreaLeft === undefined || !(underAgentArea.textWidth > 20)
		|| underAgentArea.width > room * 0.6 + 1 || underAgentArea.left < underAgentArea.agentAreaLeft + 8) {
		throw new Error(`The entry must be in the status bar with no command, show its text, and stay in the right part of the room under the Agent Area: ${JSON.stringify({ alone, underAgentArea, room })}`);
	}

	await readme.click();
	await waitForCanvasCardSelection(page, 'README.md');
	await expectSelection(`${header}selected: "card"\npath: "README.md"\n`, 'README', 'one selected card is recorded by its path and shown by its name');

	// Earlier steps can leave README.md over part of another card: press src
	// where it is on top, away from its name, which selects nothing.
	const srcPoint = await src.evaluate(card => {
		const box = card.getBoundingClientRect();
		for (let y = box.top + 4; y < box.bottom - 4; y += 6) {
			for (let x = box.left + 4; x < box.right - 4; x += 6) {
				const hit = document.elementFromPoint(x, y);
				if (hit && card.contains(hit) && !hit.closest('.basehalf-canvas-card-caption')) {
					return { x, y };
				}
			}
		}
		return undefined;
	});
	if (!srcPoint) {
		throw new Error('No part of the src card is on top');
	}
	await page.keyboard.down('Shift');
	await page.mouse.click(srcPoint.x, srcPoint.y);
	await page.keyboard.up('Shift');
	await expectSelection(`${header}selected: "cards"\npaths:\n  - "src"\n  - "README.md"\n`, '2 cards selected', 'two selected cards are recorded in list order and shown by their number');

	await pane.click({ position: { x: 16, y: 16 } });
	await expectSelection(`${header}selected: "folder"\npath: "."\n`, path.basename(workspacePath), 'a click on empty canvas records the folder again');

	// Text selected in the note on its card: the lines it is on, and its text as the note shows it.
	await readme.locator('.bh-md-preview p', { hasText: 'soft-line-beta' }).first().dblclick();
	const editor = await waitForCanvasNoteInlineEditor(page, 'README.md');
	const ends = await editor.editable.evaluate(root => {
		const pointOf = (token, atEnd) => {
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
			let node;
			while ((node = walker.nextNode())) {
				const offset = node.textContent?.indexOf(token) ?? -1;
				if (offset >= 0) {
					const range = document.createRange();
					range.setStart(node, offset + (atEnd ? token.length : 0));
					range.collapse(true);
					const box = range.getClientRects()[0] ?? range.getBoundingClientRect();
					return { x: box.left + (atEnd ? 1 : -1), y: box.top + box.height / 2 };
				}
			}
			throw new Error(`No text ${token} in the note editor`);
		};
		return { from: pointOf('soft-line-beta', false), to: pointOf('soft-line-gamma', true) };
	});
	await page.mouse.move(ends.from.x + 1, ends.from.y);
	await page.mouse.down();
	await page.mouse.move(ends.to.x, ends.to.y, { steps: 8 });
	await page.mouse.up();
	const textRecord = `${header}selected: "text"\npath: "README.md"\nfirst_line: 4\nlast_line: 5\ntext: "soft-line-beta\\nsoft-line-gamma"\n`;
	await expectSelection(textRecord, 'soft-line-beta soft-line-gamma', 'selected text is recorded with its lines and shown by its start');

	// Focus elsewhere in the window keeps the record, and the note keeps showing the selection.
	// As when the user clicks into the Agent Area to ask an agent: its
	// terminal, or else the sidebar's list, takes focus. Neither opens anything.
	const movedTo = await page.evaluate(() => {
		const target = document.querySelector('.part.auxiliarybar .xterm-helper-textarea') ?? document.querySelector('.part.sidebar .monaco-list');
		if (!(target instanceof HTMLElement)) {
			return undefined;
		}
		target.focus();
		return target.className;
	});
	if (!movedTo) {
		throw new Error('Nothing outside the note could take focus');
	}
	await page.waitForTimeout(600);
	const kept = await editor.editable.evaluate(root => ({
		focused: root.contains(document.activeElement),
		highlighted: Array.from(root.querySelectorAll('.basehalf-canvas-markdown-inline-inactive-selection')).map(element => element.textContent).join('|')
	}));
	if (readRecord() !== textRecord || kept.focused || !kept.highlighted.includes('soft-line-beta') || !kept.highlighted.includes('soft-line-gamma')) {
		throw new Error(`Focus elsewhere must keep the record and the highlight: ${JSON.stringify({ record: readRecord(), ...kept })}`);
	}

	// An agent writes the note while the user is elsewhere: the selection
	// follows its text, keeps its highlight, and the record its new lines.
	const readmePath = path.join(workspacePath, 'README.md');
	const readmeBefore = fs.readFileSync(readmePath, 'utf8');
	if (!readmeBefore.startsWith('# Smoke README\n\n')) {
		throw new Error('The README fixture changed; this step writes above its first paragraph');
	}
	fs.writeFileSync(readmePath, readmeBefore.replace('# Smoke README\n\n', '# Smoke README\n\nAdded by an agent.\n\n'), 'utf8');
	const movedRecord = `${header}selected: "text"\npath: "README.md"\nfirst_line: 6\nlast_line: 7\ntext: "soft-line-beta\\nsoft-line-gamma"\n`;
	await expectSelection(movedRecord, 'soft-line-beta soft-line-gamma', 'the selection follows a write made elsewhere to lines 6 and 7');
	const afterWrite = await editor.editable.evaluate(root => ({
		focused: root.contains(document.activeElement),
		highlighted: Array.from(root.querySelectorAll('.basehalf-canvas-markdown-inline-inactive-selection')).map(element => element.textContent).join('|')
	}));
	if (afterWrite.focused || !afterWrite.highlighted.includes('soft-line-beta') || !afterWrite.highlighted.includes('soft-line-gamma')) {
		throw new Error(`After a write made elsewhere the note must still show the selection: ${JSON.stringify(afterWrite)}`);
	}
	fs.writeFileSync(readmePath, readmeBefore, 'utf8');
	await expectSelection(textRecord, 'soft-line-beta soft-line-gamma', 'the selection follows the note back to lines 4 and 5');

	// Escape ends the editing and leaves the card selected. Focus returns to
	// the note without a click, so the text is still selected when Escape comes.
	await editor.editable.evaluate(root => (root as HTMLElement).focus());
	await page.keyboard.press('Escape');
	await editor.host.waitFor({ state: 'detached', timeout: 15_000 });
	await expectSelection(`${header}selected: "card"\npath: "README.md"\n`, 'README', 'the card stays recorded after editing ends');

	// Card Detail's rich projection: selected text is recorded with its line,
	// stays drawn in grey while focus is elsewhere, and a press on the page
	// around the document, where no caret goes, ends the selection.
	await quickOpen(page, 'README.md');
	await assertCardDetail(page, 'README.md');
	await expectSelection(`${header}selected: "card"\npath: "README.md"\n`, 'README', 'Card Detail records its card');
	const frame = await activeMarkdownRichFrame(page);
	const frameBox = await (await frame.frameElement()).boundingBox();
	const word = await frame.evaluate(() => {
		const walker = document.createTreeWalker(document.querySelector('.ProseMirror') ?? document.body, NodeFilter.SHOW_TEXT);
		let node;
		while ((node = walker.nextNode())) {
			const offset = node.textContent?.indexOf('soft-line-beta') ?? -1;
			if (offset >= 0) {
				const range = document.createRange();
				range.setStart(node, offset);
				range.setEnd(node, offset + 'soft-line-beta'.length);
				const box = range.getBoundingClientRect();
				const scroll = document.querySelector('.basehalf-markdown-rich-scroll')?.getBoundingClientRect();
				const page = document.querySelector('.basehalf-markdown-rich-page')?.getBoundingClientRect();
				return { left: box.left, right: box.right, y: box.top + box.height / 2, blankX: scroll && page ? (scroll.left + page.left) / 2 : 4 };
			}
		}
		throw new Error('No soft-line-beta in Card Detail');
	});
	if (!frameBox) {
		throw new Error('Card Detail has no frame box');
	}
	await page.mouse.move(frameBox.x + word.left + 1, frameBox.y + word.y);
	await page.mouse.down();
	await page.mouse.move(frameBox.x + word.right - 1, frameBox.y + word.y, { steps: 6 });
	await page.mouse.up();
	await expectSelection(`${header}selected: "text"\npath: "README.md"\nfirst_line: 4\nlast_line: 4\ntext: "soft-line-beta"\n`, 'soft-line-beta', 'text selected in Card Detail is recorded with its line');
	const selectionStyle = () => frame.evaluate(() => {
		const paragraph = Array.from(document.querySelectorAll('.ProseMirror p')).find(element => element.textContent?.includes('soft-line-beta'));
		return {
			focused: document.querySelector('.ProseMirror')?.classList.contains('ProseMirror-focused'),
			background: paragraph ? getComputedStyle(paragraph, '::selection').backgroundColor : undefined
		};
	});
	const focusedSelection = await selectionStyle();
	await page.evaluate(() => {
		const elsewhere = document.querySelector('.part.auxiliarybar .xterm-helper-textarea') ?? document.querySelector('.part.sidebar .monaco-list');
		(elsewhere as HTMLElement | null)?.focus();
	});
	const unfocusedSelection = await selectionStyle();
	if (!focusedSelection.focused || unfocusedSelection.focused || !unfocusedSelection.background
		|| unfocusedSelection.background === focusedSelection.background || /^rgba\(0, 0, 0, 0\)$|^transparent$/.test(unfocusedSelection.background)) {
		throw new Error(`Card Detail must draw its selection in grey while focus is elsewhere: ${JSON.stringify({ focusedSelection, unfocusedSelection })}`);
	}
	await page.mouse.click(frameBox.x + word.blankX, frameBox.y + word.y);
	await expectSelection(`${header}selected: "card"\npath: "README.md"\n`, 'README', 'a press on the page around the document ends the selection');
	await closeCardDetailIfOpen(page);

	if (/\.bh\/cache/.test(gitStatusOfWorkspace())) {
		throw new Error(`The record must stay out of git: ${gitStatusOfWorkspace()}`);
	}

	// Without the skill the record and the entry go.
	await runCommand(page, 'BaseHalf: Remove Agent Skill');
	await waitUntil(() => readRecord() === undefined, 'the record to go with the skill', 10_000);
	await page.waitForFunction(() => document.querySelector('.basehalf-agent-selection-text') === null, null, { timeout: 10_000 });
	await pane.click({ position: { x: 16, y: 16 } });
}

// An AGENT creates a user file with its own tools. BaseHalf observes the real
// file and projects it as a card without requiring a canvas.yaml geometry row.
export async function assertAgentCreatesCard(page) {
	fs.writeFileSync(path.join(workspacePath, AGENT_CREATED_CARD_PATH), AGENT_CREATED_CARD_CONTENT, 'utf8');

	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${AGENT_CREATED_CARD_PATH}"]`)
		.waitFor({ state: 'visible', timeout: 10_000 });
}

// An AGENT edits the note's `upstream` list as ordinary text (D37). The index
// picks up the saved file: a new entry draws its edge, and an entry that names
// nothing is one dangling issue on the card and an inline row in its badge
// editor, where Remove repairs it by explicit action. An open Card Detail
// refreshes its collapsed summary in place, keeping keyboard focus.
export async function assertAgentUpstreamEditDrawsEdge(page) {
	const note = AGENT_CREATED_CARD_PATH;
	const notePath = path.join(workspacePath, note);
	const noteCard = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${note}"]`);
	const readme = page.locator('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
	const docs = page.locator('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
	await frameCanvasCardsForConnection(page, [readme, docs, noteCard]);
	fs.writeFileSync(notePath, agentNoteWithUpstream(['docs', 'README.md', 'missing-source.md']), 'utf8');
	await assertCanvasEdgeVisible(page, 'README.md', note);
	await assertCanvasEdgeVisible(page, 'docs', note);
	const issueMarker = noteCard.locator('.basehalf-canvas-card-badge-dot.issue[data-testid="card-reference-issue-marker"]:visible');
	await issueMarker.waitFor({ state: 'visible', timeout: 10_000 });
	if (await issueMarker.getAttribute('data-reference-issue-count') !== '1') {
		throw new Error('The dangling upstream entry did not expose exactly one card-level issue');
	}

	await openCanvasBadgeFace(noteCard);
	await page.waitForFunction(path => {
		const rows = Array.from(document.querySelectorAll(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"] [data-testid="badge-upstream-row"]`));
		return rows.map(row => row.getAttribute('data-upstream-status')).join(',') === 'valid,valid,dangling';
	}, note, { timeout: 10_000 });
	const rows = await canvasBadgeUpstreamRows(noteCard);
	if (JSON.stringify(rows) !== JSON.stringify(['valid:docs', 'valid:README.md', 'dangling:missing-source.md'])) {
		throw new Error(`The badge editor did not list the note's own upstream entries in file order: ${JSON.stringify(rows)}`);
	}
	await noteCard.locator('[data-testid="badge-downstream-empty"]', { hasText: 'Nothing draws on this card yet.' }).waitFor({ state: 'visible', timeout: 10_000 });
	await noteCard.locator('[data-testid="badge-upstream-row"][data-upstream-status="dangling"] [data-testid="badge-upstream-remove"]').click();
	await waitUntil(() => readWorkspaceFile(note) === agentNoteWithUpstream(['docs', 'README.md']), 'Remove to delete only the dangling entry from the note');
	await issueMarker.waitFor({ state: 'detached', timeout: 10_000 });
	await closeCanvasBadgeFace(noteCard);

	// Both sides of a merge added the list: BaseHalf cannot read it. The badge
	// states that in plain words and offers Rebuild List, which keeps every
	// connection after the user confirms. Nothing sends the user to the file.
	fs.writeFileSync(notePath, `---\nupstream:\n  - docs\nupstream:\n  - README.md\n---\n${AGENT_CREATED_CARD_CONTENT}`, 'utf8');
	await issueMarker.waitFor({ state: 'visible', timeout: 10_000 });
	await openCanvasBadgeFace(noteCard);
	const storeIssue = noteCard.locator('[data-testid="badge-upstream"] .basehalf-canvas-card-badge-issue-row[data-upstream-issue="store"]');
	await storeIssue.waitFor({ state: 'visible', timeout: 10_000 });
	const storeIssueText = await storeIssue.locator('.basehalf-canvas-card-badge-issue-message').textContent();
	if (storeIssueText !== 'BaseHalf can\'t read this upstream list.') {
		throw new Error(`The unreadable upstream list is not stated in plain words: ${JSON.stringify(storeIssueText)}`);
	}
	const upstreamSectionText = await noteCard.locator('[data-testid="badge-upstream"]').textContent() ?? '';
	if (/Open File|frontmatter|YAML|`/.test(upstreamSectionText)) {
		throw new Error(`The Upstream section names code or offers to open the file: ${JSON.stringify(upstreamSectionText)}`);
	}
	await storeIssue.locator('[data-testid="badge-upstream-rebuild"]').click();
	const rebuildDialog = page.locator('.monaco-dialog-box', { hasText: 'Rebuild the upstream list of' }).first();
	await rebuildDialog.waitFor({ state: 'visible', timeout: 10_000 });
	await rebuildDialog.locator('.monaco-button', { hasText: /^Rebuild List$/ }).click();
	await rebuildDialog.waitFor({ state: 'hidden', timeout: 10_000 });
	await waitUntil(() => readWorkspaceFile(note) === agentNoteWithUpstream(['docs', 'README.md']), 'Rebuild List to write one list that keeps both connections');
	await issueMarker.waitFor({ state: 'detached', timeout: 10_000 });
	await closeCanvasBadgeFace(noteCard);
	await assertCanvasEdgeVisible(page, 'README.md', note);
	await assertCanvasEdgeVisible(page, 'docs', note);

	// The same edit reaches an open Card Detail through its live refresh: the
	// collapsed summary changes in place and focus stays on the toggle.
	await openExplorerRow(page, note);
	await assertCardDetail(page, note);
	const detailBadgeToggle = page.locator('[data-testid="card-detail-badge-toggle"]');
	await detailBadgeToggle.waitFor({ state: 'visible', timeout: 10_000 });
	const detailSummaryIs = expected => page.waitForFunction(text => {
		const toggle = document.querySelector('.basehalf-card-detail.visible [data-testid="card-detail-badge-toggle"]');
		return toggle?.getAttribute('aria-expanded') === 'false'
			&& toggle.querySelector('.basehalf-card-detail-badge-summary')?.textContent?.trim() === text
			&& toggle.getAttribute('data-reference-issue-count') === '0';
	}, expected, { timeout: 10_000 });
	await detailSummaryIs('↑2 upstream · ↓0 downstream');
	await detailBadgeToggle.focus();
	fs.writeFileSync(notePath, agentNoteWithUpstream(['docs']), 'utf8');
	await detailSummaryIs('↑1 upstream · ↓0 downstream');
	await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'card-detail-badge-toggle', null, { timeout: 10_000 });
	fs.writeFileSync(notePath, agentNoteWithUpstream(['docs', 'README.md']), 'utf8');
	await detailSummaryIs('↑2 upstream · ↓0 downstream');
	await closeCardDetailIfOpen(page);
	await assertCanvasEdgeVisible(page, 'README.md', note);
	await assertCanvasEdgeVisible(page, 'docs', note);
}
