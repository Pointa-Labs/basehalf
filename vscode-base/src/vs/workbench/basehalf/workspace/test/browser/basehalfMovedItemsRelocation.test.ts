/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../../base/common/network.js';
import { joinPath, relativePath as getRelativePath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { testWorkspace } from '../../../../../platform/workspace/test/common/testWorkspace.js';
import { IFileQuery, ISearchComplete } from '../../../../services/search/common/search.js';
import { IWorkingCopy } from '../../../../services/workingCopy/common/workingCopy.js';
import { IWorkingCopyService } from '../../../../services/workingCopy/common/workingCopyService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { TestContextService } from '../../../../test/common/workbenchTestServices.js';
import { BaseHalfMirrorCascadeContribution } from '../../browser/basehalfMirrorCascade.contribution.js';
import { IBaseHalfPluginStructuralDeleteCleanupService } from '../../../plugins/browser/basehalfPluginStructuralDeleteCleanup.js';
import { BaseHalfAdhdMirrorService, IBaseHalfAdhdMirrorService } from '../../../markdown/common/basehalfAdhdMirror.js';
import { BaseHalfBadgeMirrorService, IBaseHalfBadgeMirrorService } from '../../../references/common/basehalfBadgeMirror.js';
import { BaseHalfCanvasMirrorService, IBaseHalfCanvasMirrorService } from '../../../canvas/common/basehalfCanvasMirror.js';
import { BASEHALF_MIRROR_IGNORE_CONTENT } from '../../common/basehalfMirrorIgnore.js';
import { IBaseHalfCanvasNavigationService } from '../../../navigation/common/basehalfCanvasNavigation.js';
import { IBaseHalfCanvasViewportStateService } from '../../../canvas/common/basehalfCanvasViewportState.js';
import { BaseHalfEditorFlushService, IBaseHalfEditorFlushService } from '../../../navigation/common/basehalfEditorFlush.js';
import { IBaseHalfDraftOperations, IBaseHalfGenerationTaskStore } from '../../../video/common/basehalfVideoGeneration.js';
import { BaseHalfDraftOperations } from '../../browser/basehalfDraftOperations.js';
import { BaseHalfRecordingGenerationTaskStore } from './basehalfGenerationTaskStoreFake.js';
import { BaseHalfMovedItemsService, IBaseHalfMovedItemsService, IBaseHalfMovedItemsTiming } from '../../common/basehalfMovedItemsService.js';
import { BaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceMutationCoordinator } from '../../common/basehalfWorkspaceMutation.js';

const folder = URI.file('/work');
const timing: IBaseHalfMovedItemsTiming = { quietMs: 30, maxWaitMs: 300, windowMs: 400, saveMs: 10 };
const PDF = '%PDF\u0000';

const badge = (path: string, description: string, extra = '') => `path: "${path}"\nkind: file\ndescription: "${description}"\n${extra}`;
const row = (path: string, x: number) => [`  - path: "${path}"`, '    kind: file', `    x: ${x}`, '    y: 20', '    width: 260', '    height: 140'];
/** A layout file as BaseHalf writes it. */
const canvas = (path: string, cards: string[][]) => [`path: "${path}"`, ...(cards.length ? ['cards:', ...cards.flat()] : ['cards: []']), 'edges: []', ''].join('\n');

/** File search that returns every file of the in-memory file system. */
class AllFilesSearch {
	constructor(private readonly fileService: IFileService) { }

	async fileSearch(query: IFileQuery): Promise<ISearchComplete> {
		const results: { resource: URI }[] = [];
		const stack = query.folderQueries.map(folderQuery => folderQuery.folder);
		while (stack.length) {
			let stat;
			try {
				stat = await this.fileService.resolve(stack.pop()!);
			} catch {
				continue;
			}
			for (const child of stat.children ?? []) {
				if (child.isDirectory) {
					stack.push(child.resource);
				} else {
					results.push({ resource: child.resource });
				}
			}
		}
		return { results, limitHit: false, messages: [] };
	}
}

suite('BaseHalfMovedItems (relocation)', () => {
	const disposables = new DisposableStore();
	teardown(() => disposables.clear());
	ensureNoDisposablesAreLeakedInTestSuite();

	async function createFiles(files: Record<string, string>): Promise<FileService> {
		const fileService = disposables.add(new FileService(new NullLogService()));
		disposables.add(fileService.registerProvider(Schemas.file, disposables.add(new InMemoryFileSystemProvider())));
		await fileService.createFolder(folder);
		for (const [path, content] of Object.entries(files)) {
			await fileService.writeFile(joinPath(folder, ...path.split('/')), VSBuffer.fromString(content));
		}
		return fileService;
	}

	/** BaseHalf opens on the files: the snapshot service and the cascade that relocates. */
	async function open(fileService: FileService, options: { readonly storage?: string; readonly dirty?: () => readonly URI[] } = {}) {
		const session = disposables.add(new DisposableStore());
		const instantiationService = workbenchInstantiationService({ fileService: () => fileService }, session);
		// Unsaved changes, as the working copy service reports them.
		const dirtyChanged = session.add(new Emitter<IWorkingCopy>());
		instantiationService.stub(IWorkingCopyService, {
			onDidChangeDirty: dirtyChanged.event,
			get dirtyWorkingCopies() { return (options.dirty?.() ?? []).map(resource => ({ resource }) as IWorkingCopy); }
		} as Partial<IWorkingCopyService> as IWorkingCopyService);
		const contextService = new TestContextService(testWorkspace(folder));
		instantiationService.stub(IWorkspaceContextService, contextService);
		instantiationService.stub(IBaseHalfEditorFlushService, new BaseHalfEditorFlushService());
		instantiationService.stub(IBaseHalfWorkspaceMutationCoordinator, new BaseHalfWorkspaceMutationCoordinator());
		instantiationService.stub(IBaseHalfCanvasNavigationService, { state: { canvasFolder: undefined, cardDetail: undefined }, activeCanvasEditor: undefined } as Partial<IBaseHalfCanvasNavigationService> as IBaseHalfCanvasNavigationService);
		instantiationService.stub(IBaseHalfAdhdMirrorService, session.add(instantiationService.createInstance(BaseHalfAdhdMirrorService)));
		instantiationService.stub(IBaseHalfBadgeMirrorService, session.add(new BaseHalfBadgeMirrorService(fileService)));
		const canvasMirror = session.add(instantiationService.createInstance(BaseHalfCanvasMirrorService));
		instantiationService.stub(IBaseHalfCanvasMirrorService, canvasMirror);
		// The stored views that were carried along with a folder.
		const views: string[] = [];
		instantiationService.stub(IBaseHalfCanvasViewportStateService, {
			forgetSubtree: () => { },
			moveSubtree: (from: URI, to: URI) => { views.push(`${getRelativePath(folder, from)} -> ${getRelativePath(folder, to)}`); }
		} as Partial<IBaseHalfCanvasViewportStateService> as IBaseHalfCanvasViewportStateService);
		// The task records of this computer: what a move told them.
		const taskStore = new BaseHalfRecordingGenerationTaskStore();
		instantiationService.stub(IBaseHalfGenerationTaskStore, taskStore);
		instantiationService.stub(IBaseHalfPluginStructuralDeleteCleanupService, { stageDelete: async () => [] } as Partial<IBaseHalfPluginStructuralDeleteCleanupService> as IBaseHalfPluginStructuralDeleteCleanupService);
		const movedItems = session.add(new BaseHalfMovedItemsService(
			timing,
			fileService,
			new AllFilesSearch(fileService),
			contextService,
			{ workspaceStorageHome: URI.file(options.storage ?? '/storage') },
			canvasMirror,
			{ getState: () => 'ready', getStores: () => [], onDidChange: Event.None },
			new NullLogService()
		));
		instantiationService.stub(IBaseHalfMovedItemsService, movedItems);
		const draftOperations = instantiationService.createInstance(BaseHalfDraftOperations);
		instantiationService.stub(IBaseHalfDraftOperations, draftOperations);
		session.add(instantiationService.createInstance(BaseHalfMirrorCascadeContribution));
		await movedItems.whenCompared(folder);
		await settle();
		return {
			movedItems,
			views,
			draftOperations,
			/** The moves the task records were told about, as workspace-relative paths. */
			retargets: () => taskStore.retargets.map(({ from, to }) => `${getRelativePath(folder, from)} -> ${getRelativePath(folder, to)}`),
			close: () => session.dispose(),
			dirtyChanged: () => dirtyChanged.fire({} as IWorkingCopy)
		};
	}

	const resource = (path: string) => joinPath(folder, ...path.split('/'));
	/** Long enough for the file events, the quiet period, the comparison, and the relocation. */
	const settle = () => timeout(timing.quietMs * 6);

	/** The files under `.bh/`, with their text. */
	async function hidden(fileService: IFileService): Promise<Record<string, string>> {
		const out: Record<string, string> = {};
		const root = joinPath(folder, '.bh');
		const stack = [root];
		while (stack.length) {
			let stat;
			try {
				stat = await fileService.resolve(stack.pop()!);
			} catch {
				continue;
			}
			for (const child of stat.children ?? []) {
				if (child.isDirectory) {
					stack.push(child.resource);
				} else {
					out[getRelativePath(root, child.resource)!] = (await fileService.readFile(child.resource)).value.toString();
				}
			}
		}
		return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a < b ? -1 : 1));
	}

	test('a described and placed file that is renamed outside keeps its description, its appearance, its kept list, and its place, while BaseHalf runs and at open', async () => {
		const files = {
			'papers/x.pdf': `${PDF}body`,
			'notes/plan.md': '# Plan\n',
			'.bh/mirror/papers/x.pdf/badge.yaml': badge('papers/x.pdf', 'The paper we build on.'),
			'.bh/mirror/papers/x.pdf/appearance.yaml': 'color: "blue"\n',
			'.bh/mirror/papers/x.pdf/upstream.yaml': 'upstream:\n  - notes/plan.md\n',
			'.bh/mirror/papers/canvas.yaml': canvas('papers', [row('papers/x.pdf', 10)])
		};
		const expected = (name: string) => ({
			// A layout was written, so the file that keeps layouts out of git is there.
			'.gitignore': BASEHALF_MIRROR_IGNORE_CONTENT,
			[`mirror/papers/${name}/appearance.yaml`]: 'color: "blue"\n',
			[`mirror/papers/${name}/badge.yaml`]: badge(`papers/${name}`, 'The paper we build on.'),
			[`mirror/papers/${name}/upstream.yaml`]: 'upstream:\n  - notes/plan.md\n',
			'mirror/papers/canvas.yaml': canvas('papers', [row(`papers/${name}`, 10)])
		});

		const running = await createFiles(files);
		const session = await open(running);
		await running.move(resource('papers/x.pdf'), resource('papers/renamed.pdf'));
		await settle();
		const whileRunning = await hidden(running);
		const pending = session.movedItems.getPendingMoves(folder);
		session.close();

		// Renamed again while no window is open.
		await running.move(resource('papers/renamed.pdf'), resource('papers/final.pdf'));
		await open(running);

		assert.deepStrictEqual({ whileRunning, pending, atOpen: await hidden(running) }, {
			// Nothing is left under the old name, not even an empty folder.
			whileRunning: expected('renamed.pdf'),
			pending: [],
			// Followed before the sweep at open: the badge has no orphan mark.
			atOpen: expected('final.pdf')
		});
	});

	test('a card that BaseHalf placed follows its file, and a card that was drawn as new before its file was known to be moved gets the old place', async () => {
		/** The rows of a layout: a row that BaseHalf chose is marked with a star. */
		const rows = (layout: string | undefined) => (layout ?? '').split('  - path: ').slice(1).map(text => {
			const value = (name: string) => /^-?\d+/.exec(text.split(`    ${name}: `)[1] ?? '')?.[0];
			return `${JSON.parse(text.split('\n')[0])}@${value('x')},${value('width')}${text.includes('auto: true') ? '*' : ''}`;
		});
		const chosen = (path: string, x: number) => [...row(path, x), '    auto: true'];

		// Every card has a row, also one the user never touched. Its file is renamed outside BaseHalf.
		const untouched = await createFiles({
			'notes/a.md': '# A\n\nA note that nobody placed by hand.\n',
			'notes/b.md': '# B\n\nAnother note with words of its own.\n',
			'.bh/mirror/notes/canvas.yaml': canvas('notes', [chosen('notes/a.md', 10), chosen('notes/b.md', 350)])
		});
		await open(untouched);
		await untouched.move(resource('notes/a.md'), resource('notes/renamed.md'));
		await settle();

		// A copy is drawn as a new card, with a place BaseHalf chose. Then the original is deleted:
		// the copy is the moved item, and its card takes the place and the size the original had.
		const copied = await createFiles({
			'notes/a.md': '# A\n\nThe note the user placed.\n',
			'.bh/mirror/notes/canvas.yaml': canvas('notes', [row('notes/a.md', 10)])
		});
		await open(copied);
		await copied.copy(resource('notes/a.md'), resource('notes/copy.md'));
		await settle();
		await copied.writeFile(resource('.bh/mirror/notes/canvas.yaml'), VSBuffer.fromString(canvas('notes', [row('notes/a.md', 10), [...row('notes/copy.md', 350).map(line => line.replace('width: 260', 'width: 300')), '    auto: true']])));
		await copied.del(resource('notes/a.md'));
		await settle();

		// The same, but the user had moved the copy's card: that row stands, and the row that would follow stays.
		const copiedAndPlaced = await createFiles({
			'notes/a.md': '# A\n\nThe note the user placed.\n',
			'.bh/mirror/notes/canvas.yaml': canvas('notes', [row('notes/a.md', 10)])
		});
		await open(copiedAndPlaced);
		await copiedAndPlaced.copy(resource('notes/a.md'), resource('notes/copy.md'));
		await settle();
		await copiedAndPlaced.writeFile(resource('.bh/mirror/notes/canvas.yaml'), VSBuffer.fromString(canvas('notes', [row('notes/a.md', 10), row('notes/copy.md', 900)])));
		await copiedAndPlaced.del(resource('notes/a.md'));
		await settle();

		// To another folder that has a layout: the end of that canvas, with its size, as a row BaseHalf chose.
		// To a folder without one: nothing is written there.
		const moved = await createFiles({
			'notes/a.md': '# A\n\nThe note the user placed.\n',
			'notes/c.md': '# C\n\nA third note with other words in it.\n',
			'seen/x.md': '# X\n\nA card that is already there.\n',
			'.bh/mirror/notes/canvas.yaml': canvas('notes', [row('notes/a.md', 10), row('notes/c.md', 700)]),
			'.bh/mirror/seen/canvas.yaml': canvas('seen', [row('seen/x.md', 500)])
		});
		await open(moved);
		await moved.move(resource('notes/a.md'), resource('seen/a.md'));
		await moved.move(resource('notes/c.md'), resource('unseen/c.md'));
		await settle();
		const movedFiles = await hidden(moved);

		assert.deepStrictEqual({
			untouched: rows((await hidden(untouched))['mirror/notes/canvas.yaml']),
			copied: rows((await hidden(copied))['mirror/notes/canvas.yaml']),
			copiedAndPlaced: rows((await hidden(copiedAndPlaced))['mirror/notes/canvas.yaml']),
			moved: { from: rows(movedFiles['mirror/notes/canvas.yaml']), seen: rows(movedFiles['mirror/seen/canvas.yaml']), unseen: movedFiles['mirror/unseen/canvas.yaml'] }
		}, {
			untouched: ['notes/renamed.md@10,260*', 'notes/b.md@350,260*'],
			copied: ['notes/copy.md@10,260'],
			copiedAndPlaced: ['notes/a.md@10,260', 'notes/copy.md@900,260'],
			moved: { from: [], seen: ['seen/x.md@500,260', 'seen/a.md@840,260*'], unseen: undefined }
		});
	});

	test('many files that are renamed at once are relocated in one run, with one write of their layout', async () => {
		const names = Array.from({ length: 30 }, (_, index) => `n${index}.md`);
		const files: Record<string, string> = {
			'.bh/mirror/notes/canvas.yaml': canvas('notes', names.map((name, index) => row(`notes/${name}`, index * 340))),
			'.bh/mirror/notes/n3.md/badge.yaml': badge('notes/n3.md', 'The third.'),
			'.bh/mirror/notes/n7.md/badge.yaml': badge('notes/n7.md', 'The seventh.')
		};
		for (const [index, name] of names.entries()) {
			files[`notes/${name}`] = `# Note ${index}\n\nWhat note ${index} says and no other note does: ${index * 7919}.\n`;
		}
		const expected = (prefix: string) => ({
			'.gitignore': BASEHALF_MIRROR_IGNORE_CONTENT,
			[`mirror/notes/${prefix}n3.md/badge.yaml`]: badge(`notes/${prefix}n3.md`, 'The third.'),
			[`mirror/notes/${prefix}n7.md/badge.yaml`]: badge(`notes/${prefix}n7.md`, 'The seventh.'),
			'mirror/notes/canvas.yaml': canvas('notes', names.map((name, index) => row(`notes/${prefix}${name}`, index * 340)))
		});

		const fileService = await createFiles(files);
		const session = await open(fileService);
		const reported: number[] = [];
		disposables.add(session.movedItems.onDidRelocate(event => reported.push(event.moves.length)));
		await Promise.all(names.map(name => fileService.move(resource(`notes/${name}`), resource(`notes/r-${name}`))));
		await settle();
		const whileRunning = await hidden(fileService);
		const pending = session.movedItems.getPendingMoves(folder).length;
		session.close();

		// Renamed again while no window is open: the comparison at open finds all of them at once.
		for (const name of names) {
			await fileService.move(resource(`notes/r-${name}`), resource(`notes/f-${name}`));
		}
		let layoutWrites = 0;
		const write = fileService.writeFileWithExpectedContents.bind(fileService);
		fileService.writeFileWithExpectedContents = (written, ...rest) => {
			layoutWrites += written.path === '/work/.bh/mirror/notes/canvas.yaml' ? 1 : 0;
			return write(written, ...rest);
		};
		await open(fileService);

		assert.deepStrictEqual({ whileRunning, pending, followed: reported.reduce((sum, count) => sum + count, 0), inFewerReportsThanFiles: reported.length < names.length, atOpen: await hidden(fileService), layoutWrites }, {
			whileRunning: expected('r-'),
			pending: 0,
			followed: 30,
			inFewerReportsThanFiles: true,
			atOpen: expected('f-'),
			layoutWrites: 1
		});
	});

	test('a pair whose relocation fails waits for the next try, and the canvas does not wait for it', async () => {
		const fileService = await createFiles({
			'notes/a.md': '# A\n\nA note with words of its own.\n',
			'.bh/mirror/notes/canvas.yaml': canvas('notes', [row('notes/a.md', 10)])
		});
		const session = await open(fileService);
		// The layout cannot be written.
		let broken = true;
		const write = fileService.writeFileWithExpectedContents.bind(fileService);
		fileService.writeFileWithExpectedContents = (written, ...rest) => broken && written.path === '/work/.bh/mirror/notes/canvas.yaml'
			? Promise.reject(new Error('read-only'))
			: write(written, ...rest);
		await fileService.move(resource('notes/a.md'), resource('notes/b.md'));
		await settle();
		const whileItFails = {
			pending: session.movedItems.getPendingMoves(folder).map(move => `${move.from} -> ${move.to}`),
			settled: session.movedItems.isSettled(folder, 'notes'),
			layout: (await hidden(fileService))['mirror/notes/canvas.yaml']
		};
		// The cause is gone. BaseHalf tries the pairs that wait again when an editor is saved.
		broken = false;
		session.dirtyChanged();
		await settle();

		assert.deepStrictEqual({ whileItFails, pending: session.movedItems.getPendingMoves(folder).length, layout: (await hidden(fileService))['mirror/notes/canvas.yaml'] }, {
			whileItFails: { pending: ['notes/a.md -> notes/b.md'], settled: true, layout: canvas('notes', [row('notes/a.md', 10)]) },
			pending: 0,
			layout: canvas('notes', [row('notes/b.md', 10)])
		});
	});

	test('nothing at the new path is replaced, an orphan badge there gives way with a recovery copy, and a folder takes everything below it along', async () => {
		const fileService = await createFiles({
			'a.md': 'The first note, with enough text to be told apart.\n',
			'd.md': 'The fourth note, also long enough to be told apart.\n',
			'old/inner.pdf': `${PDF}inner`,
			'old/sub/deep.md': 'A note deep inside the folder that is renamed.\n',
			'.bh/mirror/a.md/badge.yaml': badge('a.md', 'About a.'),
			'.bh/mirror/d.md/badge.yaml': badge('d.md', 'About d.'),
			// A file that was deleted long ago still has its description.
			'.bh/mirror/gone.md/badge.yaml': badge('gone.md', 'About a file that is gone.'),
			'.bh/mirror/old/badge.yaml': 'path: "old"\nkind: folder\ndescription: "The folder."\n',
			'.bh/mirror/old/canvas.yaml': canvas('old', [row('old/inner.pdf', 5)]),
			'.bh/mirror/old/sub/deep.md/badge.yaml': badge('old/sub/deep.md', 'Deep.'),
			'.bh/mirror/canvas.yaml': canvas('', [row('a.md', 1), row('old', 2)])
		});
		const session = await open(fileService);
		const orphanMarked = (await hidden(fileService))['mirror/gone.md/badge.yaml'].includes('orphan: true');

		// The user describes the new card before BaseHalf has compared: that description stays.
		await fileService.move(resource('a.md'), resource('c.md'));
		await fileService.writeFile(joinPath(folder, '.bh', 'mirror', 'c.md', 'badge.yaml'), VSBuffer.fromString(badge('c.md', 'Written for c.')));
		await fileService.move(resource('d.md'), resource('gone.md'));
		await fileService.move(resource('old'), resource('new'));
		await settle();
		const after = await hidden(fileService);
		const recovered = Object.keys(after).filter(path => path.startsWith('cache/recovered/'));

		assert.deepStrictEqual({
			orphanMarked,
			pending: session.movedItems.getPendingMoves(folder),
			settled: session.movedItems.isSettled(folder),
			taken: [after['mirror/c.md/badge.yaml'], after['mirror/a.md/badge.yaml']],
			rootCanvas: after['mirror/canvas.yaml'],
			orphanGaveWay: [after['mirror/gone.md/badge.yaml'], after['mirror/d.md/badge.yaml'], recovered.length, recovered.map(path => after[path])],
			folder: Object.fromEntries(Object.entries(after).filter(([path]) => path.startsWith('mirror/new/') || path.startsWith('mirror/old/')))
		}, {
			orphanMarked: true,
			pending: [],
			settled: true,
			// c keeps what the user wrote, and a's description is still where it was.
			taken: [badge('c.md', 'Written for c.'), badge('a.md', 'About a.')],
			// The row of `a.md` had a free place at `c.md`; the folder's row follows its folder.
			rootCanvas: canvas('', [row('c.md', 1), row('new', 2)]),
			orphanGaveWay: [badge('gone.md', 'About d.'), undefined, 1, [badge('gone.md', 'About a file that is gone.', 'orphan: true\n')]],
			folder: {
				'mirror/new/badge.yaml': 'path: "new"\nkind: folder\ndescription: "The folder."\n',
				'mirror/new/canvas.yaml': canvas('new', [row('new/inner.pdf', 5)]),
				'mirror/new/sub/deep.md/badge.yaml': badge('new/sub/deep.md', 'Deep.'),
				// The empty layout that retirement leaves; it is not card information.
				'mirror/old/canvas.yaml': canvas('old', [])
			}
		});
	});
	test('a folder that is renamed while BaseHalf runs keeps the connection between its cards', async () => {
		const edge = (folderPath: string) => ['edges:', `  - from: ${folderPath}/a.md`, '    from_anchor: east', `    to: ${folderPath}/b.md`, '    to_anchor: west', ''].join('\n');
		const layout = (folderPath: string) => canvas(folderPath, [row(`${folderPath}/a.md`, 1), row(`${folderPath}/b.md`, 2)]).replace('edges: []\n', edge(folderPath));
		const fileService = await createFiles({
			'old/a.md': 'The first note of the folder, with text of its own.\n',
			'old/b.md': 'The second note of the folder, about something else.\n',
			'.bh/mirror/old/badge.yaml': badge('old', 'About the folder.').replace('kind: file', 'kind: folder'),
			'.bh/mirror/old/a.md/badge.yaml': badge('old/a.md', 'About a.'),
			'.bh/mirror/old/b.md/badge.yaml': badge('old/b.md', 'About b.'),
			'.bh/mirror/old/canvas.yaml': layout('old')
		});
		const session = await open(fileService);

		await fileService.move(resource('old'), resource('new'));
		await settle();
		await settle();
		const after = await hidden(fileService);

		assert.deepStrictEqual({ edges: after['mirror/new/canvas.yaml']?.split('\n').filter(line => /^\s+(- )?(from|to)(_anchor)?:/.test(line)).map(line => line.trim()), badges: [after['mirror/new/a.md/badge.yaml'], after['mirror/new/b.md/badge.yaml']], left: Object.keys(after).filter(path => path.startsWith('mirror/old/') && !path.endsWith('canvas.yaml')), pending: session.movedItems.getPendingMoves(folder) }, {
			edges: ['- from: "new/a.md"', 'from_anchor: east', 'to: "new/b.md"', 'to_anchor: west'],
			badges: [badge('new/a.md', 'About a.'), badge('new/b.md', 'About b.')],
			left: [],
			pending: []
		});
	});

	test('a pair that was held back while a new file took the old name leaves the card with that file, which is followed from there', async () => {
		const fileService = await createFiles({
			'a.md': 'The first note, with enough text to be told apart.\n',
			'.bh/mirror/a.md/badge.yaml': badge('a.md', 'About a.'),
			'.bh/mirror/canvas.yaml': canvas('', [row('a.md', 1)])
		});
		let dirty: URI[] = [resource('a.md')];
		const session = await open(fileService, { dirty: () => dirty });
		await fileService.move(resource('a.md'), resource('b.md'));
		await settle();
		// While the pair waits for the unsaved changes, a new file is written under the old name.
		await fileService.writeFile(resource('a.md'), VSBuffer.fromString('Another note altogether, written under the old name.\n'));
		await settle();
		dirty = [];
		session.dirtyChanged();
		await settle();
		const stayed = await hidden(fileService);
		const pending = session.movedItems.getPendingMoves(folder).length;

		// The file at the old name is an item like any other: its card follows it.
		await fileService.move(resource('a.md'), resource('c.md'));
		await settle();
		await settle();
		const followed = await hidden(fileService);

		assert.deepStrictEqual({
			stayed: [stayed['mirror/a.md/badge.yaml'], stayed['mirror/b.md/badge.yaml'], stayed['mirror/canvas.yaml']],
			pending,
			followed: [followed['mirror/c.md/badge.yaml'], followed['mirror/a.md/badge.yaml'], followed['mirror/canvas.yaml']]
		}, {
			stayed: [badge('a.md', 'About a.'), undefined, canvas('', [row('a.md', 1)])],
			pending: 0,
			followed: [badge('c.md', 'About a.'), undefined, canvas('', [row('c.md', 1)])]
		});
	});

	test('a folder that is renamed outside while a card in it generates is followed at once: its drafts, its generated files, and the task records come along', async () => {
		const generation = 'prompt: "A harbor at dawn"\nmodel: "seedance-2.5"\n';
		const made = 'id: "20261019T080000-k3f9"\n';
		const fileService = await createFiles({
			'shots/notes.md': 'Notes about the shots of the first scene, and what each should show.\n',
			'shots/landed.mp4': `${PDF}a generated video`,
			'.bh/mirror/shots/badge.yaml': badge('shots', 'The shots of scene one.').replace('kind: file', 'kind: folder'),
			'.bh/mirror/shots/canvas.yaml': canvas('shots', [row('shots/notes.md', 1), row('shots/next.mp4', 400), row('shots/landed.mp4', 800)]),
			// A draft that generates: card information and nothing else.
			'.bh/mirror/shots/next.mp4/generation.yaml': generation,
			'.bh/mirror/shots/next.mp4/upstream.yaml': 'upstream:\n  - shots/notes.md\n',
			'.bh/mirror/shots/next.mp4/badge.yaml': badge('shots/next.mp4', 'The opening shot.'),
			// A generated file with its prompt and its record.
			'.bh/mirror/shots/landed.mp4/generation.yaml': generation,
			'.bh/mirror/shots/landed.mp4/made.yaml': made
		});
		const session = await open(fileService);
		await fileService.move(resource('shots'), resource('scenes'));
		await settle();
		await settle();
		const after = await hidden(fileService);

		assert.deepStrictEqual({
			moved: Object.fromEntries(Object.entries(after).filter(([path]) => path.startsWith('mirror/scenes/'))),
			left: Object.keys(after).filter(path => path.startsWith('mirror/shots/') && !path.endsWith('canvas.yaml')),
			pending: session.movedItems.getPendingMoves(folder).length,
			retargets: session.retargets(),
			views: session.views
		}, {
			moved: {
				'mirror/scenes/badge.yaml': badge('scenes', 'The shots of scene one.').replace('kind: file', 'kind: folder'),
				'mirror/scenes/canvas.yaml': canvas('scenes', [row('scenes/notes.md', 1), row('scenes/next.mp4', 400), row('scenes/landed.mp4', 800)]),
				'mirror/scenes/landed.mp4/generation.yaml': generation,
				'mirror/scenes/landed.mp4/made.yaml': made,
				'mirror/scenes/next.mp4/badge.yaml': badge('scenes/next.mp4', 'The opening shot.'),
				'mirror/scenes/next.mp4/generation.yaml': generation,
				'mirror/scenes/next.mp4/upstream.yaml': 'upstream:\n  - shots/notes.md\n'
			},
			left: [],
			// It is not held back: the run wrote the new path into the task records.
			pending: 0,
			retargets: ['shots -> scenes'],
			views: ['shots -> scenes']
		});
	});

	test('a file that is recognized at a draft\'s path keeps its own card, and the draft moves aside to the next free name with its card information and place', async () => {
		const fileService = await createFiles({
			'clips/shot.mp4': `${PDF}a generated video`,
			'.bh/mirror/clips/shot.mp4/generation.yaml': 'prompt: "the clip"\n',
			'.bh/mirror/clips/shot.mp4/made.yaml': 'id: "t1"\n',
			'.bh/mirror/clips/canvas.yaml': canvas('clips', [row('clips/shot.mp4', 10)]),
			// A draft in another folder, with a card of its own, under the name the file will take.
			'shots/notes.md': 'Notes about the shots of the first scene.\n',
			'.bh/mirror/shots/shot.mp4/generation.yaml': 'prompt: "the draft"\n',
			'.bh/mirror/shots/shot.mp4/upstream.yaml': 'upstream:\n  - shots/notes.md\n',
			'.bh/mirror/shots/shot.mp4/badge.yaml': badge('shots/shot.mp4', 'The draft.'),
			'.bh/mirror/shots/canvas.yaml': canvas('shots', [row('shots/notes.md', 1), row('shots/shot.mp4', 400)])
		});
		const session = await open(fileService);
		await fileService.move(resource('clips/shot.mp4'), resource('shots/shot.mp4'));
		await settle();
		await settle();
		const after = await hidden(fileService);

		assert.deepStrictEqual({
			shots: Object.fromEntries(Object.entries(after).filter(([path]) => path.startsWith('mirror/shots/'))),
			clips: Object.keys(after).filter(path => path.startsWith('mirror/clips/') && !path.endsWith('canvas.yaml')),
			retargets: session.retargets()
		}, {
			shots: {
				'mirror/shots/canvas.yaml': canvas('shots', [row('shots/notes.md', 1), row('shots/shot-2.mp4', 400), [...row('shots/shot.mp4', 740), '    auto: true']]),
				// The moved file's own card information.
				'mirror/shots/shot.mp4/generation.yaml': 'prompt: "the clip"\n',
				'mirror/shots/shot.mp4/made.yaml': 'id: "t1"\n',
				// The draft, under the next free name.
				'mirror/shots/shot-2.mp4/badge.yaml': badge('shots/shot-2.mp4', 'The draft.'),
				'mirror/shots/shot-2.mp4/generation.yaml': 'prompt: "the draft"\n',
				'mirror/shots/shot-2.mp4/upstream.yaml': 'upstream:\n  - shots/notes.md\n'
			},
			clips: [],
			retargets: ['shots/shot.mp4 -> shots/shot-2.mp4', 'clips/shot.mp4 -> shots/shot.mp4']
		});
	});

	test('the sweep at open marks no draft\'s badge, and marks that of a generated file that is gone', async () => {
		const fileService = await createFiles({
			'shots/notes.md': '# Notes\n',
			'.bh/mirror/shots/next.mp4/generation.yaml': 'prompt: ""\n',
			'.bh/mirror/shots/next.mp4/badge.yaml': badge('shots/next.mp4', 'A draft.'),
			'.bh/mirror/shots/gone.mp4/generation.yaml': 'prompt: ""\n',
			'.bh/mirror/shots/gone.mp4/made.yaml': 'id: "t1"\n',
			'.bh/mirror/shots/gone.mp4/badge.yaml': badge('shots/gone.mp4', 'A generated file that is gone.')
		});
		await open(fileService);
		const after = await hidden(fileService);
		assert.deepStrictEqual([after['mirror/shots/next.mp4/badge.yaml'], after['mirror/shots/gone.mp4/badge.yaml']], [
			badge('shots/next.mp4', 'A draft.'),
			badge('shots/gone.mp4', 'A generated file that is gone.', 'orphan: true\n')
		]);
	});

	test('an item with unsaved changes is held back and relocated when they are gone, and two windows end with the same result', async () => {
		const files = {
			'a.md': 'The first note, with enough text to be told apart.\n',
			'p.pdf': `${PDF}body`,
			'.bh/mirror/a.md/badge.yaml': badge('a.md', 'About a.'),
			'.bh/mirror/p.pdf/badge.yaml': badge('p.pdf', 'About p.'),
			'.bh/mirror/canvas.yaml': canvas('', [row('a.md', 1), row('p.pdf', 2)])
		};
		const held = await createFiles(files);
		let dirty: URI[] = [resource('a.md')];
		const session = await open(held, { dirty: () => dirty });
		await held.move(resource('a.md'), resource('b.md'));
		await settle();
		const whileDirty = { badge: (await hidden(held))['mirror/a.md/badge.yaml'] !== undefined, pending: session.movedItems.getPendingMoves(folder).length, settled: session.movedItems.isSettled(folder) };
		// The changes are discarded: no file event, only the working copy says so.
		dirty = [];
		session.dirtyChanged();
		await settle();
		const afterDiscard = await hidden(held);

		// Two windows on one folder follow the same rename.
		const shared = await createFiles(files);
		const first = await open(shared, { storage: '/storage-1' });
		const second = await open(shared, { storage: '/storage-2' });
		await shared.move(resource('p.pdf'), resource('q.pdf'));
		await settle();
		await settle();
		const both = await hidden(shared);

		assert.deepStrictEqual({
			whileDirty,
			afterDiscard: [afterDiscard['mirror/b.md/badge.yaml'], afterDiscard['mirror/a.md/badge.yaml'], afterDiscard['mirror/canvas.yaml']],
			both: [both['mirror/q.pdf/badge.yaml'], both['mirror/p.pdf/badge.yaml'], both['mirror/canvas.yaml']],
			pending: [first.movedItems.getPendingMoves(folder).length, second.movedItems.getPendingMoves(folder).length]
		}, {
			// It waits for the user, and does not keep the canvas waiting meanwhile.
			whileDirty: { badge: true, pending: 1, settled: true },
			afterDiscard: [badge('b.md', 'About a.'), undefined, canvas('', [row('b.md', 1), row('p.pdf', 2)])],
			both: [badge('q.pdf', 'About p.'), undefined, canvas('', [row('a.md', 1), row('q.pdf', 2)])],
			pending: [0, 0]
		});
	});
});
