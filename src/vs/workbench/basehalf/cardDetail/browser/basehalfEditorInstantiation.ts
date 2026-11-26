/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { emptyProgressRunner, IEditorProgressService, IProgressRunner } from '../../../../platform/progress/common/progress.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorExtensions, IEditorFactoryRegistry, IFileEditorInput } from '../../../common/editor.js';

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

/**
 * An input of its own, for what reads the window's text editor through one (code cards, rule 28).
 * VS Code's text editor service shares one per file, and disposing that closes the file's tabs.
 */
export function baseHalfOwnFileEditorInput(instantiationService: IInstantiationService, resource: URI): IFileEditorInput {
	return Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).getFileEditorFactory()
		.createFileEditor(resource, undefined, undefined, undefined, undefined, undefined, undefined, instantiationService);
}
