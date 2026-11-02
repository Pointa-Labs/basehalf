/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { createExtension } from '@blocknote/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { columnResizingPluginKey } from 'prosemirror-tables';

// The shape of a note in Rich (note formats, rules 6 and 60): what the note
// cannot store, Rich does not let the user make.

/**
 * A column of a table keeps the width its cells need: Markdown stores no
 * widths of columns, so dragging a column's border does nothing. The
 * editor's resizing starts only when the pointer is on a border, which it
 * marks with a meta that this filter turns away.
 */
export function makeBaseHalfNoteShapeExtension() {
	return createExtension({
		key: 'baseHalfNoteShape',
		prosemirrorPlugins: [
			new Plugin({
				key: new PluginKey('baseHalfNoteColumnWidths'),
				filterTransaction: transaction => {
					const resizing = transaction.getMeta(columnResizingPluginKey) as { readonly setHandle?: number } | undefined;
					return resizing?.setHandle === undefined || resizing.setHandle === -1;
				},
			}),
		],
	});
}
