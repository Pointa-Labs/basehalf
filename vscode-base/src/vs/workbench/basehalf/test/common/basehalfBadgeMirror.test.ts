/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { FileOperationError, FileOperationResult, IFileService } from '../../../../platform/files/common/files.js';
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

	test('throws a typed corrupt error when path or kind does not match the node', async () => {
		const wrongPath = createService(new Map([
			['/work/.bh/mirror/docs/readme.md/badge.yaml', 'path: docs/other.md\nkind: file\nreferences: []\nreferenced_by: []\n']
		]));
		await assert.rejects(
			() => wrongPath.readBadge(node('docs/readme.md', 'file')),
			error => error instanceof BaseHalfBadgeMirrorCorrupt && error.reason === 'path must be "docs/readme.md"'
		);

		const wrongKind = createService(new Map([
			['/work/.bh/mirror/docs/badge.yaml', 'path: docs\nkind: file\nreferences: []\nreferenced_by: []\n']
		]));
		await assert.rejects(
			() => wrongKind.readBadge(node('docs', 'folder')),
			error => error instanceof BaseHalfBadgeMirrorCorrupt && error.reason === 'kind must be "folder"'
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

	function node(relativePath: string, kind: 'file' | 'folder'): IBaseHalfBadgeNode {
		return {
			resource: relativePath ? URI.joinPath(workspaceFolder, ...relativePath.split('/')) : workspaceFolder,
			workspaceFolder,
			relativePath,
			kind
		};
	}

	function createService(files: Map<string, string>): BaseHalfBadgeMirrorService {
		return new BaseHalfBadgeMirrorService(new TestFileService(files) as unknown as IFileService);
	}
});

class TestFileService {
	constructor(
		private readonly files: Map<string, string>
	) { }

	async readFile(resource: URI): Promise<{ value: VSBuffer }> {
		const raw = this.files.get(resource.fsPath);
		if (raw === undefined) {
			throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
		}

		return { value: VSBuffer.fromString(raw) };
	}
}
