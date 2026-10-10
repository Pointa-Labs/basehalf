/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

export const BASEHALF_RELEASE_NOTES_COMMAND_ID = 'update.showCurrentReleaseNotes';

export function shouldShowBaseHalfReleaseNotes(previousVersion: string | undefined, currentVersion: string): boolean {
	return !!previousVersion && previousVersion !== currentVersion;
}

export function getBaseHalfReleaseNotesMarkdown(version: string): string {
	return `# BaseHalf ${version}

BaseHalf is moving onto a real VS Code substrate while keeping the product canvas-first.

## What Changed

- The workbench opens into a BaseHalf welcome surface instead of stock VS Code onboarding.
- Settings live in VS Code's native Settings UI under the BaseHalf category.
- Release Notes open as a system page in the main surface, without creating user files.
- Model-service connections are configured once for BaseHalf and shared by reviewed plugins; API keys stay in encrypted application credential storage.
- The main canvas keeps Markdown and code as ordinary editable files, while executable File, Image, Video, Audio, PDF, and Presentation nodes move from an editable Draft through immutable Attempts to one sealed local-file Result. Domain plugins contribute reviewed recipes and templates instead of separate canvases.
- Each submission consumes frozen direct inputs and accepts exactly one result file. Connections never auto-run a workflow; failed or cancelled Attempts remain auditable and may retry only the same frozen configuration.
- Curated plugin updates use VS Code's native extension runtime state, including Reload Window, Restart Extensions, and Restart to Update when required.
- Visible editor tabs and VS Code breadcrumbs are hidden by default so BaseHalf navigation remains canvas-first.

## Connections

- Connecting two cards saves the connection with the card it points to. For a note, it is saved inside the note itself, so agents and other tools that read the note see it too. For PDFs, folders, other files, and a note BaseHalf can't write into, BaseHalf keeps the list for you.
- The badge edits a card's Upstream list. Downstream shows what draws on it.
- Moving or renaming a file in BaseHalf offers to update the upstream lists that name it.
- Connections from earlier versions move into your files after you confirm.
- If BaseHalf can't read a card's upstream list, the badge offers Rebuild List, which keeps the connections it can read.

## Fewer Interruptions

- Files and folders whose names look like numbers, such as 09, keep their place on the canvas.
- When BaseHalf can't read something it saved for a canvas or a card, it keeps working with what it can read and keeps a copy of the rest. It never asks you to open or fix a file.
- If BaseHalf can't finish updating its cards and badges after you move or delete something, you can Retry or Skip instead of being blocked.

## Your Files

- BaseHalf removes files that earlier versions kept for itself and no longer uses. It offers to remove the sections it added to CLAUDE.md and AGENTS.md, and remembers where you left each canvas on this computer.
- If you keep your notes in git: the removed files show up as deletions, BaseHalf no longer edits .gitignore, and we recommend ignoring .bh/cache/. A folder that ignores all of .bh/ does not share the upstream lists of PDFs, folders, and other non-note files.

## Current Product Shape

BaseHalf keeps the left sidebar focused on Files, Git, Search, and the curated Plugins library. Folders open canvases, files open card detail, and system pages such as Welcome, Settings, and Release Notes use the current main surface instead of becoming workspace files.

## Settings

Open Settings and search for BaseHalf to configure editor reading aids, default canvas zoom, the default Agent Area session, and global model-service connections.
`;
}
