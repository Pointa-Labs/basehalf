/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The rich Markdown editor in Card Detail: editing, saving, undo, menus, reading mode, composition, links, attachments, and edits from outside.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { assertPdfCardDetail } from './cardDetail.mts';
import { app, root, workspacePath } from '../../context.mts';
import { createMinimalPdfFixture } from '../../fixture.mts';
import { assertCardDetail, clickCommandCenterNavigationButton, closeCardDetailIfOpen } from '../../lib/cardDetail.mts';
import { activeMarkdownRichFrame, dispatchMarkdownRichComposition } from '../../lib/markdownRich.mts';
import { quickOpen } from '../../lib/quickInput.mts';
import { waitUntil } from '../../lib/steps.mts';

export async function assertMarkdownRichSaveStatusHidden(page) {
	const toolbarCount = await page.locator('.basehalf-card-detail-markdown-rich-toolbar').count();
	if (toolbarCount !== 0) {
		throw new Error(`Markdown rich status should not create a toolbar, toolbarCount=${toolbarCount}`);
	}
	const headerMetaText = await page.locator('.basehalf-card-detail-meta').textContent().catch(() => '');
	if (/\b(Saving|Saved)\b/.test(headerMetaText ?? '')) {
		throw new Error(`Markdown rich status should not live under the title: ${headerMetaText}`);
	}
	const oldRichStatusCount = await page.locator('.basehalf-card-detail-markdown-rich-status').count();
	if (oldRichStatusCount !== 0) {
		throw new Error(`Markdown rich status should not render inside the editor, oldRichStatusCount=${oldRichStatusCount}`);
	}

	const status = page.locator('.basehalf-card-detail-save-status').first();
	await status.waitFor({ state: 'attached', timeout: 10_000 });
	const geometry = await status.evaluate(element => {
		const rect = element.getBoundingClientRect();
		const style = getComputedStyle(element);
		return {
			saveState: element.getAttribute('data-save-state'),
			text: element.textContent?.trim(),
			ariaHidden: element.getAttribute('aria-hidden'),
			display: style.display,
			width: rect.width,
			height: rect.height
		};
	});
	if (geometry.display !== 'none' || geometry.width !== 0 || geometry.height !== 0) {
		throw new Error(`Markdown rich save status should be hidden: ${JSON.stringify(geometry)}`);
	}
	if (geometry.saveState !== null || geometry.text !== '' || geometry.ariaHidden !== 'true') {
		throw new Error(`Markdown rich save status should not expose ordinary save state: ${JSON.stringify(geometry)}`);
	}
}

export async function assertMarkdownRichBlockquoteEditable(page) {
	const frame = await activeMarkdownRichFrame(page);
	const quote = frame.locator('.bn-block-content[data-content-type="quote"]', { hasText: 'Smoke editable quote' }).first();
	await quote.waitFor({ state: 'visible', timeout: 20_000 });
	const rawQuoteCount = await frame.locator('.basehalf-raw-passthrough', { hasText: 'Smoke editable quote' }).count();
	if (rawQuoteCount !== 0) {
		throw new Error(`Markdown blockquote should be an editable BlockNote quote block, got ${rawQuoteCount} raw passthrough block(s)`);
	}
}

export async function assertMarkdownRichBlockMenuPortal(page) {
	const frame = await activeMarkdownRichFrame(page);
	const content = frame.locator('.bn-block-content', { hasText: 'nested-menu-anchor continuation' }).first();
	await content.waitFor({ state: 'visible', timeout: 20_000 });
	await content.hover({ position: { x: 8, y: 8 } });

	const sideMenu = frame.locator('.basehalf-markdown-rich-portal .bn-side-menu').first();
	await sideMenu.waitFor({ state: 'visible', timeout: 10_000 });

	const geometry = await frame.evaluate(() => {
		const menu = document.querySelector<HTMLElement>('.basehalf-markdown-rich-portal .bn-side-menu');
		const portal = document.querySelector<HTMLElement>('.basehalf-markdown-rich-portal');
		const content = Array.from(document.querySelectorAll<HTMLElement>('.bn-block-content'))
			.find(element => element.textContent?.includes('nested-menu-anchor continuation')) ?? null;
		const rootGroup = document.querySelector<HTMLElement>('.bn-editor > .bn-block-group');
		const rect = (element: HTMLElement | null) => {
			if (!element) {
				return undefined;
			}
			const bounds = element.getBoundingClientRect();
			return {
				left: bounds.left,
				right: bounds.right,
				width: bounds.width
			};
		};
		return {
			menu: rect(menu),
			portal: rect(portal),
			content: rect(content),
			rootGroup: rect(rootGroup)
		};
	});

	if (!geometry.menu || !geometry.portal || !geometry.content || !geometry.rootGroup) {
		throw new Error(`Markdown rich block menu portal geometry missing: ${JSON.stringify(geometry)}`);
	}

	const tolerance = 1;
	const guideGap = 6;
	if (geometry.menu.right < geometry.portal.left - tolerance || geometry.menu.left > geometry.content.left + tolerance) {
		throw new Error(`Markdown rich block menu is not anchored in the left block gutter: ${JSON.stringify(geometry)}`);
	}
	if (geometry.content.left <= geometry.rootGroup.left + 8) {
		throw new Error(`Markdown rich smoke fixture did not create a nested continuation block: ${JSON.stringify(geometry)}`);
	}
	if (geometry.menu.right > geometry.rootGroup.left - guideGap + tolerance) {
		throw new Error(`Markdown rich nested block menu should leave a gap before the root indent guide: ${JSON.stringify(geometry)}`);
	}
}

export async function assertMarkdownRichSlashMenuThemedPortal(page) {
	const frame = await activeMarkdownRichFrame(page);
	const editable = frame.locator('.bn-editor [contenteditable="true"], .bn-editor[contenteditable="true"], .ProseMirror[contenteditable="true"]').first();
	await editable.waitFor({ state: 'visible', timeout: 20_000 });
	await editable.click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
	await page.keyboard.press('Enter');
	await page.keyboard.insertText('/');

	const slashMenu = frame.locator('.basehalf-markdown-rich-portal .bn-suggestion-menu').first();
	await slashMenu.waitFor({ state: 'visible', timeout: 10_000 });

	const diagnostic = await frame.evaluate(() => {
		const menu = document.querySelector<HTMLElement>('.basehalf-markdown-rich-portal .bn-suggestion-menu');
		const portal = document.querySelector<HTMLElement>('.basehalf-markdown-rich-portal');
		const firstItem = document.querySelector<HTMLElement>('.basehalf-markdown-rich-portal .bn-suggestion-menu-item');
		const rect = menu?.getBoundingClientRect();
		const probe = rect ? document.elementFromPoint(rect.left + 12, rect.top + 12) as HTMLElement | null : null;
		const menuStyle = menu ? getComputedStyle(menu) : undefined;
		const itemStyle = firstItem ? getComputedStyle(firstItem) : undefined;
		return {
			portalClass: portal?.className ?? '',
			portalColorScheme: portal?.getAttribute('data-color-scheme') ?? '',
			portalMantineColorScheme: portal?.getAttribute('data-mantine-color-scheme') ?? '',
			menuText: menu?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
			menuBackground: menuStyle?.backgroundColor ?? '',
			menuColor: menuStyle?.color ?? '',
			menuBoxShadow: menuStyle?.boxShadow ?? '',
			itemHeight: itemStyle?.height ?? '',
			probeInsideMenu: !!probe?.closest('.bn-suggestion-menu')
		};
	});

	await page.keyboard.press('Escape');
	await page.keyboard.press('Backspace');

	if (!diagnostic.portalClass.includes('bn-root') || !diagnostic.portalClass.includes('bn-mantine')) {
		throw new Error(`Markdown rich slash menu portal is outside the BlockNote/Mantine theme scope: ${JSON.stringify(diagnostic)}`);
	}
	if (diagnostic.portalColorScheme !== 'dark' || diagnostic.portalMantineColorScheme !== 'dark') {
		throw new Error(`Markdown rich slash menu portal did not inherit the dark theme: ${JSON.stringify(diagnostic)}`);
	}
	if (!diagnostic.menuText.includes('Heading 1') || !diagnostic.menuText.includes('Paragraph')) {
		throw new Error(`Markdown rich slash menu items are missing: ${JSON.stringify(diagnostic)}`);
	}
	if (isTransparentCssColor(diagnostic.menuBackground) || isTransparentCssColor(diagnostic.menuColor) || diagnostic.menuBoxShadow === 'none') {
		throw new Error(`Markdown rich slash menu is mounted but unthemed: ${JSON.stringify(diagnostic)}`);
	}
	if (!diagnostic.probeInsideMenu) {
		throw new Error(`Markdown rich slash menu is not the top interactive surface: ${JSON.stringify(diagnostic)}`);
	}
}

export async function assertMarkdownRichReadingModeDisabled(page) {
	const frame = await activeMarkdownRichFrame(page);
	const checkboxCount = await frame.locator('.basehalf-adhd-check').count();
	const keywordCount = await frame.locator('.basehalf-adhd-keyword').count();
	if (checkboxCount !== 0 || keywordCount !== 0) {
		throw new Error(`ADHD reading aids should be disabled by default, checkboxCount=${checkboxCount}, keywordCount=${keywordCount}`);
	}

	const content = frame.locator('.bn-block-content', { hasText: 'Smoke README' }).first();
	await content.waitFor({ state: 'visible', timeout: 20_000 });
	await openMarkdownRichContextMenuForText(frame, 'README');
	const menuText = await frame.locator('.basehalf-markdown-rich-context-menu').first().textContent({ timeout: 5_000 });
	await page.keyboard.press('Escape');
	if (menuText?.includes('Highlight')) {
		throw new Error(`ADHD highlight context item should be hidden while reading mode is off: ${menuText}`);
	}
}

export async function assertMarkdownRichReadingModeEnabledFromWorkspaceSettings(page) {
	const vscodeDir = path.join(workspacePath, '.vscode');
	fs.mkdirSync(vscodeDir, { recursive: true });
	fs.writeFileSync(path.join(vscodeDir, 'settings.json'), JSON.stringify({
		'basehalf.editor.readingMode': true
	}, null, 2), 'utf8');

	const frame = await activeMarkdownRichFrame(page);
	await frame.locator('.basehalf-adhd-check').first().waitFor({ state: 'visible', timeout: 20_000 });
	await frame.locator('.basehalf-adhd-keyword', { hasText: 'Smoke' }).first().waitFor({ state: 'visible', timeout: 20_000 });
	const readStateAppearance = await frame.evaluate(() => {
		const checked = document.querySelector('.basehalf-adhd-check-checked');
		const unchecked = document.querySelector('.basehalf-adhd-check:not(.basehalf-adhd-check-checked)');
		const read = document.querySelector('.basehalf-adhd-read');
		const unread = document.querySelector('.basehalf-adhd-unread');
		if (!(checked instanceof HTMLElement) || !(unchecked instanceof HTMLElement) || !(read instanceof HTMLElement) || !(unread instanceof HTMLElement)) {
			return undefined;
		}
		const checkmarkStyle = getComputedStyle(checked, '::after');
		return {
			checkedBackground: getComputedStyle(checked).backgroundColor,
			uncheckedBackground: getComputedStyle(unchecked).backgroundColor,
			checkmarkOpacity: checkmarkStyle.opacity,
			checkmarkBorderRightWidth: checkmarkStyle.borderRightWidth,
			checkmarkBorderBottomWidth: checkmarkStyle.borderBottomWidth,
			checkboxTabIndex: checked.tabIndex,
			checkboxAriaLabel: checked.getAttribute('aria-label'),
			readColor: getComputedStyle(read).color,
			unreadColor: getComputedStyle(unread).color,
		};
	});
	if (!readStateAppearance
		|| readStateAppearance.checkedBackground === readStateAppearance.uncheckedBackground
		|| readStateAppearance.readColor === readStateAppearance.unreadColor
		|| readStateAppearance.checkmarkOpacity === '0'
		|| readStateAppearance.checkmarkBorderRightWidth === '0px'
		|| readStateAppearance.checkmarkBorderBottomWidth === '0px'
		|| readStateAppearance.checkboxTabIndex !== 0
		|| !readStateAppearance.checkboxAriaLabel) {
		throw new Error(`ADHD read and unread states should have distinct checkbox and prose styles: ${JSON.stringify(readStateAppearance)}`);
	}

	const content = frame.locator('.bn-block-content', { hasText: 'Smoke README' }).first();
	await content.waitFor({ state: 'visible', timeout: 20_000 });
	await openMarkdownRichContextMenuForText(frame, 'README');
	const menuText = await frame.locator('.basehalf-markdown-rich-context-menu').first().textContent({ timeout: 5_000 });
	await page.keyboard.press('Escape');
	if (!menuText?.includes('Highlight') && !menuText?.includes('Remove')) {
		throw new Error(`ADHD highlight context item should be available while reading mode is on: ${menuText}`);
	}
}

async function openMarkdownRichContextMenuForText(frame, text: string) {
	const opened = await frame.evaluate((needle: string) => {
		const root = document.querySelector<HTMLElement>('.bn-editor');
		const prosemirror = document.querySelector<HTMLElement>('.ProseMirror[contenteditable="true"], [contenteditable="true"].ProseMirror, .bn-editor [contenteditable="true"]');
		if (!root || !prosemirror) {
			return { ok: false, reason: 'missing editor root' };
		}

		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let node: Text | null = null;
		let start = -1;
		while (walker.nextNode()) {
			const current = walker.currentNode as Text;
			start = current.data.indexOf(needle);
			if (start >= 0) {
				node = current;
				break;
			}
		}
		if (!node) {
			return { ok: false, reason: 'text not found' };
		}

		const range = document.createRange();
		range.setStart(node, start);
		range.setEnd(node, start + needle.length);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);

		const rect = range.getBoundingClientRect();
		const x = Number.isFinite(rect.left) && rect.left > 0 ? rect.left + Math.min(12, Math.max(1, rect.width / 2)) : 120;
		const y = Number.isFinite(rect.top) && rect.top > 0 ? rect.top + Math.min(12, Math.max(1, rect.height / 2)) : 120;
		const target = node.parentElement ?? prosemirror;
		target.dispatchEvent(new MouseEvent('contextmenu', {
			bubbles: true,
			cancelable: true,
			clientX: x,
			clientY: y,
			button: 2
		}));
		return { ok: true };
	}, text);

	if (!opened.ok) {
		throw new Error(`Could not open Markdown rich context menu: ${JSON.stringify(opened)}`);
	}
}

export async function assertMarkdownRichEditorEditsAndSaves(page) {
	const marker = `rich editor smoke ${Date.now()}`;
	const readmePath = path.join(workspacePath, 'README.md');
	const frame = await activeMarkdownRichFrame(page);
	const editable = frame.locator('.bn-editor [contenteditable="true"], .bn-editor[contenteditable="true"], .ProseMirror[contenteditable="true"]').first();
	await editable.waitFor({ state: 'visible', timeout: 20_000 });
	await editable.click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
	await page.keyboard.press('Enter');
	await page.keyboard.insertText(marker);

	await waitUntil(() => fs.readFileSync(readmePath, 'utf8').includes(marker), 'rich Markdown editor to persist edits', 15_000);
}

function markdownRichUndoRedoKey(kind) {
	const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
	return kind === 'undo' ? `${modifier}+z` : `${modifier}+Shift+z`;
}

async function markdownRichEditorHasText(frame, needle) {
	return (await frame.locator('.bn-editor', { hasText: needle }).count()) > 0;
}

async function typeMarkdownRichMarker(page, frame, marker) {
	const readmePath = path.join(workspacePath, 'README.md');
	const editable = frame.locator('.bn-editor [contenteditable="true"], .bn-editor[contenteditable="true"], .ProseMirror[contenteditable="true"]').first();
	await editable.waitFor({ state: 'visible', timeout: 20_000 });
	await editable.click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
	await page.keyboard.press('Enter');
	await page.keyboard.insertText(marker);
	await waitUntil(() => fs.readFileSync(readmePath, 'utf8').includes(marker), `rich editor to persist "${marker}"`, 15_000);
}

async function pressMarkdownRichKeyOnce(page, key, predicate, description) {
	await page.keyboard.press(key);
	await page.waitForTimeout(250);
	if (await predicate()) {
		return;
	}
	throw new Error(`A single ${key} did not ${description}`);
}

export async function assertMarkdownRichUndoRedoRoundtrip(page) {
	const marker = `undo smoke ${Date.now()}`;
	const readmePath = path.join(workspacePath, 'README.md');
	const frame = await activeMarkdownRichFrame(page);
	await typeMarkdownRichMarker(page, frame, marker);

	await pressMarkdownRichKeyOnce(
		page,
		markdownRichUndoRedoKey('undo'),
		async () => !(await markdownRichEditorHasText(frame, marker)),
		`undo to remove "${marker}" from the rich editor`
	);
	await waitUntil(() => !fs.readFileSync(readmePath, 'utf8').includes(marker), 'undo to persist the marker removal', 15_000);

	await pressMarkdownRichKeyOnce(
		page,
		markdownRichUndoRedoKey('redo'),
		() => markdownRichEditorHasText(frame, marker),
		`redo to restore "${marker}" in the rich editor`
	);
	await waitUntil(() => fs.readFileSync(readmePath, 'utf8').includes(marker), 'redo to persist the restored marker', 15_000);
}

export async function assertMarkdownRichUndoStopsAtLoad(page) {
	const readmePath = path.join(workspacePath, 'README.md');
	const frame = await activeMarkdownRichFrame(page);
	const editable = frame.locator('.bn-editor [contenteditable="true"], .bn-editor[contenteditable="true"], .ProseMirror[contenteditable="true"]').first();
	await editable.click();

	for (let attempt = 0; attempt < 12; attempt++) {
		await page.keyboard.press(markdownRichUndoRedoKey('undo'));
		await page.waitForTimeout(80);
	}

	if (!(await markdownRichEditorHasText(frame, 'Smoke editable quote'))) {
		throw new Error('Undo walked past the document load and dropped baseline content');
	}

	// Let a pending autosave settle, then confirm the file kept its baseline content too.
	await page.waitForTimeout(1_800);
	if (!fs.readFileSync(readmePath, 'utf8').includes('Smoke editable quote')) {
		throw new Error('Undo past the document load blanked README.md on disk');
	}
}

export async function assertMarkdownRichExternalMergePreservesCursor(page) {
	const readmePath = path.join(workspacePath, 'README.md');
	const frame = await activeMarkdownRichFrame(page);
	const quote = frame.locator('.bn-block-content[data-content-type="quote"]', { hasText: 'Smoke editable quote' }).first();
	await quote.click();
	await page.keyboard.press('End');
	await page.keyboard.insertText(' MERGEMARK');
	await waitUntil(() => fs.readFileSync(readmePath, 'utf8').includes('MERGEMARK'), 'merge marker to persist', 15_000);

	const cursorBlock = () => frame.evaluate(() => {
		const anchor = document.getSelection()?.anchorNode;
		const element = anchor instanceof Element ? anchor : anchor?.parentElement;
		return element?.closest('[data-id]')?.getAttribute('data-id') ?? null;
	});
	const before = await cursorBlock();
	if (!before) {
		throw new Error('No cursor block before the external merge');
	}

	fs.writeFileSync(readmePath, fs.readFileSync(readmePath, 'utf8')
		.replace('External merge target paragraph.', 'External merge target paragraph (updated by agent).'), 'utf8');

	const deadline = Date.now() + 15_000;
	while (!(await markdownRichEditorHasText(frame, 'updated by agent'))) {
		if (Date.now() > deadline) {
			throw new Error('External change did not merge into the rich editor');
		}
		await page.waitForTimeout(150);
	}

	const after = await cursorBlock();
	if (after !== before) {
		throw new Error(`Cursor block changed across the external merge: ${before} -> ${after}`);
	}
	if (!(await markdownRichEditorHasText(frame, 'MERGEMARK'))) {
		throw new Error('Typed text was lost across the external merge');
	}

	// Undo must revert the user's own edit, never the external change.
	await pressMarkdownRichKeyOnce(
		page,
		markdownRichUndoRedoKey('undo'),
		async () => !(await markdownRichEditorHasText(frame, 'MERGEMARK')),
		'undo to remove the merge marker'
	);
	if (!(await markdownRichEditorHasText(frame, 'updated by agent'))) {
		throw new Error('Undo reverted the external change');
	}
	await waitUntil(() => !fs.readFileSync(readmePath, 'utf8').includes('MERGEMARK'), 'merge marker removal to persist', 15_000);
}

export async function assertMarkdownRichContextMenuClipboard(page) {
	const frame = await activeMarkdownRichFrame(page);
	const source = frame.locator('.bn-block-content', { hasText: 'Smoke editable quote' }).first();
	await source.click({ clickCount: 3 });
	await page.waitForTimeout(200);
	await source.click({ button: 'right' });
	const copyButton = frame.locator('.basehalf-markdown-rich-context-menu button', { hasText: /^Copy$/ });
	await copyButton.waitFor({ state: 'visible', timeout: 5_000 });
	await copyButton.click();
	await page.waitForTimeout(400);

	// Paste must be offered at a bare cursor and preserve rich formatting.
	const target = frame.locator('.bn-block-content', { hasText: 'External merge target paragraph' }).first();
	await target.click();
	await page.keyboard.press('End');
	await target.click({ button: 'right' });
	const pasteButton = frame.locator('.basehalf-markdown-rich-context-menu button', { hasText: /^Paste$/ });
	await pasteButton.waitFor({ state: 'visible', timeout: 5_000 });
	await pasteButton.click();

	const deadline = Date.now() + 15_000;
	while ((await frame.locator('.bn-block-content strong', { hasText: 'Smoke editable quote' }).count()) < 2) {
		if (Date.now() > deadline) {
			throw new Error('Context menu paste did not reproduce the copied rich formatting');
		}
		await page.waitForTimeout(150);
	}
}

export async function assertMarkdownRichCompositionDefersAutosave(page) {
	const marker = `imemark${Date.now()}`;
	const readmePath = path.join(workspacePath, 'README.md');
	const frame = await activeMarkdownRichFrame(page);
	const target = frame.locator('.bn-block-content', { hasText: 'External merge target paragraph' }).first();
	await target.click();
	await page.keyboard.press('End');

	await dispatchMarkdownRichComposition(frame, 'compositionstart');
	await page.keyboard.insertText(` ${marker}`);
	await page.waitForTimeout(2_500);
	if (fs.readFileSync(readmePath, 'utf8').includes(marker)) {
		throw new Error('Autosave serialized the document mid-composition');
	}

	await dispatchMarkdownRichComposition(frame, 'compositionend');
	await waitUntil(() => fs.readFileSync(readmePath, 'utf8').includes(marker), 'post-composition autosave to persist', 15_000);
}

export async function assertMarkdownRichCompositionQueuesSingleUndo(page) {
	const marker = `imeundosmoke${Date.now()}`;
	const readmePath = path.join(workspacePath, 'README.md');
	const frame = await activeMarkdownRichFrame(page);
	const target = frame.locator('.bn-block-content', { hasText: 'External merge target paragraph' }).first();
	await target.click();
	await page.keyboard.press('End');

	await dispatchMarkdownRichComposition(frame, 'compositionstart');
	await page.keyboard.insertText(` ${marker}`);
	await page.keyboard.press(markdownRichUndoRedoKey('undo'));
	if (!(await markdownRichEditorHasText(frame, marker))) {
		throw new Error('Undo ran before the active IME composition committed');
	}

	await dispatchMarkdownRichComposition(frame, 'compositionend');
	await page.waitForTimeout(250);
	if (await markdownRichEditorHasText(frame, marker)) {
		throw new Error('The single queued undo did not remove the committed IME edit');
	}
	await page.waitForTimeout(1_800);
	if (fs.readFileSync(readmePath, 'utf8').includes(marker)) {
		throw new Error('The IME edit removed by queued undo was later persisted');
	}
}

export async function assertMarkdownRichFileLinkAutocomplete(page) {
	const readmePath = path.join(workspacePath, 'README.md');
	const frame = await activeMarkdownRichFrame(page);
	const target = frame.locator('.bn-block-content', { hasText: 'External merge target paragraph' }).first();
	await target.click();
	await page.keyboard.press('End');
	await page.keyboard.type(' [[', { delay: 80 });

	const menu = frame.locator('.bn-suggestion-menu');
	await menu.waitFor({ state: 'visible', timeout: 8_000 });
	await page.keyboard.type('gui', { delay: 80 });
	await frame.locator('.bn-suggestion-menu-item', { hasText: 'guide.md' }).first().waitFor({ state: 'visible', timeout: 8_000 });
	await page.keyboard.press('Enter');

	const deadline = Date.now() + 15_000;
	while ((await frame.locator('.bn-block-content a', { hasText: 'guide.md' }).count()) === 0) {
		if (Date.now() > deadline) {
			throw new Error('File link autocomplete did not insert a link');
		}
		await page.waitForTimeout(150);
	}
	await waitUntil(
		() => fs.readFileSync(readmePath, 'utf8').split('](docs/guide.md)').length >= 3,
		'the picked file link to persist as relative Markdown',
		15_000
	);
}

export async function assertMarkdownRichFileAttachment(page) {
	const readmePath = path.join(workspacePath, 'README.md');
	const attachmentPath = path.join(workspacePath, 'attachments', 'handout.pdf');
	let frame = await activeMarkdownRichFrame(page);
	const target = frame.locator('.bn-block-content').last();
	await target.click();
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
	await page.keyboard.type('/file', { delay: 70 });
	const item = frame.locator('.bn-suggestion-menu-item', { hasText: 'File' }).first();
	await item.waitFor({ state: 'visible', timeout: 8_000 });
	await item.click();

	const addFile = frame.locator('.bn-add-file-button').last();
	await addFile.waitFor({ state: 'visible', timeout: 8_000 });
	await addFile.click();
	const input = frame.locator('.bn-file-input input[type="file"], input[type="file"]').last();
	await input.waitFor({ state: 'attached', timeout: 8_000 });
	await input.setInputFiles({
		name: 'handout.pdf',
		mimeType: 'application/pdf',
		buffer: createMinimalPdfFixture()
	});

	await waitUntil(() => fs.existsSync(attachmentPath), 'the inserted attachment to be written beside the document', 15_000);
	await waitUntil(
		() => fs.readFileSync(readmePath, 'utf8').includes('[handout.pdf](attachments/handout.pdf)'),
		'the inserted attachment to persist as a relative Markdown file link',
		15_000
	);

	// Close the live YJS projection and rebuild it from Markdown truth. A
	// standalone attachment link must come back as a first-class file block,
	// not regress into an ordinary blue paragraph link.
	await closeCardDetailIfOpen(page);
	await quickOpen(page, 'README.md');
	frame = await activeMarkdownRichFrame(page);
	const attachment = frame.locator('.bn-file-name-with-icon', { hasText: 'handout.pdf' }).last();
	await attachment.waitFor({ state: 'visible', timeout: 15_000 });
	await attachment.click();
	if (await frame.locator('[data-test="fileDownloadButton"]').count() > 0) {
		throw new Error('The stock BlockNote download action leaked into BaseHalf file semantics');
	}

	// Opening an attachment stays in the canvas/card-detail flow. Direct-render
	// binary media intentionally has no raw Source projection.
	await attachment.dblclick();
	await assertPdfCardDetail(page, 'handout.pdf');
	if (await page.locator('.basehalf-card-detail-projection[aria-label="Source"]').count() > 0) {
		throw new Error('A binary PDF exposed the raw Source projection');
	}

	// Return through the product's own history so this probe does not leave a
	// duplicate README entry in the surrounding navigation stack.
	await clickCommandCenterNavigationButton(page, 'arrow-left', 'Go Back');
	await assertCardDetail(page, 'README.md');
	frame = await activeMarkdownRichFrame(page);
	await frame.locator('.bn-file-name-with-icon', { hasText: 'handout.pdf' }).last().waitFor({ state: 'visible', timeout: 15_000 });
}

export async function assertMarkdownRichPassthroughEditInSource(page) {
	const frame = await activeMarkdownRichFrame(page);
	const island = frame.locator('.basehalf-raw-passthrough', { hasText: 'raw html island' }).first();
	await island.waitFor({ state: 'visible', timeout: 10_000 });
	// The block cannot be edited here, and it is shown rendered: its element, and not its tags as text.
	const islandShown = await island.evaluate(element => ({
		elements: Array.from(element.querySelectorAll('.basehalf-raw-passthrough-rendered *'), child => child.tagName.toLowerCase()).join(' '),
		text: element.querySelector('.basehalf-raw-passthrough-rendered')?.textContent?.trim()
	}));
	if (islandShown.elements !== 'div' || islandShown.text !== 'raw html island') {
		throw new Error(`A block the rich projection cannot edit must be shown rendered: ${JSON.stringify(islandShown)}`);
	}
	await island.hover();

	const edit = island.locator('.basehalf-raw-passthrough-edit');
	await edit.waitFor({ state: 'visible', timeout: 5_000 });
	await edit.click();

	// The card reopens in the source projection with the island's line selected.
	const sourceEditor = page.locator('.basehalf-card-detail-source-editor .monaco-editor');
	await sourceEditor.waitFor({ state: 'visible', timeout: 15_000 });
	// The whole block tile is selected; the cursor sits at the selection end,
	// which may include the tile's trailing blank line. Monaco marks the
	// cursor's line number as the active one.
	const islandLine = lineNumberForText('README.md', 'smoke-raw-island');
	await page.waitForFunction(({ first, last }) => {
		const active = document.querySelector('.basehalf-card-detail-source-editor .line-numbers.active-line-number');
		const line = Number(active?.textContent?.trim() ?? NaN);
		return line >= first && line <= last;
	}, { first: islandLine, last: islandLine + 1 }, { timeout: 15_000 });

	// Projection changes are view state, not location history. Return through
	// the in-card projection control so Back remains reserved for visited places.
	await page.locator('.basehalf-card-detail-projection[title="Rich"]').click();
	await activeMarkdownRichFrame(page);
}

export async function assertMarkdownRichMenuUndoRoutesToEditor(page) {
	if (process.platform !== 'darwin') {
		return;
	}

	const marker = `menu undo smoke ${Date.now()}`;
	const readmePath = path.join(workspacePath, 'README.md');
	const frame = await activeMarkdownRichFrame(page);
	await typeMarkdownRichMarker(page, frame, marker);

	const clickMenuUndo = () => app.evaluate(({ Menu, BrowserWindow }) => {
		const editMenu = Menu.getApplicationMenu()?.items.find(item => item.label === 'Edit');
		const undoItem = editMenu?.submenu?.items.find(item => item.label === 'Undo');
		if (!undoItem) {
			throw new Error('Edit > Undo menu item was not found');
		}
		const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
		// Programmatic MenuItem.click forwards (event, window, webContents) to
		// the app's click handler, which reads event.triggeredByAccelerator.
		(undoItem.click as (event: object, window: unknown, webContents: unknown) => void)(
			{ triggeredByAccelerator: false },
			window,
			window?.webContents
		);
	});

	// The menubar deliberately drops actions when no window holds OS focus
	// (substrate behavior); parallel work on the machine can steal focus from
	// the test app, so take it back before each menu click.
	const focusWindow = () => app.evaluate(({ app: electronApp, BrowserWindow }) => {
		electronApp.focus({ steal: true });
		(BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0])?.focus();
	});

	await focusWindow();
	await page.waitForTimeout(150);
	await clickMenuUndo();
	await page.waitForTimeout(250);
	if (await markdownRichEditorHasText(frame, marker)) {
		throw new Error('A single Edit > Undo did not reach the rich editor');
	}
	await waitUntil(() => !fs.readFileSync(readmePath, 'utf8').includes(marker), 'menu undo to persist the marker removal', 15_000);
}

function lineNumberForText(relativePath, needle) {
	const filePath = path.join(workspacePath, ...relativePath.split('/'));
	const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
	const index = lines.findIndex(line => line.includes(needle));
	if (index < 0) {
		throw new Error(`Did not find ${needle} in ${relativePath}`);
	}
	return index + 1;
}

function isTransparentCssColor(value) {
	if (!value || value === 'transparent') {
		return true;
	}
	const match = /^rgba?\(([^)]+)\)$/.exec(value);
	if (!match) {
		return false;
	}
	const parts = match[1].split(',').map(part => Number(part.trim()));
	return parts.length === 4 && parts[3] === 0;
}
