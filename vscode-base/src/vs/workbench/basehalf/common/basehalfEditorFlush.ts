/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';

export const IBaseHalfEditorFlushService = createDecorator<IBaseHalfEditorFlushService>('baseHalfEditorFlushService');

export const BASEHALF_CARD_DETAIL_PANE_ID = 'basehalf.cardDetail';

export interface IBaseHalfEditorFlushOptions {
	readonly forceSerialize?: boolean;
	readonly forceWrite?: boolean;
}

export type BaseHalfEditorFlushFn = (options?: IBaseHalfEditorFlushOptions) => Promise<boolean>;

export interface IBaseHalfEditorFlushService {
	readonly _serviceBrand: undefined;

	registerPaneFlusher(paneId: string, fn: BaseHalfEditorFlushFn): IDisposable;
	registerDocumentFlusher(documentKey: string, fn: BaseHalfEditorFlushFn): IDisposable;
	flushPane(paneId: string, options?: IBaseHalfEditorFlushOptions): Promise<boolean>;
	flushDocument(documentKey: string, options?: IBaseHalfEditorFlushOptions): Promise<boolean>;
	flushAll(options?: IBaseHalfEditorFlushOptions): Promise<boolean>;
}

export class BaseHalfEditorFlushService implements IBaseHalfEditorFlushService {
	declare readonly _serviceBrand: undefined;

	private readonly paneFlushers = new Map<string, BaseHalfEditorFlushFn>();
	private readonly documentFlushers = new Map<string, Set<BaseHalfEditorFlushFn>>();

	registerPaneFlusher(paneId: string, fn: BaseHalfEditorFlushFn): IDisposable {
		this.paneFlushers.set(paneId, fn);
		return toDisposable(() => {
			if (this.paneFlushers.get(paneId) === fn) {
				this.paneFlushers.delete(paneId);
			}
		});
	}

	registerDocumentFlusher(documentKey: string, fn: BaseHalfEditorFlushFn): IDisposable {
		let flushers = this.documentFlushers.get(documentKey);
		if (!flushers) {
			flushers = new Set();
			this.documentFlushers.set(documentKey, flushers);
		}
		flushers.add(fn);

		return toDisposable(() => {
			const current = this.documentFlushers.get(documentKey);
			if (!current) {
				return;
			}
			current.delete(fn);
			if (current.size === 0) {
				this.documentFlushers.delete(documentKey);
			}
		});
	}

	async flushPane(paneId: string, options?: IBaseHalfEditorFlushOptions): Promise<boolean> {
		const fn = this.paneFlushers.get(paneId);
		return fn ? this.runFlusher(fn, options) : true;
	}

	async flushDocument(documentKey: string, options?: IBaseHalfEditorFlushOptions): Promise<boolean> {
		const flushers = this.documentFlushers.get(documentKey);
		if (!flushers || flushers.size === 0) {
			return true;
		}

		return this.runFlushers(flushers, options);
	}

	async flushAll(options?: IBaseHalfEditorFlushOptions): Promise<boolean> {
		const flushers = new Set<BaseHalfEditorFlushFn>();
		for (const fn of this.paneFlushers.values()) {
			flushers.add(fn);
		}
		for (const documentFlushers of this.documentFlushers.values()) {
			for (const fn of documentFlushers) {
				flushers.add(fn);
			}
		}
		return this.runFlushers(flushers, options);
	}

	private async runFlushers(flushers: Iterable<BaseHalfEditorFlushFn>, options: IBaseHalfEditorFlushOptions | undefined): Promise<boolean> {
		let ok = true;
		for (const fn of flushers) {
			if (!await this.runFlusher(fn, options)) {
				ok = false;
			}
		}
		return ok;
	}

	private async runFlusher(fn: BaseHalfEditorFlushFn, options: IBaseHalfEditorFlushOptions | undefined): Promise<boolean> {
		try {
			return await fn(options);
		} catch {
			// A torn-down editor can reject during window/workspace transitions. Match
			// the legacy BaseHalf flush registry: reject means non-blocking teardown,
			// while an explicit false is the data-loss guard.
			return true;
		}
	}
}

registerSingleton(IBaseHalfEditorFlushService, BaseHalfEditorFlushService, InstantiationType.Delayed);
