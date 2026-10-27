/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { raceTimeout } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { baseHalfCanvasMediaUrl } from './basehalfCanvasCardMedia.js';

/** At most this many pictures are measured at a time. */
const MEASURING_AT_ONCE = 6;
/** A picture that says nothing for this long cannot be measured. */
export const BASEHALF_CANVAS_PICTURE_MEASURE_TIMEOUT_MS = 3000;
/** How many measured versions of pictures the window keeps. */
const KEPT = 2000;

/** A version of the file of an image or a video: its time and its size, as the canvas asks for it. */
export interface IBaseHalfCanvasPicture {
	readonly resource: URI;
	/** `<mtime>-<size>`: the version the card's preview asks for. */
	readonly version: string;
	readonly kind: 'image' | 'video';
}

/** Measures one picture: its width to its height as the window draws it, or undefined when the window cannot decode it. */
export interface IBaseHalfCanvasPictureMeasurer {
	measure(picture: IBaseHalfCanvasPicture): Promise<number | undefined>;
}

/** The address of a version of a picture: the one the card's preview loads, so that the browser loads it once. */
export function baseHalfCanvasPictureUrl(picture: Pick<IBaseHalfCanvasPicture, 'resource' | 'version'>): string {
	return baseHalfCanvasMediaUrl(picture.resource.with({ query: `basehalfCanvasVersion=${picture.version}` }));
}

/**
 * Measures pictures with the window's own decoders: an image by its natural
 * size, a video by the size of its frame, both turned as the file says (canvas
 * card placement, "The card of an image or a video has its picture's shape").
 * The browser keeps what it loaded for the card that shows it afterwards.
 */
export function createBaseHalfCanvasPictureMeasurer(targetWindow: Window & typeof globalThis): IBaseHalfCanvasPictureMeasurer {
	const ratioOf = (width: number, height: number) => width > 0 && height > 0 ? width / height : undefined;
	return {
		measure(picture) {
			return new Promise(resolve => {
				let settled = false;
				let release = () => { };
				const finish = (ratio: number | undefined) => {
					if (settled) {
						return;
					}
					settled = true;
					targetWindow.clearTimeout(timer);
					release();
					resolve(ratio);
				};
				const timer = targetWindow.setTimeout(() => finish(undefined), BASEHALF_CANVAS_PICTURE_MEASURE_TIMEOUT_MS);
				const url = baseHalfCanvasPictureUrl(picture);
				if (picture.kind === 'image') {
					const image = new targetWindow.Image();
					release = () => {
						image.onload = null;
						image.onerror = null;
					};
					image.onload = () => finish(ratioOf(image.naturalWidth, image.naturalHeight));
					image.onerror = () => finish(undefined);
					image.src = url;
					return;
				}
				const video = targetWindow.document.createElement('video');
				video.preload = 'metadata';
				video.muted = true;
				release = () => {
					video.onloadedmetadata = null;
					video.onerror = null;
					video.removeAttribute('src');
					video.load();
				};
				video.onloadedmetadata = () => finish(ratioOf(video.videoWidth, video.videoHeight));
				video.onerror = () => finish(undefined);
				video.src = url;
			});
		}
	};
}

/**
 * The shapes of the pictures of a window's canvases (canvas card placement,
 * "The card of an image or a video has its picture's shape"): each version
 * of a file is measured once, at most six at a time. A drawing asks with
 * {@link measure}, waiting a while for the pictures of cards that appear; a
 * picture measured after that fires {@link onDidMeasure}, and the canvas is
 * drawn again with its shape.
 */
export class BaseHalfCanvasPictureShapes extends Disposable {

	/** The ratio of each measured version, or null for one the window cannot decode. */
	private readonly ratios = new Map<string, number | null>();
	private readonly measuring = new Map<string, Promise<void>>();
	private readonly waitingTurn: (() => void)[] = [];
	private running = 0;
	private disposed = false;

	private readonly onDidMeasureEmitter = this._register(new Emitter<void>());
	/** A picture was measured that no drawing waited for. */
	readonly onDidMeasure: Event<void> = this.onDidMeasureEmitter.event;

	constructor(private readonly measurer: IBaseHalfCanvasPictureMeasurer) {
		super();
	}

	override dispose(): void {
		this.disposed = true;
		this.waitingTurn.length = 0;
		super.dispose();
	}

	/** The ratio of a picture: a number once measured, null when the window cannot decode it, undefined while it is not measured. */
	ratioOf(picture: IBaseHalfCanvasPicture): number | null | undefined {
		return this.ratios.get(keyOf(picture));
	}

	/**
	 * Measures the pictures that are not measured yet. Resolves once they are,
	 * or after `wait` milliseconds; the ones measured later fire
	 * {@link onDidMeasure}.
	 */
	async measure(pictures: readonly IBaseHalfCanvasPicture[], wait: number): Promise<void> {
		const started = pictures.filter(picture => !this.ratios.has(keyOf(picture))).map(picture => this.measureOne(picture));
		if (started.length === 0) {
			return;
		}
		// A drawing that did not wait for all of them is drawn again once they are measured.
		let drawnWithout = wait <= 0;
		const all = Promise.all(started).then(() => {
			if (drawnWithout && !this.disposed) {
				this.onDidMeasureEmitter.fire();
			}
		});
		if (!drawnWithout) {
			await raceTimeout(all, wait, () => drawnWithout = true);
		}
	}

	private measureOne(picture: IBaseHalfCanvasPicture): Promise<void> {
		const key = keyOf(picture);
		const existing = this.measuring.get(key);
		if (existing) {
			return existing;
		}
		const done = this.takeTurn()
			.then(() => this.disposed ? undefined : this.measurer.measure(picture))
			.catch(() => undefined)
			.then(ratio => {
				this.running--;
				this.waitingTurn.shift()?.();
				this.measuring.delete(key);
				this.ratios.delete(key);
				this.ratios.set(key, ratio ?? null);
				if (this.ratios.size > KEPT) {
					this.ratios.delete(this.ratios.keys().next().value!);
				}
			});
		this.measuring.set(key, done);
		return done;
	}

	private takeTurn(): Promise<void> {
		if (this.running < MEASURING_AT_ONCE) {
			this.running++;
			return Promise.resolve();
		}
		return new Promise(resolve => this.waitingTurn.push(() => {
			this.running++;
			resolve();
		}));
	}
}

function keyOf(picture: Pick<IBaseHalfCanvasPicture, 'resource' | 'version'>): string {
	return `${picture.resource.toString()}|${picture.version}`;
}
