/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	baseHalfModelFileExtension,
	baseHalfModelMostOutputs,
	baseHalfModelOutputCount,
	BaseHalfVideoCatalogState,
	baseHalfVideoCatalogForAgents,
	BaseHalfVideoGenerateBlocker,
	baseHalfVideoChangeParam,
	baseHalfVideoChooseMode,
	baseHalfVideoChooseModel,
	baseHalfVideoChoiceRatio,
	baseHalfVideoGenerateBlockerText,
	baseHalfVideoInitialGeneration,
	baseHalfVideoInputKindOfPath,
	baseHalfVideoInputProblem,
	baseHalfVideoLimitRange,
	baseHalfVideoListedModels,
	baseHalfVideoModelAbilities,
	baseHalfVideoModeOf,
	baseHalfVideoModeThatIsUsed,
	baseHalfVideoModeUsesEveryInput,
	baseHalfVideoNumberSteps,
	baseHalfVideoNumberValues,
	baseHalfVideoRefusedParam,
	baseHalfVideoSentParams,
	baseHalfVideoSettingsSummary,
	buildBaseHalfVideoPrompt,
	findBaseHalfVideoLabelTokens,
	findBaseHalfVideoModel,
	findBaseHalfVideoRegion,
	fitBaseHalfVideoParams,
	getBaseHalfVideoGenerateBlocker,
	IBaseHalfVideoCatalogProvider,
	IBaseHalfVideoGenerateBlockerInput,
	IBaseHalfVideoInputPlanItem,
	IBaseHalfVideoInputSource,
	IBaseHalfVideoNumberParameter,
	isBaseHalfModelDeprecated,
	isBaseHalfVideoModelBlocker,
	normalizeBaseHalfVideoParams,
	parseBaseHalfVideoCatalog,
	parseBaseHalfVideoCheckResult,
	planBaseHalfVideoInputs,
	stripBaseHalfMarkdownFrontMatter
} from '../../common/basehalfVideoCatalog.js';
import { ACME, ACME_MOTION, BOREALIS, TEST_GENERATION_CATALOG, TEST_VIDEO_CATALOG, testVideoModel } from './basehalfVideoCatalogFixture.js';

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

	test('the ratio a choice makes is its model\'s ratio setting for its mode, or that setting\'s default; a value that names no ratio, another mode, and another model have none', () => {
		const choice = (model: string, mode: 'frames' | 'reference' | undefined, ratio?: string) => ({ provider: 'acme', model, ...(mode ? { mode } : {}), ...(ratio ? { params: { ratio } } : {}) });
		assert.deepStrictEqual([
			choice('acme-motion-2', 'reference', '9:16'),
			choice('acme-motion-2', 'reference'),
			choice('acme-motion-2', 'reference', 'adaptive'),
			// The setting applies to References only, and the first mode is Frames.
			choice('acme-motion-2', 'frames', '9:16'),
			choice('acme-motion-2', undefined, '9:16'),
			choice('acme-still', 'frames'),
			choice('acme-gone', 'reference', '9:16')
		].map(entry => baseHalfVideoChoiceRatio(TEST_VIDEO_CATALOG, entry)), [9 / 16, 16 / 9, undefined, undefined, undefined, undefined, undefined]);
	});

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
			region: findBaseHalfVideoRegion(TEST_VIDEO_CATALOG.providers[0], 'west').id,
			firstRegion: findBaseHalfVideoRegion(TEST_VIDEO_CATALOG.providers[0], 'north').id,
			mode: baseHalfVideoModeOf(motion, 'reference').id,
			firstMode: baseHalfVideoModeOf(motion, 'edit').id,
			listed: listed(undefined),
			listedForLegacy: listed({ provider: 'acme', model: 'acme-legacy' })
		}, {
			found: 'Acme Video / Acme Still',
			otherProvider: undefined,
			noProvider: undefined,
			region: 'west',
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

	test('reads what check answered: its problems as plain text, and nothing that is no answer', () => {
		assert.deepStrictEqual({
			result: parseBaseHalfVideoCheckResult({ problems: ['  The prompt is <b>too long</b>.  ', ''] }),
			notAResult: parseBaseHalfVideoCheckResult({ problems: [3] })
		}, {
			result: { problems: ['The prompt is too long .'] },
			notAResult: undefined
		});
	});

	test('reads the ranges check answered with their reasons, and fits a value beyond one to its end on the steps, as AI Video does (D70)', () => {
		const checked = parseBaseHalfVideoCheckResult({
			problems: [],
			limits: {
				duration: { max: 7.6, reason: '  The connected video lasts 4.4 seconds.  ' },
				strength: { min: 0.25, reason: 'At least a quarter.' },
				seed: { min: 9, max: 3, reason: 'No room.' },
				resolution: { reason: 'No end.' },
				'two words': { max: 2, reason: 'No name.' },
				sound: { max: 4 }
			}
		});
		const limits = checked?.limits;
		const duration = (model: typeof motion) => model.parameters.find(parameter => parameter.name === 'duration') as IBaseHalfVideoNumberParameter;
		assert.deepStrictEqual({
			limits,
			beyond: fitBaseHalfVideoParams(motion, { duration: 12, sound: true }, limits),
			inside: fitBaseHalfVideoParams(motion, { duration: 6 }, limits),
			auto: fitBaseHalfVideoParams(motion, { duration: -1 }, limits),
			byDefault: fitBaseHalfVideoParams(motion, {}, { duration: { max: 4.5, reason: 'Short.' } }),
			onSteps: fitBaseHalfVideoParams(still, { duration: 10 }, { duration: { max: 8, reason: 'Short.' } }),
			upToMin: fitBaseHalfVideoParams(borealisOne, { strength: 0.1 }, limits),
			none: fitBaseHalfVideoParams(motion, { duration: 12 }, undefined),
			ranges: [baseHalfVideoLimitRange(duration(motion), limits?.duration), baseHalfVideoLimitRange(duration(still), { min: 6, reason: 'Long.' }), baseHalfVideoLimitRange(duration(motion), undefined)]
		}, {
			limits: { duration: { max: 7.6, reason: 'The connected video lasts 4.4 seconds.' }, strength: { min: 0.25, reason: 'At least a quarter.' } },
			beyond: { duration: 7, sound: true },
			inside: { duration: 6 },
			auto: { duration: -1 },
			byDefault: { duration: 4 },
			onSteps: { duration: 5 },
			upToMin: { strength: 0.3 },
			none: { duration: 12 },
			ranges: [{ min: 4, max: 7 }, { min: 10, max: 10 }, { min: 4, max: 12 }]
		});
	});

	test('a value a start frame sets is left out of what is sent and summed up, and a mode outside its regions blocks', () => {
		const declared = JSON.parse(JSON.stringify({ schema: 1, providers: [ACME] }));
		const motionDeclared = declared.providers[0].models.find((model: { id: string }) => model.id === 'acme-motion-2');
		motionDeclared.parameters = motionDeclared.parameters.map((parameter: { name: string }) => parameter.name === 'ratio' ? { ...parameter, modes: undefined, setByStartFrame: true } : parameter);
		motionDeclared.modes = motionDeclared.modes.map((mode: { id: string }) => mode.id === 'reference' ? { ...mode, regions: ['west'] } : mode);
		const catalog = parseBaseHalfVideoCatalog(declared).catalog;
		const model = catalog.providers[0].models.find(candidate => candidate.id === 'acme-motion-2')!;
		const params = normalizeBaseHalfVideoParams(model, 'frames', { ratio: '9:16' });
		const blocker = getBaseHalfVideoGenerateBlocker({
			generating: false,
			catalog: { kind: 'ready', catalog },
			generation: { provider: 'acme', model: 'acme-motion-2', mode: 'reference' },
			setup: provider => ({ setUp: true, region: findBaseHalfVideoRegion(provider, 'east') }),
			problems: [],
			prompt: 'A pier.',
			plan: []
		});
		assert.deepStrictEqual({
			parsed: [model.parameters.find(parameter => parameter.name === 'ratio')?.setByStartFrame, model.modes[1].regions],
			withFrame: baseHalfVideoSentParams(model, 'frames', params, true),
			withoutFrame: baseHalfVideoSentParams(model, 'frames', params, false),
			summaries: [baseHalfVideoSettingsSummary(model, 'frames', params, true), baseHalfVideoSettingsSummary(model, 'frames', params)],
			blocker: blocker && [blocker.kind, baseHalfVideoGenerateBlockerText(blocker)]
		}, {
			parsed: [true, ['west']],
			withFrame: { resolution: '720p', duration: 5, sound: true },
			withoutFrame: { resolution: '720p', ratio: '9:16', duration: 5, sound: true },
			summaries: [['Frames', '720p', '5s', 'Sound'], ['Frames', '720p', '9:16', '5s', 'Sound']],
			blocker: ['modeRegion', 'Acme Motion 2 offers References mode only in West · Acme Global. Choose another mode, or another region in Providers.']
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
			otherKind: { kind: 'image', setup: setup({ setUp: false }) },
			notSetUp: { setup: setup({ setUp: false, region: 'west' }) },
			region: { setup: setup({ region: 'west' }), problems: ['Too long.'] },
			draftInput: { plan: planBaseHalfVideoInputs(still.modes[0].inputs, [{ path: 'shots/start.png', kind: 'image', available: false, draft: true }], 'en'), problems: ['Too long.'] },
			// Every input is sent (D67): a second image for a model that takes one stops Generate before what check said.
			unusableInput: { plan: planBaseHalfVideoInputs(still.modes[0].inputs, sources.slice(0, 2), 'en'), problems: ['Too long.'] },
			check: { problems: ['', 'The start frame is smaller than 300 pixels.'] },
			// A new card: nothing written and nothing connected says that before what the model needs.
			nothingConnected: { plan: [], problems: ['Write a prompt: Acme Still needs one.'] },
			nothingToSend: { plan: [] },
			inputsUnknown: { plan: undefined },
			ready: {}
		};
		const blockers: Record<string, BaseHalfVideoGenerateBlocker | undefined> = Object.fromEntries(Object.entries(cases).map(([name, overrides]) => [name, getBaseHalfVideoGenerateBlocker({ ...base, ...overrides })]));
		assert.deepStrictEqual(Object.fromEntries(Object.entries(blockers).map(([name, blocker]) => [name, blocker ? [blocker.kind, baseHalfVideoGenerateBlockerText(blocker), isBaseHalfVideoModelBlocker(blocker)] : undefined])), {
			generating: ['generating', 'This card is already generating.', false],
			catalogLoading: ['catalogLoading', 'The models are still loading.', false],
			catalogFailed: ['catalogFailed', 'BaseHalf could not load the models: AI Video is not running.', false],
			noModel: ['noModel', 'Choose a model to generate.', true],
			unknownModel: ['unknownModel', 'acme-motion-9 is not a model BaseHalf offers. Choose another model.', true],
			otherKind: ['otherKind', 'Acme Still makes videos. Choose an image model.', true],
			notSetUp: ['notSetUp', 'Acme Video is not set up. Set it up in Providers.', true],
			region: ['region', 'Acme Still is not offered in West · Acme Global. Choose another model, or another region in Providers.', true],
			draftInput: ['draftInput', 'start.png has no file yet. Generate it first, or remove its connection.', false],
			unusableInput: ['unusableInput', 'Image 2 cannot be sent: Acme Still takes one image at most.', false],
			check: ['check', 'The start frame is smaller than 300 pixels.', false],
			nothingConnected: ['nothingToSend', 'Write a prompt or connect an input to generate.', false],
			nothingToSend: ['nothingToSend', 'Write a prompt or connect an input to generate.', false],
			inputsUnknown: undefined,
			ready: undefined
		});
	});

	suite('what is connected is sent (D67)', () => {
		const image = (name: string): IBaseHalfVideoInputSource => ({ path: `shots/${name}.png`, kind: 'image', available: true });
		const video = (name: string, available = true): IBaseHalfVideoInputSource => available
			? { path: `shots/${name}.mp4`, kind: 'video', available }
			: { path: `shots/${name}.mp4`, kind: 'video', available, draft: true };
		const note: IBaseHalfVideoInputSource = { path: 'notes/scene.md', kind: 'text', available: true };
		const pdf: IBaseHalfVideoInputSource = { path: 'docs/brief.pdf', kind: 'other', available: true };

		test('the mode that is used is the card\'s own when it uses every input, and else the first of the model\'s that does', () => {
			const used = (modeId: string | undefined, inputs: readonly IBaseHalfVideoInputSource[]) => baseHalfVideoModeThatIsUsed(motion, modeId, inputs).id;
			assert.deepStrictEqual({
				framesWithTwoImages: used('frames', [image('a'), image('b')]),
				framesWithAVideo: used('frames', [image('a'), video('v')]),
				framesWithThreeImages: used('frames', [image('a'), image('b'), image('c')]),
				referencesWithAnImage: used('reference', [image('a')]),
				// A draft without its file is of its kind: it is missing, not unusable.
				framesWithADraftVideo: used('frames', [video('v', false)]),
				// Notes join the prompt in every mode.
				framesWithANote: used('frames', [note, image('a')]),
				// No mode takes two videos: the card's own mode stays, and its inputs stop Generate.
				framesWithTwoVideos: used('frames', [video('v'), video('w')]),
				noModeStored: used(undefined, [video('v')]),
				clipWithImages: baseHalfVideoModeThatIsUsed(clip, 'extend', [video('v'), image('a')]).id,
				fits: [baseHalfVideoModeUsesEveryInput(motion.modes[0].inputs, [image('a'), image('b')]), baseHalfVideoModeUsesEveryInput(motion.modes[0].inputs, [video('v')])]
			}, {
				framesWithTwoImages: 'frames',
				framesWithAVideo: 'reference',
				framesWithThreeImages: 'reference',
				referencesWithAnImage: 'reference',
				framesWithADraftVideo: 'reference',
				framesWithANote: 'frames',
				framesWithTwoVideos: 'frames',
				noModeStored: 'reference',
				clipWithImages: 'edit',
				fits: [true, false]
			});
		});

		test('names the first input no mode can use with the ones before it, and why', () => {
			const split = { ...motion, id: 'acme-split', label: 'Acme Split', modes: [motion.modes[0], clip.modes[0]] };
			const problem = (model: typeof motion, inputs: readonly IBaseHalfVideoInputSource[]) => {
				const found = baseHalfVideoInputProblem(model, inputs);
				return found && [found.index, found.path, found.reason];
			};
			assert.deepStrictEqual({
				fits: problem(motion, [note, image('a'), image('b'), image('c'), video('v')]),
				fifthImage: problem(motion, [image('a'), image('b'), image('c'), image('d'), image('e'), video('v')]),
				secondVideo: problem(motion, [video('v'), video('w')]),
				noVideos: problem(still, [video('v')]),
				noImages: problem(borealisOne, [image('a')]),
				pdf: problem(motion, [image('a'), pdf]),
				clipImages: problem(clip, [video('v'), image('a'), image('b'), image('c')]),
				together: problem(split, [image('a'), video('v')])
			}, {
				fits: undefined,
				fifthImage: [4, 'shots/e.png', 'Acme Motion 2 takes at most 4 images.'],
				secondVideo: [1, 'shots/w.mp4', 'Acme Motion 2 takes one video at most.'],
				noVideos: [0, 'shots/v.mp4', 'Acme Still takes no videos.'],
				noImages: [0, 'shots/a.png', 'Borealis One takes no images.'],
				pdf: [1, 'docs/brief.pdf', 'An image or video card cannot use brief.pdf.'],
				clipImages: [3, 'shots/c.png', 'Acme Clip takes at most 2 images.'],
				together: [1, 'shots/v.mp4', 'Acme Split cannot use v.mp4 together with the inputs before it.']
			});
		});

		test('a value changed for the mode that is used is legal there, and the card keeps its own mode', () => {
			const changed = baseHalfVideoChangeParam({ provider: 'acme', model: 'acme-motion-2', mode: 'frames', params: { duration: 8 } }, motion, 'ratio', '1:1', 'reference');
			const own = baseHalfVideoChangeParam({ provider: 'acme', model: 'acme-motion-2', mode: 'frames', params: {} }, motion, 'ratio', '1:1');
			assert.deepStrictEqual({ changed, own: own.params }, {
				changed: { provider: 'acme', model: 'acme-motion-2', mode: 'frames', params: { resolution: '720p', ratio: '1:1', duration: 8, sound: true } },
				own: { resolution: '720p', duration: 5, sound: true }
			});
		});
	});

	suite('models of two kinds', () => {
		const corvid = TEST_GENERATION_CATALOG.providers[2];
		const paint = corvid.models[0];
		const print = corvid.models[1];
		const reel = corvid.models[2];

		test('a card lists the models of its kind, and a model retired in the region in use only for a card that uses it', () => {
			const listed = (kind: 'image' | 'video', region: string, chosen?: { provider: string; model: string }) => baseHalfVideoListedModels(corvid, chosen, kind, region).map(model => model.id);
			assert.deepStrictEqual({
				images: listed('image', 'north'),
				imagesInTheSouth: listed('image', 'south'),
				printChosenInTheSouth: listed('image', 'south', { provider: 'corvid', model: 'corvid-print' }),
				videos: listed('video', 'north'),
				deprecated: [isBaseHalfModelDeprecated(print, 'south'), isBaseHalfModelDeprecated(print, 'north'), isBaseHalfModelDeprecated(print)],
				kinds: TEST_GENERATION_CATALOG.providers.map(provider => provider.models.map(model => model.kind).join(','))
			}, {
				images: ['corvid-paint', 'corvid-print'],
				imagesInTheSouth: ['corvid-paint'],
				printChosenInTheSouth: ['corvid-paint', 'corvid-print'],
				videos: ['corvid-reel'],
				deprecated: [true, false, false],
				kinds: ['video,video,video,video', 'video', 'image,image,video']
			});
		});

		test('an image model says its largest resolution and how many images one generation makes; a video model its modes, length, size, and sound', () => {
			assert.deepStrictEqual([baseHalfVideoModelAbilities(paint), baseHalfVideoModelAbilities(print), baseHalfVideoModelAbilities(motion), baseHalfVideoModelAbilities(reel)], [
				'4K · Up to 4 images · 4 references',
				'2K · Up to 2 images · 4 references',
				'Frames · References · 4–12s · 1080p · Sound',
				'Frames · 4–8s'
			]);
		});

		test('the largest resolution is the one with the most pixels, whatever order the model lists them in', () => {
			const withResolutions = (...values: string[]) => baseHalfVideoModelAbilities({
				...print,
				parameters: [{ name: 'resolution', label: 'Resolution', kind: 'choice', options: values.map(value => ({ value, label: value.toUpperCase() })), default: values[0] }]
			});
			assert.deepStrictEqual([
				withResolutions('4k', '1k', '2k'),
				withResolutions('1080p', '1k'),
				withResolutions('1.5k', '1080p'),
				withResolutions('3k', '2k', '1.5k'),
				withResolutions('768p', '720p', '1k'),
				withResolutions('unknown', '720p')
			], ['4K · 4 references', '1080P · 4 references', '1.5K · 4 references', '3K · 4 references', '1K · 4 references', '720P · 4 references']);
		});

		test('a generation makes one file per image of its count, one for a video, and each file has the extension of its model\'s format', () => {
			assert.deepStrictEqual({
				counts: [baseHalfModelOutputCount(paint, 'reference', { count: 3 }), baseHalfModelOutputCount(paint, 'reference', {}), baseHalfModelOutputCount(paint, 'reference', { count: 9 }), baseHalfModelOutputCount(motion, 'frames', { count: 3 })],
				most: [baseHalfModelMostOutputs(paint), baseHalfModelMostOutputs(motion)],
				extensions: [baseHalfModelFileExtension(paint), baseHalfModelFileExtension(print), baseHalfModelFileExtension(reel)]
			}, {
				counts: [3, 1, 1, 1],
				most: [4, 1],
				extensions: ['png', 'jpg', 'mp4']
			});
		});

		test('a new card starts with the last generation of its kind, never with a model of the other kind or one retired in its region', () => {
			const region = (regionId: string) => () => regionId;
			const lastImage = { provider: 'corvid', model: 'corvid-print', mode: 'reference' as const, params: { count: 2 } };
			assert.deepStrictEqual({
				image: baseHalfVideoInitialGeneration(lastImage, TEST_GENERATION_CATALOG, 'image', region('north')),
				retired: baseHalfVideoInitialGeneration(lastImage, TEST_GENERATION_CATALOG, 'image', region('south')),
				otherKind: baseHalfVideoInitialGeneration(lastImage, TEST_GENERATION_CATALOG, 'video')
			}, {
				image: { provider: 'corvid', model: 'corvid-print', mode: 'reference', params: { resolution: '2k', count: 2 } },
				retired: undefined,
				otherKind: undefined
			});
		});

		test('an input that names a draft is unused for the draft and keeps its kind, so the names after it stay', () => {
			const plan = planBaseHalfVideoInputs(paint.modes[0].inputs, [
				{ path: 'shots/hero.png', kind: 'image', available: false, draft: true },
				{ path: 'refs/b.png', kind: 'image', available: true },
				{ path: 'gone.png', kind: 'image', available: false }
			], 'en');
			assert.deepStrictEqual(uses(plan), ['shots/hero.png:unused(draft)=Image 1', 'refs/b.png:reference=Image 2', 'gone.png:unused(missing)=Image 3']);
		});

		test('an agent\'s value that the model does not accept is named instead of made legal', () => {
			assert.deepStrictEqual([
				baseHalfVideoRefusedParam(paint, 'reference', { count: 9 }),
				baseHalfVideoRefusedParam(paint, 'reference', { style: 'ink' }),
				baseHalfVideoRefusedParam(motion, 'frames', { ratio: '16:9' }),
				baseHalfVideoRefusedParam(motion, 'extend', {}),
				baseHalfVideoRefusedParam(paint, 'reference', { count: 2, resolution: '4k', seed: 7 })
			], [
				'Corvid Paint does not accept 9 for Images.',
				'Corvid Paint has no setting style.',
				'Acme Motion 2 does not use ratio in Frames mode.',
				'Acme Motion 2 has no mode extend.',
				undefined
			]);
		});

		test('agents read each model\'s kind, the format an image model delivers, the regions that retire it, and whether it answers at once', () => {
			const agents = baseHalfVideoCatalogForAgents(TEST_GENERATION_CATALOG, provider => ({ setUp: provider.id === 'corvid', region: findBaseHalfVideoRegion(provider, undefined) }));
			const models = (agents[2].models as { id: string; kind: string; outputFormat?: string; deprecatedIn?: string[]; answersAtOnce?: boolean; regions: string[] }[]).map(model => ({ id: model.id, kind: model.kind, outputFormat: model.outputFormat, deprecatedIn: model.deprecatedIn, answersAtOnce: model.answersAtOnce, regions: model.regions }));
			assert.deepStrictEqual({ setUp: agents[2].setUp, models, noPrice: JSON.stringify(agents).includes('price') }, {
				setUp: true,
				models: [
					{ id: 'corvid-paint', kind: 'image', outputFormat: 'png', deprecatedIn: undefined, answersAtOnce: true, regions: ['north', 'south'] },
					{ id: 'corvid-print', kind: 'image', outputFormat: 'jpeg', deprecatedIn: ['south'], answersAtOnce: undefined, regions: ['north', 'south'] },
					{ id: 'corvid-reel', kind: 'video', outputFormat: undefined, deprecatedIn: undefined, answersAtOnce: true, regions: ['north', 'south'] }
				],
				noPrice: false
			});
		});
	});
});
