/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../../base/browser/window.js';
import { Emitter } from '../../../../../base/common/event.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { IBaseHalfCanvasView } from '../../browser/basehalfCanvasExtensions.js';

/** A canvas view for the tests of canvas features: it records what a feature asks of it. */
export interface IBaseHalfTestCanvasView extends IBaseHalfCanvasView {
	/** What the feature asked of the canvas, in order, such as `setZoom 0.5`. */
	readonly calls: string[];
	/** The canvas reports a new zoom, as after a gesture. */
	reportZoom(zoom: number): void;
	/** The view controls are hidden, as when Card Detail opens. */
	hideViewControls(): void;
}

export function createBaseHalfTestCanvasView(store: Pick<DisposableStore, 'add'>, options?: { readonly zoom?: number }): IBaseHalfTestCanvasView {
	const onDidChangeZoom = store.add(new Emitter<number>());
	const onDidHideViewControls = store.add(new Emitter<void>());
	const viewControls = mainWindow.document.createElement('div');
	mainWindow.document.body.appendChild(viewControls);
	store.add(toDisposable(() => viewControls.remove()));
	const calls: string[] = [];
	let zoom = options?.zoom ?? 1;
	return {
		calls,
		get zoom() { return zoom; },
		onDidChangeZoom: onDidChangeZoom.event,
		setZoom: value => calls.push(`setZoom ${value}`),
		zoomBy: direction => calls.push(`zoomBy ${direction}`),
		fitToScreen: () => calls.push('fitToScreen'),
		setSnapEnabled: enabled => calls.push(`setSnapEnabled ${enabled}`),
		viewControls,
		onDidHideViewControls: onDidHideViewControls.event,
		reportZoom: value => {
			zoom = value;
			onDidChangeZoom.fire(value);
		},
		hideViewControls: () => onDidHideViewControls.fire(),
	};
}
