/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import type { BaseHalfCanvasSceneVideoAction } from '../../canvas/common/basehalfCanvasScene.js';
import { BaseHalfGenerationKind, IBaseHalfGenerationTask, IBaseHalfGenerationTaskCard, isBaseHalfGenerationTaskEnded } from './basehalfGenerationInfo.js';
import type { BaseHalfVideoGenerationPhase, IBaseHalfVideoGenerationProgress } from './basehalfVideoGeneration.js';

/**
 * What a generation card shows in each phase (D63, generation cards, "The
 * card"), from what its card information holds and the task record of this
 * computer that names it. Pure: the card renders it, and the tests check the
 * words and states without a document.
 */

/**
 * The phase of a generation card: a `draft` has no file and does not
 * generate; `generating`, `failed`, and `stopped` come from the task record of
 * this computer; a card with its `file` shows it.
 */
export type BaseHalfGenerationPhase = 'draft' | 'generating' | 'failed' | 'stopped' | 'file';

/** What the card shows: its phase, and `unshowable` for a file this computer cannot show. */
export type BaseHalfGenerationCardState = BaseHalfGenerationPhase | 'unshowable';

/** What the phase of a card is decided from. */
export interface IBaseHalfGenerationPhaseInput {
	/** Workspace-relative path of the card. */
	readonly path: string;
	/** Whether the card's file exists. */
	readonly hasFile: boolean;
	/** The record of this computer that names the card, when there is one. */
	readonly task?: IBaseHalfGenerationTask;
}

/**
 * The phase of a card (generation cards, "The card"). A card with its file
 * shows it, whatever a record says. Otherwise a record that names the card
 * decides: a card it still lands on generates, a card it stopped is stopped,
 * and a card it ended without a file shows why.
 */
export function baseHalfGenerationPhase(input: IBaseHalfGenerationPhaseInput): BaseHalfGenerationPhase {
	if (input.hasFile) {
		return 'file';
	}
	const card = input.task ? taskCard(input.task, input.path) : undefined;
	if (!input.task || !card) {
		return 'draft';
	}
	if (card.state === 'waiting' && !isBaseHalfGenerationTaskEnded(input.task)) {
		return 'generating';
	}
	if (card.state === 'landed') {
		// The file is on its way to the card and shows once it is there; one
		// that went again after its generation ended is a missing file.
		return isBaseHalfGenerationTaskEnded(input.task) ? 'file' : 'generating';
	}
	return input.task.state === 'stopped' ? 'stopped' : 'failed';
}

export interface IBaseHalfGenerationCardInput extends IBaseHalfGenerationPhaseInput {
	/** The card's name: the name its file has, or will have. */
	readonly name: string;
	readonly kind: BaseHalfGenerationKind;
	/** The phase and progress of a generation this window follows. */
	readonly progress?: IBaseHalfVideoGenerationProgress;
	/** False once the card failed to show its file. */
	readonly fileShowable?: boolean;
	/** Milliseconds since the epoch. */
	readonly now: number;
}

export interface IBaseHalfGenerationCardPresentation {
	readonly phase: BaseHalfGenerationPhase;
	readonly state: BaseHalfGenerationCardState;
	/** Generating: Preparing, Waiting, Generating, or Saving. */
	readonly phaseText?: string;
	/** Generating: the time since it started, such as `1:05`. */
	readonly elapsedText?: string;
	/** Generating: when the generation started, in milliseconds since the epoch. */
	readonly startedAt?: number;
	/** Generating: 0 to 1 when the provider reports progress; absent while unknown. */
	readonly fraction?: number;
	/** Failed: the error. Stopped: `Stopped`. A file that cannot be shown: that it cannot. */
	readonly message?: string;
	/** Failed: the whole error, which the hover of the message shows when its two lines or its length cut it (D65). */
	readonly tooltip?: string;
	readonly ariaLabel: string;
}

/** The longest error a card shows; the whole text is in the hover of its message. */
const CARD_ERROR_MAX_LENGTH = 300;

export function baseHalfGenerationCardPresentation(input: IBaseHalfGenerationCardInput): IBaseHalfGenerationCardPresentation {
	const phase = baseHalfGenerationPhase(input);
	const kindLabel = input.kind === 'image'
		? localize('basehalf.generation.card.kindImage', "Image")
		: localize('basehalf.generation.card.kindVideo', "Video");
	const name = input.name;
	switch (phase) {
		case 'file': {
			if (input.fileShowable === false) {
				const message = input.kind === 'image'
					? localize('basehalf.generation.card.imageUnshowable', "This image cannot be shown here")
					: localize('basehalf.generation.card.videoUnshowable', "This video cannot be played here");
				return Object.freeze({
					phase,
					state: 'unshowable',
					message,
					ariaLabel: localize('basehalf.generation.card.aria.unshowable', "{0}, {1}, {2}: {3}", name, kindLabel, message, input.path)
				});
			}
			return Object.freeze({ phase, state: 'file', ariaLabel: localize('basehalf.generation.card.aria.file', "{0}, {1}", name, kindLabel) });
		}
		case 'generating': {
			const task = input.task!;
			const startedAt = input.progress?.startedAt ?? Date.parse(task.startedAt);
			const phaseText = baseHalfGenerationPhaseText(input.progress?.phase ?? baseHalfGenerationPhaseOfTask(task, input.path));
			const elapsedText = Number.isFinite(startedAt) ? formatBaseHalfVideoElapsed(input.now - startedAt) : undefined;
			const fraction = input.progress?.fraction;
			const exact = fraction !== undefined && Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : undefined;
			return Object.freeze({
				phase,
				state: phase,
				phaseText,
				...(elapsedText !== undefined ? { elapsedText } : {}),
				...(Number.isFinite(startedAt) ? { startedAt } : {}),
				...(exact !== undefined ? { fraction: exact } : {}),
				ariaLabel: exact !== undefined
					? localize('basehalf.generation.card.aria.generatingPercent', "{0}, {1}, {2}, {3} percent", name, kindLabel, phaseText, Math.round(exact * 100))
					: localize('basehalf.generation.card.aria.generating', "{0}, {1}, {2}", name, kindLabel, phaseText)
			});
		}
		case 'failed': {
			const card = taskCard(input.task!, input.path);
			const whole = card?.error ?? input.task?.error ?? localize('basehalf.generation.card.failedUnknown', "The generation failed.");
			const message = whole.length > CARD_ERROR_MAX_LENGTH ? `${whole.slice(0, CARD_ERROR_MAX_LENGTH - 1)}…` : whole;
			return Object.freeze({
				phase,
				state: phase,
				message,
				tooltip: whole,
				ariaLabel: localize('basehalf.generation.card.aria.failed', "{0}, {1}, failed: {2}", name, kindLabel, whole)
			});
		}
		case 'stopped':
			return Object.freeze({
				phase,
				state: phase,
				message: localize('basehalf.generation.card.stopped', "Stopped"),
				ariaLabel: localize('basehalf.generation.card.aria.stopped', "{0}, {1}, stopped", name, kindLabel)
			});
		default:
			return Object.freeze({ phase, state: phase, ariaLabel: localize('basehalf.generation.card.aria.draft', "{0}, {1}, draft", name, kindLabel) });
	}
}

/**
 * The phase of a record that this window does not follow, in the words of the
 * card: preparing, waiting while the request is on its way, generating while
 * the provider has the task, and saving while the files land.
 */
export function baseHalfGenerationPhaseOfTask(task: IBaseHalfGenerationTask, path?: string): BaseHalfVideoGenerationPhase {
	if (path !== undefined && taskCard(task, path)?.state === 'landed') {
		return 'saving';
	}
	switch (task.state) {
		case 'preparing': return 'preparing';
		case 'submitting': return 'waiting';
		case 'landing': return 'saving';
		default: return 'generating';
	}
}

/** The phase in words: Preparing, Waiting, Generating, or Saving. */
export function baseHalfGenerationPhaseText(phase: BaseHalfVideoGenerationPhase): string {
	switch (phase) {
		case 'preparing': return localize('basehalf.generation.card.phase.preparing', "Preparing");
		case 'generating': return localize('basehalf.generation.card.phase.generating', "Generating");
		case 'saving': return localize('basehalf.generation.card.phase.saving', "Saving");
		default: return localize('basehalf.generation.card.phase.waiting', "Waiting");
	}
}

/**
 * The actions of the toolbar above a selected generation card (generation
 * cards, "The toolbar"): Reveal and Open above a card with its file, and
 * Capture Frame above a video. A draft has none: what it takes is added from
 * its panel (D71).
 */
export function baseHalfGenerationCardToolbarActions(kind: BaseHalfGenerationKind, phase: BaseHalfGenerationPhase): readonly BaseHalfCanvasSceneVideoAction[] {
	if (phase === 'file') {
		return Object.freeze<BaseHalfCanvasSceneVideoAction[]>(kind === 'video' ? ['captureFrame', 'revealVideo', 'openFullPreview'] : ['revealVideo', 'openFullPreview']);
	}
	return Object.freeze([]);
}

function taskCard(task: IBaseHalfGenerationTask, path: string): IBaseHalfGenerationTaskCard | undefined {
	return task.cards.find(card => card.path === path);
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
