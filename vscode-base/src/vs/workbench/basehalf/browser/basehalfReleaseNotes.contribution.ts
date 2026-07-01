/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../nls.js';
import { MenuId, registerAction2, Action2 } from '../../../platform/actions/common/actions.js';
import { IInstantiationService, ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import product from '../../../platform/product/common/product.js';
import { IProductService } from '../../../platform/product/common/productService.js';
import { showLocalReleaseNotesInEditor } from '../../contrib/update/browser/update.js';
import { BASEHALF_RELEASE_NOTES_COMMAND_ID, getBaseHalfReleaseNotesMarkdown } from '../common/basehalfReleaseNotes.js';

class ShowBaseHalfReleaseNotesAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_RELEASE_NOTES_COMMAND_ID,
			title: {
				...localize2('basehalf.showReleaseNotes', "Show Release Notes"),
				mnemonicTitle: localize({ key: 'basehalf.mshowReleaseNotes', comment: ['&& denotes a mnemonic'] }, "Show &&Release Notes"),
			},
			category: { value: product.nameShort, original: product.nameShort },
			f1: true,
			menu: [{
				id: MenuId.MenubarHelpMenu,
				group: '1_welcome',
				order: 5,
			}]
		});
	}

	async run(accessor: ServicesAccessor, version?: string): Promise<void> {
		const instantiationService = accessor.get(IInstantiationService);
		const productService = accessor.get(IProductService);
		const targetVersion = version ?? productService.version;
		await showLocalReleaseNotesInEditor(instantiationService, targetVersion, getBaseHalfReleaseNotesMarkdown(targetVersion));
	}
}

if (!product.releaseNotesUrl) {
	registerAction2(ShowBaseHalfReleaseNotesAction);
}
