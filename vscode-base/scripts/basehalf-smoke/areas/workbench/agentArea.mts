/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The Agent Area: its choices, its terminal and the programs in it, tabs and splits, and the commands that open it.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { app, product, runRoot } from '../../context.mts';
import { waitForAgentAreaTerminalPrompt } from '../../lib/agentArea.mts';
import { runCommand } from '../../lib/quickInput.mts';

export async function assertAgentAreaChoices(page) {
	// The Agent Area chrome mounts when the auxiliary-bar pane materializes, so
	// open it first (an extension session also proves the unavailable state).
	await runCommand(page, 'New Codex Extension Session');
	await page.locator('.basehalf-agent-area').waitFor({ state: 'visible', timeout: 20_000 });
	await assertAgentAreaOwnsAuxiliaryBarChrome(page);
	const choices = await page.locator('.basehalf-agent-empty-choice .basehalf-agent-empty-choice-label').evaluateAll(nodes => nodes.map(node => (node.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
	const expected = ['Codex', 'Claude Code', 'Codex Extension', 'Claude Code Extension', 'Terminal'];
	if (choices.join('|') !== expected.join('|')) {
		throw new Error(`Unexpected Agent Area choices: ${choices.join(', ')}`);
	}

	await page.locator('.basehalf-agent-tab.unavailable', { hasText: 'Codex Extension' }).waitFor({ state: 'visible', timeout: 15_000 });
	await page.locator('.basehalf-agent-session-state', { hasText: /openai\.chatgpt|trusted workspace/ }).waitFor({ state: 'visible', timeout: 15_000 });
	// The missing curated extension must surface a concrete next step: an
	// Install action wired to the configured extension gallery (not a dead end).
	await page.locator('.basehalf-agent-session-state-retry', { hasText: /^(Install |Trust Workspace)/ }).waitFor({ state: 'visible', timeout: 15_000 });
	await assertAgentAreaSurfaceKind(page, 'extension');
	await page.locator('.basehalf-agent-tab.unavailable .basehalf-agent-tab-close').click();
	await dismissAgentToasts(page);
	// With no tabs left the empty-state picker is the whole surface.
	await page.locator('.basehalf-agent-area-empty.visible').waitFor({ state: 'visible', timeout: 15_000 });
	await runCommand(page, 'Toggle Agent Area');
	await page.locator('.basehalf-agent-area').waitFor({ state: 'hidden', timeout: 15_000 });
}

async function assertAgentAreaOwnsAuxiliaryBarChrome(page) {
	await page.locator('.part.auxiliarybar > .title').waitFor({ state: 'hidden', timeout: 15_000 });
	await page.waitForFunction(() => {
		const auxiliaryBar = document.querySelector('.part.auxiliarybar');
		const agentArea = document.querySelector('.basehalf-agent-area');
		if (!auxiliaryBar || !agentArea) {
			return false;
		}

		const auxiliaryRect = auxiliaryBar.getBoundingClientRect();
		const areaRect = agentArea.getBoundingClientRect();
		return Math.abs(auxiliaryRect.top - areaRect.top) <= 1
			&& Math.abs(auxiliaryRect.bottom - areaRect.bottom) <= 1;
	}, null, { timeout: 15_000 });
}

export async function assertGlobalAuxiliaryToggleOpensAgentArea(page) {
	await runCommand(page, 'Toggle Secondary Side Bar Visibility');
	await page.locator('.basehalf-agent-area').waitFor({ state: 'visible', timeout: 15_000 });
	await assertAgentAreaOwnsAuxiliaryBarChrome(page);
	await runCommand(page, 'Toggle Secondary Side Bar Visibility');
	await page.locator('.basehalf-agent-area').waitFor({ state: 'hidden', timeout: 15_000 });
}

// Soft-closed tabs/panes leave undo toasts for a grace period; dismissing them
// finalizes (disposes) the closed sessions and keeps later steps unambiguous.
async function dismissAgentToasts(page) {
	await page.locator('.basehalf-agent-toast').first().waitFor({ state: 'visible', timeout: 15_000 });
	while (await page.locator('.basehalf-agent-toast-dismiss').count()) {
		await page.locator('.basehalf-agent-toast-dismiss').first().click();
	}
	await page.locator('.basehalf-agent-toast').first().waitFor({ state: 'hidden', timeout: 15_000 });
}

export async function assertAgentAreaTerminalCommand(page) {
	await runCommand(page, 'Terminal: Create New Terminal');
	await page.locator('.basehalf-agent-area').waitFor({ state: 'visible', timeout: 20_000 });
	await page.locator('.basehalf-agent-tab.active').first().waitFor({ state: 'visible', timeout: 20_000 });
	await page.waitForFunction(() => {
		const activeSession = document.querySelector('.basehalf-agent-area-session.active');
		return !!activeSession?.querySelector('.terminal-wrapper, .xterm');
	}, null, { timeout: 20_000 });
	await assertAgentAreaSurfaceKind(page, 'terminal');
	await assertAgentAreaTerminalClipboardPaste(page);
	await assertAgentAreaTerminalGhosttyEnvAndAnsiColors(page);
	await assertAgentAreaTerminalScrollbarFollowsScrollback(page);
	await assertAgentAreaTerminalVersionAndWheelReports(page);
	await assertStockTerminalPanelHidden(page);
	await runCommand(page, 'Toggle Agent Area');
	await page.locator('.basehalf-agent-area').waitFor({ state: 'hidden', timeout: 15_000 });
	await assertStockTerminalPanelHidden(page);
}

async function assertAgentAreaTerminalClipboardPaste(page) {
	const marker = `BH_TYPELESS_PASTE_${Date.now()}`;
	const terminal = page.locator('.basehalf-agent-area-session.active.kind-terminal .xterm').first();
	await terminal.click();
	// The probe ends with Control+C, so the shell has to be at its prompt first.
	await waitForAgentAreaTerminalPrompt(page);
	const allowClipboardOverwrite = process.env.CI === 'true'
		|| process.env.CI === '1'
		|| process.env.BASEHALF_SMOKE_ALLOW_CLIPBOARD_OVERWRITE === '1';

	// Use Electron's native clipboard rather than the renderer Clipboard API:
	// vscode-file pages intentionally lack browser clipboard permission, while
	// Typeless writes the macOS pasteboard before synthesizing the paste shortcut.
	// Do not touch a rich clipboard: Electron cannot restore every arbitrary OS
	// pasteboard flavor atomically, so preserving images/files/RTF wins over this
	// assertion when a developer runs the smoke with such data copied. CI owns an
	// ephemeral clipboard and always exercises the native shortcut path; developers
	// can opt into the same behavior with BASEHALF_SMOKE_ALLOW_CLIPBOARD_OVERWRITE=1.
	const clipboardState = await app.evaluate(({ clipboard }, { text, allowClipboardOverwrite }) => {
		const formats = clipboard.availableFormats();
		const textOnly = formats.every(format => {
			const normalized = format.toLowerCase();
			return normalized === 'text'
				|| normalized === 'string'
				|| normalized === 'utf8_string'
				|| normalized.startsWith('text/plain')
				|| normalized === 'public.utf8-plain-text';
		});
		if (!textOnly && !allowClipboardOverwrite) {
			return { exercised: false, previousText: '' };
		}
		const previousText = clipboard.readText();
		clipboard.writeText(text);
		return { exercised: true, previousText };
	}, { text: marker, allowClipboardOverwrite });
	if (!clipboardState.exercised) {
		console.error('[basehalf-smoke] skip Agent Area shortcut paste probe: preserving non-text clipboard formats');
		return;
	}

	try {
		const pasteShortcut = process.platform === 'darwin'
			? 'Meta+V'
			: process.platform === 'win32'
				? 'Control+V'
				: 'Control+Shift+V';
		await page.keyboard.press(pasteShortcut);
		await page.waitForFunction(expected => {
			const wrapper = document.querySelector('.basehalf-agent-area-session.active.kind-terminal .terminal-wrapper') as HTMLElement & { xterm?: { buffer?: { active?: { length: number; getLine(index: number): { isWrapped: boolean; translateToString(trimRight?: boolean): string } | undefined } } } } | null;
			const buffer = wrapper?.xterm?.buffer?.active;
			if (!buffer) {
				return false;
			}
			// The marker follows the prompt and may wrap onto the next row.
			let logicalLine = '';
			for (let index = 0; index < buffer.length; index++) {
				const line = buffer.getLine(index);
				const text = line?.translateToString(true) ?? '';
				if (line?.isWrapped) {
					logicalLine += text;
					continue;
				}
				if (logicalLine.includes(expected)) {
					return true;
				}
				logicalLine = text;
			}
			return logicalLine.includes(expected);
		}, marker, { timeout: 15_000 });
	} finally {
		// Never execute the probe, and do not leave the smoke test's marker in the
		// user's clipboard after exercising the same shortcut Typeless dispatches.
		try {
			await page.keyboard.press('Control+C');
		} finally {
			await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), clipboardState.previousText);
		}
	}
}

export async function assertAgentAreaTuiSession(page) {
	await runCommand(page, 'New Claude Code TUI Session');
	await page.locator('.basehalf-agent-area').waitFor({ state: 'visible', timeout: 20_000 });
	// The TUI session either launches the agent CLI as its terminal process, or —
	// when the CLI is not installed on this machine — surfaces the launch failure
	// with install guidance instead of pretending the session is fine.
	await page.waitForFunction(() => {
		const activeSession = document.querySelector('.basehalf-agent-area-session.active');
		if (!activeSession) {
			return false;
		}
		if (activeSession.classList.contains('has-state')) {
			const stateText = activeSession.querySelector('.basehalf-agent-session-state')?.textContent || '';
			return /claude/i.test(stateText) && /restart/i.test(stateText);
		}
		return !!activeSession.querySelector('.basehalf-agent-session-surface .terminal-wrapper, .basehalf-agent-session-surface .xterm');
	}, null, { timeout: 20_000 });
	await assertAgentAreaSurfaceKind(page, 'terminal');
	await assertStockTerminalPanelHidden(page);
	const tabCountBefore = await page.locator('.basehalf-agent-tab').count();
	await page.locator('.basehalf-agent-tab.active .basehalf-agent-tab-close').click();
	await page.waitForFunction(expected => document.querySelectorAll('.basehalf-agent-tab').length < expected, tabCountBefore, { timeout: 20_000 });
	await dismissAgentToasts(page);
	await runCommand(page, 'Toggle Agent Area');
	await page.locator('.basehalf-agent-area').waitFor({ state: 'hidden', timeout: 15_000 });
}

export async function assertAgentAreaTabsAndSplits(page) {
	await runCommand(page, 'Toggle Agent Area');
	await page.locator('.basehalf-agent-area').waitFor({ state: 'visible', timeout: 20_000 });
	await runCommand(page, 'Split Agent Pane Right');
	await page.waitForFunction(() => document.querySelectorAll('.basehalf-agent-area-session.active').length === 2, null, { timeout: 20_000 });
	await page.locator('.basehalf-agent-divider.row').waitFor({ state: 'visible', timeout: 15_000 });
	await assertAgentAreaGhosttySplitVisuals(page);
	await runCommand(page, 'Close Agent Pane');
	await page.waitForFunction(() => document.querySelectorAll('.basehalf-agent-area-session.active').length === 1, null, { timeout: 20_000 });
	await page.locator('.basehalf-agent-toast-undo').first().click();
	await page.waitForFunction(() => document.querySelectorAll('.basehalf-agent-area-session.active').length === 2, null, { timeout: 20_000 });
	await runCommand(page, 'Close Agent Pane');
	await dismissAgentToasts(page);
	await page.waitForFunction(() => document.querySelectorAll('.basehalf-agent-area-session.active').length === 1, null, { timeout: 20_000 });
	await assertStockTerminalPanelHidden(page);
	await runCommand(page, 'Toggle Agent Area');
	await page.locator('.basehalf-agent-area').waitFor({ state: 'hidden', timeout: 15_000 });
}

export async function assertTogglePanelRemapsToAgentArea(page) {
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+J' : 'Control+J');
	await page.locator('.basehalf-agent-area').waitFor({ state: 'visible', timeout: 15_000 });
	await assertStockTerminalPanelHidden(page);
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+J' : 'Control+J');
	await page.locator('.basehalf-agent-area').waitFor({ state: 'hidden', timeout: 15_000 });
	await assertStockTerminalPanelHidden(page);
}

async function assertStockTerminalPanelHidden(page) {
	const visibleTerminalPanelTitles = await page.locator('.part.panel .title-label h2').evaluateAll(nodes => nodes
		.filter(node => {
			const element = node;
			const rect = element.getBoundingClientRect();
			const style = getComputedStyle(element);
			return style.display !== 'none'
				&& style.visibility !== 'hidden'
				&& rect.width > 0
				&& rect.height > 0
				&& rect.right > 0
				&& rect.bottom > 0
				&& rect.left < window.innerWidth
				&& rect.top < window.innerHeight;
		})
		.map(node => (node.textContent || '').replace(/\s+/g, ' ').trim())
		.filter(text => text === 'Terminal'));
	if (visibleTerminalPanelTitles.length) {
		throw new Error('Stock VS Code Terminal panel is visible instead of BaseHalf Agent Area');
	}
}

async function assertAgentAreaSurfaceKind(page, kind) {
	await page.waitForFunction(expectedKind => {
		const area = document.querySelector('.basehalf-agent-area');
		const activeSession = document.querySelector('.basehalf-agent-area-session.active');
		if (!(area instanceof HTMLElement) || !(activeSession instanceof HTMLElement)) {
			return false;
		}

		const terminal = expectedKind === 'terminal';
		const expectedAreaClass = terminal ? 'active-kind-terminal' : 'active-kind-extension';
		const expectedSessionClass = terminal ? 'kind-terminal' : 'kind-extension';
		if (!area.classList.contains(expectedAreaClass) || !activeSession.classList.contains(expectedSessionClass)) {
			return false;
		}

		const probe = document.createElement('div');
		probe.style.position = 'absolute';
		probe.style.pointerEvents = 'none';
		probe.style.backgroundColor = terminal
			? 'var(--vscode-terminal-background, #1f1f1f)'
			: 'var(--vscode-sideBar-background)';
		document.querySelector('.monaco-workbench')?.appendChild(probe);
		const expectedBackground = getComputedStyle(probe).backgroundColor;
		probe.remove();

		const paletteProbe = document.createElement('div');
		paletteProbe.style.position = 'absolute';
		paletteProbe.style.pointerEvents = 'none';
		paletteProbe.style.color = 'var(--vscode-terminal-foreground)';
		paletteProbe.style.borderColor = 'var(--vscode-terminal-ansiBlue)';
		paletteProbe.style.backgroundColor = 'var(--vscode-terminal-ansiRed)';
		document.querySelector('.monaco-workbench')?.appendChild(paletteProbe);
		const paletteStyle = getComputedStyle(paletteProbe);
		const terminalHasGhosttyPalette = !terminal
			|| (paletteStyle.color === 'rgb(204, 204, 204)'
				&& paletteStyle.borderColor === 'rgb(0, 120, 212)'
				&& paletteStyle.backgroundColor === 'rgb(247, 73, 73)');
		paletteProbe.remove();

		// Browser-style tab chrome: the tab bar is a darker frame than the
		// content, the active tab adopts the exact content background so it
		// flows into the pane below, and the frame/content hairline is a 1px
		// overlay (breakable under the active tab) rather than a border.
		const tabsBar = area.querySelector('.basehalf-agent-area-tabs');
		const activeTab = area.querySelector('.basehalf-agent-tab.active');
		const meanChannel = (color: string): number => {
			const parts = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
			if (parts.length < 3) {
				return NaN;
			}
			const scale = parts.every(value => value <= 1.001) ? 255 : 1;
			return (parts[0] + parts[1] + parts[2]) / 3 * scale;
		};
		const terminalHasBrowserTabChrome = !terminal
			|| (tabsBar instanceof HTMLElement && activeTab instanceof HTMLElement
				&& meanChannel(getComputedStyle(tabsBar).backgroundColor) < meanChannel(expectedBackground)
				&& getComputedStyle(activeTab).backgroundColor === expectedBackground
				&& getComputedStyle(tabsBar, '::after').height === '1px');

		// Ghostty-style terminal surface: keep the configured terminal
		// background as the dominant surface. A neutral linear sheen is okay;
		// colored radial glows are not.
		const overlayStyle = getComputedStyle(activeSession, '::after');
		const terminalHasNeutralSurface = !terminal
			|| (overlayStyle.backgroundImage.includes('linear-gradient')
				&& !overlayStyle.backgroundImage.includes('radial-gradient')
				&& overlayStyle.mixBlendMode === 'normal'
				&& overlayStyle.pointerEvents === 'none');

		const viewport = activeSession.querySelector('.xterm-viewport');
		const slider = activeSession.querySelector('.xterm-slider');
		const overviewRuler = activeSession.querySelector('.xterm-decoration-overview-ruler');
		const surface = activeSession.querySelector('.basehalf-agent-session-surface');
		const xterm = activeSession.querySelector('.xterm');
		const scrollableElement = activeSession.querySelector('.xterm-scrollable-element');
		const commandDecoration = activeSession.querySelector('.terminal-command-decoration, .terminal-command-guide');
		const terminalHasOverlayScroller = !terminal
			|| ((viewport instanceof HTMLElement && getComputedStyle(viewport).right === '0px')
				&& (slider instanceof HTMLElement && getComputedStyle(slider).borderRadius !== '0px')
				&& (!(overviewRuler instanceof HTMLElement) || getComputedStyle(overviewRuler).display === 'none'));
		const terminalHasTightGutter = !terminal
			|| (surface instanceof HTMLElement && xterm instanceof HTMLElement && scrollableElement instanceof HTMLElement
				&& (() => {
					const sessionBox = activeSession.getBoundingClientRect();
					const surfaceBox = surface.getBoundingClientRect();
					const left = Math.round(surfaceBox.left - sessionBox.left);
					const right = Math.round(sessionBox.right - surfaceBox.right);
					const top = Math.round(surfaceBox.top - sessionBox.top);
					const bottom = Math.round(sessionBox.bottom - surfaceBox.bottom);
					const xtermStyle = getComputedStyle(xterm);
					const scrollableStyle = getComputedStyle(scrollableElement);
					const commandDecorationHidden = !(commandDecoration instanceof HTMLElement)
						|| getComputedStyle(commandDecoration).display === 'none';
					return left >= 0 && left <= 1
						&& right >= 0 && right <= 1
						&& top >= 0 && top <= 3
						&& bottom >= 0 && bottom <= 3
						&& Number.parseFloat(xtermStyle.paddingLeft) <= 3
						&& Number.parseFloat(scrollableStyle.paddingLeft) <= 3
						&& Number.parseFloat(scrollableStyle.marginLeft) >= -3
						&& commandDecorationHidden;
				})());

		return getComputedStyle(area).backgroundColor === expectedBackground
			&& getComputedStyle(activeSession).backgroundColor === expectedBackground
			&& terminalHasGhosttyPalette
			&& terminalHasBrowserTabChrome
			&& terminalHasNeutralSurface
			&& terminalHasOverlayScroller
			&& terminalHasTightGutter;
	}, kind, { timeout: 15_000 });
}

async function assertAgentAreaTerminalGhosttyEnvAndAnsiColors(page) {
	const terminal = page.locator('.basehalf-agent-area-session.active.kind-terminal .xterm').first();
	await terminal.click();
	await page.keyboard.insertText(`node -e "console.log('BH_NO_COLOR='+(process.env.NO_COLOR||'<empty>')); console.log('BH_TERM='+process.env.TERM); console.log('BH_COLORTERM='+process.env.COLORTERM); console.log('BH_TERM_PROGRAM='+process.env.TERM_PROGRAM); console.log('BH_TERM_PROGRAM_VERSION='+process.env.TERM_PROGRAM_VERSION); console.log('BH_SYNC_OUTPUT='+(process.env.CLAUDE_CODE_FORCE_SYNC_OUTPUT||'<empty>')); console.log('BH_FORCE_COLOR='+(process.env.FORCE_COLOR||'<empty>')); console.log('BH_NODE_DISABLE_COLORS='+(process.env.NODE_DISABLE_COLORS||'<empty>')); process.stdout.write('\\x1b[31mBH_RED_SENTINEL\\x1b[0m \\x1b[36mBH_CYAN_SENTINEL\\x1b[0m\\n')"`);
	await page.keyboard.press('Enter');

	await page.waitForFunction(({ expectedVersion, expectedSyncOutput }) => {
		const getActiveXtermBufferText = (): string => {
			const wrapper = document.querySelector('.basehalf-agent-area-session.active.kind-terminal .terminal-wrapper') as HTMLElement & { xterm?: { buffer?: { active?: { length: number; getLine(index: number): { translateToString(trimRight?: boolean): string } | undefined } } } } | null;
			const buffer = wrapper?.xterm?.buffer?.active;
			if (!buffer) {
				return '';
			}

			const lines: string[] = [];
			for (let index = 0; index < buffer.length; index++) {
				lines.push(buffer.getLine(index)?.translateToString(true) ?? '');
			}
			return lines.join('\n');
		};
		const text = getActiveXtermBufferText();
		return text.includes('BH_NO_COLOR=<empty>')
			&& text.includes('BH_TERM=xterm-256color')
			&& text.includes('BH_COLORTERM=truecolor')
			&& text.includes('BH_TERM_PROGRAM=BaseHalf')
			&& text.includes(`BH_TERM_PROGRAM_VERSION=${expectedVersion}`)
			&& text.includes(`BH_SYNC_OUTPUT=${expectedSyncOutput}`)
			&& text.includes('BH_FORCE_COLOR=<empty>')
			&& text.includes('BH_NODE_DISABLE_COLORS=<empty>')
			&& text.includes('BH_RED_SENTINEL')
			&& text.includes('BH_CYAN_SENTINEL');
	}, { expectedVersion: product.basehalfVersion, expectedSyncOutput: process.platform === 'win32' ? '<empty>' : '1' }, { timeout: 20_000 });

	await page.waitForFunction(() => {
		const activeXtermHasPaletteText = (marker: string, paletteIndex: number): boolean => {
			const wrapper = document.querySelector('.basehalf-agent-area-session.active.kind-terminal .terminal-wrapper') as HTMLElement & { xterm?: { buffer?: { active?: { length: number; getLine(index: number): { translateToString(trimRight?: boolean): string; getCell(index: number): { isFgPalette(): boolean; getFgColor(): number } | undefined } | undefined } } } } | null;
			const buffer = wrapper?.xterm?.buffer?.active;
			if (!buffer) {
				return false;
			}

			for (let row = 0; row < buffer.length; row++) {
				const line = buffer.getLine(row);
				const text = line?.translateToString(true) ?? '';
				let start = text.indexOf(marker);
				while (line && start >= 0) {
					for (let column = start; column < start + marker.length; column++) {
						const cell = line.getCell(column);
						if (cell?.isFgPalette() && cell.getFgColor() === paletteIndex) {
							return true;
						}
					}
					start = text.indexOf(marker, start + 1);
				}
			}

			return false;
		};
		return activeXtermHasPaletteText('BH_RED_SENTINEL', 1)
			&& activeXtermHasPaletteText('BH_CYAN_SENTINEL', 6);
	}, null, { timeout: 20_000 });
}

// A terminal program that prints the terminal's XTVERSION reply, or counts the
// wheel reports it receives while tracking the mouse in the alternate buffer.
function agentAreaTerminalProbeSource() {
	return String.raw`
const mode = process.argv[2];
process.stdin.setRawMode(true);
process.stdin.setEncoding('latin1');
const finish = line => {
	process.stdin.setRawMode(false);
	console.log(line);
	process.exit(0);
};
if (mode === 'xtversion') {
	let reply = '';
	setTimeout(() => finish('BH_XTVERSION=<none>'), 5000);
	process.stdin.on('data', chunk => {
		reply += chunk;
		const match = /\x1bP>\|([^\x1b]*)\x1b\\/.exec(reply);
		if (match) {
			finish('BH_XTVERSION=' + match[1]);
		}
	});
	process.stdout.write('\x1b[>0q');
} else {
	let up = 0;
	let down = 0;
	process.stdout.write('\x1b[?1049h\x1b[?1000h\x1b[?1006hBH_WHEEL_READY');
	process.stdin.on('data', chunk => {
		for (const match of chunk.matchAll(/\x1b\[<(\d+);\d+;\d+[Mm]/g)) {
			if (match[1] === '64') {
				up++;
			} else if (match[1] === '65') {
				down++;
			}
		}
		if (chunk.includes('q')) {
			process.stdout.write('\x1b[?1006l\x1b[?1000l\x1b[?1049l');
			finish('BH_WHEEL_REPORTS=' + up + ',' + down);
		}
	});
}
`;
}

async function waitForActiveAgentAreaTerminalLine(page, prefix) {
	const handle = await page.waitForFunction(expectedPrefix => {
		const wrapper = document.querySelector('.basehalf-agent-area-session.active.kind-terminal .terminal-wrapper') as HTMLElement & { xterm?: { buffer?: { active?: { length: number; getLine(index: number): { translateToString(trimRight?: boolean): string } | undefined } } } } | null;
		const buffer = wrapper?.xterm?.buffer?.active;
		for (let index = buffer ? buffer.length - 1 : -1; index >= 0; index--) {
			const line = buffer?.getLine(index)?.translateToString(true) ?? '';
			if (line.startsWith(expectedPrefix)) {
				return line;
			}
		}
		return false;
	}, prefix, { timeout: 20_000 });
	return await handle.jsonValue();
}

function readAgentAreaTerminalScrollbar(page) {
	return page.evaluate(() => {
		const scrollbar = document.querySelector('.basehalf-agent-area-session.active.kind-terminal .xterm-scrollable-element > .xterm-scrollbar.xterm-vertical');
		const slider = scrollbar?.querySelector('.xterm-slider');
		if (!(scrollbar instanceof HTMLElement) || !(slider instanceof HTMLElement)) {
			return undefined;
		}
		const style = getComputedStyle(scrollbar);
		return { opacity: style.opacity, pointerEvents: style.pointerEvents, trackHeight: scrollbar.offsetHeight, sliderHeight: slider.offsetHeight };
	});
}

function agentAreaTerminalScrollbarIsShown(scrollbar) {
	return scrollbar?.opacity === '1' && scrollbar.pointerEvents !== 'none' && scrollbar.sliderHeight < scrollbar.trackHeight;
}

function agentAreaTerminalScrollbarIsHidden(scrollbar) {
	return scrollbar?.opacity === '0' && scrollbar.pointerEvents === 'none';
}

async function waitForAgentAreaTerminalScrollbar(page, isExpected, expectation) {
	const deadline = Date.now() + 15_000;
	let scrollbar;
	do {
		scrollbar = await readAgentAreaTerminalScrollbar(page);
		if (isExpected(scrollbar)) {
			return;
		}
		await page.waitForTimeout(100);
	} while (Date.now() < deadline);
	throw new Error(`Agent Area terminal scrollbar is not ${expectation}: ${JSON.stringify(scrollbar ?? 'no scrollbar element')}`);
}

// With more output than rows, the terminal shows its scrollbar while the
// pointer is over it and hides it once the pointer has left
// (docs/specs/agent-area-terminal.md).
async function assertAgentAreaTerminalScrollbarFollowsScrollback(page) {
	const terminal = page.locator('.basehalf-agent-area-session.active.kind-terminal .xterm').first();
	await terminal.click();
	await page.keyboard.insertText(`node -e "for (let row = 0; row < 200; row++) { console.log('BH_SCROLLBACK_' + row); }"`);
	await page.keyboard.press('Enter');
	await waitForActiveAgentAreaTerminalLine(page, 'BH_SCROLLBACK_199');

	const box = await terminal.boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await waitForAgentAreaTerminalScrollbar(page, agentAreaTerminalScrollbarIsShown, 'shown, with a slider shorter than its track, while the pointer is over a terminal with scrollback');
	await page.mouse.move(box.x / 2, box.y + box.height / 2);
	await waitForAgentAreaTerminalScrollbar(page, agentAreaTerminalScrollbarIsHidden, 'hidden after the pointer left the terminal');
}

// Agent Area terminals answer XTVERSION as BaseHalf and turn a trackpad
// gesture into one wheel report per accumulated row, Ghostty-style
// (docs/specs/agent-area-terminal.md).
async function assertAgentAreaTerminalVersionAndWheelReports(page) {
	const probe = path.join(runRoot, 'agent-area-terminal-probe.cjs');
	fs.writeFileSync(probe, agentAreaTerminalProbeSource());
	const terminal = page.locator('.basehalf-agent-area-session.active.kind-terminal .xterm').first();
	await terminal.click();

	await page.keyboard.insertText(`node ${JSON.stringify(probe)} xtversion`);
	await page.keyboard.press('Enter');
	const version = await waitForActiveAgentAreaTerminalLine(page, 'BH_XTVERSION=');
	if (version !== `BH_XTVERSION=BaseHalf(${product.basehalfVersion})`) {
		throw new Error(`Agent Area terminal answered XTVERSION with ${version}`);
	}

	await page.keyboard.insertText(`node ${JSON.stringify(probe)} wheel`);
	await page.keyboard.press('Enter');
	await page.waitForFunction(() => {
		const wrapper = document.querySelector('.basehalf-agent-area-session.active.kind-terminal .terminal-wrapper') as HTMLElement & { xterm?: { buffer?: { active?: { type: string } }; modes?: { mouseTrackingMode: string } } } | null;
		return wrapper?.xterm?.buffer?.active?.type === 'alternate' && wrapper.xterm.modes?.mouseTrackingMode === 'vt200';
	}, null, { timeout: 20_000 });
	const cellHeight = await page.evaluate(() => {
		const wrapper = document.querySelector('.basehalf-agent-area-session.active.kind-terminal .terminal-wrapper') as HTMLElement & { xterm?: { _core?: { _renderService?: { dimensions?: { css?: { cell?: { height?: number } } } } } } } | null;
		return wrapper?.xterm?._core?._renderService?.dimensions?.css?.cell?.height ?? 0;
	});
	const box = await terminal.boundingBox();
	const pointer = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	// A trackpad gesture, shaped like Chromium's precise macOS wheel events
	// (wheelDelta is three times the pixel delta). CDP-synthesized wheel events
	// always carry one notch, which reads as a physical wheel, so they serve as
	// the two notches afterwards. Their pixel delta is far from three rows, so
	// that a notch counted as pixels changes the number of reports.
	const deltas = [2, 3, 5, 7, 9, 11, 12, 11, 9, 7, 5, 4, 3, 2, 1];
	await page.evaluate(async ({ deltas, pointer }) => {
		const screen = document.querySelector('.basehalf-agent-area-session.active.kind-terminal .xterm-screen');
		for (const delta of deltas) {
			screen?.dispatchEvent(new WheelEvent('wheel', { deltaY: -delta, deltaMode: 0, wheelDeltaY: 3 * delta, clientX: pointer.x, clientY: pointer.y, bubbles: true, cancelable: true }));
			await new Promise(resolve => setTimeout(resolve, 8));
		}
	}, { deltas, pointer });
	await page.mouse.move(pointer.x, pointer.y);
	await page.mouse.wheel(0, -200);
	await page.mouse.wheel(0, -200);
	await page.waitForTimeout(500);
	// The alternate buffer has no rows to scroll to, so the pointer over the
	// terminal brings up no scrollbar.
	await waitForAgentAreaTerminalScrollbar(page, agentAreaTerminalScrollbarIsHidden, 'hidden for a program in the alternate buffer under the pointer');
	await page.keyboard.press('q');
	const reports = await waitForActiveAgentAreaTerminalLine(page, 'BH_WHEEL_REPORTS=');
	const [up, down] = String(reports).slice('BH_WHEEL_REPORTS='.length).split(',').map(Number);
	const pixels = deltas.reduce((total, delta) => total + delta, 0);
	// Less than a row accumulates; a row or more sends the whole rows and drops the fraction.
	let pendingPixels = 0;
	let trackpadRows = 0;
	for (const delta of deltas) {
		pendingPixels += delta;
		if (pendingPixels >= cellHeight) {
			trackpadRows += Math.floor(pendingPixels / cellHeight);
			pendingPixels = 0;
		}
	}
	const expected = trackpadRows + 2 * 3;
	if (!(cellHeight > 0) || down !== 0 || Math.abs(up - expected) > 1) {
		throw new Error(`Agent Area terminal sent ${up} up and ${down} down wheel reports for ${pixels}px of trackpad scroll and two wheel notches; expected ${expected} (cell height ${cellHeight}).`);
	}
}

async function assertAgentAreaGhosttySplitVisuals(page) {
	await page.waitForFunction(() => {
		const area = document.querySelector('.basehalf-agent-area');
		const sessions = [...document.querySelectorAll('.basehalf-agent-area-session.active.kind-terminal')]
			.filter((node): node is HTMLElement => node instanceof HTMLElement);
		const dimOverlay = sessions.find(session => session.classList.contains('dimmed'))?.querySelector('.basehalf-agent-pane-dim');
		const dividerLine = document.querySelector('.basehalf-agent-divider-line');
		const handle = sessions[0]?.querySelector('.basehalf-agent-pane-handle');
		const dropPreview = sessions[0]?.querySelector('.basehalf-agent-pane-drop-preview');
		const hud = document.querySelector('.basehalf-agent-resize-hud');
		if (!(area instanceof HTMLElement)
			|| !(dimOverlay instanceof HTMLElement)
			|| !(dividerLine instanceof HTMLElement)
			|| !(handle instanceof HTMLElement)
			|| !(dropPreview instanceof HTMLElement)
			|| !(hud instanceof HTMLElement)) {
			return false;
		}

		const dividerProbe = document.createElement('div');
		dividerProbe.style.position = 'absolute';
		dividerProbe.style.pointerEvents = 'none';
		dividerProbe.style.backgroundColor = 'var(--basehalf-agent-terminal-divider)';
		area.appendChild(dividerProbe);
		const expectedDivider = getComputedStyle(dividerProbe).backgroundColor;
		dividerProbe.remove();

		const dimOpacity = Number.parseFloat(getComputedStyle(dimOverlay).opacity);
		const handleStyle = getComputedStyle(handle);
		const dropStyle = getComputedStyle(dropPreview);
		const hudStyle = getComputedStyle(hud);

		return dimOpacity > 0 && dimOpacity <= 0.16
			&& getComputedStyle(dividerLine).backgroundColor === expectedDivider
			&& handleStyle.width === '80px'
			&& handleStyle.height === '12px'
			&& handleStyle.backgroundColor === 'rgba(0, 0, 0, 0)'
			&& dropStyle.borderTopWidth === '0px'
			&& hudStyle.borderTopWidth === '0px'
			&& hudStyle.boxShadow !== 'none';
	}, null, { timeout: 15_000 });

	const firstSession = page.locator('.basehalf-agent-area-session.active.kind-terminal').first();
	const box = await firstSession.boundingBox();
	if (!box) {
		throw new Error('Agent Area split session is not visible for handle reveal check');
	}
	await page.mouse.move(box.x + box.width / 2, box.y + 4);
	await page.waitForFunction(() => {
		const handle = document.querySelector('.basehalf-agent-area-session.active.kind-terminal .basehalf-agent-pane-handle');
		return handle instanceof HTMLElement && Number.parseFloat(getComputedStyle(handle).opacity) > 0;
	}, null, { timeout: 15_000 });
}
