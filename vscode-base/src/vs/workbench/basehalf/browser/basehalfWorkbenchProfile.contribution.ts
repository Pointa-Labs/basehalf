/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { RunOnceScheduler } from '../../../base/common/async.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../platform/configuration/common/configurationRegistry.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { Registry } from '../../../platform/registry/common/platform.js';
import { EditorsOrder } from '../../common/editor.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { ViewContainerLocation } from '../../common/views.js';
import { IEditorGroupsService } from '../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../services/editor/common/editorService.js';
import { ILifecycleService, LifecyclePhase } from '../../services/lifecycle/common/lifecycle.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../platform/storage/common/storage.js';
import { IViewsService } from '../../services/views/common/viewsService.js';
import { IWorkbenchLayoutService, Parts } from '../../services/layout/browser/layoutService.js';
import { BASEHALF_ACTIVE_PANEL_STORAGE_KEY, BASEHALF_ACTIVITY_PINNED_VIEW_CONTAINERS_STORAGE_KEY, BASEHALF_ACTIVITY_VIEW_CONTAINERS_WORKSPACE_STATE_STORAGE_KEY, BASEHALF_CONFIGURATION_DEFAULTS, BASEHALF_HIDDEN_VIEW_CONTAINER_IDS, BASEHALF_HIDDEN_VIEW_IDS, BASEHALF_LEFT_SIDEBAR_PINNED_VIEW_CONTAINERS, BASEHALF_LEFT_SIDEBAR_VIEW_CONTAINER_WORKSPACE_STATE, BASEHALF_PRIMARY_VIEW_CONTAINERS, BASEHALF_PRODUCT_PROFILE_ID, BASEHALF_PROFILE_STORAGE_KEYS_TO_CLEAR, BASEHALF_REMAPPED_VIEW_CONTAINER_IDS, BASEHALF_WORKSPACE_STORAGE_KEYS_TO_CLEAR, shouldBaseHalfCloseAgentExtensionViewContainer, shouldBaseHalfCloseRemappedViewContainer, shouldBaseHalfCloseStartupEditor, shouldBaseHalfHideView, shouldBaseHalfHideViewContainer, BASEHALF_AUXILIARYBAR_PINNED_VIEW_CONTAINERS, BASEHALF_AUXILIARYBAR_PINNED_VIEW_CONTAINERS_STORAGE_KEY, BASEHALF_AUXILIARYBAR_VIEW_CONTAINERS_WORKSPACE_STATE_STORAGE_KEY, BASEHALF_AUXILIARYBAR_VIEW_CONTAINER_WORKSPACE_STATE } from '../common/basehalfWorkbenchProfile.js';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerDefaultConfigurations([{
	overrides: BASEHALF_CONFIGURATION_DEFAULTS,
	source: { id: BASEHALF_PRODUCT_PROFILE_ID, displayName: 'BaseHalf' },
	preventExperimentOverride: true
}]);

class BaseHalfWorkbenchProfileContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.basehalfWorkbenchProfile';

	constructor(
		@ILogService private readonly logService: ILogService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@IEditorService private readonly editorService: IEditorService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IStorageService private readonly storageService: IStorageService,
		@IViewsService private readonly viewsService: IViewsService
	) {
		super();

		this.clearCompetingStartupStorage();
		this.applyLeftSidebarProfile();
		this.applyAuxiliaryBarProfile();
		this.registerHiddenSurfaceGuards();
		this.registerSingleSurfaceEditorGuard();
		this.closeRestoredCompetingSurfaces();
	}

	private clearCompetingStartupStorage(): void {
		for (const key of BASEHALF_PROFILE_STORAGE_KEYS_TO_CLEAR) {
			if (this.storageService.get(key, StorageScope.PROFILE) !== undefined) {
				this.storageService.remove(key, StorageScope.PROFILE);
				this.logService.trace(`[${BASEHALF_PRODUCT_PROFILE_ID}] cleared VS Code startup storage: ${key}`);
			}
		}

		for (const key of BASEHALF_WORKSPACE_STORAGE_KEYS_TO_CLEAR) {
			if (this.storageService.get(key, StorageScope.WORKSPACE) !== undefined) {
				this.storageService.remove(key, StorageScope.WORKSPACE);
				this.logService.trace(`[${BASEHALF_PRODUCT_PROFILE_ID}] cleared VS Code workspace startup storage: ${key}`);
			}
		}
	}

	private applyAuxiliaryBarProfile(): void {
		this.storeJsonIfChanged(
			BASEHALF_AUXILIARYBAR_PINNED_VIEW_CONTAINERS_STORAGE_KEY,
			StorageScope.PROFILE,
			StorageTarget.USER,
			BASEHALF_AUXILIARYBAR_PINNED_VIEW_CONTAINERS,
			'auxiliary bar pinned view containers'
		);

		this.storeJsonIfChanged(
			BASEHALF_AUXILIARYBAR_VIEW_CONTAINERS_WORKSPACE_STATE_STORAGE_KEY,
			StorageScope.WORKSPACE,
			StorageTarget.MACHINE,
			BASEHALF_AUXILIARYBAR_VIEW_CONTAINER_WORKSPACE_STATE,
			'auxiliary bar view container workspace state'
		);
	}

	private applyLeftSidebarProfile(): void {
		this.storeJsonIfChanged(
			BASEHALF_ACTIVITY_PINNED_VIEW_CONTAINERS_STORAGE_KEY,
			StorageScope.PROFILE,
			StorageTarget.USER,
			BASEHALF_LEFT_SIDEBAR_PINNED_VIEW_CONTAINERS,
			'activity pinned view containers'
		);

		this.storeJsonIfChanged(
			BASEHALF_ACTIVITY_VIEW_CONTAINERS_WORKSPACE_STATE_STORAGE_KEY,
			StorageScope.WORKSPACE,
			StorageTarget.MACHINE,
			BASEHALF_LEFT_SIDEBAR_VIEW_CONTAINER_WORKSPACE_STATE,
			'activity view container workspace state'
		);
	}

	private storeJsonIfChanged(key: string, scope: StorageScope, target: StorageTarget, value: unknown, label: string): void {
		const serialized = JSON.stringify(value);
		if (this.storageService.get(key, scope) === serialized) {
			return;
		}

		this.storageService.store(key, serialized, scope, target);
		this.logService.trace(`[${BASEHALF_PRODUCT_PROFILE_ID}] applied BaseHalf ${label}: ${key}`);
	}

	private registerHiddenSurfaceGuards(): void {
		this._register(this.viewsService.onDidChangeViewContainerVisibility(event => {
			if (event.visible && shouldBaseHalfHideViewContainer(event.id)) {
				void this.closeHiddenViewContainer(event.id, 'reopened hidden VS Code view container');
			} else if (event.visible && shouldBaseHalfCloseRemappedViewContainer(event.id)) {
				void this.closeRemappedViewContainer(event.id, 'reopened remapped VS Code view container');
			} else if (event.visible && shouldBaseHalfCloseAgentExtensionViewContainer(event.id)) {
				// Agent extensions' canonical containers are hosted inside the
				// Agent Area; their composite must never take over the part.
				this.viewsService.closeViewContainer(event.id);
				this.logService.trace(`[${BASEHALF_PRODUCT_PROFILE_ID}] closed agent extension canonical view container: ${event.id}`);
			}
		}));

		this._register(this.viewsService.onDidChangeViewVisibility(event => {
			if (event.visible && shouldBaseHalfHideView(event.id)) {
				this.closeHiddenView(event.id, 'reopened hidden VS Code view');
			}
		}));
	}

	private registerSingleSurfaceEditorGuard(): void {
		const collapseScheduler = this._register(new RunOnceScheduler(() => this.collapseMainEditorGroups('created extra editor group'), 0));
		this._register(this.editorGroupsService.onDidAddGroup(() => collapseScheduler.schedule()));
	}

	private async closeRestoredCompetingSurfaces(): Promise<void> {
		await this.lifecycleService.when(LifecyclePhase.Restored);
		await this.closeRestoredHiddenViewContainers();
		await this.closeRestoredRemappedViewContainers();
		this.closeRestoredHiddenViews();
		await this.closeRestoredStartupEditors();
		this.collapseMainEditorGroups('restored editor groups');
	}

	private async closeRestoredHiddenViewContainers(): Promise<void> {
		for (const viewContainerId of BASEHALF_HIDDEN_VIEW_CONTAINER_IDS) {
			if (!shouldBaseHalfHideViewContainer(viewContainerId) || !this.viewsService.isViewContainerVisible(viewContainerId)) {
				continue;
			}

			await this.closeHiddenViewContainer(viewContainerId, 'restored hidden VS Code view container');
		}

		await this.ensurePrimarySidebarVisible();
	}

	private async closeHiddenViewContainer(viewContainerId: string, reason: string): Promise<void> {
		this.viewsService.closeViewContainer(viewContainerId);
		this.logService.trace(`[${BASEHALF_PRODUCT_PROFILE_ID}] closed ${reason}: ${viewContainerId}`);
		await this.ensurePrimarySidebarVisible();
	}

	private async closeRestoredRemappedViewContainers(): Promise<void> {
		for (const viewContainerId of BASEHALF_REMAPPED_VIEW_CONTAINER_IDS) {
			if (!shouldBaseHalfCloseRemappedViewContainer(viewContainerId) || !this.viewsService.isViewContainerVisible(viewContainerId)) {
				continue;
			}

			await this.closeRemappedViewContainer(viewContainerId, 'restored remapped VS Code view container');
		}
	}

	private async closeRemappedViewContainer(viewContainerId: string, reason: string): Promise<void> {
		if (viewContainerId === 'terminal') {
			this.storageService.remove(BASEHALF_ACTIVE_PANEL_STORAGE_KEY, StorageScope.WORKSPACE);
		}
		this.viewsService.closeViewContainer(viewContainerId);
		if (viewContainerId === 'terminal' && this.layoutService.isVisible(Parts.PANEL_PART)) {
			this.layoutService.setPartHidden(true, Parts.PANEL_PART);
		}
		this.logService.trace(`[${BASEHALF_PRODUCT_PROFILE_ID}] closed ${reason}: ${viewContainerId}`);
		await this.ensurePrimarySidebarVisible();
	}

	private async ensurePrimarySidebarVisible(): Promise<void> {
		const primaryViewContainer = BASEHALF_PRIMARY_VIEW_CONTAINERS[0];
		if (primaryViewContainer && !this.viewsService.getVisibleViewContainer(ViewContainerLocation.Sidebar)?.id) {
			await this.viewsService.openViewContainer(primaryViewContainer.id, false);
			this.logService.trace(`[${BASEHALF_PRODUCT_PROFILE_ID}] restored BaseHalf primary view container: ${primaryViewContainer.id}`);
		}
	}

	private closeRestoredHiddenViews(): void {
		for (const viewId of BASEHALF_HIDDEN_VIEW_IDS) {
			if (!shouldBaseHalfHideView(viewId) || !this.viewsService.isViewVisible(viewId)) {
				continue;
			}

			this.closeHiddenView(viewId, 'restored hidden VS Code view');
		}
	}

	private closeHiddenView(viewId: string, reason: string): void {
		this.viewsService.closeView(viewId);
		this.logService.trace(`[${BASEHALF_PRODUCT_PROFILE_ID}] closed ${reason}: ${viewId}`);
	}

	private async closeRestoredStartupEditors(): Promise<void> {
		const editorsToClose = this.editorService
			.getEditors(EditorsOrder.SEQUENTIAL)
			.filter(identifier => shouldBaseHalfCloseStartupEditor(identifier.editor.typeId));

		if (!editorsToClose.length) {
			return;
		}

		await this.editorService.closeEditors(editorsToClose, { preserveFocus: true });
		this.logService.trace(`[${BASEHALF_PRODUCT_PROFILE_ID}] closed restored VS Code startup editors: ${editorsToClose.map(identifier => identifier.editor.typeId).join(', ')}`);
	}

	private collapseMainEditorGroups(reason: string): void {
		const mainPart = this.editorGroupsService.mainPart;
		if (mainPart.groups.length <= 1) {
			return;
		}

		const didMerge = mainPart.mergeAllGroups(mainPart.activeGroup);
		if (didMerge) {
			this.logService.trace(`[${BASEHALF_PRODUCT_PROFILE_ID}] collapsed ${reason} into one BaseHalf main surface`);
		}
	}
}

registerWorkbenchContribution2(BaseHalfWorkbenchProfileContribution.ID, BaseHalfWorkbenchProfileContribution, WorkbenchPhase.BlockStartup);
