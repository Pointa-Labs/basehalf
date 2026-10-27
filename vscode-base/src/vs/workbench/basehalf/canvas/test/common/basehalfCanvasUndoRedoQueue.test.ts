/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BaseHalfCanvasUndoRedoQueue } from '../../common/basehalfCanvasUndoRedoQueue.js';

suite('BaseHalfCanvasUndoRedoQueue', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('with nothing running and nothing to do, the key goes on', () => {
		const queue = new BaseHalfCanvasUndoRedoQueue();
		let ran = false;
		assert.strictEqual(queue.take(() => false, () => { ran = true; }), false);
		assert.strictEqual(ran, false);
	});

	test('a key pressed while a step runs waits for it, then runs', async () => {
		const queue = new BaseHalfCanvasUndoRedoQueue();
		const order: string[] = [];
		const undoing = new DeferredPromise<void>();
		const undo = queue.take(() => true, async () => {
			order.push('undo starts');
			await undoing.p;
			order.push('undo ends');
		});
		const redo = queue.take(() => true, () => { order.push('redo'); });
		assert.ok(undo && redo);
		await timeout(0);
		assert.deepStrictEqual(order, ['undo starts']);
		undoing.complete();
		await undo;
		await redo;
		assert.deepStrictEqual(order, ['undo starts', 'undo ends', 'redo']);
	});

	test('while a step runs, a key is taken even when nothing could be done then, and asks again at its turn', async () => {
		const queue = new BaseHalfCanvasUndoRedoQueue();
		let canRedo = false;
		const order: string[] = [];
		const undoing = new DeferredPromise<void>();
		const undo = queue.take(() => true, async () => {
			await undoing.p;
			canRedo = true;
		});
		const redo = queue.take(() => canRedo, () => { order.push('redo'); });
		const nothing = queue.take(() => false, () => { order.push('nothing'); });
		assert.ok(undo && redo && nothing, 'the keys are taken while the undo runs');
		undoing.complete();
		await Promise.all([undo, redo, nothing]);
		assert.deepStrictEqual(order, ['redo'], 'the redo runs once there is one, and a key with nothing to do at its turn does nothing');
		assert.strictEqual(queue.take(() => false, () => { order.push('later'); }), false, 'with nothing running again, a key with nothing to do goes on');
	});

	test('a step that fails does not stop the next', async () => {
		const queue = new BaseHalfCanvasUndoRedoQueue();
		const order: string[] = [];
		const failing = queue.take(() => true, () => Promise.reject(new Error('the files changed meanwhile')));
		const next = queue.take(() => true, () => { order.push('next'); });
		assert.ok(failing && next);
		await assert.rejects(failing, /the files changed meanwhile/);
		await next;
		assert.deepStrictEqual(order, ['next']);
	});
});
