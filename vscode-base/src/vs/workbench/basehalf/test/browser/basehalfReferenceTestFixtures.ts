/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IFileQuery, ISearchComplete, ISearchService } from '../../../services/search/common/search.js';

/**
 * File search over an in-memory file system for reference index tests. It
 * returns every Markdown and `.bhnode` file and ignores exclude patterns on
 * purpose, so the index's own eligibility filter is what a test observes.
 */
export class BaseHalfInMemoryFileSearchService implements Pick<ISearchService, 'fileSearch'> {
	constructor(private readonly fileService: IFileService) { }

	async fileSearch(query: IFileQuery): Promise<ISearchComplete> {
		const results: { resource: URI }[] = [];
		for (const folderQuery of query.folderQueries) {
			const stack = [folderQuery.folder];
			while (stack.length) {
				let stat;
				try {
					stat = await this.fileService.resolve(stack.pop()!);
				} catch {
					continue;
				}
				for (const child of stat.children ?? []) {
					if (child.isDirectory) {
						stack.push(child.resource);
					} else if (/\.(?:md|markdown|bhnode)$/i.test(child.name)) {
						results.push({ resource: child.resource });
					}
				}
			}
		}
		return { results, limitHit: false, messages: [] };
	}
}
