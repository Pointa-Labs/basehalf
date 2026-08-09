/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import './editor.css';

import { BlockNoteSchema, createBlockSpec, defaultBlockSpecs } from '@blocknote/core';
import { insertOrUpdateBlockForSlashMenu, SideMenuExtension } from '@blocknote/core/extensions';
import { en, zh, zhTW, type Dictionary } from '@blocknote/core/locales';
import { BlockNoteView, type Theme } from '@blocknote/mantine';
import {
	FormattingToolbar,
	FormattingToolbarController,
	GenericPopover,
	ReactAudioBlock,
	ReactFileBlock,
	ReactImageBlock,
	ReactVideoBlock,
	SideMenu,
	SuggestionMenuController,
	getFormattingToolbarItems,
	useBlockNoteEditor,
	useCreateBlockNote,
	useExtensionState,
	type GenericPopoverReference,
} from '@blocknote/react';
import { applyUpdate, Doc as YDoc, UndoManager, type XmlFragment } from 'yjs';
import { defaultDeleteFilter, defaultProtectedNodes, ySyncPluginKey, yUndoPluginKey } from 'y-prosemirror';
import { TextSelection, type EditorState } from '@tiptap/pm/state';
import { createRoot } from 'react-dom/client';
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type JSX,
	type MouseEvent as ReactMouseEvent,
} from 'react';
import {
	buildBaseHalfMarkdownFocusFields,
	baseHalfMarkdownBlockReadSpan,
	baseHalfMarkdownLinesToBlockIds,
	countBaseHalfMarkdownNewlines,
	type IBaseHalfMarkdownFocusBlock,
} from '../../../src/vs/workbench/basehalf/common/basehalfMarkdownFocus.js';
import {
	type IBaseHalfAdhdCommand,
	type IBaseHalfAdhdFile,
} from '../../../src/vs/workbench/basehalf/common/basehalfAdhd.js';
import {
	BASEHALF_RAW_PASSTHROUGH_BLOCK,
	buildBaseHalfMarkdownLoadProjection,
	collectBaseHalfMarkdownSaveContributions,
	projectBaseHalfMarkdownSegment,
	segmentBaseHalfMarkdownBody,
	spliceBaseHalfMarkdownSave,
	splitBaseHalfMarkdownFrontmatter,
	type IBaseHalfMarkdownEditorApi,
	type IBaseHalfMarkdownReuseEntry,
} from '../../../src/vs/workbench/basehalf/common/basehalfMarkdownProjection.js';
import {
	diffBaseHalfMarkdownSegments,
	groupBaseHalfMarkdownContributions,
} from '../../../src/vs/workbench/basehalf/common/basehalfMarkdownMerge.js';
import {
	makeBaseHalfAdhdDecorationExtension,
	pushBaseHalfAdhdDecorations,
} from './adhdDecorations.js';
import {
	BASEHALF_MARKDOWN_ATTACHMENT_MAX_BYTES,
	isBaseHalfMarkdownRichHostMessage,
	type BaseHalfMarkdownRichEditorCommand,
	type BaseHalfMarkdownRichSurface,
	type BaseHalfMarkdownRichWebviewMessage,
	type IBaseHalfMarkdownRichFormatState,
	type IBaseHalfMarkdownRichFileLink,
	type IBaseHalfMarkdownRichTextSelection,
} from '../../../src/vs/workbench/basehalf/common/basehalfMarkdownRichWebviewProtocol.js';
import type { BaseHalfMarkdownFormatBlockType, BaseHalfMarkdownFormatToggleState } from '../../../src/vs/workbench/basehalf/common/basehalfMarkdownFormatting.js';
import { baseHalfCaptureStableMarkdownRichSnapshot } from '../../../src/vs/workbench/basehalf/common/basehalfMarkdownRichStructuralSave.js';
import { BaseHalfMarkdownRichAsyncMutationBarrier } from '../../../src/vs/workbench/basehalf/common/basehalfMarkdownRichAsyncMutation.js';

interface VsCodeApi {
	postMessage(message: BaseHalfMarkdownRichWebviewMessage, transfer?: readonly ArrayBuffer[]): void;
	getState(): unknown;
	setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const BLOCKNOTE_FRAGMENT_NAME = 'bn';
// Mirrors BASEHALF_AUTO_SAVE_DELAY_MS in
// src/vs/workbench/basehalf/common/basehalfWorkbenchProfile.ts — the webview
// bundle cannot import workbench code. Keep the two in sync.
const AUTOSAVE_MS = 250;
const FOCUS_DEBOUNCE_MS = 180;
const SIDE_MENU_GUTTER_GAP = 8;

function baseHalfBlockNoteDictionary(): Dictionary {
	const locale = document.documentElement.lang.toLowerCase();
	return locale.startsWith('zh-tw') || locale.startsWith('zh-hk')
		? zhTW
		: locale.startsWith('zh') ? zh : en;
}

function baseHalfEditorLabel(english: string, simplifiedChinese: string, traditionalChinese = simplifiedChinese): string {
	const locale = document.documentElement.lang.toLowerCase();
	return locale.startsWith('zh-tw') || locale.startsWith('zh-hk')
		? traditionalChinese
		: locale.startsWith('zh') ? simplifiedChinese : english;
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
	},
	borderRadius: 4,
	fontFamily: 'var(--vscode-font-family)',
};

function workbenchColorScheme(): 'light' | 'dark' {
	return document.body.classList.contains('vscode-light') || document.body.classList.contains('vscode-high-contrast-light')
		? 'light'
		: 'dark';
}

interface PassthroughProps {
	raw?: string;
	source?: string;
	hidden?: boolean;
}

const rawPassthroughSpec = createBlockSpec(
	{
		type: BASEHALF_RAW_PASSTHROUGH_BLOCK,
		propSchema: {
			raw: { default: '' },
			source: { default: '' },
			hidden: { default: false },
		},
		content: 'none',
	},
	{
		render: block => {
			const props = block.props as PassthroughProps;
			if (props.hidden) {
				const hidden = document.createElement('span');
				hidden.setAttribute('data-basehalf-raw-passthrough', 'hidden');
				hidden.style.display = 'none';
				return { dom: hidden };
			}

			const dom = document.createElement('div');
			dom.className = 'basehalf-raw-passthrough';
			dom.setAttribute('data-basehalf-raw-passthrough', '');

			const pre = document.createElement('pre');
			pre.textContent = (props.source ?? props.raw ?? '').replace(/^\n+|\n+$/g, '');
			dom.appendChild(pre);

			// This block holds Markdown the rich projection cannot edit; the
			// escape hatch jumps to the source projection at its lines.
			const edit = document.createElement('button');
			edit.type = 'button';
			edit.className = 'basehalf-raw-passthrough-edit';
			edit.textContent = baseHalfEditorLabel('Edit in source', '在源码中编辑', '在原始碼中編輯');
			edit.title = baseHalfEditorLabel(
				'This content can only be edited as raw Markdown',
				'这段内容只能作为原始 Markdown 编辑',
				'這段內容只能作為原始 Markdown 編輯'
			);
			dom.appendChild(edit);
			return { dom };
		},
		toExternalHTML: block => {
			const props = block.props as PassthroughProps;
			const pre = document.createElement('pre');
			pre.textContent = props.source ?? props.raw ?? '';
			return { dom: pre };
		},
	},
)();

const schema = BlockNoteSchema.create({
	blockSpecs: {
		...defaultBlockSpecs,
		audio: ReactAudioBlock(),
		file: ReactFileBlock(),
		image: ReactImageBlock(),
		video: ReactVideoBlock(),
		[BASEHALF_RAW_PASSTHROUGH_BLOCK]: rawPassthroughSpec,
	},
});

interface SessionState {
	key: string;
	surface: BaseHalfMarkdownRichSurface;
	resource: string;
	baseUri: string;
	frontmatter: string;
	byId: Map<string, IBaseHalfMarkdownReuseEntry>;
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
}

interface IIncomingInit {
	readonly content: string;
	readonly editable: boolean;
	readonly key: string;
	readonly resource: string;
	readonly baseUri: string;
	readonly surface: BaseHalfMarkdownRichSurface;
	readonly selection?: IBaseHalfMarkdownRichTextSelection;
	/** Arrival order; a payload older than the latest arrival is stale. */
	readonly generation: number;
}

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

function clearSelectionReveal(editorElement: HTMLElement | undefined): void {
	for (const element of Array.from(editorElement?.querySelectorAll<HTMLElement>('.basehalf-markdown-rich-selection-reveal') ?? [])) {
		element.classList.remove('basehalf-markdown-rich-selection-reveal');
	}
}

function shiftedRect(rect: DOMRect, x: number): DOMRect {
	return new DOMRect(rect.x + x, rect.y, rect.width, rect.height);
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

async function baseHalfAdoptLoadProjection(
	editorApi: IBaseHalfMarkdownEditorApi,
	currentBlocks: readonly unknown[],
	projectedBlocks: readonly unknown[],
	projectedById: ReadonlyMap<string, IBaseHalfMarkdownReuseEntry>
): Promise<Map<string, IBaseHalfMarkdownReuseEntry> | undefined> {
	if (currentBlocks.length !== projectedBlocks.length) {
		return undefined;
	}

	const [currentMarkdown, projectedMarkdown] = await Promise.all([
		editorApi.blocksToMarkdownLossy([...currentBlocks]),
		editorApi.blocksToMarkdownLossy([...projectedBlocks]),
	]);
	if (currentMarkdown !== projectedMarkdown) {
		return undefined;
	}

	const byId = new Map<string, IBaseHalfMarkdownReuseEntry>();
	for (let index = 0; index < projectedBlocks.length; index++) {
		const projectedId = (projectedBlocks[index] as { readonly id?: unknown }).id;
		const currentId = (currentBlocks[index] as { readonly id?: unknown }).id;
		if (typeof projectedId !== 'string') {
			continue;
		}
		const entry = projectedById.get(projectedId);
		if (!entry) {
			continue;
		}
		if (typeof currentId !== 'string') {
			return undefined;
		}
		byId.set(currentId, entry);
	}
	return byId.size === projectedById.size ? byId : undefined;
}

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

// BlockNote's default React side menu anchors to the hovered block DOM node;
// for nested continuation blocks that places the handle over the indent guide.
// Use BlockNote core's root-gutter reference and leave a small gap so the drag
// handle does not visually merge with list/blockquote guide lines.
function BaseHalfSideMenuController({ portalElement }: { readonly portalElement: HTMLElement | null }): JSX.Element {
	const editor = useBlockNoteEditor();
	const state = useExtensionState(SideMenuExtension, {
		editor,
		selector: state => state !== undefined ? {
			show: state.show,
			referencePos: state.referencePos,
			blockId: state.block.id,
		} : undefined,
	});
	const reference = useMemo<GenericPopoverReference | undefined>(() => {
		if (!state?.show) {
			return undefined;
		}
		return {
			element: undefined,
			getBoundingClientRect: () => shiftedRect(state.referencePos, -SIDE_MENU_GUTTER_GAP),
		};
	}, [state?.referencePos, state?.show]);

	return (
		<GenericPopover
			reference={reference}
			portalElement={portalElement ?? undefined}
			useFloatingOptions={{
				open: state?.show,
				placement: 'left-start',
			}}
			useDismissProps={{ enabled: false }}
			focusManagerProps={{ disabled: true }}
			elementProps={{ style: { zIndex: 20 } }}
		>
			{state?.blockId && <SideMenu />}
		</GenericPopover>
	);
}

function MarkdownRichEditor(): JSX.Element {
	const vscode = useMemo(() => acquireVsCodeApi(), []);
	const initialKey = useMemo(() => decodeHtmlKey(document.getElementById('root')?.dataset.basehalfKey ?? ''), []);
	const ydoc = useMemo(() => new YDoc(), []);
	const asyncMutationBarrier = useMemo(() => new BaseHalfMarkdownRichAsyncMutationBarrier(), []);
	const fragment = useMemo(() => ydoc.getXmlFragment(BLOCKNOTE_FRAGMENT_NAME), [ydoc]);
	const session = useRef(createSessionState(initialKey));
	const scrollRef = useRef<HTMLDivElement>(null);
	const saveTimer = useRef<number | undefined>(undefined);
	const liveUndoManager = useRef<UndoManager | undefined>(undefined);
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
		readonly resolve: (url: string) => void;
		readonly reject: (error: Error) => void;
		readonly timer: number;
	}>());
	const focusTimer = useRef<number | undefined>(undefined);
	const pointFocusTimer = useRef<number | undefined>(undefined);
	const pointFocusFrame = useRef<number | undefined>(undefined);
	const yTransactionRevision = useRef(0);
	const lastYTransactionAt = useRef(performance.now());
	const revealTimer = useRef<number | undefined>(undefined);
	const adhdExtension = useMemo(() => makeBaseHalfAdhdDecorationExtension(), []);
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

	const uploadFile = useCallback((file: File): Promise<string> => asyncMutationBarrier.run(async () => {
		const state = session.current;
		if (!state.key || !state.ready || !state.editable || state.structuralFrozen) {
			throw new Error('This document is read-only.');
		}
		if (file.size > BASEHALF_MARKDOWN_ATTACHMENT_MAX_BYTES) {
			throw new Error(`Files larger than ${BASEHALF_MARKDOWN_ATTACHMENT_MAX_BYTES / 1024 / 1024} MB cannot be inserted.`);
		}

		const data = await file.arrayBuffer();
		const requestId = `attachment-${nextRequestId()}`;
		return new Promise<string>((resolve, reject) => {
			const timer = window.setTimeout(() => {
				pendingAttachmentUploads.current.delete(requestId);
				reject(new Error('The attachment took too long to save.'));
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

	const resolveFileUrl = useCallback(async (url: string): Promise<string> => {
		if (!url || /^(?:[a-z][a-z0-9+.-]*:|#)/i.test(url)) {
			return url;
		}
		const baseUri = session.current.baseUri;
		return baseUri ? new URL(url, baseUri).toString() : url;
	}, []);

	const editor = useCreateBlockNote({
		schema,
		dictionary: baseHalfBlockNoteDictionary(),
		uploadFile,
		resolveFileUrl,
		extensions: [adhdExtension],
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

	// y-prosemirror creates the collaboration undo manager in plugin state but
	// destroys it from plugin-view teardown, and plugin state survives that
	// teardown. This webview goes through plugin-view destroy/create cycles at
	// startup (an editor unmount/remount plus a plugin reconfiguration), after
	// which the plugin state still holds the destroyed manager and no local
	// edit is ever captured again — undo stays permanently empty. Own the
	// manager lifecycle instead: swap in a manager whose destroy survives
	// plugin-view churn (document teardown clears its doc listener) and mirror
	// the plugin's selection-restore listeners.
	const ensureLiveUndoManager = useCallback((): UndoManager | undefined => {
		const view = editor.prosemirrorView;
		if (!view) {
			return undefined;
		}
		const syncState = ySyncPluginKey.getState(view.state) as { type?: XmlFragment } | undefined;
		const undoState = yUndoPluginKey.getState(view.state) as { undoManager: UndoManager; prevSel?: unknown } | undefined;
		if (!syncState?.type || !undoState?.undoManager) {
			return undefined;
		}
		if (undoState.undoManager === liveUndoManager.current) {
			return undoState.undoManager;
		}

		// Truly dispose whatever is being replaced — instance destroy may be
		// our own no-op override, so go through the prototype.
		const replaced = undoState.undoManager;
		UndoManager.prototype.destroy.call(replaced);
		if (liveUndoManager.current && liveUndoManager.current !== replaced) {
			UndoManager.prototype.destroy.call(liveUndoManager.current);
		}
		const manager = new UndoManager(syncState.type, {
			trackedOrigins: new Set([ySyncPluginKey]),
			deleteFilter: item => defaultDeleteFilter(item, defaultProtectedNodes),
			captureTransaction: transaction => transaction.meta.get('addToHistory') !== false,
		});
		manager.destroy = () => { /* must outlive plugin-view teardown */ };
		manager.on('stack-item-added', ({ stackItem }) => {
			const state = editor.prosemirrorView?.state;
			const binding = state ? (ySyncPluginKey.getState(state) as { binding?: object } | undefined)?.binding : undefined;
			if (binding && state) {
				stackItem.meta.set(binding, (yUndoPluginKey.getState(state) as { prevSel?: unknown } | undefined)?.prevSel ?? null);
			}
		});
		manager.on('stack-item-popped', ({ stackItem }) => {
			const state = editor.prosemirrorView?.state;
			const binding = state
				? (ySyncPluginKey.getState(state) as { binding?: { beforeTransactionSelection: unknown } } | undefined)?.binding
				: undefined;
			if (binding) {
				binding.beforeTransactionSelection = stackItem.meta.get(binding) || binding.beforeTransactionSelection;
			}
		});
		// Preserve any history the replaced manager still held (e.g. a stack
		// restored by a fork merge) so the swap is lossless.
		manager.undoStack = replaced.undoStack;
		manager.redoStack = replaced.redoStack;
		undoState.undoManager = manager;
		liveUndoManager.current = manager;
		return manager;
	}, [editor]);

	const editorApi = useMemo<IBaseHalfMarkdownEditorApi>(() => ({
		tryParseMarkdownToBlocks: markdown => editor.tryParseMarkdownToBlocks(markdown),
		blocksToMarkdownLossy: blocks => editor.blocksToMarkdownLossy(blocks as Parameters<typeof editor.blocksToMarkdownLossy>[0]),
	}), [editor]);

	const discardSelectionForNextSharedTransaction = useCallback(() => {
		const viewState = editor.prosemirrorView?.state;
		const binding = viewState
			? (ySyncPluginKey.getState(viewState) as {
				binding?: { beforeTransactionSelection: unknown };
			} | undefined)?.binding
			: undefined;
		if (binding) {
			binding.beforeTransactionSelection = { type: 'text', anchor: null, head: null };
		}
	}, [editor]);

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
		const blocks = editor.document as unknown as readonly IBaseHalfMarkdownFocusBlock[];
		const frontmatterLines = countBaseHalfMarkdownNewlines(state.frontmatter);
		return new Set(baseHalfMarkdownLinesToBlockIds(blocks, state.byId, frontmatterLines, adhd.read_paragraphs ?? []));
	}, [editor]);

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
		state.editable = editable;
		state.conflictDisk = undefined;
		state.writeError = undefined;
		if (isNewResource) {
			state.adhd = null;
			state.adhdError = undefined;
			state.readingModeEnabled = false;
			state.readBlockIds = new Set();
		}
		setVersion(value => value + 1);

		const { frontmatter, body } = splitBaseHalfMarkdownFrontmatter(content);
		const { blocks, byId } = await buildBaseHalfMarkdownLoadProjection(editorApi, body);
		const adoptedById = !wasReady
			? await baseHalfAdoptLoadProjection(editorApi, editor.document, blocks, byId).catch(() => undefined)
			: undefined;
		if (!adoptedById) {
			const view = editor.prosemirrorView;
			if (view) {
				view.dispatch(view.state.tr.setSelection(TextSelection.atStart(view.state.doc)));
			}
			discardSelectionForNextSharedTransaction();
			editor.replaceBlocks(editor.document, blocks as Parameters<typeof editor.replaceBlocks>[1]);
		}
		// Loading or adopting a projection must not become an undoable edit.
		// Otherwise undo could walk past the load and blank the document. The
		// fallback covers loads that land while the editor view is unmounted.
		(ensureLiveUndoManager() ?? liveUndoManager.current)?.clear();

		state.frontmatter = frontmatter;
		state.byId = adoptedById ?? byId;
		state.lastDisk = content;
		state.editRevision = 0;
		state.lastAcknowledgedRevision = 0;
		state.ready = true;
		state.readBlockIds = projectAdhdReadBlocks(state.adhd);
		state.loading = false;
		notifyDirty(false);
		setVersion(value => value + 1);
	}, [discardSelectionForNextSharedTransaction, editor, editorApi, ensureLiveUndoManager, notifyDirty, projectAdhdReadBlocks]);

	// First meaningful frame: tell the host once the applied document has been
	// COMMITTED to the DOM (effects run after commit), so the projection swap
	// it is holding never reveals a half-built editor. Deliberately not paint
	// based (no rAF): the host keeps this webview hidden until the swap, and a
	// hidden iframe receives no animation frames — the browser paints the
	// committed DOM in the same frame the layer becomes visible.
	useEffect(() => {
		const state = session.current;
		if (renderedAnnounced.current || !state.ready || !state.key) {
			return;
		}
		renderedAnnounced.current = true;
		vscode.postMessage({ type: 'basehalf.markdownRich.rendered', key: state.key });
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
			undoManager?.stopCapturing();
			const handled = editor.undo();
			undoManager?.stopCapturing();
			return handled;
		}
		if (command === 'redo') {
			undoManager?.stopCapturing();
			const handled = editor.redo();
			undoManager?.stopCapturing();
			return handled;
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
	}, [editor, ensureLiveUndoManager, insertDivider, postFormatState, setSelectedBlockType, toggleSelectedList]);

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
		if (!structural && !state.dirty && !forceSerialize && !forceWrite) {
			state.pendingSaveContent.set(requestId, { content: state.lastDisk, revision: state.editRevision });
			vscode.postMessage({
				type: 'basehalf.markdownRich.saveRequested',
				key: state.key,
				requestId,
				content: state.lastDisk,
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
					serialize: () => spliceBaseHalfMarkdownSave(editorApi, editor.document, state.frontmatter, state.byId),
				})
				: {
					value: await spliceBaseHalfMarkdownSave(editorApi, editor.document, state.frontmatter, state.byId),
					revision: state.editRevision,
				};
			if (!snapshot) {
				return;
			}
			state.pendingSaveContent.set(requestId, { content: snapshot.value, revision: snapshot.revision });
			vscode.postMessage({
				type: 'basehalf.markdownRich.saveRequested',
				key: state.key,
				requestId,
				content: snapshot.value,
				previousContent: state.lastDisk,
				forceWrite,
			});
		} catch (error) {
			reportError(error);
		}
	}, [editor, editorApi, reportError, vscode, waitForCompositionSettled, waitForPendingSaveSettled]);

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
			void serializeAndRequestSave(nextRequestId(), false, false);
		}, AUTOSAVE_MS);
	}, [serializeAndRequestSave]);

	const scheduleFocus = useCallback(() => {
		if (focusTimer.current !== undefined) {
			window.clearTimeout(focusTimer.current);
		}
		if (pointFocusTimer.current !== undefined) {
			window.clearTimeout(pointFocusTimer.current);
		}
		if (pointFocusFrame.current !== undefined) {
			window.cancelAnimationFrame(pointFocusFrame.current);
			pointFocusFrame.current = undefined;
		}
		focusTimer.current = window.setTimeout(() => {
			focusTimer.current = undefined;
			const state = session.current;
			if (!state.key || !state.ready || state.loading) {
				return;
			}

			const blocks = editor.document as unknown as readonly IBaseHalfMarkdownFocusBlock[];
			const frontmatterLines = countBaseHalfMarkdownNewlines(state.frontmatter);
			const cursor = (() => {
				try {
					const position = editor.getTextCursorPosition();
					const blockId = position.block.id;
					const selection = editor.prosemirrorView?.state.selection;
					const parentOffset = selection?.$from.parentOffset;
					let column = typeof parentOffset === 'number' && parentOffset >= 0 ? parentOffset + 1 : 1;
					let codeWithinOffset: number | null = null;
					const blockElement = findBlockElement(editor.domElement, blockId);
					if (blockElement?.dataset.contentType === 'codeBlock' && selection && typeof parentOffset === 'number') {
						const text = selection.$from.parent.textContent ?? '';
						const before = text.slice(0, parentOffset);
						codeWithinOffset = countBaseHalfMarkdownNewlines(before);
						column = before.length - (before.lastIndexOf('\n') + 1) + 1;
					}
					return { blockId, column, codeWithinOffset };
				} catch {
					return undefined;
				}
			})();
			const fields = buildBaseHalfMarkdownFocusFields({
				blocks,
				byId: state.byId,
				frontmatterLines,
				cursor,
				visibleBlockId: firstVisibleBlockId(editor.domElement, scrollRef.current),
			});
			if (fields.cursor || fields.visible_blocks || fields.visible_lines) {
				vscode.postMessage({ type: 'basehalf.markdownRich.focusChanged', key: state.key, fields });
			}
		}, FOCUS_DEBOUNCE_MS);
	}, [editor, vscode]);

	const revealSelection = useCallback((selection: IBaseHalfMarkdownRichTextSelection | undefined) => {
		const state = session.current;
		if (!selection || !state.ready || state.loading) {
			return;
		}

		const start = Math.min(selection.startLineNumber, selection.endLineNumber ?? selection.startLineNumber);
		const end = Math.max(selection.startLineNumber, selection.endLineNumber ?? selection.startLineNumber);
		const ids = baseHalfMarkdownLinesToBlockIds(
			editor.document as unknown as readonly IBaseHalfMarkdownFocusBlock[],
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

			clearSelectionReveal(editorElement);
			elements[0].scrollIntoView({ block: 'center', inline: 'nearest' });
			for (const element of elements) {
				element.classList.add('basehalf-markdown-rich-selection-reveal');
			}

			if (revealTimer.current !== undefined) {
				window.clearTimeout(revealTimer.current);
			}
			revealTimer.current = window.setTimeout(() => {
				revealTimer.current = undefined;
				clearSelectionReveal(editorElement);
			}, 1800);
			scheduleFocus();
		};

		window.requestAnimationFrame(() => reveal());
	}, [editor, scheduleFocus]);

	const focusAtPoint = useCallback((point: { readonly x: number; readonly y: number }): void => {
		if (pointFocusTimer.current !== undefined) {
			window.clearTimeout(pointFocusTimer.current);
		}
		if (pointFocusFrame.current !== undefined) {
			window.cancelAnimationFrame(pointFocusFrame.current);
			pointFocusFrame.current = undefined;
		}
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
	}, [editor]);

	// Applies an external file change (agent writes, other tools) to the live
	// document incrementally: only the changed segment range is replaced, so
	// blocks outside it — and the cursor, scroll position, and undo history —
	// survive. Returns false when the change cannot be merged safely; the
	// caller falls back to a full rebuild.
	const applyExternalContent = useCallback(async (content: string, editable: boolean, key: string, resource: string): Promise<boolean> => {
		const state = session.current;
		if (!state.ready || state.loading || state.dirty
			|| state.key !== key || state.resource !== resource
			|| state.conflictDisk !== undefined || state.writeError !== undefined) {
			return false;
		}

		const baseline = state.lastDisk;
		state.editable = editable;
		if (content === baseline) {
			setVersion(value => value + 1);
			return true;
		}

		const { frontmatter, body } = splitBaseHalfMarkdownFrontmatter(content);
		const oldBody = splitBaseHalfMarkdownFrontmatter(baseline).body;
		if (body === oldBody) {
			state.frontmatter = frontmatter;
			state.lastDisk = content;
			state.lastAcknowledgedRevision = state.editRevision;
			// Read ranges are absolute file lines; a frontmatter size change
			// shifts every block's line span.
			state.readBlockIds = projectAdhdReadBlocks(state.adhd);
			setVersion(value => value + 1);
			scheduleFocus();
			return true;
		}
		if (oldBody === '' || body === '') {
			return false;
		}

		const oldSegments = segmentBaseHalfMarkdownBody(oldBody);
		const newSegments = segmentBaseHalfMarkdownBody(body);
		const contributions = await collectBaseHalfMarkdownSaveContributions(editorApi, editor.document, state.byId);
		const groups = groupBaseHalfMarkdownContributions(
			contributions.map(contribution => contribution.text),
			oldSegments.map(segment => segment.raw)
		);
		if (!groups) {
			return false;
		}

		const region = diffBaseHalfMarkdownSegments(
			oldSegments.map(segment => segment.raw),
			newSegments.map(segment => segment.raw)
		);
		if (!region) {
			return false;
		}

		const removeIds: string[] = [];
		for (let index = region.oldStart; index < region.oldEnd; index++) {
			for (const contributionIndex of groups[index]) {
				const id = contributions[contributionIndex].id;
				if (!id) {
					return false;
				}
				removeIds.push(id);
			}
		}
		if (removeIds.length === contributions.length && region.newStart === region.newEnd) {
			// Would leave the document without blocks; rebuild handles that shape.
			return false;
		}

		const newBlocks: unknown[] = [];
		const newEntries: Array<readonly [string, IBaseHalfMarkdownReuseEntry]> = [];
		for (let index = region.newStart; index < region.newEnd; index++) {
			const projection = await projectBaseHalfMarkdownSegment(editorApi, newSegments[index]);
			newBlocks.push(...projection.blocks);
			newEntries.push(...projection.entries);
		}

		let anchorBlockId: string | undefined;
		let anchorPlacement: 'before' | 'after' = 'after';
		if (removeIds.length === 0 && newBlocks.length > 0) {
			if (region.oldStart > 0) {
				const group = groups[region.oldStart - 1];
				anchorBlockId = contributions[group[group.length - 1]].id;
			} else if (groups.length > 0) {
				anchorBlockId = contributions[groups[0][0]].id;
				anchorPlacement = 'before';
			}
			if (!anchorBlockId) {
				return false;
			}
		}

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
		try {
			if (removeIds.length > 0 && newBlocks.length > 0) {
				editor.replaceBlocks(removeIds, newBlocks as Parameters<typeof editor.replaceBlocks>[1]);
			} else if (removeIds.length > 0) {
				editor.removeBlocks(removeIds);
			} else if (newBlocks.length > 0 && anchorBlockId) {
				editor.insertBlocks(newBlocks as Parameters<typeof editor.insertBlocks>[0], anchorBlockId, anchorPlacement);
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

		for (const id of removeIds) {
			state.byId.delete(id);
		}
		for (const [id, entry] of newEntries) {
			state.byId.set(id, entry);
		}
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
		scheduleFocus();
		return true;
	}, [editor, editorApi, ensureLiveUndoManager, projectAdhdReadBlocks, scheduleFocus]);

	// Routes an incoming document state: merge when possible, rebuild
	// otherwise. Arrivals during IME composition are parked and replayed on
	// compositionend — mutating the document mid-composition would abort the
	// user's uncommitted input.
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
		if (payload.generation === initGeneration.current) {
			flushPendingEditorCommands();
		}
	}, [applyContent, applyExternalContent, editor, flushPendingEditorCommands, revealSelection]);

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
						...(message.selection ? { selection: message.selection } : {})
					}).catch(reportError);
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
				case 'basehalf.markdownRich.focusAtPoint':
					focusAtPoint(message.point);
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
						pending.resolve(message.url);
					} else {
						pending.reject(new Error(message.error ?? 'The attachment could not be saved.'));
					}
					break;
				}
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
						state.lastDisk = message.content ?? pending?.content ?? state.lastDisk;
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
	}, [applyAdhdState, applyContent, applyExternalContent, asyncMutationBarrier, editor, flushPendingEditorCommands, focusAtPoint, notifyDirty, reportError, revealSelection, runEditorCommand, scheduleSave, serializeAndRequestSave, vscode, waitForCompositionSettled, ydoc]);

	useEffect(() => {
		postFormatState();
	}, [postFormatState, version]);

	useEffect(() => {
		const scroll = scrollRef.current;
		const offChange = editor.onChange(() => {
			// Keep the undo manager live even if a plugin-view teardown killed
			// the one in plugin state after this document loaded.
			ensureLiveUndoManager();
			const state = session.current;
			if (state.loading || !state.ready) {
				return;
			}
			state.editRevision += 1;
			notifyDirty(true);
			scheduleSave();
			scheduleFocus();
			postFormatState();
		});
		const offSelection = editor.onSelectionChange(() => {
			scheduleFocus();
			postFormatState();
		});
		scroll?.addEventListener('scroll', scheduleFocus, { passive: true });
		return () => {
			offChange();
			offSelection();
			scroll?.removeEventListener('scroll', scheduleFocus);
		};
	}, [editor, ensureLiveUndoManager, notifyDirty, postFormatState, scheduleFocus, scheduleSave]);

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
			pending.reject(new Error('The editor was closed before the attachment finished saving.'));
		}
		pendingAttachmentUploads.current.clear();
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
			const clickedFileUrl = clickedBlock
				&& (clickedBlock.type === 'file' || clickedBlock.type === 'image' || clickedBlock.type === 'audio' || clickedBlock.type === 'video')
				&& typeof clickedBlock.props.url === 'string'
				? clickedBlock.props.url
				: undefined;
			// Without a selection the menu still offers Paste at the cursor.
			if (selected.length === 0 && !canPaste && !clickedFileUrl) {
				return;
			}

			const existing = (state.adhd?.highlight_keywords ?? []).find(keyword => keyword.toLowerCase() === selected.toLowerCase());
			const clipboardText = selection && view
				? view.state.doc.textBetween(selection.from, selection.to, '\n', '\n')
				: selected;
			const items: ContextMenuItem[] = [];
			if (clickedFileUrl) {
				items.push({
					id: 'open-file',
					label: baseHalfEditorLabel('Open in Card Detail', '在卡片详情中打开', '在卡片詳情中開啟'),
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
			// Copy/cut/paste must behave exactly like their keyboard
			// counterparts: rich content rides the editor's own clipboard
			// serialization and paste parsing, not a plain-text detour.
			// Never throws: clipboard access can fail on focus/permission, and
			// callers (Cut) must still complete their own action.
			const copySelection = async (): Promise<void> => {
				try {
					if (view && !view.state.selection.empty) {
						const { dom, text } = view.serializeForClipboard(view.state.selection.content());
						await navigator.clipboard.write([new ClipboardItem({
							'text/html': new Blob([dom.innerHTML], { type: 'text/html' }),
							'text/plain': new Blob([text], { type: 'text/plain' }),
						})]);
						return;
					}
				} catch {
					// fall through to the plain-text fallback
				}
				await navigator.clipboard.writeText(clipboardText).catch(() => undefined);
			};

			if (selected.length > 0) {
				items.push({
					id: 'copy',
					label: 'Copy',
					run: () => void copySelection(),
				});
			}

			if (canPaste && view) {
				if (selected.length > 0) {
					items.push({
						id: 'cut',
						label: 'Cut',
						run: () => {
							void asyncMutationBarrier.run(async () => {
								await copySelection();
								if (!canApplyAsyncMutation()) {
									return;
								}
								view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
								view.focus();
							});
						},
					});
				}
				items.push(
					{
						id: 'paste',
						label: 'Paste',
						run: () => {
							void asyncMutationBarrier.run(async () => {
								let html: string | undefined;
								try {
									for (const item of await navigator.clipboard.read()) {
										if (item.types.includes('text/html')) {
											html = await (await item.getType('text/html')).text();
											break;
										}
									}
								} catch {
									// clipboard.read unavailable; fall through to plain text
								}
								const text = html === undefined ? await navigator.clipboard.readText().catch(() => '') : '';
								if (!canApplyAsyncMutation()) {
									return;
								}
								view.focus();
								if (html !== undefined) {
									view.pasteHTML(html);
								} else if (text) {
									view.pasteText(text);
								}
							});
						},
					},
				);
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
	}, [asyncMutationBarrier, editor, postAdhdCommand, vscode]);

	useEffect(() => {
		const dom = editor.prosemirrorView?.dom;
		if (!dom) {
			return;
		}

		const onDoubleClick = (event: MouseEvent): void => {
			const target = event.target as HTMLElement | null;
			const mediaTarget = target?.closest('.bn-file-name-with-icon, .bn-visual-media');
			if (!mediaTarget) {
				return;
			}
			const blockId = mediaTarget.closest('[data-id]')?.getAttribute('data-id');
			const block = blockId ? editor.getBlock(blockId) : undefined;
			if (!block
				|| (block.type !== 'file' && block.type !== 'image' && block.type !== 'audio' && block.type !== 'video')
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
				editor.document as unknown as readonly IBaseHalfMarkdownFocusBlock[],
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

			const span = baseHalfMarkdownBlockReadSpan(
				editor.document as unknown as readonly IBaseHalfMarkdownFocusBlock[],
				blockId,
				state.byId,
				countBaseHalfMarkdownNewlines(state.frontmatter)
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
		const onKeyDown = (event: KeyboardEvent) => {
			const state = session.current;
			if (!state.key || state.surface !== 'canvas' || !state.ready || event.isComposing) {
				return;
			}
			if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey && event.key === 'F10') {
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
			if (contextMenu !== undefined || (portalElement?.childElementCount ?? 0) > 0) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			vscode.postMessage({
				type: 'basehalf.markdownRich.canvasCommand',
				key: state.key,
				command: 'exitEditor',
			});
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [contextMenu, portalElement, vscode]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key.toLowerCase() !== 's' || (!event.metaKey && !event.ctrlKey)) {
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
		if (focusTimer.current !== undefined) {
			window.clearTimeout(focusTimer.current);
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
		>
			{usesEmbeddedControls && (
				<div
					ref={setPortalElement}
					className="basehalf-markdown-rich-portal bn-root bn-mantine"
					data-color-scheme={colorScheme}
					data-mantine-color-scheme={colorScheme}
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
						linkToolbar={usesEmbeddedControls}
						slashMenu={usesEmbeddedControls}
						filePanel={usesEmbeddedControls}
						tableHandles={usesEmbeddedControls}
						emojiPicker={usesEmbeddedControls}
						comments={usesEmbeddedControls}
						portalElements={usesEmbeddedControls ? portalElements : undefined}
					>
						{usesEmbeddedControls && (
							<FormattingToolbarController formattingToolbar={BaseHalfFormattingToolbar} portalElement={portalElement} />
						)}
						{usesEmbeddedControls && <BaseHalfSideMenuController portalElement={portalElement} />}
						{usesEmbeddedControls && <BaseHalfFileLinkMenu searchFiles={searchWorkspaceFiles} />}
					</BlockNoteView>
				</div>
			</div>
		</div>
	);
}

function BaseHalfFormattingToolbar(): JSX.Element {
	const items = getFormattingToolbarItems().filter(item => item.key !== 'fileDownloadButton');
	return <FormattingToolbar>{items}</FormattingToolbar>;
}

const root = document.getElementById('root');
if (!root) {
	throw new Error('BaseHalf Markdown rich webview root is missing');
}

createRoot(root).render(<MarkdownRichEditor />);

function decodeHtmlKey(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}
