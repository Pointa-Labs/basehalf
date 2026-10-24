/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import {
	BASEHALF_GENERATION_EXTENSIONS,
	BASEHALF_GENERATION_PROMPT_MAX_LENGTH,
	IBaseHalfGenerationInfo,
	parseBaseHalfGenerationInfo,
	serializeBaseHalfGenerationInfo
} from './basehalfGenerationInfo.js';
import { baseHalfPromptMention } from './basehalfGenerationMentions.js';
import { BASEHALF_VIDEO_MODE_IDS, IBaseHalfVideoGenerationChoice } from './basehalfVideoCatalog.js';

/**
 * What an agent may write to a generation card (D63, D67, generation cards,
 * "What an agent may write"): the fields of a draft's `generation.yaml`, its
 * inputs in `upstream.yaml`, and the command that generates. `made.yaml`, the
 * task records under `.bh/cache/generation/`, and the card information of a
 * generated file are BaseHalf's alone. Discovery gives this contract to
 * agents as `host.generationCards.authoring`. The example is written and read
 * back through BaseHalf's own writer and reader, so what agents are shown
 * cannot drift from what BaseHalf reads.
 */

/**
 * Changes when what an agent may write changes. Version 5 was the first of
 * generation cards (D63); in version 6 only a draft has a `generation.yaml`,
 * a generated file keeps its inputs, and every input of a draft is sent (D67);
 * in version 7 a prompt mentions an input as `@[<entry>]` instead of naming
 * it by kind and number, and BaseHalf writes each model's names (D74).
 */
export const BASEHALF_GENERATION_AGENT_CONTRACT_VERSION = 7;

/** A JSON value of the contract. */
export type BaseHalfGenerationAgentJsonValue = null | boolean | number | string | readonly BaseHalfGenerationAgentJsonValue[] | { readonly [key: string]: BaseHalfGenerationAgentJsonValue };

/** The card the example shows, relative to the workspace folder. */
const EXAMPLE_CARD = 'shots/shot-01/clip.mp4';
const EXAMPLE_INPUTS = ['frames/start.png', 'frames/end.png', 'notes/scene.md'];
const EXAMPLE_PROMPT = `The rider in ${baseHalfPromptMention(EXAMPLE_INPUTS[0])} cycles along the coast, as ${baseHalfPromptMention(EXAMPLE_INPUTS[2])} describes; the camera follows slowly.`;
/** A generation that stands for the catalog's when the catalog could not be read. */
const PLACEHOLDER_GENERATION: IBaseHalfVideoGenerationChoice = Object.freeze({ provider: 'provider-id', model: 'model-id', mode: 'frames', params: Object.freeze({ duration: 5 }) });

/**
 * The authoring contract of a generation card: its version, the schema of
 * `generation.yaml`, an example card with its `generation.yaml` and
 * `upstream.yaml`, and the rules, the draft rule among them.
 * `exampleGeneration` is a generation of the model catalog of this computer;
 * without one, the example names a provider and a model that stand for the
 * catalog's.
 */
export function getBaseHalfGenerationAgentContract(exampleGeneration?: IBaseHalfVideoGenerationChoice): Readonly<Record<string, BaseHalfGenerationAgentJsonValue>> {
	const info: IBaseHalfGenerationInfo = { prompt: EXAMPLE_PROMPT, ...(exampleGeneration ?? PLACEHOLDER_GENERATION) };
	const generation = serializeBaseHalfGenerationInfo(info);
	const read = parseBaseHalfGenerationInfo(generation);
	if (!read.readable || read.ignored.length || read.info.model !== info.model || read.info.prompt !== info.prompt) {
		throw new Error('The example generation.yaml does not read back as it was written.');
	}
	const catalogId = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' };
	const extensions = (kind: keyof typeof BASEHALF_GENERATION_EXTENSIONS) => BASEHALF_GENERATION_EXTENSIONS[kind].map(extension => `.${extension}`).join(', ');
	return Object.freeze({
		contractVersion: BASEHALF_GENERATION_AGENT_CONTRACT_VERSION,
		schema: {
			'$schema': 'https://json-schema.org/draft/2020-12/schema',
			description: 'The YAML mapping of .bh/mirror/<path>/generation.yaml.',
			type: 'object',
			additionalProperties: false,
			properties: {
				prompt: { type: 'string', maxLength: BASEHALF_GENERATION_PROMPT_MAX_LENGTH, description: 'What the next generation makes. It mentions an input as @[<entry of upstream.yaml>]. Text inputs join it.' },
				provider: { ...catalogId, description: 'The id of a provider of host.modelCatalog.' },
				model: { ...catalogId, description: 'The id of a model of that provider, of the card\'s kind.' },
				mode: { enum: [...BASEHALF_VIDEO_MODE_IDS], description: 'One of the modes of that model.' },
				params: {
					type: 'object',
					maxProperties: 64,
					propertyNames: { pattern: '^[A-Za-z_][A-Za-z0-9_.-]{0,63}$' },
					additionalProperties: { type: ['string', 'number', 'boolean'] },
					description: 'Values of the model\'s parameters by name. A parameter left out takes its default.'
				}
			}
		},
		examples: {
			card: EXAMPLE_CARD,
			generationFile: `.bh/mirror/${EXAMPLE_CARD}/generation.yaml`,
			generation,
			inputsFile: `.bh/mirror/${EXAMPLE_CARD}/upstream.yaml`,
			inputs: ['upstream:', ...EXAMPLE_INPUTS.map(input => `  - ${input}`), ''].join('\n')
		},
		rules: [
			`A generation card is an image or a video file of the workspace. Its kind follows its extension: image for ${extensions('image')}; video for ${extensions('video')}.`,
			'A draft is a generation card whose file does not exist yet: a generation.yaml with no made.yaml, at a path that names no file, in a folder that exists. Write its generation.yaml to make one; its file lands at its path when it generates.',
			'In generation.yaml write only prompt, provider, model, mode, and params. Never write made.yaml or anything under .bh/cache/: BaseHalf writes them.',
			'Only a draft has a generation.yaml: when its file lands, BaseHalf writes its made.yaml and removes its generation.yaml. A generated file never changes and keeps the inputs that made it: never write its generation.yaml or its upstream.yaml.',
			'Never move, rename, or delete a card\'s files under .bh/. The user renames, moves, or deletes a draft on the canvas.',
			'Choose provider, model, mode, and params from host.modelCatalog: a model of the card\'s kind, one of its modes, and values its parameters accept. A parameter left out takes its default.',
			'The inputs of a draft are the entries of its upstream.yaml, in order, relative to the workspace folder; the downstream card stores the connection. Every one is sent.',
			'The mode\'s input slots use the inputs: frames take the first image as the start frame and the second as the end frame; references take images, videos, and audio in order; extend and edit take the first video as the clip; text inputs join the prompt.',
			'The mode that is used is the draft\'s own when it uses every input, and otherwise the first of the model\'s modes, in the catalog\'s order, that does; the draft keeps its own mode. A draft with an input that no mode of its model can use does not generate.',
			'A prompt mentions an input as @[<its entry>], with the entry exactly as upstream.yaml lists it, such as @[frames/start.png]; write a ] in an entry as \\]. Every mention must name an entry of the draft\'s upstream.yaml, or the draft does not generate. Write no model\'s own names, such as Image 1 or <<<image_1>>>: when the draft generates, BaseHalf writes the names its model reads. A mentioned note is sent by its name, and its text follows the prompt.',
			'Generate a draft with basehalf --generate <workspace-relative path>. For a generated file it makes a new draft beside it from its made.yaml, without the seed and with the same inputs, and generates that. It refuses values the model does not accept and inputs it cannot use, prints the path of every card that generates (the new draft, and one card per image of several), and does not wait for the files.'
		]
	});
}
