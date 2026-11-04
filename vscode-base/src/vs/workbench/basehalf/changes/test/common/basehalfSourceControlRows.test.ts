/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BaseHalfNavigationResult, IBaseHalfCanvasNavigationService, IBaseHalfOpenResourceOptions } from '../../../navigation/common/basehalfCanvasNavigation.js';
import { tryOpenBaseHalfSourceControlRow } from '../../browser/basehalfSourceControlRows.js';
import { IBaseHalfFileChange, IBaseHalfFileChangesService } from '../../common/basehalfFileChanges.js';

const FILE = URI.file('/work/src/a.ts');
const CHANGE = (groupId: string): IBaseHalfFileChange => ({ groupId, original: FILE.with({ scheme: 'git' }), modified: FILE });

suite('BaseHalf rows of Source Control', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	function create(result: BaseHalfNavigationResult = { handled: true } as BaseHalfNavigationResult, change?: IBaseHalfFileChange) {
		const calls: [string, string, IBaseHalfOpenResourceOptions][] = [];
		const navigation = {
			openCardDetail: async (resource: URI, options: IBaseHalfOpenResourceOptions) => { calls.push(['detail', resource.path, options]); return result; },
			openResource: async (resource: URI, options: IBaseHalfOpenResourceOptions) => { calls.push(['resource', resource.path, options]); return result; }
		} as unknown as IBaseHalfCanvasNavigationService;
		const changes = {
			hasChangesView: () => !!change,
			changeOf: () => change
		} as unknown as IBaseHalfFileChangesService;
		return { calls, navigation, changes };
	}

	test('a changed file opens at the Changes view of its group, with the keyboard left where it is', async () => {
		const { calls, navigation, changes } = create(undefined, CHANGE('index'));
		const handled = await tryOpenBaseHalfSourceControlRow({ resource: FILE, groupId: 'index', preserveFocus: true, pinned: false }, navigation, changes);
		assert.strictEqual(handled, true);
		assert.deepStrictEqual(calls, [['detail', '/work/src/a.ts', { source: 'api', preserveFocus: true, pinned: false, projection: 'changes', changesGroup: 'index' }]]);
	});

	test('a file without a Changes view, such as a new one, opens as usual', async () => {
		const { calls, navigation, changes } = create();
		assert.strictEqual(await tryOpenBaseHalfSourceControlRow({ resource: FILE, groupId: 'workingTree' }, navigation, changes), true);
		assert.deepStrictEqual(calls.map(([kind]) => kind), ['resource']);
	});

	test('a row of another group than its comparison opens as usual', async () => {
		const { calls, navigation, changes } = create(undefined, CHANGE('workingTree'));
		await tryOpenBaseHalfSourceControlRow({ resource: FILE, groupId: 'untracked' }, navigation, changes);
		assert.deepStrictEqual(calls.map(([kind]) => kind), ['resource']);
	});

	test('a file that has nothing to open is left to VS Code', async () => {
		const { navigation, changes } = create({ handled: false, reason: 'missingOrUnreadable' });
		assert.strictEqual(await tryOpenBaseHalfSourceControlRow({ resource: FILE, groupId: 'workingTree' }, navigation, changes), false);
	});

	test('a dirty editor that refuses to close keeps the row from going anywhere else', async () => {
		const { navigation, changes } = create({ handled: false, reason: 'blockedByDirtyEditor' });
		assert.strictEqual(await tryOpenBaseHalfSourceControlRow({ resource: FILE, groupId: 'workingTree' }, navigation, changes), true);
	});

	test('a conflict, a file under .bh, another scheme, and a row opened to the side stay VS Code\'s', async () => {
		const { calls, navigation, changes } = create(undefined, CHANGE('workingTree'));
		const rows = [
			{ resource: FILE, groupId: 'merge' },
			{ resource: URI.file('/work/.bh/mirror/a.yaml'), groupId: 'workingTree' },
			{ resource: FILE.with({ scheme: 'git' }), groupId: 'workingTree' },
			{ resource: FILE, groupId: 'workingTree', sideBySide: true }
		];
		for (const row of rows) {
			assert.strictEqual(await tryOpenBaseHalfSourceControlRow(row, navigation, changes), false);
		}
		assert.deepStrictEqual(calls, []);
	});
});
