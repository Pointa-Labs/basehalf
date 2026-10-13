/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../base/browser/window.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	baseHalfSidewaysScrollbarSpan,
	installBaseHalfSidewaysScrollbar,
	restoreBaseHalfSidewaysScroll
} from '../../browser/basehalfSidewaysScrollbar.js';

suite('BaseHalfSidewaysScrollbar', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let host: HTMLElement;
	let note: HTMLElement;
	/** A box 200 pixels wide that holds 800 pixels, 40 pixels below the top of the note. */
	let box: HTMLElement;
	/** Ends the time the bar is shown for. */
	let shownTimePasses: () => void;

	function element(parent: HTMLElement, className: string, style: Partial<CSSStyleDeclaration>): HTMLElement {
		const child = mainWindow.document.createElement('div');
		child.className = className;
		Object.assign(child.style, style);
		parent.appendChild(child);
		return child;
	}

	/** What the bar looks like now: whether it is shown, where it is put, and where it stands in the note. */
	function bar(): { readonly shown: boolean; readonly inNote: boolean; readonly width: string; readonly transform: string } | undefined {
		const found = host.querySelector<HTMLElement>('.basehalf-sideways-scrollbar');
		return found ? { shown: found.classList.contains('shown'), inNote: found.parentElement === note, width: found.style.width, transform: found.style.transform } : undefined;
	}

	function scrollTo(position: number): void {
		box.scrollLeft = position;
		box.dispatchEvent(new Event('scroll'));
	}

	setup(() => {
		host = element(mainWindow.document.body, 'host', { position: 'absolute', left: '0', top: '0' });
		note = element(host, 'note', { position: 'relative', width: '300px', padding: '10px' });
		element(note, 'text', { height: '40px' });
		box = element(note, 'box', { width: '200px', height: '50px', overflow: 'hidden' });
		element(box, 'columns', { width: '800px', height: '50px' });
		shownTimePasses = () => { };
		const scrollbar = installBaseHalfSidewaysScrollbar(host, {
			boxSelector: '.box',
			container: scrolled => scrolled.closest<HTMLElement>('.note'),
			afterShownTime: callback => {
				shownTimePasses = callback;
				return { dispose: () => { } };
			}
		});
		disposables.add(scrollbar);
	});

	teardown(() => host.remove());

	test('the bar says how much of a box is shown and where', () => {
		assert.deepStrictEqual({
			// A quarter of the box is shown: the bar is a quarter of its track of 196 pixels.
			atTheLeftEnd: baseHalfSidewaysScrollbarSpan({ scrollLeft: 0, scrollWidth: 800, clientWidth: 200 }),
			inTheMiddle: baseHalfSidewaysScrollbarSpan({ scrollLeft: 300, scrollWidth: 800, clientWidth: 200 }),
			atTheRightEnd: baseHalfSidewaysScrollbarSpan({ scrollLeft: 600, scrollWidth: 800, clientWidth: 200 }),
			// A bar is never too short to see.
			ofAVeryWideBox: baseHalfSidewaysScrollbarSpan({ scrollLeft: 0, scrollWidth: 20000, clientWidth: 200 }),
			ofABoxThatShowsAll: baseHalfSidewaysScrollbarSpan({ scrollLeft: 0, scrollWidth: 200, clientWidth: 200 })
		}, {
			atTheLeftEnd: { offset: 2, length: 49 },
			inTheMiddle: { offset: 75.5, length: 49 },
			atTheRightEnd: { offset: 149, length: 49 },
			ofAVeryWideBox: { offset: 2, length: 24 },
			ofABoxThatShowsAll: undefined
		});
	});

	test('the bar shows inside the lower edge of a box while the box is scrolled, and not after', () => {
		const before = { bar: bar(), height: box.offsetHeight };
		scrollTo(300);
		const during = { bar: bar(), height: box.offsetHeight };
		shownTimePasses();
		const after = { bar: bar(), height: box.offsetHeight };
		// A scroll of something that is no box shows nothing.
		note.dispatchEvent(new Event('scroll'));

		assert.deepStrictEqual({ before, during, after, onTheNote: bar()?.shown }, {
			before: { bar: undefined, height: 50 },
			// 10 pixels of padding and 75.5 along; 50 pixels of padding and text, the 50 of the box, less the bar's 6 and 2.
			during: { bar: { shown: true, inNote: true, width: '49px', transform: 'translate(85.5px, 92px)' }, height: 50 },
			after: { bar: { shown: false, inNote: true, width: '49px', transform: 'translate(85.5px, 92px)' }, height: 50 },
			onTheNote: false
		});
	});

	test('a position that is put back shows no bar, and the next scroll does', () => {
		restoreBaseHalfSidewaysScroll(box, 120);
		box.dispatchEvent(new Event('scroll'));
		const putBack = { at: box.scrollLeft, bar: bar() };
		// Putting back the position the box already has is followed by no scroll event.
		restoreBaseHalfSidewaysScroll(box, 120);
		scrollTo(130);

		assert.deepStrictEqual({ putBack, next: bar()?.shown }, { putBack: { at: 120, bar: undefined }, next: true });
	});
});
