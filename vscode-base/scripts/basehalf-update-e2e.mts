/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { execFileSync, spawn } from 'child_process';
import { once } from 'events';
import fs from 'fs';
import http from 'http';
import type { AddressInfo } from 'net';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';

// Updates an installed application for real (app update, criterion 12): a
// copy of the packaged application that reports an older version is given a
// feed that offers the packaged one, and is quit, killed, and started again
// as a user's copy is. Nothing here is a stand-in: the copy runs its own
// update service, fetches the archive over HTTP, checks the release
// signature, and swaps its own bundle.
//
//
// With --from, the application of the release before is updated too, by the
// update service it was released with. That is the update its users get.
//
// It needs the release key, which signs the feed for the address on this
// machine, so it runs on the release machine. It opens BaseHalf windows.

const usage = 'Usage: npm run basehalf:update-e2e -- --app <BaseHalf.app> [--archive <its release zip>] [--from <BaseHalf.app or release zip of the release before>] [--case <numbers>] [--work <folder>] [--keep]';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const older = '0.0.1';

function argument(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

const appArgument = argument('--app');
if (!appArgument || process.platform !== 'darwin') {
	throw new Error(usage);
}
const packaged = path.resolve(appArgument);
const keep = process.argv.includes('--keep');
// Short on purpose: the application puts a socket below its data folder, and
// the path of a socket is limited to about a hundred characters.
const workArgument = path.resolve(argument('--work') ?? path.join(root, '.build', 'update-e2e'));
// The work folder is emptied. Only a folder that this script made is: it
// marks its own.
const mark = path.join(workArgument, '.basehalf-update-e2e');
if (fs.existsSync(workArgument) && fs.readdirSync(workArgument).length > 0 && !fs.existsSync(mark)) {
	throw new Error(`${workArgument} holds something that this script did not put there. Give it a folder of its own.`);
}
fs.rmSync(workArgument, { recursive: true, force: true });
fs.mkdirSync(workArgument, { recursive: true });
fs.writeFileSync(mark, '');
const work = fs.realpathSync(workArgument);

function bundleVersion(bundle: string): string | undefined {
	try {
		return JSON.parse(fs.readFileSync(path.join(bundle, 'Contents', 'Resources', 'app', 'product.json'), 'utf8')).basehalfVersion;
	} catch {
		return undefined;
	}
}

const product = JSON.parse(fs.readFileSync(path.join(packaged, 'Contents', 'Resources', 'app', 'product.json'), 'utf8'));
const offered: string = product.basehalfVersion;
assert.match(offered ?? '', /^\d+\.\d+\.\d+$/, `${packaged} does not say which version of BaseHalf it is.`);
assert.notEqual(offered, older);
// What Finder shows for the bundle.
const shortVersion = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(packaged, 'Contents', 'Info.plist')], { encoding: 'utf8' }).trim();
assert.equal(shortVersion, offered, 'The bundle\'s short version string is not BaseHalf\'s version.');

const sleep = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

async function until<T>(what: string, look: () => T | undefined | false, seconds: number): Promise<T> {
	const end = Date.now() + seconds * 1000;
	for (; ;) {
		const found = look();
		if (found !== undefined && found !== false) {
			return found;
		}
		if (Date.now() > end) {
			throw new Error(`Waited ${seconds} s for this and it did not happen: ${what}`);
		}
		await sleep(500);
	}
}

function log(message: string): void {
	console.error(`[update-e2e] ${message}`);
}

// --- The archive, and the server that holds it

const archive = path.join(work, `BaseHalf-${offered}-darwin-arm64.zip`);
const archiveArgument = argument('--archive');
if (archiveArgument) {
	// A copy, so that the manifest that is signed below is not written beside the release's own.
	execFileSync('/bin/cp', ['-c', path.resolve(archiveArgument), archive]);
} else {
	log('packing the application as the release does');
	execFileSync('/usr/bin/ditto', ['-ck', '--keepParent', packaged, archive]);
}
const length = fs.statSync(archive).size;

interface IServedRequest {
	readonly range: string | undefined;
	sent: number;
}
const served: IServedRequest[] = [];
/** Bytes per second, to leave time to interrupt a download. Unlimited when undefined. */
let rate: number | undefined;

const server = http.createServer((request, response) => {
	const range = request.headers.range;
	const from = range ? Number(/^bytes=(?<from>\d+)-$/.exec(range)?.groups?.from) : 0;
	if (request.url !== `/${path.basename(archive)}` || !Number.isInteger(from) || from >= length) {
		response.writeHead(404).end();
		return;
	}
	const record: IServedRequest = { range, sent: 0 };
	served.push(record);
	response.writeHead(range ? 206 : 200, {
		'Content-Type': 'application/zip',
		'Content-Length': length - from,
		...(range ? { 'Content-Range': `bytes ${from}-${length - 1}/${length}` } : {})
	});
	const file = fs.createReadStream(archive, { start: from, highWaterMark: 1024 * 1024 });
	response.on('close', () => file.destroy());
	(async () => {
		for await (const chunk of file) {
			if (!response.write(chunk)) {
				await once(response, 'drain');
			}
			record.sent += chunk.length;
			if (rate) {
				await sleep(chunk.length / rate * 1000);
			}
		}
		response.end();
	})().catch(() => response.destroy());
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = `http://127.0.0.1:${(server.address() as AddressInfo).port}/${path.basename(archive)}`;

/** A feed: the manifest of the release, for an archive that is somewhere on this machine. */
function sign(name: string, url: string): string {
	execFileSync(process.execPath, [path.join(root, 'build', 'basehalf', 'sign-update.mjs'), archive, '--version', offered, '--asset', name, '--url', url], { stdio: ['ignore', 'ignore', 'inherit'] });
	const manifest = path.join(work, `update-manifest-${name}.json`);
	assert.equal(JSON.parse(fs.readFileSync(manifest, 'utf8')).length, length);
	return manifest;
}
const feed = sign('served', address);
// Releases before this script could only be given an archive that is a file.
const feedOfAFile = sign('file', archive);

// --- An installed application

interface IInstalled {
	readonly name: string;
	readonly folder: string;
	readonly bundle: string;
	readonly staged: string;
	readonly data: string;
}

/** A copy of an application that says it is an older version, in a folder of its own. */
function install(name: string, application = packaged): IInstalled {
	const folder = path.join(work, name, 'Applications');
	fs.mkdirSync(folder, { recursive: true });
	const bundle = path.join(folder, 'BaseHalf.app');
	if (application.endsWith('.zip')) {
		execFileSync('/usr/bin/ditto', ['-xk', application, folder]);
	} else {
		execFileSync('/bin/cp', ['-cR', application, bundle]);
	}
	const configuration = path.join(bundle, 'Contents', 'Resources', 'app', 'product.json');
	fs.writeFileSync(configuration, JSON.stringify({ ...JSON.parse(fs.readFileSync(configuration, 'utf8')), basehalfVersion: older }, undefined, '\t'));
	return { name, folder, bundle, staged: path.join(folder, `.bh-staged-${offered}.app`), data: path.join(work, name, 'data') };
}

/** The main processes that run from a bundle, and whether anything at all still runs from it. */
function processesOf(bundle: string): { readonly main: number[]; readonly any: boolean } {
	const main: number[] = [];
	let any = false;
	for (const line of execFileSync('/bin/ps', ['-Ao', 'pid=,comm='], { encoding: 'utf8' }).split('\n')) {
		const match = /^\s*(?<pid>\d+)\s+(?<command>.*)$/.exec(line);
		if (!match?.groups || !match.groups.command.startsWith(`${bundle}/Contents/`)) {
			continue;
		}
		any = true;
		if (match.groups.command.startsWith(`${bundle}/Contents/MacOS/`)) {
			main.push(Number(match.groups.pid));
		}
	}
	return { main, any };
}

/** Starts the installed application as a user does, with the feed of this run. */
function start(installed: IInstalled, options: { readonly data?: string; readonly updates?: boolean; readonly feed?: string } = {}): void {
	const environment: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(process.env)) {
		// Not what the tool that runs this script set for itself.
		if (!/^(?:VSCODE_|ELECTRON_|NODE_)/.test(key)) {
			environment[key] = value;
		}
	}
	environment['BASEHALF_UPDATE_FEED_URL'] = options.feed ?? feed;
	const data = options.data ?? installed.data;
	spawn(path.join(installed.bundle, 'Contents', 'MacOS', product.nameShort), [
		`--user-data-dir=${data}`,
		`--extensions-dir=${path.join(path.dirname(data), 'extensions')}`,
		...(options.updates === false ? ['--disable-updates'] : [])
	], { env: environment, detached: true, stdio: 'ignore' }).unref();
}

async function gone(installed: IInstalled): Promise<void> {
	await until(`nothing runs from ${installed.bundle} any more`, () => !processesOf(installed.bundle).any, 60);
}

/** The main process of the run that was started from a bundle with a data folder. */
function mainProcessOrNone(installed: IInstalled, data = installed.data): number | undefined {
	for (const line of execFileSync('/bin/ps', ['-Ao', 'pid=,args='], { encoding: 'utf8' }).split('\n')) {
		const match = /^\s*(?<pid>\d+)\s+(?<command>.*)$/.exec(line);
		// The helper processes are started from Contents/Frameworks.
		if (match?.groups && match.groups.command.startsWith(`${installed.bundle}/Contents/MacOS/`) && `${match.groups.command} `.includes(` --user-data-dir=${data} `)) {
			return Number(match.groups.pid);
		}
	}
	return undefined;
}

function mainProcess(installed: IInstalled, data = installed.data): number {
	const pid = mainProcessOrNone(installed, data);
	assert.ok(pid, `No BaseHalf runs from ${installed.bundle} with ${data}.`);
	return pid;
}

/** Quits as the Quit command does: the application closes its windows and shuts down in order. */
async function quit(installed: IInstalled, data = installed.data): Promise<void> {
	process.kill(mainProcess(installed, data), 'SIGTERM');
	await until(`the run with ${data} has ended`, () => !mainProcessOrNone(installed, data), 60);
}

/**
 * Ends the application at once, as a forced quit or a crash does. Its helper
 * processes outlive it for a moment, and the next start does not wait for
 * them, as a user does not.
 */
async function kill(installed: IInstalled): Promise<void> {
	process.kill(mainProcess(installed), 'SIGKILL');
	await until('its main process has ended', () => !mainProcessOrNone(installed), 30);
}

/** The states the update service of an installed application went through, in order, over all its runs. */
function states(installed: IInstalled): string[] {
	const logs = path.join(installed.data, 'logs');
	const found: string[] = [];
	for (const run of fs.existsSync(logs) ? fs.readdirSync(logs).sort() : []) {
		const main = path.join(logs, run, 'main.log');
		for (const line of fs.existsSync(main) ? fs.readFileSync(main, 'utf8').split('\n') : []) {
			const state = /update#setState (?<state>.+)$/.exec(line)?.groups?.state;
			if (state) {
				found.push(state.trim());
			}
		}
	}
	return found;
}

function beside(installed: IInstalled): string[] {
	return fs.readdirSync(installed.folder).sort();
}

function inStore(installed: IInstalled): string[] {
	const store = path.join(installed.data, 'updates');
	return fs.existsSync(store) ? fs.readdirSync(store).sort() : [];
}

/** The staged copy is complete and the archive is gone: the next thing the service does is to say it is ready. */
async function ready(installed: IInstalled, seconds = 300): Promise<void> {
	await until(`${installed.name}: the update is ready`, () => bundleVersion(installed.staged) === offered && inStore(installed).length === 0, seconds);
	await sleep(2000);
}

/** The run that is there now says it has nothing to fetch: it is the offered version, and asked the feed. */
async function upToDate(installed: IInstalled, from: number, seconds = 120): Promise<string[]> {
	return until(`${installed.name}: the running version asked the feed and found nothing newer`, () => {
		const since = states(installed).slice(from);
		const asked = since.indexOf('checking for updates');
		return asked >= 0 && since.indexOf('idle', asked) >= 0 ? since : undefined;
	}, seconds);
}

// --- The cases

const results: Record<string, unknown> = {};
const started = Date.now();

async function readyThenQuit(): Promise<void> {
	log('1: becomes ready, is quit, and is the new version at the next start');
	const installed = install('a');
	const requestsBefore = served.length;
	start(installed);
	await ready(installed);
	await until('the service says it is ready', () => states(installed).includes('ready'), 30);
	assert.deepEqual({ bundle: bundleVersion(installed.bundle), beside: beside(installed), requests: served.slice(requestsBefore).map(request => request.range ?? 'all of it') },
		{ bundle: older, beside: [`.bh-staged-${offered}.app`, 'BaseHalf.app'], requests: ['all of it'] });

	await quit(installed);
	await gone(installed);
	assert.equal(bundleVersion(installed.bundle), offered, 'The quit did not swap the staged copy in.');
	assert.equal(fs.existsSync(installed.staged), false);

	const from = states(installed).length;
	start(installed);
	const since = await upToDate(installed, from);
	// What the old bundle was renamed to is removed by the new version.
	await until('the old bundle is removed', () => beside(installed).length === 1, 60);
	await quit(installed);
	await gone(installed);
	assert.deepEqual({ since, beside: beside(installed), store: inStore(installed), requests: served.length - requestsBefore },
		{ since: ['idle', 'checking for updates', 'idle'], beside: ['BaseHalf.app'], store: [], requests: 1 });
	results['ready, quit, started'] = { before: older, after: bundleVersion(installed.bundle), states: since };
}

async function killedWhileItDownloads(): Promise<void> {
	log('2: is killed while it downloads, is started again, and continues');
	const installed = install('b');
	const requestsBefore = served.length;
	const partial = path.join(installed.data, 'updates', `BaseHalf-${offered}.zip.part`);
	const size = () => fs.existsSync(partial) ? fs.statSync(partial).size : 0;
	// The whole archive in about 40 seconds.
	rate = length / 40;
	start(installed);
	await until('a quarter of the archive is there', () => size() > length / 4, 120);
	await kill(installed);
	rate = undefined;
	const had = size();
	assert.ok(had > length / 4 && had < length, `The partial archive has ${had} of ${length} bytes.`);
	assert.deepEqual(beside(installed), ['BaseHalf.app']);

	start(installed);
	await ready(installed);
	const requests = served.slice(requestsBefore);
	assert.deepEqual({ requests: requests.map(request => request.range ?? 'all of it'), rest: requests[1]?.sent, bundle: bundleVersion(installed.bundle) },
		{ requests: ['all of it', `bytes=${had}-`], rest: length - had, bundle: older });

	await quit(installed);
	await gone(installed);
	assert.equal(bundleVersion(installed.bundle), offered, 'The archive that was continued was not installed.');
	results['killed while it downloads'] = { had, of: length, thenAskedFor: `bytes=${had}-`, after: bundleVersion(installed.bundle) };
}

async function killedWhenReady(): Promise<void> {
	log('3: is killed when it is ready, and is the new version at the next start');
	const installed = install('c');
	const requestsBefore = served.length;
	start(installed);
	await ready(installed);
	await kill(installed);
	assert.deepEqual({ bundle: bundleVersion(installed.bundle), beside: beside(installed) }, { bundle: older, beside: [`.bh-staged-${offered}.app`, 'BaseHalf.app'] });

	const from = states(installed).length;
	start(installed);
	await until('the start swapped the staged copy in', () => bundleVersion(installed.bundle) === offered && !fs.existsSync(installed.staged), 60);
	const since = await upToDate(installed, from);
	await until('the old bundle is removed', () => beside(installed).length === 1, 60);
	assert.equal(processesOf(installed.bundle).main.length, 1, 'BaseHalf did not start again after the swap.');
	await quit(installed);
	await gone(installed);
	assert.deepEqual({ since, requests: served.length - requestsBefore }, { since: ['idle', 'checking for updates', 'idle'], requests: 1 });
	results['killed when ready, started'] = { before: older, after: bundleVersion(installed.bundle), states: since };
}

async function startedBesideAnotherRun(): Promise<void> {
	log('4: is started while another BaseHalf runs from the same bundle: ready at once, and the new version after its quit');
	const installed = install('d');
	const requestsBefore = served.length;
	start(installed);
	await ready(installed);
	await kill(installed);

	// Another run from the same bundle, with its own data and without updates.
	const other = path.join(work, 'd', 'other', 'data');
	start(installed, { data: other, updates: false });
	await until('the other run is there', () => mainProcessOrNone(installed, other), 60);
	await sleep(3000);

	const from = states(installed).length;
	start(installed);
	const since = await until('the service says it is ready', () => {
		const now = states(installed).slice(from);
		return now.includes('ready') ? now : undefined;
	}, 60);
	assert.deepEqual({ since, bundle: bundleVersion(installed.bundle), requests: served.length - requestsBefore }, { since: ['idle', 'ready'], bundle: older, requests: 1 });

	await quit(installed, other);
	assert.equal(bundleVersion(installed.bundle), older, 'A run without updates swapped.');
	await quit(installed);
	await gone(installed);
	assert.equal(bundleVersion(installed.bundle), offered, 'The quit did not swap the staged copy in.');
	results['started beside another run'] = { states: since, after: bundleVersion(installed.bundle) };
}

async function releaseBeforeUpdatesItself(application: string): Promise<void> {
	log('5: the application of the release before updates itself, with the update service it was released with');
	const installed = install('e', application);
	const requestsBefore = served.length;
	start(installed, { feed: feedOfAFile });
	await until('its update service says the update is ready', () => states(installed).includes('ready'), 300);
	assert.equal(bundleVersion(installed.bundle), older);

	await quit(installed);
	await gone(installed);
	assert.equal(bundleVersion(installed.bundle), offered, 'Its quit did not swap the new version in.');

	// The new version, with what the other update service left beside it.
	const from = states(installed).length;
	start(installed, { feed: feedOfAFile });
	const since = await upToDate(installed, from);
	await until('what the update service before left is removed', () => beside(installed).length === 1, 90);
	await quit(installed);
	await gone(installed);
	assert.deepEqual({ since, beside: beside(installed), requests: served.length - requestsBefore }, { since: ['idle', 'checking for updates', 'idle'], beside: ['BaseHalf.app'], requests: 0 });
	results['the release before updates itself'] = { after: bundleVersion(installed.bundle), states: since };
}

const fromArgument = argument('--from');
const cases = [readyThenQuit, killedWhileItDownloads, killedWhenReady, startedBesideAnotherRun, ...(fromArgument ? [() => releaseBeforeUpdatesItself(path.resolve(fromArgument))] : [])];
const chosen = argument('--case')?.split(',').map(Number);

let failed = false;
try {
	for (const [index, run] of cases.entries()) {
		if (!chosen || chosen.includes(index + 1)) {
			await run();
		}
	}
	// What a release needs: every case, the application of the release before among them.
	const forARelease = !chosen && !!fromArgument;
	if (!forARelease) {
		log('not the check before a release: it runs every case, with --from');
	}
	console.log(JSON.stringify({ ok: true, forARelease, from: older, to: offered, archiveBytes: length, bundleShortVersion: shortVersion, seconds: Math.round((Date.now() - started) / 1000), cases: results }, undefined, 2));
} catch (error) {
	failed = true;
	throw error;
} finally {
	server.close();
	server.closeAllConnections();
	// Whatever still runs from the work folder.
	for (const line of execFileSync('/bin/ps', ['-Ao', 'pid=,comm='], { encoding: 'utf8' }).split('\n')) {
		const match = /^\s*(?<pid>\d+)\s+(?<command>.*)$/.exec(line);
		if (match?.groups && match.groups.command.startsWith(`${work}/`) && match.groups.command.includes('/Contents/MacOS/')) {
			try {
				process.kill(Number(match.groups.pid), 'SIGKILL');
			} catch {
				// It ended by itself.
			}
		}
	}
	if (failed || keep) {
		log(`left for inspection: ${work}`);
	} else {
		await sleep(2000);
		fs.rmSync(work, { recursive: true, force: true });
	}
}
