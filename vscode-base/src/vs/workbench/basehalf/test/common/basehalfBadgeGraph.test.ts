/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { FileOperationError, FileOperationResult, IFileService } from '../../../../platform/files/common/files.js';
import { BaseHalfBadgeGraphService } from '../../common/basehalfBadgeGraph.js';
import { BaseHalfBadgeKind, BaseHalfBadgeMirrorService, IBaseHalfBadgeNode } from '../../common/basehalfBadgeMirror.js';

suite('BaseHalfBadgeGraphService', () => {
	const workspaceFolder = URI.file('/work');

	function node(relativePath: string, kind: BaseHalfBadgeKind = 'file'): IBaseHalfBadgeNode {
		return {
			resource: relativePath ? URI.joinPath(workspaceFolder, ...relativePath.split('/')) : workspaceFolder,
			workspaceFolder,
			relativePath,
			kind
		};
	}

	function badgeYaml(path: string, fields?: { kind?: string; description?: string; references?: string[]; referenced_by?: string[]; orphan?: boolean }): string {
		const lines = [`path: ${JSON.stringify(path)}`, `kind: ${fields?.kind ?? 'file'}`];
		if (fields?.description) {
			lines.push(`description: ${JSON.stringify(fields.description)}`);
		}
		lines.push(fields?.references?.length ? `references:\n${fields.references.map(r => `  - ${JSON.stringify(r)}`).join('\n')}` : 'references: []');
		lines.push(fields?.referenced_by?.length ? `referenced_by:\n${fields.referenced_by.map(r => `  - ${JSON.stringify(r)}`).join('\n')}` : 'referenced_by: []');
		if (fields?.orphan) {
			lines.push('orphan: true');
		}
		lines.push('');
		return lines.join('\n');
	}

	function badgePath(rel: string): string {
		return `/work/.bh/mirror/${rel}/badge.yaml`;
	}

	function createServices(initial?: Record<string, string>): { graph: BaseHalfBadgeGraphService; fs: TestFileSystem } {
		const fs = new TestFileSystem(initial);
		const mirror = new BaseHalfBadgeMirrorService(fs as unknown as IFileService);
		const graph = new BaseHalfBadgeGraphService(mirror, fs as unknown as IFileService);
		return { graph, fs };
	}

	test('addReference records both directions, materializing a stub target badge', async () => {
		const { graph, fs } = createServices();

		await graph.addReference(node('a.md'), node('b.md'));

		assert.strictEqual(fs.files.get(badgePath('a.md')), badgeYaml('a.md', { references: ['b.md'] }));
		assert.strictEqual(fs.files.get(badgePath('b.md')), badgeYaml('b.md', { referenced_by: ['a.md'] }));
	});

	test('addReference rejects a self-reference', async () => {
		const { graph } = createServices();

		assert.throws(() => graph.addReference(node('a.md'), node('a.md')));
	});

	test('removeReference scrubs both directions and prunes emptied stubs', async () => {
		const { graph, fs } = createServices();
		await graph.addReference(node('a.md'), node('b.md'));

		await graph.removeReference(node('a.md'), node('b.md'));

		assert.strictEqual(fs.files.has(badgePath('a.md')), false);
		assert.strictEqual(fs.files.has(badgePath('b.md')), false);
	});

	test('removeReference keeps badges that still carry authored content', async () => {
		const { graph, fs } = createServices({
			[badgePath('a.md')]: badgeYaml('a.md', { description: 'Alpha', references: ['b.md'] }),
			[badgePath('b.md')]: badgeYaml('b.md', { referenced_by: ['a.md'] })
		});

		await graph.removeReference(node('a.md'), node('b.md'));

		assert.strictEqual(fs.files.get(badgePath('a.md')), badgeYaml('a.md', { description: 'Alpha' }));
		assert.strictEqual(fs.files.has(badgePath('b.md')), false);
	});

	test('updateDescription prunes a badge emptied of all content and preserves graph fields otherwise', async () => {
		const { graph, fs } = createServices({
			[badgePath('a.md')]: badgeYaml('a.md', { description: 'Alpha', references: ['b.md'] })
		});

		await graph.updateDescription(node('a.md'), '');
		assert.strictEqual(fs.files.get(badgePath('a.md')), badgeYaml('a.md', { references: ['b.md'] }));

		const { graph: graph2, fs: fs2 } = createServices({
			[badgePath('a.md')]: badgeYaml('a.md', { description: 'Alpha' })
		});
		await graph2.updateDescription(node('a.md'), '   ');
		assert.strictEqual(fs2.files.has(badgePath('a.md')), false);

		const { graph: graph3, fs: fs3 } = createServices();
		await graph3.updateDescription(node('c.md'), 'Fresh note');
		assert.strictEqual(fs3.files.get(badgePath('c.md')), badgeYaml('c.md', { description: 'Fresh note' }));
	});

	test('renameNode moves the badge, rewrites both graph directions, and drops the orphan flag', async () => {
		const { graph, fs } = createServices({
			[badgePath('old.md')]: badgeYaml('old.md', { description: 'Note', references: ['target.md'], referenced_by: ['referrer.md'], orphan: true }),
			[badgePath('target.md')]: badgeYaml('target.md', { referenced_by: ['old.md'] }),
			[badgePath('referrer.md')]: badgeYaml('referrer.md', { references: ['old.md'] })
		});

		await graph.renameNode(workspaceFolder, 'old.md', 'new.md', 'file');

		assert.strictEqual(fs.files.has(badgePath('old.md')), false);
		assert.strictEqual(fs.files.get(badgePath('new.md')), badgeYaml('new.md', { description: 'Note', references: ['target.md'], referenced_by: ['referrer.md'] }));
		assert.strictEqual(fs.files.get(badgePath('target.md')), badgeYaml('target.md', { referenced_by: ['new.md'] }));
		assert.strictEqual(fs.files.get(badgePath('referrer.md')), badgeYaml('referrer.md', { references: ['new.md'] }));
	});

	test('renameNode drops phantom backlinks whose referrer badge no longer exists', async () => {
		const { graph, fs } = createServices({
			[badgePath('old.md')]: badgeYaml('old.md', { description: 'Note', referenced_by: ['gone.md'] })
		});

		await graph.renameNode(workspaceFolder, 'old.md', 'new.md', 'file');

		assert.strictEqual(fs.files.get(badgePath('new.md')), badgeYaml('new.md', { description: 'Note' }));
	});

	test('renameNode on a folder carries annotated descendants and converges intra-subtree references', async () => {
		const { graph, fs } = createServices({
			[badgePath('docs')]: badgeYaml('docs', { kind: 'folder', description: 'Docs' }),
			[badgePath('docs/a.md')]: badgeYaml('docs/a.md', { references: ['docs/b.md'] }),
			[badgePath('docs/b.md')]: badgeYaml('docs/b.md', { description: 'B', referenced_by: ['docs/a.md'] }),
			[badgePath('outside.md')]: badgeYaml('outside.md', { references: ['docs/b.md'] })
		});
		fs.files.set(badgePath('docs/b.md'), badgeYaml('docs/b.md', { description: 'B', referenced_by: ['docs/a.md', 'outside.md'] }));

		await graph.renameNode(workspaceFolder, 'docs', 'notes', 'folder');

		assert.strictEqual(fs.files.has(badgePath('docs')), false);
		assert.strictEqual(fs.files.has(badgePath('docs/a.md')), false);
		assert.strictEqual(fs.files.get(badgePath('notes')), badgeYaml('notes', { kind: 'folder', description: 'Docs' }));
		assert.strictEqual(fs.files.get(badgePath('notes/a.md')), badgeYaml('notes/a.md', { references: ['notes/b.md'] }));
		assert.strictEqual(fs.files.get(badgePath('notes/b.md')), badgeYaml('notes/b.md', { description: 'B', referenced_by: ['notes/a.md', 'outside.md'] }));
		assert.strictEqual(fs.files.get(badgePath('outside.md')), badgeYaml('outside.md', { references: ['notes/b.md'] }));
	});

	test('deleteNode removes the badge and scrubs its backlinks off outbound targets', async () => {
		const { graph, fs } = createServices({
			[badgePath('a.md')]: badgeYaml('a.md', { references: ['b.md'] }),
			[badgePath('b.md')]: badgeYaml('b.md', { description: 'B', referenced_by: ['a.md'] }),
			[badgePath('referrer.md')]: badgeYaml('referrer.md', { description: 'R', references: ['a.md'] })
		});

		await graph.deleteNode(workspaceFolder, 'a.md', 'file');

		assert.strictEqual(fs.files.has(badgePath('a.md')), false);
		assert.strictEqual(fs.files.get(badgePath('b.md')), badgeYaml('b.md', { description: 'B' }));
		// The referrer's outbound reference is ITS authored content — it stays,
		// and the derived canvas edge simply stops drawing.
		assert.strictEqual(fs.files.get(badgePath('referrer.md')), badgeYaml('referrer.md', { description: 'R', references: ['a.md'] }));
	});

	test('deleteNode on a folder purges annotated descendants too', async () => {
		const { graph, fs } = createServices({
			[badgePath('docs')]: badgeYaml('docs', { kind: 'folder', description: 'Docs' }),
			[badgePath('docs/a.md')]: badgeYaml('docs/a.md', { description: 'A' }),
			[badgePath('other.md')]: badgeYaml('other.md', { description: 'Other' })
		});

		await graph.deleteNode(workspaceFolder, 'docs', 'folder');

		assert.strictEqual(fs.files.has(badgePath('docs')), false);
		assert.strictEqual(fs.files.has(badgePath('docs/a.md')), false);
		assert.strictEqual(fs.files.has(badgePath('other.md')), true);
	});

	test('pruneDangling orphans badges whose disk node is gone; clearOrphan revives them', async () => {
		const { graph, fs } = createServices({
			[badgePath('alive.md')]: badgeYaml('alive.md', { description: 'Alive' }),
			[badgePath('dead.md')]: badgeYaml('dead.md', { description: 'Dead' }),
			'/work/alive.md': 'content'
		});

		const orphaned = await graph.pruneDangling(workspaceFolder);

		assert.deepStrictEqual(orphaned, ['dead.md']);
		assert.strictEqual(fs.files.get(badgePath('dead.md')), badgeYaml('dead.md', { description: 'Dead', orphan: true }));
		assert.strictEqual(fs.files.get(badgePath('alive.md')), badgeYaml('alive.md', { description: 'Alive' }));

		await graph.clearOrphan(node('dead.md'));
		assert.strictEqual(fs.files.get(badgePath('dead.md')), badgeYaml('dead.md', { description: 'Dead' }));
	});

	test('listBadges walks the sparse mirror and tolerates corrupt entries', async () => {
		const { graph } = createServices({
			[badgePath('a.md')]: badgeYaml('a.md', { description: 'Alpha' }),
			[badgePath('docs/deep/b.md')]: badgeYaml('docs/deep/b.md', { description: 'Deep' }),
			[badgePath('bad.md')]: 'path: [unterminated'
		});

		const result = await graph.listBadges(workspaceFolder);

		assert.deepStrictEqual([...result.badges.keys()], ['a.md', 'docs/deep/b.md']);
		assert.strictEqual(result.problems.length, 1);
		assert.strictEqual(result.problems[0].relativePath, 'bad.md');
	});
});

/**
 * In-memory file system implementing the IFileService subset the badge layers
 * touch: read/write/delete/exists for YAML IO, stat for the orphan sweep's
 * disk probe, and resolve for the mirror-tree walk (directories are implied by
 * deeper keys, the same way a real FS lists them).
 */
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

	async exists(resource: URI): Promise<boolean> {
		return this.files.has(resource.fsPath) || this.isDirectory(resource.fsPath);
	}

	async stat(resource: URI): Promise<{ isFile: boolean; isDirectory: boolean }> {
		if (this.files.has(resource.fsPath)) {
			return { isFile: true, isDirectory: false };
		}
		if (this.isDirectory(resource.fsPath)) {
			return { isFile: false, isDirectory: true };
		}

		throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
	}

	async resolve(resource: URI): Promise<{ children: Array<{ resource: URI; name: string; isFile: boolean; isDirectory: boolean; isSymbolicLink: boolean }> }> {
		const prefix = `${resource.fsPath}/`;
		if (!this.isDirectory(resource.fsPath)) {
			throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
		}

		const names = new Map<string, boolean>();
		for (const path of this.files.keys()) {
			if (!path.startsWith(prefix)) {
				continue;
			}

			const rest = path.slice(prefix.length);
			const slash = rest.indexOf('/');
			const name = slash === -1 ? rest : rest.slice(0, slash);
			names.set(name, slash !== -1 || (names.get(name) ?? false));
		}

		return {
			children: [...names.entries()].map(([name, isDirectory]) => ({
				resource: URI.file(`${prefix}${name}`),
				name,
				isFile: !isDirectory,
				isDirectory,
				isSymbolicLink: false
			}))
		};
	}

	private isDirectory(path: string): boolean {
		const prefix = `${path}/`;
		for (const key of this.files.keys()) {
			if (key.startsWith(prefix)) {
				return true;
			}
		}
		return false;
	}
}
