/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import type { VoicesResult } from '../../../../platform/basehalfProviders/common/basehalfProviderTypes.js';
import {
	BASEHALF_IMAGE_DEFAULT_MODE_INPUTS,
	BASEHALF_VIDEO_DEFAULT_MODE_INPUTS,
	BaseHalfModelKind,
	BaseHalfVideoCatalogState,
	BaseHalfVideoInputKind,
	baseHalfVideoRecordedSettingsSummary,
	findBaseHalfVideoModel,
	IBaseHalfVideoInputSource,
	planBaseHalfVideoInputs
} from './basehalfVideoCatalog.js';
import { baseHalfEditSummary, IBaseHalfMediaChoices } from '../../mediaEdit/common/basehalfEditRecord.js';
import { BaseHalfGenerationKind, IBaseHalfGenerationMade } from './basehalfGenerationInfo.js';
import { baseHalfVoiceLabel, baseHalfVoiceParameter } from './basehalfGenerationVoices.js';

/**
 * What the panel of a card with its file draws (D67, D78, generation cards,
 * "The panel of a card with its file"): what its `made.yaml` says made it,
 * the inputs that record names as they are on disk now, and the names of the
 * model catalog, or of the provider's last list of voices, when they have
 * them. Pure, like the presentation of a draft's panel; nothing it draws
 * changes the card.
 */

export interface IBaseHalfGenerationRecordState {
	readonly kind: BaseHalfGenerationKind;
	/** The record; absent when the `made.yaml` cannot be read. */
	readonly made?: IBaseHalfGenerationMade;
	/** The inputs the record names, resolved now, in its order. */
	readonly inputs: readonly IBaseHalfVideoInputSource[];
	readonly catalog: BaseHalfVideoCatalogState;
	/** The provider's last list of voices in a region, which names a voice the catalog does not (D78). */
	readonly voices?: (provider: string, region: string) => VoicesResult | undefined;
	/** What an edit of the file in Card Detail did (editing media, "Generation cards"). */
	readonly edit?: IBaseHalfMediaChoices;
}

export interface IBaseHalfGenerationRecordInput {
	/** The input's index in the record. */
	readonly index: number;
	readonly path: string;
	readonly kind: BaseHalfVideoInputKind;
	/** The start or the end frame, for a mode with frames. */
	readonly frame?: 'start' | 'end';
	/** Its file is not there any more. */
	readonly gone: boolean;
}

export interface IBaseHalfGenerationRecordPresentation {
	/** Whether the record could be read; without it the panel says so and has no New Version. */
	readonly readable: boolean;
	readonly inputs: readonly IBaseHalfGenerationRecordInput[];
	/** The prompt it was made with, as it was sent; empty when there was none. */
	readonly prompt: string;
	/** Which image or song of how many it is, or that it is a copy; and which part of the generated video a trimmed video holds. */
	readonly line?: string;
	/** The model's name, or its recorded id. */
	readonly model: string;
	/** The model with its provider and region. */
	readonly modelTitle: string;
	/** The voice a speech model spoke in: its name from the catalog or the provider's last list, or its recorded id. */
	readonly voice?: string;
	/** Such as `Frames · 720p · 5s · Sound`. */
	readonly settings: string;
	/** Every value it was made with, the advanced ones too. */
	readonly settingsTitle: string;
}

const UNREADABLE: IBaseHalfGenerationRecordPresentation = Object.freeze({
	readable: false,
	inputs: Object.freeze([]),
	prompt: '',
	model: '',
	modelTitle: '',
	settings: '',
	settingsTitle: ''
});

export function createBaseHalfGenerationRecordPresentation(state: IBaseHalfGenerationRecordState): IBaseHalfGenerationRecordPresentation {
	const made = state.made;
	if (!made) {
		return UNREADABLE;
	}
	const catalog = state.catalog.kind === 'ready' ? state.catalog.catalog : undefined;
	const ref = findBaseHalfVideoModel(catalog, made.provider, made.model);
	const mode = ref?.model.modes.find(candidate => candidate.id === made.mode);
	// What the generation used each input for: a frame by its slot.
	const modeInputs = mode?.inputs ?? (made.mode === 'frames' ? BASEHALF_VIDEO_DEFAULT_MODE_INPUTS : BASEHALF_IMAGE_DEFAULT_MODE_INPUTS);
	const plan = planBaseHalfVideoInputs(modeInputs, state.inputs.map(input => ({ path: input.path, kind: input.kind, available: true })));
	const inputs = plan.map((item, index): IBaseHalfGenerationRecordInput => {
		const frame = item.use === 'start-frame' ? 'start' : item.use === 'end-frame' ? 'end' : undefined;
		return Object.freeze({
			index,
			path: item.path,
			kind: item.kind,
			...(frame !== undefined ? { frame } : {}),
			gone: !state.inputs[index].available
		});
	});
	const base = made.copyOf !== undefined
		? localize('basehalf.generation.record.copy', "A copy. This is what made the original.")
		: made.output !== undefined && made.outputs !== undefined && made.outputs > 1
			? outputLine(state.kind, made.output, made.outputs)
			: undefined;
	// An edited file says how it differs from what was generated (editing media, "Generation cards").
	const summary = state.edit ? baseHalfEditSummary(state.edit) : undefined;
	const edited = summary !== undefined ? localize('basehalf.generation.record.edited', "Edited: {0}.", summary) : undefined;
	const line = base !== undefined && edited !== undefined ? localize('basehalf.generation.record.lineEdited', "{0} {1}", base, edited) : base ?? edited;
	const region = ref?.provider.regions.find(candidate => candidate.id === made.region);
	const recorded = () => [made.mode, ...Object.entries(made.params).map(([name, value]) => `${name} ${String(value)}`)];
	const settings = ref ? baseHalfVideoRecordedSettingsSummary(ref.model, made.mode, made.params) : recorded();
	const everySetting = ref ? baseHalfVideoRecordedSettingsSummary(ref.model, made.mode, made.params, true) : recorded();
	// The voice a speech model spoke in, as it was sent (D78); without the catalog it is among the recorded values.
	const voiceParameter = ref ? baseHalfVoiceParameter(ref.model) : undefined;
	const spokenIn = voiceParameter ? made.params[voiceParameter.name] : undefined;
	const voice = typeof spokenIn === 'string' && spokenIn ? baseHalfVoiceLabel(voiceParameter, spokenIn, state.voices?.(made.provider, made.region)) : undefined;
	return Object.freeze({
		readable: true,
		inputs: Object.freeze(inputs),
		prompt: made.prompt,
		...(line !== undefined ? { line } : {}),
		model: ref?.model.label ?? made.model,
		modelTitle: ref
			? ref.provider.regions.length > 1
				? localize('basehalf.generation.record.modelOnRegion', "Made with {0} on {1}, {2}", ref.model.label, ref.provider.label, region?.label ?? made.region)
				: localize('basehalf.generation.record.modelOn', "Made with {0} on {1}", ref.model.label, ref.provider.label)
			: localize('basehalf.generation.record.modelIds', "Made with {0} on {1}, {2}", made.model, made.provider, made.region),
		...(voice !== undefined ? { voice } : {}),
		settings: settings.join(' · '),
		settingsTitle: localize('basehalf.generation.record.settings', "Made with: {0}", everySetting.join(' · '))
	});
}

/** Which output of how many a file is, by what the card makes: "Image 2 of 4", "Song 1 of 2". */
function outputLine(kind: BaseHalfModelKind, output: number, outputs: number): string {
	switch (kind) {
		case 'image': return localize('basehalf.generation.record.imageOf', "Image {0} of {1}", output, outputs);
		case 'audio': return localize('basehalf.generation.record.songOf', "Song {0} of {1}", output, outputs);
		case 'video': return localize('basehalf.generation.record.videoOf', "Video {0} of {1}", output, outputs);
	}
}
