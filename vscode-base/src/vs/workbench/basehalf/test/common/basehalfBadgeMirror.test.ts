/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { FileOperationError, FileOperationResult, FileType, IFileService, IFileStat } from '../../../../platform/files/common/files.js';
import { BaseHalfBadgeMirrorCorrupt, BaseHalfBadgeMirrorService, IBaseHalfBadgeNode } from '../../common/basehalfBadgeMirror.js';

suite('BaseHalfBadgeMirrorService', () => {
	const workspaceFolder = URI.file('/work');

	test('maps root, file, and nested folder nodes to badge.yaml resources', () => {
		const service = createService(new Map());

		assert.strictEqual(service.badgeResource(node('', 'folder')).fsPath, '/work/.bh/mirror/badge.yaml');
		assert.strictEqual(service.badgeResource(node('docs/readme.md', 'file')).fsPath, '/work/.bh/mirror/docs/readme.md/badge.yaml');
		assert.strictEqual(service.badgeResource(node('docs/assets', 'folder')).fsPath, '/work/.bh/mirror/docs/assets/badge.yaml');
	});

	test('returns null when badge.yaml is absent', async () => {
		const service = createService(new Map());

		assert.strictEqual(await service.readBadge(node('docs/readme.md', 'file')), null);
	});

	test('reads and normalizes badge.yaml metadata', async () => {
		const service = createService(new Map([
			['/work/.bh/mirror/docs/readme.md/badge.yaml', [
				'path: docs/readme.md',
				'kind: file',
				'description: Project overview',
				'references:',
				'  - docs/next.md',
				'  - docs/next.md',
				'referenced_by:',
				'  - docs/index.md',
				'orphan: true',
				''
			].join('\n')]
		]));

		assert.deepStrictEqual(await service.readBadge(node('docs/readme.md', 'file')), {
			path: 'docs/readme.md',
			kind: 'file',
			description: 'Project overview',
			references: ['docs/next.md'],
			referenced_by: ['docs/index.md'],
			orphan: true
		});
	});

	test('defaults sparse reference arrays when fields are absent', async () => {
		const service = createService(new Map([
			['/work/.bh/mirror/docs/badge.yaml', [
				'path: docs',
				'kind: folder',
				'description: Docs folder',
				''
			].join('\n')]
		]));

		assert.deepStrictEqual(await service.readBadge(node('docs', 'folder')), {
			path: 'docs',
			kind: 'folder',
			description: 'Docs folder',
			references: [],
			referenced_by: []
		});
	});

	test('throws a typed corrupt error for invalid YAML', async () => {
		const service = createService(new Map([
			['/work/.bh/mirror/bad.md/badge.yaml', 'path: [unterminated']
		]));

		await assert.rejects(
			() => service.readBadge(node('bad.md', 'file')),
			error => error instanceof BaseHalfBadgeMirrorCorrupt
		);
	});

	test('throws a typed corrupt error when the path does not match the node', async () => {
		const wrongPath = createService(new Map([
			['/work/.bh/mirror/docs/readme.md/badge.yaml', 'path: docs/other.md\nkind: file\nreferences: []\nreferenced_by: []\n']
		]));
		await assert.rejects(
			() => wrongPath.readBadge(node('docs/readme.md', 'file')),
			error => error instanceof BaseHalfBadgeMirrorCorrupt && error.reason === 'path must be "docs/readme.md"'
		);
	});

	test('trusts the stored kind over the caller guess (a reference target defaults to file)', async () => {
		const service = createService(new Map([
			['/work/.bh/mirror/docs/badge.yaml', 'path: docs\nkind: folder\nreferences: []\nreferenced_by: ["a.md"]\n']
		]));

		const badge = await service.readBadge(node('docs', 'file'));
		assert.strictEqual(badge?.kind, 'folder');

		const invalidKind = createService(new Map([
			['/work/.bh/mirror/docs/badge.yaml', 'path: docs\nkind: link\nreferences: []\nreferenced_by: []\n']
		]));
		await assert.rejects(
			() => invalidKind.readBadge(node('docs', 'folder')),
			error => error instanceof BaseHalfBadgeMirrorCorrupt && error.reason === 'kind must be "file" or "folder"'
		);
	});

	test('readBadges returns valid badges while collecting corrupt metadata problems', async () => {
		const service = createService(new Map([
			['/work/.bh/mirror/a.md/badge.yaml', 'path: a.md\nkind: file\ndescription: Alpha\nreferences: []\nreferenced_by: []\n'],
			['/work/.bh/mirror/b.md/badge.yaml', 'path: b.md\nkind: file\nreferences: [1]\nreferenced_by: []\n']
		]));

		const result = await service.readBadges([
			node('a.md', 'file'),
			node('b.md', 'file'),
			node('missing.md', 'file')
		]);

		assert.deepStrictEqual([...result.badges.keys()], ['a.md']);
		assert.deepStrictEqual(result.badges.get('a.md'), {
			path: 'a.md',
			kind: 'file',
			description: 'Alpha',
			references: [],
			referenced_by: []
		});
		assert.strictEqual(result.problems.length, 1);
		assert.strictEqual(result.problems[0].relativePath, 'b.md');
		assert.strictEqual(result.problems[0].corrupt, true);
	});

	test('replays an absent create race and merges the external badge', async () => {
		const badgePath = '/work/.bh/mirror/docs/readme.md/badge.yaml';
		const fileService = new TestFileService(new Map());
		fileService.createExternallyOnNextCreate(badgePath, [
			'path: "docs/readme.md"',
			'kind: file',
			'references:',
			'  - "external.md"',
			'referenced_by: []',
			''
		].join('\n'));
		const service = mirrorService(fileService);
		let updateCount = 0;

		const updated = await service.patchBadge(node('docs/readme.md', 'file'), current => {
			updateCount++;
			return {
				...(current ?? { path: 'docs/readme.md', kind: 'file', references: [], referenced_by: [] }),
				description: 'Local note'
			};
		});

		assert.strictEqual(updateCount, 2);
		assert.strictEqual(fileService.createCount, 1);
		assert.strictEqual(fileService.writeCount, 1);
		assert.deepStrictEqual(updated, {
			path: 'docs/readme.md',
			kind: 'file',
			description: 'Local note',
			references: ['external.md'],
			referenced_by: []
		});
		});

	test('replays an equal-length external rewrite detected by the exact-byte precommit check', async () => {
		const badgePath = '/work/.bh/mirror/docs/readme.md/badge.yaml';
		const initial = 'path: "docs/readme.md"\nkind: file\ndescription: "AAAA"\nreferences: []\nreferenced_by: []\n';
		const external = initial.replace('AAAA', 'BBBB');
		assert.strictEqual(VSBuffer.fromString(initial).byteLength, VSBuffer.fromString(external).byteLength);
		const fileService = new TestFileService(new Map([[badgePath, initial]]));
		fileService.replaceExternallyBeforeNextCommit(badgePath, external);
		const service = mirrorService(fileService);

		await service.patchBadge(node('docs/readme.md', 'file'), current => ({
			...(current ?? { path: 'docs/readme.md', kind: 'file', references: [], referenced_by: [] }),
			references: ['mine.md']
		}));

		assert.strictEqual((await service.readBadge(node('docs/readme.md', 'file')))?.description, 'BBBB');
		assert.deepStrictEqual((await service.readBadge(node('docs/readme.md', 'file')))?.references, ['mine.md']);
		assert.strictEqual(fileService.writeCount, 2);
	});

	test('commits semantic empty as canonical YAML instead of unlinking', async () => {
		const badgePath = '/work/.bh/mirror/a.md/badge.yaml';
		const fileService = new TestFileService(new Map([
			[badgePath, 'path: "a.md"\nkind: file\ndescription: "Remove me"\nreferences: []\nreferenced_by: []\n']
		]));
		const service = mirrorService(fileService);

		assert.strictEqual(await service.patchBadge(node('a.md', 'file'), () => null), null);

		assert.strictEqual(fileService.files.get(badgePath), 'path: "a.md"\nkind: file\nreferences: []\nreferenced_by: []\n');
		assert.strictEqual(fileService.deleteCount, 0);
		assert.strictEqual(await service.readBadge(node('a.md', 'file')), null);
	});

	test('does not delete an external write that lands after an empty commit', async () => {
		const badgePath = '/work/.bh/mirror/a.md/badge.yaml';
		const fileService = new TestFileService(new Map([
			[badgePath, 'path: "a.md"\nkind: file\ndescription: "Remove me"\nreferences: []\nreferenced_by: []\n']
		]));
		const external = 'path: "a.md"\nkind: file\ndescription: "External latest"\nreferences: []\nreferenced_by: []\n';
		fileService.writeExternallyAfterNextWrite(badgePath, external);
		const service = mirrorService(fileService);

		assert.strictEqual(await service.patchBadge(node('a.md', 'file'), () => null), null);

		assert.strictEqual(fileService.files.get(badgePath), external);
		assert.strictEqual(fileService.deleteCount, 0);
		assert.strictEqual((await service.readBadge(node('a.md', 'file')))?.description, 'External latest');
	});

	function node(relativePath: string, kind: 'file' | 'folder'): IBaseHalfBadgeNode {
		return {
			resource: relativePath ? URI.joinPath(workspaceFolder, ...relativePath.split('/')) : workspaceFolder,
			workspaceFolder,
			relativePath,
			kind
		};
	}

	function createService(files: Map<string, string>): BaseHalfBadgeMirrorService {
		return mirrorService(new TestFileService(files));
	}

	function mirrorService(fileService: TestFileService): BaseHalfBadgeMirrorService {
		return new BaseHalfBadgeMirrorService(fileService as unknown as IFileService);
	}
});

class TestFileService {
	readonly files: Map<string, string>;
	private readonly revisions = new Map<string, number>();
	private readonly externalCreates = new Map<string, string>();
	private readonly externalWritesBeforeCommit = new Map<string, string>();
	private readonly externalWritesAfterCommit = new Map<string, string>();
	createCount = 0;
	writeCount = 0;
	deleteCount = 0;

	constructor(files: Map<string, string>) {
		this.files = files;
		for (const path of files.keys()) {
			this.revisions.set(path, 1);
		}
	}

	async readFile(resource: URI): Promise<{ value: VSBuffer; mtime: number; etag: string }> {
		const raw = this.files.get(resource.fsPath);
		if (raw === undefined) {
			throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
		}

		const revision = this.revisions.get(resource.fsPath) ?? 0;
		return { value: VSBuffer.fromString(raw), mtime: revision, etag: `v${revision}` };
	}

	async stat(resource: URI): Promise<IFileStat> {
		if (this.files.has(resource.fsPath)) {
			return stat(resource, FileType.File);
		}
		if ([...this.files.keys()].some(path => path.startsWith(`${resource.fsPath}/`))) {
			return stat(resource, FileType.Directory);
		}
		throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
	}

	async createFolder(resource: URI): Promise<IFileStat> {
		return stat(resource, FileType.Directory);
	}

	async createFile(resource: URI, buffer: VSBuffer, options?: { overwrite?: boolean }): Promise<IFileStat> {
		this.createCount++;
		const external = this.externalCreates.get(resource.fsPath);
		if (external !== undefined) {
			this.externalCreates.delete(resource.fsPath);
			this.files.set(resource.fsPath, external);
			this.revisions.set(resource.fsPath, (this.revisions.get(resource.fsPath) ?? 0) + 1);
		}
		if (this.files.has(resource.fsPath) && !options?.overwrite) {
			throw new FileOperationError('already exists', FileOperationResult.FILE_MODIFIED_SINCE);
		}
		this.files.set(resource.fsPath, buffer.toString());
		this.revisions.set(resource.fsPath, (this.revisions.get(resource.fsPath) ?? 0) + 1);
		return stat(resource, FileType.File);
	}

	async writeFileWithExpectedContents(resource: URI, buffer: VSBuffer, expectedContents: VSBuffer | null): Promise<IFileStat> {
		if (expectedContents === null) {
			return this.createFile(resource, buffer, { overwrite: false });
		}

		this.writeCount++;
		const externalBeforeCommit = this.externalWritesBeforeCommit.get(resource.fsPath);
		if (externalBeforeCommit !== undefined) {
			this.externalWritesBeforeCommit.delete(resource.fsPath);
			this.files.set(resource.fsPath, externalBeforeCommit);
			this.revisions.set(resource.fsPath, (this.revisions.get(resource.fsPath) ?? 0) + 1);
		}
		if (this.files.get(resource.fsPath) !== expectedContents.toString()) {
			throw new FileOperationError('modified', FileOperationResult.FILE_MODIFIED_SINCE);
		}
		const revision = this.revisions.get(resource.fsPath);
		if (revision === undefined) {
			throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
		}
		this.files.set(resource.fsPath, buffer.toString());
		this.revisions.set(resource.fsPath, revision + 1);
		const external = this.externalWritesAfterCommit.get(resource.fsPath);
		if (external !== undefined) {
			this.externalWritesAfterCommit.delete(resource.fsPath);
			this.files.set(resource.fsPath, external);
			this.revisions.set(resource.fsPath, revision + 2);
		}
		return stat(resource, FileType.File);
	}

	async writeFile(resource: URI, buffer: VSBuffer, options?: { mtime?: number; etag?: string }): Promise<IFileStat> {
		this.writeCount++;
		const revision = this.revisions.get(resource.fsPath);
		if (revision === undefined) {
			throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
		}
		if (options?.mtime !== revision || options.etag !== `v${revision}`) {
			throw new FileOperationError('modified', FileOperationResult.FILE_MODIFIED_SINCE);
		}
		this.files.set(resource.fsPath, buffer.toString());
		this.revisions.set(resource.fsPath, revision + 1);
		const external = this.externalWritesAfterCommit.get(resource.fsPath);
		if (external !== undefined) {
			this.externalWritesAfterCommit.delete(resource.fsPath);
			this.files.set(resource.fsPath, external);
			this.revisions.set(resource.fsPath, revision + 2);
		}
		return stat(resource, FileType.File);
	}

	createExternallyOnNextCreate(path: string, contents: string): void {
		this.externalCreates.set(path, contents);
	}

	replaceExternallyBeforeNextCommit(path: string, contents: string): void {
		this.externalWritesBeforeCommit.set(path, contents);
	}

	writeExternallyAfterNextWrite(path: string, contents: string): void {
		this.externalWritesAfterCommit.set(path, contents);
	}

	async del(resource: URI): Promise<void> {
		this.deleteCount++;
		if (!this.files.delete(resource.fsPath)) {
			throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
		}
		this.revisions.delete(resource.fsPath);
	}
}

function stat(resource: URI, type: FileType): IFileStat {
	return {
		resource,
		name: resource.path.split('/').pop() ?? '',
		isFile: type === FileType.File,
		isDirectory: type === FileType.Directory,
		isSymbolicLink: false,
		mtime: 0,
		ctime: 0,
		size: 0,
		children: undefined
	};
}
