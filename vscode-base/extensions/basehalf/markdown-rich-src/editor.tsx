/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import './editor.css';

import { BlockNoteSchema, createBlockSpec, defaultBlockSpecs } from '@blocknote/core';
import { SideMenuExtension } from '@blocknote/core/extensions';
import { BlockNoteView } from '@blocknote/mantine';
import {
	GenericPopover,
	SideMenu,
	SuggestionMenuController,
	useBlockNoteEditor,
	useCreateBlockNote,
	useExtensionState,
	type GenericPopoverReference,
} from '@blocknote/react';
import { applyUpdate, Doc as YDoc, UndoManager, type XmlFragment } from 'yjs';
import { defaultDeleteFilter, defaultProtectedNodes, ySyncPluginKey, yUndoPluginKey } from 'y-prosemirror';
import { createRoot } from 'react-dom/client';
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type JSX,
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
	BASEHALF_MARKDOWN_RICH_WARMUP_KEY,
	isBaseHalfMarkdownRichHostMessage,
	type BaseHalfMarkdownRichEditorCommand,
	type BaseHalfMarkdownRichWebviewMessage,
	type IBaseHalfMarkdownRichFileLink,
	type IBaseHalfMarkdownRichTextSelection,
} from '../../../src/vs/workbench/basehalf/common/basehalfMarkdownRichWebviewProtocol.js';
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
			edit.textContent = 'Edit in source';
			edit.title = 'This content can only be edited as raw Markdown';
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
		[BASEHALF_RAW_PASSTHROUGH_BLOCK]: rawPassthroughSpec,
	},
});

interface SessionState {
	key: string;
	resource: string;
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
		resource: '',
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
	const compositionSettledWaiters = useRef(new Set<() => void>());
	const pendingSaveSettledWaiters = useRef(new Set<() => void>());
	const pendingInit = useRef<IIncomingInit | undefined>(undefined);
	const initGeneration = useRef(0);
	const renderedAnnounced = useRef(false);
	const pendingFileSearches = useRef(new Map<string, (files: readonly IBaseHalfMarkdownRichFileLink[]) => void>());
	const focusTimer = useRef<number | undefined>(undefined);
	const revealTimer = useRef<number | undefined>(undefined);
	const adhdExtension = useMemo(() => makeBaseHalfAdhdDecorationExtension(), []);
	const [contextMenu, setContextMenu] = useState<ContextMenuState | undefined>(undefined);
	const [portalElement, setPortalElement] = useState<HTMLDivElement | null>(null);
	const [version, setVersion] = useState(0);

	const editor = useCreateBlockNote({
		schema,
		extensions: [adhdExtension],
		collaboration: {
			fragment: fragment as XmlFragment,
			user: { name: 'BaseHalf', color: 'var(--vscode-textLink-foreground)' },
		},
	});
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

	const applyContent = useCallback(async (content: string, editable: boolean, key: string, resource: string) => {
		const state = session.current;
		const isNewResource = state.key !== key || state.resource !== resource;
		state.loading = true;
		state.key = key;
		state.resource = resource;
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
		editor.replaceBlocks(editor.document, blocks as Parameters<typeof editor.replaceBlocks>[1]);
		// Rebuilding the projection is an ordinary local transaction, which the
		// collaboration undo manager tracks like any edit. Clear the stacks so
		// load, reload, and conflict resolution are never themselves undoable —
		// otherwise undo could walk past the load and blank the document. The
		// fallback covers loads that land while the editor view is unmounted.
		(ensureLiveUndoManager() ?? liveUndoManager.current)?.clear();

		state.frontmatter = frontmatter;
		state.byId = byId;
		state.lastDisk = content;
		state.editRevision = 0;
		state.ready = true;
		state.readBlockIds = projectAdhdReadBlocks(state.adhd);
		state.loading = false;
		notifyDirty(false);
		setVersion(value => value + 1);
	}, [editor, editorApi, ensureLiveUndoManager, notifyDirty, projectAdhdReadBlocks]);

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

	const runEditorCommand = useCallback((command: BaseHalfMarkdownRichEditorCommand) => {
		const state = session.current;
		if (!state.ready || state.loading || !state.editable || state.structuralFrozen || state.conflictDisk !== undefined || state.writeError !== undefined) {
			return;
		}

		ensureLiveUndoManager();
		if (command === 'undo') {
			editor.undo();
		} else {
			editor.redo();
		}
	}, [editor, ensureLiveUndoManager]);

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

	const serializeAndRequestSave = useCallback(async (requestId: string, forceSerialize: boolean, forceWrite: boolean, structural = false) => {
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
					waitForPendingSaveSettled,
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
				return;
			}
			// Full rebuild; only this path re-reveals the host's navigation
			// selection — a merge keeps the user's spot.
			await applyContent(payload.content, payload.editable, payload.key, payload.resource);
			revealSelection(payload.selection);
		}
	}, [applyContent, applyExternalContent, editor, revealSelection]);

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
			if (pending) {
				pendingInit.current = undefined;
				window.setTimeout(() => void handleIncomingInit(pending).catch(reportError), 0);
			}
		};
		window.addEventListener('compositionstart', onCompositionStart, true);
		window.addEventListener('compositionend', onCompositionEnd, true);
		return () => {
			window.removeEventListener('compositionstart', onCompositionStart, true);
			window.removeEventListener('compositionend', onCompositionEnd, true);
		};
	}, [handleIncomingInit, reportError]);

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
				case 'basehalf.markdownRich.adopt':
					// A prewarmed shell receives its document identity here and
					// then runs the ordinary boot handshake.
					if (!state.key) {
						state.key = message.key;
						vscode.postMessage({ type: 'basehalf.markdownRich.ready', key: message.key });
					}
					break;
				case 'basehalf.markdownRich.init':
					void handleIncomingInit({
						content: message.content,
						editable: message.editable,
						key: message.key,
						resource: message.resource,
						generation: ++initGeneration.current,
						...(message.selection ? { selection: message.selection } : {})
					}).catch(reportError);
					break;
				case 'basehalf.markdownRich.applyYjsUpdate':
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
					} else if (state.dirty && state.conflictDisk === undefined && state.writeError === undefined) {
						scheduleSave();
					}
					setVersion(value => value + 1);
					void (async () => {
						if (message.frozen) {
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
				case 'basehalf.markdownRich.command':
					runEditorCommand(message.command);
					break;
				case 'basehalf.markdownRich.fileSearchResult': {
					const pending = pendingFileSearches.current.get(message.requestId);
					pendingFileSearches.current.delete(message.requestId);
					pending?.(message.files);
					break;
				}
				case 'basehalf.markdownRich.save':
					void serializeAndRequestSave(message.requestId, message.forceSerialize, message.forceWrite, message.structural);
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
					if (message.result === 'saved' || message.result === 'noop') {
						state.lastDisk = message.content ?? pending?.content ?? state.lastDisk;
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
		} else {
			// Prewarmed shell: booted without a document. Announce under the
			// warmup sentinel and stay inert until the host adopts us.
			vscode.postMessage({ type: 'basehalf.markdownRich.booted', key: BASEHALF_MARKDOWN_RICH_WARMUP_KEY });
		}
		return () => window.removeEventListener('message', onMessage);
	}, [applyAdhdState, applyContent, applyExternalContent, asyncMutationBarrier, editor, notifyDirty, reportError, revealSelection, runEditorCommand, scheduleSave, serializeAndRequestSave, vscode, ydoc]);

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
		});
		const offSelection = editor.onSelectionChange(() => scheduleFocus());
		scroll?.addEventListener('scroll', scheduleFocus, { passive: true });
		return () => {
			offChange();
			offSelection();
			scroll?.removeEventListener('scroll', scheduleFocus);
		};
	}, [editor, ensureLiveUndoManager, notifyDirty, scheduleFocus, scheduleSave]);

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
			// Without a selection the menu still offers Paste at the cursor.
			if (selected.length === 0 && !canPaste) {
				return;
			}

			const existing = (state.adhd?.highlight_keywords ?? []).find(keyword => keyword.toLowerCase() === selected.toLowerCase());
			const clipboardText = selection && view
				? view.state.doc.textBetween(selection.from, selection.to, '\n', '\n')
				: selected;
			const items: ContextMenuItem[] = [];
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
	}, [asyncMutationBarrier, editor, postAdhdCommand]);

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
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				close();
			}
		};
		window.addEventListener('mousedown', close);
		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('blur', close);
		return () => {
			window.removeEventListener('mousedown', close);
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('blur', close);
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
			if ((!event.metaKey && !event.ctrlKey) || event.altKey || event.isComposing) {
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
		if (revealTimer.current !== undefined) {
			window.clearTimeout(revealTimer.current);
		}
	}, []);

	const state = session.current;
	void version;
	const canEdit = state.ready && state.editable && !state.structuralFrozen && state.conflictDisk === undefined && state.writeError === undefined;
	const notifyEditorActivated = useCallback(() => {
		const state = session.current;
		if (!state.key || !state.ready || state.loading) {
			return;
		}

		vscode.postMessage({ type: 'basehalf.markdownRich.editorActivated', key: state.key });
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
		void applyContent(disk, state.editable, state.key, state.resource).catch(reportError);
	};
	const retryWrite = () => {
		state.writeError = undefined;
		setVersion(value => value + 1);
		void serializeAndRequestSave(nextRequestId(), true, false);
	};
	const discardLocal = () => {
		void applyContent(state.lastDisk, state.editable, state.key, state.resource).catch(reportError);
	};

	return (
		<div
			className={`basehalf-markdown-rich${state.ready ? ' ready' : ''}`}
			aria-busy={state.structuralFrozen}
			onPointerDownCapture={notifyEditorActivated}
			onFocusCapture={notifyEditorActivated}
		>
			<div
				ref={setPortalElement}
				className="basehalf-markdown-rich-portal bn-root bn-mantine dark"
				data-color-scheme="dark"
				data-mantine-color-scheme="dark"
			/>
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
						theme="dark"
						sideMenu={false}
						portalElements={portalElements}
					>
						<BaseHalfSideMenuController portalElement={portalElement} />
						<BaseHalfFileLinkMenu searchFiles={searchWorkspaceFiles} />
					</BlockNoteView>
				</div>
			</div>
		</div>
	);
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
