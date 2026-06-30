/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import {
	FileOperationError,
	FileOperationResult,
	FileType,
	IFileService,
	IFileStat
} from '../../../../platform/files/common/files.js';
import { BaseHalfAdhdMirrorCorrupt, BaseHalfAdhdMirrorService, serializeAdhdFile } from '../../common/basehalfAdhdMirror.js';
import { IBaseHalfWorkspaceResource } from '../../common/basehalfCanvasNavigation.js';

suite('BaseHalfAdhdMirrorService', () => {
	const workspaceFolder = URI.file('/work');

	test('maps files to adhd.yaml mirror resources', () => {
		const service = createService(new Map());

		assert.strictEqual(service.adhdResource(file('docs/readme.md')).fsPath, '/work/.bh/mirror/docs/readme.md/adhd.yaml');
	});

	test('returns null when adhd.yaml is absent', async () => {
		const service = createService(new Map());

		assert.strictEqual(await service.readAdhd(file('missing.md')), null);
	});

	test('reads and normalizes adhd.yaml metadata', async () => {
		const service = createService(new Map([
			['/work/.bh/mirror/docs/readme.md/adhd.yaml', [
				'path: docs/readme.md',
				'kind: file',
				'highlight_keywords:',
				'  - Cost',
				'  - Cost',
				'  - "边际成本"',
				'read_paragraphs:',
				'  - [5, 6]',
				'  - [1, 4]',
				''
			].join('\n')]
		]));

		assert.deepStrictEqual(await service.readAdhd(file('docs/readme.md')), {
			path: 'docs/readme.md',
			kind: 'file',
			highlight_keywords: ['Cost', '边际成本'],
			read_paragraphs: [[1, 6]]
		});
	});

	test('throws typed corrupt errors for invalid YAML, path, kind, and ranges', async () => {
		const invalid = createService(new Map([
			['/work/.bh/mirror/bad.md/adhd.yaml', 'path: [unterminated']
		]));
		await assert.rejects(
			() => invalid.readAdhd(file('bad.md')),
			error => error instanceof BaseHalfAdhdMirrorCorrupt
		);

		const wrongPath = createService(new Map([
			['/work/.bh/mirror/bad.md/adhd.yaml', 'path: other.md\nkind: file\n']
		]));
		await assert.rejects(
			() => wrongPath.readAdhd(file('bad.md')),
			error => error instanceof BaseHalfAdhdMirrorCorrupt && error.reason === 'path must be "bad.md"'
		);

		const wrongKind = createService(new Map([
			['/work/.bh/mirror/bad.md/adhd.yaml', 'path: bad.md\nkind: folder\n']
		]));
		await assert.rejects(
			() => wrongKind.readAdhd(file('bad.md')),
			error => error instanceof BaseHalfAdhdMirrorCorrupt && error.reason === 'kind must be file'
		);

		const badRange = createService(new Map([
			['/work/.bh/mirror/bad.md/adhd.yaml', 'path: bad.md\nkind: file\nread_paragraphs:\n  - [4, 2]\n']
		]));
		await assert.rejects(
			() => badRange.readAdhd(file('bad.md')),
			error => error instanceof BaseHalfAdhdMirrorCorrupt && /before start/.test(error.reason)
		);
	});

	test('serializes sparse adhd.yaml with stable fields', () => {
		assert.strictEqual(serializeAdhdFile({
			path: 'docs/readme.md',
			kind: 'file',
			highlight_keywords: ['Cost', '边际成本'],
			read_paragraphs: [[1, 2], [4, 5]]
		}), [
			'path: "docs/readme.md"',
			'kind: file',
			'highlight_keywords:',
			'  - "Cost"',
			'  - "边际成本"',
			'read_paragraphs:',
			'  - [1, 2]',
			'  - [4, 5]',
			''
		].join('\n'));
	});

	test('adds and removes keywords while pruning an empty overlay', async () => {
		const fileService = new TestFileService(new Map());
		const service = new BaseHalfAdhdMirrorService(fileService as unknown as IFileService);

		await service.addKeyword(file('docs/readme.md'), ' Cost ');
		await service.addKeyword(file('docs/readme.md'), 'cost');
		assert.strictEqual(fileService.files.get('/work/.bh/mirror/docs/readme.md/adhd.yaml'), [
			'path: "docs/readme.md"',
			'kind: file',
			'highlight_keywords:',
			'  - "Cost"',
			''
		].join('\n'));

		await service.removeKeyword(file('docs/readme.md'), 'Cost');
		assert.strictEqual(fileService.files.has('/work/.bh/mirror/docs/readme.md/adhd.yaml'), false);
		assert.deepStrictEqual(fileService.deleted.map(resource => resource.fsPath), ['/work/.bh/mirror/docs/readme.md/adhd.yaml']);
	});

	test('marks read and unread ranges with latest-read RMW semantics', async () => {
		const fileService = new TestFileService(new Map());
		const service = new BaseHalfAdhdMirrorService(fileService as unknown as IFileService);

		await Promise.all([
			service.markRead(file('a.md'), 1, 2),
			service.markRead(file('a.md'), 5, 6)
		]);
		assert.deepStrictEqual((await service.readAdhd(file('a.md')))?.read_paragraphs, [[1, 2], [5, 6]]);

		await service.markRead(file('a.md'), 3, 4);
		assert.deepStrictEqual((await service.readAdhd(file('a.md')))?.read_paragraphs, [[1, 6]]);

		await service.markUnread(file('a.md'), 2, 5);
		assert.deepStrictEqual((await service.readAdhd(file('a.md')))?.read_paragraphs, [[1, 1], [6, 6]]);
	});

	test('does not overwrite corrupt adhd.yaml while writing', async () => {
		const fileService = new TestFileService(new Map([
			['/work/.bh/mirror/a.md/adhd.yaml', 'path: [unterminated']
		]));
		const service = new BaseHalfAdhdMirrorService(fileService as unknown as IFileService);

		await assert.rejects(
			() => service.markRead(file('a.md'), 1, 1),
			error => error instanceof BaseHalfAdhdMirrorCorrupt
		);
		assert.strictEqual(fileService.files.get('/work/.bh/mirror/a.md/adhd.yaml'), 'path: [unterminated');
	});

	function file(relativePath: string): IBaseHalfWorkspaceResource {
		return {
			resource: URI.joinPath(workspaceFolder, ...relativePath.split('/')),
			workspaceFolder,
			relativePath
		};
	}

	function createService(files: Map<string, string>): BaseHalfAdhdMirrorService {
		return new BaseHalfAdhdMirrorService(new TestFileService(files) as unknown as IFileService);
	}
});

class TestFileService {
	readonly files: Map<string, string>;
	readonly createdFolders: URI[] = [];
	readonly deleted: URI[] = [];

	constructor(files: Map<string, string>) {
		this.files = files;
	}

	async readFile(resource: URI): Promise<{ value: VSBuffer }> {
		const raw = this.files.get(resource.fsPath);
		if (raw === undefined) {
			throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
		}

		return { value: VSBuffer.fromString(raw) };
	}

	async createFolder(resource: URI): Promise<IFileStat> {
		this.createdFolders.push(resource);
		return stat(resource, FileType.Directory);
	}

	async writeFile(resource: URI, buffer: VSBuffer): Promise<IFileStat> {
		this.files.set(resource.fsPath, buffer.toString());
		return stat(resource, FileType.File);
	}

	async del(resource: URI): Promise<void> {
		if (!this.files.delete(resource.fsPath)) {
			throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
		}
		this.deleted.push(resource);
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
