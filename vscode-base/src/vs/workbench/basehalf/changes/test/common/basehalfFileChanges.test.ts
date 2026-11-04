/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { runWithFakedTimers } from '../../../../../base/test/common/timeTravelScheduler.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { UriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentityService.js';
import { ISCMProvider, ISCMRepository, ISCMResource, ISCMResourceGroup, ISCMService } from '../../../../contrib/scm/common/scm.js';
import { BaseHalfFileChangesService } from '../../common/basehalfFileChanges.js';

const ROOT = URI.file('/work');
const file = (path: string) => URI.joinPath(ROOT, path);
const git = (path: string, ref: string) => URI.from({ scheme: 'git', path: `/work/${path}`, query: ref });

interface IRow {
	readonly path: string;
	readonly original?: URI;
	readonly modified?: URI;
}

/** A repository of Source Control with groups of rows, as the Git extension gives them. */
class FakeRepository {
	readonly groupsChanged = new Emitter<void>();
	readonly resourcesChanged = new Emitter<void>();
	groups: ISCMResourceGroup[] = [];

	readonly provider = {
		rootUri: ROOT,
		get groups(): readonly ISCMResourceGroup[] { return repository.groups; },
		onDidChangeResourceGroups: this.groupsChanged.event,
		onDidChangeResources: this.resourcesChanged.event,
	} as unknown as ISCMProvider;

	setGroups(groups: Record<string, readonly IRow[]>): void {
		this.groups = Object.entries(groups).map(([id, rows]) => {
			const group = { id, resources: [] as ISCMResource[] } as unknown as ISCMResourceGroup & { resources: ISCMResource[] };
			group.resources = rows.map(row => ({
				resourceGroup: group,
				sourceUri: file(row.path),
				multiDiffEditorOriginalUri: row.original,
				multiDiffEditorModifiedUri: row.modified,
			}) as unknown as ISCMResource);
			return group;
		});
		this.resourcesChanged.fire();
	}

	dispose(): void {
		this.groupsChanged.dispose();
		this.resourcesChanged.dispose();
	}
}

let repository: FakeRepository;

suite('BaseHalf file changes', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createService(): BaseHalfFileChangesService {
		const disposables = store.add(new DisposableStore());
		repository = new FakeRepository();
		disposables.add({ dispose: () => repository.dispose() });
		const scmService = {
			repositories: [{ provider: repository.provider } as unknown as ISCMRepository],
			onDidAddRepository: Event.None,
			onDidRemoveRepository: Event.None,
		} as unknown as ISCMService;
		const fileService = disposables.add(new FileService(new NullLogService()));
		return disposables.add(new BaseHalfFileChangesService(scmService, disposables.add(new UriIdentityService(fileService))));
	}

	test('a modified file, a new file, and the folders above them, up to the repository', () => {
		const service = createService();
		repository.setGroups({
			workingTree: [
				{ path: 'src/deep/a.ts', original: git('src/deep/a.ts', '~'), modified: file('src/deep/a.ts') },
				{ path: 'notes/new.md', modified: file('notes/new.md') }
			]
		});
		assert.strictEqual(service.isChanged(file('src/deep/a.ts')), true);
		assert.strictEqual(service.isChanged(file('notes/new.md')), true);
		assert.strictEqual(service.isChanged(file('src/other.ts')), false);
		assert.strictEqual(service.holdsChange(file('src')), true);
		assert.strictEqual(service.holdsChange(file('src/deep')), true);
		assert.strictEqual(service.holdsChange(file('notes')), true);
		assert.strictEqual(service.holdsChange(file('pics')), false);
	});

	test('a file under .bh holds no folder as changed, and has no Changes view', () => {
		const service = createService();
		repository.setGroups({ workingTree: [{ path: 'sub/.bh/mirror/a.yaml', original: git('sub/.bh/mirror/a.yaml', '~'), modified: file('sub/.bh/mirror/a.yaml') }] });
		assert.strictEqual(service.holdsChange(file('sub')), false);
		assert.strictEqual(service.isChanged(file('sub/.bh/mirror/a.yaml')), true);
		assert.strictEqual(service.hasChangesView(file('sub/.bh/mirror/a.yaml')), false);
	});

	test('a comparison is of the group asked for, otherwise what is not staged first', () => {
		const service = createService();
		const notStaged = { path: 'a.ts', original: git('a.ts', '~'), modified: file('a.ts') };
		const staged = { path: 'a.ts', original: git('a.ts', 'HEAD'), modified: git('a.ts', '') };
		repository.setGroups({ index: [staged], workingTree: [notStaged] });
		assert.strictEqual(service.changeOf(file('a.ts'))?.groupId, 'workingTree');
		assert.strictEqual(service.changeOf(file('a.ts'), 'index')?.groupId, 'index');
		assert.strictEqual(service.changeOf(file('a.ts'), 'index')?.original.query, 'HEAD');
		repository.setGroups({ index: [staged] });
		assert.strictEqual(service.changeOf(file('a.ts'))?.groupId, 'index');
		assert.strictEqual(service.changeOf(file('a.ts'), 'workingTree')?.groupId, 'index');
	});

	test('a new file and a conflict have no comparison', () => {
		const service = createService();
		repository.setGroups({
			merge: [{ path: 'conflict.ts', original: git('conflict.ts', '~1'), modified: file('conflict.ts') }],
			workingTree: [{ path: 'new.ts', modified: file('new.ts') }]
		});
		assert.strictEqual(service.changeOf(file('new.ts')), undefined);
		assert.strictEqual(service.changeOf(file('conflict.ts')), undefined);
		assert.strictEqual(service.hasChangesView(file('new.ts')), false);
		assert.strictEqual(service.hasChangesView(file('conflict.ts')), false);
	});

	test('text and pictures have a Changes view; a PDF, a book, and what turned out not to be text do not', () => {
		const service = createService();
		const row = (path: string) => ({ path, original: git(path, '~'), modified: file(path) });
		repository.setGroups({ workingTree: [row('a.ts'), row('note.md'), row('p.png'), row('v.mp4'), row('s.wav'), row('d.pdf'), row('b.epub'), row('x.zip')] });
		const offered = ['a.ts', 'note.md', 'p.png', 'v.mp4', 's.wav', 'd.pdf', 'b.epub', 'x.zip', 'unchanged.ts'].filter(path => service.hasChangesView(file(path)));
		assert.deepStrictEqual(offered, ['a.ts', 'note.md', 'p.png', 'v.mp4', 's.wav', 'x.zip']);
		service.markNotText(file('x.zip'));
		assert.strictEqual(service.hasChangesView(file('x.zip')), false);
		assert.strictEqual(service.isChanged(file('x.zip')), true);
	});

	test('what turned out not to be text is forgotten once the file is no longer changed', () => {
		const service = createService();
		const row = { path: 'x.bin', original: git('x.bin', '~'), modified: file('x.bin') };
		repository.setGroups({ workingTree: [row] });
		service.markNotText(file('x.bin'));
		repository.setGroups({ workingTree: [] });
		assert.strictEqual(service.isChanged(file('x.bin')), false);
		repository.setGroups({ workingTree: [row] });
		assert.strictEqual(service.hasChangesView(file('x.bin')), true);
	});

	test('several groups changing say so once', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const service = createService();
		let fired = 0;
		const listener = service.onDidChange(() => fired++);
		repository.setGroups({ index: [] });
		repository.setGroups({ workingTree: [] });
		repository.groupsChanged.fire();
		await new Promise(resolve => setTimeout(resolve, 100));
		assert.strictEqual(fired, 1);
		listener.dispose();
	}));
});
