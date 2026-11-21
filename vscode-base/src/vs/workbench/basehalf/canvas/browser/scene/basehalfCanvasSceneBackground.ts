/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfCanvasSceneBackground.css';
import { BASEHALF_CANVAS_BACKGROUND_GAP, BASEHALF_CANVAS_DOT_SCREEN_SIZE, BASEHALF_CANVAS_DOT_STRENGTH, baseHalfCanvasDotGrid, baseHalfCanvasDots } from '../../common/basehalfCanvasBackground.js';
import { BaseHalfCanvasSceneBackground } from '../../common/basehalfCanvasScene.js';
import type { ReactElement } from 'react';
import { IBaseHalfCanvasSceneEnvironment } from './basehalfCanvasSceneShared.js';

/**
 * What the canvas draws behind its cards, as the user chose (workbench
 * appearance, "The background of the canvas"): the lines of the canvas
 * library, dots, or nothing.
 */
export function createBaseHalfCanvasSceneBackground(environment: IBaseHalfCanvasSceneEnvironment) {
	const { vendor, h } = environment;

	/**
	 * The dots: one size on screen at every zoom, each on whole pixels of the
	 * screen so that every dot looks the same, and the ones halfway between
	 * fading as the canvas zooms. The library's dots scale with the zoom and
	 * stand between pixels, so these are drawn here.
	 */
	function Dots(): ReactElement {
		const canvasRef = vendor.useRef<HTMLCanvasElement>(null);
		const transform = vendor.useStore(state => state.transform);
		const width = vendor.useStore(state => state.width);
		const height = vendor.useStore(state => state.height);
		// Counts what changes the drawing without a move of the view: another color theme, and a
		// screen with other pixels.
		const [look, setLook] = vendor.useState(0);
		const ink = vendor.useRef<{ readonly look: number; readonly color: string } | undefined>(undefined);
		vendor.useEffect(() => {
			const canvas = canvasRef.current;
			const view = canvas?.ownerDocument.defaultView;
			if (!canvas || !view) {
				return;
			}
			const changed = () => setLook(current => current + 1);
			// The workbench names its color theme in its classes.
			const workbench = canvas.closest('.monaco-workbench');
			const observer = workbench ? new view.MutationObserver(changed) : undefined;
			if (workbench) {
				observer?.observe(workbench, { attributes: true, attributeFilter: ['class'] });
			}
			const pixels = view.matchMedia(`(resolution: ${view.devicePixelRatio}dppx)`);
			pixels.addEventListener('change', changed);
			return () => {
				observer?.disconnect();
				pixels.removeEventListener('change', changed);
			};
		}, [look]);
		vendor.useLayoutEffect(() => {
			const canvas = canvasRef.current;
			const view = canvas?.ownerDocument.defaultView;
			const context = canvas?.getContext('2d');
			if (!canvas || !view || !context) {
				return;
			}
			const ratio = view.devicePixelRatio || 1;
			const pixelWidth = Math.max(1, Math.round(width * ratio));
			const pixelHeight = Math.max(1, Math.round(height * ratio));
			if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
				// A new size clears the drawing.
				canvas.width = pixelWidth;
				canvas.height = pixelHeight;
			} else {
				context.clearRect(0, 0, pixelWidth, pixelHeight);
			}
			if (ink.current?.look !== look) {
				ink.current = { look, color: view.getComputedStyle(canvas).color };
			}
			const size = Math.max(1, Math.round(BASEHALF_CANVAS_DOT_SCREEN_SIZE * ratio));
			const grid = baseHalfCanvasDotGrid(transform[2]);
			const dots = baseHalfCanvasDots({ x: transform[0], y: transform[1], zoom: transform[2] }, width, height, ratio, size);
			context.fillStyle = ink.current.color;
			for (const whole of [true, false]) {
				context.globalAlpha = BASEHALF_CANVAS_DOT_STRENGTH * (whole ? 1 : grid.between);
				context.beginPath();
				for (const dot of dots) {
					if (dot.whole !== whole) {
						continue;
					}
					if (size < 3) {
						// So few pixels have no room for a round shape.
						context.rect(dot.x, dot.y, size, size);
					} else {
						context.moveTo(dot.x + size, dot.y + size / 2);
						context.arc(dot.x + size / 2, dot.y + size / 2, size / 2, 0, 2 * Math.PI);
					}
				}
				context.fill();
			}
			// What a check of the window reads: the dots as they are drawn.
			canvas.dataset.basehalfDotGap = String(grid.gap);
			canvas.dataset.basehalfDotsBetween = String(grid.between);
		}, [transform, width, height, look]);
		return h('canvas', {
			ref: canvasRef,
			className: 'basehalf-canvas-background-dots',
			'data-testid': 'canvas-background-dots',
			'aria-hidden': true
		});
	}

	function SceneBackground({ background }: { readonly background: BaseHalfCanvasSceneBackground }): ReactElement | null {
		if (background === 'lines') {
			return h(vendor.Background, {
				variant: vendor.BackgroundVariant.Lines,
				gap: BASEHALF_CANVAS_BACKGROUND_GAP,
				size: 1,
				color: 'color-mix(in srgb, var(--vscode-foreground) 4.5%, transparent)'
			});
		}
		return background === 'dots' ? h(Dots) : null;
	}

	return SceneBackground;
}
