/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { baseHalfCanvasInlineEditKeyAction } from '../../common/basehalfCanvasEditing.js';

suite('BaseHalfCanvasEditing', () => {
	test('maps ordinary commit and cancel keys', () => {
		assert.strictEqual(baseHalfCanvasInlineEditKeyAction(keyEvent('Enter')), 'accept');
		assert.strictEqual(baseHalfCanvasInlineEditKeyAction(keyEvent('Escape')), 'cancel');
		assert.strictEqual(baseHalfCanvasInlineEditKeyAction(keyEvent('a')), undefined);
	});

	test('leaves composition keys to the input method', () => {
		assert.strictEqual(baseHalfCanvasInlineEditKeyAction(keyEvent('Enter', true)), undefined);
		assert.strictEqual(baseHalfCanvasInlineEditKeyAction({ key: 'Enter', isComposing: false, keyCode: 229 }), undefined);
		assert.strictEqual(baseHalfCanvasInlineEditKeyAction({ key: 'Escape', isComposing: true, keyCode: 229 }), 'cancel');
	});
});

function keyEvent(key: string, isComposing = false): { readonly key: string; readonly isComposing: boolean; readonly keyCode: number } {
	return { key, isComposing, keyCode: key === 'Enter' ? 13 : key === 'Escape' ? 27 : 0 };
}
