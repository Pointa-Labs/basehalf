/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Event } from '../../../base/common/event.js';
import { IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { IBaseHalfProviderService } from './basehalfProviders.js';
import type { CheckPayload, DownloadRequest, PlaceRequest, SubmitPayload, TaskRef } from './basehalfProviderTypes.js';

/**
 * The channel of the provider service in the shared process (D75). Unlike one
 * made with `ProxyChannel.fromService`, it gives a call that sends requests
 * its cancellation, which ends when the window that made the call closes or
 * reloads: a call belongs to its window (providers, "Requests"). A window
 * calls it as `ProxyChannel.toService` does, with the call's arguments as an
 * array.
 */
export class BaseHalfProviderChannel implements IServerChannel<string> {

	constructor(private readonly service: IBaseHalfProviderService) { }

	listen<T>(_context: string, event: string): Event<T> {
		throw new Error(`The provider service has no event '${event}'.`);
	}

	async call<T>(_context: string, command: string, args?: unknown, token: CancellationToken = CancellationToken.None): Promise<T> {
		const argument: unknown = Array.isArray(args) ? args[0] : undefined;
		switch (command) {
			case 'catalog': return await this.service.catalog() as T;
			case 'check': return await this.service.check(argument as CheckPayload) as T;
			case 'submit': return await this.service.submit(argument as SubmitPayload, token) as T;
			case 'poll': return await this.service.poll(argument as TaskRef, token) as T;
			case 'download': return await this.service.download(argument as DownloadRequest, token) as T;
			case 'cancel': return await this.service.cancel(argument as TaskRef, token) as T;
			case 'place': return await this.service.place(argument as PlaceRequest) as T;
		}
		throw new Error(`The provider service has no call '${command}'.`);
	}
}
