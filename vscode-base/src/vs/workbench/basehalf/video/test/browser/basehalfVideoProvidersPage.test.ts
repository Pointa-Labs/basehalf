/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { timeout } from '../../../../../base/common/async.js';
import { Emitter } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestDialogService } from '../../../../../platform/dialogs/test/common/testDialogService.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { BaseHalfVideoProviderSettingsService } from '../../browser/basehalfVideoProviderSettingsService.js';
import { BaseHalfVideoProvidersPage } from '../../browser/basehalfVideoProvidersPage.js';
import { BaseHalfVideoCatalogState, IBaseHalfVideoCatalog, IBaseHalfVideoCheckResult } from '../../common/basehalfVideoCatalog.js';
import { IBaseHalfVideoCatalogService } from '../../common/basehalfVideoGeneration.js';
import { TEST_VIDEO_CATALOG } from '../common/basehalfVideoCatalogFixture.js';
import { FakeProviderCommands, InMemoryCredentialStore } from './basehalfVideoTestFixtures.js';

/** A credential store whose writes wait until the test lets them end, to change the page while one is saved. */
class GatedCredentialStore extends InMemoryCredentialStore {
	gate: Promise<void> | undefined;
	override async set(key: string, value: string): Promise<void> {
		await this.gate;
		return super.set(key, value);
	}
}

class StaticCatalogService implements IBaseHalfVideoCatalogService {
	declare readonly _serviceBrand: undefined;
	readonly changed = new Emitter<void>();
	readonly onDidChange = this.changed.event;
	loads = 0;
	constructor(public state: BaseHalfVideoCatalogState) { }
	load(): void {
		this.loads++;
	}
	async whenReady(): Promise<IBaseHalfVideoCatalog> {
		if (this.state.kind === 'ready') {
			return this.state.catalog;
		}
		throw new Error('not ready');
	}
	async check(): Promise<IBaseHalfVideoCheckResult | undefined> {
		return undefined;
	}
}

suite('BaseHalfVideoProvidersPage', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const [acme, borealis] = TEST_VIDEO_CATALOG.providers;

	function createPage(state: BaseHalfVideoCatalogState = { kind: 'ready', catalog: TEST_VIDEO_CATALOG }, credentials = new InMemoryCredentialStore()) {
		const store = disposables.add(new DisposableStore());
		const providers = store.add(new BaseHalfVideoProviderSettingsService(store.add(new InMemoryStorageService()), credentials, new FakeProviderCommands(store.add(new FileService(new NullLogService()))), new NullLogService()));
		const catalog = new StaticCatalogService(state);
		store.add(catalog.changed);
		const opened: string[] = [];
		const opener = { open: async (target: URI | string) => { opened.push(target.toString()); return true; } } as Partial<IOpenerService> as IOpenerService;
		const page = store.add(new BaseHalfVideoProvidersPage(catalog, providers, new TestDialogService({ confirmed: true }), NullHoverService, opener));
		const container = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(container);
		store.add({ dispose: () => container.remove() });
		page.create(container);
		return { page, providers, credentials, catalog, container, opened };
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

	function credentialField(container: HTMLElement, id: string): HTMLElement {
		const field = descendants(container).find(element => element.dataset.credential === id);
		assert.ok(field, `no field of the credential ${id}`);
		return field;
	}

	function action(parent: HTMLElement, name: string): HTMLButtonElement {
		const button = descendants(parent).find((element): element is HTMLButtonElement => element.tagName === 'BUTTON' && element.dataset.action === name);
		assert.ok(button, `no ${name} button`);
		return button;
	}

	function rows(container: HTMLElement): string[] {
		return descendants(container).filter(element => element.dataset.provider && element.tagName === 'BUTTON')
			.map(row => `${row.dataset.provider}:${row.dataset.setUp === 'true' ? 'set up' : 'not set up'}${row.getAttribute('aria-current') === 'page' ? '*' : ''}`);
	}

	function endpoint(container: HTMLElement): HTMLInputElement {
		const field = inputs(container).find(element => element.dataset.focus === 'endpoint');
		assert.ok(field, 'no endpoint');
		return field;
	}

	/** The controls of the page, in order: the same elements after a change means nothing was drawn again. */
	function focusables(container: HTMLElement): HTMLElement[] {
		return descendants(container).filter(element => element.dataset.focus);
	}

	function focused(): string | undefined {
		const active = mainWindow.document.activeElement;
		return active instanceof mainWindow.HTMLElement ? active.dataset.focus : undefined;
	}

	function statusLine(container: HTMLElement): string | null {
		return descendants(container).find(element => element.getAttribute('role') === 'status')?.textContent ?? null;
	}

	async function settle(): Promise<void> {
		for (let index = 0; index < 5; index++) {
			await timeout(0);
		}
	}

	test('lists the catalog\'s providers in its order, and sets a credential without ever showing it again', async () => {
		const { providers, credentials, container } = createPage();
		const before = rows(container);
		const key = 'acme-secret-0123456789';
		const field = credentialField(container, 'apiKey');
		const keyInput = inputs(field).find(input => input.type === 'password')!;
		keyInput.value = key;
		action(field, 'set').click();
		await settle();
		assert.deepStrictEqual({
			before,
			after: rows(container),
			setUp: providers.getStatus(acme).setUp,
			stored: [...credentials.values.values()],
			inDom: container.outerHTML.includes(key) || inputs(container).some(element => element.value.includes(key)),
			passwordInputs: inputs(credentialField(container, 'apiKey')).filter(element => element.type === 'password').length,
			says: credentialField(container, 'apiKey').textContent?.includes('Set. It is encrypted on this computer and never shown.'),
			replace: !!action(credentialField(container, 'apiKey'), 'replace')
		}, {
			before: ['acme:not set up*', 'borealis:not set up'],
			after: ['acme:set up*', 'borealis:not set up'],
			setUp: true,
			stored: [JSON.stringify({ apiKey: key })],
			inDom: false,
			passwordInputs: 0,
			says: true,
			replace: true
		});
	});

	test('a provider with two credentials is set up once both are set', async () => {
		const { page, providers, container } = createPage();
		page.setInput('borealis');
		for (const [id, value] of [['accessKey', 'ak-1234'], ['secretKey', 'sk-5678']]) {
			const field = credentialField(container, id);
			inputs(field).find(input => input.type === 'password')!.value = value;
			action(field, 'set').click();
			await settle();
		}
		assert.deepStrictEqual({ rows: rows(container), status: providers.getStatus(borealis).setUp, regions: descendants(container).filter(element => element.dataset.region).length }, {
			rows: ['acme:not set up', 'borealis:set up*'],
			status: true,
			// One region: no choice to make.
			regions: 0
		});
	});

	test('chooses a region, keeps a relay\'s endpoint, refuses http on another computer, and links to the region\'s console', async () => {
		const { providers, container, opened } = createPage();
		const region = (id: string) => descendants(container).find(element => element.dataset.region === id) as HTMLButtonElement;
		const endpoint = () => inputs(container).find(element => element.dataset.focus === 'endpoint')!;
		const regions = descendants(container).filter(element => element.dataset.region).map(element => `${element.textContent}${element.getAttribute('aria-checked') === 'true' ? '*' : ''}`);
		const defaultEndpoint = endpoint().value;
		region('west').click();
		await settle();
		const west = { region: providers.getStatus(acme).region.id, endpoint: endpoint().value };
		endpoint().value = 'http://relay.example.com/v1';
		endpoint().dispatchEvent(new mainWindow.Event('change'));
		await settle();
		const refused = {
			errors: descendants(container).filter(element => element.getAttribute('role') === 'alert' && !element.hidden).map(element => element.textContent),
			typed: endpoint().value,
			invalid: endpoint().getAttribute('aria-invalid'),
			stored: providers.getStatus(acme).endpoint
		};
		endpoint().value = 'http://127.0.0.1:8123/api/v1/';
		endpoint().dispatchEvent(new mainWindow.Event('change'));
		await settle();
		const relay = { endpoint: providers.getStatus(acme).endpoint, custom: endpoint().dataset.custom };
		const console = descendants(container).find(element => element.tagName === 'A')!;
		console.click();
		assert.deepStrictEqual({ regions, defaultEndpoint, west, refused, relay, console: console.textContent, opened }, {
			regions: ['East · Acme CloudCNY*', 'West · Acme GlobalUSD'],
			defaultEndpoint: 'https://east.acme.example/api/v1',
			west: { region: 'west', endpoint: 'https://west.acme.example/api/v1' },
			refused: {
				errors: ['Use an address that starts with https://. An address with http:// is allowed only on this computer (localhost), because the credentials would travel unencrypted.'],
				typed: 'http://relay.example.com/v1',
				invalid: 'true',
				stored: 'https://west.acme.example/api/v1'
			},
			relay: { endpoint: 'http://127.0.0.1:8123/api/v1', custom: 'true' },
			console: 'Get credentials in the console of West · Acme Global',
			opened: ['https://console.acme.example/west']
		});
	});

	test('replaces and removes a credential after the confirmation', async () => {
		const { providers, credentials, container } = createPage();
		await providers.setCredential(acme, 'apiKey', 'acme-old');
		await settle();
		action(credentialField(container, 'apiKey'), 'replace').click();
		const replacing = inputs(credentialField(container, 'apiKey')).filter(input => input.type === 'password').length;
		inputs(credentialField(container, 'apiKey')).find(input => input.type === 'password')!.value = 'acme-new';
		action(credentialField(container, 'apiKey'), 'set').click();
		await settle();
		const replaced = credentials.values.get('basehalf.modelServices.video.acme.apiKey');
		action(credentialField(container, 'apiKey'), 'remove').click();
		await settle();
		assert.deepStrictEqual({ replacing, replaced, setUp: providers.getStatus(acme).setUp, secrets: credentials.values.size, rows: rows(container) }, {
			replacing: 1,
			replaced: JSON.stringify({ apiKey: 'acme-new' }),
			setUp: false,
			secrets: 0,
			rows: ['acme:not set up*', 'borealis:not set up']
		});
	});

	test('says when the providers are loading or could not be loaded, and asks for them again when it opens and with Try Again', async () => {
		const loading = createPage({ kind: 'loading' });
		const failed = createPage({ kind: 'failed', message: 'AI Video is not running.' });
		const retry = descendants(failed.container).find(element => element.dataset.focus === 'retry');
		retry?.click();
		assert.deepStrictEqual({
			loading: [loading.container.textContent?.includes('Loading the video providers…'), loading.catalog.loads, descendants(loading.container).some(element => element.dataset.focus === 'retry')],
			failed: [failed.container.textContent?.includes('BaseHalf could not load the video providers: AI Video is not running.'), retry?.textContent, failed.catalog.loads]
		}, { loading: [true, 1, false], failed: [true, 'Try Again', 2] });
		loading.catalog.state = { kind: 'ready', catalog: TEST_VIDEO_CATALOG };
		loading.catalog.changed.fire();
		assert.deepStrictEqual(rows(loading.container), ['acme:not set up*', 'borealis:not set up']);
	});

	test('keeps the focus on the control the user was on, or on the one that took its place', async () => {
		const { container } = createPage();
		const region = (id: string) => descendants(container).find(element => element.dataset.region === id) as HTMLButtonElement;
		region('east').focus();
		region('east').dispatchEvent(new mainWindow.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		await settle();
		const afterRegion = focused();
		inputs(credentialField(container, 'apiKey')).find(input => input.type === 'password')!.value = 'acme-secret';
		action(credentialField(container, 'apiKey'), 'set').focus();
		action(credentialField(container, 'apiKey'), 'set').click();
		await settle();
		const afterSet = focused();
		action(credentialField(container, 'apiKey'), 'remove').focus();
		action(credentialField(container, 'apiKey'), 'remove').click();
		await settle();
		assert.deepStrictEqual({ afterRegion, afterSet, afterRemove: focused() }, {
			afterRegion: 'region:west',
			afterSet: 'credential:apiKey:replace',
			afterRemove: 'credential:apiKey:input'
		});
	});

	test('saves an endpoint in place, so the rest of the page stays as drawn and a click that left the field still lands', async () => {
		const { providers, container } = createPage();
		const before = focusables(container);
		const field = endpoint(container);
		field.value = 'https://relay.example.com/v1/';
		field.dispatchEvent(new mainWindow.Event('change'));
		await settle();
		const after = focusables(container);
		assert.deepStrictEqual({
			drawnAgain: after.length !== before.length || after.some((element, index) => element !== before[index]),
			shown: field.value,
			custom: field.dataset.custom,
			stored: providers.getStatus(acme).endpoint,
			status: statusLine(container)
		}, {
			drawnAgain: false,
			shown: 'https://relay.example.com/v1',
			custom: 'true',
			stored: 'https://relay.example.com/v1',
			status: 'Saved.'
		});
	});

	test('saves an endpoint typed and not left when the page closes, and keeps nothing it cannot take', async () => {
		const { page, providers, container } = createPage();
		endpoint(container).value = 'https://relay.example.com/v1/';
		page.setVisible(false);
		await settle();
		const saved = providers.getStatus(acme).endpoint;
		page.setVisible(true);
		endpoint(container).value = 'http://relay.example.com/v1';
		page.setVisible(false);
		await settle();
		assert.deepStrictEqual({ saved, after: providers.getStatus(acme).endpoint }, {
			saved: 'https://relay.example.com/v1',
			after: 'https://relay.example.com/v1'
		});
	});

	test('draws nothing again when only the last model used changes', async () => {
		const { providers, container } = createPage();
		const before = focusables(container);
		providers.setLastUsed({ provider: 'acme', model: 'acme-motion-2', mode: 'frames', params: {} });
		await settle();
		const after = focusables(container);
		assert.strictEqual(after.length === before.length && after.every((element, index) => element === before[index]), true);
	});

	test('a change that fails after another provider is shown leaves that provider\'s fields alone', async () => {
		const credentials = new GatedCredentialStore();
		let fail: (error: Error) => void = () => { };
		credentials.gate = new Promise<void>((_, reject) => fail = reject);
		const { container } = createPage(undefined, credentials);
		inputs(credentialField(container, 'apiKey')).find(input => input.type === 'password')!.value = 'acme-secret';
		action(credentialField(container, 'apiKey'), 'set').click();
		await settle();
		(descendants(container).find(element => element.tagName === 'BUTTON' && element.dataset.provider === 'borealis') as HTMLButtonElement).click();
		await settle();
		fail(new Error('The keychain is locked.'));
		await settle();
		assert.deepStrictEqual({
			rows: rows(container),
			typed: inputs(container).map(input => input.type === 'password' ? input.value : undefined).filter(value => value !== undefined),
			errors: descendants(container).filter(element => element.getAttribute('role') === 'alert' && !element.hidden).length,
			status: statusLine(container)
		}, {
			rows: ['acme:not set up', 'borealis:not set up*'],
			typed: ['', ''],
			errors: 0,
			status: 'Acme Video: BaseHalf could not save this change: The keychain is locked.'
		});
	});

	test('two pages, as in two editor groups, have ids of their own', () => {
		const ids = [createPage().container, createPage().container].flatMap(container => descendants(container).map(element => element.id).filter(id => id));
		assert.deepStrictEqual(ids.filter((id, index) => ids.indexOf(id) !== index), []);
	});

	test('Enter that an input method uses to choose its text does not leave the endpoint', async () => {
		const { providers, container } = createPage();
		const field = endpoint(container);
		field.focus();
		field.value = 'https://relay.example.com/v1';
		field.dispatchEvent(new mainWindow.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
		await settle();
		assert.deepStrictEqual({ focused: focused(), stored: providers.getStatus(acme).endpoint }, { focused: 'endpoint', stored: 'https://east.acme.example/api/v1' });
	});
});
