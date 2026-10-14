/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	baseHalfVideoEffectiveRatio,
	baseHalfVideoInitialSettings,
	baseHalfVideoInputKindOfPath,
	buildBaseHalfVideoPrompt,
	findBaseHalfVideoLabelTokens,
	getBaseHalfVideoGenerateBlocker,
	getBaseHalfVideoModelProfile,
	IBaseHalfVideoInputSource,
	normalizeBaseHalfVideoSettings,
	planBaseHalfVideoInputs,
	stripBaseHalfMarkdownFrontMatter
} from '../../common/basehalfVideoProviders.js';

suite('BaseHalfVideoProviders', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const sources: IBaseHalfVideoInputSource[] = [
		{ path: 'idea.md', kind: 'text', available: true },
		{ path: 'a.png', kind: 'image', available: true },
		{ path: 'b.png', kind: 'image', available: true },
		{ path: 'c.png', kind: 'image', available: true },
		{ path: 'move.mp4', kind: 'video', available: true },
		{ path: 'gone.png', kind: 'image', available: false },
		{ path: 'brief.pdf', kind: 'other', available: true }
	];

	function uses(plan: ReturnType<typeof planBaseHalfVideoInputs>): string[] {
		return plan.map(item => `${item.path}:${item.use}${item.reason ? `(${item.reason})` : ''}${item.label ? `=${item.label}` : ''}`);
	}

	test('frames mode takes the first image as the start frame and the second as the end frame', () => {
		const plan = planBaseHalfVideoInputs('frames', sources, getBaseHalfVideoModelProfile('ark', 'doubao-seedance-2-5-260628'), 'zh-cn');
		assert.deepStrictEqual(uses(plan), [
			'idea.md:text',
			'a.png:start-frame=图片1',
			'b.png:end-frame=图片2',
			'c.png:unused(full)=图片3',
			'move.mp4:unused(mode)=视频1',
			'gone.png:unused(missing)=图片4',
			'brief.pdf:unused(kind)'
		]);
		const startOnly = planBaseHalfVideoInputs('frames', sources, getBaseHalfVideoModelProfile('dashscope', 'wan2.6-i2v'), 'en');
		assert.deepStrictEqual(uses(startOnly).slice(1, 3), ['a.png:start-frame=Image 1', 'b.png:unused(full)=Image 2']);
		const textOnly = planBaseHalfVideoInputs('frames', sources, getBaseHalfVideoModelProfile('dashscope', 'wan2.6-t2v'), 'en');
		assert.deepStrictEqual(uses(textOnly).slice(1, 2), ['a.png:unused(mode)=Image 1']);
	});

	test('reference mode takes inputs as far as the model and the provider carry them', () => {
		const relay = planBaseHalfVideoInputs('reference', sources, getBaseHalfVideoModelProfile('openai', 'doubao-seedance-2-5-260628'), 'en');
		assert.deepStrictEqual(uses(relay).slice(1, 5), ['a.png:reference=Image 1', 'b.png:reference=Image 2', 'c.png:reference=Image 3', 'move.mp4:reference=Video 1']);
		const ark = planBaseHalfVideoInputs('reference', sources, getBaseHalfVideoModelProfile('ark', 'doubao-seedance-2-5-260628'), 'en');
		assert.deepStrictEqual(uses(ark).slice(4, 5), ['move.mp4:unused(mode)=Video 1']);
		const gemini = planBaseHalfVideoInputs('reference', [...sources.slice(1, 4), { path: 'd.png', kind: 'image', available: true }], getBaseHalfVideoModelProfile('gemini', 'veo-model'), 'en');
		assert.deepStrictEqual(uses(gemini).map(entry => entry.split(':')[1]), ['reference=Image 1', 'reference=Image 2', 'reference=Image 3', 'unused(full)=Image 4']);
	});

	test('a provider that cannot carry references offers frames only', () => {
		assert.deepStrictEqual(getBaseHalfVideoModelProfile('minimax', 'MiniMax-Hailuo-02').modes, ['frames']);
		assert.deepStrictEqual(getBaseHalfVideoModelProfile('dashscope', 'wan-unknown').modes, ['frames']);
		assert.deepStrictEqual(getBaseHalfVideoModelProfile('openai', 'relay-video-1').modes, ['frames', 'reference']);
		assert.strictEqual(getBaseHalfVideoModelProfile('openai', 'relay-video-1').known, false);
	});

	test('keeps settings the model accepts and gives the others the model default', () => {
		const hailuo = getBaseHalfVideoModelProfile('minimax', 'MiniMax-Hailuo-02');
		assert.deepStrictEqual(normalizeBaseHalfVideoSettings({ mode: 'reference', ratio: '21:9', resolution: '1080P', duration: 10, audio: true }, hailuo),
			{ mode: 'frames', ratio: 'adaptive', resolution: '1080P', duration: 6, audio: false });
		const seedance = getBaseHalfVideoModelProfile('ark', 'doubao-seedance-2-5-260628');
		assert.deepStrictEqual(normalizeBaseHalfVideoSettings({ mode: 'reference', ratio: '21:9', resolution: '4k', duration: 45, audio: false }, seedance),
			{ mode: 'reference', ratio: '21:9', resolution: '720p', duration: 30, audio: false });
		assert.strictEqual(normalizeBaseHalfVideoSettings({ duration: -1 }, seedance).duration, -1);
		assert.strictEqual(normalizeBaseHalfVideoSettings({ duration: -1 }, hailuo).duration, 6);
		assert.deepStrictEqual(baseHalfVideoInitialSettings({ channel: 'c1', model: 'MiniMax-Hailuo-02', mode: 'frames', ratio: '16:9', resolution: '1080P', duration: 10, audio: true }, hailuo),
			{ mode: 'frames', ratio: 'adaptive', resolution: '1080P', duration: 6, audio: false, channel: 'c1', model: 'MiniMax-Hailuo-02' });
	});

	test('fixes the duration where the model allows only one, and keeps the sound of models without a switch', () => {
		const veo = getBaseHalfVideoModelProfile('gemini', 'veo-3.1-generate-preview');
		assert.deepStrictEqual([
			normalizeBaseHalfVideoSettings({ mode: 'frames', ratio: '1:1', resolution: '720p', duration: 5, audio: false }, veo),
			normalizeBaseHalfVideoSettings({ mode: 'frames', ratio: '9:16', resolution: '1080p', duration: 4, audio: false }, veo),
			normalizeBaseHalfVideoSettings({ mode: 'reference', ratio: '16:9', resolution: '720p', duration: 4, audio: false }, veo)
		], [
			{ mode: 'frames', ratio: '16:9', resolution: '720p', duration: 4, audio: true },
			{ mode: 'frames', ratio: '9:16', resolution: '1080p', duration: 8, audio: true },
			{ mode: 'reference', ratio: '16:9', resolution: '720p', duration: 8, audio: true }
		]);
		assert.deepStrictEqual(getBaseHalfVideoModelProfile('gemini', 'veo-3.1-lite-generate-preview').modes, ['frames']);
		assert.deepStrictEqual(getBaseHalfVideoModelProfile('gemini', 'veo-4-preview').resolutions, ['720p', '1080p', '4k']);
		assert.strictEqual(normalizeBaseHalfVideoSettings({ audio: false }, getBaseHalfVideoModelProfile('dashscope', 'wan2.6-i2v')).audio, true);
	});

	test('a frames generation with a start frame sends the ratio the model requires', () => {
		const seedance = getBaseHalfVideoModelProfile('ark', 'doubao-seedance-2-5-260628');
		const settings = { mode: 'frames' as const, ratio: '9:16', resolution: '720p', duration: 5, audio: true };
		assert.deepStrictEqual(
			[baseHalfVideoEffectiveRatio(settings, seedance, true), baseHalfVideoEffectiveRatio(settings, seedance, false), baseHalfVideoEffectiveRatio({ ...settings, mode: 'reference' }, seedance, true)],
			['adaptive', '9:16', '9:16']
		);
	});

	test('names inputs by kind and finds the names in a prompt in both languages', () => {
		assert.deepStrictEqual(findBaseHalfVideoLabelTokens('让图片1里的人走进图片2，配上音频1。Then Video 2 fades.').map(token => `${token.kind}${token.ordinal}@${token.start}`), ['image1@1', 'image2@9', 'audio1@15', 'video2@24']);
		assert.deepStrictEqual(['a.PNG', 'b.webm', 'c.m4a', 'note.md', 'deck.pdf', 'clip.bhnode'].map(baseHalfVideoInputKindOfPath), ['image', 'video', 'audio', 'text', 'other', 'other']);
	});

	test('builds the prompt from the node prompt and text inputs without front matter', () => {
		const note = stripBaseHalfMarkdownFrontMatter('---\nupstream:\n  - a.md\n---\n# Scene\n\nRain on the window.\n');
		assert.strictEqual(buildBaseHalfVideoPrompt('  Slow push in.  ', [note, '   ']), 'Slow push in.\n\n# Scene\n\nRain on the window.');
		assert.strictEqual(buildBaseHalfVideoPrompt('', ['Only the note.']), 'Only the note.');
	});

	test('names the first thing that keeps a node from generating', () => {
		const plan = planBaseHalfVideoInputs('frames', sources.slice(1, 2), getBaseHalfVideoModelProfile('ark', 'doubao-seedance-2-5-260628'), 'en');
		const ready = { generating: false, model: 'm', channelFound: true, channelHasKey: true, prompt: '', plan };
		assert.deepStrictEqual([
			getBaseHalfVideoGenerateBlocker({ ...ready, generating: true }),
			getBaseHalfVideoGenerateBlocker({ ...ready, model: undefined }),
			getBaseHalfVideoGenerateBlocker({ ...ready, channelFound: false }),
			getBaseHalfVideoGenerateBlocker({ ...ready, channelHasEndpoint: false, channelHasKey: false }),
			getBaseHalfVideoGenerateBlocker({ ...ready, channelHasKey: false }),
			getBaseHalfVideoGenerateBlocker({ ...ready, plan: [] }),
			getBaseHalfVideoGenerateBlocker(ready),
			getBaseHalfVideoGenerateBlocker({ ...ready, plan: [], prompt: 'Rain' })
		], ['generating', 'noModel', 'noChannel', 'noEndpoint', 'noKey', 'nothingToSend', undefined, undefined]);
	});
});
