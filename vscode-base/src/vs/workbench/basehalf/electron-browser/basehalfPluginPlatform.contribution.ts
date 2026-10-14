/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The plugin platform is frozen: its catalog service, management service,
// state store, Plugins view, and Plugin Library are kept in the source tree but
// are not loaded, so the product has no plugin surface and fetches no catalog.
// Only the store that keeps the keys of the video providers loads here (D58).
import './basehalfModelCredentialStore.js';
