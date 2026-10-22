/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IFileQuery, ISearchComplete, ISearchService } from '../../../../services/search/common/search.js';
import { IBaseHalfMovedItemsService } from '../../../workspace/common/basehalfMovedItemsService.js';

/** A moved-items service for tests in which nothing is moved outside BaseHalf. */
export const baseHalfNoMovedItems: IBaseHalfMovedItemsService = {
	_serviceBrand: undefined,
	onDidRecognize: Event.None,
	onDidChangeComparing: Event.None,
	onDidRelocate: Event.None,
	getOwedEntryMoves: () => [],
	setOwedEntryMoves: () => { },
	isComparing: () => false,
	whenCompared: async () => { },
	isSettled: () => true,
	whenSettled: async () => { },
	isMoving: () => false,
	resolveMovedPath: () => undefined,
	holdSettled: () => Disposable.None,
	compare: async () => { },
	getPendingMoves: () => [],
	acceptRelocated: () => { },
	acceptRelocatedTogether: () => { },
	hasCompared: () => true,
	mayStillBeFollowed: () => false,
	acceptListing: async () => false,
	acceptWorkbenchMove: () => { },
	acceptWorkbenchDelete: () => { },
	acceptDraftMove: () => { }
};

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
