/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { BaseHalfMarkdownRichLiveDocumentRegistry } from '../../markdown/common/basehalfMarkdownRichLiveDocument.js';

// What the Rich projections of a window share: the live document of each note that is open in one, and the save of
// a note that is under way.

export const markdownRichDocuments = new BaseHalfMarkdownRichLiveDocumentRegistry();

export interface IBaseHalfMarkdownRichProjectionSave {
	promise: Promise<boolean>;
	error?: string;
}

export const markdownRichProjectionSaves = new Map<string, IBaseHalfMarkdownRichProjectionSave>();
