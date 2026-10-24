/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// What the book reader uses of foliate-js, which has no types of its own.

// The reader's stylesheet, which the bundle writes beside it.
declare module '*.css';

declare module 'foliate-js/view.js' {
	export interface IFoliateTocItem {
		readonly label?: string;
		readonly href?: string;
		readonly subitems?: readonly IFoliateTocItem[];
	}

	export interface IFoliateBook {
		readonly dir?: 'ltr' | 'rtl';
		toc?: readonly IFoliateTocItem[];
		readonly sections: readonly { readonly id: unknown; readonly linear?: string }[];
		readonly metadata?: { readonly title?: string | Readonly<Record<string, string>> };
		readonly rendition?: { readonly layout?: string };
		readonly transformTarget?: EventTarget;
	}

	export interface IFoliateLocation {
		readonly fraction?: number;
		readonly cfi?: string;
		readonly tocItem?: IFoliateTocItem;
		readonly location?: { readonly current: number; readonly next: number; readonly total: number };
	}

	export interface IFoliateRenderer extends HTMLElement {
		setStyles?(css: string): void;
		getContents(): readonly { readonly doc: Document; readonly index: number }[];
	}

	export interface IFoliateSearchMatch {
		readonly cfi: string;
		readonly excerpt: { readonly pre: string; readonly match: string; readonly post: string };
	}

	/** How an overlay draws a range. */
	export type FoliateDraw = (rects: unknown, options?: { readonly color?: string }) => SVGElement;

	export type FoliateSearchResult =
		| 'done'
		| { readonly progress: number }
		| { readonly label: string; readonly subitems: readonly IFoliateSearchMatch[] }
		| { readonly cfi: string; readonly excerpt: IFoliateSearchMatch['excerpt'] };

	/** A book that foliate-js opens: a file, or a book it made. */
	export type IFoliateBookSource = File | IFoliateBook;

	export interface IFoliateView extends HTMLElement {
		readonly book: IFoliateBook;
		readonly renderer: IFoliateRenderer;
		readonly isFixedLayout: boolean;
		readonly lastLocation?: IFoliateLocation;
		open(book: IFoliateBookSource): Promise<void>;
		init(options: { readonly lastLocation?: string; readonly showTextStart?: boolean }): Promise<void>;
		goTo(target: string | number): Promise<unknown>;
		goToFraction(fraction: number): Promise<void>;
		goLeft(): Promise<void>;
		goRight(): Promise<void>;
		prev(distance?: number): Promise<void>;
		next(distance?: number): Promise<void>;
		select(target: string): Promise<void>;
		deselect(): void;
		search(options: { readonly query: string; readonly matchCase?: boolean; readonly matchDiacritics?: boolean; readonly matchWholeWords?: boolean; readonly draw?: FoliateDraw; readonly drawOptions?: { readonly color?: string } }): AsyncGenerator<FoliateSearchResult>;
		clearSearch(): void;
		close(): void;
	}

	/** The `foliate-view` element, which the module defines when it loads. */
	export const View: { new(): IFoliateView };
}

declare module 'foliate-js/overlayer.js' {
	import type { FoliateDraw } from 'foliate-js/view.js';
	export class Overlayer {
		static readonly highlight: FoliateDraw;
		static readonly outline: FoliateDraw;
	}
}

declare module 'foliate-js/comic-book.js' {
	import type { IFoliateBook } from 'foliate-js/view.js';
	export interface IFoliateArchiveEntry {
		readonly filename: string;
	}
	export function makeComicBook(loader: {
		readonly entries: readonly IFoliateArchiveEntry[];
		loadText(name: string): Promise<string> | null;
		loadBlob(name: string, type?: string): Promise<Blob> | null;
		getSize(name: string): number;
	}, file: File): IFoliateBook;
}

declare module 'foliate-js/vendor/zip.js' {
	export interface IZipEntry {
		readonly filename: string;
		readonly directory: boolean;
		readonly uncompressedSize: number;
		getData<T>(writer: { readonly __type?: T }): Promise<T>;
	}
	export function configure(options: { readonly useWebWorkers?: boolean }): void;
	export class BlobReader {
		constructor(blob: Blob);
	}
	export class TextWriter {
		readonly __type?: string;
	}
	export class BlobWriter {
		readonly __type?: Blob;
		constructor(type?: string);
	}
	export class ZipReader {
		constructor(reader: BlobReader);
		getEntries(): Promise<IZipEntry[]>;
	}
}
