/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { existsSync, promises } from 'fs';
import { tmpdir } from 'os';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { dirname, join, relative } from '../../../../base/common/path.js';
import { isWindows } from '../../../../base/common/platform.js';
import { URI } from '../../../../base/common/uri.js';
import { Promises } from '../../../../base/node/pfs.js';
import { getRandomTestPath } from '../../../../base/test/node/testUtils.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { FileService } from '../../../../platform/files/common/fileService.js';
import { DiskFileSystemProvider } from '../../../../platform/files/node/diskFileSystemProvider.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { InMemoryStorageService } from '../../../../platform/storage/common/storage.js';
import { UriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentityService.js';
import { IWorkingCopyService } from '../../../services/workingCopy/common/workingCopyService.js';
import { BaseHalfCanvasViewportStateService } from '../../common/basehalfCanvasViewportState.js';
import { BaseHalfLegacyCleanupService } from '../../common/basehalfLegacyCleanup.js';
import { BaseHalfWorkspaceMutationCoordinator } from '../../common/basehalfWorkspaceMutation.js';

const SENTINEL = '<!-- bh:agent-harness managed — regenerated on BaseHalf update; edits are overwritten -->\n\n# Doc\n';

(isWindows ? suite.skip : suite)('BaseHalfLegacyCleanup (disk)', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let root: string;
	let workspace: string;
	let outside: string;
	let store: DisposableStore;
	let service: BaseHalfLegacyCleanupService;
	let viewportState: BaseHalfCanvasViewportStateService;

	setup(async () => {
		root = getRandomTestPath(tmpdir(), 'vsctests', 'basehalflegacycleanup');
		workspace = join(root, 'work');
		outside = join(root, 'outside');
		await promises.mkdir(workspace, { recursive: true });
		await promises.mkdir(outside, { recursive: true });

		store = disposables.add(new DisposableStore());
		const logService = new NullLogService();
		const fileService = store.add(new FileService(logService));
		store.add(fileService.registerProvider(Schemas.file, store.add(new DiskFileSystemProvider(logService))));
		const uriIdentityService = store.add(new UriIdentityService(fileService));
		viewportState = store.add(new BaseHalfCanvasViewportStateService(store.add(new InMemoryStorageService()), uriIdentityService));
		service = new BaseHalfLegacyCleanupService(
			fileService,
			logService,
			new BaseHalfWorkspaceMutationCoordinator(),
			viewportState,
			{ isDirty: () => false } as Partial<IWorkingCopyService> as IWorkingCopyService,
			{ getValue: () => undefined } as Partial<IConfigurationService> as IConfigurationService
		);
	});

	teardown(async () => {
		store.dispose();
		await Promises.rm(root);
	});

	async function write(path: string, content: string): Promise<void> {
		await promises.mkdir(dirname(path), { recursive: true });
		await promises.writeFile(path, content);
	}

	async function link(path: string, target: string, type: 'file' | 'dir' = 'file'): Promise<void> {
		await promises.mkdir(dirname(path), { recursive: true });
		await promises.symlink(target, path, type);
	}

	async function tree(directory: string): Promise<string[]> {
		const out: string[] = [];
		const walk = async (current: string) => {
			for (const entry of await promises.readdir(current, { withFileTypes: true })) {
				const path = join(current, entry.name);
				out.push(`${relative(root, path)}${entry.isSymbolicLink() ? ' -> link' : entry.isDirectory() ? '/' : ''}`);
				if (entry.isDirectory() && !entry.isSymbolicLink()) {
					await walk(path);
				}
			}
		};
		await walk(directory);
		return out.sort();
	}

	test('deletes the current-focus link and leftover temporary links, never their targets', async () => {
		await write(join(workspace, 'notes.md'), 'user note\n');
		await write(join(workspace, '.bh', 'mirror', 'focus.yaml'), 'path: ""\nkind: folder\nviewport_center:\n  x: 5\n  y: 6\nzoom: 1.5\n');
		// A link that escaped the mirror still only loses the link itself.
		await link(join(workspace, '.bh', 'current_focus.yaml'), '../notes.md');
		await link(join(workspace, '.bh', 'current_focus.yaml.4242.1700000000000.k3j2.tmp'), 'mirror/gone/focus.yaml');

		const report = await service.cleanWorkspaceFolder(URI.file(workspace));

		assert.deepStrictEqual({
			removed: [...report.removedFiles].sort(),
			failed: report.failed,
			tree: await tree(workspace),
			noteIntact: await promises.readFile(join(workspace, 'notes.md'), 'utf8'),
			viewport: viewportState.get(URI.file(workspace))
		}, {
			removed: ['.bh/current_focus.yaml', '.bh/current_focus.yaml.4242.1700000000000.k3j2.tmp', '.bh/mirror/focus.yaml'],
			failed: [],
			tree: ['work/.bh/', 'work/.bh/mirror/', 'work/notes.md'],
			noteIntact: 'user note\n',
			viewport: { x: 5, y: 6, zoom: 1.5, source: 'import' }
		});
	});

	test('never descends into or deletes through symbolically linked directories at any depth', async () => {
		await write(join(outside, 'focus.yaml'), 'path: "x"\nkind: folder\nviewport_center:\n  x: 1\n  y: 1\nzoom: 1\n');
		await write(join(outside, 'deep', 'focus.yaml'), 'path: "x"\nkind: file\n');
		await write(join(outside, 'harness', 'index.md'), SENTINEL);
		await link(join(workspace, '.bh', 'mirror', 'linked'), outside, 'dir');
		await link(join(workspace, '.bh', 'mirror', 'a', 'b'), join(outside, 'deep'), 'dir');
		await write(join(workspace, '.bh', 'mirror', 'a', 'focus.yaml'), 'path: "a"\nkind: file\n');
		await link(join(workspace, '.bh', 'agent-harness'), join(outside, 'harness'), 'dir');

		const report = await service.cleanWorkspaceFolder(URI.file(workspace));

		assert.deepStrictEqual({
			removed: report.removedFiles,
			outside: await tree(outside),
			workspace: await tree(workspace)
		}, {
			removed: ['.bh/mirror/a/focus.yaml'],
			outside: ['outside/deep/', 'outside/deep/focus.yaml', 'outside/focus.yaml', 'outside/harness/', 'outside/harness/index.md'],
			workspace: ['work/.bh/', 'work/.bh/agent-harness -> link', 'work/.bh/mirror/', 'work/.bh/mirror/a/', 'work/.bh/mirror/a/b -> link', 'work/.bh/mirror/linked -> link']
		});
	});

	test('spares a linked focus.yaml, a directory named focus.yaml, focus-looking user files, and user harness files', async () => {
		await write(join(outside, 'focus.yaml'), 'path: "linked"\nkind: file\n');
		await link(join(workspace, '.bh', 'mirror', 'linked', 'focus.yaml'), join(outside, 'focus.yaml'));
		// The mirror directory of a user file named `x/focus.yaml`.
		await write(join(workspace, '.bh', 'mirror', 'x', 'focus.yaml', 'badge.yaml'), 'description: mine\n');
		await write(join(workspace, '.bh', 'current_focus.yaml'), 'my: own notes\n');
		await write(join(workspace, '.bh', 'agent-harness', 'scenarios', 'mine.md'), 'my scenario\n');
		await write(join(workspace, '.bh', 'agent-harness', 'scenarios', 'open-file-editing.md'), SENTINEL);
		await write(join(workspace, '.bh', 'agent-harness', 'index.md'), SENTINEL);

		const report = await service.cleanWorkspaceFolder(URI.file(workspace));

		assert.deepStrictEqual({
			removed: [...report.removedFiles].sort(),
			removedDirectories: report.removedDirectories,
			kept: report.kept.map(item => item.path),
			workspace: await tree(workspace),
			linkTarget: existsSync(join(outside, 'focus.yaml'))
		}, {
			removed: ['.bh/agent-harness/index.md', '.bh/agent-harness/scenarios/open-file-editing.md'],
			removedDirectories: [],
			kept: ['.bh/current_focus.yaml'],
			workspace: [
				'work/.bh/',
				'work/.bh/agent-harness/',
				'work/.bh/agent-harness/scenarios/',
				'work/.bh/agent-harness/scenarios/mine.md',
				'work/.bh/current_focus.yaml',
				'work/.bh/mirror/',
				'work/.bh/mirror/linked/',
				'work/.bh/mirror/linked/focus.yaml -> link',
				'work/.bh/mirror/x/',
				'work/.bh/mirror/x/focus.yaml/',
				'work/.bh/mirror/x/focus.yaml/badge.yaml'
			],
			linkTarget: true
		});
	});

	test('skips a folder whose .bh is a symbolic link', async () => {
		await write(join(outside, 'mirror', 'focus.yaml'), 'path: ""\nkind: folder\n');
		await link(join(outside, 'current_focus.yaml'), 'mirror/focus.yaml');
		await link(join(workspace, '.bh'), outside, 'dir');

		const report = await service.cleanWorkspaceFolder(URI.file(workspace));

		assert.deepStrictEqual({ skipped: report.skipped, outside: await tree(outside) }, {
			skipped: 'symbolicLink',
			outside: ['outside/current_focus.yaml -> link', 'outside/mirror/', 'outside/mirror/focus.yaml']
		});
	});

	test('removes the harness directories once the sentinel files leave them empty', async () => {
		await write(join(workspace, '.bh', 'agent-harness', 'index.md'), SENTINEL);
		await write(join(workspace, '.bh', 'agent-harness', 'scenarios', 'canvas-workflows.md'), SENTINEL);
		await write(join(workspace, '.bh', 'mirror', 'docs', 'focus.yaml'), 'path: "docs"\nkind: folder\n');
		await write(join(workspace, '.bh', 'mirror', 'badge.yaml'), 'description: root\n');

		const report = await service.cleanWorkspaceFolder(URI.file(workspace));

		assert.deepStrictEqual({ directories: [...report.removedDirectories].sort(), workspace: await tree(workspace) }, {
			directories: ['.bh/agent-harness', '.bh/agent-harness/scenarios', '.bh/mirror/docs'],
			workspace: ['work/.bh/', 'work/.bh/mirror/', 'work/.bh/mirror/badge.yaml']
		});
	});
});
