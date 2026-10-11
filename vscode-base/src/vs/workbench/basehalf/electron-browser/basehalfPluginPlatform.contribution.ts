/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The plugin platform is frozen: its catalog service, management service,
// Plugins view, and Plugin Library are kept in the source tree but are not
// loaded, so the product has no plugin surface and fetches no catalog. Only
// the two stores that the built-in AI Video's model connections need load here.
import './basehalfPluginStateStore.js';
import './basehalfModelCredentialStore.js';
