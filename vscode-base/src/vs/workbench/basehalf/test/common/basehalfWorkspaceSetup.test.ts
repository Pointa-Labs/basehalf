/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { FileOperationError, FileOperationResult, IFileService } from '../../../../platform/files/common/files.js';
import { applyBaseHalfWorkspaceHint, BASEHALF_WORKSPACE_SETUP_DISABLE_MARKER, BaseHalfWorkspaceSetupService } from '../../common/basehalfWorkspaceSetup.js';

suite('BaseHalfWorkspaceSetup', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

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
			disabledByMarker: false,
			gitignoreUpdated: false, // absent → skipped, never created
			agentHarnessUpdated: true,
			claudeMdUpdated: true,
			agentsMdUpdated: true,
			agentCapabilityCache: 'disabled-no-secure-provider'
		});
		assert.ok(fs.files.get('/work/CLAUDE.md')?.includes('.bh/current_focus.yaml'));
		assert.ok(fs.files.get('/work/AGENTS.md')?.includes('.bh/current_focus.yaml'));
		assert.ok(fs.files.get('/work/AGENTS.md')?.includes('A → B'));
		assert.ok(fs.files.get('/work/AGENTS.md')?.includes('context flows into B'));
		assert.ok(fs.files.get('/work/AGENTS.md')?.includes('one-sided pair is not live'));
		assert.ok(fs.files.get('/work/AGENTS.md')?.includes('Markdown links are ordinary navigation links'));
		assert.ok(fs.files.get('/work/AGENTS.md')?.includes('create its real user file or folder'));
		assert.ok(!fs.files.get('/work/AGENTS.md')?.includes('anchors + labels'));
		assert.ok(fs.files.get('/work/.bh/agent-harness/index.md')?.startsWith('<!-- bh:agent-harness managed'));
		assert.ok(fs.files.has('/work/.bh/agent-harness/scenarios/bh-mirror-writing.md'));
		assert.ok(fs.files.get('/work/.bh/agent-harness/scenarios/bh-mirror-writing.md')?.includes('A context flows into B'));
		assert.ok(fs.files.get('/work/.bh/agent-harness/scenarios/canvas-workflows.md')?.includes('basehalf --list-capabilities'));
		assert.ok(fs.files.get('/work/.bh/agent-harness/scenarios/canvas-workflows.md')?.includes('A\'s direct content is context for B'));
		assert.ok(fs.files.get('/work/.bh/agent-harness/scenarios/canvas-workflows.md')?.includes('for a result node this'));
		assert.ok(fs.files.get('/work/.bh/agent-harness/scenarios/canvas-workflows.md')?.includes('is its selected Current'));
		assert.ok(fs.files.get('/work/.bh/agent-harness/scenarios/canvas-workflows.md')?.includes('never means'));
		assert.ok(!fs.files.get('/work/.bh/agent-harness/scenarios/canvas-workflows.md')?.includes('A\'s selected Current is direct context'));
		assert.strictEqual(fs.files.has('/work/.bh/cache/canvas-capabilities.json'), false);
		assert.strictEqual([...fs.files.values()].some(content => content.includes('canvas-capabilities.json')), false);
		assert.strictEqual(fs.files.has('/work/.gitignore'), false);

		const second = await service.ensureSetup(workspaceFolder);
		assert.deepStrictEqual(second, {
			disabledByMarker: false,
			gitignoreUpdated: false,
			agentHarnessUpdated: false,
			claudeMdUpdated: false,
			agentsMdUpdated: false,
			agentCapabilityCache: 'disabled-no-secure-provider'
		});
	});

	test('tracked opt-out marker prevents every workspace setup write', async () => {
		const agents = '# Development instructions\n';
		const claude = '# Development instructions\n';
		const gitignore = 'node_modules/\n';
		const { service, fs } = createService({
			[`/work/${BASEHALF_WORKSPACE_SETUP_DISABLE_MARKER}`]: 'This repository is not a BaseHalf product workspace.\n',
			'/work/AGENTS.md': agents,
			'/work/CLAUDE.md': claude,
			'/work/.gitignore': gitignore
		});

		const report = await service.ensureSetup(workspaceFolder);

		assert.deepStrictEqual(report, {
			disabledByMarker: true,
			gitignoreUpdated: false,
			agentHarnessUpdated: false,
			claudeMdUpdated: false,
			agentsMdUpdated: false,
			agentCapabilityCache: 'disabled-no-secure-provider'
		});
		assert.strictEqual(fs.files.get('/work/AGENTS.md'), agents);
		assert.strictEqual(fs.files.get('/work/CLAUDE.md'), claude);
		assert.strictEqual(fs.files.get('/work/.gitignore'), gitignore);
		assert.strictEqual(fs.files.has('/work/.bh/agent-harness/index.md'), false);
		assert.deepStrictEqual(fs.createdFolders, []);
	});

	test('keeps automatic capability publication disabled in a normal workspace', async () => {
		const { service, fs } = createService();

		const report = await service.ensureSetup(workspaceFolder);

		assert.strictEqual(report.agentCapabilityCache, 'disabled-no-secure-provider');
		assert.strictEqual(fs.capabilityCacheWriteAttempts, 0);
		assert.strictEqual(fs.createdFolders.includes('/work/.bh/cache'), false);
		assert.strictEqual(fs.files.has('/work/.bh/cache/canvas-capabilities.json'), false);
	});

	test('never reaches a cache write when its parent is replaced before commit', async () => {
		const outside = '/outside/parent-sentinel.json';
		const { service, fs } = createService({ [outside]: 'keep-parent' });
		fs.redirectCapabilityCacheWritesTo = outside;

		const report = await service.ensureSetup(workspaceFolder);

		assert.strictEqual(report.agentCapabilityCache, 'disabled-no-secure-provider');
		assert.strictEqual(fs.capabilityCacheWriteAttempts, 0);
		assert.strictEqual(fs.files.get(outside), 'keep-parent');
	});

	test('never reaches a cache write when its leaf is replaced before commit', async () => {
		const outside = '/outside/leaf-sentinel.json';
		const { service, fs } = createService({ [outside]: 'keep-leaf' });
		fs.redirectCapabilityCacheWritesTo = outside;

		const report = await service.ensureSetup(workspaceFolder);

		assert.strictEqual(report.agentCapabilityCache, 'disabled-no-secure-provider');
		assert.strictEqual(fs.capabilityCacheWriteAttempts, 0);
		assert.strictEqual(fs.files.get(outside), 'keep-leaf');
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
			'/work/.bh/agent-harness/scenarios/canvas-workflows.md': '<!-- bh:agent-harness managed — old -->\n\nretired capability instructions',
			'/work/.bh/agent-harness/scenarios/retired.md': '<!-- bh:agent-harness managed — old -->\n\nretired scenario',
			'/work/.bh/agent-harness/scenarios/user-notes.md': 'my own notes, no sentinel'
		});

		const report = await service.ensureSetup(workspaceFolder);

		assert.strictEqual(report.agentHarnessUpdated, true);
		assert.ok(fs.files.get('/work/.bh/agent-harness/index.md')?.includes('# BaseHalf Agent Harness'));
		assert.ok(fs.files.get('/work/.bh/agent-harness/scenarios/canvas-workflows.md')?.includes('# Canvas Workflows'));
		assert.ok(!fs.files.get('/work/.bh/agent-harness/scenarios/canvas-workflows.md')?.includes('retired capability instructions'));
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
	readonly createdFolders: string[] = [];
	capabilityCacheWriteAttempts = 0;
	redirectCapabilityCacheWritesTo: string | undefined;

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
		if (resource.fsPath === '/work/.bh/cache/canvas-capabilities.json') {
			this.capabilityCacheWriteAttempts += 1;
			if (this.redirectCapabilityCacheWritesTo !== undefined) {
				this.files.set(this.redirectCapabilityCacheWritesTo, buffer.toString());
				return;
			}
		}
		this.files.set(resource.fsPath, buffer.toString());
	}

	async createFolder(resource: URI): Promise<void> {
		this.createdFolders.push(resource.fsPath);
	}

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
