/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

export const BASEHALF_RELEASE_NOTES_COMMAND_ID = 'update.showCurrentReleaseNotes';

export function shouldShowBaseHalfReleaseNotes(previousVersion: string | undefined, currentVersion: string): boolean {
	return !!previousVersion && previousVersion !== currentVersion;
}

/**
 * What a window does about the Release Notes page when it has started (app
 * update, "After an update"). The version counts as shown once the page was
 * opened: a window that did not have focus last leaves it to the one that
 * had, or to the next start.
 *
 * `recorded` is the version the page was last shown for. `switchedOff`: the
 * user or the start asked for no page.
 */
export async function showBaseHalfReleaseNotesAfterUpdate(options: {
	readonly recorded: string | undefined;
	readonly current: string;
	readonly switchedOff: boolean;
	readonly hadLastFocus: () => Promise<boolean>;
	readonly show: () => Promise<unknown>;
	readonly record: () => void;
}): Promise<void> {
	if (options.switchedOff || !shouldShowBaseHalfReleaseNotes(options.recorded, options.current)) {
		// Nothing is owed for this version: a first start, the same version, or no page wanted.
		options.record();
		return;
	}
	if (await options.hadLastFocus()) {
		await options.show();
		options.record();
	}
}

export function getBaseHalfReleaseNotesMarkdown(version: string): string {
	return `# BaseHalf ${version}

BaseHalf is moving onto a real VS Code substrate while keeping the product canvas-first.

## What Changed

- The workbench opens into a BaseHalf welcome surface instead of stock VS Code onboarding.
- Settings live in VS Code's native Settings UI under the BaseHalf category.
- Release Notes open as a system page in the main surface, without creating user files.
- AI Video is built in. It works from the first start and no longer needs to be installed, and the Plugins library is gone from the sidebar.
- Model-service connections are configured once for BaseHalf; API keys stay in encrypted application credential storage.
- The main canvas keeps Markdown and code as ordinary editable files, while executable File, Image, Video, Audio, PDF, and Presentation nodes move from an editable Draft through immutable Attempts to one sealed local-file Result. AI Video adds its recipes and templates to this canvas instead of a separate one.
- Each submission consumes frozen direct inputs and accepts exactly one result file. Connections never auto-run a workflow; failed or cancelled Attempts remain auditable and may retry only the same frozen configuration.
- Visible editor tabs and VS Code breadcrumbs are hidden by default so BaseHalf navigation remains canvas-first.

## Connections

- Connecting two cards saves the connection with the card it points to. For a note, it is saved inside the note itself, so agents and other tools that read the note see it too. For PDFs, folders, other files, and a note BaseHalf can't write into, BaseHalf keeps the list for you.
- The badge edits a card's Upstream list. Downstream shows what draws on it.
- When a file or folder is moved or renamed, BaseHalf updates the upstream lists that name it by itself. It no longer asks.
- A card keeps its description, its place, and its connections when its file or folder is moved or renamed outside BaseHalf, by you or by an agent, also while BaseHalf is closed. A file that was also rewritten for the most part starts as a new card.
- Connections from earlier versions move into your files after you confirm.
- If BaseHalf can't read a card's upstream list, the badge offers Rebuild List, which keeps the connections it can read.
- BaseHalf can install a skill for your agents, so that Claude Code, Codex, and others know where a card's description and connections are. It asks first, and adds it to the agents' own settings, not to your folder.

## Fewer Interruptions

- Every card keeps its place. When a file is added, its card goes after the last card and no other card moves. BaseHalf never puts a card on top of another one.
- Files and folders whose names look like numbers, such as 09, keep their place on the canvas.
- When BaseHalf can't read something it saved for a canvas or a card, it keeps working with what it can read and keeps a copy of the rest. It never asks you to open or fix a file.
- If BaseHalf can't finish updating its cards and badges after you move or delete something, you can Retry or Skip instead of being blocked.

## Updates

- From this version on, an update is downloaded once. If BaseHalf is closed while it downloads, the download goes on where it stopped the next time.
- Once an update is ready, the next start of BaseHalf is the new version, also when BaseHalf was not closed in the usual way.
- About and the update entry in the title bar show BaseHalf's own version.

## Your Files

- BaseHalf removes files that earlier versions kept for itself and no longer uses. It offers to remove the sections it added to CLAUDE.md and AGENTS.md, and remembers where you left each canvas on this computer.
- Where you put your cards stays with the folder on your computer. It is not shared through git any more, so moving a card no longer shows up as a change there. Descriptions and connections are shared as before.
- If you keep your notes in git: the removed files show up as deletions, and BaseHalf no longer edits .gitignore. It keeps card positions and its own working files out of git by itself. Card positions that an earlier version committed stay in git until you remove them there. A folder that ignores all of .bh/ does not share the upstream lists of PDFs, folders, and other non-note files.

## Current Product Shape

BaseHalf keeps the left sidebar focused on Files, Git, and Search. Folders open canvases, files open card detail, and system pages such as Welcome, Settings, and Release Notes use the current main surface instead of becoming workspace files.

## Settings

Open Settings and search for BaseHalf to configure editor reading aids, default canvas zoom, the default Agent Area session, and global model-service connections.
`;
}
