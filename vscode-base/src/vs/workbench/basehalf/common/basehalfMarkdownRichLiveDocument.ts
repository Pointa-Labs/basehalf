/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { Doc as YDoc, type XmlFragment } from 'yjs';

const BLOCKNOTE_FRAGMENT_NAME = 'bn';
const DOCUMENT_KEY_SEPARATOR = String.fromCharCode(0);

export interface IBaseHalfMarkdownRichLiveDocument {
	readonly key: string;
	readonly doc: YDoc;
	readonly fragment: XmlFragment;
	readonly holdCount: number;
}

export interface IBaseHalfMarkdownRichLiveDocumentHandle extends IDisposable {
	readonly document: IBaseHalfMarkdownRichLiveDocument;
}

export function baseHalfMarkdownRichDocumentKey(workspaceFolder: URI, relativePath: string): string {
	return `${workspaceFolder.toString()}${DOCUMENT_KEY_SEPARATOR}${relativePath}`;
}

export class BaseHalfMarkdownRichLiveDocumentRegistry {
	private readonly documents = new Map<string, MutableBaseHalfMarkdownRichLiveDocument>();

	get(key: string): IBaseHalfMarkdownRichLiveDocument | undefined {
		return this.documents.get(key);
	}

	ensure(key: string): IBaseHalfMarkdownRichLiveDocument {
		return this.ensureMutable(key);
	}

	acquire(key: string): IBaseHalfMarkdownRichLiveDocumentHandle {
		const document = this.ensureMutable(key);
		document.cancelDestroy();
		document.holdCount++;

		let disposed = false;
		return {
			document,
			dispose: () => {
				if (disposed) {
					return;
				}
				disposed = true;
				this.release(document);
			}
		};
	}

	clear(): void {
		for (const document of this.documents.values()) {
			document.cancelDestroy();
			document.destroy();
		}
		this.documents.clear();
	}

	private ensureMutable(key: string): MutableBaseHalfMarkdownRichLiveDocument {
		let document = this.documents.get(key);
		if (!document) {
			document = new MutableBaseHalfMarkdownRichLiveDocument(key);
			this.documents.set(key, document);
		}
		return document;
	}

	private release(document: MutableBaseHalfMarkdownRichLiveDocument): void {
		if (document.holdCount === 0) {
			return;
		}

		document.holdCount--;
		if (document.holdCount === 0) {
			document.scheduleDestroy(() => {
				if (document.holdCount === 0 && this.documents.get(document.key) === document) {
					this.documents.delete(document.key);
					document.destroy();
				}
			});
		}
	}
}

class MutableBaseHalfMarkdownRichLiveDocument implements IBaseHalfMarkdownRichLiveDocument {
	readonly doc = new YDoc();
	readonly fragment: XmlFragment = this.doc.getXmlFragment(BLOCKNOTE_FRAGMENT_NAME);
	holdCount = 0;
	private destroyTimer: TimeoutHandle | undefined;

	constructor(readonly key: string) { }

	cancelDestroy(): void {
		if (this.destroyTimer === undefined) {
			return;
		}
		clearTimeout(this.destroyTimer);
		this.destroyTimer = undefined;
	}

	scheduleDestroy(callback: () => void): void {
		if (this.destroyTimer !== undefined) {
			return;
		}
		this.destroyTimer = setTimeout(() => {
			this.destroyTimer = undefined;
			callback();
		}, 0);
	}

	destroy(): void {
		this.cancelDestroy();
		if (!this.doc.isDestroyed) {
			this.doc.destroy();
		}
	}
}

type TimeoutHandle = ReturnType<typeof setTimeout>;
