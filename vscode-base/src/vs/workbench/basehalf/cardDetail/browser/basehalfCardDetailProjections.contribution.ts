/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IBaseHalfCardDetailSurfaceRegistryService } from './basehalfCardDetailSurface.js';
import { BaseHalfMarkdownPreviewCardDetail } from './basehalfMarkdownPreviewCardDetail.js';
import { BaseHalfMarkdownRichCardDetail } from './basehalfMarkdownRichCardDetail.js';
import { BaseHalfMediaCardDetail } from './basehalfMediaCardDetail.js';
import { BaseHalfSourceCardDetail } from './basehalfSourceCardDetail.js';

/**
 * The projections that come with Card Detail: Rich and Preview of a note,
 * Source of any text, and the view of a picture, a video, a sound, a PDF, or a
 * book. Each registers how it is drawn, as Changes and Sequence register
 * theirs, before the window restores Card Detail; the view that hosts Card
 * Detail gives each the host it reaches.
 */
export class BaseHalfCardDetailProjectionsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.basehalf.cardDetailProjections';

	constructor(
		@IBaseHalfCardDetailSurfaceRegistryService surfaces: IBaseHalfCardDetailSurfaceRegistryService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super();
		this._register(surfaces.registerProvider('rich', {
			create: (parent, _state, host) => {
				const element = append(parent, $('.basehalf-card-detail-surface'));
				const instance = instantiationService.createInstance(
					BaseHalfMarkdownRichCardDetail,
					element,
					() => host.closeBadgePopover(),
					status => host.setSaveStatus(status),
					{
						onSelectionChange: selected => host.setSelectionForAgents(selected),
						onDetailCloseRequest: () => host.close()
					}
				);
				for (const command of host.takeFormatCommands()) {
					instance.runEditorCommand(command);
				}
				return { host: element, instance };
			}
		}));
		this._register(surfaces.registerProvider('preview', {
			create: (parent, _state, host) => {
				const element = append(parent, $('.basehalf-card-detail-surface'));
				return { host: element, instance: instantiationService.createInstance(BaseHalfMarkdownPreviewCardDetail, element, status => host.setSaveStatus(status)) };
			}
		}));
		this._register(surfaces.registerProvider('media', {
			create: (parent, _state, host) => {
				const element = append(parent, $('.basehalf-card-detail-surface'));
				host.setSaveStatus('saved');
				return {
					host: element,
					instance: instantiationService.createInstance(
						BaseHalfMediaCardDetail,
						element,
						(resource, selection) => host.createDocumentBranch(resource, selection),
						() => host.noteUserInteraction(),
						() => host.close(),
						selected => host.setSelectionForAgents(selected),
						host.modeActions,
						host.editActions
					)
				};
			}
		}));
		this._register(surfaces.registerProvider('source', {
			create: (parent, _state, host) => {
				const element = append(parent, $('.basehalf-card-detail-surface'));
				return {
					host: element,
					instance: instantiationService.createInstance(
						BaseHalfSourceCardDetail,
						element,
						status => host.setSaveStatus(status),
						selected => host.setSelectionForAgents(selected)
					)
				};
			}
		}));
	}
}

registerWorkbenchContribution2(BaseHalfCardDetailProjectionsContribution.ID, BaseHalfCardDetailProjectionsContribution, WorkbenchPhase.BlockRestore);
