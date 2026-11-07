/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// BaseHalf's part of a desktop window, which VS Code's workbench.desktop.main.ts
// imports once: where the credentials of providers are kept, and the window's
// connections to BaseHalf's services in the shared process (code-organization.md).

// The credentials of providers, in the system's keychain (D75).
import './generation/electron-browser/basehalfModelCredentialStore.js';
// The provider service of generation cards (D75).
import '../../platform/basehalfProviders/electron-browser/basehalfProviderService.js';
// The times of files, which a step of undo sets and a window cannot (D82).
import '../../platform/basehalfFiles/electron-browser/basehalfFileTimesService.js';
// The links that install the agent skill (D83).
import '../../platform/basehalfFiles/electron-browser/basehalfFileLinksService.js';
// The clones that keep the original of an edited file (D84).
import '../../platform/basehalfFiles/electron-browser/basehalfFileClonesService.js';
// The write of the clipboard in several forms at once, with the window's clipboard of BaseHalf over it (D104).
import '../../platform/basehalfClipboard/electron-browser/basehalfPasteboardService.js';
import './clipboard/electron-browser/basehalfClipboardService.js';
