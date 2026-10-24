/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { isMacintosh } from '../../../../base/common/platform.js';
import { localize } from '../../../../nls.js';
import type { VoiceParameter, VoicesResult } from '../../../../platform/basehalfProviders/common/basehalfProviderTypes.js';
import { baseHalfItemDisplayName } from '../../cardDetail/common/basehalfCardDetail.js';
import {
	BASEHALF_IMAGE_DEFAULT_MODE_INPUTS,
	BASEHALF_VIDEO_DEFAULT_MODE_INPUTS,
	BaseHalfVideoCatalogParameter,
	BaseHalfVideoCatalogState,
	BaseHalfVideoGenerateBlocker,
	BaseHalfVideoInputKind,
	BaseHalfVideoInputUse,
	BaseHalfVideoModeId,
	BaseHalfVideoParams,
	BaseHalfVideoParamValue,
	baseHalfVideoGenerateBlockerText,
	baseHalfVideoLimitRange,
	baseHalfVideoListedModels,
	baseHalfVideoModelAbilities,
	baseHalfVideoModeParameters,
	baseHalfVideoModeThatIsUsed,
	baseHalfVideoModeUsesEveryInput,
	baseHalfVideoNumberSteps,
	baseHalfVideoNumberValues,
	baseHalfVideoParameterDefault,
	baseHalfVideoParamValueLabel,
	baseHalfVideoRatioParts,
	baseHalfVideoRegionOffersMode,
	baseHalfVideoRegionOffersModel,
	baseHalfVideoSentParams,
	baseHalfVideoSettingsSummary,
	BaseHalfModelKind,
	findBaseHalfVideoModel,
	fitBaseHalfVideoParams,
	formatBaseHalfVideoNumber,
	getBaseHalfVideoGenerateBlocker,
	IBaseHalfVideoCatalogMode,
	IBaseHalfVideoCatalogModel,
	IBaseHalfVideoCatalogProvider,
	IBaseHalfVideoCatalogRegion,
	IBaseHalfVideoCheckLimit,
	IBaseHalfVideoCheckRequest,
	IBaseHalfVideoCheckResult,
	IBaseHalfVideoInputPlanItem,
	IBaseHalfVideoInputSource,
	IBaseHalfVideoModeInputs,
	IBaseHalfVideoModelRef,
	IBaseHalfVideoNumberParameter,
	IBaseHalfVideoProviderSetup,
	isBaseHalfVideoModelBlocker,
	normalizeBaseHalfVideoParams,
	planBaseHalfVideoInputs
} from './basehalfVideoCatalog.js';
import { buildBaseHalfPromptParts } from './basehalfGenerationMentions.js';
import { baseHalfGenerationChoice, IBaseHalfGenerationInfo } from './basehalfGenerationInfo.js';
import { baseHalfFormatCount, baseHalfVoiceLabel, baseHalfVoiceParameter } from './basehalfGenerationVoices.js';

/**
 * Everything the panel under a selected generation card draws (D63, D64,
 * D78, generation cards, "The panel" and "Settings"), computed from the
 * card's generation information and kind, its resolved inputs, the model
 * catalog, how each provider is set up, the provider's last list of voices,
 * the last answer of `check`, and whether it generates. Pure: the panel
 * renders it and the tests check it without a document. What the panel shows
 * is what the generation service sends, because both use the rules of
 * `basehalfVideoCatalog.ts`.
 */

export interface IBaseHalfVideoPanelState {
	/** What the draft's generation uses. Only a draft has this panel (D67). */
	readonly info: IBaseHalfGenerationInfo;
	/** What the card makes: its model menu lists the models of this kind. */
	readonly kind: BaseHalfModelKind;
	/** The card's upstream entries, resolved, in order. */
	readonly inputs: readonly IBaseHalfVideoInputSource[];
	/** The text of the text inputs that were read, by upstream entry, without front matter. */
	readonly texts?: ReadonlyMap<string, string>;
	readonly catalog: BaseHalfVideoCatalogState;
	readonly setup: (provider: IBaseHalfVideoCatalogProvider) => IBaseHalfVideoProviderSetup;
	/** The provider's last list of voices in a region, which names a voice the catalog does not (D78). */
	readonly voices?: (provider: string, region: string) => VoicesResult | undefined;
	/** The last answer of `check` for the card's model. */
	readonly check?: IBaseHalfVideoCheckResult;
	/** The card generates, in this window or in another one of this computer. */
	readonly generating: boolean;
	/** The prompt as the panel holds it, which can be newer than the file. */
	readonly prompt: string;
}

export interface IBaseHalfVideoPanelInputItem {
	/** The entry's index in the card's upstream list. */
	readonly index: number;
	readonly path: string;
	readonly kind: BaseHalfVideoInputKind;
	readonly use: BaseHalfVideoInputUse;
	/** The name of its file, as BaseHalf shows names: what its tile, its look, and its chips say (D74). */
	readonly fileName: string;
	readonly used: boolean;
	/** Why it is not used, in words. */
	readonly reason?: string;
	/** What it is used for or why it is not, and its path. */
	readonly tooltip: string;
}

export interface IBaseHalfVideoPanelFrameSlot {
	readonly role: 'start' | 'end';
	/** `Start` or `End`. */
	readonly title: string;
	readonly item?: IBaseHalfVideoPanelInputItem;
	/** The accessible name of an empty slot, which offers to add a frame. */
	readonly addLabel: string;
}

export interface IBaseHalfVideoPanelInputRow {
	readonly mode: BaseHalfVideoModeId;
	/** As many frame slots as the mode has. */
	readonly slots: readonly IBaseHalfVideoPanelFrameSlot[];
	/** The upstream list with the two frames' entries exchanged, when both slots are filled. */
	readonly swappedUpstream?: readonly string[];
	/** The inputs the row shows besides the slots, in upstream order. */
	readonly items: readonly IBaseHalfVideoPanelInputItem[];
	/** What a row without inputs says. */
	readonly emptyHint?: string;
}

export interface IBaseHalfVideoPanelModelButton {
	/** The model's name, `Choose Model`, or that the models load. */
	readonly label: string;
	readonly chosen: boolean;
	/** The model or its provider keeps the card from generating. */
	readonly outlined: boolean;
	readonly title: string;
}

/** The voice button of a model that speaks (D78; generation cards, "The panel"). */
export interface IBaseHalfVideoPanelVoiceButton {
	/** The model's voice, whose options are the catalog's voices. */
	readonly parameter: VoiceParameter;
	/** The card's voice, or the model's default voice. */
	readonly value: string;
	/** The voice's name: the catalog's, or the provider's last list's, or its id. */
	readonly label: string;
	/** `Voice` */
	readonly title: string;
}

export interface IBaseHalfVideoPanelModelMenuItem {
	readonly provider: string;
	readonly model: string;
	readonly label: string;
	readonly checked: boolean;
	/** Why the provider's region does not offer it. It is dimmed, and can still be chosen. */
	readonly unavailable?: string;
	/** The model's abilities in one line, such as `Frames · References · 15s · 1080p · Sound`. */
	readonly detail: string;
	readonly title: string;
}

export interface IBaseHalfVideoPanelModelMenuGroup {
	readonly provider: string;
	readonly label: string;
	/** `Not set up`, or the region in use. */
	readonly detail?: string;
	readonly items: readonly IBaseHalfVideoPanelModelMenuItem[];
}

export interface IBaseHalfVideoPanelModelMenu {
	/** While the catalog loads or after it failed, what the menu says in place of models. */
	readonly message?: string;
	readonly groups: readonly IBaseHalfVideoPanelModelMenuGroup[];
	/** `Providers…` */
	readonly settingsLabel: string;
}

export interface IBaseHalfVideoPanelChoice<T> {
	/** Unique within its control: `<name>:<value>`, or `<name>:none`. */
	readonly key: string;
	/** `undefined` for **None**: an optional parameter left unset. */
	readonly value: T | undefined;
	readonly label: string;
	readonly selected: boolean;
	/** The ratio's proportions, for a choice drawn as ratio shapes. */
	readonly shape?: { readonly width: number; readonly height: number };
	/** Why the choice cannot generate here, such as a mode the region does not offer; it is dimmed and can still be chosen. */
	readonly unavailable?: string;
	/** Why the choice cannot be chosen, such as a mode that cannot use every input of the card; it is dimmed and cannot be chosen. */
	readonly disabled?: string;
}

interface IBaseHalfVideoPanelControlBase {
	readonly name: string;
	readonly label: string;
	readonly tooltip?: string;
	/** Why a number goes less far than its model declares, with how far, such as "Up to 25s. The connected video lasts 5.0 seconds, …" (D70). */
	readonly limit?: string;
}

/** One parameter as the settings popover draws it (generation cards, "Settings"). */
export type BaseHalfVideoPanelControl =
	| IBaseHalfVideoPanelControlBase & { readonly kind: 'buttons' | 'list' | 'ratio'; readonly choices: readonly IBaseHalfVideoPanelChoice<BaseHalfVideoParamValue>[] }
	| IBaseHalfVideoPanelControlBase & {
		readonly kind: 'slider';
		readonly min: number;
		readonly max: number;
		readonly step: number;
		/** Where the slider stands: the value, or the default while Auto is chosen. */
		readonly value: number;
		readonly valueLabel: string;
		readonly auto?: IBaseHalfVideoPanelAuto;
		readonly unit?: 'seconds';
	}
	| IBaseHalfVideoPanelControlBase & {
		readonly kind: 'number';
		readonly min: number;
		readonly max: number;
		readonly step: number;
		readonly integer: boolean;
		/** Shown after the field. */
		readonly unit?: 'seconds';
		/** The value as the field shows it; empty while it is not set or Auto is chosen. */
		readonly text: string;
		/** The value an empty field takes: the default, or none for an optional parameter. */
		readonly placeholder: string;
		readonly optional: boolean;
		readonly auto?: IBaseHalfVideoPanelAuto;
	}
	| IBaseHalfVideoPanelControlBase & { readonly kind: 'switch'; readonly on: boolean }
	| IBaseHalfVideoPanelControlBase & { readonly kind: 'text'; readonly text: string; readonly maxLength: number; readonly multiline: boolean; readonly optional: boolean }
	/** A parameter the start frame sets while the plan has one: shown, not chosen. */
	| IBaseHalfVideoPanelControlBase & { readonly kind: 'fixed'; readonly text: string };

export interface IBaseHalfVideoPanelAuto {
	readonly selected: boolean;
	readonly label: string;
	readonly value: number;
	/** What choosing a value again sets: the default. */
	readonly fallback: number;
}

export interface IBaseHalfVideoPanelSettingsView {
	/** Such as `Frames · 720p · 5s · Sound`. */
	readonly summary: string;
	readonly summaryParts: readonly string[];
	/** Absent when the model offers one mode. */
	readonly modes?: readonly IBaseHalfVideoPanelChoice<BaseHalfVideoModeId>[];
	/** The parameters that are not advanced, in the model's order. */
	readonly controls: readonly BaseHalfVideoPanelControl[];
	/** The advanced parameters, under More. */
	readonly advanced: readonly BaseHalfVideoPanelControl[];
}

/** Why Generate cannot run, above the footer; with the action that fixes it, when one does. */
export interface IBaseHalfVideoPanelReason {
	readonly text: string;
	/** Opens Providers at the provider. */
	readonly action?: { readonly label: string; readonly provider: string };
}

export interface IBaseHalfVideoPanelGenerateButton {
	/** While the card generates, the button is a stop square. */
	readonly kind: 'generate' | 'stop';
	readonly enabled: boolean;
	/** The accessible name: what the button does, or why it cannot. */
	readonly label: string;
	readonly title: string;
}

export interface IBaseHalfVideoPanelPresentation {
	/** The card's model, when the catalog has it. */
	readonly ref?: IBaseHalfVideoModelRef;
	/** The card's mode of that model. */
	readonly mode?: IBaseHalfVideoCatalogMode;
	/** The region of the model's provider in use. */
	readonly region?: IBaseHalfVideoCatalogRegion;
	/** The values shown and sent: the card's, made legal for the model and mode. */
	readonly params: BaseHalfVideoParams;
	readonly plan: readonly IBaseHalfVideoInputPlanItem[];
	/** Absent when the mode and the card have no inputs to show. */
	readonly inputRow?: IBaseHalfVideoPanelInputRow;
	readonly model: IBaseHalfVideoPanelModelButton;
	readonly modelMenu: IBaseHalfVideoPanelModelMenu;
	/** Present while the card's model speaks in a voice. */
	readonly voice?: IBaseHalfVideoPanelVoiceButton;
	/** What the empty prompt says, by the card's kind, what its model makes, and the mode that is used. */
	readonly placeholder: string;
	/** Absent until the catalog has the card's model. */
	readonly settingsView?: IBaseHalfVideoPanelSettingsView;
	readonly generate: IBaseHalfVideoPanelGenerateButton;
	readonly blocker?: BaseHalfVideoGenerateBlocker;
	readonly blockerText?: string;
	/** Why Generate cannot run, when the panel shows it as a line (generation cards, "The panel"). */
	readonly reason?: IBaseHalfVideoPanelReason;
	/**
	 * What the panel asks `check` for the problems, without the inputs, which
	 * the panel adds with their files: absent while the region does not offer
	 * the model.
	 */
	readonly checkRequest?: Omit<IBaseHalfVideoCheckRequest, 'inputs'>;
}

export function createBaseHalfVideoPanelPresentation(state: IBaseHalfVideoPanelState): IBaseHalfVideoPanelPresentation {
	const generation = baseHalfGenerationChoice(state.info);
	const catalog = state.catalog.kind === 'ready' ? state.catalog.catalog : undefined;
	const ref = findBaseHalfVideoModel(catalog, generation?.provider, generation?.model);
	// The mode that is used follows the inputs (generation cards, "What is connected is sent").
	const mode = ref ? baseHalfVideoModeThatIsUsed(ref.model, generation?.mode, state.inputs) : undefined;
	const region = ref ? state.setup(ref.provider).region : undefined;
	const params = ref && mode ? normalizeBaseHalfVideoParams(ref.model, mode.id, generation?.params) : Object.freeze({ ...generation?.params });
	// Without a model, a video card takes frames, and an image or an audio card references, as every model of its kind does.
	const modeInputs = mode?.inputs ?? defaultModeInputs(state.kind);
	const modeId = mode?.id ?? generation?.mode ?? (state.kind === 'video' ? 'frames' : 'reference');
	const plan = planBaseHalfVideoInputs(modeInputs, state.inputs);
	const startFrame = plan.some(item => item.use === 'start-frame');
	// The prompt in parts, as a generation sends it: each mention as its input's place in the request (D74).
	const prompt = buildBaseHalfPromptParts(state.prompt, plan, item => state.texts?.get(item.path));
	const checkRequest = ref && mode && region && baseHalfVideoRegionOffersModel(ref.model, region.id)
		? Object.freeze<Omit<IBaseHalfVideoCheckRequest, 'inputs'>>({
			provider: ref.provider.id,
			region: region.id,
			model: ref.model.id,
			mode: mode.id,
			params: baseHalfVideoSentParams(ref.model, mode.id, params, startFrame),
			prompt: prompt.parts
		})
		: undefined;
	const blocker = getBaseHalfVideoGenerateBlocker({
		generating: state.generating,
		catalog: state.catalog,
		generation,
		kind: state.kind,
		setup: state.setup,
		problems: checkRequest ? state.check?.problems : undefined,
		prompt: state.prompt,
		plan,
		...(mode ? { mode } : {}),
		...(prompt.unconnected !== undefined ? { unconnected: prompt.unconnected } : {})
	});
	const blockerText = blocker ? baseHalfVideoGenerateBlockerText(blocker) : undefined;
	const modelLabel = ref?.model.label ?? localize('basehalf.video.panel.thisModel', "This model");
	const modeLabel = mode?.label ?? localize('basehalf.video.panel.thisMode', "this mode");
	const items = plan.map((item, index) => inputItem(item, index, modeInputs, modelLabel, modeLabel, state.kind));
	const row = inputRow(modeId, modeInputs, items);
	// The voice of a model that speaks has its own button, not a setting (D78).
	const voiceParameter = ref && mode ? baseHalfVoiceParameter(ref.model, mode.id) : undefined;
	const voice = ref && region && voiceParameter ? voiceButton(voiceParameter, params, state.voices?.(ref.provider.id, region.id)) : undefined;
	return Object.freeze({
		...(ref ? { ref } : {}),
		...(mode ? { mode } : {}),
		...(region ? { region } : {}),
		params,
		plan,
		...(row ? { inputRow: row } : {}),
		model: modelButton(state, ref, region, blocker, blockerText),
		modelMenu: modelMenu(state),
		...(voice ? { voice } : {}),
		placeholder: baseHalfVideoPanelPlaceholder(state.kind, ref?.model, mode?.id),
		...(ref && mode ? { settingsView: settingsView(ref, mode, params, startFrame, region, state.inputs, checkRequest ? state.check?.limits : undefined) } : {}),
		generate: generateButton(state, blocker, blockerText),
		...(blocker ? { blocker, blockerText } : {}),
		...(blocker && blockerText ? reasonOf(blocker, blockerText, ref?.provider.id) : {}),
		...(checkRequest ? { checkRequest } : {})
	});
}

/**
 * The `@` the caret stands after, and what was typed after it. An `@` counts
 * after the start, a space, or anything that is not a Latin letter or digit, so
 * an e-mail address does not open the menu but `图片里的@` does.
 */
export function baseHalfVideoPanelMentionQuery(text: string, caret: number): { readonly start: number; readonly query: string } | undefined {
	const before = text.slice(0, Math.max(0, Math.min(caret, text.length)));
	const at = before.lastIndexOf('@');
	if (at < 0) {
		return undefined;
	}
	const query = before.slice(at + 1);
	if (query.length > 16 || /[\s@]/.test(query)) {
		return undefined;
	}
	if (at > 0 && /[A-Za-z0-9._%+-]/.test(before.charAt(at - 1))) {
		return undefined;
	}
	return Object.freeze({ start: at, query });
}

/** The upstream list with the entries at `first` and `second` exchanged, and nothing else changed. */
export function swapBaseHalfVideoUpstreamEntries(upstream: readonly string[], first: number, second: number): readonly string[] {
	const next = [...upstream];
	if (first < 0 || second < 0 || first >= next.length || second >= next.length || first === second) {
		return Object.freeze(next);
	}
	[next[first], next[second]] = [next[second], next[first]];
	return Object.freeze(next);
}

/** The name an input is shown by: a note without its extension, any other file by its file name. */
export function baseHalfVideoPanelInputFileName(path: string): string {
	return baseHalfItemDisplayName(path.slice(path.lastIndexOf('/') + 1), false);
}

/** `⌘Enter` on macOS and `Ctrl+Enter` elsewhere. */
export function baseHalfVideoPanelGenerateKeyLabel(): string {
	return isMacintosh ? '⌘Enter' : 'Ctrl+Enter';
}

/**
 * What the empty prompt says it is (generation cards, "The panel"), by the
 * card's kind, what its model makes, and the mode that is used: what the
 * voice says for a speech model, the lyrics in Lyrics mode, and otherwise
 * what to describe. An audio card without a model describes the sound.
 */
export function baseHalfVideoPanelPlaceholder(kind: BaseHalfModelKind, model?: IBaseHalfVideoCatalogModel, modeId?: BaseHalfVideoModeId): string {
	if (kind === 'image') {
		return localize('basehalf.video.panel.imagePromptPlaceholder', "Describe the image. Type @ to mention an input.");
	}
	if (kind === 'video') {
		return localize('basehalf.video.panel.promptPlaceholder', "Describe the video. Type @ to mention an input.");
	}
	const makes = model?.kind === 'audio' ? model.makes : undefined;
	if (makes === 'speech') {
		return localize('basehalf.video.panel.speechPromptPlaceholder', "Write what the voice says. Type @ to mention an input.");
	}
	if (modeId === 'lyrics') {
		return localize('basehalf.video.panel.lyricsPromptPlaceholder', "Write the lyrics. Type @ to mention an input.");
	}
	return makes === 'music'
		? localize('basehalf.video.panel.musicPromptPlaceholder', "Describe the music. Type @ to mention an input.")
		: localize('basehalf.video.panel.soundPromptPlaceholder', "Describe the sound. Type @ to mention an input.");
}

/**
 * What an audio card takes while it has no model: images and sounds as
 * references, as an audio model's references mode does, as many as are
 * connected. It is no model's declaration; Generate needs a model of the
 * catalog.
 */
const AUDIO_DEFAULT_MODE_INPUTS: IBaseHalfVideoModeInputs = Object.freeze({
	startFrame: 'none',
	endFrame: 'none',
	images: Object.freeze({ min: 0, max: Number.MAX_SAFE_INTEGER }),
	videos: Object.freeze({ min: 0, max: 0 }),
	audios: Object.freeze({ min: 0, max: Number.MAX_SAFE_INTEGER }),
	source: 'none'
});

/** The slots a card of a kind shows its inputs in while it has no model. */
function defaultModeInputs(kind: BaseHalfModelKind): IBaseHalfVideoModeInputs {
	switch (kind) {
		case 'image': return BASEHALF_IMAGE_DEFAULT_MODE_INPUTS;
		case 'audio': return AUDIO_DEFAULT_MODE_INPUTS;
		case 'video': return BASEHALF_VIDEO_DEFAULT_MODE_INPUTS;
	}
}

/** The voice button: the card's voice, made legal for the model, by the name the catalog or the provider's last list gives it. */
function voiceButton(parameter: VoiceParameter, params: BaseHalfVideoParams, list: VoicesResult | undefined): IBaseHalfVideoPanelVoiceButton {
	const stored = params[parameter.name];
	const value = typeof stored === 'string' && stored ? stored : parameter.default;
	return Object.freeze({
		parameter,
		value,
		label: baseHalfVoiceLabel(parameter, value, list),
		title: localize('basehalf.video.panel.voice', "Voice")
	});
}

// --- inputs --------------------------------------------------------------------------------------

function inputItem(item: IBaseHalfVideoInputPlanItem, index: number, inputs: IBaseHalfVideoModeInputs, modelLabel: string, modeLabel: string, kind: BaseHalfModelKind): IBaseHalfVideoPanelInputItem {
	const fileName = baseHalfVideoPanelInputFileName(item.path);
	const used = item.use !== 'unused';
	const reason = used ? undefined : unusedReason(item, inputs, modelLabel, modeLabel, kind);
	const purpose = reason ?? usePurpose(item);
	return Object.freeze({
		index,
		path: item.path,
		kind: item.kind,
		use: item.use,
		fileName,
		used,
		...(reason !== undefined ? { reason } : {}),
		tooltip: `${purpose}\n${item.path}`
	});
}

function usePurpose(item: IBaseHalfVideoInputPlanItem): string {
	switch (item.use) {
		case 'start-frame': return localize('basehalf.video.panel.use.startFrame', "Start frame");
		case 'end-frame': return localize('basehalf.video.panel.use.endFrame', "End frame");
		case 'reference': return localize('basehalf.video.panel.use.reference', "Reference");
		case 'source': return localize('basehalf.video.panel.use.source', "Clip");
		default: return localize('basehalf.video.panel.use.text', "Its text is added to the prompt.");
	}
}

function unusedReason(item: IBaseHalfVideoInputPlanItem, inputs: IBaseHalfVideoModeInputs, modelLabel: string, modeLabel: string, kind: BaseHalfModelKind): string {
	switch (item.reason) {
		case 'missing':
			return localize('basehalf.video.panel.unused.missing', "Not used: the file is missing.");
		case 'draft':
			return localize('basehalf.video.panel.unused.draft', "Not used: it has no file yet.");
		case 'kind':
			return kind === 'image'
				? localize('basehalf.video.panel.unused.kindImage', "Not used: this kind of file cannot be sent to an image model.")
				: kind === 'audio'
					? localize('basehalf.video.panel.unused.kindAudio', "Not used: this kind of file cannot be sent to an audio model.")
					: localize('basehalf.video.panel.unused.kind', "Not used: this kind of file cannot be sent to a video model.");
		case 'mode':
			return item.kind === 'image'
				? localize('basehalf.video.panel.unused.noImages', "Not used: {0} takes no images in {1}.", modelLabel, modeLabel)
				: item.kind === 'video'
					? localize('basehalf.video.panel.unused.noVideos', "Not used: {0} takes no videos in {1}.", modelLabel, modeLabel)
					: localize('basehalf.video.panel.unused.noAudio', "Not used: {0} takes no audio in {1}.", modelLabel, modeLabel);
		default: {
			const count = item.kind === 'image'
				? (inputs.startFrame !== 'none' ? 1 : 0) + (inputs.endFrame !== 'none' ? 1 : 0) + inputs.images.max
				: item.kind === 'video'
					? (inputs.source !== 'none' ? 1 : 0) + inputs.videos.max
					: inputs.audios.max;
			if (item.kind === 'image') {
				return count === 1
					? localize('basehalf.video.panel.unused.oneImage', "Not used: {0} takes one image in {1}.", modelLabel, modeLabel)
					: localize('basehalf.video.panel.unused.images', "Not used: {0} takes up to {1} images in {2}.", modelLabel, count, modeLabel);
			}
			if (item.kind === 'video') {
				return count === 1
					? localize('basehalf.video.panel.unused.oneVideo', "Not used: {0} takes one video in {1}.", modelLabel, modeLabel)
					: localize('basehalf.video.panel.unused.videos', "Not used: {0} takes up to {1} videos in {2}.", modelLabel, count, modeLabel);
			}
			return count === 1
				? localize('basehalf.video.panel.unused.oneAudio', "Not used: {0} takes one audio file in {1}.", modelLabel, modeLabel)
				: localize('basehalf.video.panel.unused.audios', "Not used: {0} takes up to {1} audio files in {2}.", modelLabel, count, modeLabel);
		}
	}
}

function inputRow(mode: BaseHalfVideoModeId, inputs: IBaseHalfVideoModeInputs, items: readonly IBaseHalfVideoPanelInputItem[]): IBaseHalfVideoPanelInputRow | undefined {
	const start = inputs.startFrame !== 'none' ? items.find(item => item.use === 'start-frame') : undefined;
	const end = inputs.endFrame !== 'none' ? items.find(item => item.use === 'end-frame') : undefined;
	const slots: IBaseHalfVideoPanelFrameSlot[] = [];
	if (inputs.startFrame !== 'none') {
		slots.push(Object.freeze({
			role: 'start',
			title: localize('basehalf.video.panel.slot.start', "Start"),
			addLabel: localize('basehalf.video.panel.slot.addStart', "Add a Start Frame"),
			...(start ? { item: start } : {})
		}));
	}
	if (inputs.endFrame !== 'none') {
		slots.push(Object.freeze({
			role: 'end',
			title: localize('basehalf.video.panel.slot.end', "End"),
			addLabel: localize('basehalf.video.panel.slot.addEnd', "Add an End Frame"),
			...(end ? { item: end } : {})
		}));
	}
	const rest = items.filter(item => item !== start && item !== end);
	const takesMedia = inputs.images.max > 0 || inputs.videos.max > 0 || inputs.audios.max > 0 || inputs.source !== 'none';
	if (slots.length === 0 && rest.length === 0 && !takesMedia) {
		return undefined;
	}
	const upstream = items.map(item => item.path);
	const hint = slots.length === 0 && rest.length === 0 ? emptyHint(mode, inputs) : undefined;
	return Object.freeze({
		mode,
		slots: Object.freeze(slots),
		...(start && end ? { swappedUpstream: swapBaseHalfVideoUpstreamEntries(upstream, start.index, end.index) } : {}),
		items: Object.freeze(rest),
		...(hint ? { emptyHint: hint } : {})
	});
}

function emptyHint(mode: BaseHalfVideoModeId, inputs: IBaseHalfVideoModeInputs): string | undefined {
	if (inputs.source !== 'none') {
		return mode === 'edit'
			? inputs.images.max > 0
				? localize('basehalf.video.panel.hint.editWithImages', "Add the video to change, and images as references")
				: localize('basehalf.video.panel.hint.edit', "Add the video to change")
			: localize('basehalf.video.panel.hint.extend', "Add the video to continue");
	}
	const kinds = [
		...(inputs.images.max > 0 ? [localize('basehalf.video.panel.hint.images', "images")] : []),
		...(inputs.videos.max > 0 ? [localize('basehalf.video.panel.hint.videos', "videos")] : []),
		...(inputs.audios.max > 0 ? [localize('basehalf.video.panel.hint.audio', "audio")] : [])
	];
	switch (kinds.length) {
		case 0: return undefined;
		case 1: return localize('basehalf.video.panel.hint.referencesOne', "Add {0} as references", kinds[0]);
		case 2: return localize('basehalf.video.panel.hint.referencesTwo', "Add {0} or {1} as references", kinds[0], kinds[1]);
		default: return localize('basehalf.video.panel.hint.referencesThree', "Add {0}, {1}, or {2} as references", kinds[0], kinds[1], kinds[2]);
	}
}

// --- the model button and its menu -----------------------------------------------------------------

function modelButton(
	state: IBaseHalfVideoPanelState,
	ref: IBaseHalfVideoModelRef | undefined,
	region: IBaseHalfVideoCatalogRegion | undefined,
	blocker: BaseHalfVideoGenerateBlocker | undefined,
	blockerText: string | undefined
): IBaseHalfVideoPanelModelButton {
	const modelId = state.info.model;
	if (state.catalog.kind === 'loading') {
		const loading = localize('basehalf.video.panel.loadingModels', "Loading Models…");
		return Object.freeze({ label: loading, chosen: false, outlined: false, title: loading });
	}
	const outlined = isBaseHalfVideoModelBlocker(blocker);
	const label = ref?.model.label ?? modelId ?? localize('basehalf.video.panel.chooseModel', "Choose Model");
	const title = outlined && blockerText
		? blockerText
		: state.catalog.kind === 'failed'
			? baseHalfVideoGenerateBlockerText({ kind: 'catalogFailed', message: state.catalog.message })
			: ref && region
				? ref.provider.regions.length > 1
					? localize('basehalf.video.panel.modelOnRegion', "{0} on {1}, {2}", ref.model.label, ref.provider.label, region.label)
					: localize('basehalf.video.panel.modelOn', "{0} on {1}", ref.model.label, ref.provider.label)
				: label;
	return Object.freeze({ label, chosen: modelId !== undefined, outlined, title });
}

function modelMenu(state: IBaseHalfVideoPanelState): IBaseHalfVideoPanelModelMenu {
	const settingsLabel = localize('basehalf.video.panel.providers', "Providers…");
	if (state.catalog.kind === 'loading') {
		return Object.freeze({ message: localize('basehalf.video.panel.menuLoading', "Loading the models…"), groups: Object.freeze([]), settingsLabel });
	}
	if (state.catalog.kind === 'failed') {
		return Object.freeze({ message: baseHalfVideoGenerateBlockerText({ kind: 'catalogFailed', message: state.catalog.message }), groups: Object.freeze([]), settingsLabel });
	}
	const generation = baseHalfGenerationChoice(state.info);
	// The providers that are set up first, then the others, each in the catalog's order.
	const providers = [...state.catalog.catalog.providers].sort((a, b) => Number(state.setup(b).setUp) - Number(state.setup(a).setUp));
	const groups = providers.flatMap((provider): IBaseHalfVideoPanelModelMenuGroup[] => {
		const setup = state.setup(provider);
		// The models of the card's kind; a deprecated one only for a card that uses it.
		const items = baseHalfVideoListedModels(provider, generation, state.kind, setup.region.id).map(model => {
			const unavailable = baseHalfVideoRegionOffersModel(model, setup.region.id)
				? undefined
				: localize('basehalf.video.panel.notInRegion', "Not offered in {0}", setup.region.label);
			return Object.freeze({
				provider: provider.id,
				model: model.id,
				label: model.label,
				checked: generation?.provider === provider.id && generation.model === model.id,
				...(unavailable ? { unavailable } : {}),
				detail: model.kind === 'audio' ? audioModelAbilities(model) : baseHalfVideoModelAbilities(model),
				title: unavailable ?? model.description ?? model.label
			});
		});
		if (!items.length) {
			return [];
		}
		const detail = !setup.setUp
			? localize('basehalf.video.panel.notSetUp', "Not set up")
			: provider.regions.length > 1 ? setup.region.label : undefined;
		return [Object.freeze({ provider: provider.id, label: provider.label, ...(detail ? { detail } : {}), items: Object.freeze(items) })];
	});
	return Object.freeze({
		...(groups.length === 0 ? {
			message: state.kind === 'image'
				? localize('basehalf.video.panel.noImageModels', "BaseHalf offers no image models.")
				: state.kind === 'audio'
					? localize('basehalf.video.panel.noAudioModels', "BaseHalf offers no audio models.")
					: localize('basehalf.video.panel.noModels', "BaseHalf offers no video models.")
		} : {}),
		groups: Object.freeze(groups),
		settingsLabel
	});
}

/**
 * An audio model's abilities in one line, from its declarations (generation
 * cards, "The panel"): what it makes, then for speech the most characters
 * its prompt takes, and otherwise its modes when it has more than one, its
 * longest duration, how many songs one generation can make when that is more
 * than one, and how many reference images and sounds it takes, such as
 * `Speech · Up to 10,000 characters` and `Music · From a Description · From
 * Lyrics · Up to 3 songs · 1 reference sound`.
 */
function audioModelAbilities(model: IBaseHalfVideoCatalogModel): string {
	const parts: string[] = [];
	switch (model.makes) {
		case 'speech':
			parts.push(localize('basehalf.video.panel.makesSpeech', "Speech"));
			parts.push(localize('basehalf.video.panel.abilityCharacters', "Up to {0} characters", baseHalfFormatCount(model.prompt.maxLength)));
			return parts.join(' · ');
		case 'music':
			parts.push(localize('basehalf.video.panel.makesMusic', "Music"));
			break;
		case 'sound':
			parts.push(localize('basehalf.video.panel.makesSound', "Sound Effects"));
			break;
	}
	if (model.modes.length > 1) {
		parts.push(...model.modes.map(mode => mode.label));
	}
	const duration = longestDuration(model.parameters.find(parameter => parameter.name === 'duration'));
	if (duration) {
		parts.push(duration.fixed
			? localize('basehalf.video.panel.abilitySeconds', "{0}s", duration.text)
			: localize('basehalf.video.panel.abilityUpToSeconds', "Up to {0}s", duration.text));
	}
	const count = model.makes === 'music' ? model.parameters.find(parameter => parameter.name === 'count') : undefined;
	const songs = count?.kind === 'integer' || count?.kind === 'number' ? Math.min(16, Math.floor(count.max)) : 1;
	if (songs > 1) {
		parts.push(localize('basehalf.video.panel.abilitySongs', "Up to {0} songs", songs));
	}
	const images = Math.max(0, ...model.modes.map(mode => mode.inputs.images.max));
	if (images > 0) {
		parts.push(images === 1
			? localize('basehalf.video.panel.abilityReferenceImage', "1 reference image")
			: localize('basehalf.video.panel.abilityReferenceImages', "{0} reference images", images));
	}
	const sounds = Math.max(0, ...model.modes.map(mode => mode.inputs.audios.max));
	if (sounds > 0) {
		parts.push(sounds === 1
			? localize('basehalf.video.panel.abilityReferenceSound', "1 reference sound")
			: localize('basehalf.video.panel.abilityReferenceSounds', "{0} reference sounds", sounds));
	}
	return parts.join(' · ');
}

/** The longest duration a parameter declares, as the line writes it, and whether it is the only one: a number's highest, or a choice's. */
function longestDuration(parameter: BaseHalfVideoCatalogParameter | undefined): { readonly text: string; readonly fixed: boolean } | undefined {
	if (parameter?.kind === 'integer' || parameter?.kind === 'number') {
		return { text: formatBaseHalfVideoNumber(parameter, parameter.max), fixed: parameter.min === parameter.max };
	}
	if (parameter?.kind === 'choice') {
		const seconds = parameter.options.map(option => Number(option.value)).filter(value => Number.isFinite(value) && value > 0);
		return seconds.length ? { text: String(Math.max(...seconds)), fixed: seconds.length === 1 } : undefined;
	}
	return undefined;
}

// --- the settings ----------------------------------------------------------------------------------

/** Up to this many choices are a row of buttons; more are a list. */
const BUTTON_CHOICES = 5;
/** Up to this many steps of a number are a slider; more are a number field. */
const SLIDER_STEPS = 1000;

function settingsView(
	ref: IBaseHalfVideoModelRef,
	mode: IBaseHalfVideoCatalogMode,
	params: BaseHalfVideoParams,
	startFrame: boolean,
	region: IBaseHalfVideoCatalogRegion | undefined,
	inputs: readonly IBaseHalfVideoInputSource[],
	limits: IBaseHalfVideoCheckResult['limits']
): IBaseHalfVideoPanelSettingsView {
	// A value beyond a range the inputs narrow shows as what is sent: the end of the range (D70).
	const fitted = fitBaseHalfVideoParams(ref.model, params, limits);
	const parts = baseHalfVideoSettingsSummary(ref.model, mode.id, fitted, startFrame);
	// The voice is not among the settings: it has its own button (D78).
	const parameters = baseHalfVideoModeParameters(ref.model, mode.id).filter(isSetting);
	const shown = (parameter: BaseHalfVideoSetting) => startFrame && parameter.setByStartFrame
		? Object.freeze({ name: parameter.name, label: parameter.label, ...(parameter.tooltip ? { tooltip: parameter.tooltip } : {}), kind: 'fixed' as const, text: localize('basehalf.video.panel.setByStartFrame', "Set by the start frame") })
		: control(parameter, fitted[parameter.name], limits?.[parameter.name]);
	return Object.freeze({
		summary: parts.join(' · '),
		summaryParts: parts,
		...(ref.model.modes.length > 1 ? {
			modes: Object.freeze(ref.model.modes.map(candidate => {
				const unavailable = region && !baseHalfVideoRegionOffersMode(candidate, region.id)
					? localize('basehalf.video.panel.modeNotInRegion', "Not offered in {0}", region.label)
					: undefined;
				// A mode that cannot use every input is not chosen: what is connected is sent.
				const disabled = baseHalfVideoModeUsesEveryInput(candidate.inputs, inputs) ? undefined : modeCannotUse(candidate, inputs);
				return Object.freeze({
					key: `mode:${candidate.id}`,
					value: candidate.id,
					label: candidate.label,
					selected: candidate.id === mode.id,
					...(unavailable ? { unavailable } : {}),
					...(disabled ? { disabled } : {})
				});
			}))
		} : {}),
		controls: Object.freeze(parameters.filter(parameter => !parameter.advanced).map(shown)),
		advanced: Object.freeze(parameters.filter(parameter => parameter.advanced).map(shown))
	});
}

/** Why a mode cannot be chosen for the card's inputs: the first input it cannot use, as "Frames cannot use clip.mp4." */
function modeCannotUse(mode: IBaseHalfVideoCatalogMode, inputs: readonly IBaseHalfVideoInputSource[]): string {
	const plan = planBaseHalfVideoInputs(mode.inputs, inputs.map(input => input.available ? input : { path: input.path, kind: input.kind, available: true }));
	const item = plan.find(candidate => candidate.use === 'unused');
	const name = item ? baseHalfVideoPanelInputFileName(item.path) : '';
	return localize('basehalf.video.panel.modeCannotUse', "{0} cannot use {1}.", mode.label, name);
}

/** A parameter the settings popover draws: every kind but the voice, which has its own button. */
type BaseHalfVideoSetting = Exclude<BaseHalfVideoCatalogParameter, VoiceParameter>;

function isSetting(parameter: BaseHalfVideoCatalogParameter): parameter is BaseHalfVideoSetting {
	return parameter.kind !== 'voice';
}

function control(parameter: BaseHalfVideoSetting, value: BaseHalfVideoParamValue | undefined, limit?: IBaseHalfVideoCheckLimit): BaseHalfVideoPanelControl {
	const base = { name: parameter.name, label: parameter.label, ...(parameter.tooltip ? { tooltip: parameter.tooltip } : {}) };
	switch (parameter.kind) {
		case 'choice': {
			const choices: IBaseHalfVideoPanelChoice<BaseHalfVideoParamValue>[] = parameter.options.map(option => Object.freeze({
				key: `${parameter.name}:${option.value}`,
				value: option.value,
				label: option.label,
				selected: option.value === value,
				...(parameter.display === 'ratio' ? ratioShape(option.value) : {})
			}));
			if (parameter.optional) {
				choices.unshift(noneChoice(parameter.name, value));
			}
			const kind = parameter.display === 'ratio' ? 'ratio' : parameter.options.length <= BUTTON_CHOICES ? 'buttons' : 'list';
			return Object.freeze({ ...base, kind, choices: Object.freeze(choices) });
		}
		case 'integer':
		case 'number':
			return numberControl(parameter, value, limit ? { ...base, limit: limitNote(parameter, limit) } : base, limit);
		case 'boolean':
			return Object.freeze({ ...base, kind: 'switch', on: value === true });
		case 'text':
			return Object.freeze({
				...base,
				kind: 'text',
				text: typeof value === 'string' ? value : '',
				maxLength: parameter.maxLength,
				multiline: parameter.multiline === true,
				optional: parameter.optional === true
			});
	}
}

/** How far a limit lets a number go, and why: "Up to 25s. The connected video lasts …" (D70). */
function limitNote(parameter: IBaseHalfVideoNumberParameter, limit: IBaseHalfVideoCheckLimit): string {
	const range = baseHalfVideoLimitRange(parameter, limit);
	const end = (value: number) => baseHalfVideoParamValueLabel(parameter, value);
	return limit.min !== undefined && limit.max !== undefined
		? localize('basehalf.video.panel.limitBetween', "{0} to {1}. {2}", end(range.min), end(range.max), limit.reason)
		: limit.max !== undefined
			? localize('basehalf.video.panel.limitMax', "Up to {0}. {1}", end(range.max), limit.reason)
			: localize('basehalf.video.panel.limitMin', "At least {0}. {1}", end(range.min), limit.reason);
}

function numberControl(parameter: IBaseHalfVideoNumberParameter, value: BaseHalfVideoParamValue | undefined, base: { readonly name: string; readonly label: string; readonly tooltip?: string; readonly limit?: string }, limit?: IBaseHalfVideoCheckLimit): BaseHalfVideoPanelControl {
	const steps = baseHalfVideoNumberSteps(parameter);
	const autoSelected = parameter.auto !== undefined && value === parameter.auto.value;
	// A range the inputs narrow ends the slider and the field there (D70).
	const range = baseHalfVideoLimitRange(parameter, limit);
	const fallback = Math.min(range.max, Math.max(range.min, numberFallback(parameter)));
	const auto = parameter.auto ? Object.freeze({ selected: autoSelected, label: parameter.auto.label, value: parameter.auto.value, fallback }) : undefined;
	if (steps <= BUTTON_CHOICES) {
		const choices: IBaseHalfVideoPanelChoice<BaseHalfVideoParamValue>[] = baseHalfVideoNumberValues(parameter).map(number => Object.freeze({
			key: `${parameter.name}:${number}`,
			value: number,
			label: baseHalfVideoParamValueLabel(parameter, number),
			selected: number === value,
			...(limit && (number < range.min || number > range.max) ? { disabled: limit.reason } : {})
		}));
		if (parameter.auto) {
			choices.push(Object.freeze({ key: `${parameter.name}:auto`, value: parameter.auto.value, label: parameter.auto.label, selected: autoSelected }));
		}
		if (parameter.optional) {
			choices.unshift(noneChoice(parameter.name, value));
		}
		return Object.freeze({ ...base, kind: 'buttons', choices: Object.freeze(choices) });
	}
	const number = typeof value === 'number' && !autoSelected ? value : undefined;
	if (steps <= SLIDER_STEPS && !parameter.optional) {
		const position = number ?? fallback;
		return Object.freeze({
			...base,
			kind: 'slider',
			min: range.min,
			max: range.max,
			step: parameter.step,
			value: position,
			valueLabel: value !== undefined ? baseHalfVideoParamValueLabel(parameter, value) : baseHalfVideoParamValueLabel(parameter, position),
			...(auto ? { auto } : {}),
			...(parameter.unit ? { unit: parameter.unit } : {})
		});
	}
	return Object.freeze({
		...base,
		kind: 'number',
		min: range.min,
		max: range.max,
		step: parameter.step,
		integer: parameter.kind === 'integer',
		text: number !== undefined ? formatBaseHalfVideoNumber(parameter, number) : '',
		placeholder: parameter.optional
			? localize('basehalf.video.panel.notSet', "Not set")
			: formatBaseHalfVideoNumber(parameter, fallback),
		optional: parameter.optional === true,
		...(auto ? { auto } : {}),
		...(parameter.unit ? { unit: parameter.unit } : {})
	});
}

/** The value a number takes when Auto is turned off: its default, within its range. */
function numberFallback(parameter: IBaseHalfVideoNumberParameter): number {
	const declared = baseHalfVideoParameterDefault(parameter);
	return typeof declared === 'number' && declared >= parameter.min && declared <= parameter.max ? declared : parameter.min;
}

function noneChoice(name: string, value: BaseHalfVideoParamValue | undefined): IBaseHalfVideoPanelChoice<BaseHalfVideoParamValue> {
	return Object.freeze({ key: `${name}:none`, value: undefined, label: localize('basehalf.video.panel.none', "None"), selected: value === undefined });
}

function ratioShape(value: string | number): { readonly shape?: { readonly width: number; readonly height: number } } {
	const shape = baseHalfVideoRatioParts(value);
	return shape ? { shape } : {};
}

// --- Generate --------------------------------------------------------------------------------------

/**
 * The line of a blocker fixed outside the panel, with its action (generation
 * cards, "The panel"; D70). A blocker the panel itself fixes shows only on
 * Generate's tooltip.
 */
function reasonOf(blocker: BaseHalfVideoGenerateBlocker, text: string, provider: string | undefined): { readonly reason?: IBaseHalfVideoPanelReason } {
	switch (blocker.kind) {
		case 'notSetUp':
			return { reason: Object.freeze({ text, action: Object.freeze({ label: localize('basehalf.video.panel.setUp', "Set Up"), provider: blocker.provider.id }) }) };
		case 'region':
		case 'modeRegion':
			return provider
				? { reason: Object.freeze({ text, action: Object.freeze({ label: localize('basehalf.video.panel.providersAction', "Providers…"), provider }) }) }
				: { reason: Object.freeze({ text }) };
		case 'catalogFailed':
			return { reason: Object.freeze({ text }) };
		default:
			return {};
	}
}

function generateButton(
	state: IBaseHalfVideoPanelState,
	blocker: BaseHalfVideoGenerateBlocker | undefined,
	blockerText: string | undefined
): IBaseHalfVideoPanelGenerateButton {
	if (state.generating) {
		const stop = localize('basehalf.video.panel.stop', "Stop Generating");
		return Object.freeze({ kind: 'stop', enabled: true, label: stop, title: stop });
	}
	if (blocker && blockerText) {
		return Object.freeze({ kind: 'generate', enabled: false, label: blockerText, title: blockerText });
	}
	const key = baseHalfVideoPanelGenerateKeyLabel();
	return Object.freeze({
		kind: 'generate',
		enabled: true,
		label: localize('basehalf.video.panel.generate', "Generate"),
		title: localize('basehalf.video.panel.generateWithKey', "Generate ({0})", key)
	});
}
