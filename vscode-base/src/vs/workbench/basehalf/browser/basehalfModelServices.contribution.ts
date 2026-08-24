/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../platform/notification/common/notification.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { IPreferencesService } from '../../services/preferences/common/preferences.js';
import { settingsCustomSectionRegistry } from '../../contrib/preferences/browser/settingsCustomSections.js';
import { IBaseHalfCanvasNavigationService } from '../common/basehalfCanvasNavigation.js';
import {
	IBaseHalfModelConnectionNavigationService,
	IBaseHalfVideoModelConnectionReturnTarget
} from '../common/basehalfModelConnectionNavigation.js';
import {
	BASEHALF_CONFIGURE_MODEL_SERVICE_COMMAND_ID,
	BASEHALF_MANAGE_MODEL_SERVICES_COMMAND_ID,
	IBaseHalfModelServiceService
} from '../common/basehalfModelServices.js';
import {
	BASEHALF_MODEL_CONNECTIONS_SETTINGS_SECTION_ID,
	BaseHalfModelConnectionsView
} from './basehalfModelConnections.js';

settingsCustomSectionRegistry.register({
	id: BASEHALF_MODEL_CONNECTIONS_SETTINGS_SECTION_ID,
	create: instantiationService => instantiationService.createInstance(BaseHalfModelConnectionsView)
});

class BaseHalfModelServiceSecretCleanupContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.basehalf.modelServiceSecretCleanup';

	constructor(
		@IBaseHalfModelServiceService _modelServices: IBaseHalfModelServiceService
	) {
		// Instantiating the application-global service at startup captures legacy
		// credential tombstones before configuration migration removes their IDs.
	}
}

registerWorkbenchContribution2(
	BaseHalfModelServiceSecretCleanupContribution.ID,
	BaseHalfModelServiceSecretCleanupContribution,
	WorkbenchPhase.BlockStartup
);

registerAction2(class ManageBaseHalfModelServicesAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_MANAGE_MODEL_SERVICES_COMMAND_ID,
			title: localize2('basehalf.models.manage', 'Models & Providers'),
			category: localize2('basehalf.category', 'BaseHalf'),
			f1: true,
			menu: {
				id: MenuId.MenubarPreferencesMenu,
				group: '2_configuration',
				order: 20
			}
		});
	}

	override run(accessor: ServicesAccessor): Promise<void> {
		return openModelConnections(accessor);
	}
});

registerAction2(class ConfigureBaseHalfModelServiceAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_CONFIGURE_MODEL_SERVICE_COMMAND_ID,
			title: localize2('basehalf.models.configure', 'Configure Official Model Provider'),
			category: localize2('basehalf.category', 'BaseHalf'),
			f1: false
		});
	}

	override run(accessor: ServicesAccessor, argument?: unknown): Promise<void> {
		const parsed = parseConfigureArgument(argument);
		return openModelConnections(accessor, parsed?.specId, parsed?.returnTarget);
	}
});

async function openModelConnections(
	accessor: ServicesAccessor,
	specId?: string,
	returnTarget?: IBaseHalfVideoModelConnectionReturnTarget
): Promise<void> {
	const canvasNavigationService = accessor.get(IBaseHalfCanvasNavigationService);
	const notificationService = accessor.get(INotificationService);
	// ServicesAccessor is scoped to the synchronous command invocation. Capture
	// every dependency before the first await so the locked-model route can
	// safely flush its Draft and then open the inline editor.
	const navigation = accessor.get(IBaseHalfModelConnectionNavigationService);
	const preferencesService = accessor.get(IPreferencesService);
	if (!await canvasNavigationService.flushActiveEditor()) {
		notificationService.warn(localize('basehalf.models.resolveDraftFirst', 'Resolve the current canvas draft before opening Models & Providers.'));
		return;
	}
	const intent = specId && returnTarget ? navigation.begin(specId, returnTarget) : undefined;
	try {
		await preferencesService.openSettings({ jsonEditor: false });
		settingsCustomSectionRegistry.request(BASEHALF_MODEL_CONNECTIONS_SETTINGS_SECTION_ID, specId);
	} catch (error) {
		if (intent) {
			navigation.cancel(intent.requestId);
		}
		throw error;
	}
}

interface IBaseHalfConfigureModelConnectionArgument {
	readonly specId: string;
	readonly returnTarget?: IBaseHalfVideoModelConnectionReturnTarget;
}

function parseConfigureArgument(value: unknown): IBaseHalfConfigureModelConnectionArgument | undefined {
	if (typeof value === 'string' && value.trim()) {
		return { specId: value.trim().toLowerCase() };
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const candidate = value as Record<string, unknown>;
	if (typeof candidate.specId !== 'string' || !candidate.specId.trim()) {
		return undefined;
	}
	const directTarget = parseVideoReturnTarget(candidate.returnTarget);
	const flattenedTarget = parseVideoReturnTarget(candidate);
	return {
		specId: candidate.specId.trim().toLowerCase(),
		...(directTarget ?? flattenedTarget ? { returnTarget: (directTarget ?? flattenedTarget)! } : {})
	};
}

function parseVideoReturnTarget(value: unknown): IBaseHalfVideoModelConnectionReturnTarget | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const candidate = value as Record<string, unknown>;
	const modelKey = candidate.modelKey;
	if (candidate.kind !== undefined && candidate.kind !== 'videoModel') {
		return undefined;
	}
	if (typeof candidate.sceneKey !== 'string' || !candidate.sceneKey
		|| typeof candidate.nodePath !== 'string' || !candidate.nodePath
		|| typeof candidate.documentId !== 'string' || !candidate.documentId
		|| typeof candidate.recipeId !== 'string' || !candidate.recipeId
		|| typeof candidate.catalogId !== 'string' || !candidate.catalogId
		|| !modelKey || typeof modelKey !== 'object' || Array.isArray(modelKey)) {
		return undefined;
	}
	const key = modelKey as Record<string, unknown>;
	if (typeof key.provider !== 'string' || typeof key.deployment !== 'string'
		|| typeof key.region !== 'string' || typeof key.modelId !== 'string' || typeof key.revision !== 'string') {
		return undefined;
	}
	return Object.freeze({
		kind: 'videoModel',
		sceneKey: candidate.sceneKey,
		nodePath: candidate.nodePath,
		documentId: candidate.documentId,
		recipeId: candidate.recipeId,
		catalogId: candidate.catalogId,
		modelKey: Object.freeze({
			provider: key.provider,
			deployment: key.deployment,
			region: key.region,
			modelId: key.modelId,
			revision: key.revision
		})
	});
}
