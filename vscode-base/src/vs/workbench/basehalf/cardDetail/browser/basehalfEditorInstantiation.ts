/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { emptyProgressRunner, IEditorProgressService, IProgressRunner } from '../../../../platform/progress/common/progress.js';

/**
 * What creates an editor outside an editor pane. VS Code's panes give their editors a
 * progress service, which code actions and the inline diff of a change need; here nothing
 * shows a progress bar.
 */
export function baseHalfEditorInstantiationService(instantiationService: IInstantiationService): IInstantiationService {
	return instantiationService.createChild(new ServiceCollection([IEditorProgressService, new class implements IEditorProgressService {
		declare readonly _serviceBrand: undefined;
		show(): IProgressRunner {
			return emptyProgressRunner;
		}
		async showWhile(promise: Promise<unknown>): Promise<void> {
			await promise;
		}
	}]));
}
