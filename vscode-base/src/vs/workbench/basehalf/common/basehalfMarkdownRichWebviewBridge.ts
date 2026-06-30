/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, toDisposable } from '../../../base/common/lifecycle.js';
import { Doc as YDoc, applyUpdate, encodeStateAsUpdate } from './vendor/yjs.bundle.js';
import { IBaseHalfAdhdFile } from './basehalfAdhd.js';
import {
	BaseHalfMarkdownRichHostMessage,
	BaseHalfMarkdownRichWebviewMessage,
	IBaseHalfMarkdownRichTextSelection,
	baseHalfMarkdownRichUpdateFromPayload,
	isBaseHalfMarkdownRichWebviewMessage,
	toBaseHalfMarkdownRichTransferableUpdate
} from './basehalfMarkdownRichWebviewProtocol.js';

export interface IBaseHalfMarkdownRichWebviewTransport {
	postMessage(message: BaseHalfMarkdownRichHostMessage, transfer?: readonly ArrayBuffer[]): Promise<boolean>;
}

export class BaseHalfMarkdownRichWebviewBridge extends Disposable {
	private readonly onDocUpdate = (update: Uint8Array, origin: unknown): void => {
		if (origin === this) {
			return;
		}
		void this.postYjsUpdate(update);
	};

	constructor(
		readonly key: string,
		private readonly doc: YDoc,
		private readonly transport: IBaseHalfMarkdownRichWebviewTransport
	) {
		super();

		this.doc.on('update', this.onDocUpdate);
		this._register(toDisposable(() => this.doc.off('update', this.onDocUpdate)));
	}

	sendInit(resource: string, content: string, editable: boolean, selection?: IBaseHalfMarkdownRichTextSelection): Promise<boolean> {
		return this.transport.postMessage({
			type: 'basehalf.markdownRich.init',
			key: this.key,
			resource,
			content,
			editable,
			...(selection ? { selection } : {})
		});
	}

	sendEditable(editable: boolean): Promise<boolean> {
		return this.transport.postMessage({
			type: 'basehalf.markdownRich.setEditable',
			key: this.key,
			editable
		});
	}

	sendSave(requestId: string, options: { readonly forceSerialize: boolean; readonly forceWrite: boolean }): Promise<boolean> {
		return this.transport.postMessage({
			type: 'basehalf.markdownRich.save',
			key: this.key,
			requestId,
			forceSerialize: options.forceSerialize,
			forceWrite: options.forceWrite
		});
	}

	sendSaveResult(
		requestId: string,
		result: 'saved' | 'noop' | 'blockedByConflict' | 'writeFailed',
		options: { readonly content?: string; readonly disk?: string; readonly message?: string } = {}
	): Promise<boolean> {
		return this.transport.postMessage({
			type: 'basehalf.markdownRich.saveResult',
			key: this.key,
			requestId,
			result,
			...(options.content !== undefined ? { content: options.content } : {}),
			...(options.disk !== undefined ? { disk: options.disk } : {}),
			...(options.message !== undefined ? { message: options.message } : {})
		});
	}

	sendAdhdState(options: { readonly adhd?: IBaseHalfAdhdFile | null; readonly error?: string }): Promise<boolean> {
		return this.transport.postMessage({
			type: 'basehalf.markdownRich.adhdState',
			key: this.key,
			...(options.adhd !== undefined ? { adhd: options.adhd } : {}),
			...(options.error !== undefined ? { error: options.error } : {})
		});
	}

	async handleWebviewMessage(message: unknown): Promise<boolean> {
		if (!isBaseHalfMarkdownRichWebviewMessage(message) || message.key !== this.key) {
			return false;
		}

		switch (message.type) {
			case 'basehalf.markdownRich.ready':
				return this.postYjsUpdate(encodeStateAsUpdate(this.doc));
			case 'basehalf.markdownRich.yjsUpdate':
				applyUpdate(this.doc, baseHalfMarkdownRichUpdateFromPayload(message.update), this);
				return true;
			default:
				return false;
		}
	}

	private postYjsUpdate(update: Uint8Array): Promise<boolean> {
		const transferable = toBaseHalfMarkdownRichTransferableUpdate(update);
		return this.transport.postMessage({
			type: 'basehalf.markdownRich.applyYjsUpdate',
			key: this.key,
			update: transferable.update
		}, transferable.transfer);
	}
}

export function isBaseHalfMarkdownRichRoutedWebviewMessage(message: unknown, key: string): message is BaseHalfMarkdownRichWebviewMessage {
	return isBaseHalfMarkdownRichWebviewMessage(message) && message.key === key;
}
