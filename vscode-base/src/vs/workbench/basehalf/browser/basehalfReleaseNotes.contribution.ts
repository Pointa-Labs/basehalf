/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { localize, localize2 } from '../../../nls.js';
import { MenuId, registerAction2, Action2 } from '../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../platform/opener/common/opener.js';
import product from '../../../platform/product/common/product.js';
import { IProductService } from '../../../platform/product/common/productService.js';
import { BASEHALF_RELEASE_NOTES_COMMAND_ID, baseHalfReleaseNotesUrl } from '../common/basehalfReleaseNotes.js';

/**
 * "Release Notes" opens the notes of a release where they are written: on the
 * releases page, in the browser (app update, "After an update"). Without a
 * version it is the running one; the update tooltip passes the version it
 * offers. Nothing opens by itself after an update.
 */
export class ShowBaseHalfReleaseNotesAction extends Action2 {
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
		const productService = accessor.get(IProductService);
		const url = baseHalfReleaseNotesUrl(productService.basehalfReleasesUrl, version ?? productService.basehalfVersion);
		if (!url) {
			throw new Error(localize('basehalf.noReleaseNotes', "This version of {0} has no release notes online.", productService.nameLong));
		}
		await accessor.get(IOpenerService).open(URI.parse(url), { openExternal: true });
	}
}

if (!product.releaseNotesUrl) {
	registerAction2(ShowBaseHalfReleaseNotesAction);
}
