/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Event, IValueWithChangeEvent } from '../../../../base/common/event.js';
import { RefCounted } from '../diffEditor/utils.js';
import { IDiffEditorOptions } from '../../../common/config/editorOptions.js';
import { ITextModel } from '../../../common/model.js';
import { ContextKeyValue } from '../../../../platform/contextkey/common/contextkey.js';

export interface IMultiDiffEditorModel {
	readonly documents: IValueWithChangeEvent<readonly RefCounted<IDocumentDiffItem>[] | 'loading'>;
	readonly contextKeys?: Record<string, ContextKeyValue>;
}

export interface IDocumentDiffItem {
	/**
	 * undefined if the file was created.
	 */
	readonly original: ITextModel | undefined;

	/**
	 * undefined if the file was deleted.
	 */
	readonly modified: ITextModel | undefined;
	/**
	 * A file that cannot be shown as text: its versions by name, without text models, as VS Code does in 1.144.
	 * BaseHalf ports this so that no changed file is left out silently (the changes of a file, rule 25): `file` is
	 * the file its row stands for, also when both versions are in git, and `unreadable` says that reading it failed.
	 */
	readonly binary?: { readonly original: URI | undefined; readonly modified: URI | undefined; readonly file?: URI; readonly unreadable?: boolean };
	readonly options?: IDiffEditorOptions;
	readonly onOptionsDidChange?: Event<void>;
	readonly contextKeys?: Record<string, ContextKeyValue>;
}
