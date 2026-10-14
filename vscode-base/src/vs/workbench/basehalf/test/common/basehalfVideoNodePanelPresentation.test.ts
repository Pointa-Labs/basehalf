/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { isMacintosh } from '../../../../base/common/platform.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IBaseHalfVideoChannel } from '../../common/basehalfVideoGeneration.js';
import { IBaseHalfVideoGenerationSettings, IBaseHalfVideoNodeFields } from '../../common/basehalfVideoNode.js';
import {
	baseHalfVideoPanelChangeSettings,
	baseHalfVideoPanelChooseModel,
	baseHalfVideoPanelInputFileName,
	baseHalfVideoPanelMentionQuery,
	baseHalfVideoPanelPromptMarks,
	createBaseHalfVideoPanelPresentation,
	filterBaseHalfVideoPanelNames,
	IBaseHalfVideoPanelInputItem,
	IBaseHalfVideoPanelPresentation,
	IBaseHalfVideoPanelState,
	swapBaseHalfVideoUpstreamEntries
} from '../../common/basehalfVideoNodePanelPresentation.js';
import { getBaseHalfVideoModelProfile, IBaseHalfVideoInputSource } from '../../common/basehalfVideoProviders.js';

suite('BaseHalfVideoNodePanelPresentation', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const SEEDANCE = 'doubao-seedance-2-5-260628';
	const ark: IBaseHalfVideoChannel = { id: 'ark-1', provider: 'ark', name: 'Volcengine Ark', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', models: [SEEDANCE], hasKey: true };
	const relay: IBaseHalfVideoChannel = { id: 'relay-1', provider: 'openai', name: 'Studio Relay', baseUrl: 'https://relay.example/v1', models: [SEEDANCE, 'relay-video-1'], hasKey: false };
	const empty: IBaseHalfVideoChannel = { id: 'gemini-1', provider: 'gemini', name: '', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', models: [], hasKey: true };
	const frames: IBaseHalfVideoGenerationSettings = { channel: 'ark-1', model: SEEDANCE, mode: 'frames', ratio: '16:9', resolution: '720p', duration: 5, audio: true };

	/** Three images, a video, a text note, and a PDF, connected in that order (acceptance criterion 3). */
	const sources: IBaseHalfVideoInputSource[] = [
		{ path: 'frames/a.png', kind: 'image', available: true },
		{ path: 'frames/b.png', kind: 'image', available: true },
		{ path: 'frames/c.png', kind: 'image', available: true },
		{ path: 'clips/move.mp4', kind: 'video', available: true },
		{ path: 'notes/scene.md', kind: 'text', available: true },
		{ path: 'docs/brief.pdf', kind: 'other', available: true }
	];

	function present(options: Partial<IBaseHalfVideoPanelState> & { readonly generation?: IBaseHalfVideoGenerationSettings; readonly noModel?: true; readonly fieldsExtra?: IBaseHalfVideoNodeFields } = {}): IBaseHalfVideoPanelPresentation {
		const generation = options.noModel ? undefined : options.generation ?? frames;
		const channels = options.channels ?? [ark, relay];
		const model = generation?.model;
		const channel = model ? channels.find(candidate => candidate.id === generation?.channel && candidate.models.includes(model)) ?? channels.find(candidate => candidate.models.includes(model)) : undefined;
		return createBaseHalfVideoPanelPresentation({
			fields: { prompt: 'A slow push in.', ...(generation ? { generation } : {}), ...options.fieldsExtra },
			inputs: options.inputs ?? sources,
			channels,
			choice: channel && model ? { channel, model } : undefined,
			generating: options.generating ?? false,
			prompt: options.prompt ?? 'A slow push in.',
			displayLanguage: options.displayLanguage ?? 'en'
		});
	}

	function describe(item: IBaseHalfVideoPanelInputItem): string {
		return `${item.name}:${item.use}${item.reason ? ` (${item.reason})` : ''}`;
	}

	test('frames mode fills the start and end slots and dims the rest with their reasons', () => {
		const presentation = present();
		const row = presentation.inputRow!;
		assert.deepStrictEqual({
			slots: row.slots.map(slot => `${slot.title}=${slot.item ? slot.item.path : 'empty'}`),
			swapped: row.swappedUpstream,
			items: row.items.map(describe),
			startTooltip: row.slots[0].item?.tooltip,
			// The note's text joins the prompt; nothing else counts as sent.
			blocker: presentation.blocker
		}, {
			slots: ['Start=frames/a.png', 'End=frames/b.png'],
			swapped: ['frames/b.png', 'frames/a.png', 'frames/c.png', 'clips/move.mp4', 'notes/scene.md', 'docs/brief.pdf'],
			items: [
				'Image 3:unused (Not used: Frames mode takes the first two images.)',
				'Video 1:unused (Not used: Frames mode uses images only.)',
				'scene:text',
				'brief.pdf:unused (Not used: this kind of file cannot be sent to a video model.)'
			],
			startTooltip: 'Start frame · Image 1\nframes/a.png',
			blocker: undefined
		});
	});

	test('references mode on a relay uses the three images and the video, in order', () => {
		const presentation = present({ generation: { ...frames, channel: 'relay-1', mode: 'reference' }, channels: [{ ...relay, hasKey: true }] });
		assert.deepStrictEqual({
			mode: presentation.settings.mode,
			slots: presentation.inputRow?.slots.length,
			items: presentation.inputRow?.items.map(describe),
			names: presentation.names.map(name => `${name.label}=${name.path}${name.used ? '' : ' (unused)'}`)
		}, {
			mode: 'reference',
			slots: 0,
			items: ['Image 1:reference', 'Image 2:reference', 'Image 3:reference', 'Video 1:reference', 'scene:text', 'brief.pdf:unused (Not used: this kind of file cannot be sent to a video model.)'],
			names: ['Image 1=frames/a.png', 'Image 2=frames/b.png', 'Image 3=frames/c.png', 'Video 1=clips/move.mp4']
		});
	});

	test('says why each input is not used, by the model and the provider', () => {
		const reasons = (presentation: IBaseHalfVideoPanelPresentation) => [...presentation.inputRow?.slots.flatMap(slot => slot.item ? [slot.item] : []) ?? [], ...presentation.inputRow?.items ?? []]
			.filter(item => !item.used)
			.map(item => `${item.path}: ${item.reason}`);
		const wan = { id: 'wan-1', provider: 'dashscope' as const, name: 'Model Studio', baseUrl: '', models: ['wan2.6-i2v', 'wan2.6-t2v'], hasKey: true };
		const gemini = { ...empty, models: ['veo-3'] };
		assert.deepStrictEqual({
			startFrameOnly: reasons(present({ generation: { ...frames, channel: 'wan-1', model: 'wan2.6-i2v' }, channels: [wan], inputs: sources.slice(0, 2) })),
			textOnly: reasons(present({ generation: { ...frames, channel: 'wan-1', model: 'wan2.6-t2v' }, channels: [wan], inputs: sources.slice(0, 1) })),
			missing: reasons(present({ inputs: [{ path: 'gone.png', kind: 'image', available: false }] })),
			noLocalVideos: reasons(present({ generation: { ...frames, mode: 'reference' }, inputs: sources.slice(3, 4) })),
			tooManyImages: reasons(present({
				generation: { ...frames, channel: 'gemini-1', model: 'veo-3', mode: 'reference' },
				channels: [gemini],
				inputs: [...sources.slice(0, 3), { path: 'frames/d.png', kind: 'image', available: true }]
			}))
		}, {
			startFrameOnly: ['frames/b.png: Not used: Wan 2.6 Image to Video takes a start frame only.'],
			textOnly: ['frames/a.png: Not used: Wan 2.6 makes video from text only.'],
			missing: ['gone.png: Not used: the file is missing, or the node shows no file yet.'],
			noLocalVideos: ['clips/move.mp4: Not used: Seedance 2.5 takes no video references from this computer.'],
			tooManyImages: ['frames/d.png: Not used: veo-3 takes up to 3 images.']
		});
	});

	test('a text-only model with no inputs shows no input row, and an empty references row says what the plus does', () => {
		const wan = { id: 'wan-1', provider: 'dashscope' as const, name: 'Model Studio', baseUrl: '', models: ['wan2.6-t2v'], hasKey: true };
		const textOnly = present({ generation: { ...frames, channel: 'wan-1', model: 'wan2.6-t2v' }, channels: [wan], inputs: [] });
		const references = present({ generation: { ...frames, mode: 'reference' }, inputs: [] });
		const noModel = present({ noModel: true, inputs: [] });
		assert.deepStrictEqual({
			textOnly: textOnly.inputRow,
			references: references.inputRow?.emptyHint,
			noModelSlots: noModel.inputRow?.slots.map(slot => `${slot.title}: ${slot.addLabel}`)
		}, {
			textOnly: undefined,
			references: 'Add images, videos, or audio as references',
			noModelSlots: ['Start: Add a Start Frame', 'End: Add an End Frame']
		});
	});

	test('sums up the settings as they are sent, and offers only what the model accepts', () => {
		const plain = present({ inputs: [] });
		const withStartFrame = present();
		const hailuo = present({
			generation: { channel: 'mm', model: 'MiniMax-Hailuo-02', mode: 'frames', ratio: 'adaptive', resolution: '1080P', duration: 6, audio: false },
			channels: [{ id: 'mm', provider: 'minimax', name: 'MiniMax', baseUrl: '', models: ['MiniMax-Hailuo-02'], hasKey: true }],
			inputs: []
		});
		const auto = present({ generation: { ...frames, duration: -1, audio: false }, inputs: [] });
		assert.deepStrictEqual({
			plain: plain.settingsView.summary,
			plainModes: plain.settingsView.modes?.map(choice => `${choice.label}${choice.selected ? '*' : ''}`),
			plainRatios: plain.settingsView.ratios?.choices.map(choice => `${choice.label}${choice.shape ? `(${choice.shape.width}x${choice.shape.height})` : ''}${choice.selected ? '*' : ''}`),
			plainResolutions: plain.settingsView.resolutions?.map(choice => choice.value),
			plainDuration: plain.settingsView.duration,
			withStartFrame: withStartFrame.settingsView.summary,
			withStartFrameRatio: { sent: withStartFrame.ratio, follows: withStartFrame.settingsView.ratios?.followsStartFrame, note: withStartFrame.settingsView.ratios?.note },
			hailuo: hailuo.settingsView.summary,
			hailuoHidden: [hailuo.settingsView.modes, hailuo.settingsView.ratios, hailuo.settingsView.sound],
			hailuoDurations: hailuo.settingsView.duration.kind === 'choices' ? hailuo.settingsView.duration.choices.map(choice => `${choice.label}${choice.selected ? '*' : ''}${choice.disabled ? ` (${choice.title})` : ''}`) : [],
			auto: auto.settingsView.summary,
			autoDuration: auto.settingsView.duration.kind === 'range' ? { value: auto.settingsView.duration.value, label: auto.settingsView.duration.valueLabel, auto: auto.settingsView.duration.auto } : undefined
		}, {
			plain: 'Frames · 16:9 · 720p · 5s · Sound',
			plainModes: ['Frames*', 'References'],
			plainRatios: ['16:9(16x9)*', '4:3(4x3)', '1:1(1x1)', '3:4(3x4)', '9:16(9x16)', '21:9(21x9)', 'Adaptive'],
			plainResolutions: ['480p', '720p', '1080p'],
			plainDuration: { kind: 'range', min: 4, max: 30, value: 5, valueLabel: '5s', auto: { selected: false, label: 'Auto' } },
			withStartFrame: 'Frames · Adaptive · 720p · 5s · Sound',
			withStartFrameRatio: { sent: 'adaptive', follows: true, note: 'Follows the start frame' },
			hailuo: 'Frames · 1080P · 6s',
			hailuoHidden: [undefined, undefined, undefined],
			hailuoDurations: ['6s*', '10s (Up to 6s at 1080P)'],
			auto: 'Frames · 16:9 · 720p · Auto · No sound',
			autoDuration: { value: 5, label: 'Auto', auto: { selected: true, label: 'Auto' } }
		});
	});

	test('choosing a model keeps what it accepts and gives the rest its default', () => {
		const hailuo = baseHalfVideoPanelChooseModel({ ...frames, mode: 'reference', ratio: '21:9', resolution: '1080p', duration: 12 }, { id: 'mm', provider: 'minimax' }, 'MiniMax-Hailuo-02');
		const seedance = baseHalfVideoPanelChooseModel(hailuo, ark, SEEDANCE);
		const changed = baseHalfVideoPanelChangeSettings(frames, { resolution: '4k', duration: 99 }, getBaseHalfVideoModelProfile('ark', SEEDANCE));
		assert.deepStrictEqual({ hailuo, seedance, changed }, {
			// One mode, no ratio to choose, no 1080p in lower case, 12 s is nearest to 10 s, no sound switch.
			hailuo: { mode: 'frames', ratio: 'adaptive', resolution: '768P', duration: 10, audio: false, channel: 'mm', model: 'MiniMax-Hailuo-02' },
			// Seedance accepts adaptive and 10 s, and keeps the sound off; 768P becomes its default.
			seedance: { mode: 'frames', ratio: 'adaptive', resolution: '720p', duration: 10, audio: false, channel: 'ark-1', model: SEEDANCE },
			changed: { mode: 'frames', ratio: '16:9', resolution: '720p', duration: 30, audio: true, channel: 'ark-1', model: SEEDANCE }
		});
	});

	test('the Generate button names the first blocker, and the model button is outlined for the model, the channel, and the key', () => {
		const states = {
			generating: present({ generating: true }),
			noModel: present({ noModel: true }),
			noChannel: present({ channels: [] }),
			noKey: present({ generation: { ...frames, channel: 'relay-1' }, channels: [relay] }),
			nothingToSend: present({ prompt: '  ', inputs: [] }),
			ready: present(),
			video: present({ fieldsExtra: { result: { source: 'imported', artifact: { kind: 'video', path: 'clip.mp4', size: 10 } } } })
		};
		const key = isMacintosh ? '⌘Enter' : 'Ctrl+Enter';
		assert.deepStrictEqual(Object.fromEntries(Object.entries(states).map(([name, presentation]) => [name, {
			blocker: presentation.blocker,
			generate: presentation.generate,
			model: { label: presentation.model.label, outlined: presentation.model.outlined, title: presentation.model.title }
		}])), {
			generating: {
				blocker: 'generating',
				generate: { kind: 'stop', enabled: true, label: 'Stop Generating', title: 'Stop Generating' },
				model: { label: 'Seedance 2.5', outlined: false, title: 'Seedance 2.5 on Volcengine Ark' }
			},
			noModel: {
				blocker: 'noModel',
				generate: { kind: 'generate', enabled: false, label: 'Choose a model to generate.', title: 'Choose a model to generate.' },
				model: { label: 'Choose Model', outlined: true, title: 'Choose a model to generate.' }
			},
			noChannel: {
				blocker: 'noChannel',
				generate: { kind: 'generate', enabled: false, label: 'No video provider on this computer offers Seedance 2.5.', title: 'No video provider on this computer offers Seedance 2.5.' },
				model: { label: 'Seedance 2.5', outlined: true, title: 'No video provider on this computer offers Seedance 2.5.' }
			},
			noKey: {
				blocker: 'noKey',
				generate: { kind: 'generate', enabled: false, label: 'Studio Relay has no API key. Add one in Video Providers.', title: 'Studio Relay has no API key. Add one in Video Providers.' },
				model: { label: 'Seedance 2.5', outlined: true, title: 'Studio Relay has no API key. Add one in Video Providers.' }
			},
			nothingToSend: {
				blocker: 'nothingToSend',
				generate: { kind: 'generate', enabled: false, label: 'Write a prompt or connect an input to generate.', title: 'Write a prompt or connect an input to generate.' },
				model: { label: 'Seedance 2.5', outlined: false, title: 'Seedance 2.5 on Volcengine Ark' }
			},
			ready: {
				blocker: undefined,
				generate: { kind: 'generate', enabled: true, label: 'Generate', title: `Generate (${key})` },
				model: { label: 'Seedance 2.5', outlined: false, title: 'Seedance 2.5 on Volcengine Ark' }
			},
			video: {
				blocker: undefined,
				generate: { kind: 'generate', enabled: true, label: 'Generate', title: `Generate a new video in a new node beside this one (${key})` },
				model: { label: 'Seedance 2.5', outlined: false, title: 'Seedance 2.5 on Volcengine Ark' }
			}
		});
	});

	test('the model menu lists the models of every channel, grouped by channel, and ends with the providers page', () => {
		const presentation = present({ channels: [ark, relay, empty] });
		const none = present({ channels: [], noModel: true });
		assert.deepStrictEqual({
			groups: presentation.modelMenu.groups.map(group => ({
				label: group.label,
				detail: group.detail,
				items: group.items.map(item => `${item.label}${item.checked ? '*' : ''}`),
				empty: group.empty
			})),
			settings: presentation.modelMenu.settingsLabel,
			none: { groups: none.modelMenu.groups.length, settings: none.modelMenu.settingsLabel }
		}, {
			groups: [
				{ label: 'Volcengine Ark', detail: undefined, items: ['Seedance 2.5*'], empty: undefined },
				{ label: 'Studio Relay', detail: 'OpenAI Compatible · No API key', items: ['Seedance 2.5', 'relay-video-1'], empty: undefined },
				{ label: 'Google Gemini', detail: undefined, items: [], empty: 'No models. Add one in Video Providers.' }
			],
			settings: 'Manage Video Providers…',
			none: { groups: 0, settings: 'Add a Video Provider…' }
		});
	});

	test('marks the names in a prompt and underlines a name that matches no input', () => {
		const plan = present().plan;
		const prompt = 'Image 1 walks into Image 2, then Video 1 and Image 4; 图片3 waves.';
		assert.deepStrictEqual(baseHalfVideoPanelPromptMarks(prompt, plan).map(mark => `${prompt.slice(mark.start, mark.end)}${mark.known ? '' : '?'}`), [
			'Image 1', 'Image 2', 'Video 1', 'Image 4?', '图片3'
		]);
	});

	test('opens the @ menu after a space or a character, never inside an e-mail address, and filters the names', () => {
		const names = present({ generation: { ...frames, mode: 'reference' } }).names;
		assert.deepStrictEqual({
			start: baseHalfVideoPanelMentionQuery('@', 1),
			afterSpace: baseHalfVideoPanelMentionQuery('a cat @Ima', 10),
			afterChinese: baseHalfVideoPanelMentionQuery('让@图片', 4),
			email: baseHalfVideoPanelMentionQuery('mail me@home', 12),
			afterSpaceTyped: baseHalfVideoPanelMentionQuery('@image 1', 8),
			filtered: filterBaseHalfVideoPanelNames(names, 'ima').map(name => name.label),
			byFile: filterBaseHalfVideoPanelNames(names, 'move').map(name => name.label),
			compact: filterBaseHalfVideoPanelNames(names, 'video1').map(name => name.label)
		}, {
			start: { start: 0, query: '' },
			afterSpace: { start: 6, query: 'Ima' },
			afterChinese: { start: 1, query: '图片' },
			email: undefined,
			afterSpaceTyped: undefined,
			filtered: ['Image 1', 'Image 2', 'Image 3'],
			byFile: ['Video 1'],
			compact: ['Video 1']
		});
	});

	test('swaps two upstream entries and nothing else, and names inputs as the canvas does', () => {
		assert.deepStrictEqual({
			swapped: swapBaseHalfVideoUpstreamEntries(['a.png', 'note.md', 'b.png'], 0, 2),
			unchanged: swapBaseHalfVideoUpstreamEntries(['a.png'], 0, 3),
			names: ['notes/Scene.md', 'shots/Shot 1.bhnode', 'frames/a.png', 'docs/brief.pdf'].map(baseHalfVideoPanelInputFileName)
		}, {
			swapped: ['b.png', 'note.md', 'a.png'],
			unchanged: ['a.png'],
			names: ['Scene', 'Shot 1', 'a.png', 'brief.pdf']
		});
	});
});
