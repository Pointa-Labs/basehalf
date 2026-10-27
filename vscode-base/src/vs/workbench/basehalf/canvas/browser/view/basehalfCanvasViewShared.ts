/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../../base/browser/dom.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { basename, joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService, IFileStat } from '../../../../../platform/files/common/files.js';
import { findValidPasteFileTargetForResource, incrementFileName } from '../../../../contrib/files/browser/fileActions.js';
import { baseHalfGenerationDraftNameRule, BaseHalfGenerationKind, baseHalfGenerationKindOfPath, baseHalfGenerationNameOrdinal, baseHalfGenerationNameParts } from '../../../video/common/basehalfGenerationInfo.js';
import { IBaseHalfCanvasItem } from '../../common/basehalfCanvasModel.js';
import { IBaseHalfBadgeNode } from '../../../references/common/basehalfBadgeMirror.js';
import { IBaseHalfCanvasDamage, IBaseHalfCanvasStateTransition } from '../../common/basehalfCanvasMirror.js';
import { IBaseHalfActiveCanvasEditor, IBaseHalfCanvasNavigationState, IBaseHalfCardDetailState } from '../../../navigation/common/basehalfCanvasNavigation.js';
import { BaseHalfCanvasNoteFormatNavigationOwnership, IBaseHalfCanvasNoteFocusLease } from '../../common/basehalfCanvasNoteFormatLifecycle.js';
import { IBaseHalfCanvasActionContext } from '../../common/basehalfCanvasActionContext.js';
import { baseHalfItemDisplayName } from '../../../cardDetail/common/basehalfCardDetail.js';
import { BaseHalfItemKindIcon, baseHalfItemIcon } from '../../../agentArea/common/basehalfAgentSelection.js';
import { BaseHalfCanvasMarkdownInlineEditor, IBaseHalfCanvasMarkdownInlineSelection } from '../basehalfCanvasMarkdownInlineEditor.js';
import { IBaseHalfCanvasNoteEditPoint } from '../../common/basehalfCanvasScene.js';
import type { BaseHalfMarkdownFormatCommand } from '../../../markdown/common/basehalfMarkdownFormatting.js';
import { BaseHalfCanvasCardPreview } from '../../common/basehalfCanvasCardPreview.js';
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
	/** What the card's badge toggle shows of its connections, drawn again in place when only that changes. */
	readonly connectionsKey: string;
	readonly sceneKey: string;
	readonly element: HTMLElement;
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

/**
 * A card's name while it is changed in place (canvas card name). It is the
 * canvas's only name editor: a new item is made with a name of its own and
 * renamed afterwards (canvas Create menu).
 */
export type BaseHalfCanvasInlineEdit = {
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
	/** The item is a draft of this kind: renaming it moves its card information, and its name keeps an extension of its kind. */
	readonly draft?: BaseHalfGenerationKind;
	readonly initialValue: string;
	value: string;
	selectionPending: boolean;
	/** Why the name could not be applied, until an editor has shown it. */
	failure?: string;
};

export const CANVAS_MARKDOWN_FULL_EDITOR_LABEL = localize(
	'basehalf.canvas.note.fullEditorRequired',
	"This Markdown file is too large for quick edit. Double-click to open the full editor."
);

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

/** The preview of a video file's card: its player stays while the card is selected or deselected. */
export function isVideoMediaPreview(preview: BaseHalfCanvasCardPreview | undefined): boolean {
	return preview?.kind === 'media' && preview.mediaKind === 'video';
}

/** The name a card's caption shows: a note's name without its extension, and every other file's and folder's name, a draft's the name its file will have. */
export function cardDisplayName(item: IBaseHalfCanvasItem): string {
	return baseHalfItemDisplayName(item.name, item.kind === 'folder');
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

/**
 * Why a draft cannot take a name: a draft keeps its kind, so its name ends
 * with an extension of that kind (canvas card name, "The editor in place").
 */
export function baseHalfCanvasDraftNameProblem(name: string, kind: BaseHalfGenerationKind): string | undefined {
	return baseHalfGenerationKindOfPath(name) === kind ? undefined : baseHalfGenerationDraftNameRule(kind);
}

/**
 * The path the copy of a generation card takes in `folder` (generation
 * cards, "Moving, renaming, copying, and undo"): its own name where that is
 * free, and the next free number after its own otherwise, as `nextFreeName`
 * numbers from an ordinal on, never a path that `isReserved` reports, such as
 * the one another copy of the same paste took.
 */
export async function baseHalfCanvasGenerationCopyTarget(
	folder: URI,
	name: string,
	nextFreeName: (base: string, extension: string, startOrdinal: number) => Promise<string>,
	isReserved: (candidate: URI) => boolean
): Promise<URI> {
	const { base, extension } = baseHalfGenerationNameParts(name);
	for (let ordinal = baseHalfGenerationNameOrdinal(name); ;) {
		const free = await nextFreeName(base, extension, ordinal);
		const target = joinPath(folder, free);
		if (!isReserved(target)) {
			return target;
		}
		ordinal = baseHalfGenerationNameOrdinal(free) + 1;
	}
}

/**
 * The path a file or folder takes in `folder`, named as the Explorer names an
 * item pasted there, where a name that `isTaken` reports, such as a draft's
 * (generation cards, "Creating a generation card"), is taken as a file's is:
 * the next name the Explorer would give is tried until one is free.
 * `undefined` when the user declined to overwrite.
 */
export async function baseHalfCanvasFreeTransferTarget(
	fileService: IFileService,
	dialogService: IDialogService,
	folder: URI,
	source: URI,
	isDirectory: boolean,
	allowOverwrite: boolean,
	incrementalNaming: 'simple' | 'smart' | 'disabled',
	isTaken: (candidate: URI) => Promise<boolean>
): Promise<URI | undefined> {
	let target = await findValidPasteFileTargetForResource(fileService, dialogService, folder, { resource: source, isDirectory, allowOverwrite }, incrementalNaming);
	const naming = incrementalNaming === 'disabled' ? 'smart' : incrementalNaming;
	for (let attempt = 0; target && attempt < 1000 && await isTaken(target); attempt++) {
		let name = basename(target);
		do {
			name = incrementFileName(name, isDirectory, naming);
		} while (await fileService.exists(joinPath(folder, name)));
		target = joinPath(folder, name);
	}
	return target;
}
