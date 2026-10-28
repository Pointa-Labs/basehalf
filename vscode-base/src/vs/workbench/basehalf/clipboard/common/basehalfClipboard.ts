/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

/** An item of a transfer: a file or a folder on disk, or a draft, which has no file. */
export interface IBaseHalfTransferItem {
	readonly resource: URI;
	readonly draft?: true;
}

/**
 * What one copy, one cut, or one drag holds, as BaseHalf reads it (copy,
 * paste, and drop, "Terms"): items, a picture with no file, or text.
 */
export type BaseHalfTransfer =
	| { readonly kind: 'items'; readonly items: readonly IBaseHalfTransferItem[]; readonly cut: boolean }
	| { readonly kind: 'picture'; readonly data: VSBuffer; readonly extension: string; readonly name?: string }
	| { readonly kind: 'text'; readonly text: string };

export const IBaseHalfClipboardService = createDecorator<IBaseHalfClipboardService>('baseHalfClipboardService');

/**
 * The one way BaseHalf writes and reads the system clipboard (D104): a copy of
 * items writes the files, their paths as text, and BaseHalf's record in one
 * write, and a paste reads the clipboard as one transfer.
 */
export interface IBaseHalfClipboardService {
	readonly _serviceBrand: undefined;
	/**
	 * Puts these files, folders, and drafts on the clipboard, cut or not, in
	 * one write; a path that holds a draft is recorded as one. Nothing is
	 * written for none. A read that starts before the write is done reads
	 * what it wrote.
	 */
	writeItems(resources: readonly URI[], cut: boolean): Promise<void>;
	/** Reads the clipboard as one transfer, or undefined when it holds none. */
	read(): Promise<BaseHalfTransfer | undefined>;
	/**
	 * Reads only the items of the clipboard: those of BaseHalf's record, or
	 * the files another app copied, not cut. Undefined when it holds none; a
	 * picture or text is not read.
	 */
	readItems(): Promise<{ readonly items: readonly IBaseHalfTransferItem[]; readonly cut: boolean } | undefined>;
}

interface IBaseHalfClipboardRecord {
	readonly version: 1;
	readonly cut: boolean;
	readonly items: readonly { readonly uri: string; readonly draft?: true }[];
}

/** BaseHalf's record of `items`: what only BaseHalf reads of a copy. */
export function baseHalfClipboardRecord(items: readonly IBaseHalfTransferItem[], cut: boolean): string {
	const record: IBaseHalfClipboardRecord = {
		version: 1,
		cut,
		items: items.map(item => item.draft ? { uri: item.resource.toString(), draft: true } : { uri: item.resource.toString() })
	};
	return JSON.stringify(record);
}

/** The items and the cut of a record, or undefined for text that is no record of BaseHalf's. */
export function parseBaseHalfClipboardRecord(text: string): { readonly items: readonly IBaseHalfTransferItem[]; readonly cut: boolean } | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (!isRecord(parsed) || parsed.version !== 1 || typeof parsed.cut !== 'boolean' || !Array.isArray(parsed.items)) {
		return undefined;
	}
	const items: IBaseHalfTransferItem[] = [];
	for (const item of parsed.items) {
		if (!isRecord(item) || typeof item.uri !== 'string') {
			return undefined;
		}
		let resource: URI;
		try {
			resource = URI.parse(item.uri, true);
		} catch {
			return undefined;
		}
		items.push(item.draft === true ? { resource, draft: true } : { resource });
	}
	return items.length > 0 ? { items, cut: parsed.cut } : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' };

/**
 * The paths of the files that the clipboard holds as files, from the list of
 * file names that the system gives for them: a property list of strings.
 */
export function parseBaseHalfClipboardFileNames(propertyList: string): string[] {
	const paths: string[] = [];
	for (const match of propertyList.matchAll(/<string>(?<value>[^<]*)<\/string>/g)) {
		const path = match.groups!.value.replace(/&(?:#x(?<hex>[0-9a-f]+)|#(?<decimal>[0-9]+)|(?<name>[a-z]+));/gi, (entity, hex: string | undefined, decimal: string | undefined, name: string | undefined) => {
			if (hex !== undefined) {
				return String.fromCodePoint(parseInt(hex, 16));
			}
			if (decimal !== undefined) {
				return String.fromCodePoint(parseInt(decimal, 10));
			}
			return XML_ENTITIES[name!] ?? entity;
		});
		if (path.startsWith('/')) {
			paths.push(path);
		}
	}
	return paths;
}

/**
 * The name a picture or text that becomes a file in `folder` takes, as New
 * Note names a note: `untitled.<extension>`, or the first free
 * `untitled-<n>.<extension>` (copy, paste, and drop, "What is not a file
 * becomes one"). A picture with a name of its own keeps it, or takes the
 * first free one with a number after it.
 */
export function baseHalfTransferFileNames(extension: string, name?: string): Iterable<string> {
	return (function* () {
		if (name) {
			const dot = name.lastIndexOf('.');
			const stem = dot > 0 ? name.slice(0, dot) : name;
			const own = dot > 0 ? name.slice(dot) : extension ? `.${extension}` : '';
			yield `${stem}${own}`;
			for (let number = 2; number < 1000; number++) {
				yield `${stem} ${number}${own}`;
			}
			return;
		}
		yield `untitled.${extension}`;
		for (let number = 1; number < 1000; number++) {
			yield `untitled-${number}.${extension}`;
		}
	})();
}
