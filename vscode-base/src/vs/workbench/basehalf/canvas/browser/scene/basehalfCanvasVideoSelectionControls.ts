/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfCanvasAdjacentChrome.css';
import './media/basehalfCanvasNoteToolbar.css';
import './media/basehalfCanvasVideoSelectionControls.css';
import { isMacintosh, isWindows } from '../../../../../base/common/platform.js';
import { localize } from '../../../../../nls.js';
import { BASEHALF_CANVAS_MIN_ZOOM } from '../../../shell/common/basehalfConfiguration.js';
import {
	baseHalfCanvasSceneVideoSelectionActions,
	IBaseHalfCanvasSceneVideoPanelLayout,
	IBaseHalfCanvasSceneVideoPanelSurface,
	BaseHalfCanvasSceneVideoAction,
	BaseHalfCanvasSceneVideoFrame,
	BASEHALF_CANVAS_VIDEO_PANEL_LAYOUT_EVENT
} from '../../common/basehalfCanvasScene.js';
import { BaseHalfVideoPanelSide } from '../../../video/common/basehalfVideoNodePanelPlacement.js';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react';
import { BaseHalfCanvasFlowNode, baseHalfCanvasClickedByPointer, IBaseHalfCanvasSceneEnvironment, isCanvasElement, numericStyle, screenSpaceCanvasStyle } from './basehalfCanvasSceneShared.js';
import { baseHalfCanvasVideoToolbarWidth, NOTE_CONTROLS_SCREEN_MARGIN, resolveBaseHalfCanvasVideoPanelPlacement, resolveBaseHalfCanvasVideoSelectionPlacement } from './basehalfCanvasSelectionControlsPlacement.js';

const VIDEO_CAPTURE_FRAMES: readonly BaseHalfCanvasSceneVideoFrame[] = Object.freeze(['first', 'current', 'last']);
/** The menu of frames: three items of 26 pixels, its padding, and its border. */
const VIDEO_CAPTURE_MENU_SCREEN_HEIGHT = 88;
const VIDEO_CAPTURE_MENU_SCREEN_GAP = 6;

/** The label of the toolbar's Reveal action, as the platform's file manager is called. */
export function baseHalfCanvasRevealVideoLabel(): string {
	return isMacintosh
		? localize('basehalf.canvas.video.revealInFinder', "Reveal in Finder")
		: isWindows
			? localize('basehalf.canvas.video.revealInExplorer', "Reveal in File Explorer")
			: localize('basehalf.canvas.video.openContainingFolder', "Open Containing Folder");
}

/** Tells the panel of a Video card where the scene put it, so it can keep its menus inside the canvas. */
function dispatchBaseHalfCanvasVideoPanelLayout(element: HTMLElement, detail: IBaseHalfCanvasSceneVideoPanelLayout): void {
	const EventConstructor = element.ownerDocument.defaultView?.CustomEvent;
	if (EventConstructor) {
		element.dispatchEvent(new EventConstructor<IBaseHalfCanvasSceneVideoPanelLayout>(BASEHALF_CANVAS_VIDEO_PANEL_LAYOUT_EVENT, { detail, bubbles: false }));
	}
}

function flowNodeBounds(node: BaseHalfCanvasFlowNode): { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number } {
	const width = node.width ?? node.measured?.width ?? numericStyle(node.style?.width) ?? node.data.card.width;
	const height = node.height ?? node.measured?.height ?? numericStyle(node.style?.height) ?? node.data.card.height;
	return { left: node.position.x, top: node.position.y, right: node.position.x + width, bottom: node.position.y + height };
}

/**
 * Makes the controls of a selected Video card: its toolbar, and the place
 * beside the card where the canvas view puts the Video panel.
 */
export function createBaseHalfCanvasVideoSelectionControls(environment: IBaseHalfCanvasSceneEnvironment) {
	const { vendor, h, host, delegate } = environment;

	/** The size of the canvas's host, kept up to date. */
	function useHostSize(): { readonly width: number; readonly height: number } {
		const [size, setSize] = vendor.useState(() => ({ width: host.clientWidth, height: host.clientHeight }));
		vendor.useEffect(() => {
			const update = (width = host.clientWidth, height = host.clientHeight): void => {
				setSize(current => current.width === width && current.height === height ? current : { width, height });
			};
			update();
			const ResizeObserverConstructor = host.ownerDocument.defaultView?.ResizeObserver;
			if (!ResizeObserverConstructor) {
				return;
			}
			const observer = new ResizeObserverConstructor(entries => {
				const box = entries[0]?.contentRect;
				update(box?.width, box?.height);
			});
			observer.observe(host);
			return () => observer.disconnect();
		}, []);
		return size;
	}

	/**
	 * The toolbar above a selected generation card: Upload Image or Upload
	 * Video for a draft; Reveal and Open for a card with its file, and Capture
	 * Frame (with its menu of frames) for a video. The workbench runs the
	 * actions.
	 */
	function VideoSelectionControls({ node, suppressed }: {
		readonly node: BaseHalfCanvasFlowNode;
		readonly suppressed: boolean;
	}): ReactElement {
		const viewport = vendor.useViewport();
		const viewportSize = useHostSize();
		const [focusIndex, setFocusIndex] = vendor.useState(0);
		const [captureOpen, setCaptureOpen] = vendor.useState(false);
		// A click opened the menu of frames, not a key: it holds the focus itself, with no current item.
		const captureByPointer = vendor.useRef(false);
		const toolbarRef = vendor.useRef<HTMLDivElement | null>(null);
		const buttonRefs = vendor.useRef<(HTMLButtonElement | null)[]>([]);
		const frameMenuRef = vendor.useRef<HTMLDivElement | null>(null);
		const frameRefs = vendor.useRef<(HTMLButtonElement | null)[]>([]);
		const controls = node.data.card.controls?.kind === 'video' ? node.data.card.controls : undefined;
		const actions = baseHalfCanvasSceneVideoSelectionActions(controls?.actions ?? []);
		const actionKey = actions.join('\0');
		const captureIndex = actions.indexOf('captureFrame');
		vendor.useEffect(() => {
			setFocusIndex(0);
			setCaptureOpen(false);
		}, [actionKey, node.id]);
		vendor.useEffect(() => {
			if (suppressed) {
				setCaptureOpen(false);
			}
		}, [suppressed]);
		vendor.useEffect(() => {
			const element = node.data.card.element;
			const focusToolbar = (event: KeyboardEvent): void => {
				if (event.isComposing || event.keyCode === 229
					|| !event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || event.key !== 'F10') {
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				setFocusIndex(0);
				element.ownerDocument.defaultView?.setTimeout(() => buttonRefs.current[0]?.focus(), 0);
			};
			element.addEventListener('keydown', focusToolbar);
			return () => element.removeEventListener('keydown', focusToolbar);
		}, [node.data.card.element]);
		vendor.useEffect(() => {
			if (!captureOpen) {
				return;
			}
			(captureByPointer.current ? frameMenuRef.current : frameRefs.current[0])?.focus({ preventScroll: true });
			const closeOutside = (event: PointerEvent): void => {
				if (!isCanvasElement(event.target) || !toolbarRef.current?.contains(event.target)) {
					setCaptureOpen(false);
				}
			};
			host.ownerDocument.addEventListener('pointerdown', closeOutside, true);
			return () => host.ownerDocument.removeEventListener('pointerdown', closeOutside, true);
		}, [captureOpen]);

		if (!controls || actions.length === 0) {
			return h(vendor.Fragment);
		}

		const bounds = flowNodeBounds(node);
		const importOnly = actions.length === 1 && actions[0] === 'importResult';
		const placement = resolveBaseHalfCanvasVideoSelectionPlacement({
			...bounds,
			viewport,
			viewportWidth: viewportSize.width,
			viewportHeight: viewportSize.height,
			toolbarWidth: baseHalfCanvasVideoToolbarWidth(actions)
		});
		if (!placement.visible) {
			return h(vendor.Fragment);
		}

		const image = controls.media === 'image';
		const labels: Readonly<Record<BaseHalfCanvasSceneVideoAction, string>> = {
			importResult: image
				? localize('basehalf.canvas.video.uploadImage', "Upload Image")
				: localize('basehalf.canvas.video.uploadVideo', "Upload Video"),
			captureFrame: localize('basehalf.canvas.video.captureFrame', "Capture Frame"),
			revealVideo: baseHalfCanvasRevealVideoLabel(),
			openFullPreview: localize('basehalf.canvas.video.open', "Open")
		};
		const frameLabels: Readonly<Record<BaseHalfCanvasSceneVideoFrame, string>> = {
			first: localize('basehalf.canvas.video.firstFrame', "First Frame"),
			current: localize('basehalf.canvas.video.currentFrame', "Current Frame"),
			last: localize('basehalf.canvas.video.lastFrame', "Last Frame")
		};
		const invoke = (action: BaseHalfCanvasSceneVideoAction, anchor: HTMLElement, frame?: BaseHalfCanvasSceneVideoFrame): void => {
			void delegate.invokeVideoAction(
				node.data.sceneKey,
				node.data.structuralEpoch,
				node.id,
				action,
				anchor,
				frame
			).catch(error => delegate.reportError(error));
		};
		const focusButton = (index: number): void => {
			setFocusIndex(index);
			buttonRefs.current[index]?.focus({ preventScroll: true });
		};
		const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>, index: number): void => {
			if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				node.data.card.element.focus({ preventScroll: true });
				return;
			}
			if (index === captureIndex && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
				event.preventDefault();
				event.stopPropagation();
				captureByPointer.current = false;
				setCaptureOpen(true);
				return;
			}
			let next: number | undefined;
			if (event.key === 'ArrowRight') {
				next = (index + 1) % actions.length;
			} else if (event.key === 'ArrowLeft') {
				next = (index - 1 + actions.length) % actions.length;
			} else if (event.key === 'Home') {
				next = 0;
			} else if (event.key === 'End') {
				next = actions.length - 1;
			}
			if (next === undefined) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			focusButton(next);
		};
		const onFrameKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
			const items = frameRefs.current.filter((item): item is HTMLButtonElement => !!item);
			const index = items.findIndex(item => item === host.ownerDocument.activeElement);
			let next: number | undefined;
			// Without a current item (index -1), Down goes to the first frame and Up to the last.
			if (event.key === 'ArrowDown') {
				next = (index + 1) % items.length;
			} else if (event.key === 'ArrowUp') {
				next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
			} else if (event.key === 'Home') {
				next = 0;
			} else if (event.key === 'End') {
				next = items.length - 1;
			} else if (event.key === 'Escape' || event.key === 'Tab') {
				event.preventDefault();
				event.stopPropagation();
				setCaptureOpen(false);
				focusButton(captureIndex);
				return;
			}
			if (next === undefined) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			items[next]?.focus({ preventScroll: true });
		};
		const zoom = Math.max(BASEHALF_CANVAS_MIN_ZOOM, viewport.zoom);
		// The menu of frames opens upward, over the canvas above the toolbar,
		// when it fits there; otherwise it opens over the card.
		const menuOpensAbove = placement.top * zoom + viewport.y - VIDEO_CAPTURE_MENU_SCREEN_GAP - VIDEO_CAPTURE_MENU_SCREEN_HEIGHT >= NOTE_CONTROLS_SCREEN_MARGIN;
		const codicon = (name: string, extra = ''): ReactElement => h('span', { className: `codicon codicon-${name}${extra}`, 'aria-hidden': true });
		const face = (action: BaseHalfCanvasSceneVideoAction): ReactNode => {
			switch (action) {
				case 'importResult':
					return h(vendor.Fragment, null, codicon('cloud-upload'), h('span', { className: 'basehalf-video-upload-label' }, labels.importResult));
				case 'captureFrame':
					return h(vendor.Fragment, null, codicon('device-camera'), codicon('chevron-down', ' basehalf-video-capture-chevron'));
				case 'revealVideo':
					return codicon('folder-opened');
				case 'openFullPreview':
					return h(vendor.BaseHalfCanvasToolbarIcons.expand, {
						size: 18,
						className: 'basehalf-canvas-note-toolbar-icon',
						'data-basehalf-icon': 'expand',
						'aria-hidden': true,
						focusable: false
					});
			}
		};
		const buttons = actions.map((action, index) => h('button', {
			key: action,
			ref: (element: HTMLButtonElement | null) => { buttonRefs.current[index] = element; },
			type: 'button',
			className: `basehalf-video-result-toolbar-action basehalf-canvas-note-toolbar-action${action === 'importResult' ? ' basehalf-video-upload-action' : ' icon'}${action === 'captureFrame' ? ' basehalf-video-capture-action' : ''}`,
			title: labels[action],
			'aria-label': labels[action],
			...(action === 'captureFrame' ? { 'aria-haspopup': 'menu', 'aria-expanded': captureOpen } : {}),
			'data-video-action': action,
			tabIndex: !suppressed && index === focusIndex ? 0 : -1,
			onFocus: () => setFocusIndex(index),
			onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => onKeyDown(event, index),
			onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
				event.preventDefault();
				event.stopPropagation();
			},
			onClick: (event: ReactMouseEvent<HTMLButtonElement>) => {
				event.preventDefault();
				event.stopPropagation();
				if (action === 'captureFrame') {
					captureByPointer.current = baseHalfCanvasClickedByPointer(event);
					setCaptureOpen(open => !open);
					return;
				}
				invoke(action, event.currentTarget);
			}
		}, face(action)));
		const frameMenu = captureOpen && captureIndex >= 0
			? h('div', {
				key: 'frames',
				ref: frameMenuRef,
				className: `basehalf-video-capture-menu ${menuOpensAbove ? 'above' : 'below'}`,
				role: 'menu',
				'aria-label': labels.captureFrame,
				tabIndex: -1,
				onKeyDown: onFrameKeyDown
			}, ...VIDEO_CAPTURE_FRAMES.map((frame, index) => h('button', {
				key: frame,
				ref: (element: HTMLButtonElement | null) => { frameRefs.current[index] = element; },
				type: 'button',
				role: 'menuitem',
				className: 'basehalf-video-capture-menu-item',
				'data-video-frame': frame,
				tabIndex: -1,
				onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
					event.preventDefault();
					event.stopPropagation();
				},
				onClick: (event: ReactMouseEvent<HTMLElement>) => {
					event.preventDefault();
					event.stopPropagation();
					setCaptureOpen(false);
					const anchor = buttonRefs.current[captureIndex];
					focusButton(captureIndex);
					if (anchor) {
						invoke('captureFrame', anchor, frame);
					}
				}
			}, frameLabels[frame])))
			: null;
		const stopEvent = (event: ReactMouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>): void => {
			event.stopPropagation();
		};
		return h(vendor.ViewportPortal, null,
			h('div', {
				ref: toolbarRef,
				className: `basehalf-video-context-toolbar ${importOnly ? 'basehalf-video-draft-toolbar' : 'basehalf-video-result-toolbar'}${frameMenu ? ' menu-open' : ''} basehalf-canvas-note-toolbar basehalf-canvas-note-surface basehalf-canvas-adjacent-chrome nodrag nopan nowheel`,
				role: 'toolbar',
				'aria-label': image
					? localize('basehalf.canvas.image.actions', "Image actions for {0}", node.id)
					: localize('basehalf.canvas.video.actions', "Video actions for {0}", node.id),
				'data-node-path': node.id,
				'data-media': image ? 'image' : 'video',
				'data-video-surface': importOnly ? 'empty' : 'video',
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
			}, ...buttons, frameMenu)
		);
	}

	/**
	 * Places the panel that the workbench built for the selected Video card:
	 * at a constant screen size, below the card, above it, or clamped inside
	 * the canvas, and hidden while the card is off the canvas. It follows the
	 * card while the card moves or is resized, and it never moves the canvas.
	 */
	function VideoPanelAdjacentSurface({ node, surface, following }: {
		readonly node: BaseHalfCanvasFlowNode;
		readonly surface: IBaseHalfCanvasSceneVideoPanelSurface;
		readonly following: boolean;
	}): ReactElement {
		const viewport = vendor.useViewport();
		const viewportSize = useHostSize();
		const mountRef = vendor.useRef<HTMLDivElement>(null);
		const keptSide = vendor.useRef<BaseHalfVideoPanelSide | undefined>(undefined);
		const lastSide = vendor.useRef<BaseHalfVideoPanelSide | undefined>(undefined);
		const bounds = flowNodeBounds(node);
		if (!following) {
			keptSide.current = undefined;
		} else if (!keptSide.current) {
			keptSide.current = lastSide.current;
		}
		const placement = resolveBaseHalfCanvasVideoPanelPlacement({
			...bounds,
			viewport,
			viewportWidth: viewportSize.width,
			viewportHeight: viewportSize.height,
			height: surface.screenHeight,
			...(keptSide.current ? { keepSide: keptSide.current } : {})
		});
		lastSide.current = placement.side;
		vendor.useLayoutEffect(() => {
			const mount = mountRef.current;
			const element = surface.element;
			if (!mount) {
				return;
			}
			mount.replaceChildren(element);
			return () => {
				dispatchBaseHalfCanvasVideoPanelLayout(element, {
					placement: 'below',
					visible: false,
					following: false,
					left: 0,
					top: 0,
					width: 0,
					height: 0,
					canvasWidth: host.clientWidth,
					canvasHeight: host.clientHeight
				});
				if (element.parentElement === mount) {
					element.remove();
				}
			};
		}, [surface.element]);
		vendor.useLayoutEffect(() => {
			dispatchBaseHalfCanvasVideoPanelLayout(surface.element, {
				placement: placement.placement,
				visible: placement.visible,
				following,
				left: placement.left,
				top: placement.top,
				width: placement.width,
				height: placement.height,
				canvasWidth: viewportSize.width,
				canvasHeight: viewportSize.height
			});
		}, [
			surface.element,
			following,
			placement.placement,
			placement.visible,
			placement.left,
			placement.top,
			placement.width,
			placement.height,
			viewportSize.width,
			viewportSize.height
		]);

		const stopEvent = (event: ReactMouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>): void => {
			event.stopPropagation();
		};
		return h(vendor.ViewportPortal, null,
			h('div', {
				ref: mountRef,
				className: 'basehalf-canvas-video-panel-surface basehalf-canvas-adjacent-chrome nodrag nopan nowheel',
				'data-basehalf-card-path': surface.path,
				'data-placement': placement.side,
				'data-panel-placement': placement.placement,
				'data-visible': String(placement.visible),
				'data-chrome-state': following ? 'following' : placement.visible ? 'present' : 'suspended',
				'aria-hidden': !placement.visible,
				inert: !placement.visible,
				style: screenSpaceCanvasStyle(viewport.zoom, {
					left: placement.flowLeft,
					top: placement.flowTop,
					width: placement.width,
					height: placement.height,
					visibility: placement.visible ? 'visible' : 'hidden',
					pointerEvents: placement.visible && !following ? 'auto' : 'none'
				}),
				onPointerDown: stopEvent,
				onClick: stopEvent,
				onDoubleClick: stopEvent
			})
		);
	}

	return { VideoSelectionControls, VideoPanelAdjacentSurface };
}
