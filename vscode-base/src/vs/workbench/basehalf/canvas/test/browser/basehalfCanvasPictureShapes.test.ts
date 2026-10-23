/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { URI } from '../../../../../base/common/uri.js';
import { runWithFakedTimers } from '../../../../../base/test/common/timeTravelScheduler.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BaseHalfCanvasPictureShapes, IBaseHalfCanvasPicture, IBaseHalfCanvasPictureMeasurer } from '../../browser/basehalfCanvasPictureShapes.js';

suite('BaseHalfCanvasPictureShapes', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	/** A measurer whose answers the test gives: each measurement waits for `answer`. */
	function fakeMeasurer(): IBaseHalfCanvasPictureMeasurer & { readonly asked: string[]; answer(path: string, ratio: number | undefined): void; readonly running: () => number } {
		const asked: string[] = [];
		const pending = new Map<string, DeferredPromise<number | undefined>>();
		let running = 0;
		return {
			asked,
			running: () => running,
			measure(picture) {
				asked.push(`${picture.resource.path}@${picture.version}`);
				const answer = new DeferredPromise<number | undefined>();
				pending.set(picture.resource.path, answer);
				running++;
				return answer.p.finally(() => running--);
			},
			answer(path, ratio) {
				pending.get(path)?.complete(ratio);
			}
		};
	}

	const picture = (name: string, version = '1-10', kind: 'image' | 'video' = 'image'): IBaseHalfCanvasPicture => ({ resource: URI.file(`/workspace/${name}`), version, kind });
	const settle = () => new Promise(resolve => setTimeout(resolve, 0));

	test('measures each version once, keeps what it measured, says what it could not, and measures a new version again', async () => {
		const measurer = fakeMeasurer();
		const shapes = store.add(new BaseHalfCanvasPictureShapes(measurer));
		const measuring = shapes.measure([picture('wide.png'), picture('broken.png')], 1000);
		// A second drawing asks while they are measured: they are not measured twice.
		const again = shapes.measure([picture('wide.png')], 1000);
		await settle();
		measurer.answer('/workspace/wide.png', 16 / 9);
		measurer.answer('/workspace/broken.png', undefined);
		await Promise.all([measuring, again]);
		const before = [shapes.ratioOf(picture('wide.png')), shapes.ratioOf(picture('broken.png')), shapes.ratioOf(picture('wide.png', '2-20'))];
		await shapes.measure([picture('wide.png')], 1000);
		const changed = shapes.measure([picture('wide.png', '2-20')], 1000);
		await settle();
		measurer.answer('/workspace/wide.png', 9 / 16);
		await changed;
		assert.deepStrictEqual({ before, after: shapes.ratioOf(picture('wide.png', '2-20')), asked: measurer.asked }, {
			before: [16 / 9, null, undefined],
			after: 9 / 16,
			asked: ['/workspace/wide.png@1-10', '/workspace/broken.png@1-10', '/workspace/wide.png@2-20']
		});
	});

	test('measures at most six at a time', async () => {
		const measurer = fakeMeasurer();
		const shapes = store.add(new BaseHalfCanvasPictureShapes(measurer));
		const names = Array.from({ length: 8 }, (_, index) => `p${index}.png`);
		const measuring = shapes.measure(names.map(name => picture(name)), 1000);
		await settle();
		const first = measurer.running();
		measurer.answer('/workspace/p0.png', 1);
		await settle();
		const afterOne = { running: measurer.running(), asked: measurer.asked.length };
		for (const name of names) {
			measurer.answer(`/workspace/${name}`, 1);
			await settle();
		}
		await measuring;
		assert.deepStrictEqual({ first, afterOne, asked: measurer.asked.length }, { first: 6, afterOne: { running: 6, asked: 7 }, asked: 8 });
	});

	test('a drawing waits at most its wait; a picture measured after that, or without a wait, has the canvas drawn again', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const measurer = fakeMeasurer();
		const shapes = store.add(new BaseHalfCanvasPictureShapes(measurer));
		let drawnAgain = 0;
		store.add(shapes.onDidMeasure(() => drawnAgain++));
		// Measured in time: nothing more is drawn.
		const inTime = shapes.measure([picture('a.png')], 1000);
		await settle();
		measurer.answer('/workspace/a.png', 1);
		await inTime;
		const afterInTime = drawnAgain;
		// Late: the drawing goes on without it, and is drawn again once it is measured.
		const start = Date.now();
		await shapes.measure([picture('b.mp4', '1-10', 'video')], 1000);
		const waited = Date.now() - start;
		measurer.answer('/workspace/b.mp4', 16 / 9);
		await settle();
		const afterLate = drawnAgain;
		// Without a wait.
		await shapes.measure([picture('c.png')], 0);
		measurer.answer('/workspace/c.png', 3 / 4);
		await settle();
		assert.deepStrictEqual({ afterInTime, waited, afterLate, end: drawnAgain, late: shapes.ratioOf(picture('b.mp4', '1-10', 'video')) }, { afterInTime: 0, waited: 1000, afterLate: 1, end: 2, late: 16 / 9 });
	}));
});
