/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../base/common/lifecycle.js';

/** The part of a card element this class needs: whether it is in the document. */
export interface IBaseHalfCanvasCardElement {
	readonly isConnected: boolean;
}

/**
 * Owns the listener store of every card element the canvas builds (canvas
 * card interaction continuity). A rebuilt card's old element stays on screen
 * until the scene swaps it, so its listeners are kept until the scene reports
 * the swap. Disposing them when the replacement is built would leave the
 * element on screen deaf to a click.
 */
export class BaseHalfCanvasCardListenerStores extends Disposable {

	/** The store of the newest element built for each card. */
	private readonly newest = new Map<string, { readonly element: IBaseHalfCanvasCardElement; readonly store: DisposableStore }>();
	/** Stores of replaced elements that were still in the document when replaced. */
	private readonly kept = new Map<string, DisposableStore[]>();

	/**
	 * The listener store of `element`, the new element of the card at `path`.
	 * The element it replaces keeps its listeners while it is in the document.
	 */
	replace(path: string, element: IBaseHalfCanvasCardElement): DisposableStore {
		const previous = this.newest.get(path);
		if (previous) {
			if (previous.element.isConnected) {
				const kept = this.kept.get(path);
				if (kept) {
					kept.push(previous.store);
				} else {
					this.kept.set(path, [previous.store]);
				}
			} else {
				previous.store.dispose();
			}
		}
		const store = new DisposableStore();
		this.newest.set(path, { element, store });
		return store;
	}

	/**
	 * The scene put `element` into the document in place of the card's previous
	 * element. A report for an element a newer one has replaced changes nothing.
	 */
	didMount(path: string, element: IBaseHalfCanvasCardElement): void {
		if (this.newest.get(path)?.element !== element) {
			return;
		}
		this.disposeKept(path);
	}

	/** Releases the stores of every card whose path is not in `paths`. */
	retain(paths: ReadonlySet<string>): void {
		for (const path of [...this.newest.keys()]) {
			if (!paths.has(path)) {
				this.release(path);
			}
		}
	}

	/** Releases every store. */
	clear(): void {
		for (const path of [...this.newest.keys()]) {
			this.release(path);
		}
	}

	override dispose(): void {
		this.clear();
		super.dispose();
	}

	private release(path: string): void {
		this.newest.get(path)?.store.dispose();
		this.newest.delete(path);
		this.disposeKept(path);
	}

	private disposeKept(path: string): void {
		for (const store of this.kept.get(path) ?? []) {
			store.dispose();
		}
		this.kept.delete(path);
	}
}
