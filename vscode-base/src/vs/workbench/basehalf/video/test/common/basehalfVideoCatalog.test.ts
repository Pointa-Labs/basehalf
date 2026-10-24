/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	BASEHALF_AUDIO_DEFAULT_MODE_INPUTS,
	baseHalfDefaultModeId,
	baseHalfDefaultModeInputs,
	baseHalfModelFileExtension,
	baseHalfModelMakesSeveral,
	baseHalfModelMostOutputs,
	baseHalfModelOutputCount,
	baseHalfVideoExampleGeneration,
	baseHalfVideoParamValueLabel,
	baseHalfVideoRecordedSettingsSummary,
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
	findBaseHalfVideoModel,
	findBaseHalfVideoRegion,
	fitBaseHalfVideoParams,
	getBaseHalfVideoGenerateBlocker,
	IBaseHalfVideoCatalogModel,
	IBaseHalfVideoCatalogProvider,
	IBaseHalfVideoGenerateBlockerInput,
	IBaseHalfVideoGenerationChoice,
	IBaseHalfVideoInputPlanItem,
	IBaseHalfVideoInputSource,
	IBaseHalfVideoNumberParameter,
	IBaseHalfVideoVoiceParameter,
	isBaseHalfModelDeprecated,
	isBaseHalfSpokenOrSungPrompt,
	isBaseHalfVideoModelBlocker,
	isBaseHalfVideoParamValueAccepted,
	normalizeBaseHalfVideoParams,
	parseBaseHalfVideoCatalog,
	parseBaseHalfVideoCheckResult,
	planBaseHalfVideoInputs,
	stripBaseHalfMarkdownFrontMatter
} from '../../common/basehalfVideoCatalog.js';
import { baseHalfVoiceLabel, baseHalfVoiceParameter } from '../../common/basehalfGenerationVoices.js';
import { ACME, ACME_MOTION, BOREALIS, DUNLIN, DUNLIN_VOICE, TEST_AUDIO_CATALOG, TEST_GENERATION_CATALOG, TEST_VIDEO_CATALOG, testVideoModel } from './basehalfVideoCatalogFixture.js';

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
		return plan.map(item => `${item.path}:${item.use}${item.reason ? `(${item.reason})` : ''}`);
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

	test('reads the catalog the provider service answers, leaves out what is not well formed and says what, and refuses what is no catalog', () => {
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
		const frames = planBaseHalfVideoInputs(baseHalfVideoModeOf(motion, 'frames').inputs, [...sources, { path: 'gone.png', kind: 'image', available: false }]);
		const startOnly = planBaseHalfVideoInputs(still.modes[0].inputs, sources.slice(0, 2));
		const textOnly = planBaseHalfVideoInputs(borealisOne.modes[0].inputs, sources.slice(0, 1));
		assert.deepStrictEqual({ frames: uses(frames), startOnly: uses(startOnly), textOnly: uses(textOnly) }, {
			frames: [
				'frames/a.png:start-frame',
				'frames/b.png:end-frame',
				'frames/c.png:unused(full)',
				'clips/move.mp4:unused(mode)',
				'notes/scene.md:text',
				'docs/brief.pdf:unused(kind)',
				'gone.png:unused(missing)'
			],
			startOnly: ['frames/a.png:start-frame', 'frames/b.png:unused(full)'],
			textOnly: ['frames/a.png:unused(mode)']
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
		]);
		const media: IBaseHalfVideoInputSource[] = [
			{ path: 'a.png', kind: 'image', available: true },
			{ path: 'take1.mp4', kind: 'video', available: true },
			{ path: 'b.png', kind: 'image', available: true },
			{ path: 'take2.mp4', kind: 'video', available: true },
			{ path: 'c.png', kind: 'image', available: true }
		];
		assert.deepStrictEqual({
			references: uses(references),
			extend: uses(planBaseHalfVideoInputs(baseHalfVideoModeOf(clip, 'extend').inputs, media)),
			edit: uses(planBaseHalfVideoInputs(baseHalfVideoModeOf(clip, 'edit').inputs, media))
		}, {
			references: [
				'gone.png:unused(missing)',
				'frames/a.png:reference',
				'frames/b.png:reference',
				'frames/c.png:reference',
				'clips/move.mp4:reference',
				'notes/scene.md:text',
				'docs/brief.pdf:unused(kind)',
				'd.png:reference',
				'e.png:unused(full)',
				'take2.mov:unused(full)',
				'voice.mp3:reference'
			],
			extend: ['a.png:unused(mode)', 'take1.mp4:source', 'b.png:unused(mode)', 'take2.mp4:unused(full)', 'c.png:unused(mode)'],
			edit: ['a.png:reference', 'take1.mp4:source', 'b.png:reference', 'take2.mp4:unused(full)', 'c.png:unused(full)']
		});
	});

	test('reads a note without its front matter, and the kind of an input by its extension', () => {
		assert.deepStrictEqual({
			note: stripBaseHalfMarkdownFrontMatter('﻿---\nupstream:\n  - brief.md\n---\n# Scene\n\nThe sea at dusk.\n'),
			noFrontMatter: stripBaseHalfMarkdownFrontMatter('# Title\n---\nnot front matter\n---\n'),
			kinds: ['a.PNG', 'b.webm', 'c.flac', 'd.markdown', 'e.pdf', 'folder'].map(baseHalfVideoInputKindOfPath),
			// The sounds the window shows as sounds, an Ogg as .oga too, and AAC.
			sounds: ['a.mp3', 'b.wav', 'c.m4a', 'd.ogg', 'e.OGA', 'f.flac', 'g.aac', 'h.opus'].map(baseHalfVideoInputKindOfPath)
		}, {
			note: '# Scene\n\nThe sea at dusk.\n',
			noFrontMatter: '# Title\n---\nnot front matter\n---\n',
			kinds: ['image', 'video', 'audio', 'text', 'other', 'other'],
			sounds: ['audio', 'audio', 'audio', 'audio', 'audio', 'audio', 'audio', 'other']
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

	test('reads what check answered: its problems as plain text, the prompt as the module wrote it, and nothing that is no answer', () => {
		assert.deepStrictEqual({
			result: parseBaseHalfVideoCheckResult({ problems: ['  The prompt is <b>too long</b>.  ', ''], prompt: 'Image 1 rides.' }),
			notAResult: parseBaseHalfVideoCheckResult({ problems: [3], prompt: '' }),
			noPrompt: parseBaseHalfVideoCheckResult({ problems: [] })
		}, {
			result: { problems: ['The prompt is too long .'], prompt: 'Image 1 rides.' },
			notAResult: undefined,
			noPrompt: undefined
		});
	});

	test('reads the ranges check answered with their reasons, and fits a value beyond one to its end on the steps, as the provider service does (D70)', () => {
		const checked = parseBaseHalfVideoCheckResult({
			problems: [],
			prompt: '',
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
		const plan = planBaseHalfVideoInputs(still.modes[0].inputs, sources.slice(0, 1));
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
			catalogFailed: { catalog: { kind: 'failed', message: 'The provider service did not answer.' } },
			noModel: { generation: { provider: 'acme' }, setup: setup({ setUp: false }) },
			unknownModel: { generation: { provider: 'acme', model: 'acme-motion-9' } },
			otherKind: { kind: 'image', setup: setup({ setUp: false }) },
			notSetUp: { setup: setup({ setUp: false, region: 'west' }) },
			region: { setup: setup({ region: 'west' }), problems: ['Too long.'] },
			draftInput: { plan: planBaseHalfVideoInputs(still.modes[0].inputs, [{ path: 'shots/start.png', kind: 'image', available: false, draft: true }]), problems: ['Too long.'] },
			// Every input is sent (D67): a second image for a model that takes one stops Generate before what check said.
			unusableInput: { plan: planBaseHalfVideoInputs(still.modes[0].inputs, sources.slice(0, 2)), problems: ['Too long.'] },
			// A mention of a file that is not connected stops Generate before what check said (D74).
			unconnectedMention: { plan: planBaseHalfVideoInputs(still.modes[0].inputs, sources.slice(0, 1)), unconnected: 'shots/hero.png', problems: ['Too long.'] },
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
			catalogFailed: ['catalogFailed', 'BaseHalf could not load the models: The provider service did not answer.', false],
			noModel: ['noModel', 'Choose a model to generate.', true],
			unknownModel: ['unknownModel', 'acme-motion-9 is not a model BaseHalf offers. Choose another model.', true],
			otherKind: ['otherKind', 'Acme Still makes videos. Choose an image model.', true],
			notSetUp: ['notSetUp', 'Acme Video is not set up. Set it up in Providers.', true],
			region: ['region', 'Acme Still is not offered in West · Acme Global. Choose another model, or another region in Providers.', true],
			draftInput: ['draftInput', 'start.png has no file yet. Generate it first, or remove its connection.', false],
			unusableInput: ['unusableInput', 'b.png cannot be sent: Acme Still takes one image at most.', false],
			unconnectedMention: ['unconnectedMention', 'The prompt mentions hero.png, which is not connected.', false],
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
				pdf: [1, 'docs/brief.pdf', 'An image, video, or audio card cannot use brief.pdf.'],
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

		test('an input that names a draft is unused for the draft and keeps its kind, so the inputs after it keep their use', () => {
			const plan = planBaseHalfVideoInputs(paint.modes[0].inputs, [
				{ path: 'shots/hero.png', kind: 'image', available: false, draft: true },
				{ path: 'refs/b.png', kind: 'image', available: true },
				{ path: 'gone.png', kind: 'image', available: false }
			]);
			assert.deepStrictEqual(uses(plan), ['shots/hero.png:unused(draft)', 'refs/b.png:reference', 'gone.png:unused(missing)']);
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
	suite('audio models (D78)', () => {
		const dunlin = TEST_AUDIO_CATALOG.providers[3];
		const [speech, song, foley] = dunlin.models;
		const voice = baseHalfVoiceParameter(speech) as IBaseHalfVideoVoiceParameter;
		const corvid = TEST_AUDIO_CATALOG.providers[2];

		test('reads an audio model with what it makes, its format, and its voices, and refuses one that does not say what it makes or delivers', () => {
			const declared = (model: Record<string, unknown>) => parseBaseHalfVideoCatalog({ schema: 1, providers: [{ ...DUNLIN, models: [model] }] });
			const voiceOf = (parameter: Record<string, unknown>) => declared({ ...DUNLIN_VOICE, parameters: [parameter] });
			const withVoices = voiceOf({ name: 'voice', label: 'Voice', kind: 'voice', default: 'gone', options: [{ value: 'vx-ember', label: 'Ember', description: '  Warm,\nlow ' }, { value: 'vx-pike', label: 'Pike' }] });
			assert.deepStrictEqual({
				models: dunlin.models.map(model => [model.id, model.kind, model.makes, model.outputFormat]),
				voice: { listed: voice.listed, default: voice.default, options: voice.options.map(option => [option.value, option.label, option.description]) },
				modes: song.modes.map(mode => `${mode.id} ${mode.label}`),
				// A default that is none of the voices stands for the first; a description is plain text.
				fallback: withVoices.catalog.providers[0].models[0].parameters[0],
				problems: [
					...declared({ ...DUNLIN_VOICE, makes: undefined }).problems,
					...declared({ ...DUNLIN_VOICE, makes: 'noise' }).problems,
					...declared({ ...DUNLIN_VOICE, outputFormat: 'png' }).problems,
					...declared({ ...DUNLIN_VOICE, kind: 'pdf' }).problems,
					...voiceOf({ name: 'voice', label: 'Voice', kind: 'voice', default: 'a', options: [] }).problems,
					...voiceOf({ name: 'voice', label: 'Voice', kind: 'voice', default: 'a', options: [{ value: 'a', label: 'A' }, { value: 'a', label: 'B' }] }).problems,
					...voiceOf({ name: 'voice', label: 'Voice', kind: 'voice', default: 'a', options: [{ value: 'a\nb', label: 'A' }] }).problems
				]
			}, {
				models: [['dunlin-voice', 'audio', 'speech', 'mp3'], ['dunlin-song', 'audio', 'music', 'wav'], ['dunlin-foley', 'audio', 'sound', 'mp3']],
				voice: { listed: true, default: 'vx-ember', options: [['vx-ember', 'Ember', 'Warm, low'], ['vx-pike', 'Pike', 'Bright, quick'], ['vx-sable', 'Sable', undefined]] },
				modes: ['reference From a Description', 'lyrics From Lyrics'],
				fallback: {
					name: 'voice', label: 'Voice', kind: 'voice', default: 'vx-ember',
					options: [{ value: 'vx-ember', label: 'Ember', description: 'Warm, low' }, { value: 'vx-pike', label: 'Pike' }]
				},
				problems: [
					'providers[0].models[0].makes must be speech, music, or sound for an audio model.',
					'providers[0].models[0].makes must be speech, music, or sound for an audio model.',
					'providers[0].models[0].outputFormat must be mp3 or wav for an audio model.',
					'providers[0].models[0].kind must be image, video, or audio.',
					'providers[0].models[0].parameters[0].options must list at least one voice, each once.',
					'providers[0].models[0].parameters[0].options must list at least one voice, each once.',
					'providers[0].models[0].parameters[0].options[0].value must be a voice id of 1 to 256 characters without control characters.'
				]
			});
		});

		test('an audio card lists the audio models, and starts with the last values of a sound, never with a model of another kind', () => {
			const lastSong = { provider: 'dunlin', model: 'dunlin-song', mode: 'lyrics' as const, params: { count: 3, style: 'sea shanty', voice: 'x' } };
			assert.deepStrictEqual({
				audio: baseHalfVideoListedModels(dunlin, undefined, 'audio').map(model => model.id),
				noAudio: baseHalfVideoListedModels(corvid, undefined, 'audio').map(model => model.id),
				images: baseHalfVideoListedModels(dunlin, undefined, 'image').map(model => model.id),
				song: baseHalfVideoInitialGeneration(lastSong, TEST_AUDIO_CATALOG, 'audio'),
				forAVideo: baseHalfVideoInitialGeneration(lastSong, TEST_AUDIO_CATALOG, 'video'),
				lastImageForASound: baseHalfVideoInitialGeneration({ provider: 'corvid', model: 'corvid-paint' }, TEST_AUDIO_CATALOG, 'audio'),
				example: baseHalfVideoExampleGeneration(TEST_AUDIO_CATALOG, provider => ({ setUp: false, region: findBaseHalfVideoRegion(provider, undefined) }), 'audio')
			}, {
				audio: ['dunlin-voice', 'dunlin-song', 'dunlin-foley'],
				noAudio: [],
				images: [],
				song: { provider: 'dunlin', model: 'dunlin-song', mode: 'lyrics', params: { style: 'sea shanty', count: 3 } },
				forAVideo: undefined,
				lastImageForASound: undefined,
				example: { provider: 'dunlin', model: 'dunlin-voice', mode: 'reference', params: { voice: 'vx-ember', speed: 1 } }
			});
		});

		test('a voice keeps a voice of its options, and a listed voice any id of 1 to 256 characters without control characters; anything else takes the default', () => {
			const closed: IBaseHalfVideoVoiceParameter = { ...voice, listed: undefined };
			const kept = (value: unknown) => normalizeBaseHalfVideoParams(speech, 'reference', { voice: value }).voice;
			// 256 characters of two UTF-16 units each.
			const clefs = '\u{1D11E}'.repeat(256);
			assert.deepStrictEqual({
				listed: ['vx-pike', 'own-narrator', 'x'.repeat(256), 'x'.repeat(257), 'a\u0007b', '', 7].map(kept),
				// The provider service's rule (`isVoiceId`), which `check` applies too: characters are counted, and an id is not only spaces.
				rule: [clefs, `${clefs}\u{1D11E}`, '   ', 'a\u0085b'].map(value => kept(value) === value),
				closed: ['vx-pike', 'own-narrator'].map(value => isBaseHalfVideoParamValueAccepted(closed, value)),
				// An agent's voice of the account is taken as it is, and one the parameter does not take is named.
				refused: [baseHalfVideoRefusedParam(speech, 'reference', { voice: 'own-narrator' }), baseHalfVideoRefusedParam(speech, 'reference', { voice: '' })]
			}, {
				listed: ['vx-pike', 'own-narrator', 'x'.repeat(256), 'vx-ember', 'vx-ember', 'vx-ember', 'vx-ember'],
				rule: [true, false, false, false],
				closed: [true, false],
				refused: [undefined, 'Dunlin Voice does not accept "" for Voice.']
			});
		});

		test('a voice belongs to its provider: a model of another provider keeps it only among its own voices and otherwise speaks in its default; a model of the same provider keeps it', () => {
			// A second provider whose speech model lists voices too, as ElevenLabs, Fish Audio, and MiniMax do; it declares one of Dunlin's ids as well.
			const egretVoice: IBaseHalfVideoCatalogModel = {
				...DUNLIN_VOICE,
				id: 'egret-voice',
				label: 'Egret Voice',
				providerModels: { main: 'egret-1' },
				parameters: [
					{ name: 'voice', label: 'Voice', kind: 'voice', default: 'eg-default', listed: true, options: [{ value: 'eg-default', label: 'Egret Default' }, { value: 'vx-sable', label: 'Sable' }] },
					{ name: 'speed', label: 'Speed', kind: 'number', min: 0.5, max: 2, step: 0.05, default: 1 }
				]
			};
			// Dunlin's second speech model, to choose within one provider.
			const lite: IBaseHalfVideoCatalogModel = { ...DUNLIN_VOICE, id: 'dunlin-voice-lite', label: 'Dunlin Voice Lite', providerModels: { main: 'voice-lite-1' } };
			const { catalog, problems } = parseBaseHalfVideoCatalog({ schema: 1, providers: [{ ...DUNLIN, models: [DUNLIN_VOICE, lite] }, { ...DUNLIN, id: 'egret', label: 'Egret Speech', models: [egretVoice] }] });
			const chosen = (generation: IBaseHalfVideoGenerationChoice, provider: string, model: string) => baseHalfVideoChooseModel(generation, findBaseHalfVideoModel(catalog, provider, model)!).params;
			const dunlinWith = (voice: string) => ({ provider: 'dunlin', model: 'dunlin-voice', mode: 'reference' as const, params: { voice, speed: 1.25 } });
			assert.deepStrictEqual({
				problems,
				// A voice of Dunlin's account, and one of its own, which Egret does not declare: Egret speaks in its default, and the speed stays.
				accountToOther: chosen(dunlinWith('own-narrator'), 'egret', 'egret-voice'),
				ownToOther: chosen(dunlinWith('vx-pike'), 'egret', 'egret-voice'),
				// Egret's default is no voice of Dunlin's, though Dunlin lists voices and takes any id.
				back: chosen({ provider: 'egret', model: 'egret-voice', mode: 'reference', params: { voice: 'eg-default' } }, 'dunlin', 'dunlin-voice'),
				// A voice that the other model declares too is kept.
				shared: chosen(dunlinWith('vx-sable'), 'egret', 'egret-voice'),
				// Within one provider, the account's voice stays.
				sameProvider: chosen(dunlinWith('own-narrator'), 'dunlin', 'dunlin-voice-lite'),
				// A card without a provider has no voice of the new provider's.
				noProvider: chosen({ model: 'dunlin-voice', params: { voice: 'own-narrator' } }, 'dunlin', 'dunlin-voice')
			}, {
				problems: [],
				accountToOther: { voice: 'eg-default', speed: 1.25 },
				ownToOther: { voice: 'eg-default', speed: 1.25 },
				back: { voice: 'vx-ember', speed: 1 },
				shared: { voice: 'vx-sable', speed: 1.25 },
				sameProvider: { voice: 'own-narrator', speed: 1.25 },
				noProvider: { voice: 'vx-ember', speed: 1 }
			});
		});

		test('the settings name no voice: its button shows it, by the name the catalog or the provider\'s list gives it, or its id', () => {
			assert.deepStrictEqual({
				summary: baseHalfVideoSettingsSummary(speech, 'reference', { voice: 'vx-pike', speed: 1.25 }),
				recorded: baseHalfVideoRecordedSettingsSummary(speech, 'reference', { voice: 'own-narrator', speed: 1.5 }),
				labels: [
					baseHalfVoiceLabel(voice, 'vx-pike', undefined),
					baseHalfVoiceLabel(voice, 'own-narrator', { voices: [{ id: 'own-narrator', label: 'My Narrator', own: true }] }),
					baseHalfVoiceLabel(voice, 'own-narrator', undefined),
					// The catalog's name comes first.
					baseHalfVoiceLabel(voice, 'vx-pike', { voices: [{ id: 'vx-pike', label: 'Pike of the account', own: false }] }),
					// Card Detail names a voice as it names every value: by the catalog, or by its id.
					baseHalfVideoParamValueLabel(voice, 'vx-sable'),
					baseHalfVideoParamValueLabel(voice, 'own-narrator')
				],
				song: baseHalfVideoSettingsSummary(song, 'lyrics', { style: 'Sea  shanty' }),
				instrumental: baseHalfVideoSettingsSummary(song, 'reference', { instrumental: true, count: 1 })
			}, {
				summary: ['From Text', 'Speed 1.25'],
				recorded: ['From Text', 'Speed 1.5'],
				labels: ['Pike', 'My Narrator', 'own-narrator', 'Pike', 'Sable', 'own-narrator'],
				song: ['From Lyrics', 'Sea shanty', 'Songs 2'],
				instrumental: ['From a Description', 'Instrumental', 'Songs 1']
			});
		});

		test('a music model makes as many songs as its count, and every audio model one file of the format it declares', () => {
			assert.deepStrictEqual({
				several: [baseHalfModelMakesSeveral(song), baseHalfModelMakesSeveral(speech), baseHalfModelMakesSeveral(foley)],
				counts: [baseHalfModelOutputCount(song, 'lyrics', {}), baseHalfModelOutputCount(song, 'lyrics', { count: 3 }), baseHalfModelOutputCount(song, 'reference', { count: 9 }), baseHalfModelOutputCount(speech, 'reference', { count: 3 })],
				most: [baseHalfModelMostOutputs(song), baseHalfModelMostOutputs(speech), baseHalfModelMostOutputs(foley)],
				extensions: dunlin.models.map(baseHalfModelFileExtension)
			}, {
				several: [true, false, false],
				counts: [2, 3, 2, 1],
				most: [3, 1, 1],
				extensions: ['mp3', 'wav', 'mp3']
			});
		});

		test('an audio model says what it makes first, then the characters of speech, or its modes, length, songs, and references', () => {
			const duration = (parameter: Partial<IBaseHalfVideoNumberParameter>): IBaseHalfVideoNumberParameter => ({ name: 'duration', label: 'Duration', kind: 'integer', unit: 'seconds', min: 1, max: 30, step: 1, ...parameter });
			const references = (images: number, audios: number) => song.modes.map(mode => ({ ...mode, inputs: { ...mode.inputs, images: { min: 0, max: images }, audios: { min: 0, max: audios } } }));
			const models: readonly IBaseHalfVideoCatalogModel[] = [
				speech,
				song,
				foley,
				{ ...song, modes: [song.modes[0]], parameters: [] },
				// Auto does not count as a length; a model that makes one length says it alone, as a number or as a choice.
				{ ...foley, parameters: [duration({ kind: 'number', min: 0.5, max: 22, step: 0.1, auto: { value: -1, label: 'Auto' } })] },
				{ ...song, parameters: [duration({ min: 30, max: 30 })] },
				{ ...foley, parameters: [{ name: 'duration', label: 'Duration', kind: 'choice', options: [{ value: 30, label: '30s' }] }] },
				{ ...song, modes: references(2, 3), parameters: [] }
			];
			assert.deepStrictEqual(models.map(baseHalfVideoModelAbilities), [
				'Speech · Up to 10,000 characters',
				'Music · From a Description · From Lyrics · Up to 3 songs · 1 reference image · 1 reference sound',
				'Sound Effects · Up to 22s',
				'Music · 1 reference image · 1 reference sound',
				'Sound Effects · Up to 22s',
				'Music · From a Description · From Lyrics · 30s · 1 reference image · 1 reference sound',
				'Sound Effects · 30s',
				'Music · From a Description · From Lyrics · 2 reference images · 3 reference sounds'
			]);
		});

		test('the prompt of a speech model and the prompt in Lyrics mode are spoken or sung', () => {
			assert.deepStrictEqual([
				isBaseHalfSpokenOrSungPrompt(speech, 'reference'),
				isBaseHalfSpokenOrSungPrompt(song, 'lyrics'),
				isBaseHalfSpokenOrSungPrompt(song, 'reference'),
				isBaseHalfSpokenOrSungPrompt(foley, 'reference'),
				isBaseHalfSpokenOrSungPrompt(motion, 'lyrics'),
				isBaseHalfSpokenOrSungPrompt(undefined, 'lyrics')
			], [true, true, false, false, false, false]);
		});

		test('a song\'s references are the images and sounds its mode takes, in Lyrics mode as in references; an audio card without a model shows references', () => {
			const inputs: IBaseHalfVideoInputSource[] = [
				{ path: 'refs/cover.png', kind: 'image', available: true },
				{ path: 'refs/tune.mp3', kind: 'audio', available: true },
				{ path: 'notes/lyrics.md', kind: 'text', available: true },
				{ path: 'refs/second.wav', kind: 'audio', available: true },
				{ path: 'clips/take.mp4', kind: 'video', available: true }
			];
			assert.deepStrictEqual({
				lyrics: uses(planBaseHalfVideoInputs(baseHalfVideoModeOf(song, 'lyrics').inputs, inputs)),
				references: uses(planBaseHalfVideoInputs(baseHalfVideoModeOf(song, 'reference').inputs, inputs.slice(0, 3))),
				speech: uses(planBaseHalfVideoInputs(speech.modes[0].inputs, inputs.slice(1, 3))),
				withoutModel: uses(planBaseHalfVideoInputs(baseHalfDefaultModeInputs('audio'), inputs)),
				defaults: [baseHalfDefaultModeInputs('image').images.max, baseHalfDefaultModeInputs('video').startFrame, baseHalfDefaultModeInputs('audio') === BASEHALF_AUDIO_DEFAULT_MODE_INPUTS, baseHalfDefaultModeId('audio'), baseHalfDefaultModeId('video')],
				refused: [baseHalfVideoInputProblem(speech, inputs.slice(1, 2))?.reason, baseHalfVideoInputProblem(song, inputs.slice(0, 4))?.reason, baseHalfVideoInputProblem(song, inputs.slice(4))?.reason]
			}, {
				lyrics: ['refs/cover.png:reference', 'refs/tune.mp3:reference', 'notes/lyrics.md:text', 'refs/second.wav:unused(full)', 'clips/take.mp4:unused(mode)'],
				references: ['refs/cover.png:reference', 'refs/tune.mp3:reference', 'notes/lyrics.md:text'],
				speech: ['refs/tune.mp3:unused(mode)', 'notes/lyrics.md:text'],
				withoutModel: ['refs/cover.png:reference', 'refs/tune.mp3:reference', 'notes/lyrics.md:text', 'refs/second.wav:reference', 'clips/take.mp4:unused(mode)'],
				defaults: [Number.MAX_SAFE_INTEGER, 'optional', true, 'reference', 'frames'],
				refused: ['Dunlin Voice takes no audio.', 'Dunlin Song takes one audio file at most.', 'Dunlin Song takes no videos.']
			});
		});

		test('a model of another kind than the card\'s blocks Generate and says what to choose', () => {
			const blocker = (kind: 'image' | 'video' | 'audio', provider: string, model: string) => {
				const found = getBaseHalfVideoGenerateBlocker({
					generating: false,
					catalog: { kind: 'ready', catalog: TEST_AUDIO_CATALOG },
					generation: { provider, model },
					kind,
					setup: candidate => ({ setUp: true, region: findBaseHalfVideoRegion(candidate, undefined) }),
					prompt: 'Rain on a tin roof.'
				});
				return found && [found.kind, baseHalfVideoGenerateBlockerText(found), isBaseHalfVideoModelBlocker(found)];
			};
			assert.deepStrictEqual([
				blocker('audio', 'acme', 'acme-motion-2'),
				blocker('audio', 'corvid', 'corvid-paint'),
				blocker('image', 'dunlin', 'dunlin-voice'),
				blocker('video', 'dunlin', 'dunlin-song'),
				blocker('video', 'corvid', 'corvid-paint'),
				blocker('audio', 'dunlin', 'dunlin-foley')
			], [
				['otherKind', 'Acme Motion 2 makes videos. Choose an audio model.', true],
				['otherKind', 'Corvid Paint makes images. Choose an audio model.', true],
				['otherKind', 'Dunlin Voice makes sounds. Choose an image model.', true],
				['otherKind', 'Dunlin Song makes sounds. Choose a video model.', true],
				['otherKind', 'Corvid Paint makes images. Choose a video model.', true],
				undefined
			]);
		});

		test('agents read what an audio model makes, the format it delivers, and its voices with whether the provider lists more', () => {
			const agents = baseHalfVideoCatalogForAgents(TEST_AUDIO_CATALOG, provider => ({ setUp: false, region: findBaseHalfVideoRegion(provider, undefined) }));
			const models = agents[3].models as { id: string; kind: string; makes?: string; outputFormat?: string; parameters: { name: string; kind: string; listed?: boolean; options?: { value: string }[] }[] }[];
			assert.deepStrictEqual(models.map(model => ({
				id: model.id,
				kind: model.kind,
				makes: model.makes,
				outputFormat: model.outputFormat,
				voice: model.parameters.filter(parameter => parameter.kind === 'voice').map(parameter => ({ listed: parameter.listed, options: parameter.options?.map(option => option.value) }))[0]
			})), [
				{ id: 'dunlin-voice', kind: 'audio', makes: 'speech', outputFormat: 'mp3', voice: { listed: true, options: ['vx-ember', 'vx-pike', 'vx-sable'] } },
				{ id: 'dunlin-song', kind: 'audio', makes: 'music', outputFormat: 'wav', voice: undefined },
				{ id: 'dunlin-foley', kind: 'audio', makes: 'sound', outputFormat: 'mp3', voice: undefined }
			]);
			assert.strictEqual((agents[2].models as { makes?: string }[]).some(model => model.makes !== undefined), false);
		});
	});
});
