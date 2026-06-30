/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import './editor.css';

import { BlockNoteSchema, createBlockSpec, defaultBlockSpecs } from '@blocknote/core';
import { BlockNoteView } from '@blocknote/mantine';
import { useCreateBlockNote } from '@blocknote/react';
import { applyUpdate, Doc as YDoc, type XmlFragment } from 'yjs';
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

interface VsCodeApi {
	postMessage(message: BaseHalfMarkdownRichWebviewMessage, transfer?: readonly ArrayBuffer[]): void;
	getState(): unknown;
	setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

type BaseHalfMarkdownRichHostMessage =
	| {
		readonly type: 'basehalf.markdownRich.init';
		readonly key: string;
		readonly resource: string;
		readonly content: string;
		readonly editable: boolean;
		readonly selection?: IBaseHalfMarkdownRichTextSelection;
	}
	| {
		readonly type: 'basehalf.markdownRich.applyYjsUpdate';
		readonly key: string;
		readonly update: ArrayBuffer;
	}
	| {
		readonly type: 'basehalf.markdownRich.setEditable';
		readonly key: string;
		readonly editable: boolean;
	}
	| {
		readonly type: 'basehalf.markdownRich.revealSelection';
		readonly key: string;
		readonly selection: IBaseHalfMarkdownRichTextSelection;
	}
	| {
		readonly type: 'basehalf.markdownRich.save';
		readonly key: string;
		readonly requestId: string;
		readonly forceSerialize: boolean;
		readonly forceWrite: boolean;
	}
	| {
		readonly type: 'basehalf.markdownRich.saveResult';
		readonly key: string;
		readonly requestId: string;
		readonly result: 'saved' | 'noop' | 'blockedByConflict' | 'writeFailed';
		readonly content?: string;
		readonly disk?: string;
		readonly message?: string;
	}
	| {
		readonly type: 'basehalf.markdownRich.adhdState';
		readonly key: string;
		readonly adhd?: IBaseHalfAdhdFile | null;
		readonly error?: string;
	};

type BaseHalfMarkdownRichWebviewMessage =
	| {
		readonly type: 'basehalf.markdownRich.ready';
		readonly key: string;
	}
	| {
		readonly type: 'basehalf.markdownRich.yjsUpdate';
		readonly key: string;
		readonly update: ArrayBuffer;
	}
	| {
		readonly type: 'basehalf.markdownRich.saveRequested';
		readonly key: string;
		readonly requestId: string;
		readonly content: string;
		readonly previousContent: string;
		readonly forceWrite: boolean;
	}
	| {
		readonly type: 'basehalf.markdownRich.dirtyChanged';
		readonly key: string;
		readonly dirty: boolean;
	}
	| {
		readonly type: 'basehalf.markdownRich.focusChanged';
		readonly key: string;
		readonly fields: ReturnType<typeof buildBaseHalfMarkdownFocusFields>;
	}
	| {
		readonly type: 'basehalf.markdownRich.adhdCommand';
		readonly key: string;
		readonly command: IBaseHalfAdhdCommand;
	}
	| {
		readonly type: 'basehalf.markdownRich.error';
		readonly key: string;
		readonly message: string;
		readonly stack?: string;
	};

interface IBaseHalfMarkdownRichTextSelection {
	readonly startLineNumber: number;
	readonly startColumn: number;
	readonly endLineNumber?: number;
	readonly endColumn?: number;
}

const BLOCKNOTE_FRAGMENT_NAME = 'bn';
const AUTOSAVE_MS = 400;
const FOCUS_DEBOUNCE_MS = 180;

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
	readBlockIds: Set<string>;
	lastDisk: string;
	editable: boolean;
	ready: boolean;
	dirty: boolean;
	loading: boolean;
	pendingSaveContent: Map<string, string>;
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
		readBlockIds: new Set(),
		lastDisk: '',
		editable: false,
		ready: false,
		dirty: false,
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

function isHostMessage(message: unknown): message is BaseHalfMarkdownRichHostMessage {
	return typeof message === 'object'
		&& message !== null
		&& typeof (message as { type?: unknown }).type === 'string'
		&& (message as { type: string }).type.startsWith('basehalf.markdownRich.')
		&& typeof (message as { key?: unknown }).key === 'string';
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

function MarkdownRichEditor(): JSX.Element {
	const vscode = useMemo(() => acquireVsCodeApi(), []);
	const initialKey = useMemo(() => decodeHtmlKey(document.getElementById('root')?.dataset.basehalfKey ?? ''), []);
	const ydoc = useMemo(() => new YDoc(), []);
	const fragment = useMemo(() => ydoc.getXmlFragment(BLOCKNOTE_FRAGMENT_NAME), [ydoc]);
	const session = useRef(createSessionState(initialKey));
	const scrollRef = useRef<HTMLDivElement>(null);
	const saveTimer = useRef<number | undefined>(undefined);
	const focusTimer = useRef<number | undefined>(undefined);
	const revealTimer = useRef<number | undefined>(undefined);
	const adhdExtension = useMemo(() => makeBaseHalfAdhdDecorationExtension(), []);
	const [contextMenu, setContextMenu] = useState<ContextMenuState | undefined>(undefined);
	const [version, setVersion] = useState(0);

	const editor = useCreateBlockNote({
		schema,
		extensions: [adhdExtension],
		collaboration: {
			fragment: fragment as XmlFragment,
			user: { name: 'BaseHalf', color: 'var(--vscode-textLink-foreground)' },
		},
	});

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
		state.loading = true;
		state.key = key;
		state.resource = resource;
		state.editable = editable;
		state.conflictDisk = undefined;
		state.writeError = undefined;
		setVersion(value => value + 1);

		const { frontmatter, body } = splitBaseHalfMarkdownFrontmatter(content);
		const { blocks, byId } = await buildBaseHalfMarkdownLoadProjection(editorApi, body);
		editor.replaceBlocks(editor.document, blocks as Parameters<typeof editor.replaceBlocks>[1]);

		state.frontmatter = frontmatter;
		state.byId = byId;
		state.lastDisk = content;
		state.ready = true;
		state.readBlockIds = projectAdhdReadBlocks(state.adhd);
		state.loading = false;
		notifyDirty(false);
		setVersion(value => value + 1);
	}, [editor, editorApi, notifyDirty, projectAdhdReadBlocks]);

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

	const applyAdhdState = useCallback((adhd: IBaseHalfAdhdFile | null | undefined, error: string | undefined) => {
		const state = session.current;
		if (adhd !== undefined) {
			state.adhd = adhd;
			state.readBlockIds = projectAdhdReadBlocks(adhd);
		}
		state.adhdError = error;
		setVersion(value => value + 1);
	}, [projectAdhdReadBlocks]);

	const postAdhdCommand = useCallback((command: IBaseHalfAdhdCommand) => {
		const state = session.current;
		if (!state.key || !state.ready) {
			return;
		}
		vscode.postMessage({
			type: 'basehalf.markdownRich.adhdCommand',
			key: state.key,
			command,
		});
	}, [vscode]);

	const serializeAndRequestSave = useCallback(async (requestId: string, forceSerialize: boolean, forceWrite: boolean) => {
		const state = session.current;
		if (!state.key || !state.ready) {
			return;
		}
		if (state.conflictDisk !== undefined && !forceWrite) {
			return;
		}
		if (!state.dirty && !forceSerialize && !forceWrite) {
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
			state.pendingSaveContent.set(requestId, content);
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
			if (!isHostMessage(message)) {
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
				case 'basehalf.markdownRich.save':
					void serializeAndRequestSave(message.requestId, message.forceSerialize, message.forceWrite);
					break;
				case 'basehalf.markdownRich.saveResult': {
					const savedContent = state.pendingSaveContent.get(message.requestId);
					state.pendingSaveContent.delete(message.requestId);
					if (message.result === 'saved' || message.result === 'noop') {
						state.lastDisk = message.content ?? savedContent ?? state.lastDisk;
						state.conflictDisk = undefined;
						state.writeError = undefined;
						notifyDirty(false);
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
					applyAdhdState(message.adhd, message.error);
					break;
			}
		};
		window.addEventListener('message', onMessage);
		if (session.current.key) {
			vscode.postMessage({ type: 'basehalf.markdownRich.ready', key: session.current.key });
		}
		return () => window.removeEventListener('message', onMessage);
	}, [applyAdhdState, applyContent, notifyDirty, reportError, revealSelection, serializeAndRequestSave, vscode, ydoc]);

	useEffect(() => {
		const scroll = scrollRef.current;
		const offChange = editor.onChange(() => {
			const state = session.current;
			if (state.loading || !state.ready) {
				return;
			}
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
	}, [editor, notifyDirty, scheduleFocus, scheduleSave]);

	useEffect(() => {
		const state = session.current;
		pushBaseHalfAdhdDecorations(editor, {
			enabled: state.ready && state.adhdError === undefined,
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
			if (!state.ready || state.adhdError !== undefined) {
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
			const items: ContextMenuItem[] = [
				existing
					? {
						id: 'remove-highlight',
						label: `Remove "${existing}" from highlights`,
						run: () => postAdhdCommand({ command: 'removeKeyword', keyword: existing }),
					}
					: {
						id: 'add-highlight',
						label: `Highlight "${selected}"`,
						run: () => postAdhdCommand({ command: 'addKeyword', keyword: selected }),
					},
				{
					id: 'copy',
					label: 'Copy',
					run: () => void navigator.clipboard.writeText(clipboardText),
				},
			];

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
			if (!state.ready || state.adhdError !== undefined) {
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
		<div className={`basehalf-markdown-rich${state.ready ? ' ready' : ''}`}>
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
					/>
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
