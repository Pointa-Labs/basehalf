/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Where the session of a split starts, as the base's setting of a terminal says
// (docs/specs/agent-area-terminal.md, The folder of a split).

/**
 * The folder a split starts in: the folder the session it splits is in now, the folder that session
 * started in, or the workspace folder, where every new session starts.
 */
export type BaseHalfSplitFolder = 'current' | 'initial' | 'workspace';

/** `splitCwd` is `terminal.integrated.splitCwd`; a value the base does not know counts as its default. */
export function baseHalfSplitFolder(splitCwd: unknown, splitsTerminalSession: boolean): BaseHalfSplitFolder {
	if (!splitsTerminalSession || splitCwd === 'workspaceRoot') {
		return 'workspace';
	}
	return splitCwd === 'initial' ? 'initial' : 'current';
}
