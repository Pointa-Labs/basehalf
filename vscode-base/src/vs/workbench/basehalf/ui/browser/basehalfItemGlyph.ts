/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfItemGlyph.css';
import { $ } from '../../../../base/browser/dom.js';
import { BaseHalfAgentSelectionIcon } from '../../agentArea/common/basehalfAgentSelection.js';

/**
 * The glyphs BaseHalf draws for items: the kind of a card in its caption, the
 * badge toggle, the cover toggle of a PDF or a book, and the status bar entry
 * of the selection agents can see, which draws a card's kind exactly as its
 * caption does.
 */
export type BaseHalfItemGlyph = BaseHalfAgentSelectionIcon | 'badge' | 'coverShown' | 'coverHidden';

/** Appends a glyph drawn with lines of the current colour, in `tone`, `size` wide and high. */
export function renderBaseHalfItemGlyph(container: Element, type: BaseHalfItemGlyph, tone: string, size: number | string): void {
	const dim = typeof size === 'number' ? `${size}px` : size;
	const svg = $.SVG('svg');
	svg.classList.add('basehalf-file-glyph');
	svg.setAttribute('viewBox', '0 0 16 16');
	svg.setAttribute('fill', 'none');
	svg.setAttribute('stroke', 'currentColor');
	svg.setAttribute('stroke-width', '1.25');
	svg.setAttribute('stroke-linecap', 'round');
	svg.setAttribute('stroke-linejoin', 'round');
	svg.setAttribute('aria-hidden', 'true');
	svg.style.width = dim;
	svg.style.height = dim;
	svg.style.color = tone;
	renderGlyphPath(svg, type);
	container.appendChild(svg);
}

function renderGlyphPath(svg: SVGElement, type: BaseHalfItemGlyph): void {
	const appendPath = (d: string) => {
		const path = $.SVG('path');
		path.setAttribute('d', d);
		svg.appendChild(path);
	};
	if (type === 'cards') {
		const rect = $.SVG('rect');
		rect.setAttribute('x', '2.5');
		rect.setAttribute('y', '5.5');
		rect.setAttribute('width', '8.5');
		rect.setAttribute('height', '8');
		rect.setAttribute('rx', '1.4');
		svg.appendChild(rect);
		appendPath('M5 3h7a1.5 1.5 0 0 1 1.5 1.5V11');
		return;
	}
	if (type === 'selectedText') {
		appendPath('M2.5 12.5L5.5 4l3 8.5M3.6 9.6h3.8');
		appendPath('M11.5 3.5v9M10 3.5h3M10 12.5h3');
		return;
	}
	if (type === 'text') {
		appendPath('M3.5 4h9M3.5 7h9M3.5 10h9M3.5 13h5.5');
		return;
	}
	if (type === 'image') {
		const rect = $.SVG('rect');
		rect.setAttribute('x', '2.5');
		rect.setAttribute('y', '3');
		rect.setAttribute('width', '11');
		rect.setAttribute('height', '10');
		rect.setAttribute('rx', '1.6');
		svg.appendChild(rect);
		const circle = $.SVG('circle');
		circle.setAttribute('cx', '5.8');
		circle.setAttribute('cy', '6.3');
		circle.setAttribute('r', '1.1');
		svg.appendChild(circle);
		appendPath('M3 12l3-3 2.3 2.3L11 8l2.2 2.2');
		return;
	}
	if (type === 'audio') {
		appendPath('M4 7v2M6.5 4.8v6.4M9 3.2v9.6M11.5 5.6v4.8');
		return;
	}
	if (type === 'video') {
		const rect = $.SVG('rect');
		rect.setAttribute('x', '2.5');
		rect.setAttribute('y', '3.5');
		rect.setAttribute('width', '11');
		rect.setAttribute('height', '9');
		rect.setAttribute('rx', '1.6');
		svg.appendChild(rect);
		const path = $.SVG('path');
		path.setAttribute('d', 'M6.8 6.3l3 1.7-3 1.7z');
		path.setAttribute('fill', 'currentColor');
		path.setAttribute('stroke', 'none');
		svg.appendChild(path);
		return;
	}
	if (type === 'pdf' || type === 'presentation' || type === 'file' || type === 'generic') {
		appendPath('M4 2.5h4.5l3 3V13H4z');
		appendPath('M8.5 2.5v3h3');
		if (type === 'pdf' || type === 'presentation') {
			appendPath('M5.8 9h4M5.8 11h4');
		}
		return;
	}
	if (type === 'code') {
		appendPath('M6 5L3 8l3 3M10 5l3 3-3 3');
		return;
	}
	if (type === 'book') {
		// An open book: two pages that meet at the spine.
		appendPath('M8 4.6C6.8 3.7 5 3.3 2.5 3.4v8.8c2.5-.1 4.3.3 5.5 1.2');
		appendPath('M8 4.6c1.2-.9 3-1.3 5.5-1.2v8.8c-2.5-.1-4.3.3-5.5 1.2z');
		return;
	}
	if (type === 'coverShown' || type === 'coverHidden') {
		// An eye, crossed out while the cover is hidden.
		appendPath('M1.8 8C3.3 5.4 5.4 4 8 4s4.7 1.4 6.2 4c-1.5 2.6-3.6 4-6.2 4S3.3 10.6 1.8 8z');
		const pupil = $.SVG('circle');
		pupil.setAttribute('cx', '8');
		pupil.setAttribute('cy', '8');
		pupil.setAttribute('r', '1.8');
		svg.appendChild(pupil);
		if (type === 'coverHidden') {
			appendPath('M3 13L13 3');
		}
		return;
	}
	if (type === 'badge') {
		appendPath('M6 2.5h4M7 2.5v2M9 2.5v2');
		const rect = $.SVG('rect');
		rect.setAttribute('x', '3.5');
		rect.setAttribute('y', '4.4');
		rect.setAttribute('width', '9');
		rect.setAttribute('height', '9');
		rect.setAttribute('rx', '1.5');
		svg.appendChild(rect);
		const circle = $.SVG('circle');
		circle.setAttribute('cx', '6.4');
		circle.setAttribute('cy', '8');
		circle.setAttribute('r', '1');
		svg.appendChild(circle);
		appendPath('M8.6 7.4h2.2M8.6 9.5h2.5M5.4 11.7h5.2');
		return;
	}
	appendPath('M2.5 4.7a1 1 0 0 1 1-1h2.7a1 1 0 0 1 .72.3l.86.9a1 1 0 0 0 .72.3h4a1 1 0 0 1 1 1v5.3a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z');
}
