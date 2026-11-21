/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isLinux, isWindows } from '../../../../base/common/platform.js';
import { URI } from '../../../../base/common/uri.js';
import { IWorkspace, toWorkspaceFolder, Workspace as BaseWorkspace, WorkspaceFolder } from '../../common/workspace.js';

export class Workspace extends BaseWorkspace {
	constructor(
		id: string,
		folders: WorkspaceFolder[] = [],
		configuration: URI | null = null,
		ignorePathCasing: (key: URI) => boolean = () => !isLinux
	) {
		super(id, folders, false, configuration, ignorePathCasing);
	}
}

const wsUri = URI.file(isWindows ? 'C:\\testWorkspace' : '/testWorkspace');
export const TestWorkspace = testWorkspace(wsUri);

export function testWorkspace(...resource: URI[]): Workspace {
	return new Workspace('test-workspace', resource.map(toWorkspaceFolder));
}

/**
 * Creates an `IWorkspace` fake, as release 1.147.0's helper of the same name does; this tree's `IWorkspace` has no
 * uri of its own to derive.
 */
export function testIWorkspace(workspace: IWorkspace): IWorkspace {
	return workspace;
}
