/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { FileAccess } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import {
	IBaseHalfCanvasSceneDelegate,
	IBaseHalfCanvasSceneFitOptions,
	IBaseHalfCanvasSceneRenderer,
	IBaseHalfCanvasSceneSelection,
	IBaseHalfCanvasSceneSnapshot,
	IBaseHalfCanvasSceneVideoPanelSurface,
	IBaseHalfCanvasSceneViewport
} from '../common/basehalfCanvasScene.js';
import type { ReactElement } from 'react';
import type { Root } from 'react-dom/client';
import { createBaseHalfCanvasSceneComponent } from './scene/basehalfCanvasSceneComponent.js';
import { BaseHalfCanvasReactVendor, IBaseHalfCanvasEdgeInteraction, IBaseHalfCanvasSceneEnvironment, IBaseHalfCanvasSceneRuntime } from './scene/basehalfCanvasSceneShared.js';

const CANVAS_REACT_VENDOR_ROOT = 'vs/../../extensions/basehalf/canvas-react-vendor-out';
const CANVAS_REACT_VENDOR_SCRIPT = 'canvasReactVendor.js';
const CANVAS_REACT_VENDOR_STYLES = 'canvasReactVendor.css';

let vendorPromise: Promise<BaseHalfCanvasReactVendor> | undefined;
const stylePromises = new WeakMap<Document, Promise<void>>();

/**
 * Workbench-side host for the build-time bundled React Flow island. Commands
 * issued before the bundle has loaded are serialized behind `whenReady`; the
 * latest snapshot always wins.
 */
export class BaseHalfCanvasReactScene implements IBaseHalfCanvasSceneRenderer {
	private readonly whenReady: Promise<IBaseHalfCanvasSceneRuntime>;
	private runtime: IBaseHalfCanvasSceneRuntime | undefined;
	private snapEnabled = true;
	private latestSnapshot: IBaseHalfCanvasSceneSnapshot | undefined;
	private videoPanelSurface: IBaseHalfCanvasSceneVideoPanelSurface | undefined;
	private latestViewport: IBaseHalfCanvasSceneViewport = { x: 0, y: 0, zoom: 1 };
	private root: Root | undefined;
	private rejectReady: ((error: unknown) => void) | undefined;
	private readyError: unknown;
	private disposed = false;

	constructor(
		private readonly host: HTMLElement,
		private readonly delegate: IBaseHalfCanvasSceneDelegate
	) {
		this.host.classList.add('basehalf-canvas-react-island');
		this.host.tabIndex = -1;
		this.whenReady = this.initialize();
		// `update()` is intentionally synchronous and may be the only API called
		// while the island boots. Always observe a load/mount failure so it cannot
		// become an unhandled rejection just because no imperative command followed.
		void this.whenReady.catch(error => {
			this.readyError = error;
			if (!this.disposed) {
				this.delegate.reportError(error);
			}
		});
	}

	update(snapshot: IBaseHalfCanvasSceneSnapshot): void {
		this.latestSnapshot = snapshot;
		this.runtime?.update(snapshot);
	}

	setVideoPanelSurface(surface: IBaseHalfCanvasSceneVideoPanelSurface): void {
		if (this.disposed) {
			return;
		}
		this.videoPanelSurface = surface;
		this.runtime?.setVideoPanelSurface(surface);
	}

	clearVideoPanelSurface(element: HTMLElement): void {
		if (this.videoPanelSurface?.element !== element) {
			return;
		}
		this.videoPanelSurface = undefined;
		this.runtime?.clearVideoPanelSurface(element);
	}

	setSnapEnabled(enabled: boolean): void {
		this.snapEnabled = enabled;
		this.runtime?.setSnapEnabled(enabled);
	}

	setZoom(zoom: number): Promise<void> {
		return this.run(runtime => runtime.setZoom(zoom));
	}

	zoomBy(factor: number): Promise<void> {
		return this.run(runtime => runtime.zoomBy(factor));
	}

	setViewportCenter(x: number, y: number, zoom?: number): Promise<void> {
		return this.run(runtime => runtime.setViewportCenter(x, y, zoom));
	}

	fit(paths?: readonly string[], options?: IBaseHalfCanvasSceneFitOptions): Promise<void> {
		return this.run(runtime => runtime.fit(paths, options));
	}

	reveal(path: string): Promise<void> {
		return this.run(runtime => runtime.reveal(path));
	}

	screenToCanvasPosition(x: number, y: number): { readonly x: number; readonly y: number } {
		if (this.runtime) {
			return this.runtime.screenToCanvasPosition(x, y);
		}
		const rect = this.host.getBoundingClientRect();
		return {
			x: (x - rect.left - this.latestViewport.x) / this.latestViewport.zoom,
			y: (y - rect.top - this.latestViewport.y) / this.latestViewport.zoom
		};
	}

	select(selection: IBaseHalfCanvasSceneSelection): void {
		if (this.runtime) {
			this.runtime.select(selection);
			return;
		}
		void this.whenReady.then(runtime => runtime.select(selection)).catch(() => {
			// Constructor-level observation reports renderer initialization failure.
		});
	}

	getViewport(): IBaseHalfCanvasSceneViewport {
		return this.runtime?.getViewport() ?? this.latestViewport;
	}

	/**
	 * The structural epoch the scene was last given for `sceneKey`: the one its
	 * cards' gestures report, such as a double click that opens a card.
	 */
	structuralEpochOf(sceneKey: string): number | undefined {
		return this.latestSnapshot?.key === sceneKey ? this.latestSnapshot.structuralEpoch : undefined;
	}

	isInteracting(): boolean {
		return this.runtime?.isInteracting() ?? false;
	}

	dispose(): void {
		this.disposed = true;
		this.videoPanelSurface = undefined;
		this.rejectReady?.(new Error('BaseHalf canvas scene was disposed before its renderer became ready.'));
		this.rejectReady = undefined;
		this.root?.unmount();
		this.root = undefined;
		this.runtime = undefined;
		this.host.classList.remove('basehalf-canvas-react-island');
	}

	private async initialize(): Promise<IBaseHalfCanvasSceneRuntime> {
		const [vendor] = await Promise.all([
			loadCanvasReactVendor(),
			loadCanvasReactStyles(this.host.ownerDocument)
		]);
		if (this.disposed) {
			throw new Error('BaseHalf canvas scene was disposed before its renderer loaded.');
		}

		return new Promise<IBaseHalfCanvasSceneRuntime>((resolve, reject) => {
			let settled = false;
			const resolveReady = (runtime: IBaseHalfCanvasSceneRuntime) => {
				if (settled) {
					return;
				}
				settled = true;
				this.rejectReady = undefined;
				resolve(runtime);
			};
			const rejectReady = (error: unknown) => {
				if (settled) {
					if (!this.disposed) {
						this.delegate.reportError(error);
					}
					return;
				}
				settled = true;
				this.rejectReady = undefined;
				reject(error);
			};
			this.rejectReady = rejectReady;
			try {
				const root = vendor.createRoot(this.host, {
					onUncaughtError: rejectReady
				});
				this.root = root;
				const mount = createCanvasSceneMount(vendor, this.host, this.delegate, viewport => {
					this.latestViewport = viewport;
				});
				root.render(vendor.createElement(mount.Component, {
					initialSnapshot: this.latestSnapshot ?? emptySceneSnapshot(),
					onReady: runtime => {
						if (this.disposed) {
							rejectReady(new Error('BaseHalf canvas scene was disposed while its renderer mounted.'));
							return;
						}
						this.runtime = runtime;
						runtime.setSnapEnabled(this.snapEnabled);
						if (this.latestSnapshot) {
							runtime.update(this.latestSnapshot);
						}
						if (this.videoPanelSurface) {
							runtime.setVideoPanelSurface(this.videoPanelSurface);
						}
						resolveReady(runtime);
					}
				}));
			} catch (error) {
				rejectReady(error);
			}
		});
	}

	private async run(operation: (runtime: IBaseHalfCanvasSceneRuntime) => Promise<void>): Promise<void> {
		if (this.disposed) {
			return;
		}
		try {
			await operation(await this.whenReady);
		} catch (error) {
			if (!this.disposed && error !== this.readyError) {
				this.delegate.reportError(error);
			}
			throw error;
		}
	}
}

function emptySceneSnapshot(): IBaseHalfCanvasSceneSnapshot {
	return { key: 'loading', structuralEpoch: 0, revision: 0, cards: [], edges: [] };
}

async function loadCanvasReactVendor(): Promise<BaseHalfCanvasReactVendor> {
	if (!vendorPromise) {
		const root = FileAccess.asBrowserUri(CANVAS_REACT_VENDOR_ROOT);
		const moduleUrl = URI.joinPath(root, CANVAS_REACT_VENDOR_SCRIPT).toString(true);
		vendorPromise = import(moduleUrl).then(
			module => module as unknown as BaseHalfCanvasReactVendor,
			error => {
				vendorPromise = undefined;
				throw error;
			}
		);
	}
	return vendorPromise;
}

function loadCanvasReactStyles(document: Document): Promise<void> {
	const current = stylePromises.get(document);
	if (current) {
		return current;
	}
	const loading = new Promise<void>((resolve, reject) => {
		const existing = document.querySelector<HTMLLinkElement>('link[data-basehalf-canvas-react-vendor]');
		if (existing?.dataset.loaded === 'true' || existing?.sheet) {
			resolve();
			return;
		}
		const link = existing ?? document.createElement('link');
		link.rel = 'stylesheet';
		link.dataset.basehalfCanvasReactVendor = 'true';
		const onLoad = () => {
			link.dataset.loaded = 'true';
			resolve();
		};
		const onError = () => {
			link.remove();
			reject(new Error(`Unable to load BaseHalf canvas styles from ${link.href}`));
		};
		link.addEventListener('load', onLoad, { once: true });
		link.addEventListener('error', onError, { once: true });
		if (!existing) {
			const root = FileAccess.asBrowserUri(CANVAS_REACT_VENDOR_ROOT);
			link.href = URI.joinPath(root, CANVAS_REACT_VENDOR_STYLES).toString(true);
			document.head.appendChild(link);
		}
	});
	stylePromises.set(document, loading);
	void loading.catch(() => stylePromises.delete(document));
	return loading;
}

/**
 * Makes the scene's root component for one mount. Each part of the scene
 * (scene/README.md) is made once, with the environment it is made with.
 */
function createCanvasSceneMount(
	vendor: BaseHalfCanvasReactVendor,
	host: HTMLElement,
	delegate: IBaseHalfCanvasSceneDelegate,
	onViewport: (viewport: IBaseHalfCanvasSceneViewport) => void
): {
	readonly Component: (props: {
		readonly initialSnapshot: IBaseHalfCanvasSceneSnapshot;
		readonly onReady: (runtime: IBaseHalfCanvasSceneRuntime) => void;
	}) => ReactElement;
} {
	const environment: IBaseHalfCanvasSceneEnvironment = {
		vendor,
		h: vendor.createElement,
		host,
		delegate,
		onViewport,
		EdgeInteractionContext: vendor.createContext<IBaseHalfCanvasEdgeInteraction | undefined>(undefined),
		SelectionSizeContext: vendor.createContext(0)
	};
	return { Component: createBaseHalfCanvasSceneComponent(environment) };
}
