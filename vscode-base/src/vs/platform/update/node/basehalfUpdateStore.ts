/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'child_process';
import { accessSync, constants, createWriteStream, promises as fs, readFileSync, renameSync } from 'fs';
import { promisify } from 'util';
import { VSBufferReadableStream } from '../../../base/common/buffer.js';
import { dirname, join } from '../../../base/common/path.js';
import { listenStream } from '../../../base/common/stream.js';
import { compareBaseHalfVersions, parseBaseHalfVersion } from './basehalfUpdateProtocol.js';

const execFileAsync = promisify(execFile);

/**
 * Deletes a file, or a folder with everything in it, by /bin/rm. Inside
 * Electron, fs.rm cannot delete an app bundle: its patched fs takes the
 * bundle's app.asar for a folder, and the walk fails partway.
 */
export async function baseHalfRemove(path: string): Promise<void> {
	await execFileAsync('/bin/rm', ['-rf', '--', path]);
}

/**
 * What BaseHalf's update service keeps on disk, and under which name (app
 * update, "What is kept, and under which name"). An archive and a staged copy
 * are named after the version they hold and not after the run that fetched
 * them, so that the next run finds them: an interrupted download continues,
 * a complete one is not fetched again, and an update that is ready is still
 * ready.
 *
 * A file or folder with its final name is complete. Everything is written
 * under another name first and renamed when it is.
 */

/** The checked archive of a version, in the update store. */
export function baseHalfUpdateArchiveName(version: string): string {
	return `BaseHalf-${version}.zip`;
}

/** The archive of a version while it is downloaded. */
export function baseHalfUpdatePartialArchiveName(version: string): string {
	return `${baseHalfUpdateArchiveName(version)}.part`;
}

/** The complete staged copy of a version, beside the bundle. */
export function baseHalfStagedCopyName(version: string): string {
	return `.bh-staged-${version}.app`;
}

/** A staged copy while one run builds it. */
export function baseHalfStagingCopyName(pid: number): string {
	return `.bh-staging-${pid}.app`;
}

/** The bundle that one run renamed aside when it swapped. */
export function baseHalfPreviousBundleName(pid: number): string {
	return `.bh-previous-${pid}.app`;
}

/** The folder in the update store into which one run unpacks an archive. */
export function baseHalfUpdateExtractName(pid: number): string {
	return `extract-${pid}`;
}

/** The version that a complete staged copy's name holds. */
export function baseHalfStagedCopyVersion(entry: string): string | undefined {
	const version = /^\.bh-staged-(?<version>\d+\.\d+\.\d+)\.app$/.exec(entry)?.groups?.version;
	return version !== undefined && parseBaseHalfVersion(version) ? version : undefined;
}

/** The version that an archive's name holds, complete or partial. */
function archiveVersion(entry: string): string | undefined {
	const version = /^BaseHalf-(?<version>\d+\.\d+\.\d+)\.zip(?:\.part)?$/.exec(entry)?.groups?.version;
	return version !== undefined && parseBaseHalfVersion(version) ? version : undefined;
}

/** The process number in a name that belongs to one run. */
function ownerOf(entry: string, pattern: RegExp): number | undefined {
	const pid = pattern.exec(entry)?.groups?.pid;
	return pid === undefined ? undefined : Number(pid);
}

/** The version a bundle says it is, read from its product configuration. */
export function baseHalfBundleVersion(bundle: string): string | undefined {
	try {
		const product = JSON.parse(readFileSync(join(bundle, 'Contents', 'Resources', 'app', 'product.json'), 'utf8'));
		return typeof product?.basehalfVersion === 'string' && parseBaseHalfVersion(product.basehalfVersion) ? product.basehalfVersion : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Of what is beside the bundle, the staged copy that takes its place: the one
 * with the highest version above the running one. A staged copy whose own
 * version is not the one in its name is not chosen.
 */
export function baseHalfChooseStagedCopy(entriesBesideBundle: readonly string[], runningVersion: string, versionOf: (entry: string) => string | undefined): { readonly entry: string; readonly version: string } | undefined {
	let chosen: { readonly entry: string; readonly version: string } | undefined;
	for (const entry of entriesBesideBundle) {
		const version = baseHalfStagedCopyVersion(entry);
		if (version === undefined || (compareBaseHalfVersions(version, runningVersion) ?? 0) <= 0) {
			continue;
		}
		if (chosen && (compareBaseHalfVersions(version, chosen.version) ?? 0) <= 0) {
			continue;
		}
		if (versionOf(entry) === version) {
			chosen = { entry, version };
		}
	}
	return chosen;
}

/**
 * Whether another run of the application executes from the bundle.
 * `processes` is what `ps -Ao pid=,ppid=,comm=` prints, and this run is
 * `ownPid`.
 *
 * Another run shows as a process from the bundle that this run did not start
 * and that did not start this run, and that is a main process or a helper of
 * one. Helpers whose line of parents ends at the system do not count: this
 * run's own crash reporter is one, and so is what a killed run has not ended
 * yet, which loads nothing more from the bundle. The helpers are looked at
 * because they are listed with their whole path, and a main process with the
 * path it was started with, which may be a relative one.
 */
export function baseHalfAnotherRunUses(processes: string, bundle: string, ownPid: number): boolean {
	const inside = `${bundle}/Contents/`;
	const parentOf = new Map<number, number>();
	const fromBundle = new Map<number, { readonly parent: number; readonly main: boolean }>();
	for (const line of processes.split('\n')) {
		const match = /^\s*(?<pid>\d+)\s+(?<parent>\d+)\s+(?<command>.*)$/.exec(line);
		if (!match?.groups) {
			continue;
		}
		const pid = Number(match.groups.pid);
		const parent = Number(match.groups.parent);
		parentOf.set(pid, parent);
		if (match.groups.command.startsWith(inside)) {
			fromBundle.set(pid, { parent, main: match.groups.command.startsWith(`${inside}MacOS/`) });
		}
	}
	/** Whether `ancestor` is `pid` or started it, directly or through others. */
	const startedBy = (pid: number, ancestor: number) => {
		for (let at: number | undefined = pid, steps = 0; at !== undefined && at > 1 && steps < 64; at = parentOf.get(at), steps++) {
			if (at === ancestor) {
				return true;
			}
		}
		return false;
	};
	/** Whether above a helper, past the helpers that started it, there is a process and not the system. */
	const hasARun = (parent: number) => {
		let at = parent;
		for (let steps = 0; steps < 64; steps++) {
			const above = fromBundle.get(at);
			if (!above || above.main) {
				break;
			}
			at = above.parent;
		}
		return at > 1;
	};
	for (const [pid, process] of fromBundle) {
		if (!startedBy(pid, ownPid) && !startedBy(ownPid, pid) && (process.main || hasARun(process.parent))) {
			return true;
		}
	}
	return false;
}

/** Whether this user may rename in the folder the bundle is in, which staging and the swap need. */
export function baseHalfCanSwapIn(bundle: string): boolean {
	try {
		accessSync(dirname(bundle), constants.W_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * The swap: the bundle is renamed aside, under a name of this run, and the
 * staged copy gets the bundle's name. Both renames are in one folder, so each
 * is one step. When the second fails, the bundle is put back and the error
 * is thrown. Synchronous on purpose: it runs while the application starts or
 * quits.
 */
export function baseHalfSwapIn(bundle: string, staged: string, pid: number): void {
	const previous = join(dirname(bundle), baseHalfPreviousBundleName(pid));
	renameSync(bundle, previous);
	try {
		renameSync(staged, bundle);
	} catch (error) {
		renameSync(previous, bundle);
		throw error;
	}
}

export interface IBaseHalfUpdateLeftovers {
	/** Entries beside the bundle. */
	readonly besideBundle: string[];
	/** Entries of the update store. */
	readonly inStore: string[];
	/** Entries of the temporary folder. */
	readonly inTemporaryFolder: string[];
}

/**
 * What a run removes (app update, "What is removed"): archives and staged
 * copies of the running version and of older ones, and what a run that has
 * ended left under a name with its process number. Nothing of a run that is
 * still alive, and nothing of this one.
 *
 * `anotherRunUsesBundle`: a bundle that was renamed aside stays then. The
 * other run may be the one that still executes from it, after the run that
 * renamed it has ended.
 */
export function baseHalfUpdateLeftovers(entries: IBaseHalfUpdateLeftovers, runningVersion: string, ownPid: number, isAlive: (pid: number) => boolean, anotherRunUsesBundle: boolean): IBaseHalfUpdateLeftovers {
	const notNewer = (version: string | undefined) => version !== undefined && (compareBaseHalfVersions(version, runningVersion) ?? 1) <= 0;
	const ofADeadRun = (pid: number | undefined) => pid !== undefined && pid !== ownPid && !isAlive(pid);
	return {
		besideBundle: entries.besideBundle.filter(entry => notNewer(baseHalfStagedCopyVersion(entry))
			// The first version named a staged copy after the run that built it.
			|| ofADeadRun(ownerOf(entry, /^\.bh-(?:staging|staged)-(?<pid>\d+)\.app$/))
			|| !anotherRunUsesBundle && ofADeadRun(ownerOf(entry, /^\.bh-previous-(?<pid>\d+)\.app$/))),
		inStore: entries.inStore.filter(entry => notNewer(archiveVersion(entry)) || ofADeadRun(ownerOf(entry, /^extract-(?<pid>\d+)$/))),
		// Where the first version downloaded and unpacked.
		inTemporaryFolder: entries.inTemporaryFolder.filter(entry => ofADeadRun(ownerOf(entry, /^bh-update-(?<pid>\d+)$/)))
	};
}

export interface IBaseHalfArchiveResponse {
	readonly statusCode: number | undefined;
	readonly stream: VSBufferReadableStream;
	/** What the answer says about itself, where it says so. */
	readonly contentLength?: number;
	readonly contentRange?: string;
}

/**
 * Whether an answer can be the archive, or the rest of it from byte `from`
 * on, by what it says about itself. A page that a network puts in place of
 * the file, with a success status, is not.
 */
function isTheArchive(response: IBaseHalfArchiveResponse, continues: boolean, from: number, length: number): boolean {
	if (!continues) {
		return response.contentLength === undefined || response.contentLength === length;
	}
	if (response.contentRange === undefined) {
		return true;
	}
	const range = /^bytes (?<first>\d+)-\d+\/(?<total>\d+|\*)$/.exec(response.contentRange.trim())?.groups;
	return !!range && Number(range.first) === from && (range.total === '*' || Number(range.total) === length);
}

/**
 * Downloads an archive to `partialPath`, continuing a file that is already
 * there (app update, "Downloading").
 *
 * - `request(from)` asks for the archive from byte `from` on. A server that
 *   continues answers 206. One that sends the whole file answers 200, and
 *   the file is started again.
 * - An answer that says it is something else is refused, and the file is
 *   left as it is.
 * - The file is never longer than `length`. One that would be is deleted.
 * - A transfer that ends early leaves the file for the next try.
 * - A file after which the server has no bytes (416) is deleted.
 */
export async function baseHalfDownloadArchive(options: {
	readonly partialPath: string;
	readonly length: number;
	readonly request: (from: number) => Promise<IBaseHalfArchiveResponse>;
	readonly onProgress?: (received: number) => void;
}): Promise<void> {
	const { partialPath, length } = options;
	let have = 0;
	try {
		have = (await fs.stat(partialPath)).size;
	} catch {
		// Nothing there yet.
	}
	if (have > length) {
		await fs.rm(partialPath, { force: true });
		have = 0;
	}
	if (have === length) {
		return;
	}

	const response = await options.request(have);
	const statusCode = response.statusCode;
	if (!statusCode || statusCode < 200 || statusCode >= 300) {
		response.stream.destroy();
		if (have > 0 && statusCode === 416) {
			// The server has no bytes after this file: its archive is another
			// one by now. The next try starts with nothing.
			await fs.rm(partialPath, { force: true });
		}
		throw new Error(`Download failed (HTTP ${statusCode}).`);
	}
	// Only 206 continues. Anything else that succeeded is the whole file.
	const continues = have > 0 && statusCode === 206;
	if (!isTheArchive(response, continues, have, length)) {
		response.stream.destroy();
		throw new Error('The server did not send the archive.');
	}
	if (!continues) {
		have = 0;
	}

	await new Promise<void>((resolve, reject) => {
		const out = createWriteStream(partialPath, { flags: continues ? 'a' : 'w' });
		let received = have;
		let settled = false;
		const fail = (error: Error, remove: boolean) => {
			if (settled) {
				return;
			}
			settled = true;
			response.stream.destroy();
			// Only once the file is closed: a file that is still being opened
			// would be created again after it was removed.
			const whenClosed = () => (remove ? fs.rm(partialPath, { force: true }) : Promise.resolve()).finally(() => reject(error));
			if (out.closed) {
				whenClosed();
			} else {
				out.once('close', whenClosed);
				out.destroy();
			}
		};
		out.on('error', error => fail(error, false));
		listenStream(response.stream, {
			onData: chunk => {
				received += chunk.byteLength;
				if (received > length) {
					fail(new Error('Archive larger than the manifest says.'), true);
					return;
				}
				if (!out.write(chunk.buffer)) {
					response.stream.pause();
					out.once('drain', () => response.stream.resume());
				}
				options.onProgress?.(received);
			},
			onError: error => fail(error, false),
			onEnd: () => {
				out.end(() => {
					if (settled) {
						return;
					}
					settled = true;
					if (received !== length) {
						reject(new Error(`Download incomplete (${received} of ${length} bytes).`));
					} else {
						resolve();
					}
				});
			}
		});
	});
}

export interface IBaseHalfUpdateToPrepare {
	/** The version and the length of the archive, from a manifest that was checked. */
	readonly version: string;
	readonly length: number;
	/** Whether these bytes are the archive that was signed. */
	readonly verify: (bytes: Buffer) => boolean;
	/** Asks the server for the archive from byte `from` on. */
	readonly request: (from: number) => Promise<IBaseHalfArchiveResponse>;
	/** A file that is the archive, in place of the server (a local test feed). */
	readonly localArchive?: string;
	/** The installed application. */
	readonly bundle: string;
	/** The update store. */
	readonly storePath: string;
	/** This run. */
	readonly pid: number;
	readonly onProgress?: (received: number) => void;
	/** The archive is there and checked, and is unpacked now. */
	readonly onUnpacking?: () => void;
}

/**
 * Makes an update ready and returns its staged copy (app update,
 * "Downloading" and "Staging"). Each step uses what an earlier run left
 * complete: the staged copy, the checked archive, a partial archive.
 */
export async function baseHalfPrepareUpdate(update: IBaseHalfUpdateToPrepare): Promise<string> {
	const parent = dirname(update.bundle);
	const staged = join(parent, baseHalfStagedCopyName(update.version));
	// Before the download and not after it. And before a staged copy that is
	// there is called ready: this user could not swap it in.
	if (!baseHalfCanSwapIn(update.bundle)) {
		throw new Error('BaseHalf cannot write to the folder it is installed in, so it cannot update itself.');
	}
	if (baseHalfBundleVersion(staged) === update.version) {
		return staged;
	}

	const zipPath = await obtainArchive(update);
	update.onUnpacking?.();

	const extractDir = join(update.storePath, baseHalfUpdateExtractName(update.pid));
	const staging = join(parent, baseHalfStagingCopyName(update.pid));
	try {
		// ditto keeps the symbolic links and the metadata inside an app bundle,
		// which a plain unzip does not.
		await baseHalfRemove(extractDir);
		await fs.mkdir(extractDir, { recursive: true });
		await execFileAsync('/usr/bin/ditto', ['-xk', zipPath, extractDir]);
		const apps = (await fs.readdir(extractDir)).filter(entry => entry.endsWith('.app'));
		if (apps.length !== 1 || baseHalfBundleVersion(join(extractDir, apps[0])) !== update.version) {
			// The archive is the one that was signed, so it stays: a download
			// would bring the same bytes.
			throw new Error(`The archive does not hold exactly one application of version ${update.version}.`);
		}

		// Copied into the bundle's own folder: a rename cannot cross volumes,
		// and the update store may be on another one. The copy is built under
		// a name of this run and gets its final name when it is complete.
		await baseHalfRemove(staging);
		await execFileAsync('/usr/bin/ditto', [join(extractDir, apps[0]), staging]);
		if (baseHalfBundleVersion(staged) !== update.version) {
			await baseHalfRemove(staged);
			await fs.rename(staging, staged);
		} // Otherwise another run finished the same version first.
		await fs.rm(zipPath, { force: true });
		return staged;
	} finally {
		await baseHalfRemove(extractDir).catch(() => undefined);
		await baseHalfRemove(staging).catch(() => undefined);
	}
}

/**
 * The checked archive of the update, in the update store: the one that is
 * there, or a downloaded one. It has its final name once its length and its
 * signature are right. A wrong one is deleted.
 *
 * An archive that is there is checked again before it is used: the update
 * store is a folder like any other of the user, and what is unpacked from it
 * becomes the application.
 */
async function obtainArchive(update: IBaseHalfUpdateToPrepare): Promise<string> {
	const zipPath = join(update.storePath, baseHalfUpdateArchiveName(update.version));
	const partialPath = join(update.storePath, baseHalfUpdatePartialArchiveName(update.version));
	await fs.mkdir(update.storePath, { recursive: true });
	try {
		if ((await fs.stat(zipPath)).size === update.length && update.verify(await fs.readFile(zipPath))) {
			return zipPath;
		}
		// Not the archive that is offered now, or not what it was when it was checked.
		await fs.rm(zipPath, { force: true });
	} catch {
		// Not there.
	}

	if (update.localArchive !== undefined) {
		await fs.copyFile(update.localArchive, partialPath);
	} else {
		await baseHalfDownloadArchive({ partialPath, length: update.length, request: update.request, onProgress: update.onProgress });
	}

	const bytes = await fs.readFile(partialPath);
	if (bytes.length !== update.length) {
		if (bytes.length > update.length) {
			await fs.rm(partialPath, { force: true });
		}
		throw new Error(`Download incomplete (${bytes.length} of ${update.length} bytes).`);
	}
	if (!update.verify(bytes)) {
		await fs.rm(partialPath, { force: true });
		throw new Error('Signature verification failed — refusing the update.');
	}
	await fs.rename(partialPath, zipPath);
	return zipPath;
}
