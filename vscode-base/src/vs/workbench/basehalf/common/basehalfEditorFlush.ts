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

	// A pane can host several live editor surfaces at once (the card detail
	// retains one surface per projection of the open document), so both maps
	// hold sets and a pane flush drains every registered surface.
	private readonly paneFlushers = new Map<string, Set<BaseHalfEditorFlushFn>>();
	private readonly documentFlushers = new Map<string, Set<BaseHalfEditorFlushFn>>();

	registerPaneFlusher(paneId: string, fn: BaseHalfEditorFlushFn): IDisposable {
		return this.register(this.paneFlushers, paneId, fn);
	}

	registerDocumentFlusher(documentKey: string, fn: BaseHalfEditorFlushFn): IDisposable {
		return this.register(this.documentFlushers, documentKey, fn);
	}

	private register(registry: Map<string, Set<BaseHalfEditorFlushFn>>, key: string, fn: BaseHalfEditorFlushFn): IDisposable {
		let flushers = registry.get(key);
		if (!flushers) {
			flushers = new Set();
			registry.set(key, flushers);
		}
		flushers.add(fn);

		return toDisposable(() => {
			const current = registry.get(key);
			if (!current) {
				return;
			}
			current.delete(fn);
			if (current.size === 0) {
				registry.delete(key);
			}
		});
	}

	async flushPane(paneId: string, options?: IBaseHalfEditorFlushOptions): Promise<boolean> {
		const flushers = this.paneFlushers.get(paneId);
		if (!flushers || flushers.size === 0) {
			return true;
		}

		return this.runFlushers(flushers, options);
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
		for (const paneFlushers of this.paneFlushers.values()) {
			for (const fn of paneFlushers) {
				flushers.add(fn);
			}
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
