/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Quick Open and the Command Palette.

import path from 'path';
import process from 'process';

export async function quickOpen(page, value, acceptKey = 'Enter') {
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
	await fillAndAcceptQuickOpen(page, value, acceptKey);
}

async function fillAndAcceptQuickOpen(page, value, acceptKey) {
	const quickInput = visibleQuickInput(page);
	await quickInput.waitFor({ state: 'visible', timeout: 15_000 });
	await quickInput.fill(value);
	await waitForQuickInputResult(page, value);
	if (await quickInput.isVisible().catch(() => false)) {
		await page.keyboard.press(acceptKey);
		try {
			await quickInput.waitFor({ state: 'hidden', timeout: 5_000 });
		} catch {
			await page.keyboard.press('Escape');
			await quickInput.waitFor({ state: 'hidden', timeout: 15_000 });
		}
	}
}

export async function runCommand(page, value) {
	const ran = await tryRunCommand(page, value, { expectedBestRowText: value });
	if (!ran) {
		throw new Error(`Command not found in QuickInput: ${value}`);
	}
}

export async function tryRunCommand(page, value, options = {}) {
	let quickInput;
	for (let attempt = 0; attempt < 3; attempt++) {
		const previousQuickInput = visibleQuickInput(page);
		if (await previousQuickInput.isVisible().catch(() => false)) {
			await page.keyboard.press('Escape');
			await previousQuickInput.waitFor({ state: 'hidden', timeout: 15_000 });
		}
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
		const candidate = visibleQuickInput(page);
		await candidate.waitFor({ state: 'visible', timeout: 15_000 });
		if (await candidate.fill(`>${value}`, { timeout: 3_000 }).then(() => true, () => false)) {
			quickInput = candidate;
			break;
		}
	}
	if (!quickInput) {
		throw new Error(`Could not open QuickInput for command: ${value}`);
	}
	const firstRow = page.locator('.quick-input-list .monaco-list-row[role="option"]').first();
	await firstRow.waitFor({ state: 'visible', timeout: 15_000 });
	const firstRowText = ((await firstRow.getAttribute('aria-label')) ?? (await firstRow.textContent()) ?? '').replace(/\s+/g, ' ').trim();
	if (/^No matching/.test(firstRowText) || (options.expectedBestRowText && !isExpectedCommandRow(firstRowText, options.expectedBestRowText))) {
		await page.keyboard.press('Escape');
		await quickInput.waitFor({ state: 'hidden', timeout: 15_000 });
		return false;
	}
	const disabled = await firstRow.evaluate(row => {
		const element = row;
		return element.getAttribute('aria-disabled') === 'true'
			|| element.classList.contains('disabled')
			|| !!element.querySelector('.disabled');
	});
	if (disabled) {
		await page.keyboard.press('Escape');
		await quickInput.waitFor({ state: 'hidden', timeout: 15_000 });
		return false;
	}
	await page.keyboard.press('Enter');
	try {
		await quickInput.waitFor({ state: 'hidden', timeout: 15_000 });
	} catch (error) {
		await page.keyboard.press('Escape');
		await quickInput.waitFor({ state: 'hidden', timeout: 15_000 });
		return false;
	}
	return true;
}

export function visibleQuickInput(page) {
	return page.locator('.quick-input-widget:visible input:visible').last();
}

export function isExpectedCommandRow(rowText, expectedText) {
	return rowText === expectedText
		|| rowText.startsWith(`${expectedText} `)
		|| rowText.startsWith(`${expectedText},`)
		|| rowText.endsWith(`: ${expectedText}`)
		// Rows for commands with a keybinding append it after the title
		// (e.g. "BaseHalf: Split Agent Pane Right, ⌘D").
		|| rowText.includes(`: ${expectedText},`)
		|| rowText.includes(`: ${expectedText} `);
}

export async function waitForQuickInputResult(page, query) {
	const expectedToken = path.basename(query.startsWith('%') ? query.slice(1) : query).toLocaleLowerCase();
	await page.waitForFunction(({ expectedQuery, expectedToken }) => {
		const widget = Array.from(document.querySelectorAll('.quick-input-widget')).find(candidate => {
			const element = candidate;
			const rect = element.getBoundingClientRect();
			const style = getComputedStyle(element);
			return style.display !== 'none'
				&& style.visibility !== 'hidden'
				&& rect.width > 0
				&& rect.height > 0;
		});
		const input = widget?.querySelector('input');
		if (!widget || !input || input.value !== expectedQuery) {
			return false;
		}
		const rows = Array.from(widget.querySelectorAll('.quick-input-list .monaco-list-row[role="option"]'));
		const hasResult = rows.some(row => {
			const text = (row.getAttribute('aria-label') ?? row.textContent ?? '').replace(/\s+/g, ' ').trim();
			return text
				&& text !== 'No matching results'
				&& text.toLocaleLowerCase().includes(expectedToken);
		});
		return hasResult;
	}, { expectedQuery: query, expectedToken }, { timeout: 15_000 });
}

/** The name BaseHalf shows for a file: a note has no extension there (canvas card name). */
export function shownFileName(relativePath) {
	return path.basename(relativePath).replace(/(?<=.)\.(?:md|markdown)$/i, '');
}
