/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../base/common/event.js';
import { ipcRenderer } from '../../../base/parts/sandbox/electron-browser/globals.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { ISharedProcessService } from '../../ipc/electron-browser/services.js';
import { BaseHalfProviderChannelClient } from '../common/basehalfProviderChannel.js';
import { BaseHalfProviderConnection } from '../common/basehalfProviderConnection.js';
import { BASEHALF_PROVIDERS_CHANNEL, BASEHALF_SHARED_PROCESS_STOPPED_CHANNEL, IBaseHalfProviderService } from '../common/basehalfProviders.js';

/**
 * The window calls the provider service of the shared process directly (D75),
 * and learns from the main process that the shared process stopped.
 */
class BaseHalfProviderServiceClient extends BaseHalfProviderConnection {

	constructor(@ISharedProcessService sharedProcessService: ISharedProcessService) {
		const stopped = new Emitter<void>();
		ipcRenderer.on(BASEHALF_SHARED_PROCESS_STOPPED_CHANNEL, () => stopped.fire());
		super(
			new BaseHalfProviderChannelClient(sharedProcessService.getChannel(BASEHALF_PROVIDERS_CHANNEL)),
			stopped.event,
			ipcRenderer.invoke(BASEHALF_SHARED_PROCESS_STOPPED_CHANNEL).then(value => value === true)
		);
		this._register(stopped);
	}
}

registerSingleton(IBaseHalfProviderService, BaseHalfProviderServiceClient, InstantiationType.Delayed);
