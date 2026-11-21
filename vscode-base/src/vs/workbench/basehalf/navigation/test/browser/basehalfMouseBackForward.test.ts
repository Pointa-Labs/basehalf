/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { EditorService } from '../../../../services/editor/browser/editorService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { HistoryService } from '../../../../services/history/browser/historyService.js';
import { IWorkbenchLayoutService } from '../../../../services/layout/browser/layoutService.js';
import { createEditorPart, workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';

suite('BaseHalf: the back and forward buttons of a mouse', function () {

	const disposables = new DisposableStore();

	teardown(() => {
		disposables.clear();
	});

	/** The commands that the buttons run, and the window's container that hears the mouse. */
	async function createWindow(mouseNavigates: boolean): Promise<{ readonly commands: string[]; readonly container: HTMLElement; readonly configurationService: TestConfigurationService }> {
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		const part = await createEditorPart(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, part);
		instantiationService.stub(IEditorService, disposables.add(instantiationService.createInstance(EditorService, undefined)));
		const configurationService = new TestConfigurationService();
		await configurationService.setUserConfiguration('workbench.editor.mouseBackForwardToNavigate', mouseNavigates);
		instantiationService.stub(IConfigurationService, configurationService);
		const commands: string[] = [];
		instantiationService.stub(ICommandService, new class extends mock<ICommandService>() {
			override async executeCommand<T>(id: string): Promise<T | undefined> {
				commands.push(id);
				return undefined;
			}
		});
		disposables.add(instantiationService.createInstance(HistoryService));
		return { commands, container: instantiationService.get(IWorkbenchLayoutService).mainContainer, configurationService };
	}

	function press(container: HTMLElement, button: number): { readonly down: boolean; readonly up: boolean } {
		// From an element inside the window, as a card or a page's element is.
		const target = container.appendChild(document.createElement('div'));
		try {
			const down = new MouseEvent('mousedown', { button, bubbles: true, cancelable: true });
			const up = new MouseEvent('mouseup', { button, bubbles: true, cancelable: true });
			target.dispatchEvent(down);
			target.dispatchEvent(up);
			return { down: down.defaultPrevented, up: up.defaultPrevented };
		} finally {
			target.remove();
		}
	}

	test('each button runs its command once, when it goes down, and other buttons run none', async () => {
		const { commands, container } = await createWindow(true);
		const primary = press(container, 0);
		const back = press(container, 3);
		const forward = press(container, 4);
		assert.deepStrictEqual({ commands, primary, back, forward }, {
			commands: ['workbench.action.navigateBack', 'workbench.action.navigateForward'],
			primary: { down: false, up: false },
			// The window takes both events of a button it acts on, so nothing else acts on them.
			back: { down: true, up: true },
			forward: { down: true, up: true }
		});
	});

	test('with the setting off the buttons run nothing', async () => {
		const { commands, container } = await createWindow(false);
		const back = press(container, 3);
		const forward = press(container, 4);
		assert.deepStrictEqual({ commands, back, forward }, {
			commands: [],
			back: { down: false, up: false },
			forward: { down: false, up: false }
		});
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
