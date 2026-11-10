/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IBaseHalfExtensionAgentProvider, BaseHalfExtensionAgentSessionKind, IBaseHalfExtensionAgentProviderResult, baseHalfAgentSessionChoiceForKind } from '../common/basehalfAgentArea.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { clearNode, append, $, Dimension } from '../../../../base/browser/dom.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';


// An agent extension's view as a pane of the Agent Area: finding the extension's view container and moving its
// view into the pane.

interface IBaseHalfResolvedExtensionAgentSurface {
	readonly viewContainerId: string;
	readonly viewId: string | undefined;
}

export class BaseHalfExtensionAgentUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BaseHalfExtensionAgentUnavailableError';
	}
}

export class BaseHalfViewContainerExtensionAgentProvider implements IBaseHalfExtensionAgentProvider {
	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IViewDescriptorService private readonly viewDescriptorService: IViewDescriptorService
	) { }

	async createSession(kind: BaseHalfExtensionAgentSessionKind, container: unknown): Promise<IBaseHalfExtensionAgentProviderResult> {
		if (!(container instanceof mainWindow.HTMLElement)) {
			throw new Error('BaseHalf extension-agent sessions require a DOM host.');
		}

		const choice = baseHalfAgentSessionChoiceForKind(kind);
		if (!choice.extensionId) {
			throw new Error(`${choice.label} does not declare a VS Code extension id.`);
		}

		await this.extensionService.whenInstalledExtensionsRegistered();
		const extension = await this.extensionService.getExtension(choice.extensionId);
		if (!extension) {
			throw new BaseHalfExtensionAgentUnavailableError(`${choice.extensionId} is not installed or enabled.`);
		}

		// Activate the extension so it registers its webview view provider, but do
		// NOT fire onView activation: that would reveal the view in its canonical
		// container, whose pane would steal the single webview instance from the
		// Agent Area pane.
		await this.extensionService.activateById(new ExtensionIdentifier(choice.extensionId), {
			startup: false,
			extensionId: new ExtensionIdentifier(choice.extensionId),
			activationEvent: 'basehalf.agentArea.extension'
		});

		const surface = this.resolveSurface(kind);
		if (!surface) {
			const containers = (choice.extensionViewContainerIds ?? []).join(', ') || '<none>';
			const views = (choice.extensionViewIds ?? []).join(', ') || '<none>';
			throw new BaseHalfExtensionAgentUnavailableError(`${choice.extensionId} did not contribute an active Agent Area view surface. Containers: ${containers}. Views: ${views}.`);
		}

		clearNode(container);
		const viewHost = append(container, $('.basehalf-agent-extension-view-host'));
		const viewPaneContainer = this.instantiationService.createInstance(ViewPaneContainer, surface.viewContainerId, { mergeViewWithContainerWhenSingleView: true, fillsToBottomEdge: true });
		viewPaneContainer.create(viewHost);

		const layout = () => {
			// The view is hidden while the session shows its state, and that can end within the
			// frame it began in, where the observer below sees no change. A layout while hidden
			// measures nothing and would leave the view at its minimum height until the next resize.
			const width = viewHost.clientWidth;
			const height = viewHost.clientHeight;
			if (width > 0 && height > 0) {
				viewPaneContainer.layout(new Dimension(width, height));
			}
		};
		const resizeObserver = new mainWindow.ResizeObserver(layout);
		resizeObserver.observe(viewHost);

		viewPaneContainer.setVisible(true);
		layout();
		if (surface.viewId) {
			viewPaneContainer.openView(surface.viewId, false);
		}

		return {
			label: choice.label,
			description: choice.description,
			detail: `Rendering ${choice.extensionId} via VS Code view ${surface.viewId ?? surface.viewContainerId}`,
			focus: () => viewPaneContainer.focus(),
			setVisible: visible => {
				viewPaneContainer.setVisible(visible);
				if (visible) {
					layout();
				}
			},
			layout,
			dispose: () => {
				resizeObserver.disconnect();
				viewPaneContainer.setVisible(false);
				viewPaneContainer.dispose();
				viewHost.remove();
			}
		};
	}

	private resolveSurface(kind: BaseHalfExtensionAgentSessionKind): IBaseHalfResolvedExtensionAgentSurface | undefined {
		const choice = baseHalfAgentSessionChoiceForKind(kind);
		for (const declaredViewContainerId of choice.extensionViewContainerIds ?? []) {
			const viewContainerId = this.resolveViewContainerId(declaredViewContainerId);
			if (!viewContainerId) {
				continue;
			}

			const viewContainer = this.viewDescriptorService.getViewContainerById(viewContainerId);
			if (!viewContainer) {
				continue;
			}

			const model = this.viewDescriptorService.getViewContainerModel(viewContainer);
			const candidateViewIds = choice.extensionViewIds ?? [];
			const activeViewId = candidateViewIds.find(viewId => model.activeViewDescriptors.some(descriptor => descriptor.id === viewId))
				?? candidateViewIds.find(viewId => this.viewDescriptorService.getViewDescriptorById(viewId))
				?? model.activeViewDescriptors[0]?.id
				?? model.allViewDescriptors[0]?.id;

			return { viewContainerId, viewId: activeViewId };
		}

		return undefined;
	}

	private resolveViewContainerId(declaredViewContainerId: string): string | undefined {
		for (const candidate of this.viewContainerIdCandidates(declaredViewContainerId)) {
			if (this.viewDescriptorService.getViewContainerById(candidate)) {
				return candidate;
			}
		}
		return undefined;
	}

	private viewContainerIdCandidates(declaredViewContainerId: string): readonly string[] {
		const extensionPrefix = 'workbench.view.extension.';
		if (declaredViewContainerId.startsWith(extensionPrefix)) {
			return [declaredViewContainerId, declaredViewContainerId.slice(extensionPrefix.length)];
		}
		return [`${extensionPrefix}${declaredViewContainerId}`, declaredViewContainerId];
	}
}
