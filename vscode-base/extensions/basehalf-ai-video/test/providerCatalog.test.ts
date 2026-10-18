/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCatalog, PROVIDER_MODULES } from '../src/providers/registry.ts';
import type { CatalogModel, CatalogParameter, CatalogProvider } from '../src/providers/types.ts';
import { testModule, testProvider } from './providerTestKit.ts';

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
	assert.deepEqual(catalog.providers[0], testProvider());
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
