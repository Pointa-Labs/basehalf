/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, EventType } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { FileAccess } from '../../../../base/common/network.js';
import { isEqual } from '../../../../base/common/resources.js';
import { escape } from '../../../../base/common/strings.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { TooLargeFileOperationError } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ITextFileService, TextFileOperationError, TextFileOperationResult } from '../../../services/textfile/common/textfiles.js';
import { IWebviewService, IWebviewElement, WebviewContentPurpose } from '../../../contrib/webview/browser/webview.js';
import { asWebviewUri, webviewGenericCspSource } from '../../../contrib/webview/common/webview.js';
import { IBaseHalfCardDetailState } from '../../common/basehalfCanvasNavigation.js';
import { BASEHALF_CARD_DETAIL_PANE_ID, IBaseHalfEditorFlushOptions, IBaseHalfEditorFlushService } from '../../common/basehalfEditorFlush.js';
import { IBaseHalfFocusMirrorService } from '../../common/basehalfFocusMirrorService.js';
import {
	BaseHalfMarkdownRichLiveDocumentRegistry,
	baseHalfMarkdownRichDocumentKey,
	IBaseHalfMarkdownRichLiveDocumentHandle
} from '../../common/basehalfMarkdownRichLiveDocument.js';
import {
	BaseHalfMarkdownRichTextModelDisk,
	IBaseHalfMarkdownRichTextFileService
} from '../../common/basehalfMarkdownRichTextModel.js';
import {
	BASEHALF_MARKDOWN_RICH_WEBVIEW_VIEW_TYPE,
	BaseHalfMarkdownRichWorkbenchCommand,
	isBaseHalfMarkdownRichWebviewMessage
} from '../../common/basehalfMarkdownRichWebviewProtocol.js';
import { BaseHalfMarkdownRichWebviewBridge } from '../../common/basehalfMarkdownRichWebviewBridge.js';
import {
	BaseHalfMarkdownRichSaveRequestedMessage,
	BaseHalfMarkdownRichWebviewSaveCoordinator
} from '../../common/basehalfMarkdownRichWebviewSaveCoordinator.js';
import { IBaseHalfAdhdCommand } from '../../common/basehalfAdhd.js';
import { BaseHalfAdhdMirrorCorrupt, IBaseHalfAdhdMirrorService } from '../../common/basehalfAdhdMirror.js';
import { BaseHalfSetting } from '../../common/basehalfConfiguration.js';

const markdownRichDocuments = new BaseHalfMarkdownRichLiveDocumentRegistry();
const markdownRichMediaRoot = FileAccess.asFileUri('vs/../../extensions/basehalf/markdown-rich-out');
const markdownRichScript = URI.joinPath(markdownRichMediaRoot, 'editor.js');
const markdownRichStyles = URI.joinPath(markdownRichMediaRoot, 'editor.css');

export class BaseHalfMarkdownRichCardDetail extends Disposable {
	private readonly webviewHost: HTMLElement;
	private readonly coordinator = new BaseHalfMarkdownRichWebviewSaveCoordinator();
	private readonly pendingFlushes = new Map<string, { readonly resolve: (ok: boolean) => void; readonly timer: number }>();

	private state: IBaseHalfCardDetailState | undefined;
	private model: ITextModel | undefined;
	private resourceKey: string | undefined;
	private documentKey: string | undefined;
	private liveDocument: IBaseHalfMarkdownRichLiveDocumentHandle | undefined;
	private bridge: BaseHalfMarkdownRichWebviewBridge | undefined;
	private webview: IWebviewElement | undefined;
	private dirty = false;
	private lastSentContent: string | undefined;
	private writingTextModel = false;
	private disposed = false;

	constructor(
		private readonly container: HTMLElement,
		private readonly onEditorFocus: (() => void) | undefined,
		private readonly onSaveStatusChange: (status: 'saving' | 'saved') => void,
		@ITextModelService private readonly textModelService: ITextModelService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IWebviewService private readonly webviewService: IWebviewService,
		@IBaseHalfEditorFlushService private readonly editorFlushService: IBaseHalfEditorFlushService,
		@IBaseHalfFocusMirrorService private readonly focusMirrorService: IBaseHalfFocusMirrorService,
		@IBaseHalfAdhdMirrorService private readonly adhdMirrorService: IBaseHalfAdhdMirrorService,
		@ICommandService private readonly commandService: ICommandService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		clearNode(this.container);
		const root = append(this.container, $('.basehalf-card-detail-markdown-rich'));
		this.webviewHost = append(root, $('.basehalf-card-detail-markdown-rich-webview'));
		this.setSaveStatus('saving');

		this._register(addDisposableListener(root, EventType.KEY_DOWN, event => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
				event.preventDefault();
				event.stopPropagation();
				void this.flush({ forceSerialize: true, forceWrite: false });
			}
		}));
	}

	async open(state: IBaseHalfCardDetailState): Promise<void> {
		this.state = state;
		this.resourceKey = state.resource.toString();
		this.documentKey = baseHalfMarkdownRichDocumentKey(state.workspaceFolder, state.relativePath);
		this.setSaveStatus('saving');

		try {
			const modelReference = await this.textModelService.createModelReference(state.resource);
			if (this.disposed || this.resourceKey !== state.resource.toString() || !this.documentKey) {
				modelReference.dispose();
				return;
			}
			this._register(modelReference);
			this.model = modelReference.object.textEditorModel;
			this.lastSentContent = this.model.getValue();

			this.liveDocument = this._register(markdownRichDocuments.acquire(this.documentKey));
			this.bridge = this._register(new BaseHalfMarkdownRichWebviewBridge(this.documentKey, this.liveDocument.document.doc, {
				postMessage: (message, transfer) => this.webview?.postMessage(message, transfer) ?? Promise.resolve(false)
			}));

			this.webview = this._register(this.webviewService.createWebviewElement({
				providedViewType: BASEHALF_MARKDOWN_RICH_WEBVIEW_VIEW_TYPE,
				title: state.relativePath || state.resource.path,
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
			}));
			this.webview.mountTo(this.webviewHost, mainWindow);
			this.webview.setHtml(this.htmlFor(this.documentKey));

			this._register(this.webview.onMessage(event => void this.handleWebviewMessage(event.message)));
			this._register(this.webview.onMissingCsp(extension => {
				this.logService.warn(`BaseHalf Markdown rich webview missing CSP for ${extension.value}`);
			}));
			this._register(this.webview.onFatalError(error => {
				this.setSaveStatus('saving');
				this.logService.error(error.message);
			}));
			this._register(this.textFileService.files.onDidChangeDirty(file => {
				if (this.model && isEqual(file.resource, this.model.uri)) {
					this.updateStatus();
				}
			}));
			this._register(this.textFileService.files.onDidChangeReadonly(file => {
				if (this.model && isEqual(file.resource, this.model.uri)) {
					this.updateEditable();
					this.updateStatus();
				}
			}));
			this._register(this.model.onDidChangeContent(() => this.handleModelContentChanged()));
			this._register(this.editorFlushService.registerPaneFlusher(BASEHALF_CARD_DETAIL_PANE_ID, options => this.flush(options)));
			this._register(this.editorFlushService.registerDocumentFlusher(this.documentKey, options => this.flush(options)));
			this._register(this.configurationService.onDidChangeConfiguration(event => {
				const state = this.state;
				if (state && event.affectsConfiguration(BaseHalfSetting.EditorReadingMode, { resource: state.resource })) {
					void this.sendAdhdState(state);
				}
			}));

			await this.sendDocumentState(state);
			this.updateStatus();
		} catch (error) {
			if (this.disposed) {
				return;
			}
			this.renderError(error);
		}
	}

	override dispose(): void {
		this.disposed = true;
		for (const pending of this.pendingFlushes.values()) {
			mainWindow.clearTimeout(pending.timer);
			pending.resolve(true);
		}
		this.pendingFlushes.clear();
		super.dispose();
	}

	applySelection(selection: IBaseHalfCardDetailState['selection']): void {
		if (!this.state) {
			return;
		}

		this.state = { ...this.state, selection };
		if (!selection) {
			this.updateStatus();
			return;
		}

		void this.bridge?.sendRevealSelection(selection);
		this.writeSelectionFocus(this.state);
		this.updateStatus();
	}

	private async flush(options: IBaseHalfEditorFlushOptions = {}): Promise<boolean> {
		if (!this.dirty || !this.bridge) {
			return true;
		}

		const requestId = `flush-${generateUuid()}`;
		const posted = await this.bridge.sendSave(requestId, {
			forceSerialize: options.forceSerialize ?? true,
			forceWrite: options.forceWrite ?? false
		});
		if (!posted) {
			return false;
		}

		return new Promise<boolean>(resolve => {
			const timer = mainWindow.setTimeout(() => {
				this.pendingFlushes.delete(requestId);
				resolve(false);
			}, 15000);
			this.pendingFlushes.set(requestId, { resolve, timer });
		});
	}

	private async handleWebviewMessage(message: unknown): Promise<void> {
		const bridge = this.bridge;
		const state = this.state;
		const model = this.model;
		if (!bridge || !state || !model || !isBaseHalfMarkdownRichWebviewMessage(message) || message.key !== bridge.key) {
			return;
		}

		if (message.type === 'basehalf.markdownRich.ready') {
			await bridge.handleWebviewMessage(message);
			await this.sendDocumentState(state);
			return;
		}

		if (await bridge.handleWebviewMessage(message)) {
			return;
		}

		switch (message.type) {
			case 'basehalf.markdownRich.saveRequested':
				await this.handleSaveRequested(message, model);
				break;
			case 'basehalf.markdownRich.dirtyChanged':
				this.dirty = message.dirty;
				this.updateStatus();
				break;
			case 'basehalf.markdownRich.editorActivated':
				this.onEditorFocus?.();
				break;
			case 'basehalf.markdownRich.focusChanged':
				this.onEditorFocus?.();
				void this.focusMirrorService.writeFileFocus(state, {
					projection: 'rich',
					...message.fields
				}).catch(error => this.logService.error(error));
				break;
			case 'basehalf.markdownRich.workbenchCommand':
				await this.handleWorkbenchCommand(message.command);
				break;
			case 'basehalf.markdownRich.adhdCommand':
				await this.handleAdhdCommand(state, message.command);
				break;
			case 'basehalf.markdownRich.error':
				this.setSaveStatus('saving');
				this.logService.error(message.stack ?? message.message);
				break;
		}
	}

	private async handleAdhdCommand(state: IBaseHalfCardDetailState, command: IBaseHalfAdhdCommand): Promise<void> {
		if (!this.isReadingModeEnabled(state)) {
			return;
		}

		try {
			const adhd = await this.runAdhdCommand(state, command);
			await this.bridge?.sendAdhdState({ readingModeEnabled: true, adhd });
		} catch (error) {
			const message = adhdErrorMessage(error);
			this.logService.error(error);
			await this.bridge?.sendAdhdState({ readingModeEnabled: true, error: message });
		}
	}

	private async handleWorkbenchCommand(command: BaseHalfMarkdownRichWorkbenchCommand): Promise<void> {
		switch (command) {
			case 'quickOpen':
				await this.commandService.executeCommand('workbench.action.quickOpen');
				break;
			case 'showCommands':
				await this.commandService.executeCommand('workbench.action.showCommands');
				break;
		}
	}

	private runAdhdCommand(state: IBaseHalfCardDetailState, command: IBaseHalfAdhdCommand) {
		switch (command.command) {
			case 'addKeyword':
				return this.adhdMirrorService.addKeyword(state, command.keyword);
			case 'removeKeyword':
				return this.adhdMirrorService.removeKeyword(state, command.keyword);
			case 'markRead':
				return this.adhdMirrorService.markRead(state, command.start, command.end);
			case 'markUnread':
				return this.adhdMirrorService.markUnread(state, command.start, command.end);
		}
	}

	private async sendDocumentState(state: IBaseHalfCardDetailState): Promise<void> {
		const content = this.lastSentContent ?? this.model?.getValue() ?? '';
		await this.bridge?.sendInit(state.resource.toString(), content, this.isEditable(), state.selection);
		this.writeSelectionFocus(state);
		await this.sendAdhdState(state);
	}

	private writeSelectionFocus(state: IBaseHalfCardDetailState): void {
		if (!state.selection) {
			return;
		}

		void this.focusMirrorService.writeFileFocus(state, {
			projection: state.projection,
			visible_lines: { start: state.selection.startLineNumber },
			cursor: {
				line: state.selection.startLineNumber,
				column: state.selection.startColumn,
				line_precision: 'exact'
			}
		}).catch(error => this.logService.error(error));
	}

	private async sendAdhdState(state: IBaseHalfCardDetailState): Promise<void> {
		const readingModeEnabled = this.isReadingModeEnabled(state);
		if (!readingModeEnabled) {
			await this.bridge?.sendAdhdState({ readingModeEnabled, adhd: null });
			return;
		}

		try {
			const adhd = await this.adhdMirrorService.readAdhd(state);
			await this.bridge?.sendAdhdState({ readingModeEnabled, adhd });
		} catch (error) {
			const message = adhdErrorMessage(error);
			this.logService.warn(message);
			await this.bridge?.sendAdhdState({ readingModeEnabled, error: message });
		}
	}

	private isReadingModeEnabled(state: IBaseHalfCardDetailState): boolean {
		return this.configurationService.getValue<boolean>(BaseHalfSetting.EditorReadingMode, { resource: state.resource }) === true;
	}

	private async handleSaveRequested(message: BaseHalfMarkdownRichSaveRequestedMessage, model: ITextModel): Promise<void> {
		const bridge = this.bridge;
		if (!bridge) {
			return;
		}

		this.setSaveStatus('saving');
		this.writingTextModel = true;
		try {
			const outcome = await this.coordinator.handleSaveRequested(
				message,
				new BaseHalfMarkdownRichTextModelDisk(model, this.textFileAdapter()),
				bridge
			);
			if (outcome.result === 'saved' || outcome.result === 'noop') {
				this.lastSentContent = outcome.content ?? model.getValue();
				this.dirty = false;
			}
			const pending = this.pendingFlushes.get(message.requestId);
			if (pending) {
				this.pendingFlushes.delete(message.requestId);
				mainWindow.clearTimeout(pending.timer);
				pending.resolve(outcome.okToLeave);
			}
		} finally {
			this.writingTextModel = false;
			this.updateStatus();
		}
	}

	private handleModelContentChanged(): void {
		const model = this.model;
		if (!model || this.writingTextModel) {
			return;
		}

		this.updateStatus();
		const content = model.getValue();
		if (this.dirty || content === this.lastSentContent) {
			return;
		}

		this.lastSentContent = content;
		void this.bridge?.sendInit(model.uri.toString(), content, this.isEditable(), this.state?.selection);
	}

	private updateEditable(): void {
		void this.bridge?.sendEditable(this.isEditable()).catch(error => this.logService.error(error));
	}

	private updateStatus(): void {
		const model = this.model;
		if (!model) {
			this.setSaveStatus('saving');
			return;
		}

		if (!this.isEditable()) {
			this.setSaveStatus('saved');
			return;
		}

		this.setSaveStatus(this.dirty || this.textFileService.isDirty(model.uri) ? 'saving' : 'saved');
	}

	private setSaveStatus(status: 'saving' | 'saved'): void {
		this.onSaveStatusChange(status);
	}

	private isEditable(): boolean {
		const model = this.model;
		if (!model) {
			return false;
		}
		return !this.textFileAdapter().isReadonly(model.uri);
	}

	private textFileAdapter(): IBaseHalfMarkdownRichTextFileService {
		return {
			isDirty: resource => this.textFileService.isDirty(resource),
			isReadonly: resource => !!this.textFileService.files.get(resource)?.isReadonly(),
			save: (resource, options) => this.textFileService.save(resource, options)
		};
	}

	private renderError(error: unknown): void {
		clearNode(this.webviewHost);
		if (error instanceof TooLargeFileOperationError) {
			this.setSaveStatus('saved');
			return;
		}

		if (TextFileOperationError.isTextFileOperationError(error) && error.textFileOperationResult === TextFileOperationResult.FILE_IS_BINARY) {
			this.setSaveStatus('saved');
			return;
		}

		this.setSaveStatus('saving');
	}

	private htmlFor(key: string): string {
		const nonce = generateUuid();
		const script = asWebviewUri(markdownRichScript).toString(true);
		const styles = asWebviewUri(markdownRichStyles).toString(true);
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webviewGenericCspSource} data: blob: https:; font-src ${webviewGenericCspSource}; style-src ${webviewGenericCspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link nonce="${nonce}" rel="stylesheet" href="${styles}">
</head>
<body>
	<div id="root" data-basehalf-key="${escapeAttribute(encodeURIComponent(key))}"></div>
	<script nonce="${nonce}" type="module" src="${script}"></script>
</body>
</html>`;
	}
}

function escapeAttribute(value: string): string {
	return escape(value).replace(/"/g, '&quot;');
}

function adhdErrorMessage(error: unknown): string {
	if (error instanceof BaseHalfAdhdMirrorCorrupt) {
		return `ADHD metadata issue: ${error.reason}`;
	}
	return error instanceof Error ? `ADHD metadata issue: ${error.message}` : `ADHD metadata issue: ${String(error)}`;
}
