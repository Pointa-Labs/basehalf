/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { mainWindow } from '../../../../base/browser/window.js';
import { Event } from '../../../../base/common/event.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { extUri } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { TestInstantiationService } from '../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILogService, NullLogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { TestNotificationService } from '../../../../platform/notification/test/common/testNotificationService.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IFileQuery, ISearchComplete, ISearchService } from '../../../services/search/common/search.js';
import { IBaseHalfReferenceRefactorService, IBaseHalfRelinkEverywhereOptions } from '../../browser/basehalfReferenceRefactorService.js';
import { BaseHalfUpstreamActions, IBaseHalfUpstreamActionNode } from '../../browser/basehalfUpstreamActions.js';
import { IBaseHalfBadgeMirrorService } from '../../common/basehalfBadgeMirror.js';
import { BASEHALF_CANVAS_UNDO_REDO_SOURCE } from '../../common/basehalfCanvasEditing.js';
import { IBaseHalfCanvasMirrorService } from '../../common/basehalfCanvasMirror.js';
import { IBaseHalfCanvasNavigationService, IBaseHalfWorkspaceResource } from '../../common/basehalfCanvasNavigation.js';
import { IBaseHalfReferenceEditOptions, IBaseHalfReferenceEditResult, IBaseHalfReferenceEditService, IBaseHalfReferenceUndoElementOptions } from '../../common/basehalfReferenceEdit.js';
import { IBaseHalfIndexedDownstream, IBaseHalfReferenceIndexService, IBaseHalfUpstreamEntryView, IBaseHalfUpstreamView } from '../../common/basehalfReferenceIndex.js';
import { isBaseHalfUpstreamReservedOutput } from '../../common/basehalfReferenceStore.js';

const workspace = URI.file('/work');

function node(relativePath: string, kind: 'file' | 'folder' = 'file'): IBaseHalfUpstreamActionNode {
	return { resource: URI.joinPath(workspace, ...relativePath.split('/')), workspaceFolder: workspace, relativePath, kind };
}

function entry(index: number, text: string, status: IBaseHalfUpstreamEntryView['status'], extra: Partial<IBaseHalfUpstreamEntryView> = {}): IBaseHalfUpstreamEntryView {
	const valid = status !== 'invalid';
	return {
		index,
		text,
		scalar: true,
		path: valid ? text : undefined,
		problem: valid ? undefined : 'absolute',
		status,
		...(status === 'valid' ? { target: { ...node(text), kind: 'file' as const } } : {}),
		historical: false,
		issue: status !== 'valid',
		...extra
	};
}

function view(target: IBaseHalfUpstreamActionNode, entries: readonly IBaseHalfUpstreamEntryView[], extra: Partial<IBaseHalfUpstreamView> = {}): IBaseHalfUpstreamView {
	return {
		node: target,
		storeKind: 'markdown',
		storeResource: target.resource,
		readable: true,
		writable: true,
		storeIssue: false,
		entries,
		issueCount: entries.filter(candidate => candidate.issue).length,
		...extra
	};
}

suite('BaseHalfUpstreamActions', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let adds: { node: string; entry: string }[];
	let undoElements: Omit<IBaseHalfReferenceUndoElementOptions, 'stores'>[];
	let picks: string[][];
	let pickPath: string | undefined;
	let relinks: { from: string; to: string; undo: string[] }[];
	let actions: BaseHalfUpstreamActions;

	setup(() => {
		adds = [];
		undoElements = [];
		picks = [];
		pickPath = undefined;
		relinks = [];
		const instantiationService = disposables.add(new TestInstantiationService());
		const result: IBaseHalfReferenceEditResult = { stores: [], changed: true };
		instantiationService.stub(IBaseHalfReferenceEditService, {
			add: async (target: IBaseHalfWorkspaceResource, value: string, _options: IBaseHalfReferenceEditOptions) => {
				adds.push({ node: target.relativePath, entry: value });
				return result;
			},
			pushUndoElement: (_result: IBaseHalfReferenceEditResult, options: Omit<IBaseHalfReferenceUndoElementOptions, 'stores'>) => {
				undoElements.push(options);
				return undefined;
			}
		});
		instantiationService.stub(IBaseHalfReferenceIndexService, {
			getUpstreamOnlyReason: (target: IBaseHalfWorkspaceResource) => isBaseHalfUpstreamReservedOutput(target.relativePath) ? 'reservedOutput' as const : undefined
		});
		instantiationService.stub(IBaseHalfReferenceRefactorService, {
			relinkEverywhere: async (_folder: URI, from: string, to: string, options?: IBaseHalfRelinkEverywhereOptions) => {
				relinks.push({ from, to, undo: (options?.undoResources ?? []).map(resource => resource.path) });
				return true;
			}
		});
		instantiationService.stub(IBaseHalfBadgeMirrorService, {
			listBadges: async () => ({ badges: new Map([['a/overview.md', { path: 'a/overview.md', kind: 'file' as const, description: 'The big picture' }]]), problems: [] })
		});
		instantiationService.stub(IBaseHalfCanvasMirrorService, {
			canvasResource: folder => URI.joinPath(folder.workspaceFolder, '.bh', 'mirror', ...(folder.relativePath ? folder.relativePath.split('/') : []), 'canvas.yaml')
		});
		instantiationService.stub(IBaseHalfCanvasNavigationService, {});
		instantiationService.stub(IQuickInputService, {
			pick: (async (items: Promise<readonly IQuickPickItem[]> | readonly IQuickPickItem[]) => {
				const resolved = await items;
				picks.push(resolved.map(item => item.description ?? item.label));
				return resolved.find(item => item.description === pickPath);
			}) as unknown as IQuickInputService['pick']
		});
		instantiationService.stub(INotificationService, new TestNotificationService());
		instantiationService.stub(ISearchService, {
			fileSearch: async (_query: IFileQuery): Promise<ISearchComplete> => ({
				results: ['a/b/note.md', 'a/overview.md', 'sources/book.pdf', 'outputs/run/frame.png', 'node_modules/x/y.md']
					.map(path => ({ resource: URI.joinPath(workspace, ...path.split('/')) })),
				messages: []
			})
		});
		instantiationService.stub(IFileService, { onDidFilesChange: Event.None });
		instantiationService.stub(IEditorService, {});
		instantiationService.stub(IUriIdentityService, { extUri });
		instantiationService.stub(IWorkspaceContextService, {});
		instantiationService.stub(ILogService, new NullLogService());
		actions = disposables.add(instantiationService.createInstance(BaseHalfUpstreamActions));
	});

	function render(target: IBaseHalfUpstreamActionNode, upstream: IBaseHalfUpstreamView | undefined, downstream: readonly IBaseHalfIndexedDownstream[] = [], indexState: 'building' | 'ready' | 'partial' = 'ready'): HTMLElement {
		const container = mainWindow.document.createElement('div');
		const store = disposables.add(new DisposableStore());
		actions.renderConnections(container, {
			node: target,
			upstream,
			downstream,
			indexState,
			context: {},
			addListener: disposable => store.add(disposable),
			openNode: () => { },
			refresh: () => { },
			roleLabel: slot => slot === 'firstFrame' ? 'First frame' : slot
		});
		return container;
	}

	function describe(container: HTMLElement): unknown {
		return [...container.querySelectorAll<HTMLElement>('.basehalf-canvas-card-badge-section')].map(section => ({
			title: section.querySelector('.basehalf-canvas-card-badge-section-title')?.textContent,
			text: [...section.querySelectorAll<HTMLElement>('.basehalf-canvas-card-badge-helper, .basehalf-canvas-card-badge-empty')].map(element => element.textContent),
			rows: [...section.querySelectorAll<HTMLElement>('.basehalf-canvas-card-badge-row, .basehalf-canvas-card-badge-issue-row')].map(row => ({
				status: row.getAttribute('data-upstream-status') ?? row.getAttribute('data-upstream-issue') ?? 'downstream',
				label: row.querySelector('.basehalf-canvas-card-badge-link, .basehalf-canvas-card-badge-entry-text')?.textContent ?? row.querySelector('.basehalf-canvas-card-badge-issue-message')?.textContent,
				role: row.querySelector('.basehalf-canvas-card-badge-role')?.textContent,
				remove: row.querySelector<HTMLButtonElement>('.basehalf-canvas-card-badge-remove') ? {
					disabled: row.querySelector<HTMLButtonElement>('.basehalf-canvas-card-badge-remove')!.disabled,
					title: row.querySelector<HTMLButtonElement>('.basehalf-canvas-card-badge-remove')!.title
				} : undefined,
				actions: [...row.querySelectorAll<HTMLButtonElement>('.basehalf-canvas-card-badge-issue-action')].map(button => button.textContent)
			})),
			add: section.querySelector('.basehalf-canvas-card-add-reference, .basehalf-canvas-card-add-downstream')?.textContent
		}));
	}

	test('renders Upstream rows with issue actions at their list position and Downstream rows with their remove tooltip', () => {
		const target = node('a/b/note.md');
		const container = render(target, view(target, [
			entry(0, 'a/overview.md', 'valid'),
			entry(1, 'gone.md', 'dangling'),
			entry(2, '../overview.md', 'invalid', { workspacePath: 'a/overview.md' })
		]), [{ node: node('a/b/summary.md'), storeKind: 'markdown', entryIndex: 0 }]);

		assert.deepStrictEqual(describe(container), [
			{
				title: 'Upstream',
				text: ['Context that flows into this card. Saved in this file\'s `upstream` list, so agents reading it see it too.'],
				rows: [
					{ status: 'valid', label: 'overview.md', role: undefined, remove: { disabled: false, title: 'Remove a/overview.md from upstream' }, actions: [] },
					{ status: 'dangling', label: 'gone.md', role: undefined, remove: undefined, actions: ['Relink…', 'Relink Everywhere…', 'Remove', 'Open File'] },
					{ status: 'invalid', label: '../overview.md', role: undefined, remove: undefined, actions: ['Use a/overview.md', 'Remove', 'Open File'] }
				],
				add: '+ Add Upstream'
			},
			{
				title: 'Downstream',
				text: [],
				rows: [{ status: 'downstream', label: 'summary.md', role: undefined, remove: { disabled: false, title: 'Remove from the upstream of a/b/summary.md' }, actions: [] }],
				add: '+ Add Downstream'
			}
		]);
	});

	test('shows empty states, the sidecar helper, and Loading… while the index builds', () => {
		const folder = node('sources', 'folder');
		assert.deepStrictEqual(describe(render(folder, view(folder, [], { storeKind: 'sidecar' }), [], 'building')), [
			{
				title: 'Upstream',
				text: [
					'Context that flows into this card. Saved in BaseHalf metadata for this folder.',
					'Nothing flows into this card yet. Add upstream, or drag a connection into it on the canvas.'
				],
				rows: [],
				add: '+ Add Upstream'
			},
			{ title: 'Downstream', text: ['Loading…'], rows: [], add: '+ Add Downstream' }
		]);
		const note = node('note.md');
		assert.deepStrictEqual((describe(render(note, view(note, []))) as { text: string[] }[])[1].text, ['Nothing draws on this card yet.']);
	});

	test('keeps upstream-only nodes read-only and blocks bound inputs outside a Draft', () => {
		const sealed = node('outputs/run/frame.png');
		assert.deepStrictEqual((describe(render(sealed, view(sealed, [entry(0, 'a/overview.md', 'valid')], { upstreamOnly: 'reservedOutput', storeKind: 'sidecar' }))) as unknown[])[0], {
			title: 'Upstream',
			text: ['This file can\'t receive upstream context.'],
			rows: [{ status: 'valid', label: 'overview.md', role: undefined, remove: undefined, actions: [] }],
			add: undefined
		});

		const video = node('video.bhnode');
		const rows = (describe(render(video, view(video, [
			entry(0, 'a/overview.md', 'valid', { binding: { sourcePath: 'a/overview.md', slot: 'firstFrame', order: 0 } }),
			entry(1, 'sources/book.pdf', 'valid'),
			entry(2, 'old.png', 'dangling', { binding: { sourcePath: 'old.png', slot: 'reference', order: 1 }, historical: true, issue: false })
		], { storeKind: 'node', lifecycle: 'sealed' }))) as { rows: unknown[] }[])[0].rows;
		assert.deepStrictEqual(rows, [
			{ status: 'valid', label: 'overview.md', role: 'First frame', remove: { disabled: true, title: 'This input is part of a result. Copy the settings into a new Draft to change it.' }, actions: [] },
			{ status: 'valid', label: 'book.pdf', role: 'Unassigned', remove: { disabled: false, title: 'Remove sources/book.pdf from upstream' }, actions: [] },
			{ status: 'historical', label: 'old.png', role: 'reference', remove: undefined, actions: [] }
		]);

		// A downstream that can't be downstream keeps its row but has no ×:
		// BaseHalf never removes entries from it.
		const source = node('a/overview.md');
		const downstreamRows = (describe(render(source, view(source, []), [
			{ node: node('a/b/summary.md'), storeKind: 'markdown', entryIndex: 0 },
			{ node: node('outputs/run/copy.md'), storeKind: 'markdown', entryIndex: 0 }
		])) as { rows: { label: string; remove: unknown }[] }[])[1].rows.map(row => [row.label, !!row.remove]);
		assert.deepStrictEqual(downstreamRows, [['summary.md', true], ['copy.md', false]]);
	});

	test('Add Upstream picks any node of the workspace folder and writes the downstream note', async () => {
		const target = node('a/b/note.md');
		pickPath = 'sources/book.pdf';
		const changed = await actions.addUpstream(target, view(target, []), { canvasCardPaths: ['a/b/note.md'] });

		assert.deepStrictEqual({ changed, picks, adds, undo: undoElements.map(element => ({ label: element.label, resources: element.resources.map(resource => resource.path), source: element.source === BASEHALF_CANVAS_UNDO_REDO_SOURCE })) }, {
			changed: true,
			// The node itself is left out; the nearest folders come first; skipped
			// folders never appear.
			picks: [['a/b', 'a', 'a/overview.md', 'outputs', 'sources', 'outputs/run', 'outputs/run/frame.png', 'sources/book.pdf']],
			adds: [{ node: 'a/b/note.md', entry: 'sources/book.pdf' }],
			undo: [{ label: 'Add upstream', resources: ['/work/.bh/mirror/a/b/canvas.yaml'], source: true }]
		});
	});

	test('Relink Everywhere picks the new path and replaces the dangling path through the refactor service', async () => {
		const target = node('a/b/note.md');
		pickPath = 'a/overview.md';
		const changed = await actions.relinkEverywhere(target, { path: 'old/overview.md' }, {});
		pickPath = undefined;
		const cancelled = await actions.relinkEverywhere(target, { path: 'old/overview.md' }, { undoResources: [URI.file('/work/.bh/mirror/canvas.yaml')] });

		assert.deepStrictEqual({ changed, cancelled, relinks, picked: picks[0].includes('a/overview.md') }, {
			changed: true,
			cancelled: false,
			relinks: [{ from: 'old/overview.md', to: 'a/overview.md', undo: ['/work/.bh/mirror/a/b/canvas.yaml'] }],
			picked: true
		});
	});

	test('Add Downstream offers only nodes that can be downstream and writes the other node\'s store', async () => {
		const source = node('sources/book.pdf');
		pickPath = 'a/overview.md';
		await actions.addDownstream(source, [], {});

		assert.deepStrictEqual({ picks, adds }, {
			// Reserved outputs can't be downstream.
			picks: [['sources', 'a', 'a/b', 'a/b/note.md', 'a/overview.md']],
			adds: [{ node: 'a/overview.md', entry: 'sources/book.pdf' }]
		});
	});
});
