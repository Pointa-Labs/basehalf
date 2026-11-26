/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../base/common/uri.js';
import { runWithFakedTimers } from '../../../../../../base/test/common/timeTravelScheduler.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { IDecoration, IDecorationsService } from '../../../../../services/decorations/common/decorations.js';
import { IBaseHalfCanvasCardMark, IBaseHalfCanvasView } from '../../../../canvas/browser/basehalfCanvasExtensions.js';
import { IBaseHalfFileChangesService } from '../../../../changes/common/basehalfFileChanges.js';
import { IBaseHalfCanvasNavigationService } from '../../../../navigation/common/basehalfCanvasNavigation.js';
import { BaseHalfCanvasChangeMarks } from '../../browser/basehalfCanvasChangeMarks.contribution.js';

const file = (path: string) => URI.file(`/work/${path}`);

suite('BaseHalf canvas change marks', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function create(cards: Record<string, { readonly kind: 'file' | 'folder'; readonly draft?: boolean }>, changed: readonly string[], holding: readonly string[]) {
		const disposables = store.add(new DisposableStore());
		const sceneChanged = disposables.add(new Emitter<never>());
		const changesChanged = disposables.add(new Emitter<void>());
		const opened: unknown[] = [];
		const held = new Set<string>();
		let marks: ReadonlyMap<string, IBaseHalfCanvasCardMark> = new Map();
		const canvas = {
			scene: { cards: Object.keys(cards).map(path => ({ path })) },
			onDidChangeScene: sceneChanged.event,
			getItem: (path: string) => ({
				kind: cards[path].kind,
				stat: { resource: file(path) },
				generation: cards[path].draft ? { draft: true } : undefined
			}),
			setCardMarks: (next: ReadonlyMap<string, IBaseHalfCanvasCardMark>) => { marks = next; }
		} as unknown as IBaseHalfCanvasView;
		const changes = {
			onDidChange: changesChanged.event,
			isChanged: (resource: URI) => changed.includes(resource.path.slice('/work/'.length)),
			holdsChange: (resource: URI) => holding.includes(resource.path.slice('/work/'.length))
		} as unknown as IBaseHalfFileChangesService;
		const decorations = {
			onDidChangeDecorations: Event.None,
			getDecoration: (resource: URI, includeChildren: boolean): IDecoration => {
				const name = resource.path.slice('/work/'.length);
				held.add(name);
				return {
					labelClassName: `color-${name}`,
					badgeClassName: includeChildren ? `dot-${name}` : `letter-${name}`,
					iconClassName: '',
					tooltip: '',
					strikethrough: false,
					isTextBadge: !includeChildren,
					dispose: () => held.delete(name)
				};
			}
		} as unknown as IDecorationsService;
		const navigation = { openCardDetail: (resource: URI, options: unknown) => { opened.push([resource.path, options]); return Promise.resolve({ handled: true }); } } as unknown as IBaseHalfCanvasNavigationService;
		const feature = disposables.add(new BaseHalfCanvasChangeMarks({ canvas }, changes, decorations, navigation));
		return { feature, sceneChanged, changesChanged, opened, held, marks: () => marks };
	}

	const settle = () => new Promise(resolve => setTimeout(resolve, 200));

	test('a changed file has the letter and color of Files, and its letter opens its changes', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const { changesChanged, marks, opened } = create({ 'a.ts': { kind: 'file' }, 'b.ts': { kind: 'file' } }, ['a.ts'], []);
		changesChanged.fire();
		await settle();
		assert.deepStrictEqual([...marks().keys()], ['a.ts']);
		const mark = marks().get('a.ts');
		assert.strictEqual(mark?.labelClassName, 'color-a.ts');
		assert.strictEqual(mark?.badgeClassName, 'letter-a.ts');
		mark?.open?.();
		assert.deepStrictEqual(opened, [['/work/a.ts', { source: 'api', pinned: true, projection: 'changes' }]]);
	}));

	test('a folder that holds a change has the dot and nothing to open, and its rows say what Files says', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const { changesChanged, marks } = create({ src: { kind: 'folder' }, docs: { kind: 'folder' } }, ['src/a.ts'], ['src', 'src/deep']);
		changesChanged.fire();
		await settle();
		assert.deepStrictEqual([...marks().keys()], ['src']);
		const mark = marks().get('src');
		assert.strictEqual(mark?.badgeClassName, 'dot-src');
		assert.strictEqual(mark?.open, undefined);
		assert.strictEqual(mark?.rowMark?.('a.ts', false)?.badgeClassName, 'letter-src/a.ts');
		assert.strictEqual(mark?.rowMark?.('deep', true)?.badgeClassName, 'dot-src/deep');
		assert.strictEqual(mark?.rowMark?.('same.ts', false), undefined);
	}));

	test('a draft has no mark', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const { changesChanged, marks } = create({ 'draft.png': { kind: 'file', draft: true } }, ['draft.png'], []);
		changesChanged.fire();
		await settle();
		assert.strictEqual(marks().size, 0);
	}));

	test('a change that went takes its mark along, and the decoration is let go', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const changed = ['a.ts'];
		const { changesChanged, marks, held } = create({ 'a.ts': { kind: 'file' } }, changed, []);
		changesChanged.fire();
		await settle();
		assert.strictEqual(marks().size, 1);
		assert.deepStrictEqual([...held], ['a.ts']);
		changed.pop();
		changesChanged.fire();
		await settle();
		assert.strictEqual(marks().size, 0);
		assert.deepStrictEqual([...held], []);
	}));

	test('many changes at once draw once', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const { changesChanged, sceneChanged, marks } = create({ 'a.ts': { kind: 'file' } }, ['a.ts'], []);
		const first = marks();
		changesChanged.fire();
		changesChanged.fire();
		sceneChanged.fire(undefined as never);
		await settle();
		const second = marks();
		assert.notStrictEqual(first, second);
		await settle();
		assert.strictEqual(marks(), second);
	}));
});
