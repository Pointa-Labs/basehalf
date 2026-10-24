/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from 'assert';
import { constants, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { copyFile, link, lstat, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from '../../../../base/common/path.js';
import { VideoProviderCommands } from '../../node/commands.js';
import { ProviderFailure } from '../../node/failure.js';
import { placeFile, type PlaceFileSystem } from '../../node/place.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('BaseHalf providers: providerPlace', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const root = mkdtempSync(join(tmpdir(), 'basehalf-provider-place-'));
	suiteTeardown(() => rmSync(root, { recursive: true, force: true }));

	let workspaces = 0;
	/** A workspace folder with a `shots` folder and a partial download that holds `bytes`. */
	function workspace(bytes = 'complete bytes of a video'): { readonly folder: string; readonly part: string; readonly shots: string } {
		const folder = join(root, `workspace-${workspaces++}`);
		const cache = join(folder, '.bh', 'cache', 'generation');
		mkdirSync(cache, { recursive: true });
		mkdirSync(join(folder, 'shots'));
		const part = join(cache, '20261022T080000-abcd1234-1.part');
		writeFileSync(part, bytes);
		return { folder, part, shots: join(folder, 'shots') };
	}

	/** Node's file system, with every call kept, and `link` answering `linkError` when given. */
	function recordingFiles(linkError?: string): PlaceFileSystem & { readonly calls: string[] } {
		const calls: string[] = [];
		return {
			calls,
			lstat: path => {
				calls.push('lstat');
				return lstat(path);
			},
			link: async (from, to) => {
				calls.push('link');
				if (linkError) {
					throw Object.assign(new Error(`${linkError}: cross-device link not permitted`), { code: linkError });
				}
				return link(from, to);
			},
			copyFile: (from, to, mode) => {
				calls.push(`copyFile ${(mode & constants.COPYFILE_EXCL) ? 'exclusive' : 'replacing'}`);
				return copyFile(from, to, mode);
			},
			unlink: path => {
				calls.push('unlink');
				return unlink(path);
			}
		};
	}

	async function failure(promise: Promise<unknown>): Promise<ProviderFailure> {
		try {
			await promise;
		} catch (caught) {
			assert.ok(caught instanceof ProviderFailure, `expected a ProviderFailure, got ${String(caught)}`);
			return caught;
		}
		assert.fail('expected a failure');
	}

	test('a received file gets its card\'s name by a hard link, so the name holds the whole file at once, and the partial download goes', async () => {
		const { part, shots } = workspace();
		const files = recordingFiles();
		const partInode = statSync(part).ino;
		const to = join(shots, 'video.mp4');
		const result = await placeFile(part, to, files);
		assert.deepEqual({
			result,
			calls: files.calls,
			bytes: readFileSync(to, 'utf8'),
			sameFile: statSync(to).ino === partInode,
			part: existsSync(part),
			folder: readdirSync(shots)
		}, {
			result: { placed: true },
			calls: ['lstat', 'link', 'unlink'],
			bytes: 'complete bytes of a video',
			sameFile: true,
			part: false,
			folder: ['video.mp4']
		});
	});

	test('a name a file already has answers exists, and neither file changes', async () => {
		const { part, shots } = workspace();
		const to = join(shots, 'video.mp4');
		writeFileSync(to, 'the user\'s file');
		const refused = await failure(placeFile(part, to, recordingFiles()));
		assert.deepEqual({ refused: [refused.code, refused.message], user: readFileSync(to, 'utf8'), part: readFileSync(part, 'utf8') }, {
			refused: ['exists', 'A file already has this name.'],
			user: 'the user\'s file',
			part: 'complete bytes of a video'
		});
	});

	test('where the file system cannot link, the bytes are copied straight to the name by an exclusive create, which never replaces a file either', async () => {
		const first = workspace();
		const files = recordingFiles('EXDEV');
		const to = join(first.shots, 'video.mp4');
		const result = await placeFile(first.part, to, files);
		const second = workspace();
		const taken = join(second.shots, 'video.mp4');
		writeFileSync(taken, 'the user\'s file');
		const refused = await failure(placeFile(second.part, taken, recordingFiles('EXDEV')));
		assert.deepEqual({
			result,
			calls: files.calls,
			bytes: readFileSync(to, 'utf8'),
			part: existsSync(first.part),
			refused: refused.code,
			user: readFileSync(taken, 'utf8'),
			kept: existsSync(second.part)
		}, {
			result: { placed: true },
			calls: ['lstat', 'link', 'copyFile exclusive', 'unlink'],
			bytes: 'complete bytes of a video',
			part: false,
			refused: 'exists',
			user: 'the user\'s file',
			kept: true
		});
	});

	test('a copy that fails takes back what it wrote, and keeps the partial download', async () => {
		const { part, shots } = workspace();
		const to = join(shots, 'video.mp4');
		const files: PlaceFileSystem = {
			...recordingFiles('EXDEV'),
			copyFile: async (_from, destination) => {
				writeFileSync(destination, 'half of the');
				throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
			}
		};
		const refused = await failure(placeFile(part, to, files));
		assert.deepEqual({ refused: refused.code, left: existsSync(to), part: readFileSync(part, 'utf8') }, { refused: 'rejected', left: false, part: 'complete bytes of a video' });
	});

	test('it puts in place only a partial download of .bh/cache/generation/, only at a name of its workspace folder outside .bh/, and touches nothing otherwise', async () => {
		const { folder, part, shots } = workspace();
		const elsewhere = join(root, 'elsewhere.mp4');
		const stray = join(shots, 'stray.part');
		writeFileSync(stray, 'not a download');
		const refusals = await Promise.all([
			failure(placeFile(stray, join(shots, 'a.mp4'))),
			failure(placeFile(part, elsewhere)),
			failure(placeFile(part, join(folder, '.bh', 'mirror', 'a.mp4'))),
			failure(placeFile(part, join(shots, 'b.mp4.part'))),
			failure(placeFile(part, 'shots/relative.mp4')),
			failure(placeFile(join(folder, '.bh', 'cache', 'generation', 'gone-1.part'), join(shots, 'c.mp4')))
		]);
		assert.deepEqual({
			codes: refusals.map(refused => refused.code),
			shots: readdirSync(shots).sort(),
			elsewhere: existsSync(elsewhere),
			part: existsSync(part)
		}, {
			codes: ['rejected', 'rejected', 'rejected', 'rejected', 'rejected', 'rejected'],
			shots: ['stray.part'],
			elsewhere: false,
			part: true
		});
	});

	test('the place command validates its payload and answers placed, or exists for a name that is taken', async () => {
		const { part, shots } = workspace();
		const providers = new VideoProviderCommands(undefined, { files: recordingFiles() });
		const unreadable = await providers.place({ from: part });
		const placed = await providers.place({ from: part, to: join(shots, 'video.mp4') });
		const again = workspace();
		writeFileSync(join(again.shots, 'video.mp4'), 'taken');
		const taken = await providers.place({ from: again.part, to: join(again.shots, 'video.mp4') });
		assert.deepEqual({ unreadable, placed, taken }, {
			unreadable: { ok: false, error: { code: 'rejected', message: 'BaseHalf received a file to put in place it cannot read.' } },
			placed: { ok: true, value: { placed: true } },
			taken: { ok: false, error: { code: 'exists', message: 'A file already has this name.' } }
		});
	});
});
