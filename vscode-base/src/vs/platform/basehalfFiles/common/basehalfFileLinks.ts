/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const BASEHALF_FILE_LINKS_CHANNEL = 'basehalfFileLinks';

/** What is at a path on disk, read without following a link there. */
export type BaseHalfFileLinkEntry =
	| { readonly kind: 'missing' }
	| { readonly kind: 'link'; readonly target: URI }
	| { readonly kind: 'folder' }
	| { readonly kind: 'file' };

export const IBaseHalfFileLinksService = createDecorator<IBaseHalfFileLinksService>('baseHalfFileLinksService');

/**
 * Inspects, makes, and removes symbolic links on disk, which a window cannot
 * do itself: the service runs in the shared process (agent skill, "Installing
 * and removing"). It changes links only, never a file or a folder.
 */
export interface IBaseHalfFileLinksService {
	readonly _serviceBrand: undefined;
	/** What is at a path, without following a link there. A link's target is made absolute. */
	inspect(resource: URI): Promise<BaseHalfFileLinkEntry>;
	/**
	 * Puts a link to a folder at a path that holds nothing or a link, and
	 * creates its parent folders. A link that is there is replaced in one
	 * step. A file or a folder there is refused.
	 */
	link(resource: URI, target: URI): Promise<void>;
	/** Removes the link at a path, never what it points at. Resolves `false` when nothing is there, and refuses a file or a folder. */
	unlink(resource: URI): Promise<boolean>;
}
