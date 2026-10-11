/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IOSProperties } from '../../../native/common/native.js';
import product from '../../../product/common/product.js';
import { IProductService } from '../../../product/common/productService.js';
import { createNativeAboutDialogDetails } from '../../electron-browser/dialog.js';

suite('About dialog details', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const osProperties: IOSProperties = { type: 'Darwin', release: '25.6.0', arch: 'arm64', platform: 'darwin', cpus: [] };

	function about(versions: { readonly basehalfVersion: string | undefined }): string[] {
		const productService: IProductService = { _serviceBrand: undefined, ...product, nameLong: 'BaseHalf', version: '1.128.0', commit: 'abc123', date: undefined, target: undefined, darwinUniversalAssetId: undefined, ...versions };
		const details = createNativeAboutDialogDetails(productService, osProperties);
		return [details.title, ...details.details.split('\n').slice(0, 3), ...details.detailsToCopy.split('\n').slice(0, 3)];
	}

	test('"Version" is BaseHalf\'s own version, and the version of the VS Code base has a line of its own', () => {
		assert.deepStrictEqual({
			baseHalf: about({ basehalfVersion: '0.5.1' }),
			// A product that has no version of its own shows what the base shows.
			base: about({ basehalfVersion: undefined })
		}, {
			baseHalf: ['BaseHalf', 'Version: 0.5.1', 'VS Code: 1.128.0', 'Commit: abc123', 'Version: 0.5.1', 'VS Code: 1.128.0', 'Commit: abc123'],
			base: ['BaseHalf', 'Version: 1.128.0', 'Commit: abc123', 'Date: Unknown', 'Version: 1.128.0', 'Commit: abc123', 'Date: Unknown']
		});
	});
});
