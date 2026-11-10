/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { FileAccess } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { IWebviewService, IWebviewElement, WebviewContentPurpose } from '../../../contrib/webview/browser/webview.js';
import { BASEHALF_MARKDOWN_RICH_WEBVIEW_VIEW_TYPE } from '../../markdown/common/basehalfMarkdownRichWebviewProtocol.js';
import { language } from '../../../../base/common/platform.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { asWebviewUri, webviewGenericCspSource } from '../../../contrib/webview/common/webview.js';
import { escape } from '../../../../base/common/strings.js';

// The page of the Rich editor: its webview and the HTML it loads, the states of its first frame, and the guard that
// keeps an open quick input while a webview takes the keyboard.

export const markdownRichMediaRoot = FileAccess.asFileUri('vs/../../extensions/basehalf/markdown-rich-out');

const markdownRichScript = URI.joinPath(markdownRichMediaRoot, 'editor.js');

const markdownRichStyles = URI.joinPath(markdownRichMediaRoot, 'editor.css');

export type BaseHalfMarkdownRichFirstFrameState = 'booting' | 'settling' | 'paused' | 'rendered' | 'error' | 'timeout';

/**
 * A cold custom-editor iframe must be measurable without becoming an input
 * target. The explicit state on both the retained surface and its webview host
 * also gives callers a first-frame contract that is stronger than "active".
 */
export function applyBaseHalfMarkdownRichFirstFrameState(
	container: HTMLElement,
	webviewHost: HTMLElement,
	state: BaseHalfMarkdownRichFirstFrameState,
	interactive = state !== 'booting' && state !== 'settling' && state !== 'paused'
): void {
	const pending = state === 'booting' || state === 'settling' || state === 'paused';
	const rendered = state === 'rendered';
	container.dataset.basehalfRenderState = state;
	webviewHost.dataset.basehalfRenderState = state;
	container.toggleAttribute('data-basehalf-rendered', rendered);
	webviewHost.toggleAttribute('data-basehalf-rendered', rendered);
	setBaseHalfMarkdownRichInteractionEnabled(webviewHost, interactive);
	if (pending) {
		webviewHost.setAttribute('aria-busy', 'true');
	} else {
		webviewHost.removeAttribute('aria-busy');
	}
}

export function setBaseHalfMarkdownRichInteractionEnabled(webviewHost: HTMLElement, enabled: boolean): void {
	webviewHost.inert = !enabled;
}

export function baseHalfMarkdownRichColdGenerationAction(
	state: BaseHalfMarkdownRichFirstFrameState,
	editorReady: boolean,
	quickInputVisible: boolean
): 'mount' | 'pause' | 'keep' {
	if (editorReady || (state !== 'booting' && state !== 'settling' && state !== 'paused')) {
		return 'keep';
	}
	return quickInputVisible ? 'pause' : 'mount';
}

export function baseHalfMarkdownRichFirstFrameAcknowledgement(
	state: BaseHalfMarkdownRichFirstFrameState,
	message: 'rendered' | 'focusBoundarySettled'
): BaseHalfMarkdownRichFirstFrameState {
	if (message === 'rendered') {
		return state === 'booting' ? 'settling' : state;
	}
	return state === 'settling' ? 'rendered' : state;
}

export function baseHalfMarkdownRichShouldGuardQuickInput(
	visible: boolean,
	hasLiveWebviewGeneration: boolean,
	hasCurrentQuickInput: boolean
): boolean {
	return visible && hasLiveWebviewGeneration && hasCurrentQuickInput;
}

export class BaseHalfMarkdownRichQuickInputFocusGuard<T extends { ignoreFocusOut: boolean }, G> {
	private guarded: { readonly target: T; readonly generation: G; readonly originalIgnoreFocusOut: boolean } | undefined;

	get target(): T | undefined {
		return this.guarded?.target;
	}

	guard(target: T, generation: G): void {
		if (this.guarded?.target === target && this.guarded.generation === generation) {
			return;
		}
		this.restore();
		this.guarded = { target, generation, originalIgnoreFocusOut: target.ignoreFocusOut };
		target.ignoreFocusOut = true;
	}

	owns(target: T | undefined, generation: G | undefined): boolean {
		return !!this.guarded && this.guarded.target === target && this.guarded.generation === generation;
	}

	restore(): void {
		const guarded = this.guarded;
		this.guarded = undefined;
		if (guarded) {
			guarded.target.ignoreFocusOut = guarded.originalIgnoreFocusOut;
		}
	}
}

export function createBaseHalfMarkdownRichWebviewElement(webviewService: IWebviewService, title: string): IWebviewElement {
	return webviewService.createWebviewElement({
		providedViewType: BASEHALF_MARKDOWN_RICH_WEBVIEW_VIEW_TYPE,
		title,
		options: {
			purpose: WebviewContentPurpose.CustomEditor,
			enableFindWidget: true,
			retainContextWhenHidden: true,
			tryRestoreScrollPosition: true
		},
		contentOptions: {
			allowScripts: true,
			forwardUntrustedKeypressEvents: true,
			localResourceRoots: [markdownRichMediaRoot]
		},
		extension: undefined
	});
}

/** The webview HTML for one keyed rich Markdown document projection. */
export function baseHalfMarkdownRichWebviewHtml(key: string, locale = language): string {
	const nonce = generateUuid();
	const script = asWebviewUri(markdownRichScript).toString(true);
	const styles = asWebviewUri(markdownRichStyles).toString(true);
	return `<!DOCTYPE html>
<html lang="${escapeAttribute(baseHalfMarkdownRichLocale(locale))}">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webviewGenericCspSource} data: blob: https:; media-src ${webviewGenericCspSource} data: blob: https:; font-src ${webviewGenericCspSource}; style-src ${webviewGenericCspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link nonce="${nonce}" rel="stylesheet" href="${styles}">
</head>
<body>
	<div id="root" data-basehalf-key="${escapeAttribute(encodeURIComponent(key))}"></div>
	<script nonce="${nonce}" type="module" src="${script}"></script>
</body>
</html>`;
}

export function baseHalfMarkdownRichLocale(value: string): string {
	const normalized = value.trim().replaceAll('_', '-');
	const lower = normalized.toLowerCase();
	if (lower.startsWith('zh-tw') || lower.startsWith('zh-hk') || lower.startsWith('zh-hant')) {
		return 'zh-TW';
	}
	if (lower.startsWith('zh')) {
		return 'zh-CN';
	}
	return normalized || 'en';
}

function escapeAttribute(value: string): string {
	return escape(value).replace(/"/g, '&quot;');
}
