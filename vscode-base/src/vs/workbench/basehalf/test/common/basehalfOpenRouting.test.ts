/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import {
	BaseHalfNavigationResult,
	IBaseHalfActiveCanvasEditor,
	IBaseHalfCanvasNavigationService,
	IBaseHalfCanvasNavigationState,
	IBaseHalfOpenResourceOptions
} from '../../common/basehalfCanvasNavigation.js';
import {
	getBaseHalfOpenRoutingDecision,
	shouldFallbackToVSCodeEditorAfterBaseHalfRouting,
	shouldRouteSingleResourceThroughBaseHalf,
	tryOpenBaseHalfResource
} from '../../common/basehalfOpenRouting.js';

suite('BaseHalfOpenRouting', () => {
	test('routes normal workspace opens into BaseHalf navigation options', async () => {
		const service = new TestCanvasNavigationService({
			handled: true,
			target: 'cardDetail',
			state: {
				resource: URI.file('/workspace/readme.md'),
				workspaceFolder: URI.file('/workspace'),
				relativePath: 'readme.md',
				source: 'quickAccess',
				selection: { startLineNumber: 3, startColumn: 2, endLineNumber: 3, endColumn: 8 },
				preserveFocus: true,
				pinned: true,
				projection: 'rich'
			}
		});

		const result = await tryOpenBaseHalfResource(service, URI.file('/workspace/readme.md'), {
			source: 'quickAccess',
			selection: { startLineNumber: 3, startColumn: 2, endLineNumber: 3, endColumn: 8 },
			preserveFocus: true,
			pinned: true,
			projection: 'rich'
		});

		assert.strictEqual(result.handled, true);
		assert.strictEqual(service.opened.length, 1);
		assert.strictEqual(service.opened[0].resource.fsPath, '/workspace/readme.md');
		assert.deepStrictEqual(service.opened[0].options, {
			source: 'quickAccess',
			selection: { startLineNumber: 3, startColumn: 2, endLineNumber: 3, endColumn: 8 },
			preserveFocus: true,
			pinned: true,
			projection: 'rich'
		});
	});

	test('normalizes side-by-side opens into BaseHalf navigation', async () => {
		const service = new TestCanvasNavigationService({
			handled: true,
			target: 'cardDetail',
			state: {
				resource: URI.file('/workspace/readme.md'),
				workspaceFolder: URI.file('/workspace'),
				relativePath: 'readme.md',
				source: 'explorer',
				projection: 'rich'
			}
		});
		const result = await tryOpenBaseHalfResource(service, URI.file('/workspace/readme.md'), {
			source: 'explorer',
			sideBySide: true
		});

		assert.strictEqual(result.handled, true);
		assert.strictEqual(service.opened.length, 1);
		assert.strictEqual(service.opened[0].options.source, 'explorer');
		assert.strictEqual('sideBySide' in service.opened[0].options, false);
	});

	test('leaves explicit VS Code editor opens to the VS Code editor path', () => {
		assert.deepStrictEqual(getBaseHalfOpenRoutingDecision({
			source: 'fileCommand',
			forceVSCodeEditor: true
		}), {
			route: 'vscode',
			reason: 'forcedVSCodeEditor'
		});
	});

	test('routes only single resource activations through BaseHalf', () => {
		assert.strictEqual(shouldRouteSingleResourceThroughBaseHalf(0), false);
		assert.strictEqual(shouldRouteSingleResourceThroughBaseHalf(1), true);
		assert.strictEqual(shouldRouteSingleResourceThroughBaseHalf(2), false);
	});

	test('returns navigation fallback reasons without hiding them', async () => {
		const service = new TestCanvasNavigationService({ handled: false, reason: 'missingOrUnreadable' });

		const result = await tryOpenBaseHalfResource(service, URI.file('/workspace/missing.md'), {
			source: 'search'
		});

		assert.deepStrictEqual(result, { handled: false, reason: 'missingOrUnreadable' });
		assert.strictEqual(service.opened.length, 1);
	});

	test('falls back to VS Code editor only for explicit editor-compatible reasons', () => {
		assert.strictEqual(shouldFallbackToVSCodeEditorAfterBaseHalfRouting({
			handled: true,
			target: 'cardDetail',
			state: {
				resource: URI.file('/workspace/readme.md'),
				workspaceFolder: URI.file('/workspace'),
				relativePath: 'readme.md',
				source: 'quickAccess',
				projection: 'source'
			}
		}), false);
		assert.strictEqual(shouldFallbackToVSCodeEditorAfterBaseHalfRouting({ handled: false, reason: 'forcedVSCodeEditor' }), true);
		assert.strictEqual(shouldFallbackToVSCodeEditorAfterBaseHalfRouting({ handled: false, reason: 'missingOrUnreadable' }), true);
		assert.strictEqual(shouldFallbackToVSCodeEditorAfterBaseHalfRouting({ handled: false, reason: 'blockedByDirtyEditor' }), false);
	});
});

class TestCanvasNavigationService implements IBaseHalfCanvasNavigationService {
	declare readonly _serviceBrand: undefined;

	readonly onDidChangeState = Event.None;
	readonly onDidChangeSurfaceActive = Event.None;
	readonly state: IBaseHalfCanvasNavigationState = {
		canvasFolder: undefined,
		cardDetail: undefined
	};
	readonly canGoBack = false;
	readonly canGoForward = false;
	readonly isSurfaceActive = false;
	activeCanvasEditor: IBaseHalfActiveCanvasEditor | undefined;

	readonly opened: Array<{ resource: URI; options: IBaseHalfOpenResourceOptions }> = [];

	constructor(private readonly result: BaseHalfNavigationResult) { }

	isResourceOpen(): boolean { return false; }
	setSurfaceActive(): void { }
	setActiveCanvasEditor(editor: IBaseHalfActiveCanvasEditor | undefined): void {
		this.activeCanvasEditor = editor;
	}
	async flushActiveEditor(): Promise<boolean> {
		return true;
	}

	async openResource(resource: URI, options: IBaseHalfOpenResourceOptions): Promise<BaseHalfNavigationResult> {
		this.opened.push({ resource, options });
		return this.result;
	}

	async openFolderCanvas(): Promise<BaseHalfNavigationResult> {
		throw new Error('Unexpected openFolderCanvas call');
	}

	async openCardDetail(): Promise<BaseHalfNavigationResult> {
		throw new Error('Unexpected openCardDetail call');
	}

	async closeCardDetail(): Promise<boolean> {
		throw new Error('Unexpected closeCardDetail call');
	}

	async goBack(): Promise<boolean> {
		throw new Error('Unexpected goBack call');
	}

	async goForward(): Promise<boolean> {
		throw new Error('Unexpected goForward call');
	}
}
