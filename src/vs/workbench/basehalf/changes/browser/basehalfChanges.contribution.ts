/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../base/browser/dom.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import { localize } from '../../../../nls.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ActiveEditorContext } from '../../../common/contextkeys.js';
import { TEXT_DIFF_EDITOR_ID } from '../../../common/editor.js';
import { IBaseHalfCardDetailSurfaceRegistryService } from '../../cardDetail/browser/basehalfCardDetailSurface.js';
import { IBaseHalfCardProjectionRegistryService } from '../../cardDetail/common/basehalfCardDetail.js';
import { baseHalfRenderableContentKind } from '../../workspace/common/basehalfContentRendering.js';
import { BaseHalfSurfaceActiveContext, IBaseHalfCanvasNavigationService } from '../../navigation/common/basehalfCanvasNavigation.js';
import { BASEHALF_CHANGES_PROJECTION_ID, BASEHALF_OPEN_FILE_CHANGES_COMMAND_ID, BaseHalfChangesViewShownContext, IBaseHalfFileChangesService } from '../common/basehalfFileChanges.js';
import { BaseHalfChangesCardDetail } from './basehalfChangesCardDetail.js';
import { BaseHalfMediaChangesCardDetail, baseHalfChangesVersionsFolder } from './basehalfMediaChangesCardDetail.js';

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
		@IBaseHalfCardDetailSurfaceRegistryService surfaceRegistryService: IBaseHalfCardDetailSurfaceRegistryService,
		@IBaseHalfFileChangesService changes: IBaseHalfFileChangesService,
		@IFileService fileService: IFileService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService,
		@IInstantiationService instantiationService: IInstantiationService,
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
		// A picture, a video, or a sound shows its two versions; text shows its diff.
		this._register(surfaceRegistryService.registerProvider(BASEHALF_CHANGES_PROJECTION_ID, {
			create: (parent, state, host) => {
				const element = append(parent, $('.basehalf-card-detail-surface'));
				if (baseHalfRenderableContentKind(state.resource)) {
					host.setSaveStatus('saved');
					return { host: element, instance: instantiationService.createInstance(BaseHalfMediaChangesCardDetail, element) };
				}
				return {
					host: element,
					instance: instantiationService.createInstance(
						BaseHalfChangesCardDetail,
						element,
						status => host.setSaveStatus(status),
						selected => host.setSelectionForAgents(selected),
						host.modeActions
					)
				};
			}
		}));
		// A window that ended without closing its views leaves their versions behind.
		void fileService.del(baseHalfChangesVersionsFolder(environmentService, workspaceContextService), { recursive: true }).catch(() => { /* There were none. */ });
	}
}

registerWorkbenchContribution2(BaseHalfChangesContribution.ID, BaseHalfChangesContribution, WorkbenchPhase.BlockRestore);

CommandsRegistry.registerCommand(BASEHALF_OPEN_FILE_CHANGES_COMMAND_ID, (accessor, resource: URI) =>
	accessor.get(IBaseHalfCanvasNavigationService).openCardDetail(resource, { source: 'api', pinned: true, projection: BASEHALF_CHANGES_PROJECTION_ID }));

// Next Change and Previous Change work wherever the keyboard is, as in VS Code, unless
// an editor over the view has its own use for these keys (the changes of a file, rule 11).
for (const [id, direction, primary] of [
	['basehalf.changes.nextChange', 'next', KeyMod.Alt | KeyCode.F5],
	['basehalf.changes.previousChange', 'previous', KeyMod.Shift | KeyMod.Alt | KeyCode.F5]
] as const) {
	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id,
		weight: KeybindingWeight.WorkbenchContrib,
		primary,
		when: ContextKeyExpr.and(BaseHalfChangesViewShownContext, ContextKeyExpr.has(BaseHalfSurfaceActiveContext)),
		handler: () => BaseHalfChangesCardDetail.shown?.goToChange(direction)
	});
}

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
