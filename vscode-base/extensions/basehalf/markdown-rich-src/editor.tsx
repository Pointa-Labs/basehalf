/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import './editor.css';

import type { BlockNoteEditor } from '@blocknote/core';
import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu, SideMenuExtension } from '@blocknote/core/extensions';
import { en, zh, zhTW, type Dictionary } from '@blocknote/core/locales';
import { BlockNoteView, type Theme } from '@blocknote/mantine';
import {
	AddButton,
	DeleteButton,
	DeleteLinkButton,
	DragHandleMenu,
	EditLinkButton,
	FilePanel,
	FilePanelController,
	FileReplaceButton,
	FormattingToolbar,
	FormattingToolbarController,
	GenericPopover,
	LinkToolbar,
	LinkToolbarController,
	RemoveBlockItem,
	SideMenu,
	SuggestionMenuController,
	TableHandle,
	TableHandleMenu,
	TableHandlesController,
	UploadTab,
	getDefaultReactSlashMenuItems,
	getFormattingToolbarItems,
	useBlockNoteEditor,
	useComponentsContext,
	useCreateBlockNote,
	useDictionary,
	useExtensionState,
	useSelectedBlocks,
	type DefaultReactSuggestionItem,
	type FilePanelProps,
	type FloatingUIOptions,
	type GenericPopoverReference,
	type LinkToolbarProps,
	type TableCellButtonProps,
	type TableHandleProps,
} from '@blocknote/react';
import { RiExternalLinkFill, RiImageEditFill } from 'react-icons/ri';
import { applyUpdate, Doc as YDoc, UndoManager, type Transaction as YTransaction, type XmlFragment, type YMapEvent } from 'yjs';
import { ySyncPluginKey } from 'y-prosemirror';
import { TextSelection, type EditorState } from '@tiptap/pm/state';
import { createRoot } from 'react-dom/client';
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type FunctionComponent,
	type JSX,
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent as ReactMouseEvent,
} from 'react';
import {
	baseHalfMarkdownBlockPath,
	baseHalfMarkdownBlockReadSpan,
	baseHalfMarkdownLinesToBlockIds,
	baseHalfMarkdownLinesToShownBlockIds,
	countBaseHalfMarkdownNewlines,
	type IBaseHalfMarkdownBlockNode,
} from '../../../src/vs/workbench/basehalf/markdown/common/basehalfMarkdownBlockLines.js';
import { BASEHALF_AGENT_SELECTION_TEXT_LIMIT, baseHalfSelectionLines } from '../../../src/vs/workbench/basehalf/agentArea/common/basehalfSelectionLines.js';
import {
	type IBaseHalfAdhdCommand,
	type IBaseHalfAdhdFile,
} from '../../../src/vs/workbench/basehalf/markdown/common/basehalfAdhd.js';
import {
	adoptBaseHalfMarkdownLoadProjection,
	BASEHALF_RAW_PASSTHROUGH_BLOCK,
	buildBaseHalfMarkdownLoadProjection,
	collectBaseHalfMarkdownSaveContributions,
	createBaseHalfMarkdownNote,
	planBaseHalfMarkdownMerge,
	spliceBaseHalfMarkdownSave,
	splitBaseHalfMarkdownFrontmatter,
	type IBaseHalfMarkdownEditorApi,
	type IBaseHalfMarkdownNote,
	type IBaseHalfMarkdownReuseEntry,
	type IBaseHalfMarkdownSaveContribution,
} from '../../../src/vs/workbench/basehalf/markdown/common/basehalfMarkdownProjection.js';
import { createBaseHalfNoteEditorApi, type IBaseHalfNoteWriteWarning } from './noteConversions.js';
import { installBaseHalfNoteCopy } from './noteCopy.js';
import { addBaseHalfNoteItems, baseHalfNoteDropCursor, chooseBaseHalfNoteMedia, showBaseHalfNoteDropPoint, installBaseHalfNoteResizeUnderZoom, makeBaseHalfNoteFileDropExtension, type BaseHalfNoteItemsRequest, type BaseHalfNoteMediaChoice, type IBaseHalfNoteItems, type IBaseHalfNoteStoredFile } from './noteMedia.js';
import { baseHalfNoteLinkPath } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfNoteFileLinks.js';
import { installBaseHalfNoteBlockIndex } from './noteBlockIndex.js';
import { installBaseHalfNotePaste, makeBaseHalfNotePasteHandler } from './notePaste.js';
import { baseHalfNoteUnwrittenKey, makeBaseHalfNoteShapeExtension } from './noteShape.js';
import { BASEHALF_NOTE_PALETTE, BASEHALF_NOTE_PALETTE_COLORS } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfNotePalette.js';
import { baseHalfNoteToggleState, installBaseHalfNoteToggleState, openBaseHalfNoteStoredOpenToggles } from './noteToggleState.js';
import { installBaseHalfSidewaysScrollbar } from '../../../src/vs/workbench/basehalf/shell/browser/basehalfSidewaysScrollbar.js';
import { isBaseHalfZoomWheel } from '../../../src/vs/workbench/basehalf/cardDetail/common/basehalfCardDetailZoom.js';
import { BaseHalfNoteZoom } from '../../../src/vs/workbench/basehalf/cardDetail/browser/basehalfNoteZoom.js';
import { BaseHalfNoteOutline, baseHalfNoteOutlineHeadings, openBaseHalfNoteTogglesAround } from '../../../src/vs/workbench/basehalf/cardDetail/browser/basehalfNoteOutline.js';
import { BASEHALF_NOTE_OUTLINE_MIN_MARGIN_WITH_HANDLES } from '../../../src/vs/workbench/basehalf/cardDetail/common/basehalfNoteOutlineLayout.js';
import {
	BASEHALF_BLOCK_HANDLES_GAP,
	baseHalfBlockHandlesDrop,
	baseHalfBlockHandlesPointer,
	measureBaseHalfBlockHandles,
	type IBaseHalfBlockHandlesAnchor,
} from '../../../src/vs/workbench/basehalf/cardDetail/browser/basehalfBlockHandles.js';
import {
	makeBaseHalfAdhdDecorationExtension,
	pushBaseHalfAdhdDecorations,
} from './adhdDecorations.js';
import {
	makeBaseHalfSelectionRevealExtension,
	setBaseHalfSelectionReveal,
} from './selectionRevealDecorations.js';
import { baseHalfEditorLabel, baseHalfNoteSchema, renderedNote } from './noteSchema.js';
import { baseHalfNoteFileAddressAt, baseHalfNoteMediaElement, makeBaseHalfNoteMediaEditExtension, setBaseHalfNoteMediaEditMark } from './noteMediaEdit.js';
import { BASEHALF_IMAGE_CROP_MARGIN, BASEHALF_NOTE_PICTURE_EDIT_ROOM } from '../../../src/vs/workbench/basehalf/mediaEdit/common/basehalfNoteMediaEdit.js';
import { createBaseHalfNoteUndo, type IBaseHalfNoteUndo } from './noteUndo.js';
import {
	BASEHALF_MARKDOWN_ATTACHMENT_MAX_BYTES,
	isBaseHalfMarkdownRichHostMessage,
	type BaseHalfMarkdownRichEditorCommand,
	type BaseHalfMarkdownRichSurface,
	type BaseHalfMarkdownRichWebviewMessage,
	type IBaseHalfMarkdownRichFormatState,
	type IBaseHalfMarkdownRichFileLink,
	type IBaseHalfMarkdownRichTextSelection,
} from '../../../src/vs/workbench/basehalf/markdown/common/basehalfMarkdownRichWebviewProtocol.js';
import type { BaseHalfMarkdownFormatBlockType, BaseHalfMarkdownFormatToggleState } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfMarkdownFormatting.js';
import { baseHalfCaptureStableMarkdownRichSnapshot } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfMarkdownRichStructuralSave.js';
import { joinBaseHalfMarkdownRichFrontmatter } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfMarkdownRichSession.js';
import { BaseHalfMarkdownRichAsyncMutationBarrier } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfMarkdownRichAsyncMutation.js';

interface VsCodeApi {
	postMessage(message: BaseHalfMarkdownRichWebviewMessage, transfer?: readonly ArrayBuffer[]): void;
	getState(): unknown;
	setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const BLOCKNOTE_FRAGMENT_NAME = 'bn';
// Mirrors BASEHALF_AUTO_SAVE_DELAY_MS in
// src/vs/workbench/basehalf/shell/common/basehalfWorkbenchProfile.ts — the webview
// bundle cannot import workbench code. Keep the two in sync.
const AUTOSAVE_MS = 250;

function baseHalfBlockNoteDictionary(): Dictionary {
	const locale = document.documentElement.lang.toLowerCase();
	return locale.startsWith('zh-tw') || locale.startsWith('zh-hk')
		? zhTW
		: locale.startsWith('zh') ? zh : en;
}

const baseHalfBlockNoteTheme: Theme = {
	colors: {
		editor: { text: 'var(--vscode-editor-foreground)', background: 'transparent' },
		menu: { text: 'var(--vscode-menu-foreground)', background: 'var(--vscode-menu-background)' },
		tooltip: { text: 'var(--vscode-editorHoverWidget-foreground)', background: 'var(--vscode-editorHoverWidget-background)' },
		hovered: { text: 'var(--vscode-menu-selectionForeground)', background: 'var(--vscode-menu-selectionBackground)' },
		selected: { text: 'var(--vscode-list-activeSelectionForeground)', background: 'var(--vscode-list-activeSelectionBackground)' },
		disabled: { text: 'var(--vscode-disabledForeground)', background: 'transparent' },
		shadow: '0 4px 18px rgb(0 0 0 / 28%)',
		border: 'var(--vscode-widget-border)',
		sideMenu: 'var(--vscode-descriptionForeground)',
		// The nine colors as the note stores them, in every appearance (note formats, rules 46 and 47).
		highlights: Object.fromEntries(BASEHALF_NOTE_PALETTE_COLORS.map(name => [name, { ...BASEHALF_NOTE_PALETTE[name] }])),
	},
	borderRadius: 4,
	fontFamily: 'var(--vscode-font-family)',
};

function workbenchColorScheme(): 'light' | 'dark' {
	return document.body.classList.contains('vscode-light') || document.body.classList.contains('vscode-high-contrast-light')
		? 'light'
		: 'dark';
}

interface SessionState {
	key: string;
	surface: BaseHalfMarkdownRichSurface;
	resource: string;
	baseUri: string;
	frontmatter: string;
	byId: Map<string, IBaseHalfMarkdownReuseEntry>;
	/** What the projection keeps of the note from its load to its saves. */
	note: IBaseHalfMarkdownNote;
	adhd: IBaseHalfAdhdFile | null;
	adhdError: string | undefined;
	readingModeEnabled: boolean;
	readBlockIds: Set<string>;
	lastDisk: string;
	editable: boolean;
	ready: boolean;
	dirty: boolean;
	structuralFrozen: boolean;
	editRevision: number;
	lastAcknowledgedRevision: number;
	loading: boolean;
	pendingSaveContent: Map<string, { readonly content: string; readonly revision: number }>;
	conflictDisk: string | undefined;
	writeError: string | undefined;
	/** The blocks the last save wrote without their formats (note formats, design A5). */
	unwrittenBlocks: ReadonlySet<string>;
}

interface IIncomingInit {
	readonly content: string;
	readonly editable: boolean;
	readonly key: string;
	readonly resource: string;
	readonly baseUri: string;
	readonly surface: BaseHalfMarkdownRichSurface;
	readonly selection?: IBaseHalfMarkdownRichTextSelection;
	readonly reducedMotion?: boolean;
	/** Arrival order; a payload older than the latest arrival is stale. */
	readonly generation: number;
}

/** The zoom and the outline of a note in Card Detail (zoom and outline of a note). */
interface IReadingAids {
	readonly zoom: BaseHalfNoteZoom;
	readonly outline: BaseHalfNoteOutline;
	/** Gives the document back its own way of finding the elements at a point. */
	readonly restoreLookUp: () => void;
	reducedMotion: boolean;
}

/** How far inside the view a point past it is looked up: clear of the scroll bars, which the browser finds at the view's edges. */
const LOOK_UP_INSIDE_VIEW = 24;

/**
 * BlockNote finds the block under the pointer, then looks once more at the
 * right edge of that block, on the pointer's line, and hides the handles of a
 * block when the browser finds nothing there. Past the edge of the view the
 * browser finds nothing, and a magnified page carries the right edge of a
 * block there (zoom and outline of a note, rules 5 and 24): a point past the
 * view is looked up inside it, on the same line. A point in the view is looked
 * up where it is.
 */
function lookUpWithinView(view: HTMLElement): () => void {
	const lookUp = document.elementsFromPoint;
	const inside = (at: number, start: number, length: number) => at >= start && at < start + length ? at : Math.min(Math.max(at, start + LOOK_UP_INSIDE_VIEW), start + length - LOOK_UP_INSIDE_VIEW);
	document.elementsFromPoint = (x, y) => {
		const box = view.getBoundingClientRect();
		return lookUp.call(document, inside(x, box.left + view.clientLeft, view.clientWidth), inside(y, box.top + view.clientTop, view.clientHeight));
	};
	return () => {
		document.elementsFromPoint = lookUp;
	};
}

const macintosh = /Mac/.test(navigator.platform);

interface ContextMenuItem {
	readonly id: string;
	readonly label: string;
	readonly enabled?: boolean;
	readonly run: () => void;
}

interface ContextMenuState {
	readonly x: number;
	readonly y: number;
	readonly items: readonly ContextMenuItem[];
}

function createSessionState(key = ''): SessionState {
	return {
		key,
		surface: 'detail',
		resource: '',
		baseUri: '',
		frontmatter: '',
		byId: new Map(),
		note: createBaseHalfMarkdownNote(''),
		adhd: null,
		adhdError: undefined,
		readingModeEnabled: false,
		readBlockIds: new Set(),
		lastDisk: '',
		editable: false,
		ready: false,
		dirty: false,
		structuralFrozen: false,
		editRevision: 0,
		lastAcknowledgedRevision: 0,
		loading: true,
		pendingSaveContent: new Map(),
		conflictDisk: undefined,
		writeError: undefined,
		unwrittenBlocks: new Set(),
	};
}

function copyTransferable(update: Uint8Array): { readonly update: ArrayBuffer; readonly transfer: readonly ArrayBuffer[] } {
	const copy = new Uint8Array(update.byteLength);
	copy.set(update);
	return { update: copy.buffer, transfer: [copy.buffer] };
}

function nextRequestId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function firstVisibleBlockId(editorElement: HTMLElement | undefined, scrollElement: HTMLElement | null): string | undefined {
	if (!editorElement || !scrollElement) {
		return undefined;
	}

	const scrollTop = scrollElement.getBoundingClientRect().top;
	const candidates = Array.from(editorElement.querySelectorAll<HTMLElement>('[data-id]'));
	let best: { readonly id: string; readonly distance: number } | undefined;
	for (const candidate of candidates) {
		const id = candidate.dataset.id;
		if (!id) {
			continue;
		}
		const rect = candidate.getBoundingClientRect();
		if (rect.bottom < scrollTop) {
			continue;
		}
		const distance = Math.abs(rect.top - scrollTop);
		if (!best || distance < best.distance) {
			best = { id, distance };
		}
	}
	return best?.id;
}

function findBlockElement(editorElement: HTMLElement | undefined, id: string): HTMLElement | null {
	return editorElement?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`) ?? null;
}

function baseHalfFormatBlockType(block: { readonly type: string; readonly props: Record<string, unknown> }): BaseHalfMarkdownFormatBlockType {
	switch (block.type) {
		case 'paragraph':
			return 'paragraph';
		case 'heading':
			switch (block.props.level) {
				case 1: return 'heading1';
				case 2: return 'heading2';
				case 3: return 'heading3';
				default: return 'other';
			}
		case 'bulletListItem':
			return 'bulletList';
		case 'numberedListItem':
			return 'orderedList';
		default:
			return 'other';
	}
}

function baseHalfSelectionBlockType(blocks: readonly { readonly type: string; readonly props: Record<string, unknown> }[]): BaseHalfMarkdownFormatBlockType {
	if (blocks.length === 0) {
		return 'other';
	}
	const blockTypes = new Set(blocks.map(baseHalfFormatBlockType));
	return blockTypes.size === 1 ? blockTypes.values().next().value ?? 'other' : 'mixed';
}

function baseHalfSelectionMarkState(state: EditorState, markName: string): BaseHalfMarkdownFormatToggleState {
	const markType = state.schema.marks[markName];
	if (!markType) {
		return false;
	}

	const { from, to, empty, $from } = state.selection;
	if (empty) {
		return !!markType.isInSet(state.storedMarks ?? $from.marks());
	}

	let marked = 0;
	let unmarked = 0;
	state.doc.nodesBetween(from, to, (node, position) => {
		if (!node.isText) {
			return;
		}
		const overlap = Math.max(0, Math.min(to, position + node.nodeSize) - Math.max(from, position));
		if (overlap === 0) {
			return;
		}
		if (markType.isInSet(node.marks)) {
			marked += overlap;
		} else {
			unmarked += overlap;
		}
	});

	return marked > 0 && unmarked > 0 ? 'mixed' : marked > 0;
}

function baseHalfCanChangeBlockType(block: { readonly type: string; readonly content?: unknown }): boolean {
	switch (block.type) {
		case 'paragraph':
		case 'heading':
		case 'bulletListItem':
		case 'numberedListItem':
		case 'checkListItem':
		case 'quote':
			return block.content !== undefined;
		default:
			return false;
	}
}

function baseHalfBlockMatchesEditableType(
	block: { readonly type: string; readonly props: Record<string, unknown> },
	type: BaseHalfEditableBlockType,
): boolean {
	switch (type) {
		case 'paragraph':
			return block.type === 'paragraph';
		case 'heading1':
		case 'heading2':
		case 'heading3':
			return block.type === 'heading'
				&& block.props.level === Number(type.at(-1))
				&& block.props.isToggleable === false;
		case 'bulletList':
			return block.type === 'bulletListItem';
		case 'orderedList':
			return block.type === 'numberedListItem';
	}
}

type BaseHalfEditableBlockType = 'paragraph' | 'heading1' | 'heading2' | 'heading3' | 'bulletList' | 'orderedList';

// Wires the `[[` gesture to workspace file search: picking a file inserts a
// plain Markdown link (relative href). It is navigation for people and Agents;
// the explicit BaseHalf reference graph is intentionally untouched. The menu triggers
// on `[` with a same-character lookbehind — the suggestion plugin's own
// multi-character matching only works at a block start — and the leftover
// opening bracket is removed when a file is picked.
function BaseHalfFileLinkMenu({ searchFiles }: {
	readonly searchFiles: (query: string) => Promise<readonly IBaseHalfMarkdownRichFileLink[]>;
}): JSX.Element {
	const editor = useBlockNoteEditor();
	const shouldOpen = useCallback((transaction: { readonly selection: { readonly $from: { readonly nodeBefore: { readonly text?: string } | null } } }) => {
		return transaction.selection.$from.nodeBefore?.text?.endsWith('[') ?? false;
	}, []);

	return (
		<SuggestionMenuController
			triggerCharacter={'['}
			shouldOpen={shouldOpen}
			getItems={async query => {
				const files = await searchFiles(query);
				return files.map(file => ({
					title: file.name,
					subtext: file.path,
					onItemClick: () => {
						const view = editor.prosemirrorView;
						if (view) {
							const from = view.state.selection.from;
							if (view.state.doc.textBetween(from - 1, from) === '[') {
								view.dispatch(view.state.tr.delete(from - 1, from));
							}
						}
						editor.insertInlineContent([
							{ type: 'link', href: file.href, content: file.name },
							' ',
						]);
					},
				}));
			}}
		/>
	);
}

/**
 * The menus, lists, and panels of the page that close on Escape themselves:
 * BlockNote's suggestion menus (slash, files, emoji), its dropdown menus
 * (block, table, colors), and its file panel. The handle beside a block and
 * the toolbar of a selection take no Escape.
 */
const ESCAPE_OWNER_SELECTOR = '.bn-suggestion-menu, .bn-grid-suggestion-menu, .bn-menu-dropdown, .bn-panel, .bn-emoji-picker-popover, .bn-table-handle-menu, [role="dialog"], [role="menu"], [role="listbox"]';

function hasOpenEscapeOwner(): boolean {
	for (const element of document.querySelectorAll<HTMLElement>(ESCAPE_OWNER_SELECTOR)) {
		if (element.getClientRects().length > 0) {
			return true;
		}
	}
	return false;
}

/** A middleware of the floating-ui that places BlockNote's popovers. */
type FloatingMiddleware = NonNullable<NonNullable<FloatingUIOptions['useFloatingOptions']>['middleware']>[number];

// The handles of a block, add and drag, stand left of the root column of
// blocks, so that those of a nested block keep off the indent guide of its
// list or quote, beside the first line of the block under the pointer as the
// page is drawn in this frame (zoom and outline of a note, rules 22 to 24).
// BlockNote's own reference is the block's box when the pointer reached it,
// which a zoom, a scroll, or a new layout leaves behind; the handles measure
// the block each time floating-ui places them instead.
function BaseHalfSideMenuController({ portalElement }: { readonly portalElement: HTMLElement | null }): JSX.Element {
	const editor = useBlockNoteEditor();
	const state = useExtensionState(SideMenuExtension, {
		editor,
		selector: state => state !== undefined ? {
			show: state.show,
			blockId: state.block.id,
		} : undefined,
	});
	const anchor = useRef<IBaseHalfBlockHandlesAnchor | undefined>(undefined);
	// When the page moves under a pointer that stays still, the handles pass to
	// the block that is then under it, as if it had moved: the editor finds
	// that block by a move of the pointer. A key or a held button, and a
	// pointer that has left the page, leave the handles to the next real move.
	useEffect(() => {
		let pointer: { readonly x: number; readonly y: number } | undefined;
		const onMouse = (event: MouseEvent): void => {
			if (event.isTrusted) {
				pointer = baseHalfBlockHandlesPointer(event);
			}
		};
		const forget = (): void => {
			pointer = undefined;
		};
		const onMouseOut = (event: MouseEvent): void => {
			if (!event.relatedTarget) {
				forget();
			}
		};
		const onPageMove = (): void => {
			if (pointer && !editor.prosemirrorView.dragging) {
				document.elementFromPoint(pointer.x, pointer.y)?.dispatchEvent(new MouseEvent('mousemove', { clientX: pointer.x, clientY: pointer.y, bubbles: true }));
			}
		};
		const options = { capture: true, passive: true };
		document.addEventListener('mousemove', onMouse, options);
		document.addEventListener('mousedown', onMouse, options);
		document.addEventListener('mouseup', onMouse, options);
		document.addEventListener('mouseout', onMouseOut, options);
		document.addEventListener('keydown', forget, options);
		// Scroll events do not bubble; a zoom sends one for each frame it draws.
		document.addEventListener('scroll', onPageMove, options);
		window.addEventListener('resize', onPageMove);
		return () => {
			document.removeEventListener('mousemove', onMouse, options);
			document.removeEventListener('mousedown', onMouse, options);
			document.removeEventListener('mouseup', onMouse, options);
			document.removeEventListener('mouseout', onMouseOut, options);
			document.removeEventListener('keydown', forget, options);
			document.removeEventListener('scroll', onPageMove, options);
			window.removeEventListener('resize', onPageMove);
		};
	}, [editor]);
	const reference = useMemo<GenericPopoverReference | undefined>(() => {
		const blockId = state?.blockId;
		if (!state?.show || blockId === undefined) {
			return undefined;
		}
		const editorElement = editor.prosemirrorView.dom;
		return {
			// Floating-ui places the handles again when the view the editor is
			// in scrolls, which a zoom also announces for each frame it draws,
			// and when the editor moves or changes its size.
			element: editorElement,
			cacheMountedBoundingClientRect: false,
			getBoundingClientRect: () => {
				const column = editorElement.firstElementChild;
				const block = findBlockElement(editorElement, blockId);
				if (column instanceof HTMLElement && block) {
					anchor.current = measureBaseHalfBlockHandles(column, block);
				}
				return anchor.current?.box ?? new DOMRect();
			},
		};
	}, [editor, state?.blockId, state?.show]);
	const middleware = useMemo<FloatingMiddleware[]>(() => [{
		name: 'basehalfBlockHandles',
		fn: ({ x, y, rects }) => ({
			x: x - BASEHALF_BLOCK_HANDLES_GAP,
			y: y + baseHalfBlockHandlesDrop(rects.floating.height, anchor.current?.scale ?? 1),
		}),
	}], []);

	return (
		<GenericPopover
			reference={reference}
			portalElement={portalElement ?? undefined}
			useFloatingOptions={{
				open: state?.show,
				placement: 'left-start',
				middleware,
			}}
			useDismissProps={{ enabled: false }}
			focusManagerProps={{ disabled: true }}
			elementProps={{ style: { zIndex: 20 } }}
		>
			{state?.blockId && <SideMenu dragHandleMenu={BaseHalfDragHandleMenu} />}
		</GenericPopover>
	);
}

/** The note's map of picture edits (D113): the choices of each picture file's edit that the note's undo holds, never written to the file. */
const BASEHALF_NOTE_MEDIA_EDITS = 'basehalfNoteMediaEdits';
/** The origin of what an undo of a picture's edit goes back to, which no undo tracks. */
const BASEHALF_NOTE_MEDIA_EDIT_BASE = 'basehalf.noteMediaEdit.base';

function MarkdownRichEditor(): JSX.Element {
	const vscode = useMemo(() => acquireVsCodeApi(), []);
	const initialKey = useMemo(() => decodeHtmlKey(document.getElementById('root')?.dataset.basehalfKey ?? ''), []);
	const ydoc = useMemo(() => new YDoc(), []);
	const asyncMutationBarrier = useMemo(() => new BaseHalfMarkdownRichAsyncMutationBarrier(), []);
	const fragment = useMemo(() => ydoc.getXmlFragment(BLOCKNOTE_FRAGMENT_NAME), [ydoc]);
	const session = useRef(createSessionState(initialKey));
	const scrollRef = useRef<HTMLDivElement>(null);
	const readingAids = useRef<IReadingAids | undefined>(undefined);
	const saveTimer = useRef<number | undefined>(undefined);
	const composing = useRef(false);
	const pendingEditorCommands = useRef<BaseHalfMarkdownRichEditorCommand[]>([]);
	const lastPostedFormatState = useRef<string | undefined>(undefined);
	const compositionSettledWaiters = useRef(new Set<() => void>());
	const pendingSaveSettledWaiters = useRef(new Set<() => void>());
	const pendingInit = useRef<IIncomingInit | undefined>(undefined);
	const initGeneration = useRef(0);
	const renderedAnnounced = useRef(false);
	const pendingFileSearches = useRef(new Map<string, (files: readonly IBaseHalfMarkdownRichFileLink[]) => void>());
	const pendingAttachmentUploads = useRef(new Map<string, {
		readonly resolve: (stored: IBaseHalfNoteStoredFile) => void;
		readonly reject: (error: Error) => void;
		readonly timer: number;
	}>());
	const pendingItemRequests = useRef(new Map<string, {
		readonly resolve: (items: IBaseHalfNoteItems | undefined) => void;
		readonly timer: number;
	}>());
	const requestItemsRef = useRef<BaseHalfNoteItemsRequest>(async () => undefined);
	const pointFocusTimer = useRef<number | undefined>(undefined);
	const pointFocusFrame = useRef<number | undefined>(undefined);
	const yTransactionRevision = useRef(0);
	const lastYTransactionAt = useRef(performance.now());
	const revealTimer = useRef<number | undefined>(undefined);
	const adhdExtension = useMemo(() => makeBaseHalfAdhdDecorationExtension(), []);
	const selectionRevealExtension = useMemo(() => makeBaseHalfSelectionRevealExtension(), []);
	const noteUndoRef = useRef<IBaseHalfNoteUndo | undefined>(undefined);
	const noteMediaEditExtension = useMemo(() => makeBaseHalfNoteMediaEditExtension(), []);
	// The picture whose editor the window draws over it (D113), and the version of each file it edited, by address.
	const mediaEdit = useRef<{ readonly blockId: string; readonly url: string; readonly room: number; ending: boolean } | undefined>(undefined);
	const [editedMedia, setEditedMedia] = useState<string | undefined>(undefined);
	// After the editing, the toolbar waits for the pointer or a key: the page still takes the pointer to be where it pressed Edit.
	const [toolbarWaits, setToolbarWaits] = useState(false);
	const mediaVersions = useRef(new Map<string, string>());
	const fileDropExtension = useMemo(() => makeBaseHalfNoteFileDropExtension({ requestItems: (source, dropped) => requestItemsRef.current(source, dropped) }), []);
	// What is pasted is read as a note's file is read (note formats, rules 72 to 74), and the clipboard's items as the host puts them in (files in notes, rule 15).
	const pasteHandler = useMemo(() => makeBaseHalfNotePasteHandler((source, dropped) => requestItemsRef.current(source, dropped), () => session.current.resource || undefined), []);
	const noteShapeExtension = useMemo(() => makeBaseHalfNoteShapeExtension({
		openLink: href => openLinkRef.current(href),
		undoManager: () => noteUndoRef.current?.ensure(),
		reading: () => session.current.loading,
	}), []);
	// The link toolbar opens a link with the note's link router, not in the page.
	const linkToolbar = useMemo(() => function BaseHalfLinkToolbar(props: LinkToolbarProps): JSX.Element {
		return (
			<LinkToolbar {...props}>
				<EditLinkButton url={props.url} text={props.text} range={props.range} setToolbarOpen={props.setToolbarOpen} setToolbarPositionFrozen={props.setToolbarPositionFrozen} />
				<BaseHalfOpenLinkButton url={props.url} onOpen={href => openLinkRef.current(href)} />
				<DeleteLinkButton range={props.range} setToolbarOpen={props.setToolbarOpen} />
			</LinkToolbar>
		);
	}, []);
	const [contextMenu, setContextMenu] = useState<ContextMenuState | undefined>(undefined);
	const contextMenuRef = useRef<HTMLDivElement>(null);
	const [portalElement, setPortalElement] = useState<HTMLDivElement | null>(null);
	const [version, setVersion] = useState(0);
	const [colorScheme, setColorScheme] = useState<'light' | 'dark'>(workbenchColorScheme);

	useEffect(() => {
		const observer = new MutationObserver(() => setColorScheme(workbenchColorScheme()));
		observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
		return () => observer.disconnect();
	}, []);

	// A file put into the note is kept in the note's own folder, and its block
	// takes the stored file's name (files in notes, rules 12 and 21).
	const uploadFile = useCallback((file: File): Promise<IBaseHalfNoteStoredFile> => asyncMutationBarrier.run(async () => {
		const state = session.current;
		if (!state.key || !state.ready || !state.editable || state.structuralFrozen) {
			throw new Error(`Could not add ${file.name}: the note is read-only.`);
		}
		if (file.size > BASEHALF_MARKDOWN_ATTACHMENT_MAX_BYTES) {
			throw new Error(`Could not add ${file.name}: a note takes files of at most ${BASEHALF_MARKDOWN_ATTACHMENT_MAX_BYTES / 1024 / 1024} MB.`);
		}

		const data = await file.arrayBuffer();
		const requestId = `attachment-${nextRequestId()}`;
		return new Promise<IBaseHalfNoteStoredFile>((resolve, reject) => {
			const timer = window.setTimeout(() => {
				pendingAttachmentUploads.current.delete(requestId);
				reject(new Error(`Could not add ${file.name}: it took too long.`));
			}, 30_000);
			pendingAttachmentUploads.current.set(requestId, { resolve, reject, timer });
			vscode.postMessage({
				type: 'basehalf.markdownRich.attachmentUpload',
				key: state.key,
				requestId,
				name: file.name,
				mediaType: file.type,
				data,
			}, [data]);
		});
	}), [asyncMutationBarrier, vscode]);

	// Items that come with their paths, which the page cannot read, are put in
	// by the host: an item of the workspace linked where it is, a file from
	// elsewhere cloned into the note's folder (files in notes, rules 12 and 15).
	const requestItems = useCallback<BaseHalfNoteItemsRequest>((source, dropped) => asyncMutationBarrier.run(async () => {
		const state = session.current;
		if (!state.key || !state.ready || !state.editable || state.structuralFrozen) {
			return undefined;
		}
		const requestId = `items-${nextRequestId()}`;
		return new Promise<IBaseHalfNoteItems | undefined>(resolve => {
			// A clone takes no time, but a copy from another disk can take long.
			const timer = window.setTimeout(() => {
				pendingItemRequests.current.delete(requestId);
				resolve({ items: [], failures: [{ name: '', message: 'Could not add the files: it took too long.' }] });
			}, 600_000);
			pendingItemRequests.current.set(requestId, { resolve, timer });
			vscode.postMessage({ type: 'basehalf.markdownRich.itemsRequest', key: state.key, requestId, source, ...dropped });
		});
	}), [asyncMutationBarrier, vscode]);
	requestItemsRef.current = requestItems;

	const resolveFileUrl = useCallback(async (url: string): Promise<string> => {
		const address = noteFileAddress(url, session.current.baseUri);
		const version = address !== undefined ? mediaVersions.current.get(address) : undefined;
		return address === undefined ? url : version ? baseHalfNoteFileAddressAt(address, version) : address;
	}, []);

	// A link of the note goes where the note's link router sends it (note formats, rule 53).
	const openLink = useCallback((href: string): void => {
		const key = session.current.key;
		if (key && href) {
			vscode.postMessage({ type: 'basehalf.markdownRich.openResource', key, href });
		}
	}, [vscode]);
	const openLinkRef = useRef(openLink);
	openLinkRef.current = openLink;
	const editor = useCreateBlockNote({
		schema: baseHalfNoteSchema,
		dictionary: baseHalfBlockNoteDictionary(),
		uploadFile,
		resolveFileUrl,
		links: {
			// A click puts the caret in a link; Command-click (Ctrl-click) opens it, as editors of text do (rule 54).
			onClick: event => {
				if (!(event.metaKey || event.ctrlKey)) {
					return false;
				}
				const href = event.target instanceof Element ? event.target.closest('a')?.getAttribute('href') : undefined;
				if (!href) {
					return false;
				}
				openLinkRef.current(href);
				return true;
			},
		},
		extensions: [adhdExtension, selectionRevealExtension, noteShapeExtension, noteMediaEditExtension, fileDropExtension],
		dropCursor: baseHalfNoteDropCursor,
		pasteHandler,
		collaboration: {
			fragment: fragment as XmlFragment,
			user: { name: 'BaseHalf', color: 'var(--vscode-textLink-foreground)' },
		},
	});
	useEffect(() => {
		const onAfterTransaction = (): void => {
			yTransactionRevision.current += 1;
			lastYTransactionAt.current = performance.now();
		};
		ydoc.on('afterTransaction', onAfterTransaction);
		return () => ydoc.off('afterTransaction', onAfterTransaction);
	}, [ydoc]);
	const portalElements = useMemo(() => portalElement ? {
		formattingToolbar: portalElement,
		linkToolbar: portalElement,
		slashMenu: portalElement,
		emojiPicker: portalElement,
		sideMenu: portalElement,
		filePanel: portalElement,
		tableHandles: portalElement,
		comments: portalElement,
	} : undefined, [portalElement]);

	// Rich owns its collaboration undo manager, so that undo outlives the
	// plugin-view teardowns of this webview's startup (noteUndo.ts).
	const noteUndo = useMemo(() => createBaseHalfNoteUndo(editor), [editor]);
	noteUndoRef.current = noteUndo;

	/**
	 * Edit of a picture's toolbar (D113): the note makes room under the
	 * picture for the editor's tools and scrolls as little as shows the editor
	 * whole, and the window draws the editor over the picture.
	 */
	const editMedia = useCallback((blockId: string): void => {
		const state = session.current;
		const view = editor.prosemirrorView;
		const block = editor.getBlock(blockId);
		const scroller = scrollRef.current;
		const picture = baseHalfNoteMediaElement(editor.domElement, blockId);
		if (mediaEdit.current || !state.key || !state.ready || !state.editable || state.structuralFrozen || !view || !scroller || !picture
			|| block?.type !== 'image' || typeof block.props.url !== 'string' || !block.props.url) {
			return;
		}
		// The room is the editor's below the picture, in pixels of the screen however large the page is drawn.
		const room = BASEHALF_NOTE_PICTURE_EDIT_ROOM / (readingAids.current?.zoom.level ?? 1);
		mediaEdit.current = { blockId, url: block.props.url, room, ending: false };
		setEditedMedia(blockId);
		setBaseHalfNoteMediaEditMark(view, { blockId, room, hidden: false });
		const shown = picture.getBoundingClientRect();
		const bounds = scroller.getBoundingClientRect();
		const above = shown.top - BASEHALF_IMAGE_CROP_MARGIN - bounds.top;
		const below = shown.bottom + BASEHALF_NOTE_PICTURE_EDIT_ROOM - bounds.bottom;
		if (below > 0) {
			scroller.scrollTop += Math.min(below, Math.max(0, above));
		} else if (above < 0) {
			scroller.scrollTop += above;
		}
		const box = picture.getBoundingClientRect();
		vscode.postMessage({
			type: 'basehalf.markdownRich.editMedia',
			key: state.key,
			blockId,
			href: block.props.url,
			box: { left: box.left, top: box.top, width: box.width, height: box.height },
		});
	}, [editor, vscode]);

	/**
	 * The editing ended (D113): the picture shows its file at the version the
	 * window gave, once loaded, hidden under the editor, which glides to it;
	 * the room under it closes.
	 */
	const endMediaEdit = useCallback(async (blockId: string, version: string | undefined): Promise<void> => {
		const edit = mediaEdit.current;
		if (!edit || edit.blockId !== blockId) {
			return;
		}
		edit.ending = true;
		const address = noteFileAddress(edit.url, session.current.baseUri);
		const shown = address !== undefined && version ? baseHalfNoteFileAddressAt(address, version) : undefined;
		if (address !== undefined && version && shown) {
			mediaVersions.current.set(address, version);
			// Loaded before it shows: the note never shows the picture missing.
			const loaded = new Image();
			loaded.src = shown;
			await loaded.decode().catch(() => undefined);
		}
		if (mediaEdit.current !== edit) {
			return;
		}
		setBaseHalfNoteMediaEditMark(editor.prosemirrorView, { blockId, room: 0, hidden: true });
		const picture = baseHalfNoteMediaElement(editor.domElement, blockId);
		let size: { readonly width: number; readonly height: number } | undefined;
		if (picture && shown && picture.getAttribute('src') !== shown) {
			// The picture glides from its size to the size the note gives its new shape, with the editor, as the room closes.
			const from = { width: picture.offsetWidth, height: picture.offsetHeight };
			const hold = (held: { readonly width: number; readonly height: number }): void => {
				picture.style.width = `${held.width}px`;
				picture.style.height = `${held.height}px`;
			};
			hold(from);
			picture.src = shown;
			await picture.decode().catch(() => undefined);
			if (mediaEdit.current !== edit) {
				return;
			}
			picture.style.removeProperty('width');
			picture.style.removeProperty('height');
			size = { width: picture.offsetWidth, height: picture.offsetHeight };
			hold(from);
			if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
				picture.style.transition = 'width 200ms cubic-bezier(0.25, 1, 0.5, 1), height 200ms cubic-bezier(0.25, 1, 0.5, 1)';
				void picture.offsetHeight;
			}
			hold(size);
		}
		if (mediaEdit.current !== edit) {
			return;
		}
		const shownPicture = baseHalfNoteMediaElement(editor.domElement, blockId);
		const box = shownPicture?.getBoundingClientRect();
		// Where it stands once the glide ends, in pixels of the screen however large the page is drawn.
		const scale = box && shownPicture && shownPicture.offsetWidth > 0 ? box.width / shownPicture.offsetWidth : 1;
		vscode.postMessage({
			type: 'basehalf.markdownRich.mediaLaidOut',
			key: session.current.key,
			blockId,
			...(box && box.width > 0 && box.height > 0 ? { box: { left: box.left, top: box.top, width: size ? size.width * scale : box.width, height: size ? size.height * scale : box.height } } : {}),
		});
	}, [editor, vscode]);

	/**
	 * The edit of a picture from Edit to Done is one step of the note's undo
	 * (D113): a change of the note's map of picture edits, which is never
	 * written to the file. Its undo and redo give the window the choices
	 * before or after, which the picture's file gets.
	 */
	const recordMediaEdit = useCallback((url: string, step: { readonly before: object; readonly after: object }): void => {
		const manager = noteUndo.ensure();
		if (!manager) {
			return;
		}
		const edits = ydoc.getMap<string>(BASEHALF_NOTE_MEDIA_EDITS);
		if (!manager.scope.includes(edits)) {
			manager.addToScope(edits);
		}
		// What the step undoes to, set where no undo sees it.
		ydoc.transact(() => edits.set(url, JSON.stringify(step.before)), BASEHALF_NOTE_MEDIA_EDIT_BASE);
		manager.stopCapturing();
		ydoc.transact(() => edits.set(url, JSON.stringify(step.after)), ySyncPluginKey);
		manager.stopCapturing();
	}, [noteUndo, ydoc]);
	useEffect(() => {
		const edits = ydoc.getMap<string>(BASEHALF_NOTE_MEDIA_EDITS);
		const onChange = (event: YMapEvent<string>, transaction: YTransaction): void => {
			if (!(transaction.origin instanceof UndoManager)) {
				return;
			}
			for (const url of event.keysChanged) {
				const value = edits.get(url);
				if (value !== undefined) {
					vscode.postMessage({ type: 'basehalf.markdownRich.applyMediaChoices', key: session.current.key, href: url, choices: JSON.parse(value) });
				}
			}
		};
		edits.observe(onChange);
		return () => edits.unobserve(onChange);
	}, [vscode, ydoc]);

	/** An undo or a redo set the choices of a picture's file: every picture of that file shows it at its new version. */
	const showMediaVersion = useCallback((url: string, version: string): void => {
		const address = noteFileAddress(url, session.current.baseUri);
		if (address === undefined) {
			return;
		}
		mediaVersions.current.set(address, version);
		const shown = baseHalfNoteFileAddressAt(address, version);
		for (const content of editor.domElement?.querySelectorAll<HTMLElement>('.bn-block-content[data-content-type="image"]') ?? []) {
			const picture = content.querySelector('img.bn-visual-media');
			if (content.dataset.url === url && picture instanceof HTMLImageElement) {
				picture.src = shown;
			}
		}
	}, [editor]);

	/** The editor stands where the picture is: the note shows it again, and once it is drawn the editor goes (D113). */
	const showEditedMedia = useCallback((blockId: string): void => {
		if (mediaEdit.current?.blockId !== blockId) {
			return;
		}
		mediaEdit.current = undefined;
		setToolbarWaits(true);
		setEditedMedia(undefined);
		setBaseHalfNoteMediaEditMark(editor.prosemirrorView, undefined);
		const picture = baseHalfNoteMediaElement(editor.domElement, blockId);
		for (const property of ['width', 'height', 'transition']) {
			picture?.style.removeProperty(property);
		}
		// The keyboard comes back to the note, on the picture.
		editor.focus();
		window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
			vscode.postMessage({ type: 'basehalf.markdownRich.mediaShown', key: session.current.key, blockId });
		}));
	}, [editor, vscode]);

	// While a picture is edited the note stays as it is: a press in it ends the editing, and the wheel neither scrolls nor zooms it (D113).
	useEffect(() => {
		if (!editedMedia) {
			return;
		}
		const onPress = (event: Event): void => {
			event.preventDefault();
			event.stopPropagation();
			if (event.type === 'pointerdown' && mediaEdit.current && !mediaEdit.current.ending) {
				vscode.postMessage({ type: 'basehalf.markdownRich.endMediaEdit', key: session.current.key });
			}
		};
		const onWheel = (event: WheelEvent): void => {
			event.preventDefault();
			event.stopPropagation();
		};
		window.addEventListener('pointerdown', onPress, true);
		window.addEventListener('mousedown', onPress, true);
		window.addEventListener('wheel', onWheel, { passive: false, capture: true });
		return () => {
			window.removeEventListener('pointerdown', onPress, true);
			window.removeEventListener('mousedown', onPress, true);
			window.removeEventListener('wheel', onWheel, { capture: true });
		};
	}, [editedMedia, vscode]);
	// The page learns where the pointer is from its next move, and the toolbar shows again then, or at a key or a press.
	useEffect(() => {
		if (!toolbarWaits) {
			return;
		}
		const show = (): void => setToolbarWaits(false);
		const events = ['pointermove', 'pointerdown', 'keydown'] as const;
		for (const type of events) {
			window.addEventListener(type, show, { capture: true, passive: true });
		}
		return () => {
			for (const type of events) {
				window.removeEventListener(type, show, { capture: true });
			}
		};
	}, [toolbarWaits]);
	const noteMediaEdit = useMemo(() => ({ edit: editMedia, editing: editedMedia, hidden: !!editedMedia || toolbarWaits }), [editMedia, editedMedia, toolbarWaits]);
	const slashMenuItems = useCallback(async (query: string) => filterSuggestionItems(baseHalfSlashMenuItems(editor), query), [editor]);
	const ensureLiveUndoManager = noteUndo.ensure;

	// Rich reads a note as its card does and writes it with BaseHalf's writer
	// (note formats, rule 25 and design A5).
	// The blocks a save wrote without their formats (note formats, design A5).
	const writeWarnings = useRef<IBaseHalfNoteWriteWarning[]>([]);
	const editorApi = useMemo<IBaseHalfMarkdownEditorApi>(() => createBaseHalfNoteEditorApi(editor, {
		onWriteWarning: warning => {
			writeWarnings.current.push(warning);
			const key = session.current.key;
			if (key) {
				vscode.postMessage({ type: 'basehalf.markdownRich.writeWarning', key, ...(warning.blockId ? { blockId: warning.blockId } : {}), message: warning.message, ...(warning.stack ? { stack: warning.stack } : {}), block: warning.block });
			}
		},
	}), [editor, vscode]);
	// A save that writes a block without its formats says so, and outlines the block, until a save writes every block in its formats.
	const serializeNote = useCallback(async (): Promise<string> => {
		const state = session.current;
		writeWarnings.current = [];
		const value = await spliceBaseHalfMarkdownSave(editorApi, editor.document, '', state.byId, state.note);
		const unwritten = new Set(writeWarnings.current.flatMap(warning => warning.blockId ? [warning.blockId] : []));
		if (unwritten.size !== state.unwrittenBlocks.size || [...unwritten].some(id => !state.unwrittenBlocks.has(id))) {
			state.unwrittenBlocks = unwritten;
			const view = editor.prosemirrorView;
			view?.dispatch(view.state.tr.setMeta(baseHalfNoteUnwrittenKey, unwritten).setMeta('addToHistory', false));
			setVersion(value => value + 1);
		}
		return value;
	}, [editor, editorApi]);
	useMemo(() => installBaseHalfNotePaste(editor, editorApi), [editor, editorApi]);
	useMemo(() => installBaseHalfNoteBlockIndex(editor), [editor]);
	// What a copy, a cut, and a drag carry out of Rich (note formats, rules 75 to 77).
	useEffect(() => installBaseHalfNoteCopy(editor, document.body, () => session.current.resource || undefined, (uris, text) => {
		const key = session.current.key;
		if (key) {
			vscode.postMessage({ type: 'basehalf.markdownRich.copiedFiles', key, uris, text });
		}
	}), [editor]);
	// A picture's edge follows the pointer on a magnified page (note formats, rule 28).
	useEffect(() => installBaseHalfNoteResizeUnderZoom(window, () => readingAids.current?.zoom.level ?? 1), []);

	const discardSelectionForNextSharedTransaction = noteUndo.discardSelectionForNextSharedTransaction;

	const notifyDirty = useCallback((dirty: boolean) => {
		const state = session.current;
		if (state.dirty === dirty) {
			return;
		}
		state.dirty = dirty;
		if (state.key) {
			vscode.postMessage({ type: 'basehalf.markdownRich.dirtyChanged', key: state.key, dirty });
		}
		setVersion(value => value + 1);
	}, [vscode]);

	const projectAdhdReadBlocks = useCallback((adhd: IBaseHalfAdhdFile | null): Set<string> => {
		const state = session.current;
		if (!adhd || !state.ready) {
			return new Set();
		}
		const blocks = editor.document as unknown as readonly IBaseHalfMarkdownBlockNode[];
		// Read ranges are body-relative (`line_base: body`): body line 1 is the
		// first line after the frontmatter, so no frontmatter offset applies.
		return new Set(baseHalfMarkdownLinesToBlockIds(blocks, state.byId, 0, adhd.read_paragraphs ?? []));
	}, [editor]);

	// Records document text the host reported (a save result or a
	// frontmatter-only change) and refreshes the cached frontmatter from it.
	// The cache only maps file lines to blocks (reveal and Open Source); saves
	// never write it. Read ranges are body-relative, so a frontmatter change
	// does not move them.
	const adoptDiskFrontmatter = useCallback((content: string, frontmatter: string): void => {
		const state = session.current;
		state.lastDisk = content;
		if (state.frontmatter === frontmatter) {
			return;
		}
		state.frontmatter = frontmatter;
		state.readBlockIds = projectAdhdReadBlocks(state.adhd);
		setVersion(value => value + 1);
	}, [projectAdhdReadBlocks]);

	const applyContent = useCallback(async (content: string, editable: boolean, key: string, resource: string, baseUri: string) => {
		const state = session.current;
		const isNewResource = state.key !== key || state.resource !== resource;
		const wasReady = state.ready;
		// A deferred command belongs to the projection generation that received
		// it. Never let an IME-era undo cross a full document reload.
		pendingEditorCommands.current.length = 0;
		state.loading = true;
		state.key = key;
		state.resource = resource;
		state.baseUri = baseUri;
		renderedNote.baseUri = baseUri;
		state.editable = editable;
		state.conflictDisk = undefined;
		state.writeError = undefined;
		if (state.unwrittenBlocks.size > 0) {
			// What another note's save could not write is no warning of this one.
			state.unwrittenBlocks = new Set();
			const view = editor.prosemirrorView;
			view?.dispatch(view.state.tr.setMeta(baseHalfNoteUnwrittenKey, state.unwrittenBlocks).setMeta('addToHistory', false));
		}
		if (isNewResource) {
			state.adhd = null;
			state.adhdError = undefined;
			state.readingModeEnabled = false;
			state.readBlockIds = new Set();
		}
		setVersion(value => value + 1);

		const { frontmatter, body } = splitBaseHalfMarkdownFrontmatter(content);
		const projection = await buildBaseHalfMarkdownLoadProjection(editorApi, body, content);
		const { blocks } = projection;
		let adopted: ReturnType<typeof adoptBaseHalfMarkdownLoadProjection>;
		if (!wasReady) {
			try {
				adopted = adoptBaseHalfMarkdownLoadProjection(editorApi, editor.document, projection);
			} catch {
				adopted = undefined;
			}
		}
		// The editor asks how a toggle shows when it draws it, so the state
		// comes before the blocks (note formats, rule 40).
		baseHalfNoteToggleState.initiallyOpen = adopted?.note.open ?? projection.note.open;
		baseHalfNoteToggleState.folds.clear();
		if (!adopted) {
			const view = editor.prosemirrorView;
			if (view) {
				view.dispatch(view.state.tr.setSelection(TextSelection.atStart(view.state.doc)));
			}
			discardSelectionForNextSharedTransaction();
			editor.replaceBlocks(editor.document, blocks as Parameters<typeof editor.replaceBlocks>[1]);
		} else if (editor.domElement) {
			// The blocks were drawn before the state had their toggles.
			openBaseHalfNoteStoredOpenToggles(editor.domElement);
		}
		// Loading or adopting a projection must not become an undoable edit.
		// Otherwise undo could walk past the load and blank the document. The
		// fallback covers loads that land while the editor view is unmounted.
		(ensureLiveUndoManager() ?? noteUndo.current)?.clear();

		state.frontmatter = frontmatter;
		state.byId = adopted?.byId ?? projection.byId;
		state.note = adopted?.note ?? projection.note;
		state.lastDisk = content;
		state.editRevision = 0;
		state.lastAcknowledgedRevision = 0;
		state.ready = true;
		state.readBlockIds = projectAdhdReadBlocks(state.adhd);
		state.loading = false;
		notifyDirty(false);
		setVersion(value => value + 1);
	}, [discardSelectionForNextSharedTransaction, editor, editorApi, ensureLiveUndoManager, noteUndo, notifyDirty, projectAdhdReadBlocks]);

	// First meaningful frame: tell the host once the applied document has been
	// committed to the DOM, then separately acknowledge the window load
	// boundary. The outer webview registers its load handling before this
	// document runs, so the second message cannot precede its frame swap/focus
	// work. The host keeps the generation inert until both phases arrive.
	useEffect(() => {
		const state = session.current;
		if (renderedAnnounced.current || !state.ready || !state.key) {
			return;
		}
		renderedAnnounced.current = true;
		const key = state.key;
		vscode.postMessage({ type: 'basehalf.markdownRich.rendered', key });

		const announceFocusBoundarySettled = () => {
			vscode.postMessage({ type: 'basehalf.markdownRich.focusBoundarySettled', key });
		};
		if (document.readyState === 'complete') {
			announceFocusBoundarySettled();
			return;
		}
		window.addEventListener('load', announceFocusBoundarySettled, { once: true });
	}, [version, vscode]);

	const reportError = useCallback((error: unknown) => {
		const state = session.current;
		const message = error instanceof Error ? error.message : String(error);
		state.writeError = message;
		if (state.key) {
			vscode.postMessage({
				type: 'basehalf.markdownRich.error',
				key: state.key,
				message,
				...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
			});
		}
		setVersion(value => value + 1);
	}, [vscode]);

	const applyAdhdState = useCallback((adhd: IBaseHalfAdhdFile | null | undefined, error: string | undefined, readingModeEnabled: boolean | undefined) => {
		const state = session.current;
		if (readingModeEnabled !== undefined) {
			state.readingModeEnabled = readingModeEnabled;
		}
		if (adhd !== undefined) {
			state.adhd = adhd;
			state.readBlockIds = projectAdhdReadBlocks(adhd);
		}
		state.adhdError = error;
		setVersion(value => value + 1);
	}, [projectAdhdReadBlocks]);

	const postAdhdCommand = useCallback((command: IBaseHalfAdhdCommand) => {
		const state = session.current;
		if (!state.key || !state.ready || !state.readingModeEnabled || state.adhdError !== undefined) {
			return;
		}
		vscode.postMessage({
			type: 'basehalf.markdownRich.adhdCommand',
			key: state.key,
			command,
		});
	}, [vscode]);

	const searchWorkspaceFiles = useCallback((query: string): Promise<readonly IBaseHalfMarkdownRichFileLink[]> => {
		const state = session.current;
		if (!state.key || !state.ready) {
			return Promise.resolve([]);
		}

		const requestId = nextRequestId();
		return new Promise(resolve => {
			const timer = window.setTimeout(() => {
				pendingFileSearches.current.delete(requestId);
				resolve([]);
			}, 3000);
			pendingFileSearches.current.set(requestId, files => {
				window.clearTimeout(timer);
				resolve(files);
			});
			vscode.postMessage({ type: 'basehalf.markdownRich.fileSearch', key: state.key, requestId, query });
		});
	}, [vscode]);

	const selectedBlocks = useCallback(() => {
		try {
			return editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];
		} catch {
			return [];
		}
	}, [editor]);

	// The selection agents can see: the selected text and the file lines it is
	// on. The lines come from what a save would write now, so edits made since
	// the note was opened count, and are narrowed inside the first and the last
	// selected block.
	const lastPostedSelection = useRef<string | undefined>(undefined);
	const selectionTimer = useRef<number | undefined>(undefined);
	const postSelection = useCallback(async (): Promise<void> => {
		selectionTimer.current = undefined;
		const state = session.current;
		if (!state.key || !state.ready || state.loading) {
			return;
		}
		const key = state.key;
		const view = editor.prosemirrorView;
		const selection = view?.state.selection;
		let selected: { readonly text: string; readonly startLineNumber?: number; readonly endLineNumber?: number } = { text: '' };
		if (view && selection && !selection.empty) {
			const text = view.state.doc.textBetween(selection.from, selection.to, '\n', '\n');
			const blocks = selectedBlocks();
			const document = editor.document as unknown as readonly IBaseHalfMarkdownBlockNode[];
			if (text.trim().length > 0 && blocks.length > 0) {
				// A block in a toggle whose parts are blocks of their own has
				// lines of its own (note formats, rule 84): its own part of the
				// toggle's contribution.
				const contributions: IBaseHalfMarkdownSaveContribution[] = [];
				const addParts = (list: readonly IBaseHalfMarkdownSaveContribution[]) => list.forEach(contribution => contribution.parts ? addParts(contribution.parts) : contributions.push(contribution));
				addParts(await collectBaseHalfMarkdownSaveContributions(editorApi, editor.document, state.byId, state.note));
				if (session.current.key !== key) {
					return;
				}
				const ownIds = new Set(contributions.map(contribution => contribution.id));
				const ownId = (id: string | undefined) => id ? baseHalfMarkdownBlockPath(document, id)?.findLast(one => ownIds.has(one)) : undefined;
				const firstId = ownId(blocks[0]?.id);
				const lastId = ownId(blocks[blocks.length - 1]?.id);
				const frontmatterLines = countBaseHalfMarkdownNewlines(state.frontmatter);
				const lines: string[] = contributions.map(contribution => contribution.text).join('').split(/\r?\n/);
				// Each block's lines: from its first line that is not blank to
				// its last. A block that writes nothing itself is part of a
				// piece of Markdown that a later block writes whole.
				const ranges: { start: number; end: number }[] = [];
				let linesBefore = 0;
				for (const contribution of contributions) {
					const leading = /^(?:[ \t]*\r?\n)*/.exec(contribution.text)?.[0] ?? '';
					const start = frontmatterLines + linesBefore + countBaseHalfMarkdownNewlines(leading) + 1;
					const end = frontmatterLines + linesBefore + countBaseHalfMarkdownNewlines(contribution.text.replace(/\s+$/, '')) + 1;
					ranges.push({ start, end: Math.max(start, end) });
					linesBefore += countBaseHalfMarkdownNewlines(contribution.text);
				}
				for (let index = contributions.length - 2; index >= 0; index--) {
					if (contributions[index].text.trim().length === 0) {
						ranges[index].end = Math.max(ranges[index].end, ranges[index + 1].end);
					}
				}
				const first = firstId ? ranges[contributions.findIndex(contribution => contribution.id === firstId)] : undefined;
				const last = lastId ? ranges[contributions.findIndex(contribution => contribution.id === lastId)] : undefined;
				if (first && last) {
					const narrowed = baseHalfSelectionLines(line => lines[line - frontmatterLines - 1] ?? '', first, last, text);
					// The record keeps at most the limit; one more character says it was cut.
					const sent = text.length > BASEHALF_AGENT_SELECTION_TEXT_LIMIT ? text.slice(0, BASEHALF_AGENT_SELECTION_TEXT_LIMIT + 1) : text;
					selected = { text: sent, startLineNumber: narrowed.firstLine, endLineNumber: narrowed.lastLine };
				}
			}
		}
		const signature = `${key}:${JSON.stringify(selected)}`;
		if (lastPostedSelection.current === signature) {
			return;
		}
		lastPostedSelection.current = signature;
		vscode.postMessage({ type: 'basehalf.markdownRich.selectionChanged', key, ...selected });
	}, [editor, editorApi, selectedBlocks, vscode]);
	// A click on a link of a fixed block opens it, as on the card (note
	// formats, rule 54): the block is drawn, not edited.
	useEffect(() => {
		const scroll = scrollRef.current;
		if (!scroll) {
			return;
		}
		const onClick = (event: MouseEvent): void => {
			const link = event.button === 0 && event.target instanceof Element ? event.target.closest('.basehalf-raw-passthrough-rendered a[href]') : null;
			const href = link?.getAttribute('href');
			if (!href) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			openLinkRef.current(href);
		};
		scroll.addEventListener('click', onClick, true);
		return () => scroll.removeEventListener('click', onClick, true);
	}, []);

	// A press on the page around the document puts the caret where the press
	// is nearest to, as a press in the margin of a line does in an editor of
	// text: at the start of a line for a press left of it, at its end for one
	// right of it. The keyboard stays in the note; the browser would put the
	// caret on the page instead, where the letters typed next go nowhere
	// (note formats, rule 71).
	useEffect(() => {
		const scroll = scrollRef.current;
		if (!scroll) {
			return;
		}
		const onMouseDown = (event: MouseEvent): void => {
			const target = event.target;
			const page = scroll.querySelector(':scope > .basehalf-markdown-rich-page');
			const container = page?.querySelector(':scope > .bn-container');
			if (event.button !== 0 || (target !== scroll && target !== page && target !== container)) {
				return;
			}
			const view = editor.prosemirrorView;
			if (!view) {
				return;
			}
			const box = view.dom.getBoundingClientRect();
			const found = view.posAtCoords({
				left: Math.min(Math.max(event.clientX, box.left + 1), box.right - 1),
				top: Math.min(Math.max(event.clientY, box.top + 1), box.bottom - 1),
			});
			if (!found) {
				return;
			}
			event.preventDefault();
			view.focus();
			view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(found.pos))));
		};
		scroll.addEventListener('mousedown', onMouseDown, true);
		return () => scroll.removeEventListener('mousedown', onMouseDown, true);
	}, [editor]);

	const scheduleSelection = useCallback((): void => {
		if (selectionTimer.current !== undefined) {
			window.clearTimeout(selectionTimer.current);
		}
		selectionTimer.current = window.setTimeout(() => void postSelection(), 30);
	}, [postSelection]);

	const postFormatState = useCallback((): void => {
		const state = session.current;
		if (!state.key) {
			return;
		}

		const ready = state.ready && !state.loading;
		const editable = ready
			&& state.editable
			&& !state.structuralFrozen
			&& state.conflictDisk === undefined
			&& state.writeError === undefined;
		let blockType: BaseHalfMarkdownFormatBlockType = 'other';
		let bold: BaseHalfMarkdownFormatToggleState = false;
		let italic: BaseHalfMarkdownFormatToggleState = false;
		let canSetBlockType = false;
		let canToggleStyle = false;
		if (ready) {
			const selection = selectedBlocks();
			canSetBlockType = selection.some(baseHalfCanChangeBlockType);
			canToggleStyle = canSetBlockType;
			const blocks = selection.map(block => ({
				type: block.type,
				props: block.props as unknown as Record<string, unknown>,
			}));
			blockType = baseHalfSelectionBlockType(blocks);
			const view = editor.prosemirrorView;
			if (view) {
				bold = baseHalfSelectionMarkState(view.state, 'bold');
				italic = baseHalfSelectionMarkState(view.state, 'italic');
			}
		}

		const formatState: IBaseHalfMarkdownRichFormatState = { ready, editable, canSetBlockType, canToggleStyle, blockType, bold, italic };
		const signature = `${state.key}:${JSON.stringify(formatState)}`;
		if (lastPostedFormatState.current === signature) {
			return;
		}
		lastPostedFormatState.current = signature;
		vscode.postMessage({
			type: 'basehalf.markdownRich.formatStateChanged',
			key: state.key,
			state: formatState,
		});
	}, [editor, selectedBlocks, vscode]);

	const setSelectedBlockType = useCallback((type: BaseHalfEditableBlockType): boolean => {
		const blocks = selectedBlocks().filter(baseHalfCanChangeBlockType);
		if (blocks.length === 0) {
			return false;
		}
		const changedBlocks = blocks.filter(block => !baseHalfBlockMatchesEditableType({
			type: block.type,
			props: block.props as unknown as Record<string, unknown>,
		}, type));
		if (changedBlocks.length === 0) {
			postFormatState();
			return true;
		}

		editor.focus();
		editor.transact(() => {
			for (const block of changedBlocks) {
				switch (type) {
					case 'paragraph':
						editor.updateBlock(block, { type: 'paragraph' });
						break;
					case 'heading1':
						editor.updateBlock(block, { type: 'heading', props: { level: 1, isToggleable: false } });
						break;
					case 'heading2':
						editor.updateBlock(block, { type: 'heading', props: { level: 2, isToggleable: false } });
						break;
					case 'heading3':
						editor.updateBlock(block, { type: 'heading', props: { level: 3, isToggleable: false } });
						break;
					case 'bulletList':
						editor.updateBlock(block, { type: 'bulletListItem' });
						break;
					case 'orderedList':
						editor.updateBlock(block, { type: 'numberedListItem' });
						break;
				}
			}
		});
		postFormatState();
		return true;
	}, [editor, postFormatState, selectedBlocks]);

	const toggleSelectedList = useCallback((type: 'bulletList' | 'orderedList'): boolean => {
		const blocks = selectedBlocks().filter(baseHalfCanChangeBlockType);
		if (blocks.length === 0) {
			return false;
		}

		const targetType: BaseHalfEditableBlockType = blocks.every(block => baseHalfFormatBlockType({
			type: block.type,
			props: block.props as unknown as Record<string, unknown>,
		}) === type) ? 'paragraph' : type;
		return setSelectedBlockType(targetType);
	}, [selectedBlocks, setSelectedBlockType]);

	const insertDivider = useCallback((): boolean => {
		try {
			const cursor = editor.getTextCursorPosition();
			if (!cursor.nextBlock) {
				// The trailing-block extension renders a decoration, while the slash
				// helper needs a real editable block after non-editable content. Add it
				// to the same capture group so one Undo removes the divider and this
				// structural cursor target together.
				editor.transact(() => {
					editor.insertBlocks([{ type: 'paragraph' }], cursor.block, 'after');
					editor.setTextCursorPosition(cursor.block, 'end');
				});
			}

			// Keep the helper's own dispatch boundaries so its selection movement
			// and the editor plugins can finish before this semantic action closes.
			insertOrUpdateBlockForSlashMenu(editor, { type: 'divider' });
			postFormatState();
			return true;
		} catch (error) {
			reportError(error);
			return false;
		}
	}, [editor, postFormatState, reportError]);

	const executeEditorCommand = useCallback((command: BaseHalfMarkdownRichEditorCommand): boolean => {
		const undoManager = ensureLiveUndoManager();
		editor.focus();
		if (command === 'undo') {
			return noteUndo.undo();
		}
		if (command === 'redo') {
			return noteUndo.redo();
		}

		// A toolbar action is one semantic edit. Fence it from adjacent typing and
		// from the next action even when Yjs' capture timeout has not elapsed.
		undoManager?.stopCapturing();
		try {
			switch (command) {
				case 'setParagraph':
					return setSelectedBlockType('paragraph');
				case 'setHeading1':
					return setSelectedBlockType('heading1');
				case 'setHeading2':
					return setSelectedBlockType('heading2');
				case 'setHeading3':
					return setSelectedBlockType('heading3');
				case 'toggleBold':
					editor.toggleStyles({ bold: true });
					postFormatState();
					return true;
				case 'toggleItalic':
					editor.toggleStyles({ italic: true });
					postFormatState();
					return true;
				case 'toggleBulletList':
					return toggleSelectedList('bulletList');
				case 'toggleOrderedList':
					return toggleSelectedList('orderedList');
				case 'insertDivider':
					return insertDivider();
			}
		} finally {
			undoManager?.stopCapturing();
		}
	}, [editor, ensureLiveUndoManager, insertDivider, noteUndo, postFormatState, setSelectedBlockType, toggleSelectedList]);

	const runEditorCommand = useCallback((command: BaseHalfMarkdownRichEditorCommand): boolean => {
		const state = session.current;
		if (!state.editable || state.structuralFrozen || state.conflictDisk !== undefined || state.writeError !== undefined) {
			return false;
		}
		if (!state.ready || state.loading) {
			pendingEditorCommands.current.push(command);
			return true;
		}

		if (composing.current || !!editor.prosemirrorView?.composing) {
			pendingEditorCommands.current.push(command);
			return true;
		}
		return executeEditorCommand(command);
	}, [editor, executeEditorCommand]);

	const flushPendingEditorCommands = useCallback((allowWhileFrozen = false): void => {
		if (session.current.structuralFrozen && !allowWhileFrozen) {
			return;
		}
		const commands = pendingEditorCommands.current.splice(0);
		for (const command of commands) {
			if (allowWhileFrozen) {
				executeEditorCommand(command);
			} else {
				runEditorCommand(command);
			}
		}
	}, [executeEditorCommand, runEditorCommand]);

	const waitForCompositionSettled = useCallback(async (): Promise<void> => {
		while (composing.current || !!editor.prosemirrorView?.composing) {
			await new Promise<void>(resolve => compositionSettledWaiters.current.add(resolve));
		}
		// compositionend is delivered before ProseMirror's final transaction has
		// necessarily reached BlockNote. Drain the task before taking a snapshot.
		await new Promise<void>(resolve => window.setTimeout(resolve, 0));
	}, [editor]);

	const waitForPendingSaveSettled = useCallback(async (): Promise<void> => {
		while (session.current.pendingSaveContent.size > 0) {
			await new Promise<void>(resolve => pendingSaveSettledWaiters.current.add(resolve));
		}
	}, []);

	const serializeAndRequestSave = useCallback(async (requestId: string, forceSerialize: boolean, forceWrite: boolean, structural = false, handoff = false) => {
		const state = session.current;
		if (!state.key || !state.ready) {
			return;
		}
		if (state.structuralFrozen && !structural) {
			return;
		}
		const key = state.key;
		const resource = state.resource;
		if (structural && !state.structuralFrozen) {
			return;
		}
		if (!structural) {
			await waitForCompositionSettled();
		}
		// The frontmatter never leaves this webview: a save carries the body, and
		// the host writes it under the text model's current frontmatter.
		if (!structural && !state.dirty && !forceSerialize && !forceWrite) {
			state.pendingSaveContent.set(requestId, { content: state.lastDisk, revision: state.editRevision });
			vscode.postMessage({
				type: 'basehalf.markdownRich.saveRequested',
				key: state.key,
				requestId,
				body: splitBaseHalfMarkdownFrontmatter(state.lastDisk).body,
				previousContent: state.lastDisk,
				forceWrite,
			});
			return;
		}

		try {
			const snapshot = structural
				? await baseHalfCaptureStableMarkdownRichSnapshot({
					waitForCompositionSettled,
					waitForPendingSaveSettled: handoff ? async () => undefined : waitForPendingSaveSettled,
					isComposing: () => composing.current || !!editor.prosemirrorView?.composing,
					isFrozen: () => state.structuralFrozen && state.key === key && state.resource === resource,
					revision: () => state.editRevision,
					serialize: serializeNote,
				})
				: {
					value: await serializeNote(),
					revision: state.editRevision,
				};
			if (!snapshot) {
				return;
			}
			state.pendingSaveContent.set(requestId, {
				content: joinBaseHalfMarkdownRichFrontmatter(state.frontmatter, snapshot.value),
				revision: snapshot.revision,
			});
			vscode.postMessage({
				type: 'basehalf.markdownRich.saveRequested',
				key: state.key,
				requestId,
				body: snapshot.value,
				previousContent: state.lastDisk,
				forceWrite,
			});
		} catch (error) {
			reportError(error);
		}
	}, [editor, reportError, serializeNote, vscode, waitForCompositionSettled, waitForPendingSaveSettled]);

	const scheduleSave = useCallback(() => {
		if (saveTimer.current !== undefined) {
			window.clearTimeout(saveTimer.current);
		}
		saveTimer.current = window.setTimeout(function tick() {
			// Serializing mid-composition would publish half-composed IME
			// input to disk (and to every agent watching the file); wait for
			// the composition to settle. Explicit saves are not deferred.
			if (composing.current) {
				saveTimer.current = window.setTimeout(tick, AUTOSAVE_MS);
				return;
			}
			// A save round trip is still in flight: its result has not updated
			// lastDisk yet, so a second request now would carry a stale
			// previousContent and the coordinator would misread our own write
			// as an external conflict. Wait for the result, then re-fire.
			if (session.current.pendingSaveContent.size > 0) {
				saveTimer.current = window.setTimeout(tick, AUTOSAVE_MS);
				return;
			}
			saveTimer.current = undefined;
			// Nothing is left to save: a save or a load since the edit took it.
			// A request now would carry the disk's text as Rich last saw it, and
			// a change made outside Rich meanwhile would read as a conflict.
			if (!session.current.dirty) {
				return;
			}
			void serializeAndRequestSave(nextRequestId(), false, false);
		}, AUTOSAVE_MS);
	}, [serializeAndRequestSave]);

	// A pending focusAtPoint placement maps a client point to document content
	// once the document settles. Any edit, selection change, scroll, reveal,
	// or external merge moves content under that point, so it abandons the
	// pending placement instead of landing the caret on the wrong text.
	const cancelPendingPointFocus = useCallback(() => {
		if (pointFocusTimer.current !== undefined) {
			window.clearTimeout(pointFocusTimer.current);
			pointFocusTimer.current = undefined;
		}
		if (pointFocusFrame.current !== undefined) {
			window.cancelAnimationFrame(pointFocusFrame.current);
			pointFocusFrame.current = undefined;
		}
	}, []);

	const revealSelection = useCallback((selection: IBaseHalfMarkdownRichTextSelection | undefined) => {
		const state = session.current;
		if (!selection || !state.ready || state.loading) {
			return;
		}

		const start = Math.min(selection.startLineNumber, selection.endLineNumber ?? selection.startLineNumber);
		const end = Math.max(selection.startLineNumber, selection.endLineNumber ?? selection.startLineNumber);
		const ids = baseHalfMarkdownLinesToShownBlockIds(
			editor.document as unknown as readonly IBaseHalfMarkdownBlockNode[],
			state.byId,
			countBaseHalfMarkdownNewlines(state.frontmatter),
			[[start, end]]
		);
		if (ids.length === 0) {
			return;
		}

		const reveal = (attempt = 0): void => {
			const editorElement = editor.domElement;
			const elements = ids
				.map(id => findBlockElement(editorElement, id))
				.filter((element): element is HTMLElement => !!element);

			if (elements.length === 0 && attempt < 6) {
				window.requestAnimationFrame(() => reveal(attempt + 1));
				return;
			}
			if (elements.length === 0) {
				return;
			}

			// Lines in a closed toggle show once it opens, as for a link to a heading (note formats, rule 56).
			openBaseHalfNoteTogglesAround(elements[0]);
			elements[0].scrollIntoView({ block: 'center', inline: 'nearest' });
			setBaseHalfSelectionReveal(editor, ids);

			if (revealTimer.current !== undefined) {
				window.clearTimeout(revealTimer.current);
			}
			revealTimer.current = window.setTimeout(() => {
				revealTimer.current = undefined;
				setBaseHalfSelectionReveal(editor, []);
			}, 1800);
			cancelPendingPointFocus();
		};

		window.requestAnimationFrame(() => reveal());
	}, [cancelPendingPointFocus, editor]);

	const focusAtPoint = useCallback((point: { readonly x: number; readonly y: number }): void => {
		cancelPendingPointFocus();
		const quietWindow = 80;
		const place = (remainingAttempts: number): void => {
			const delay = Math.max(16, quietWindow - (performance.now() - lastYTransactionAt.current));
			pointFocusTimer.current = window.setTimeout(() => {
				pointFocusTimer.current = undefined;
				const view = editor.prosemirrorView;
				const documentBeforeFrame = view?.state.doc;
				const revisionBeforeFrame = yTransactionRevision.current;
				if (!view || !documentBeforeFrame || session.current.loading || !session.current.ready) {
					if (remainingAttempts > 0) {
						place(remainingAttempts - 1);
						return;
					}
					editor.focus();
					return;
				}
				pointFocusFrame.current = window.requestAnimationFrame(() => {
					pointFocusFrame.current = undefined;
					const settled = view.state.doc === documentBeforeFrame
						&& yTransactionRevision.current === revisionBeforeFrame
						&& performance.now() - lastYTransactionAt.current >= quietWindow;
					if (!settled) {
						if (remainingAttempts > 0) {
							place(remainingAttempts - 1);
						} else {
							view.focus();
						}
						return;
					}
					const state = view.state;
					const hit = view.posAtCoords({ left: point.x, top: point.y });
					if (hit && state.doc.content.size > 1) {
						const position = Math.max(1, Math.min(hit.pos, state.doc.content.size - 1));
						view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(position))));
					}
					view.focus();
				});
			}, delay);
		};
		place(8);
	}, [cancelPendingPointFocus, editor]);

	// Applies an external file change (agent writes, other tools) to the live
	// document incrementally: only the changed segment range is replaced, so
	// blocks outside it — and the cursor, scroll position, and undo history —
	// survive. Returns false when the change cannot be merged safely; the
	// caller falls back to a full rebuild.
	const applyExternalContent = useCallback(async (content: string, editable: boolean, key: string, resource: string): Promise<boolean> => {
		const state = session.current;
		if (!state.ready || state.loading
			|| state.key !== key || state.resource !== resource
			|| state.conflictDisk !== undefined || state.writeError !== undefined) {
			return false;
		}

		const baseline = state.lastDisk;
		const { frontmatter, body } = splitBaseHalfMarkdownFrontmatter(content);
		const oldBody = splitBaseHalfMarkdownFrontmatter(baseline).body;
		if (body === oldBody) {
			// The frontmatter lives outside the block model, so a
			// frontmatter-only change (an upstream edit, for example) never
			// touches blocks or undo, and a dirty editor adopts it too.
			state.editable = editable;
			if (content !== baseline) {
				if (!state.dirty) {
					state.lastAcknowledgedRevision = state.editRevision;
				}
				adoptDiskFrontmatter(content, frontmatter);
				cancelPendingPointFocus();
			}
			setVersion(value => value + 1);
			return true;
		}
		if (state.dirty) {
			return false;
		}

		state.editable = editable;
		if (oldBody === '' || body === '') {
			return false;
		}

		const plan = await planBaseHalfMarkdownMerge(editorApi, editor.document, state.byId, state.note, oldBody, body, content);
		if (!plan) {
			return false;
		}
		const removeIds = [...plan.removeIds];
		const { anchor } = plan;
		const newBlocks = plan.blocks;

		// The awaits above are a concurrency window; re-validate before mutating.
		if (state.dirty || state.loading || state.lastDisk !== baseline) {
			return false;
		}

		const scrollElement = scrollRef.current;
		const visibleAnchorId = firstVisibleBlockId(editor.domElement, scrollElement);
		const visibleAnchorTop = visibleAnchorId
			? findBlockElement(editor.domElement, visibleAnchorId)?.getBoundingClientRect().top
			: undefined;

		// External changes must behave like another author's edits: they never
		// land on the local undo stack (undo must not revert an agent's write)
		// and they never clear the redo stack. Untracking the sync origin for
		// the merge transaction gives exactly those semantics.
		const manager = ensureLiveUndoManager();
		manager?.stopCapturing();
		manager?.trackedOrigins.delete(ySyncPluginKey);
		state.loading = true;
		// Toggles the change leaves keep how they show; new ones show as their file says.
		baseHalfNoteToggleState.initiallyOpen = plan.note.open;
		try {
			if (removeIds.length > 0 && newBlocks.length > 0) {
				editor.replaceBlocks(removeIds, newBlocks as Parameters<typeof editor.replaceBlocks>[1]);
			} else if (removeIds.length > 0) {
				editor.removeBlocks(removeIds);
			} else if (newBlocks.length > 0 && anchor) {
				editor.insertBlocks(newBlocks as Parameters<typeof editor.insertBlocks>[0], anchor.id, anchor.placement);
			}

			// Match the load projection's shape guarantee: a document must
			// always keep at least one editable block to type into.
			const document = editor.document as ReadonlyArray<{ readonly id: string; readonly type?: string }>;
			if (document.length > 0 && document.every(block => block.type === BASEHALF_RAW_PASSTHROUGH_BLOCK)) {
				editor.insertBlocks(
					[{ type: 'paragraph' }] as Parameters<typeof editor.insertBlocks>[0],
					document[document.length - 1].id,
					'after'
				);
			}
		} finally {
			state.loading = false;
			manager?.trackedOrigins.add(ySyncPluginKey);
		}

		state.byId = plan.byId;
		state.note = plan.note;
		state.frontmatter = frontmatter;
		state.lastDisk = content;
		state.lastAcknowledgedRevision = state.editRevision;
		state.readBlockIds = projectAdhdReadBlocks(state.adhd);
		setVersion(value => value + 1);

		if (visibleAnchorId && visibleAnchorTop !== undefined && scrollElement) {
			const element = findBlockElement(editor.domElement, visibleAnchorId);
			if (element) {
				scrollElement.scrollTop += element.getBoundingClientRect().top - visibleAnchorTop;
			}
		}
		cancelPendingPointFocus();
		return true;
	}, [adoptDiskFrontmatter, cancelPendingPointFocus, editor, editorApi, ensureLiveUndoManager, projectAdhdReadBlocks]);

	// Routes an incoming document state: merge when possible, rebuild
	// otherwise. Arrivals during IME composition are parked and replayed on
	// compositionend — mutating the document mid-composition would abort the
	// user's uncommitted input.
	// The zoom and the outline of a note in Card Detail (zoom and outline of a
	// note). They are made with the first init of Card Detail's page; another
	// note shows at 100% (rule 8).
	const ensureReadingAids = useCallback((anotherNote: boolean, motionReduced: boolean): void => {
		const scroll = scrollRef.current;
		const page = scroll?.querySelector<HTMLElement>(':scope > .basehalf-markdown-rich-page');
		if (!scroll || !page) {
			return;
		}
		const existing = readingAids.current;
		if (existing) {
			existing.reducedMotion = motionReduced;
			if (anotherNote) {
				existing.zoom.reset();
			}
			return;
		}
		const text = () => scroll.querySelector<HTMLElement>('.ProseMirror');
		const reducedMotion = () => aids.reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		let outline: BaseHalfNoteOutline | undefined;
		const zoom = new BaseHalfNoteZoom({
			view: scroll,
			page,
			onDidDraw: () => {
				outline?.refresh();
				// The page moved in its view as in a scroll. The editor's handles,
				// toolbars, and menus follow the view's scroll events, which a page
				// drawn at another level does not send, and which a new scroll
				// position sends only in the next frame: they follow the page in
				// this one (zoom and outline of a note, rules 7 and 23).
				scroll.dispatchEvent(new Event('scroll'));
			},
		});
		const aids: IReadingAids = {
			zoom,
			outline: outline = new BaseHalfNoteOutline({
				view: scroll,
				text,
				headings: () => baseHalfNoteOutlineHeadings(text()),
				label: 'Outline',
				reducedMotion,
				minMargin: BASEHALF_NOTE_OUTLINE_MIN_MARGIN_WITH_HANDLES,
			}),
			restoreLookUp: lookUpWithinView(scroll),
			reducedMotion: motionReduced,
		};
		readingAids.current = aids;
	}, []);

	useEffect(() => () => {
		readingAids.current?.zoom.dispose();
		readingAids.current?.outline.dispose();
		readingAids.current?.restoreLookUp();
		readingAids.current = undefined;
	}, []);

	// The wheel with the zoom key or Ctrl held inside the page zooms it; a pinch
	// of the trackpad comes from the window instead (rule 1).
	useEffect(() => {
		const onWheel = (event: WheelEvent): void => {
			const aids = readingAids.current;
			if (!aids || mediaEdit.current || !isBaseHalfZoomWheel(event, macintosh)) {
				return;
			}
			event.preventDefault();
			aids.zoom.zoomBy(event);
		};
		window.addEventListener('wheel', onWheel, { passive: false, capture: true });
		return () => window.removeEventListener('wheel', onWheel, { capture: true });
	}, []);

	const handleIncomingInit = useCallback(async (payload: IIncomingInit): Promise<void> => {
		// A payload that a newer arrival superseded — whether parked during
		// composition and replayed late, or overtaken at an await point — must
		// never be applied: it would cleanly walk the document back to stale
		// content that the host has no reason to ever re-send.
		if (payload.generation !== initGeneration.current) {
			return;
		}

		if (editor.prosemirrorView?.composing) {
			pendingInit.current = payload;
			return;
		}

		pendingInit.current = undefined;
		session.current.surface = payload.surface;
		session.current.baseUri = payload.baseUri;
		renderedNote.baseUri = payload.baseUri;
		if (payload.surface === 'detail') {
			ensureReadingAids(session.current.key !== payload.key, payload.reducedMotion ?? false);
		}
		const merged = await applyExternalContent(payload.content, payload.editable, payload.key, payload.resource)
			.catch(() => false);
		if (!merged) {
			if (payload.generation !== initGeneration.current) {
				return;
			}
			const state = session.current;
			if (state.ready && state.key === payload.key && state.resource === payload.resource && state.dirty) {
				// The document gained local edits after this content was sent
				// (parked during composition, or an in-flight race). Rebuilding
				// would clobber them; divergence is the save conflict path's job.
				flushPendingEditorCommands();
				return;
			}
			// Full rebuild; only this path re-reveals the host's navigation
			// selection — a merge keeps the user's spot.
			await applyContent(payload.content, payload.editable, payload.key, payload.resource, payload.baseUri);
			revealSelection(payload.selection);
		}
		readingAids.current?.outline.refresh();
		if (payload.generation === initGeneration.current) {
			flushPendingEditorCommands();
		}
	}, [applyContent, applyExternalContent, editor, ensureReadingAids, flushPendingEditorCommands, revealSelection]);

	useEffect(() => {
		const onCompositionStart = () => {
			composing.current = true;
		};
		const onCompositionEnd = () => {
			composing.current = false;
			for (const resolve of compositionSettledWaiters.current) {
				resolve();
			}
			compositionSettledWaiters.current.clear();
			const pending = pendingInit.current;
			pendingInit.current = undefined;
			window.setTimeout(() => {
				// compositionend precedes ProseMirror's final transaction. Undo only
				// after that transaction so one shortcut removes the committed IME edit.
				flushPendingEditorCommands();
				if (pending) {
					void handleIncomingInit(pending).catch(reportError);
				}
			}, 0);
		};
		window.addEventListener('compositionstart', onCompositionStart, true);
		window.addEventListener('compositionend', onCompositionEnd, true);
		return () => {
			window.removeEventListener('compositionstart', onCompositionStart, true);
			window.removeEventListener('compositionend', onCompositionEnd, true);
		};
	}, [flushPendingEditorCommands, handleIncomingInit, reportError]);

	useEffect(() => {
		const updateListener = (update: Uint8Array, origin: unknown) => {
			if (origin === 'basehalf.host') {
				return;
			}
			const state = session.current;
			if (!state.key) {
				return;
			}
			const transferable = copyTransferable(update);
			vscode.postMessage({
				type: 'basehalf.markdownRich.yjsUpdate',
				key: state.key,
				update: transferable.update,
			}, transferable.transfer);
		};
		ydoc.on('update', updateListener);
		return () => {
			ydoc.off('update', updateListener);
			ydoc.destroy();
		};
	}, [vscode, ydoc]);

	useEffect(() => {
		const onMessage = (event: MessageEvent<unknown>) => {
			const message = event.data;
			if (!isBaseHalfMarkdownRichHostMessage(message)) {
				return;
			}
			const state = session.current;
			if (state.key && message.key !== state.key) {
				return;
			}

			switch (message.type) {
				case 'basehalf.markdownRich.init':
					void handleIncomingInit({
						content: message.content,
						editable: message.editable,
						key: message.key,
						resource: message.resource,
						baseUri: message.baseUri,
						surface: message.surface,
						generation: ++initGeneration.current,
						...(message.selection ? { selection: message.selection } : {}),
						...(message.reducedMotion !== undefined ? { reducedMotion: message.reducedMotion } : {})
					}).catch(reportError);
					break;
				case 'basehalf.markdownRich.zoomGesture':
					readingAids.current?.zoom.zoomBy({
						deltaY: message.gesture.deltaY,
						deltaMode: message.gesture.deltaMode,
						clientX: message.gesture.x,
						clientY: message.gesture.y,
					});
					break;
				case 'basehalf.markdownRich.applyYjsUpdate':
					if (!state.ready || state.structuralFrozen) {
						discardSelectionForNextSharedTransaction();
					}
					applyUpdate(ydoc, new Uint8Array(message.update), 'basehalf.host');
					break;
				case 'basehalf.markdownRich.setEditable':
					state.editable = message.editable;
					setVersion(value => value + 1);
					break;
				case 'basehalf.markdownRich.setStructuralFreeze': {
					state.structuralFrozen = message.frozen;
					const freezeKey = state.key;
					if (message.frozen) {
						if (saveTimer.current !== undefined) {
							window.clearTimeout(saveTimer.current);
							saveTimer.current = undefined;
						}
						setContextMenu(undefined);
						const active = document.activeElement;
						if (active instanceof HTMLElement && editor.domElement?.contains(active)) {
							active.blur();
						}
						editor.prosemirrorView?.dom.blur();
					} else {
						flushPendingEditorCommands();
						if (state.dirty && state.conflictDisk === undefined && state.writeError === undefined) {
							scheduleSave();
						}
					}
					setVersion(value => value + 1);
					void (async () => {
						if (message.frozen) {
							// Commands accepted before the freeze remain part of the
							// authoring transaction. Composition must commit before those
							// commands run and before the host receives the freeze ack.
							await waitForCompositionSettled();
							flushPendingEditorCommands(true);
							editor.prosemirrorView?.dom.blur();
							await asyncMutationBarrier.waitForIdle();
						}
						vscode.postMessage({
							type: 'basehalf.markdownRich.structuralFreezeChanged',
							key: freezeKey,
							requestId: message.requestId,
							frozen: message.frozen,
						});
					})();
					break;
				}
				case 'basehalf.markdownRich.revealSelection':
					revealSelection(message.selection);
					break;
				case 'basehalf.markdownRich.revealHeading':
					readingAids.current?.outline.revealHeading(message.heading);
					break;
				case 'basehalf.markdownRich.mediaEditEnded': {
					const edited = mediaEdit.current;
					if (message.step && edited?.blockId === message.blockId) {
						recordMediaEdit(edited.url, message.step);
					}
					void endMediaEdit(message.blockId, message.version).catch(reportError);
					break;
				}
				case 'basehalf.markdownRich.mediaVersion':
					showMediaVersion(message.href, message.version);
					break;
				case 'basehalf.markdownRich.hideMedia': {
					// The editor shows over the picture, and may draw it smaller: the note's own hides under it (D113).
					const edit = mediaEdit.current;
					if (edit?.blockId === message.blockId && !edit.ending) {
						setBaseHalfNoteMediaEditMark(editor.prosemirrorView, { blockId: edit.blockId, room: edit.room, hidden: true });
					}
					break;
				}
				case 'basehalf.markdownRich.showMedia':
					showEditedMedia(message.blockId);
					break;
				case 'basehalf.markdownRich.focusAtPoint':
					focusAtPoint(message.point);
					break;
				case 'basehalf.markdownRich.focus':
					// The caret where it is: at first the end of the note (opening and closing Card Detail, "The keyboard").
					editor.focus();
					break;
				case 'basehalf.markdownRich.command':
					runEditorCommand(message.command);
					break;
				case 'basehalf.markdownRich.fileSearchResult': {
					const pending = pendingFileSearches.current.get(message.requestId);
					pendingFileSearches.current.delete(message.requestId);
					pending?.(message.files);
					break;
				}
				case 'basehalf.markdownRich.attachmentResult': {
					const pending = pendingAttachmentUploads.current.get(message.requestId);
					pendingAttachmentUploads.current.delete(message.requestId);
					if (!pending) {
						break;
					}
					window.clearTimeout(pending.timer);
					if (message.url) {
						pending.resolve({ props: { url: message.url, name: message.name ?? baseHalfNoteLinkPath(message.url)?.split('/').pop() ?? message.url } });
					} else {
						pending.reject(new Error(message.error ?? 'The file could not be added.'));
					}
					break;
				}
				case 'basehalf.markdownRich.itemsResult': {
					const pending = pendingItemRequests.current.get(message.requestId);
					pendingItemRequests.current.delete(message.requestId);
					if (pending) {
						window.clearTimeout(pending.timer);
						pending.resolve(message.items || message.failures ? { items: message.items ?? [], failures: message.failures ?? [] } : undefined);
					}
					break;
				}
				case 'basehalf.markdownRich.dragPoint':
					showBaseHalfNoteDropPoint(editor, message.point);
					break;
				case 'basehalf.markdownRich.dropItems':
					// Files dragged from another app, which the window read with their paths, go in where they were let go.
					if (editor.isEditable) {
						void addBaseHalfNoteItems(editor, () => requestItemsRef.current('drop', { uris: message.uris }), message.point);
					}
					break;
				case 'basehalf.markdownRich.save':
					void serializeAndRequestSave(message.requestId, message.forceSerialize, message.forceWrite, message.structural, message.handoff);
					break;
				case 'basehalf.markdownRich.saveResult': {
					const pending = state.pendingSaveContent.get(message.requestId);
					state.pendingSaveContent.delete(message.requestId);
					if (state.pendingSaveContent.size === 0) {
						for (const resolve of pendingSaveSettledWaiters.current) {
							resolve();
						}
						pendingSaveSettledWaiters.current.clear();
					}
					if (pending && pending.revision < state.lastAcknowledgedRevision) {
						break;
					}
					if (message.result === 'saved' || message.result === 'noop') {
						// The host composed the text model's frontmatter with this
						// body; its result refreshes the cached frontmatter.
						const saved = message.content ?? pending?.content ?? state.lastDisk;
						adoptDiskFrontmatter(saved, splitBaseHalfMarkdownFrontmatter(saved).frontmatter);
						state.lastAcknowledgedRevision = pending?.revision ?? state.editRevision;
						state.conflictDisk = undefined;
						state.writeError = undefined;
						if (!pending || pending.revision === state.editRevision) {
							notifyDirty(false);
						} else {
							setVersion(value => value + 1);
						}
					} else if (message.result === 'blockedByConflict') {
						state.conflictDisk = message.disk ?? state.lastDisk;
						if (saveTimer.current !== undefined) {
							window.clearTimeout(saveTimer.current);
							saveTimer.current = undefined;
						}
						setVersion(value => value + 1);
					} else {
						state.writeError = message.message ?? 'Write failed';
						setVersion(value => value + 1);
					}
					break;
				}
				case 'basehalf.markdownRich.adhdState':
					applyAdhdState(message.adhd, message.error, message.readingModeEnabled);
					break;
			}
		};
		window.addEventListener('message', onMessage);
		if (session.current.key) {
			vscode.postMessage({ type: 'basehalf.markdownRich.ready', key: session.current.key });
		}
		return () => window.removeEventListener('message', onMessage);
	}, [adoptDiskFrontmatter, applyAdhdState, applyContent, applyExternalContent, asyncMutationBarrier, editor, endMediaEdit, flushPendingEditorCommands, focusAtPoint, notifyDirty, recordMediaEdit, reportError, revealSelection, runEditorCommand, scheduleSave, serializeAndRequestSave, showEditedMedia, showMediaVersion, vscode, waitForCompositionSettled, ydoc]);

	useEffect(() => {
		postFormatState();
	}, [postFormatState, version]);

	useEffect(() => {
		const scroll = scrollRef.current;
		// The document as the editor's last report of a change left it.
		let reported = editor.prosemirrorView?.state.doc;
		const offChange = editor.onChange(() => {
			// Keep the undo manager live even if a plugin-view teardown killed
			// the one in plugin state after this document loaded.
			ensureLiveUndoManager();
			const state = session.current;
			const doc = editor.prosemirrorView?.state.doc;
			const previous = reported;
			reported = doc;
			if (state.loading || !state.ready) {
				return;
			}
			// The editor reports a change also when it only becomes editable,
			// with the document as it was: that is no edit, and saving after it
			// would read a change made outside Rich meanwhile as a conflict.
			// The document says so at once, where asking the editor which
			// blocks changed reads every block of the note twice, on each key.
			if (doc && previous && (doc === previous || doc.eq(previous))) {
				return;
			}
			state.editRevision += 1;
			notifyDirty(true);
			scheduleSave();
			cancelPendingPointFocus();
			postFormatState();
			scheduleSelection();
		});
		const offSelection = editor.onSelectionChange(() => {
			cancelPendingPointFocus();
			postFormatState();
			scheduleSelection();
		});
		scroll?.addEventListener('scroll', cancelPendingPointFocus, { passive: true });
		return () => {
			offChange();
			offSelection();
			scroll?.removeEventListener('scroll', cancelPendingPointFocus);
		};
	}, [cancelPendingPointFocus, editor, ensureLiveUndoManager, notifyDirty, postFormatState, scheduleSave, scheduleSelection]);

	useEffect(() => {
		const state = session.current;
		pushBaseHalfAdhdDecorations(editor, {
			enabled: state.ready && state.readingModeEnabled && state.adhdError === undefined,
			readBlockIds: [...state.readBlockIds],
			keywords: state.adhd?.highlight_keywords ?? [],
		});
	}, [editor, version]);

	useEffect(() => () => {
		pushBaseHalfAdhdDecorations(editor, { enabled: false, readBlockIds: [], keywords: [] });
	}, [editor]);

	useEffect(() => () => {
		for (const pending of pendingAttachmentUploads.current.values()) {
			window.clearTimeout(pending.timer);
			pending.reject(new Error('The note was closed before the file was added.'));
		}
		pendingAttachmentUploads.current.clear();
		for (const pending of pendingItemRequests.current.values()) {
			window.clearTimeout(pending.timer);
			pending.resolve(undefined);
		}
		pendingItemRequests.current.clear();
	}, []);

	useEffect(() => {
		const dom = editor.prosemirrorView?.dom;
		if (!dom) {
			return;
		}

		const onContextMenu = (event: MouseEvent): void => {
			const state = session.current;
			if (!state.ready) {
				return;
			}

			const view = editor.prosemirrorView;
			const selection = view?.state.selection;
			const selected = (selection && !selection.empty
				? view.state.doc.textBetween(selection.from, selection.to, '\n', '\n')
				: window.getSelection()?.toString() ?? '').trim();
			const canPaste = !!view && state.editable && !state.structuralFrozen && state.conflictDisk === undefined && state.writeError === undefined;
			const clickedBlockId = (event.target as HTMLElement | null)?.closest?.('[data-id]')?.getAttribute('data-id');
			const clickedBlock = clickedBlockId ? editor.getBlock(clickedBlockId) : undefined;
			// A picture, a video, or a sound is edited in place; a file block opens its file (files in notes, rule 22).
			const clickedFileUrl = clickedBlock?.type === 'file' && typeof clickedBlock.props.url === 'string' && clickedBlock.props.url
				? clickedBlock.props.url
				: undefined;
			// Without a selection the menu still offers Paste at the cursor.
			if (selected.length === 0 && !canPaste && !clickedFileUrl) {
				return;
			}

			const existing = (state.adhd?.highlight_keywords ?? []).find(keyword => keyword.toLowerCase() === selected.toLowerCase());
			const items: ContextMenuItem[] = [];
			if (clickedFileUrl) {
				items.push({
					id: 'open-file',
					label: baseHalfEditorLabel('Open', '打开', '開啟'),
					run: () => vscode.postMessage({ type: 'basehalf.markdownRich.openResource', key: state.key, href: clickedFileUrl }),
				});
			}
			const mutationKey = state.key;
			const canApplyAsyncMutation = (): boolean => {
				const current = session.current;
				return current.key === mutationKey
					&& current.ready
					&& current.editable
					&& !current.structuralFrozen
					&& current.conflictDisk === undefined
					&& current.writeError === undefined;
			};
			if (selected.length > 0 && state.readingModeEnabled && state.adhdError === undefined) {
				items.push(existing
					? {
						id: 'remove-highlight',
						label: `Remove "${existing}" from highlights`,
						run: () => postAdhdCommand({ command: 'removeKeyword', keyword: existing }),
					}
					: {
						id: 'add-highlight',
						label: `Highlight "${selected}"`,
						run: () => postAdhdCommand({ command: 'addKeyword', keyword: selected }),
					});
			}
			// Copy, Cut, and Paste are the page's own, run by the host as for
			// their keys, so that they carry and take all that the keys do:
			// the note's Markdown, pictures, files, and Rich's own blocks
			// (note formats, rules 73 and 75). The editor has the keyboard
			// first, so that the page's selection is the editor's.
			const clipboard = (action: 'copy' | 'cut' | 'paste'): void => {
				if (action !== 'copy' && !canApplyAsyncMutation()) {
					return;
				}
				view?.focus();
				vscode.postMessage({ type: 'basehalf.markdownRich.clipboard', key: mutationKey, action });
			};

			if (selected.length > 0) {
				items.push({
					id: 'copy',
					label: 'Copy',
					run: () => clipboard('copy'),
				});
			}

			if (canPaste && view) {
				if (selected.length > 0) {
					items.push({
						id: 'cut',
						label: 'Cut',
						run: () => clipboard('cut'),
					});
				}
				items.push({
					id: 'paste',
					label: 'Paste',
					run: () => clipboard('paste'),
				});
			}

			event.preventDefault();
			setContextMenu({
				x: event.clientX,
				y: event.clientY,
				items,
			});
		};

		dom.addEventListener('contextmenu', onContextMenu);
		return () => dom.removeEventListener('contextmenu', onContextMenu);
	}, [editor, postAdhdCommand, vscode]);

	useEffect(() => {
		const dom = editor.prosemirrorView?.dom;
		if (!dom) {
			return;
		}

		const onDoubleClick = (event: MouseEvent): void => {
			const target = event.target as HTMLElement | null;
			// A double click on a file block opens its file; a picture, a video, or a sound is edited in place (files in notes, rule 22).
			const fileTarget = target?.closest('.bn-file-block-content-wrapper');
			if (!fileTarget) {
				return;
			}
			const blockId = fileTarget.closest('[data-id]')?.getAttribute('data-id');
			const block = blockId ? editor.getBlock(blockId) : undefined;
			if (!block
				|| block.type !== 'file'
				|| !('url' in block.props)
				|| typeof block.props.url !== 'string'
				|| !block.props.url) {
				return;
			}
			const state = session.current;
			if (!state.key) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			vscode.postMessage({ type: 'basehalf.markdownRich.openResource', key: state.key, href: block.props.url });
		};

		dom.addEventListener('dblclick', onDoubleClick, true);
		return () => dom.removeEventListener('dblclick', onDoubleClick, true);
	}, [editor, vscode]);

	// A table or a code block that is scrolled sideways shows one bar inside its
	// lower edge, as on a card (note rendering). The bar is put into the page,
	// outside what the editor draws.
	useEffect(() => {
		const scroll = scrollRef.current;
		if (!scroll) {
			return;
		}
		const scrollbar = installBaseHalfSidewaysScrollbar(scroll, {
			boxSelector: '.tableWrapper, .basehalf-raw-passthrough-rendered table, .bn-block-content[data-content-type="codeBlock"] > pre',
			container: box => box.closest<HTMLElement>('.basehalf-markdown-rich-page'),
			// The box of an editable table is wider and higher than the table, for its handles.
			anchor: box => box.classList.contains('tableWrapper') ? box.querySelector<HTMLElement>('table') : undefined,
		});
		return () => scrollbar.dispose();
	}, []);

	useEffect(() => {
		const dom = editor.prosemirrorView?.dom;
		if (!dom) {
			return;
		}

		const onClick = (event: MouseEvent): void => {
			const button = (event.target as HTMLElement | null)?.closest?.('.basehalf-raw-passthrough-edit');
			if (!button) {
				return;
			}

			const state = session.current;
			const blockId = button.closest('[data-id]')?.getAttribute('data-id');
			if (!state.key || !state.ready || !blockId) {
				return;
			}

			const span = baseHalfMarkdownBlockReadSpan(
				editor.document as unknown as readonly IBaseHalfMarkdownBlockNode[],
				blockId,
				state.byId,
				countBaseHalfMarkdownNewlines(state.frontmatter)
			);
			if (!span) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			vscode.postMessage({
				type: 'basehalf.markdownRich.openSource',
				key: state.key,
				selection: { startLineNumber: span.start, startColumn: 1, endLineNumber: span.end },
			});
		};

		dom.addEventListener('click', onClick, true);
		return () => dom.removeEventListener('click', onClick, true);
	}, [editor, vscode]);

	useEffect(() => {
		const dom = editor.prosemirrorView?.dom;
		if (!dom) {
			return;
		}

		const toggleCheckbox = (checkbox: HTMLElement): boolean => {
			const blockId = checkbox?.getAttribute('data-basehalf-adhd-block-id');
			if (!blockId) {
				return false;
			}

			const state = session.current;
			if (!state.ready || !state.readingModeEnabled || state.adhdError !== undefined) {
				return false;
			}

			// Read spans are body-relative lines (`line_base: body`).
			const span = baseHalfMarkdownBlockReadSpan(
				editor.document as unknown as readonly IBaseHalfMarkdownBlockNode[],
				blockId,
				state.byId,
				0
			);
			if (!span) {
				return false;
			}

			postAdhdCommand({
				command: state.readBlockIds.has(blockId) ? 'markUnread' : 'markRead',
				start: span.start,
				end: span.end,
			});
			return true;
		};

		const onMouseDown = (event: MouseEvent): void => {
			const checkbox = (event.target as HTMLElement | null)?.closest?.('.basehalf-adhd-check') as HTMLElement | null;
			if (checkbox && toggleCheckbox(checkbox)) {
				event.preventDefault();
				event.stopPropagation();
			}
		};

		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) {
				return;
			}
			const checkbox = (event.target as HTMLElement | null)?.closest?.('.basehalf-adhd-check') as HTMLElement | null;
			if (checkbox && toggleCheckbox(checkbox)) {
				event.preventDefault();
				event.stopPropagation();
			}
		};

		dom.addEventListener('mousedown', onMouseDown, true);
		dom.addEventListener('keydown', onKeyDown, true);
		return () => {
			dom.removeEventListener('mousedown', onMouseDown, true);
			dom.removeEventListener('keydown', onKeyDown, true);
		};
	}, [editor, postAdhdCommand]);

	useEffect(() => {
		if (!contextMenu) {
			return;
		}
		const close = () => setContextMenu(undefined);
		let blurTimer: number | undefined;
		const onMouseDown = (event: MouseEvent) => {
			// The global listener is native while the menu handler below is a
			// React synthetic event. Do not rely on their delegation order: an
			// in-menu press must survive long enough to deliver its click.
			if (event.target instanceof Node && contextMenuRef.current?.contains(event.target)) {
				return;
			}
			close();
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				close();
			}
		};
		const onBlur = () => {
			// Embedded webviews can briefly blur while focus crosses the host/
			// iframe boundary during a menu-button click. Give that click time to
			// land, then close only if the rich document really stayed unfocused.
			window.clearTimeout(blurTimer);
			blurTimer = window.setTimeout(() => {
				if (!document.hasFocus()) {
					close();
				}
			}, 250);
		};
		window.addEventListener('mousedown', onMouseDown);
		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('blur', onBlur);
		return () => {
			window.clearTimeout(blurTimer);
			window.removeEventListener('mousedown', onMouseDown);
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('blur', onBlur);
		};
	}, [contextMenu]);

	useEffect(() => {
		// Undo/redo must have exactly one owner. Left alone, the key would be
		// handled twice: the editor's own keymap runs an undo, then the
		// webview bootstrap forwards the same keydown to the workbench, whose
		// generic webview implementation replays a native undo that mutates
		// the contenteditable DOM behind the editor's transaction model.
		// Intercept in the capture phase (before the editor keymap and the
		// bootstrap forwarder) and run the editor command directly; the
		// workbench Edit menu reaches the same command over the message
		// protocol instead.
		const onKeyDown = (event: KeyboardEvent) => {
			if ((!event.metaKey && !event.ctrlKey) || event.altKey) {
				return;
			}

			// Match by layout-resolved key first; fall back to the physical key
			// position only when the layout produces a non-Latin key (e.g.
			// Cyrillic), where the editor keymap's own keyCode fallback would
			// otherwise reintroduce double handling.
			const key = event.key.toLowerCase();
			const isLatinLetter = key.length === 1 && key >= 'a' && key <= 'z';
			const matchesZ = key === 'z' || (!isLatinLetter && event.code === 'KeyZ');
			const matchesY = key === 'y' || (!isLatinLetter && event.code === 'KeyY');
			const command: BaseHalfMarkdownRichEditorCommand | undefined =
				matchesZ ? (event.shiftKey ? 'redo' : 'undo')
					: matchesY && !event.shiftKey ? 'redo'
						: undefined;
			if (!command) {
				return;
			}

			// Native text fields (e.g. the link toolbar URL input) keep their
			// own undo; only the document editor owns Mod+Z here.
			const target = event.target as HTMLElement | null;
			if (target && !target.closest?.('.bn-editor')
				&& (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			runEditorCommand(command);
		};
		window.addEventListener('keydown', onKeyDown, true);
		return () => window.removeEventListener('keydown', onKeyDown, true);
	}, [runEditorCommand]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const state = session.current;
			if (!state.key || event.key.toLowerCase() !== 'p' || (!event.metaKey && !event.ctrlKey) || event.altKey) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			vscode.postMessage({
				type: 'basehalf.markdownRich.workbenchCommand',
				key: state.key,
				command: event.shiftKey ? 'showCommands' : 'quickOpen',
			});
		};
		window.addEventListener('keydown', onKeyDown, true);
		return () => window.removeEventListener('keydown', onKeyDown, true);
	}, [vscode]);

	useEffect(() => {
		// On its way down, before the editor: BlockNote's own Escape only takes
		// the caret out of the text, and says that it used the key.
		const onKeyDown = (event: KeyboardEvent) => {
			const state = session.current;
			if (!state.key || !state.ready || event.isComposing || event.keyCode === 229) {
				return;
			}
			if (state.surface === 'canvas' && event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey && event.key === 'F10') {
				event.preventDefault();
				event.stopPropagation();
				vscode.postMessage({
					type: 'basehalf.markdownRich.canvasCommand',
					key: state.key,
					command: 'focusToolbar',
				});
				return;
			}
			if (event.key !== 'Escape' || event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
				return;
			}
			// What takes Escape itself takes it first: a menu or a list, and a
			// field of its own, such as that of a link.
			const target = event.target as HTMLElement | null;
			const inField = !!target && !target.closest?.('.bn-editor')
				&& (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
			if (contextMenu !== undefined || inField || hasOpenEscapeOwner()) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			// Escape leaves the editor: on a card the editor closes, and in Card
			// Detail Card Detail does (opening and closing Card Detail, "The keyboard").
			vscode.postMessage({
				type: 'basehalf.markdownRich.canvasCommand',
				key: state.key,
				command: 'exitEditor',
			});
		};
		window.addEventListener('keydown', onKeyDown, true);
		return () => window.removeEventListener('keydown', onKeyDown, true);
	}, [contextMenu, vscode]);


	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			// Shift-Mod-S is strikethrough in Rich (note formats, rule 69).
			if (event.key.toLowerCase() !== 's' || (!event.metaKey && !event.ctrlKey) || event.shiftKey) {
				return;
			}
			event.preventDefault();
			void serializeAndRequestSave(nextRequestId(), true, false);
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [serializeAndRequestSave]);

	useEffect(() => () => {
		if (saveTimer.current !== undefined) {
			window.clearTimeout(saveTimer.current);
		}
		if (pointFocusTimer.current !== undefined) {
			window.clearTimeout(pointFocusTimer.current);
		}
		if (pointFocusFrame.current !== undefined) {
			window.cancelAnimationFrame(pointFocusFrame.current);
		}
		if (revealTimer.current !== undefined) {
			window.clearTimeout(revealTimer.current);
		}
	}, []);

	const state = session.current;
	void version;
	const canEdit = state.ready && state.editable && !state.structuralFrozen && state.conflictDisk === undefined && state.writeError === undefined;
	const usesEmbeddedControls = state.surface === 'detail';
	const notifyEditorActivated = useCallback(() => {
		const state = session.current;
		if (!state.key || !state.ready || state.loading) {
			return;
		}

		vscode.postMessage({ type: 'basehalf.markdownRich.editorActivated', key: state.key });
	}, [vscode]);
	const beginCanvasAuthoring = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
		const state = session.current;
		if (!state.key || state.surface !== 'canvas' || !state.ready || state.editable
			|| state.structuralFrozen || state.conflictDisk !== undefined || state.writeError !== undefined) {
			return;
		}

		vscode.postMessage({
			type: 'basehalf.markdownRich.canvasCommand',
			key: state.key,
			command: 'beginAuthoring',
			point: { x: event.clientX, y: event.clientY }
		});
	}, [vscode]);

	const keepLocal = () => {
		state.conflictDisk = undefined;
		setVersion(value => value + 1);
		void serializeAndRequestSave(nextRequestId(), true, true);
	};
	const useDisk = () => {
		const disk = state.conflictDisk;
		if (disk === undefined) {
			return;
		}
		void applyContent(disk, state.editable, state.key, state.resource, state.baseUri).catch(reportError);
	};
	const retryWrite = () => {
		state.writeError = undefined;
		setVersion(value => value + 1);
		void serializeAndRequestSave(nextRequestId(), true, false);
	};
	const discardLocal = () => {
		void applyContent(state.lastDisk, state.editable, state.key, state.resource, state.baseUri).catch(reportError);
	};

	return (
		<div
			className={`basehalf-markdown-rich surface-${state.surface}${state.ready ? ' ready' : ''}`}
			aria-busy={state.structuralFrozen}
			onPointerDownCapture={notifyEditorActivated}
			onFocusCapture={notifyEditorActivated}
			onDoubleClick={beginCanvasAuthoring}
			onKeyDown={stopUsedKeys}
		>
			{usesEmbeddedControls && (
				<div
					ref={setPortalElement}
					className="basehalf-markdown-rich-portal bn-root bn-mantine"
					data-color-scheme={colorScheme}
					data-mantine-color-scheme={colorScheme}
					style={paletteVariables}
				/>
			)}
			{state.conflictDisk !== undefined && (
				<div className="basehalf-markdown-rich-banner warning">
					<span>This file changed outside the rich editor.</span>
					<button type="button" onClick={keepLocal}>Keep my edits</button>
					<button type="button" className="secondary" onClick={useDisk}>Use disk version</button>
				</div>
			)}
			{state.writeError !== undefined && state.conflictDisk === undefined && (
				<div className="basehalf-markdown-rich-banner error">
					<span>Couldn't save this file: {state.writeError}</span>
					<button type="button" onClick={retryWrite}>Retry</button>
					<button type="button" className="secondary" onClick={discardLocal}>Discard local</button>
				</div>
			)}
			{state.unwrittenBlocks.size > 0 && (
				<div className="basehalf-markdown-rich-banner warning">
					<span>{baseHalfEditorLabel('Some formatting in this note could not be saved. Its text is saved.', '这篇笔记有些格式没能保存，文字都已保存。', '這篇筆記有些格式沒能儲存，文字都已儲存。')}</span>
				</div>
			)}
			{state.adhdError !== undefined && (
				<div className="basehalf-markdown-rich-banner error">
					<span>{state.adhdError}</span>
				</div>
			)}
			{contextMenu !== undefined && (
				<div
					ref={contextMenuRef}
					className="basehalf-markdown-rich-context-menu"
					style={{
						left: Math.max(4, Math.min(contextMenu.x, window.innerWidth - 280)),
						top: Math.max(4, Math.min(contextMenu.y, window.innerHeight - 40 - contextMenu.items.length * 28)),
					}}
					onMouseDown={event => event.stopPropagation()}
				>
					{contextMenu.items.map(item => (
						<button
							key={item.id}
							type="button"
							disabled={item.enabled === false}
							onClick={() => {
								setContextMenu(undefined);
								item.run();
							}}
						>
							{item.label}
						</button>
					))}
				</div>
			)}
			<div ref={scrollRef} className="basehalf-markdown-rich-scroll">
				<div className="basehalf-markdown-rich-page">
					<BlockNoteView
						editor={editor}
						editable={canEdit}
						theme={baseHalfBlockNoteTheme}
						sideMenu={false}
						formattingToolbar={false}
						linkToolbar={false}
						slashMenu={false}
						filePanel={false}
						tableHandles={false}
						emojiPicker={usesEmbeddedControls}
						comments={false}
						portalElements={usesEmbeddedControls ? portalElements : undefined}
					>
						{usesEmbeddedControls && (
							<BaseHalfNoteMediaEditContext.Provider value={noteMediaEdit}>
								<FormattingToolbarController formattingToolbar={BaseHalfFormattingToolbar} portalElement={portalElement} />
							</BaseHalfNoteMediaEditContext.Provider>
						)}
						{usesEmbeddedControls && <BaseHalfSideMenuController portalElement={portalElement} />}
						{usesEmbeddedControls && <LinkToolbarController linkToolbar={linkToolbar} portalElement={portalElement} />}
						{usesEmbeddedControls && <TableHandlesController tableHandle={BaseHalfTableHandle} tableCellHandle={BaseHalfNoTableCellHandle} portalElement={portalElement} />}
						{usesEmbeddedControls && <BaseHalfFileLinkMenu searchFiles={searchWorkspaceFiles} />}
						{usesEmbeddedControls && <SuggestionMenuController triggerCharacter={'/'} getItems={slashMenuItems} portalElement={portalElement} />}
						{usesEmbeddedControls && <FilePanelController filePanel={BaseHalfFilePanel} portalElement={portalElement} />}
					</BlockNoteView>
				</div>
			</div>
		</div>
	);
}

const mediaChoices: ReadonlySet<string> = new Set<BaseHalfNoteMediaChoice>(['image', 'video', 'audio', 'file']);

/**
 * The items of the slash menu, and of the add button that opens it: Picture,
 * Video, Sound, and File open the system's file chooser at once, and their
 * block is added once its file is copied (note formats, rule 49).
 */
function baseHalfSlashMenuItems(editor: BlockNoteEditor<any, any, any>): DefaultReactSuggestionItem[] {
	return getDefaultReactSlashMenuItems(editor).map(item => {
		// Each item keeps the key of the editor's own list, which its type leaves out.
		const key = (item as { readonly key?: string }).key;
		return key && mediaChoices.has(key) ? { ...item, onItemClick: () => chooseBaseHalfNoteMedia(editor, key as BaseHalfNoteMediaChoice) } : item;
	});
}

/**
 * The panel of Replace (note formats, rule 50): a file from the disk, and for
 * a picture, a video, and a sound a web address too. A file block is stored
 * as a link and read back as one, so it offers no web address.
 */
function BaseHalfFilePanel(props: FilePanelProps): JSX.Element {
	const editor = useBlockNoteEditor();
	const dictionary = useDictionary();
	const [, setLoading] = useState(false);
	return editor.getBlock(props.blockId)?.type === 'file'
		? <FilePanel {...props} tabs={[{ name: dictionary.file_panel.upload.title, tabPanel: <UploadTab blockId={props.blockId} setLoading={setLoading} /> }]} />
		: <FilePanel {...props} />;
}

// What the note cannot store, or what BaseHalf does otherwise (note formats,
// rules 2 and 3): alignment, Nest and Unnest (Tab and Shift-Tab stay),
// merged cells, comments, a file's preview, and its download.
// A block's name is its stored file's name, so the toolbar offers no Rename (files in notes, rule 21).
const baseHalfRemovedToolbarItems: ReadonlySet<string> = new Set([
	'tableCellMergeButton', 'fileDownloadButton', 'filePreviewButton', 'fileRenameButton',
	'textAlignLeftButton', 'textAlignCenterButton', 'textAlignRightButton',
	'nestBlockButton', 'unnestBlockButton', 'addCommentButton', 'addTiptapCommentButton',
]);

/**
 * A key the editor used does only what the editor does with it (note
 * formats, rule 69): the page forwards every key that reaches it to the
 * window, where Shift-Mod-S is Save As and Mod-B shows or hides the sidebar.
 */
function stopUsedKeys(event: ReactKeyboardEvent): void {
	if (event.nativeEvent.defaultPrevented) {
		event.nativeEvent.stopPropagation();
	}
}

/** What Edit of a picture's toolbar does, and the picture whose editor stands over it (D113). */
const BaseHalfNoteMediaEditContext = createContext<{ readonly edit: (blockId: string) => void; readonly editing: string | undefined; readonly hidden: boolean }>({ edit: () => undefined, editing: undefined, hidden: false });

function BaseHalfFormattingToolbar(): JSX.Element | null {
	const mediaEdit = useContext(BaseHalfNoteMediaEditContext);
	const items = getFormattingToolbarItems()
		.filter(item => !baseHalfRemovedToolbarItems.has(String(item.key)))
		.map(item => item.key === 'replaceFileButton' ? <BaseHalfFileReplaceButton key={'replaceFileButton'} /> : item);
	// While a picture is edited, its editor has the tools; after it, the toolbar waits for the pointer.
	return mediaEdit.hidden ? null : <FormattingToolbar>{[<BaseHalfMediaEditButton key={'mediaEditButton'} />, ...items]}</FormattingToolbar>;
}

/** Edit for a picture of a file (D113): the window draws the picture's editor over it, in the note. */
function BaseHalfMediaEditButton(): JSX.Element | null {
	const editor = useBlockNoteEditor();
	const Components = useComponentsContext()!;
	const mediaEdit = useContext(BaseHalfNoteMediaEditContext);
	const blocks = useSelectedBlocks(editor);
	const block = blocks.length === 1 ? blocks[0] : undefined;
	const url = block?.type === 'image' && typeof block.props.url === 'string' ? block.props.url : '';
	// A picture on the web is not a file BaseHalf edits.
	if (!block || !url || !editor.isEditable || /^(?:[a-z][a-z0-9+.-]*:|#)/i.test(url)) {
		return null;
	}
	const label = baseHalfEditorLabel('Edit', '编辑', '編輯');
	return (
		<Components.FormattingToolbar.Button className={'bn-button'} mainTooltip={label} label={label} onClick={() => mediaEdit.edit(block.id)}>
			{label}
		</Components.FormattingToolbar.Button>
	);
}

/** Open in the link toolbar: the link goes where the note's link router sends it (rule 54). */
function BaseHalfOpenLinkButton({ url, onOpen }: { readonly url: string; readonly onOpen: (href: string) => void }): JSX.Element {
	const Components = useComponentsContext()!;
	const dictionary = useDictionary();
	return (
		<Components.LinkToolbar.Button
			className={'bn-button'}
			mainTooltip={dictionary.link_toolbar.open.tooltip}
			label={dictionary.link_toolbar.open.tooltip}
			isSelected={false}
			onClick={() => onOpen(url)}
			icon={<RiExternalLinkFill />}
		/>
	);
}

/**
 * Replace (note formats, rule 50): for a file block, a file from the disk
 * only, as the note stores a file block as a link and reads it back as one;
 * for a picture, a video, and a sound, the editor's own, a web address too.
 */
function BaseHalfFileReplaceButton(): JSX.Element | null {
	const editor = useBlockNoteEditor();
	const Components = useComponentsContext()!;
	const dictionary = useDictionary();
	const blocks = useSelectedBlocks(editor);
	const block = blocks.length === 1 ? blocks[0] : undefined;
	if (!block || block.type !== 'file' || !editor.isEditable) {
		return <FileReplaceButton />;
	}
	const label = dictionary.formatting_toolbar.file_replace.tooltip.file;
	return (
		<Components.Generic.Popover.Root position={'bottom'}>
			<Components.Generic.Popover.Trigger>
				<Components.FormattingToolbar.Button className={'bn-button'} mainTooltip={label} label={label} icon={<RiImageEditFill />} />
			</Components.Generic.Popover.Trigger>
			<Components.Generic.Popover.Content className={'bn-popover-content bn-panel-popover'} variant={'panel-popover'}>
				<BaseHalfFilePanel blockId={block.id} />
			</Components.Generic.Popover.Content>
		</Components.Generic.Popover.Root>
	);
}

/** The menu of a block's drag handle holds Delete only (rule 4). */
function BaseHalfDragHandleMenu(): JSX.Element {
	const dictionary = useDictionary();
	return (
		<DragHandleMenu>
			<RemoveBlockItem>{dictionary.drag_handle.delete_menuitem}</RemoveBlockItem>
		</DragHandleMenu>
	);
}

/** A table's rows and columns offer Delete and Add, and no header, color, merge, or split (rule 6). */
function BaseHalfTableHandleMenu({ orientation }: { readonly orientation: 'row' | 'column' }): JSX.Element {
	return (
		<TableHandleMenu orientation={orientation}>
			<DeleteButton orientation={orientation} />
			{orientation === 'row'
				? <><AddButton orientation={'row'} side={'above'} /><AddButton orientation={'row'} side={'below'} /></>
				: <><AddButton orientation={'column'} side={'left'} /><AddButton orientation={'column'} side={'right'} /></>}
		</TableHandleMenu>
	);
}

function BaseHalfTableHandle(props: TableHandleProps): JSX.Element {
	return <TableHandle {...props} tableHandleMenu={BaseHalfTableHandleMenu as FunctionComponent} />;
}

/** The cells of a table offer nothing to merge, split, or color. */
function BaseHalfNoTableCellHandle(_props: TableCellButtonProps): null {
	return null;
}

/** The palette's colors on BaseHalf's portal, where the editor's menus are drawn: the editor sets them on its own root only. */
const paletteVariables: CSSProperties = Object.fromEntries(BASEHALF_NOTE_PALETTE_COLORS.flatMap(name => [
	[`--bn-colors-highlights-${name}-text`, BASEHALF_NOTE_PALETTE[name].text],
	[`--bn-colors-highlights-${name}-background`, BASEHALF_NOTE_PALETTE[name].background],
]));

const root = document.getElementById('root');
if (!root) {
	throw new Error('BaseHalf Markdown rich webview root is missing');
}

// Before the first note is drawn: toggles show open as their note's file says (note formats, rule 40).
installBaseHalfNoteToggleState();
createRoot(root).render(<MarkdownRichEditor />);

function decodeHtmlKey(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

/** The address in the page of a file of the note, read from the note's folder; none for an address of the web or a link within the note. */
function noteFileAddress(url: string, baseUri: string | undefined): string | undefined {
	if (!url || /^(?:[a-z][a-z0-9+.-]*:|#)/i.test(url)) {
		return undefined;
	}
	return baseUri ? new URL(url, baseUri).toString() : url;
}

