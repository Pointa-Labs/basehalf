/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	BaseHalfVideoCatalogState,
	BaseHalfVideoGenerateBlocker,
	baseHalfVideoChangeParam,
	baseHalfVideoChooseMode,
	baseHalfVideoChooseModel,
	baseHalfVideoEstimateTooltip,
	baseHalfVideoGenerateBlockerText,
	baseHalfVideoInitialGeneration,
	baseHalfVideoInputKindOfPath,
	baseHalfVideoListedModels,
	baseHalfVideoModeOf,
	baseHalfVideoNumberSteps,
	baseHalfVideoNumberValues,
	baseHalfVideoPlannedCounts,
	baseHalfVideoSettingsSummary,
	buildBaseHalfVideoPrompt,
	findBaseHalfVideoLabelTokens,
	findBaseHalfVideoModel,
	findBaseHalfVideoRegion,
	formatBaseHalfVideoEstimate,
	getBaseHalfVideoGenerateBlocker,
	IBaseHalfVideoCatalogProvider,
	IBaseHalfVideoGenerateBlockerInput,
	IBaseHalfVideoInputPlanItem,
	IBaseHalfVideoInputSource,
	IBaseHalfVideoNumberParameter,
	isBaseHalfVideoModelBlocker,
	normalizeBaseHalfVideoParams,
	parseBaseHalfVideoCatalog,
	parseBaseHalfVideoCheckResult,
	planBaseHalfVideoInputs,
	stripBaseHalfMarkdownFrontMatter
} from '../../common/basehalfVideoCatalog.js';
import { ACME, ACME_MOTION, BOREALIS, TEST_VIDEO_CATALOG, testVideoModel } from './basehalfVideoCatalogFixture.js';

suite('BaseHalfVideoCatalog', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const motion = testVideoModel('acme', 'acme-motion-2');
	const still = testVideoModel('acme', 'acme-still');
	const clip = testVideoModel('acme', 'acme-clip');
	const borealisOne = testVideoModel('borealis', 'borealis-one');

	/** Three images, a video, a text note, and a PDF, connected in that order (video node, acceptance criterion 3). */
	const sources: IBaseHalfVideoInputSource[] = [
		{ path: 'frames/a.png', kind: 'image', available: true },
		{ path: 'frames/b.png', kind: 'image', available: true },
		{ path: 'frames/c.png', kind: 'image', available: true },
		{ path: 'clips/move.mp4', kind: 'video', available: true },
		{ path: 'notes/scene.md', kind: 'text', available: true },
		{ path: 'docs/brief.pdf', kind: 'other', available: true }
	];

	function uses(plan: readonly IBaseHalfVideoInputPlanItem[]): string[] {
		return plan.map(item => `${item.path}:${item.use}${item.reason ? `(${item.reason})` : ''}${item.label ? `=${item.label}` : ''}`);
	}

	test('reads the catalog AI Video answers, leaves out what is not well formed and says what, and refuses what is no catalog', () => {
		const broken = parseBaseHalfVideoCatalog({
			schema: 1,
			providers: [
				{ ...ACME, models: [ACME_MOTION, { ...ACME_MOTION, id: 'no-modes', modes: [] }, { ...ACME_MOTION, id: 'acme-motion-2' }], extra: 'ignored' },
				{ ...BOREALIS, id: 'Borealis Media' },
				{ ...ACME, id: 'acme-two', regions: [] }
			]
		});
		assert.deepStrictEqual({
			providers: broken.catalog.providers.map(provider => `${provider.id}: ${provider.models.map(model => model.id).join(', ')}`),
			problems: broken.problems,
			frozen: Object.isFrozen(broken.catalog.providers[0].models[0].parameters[0]),
			kept: Object.keys(broken.catalog.providers[0]).sort()
		}, {
			providers: ['acme: acme-motion-2'],
			problems: [
				'providers[0].models[1].modes must list at least one mode, each once.',
				'providers[0].models[2].id \'acme-motion-2\' is listed twice.',
				'providers[1].id \'Borealis Media\' must be lowercase letters, digits, and hyphens.',
				'providers[2].regions must list at least one region, each once.'
			],
			frozen: true,
			kept: ['credentials', 'id', 'label', 'models', 'regions']
		});
		assert.throws(() => parseBaseHalfVideoCatalog({ schema: 2, providers: [] }), /not in the form this BaseHalf reads/);
		assert.throws(() => parseBaseHalfVideoCatalog(undefined), /not in the form this BaseHalf reads/);
		assert.deepStrictEqual(TEST_VIDEO_CATALOG.providers.map(provider => provider.models.length), [4, 1]);
	});

	test('finds providers, models, regions, and modes, and lists deprecated models only for a node that uses one', () => {
		const ref = findBaseHalfVideoModel(TEST_VIDEO_CATALOG, 'acme', 'acme-still');
		const listed = (generation: { provider?: string; model?: string } | undefined) => baseHalfVideoListedModels(TEST_VIDEO_CATALOG.providers[0], generation).map(model => model.id);
		assert.deepStrictEqual({
			found: ref ? `${ref.provider.label} / ${ref.model.label}` : undefined,
			otherProvider: findBaseHalfVideoModel(TEST_VIDEO_CATALOG, 'borealis', 'acme-still'),
			noProvider: findBaseHalfVideoModel(TEST_VIDEO_CATALOG, undefined, 'acme-still'),
			region: findBaseHalfVideoRegion(TEST_VIDEO_CATALOG.providers[0], 'west').currency,
			firstRegion: findBaseHalfVideoRegion(TEST_VIDEO_CATALOG.providers[0], 'north').id,
			mode: baseHalfVideoModeOf(motion, 'reference').id,
			firstMode: baseHalfVideoModeOf(motion, 'edit').id,
			listed: listed(undefined),
			listedForLegacy: listed({ provider: 'acme', model: 'acme-legacy' })
		}, {
			found: 'Acme Video / Acme Still',
			otherProvider: undefined,
			noProvider: undefined,
			region: 'USD',
			firstRegion: 'east',
			mode: 'reference',
			firstMode: 'frames',
			listed: ['acme-motion-2', 'acme-still', 'acme-clip'],
			listedForLegacy: ['acme-motion-2', 'acme-still', 'acme-clip', 'acme-legacy']
		});
	});

	test('keeps every value the model and mode accept, gives the others their defaults, and drops what does not apply', () => {
		assert.deepStrictEqual({
			empty: normalizeBaseHalfVideoParams(motion, 'frames', undefined),
			kept: normalizeBaseHalfVideoParams(motion, 'frames', { resolution: '1080p', duration: 12, sound: false, seed: 42, negative_prompt: 'blur' }),
			refused: normalizeBaseHalfVideoParams(motion, 'frames', { resolution: '4k', duration: 13, sound: 'yes', seed: -1, negative_prompt: 'x'.repeat(501), unknown: 1, constructor: 2 }),
			offStep: normalizeBaseHalfVideoParams(still, 'frames', { duration: 7 }),
			auto: normalizeBaseHalfVideoParams(motion, 'frames', { duration: -1 }),
			notAnInteger: normalizeBaseHalfVideoParams(motion, 'frames', { duration: 5.5 }),
			ratioInFrames: normalizeBaseHalfVideoParams(motion, 'frames', { ratio: '21:9' }),
			ratioInReferences: normalizeBaseHalfVideoParams(motion, 'reference', { ratio: '21:9' }),
			// An unknown mode is the model's first one.
			unknownMode: normalizeBaseHalfVideoParams(motion, 'edit', { ratio: '21:9' }),
			emptyOptionalText: normalizeBaseHalfVideoParams(motion, 'frames', { negative_prompt: '' }),
			// The style is optional and left unset; a caption that is not optional starts empty.
			borealis: normalizeBaseHalfVideoParams(borealisOne, 'frames', { strength: 0.30000000000000004 })
		}, {
			empty: { resolution: '720p', duration: 5, sound: true },
			kept: { resolution: '1080p', duration: 12, sound: false, seed: 42, negative_prompt: 'blur' },
			refused: { resolution: '720p', duration: 5, sound: true },
			offStep: { resolution: '1080p', duration: 5 },
			auto: { resolution: '720p', duration: -1, sound: true },
			notAnInteger: { resolution: '720p', duration: 5, sound: true },
			ratioInFrames: { resolution: '720p', duration: 5, sound: true },
			ratioInReferences: { resolution: '720p', ratio: '21:9', duration: 5, sound: true },
			unknownMode: { resolution: '720p', duration: 5, sound: true },
			emptyOptionalText: { resolution: '720p', duration: 5, sound: true },
			borealis: { strength: 0.30000000000000004, caption: '' }
		});
	});

	test('choosing a model or a mode keeps what the new one accepts, and a change saves one value', () => {
		const fromMotion = { provider: 'acme', model: 'acme-motion-2', mode: 'reference' as const, params: { resolution: '1080p', ratio: '9:16', duration: 10, sound: false } };
		const still = findBaseHalfVideoModel(TEST_VIDEO_CATALOG, 'acme', 'acme-still')!;
		const toStill = baseHalfVideoChooseModel(fromMotion, still);
		const toFrames = baseHalfVideoChooseMode(fromMotion, motion, 'frames');
		const changed = baseHalfVideoChangeParam({ provider: 'acme', model: 'acme-motion-2', mode: 'frames', params: { duration: 8 } }, motion, 'seed', 7);
		const cleared = baseHalfVideoChangeParam(changed, motion, 'seed', undefined);
		const refused = baseHalfVideoChangeParam(changed, motion, 'duration', 40);
		assert.deepStrictEqual({ toStill, toFrames, changed, cleared, refused }, {
			// One mode, 1080p is offered, 10 s is on its steps; ratio and sound do not apply.
			toStill: { provider: 'acme', model: 'acme-still', mode: 'frames', params: { resolution: '1080p', duration: 10 } },
			toFrames: { provider: 'acme', model: 'acme-motion-2', mode: 'frames', params: { resolution: '1080p', duration: 10, sound: false } },
			changed: { provider: 'acme', model: 'acme-motion-2', mode: 'frames', params: { resolution: '720p', duration: 8, sound: true, seed: 7 } },
			cleared: { provider: 'acme', model: 'acme-motion-2', mode: 'frames', params: { resolution: '720p', duration: 8, sound: true } },
			refused: { provider: 'acme', model: 'acme-motion-2', mode: 'frames', params: { resolution: '720p', duration: 5, sound: true, seed: 7 } }
		});
	});

	test('a new node starts with the last generation made legal, never with a deprecated or vanished model', () => {
		const lastUsed = { provider: 'acme', model: 'acme-still', mode: 'reference' as const, params: { resolution: '1080p', duration: 9, sound: true } };
		assert.deepStrictEqual({
			legal: baseHalfVideoInitialGeneration(lastUsed, TEST_VIDEO_CATALOG),
			deprecated: baseHalfVideoInitialGeneration({ provider: 'acme', model: 'acme-legacy' }, TEST_VIDEO_CATALOG),
			vanished: baseHalfVideoInitialGeneration({ provider: 'gone', model: 'acme-still' }, TEST_VIDEO_CATALOG),
			noModel: baseHalfVideoInitialGeneration({ provider: 'acme' }, TEST_VIDEO_CATALOG),
			loading: baseHalfVideoInitialGeneration(lastUsed, undefined)
		}, {
			legal: { provider: 'acme', model: 'acme-still', mode: 'frames', params: { resolution: '1080p', duration: 5 } },
			deprecated: undefined,
			vanished: undefined,
			noModel: undefined,
			loading: lastUsed
		});
	});

	test('frames take the first image as the start frame and the second as the end frame, and say why the rest is not used', () => {
		const frames = planBaseHalfVideoInputs(baseHalfVideoModeOf(motion, 'frames').inputs, [...sources, { path: 'gone.png', kind: 'image', available: false }], 'en');
		const startOnly = planBaseHalfVideoInputs(still.modes[0].inputs, sources.slice(0, 2), 'en');
		const textOnly = planBaseHalfVideoInputs(borealisOne.modes[0].inputs, sources.slice(0, 1), 'en');
		assert.deepStrictEqual({ frames: uses(frames), startOnly: uses(startOnly), textOnly: uses(textOnly) }, {
			frames: [
				'frames/a.png:start-frame=Image 1',
				'frames/b.png:end-frame=Image 2',
				'frames/c.png:unused(full)=Image 3',
				'clips/move.mp4:unused(mode)=Video 1',
				'notes/scene.md:text',
				'docs/brief.pdf:unused(kind)',
				'gone.png:unused(missing)=Image 4'
			],
			startOnly: ['frames/a.png:start-frame=Image 1', 'frames/b.png:unused(full)=Image 2'],
			textOnly: ['frames/a.png:unused(mode)=Image 1']
		});
	});

	test('references take images, videos, and audio as far as the mode declares them; extend and edit take the first video as the clip', () => {
		const references = planBaseHalfVideoInputs(baseHalfVideoModeOf(motion, 'reference').inputs, [
			{ path: 'gone.png', kind: 'image', available: false },
			...sources,
			{ path: 'd.png', kind: 'image', available: true },
			{ path: 'e.png', kind: 'image', available: true },
			{ path: 'take2.mov', kind: 'video', available: true },
			{ path: 'voice.mp3', kind: 'audio', available: true }
		], 'zh-cn');
		const media: IBaseHalfVideoInputSource[] = [
			{ path: 'a.png', kind: 'image', available: true },
			{ path: 'take1.mp4', kind: 'video', available: true },
			{ path: 'b.png', kind: 'image', available: true },
			{ path: 'take2.mp4', kind: 'video', available: true },
			{ path: 'c.png', kind: 'image', available: true }
		];
		assert.deepStrictEqual({
			references: uses(references),
			extend: uses(planBaseHalfVideoInputs(baseHalfVideoModeOf(clip, 'extend').inputs, media, 'en')),
			edit: uses(planBaseHalfVideoInputs(baseHalfVideoModeOf(clip, 'edit').inputs, media, 'en'))
		}, {
			references: [
				'gone.png:unused(missing)=图片1',
				'frames/a.png:reference=图片2',
				'frames/b.png:reference=图片3',
				'frames/c.png:reference=图片4',
				'clips/move.mp4:reference=视频1',
				'notes/scene.md:text',
				'docs/brief.pdf:unused(kind)',
				'd.png:reference=图片5',
				'e.png:unused(full)=图片6',
				'take2.mov:unused(full)=视频2',
				'voice.mp3:reference=音频1'
			],
			extend: ['a.png:unused(mode)=Image 1', 'take1.mp4:source=Video 1', 'b.png:unused(mode)=Image 2', 'take2.mp4:unused(full)=Video 2', 'c.png:unused(mode)=Image 3'],
			edit: ['a.png:reference=Image 1', 'take1.mp4:source=Video 1', 'b.png:reference=Image 2', 'take2.mp4:unused(full)=Video 2', 'c.png:unused(full)=Image 3']
		});
		assert.deepStrictEqual(baseHalfVideoPlannedCounts(planBaseHalfVideoInputs(baseHalfVideoModeOf(clip, 'edit').inputs, media, 'en')), {
			startFrame: false, endFrame: false, images: 2, videos: 0, audios: 0, source: true
		});
	});

	test('builds the prompt from the node\'s prompt and its text inputs, without front matter, each at most 16 KiB', () => {
		const note = stripBaseHalfMarkdownFrontMatter('﻿---\nupstream:\n  - brief.md\n---\n# Scene\n\nThe sea at dusk.\n');
		assert.deepStrictEqual({
			note,
			prompt: buildBaseHalfVideoPrompt('  Image 1 rides along the sea. ', [note, '   ', 'Slow.']),
			long: buildBaseHalfVideoPrompt('', ['x'.repeat(20_000)]).length,
			noFrontMatter: stripBaseHalfMarkdownFrontMatter('# Title\n---\nnot front matter\n---\n'),
			kinds: ['a.PNG', 'b.webm', 'c.flac', 'd.markdown', 'e.pdf', 'folder'].map(baseHalfVideoInputKindOfPath),
			tokens: findBaseHalfVideoLabelTokens('Image 1 meets 图片12 and Video 3; Images 2 is no name.').map(token => `${token.kind}${token.ordinal}@${token.start}`)
		}, {
			note: '# Scene\n\nThe sea at dusk.\n',
			prompt: 'Image 1 rides along the sea.\n\n# Scene\n\nThe sea at dusk.\n\nSlow.',
			long: 16 * 1024,
			noFrontMatter: '# Title\n---\nnot front matter\n---\n',
			kinds: ['image', 'video', 'audio', 'text', 'other', 'other'],
			tokens: ['image1@0', 'image12@14', 'video3@23']
		});
	});

	test('sums up the settings by the mode and the values of the parameters that are not advanced', () => {
		assert.deepStrictEqual({
			frames: baseHalfVideoSettingsSummary(motion, 'frames', { seed: 3 }).join(' · '),
			references: baseHalfVideoSettingsSummary(motion, 'reference', { ratio: '21:9', duration: -1, sound: false }).join(' · '),
			labels: baseHalfVideoSettingsSummary(still, 'frames', {}).join(' · '),
			borealis: baseHalfVideoSettingsSummary(borealisOne, 'frames', { style: 'ink', strength: 0.7, caption: 'Night\n  falls' }).join(' · '),
			borealisUnset: baseHalfVideoSettingsSummary(borealisOne, 'frames', {}).join(' · ')
		}, {
			frames: 'Frames · 720p · 5s · Sound',
			references: 'References · 720p · 21:9 · Auto · Sound off',
			labels: 'Frames · 1080P · 5s',
			borealis: 'Frames · Ink · Strength 0.7 · Night falls',
			borealisUnset: 'Frames · Strength 0.5'
		});
		const strength = borealisOne.parameters[1] as IBaseHalfVideoNumberParameter;
		const seed = motion.parameters[4] as IBaseHalfVideoNumberParameter;
		assert.deepStrictEqual({ steps: [baseHalfVideoNumberSteps(strength), baseHalfVideoNumberSteps(seed)], values: baseHalfVideoNumberValues(strength) }, {
			steps: [11, 2147483648],
			values: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]
		});
	});

	test('formats the estimate as one amount or a range in the region\'s currency, with its source', () => {
		assert.deepStrictEqual({
			yuan: formatBaseHalfVideoEstimate({ currency: 'CNY', min: 7.555, max: 7.555, priceDate: '2026-10-18' }),
			dollars: formatBaseHalfVideoEstimate({ currency: 'USD', min: 1.16, max: 1.16, priceDate: '2026-10-18' }),
			range: formatBaseHalfVideoEstimate({ currency: 'CNY', min: 3, max: 9, priceDate: '2026-10-18' }),
			large: formatBaseHalfVideoEstimate({ currency: 'USD', min: 1234.5, max: 1234.5, priceDate: '2026-10-18' }),
			tooltip: baseHalfVideoEstimateTooltip({ currency: 'CNY', min: 3, max: 9, priceDate: '2026-10-18' }, 'Acme Video')
		}, {
			yuan: '≈ ¥7.56',
			dollars: '≈ $1.16',
			range: '¥3.00–¥9.00',
			large: '≈ $1,234.50',
			tooltip: 'An estimate from the prices Acme Video published on 2026-10-18. What Acme Video bills is what counts.'
		});
		assert.deepStrictEqual({
			result: parseBaseHalfVideoCheckResult({ problems: ['  The prompt is <b>too long</b>.  ', ''], estimate: { currency: 'USD', min: 1, max: 2, priceDate: '2026-10-18' } }),
			badEstimate: parseBaseHalfVideoCheckResult({ problems: [], estimate: { currency: 'EUR', min: 1, max: 2, priceDate: '2026-10-18' } }),
			notAResult: parseBaseHalfVideoCheckResult({ problems: [3] })
		}, {
			result: { problems: ['The prompt is too long .'], estimate: { currency: 'USD', min: 1, max: 2, priceDate: '2026-10-18' } },
			badEstimate: { problems: [] },
			notAResult: undefined
		});
	});

	test('names the first reason the node cannot generate, in the order of the specification', () => {
		const ready: BaseHalfVideoCatalogState = { kind: 'ready', catalog: TEST_VIDEO_CATALOG };
		const setup = (overrides: { setUp?: boolean; region?: string } = {}) => (provider: IBaseHalfVideoCatalogProvider) => ({
			setUp: overrides.setUp ?? true,
			region: findBaseHalfVideoRegion(provider, overrides.region)
		});
		const plan = planBaseHalfVideoInputs(still.modes[0].inputs, sources.slice(0, 1), 'en');
		const base: IBaseHalfVideoGenerateBlockerInput = {
			generating: false,
			catalog: ready,
			generation: { provider: 'acme', model: 'acme-still' },
			setup: setup(),
			problems: [],
			prompt: '',
			plan
		};
		const cases: Record<string, Partial<IBaseHalfVideoGenerateBlockerInput>> = {
			generating: { generating: true, catalog: { kind: 'loading' } },
			catalogLoading: { catalog: { kind: 'loading' }, generation: undefined },
			catalogFailed: { catalog: { kind: 'failed', message: 'AI Video is not running.' } },
			noModel: { generation: { provider: 'acme' }, setup: setup({ setUp: false }) },
			unknownModel: { generation: { provider: 'acme', model: 'acme-motion-9' } },
			notSetUp: { setup: setup({ setUp: false, region: 'west' }) },
			region: { setup: setup({ region: 'west' }), problems: ['Too long.'] },
			check: { problems: ['', 'The start frame is smaller than 300 pixels.'] },
			nothingToSend: { plan: [] },
			ready: {}
		};
		const blockers: Record<string, BaseHalfVideoGenerateBlocker | undefined> = Object.fromEntries(Object.entries(cases).map(([name, overrides]) => [name, getBaseHalfVideoGenerateBlocker({ ...base, ...overrides })]));
		assert.deepStrictEqual(Object.fromEntries(Object.entries(blockers).map(([name, blocker]) => [name, blocker ? [blocker.kind, baseHalfVideoGenerateBlockerText(blocker), isBaseHalfVideoModelBlocker(blocker)] : undefined])), {
			generating: ['generating', 'This node is generating.', false],
			catalogLoading: ['catalogLoading', 'The video models are still loading.', false],
			catalogFailed: ['catalogFailed', 'BaseHalf could not load the video models: AI Video is not running.', false],
			noModel: ['noModel', 'Choose a model to generate.', true],
			unknownModel: ['unknownModel', 'acme-motion-9 is not a model BaseHalf offers. Choose another model.', true],
			notSetUp: ['notSetUp', 'Acme Video is not set up. Set it up in Video Providers.', true],
			region: ['region', 'Acme Still is not offered in West · Acme Global. Choose another model, or another region in Video Providers.', true],
			check: ['check', 'The start frame is smaller than 300 pixels.', false],
			nothingToSend: ['nothingToSend', 'Write a prompt or connect an input to generate.', false],
			ready: undefined
		});
	});
});
