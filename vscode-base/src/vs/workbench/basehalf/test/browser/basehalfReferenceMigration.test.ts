/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { timeout } from '../../../../base/common/async.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { joinPath, relativePath as getRelativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IBulkEditService } from '../../../../editor/browser/services/bulkEditService.js';
import { TestConfigurationService } from '../../../../platform/configuration/test/common/testConfigurationService.js';
import { MockContextKeyService } from '../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { FileService } from '../../../../platform/files/common/fileService.js';
import { FileSystemProviderCapabilities, IFileService, IFileWriteOptions } from '../../../../platform/files/common/files.js';
import { InMemoryFileSystemProvider } from '../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { INotificationHandle, INotificationService, IPromptChoice, IPromptOptions, NoOpNotification, NotificationMessage, Severity } from '../../../../platform/notification/common/notification.js';
import { TestNotificationService } from '../../../../platform/notification/test/common/testNotificationService.js';
import { IProgressService } from '../../../../platform/progress/common/progress.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { UriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentityService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { testWorkspace } from '../../../../platform/workspace/test/common/testWorkspace.js';
import { BulkEditService } from '../../../contrib/bulkEdit/browser/bulkEditService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ISearchService } from '../../../services/search/common/search.js';
import { IWorkingCopyFileService } from '../../../services/workingCopy/common/workingCopyFileService.js';
import { workbenchInstantiationService } from '../../../test/browser/workbenchTestServices.js';
import { TestContextService } from '../../../test/common/workbenchTestServices.js';
import { BaseHalfMirrorCascadeContribution } from '../../browser/basehalfMirrorCascade.contribution.js';
import { IBaseHalfNodeExecutionService } from '../../browser/basehalfNodeExecutionService.js';
import { BaseHalfNodeRunLeaseStore } from '../../browser/basehalfNodeRunLease.js';
import { IBaseHalfPluginStructuralDeleteCleanupService } from '../../browser/basehalfPluginStructuralDeleteCleanup.js';
import { BaseHalfReferenceEditService } from '../../browser/basehalfReferenceEditService.js';
import { BaseHalfReferenceMigrationController } from '../../browser/basehalfReferenceMigration.contribution.js';
import { BaseHalfAdhdMirrorService, IBaseHalfAdhdMirrorService } from '../../common/basehalfAdhdMirror.js';
import { BaseHalfBadgeMirrorService, IBaseHalfBadgeMirrorService } from '../../common/basehalfBadgeMirror.js';
import { BaseHalfCanvasMirrorService, IBaseHalfCanvasMirrorService } from '../../common/basehalfCanvasMirror.js';
import { IBaseHalfCanvasNavigationService } from '../../common/basehalfCanvasNavigation.js';
import { IBaseHalfCanvasViewportStateService } from '../../common/basehalfCanvasViewportState.js';
import { BaseHalfEditorFlushService, IBaseHalfEditorFlushService } from '../../common/basehalfEditorFlush.js';
import { BaseHalfLegacyMigrationGate } from '../../common/basehalfLegacyMigrationGate.js';
import { createBaseHalfNodeDocument, parseBaseHalfNodeDocument, serializeBaseHalfNodeDocument } from '../../common/basehalfNodeDocument.js';
import { IBaseHalfReferenceEditService } from '../../common/basehalfReferenceEdit.js';
import { BaseHalfReferenceIndexService, IBaseHalfReferenceIndexService } from '../../common/basehalfReferenceIndex.js';
import {
	BASEHALF_LEGACY_REFERENCES_RECORD_FILE_NAME,
	BaseHalfReferenceMigrationService,
	baseHalfLegacyPromptCounts,
	baseHalfLegacyReportRows,
	IBaseHalfLegacyFolderPlan,
	IBaseHalfLegacyMigrationResult,
	IBaseHalfReferenceMigrationService,
	parseBaseHalfLegacyRecords
} from '../../common/basehalfReferenceMigration.js';
import { BaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceMutationCoordinator } from '../../common/basehalfWorkspaceMutation.js';
import { baseHalfNodeTestId } from '../common/basehalfNodeTestFixtures.js';
import { BaseHalfInMemoryFileSearchService } from './basehalfReferenceTestFixtures.js';

const folder = URI.file('/work');
const recordPath = `.bh/${BASEHALF_LEGACY_REFERENCES_RECORD_FILE_NAME}`;

/** Whole-file writes (the in-memory open/write/close path does not truncate) and an optional trash. */
class TestFileSystemProvider extends InMemoryFileSystemProvider {
	trash = false;
	/** Whole-file writes per path. */
	readonly writes = new Map<string, number>();

	override get capabilities(): FileSystemProviderCapabilities {
		const capabilities = super.capabilities & ~FileSystemProviderCapabilities.FileOpenReadWriteClose;
		return this.trash ? capabilities | FileSystemProviderCapabilities.Trash : capabilities;
	}

	override async writeFile(resource: URI, content: Uint8Array, opts: IFileWriteOptions): Promise<void> {
		this.writes.set(resource.path, (this.writes.get(resource.path) ?? 0) + 1);
		return super.writeFile(resource, content, opts);
	}
}

interface IHarness {
	readonly fileService: IFileService;
	readonly provider: TestFileSystemProvider;
	/** A new migration service: a new session as far as key removal is concerned. */
	session(): IBaseHalfReferenceMigrationService;
	cascade(): void;
	readonly workingCopyFileService: IWorkingCopyFileService;
	read(path: string): Promise<string | undefined>;
	write(path: string, content: string): Promise<void>;
	/** Every file below the workspace folder with its text. */
	tree(): Promise<Record<string, string>>;
}

async function createHarness(disposables: DisposableStore, files: Record<string, string>, settings: { readonly enableTrash?: boolean; readonly nestedFolders?: readonly URI[] } = {}): Promise<IHarness> {
	const fileService = disposables.add(new FileService(new NullLogService()));
	const provider = disposables.add(new TestFileSystemProvider());
	disposables.add(fileService.registerProvider(Schemas.file, provider));
	await fileService.createFolder(folder);
	for (const [path, content] of Object.entries(files)) {
		if (path.endsWith('/')) {
			await fileService.createFolder(joinPath(folder, ...path.split('/').filter(Boolean)));
		} else {
			await fileService.writeFile(joinPath(folder, ...path.split('/')), VSBuffer.fromString(content));
		}
	}
	await timeout(20);
	const configuration = new TestConfigurationService({ files: { autoSave: 'afterDelay', enableTrash: settings.enableTrash ?? true } });
	const instantiationService = workbenchInstantiationService({ fileService: () => fileService, configurationService: () => configuration }, disposables);
	instantiationService.stub(IWorkspaceContextService, new TestContextService(testWorkspace(folder, ...(settings.nestedFolders ?? []))));
	instantiationService.stub(ISearchService, new BaseHalfInMemoryFileSearchService(fileService));
	instantiationService.stub(IBulkEditService, instantiationService.createInstance(BulkEditService));
	instantiationService.stub(IBaseHalfEditorFlushService, new BaseHalfEditorFlushService());
	instantiationService.stub(IBaseHalfWorkspaceMutationCoordinator, new BaseHalfWorkspaceMutationCoordinator());
	instantiationService.stub(INotificationService, new TestNotificationService());
	instantiationService.stub(IBaseHalfCanvasNavigationService, {
		state: { canvasFolder: undefined, cardDetail: undefined },
		activeCanvasEditor: undefined,
		openCardDetail: async () => ({ handled: false, reason: 'unsupportedResource' })
	} as Partial<IBaseHalfCanvasNavigationService> as IBaseHalfCanvasNavigationService);
	const index = disposables.add(instantiationService.createInstance(BaseHalfReferenceIndexService));
	instantiationService.stub(IBaseHalfReferenceIndexService, index);
	instantiationService.stub(IBaseHalfAdhdMirrorService, disposables.add(instantiationService.createInstance(BaseHalfAdhdMirrorService)));
	instantiationService.stub(IBaseHalfReferenceEditService, disposables.add(instantiationService.createInstance(BaseHalfReferenceEditService)));
	instantiationService.stub(IBaseHalfBadgeMirrorService, disposables.add(new BaseHalfBadgeMirrorService(fileService)));
	instantiationService.stub(IBaseHalfCanvasMirrorService, disposables.add(instantiationService.createInstance(BaseHalfCanvasMirrorService)));
	instantiationService.stub(IBaseHalfCanvasViewportStateService, { forgetSubtree: () => { } } as Partial<IBaseHalfCanvasViewportStateService> as IBaseHalfCanvasViewportStateService);
	instantiationService.stub(IBaseHalfNodeExecutionService, { acquireStructuralOperation: async () => ({ dispose: () => { } }) } as Partial<IBaseHalfNodeExecutionService> as IBaseHalfNodeExecutionService);
	instantiationService.stub(IBaseHalfPluginStructuralDeleteCleanupService, { stageDelete: async () => [] } as Partial<IBaseHalfPluginStructuralDeleteCleanupService> as IBaseHalfPluginStructuralDeleteCleanupService);
	await index.whenReady(folder);
	for (const nested of settings.nestedFolders ?? []) {
		await index.whenReady(nested);
	}
	const read = async (path: string) => {
		try {
			return (await fileService.readFile(joinPath(folder, ...path.split('/')))).value.toString();
		} catch {
			return undefined;
		}
	};
	return {
		fileService,
		provider,
		session: () => instantiationService.createInstance(BaseHalfReferenceMigrationService),
		cascade: () => {
			disposables.add(instantiationService.createInstance(BaseHalfMirrorCascadeContribution));
		},
		workingCopyFileService: instantiationService.get(IWorkingCopyFileService),
		read,
		async write(path, content) {
			await fileService.writeFile(joinPath(folder, ...path.split('/')), VSBuffer.fromString(content));
		},
		async tree() {
			const out: Record<string, string> = {};
			const stack = [folder];
			while (stack.length) {
				const stat = await fileService.resolve(stack.pop()!);
				for (const child of stat.children ?? []) {
					if (child.isDirectory) {
						stack.push(child.resource);
					} else {
						const path = getRelativePath(folder, child.resource)!;
						out[path] = (await read(path)) ?? '';
					}
				}
			}
			return Object.fromEntries(Object.entries(out).sort(([left], [right]) => left.localeCompare(right)));
		}
	};
}

function badge(path: string, options: { kind?: 'file' | 'folder'; description?: string; references?: string[]; referencedBy?: string[] } = {}): string {
	let text = `path: ${JSON.stringify(path)}\nkind: ${options.kind ?? 'file'}\n`;
	if (options.description) {
		text += `description: ${JSON.stringify(options.description)}\n`;
	}
	if (options.references) {
		text += `references:\n${options.references.map(item => `  - ${JSON.stringify(item)}\n`).join('')}`;
	}
	if (options.referencedBy) {
		text += `referenced_by:\n${options.referencedBy.map(item => `  - ${JSON.stringify(item)}\n`).join('')}`;
	}
	return text;
}

function nodeDocument(id: number): string {
	return serializeBaseHalfNodeDocument(createBaseHalfNodeDocument({
		id: baseHalfNodeTestId(id),
		kind: 'video',
		title: 'Clip',
		role: 'Generated result',
		recipe: { recipeId: 'ai-video.text-to-video', parameters: {}, inputBindings: [] }
	}));
}

function outcomes(result: IBaseHalfLegacyMigrationResult): string[] {
	return result.folders.flatMap(folderResult => folderResult.pairs.map(pair => `${pair.upstream}→${pair.downstream} ${pair.outcome}${pair.reason ? ` ${pair.reason}` : ''}`));
}

function records(text: string | undefined): string[] {
	return parseBaseHalfLegacyRecords(text ?? '').map(record => `${record.upstream ?? record.badge}→${record.downstream ?? record.key} ${record.outcome}${record.reason ? ` ${record.reason}` : ''}`);
}

function planned(plan: IBaseHalfLegacyFolderPlan | undefined): string[] {
	return (plan?.pairs ?? []).map(pair => `${pair.upstream}→${pair.downstream} ${pair.status.kind}${pair.status.kind === 'dropped' || pair.status.kind === 'deferred' ? ` ${pair.status.reason}` : ''}`);
}

suite('BaseHalfReferenceMigration (services)', () => {
	const disposables = new DisposableStore();
	teardown(() => disposables.clear());
	ensureNoDisposablesAreLeakedInTestSuite();

	test('moves complete pairs after confirmation, records every pair first, and removes keys only on a later detection', async () => {
		const a = badge('notes/a.md', { description: 'Trunk', references: ['notes/b.md', 'docs', 'clip.bhnode', 'one.md'] });
		const b = badge('notes/b.md', { referencedBy: ['notes/a.md'] });
		const docs = badge('docs', { kind: 'folder', description: 'Docs', referencedBy: ['notes/a.md'] });
		const clip = badge('clip.bhnode', { referencedBy: ['notes/a.md'] });
		const fixture: Record<string, string> = {
			'notes/a.md': '# A\n',
			'notes/b.md': '---\ntitle: B\n---\n# B\n',
			'one.md': '# One\n',
			'docs/readme.txt': 'readme',
			'clip.bhnode': nodeDocument(1),
			'.bh/mirror/notes/a.md/badge.yaml': a,
			'.bh/mirror/notes/b.md/badge.yaml': b,
			'.bh/mirror/docs/badge.yaml': docs,
			'.bh/mirror/clip.bhnode/badge.yaml': clip
		};
		const harness = await createHarness(disposables, fixture);
		const first = harness.session();

		// Detection writes nothing while a pair needs a downstream write.
		const plan = await first.detect(folder);
		const preview = baseHalfLegacyReportRows(plan ? [plan] : []);
		assert.deepStrictEqual({
			planned: planned(plan),
			preview: preview.map(row => `${row.section} ${row.downstream} [${row.upstreams.join(', ')}]`),
			tree: await harness.tree()
		}, {
			planned: [
				'notes/a.md→clip.bhnode write',
				'notes/a.md→docs write',
				'notes/a.md→notes/b.md write',
				'notes/a.md→one.md dropped oneSided'
			],
			preview: [
				'add clip.bhnode [notes/a.md]',
				'add docs [notes/a.md]',
				'add notes/b.md [notes/a.md]',
				'cannot one.md [notes/a.md]'
			],
			tree: fixture
		});

		const result = await first.migrate([folder]);
		const after = await harness.tree();
		assert.deepStrictEqual({
			outcomes: outcomes(result),
			counts: [result.moved, result.files, result.notMoved],
			b: after['notes/b.md'],
			docs: after['.bh/mirror/docs/upstream.yaml'],
			clip: parseBaseHalfNodeDocument(after['clip.bhnode']).upstream,
			records: records(after[recordPath]),
			badges: [after['.bh/mirror/notes/a.md/badge.yaml'], after['.bh/mirror/notes/b.md/badge.yaml'], after['.bh/mirror/docs/badge.yaml'], after['.bh/mirror/clip.bhnode/badge.yaml']]
		}, {
			outcomes: [
				'notes/a.md→clip.bhnode migrated',
				'notes/a.md→docs migrated',
				'notes/a.md→notes/b.md migrated',
				'notes/a.md→one.md dropped oneSided'
			],
			counts: [3, 3, 1],
			b: '---\ntitle: B\nupstream:\n  - notes/a.md\n---\n# B\n',
			docs: 'upstream:\n  - notes/a.md\n',
			clip: ['notes/a.md'],
			records: [
				'notes/a.md→clip.bhnode migrated',
				'notes/a.md→docs migrated',
				'notes/a.md→notes/b.md migrated',
				'notes/a.md→one.md dropped oneSided'
			],
			// Every legacy key stays until a later detection.
			badges: [a, b, docs, clip]
		});

		// A detection in the same session removes nothing.
		await first.detect(folder);
		assert.strictEqual(await harness.read('.bh/mirror/notes/a.md/badge.yaml'), a);

		// The next session removes the keys of every recorded pair.
		assert.strictEqual(await harness.session().detect(folder), undefined);
		const settled = await harness.tree();
		assert.deepStrictEqual({
			badges: [settled['.bh/mirror/notes/a.md/badge.yaml'], settled['.bh/mirror/notes/b.md/badge.yaml'], settled['.bh/mirror/docs/badge.yaml'], settled['.bh/mirror/clip.bhnode/badge.yaml']],
			records: records(settled[recordPath]).length
		}, {
			badges: [
				badge('notes/a.md', { description: 'Trunk' }),
				badge('notes/b.md'),
				badge('docs', { kind: 'folder', description: 'Docs' }),
				badge('clip.bhnode')
			],
			records: 4
		});
	});

	test('undoing a migration edit before the next session leaves the pair recoverable', async () => {
		const a = badge('a.md', { references: ['b.md'] });
		const b = badge('b.md', { referencedBy: ['a.md'] });
		const harness = await createHarness(disposables, {
			'a.md': '# A\n',
			'b.md': '# B\n',
			'.bh/mirror/a.md/badge.yaml': a,
			'.bh/mirror/b.md/badge.yaml': b
		});
		const result = await harness.session().migrate([folder]);
		assert.deepStrictEqual(outcomes(result), ['a.md→b.md migrated']);
		assert.strictEqual(await harness.read('b.md'), '---\nupstream:\n  - a.md\n---\n# B\n');

		// The user undoes the edit in the document and saves.
		await harness.write('b.md', '# B\n');
		const next = harness.session();
		const plan = await next.detect(folder);
		assert.deepStrictEqual({
			planned: planned(plan),
			badges: [await harness.read('.bh/mirror/a.md/badge.yaml'), await harness.read('.bh/mirror/b.md/badge.yaml')]
		}, {
			planned: ['a.md→b.md write'],
			badges: [a, b]
		});
	});

	test('settles already-present and dropped pairs without a prompt, writing only .bh/', async () => {
		const a = badge('a.md', { references: ['b.md'] });
		const b = badge('b.md', { referencedBy: ['a.md', 'x.md'] });
		const fixture = {
			'a.md': '# A\n',
			'x.md': '# X\n',
			'b.md': '---\nupstream: [a.md]\n---\n# B\n',
			'.bh/mirror/a.md/badge.yaml': a,
			'.bh/mirror/b.md/badge.yaml': b
		};
		const harness = await createHarness(disposables, fixture);
		const plan = await harness.session().detect(folder);
		const after = await harness.tree();
		assert.deepStrictEqual({
			planned: planned(plan),
			changed: Object.keys(after).filter(path => after[path] !== fixture[path as keyof typeof fixture]),
			records: records(after[recordPath])
		}, {
			planned: ['a.md→b.md present', 'x.md→b.md dropped oneSided'],
			changed: [recordPath],
			records: ['a.md→b.md migrated alreadyPresent', 'x.md→b.md dropped oneSided']
		});

		await harness.session().detect(folder);
		assert.deepStrictEqual([await harness.read('.bh/mirror/a.md/badge.yaml'), await harness.read('.bh/mirror/b.md/badge.yaml'), await harness.read('b.md')], [
			badge('a.md'),
			badge('b.md'),
			'---\nupstream: [a.md]\n---\n# B\n'
		]);
	});

	test('a deferred pair keeps its keys and is offered again', async () => {
		const a = badge('a.md', { references: ['gone.md', 'toml.md'] });
		const gone = badge('gone.md', { referencedBy: ['a.md'] });
		const toml = badge('toml.md', { referencedBy: ['a.md'] });
		const harness = await createHarness(disposables, {
			'a.md': '# A\n',
			'toml.md': '+++\ntitle = "T"\n+++\n',
			'.bh/mirror/a.md/badge.yaml': a,
			'.bh/mirror/gone.md/badge.yaml': gone,
			'.bh/mirror/toml.md/badge.yaml': toml
		});
		const result = await harness.session().migrate([folder]);
		assert.deepStrictEqual({ outcomes: outcomes(result), counts: [result.moved, result.files, result.notMoved], records: records(await harness.read(recordPath)) }, {
			outcomes: ['a.md→gone.md deferred missingDownstream', 'a.md→toml.md deferred notWritable'],
			counts: [0, 0, 2],
			records: ['a.md→gone.md deferred missingDownstream', 'a.md→toml.md deferred notWritable']
		});
		const plan = await harness.session().detect(folder);
		assert.deepStrictEqual({
			planned: planned(plan),
			badges: [await harness.read('.bh/mirror/a.md/badge.yaml'), await harness.read('.bh/mirror/gone.md/badge.yaml'), await harness.read('.bh/mirror/toml.md/badge.yaml')]
		}, {
			planned: ['a.md→gone.md deferred missingDownstream', 'a.md→toml.md deferred notWritable'],
			badges: [a, gone, toml]
		});
	});

	test('a marked folder is never migrated and gets no record or sidecar', async () => {
		const fixture = {
			'.basehalf-no-workspace-setup': '',
			'a.md': '# A\n',
			'docs/readme.txt': 'x',
			'.bh/mirror/a.md/badge.yaml': badge('a.md', { references: ['docs'] }),
			'.bh/mirror/docs/badge.yaml': badge('docs', { kind: 'folder', referencedBy: ['a.md'] })
		};
		const harness = await createHarness(disposables, fixture);
		const session = harness.session();
		assert.strictEqual(await session.detect(folder), undefined);
		const result = await session.migrate([folder]);
		assert.deepStrictEqual([result.folders.length, await harness.tree()], [0, fixture]);
	});

	test('a fresh folder gets no .bh/', async () => {
		const harness = await createHarness(disposables, { 'a.md': '# A\n' });
		assert.strictEqual(await harness.session().detect(folder), undefined);
		assert.deepStrictEqual(await harness.tree(), { 'a.md': '# A\n' });
	});

	test('the preflight defers a running node before confirmation, and each note is written once', async () => {
		const harness = await createHarness(disposables, {
			'a.md': '# A\n',
			'c.md': '# C\n',
			'b.md': '# B\n',
			'clip.bhnode': nodeDocument(2),
			'.bh/mirror/a.md/badge.yaml': badge('a.md', { references: ['b.md', 'clip.bhnode'] }),
			'.bh/mirror/c.md/badge.yaml': badge('c.md', { references: ['b.md'] }),
			'.bh/mirror/b.md/badge.yaml': badge('b.md', { referencedBy: ['a.md', 'c.md'] }),
			'.bh/mirror/clip.bhnode/badge.yaml': badge('clip.bhnode', { referencedBy: ['a.md'] })
		});
		await new BaseHalfNodeRunLeaseStore(harness.fileService, 30_000).acquire(folder, baseHalfNodeTestId(2), 'clip.bhnode', 'owner', 'run', undefined);
		const session = harness.session();
		const plan = await session.plan(folder);
		assert.deepStrictEqual({
			planned: planned(plan),
			counts: baseHalfLegacyPromptCounts(plan ? [plan] : [])
		}, {
			planned: ['a.md→b.md write', 'c.md→b.md write', 'a.md→clip.bhnode deferred running'],
			counts: { connections: 2, notes: 1, nodeDocuments: 0, metadataItems: 0 }
		});

		harness.provider.writes.clear();
		const result = await session.migrate([folder]);
		assert.deepStrictEqual({
			outcomes: outcomes(result),
			counts: [result.moved, result.files],
			b: await harness.read('b.md'),
			writes: harness.provider.writes.get('/work/b.md')
		}, {
			outcomes: ['a.md→b.md migrated', 'c.md→b.md migrated', 'a.md→clip.bhnode deferred running'],
			counts: [2, 1],
			b: '---\nupstream:\n  - a.md\n  - c.md\n---\n# B\n',
			writes: 1
		});
	});

	test('a pair inside a nested workspace folder is deferred and keeps its keys', async () => {
		const nested = joinPath(folder, 'nested');
		const a = badge('nested/a.md', { references: ['nested/b.md'] });
		const b = badge('nested/b.md', { referencedBy: ['nested/a.md'] });
		const harness = await createHarness(disposables, {
			'nested/a.md': '# A\n',
			'nested/b.md': '# B\n',
			'.bh/mirror/nested/a.md/badge.yaml': a,
			'.bh/mirror/nested/b.md/badge.yaml': b
		}, { nestedFolders: [nested] });
		const result = await harness.session().migrate([folder]);
		await harness.session().detect(folder);
		assert.deepStrictEqual({
			outcomes: outcomes(result),
			records: records(await harness.read(recordPath)),
			badges: [await harness.read('.bh/mirror/nested/a.md/badge.yaml'), await harness.read('.bh/mirror/nested/b.md/badge.yaml')],
			b: await harness.read('nested/b.md')
		}, {
			outcomes: ['nested/a.md→nested/b.md deferred otherWorkspaceFolder'],
			records: ['nested/a.md→nested/b.md deferred otherWorkspaceFolder'],
			badges: [a, b],
			b: '# B\n'
		});
	});

	test('a Dropped record removes keys only while the pair is still unrepresentable', async () => {
		const a = badge('a.md', { references: ['b.md'] });
		const b = badge('b.md', { referencedBy: ['a.md'] });
		const harness = await createHarness(disposables, {
			'a.md': '# A\n',
			'b.md': '# B\n',
			'.bh/mirror/a.md/badge.yaml': a,
			'.bh/mirror/b.md/badge.yaml': b,
			// An earlier build dropped this complete pair for a reason that is not permanent.
			[recordPath]: '- upstream: "a.md"\n  downstream: "b.md"\n  outcome: dropped\n  reason: otherWorkspaceFolder\n  date: "2026-09-01"\n'
		});
		const plan = await harness.session().detect(folder);
		assert.deepStrictEqual({
			planned: planned(plan),
			badges: [await harness.read('.bh/mirror/a.md/badge.yaml'), await harness.read('.bh/mirror/b.md/badge.yaml')]
		}, {
			planned: ['a.md→b.md write'],
			badges: [a, b]
		});
	});
});

suite('BaseHalfMirrorCascade (upstream lists)', () => {
	const disposables = new DisposableStore();
	teardown(() => disposables.clear());
	ensureNoDisposablesAreLeakedInTestSuite();

	const other = badge('other.md', { description: 'Other', references: ['docs'] });
	const fixture = (): Record<string, string> => ({
		'other.md': '# Other\n',
		'notes.md': '---\nupstream:\n  - docs\n  - docs/sub/pic.png\n---\n# Notes\n',
		'docs/readme.txt': 'readme',
		'docs/sub/pic.png': 'png',
		'.bh/mirror/docs/badge.yaml': badge('docs', { kind: 'folder', description: 'Docs', referencedBy: ['other.md'] }),
		'.bh/mirror/docs/upstream.yaml': 'upstream:\n  - other.md\n',
		'.bh/mirror/docs/sub/pic.png/upstream.yaml': 'upstream:\n  - notes.md\n',
		'.bh/mirror/docs/sub/pic.png/appearance.yaml': 'background: red\n',
		'.bh/mirror/other.md/badge.yaml': other
	});

	test('a workbench move carries the node\'s badge, appearance, and upstream lists, changes no other upstream list, and keeps legacy pairs complete', async () => {
		const harness = await createHarness(disposables, fixture());
		harness.cascade();
		await harness.workingCopyFileService.move([{ file: { source: joinPath(folder, 'docs'), target: joinPath(folder, 'archive') } }], CancellationToken.None);
		assert.deepStrictEqual(await harness.tree(), {
			'.bh/mirror/archive/badge.yaml': badge('archive', { kind: 'folder', description: 'Docs', referencedBy: ['other.md'] }),
			'.bh/mirror/archive/sub/pic.png/appearance.yaml': 'background: red\n',
			'.bh/mirror/archive/sub/pic.png/upstream.yaml': 'upstream:\n  - notes.md\n',
			'.bh/mirror/archive/upstream.yaml': 'upstream:\n  - other.md\n',
			// Legacy pairs before migration: the other end of the unmigrated
			// pair follows the move, so other.md → archive stays complete.
			'.bh/mirror/other.md/badge.yaml': badge('other.md', { description: 'Other', references: ['archive'] }),
			'archive/readme.txt': 'readme',
			'archive/sub/pic.png': 'png',
			// Without the rename refactor's Update, entries naming the old path dangle.
			'notes.md': '---\nupstream:\n  - docs\n  - docs/sub/pic.png\n---\n# Notes\n',
			'other.md': '# Other\n'
		});
	});

	test('legacy items follow nested moves and case-only renames, and a marked folder keeps them as they are', async () => {
		const legacy = (): Record<string, string> => ({
			'a.md': '# A\n',
			'topic/b.md': '# B\n',
			'.bh/mirror/a.md/badge.yaml': badge('a.md', { description: 'A', references: ['topic/b.md', 'topic'] }),
			'.bh/mirror/topic/b.md/badge.yaml': badge('topic/b.md', { referencedBy: ['a.md'] }),
			'.bh/mirror/topic/badge.yaml': badge('topic', { kind: 'folder', referencedBy: ['a.md'] })
		});
		const harness = await createHarness(disposables, legacy());
		harness.cascade();
		await harness.workingCopyFileService.move([{ file: { source: joinPath(folder, 'topic'), target: joinPath(folder, 'subject') } }], CancellationToken.None);
		await harness.workingCopyFileService.move([{ file: { source: joinPath(folder, 'a.md'), target: joinPath(folder, 'root.md') } }], CancellationToken.None);
		const moved = await harness.tree();

		const marked = await createHarness(disposables, { ...legacy(), '.basehalf-no-workspace-setup': '' });
		marked.cascade();
		await marked.workingCopyFileService.move([{ file: { source: joinPath(folder, 'topic'), target: joinPath(folder, 'subject') } }], CancellationToken.None);
		const kept = await marked.tree();

		assert.deepStrictEqual({
			moved: Object.fromEntries(Object.entries(moved).filter(([path]) => path.endsWith('badge.yaml'))),
			kept: kept['.bh/mirror/a.md/badge.yaml']
		}, {
			moved: {
				'.bh/mirror/root.md/badge.yaml': badge('root.md', { description: 'A', references: ['subject/b.md', 'subject'] }),
				'.bh/mirror/subject/b.md/badge.yaml': badge('subject/b.md', { referencedBy: ['root.md'] }),
				'.bh/mirror/subject/badge.yaml': badge('subject', { kind: 'folder', referencedBy: ['root.md'] })
			},
			kept: badge('a.md', { description: 'A', references: ['topic/b.md', 'topic'] })
		});
	});

	test('a delete to the trash keeps the upstream lists of the subtree; a permanent delete removes them', async () => {
		const trashed = await createHarness(disposables, fixture());
		trashed.provider.trash = true;
		trashed.cascade();
		await trashed.workingCopyFileService.delete([{ resource: joinPath(folder, 'docs'), useTrash: true, recursive: true }], CancellationToken.None);
		const kept = await trashed.tree();

		const permanent = await createHarness(disposables, fixture(), { enableTrash: false });
		permanent.cascade();
		await permanent.workingCopyFileService.delete([{ resource: joinPath(folder, 'docs'), useTrash: false, recursive: true }], CancellationToken.None);
		const removed = await permanent.tree();

		// The retired badge keeps only its identity and the legacy keys a
		// migration has not removed yet; the other badge is untouched.
		const retired = badge('docs', { kind: 'folder', referencedBy: ['other.md'] });
		assert.deepStrictEqual({ kept, removed }, {
			kept: {
				'.bh/mirror/docs/badge.yaml': retired,
				'.bh/mirror/docs/sub/pic.png/appearance.yaml': 'background: red\n',
				'.bh/mirror/docs/sub/pic.png/upstream.yaml': 'upstream:\n  - notes.md\n',
				'.bh/mirror/docs/upstream.yaml': 'upstream:\n  - other.md\n',
				'.bh/mirror/other.md/badge.yaml': other,
				'notes.md': '---\nupstream:\n  - docs\n  - docs/sub/pic.png\n---\n# Notes\n',
				'other.md': '# Other\n'
			},
			removed: {
				'.bh/mirror/docs/badge.yaml': retired,
				'.bh/mirror/docs/sub/pic.png/appearance.yaml': 'background: red\n',
				'.bh/mirror/other.md/badge.yaml': other,
				'notes.md': '---\nupstream:\n  - docs\n  - docs/sub/pic.png\n---\n# Notes\n',
				'other.md': '# Other\n'
			}
		});
	});
});

class TestPromptHandle extends NoOpNotification {
	private readonly onDidCloseEmitter: Emitter<void>;
	override readonly onDidClose: Event<void>;
	private closed = false;

	constructor(store: DisposableStore, readonly prompt: { message: string; readonly choices: IPromptChoice[] }) {
		super();
		this.onDidCloseEmitter = store.add(new Emitter<void>());
		this.onDidClose = this.onDidCloseEmitter.event;
	}

	override updateMessage(message: NotificationMessage): void {
		this.prompt.message = String(message);
	}

	override close(): void {
		if (!this.closed) {
			this.closed = true;
			this.onDidCloseEmitter.fire();
		}
	}
}

class RecordingPromptService extends TestNotificationService {
	readonly prompts: TestPromptHandle[] = [];
	readonly infos: string[] = [];

	constructor(private readonly store: DisposableStore) {
		super();
	}

	override info(message: string): INotificationHandle {
		this.infos.push(message);
		return super.info(message);
	}

	override prompt(_severity: Severity, message: string, choices: IPromptChoice[], _options?: IPromptOptions): INotificationHandle {
		const handle = new TestPromptHandle(this.store, { message, choices });
		this.prompts.push(handle);
		return handle;
	}
}

suite('BaseHalfReferenceMigrationController', () => {
	const disposables = new DisposableStore();
	teardown(() => disposables.clear());
	ensureNoDisposablesAreLeakedInTestSuite();

	function createController(plan: IBaseHalfLegacyFolderPlan | undefined) {
		const notifications = new RecordingPromptService(disposables);
		const gate = new BaseHalfLegacyMigrationGate();
		const migrations: URI[][] = [];
		const migration: IBaseHalfReferenceMigrationService = {
			_serviceBrand: undefined,
			detect: async () => plan,
			plan: async () => undefined,
			migrate: async folders => {
				migrations.push([...folders]);
				return { folders: [], moved: 2, files: 2, notMoved: 0 };
			}
		};
		const contextService = new TestContextService(testWorkspace(folder));
		const controller = disposables.add(new BaseHalfReferenceMigrationController(
			contextService,
			migration,
			gate,
			disposables.add(new BaseHalfBadgeMirrorService({} as IFileService)),
			notifications,
			{ withProgress: (_options: unknown, task: (progress: { report(): void }) => Promise<unknown>) => task({ report: () => { } }) } as Partial<IProgressService> as IProgressService,
			{ pick: async () => undefined } as Partial<IQuickInputService> as IQuickInputService,
			{ onDidFilesChange: Event.None } as Partial<IFileService> as IFileService,
			disposables.add(new UriIdentityService(disposables.add(new FileService(new NullLogService())))),
			disposables.add(new MockContextKeyService()),
			{} as IBaseHalfCanvasNavigationService,
			{} as IEditorService,
			new NullLogService()
		));
		return { controller, notifications, gate, migrations };
	}

	const pendingPlan: IBaseHalfLegacyFolderPlan = {
		workspaceFolder: folder,
		pairs: [
			{ upstream: 'a.md', downstream: 'b.md', inReferences: true, inReferencedBy: true, status: { kind: 'write' }, storeKind: 'markdown' },
			{ upstream: 'a.md', downstream: 'docs', inReferences: true, inReferencedBy: true, status: { kind: 'write' }, storeKind: 'sidecar' }
		],
		malformed: []
	};

	test('shows one prompt, and the old agent-instructions notification waits until it is answered or closed', async () => {
		const { controller, notifications, gate } = createController(pendingPlan);
		let settled = false;
		void gate.whenMigrationPromptSettled().then(() => { settled = true; });
		controller.start();
		for (let attempt = 0; attempt < 50 && notifications.prompts.length === 0; attempt++) {
			await timeout(1);
		}
		await timeout(5);
		assert.deepStrictEqual({
			prompts: notifications.prompts.map(handle => [handle.prompt.message, handle.prompt.choices.map(choice => choice.label)]),
			settled
		}, {
			prompts: [[
				'Connections from an earlier BaseHalf version are hidden until they are moved into your files. Move 2 connections? BaseHalf will save them inside 1 notes and in the lists it keeps for 1 other items.',
				['Move Connections', 'Preview', 'Later']
			]],
			settled: false
		});

		// Later closes the prompt: the gate opens and no second prompt appears this session.
		notifications.prompts[0].prompt.choices[2].run();
		notifications.prompts[0].close();
		await gate.whenMigrationPromptSettled();
		assert.strictEqual(notifications.prompts.length, 1);
	});

	test('with nothing to move the gate opens without a prompt', async () => {
		const { controller, notifications, gate } = createController(undefined);
		controller.start();
		await gate.whenMigrationPromptSettled();
		assert.deepStrictEqual(notifications.prompts, []);
	});

	test('Move Connections runs one migration and reports the result', async () => {
		const { controller, notifications, migrations, gate } = createController(pendingPlan);
		gate.releaseStartupHold();
		await controller.moveConnections();
		assert.deepStrictEqual({ migrations, infos: notifications.infos }, {
			migrations: [[folder]],
			infos: ['Moved 2 connections into 2 files.']
		});
	});
});
