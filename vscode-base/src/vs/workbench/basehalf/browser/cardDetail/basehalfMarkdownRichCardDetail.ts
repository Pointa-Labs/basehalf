/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, EventType } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { DeferredPromise, timeout } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { FileAccess } from '../../../../base/common/network.js';
import { posix } from '../../../../base/common/path.js';
import { basename, isEqual, relativePath } from '../../../../base/common/resources.js';
import { escape } from '../../../../base/common/strings.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { RedoCommand, UndoCommand } from '../../../../editor/browser/editorExtensions.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { TooLargeFileOperationError } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ISearchService } from '../../../services/search/common/search.js';
import { QueryBuilder } from '../../../services/search/common/queryBuilder.js';
import { ITextFileService, TextFileOperationError, TextFileOperationResult } from '../../../services/textfile/common/textfiles.js';
import { IWebviewService, IWebviewElement, WebviewContentPurpose } from '../../../contrib/webview/browser/webview.js';
import { asWebviewUri, webviewGenericCspSource } from '../../../contrib/webview/common/webview.js';
import { IBaseHalfCanvasNavigationService, IBaseHalfCardDetailState } from '../../common/basehalfCanvasNavigation.js';
import { BASEHALF_CARD_DETAIL_PANE_ID, IBaseHalfEditorFlushOptions, IBaseHalfEditorFlushService } from '../../common/basehalfEditorFlush.js';
import { IBaseHalfFileFocusFields, IBaseHalfFocusMirrorService } from '../../common/basehalfFocusMirrorService.js';
import { IBaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceResourceMutationStamp } from '../../common/basehalfWorkspaceMutation.js';
import { baseHalfMarkdownRichNeedsSaveRequest } from '../../common/basehalfMarkdownRichFlush.js';
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
	BaseHalfMarkdownRichEditorCommand,
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

// The rich editor owns its edit history (the webview's collaboration undo
// manager), so workbench Undo/Redo must be delivered to it as an explicit
// editor command. This priority must outrank the generic webview
// implementation (priority 100), whose native-undo path mutates the
// contenteditable DOM behind the editor's transaction model.
const MARKDOWN_RICH_UNDO_REDO_PRIORITY = 110;
const markdownRichMediaRoot = FileAccess.asFileUri('vs/../../extensions/basehalf/markdown-rich-out');
const markdownRichScript = URI.joinPath(markdownRichMediaRoot, 'editor.js');
const markdownRichStyles = URI.joinPath(markdownRichMediaRoot, 'editor.css');

/**
 * A booted, document-less editor shell handed over by the warmup pool: its
 * DOM already lives inside the card-detail body (an iframe reload is the
 * price of reparenting) and its webview has parsed the editor bundle.
 */
export interface IBaseHalfPrewarmedMarkdownRichWebview {
	readonly host: HTMLElement;
	readonly root: HTMLElement;
	readonly webviewHost: HTMLElement;
	readonly webview: IWebviewElement;
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

/**
 * The webview HTML for the rich Markdown editor. An empty `key` boots a
 * prewarmed shell: it loads and constructs the editor but stays inert until
 * the host assigns a document via the `adopt` message.
 */
export function baseHalfMarkdownRichWebviewHtml(key: string): string {
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

export class BaseHalfMarkdownRichCardDetail extends Disposable {
	private readonly webviewHost: HTMLElement;
	private readonly coordinator = new BaseHalfMarkdownRichWebviewSaveCoordinator();
	private readonly pendingFlushes = new Map<string, { readonly resolve: (ok: boolean) => void; readonly timer: number }>();
	private pendingStructuralFreeze: { readonly requestId: string; readonly frozen: boolean; readonly promise: DeferredPromise<boolean>; readonly timer: number } | undefined;

	private state: IBaseHalfCardDetailState | undefined;
	private focusStamp: IBaseHalfWorkspaceResourceMutationStamp | undefined;
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
	private visible = false;
	private pendingModelSync = false;
	private structuralFrozen = false;
	private acknowledgedStructuralFrozen = false;
	private readonly firstRendered = new DeferredPromise<void>();

	constructor(
		private readonly container: HTMLElement,
		private readonly onEditorFocus: (() => void) | undefined,
		private readonly onSaveStatusChange: (status: 'saving' | 'saved') => void,
		private readonly prewarmed: IBaseHalfPrewarmedMarkdownRichWebview | undefined,
		@ITextModelService private readonly textModelService: ITextModelService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IWebviewService private readonly webviewService: IWebviewService,
		@IBaseHalfEditorFlushService private readonly editorFlushService: IBaseHalfEditorFlushService,
		@IBaseHalfFocusMirrorService private readonly focusMirrorService: IBaseHalfFocusMirrorService,
		@IBaseHalfWorkspaceMutationCoordinator private readonly workspaceMutationCoordinator: IBaseHalfWorkspaceMutationCoordinator,
		@IBaseHalfAdhdMirrorService private readonly adhdMirrorService: IBaseHalfAdhdMirrorService,
		@ICommandService private readonly commandService: ICommandService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ISearchService private readonly searchService: ISearchService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IBaseHalfCanvasNavigationService private readonly canvasNavigationService: IBaseHalfCanvasNavigationService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		// A prewarmed shell arrives with its DOM (and booted webview) already
		// built inside `container`; reparenting the iframe would reload it and
		// void the warmup, so adopt the existing elements instead.
		const root = this.prewarmed
			? this.prewarmed.root
			: append(this.container, $('.basehalf-card-detail-markdown-rich'));
		this.webviewHost = this.prewarmed
			? this.prewarmed.webviewHost
			: append(root, $('.basehalf-card-detail-markdown-rich-webview'));
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
		this.focusStamp = this.workspaceMutationCoordinator.captureResource(state.workspaceFolder, state.relativePath);
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
			if (this.prewarmed) {
				this.webview = this._register(this.prewarmed.webview);
			} else {
				this.webview = this._register(createBaseHalfMarkdownRichWebviewElement(this.webviewService, state.relativePath || state.resource.path));
				this.webview.mountTo(this.webviewHost, mainWindow);
				this.webview.setHtml(baseHalfMarkdownRichWebviewHtml(this.documentKey));
			}

			this._register(UndoCommand.addImplementation(MARKDOWN_RICH_UNDO_REDO_PRIORITY, 'basehalfMarkdownRich', () => this.dispatchEditorCommand('undo')));
			this._register(RedoCommand.addImplementation(MARKDOWN_RICH_UNDO_REDO_PRIORITY, 'basehalfMarkdownRich', () => this.dispatchEditorCommand('redo')));

			this._register(this.webview.onMessage(event => void this.handleWebviewMessage(event.message)));
			if (this.structuralFrozen) {
				this.postStructuralFreeze();
			}
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

			if (this.prewarmed) {
				// The shell is already booted and inert; assigning its document
				// key triggers the ordinary `ready` handshake and boot flow.
				await this.webview.postMessage({ type: 'basehalf.markdownRich.adopt', key: this.documentKey });
			}

			await this.sendDocumentState(state);
			this.updateStatus();

			// open() resolves at the first meaningful frame: the webview acks
			// `rendered` once the document is applied and painted. The timeout
			// is a progress guarantee for a wedged webview, not a UI delay.
			await Promise.race([this.firstRendered.p, timeout(10_000)]);
		} catch (error) {
			if (this.disposed) {
				return;
			}
			this.renderError(error);
		}
	}

	override dispose(): void {
		this.disposed = true;
		this.firstRendered.complete();
		for (const pending of this.pendingFlushes.values()) {
			mainWindow.clearTimeout(pending.timer);
			pending.resolve(true);
		}
		this.pendingFlushes.clear();
		this.settleStructuralFreeze(false);
		super.dispose();
	}

	/**
	 * Re-entry hook for a retained (hidden) surface becoming the visible
	 * projection again: adopt the latest navigation state and re-reveal its
	 * selection. Focus mirroring self-heals on the webview's next focus event.
	 */
	activate(state: IBaseHalfCardDetailState): void {
		this.state = state;
		if (state.selection) {
			void this.bridge?.sendRevealSelection(state.selection);
			this.writeSelectionFocus(state);
		}
	}

	/**
	 * While hidden, forwarding every text-model change into the webview would
	 * run the external-merge path per keystroke typed in a sibling projection
	 * of the same document. Hidden surfaces suspend forwarding and reconcile
	 * once when they become visible again.
	 */
	setVisible(visible: boolean): void {
		if (this.visible === visible) {
			return;
		}
		this.visible = visible;
		if (visible && this.pendingModelSync) {
			this.pendingModelSync = false;
			this.forwardModelContent();
		}
	}

	/**
	 * The host DOM's `inert` attribute cannot fence an iframe. Structural file
	 * operations therefore hold an explicit editor-side freeze from preflight
	 * through the did/fail cascade. A structural save waits for the matching
	 * webview acknowledgement before it may serialize.
	 */
	setStructuralFrozen(frozen: boolean): void {
		if (this.structuralFrozen === frozen
			&& (this.pendingStructuralFreeze?.frozen === frozen || this.acknowledgedStructuralFrozen === frozen)) {
			return;
		}
		this.structuralFrozen = frozen;
		this.postStructuralFreeze();
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
		const structural = options.activeProjection !== undefined;
		if (!this.bridge) {
			return !structural;
		}
		if (!baseHalfMarkdownRichNeedsSaveRequest(this.dirty, this.visible, options)) {
			return true;
		}
		if (structural && (!this.structuralFrozen || !await this.waitForStructuralFreeze())) {
			return false;
		}

		const requestId = `flush-${generateUuid()}`;
		const posted = await this.bridge.sendSave(requestId, {
			forceSerialize: options.forceSerialize ?? true,
			forceWrite: options.forceWrite ?? false,
			structural
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
			if (this.structuralFrozen && !this.acknowledgedStructuralFrozen) {
				this.postStructuralFreeze();
			}
			await this.sendDocumentState(state);
			return;
		}

		if (message.type === 'basehalf.markdownRich.rendered') {
			this.firstRendered.complete();
			return;
		}

		if (await bridge.handleWebviewMessage(message)) {
			return;
		}

		switch (message.type) {
			case 'basehalf.markdownRich.structuralFreezeChanged':
				this.handleStructuralFreezeChanged(message.requestId, message.frozen);
				break;
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
				// Mirror bookkeeping only. Focus-field updates also fire on
				// autosave settle and decoration refreshes, so they must not
				// count as user activation (editorActivated handles that) —
				// otherwise the badge zone closes underneath the user.
				this.writeFileFocus(state, {
					projection: 'rich',
					...message.fields
				});
				break;
			case 'basehalf.markdownRich.workbenchCommand':
				await this.handleWorkbenchCommand(message.command);
				break;
			case 'basehalf.markdownRich.fileSearch':
				await this.handleFileSearch(state, message.requestId, message.query);
				break;
			case 'basehalf.markdownRich.openSource':
				// The escape hatch for passthrough blocks: reopen this card in
				// the source projection with the block's lines selected.
				await this.canvasNavigationService.openCardDetail(state.resource, {
					source: 'api',
					projection: 'source',
					selection: message.selection,
					pinned: state.pinned
				});
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

	private postStructuralFreeze(): void {
		const bridge = this.bridge;
		if (!bridge) {
			return;
		}
		this.settleStructuralFreeze(false);
		const requestId = `freeze-${generateUuid()}`;
		const promise = new DeferredPromise<boolean>();
		const timer = mainWindow.setTimeout(() => {
			if (this.pendingStructuralFreeze?.requestId === requestId) {
				this.pendingStructuralFreeze = undefined;
				promise.complete(false);
			}
		}, 5000);
		this.pendingStructuralFreeze = { requestId, frozen: this.structuralFrozen, promise, timer };
		void bridge.sendStructuralFreeze(requestId, this.structuralFrozen).then(posted => {
			if (!posted && this.pendingStructuralFreeze?.requestId === requestId) {
				this.settleStructuralFreeze(false);
			}
		}, () => {
			if (this.pendingStructuralFreeze?.requestId === requestId) {
				this.settleStructuralFreeze(false);
			}
		});
	}

	private async waitForStructuralFreeze(): Promise<boolean> {
		if (this.acknowledgedStructuralFrozen && !this.pendingStructuralFreeze) {
			return true;
		}
		const pending = this.pendingStructuralFreeze;
		return !!pending?.frozen && await pending.promise.p;
	}

	private handleStructuralFreezeChanged(requestId: string, frozen: boolean): void {
		const pending = this.pendingStructuralFreeze;
		if (!pending || pending.requestId !== requestId || pending.frozen !== frozen) {
			return;
		}
		this.acknowledgedStructuralFrozen = frozen;
		this.settleStructuralFreeze(true);
	}

	private settleStructuralFreeze(ok: boolean): void {
		const pending = this.pendingStructuralFreeze;
		if (!pending) {
			return;
		}
		this.pendingStructuralFreeze = undefined;
		mainWindow.clearTimeout(pending.timer);
		pending.promise.complete(ok);
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

	private dispatchEditorCommand(command: BaseHalfMarkdownRichEditorCommand): boolean {
		const webview = this.webview;
		const bridge = this.bridge;
		if (!webview || !bridge || this.webviewService.activeWebview !== webview || !webview.isFocused) {
			return false;
		}

		void bridge.sendCommand(command).catch(error => this.logService.error(error));
		return true;
	}

	// Backs the rich editor's `[[` link autocomplete: resolves workspace files
	// for the typed query, with hrefs already relative to the document being
	// edited so the webview can write them straight into a Markdown link.
	private async handleFileSearch(state: IBaseHalfCardDetailState, requestId: string, query: string): Promise<void> {
		try {
			const fileQuery = this.instantiationService.createInstance(QueryBuilder).file([state.workspaceFolder], {
				filePattern: query,
				sortByScore: true,
				maxResults: 12
			});
			const result = await this.searchService.fileSearch(fileQuery, CancellationToken.None);
			const documentDir = posix.dirname(posix.sep + state.relativePath);
			const files = result.results.flatMap(match => {
				const workspaceRelative = relativePath(state.workspaceFolder, match.resource);
				if (!workspaceRelative || workspaceRelative === state.relativePath) {
					return [];
				}
				return [{
					name: basename(match.resource),
					path: workspaceRelative,
					href: posix.relative(documentDir, posix.sep + workspaceRelative)
				}];
			});
			await this.bridge?.sendFileSearchResult(requestId, files);
		} catch (error) {
			this.logService.error(error);
			await this.bridge?.sendFileSearchResult(requestId, []);
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
		const stamp = this.focusStamp;
		if (!stamp) {
			return Promise.reject(new Error('The card detail resource is no longer current.'));
		}
		return this.workspaceMutationCoordinator.runResourceMutation(state.workspaceFolder, stamp, lease => {
			switch (command.command) {
				case 'addKeyword':
					return this.adhdMirrorService.addKeyword(state, command.keyword, lease);
				case 'removeKeyword':
					return this.adhdMirrorService.removeKeyword(state, command.keyword, lease);
				case 'markRead':
					return this.adhdMirrorService.markRead(state, command.start, command.end, lease);
				case 'markUnread':
					return this.adhdMirrorService.markUnread(state, command.start, command.end, lease);
			}
		});
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

		this.writeFileFocus(state, {
			projection: state.projection,
			visible_lines: { start: state.selection.startLineNumber },
			cursor: {
				line: state.selection.startLineNumber,
				column: state.selection.startColumn,
				line_precision: 'exact'
			}
		});
	}

	private writeFileFocus(state: IBaseHalfCardDetailState, fields: IBaseHalfFileFocusFields): void {
		const stamp = this.focusStamp;
		if (!stamp) {
			return;
		}
		void this.workspaceMutationCoordinator.runResourceMutation(state.workspaceFolder, stamp, lease =>
			this.focusMirrorService.writeFileFocus(state, fields, lease)
		).catch(error => this.logService.error(error));
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
		if (!this.model || this.writingTextModel) {
			return;
		}

		this.updateStatus();
		if (!this.visible) {
			// Reconciled once in setVisible(true).
			this.pendingModelSync = true;
			return;
		}
		this.forwardModelContent();
	}

	private forwardModelContent(): void {
		const model = this.model;
		if (!model) {
			return;
		}
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
		// The error notice is this surface's first meaningful frame; unblock
		// the projection swap so the message becomes visible.
		this.firstRendered.complete();

		if (error instanceof TooLargeFileOperationError) {
			this.renderNotice('The file is too large to open here.');
			this.setSaveStatus('saved');
			return;
		}

		if (TextFileOperationError.isTextFileOperationError(error) && error.textFileOperationResult === TextFileOperationResult.FILE_IS_BINARY) {
			this.renderNotice('The file is not displayed here because it is either binary or uses an unsupported text encoding.');
			this.setSaveStatus('saved');
			return;
		}

		this.logService.error('[BaseHalf] rich Markdown card detail failed to open', error);
		this.renderNotice(`Unable to open the file. ${toErrorMessage(error)}`);
		this.setSaveStatus('saved');
	}

	private renderNotice(message: string): void {
		const notice = append(this.webviewHost, $('.basehalf-card-detail-source-notice'));
		notice.textContent = message;
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
