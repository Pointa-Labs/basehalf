/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IWebviewService } from '../../../contrib/webview/browser/webview.js';
import { BASEHALF_PAGE_PINCH_MESSAGE, IBaseHalfPagePinchMessage, isBaseHalfNoteZoomWheel } from '../common/basehalfNoteZoom.js';

/**
 * Hands a pinch over a page of Card Detail to that page. The browser gives a
 * pinch of the trackpad to the window, aimed at the frame of the page, never to
 * the page itself; a page that knows the message, a PDF's or a book's, zooms
 * with its own zoom (PDFs and books; zoom and outline of a note, L5). The page
 * of a note in Rich takes its pinch in its own projection.
 */
export class BaseHalfCardDetailPagePinch extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.basehalfCardDetailPagePinch';

	constructor(@IWebviewService private readonly webviewService: IWebviewService) {
		super();
		this._register(addDisposableListener(mainWindow, 'wheel', (event: WheelEvent) => this.onWheel(event), { capture: true, passive: false }));
	}

	private onWheel(event: WheelEvent): void {
		if (!isBaseHalfNoteZoomWheel(event, isMacintosh)) {
			return;
		}
		const frame = event.target as HTMLIFrameElement | null;
		if (frame?.tagName !== 'IFRAME' || !frame.closest('.basehalf-card-detail') || frame.closest('.basehalf-card-detail-markdown-rich-webview')) {
			return;
		}
		// The frame of a webview is named by the webview's id.
		const webview = [...this.webviewService.webviews].find(candidate => (candidate as unknown as { readonly id?: unknown }).id === frame.name);
		if (!webview) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		const box = frame.getBoundingClientRect();
		const message: IBaseHalfPagePinchMessage = { type: BASEHALF_PAGE_PINCH_MESSAGE, deltaY: event.deltaY, deltaMode: event.deltaMode, x: event.clientX - box.left, y: event.clientY - box.top };
		void webview.postMessage(message);
	}
}

registerWorkbenchContribution2(BaseHalfCardDetailPagePinch.ID, BaseHalfCardDetailPagePinch, WorkbenchPhase.AfterRestored);
