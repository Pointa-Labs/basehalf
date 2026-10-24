/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Reading and driving generation cards (D63, D64): their files and card
// information, the task records of this computer, the card, its panel and
// menus, its player and toolbar, and the Agent Area's terminal.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { solidPng } from './videoProvider.mts';
import { workspacePath } from '../../context.mts';
import { waitForAgentAreaTerminalPrompt } from '../../lib/agentArea.mts';
import {
	assertCanvasMenuOpenedByClick,
	assertNoCanvasFocusRing,
	emptyCanvasPoint,
	panCanvasCardTo,
	readCanvasCardGeometry,
	startCanvasConnectionDrag,
	waitForCanvasCardSelection
} from '../../lib/canvas.mts';
import { runCommand } from '../../lib/quickInput.mts';
import { waitForReading, waitUntil } from '../../lib/steps.mts';

// The folder of the generation card steps, with two images and a note to
// connect, against the local test provider.
export const GENERATION_FOLDER = 'generation-smoke';
export const START_IMAGE = `${GENERATION_FOLDER}/start.png`;
export const END_IMAGE = `${GENERATION_FOLDER}/end.png`;
// A note whose text joins the prompt of a card it is connected to, without its front matter.
export const SCENE_NOTE = `${GENERATION_FOLDER}/scene.md`;
export const SCENE_NOTE_TEXT = 'The light is low and golden.';
const SCENE_NOTE_CONTENT = `---\ntags:\n  - smoke\n---\n# Scene\n\n${SCENE_NOTE_TEXT}\n`;
export const GENERATION_TIMEOUT_MS = 60_000;

// --- the folder ----------------------------------------------------------------------------------

export function createGenerationSmokeFolder() {
	const folder = path.join(workspacePath, GENERATION_FOLDER);
	fs.mkdirSync(folder, { recursive: true });
	// Large enough for the provider's image limits (each side at least 300 px).
	fs.writeFileSync(path.join(folder, 'start.png'), solidPng(640, 360, [37, 99, 235]));
	fs.writeFileSync(path.join(folder, 'end.png'), solidPng(640, 360, [245, 158, 11]));
	fs.writeFileSync(path.join(folder, 'scene.md'), SCENE_NOTE_CONTENT, 'utf8');
	// The images and the note lie at the left, one above the other.
	const mirror = path.join(workspacePath, '.bh', 'mirror', GENERATION_FOLDER);
	fs.mkdirSync(mirror, { recursive: true });
	fs.writeFileSync(path.join(mirror, 'canvas.yaml'), [
		`path: "${GENERATION_FOLDER}"`,
		'size:',
		'  width: 2400',
		'  height: 1600',
		'cards:',
		...[[START_IMAGE, 0], [END_IMAGE, 300], [SCENE_NOTE, 600]].flatMap(([cardPath, y]) => [
			`  - path: "${cardPath}"`,
			'    kind: file',
			'    x: 0',
			`    y: ${y}`,
			'    width: 300',
			'    height: 220'
		]),
		'edges: []',
		''
	].join('\n'), 'utf8');
}

export function workspaceFile(relativePath) {
	return path.join(workspacePath, ...relativePath.split('/'));
}

/** The folder of a card's card information: `.bh/mirror/<path>/`. */
export function mirrorFolder(relativePath) {
	return path.join(workspacePath, '.bh', 'mirror', ...relativePath.split('/'));
}

export function readTextIfThere(file) {
	try {
		return fs.readFileSync(file, 'utf8');
	} catch {
		return undefined;
	}
}

/**
 * Reads the YAML that BaseHalf writes for card information: top-level
 * `key: value` lines, where a value is JSON (a quoted string, a number, a
 * boolean, `{}` or `[]`), a map of such values indented by two spaces under
 * `key:`, or a list of them as `  - value` lines. That is all that
 * `generation.yaml`, `made.yaml`, and `upstream.yaml` hold as BaseHalf writes
 * them; what the smoke writes as an agent has the same form.
 */
export function readCardYaml(text) {
	if (text === undefined) {
		return undefined;
	}
	const value = raw => {
		const trimmed = raw.trim();
		try {
			return JSON.parse(trimmed);
		} catch {
			return trimmed;
		}
	};
	const record = {};
	let open;
	for (const line of text.split(/\r?\n/)) {
		if (!line.trim() || line.trimStart().startsWith('#')) {
			continue;
		}
		const item = /^ {2}- (.*)$/.exec(line);
		const entry = /^ {2}([^:\s][^:]*):\s?(.*)$/.exec(line);
		const top = /^([^\s:][^:]*):\s?(.*)$/.exec(line);
		if (item && open) {
			if (!Array.isArray(record[open])) {
				record[open] = [];
			}
			record[open].push(value(item[1]));
		} else if (entry && open) {
			if (Array.isArray(record[open]) || typeof record[open] !== 'object' || record[open] === null) {
				record[open] = {};
			}
			record[open][entry[1]] = value(entry[2]);
		} else if (top) {
			open = top[2].trim() === '' ? top[1] : undefined;
			record[top[1]] = open ? null : value(top[2]);
		} else {
			throw new Error(`Not the YAML BaseHalf writes for card information: ${JSON.stringify(line)}`);
		}
	}
	return record;
}

/** A card's `generation.yaml`, read; `undefined` when there is none. */
export function readGenerationInfo(relativePath) {
	return readCardYaml(readTextIfThere(path.join(mirrorFolder(relativePath), 'generation.yaml')));
}

/** A card's `made.yaml`, read; `undefined` when there is none. */
export function readMade(relativePath) {
	return readCardYaml(readTextIfThere(path.join(mirrorFolder(relativePath), 'made.yaml')));
}

/** The entries of a card's `upstream.yaml`, in order; `undefined` when there is none. */
export function readUpstreamSidecar(relativePath) {
	const record = readCardYaml(readTextIfThere(path.join(mirrorFolder(relativePath), 'upstream.yaml')));
	return record === undefined ? undefined : Array.isArray(record.upstream) ? record.upstream : [];
}

/** The files of a card's card information: the files in its folder under `.bh/mirror/`, by name. */
export function cardInformationFiles(relativePath) {
	const folder = mirrorFolder(relativePath);
	try {
		return fs.readdirSync(folder).filter(name => fs.statSync(path.join(folder, name)).isFile()).sort();
	} catch {
		return [];
	}
}

/** Writes a card's `generation.yaml` as an agent writes it, in the form BaseHalf writes. */
export function writeGenerationInfo(relativePath, info) {
	const lines = [`prompt: ${JSON.stringify(info.prompt ?? '')}`];
	for (const key of ['provider', 'model', 'mode']) {
		if (info[key] !== undefined) {
			lines.push(`${key}: ${JSON.stringify(info[key])}`);
		}
	}
	if (info.params && Object.keys(info.params).length) {
		lines.push('params:', ...Object.keys(info.params).sort().map(name => `  ${name}: ${JSON.stringify(info.params[name])}`));
	}
	fs.mkdirSync(mirrorFolder(relativePath), { recursive: true });
	fs.writeFileSync(path.join(mirrorFolder(relativePath), 'generation.yaml'), `${lines.join('\n')}\n`, 'utf8');
}

/** Writes a card's `upstream.yaml` as an agent writes it. */
export function writeUpstreamSidecar(relativePath, entries) {
	fs.mkdirSync(mirrorFolder(relativePath), { recursive: true });
	fs.writeFileSync(path.join(mirrorFolder(relativePath), 'upstream.yaml'), ['upstream:', ...entries.map(entry => `  - ${entry}`), ''].join('\n'), 'utf8');
}

export function readCanvasLayout(folder = GENERATION_FOLDER) {
	return fs.readFileSync(path.join(workspacePath, '.bh', 'mirror', ...folder.split('/').filter(Boolean), 'canvas.yaml'), 'utf8');
}

/** The saved place of a card on the canvas of `folder`. */
export function readCardRow(cardPath, folder = GENERATION_FOLDER) {
	return readCanvasCardGeometry(readCanvasLayout(folder), cardPath);
}

// JSON with its keys sorted, to compare records whatever order they were written in.
export function canonicalJson(value) {
	return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
		? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]))
		: item);
}

// --- task records ---------------------------------------------------------------------------------

export const TASK_RECORD_FOLDER = path.join(workspacePath, '.bh', 'cache', 'generation');

/** The task records of this computer, parsed, by task id. A record caught between two writes is left out. */
export function readTaskRecords() {
	const records = new Map();
	let names;
	try {
		names = fs.readdirSync(TASK_RECORD_FOLDER);
	} catch {
		return records;
	}
	for (const name of names) {
		if (!name.endsWith('.json')) {
			continue;
		}
		try {
			const record = JSON.parse(fs.readFileSync(path.join(TASK_RECORD_FOLDER, name), 'utf8'));
			if (record && typeof record.id === 'string') {
				records.set(record.id, record);
			}
		} catch {
			// Not there any more, or caught between two writes.
		}
	}
	return records;
}

/** The newest task record that names a card, if there is one. */
export function taskRecordOf(cardPath) {
	return [...readTaskRecords().values()].filter(record => record.cards?.some(card => card.path === cardPath)).sort((a, b) => a.id < b.id ? 1 : -1)[0];
}

/**
 * The name of a file that is part of a file being written: a partial
 * download, a temporary file of a write, or the staging of an exclusive
 * create. None may be in the folder of a card while its files land
 * (generation cards, criterion 1).
 */
export const PARTIAL_FILE_NAME = /\.part$|\.basehalf-tmp$|^\..+\.exclusive\.[0-9a-f-]+$/;

// Every partial file a watch saw in the folder of a card, by its workspace-relative path.
const partialFilesSeen = new Set();

/** The partial files that any watch of this run saw in the folder of a card, by their workspace-relative paths. */
export function partialFilesSeenInCardFolders() {
	return [...partialFilesSeen].sort();
}

/**
 * Watches the task records of this computer and the files of `folders`
 * every 10 ms from now on, beside the steps that drive the window: each
 * record that appears is followed through every state it shows, with the
 * provider's task id, its follower, and the states of its cards, until it is
 * removed; each name that appears in the folders is kept, also one that is
 * there only between two readings, as the file system reports it. A partial
 * file among them is kept for the whole run as well. `until` waits for a
 * condition on what was seen.
 */
export function watchGenerations(folders = [GENERATION_FOLDER]) {
	const before = new Set(readTaskRecords().keys());
	const tasks = new Map();
	const names = new Map(folders.map(folder => [folder, new Set()]));
	let stopped = false;
	const see = (folder, name) => {
		names.get(folder)?.add(name);
		if (PARTIAL_FILE_NAME.test(name)) {
			partialFilesSeen.add(`${folder}/${name}`);
		}
	};
	const watchers = [];
	for (const folder of folders) {
		try {
			const watcher = fs.watch(workspaceFile(folder), (_event, name) => {
				// The folder itself is reported by its own name when it changes.
				if (typeof name === 'string' && name && !name.includes('/') && name !== path.basename(folder)) {
					see(folder, name);
				}
			});
			// A step that fails leaves no watch that keeps the run from ending.
			watcher.unref();
			watchers.push(watcher);
		} catch {
			// The folder is not there yet: its names are read at each reading.
		}
	}
	const tick = () => {
		const records = readTaskRecords();
		for (const [id, record] of records) {
			if (before.has(id)) {
				continue;
			}
			let seen = tasks.get(id);
			if (!seen) {
				seen = { id, states: [], removed: false, record };
				tasks.set(id, seen);
			}
			seen.record = record;
			const state = { state: record.state, remoteId: record.remoteId, follower: record.follower, cards: (record.cards ?? []).map(card => `${card.path}:${card.state}`).join(' ') };
			const last = seen.states.at(-1);
			if (!last || last.state !== state.state || last.remoteId !== state.remoteId || last.cards !== state.cards || last.follower !== state.follower) {
				seen.states.push(state);
			}
		}
		for (const seen of tasks.values()) {
			seen.removed = !records.has(seen.id);
		}
		for (const folder of names.keys()) {
			try {
				for (const name of fs.readdirSync(workspaceFile(folder))) {
					see(folder, name);
				}
			} catch {
				// The folder is not there now.
			}
		}
	};
	tick();
	const timer = setInterval(tick, 10);
	timer.unref();
	const watch = {
		/** The records that appeared since the watch started, in the order they appeared. */
		tasks: () => [...tasks.values()],
		/** The record that appeared first. */
		first: () => [...tasks.values()][0],
		/** Every name seen in a folder since the watch started. */
		names: folder => [...(names.get(folder) ?? [])].sort(),
		stop: () => {
			if (!stopped) {
				stopped = true;
				clearInterval(timer);
				for (const watcher of watchers) {
					watcher.close();
				}
			}
		},
		describe: () => JSON.stringify(watch.tasks().map(seen => ({ id: seen.id, states: seen.states, removed: seen.removed, error: seen.record?.error, cards: seen.record?.cards }))),
		async until(accept, description, timeoutMs = GENERATION_TIMEOUT_MS) {
			try {
				await waitUntil(() => {
					tick();
					return accept(watch);
				}, description, timeoutMs);
			} catch (error) {
				watch.stop();
				throw new Error(`${error instanceof Error ? error.message : String(error)}; the records went through ${watch.describe()}`);
			}
			return watch;
		}
	};
	return watch;
}

/** The states a record went through, in order, each once. */
export function statesOf(seen) {
	const states = [];
	for (const state of seen?.states ?? []) {
		if (states.at(-1) !== state.state) {
			states.push(state.state);
		}
	}
	return states;
}

/**
 * Makes the record of a generation look as it does when the window that
 * follows it last said it was alive two minutes ago: a window takes a
 * generation over only when that has not happened for 90 seconds
 * (generation cards, "The task record"). The record is written whole, by a
 * rename, as BaseHalf writes it.
 */
export function ageTaskRecord(taskId, milliseconds = 120_000) {
	const file = path.join(TASK_RECORD_FOLDER, `${taskId}.json`);
	const record = JSON.parse(fs.readFileSync(file, 'utf8'));
	const aged = { ...record, aliveAt: new Date(Date.parse(record.aliveAt) - milliseconds).toISOString() };
	const temporary = path.join(path.dirname(TASK_RECORD_FOLDER), `${taskId}.${process.pid}.smoke`);
	fs.writeFileSync(temporary, `${JSON.stringify(aged, undefined, '\t')}\n`, 'utf8');
	fs.renameSync(temporary, file);
	return aged;
}

// --- the canvas -----------------------------------------------------------------------------------

export function assertSameCanvasView(before, after, what) {
	if (Math.abs(before.x - after.x) > 0.5 || Math.abs(before.y - after.y) > 0.5 || Math.abs(before.zoom - after.zoom) > 0.001) {
		throw new Error(`${what} must not pan or zoom the canvas: ${JSON.stringify({ before, after })}`);
	}
}

export function canvasCard(page, cardPath) {
	return page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${cardPath}"]`);
}

export function generationPanel(page, cardPath) {
	return page.locator(`.basehalf-canvas-video-panel-surface[data-basehalf-card-path="${cardPath}"] .bh-video-panel`);
}

// Clicks a point of the card that is on top: a panel, a toolbar, or another
// card can lie over part of it. Not its name, whose double click edits it,
// and not the controls of its player.
export async function clickCanvasCardOnTop(page, cardPath) {
	await page.mouse.click(...await canvasCardPointOnTop(page, cardPath));
}

/** A point of the card's body that nothing else covers, such as a panel, as `[x, y]`. */
export async function canvasCardPointOnTop(page, cardPath) {
	const point = await page.evaluate(path => {
		const card = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(element => element.getAttribute('data-basehalf-card-path') === path);
		const rect = card?.getBoundingClientRect();
		if (!card || !rect) {
			return undefined;
		}
		for (const [x, y] of [[0.5, 0.5], [0.3, 0.5], [0.7, 0.5], [0.5, 0.3], [0.5, 0.7], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) {
			const point = { x: rect.left + rect.width * x, y: rect.top + rect.height * y };
			const hit = document.elementFromPoint(point.x, point.y);
			if (hit && card.contains(hit) && !hit.closest('.basehalf-canvas-card-caption, .nodrag')) {
				return point;
			}
		}
		return undefined;
	}, cardPath);
	if (!point) {
		throw new Error(`No part of the card ${cardPath} is on top to click`);
	}
	return [point.x, point.y];
}

export async function clickBlankCanvas(page) {
	const point = await emptyCanvasPoint(page);
	await page.mouse.click(point.x, point.y);
	await waitForReading(() => page.locator('.react-flow__node.selected').count(), count => count === 0, 'a click on the blank canvas to end the selection');
}

/**
 * Pans the canvas, as the user does, until the card is inside it, when it is
 * not, or always with `always`: then the card is at the top, in the middle.
 * The cards of the steps go to the right of each other, and a step can leave
 * the view elsewhere.
 */
export async function showCardOnCanvas(page, cardPath, always = false) {
	const card = canvasCard(page, cardPath);
	const canvas = await page.locator('.basehalf-canvas-cards').boundingBox();
	const box = await card.boundingBox();
	if (!canvas || !box) {
		throw new Error(`The card ${cardPath} must be on the canvas: ${JSON.stringify({ canvas, box })}`);
	}
	// Clear of the edges, and of the zoom controls along the bottom.
	const inside = box.x >= canvas.x + 12 && box.y >= canvas.y + 12 && box.x + box.width <= canvas.x + canvas.width - 12 && box.y + box.height <= canvas.y + canvas.height - 60;
	if (always || !inside) {
		await panCanvasCardTo(page, card, { x: Math.round(canvas.x + (canvas.width - Math.min(box.width, canvas.width - 24)) / 2), y: Math.round(canvas.y + Math.max(12, (canvas.height - box.height) / 4)) });
	}
}

export async function selectGenerationCard(page, cardPath) {
	const selected = await page.evaluate(path => Array.from(document.querySelectorAll('.basehalf-canvas-card'))
		.find(card => card.getAttribute('data-basehalf-card-path') === path)?.closest('.react-flow__node')?.classList.contains('selected') === true, cardPath);
	if (!selected) {
		// The panel of another selected card can lie over this one.
		if (await page.locator('.basehalf-canvas-video-panel-surface').count() !== 0) {
			await clickBlankCanvas(page);
		}
		await showCardOnCanvas(page, cardPath);
		await clickCanvasCardOnTop(page, cardPath);
	}
	await waitForCanvasCardSelection(page, cardPath, 15_000);
	return waitForGenerationPanel(page, cardPath);
}

// The panel of the selected generation card, once the scene shows it and it has read its card.
export async function waitForGenerationPanel(page, cardPath, timeoutMs = 15_000) {
	await waitForReading(() => page.evaluate(path => {
		const surfaces = Array.from(document.querySelectorAll('.basehalf-canvas-video-panel-surface'));
		const surface = surfaces.find(element => element.getAttribute('data-basehalf-card-path') === path);
		return {
			surfaces: surfaces.map(element => element.getAttribute('data-basehalf-card-path')),
			visible: surface?.getAttribute('data-visible') ?? null,
			state: surface?.querySelector('.bh-video-panel')?.getAttribute('data-state') ?? null
		};
	}, cardPath), seen => seen.visible === 'true' && seen.state === 'ready', `the panel of ${cardPath} to show`, timeoutMs);
	return generationPanel(page, cardPath);
}

/**
 * What a card shows: whether it is a generation card and of which kind, a
 * draft or a file; its face while it has no file it can show (its state, the
 * phase, the time, the progress bar, and the message); its image or its
 * video; and its name.
 */
export function readGenerationCard(page, cardPath) {
	return page.evaluate(path => {
		const card = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(element => element.getAttribute('data-basehalf-card-path') === path);
		if (!card) {
			return null;
		}
		const face = card.querySelector('.bh-generation-card');
		const bar = face?.querySelector('.bh-generation-card-progress');
		const image = card.querySelector('img.basehalf-canvas-card-media-visual');
		const video = card.querySelector('.basehalf-canvas-video-player video');
		return {
			generation: card.getAttribute('data-generation'),
			kind: card.getAttribute('data-generation-kind'),
			name: card.querySelector('.basehalf-canvas-card-label')?.textContent ?? null,
			selected: card.closest('.react-flow__node')?.classList.contains('selected') === true,
			face: face ? {
				kind: face.getAttribute('data-kind'),
				state: face.getAttribute('data-state'),
				glyph: (face.querySelector('.bh-generation-card-glyph')?.childElementCount ?? 0) > 0,
				phase: face.querySelector('.bh-generation-card-phase')?.textContent ?? null,
				elapsed: face.querySelector('.bh-generation-card-elapsed')?.textContent ?? null,
				progress: bar ? { indeterminate: bar.classList.contains('indeterminate'), value: bar.querySelector('.bh-generation-card-progress-value')?.getAttribute('aria-valuenow') ?? bar.getAttribute('aria-valuenow') } : null,
				message: face.querySelector('.bh-generation-card-message')?.textContent ?? null,
				label: face.getAttribute('aria-label')
			} : null,
			image: image instanceof HTMLImageElement ? { complete: image.complete, width: image.naturalWidth, height: image.naturalHeight } : null,
			video: video instanceof HTMLVideoElement ? { readyState: video.readyState, width: video.videoWidth, height: video.videoHeight, error: video.error?.message ?? null } : null
		};
	}, cardPath);
}

/**
 * Samples a card's face every frame inside the window, so that a phase that
 * shows for a moment is seen; `stop` returns the phases in the order they
 * first showed, and the states of the card, each with the milliseconds it
 * showed for.
 */
export async function sampleCardPhases(page, cardPath) {
	await page.evaluate(path => {
		const sampled = { phases: [], states: [], running: true, frames: 0 };
		globalThis.__bhGenerationPhases = sampled;
		const tick = now => {
			const card = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(element => element.getAttribute('data-basehalf-card-path') === path);
			const face = card?.querySelector('.bh-generation-card');
			const phase = face?.querySelector('.bh-generation-card-phase')?.textContent;
			const state = face?.getAttribute('data-state') ?? (card?.querySelector('.basehalf-canvas-video-player, img.basehalf-canvas-card-media-visual') ? 'file' : card ? 'empty' : 'none');
			if (phase && sampled.phases.at(-1) !== phase) {
				sampled.phases.push(phase);
			}
			if (sampled.states.at(-1)?.state !== state) {
				sampled.states.push({ state, from: now, to: now });
			} else {
				sampled.states.at(-1).to = now;
			}
			sampled.frames++;
			if (sampled.running && sampled.frames < 20_000) {
				requestAnimationFrame(tick);
			}
		};
		requestAnimationFrame(tick);
	}, cardPath);
	return {
		stop: () => page.evaluate(() => {
			const sampled = globalThis.__bhGenerationPhases;
			sampled.running = false;
			return { phases: sampled.phases, states: sampled.states.map(entry => ({ state: entry.state, ms: Math.round(entry.to - entry.from) })), frames: sampled.frames };
		})
	};
}

// --- the panel --------------------------------------------------------------------------------------

export function readGenerationPanel(panel) {
	return panel.evaluate(element => {
		const text = selector => element.querySelector(selector)?.textContent?.trim() ?? null;
		// The prompt's text, its chips as their names (D68).
		const prompt = element.querySelector('.bh-prompt-editor');
		const generate = element.querySelector('button.bh-video-panel-generate');
		const tile = input => ({
			kind: input.getAttribute('data-kind'),
			name: input.getAttribute('data-label'),
			path: input.getAttribute('data-path'),
			number: input.querySelector('.bh-input-tile-number')?.textContent ?? null,
			dimmed: input.classList.contains('dimmed')
		});
		const frame = role => {
			const slot = element.querySelector(`.bh-input-tile[data-frame="${role}"][data-path]`);
			return slot ? tile(slot) : null;
		};
		const reason = element.querySelector('.bh-video-panel-reason');
		const action = element.querySelector('.bh-video-panel-reason-action');
		const notice = element.querySelector('.bh-video-panel-notice');
		return {
			kind: element.getAttribute('data-kind'),
			state: element.getAttribute('data-state'),
			catalog: element.getAttribute('data-catalog'),
			notice: notice && !notice.hidden ? notice.textContent : null,
			reason: reason && !reason.hidden ? { text: reason.querySelector('.bh-video-panel-reason-text')?.textContent ?? null, action: action && !action.hidden ? action.textContent : null } : null,
			prompt: prompt ? (prompt.textContent ?? '').replaceAll('\u200b', '') : null,
			promptFocused: !!prompt && element.ownerDocument.activeElement === prompt,
			model: text('.bh-video-panel-model-label'),
			modelOutlined: element.querySelector('.bh-video-panel-model')?.classList.contains('outlined') ?? false,
			settings: text('.bh-video-panel-settings-label'),
			generate: generate ? {
				disabled: generate.getAttribute('aria-disabled') === 'true',
				label: generate.getAttribute('aria-label'),
				stop: generate.classList.contains('stop')
			} : null,
			emptySlots: Array.from(element.querySelectorAll('.bh-input-tile.empty')).map(slot => slot.getAttribute('data-frame')),
			start: frame('start'),
			end: frame('end'),
			// Every tile, the frames among them, in the order the row shows them.
			inputs: Array.from(element.querySelectorAll('.bh-input-tile[data-path]')).map(tile),
			names: Array.from(element.querySelectorAll('.bh-prompt-chip, .bh-prompt-name')).map(name => ({
				text: name.classList.contains('bh-prompt-chip') ? name.getAttribute('data-name') : name.textContent,
				known: name.classList.contains('bh-prompt-chip'),
				underlined: getComputedStyle(name).textDecorationLine.includes('underline')
			}))
		};
	}, undefined, { timeout: 2_000 });
}

/**
 * The panel of a card with its file (D67): what made it, read only. Its
 * inputs as its tiles name them (`Start: Image 1`, a text input by its
 * file's name), the gone ones among them, the prompt with its chips as their
 * names (D68), the line under it, the model and the settings as text, its
 * buttons, and how many of its parts take typing.
 */
export function readRecordPanel(panel) {
	return panel.evaluate(element => {
		const shown = selector => {
			const found = element.querySelector(selector);
			return found && !found.closest('[hidden]') ? found.textContent : null;
		};
		const nameOf = tile => {
			const name = tile.getAttribute('data-label') ?? tile.querySelector('.bh-input-tile-caption')?.textContent ?? tile.getAttribute('data-path');
			const frame = tile.getAttribute('data-frame');
			return frame ? `${frame === 'start' ? 'Start' : 'End'}: ${name}` : name;
		};
		const tiles = Array.from(element.querySelectorAll('.bh-input-tile[data-path]')).filter(tile => !tile.closest('[hidden]'));
		const prompt = element.querySelector('.bh-prompt-editor');
		const promptText = prompt ? (prompt.textContent ?? '').replaceAll('\u200b', '') : null;
		return {
			record: element.classList.contains('bh-record-panel'),
			state: element.getAttribute('data-state'),
			readable: element.getAttribute('data-record') === 'readable',
			kind: element.getAttribute('data-kind'),
			notice: shown('.bh-video-panel-notice'),
			inputs: tiles.map(nameOf),
			gone: tiles.filter(tile => tile.classList.contains('dimmed')).map(nameOf),
			prompt: prompt && !prompt.closest('[hidden]') ? promptText : null,
			promptEmpty: promptText === null ? null : promptText === '',
			line: shown('.bh-record-panel-line'),
			model: shown('.bh-record-panel-model'),
			settings: shown('.bh-record-panel-settings'),
			buttons: Array.from(element.querySelectorAll('button')).filter(button => !button.closest('[hidden]')).map(button => button.textContent?.trim() ?? ''),
			fields: element.querySelectorAll('textarea, input, [contenteditable="true"], [contenteditable=""]').length
		};
	}, undefined, { timeout: 2_000 });
}

/** Waits until a warning of the canvas says `text`, as when it refuses a connection. */
export function waitForCanvasWarning(page, text, timeoutMs = 10_000) {
	return waitForReading(() => page.locator('.basehalf-canvas-warning').allInnerTexts().catch(() => []), warnings => warnings.some(warning => warning.includes(text)), `the canvas to say "${text}"`, timeoutMs);
}

/** Takes the warnings the canvas shows away, so that the next one a step waits for is a new one. */
export function clearCanvasWarnings(page) {
	return page.evaluate(() => {
		for (const warning of Array.from(document.querySelectorAll('.basehalf-canvas-warning'))) {
			warning.remove();
		}
	});
}

/** Disconnect: selects the edge `from` → `to` with the mouse, where no card covers it, and presses Delete on it. */
export async function deleteCanvasEdge(page, from, to) {
	const edgeId = `${from}${String.fromCharCode(0)}${to}`;
	const point = await page.evaluate(id => {
		const hit = Array.from(document.querySelectorAll('.basehalf-canvas-edge-hit')).find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === id);
		const ctm = hit instanceof SVGPathElement ? hit.getScreenCTM() : null;
		const total = hit instanceof SVGPathElement ? hit.getTotalLength() : 0;
		if (!(hit instanceof SVGPathElement) || !ctm || total <= 0) {
			return undefined;
		}
		for (let offset = 0; offset <= 0.45; offset += 0.01) {
			for (const ratio of offset === 0 ? [0.5] : [0.5 - offset, 0.5 + offset]) {
				const along = hit.getPointAtLength(total * ratio);
				const screen = new DOMPoint(along.x, along.y).matrixTransform(ctm);
				if (document.elementFromPoint(screen.x, screen.y) === hit) {
					return { x: screen.x, y: screen.y };
				}
			}
		}
		return undefined;
	}, edgeId);
	if (!point) {
		throw new Error(`No part of the edge ${from} → ${to} is on top to select`);
	}
	await page.mouse.click(point.x, point.y);
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-edge-hit.selected') !== null, null, { timeout: 10_000 });
	await page.evaluate(id => {
		const hit = Array.from(document.querySelectorAll('.basehalf-canvas-edge-hit')).find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === id);
		const wrapper = hit?.closest('.react-flow__edge');
		if (!(wrapper instanceof SVGElement)) {
			throw new Error('The selected edge has no element to take the keyboard');
		}
		wrapper.focus();
	}, edgeId);
	await page.keyboard.press('Delete');
}

export function readModelMenu(panel) {
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
					checked: item.getAttribute('aria-checked') === 'true',
					unavailable: item.classList.contains('unavailable'),
					description: item.getAttribute('aria-description')
				}))
			})),
			end: Array.from(menu.querySelectorAll(':scope > .bh-video-panel-menu-item')).map(label)
		} : null;
	}, undefined, { timeout: 2_000 });
}

export async function openModelMenu(panel) {
	await panel.locator('button.bh-video-panel-model').click();
	return waitForReading(() => readModelMenu(panel), seen => seen !== null && seen.groups.length > 0, 'the model menu to list the catalog\'s models');
}

export async function clickModel(page, panel, provider, model) {
	await panel.locator(`.bh-video-panel-menu.model .bh-video-panel-menu-item[data-key="model:${provider}:${model}"]`).click();
	await waitForReading(() => panel.locator('.bh-video-panel-menu.model').count(), count => count === 0, 'the model menu to close after a choice');
}

/** Opens the model menu of the panel, chooses a model, and waits for the card to store it. */
export async function chooseModel(page, panel, cardPath, provider, model) {
	await openModelMenu(panel);
	await clickModel(page, panel, provider, model);
	return waitForReading(() => readGenerationInfo(cardPath), info => info?.provider === provider && info.model === model, `${cardPath} to store the model ${model}`, 10_000);
}

// What the settings popover draws: its parameters, their choices, and what is chosen.
export function readSettingsPopover(panel) {
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
			advanced: Array.from(popover.querySelectorAll('.bh-video-panel-advanced .bh-video-panel-setting[data-parameter]')).map(section => section.getAttribute('data-parameter')),
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
export async function openSettings(panel) {
	await panel.locator('button.bh-video-panel-settings').click();
	return waitForReading(() => readSettingsPopover(panel), seen => seen !== null && seen.focusInside, 'the settings popover to open with the focus inside');
}

export async function closePanelMenu(page, panel, kind) {
	// An Escape that arrives before the focus does reaches nobody.
	await waitForReading(() => panel.evaluate((element, menuKind) => element.querySelector(`.bh-video-panel-menu.${menuKind}`)?.contains(element.ownerDocument.activeElement) === true, kind, { timeout: 2_000 }), inside => inside, `the keyboard focus to be in the ${kind} menu`);
	await page.keyboard.press('Escape');
	await waitForReading(() => panel.locator(`.bh-video-panel-menu.${kind}`).count(), count => count === 0, `Escape to close the ${kind} menu`);
}

/** Chooses a value in the open settings popover, which stays open, and waits for the card to store it. */
export async function chooseSetting(panel, cardPath, key, parameter, value) {
	await panel.locator(`.bh-video-panel-menu.settings [data-key="${key}"]`).click();
	await waitForReading(() => readSettingsPopover(panel), seen => seen?.checked.includes(key) === true, `the choice ${key} to be shown`);
	return waitForReading(() => readGenerationInfo(cardPath), info => String(info?.params?.[parameter]) === String(value), `${cardPath} to store ${key}`, 10_000);
}

// The reference menu that @ opened (D68): its rows, and whether its search field has the keyboard.
export function readMentionMenu(panel) {
	return panel.evaluate(element => {
		const menu = element.querySelector('.bh-reference-menu:not(.flyout)');
		return menu ? {
			searchFocused: element.ownerDocument.activeElement === menu.querySelector('.bh-reference-menu-search input'),
			options: Array.from(menu.querySelectorAll('.bh-reference-menu-option')).map(option => ({
				label: option.querySelector('.bh-reference-menu-label')?.textContent ?? null,
				file: option.querySelector('.bh-reference-menu-title')?.textContent ?? '',
				active: option.classList.contains('active'),
				dimmed: option.classList.contains('disabled')
			}))
		} : null;
	}, undefined, { timeout: 2_000 });
}

export async function replacePrompt(page, panel, text) {
	await panel.locator('.bh-prompt-editor').click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
	await page.keyboard.type(text);
	await waitForReading(() => readGenerationPanel(panel), seen => seen.prompt === text, `the prompt to read ${text}`);
}

/** Replaces the prompt and waits until the card's `generation.yaml` holds it. */
export async function savePrompt(page, panel, cardPath, text) {
	await replacePrompt(page, panel, text);
	await waitForReading(() => readGenerationInfo(cardPath), info => info?.prompt === text, `the prompt of ${cardPath} to be saved`, 10_000);
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

/** Clicks Generate once it is enabled. */
export async function clickGenerate(panel) {
	await waitForReading(() => readGenerationPanel(panel), seen => seen.generate?.disabled === false && !seen.generate.stop, 'Generate to be enabled');
	await panel.locator('button.bh-video-panel-generate').click();
}

// The card and its panel relative to the canvas, which the scene places the panel in.
export function readPanelGeometry(page, cardPath) {
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

/** Chooses Pick on Canvas from a plus of the panel's input row; the panel and the bar over the canvas say what a click does (D69). */
export async function startPickOnCanvas(page, panel, plus = 'button.bh-input-row-add') {
	await panel.locator(plus).click();
	const addMenu = panel.locator('.bh-video-panel-menu.add');
	await addMenu.waitFor({ state: 'visible', timeout: 10_000 });
	await addMenu.locator('.bh-video-panel-menu-item[data-key="pick"]').click();
	await panel.locator('.bh-input-row.picking .bh-input-row-hint[role="status"]').waitFor({ state: 'visible', timeout: 10_000 });
	await page.locator('.basehalf-canvas-pick-bar').waitFor({ state: 'visible', timeout: 10_000 });
}

/**
 * Connects `sourcePath` to the card of the panel with Pick on Canvas, from a
 * plus of its input row: picking stays on and shows the card as connected,
 * and Done ends it (D69).
 */
export async function pickInputOnCanvas(page, panel, sourcePath, plus = 'button.bh-input-row-add') {
	await startPickOnCanvas(page, panel, plus);
	await clickCanvasCardOnTop(page, sourcePath);
	await waitForReading(() => readCanvasPick(page), seen => seen?.cards[sourcePath] === 'remove', `Pick on Canvas to show ${sourcePath} as connected`);
	await page.locator('.basehalf-canvas-pick-done').click();
	await panel.locator('.bh-input-row.picking').waitFor({ state: 'detached', timeout: 10_000 });
	await page.locator('.basehalf-canvas-pick-bar').waitFor({ state: 'detached', timeout: 10_000 });
}

/**
 * What Pick on Canvas shows (D69): the bar over the canvas, what a click on
 * each card drawn does, and the label beside the pointer; null while it is off.
 */
export function readCanvasPick(page) {
	return page.evaluate(() => {
		const bar = document.querySelector('.basehalf-canvas-pick-bar');
		const marked = document.querySelectorAll('.basehalf-canvas-card[data-basehalf-pick]');
		if (!bar && !marked.length) {
			return null;
		}
		const cards = {};
		for (const card of document.querySelectorAll('.basehalf-canvas-card[data-basehalf-card-path]')) {
			cards[card.getAttribute('data-basehalf-card-path')] = card.getAttribute('data-basehalf-pick');
		}
		const label = document.querySelector('.basehalf-canvas-pick-label');
		return {
			title: bar?.querySelector('.basehalf-canvas-pick-title')?.textContent ?? null,
			done: bar?.querySelector('.basehalf-canvas-pick-done')?.textContent ?? null,
			cards,
			label: label instanceof HTMLElement && !label.hidden ? label.textContent : null
		};
	});
}

/**
 * Samples every frame of the card at `cardPath` while `run` runs: which
 * element and picture it is, what a click on it does, and whether the accent
 * outline of Pick on Canvas shows. Returns the frames with each run of equal
 * ones taken together.
 */
export async function sampleCardLooks(page, cardPath, run) {
	await page.evaluate(path => {
		const ids = new WeakMap();
		const id = element => {
			if (!element) {
				return 0;
			}
			if (!ids.has(element)) {
				ids.set(element, ids.size + 1);
			}
			return ids.get(element);
		};
		const token = window.__basehalfCardLooks = (window.__basehalfCardLooks ?? 0) + 1;
		window.__basehalfCardLookFrames = [];
		const sample = () => {
			if (window.__basehalfCardLooks !== token) {
				return;
			}
			const card = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(element => element.getAttribute('data-basehalf-card-path') === path);
			const shadow = card ? getComputedStyle(card).boxShadow : '';
			window.__basehalfCardLookFrames.push(`card ${id(card)} picture ${id(card?.querySelector('img, video'))} ${card?.getAttribute('data-basehalf-pick') ?? '-'} ${/^\S+\([^)]*\) 0px 0px 0px [1-9]/.test(shadow) ? 'outline' : 'plain'}`);
			requestAnimationFrame(sample);
		};
		requestAnimationFrame(sample);
	}, cardPath);
	let frames = [];
	try {
		await run();
	} finally {
		frames = await page.evaluate(() => {
			window.__basehalfCardLooks++;
			return window.__basehalfCardLookFrames;
		});
	}
	return frames.filter((frame, index) => frame !== frames[index - 1]);
}

/**
 * Moves the pointer over the card at `cardPath` and reads what the window
 * shows there: the pointer over its body and over its name, the label beside
 * the pointer, and whether the card is darkened with a check mark.
 */
export async function pointAtCanvasCard(page, cardPath) {
	const name = await page.evaluate(path => {
		const card = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(element => element.getAttribute('data-basehalf-card-path') === path);
		const rect = card?.querySelector('.basehalf-canvas-card-label')?.getBoundingClientRect();
		return rect ? { x: rect.left + Math.min(8, rect.width / 2), y: rect.top + rect.height / 2 } : undefined;
	}, cardPath);
	if (!name) {
		throw new Error(`The card ${cardPath} has no name to point at`);
	}
	await page.mouse.move(name.x, name.y, { steps: 4 });
	const overName = await page.evaluate(([x, y]) => getComputedStyle(document.elementFromPoint(x, y)).cursor, [name.x, name.y]);
	const [x, y] = await canvasCardPointOnTop(page, cardPath);
	const point = { x, y };
	await page.mouse.move(point.x, point.y, { steps: 4 });
	return page.evaluate(([path, x, y]) => {
		const card = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(element => element.getAttribute('data-basehalf-card-path') === path);
		const hit = document.elementFromPoint(x, y);
		const label = document.querySelector('.basehalf-canvas-pick-label');
		const mark = card ? getComputedStyle(card, '::before').content : 'none';
		const shade = card ? getComputedStyle(card, '::after').backgroundColor : '';
		return {
			onTop: !!card && !!hit && card.contains(hit),
			cursor: hit ? getComputedStyle(hit).cursor : null,
			label: label instanceof HTMLElement && !label.hidden ? label.textContent : null,
			checked: mark.includes('\u2713') && shade !== 'rgba(0, 0, 0, 0)' && shade !== ''
		};
	}, [cardPath, point.x, point.y]).then(seen => ({ ...seen, overName }));
}

// --- the player -----------------------------------------------------------------------------------

// Plays the card's video for a moment, muted, and reports what it played and
// which controls its player shows: `controls` is BaseHalf's, `native` the system's.
export function playCardVideo(page, cardPath) {
	return page.evaluate(async path => {
		const card = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(element => element.getAttribute('data-basehalf-card-path') === path);
		const player = card?.querySelector('.basehalf-canvas-video-player');
		const video = player?.querySelector('video');
		if (!(video instanceof HTMLVideoElement) || !(player instanceof HTMLElement)) {
			return { error: 'The card has no video player' };
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
		const played = { currentTime: video.currentTime, duration: video.duration, width: video.videoWidth, height: video.videoHeight, controls: player.dataset.controls === 'shown', native: video.controls, error: video.error?.message ?? null };
		video.pause();
		return played;
	}, cardPath);
}

// The card's video player: whether it is the one marked `kept`, whether it
// plays and with sound, where it is, and whether its controls show.
export function readCardVideoPlayer(page, cardPath) {
	return page.evaluate(path => {
		const card = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(element => element.getAttribute('data-basehalf-card-path') === path);
		const player = card?.querySelector('.basehalf-canvas-video-player');
		const video = player?.querySelector('video');
		if (!card || !(player instanceof HTMLElement) || !(video instanceof HTMLVideoElement)) {
			return null;
		}
		return {
			kept: video.dataset.smokePlayer === 'kept',
			selected: card.closest('.react-flow__node')?.classList.contains('selected') === true,
			paused: video.paused,
			muted: video.muted,
			time: video.currentTime,
			duration: video.duration,
			readyState: video.readyState,
			controls: player.dataset.controls ?? null,
			native: video.controls,
			sound: player.querySelector('.basehalf-canvas-video-player-button.sound')?.getAttribute('aria-label') ?? null
		};
	}, cardPath);
}

// A point of the card's picture clear of its controls, where nothing lies over it.
export async function cardVideoPicturePoint(page, cardPath) {
	const point = await page.evaluate(path => {
		const card = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(element => element.getAttribute('data-basehalf-card-path') === path);
		const player = card?.querySelector('.basehalf-canvas-video-player');
		const rect = player?.getBoundingClientRect();
		if (!player || !rect || rect.width === 0) {
			return undefined;
		}
		const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.45 };
		const hit = document.elementFromPoint(point.x, point.y);
		return hit && player.contains(hit) && !hit.closest('.nodrag') ? point : undefined;
	}, cardPath);
	if (!point) {
		throw new Error(`The picture of ${cardPath} is not on top at its middle`);
	}
	return point;
}

// The box of one of the player's controls, `sound`, `play`, `open`, or
// `slider`, when nothing lies over its middle.
export async function cardVideoControlBox(page, cardPath, control) {
	const box = await page.evaluate(({ path, control }) => {
		const card = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(element => element.getAttribute('data-basehalf-card-path') === path);
		const element = card?.querySelector(control === 'slider' ? '.basehalf-canvas-video-player-slider' : `.basehalf-canvas-video-player-button.${control}`);
		const rect = element?.getBoundingClientRect();
		if (!element || !rect || rect.width === 0) {
			return undefined;
		}
		const x = rect.left + rect.width / 2;
		const y = rect.top + rect.height / 2;
		const hit = document.elementFromPoint(x, y);
		return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, x, y, onTop: !!hit && element.contains(hit), hit: hit?.getAttribute('class') ?? hit?.tagName ?? null };
	}, { path: cardPath, control });
	if (!box || !box.onTop) {
		throw new Error(`The player of ${cardPath} must show its ${control} with nothing over it: ${JSON.stringify(box)}`);
	}
	return box;
}

// The pointer's shape at a point of the window: the cursor of what the point hits.
export function readCursorAt(page, point) {
	return page.evaluate(({ x, y }) => {
		const hit = document.elementFromPoint(x, y);
		return hit ? { cursor: getComputedStyle(hit).cursor, element: hit.getAttribute('class') ?? hit.tagName } : null;
	}, point);
}

// Moves the card's player to `seconds`, as the user does with its controls.
export async function seekCardVideo(page, cardPath, seconds) {
	const seeked = await page.evaluate(async ({ path, seconds }) => {
		const card = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(element => element.getAttribute('data-basehalf-card-path') === path);
		const video = card?.querySelector('.basehalf-canvas-video-player video');
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

// --- the toolbar ------------------------------------------------------------------------------------

/** The toolbar above the selected card: what it is for, and its actions in order. */
export function readCardToolbar(page) {
	return page.evaluate(() => {
		const toolbar = document.querySelector('.basehalf-video-context-toolbar');
		return toolbar ? {
			path: toolbar.getAttribute('data-node-path'),
			media: toolbar.getAttribute('data-media'),
			surface: toolbar.getAttribute('data-video-surface'),
			draft: toolbar.classList.contains('basehalf-video-draft-toolbar'),
			actions: Array.from(toolbar.querySelectorAll('[data-video-action]')).map(button => button.getAttribute('data-video-action')),
			labels: Array.from(toolbar.querySelectorAll('[data-video-action]')).map(button => button.getAttribute('aria-label'))
		} : null;
	});
}

// Captures a frame with the mouse (criterion 34): the menu that the click
// opens has no current item and no ring, and choosing a frame leaves no ring
// on Capture Frame.
export async function captureCardFrame(page, frame, relativePath) {
	await page.locator('.basehalf-video-context-toolbar [data-video-action="captureFrame"]').click();
	const item = page.locator(`.basehalf-video-capture-menu [data-video-frame="${frame}"]`);
	await item.waitFor({ state: 'visible', timeout: 10_000 });
	await assertCanvasMenuOpenedByClick(page, '.basehalf-video-capture-menu', 'The menu of Capture Frame');
	await item.click();
	const afterChoice = await assertNoCanvasFocusRing(page, 'Capture Frame after a frame was chosen with the mouse');
	if (!afterChoice.element?.includes('basehalf-video-capture-action')) {
		throw new Error(`Choosing a frame must give the focus back to Capture Frame: ${JSON.stringify(afterChoice)}`);
	}
	await waitUntil(() => fs.existsSync(workspaceFile(relativePath)), `Capture Frame to write ${relativePath}`, 20_000);
	await waitUntil(() => readCardRow(relativePath) !== undefined, `the card of ${relativePath} to get a place`, 10_000);
	await canvasCard(page, relativePath).waitFor({ state: 'attached', timeout: 15_000 });
}

// --- the Agent Area's terminal -------------------------------------------------------------------------

/** Opens a terminal in the Agent Area, with a settled shell prompt, and gives it the keyboard. */
export async function openAgentAreaTerminal(page) {
	const terminal = page.locator('.basehalf-agent-area-session.active.kind-terminal .xterm').first();
	if (!await terminal.isVisible().catch(() => false)) {
		await runCommand(page, 'Terminal: Create New Terminal');
		await page.locator('.basehalf-agent-area').waitFor({ state: 'visible', timeout: 20_000 });
		await terminal.waitFor({ state: 'visible', timeout: 20_000 });
	}
	await terminal.click();
	await waitForAgentAreaTerminalPrompt(page);
}

export async function closeAgentArea(page) {
	if (await page.locator('.basehalf-agent-area').isVisible().catch(() => false)) {
		await runCommand(page, 'Toggle Agent Area');
		await page.locator('.basehalf-agent-area').waitFor({ state: 'hidden', timeout: 15_000 });
	}
}

/**
 * Runs `basehalf --generate <path>` in the Agent Area's terminal, as an agent
 * does, and returns the one line of JSON it printed.
 */
export async function runGenerateInTerminal(page, cardPath) {
	await openAgentAreaTerminal(page);
	const marker = `"path":${JSON.stringify(cardPath)}`;
	const before = await readTerminalJsonLines(page, marker);
	await page.keyboard.insertText(`basehalf --generate ${shellQuoted(cardPath)}`);
	await page.keyboard.press('Enter');
	const line = await waitForReading(async () => (await readTerminalJsonLines(page, marker)).slice(before.length)[0], found => typeof found === 'string', `the Agent Area terminal to print the answer of basehalf --generate ${cardPath}`, 30_000);
	return JSON.parse(line.trim());
}

function shellQuoted(value) {
	return /^[\w./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

// The JSON lines a command printed in the active Agent Area terminal that hold
// `marker`, oldest first, with the rows a long line wraps onto joined.
function readTerminalJsonLines(page, marker) {
	return page.evaluate(expected => {
		const wrapper = document.querySelector('.basehalf-agent-area-session.active.kind-terminal .terminal-wrapper');
		const buffer = wrapper?.xterm?.buffer?.active;
		if (!buffer) {
			return [];
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
		return lines.filter(text => text.trimStart().startsWith('{') && text.includes(expected));
	}, marker);
}
