/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IExtension } from '../../contrib/extensions/common/extensions.js';

export function selectBaseHalfPluginRuntimeExtension(
	extensionId: string,
	capturedExtension: IExtension | undefined,
	installed: readonly IExtension[]
): IExtension | undefined {
	return capturedExtension
		?? installed.find(candidate => candidate.identifier.id.toLowerCase() === extensionId.toLowerCase());
}
