/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { BaseHalfSettingsPageId } from '../common/basehalfSettings.js';

/** What an opening of BaseHalf's Settings asks for: a page, and what the page should show. */
export interface IBaseHalfSettingsEditorOptions extends IEditorOptions {
	readonly basehalfSettingsPage?: BaseHalfSettingsPageId;
	readonly basehalfSettingsPageInput?: string;
}

/** BaseHalf's Settings: there is one, whatever page it shows. */
export class BaseHalfSettingsEditorInput extends EditorInput {

	static readonly ID = 'workbench.input.basehalfSettings';

	readonly resource = URI.from({ scheme: 'basehalf-settings', path: 'settings' });

	override get typeId(): string {
		return BaseHalfSettingsEditorInput.ID;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		return super.matches(otherInput) || otherInput instanceof BaseHalfSettingsEditorInput;
	}

	override getName(): string {
		return localize('basehalf.settings.name', "Settings");
	}

	override async resolve(): Promise<null> {
		return null;
	}
}
