/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BaseHalfMirrorLinkMainService } from '../../electron-main/basehalfMirrorLinkMainService.js';

suite('BaseHalfMirrorLinkMainService', () => {
	test('creates and updates current_focus.yaml as a relative symlink', async () => {
		const dir = await fs.mkdtemp(join(tmpdir(), 'basehalf-link-'));
		try {
			const currentFocus = join(dir, '.bh', 'current_focus.yaml');
			const service = new BaseHalfMirrorLinkMainService();

			await service.setCurrentFocusSymlink(currentFocus, 'mirror/focus.yaml');
			assert.strictEqual(await fs.readlink(currentFocus), 'mirror/focus.yaml');

			await service.setCurrentFocusSymlink(currentFocus, 'mirror/docs/readme.md/focus.yaml');
			assert.strictEqual(await fs.readlink(currentFocus), 'mirror/docs/readme.md/focus.yaml');
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	test('refuses to replace a non-symlink current_focus.yaml', async () => {
		const dir = await fs.mkdtemp(join(tmpdir(), 'basehalf-link-'));
		try {
			const currentFocus = join(dir, '.bh', 'current_focus.yaml');
			await fs.mkdir(join(dir, '.bh'), { recursive: true });
			await fs.writeFile(currentFocus, 'path: ""\nkind: folder\n');

			const service = new BaseHalfMirrorLinkMainService();
			await assert.rejects(
				() => service.setCurrentFocusSymlink(currentFocus, 'mirror/focus.yaml'),
				/Refusing to replace non-symlink/
			);
			assert.strictEqual(await fs.readFile(currentFocus, 'utf8'), 'path: ""\nkind: folder\n');
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	test('rejects paths and targets outside the current_focus contract', async () => {
		const service = new BaseHalfMirrorLinkMainService();

		await assert.rejects(
			() => service.setCurrentFocusSymlink('/tmp/basehalf-current-focus.yaml', 'mirror/focus.yaml'),
			/only manages .bh\/current_focus.yaml/
		);
		await assert.rejects(
			() => service.setCurrentFocusSymlink('/tmp/.bh/current_focus.yaml', '../mirror/focus.yaml'),
			/Invalid current_focus.yaml target/
		);
		await assert.rejects(
			() => service.setCurrentFocusSymlink('/tmp/.bh/current_focus.yaml', '/mirror/focus.yaml'),
			/Invalid current_focus.yaml target/
		);
		await assert.rejects(
			() => service.setCurrentFocusSymlink('/tmp/.bh/current_focus.yaml', 'mirror/canvas.yaml'),
			/mirror focus.yaml/
		);
	});
});

