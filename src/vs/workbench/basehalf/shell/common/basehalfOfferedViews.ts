/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { shouldBaseHalfCloseAgentExtensionViewContainer, shouldBaseHalfCloseRemappedViewContainer, shouldBaseHalfHideView, shouldBaseHalfHideViewContainer } from './basehalfWorkbenchProfile.js';

/**
 * Whether a list of views may offer a view container (D141): not one BaseHalf hides, not the base's
 * terminal panel, whose terminals are in the Agent Area, and not the container of an agent extension,
 * which the Agent Area hosts. Opening one of these would only be closed again.
 */
export function isBaseHalfViewContainerOffered(viewContainerId: string): boolean {
	return !shouldBaseHalfHideViewContainer(viewContainerId)
		&& !shouldBaseHalfCloseRemappedViewContainer(viewContainerId)
		&& !shouldBaseHalfCloseAgentExtensionViewContainer(viewContainerId);
}

/** Whether a list of views may offer a view of a container: a view BaseHalf shows, in a container it shows. */
export function isBaseHalfViewOffered(viewContainerId: string, viewId: string): boolean {
	return isBaseHalfViewContainerOffered(viewContainerId) && !shouldBaseHalfHideView(viewId);
}
