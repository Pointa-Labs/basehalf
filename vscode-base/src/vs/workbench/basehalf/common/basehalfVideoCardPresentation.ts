/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../nls.js';
import type { BaseHalfCanvasSceneVideoAction } from './basehalfCanvasScene.js';
import type { BaseHalfVideoGenerationPhase, IBaseHalfVideoGenerationProgress } from './basehalfVideoGeneration.js';
import { baseHalfVideoNodePhase, IBaseHalfVideoNodeFields, isBaseHalfVideoTaskActive } from './basehalfVideoNode.js';

/**
 * What a Video card shows in each phase of its node (D58, video node
 * specification, "The card"). Pure: the card renders it, and the tests check
 * the words and states without a document.
 */

/**
 * The node's phase, with `missing` for a video whose file is gone and
 * `unplayable` for a video file that this computer cannot play.
 */
export type BaseHalfVideoCardState = 'empty' | 'generating' | 'failed' | 'stopped' | 'video' | 'missing' | 'unplayable';

export interface IBaseHalfVideoCardInput {
	readonly title: string;
	readonly fields: IBaseHalfVideoNodeFields;
	/** The progress of a generation this window follows. */
	readonly progress?: IBaseHalfVideoGenerationProgress;
	/** Whether the node's video file exists. Unknown counts as there. */
	readonly videoExists?: boolean;
	/** False once the card's player failed to load the video. */
	readonly videoPlayable?: boolean;
	/** Milliseconds since the epoch. */
	readonly now: number;
}

export interface IBaseHalfVideoCardPresentation {
	readonly state: BaseHalfVideoCardState;
	/** Generating: Waiting, Generating, or Downloading. */
	readonly phaseText?: string;
	/** Generating: the time since it started, such as `1:05`. */
	readonly elapsedText?: string;
	/** Generating: when the generation started, in milliseconds since the epoch. */
	readonly startedAt?: number;
	/** Generating: 0 to 1 when the provider reports progress; absent while unknown. */
	readonly fraction?: number;
	/** Failed: the error. Stopped: `Stopped`. Missing: that the file is missing. */
	readonly message?: string;
	/** The full text behind the card: the whole error, or the missing file's path. */
	readonly tooltip?: string;
	/** Video and missing: the workspace-relative path of the video. */
	readonly videoPath?: string;
	readonly ariaLabel: string;
}

export function baseHalfVideoCardPresentation(input: IBaseHalfVideoCardInput): IBaseHalfVideoCardPresentation {
	const phase = baseHalfVideoNodePhase(input.fields);
	const title = input.title;
	switch (phase) {
		case 'video': {
			const path = input.fields.result?.artifact.path ?? '';
			if (input.videoExists === false) {
				const message = localize('basehalf.video.card.missing', "The video file is missing");
				return Object.freeze({
					state: 'missing',
					message,
					tooltip: path,
					videoPath: path,
					ariaLabel: localize('basehalf.video.card.aria.missing', "{0}, Video, the video file is missing: {1}", title, path)
				});
			}
			if (input.videoPlayable === false) {
				const message = localize('basehalf.video.card.unplayable', "This video cannot be played here");
				return Object.freeze({
					state: 'unplayable',
					message,
					tooltip: path,
					videoPath: path,
					ariaLabel: localize('basehalf.video.card.aria.unplayable', "{0}, Video, the video cannot be played: {1}", title, path)
				});
			}
			return Object.freeze({
				state: 'video',
				videoPath: path,
				ariaLabel: localize('basehalf.video.card.aria.video', "{0}, Video", title)
			});
		}
		case 'generating': {
			const task = input.fields.task;
			const startedAt = input.progress?.startedAt ?? (task ? Date.parse(task.startedAt) : Number.NaN);
			const phaseText = baseHalfVideoCardPhaseText(input.progress?.phase ?? (task?.state === 'running' ? 'generating' : 'submitting'));
			const elapsedText = Number.isFinite(startedAt) ? formatBaseHalfVideoElapsed(input.now - startedAt) : undefined;
			const fraction = input.progress?.fraction;
			const exact = fraction !== undefined && Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : undefined;
			return Object.freeze({
				state: 'generating',
				phaseText,
				...(elapsedText !== undefined ? { elapsedText } : {}),
				...(Number.isFinite(startedAt) ? { startedAt } : {}),
				...(exact !== undefined ? { fraction: exact } : {}),
				ariaLabel: exact !== undefined
					? localize('basehalf.video.card.aria.generatingPercent', "{0}, Video, {1}, {2} percent", title, phaseText, Math.round(exact * 100))
					: localize('basehalf.video.card.aria.generating', "{0}, Video, {1}", title, phaseText)
			});
		}
		case 'failed': {
			const message = input.fields.task?.error ?? localize('basehalf.video.card.failedUnknown', "The generation failed.");
			return Object.freeze({
				state: 'failed',
				message,
				tooltip: message,
				ariaLabel: localize('basehalf.video.card.aria.failed', "{0}, Video, failed: {1}", title, message)
			});
		}
		case 'stopped': {
			const message = localize('basehalf.video.card.stopped', "Stopped");
			return Object.freeze({
				state: 'stopped',
				message,
				ariaLabel: localize('basehalf.video.card.aria.stopped', "{0}, Video, stopped", title)
			});
		}
		default:
			return Object.freeze({
				state: 'empty',
				ariaLabel: localize('basehalf.video.card.aria.empty', "{0}, Video", title)
			});
	}
}

/** The phase in words: the provider has not started (Waiting), makes the video (Generating), or BaseHalf writes it (Downloading). */
export function baseHalfVideoCardPhaseText(phase: BaseHalfVideoGenerationPhase): string {
	switch (phase) {
		case 'generating': return localize('basehalf.video.card.phase.generating', "Generating");
		case 'downloading': return localize('basehalf.video.card.phase.downloading', "Downloading");
		default: return localize('basehalf.video.card.phase.waiting', "Waiting");
	}
}

/** `0:42`, `12:05`, or `1:02:09`. */
export function formatBaseHalfVideoElapsed(milliseconds: number): string {
	const total = Math.max(0, Math.floor((Number.isFinite(milliseconds) ? milliseconds : 0) / 1000));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = total % 60;
	const pad = (value: number) => String(value).padStart(2, '0');
	return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/**
 * The actions of the toolbar above a selected Video card: Upload Video while
 * the node is empty and does not generate; Capture Frame, Reveal, and Open for
 * a node whose video file is there; none otherwise.
 */
export function baseHalfVideoCardToolbarActions(
	fields: IBaseHalfVideoNodeFields,
	options: { readonly generating: boolean; readonly videoExists?: boolean }
): readonly BaseHalfCanvasSceneVideoAction[] {
	const phase = baseHalfVideoNodePhase(fields);
	if (phase === 'video') {
		return options.videoExists === false ? Object.freeze([]) : Object.freeze<BaseHalfCanvasSceneVideoAction[]>(['captureFrame', 'revealVideo', 'openFullPreview']);
	}
	if (phase === 'empty' && !options.generating && !isBaseHalfVideoTaskActive(fields.task)) {
		return Object.freeze<BaseHalfCanvasSceneVideoAction[]>(['importResult']);
	}
	return Object.freeze([]);
}
