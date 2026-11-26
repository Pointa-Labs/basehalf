/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { EditorExtensions } from '../../../common/editor.js';
import { IEditorService, MODAL_GROUP } from '../../../services/editor/common/editorService.js';
import { IPreferencesService } from '../../../services/preferences/common/preferences.js';
import { BASEHALF_OPEN_ADVANCED_SETTINGS_COMMAND_ID, BASEHALF_OPEN_SETTINGS_COMMAND_ID, BaseHalfSettingsPageId, IBaseHalfSettingsService, isBaseHalfSettingsPageId } from '../common/basehalfSettings.js';
import { BaseHalfSettingsEditor } from './basehalfSettingsEditor.js';
import { BaseHalfSettingsEditorInput, IBaseHalfSettingsEditorOptions } from './basehalfSettingsEditorInput.js';

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(BaseHalfSettingsEditor, BaseHalfSettingsEditor.ID, localize('basehalf.settings.editor', "Settings")),
	[new SyncDescriptor(BaseHalfSettingsEditorInput)]
);

/**
 * Opens BaseHalf's Settings over the window (BaseHalf's pages in Settings, "Opening Settings").
 * What an opening asks for travels with it, so the first frame of Settings holds the page.
 */
class BaseHalfSettingsService implements IBaseHalfSettingsService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) { }

	async open(page?: BaseHalfSettingsPageId, input?: string): Promise<void> {
		const options: IBaseHalfSettingsEditorOptions = {
			pinned: true,
			...(page !== undefined ? { basehalfSettingsPage: page } : {}),
			...(input !== undefined ? { basehalfSettingsPageInput: input } : {})
		};
		const editorInput = this.instantiationService.createInstance(BaseHalfSettingsEditorInput);
		const pane = await this.editorService.openEditor(editorInput, options, MODAL_GROUP);
		// Settings that was open keeps the input it has.
		if (pane?.input !== editorInput) {
			editorInput.dispose();
		}
	}
}

registerSingleton(IBaseHalfSettingsService, BaseHalfSettingsService, InstantiationType.Delayed);

// Settings of the More menu, of the application menu, and of its key run this command: the
// base's Settings command hands over to it when it is run without a search.
registerAction2(class OpenBaseHalfSettingsAction extends Action2 {
	constructor() {
		super({ id: BASEHALF_OPEN_SETTINGS_COMMAND_ID, title: localize2('basehalf.settings.open', "Settings"), f1: false });
	}

	override async run(accessor: ServicesAccessor, page?: unknown, input?: unknown): Promise<void> {
		await accessor.get(IBaseHalfSettingsService).open(isBaseHalfSettingsPageId(page) ? page : undefined, typeof input === 'string' ? input : undefined);
	}
});

registerAction2(class OpenBaseHalfAdvancedSettingsAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_OPEN_ADVANCED_SETTINGS_COMMAND_ID,
			title: localize2('basehalf.settings.openAdvanced', "Advanced Settings"),
			category: localize2('basehalf.category', "BaseHalf"),
			f1: true
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IPreferencesService).openSettings({ jsonEditor: false });
	}
});
