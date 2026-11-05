/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import process from 'process';

// Installs an agent extension in a packaged BaseHalf, on a new profile, as a user does: Agent
// Area, New Agent Session, the extension, and one click on Install, with no question after it
// (D122). A development host checks no signature of an extension, so that only a package shows
// whether this works. It needs the network, downloads about 150 MiB, and opens a window. It is
// not part of CI.

const appArgument = process.argv.indexOf('--app');
if (appArgument < 0 || !process.argv[appArgument + 1]) {
	throw new Error('Usage: npm run basehalf:package:agent-install -- --app <BaseHalf.app> [--agent claude|codex] [--shots <folder>]');
}
const app = path.resolve(process.argv[appArgument + 1]);
const executable = path.join(app, 'Contents', 'MacOS', path.basename(app, '.app'));
const port = 9400 + (process.pid % 400);
const argumentAfter = (name: string) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const agent = argumentAfter('--agent') ?? 'claude';
if (agent !== 'claude' && agent !== 'codex') {
	throw new Error(`Unknown agent: ${agent}`);
}
const menuLabel = agent === 'claude' ? 'Claude Code Extension' : 'Codex Extension';
const installLabel = `Install ${menuLabel}`;
const extensionFolderPrefix = agent === 'claude' ? 'anthropic.claude-code' : 'openai.chatgpt';
const shots = argumentAfter('--shots');

// The socket of a profile must stay under 103 characters, so the state is under .build.
const state = fs.mkdtempSync(path.join(path.dirname(import.meta.dirname), '.build', 'agent-install-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'basehalf-agent-install-'));
for (const folder of ['user/User', 'extensions', 'shared', 'home']) {
	fs.mkdirSync(path.join(state, folder), { recursive: true });
}
fs.writeFileSync(path.join(state, 'user', 'User', 'settings.json'), JSON.stringify({ 'update.mode': 'none', 'telemetry.telemetryLevel': 'off' }));
fs.writeFileSync(path.join(workspace, 'note.md'), '# A note\n');

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const environment: NodeJS.ProcessEnv = { VSCODE_CLI: '1', BASEHALF_SMOKE_AGENT_SKILL_HOME: path.join(state, 'home') };
for (const [key, value] of Object.entries(process.env)) {
	if (!/^(VSCODE_|ELECTRON_)/.test(key)) {
		environment[key] = value;
	}
}
const child = spawn(executable, [
	workspace,
	`--user-data-dir=${path.join(state, 'user')}`,
	`--extensions-dir=${path.join(state, 'extensions')}`,
	`--shared-data-dir=${path.join(state, 'shared')}`,
	`--remote-debugging-port=${port}`,
	'--skip-release-notes',
	'--skip-welcome',
	'--disable-telemetry',
	'--disable-experiments',
	'--disable-updates',
	'--disable-workspace-trust',
	'--use-inmemory-secretstorage',
	'--disable-backgrounding-occluded-windows',
	'--disable-renderer-backgrounding',
], { env: environment, stdio: 'ignore' });

const getJson = (url: string) => new Promise<{ type: string; url: string; webSocketDebuggerUrl: string }[]>((resolve, reject) => {
	http.get(url, response => {
		let body = '';
		response.on('data', chunk => body += chunk);
		response.on('end', () => {
			try {
				resolve(JSON.parse(body));
			} catch (error) {
				reject(error);
			}
		});
	}).on('error', reject);
});

async function run(): Promise<void> {
	let page: { webSocketDebuggerUrl: string } | undefined;
	const launched = Date.now();
	while (!page && Date.now() - launched < 90_000) {
		try {
			page = (await getJson(`http://127.0.0.1:${port}/json/list`)).find(target => target.type === 'page' && /workbench\.html/.test(target.url));
		} catch {
			// Not listening yet.
		}
		await sleep(200);
	}
	if (!page) {
		throw new Error('No window opened.');
	}

	const socket = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.onopen = resolve;
		socket.onerror = reject;
	});
	let nextId = 0;
	const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
	socket.onmessage = event => {
		const message = JSON.parse(String(event.data));
		const request = pending.get(message.id);
		if (request) {
			pending.delete(message.id);
			if (message.error) {
				request.reject(new Error(message.error.message));
			} else {
				request.resolve(message.result);
			}
		}
	};
	const send = (method: string, params: object = {}) => new Promise<any>((resolve, reject) => {
		const id = ++nextId;
		pending.set(id, { resolve, reject });
		socket.send(JSON.stringify({ id, method, params }));
	});
	const evaluate = async (expression: string) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.value;
	const until = async (expression: string, timeout: number, what: string) => {
		const start = Date.now();
		while (Date.now() - start < timeout) {
			const value = await evaluate(expression).catch(() => undefined);
			if (value) {
				return value;
			}
			await sleep(200);
		}
		throw new Error(`Timed out waiting for ${what}.`);
	};
	const center = (element: string) => `(() => { const e = ${element}; if (!e) { return null; } const r = e.getBoundingClientRect(); return r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`;
	const click = async ({ x, y }: { x: number; y: number }) => {
		await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
		await sleep(150);
		await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
		await sleep(60);
		await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
	};
	const press = async (key: string, keyCode: number, text?: string) => {
		await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, code: key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, text, unmodifiedText: text });
		await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
	};

	await send('Runtime.enable');
	await until(`performance.getEntriesByName('code/didStartWorkbench').length > 0`, 90_000, 'the workbench');
	await sleep(2500);

	if (!await evaluate(`!!document.querySelector('.basehalf-agent-new-tab')`)) {
		await send('Page.bringToFront');
		await press('F1', 112);
		await until(`(() => { const i = document.querySelector('.quick-input-widget input'); return !!i && i.offsetParent !== null; })()`, 8000, 'the command palette');
		await send('Input.insertText', { text: 'Toggle Agent Area' });
		await sleep(900);
		await press('Enter', 13, '\r');
		await until(`!!document.querySelector('.basehalf-agent-new-tab')`, 8000, 'the Agent Area');
		await sleep(800);
	}

	await click(await until(center(`document.querySelector('.basehalf-agent-new-tab')`), 15_000, 'New Agent Session'));
	await click(await until(center(`[...document.querySelectorAll('.monaco-menu .action-item')].find(item => item.textContent.trim().startsWith(${JSON.stringify(menuLabel)}))`), 8000, menuLabel));
	const shoot = async (name: string) => {
		if (shots) {
			fs.mkdirSync(shots, { recursive: true });
			const { data } = await send('Page.captureScreenshot', { format: 'png' });
			fs.writeFileSync(path.join(shots, `${name}.png`), Buffer.from(data, 'base64'));
		}
	};
	const installButton = await until(center(`[...document.querySelectorAll('button.basehalf-agent-session-state-retry')].find(button => button.textContent.trim() === ${JSON.stringify(installLabel)})`), 30_000, installLabel);
	await shoot(`${agent}-before-install`);
	await click(installButton);
	console.log(`Clicked ${installLabel}.`);

	const statePanel = `[...document.querySelectorAll('.basehalf-agent-area-session.kind-extension .basehalf-agent-session-state')].map(e => e.textContent.trim()).join(' ')`;
	const started = Date.now();
	while (Date.now() - started < 300_000) {
		const dialog: string = await evaluate(`document.querySelector('.monaco-dialog-box')?.textContent.trim().slice(0, 300) ?? ''`).catch(() => '');
		if (dialog) {
			throw new Error(`One click should install it, and a dialog asks: ${dialog}`);
		}
		const panel: string = await evaluate(statePanel).catch(() => '');
		if (/failed/i.test(panel)) {
			throw new Error(panel);
		}
		const session = await evaluate(`(() => { const s = document.querySelector('.basehalf-agent-area-session.kind-extension'); return s ? !s.classList.contains('has-state') : false; })()`);
		const installed = fs.readdirSync(path.join(state, 'extensions')).some(name => name.toLowerCase().startsWith(extensionFolderPrefix));
		if (installed && session) {
			// The view of the session fills the Agent Area, and no icon comes beside Files, Git, and Search.
			const sizes = await until(`(() => {
				const session = document.querySelector('.basehalf-agent-area-session.kind-extension');
				const pane = session?.querySelector('.pane');
				const webview = [...document.querySelectorAll('.webview')].find(frame => { const r = frame.getBoundingClientRect(); const s = session.getBoundingClientRect(); return r.top >= s.top && r.bottom <= s.bottom + 1 && r.height > 0; });
				return pane && webview ? JSON.stringify({ session: session.getBoundingClientRect().height, pane: pane.getBoundingClientRect().height, webview: webview.getBoundingClientRect().height }) : null;
			})()`, 30_000, 'the view of the session');
			await sleep(5000);
			await shoot(`${agent}-after-install`);
			if (!await evaluate(`[...document.querySelectorAll('.basehalf-canvas-node, .react-flow__node')].some(node => /note/.test(node.textContent))`)) {
				throw new Error('The card of the note is not on the canvas.');
			}
			const { session: sessionHeight, pane: paneHeight, webview: webviewHeight } = JSON.parse(sizes);
			const settled = JSON.parse(await evaluate(`(() => {
				const session = document.querySelector('.basehalf-agent-area-session.kind-extension');
				const webview = [...document.querySelectorAll('.webview')].find(frame => { const r = frame.getBoundingClientRect(); const s = session.getBoundingClientRect(); return r.top >= s.top && r.bottom <= s.bottom + 1 && r.height > 0; });
				return JSON.stringify({ session: session.getBoundingClientRect().height, pane: session.querySelector('.pane').getBoundingClientRect().height, webview: webview.getBoundingClientRect().height });
			})()`));
			if (settled.pane < settled.session - 1 || settled.webview < settled.session - 60) {
				throw new Error(`The view of the session does not fill the Agent Area: ${JSON.stringify(settled)}, and at first ${JSON.stringify({ sessionHeight, paneHeight, webviewHeight })}`);
			}
			const statusEntries: string[] = JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('.part.statusbar .statusbar-item')].filter(item => item.offsetParent !== null).map(item => item.textContent.trim()))`));
			if (statusEntries.some(entry => /Claude Code|Codex/.test(entry))) {
				throw new Error(`The status bar opens the extension over the canvas: ${statusEntries.join(', ')}`);
			}
			const icons: string[] = JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('.part.sidebar .composite-bar .action-item')].map(item => (item.querySelector('.action-label') ?? item).getAttribute('aria-label')).filter(Boolean))`));
			if (icons.length !== 3 || !/^Explorer/.test(icons[0]) || !/^Source Control/.test(icons[1]) || !/^Search/.test(icons[2])) {
				throw new Error(`The sidebar shows more than Files, Git, and Search: ${icons.join(', ')}`);
			}
			console.log(JSON.stringify({ ok: true, agent, seconds: Math.round((Date.now() - started) / 1000), extensions: fs.readdirSync(path.join(state, 'extensions')).filter(name => name !== 'extensions.json') }));
			return;
		}
		await sleep(1000);
	}
	throw new Error(`The session did not start: ${await evaluate(statePanel)}`);
}

let failure: Error | undefined;
try {
	await run();
} catch (error) {
	failure = error as Error;
}
try {
	child.kill('SIGKILL');
} catch {
	// It has gone.
}
await sleep(1000);
if (failure) {
	// Keep the state to read the logs of the failure.
	console.error(`${failure.message}\nThe profile and its logs are in ${state}`);
	fs.rmSync(workspace, { recursive: true, force: true });
	process.exit(1);
}
fs.rmSync(state, { recursive: true, force: true });
fs.rmSync(workspace, { recursive: true, force: true });
process.exit(0);
