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
- The main canvas keeps Markdown and code as ordinary editable files, while File, Image, Video, Audio, PDF, and Presentation result nodes share one optional Recipe, Run, Current, and History model. Domain plugins contribute reviewed recipes and templates instead of separate canvases.
- A node run consumes frozen direct inputs only. Connections never auto-run a workflow, and a failed or cancelled run keeps the previous Current result.
- Curated plugin updates use VS Code's native extension runtime state, including Reload Window, Restart Extensions, and Restart to Update when required.
- Visible editor tabs and VS Code breadcrumbs are hidden by default so BaseHalf navigation remains canvas-first.

## Current Product Shape

BaseHalf keeps the left sidebar focused on Files, Git, Search, and the curated Plugins library. Folders open canvases, files open card detail, and system pages such as Welcome, Settings, and Release Notes use the current main surface instead of becoming workspace files.

## Settings

Open Settings and search for BaseHalf to configure editor reading aids, default canvas zoom, the default Agent Area session, and global model-service connections.
`;
}
