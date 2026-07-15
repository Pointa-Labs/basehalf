/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../base/common/codicons.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { localize, localize2 } from '../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';
import { ContextKeyExpr } from '../../../platform/contextkey/common/contextkey.js';
import { SyncDescriptor } from '../../../platform/instantiation/common/descriptors.js';
import { ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../platform/notification/common/notification.js';
import { IProductService } from '../../../platform/product/common/productService.js';
import { Registry } from '../../../platform/registry/common/platform.js';
import { IURLHandler, IURLService } from '../../../platform/url/common/url.js';
import { IEditorPaneRegistry, EditorPaneDescriptor } from '../../browser/editor.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { EditorExtensions } from '../../common/editor.js';
import { IEditorService } from '../../services/editor/common/editorService.js';
import { BASEHALF_MANAGE_PLUGINS_COMMAND_ID, parseBaseHalfPluginDeepLink } from '../common/basehalfPluginCatalog.js';
import { IBaseHalfPluginCatalogService } from '../common/basehalfPluginCatalogService.js';
import { IBaseHalfCanvasNavigationService } from '../common/basehalfCanvasNavigation.js';
import { baseHalfActiveEditorFlushOptions, BASEHALF_CARD_DETAIL_PANE_ID, IBaseHalfEditorFlushService } from '../common/basehalfEditorFlush.js';
import { BaseHalfPluginLibraryInput, BaseHalfPluginLibraryPane, selectBaseHalfPluginLibraryPlugin } from './basehalfPluginLibrary.js';

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		BaseHalfPluginLibraryPane,
		BaseHalfPluginLibraryPane.ID,
		localize('basehalfPluginLibraryEditor', "Plugins")
	),
	[new SyncDescriptor(BaseHalfPluginLibraryInput)]
);

class ManageBaseHalfPluginsAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_MANAGE_PLUGINS_COMMAND_ID,
			title: localize2('basehalf.managePlugins', 'Manage Plugins'),
			category: localize2('basehalf.category', 'BaseHalf'),
			icon: Codicon.extensions,
			f1: true,
			toggled: ContextKeyExpr.equals('activeEditor', BaseHalfPluginLibraryPane.ID),
			menu: [{
				id: MenuId.MenubarPreferencesMenu,
				group: '2_configuration',
				order: 3
			}]
		});
	}

	async run(accessor: ServicesAccessor, extensionId?: unknown): Promise<void> {
		const editorFlushService = accessor.get(IBaseHalfEditorFlushService);
		const canvasNavigationService = accessor.get(IBaseHalfCanvasNavigationService);
		const editorService = accessor.get(IEditorService);
		const notificationService = accessor.get(INotificationService);

		const projection = canvasNavigationService.state.cardDetail?.projection;
		const flushOptions = projection ? baseHalfActiveEditorFlushOptions(projection) : { forceSerialize: true, forceWrite: false, rejectOnError: true };
		if (!await editorFlushService.flushPane(BASEHALF_CARD_DETAIL_PANE_ID, flushOptions)) {
			notificationService.warn('Resolve the current card save conflict before opening Plugins.');
			return;
		}

		await editorService.openEditor(new BaseHalfPluginLibraryInput(), { pinned: true });
		if (typeof extensionId === 'string') {
			selectBaseHalfPluginLibraryPlugin(extensionId);
		}
	}
}

registerAction2(ManageBaseHalfPluginsAction);

class BaseHalfPluginCachedAdmissionContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.basehalf.pluginCachedAdmission';

	constructor(
		@IBaseHalfPluginCatalogService pluginCatalogService: IBaseHalfPluginCatalogService
	) {
		// Restore only the locally cached, signature-verified catalog here. Network
		// refresh remains non-blocking and is initiated by the Plugins surface.
		void pluginCatalogService.getSnapshot();
	}
}

registerWorkbenchContribution2(BaseHalfPluginCachedAdmissionContribution.ID, BaseHalfPluginCachedAdmissionContribution, WorkbenchPhase.BlockRestore);

class BaseHalfPluginUrlHandler extends Disposable implements IWorkbenchContribution, IURLHandler {
	static readonly ID = 'workbench.contrib.basehalf.pluginUrlHandler';

	constructor(
		@IURLService urlService: IURLService,
		@ICommandService private readonly commandService: ICommandService,
		@INotificationService private readonly notificationService: INotificationService,
		@IProductService private readonly productService: IProductService
	) {
		super();
		this._register(urlService.registerHandler(this));
	}

	async handleURL(uri: URI): Promise<boolean> {
		if (uri.scheme !== this.productService.urlProtocol || uri.authority !== 'plugins') {
			return false;
		}
		const extensionId = parseBaseHalfPluginDeepLink(uri, this.productService.urlProtocol);
		if (!extensionId) {
			this.notificationService.warn(localize('basehalf.plugins.invalidLink', 'This BaseHalf plugin link is invalid.'));
			return true;
		}
		await this.commandService.executeCommand(BASEHALF_MANAGE_PLUGINS_COMMAND_ID, extensionId);
		return true;
	}
}

registerWorkbenchContribution2(BaseHalfPluginUrlHandler.ID, BaseHalfPluginUrlHandler, WorkbenchPhase.AfterRestored);
