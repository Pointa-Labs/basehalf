/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { language } from '../../../../base/common/platform.js';
import { localize } from '../../../../nls.js';
import {
	BASEHALF_IMAGE_DEFAULT_MODE_INPUTS,
	BASEHALF_VIDEO_DEFAULT_MODE_INPUTS,
	BaseHalfVideoCatalogState,
	BaseHalfVideoInputKind,
	baseHalfVideoRecordedSettingsSummary,
	findBaseHalfVideoModel,
	IBaseHalfVideoInputSource,
	planBaseHalfVideoInputs
} from './basehalfVideoCatalog.js';
import { BaseHalfGenerationKind, IBaseHalfGenerationMade } from './basehalfGenerationInfo.js';
import { baseHalfVideoPanelInputFileName } from './basehalfVideoNodePanelPresentation.js';

/**
 * What the panel of a card with its file draws (D67, generation cards, "The
 * panel of a card with its file"): what its `made.yaml` says made it, the
 * inputs that record names as they are on disk now, and the names of the
 * model catalog when it has them. Pure, like the presentation of a draft's
 * panel; nothing it draws changes the card.
 */

export interface IBaseHalfGenerationRecordState {
	readonly kind: BaseHalfGenerationKind;
	/** The record; absent when the `made.yaml` cannot be read. */
	readonly made?: IBaseHalfGenerationMade;
	/** The inputs the record names, resolved now, in its order. */
	readonly inputs: readonly IBaseHalfVideoInputSource[];
	readonly catalog: BaseHalfVideoCatalogState;
	readonly displayLanguage?: string;
}

export interface IBaseHalfGenerationRecordInput {
	/** The input's index in the record. */
	readonly index: number;
	readonly path: string;
	readonly kind: BaseHalfVideoInputKind;
	/** `Start` or `End`, for a frame of a mode with frames. */
	readonly title?: string;
	/** The name the prompt had for it, such as `图片1`, or its file name. */
	readonly name: string;
	/** Its file is not there any more. */
	readonly gone: boolean;
	readonly tooltip: string;
}

export interface IBaseHalfGenerationRecordPresentation {
	/** Whether the record could be read; without it the panel says so and has no New Version. */
	readonly readable: boolean;
	readonly inputs: readonly IBaseHalfGenerationRecordInput[];
	/** The prompt it was made with, as it was sent; empty when there was none. */
	readonly prompt: string;
	/** Which image of how many it is, or that it is a copy. */
	readonly line?: string;
	/** The model's name, or its recorded id. */
	readonly model: string;
	/** The model with its provider and region. */
	readonly modelTitle: string;
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
	const displayLanguage = state.displayLanguage ?? language;
	const catalog = state.catalog.kind === 'ready' ? state.catalog.catalog : undefined;
	const ref = findBaseHalfVideoModel(catalog, made.provider, made.model);
	const mode = ref?.model.modes.find(candidate => candidate.id === made.mode);
	// The names the generation gave its inputs: numbered by kind in the record's order, a frame by its slot.
	const modeInputs = mode?.inputs ?? (made.mode === 'frames' ? BASEHALF_VIDEO_DEFAULT_MODE_INPUTS : BASEHALF_IMAGE_DEFAULT_MODE_INPUTS);
	const plan = planBaseHalfVideoInputs(modeInputs, state.inputs.map(input => ({ path: input.path, kind: input.kind, available: true })), displayLanguage);
	const inputs = plan.map((item, index): IBaseHalfGenerationRecordInput => {
		const gone = !state.inputs[index].available;
		const title = item.use === 'start-frame'
			? localize('basehalf.generation.record.start', "Start")
			: item.use === 'end-frame' ? localize('basehalf.generation.record.end', "End") : undefined;
		return Object.freeze({
			index,
			path: item.path,
			kind: item.kind,
			...(title !== undefined ? { title } : {}),
			name: item.label ?? baseHalfVideoPanelInputFileName(item.path),
			gone,
			tooltip: gone ? localize('basehalf.generation.record.inputGone', "Not there any more: {0}", item.path) : item.path
		});
	});
	const line = made.copyOf !== undefined
		? localize('basehalf.generation.record.copy', "A copy. This is what made the original.")
		: made.output !== undefined && made.outputs !== undefined && made.outputs > 1
			? state.kind === 'image'
				? localize('basehalf.generation.record.imageOf', "Image {0} of {1}", made.output, made.outputs)
				: localize('basehalf.generation.record.videoOf', "Video {0} of {1}", made.output, made.outputs)
			: undefined;
	const region = ref?.provider.regions.find(candidate => candidate.id === made.region);
	const recorded = () => [made.mode, ...Object.entries(made.params).map(([name, value]) => `${name} ${String(value)}`)];
	const settings = ref ? baseHalfVideoRecordedSettingsSummary(ref.model, made.mode, made.params) : recorded();
	const everySetting = ref ? baseHalfVideoRecordedSettingsSummary(ref.model, made.mode, made.params, true) : recorded();
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
		settings: settings.join(' · '),
		settingsTitle: localize('basehalf.generation.record.settings', "Made with: {0}", everySetting.join(' · '))
	});
}
