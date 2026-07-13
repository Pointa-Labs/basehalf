/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { BaseHalfPluginLifecycleState, IBaseHalfResolvedPlugin } from './basehalfPluginCatalog.js';
import { BaseHalfPluginCatalogSource } from './basehalfPluginCatalogService.js';

export interface IBaseHalfManagedPlugin extends IBaseHalfResolvedPlugin {
	readonly state: BaseHalfPluginLifecycleState;
	readonly installedVersion?: string;
	readonly availableVersion?: string;
	readonly bundledAvailable: boolean;
	readonly enabled: boolean;
	readonly busy: boolean;
	/** True only while the underlying operation has an active cancellation token. */
	readonly cancellable: boolean;
	readonly hasConfiguration: boolean;
	readonly error?: string;
}

export interface IBaseHalfPluginOperationResult {
	readonly restartRequired: boolean;
}

export interface IBaseHalfPluginCatalogStatus {
	readonly source: BaseHalfPluginCatalogSource;
	readonly sequence?: number;
	readonly generatedAt?: string;
	readonly error?: string;
}

export const IBaseHalfPluginManagementService = createDecorator<IBaseHalfPluginManagementService>('basehalfPluginManagementService');

export interface IBaseHalfPluginManagementService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;
	getPlugins(): Promise<readonly IBaseHalfManagedPlugin[]>;
	getCatalogStatus(): Promise<IBaseHalfPluginCatalogStatus>;
	refreshCatalog(): Promise<void>;
	install(extensionId: string): Promise<IBaseHalfPluginOperationResult>;
	update(extensionId: string): Promise<IBaseHalfPluginOperationResult>;
	enable(extensionId: string): Promise<IBaseHalfPluginOperationResult>;
	disable(extensionId: string): Promise<IBaseHalfPluginOperationResult>;
	uninstall(extensionId: string): Promise<IBaseHalfPluginOperationResult>;
	executePrimary(extensionId: string): Promise<void>;
	cancel(extensionId: string): void;
}
