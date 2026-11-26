/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IEditorService, MODAL_GROUP } from '../../../services/editor/common/editorService.js';
import { IOutputChannel } from '../../../services/output/common/output.js';

/**
 * Shows a channel of output where BaseHalf shows it (D141, docs/specs/commands-and-menus.md): as a
 * read-only document in the overlay over the canvas, at its last line. The shell has no bottom panel,
 * so the base's Output view never opens. The document is the channel's own, so what the channel
 * receives while it is open shows in it.
 */
export async function showBaseHalfOutputChannel(accessor: ServicesAccessor, channel: IOutputChannel, preserveFocus: boolean): Promise<void> {
	await accessor.get(IEditorService).openEditor({
		resource: channel.uri,
		label: channel.label,
		options: {
			pinned: true,
			preserveFocus,
			// The newest output is at the end: a line past the last one is the last one.
			selection: { startLineNumber: Number.MAX_SAFE_INTEGER, startColumn: 1 }
		}
	}, MODAL_GROUP);
}
