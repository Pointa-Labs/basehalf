/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { BaseHalfModelKind, BaseHalfVideoCatalogState, baseHalfVideoModeOf, baseHalfVideoRegionOffersMode, baseHalfVideoRegionOffersModel, findBaseHalfVideoModel, IBaseHalfVideoCatalogMode, IBaseHalfVideoCatalogModel, IBaseHalfVideoCatalogProvider, IBaseHalfVideoCatalogRegion, IBaseHalfVideoGenerationChoice, IBaseHalfVideoProviderSetup } from './basehalfVideoCatalog.js';
import { baseHalfVideoInputProblem, IBaseHalfVideoInputPlanItem } from './basehalfGenerationInputs.js';
import { localize } from '../../../../nls.js';

// Whether a generation card can generate now, and what it says when it cannot (generation cards, "The panel").

/**
 * Why the card cannot generate now, checked in this order (generation cards,
 * "The panel"). The panel shows the first one next to a disabled Generate
 * button; the generation service refuses with the same.
 */
export type BaseHalfVideoGenerateBlocker =
	| { readonly kind: 'generating' }
	| { readonly kind: 'catalogLoading' }
	| { readonly kind: 'catalogFailed'; readonly message: string }
	| { readonly kind: 'noModel' }
	| { readonly kind: 'unknownModel'; readonly model: string }
	/** The model makes another kind than the card's, `cardKind`. */
	| { readonly kind: 'otherKind'; readonly model: IBaseHalfVideoCatalogModel; readonly cardKind: BaseHalfModelKind }
	| { readonly kind: 'notSetUp'; readonly provider: IBaseHalfVideoCatalogProvider }
	| { readonly kind: 'region'; readonly model: IBaseHalfVideoCatalogModel; readonly region: IBaseHalfVideoCatalogRegion }
	/** The region offers the model, not its mode; `where` names the regions that do. */
	| { readonly kind: 'modeRegion'; readonly model: IBaseHalfVideoCatalogModel; readonly mode: IBaseHalfVideoCatalogMode; readonly where: string }
	/** An input names a draft, which has no file yet. */
	| { readonly kind: 'draftInput'; readonly path: string }
	/** No mode of the model can use this input with the ones before it ({@link baseHalfVideoInputProblem}); `name` is how the panel names it. */
	| { readonly kind: 'unusableInput'; readonly path: string; readonly name: string; readonly reason: string }
	/** The prompt mentions a file that is not connected (D74). */
	| { readonly kind: 'unconnectedMention'; readonly path: string }
	/** The first problem the provider module reported for the planned generation. */
	| { readonly kind: 'check'; readonly message: string }
	| { readonly kind: 'nothingToSend' };

export interface IBaseHalfVideoGenerateBlockerInput {
	/** The card generates, in this window or in another one of this computer. */
	readonly generating: boolean;
	readonly catalog: BaseHalfVideoCatalogState;
	readonly generation: IBaseHalfVideoGenerationChoice | undefined;
	/** The card's kind; a model of another kind blocks. */
	readonly kind?: BaseHalfModelKind;
	readonly setup: (provider: IBaseHalfVideoCatalogProvider) => IBaseHalfVideoProviderSetup;
	/** What `check` reported for the planned generation, when it was asked. */
	readonly problems?: readonly string[];
	/** The card's prompt, as the panel holds it. */
	readonly prompt: string;
	/** The planned inputs; without them, the blockers that need the inputs are not checked. */
	readonly plan?: readonly IBaseHalfVideoInputPlanItem[];
	/** The mode that is used, which the inputs were planned with ({@link baseHalfVideoModeThatIsUsed}); the card's own mode when absent. */
	readonly mode?: IBaseHalfVideoCatalogMode;
	/** The path of the first mention of the prompt whose file is not connected (D74). */
	readonly unconnected?: string;
}

export function getBaseHalfVideoGenerateBlocker(input: IBaseHalfVideoGenerateBlockerInput): BaseHalfVideoGenerateBlocker | undefined {
	if (input.generating) {
		return { kind: 'generating' };
	}
	if (input.catalog.kind === 'loading') {
		return { kind: 'catalogLoading' };
	}
	if (input.catalog.kind === 'failed') {
		return { kind: 'catalogFailed', message: input.catalog.message };
	}
	const modelId = input.generation?.model;
	if (!modelId) {
		return { kind: 'noModel' };
	}
	const ref = findBaseHalfVideoModel(input.catalog.catalog, input.generation?.provider, modelId);
	if (!ref) {
		return { kind: 'unknownModel', model: modelId };
	}
	if (input.kind !== undefined && ref.model.kind !== input.kind) {
		return { kind: 'otherKind', model: ref.model, cardKind: input.kind };
	}
	const setup = input.setup(ref.provider);
	if (!setup.setUp) {
		return { kind: 'notSetUp', provider: ref.provider };
	}
	if (!baseHalfVideoRegionOffersModel(ref.model, setup.region.id)) {
		return { kind: 'region', model: ref.model, region: setup.region };
	}
	const mode = input.mode ?? baseHalfVideoModeOf(ref.model, input.generation?.mode);
	if (!baseHalfVideoRegionOffersMode(mode, setup.region.id)) {
		const where = ref.provider.regions.filter(region => baseHalfVideoRegionOffersMode(mode, region.id) && baseHalfVideoRegionOffersModel(ref.model, region.id)).map(region => region.label).join(', ');
		return { kind: 'modeRegion', model: ref.model, mode, where };
	}
	// Nothing written and nothing connected, as on a new card: the empty prompt says it, before what the model needs.
	if (input.plan?.length === 0 && !input.prompt.trim()) {
		return { kind: 'nothingToSend' };
	}
	const draft = input.plan?.find(item => item.reason === 'draft');
	if (draft) {
		return { kind: 'draftInput', path: draft.path };
	}
	// Every input is sent: one that no mode of the model can use stops Generate (generation cards, "What is connected is sent").
	const unusable = input.plan ? baseHalfVideoInputProblem(ref.model, input.plan.map(item => ({ path: item.path, kind: item.kind, available: true }))) : undefined;
	if (unusable && input.plan) {
		return { kind: 'unusableInput', path: unusable.path, name: unusable.path.slice(unusable.path.lastIndexOf('/') + 1) || unusable.path, reason: unusable.reason };
	}
	if (input.unconnected !== undefined) {
		return { kind: 'unconnectedMention', path: input.unconnected };
	}
	const problem = input.problems?.find(message => message.trim().length > 0);
	if (problem) {
		return { kind: 'check', message: problem.trim() };
	}
	if (input.plan && !input.prompt.trim() && !input.plan.some(item => item.use !== 'unused')) {
		return { kind: 'nothingToSend' };
	}
	return undefined;
}

/** Whether a blocker is about the model or its provider: the model button is outlined for it. */
export function isBaseHalfVideoModelBlocker(blocker: BaseHalfVideoGenerateBlocker | undefined): boolean {
	return blocker?.kind === 'noModel' || blocker?.kind === 'unknownModel' || blocker?.kind === 'otherKind' || blocker?.kind === 'notSetUp' || blocker?.kind === 'region';
}

/** A blocker in words, as the Generate button, the model button, and a refused generation say it. */
export function baseHalfVideoGenerateBlockerText(blocker: BaseHalfVideoGenerateBlocker): string {
	switch (blocker.kind) {
		case 'generating':
			return localize('basehalf.video.catalog.blocker.generating', "This card is already generating.");
		case 'catalogLoading':
			return localize('basehalf.video.catalog.blocker.catalogLoading', "The models are still loading.");
		case 'catalogFailed':
			return localize('basehalf.video.catalog.blocker.catalogFailed', "BaseHalf could not load the models: {0}", blocker.message);
		case 'noModel':
			return localize('basehalf.video.catalog.blocker.noModel', "Choose a model to generate.");
		case 'unknownModel':
			return localize('basehalf.video.catalog.blocker.unknownModel', "{0} is not a model BaseHalf offers. Choose another model.", blocker.model);
		case 'otherKind':
			return otherKindText(blocker.model, blocker.cardKind);
		case 'notSetUp':
			return localize('basehalf.video.catalog.blocker.notSetUp', "{0} is not set up. Set it up in Providers.", blocker.provider.label);
		case 'region':
			return localize('basehalf.video.catalog.blocker.region', "{0} is not offered in {1}. Choose another model, or another region in Providers.", blocker.model.label, blocker.region.label);
		case 'modeRegion':
			return localize('basehalf.video.catalog.blocker.modeRegion', "{0} offers {1} mode only in {2}. Choose another mode, or another region in Providers.", blocker.model.label, blocker.mode.label, blocker.where);
		case 'draftInput':
			return baseHalfVideoDraftInputText(blocker.path);
		case 'unusableInput':
			return localize('basehalf.video.catalog.blocker.unusableInput', "{0} cannot be sent: {1}", blocker.name, blocker.reason);
		case 'unconnectedMention':
			return localize('basehalf.video.catalog.blocker.unconnectedMention', "The prompt mentions {0}, which is not connected.", blocker.path.slice(blocker.path.lastIndexOf('/') + 1) || blocker.path);
		case 'check':
			return blocker.message;
		case 'nothingToSend':
			return localize('basehalf.video.catalog.blocker.nothingToSend', "Write a prompt or connect an input to generate.");
	}
}

/** Why a model of another kind than the card's does not generate it: what the model makes, and what to choose. */
function otherKindText(model: IBaseHalfVideoCatalogModel, cardKind: BaseHalfModelKind): string {
	switch (model.kind) {
		case 'image':
			return cardKind === 'audio'
				? localize('basehalf.video.catalog.blocker.imageModelForAudio', "{0} makes images. Choose an audio model.", model.label)
				: localize('basehalf.video.catalog.blocker.imageModel', "{0} makes images. Choose a video model.", model.label);
		case 'video':
			return cardKind === 'audio'
				? localize('basehalf.video.catalog.blocker.videoModelForAudio', "{0} makes videos. Choose an audio model.", model.label)
				: localize('basehalf.video.catalog.blocker.videoModel', "{0} makes videos. Choose an image model.", model.label);
		case 'audio':
			return cardKind === 'image'
				? localize('basehalf.video.catalog.blocker.audioModelForImage', "{0} makes sounds. Choose an image model.", model.label)
				: localize('basehalf.video.catalog.blocker.audioModelForVideo', "{0} makes sounds. Choose a video model.", model.label);
	}
}

/** Why an input that names a draft keeps a card from generating. */
export function baseHalfVideoDraftInputText(path: string): string {
	return localize('basehalf.video.catalog.blocker.draftInput', "{0} has no file yet. Generate it first, or remove its connection.", path.slice(path.lastIndexOf('/') + 1) || path);
}
