/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { BaseHalfNamedInputKind } from './basehalfGenerationInputNames.js';

/**
 * What the reference menu lists (generation cards, "The panel", D68): the
 * card's inputs that have a name, and the cards of the canvas by kind, or,
 * while a search is typed, what matches it. Pure: the menu draws the rows
 * and the tests check them.
 */

/** An input or a card the menu offers. */
export interface IBaseHalfReferenceMenuItem {
	/** The workspace-relative path: who it is. */
	readonly path: string;
	readonly kind: BaseHalfNamedInputKind;
	/** Its name as BaseHalf shows it. */
	readonly title: string;
	/** Its name in the prompt, for a connected input (图片1). */
	readonly label?: string;
	/** Why it cannot be chosen; it is dimmed. */
	readonly disabled?: string;
	/** The picture of an image, as a URL the window can load. */
	readonly picture?: string;
}

/** The cards of one kind on the canvas of the card's folder. */
export interface IBaseHalfReferenceMenuKindList {
	readonly kind: BaseHalfNamedInputKind;
	readonly items: readonly IBaseHalfReferenceMenuItem[];
	/** Why no card of this kind can be chosen, as when the model takes none. */
	readonly disabled?: string;
}

export interface IBaseHalfReferenceMenuModel {
	/** The card's inputs that have a name, in the order of the list. */
	readonly connected: readonly IBaseHalfReferenceMenuItem[];
	/** Images, videos, and audio, in that order. */
	readonly canvas: readonly IBaseHalfReferenceMenuKindList[];
}

export type BaseHalfReferenceMenuRow =
	| { readonly type: 'header'; readonly text: string }
	| { readonly type: 'item'; readonly key: string; readonly item: IBaseHalfReferenceMenuItem }
	| { readonly type: 'kind'; readonly key: string; readonly kind: BaseHalfNamedInputKind; readonly text: string; readonly count: number; readonly disabled?: string }
	| { readonly type: 'empty'; readonly text: string };

/** The rows of the menu: its two parts, or what matches `query`. */
export function baseHalfReferenceMenuRows(model: IBaseHalfReferenceMenuModel, query: string): readonly BaseHalfReferenceMenuRow[] {
	const needle = compact(query);
	const rows: BaseHalfReferenceMenuRow[] = [];
	if (needle) {
		const connected = model.connected.filter(item => matches(item, needle));
		if (connected.length) {
			rows.push({ type: 'header', text: connectedTitle() });
			rows.push(...connected.map(item => itemRow('connected', item)));
		}
		const connectedPaths = new Set(model.connected.map(item => item.path));
		for (const list of model.canvas) {
			const found = list.items.filter(item => !connectedPaths.has(item.path) && matches(item, needle));
			if (found.length) {
				rows.push({ type: 'header', text: kindTitle(list.kind) });
				rows.push(...found.map(item => itemRow(list.kind, withKindDisabled(item, list))));
			}
		}
		if (!rows.length) {
			rows.push({ type: 'empty', text: localize('basehalf.generation.references.noMatch', "Nothing here has that name.") });
		}
		return Object.freeze(rows);
	}
	if (model.connected.length) {
		rows.push({ type: 'header', text: connectedTitle() });
		rows.push(...model.connected.map(item => itemRow('connected', item)));
	}
	if (model.canvas.some(list => list.items.length > 0)) {
		rows.push({ type: 'header', text: localize('basehalf.generation.references.onCanvas', "On This Canvas") });
		for (const list of model.canvas) {
			rows.push({
				type: 'kind',
				key: `kind:${list.kind}`,
				kind: list.kind,
				text: kindTitle(list.kind),
				count: list.items.length,
				...(list.disabled ? { disabled: list.disabled } : {})
			});
		}
	}
	if (!rows.length) {
		rows.push({ type: 'empty', text: localize('basehalf.generation.references.nothing', "Connect an image, a video, or audio, or add one to this canvas, to name it here.") });
	}
	return Object.freeze(rows);
}

/** The rows of the list of one kind: every card of that kind on the canvas, the connected ones with their names. */
export function baseHalfReferenceMenuKindRows(model: IBaseHalfReferenceMenuModel, kind: BaseHalfNamedInputKind): readonly BaseHalfReferenceMenuRow[] {
	const list = model.canvas.find(candidate => candidate.kind === kind);
	if (!list?.items.length) {
		return Object.freeze([{ type: 'empty', text: emptyKind(kind) }]);
	}
	return Object.freeze(list.items.map(item => itemRow(kind, withKindDisabled(item, list))));
}

/** Whether a row can be the current one of the menu: an item or a kind. */
export function isBaseHalfReferenceMenuChoice(row: BaseHalfReferenceMenuRow): row is Extract<BaseHalfReferenceMenuRow, { readonly key: string }> {
	return row.type === 'item' || row.type === 'kind';
}

function itemRow(group: string, item: IBaseHalfReferenceMenuItem): BaseHalfReferenceMenuRow {
	return { type: 'item', key: `${group}:${item.path}`, item };
}

/** A card that is connected has its name and is not refused; the others take their kind's reason. */
function withKindDisabled(item: IBaseHalfReferenceMenuItem, list: IBaseHalfReferenceMenuKindList): IBaseHalfReferenceMenuItem {
	return list.disabled && !item.label && !item.disabled ? { ...item, disabled: list.disabled } : item;
}

function matches(item: IBaseHalfReferenceMenuItem, needle: string): boolean {
	return compact(item.title).includes(needle) || (item.label !== undefined && compact(item.label).includes(needle));
}

function compact(text: string): string {
	return text.trim().toLowerCase().replace(/\s+/g, '');
}

function connectedTitle(): string {
	return localize('basehalf.generation.references.connected', "Connected");
}

function kindTitle(kind: BaseHalfNamedInputKind): string {
	switch (kind) {
		case 'image': return localize('basehalf.generation.references.images', "Images");
		case 'video': return localize('basehalf.generation.references.videos', "Videos");
		case 'audio': return localize('basehalf.generation.references.audio', "Audio");
	}
}

function emptyKind(kind: BaseHalfNamedInputKind): string {
	switch (kind) {
		case 'image': return localize('basehalf.generation.references.noImages', "No images on this canvas.");
		case 'video': return localize('basehalf.generation.references.noVideos', "No videos on this canvas.");
		case 'audio': return localize('basehalf.generation.references.noAudio', "No audio on this canvas.");
	}
}
