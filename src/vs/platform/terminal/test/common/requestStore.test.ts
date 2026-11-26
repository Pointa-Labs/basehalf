/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { fail, strictEqual } from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { TestInstantiationService } from '../../../instantiation/test/common/instantiationServiceMock.js';
import { ConsoleLogger, ILogService } from '../../../log/common/log.js';
import { LogService } from '../../../log/common/logService.js';
import { RequestStore } from '../../common/requestStore.js';

suite('RequestStore', () => {
	let instantiationService: TestInstantiationService;

	setup(() => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(ILogService, new LogService(new ConsoleLogger()));
	});

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('should resolve requests', async () => {
		const requestStore: RequestStore<{ data: string }, { arg: string }> = store.add(instantiationService.createInstance(RequestStore<{ data: string }, { arg: string }>, undefined));
		let eventArgs: { requestId: number; arg: string } | undefined;
		store.add(requestStore.onCreateRequest(e => eventArgs = e));
		const request = requestStore.createRequest({ arg: 'foo' });
		strictEqual(typeof eventArgs?.requestId, 'number');
		strictEqual(eventArgs?.arg, 'foo');
		requestStore.acceptReply(eventArgs.requestId, { data: 'bar' });
		const result = await request;
		strictEqual(result.data, 'bar');
	});

	test('should reject the promise when the request times out', async () => {
		const requestStore: RequestStore<{ data: string }, { arg: string }> = store.add(instantiationService.createInstance(RequestStore<{ data: string }, { arg: string }>, 1));
		const request = requestStore.createRequest({ arg: 'foo' });
		let threw = false;
		try {
			await request;
		} catch (e) {
			threw = true;
		}
		if (!threw) {
			fail();
		}
	});

	test('returns the same request identity emitted to responders', async () => {
		const requestStore: RequestStore<string, { arg: string }> = store.add(instantiationService.createInstance(RequestStore<string, { arg: string }>, undefined));
		let emittedRequestId: number | undefined;
		store.add(requestStore.onCreateRequest(event => emittedRequestId = event.requestId));
		const request = requestStore.createRequestWithId({ arg: 'foo' });
		strictEqual(request.requestId, emittedRequestId);
		requestStore.acceptReply(request.requestId, 'done');
		strictEqual(await request.promise, 'done');
	});
});
