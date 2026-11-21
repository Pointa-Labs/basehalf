/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { BaseHalfNoteTypographyService, IBaseHalfNoteTypographyService } from './basehalfNoteTypographyService.js';

registerSingleton(IBaseHalfNoteTypographyService, BaseHalfNoteTypographyService, InstantiationType.Delayed);

/**
 * The element of the window holds the typography of a note before the first
 * note is drawn, on a card or in Card Detail (note rendering, rule 40).
 */
class BaseHalfNoteTypographyContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.baseHalfNoteTypography';

	constructor(@IBaseHalfNoteTypographyService typographyService: IBaseHalfNoteTypographyService) {
		// A delayed service starts when it is first used.
		void typographyService.typography;
	}
}

registerWorkbenchContribution2(BaseHalfNoteTypographyContribution.ID, BaseHalfNoteTypographyContribution, WorkbenchPhase.BlockStartup);
