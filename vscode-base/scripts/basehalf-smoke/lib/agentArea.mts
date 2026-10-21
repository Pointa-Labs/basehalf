/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The terminal of the Agent Area.

// A shell that is still starting can be ended, or lose part of its startup,
// by a Control+C. The prompt is there once the terminal has text that no
// longer changes.
export async function waitForAgentAreaTerminalPrompt(page) {
	const deadline = Date.now() + 20_000;
	let previous = '';
	do {
		const text = await page.evaluate(() => {
			const wrapper = document.querySelector('.basehalf-agent-area-session.active.kind-terminal .terminal-wrapper') as HTMLElement & { xterm?: { buffer?: { active?: { length: number; getLine(index: number): { translateToString(trimRight?: boolean): string } | undefined } } } } | null;
			const buffer = wrapper?.xterm?.buffer?.active;
			const lines: string[] = [];
			for (let index = 0; buffer && index < buffer.length; index++) {
				lines.push(buffer.getLine(index)?.translateToString(true) ?? '');
			}
			return lines.join('\n').trim();
		});
		if (text && text === previous) {
			return;
		}
		previous = text;
		await page.waitForTimeout(400);
	} while (Date.now() < deadline);
	throw new Error('The Agent Area terminal showed no settled shell prompt within 20 seconds.');
}
