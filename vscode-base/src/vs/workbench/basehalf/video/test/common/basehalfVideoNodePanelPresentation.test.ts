/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { isMacintosh } from '../../../../../base/common/platform.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	BaseHalfVideoCatalogState,
	findBaseHalfVideoRegion,
	IBaseHalfVideoCatalogProvider,
	IBaseHalfVideoGenerationChoice,
	IBaseHalfVideoInputSource,
	parseBaseHalfVideoCatalog
} from '../../common/basehalfVideoCatalog.js';
import {
	BaseHalfVideoPanelControl,
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
import { TEST_GENERATION_CATALOG, TEST_VIDEO_CATALOG } from './basehalfVideoCatalogFixture.js';

suite('BaseHalfVideoNodePanelPresentation', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const ready: BaseHalfVideoCatalogState = { kind: 'ready', catalog: TEST_VIDEO_CATALOG };
	const frames: IBaseHalfVideoGenerationChoice = { provider: 'acme', model: 'acme-motion-2', mode: 'frames', params: { resolution: '720p', duration: 5, sound: true } };

	/** Three images, a video, a text note, and a PDF, connected in that order (acceptance criterion 3). */
	const sources: IBaseHalfVideoInputSource[] = [
		{ path: 'frames/a.png', kind: 'image', available: true },
		{ path: 'frames/b.png', kind: 'image', available: true },
		{ path: 'frames/c.png', kind: 'image', available: true },
		{ path: 'clips/move.mp4', kind: 'video', available: true },
		{ path: 'notes/scene.md', kind: 'text', available: true },
		{ path: 'docs/brief.pdf', kind: 'other', available: true }
	];

	interface IPresentOptions extends Partial<Omit<IBaseHalfVideoPanelState, 'setup' | 'info'>> {
		readonly generation?: IBaseHalfVideoGenerationChoice;
		readonly noModel?: true;
		readonly regions?: Readonly<Record<string, string>>;
		readonly notSetUp?: readonly string[];
	}

	function present(options: IPresentOptions = {}): IBaseHalfVideoPanelPresentation {
		const generation = options.noModel ? undefined : options.generation ?? frames;
		return createBaseHalfVideoPanelPresentation({
			info: { prompt: 'A slow push in.', ...generation },
			kind: options.kind ?? 'video',
			hasFile: options.hasFile ?? false,
			inputs: options.inputs ?? sources,
			texts: options.texts ?? new Map([['notes/scene.md', 'The sea at dusk.']]),
			catalog: options.catalog ?? ready,
			setup: (provider: IBaseHalfVideoCatalogProvider) => ({
				region: findBaseHalfVideoRegion(provider, options.regions?.[provider.id]),
				setUp: !(options.notSetUp ?? ['borealis']).includes(provider.id)
			}),
			...(options.check ? { check: options.check } : {}),
			generating: options.generating ?? false,
			prompt: options.prompt ?? 'A slow push in.',
			displayLanguage: options.displayLanguage ?? 'en'
		});
	}

	function describe(item: IBaseHalfVideoPanelInputItem): string {
		return `${item.name}:${item.use}${item.reason ? ` (${item.reason})` : ''}`;
	}

	function controls(list: readonly BaseHalfVideoPanelControl[]): string[] {
		return list.map(control => {
			switch (control.kind) {
				case 'buttons':
				case 'list':
				case 'ratio':
					return `${control.label} ${control.kind}: ${control.choices.map(choice => `${choice.label}${choice.shape ? `(${choice.shape.width}x${choice.shape.height})` : ''}${choice.selected ? '*' : ''}`).join(' ')}`;
				case 'slider':
					return `${control.label} slider ${control.min}-${control.max} by ${control.step} at ${control.value} (${control.valueLabel})${control.auto ? ` +${control.auto.label}${control.auto.selected ? '*' : ''}` : ''}`;
				case 'number':
					return `${control.label} number '${control.text}' placeholder '${control.placeholder}'${control.optional ? ' optional' : ''}${control.unit ? ` in ${control.unit}` : ''}`;
				case 'switch':
					return `${control.label} switch ${control.on ? 'on' : 'off'}`;
				case 'fixed':
					return `${control.label} fixed: ${control.text}`;
				case 'text':
					return `${control.label} text '${control.text}' max ${control.maxLength}${control.optional ? ' optional' : ''}`;
			}
		});
	}

	test('without a model, an image card shows its inputs as references, and a video card as frames', () => {
		const images: BaseHalfVideoCatalogState = { kind: 'ready', catalog: TEST_GENERATION_CATALOG };
		const row = (presentation: IBaseHalfVideoPanelPresentation) => ({
			mode: presentation.inputRow?.mode,
			slots: presentation.inputRow?.slots.map(slot => `${slot.title}=${slot.item ? slot.item.path : 'empty'}`),
			items: presentation.inputRow?.items.map(describe),
			hint: presentation.inputRow?.emptyHint
		});
		assert.deepStrictEqual({
			image: row(present({ kind: 'image', catalog: images, noModel: true })),
			newImage: row(present({ kind: 'image', catalog: images, noModel: true, inputs: [] })),
			video: row(present({ noModel: true })).slots
		}, {
			image: {
				mode: 'reference',
				slots: [],
				items: [
					'Image 1:reference',
					'Image 2:reference',
					'Image 3:reference',
					'Video 1:unused (Not used: This model takes no videos in this mode.)',
					'scene:text',
					'brief.pdf:unused (Not used: this kind of file cannot be sent to an image model.)'
				],
				hint: undefined
			},
			newImage: { mode: 'reference', slots: [], items: [], hint: 'Add images as references' },
			video: ['Start=frames/a.png', 'End=frames/b.png']
		});
	});

	test('frames take the start and end slots from the first two images and dim the rest with their reasons', () => {
		const presentation = present();
		const row = presentation.inputRow!;
		assert.deepStrictEqual({
			slots: row.slots.map(slot => `${slot.title}=${slot.item ? slot.item.path : 'empty'}`),
			swapped: row.swappedUpstream,
			items: row.items.map(describe),
			startTooltip: row.slots[0].item?.tooltip,
			blocker: presentation.blocker
		}, {
			slots: ['Start=frames/a.png', 'End=frames/b.png'],
			swapped: ['frames/b.png', 'frames/a.png', 'frames/c.png', 'clips/move.mp4', 'notes/scene.md', 'docs/brief.pdf'],
			items: [
				'Image 3:unused (Not used: Acme Motion 2 takes up to 2 images in Frames.)',
				'Video 1:unused (Not used: Acme Motion 2 takes no videos in Frames.)',
				'scene:text',
				'brief.pdf:unused (Not used: this kind of file cannot be sent to a video model.)'
			],
			startTooltip: 'Start frame · Image 1\nframes/a.png',
			blocker: undefined
		});
	});

	test('references take the three images and the video, in order, and name them', () => {
		const presentation = present({ generation: { ...frames, mode: 'reference' } });
		assert.deepStrictEqual({
			mode: presentation.mode?.id,
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

	test('says why each input is not used, by the slots of the mode', () => {
		const reasons = (presentation: IBaseHalfVideoPanelPresentation) => [...presentation.inputRow?.slots.flatMap(slot => slot.item ? [slot.item] : []) ?? [], ...presentation.inputRow?.items ?? []]
			.filter(item => !item.used)
			.map(item => `${item.path}: ${item.reason}`);
		const audio = (path: string): IBaseHalfVideoInputSource => ({ path, kind: 'audio', available: true });
		assert.deepStrictEqual({
			startFrameOnly: reasons(present({ generation: { provider: 'acme', model: 'acme-still' }, inputs: sources.slice(0, 2) })),
			textOnly: reasons(present({ generation: { provider: 'borealis', model: 'borealis-one' }, inputs: sources.slice(0, 1) })),
			missing: reasons(present({ inputs: [{ path: 'gone.png', kind: 'image', available: false }] })),
			tooMany: reasons(present({
				generation: { ...frames, mode: 'reference' },
				inputs: [...sources.slice(0, 3), { path: 'd.png', kind: 'image', available: true }, { path: 'e.png', kind: 'image', available: true }, audio('a.mp3'), audio('b.mp3')]
			}))
		}, {
			startFrameOnly: ['frames/b.png: Not used: Acme Still takes one image in Frames.'],
			textOnly: ['frames/a.png: Not used: Borealis One takes no images in Frames.'],
			missing: ['gone.png: Not used: the file is missing.'],
			tooMany: ['e.png: Not used: Acme Motion 2 takes up to 4 images in References.', 'b.mp3: Not used: Acme Motion 2 takes one audio file in References.']
		});
	});

	test('a mode that takes no media and has no inputs shows no input row, and an empty row says what the plus is for', () => {
		const clip = { provider: 'acme', model: 'acme-clip' };
		assert.deepStrictEqual({
			textOnly: present({ generation: { provider: 'borealis', model: 'borealis-one' }, inputs: [] }).inputRow,
			references: present({ generation: { ...frames, mode: 'reference' }, inputs: [] }).inputRow?.emptyHint,
			extend: present({ generation: { ...clip, mode: 'extend' }, inputs: [] }).inputRow?.emptyHint,
			edit: present({ generation: { ...clip, mode: 'edit' }, inputs: [] }).inputRow?.emptyHint,
			noModelSlots: present({ noModel: true, inputs: [] }).inputRow?.slots.map(slot => `${slot.title}: ${slot.addLabel}`)
		}, {
			textOnly: undefined,
			references: 'Add images, videos, or audio as references',
			extend: 'Add the video to continue',
			edit: 'Add the video to change, and images as references',
			noModelSlots: ['Start: Add a Start Frame', 'End: Add an End Frame']
		});
	});

	test('draws the settings from the model\'s declarations for the mode, advanced ones apart, and sums them up', () => {
		const motion = present({ inputs: [] }).settingsView!;
		const references = present({ generation: { ...frames, mode: 'reference', params: { ratio: '9:16', duration: -1, sound: false, seed: 42 } }, inputs: [] }).settingsView!;
		const still = present({ generation: { provider: 'acme', model: 'acme-still' }, inputs: [] }).settingsView!;
		const borealis = present({ generation: { provider: 'borealis', model: 'borealis-one', params: { strength: 0.3, caption: 'Night' } }, inputs: [] }).settingsView!;
		assert.deepStrictEqual({
			motion: { summary: motion.summary, modes: motion.modes?.map(mode => `${mode.label}${mode.selected ? '*' : ''}`), controls: controls(motion.controls), advanced: controls(motion.advanced) },
			references: { summary: references.summary, controls: controls(references.controls), advanced: controls(references.advanced) },
			still: { summary: still.summary, modes: still.modes, controls: controls(still.controls) },
			borealis: { summary: borealis.summary, controls: controls(borealis.controls) }
		}, {
			motion: {
				summary: 'Frames · 720p · 5s · Sound',
				modes: ['Frames*', 'References'],
				controls: [
					'Resolution buttons: 480p 720p* 1080p',
					'Duration slider 4-12 by 1 at 5 (5s) +Auto',
					'Sound switch on'
				],
				advanced: ['Seed number \'\' placeholder \'Not set\' optional', 'Negative Prompt text \'\' max 500 optional']
			},
			references: {
				summary: 'References · 720p · 9:16 · Auto · Sound off',
				controls: [
					'Resolution buttons: 480p 720p* 1080p',
					'Ratio ratio: 16:9(16x9) 4:3(4x3) 1:1(1x1) 3:4(3x4) 9:16(9x16)* 21:9(21x9)',
					'Duration slider 4-12 by 1 at 5 (Auto) +Auto*',
					'Sound switch off'
				],
				advanced: ['Seed number \'42\' placeholder \'Not set\' optional', 'Negative Prompt text \'\' max 500 optional']
			},
			still: { summary: 'Frames · 1080P · 5s', modes: undefined, controls: ['Resolution buttons: 720P 1080P*', 'Duration buttons: 5s* 10s'] },
			borealis: {
				summary: 'Frames · Strength 0.3 · Night',
				controls: ['Style list: None* Film Anime Clay Ink Pixel Neon Paper', 'Strength slider 0-1 by 0.1 at 0.3 (0.3)', 'Caption text \'Night\' max 80']
			}
		});
	});

	test('the model menu lists the catalog\'s models by provider, says which provider is not set up, and dims a model its region does not offer', () => {
		const menu = (presentation: IBaseHalfVideoPanelPresentation) => ({
			message: presentation.modelMenu.message,
			groups: presentation.modelMenu.groups.map(group => ({
				label: group.label,
				detail: group.detail,
				items: group.items.map(item => `${item.label}${item.checked ? '*' : ''}${item.unavailable ? ` (${item.unavailable})` : ''}`)
			})),
			end: presentation.modelMenu.settingsLabel
		});
		assert.deepStrictEqual({
			east: menu(present()),
			west: menu(present({ regions: { acme: 'west' } })).groups[0],
			legacy: menu(present({ generation: { provider: 'acme', model: 'acme-legacy' } })).groups[0].items,
			loading: menu(present({ catalog: { kind: 'loading' } })),
			failed: menu(present({ catalog: { kind: 'failed', message: 'AI Video is not running.' } })).message
		}, {
			east: {
				message: undefined,
				groups: [
					{ label: 'Acme Video', detail: 'East · Acme Cloud', items: ['Acme Motion 2*', 'Acme Still', 'Acme Clip'] },
					{ label: 'Borealis Media', detail: 'Not set up', items: ['Borealis One'] }
				],
				end: 'Providers…'
			},
			west: { label: 'Acme Video', detail: 'West · Acme Global', items: ['Acme Motion 2*', 'Acme Still (Not offered in West · Acme Global)', 'Acme Clip'] },
			legacy: ['Acme Motion 2', 'Acme Still', 'Acme Clip', 'Acme Legacy*'],
			loading: { message: 'Loading the models…', groups: [], end: 'Providers…' },
			failed: 'BaseHalf could not load the models: AI Video is not running.'
		});
	});

	test('the model menu lists the providers that are set up first, and each model with its abilities', () => {
		const menu = (presentation: IBaseHalfVideoPanelPresentation) => presentation.modelMenu.groups.map(group => `${group.label}: ${group.items.map(item => `${item.label} (${item.detail})`).join(', ')}`);
		assert.deepStrictEqual({
			acmeSetUp: menu(present()),
			borealisSetUp: menu(present({ notSetUp: ['acme'] })),
			neither: menu(present({ notSetUp: ['acme', 'borealis'] })).map(line => line.slice(0, line.indexOf(':')))
		}, {
			acmeSetUp: [
				'Acme Video: Acme Motion 2 (Frames · References · 12s · 1080p · Sound), Acme Still (Frames · 10s · 1080P), Acme Clip (Extend · Edit · 720p)',
				'Borealis Media: Borealis One (Frames)'
			],
			borealisSetUp: [
				'Borealis Media: Borealis One (Frames)',
				'Acme Video: Acme Motion 2 (Frames · References · 12s · 1080p · Sound), Acme Still (Frames · 10s · 1080P), Acme Clip (Extend · Edit · 720p)'
			],
			neither: ['Acme Video', 'Borealis Media']
		});
	});

	test('the reason Generate cannot run shows as a line, with the action that fixes it, except where the panel already says it', () => {
		const declared = JSON.parse(JSON.stringify({ schema: 1, providers: TEST_VIDEO_CATALOG.providers }));
		const motion = declared.providers[0].models.find((model: { id: string }) => model.id === 'acme-motion-2');
		motion.modes = motion.modes.map((mode: { id: string }) => mode.id === 'reference' ? { ...mode, regions: ['west'] } : mode);
		const westOnly: BaseHalfVideoCatalogState = { kind: 'ready', catalog: parseBaseHalfVideoCatalog(declared).catalog };
		const states = {
			generating: present({ generating: true }),
			loading: present({ catalog: { kind: 'loading' } }),
			failed: present({ catalog: { kind: 'failed', message: 'AI Video is not running.' } }),
			noModel: present({ noModel: true }),
			unknownModel: present({ generation: { provider: 'acme', model: 'acme-motion-9' } }),
			notSetUp: present({ generation: { provider: 'borealis', model: 'borealis-one' } }),
			region: present({ generation: { provider: 'acme', model: 'acme-still' }, regions: { acme: 'west' } }),
			modeRegion: present({ catalog: westOnly, generation: { ...frames, mode: 'reference' } }),
			check: present({ check: { problems: ['frames/a.png is 160 × 90 px; each side must be between 300 and 6000 px.'] } }),
			nothingToSend: present({ prompt: '  ', inputs: [] }),
			ready: present()
		};
		assert.deepStrictEqual(Object.fromEntries(Object.entries(states).map(([name, presentation]) => [name, presentation.reason
			? `${presentation.reason.text}${presentation.reason.action ? ` [${presentation.reason.action.label} → ${presentation.reason.action.provider}]` : ''}`
			: null])), {
			generating: null,
			loading: null,
			failed: 'BaseHalf could not load the models: AI Video is not running.',
			noModel: null,
			unknownModel: 'acme-motion-9 is not a model BaseHalf offers. Choose another model.',
			notSetUp: 'Borealis Media is not set up. Set it up in Providers. [Set Up → borealis]',
			region: 'Acme Still is not offered in West · Acme Global. Choose another model, or another region in Providers. [Providers… → acme]',
			modeRegion: 'Acme Motion 2 offers References mode only in West · Acme Global. Choose another mode, or another region in Providers. [Providers… → acme]',
			check: 'frames/a.png is 160 × 90 px; each side must be between 300 and 6000 px.',
			nothingToSend: null,
			ready: null
		});
	});

	test('a number field in seconds says so', () => {
		const edit = present({ generation: { provider: 'acme', model: 'acme-clip', mode: 'edit', params: { start: 2.5 } }, inputs: [] }).settingsView!;
		assert.deepStrictEqual(controls(edit.advanced), ['Start number \'2.5\' placeholder \'Not set\' optional in seconds']);
	});

	test('the Generate button names the first blocker, and the model button is outlined for the model and its provider', () => {
		const states = {
			generating: present({ generating: true }),
			loading: present({ catalog: { kind: 'loading' } }),
			noModel: present({ noModel: true }),
			unknownModel: present({ generation: { provider: 'acme', model: 'acme-motion-9' } }),
			notSetUp: present({ generation: { provider: 'borealis', model: 'borealis-one' } }),
			region: present({ generation: { provider: 'acme', model: 'acme-still' }, regions: { acme: 'west' } }),
			check: present({ check: { problems: ['The prompt is longer than 2,000 characters.'] } }),
			nothingToSend: present({ prompt: '  ', inputs: [] }),
			ready: present(),
			video: present({ hasFile: true })
		};
		const key = isMacintosh ? '⌘Enter' : 'Ctrl+Enter';
		const onEast = 'Acme Motion 2 on Acme Video, East · Acme Cloud';
		assert.deepStrictEqual(Object.fromEntries(Object.entries(states).map(([name, presentation]) => [name, {
			blocker: presentation.blocker?.kind,
			generate: `${presentation.generate.kind} ${presentation.generate.enabled ? 'enabled' : 'disabled'}: ${presentation.generate.label}`,
			model: { label: presentation.model.label, outlined: presentation.model.outlined, title: presentation.model.title }
		}])), {
			generating: { blocker: 'generating', generate: 'stop enabled: Stop Generating', model: { label: 'Acme Motion 2', outlined: false, title: onEast } },
			loading: { blocker: 'catalogLoading', generate: 'generate disabled: The models are still loading.', model: { label: 'Loading Models…', outlined: false, title: 'Loading Models…' } },
			noModel: { blocker: 'noModel', generate: 'generate disabled: Choose a model to generate.', model: { label: 'Choose Model', outlined: true, title: 'Choose a model to generate.' } },
			unknownModel: {
				blocker: 'unknownModel',
				generate: 'generate disabled: acme-motion-9 is not a model BaseHalf offers. Choose another model.',
				model: { label: 'acme-motion-9', outlined: true, title: 'acme-motion-9 is not a model BaseHalf offers. Choose another model.' }
			},
			notSetUp: {
				blocker: 'notSetUp',
				generate: 'generate disabled: Borealis Media is not set up. Set it up in Providers.',
				model: { label: 'Borealis One', outlined: true, title: 'Borealis Media is not set up. Set it up in Providers.' }
			},
			region: {
				blocker: 'region',
				generate: 'generate disabled: Acme Still is not offered in West · Acme Global. Choose another model, or another region in Providers.',
				model: { label: 'Acme Still', outlined: true, title: 'Acme Still is not offered in West · Acme Global. Choose another model, or another region in Providers.' }
			},
			check: { blocker: 'check', generate: 'generate disabled: The prompt is longer than 2,000 characters.', model: { label: 'Acme Motion 2', outlined: false, title: onEast } },
			nothingToSend: { blocker: 'nothingToSend', generate: 'generate disabled: Write a prompt or connect an input to generate.', model: { label: 'Acme Motion 2', outlined: false, title: onEast } },
			ready: { blocker: undefined, generate: 'generate enabled: Generate', model: { label: 'Acme Motion 2', outlined: false, title: onEast } },
			video: { blocker: undefined, generate: 'generate enabled: Generate', model: { label: 'Acme Motion 2', outlined: false, title: onEast } }
		});
		assert.deepStrictEqual([states.ready.generate.title, states.video.generate.title, present({ kind: 'image', hasFile: true, generation: { provider: 'corvid', model: 'corvid-paint' }, catalog: { kind: 'ready', catalog: TEST_GENERATION_CATALOG }, inputs: [] }).generate.title], [
			`Generate (${key})`,
			`Generate a new video in a new card beside this one (${key})`,
			`Generate a new image in a new card beside this one (${key})`
		]);
	});

	test('an image card offers the image models, says why a video model cannot generate there, and dims an input that is a draft', () => {
		const images: BaseHalfVideoCatalogState = { kind: 'ready', catalog: TEST_GENERATION_CATALOG };
		const image = (options: IPresentOptions) => present({ kind: 'image', catalog: images, notSetUp: [], ...options });
		const menu = image({ generation: { provider: 'corvid', model: 'corvid-paint' } }).modelMenu;
		const videoModel = image({ generation: { provider: 'acme', model: 'acme-motion-2' } });
		const draftInput = image({
			generation: { provider: 'corvid', model: 'corvid-paint' },
			inputs: [{ path: 'shots/hero.png', kind: 'image', available: false, draft: true }, { path: 'refs/b.png', kind: 'image', available: true }]
		});
		assert.deepStrictEqual({
			menu: menu.groups.map(group => `${group.label}: ${group.items.map(item => `${item.label} (${item.detail})`).join(', ')}`),
			end: menu.settingsLabel,
			videoModel: [videoModel.blocker?.kind, videoModel.generate.label, videoModel.model.outlined, videoModel.reason?.text],
			draftInput: [draftInput.inputRow?.items.map(item => `${item.name}: ${item.reason ?? item.use}`), draftInput.generate.label, draftInput.reason?.text],
			noImages: present({ kind: 'image' }).modelMenu.message
		}, {
			menu: ['Corvid Studio: Corvid Paint (4K · Up to 4 images · 4 references), Corvid Print (2K · Up to 2 images · 4 references)'],
			end: 'Providers…',
			videoModel: ['otherKind', 'Acme Motion 2 makes videos. Choose an image model.', true, 'Acme Motion 2 makes videos. Choose an image model.'],
			draftInput: [
				['Image 1: Not used: it has no file yet.', 'Image 2: reference'],
				'hero.png has no file yet. Generate it first, or remove its connection.',
				'hero.png has no file yet. Generate it first, or remove its connection.'
			],
			noImages: 'AI Video offers no image models.'
		});
	});

	test('asks check about what would be sent, without the inputs that the panel adds with their files', () => {
		const presentation = present({ check: { problems: [] } });
		const notOffered = present({ generation: { provider: 'acme', model: 'acme-still' }, regions: { acme: 'west' }, check: { problems: [] } });
		assert.deepStrictEqual({
			request: presentation.checkRequest,
			notOffered: notOffered.checkRequest,
			// The check is asked also before the provider is set up.
			notSetUp: present({ generation: { provider: 'borealis', model: 'borealis-one' } }).checkRequest?.region
		}, {
			request: {
				provider: 'acme',
				region: 'east',
				model: 'acme-motion-2',
				mode: 'frames',
				params: { resolution: '720p', duration: 5, sound: true },
				prompt: 'A slow push in.\n\nThe sea at dusk.'
			},
			notOffered: undefined,
			notSetUp: 'main'
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
			names: ['notes/Scene.md', 'shots/Shot 1.mp4', 'frames/a.png', 'docs/brief.pdf'].map(baseHalfVideoPanelInputFileName)
		}, {
			swapped: ['b.png', 'note.md', 'a.png'],
			unchanged: ['a.png'],
			names: ['Scene', 'Shot 1.mp4', 'a.png', 'brief.pdf']
		});
	});

	test('a value the start frame sets shows as set by it and is not asked for, and a mode the region does not offer is dimmed', () => {
		const declared = JSON.parse(JSON.stringify({ schema: 1, providers: TEST_VIDEO_CATALOG.providers }));
		const motion = declared.providers[0].models.find((model: { id: string }) => model.id === 'acme-motion-2');
		motion.parameters = motion.parameters.map((parameter: { name: string }) => parameter.name === 'ratio' ? { ...parameter, modes: undefined, setByStartFrame: true } : parameter);
		motion.modes = motion.modes.map((mode: { id: string }) => mode.id === 'reference' ? { ...mode, regions: ['west'] } : mode);
		const catalog: BaseHalfVideoCatalogState = { kind: 'ready', catalog: parseBaseHalfVideoCatalog(declared).catalog };
		const generation = { ...frames, params: { ...frames.params, ratio: '9:16' } };
		const read = (presentation: IBaseHalfVideoPanelPresentation) => ({
			ratio: controls(presentation.settingsView!.controls).find(line => line.startsWith('Ratio')),
			summary: presentation.settingsView!.summary,
			asked: presentation.checkRequest?.params,
			modes: presentation.settingsView!.modes!.map(mode => `${mode.label}${mode.unavailable ? ` (${mode.unavailable})` : ''}`)
		});
		assert.deepStrictEqual({ withFrame: read(present({ catalog, generation })), withoutFrame: read(present({ catalog, generation, inputs: [] })) }, {
			withFrame: {
				ratio: 'Ratio fixed: Set by the start frame',
				summary: 'Frames · 720p · 5s · Sound',
				asked: { resolution: '720p', duration: 5, sound: true },
				modes: ['Frames', 'References (Not offered in East · Acme Cloud)']
			},
			withoutFrame: {
				ratio: 'Ratio ratio: 16:9(16x9) 4:3(4x3) 1:1(1x1) 3:4(3x4) 9:16(9x16)* 21:9(21x9)',
				summary: 'Frames · 720p · 9:16 · 5s · Sound',
				asked: { resolution: '720p', ratio: '9:16', duration: 5, sound: true },
				modes: ['Frames', 'References (Not offered in East · Acme Cloud)']
			}
		});
	});
});
