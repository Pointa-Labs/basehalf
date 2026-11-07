/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { IChannelServer, ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { BASEHALF_PASTEBOARD_CHANNEL } from '../../../../platform/basehalfClipboard/common/basehalfPasteboard.js';
import { BaseHalfPasteboardService } from '../../../../platform/basehalfClipboard/node/basehalfPasteboardService.js';
import { BASEHALF_FILE_CLONES_CHANNEL } from '../../../../platform/basehalfFiles/common/basehalfFileClones.js';
import { BASEHALF_FILE_LINKS_CHANNEL } from '../../../../platform/basehalfFiles/common/basehalfFileLinks.js';
import { BASEHALF_FILE_TIMES_CHANNEL } from '../../../../platform/basehalfFiles/common/basehalfFileTimes.js';
import { BaseHalfFileClonesService } from '../../../../platform/basehalfFiles/node/basehalfFileClonesService.js';
import { BaseHalfFileLinksService } from '../../../../platform/basehalfFiles/node/basehalfFileLinksService.js';
import { BaseHalfFileTimesService } from '../../../../platform/basehalfFiles/node/basehalfFileTimesService.js';
import { BaseHalfProviderChannel } from '../../../../platform/basehalfProviders/common/basehalfProviderChannel.js';
import { BASEHALF_PROVIDERS_CHANNEL, IBaseHalfProviderService } from '../../../../platform/basehalfProviders/common/basehalfProviders.js';
import { BaseHalfProviderService } from '../../../../platform/basehalfProviders/electron-utility/basehalfProviderService.js';

// BaseHalf's part of the shared process, which every window reaches: VS Code's
// sharedProcessMain.ts calls each function below once (code-organization.md).

/** The services of BaseHalf's that run in the shared process. */
export function registerBaseHalfSharedProcessServices(services: ServiceCollection): void {
	// The provider service of generation cards (D75).
	services.set(IBaseHalfProviderService, new SyncDescriptor(BaseHalfProviderService, undefined, true));
}

/** The channels by which a window reaches BaseHalf's services in the shared process. */
export function registerBaseHalfSharedProcessChannels(server: IChannelServer<string>, accessor: ServicesAccessor, disposables: DisposableStore): void {
	// The provider service of generation cards (D75).
	server.registerChannel(BASEHALF_PROVIDERS_CHANNEL, new BaseHalfProviderChannel(accessor.get(IBaseHalfProviderService)));
	// The times of files that a step of undo sets, which a window cannot (D82).
	server.registerChannel(BASEHALF_FILE_TIMES_CHANNEL, ProxyChannel.fromService(new BaseHalfFileTimesService(), disposables));
	// The links that install the agent skill, which a window cannot make (D83).
	server.registerChannel(BASEHALF_FILE_LINKS_CHANNEL, ProxyChannel.fromService(new BaseHalfFileLinksService(), disposables));
	// The clones that keep the original of an edited file, which a window cannot make (D84).
	server.registerChannel(BASEHALF_FILE_CLONES_CHANNEL, ProxyChannel.fromService(new BaseHalfFileClonesService(), disposables));
	// The write of the clipboard in several forms at once, which a window cannot make (D104).
	server.registerChannel(BASEHALF_PASTEBOARD_CHANNEL, ProxyChannel.fromService(new BaseHalfPasteboardService(), disposables));
}
