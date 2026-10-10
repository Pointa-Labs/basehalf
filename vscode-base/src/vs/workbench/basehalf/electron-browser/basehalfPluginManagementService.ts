/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IChecksumService } from '../../../platform/checksum/common/checksumService.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';
import { INativeEnvironmentService } from '../../../platform/environment/common/environment.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IProductService } from '../../../platform/product/common/productService.js';
import { IRequestService } from '../../../platform/request/common/request.js';
import { IExtensionsWorkbenchService } from '../../contrib/extensions/common/extensions.js';
import { IWorkbenchExtensionEnablementService, IWorkbenchExtensionManagementService } from '../../services/extensionManagement/common/extensionManagement.js';
import { IBaseHalfPluginAdmissionService } from '../common/basehalfPluginAdmissionService.js';
import { IBaseHalfPluginCatalogService } from '../common/basehalfPluginCatalogService.js';
import { IBaseHalfPluginManagementService } from '../common/basehalfPluginManagement.js';
import { BaseHalfPluginManagementService } from '../common/basehalfPluginManagementService.js';

/** Plugin management for the desktop workbench: downloads are staged in the
 * machine's temporary directory. */
class NativeBaseHalfPluginManagementService extends BaseHalfPluginManagementService {

	constructor(
		@IBaseHalfPluginCatalogService catalogService: IBaseHalfPluginCatalogService,
		@IWorkbenchExtensionManagementService extensionManagementService: IWorkbenchExtensionManagementService,
		@IWorkbenchExtensionEnablementService enablementService: IWorkbenchExtensionEnablementService,
		@IExtensionsWorkbenchService extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IFileService fileService: IFileService,
		@IRequestService requestService: IRequestService,
		@IChecksumService checksumService: IChecksumService,
		@INativeEnvironmentService environmentService: INativeEnvironmentService,
		@IProductService productService: IProductService,
		@ICommandService commandService: ICommandService,
		@ILogService logService: ILogService,
		@IBaseHalfPluginAdmissionService pluginAdmissionService: IBaseHalfPluginAdmissionService
	) {
		super(
			environmentService.tmpDir,
			catalogService,
			extensionManagementService,
			enablementService,
			extensionsWorkbenchService,
			fileService,
			requestService,
			checksumService,
			environmentService,
			productService,
			commandService,
			logService,
			pluginAdmissionService
		);
	}
}

registerSingleton(IBaseHalfPluginManagementService, NativeBaseHalfPluginManagementService, InstantiationType.Delayed);
