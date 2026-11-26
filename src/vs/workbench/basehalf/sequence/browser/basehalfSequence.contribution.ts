/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IBaseHalfCanvasTemplateRegistryService } from '../../canvas/common/basehalfCanvasTemplateRegistry.js';
import { BASEHALF_CANVAS_CREATE_FROM_TEMPLATE_COMMAND_ID } from '../../canvas/common/basehalfCanvasTemplate.js';
import { IBaseHalfCardDetailSurfaceRegistryService } from '../../cardDetail/browser/basehalfCardDetailSurface.js';
import { IBaseHalfCardProjectionRegistryService } from '../../cardDetail/common/basehalfCardDetail.js';
import { IBaseHalfAgentCapabilityRegistryService } from '../../agentArea/common/basehalfAgentCapabilities.js';
import {
	BASEHALF_SEQUENCE_ADD_COMMAND_ID,
	BASEHALF_SEQUENCE_CREATE_WORKFLOW_COMMAND_ID,
	BASEHALF_SEQUENCE_FILE_NAME,
	BASEHALF_SEQUENCE_INSPECT_COMMAND_ID,
	BASEHALF_SEQUENCE_MOVE_COMMAND_ID,
	BASEHALF_SEQUENCE_NAMESPACE,
	BASEHALF_SEQUENCE_PROJECTION_ID,
	BASEHALF_SEQUENCE_REMOVE_COMMAND_ID,
	BASEHALF_SEQUENCE_REPAIR_COMMAND_ID,
	BASEHALF_STARTER_WORKFLOW_TEMPLATE_ID
} from '../common/basehalfSequence.js';
import { BASEHALF_SEQUENCE_CAPABILITY } from '../common/basehalfSequenceCapability.js';
import { BASEHALF_STARTER_WORKFLOW_TEMPLATE_SOURCE } from '../common/basehalfStarterWorkflowTemplate.js';
import { IBaseHalfSequenceService } from './basehalfSequenceService.js';
import { BaseHalfSequenceView } from './basehalfSequenceView.js';

/**
 * Video Sequence as BaseHalf's own code (D75): its view in Card Detail, the
 * starter template, and the capability for agents, registered with the same
 * registries that the frozen platform's contribution points fill, and its
 * commands. All of it is there before the window restores Card Detail.
 */
export class BaseHalfSequenceContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.basehalf.sequence';

	constructor(
		@IBaseHalfCardProjectionRegistryService projectionRegistryService: IBaseHalfCardProjectionRegistryService,
		@IBaseHalfCardDetailSurfaceRegistryService surfaceRegistryService: IBaseHalfCardDetailSurfaceRegistryService,
		@IBaseHalfCanvasTemplateRegistryService templateRegistryService: IBaseHalfCanvasTemplateRegistryService,
		@IBaseHalfAgentCapabilityRegistryService agentCapabilityRegistryService: IBaseHalfAgentCapabilityRegistryService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super();
		this._register(projectionRegistryService.registerProjection({
			id: BASEHALF_SEQUENCE_PROJECTION_ID,
			label: 'Sequence',
			icon: 'codicon-list-ordered',
			selector: { fileNames: [BASEHALF_SEQUENCE_FILE_NAME] },
			order: 400,
			defaultPriority: 300
		}));
		this._register(surfaceRegistryService.registerProvider(BASEHALF_SEQUENCE_PROJECTION_ID, {
			create: parent => {
				const host = append(parent, $('.basehalf-card-detail-surface'));
				return { host, instance: instantiationService.createInstance(BaseHalfSequenceView, host) };
			}
		}));
		// The label is the name of the folder a project made from it gets.
		this._register(templateRegistryService.registerTemplate({
			namespace: BASEHALF_SEQUENCE_NAMESPACE,
			id: BASEHALF_STARTER_WORKFLOW_TEMPLATE_ID,
			label: 'Video Starter Workflow',
			description: 'A brief, a script, and a first shot as ordinary notes, a video draft, and an empty Sequence.',
			source: BASEHALF_STARTER_WORKFLOW_TEMPLATE_SOURCE
		}));
		this._register(agentCapabilityRegistryService.registerCapability(BASEHALF_SEQUENCE_NAMESPACE, BASEHALF_SEQUENCE_CAPABILITY));
	}
}

registerWorkbenchContribution2(BaseHalfSequenceContribution.ID, BaseHalfSequenceContribution, WorkbenchPhase.BlockRestore);

const category = localize2('basehalf.category', "BaseHalf");

/** The token an agent's operation passes as the command's second argument. */
function tokenOf(value: unknown): CancellationToken | undefined {
	return CancellationToken.isCancellationToken(value) ? value : undefined;
}

registerAction2(class extends Action2 {
	constructor() {
		super({ id: BASEHALF_SEQUENCE_CREATE_WORKFLOW_COMMAND_ID, title: localize2('basehalf.sequence.createWorkflow', "Create Video Workflow…"), category, f1: true });
	}
	override run(accessor: ServicesAccessor): Promise<unknown> {
		return accessor.get(ICommandService).executeCommand(BASEHALF_CANVAS_CREATE_FROM_TEMPLATE_COMMAND_ID, BASEHALF_STARTER_WORKFLOW_TEMPLATE_ID);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: BASEHALF_SEQUENCE_INSPECT_COMMAND_ID, title: localize2('basehalf.sequence.inspect', "Show Video Sequence Status…"), category, f1: true });
	}
	override run(accessor: ServicesAccessor, argument?: unknown, token?: unknown): Promise<unknown> {
		return accessor.get(IBaseHalfSequenceService).inspect(argument, tokenOf(token));
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: BASEHALF_SEQUENCE_ADD_COMMAND_ID, title: localize2('basehalf.sequence.add', "Add Video Result to Sequence…"), category, f1: true });
	}
	override run(accessor: ServicesAccessor, argument?: unknown, token?: unknown): Promise<unknown> {
		return accessor.get(IBaseHalfSequenceService).add(argument, tokenOf(token));
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: BASEHALF_SEQUENCE_MOVE_COMMAND_ID, title: localize2('basehalf.sequence.move', "Move Video Sequence Clip…"), category, f1: true });
	}
	override run(accessor: ServicesAccessor, argument?: unknown, token?: unknown): Promise<unknown> {
		return accessor.get(IBaseHalfSequenceService).move(argument, tokenOf(token));
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: BASEHALF_SEQUENCE_REMOVE_COMMAND_ID, title: localize2('basehalf.sequence.remove', "Remove Video Sequence Clip…"), category, f1: true });
	}
	override run(accessor: ServicesAccessor, argument?: unknown, token?: unknown): Promise<unknown> {
		return accessor.get(IBaseHalfSequenceService).remove(argument, tokenOf(token));
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: BASEHALF_SEQUENCE_REPAIR_COMMAND_ID, title: localize2('basehalf.sequence.repair', "Repair Moved Video Sequence Clip…"), category, f1: true });
	}
	override run(accessor: ServicesAccessor, argument?: unknown, token?: unknown): Promise<unknown> {
		return accessor.get(IBaseHalfSequenceService).repair(argument, tokenOf(token));
	}
});
