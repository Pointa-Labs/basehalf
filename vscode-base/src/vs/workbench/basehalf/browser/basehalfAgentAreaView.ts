/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../base/common/codicons.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { SyncDescriptor } from '../../../platform/instantiation/common/descriptors.js';
import { IKeybindingService } from '../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../platform/opener/common/opener.js';
import { Registry } from '../../../platform/registry/common/platform.js';
import { IThemeService } from '../../../platform/theme/common/themeService.js';
import { IViewPaneOptions, ViewPane } from '../../browser/parts/views/viewPane.js';
import { ViewPaneContainer } from '../../browser/parts/views/viewPaneContainer.js';
import { Extensions as ViewContainerExtensions, IViewContainersRegistry, IViewDescriptorService, IViewsRegistry, ViewContainerLocation } from '../../common/views.js';
import { BASEHALF_AGENT_AREA_VIEW_CONTAINER_ID, BASEHALF_AGENT_AREA_VIEW_ID, IBaseHalfAgentAreaService } from '../common/basehalfAgentArea.js';

/**
 * The Agent Area rendered as a real workbench view: a single always-on view in
 * a BaseHalf-owned view container living in the auxiliary bar. The pane adopts
 * the Agent Area service's chrome (tab strip, pane splits, session hosts) as
 * its body, so the area participates in the workbench grid — native sash,
 * size persistence — and extension webviews anchored inside it share the
 * parts' stacking layer and render normally.
 */
class BaseHalfAgentAreaViewPane extends ViewPane {
	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IBaseHalfAgentAreaService private readonly agentAreaService: IBaseHalfAgentAreaService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		container.classList.add('basehalf-agent-area-view-body');
		this.agentAreaService.mountIn(container);
	}

	override focus(): void {
		super.focus();
		void this.agentAreaService.focusActivePane();
	}
}

const agentAreaViewContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: BASEHALF_AGENT_AREA_VIEW_CONTAINER_ID,
	title: { value: 'Agent', original: 'Agent' },
	icon: Codicon.robot,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [BASEHALF_AGENT_AREA_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: `${BASEHALF_AGENT_AREA_VIEW_CONTAINER_ID}.state`,
	hideIfEmpty: false,
	order: 0
}, ViewContainerLocation.AuxiliaryBar, { isDefault: true, doNotRegisterOpenCommand: true });

Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([{
	id: BASEHALF_AGENT_AREA_VIEW_ID,
	name: { value: 'Agent', original: 'Agent' },
	containerIcon: Codicon.robot,
	ctorDescriptor: new SyncDescriptor(BaseHalfAgentAreaViewPane),
	canToggleVisibility: false,
	canMoveView: false
}], agentAreaViewContainer);
