/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './noteBlockMenu.css';

import type { BlockNoteEditor } from '@blocknote/core';
import { SideMenuExtension, SuggestionMenu, type SuggestionMenuOptions } from '@blocknote/core/extensions';
import { en, zh, zhTW, type Dictionary } from '@blocknote/core/locales';
import {
	GenericPopover,
	getDefaultReactSlashMenuItems,
	GridSuggestionMenuController,
	useBlockNoteContext,
	useBlockNoteEditor,
	useCloseSuggestionMenuNoItems,
	useComponentsContext,
	useDictionary,
	useEditorDOMElement,
	useExtension,
	useExtensionState,
	useLoadSuggestionMenuItems,
	type DefaultReactSuggestionItem,
	type FloatingUIOptions,
	type GenericPopoverReference,
} from '@blocknote/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import { AiOutlinePlus } from 'react-icons/ai';
import {
	RiCodeBlock,
	RiDoubleQuotesL,
	RiEmotionLine,
	RiFileLine,
	RiFilmLine,
	RiH1,
	RiH2,
	RiH3,
	RiH4,
	RiH5,
	RiH6,
	RiImageLine,
	RiLink,
	RiListCheck3,
	RiListOrdered,
	RiListUnordered,
	RiPlayList2Line,
	RiPlayMiniFill,
	RiSeparator,
	RiTable2,
	RiText,
	RiVolumeUpLine,
} from 'react-icons/ri';
import {
	BASEHALF_NOTE_MENU_ENTRIES,
	BASEHALF_NOTE_MENU_GAP,
	BASEHALF_NOTE_MENU_LINK_KEY,
	BASEHALF_NOTE_MENU_MARGIN,
	BASEHALF_NOTE_MENU_MAX_HEIGHT,
	baseHalfNoteMenuSide,
	rankBaseHalfNoteMenuRows,
	type BaseHalfNoteMenuGroup,
} from '../../../src/vs/workbench/basehalf/markdown/common/basehalfNoteBlockMenu.js';
import type { IBaseHalfMarkdownRichFileLink } from '../../../src/vs/workbench/basehalf/markdown/common/basehalfMarkdownRichWebviewProtocol.js';
import type { IBaseHalfNoteAddedLine } from './noteAddedLine.js';
import { chooseBaseHalfNoteMedia, type BaseHalfNoteMediaChoice } from './noteMedia.js';
import { baseHalfEditorLabel } from './noteSchema.js';

// The menu of blocks in a note (the menu of blocks in a note): the one list that
// the add button and `/` open, the list of `[[`, and where the list of `:` opens.
// The editor's own menu cannot be kept: it lights a row for the keys and another
// for the pointer, its Enter does nothing with nothing found, and it moves to the
// other side of its line as letters shorten it.

type NoteEditor = BlockNoteEditor<any, any, any>;

/** A middleware of the floating-ui that places BlockNote's popovers. */
type FloatingMiddleware = NonNullable<NonNullable<FloatingUIOptions['useFloatingOptions']>['middleware']>[number];

function toggleHeadingIcon(level: ReactNode): JSX.Element {
	return <span className={'basehalf-note-menu-toggle-icon'}><RiPlayMiniFill size={10} />{level}</span>;
}

/** One drawing style for all rows; a toggle heading is its heading with the triangle of a toggle (rule 6). */
const rowIcons: Readonly<Record<string, JSX.Element>> = {
	paragraph: <RiText size={16} />,
	heading: <RiH1 size={16} />,
	heading_2: <RiH2 size={16} />,
	heading_3: <RiH3 size={16} />,
	bullet_list: <RiListUnordered size={16} />,
	numbered_list: <RiListOrdered size={16} />,
	check_list: <RiListCheck3 size={16} />,
	toggle_list: <RiPlayList2Line size={16} />,
	quote: <RiDoubleQuotesL size={16} />,
	code_block: <RiCodeBlock size={16} />,
	table: <RiTable2 size={16} />,
	divider: <RiSeparator size={16} />,
	image: <RiImageLine size={16} />,
	video: <RiFilmLine size={16} />,
	audio: <RiVolumeUpLine size={16} />,
	file: <RiFileLine size={16} />,
	[BASEHALF_NOTE_MENU_LINK_KEY]: <RiLink size={16} />,
	toggle_heading: toggleHeadingIcon(<RiH1 size={13} />),
	toggle_heading_2: toggleHeadingIcon(<RiH2 size={13} />),
	toggle_heading_3: toggleHeadingIcon(<RiH3 size={13} />),
	heading_4: <RiH4 size={16} />,
	heading_5: <RiH5 size={16} />,
	heading_6: <RiH6 size={16} />,
	emoji: <RiEmotionLine size={16} />,
};

const mediaChoices: ReadonlySet<string> = new Set<BaseHalfNoteMediaChoice>(['image', 'video', 'audio', 'file']);

function groupName(group: BaseHalfNoteMenuGroup): string {
	switch (group) {
		case 'basic': return baseHalfEditorLabel('Basic', '基础', '基礎');
		case 'files': return baseHalfEditorLabel('Media and Files', '媒体和文件', '媒體和檔案');
		case 'more': return baseHalfEditorLabel('More', '更多', '更多');
	}
}

/** The words that find a row in any of the editor's languages: the user's letters need not follow the window's (rule 14). */
function wordsForRow(key: string): string[] {
	const dictionaries: readonly Dictionary[] = [en, zh, zhTW];
	const entries = key === BASEHALF_NOTE_MENU_LINK_KEY
		? [{ title: 'Link to File', aliases: ['link', 'file', 'note', '链接', '文件', '笔记', '連結', '檔案', '筆記'] }]
		: dictionaries.map(dictionary => (dictionary.slash_menu as Readonly<Record<string, { readonly title: string; readonly aliases?: readonly string[] }>>)[key]);
	return [...new Set(entries.flatMap(entry => entry ? [entry.title, ...entry.aliases ?? []] : []))];
}

/**
 * The rows of the menu (rule 1): the editor's own titles, BaseHalf's order,
 * groups, and icons, and what each does. Image, Video, Audio, and File open the
 * system's file chooser at once (note formats, rule 49). Emoji and Link to File
 * open their own lists, which put nothing into the note until they are chosen
 * from (rule 33); the other rows make their block of the caret's line.
 */
export function baseHalfNoteBlockMenuRows(editor: NoteEditor, line: IBaseHalfNoteAddedLine): DefaultReactSuggestionItem[] {
	const own = new Map(getDefaultReactSlashMenuItems(editor).map(item => [(item as { readonly key?: string }).key, item]));
	const open = (trigger: string) => () => editor.getExtension(SuggestionMenu)?.openSuggestionMenu(trigger, { ignoreQueryLength: true });
	return BASEHALF_NOTE_MENU_ENTRIES.flatMap(entry => {
		const shared = { group: groupName(entry.group), badge: entry.form, icon: rowIcons[entry.key], aliases: wordsForRow(entry.key) };
		if (entry.key === BASEHALF_NOTE_MENU_LINK_KEY) {
			return [{ ...shared, title: baseHalfEditorLabel('Link to File', '链接到文件', '連結到檔案'), onItemClick: open('[') }];
		}
		const item = own.get(entry.key);
		if (!item) {
			return [];
		}
		const { title } = item;
		if (mediaChoices.has(entry.key)) {
			return [{ ...shared, title, onItemClick: () => chooseBaseHalfNoteMedia(editor, entry.key as BaseHalfNoteMediaChoice, line.holdForChooser()) }];
		}
		if (entry.key === 'emoji') {
			return [{ ...shared, title, onItemClick: open(':') }];
		}
		return [{ ...shared, title, onItemClick: () => line.choose(() => item.onItemClick()) }];
	});
}

/** How tall a list stays however little room its line leaves: four rows. */
const LEAST_HEIGHT = 132;

/** Stands the menu on the side of its line that its placement names, as tall as the room there allows, inside the view (rules 5, 17, and 18). */
const placeOnItsSide: FloatingMiddleware = {
	name: 'basehalfNoteMenu',
	fn: ({ x, y, rects, placement, elements }) => {
		const below = placement.startsWith('bottom');
		const room = below
			? window.innerHeight - (rects.reference.y + rects.reference.height) - BASEHALF_NOTE_MENU_GAP - BASEHALF_NOTE_MENU_MARGIN
			: rects.reference.y - BASEHALF_NOTE_MENU_GAP - BASEHALF_NOTE_MENU_MARGIN;
		// A line scrolled out of the view leaves a list that can still be read, at the view's edge.
		const maxHeight = `${Math.max(LEAST_HEIGHT, Math.min(BASEHALF_NOTE_MENU_MAX_HEIGHT, room))}px`;
		if (elements.floating.style.maxHeight !== maxHeight) {
			elements.floating.style.maxHeight = maxHeight;
			return { reset: { rects: true } };
		}
		return {
			x: Math.max(BASEHALF_NOTE_MENU_MARGIN, Math.min(x, window.innerWidth - rects.floating.width - BASEHALF_NOTE_MENU_MARGIN)),
			y: Math.max(BASEHALF_NOTE_MENU_MARGIN, Math.min(below ? y + BASEHALF_NOTE_MENU_GAP : y - BASEHALF_NOTE_MENU_GAP, window.innerHeight - rects.floating.height - BASEHALF_NOTE_MENU_MARGIN)),
		};
	},
};

/** What the list of `trigger` is placed by: it opens on a side of its line and stays there until it closes, and it comes and goes at once. */
function useMenuFloating(trigger: string): FloatingUIOptions {
	const state = useExtensionState(SuggestionMenu);
	const open = !!state?.show && state.triggerCharacter === trigger;
	const side = useRef<'bottom' | 'top' | undefined>(undefined);
	if (!open) {
		side.current = undefined;
	} else if (!side.current && state.referencePos) {
		side.current = baseHalfNoteMenuSide(state.referencePos, window.innerHeight);
	}
	const placement = side.current === 'top' ? 'top-start' : 'bottom-start';
	return useMemo<FloatingUIOptions>(() => ({
		useFloatingOptions: { placement, middleware: [placeOnItsSide] },
		useTransitionStylesProps: { duration: 0 },
		elementProps: {
			// A press on the scroll bar leaves the keyboard in the note.
			onMouseDownCapture: event => event.preventDefault(),
			style: { zIndex: 80 },
		},
	}), [placement]);
}

interface INoteMenuListProps<T> {
	readonly query: string;
	readonly getItems: (query: string) => Promise<T[]>;
	readonly close: () => void;
	readonly clearQuery: () => void;
	readonly className: string | undefined;
}

/** The rows of a list, the row the keys and the pointer have made current, and what chooses it (rules 10 to 13, 16, and 31). */
function NoteMenuList<T extends DefaultReactSuggestionItem>({ query, getItems, close, clearQuery, className }: INoteMenuListProps<T>): JSX.Element | null {
	const context = useBlockNoteContext();
	const dictionary = useDictionary();
	const element = useEditorDOMElement();
	const { items, usedQuery, loadingState } = useLoadSuggestionMenuItems(query, getItems);
	useCloseSuggestionMenuNoItems(items, usedQuery, close);
	const [chosenIndex, setCurrent] = useState(0);
	const current = Math.max(0, Math.min(chosenIndex, items.length - 1));
	const list = useRef<HTMLDivElement>(null);
	const movedByKey = useRef(false);

	const choose = useCallback((item: T) => {
		close();
		clearQuery();
		item.onItemClick();
	}, [clearQuery, close]);

	useEffect(() => {
		setCurrent(0);
		list.current?.scrollTo({ top: 0 });
	}, [query]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent): void => {
			// The keys of an input method's composition are the input method's.
			if (event.isComposing || event.keyCode === 229) {
				return;
			}
			const moves: Readonly<Record<string, number>> = {
				ArrowUp: (current - 1 + items.length) % items.length,
				ArrowDown: (current + 1) % items.length,
				PageUp: 0,
				PageDown: items.length - 1,
			};
			if (items.length === 0) {
				// With nothing found the keys are the note's (rule 16).
				if (usedQuery === query && (event.key === 'Enter' || event.key in moves)) {
					close();
				}
				return;
			}
			if (event.key in moves) {
				event.preventDefault();
				movedByKey.current = true;
				setCurrent(moves[event.key]);
			} else if (event.key === 'Enter') {
				event.preventDefault();
				event.stopPropagation();
				choose(items[current]);
			}
		};
		element?.addEventListener('keydown', onKey, true);
		return () => element?.removeEventListener('keydown', onKey, true);
	}, [choose, close, current, element, items, query, usedQuery]);

	// The current row stays in view, with the name of its group when it is the first of its group (rule 11).
	useLayoutEffect(() => {
		if (!movedByKey.current) {
			return;
		}
		movedByKey.current = false;
		const row = list.current?.querySelector('[aria-selected="true"]');
		if (row?.previousElementSibling?.classList.contains('basehalf-note-menu-group')) {
			row.previousElementSibling.scrollIntoView({ block: 'nearest' });
		}
		row?.scrollIntoView({ block: 'nearest' });
	}, [current]);

	const setContentEditableProps = context?.setContentEditableProps;
	useEffect(() => {
		setContentEditableProps?.(props => ({
			...props,
			'aria-expanded': true,
			'aria-controls': 'bn-suggestion-menu',
			'aria-activedescendant': items.length > 0 ? `bn-suggestion-menu-item-${current}` : undefined,
		}));
		return () => setContentEditableProps?.(props => ({ ...props, 'aria-expanded': false, 'aria-controls': undefined, 'aria-activedescendant': undefined }));
	}, [current, items.length, setContentEditableProps]);

	if (loadingState === 'loading-initial') {
		return null;
	}
	const rows: JSX.Element[] = [];
	let group: string | undefined;
	items.forEach((item, index) => {
		// Letters rank the rows across groups, so while they do the list has no group names (rule 15).
		if (!query && item.group && item.group !== group) {
			group = item.group;
			rows.push(<div key={`group ${group}`} className={'bn-suggestion-menu-label basehalf-note-menu-group'}>{group}</div>);
		}
		rows.push(
			<div
				key={`${item.title} ${item.subtext ?? ''}`}
				id={`bn-suggestion-menu-item-${index}`}
				className={'bn-suggestion-menu-item basehalf-note-menu-row'}
				role={'option'}
				aria-selected={index === current || undefined}
				// A move, and not the row's coming under a pointer at rest, makes it current (rule 12).
				onMouseMove={event => {
					if (index !== current && (event.movementX !== 0 || event.movementY !== 0)) {
						setCurrent(index);
					}
				}}
				onMouseDown={event => event.preventDefault()}
				onClick={() => choose(item)}
			>
				{item.icon && <span className={'basehalf-note-menu-icon'}>{item.icon}</span>}
				<span className={'basehalf-note-menu-title'}>{item.title}</span>
				{item.subtext && <span className={'basehalf-note-menu-detail'}>{item.subtext}</span>}
				{item.badge && <span className={'basehalf-note-menu-form'}>{item.badge}</span>}
			</div>
		);
	});
	return (
		<div ref={list} id={'bn-suggestion-menu'} className={`bn-suggestion-menu basehalf-note-menu${className ? ` ${className}` : ''}`} role={'listbox'}>
			{rows}
			{items.length === 0 && <div className={'basehalf-note-menu-none'}>{dictionary.suggestion_menu.no_items_title}</div>}
		</div>
	);
}

/** A list of the editor's suggestions, opened by `trigger`, drawn as the menu of blocks. */
function NoteMenuController<T extends DefaultReactSuggestionItem>({ trigger, shouldOpen, getItems, portalElement, className }: {
	readonly trigger: string;
	readonly shouldOpen?: SuggestionMenuOptions['shouldOpen'];
	readonly getItems: (query: string) => Promise<T[]>;
	readonly portalElement: HTMLElement | null;
	readonly className?: string;
}): JSX.Element | null {
	const suggestionMenu = useExtension(SuggestionMenu);
	const element = useEditorDOMElement();
	useEffect(() => {
		suggestionMenu.addSuggestionMenu({ triggerCharacter: trigger, shouldOpen });
	}, [shouldOpen, suggestionMenu, trigger]);
	const state = useExtensionState(SuggestionMenu);
	const floating = useMenuFloating(trigger);
	const referencePos = state?.referencePos;
	const reference = useMemo<GenericPopoverReference>(() => {
		const getBoundingClientRect = () => referencePos ?? new DOMRect();
		// A child of the editor, as the editor may be what scrolls: the list follows it.
		const child = element?.firstChild;
		return child instanceof Element ? { element: child, getBoundingClientRect } : { element: undefined, getBoundingClientRect };
	}, [element, referencePos]);
	const close = suggestionMenu.closeMenu;
	const open = !!state?.show && state.triggerCharacter === trigger;
	const useFloatingOptions = useMemo(() => ({
		...floating.useFloatingOptions,
		open,
		onOpenChange: (next: boolean) => {
			if (!next) {
				close();
			}
		},
	}), [close, floating.useFloatingOptions, open]);
	if (!state) {
		return null;
	}
	return (
		<GenericPopover {...floating} reference={reference} portalElement={portalElement ?? undefined} useFloatingOptions={useFloatingOptions} focusManagerProps={{ disabled: true }}>
			<NoteMenuList query={state.query} getItems={getItems} close={close} clearQuery={suggestionMenu.clearQuery} className={className} />
		</GenericPopover>
	);
}

/**
 * The menu of blocks, and the list of `:` that its Emoji opens: a new line that
 * the add button made is settled when no list is open on it any more (rule 25).
 */
export function BaseHalfNoteBlockMenu({ line, portalElement }: { readonly line: IBaseHalfNoteAddedLine; readonly portalElement: HTMLElement | null }): JSX.Element {
	const editor = useBlockNoteEditor() as NoteEditor;
	const suggestionMenu = useExtension(SuggestionMenu);
	const element = useEditorDOMElement();
	const shown = useExtensionState(SuggestionMenu, { selector: state => !!state?.show });
	useEffect(() => {
		if (!shown) {
			line.settle();
		}
	}, [line, shown]);
	// Escape closes the open list and does nothing else (rule 25). The list's own listener on the document never hears
	// it: the editor marks every Escape as used, and a key the editor used stops at the page's root (note formats, rule 69).
	useEffect(() => {
		const onKey = (event: KeyboardEvent): void => {
			if (event.key === 'Escape' && !event.isComposing && event.keyCode !== 229 && suggestionMenu.shown()) {
				event.preventDefault();
				event.stopPropagation();
				suggestionMenu.closeMenu();
			}
		};
		// A press anywhere but on the open list closes it. Its own listener leaves a press in the note to the caret's
		// move, and a press on the line it stands on moves no caret (rule 27).
		const onPress = (event: PointerEvent): void => {
			if (suggestionMenu.shown() && !(event.target instanceof Element && event.target.closest('.basehalf-note-menu, .bn-grid-suggestion-menu'))) {
				suggestionMenu.closeMenu();
			}
		};
		element?.addEventListener('keydown', onKey, true);
		document.addEventListener('pointerdown', onPress, true);
		return () => {
			element?.removeEventListener('keydown', onKey, true);
			document.removeEventListener('pointerdown', onPress, true);
		};
	}, [element, suggestionMenu]);
	// The words of an empty line while the menu filters there (rule 23), which the editor's own placeholder gives way to.
	useEffect(() => {
		document.documentElement.style.setProperty('--basehalf-note-menu-filter', JSON.stringify(baseHalfEditorLabel('Type to filter', '输入以筛选', '輸入以篩選')));
	}, []);
	const getItems = useCallback(async (query: string) => rankBaseHalfNoteMenuRows(baseHalfNoteBlockMenuRows(editor, line), query), [editor, line]);
	// A table cell holds text and no blocks; in a table the rows would add a block after it (rule 34).
	const shouldOpen = useCallback<NonNullable<SuggestionMenuOptions['shouldOpen']>>(transaction => !transaction.selection.$from.parent.type.isInGroup('tableContent'), []);
	const emojiFloating = useMenuFloating(':');
	return (
		<>
			<NoteMenuController trigger={'/'} shouldOpen={shouldOpen} getItems={getItems} portalElement={portalElement} />
			<GridSuggestionMenuController triggerCharacter={':'} columns={8} minQueryLength={2} floatingUIOptions={emojiFloating} portalElement={portalElement ?? undefined} />
		</>
	);
}

/**
 * The list of `[[` (rule 36), which searches the workspace's files: choosing one
 * puts a plain Markdown link with a relative address where the caret is. That
 * link is for people and agents; the reference graph is not touched. The list
 * opens on `[` with a `[` before it, as the editor's own matching of more than one
 * letter works only at a block's start, and the first `[` goes when a file is chosen.
 */
export function BaseHalfFileLinkMenu({ searchFiles, portalElement }: {
	readonly searchFiles: (query: string) => Promise<readonly IBaseHalfMarkdownRichFileLink[]>;
	readonly portalElement: HTMLElement | null;
}): JSX.Element {
	const editor = useBlockNoteEditor();
	const shouldOpen = useCallback<NonNullable<SuggestionMenuOptions['shouldOpen']>>(transaction => (transaction.selection.$from.nodeBefore?.text?.endsWith('[') ?? false), []);
	const getItems = useCallback(async (query: string): Promise<DefaultReactSuggestionItem[]> => {
		const files = await searchFiles(query);
		return files.map(file => ({
			title: file.name,
			subtext: file.path.endsWith(`/${file.name}`) ? file.path.slice(0, -file.name.length - 1) : file.path === file.name ? '' : file.path,
			icon: <RiFileLine size={16} />,
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
	}, [editor, searchFiles]);
	return <NoteMenuController trigger={'['} shouldOpen={shouldOpen} getItems={getItems} portalElement={portalElement} className={'wide'} />;
}

/** The add button (rules 20 to 22): the whole of it takes the click, which the editor's own leaves to its icon. */
export function BaseHalfAddBlockButton({ line }: { readonly line: IBaseHalfNoteAddedLine }): JSX.Element | null {
	const Components = useComponentsContext()!;
	const dictionary = useDictionary();
	const blockId = useExtensionState(SideMenuExtension, { selector: state => state?.block.id });
	if (blockId === undefined) {
		return null;
	}
	return (
		<Components.SideMenu.Button
			className={'bn-button'}
			label={dictionary.side_menu.add_block_label}
			icon={<AiOutlinePlus size={24} data-test={'dragHandleAdd'} />}
			onClick={() => line.add(blockId)}
		/>
	);
}
