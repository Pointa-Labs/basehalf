/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { getActiveElement, getWindow, isHTMLElement } from '../../../../base/browser/dom.js';
import { Emitter } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { FileAccess } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { pauseBaseHalfCanvasMedia } from './basehalfCanvasCardMedia.js';
import { createBaseHalfCanvasCardVideoPlayer, IBaseHalfCanvasCardVideoPlayer } from './basehalfCanvasCardVideoPlayer.js';

/**
 * Where a note's videos and sounds are drawn: the note, and its card at rest,
 * the card's editor, or Preview. A drawing takes over the players of the
 * drawing of the same note and place before it (note rendering, rule 4b).
 */
export interface IBaseHalfNoteMediaDrawing {
	readonly note: URI;
	readonly surface: 'rest' | 'editor' | 'preview';
}

/**
 * The version of each video and sound file of a note that an edit where the
 * note shows it changed (D114), by file: a note's player loads that version by
 * an address of its own, as the canvas loads every version of a media file,
 * so that the window does not show what it loaded of the file before.
 */
const editedVersions = new Map<string, string>();
const onDidEditVersion = new Emitter<string>();

function fileKey(resource: URI): string {
	return resource.with({ query: '', fragment: '' }).toString();
}

/**
 * A video or a sound of a note was edited where the note shows it, and its
 * file is now at `version` (`baseHalfCanvasMediaVersion`): every note's player
 * of the file loads that version, at once and in every drawing after (D114).
 */
export function noteBaseHalfNoteMediaVersion(resource: URI, version: string): void {
	const key = fileKey(resource);
	if (editedVersions.get(key) !== version) {
		editedVersions.set(key, version);
		onDidEditVersion.fire(key);
	}
}

/** The source a note's player plays for the file at `src`: at the version an edit of it left, by the query that names it. */
function noteMediaSource(src: string): URI {
	const file = FileAccess.uriToFileUri(URI.parse(src));
	const version = editedVersions.get(fileKey(file));
	return version ? file.with({ query: `basehalfCanvasVersion=${version}` }) : file;
}

/** A player of a note's video or sound, and what it stands for. */
interface INoteMediaPlayer {
	readonly player: IBaseHalfCanvasCardVideoPlayer;
	/** The address the note's renderer gave the video or the sound, by which the next drawing finds its player. */
	readonly src: string;
	/** The version of the file the player plays: a drawing takes over only a player of the file's version now (D114). */
	readonly source: string;
	/** The element the renderer drew, shown in the player's place when its file cannot be played. */
	media: HTMLMediaElement;
	/** The drawing that shows it; none while it waits for the next drawing. */
	drawing: NoteMediaDrawing | undefined;
	/** Made for a drawing built before it was shown: the player of the drawing it replaces takes its place. */
	readonly standIn: boolean;
	/** The control of the player that had the keyboard when it began to wait. */
	focused?: HTMLElement;
}

/** The drawings shown now, by note and place. */
const drawings = new Map<string, Set<NoteMediaDrawing>>();
/**
 * The players of drawings that went, by note and place, in their order: the
 * next drawing of the same note and place takes them over. Those that no
 * drawing takes go once the window has drawn the next frame.
 */
const waiting = new Map<string, INoteMediaPlayer[]>();
/** Where waiting players stay in the document, out of sight, so that what plays goes on playing. */
const waitingRooms = new WeakMap<Document, HTMLElement>();
let drawingCount = 0;

/**
 * Plays each video and sound of a rendered note in BaseHalf's own player, the
 * player of a video's card (note formats, rule 52): on the note's card and in
 * the card's editor the picture is the card's, and in Preview a click on it
 * plays and pauses it. A video keeps the width the note gives it. One that
 * cannot be played is shown again as the note's renderer drew it. One whose
 * file an edit in the note changed plays anew from the file's new version
 * (D114).
 *
 * A note drawn again keeps its players (note rendering, rule 4b): when this
 * drawing goes, the next drawing of the same note and place takes over its
 * players, at the places of the same videos and sounds, so that one that
 * plays goes on playing and one that stands keeps its frame.
 */
export function playBaseHalfNoteMedia(element: HTMLElement, drawing: IBaseHalfNoteMediaDrawing): IDisposable {
	return new NoteMediaDrawing(element, drawing.surface === 'preview' ? 'page' : 'card', `${drawing.surface}:${drawing.note.toString()}`);
}

/** Pauses the players of a rendered note, as when the card's editor covers it. */
export function pauseBaseHalfNoteMedia(element: HTMLElement): void {
	// eslint-disable-next-line no-restricted-syntax
	for (const video of Array.from(element.querySelectorAll<HTMLVideoElement>('video.basehalf-canvas-video-player-video'))) {
		pauseBaseHalfCanvasMedia(video);
	}
}

/** Lets every waiting player go at once, as the next frame does: for a test. */
export function releaseWaitingBaseHalfNoteMedia(): void {
	for (const queue of [...waiting.values()]) {
		release(queue);
	}
}

class NoteMediaDrawing implements IDisposable {
	private readonly order = drawingCount++;
	private readonly players: INoteMediaPlayer[] = [];
	private readonly versions = onDidEditVersion.event(key => this.playEdited(key));
	private disposed = false;

	constructor(
		private readonly element: HTMLElement,
		private readonly where: 'card' | 'page',
		private readonly key: string
	) {
		// The videos and sounds are drawn by the note's renderer, not built here.
		// eslint-disable-next-line no-restricted-syntax
		for (const media of Array.from(element.querySelectorAll<HTMLMediaElement>('video[src], audio[src]'))) {
			const src = media.getAttribute('src');
			if (!media.parentElement || !src || media.classList.contains('basehalf-canvas-video-player-video')) {
				continue;
			}
			// A drawing that is shown takes over a waiting player at once. One built before it is shown, as a card's
			// new element, gets stand-ins, whose places the players of the drawing it replaces take once it is shown.
			const taken = element.isConnected ? takeWaiting(key, src) : undefined;
			if (taken) {
				this.adopt(taken, media, media);
			} else {
				this.players.push(this.create(media, src, !element.isConnected));
			}
		}
		let shown = drawings.get(key);
		if (!shown) {
			shown = new Set();
			drawings.set(key, shown);
		}
		shown.add(this);
	}

	private create(media: HTMLMediaElement, src: string, standIn: boolean, parent: HTMLElement = media.parentElement!, before: Node | null = media): INoteMediaPlayer {
		// The renderer gives the element the address the window loads; the player asks for the file by its own, at its version.
		const source = noteMediaSource(src);
		const entry: INoteMediaPlayer = {
			player: createBaseHalfCanvasCardVideoPlayer(parent, before, {
				source,
				videoClasses: [],
				sound: media.tagName === 'AUDIO',
				note: this.where,
				open: () => { /* A note's player opens nothing: a double click is the card's. */ },
				onError: () => entry.drawing?.fail(entry),
			}),
			src,
			source: source.toString(),
			media,
			drawing: this,
			standIn,
		};
		setWidth(entry.player, media);
		// The element the player stands in for loads nothing while it waits.
		media.remove();
		media.removeAttribute('src');
		media.load();
		return entry;
	}

	/**
	 * Shows `entry`, a player of a drawing before this one, at `place`, for
	 * `media`, the element this drawing's renderer drew there.
	 */
	private adopt(entry: INoteMediaPlayer, place: Element, media: HTMLMediaElement, index = this.players.length): void {
		place.replaceWith(entry.player.element);
		if (place === media) {
			// The element the renderer drew loads nothing: the player that takes its place has the file already.
			media.removeAttribute('src');
			media.load();
		}
		entry.media = media;
		entry.drawing = this;
		setWidth(entry.player, media);
		this.players[index] = entry;
		// The keyboard goes back to the control that had it, unless something else took it meanwhile.
		const focused = entry.focused;
		entry.focused = undefined;
		const active = getActiveElement();
		if (focused?.isConnected && (!active || active === focused.ownerDocument.body)) {
			focused.focus({ preventScroll: true });
		}
	}

	/**
	 * The players that wait for this drawing take the places of its stand-ins
	 * for the same videos and sounds, in their order. A stand-in that has been
	 * played is this drawing's own player.
	 */
	takeOver(): void {
		if (this.disposed || !this.element.isConnected) {
			return;
		}
		this.players.forEach((entry, index) => {
			if (!entry.standIn || entry.drawing !== this || entry.player.video.played.length > 0) {
				return;
			}
			const taken = takeWaiting(this.key, entry.src);
			if (taken) {
				this.adopt(taken, entry.player.element, entry.media, index);
				entry.drawing = undefined;
				entry.player.discard();
			}
		});
	}

	/** The file of `key` was edited: a player of its new version takes the place of each player of it here (D114). */
	private playEdited(key: string): void {
		this.players.forEach((entry, index) => {
			const place = entry.player.element;
			if (entry.drawing !== this || !place.parentElement || fileKey(FileAccess.uriToFileUri(URI.parse(entry.src))) !== key || entry.source === noteMediaSource(entry.src).toString()) {
				return;
			}
			this.players[index] = this.create(entry.media, entry.src, false, place.parentElement, place);
			entry.drawing = undefined;
			entry.player.discard();
		});
	}

	/** The file of `entry` cannot be played: the element the note's renderer drew stands in its place. */
	fail(entry: INoteMediaPlayer): void {
		const index = this.players.indexOf(entry);
		if (index === -1) {
			return;
		}
		entry.media.setAttribute('src', entry.src);
		entry.player.element.replaceWith(entry.media);
		this.players.splice(index, 1);
		entry.drawing = undefined;
		entry.player.dispose();
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.versions.dispose();
		const shown = drawings.get(this.key);
		shown?.delete(this);
		if (shown?.size === 0) {
			drawings.delete(this.key);
		}
		const own = this.players.filter(entry => entry.drawing === this);
		if (own.length === 0) {
			return;
		}
		// The players wait for the next drawing of the note there, still in the document, where a video plays on.
		const room = waitingRoom(this.element.ownerDocument);
		let queue = waiting.get(this.key);
		if (!queue) {
			queue = [];
			waiting.set(this.key, queue);
		}
		const active = getActiveElement();
		for (const entry of own) {
			entry.drawing = undefined;
			entry.focused = isHTMLElement(active) && entry.player.element.contains(active) ? active : undefined;
			room.append(entry.player.element);
			queue.push(entry);
		}
		// A drawing of the note there that is shown already takes them now, as a card's new element does once the canvas shows it.
		for (const drawing of [...shown ?? []].sort((first, second) => first.order - second.order)) {
			if (drawing.order > this.order) {
				drawing.takeOver();
			}
		}
		scheduleRelease(own, getWindow(this.element));
	}
}

/** The first player that waits for the next drawing of `key` and plays `src` at the file's version now, taken out of the queue. */
function takeWaiting(key: string, src: string): INoteMediaPlayer | undefined {
	const queue = waiting.get(key);
	const source = noteMediaSource(src).toString();
	const index = queue ? queue.findIndex(entry => entry.src === src && entry.source === source) : -1;
	if (!queue || index === -1) {
		return undefined;
	}
	const [entry] = queue.splice(index, 1);
	if (queue.length === 0) {
		waiting.delete(key);
	}
	return entry;
}

/**
 * `players` that still wait once the window has drawn the next frame go:
 * their blocks have left the note, or the note is no longer drawn there.
 */
function scheduleRelease(players: readonly INoteMediaPlayer[], targetWindow: Window): void {
	let done = false;
	const releaseOnce = () => {
		if (!done) {
			done = true;
			targetWindow.clearTimeout(timer);
			release(players);
		}
	};
	// A window that draws no frame, as a hidden one, lets them go after a second.
	const timer = targetWindow.setTimeout(releaseOnce, 1000);
	targetWindow.requestAnimationFrame(() => targetWindow.requestAnimationFrame(releaseOnce));
}

/** `players` that still wait go. */
function release(players: readonly INoteMediaPlayer[]): void {
	for (const entry of [...players]) {
		if (entry.drawing !== undefined) {
			continue;
		}
		for (const [key, queue] of waiting) {
			const index = queue.indexOf(entry);
			if (index !== -1) {
				queue.splice(index, 1);
				if (queue.length === 0) {
					waiting.delete(key);
				}
				entry.player.dispose();
				break;
			}
		}
	}
}

function waitingRoom(targetDocument: Document): HTMLElement {
	let room = waitingRooms.get(targetDocument);
	if (!room?.isConnected) {
		room = targetDocument.createElement('div');
		room.className = 'basehalf-note-media-waiting';
		room.setAttribute('aria-hidden', 'true');
		room.setAttribute('inert', '');
		// Out of sight and of every press, yet in the document: a video taken out of the document stops.
		room.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;';
		targetDocument.body.append(room);
		waitingRooms.set(targetDocument, room);
	}
	return room;
}

/** A video keeps the width the note gives it. */
function setWidth(player: IBaseHalfCanvasCardVideoPlayer, media: HTMLMediaElement): void {
	const width = media.tagName === 'VIDEO' ? media.getAttribute('width') : null;
	if (width) {
		player.video.setAttribute('width', width);
	} else {
		player.video.removeAttribute('width');
	}
}
