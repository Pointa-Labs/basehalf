/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The system's scroll bars, as BaseHalf sees them. Every run starts BaseHalf
// as on a system that shows scroll bars always, which the system does by
// itself while a mouse is attached: there a scrolling box gives its bar 15
// pixels, and a note that gets a bar as it is magnified is laid out anew.
// BaseHalf sets its own default at each start, before its first window
// (architecture invariants, "Product shell", D127). Without this, what a run
// finds depends on whether a mouse is attached to the machine.
//
// The run says so in the one place that outranks the system's own setting and
// that BaseHalf itself writes: the default of BaseHalf's application. Before
// the launch that default says `Always`; the BaseHalf that is launched has to
// replace it before it creates a window, or its boxes give their bars room.
// After the run, a default that still says `Always` is removed, so that a
// BaseHalf without the rule leaves the machine as the system has it.

import { execFileSync } from 'child_process';
import process from 'process';
import { product } from '../context.mts';

const KEY = 'AppleShowScrollBars';
const ALWAYS = 'Always';
const checked = process.platform === 'darwin';

/** Before the launch: the default of BaseHalf's application says that scroll bars always show. */
export function startWithScrollBarsAlways(): void {
	if (checked) {
		execFileSync('defaults', ['write', product.darwinBundleIdentifier, KEY, '-string', ALWAYS], { stdio: 'ignore' });
	}
}

/** After the run: removes the default when the BaseHalf that ran left it as the run set it. */
export function forgetScrollBarsAlways(): void {
	if (!checked) {
		return;
	}
	let left: string | undefined;
	try {
		left = execFileSync('defaults', ['read', product.darwinBundleIdentifier, KEY], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
	} catch {
		// No default is there.
	}
	if (left === ALWAYS) {
		execFileSync('defaults', ['delete', product.darwinBundleIdentifier, KEY], { stdio: 'ignore' });
	}
}

/** A box that scrolls gives its bar none of its room. */
export async function assertScrollBarsTakeNoRoom(page): Promise<void> {
	if (!checked) {
		return;
	}
	const room = await page.evaluate(() => {
		const box = document.createElement('div');
		box.style.cssText = 'position: fixed; left: -200px; top: 0; width: 100px; height: 100px; overflow: scroll;';
		document.body.appendChild(box);
		const taken = Math.max(box.offsetWidth - box.clientWidth, box.offsetHeight - box.clientHeight);
		box.remove();
		return taken;
	});
	if (room !== 0) {
		throw new Error(`A scroll bar should lie over what it scrolls and take none of its room, also when the application starts on a system that shows scroll bars always: a scrolling box gave its bar ${room} pixels. BaseHalf sets its own default before it creates a window (D127).`);
	}
}
