/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IBaseHalfCanvasNavigationService, IBaseHalfCanvasNavigationState } from '../../common/basehalfCanvasNavigation.js';
import { baseHalfShownCanvasFolder, baseHalfShownFile, onDidChangeBaseHalfShownPlace } from '../../common/basehalfShownPlace.js';

suite('BaseHalf: the shown place', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	const WORKSPACE = URI.file('/workspace');
	const FOLDER = URI.file('/workspace/drafts');
	const NOTE = URI.file('/workspace/drafts/plan.md');

	class TestNavigation extends mock<IBaseHalfCanvasNavigationService>() {
		readonly didChangeState = new Emitter<IBaseHalfCanvasNavigationState>();
		readonly didChangeSurfaceActive = new Emitter<boolean>();
		override readonly onDidChangeState = this.didChangeState.event;
		override readonly onDidChangeSurfaceActive = this.didChangeSurfaceActive.event;
		override isSurfaceActive = true;
		override state: IBaseHalfCanvasNavigationState = { canvasFolder: undefined, cardDetail: undefined };
	}

	function navigation(): TestNavigation {
		const service = new TestNavigation();
		store.add(service.didChangeState);
		store.add(service.didChangeSurfaceActive);
		return service;
	}

	const canvas: IBaseHalfCanvasNavigationState = {
		canvasFolder: { resource: FOLDER, workspaceFolder: WORKSPACE, relativePath: 'drafts', source: 'explorer' },
		cardDetail: undefined
	};
	const cardDetail: IBaseHalfCanvasNavigationState = {
		canvasFolder: canvas.canvasFolder,
		cardDetail: { resource: NOTE, workspaceFolder: WORKSPACE, relativePath: 'drafts/plan.md', source: 'quickAccess', projection: 'rich' }
	};

	test('a canvas shows a folder and no file, Card Detail a file over its canvas, and an editor of the base over the canvas neither', () => {
		const service = navigation();
		const read = () => ({ file: baseHalfShownFile(service)?.path, folder: baseHalfShownCanvasFolder(service)?.path });
		const nothing = read();
		service.state = canvas;
		const onCanvas = read();
		service.state = cardDetail;
		const inCardDetail = read();
		service.isSurfaceActive = false;
		const covered = read();
		assert.deepStrictEqual({ nothing, onCanvas, inCardDetail, covered }, {
			nothing: { file: undefined, folder: undefined },
			onCanvas: { file: undefined, folder: '/workspace/drafts' },
			inCardDetail: { file: '/workspace/drafts/plan.md', folder: '/workspace/drafts' },
			covered: { file: undefined, folder: undefined }
		});
	});

	test('another file, another folder, and an editor that comes or goes over the canvas are told, and another view of the same file is not', () => {
		const service = navigation();
		const listeners = store.add(new DisposableStore());
		const told: string[] = [];
		const change = (what: string, state: IBaseHalfCanvasNavigationState, surfaceActive = true) => {
			const before = told.length;
			service.state = state;
			if (service.isSurfaceActive !== surfaceActive) {
				service.isSurfaceActive = surfaceActive;
				service.didChangeSurfaceActive.fire(surfaceActive);
			} else {
				service.didChangeState.fire(state);
			}
			if (told.length === before) {
				told.push(`${what}: not told`);
			}
		};
		listeners.add(onDidChangeBaseHalfShownPlace(service)(() => told.push('told')));
		change('a canvas', canvas);
		change('a file over it', cardDetail);
		change('the same file in Source', { canvasFolder: cardDetail.canvasFolder, cardDetail: { ...cardDetail.cardDetail!, projection: 'source' } });
		change('an editor of the base over it', cardDetail, false);
		change('the editor gone', cardDetail);
		change('the canvas again', canvas);
		listeners.clear();
		service.state = cardDetail;
		service.didChangeState.fire(cardDetail);
		assert.deepStrictEqual(told, ['told', 'told', 'the same file in Source: not told', 'told', 'told', 'told']);
	});
});
