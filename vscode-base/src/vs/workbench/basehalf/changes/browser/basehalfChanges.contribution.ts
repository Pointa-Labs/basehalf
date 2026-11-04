/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode } from '../../../../base/common/keyCodes.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import { localize } from '../../../../nls.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ActiveEditorContext } from '../../../common/contextkeys.js';
import { TEXT_DIFF_EDITOR_ID } from '../../../common/editor.js';
import { IBaseHalfCardProjectionRegistryService } from '../../cardDetail/common/basehalfCardDetail.js';
import { IBaseHalfCanvasNavigationService } from '../../navigation/common/basehalfCanvasNavigation.js';
import { BASEHALF_CHANGES_PROJECTION_ID, BASEHALF_OPEN_FILE_CHANGES_COMMAND_ID, IBaseHalfFileChangesService } from '../common/basehalfFileChanges.js';

/** The pane of VS Code's multi-file diff (`MultiDiffEditor.ID`). */
const MULTI_DIFF_EDITOR_ID = 'multiDiffEditor';

/** Close Editor, which the keybinding below runs. */
const CLOSE_ACTIVE_EDITOR_COMMAND_ID = 'workbench.action.closeActiveEditor';

/**
 * The Changes view of Card Detail (the changes of a file): it is registered before
 * the window restores Card Detail, and offered while the file has changes.
 */
export class BaseHalfChangesContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.basehalf.changes';

	constructor(
		@IBaseHalfCardProjectionRegistryService projectionRegistryService: IBaseHalfCardProjectionRegistryService,
		@IBaseHalfFileChangesService changes: IBaseHalfFileChangesService,
	) {
		super();
		this._register(projectionRegistryService.registerProjection({
			id: BASEHALF_CHANGES_PROJECTION_ID,
			label: localize('basehalf.changes.view', "Changes"),
			icon: 'codicon-diff',
			order: 50,
			isAvailable: resource => changes.hasChangesView(resource),
			onDidChangeAvailability: changes.onDidChange
		}));
	}
}

registerWorkbenchContribution2(BaseHalfChangesContribution.ID, BaseHalfChangesContribution, WorkbenchPhase.BlockRestore);

CommandsRegistry.registerCommand(BASEHALF_OPEN_FILE_CHANGES_COMMAND_ID, (accessor, resource: URI) =>
	accessor.get(IBaseHalfCanvasNavigationService).openCardDetail(resource, { source: 'api', pinned: true, projection: BASEHALF_CHANGES_PROJECTION_ID }));

// Card Detail closes with Escape, so what covers the canvas like it does too, once
// the editor has nothing else to do with the key: its own uses weigh more (the
// changes of a file, rule 26). A terminal, a list, and a field keep the key.
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'basehalf.changes.closeDiff',
	weight: KeybindingWeight.EditorCore - 10,
	primary: KeyCode.Escape,
	when: ContextKeyExpr.and(
		EditorContextKeys.editorTextFocus,
		ContextKeyExpr.or(ActiveEditorContext.isEqualTo(TEXT_DIFF_EDITOR_ID), ActiveEditorContext.isEqualTo(MULTI_DIFF_EDITOR_ID))
	),
	handler: accessor => accessor.get(ICommandService).executeCommand(CLOSE_ACTIVE_EDITOR_COMMAND_ID)
});
