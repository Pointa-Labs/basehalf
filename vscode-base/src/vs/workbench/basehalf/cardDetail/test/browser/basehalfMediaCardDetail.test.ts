/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { timeout } from '../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { VoicesResult } from '../../../../../platform/basehalfProviders/common/basehalfProviderTypes.js';
import { IFileService, IFileStatWithPartialMetadata } from '../../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { TestNotificationService } from '../../../../../platform/notification/test/common/testNotificationService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IWebviewService } from '../../../../contrib/webview/browser/webview.js';
import { BaseHalfMediaCardDetail } from '../../browser/basehalfMediaCardDetail.js';
import { IBaseHalfDocumentCoverService } from '../../../documents/browser/basehalfDocumentCovers.js';
import { IBaseHalfGenerationMade } from '../../../video/common/basehalfGenerationInfo.js';
import { IBaseHalfGenerationVoiceService, IBaseHalfVoices } from '../../../video/common/basehalfGenerationVoices.js';
import { IBaseHalfVideoCatalogModel, IBaseHalfVideoCatalogProvider } from '../../../video/common/basehalfVideoCatalog.js';
import { IBaseHalfGenerationCardSnapshot, IBaseHalfGenerationCardStore, IBaseHalfVideoCatalogService } from '../../../video/common/basehalfVideoGeneration.js';
import { TEST_AUDIO_CATALOG } from '../../../video/test/common/basehalfVideoCatalogFixture.js';

const WORKSPACE = URI.file('/workspace');
const SOUND = URI.joinPath(WORKSPACE, 'shots', 'speech.mp3');

/** What made a sound of Dunlin Voice, in a voice of the user's account that the catalog does not declare (D78). */
const SPOKEN: IBaseHalfGenerationMade = {
	id: '20261025T080500-50e6a1b3',
	startedAt: '2026-10-25T08:05:00.000Z',
	finishedAt: '2026-10-25T08:05:04.000Z',
	provider: 'dunlin',
	region: 'main',
	model: 'dunlin-voice',
	providerModel: 'voice-1',
	mode: 'reference',
	params: { voice: 'narrator-7', speed: 1 },
	prompt: 'Welcome to the coast.',
	inputs: []
};

suite('BaseHalfMediaCardDetail', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let instantiationService: TestInstantiationService;
	let made: IBaseHalfGenerationMade;
	/** The provider's last lists of voices, by provider and region. */
	let lists: Map<string, VoicesResult>;
	let listed: Emitter<void>;
	/** What Card Detail had the window ask for once, to name a voice only a list names, each once. */
	let askedOnce: Set<string>;
	let mounted: HTMLElement[];

	setup(() => {
		instantiationService = disposables.add(new TestInstantiationService());
		made = SPOKEN;
		lists = new Map();
		listed = disposables.add(new Emitter<void>());
		askedOnce = new Set();
		mounted = [];
		instantiationService.stub(IFileService, { stat: async (resource: URI) => ({ resource, name: 'speech.mp3', isFile: true, isDirectory: false, isSymbolicLink: false }) as IFileStatWithPartialMetadata, onDidFilesChange: Event.None });
		instantiationService.stub(IBaseHalfGenerationCardStore, {
			onDidChange: Event.None,
			isGenerationCard: async () => true,
			read: async (): Promise<IBaseHalfGenerationCardSnapshot> => ({ resource: SOUND, path: 'shots/speech.mp3', kind: 'audio', hasFile: true, info: { prompt: '' }, infoReadable: true, made, upstream: [] })
		});
		instantiationService.stub(IBaseHalfVideoCatalogService, { whenReady: async () => TEST_AUDIO_CATALOG });
		instantiationService.stub(IBaseHalfGenerationVoiceService, {
			onDidChangeVoices: listed.event,
			voices: (provider: string, region: string): IBaseHalfVoices => {
				const list = lists.get(`${provider}/${region}`);
				return { loading: false, ...(list ? { list } : {}) };
			},
			askOnce: async (provider: IBaseHalfVideoCatalogProvider, model: IBaseHalfVideoCatalogModel, region: string) => {
				askedOnce.add(`${provider.id}/${region}/${model.id}`);
			}
		});
		// A sound plays in BaseHalf's player: no page of its own, nothing kept of a PDF's view, no link, and no cover (D81).
		instantiationService.stub(IWebviewService, {});
		instantiationService.stub(IStorageService, {});
		instantiationService.stub(IOpenerService, {});
		instantiationService.stub(IBaseHalfDocumentCoverService, {});
		instantiationService.set(INotificationService, new TestNotificationService());
		instantiationService.set(ILogService, new NullLogService());
		instantiationService.set(IHoverService, NullHoverService);
	});

	teardown(() => {
		for (const element of mounted) {
			element.remove();
		}
	});

	/** Opens Card Detail on the sound; what made it shows below its player. */
	async function openSound(): Promise<HTMLElement> {
		const container = mainWindow.document.createElement('div');
		mainWindow.document.body.append(container);
		mounted.push(container);
		const detail = disposables.add(instantiationService.createInstance(BaseHalfMediaCardDetail, container, async () => { }, () => { }, () => { }, () => { }, undefined));
		void detail.open({ resource: SOUND, workspaceFolder: WORKSPACE, relativePath: 'shots/speech.mp3', source: 'explorer', projection: 'media' });
		await settle();
		return container;
	}

	async function settle(): Promise<void> {
		for (let i = 0; i < 4; i++) {
			await timeout(1);
		}
	}

	/** The Settings row of what made the file. */
	function settingsOf(container: HTMLElement): string | null | undefined {
		return [...container.querySelectorAll('.bh-generation-provenance-rows > dt')].find(term => term.textContent === 'Settings')?.nextElementSibling?.textContent;
	}

	test('names a voice of the account as the provider\'s last list names it once it comes, which it has the window ask for once; a voice of the catalog asks nothing (D78)', async () => {
		const container = await openSound();
		const byId = { settings: settingsOf(container), asked: [...askedOnce] };
		lists.set('dunlin/main', { voices: [{ id: 'narrator-7', label: 'My Narrator', own: true }] });
		listed.fire();
		await settle();
		const byList = settingsOf(container);
		askedOnce.clear();
		made = { ...SPOKEN, params: { voice: 'vx-pike', speed: 1 } };
		const ofCatalog = await openSound();
		assert.deepStrictEqual({ byId, byList, ofCatalog: { settings: settingsOf(ofCatalog), asked: [...askedOnce] } }, {
			byId: { settings: 'Voice narrator-7 · Speed 1', asked: ['dunlin/main/dunlin-voice'] },
			byList: 'Voice My Narrator · Speed 1',
			ofCatalog: { settings: 'Voice Pike · Speed 1', asked: [] }
		});
	});
});
