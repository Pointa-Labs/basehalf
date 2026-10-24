/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from 'assert';
import { buildCatalog, PROVIDER_MODULES } from '../../node/registry.js';
import type { CatalogModel, CatalogParameter, CatalogProvider, VoiceParameter } from '../../common/basehalfProviderTypes.js';
import { testAudioModule, testAudioProvider, testModule, testProvider } from './providerTestKit.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('BaseHalf providers: providerCatalog', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] };

	/** The catalog of one test provider changed by `change`. */
	function catalogWith(change: (provider: Mutable<CatalogProvider>) => void) {
		const provider = structuredClone(testProvider()) as Mutable<CatalogProvider>;
		change(provider);
		return () => buildCatalog([testModule({ describe: () => provider as CatalogProvider })]);
	}

	function firstModel(provider: Mutable<CatalogProvider>): Mutable<CatalogModel> {
		return provider.models[0] as Mutable<CatalogModel>;
	}

	function parameter(provider: Mutable<CatalogProvider>, name: string): Mutable<CatalogParameter> {
		return firstModel(provider).parameters.find(entry => entry.name === name) as Mutable<CatalogParameter>;
	}

	test('the shipped provider modules build a valid catalog', () => {
		const catalog = buildCatalog(PROVIDER_MODULES);
		assert.equal(catalog.schema, 1);
		assert.equal(catalog.providers.length, PROVIDER_MODULES.length);
	});

	test('a valid provider builds a frozen copy of its declarations', () => {
		const catalog = buildCatalog([testModule()]);
		assert.deepEqual(catalog.providers.map(provider => provider.id), ['testprovider']);
		assert.ok(Object.isFrozen(catalog) && Object.isFrozen(catalog.providers[0].models[0].parameters[0]));
		// The answer says what every model makes; a module may leave it out for a video model.
		const declared = testProvider();
		assert.deepEqual(catalog.providers[0], { ...declared, models: declared.models.map(model => ({ ...model, kind: model.kind ?? 'video' })) });
	});

	test('an image model declares its format and offers only references of images', () => {
		const image = (change: (model: Mutable<CatalogModel>) => void) => catalogWith(provider => {
			const model = firstModel(provider);
			model.kind = 'image';
			model.outputFormat = 'png';
			model.modes = [{ id: 'reference', label: 'References', inputs: { startFrame: 'none', endFrame: 'none', images: { min: 0, max: 4 }, videos: { min: 0, max: 0 }, audios: { min: 0, max: 0 }, source: 'none' }, limits: {} }];
			model.parameters = [{ name: 'count', label: 'Images', kind: 'integer', min: 1, max: 4, step: 1, default: 1 }];
			change(model);
		});
		assert.equal(image(() => { })().providers[0].models[0].kind, 'image');
		assert.throws(image(model => { delete model.outputFormat; }), /declares its outputFormat/);
		assert.throws(image(model => { model.modes[0].inputs.videos.max = 1; }), /the one mode reference, with images only/);
		assert.throws(image(model => { model.parameters[0] = { name: 'count', label: 'Images', kind: 'integer', min: 1, max: 20, step: 1, default: 1 }; }), /count is a whole number from 1 to at most 16/);
		assert.throws(image(model => { model.outputFormat = 'mp3'; }), /an image model declares its outputFormat, png, jpeg, or webp/);
		assert.throws(catalogWith(provider => { firstModel(provider).outputFormat = 'png'; }), /only an image or an audio model declares an outputFormat/);
		assert.throws(catalogWith(provider => { firstModel(provider).deprecatedIn = ['nowhere']; }), /deprecatedIn must name regions that offer the model/);
	});

	/** The catalog of the test audio provider changed by `change`, with a module that lists voices unless `listVoices` is left out. */
	function audioCatalogWith(change: (provider: Mutable<CatalogProvider>) => void, listVoices = true) {
		const provider = structuredClone(testAudioProvider()) as Mutable<CatalogProvider>;
		change(provider);
		return () => buildCatalog([testAudioModule({ describe: () => provider as CatalogProvider, ...(listVoices ? {} : { listVoices: undefined }) })]);
	}

	function audioModel(provider: Mutable<CatalogProvider>, id: string): Mutable<CatalogModel> {
		return provider.models.find(model => model.id === id) as Mutable<CatalogModel>;
	}

	test('the test audio provider builds a valid catalog: speech, music, and sound effects, each with its format (D78)', () => {
		const catalog = buildCatalog([testAudioModule()]);
		assert.deepEqual(catalog.providers[0].models.map(model => [model.id, model.kind, model.makes, model.outputFormat, model.modes.map(mode => mode.id).join(' ')]), [
			['speech-1', 'audio', 'speech', 'mp3', 'reference'],
			['speech-fixed', 'audio', 'speech', 'wav', 'reference'],
			['song-1', 'audio', 'music', 'mp3', 'reference lyrics'],
			['song-tasks', 'audio', 'music', 'mp3', 'reference'],
			['fx-1', 'audio', 'sound', 'mp3', 'reference']
		]);
	});

	test('an audio model says what it makes and declares its format, mp3 or wav, and only an audio model says what it makes (D78)', () => {
		assert.throws(audioCatalogWith(provider => { delete audioModel(provider, 'fx-1').makes; }), /model fx-1: an audio model declares what it makes, speech, music, or sound/);
		assert.throws(audioCatalogWith(provider => { (audioModel(provider, 'fx-1') as { makes: string }).makes = 'noise'; }), /model fx-1: an audio model declares what it makes, speech, music, or sound/);
		assert.throws(audioCatalogWith(provider => { delete audioModel(provider, 'fx-1').outputFormat; }), /model fx-1: an audio model declares its outputFormat, mp3 or wav/);
		assert.throws(audioCatalogWith(provider => { audioModel(provider, 'fx-1').outputFormat = 'png'; }), /model fx-1: an audio model declares its outputFormat, mp3 or wav/);
		assert.throws(audioCatalogWith(provider => { (audioModel(provider, 'fx-1') as { kind: string }).kind = 'sound'; }), /model fx-1: kind must be image, video, or audio/);
		assert.throws(catalogWith(provider => { firstModel(provider).makes = 'speech'; }), /model clip-1: only an audio model declares what it makes/);
		assert.doesNotThrow(audioCatalogWith(provider => { audioModel(provider, 'fx-1').outputFormat = 'wav'; }));
	});

	test('an audio model offers References and Lyrics with images and sounds only, and Lyrics is a mode of a music model that also offers References and takes a prompt (D78)', () => {
		assert.throws(audioCatalogWith(provider => { audioModel(provider, 'song-1').modes[0].inputs.videos = { min: 0, max: 1 }; }), /model song-1: an audio model offers the modes reference and lyrics, with images and sounds only/);
		assert.throws(audioCatalogWith(provider => { audioModel(provider, 'song-1').modes[0].inputs.startFrame = 'optional'; }), /an audio model offers the modes reference and lyrics, with images and sounds only/);
		assert.throws(audioCatalogWith(provider => { audioModel(provider, 'song-1').modes[0].id = 'frames'; }), /an audio model offers the modes reference and lyrics, with images and sounds only/);
		assert.throws(audioCatalogWith(provider => { audioModel(provider, 'fx-1').modes[0].id = 'lyrics'; }), /model fx-1: only a music model offers lyrics mode/);
		assert.throws(audioCatalogWith(provider => { audioModel(provider, 'song-1').modes.shift(); audioModel(provider, 'song-1').parameters = []; }), /model song-1: a music model with lyrics mode also offers reference mode/);
		assert.throws(audioCatalogWith(provider => { audioModel(provider, 'song-1').prompt.required = 'never'; }), /model song-1: a music model with lyrics mode takes the lyrics as its prompt, so prompt.required cannot be never/);
		assert.throws(catalogWith(provider => { firstModel(provider).modes[1].id = 'lyrics'; firstModel(provider).parameters = []; }), /model clip-1: only a music model offers lyrics mode/);
		// Images are among an audio model's references, as a song made for pictures takes them.
		assert.doesNotThrow(audioCatalogWith(provider => { audioModel(provider, 'song-1').modes[1].inputs.images = { min: 0, max: 3 }; }));
	});

	test('count is on an image or a music model only (D78)', () => {
		const count = { name: 'count', label: 'Takes', kind: 'integer' as const, min: 1, max: 4, step: 1, default: 1 };
		assert.throws(audioCatalogWith(provider => { audioModel(provider, 'fx-1').parameters.push(count); }), /model fx-1: count is a whole number from 1 to at most 16, on an image or a music model/);
		assert.throws(audioCatalogWith(provider => { audioModel(provider, 'speech-fixed').parameters.push(count); }), /model speech-fixed: count is a whole number/);
		assert.throws(audioCatalogWith(provider => { audioModel(provider, 'song-1').parameters[0] = { ...count, max: 17 }; }), /model song-1: count is a whole number from 1 to at most 16/);
		assert.throws(catalogWith(provider => { firstModel(provider).parameters.push(count); }), /model clip-1: count is a whole number/);
	});

	test('a voice is the parameter voice of a speech model, of its own kind, with its default among its voices, each declared once, and a voice the provider lists needs the module\'s listVoices (D78)', () => {
		const voice = (provider: Mutable<CatalogProvider>) => audioModel(provider, 'speech-1').parameters[0] as Mutable<VoiceParameter>;
		assert.throws(audioCatalogWith(provider => { voice(provider).default = 'nobody'; }), /model speech-1, parameter voice: the default nobody is not one of the voices/);
		assert.throws(audioCatalogWith(provider => { voice(provider).options.push({ value: 'aria', label: 'Aria Again' }); }), /parameter voice: the voice aria is declared twice/);
		assert.throws(audioCatalogWith(provider => { voice(provider).options = []; }), /parameter voice: a voice needs options, the voices every account of the provider has/);
		assert.throws(audioCatalogWith(provider => { voice(provider).options.push({ value: 'new\nline', label: 'Broken' }); }), /parameter voice: the voice new\nline must be the id of a voice/);
		assert.throws(audioCatalogWith(provider => { voice(provider).options[1].label = ''; }), /parameter voice: the label of voice bo must be text/);
		assert.throws(audioCatalogWith(provider => { voice(provider).options[1].description = 'x'.repeat(301); }), /parameter voice: the description of voice bo must be text of 1 to 300 characters/);
		assert.throws(audioCatalogWith(provider => { voice(provider).optional = true; }), /parameter voice: a voice is never optional/);
		assert.throws(audioCatalogWith(provider => { (voice(provider) as { listed: unknown }).listed = 'yes'; }), /parameter voice: listed must be true or false/);
		assert.throws(audioCatalogWith(provider => { voice(provider).name = 'speaker'; }), /parameter speaker: the voice of a speech model is its parameter named voice, of kind voice, and only a speech model has one/);
		assert.throws(audioCatalogWith(provider => { audioModel(provider, 'fx-1').parameters.push(voice(provider)); }), /model fx-1, parameter voice: the voice of a speech model is its parameter named voice/);
		assert.throws(audioCatalogWith(provider => { audioModel(provider, 'speech-1').parameters[1].name = 'voice'; audioModel(provider, 'speech-1').parameters.shift(); }), /model speech-1, parameter voice: the voice of a speech model is its parameter named voice, of kind voice/);
		assert.throws(audioCatalogWith(() => undefined, false), /model speech-1: a voice the provider lists needs the module's listVoices/);
		// Without voices it lists, a module needs no listVoices.
		assert.doesNotThrow(audioCatalogWith(provider => { voice(provider).listed = false; }, false));
	});

	test('provider ids are unique, and so are model ids and parameter names within their parent', () => {
		assert.throws(() => buildCatalog([testModule(), testModule()]), /provider testprovider: declared twice/);
		assert.throws(catalogWith(provider => {
			provider.models[1].id = 'clip-1';
		}), /model clip-1: declared twice/);
		assert.throws(catalogWith(provider => {
			parameter(provider, 'seed').name = 'duration';
		}), /parameter duration: declared twice/);
		assert.throws(catalogWith(provider => {
			provider.regions[1].id = 'home';
		}), /region home: declared twice/);
	});

	test('regions are declared, with https base URLs, and every offering names one', () => {
		assert.throws(catalogWith(provider => {
			provider.regions = [];
		}), /at least one region is needed/);
		assert.throws(catalogWith(provider => {
			provider.regions[0].baseUrl = 'http://api.example.com/v1';
		}), /region home: the base URL must be an https address/);
		assert.throws(catalogWith(provider => {
			provider.regions[0].baseUrl = 'https://api.example.com/v1/';
		}), /without a trailing slash/);
		assert.throws(catalogWith(provider => {
			(firstModel(provider).providerModels as Record<string, string>).elsewhere = 'clip-1-elsewhere';
		}), /providerModels names the region elsewhere, which the provider does not declare/);
		assert.throws(catalogWith(provider => {
			firstModel(provider).providerModels = {};
		}), /at least one region must offer it/);
		assert.throws(catalogWith(provider => {
			provider.credentials = [];
		}), /at least one credential is needed/);
	});

	test('modes are declared once each, with sane slot counts', () => {
		assert.throws(catalogWith(provider => {
			firstModel(provider).modes = [];
		}), /at least one mode is needed/);
		assert.throws(catalogWith(provider => {
			firstModel(provider).modes[1].id = 'frames';
		}), /mode frames: declared twice/);
		assert.throws(catalogWith(provider => {
			firstModel(provider).modes[1].inputs.images = { min: 4, max: 3 };
		}), /mode reference: images: min and max must be whole numbers with 0 ≤ min ≤ max/);
		assert.throws(catalogWith(provider => {
			firstModel(provider).modes[1].inputs.audios = { min: -1, max: 2 };
		}), /audios: min and max/);
		assert.throws(catalogWith(provider => {
			firstModel(provider).modes[0].inputs.startFrame = 'none';
		}), /mode frames: an end frame needs a start frame/);
		assert.throws(catalogWith(provider => {
			firstModel(provider).modes[0].limits.imageMinSide = 7000;
		}), /imageMinSide must not exceed imageMaxSide/);
		assert.throws(catalogWith(provider => {
			firstModel(provider).modes[0].limits.imageAspect = [2.5, 0.4];
		}), /imageAspect: the range must be two positive numbers, the smaller first/);
		for (const imageFormats of [['png', 'gif'], ['png', 'png'], []]) {
			assert.throws(catalogWith(provider => {
				(firstModel(provider).modes[0].limits as { imageFormats?: string[] }).imageFormats = imageFormats;
			}), /limits.imageFormats must name png, jpeg, or webp, each once|limits.imageFormats must include png/, imageFormats.join());
		}
		assert.throws(catalogWith(provider => {
			firstModel(provider).modes[0].limits.imageFormats = ['jpeg', 'webp'];
		}), /limits.imageFormats must include png, the format the window draws other images to/);
		assert.doesNotThrow(catalogWith(provider => {
			firstModel(provider).modes[0].limits.imageFormats = ['png', 'jpeg'];
		}));
	});

	test('a mode names regions that offer the model, and a parameter set by a start frame applies to a mode with one', () => {
		for (const regions of [[], ['home', 'home'], ['elsewhere']]) {
			assert.throws(catalogWith(provider => {
				firstModel(provider).modes[1].regions = regions;
			}), /mode reference: regions must name at least one region, each once|mode reference: regions names elsewhere, which does not offer the model/, regions.join());
		}
		assert.doesNotThrow(catalogWith(provider => {
			firstModel(provider).modes[1].regions = ['away'];
		}));
		// Ratio applies to References only, which takes no start frame.
		assert.throws(catalogWith(provider => {
			parameter(provider, 'ratio').setByStartFrame = true;
		}), /parameter ratio: setByStartFrame needs a mode with a start frame/);
		assert.doesNotThrow(catalogWith(provider => {
			const ratio = parameter(provider, 'ratio');
			ratio.setByStartFrame = true;
			delete ratio.modes;
		}));
	});

	test('a parameter that is not optional has a default, and every default is one the parameter allows', () => {
		assert.throws(catalogWith(provider => {
			delete parameter(provider, 'resolution').default;
		}), /parameter resolution: a parameter that is not optional needs a default/);
		assert.throws(catalogWith(provider => {
			parameter(provider, 'resolution').default = '1080p';
		}), /parameter resolution: the default 1080p is not one of the options/);
		assert.throws(catalogWith(provider => {
			parameter(provider, 'duration').default = 13;
		}), /parameter duration: the default 13 is outside \[4, 12\]/);
		assert.throws(catalogWith(provider => {
			const duration = parameter(provider, 'duration') as Mutable<CatalogParameter & { step: number }>;
			duration.step = 2;
			duration.default = 5;
		}), /parameter duration: the default 5 is not a multiple of the step 2 from 4/);
		assert.throws(catalogWith(provider => {
			(parameter(provider, 'duration') as Mutable<CatalogParameter & { auto: { value: number; label: string } }>).auto = { value: 6, label: 'Auto' };
		}), /the auto value must lie outside \[4, 12\]/);
		assert.throws(catalogWith(provider => {
			(parameter(provider, 'resolution') as Mutable<CatalogParameter & { options: unknown[] }>).options = [];
		}), /a choice needs options/);
		// Auto may be the default, and an optional parameter needs none.
		assert.doesNotThrow(catalogWith(provider => {
			parameter(provider, 'duration').default = -1;
		}));
	});

	test('a parameter limited to some modes names modes the model declares', () => {
		assert.throws(catalogWith(provider => {
			parameter(provider, 'ratio').modes = ['extend'];
		}), /parameter ratio: modes names extend, which the model does not declare/);
		assert.throws(catalogWith(provider => {
			parameter(provider, 'ratio').modes = [];
		}), /modes must name at least one mode/);
	});

	test('labels and the prompt rule are declared', () => {
		assert.throws(catalogWith(provider => {
			firstModel(provider).label = ' ';
		}), /model clip-1: label must be text/);
		assert.throws(catalogWith(provider => {
			firstModel(provider).prompt.maxLength = 0;
		}), /prompt.maxLength must be a positive whole number/);
	});
});
