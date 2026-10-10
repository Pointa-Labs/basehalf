/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { FileOperationError, FileOperationResult, FileType, IFileService, IFileStat } from '../../../../platform/files/common/files.js';
import { BaseHalfBadgeMirrorService, baseHalfLegacyBadgePathAccepted, baseHalfRenameLegacyBadgeItems, IBaseHalfBadgeNode } from '../../common/basehalfBadgeMirror.js';
import { baseHalfMirrorRecoveryResource, IBaseHalfMirrorPreservedEvent } from '../../common/basehalfMirrorRecovery.js';

suite('BaseHalfBadgeMirrorService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
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

	test('reads badge.yaml metadata without the legacy reference keys', async () => {
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
			orphan: true
		});
		const legacy = await service.readLegacyReferences(node('docs/readme.md', 'file'));
		assert.deepStrictEqual([legacy?.references, legacy?.referencedBy], [['docs/next.md', 'docs/next.md'], ['docs/index.md']]);
	});

	test('reads a badge that never had legacy keys', async () => {
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
			description: 'Docs folder'
		});
		assert.strictEqual(await service.readLegacyReferences(node('docs', 'folder')), undefined);
	});

	test('reads back paths and descriptions that look like numbers, booleans, or null', async () => {
		const values = ['09', '2024', '-3', '1.5', 'true', 'false', 'null', '~', 'a: b', 'it\'s "quoted"', 'two\nlines'];
		const service = createService(new Map());
		const badges = [];
		for (const value of values) {
			await service.patchBadge(node(value, 'folder'), () => ({ path: value, kind: 'folder', description: value }));
			badges.push(await service.readBadge(node(value, 'folder')));
		}

		assert.deepStrictEqual(badges, values.map(value => ({ path: value, kind: 'folder', description: value })));
	});

	test('reads hand-written plain numeric values as text', async () => {
		const service = createService(new Map([
			['/work/.bh/mirror/09/badge.yaml', 'path: 09\nkind: folder\ndescription: 2024\norphan: true\n']
		]));

		assert.deepStrictEqual(await service.readBadge(node('09', 'folder')), { path: '09', kind: 'folder', description: '2024', orphan: true });
	});

	test('a badge whose content cannot be read reads as absent, and saving a description keeps it as a recovery copy', async () => {
		const conflicted = 'path: "conflict.md"\nkind: file\n<<<<<<< HEAD\ndescription: "Ours"\n=======\ndescription: "Theirs"\n>>>>>>> feature\nreferences:\n  - "legacy.md"\n';
		const unreadable: Record<string, string> = {
			'syntax.md': 'path: [unterminated',
			'elsewhere.md': 'path: "other.md"\nkind: file\ndescription: "For another node"\n',
			'kind.md': 'path: "kind.md"\nkind: link\n',
			'conflict.md': conflicted
		};
		const badgePath = (name: string) => `/work/.bh/mirror/${name}/badge.yaml`;
		const fileService = new TestFileService(new Map([
			...Object.entries(unreadable).map(([name, text]): [string, string] => [badgePath(name), text]),
			[badgePath('bom.md'), '\ufeffpath: "bom.md"\nkind: file\ndescription: "Saved with a byte order mark"\n']
		]));
		const service = mirrorService(fileService);
		const preserved: IBaseHalfMirrorPreservedEvent[] = [];
		disposables.add(service.onDidPreserveUnreadableBadge(event => preserved.push(event)));
		const recoveryCopy = await baseHalfMirrorRecoveryResource(workspaceFolder, URI.file(badgePath('conflict.md')), VSBuffer.fromString(conflicted));

		const read = await service.readBadges([...Object.keys(unreadable), 'bom.md'].map(name => node(name, 'file')));
		const listed = await service.listBadges(workspaceFolder);
		// Clearing a description that could not be read changes nothing.
		await service.patchBadge(node('syntax.md', 'file'), () => null);
		const saved = await service.patchBadge(node('conflict.md', 'file'), () => ({ path: 'conflict.md', kind: 'file', description: 'Mine' }));

		assert.deepStrictEqual({
			read: { badges: [...read.badges.keys()], problems: read.problems },
			listed: { badges: [...listed.badges.keys()], problems: listed.problems },
			untouched: fileService.files.get(badgePath('syntax.md')),
			saved,
			// The legacy block, split out by line, is still in the new file.
			written: fileService.files.get(badgePath('conflict.md')),
			recoveryCopy: fileService.files.get(recoveryCopy.fsPath),
			preserved: preserved.map(event => ({ relativePath: event.relativePath, reason: event.reason, recoveryCopy: event.recoveryCopy.fsPath }))
		}, {
			read: { badges: ['bom.md'], problems: [] },
			listed: { badges: ['bom.md'], problems: [] },
			untouched: 'path: [unterminated',
			saved: { path: 'conflict.md', kind: 'file', description: 'Mine' },
			written: 'path: "conflict.md"\nkind: file\ndescription: "Mine"\nreferences:\n  - "legacy.md"\n',
			recoveryCopy: conflicted,
			preserved: [{ relativePath: 'conflict.md', reason: 'line 3 and what follows could not be read', recoveryCopy: recoveryCopy.fsPath }]
		});
	});

	test('leaves an unreadable badge unchanged when its recovery copy cannot be saved', async () => {
		const badgePath = '/work/.bh/mirror/a.md/badge.yaml';
		const unreadable = 'path: [unterminated';
		const recoveryCopy = await baseHalfMirrorRecoveryResource(workspaceFolder, URI.file(badgePath), VSBuffer.fromString(unreadable));
		// Something else already sits where the copy belongs, so it cannot be created.
		const fileService = new TestFileService(new Map([[badgePath, unreadable], [recoveryCopy.fsPath, 'other bytes']]));
		const service = mirrorService(fileService);

		await assert.rejects(() => service.patchBadge(node('a.md', 'file'), () => ({ path: 'a.md', kind: 'file', description: 'Mine' })));
		assert.strictEqual(fileService.files.get(badgePath), unreadable);
	});

	test('legacy reference items the legacy grammar rejects never make the badge unreadable', async () => {
		const invalidPaths = [
			'../outside.md',
			'/leading.md',
			'trailing.md/',
			'docs//double.md',
			'docs/./dot.md',
			'docs/../parent.md',
			'docs\\windows.md'
		];
		const files = new Map<string, string>();
		const nodes: IBaseHalfBadgeNode[] = [];
		for (let index = 0; index < invalidPaths.length; index++) {
			const relativePath = `bad-reference-${index}.md`;
			files.set(`/work/.bh/mirror/${relativePath}/badge.yaml`, [
				`path: ${relativePath}`,
				'kind: file',
				'description: Still readable',
				`references: [${JSON.stringify(invalidPaths[index])}, "ok.md"]`,
				`referenced_by: [${JSON.stringify(invalidPaths[index])}]`,
				''
			].join('\n'));
			nodes.push(node(relativePath, 'file'));
		}
		const service = createService(files);

		for (const candidate of nodes) {
			const invalidPath = invalidPaths[nodes.indexOf(candidate)];
			assert.deepStrictEqual(await service.readBadge(candidate), {
				path: candidate.relativePath,
				kind: 'file',
				description: 'Still readable'
			});
			assert.deepStrictEqual((await service.readLegacyReferences(candidate))?.referencedBy, [invalidPath]);
			assert.deepStrictEqual([baseHalfLegacyBadgePathAccepted(invalidPath, candidate.relativePath), baseHalfLegacyBadgePathAccepted('ok.md', candidate.relativePath)], [false, true]);
		}
		const result = await service.readBadges(nodes);
		assert.strictEqual(result.badges.size, invalidPaths.length);
		assert.strictEqual(result.problems.length, 0);
	});

	test('a badge with only legacy keys is logically empty, and its legacy items stay readable for migration', async () => {
		const service = createService(new Map([
			['/work/.bh/mirror/a.md/badge.yaml', 'path: a.md\nkind: file\nreferences: [""]\nreferenced_by: [""]\n']
		]));

		assert.strictEqual(await service.readBadge(node('a.md', 'file')), null);
		const legacy = await service.readLegacyReferences(node('a.md', 'file'));
		assert.deepStrictEqual([legacy?.kind, legacy?.references, legacy?.referencedBy], ['file', [''], ['']]);
		assert.strictEqual(baseHalfLegacyBadgePathAccepted('', 'a.md'), true);
	});

	test('keeps badges with legacy self-references readable', async () => {
		const service = createService(new Map([
			['/work/.bh/mirror/outbound.md/badge.yaml', 'path: outbound.md\nkind: file\ndescription: Out\nreferences: ["outbound.md"]\nreferenced_by: []\n'],
			['/work/.bh/mirror/inbound.md/badge.yaml', 'path: inbound.md\nkind: file\ndescription: In\nreferences: []\nreferenced_by: ["inbound.md"]\n']
		]));

		assert.deepStrictEqual(await service.readBadge(node('outbound.md', 'file')), { path: 'outbound.md', kind: 'file', description: 'Out' });
		assert.deepStrictEqual(await service.readBadge(node('inbound.md', 'file')), { path: 'inbound.md', kind: 'file', description: 'In' });
		assert.deepStrictEqual((await service.readLegacyReferences(node('outbound.md', 'file')))?.references, ['outbound.md']);
		assert.strictEqual(baseHalfLegacyBadgePathAccepted('outbound.md', 'outbound.md'), false);
	});

	test('trusts the stored kind over the caller guess (a reference target defaults to file)', async () => {
		const service = createService(new Map([
			['/work/.bh/mirror/docs/badge.yaml', 'path: docs\nkind: folder\ndescription: Docs\nreferences: []\nreferenced_by: ["a.md"]\n']
		]));

		const badge = await service.readBadge(node('docs', 'file'));
		assert.strictEqual(badge?.kind, 'folder');
	});

	test('readBadges returns valid badges, skips one whose content cannot be read, and keeps malformed legacy keys apart', async () => {
		const service = createService(new Map([
			['/work/.bh/mirror/a.md/badge.yaml', 'path: a.md\nkind: file\ndescription: Alpha\nreferences: []\nreferenced_by: []\n'],
			['/work/.bh/mirror/b.md/badge.yaml', 'path: b.md\nkind: link\n'],
			['/work/.bh/mirror/c.md/badge.yaml', 'path: c.md\nkind: file\ndescription: Gamma\nreferences: [1]\nreferenced_by: {bad: map}\n']
		]));

		const result = await service.readBadges([
			node('a.md', 'file'),
			node('b.md', 'file'),
			node('c.md', 'file'),
			node('missing.md', 'file')
		]);

		assert.deepStrictEqual([...result.badges.keys()], ['a.md', 'c.md']);
		assert.deepStrictEqual(result.badges.get('a.md'), {
			path: 'a.md',
			kind: 'file',
			description: 'Alpha'
		});
		assert.deepStrictEqual(result.problems, []);
		assert.deepStrictEqual((await service.readLegacyReferences(node('c.md', 'file')))?.malformed, ['references', 'referenced_by']);
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
				...(current ?? { path: 'docs/readme.md', kind: 'file' }),
				description: 'Local note'
			};
		});

		assert.strictEqual(updateCount, 2);
		assert.strictEqual(fileService.createCount, 1);
		assert.strictEqual(fileService.writeCount, 1);
		assert.deepStrictEqual(updated, {
			path: 'docs/readme.md',
			kind: 'file',
			description: 'Local note'
		});
		assert.strictEqual(fileService.files.get(badgePath), 'path: "docs/readme.md"\nkind: file\ndescription: "Local note"\nreferences:\n  - "external.md"\nreferenced_by: []\n');
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
			...(current ?? { path: 'docs/readme.md', kind: 'file' }),
			orphan: true
		}));

		assert.strictEqual((await service.readBadge(node('docs/readme.md', 'file')))?.description, 'BBBB');
		assert.strictEqual((await service.readBadge(node('docs/readme.md', 'file')))?.orphan, true);
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

	test('writes the badge schema without references and keeps legacy keys verbatim through every write', async () => {
		const badgePath = '/work/.bh/mirror/a.md/badge.yaml';
		const legacy = [
			'references:   # from an earlier release',
			'- "b.md"',
			'  - weird: [indent',
			'referenced_by: {not: a list}',
			''
		].join('\n');
		const fileService = new TestFileService(new Map([[badgePath, `path: a.md\nkind: file\n${legacy}description: Old\n`]]));
		const service = mirrorService(fileService);

		assert.deepStrictEqual(await service.readBadge(node('a.md', 'file')), { path: 'a.md', kind: 'file', description: 'Old' });
		await service.patchBadge(node('a.md', 'file'), current => ({ ...current!, description: 'New' }));
		assert.strictEqual(fileService.files.get(badgePath), `path: "a.md"\nkind: file\ndescription: "New"\n${legacy}`);
		assert.strictEqual(await service.patchBadge(node('a.md', 'file'), () => null), null);
		assert.strictEqual(fileService.files.get(badgePath), `path: "a.md"\nkind: file\n${legacy}`);

		const freshFiles = new TestFileService(new Map());
		await mirrorService(freshFiles).patchBadge(node('new.md', 'file'), () => ({ path: 'new.md', kind: 'file', description: 'Only this' }));
		assert.strictEqual(freshFiles.files.get('/work/.bh/mirror/new.md/badge.yaml'), 'path: "new.md"\nkind: file\ndescription: "Only this"\n');
	});

	test('lists legacy pairs for migration and removes migrated items and empty keys', async () => {
		const fileService = new TestFileService(new Map([
			['/work/.bh/mirror/a.md/badge.yaml', 'path: a.md\nkind: file\ndescription: A\nreferences:\n  - b.md\n  - c.md\nreferenced_by: []\n'],
			['/work/.bh/mirror/b.md/badge.yaml', 'path: b.md\nkind: file\nreferences: []\nreferenced_by:\n  - a.md\n'],
			['/work/.bh/mirror/c.md/badge.yaml', 'path: c.md\nkind: file\ndescription: plain\n']
		]));
		fileService.directories.set('/work/.bh/mirror', ['a.md', 'b.md', 'c.md']);
		const service = mirrorService(fileService);

		const listed = await service.listLegacyReferences(workspaceFolder);
		assert.deepStrictEqual(listed.entries.map(entry => [entry.relativePath, entry.kind, entry.references, entry.referencedBy, entry.malformed]), [
			['a.md', 'file', ['b.md', 'c.md'], [], []],
			['b.md', 'file', [], ['a.md'], []]
		]);

		const remaining = await service.removeLegacyReferences(node('a.md', 'file'), { references: ['b.md'] });
		assert.deepStrictEqual([remaining?.references, remaining?.referencedBy], [['c.md'], []]);
		assert.strictEqual(fileService.files.get('/work/.bh/mirror/a.md/badge.yaml'), 'path: a.md\nkind: file\ndescription: A\nreferences:\n  - "c.md"\nreferenced_by: []\n');
		await service.removeLegacyReferences(node('b.md', 'file'), { referencedBy: ['a.md'] });
		assert.strictEqual(fileService.files.get('/work/.bh/mirror/b.md/badge.yaml'), 'path: b.md\nkind: file\nreferences: []\n');
		assert.strictEqual(await service.removeLegacyReferences(node('c.md', 'file'), { references: ['x.md'] }), undefined);
	});

	test('renames legacy items that name a moved path and keeps every other byte verbatim', async () => {
		const rename = (item: string) => item === 'docs' || item.startsWith('docs/') ? `archive${item.slice(4)}` : undefined;
		const badge = [
			'path: "notes.md"',
			'kind: file',
			'description: "keeps: this"',
			'# a comment the legacy writer never wrote',
			'references:',
			'  - "docs/a.md"',
			'  - other.md',
			'  - "docs"',
			'referenced_by:',
			'  - "untouched.md"',
			'orphan: true',
			''
		].join('\r\n');
		const malformed = 'path: x.md\nkind: file\nreferences: docs/a.md\nreferenced_by:\n  - docs/a.md\n';
		const fileService = new TestFileService(new Map([
			['/work/.bh/mirror/notes.md/badge.yaml', badge],
			['/work/.bh/mirror/plain.md/badge.yaml', 'path: plain.md\nkind: file\nreferences:\n  - other.md\n']
		]));
		const service = mirrorService(fileService);
		assert.deepStrictEqual({
			text: baseHalfRenameLegacyBadgeItems(badge, rename),
			// A malformed key stays as it is; a well-formed one is renamed.
			malformed: baseHalfRenameLegacyBadgeItems(malformed, rename),
			unrelated: baseHalfRenameLegacyBadgeItems('path: y.md\nkind: file\nreferences:\n  - other.md # note\n', rename),
			wrote: [await service.renameLegacyReferences(node('notes.md', 'file'), rename), await service.renameLegacyReferences(node('plain.md', 'file'), rename), await service.renameLegacyReferences(node('absent.md', 'file'), rename)],
			written: fileService.files.get('/work/.bh/mirror/notes.md/badge.yaml') === baseHalfRenameLegacyBadgeItems(badge, rename)
		}, {
			text: [
				'path: "notes.md"',
				'kind: file',
				'description: "keeps: this"',
				'# a comment the legacy writer never wrote',
				'references:',
				'  - "archive/a.md"',
				'  - "other.md"',
				'  - "archive"',
				'referenced_by:',
				'  - "untouched.md"',
				'orphan: true',
				''
			].join('\r\n'),
			malformed: 'path: x.md\nkind: file\nreferences: docs/a.md\nreferenced_by:\n  - "archive/a.md"\n',
			unrelated: 'path: y.md\nkind: file\nreferences:\n  - other.md # note\n',
			wrote: [true, false, false],
			written: true
		});
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
		return disposables.add(new BaseHalfBadgeMirrorService(fileService as unknown as IFileService));
	}
});

class TestFileService {
	readonly files: Map<string, string>;
	readonly directories = new Map<string, string[]>();
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

	async resolve(resource: URI): Promise<IFileStat> {
		const children = this.directories.get(resource.fsPath);
		if (children) {
			return { ...stat(resource, FileType.Directory), children: children.map(name => stat(URI.joinPath(resource, name), FileType.Directory)) };
		}
		if ([...this.files.keys()].some(path => path.startsWith(`${resource.fsPath}/`))) {
			const names = new Set<string>();
			for (const path of this.files.keys()) {
				if (path.startsWith(`${resource.fsPath}/`)) {
					names.add(path.slice(resource.fsPath.length + 1).split('/')[0]);
				}
			}
			return {
				...stat(resource, FileType.Directory),
				children: [...names].map(name => {
					const child = URI.joinPath(resource, name);
					return stat(child, this.files.has(child.fsPath) ? FileType.File : FileType.Directory);
				})
			};
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
