/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, append, runWhenWindowIdle } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWebviewService } from '../../../contrib/webview/browser/webview.js';
import {
	BASEHALF_MARKDOWN_RICH_WARMUP_KEY,
	isBaseHalfMarkdownRichWebviewMessage
} from '../../common/basehalfMarkdownRichWebviewProtocol.js';
import {
	baseHalfMarkdownRichWebviewHtml,
	createBaseHalfMarkdownRichWebviewElement,
	IBaseHalfPrewarmedMarkdownRichWebview
} from './basehalfMarkdownRichCardDetail.js';

interface IParkedShell extends IBaseHalfPrewarmedMarkdownRichWebview {
	booted: boolean;
	readonly disposables: DisposableStore;
}

/**
 * Keeps one booted, document-less rich Markdown editor shell parked inside
 * the card-detail body. The expensive part of opening a Markdown card — the
 * webview process, the editor bundle parse, and the editor construction — is
 * document independent, so it is paid here at window idle time instead of on
 * the user's first click. The shell's DOM is built in its final parent from
 * the start because reparenting an iframe reloads it, which would void the
 * warmup. `take()` hands the shell over once it has announced `booted`; a
 * replacement is warmed at the next idle. If the user opens a card before
 * the first shell is ready, the caller simply boots a fresh webview — the
 * pool is an accelerator, never a dependency.
 */
export class BaseHalfMarkdownRichWebviewWarmup extends Disposable {
	private parked: IParkedShell | undefined;
	private disposed = false;

	constructor(
		private readonly container: HTMLElement,
		@IWebviewService private readonly webviewService: IWebviewService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.scheduleWarmup();
	}

	override dispose(): void {
		this.disposed = true;
		this.discardParked();
		super.dispose();
	}

	/**
	 * Hands over the parked shell if it has finished booting. Ownership of
	 * the returned DOM and webview transfers to the caller; a replacement is
	 * warmed at the next window idle.
	 */
	take(): IBaseHalfPrewarmedMarkdownRichWebview | undefined {
		const parked = this.parked;
		if (!parked || !parked.booted) {
			return undefined;
		}

		this.parked = undefined;
		// Only the pool's own listeners: the webview and DOM live on with
		// their new owner.
		parked.disposables.dispose();
		this.scheduleWarmup();
		return parked;
	}

	private scheduleWarmup(): void {
		if (this.disposed || this.parked) {
			return;
		}
		this._register(runWhenWindowIdle(mainWindow, () => this.warmUp()));
	}

	private warmUp(): void {
		if (this.disposed || this.parked) {
			return;
		}

		try {
			const host = append(this.container, $('.basehalf-card-detail-surface'));
			const root = append(host, $('.basehalf-card-detail-markdown-rich'));
			const webviewHost = append(root, $('.basehalf-card-detail-markdown-rich-webview'));
			const disposables = new DisposableStore();
			const webview = createBaseHalfMarkdownRichWebviewElement(this.webviewService, 'BaseHalf Markdown');
			webview.mountTo(webviewHost, mainWindow);
			webview.setHtml(baseHalfMarkdownRichWebviewHtml(''));

			const parked: IParkedShell = { host, root, webviewHost, webview, booted: false, disposables };
			disposables.add(webview.onMessage(event => {
				const message = event.message;
				if (isBaseHalfMarkdownRichWebviewMessage(message)
					&& message.type === 'basehalf.markdownRich.booted'
					&& message.key === BASEHALF_MARKDOWN_RICH_WARMUP_KEY) {
					parked.booted = true;
				}
			}));
			this.parked = parked;
		} catch (error) {
			// Warmup is an accelerator; a failure must never surface. Callers
			// fall back to booting a fresh webview on demand.
			this.logService.warn('[BaseHalf] rich Markdown webview warmup failed', error);
		}
	}

	private discardParked(): void {
		const parked = this.parked;
		if (!parked) {
			return;
		}
		this.parked = undefined;
		parked.disposables.dispose();
		parked.webview.dispose();
		parked.host.remove();
	}
}
