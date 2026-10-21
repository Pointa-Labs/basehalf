/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The look of a card: its frame and borders in each state, and the corners that resize it.

import path from 'path';

export async function assertCanvasStillOnTop(page, context) {
	const state = await page.evaluate(() => {
		const editorPart = document.querySelector('.monaco-workbench .part.editor');
		const activeEditor = document.querySelector('.monaco-workbench .part.editor .editor-instance[aria-label]');
		return {
			canvasOnTop: editorPart?.classList.contains('basehalf-canvas-on-top') === true,
			activeEditor: activeEditor?.getAttribute('aria-label') ?? undefined
		};
	});
	if (!state.canvasOnTop || state.activeEditor !== undefined) {
		throw new Error(`Canvas lost its primary surface ${context}: ${JSON.stringify(state)}`);
	}
}

export async function captureCanvasCardComputedChrome(card) {
	return card.evaluate(element => {
		const node = element.closest('.react-flow__node');
		const workbench = element.closest('.basehalf-canvas-workbench');
		if (!(node instanceof HTMLElement) || !(workbench instanceof HTMLElement)) {
			throw new Error('Canvas card chrome capture could not resolve its scene node');
		}

		const probe = document.createElement('span');
		probe.style.position = 'absolute';
		probe.style.visibility = 'hidden';
		probe.style.pointerEvents = 'none';
		workbench.appendChild(probe);
		const resolveColor = property => {
			probe.style.color = `var(${property})`;
			return getComputedStyle(probe).color;
		};
		const colors = {
			activeBorder: resolveColor('--bh-canvas-active-border'),
			geometry: resolveColor('--bh-canvas-geometry'),
			geometryStrong: resolveColor('--bh-canvas-geometry-strong'),
			focusRing: resolveColor('--bh-canvas-focus-ring'),
			intent: resolveColor('--bh-canvas-intent')
		};
		probe.remove();

		const isVisible = element => {
			const style = getComputedStyle(element);
			const bounds = element.getBoundingClientRect();
			return style.display !== 'none'
				&& style.visibility !== 'hidden'
				&& Number.parseFloat(style.opacity) > 0
				&& bounds.width > 0
				&& bounds.height > 0;
		};
		const borderPaint = style => ({
			top: { width: style.borderTopWidth, style: style.borderTopStyle, color: style.borderTopColor },
			right: { width: style.borderRightWidth, style: style.borderRightStyle, color: style.borderRightColor },
			bottom: { width: style.borderBottomWidth, style: style.borderBottomStyle, color: style.borderBottomColor },
			left: { width: style.borderLeftWidth, style: style.borderLeftStyle, color: style.borderLeftColor }
		});
		const isPaintedBorder = border => Number.parseFloat(border.width) > 0
			&& border.style !== 'none'
			&& border.style !== 'hidden'
			&& border.color !== 'transparent'
			&& border.color !== 'rgba(0, 0, 0, 0)';
		// Probe the real hit-testing against the painted silhouette: the corner
		// arc comes from the card's own computed radius and live zoom, so these
		// samples also catch a scene radius that drifts from the CSS token.
		const cardRect = element.getBoundingClientRect();
		const cardZoom = element.offsetWidth > 0 ? cardRect.width / element.offsetWidth : 1;
		const cornerRadius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) * cardZoom;
		const cornerPoint = (corner, degrees, distance) => {
			const [vertical, horizontal] = corner.split('-');
			const xSign = horizontal === 'right' ? 1 : -1;
			const ySign = vertical === 'bottom' ? 1 : -1;
			const centerX = xSign > 0 ? cardRect.right - cornerRadius : cardRect.left + cornerRadius;
			const centerY = ySign > 0 ? cardRect.bottom - cornerRadius : cardRect.top + cornerRadius;
			const radians = degrees * Math.PI / 180;
			return { x: centerX + xSign * distance * Math.cos(radians), y: centerY + ySign * distance * Math.sin(radians) };
		};
		const describeHit = hit => hit instanceof Element ? `${hit.tagName.toLowerCase()}.${hit.getAttribute('class') ?? ''}` : null;
		const isResizeTarget = hit => hit instanceof Element && hit.closest('.react-flow__resize-control') !== null;
		const resizeLines = Array.from(node.querySelectorAll('.basehalf-canvas-node-resizer-line')).map(line => {
			const style = getComputedStyle(line);
			const borders = borderPaint(style);
			const bounds = line.getBoundingClientRect();
			const vertical = line.classList.contains('left') || line.classList.contains('right');
			return {
				className: line.getAttribute('class'),
				opacity: style.opacity,
				pointerEvents: style.pointerEvents,
				borders,
				painted: Object.values(borders).some(isPaintedBorder),
				coversOnlyStraightSide: vertical
					? Math.abs(bounds.top - (cardRect.top + cornerRadius)) <= 1 && Math.abs(bounds.bottom - (cardRect.bottom - cornerRadius)) <= 1
					: Math.abs(bounds.left - (cardRect.left + cornerRadius)) <= 1 && Math.abs(bounds.right - (cardRect.right - cornerRadius)) <= 1
			};
		});
		const resizeHandles = Array.from(node.querySelectorAll('.basehalf-canvas-node-resizer-handle')).map(handle => {
			const style = getComputedStyle(handle);
			const borders = borderPaint(style);
			const visible = isVisible(handle);
			const backgroundPainted = style.backgroundColor !== 'transparent'
				&& style.backgroundColor !== 'rgba(0, 0, 0, 0)';
			const corner = `${handle.classList.contains('top') ? 'top' : 'bottom'}-${handle.classList.contains('left') ? 'left' : 'right'}`;
			const bands = Array.from(handle.querySelectorAll('.basehalf-canvas-node-resize-corner-band'));
			const indicator = handle.querySelector('.basehalf-canvas-node-resize-corner-indicator');
			const indicatorStyle = indicator ? getComputedStyle(indicator) : undefined;
			// The band spans both sides of the rounded edge: the outer part below
			// the card and the inner strip above the card's content.
			const arcSamples = [10, 45, 80].flatMap(degrees => [3, -4].map(offset => {
				const point = cornerPoint(corner, degrees, cornerRadius + offset);
				const hit = document.elementFromPoint(point.x, point.y);
				return {
					degrees,
					offset,
					hitsBand: hit !== null && bands.includes(hit),
					cursor: hit ? getComputedStyle(hit).cursor : 'none',
					hit: describeHit(hit)
				};
			}));
			const inside = cornerPoint(corner, 45, cornerRadius - 12);
			const insideHit = document.elementFromPoint(inside.x, inside.y);
			const beyond = cornerPoint(corner, 45, cornerRadius + 16);
			const beyondHit = document.elementFromPoint(beyond.x, beyond.y);
			return {
				className: handle.getAttribute('class'),
				corner,
				visible,
				interactive: visible && arcSamples.every(sample => sample.hitsBand),
				painted: visible && (backgroundPainted || Object.values(borders).some(isPaintedBorder)),
				arcSamples,
				insideBelongsToCard: insideHit instanceof Element && element.contains(insideHit) && !isResizeTarget(insideHit),
				insideHit: describeHit(insideHit),
				beyondBandIsTarget: isResizeTarget(beyondHit),
				beyondHit: describeHit(beyondHit),
				borderColor: style.borderColor,
				backgroundColor: style.backgroundColor,
				opacity: style.opacity,
				pointerEvents: style.pointerEvents,
				indicatorVisible: visible
					&& indicatorStyle !== undefined
					&& indicatorStyle.display !== 'none'
					&& Number.parseFloat(indicatorStyle.opacity) > 0,
				indicatorStroke: indicatorStyle?.stroke ?? 'none'
			};
		});
		const connectionHandles = Array.from(node.querySelectorAll('.basehalf-canvas-card-connect-handle')).map(handle => {
			const style = getComputedStyle(handle);
			return {
				className: handle.getAttribute('class'),
				visible: isVisible(handle),
				pointerEvents: style.pointerEvents
			};
		});
		const cardStyle = getComputedStyle(element);
		const nodeStyle = getComputedStyle(node);
		const outlinePaint = style => Number.parseFloat(style.outlineWidth) > 0 && style.outlineStyle !== 'none'
			? { outlineColor: style.outlineColor, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth }
			: { outlineColor: 'transparent', outlineStyle: 'none', outlineWidth: '0px' };
		return {
			colors,
			cardFocusVisible: element.matches(':focus-visible'),
			nodeFocusVisible: node.matches(':focus-visible'),
			activeElementInside: element === document.activeElement || element.contains(document.activeElement),
			cardSelected: element.classList.contains('selected'),
			cardResizing: element.dataset.cardResizing === 'true',
			nodeSelected: node.classList.contains('selected'),
			nodeDragging: node.classList.contains('dragging'),
			nodeResizing: element.dataset.cardResizing === 'true',
			noteEditing: element.dataset.noteEditing === 'true',
			cardPaint: {
				backgroundColor: cardStyle.backgroundColor,
				borderTopColor: cardStyle.borderTopColor,
				borderRightColor: cardStyle.borderRightColor,
				borderBottomColor: cardStyle.borderBottomColor,
				borderLeftColor: cardStyle.borderLeftColor,
				boxShadow: cardStyle.boxShadow,
				...outlinePaint(cardStyle)
			},
			nodePaint: outlinePaint(nodeStyle),
			resizeLines,
			resizeHandles,
			connectionHandles,
			paintedResizeLines: resizeLines.filter(line => line.painted).length,
			paintedResizeHandles: resizeHandles.filter(handle => handle.painted).length,
			visibleResizeHandles: resizeHandles.filter(handle => handle.visible).length,
			interactiveResizeHandles: resizeHandles.filter(handle => handle.interactive).length,
			liveConnectionHandles: connectionHandles.filter(handle => handle.visible || handle.pointerEvents !== 'none').length
		};
	});
}

export function assertCanvasCardChromeDoesNotUseIntent(chrome, phase) {
	const usages = [];
	for (const [property, color] of Object.entries(chrome.cardPaint)) {
		if (property.startsWith('border') && color === chrome.colors.intent) {
			usages.push(`card.${property}`);
		}
	}
	if (chrome.cardPaint.outlineStyle !== 'none'
		&& chrome.cardPaint.outlineWidth !== '0px'
		&& chrome.cardPaint.outlineColor === chrome.colors.intent) {
		usages.push('card.outlineColor');
	}
	if (chrome.nodePaint.outlineStyle !== 'none'
		&& chrome.nodePaint.outlineWidth !== '0px'
		&& chrome.nodePaint.outlineColor === chrome.colors.intent) {
		usages.push('node.outlineColor');
	}
	for (const [index, line] of chrome.resizeLines.entries()) {
		for (const [side, border] of Object.entries(line.borders)) {
			if (border.color === chrome.colors.intent) {
				usages.push(`resizeLine[${index}].${side}`);
			}
		}
	}
	for (const [index, handle] of chrome.resizeHandles.entries()) {
		if (handle.painted && handle.borderColor === chrome.colors.intent) {
			usages.push(`resizeHandle[${index}].borderColor`);
		}
		if (handle.painted && handle.backgroundColor === chrome.colors.intent) {
			usages.push(`resizeHandle[${index}].backgroundColor`);
		}
		if (handle.indicatorVisible && handle.indicatorStroke === chrome.colors.intent) {
			usages.push(`resizeHandle[${index}].indicatorStroke`);
		}
	}
	if (usages.length > 0) {
		throw new Error(`Canvas card used connection-intent paint during ${phase}: ${JSON.stringify({ usages, chrome })}`);
	}
}

export function assertCanvasPointerChromeHasNoOutline(chrome, phase) {
	const painted = [];
	for (const [owner, paint] of [['card', chrome.cardPaint], ['node', chrome.nodePaint]]) {
		if (paint.outlineStyle !== 'none' && paint.outlineWidth !== '0px') {
			painted.push({ owner, color: paint.outlineColor, style: paint.outlineStyle, width: paint.outlineWidth });
		}
	}
	if (painted.length > 0) {
		throw new Error(`Pointer interaction rendered a focus outline during ${phase}: ${JSON.stringify({ painted, chrome })}`);
	}
}

export function assertCanvasCardUsesActiveBorder(chrome, phase) {
	const sides = ['borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor'];
	const unexpected = sides.filter(side => chrome.cardPaint[side] !== chrome.colors.activeBorder);
	if (unexpected.length > 0) {
		throw new Error(`Active Canvas card did not use one steady border during ${phase}: ${JSON.stringify({ unexpected, chrome })}`);
	}
}

export function assertCanvasCardPaintEqual(expected, actual, phase) {
	if (JSON.stringify(expected) !== JSON.stringify(actual)) {
		throw new Error(`Canvas card paint changed during ${phase}: ${JSON.stringify({ expected, actual })}`);
	}
}

export function assertCanvasCardResizeChromeIsNeutral(chrome, phase) {
	assertCanvasCardChromeDoesNotUseIntent(chrome, phase);
	assertCanvasPointerChromeHasNoOutline(chrome, phase);
	assertCanvasCardUsesActiveBorder(chrome, phase);
	if (chrome.paintedResizeLines !== 0) {
		throw new Error(`Canvas card rendered a resize outline during ${phase}: ${JSON.stringify(chrome.resizeLines)}`);
	}
	if (chrome.paintedResizeHandles !== 0) {
		throw new Error(`Canvas card painted a resize control box during ${phase}: ${JSON.stringify(chrome.resizeHandles)}`);
	}
	// The corner indicator is the only resize paint: at most one arc, in the
	// neutral geometry color.
	const indicators = chrome.resizeHandles.filter(handle => handle.indicatorVisible);
	if (indicators.length > 1 || indicators.some(handle => handle.indicatorStroke !== chrome.colors.geometryStrong)) {
		throw new Error(`Canvas card showed more than one neutral corner indicator during ${phase}: ${JSON.stringify({ indicators, geometryStrong: chrome.colors.geometryStrong })}`);
	}
}

export function assertCanvasCardHasRoundedCornerResizeTargets(chrome, phase) {
	const cursors = {
		'top-left': 'nwse-resize',
		'top-right': 'nesw-resize',
		'bottom-left': 'nesw-resize',
		'bottom-right': 'nwse-resize'
	};
	const corners = chrome.resizeHandles.map(handle => handle.corner).sort();
	const invalid = chrome.resizeHandles.filter(handle => !handle.interactive
		|| handle.painted
		|| handle.arcSamples.some(sample => sample.cursor !== cursors[handle.corner])
		|| !handle.insideBelongsToCard
		|| handle.beyondBandIsTarget);
	const misplacedSides = chrome.resizeLines.filter(line => !line.coversOnlyStraightSide);
	if (JSON.stringify(corners) !== JSON.stringify(['bottom-left', 'bottom-right', 'top-left', 'top-right'])
		|| invalid.length > 0
		|| misplacedSides.length > 0) {
		throw new Error(`Canvas card did not expose rounded corner and straight side resize targets during ${phase}: ${JSON.stringify({ corners, invalid, misplacedSides })}`);
	}
}

/**
 * A point on a card's corner resize band: on the corner arc's 45° radius, a few
 * screen pixels outside the painted edge.
 */
export async function canvasCardCornerBandPoint(card, corner = 'bottom-right', outside = 4) {
	return card.evaluate((element, { corner, outside }) => {
		const rect = element.getBoundingClientRect();
		const zoom = element.offsetWidth > 0 ? rect.width / element.offsetWidth : 1;
		const radius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) * zoom;
		const [vertical, horizontal] = corner.split('-');
		const xSign = horizontal === 'right' ? 1 : -1;
		const ySign = vertical === 'bottom' ? 1 : -1;
		const distance = (radius + outside) * Math.SQRT1_2;
		return {
			x: (xSign > 0 ? rect.right - radius : rect.left + radius) + xSign * distance,
			y: (ySign > 0 ? rect.bottom - radius : rect.top + radius) + ySign * distance
		};
	}, { corner, outside });
}

export async function waitForCanvasCardCornerIndicators(page, cardPath, expectedCorners, phase) {
	try {
		await page.waitForFunction(({ path, expected }) => {
			const card = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"]`);
			const node = card?.closest('.react-flow__node');
			if (!node) {
				return false;
			}
			const handles = Array.from(node.querySelectorAll('.basehalf-canvas-node-resizer-handle'));
			return handles.length === 4 && handles.every(handle => {
				const corner = `${handle.classList.contains('top') ? 'top' : 'bottom'}-${handle.classList.contains('left') ? 'left' : 'right'}`;
				const indicator = handle.querySelector('.basehalf-canvas-node-resize-corner-indicator');
				const opacity = indicator ? getComputedStyle(indicator).opacity : '0';
				return opacity === (expected.includes(corner) ? '1' : '0');
			});
		}, { path: cardPath, expected: expectedCorners }, { timeout: 3_000 });
	} catch (error) {
		throw new Error(`Corner indicators of ${cardPath} did not settle to ${JSON.stringify(expectedCorners)} ${phase}: ${error instanceof Error ? error.message : String(error)}`);
	}
}
