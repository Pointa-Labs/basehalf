/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { FileOperationError, FileOperationResult, IFileService } from '../../../../platform/files/common/files.js';
import { applyBaseHalfWorkspaceHint, BaseHalfWorkspaceSetupService } from '../../common/basehalfWorkspaceSetup.js';

suite('BaseHalfWorkspaceSetup', () => {
	const workspaceFolder = URI.file('/work');

	function createService(initial?: Record<string, string>): { service: BaseHalfWorkspaceSetupService; fs: TestFileSystem } {
		const fs = new TestFileSystem(initial);
		return { service: new BaseHalfWorkspaceSetupService(fs as unknown as IFileService), fs };
	}

	test('applyBaseHalfWorkspaceHint creates, appends, and upgrades idempotently', () => {
		const target = { relPath: 'AGENTS.md', emptyBase: '# AGENTS.md\n' };

		const fresh = applyBaseHalfWorkspaceHint(null, target);
		assert.ok(fresh?.startsWith('# AGENTS.md\n'));
		assert.ok(fresh?.includes('<!-- bh:workspace-hint -->'));
		assert.ok(fresh?.trimEnd().endsWith('<!-- /bh:workspace-hint -->'));

		// Re-applying to the fresh install is a no-op.
		assert.strictEqual(applyBaseHalfWorkspaceHint(fresh, target), null);

		// User content above and below the section is preserved on upgrade.
		const edited = fresh!.replace('## BaseHalf workspace', '## BaseHalf workspace (stale body)') + 'user tail\n';
		const upgraded = applyBaseHalfWorkspaceHint(edited, target);
		assert.ok(upgraded);
		assert.ok(upgraded.includes('## BaseHalf workspace\n'));
		assert.ok(upgraded.endsWith('user tail\n'));

		// Appends to an existing file without markers.
		const appended = applyBaseHalfWorkspaceHint('# Mine\n\nMy own rules.\n', target);
		assert.ok(appended?.startsWith('# Mine\n\nMy own rules.\n\n<!-- bh:workspace-hint -->'));

		// Legacy claude marker upgrades in place.
		const legacy = applyBaseHalfWorkspaceHint('# Mine\n\n<!-- bh:recall-hint -->\nold hint text\n', {
			relPath: 'CLAUDE.md',
			emptyBase: '# CLAUDE.md\n',
			legacyMarker: '<!-- bh:recall-hint -->'
		});
		assert.ok(legacy?.startsWith('# Mine\n\n<!-- bh:workspace-hint -->'));
		assert.ok(!legacy?.includes('old hint text'));
	});

	test('ensureSetup installs hints and harness into an empty workspace and is idempotent', async () => {
		const { service, fs } = createService();

		const first = await service.ensureSetup(workspaceFolder);
		assert.deepStrictEqual(first, {
			gitignoreUpdated: false, // absent → skipped, never created
			agentHarnessUpdated: true,
			claudeMdUpdated: true,
			agentsMdUpdated: true
		});
		assert.ok(fs.files.get('/work/CLAUDE.md')?.includes('.bh/current_focus.yaml'));
		assert.ok(fs.files.get('/work/AGENTS.md')?.includes('.bh/current_focus.yaml'));
		assert.ok(fs.files.get('/work/.bh/agent-harness/index.md')?.startsWith('<!-- bh:agent-harness managed'));
		assert.ok(fs.files.has('/work/.bh/agent-harness/scenarios/bh-mirror-writing.md'));
		assert.strictEqual(fs.files.has('/work/.gitignore'), false);

		const second = await service.ensureSetup(workspaceFolder);
		assert.deepStrictEqual(second, {
			gitignoreUpdated: false,
			agentHarnessUpdated: false,
			claudeMdUpdated: false,
			agentsMdUpdated: false
		});
	});

	test('ensureSetup appends .bh/cache/ to an existing gitignore exactly once', async () => {
		const { service, fs } = createService({
			'/work/.gitignore': 'node_modules/\n'
		});

		const first = await service.ensureSetup(workspaceFolder);
		assert.strictEqual(first.gitignoreUpdated, true);
		assert.ok(fs.files.get('/work/.gitignore')?.includes('.bh/cache/'));
		assert.ok(fs.files.get('/work/.gitignore')?.startsWith('node_modules/\n'));

		const second = await service.ensureSetup(workspaceFolder);
		assert.strictEqual(second.gitignoreUpdated, false);
	});

	test('harness sync overwrites stale managed files and prunes retired ones, keeping user files', async () => {
		const { service, fs } = createService({
			'/work/.bh/agent-harness/index.md': '<!-- bh:agent-harness managed — old --> \n\nstale',
			'/work/.bh/agent-harness/scenarios/retired.md': '<!-- bh:agent-harness managed — old -->\n\nretired scenario',
			'/work/.bh/agent-harness/scenarios/user-notes.md': 'my own notes, no sentinel'
		});

		const report = await service.ensureSetup(workspaceFolder);

		assert.strictEqual(report.agentHarnessUpdated, true);
		assert.ok(fs.files.get('/work/.bh/agent-harness/index.md')?.includes('# BaseHalf Agent Harness'));
		assert.strictEqual(fs.files.has('/work/.bh/agent-harness/scenarios/retired.md'), false);
		assert.strictEqual(fs.files.get('/work/.bh/agent-harness/scenarios/user-notes.md'), 'my own notes, no sentinel');
	});

	test('CRLF checkouts of managed files converge to skip', async () => {
		const { service, fs } = createService();
		await service.ensureSetup(workspaceFolder);

		const index = fs.files.get('/work/.bh/agent-harness/index.md')!;
		fs.files.set('/work/.bh/agent-harness/index.md', index.replace(/\n/g, '\r\n'));

		const report = await service.ensureSetup(workspaceFolder);
		assert.strictEqual(report.agentHarnessUpdated, false);
	});
});

class TestFileSystem {
	readonly files = new Map<string, string>();

	constructor(initial?: Record<string, string>) {
		for (const [path, content] of Object.entries(initial ?? {})) {
			this.files.set(path, content);
		}
	}

	async readFile(resource: URI): Promise<{ value: VSBuffer }> {
		const raw = this.files.get(resource.fsPath);
		if (raw === undefined) {
			throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
		}

		return { value: VSBuffer.fromString(raw) };
	}

	async writeFile(resource: URI, buffer: VSBuffer): Promise<void> {
		this.files.set(resource.fsPath, buffer.toString());
	}

	async createFolder(_resource: URI): Promise<void> { }

	async del(resource: URI): Promise<void> {
		if (!this.files.delete(resource.fsPath)) {
			throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
		}
	}

	async resolve(resource: URI): Promise<{ isSymbolicLink: boolean; children?: Array<{ resource: URI; name: string; isFile: boolean; isDirectory: boolean; isSymbolicLink: boolean }> }> {
		if (this.files.has(resource.fsPath)) {
			return { isSymbolicLink: false };
		}

		const prefix = `${resource.fsPath}/`;
		const names = new Map<string, boolean>();
		let found = false;
		for (const path of this.files.keys()) {
			if (!path.startsWith(prefix)) {
				continue;
			}

			found = true;
			const rest = path.slice(prefix.length);
			const slash = rest.indexOf('/');
			const name = slash === -1 ? rest : rest.slice(0, slash);
			names.set(name, slash !== -1 || (names.get(name) ?? false));
		}

		if (!found) {
			throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
		}

		return {
			isSymbolicLink: false,
			children: [...names.entries()].map(([name, isDirectory]) => ({
				resource: URI.file(`${prefix}${name}`),
				name,
				isFile: !isDirectory,
				isDirectory,
				isSymbolicLink: false
			}))
		};
	}
}
