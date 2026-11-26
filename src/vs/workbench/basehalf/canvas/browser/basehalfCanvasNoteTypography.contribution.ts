/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IBaseHalfNoteTypographyService } from '../../markdown/browser/basehalfNoteTypographyService.js';
import { buildOnBaseHalfCanvasNoteParts } from './basehalfCanvasNoteParts.js';

/**
 * The cards of notes read the font of a note from the element of the window,
 * so they follow a change of it by themselves. A font changes how many lines
 * a note takes: the notes that the canvas builds in parts build on in the
 * task of the change, before its frame is shown (note rendering, rule 41).
 */
class BaseHalfCanvasNoteTypographyContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.baseHalfCanvasNoteTypography';

	constructor(@IBaseHalfNoteTypographyService typographyService: IBaseHalfNoteTypographyService) {
		super();
		this._register(typographyService.onDidChange(() => buildOnBaseHalfCanvasNoteParts()));
	}
}

registerWorkbenchContribution2(BaseHalfCanvasNoteTypographyContribution.ID, BaseHalfCanvasNoteTypographyContribution, WorkbenchPhase.BlockRestore);
