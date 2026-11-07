/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { readBaseHalfSidecarUpstream } from '../../../references/common/basehalfReferenceStore.js';
import { BASEHALF_GENERATION_AGENT_CONTRACT_VERSION, getBaseHalfGenerationAgentContract } from '../../common/basehalfGenerationAgentContract.js';
import { BASEHALF_GENERATION_INFO_FIELDS, parseBaseHalfGenerationInfo } from '../../common/basehalfGenerationInfo.js';

suite('BaseHalfGenerationAgentContract', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('publishes the fields of generation.yaml an agent may write, and keeps made.yaml and the task records for BaseHalf', () => {
		const contract = getBaseHalfGenerationAgentContract() as Record<string, any>;
		const rules = (contract.rules as string[]).join('\n');
		assert.deepStrictEqual({
			version: contract.contractVersion,
			fields: Object.keys(contract.schema.properties),
			closed: contract.schema.additionalProperties,
			modes: contract.schema.properties.mode.enum,
			missing: ['made.yaml', '.bh/cache/', 'draft', 'upstream.yaml', 'host.modelCatalog', 'basehalf --generate', '@[frames/start.png]', 'Write no model\'s own names', 'on the canvas', 'Only a draft has a generation.yaml', 'keeps the inputs that made it', 'Every one is sent', 'The mode that is used', 'without the seed',
				// D78: sounds, Lyrics mode, a note in a prompt that is spoken or sung, and the voice.
				'audio for .mp3, .wav, .flac, .m4a, .ogg.', 'lyrics sends the prompt as the lyrics', 'spoken or sung', 'without its name', 'as its plain text', 'voice parameter', 'image or song'].filter(phrase => !rules.includes(phrase))
		}, {
			version: BASEHALF_GENERATION_AGENT_CONTRACT_VERSION,
			fields: [...BASEHALF_GENERATION_INFO_FIELDS],
			closed: false,
			modes: ['frames', 'reference', 'extend', 'edit', 'lyrics'],
			missing: []
		});
		assert.strictEqual(contract.contractVersion, 7);
		assert.ok((contract.rules as string[]).every(rule => rule.length <= 500));
		assert.doesNotMatch(JSON.stringify(contract), /bhnode|--run-node|videoCatalog|outputs\/|recipe|attempt|price|currency/i);
	});

	test('shows a card whose generation.yaml and upstream.yaml read back as BaseHalf reads them, with a model of the catalog when there is one', () => {
		const placeholder = (getBaseHalfGenerationAgentContract() as Record<string, any>).examples;
		const fromCatalog = (getBaseHalfGenerationAgentContract({ provider: 'acme', model: 'acme-motion-2', mode: 'frames', params: { duration: 5, resolution: '720p', sound: true } }) as Record<string, any>).examples;
		const read = (text: string) => parseBaseHalfGenerationInfo(text);
		assert.deepStrictEqual({
			card: placeholder.card,
			files: [placeholder.generationFile, placeholder.inputsFile],
			placeholder: read(placeholder.generation),
			catalog: read(fromCatalog.generation).info,
			inputs: readBaseHalfSidecarUpstream(placeholder.inputs, { nodePath: placeholder.card }).items.map(item => item.path)
		}, {
			card: 'shots/shot-01/clip.mp4',
			files: ['.bh/mirror/shots/shot-01/clip.mp4/generation.yaml', '.bh/mirror/shots/shot-01/clip.mp4/upstream.yaml'],
			placeholder: {
				info: { prompt: 'The rider in @[frames/start.png] cycles along the coast, as @[notes/scene.md] describes; the camera follows slowly.', provider: 'provider-id', model: 'model-id', mode: 'frames', params: { duration: 5 } },
				readable: true,
				ignored: []
			},
			catalog: { prompt: 'The rider in @[frames/start.png] cycles along the coast, as @[notes/scene.md] describes; the camera follows slowly.', provider: 'acme', model: 'acme-motion-2', mode: 'frames', params: { duration: 5, resolution: '720p', sound: true } },
			inputs: ['frames/start.png', 'frames/end.png', 'notes/scene.md']
		});
	});
});
