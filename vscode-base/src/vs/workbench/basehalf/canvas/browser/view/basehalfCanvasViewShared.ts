/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../base/browser/dom.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { IFileStat } from '../../../../../platform/files/common/files.js';
import { IBaseHalfCanvasItem } from '../../common/basehalfCanvasModel.js';
import { IBaseHalfBadgeNode } from '../../../references/common/basehalfBadgeMirror.js';
import { IBaseHalfCanvasDamage, IBaseHalfCanvasStateTransition } from '../../common/basehalfCanvasMirror.js';
import { IBaseHalfActiveCanvasEditor, IBaseHalfCanvasNavigationState, IBaseHalfCardDetailState } from '../../../navigation/common/basehalfCanvasNavigation.js';
import { BaseHalfCanvasNoteFormatNavigationOwnership, IBaseHalfCanvasNoteFocusLease } from '../../common/basehalfCanvasNoteFormatLifecycle.js';
import { BaseHalfCanvasCreateKind } from '../../common/basehalfCanvasEditing.js';
import { IBaseHalfCanvasActionContext } from '../../common/basehalfCanvasActionContext.js';
import { baseHalfItemDisplayName } from '../../../cardDetail/common/basehalfCardDetail.js';
import { BaseHalfItemKindIcon, baseHalfItemIcon } from '../../../agentArea/common/basehalfAgentSelection.js';
import { BaseHalfNodeKind } from '../../../video/common/basehalfNodeDocument.js';
import { BaseHalfCanvasMarkdownInlineEditor, IBaseHalfCanvasMarkdownInlineSelection } from '../basehalfCanvasMarkdownInlineEditor.js';
import { IBaseHalfCanvasNoteEditPoint } from '../../common/basehalfCanvasScene.js';
import type { BaseHalfMarkdownFormatCommand } from '../../../markdown/common/basehalfMarkdownFormatting.js';
import { BaseHalfCanvasCardPreview, BaseHalfCanvasNodePreview } from '../../common/basehalfCanvasCardPreview.js';
import { IBaseHalfWorkspaceMutationLease, IBaseHalfWorkspaceResourceMutationStamp } from '../../../workspace/common/basehalfWorkspaceMutation.js';

/**
 * Types, constants, and small functions that several parts of the canvas view
 * use (README.md in this folder).
 */
export interface IBaseHalfActiveCanvasNoteEditor {
	readonly sceneKey: string;
	readonly structuralEpoch: number;
	readonly path: string;
	readonly resourceKey: string;
	readonly mountedVisualKey: string;
	readonly state: IBaseHalfCardDetailState;
	readonly card: HTMLElement;
	readonly container: HTMLElement;
	readonly host: HTMLElement;
	readonly fallback: HTMLElement;
	readonly fallbackRendering: DisposableStore;
	readonly mountDisposables: DisposableStore;
	readonly instance: BaseHalfCanvasMarkdownInlineEditor;
	readonly open: Promise<void>;
	readonly focusIntent: IBaseHalfPendingCanvasNoteFocus | undefined;
	chromeStale: boolean;
	closing?: Promise<boolean>;
}

export interface IBaseHalfCanvasNotePreviewMount {
	readonly path: string;
	readonly resourceKey: string;
	readonly card: HTMLElement;
	readonly container: HTMLElement;
	readonly fallback: HTMLElement;
	readonly rendering: DisposableStore;
	preview: { readonly kind: 'markdown' | 'richRequired'; readonly text: string };
}

export function baseHalfCanvasRetainedCardChromeIsStale(mountedVisualKey: string, currentVisualKey: string): boolean {
	return mountedVisualKey !== currentVisualKey;
}

export interface IBaseHalfCanvasPostCreateOwner {
	readonly interactionEpoch: number;
	readonly navigationEpoch: number;
	readonly navigationState: IBaseHalfCanvasNavigationState;
}

export function baseHalfCanvasPostCreateOwnerIsCurrent(
	owner: IBaseHalfCanvasPostCreateOwner,
	interactionEpoch: number,
	navigationEpoch: number,
	navigationState: IBaseHalfCanvasNavigationState
): boolean {
	return owner.interactionEpoch === interactionEpoch
		&& owner.navigationEpoch === navigationEpoch
		&& owner.navigationState === navigationState;
}

export type IBaseHalfPendingCanvasNoteFocus = {
	readonly path: string;
	readonly point?: IBaseHalfCanvasNoteEditPoint;
	readonly selection?: IBaseHalfCanvasMarkdownInlineSelection;
	readonly createOwner?: IBaseHalfCanvasPostCreateOwner;
} & ({
	readonly focus: true;
	readonly lease: IBaseHalfCanvasNoteFocusLease;
	/** The element that owned focus when a newly created Note requested its
	 *  inline editor. The card may claim focus only while that intent is still
	 *  current, so asynchronous preview hydration never steals focus back from
	 *  a later user interaction. */
	readonly createFocusOrigin?: Element | null;
	readonly createFocusReturnPath?: string;
} | {
	readonly focus: false;
});

export interface IBaseHalfPendingCanvasNoteFormatCommand {
	readonly sceneKey: string;
	readonly path: string;
	readonly resourceKey: string;
	readonly command: BaseHalfMarkdownFormatCommand;
	readonly completion: DeferredPromise<boolean>;
	navigationGuard?: IBaseHalfPendingCanvasNoteNavigationGuard;
	active?: IBaseHalfActiveCanvasNoteEditor;
	cancelled: boolean;
	running: boolean;
}

export interface IBaseHalfPendingCanvasNoteNavigationGuard {
	readonly ownership: BaseHalfCanvasNoteFormatNavigationOwnership<IBaseHalfPendingCanvasNoteFormatCommand>;
	readonly editor: IBaseHalfActiveCanvasEditor;
	closing?: Promise<boolean>;
}

/**
 * The one-line canvas notice for saved layout BaseHalf could not use (mirror
 * file resilience, "What the user sees"). The affected cards are placed as
 * cards that were never positioned, and every interaction keeps working.
 */
export function baseHalfCanvasLayoutNotice(damage: IBaseHalfCanvasDamage): string {
	return damage.kind === 'partial'
		? localize('basehalf.canvas.layout.partial', "Some saved card positions could not be read")
		: localize('basehalf.canvas.layout.unreadable', "This canvas's saved layout could not be read");
}

export function baseHalfCanvasPendingSelectionIsReady(
	paths: readonly string[],
	availablePaths: ReadonlySet<string>
): boolean {
	return paths.length > 0 && paths.every(path => availablePaths.has(path));
}

export interface IBaseHalfCanvasCardRenderCacheEntry {
	readonly item: IBaseHalfCanvasItem;
	readonly preview: BaseHalfCanvasCardPreview | undefined;
	readonly visualKey: string;
	readonly sceneKey: string;
	readonly element: HTMLElement;
}

export function canvasResultNodeKindLabel(kind: BaseHalfNodeKind): string {
	switch (kind) {
		case 'file':
			return localize('basehalf.canvas.resultKind.file', "File");
		case 'image':
			return localize('basehalf.canvas.resultKind.image', "Image");
		case 'video':
			return localize('basehalf.canvas.resultKind.video', "Video");
		case 'audio':
			return localize('basehalf.canvas.resultKind.audio', "Audio");
		case 'pdf':
			return localize('basehalf.canvas.resultKind.pdf', "PDF");
		case 'presentation':
			return localize('basehalf.canvas.resultKind.presentation', "Presentation");
	}
}

export interface IBaseHalfBadgeDescriptionDraft {
	readonly node: IBaseHalfBadgeNode;
	readonly guard: IBaseHalfCanvasMutationGuard;
	readonly identityStamp: IBaseHalfWorkspaceResourceMutationStamp;
	readonly resourceIdentity: string;
	value: string;
	recovery?: 'retry-exhausted' | 'identity-changed' | 'resource-missing';
}

export interface IBaseHalfBadgeDescriptionPending extends IBaseHalfBadgeDescriptionDraft {
	delayReleased: boolean;
	retryAttempt: number;
	readonly delay: Promise<void>;
	readonly releaseDelay: () => void;
	write?: Promise<void>;
}

export interface IBaseHalfCanvasMutationGuard {
	readonly workspaceKey: string;
	readonly resourceStamp: IBaseHalfWorkspaceResourceMutationStamp;
	readonly resourceIdentity: string;
	run<T>(task: (lease: IBaseHalfWorkspaceMutationLease) => Promise<T>, relatedStamps?: readonly IBaseHalfWorkspaceResourceMutationStamp[]): Promise<T>;
}

export interface IBaseHalfCanvasUndoNode {
	readonly path: string;
	readonly kind: IBaseHalfCanvasItem['kind'];
}

export interface IBaseHalfCanvasNodeDocumentTransition {
	readonly resource: URI;
	readonly expected: VSBuffer;
	readonly next: VSBuffer;
}

export type BaseHalfCanvasInlineEdit =
	| {
		readonly kind: 'rename';
		readonly context: IBaseHalfCanvasActionContext;
		readonly resource: URI;
		readonly parent: URI;
		readonly path: string;
		/**
		 * The extension that the file of a note keeps. The editor then holds the
		 * name without it. Empty for an item that is renamed by its file name.
		 */
		readonly extension: string;
		readonly initialValue: string;
		value: string;
		selectionPending: boolean;
		/** Why the name could not be applied, until an editor has shown it. */
		failure?: string;
	}
	| {
		readonly kind: 'create';
		readonly context: IBaseHalfCanvasActionContext;
		readonly parent: URI;
		readonly createKind: Exclude<BaseHalfCanvasCreateKind, 'note' | 'resultNode'>;
		readonly initialValue: string;
		readonly anchor: { readonly x: number; readonly y: number };
		readonly canvasPosition: { readonly x: number; readonly y: number };
		value: string;
		selectionPending: boolean;
		/** Why the name could not be applied, until an editor has shown it. */
		failure?: string;
	};

export const CANVAS_MARKDOWN_FULL_EDITOR_LABEL = localize(
	'basehalf.canvas.note.fullEditorRequired',
	"This Markdown file is too large for quick edit. Double-click to open the full editor."
);

// Video is the authored object on this canvas, not a thumbnail inside a generic
// result card. Its title is external chrome, so the node itself is a true 16:9
// stage rather than a media frame plus an internal header.
export const BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_WIDTH = 720;

export const BASEHALF_CANVAS_DEFAULT_VIDEO_NODE_HEIGHT = 405;

/** The key of the scene the canvas shows when no folder is open. */
export const BASEHALF_CANVAS_NO_FOLDER_SCENE_KEY = 'no-folder';

export function reverseCanvasStateTransition(transition: IBaseHalfCanvasStateTransition, reverse: boolean): IBaseHalfCanvasStateTransition {
	if (!reverse) {
		return transition;
	}
	return {
		cards: transition.cards?.map(card => ({ ...card, expected: card.next, next: card.expected })),
		edges: transition.edges?.map(edge => ({ ...edge, expected: edge.next, next: edge.expected }))
	};
}

export function uniqueUris(resources: readonly URI[]): readonly URI[] {
	return [...new Map(resources.map(resource => [resource.toString(), resource])).values()];
}

export function roundCanvasPosition(value: number): number {
	return Number(value.toFixed(2));
}

/** The label a Note card shows instead of a note it cannot show. */
export function appendCanvasNoteFullEditorLabel(container: HTMLElement): void {
	const label = append(container, $('span.basehalf-canvas-note-empty.basehalf-canvas-note-full-editor-required'));
	label.setAttribute('data-testid', 'canvas-note-full-editor-required');
	label.textContent = CANVAS_MARKDOWN_FULL_EDITOR_LABEL;
}

export function baseHalfReferenceLabel(relativePath: string): string {
	const trimmed = relativePath.replace(/\/+$/, '');
	if (!trimmed) {
		return 'Workspace root';
	}

	const slash = trimmed.lastIndexOf('/');
	return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

export function isVideoNodePreview(preview: BaseHalfCanvasCardPreview | undefined): preview is BaseHalfCanvasNodePreview {
	return preview?.kind === 'node' && preview.document.kind === 'video';
}

export function cardDisplayName(item: IBaseHalfCanvasItem, preview: BaseHalfCanvasCardPreview | undefined): string {
	return preview?.kind === 'node' ? preview.document.title : baseHalfItemDisplayName(item.name, item.kind === 'folder');
}

export function baseHalfBadgeResourceIdentity(stat: Pick<IFileStat, 'ctime' | 'isFile' | 'isDirectory' | 'isSymbolicLink'>): string {
	const kind = stat.isFile ? 'file' : stat.isDirectory ? 'folder' : 'other';
	// Local providers expose creation time, which stays stable across ordinary
	// writes but changes when a path is deleted and recreated. Providers that
	// report zero fall back to the structural path epoch carried separately.
	const creation = typeof stat.ctime === 'number' && stat.ctime > 0 ? stat.ctime : 'unavailable';
	return `${kind}:${stat.isSymbolicLink ? 'link' : 'direct'}:${creation}`;
}

export function badgeType(label: string, isFolder: boolean): BaseHalfItemKindIcon {
	return baseHalfItemIcon(label, isFolder);
}
