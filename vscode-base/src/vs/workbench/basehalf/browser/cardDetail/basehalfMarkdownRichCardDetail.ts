/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, EventType } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { DeferredPromise } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { FileAccess } from '../../../../base/common/network.js';
import { posix } from '../../../../base/common/path.js';
import { language } from '../../../../base/common/platform.js';
import { basename, dirname, isEqual, joinPath, relativePath } from '../../../../base/common/resources.js';
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
import { IQuickInput, IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { ISearchService } from '../../../services/search/common/search.js';
import { QueryBuilder } from '../../../services/search/common/queryBuilder.js';
import { ITextFileService, TextFileOperationError, TextFileOperationResult } from '../../../services/textfile/common/textfiles.js';
import { IWebviewService, IWebviewElement, WebviewContentPurpose } from '../../../contrib/webview/browser/webview.js';
import { asWebviewUri, webviewGenericCspSource } from '../../../contrib/webview/common/webview.js';
import { IBaseHalfCanvasNavigationService, IBaseHalfCardDetailState } from '../../common/basehalfCanvasNavigation.js';
import { BASEHALF_CARD_DETAIL_PANE_ID, IBaseHalfEditorFlushOptions, IBaseHalfEditorFlushService } from '../../common/basehalfEditorFlush.js';
import { IBaseHalfFileFocusFields, IBaseHalfFocusMirrorService } from '../../common/basehalfFocusMirrorService.js';
import { IBaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceResourceMutationStamp } from '../../common/basehalfWorkspaceMutation.js';
import { baseHalfMarkdownRichColdFlushResult, baseHalfMarkdownRichNeedsSaveRequest } from '../../common/basehalfMarkdownRichFlush.js';
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
	BASEHALF_MARKDOWN_ATTACHMENT_MAX_BYTES,
	BaseHalfMarkdownRichEditorCommand,
	BaseHalfMarkdownRichSurface,
	BaseHalfMarkdownRichWorkbenchCommand,
	IBaseHalfMarkdownRichFormatState,
	IBaseHalfMarkdownRichFocusPoint,
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
import { IBaseHalfMarkdownAttachmentService } from '../../common/basehalfMarkdownAttachment.js';

const markdownRichDocuments = new BaseHalfMarkdownRichLiveDocumentRegistry();

interface IBaseHalfMarkdownRichProjectionSave {
	promise: Promise<boolean>;
	error?: string;
}

const markdownRichProjectionSaves = new Map<string, IBaseHalfMarkdownRichProjectionSave>();

// The rich editor owns its edit history (the webview's collaboration undo
// manager), so workbench Undo/Redo must be delivered to it as an explicit
// editor command. This priority must outrank the generic webview
// implementation (priority 100), whose native-undo path mutates the
// contenteditable DOM behind the editor's transaction model.
const MARKDOWN_RICH_UNDO_REDO_PRIORITY = 110;
const markdownRichMediaRoot = FileAccess.asFileUri('vs/../../extensions/basehalf/markdown-rich-out');
const markdownRichScript = URI.joinPath(markdownRichMediaRoot, 'editor.js');
const markdownRichStyles = URI.joinPath(markdownRichMediaRoot, 'editor.css');

export interface IBaseHalfMarkdownRichCardDetailOptions {
	readonly surface?: BaseHalfMarkdownRichSurface;
	readonly canvasAuthoring?: boolean;
	readonly onFormatStateChange?: (state: IBaseHalfMarkdownRichFormatState) => void;
	readonly onCanvasToolbarRequest?: () => void;
	readonly onCanvasAuthoringRequest?: (point?: IBaseHalfMarkdownRichFocusPoint) => void;
	readonly onCanvasExitRequest?: () => void;
}

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

export class BaseHalfMarkdownRichCardDetail extends Disposable {
	private readonly webviewHost: HTMLElement;
	private readonly coordinator = new BaseHalfMarkdownRichWebviewSaveCoordinator();
	private readonly pendingFlushes = new Map<string, { readonly resolve: (ok: boolean) => void; readonly timer: number; readonly handoff?: true }>();
	private readonly pendingEditorSaveContents = new Set<string>();
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
	private lastAcceptedEditorContent: string | undefined;
	private writingTextModel = 0;
	private disposed = false;
	private visible = false;
	private pendingModelSync = false;
	private structuralFrozen = false;
	private acknowledgedStructuralFrozen = false;
	private editorReady = false;
	private readonly pendingEditorCommands: BaseHalfMarkdownRichEditorCommand[] = [];
	private pendingPrepareToClose: Promise<boolean> | undefined;
	private pendingProjectionHandoff: Promise<boolean> | undefined;
	private pendingProjectionSave: Promise<boolean> | undefined;
	private projectionSaveFailed = false;
	private canvasAuthoring: boolean;
	private readonly firstRendered = new DeferredPromise<void>();
	private firstFrameState: BaseHalfMarkdownRichFirstFrameState = 'booting';
	private webviewGeneration: DisposableStore | undefined;
	private firstFrameResumeTimer: number | undefined;
	private readonly quickInputFocusGuard = new BaseHalfMarkdownRichQuickInputFocusGuard<IQuickInput, DisposableStore>();

	constructor(
		private readonly container: HTMLElement,
		private readonly onEditorFocus: (() => void) | undefined,
		private readonly onSaveStatusChange: (status: 'saving' | 'saved' | 'error') => void,
		private readonly options: IBaseHalfMarkdownRichCardDetailOptions = {},
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
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IBaseHalfCanvasNavigationService private readonly canvasNavigationService: IBaseHalfCanvasNavigationService,
		@IBaseHalfMarkdownAttachmentService private readonly attachmentService: IBaseHalfMarkdownAttachmentService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.canvasAuthoring = this.surface !== 'canvas' || this.options.canvasAuthoring === true;

		const root = append(this.container, $('.basehalf-card-detail-markdown-rich'));
		this.webviewHost = append(root, $('.basehalf-card-detail-markdown-rich-webview'));
		applyBaseHalfMarkdownRichFirstFrameState(this.container, this.webviewHost, 'booting');
		this.setSaveStatus('saving');
		this._register(this.quickInputService.onShow(() => {
			this.guardVisibleQuickInput();
		}));
		this._register(this.quickInputService.onHide(() => {
			this.restoreGuardedQuickInput();
			if (this.editorReady && this.firstFrameState === 'paused') {
				this.settleFirstFrame('rendered');
			} else if (!this.webviewGeneration) {
				this.scheduleFirstFrameWebviewResume();
			}
		}));

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
			this.lastAcceptedEditorContent = this.lastSentContent;
			this.observeProjectionSave();

			this.liveDocument = this._register(markdownRichDocuments.acquire(this.documentKey));
			this.bridge = this._register(new BaseHalfMarkdownRichWebviewBridge(this.documentKey, this.liveDocument.document.doc, {
				postMessage: (message, transfer) => this.webview?.postMessage(message, transfer) ?? Promise.resolve(false)
			}));
			this.mountFirstFrameWebview();

			this._register(UndoCommand.addImplementation(MARKDOWN_RICH_UNDO_REDO_PRIORITY, 'basehalfMarkdownRich', () => this.dispatchEditorCommand('undo')));
			this._register(RedoCommand.addImplementation(MARKDOWN_RICH_UNDO_REDO_PRIORITY, 'basehalfMarkdownRich', () => this.dispatchEditorCommand('redo')));

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

			this.updateStatus();

			await this.firstRendered.p;
		} catch (error) {
			if (this.disposed) {
				return;
			}
			this.renderError(error);
		}
	}

	override dispose(): void {
		this.disposed = true;
		if (this.firstFrameResumeTimer !== undefined) {
			mainWindow.clearTimeout(this.firstFrameResumeTimer);
			this.firstFrameResumeTimer = undefined;
		}
		this.disposeWebviewGeneration();
		this.pendingEditorCommands.length = 0;
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
		if (visible) {
			this.guardVisibleQuickInput();
		} else {
			this.restoreGuardedQuickInput();
		}
		if (visible && this.pendingModelSync) {
			this.pendingModelSync = false;
			this.forwardModelContent();
		}
	}

	setCanvasAuthoring(authoring: boolean): void {
		if (this.surface !== 'canvas' || this.canvasAuthoring === authoring) {
			return;
		}
		this.canvasAuthoring = authoring;
		this.updateEditable();
		this.updateStatus();
	}

	focus(point?: IBaseHalfMarkdownRichFocusPoint): void {
		this.webview?.focus();
		if (point) {
			void this.bridge?.sendFocusAtPoint(point).catch(error => this.logService.error(error));
		}
	}

	/**
	 * Sends a semantic edit command to the active editor. Commands issued while
	 * the document projection is still loading are retained until it reports a
	 * usable selection state.
	 */
	runEditorCommand(command: BaseHalfMarkdownRichEditorCommand): boolean {
		if (this.disposed) {
			return false;
		}
		const bridge = this.bridge;
		if (!bridge || !this.editorReady) {
			this.pendingEditorCommands.push(command);
			return true;
		}

		void bridge.sendCommand(command).catch(error => this.logService.error(error));
		return true;
	}

	/**
	 * Fences input and takes a stable serialized snapshot before the caller
	 * removes this surface. A failed save restores editing so local work remains
	 * available for conflict resolution or retry.
	 */
	prepareToClose(): Promise<boolean> {
		if (this.disposed) {
			return this.ensureProjectionSaved();
		}
		if (!this.bridge) {
			return Promise.resolve(true);
		}
		if (!this.pendingPrepareToClose) {
			this.pendingPrepareToClose = this.doPrepareToClose();
		}
		return this.pendingPrepareToClose;
	}

	prepareProjectionHandoff(): Promise<boolean> {
		if (this.disposed || !this.bridge) {
			return Promise.resolve(false);
		}
		if (!this.pendingProjectionHandoff) {
			this.pendingProjectionHandoff = this.doPrepareProjectionHandoff();
		}
		return this.pendingProjectionHandoff;
	}

	resumeAfterProjectionHandoff(): void {
		if (this.disposed) {
			return;
		}
		this.pendingProjectionHandoff = undefined;
		this.pendingPrepareToClose = undefined;
		this.setStructuralFrozen(false);
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
		const structural = options.structural === true;
		if (!this.bridge) {
			return !structural;
		}
		// A canvas-to-detail handoff can finish opening while its shared working
		// copy is still saving. That durable write remains part of this surface's
		// close contract even though the newly mounted webview is not dirty.
		if ((this.pendingProjectionSave || this.projectionSaveFailed) && !await this.ensureProjectionSaved()) {
			return false;
		}
		const coldFlushResult = baseHalfMarkdownRichColdFlushResult(this.editorReady, this.dirty);
		if (coldFlushResult !== undefined) {
			return coldFlushResult;
		}
		if (!baseHalfMarkdownRichNeedsSaveRequest(this.dirty, this.visible, options)) {
			return true;
		}
		if (structural && (!this.structuralFrozen || !await this.waitForStructuralFreeze())) {
			return false;
		}

		const requestId = `flush-${generateUuid()}`;
		return new Promise<boolean>(resolve => {
			const timer = mainWindow.setTimeout(() => {
				this.pendingFlushes.delete(requestId);
				resolve(false);
			}, 15000);
			const pending = { resolve, timer };
			this.pendingFlushes.set(requestId, pending);
			void this.bridge!.sendSave(requestId, {
				forceSerialize: options.forceSerialize ?? true,
				forceWrite: options.forceWrite ?? false,
				structural,
				handoff: false
			}).then(posted => {
				if (!posted && this.pendingFlushes.get(requestId) === pending) {
					this.pendingFlushes.delete(requestId);
					mainWindow.clearTimeout(timer);
					resolve(false);
				}
			}, () => {
				if (this.pendingFlushes.get(requestId) === pending) {
					this.pendingFlushes.delete(requestId);
					mainWindow.clearTimeout(timer);
					resolve(false);
				}
			});
		});
	}

	private async doPrepareToClose(): Promise<boolean> {
		this.setStructuralFrozen(true);
		if (!await this.waitForStructuralFreeze()) {
			if (!this.disposed) {
				this.pendingPrepareToClose = undefined;
				this.setStructuralFrozen(false);
			}
			return false;
		}
		if (this.pendingProjectionHandoff) {
			if (!await this.pendingProjectionHandoff || !await this.ensureProjectionSaved()) {
				if (!this.disposed) {
					this.pendingPrepareToClose = undefined;
					this.setStructuralFrozen(false);
				}
				return false;
			}
			return true;
		}
		if (!this.editorReady) {
			return true;
		}
		const saved = await this.flush({
			forceSerialize: true,
			forceWrite: false,
			rejectOnError: true,
			structural: true
		});
		if (!saved && !this.disposed) {
			this.pendingPrepareToClose = undefined;
			this.setStructuralFrozen(false);
		}
		return saved;
	}

	private async doPrepareProjectionHandoff(): Promise<boolean> {
		this.setStructuralFrozen(true);
		if (!await this.waitForStructuralFreeze()) {
			if (!this.disposed) {
				this.pendingPrepareToClose = undefined;
				this.setStructuralFrozen(false);
			}
			return false;
		}
		if (!this.editorReady) {
			return true;
		}

		const captured = await this.captureProjectionHandoff();
		if (!captured && !this.disposed) {
			this.pendingProjectionHandoff = undefined;
			this.setStructuralFrozen(false);
		}
		return captured;
	}

	private async captureProjectionHandoff(): Promise<boolean> {
		const bridge = this.bridge;
		if (!bridge) {
			return false;
		}
		const requestId = `handoff-${generateUuid()}`;
		return new Promise<boolean>(resolve => {
			const timer = mainWindow.setTimeout(() => {
				this.pendingFlushes.delete(requestId);
				resolve(false);
			}, 15000);
			const pending = { resolve, timer, handoff: true as const };
			this.pendingFlushes.set(requestId, pending);
			void bridge.sendSave(requestId, {
				forceSerialize: true,
				forceWrite: false,
				structural: true,
				handoff: true
			}).then(posted => {
				if (!posted && this.pendingFlushes.get(requestId) === pending) {
					this.pendingFlushes.delete(requestId);
					mainWindow.clearTimeout(timer);
					resolve(false);
				}
			}, () => {
				if (this.pendingFlushes.get(requestId) === pending) {
					this.pendingFlushes.delete(requestId);
					mainWindow.clearTimeout(timer);
					resolve(false);
				}
			});
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
			const nextState = baseHalfMarkdownRichFirstFrameAcknowledgement(this.firstFrameState, 'rendered');
			if (!this.editorReady && nextState === 'settling' && nextState !== this.firstFrameState) {
				this.firstFrameState = nextState;
				applyBaseHalfMarkdownRichFirstFrameState(this.container, this.webviewHost, 'settling');
			}
			return;
		}

		if (message.type === 'basehalf.markdownRich.focusBoundarySettled') {
			if (this.firstFrameState !== 'settling'
				|| baseHalfMarkdownRichFirstFrameAcknowledgement(this.firstFrameState, 'focusBoundarySettled') !== 'rendered') {
				return;
			}
			this.editorReady = true;
			this.flushPendingEditorCommands();
			const guardedInput = this.quickInputFocusGuard.target;
			const currentQuickInput = this.quickInputService.currentQuickInput;
			if (guardedInput && this.quickInputFocusGuard.owns(currentQuickInput, this.webviewGeneration)) {
				// Keep ownership guarded until the picker closes. Refocusing here is
				// unnecessary when the picker already owns focus and can move focus
				// into its temporarily disabled result list while providers load.
				this.firstFrameState = 'paused';
				applyBaseHalfMarkdownRichFirstFrameState(this.container, this.webviewHost, 'paused');
				return;
			}
			this.restoreGuardedQuickInput();
			if (currentQuickInput) {
				this.firstFrameState = 'paused';
				applyBaseHalfMarkdownRichFirstFrameState(this.container, this.webviewHost, 'paused');
				return;
			}
			this.settleFirstFrame('rendered');
			return;
		}

		if (await bridge.handleWebviewMessage(message)) {
			return;
		}

		switch (message.type) {
			case 'basehalf.markdownRich.formatStateChanged':
				this.handleFormatStateChanged(message.state);
				break;
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
			case 'basehalf.markdownRich.canvasCommand':
				if (this.surface === 'canvas') {
					if (message.command === 'focusToolbar') {
						this.options.onCanvasToolbarRequest?.();
					} else if (message.command === 'beginAuthoring') {
						this.options.onCanvasAuthoringRequest?.(message.point);
					} else {
						this.options.onCanvasExitRequest?.();
					}
				}
				break;
			case 'basehalf.markdownRich.fileSearch':
				await this.handleFileSearch(state, message.requestId, message.query);
				break;
			case 'basehalf.markdownRich.attachmentUpload':
				await this.handleAttachmentUpload(state, message.requestId, message.name, message.data);
				break;
			case 'basehalf.markdownRich.openResource':
				await this.handleOpenResource(state, message.href);
				break;
			case 'basehalf.markdownRich.openSource':
				// The escape hatch for passthrough blocks: reopen this card in
				// the source projection with the block's lines selected.
					await this.canvasNavigationService.openCardDetail(state.resource, {
						source: 'api',
						projection: 'source',
						selection: message.selection,
						pinned: state.pinned,
						history: 'replace'
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
		if (!webview || this.webviewService.activeWebview !== webview || !webview.isFocused) {
			return false;
		}
		return this.runEditorCommand(command);
	}

	private handleFormatStateChanged(state: IBaseHalfMarkdownRichFormatState): void {
		this.options.onFormatStateChange?.(state);
		if (!state.ready || !this.editorReady) {
			return;
		}
		this.flushPendingEditorCommands();
	}

	private flushPendingEditorCommands(): void {
		const bridge = this.bridge;
		if (!bridge || this.pendingEditorCommands.length === 0) {
			return;
		}
		const pending = this.pendingEditorCommands.splice(0);
		for (const command of pending) {
			void bridge.sendCommand(command).catch(error => this.logService.error(error));
		}
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

	private async handleAttachmentUpload(state: IBaseHalfCardDetailState, requestId: string, name: string, data: ArrayBuffer): Promise<void> {
		if (!this.isEditable() || this.structuralFrozen) {
			await this.bridge?.sendAttachmentResult(requestId, { error: 'This document is read-only.' });
			return;
		}
		if (data.byteLength > BASEHALF_MARKDOWN_ATTACHMENT_MAX_BYTES) {
			await this.bridge?.sendAttachmentResult(requestId, { error: `Files larger than ${BASEHALF_MARKDOWN_ATTACHMENT_MAX_BYTES / 1024 / 1024} MB cannot be inserted.` });
			return;
		}

		try {
			const stored = await this.attachmentService.store(state.resource, name, data);
			await this.bridge?.sendAttachmentResult(requestId, { url: stored.href });
		} catch (error) {
			this.logService.error('[BaseHalf] rich Markdown attachment write failed', error);
			await this.bridge?.sendAttachmentResult(requestId, { error: toErrorMessage(error) });
		}
	}

	private async handleOpenResource(state: IBaseHalfCardDetailState, href: string): Promise<void> {
		const path = href.split(/[?#]/, 1)[0];
		if (!path || path.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(path)) {
			return;
		}
		let decoded: string;
		try {
			decoded = decodeURIComponent(path);
		} catch {
			return;
		}
		const resource = joinPath(dirname(state.resource), decoded);
		if (!this.uriIdentityService.extUri.isEqualOrParent(resource, state.workspaceFolder)) {
			return;
		}
		await this.canvasNavigationService.openResource(resource, { source: 'api' });
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
		await this.bridge?.sendInit(state.resource.toString(), this.webviewBaseUri(state.resource), content, this.isEditable(), this.surface, state.selection);
		this.writeSelectionFocus(state);
		await this.sendAdhdState(state);
	}

	private webviewBaseUri(resource: URI): string {
		const directory = dirname(resource);
		return asWebviewUri(directory.with({ path: `${directory.path.replace(/\/$/, '')}/` })).toString(true);
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
		const pendingHandoff = this.pendingFlushes.get(message.requestId);
		if (pendingHandoff?.handoff) {
			await this.handleProjectionHandoff(message, model, bridge, pendingHandoff);
			return;
		}

		this.setSaveStatus('saving');
		this.writingTextModel++;
		this.pendingEditorSaveContents.add(message.content);
		try {
			const outcome = await this.coordinator.handleSaveRequested(
				message,
				new BaseHalfMarkdownRichTextModelDisk(model, this.textFileAdapter()),
				bridge
			);
			if (outcome.result === 'saved' || outcome.result === 'noop') {
				this.lastSentContent = outcome.content ?? model.getValue();
				this.lastAcceptedEditorContent = this.lastSentContent;
				this.dirty = false;
				if (!this.textFileService.isDirty(model.uri)) {
					this.projectionSaveFailed = false;
					if (this.documentKey) {
						markdownRichProjectionSaves.delete(this.documentKey);
					}
				}
			}
			const pending = this.pendingFlushes.get(message.requestId);
			if (pending) {
				this.pendingFlushes.delete(message.requestId);
				mainWindow.clearTimeout(pending.timer);
				pending.resolve(outcome.okToLeave);
			}
		} finally {
			this.pendingEditorSaveContents.delete(message.content);
			this.writingTextModel--;
			this.updateStatus();
		}
	}

	private async handleProjectionHandoff(
		message: BaseHalfMarkdownRichSaveRequestedMessage,
		model: ITextModel,
		bridge: BaseHalfMarkdownRichWebviewBridge,
		pending: { readonly resolve: (ok: boolean) => void; readonly timer: number; readonly handoff?: true }
	): Promise<void> {
		let ok = false;
		this.setSaveStatus('saving');
		this.writingTextModel++;
		try {
			const current = model.getValue();
			if (!message.forceWrite
				&& current !== message.previousContent
				&& current !== message.content
				&& current !== this.lastAcceptedEditorContent
				&& !this.pendingEditorSaveContents.has(current)) {
				await bridge.sendSaveResult(message.requestId, 'blockedByConflict', { disk: current });
				return;
			}
			if (current !== message.content) {
				model.pushEditOperations(null, [{
					range: model.getFullModelRange(),
					text: message.content
				}], () => null);
			}
			this.lastSentContent = message.content;
			this.lastAcceptedEditorContent = message.content;
			this.dirty = false;
			this.pendingProjectionSave = this.startProjectionSave(model);
			await bridge.sendSaveResult(message.requestId, current === message.content ? 'noop' : 'saved', { content: message.content });
			ok = true;
		} catch (error) {
			await bridge.sendSaveResult(message.requestId, 'writeFailed', { message: toErrorMessage(error) });
		} finally {
			this.writingTextModel--;
			if (this.pendingFlushes.get(message.requestId) === pending) {
				this.pendingFlushes.delete(message.requestId);
				mainWindow.clearTimeout(pending.timer);
				pending.resolve(ok);
			}
			this.updateStatus();
		}
	}

	private startProjectionSave(model: ITextModel): Promise<boolean> {
		if (this.textFileAdapter().isReadonly(model.uri) || !this.textFileService.isDirty(model.uri)) {
			this.projectionSaveFailed = false;
			return Promise.resolve(true);
		}
		const documentKey = this.documentKey;
		if (!documentKey) {
			return Promise.resolve(false);
		}
		const record: IBaseHalfMarkdownRichProjectionSave = { promise: Promise.resolve(false) };
		record.promise = this.textFileService.save(model.uri, { ignoreErrorHandler: true }).then(() => {
			const saved = !this.textFileService.isDirty(model.uri);
			if (!saved) {
				record.error = 'Changes could not be saved to disk.';
			}
			return saved;
		}, error => {
			record.error = toErrorMessage(error);
			this.logService.error(error);
			return false;
		}).then(saved => {
			if (markdownRichProjectionSaves.get(documentKey) === record) {
				if (saved) {
					markdownRichProjectionSaves.delete(documentKey);
				} else {
					this.projectionSaveFailed = true;
				}
			}
			if (!this.disposed && this.documentKey === documentKey) {
				this.updateStatus();
			}
			return saved;
		});
		markdownRichProjectionSaves.set(documentKey, record);
		return record.promise;
	}

	private async ensureProjectionSaved(): Promise<boolean> {
		if (this.pendingProjectionSave && await this.pendingProjectionSave) {
			return true;
		}
		const state = this.state;
		if (!state || this.textFileAdapter().isReadonly(state.resource) || !this.textFileService.isDirty(state.resource)) {
			this.projectionSaveFailed = false;
			return true;
		}
		const saved = await this.textFileService.save(state.resource, { ignoreErrorHandler: true }).then(
			() => !this.textFileService.isDirty(state.resource),
			error => {
				this.logService.error(error);
				return false;
			}
		);
		this.projectionSaveFailed = !saved;
		if (saved && this.documentKey) {
			markdownRichProjectionSaves.delete(this.documentKey);
		}
		return saved;
	}

	private observeProjectionSave(): void {
		const documentKey = this.documentKey;
		if (!documentKey) {
			return;
		}
		const record = markdownRichProjectionSaves.get(documentKey);
		if (!record) {
			return;
		}
		this.pendingProjectionSave = record.promise;
		void record.promise.then(saved => {
			if (this.disposed || this.documentKey !== documentKey) {
				return;
			}
			this.projectionSaveFailed = !saved;
			this.updateStatus();
		});
	}

	private handleModelContentChanged(): void {
		if (!this.model || this.writingTextModel > 0) {
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
		const state = this.state;
		if (!model || !state) {
			return;
		}
		const content = model.getValue();
		if (this.dirty || content === this.lastSentContent) {
			return;
		}

		this.lastSentContent = content;
		void this.bridge?.sendInit(model.uri.toString(), this.webviewBaseUri(model.uri), content, this.isEditable(), this.surface, state.selection);
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

		if (this.projectionSaveFailed && !this.textFileService.isDirty(model.uri)) {
			this.projectionSaveFailed = false;
			if (this.documentKey) {
				markdownRichProjectionSaves.delete(this.documentKey);
			}
		}

		if (this.projectionSaveFailed) {
			this.setSaveStatus('error');
			return;
		}

		if (!this.isEditable()) {
			this.setSaveStatus('saved');
			return;
		}

		this.setSaveStatus(this.dirty || this.textFileService.isDirty(model.uri) ? 'saving' : 'saved');
	}

	private setSaveStatus(status: 'saving' | 'saved' | 'error'): void {
		this.onSaveStatusChange(status);
	}

	private isEditable(): boolean {
		const model = this.model;
		if (!model) {
			return false;
		}
		return !this.textFileAdapter().isReadonly(model.uri)
			&& (this.surface !== 'canvas' || this.canvasAuthoring);
	}

	private get surface(): BaseHalfMarkdownRichSurface {
		return this.options.surface ?? 'detail';
	}

	private textFileAdapter(): IBaseHalfMarkdownRichTextFileService {
		return {
			isDirty: resource => this.textFileService.isDirty(resource),
			isReadonly: resource => !!this.textFileService.files.get(resource)?.isReadonly(),
			save: (resource, options) => this.textFileService.save(resource, options)
		};
	}

	private renderError(error: unknown): void {
		this.disposeWebviewGeneration();
		clearNode(this.webviewHost);

		if (error instanceof TooLargeFileOperationError) {
			this.renderNotice('The file is too large to open here.');
			this.setSaveStatus('saved');
			this.settleFirstFrame('error');
			return;
		}

		if (TextFileOperationError.isTextFileOperationError(error) && error.textFileOperationResult === TextFileOperationResult.FILE_IS_BINARY) {
			this.renderNotice('The file is not displayed here because it is either binary or uses an unsupported text encoding.');
			this.setSaveStatus('saved');
			this.settleFirstFrame('error');
			return;
		}

		this.logService.error('[BaseHalf] rich Markdown card detail failed to open', error);
		this.renderNotice(`Unable to open the file. ${toErrorMessage(error)}`);
		this.setSaveStatus('saved');
		this.settleFirstFrame('error');
	}

	private renderTimeout(): void {
		this.disposeWebviewGeneration();
		clearNode(this.webviewHost);
		this.renderNotice('The rich editor took too long to load. Close and reopen this card to try again.');
		this.setSaveStatus('saved');
		this.logService.error('[BaseHalf] rich Markdown card detail timed out before its first frame');
		this.settleFirstFrame('timeout');
	}

	private settleFirstFrame(state: 'rendered' | 'error' | 'timeout'): void {
		if (this.firstFrameState !== 'booting' && this.firstFrameState !== 'settling' && this.firstFrameState !== 'paused') {
			return;
		}
		this.firstFrameState = state;
		applyBaseHalfMarkdownRichFirstFrameState(this.container, this.webviewHost, state);
		this.firstRendered.complete();
	}

	private mountFirstFrameWebview(): void {
		const state = this.state;
		const documentKey = this.documentKey;
		if (this.disposed || this.webviewGeneration || !state || !documentKey || !this.model || !this.bridge) {
			return;
		}
		const action = baseHalfMarkdownRichColdGenerationAction(
			this.firstFrameState,
			this.editorReady,
			!!this.quickInputService.currentQuickInput
		);
		if (action === 'keep') {
			return;
		}
		if (action === 'pause') {
			this.firstFrameState = 'paused';
			applyBaseHalfMarkdownRichFirstFrameState(this.container, this.webviewHost, 'paused');
			return;
		}

		this.firstFrameState = 'booting';
		clearNode(this.webviewHost);
		applyBaseHalfMarkdownRichFirstFrameState(this.container, this.webviewHost, 'booting');
		const generation = new DisposableStore();
		this.webviewGeneration = generation;
		const webview = generation.add(createBaseHalfMarkdownRichWebviewElement(this.webviewService, state.relativePath || state.resource.path));
		this.webview = webview;
		webview.localResourcesRoot = [markdownRichMediaRoot, state.workspaceFolder];
		generation.add(webview.onMessage(event => {
			if (this.webviewGeneration === generation && this.webview === webview) {
				void this.handleWebviewMessage(event.message);
			}
		}));
		generation.add(webview.onMissingCsp(extension => {
			this.logService.warn(`BaseHalf Markdown rich webview missing CSP for ${extension.value}`);
		}));
		generation.add(webview.onFatalError(error => {
			if (this.webviewGeneration !== generation) {
				return;
			}
			if (!this.editorReady && (this.firstFrameState === 'booting' || this.firstFrameState === 'settling')) {
				this.renderError(new Error(error.message));
				return;
			}
			this.setSaveStatus('saving');
			this.logService.error(error.message);
		}));
		generation.add(webview.onDidFocus(() => {
			if (this.quickInputFocusGuard.owns(this.quickInputService.currentQuickInput, generation)) {
				this.quickInputService.focus();
			}
		}));
		const timer = mainWindow.setTimeout(() => {
			if (!this.disposed && !this.editorReady
				&& (this.firstFrameState === 'booting' || this.firstFrameState === 'settling')
				&& this.webviewGeneration === generation) {
				this.renderTimeout();
			}
		}, 10_000);
		generation.add(toDisposable(() => mainWindow.clearTimeout(timer)));
		webview.mountTo(this.webviewHost, mainWindow);
		webview.setHtml(baseHalfMarkdownRichWebviewHtml(documentKey));
		if (this.structuralFrozen) {
			this.postStructuralFreeze();
		}
	}

	private guardVisibleQuickInput(): void {
		const generation = this.webviewGeneration;
		const input = this.quickInputService.currentQuickInput;
		if (!baseHalfMarkdownRichShouldGuardQuickInput(this.visible, !!generation, !!input) || !generation || !input) {
			this.restoreGuardedQuickInput();
			return;
		}
		this.quickInputFocusGuard.guard(input, generation);
	}

	private restoreGuardedQuickInput(): void {
		this.quickInputFocusGuard.restore();
	}

	private scheduleFirstFrameWebviewResume(): void {
		if (this.disposed || this.editorReady || this.firstFrameResumeTimer !== undefined) {
			return;
		}
		this.firstFrameResumeTimer = mainWindow.setTimeout(() => {
			this.firstFrameResumeTimer = undefined;
			if (this.disposed || this.editorReady || this.quickInputService.currentQuickInput
				|| (this.firstFrameState !== 'booting' && this.firstFrameState !== 'settling' && this.firstFrameState !== 'paused')) {
				return;
			}
			this.mountFirstFrameWebview();
		}, 0);
	}

	private disposeWebviewGeneration(): void {
		this.restoreGuardedQuickInput();
		const generation = this.webviewGeneration;
		this.webviewGeneration = undefined;
		this.webview = undefined;
		generation?.dispose();
		// Any acknowledgement belonged to the disposed iframe generation. A
		// replacement replays the current freeze state with a fresh request id.
		this.settleStructuralFreeze(false);
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
