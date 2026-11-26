/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BaseHalfCanvasCardDetailHost } from '../../browser/view/basehalfCanvasCardDetailHost.js';
import type { BaseHalfCanvasWorkbenchContribution } from '../../browser/basehalfCanvasWorkbench.contribution.js';

suite('BaseHalfCanvasCardDetailHost', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	/**
	 * The canvas view as the host's reconcile sees it: Card Detail open on a
	 * note in Rich, and no projection registered any more, as when the
	 * contribution that registered them is disposed.
	 */
	function createHost(willShutdown: boolean) {
		const opened: string[] = [];
		const view = {
			disposed: false,
			register: <T extends IDisposable>(disposable: T): T => store.add(disposable),
			lifecycleService: { willShutdown },
			canvasNavigationService: {
				state: { cardDetail: { resource: URI.file('/workspace/note.md'), projection: 'rich' } },
				openCardDetail: async (_resource: URI, options: { readonly projection: string }) => { opened.push(options.projection); }
			},
			cardProjectionRegistryService: { normalizeProjection: (_resource: URI, projection: string) => projection },
			cardDetailSurfaceRegistryService: { hasProvider: () => false },
			requestRender: () => { }
		};
		return { host: new BaseHalfCanvasCardDetailHost(view as unknown as BaseHalfCanvasWorkbenchContribution), opened };
	}

	test('a projection that goes while the window runs shows the file in Source, and one that goes while it shuts down opens nothing', () => {
		const running = createHost(false);
		running.host.reconcileCardProjectionRegistrations();
		const shuttingDown = createHost(true);
		shuttingDown.host.reconcileCardProjectionRegistrations();
		assert.deepStrictEqual({ running: running.opened, shuttingDown: shuttingDown.opened }, { running: ['source'], shuttingDown: [] });
	});
});
