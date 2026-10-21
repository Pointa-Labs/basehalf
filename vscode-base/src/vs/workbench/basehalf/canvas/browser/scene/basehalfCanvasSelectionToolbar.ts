/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { BaseHalfCanvasArrangement, IBaseHalfCanvasArrangeCard, baseHalfCanvasBoundingRect } from '../../common/basehalfCanvasArrangement.js';
import { BaseHalfCanvasSceneSelectionAction, baseHalfCanvasSceneSelectionActions, BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP, BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT } from '../../common/basehalfCanvasScene.js';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react';
import { BaseHalfCanvasFlowNode, flowNodeRect, IBaseHalfCanvasSceneEnvironment, isCanvasElement, screenSpaceCanvasStyle } from './basehalfCanvasSceneShared.js';
import { resolveBaseHalfCanvasSelectionToolbarPlacement } from './basehalfCanvasSelectionControlsPlacement.js';

export function baseHalfCanvasSceneSelectionRenameLabel(renameChangesPathOnly: boolean): string {
	return renameChangesPathOnly
		? localize('basehalf.canvas.selection.renameFile', "Rename file")
		: localize('basehalf.canvas.selection.rename', "Rename");
}

/**
 * The rectangle of a card with the caption above it. The caption takes the
 * pointer, so the box of a set holds it: a press on the name of a card of a
 * set is a press on the box.
 */
function flowNodeRectWithCaption(node: BaseHalfCanvasFlowNode): IBaseHalfCanvasArrangeCard {
	const rect = flowNodeRect(node);
	const caption = BASEHALF_CANVAS_CARD_CAPTION_FLOW_GAP + BASEHALF_CANVAS_CARD_CAPTION_FLOW_HEIGHT;
	return { ...rect, y: rect.y - caption, height: rect.height + caption };
}

/** Makes the toolbar over a selection of cards and the box around a set. */
export function createBaseHalfCanvasSelectionToolbar(environment: IBaseHalfCanvasSceneEnvironment) {
	const { vendor, h, host } = environment;

	function SelectionToolbar({ nodes, invoke, arrange, suppressed }: {
		readonly nodes: readonly BaseHalfCanvasFlowNode[];
		readonly invoke: (action: BaseHalfCanvasSceneSelectionAction, paths: readonly string[]) => void;
		readonly arrange: (arrangement: BaseHalfCanvasArrangement) => void;
		readonly suppressed: boolean;
	}): ReactElement {
		const actions = baseHalfCanvasSceneSelectionActions(nodes.length);
		// A set can be arranged. One card has nothing to arrange.
		const arranges = nodes.length >= 2;
		const firstAction = arranges ? 1 : 0;
		const itemCount = actions.length + firstAction;
		const viewport = vendor.useViewport();
		const [focusIndex, setFocusIndex] = vendor.useState(0);
		const [arrangeOpen, setArrangeOpen] = vendor.useState(false);
		const arrangeRef = vendor.useRef<HTMLSpanElement>(null);
		const toolbarRef = vendor.useRef<HTMLDivElement>(null);
		// The buttons of a set carry their names, so the width depends on the
		// language. It is measured, and it keeps the toolbar inside the view.
		const [measuredWidth, setMeasuredWidth] = vendor.useState<number | undefined>(undefined);
		vendor.useLayoutEffect(() => {
			const width = toolbarRef.current?.offsetWidth;
			if (width && width !== measuredWidth) {
				setMeasuredWidth(width);
			}
		});
		const paths = nodes.map(node => node.id);
		const key = paths.join('\0');
		vendor.useEffect(() => {
			setFocusIndex(0);
			setArrangeOpen(false);
		}, [key, itemCount]);
		vendor.useEffect(() => {
			if (suppressed) {
				setArrangeOpen(false);
			}
		}, [suppressed]);
		vendor.useEffect(() => {
			if (!arrangeOpen) {
				return;
			}
			arrangeRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
			const closeOutside = (event: PointerEvent): void => {
				if (!isCanvasElement(event.target) || !arrangeRef.current?.contains(event.target)) {
					setArrangeOpen(false);
				}
			};
			host.ownerDocument.addEventListener('pointerdown', closeOutside, true);
			return () => host.ownerDocument.removeEventListener('pointerdown', closeOutside, true);
		}, [arrangeOpen]);
		const box = baseHalfCanvasBoundingRect(nodes.map(flowNodeRect));
		if (!box || actions.length === 0) {
			return h(vendor.Fragment);
		}
		const placement = resolveBaseHalfCanvasSelectionToolbarPlacement({
			left: box.x,
			top: box.y,
			right: box.x + box.width,
			bottom: box.y + box.height,
			viewport,
			viewportWidth: host.clientWidth,
			viewportHeight: host.clientHeight,
			toolbarWidth: measuredWidth ?? (arranges ? 380 : 96)
		});
		const metadata: Record<BaseHalfCanvasSceneSelectionAction, { readonly label: string; readonly icon: string }> = {
			rename: { label: baseHalfCanvasSceneSelectionRenameLabel(nodes.length === 1 && nodes[0].data.card.renameChangesPathOnly === true), icon: 'edit' },
			duplicate: { label: localize('basehalf.canvas.selection.duplicate', "Duplicate"), icon: 'files' },
			copyReferences: { label: localize('basehalf.canvas.selection.copyPaths', "Copy Paths"), icon: 'copy' },
			delete: { label: localize('basehalf.canvas.selection.delete', "Delete"), icon: 'trash' }
		};
		const arrangeLabel = localize('basehalf.canvas.selection.arrange', "Arrange");
		const arrangements: readonly { readonly id: BaseHalfCanvasArrangement; readonly label: string }[] = [
			{ id: 'grid', label: localize('basehalf.canvas.selection.arrangeGrid', "Grid") },
			{ id: 'row', label: localize('basehalf.canvas.selection.arrangeRow', "Row") },
			{ id: 'column', label: localize('basehalf.canvas.selection.arrangeColumn', "Column") }
		];
		const moveFocus = (event: ReactKeyboardEvent<HTMLElement>, index: number): void => {
			let next: number | undefined;
			if (event.key === 'ArrowRight') {
				next = (index + 1) % itemCount;
			} else if (event.key === 'ArrowLeft') {
				next = (index - 1 + itemCount) % itemCount;
			} else if (event.key === 'Home') {
				next = 0;
			} else if (event.key === 'End') {
				next = itemCount - 1;
			}
			if (next === undefined) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			setFocusIndex(next);
			const toolbar = event.currentTarget.closest<HTMLElement>('.basehalf-canvas-selection-toolbar');
			toolbar?.querySelectorAll<HTMLButtonElement>('button[data-toolbar-item]')[next]?.focus();
		};
		const focusArrangeButton = (): void => {
			arrangeRef.current?.querySelector<HTMLButtonElement>('button[data-toolbar-item]')?.focus({ preventScroll: true });
		};
		const moveInArrangeMenu = (event: ReactKeyboardEvent<HTMLElement>): void => {
			const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
			const index = items.findIndex(item => item === event.currentTarget.ownerDocument.activeElement);
			let next: number | undefined;
			if (event.key === 'ArrowDown') {
				next = (index + 1) % items.length;
			} else if (event.key === 'ArrowUp') {
				next = (index - 1 + items.length) % items.length;
			} else if (event.key === 'Home') {
				next = 0;
			} else if (event.key === 'End') {
				next = items.length - 1;
			} else if (event.key === 'Escape' || event.key === 'Tab') {
				event.preventDefault();
				event.stopPropagation();
				setArrangeOpen(false);
				focusArrangeButton();
				return;
			}
			if (next === undefined) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			items[next]?.focus({ preventScroll: true });
		};

		// What a button shows. The buttons of a set carry their names beside the
		// icon: a set has no card of its own to say what the icons mean.
		const face = (icon: string, label: string, menu = false): ReactNode[] => arranges
			? [
				h('span', { key: 'icon', className: `codicon codicon-${icon}`, 'aria-hidden': true }),
				h('span', { key: 'label', className: 'basehalf-canvas-selection-action-label' }, label),
				menu ? h('span', { key: 'menu', className: 'basehalf-canvas-selection-action-menu codicon codicon-chevron-down', 'aria-hidden': true }) : null
			]
			: [];
		const separator = (name: string): ReactNode => h('span', { key: name, className: 'basehalf-canvas-selection-separator', 'aria-hidden': true });

		return h(vendor.ViewportPortal, null,
			h('div', {
				ref: toolbarRef,
				className: `basehalf-canvas-selection-toolbar basehalf-canvas-adjacent-chrome ${placement.side}${arranges ? ' for-set' : ''} nodrag nopan nowheel`,
				role: 'toolbar',
				'data-selected-count': nodes.length,
				'aria-label': nodes.length === 1
					? localize('basehalf.canvas.selection.one', "Selected card actions")
					: localize('basehalf.canvas.selection.many', "Actions for {0} selected cards", nodes.length),
				'data-chrome-state': suppressed ? 'suppressed' : 'present',
				'data-placement': placement.side,
				'aria-hidden': suppressed,
				inert: suppressed,
				style: screenSpaceCanvasStyle(viewport.zoom, { left: placement.left, top: placement.top }),
				onPointerDown: (event: ReactPointerEvent<HTMLElement>) => event.stopPropagation(),
				onClick: (event: ReactMouseEvent<HTMLElement>) => event.stopPropagation()
			},
				arranges ? h('span', { ref: arrangeRef, className: 'basehalf-canvas-selection-arrange' },
					h('button', {
						type: 'button',
						className: 'basehalf-canvas-selection-action labeled',
						'data-toolbar-item': 'arrange',
						title: arrangeLabel,
						'aria-label': arrangeLabel,
						'aria-haspopup': 'menu',
						'aria-expanded': arrangeOpen,
						tabIndex: !suppressed && focusIndex === 0 ? 0 : -1,
						onFocus: () => setFocusIndex(0),
						onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
							if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
								event.preventDefault();
								event.stopPropagation();
								setArrangeOpen(true);
								return;
							}
							moveFocus(event, 0);
						},
						onClick: (event: ReactMouseEvent<HTMLElement>) => {
							event.preventDefault();
							event.stopPropagation();
							setArrangeOpen(open => !open);
						}
					}, ...face('layout', arrangeLabel, true)),
					arrangeOpen ? h('div', {
						className: 'basehalf-canvas-arrange-menu',
						role: 'menu',
						'aria-label': arrangeLabel,
						onKeyDown: moveInArrangeMenu
					}, ...arrangements.map(item => h('button', {
						key: item.id,
						type: 'button',
						role: 'menuitem',
						className: 'basehalf-canvas-arrange-menu-item',
						'data-arrangement': item.id,
						tabIndex: -1,
						onClick: (event: ReactMouseEvent<HTMLElement>) => {
							event.preventDefault();
							event.stopPropagation();
							setArrangeOpen(false);
							focusArrangeButton();
							arrange(item.id);
						}
					}, item.label))) : null
				) : null,
				arranges ? separator('after-arrange') : null,
				...actions.flatMap((action, actionIndex) => {
					const index = actionIndex + firstAction;
					const button = h('button', {
						key: action,
						type: 'button',
						className: arranges
							? `basehalf-canvas-selection-action labeled${action === 'delete' ? ' danger' : ''}`
							: `basehalf-canvas-selection-action codicon codicon-${metadata[action].icon}${action === 'delete' ? ' danger' : ''}`,
						'data-toolbar-item': action,
						title: metadata[action].label,
						'aria-label': metadata[action].label,
						tabIndex: !suppressed && index === focusIndex ? 0 : -1,
						onFocus: () => setFocusIndex(index),
						onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => moveFocus(event, index),
						onClick: (event: ReactMouseEvent<HTMLElement>) => {
							event.preventDefault();
							event.stopPropagation();
							invoke(action, paths);
						}
					}, ...face(metadata[action].icon, metadata[action].label));
					// Delete stands apart from the actions that keep the cards.
					return arranges && action === 'delete' ? [separator('before-delete'), button] : [button];
				})
			)
		);
	}

	/**
	 * The box of a set. It is worked out from the cards of this drawing, so it
	 * is never anywhere but around them. It takes the pointer in its whole area:
	 * the scene moves the set from a press on it, and a click changes nothing.
	 */
	function SetBox({ nodes, onToggleAt }: {
		readonly nodes: readonly BaseHalfCanvasFlowNode[];
		readonly onToggleAt: (clientX: number, clientY: number) => void;
	}): ReactElement {
		const viewport = vendor.useViewport();
		const box = baseHalfCanvasBoundingRect(nodes.map(flowNodeRectWithCaption));
		if (!box) {
			return h(vendor.Fragment);
		}
		return h(vendor.ViewportPortal, null,
			h('div', {
				className: 'basehalf-canvas-set-box',
				role: 'group',
				'aria-label': localize('basehalf.canvas.setBox', "{0} cards selected", nodes.length),
				style: { left: box.x, top: box.y, width: box.width, height: box.height, borderWidth: 1 / viewport.zoom },
				onClick: (event: ReactMouseEvent<HTMLElement>) => {
					event.stopPropagation();
					if (event.shiftKey) {
						onToggleAt(event.clientX, event.clientY);
					}
				},
				onDoubleClick: (event: ReactMouseEvent<HTMLElement>) => {
					event.preventDefault();
					event.stopPropagation();
				},
				onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
					event.preventDefault();
					event.stopPropagation();
				}
			})
		);
	}

	return { SelectionToolbar, SetBox };
}
