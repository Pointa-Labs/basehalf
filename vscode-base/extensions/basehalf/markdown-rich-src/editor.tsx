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
	spliceBaseHalfMarkdownSave,
	splitBaseHalfMarkdownFrontmatter,
	type IBaseHalfMarkdownEditorApi,
	type IBaseHalfMarkdownReuseEntry,
} from '../../../src/vs/workbench/basehalf/common/basehalfMarkdownProjection.js';
import {
	makeBaseHalfAdhdDecorationExtension,
	pushBaseHalfAdhdDecorations,
} from './adhdDecorations.js';
import {
	isBaseHalfMarkdownRichHostMessage,
	type BaseHalfMarkdownRichEditorCommand,
	type BaseHalfMarkdownRichWebviewMessage,
	type IBaseHalfMarkdownRichTextSelection,
} from '../../../src/vs/workbench/basehalf/common/basehalfMarkdownRichWebviewProtocol.js';

interface VsCodeApi {
	postMessage(message: BaseHalfMarkdownRichWebviewMessage, transfer?: readonly ArrayBuffer[]): void;
	getState(): unknown;
	setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const BLOCKNOTE_FRAGMENT_NAME = 'bn';
const AUTOSAVE_MS = 1200;
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
	editRevision: number;
	loading: boolean;
	pendingSaveContent: Map<string, { readonly content: string; readonly revision: number }>;
	conflictDisk: string | undefined;
	writeError: string | undefined;
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
	const fragment = useMemo(() => ydoc.getXmlFragment(BLOCKNOTE_FRAGMENT_NAME), [ydoc]);
	const session = useRef(createSessionState(initialKey));
	const scrollRef = useRef<HTMLDivElement>(null);
	const saveTimer = useRef<number | undefined>(undefined);
	const liveUndoManager = useRef<UndoManager | undefined>(undefined);
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

	const runEditorCommand = useCallback((command: BaseHalfMarkdownRichEditorCommand) => {
		const state = session.current;
		if (!state.ready || state.loading || !state.editable || state.conflictDisk !== undefined || state.writeError !== undefined) {
			return;
		}

		ensureLiveUndoManager();
		if (command === 'undo') {
			editor.undo();
		} else {
			editor.redo();
		}
	}, [editor, ensureLiveUndoManager]);

	const serializeAndRequestSave = useCallback(async (requestId: string, forceSerialize: boolean, forceWrite: boolean) => {
		const state = session.current;
		if (!state.key || !state.ready) {
			return;
		}
		if (!state.dirty && !forceSerialize && !forceWrite) {
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
			const content = await spliceBaseHalfMarkdownSave(editorApi, editor.document, state.frontmatter, state.byId);
			state.pendingSaveContent.set(requestId, { content, revision: state.editRevision });
			vscode.postMessage({
				type: 'basehalf.markdownRich.saveRequested',
				key: state.key,
				requestId,
				content,
				previousContent: state.lastDisk,
				forceWrite,
			});
		} catch (error) {
			reportError(error);
		}
	}, [editor, editorApi, reportError, vscode]);

	const scheduleSave = useCallback(() => {
		if (saveTimer.current !== undefined) {
			window.clearTimeout(saveTimer.current);
		}
		saveTimer.current = window.setTimeout(() => {
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
					void applyContent(message.content, message.editable, message.key, message.resource)
						.then(() => revealSelection(message.selection))
						.catch(reportError);
					break;
				case 'basehalf.markdownRich.applyYjsUpdate':
					applyUpdate(ydoc, new Uint8Array(message.update), 'basehalf.host');
					break;
				case 'basehalf.markdownRich.setEditable':
					state.editable = message.editable;
					setVersion(value => value + 1);
					break;
				case 'basehalf.markdownRich.revealSelection':
					revealSelection(message.selection);
					break;
				case 'basehalf.markdownRich.command':
					runEditorCommand(message.command);
					break;
				case 'basehalf.markdownRich.save':
					void serializeAndRequestSave(message.requestId, message.forceSerialize, message.forceWrite);
					break;
				case 'basehalf.markdownRich.saveResult': {
					const pending = state.pendingSaveContent.get(message.requestId);
					state.pendingSaveContent.delete(message.requestId);
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
		}
		return () => window.removeEventListener('message', onMessage);
	}, [applyAdhdState, applyContent, notifyDirty, reportError, revealSelection, runEditorCommand, serializeAndRequestSave, vscode, ydoc]);

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
			if (selected.length === 0) {
				return;
			}

			const existing = (state.adhd?.highlight_keywords ?? []).find(keyword => keyword.toLowerCase() === selected.toLowerCase());
			const clipboardText = selection && view
				? view.state.doc.textBetween(selection.from, selection.to, '\n', '\n')
				: selected;
			const items: ContextMenuItem[] = [];
			if (state.readingModeEnabled && state.adhdError === undefined) {
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
			items.push({
				id: 'copy',
				label: 'Copy',
				run: () => void navigator.clipboard.writeText(clipboardText),
			});

			if (view && state.editable && state.conflictDisk === undefined && state.writeError === undefined) {
				items.push(
					{
						id: 'cut',
						label: 'Cut',
						run: () => {
							void navigator.clipboard.writeText(clipboardText);
							view.dispatch(view.state.tr.deleteSelection());
							view.focus();
						},
					},
					{
						id: 'paste',
						label: 'Paste',
						run: () => {
							void navigator.clipboard.readText().then(text => {
								if (text) {
									view.dispatch(view.state.tr.insertText(text));
								}
								view.focus();
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
	}, [editor, postAdhdCommand]);

	useEffect(() => {
		const dom = editor.prosemirrorView?.dom;
		if (!dom) {
			return;
		}

		const onMouseDown = (event: MouseEvent): void => {
			const checkbox = (event.target as HTMLElement | null)?.closest?.('.basehalf-adhd-check') as HTMLElement | null;
			const blockId = checkbox?.getAttribute('data-basehalf-adhd-block-id');
			if (!blockId) {
				return;
			}

			const state = session.current;
			if (!state.ready || !state.readingModeEnabled || state.adhdError !== undefined) {
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
			postAdhdCommand({
				command: state.readBlockIds.has(blockId) ? 'markUnread' : 'markRead',
				start: span.start,
				end: span.end,
			});
		};

		dom.addEventListener('mousedown', onMouseDown, true);
		return () => dom.removeEventListener('mousedown', onMouseDown, true);
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
	const canEdit = state.ready && state.editable && state.conflictDisk === undefined && state.writeError === undefined;
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
