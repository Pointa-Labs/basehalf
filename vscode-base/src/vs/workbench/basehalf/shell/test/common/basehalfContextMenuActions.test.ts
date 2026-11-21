/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Action, IAction, Separator, SubmenuAction, toAction } from '../../../../../base/common/actions.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { baseHalfContextMenuActions } from '../../common/basehalfContextMenuActions.js';

suite('BaseHalfContextMenuActions', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function describe(actions: readonly IAction[]): unknown[] {
		return actions.map(action => action instanceof Separator ? '---' : action instanceof SubmenuAction ? { [action.label]: describe(action.actions) } : `${action.label}${action.checked ? ' (on)' : ''}`);
	}

	test('a context menu the base draws itself holds no command BaseHalf does not have, and reads in BaseHalf\'s words', () => {
		const ran: string[] = [];
		const entry = (id: string, label: string, checked?: boolean) => toAction({ id, label, checked, run: () => { ran.push(id); } });
		// The context menu of the sidebar's icons, as the base makes it.
		const menu: IAction[] = [
			entry('workbench.view.explorer', 'Explorer', true),
			entry('workbench.view.scm', 'Source Control', true),
			entry('workbench.view.extensions', 'Extensions', false),
			entry('workbench.view.debug', 'Run and Debug', false),
			new Separator(),
			new SubmenuAction('activityBarPositionMenu', 'Activity Bar Position', []),
			new SubmenuAction('moveToMenu', 'Move To', [entry('workbench.action.moveView', 'Move View')]),
			new SubmenuAction('other', 'Secondary Side Bar Size', [entry('small', 'Small'), new Separator(), entry('testing.runAll', 'Run Tests')]),
			entry('workbench.action.toggleSidebarPosition', 'Move Primary Side Bar Right'),
			new Separator(),
			entry('workbench.action.toggleSidebarVisibility', 'Hide Primary Side Bar')
		];

		const shown = baseHalfContextMenuActions(menu);
		assert.deepStrictEqual(describe(shown), [
			'Explorer (on)',
			'Source Control (on)',
			'---',
			{ 'Agent Area Size': ['Small'] },
			'---',
			'Hide Sidebar'
		]);

		// An entry under another name is the entry: it runs what the entry runs.
		const hide = shown[shown.length - 1];
		void hide.run();
		assert.deepStrictEqual({ ran, id: hide.id, enabled: hide.enabled, same: shown[0] === menu[0] }, {
			ran: ['workbench.action.toggleSidebarVisibility'], id: 'workbench.action.toggleSidebarVisibility', enabled: true, same: true
		});
	});

	test('an entry under another name follows the entry it is', () => {
		const action = store.add(new Action('workbench.action.closeAuxiliaryBar', 'Hide Secondary Side Bar', undefined, false));
		const [shown] = baseHalfContextMenuActions([action]);
		const before = { label: shown.label, enabled: shown.enabled, isAction: shown instanceof Action };
		action.enabled = true;
		assert.deepStrictEqual({ before, enabled: shown.enabled }, { before: { label: 'Hide Agent Area', enabled: false, isAction: true }, enabled: true });
	});

	test('a menu of hidden commands only is empty, and one with none is itself', () => {
		const kept = [toAction({ id: 'one', label: 'One', run: () => { } }), new Separator(), toAction({ id: 'two', label: 'Two', run: () => { } })];
		const shown = baseHalfContextMenuActions(kept);
		assert.deepStrictEqual({
			gone: baseHalfContextMenuActions([toAction({ id: 'workbench.action.tasks.runTask', label: 'Run Task', run: () => { } }), new Separator()]),
			same: shown.length === kept.length && shown.every((action, index) => action === kept[index])
		}, { gone: [], same: true });
	});
});
