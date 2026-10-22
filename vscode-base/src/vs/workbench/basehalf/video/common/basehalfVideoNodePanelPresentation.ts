/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { isMacintosh, language } from '../../../../base/common/platform.js';
import { localize } from '../../../../nls.js';
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
	baseHalfVideoListedModels,
	baseHalfVideoModelAbilities,
	baseHalfVideoModeOf,
	baseHalfVideoModeParameters,
	baseHalfVideoNumberSteps,
	baseHalfVideoNumberValues,
	baseHalfVideoParameterDefault,
	baseHalfVideoParamValueLabel,
	baseHalfVideoRegionOffersMode,
	baseHalfVideoRegionOffersModel,
	baseHalfVideoSentParams,
	baseHalfVideoSettingsSummary,
	buildBaseHalfVideoPrompt,
	BaseHalfModelKind,
	findBaseHalfVideoLabelTokens,
	findBaseHalfVideoModel,
	formatBaseHalfVideoNumber,
	getBaseHalfVideoGenerateBlocker,
	IBaseHalfVideoCatalogMode,
	IBaseHalfVideoCatalogProvider,
	IBaseHalfVideoCatalogRegion,
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
import { baseHalfGenerationChoice, IBaseHalfGenerationInfo } from './basehalfGenerationInfo.js';

/**
 * Everything the panel under a selected generation card draws (D63, D64,
 * generation cards, "The panel" and "Settings"), computed from the card's
 * generation information and kind, its resolved inputs, the model catalog,
 * how each provider is set up, the last answer of `check`, and whether it
 * generates. Pure: the panel renders it and the tests check it without a
 * document. What the panel shows is what the generation service sends,
 * because both use the rules of `basehalfVideoCatalog.ts`.
 */

export interface IBaseHalfVideoPanelState {
	/** What the card's next generation uses. */
	readonly info: IBaseHalfGenerationInfo;
	/** What the card makes: its model menu lists the models of this kind. */
	readonly kind: BaseHalfModelKind;
	/** The card has its file: Generate makes a new card beside it. */
	readonly hasFile: boolean;
	/** The card's upstream entries, resolved, in order. */
	readonly inputs: readonly IBaseHalfVideoInputSource[];
	/** The text of the text inputs that were read, by upstream entry, without front matter. */
	readonly texts?: ReadonlyMap<string, string>;
	readonly catalog: BaseHalfVideoCatalogState;
	readonly setup: (provider: IBaseHalfVideoCatalogProvider) => IBaseHalfVideoProviderSetup;
	/** The last answer of `check` for the card's model. */
	readonly check?: IBaseHalfVideoCheckResult;
	/** The card generates, in this window or in another one of this computer. */
	readonly generating: boolean;
	/** The prompt as the panel holds it, which can be newer than the file. */
	readonly prompt: string;
	readonly displayLanguage?: string;
}

export interface IBaseHalfVideoPanelInputItem {
	/** The entry's index in the card's upstream list. */
	readonly index: number;
	readonly path: string;
	readonly kind: BaseHalfVideoInputKind;
	readonly use: BaseHalfVideoInputUse;
	/** The name a prompt uses for it, such as `图片1`. Images, videos, and audio only. */
	readonly label?: string;
	/** What the panel writes beside its thumbnail: its name, or its file name. */
	readonly name: string;
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
	/** What a row without inputs says beside its plus. */
	readonly emptyHint?: string;
}

/** An input that a prompt can name, for the `@` menu. */
export interface IBaseHalfVideoPanelName {
	readonly label: string;
	readonly index: number;
	readonly kind: 'image' | 'video' | 'audio';
	readonly path: string;
	readonly fileName: string;
	readonly used: boolean;
}

/** A name in the prompt. `known` is false for a name that matches no input. */
export interface IBaseHalfVideoPanelPromptMark {
	readonly start: number;
	readonly end: number;
	readonly known: boolean;
}

export interface IBaseHalfVideoPanelModelButton {
	/** The model's name, `Choose Model`, or that the models load. */
	readonly label: string;
	readonly chosen: boolean;
	/** The model or its provider keeps the card from generating. */
	readonly outlined: boolean;
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
}

interface IBaseHalfVideoPanelControlBase {
	readonly name: string;
	readonly label: string;
	readonly tooltip?: string;
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
	readonly names: readonly IBaseHalfVideoPanelName[];
	readonly model: IBaseHalfVideoPanelModelButton;
	readonly modelMenu: IBaseHalfVideoPanelModelMenu;
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
	const displayLanguage = state.displayLanguage ?? language;
	const generation = baseHalfGenerationChoice(state.info);
	const catalog = state.catalog.kind === 'ready' ? state.catalog.catalog : undefined;
	const ref = findBaseHalfVideoModel(catalog, generation?.provider, generation?.model);
	const mode = ref ? baseHalfVideoModeOf(ref.model, generation?.mode) : undefined;
	const region = ref ? state.setup(ref.provider).region : undefined;
	const params = ref && mode ? normalizeBaseHalfVideoParams(ref.model, mode.id, generation?.params) : Object.freeze({ ...generation?.params });
	// Without a model, an image card takes references, as every image model does, and a video card frames.
	const modeInputs = mode?.inputs ?? (state.kind === 'image' ? BASEHALF_IMAGE_DEFAULT_MODE_INPUTS : BASEHALF_VIDEO_DEFAULT_MODE_INPUTS);
	const modeId = mode?.id ?? generation?.mode ?? (state.kind === 'image' ? 'reference' : 'frames');
	const plan = planBaseHalfVideoInputs(modeInputs, state.inputs, displayLanguage);
	const startFrame = plan.some(item => item.use === 'start-frame');
	const checkRequest = ref && mode && region && baseHalfVideoRegionOffersModel(ref.model, region.id)
		? Object.freeze<Omit<IBaseHalfVideoCheckRequest, 'inputs'>>({
			provider: ref.provider.id,
			region: region.id,
			model: ref.model.id,
			mode: mode.id,
			params: baseHalfVideoSentParams(ref.model, mode.id, params, startFrame),
			prompt: buildBaseHalfVideoPrompt(state.prompt, plan.flatMap(item => item.use === 'text' ? [state.texts?.get(item.path) ?? ''] : []))
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
		plan
	});
	const blockerText = blocker ? baseHalfVideoGenerateBlockerText(blocker) : undefined;
	const modelLabel = ref?.model.label ?? localize('basehalf.video.panel.thisModel', "This model");
	const modeLabel = mode?.label ?? localize('basehalf.video.panel.thisMode', "this mode");
	const items = plan.map((item, index) => inputItem(item, index, modeInputs, modelLabel, modeLabel, state.kind));
	const row = inputRow(modeId, modeInputs, items);
	return Object.freeze({
		...(ref ? { ref } : {}),
		...(mode ? { mode } : {}),
		...(region ? { region } : {}),
		params,
		plan,
		...(row ? { inputRow: row } : {}),
		names: Object.freeze(items.flatMap((item): IBaseHalfVideoPanelName[] => item.label && (item.kind === 'image' || item.kind === 'video' || item.kind === 'audio')
			? [Object.freeze({ label: item.label, index: item.index, kind: item.kind, path: item.path, fileName: item.fileName, used: item.used })]
			: [])),
		model: modelButton(state, ref, region, blocker, blockerText),
		modelMenu: modelMenu(state),
		...(ref && mode ? { settingsView: settingsView(ref, mode, params, startFrame, region) } : {}),
		generate: generateButton(state, blocker, blockerText),
		...(blocker ? { blocker, blockerText } : {}),
		...(blocker && blockerText ? reasonOf(blocker, blockerText, ref?.provider.id) : {}),
		...(checkRequest ? { checkRequest } : {})
	});
}

/** The names in a prompt, marked known when an input of that kind and number exists. */
export function baseHalfVideoPanelPromptMarks(prompt: string, plan: readonly IBaseHalfVideoInputPlanItem[]): readonly IBaseHalfVideoPanelPromptMark[] {
	const counts = { image: 0, video: 0, audio: 0 };
	for (const item of plan) {
		if (item.kind === 'image' || item.kind === 'video' || item.kind === 'audio') {
			counts[item.kind]++;
		}
	}
	return Object.freeze(findBaseHalfVideoLabelTokens(prompt).map(token => Object.freeze({
		start: token.start,
		end: token.end,
		known: token.ordinal >= 1 && token.ordinal <= counts[token.kind]
	})));
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

/** The names that match what was typed after `@`, in upstream order. */
export function filterBaseHalfVideoPanelNames(names: readonly IBaseHalfVideoPanelName[], query: string): readonly IBaseHalfVideoPanelName[] {
	const needle = query.trim().toLowerCase();
	if (!needle) {
		return names;
	}
	const compact = needle.replace(/\s+/g, '');
	return names.filter(name => name.label.toLowerCase().replace(/\s+/g, '').includes(compact) || name.fileName.toLowerCase().includes(needle));
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
		...(item.label !== undefined ? { label: item.label } : {}),
		name: item.label ?? fileName,
		fileName,
		used,
		...(reason !== undefined ? { reason } : {}),
		tooltip: `${purpose}\n${item.path}`
	});
}

function usePurpose(item: IBaseHalfVideoInputPlanItem): string {
	const label = item.label ?? '';
	switch (item.use) {
		case 'start-frame': return localize('basehalf.video.panel.use.startFrame', "Start frame · {0}", label);
		case 'end-frame': return localize('basehalf.video.panel.use.endFrame', "End frame · {0}", label);
		case 'reference': return localize('basehalf.video.panel.use.reference', "Reference · {0}", label);
		case 'source': return localize('basehalf.video.panel.use.source', "Clip · {0}", label);
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
				detail: baseHalfVideoModelAbilities(model),
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
				? localize('basehalf.video.panel.noImageModels', "AI Video offers no image models.")
				: localize('basehalf.video.panel.noModels', "AI Video offers no video models.")
		} : {}),
		groups: Object.freeze(groups),
		settingsLabel
	});
}

// --- the settings ----------------------------------------------------------------------------------

/** Up to this many choices are a row of buttons; more are a list. */
const BUTTON_CHOICES = 5;
/** Up to this many steps of a number are a slider; more are a number field. */
const SLIDER_STEPS = 1000;

function settingsView(ref: IBaseHalfVideoModelRef, mode: IBaseHalfVideoCatalogMode, params: BaseHalfVideoParams, startFrame: boolean, region: IBaseHalfVideoCatalogRegion | undefined): IBaseHalfVideoPanelSettingsView {
	const parts = baseHalfVideoSettingsSummary(ref.model, mode.id, params, startFrame);
	const parameters = baseHalfVideoModeParameters(ref.model, mode.id);
	const shown = (parameter: BaseHalfVideoCatalogParameter) => startFrame && parameter.setByStartFrame
		? Object.freeze({ name: parameter.name, label: parameter.label, ...(parameter.tooltip ? { tooltip: parameter.tooltip } : {}), kind: 'fixed' as const, text: localize('basehalf.video.panel.setByStartFrame', "Set by the start frame") })
		: control(parameter, params[parameter.name]);
	return Object.freeze({
		summary: parts.join(' · '),
		summaryParts: parts,
		...(ref.model.modes.length > 1 ? {
			modes: Object.freeze(ref.model.modes.map(candidate => {
				const unavailable = region && !baseHalfVideoRegionOffersMode(candidate, region.id)
					? localize('basehalf.video.panel.modeNotInRegion', "Not offered in {0}", region.label)
					: undefined;
				return Object.freeze({ key: `mode:${candidate.id}`, value: candidate.id, label: candidate.label, selected: candidate.id === mode.id, ...(unavailable ? { unavailable } : {}) });
			}))
		} : {}),
		controls: Object.freeze(parameters.filter(parameter => !parameter.advanced).map(shown)),
		advanced: Object.freeze(parameters.filter(parameter => parameter.advanced).map(shown))
	});
}

function control(parameter: BaseHalfVideoCatalogParameter, value: BaseHalfVideoParamValue | undefined): BaseHalfVideoPanelControl {
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
			return numberControl(parameter, value, base);
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

function numberControl(parameter: IBaseHalfVideoNumberParameter, value: BaseHalfVideoParamValue | undefined, base: { readonly name: string; readonly label: string; readonly tooltip?: string }): BaseHalfVideoPanelControl {
	const steps = baseHalfVideoNumberSteps(parameter);
	const fallback = numberFallback(parameter);
	const autoSelected = parameter.auto !== undefined && value === parameter.auto.value;
	const auto = parameter.auto ? Object.freeze({ selected: autoSelected, label: parameter.auto.label, value: parameter.auto.value, fallback }) : undefined;
	if (steps <= BUTTON_CHOICES) {
		const choices: IBaseHalfVideoPanelChoice<BaseHalfVideoParamValue>[] = baseHalfVideoNumberValues(parameter).map(number => Object.freeze({
			key: `${parameter.name}:${number}`,
			value: number,
			label: baseHalfVideoParamValueLabel(parameter, number),
			selected: number === value
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
			min: parameter.min,
			max: parameter.max,
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
		min: parameter.min,
		max: parameter.max,
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
	const match = typeof value === 'string' ? /^(?<width>\d+(?:\.\d+)?):(?<height>\d+(?:\.\d+)?)$/.exec(value) : null;
	const width = Number(match?.groups?.width);
	const height = Number(match?.groups?.height);
	if (!match || !(width > 0) || !(height > 0)) {
		return {};
	}
	return { shape: Object.freeze({ width, height }) };
}

// --- Generate --------------------------------------------------------------------------------------

/** The line of a blocker the panel does not show elsewhere, with its action (generation cards, "The panel"). */
function reasonOf(blocker: BaseHalfVideoGenerateBlocker, text: string, provider: string | undefined): { readonly reason?: IBaseHalfVideoPanelReason } {
	switch (blocker.kind) {
		case 'generating':
		case 'catalogLoading':
		case 'noModel':
		case 'nothingToSend':
			return {};
		case 'notSetUp':
			return { reason: Object.freeze({ text, action: Object.freeze({ label: localize('basehalf.video.panel.setUp', "Set Up"), provider: blocker.provider.id }) }) };
		case 'region':
		case 'modeRegion':
			return provider
				? { reason: Object.freeze({ text, action: Object.freeze({ label: localize('basehalf.video.panel.providersAction', "Providers…"), provider }) }) }
				: { reason: Object.freeze({ text }) };
		default:
			return { reason: Object.freeze({ text }) };
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
		title: state.hasFile
			? state.kind === 'image'
				? localize('basehalf.video.panel.generateNewImage', "Generate a new image in a new card beside this one ({0})", key)
				: localize('basehalf.video.panel.generateNewVideo', "Generate a new video in a new card beside this one ({0})", key)
			: localize('basehalf.video.panel.generateWithKey', "Generate ({0})", key)
	});
}
