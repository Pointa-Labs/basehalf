/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfCanvasAdjacentChrome.css';
import './media/basehalfCanvasNoteToolbar.css';
import './media/basehalfCanvasNoteSelectionControls.css';
import { localize } from '../../../../../nls.js';
import { BASEHALF_CANVAS_MIN_ZOOM } from '../../../shell/common/basehalfConfiguration.js';
import {
	BaseHalfCanvasNoteBackground,
	BASEHALF_CANVAS_NOTE_DEFAULT_FORMAT_STATE,
	BASEHALF_CANVAS_NOTE_FORMAT_STATE_EVENT,
	BASEHALF_CANVAS_NOTE_TOOLBAR_FOCUS_EVENT,
	IBaseHalfCanvasNoteFormatState
} from '../../common/basehalfCanvasScene.js';
import type { BaseHalfMarkdownFormatCommand, BaseHalfMarkdownFormatToggleState } from '../../../markdown/common/basehalfMarkdownFormatting.js';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react';
import { BaseHalfCanvasFlowNode, IBaseHalfCanvasSceneEnvironment, IBaseHalfCanvasToolbarIcons, numericStyle, screenSpaceCanvasStyle } from './basehalfCanvasSceneShared.js';
import { NOTE_TOOLBAR_SCREEN_HEIGHT, resolveBaseHalfCanvasNoteSelectionPlacement } from './basehalfCanvasSelectionControlsPlacement.js';

const NOTE_BACKGROUND_PALETTE_SCREEN_HEIGHT = 72;

/**
 * Makes the controls of a selected Note: its format toolbar and its background
 * colors.
 */
export function createBaseHalfCanvasNoteSelectionControls(environment: IBaseHalfCanvasSceneEnvironment) {
	const { vendor, h, host, delegate } = environment;

	function NoteSelectionControls({ node, suppressed }: {
		readonly node: BaseHalfCanvasFlowNode;
		readonly suppressed: boolean;
	}): ReactElement {
		const viewport = vendor.useViewport();
		const [viewportSize, setViewportSize] = vendor.useState(() => ({ width: host.clientWidth, height: host.clientHeight }));
		const initialControls = node.data.card.controls?.kind === 'note' ? node.data.card.controls : undefined;
		const [formatState, setFormatState] = vendor.useState<IBaseHalfCanvasNoteFormatState>(() => initialControls?.formatState ?? BASEHALF_CANVAS_NOTE_DEFAULT_FORMAT_STATE);
		const [background, setBackground] = vendor.useState<BaseHalfCanvasNoteBackground>(() => initialControls?.background ?? 'default');
		const [backgroundOpen, setBackgroundOpen] = vendor.useState(false);
		const [copied, setCopied] = vendor.useState(false);
		const [focusIndex, setFocusIndex] = vendor.useState(0);
		const buttonRef = vendor.useRef<HTMLButtonElement | null>(null);
		const copiedTimer = vendor.useRef<number | undefined>(undefined);
		vendor.useEffect(() => {
			const controls = node.data.card.controls?.kind === 'note' ? node.data.card.controls : undefined;
			setFormatState(controls?.formatState ?? BASEHALF_CANVAS_NOTE_DEFAULT_FORMAT_STATE);
			setBackground(controls?.background ?? 'default');
		}, [node.data.card.controls]);
		vendor.useEffect(() => {
			const updateSize = (width = host.clientWidth, height = host.clientHeight): void => {
				setViewportSize(current => current.width === width && current.height === height ? current : { width, height });
			};
			updateSize();
			const ResizeObserverConstructor = host.ownerDocument.defaultView?.ResizeObserver;
			if (!ResizeObserverConstructor) {
				return;
			}
			const observer = new ResizeObserverConstructor(entries => {
				const size = entries[0]?.contentRect;
				updateSize(size?.width, size?.height);
			});
			observer.observe(host);
			return () => observer.disconnect();
		}, []);
		vendor.useEffect(() => {
			const element = node.data.card.element;
			const focusToolbar = (): void => {
				element.ownerDocument.defaultView?.setTimeout(() => buttonRef.current?.focus(), 0);
			};
			element.addEventListener(BASEHALF_CANVAS_NOTE_TOOLBAR_FOCUS_EVENT, focusToolbar);
			const updateFormatState = (event: Event): void => {
				const detail = (event as CustomEvent<IBaseHalfCanvasNoteFormatState>).detail;
				if (detail) {
					setFormatState(detail);
				}
			};
			element.addEventListener(BASEHALF_CANVAS_NOTE_FORMAT_STATE_EVENT, updateFormatState);
			return () => {
				element.removeEventListener(BASEHALF_CANVAS_NOTE_TOOLBAR_FOCUS_EVENT, focusToolbar);
				element.removeEventListener(BASEHALF_CANVAS_NOTE_FORMAT_STATE_EVENT, updateFormatState);
			};
		}, [node.data.card.element]);
		vendor.useEffect(() => () => {
			if (copiedTimer.current !== undefined) {
				host.ownerDocument.defaultView?.clearTimeout(copiedTimer.current);
			}
		}, []);
		const nodeWidth = node.width ?? node.measured?.width ?? numericStyle(node.style?.width) ?? node.data.card.width;
		const nodeHeight = node.height ?? node.measured?.height ?? numericStyle(node.style?.height) ?? node.data.card.height;
		const placement = resolveBaseHalfCanvasNoteSelectionPlacement({
			left: node.position.x,
			top: node.position.y,
			right: node.position.x + nodeWidth,
			bottom: node.position.y + nodeHeight,
			viewport,
			viewportWidth: viewportSize.width,
			viewportHeight: viewportSize.height
		});
		const stopEvent = (event: ReactMouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>): void => {
			event.stopPropagation();
		};
		const actionCount = 12;
		const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>, index: number): void => {
			if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				setBackgroundOpen(false);
				delegate.focusNoteEditor(node.data.sceneKey, node.data.structuralEpoch, node.id);
				return;
			}
			let next: number | undefined;
			if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
				next = (index + 1) % actionCount;
			} else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
				next = (index - 1 + actionCount) % actionCount;
			} else if (event.key === 'Home') {
				next = 0;
			} else if (event.key === 'End') {
				next = actionCount - 1;
			}
			if (next !== undefined) {
				event.preventDefault();
				event.stopPropagation();
				setFocusIndex(next);
				event.currentTarget.closest<HTMLElement>('.basehalf-canvas-note-toolbar')
					?.querySelectorAll<HTMLButtonElement>(':scope > button')[next]?.focus();
			}
		};
		if (!placement.visible) {
			return h(vendor.Fragment);
		}
		const invokeFormat = (command: BaseHalfMarkdownFormatCommand): void => {
			setBackgroundOpen(false);
			void delegate.formatNote(node.data.sceneKey, node.data.structuralEpoch, node.id, command).catch(error => delegate.reportError(error));
		};
		const button = (
			index: number,
			key: string,
			label: string,
			className: string,
			content: ReactNode,
			onClick: () => void,
			active?: BaseHalfMarkdownFormatToggleState
		): ReactElement => h('button', {
			...(index === 0 ? { ref: buttonRef } : {}),
			key,
			type: 'button',
			className: `basehalf-canvas-note-toolbar-action ${className}${active === true ? ' active' : active === 'mixed' ? ' mixed' : ''}`,
			title: label,
			'aria-label': label,
			...(active !== undefined ? { 'aria-pressed': active } : {}),
			tabIndex: !suppressed && index === focusIndex ? 0 : -1,
			onFocus: () => setFocusIndex(index),
			onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => onKeyDown(event, index),
			onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
				event.preventDefault();
				event.stopPropagation();
			},
			onClick: (event: ReactMouseEvent<HTMLElement>) => {
				event.preventDefault();
				event.stopPropagation();
				onClick();
			}
		}, content);
		const divider = (key: string): ReactElement => h('span', { key, className: 'basehalf-canvas-note-toolbar-divider', 'aria-hidden': 'true' });
		const icon = (name: keyof IBaseHalfCanvasToolbarIcons): ReactElement => {
			const Icon = vendor.BaseHalfCanvasToolbarIcons[name];
			return h(Icon, {
				size: 18,
				className: 'basehalf-canvas-note-toolbar-icon',
				'data-basehalf-icon': name,
				'aria-hidden': true,
				focusable: false
			});
		};
		const formatActive = (type: IBaseHalfCanvasNoteFormatState['blockType']): boolean => formatState.ready && formatState.blockType === type;
		const backgroundLabels: Readonly<Record<BaseHalfCanvasNoteBackground, string>> = {
			default: localize('basehalf.canvas.note.background.default', "Default background"),
			red: localize('basehalf.canvas.note.background.red', "Red background"),
			orange: localize('basehalf.canvas.note.background.orange', "Orange background"),
			yellow: localize('basehalf.canvas.note.background.yellow', "Yellow background"),
			green: localize('basehalf.canvas.note.background.green', "Green background"),
			cyan: localize('basehalf.canvas.note.background.cyan', "Cyan background"),
			blue: localize('basehalf.canvas.note.background.blue', "Blue background"),
			purple: localize('basehalf.canvas.note.background.purple', "Purple background")
		};
		const paletteTop = placement.side === 'above'
			? placement.top + (NOTE_TOOLBAR_SCREEN_HEIGHT + 6) / Math.max(BASEHALF_CANVAS_MIN_ZOOM, viewport.zoom)
			: placement.top - (NOTE_BACKGROUND_PALETTE_SCREEN_HEIGHT + 6) / Math.max(BASEHALF_CANVAS_MIN_ZOOM, viewport.zoom);
		const actions: ReactElement[] = [
			button(0, 'background', localize('basehalf.canvas.note.background', "Background color"), 'background', h('span', { className: `basehalf-canvas-note-background-swatch ${background}` }), () => setBackgroundOpen(open => !open), backgroundOpen),
			divider('block-divider'),
			button(1, 'h1', localize('basehalf.canvas.note.heading1', "Heading 1"), 'icon', icon('heading1'), () => invokeFormat('setHeading1'), formatActive('heading1')),
			button(2, 'h2', localize('basehalf.canvas.note.heading2', "Heading 2"), 'icon', icon('heading2'), () => invokeFormat('setHeading2'), formatActive('heading2')),
			button(3, 'h3', localize('basehalf.canvas.note.heading3', "Heading 3"), 'icon', icon('heading3'), () => invokeFormat('setHeading3'), formatActive('heading3')),
			button(4, 'paragraph', localize('basehalf.canvas.note.paragraph', "Paragraph"), 'icon', icon('paragraph'), () => invokeFormat('setParagraph'), formatActive('paragraph')),
			divider('format-divider'),
			button(5, 'bold', localize('basehalf.canvas.note.bold', "Bold"), 'icon', icon('bold'), () => invokeFormat('toggleBold'), formatState.bold),
			button(6, 'italic', localize('basehalf.canvas.note.italic', "Italic"), 'icon', icon('italic'), () => invokeFormat('toggleItalic'), formatState.italic),
			button(7, 'bullet', localize('basehalf.canvas.note.bulletList', "Bulleted list"), 'icon', icon('bulletList'), () => invokeFormat('toggleBulletList'), formatActive('bulletList')),
			button(8, 'ordered', localize('basehalf.canvas.note.orderedList', "Numbered list"), 'icon', icon('orderedList'), () => invokeFormat('toggleOrderedList'), formatActive('orderedList')),
			button(9, 'divider', localize('basehalf.canvas.note.divider', "Divider"), 'icon', icon('divider'), () => invokeFormat('insertDivider')),
			divider('content-divider'),
			button(10, 'copy', copied ? localize('basehalf.canvas.note.copied', "Copied") : localize('basehalf.canvas.note.copy', "Copy all"), 'icon', icon(copied ? 'copied' : 'copy'), () => {
				setBackgroundOpen(false);
				void delegate.copyNote(node.data.sceneKey, node.data.structuralEpoch, node.id).then(() => {
					setCopied(true);
					if (copiedTimer.current !== undefined) {
						host.ownerDocument.defaultView?.clearTimeout(copiedTimer.current);
					}
					copiedTimer.current = host.ownerDocument.defaultView?.setTimeout(() => setCopied(false), 1400);
				}, error => delegate.reportError(error));
			}),
			button(11, 'open', localize('basehalf.canvas.note.expand', "Expand {0}", node.id), 'open icon', icon('expand'), () => {
				void delegate.openCard(node.data.sceneKey, node.data.structuralEpoch, node.id).catch(error => delegate.reportError(error));
			})
		];

		return h(vendor.ViewportPortal, null,
			h('div', {
				className: 'basehalf-canvas-note-toolbar basehalf-canvas-note-surface basehalf-canvas-adjacent-chrome nodrag nopan nowheel',
				role: 'toolbar',
				'aria-label': localize('basehalf.canvas.note.actions', "Actions for {0}", node.id),
				'data-placement': placement.side,
				'data-chrome-state': suppressed ? 'suppressed' : 'present',
				'aria-hidden': suppressed,
				inert: suppressed,
				style: screenSpaceCanvasStyle(viewport.zoom, {
					left: placement.left,
					top: placement.top,
					width: placement.width,
					height: placement.height
				}),
				onPointerDown: stopEvent,
				onClick: stopEvent,
				onDoubleClick: stopEvent
			}, ...actions),
			backgroundOpen ? h('div', {
				className: 'basehalf-canvas-note-background-palette basehalf-canvas-note-surface basehalf-canvas-adjacent-chrome nodrag nopan nowheel',
				role: 'menu',
				'aria-label': localize('basehalf.canvas.note.backgroundOptions', "Card background colors"),
				'data-placement': placement.side,
				'data-chrome-state': suppressed ? 'suppressed' : 'present',
				'aria-hidden': suppressed,
				inert: suppressed,
				style: screenSpaceCanvasStyle(viewport.zoom, { left: placement.left, top: paletteTop }),
				onPointerDown: stopEvent,
				onClick: stopEvent
			}, ...(['default', 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple'] as const).map(value => h('button', {
				key: value,
				type: 'button',
				className: `basehalf-canvas-note-background-option ${value}${value === background ? ' active' : ''}`,
				title: backgroundLabels[value],
				'aria-label': backgroundLabels[value],
				'aria-checked': value === background,
				role: 'menuitemradio',
				onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
					event.preventDefault();
					event.stopPropagation();
				},
				onClick: (event: ReactMouseEvent<HTMLElement>) => {
					event.preventDefault();
					event.stopPropagation();
					void delegate.setNoteBackground(node.data.sceneKey, node.data.structuralEpoch, node.id, value).then(() => {
						setBackground(value);
						setBackgroundOpen(false);
					}, error => delegate.reportError(error));
				}
				}))) : null
		);
	}

	return NoteSelectionControls;
}
