/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { basename, dirname } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { BASEHALF_MEDIA_FILE_EXTENSIONS } from '../../../../platform/protocol/common/basehalfMediaFiles.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IBaseHalfCanvasNavigationService } from '../../navigation/common/basehalfCanvasNavigation.js';
import { baseHalfNoteHeadingLine, resolveBaseHalfNoteLink } from '../common/basehalfNoteLinks.js';

// One target for a link, from every place a note is read (note formats,
// rule 53).

export interface IBaseHalfNoteLinkServices {
	readonly opener: IOpenerService;
	readonly files: IFileService;
	readonly navigation: IBaseHalfCanvasNavigationService;
	readonly workspace: IWorkspaceContextService;
	readonly log: ILogService;
}

/** The services a link opens with, taken while the accessor is valid. */
export function baseHalfNoteLinkServices(accessor: ServicesAccessor): IBaseHalfNoteLinkServices {
	return {
		opener: accessor.get(IOpenerService),
		files: accessor.get(IFileService),
		navigation: accessor.get(IBaseHalfCanvasNavigationService),
		workspace: accessor.get(IWorkspaceContextService),
		log: accessor.get(ILogService),
	};
}

/**
 * Opens what the link `href` of the note `note` goes to: a web page or a
 * mail in the system's browser or mail application, a note or a file of the
 * workspace in Card Detail and a folder as its canvas, at the heading the
 * link names. A heading of the note itself is `onHeading`'s, the view that
 * shows the note; without one, the note opens in Card Detail at it. An
 * address of another kind, a file that is not there, and an address outside
 * the workspace's folders do nothing, and nothing asks.
 */
export async function openBaseHalfNoteLink(services: IBaseHalfNoteLinkServices, note: URI, href: string, onHeading?: (heading: string) => void): Promise<void> {
	const target = resolveBaseHalfNoteLink(note, services.workspace.getWorkspace().folders.map(folder => folder.uri), href);
	try {
		switch (target.kind) {
			case 'web':
				// From the workspace's own text: the link opens without asking.
				await services.opener.open(target.address, { openExternal: true, fromWorkspace: true, fromUserGesture: true, allowCommands: false });
				return;
			case 'heading':
				if (onHeading) {
					onHeading(target.heading);
					return;
				}
				await openAt(services, note, target.heading);
				return;
			case 'file':
				if (!await services.files.exists(target.uri)) {
					return;
				}
				if (isNoteFile(target.uri)) {
					await openNoteFile(services, note, target.uri);
				} else {
					await openAt(services, target.uri, target.heading);
				}
				return;
		}
	} catch (error) {
		services.log.error(error);
	}
}

/** Whether a file is a note's own, in the store of a home: `.bh/attachments/<folder>/<file>` (files in notes, rule 1). */
function isNoteFile(resource: URI): boolean {
	const segments = resource.path.split('/');
	const at = segments.length - 4;
	return at >= 0 && segments[at] === '.bh' && segments[at + 1] === 'attachments';
}

const viewedExtensions: ReadonlySet<string> = new Set(Object.values(BASEHALF_MEDIA_FILE_EXTENSIONS).flat());

/**
 * A note's own file opens in BaseHalf's viewer for its kind over the note's
 * canvas, never over a canvas of the store; a kind without a viewer opens in
 * the system's application for it (files in notes, rule 22).
 */
async function openNoteFile(services: IBaseHalfNoteLinkServices, note: URI, resource: URI): Promise<void> {
	const name = basename(resource).toLowerCase();
	const dot = name.lastIndexOf('.');
	if (dot <= 0 || !viewedExtensions.has(name.slice(dot))) {
		await services.opener.open(resource, { openExternal: true, fromUserGesture: true, allowCommands: false });
		return;
	}
	await services.navigation.openResource(resource, {
		source: 'api',
		pinned: true,
		canvasFolder: services.navigation.state.canvasFolder?.resource ?? dirname(note),
	});
}

async function openAt(services: IBaseHalfNoteLinkServices, resource: URI, heading: string | undefined): Promise<void> {
	let line: number | undefined;
	if (heading) {
		try {
			line = baseHalfNoteHeadingLine((await services.files.readFile(resource)).value.toString(), heading);
		} catch {
			// A folder or a file that cannot be read opens without a heading.
		}
	}
	await services.navigation.openResource(resource, {
		source: 'api',
		pinned: true,
		...(line !== undefined ? { selection: { startLineNumber: line, startColumn: 1 } } : {}),
	});
}
