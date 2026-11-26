/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { execFileSync } from 'child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { newWriteableBufferStream, VSBuffer } from '../../../../base/common/buffer.js';
import { join } from '../../../../base/common/path.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { baseHalfAnotherRunUses, baseHalfBundleVersion, baseHalfCanSwapIn, baseHalfChooseStagedCopy, baseHalfDownloadArchive, baseHalfPrepareUpdate, baseHalfStagedCopyName, baseHalfSwapIn, baseHalfStagedCopyVersion, baseHalfUpdateArchiveName, baseHalfUpdateLeftovers, baseHalfUpdatePartialArchiveName, IBaseHalfArchiveResponse, IBaseHalfUpdateToPrepare } from '../../node/basehalfUpdateStore.js';

suite('basehalfUpdateStore', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	let folder: string;
	setup(() => folder = mkdtempSync(join(tmpdir(), 'bh-update-store-')));
	teardown(() => rmSync(folder, { recursive: true, force: true }));

	/** A bundle that says which version it is, as a packaged application does. */
	function bundle(name: string, version: unknown, parent = folder): string {
		const path = join(parent, name);
		mkdirSync(join(path, 'Contents', 'Resources', 'app'), { recursive: true });
		writeFileSync(join(path, 'Contents', 'Resources', 'app', 'product.json'), JSON.stringify({ basehalfVersion: version }));
		return path;
	}

	const archive = VSBuffer.fromString('0123456789abcdefghijklmnopqrstuvwxyz0123456789ABCD');

	/** A server that holds `archive`. `continues`: whether it answers a request for a part with that part. */
	function server(continues: boolean, options: { readonly sends?: VSBuffer; readonly endsAfter?: number } = {}) {
		const requests: number[] = [];
		const request = async (from: number): Promise<IBaseHalfArchiveResponse> => {
			requests.push(from);
			const whole = options.sends ?? archive;
			const part = continues && from > 0;
			const body = part ? whole.slice(from) : whole;
			const stream = newWriteableBufferStream();
			// In two pieces, and cut off when the test says so.
			const sent = options.endsAfter === undefined ? body : body.slice(0, options.endsAfter);
			queueMicrotask(() => {
				stream.write(sent.slice(0, Math.floor(sent.byteLength / 2)));
				stream.write(sent.slice(Math.floor(sent.byteLength / 2)));
				stream.end();
			});
			return { statusCode: part ? 206 : 200, stream };
		};
		return { requests, request };
	}

	test('a file or folder has its final name only when it is complete, and the names hold the version', () => {
		assert.deepStrictEqual({
			archive: [baseHalfUpdateArchiveName('0.5.1'), baseHalfUpdatePartialArchiveName('0.5.1')],
			staged: baseHalfStagedCopyName('0.5.1'),
			versions: ['.bh-staged-0.5.1.app', '.bh-staged-12.0.30.app', '.bh-staged-7990.app', '.bh-staged-0.5.app', '.bh-staging-0.5.1.app', 'BaseHalf.app', '.bh-staged-0.5.1.app.old'].map(entry => baseHalfStagedCopyVersion(entry) ?? null)
		}, {
			archive: ['BaseHalf-0.5.1.zip', 'BaseHalf-0.5.1.zip.part'],
			staged: '.bh-staged-0.5.1.app',
			// A name with a process number is from the first version and holds no version.
			versions: ['0.5.1', '12.0.30', null, null, null, null, null]
		});
	});

	test('the staged copy that takes the bundle\'s place is the highest version above the running one whose own version is the one in its name', () => {
		bundle('.bh-staged-0.5.1.app', '0.5.1');
		bundle('.bh-staged-0.6.0.app', '0.6.0');
		// Its name says 0.9.0 and it is something else.
		bundle('.bh-staged-0.9.0.app', '0.4.0');
		// Not a bundle at all.
		mkdirSync(join(folder, '.bh-staged-0.8.0.app'));
		bundle('.bh-staged-0.5.0.app', '0.5.0');
		bundle('.bh-staged-0.4.1.app', '0.4.1');
		const entries = ['BaseHalf.app', '.bh-staged-0.5.1.app', '.bh-staged-0.9.0.app', '.bh-staged-0.6.0.app', '.bh-staged-0.8.0.app', '.bh-staged-0.5.0.app', '.bh-staged-0.4.1.app', '.bh-staged-123.app'];
		const versionOf = (entry: string) => baseHalfBundleVersion(join(folder, entry));

		assert.deepStrictEqual({
			running050: baseHalfChooseStagedCopy(entries, '0.5.0', versionOf),
			running060: baseHalfChooseStagedCopy(entries, '0.6.0', versionOf) ?? null,
			nothingStaged: baseHalfChooseStagedCopy(['BaseHalf.app'], '0.5.0', versionOf) ?? null,
			ownVersions: [versionOf('.bh-staged-0.6.0.app'), versionOf('.bh-staged-0.8.0.app') ?? null, baseHalfBundleVersion(bundle('odd.app', 'not a version')) ?? null]
		}, {
			running050: { entry: '.bh-staged-0.6.0.app', version: '0.6.0' },
			running060: null,
			nothingStaged: null,
			ownVersions: ['0.6.0', null, null]
		});
	});

	test('what is removed: the running version and older ones, and what a dead run left under its process number', () => {
		const alive = new Set([100, 200]);
		const entries = {
			besideBundle: [
				'BaseHalf.app', 'Other.app',
				'.bh-staged-0.5.0.app', '.bh-staged-0.4.1.app', '.bh-staged-0.6.0.app',
				'.bh-staging-100.app', '.bh-staging-300.app', '.bh-staging-200.app',
				'.bh-previous-300.app', '.bh-previous-200.app',
				'.bh-staged-300.app', '.bh-staged-200.app'
			],
			inStore: ['BaseHalf-0.5.0.zip', 'BaseHalf-0.4.1.zip.part', 'BaseHalf-0.6.0.zip.part', 'BaseHalf-0.6.0.zip', 'extract-300', 'extract-100', 'extract-200', 'notes.txt'],
			inTemporaryFolder: ['bh-update-300', 'bh-update-200', 'bh-update-100', 'bh-update-store-x', 'other']
		};

		assert.deepStrictEqual({
			alone: baseHalfUpdateLeftovers(entries, '0.5.0', 100, pid => alive.has(pid), false),
			// The other run may be the one that still executes from the bundle that 300 renamed aside.
			besideAnotherRun: baseHalfUpdateLeftovers(entries, '0.5.0', 100, pid => alive.has(pid), true).besideBundle
		}, {
			alone: {
				// 100 is this run and 200 is another one that is alive: what they own stays.
				besideBundle: ['.bh-staged-0.5.0.app', '.bh-staged-0.4.1.app', '.bh-staging-300.app', '.bh-previous-300.app', '.bh-staged-300.app'],
				inStore: ['BaseHalf-0.5.0.zip', 'BaseHalf-0.4.1.zip.part', 'extract-300'],
				inTemporaryFolder: ['bh-update-300']
			},
			besideAnotherRun: ['.bh-staged-0.5.0.app', '.bh-staged-0.4.1.app', '.bh-staging-300.app', '.bh-staged-300.app']
		});
	});

	test('the swap puts the staged copy in the bundle\'s place, and puts the bundle back when it cannot', () => {
		const installed = bundle('BaseHalf.app', '0.5.0');
		const staged = bundle('.bh-staged-0.6.0.app', '0.6.0');
		baseHalfSwapIn(installed, staged, 4242);
		const swapped = [baseHalfBundleVersion(installed), baseHalfBundleVersion(join(folder, '.bh-previous-4242.app')), existsSync(staged)];

		// The staged copy is gone: another run took it.
		let refusal = 'swapped';
		try {
			baseHalfSwapIn(installed, staged, 4343);
		} catch (error) {
			refusal = (error as NodeJS.ErrnoException).code ?? 'an error';
		}

		assert.deepStrictEqual({ swapped, refusal, after: [baseHalfBundleVersion(installed), existsSync(join(folder, '.bh-previous-4343.app'))] },
			{ swapped: ['0.6.0', '0.5.0', false], refusal: 'ENOENT', after: ['0.6.0', false] });
	});

	test('a download starts, continues a partial file, starts again when the server sends the whole file, and is not asked for when it is complete', async () => {
		const length = archive.byteLength;
		const read = (path: string) => readFileSync(path).toString();

		const fresh = join(folder, 'fresh.part');
		const first = server(true);
		const progress: number[] = [];
		await baseHalfDownloadArchive({ partialPath: fresh, length, request: first.request, onProgress: received => progress.push(received) });

		// 40% is there from a run that was quit.
		const partial = join(folder, 'partial.part');
		writeFileSync(partial, archive.slice(0, 20).buffer);
		const second = server(true);
		const continued: number[] = [];
		await baseHalfDownloadArchive({ partialPath: partial, length, request: second.request, onProgress: received => continued.push(received) });

		// The server does not continue: the file is started again and not appended to.
		const restarted = join(folder, 'restarted.part');
		writeFileSync(restarted, archive.slice(0, 20).buffer);
		const third = server(false);
		await baseHalfDownloadArchive({ partialPath: restarted, length, request: third.request });

		// Everything is there already.
		const complete = join(folder, 'complete.part');
		writeFileSync(complete, archive.buffer);
		const fourth = server(true);
		await baseHalfDownloadArchive({ partialPath: complete, length, request: fourth.request });

		assert.deepStrictEqual({
			fresh: [read(fresh) === archive.toString(), first.requests, progress[progress.length - 1]],
			continued: [read(partial) === archive.toString(), second.requests, continued[0] > 20, continued[continued.length - 1]],
			restarted: [read(restarted) === archive.toString(), third.requests],
			complete: [read(complete) === archive.toString(), fourth.requests]
		}, {
			fresh: [true, [0], length],
			continued: [true, [20], true, length],
			restarted: [true, [20]],
			complete: [true, []]
		});
	});

	test('a transfer that ends early leaves the file for the next try, and a file that is too long is deleted', async () => {
		const length = archive.byteLength;
		const outcome = (promise: Promise<void>) => promise.then(() => 'done', error => (error as Error).message);

		// The connection is lost after 30 bytes. The next try asks for the rest.
		const interrupted = join(folder, 'interrupted.part');
		const lost = server(true, { endsAfter: 30 });
		const early = await outcome(baseHalfDownloadArchive({ partialPath: interrupted, length, request: lost.request }));
		const keptBytes = readFileSync(interrupted).byteLength;
		const again = server(true);
		await baseHalfDownloadArchive({ partialPath: interrupted, length, request: again.request });

		// The server sends more than the manifest says.
		const tooLong = join(folder, 'too-long.part');
		const more = await outcome(baseHalfDownloadArchive({ partialPath: tooLong, length, request: server(true, { sends: VSBuffer.concat([archive, archive]) }).request }));

		// A partial file that is longer than the manifest says is not continued.
		const stale = join(folder, 'stale.part');
		writeFileSync(stale, VSBuffer.concat([archive, archive]).buffer);
		const fromTheStart = server(true);
		await baseHalfDownloadArchive({ partialPath: stale, length, request: fromTheStart.request });

		// The server refuses. A partial file stays, unless the server says that it has no bytes after it.
		const answers = (statusCode: number) => async () => {
			const stream = newWriteableBufferStream();
			queueMicrotask(() => stream.end());
			return { statusCode, stream };
		};
		const refusedPath = join(folder, 'refused.part');
		writeFileSync(refusedPath, archive.slice(0, 20).buffer);
		const refused = await outcome(baseHalfDownloadArchive({ partialPath: refusedPath, length, request: answers(404) }));
		const keptAfterRefusal = existsSync(refusedPath);
		const noBytesAfter = await outcome(baseHalfDownloadArchive({ partialPath: refusedPath, length, request: answers(416) }));

		// A network that puts a page of its own in place of the file, with a
		// success status: the partial file is not replaced by the page.
		const page = VSBuffer.fromString('<html>Sign in to this network</html>');
		const says = (statusCode: number, about: { readonly contentLength?: number; readonly contentRange?: string }) => async () => {
			const stream = newWriteableBufferStream();
			queueMicrotask(() => {
				stream.write(page);
				stream.end();
			});
			return { statusCode, stream, ...about };
		};
		const keptPath = join(folder, 'kept.part');
		writeFileSync(keptPath, archive.slice(0, 20).buffer);
		const somethingElse = [
			await outcome(baseHalfDownloadArchive({ partialPath: keptPath, length, request: says(200, { contentLength: page.byteLength }) })),
			await outcome(baseHalfDownloadArchive({ partialPath: keptPath, length, request: says(206, { contentRange: `bytes 0-${page.byteLength - 1}/${page.byteLength}` }) })),
			await outcome(baseHalfDownloadArchive({ partialPath: keptPath, length, request: says(206, { contentRange: `bytes 20-${length + 49}/${length + 50}` }) })),
			readFileSync(keptPath).toString() === archive.slice(0, 20).toString()
		];

		assert.deepStrictEqual({
			interrupted: [early, keptBytes, again.requests, readFileSync(interrupted).toString() === archive.toString()],
			tooLong: [more, existsSync(tooLong)],
			stale: [fromTheStart.requests, readFileSync(stale).toString() === archive.toString()],
			refused: [refused, keptAfterRefusal, noBytesAfter, existsSync(refusedPath)],
			somethingElse
		}, {
			interrupted: [`Download incomplete (30 of ${length} bytes).`, 30, [30], true],
			tooLong: ['Archive larger than the manifest says.', false],
			stale: [[0], true],
			refused: ['Download failed (HTTP 404).', true, 'Download failed (HTTP 416).', false],
			somethingElse: ['The server did not send the archive.', 'The server did not send the archive.', 'The server did not send the archive.', true]
		});
	});

	test('a start does not swap under another run, and takes neither its own processes nor what a killed run left for one', () => {
		const installed = '/Applications/BaseHalf.app';
		const helper = (name: string) => `${installed}/Contents/Frameworks/BaseHalf Helper${name}.app/Contents/MacOS/BaseHalf Helper${name}`;
		const thisRun = [
			'    1     0 /sbin/launchd',
			// What started this run from the command line.
			`   90     1 ${installed}/Contents/MacOS/BaseHalf`,
			`  100    90 ${installed}/Contents/MacOS/BaseHalf`,
			`  101   100 ${helper(' (GPU)')}`,
			// A helper of a helper.
			`  102   101 ${helper(' (Plugin)')}`,
			// The crash reporter of this run. Its parent is the system.
			`  103     1 ${installed}/Contents/Frameworks/Electron Framework.framework/Helpers/chrome_crashpad_handler`
		];
		const uses = (...others: string[]) => baseHalfAnotherRunUses([...thisRun, ...others, ''].join('\n'), installed, 100);

		assert.deepStrictEqual({
			alone: uses(),
			anotherRun: uses(`  200     1 ${installed}/Contents/MacOS/BaseHalf`),
			// A main process is listed with the path it was started with. Its helpers show it.
			anotherRunStartedWithARelativePath: uses('  210     1 ./BaseHalf.app/Contents/MacOS/BaseHalf', `  211   210 ${helper(' (Renderer)')}`),
			// What a run that was killed has not ended yet: helpers, and what they started.
			leftOfAKilledRun: uses(`  301     1 ${helper(' (Renderer)')}`, `  302     1 ${installed}/Contents/Frameworks/Electron Framework.framework/Helpers/chrome_crashpad_handler`, `  303   301 ${helper(' (Plugin)')}`, `  304   303 ${helper(' (Plugin)')}`),
			otherApplications: uses('  400     1 /Applications/BaseHalf.app.old/Contents/MacOS/BaseHalf', '  401     1 /Applications/BaseHalf Two.app/Contents/MacOS/BaseHalf', `  402   401 /Users/someone${helper('')}`)
		}, { alone: false, anotherRun: true, anotherRunStartedWithARelativePath: true, leftOfAKilledRun: false, otherApplications: false });
	});

	// ditto, which packs and unpacks an application, is a program of macOS.
	const testOnMac = isMacintosh ? test : test.skip;
	const run = 4242;

	/**
	 * An installed 0.5.0 in a folder of its own, the archive of a release, and
	 * what `baseHalfPrepareUpdate` is given for it. `holds` is the version of
	 * the application in the archive.
	 */
	function release(name: string, holds = '0.6.0') {
		const applications = join(folder, name, 'applications');
		const store = join(folder, name, 'store');
		const installed = bundle('BaseHalf.app', '0.5.0', applications);
		const packaged = bundle('BaseHalf.app', holds, join(folder, name, 'packaged'));
		symlinkSync('Resources', join(packaged, 'Contents', 'Linked'));
		const zip = join(folder, name, 'packaged.zip');
		execFileSync('/usr/bin/ditto', ['-ck', '--keepParent', packaged, zip]);
		const bytes = readFileSync(zip);
		const listed = () => ({ store: existsSync(store) ? readdirSync(store).sort() : null, applications: readdirSync(applications).sort() });
		const prepare = (request: IBaseHalfUpdateToPrepare['request'], more: Partial<IBaseHalfUpdateToPrepare> = {}) => baseHalfPrepareUpdate({
			version: '0.6.0', length: bytes.byteLength, verify: checked => checked.equals(bytes), request, bundle: installed, storePath: store, pid: run, ...more
		});
		return { applications, store, bytes, staged: join(applications, '.bh-staged-0.6.0.app'), holds: (continues = true) => server(continues, { sends: VSBuffer.wrap(bytes) }), listed, prepare };
	}

	testOnMac('an update is prepared: the archive has its final name once it is checked, the staged copy once it is complete, and nothing else is left', async () => {
		const update = release('one');
		const from = update.holds();
		const seen: unknown[] = [];

		const staged = await update.prepare(from.request, {
			verify: bytes => {
				seen.push(update.listed());
				return bytes.equals(update.bytes);
			},
			onUnpacking: () => seen.push(update.listed())
		});

		assert.deepStrictEqual({
			staged: [staged === update.staged, baseHalfBundleVersion(staged), lstatSync(join(staged, 'Contents', 'Linked')).isSymbolicLink()],
			requests: from.requests,
			seen,
			left: update.listed()
		}, {
			staged: [true, '0.6.0', true],
			requests: [0],
			seen: [
				{ store: ['BaseHalf-0.6.0.zip.part'], applications: ['BaseHalf.app'] },
				{ store: ['BaseHalf-0.6.0.zip'], applications: ['BaseHalf.app'] }
			],
			left: { store: [], applications: ['.bh-staged-0.6.0.app', 'BaseHalf.app'] }
		});
	});

	testOnMac('what an earlier run left complete is used: a staged copy and a checked archive without a request, a partial archive from where it ends', async () => {
		// The staged copy is there.
		const stagedBefore = release('staged');
		bundle('.bh-staged-0.6.0.app', '0.6.0', stagedBefore.applications);
		const first = stagedBefore.holds();
		const readyAtOnce = await stagedBefore.prepare(first.request);

		// The checked archive is there. It is checked again and not asked for.
		const archiveBefore = release('archive');
		mkdirSync(archiveBefore.store);
		writeFileSync(join(archiveBefore.store, 'BaseHalf-0.6.0.zip'), archiveBefore.bytes);
		const second = archiveBefore.holds();
		let checks = 0;
		const unpacked = await archiveBefore.prepare(second.request, {
			verify: bytes => {
				checks++;
				return bytes.equals(archiveBefore.bytes);
			}
		});

		// Under the name of a checked archive, with its length, is something else.
		const changedArchive = release('changed');
		mkdirSync(changedArchive.store);
		writeFileSync(join(changedArchive.store, 'BaseHalf-0.6.0.zip'), Buffer.alloc(changedArchive.bytes.byteLength, 1));
		const sixth = changedArchive.holds();
		const fetchedAgain = await changedArchive.prepare(sixth.request);

		// 40% of the archive is there.
		const partBefore = release('part');
		const have = Math.floor(partBefore.bytes.byteLength * 0.4);
		mkdirSync(partBefore.store);
		writeFileSync(join(partBefore.store, 'BaseHalf-0.6.0.zip.part'), partBefore.bytes.subarray(0, have));
		const third = partBefore.holds();
		const continued = await partBefore.prepare(third.request);

		// The same, and the server sends the whole file.
		const wholeAgain = release('whole');
		mkdirSync(wholeAgain.store);
		writeFileSync(join(wholeAgain.store, 'BaseHalf-0.6.0.zip.part'), wholeAgain.bytes.subarray(0, have));
		const fourth = wholeAgain.holds(false);
		const restarted = await wholeAgain.prepare(fourth.request);

		// A checked archive of another length is not the one that is offered.
		const otherArchive = release('other');
		mkdirSync(otherArchive.store);
		writeFileSync(join(otherArchive.store, 'BaseHalf-0.6.0.zip'), 'an archive that was offered before');
		const fifth = otherArchive.holds();
		const replaced = await otherArchive.prepare(fifth.request);

		assert.deepStrictEqual({
			stagedBefore: [readyAtOnce === stagedBefore.staged, first.requests, stagedBefore.listed().store],
			archiveBefore: [baseHalfBundleVersion(unpacked), second.requests, checks, archiveBefore.listed()],
			changedArchive: [baseHalfBundleVersion(fetchedAgain), sixth.requests, changedArchive.listed().store],
			partBefore: [baseHalfBundleVersion(continued), third.requests, partBefore.listed().store],
			wholeAgain: [baseHalfBundleVersion(restarted), fourth.requests],
			otherArchive: [baseHalfBundleVersion(replaced), fifth.requests, otherArchive.listed().store]
		}, {
			stagedBefore: [true, [], null],
			archiveBefore: ['0.6.0', [], 1, { store: [], applications: ['.bh-staged-0.6.0.app', 'BaseHalf.app'] }],
			changedArchive: ['0.6.0', [0], []],
			partBefore: ['0.6.0', [have], []],
			wholeAgain: ['0.6.0', [have]],
			otherArchive: ['0.6.0', [0], []]
		});
	});

	testOnMac('a wrong archive: one with a wrong signature is deleted and the next try asks for all of it, one that was signed and holds another version stays and is not asked for again', async () => {
		const outcome = (promise: Promise<string>) => promise.then(staged => baseHalfBundleVersion(staged) ?? 'no version', error => (error as Error).message);

		const forged = release('forged');
		const first = forged.holds();
		const refused = await outcome(forged.prepare(first.request, { verify: () => false }));
		const afterRefusal = forged.listed();
		const second = forged.holds();
		const then = await outcome(forged.prepare(second.request));

		const mislabeled = release('mislabeled', '0.7.0');
		const third = mislabeled.holds();
		const notThatVersion = await outcome(mislabeled.prepare(third.request));
		const fourth = mislabeled.holds();
		const again = await outcome(mislabeled.prepare(fourth.request));

		assert.deepStrictEqual({
			forged: [refused, afterRefusal, first.requests, then, second.requests],
			mislabeled: [notThatVersion, third.requests, again, fourth.requests, mislabeled.listed()]
		}, {
			forged: ['Signature verification failed — refusing the update.', { store: [], applications: ['BaseHalf.app'] }, [0], '0.6.0', [0]],
			mislabeled: [
				'The archive does not hold exactly one application of version 0.6.0.', [0],
				'The archive does not hold exactly one application of version 0.6.0.', [],
				{ store: ['BaseHalf-0.6.0.zip'], applications: ['BaseHalf.app'] }
			]
		});
	});

	testOnMac('a folder that BaseHalf may not write to is found before the download and not after it, and a staged copy there is not called ready', async () => {
		const update = release('locked');
		const from = update.holds();
		const staged = release('locked-with-a-staged-copy');
		bundle('.bh-staged-0.6.0.app', '0.6.0', staged.applications);
		chmodSync(update.applications, 0o555);
		chmodSync(staged.applications, 0o555);
		try {
			const outcome = (promise: Promise<string>) => promise.then(() => 'prepared', error => (error as Error).message);
			const message = await outcome(update.prepare(from.request));
			const withAStagedCopy = await outcome(staged.prepare(staged.holds().request));

			assert.deepStrictEqual([message, from.requests, update.listed().store, withAStagedCopy, baseHalfCanSwapIn(join(update.applications, 'BaseHalf.app'))],
				['BaseHalf cannot write to the folder it is installed in, so it cannot update itself.', [], null, 'BaseHalf cannot write to the folder it is installed in, so it cannot update itself.', false]);
		} finally {
			chmodSync(update.applications, 0o755);
			chmodSync(staged.applications, 0o755);
		}
	});
});
