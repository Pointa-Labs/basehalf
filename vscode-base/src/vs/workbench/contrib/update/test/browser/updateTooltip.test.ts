/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IMeteredConnectionService } from '../../../../../platform/meteredConnection/common/meteredConnection.js';
import product from '../../../../../platform/product/common/product.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { UpdateTooltip } from '../../browser/updateTooltip.js';

suite('Update tooltip', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function currentVersion(versions: { readonly basehalfVersion: string | undefined }): string | null {
		const productService: IProductService = { _serviceBrand: undefined, ...product, nameLong: 'BaseHalf', version: '1.128.0', commit: 'abc1234567', ...versions };
		const tooltip = store.add(new UpdateTooltip(
			new class extends mock<IClipboardService>() { },
			new class extends mock<ICommandService>() { },
			new class extends mock<IConfigurationService>() { },
			new class extends mock<IHoverService>() { },
			new class extends mock<IMeteredConnectionService>() { },
			productService
		));
		return tooltip.domNode.querySelector('.product-version span')?.textContent ?? null;
	}

	test('"Current Version" is BaseHalf\'s own version, the one an update is compared with', () => {
		assert.deepStrictEqual({
			baseHalf: currentVersion({ basehalfVersion: '0.5.1' }),
			// A product that has no version of its own shows what the base shows.
			base: currentVersion({ basehalfVersion: undefined })
		}, {
			baseHalf: 'Current Version: 0.5.1 (abc1234)',
			base: 'Current Version: 1.128.0 (abc1234)'
		});
	});
});
