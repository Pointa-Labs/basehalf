/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IContextMenuDelegate } from '../../../../base/browser/contextmenu.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { IAction } from '../../../../base/common/actions.js';
import { timeout } from '../../../../base/common/async.js';
import { Event } from '../../../../base/common/event.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IContextMenuMenuDelegate, IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { TestDialogService } from '../../../../platform/dialogs/test/common/testDialogService.js';
import { FileService } from '../../../../platform/files/common/fileService.js';
import { NullHoverService } from '../../../../platform/hover/test/browser/nullHoverService.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { InMemoryStorageService } from '../../../../platform/storage/common/storage.js';
import { BaseHalfVideoChannelService } from '../../browser/basehalfVideoChannelService.js';
import { BaseHalfVideoProvidersPage } from '../../browser/basehalfVideoProvidersPage.js';
import { FakeProviderCommands, InMemoryCredentialStore } from './basehalfVideoTestFixtures.js';

class CapturingContextMenuService implements IContextMenuService {
	declare readonly _serviceBrand: undefined;
	readonly onDidShowContextMenu = Event.None;
	readonly onDidHideContextMenu = Event.None;
	actions: readonly IAction[] = [];

	showContextMenu(delegate: IContextMenuDelegate | IContextMenuMenuDelegate): void {
		this.actions = (delegate as IContextMenuDelegate).getActions?.() ?? [];
	}
}

suite('BaseHalfVideoProvidersPage', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	function createPage() {
		const store = disposables.add(new DisposableStore());
		const credentials = new InMemoryCredentialStore();
		const channels = store.add(new BaseHalfVideoChannelService(store.add(new InMemoryStorageService()), credentials, new FakeProviderCommands(store.add(new FileService(new NullLogService())))));
		const menu = new CapturingContextMenuService();
		const page = store.add(new BaseHalfVideoProvidersPage(channels, menu, new TestDialogService({ confirmed: true }), NullHoverService));
		const container = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(container);
		store.add({ dispose: () => container.remove() });
		page.create(container);
		return { page, channels, credentials, menu, container };
	}

	/** Every element under `root`, found by walking the tree the page built. */
	function descendants(root: Element): HTMLElement[] {
		const found: HTMLElement[] = [];
		const visit = (element: Element) => {
			for (const child of element.children) {
				found.push(child as HTMLElement);
				visit(child);
			}
		};
		visit(root);
		return found;
	}

	function inputs(container: HTMLElement): HTMLInputElement[] {
		return descendants(container).filter((element): element is HTMLInputElement => element.tagName === 'INPUT');
	}

	function buttonLabelled(container: HTMLElement, label: string): HTMLButtonElement {
		const button = descendants(container).find((element): element is HTMLButtonElement => element.tagName === 'BUTTON' && (element.textContent === label || element.getAttribute('aria-label') === label));
		assert.ok(button, `no button '${label}'`);
		return button;
	}

	function input(container: HTMLElement, kind: 'password' | 'model'): HTMLInputElement {
		const found = kind === 'password' ? inputs(container).find(candidate => candidate.type === 'password') : inputs(container).find(candidate => candidate.placeholder.startsWith('Add a model id'));
		assert.ok(found, `no ${kind} input`);
		return found;
	}

	async function settle(): Promise<void> {
		for (let index = 0; index < 5; index++) {
			await timeout(0);
		}
	}

	test('adds a provider from the menu, sets its key without ever showing it, and edits its models', async () => {
		const { channels, credentials, menu, container } = createPage();
		assert.ok(container.textContent?.includes('No providers yet.'));

		buttonLabelled(container, 'Add Provider…').click();
		assert.deepStrictEqual(menu.actions.map(action => action.label), ['Volcengine Ark', 'BytePlus ModelArk', 'Alibaba Cloud Model Studio', 'MiniMax', 'Google Gemini', 'OpenAI Compatible']);
		await menu.actions[0].run();
		await settle();
		const channel = channels.getChannels()[0];
		assert.deepStrictEqual({ name: channel.name, hasKey: channel.hasKey }, { name: 'Volcengine Ark', hasKey: false });
		assert.ok(container.textContent?.includes('Seedance 2.5'));

		const key = 'ark-secret-0123456789';
		const keyInput = input(container, 'password');
		keyInput.value = key;
		buttonLabelled(container, 'Set Key').click();
		await settle();
		assert.deepStrictEqual({
			hasKey: channels.getChannel(channel.id)?.hasKey,
			stored: [...credentials.values.values()],
			inDom: container.outerHTML.includes(key) || inputs(container).some(element => element.value.includes(key)),
			passwordInputs: inputs(container).filter(element => element.type === 'password').length,
			says: container.textContent?.includes('A key is set.')
		}, { hasKey: true, stored: [key], inDom: false, passwordInputs: 0, says: true });

		const modelInput = input(container, 'model');
		modelInput.value = ' my-relay-model ';
		modelInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
		await settle();
		assert.deepStrictEqual(channels.getChannel(channel.id)?.models, ['doubao-seedance-2-5-260628', 'my-relay-model']);
		buttonLabelled(container, 'Remove Seedance 2.5').click();
		await settle();
		assert.deepStrictEqual(channels.getChannel(channel.id)?.models, ['my-relay-model']);
	});

	test('shows why an endpoint is refused and keeps the saved one', async () => {
		const { channels, container } = createPage();
		const channel = await channels.addChannel('openai');
		await settle();
		const endpoint = inputs(container).find(element => element.type === 'url');
		assert.ok(endpoint);
		endpoint.value = 'http://relay.example.com/v1';
		endpoint.dispatchEvent(new mainWindow.Event('change'));
		await settle();
		const errors = descendants(container).filter(element => element.getAttribute('role') === 'alert' && !element.hidden).map(element => element.textContent);
		const shownEndpoint = inputs(container).find(element => element.type === 'url');
		assert.deepStrictEqual({
			baseUrl: channels.getChannel(channel.id)?.baseUrl,
			errors,
			typed: shownEndpoint?.value,
			invalid: shownEndpoint?.getAttribute('aria-invalid')
		}, {
			baseUrl: 'https://api.openai.com/v1',
			errors: ['Use an address that starts with https://. An address with http:// is allowed only on this computer (localhost), because the key would travel unencrypted.'],
			typed: 'http://relay.example.com/v1',
			invalid: 'true'
		});
	});

	test('removes a provider and its key after the confirmation', async () => {
		const { channels, credentials, container } = createPage();
		const channel = await channels.addChannel('minimax');
		await channels.setKey(channel.id, 'minimax-key');
		await settle();
		buttonLabelled(container, 'Remove Provider').click();
		await settle();
		assert.deepStrictEqual({ channels: channels.getChannels().length, credentials: credentials.values.size, empty: container.textContent?.includes('No providers yet.') }, { channels: 0, credentials: 0, empty: true });
	});
});
