/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	baseHalfKindInputKinds,
	baseHalfKindNamesModes,
	BaseHalfModelKind,
	BaseHalfVideoCatalogState,
	baseHalfVideoModelAbilities,
	findBaseHalfVideoRegion,
	IBaseHalfVideoCatalog,
	IBaseHalfVideoCatalogModel,
	IBaseHalfVideoCatalogProvider,
	IBaseHalfVideoCheckResult,
	IBaseHalfVideoGenerationChoice,
	IBaseHalfVideoInputSource
} from '../../common/basehalfVideoCatalog.js';
import { createBaseHalfGenerationRecordPresentation } from '../../common/basehalfGenerationRecordPresentation.js';
import { baseHalfReferenceMenuRows } from '../../common/basehalfGenerationReferenceMenu.js';
import { BaseHalfVideoPanelControl, createBaseHalfVideoPanelPresentation, IBaseHalfVideoPanelPresentation } from '../../common/basehalfVideoNodePanelPresentation.js';
import { CORVID_PAINT, TEST_AUDIO_CATALOG } from './basehalfVideoCatalogFixture.js';

/** An image model that makes up to 15 images in one generation, as some do. */
const QUILL_WIDE: IBaseHalfVideoCatalogModel = {
	...CORVID_PAINT,
	id: 'quill-wide',
	label: 'Quill Wide',
	providerModels: { west: 'wide-1' },
	parameters: [
		{ name: 'resolution', label: 'Resolution', kind: 'choice', options: [{ value: '2k', label: '2K' }, { value: '4k', label: '4K' }], default: '2k' },
		{ name: 'count', label: 'Images', kind: 'integer', min: 1, max: 15, step: 1, default: 1 }
	]
};

const QUILL: IBaseHalfVideoCatalogProvider = {
	id: 'quill',
	label: 'Quill',
	regions: [{ id: 'west', label: 'West', baseUrl: 'https://west.quill.example' }],
	credentials: [{ id: 'apiKey', label: 'API Key' }],
	models: [QUILL_WIDE]
};

/** Video models with several modes, image models with the one mode References, and audio models that make speech, songs, and sounds. */
const CATALOG: IBaseHalfVideoCatalog = { ...TEST_AUDIO_CATALOG, providers: [...TEST_AUDIO_CATALOG.providers, QUILL] };
const READY: BaseHalfVideoCatalogState = { kind: 'ready', catalog: CATALOG };

function present(kind: BaseHalfModelKind, generation: IBaseHalfVideoGenerationChoice, inputs: readonly IBaseHalfVideoInputSource[] = []): IBaseHalfVideoPanelPresentation {
	return createBaseHalfVideoPanelPresentation({
		info: { prompt: 'A lighthouse at dusk.', ...generation },
		kind,
		inputs,
		catalog: READY,
		setup: provider => ({ region: findBaseHalfVideoRegion(provider, undefined), setUp: true }),
		generating: false,
		prompt: 'A lighthouse at dusk.'
	});
}

function count(presentation: IBaseHalfVideoPanelPresentation): string | undefined {
	const control: BaseHalfVideoPanelControl | undefined = presentation.settingsView?.controls.find(candidate => candidate.name === 'count');
	return control && control.kind === 'buttons'
		? `buttons ${control.choices.map(choice => `${choice.label}${choice.selected ? '*' : ''}`).join(' ')}${control.columns ? ` in rows of ${control.columns}` : ''}`
		: control?.kind;
}

suite('BaseHalf generation cards: the parts a kind shows (D90)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('a kind whose models all have the same one mode names none, and a kind takes the inputs some model of it takes', () => {
		assert.deepStrictEqual({
			names: (['image', 'video', 'audio'] as const).map(kind => baseHalfKindNamesModes(CATALOG, kind)),
			unknown: baseHalfKindNamesModes(undefined, 'image'),
			inputs: (['image', 'video', 'audio'] as const).map(kind => baseHalfKindInputKinds(CATALOG, kind).join(' ')),
			withoutModels: baseHalfKindInputKinds({ schema: 1, providers: [] }, 'image').join(' ')
		}, {
			names: [false, true, true],
			unknown: true,
			inputs: ['image text', 'image video audio text', 'image audio text'],
			withoutModels: 'image video audio text'
		});
	});

	test('an image card names no mode in its summary, in why an input is not used, and in the panel of a card it made, while a video card does', () => {
		const image = present('image', { provider: 'corvid', model: 'corvid-paint', mode: 'reference', params: { resolution: '2k', count: 3 } }, [
			{ path: 'a.png', kind: 'image', available: true },
			{ path: 'move.mp4', kind: 'video', available: true }
		]);
		const video = present('video', { provider: 'acme', model: 'acme-motion-2', mode: 'frames', params: { resolution: '720p', duration: 5, sound: true } });
		const record = createBaseHalfGenerationRecordPresentation({
			kind: 'image',
			made: { id: 'g1', startedAt: '2026-10-27T05:00:00.000Z', finishedAt: '2026-10-27T05:00:09.000Z', provider: 'corvid', region: 'north', model: 'corvid-paint', providerModel: 'paint-n-1', mode: 'reference', params: { resolution: '2k', count: 4 }, prompt: 'A lighthouse at dusk.', inputs: [], output: 1, outputs: 4 },
			inputs: [],
			catalog: READY
		});
		assert.deepStrictEqual({
			image: image.settingsView?.summary,
			unused: image.inputRow?.items.map(item => item.reason ?? item.use),
			video: video.settingsView?.summary,
			record: [record.line, record.settings]
		}, {
			image: '2K · Images 3',
			unused: ['reference', 'Not used: Corvid Paint takes no videos.'],
			video: 'Frames · 720p · 5s · Sound',
			record: ['Image 1 of 4', '2K · Images 4']
		});
	});

	test('a count is a button for each number from 1 to as many as the model makes, in one row up to six and in rows of five beyond (D91)', () => {
		const wide = (params: Record<string, number | string>) => present('image', { provider: 'quill', model: 'quill-wide', mode: 'reference', params });
		assert.deepStrictEqual({
			wide: count(wide({ count: 2 })),
			agent: count(wide({ count: 8 })),
			two: count(present('image', { provider: 'corvid', model: 'corvid-print', mode: 'reference', params: {} })),
			songs: count(present('audio', { provider: 'dunlin', model: 'dunlin-song', mode: 'reference', params: { count: 2 } })),
			menu: baseHalfVideoModelAbilities(QUILL_WIDE)
		}, {
			wide: 'buttons 1 2* 3 4 5 6 7 8 9 10 11 12 13 14 15 in rows of 5',
			agent: 'buttons 1 2 3 4 5 6 7 8* 9 10 11 12 13 14 15 in rows of 5',
			two: 'buttons 1* 2',
			songs: 'buttons 1 2* 3',
			menu: '4K · Up to 15 images · 4 references'
		});
	});

	test('a count of six is one row, and a count the inputs narrow dims the numbers beyond its range with the reason (D70, D91)', () => {
		const six: IBaseHalfVideoCatalogModel = { ...QUILL_WIDE, id: 'quill-six', parameters: [{ name: 'count', label: 'Images', kind: 'integer', min: 1, max: 6, step: 1, default: 1 }] };
		const catalog: IBaseHalfVideoCatalog = { ...CATALOG, providers: [...CATALOG.providers, { ...QUILL, id: 'quill-six', models: [six] }] };
		const presentWith = (provider: string, model: string, check?: IBaseHalfVideoCheckResult) => createBaseHalfVideoPanelPresentation({
			info: { prompt: 'A lighthouse at dusk.', provider, model, mode: 'reference', params: { count: 3 } },
			kind: 'image',
			inputs: [{ path: 'a.png', kind: 'image', available: true }],
			catalog: { kind: 'ready', catalog },
			setup: candidate => ({ region: findBaseHalfVideoRegion(candidate, undefined), setUp: true }),
			...(check ? { check } : {}),
			generating: false,
			prompt: 'A lighthouse at dusk.'
		});
		const reason = 'References and images together are at most 5.';
		const narrowed = presentWith('quill', 'quill-wide', { problems: [], prompt: 'A lighthouse at dusk.', limits: { count: { max: 4, reason } } });
		const control = narrowed.settingsView?.controls.find(candidate => candidate.name === 'count');
		assert.deepStrictEqual({
			six: count(presentWith('quill-six', 'quill-six')),
			narrowed: control?.kind === 'buttons' ? control.choices.map(choice => choice.disabled === reason ? `(${choice.label})` : choice.label).join(' ') : control?.kind,
			note: control?.limit
		}, {
			six: 'buttons 1 2 3* 4 5 6',
			narrowed: '1 2 3 4 (5) (6) (7) (8) (9) (10) (11) (12) (13) (14) (15)',
			note: `Up to 4. ${reason}`
		});
	});

	test('the reference menu lists the kinds the card takes, and with nothing to list names them', () => {
		const lists = (kinds: readonly ('image' | 'video' | 'audio' | 'text')[]) => kinds.map(kind => ({ kind, items: [] }));
		const rows = (kinds: readonly ('image' | 'video' | 'audio' | 'text')[]) => baseHalfReferenceMenuRows({ connected: [], canvas: lists(kinds) }, '').map(row => row.type === 'empty' ? row.text : row.type);
		assert.deepStrictEqual({
			image: rows(baseHalfKindInputKinds(CATALOG, 'image')),
			audio: rows(baseHalfKindInputKinds(CATALOG, 'audio')),
			video: rows(baseHalfKindInputKinds(CATALOG, 'video')),
			unread: rows([]),
			listed: baseHalfReferenceMenuRows({
				connected: [],
				canvas: [{ kind: 'image', items: [{ path: 'a.png', kind: 'image', title: 'a.png' }] }, { kind: 'text', items: [] }]
			}, '').map(row => row.type === 'kind' ? row.text : row.type)
		}, {
			image: ['Connect an image or a note, or add one to this canvas.'],
			audio: ['Connect an image, audio, or a note, or add one to this canvas.'],
			video: ['Connect an image, a video, audio, or a note, or add one to this canvas.'],
			unread: ['Connect an image, a video, audio, or a note, or add one to this canvas.'],
			listed: ['header', 'Images', 'Notes']
		});
	});
});
