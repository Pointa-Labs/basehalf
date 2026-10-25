/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The suites of the smoke, in the order the whole smoke runs them, and what each
// covers (README.md in this folder). Their steps are in suites.mts. This module
// imports nothing, so that scripts/basehalf-smoke.mts can read it without
// starting a run.

export const SUITE_LIST = [
	{ name: 'workbench', description: 'The window at startup, the surfaces BaseHalf hides, the Agent Area, Source Control, and Settings.' },
	{ name: 'canvas', description: 'The canvas: creating, editing Notes, renaming, cards that follow renames, connections, badges, selection, zoom, snapping, and the covers of PDFs and books.' },
	{ name: 'cardDetail', description: 'Card Detail and its projections: the rich Markdown editor, source, media, PDF, and books; the trim bar of a video; back and forward from it.' },
	{ name: 'navigation', description: 'Quick Text Search, the Explorer, back and forward between folders and cards, and what happens to the files of the workspace.' },
	{ name: 'video', description: 'Generation cards of images, videos, and sounds: drafts, the panel, the voice menu, generations against the local test provider, Providers, the starter template, and Sequence.' }
];
