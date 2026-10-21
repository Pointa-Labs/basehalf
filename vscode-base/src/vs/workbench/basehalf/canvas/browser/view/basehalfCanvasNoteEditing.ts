/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import '../media/basehalfCanvasNoteEditor.css';
import { $, append, clearNode, isHTMLElement } from '../../../../../base/browser/dom.js';
import { DeferredPromise, RunOnceScheduler } from '../../../../../base/common/async.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { IBaseHalfCanvasItem } from '../../common/basehalfCanvasModel.js';
import { IBaseHalfActiveCanvasEditor, IBaseHalfCanvasFolderState, IBaseHalfCardDetailState } from '../../../navigation/common/basehalfCanvasNavigation.js';
import {
	baseHalfCanvasNoteFormatOwnerKey,
	baseHalfCanvasNoteFormatOwnersEqual,
	baseHalfCanvasNoteFormatCommandOutcome,
	baseHalfCanvasNoteMountRequestsFocus,
	baseHalfCanvasNotePrepareIdentityBoundClose,
	BaseHalfCanvasNoteFormatNavigationOwnership,
	IBaseHalfCanvasNoteFormatOwner
} from '../../common/basehalfCanvasNoteFormatLifecycle.js';
import {
	baseHalfCanvasMarkdownEditTarget,
	baseHalfCanvasMarkdownPreviewSource,
	baseHalfCanvasMarkdownSourceFitsInline,
	baseHalfCanvasMarkdownSourceFitsShown,
	BASEHALF_CANVAS_NOTE_SHOWN_MAX_BYTES
} from '../../common/basehalfCanvasPreview.js';
import { isBaseHalfMarkdownResource } from '../../../cardDetail/common/basehalfCardDetail.js';
import { applyBaseHalfCanvasMarkdownSidewaysScroll, BaseHalfCanvasMarkdownInlineEditor, BaseHalfCanvasMarkdownRequiresRichEditorError, IBaseHalfCanvasMarkdownInlineSelection, readBaseHalfCanvasMarkdownSidewaysScroll } from '../basehalfCanvasMarkdownInlineEditor.js';
import { buildAllBaseHalfCanvasNoteParts, buildBaseHalfCanvasNotePartsTo } from '../basehalfCanvasNoteParts.js';
import {
	BaseHalfCanvasNoteBackground,
	BASEHALF_CANVAS_NOTE_FORMAT_STATE_EVENT,
	BASEHALF_CANVAS_NOTE_TOOLBAR_FOCUS_EVENT,
	IBaseHalfCanvasNoteEditPoint,
	IBaseHalfCanvasNoteFormatState
} from '../../common/basehalfCanvasScene.js';
import type { BaseHalfMarkdownFormatCommand } from '../../../markdown/common/basehalfMarkdownFormatting.js';
import type { BaseHalfCanvasWorkbenchContribution } from '../basehalfCanvasWorkbench.contribution.js';
import { CANVAS_MARKDOWN_FULL_EDITOR_LABEL, IBaseHalfActiveCanvasNoteEditor, IBaseHalfCanvasNotePreviewMount, IBaseHalfCanvasPostCreateOwner, IBaseHalfPendingCanvasNoteFocus, IBaseHalfPendingCanvasNoteFormatCommand, IBaseHalfPendingCanvasNoteNavigationGuard, appendCanvasNoteFullEditorLabel } from './basehalfCanvasViewShared.js';

interface IBaseHalfPendingMarkdownRichFormatCommand {
	readonly resourceKey: string;
	readonly command: BaseHalfMarkdownFormatCommand;
}

/**
 * Editing a note on its card: opening and closing the card editor, its format
 * commands and the navigation they hold back, and focusing a note the user
 * just created.
 *
 * A part of the canvas view (README.md in this folder): it keeps its own state,
 * and reaches the state the view shares and the other parts through `view`.
 */
export class BaseHalfCanvasNoteEditing {
	/** The note editor reports every change of its selection; its text is read once they settle. */
	private readonly agentSelectionCardTextReader = this.view.register(new RunOnceScheduler(() => {
		this.view.agentSelectionCardText = this.view.activeCanvasNoteEditor?.instance.getSelectedText();
		this.view.selectionActions.reportAgentSelection();
	}, 30));
	private readonly canvasNoteSelections = new Map<string, IBaseHalfCanvasMarkdownInlineSelection>();
	private readonly canvasNoteEditPoints = new Map<string, IBaseHalfCanvasNoteEditPoint>();
	private readonly pendingMarkdownRichFormatCommands: IBaseHalfPendingMarkdownRichFormatCommand[] = [];
	private pendingCanvasNoteFormatDrain: { readonly active: IBaseHalfActiveCanvasNoteEditor; readonly promise: Promise<void> } | undefined;

	constructor(private readonly view: BaseHalfCanvasWorkbenchContribution) { }

	async prepareSceneNoteSelectionChange(sceneKey: string, structuralEpoch: number, paths: readonly string[]): Promise<boolean> {
		const folder = this.view.getCurrentFolder();
		if (!folder || this.view.sceneKey(folder) !== sceneKey
			|| !this.view.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, this.view.sceneMutationStamp(folder, structuralEpoch))) {
			return false;
		}
		const notePath = this.view.canvasNoteSurfacePath ?? this.view.activeCanvasNoteEditor?.path;
		const changesNote = notePath !== undefined && !(paths.length === 1 && paths[0] === notePath);
		if (!changesNote) {
			return true;
		}
		const activeBeforeWait = this.view.activeCanvasNoteEditor;
		const noteItem = this.view.renderedItemsByPath.get(notePath);
		const resourceKey = activeBeforeWait?.path === notePath && activeBeforeWait.sceneKey === sceneKey
			? activeBeforeWait.resourceKey
			: noteItem && isBaseHalfMarkdownResource(noteItem.stat.resource)
				? this.view.uriIdentityService.extUri.getComparisonKey(noteItem.stat.resource)
				: undefined;
		if (resourceKey) {
			if (!await this.waitForCanvasNoteFormatCommands(sceneKey, notePath, resourceKey)) {
				return false;
			}
		}
		const currentFolder = this.view.getCurrentFolder();
		if (!currentFolder || this.view.sceneKey(currentFolder) !== sceneKey
			|| !this.view.workspaceMutationCoordinator.isStampCurrent(currentFolder.workspaceFolder, this.view.sceneMutationStamp(currentFolder, structuralEpoch))) {
			return false;
		}
		const active = this.view.activeCanvasNoteEditor;
		if (active) {
			if (paths.length === 1 && paths[0] === active.path) {
				return true;
			}
			return this.closeActiveCanvasNoteEditorAfterFormats();
		}
		if (this.view.canvasNoteSurfacePath === notePath) {
			this.clearPendingCanvasNoteFocus(notePath);
			this.view.canvasNoteSurfacePath = undefined;
			this.view.requestRender();
		}
		return true;
	}

	async beginSceneNoteEdit(
		sceneKey: string,
		structuralEpoch: number,
		path: string,
		point?: IBaseHalfCanvasNoteEditPoint,
		acceptedFormatOwner?: IBaseHalfCanvasNoteFormatOwner
	): Promise<void> {
		this.view.selectionActions.cancelPendingNodeActivation();
		const folder = this.view.getCurrentFolder();
		const item = this.view.renderedItemsByPath.get(path);
		if (!folder || this.view.canvasNavigationService.state.cardDetail || !item
			|| !isBaseHalfMarkdownResource(item.stat.resource)
			|| this.view.sceneKey(folder) !== sceneKey) {
			return;
		}
		if (!acceptedFormatOwner) {
			this.view.markCanvasUserInteraction();
		}
		const resourceKey = this.view.uriIdentityService.extUri.getComparisonKey(item.stat.resource);
		const owner = { sceneKey, path, resourceKey };
		if (acceptedFormatOwner
			? !baseHalfCanvasNoteFormatOwnersEqual(acceptedFormatOwner, owner)
			: !this.view.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, this.view.sceneMutationStamp(folder, structuralEpoch))) {
			return;
		}
		const markdownPreview = this.view.cardRenderer.shownMarkdownPreview(path);
		if (baseHalfCanvasMarkdownEditTarget(item.stat.size, markdownPreview) === 'richDetail') {
			// Formatting requests are already owned by the pending inline-command
			// lifecycle and must not wait on themselves through openSceneCard.
			if (!acceptedFormatOwner) {
				await this.view.selectionActions.openSceneCard(sceneKey, structuralEpoch, path);
			}
			return;
		}
		const remainsCurrent = (): boolean => {
			const currentFolder = this.view.getCurrentFolder();
			const currentItem = this.view.renderedItemsByPath.get(path);
			if (!currentFolder
				|| this.view.canvasNavigationService.state.cardDetail
				|| !currentItem
				|| !isBaseHalfMarkdownResource(currentItem.stat.resource)
				|| !this.view.uriIdentityService.extUri.isEqual(currentItem.stat.resource, item.stat.resource)
				|| this.view.sceneKey(currentFolder) !== sceneKey) {
				return false;
			}
			return acceptedFormatOwner
				? baseHalfCanvasNoteFormatOwnersEqual(acceptedFormatOwner, {
					sceneKey,
					path,
					resourceKey: this.view.uriIdentityService.extUri.getComparisonKey(currentItem.stat.resource)
				})
				: this.view.workspaceMutationCoordinator.isStampCurrent(currentFolder.workspaceFolder, this.view.sceneMutationStamp(currentFolder, structuralEpoch));
		};
		const active = this.view.activeCanvasNoteEditor;
		const rememberedSelection = point ? undefined : this.canvasNoteSelections.get(resourceKey);
		const rememberedPoint = point ?? (rememberedSelection ? undefined : this.canvasNoteEditPoints.get(resourceKey));
		const focus = baseHalfCanvasNoteMountRequestsFocus(acceptedFormatOwner ? 'format' : 'edit');
		if (!focus) {
			this.view.canvasNoteFocusLeaseOwner.revoke();
		}
		const focusLocation = {
			path,
			...(rememberedPoint ? { point: rememberedPoint } : {}),
			...(rememberedSelection ? { selection: rememberedSelection } : {})
		};
		const pendingFocus: IBaseHalfPendingCanvasNoteFocus = focus
			? { ...focusLocation, focus: true, lease: this.view.canvasNoteFocusLeaseOwner.claim() }
			: { ...focusLocation, focus: false };
		if (active?.path === path
			&& active.sceneKey === sceneKey
			&& this.view.uriIdentityService.extUri.isEqual(active.state.resource, item.stat.resource)) {
			this.view.canvasNoteSurfacePath = path;
			active.card.dataset.noteEditing = 'true';
			if (active.closing) {
				const closed = await active.closing;
				if (!closed) {
					if (this.view.activeCanvasNoteEditor === active) {
						this.focusCanvasNoteEditorFromIntent(active, pendingFocus);
					} else {
						this.releaseCanvasNoteFocusIntent(pendingFocus);
					}
					return;
				}
				// Multiple callers may await the same close. Retire identity-safely here
				// as well so a rapid second double click cannot race the original closer
				// and lose the re-open request between promise settlement and teardown.
				if (this.view.activeCanvasNoteEditor === active) {
					this.retireActiveCanvasNoteEditor(active, false);
				}
				if (remainsCurrent()) {
					this.view.canvasNoteSurfacePath = path;
					this.view.pendingCanvasNoteFocus = pendingFocus;
					this.tryMountCanvasNoteEditor(path);
					this.view.requestRender();
				} else {
					this.releaseCanvasNoteFocusIntent(pendingFocus);
				}
				return;
			}
			await active.open.catch(() => undefined);
			if (this.view.activeCanvasNoteEditor === active && !active.closing && remainsCurrent()) {
				this.focusCanvasNoteEditorFromIntent(active, pendingFocus);
			} else {
				this.releaseCanvasNoteFocusIntent(pendingFocus);
			}
			return;
		}
		if (!await this.closeActiveCanvasNoteEditor(false) || !remainsCurrent()) {
			this.releaseCanvasNoteFocusIntent(pendingFocus);
			return;
		}
		this.view.canvasNoteSurfacePath = path;
		this.view.pendingCanvasNoteFocus = pendingFocus;
		this.tryMountCanvasNoteEditor(path);
		this.view.requestRender();
	}

	rememberSceneNoteEditPoint(sceneKey: string, structuralEpoch: number, path: string, point: IBaseHalfCanvasNoteEditPoint): void {
		const folder = this.view.getCurrentFolder();
		const item = this.view.renderedItemsByPath.get(path);
		if (!folder || !item || !isBaseHalfMarkdownResource(item.stat.resource)
			|| this.view.sceneKey(folder) !== sceneKey
			|| !this.view.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, this.view.sceneMutationStamp(folder, structuralEpoch))) {
			return;
		}
		const resourceKey = this.view.uriIdentityService.extUri.getComparisonKey(item.stat.resource);
		this.canvasNoteEditPoints.set(resourceKey, point);
		this.canvasNoteSelections.delete(resourceKey);
	}

	async formatSceneNote(sceneKey: string, structuralEpoch: number, path: string, command: BaseHalfMarkdownFormatCommand): Promise<void> {
		const folder = this.view.getCurrentFolder();
		const item = this.view.renderedItemsByPath.get(path);
		if (!folder || !item || !isBaseHalfMarkdownResource(item.stat.resource)
			|| this.view.sceneKey(folder) !== sceneKey
			|| !this.view.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, this.view.sceneMutationStamp(folder, structuralEpoch))) {
			return;
		}
		const resourceKey = this.view.uriIdentityService.extUri.getComparisonKey(item.stat.resource);
		const markdownPreview = this.view.cardRenderer.shownMarkdownPreview(path);
		if (baseHalfCanvasMarkdownEditTarget(item.stat.size, markdownPreview) === 'richDetail') {
			const pendingRich = this.queueMarkdownRichFormatCommand(resourceKey, command);
			await this.view.selectionActions.openSceneCard(sceneKey, structuralEpoch, path);
			const detail = this.view.canvasNavigationService.state.cardDetail;
			if (!detail || this.view.uriIdentityService.extUri.getComparisonKey(detail.resource) !== resourceKey) {
				this.discardMarkdownRichFormatCommand(pendingRich);
			}
			return;
		}
		const pending: IBaseHalfPendingCanvasNoteFormatCommand = {
			sceneKey,
			path,
			resourceKey,
			command,
			completion: new DeferredPromise<boolean>(),
			cancelled: false,
			running: false
		};
		this.view.pendingCanvasNoteFormatCommands.push(pending);
		// Attach the consumer before opening the editor: loading can fail while a
		// previous author is still closing, and every accepted intent must settle.
		void pending.completion.p.catch(() => undefined);
		const active = this.view.activeCanvasNoteEditor;
		const navigationGuard = !active
			? this.ensureCanvasNoteFormatNavigationGuard(sceneKey, path, resourceKey, item.stat.resource, folder.workspaceFolder, pending)
			: undefined;
		try {
			if (active && !active.closing && this.canvasNoteFormatCommandMatchesActive(pending, active)) {
				pending.active = active;
				void this.runPendingCanvasNoteFormatCommands(active);
			} else {
				await this.beginSceneNoteEdit(sceneKey, structuralEpoch, path, undefined, { sceneKey, path, resourceKey });
				const opened = this.view.activeCanvasNoteEditor;
				if (opened && !opened.closing && this.canvasNoteFormatCommandMatchesActive(pending, opened)) {
					void this.runPendingCanvasNoteFormatCommands(opened);
				} else if (this.view.canvasNoteSurfacePath !== path) {
					this.cancelPendingCanvasNoteFormatCommand(pending);
				}
			}
			await pending.completion.p;
		} finally {
			if (navigationGuard) {
				this.releaseCanvasNoteFormatNavigationGuard(navigationGuard);
			}
		}
	}

	private queueMarkdownRichFormatCommand(
		resourceKey: string,
		command: BaseHalfMarkdownFormatCommand
	): IBaseHalfPendingMarkdownRichFormatCommand {
		const pending = { resourceKey, command };
		this.pendingMarkdownRichFormatCommands.push(pending);
		return pending;
	}

	private discardMarkdownRichFormatCommand(pending: IBaseHalfPendingMarkdownRichFormatCommand): void {
		const index = this.pendingMarkdownRichFormatCommands.indexOf(pending);
		if (index >= 0) {
			this.pendingMarkdownRichFormatCommands.splice(index, 1);
		}
	}

	takeMarkdownRichFormatCommands(resource: URI): readonly BaseHalfMarkdownFormatCommand[] {
		const resourceKey = this.view.uriIdentityService.extUri.getComparisonKey(resource);
		const commands: BaseHalfMarkdownFormatCommand[] = [];
		for (let index = this.pendingMarkdownRichFormatCommands.length - 1; index >= 0; index--) {
			const pending = this.pendingMarkdownRichFormatCommands[index];
			if (pending.resourceKey !== resourceKey) {
				continue;
			}
			commands.unshift(pending.command);
			this.pendingMarkdownRichFormatCommands.splice(index, 1);
		}
		return commands;
	}

	async copySceneNote(sceneKey: string, structuralEpoch: number, path: string): Promise<void> {
		const folder = this.view.getCurrentFolder();
		const item = this.view.renderedItemsByPath.get(path);
		if (!folder || !item || !isBaseHalfMarkdownResource(item.stat.resource)
			|| this.view.sceneKey(folder) !== sceneKey
			|| !this.view.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, this.view.sceneMutationStamp(folder, structuralEpoch))) {
			return;
		}
		const active = this.view.activeCanvasNoteEditor;
		if (active?.path === path && this.view.uriIdentityService.extUri.isEqual(active.state.resource, item.stat.resource)) {
			await active.open;
			await active.instance.copyDocument();
			return;
		}
		const textFileModel = this.view.textFileService.files.get(item.stat.resource);
		if (textFileModel?.isResolved()) {
			await this.view.clipboardService.writeText(textFileModel.textEditorModel.getValue());
			return;
		}
		const content = await this.view.fileService.readFile(item.stat.resource, { atomic: true });
		await this.view.clipboardService.writeText(content.value.toString());
	}

	async setSceneNoteBackground(
		sceneKey: string,
		structuralEpoch: number,
		path: string,
		background: BaseHalfCanvasNoteBackground
	): Promise<void> {
		const folder = this.view.getCurrentFolder();
		const item = this.view.renderedItemsByPath.get(path);
		if (!folder || !item || !isBaseHalfMarkdownResource(item.stat.resource)
			|| this.view.sceneKey(folder) !== sceneKey
			|| !this.view.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, this.view.sceneMutationStamp(folder, structuralEpoch))) {
			return;
		}
		await this.view.canvasAppearanceService.setBackground(folder.workspaceFolder, path, background);
		const currentFolder = this.view.getCurrentFolder();
		const currentItem = this.view.renderedItemsByPath.get(path);
		if (!currentFolder || !currentItem || this.view.sceneKey(currentFolder) !== sceneKey
			|| !this.view.uriIdentityService.extUri.isEqual(currentItem.stat.resource, item.stat.resource)) {
			return;
		}
		const next = new Map(this.view.renderedNoteBackgrounds);
		if (background === 'default') {
			next.delete(path);
		} else {
			next.set(path, background);
		}
		this.view.renderedNoteBackgrounds = next;
		const card = this.view.renderedCardElementsByPath.get(path);
		if (card) {
			this.view.cardRenderer.applyNoteBackground(card, background);
		}
	}

	private publishCanvasNoteFormatState(path: string, resource: URI, state: IBaseHalfCanvasNoteFormatState): void {
		this.view.canvasNoteFormatStates.set(this.view.uriIdentityService.extUri.getComparisonKey(resource), state);
		const item = this.view.renderedItemsByPath.get(path);
		if (!item || !this.view.uriIdentityService.extUri.isEqual(item.stat.resource, resource)) {
			return;
		}
		const card = this.view.renderedCardElementsByPath.get(path);
		const CustomEventConstructor = card?.ownerDocument.defaultView?.CustomEvent;
		if (card && CustomEventConstructor) {
			card.dispatchEvent(new CustomEventConstructor(BASEHALF_CANVAS_NOTE_FORMAT_STATE_EVENT, { detail: state }));
		}
	}

	private ensureCanvasNoteFormatNavigationGuard(
		sceneKey: string,
		path: string,
		resourceKey: string,
		resource: URI,
		workspaceFolder: URI,
		pending: IBaseHalfPendingCanvasNoteFormatCommand
	): IBaseHalfPendingCanvasNoteNavigationGuard {
		const completion = pending.completion.p.catch(() => false);
		const owner = { sceneKey, path, resourceKey };
		const existing = this.view.pendingCanvasNoteNavigationGuard;
		if (existing) {
			if (!existing.ownership.accept(owner, pending, completion)) {
				const error = new Error(localize(
					'basehalf.canvas.note.formatOwnerBusy',
					"Another Note formatting action is still starting. Try again after it finishes."
				));
				this.failPendingCanvasNoteFormatCommand(pending, error);
				throw error;
			}
			pending.navigationGuard = existing;
			return existing;
		}
		const ownership = new BaseHalfCanvasNoteFormatNavigationOwnership<IBaseHalfPendingCanvasNoteFormatCommand>(owner);
		ownership.accept(owner, pending, completion);
		const editor: IBaseHalfActiveCanvasEditor = {
			resource,
			workspaceFolder,
			relativePath: path,
			supportsCanvasProjectionHandoff: false,
			prepareToClose: () => {
				if (!guard.closing) {
					guard.closing = this.prepareCanvasNoteFormatNavigationGuard(guard);
				}
				return guard.closing;
			}
		};
		const guard: IBaseHalfPendingCanvasNoteNavigationGuard = { ownership, editor };
		pending.navigationGuard = guard;
		this.view.pendingCanvasNoteNavigationGuard = guard;
		if (!this.view.canvasNavigationService.activeCanvasEditor) {
			this.view.canvasNavigationService.setActiveCanvasEditor(editor);
		}
		return guard;
	}

	private async prepareCanvasNoteFormatNavigationGuard(guard: IBaseHalfPendingCanvasNoteNavigationGuard): Promise<boolean> {
		const applied = await this.waitForCanvasNoteFormatNavigationGuard(guard);
		if (!applied) {
			this.releaseCanvasNoteFormatNavigationGuard(guard, true);
			return false;
		}
		if (!this.view.activeCanvasNoteEditor
			|| this.view.canvasNavigationService.activeCanvasEditor === guard.editor) {
			this.releaseCanvasNoteFormatNavigationGuard(guard, true);
			return false;
		}
		this.releaseCanvasNoteFormatNavigationGuard(guard, true);
		return true;
	}

	private async waitForCanvasNoteFormatNavigationGuard(guard: IBaseHalfPendingCanvasNoteNavigationGuard): Promise<boolean> {
		return guard.ownership.wait();
	}

	releaseCanvasNoteFormatNavigationGuard(
		guard: IBaseHalfPendingCanvasNoteNavigationGuard,
		force = false
	): void {
		if (this.view.pendingCanvasNoteNavigationGuard !== guard
			|| (!force && guard.ownership.hasPending)) {
			return;
		}
		this.view.pendingCanvasNoteNavigationGuard = undefined;
		if (this.view.canvasNavigationService.activeCanvasEditor === guard.editor) {
			this.view.canvasNavigationService.setActiveCanvasEditor(undefined);
		}
	}

	private canvasNoteFormatCommandMatchesActive(
		pending: IBaseHalfPendingCanvasNoteFormatCommand,
		active: IBaseHalfActiveCanvasNoteEditor
	): boolean {
		return pending.sceneKey === active.sceneKey
			&& pending.path === active.path
			&& pending.resourceKey === active.resourceKey;
	}

	private canvasNoteFormatCommandOwnedByActive(
		pending: IBaseHalfPendingCanvasNoteFormatCommand,
		active: IBaseHalfActiveCanvasNoteEditor
	): boolean {
		return pending.active === active && this.canvasNoteFormatCommandMatchesActive(pending, active);
	}

	private isCanvasNoteFormatCommandCurrent(
		pending: IBaseHalfPendingCanvasNoteFormatCommand,
		active: IBaseHalfActiveCanvasNoteEditor
	): boolean {
		if (this.view.disposed || this.view.activeCanvasNoteEditor !== active || active.closing
			|| !this.canvasNoteFormatCommandOwnedByActive(pending, active)) {
			return false;
		}
		const folder = this.view.getCurrentFolder();
		const item = this.view.renderedItemsByPath.get(pending.path);
		return !!folder
			&& this.view.sceneKey(folder) === pending.sceneKey
			&& !!item
			&& isBaseHalfMarkdownResource(item.stat.resource)
			&& this.view.uriIdentityService.extUri.getComparisonKey(item.stat.resource) === pending.resourceKey;
	}

	private removePendingCanvasNoteFormatCommand(pending: IBaseHalfPendingCanvasNoteFormatCommand): void {
		const index = this.view.pendingCanvasNoteFormatCommands.indexOf(pending);
		if (index >= 0) {
			this.view.pendingCanvasNoteFormatCommands.splice(index, 1);
		}
	}

	private completePendingCanvasNoteFormatCommand(pending: IBaseHalfPendingCanvasNoteFormatCommand): void {
		this.removePendingCanvasNoteFormatCommand(pending);
		void pending.completion.complete(true);
		this.settlePendingCanvasNoteFormatNavigationGuard(pending);
	}

	private failPendingCanvasNoteFormatCommand(pending: IBaseHalfPendingCanvasNoteFormatCommand, error: unknown): void {
		this.removePendingCanvasNoteFormatCommand(pending);
		void pending.completion.error(error);
		this.settlePendingCanvasNoteFormatNavigationGuard(pending);
	}

	private cancelPendingCanvasNoteFormatCommand(pending: IBaseHalfPendingCanvasNoteFormatCommand): void {
		pending.cancelled = true;
		if (pending.running) {
			return;
		}
		this.removePendingCanvasNoteFormatCommand(pending);
		void pending.completion.complete(false);
		this.settlePendingCanvasNoteFormatNavigationGuard(pending);
	}

	private settlePendingCanvasNoteFormatNavigationGuard(pending: IBaseHalfPendingCanvasNoteFormatCommand): void {
		const guard = pending.navigationGuard;
		if (!guard) {
			return;
		}
		pending.navigationGuard = undefined;
		guard.ownership.settle(pending);
		this.releaseCanvasNoteFormatNavigationGuard(guard);
	}

	cancelPendingCanvasNoteFormatCommands(
		predicate: (pending: IBaseHalfPendingCanvasNoteFormatCommand) => boolean = () => true
	): void {
		for (const pending of [...this.view.pendingCanvasNoteFormatCommands]) {
			if (predicate(pending)) {
				this.cancelPendingCanvasNoteFormatCommand(pending);
			}
		}
	}

	deferPendingCanvasSelectionUntilCanvasNoteFormatsSettle(
		sceneKey: string,
		path: string,
		resourceKey: string
	): void {
		const owner = baseHalfCanvasNoteFormatOwnerKey({ sceneKey, path, resourceKey });
		this.view.pendingCanvasSelectionFormatBarrier.defer(
			owner,
			() => this.waitForCanvasNoteFormatCommands(sceneKey, path, resourceKey),
			applied => {
				if (!applied) {
					const pendingSelection = this.view.pendingCanvasSelection;
					if (pendingSelection?.sceneKey === sceneKey
						&& this.view.canvasNoteSurfacePath === path
						&& !(pendingSelection.paths.length === 1 && pendingSelection.paths[0] === path)) {
						this.view.pendingCanvasSelection = undefined;
					}
				}
				if (!this.view.disposed) {
					this.view.requestRender();
				}
			}
		);
	}

	async waitForCanvasNoteFormatCommands(
		sceneKey: string,
		path: string,
		resourceKey: string
	): Promise<boolean> {
		let applied = true;
		while (true) {
			const pending = this.view.pendingCanvasNoteFormatCommands.filter(candidate => candidate.sceneKey === sceneKey
				&& candidate.path === path
				&& candidate.resourceKey === resourceKey);
			if (pending.length === 0) {
				return applied;
			}
			const outcomes = await Promise.all(pending.map(candidate => candidate.completion.p.catch(() => false)));
			applied = outcomes.every(Boolean) && applied;
		}
	}

	async drainActiveCanvasNoteFormatCommands(active: IBaseHalfActiveCanvasNoteEditor): Promise<boolean> {
		let applied = true;
		for (const pending of this.view.pendingCanvasNoteFormatCommands) {
			if (!pending.active && this.canvasNoteFormatCommandMatchesActive(pending, active)) {
				pending.active = active;
			}
		}
		if (this.view.pendingCanvasNoteFormatCommands.some(pending => this.canvasNoteFormatCommandOwnedByActive(pending, active))) {
			void this.runPendingCanvasNoteFormatCommands(active);
		}
		while (true) {
			const pending = this.view.pendingCanvasNoteFormatCommands.filter(candidate => this.canvasNoteFormatCommandMatchesActive(candidate, active));
			if (pending.length === 0) {
				return applied;
			}
			const outcomes = await Promise.all(pending.map(candidate => candidate.completion.p.catch(() => false)));
			applied = outcomes.every(Boolean) && applied;
		}
	}

	private runPendingCanvasNoteFormatCommands(active: IBaseHalfActiveCanvasNoteEditor): Promise<void> {
		const currentDrain = this.pendingCanvasNoteFormatDrain;
		if (currentDrain?.active === active) {
			return currentDrain.promise;
		}
		const promise = this.doRunPendingCanvasNoteFormatCommands(active);
		const drain = { active, promise };
		this.pendingCanvasNoteFormatDrain = drain;
		void promise.then(() => {
			if (this.pendingCanvasNoteFormatDrain !== drain) {
				return;
			}
			this.pendingCanvasNoteFormatDrain = undefined;
			if (this.view.activeCanvasNoteEditor === active
				&& this.view.pendingCanvasNoteFormatCommands.some(pending => (!pending.active || pending.active === active)
					&& this.canvasNoteFormatCommandMatchesActive(pending, active))) {
				void this.runPendingCanvasNoteFormatCommands(active);
			}
		});
		return promise;
	}

	private async doRunPendingCanvasNoteFormatCommands(active: IBaseHalfActiveCanvasNoteEditor): Promise<void> {
		for (const pending of this.view.pendingCanvasNoteFormatCommands) {
			if (!pending.active && this.canvasNoteFormatCommandMatchesActive(pending, active)) {
				pending.active = active;
			}
		}
		try {
			await active.open;
		} catch {
			this.cancelPendingCanvasNoteFormatCommands(pending => this.canvasNoteFormatCommandOwnedByActive(pending, active));
			return;
		}
		while (true) {
			const pending = this.view.pendingCanvasNoteFormatCommands.find(candidate => !candidate.running
				&& this.canvasNoteFormatCommandOwnedByActive(candidate, active));
			if (!pending) {
				return;
			}
			if (!this.isCanvasNoteFormatCommandCurrent(pending, active)) {
				this.cancelPendingCanvasNoteFormatCommand(pending);
				continue;
			}
			pending.running = true;
			try {
				const handled = await active.instance.runFormatCommand(pending.command);
				switch (baseHalfCanvasNoteFormatCommandOutcome(pending.cancelled, handled)) {
					case 'applied':
						this.completePendingCanvasNoteFormatCommand(pending);
						break;
					case 'cancelled':
						this.cancelPendingCanvasNoteFormatCommand(pending);
						break;
					case 'rejected':
						this.failPendingCanvasNoteFormatCommand(
							pending,
							new Error(localize('basehalf.canvas.note.formatNotApplied', "The formatting action could not be applied."))
						);
						break;
				}
			} catch (error) {
				if (pending.cancelled) {
					this.cancelPendingCanvasNoteFormatCommand(pending);
				} else {
					this.failPendingCanvasNoteFormatCommand(pending, error);
				}
			} finally {
				pending.running = false;
				if (pending.cancelled && !pending.completion.isSettled) {
					this.cancelPendingCanvasNoteFormatCommand(pending);
				}
			}
		}
	}

	releaseCanvasNoteFocusIntent(intent: IBaseHalfPendingCanvasNoteFocus | undefined): void {
		if (intent?.focus) {
			this.view.canvasNoteFocusLeaseOwner.release(intent.lease);
		}
	}

	clearPendingCanvasNoteFocus(path: string): void {
		const pending = this.view.pendingCanvasNoteFocus;
		if (pending?.path !== path) {
			return;
		}
		this.view.pendingCanvasNoteFocus = undefined;
		this.releaseCanvasNoteFocusIntent(pending);
	}

	queueCreatedCanvasNoteActivation(
		folder: IBaseHalfCanvasFolderState,
		path: string,
		resource: URI,
		owner: IBaseHalfCanvasPostCreateOwner,
		focus: { readonly focus: true; readonly origin: Element | null; readonly returnPath?: string } | { readonly focus: false },
		fitPaths?: readonly string[]
	): boolean {
		if (!this.view.isCanvasPostCreateOwnerCurrent(owner)) {
			return false;
		}
		this.cancelPendingCreatedCanvasNoteActivation();
		const base = {
			sceneKey: this.view.sceneKey(folder),
			path,
			resourceKey: this.view.uriIdentityService.extUri.getComparisonKey(resource),
			owner,
			fitPaths,
			...(fitPaths?.length ? { fitViewportGeneration: this.view.viewportRestoreGeneration } : {})
		};
		this.view.pendingCreatedCanvasNoteActivation = focus.focus
			? {
				...base,
				focus: true,
				focusOrigin: focus.origin,
				focusReturnPath: focus.returnPath,
				lease: this.view.canvasNoteFocusLeaseOwner.claim()
			}
			: { ...base, focus: false };
		return true;
	}

	promotePendingCreatedCanvasNoteActivation(
		sceneKey: string,
		items: readonly IBaseHalfCanvasItem[]
	): void {
		const pending = this.view.pendingCreatedCanvasNoteActivation;
		if (!pending) {
			return;
		}
		if (pending.sceneKey !== sceneKey || !this.view.isCanvasPostCreateOwnerCurrent(pending.owner)) {
			this.cancelPendingCreatedCanvasNoteActivation();
			return;
		}
		const item = items.find(candidate => candidate.path === pending.path);
		if (!item) {
			return;
		}
		if (!isBaseHalfMarkdownResource(item.stat.resource)
			|| this.view.uriIdentityService.extUri.getComparisonKey(item.stat.resource) !== pending.resourceKey) {
			this.cancelPendingCreatedCanvasNoteActivation();
			return;
		}

		this.view.pendingCreatedCanvasNoteActivation = undefined;
		this.view.canvasNoteSurfacePath = pending.path;
		this.view.pendingCanvasNoteFocus = pending.focus
			? {
				path: pending.path,
				focus: true,
				lease: pending.lease,
				createOwner: pending.owner,
				createFocusOrigin: pending.focusOrigin,
				createFocusReturnPath: pending.focusReturnPath
			}
			: { path: pending.path, focus: false, createOwner: pending.owner };
		// A stale render may have observed the pending selection before the file
		// entered its model. Re-publish it at the same fresh identity boundary.
		this.view.selectionActions.queueCanvasSelection(sceneKey, [pending.path], pending.owner);
		if (pending.fitPaths?.length && pending.fitViewportGeneration !== undefined) {
			this.view.pendingCanvasFit = {
				sceneKey,
				paths: pending.fitPaths,
				owner: pending.owner,
				viewportGeneration: pending.fitViewportGeneration
			};
		}
	}

	cancelPendingCreatedCanvasNoteActivation(): void {
		const pending = this.view.pendingCreatedCanvasNoteActivation;
		if (!pending) {
			return;
		}
		this.view.pendingCreatedCanvasNoteActivation = undefined;
		if (this.view.pendingCanvasSelection?.sceneKey === pending.sceneKey
			&& this.view.pendingCanvasSelection.paths.length === 1
			&& this.view.pendingCanvasSelection.paths[0] === pending.path) {
			this.view.pendingCanvasSelection = undefined;
		}
		if (pending.focus) {
			this.view.canvasNoteFocusLeaseOwner.release(pending.lease);
		}
	}

	private focusCanvasNoteEditorFromIntent(
		active: IBaseHalfActiveCanvasNoteEditor,
		intent: IBaseHalfPendingCanvasNoteFocus | undefined
	): void {
		if (!intent?.focus) {
			return;
		}
		const shouldFocus = this.view.canvasNoteFocusLeaseOwner.consume(intent.lease, () => {
			if (this.view.disposed
				|| this.view.activeCanvasNoteEditor !== active
				|| active.closing
				|| (intent.createOwner !== undefined && !this.view.isCanvasPostCreateOwnerCurrent(intent.createOwner))
				|| this.view.canvasNavigationService.state.cardDetail) {
				return false;
			}
			const ownerDocument = active.card.ownerDocument;
			const focused = ownerDocument.activeElement;
			const focusedCardPath = isHTMLElement(focused)
				? focused.closest<HTMLElement>('.basehalf-canvas-card')?.dataset.basehalfCardPath
				: undefined;
			const remainsOwned = ownerDocument.hasFocus()
				&& (focused === ownerDocument.body
					|| focused === active.card
					|| (intent.createFocusOrigin !== undefined && focused === intent.createFocusOrigin)
					|| (intent.createFocusReturnPath !== undefined && focusedCardPath === intent.createFocusReturnPath)
					|| (isHTMLElement(focused) && active.card.contains(focused)));
			return remainsOwned;
		});
		if (shouldFocus) {
			active.instance.focus(intent.point);
		}
	}

	focusSceneNoteEditor(sceneKey: string, structuralEpoch: number, path: string): void {
		const folder = this.view.getCurrentFolder();
		const active = this.view.activeCanvasNoteEditor;
		if (!folder || this.view.sceneKey(folder) !== sceneKey
			|| !this.view.workspaceMutationCoordinator.isStampCurrent(folder.workspaceFolder, this.view.sceneMutationStamp(folder, structuralEpoch))) {
			return;
		}
		if (active?.path === path && !active.closing) {
			active.instance.focus();
			return;
		}
		this.view.renderedCardElementsByPath.get(path)?.focus();
	}

	async closeActiveCanvasNoteEditorAfterFormats(refreshCanvas = true): Promise<boolean> {
		const accepted = this.view.activeCanvasNoteEditor;
		if (!accepted) {
			return true;
		}
		return this.closeCanvasNoteEditorAfterFormats(accepted, refreshCanvas);
	}

	private closeCanvasNoteEditorAfterFormats(
		accepted: IBaseHalfActiveCanvasNoteEditor,
		refreshCanvas = true
	): Promise<boolean> {
		return baseHalfCanvasNotePrepareIdentityBoundClose(
			accepted,
			() => this.view.activeCanvasNoteEditor,
			async () => {
				if (!accepted.closing && !await this.drainActiveCanvasNoteFormatCommands(accepted)) {
					return false;
				}
				if (this.view.activeCanvasNoteEditor !== accepted) {
					return false;
				}
				const closed = await this.closeActiveCanvasNoteEditor(refreshCanvas);
				return this.view.activeCanvasNoteEditor && this.view.activeCanvasNoteEditor !== accepted
					? false
					: closed;
			}
		);
	}

	async closeActiveCanvasNoteEditor(refreshCanvas = true): Promise<boolean> {
		const active = this.view.activeCanvasNoteEditor;
		if (!active) {
			return true;
		}
		if (!active.closing) {
			active.closing = active.instance.prepareToClose();
		}
		const closing = active.closing;
		let ok = false;
		try {
			ok = await closing;
		} catch (error) {
			this.view.logService.error(error);
		}
		if (this.view.activeCanvasNoteEditor !== active || active.closing !== closing) {
			return ok;
		}
		if (!ok) {
			active.closing = undefined;
			active.instance.focus();
			this.showCanvasNoteSaveWarning(active.path);
			return false;
		}
		this.retireActiveCanvasNoteEditor(active, refreshCanvas);
		return true;
	}

	/**
	 * Refresh the resting projection while the opaque editor still covers it.
	 * Removing the editor then reveals one complete frame instead of exposing
	 * an empty card until the canvas render timer runs.
	 */
	private refreshActiveCanvasNoteFallback(active: IBaseHalfActiveCanvasNoteEditor): void {
		const scrollTop = active.instance.getScrollTop();
		const sidewaysScroll = active.instance.getSidewaysScroll();
		const documentLength = active.instance.getDocumentLength();
		if (documentLength !== undefined && documentLength > BASEHALF_CANVAS_NOTE_SHOWN_MAX_BYTES) {
			this.renderActiveCanvasNoteFullEditorFallback(active);
			return;
		}
		const text = active.instance.getDocumentText();
		if (text === undefined) {
			active.fallback.scrollTop = scrollTop;
			return;
		}
		if (!baseHalfCanvasMarkdownSourceFitsShown(text)) {
			this.renderActiveCanvasNoteFullEditorFallback(active);
			return;
		}
		active.fallbackRendering.clear();
		clearNode(active.fallback);
		const preview = { kind: 'markdown', text } as const;
		this.view.cardRenderer.renderStaticMarkdownSource(
			active.fallback,
			active.state.resource,
			baseHalfCanvasMarkdownPreviewSource(preview.text),
			active.fallbackRendering
		);
		const mount = this.view.canvasNotePreviewMounts.get(active.card);
		if (mount?.fallback === active.fallback) {
			mount.preview = preview;
		}
		const item = this.view.renderedItemsByPath.get(active.path);
		if (item && this.view.uriIdentityService.extUri.isEqual(item.stat.resource, active.state.resource)) {
			this.view.renderedCardPreviewsByPath.set(active.path, { item, preview });
		}
		// The editor holds every block. The projection it reveals holds as many,
		// so it shows the same place and the same sideways positions. A note that
		// has grown past the editor's size holds the parts down to that place.
		if (baseHalfCanvasMarkdownSourceFitsInline(text)) {
			buildAllBaseHalfCanvasNoteParts(active.fallback);
		} else {
			buildBaseHalfCanvasNotePartsTo(active.fallback, scrollTop);
		}
		active.fallback.scrollTop = scrollTop;
		applyBaseHalfCanvasMarkdownSidewaysScroll(active.fallback, sidewaysScroll);
	}

	private renderActiveCanvasNoteFullEditorFallback(active: IBaseHalfActiveCanvasNoteEditor): void {
		active.fallbackRendering.clear();
		clearNode(active.fallback);
		appendCanvasNoteFullEditorLabel(active.fallback);
		active.fallback.scrollTop = 0;
		const richRequiredPreview = { kind: 'richRequired', text: CANVAS_MARKDOWN_FULL_EDITOR_LABEL } as const;
		const mount = this.view.canvasNotePreviewMounts.get(active.card);
		if (mount?.fallback === active.fallback) {
			mount.preview = richRequiredPreview;
		}

		// The preview cache may still describe the snapshot from before
		// this edit. Replace it before the inline host is removed so a rapid
		// second double-click cannot re-enter quick edit with stale metadata.
		const item = this.view.renderedItemsByPath.get(active.path);
		if (item && this.view.uriIdentityService.extUri.isEqual(item.stat.resource, active.state.resource)) {
			this.view.renderedCardPreviewsByPath.set(active.path, {
				item,
				preview: richRequiredPreview
			});
		}
	}

	detachCanvasNoteEditorMount(active: IBaseHalfActiveCanvasNoteEditor): void {
		active.mountDisposables.dispose();
		active.instance.dispose();
		active.host.remove();
		active.fallback.classList.remove('basehalf-canvas-note-editor-fallback');
		active.fallback.removeAttribute('aria-hidden');
		active.fallback.removeAttribute('inert');
		delete active.card.dataset.noteSurface;
		delete active.card.dataset.noteEditing;
		delete active.card.dataset.noteSaveState;
		// Background renders advance cache metadata while the editor deliberately
		// retains its original card DOM. Preserve the fast path when that chrome
		// still matches, but never let a retained header masquerade as a newer one.
		if (active.chromeStale) {
			this.view.renderedCardsByPath.delete(active.path);
		}
	}

	private failCanvasNoteEditorOpen(active: IBaseHalfActiveCanvasNoteEditor): void {
		if (this.view.activeCanvasNoteEditor !== active) {
			return;
		}
		this.cancelPendingCanvasNoteFormatCommands(pending => this.canvasNoteFormatCommandMatchesActive(pending, active));
		this.view.activeCanvasNoteEditor = undefined;
		if (this.view.canvasNoteSurfacePath === active.path) {
			this.view.canvasNoteSurfacePath = undefined;
		}
		this.clearPendingCanvasNoteFocus(active.path);
		this.releaseCanvasNoteFocusIntent(active.focusIntent);
		this.view.canvasNavigationService.setActiveCanvasEditor(undefined);
		this.detachCanvasNoteEditorMount(active);
	}

	private retireActiveCanvasNoteEditor(
		active: IBaseHalfActiveCanvasNoteEditor,
		refreshCanvas: boolean
	): void {
		if (this.view.activeCanvasNoteEditor !== active) {
			return;
		}
		this.cancelPendingCanvasNoteFormatCommands(pending => this.canvasNoteFormatCommandOwnedByActive(pending, active));
		// Every successful retirement, including a rapid-close waiter that wins
		// the continuation race, must preserve the atomic projection boundary.
		this.refreshActiveCanvasNoteFallback(active);
		const resourceKey = this.view.uriIdentityService.extUri.getComparisonKey(active.state.resource);
		const selection = active.instance.getSelection();
		if (selection) {
			this.canvasNoteSelections.set(resourceKey, selection);
		}
		const formatState = active.instance.getFormatState();
		if (formatState) {
			this.publishCanvasNoteFormatState(active.path, active.state.resource, { ...formatState, editable: false });
		}
		this.view.activeCanvasNoteEditor = undefined;
		this.agentSelectionCardTextReader.cancel();
		this.view.agentSelectionCardText = undefined;
		this.view.selectionActions.reportAgentSelection();
		if (this.view.canvasNoteSurfacePath === active.path) {
			this.view.canvasNoteSurfacePath = undefined;
		}
		this.clearPendingCanvasNoteFocus(active.path);
		this.releaseCanvasNoteFocusIntent(active.focusIntent);
		this.view.canvasNavigationService.setActiveCanvasEditor(undefined);
		this.detachCanvasNoteEditorMount(active);
		if (refreshCanvas) {
			mainWindow.setTimeout(() => {
				if (!this.view.disposed) {
					this.view.requestRender();
				}
			}, 0);
		}
	}

	async activateCreatedCanvasNoteAfterDetail(
		sourceDetail: IBaseHalfCardDetailState,
		folder: IBaseHalfCanvasFolderState,
		path: string,
		resource: URI,
		focusOrigin: Element | null,
		createOwner: IBaseHalfCanvasPostCreateOwner,
		fitPaths: readonly string[]
	): Promise<boolean> {
		if (!this.view.isCanvasPostCreateOwnerCurrent(createOwner)
			|| createOwner.navigationState.cardDetail !== sourceDetail) {
			return false;
		}
		const ownerDocument = this.view.root.ownerDocument;
		const focusStillBelongsToCreate = focusOrigin !== null && ownerDocument.activeElement === focusOrigin;
		if (!await this.view.canvasNavigationService.closeCardDetail({ expectedCardDetail: sourceDetail })) {
			if (!this.view.isCanvasPostCreateOwnerCurrent(createOwner)) {
				return false;
			}
			throw new Error(localize('basehalf.pdf.branch.closeBlocked', "Save or resolve the active file before returning to the new note."));
		}
		if (this.view.canvasInteractionEpoch !== createOwner.interactionEpoch
			|| this.view.canvasNavigationEpoch !== createOwner.navigationEpoch + 1
			|| this.view.canvasNavigationService.state.cardDetail) {
			return false;
		}
		const currentFolder = this.view.getCurrentFolder();
		if (!currentFolder
			|| !this.view.uriIdentityService.extUri.isEqual(currentFolder.resource, folder.resource)
			|| this.view.sceneKey(currentFolder) !== this.view.sceneKey(folder)) {
			return false;
		}
		// A PDF projection owns a separate browsing context. Removing it can leave
		// the parent document temporarily focused on <body>, which would consume the
		// delayed editor lease before the new card can claim focus. Re-enter the
		// Canvas through its stable host only while the original create action still
		// owns focus; a user interaction during the async file/graph work wins.
		if (focusStillBelongsToCreate) {
			this.view.root.focus({ preventScroll: true });
		}
		const handedFocusBackToCanvas = focusStillBelongsToCreate
			&& ownerDocument.activeElement === this.view.root
			&& ownerDocument.hasFocus();
		const activationOwner = this.view.captureCanvasPostCreateOwner();
		if (!this.queueCreatedCanvasNoteActivation(
			folder,
			path,
			resource,
			activationOwner,
			handedFocusBackToCanvas ? { focus: true, origin: this.view.root } : { focus: false },
			fitPaths
		)) {
			return false;
		}
		this.view.selectionActions.queueCanvasSelection(this.view.sceneKey(folder), [path], activationOwner);
		this.view.requestRender();
		return true;
	}

	renderMarkdownPreview(
		container: HTMLElement,
		item: IBaseHalfCanvasItem,
		text: string,
		listeners: DisposableStore,
		card: HTMLElement
	): void {
		const fallback = append(container, $('.bh-md-preview'));
		const rendering = new DisposableStore();
		listeners.add(rendering);
		this.view.cardRenderer.renderStaticMarkdownPreview(fallback, item, text, rendering);
		const mount: IBaseHalfCanvasNotePreviewMount = {
			path: item.path,
			resourceKey: this.view.uriIdentityService.extUri.getComparisonKey(item.stat.resource),
			card,
			container,
			fallback,
			rendering,
			preview: { kind: 'markdown', text }
		};
		this.view.canvasNotePreviewMounts.set(card, mount);
		listeners.add(toDisposable(() => {
			if (this.view.canvasNotePreviewMounts.get(card) === mount) {
				this.view.canvasNotePreviewMounts.delete(card);
			}
		}));
		this.tryMountCanvasNoteEditor(item.path);
	}

	tryMountCanvasNoteEditor(path: string): boolean {
		if (this.view.activeCanvasNoteEditor) {
			return this.view.activeCanvasNoteEditor.path === path;
		}
		if (this.view.canvasNoteSurfacePath !== path
			|| this.view.canvasNavigationService.state.cardDetail
			|| (this.view.inlineEdit?.kind === 'rename' && this.view.inlineEdit.path === path)) {
			return false;
		}
		const folder = this.view.getCurrentFolder();
		const item = this.view.renderedItemsByPath.get(path);
		const card = this.view.renderedCardElementsByPath.get(path);
		const renderedCard = this.view.renderedCardsByPath.get(path);
		const mount = card ? this.view.canvasNotePreviewMounts.get(card) : undefined;
		const markdownPreview = this.view.cardRenderer.shownMarkdownPreview(path);
		if (!folder || !item || !card || !renderedCard || !mount
			|| !isBaseHalfMarkdownResource(item.stat.resource)
			|| baseHalfCanvasMarkdownEditTarget(item.stat.size, markdownPreview) !== 'inline'
			|| renderedCard.element !== card
			|| mount.path !== path
			|| mount.resourceKey !== this.view.uriIdentityService.extUri.getComparisonKey(item.stat.resource)
			|| mount.card !== card
			|| mount.fallback.parentElement !== mount.container
			|| !card.contains(mount.container)) {
			return false;
		}

		const sceneKey = this.view.sceneKey(folder);
		const pendingFocus = this.view.pendingCanvasNoteFocus?.path === path
			? this.view.pendingCanvasNoteFocus
			: undefined;
		if (pendingFocus?.createOwner && !this.view.isCanvasPostCreateOwnerCurrent(pendingFocus.createOwner)) {
			this.clearPendingCanvasNoteFocus(path);
			if (this.view.canvasNoteSurfacePath === path) {
				this.view.canvasNoteSurfacePath = undefined;
			}
			return false;
		}
		if (pendingFocus) {
			this.view.pendingCanvasNoteFocus = undefined;
		}
		// The editor builds every block, and the projection under it stays the
		// frame its closing reveals: it holds every part too (note rendering).
		buildAllBaseHalfCanvasNoteParts(mount.fallback);
		const fallbackScrollTop = mount.fallback.scrollTop;
		mount.fallback.classList.add('basehalf-canvas-note-editor-fallback');
		const host = append(mount.container, $('.basehalf-canvas-note-editor.basehalf-canvas-note-inline-editor.nodrag.nopan.nowheel'));
		host.setAttribute('data-testid', `canvas-note-editor-${path}`);
		const mountDisposables = new DisposableStore();
		const state: IBaseHalfCardDetailState = {
			resource: item.stat.resource,
			workspaceFolder: folder.workspaceFolder,
			relativePath: path,
			source: 'api',
			pinned: true,
			projection: 'rich'
		};
		const requestToolbarFocus = (): void => {
			const EventConstructor = card.ownerDocument.defaultView?.Event;
			if (EventConstructor) {
				card.dispatchEvent(new EventConstructor(BASEHALF_CANVAS_NOTE_TOOLBAR_FOCUS_EVENT));
			}
		};
		const instance = this.view.instantiationService.createInstance(
			BaseHalfCanvasMarkdownInlineEditor,
			host,
			status => card.setAttribute('data-note-save-state', status),
			{
				onCanvasToolbarRequest: requestToolbarFocus,
				onCanvasExitRequest: () => void this.closeCanvasNoteEditorAfterFormats(active),
				onSaveRequest: save => void save.then(ok => {
					if (!ok) {
						this.showCanvasNoteSaveWarning(path);
					}
				}),
				onOpenLink: href => this.view.cardRenderer.openStaticMarkdownPreviewLink(href),
				onFormatStateChange: formatState => this.publishCanvasNoteFormatState(path, item.stat.resource, formatState),
				onSelectionChange: () => this.agentSelectionCardTextReader.schedule()
			}
		);
		const open = instance.open(state, pendingFocus?.point, pendingFocus?.selection, fallbackScrollTop);
		const active: IBaseHalfActiveCanvasNoteEditor = {
			sceneKey,
			structuralEpoch: this.view.renderedSceneStructuralEpoch,
			path,
			resourceKey: mount.resourceKey,
			mountedVisualKey: renderedCard.visualKey,
			state,
			card,
			container: mount.container,
			host,
			fallback: mount.fallback,
			fallbackRendering: mount.rendering,
			mountDisposables,
			instance,
			open,
			focusIntent: pendingFocus,
			chromeStale: false
		};
		this.view.activeCanvasNoteEditor = active;
		card.dataset.noteSurface = 'true';
		card.dataset.noteEditing = 'true';
		this.view.canvasNavigationService.setActiveCanvasEditor({
			...state,
			prepareToClose: () => this.closeCanvasNoteEditorAfterFormats(active)
		});
		for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'wheel'] as const) {
			mountDisposables.add(this.view.addDisposableListener(host, type, event => event.stopPropagation()));
		}
		void open.then(() => {
			if (this.view.activeCanvasNoteEditor !== active
				|| active.host.parentElement !== active.container
				|| this.view.canvasNotePreviewMounts.get(active.card)?.fallback !== active.fallback) {
				return;
			}
			if (pendingFocus?.createOwner && !this.view.isCanvasPostCreateOwnerCurrent(pendingFocus.createOwner)) {
				this.failCanvasNoteEditorOpen(active);
				this.view.requestRender();
				return;
			}
			// The original preview remains the atomic exit frame underneath the live
			// surface, but only one projection enters the accessibility tree.
			// The resting note stays the shown projection until here, and a wheel
			// may have scrolled it since the editor began to open.
			active.instance.setScrollTop(active.fallback.scrollTop);
			active.instance.setSidewaysScroll(readBaseHalfCanvasMarkdownSidewaysScroll(active.fallback));
			active.fallback.setAttribute('aria-hidden', 'true');
			active.fallback.setAttribute('inert', '');
			active.host.classList.add('ready');
			this.focusCanvasNoteEditorFromIntent(active, pendingFocus);
			void this.runPendingCanvasNoteFormatCommands(active);
		}, error => {
			if (this.view.activeCanvasNoteEditor !== active) {
				return;
			}
			const requiresRichEditor = error instanceof BaseHalfCanvasMarkdownRequiresRichEditorError;
			const richCommands = requiresRichEditor
				? this.view.pendingCanvasNoteFormatCommands
					.filter(pending => this.canvasNoteFormatCommandMatchesActive(pending, active))
					.map(pending => pending.command)
				: [];
			const queuedRich = richCommands.map(command => this.queueMarkdownRichFormatCommand(active.resourceKey, command));
			this.failCanvasNoteEditorOpen(active);
			this.view.requestRender();
			if (requiresRichEditor) {
				void this.view.selectionActions.openSceneCard(active.sceneKey, active.structuralEpoch, active.path).then(() => {
					const detail = this.view.canvasNavigationService.state.cardDetail;
					if (!detail || this.view.uriIdentityService.extUri.getComparisonKey(detail.resource) !== active.resourceKey) {
						for (const pending of queuedRich) {
							this.discardMarkdownRichFormatCommand(pending);
						}
					}
				}, richError => {
					for (const pending of queuedRich) {
						this.discardMarkdownRichFormatCommand(pending);
					}
					this.view.reportCanvasMutationError(richError);
				});
			} else {
				this.view.reportCanvasMutationError(error);
			}
		});
		return true;
	}

	private showCanvasNoteSaveWarning(path: string): void {
		const message = localize(
			'basehalf.canvas.note.saveFailed',
			"Couldn't save {0}. The editor is still open so your text is not lost.",
			path
		);
		const duplicate = [...this.view.canvasOverlay.querySelectorAll<HTMLElement>('.basehalf-canvas-warning')]
			.some(warning => warning.textContent === message);
		if (!duplicate) {
			this.view.renderer.renderCanvasWarning(message);
		}
	}
}
