/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { timeout } from '../../../../base/common/async.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { joinPath, relativePath as getRelativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IBulkEditService } from '../../../../editor/browser/services/bulkEditService.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { TestConfigurationService } from '../../../../platform/configuration/test/common/testConfigurationService.js';
import { FileService } from '../../../../platform/files/common/fileService.js';
import { FileSystemProviderCapabilities, FileType, IFileService, IFileWriteOptions, IStat } from '../../../../platform/files/common/files.js';
import { InMemoryFileSystemProvider } from '../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { INotification, INotificationHandle, INotificationService, IPromptChoice, IPromptOptions, Severity } from '../../../../platform/notification/common/notification.js';
import { TestNotificationService } from '../../../../platform/notification/test/common/testNotificationService.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { IUndoRedoService, UndoRedoElementType, UndoRedoSource } from '../../../../platform/undoRedo/common/undoRedo.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { testWorkspace } from '../../../../platform/workspace/test/common/testWorkspace.js';
import { BulkEditService } from '../../../contrib/bulkEdit/browser/bulkEditService.js';
import { IFileQuery, ISearchComplete, ISearchService } from '../../../services/search/common/search.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { workbenchInstantiationService } from '../../../test/browser/workbenchTestServices.js';
import { TestContextService } from '../../../test/common/workbenchTestServices.js';
import { BaseHalfReferenceEditService } from '../../browser/basehalfReferenceEditService.js';
import { BaseHalfNodeRunLeaseStore } from '../../browser/basehalfNodeRunLease.js';
import { BaseHalfAdhdMirrorService, IBaseHalfAdhdMirrorService } from '../../common/basehalfAdhdMirror.js';
import { IBaseHalfCanvasNavigationService, IBaseHalfWorkspaceResource } from '../../common/basehalfCanvasNavigation.js';
import { BaseHalfEditorFlushService, IBaseHalfEditorFlushService } from '../../common/basehalfEditorFlush.js';
import { baseHalfMarkdownFrontmatterLineCount } from '../../common/basehalfMarkdownProjection.js';
import { baseHalfMarkdownRichDocumentKey } from '../../common/basehalfMarkdownRichLiveDocument.js';
import { createBaseHalfNodeDocument, IBaseHalfNodeDocument, parseBaseHalfNodeDocument, serializeBaseHalfNodeDocument } from '../../common/basehalfNodeDocument.js';
import {
	BASEHALF_REFERENCES_FIRST_FRONTMATTER_NOTICE_STORAGE_KEY,
	BaseHalfReferenceEditFailure,
	BaseHalfReferenceEditRefusal,
	IBaseHalfReferenceEditOptions
} from '../../common/basehalfReferenceEdit.js';
import { BaseHalfReferenceIndexService, IBaseHalfReferenceIndexService } from '../../common/basehalfReferenceIndex.js';
import { BaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceMutationCoordinator } from '../../common/basehalfWorkspaceMutation.js';
import { baseHalfNodeTestId } from '../common/basehalfNodeTestFixtures.js';

const folder = URI.file('/work');
const options: IBaseHalfReferenceEditOptions = { label: 'Connect', indexWaitMs: 2000 };

class RecordingNotificationService extends TestNotificationService {
	readonly messages: string[] = [];
	readonly prompts: { readonly message: string; readonly choices: IPromptChoice[] }[] = [];

	override notify(notification: INotification): INotificationHandle {
		this.messages.push(String(notification.message));
		return super.notify(notification);
	}

	override prompt(severity: Severity, message: string, choices: IPromptChoice[], promptOptions?: IPromptOptions): INotificationHandle {
		this.prompts.push({ message, choices });
		return super.prompt(severity, message, choices, promptOptions);
	}
}

/** Whole-file writes with atomic support. The in-memory provider's
 * open/write/close path does not truncate a file that is rewritten empty. */
class TestFileSystemProvider extends InMemoryFileSystemProvider {
	readonly failingWrites = new Set<string>();
	/** Paths reported as symbolic links. */
	readonly symbolicLinks = new Set<string>();

	override get capabilities(): FileSystemProviderCapabilities {
		return super.capabilities & ~FileSystemProviderCapabilities.FileOpenReadWriteClose;
	}

	override async stat(resource: URI): Promise<IStat> {
		const stat = await super.stat(resource);
		return this.symbolicLinks.has(resource.path) ? { ...stat, type: stat.type | FileType.SymbolicLink } : stat;
	}

	override async writeFile(resource: URI, content: Uint8Array, opts: IFileWriteOptions): Promise<void> {
		if (this.failingWrites.has(resource.path)) {
			throw new Error('disk full');
		}
		return super.writeFile(resource, content, opts);
	}
}

/** File search over the in-memory file system. It ignores exclude patterns on
 * purpose, so the index's own eligibility filter is what the tests observe. */
class FakeSearchService implements Pick<ISearchService, 'fileSearch'> {
	readonly queries: IFileQuery[] = [];
	limitHit = false;
	/** Extra results that name files which do not exist. */
	extraResults = 0;

	constructor(private readonly fileService: IFileService) { }

	async fileSearch(query: IFileQuery): Promise<ISearchComplete> {
		this.queries.push(query);
		const results: { resource: URI }[] = [];
		for (const folderQuery of query.folderQueries) {
			const stack = [folderQuery.folder];
			while (stack.length) {
				const current = stack.pop()!;
				let stat;
				try {
					stat = await this.fileService.resolve(current);
				} catch {
					continue;
				}
				for (const child of stat.children ?? []) {
					if (child.isDirectory) {
						stack.push(child.resource);
					} else if (/\.(?:md|markdown|bhnode)$/i.test(child.name)) {
						results.push({ resource: child.resource });
					}
				}
			}
		}
		for (let index = 0; index < this.extraResults; index++) {
			results.push({ resource: joinPath(folder, 'generated', `n${index}.md`) });
		}
		return { results, limitHit: this.limitHit, messages: [] };
	}
}

interface IHarness {
	readonly fileService: IFileService;
	readonly provider: TestFileSystemProvider;
	/** Runs `hook` once, right after the next bulk edit is applied. */
	afterNextBulkEdit(hook: () => Promise<void>): void;
	readonly index: BaseHalfReferenceIndexService;
	readonly edit: BaseHalfReferenceEditService;
	readonly search: FakeSearchService;
	readonly notifications: RecordingNotificationService;
	readonly flush: BaseHalfEditorFlushService;
	readonly undoRedo: IUndoRedoService;
	readonly textFileService: ITextFileService;
	readonly textModelService: ITextModelService;
	readonly storage: IStorageService;
	readonly adhd: IBaseHalfAdhdMirrorService;
	read(path: string): Promise<string | undefined>;
	write(path: string, content: string): Promise<void>;
	node(path: string): IBaseHalfWorkspaceResource;
	list(): Promise<string[]>;
}

async function createHarness(disposables: DisposableStore, files: Record<string, string>, settings: { autoSave?: string; searchLimitHit?: boolean; extraSearchResults?: number } = {}): Promise<IHarness> {
	const fileService = disposables.add(new FileService(new NullLogService()));
	const provider = disposables.add(new TestFileSystemProvider());
	disposables.add(fileService.registerProvider(Schemas.file, provider));
	await fileService.createFolder(folder);
	for (const [path, content] of Object.entries(files)) {
		await fileService.writeFile(joinPath(folder, ...path.split('/')), VSBuffer.fromString(content));
	}
	// Let the provider's debounced change events for the fixture settle first.
	await timeout(20);
	const configuration = new TestConfigurationService({ files: { autoSave: settings.autoSave ?? 'afterDelay', exclude: { hidden: true } } });
	const instantiationService = workbenchInstantiationService({ fileService: () => fileService, configurationService: () => configuration }, disposables);
	instantiationService.stub(IWorkspaceContextService, new TestContextService(testWorkspace(folder)));
	const search = new FakeSearchService(fileService);
	search.limitHit = settings.searchLimitHit ?? false;
	search.extraResults = settings.extraSearchResults ?? 0;
	instantiationService.stub(ISearchService, search);
	const bulkEditService = instantiationService.createInstance(BulkEditService);
	const bulkHooks: { next?: () => Promise<void> } = {};
	instantiationService.stub(IBulkEditService, {
		apply: async (edits: Parameters<BulkEditService['apply']>[0], applyOptions: Parameters<BulkEditService['apply']>[1]) => {
			const result = await bulkEditService.apply(edits, applyOptions);
			const hook = bulkHooks.next;
			bulkHooks.next = undefined;
			await hook?.();
			return result;
		}
	});
	const flush = new BaseHalfEditorFlushService();
	instantiationService.stub(IBaseHalfEditorFlushService, flush);
	instantiationService.stub(IBaseHalfWorkspaceMutationCoordinator, new BaseHalfWorkspaceMutationCoordinator());
	const adhd = disposables.add(instantiationService.createInstance(BaseHalfAdhdMirrorService));
	instantiationService.stub(IBaseHalfAdhdMirrorService, adhd);
	const notifications = new RecordingNotificationService();
	instantiationService.stub(INotificationService, notifications);
	instantiationService.stub(IBaseHalfCanvasNavigationService, { openCardDetail: async () => ({ handled: false, reason: 'unsupportedResource' }) });
	const index = disposables.add(instantiationService.createInstance(BaseHalfReferenceIndexService));
	instantiationService.stub(IBaseHalfReferenceIndexService, index);
	const edit = disposables.add(instantiationService.createInstance(BaseHalfReferenceEditService));
	await index.whenReady(folder);
	const textFileService = instantiationService.get(ITextFileService);
	return {
		fileService,
		provider,
		afterNextBulkEdit(hook) {
			bulkHooks.next = hook;
		},
		index,
		edit,
		search,
		notifications,
		flush,
		undoRedo: instantiationService.get(IUndoRedoService),
		textFileService,
		textModelService: instantiationService.get(ITextModelService),
		storage: instantiationService.get(IStorageService),
		adhd,
		async read(path) {
			try {
				return (await fileService.readFile(joinPath(folder, ...path.split('/')))).value.toString();
			} catch {
				return undefined;
			}
		},
		async write(path, content) {
			await fileService.writeFile(joinPath(folder, ...path.split('/')), VSBuffer.fromString(content));
		},
		node(path) {
			return { resource: joinPath(folder, ...path.split('/')), workspaceFolder: folder, relativePath: path };
		},
		async list() {
			const out: string[] = [];
			const stack = [folder];
			while (stack.length) {
				const stat = await fileService.resolve(stack.pop()!);
				for (const child of stat.children ?? []) {
					if (child.isDirectory) {
						stack.push(child.resource);
					} else {
						out.push(getRelativePath(folder, child.resource)!);
					}
				}
			}
			return out.sort();
		}
	};
}

async function until(condition: () => boolean | Promise<boolean>, message: string): Promise<void> {
	for (let attempt = 0; attempt < 400; attempt++) {
		if (await condition()) {
			return;
		}
		await timeout(5);
	}
	assert.fail(message);
}

async function refusal(promise: Promise<unknown>): Promise<BaseHalfReferenceEditRefusal> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof BaseHalfReferenceEditRefusal) {
			return error;
		}
		throw error;
	}
	assert.fail('Expected a refusal');
}

async function disposeModel(harness: IHarness, path: string): Promise<void> {
	const resource = harness.node(path).resource;
	await until(() => !harness.textFileService.isDirty(resource), `${path} stays dirty`);
	harness.textFileService.files.get(resource)?.dispose();
	assert.strictEqual(harness.textFileService.files.get(resource), undefined);
}

function nodeDocument(id: number, options: { upstream?: string[]; bindings?: { sourcePath: string; slot: string; order: number }[]; version?: 3 } = {}): string {
	const document = createBaseHalfNodeDocument({
		id: baseHalfNodeTestId(id),
		kind: 'video',
		title: 'Clip',
		role: 'Generated result',
		...(options.upstream ? { upstream: options.upstream } : {}),
		recipe: { recipeId: 'ai-video.text-to-video', parameters: {}, inputBindings: options.bindings ?? [] }
	});
	const serialized = serializeBaseHalfNodeDocument(document);
	if (options.version === 3) {
		const legacy = JSON.parse(serialized);
		delete legacy.upstream;
		legacy.version = 3;
		return `${JSON.stringify(legacy, null, '\t')}\n`;
	}
	return serialized;
}

suite('BaseHalfReferenceIndexService', () => {
	const disposables = new DisposableStore();
	teardown(() => disposables.clear());
	ensureNoDisposablesAreLeakedInTestSuite();

	test('derives downstream sets and reports dangling, invalid, unreadable, and not-writable stores', async () => {
		const harness = await createHarness(disposables, {
			'notes/a.md': '---\nupstream:\n  - b.md\n  - gone.md\n  - ~\n  - ../b.md\n---\n# A\n',
			'notes/b.md': '# B\n',
			'b.md': '# root B\n',
			'broken.md': '---\nupstream: *alias\n---\n',
			'break.md': '---\nupstream: nope\ntext [x\n---\n',
			'quote.md': '---\nJust a pull quote.\n---\n',
			'docs/readme.txt': 'x',
			'.bh/mirror/docs/upstream.yaml': 'upstream:\n  - notes/a.md\n',
			'.bh/mirror/notes/a.md/upstream.yaml': 'upstream:\n  - b.md\n',
			'.bh/mirror/missing.pdf/upstream.yaml': 'upstream:\n  - b.md\n',
			'clip.bhnode': nodeDocument(1, { upstream: ['b.md', 'notes/a.md'], bindings: [{ sourcePath: 'notes/a.md', slot: 'brief', order: 0 }] }),
			'node_modules/pkg/readme.md': '---\nupstream:\n  - b.md\n---\n',
			'outputs/run/copy.md': '---\nupstream:\n  - b.md\n---\n',
			'CLAUDE.md': '---\nupstream:\n  - b.md\n---\n',
			'hidden/note.md': '---\nupstream:\n  - b.md\n---\n'
		});
		const index = harness.index;
		assert.strictEqual(index.getState(folder), 'ready');
		assert.deepStrictEqual(index.getStores(folder).map(store => `${store.storeKind}:${store.node.relativePath}${store.sidecarState ? `:${store.sidecarState}` : ''}`).sort(), [
			'markdown:b.md',
			'markdown:break.md',
			'markdown:broken.md',
			'markdown:hidden/note.md',
			'markdown:notes/a.md',
			'markdown:notes/b.md',
			'markdown:quote.md',
			'node:clip.bhnode',
			'sidecar:docs:active',
			'sidecar:missing.pdf:missingNode',
			'sidecar:notes/a.md:wrongOwner'
		]);
		// Excluded by the canvas rules, not by `files.exclude`.
		assert.ok(harness.search.queries.every(query => query.folderQueries.every(folderQuery => folderQuery.disregardIgnoreFiles && folderQuery.ignoreSymlinks)));
		assert.ok(harness.search.queries.every(query => !JSON.stringify(query.excludePattern).includes('hidden')));

		assert.deepStrictEqual(index.getDownstream(harness.node('b.md')).map(entry => entry.node.relativePath), ['clip.bhnode', 'hidden/note.md', 'notes/a.md']);
		assert.deepStrictEqual(index.getDownstream(harness.node('notes/a.md')).map(entry => [entry.node.relativePath, entry.storeKind]), [['clip.bhnode', 'node'], ['docs', 'sidecar']]);

		const view = await index.resolveUpstream(harness.node('notes/a.md'));
		assert.deepStrictEqual(view.entries.map(entry => [entry.text, entry.status, entry.problem ?? null, entry.workspacePath ?? null, entry.issue]), [
			['b.md', 'valid', null, null, false],
			['gone.md', 'dangling', null, null, true],
			['~', 'invalid', 'empty', null, true],
			['../b.md', 'invalid', 'invalidSegment', 'b.md', true]
		]);
		assert.deepStrictEqual(view.misplacedSidecar?.items.map(item => item.path), ['b.md']);
		assert.strictEqual(view.issueCount, 4);

		const issues = await index.getIssues(folder);
		assert.deepStrictEqual(issues.map(issue => `${issue.kind}:${issue.node.relativePath}:${issue.problem ?? issue.entry?.text ?? ''}`), [
			'store:break.md:frontmatterRejected',
			'store:broken.md:anchorAliasTag',
			'entry:notes/a.md:gone.md',
			'entry:notes/a.md:~',
			'entry:notes/a.md:../b.md',
			'misplacedSidecar:notes/a.md:'
		]);
		// A note that cannot hold a list is shown as the list BaseHalf keeps
		// for it. A note that only starts with a thematic break has no issue;
		// one whose unrecognized block lists an entry has one, with a repair.
		const [quote, broken] = [await index.readUpstream(harness.node('quote.md')), await index.readUpstream(harness.node('break.md'))];
		assert.deepStrictEqual([quote, broken].map(note => [note.storeKind, note.storeResource.path, note.writable, note.storeIssue, note.problem ?? null]), [
			['sidecar', '/work/.bh/mirror/quote.md/upstream.yaml', true, false, null],
			['sidecar', '/work/.bh/mirror/break.md/upstream.yaml', true, true, 'frontmatterRejected']
		]);
	});

	test('a note with no upstream key uses its sidecar; a note with one ignores it', async () => {
		const harness = await createHarness(disposables, {
			'a.md': '# A\n',
			'c.md': '# C\n',
			'toml.md': '+++\ntitle = "T"\n+++\n# T\n',
			'.bh/mirror/toml.md/upstream.yaml': 'upstream:\n  - a.md\n',
			'plain.md': '# P\n',
			'.bh/mirror/plain.md/upstream.yaml': 'upstream:\n  - a.md\n',
			'own.md': '---\nupstream:\n  - c.md\n---\n# O\n',
			'.bh/mirror/own.md/upstream.yaml': 'upstream:\n  - a.md\n'
		});
		const index = harness.index;
		const state = async () => ({
			sidecars: index.getStores(folder).filter(store => store.storeKind === 'sidecar').map(store => `${store.node.relativePath}:${store.sidecarState}`).sort(),
			downstreamOfA: index.getDownstream(harness.node('a.md')).map(entry => `${entry.node.relativePath}:${entry.storeKind}`),
			views: await Promise.all(['toml.md', 'plain.md', 'own.md'].map(async path => {
				const view = await index.resolveUpstream(harness.node(path));
				return [path, view.storeKind, view.entries.map(entry => entry.text).join(','), !!view.misplacedSidecar, view.issueCount];
			})),
			issues: (await index.getIssues(folder)).map(issue => `${issue.kind}:${issue.node.relativePath}`)
		});
		assert.deepStrictEqual(await state(), {
			sidecars: ['own.md:wrongOwner', 'plain.md:active', 'toml.md:active'],
			downstreamOfA: ['plain.md:sidecar', 'toml.md:sidecar'],
			views: [
				// The note cannot hold a list: BaseHalf keeps it, with no issue.
				['toml.md', 'sidecar', 'a.md', false, 0],
				// The note could hold it: the list stays in use and can move in.
				['plain.md', 'sidecar', 'a.md', true, 1],
				// The note has its own list: the sidecar is ignored.
				['own.md', 'markdown', 'c.md', true, 1]
			],
			issues: ['misplacedSidecar:own.md', 'misplacedSidecar:plain.md']
		});

		// A note that gains a list of its own stops using its sidecar, and one
		// that loses it uses the sidecar again.
		await harness.write('plain.md', '---\nupstream:\n  - c.md\n---\n# P\n');
		await harness.write('own.md', '# O\n');
		await until(async () => (await state()).sidecars.join() === 'own.md:active,plain.md:wrongOwner,toml.md:active', 'the sidecar states to follow the notes');
		assert.deepStrictEqual((await state()).downstreamOfA, ['own.md:sidecar', 'toml.md:sidecar']);
	});

	test('marks dangling bound entries of attempted nodes as historical and reports sealed artifacts', async () => {
		const sealed = JSON.parse(nodeDocument(2, { upstream: ['gone.md'], bindings: [{ sourcePath: 'gone.md', slot: 'brief', order: 0 }] }));
		sealed.result = { source: 'imported', artifact: { id: 'a', outputId: 'o', kind: 'video', path: 'renders/final.md', sha256: 'A'.repeat(43), size: 1 } };
		const harness = await createHarness(disposables, {
			'result.bhnode': JSON.stringify(sealed),
			'renders/final.md': '# final\n'
		});
		const view = await harness.index.resolveUpstream(harness.node('result.bhnode'));
		assert.deepStrictEqual(view.entries.map(entry => [entry.status, entry.historical, entry.issue, entry.binding?.slot]), [['dangling', true, false, 'brief']]);
		assert.deepStrictEqual(harness.index.getSealedArtifacts(folder), ['renders/final.md']);
		assert.strictEqual(harness.index.getUpstreamOnlyReason(harness.node('renders/final.md')), 'sealedArtifact');
		assert.strictEqual(harness.index.getUpstreamOnlyReason(harness.node('outputs/x.md')), 'reservedOutput');
	});

	test('updates on external frontmatter edits, deletions, and folder moves', async () => {
		const harness = await createHarness(disposables, {
			'a.md': '# A\n',
			'topic/b.md': '---\nupstream:\n  - a.md\n---\n',
			'.bh/mirror/topic/upstream.yaml': 'upstream:\n  - a.md\n'
		});
		const index = harness.index;
		const downstream = () => index.getDownstream(harness.node('a.md')).map(entry => entry.node.relativePath);
		assert.deepStrictEqual(downstream(), ['topic', 'topic/b.md']);

		await harness.write('c.md', '---\nupstream: [a.md]\n---\n');
		await until(() => downstream().includes('c.md'), 'external add was not indexed');
		await harness.write('c.md', '# no longer\n');
		await until(() => !downstream().includes('c.md'), 'external frontmatter edit was not indexed');

		await harness.fileService.move(joinPath(folder, 'topic'), joinPath(folder, 'moved'));
		await until(() => JSON.stringify(downstream()) === JSON.stringify(['moved/b.md']), `folder move was not indexed: ${downstream()}`);
		await harness.fileService.move(joinPath(folder, '.bh', 'mirror', 'topic'), joinPath(folder, '.bh', 'mirror', 'moved'));
		await until(() => JSON.stringify(downstream()) === JSON.stringify(['moved', 'moved/b.md']), `mirror move was not indexed: ${downstream()}`);

		await harness.fileService.del(joinPath(folder, 'moved'), { recursive: true });
		await until(() => !downstream().includes('moved/b.md') && !downstream().includes('moved'), 'deletion was not indexed');
	});

	test('never reads unsaved buffers', async () => {
		const harness = await createHarness(disposables, { 'a.md': '# A\n', 'b.md': '# B\n' });
		const reference = await harness.textModelService.createModelReference(harness.node('b.md').resource);
		try {
			reference.object.textEditorModel.setValue('---\nupstream:\n  - a.md\n---\n# B\n');
			assert.ok(harness.textFileService.isDirty(harness.node('b.md').resource));
			await harness.index.rebuild(folder);
			assert.deepStrictEqual(harness.index.getDownstream(harness.node('a.md')), []);
			assert.deepStrictEqual((await harness.index.readUpstream(harness.node('b.md'))).entries, []);
		} finally {
			await harness.textFileService.revert(harness.node('b.md').resource);
			reference.dispose();
		}
	});

	test('reports the partial state when file search hits its limit', async () => {
		const harness = await createHarness(disposables, { 'a.md': '# A\n' }, { searchLimitHit: true });
		assert.deepStrictEqual([harness.index.getState(folder), harness.index.getPartialReasons(folder)], ['partial', ['searchLimit']]);
	});

	test('reports the partial state when the store count reaches the limit', async function () {
		this.timeout(20_000);
		const harness = await createHarness(disposables, { 'a.md': '# A\n' }, { extraSearchResults: 50_000 });
		assert.deepStrictEqual([harness.index.getState(folder), harness.index.getPartialReasons(folder)], ['partial', ['storeLimit']]);
	});

	test('accepts saved content synchronously and ignores the identical watcher event', async () => {
		const harness = await createHarness(disposables, { 'a.md': '# A\n', 'b.md': '# B\n' });
		const events: string[] = [];
		disposables.add(harness.index.onDidChange(event => events.push(event.resources.map(resource => getRelativePath(folder, resource)).join(','))));
		const saved = '---\nupstream:\n  - a.md\n---\n# B\n';
		harness.index.acceptSavedContent(harness.node('b.md'), 'markdown', saved);
		assert.deepStrictEqual([events, harness.index.getDownstream(harness.node('a.md')).map(entry => entry.node.relativePath)], [['b.md'], ['b.md']]);
		await harness.write('b.md', saved);
		await timeout(50);
		assert.deepStrictEqual(events, ['b.md']);
	});
});

suite('BaseHalfReferenceEditService', () => {
	const disposables = new DisposableStore();
	teardown(() => disposables.clear());
	ensureNoDisposablesAreLeakedInTestSuite();

	test('connecting into Markdown writes only its frontmatter and the edge appears when the operation resolves', async () => {
		const harness = await createHarness(disposables, { 'a.md': '# A\n', 'b.md': '# B\n\nBody\n' });
		const before = await harness.list();
		const result = await harness.edit.add(harness.node('b.md'), 'a.md', options);
		assert.deepStrictEqual(result.stores.map(store => [store.outcome, store.expected.items, store.next.items, store.createdFrontmatter]), [
			['changed', [], [{ text: 'a.md', scalar: true }], true]
		]);
		assert.strictEqual(await harness.read('b.md'), '---\nupstream:\n  - a.md\n---\n# B\n\nBody\n');
		assert.deepStrictEqual(harness.index.getDownstream(harness.node('a.md')).map(entry => entry.node.relativePath), ['b.md']);
		assert.deepStrictEqual(await harness.list(), before);
		assert.strictEqual(harness.textFileService.isDirty(harness.node('b.md').resource), false);

		// The first-frontmatter notice is shown once per machine, in plain
		// words and with no way into the note's source.
		assert.deepStrictEqual(harness.notifications.prompts.map(prompt => [prompt.message, prompt.choices.map(choice => choice.label)]), [
			['Saved this connection inside b.md. Agents and other tools that read the note see it there.', ['OK']]
		]);
		assert.strictEqual(harness.storage.getBoolean(BASEHALF_REFERENCES_FIRST_FRONTMATTER_NOTICE_STORAGE_KEY, StorageScope.APPLICATION), true);
		await harness.edit.add(harness.node('a.md'), 'b.md', options);
		assert.strictEqual(harness.notifications.prompts.length, 1);

		// Adding again is idempotent.
		const again = await harness.edit.add(harness.node('b.md'), 'a.md', options);
		assert.deepStrictEqual(again.stores.map(store => store.outcome), ['unchanged']);
	});

	test('canvas undo after the model is disposed removes exactly that entry and redo restores it', async () => {
		const harness = await createHarness(disposables, { 'a.md': '# A\n', 'b.md': '---\ntitle: B\nupstream:\n  - c.md\n---\n# B\n', 'c.md': '' });
		const source = new UndoRedoSource();
		const canvas = joinPath(folder, '.bh', 'mirror', 'canvas.yaml');
		const result = await harness.edit.add(harness.node('b.md'), 'a.md', options);
		assert.ok(harness.edit.pushUndoElement(result, { label: 'Connect', resources: [canvas], source }));
		await disposeModel(harness, 'b.md');

		await harness.undoRedo.undo(source);
		assert.strictEqual(await harness.read('b.md'), '---\ntitle: B\nupstream:\n  - c.md\n---\n# B\n');
		assert.deepStrictEqual(harness.index.getDownstream(harness.node('a.md')), []);
		await disposeModel(harness, 'b.md');
		await harness.undoRedo.redo(source);
		assert.strictEqual(await harness.read('b.md'), '---\ntitle: B\nupstream:\n  - c.md\n  - a.md\n---\n# B\n');
		assert.deepStrictEqual(harness.notifications.messages, []);
	});

	test('canvas undo refuses after an external edit, changes nothing, and keeps the step', async () => {
		const harness = await createHarness(disposables, { 'a.md': '# A\n', 'b.md': '# B\n' });
		const source = new UndoRedoSource();
		const canvas = joinPath(folder, '.bh', 'mirror', 'canvas.yaml');
		const result = await harness.edit.add(harness.node('b.md'), 'a.md', options);
		harness.edit.pushUndoElement(result, { label: 'Connect', resources: [canvas], source });
		await disposeModel(harness, 'b.md');
		const external = '---\nupstream:\n  - a.md\n  - agent.md\n---\n# B\n';
		await harness.write('b.md', external);
		await until(async () => harness.index.getStore(harness.node('b.md'))?.read.items.length === 2, 'external edit was not indexed');

		await harness.undoRedo.undo(source);
		assert.strictEqual(await harness.read('b.md'), external);
		assert.deepStrictEqual(harness.notifications.messages, ['b.md changed since this edit.']);
		assert.strictEqual(harness.undoRedo.canUndo(source), true);

		// Once the file holds `expected` again, undo completes without writing.
		await disposeModel(harness, 'b.md');
		await harness.write('b.md', '# B\n');
		await harness.undoRedo.undo(source);
		assert.strictEqual(await harness.read('b.md'), '# B\n');
		assert.strictEqual(harness.undoRedo.canUndo(source), false);
	});

	test('refuses with unsaved text and auto-save off, and when a projection cannot flush', async () => {
		const harness = await createHarness(disposables, { 'a.md': '# A\n', 'b.md': '# B\n' }, { autoSave: 'off' });
		const reference = await harness.textModelService.createModelReference(harness.node('b.md').resource);
		try {
			reference.object.textEditorModel.setValue('# B typed\n');
			const unsaved = await refusal(harness.edit.add(harness.node('b.md'), 'a.md', options));
			assert.deepStrictEqual([unsaved.reason, unsaved.message], ['unsaved', 'Save or revert b.md first.']);
			assert.strictEqual(await harness.read('b.md'), '# B\n');
			await harness.textFileService.revert(harness.node('b.md').resource);
		} finally {
			reference.dispose();
		}

		const flusher = harness.flush.registerDocumentFlusher(baseHalfMarkdownRichDocumentKey(folder, 'b.md'), async () => false);
		try {
			const flush = await refusal(harness.edit.add(harness.node('b.md'), 'a.md', options));
			assert.deepStrictEqual([flush.reason, flush.message], ['flushFailed', 'Finish or resolve the unsaved edit in b.md first.']);
		} finally {
			flusher.dispose();
		}
		assert.strictEqual(await harness.read('b.md'), '# B\n');
	});

	test('refuses a foreign upstream value and a list BaseHalf reads but cannot edit', async () => {
		const harness = await createHarness(disposables, { 'a.md': '# A\n', 'feed.md': '---\nupstream: https://example.com/feed\n---\n', 'flow.md': '---\n{title: T, upstream: [a.md]}\n---\n' });
		const foreign = await refusal(harness.edit.add(harness.node('feed.md'), 'a.md', options));
		assert.deepStrictEqual([foreign.reason, foreign.blocking.map(store => store.storeResource.path)], ['foreign', ['/work/feed.md']]);
		assert.strictEqual((await refusal(harness.edit.add(harness.node('flow.md'), 'feed.md', options))).reason, 'notWritable');
	});

	test('connecting into a note that cannot hold a list keeps the list for it and never changes the note', async () => {
		const notes = {
			'quote.md': '---\nA quote.\n---\nBody\n',
			'toml.md': '+++\ntitle = "T"\n+++\n# T\n',
			'huge.md': `---\ntitle: ${'x'.repeat(70_000)}\n---\n# H\n`
		};
		const harness = await createHarness(disposables, { 'a.md': '# A\n', 'c.md': '# C\n', ...notes });
		const source = new UndoRedoSource();
		const canvas = joinPath(folder, '.bh', 'mirror', 'canvas.yaml');
		const paths = Object.keys(notes);
		const kept = () => Promise.all(paths.map(path => harness.read(`.bh/mirror/${path}/upstream.yaml`)));
		for (const path of paths) {
			const result = await harness.edit.add(harness.node(path), 'a.md', options);
			assert.deepStrictEqual(result.stores.map(store => [store.storeKind, store.outcome, !!store.createdFrontmatter]), [['sidecar', 'changed', false]], path);
		}
		harness.edit.pushUndoElement(await harness.edit.add(harness.node('quote.md'), 'c.md', options), { label: 'Connect', resources: [canvas], source });
		assert.deepStrictEqual({
			kept: await kept(),
			notes: await Promise.all(paths.map(path => harness.read(path))),
			downstreamOfA: harness.index.getDownstream(harness.node('a.md')).map(entry => entry.node.relativePath),
			view: await harness.index.resolveUpstream(harness.node('quote.md')).then(view => [view.storeKind, view.writable, view.entries.map(entry => entry.text), view.issueCount]),
			// No notice about a block added to the note: the note was not touched.
			prompts: harness.notifications.prompts.length
		}, {
			kept: ['upstream:\n  - a.md\n  - c.md\n', 'upstream:\n  - a.md\n', 'upstream:\n  - a.md\n'],
			notes: Object.values(notes),
			downstreamOfA: ['huge.md', 'quote.md', 'toml.md'],
			view: ['sidecar', true, ['a.md', 'c.md'], 0],
			prompts: 0
		});

		// Undo, redo, and a disconnect change only the kept list.
		await harness.undoRedo.undo(source);
		const undone = (await kept())[0];
		await harness.undoRedo.redo(source);
		await harness.edit.remove(harness.node('toml.md'), 'a.md', options);
		assert.deepStrictEqual({ undone, kept: await kept(), notes: await Promise.all(paths.map(path => harness.read(path))) }, {
			undone: 'upstream:\n  - a.md\n',
			kept: ['upstream:\n  - a.md\n  - c.md\n', undefined, 'upstream:\n  - a.md\n'],
			notes: Object.values(notes)
		});
	});

	test('a kept list stays in use when the note can hold it again, and Move into File moves it in', async () => {
		const harness = await createHarness(disposables, { 'a.md': '# A\n', 'c.md': '# C\n', 'quote.md': '---\nA quote.\n---\nBody\n' });
		await harness.edit.add(harness.node('quote.md'), 'a.md', options);
		// The user removes the rule at the top: the note could now hold a list.
		await harness.write('quote.md', 'Body\n');
		await until(async () => !!(await harness.index.resolveUpstream(harness.node('quote.md'))).misplacedSidecar, 'the kept list to be offered for the note');
		await harness.edit.add(harness.node('quote.md'), 'c.md', options);
		const before = {
			note: await harness.read('quote.md'),
			kept: await harness.read('.bh/mirror/quote.md/upstream.yaml'),
			downstreamOfA: harness.index.getDownstream(harness.node('a.md')).map(entry => entry.node.relativePath)
		};
		await harness.edit.moveIntoFile(harness.node('quote.md'), options);
		assert.deepStrictEqual({
			before,
			note: await harness.read('quote.md'),
			kept: await harness.read('.bh/mirror/quote.md/upstream.yaml'),
			downstreamOfA: harness.index.getDownstream(harness.node('a.md')).map(entry => `${entry.node.relativePath}:${entry.storeKind}`)
		}, {
			before: { note: 'Body\n', kept: 'upstream:\n  - a.md\n  - c.md\n', downstreamOfA: ['quote.md'] },
			note: '---\nupstream:\n  - a.md\n  - c.md\n---\nBody\n',
			kept: undefined,
			downstreamOfA: ['quote.md:markdown']
		});
	});

	test('entries inside a block BaseHalf does not recognize are carried into the kept list', async () => {
		// Frontmatter BaseHalf wrote, made invalid elsewhere by another tool.
		const broken = '---\ntitle: Plan: draft\nupstream:\n  - a.md\n  - c.md\ntags: [x\n---\n# N\n';
		const harness = await createHarness(disposables, { 'a.md': '# A\n', 'c.md': '# C\n', 'd.md': '# D\n', 'connect.md': broken, 'rebuild.md': broken });
		const issue = async (path: string) => harness.index.resolveUpstream(harness.node(path)).then(view => [view.storeIssue, view.problem ?? null, view.entries.map(entry => entry.text)]);
		const before = [await issue('connect.md'), await issue('rebuild.md')];
		// A connect never leaves them behind, and Rebuild List carries them over.
		await harness.edit.add(harness.node('connect.md'), 'd.md', options);
		const rebuilt = await harness.edit.rebuild(harness.node('rebuild.md'), options);
		const again = await harness.edit.rebuild(harness.node('rebuild.md'), options);
		assert.deepStrictEqual({
			before,
			outcomes: [rebuilt.stores.map(store => store.outcome), again.stores.map(store => store.outcome)],
			kept: [await harness.read('.bh/mirror/connect.md/upstream.yaml'), await harness.read('.bh/mirror/rebuild.md/upstream.yaml')],
			notes: [await harness.read('connect.md'), await harness.read('rebuild.md')],
			after: [await issue('connect.md'), await issue('rebuild.md')],
			downstreamOfA: harness.index.getDownstream(harness.node('a.md')).map(entry => entry.node.relativePath)
		}, {
			before: [[true, 'frontmatterRejected', []], [true, 'frontmatterRejected', []]],
			outcomes: [['changed'], ['unchanged']],
			kept: ['upstream:\n  - a.md\n  - c.md\n  - d.md\n', 'upstream:\n  - a.md\n  - c.md\n'],
			notes: [broken, broken],
			after: [[false, null, ['a.md', 'c.md', 'd.md']], [false, null, ['a.md', 'c.md']]],
			downstreamOfA: ['connect.md', 'rebuild.md']
		});
	});

	test('connecting into a Draft node writes upstream and its binding in one write', async () => {
		const harness = await createHarness(disposables, {
			'brief.md': '# Brief\n',
			'clip.bhnode': nodeDocument(3, { version: 3 }),
			'loose.md': ''
		});
		await harness.edit.add(harness.node('clip.bhnode'), 'brief.md', options, { slot: 'brief' });
		const written = parseBaseHalfNodeDocument((await harness.read('clip.bhnode'))!);
		assert.deepStrictEqual([JSON.parse((await harness.read('clip.bhnode'))!).version, written.upstream, written.recipe?.inputBindings], [
			4,
			['brief.md'],
			[{ sourcePath: 'brief.md', slot: 'brief', order: 0 }]
		]);
		assert.deepStrictEqual(harness.index.getDownstream(harness.node('brief.md')).map(entry => entry.node.relativePath), ['clip.bhnode']);
	});

	test('canvas undo and redo of a node connect restore upstream and binding together', async () => {
		const harness = await createHarness(disposables, { 'brief.md': '# Brief\n', 'clip.bhnode': nodeDocument(6) });
		const source = new UndoRedoSource();
		const result = await harness.edit.add(harness.node('clip.bhnode'), 'brief.md', options, { slot: 'brief' });
		harness.edit.pushUndoElement(result, { label: 'Connect', resources: [joinPath(folder, '.bh', 'mirror', 'canvas.yaml')], source });
		const state = async () => {
			const document = parseBaseHalfNodeDocument((await harness.read('clip.bhnode'))!);
			return [document.upstream, document.recipe?.inputBindings.map(binding => binding.slot)];
		};
		await harness.undoRedo.undo(source);
		assert.deepStrictEqual(await state(), [[], []]);
		await harness.undoRedo.redo(source);
		assert.deepStrictEqual(await state(), [['brief.md'], ['brief']]);
	});

	test('refuses node writes under a run lease and bound disconnects outside a Draft', async () => {
		const running = createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(4),
			kind: 'video',
			title: 'Clip',
			role: 'Generated result',
			upstream: ['brief.md', 'loose.md'],
			recipe: { recipeId: 'r', parameters: {}, inputBindings: [{ sourcePath: 'brief.md', slot: 'brief', order: 0 }] },
			attempts: [{
				id: 'attempt-1', status: 'failed', createdAt: '2026-08-13T08:00:00.000Z', startedAt: '2026-08-13T08:00:01.000Z', completedAt: '2026-08-13T08:00:02.000Z',
				prompt: '', recipe: { recipeId: 'r', parameters: {}, inputBindings: [{ sourcePath: 'brief.md', slot: 'brief', order: 0 }] },
				model: { source: 'local' }, inputs: [], error: 'offline'
			}]
		});
		const harness = await createHarness(disposables, { 'brief.md': '', 'loose.md': '', 'clip.bhnode': serializeBaseHalfNodeDocument(running) });
		const bound = await refusal(harness.edit.remove(harness.node('clip.bhnode'), 'brief.md', options));
		assert.strictEqual(bound.reason, 'boundOutsideDraft');
		await harness.edit.remove(harness.node('clip.bhnode'), 'loose.md', options);
		assert.deepStrictEqual(parseBaseHalfNodeDocument((await harness.read('clip.bhnode'))!).upstream, ['brief.md']);

		assert.strictEqual((await refusal(harness.edit.add(harness.node('clip.bhnode'), 'loose.md', options))).reason, 'recipeFrozen');

		const lease = await new BaseHalfNodeRunLeaseStore(harness.fileService, 30_000).acquire(folder, running.id, 'clip.bhnode', 'owner', 'run', undefined);
		assert.strictEqual(lease.kind, 'acquired');
		const busy = await refusal(harness.edit.remove(harness.node('clip.bhnode'), 'brief.md', options));
		assert.deepStrictEqual([busy.reason, busy.message], ['running', 'This node is running.']);
	});

	test('connecting into a folder or PDF writes its sidecar; outputs and sealed artifacts are refused', async () => {
		const sealed = JSON.parse(nodeDocument(5));
		sealed.recipe = undefined;
		delete sealed.recipe;
		sealed.result = { source: 'imported', artifact: { id: 'a', outputId: 'o', kind: 'video', path: 'final.md', sha256: 'A'.repeat(43), size: 1 } };
		const harness = await createHarness(disposables, {
			'note.md': '# N\n',
			'docs/x.txt': '',
			'book.pdf': '%PDF',
			'outputs/run/copy.md': '# copy\n',
			'final.md': '# final\n',
			'result.bhnode': JSON.stringify(sealed)
		});
		await harness.edit.add(harness.node('docs'), 'note.md', options);
		await harness.edit.add(harness.node('book.pdf'), 'note.md', options);
		assert.deepStrictEqual([await harness.read('.bh/mirror/docs/upstream.yaml'), await harness.read('.bh/mirror/book.pdf/upstream.yaml')], ['upstream:\n  - note.md\n', 'upstream:\n  - note.md\n']);
		assert.deepStrictEqual(harness.index.getDownstream(harness.node('note.md')).map(entry => entry.node.relativePath), ['book.pdf', 'docs']);

		assert.strictEqual((await refusal(harness.edit.add(harness.node('outputs/run/copy.md'), 'note.md', options))).reason, 'upstreamOnly');
		assert.strictEqual((await refusal(harness.edit.add(harness.node('final.md'), 'note.md', options))).reason, 'upstreamOnly');
		assert.strictEqual((await refusal(harness.edit.add(harness.node('docs'), '.bh/x', options))).reason, 'invalidEntry');

		await harness.edit.remove(harness.node('docs'), 'note.md', options);
		assert.strictEqual(await harness.read('.bh/mirror/docs/upstream.yaml'), undefined);
	});

	test('in a marked folder, Markdown connects leave .bh absent and sidecar targets are refused', async () => {
		const harness = await createHarness(disposables, { '.basehalf-no-workspace-setup': '', 'a.md': '# A\n', 'b.md': '# B\n', 'docs/x.txt': '', 'quote.md': '---\nA quote.\n---\n' });
		await harness.edit.add(harness.node('b.md'), 'a.md', options);
		assert.strictEqual((await refusal(harness.edit.add(harness.node('docs'), 'a.md', options))).reason, 'markedFolder');
		// A note that cannot hold a list would need one kept under .bh/.
		assert.strictEqual((await refusal(harness.edit.add(harness.node('quote.md'), 'a.md', options))).reason, 'markedFolder');
		assert.ok((await harness.list()).every(path => !path.startsWith('.bh/')));
	});

	test('Move into File moves sidecar entries into a Markdown file', async () => {
		const harness = await createHarness(disposables, {
			'a.md': '# A\n',
			'c.md': '# C\n',
			'note.md': '---\ntitle: Note\nupstream:\n  - a.md\n---\n',
			'.bh/mirror/note.md/upstream.yaml': 'upstream:\n  - a.md\n  - c.md\n'
		});
		const result = await harness.edit.moveIntoFile(harness.node('note.md'), options);
		assert.deepStrictEqual(result.stores.map(store => [store.storeKind, store.outcome]), [['markdown', 'changed'], ['sidecar', 'changed']]);
		assert.strictEqual(await harness.read('note.md'), '---\ntitle: Note\nupstream:\n  - a.md\n  - c.md\n---\n');
		assert.strictEqual(await harness.read('.bh/mirror/note.md/upstream.yaml'), undefined);
	});

	test('Rebuild List makes an unusable list usable again and keeps a replaced sidecar as a recovery copy', async () => {
		const conflicted = 'upstream:\n  - a.md\nupstream:\n  - c.md\n';
		const garbage = '<<<<<<< HEAD\nupstream:\n  - a.md\n';
		const harness = await createHarness(disposables, {
			'a.md': '# A\n',
			'c.md': '# C\n',
			'feed.md': '---\ntitle: Feed\nupstream: https://example.com/feed\n---\n# Feed\n',
			'merged.md': '---\nupstream:\n  - a.md\ntitle: Merged\nupstream:\n  - a.md\n  - c.md\n---\n# Merged\n',
			'toml.md': '+++\nupstream = ["a.md"]\n+++\n# Toml\n',
			'docs/x.txt': '',
			'book.pdf': '%PDF',
			'.bh/mirror/docs/upstream.yaml': conflicted,
			'.bh/mirror/book.pdf/upstream.yaml': garbage,
			'clip.bhnode': '{ not json'
		});
		const storeIssues = async () => (await harness.index.getIssues(folder)).filter(issue => issue.kind === 'store').map(issue => issue.node.relativePath);
		// A note with TOML frontmatter keeps its list with BaseHalf: it carries no issue.
		assert.deepStrictEqual(await storeIssues(), ['book.pdf', 'clip.bhnode', 'docs', 'feed.md', 'merged.md']);

		for (const path of ['feed.md', 'merged.md', 'docs', 'book.pdf']) {
			await harness.edit.rebuild(harness.node(path), options);
		}
		assert.deepStrictEqual({
			feed: await harness.read('feed.md'),
			merged: await harness.read('merged.md'),
			docs: await harness.read('.bh/mirror/docs/upstream.yaml'),
			book: await harness.read('.bh/mirror/book.pdf/upstream.yaml')
		}, {
			feed: '---\ntitle: Feed\n---\n# Feed\n',
			merged: '---\nupstream:\n  - a.md\n  - c.md\ntitle: Merged\n---\n# Merged\n',
			docs: 'upstream:\n  - a.md\n  - c.md\n',
			book: undefined
		});
		// Each replaced sidecar is kept byte for byte. For a note, the text up
		// to the last line the rebuild changed is kept, which holds what it removed.
		const recovered = (await harness.list()).filter(path => path.startsWith('.bh/cache/recovered/'));
		assert.deepStrictEqual(recovered.map(path => path.replace(/\.[0-9a-f]{12}\.(yaml|md)$/, '.<digest>.$1')), [
			'.bh/cache/recovered/mirror/book.pdf/upstream.<digest>.yaml',
			'.bh/cache/recovered/mirror/docs/upstream.<digest>.yaml',
			'.bh/cache/recovered/mirror/feed.md/frontmatter.<digest>.md',
			'.bh/cache/recovered/mirror/merged.md/frontmatter.<digest>.md'
		]);
		assert.deepStrictEqual(await Promise.all(recovered.map(path => harness.read(path))), [
			garbage,
			conflicted,
			'---\ntitle: Feed\nupstream: https://example.com/feed\n',
			'---\nupstream:\n  - a.md\ntitle: Merged\nupstream:\n  - a.md\n  - c.md\n'
		]);
		assert.deepStrictEqual(harness.index.getDownstream(harness.node('c.md')).map(entry => entry.node.relativePath), ['docs', 'merged.md']);

		// A node that cannot be read is refused and left as it was. A note
		// that cannot hold a list has nothing to rebuild and is never changed.
		assert.strictEqual((await refusal(harness.edit.rebuild(harness.node('clip.bhnode'), options))).reason, 'unreadable');
		assert.deepStrictEqual((await harness.edit.rebuild(harness.node('toml.md'), options)).stores.map(store => [store.storeKind, store.outcome]), [['sidecar', 'unchanged']]);
		assert.deepStrictEqual([await harness.read('toml.md'), await harness.read('clip.bhnode')], ['+++\nupstream = ["a.md"]\n+++\n# Toml\n', '{ not json']);
		assert.deepStrictEqual(await storeIssues(), ['clip.bhnode']);

		// A readable list has nothing to rebuild.
		const again = await harness.edit.rebuild(harness.node('merged.md'), options);
		assert.deepStrictEqual(again.stores.map(store => store.outcome), ['unchanged']);
	});

	test('Rebuild List leaves the sidecar unchanged when its recovery copy cannot be saved', async () => {
		const garbage = '<<<<<<< HEAD\nupstream:\n  - a.md\n';
		const harness = await createHarness(disposables, { 'a.md': '# A\n', 'book.pdf': '%PDF', '.bh/mirror/book.pdf/upstream.yaml': garbage, '.bh/cache/recovered': '' });
		await assert.rejects(harness.edit.rebuild(harness.node('book.pdf'), options));
		assert.strictEqual(await harness.read('.bh/mirror/book.pdf/upstream.yaml'), garbage);
	});

	test('a target-end reconnect adds to the new downstream before removing from the old one', async () => {
		const harness = await createHarness(disposables, { 'a.md': '', 'b.md': '---\nupstream:\n  - a.md\n---\n', 'c.md': '# C\n' });
		const result = await harness.edit.move('a.md', harness.node('b.md'), harness.node('c.md'), options);
		assert.deepStrictEqual(result.stores.map(store => [store.node.relativePath, store.outcome]), [['c.md', 'changed'], ['b.md', 'changed']]);
		assert.deepStrictEqual([await harness.read('b.md'), await harness.read('c.md')], ['', '---\nupstream:\n  - a.md\n---\n# C\n']);
		assert.deepStrictEqual(harness.index.getDownstream(harness.node('a.md')).map(entry => entry.node.relativePath), ['c.md']);
	});

	test('re-plans once when the file changed on disk before the save', async () => {
		const harness = await createHarness(disposables, { 'a.md': '', 'b.md': '---\ntitle: B\n---\n# B\n' });
		harness.afterNextBulkEdit(async () => {
			await timeout(5);
			await harness.provider.writeFile(harness.node('b.md').resource, VSBuffer.fromString('---\ntitle: B2\n---\n# B by agent\n').buffer, { create: false, overwrite: true, unlock: false, atomic: false });
		});
		await harness.edit.add(harness.node('b.md'), 'a.md', options);
		assert.strictEqual(await harness.read('b.md'), '---\ntitle: B2\nupstream:\n  - a.md\n---\n# B by agent\n');
		assert.deepStrictEqual(harness.notifications.prompts.map(prompt => prompt.message), []);
	});

	test('shows Retry and Revert Change, and no way into the file, when the save fails', async () => {
		const harness = await createHarness(disposables, { 'a.md': '', 'b.md': '# B\n' });
		harness.provider.failingWrites.add('/work/b.md');
		await assert.rejects(harness.edit.add(harness.node('b.md'), 'a.md', options), /not saved/);
		const prompt = harness.notifications.prompts.find(candidate => candidate.message === 'The upstream change to b.md is not saved.');
		assert.deepStrictEqual(prompt?.choices.map(choice => choice.label), ['Retry', 'Revert Change']);
		const model = harness.textFileService.files.get(harness.node('b.md').resource)!;
		assert.strictEqual(model.textEditorModel?.getValue(), '---\nupstream:\n  - a.md\n---\n# B\n');
		// Only BaseHalf's change was unsaved: Revert Change goes back to the text on disk.
		await prompt!.choices[1].run();
		assert.strictEqual(harness.textFileService.isDirty(harness.node('b.md').resource), false);
		assert.strictEqual(await harness.read('b.md'), '# B\n');
		assert.deepStrictEqual(harness.index.getDownstream(harness.node('a.md')), []);
		harness.textFileService.files.get(harness.node('b.md').resource)?.dispose();
	});

	test('the preflight writes nothing when any store is refused', async () => {
		const harness = await createHarness(disposables, { 'a.md': '', 'b.md': '# B\n', 'feed.md': '---\nupstream: https://example.com/feed\n---\n' });
		const refused = await refusal(harness.edit.apply([
			{ node: harness.node('b.md'), operation: { kind: 'add', entry: 'a.md' } },
			{ node: harness.node('feed.md'), operation: { kind: 'add', entry: 'a.md' } }
		], options));
		assert.deepStrictEqual(refused.blocking.map(store => store.node.relativePath), ['feed.md']);
		assert.strictEqual(await harness.read('b.md'), '# B\n');
	});

	test('canvas undo and redo of Move into File restore the file and its sidecar together', async () => {
		const note = '---\ntitle: Note\nupstream:\n  - a.md\n---\n';
		const harness = await createHarness(disposables, {
			'a.md': '# A\n',
			'c.md': '# C\n',
			'note.md': note,
			'.bh/mirror/note.md/upstream.yaml': 'upstream:\n  - a.md\n  - c.md\n'
		});
		const source = new UndoRedoSource();
		const canvas = joinPath(folder, '.bh', 'mirror', 'canvas.yaml');
		const state = async () => [await harness.read('note.md'), await harness.read('.bh/mirror/note.md/upstream.yaml')];
		harness.edit.pushUndoElement(await harness.edit.moveIntoFile(harness.node('note.md'), options), { label: 'Move into File', resources: [canvas], source });
		const moved = ['---\ntitle: Note\nupstream:\n  - a.md\n  - c.md\n---\n', undefined];
		assert.deepStrictEqual(await state(), moved);
		await disposeModel(harness, 'note.md');

		await harness.undoRedo.undo(source);
		assert.deepStrictEqual(await state(), [note, 'upstream:\n  - a.md\n  - c.md\n']);
		await disposeModel(harness, 'note.md');
		await harness.undoRedo.redo(source);
		assert.deepStrictEqual([await state(), harness.notifications.messages], [moved, []]);
	});

	test('canvas undo and redo of Move into File when only the sidecar changed', async () => {
		const full = '---\nupstream:\n  - a.md\n---\n# Full\n';
		const harness = await createHarness(disposables, {
			'a.md': '# A\n',
			'full.md': full,
			'.bh/mirror/full.md/upstream.yaml': 'upstream:\n  - a.md\n'
		});
		const source = new UndoRedoSource();
		const result = await harness.edit.moveIntoFile(harness.node('full.md'), options);
		assert.deepStrictEqual(result.stores.map(store => [store.storeKind, store.outcome]), [['markdown', 'unchanged'], ['sidecar', 'changed']]);
		harness.edit.pushUndoElement(result, { label: 'Move into File', resources: [joinPath(folder, '.bh', 'mirror', 'canvas.yaml')], source });
		const state = async () => [await harness.read('full.md'), await harness.read('.bh/mirror/full.md/upstream.yaml')];

		await harness.undoRedo.undo(source);
		assert.deepStrictEqual(await state(), [full, 'upstream:\n  - a.md\n']);
		await harness.undoRedo.redo(source);
		assert.deepStrictEqual([await state(), harness.notifications.messages], [[full, undefined], []]);
	});

	test('Move into File moves every entry it can read, keeps the rest as a recovery copy, and refuses a sidecar that changed', async () => {
		const withInvalid = 'upstream:\n  - /abs.md\n  - a.md\n';
		const twice = 'upstream:\n  - a.md\nupstream:\n  - c.md\n';
		const garbage = '<<<<<<< HEAD\nupstream:\n  - a.md\n';
		const harness = await createHarness(disposables, {
			'a.md': '',
			'c.md': '',
			'note.md': '# N\n',
			'.bh/mirror/note.md/upstream.yaml': 'upstream:\n  - a.md\n  - a.md\n',
			'bad.md': '# B\n',
			'.bh/mirror/bad.md/upstream.yaml': withInvalid,
			'twice.md': '# T\n',
			'.bh/mirror/twice.md/upstream.yaml': twice,
			'garbage.md': '# G\n',
			'.bh/mirror/garbage.md/upstream.yaml': garbage,
			'raced.md': '# R\n',
			'.bh/mirror/raced.md/upstream.yaml': 'upstream:\n  - a.md\n'
		});
		await harness.edit.moveIntoFile(harness.node('note.md'), options);
		assert.deepStrictEqual([await harness.read('note.md'), await harness.read('.bh/mirror/note.md/upstream.yaml'), harness.notifications.messages], ['---\nupstream:\n  - a.md\n---\n# N\n', undefined, []]);

		// An invalid entry, and content that can't be read, have nowhere to go:
		// the move never refuses them, and the sidecar is kept byte for byte.
		const source = new UndoRedoSource();
		const canvas = joinPath(folder, '.bh', 'mirror', 'canvas.yaml');
		await harness.edit.moveIntoFile(harness.node('bad.md'), options);
		harness.edit.pushUndoElement(await harness.edit.moveIntoFile(harness.node('twice.md'), options), { label: 'Move into File', resources: [canvas], source });
		await harness.edit.moveIntoFile(harness.node('garbage.md'), options);
		const recovered = (await harness.list()).filter(path => path.startsWith('.bh/cache/recovered/'));
		assert.deepStrictEqual({
			bad: [await harness.read('bad.md'), await harness.read('.bh/mirror/bad.md/upstream.yaml')],
			twice: [await harness.read('twice.md'), await harness.read('.bh/mirror/twice.md/upstream.yaml')],
			garbage: [await harness.read('garbage.md'), await harness.read('.bh/mirror/garbage.md/upstream.yaml')],
			recovered: recovered.map(path => path.replace(/\.[0-9a-f]{12}\.yaml$/, '.<digest>.yaml')),
			recoveredBytes: await Promise.all(recovered.map(path => harness.read(path))),
			messages: harness.notifications.messages
		}, {
			bad: ['---\nupstream:\n  - a.md\n---\n# B\n', undefined],
			twice: ['---\nupstream:\n  - a.md\n  - c.md\n---\n# T\n', undefined],
			garbage: ['# G\n', undefined],
			recovered: [
				'.bh/cache/recovered/mirror/bad.md/upstream.<digest>.yaml',
				'.bh/cache/recovered/mirror/garbage.md/upstream.<digest>.yaml',
				'.bh/cache/recovered/mirror/twice.md/upstream.<digest>.yaml'
			],
			recoveredBytes: [withInvalid, garbage, twice],
			messages: ['bad.md', 'twice.md', 'garbage.md'].map(name => `BaseHalf moved the upstream entries it could read into ${name}. The rest could not be used and was removed.`)
		});

		// Undo puts the moved entries back where BaseHalf can read them.
		await disposeModel(harness, 'twice.md');
		await harness.undoRedo.undo(source);
		assert.deepStrictEqual([await harness.read('twice.md'), await harness.read('.bh/mirror/twice.md/upstream.yaml')], ['# T\n', 'upstream:\n  - a.md\n  - c.md\n']);

		// An agent adds an entry after the entries were read: nothing is written or removed.
		const raced = 'upstream:\n  - a.md\n  - c.md\n';
		const flusher = harness.flush.registerDocumentFlusher(harness.node('raced.md').resource.toString(), async () => {
			await harness.write('.bh/mirror/raced.md/upstream.yaml', raced);
			return true;
		});
		try {
			const changed = await refusal(harness.edit.moveIntoFile(harness.node('raced.md'), options));
			// The message names the note, never the file BaseHalf keeps for it.
			assert.deepStrictEqual([changed.reason, changed.message, await harness.read('raced.md'), await harness.read('.bh/mirror/raced.md/upstream.yaml')], ['changedSinceEdit', 'The upstream list of raced.md changed since this edit.', '# R\n', raced]);
		} finally {
			flusher.dispose();
		}
	});

	test('never changes a sealed Result artifact, removals included', async () => {
		const sealed = JSON.parse(nodeDocument(8));
		delete sealed.recipe;
		sealed.result = { source: 'imported', artifact: { id: 'a', outputId: 'o', kind: 'video', path: 'final.md', sha256: 'A'.repeat(43), size: 1 } };
		const artifact = '---\nupstream:\n  - note.md\n---\n# final\n';
		const harness = await createHarness(disposables, {
			'note.md': '# N\n',
			'other.md': '# O\n',
			'final.md': artifact,
			'result.bhnode': JSON.stringify(sealed)
		});
		// Its entries are still read, so the edge into it is drawn.
		assert.deepStrictEqual(harness.index.getDownstream(harness.node('note.md')).map(entry => entry.node.relativePath), ['final.md']);
		const reasons = [
			(await refusal(harness.edit.remove(harness.node('final.md'), 'note.md', options))).reason,
			(await refusal(harness.edit.apply([{ node: harness.node('final.md'), operation: { kind: 'removeAt', index: 0, expected: 'note.md' } }], options))).reason,
			(await refusal(harness.edit.move('note.md', harness.node('final.md'), harness.node('other.md'), options))).reason
		];
		assert.deepStrictEqual([reasons, await harness.read('final.md'), await harness.read('other.md')], [['upstreamOnly', 'upstreamOnly', 'upstreamOnly'], artifact, '# O\n']);
	});

	test('a target-end reconnect whose add is not saved never removes the old entry', async () => {
		const old = '---\nupstream:\n  - a.md\n---\n';
		const harness = await createHarness(disposables, { 'a.md': '', 'b.md': old, 'c.md': '# C\n' });
		harness.provider.failingWrites.add('/work/c.md');
		let failure: unknown;
		try {
			await harness.edit.move('a.md', harness.node('b.md'), harness.node('c.md'), options);
		} catch (error) {
			failure = error;
		}
		assert.ok(failure instanceof BaseHalfReferenceEditFailure);
		assert.deepStrictEqual({
			outcomes: failure.result.stores.map(store => [store.node.relativePath, store.outcome]),
			b: await harness.read('b.md'),
			bDirty: harness.textFileService.isDirty(harness.node('b.md').resource),
			c: await harness.read('c.md'),
			downstream: harness.index.getDownstream(harness.node('a.md')).map(entry => entry.node.relativePath)
		}, {
			outcomes: [['c.md', 'failed'], ['b.md', 'notAttempted']],
			b: old,
			bDirty: false,
			c: '# C\n',
			downstream: ['b.md']
		});
		await harness.textFileService.revert(harness.node('c.md').resource);
		harness.textFileService.files.get(harness.node('c.md').resource)?.dispose();
	});

	test('never writes a note through a symbolic link', async () => {
		const harness = await createHarness(disposables, { 'a.md': '', 'linked/b.md': '# B\n' });
		harness.provider.symbolicLinks.add('/work/linked');
		const refused = await refusal(harness.edit.add(harness.node('linked/b.md'), 'a.md', options));
		assert.deepStrictEqual([refused.reason, await harness.read('linked/b.md')], ['symbolicLink', '# B\n']);
	});

	test('a Composer save writes the whole node document once, and canvas undo restores it', async () => {
		const harness = await createHarness(disposables, { 'brief.md': '# Brief\n', 'clip.bhnode': nodeDocument(9) });
		const source = new UndoRedoSource();
		const before = (await harness.read('clip.bhnode'))!;
		const document = parseBaseHalfNodeDocument(before);
		const next = {
			...document,
			prompt: 'Use the brief',
			upstream: ['brief.md'],
			recipe: { ...document.recipe!, inputBindings: [{ sourcePath: 'brief.md', slot: 'brief', order: 0 }] }
		};
		const save = (expected: string, nextDocument: IBaseHalfNodeDocument) => harness.edit.apply([{
			node: harness.node('clip.bhnode'),
			operation: { kind: 'nodeDocument', expected: VSBuffer.fromString(expected), next: nextDocument }
		}], options);
		harness.edit.pushUndoElement(await save(before, next), { label: 'Change video input', resources: [joinPath(folder, '.bh', 'mirror', 'canvas.yaml')], source });
		const after = (await harness.read('clip.bhnode'))!;
		assert.deepStrictEqual([parseBaseHalfNodeDocument(after).prompt, harness.index.getDownstream(harness.node('brief.md')).map(entry => entry.node.relativePath)], ['Use the brief', ['clip.bhnode']]);

		// A save planned from older bytes is refused and writes nothing.
		assert.deepStrictEqual([(await refusal(save(before, { ...next, prompt: 'stale' }))).reason, await harness.read('clip.bhnode')], ['changedSinceEdit', after]);

		await harness.undoRedo.undo(source);
		assert.strictEqual(await harness.read('clip.bhnode'), before);
		await harness.undoRedo.redo(source);
		assert.strictEqual(await harness.read('clip.bhnode'), after);

		// Undo compares the whole document: a later prompt edit makes it refuse.
		const edited = serializeBaseHalfNodeDocument({ ...parseBaseHalfNodeDocument(after), prompt: 'Edited elsewhere' });
		await harness.write('clip.bhnode', edited);
		await harness.undoRedo.undo(source);
		assert.deepStrictEqual([await harness.read('clip.bhnode'), harness.notifications.messages], [edited, ['clip.bhnode changed since this edit.']]);

		// Under a run lease the save is refused.
		await new BaseHalfNodeRunLeaseStore(harness.fileService, 30_000).acquire(folder, document.id, 'clip.bhnode', 'owner', 'run', undefined);
		assert.strictEqual((await refusal(save(edited, { ...parseBaseHalfNodeDocument(edited), prompt: 'while running' }))).reason, 'running');
	});

	test('a node document step joins its node\'s undo stack, so an older undone card step never takes its redo', async () => {
		const harness = await createHarness(disposables, { 'brief.md': '# Brief\n', 'clip.bhnode': nodeDocument(9) });
		const source = new UndoRedoSource();
		const canvas = joinPath(folder, '.bh', 'mirror', 'canvas.yaml');
		const clip = harness.node('clip.bhnode');
		// A canvas geometry step joins canvas.yaml and the moved card's stack.
		const geometryRuns: string[] = [];
		harness.undoRedo.pushElement({
			type: UndoRedoElementType.Workspace,
			resources: [canvas, clip.resource],
			label: 'Move or resize canvas cards',
			code: 'test.geometry',
			undo: () => { geometryRuns.push('undo'); },
			redo: () => { geometryRuns.push('redo'); }
		}, undefined, source);
		await harness.undoRedo.undo(source);

		const before = (await harness.read('clip.bhnode'))!;
		const document = parseBaseHalfNodeDocument(before);
		const result = await harness.edit.apply([{
			node: clip,
			operation: {
				kind: 'nodeDocument',
				expected: VSBuffer.fromString(before),
				next: { ...document, upstream: ['brief.md'], recipe: { ...document.recipe!, inputBindings: [{ sourcePath: 'brief.md', slot: 'brief', order: 0 }] } }
			}
		}], options);
		const element = harness.edit.pushUndoElement(result, { label: 'Change video input', resources: [canvas], source });
		const after = (await harness.read('clip.bhnode'))!;
		await harness.undoRedo.undo(source);
		const undone = await harness.read('clip.bhnode');
		await harness.undoRedo.redo(source);

		assert.deepStrictEqual({
			resources: element?.resources.map(resource => getRelativePath(folder, resource)),
			undone: undone === before,
			redone: (await harness.read('clip.bhnode')) === after,
			geometryRuns,
			notifications: harness.notifications.messages
		}, {
			resources: ['.bh/mirror/canvas.yaml', 'clip.bhnode'],
			undone: true,
			redone: true,
			geometryRuns: ['undo'],
			notifications: []
		});
	});

	test('ADHD read ranges stay aligned after a connect, an agent frontmatter edit, and an undo; a legacy adhd.yaml is converted exactly once', async () => {
		const body = '# Title\n\npara one\n\npara two\n';
		const harness = await createHarness(disposables, {
			'a.md': '# A\n',
			'b.md': body,
			'c.md': `---\ntitle: C\n---\n${body}`,
			// Absolute lines from an earlier release: `para one` in both files.
			'.bh/mirror/b.md/adhd.yaml': 'path: b.md\nkind: file\nread_paragraphs:\n  - [3, 3]\n',
			'.bh/mirror/c.md/adhd.yaml': 'path: c.md\nkind: file\nread_paragraphs:\n  - [6, 6]\n'
		});
		const readLines = async (path: string) => {
			const text = (await harness.read(path)) ?? '';
			const lines = text.split('\n').slice(baseHalfMarkdownFrontmatterLineCount(text));
			const ranges = (await harness.adhd.readAdhd(harness.node(path)))?.read_paragraphs ?? [];
			return ranges.map(([start, end]) => lines.slice(start - 1, end).join('\n'));
		};
		const aligned = async () => [await readLines('b.md'), await readLines('c.md')];
		const legacy = await aligned();

		// A connect adds a frontmatter block to b.md and grows c.md's.
		const source = new UndoRedoSource();
		const canvas = joinPath(folder, '.bh', 'mirror', 'canvas.yaml');
		await harness.edit.add(harness.node('b.md'), 'a.md', options);
		const connectC = await harness.edit.add(harness.node('c.md'), 'a.md', options);
		harness.edit.pushUndoElement(connectC, { label: 'Connect', resources: [canvas], source });
		const converted = [await harness.read('.bh/mirror/b.md/adhd.yaml'), await harness.read('.bh/mirror/c.md/adhd.yaml')];
		const afterConnect = await aligned();

		// An agent edits the frontmatter outside BaseHalf.
		await harness.write('b.md', `---\nupstream:\n  - a.md\ntags:\n  - reading\n  - later\n---\n${body}`);
		const afterAgentEdit = await aligned();

		// Canvas undo shrinks c.md's frontmatter again.
		await harness.undoRedo.undo(source);
		const afterUndo = await aligned();

		assert.deepStrictEqual({
			legacy,
			converted,
			afterConnect,
			afterAgentEdit,
			afterUndo,
			c: await harness.read('c.md'),
			convertedOnce: [await harness.read('.bh/mirror/b.md/adhd.yaml'), await harness.read('.bh/mirror/c.md/adhd.yaml')]
		}, {
			legacy: [['para one'], ['para one']],
			converted: [
				'path: "b.md"\nkind: file\nline_base: body\nread_paragraphs:\n  - [3, 3]\n',
				'path: "c.md"\nkind: file\nline_base: body\nread_paragraphs:\n  - [3, 3]\n'
			],
			afterConnect: [['para one'], ['para one']],
			afterAgentEdit: [['para one'], ['para one']],
			afterUndo: [['para one'], ['para one']],
			c: `---\ntitle: C\n---\n${body}`,
			convertedOnce: converted
		});
	});

	test('in a marked folder, a connect converts no adhd.yaml', async () => {
		const legacy = 'path: b.md\nkind: file\nread_paragraphs:\n  - [3, 3]\n';
		const harness = await createHarness(disposables, {
			'.basehalf-no-workspace-setup': '',
			'a.md': '# A\n',
			'b.md': '# B\n\npara\n',
			'.bh/mirror/b.md/adhd.yaml': legacy
		});
		await harness.edit.add(harness.node('b.md'), 'a.md', options);
		assert.deepStrictEqual([await harness.read('b.md'), await harness.read('.bh/mirror/b.md/adhd.yaml')], [
			'---\nupstream:\n  - a.md\n---\n# B\n\npara\n',
			legacy
		]);
	});

	test('check reports the stores that would block without flushing or writing', async () => {
		const harness = await createHarness(disposables, { 'a.md': '', 'b.md': '# B\n', 'c.md': '# C\n' }, { autoSave: 'off' });
		const reference = await harness.textModelService.createModelReference(harness.node('b.md').resource);
		let flushed = 0;
		const flusher = harness.flush.registerDocumentFlusher(harness.node('c.md').resource.toString(), async () => {
			flushed++;
			return true;
		});
		try {
			reference.object.textEditorModel.setValue('# B typed\n');
			const blocking = await harness.edit.check([
				{ node: harness.node('b.md'), operation: { kind: 'append', entries: ['a.md'] } },
				{ node: harness.node('c.md'), operation: { kind: 'append', entries: ['a.md'] } }
			]);
			assert.deepStrictEqual([blocking.map(store => [store.node.relativePath, store.reason]), flushed, await harness.read('b.md'), await harness.read('c.md')], [
				[['b.md', 'unsaved']], 0, '# B\n', '# C\n'
			]);
			await harness.textFileService.revert(harness.node('b.md').resource);
		} finally {
			flusher.dispose();
			reference.dispose();
		}
	});
});
