/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from 'assert';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from '../../../../base/common/path.js';
import { downloadFile } from '../../node/download.js';
import { ProviderFailure } from '../../node/failure.js';
import { BoundHttp, parseEndpoint, resolveHttpOptions } from '../../node/http.js';
import { isoMedia } from './providerTestKit.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('BaseHalf providers: providerInlineVideo', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const VIDEO = isoMedia(2);
	const folder = mkdtempSync(join(tmpdir(), 'basehalf-provider-inline-'));
	suiteTeardown(() => rmSync(folder, { recursive: true, force: true }));

	let parts = 0;
	function partPath(): string {
		return join(folder, `video-${parts++}.mp4.part`);
	}

	/** An endpoint nothing listens on: a video answered inline is never requested. */
	function bound(): BoundHttp {
		return new BoundHttp(parseEndpoint('https://api.example.com/v1'), () => ({ Authorization: 'Bearer sk-inline-secret' }), undefined, resolveHttpOptions({ sleep: async () => undefined }));
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

	test('a video the provider answered inline is written to the new .part file, also from a view into a larger buffer', async () => {
		const target = partPath();
		const { size, format } = await downloadFile(bound(), { bytes: VIDEO }, target, 'video');
		const backing = new Uint8Array(VIDEO.byteLength + 16);
		backing.set(VIDEO, 16);
		const viewTarget = partPath();
		const { size: viewSize } = await downloadFile(bound(), { bytes: backing.subarray(16) }, viewTarget, 'video');
		assert.deepEqual({ size, format, same: readFileSync(target).equals(VIDEO), viewSize, viewSame: readFileSync(viewTarget).equals(VIDEO) }, {
			size: VIDEO.byteLength,
			format: 'mp4',
			same: true,
			viewSize: VIDEO.byteLength,
			viewSame: true
		});
	});

	test('an inline video is held to the checks of a download: an MP4, at most the size BaseHalf downloads, a new .part file, and no file left', async () => {
		const outcome = async (bytes: Uint8Array, target = partPath(), maxBytes?: number) => {
			const failed = await failure(downloadFile(bound(), { bytes }, target, 'video', maxBytes !== undefined ? { maxBytes } : {}));
			return { code: failed.code, message: failed.message.replace(/: .*$/, ''), left: existsSync(target) };
		};
		const taken = partPath();
		writeFileSync(taken, 'another download');
		assert.deepEqual({
			page: await outcome(Buffer.from('<html>not a video</html>')),
			short: await outcome(Buffer.from('abc')),
			large: await outcome(VIDEO, partPath(), 1024),
			taken: { ...await outcome(VIDEO, taken), kept: readFileSync(taken, 'utf8') },
			notPart: await outcome(VIDEO, join(folder, 'video.mp4'))
		}, {
			page: { code: 'notVideo', message: 'The file does not start like an MP4 video.', left: false },
			short: { code: 'notVideo', message: 'The file is too short to be an MP4 video.', left: false },
			large: { code: 'tooLarge', message: `The video is ${VIDEO.byteLength} bytes, more than the 1024 bytes BaseHalf downloads.`, left: false },
			taken: { code: 'rejected', message: 'BaseHalf could not create the download file', left: true, kept: 'another download' },
			notPart: { code: 'rejected', message: 'BaseHalf writes a download only to a new .part file.', left: false }
		});
	});
});
