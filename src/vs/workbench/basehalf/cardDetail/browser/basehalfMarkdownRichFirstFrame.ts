/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { clearNode } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { TooLargeFileOperationError } from '../../../../platform/files/common/files.js';
import { TextFileOperationError, TextFileOperationResult } from '../../../services/textfile/common/textfiles.js';
import { baseHalfNoteStoresAbove } from '../../markdown/common/basehalfMarkdownAttachment.js';
import { applyBaseHalfMarkdownRichFirstFrameState, baseHalfMarkdownRichColdGenerationAction, createBaseHalfMarkdownRichWebviewElement, markdownRichMediaRoot, baseHalfMarkdownRichWebviewHtml, baseHalfMarkdownRichShouldGuardQuickInput } from './basehalfMarkdownRichWebviewPage.js';
import type { BaseHalfMarkdownRichCardDetail } from './basehalfMarkdownRichCardDetail.js';

/**
 * The page of the Rich editor from its webview to its first frame: mounting the webview, what shows when the
 * page fails or takes too long, keeping an open quick input while the webview takes the keyboard, and ending a
 * webview that was replaced.
 *
 * A part of the Rich projection of Card Detail (`basehalfMarkdownRichCardDetail.ts`): it keeps its own state,
 * and reaches the projection's as `detail`.
 */
export class BaseHalfMarkdownRichFirstFrame {
	constructor(private readonly detail: BaseHalfMarkdownRichCardDetail) { }

	renderError(error: unknown): void {
		this.disposeWebviewGeneration();
		clearNode(this.detail.webviewHost);

		if (error instanceof TooLargeFileOperationError) {
			this.detail.renderNotice('The file is too large to open here.');
			this.detail.setSaveStatus('saved');
			this.settleFirstFrame('error');
			return;
		}

		if (TextFileOperationError.isTextFileOperationError(error) && error.textFileOperationResult === TextFileOperationResult.FILE_IS_BINARY) {
			this.detail.renderNotice('The file is not displayed here because it is either binary or uses an unsupported text encoding.');
			this.detail.setSaveStatus('saved');
			this.settleFirstFrame('error');
			return;
		}

		this.detail.logService.error('[BaseHalf] rich Markdown card detail failed to open', error);
		this.detail.renderNotice(`Unable to open the file. ${toErrorMessage(error)}`);
		this.detail.setSaveStatus('saved');
		this.settleFirstFrame('error');
	}

	private renderTimeout(): void {
		this.disposeWebviewGeneration();
		clearNode(this.detail.webviewHost);
		this.detail.renderNotice('The rich editor took too long to load. Close and reopen this card to try again.');
		this.detail.setSaveStatus('saved');
		this.detail.logService.error('[BaseHalf] rich Markdown card detail timed out before its first frame');
		this.settleFirstFrame('timeout');
	}

	settleFirstFrame(state: 'rendered' | 'error' | 'timeout'): void {
		if (this.detail.firstFrameState !== 'booting' && this.detail.firstFrameState !== 'settling' && this.detail.firstFrameState !== 'paused') {
			return;
		}
		this.detail.firstFrameState = state;
		applyBaseHalfMarkdownRichFirstFrameState(this.detail.container, this.detail.webviewHost, state);
		this.detail.firstRendered.complete();
	}

	mountFirstFrameWebview(): void {
		const state = this.detail.state;
		const documentKey = this.detail.documentKey;
		if (this.detail.disposed || this.detail.webviewGeneration || !state || !documentKey || !this.detail.model || !this.detail.bridge) {
			return;
		}
		const action = baseHalfMarkdownRichColdGenerationAction(
			this.detail.firstFrameState,
			this.detail.editorReady,
			!!this.detail.quickInputService.currentQuickInput
		);
		if (action === 'keep') {
			return;
		}
		if (action === 'pause') {
			this.detail.firstFrameState = 'paused';
			applyBaseHalfMarkdownRichFirstFrameState(this.detail.container, this.detail.webviewHost, 'paused');
			return;
		}

		this.detail.firstFrameState = 'booting';
		clearNode(this.detail.webviewHost);
		applyBaseHalfMarkdownRichFirstFrameState(this.detail.container, this.detail.webviewHost, 'booting');
		const generation = new DisposableStore();
		this.detail.webviewGeneration = generation;
		const webview = generation.add(createBaseHalfMarkdownRichWebviewElement(this.detail.webviewService, state.relativePath || state.resource.path));
		this.detail.webview = webview;
		// The stores of the folders above hold files of the notes of a subfolder opened alone (files in notes, rule 48).
		webview.localResourcesRoot = [markdownRichMediaRoot, state.workspaceFolder, ...baseHalfNoteStoresAbove(state.workspaceFolder)];
		generation.add(webview.onMessage(event => {
			if (this.detail.webviewGeneration === generation && this.detail.webview === webview) {
				void this.detail.handleWebviewMessage(event.message);
			}
		}));
		generation.add(webview.onMissingCsp(extension => {
			this.detail.logService.warn(`BaseHalf Markdown rich webview missing CSP for ${extension.value}`);
		}));
		generation.add(webview.onFatalError(error => {
			if (this.detail.webviewGeneration !== generation) {
				return;
			}
			if (!this.detail.editorReady && (this.detail.firstFrameState === 'booting' || this.detail.firstFrameState === 'settling')) {
				this.renderError(new Error(error.message));
				return;
			}
			this.detail.setSaveStatus('saving');
			this.detail.logService.error(error.message);
		}));
		generation.add(webview.onDidFocus(() => {
			if (this.detail.quickInputFocusGuard.owns(this.detail.quickInputService.currentQuickInput, generation)) {
				this.detail.quickInputService.focus();
			}
		}));
		const timer = mainWindow.setTimeout(() => {
			if (!this.detail.disposed && !this.detail.editorReady
				&& (this.detail.firstFrameState === 'booting' || this.detail.firstFrameState === 'settling')
				&& this.detail.webviewGeneration === generation) {
				this.renderTimeout();
			}
		}, 10_000);
		generation.add(toDisposable(() => mainWindow.clearTimeout(timer)));
		webview.mountTo(this.detail.webviewHost, mainWindow);
		webview.setHtml(baseHalfMarkdownRichWebviewHtml(documentKey));
		if (this.detail.structuralFrozen) {
			this.detail.postStructuralFreeze();
		}
	}

	guardVisibleQuickInput(): void {
		const generation = this.detail.webviewGeneration;
		const input = this.detail.quickInputService.currentQuickInput;
		if (!baseHalfMarkdownRichShouldGuardQuickInput(this.detail.visible, !!generation, !!input) || !generation || !input) {
			this.restoreGuardedQuickInput();
			return;
		}
		this.detail.quickInputFocusGuard.guard(input, generation);
	}

	restoreGuardedQuickInput(): void {
		this.detail.quickInputFocusGuard.restore();
	}

	scheduleFirstFrameWebviewResume(): void {
		if (this.detail.disposed || this.detail.editorReady || this.detail.firstFrameResumeTimer !== undefined) {
			return;
		}
		this.detail.firstFrameResumeTimer = mainWindow.setTimeout(() => {
			this.detail.firstFrameResumeTimer = undefined;
			if (this.detail.disposed || this.detail.editorReady || this.detail.quickInputService.currentQuickInput
				|| (this.detail.firstFrameState !== 'booting' && this.detail.firstFrameState !== 'settling' && this.detail.firstFrameState !== 'paused')) {
				return;
			}
			this.mountFirstFrameWebview();
		}, 0);
	}

	disposeWebviewGeneration(): void {
		this.restoreGuardedQuickInput();
		// The page that showed the picture goes: its editor goes with it, and the file follows at once.
		this.detail.mediaEditing.clear();
		const generation = this.detail.webviewGeneration;
		this.detail.webviewGeneration = undefined;
		this.detail.webview = undefined;
		generation?.dispose();
		// Any acknowledgement belonged to the disposed iframe generation. A
		// replacement replays the current freeze state with a fresh request id.
		this.detail.settleStructuralFreeze(false);
	}
}
