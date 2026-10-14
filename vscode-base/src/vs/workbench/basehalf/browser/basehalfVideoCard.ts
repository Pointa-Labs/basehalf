/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfVideoNode.css';
import { $, addDisposableListener, append, clearNode, disposableWindowInterval, getWindow } from '../../../base/browser/dom.js';
import { Disposable, IDisposable, MutableDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { FileAccess } from '../../../base/common/network.js';
import { isEqual } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { IHoverService } from '../../../platform/hover/browser/hover.js';
import { baseHalfVideoCardPresentation, formatBaseHalfVideoElapsed, IBaseHalfVideoCardPresentation } from '../common/basehalfVideoCardPresentation.js';
import { IBaseHalfVideoGenerationService } from '../common/basehalfVideoGeneration.js';
import { IBaseHalfVideoNodeFields, isBaseHalfVideoTaskActive } from '../common/basehalfVideoNode.js';
import { releaseBaseHalfCanvasCardMedia } from './basehalfCanvasCardMedia.js';

/** What a Video card draws. */
export interface IBaseHalfVideoCardInput {
	/** The node's `.bhnode` file. */
	readonly resource: URI;
	readonly title: string;
	readonly fields: IBaseHalfVideoNodeFields;
	/** The node's video file (`result.artifact.path` in the node's workspace folder), when it has one. */
	readonly video?: URI;
	/** Whether the video file exists. Unknown counts as there. */
	readonly videoExists?: boolean;
	/** The card is the only selected card: its player shows its controls. */
	readonly interactive: boolean;
}

export interface IBaseHalfVideoCardServices {
	readonly hoverService: IHoverService;
	/**
	 * When given, the card follows the progress of a generation in this window
	 * by itself, and a card whose node records an active task that no
	 * generation in this window follows has the service continue it.
	 */
	readonly generationService?: IBaseHalfVideoGenerationService;
}

/** A drawn Video card. Dispose it with the card's body. */
export interface IBaseHalfVideoCard extends IDisposable {
	readonly element: HTMLElement;
	/** The time the card's player shows, in seconds: what Capture Frame takes as the current frame. */
	readonly currentTime: number | undefined;
	/** Draws the card again for a newer state of the node, keeping a player that shows the same video. */
	update(input: IBaseHalfVideoCardInput): void;
}

/**
 * Draws a Video card into `container` (D58, video node specification, "The
 * card"): a video glyph while the node is empty; the phase, the time since the
 * start, and a progress bar while it generates; the error or "Stopped" when a
 * generation ended without a video; and the video, with its controls only
 * while the card is selected. The card keeps its size; the video is fitted.
 */
export function renderBaseHalfVideoCard(container: HTMLElement, input: IBaseHalfVideoCardInput, services: IBaseHalfVideoCardServices): IBaseHalfVideoCard {
	return new BaseHalfVideoCard(container, input, services);
}

/** The players of Video cards; one that starts playing pauses the others. */
const playingCardVideos = new Set<HTMLVideoElement>();

class BaseHalfVideoCard extends Disposable implements IBaseHalfVideoCard {

	readonly element: HTMLElement;
	private readonly face: HTMLElement;
	private readonly faceHover = this._register(new MutableDisposable());
	private readonly ticker = this._register(new MutableDisposable());
	private readonly player = this._register(new MutableDisposable());
	private video: HTMLVideoElement | undefined;
	private videoSource: URI | undefined;
	private videoPlayable = true;
	private elapsed: HTMLElement | undefined;
	private tooltip: string | undefined;

	constructor(
		container: HTMLElement,
		private input: IBaseHalfVideoCardInput,
		private readonly services: IBaseHalfVideoCardServices
	) {
		super();
		this.element = append(container, $('.bh-video-card'));
		this.face = append(this.element, $('.bh-video-card-face'));
		if (services.generationService) {
			this._register(services.generationService.onDidChangeProgress(resource => {
				if (isEqual(resource, this.input.resource)) {
					this.render();
				}
			}));
		}
		this._register(toDisposable(() => this.element.remove()));
		this.render();
	}

	get currentTime(): number | undefined {
		return this.video && Number.isFinite(this.video.currentTime) ? this.video.currentTime : undefined;
	}

	update(input: IBaseHalfVideoCardInput): void {
		if (!isEqual(input.video, this.input.video)) {
			this.videoPlayable = true;
		}
		this.input = input;
		this.render();
	}

	private render(): void {
		const generationService = this.services.generationService;
		if (generationService && isBaseHalfVideoTaskActive(this.input.fields.task) && !generationService.isGenerating(this.input.resource)) {
			// A generation that started before a reload or in another window: continue it (safe to repeat).
			generationService.resume(this.input.resource);
		}
		const progress = generationService?.getProgress(this.input.resource);
		const presentation = baseHalfVideoCardPresentation({
			title: this.input.title,
			fields: this.input.fields,
			...(progress ? { progress } : {}),
			...(this.input.videoExists !== undefined ? { videoExists: this.input.videoExists } : {}),
			videoPlayable: this.videoPlayable,
			now: Date.now()
		});
		this.element.dataset.state = presentation.state;
		if (presentation.state === 'video' && this.input.video) {
			this.face.hidden = true;
			this.faceHover.clear();
			this.element.removeAttribute('role');
			this.element.removeAttribute('aria-label');
			this.showVideo(this.input.video);
		} else {
			this.hideVideo();
			this.face.hidden = false;
			this.element.setAttribute('role', 'img');
			this.element.setAttribute('aria-label', presentation.ariaLabel);
			this.renderFace(presentation);
		}
		this.updateTicker(presentation);
	}

	private renderFace(presentation: IBaseHalfVideoCardPresentation): void {
		clearNode(this.face);
		this.elapsed = undefined;
		const glyph = append(this.face, $('.bh-video-card-glyph'));
		glyph.append(videoGlyph(presentation.state === 'empty' ? 40 : 30));
		if (presentation.state === 'generating') {
			const status = append(this.face, $('.bh-video-card-status'));
			append(status, $('span.bh-video-card-phase')).textContent = presentation.phaseText ?? '';
			if (presentation.elapsedText !== undefined) {
				this.elapsed = append(status, $('span.bh-video-card-elapsed'));
				this.elapsed.textContent = presentation.elapsedText;
			}
			const bar = append(this.face, $('.bh-video-card-progress'));
			const value = append(bar, $('.bh-video-card-progress-value'));
			bar.setAttribute('role', 'progressbar');
			bar.setAttribute('aria-label', presentation.phaseText ?? '');
			bar.setAttribute('aria-valuemin', '0');
			bar.setAttribute('aria-valuemax', '100');
			if (presentation.fraction === undefined) {
				bar.classList.add('indeterminate');
			} else {
				const percent = Math.round(presentation.fraction * 100);
				value.style.width = `${percent}%`;
				bar.setAttribute('aria-valuenow', String(percent));
			}
		} else if (presentation.message !== undefined) {
			const message = append(this.face, $('.bh-video-card-message'));
			message.textContent = presentation.message;
		}
		this.tooltip = presentation.tooltip;
		if (this.tooltip !== undefined && !this.faceHover.value) {
			this.faceHover.value = this.services.hoverService.setupDelayedHover(this.face, () => ({ content: this.tooltip ?? '' }));
		} else if (this.tooltip === undefined) {
			this.faceHover.clear();
		}
	}

	/** While the node generates, the time since it started counts up each second. */
	private updateTicker(presentation: IBaseHalfVideoCardPresentation): void {
		const startedAt = presentation.startedAt;
		if (presentation.state !== 'generating' || startedAt === undefined) {
			this.ticker.clear();
			return;
		}
		if (!this.ticker.value) {
			this.ticker.value = disposableWindowInterval(getWindow(this.element), () => {
				if (this.elapsed) {
					this.elapsed.textContent = formatBaseHalfVideoElapsed(Date.now() - startedAt);
				}
			}, 1000);
		}
	}

	private showVideo(source: URI): void {
		const interactive = this.input.interactive;
		if (!this.video || !isEqual(this.videoSource, source)) {
			this.hideVideo();
			const video = $<HTMLVideoElement>('video.bh-video-card-video');
			this.element.insertBefore(video, this.face);
			video.preload = 'metadata';
			video.playsInline = true;
			// The first frame stands for the video until it plays.
			video.src = `${FileAccess.uriToBrowserUri(source).toString(true)}#t=0.001`;
			this.video = video;
			this.videoSource = source;
			const disposables: IDisposable[] = [
				addDisposableListener(video, 'error', () => {
					this.videoPlayable = false;
					this.render();
				}),
				addDisposableListener(video, 'play', () => {
					for (const other of playingCardVideos) {
						if (other !== video) {
							other.pause();
						}
					}
					playingCardVideos.add(video);
				}),
				addDisposableListener(video, 'pause', () => playingCardVideos.delete(video)),
				// With its controls shown, the player owns these gestures; otherwise
				// they select, move, and open the card like the rest of it.
				...(['pointerdown', 'mousedown', 'click', 'dblclick', 'wheel'] as const).map(type => addDisposableListener(video, type, event => {
					if (video.controls) {
						event.stopPropagation();
					}
				}))
			];
			this.player.value = toDisposable(() => {
				for (const disposable of disposables) {
					disposable.dispose();
				}
				playingCardVideos.delete(video);
				releaseBaseHalfCanvasCardMedia(video);
				video.remove();
			});
		}
		const video = this.video;
		// A deselected card has no controls to stop its video with.
		if (!interactive && !video.paused) {
			video.pause();
		}
		video.controls = interactive;
		video.tabIndex = interactive ? 0 : -1;
		video.classList.toggle('nodrag', interactive);
		video.classList.toggle('nopan', interactive);
		video.classList.toggle('nowheel', interactive);
		video.style.pointerEvents = interactive ? '' : 'none';
		if (interactive) {
			video.removeAttribute('aria-hidden');
			video.setAttribute('aria-label', localize('basehalf.video.card.player', "Video player for {0}", this.input.title));
		} else {
			video.removeAttribute('aria-label');
			video.setAttribute('aria-hidden', 'true');
		}
	}

	private hideVideo(): void {
		this.player.clear();
		this.video = undefined;
		this.videoSource = undefined;
	}
}

/** The video glyph of the canvas: a frame with a play mark. */
function videoGlyph(size: number): SVGElement {
	const svg = $.SVG('svg');
	svg.setAttribute('viewBox', '0 0 16 16');
	svg.setAttribute('fill', 'none');
	svg.setAttribute('stroke', 'currentColor');
	svg.setAttribute('stroke-width', '1.25');
	svg.setAttribute('stroke-linecap', 'round');
	svg.setAttribute('stroke-linejoin', 'round');
	svg.setAttribute('aria-hidden', 'true');
	svg.style.width = `${size}px`;
	svg.style.height = `${size}px`;
	const frame = $.SVG('rect');
	frame.setAttribute('x', '2.5');
	frame.setAttribute('y', '3.5');
	frame.setAttribute('width', '11');
	frame.setAttribute('height', '9');
	frame.setAttribute('rx', '1.6');
	svg.appendChild(frame);
	const play = $.SVG('path');
	play.setAttribute('d', 'M6.8 6.3l3 1.7-3 1.7z');
	play.setAttribute('fill', 'currentColor');
	play.setAttribute('stroke', 'none');
	svg.appendChild(play);
	return svg;
}
