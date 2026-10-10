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
import { NullLogService } from '../../../../platform/log/common/log.js';
import { BaseHalfAdhdMirrorService, serializeAdhdFile } from '../../common/basehalfAdhdMirror.js';
import { IBaseHalfWorkspaceResource } from '../../common/basehalfCanvasNavigation.js';
import { baseHalfMirrorRecoveryResource, IBaseHalfMirrorPreservedEvent } from '../../common/basehalfMirrorRecovery.js';
import { BaseHalfWorkspaceMutationCoordinator } from '../../common/basehalfWorkspaceMutation.js';

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

		// No `line_base`, and the document has no frontmatter: the absolute
		// lines are already body lines.
		assert.deepStrictEqual(await service.readAdhd(file('docs/readme.md')), {
			path: 'docs/readme.md',
			kind: 'file',
			line_base: 'body',
			highlight_keywords: ['Cost', '边际成本'],
			read_paragraphs: [[1, 6]]
		});
	});

	test('converts a file without line_base by subtracting the current frontmatter line count, without writing', async () => {
		const mirrorPath = '/work/.bh/mirror/doc.md/adhd.yaml';
		const legacy = 'path: doc.md\nkind: file\nread_paragraphs:\n  - [2, 3]\n  - [5, 7]\n';
		const fileService = new TestFileService(new Map([
			[mirrorPath, legacy],
			['/work/doc.md', '---\nupstream:\n  - a.md\n---\n# Doc\n\npara one\n']
		]));
		const service = mirrorService(fileService as unknown as IFileService);

		assert.deepStrictEqual({
			disk: (await service.readAdhd(file('doc.md')))?.read_paragraphs,
			model: (await service.readAdhd(file('doc.md'), { frontmatterLines: 1 }))?.read_paragraphs,
			unchanged: fileService.files.get(mirrorPath) === legacy
		}, {
			// Lines 2–3 lie in the four frontmatter lines; 5–7 are body lines 1–3.
			disk: [[1, 3]],
			model: [[1, 2], [4, 6]],
			unchanged: true
		});
	});

	test('persists the conversion exactly once and stores body-relative ranges on every later write', async () => {
		const mirrorPath = '/work/.bh/mirror/doc.md/adhd.yaml';
		const fileService = new TestFileService(new Map([
			[mirrorPath, 'path: doc.md\nkind: file\nhighlight_keywords:\n  - Cost\nread_paragraphs:\n  - [5, 5]\n'],
			['/work/other.md', 'x'],
			['/work/.bh/mirror/other.md/adhd.yaml', 'path: other.md\nkind: file\nread_paragraphs:\n  - [3, 3]\n']
		]));
		const service = mirrorService(fileService as unknown as IFileService);

		const first = await service.persistBodyLineBase(file('doc.md'), 3);
		const converted = fileService.files.get(mirrorPath);
		const second = await service.persistBodyLineBase(file('doc.md'), 0);
		await service.markRead(file('other.md'), 7, 7, undefined, { frontmatterLines: 2 });

		assert.deepStrictEqual({
			first,
			second,
			converted,
			unchangedBySecond: fileService.files.get(mirrorPath) === converted,
			other: fileService.files.get('/work/.bh/mirror/other.md/adhd.yaml'),
			missing: await service.persistBodyLineBase(file('missing.md'), 4)
		}, {
			first: true,
			second: false,
			converted: 'path: "doc.md"\nkind: file\nline_base: body\nhighlight_keywords:\n  - "Cost"\nread_paragraphs:\n  - [2, 2]\n',
			unchangedBySecond: true,
			// The legacy range [3, 3] became body line 1 before the new range joined it.
			other: 'path: "other.md"\nkind: file\nline_base: body\nread_paragraphs:\n  - [1, 1]\n  - [7, 7]\n',
			missing: false
		});
	});

	test('relocates a legacy file against the moved document', async () => {
		const fileService = new TestFileService(new Map([
			['/work/.bh/mirror/a.md/adhd.yaml', 'path: a.md\nkind: file\nread_paragraphs:\n  - [4, 4]\n'],
			['/work/b.md', '---\ntitle: B\n---\nbody\n']
		]));
		const service = mirrorService(fileService as unknown as IFileService);
		await service.relocateAdhd(file('a.md'), file('b.md'));
		assert.strictEqual(fileService.files.get('/work/.bh/mirror/b.md/adhd.yaml'), 'path: "b.md"\nkind: file\nline_base: body\nread_paragraphs:\n  - [1, 1]\n');
	});

	test('reading aids whose content cannot be read read as none', async () => {
		const unreadable = [
			'path: [unterminated',
			'path: other.md\nkind: file\n',
			'path: bad.md\nkind: folder\n',
			'path: bad.md\nkind: file\nline_base: file\n',
			'path: bad.md\nkind: file\nread_paragraphs:\n  - [4, 2]\n',
			'path: bad.md\nkind: file\nhighlight_keywords:\n  - "kept"\n<<<<<<< HEAD\n  - "ours"\n=======\n  - "theirs"\n>>>>>>> feature\n'
		];
		const reads = [];
		for (const text of unreadable) {
			reads.push(await createService(new Map([['/work/.bh/mirror/bad.md/adhd.yaml', text]])).readAdhd(file('bad.md')));
		}

		assert.deepStrictEqual(reads, unreadable.map(() => null));
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
			'line_base: body',
			'highlight_keywords:',
			'  - "Cost"',
			'  - "边际成本"',
			'read_paragraphs:',
			'  - [1, 2]',
			'  - [4, 5]',
			''
		].join('\n'));
	});

	test('adds and removes keywords while retaining a logically empty canonical tombstone', async () => {
		const fileService = new TestFileService(new Map());
		const service = mirrorService(fileService as unknown as IFileService);
		const mirrorPath = '/work/.bh/mirror/docs/readme.md/adhd.yaml';

		await service.addKeyword(file('docs/readme.md'), ' Cost ');
		await service.addKeyword(file('docs/readme.md'), 'cost');
		assert.strictEqual(fileService.files.get(mirrorPath), [
			'path: "docs/readme.md"',
			'kind: file',
			'highlight_keywords:',
			'  - "Cost"',
			''
		].join('\n'));

		await service.removeKeyword(file('docs/readme.md'), 'Cost');
		assert.strictEqual(fileService.files.get(mirrorPath), [
			'path: "docs/readme.md"',
			'kind: file',
			''
		].join('\n'));
		assert.strictEqual(await service.readAdhd(file('docs/readme.md')), null);
		assert.strictEqual(fileService.deleteCount, 0);
		assert.strictEqual(fileService.lastWriteWasAtomic, true);
	});

	test('replays an absent create-only race against the externally created ADHD state', async () => {
		const mirrorPath = '/work/.bh/mirror/a.md/adhd.yaml';
		const fileService = new TestFileService(new Map());
		fileService.createExternallyOnNextCreate(mirrorPath, adhdYaml('a.md', ['External']));
		const service = mirrorService(fileService as unknown as IFileService);

		assert.deepStrictEqual(await service.addKeyword(file('a.md'), 'Mine'), {
			path: 'a.md',
			kind: 'file',
			highlight_keywords: ['External', 'Mine']
		});
		assert.deepStrictEqual((await service.readAdhd(file('a.md')))?.highlight_keywords, ['External', 'Mine']);
		assert.strictEqual(fileService.createCount, 1);
		assert.strictEqual(fileService.writeCount, 1);
		assert.strictEqual(fileService.lastCreateWasCreateOnly, true);
		assert.strictEqual(fileService.lastWriteWasAtomic, true);
	});

	test('replays a patch after an external guarded-write conflict', async () => {
		const mirrorPath = '/work/.bh/mirror/a.md/adhd.yaml';
		const fileService = new TestFileService(new Map([
			[mirrorPath, adhdYaml('a.md', ['Initial'])]
		]));
		fileService.replaceExternallyOnNextWrite(mirrorPath, adhdYaml('a.md', ['Initial', 'External']));
		const service = mirrorService(fileService as unknown as IFileService);

		await service.addKeyword(file('a.md'), 'Mine');

		assert.deepStrictEqual((await service.readAdhd(file('a.md')))?.highlight_keywords, ['Initial', 'External', 'Mine']);
		assert.strictEqual(fileService.writeCount, 2);
		assert.strictEqual(fileService.lastWriteWasAtomic, true);
	});

	test('replays an equal-length external ADHD rewrite detected by exact bytes', async () => {
		const mirrorPath = '/work/.bh/mirror/a.md/adhd.yaml';
		const initial = adhdYaml('a.md', ['AAAA']);
		const external = adhdYaml('a.md', ['BBBB']);
		assert.strictEqual(VSBuffer.fromString(initial).byteLength, VSBuffer.fromString(external).byteLength);
		const fileService = new TestFileService(new Map([[mirrorPath, initial]]));
		fileService.replaceExternallyOnNextWrite(mirrorPath, external);
		const service = mirrorService(fileService as unknown as IFileService);

		await service.addKeyword(file('a.md'), 'Mine');

		assert.deepStrictEqual((await service.readAdhd(file('a.md')))?.highlight_keywords, ['BBBB', 'Mine']);
		assert.strictEqual(fileService.writeCount, 2);
	});

	test('an external write after an empty commit survives because no unguarded delete follows it', async () => {
		const mirrorPath = '/work/.bh/mirror/a.md/adhd.yaml';
		const fileService = new TestFileService(new Map([
			[mirrorPath, adhdYaml('a.md', ['Mine'])]
		]));
		fileService.writeExternallyAfterNextWrite(mirrorPath, adhdYaml('a.md', ['External']));
		const service = mirrorService(fileService as unknown as IFileService);

		assert.strictEqual(await service.removeKeyword(file('a.md'), 'Mine'), null);

		assert.deepStrictEqual((await service.readAdhd(file('a.md')))?.highlight_keywords, ['External']);
		assert.strictEqual(fileService.deleteCount, 0);
		assert.strictEqual(fileService.lastWriteWasAtomic, true);
	});

	test('structural retirement writes a guarded canonical tombstone instead of unlinking ADHD state', async () => {
		const mirrorPath = '/work/.bh/mirror/a.md/adhd.yaml';
		const fileService = new TestFileService(new Map([[mirrorPath, adhdYaml('a.md', ['Mine'])]]));
		const service = mirrorService(fileService as unknown as IFileService);

		await service.retireAdhd(file('a.md'));

		assert.strictEqual(await service.readAdhd(file('a.md')), null);
		assert.strictEqual(fileService.files.get(mirrorPath), 'path: "a.md"\nkind: file\n');
		assert.strictEqual(fileService.deleteCount, 0);
	});

	test('structural relocation replays a source rewrite before conditionally retiring it', async () => {
		const sourcePath = '/work/.bh/mirror/a.md/adhd.yaml';
		const targetPath = '/work/.bh/mirror/b.md/adhd.yaml';
		const fileService = new TestFileService(new Map([[sourcePath, adhdYaml('a.md', ['Initial'])]]));
		fileService.replaceExternallyOnNextWrite(sourcePath, adhdYaml('a.md', ['External']));
		const service = mirrorService(fileService as unknown as IFileService);

		await service.relocateAdhd(file('a.md'), file('b.md'));

		assert.deepStrictEqual((await service.readAdhd(file('b.md')))?.highlight_keywords, ['External']);
		assert.strictEqual(await service.readAdhd(file('a.md')), null);
		assert.strictEqual(fileService.files.has(sourcePath), true);
		assert.strictEqual(fileService.files.has(targetPath), true);
		assert.strictEqual(fileService.deleteCount, 0);
	});

	test('structural relocation fails closed when destination changes before compensation', async () => {
		const sourcePath = '/work/.bh/mirror/a.md/adhd.yaml';
		const targetPath = '/work/.bh/mirror/b.md/adhd.yaml';
		const sourceLatest = adhdYaml('a.md', ['SourceLatest']);
		const targetLatest = adhdYaml('b.md', ['TargetLatest']);
		const fileService = new TestFileService(new Map([
			[sourcePath, adhdYaml('a.md', ['Initial'])],
			[targetPath, adhdYaml('b.md', [])]
		]));
		fileService.writeExternallyAfterNextWrite(targetPath, targetLatest);
		fileService.replaceExternallyOnNextWrite(sourcePath, sourceLatest);
		const service = mirrorService(fileService as unknown as IFileService);

		await assert.rejects(
			() => service.relocateAdhd(file('a.md'), file('b.md')),
			error => error instanceof AggregateError && /conditional destination compensation/.test(error.message)
		);

		assert.strictEqual(fileService.files.get(sourcePath), sourceLatest);
		assert.strictEqual(fileService.files.get(targetPath), targetLatest);
	});

	test('structural relocation restores the source when the destination changes after its commit', async () => {
		const sourcePath = '/work/.bh/mirror/a.md/adhd.yaml';
		const targetPath = '/work/.bh/mirror/b.md/adhd.yaml';
		const sourceInitial = adhdYaml('a.md', ['Source']);
		const targetLatest = adhdYaml('b.md', ['External']);
		const fileService = new TestFileService(new Map([
			[sourcePath, sourceInitial],
			[targetPath, adhdYaml('b.md', [])]
		]));
		fileService.writeExternallyAfterNextWrite(targetPath, targetLatest);
		const service = mirrorService(fileService as unknown as IFileService);

		await assert.rejects(
			() => service.relocateAdhd(file('a.md'), file('b.md')),
			error => error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_MODIFIED_SINCE
		);

		assert.strictEqual(fileService.files.get(sourcePath), sourceInitial);
		assert.strictEqual(fileService.files.get(targetPath), targetLatest);
	});

	test('structural relocation restores the destination when the retired source is recreated', async () => {
		const sourcePath = '/work/.bh/mirror/a.md/adhd.yaml';
		const targetPath = '/work/.bh/mirror/b.md/adhd.yaml';
		const sourceLatest = adhdYaml('a.md', ['External']);
		const targetInitial = adhdYaml('b.md', ['Target']);
		const fileService = new TestFileService(new Map([
			[sourcePath, adhdYaml('a.md', ['Source'])],
			[targetPath, targetInitial]
		]));
		fileService.writeExternallyAfterNextWrite(sourcePath, sourceLatest);
		const service = mirrorService(fileService as unknown as IFileService);

		await assert.rejects(
			() => service.relocateAdhd(file('a.md'), file('b.md')),
			error => error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_MODIFIED_SINCE
		);

		assert.strictEqual(fileService.files.get(sourcePath), sourceLatest);
		assert.strictEqual(fileService.files.get(targetPath), targetInitial);
	});

	test('case-only structural relocation rewrites one mirror identity without tombstoning itself', async () => {
		const sourcePath = '/work/.bh/mirror/a.md/adhd.yaml';
		const fileService = new TestFileService(new Map([[sourcePath, adhdYaml('a.md', ['Case'])]]));
		const service = mirrorService(fileService as unknown as IFileService);

		await service.relocateAdhd(file('a.md'), file('A.md'), { sameResourceIdentity: true });

		assert.deepStrictEqual(fileService.files.get(sourcePath), adhdYaml('A.md', ['Case']));
		assert.strictEqual(fileService.deleteCount, 0);
	});

	test('case-only structural relocation rewrites a materialized empty tombstone and is retry-safe', async () => {
		const sourcePath = '/work/.bh/mirror/a.md/adhd.yaml';
		const fileService = new TestFileService(new Map([[sourcePath, adhdYaml('a.md', [])]]));
		const service = mirrorService(fileService as unknown as IFileService);

		await service.relocateAdhd(file('a.md'), file('A.md'), { sameResourceIdentity: true });
		assert.strictEqual(fileService.files.get(sourcePath), adhdYaml('A.md', []));

		// A cascade retry addresses the same physical file through its old alias.
		// Target-path YAML is a completed operation, not source corruption.
		await service.relocateAdhd(file('a.md'), file('A.md'), { sameResourceIdentity: true });
		assert.strictEqual(fileService.files.get(sourcePath), adhdYaml('A.md', []));
	});

	for (const [label, conflict] of [
		['move', FileOperationResult.FILE_MOVE_CONFLICT],
		['not-found', FileOperationResult.FILE_NOT_FOUND]
	] as const) {
		test(`replays ${label} conflicts against the latest mirror identity`, async () => {
			const mirrorPath = '/work/.bh/mirror/a.md/adhd.yaml';
			const fileService = new TestFileService(new Map([
				[mirrorPath, adhdYaml('a.md', ['Initial'])]
			]));
			fileService.failNextWrite(mirrorPath, conflict, conflict === FileOperationResult.FILE_NOT_FOUND);
			const service = mirrorService(fileService as unknown as IFileService);

			await service.addKeyword(file('a.md'), 'Mine');

			assert.deepStrictEqual((await service.readAdhd(file('a.md')))?.highlight_keywords,
				conflict === FileOperationResult.FILE_NOT_FOUND ? ['Mine'] : ['Initial', 'Mine']);
		});
	}

	test('marks read and unread ranges with latest-read RMW semantics', async () => {
		const fileService = new TestFileService(new Map());
		const service = mirrorService(fileService as unknown as IFileService);

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

	test('reads back keywords and paths that look like numbers, booleans, or null', async () => {
		const keywords = ['2024', '09', '-3', '1.5', 'true', 'false', 'null', '~', 'a: b', 'it\'s "quoted"'];
		const service = createService(new Map());

		for (const keyword of keywords) {
			await service.addKeyword(file('2024'), keyword);
		}

		assert.deepStrictEqual(await service.readAdhd(file('2024')), { path: '2024', kind: 'file', highlight_keywords: keywords });
	});

	test('reads hand-written plain numeric values as text', async () => {
		const service = createService(new Map([
			['/work/.bh/mirror/09/adhd.yaml', 'path: 09\nkind: file\nhighlight_keywords:\n  - 2024\n  - true\n']
		]));

		assert.deepStrictEqual(await service.readAdhd(file('09')), { path: '09', kind: 'file', highlight_keywords: ['2024', 'true'] });
	});

	test('reads reading aids whose note was renamed in case only outside BaseHalf', async () => {
		// The file system finds the file under the new spelling; it still stores the old one.
		const service = createService(new Map([
			['/work/.bh/mirror/notes/plan.md/adhd.yaml', 'path: "Notes/Plan.md"\nkind: file\nhighlight_keywords:\n  - "focus"\n']
		]));

		assert.deepStrictEqual(await service.readAdhd(file('notes/plan.md')), { path: 'notes/plan.md', kind: 'file', highlight_keywords: ['focus'] });
	});

	test('structural operations leave an adhd.yaml they cannot read in place', async () => {
		const unreadable = 'path: [unterminated';
		const fileService = new TestFileService(new Map([
			['/work/.bh/mirror/retired.md/adhd.yaml', unreadable],
			['/work/.bh/mirror/moved.md/adhd.yaml', unreadable],
			['/work/.bh/mirror/Cased.md/adhd.yaml', unreadable]
		]));
		const service = mirrorService(fileService as unknown as IFileService);

		await service.retireAdhd(file('retired.md'));
		await service.relocateAdhd(file('moved.md'), file('target.md'));
		await service.relocateAdhd(file('cased.md'), file('Cased.md'), { sameResourceIdentity: true });

		assert.deepStrictEqual(Object.fromEntries(fileService.files), {
			'/work/.bh/mirror/retired.md/adhd.yaml': unreadable,
			'/work/.bh/mirror/moved.md/adhd.yaml': unreadable,
			'/work/.bh/mirror/Cased.md/adhd.yaml': unreadable
		});
	});

	test('structural relocation keeps an unreadable destination as a recovery copy before replacing it', async () => {
		const targetPath = '/work/.bh/mirror/b.md/adhd.yaml';
		const unreadable = 'path: [unterminated';
		const fileService = new TestFileService(new Map([
			['/work/.bh/mirror/a.md/adhd.yaml', adhdYaml('a.md', ['Mine'])],
			[targetPath, unreadable]
		]));
		const service = mirrorService(fileService as unknown as IFileService);
		const recoveryCopy = await baseHalfMirrorRecoveryResource(workspaceFolder, URI.file(targetPath), VSBuffer.fromString(unreadable));

		await service.relocateAdhd(file('a.md'), file('b.md'));

		assert.deepStrictEqual(Object.fromEntries(fileService.files), {
			'/work/.bh/mirror/a.md/adhd.yaml': 'path: "a.md"\nkind: file\n',
			[targetPath]: adhdYaml('b.md', ['Mine']),
			[recoveryCopy.fsPath]: unreadable
		});
	});

	test('a write over reading aids that cannot be read keeps them as a recovery copy, and a no-op leaves them alone', async () => {
		const mirrorPath = '/work/.bh/mirror/a.md/adhd.yaml';
		const conflicted = 'path: "a.md"\nkind: file\nhighlight_keywords:\n  - "kept"\n<<<<<<< HEAD\n  - "ours"\n=======\n  - "theirs"\n>>>>>>> feature\n';
		const fileService = new TestFileService(new Map([[mirrorPath, conflicted]]));
		const service = mirrorService(fileService as unknown as IFileService);
		const preserved: IBaseHalfMirrorPreservedEvent[] = [];
		const listener = service.onDidPreserveUnreadableAdhd(event => preserved.push(event));
		const recoveryCopy = await baseHalfMirrorRecoveryResource(workspaceFolder, URI.file(mirrorPath), VSBuffer.fromString(conflicted));

		await service.removeKeyword(file('a.md'), 'kept');
		const afterNoOp = { file: fileService.files.get(mirrorPath), recoveryCopy: fileService.files.get(recoveryCopy.fsPath) };
		await service.markRead(file('a.md'), 2, 3);
		listener.dispose();

		assert.deepStrictEqual({
			afterNoOp,
			written: fileService.files.get(mirrorPath),
			recoveryCopy: fileService.files.get(recoveryCopy.fsPath),
			preserved: preserved.map(event => ({ relativePath: event.relativePath, reason: event.reason, recoveryCopy: event.recoveryCopy.fsPath }))
		}, {
			afterNoOp: { file: conflicted, recoveryCopy: undefined },
			written: 'path: "a.md"\nkind: file\nline_base: body\nread_paragraphs:\n  - [2, 3]\n',
			recoveryCopy: conflicted,
			preserved: [{ relativePath: 'a.md', reason: 'line 5 and what follows could not be read', recoveryCopy: recoveryCopy.fsPath }]
		});
	});

	test('leaves unreadable reading aids unchanged when their recovery copy cannot be saved', async () => {
		const mirrorPath = '/work/.bh/mirror/a.md/adhd.yaml';
		const unreadable = 'path: [unterminated';
		const recoveryCopy = await baseHalfMirrorRecoveryResource(workspaceFolder, URI.file(mirrorPath), VSBuffer.fromString(unreadable));
		// Something else already sits where the copy belongs, so it cannot be created.
		const fileService = new TestFileService(new Map([[mirrorPath, unreadable], [recoveryCopy.fsPath, 'other bytes']]));
		const service = mirrorService(fileService as unknown as IFileService);

		await assert.rejects(() => service.markRead(file('a.md'), 1, 1));
		assert.strictEqual(fileService.files.get(mirrorPath), unreadable);
	});

	function file(relativePath: string): IBaseHalfWorkspaceResource {
		return {
			resource: URI.joinPath(workspaceFolder, ...relativePath.split('/')),
			workspaceFolder,
			relativePath
		};
	}

	function createService(files: Map<string, string>): BaseHalfAdhdMirrorService {
		return mirrorService(new TestFileService(files) as unknown as IFileService);
	}

	function mirrorService(fileService: IFileService): BaseHalfAdhdMirrorService {
		return new BaseHalfAdhdMirrorService(fileService, new BaseHalfWorkspaceMutationCoordinator(), new NullLogService());
	}
});

class TestFileService {
	readonly files: Map<string, string>;
	readonly createdFolders: URI[] = [];
	private readonly revisions = new Map<string, number>();
	private readonly externalCreates = new Map<string, string>();
	private readonly externalWritesBeforeGuard = new Map<string, string>();
	private readonly externalWritesAfterCommit = new Map<string, string>();
	private readonly nextWriteFailures = new Map<string, { readonly result: FileOperationResult; readonly remove: boolean }>();
	createCount = 0;
	writeCount = 0;
	deleteCount = 0;
	lastCreateWasCreateOnly = false;
	lastWriteWasAtomic = false;

	constructor(files: Map<string, string>) {
		this.files = files;
		for (const path of files.keys()) {
			this.revisions.set(path, 1);
		}
	}

	async stat(resource: URI): Promise<IFileStat> {
		return stat(resource, FileType.File);
	}

	async readFile(resource: URI): Promise<{ value: VSBuffer; mtime: number; etag: string }> {
		const raw = this.files.get(resource.fsPath);
		if (raw === undefined) {
			throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
		}

		const revision = this.revisions.get(resource.fsPath) ?? 0;
		return { value: VSBuffer.fromString(raw), mtime: revision, etag: `v${revision}` };
	}

	async createFolder(resource: URI): Promise<IFileStat> {
		this.createdFolders.push(resource);
		return stat(resource, FileType.Directory);
	}

	async createFile(resource: URI, buffer: VSBuffer, options?: { overwrite?: boolean }): Promise<IFileStat> {
		this.createCount++;
		this.lastCreateWasCreateOnly = options?.overwrite === false;
		const external = this.externalCreates.get(resource.fsPath);
		if (external !== undefined) {
			this.externalCreates.delete(resource.fsPath);
			this.replaceExternally(resource.fsPath, external);
		}
		if (this.files.has(resource.fsPath) && !options?.overwrite) {
			throw new FileOperationError('already exists', FileOperationResult.FILE_MODIFIED_SINCE);
		}

		this.files.set(resource.fsPath, buffer.toString());
		this.revisions.set(resource.fsPath, (this.revisions.get(resource.fsPath) ?? 0) + 1);
		return stat(resource, FileType.File);
	}

	async writeFileWithExpectedContents(resource: URI, buffer: VSBuffer, expectedContents: VSBuffer | null, options: { atomic: unknown }): Promise<IFileStat> {
		if (expectedContents === null) {
			return this.createFile(resource, buffer, { overwrite: false });
		}

		this.writeCount++;
		const externalBeforeGuard = this.externalWritesBeforeGuard.get(resource.fsPath);
		if (externalBeforeGuard !== undefined) {
			this.externalWritesBeforeGuard.delete(resource.fsPath);
			this.replaceExternally(resource.fsPath, externalBeforeGuard);
		}

		const failure = this.nextWriteFailures.get(resource.fsPath);
		if (failure) {
			this.nextWriteFailures.delete(resource.fsPath);
			if (failure.remove) {
				this.files.delete(resource.fsPath);
				this.revisions.delete(resource.fsPath);
			}
			throw new FileOperationError('injected conflict', failure.result);
		}

		const revision = this.revisions.get(resource.fsPath);
		if (revision === undefined) {
			throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
		}
		if (this.files.get(resource.fsPath) !== expectedContents.toString()) {
			throw new FileOperationError('modified', FileOperationResult.FILE_MODIFIED_SINCE);
		}

		this.files.set(resource.fsPath, buffer.toString());
		this.revisions.set(resource.fsPath, revision + 1);
		this.lastWriteWasAtomic = options.atomic !== undefined && options.atomic !== false;
		const externalAfterCommit = this.externalWritesAfterCommit.get(resource.fsPath);
		if (externalAfterCommit !== undefined) {
			this.externalWritesAfterCommit.delete(resource.fsPath);
			this.replaceExternally(resource.fsPath, externalAfterCommit);
		}
		return stat(resource, FileType.File);
	}

	async writeFile(resource: URI, buffer: VSBuffer, options?: { mtime?: number; etag?: string; atomic?: unknown }): Promise<IFileStat> {
		this.writeCount++;
		const externalBeforeGuard = this.externalWritesBeforeGuard.get(resource.fsPath);
		if (externalBeforeGuard !== undefined) {
			this.externalWritesBeforeGuard.delete(resource.fsPath);
			this.replaceExternally(resource.fsPath, externalBeforeGuard);
		}

		const failure = this.nextWriteFailures.get(resource.fsPath);
		if (failure) {
			this.nextWriteFailures.delete(resource.fsPath);
			if (failure.remove) {
				this.files.delete(resource.fsPath);
				this.revisions.delete(resource.fsPath);
			}
			throw new FileOperationError('injected conflict', failure.result);
		}

		const revision = this.revisions.get(resource.fsPath);
		if (revision === undefined) {
			throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
		}
		if (options?.mtime !== revision || options.etag !== `v${revision}`) {
			throw new FileOperationError('modified', FileOperationResult.FILE_MODIFIED_SINCE);
		}

		this.files.set(resource.fsPath, buffer.toString());
		this.revisions.set(resource.fsPath, revision + 1);
		this.lastWriteWasAtomic = options.atomic !== undefined && options.atomic !== false;
		const externalAfterCommit = this.externalWritesAfterCommit.get(resource.fsPath);
		if (externalAfterCommit !== undefined) {
			this.externalWritesAfterCommit.delete(resource.fsPath);
			this.replaceExternally(resource.fsPath, externalAfterCommit);
		}
		return stat(resource, FileType.File);
	}

	createExternallyOnNextCreate(path: string, contents: string): void {
		this.externalCreates.set(path, contents);
	}

	replaceExternallyOnNextWrite(path: string, contents: string): void {
		this.externalWritesBeforeGuard.set(path, contents);
	}

	writeExternallyAfterNextWrite(path: string, contents: string): void {
		this.externalWritesAfterCommit.set(path, contents);
	}

	failNextWrite(path: string, result: FileOperationResult, remove = false): void {
		this.nextWriteFailures.set(path, { result, remove });
	}

	async del(resource: URI): Promise<void> {
		this.deleteCount++;
		if (!this.files.delete(resource.fsPath)) {
			throw new FileOperationError('missing', FileOperationResult.FILE_NOT_FOUND);
		}
		this.revisions.delete(resource.fsPath);
	}

	private replaceExternally(path: string, contents: string): void {
		this.files.set(path, contents);
		this.revisions.set(path, (this.revisions.get(path) ?? 0) + 1);
	}
}

function adhdYaml(path: string, keywords: readonly string[]): string {
	return serializeAdhdFile({
		path,
		kind: 'file',
		highlight_keywords: keywords
	});
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
