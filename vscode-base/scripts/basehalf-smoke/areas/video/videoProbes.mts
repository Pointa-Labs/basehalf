/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Reading and driving the Video node: its file, its card, its panel and menus, and generating.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { recordVideoNodeStates, solidPng } from './videoProvider.mts';
import {
	VIDEO_END_IMAGE,
	VIDEO_FOLDER,
	VIDEO_GENERATION_TIMEOUT_MS,
	VIDEO_START_IMAGE,
	videoSmokeProvider
} from './videoNode.mts';
import { workspacePath } from '../../context.mts';
import {
	assertCanvasMenuOpenedByClick,
	assertNoCanvasFocusRing,
	emptyCanvasPoint,
	openCanvasZoomMenu,
	readCanvasCardGeometry,
	startCanvasConnectionDrag,
	waitForCanvasCardSelection
} from '../../lib/canvas.mts';
import { waitUntil } from '../../lib/steps.mts';
import { VIDEO_PROVIDER, waitForReading } from '../../lib/videoProviders.mts';

// --- Video node helpers ---

export function createVideoSmokeFolder() {
	const folder = path.join(workspacePath, VIDEO_FOLDER);
	fs.mkdirSync(folder, { recursive: true });
	// Large enough for the provider's image limits (each side at least 300 px).
	fs.writeFileSync(path.join(folder, 'start.png'), solidPng(640, 360, [37, 99, 235]));
	fs.writeFileSync(path.join(folder, 'end.png'), solidPng(640, 360, [245, 158, 11]));
	// The images lie at the left, one above the other.
	const mirror = path.join(workspacePath, '.bh', 'mirror', VIDEO_FOLDER);
	fs.mkdirSync(mirror, { recursive: true });
	fs.writeFileSync(path.join(mirror, 'canvas.yaml'), [
		`path: "${VIDEO_FOLDER}"`,
		'size:',
		'  width: 2400',
		'  height: 1600',
		'cards:',
		`  - path: "${VIDEO_START_IMAGE}"`,
		'    kind: file',
		'    x: 0',
		'    y: 0',
		'    width: 300',
		'    height: 220',
		`  - path: "${VIDEO_END_IMAGE}"`,
		'    kind: file',
		'    x: 0',
		'    y: 300',
		'    width: 300',
		'    height: 220',
		'edges: []',
		''
	].join('\n'), 'utf8');
}

export function videoWorkspaceFile(relativePath) {
	return path.join(workspacePath, ...relativePath.split('/'));
}

export function readVideoNode(relativePath) {
	return JSON.parse(fs.readFileSync(videoWorkspaceFile(relativePath), 'utf8'));
}

export function readVideoCanvasLayout() {
	return fs.readFileSync(path.join(workspacePath, '.bh', 'mirror', VIDEO_FOLDER, 'canvas.yaml'), 'utf8');
}

// JSON with its keys sorted, to compare documents whatever order they were written in.
export function canonicalJson(value) {
	return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
		? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]))
		: item);
}

// Waits for a generation to start. A refused one says why in a notification,
// whose toast goes after a few seconds; the failure names every toast seen.
export async function waitForGenerationStart(page, read, accept, description) {
	const seen = new Set();
	try {
		return await waitForReading(async () => {
			for (const text of await page.locator('.notifications-toasts .notification-list-item-message').allInnerTexts().catch(() => [])) {
				seen.add(text);
			}
			return read();
		}, accept, description);
	} catch (error) {
		throw new Error(`${error instanceof Error ? error.message : String(error)}; notifications: ${JSON.stringify([...seen])}`);
	}
}

export function assertSameCanvasView(before, after, what) {
	if (Math.abs(before.x - after.x) > 0.5 || Math.abs(before.y - after.y) > 0.5 || Math.abs(before.zoom - after.zoom) > 0.001) {
		throw new Error(`${what} must not pan or zoom the canvas: ${JSON.stringify({ before, after })}`);
	}
}

export async function setCanvasZoomPercent(page, percent) {
	const controller = await openCanvasZoomMenu(page);
	await controller.input.fill(`${percent}%`);
	await controller.input.press('Enter');
	await controller.menu.waitFor({ state: 'hidden', timeout: 10_000 });
	await page.waitForFunction(expected => Number(document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom')) === expected, percent / 100, { timeout: 10_000 });
}

export function videoCanvasCard(page, cardPath) {
	return page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${cardPath}"]`);
}

export function videoPanel(page, cardPath) {
	return page.locator(`.basehalf-canvas-video-panel-surface[data-basehalf-card-path="${cardPath}"] .bh-video-panel`);
}

// Clicks a point of the card that is on top: a panel, a toolbar, or another
// card can lie over part of it.
export async function clickCanvasCardOnTop(page, cardPath) {
	const point = await page.evaluate(path => {
		const card = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(element => element.getAttribute('data-basehalf-card-path') === path);
		const rect = card?.getBoundingClientRect();
		if (!card || !rect) {
			return undefined;
		}
		for (const [x, y] of [[0.5, 0.5], [0.3, 0.5], [0.7, 0.5], [0.5, 0.3], [0.5, 0.7], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) {
			const point = { x: rect.left + rect.width * x, y: rect.top + rect.height * y };
			if (card.contains(document.elementFromPoint(point.x, point.y))) {
				return point;
			}
		}
		return undefined;
	}, cardPath);
	if (!point) {
		throw new Error(`No part of the card ${cardPath} is on top to click`);
	}
	await page.mouse.click(point.x, point.y);
}

export async function clickBlankVideoCanvas(page) {
	const point = await emptyCanvasPoint(page);
	await page.mouse.click(point.x, point.y);
	await waitForReading(() => page.locator('.react-flow__node.selected').count(), count => count === 0, 'a click on the blank canvas to end the selection');
}

export async function selectVideoCard(page, cardPath) {
	const selected = await page.evaluate(path => Array.from(document.querySelectorAll('.basehalf-canvas-card'))
		.find(card => card.getAttribute('data-basehalf-card-path') === path)?.closest('.react-flow__node')?.classList.contains('selected') === true, cardPath);
	if (!selected) {
		await clickCanvasCardOnTop(page, cardPath);
	}
	await waitForCanvasCardSelection(page, cardPath, 15_000);
	return waitForVideoPanel(page, cardPath);
}

// The panel of the selected Video card, once the scene shows it and it has read its node.
export async function waitForVideoPanel(page, cardPath, timeoutMs = 15_000) {
	await waitForReading(() => page.evaluate(path => {
		const surfaces = Array.from(document.querySelectorAll('.basehalf-canvas-video-panel-surface'));
		const surface = surfaces.find(element => element.getAttribute('data-basehalf-card-path') === path);
		return {
			surfaces: surfaces.map(element => element.getAttribute('data-basehalf-card-path')),
			visible: surface?.getAttribute('data-visible') ?? null,
			state: surface?.querySelector('.bh-video-panel')?.getAttribute('data-state') ?? null
		};
	}, cardPath), seen => seen.visible === 'true' && seen.state === 'ready', `the Video panel of ${cardPath} to show`, timeoutMs);
	return videoPanel(page, cardPath);
}

export function readVideoPanel(panel) {
	return panel.evaluate(element => {
		const text = selector => element.querySelector(selector)?.textContent?.trim() ?? null;
		const prompt = element.querySelector('textarea.bh-video-panel-prompt-input');
		const generate = element.querySelector('button.bh-video-panel-generate');
		const frame = use => {
			const slot = element.querySelector(`.bh-video-panel-slot[data-use="${use}"]`);
			return slot ? {
				name: slot.querySelector('.bh-video-panel-input-name')?.textContent ?? null,
				path: slot.querySelector('.bh-video-panel-remove')?.getAttribute('data-key')?.replace(/^remove:/, '') ?? null
			} : null;
		};
		const estimate = element.querySelector('.bh-video-panel-estimate');
		const reason = element.querySelector('.bh-video-panel-reason');
		const action = element.querySelector('.bh-video-panel-reason-action');
		return {
			catalog: element.getAttribute('data-catalog'),
			reason: reason && !reason.hidden ? { text: reason.querySelector('.bh-video-panel-reason-text')?.textContent ?? null, action: action && !action.hidden ? action.textContent : null } : null,
			prompt: prompt?.value ?? null,
			promptFocused: !!prompt && element.ownerDocument.activeElement === prompt,
			model: text('.bh-video-panel-model-label'),
			estimate: estimate && !estimate.hidden ? { text: estimate.textContent, label: estimate.getAttribute('aria-label') } : null,
			modelOutlined: element.querySelector('.bh-video-panel-model')?.classList.contains('outlined') ?? false,
			settings: text('.bh-video-panel-settings-label'),
			generate: generate ? {
				disabled: generate.getAttribute('aria-disabled') === 'true',
				label: generate.getAttribute('aria-label'),
				stop: generate.classList.contains('stop')
			} : null,
			emptySlots: Array.from(element.querySelectorAll('.bh-video-panel-slot.empty')).map(slot => slot.getAttribute('data-role')),
			start: frame('start-frame'),
			end: frame('end-frame'),
			names: Array.from(element.querySelectorAll('.bh-video-panel-prompt-overlay .bh-video-panel-name')).map(name => ({
				text: name.textContent,
				known: !name.classList.contains('unknown'),
				underlined: getComputedStyle(name).textDecorationLine.includes('underline')
			}))
		};
	}, undefined, { timeout: 2_000 });
}

export function readVideoModelMenu(panel) {
	return panel.evaluate(element => {
		const menu = element.querySelector('.bh-video-panel-menu.model');
		const label = item => item.querySelector('.bh-video-panel-menu-label')?.textContent ?? null;
		return menu ? {
			groups: Array.from(menu.querySelectorAll('.bh-video-panel-menu-group')).map(group => ({
				provider: group.getAttribute('data-provider'),
				label: group.querySelector('.bh-video-panel-menu-heading-label')?.textContent ?? null,
				detail: group.querySelector('.bh-video-panel-menu-heading-detail')?.textContent ?? null,
				items: Array.from(group.querySelectorAll('.bh-video-panel-menu-item')).map(item => ({
					model: (item.getAttribute('data-key') ?? '').split(':').slice(2).join(':'),
					label: label(item),
					detail: item.querySelector('.bh-video-panel-menu-detail')?.textContent ?? null,
					unavailable: item.classList.contains('unavailable')
				}))
			})),
			end: Array.from(menu.querySelectorAll(':scope > .bh-video-panel-menu-item')).map(label)
		} : null;
	}, undefined, { timeout: 2_000 });
}

export async function clickVideoModel(page, panel, model) {
	await panel.locator(`.bh-video-panel-menu.model .bh-video-panel-menu-item[data-key="model:${VIDEO_PROVIDER}:${model}"]`).click();
	await waitForReading(() => panel.locator('.bh-video-panel-menu.model').count(), count => count === 0, 'the model menu to close after a choice');
}

// What the settings popover draws: its parameters, their choices, and what is chosen.
export function readVideoSettingsPopover(panel) {
	return panel.evaluate(element => {
		const popover = element.querySelector('.bh-video-panel-menu.settings');
		if (!popover) {
			return null;
		}
		const keys = selector => Array.from(popover.querySelectorAll(selector)).map(control => control.getAttribute('data-key'));
		return {
			width: Math.round(popover.getBoundingClientRect().width),
			focusInside: popover.contains(element.ownerDocument.activeElement),
			keys: keys('[data-key]'),
			checked: keys('[data-key][aria-checked="true"]'),
			parameters: Array.from(popover.querySelectorAll('.bh-video-panel-setting[data-parameter]')).map(section => section.getAttribute('data-parameter')),
			choices: Array.from(popover.querySelectorAll('.bh-video-panel-setting[data-parameter] .bh-video-panel-choice')).map(choice => {
				const key = choice.getAttribute('data-key') ?? '';
				const parameter = choice.closest('.bh-video-panel-setting')?.getAttribute('data-parameter') ?? '';
				return { key, parameter, value: key.slice(parameter.length + 1), checked: choice.getAttribute('aria-checked') === 'true' };
			})
		};
	}, undefined, { timeout: 2_000 });
}

// Opens the settings popover and waits for the keyboard focus to be inside it,
// so that a later Escape reaches it.
export async function openVideoSettings(panel) {
	await panel.locator('button.bh-video-panel-settings').click();
	return waitForReading(() => readVideoSettingsPopover(panel), seen => seen !== null && seen.focusInside, 'the settings popover to open with the focus inside');
}

export async function closeVideoPanelMenu(page, panel, kind) {
	// An Escape that arrives before the focus does reaches nobody.
	await waitForReading(() => panel.evaluate((element, menuKind) => element.querySelector(`.bh-video-panel-menu.${menuKind}`)?.contains(element.ownerDocument.activeElement) === true, kind, { timeout: 2_000 }), inside => inside, `the keyboard focus to be in the ${kind} menu`);
	await page.keyboard.press('Escape');
	await waitForReading(() => panel.locator(`.bh-video-panel-menu.${kind}`).count(), count => count === 0, `Escape to close the ${kind} menu`);
}

export function readVideoMentionMenu(panel) {
	return panel.evaluate(element => {
		const menu = element.querySelector('.bh-video-panel-menu.mention');
		return menu ? {
			options: Array.from(menu.querySelectorAll('.bh-video-panel-mention')).map(option => ({
				label: option.querySelector('.bh-video-panel-mention-label')?.textContent ?? null,
				file: option.querySelector('.bh-video-panel-mention-file')?.textContent ?? '',
				active: option.getAttribute('aria-selected') === 'true'
			}))
		} : null;
	}, undefined, { timeout: 2_000 });
}

export function readVideoCard(page, cardPath) {
	return page.evaluate(path => {
		const card = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(element => element.getAttribute('data-basehalf-card-path') === path);
		const face = card?.querySelector('.bh-video-card');
		if (!face) {
			return null;
		}
		const video = face.querySelector('video.bh-video-card-video');
		const glyphFace = face.querySelector('.bh-video-card-face');
		return {
			state: face.getAttribute('data-state'),
			faceShown: !!glyphFace && getComputedStyle(glyphFace).display !== 'none',
			phase: face.querySelector('.bh-video-card-phase')?.textContent ?? null,
			elapsed: face.querySelector('.bh-video-card-elapsed')?.textContent ?? null,
			progress: !!face.querySelector('.bh-video-card-progress[role="progressbar"]'),
			message: face.querySelector('.bh-video-card-message')?.textContent ?? null,
			video: video ? { readyState: video.readyState, width: video.videoWidth, height: video.videoHeight, error: video.error?.message ?? null } : null
		};
	}, cardPath);
}

// Plays the card's video for a moment, muted, and reports what it played.
export function playVideoCard(page, cardPath) {
	return page.evaluate(async path => {
		const card = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(element => element.getAttribute('data-basehalf-card-path') === path);
		const video = card?.querySelector('.bh-video-card[data-state="video"] video.bh-video-card-video');
		if (!(video instanceof HTMLVideoElement)) {
			return { error: 'The card has no video element' };
		}
		video.muted = true;
		try {
			await video.play();
		} catch (error) {
			return { error: `play() failed: ${error}` };
		}
		const started = performance.now();
		while (video.currentTime < 0.3 && !video.error && performance.now() - started < 5_000) {
			await new Promise(resolve => setTimeout(resolve, 50));
		}
		const played = { currentTime: video.currentTime, duration: video.duration, width: video.videoWidth, height: video.videoHeight, controls: video.controls, error: video.error?.message ?? null };
		video.pause();
		return played;
	}, cardPath);
}

// Moves the card's player to `seconds`, as the user does with its controls.
export async function seekVideoCard(page, cardPath, seconds) {
	const seeked = await page.evaluate(async ({ path, seconds }) => {
		const card = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(element => element.getAttribute('data-basehalf-card-path') === path);
		const video = card?.querySelector('.bh-video-card[data-state="video"] video.bh-video-card-video');
		if (!(video instanceof HTMLVideoElement)) {
			return { error: 'The card has no video element' };
		}
		const event = name => new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(`no ${name} event within 10 s`)), 10_000);
			video.addEventListener(name, () => {
				clearTimeout(timer);
				resolve(undefined);
			}, { once: true });
		});
		try {
			if (video.readyState < 1) {
				await event('loadedmetadata');
			}
			const done = event('seeked');
			video.currentTime = seconds;
			await done;
		} catch (error) {
			return { error: String(error) };
		}
		return { currentTime: video.currentTime };
	}, { path: cardPath, seconds });
	if (seeked.error || Math.abs(seeked.currentTime - seconds) > 0.05) {
		throw new Error(`The card's player did not move to ${seconds} s: ${JSON.stringify(seeked)}`);
	}
}

// Captures a frame with the mouse (the menu of criterion 24): the menu that
// the click opens has no current item and no ring, and choosing a frame leaves
// no ring on Capture Frame.
export async function captureVideoCardFrame(page, frame, relativePath) {
	await page.locator('.basehalf-video-context-toolbar [data-video-action="captureFrame"]').click();
	const item = page.locator(`.basehalf-video-capture-menu [data-video-frame="${frame}"]`);
	await item.waitFor({ state: 'visible', timeout: 10_000 });
	await assertCanvasMenuOpenedByClick(page, '.basehalf-video-capture-menu', 'The menu of Capture Frame');
	await item.click();
	const afterChoice = await assertNoCanvasFocusRing(page, 'Capture Frame after a frame was chosen with the mouse');
	if (!afterChoice.element?.includes('basehalf-video-capture-action')) {
		throw new Error(`Choosing a frame must give the focus back to Capture Frame: ${JSON.stringify(afterChoice)}`);
	}
	await waitUntil(() => fs.existsSync(videoWorkspaceFile(relativePath)), `Capture Frame to write ${relativePath}`, 20_000);
	await waitUntil(() => readCanvasCardGeometry(readVideoCanvasLayout(), relativePath) !== undefined, `the card of ${relativePath} to get a place`, 10_000);
	await videoCanvasCard(page, relativePath).waitFor({ state: 'attached', timeout: 15_000 });
}

// The card and its panel relative to the canvas, which the scene places the panel in.
export function readVideoPanelGeometry(page, cardPath) {
	return page.evaluate(path => {
		const flow = document.querySelector('.basehalf-canvas-cards .react-flow');
		const node = Array.from(document.querySelectorAll('.react-flow__node')).find(element => element.getAttribute('data-id') === path);
		const surface = Array.from(document.querySelectorAll('.basehalf-canvas-video-panel-surface')).find(element => element.getAttribute('data-basehalf-card-path') === path);
		if (!flow || !node || !surface) {
			return null;
		}
		const origin = flow.getBoundingClientRect();
		const relative = rect => ({ left: rect.left - origin.left, top: rect.top - origin.top, right: rect.right - origin.left, bottom: rect.bottom - origin.top, width: rect.width, height: rect.height });
		return {
			host: { width: flow.clientWidth, height: flow.clientHeight },
			card: relative(node.getBoundingClientRect()),
			panel: relative(surface.getBoundingClientRect()),
			placement: surface.getAttribute('data-panel-placement'),
			visible: surface.getAttribute('data-visible'),
			visibility: getComputedStyle(surface).visibility,
			moving: surface.getAnimations().some(animation => animation.playState !== 'finished') || !['none', '0px', '0px 0px'].includes(getComputedStyle(surface).translate)
		};
	}, cardPath);
}

// Draws a connection from the east handle of `sourcePath` to the west handle
// of `targetPath`; the target stores it in its upstream list.
export async function drawCanvasConnectionInto(page, sourcePath, targetPath) {
	await startCanvasConnectionDrag(page, sourcePath);
	const target = await page.locator(`.react-flow__node[data-id="${targetPath}"] > .basehalf-canvas-card-connect-handle.west`).boundingBox();
	if (!target) {
		await page.mouse.up();
		throw new Error(`The card ${targetPath} has no west connection handle`);
	}
	await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
	await page.waitForFunction(() => document.querySelector('.react-flow__connection-path') !== null, null, { timeout: 10_000 });
	await page.mouse.up();
}

export async function replaceVideoPrompt(page, panel, text) {
	await panel.locator('textarea.bh-video-panel-prompt-input').click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
	await page.keyboard.type(text);
	await waitForReading(() => readVideoPanel(panel), seen => seen.prompt === text, `the prompt to read ${text}`);
}

// Clicks Generate and waits until the node's new task ends or its video arrives.
export async function generateVideoUntilEnded(page, panel, cardPath) {
	const provider = await videoSmokeProvider();
	await waitForReading(() => readVideoPanel(panel), seen => seen.generate?.disabled === false && !seen.generate.stop, 'Generate to be enabled');
	const previousTask = readVideoNode(cardPath).task?.id;
	const requestsBefore = provider.mock.requests.length;
	const recording = recordVideoNodeStates(videoWorkspaceFile(cardPath), document => document.result !== undefined
		|| (document.task?.id !== previousTask && ['failed', 'stopped'].includes(document.task?.state)), VIDEO_GENERATION_TIMEOUT_MS);
	await panel.locator('button.bh-video-panel-generate').click();
	const { states, document } = await recording;
	return {
		states: states.filter(state => state.state !== 'idle' && (previousTask === undefined || state.taskId !== previousTask)),
		document,
		requestsBefore,
		requests: provider.requestsSince(requestsBefore)
	};
}

// The JSON line a command printed in the active Agent Area terminal, with
// the rows a long line wraps onto joined.
export async function readAgentAreaTerminalJson(page, marker) {
	const line = await waitForReading(() => page.evaluate(expected => {
		const wrapper = document.querySelector('.basehalf-agent-area-session.active.kind-terminal .terminal-wrapper');
		const buffer = wrapper?.xterm?.buffer?.active;
		if (!buffer) {
			return null;
		}
		const lines = [];
		for (let index = 0; index < buffer.length; index++) {
			const row = buffer.getLine(index);
			const text = row?.translateToString(true) ?? '';
			if (row?.isWrapped && lines.length) {
				lines[lines.length - 1] += text;
			} else {
				lines.push(text);
			}
		}
		return lines.reverse().find(text => text.trimStart().startsWith('{') && text.includes(expected)) ?? null;
	}, marker), found => typeof found === 'string', 'the Agent Area terminal to print the answer of basehalf --run-node', 30_000);
	return JSON.parse(line.trim());
}
