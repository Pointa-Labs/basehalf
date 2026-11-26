/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from 'assert';
import { ALIBABA } from '../../node/alibaba.js';
import { BFL } from '../../node/bfl.js';
import { BYTEDANCE } from '../../node/bytedance.js';
import { GOOGLE } from '../../node/google.js';
import { KLING } from '../../node/kling.js';
import { LUMA } from '../../node/luma.js';
import type { ProviderModule } from '../../node/module.js';
import { MINIMAX } from '../../node/minimax.js';
import { PIXVERSE } from '../../node/pixverse.js';
import { promptLanguage, writeSharedPromptNames } from '../../node/prompt.js';
import { RUNWAY } from '../../node/runway.js';
import { VIDU } from '../../node/vidu.js';
import { XAI } from '../../node/xai.js';
import type { ModeId, PlannedMedia, PromptInput, PromptPart } from '../../common/basehalfProviderTypes.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('BaseHalf providers: promptNames', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	/**
	 * How each provider module writes the mentions of a prompt (D74; providers,
	 * "Names in the prompt"), as its provider's documentation names the inputs.
	 * The names do not read the files, so the media are stand-ins.
	 */

	const MEDIA = { fsPath: '/nowhere/input', mimeType: 'image/png' };

	function inputs(counts: { readonly start?: boolean; readonly end?: boolean; readonly source?: boolean; readonly images?: number; readonly videos?: number; readonly audios?: number }): PlannedMedia {
		const many = (count = 0) => Array.from({ length: count }, () => MEDIA);
		return {
			...(counts.start ? { startFrame: MEDIA } : {}),
			...(counts.end ? { endFrame: MEDIA } : {}),
			...(counts.source ? { source: MEDIA } : {}),
			images: many(counts.images),
			videos: many(counts.videos),
			audios: many(counts.audios)
		};
	}

	const start: PromptInput = { input: 'startFrame' };
	const end: PromptInput = { input: 'endFrame' };
	const source: PromptInput = { input: 'source' };
	const image = (index: number): PromptInput => ({ input: 'images', index });
	const video = (index: number): PromptInput => ({ input: 'videos', index });
	const audio = (index: number): PromptInput => ({ input: 'audios', index });

	/** The mentions written by `module` for the model, the mode, and the inputs, with `text` between them and `after` behind them. */
	function names(module: ProviderModule, model: string, mode: ModeId, planned: PlannedMedia, mentions: readonly PromptInput[], text = ' and ', after = ''): string {
		const prompt: PromptPart[] = [...mentions.flatMap((mention, index) => index ? [text, mention] : [mention]), ...(after ? [after] : [])];
		assert.ok(module.writePrompt, 'the module writes its own names');
		return module.writePrompt(prompt, { model, mode, params: {}, inputs: planned });
	}

	test('the shared names count each kind of reference from 1 in the request, name a frame and the clip by what they are, and follow the language of the text', () => {
		const english: PromptPart[] = [start, ' becomes ', end, '; ', image(1), ', ', video(0), ', ', audio(2), ', and ', source, '.'];
		const chinese: PromptPart[] = [start, '变成', end, '；', image(1), '、', video(0), '、', audio(2), '和', source, '。'];
		assert.deepEqual({
			english: writeSharedPromptNames(english),
			chinese: writeSharedPromptNames(chinese),
			languages: [promptLanguage(['A cat.']), promptLanguage(['一只猫']), promptLanguage([image(0)]), promptLanguage(['日本の猫'])]
		}, {
			english: 'the first frame becomes the last frame; Image 2, Video 1, Audio 3, and the source video.',
			chinese: '首帧变成尾帧；图片2、视频1、音频3和原视频。',
			languages: ['en', 'zh', 'en', 'zh']
		});
	});

	test('ByteDance: Seedance 2.5 reads @图片1 and @Image 1, the 2.0 series 图片1 and Image 1, Seedream 图1 and Image 1; a frame is the first or the last frame', () => {
		const references = inputs({ images: 2, audios: 1 });
		assert.deepEqual([
			names(BYTEDANCE, 'seedance-2.5', 'reference', references, [image(1), audio(0)]),
			names(BYTEDANCE, 'seedance-2.5', 'reference', references, [image(0), audio(0)], '和'),
			names(BYTEDANCE, 'seedance-2.0', 'reference', references, [image(1), audio(0)]),
			names(BYTEDANCE, 'seedance-2.0-mini', 'reference', references, [image(0)], '', '里的人'),
			names(BYTEDANCE, 'seedance-2.5', 'frames', inputs({ start: true, end: true }), [start, end]),
			names(BYTEDANCE, 'seedream-5.0-pro', 'reference', inputs({ images: 3 }), [image(2), image(0)]),
			names(BYTEDANCE, 'seedream-5.0-pro', 'reference', inputs({ images: 3 }), [image(2), image(0)], '换成')
		], [
			'@Image 2 and @Audio 1',
			'@图片1和@音频1',
			'Image 2 and Audio 1',
			'图片1里的人',
			'the first frame and the last frame',
			'Image 3 and Image 1',
			'图3换成图1'
		]);
	});

	test('Alibaba: Wan 3.0 counts each kind in the order of media, the clip first; Wan 2.7, HappyHorse, and the image models read their own names', () => {
		assert.deepEqual([
			names(ALIBABA, 'wan3.0', 'edit', inputs({ source: true, images: 2 }), [source, image(1)]),
			names(ALIBABA, 'wan3.0', 'reference', inputs({ images: 1, videos: 2, audios: 1 }), [video(1), image(0), audio(0)]),
			names(ALIBABA, 'wan3.0', 'frames', inputs({ start: true, end: true }), [start, end], '到'),
			names(ALIBABA, 'wan2.7', 'reference', inputs({ images: 2, videos: 1 }), [image(1), video(0)]),
			names(ALIBABA, 'wan2.7', 'reference', inputs({ images: 2, videos: 1 }), [image(1), video(0)], '和'),
			names(ALIBABA, 'happyhorse-1.1', 'reference', inputs({ images: 2 }), [image(1)], '', '中的女性'),
			names(ALIBABA, 'qwen-image-3.0-pro', 'reference', inputs({ images: 2 }), [image(0), image(1)]),
			names(ALIBABA, 'qwen-image-3.0-pro', 'reference', inputs({ images: 2 }), [image(0), image(1)], '换成')
		], [
			'Video 1 and Image 2',
			'Video 2 and Image 1 and Audio 1',
			'图片1到图片2',
			'Image 2 and Video 1',
			'图2和视频1',
			'[Image 2]中的女性',
			'image 1 and image 2',
			'图1换成图2'
		]);
	});

	test('Kling: an omni video model reads @ and the id of its image items, frames counted first; an omni image model <<<image_1>>>; the others the shared names', () => {
		assert.deepEqual([
			names(KLING, 'kling-3.0-omni', 'frames', inputs({ start: true, end: true }), [start, end]),
			names(KLING, 'kling-o1', 'reference', inputs({ images: 3 }), [image(2), image(0)]),
			names(KLING, 'kling-image-3.0-omni', 'reference', inputs({ images: 2 }), [image(1), image(0)]),
			names(KLING, 'kling-3.0', 'frames', inputs({ start: true }), [start]),
			names(KLING, 'kling-image-3.0', 'reference', inputs({ images: 1 }), [image(0)])
		], [
			'@image_1 and @image_2',
			'@image_3 and @image_1',
			'<<<image_2>>> and <<<image_1>>>',
			'the first frame',
			'Image 1'
		]);
	});

	test('MiniMax: the V2 models read reference image 1 and 参考图1; the frames and the V1 models take the shared names', () => {
		assert.deepEqual([
			names(MINIMAX, 'h3', 'reference', inputs({ images: 2, videos: 1, audios: 1 }), [image(1), video(0), audio(0)]),
			names(MINIMAX, 'h3-max', 'reference', inputs({ images: 2 }), [image(0)], '', '的人物'),
			names(MINIMAX, 'h3', 'frames', inputs({ start: true }), [start]),
			names(MINIMAX, 'hailuo-2.3', 'frames', inputs({ start: true, end: true }), [start, end])
		], [
			'reference image 2 and reference video 1 and reference audio 1',
			'参考图1的人物',
			'the first frame',
			'the first frame and the last frame'
		]);
	});

	test('Google: Gemini Omni reads the tags of its roles, counting references from 0; the image models take the shared names', () => {
		assert.deepEqual([
			names(GOOGLE, 'gemini-omni-1.1-flash', 'frames', inputs({ start: true, end: true }), [start, end]),
			names(GOOGLE, 'gemini-omni-1.1-flash', 'reference', inputs({ images: 2, videos: 1 }), [image(1), video(0)]),
			names(GOOGLE, 'gemini-omni-1.1-flash', 'extend', inputs({ source: true }), [source]),
			names(GOOGLE, 'gemini-3.1-flash-image', 'reference', inputs({ images: 2 }), [image(1)])
		], [
			'<FIRST_FRAME> and <LAST_FRAME>',
			'<IMAGE_REF_1> and <VIDEO_REF_0>',
			'the source video',
			'Image 2'
		]);
	});

	test('Vidu: Q4 Preview reads [@reference_image_1] and [reference_audio_1], 参考图1 and 参考音频1; its other models take the shared names', () => {
		assert.deepEqual([
			names(VIDU, 'q4-preview', 'reference', inputs({ images: 3, audios: 1 }), [image(1), audio(0), image(2)]),
			names(VIDU, 'q4-preview', 'reference', inputs({ images: 2, audios: 1 }), [image(0), audio(0)], '使用'),
			names(VIDU, 'q3', 'reference', inputs({ images: 2 }), [image(1)]),
			names(VIDU, 'q3-pro', 'frames', inputs({ start: true, end: true }), [start, end])
		], [
			'[@reference_image_2] and [reference_audio_1] and [@reference_image_3]',
			'参考图1使用参考音频1',
			'Image 2',
			'the first frame and the last frame'
		]);
	});

	test('xAI reads <IMAGE_0> onward; Runway @image1 for a tagged reference; BFL Image 1 for FLUX 3 and image 1 for FLUX.2, in every language', () => {
		assert.deepEqual([
			names(XAI, 'grok-imagine-image-2.0', 'reference', inputs({ images: 2 }), [image(0), image(1)]),
			names(XAI, 'grok-imagine-video-1.5', 'reference', inputs({ images: 3 }), [image(2)]),
			names(XAI, 'grok-imagine-video-1.5', 'frames', inputs({ start: true }), [start]),
			names(RUNWAY, 'gen4_image', 'reference', inputs({ images: 3 }), [image(2), image(0)]),
			names(RUNWAY, 'gen4.5', 'frames', inputs({ start: true }), [start]),
			names(BFL, 'flux-3-image', 'reference', inputs({ images: 2 }), [image(1), image(0)], '的风格画'),
			names(BFL, 'flux-2-pro', 'reference', inputs({ images: 2 }), [image(1)])
		], [
			'<IMAGE_0> and <IMAGE_1>',
			'<IMAGE_2>',
			'the first frame',
			'@image3 and @image1',
			'the first frame',
			'Image 2的风格画Image 1',
			'image 2'
		]);
	});

	test('PixVerse mentions a reference as @ and its ref_name followed by a space; Luma names an edit\'s source and its references by their order', () => {
		const planned = inputs({ images: 2, videos: 1 });
		assert.ok(PIXVERSE.writePrompt && LUMA.writePrompt);
		assert.deepEqual([
			PIXVERSE.writePrompt([image(1), '在', video(0), ' 里跳舞，', image(0)], { model: 'pixverse-v6', mode: 'reference', params: {}, inputs: planned }),
			names(PIXVERSE, 'pixverse-v6', 'frames', inputs({ start: true }), [start]),
			names(LUMA, 'uni-1', 'reference', inputs({ images: 3 }), [image(0), image(1), image(2)]),
			names(LUMA, 'ray-3.2', 'edit', inputs({ source: true, images: 1 }), [source, image(0)])
		], [
			'@image2 在@video1 里跳舞，@image1 ',
			'the first frame',
			'the source image and the first reference and the second reference',
			'the source video and the start frame'
		]);
	});
});
