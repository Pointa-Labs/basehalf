/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { extname } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';

export type BaseHalfCardDetailProjection = 'source';

export const DEFAULT_BASEHALF_CARD_DETAIL_PROJECTION: BaseHalfCardDetailProjection = 'source';

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);

export function isBaseHalfMarkdownResource(resource: URI): boolean {
	return MARKDOWN_EXTENSIONS.has(extname(resource).toLowerCase());
}
