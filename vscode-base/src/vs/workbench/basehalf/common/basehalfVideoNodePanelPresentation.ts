/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { isMacintosh, language } from '../../../base/common/platform.js';
import { localize } from '../../../nls.js';
import { baseHalfItemDisplayName } from './basehalfCardDetail.js';
import { IBaseHalfVideoChannel, IBaseHalfVideoModelChoice } from './basehalfVideoGeneration.js';
import {
	BASEHALF_VIDEO_AUTO_DURATION,
	BaseHalfVideoMode,
	BaseHalfVideoProviderKind,
	IBaseHalfVideoGenerationSettings,
	IBaseHalfVideoNodeFields,
	IBaseHalfVideoSettings
} from './basehalfVideoNode.js';
import {
	BaseHalfVideoGenerateBlocker,
	BaseHalfVideoInputKind,
	BaseHalfVideoInputUse,
	baseHalfVideoDurationValues,
	baseHalfVideoEffectiveRatio,
	baseHalfVideoModelLabel,
	findBaseHalfVideoLabelTokens,
	getBaseHalfVideoGenerateBlocker,
	getBaseHalfVideoModelProfile,
	getBaseHalfVideoProviderPreset,
	IBaseHalfVideoInputPlanItem,
	IBaseHalfVideoInputSource,
	IBaseHalfVideoModelProfile,
	normalizeBaseHalfVideoSettings,
	planBaseHalfVideoInputs
} from './basehalfVideoProviders.js';

/**
 * Everything the panel under a selected Video node draws (D58, video node
 * specification, "The panel"), computed from the node, its resolved inputs,
 * the channels on this computer, and whether it generates. Pure: the panel
 * renders it and the tests check it without a document. What the panel shows
 * is what the generation service sends, because both use the rules of
 * `basehalfVideoProviders.ts`.
 */

export interface IBaseHalfVideoPanelState {
	readonly fields: IBaseHalfVideoNodeFields;
	/** The node's upstream entries, resolved, in order. */
	readonly inputs: readonly IBaseHalfVideoInputSource[];
	readonly channels: readonly IBaseHalfVideoChannel[];
	/** The channel that runs the node's model, as `IBaseHalfVideoChannelService.resolve` finds it. */
	readonly choice: IBaseHalfVideoModelChoice | undefined;
	/** The node generates, in this window or in another one that its file names. */
	readonly generating: boolean;
	/** The prompt as the panel holds it, which can be newer than the file. */
	readonly prompt: string;
	readonly displayLanguage?: string;
}

export interface IBaseHalfVideoPanelInputItem {
	/** The entry's index in the node's upstream list. */
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
	readonly mode: BaseHalfVideoMode;
	/** Frames mode: as many slots as the model takes frames. */
	readonly slots: readonly IBaseHalfVideoPanelFrameSlot[];
	/** The upstream list with the two frames' entries exchanged, when both slots are filled. */
	readonly swappedUpstream?: readonly string[];
	/** The inputs the row shows besides the slots, in upstream order. */
	readonly items: readonly IBaseHalfVideoPanelInputItem[];
	/** What an empty references row says beside its plus. */
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
	/** The model's name, or `Choose Model`. */
	readonly label: string;
	readonly chosen: boolean;
	/** The model, its channel, or its key keeps the node from generating. */
	readonly outlined: boolean;
	readonly title: string;
}

export interface IBaseHalfVideoPanelModelMenuItem {
	readonly channel: string;
	readonly model: string;
	readonly label: string;
	readonly checked: boolean;
	readonly title: string;
}

export interface IBaseHalfVideoPanelModelMenuGroup {
	readonly channel: string;
	readonly label: string;
	/** The provider, and whether the channel has no key. */
	readonly detail?: string;
	readonly items: readonly IBaseHalfVideoPanelModelMenuItem[];
	/** Shown in place of items when the channel lists no model. */
	readonly empty?: string;
}

export interface IBaseHalfVideoPanelModelMenu {
	readonly groups: readonly IBaseHalfVideoPanelModelMenuGroup[];
	/** `Manage Video Providers…`, or `Add a Video Provider…` with no channel. */
	readonly settingsLabel: string;
}

export interface IBaseHalfVideoPanelChoice<T> {
	readonly value: T;
	readonly label: string;
	readonly selected: boolean;
	readonly disabled?: boolean;
	readonly title?: string;
}

export interface IBaseHalfVideoPanelRatioChoice extends IBaseHalfVideoPanelChoice<string> {
	/** The ratio's proportions, or none for `adaptive`. */
	readonly shape?: { readonly width: number; readonly height: number };
}

export type BaseHalfVideoPanelDurationView =
	| { readonly kind: 'choices'; readonly choices: readonly IBaseHalfVideoPanelChoice<number>[] }
	| {
		readonly kind: 'range';
		readonly min: number;
		readonly max: number;
		/** The slider's value; the model's default while Auto is chosen. */
		readonly value: number;
		readonly valueLabel: string;
		/** Present when the model can choose its own length. */
		readonly auto?: { readonly selected: boolean; readonly label: string };
	};

export interface IBaseHalfVideoPanelSettingsView {
	/** Such as `Frames · 16:9 · 720p · 5s · Sound`. */
	readonly summary: string;
	readonly summaryParts: readonly string[];
	/** Absent when the model offers one mode. */
	readonly modes?: readonly IBaseHalfVideoPanelChoice<BaseHalfVideoMode>[];
	/** Absent when the model has one ratio or none. */
	readonly ratios?: {
		readonly choices: readonly IBaseHalfVideoPanelRatioChoice[];
		/** The ratio follows the start frame and cannot be chosen. */
		readonly followsStartFrame: boolean;
		readonly note?: string;
	};
	/** Absent when the model has one resolution. */
	readonly resolutions?: readonly IBaseHalfVideoPanelChoice<string>[];
	readonly duration: BaseHalfVideoPanelDurationView;
	/** Absent when the model has no switch for sound. */
	readonly sound?: { readonly on: boolean };
}

export interface IBaseHalfVideoPanelGenerateButton {
	/** While the node generates, the button is a stop square. */
	readonly kind: 'generate' | 'stop';
	readonly enabled: boolean;
	/** The accessible name: what the button does, or why it cannot. */
	readonly label: string;
	readonly title: string;
}

export interface IBaseHalfVideoPanelPresentation {
	readonly profile: IBaseHalfVideoModelProfile;
	/** The settings shown and sent: the node's, made legal for the model. */
	readonly settings: IBaseHalfVideoSettings;
	/** The ratio sent. */
	readonly ratio: string;
	readonly plan: readonly IBaseHalfVideoInputPlanItem[];
	/** Absent when the mode and the node have no inputs to show. */
	readonly inputRow?: IBaseHalfVideoPanelInputRow;
	readonly names: readonly IBaseHalfVideoPanelName[];
	readonly model: IBaseHalfVideoPanelModelButton;
	readonly modelMenu: IBaseHalfVideoPanelModelMenu;
	readonly settingsView: IBaseHalfVideoPanelSettingsView;
	readonly generate: IBaseHalfVideoPanelGenerateButton;
	readonly blocker?: BaseHalfVideoGenerateBlocker;
	readonly blockerText?: string;
}

/** The provider BaseHalf assumes when no channel tells: every kind of local input can be sent. */
const UNRESOLVED_PROVIDER: BaseHalfVideoProviderKind = 'openai';

/** The profile the panel uses: the model's on the channel that runs it, or a general one. */
export function baseHalfVideoPanelProfile(state: Pick<IBaseHalfVideoPanelState, 'fields' | 'choice' | 'channels'>): IBaseHalfVideoModelProfile {
	const model = state.fields.generation?.model;
	if (!model) {
		return getBaseHalfVideoModelProfile(UNRESOLVED_PROVIDER, '');
	}
	const provider = state.choice?.channel.provider
		?? state.channels.find(channel => channel.id === state.fields.generation?.channel)?.provider
		?? UNRESOLVED_PROVIDER;
	return getBaseHalfVideoModelProfile(provider, model);
}

/**
 * The generation settings after the user chose `model` of `channel`: every
 * setting the model accepts is kept, the others take its default.
 */
export function baseHalfVideoPanelChooseModel(
	generation: IBaseHalfVideoGenerationSettings | undefined,
	channel: Pick<IBaseHalfVideoChannel, 'id' | 'provider'>,
	model: string
): IBaseHalfVideoGenerationSettings {
	const settings = normalizeBaseHalfVideoSettings(generation, getBaseHalfVideoModelProfile(channel.provider, model));
	return Object.freeze({ ...settings, channel: channel.id, model });
}

/** The generation settings after one setting changed, made legal for the model. */
export function baseHalfVideoPanelChangeSettings(
	generation: IBaseHalfVideoGenerationSettings | undefined,
	change: Partial<IBaseHalfVideoSettings>,
	modelProfile: IBaseHalfVideoModelProfile
): IBaseHalfVideoGenerationSettings {
	const settings = normalizeBaseHalfVideoSettings({ ...normalizeBaseHalfVideoSettings(generation, modelProfile), ...change }, modelProfile);
	return Object.freeze({
		...settings,
		...(generation?.channel !== undefined ? { channel: generation.channel } : {}),
		...(generation?.model !== undefined ? { model: generation.model } : {})
	});
}

export function createBaseHalfVideoPanelPresentation(state: IBaseHalfVideoPanelState): IBaseHalfVideoPanelPresentation {
	const displayLanguage = state.displayLanguage ?? language;
	const profile = baseHalfVideoPanelProfile(state);
	const settings = normalizeBaseHalfVideoSettings(state.fields.generation, profile);
	const plan = planBaseHalfVideoInputs(settings.mode, state.inputs, profile, displayLanguage);
	const hasStartFrame = plan.some(item => item.use === 'start-frame');
	const ratio = baseHalfVideoEffectiveRatio(settings, profile, hasStartFrame);
	const model = state.fields.generation?.model;
	const modelLabel = model ? baseHalfVideoModelLabel(model) : undefined;
	const blocker = getBaseHalfVideoGenerateBlocker({
		generating: state.generating,
		model,
		channelFound: state.choice !== undefined,
		channelHasEndpoint: state.choice ? state.choice.channel.baseUrl.trim().length > 0 : undefined,
		channelHasKey: state.choice?.channel.hasKey ?? false,
		prompt: state.prompt,
		plan
	});
	const blockerText = blocker ? baseHalfVideoPanelBlockerText(blocker, modelLabel ?? '', state.choice?.channel.name ?? '') : undefined;
	const items = plan.map((item, index) => inputItem(item, index, settings.mode, profile, modelLabel));
	return Object.freeze({
		profile,
		settings,
		ratio,
		plan,
		inputRow: inputRow(settings.mode, profile, items),
		names: Object.freeze(items.flatMap((item): IBaseHalfVideoPanelName[] => item.label && (item.kind === 'image' || item.kind === 'video' || item.kind === 'audio')
			? [Object.freeze({ label: item.label, index: item.index, kind: item.kind, path: item.path, fileName: item.fileName, used: item.used })]
			: [])),
		model: modelButton(state, modelLabel, blocker, blockerText),
		modelMenu: modelMenu(state),
		settingsView: settingsView(settings, profile, ratio, settings.mode === 'frames' && hasStartFrame && profile.framesRatio !== undefined),
		generate: generateButton(state, blocker, blockerText),
		...(blocker ? { blocker, blockerText } : {})
	});
}

/** The reason a node cannot generate, as the Generate button and the model button say it. */
export function baseHalfVideoPanelBlockerText(blocker: BaseHalfVideoGenerateBlocker, modelLabel: string, channelName: string): string {
	switch (blocker) {
		case 'generating': return localize('basehalf.video.panel.blocker.generating', "This node is generating.");
		case 'noModel': return localize('basehalf.video.panel.blocker.noModel', "Choose a model to generate.");
		case 'noChannel': return localize('basehalf.video.panel.blocker.noChannel', "No video provider on this computer offers {0}.", modelLabel);
		case 'noEndpoint': return localize('basehalf.video.panel.blocker.noEndpoint', "{0} has no endpoint. Enter it in Video Providers.", channelName);
		case 'noKey': return localize('basehalf.video.panel.blocker.noKey', "{0} has no API key. Add one in Video Providers.", channelName);
		case 'nothingToSend': return localize('basehalf.video.panel.blocker.nothingToSend', "Write a prompt or connect an input to generate.");
	}
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

/** The name an input is shown by: a note without its extension, a node without `.bhnode`, any other file by its file name. */
export function baseHalfVideoPanelInputFileName(path: string): string {
	const name = path.slice(path.lastIndexOf('/') + 1);
	if (name.toLowerCase().endsWith('.bhnode') && name.length > '.bhnode'.length) {
		return name.slice(0, -'.bhnode'.length);
	}
	return baseHalfItemDisplayName(name, false);
}

export function baseHalfVideoPanelModeLabel(mode: BaseHalfVideoMode): string {
	return mode === 'frames'
		? localize('basehalf.video.panel.mode.frames', "Frames")
		: localize('basehalf.video.panel.mode.reference', "References");
}

export function baseHalfVideoPanelRatioLabel(ratio: string): string {
	return ratio === 'adaptive' ? localize('basehalf.video.panel.ratio.adaptive', "Adaptive") : ratio;
}

export function baseHalfVideoPanelDurationLabel(duration: number): string {
	return duration === BASEHALF_VIDEO_AUTO_DURATION
		? localize('basehalf.video.panel.duration.auto', "Auto")
		: localize('basehalf.video.panel.duration.seconds', "{0}s", duration);
}

export function baseHalfVideoPanelSoundLabel(on: boolean): string {
	return on
		? localize('basehalf.video.panel.sound.on', "Sound")
		: localize('basehalf.video.panel.sound.off', "No sound");
}

/** `⌘Enter` on macOS and `Ctrl+Enter` elsewhere. */
export function baseHalfVideoPanelGenerateKeyLabel(): string {
	return isMacintosh ? '⌘Enter' : 'Ctrl+Enter';
}

function inputItem(item: IBaseHalfVideoInputPlanItem, index: number, mode: BaseHalfVideoMode, profile: IBaseHalfVideoModelProfile, modelLabel: string | undefined): IBaseHalfVideoPanelInputItem {
	const fileName = baseHalfVideoPanelInputFileName(item.path);
	const used = item.use !== 'unused';
	const reason = used ? undefined : unusedReason(item, mode, profile, modelLabel ?? localize('basehalf.video.panel.thisModel', "this model"));
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
		default: return localize('basehalf.video.panel.use.text', "Its text is added to the prompt.");
	}
}

function unusedReason(item: IBaseHalfVideoInputPlanItem, mode: BaseHalfVideoMode, profile: IBaseHalfVideoModelProfile, modelLabel: string): string {
	switch (item.reason) {
		case 'missing':
			return localize('basehalf.video.panel.unused.missing', "Not used: the file is missing, or the node shows no file yet.");
		case 'kind':
			return localize('basehalf.video.panel.unused.kind', "Not used: this kind of file cannot be sent to a video model.");
		case 'mode':
			if (mode === 'frames') {
				return item.kind === 'image'
					? localize('basehalf.video.panel.unused.textOnly', "Not used: {0} makes video from text only.", modelLabel)
					: localize('basehalf.video.panel.unused.framesImagesOnly', "Not used: Frames mode uses images only.");
			}
			return item.kind === 'image'
				? localize('basehalf.video.panel.unused.noImageReferences', "Not used: {0} takes no image references from this computer.", modelLabel)
				: item.kind === 'video'
					? localize('basehalf.video.panel.unused.noVideoReferences', "Not used: {0} takes no video references from this computer.", modelLabel)
					: localize('basehalf.video.panel.unused.noAudioReferences', "Not used: {0} takes no audio references from this computer.", modelLabel);
		default:
			if (mode === 'frames') {
				return profile.frames === 1
					? localize('basehalf.video.panel.unused.startFrameOnly', "Not used: {0} takes a start frame only.", modelLabel)
					: localize('basehalf.video.panel.unused.twoFrames', "Not used: Frames mode takes the first two images.");
			}
			return item.kind === 'image'
				? localize('basehalf.video.panel.unused.tooManyImages', "Not used: {0} takes up to {1} images.", modelLabel, profile.references.images)
				: item.kind === 'video'
					? localize('basehalf.video.panel.unused.tooManyVideos', "Not used: {0} takes up to {1} videos.", modelLabel, profile.references.videos)
					: localize('basehalf.video.panel.unused.tooManyAudios', "Not used: {0} takes up to {1} audio files.", modelLabel, profile.references.audios);
	}
}

function inputRow(mode: BaseHalfVideoMode, profile: IBaseHalfVideoModelProfile, items: readonly IBaseHalfVideoPanelInputItem[]): IBaseHalfVideoPanelInputRow | undefined {
	if (mode === 'reference') {
		return Object.freeze({
			mode,
			slots: Object.freeze([]),
			items: Object.freeze([...items]),
			...(items.length === 0 ? { emptyHint: localize('basehalf.video.panel.referencesEmpty', "Add images, videos, or audio as references") } : {})
		});
	}
	const start = items.find(item => item.use === 'start-frame');
	const end = items.find(item => item.use === 'end-frame');
	const slots: IBaseHalfVideoPanelFrameSlot[] = [];
	if (profile.frames >= 1) {
		slots.push(Object.freeze({
			role: 'start',
			title: localize('basehalf.video.panel.slot.start', "Start"),
			addLabel: localize('basehalf.video.panel.slot.addStart', "Add a Start Frame"),
			...(start ? { item: start } : {})
		}));
	}
	if (profile.frames >= 2) {
		slots.push(Object.freeze({
			role: 'end',
			title: localize('basehalf.video.panel.slot.end', "End"),
			addLabel: localize('basehalf.video.panel.slot.addEnd', "Add an End Frame"),
			...(end ? { item: end } : {})
		}));
	}
	const rest = items.filter(item => item !== start && item !== end);
	if (slots.length === 0 && rest.length === 0) {
		return undefined;
	}
	const upstream = items.map(item => item.path);
	return Object.freeze({
		mode,
		slots: Object.freeze(slots),
		...(start && end ? { swappedUpstream: swapBaseHalfVideoUpstreamEntries(upstream, start.index, end.index) } : {}),
		items: Object.freeze(rest)
	});
}

function modelButton(
	state: IBaseHalfVideoPanelState,
	modelLabel: string | undefined,
	blocker: BaseHalfVideoGenerateBlocker | undefined,
	blockerText: string | undefined
): IBaseHalfVideoPanelModelButton {
	const outlined = blocker === 'noModel' || blocker === 'noChannel' || blocker === 'noKey';
	const label = modelLabel ?? localize('basehalf.video.panel.chooseModel', "Choose Model");
	const title = outlined && blockerText
		? blockerText
		: state.choice && modelLabel
			? localize('basehalf.video.panel.modelOn', "{0} on {1}", modelLabel, state.choice.channel.name)
			: label;
	return Object.freeze({ label, chosen: modelLabel !== undefined, outlined, title });
}

function modelMenu(state: IBaseHalfVideoPanelState): IBaseHalfVideoPanelModelMenu {
	const groups = state.channels.map((channel): IBaseHalfVideoPanelModelMenuGroup => {
		const provider = getBaseHalfVideoProviderPreset(channel.provider).label;
		const name = channel.name.trim() || provider;
		const detailParts = [
			...(name !== provider ? [provider] : []),
			...(!channel.hasKey ? [localize('basehalf.video.panel.channelNoKey', "No API key")] : [])
		];
		const items = channel.models.map(model => Object.freeze({
			channel: channel.id,
			model,
			label: baseHalfVideoModelLabel(model),
			checked: state.choice?.channel.id === channel.id && state.choice.model === model,
			title: model
		}));
		return Object.freeze({
			channel: channel.id,
			label: name,
			...(detailParts.length ? { detail: detailParts.join(' · ') } : {}),
			items: Object.freeze(items),
			...(items.length === 0 ? { empty: localize('basehalf.video.panel.channelNoModels', "No models. Add one in Video Providers.") } : {})
		});
	});
	return Object.freeze({
		groups: Object.freeze(groups),
		settingsLabel: state.channels.length === 0
			? localize('basehalf.video.panel.addProvider', "Add a Video Provider…")
			: localize('basehalf.video.panel.manageProviders', "Manage Video Providers…")
	});
}

function settingsView(settings: IBaseHalfVideoSettings, profile: IBaseHalfVideoModelProfile, ratio: string, followsStartFrame: boolean): IBaseHalfVideoPanelSettingsView {
	const parts = [baseHalfVideoPanelModeLabel(settings.mode)];
	const showsRatio = profile.ratios.length > 1;
	if (showsRatio) {
		parts.push(baseHalfVideoPanelRatioLabel(ratio));
	}
	parts.push(settings.resolution, baseHalfVideoPanelDurationLabel(settings.duration));
	if (profile.audio) {
		parts.push(baseHalfVideoPanelSoundLabel(settings.audio));
	}
	const limit = profile.maxDurationByResolution?.[settings.resolution];
	return Object.freeze({
		summary: parts.join(' · '),
		summaryParts: Object.freeze(parts),
		...(profile.modes.length > 1 ? {
			modes: Object.freeze(profile.modes.map(mode => Object.freeze({ value: mode, label: baseHalfVideoPanelModeLabel(mode), selected: mode === settings.mode })))
		} : {}),
		...(showsRatio ? {
			ratios: Object.freeze({
				choices: Object.freeze(profile.ratios.map(value => Object.freeze({
					value,
					label: baseHalfVideoPanelRatioLabel(value),
					selected: value === ratio,
					...(followsStartFrame ? { disabled: true } : {}),
					...ratioShape(value)
				}))),
				followsStartFrame,
				...(followsStartFrame ? { note: localize('basehalf.video.panel.ratioFollowsStartFrame', "Follows the start frame") } : {})
			})
		} : {}),
		...(profile.resolutions.length > 1 ? {
			resolutions: Object.freeze(profile.resolutions.map(value => Object.freeze({ value, label: value, selected: value === settings.resolution })))
		} : {}),
		duration: durationView(settings, profile, limit),
		...(profile.audio ? { sound: Object.freeze({ on: settings.audio }) } : {})
	});
}

function durationView(settings: IBaseHalfVideoSettings, profile: IBaseHalfVideoModelProfile, limit: number | undefined): BaseHalfVideoPanelDurationView {
	const auto = settings.duration === BASEHALF_VIDEO_AUTO_DURATION;
	if (profile.durations.kind === 'values') {
		const choices: IBaseHalfVideoPanelChoice<number>[] = baseHalfVideoDurationValues(profile.durations).map(value => {
			const disabled = limit !== undefined && value > limit;
			return Object.freeze({
				value,
				label: baseHalfVideoPanelDurationLabel(value),
				selected: value === settings.duration,
				...(disabled ? { disabled, title: localize('basehalf.video.panel.durationLimit', "Up to {0}s at {1}", limit, settings.resolution) } : {})
			});
		});
		if (profile.autoDuration) {
			choices.push(Object.freeze({ value: BASEHALF_VIDEO_AUTO_DURATION, label: baseHalfVideoPanelDurationLabel(BASEHALF_VIDEO_AUTO_DURATION), selected: auto }));
		}
		return Object.freeze({ kind: 'choices', choices: Object.freeze(choices) });
	}
	const max = limit !== undefined ? Math.min(profile.durations.max, limit) : profile.durations.max;
	const value = auto ? Math.min(max, Math.max(profile.durations.min, profile.defaults.duration)) : settings.duration;
	return Object.freeze({
		kind: 'range',
		min: profile.durations.min,
		max,
		value,
		valueLabel: baseHalfVideoPanelDurationLabel(settings.duration),
		...(profile.autoDuration ? { auto: Object.freeze({ selected: auto, label: baseHalfVideoPanelDurationLabel(BASEHALF_VIDEO_AUTO_DURATION) }) } : {})
	});
}

function ratioShape(ratio: string): { readonly shape?: { readonly width: number; readonly height: number } } {
	const match = /^(?<width>\d+(?:\.\d+)?):(?<height>\d+(?:\.\d+)?)$/.exec(ratio);
	const width = Number(match?.groups?.width);
	const height = Number(match?.groups?.height);
	if (!match || !(width > 0) || !(height > 0)) {
		return {};
	}
	return { shape: Object.freeze({ width, height }) };
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
		title: state.fields.result
			? localize('basehalf.video.panel.generateInNewNode', "Generate a new video in a new node beside this one ({0})", key)
			: localize('basehalf.video.panel.generateWithKey', "Generate ({0})", key)
	});
}
