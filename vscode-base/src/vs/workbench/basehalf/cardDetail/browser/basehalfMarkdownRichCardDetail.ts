/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfCardDetailProjections.css';
import { $, addDisposableListener, append, EventType } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { DeferredPromise } from '../../../../base/common/async.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { dirname, isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { RedoCommand, SelectAllCommand, UndoCommand } from '../../../../editor/browser/editorExtensions.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IQuickInput, IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { ISearchService } from '../../../services/search/common/search.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { IWebviewService, IWebviewElement } from '../../../contrib/webview/browser/webview.js';
import { asWebviewUri } from '../../../contrib/webview/common/webview.js';
import { IBaseHalfCanvasNavigationService, IBaseHalfCardDetailState } from '../../navigation/common/basehalfCanvasNavigation.js';
import { BASEHALF_CARD_DETAIL_PANE_ID, IBaseHalfEditorFlushService } from '../../navigation/common/basehalfEditorFlush.js';
import { IBaseHalfWorkspaceMutationCoordinator, IBaseHalfWorkspaceResourceMutationStamp } from '../../workspace/common/basehalfWorkspaceMutation.js';
import { baseHalfMarkdownRichDocumentKey, IBaseHalfMarkdownRichLiveDocumentHandle } from '../../markdown/common/basehalfMarkdownRichLiveDocument.js';
import { BaseHalfMarkdownRichTextModelWriteGate, IBaseHalfMarkdownRichTextFileService } from '../../markdown/common/basehalfMarkdownRichTextModel.js';
import { baseHalfMarkdownRichBodiesDiffer } from '../../markdown/common/basehalfMarkdownRichSession.js';
import { BaseHalfMarkdownRichEditorCommand, BaseHalfMarkdownRichSurface, IBaseHalfMarkdownRichBox, IBaseHalfMarkdownRichFormatState, IBaseHalfMarkdownRichFocusPoint, isBaseHalfMarkdownRichWebviewMessage } from '../../markdown/common/basehalfMarkdownRichWebviewProtocol.js';
import { BaseHalfMarkdownRichWebviewBridge } from '../../markdown/common/basehalfMarkdownRichWebviewBridge.js';
import { IBaseHalfAdhdCommand } from '../../markdown/common/basehalfAdhd.js';
import { IBaseHalfAdhdDocumentOptions, IBaseHalfAdhdMirrorService } from '../../markdown/common/basehalfAdhdMirror.js';
import { BaseHalfSetting } from '../../shell/common/basehalfConfiguration.js';
import { IBaseHalfMarkdownAttachmentService } from '../../markdown/common/basehalfMarkdownAttachment.js';
import { baseHalfMarkdownFrontmatterLineCount } from '../../markdown/common/basehalfMarkdownProjection.js';
import { IBaseHalfAgentSelectionText } from '../../agentArea/common/basehalfAgentSelection.js';
import { baseHalfUserFacingErrorMessage } from '../../workspace/common/basehalfPlainFailureReason.js';
import { isBaseHalfZoomWheel } from '../common/basehalfCardDetailZoom.js';
import { localize } from '../../../../nls.js';
import { applyBaseHalfNoteMediaChoices, BaseHalfNoteMediaEditing } from './basehalfNoteMediaEditing.js';
import type { BaseHalfNoteMediaKind } from '../../mediaEdit/common/basehalfNoteMediaEdit.js';
import { IBaseHalfClipboardService } from '../../clipboard/common/basehalfClipboard.js';
import { baseHalfDragHoldsFilesItems } from '../../clipboard/browser/basehalfTransfer.js';
import { WebviewWindowDragMonitor } from '../../../contrib/webview/browser/webviewWindowDragMonitor.js';
import { BaseHalfMarkdownRichQuickInputFocusGuard, applyBaseHalfMarkdownRichFirstFrameState, baseHalfMarkdownRichFirstFrameAcknowledgement, BaseHalfMarkdownRichFirstFrameState } from './basehalfMarkdownRichWebviewPage.js';
import { markdownRichDocuments, markdownRichProjectionSaves } from './basehalfMarkdownRichShared.js';
import { BaseHalfMarkdownRichRequests } from './basehalfMarkdownRichRequests.js';
import { BaseHalfMarkdownRichSaving } from './basehalfMarkdownRichSaving.js';
import { BaseHalfMarkdownRichFirstFrame } from './basehalfMarkdownRichFirstFrame.js';

// The rich editor owns its edit history (the webview's collaboration undo
// manager), so workbench Undo/Redo must be delivered to it as an explicit
// editor command. This priority must outrank the generic webview
// implementation (priority 100), whose native-undo path mutates the
// contenteditable DOM behind the editor's transaction model.
const MARKDOWN_RICH_UNDO_REDO_PRIORITY = 110;

export interface IBaseHalfMarkdownRichCardDetailOptions {
	readonly surface?: BaseHalfMarkdownRichSurface;
	readonly canvasAuthoring?: boolean;
	readonly onFormatStateChange?: (state: IBaseHalfMarkdownRichFormatState) => void;
	readonly onCanvasToolbarRequest?: () => void;
	readonly onCanvasAuthoringRequest?: (point?: IBaseHalfMarkdownRichFocusPoint) => void;
	readonly onCanvasExitRequest?: () => void;
	/** Escape in the editor of Card Detail, which closes Card Detail (opening and closing Card Detail, "The keyboard"). */
	readonly onDetailCloseRequest?: () => void;
	/** The text the user selected, or `undefined` once nothing is (the selection agents can see). */
	readonly onSelectionChange?: (selected: IBaseHalfAgentSelectionText | undefined) => void;
}

export class BaseHalfMarkdownRichCardDetail extends Disposable {

	// The parts, one concern each; they reach this object as `detail`.
	/** What the editor's page asks of the workbench */
	readonly requests = new BaseHalfMarkdownRichRequests(this);
	/** What the editor wrote reaches the file */
	readonly saving = new BaseHalfMarkdownRichSaving(this);
	/** The editor's page, from its webview to its first frame */
	readonly firstFrame = new BaseHalfMarkdownRichFirstFrame(this);

	readonly webviewHost: HTMLElement;
	readonly pendingFlushes = new Map<string, { readonly resolve: (ok: boolean) => void; readonly timer: number; readonly handoff?: true }>();
	private pendingStructuralFreeze: { readonly requestId: string; readonly frozen: boolean; readonly promise: DeferredPromise<boolean>; readonly timer: number } | undefined;

	state: IBaseHalfCardDetailState | undefined;
	/** Structural stamp of the open resource. ADHD reading-aid commands run
	 *  as resource mutations against it, so a command issued after the file
	 *  moved or was deleted is refused instead of landing on a stale path. */
	private resourceStamp: IBaseHalfWorkspaceResourceMutationStamp | undefined;
	model: ITextModel | undefined;
	private resourceKey: string | undefined;
	documentKey: string | undefined;
	private liveDocument: IBaseHalfMarkdownRichLiveDocumentHandle | undefined;
	bridge: BaseHalfMarkdownRichWebviewBridge | undefined;
	/** The picture of the note whose editor stands over it, while it is edited (D113), and the layer it is drawn in. */
	readonly mediaEditing = this._register(new MutableDisposable<BaseHalfNoteMediaEditing>());
	private noteMediaLayer: HTMLElement | undefined;
	webview: IWebviewElement | undefined;
	dirty = false;
	lastSentContent: string | undefined;
	lastAcceptedEditorContent: string | undefined;
	/** Rich writes suppress the model listener; changes by others are replayed after them. */
	readonly modelWriteGate = new BaseHalfMarkdownRichTextModelWriteGate(() => this.handleModelContentChanged());
	disposed = false;
	visible = false;
	private pendingModelSync = false;
	/** The frontmatter line count of the model when ADHD state was last sent. */
	private adhdFrontmatterLines: number | undefined;
	structuralFrozen = false;
	private acknowledgedStructuralFrozen = false;
	editorReady = false;
	private readonly pendingEditorCommands: BaseHalfMarkdownRichEditorCommand[] = [];
	pendingPrepareToClose: Promise<boolean> | undefined;
	pendingProjectionHandoff: Promise<boolean> | undefined;
	projectionSaveFailed = false;
	private canvasAuthoring: boolean;
	readonly firstRendered = new DeferredPromise<void>();
	firstFrameState: BaseHalfMarkdownRichFirstFrameState = 'booting';
	webviewGeneration: DisposableStore | undefined;
	firstFrameResumeTimer: number | undefined;
	readonly quickInputFocusGuard = new BaseHalfMarkdownRichQuickInputFocusGuard<IQuickInput, DisposableStore>();

	constructor(
		public readonly container: HTMLElement,
		private readonly onEditorFocus: (() => void) | undefined,
		private readonly onSaveStatusChange: (status: 'saving' | 'saved' | 'error') => void,
		private readonly options: IBaseHalfMarkdownRichCardDetailOptions = {},
		@ITextModelService private readonly textModelService: ITextModelService,
		@ITextFileService public readonly textFileService: ITextFileService,
		@IWebviewService public readonly webviewService: IWebviewService,
		@IBaseHalfEditorFlushService private readonly editorFlushService: IBaseHalfEditorFlushService,
		@IBaseHalfWorkspaceMutationCoordinator private readonly workspaceMutationCoordinator: IBaseHalfWorkspaceMutationCoordinator,
		@IBaseHalfAdhdMirrorService private readonly adhdMirrorService: IBaseHalfAdhdMirrorService,
		@ICommandService public readonly commandService: ICommandService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ISearchService public readonly searchService: ISearchService,
		@IQuickInputService public readonly quickInputService: IQuickInputService,
		@IInstantiationService public readonly instantiationService: IInstantiationService,
		@IBaseHalfCanvasNavigationService private readonly canvasNavigationService: IBaseHalfCanvasNavigationService,
		@IBaseHalfMarkdownAttachmentService public readonly attachmentService: IBaseHalfMarkdownAttachmentService,
		@ILogService public readonly logService: ILogService,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService,
		@IBaseHalfClipboardService public readonly clipboardService: IBaseHalfClipboardService
	) {
		super();
		this.canvasAuthoring = this.surface !== 'canvas' || this.options.canvasAuthoring === true;

		const root = append(this.container, $('.basehalf-card-detail-markdown-rich'));
		this.webviewHost = append(root, $('.basehalf-card-detail-markdown-rich-webview'));
		if (this.surface === 'detail') {
			// The browser hands a pinch of the trackpad to the window, aimed at the
			// element of the page, not to the page that draws the note: the window
			// passes it on (zoom and outline of a note, rule 1).
			this._register(addDisposableListener(this.webviewHost, EventType.MOUSE_WHEEL, (event: WheelEvent) => {
				if (!isBaseHalfZoomWheel(event, isMacintosh)) {
					return;
				}
				// While a picture is edited the note keeps its size: a pinch over the picture is the editor's.
				if (this.mediaEditing.value) {
					event.preventDefault();
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				// The point in the page is measured from the frame the pinch is aimed
				// at: the element that holds it can be scrolled a few pixels, as
				// focus moves in it, and the frame with it (zoom and outline of a
				// note, rule 2).
				const target = event.target as HTMLElement | null;
				const box = (target?.tagName === 'IFRAME' ? target : this.webviewHost).getBoundingClientRect();
				void this.bridge?.sendZoomGesture({ deltaY: event.deltaY, deltaMode: event.deltaMode, x: event.clientX - box.left, y: event.clientY - box.top });
			}, { passive: false }));
		}
		// A drag that starts in the window, as from Files, reaches the page's
		// element and not the page, as a drag of files from another app that the
		// page lets through: the window reads them with their paths, links the
		// items of the workspace where they are, and clones the files from
		// elsewhere into the note's folder (files in notes, rules 12, 14, and 15).
		this._register(new WebviewWindowDragMonitor(mainWindow, () => this.webview));
		this._register(addDisposableListener(this.webviewHost, EventType.DRAG_OVER, (event: DragEvent) => {
			if (this.requests.takesDrag(event)) {
				event.preventDefault();
				event.stopPropagation();
				event.dataTransfer!.dropEffect = baseHalfDragHoldsFilesItems(event.dataTransfer) ? 'link' : 'copy';
				// The page shows where they would go, as it does for a drag it holds itself.
				this.requests.showDragPoint(this.requests.pagePoint(event.clientX, event.clientY));
			}
		}));
		this._register(addDisposableListener(this.webviewHost, EventType.DRAG_LEAVE, (event: DragEvent) => {
			if (!(event.relatedTarget instanceof Node && this.webviewHost.contains(event.relatedTarget))) {
				this.requests.showDragPoint(undefined);
			}
		}));
		this._register(addDisposableListener(this.webviewHost, EventType.DROP, (event: DragEvent) => {
			if (this.requests.takesDrag(event)) {
				event.preventDefault();
				event.stopPropagation();
				this.requests.showDragPoint(undefined);
				void this.requests.handleDrop(event.dataTransfer!, event.clientX, event.clientY);
			}
		}));
		applyBaseHalfMarkdownRichFirstFrameState(this.container, this.webviewHost, 'booting');
		this.setSaveStatus('saving');
		this._register(this.quickInputService.onShow(() => {
			this.firstFrame.guardVisibleQuickInput();
		}));
		this._register(this.quickInputService.onHide(() => {
			this.firstFrame.restoreGuardedQuickInput();
			if (this.editorReady && this.firstFrameState === 'paused') {
				this.firstFrame.settleFirstFrame('rendered');
			} else if (!this.webviewGeneration) {
				this.firstFrame.scheduleFirstFrameWebviewResume();
			}
		}));

		this._register(addDisposableListener(root, EventType.KEY_DOWN, event => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
				event.preventDefault();
				event.stopPropagation();
				void this.saving.flush({ forceSerialize: true, forceWrite: false });
			}
		}));
	}

	async open(state: IBaseHalfCardDetailState): Promise<void> {
		this.state = state;
		this.resourceStamp = this.workspaceMutationCoordinator.captureResource(state.workspaceFolder, state.relativePath);
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
			this.saving.observeProjectionSave();

			this.liveDocument = this._register(markdownRichDocuments.acquire(this.documentKey));
			this.bridge = this._register(new BaseHalfMarkdownRichWebviewBridge(this.documentKey, this.liveDocument.document.doc, {
				postMessage: (message, transfer) => this.webview?.postMessage(message, transfer) ?? Promise.resolve(false)
			}));
			this.firstFrame.mountFirstFrameWebview();

			this._register(UndoCommand.addImplementation(MARKDOWN_RICH_UNDO_REDO_PRIORITY, 'basehalfMarkdownRich', () => this.dispatchEditorCommand('undo')));
			this._register(RedoCommand.addImplementation(MARKDOWN_RICH_UNDO_REDO_PRIORITY, 'basehalfMarkdownRich', () => this.dispatchEditorCommand('redo')));
			// Select All selects every block of the note, also fixed blocks at its ends, which the page's own Select All of text leaves out (note formats, rule 71a).
			this._register(SelectAllCommand.addImplementation(MARKDOWN_RICH_UNDO_REDO_PRIORITY, 'basehalfMarkdownRich', () => this.dispatchEditorCommand('selectAll')));

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
			this._register(this.editorFlushService.registerPaneFlusher(BASEHALF_CARD_DETAIL_PANE_ID, options => this.saving.flush(options)));
			this._register(this.editorFlushService.registerDocumentFlusher(this.documentKey, options => this.saving.flush(options)));
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
			this.firstFrame.renderError(error);
		}
	}

	override dispose(): void {
		this.disposed = true;
		if (this.firstFrameResumeTimer !== undefined) {
			mainWindow.clearTimeout(this.firstFrameResumeTimer);
			this.firstFrameResumeTimer = undefined;
		}
		this.firstFrame.disposeWebviewGeneration();
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
	 * selection.
	 */
	activate(state: IBaseHalfCardDetailState): void {
		this.state = state;
		if (state.selection) {
			void this.bridge?.sendRevealSelection(state.selection);
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
			this.firstFrame.guardVisibleQuickInput();
		} else {
			this.firstFrame.restoreGuardedQuickInput();
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

	/** Gives the editor the keyboard: at `point`, or where its caret is. */
	focus(point?: IBaseHalfMarkdownRichFocusPoint): void {
		this.webview?.focus();
		void (point ? this.bridge?.sendFocusAtPoint(point) : this.bridge?.sendFocus())?.catch(error => this.logService.error(error));
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
			return this.saving.ensureProjectionSaved();
		}
		if (!this.bridge) {
			return Promise.resolve(true);
		}
		if (!this.pendingPrepareToClose) {
			this.pendingPrepareToClose = this.saving.doPrepareToClose();
		}
		return this.pendingPrepareToClose;
	}

	prepareProjectionHandoff(): Promise<boolean> {
		if (this.disposed || !this.bridge) {
			return Promise.resolve(false);
		}
		if (!this.pendingProjectionHandoff) {
			this.pendingProjectionHandoff = this.saving.doPrepareProjectionHandoff();
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
		this.updateStatus();
	}

	async handleWebviewMessage(message: unknown): Promise<void> {
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
			this.firstFrame.restoreGuardedQuickInput();
			if (currentQuickInput) {
				this.firstFrameState = 'paused';
				applyBaseHalfMarkdownRichFirstFrameState(this.container, this.webviewHost, 'paused');
				return;
			}
			this.firstFrame.settleFirstFrame('rendered');
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
				await this.saving.handleSaveRequested(message, model);
				break;
			case 'basehalf.markdownRich.dirtyChanged':
				this.dirty = message.dirty;
				this.updateStatus();
				break;
			case 'basehalf.markdownRich.editorActivated':
				this.onEditorFocus?.();
				break;
			case 'basehalf.markdownRich.workbenchCommand':
				await this.requests.handleWorkbenchCommand(message.command);
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
				} else if (message.command === 'exitEditor') {
					this.options.onDetailCloseRequest?.();
				}
				break;
			case 'basehalf.markdownRich.fileSearch':
				await this.requests.handleFileSearch(state, message.requestId, message.query);
				break;
			case 'basehalf.markdownRich.attachmentUpload':
				await this.requests.handleAttachmentUpload(state, message.requestId, message.name, message.mediaType, message.data);
				break;
			case 'basehalf.markdownRich.itemsRequest':
				await this.requests.handleItemsRequest(state, message.requestId, message.source, message.uris, message.files);
				break;
			case 'basehalf.markdownRich.openResource':
				await this.requests.handleOpenResource(state, message.href);
				break;
			case 'basehalf.markdownRich.copiedFiles':
				await this.requests.handleCopiedFiles(state, message.uris, message.text, message.mark);
				break;
			case 'basehalf.markdownRich.writeWarning':
				this.logService.warn(`[basehalf] A block of ${state.resource.toString()} was saved without its formats: ${message.message}`, message.blockId, message.block, message.stack);
				break;
			case 'basehalf.markdownRich.clipboard':
				// The same as the keys: the page's own copy, cut, or paste, with all that the clipboard holds.
				this.webview?.[message.action]();
				break;
			case 'basehalf.markdownRich.editMedia':
				await this.editMedia(state, message);
				break;
			case 'basehalf.markdownRich.mediaLaidOut':
				if (this.mediaEditing.value?.target.blockId === message.blockId) {
					this.mediaEditing.value.laidOut(message.box && this.boxInLayer(message.box));
				}
				break;
			case 'basehalf.markdownRich.mediaShown':
				// The note shows the picture again: its editor goes, and the keyboard it had goes back to the note.
				if (this.mediaEditing.value?.target.blockId === message.blockId) {
					const active = this.webviewHost.ownerDocument.activeElement;
					const hadKeyboard = !active || active === this.webviewHost.ownerDocument.body || !!active.closest('.basehalf-note-media-stage');
					this.mediaEditing.clear();
					if (hadKeyboard) {
						this.focus();
					}
				}
				break;
			case 'basehalf.markdownRich.endMediaEdit':
				await this.mediaEditing.value?.end();
				break;
			case 'basehalf.markdownRich.applyMediaChoices': {
				// The note's undo or redo of an edit of a picture: the file gets the choices, and Rich shows its version.
				const version = await this.instantiationService.invokeFunction(accessor => applyBaseHalfNoteMediaChoices(accessor, state.resource, message.href, message.choices));
				if (version) {
					void this.bridge?.sendMediaVersion(message.href, version);
				}
				break;
			}
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
			case 'basehalf.markdownRich.selectionChanged':
				this.options.onSelectionChange?.(this.selectedText(state, model, message.text, message.startLineNumber, message.endLineNumber));
				break;
			case 'basehalf.markdownRich.error':
				this.setSaveStatus('saving');
				this.logService.error(message.stack ?? message.message);
				break;
		}
	}

	/** The selection as the webview reports it, its lines already narrowed there. */
	private selectedText(state: IBaseHalfCardDetailState, model: ITextModel, text: string, startLineNumber: number | undefined, endLineNumber: number | undefined): IBaseHalfAgentSelectionText | undefined {
		if (text.trim().length === 0 || startLineNumber === undefined || endLineNumber === undefined) {
			return undefined;
		}
		// The webview counts what a save would write; the file can lag behind it.
		const lineCount = Math.max(model.getLineCount(), endLineNumber);
		return { path: state.relativePath, text, firstLine: Math.min(startLineNumber, lineCount), lastLine: Math.min(Math.max(startLineNumber, endLineNumber), lineCount) };
	}

	postStructuralFreeze(): void {
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

	async waitForStructuralFreeze(): Promise<boolean> {
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

	settleStructuralFreeze(ok: boolean): void {
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

	private runAdhdCommand(state: IBaseHalfCardDetailState, command: IBaseHalfAdhdCommand) {
		const stamp = this.resourceStamp;
		if (!stamp) {
			return Promise.reject(new Error('The card detail resource is no longer current.'));
		}
		// Read spans from the webview are body-relative lines.
		const options = this.adhdDocumentOptions();
		return this.workspaceMutationCoordinator.runResourceMutation(state.workspaceFolder, stamp, lease => {
			switch (command.command) {
				case 'addKeyword':
					return this.adhdMirrorService.addKeyword(state, command.keyword, lease, options);
				case 'removeKeyword':
					return this.adhdMirrorService.removeKeyword(state, command.keyword, lease, options);
				case 'markRead':
					return this.adhdMirrorService.markRead(state, command.start, command.end, lease, options);
				case 'markUnread':
					return this.adhdMirrorService.markUnread(state, command.start, command.end, lease, options);
			}
		});
	}

	private async sendDocumentState(state: IBaseHalfCardDetailState): Promise<void> {
		const content = this.lastSentContent ?? this.model?.getValue() ?? '';
		const reading = this.surface === 'detail' ? { reducedMotion: this.accessibilityService.isMotionReduced() } : undefined;
		await this.bridge?.sendInit(state.resource.toString(), this.webviewBaseUri(state.resource), content, this.isEditable(), this.surface, state.selection, reading);
		await this.sendAdhdState(state);
	}

	private webviewBaseUri(resource: URI): string {
		const directory = dirname(resource);
		return asWebviewUri(directory.with({ path: `${directory.path.replace(/\/$/, '')}/` })).toString(true);
	}

	private async sendAdhdState(state: IBaseHalfCardDetailState): Promise<void> {
		const readingModeEnabled = this.isReadingModeEnabled(state);
		if (!readingModeEnabled) {
			await this.bridge?.sendAdhdState({ readingModeEnabled, adhd: null });
			return;
		}

		try {
			const options = this.adhdDocumentOptions();
			this.adhdFrontmatterLines = options.frontmatterLines;
			const adhd = await this.adhdMirrorService.readAdhd(state, options);
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

	private handleModelContentChanged(): void {
		if (!this.model || !this.modelWriteGate.acceptChange()) {
			return;
		}

		this.updateStatus();
		this.refreshAdhdOnFrontmatterChange();
		if (!this.visible) {
			// Reconciled once in setVisible(true).
			this.pendingModelSync = true;
			return;
		}
		this.forwardModelContent();
	}

	/**
	 * Read ranges are body-relative, so a frontmatter change never moves them.
	 * An `adhd.yaml` from an earlier release is converted against the current
	 * frontmatter line count, and a reference operation may have just persisted
	 * that conversion: resend the reading aids when the count changes.
	 */
	private refreshAdhdOnFrontmatterChange(): void {
		const state = this.state;
		if (!state || this.adhdFrontmatterLines === undefined || !this.isReadingModeEnabled(state)) {
			return;
		}
		if (this.adhdDocumentOptions().frontmatterLines !== this.adhdFrontmatterLines) {
			void this.sendAdhdState(state);
		}
	}

	private adhdDocumentOptions(): IBaseHalfAdhdDocumentOptions {
		return this.model ? { frontmatterLines: baseHalfMarkdownFrontmatterLineCount(this.model.getValue()) } : {};
	}

	private forwardModelContent(): void {
		const model = this.model;
		const state = this.state;
		if (!model || !state) {
			return;
		}
		const content = model.getValue();
		if (content === this.lastSentContent) {
			return;
		}
		// Local rich edits keep their body; a body divergence is the save
		// conflict path's job. A frontmatter-only change leaves the body alone,
		// so a dirty editor still adopts it.
		if (this.dirty && (this.lastSentContent === undefined || baseHalfMarkdownRichBodiesDiffer(content, this.lastSentContent))) {
			return;
		}

		this.lastSentContent = content;
		void this.bridge?.sendInit(model.uri.toString(), this.webviewBaseUri(model.uri), content, this.isEditable(), this.surface, state.selection);
	}

	private updateEditable(): void {
		void this.bridge?.sendEditable(this.isEditable()).catch(error => this.logService.error(error));
	}

	updateStatus(): void {
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

	setSaveStatus(status: 'saving' | 'saved' | 'error'): void {
		this.onSaveStatusChange(status);
	}

	isEditable(): boolean {
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

	textFileAdapter(): IBaseHalfMarkdownRichTextFileService {
		return {
			isDirty: resource => this.textFileService.isDirty(resource),
			isReadonly: resource => !!this.textFileService.files.get(resource)?.isReadonly(),
			save: (resource, options) => this.textFileService.save(resource, options)
		};
	}

	/**
	 * Edit of a picture's toolbar (D113): the picture's editor over the
	 * picture, in a layer over Rich's page. A picture that BaseHalf cannot edit
	 * ends at once, and Rich closes the room it made.
	 */
	private async editMedia(state: IBaseHalfCardDetailState, message: { readonly blockId: string; readonly kind: BaseHalfNoteMediaKind; readonly href: string; readonly box: IBaseHalfMarkdownRichBox; readonly time?: number }): Promise<void> {
		await this.mediaEditing.value?.end();
		const { blockId, kind, href, box, time } = message;
		const editing = this.instantiationService.createInstance(BaseHalfNoteMediaEditing, {
			note: state.resource,
			blockId,
			kind,
			href,
			box: this.boxInLayer(box),
			...(time !== undefined ? { time } : {}),
		}, {
			layer: this.mediaLayer(),
			ended: (ended, version, step, at) => void this.bridge?.sendMediaEditEnded(ended, version, step && { before: { ...step.before }, after: { ...step.after } }, at),
			hide: hidden => void this.bridge?.sendHideMedia(hidden),
			show: shown => void this.bridge?.sendShowMedia(shown),
		});
		this.mediaEditing.value = editing;
		if (!await editing.start() && this.mediaEditing.value === editing) {
			this.mediaEditing.clear();
			void this.bridge?.sendMediaEditEnded(blockId, undefined);
		}
	}

	/** The layer over Rich's page in which the editor of a picture, a video, or a sound of the note is drawn. */
	private mediaLayer(): HTMLElement {
		if (!this.noteMediaLayer || this.noteMediaLayer.parentElement !== this.webviewHost) {
			this.noteMediaLayer = append(this.webviewHost, $('.basehalf-card-detail-note-media-layer'));
		}
		return this.noteMediaLayer;
	}

	/** A box that Rich measured in the frame of its page, in the layer over the page. */
	private boxInLayer(box: IBaseHalfMarkdownRichBox): IBaseHalfMarkdownRichBox {
		const frame = [...this.webviewHost.children].find(child => child.tagName === 'IFRAME')?.getBoundingClientRect();
		const origin = this.mediaLayer().getBoundingClientRect();
		const shift = frame ? { x: frame.left - origin.left, y: frame.top - origin.top } : { x: 0, y: 0 };
		return { left: box.left + shift.x, top: box.top + shift.y, width: box.width, height: box.height };
	}

	renderNotice(message: string): void {
		const notice = append(this.webviewHost, $('.basehalf-card-detail-source-notice'));
		notice.textContent = message;
	}
}

/** Reading aids fail only when the file system refuses the read or write. */
function adhdErrorMessage(error: unknown): string {
	return localize('basehalf.adhd.readingAidsFailed', "Reading aids could not be loaded or saved: {0}", baseHalfUserFacingErrorMessage(error));
}
