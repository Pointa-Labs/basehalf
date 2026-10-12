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
import { IUpdate, State, UpdateType } from '../../../../../platform/update/common/update.js';
import { UpdateTooltip } from '../../browser/updateTooltip.js';

suite('Update tooltip', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	/** The tooltip of a product, and the commands its buttons ran. */
	function tooltipOf(versions: { readonly basehalfVersion: string | undefined }) {
		const productService: IProductService = { _serviceBrand: undefined, ...product, nameLong: 'BaseHalf', version: '1.128.0', commit: 'abc1234567', date: '2026-10-01T00:00:00.000Z', ...versions };
		const ran: unknown[][] = [];
		const tooltip = store.add(new UpdateTooltip(
			new class extends mock<IClipboardService>() { },
			new class extends mock<ICommandService>() {
				override async executeCommand<T>(id: string, ...args: unknown[]): Promise<T | undefined> {
					ran.push([id, ...args]);
					return undefined;
				}
			},
			new class extends mock<IConfigurationService>() {
				override getValue<T>(): T {
					return 'default' as T;
				}
			},
			new class extends mock<IHoverService>() {
				override hideHover() { }
			},
			new class extends mock<IMeteredConnectionService>() { },
			productService
		));
		const rows = () => {
			const [current, latest] = [...tooltip.domNode.querySelectorAll<HTMLElement>('.product-version')];
			const released = tooltip.domNode.querySelector<HTMLElement>('.product-release-date');
			const shown = (row: HTMLElement | null | undefined) => row && row.style.display !== 'none' ? row.textContent : null;
			return { current: shown(current), latest: shown(latest), released: released && released.style.display !== 'none' ? 'shown' : null };
		};
		return { tooltip, ran, rows };
	}

	test('"Current Version" is BaseHalf\'s own version, the one an update is compared with', () => {
		assert.deepStrictEqual({
			baseHalf: tooltipOf({ basehalfVersion: '0.5.1' }).rows().current,
			// A product that has no version of its own shows what the base shows.
			base: tooltipOf({ basehalfVersion: undefined }).rows().current
		}, {
			baseHalf: 'Current Version: 0.5.1 (abc1234)',
			base: 'Current Version: 1.128.0 (abc1234)'
		});
	});

	test('an update of BaseHalf shows its version once, no date that is not its own, and release notes of that version', () => {
		const ready = (update: IUpdate) => {
			const { tooltip, ran, rows } = tooltipOf({ basehalfVersion: '0.5.0' });
			tooltip.renderState(State.Ready(update, false, false));
			tooltip.domNode.querySelector<HTMLButtonElement>('button.release-notes-button')?.click();
			return { ...rows(), ran };
		};

		assert.deepStrictEqual({
			// BaseHalf names the version in both fields of an update.
			baseHalf: ready({ version: '0.5.1', productVersion: '0.5.1', timestamp: Date.UTC(2026, 9, 12) }),
			// A staged copy that a start found: when it was released is not known.
			foundAtAStart: ready({ version: '0.5.1', productVersion: '0.5.1' }),
			// The base names a commit and a version.
			base: ready({ version: 'fedcba9876543210', productVersion: '1.129.0', timestamp: Date.UTC(2026, 9, 12) })
		}, {
			baseHalf: { current: 'Current Version: 0.5.0 (abc1234)', latest: 'Latest Version: 0.5.1', released: 'shown', ran: [['update.showCurrentReleaseNotes', '0.5.1']] },
			foundAtAStart: { current: 'Current Version: 0.5.0 (abc1234)', latest: 'Latest Version: 0.5.1', released: null, ran: [['update.showCurrentReleaseNotes', '0.5.1']] },
			base: { current: 'Current Version: 0.5.0 (abc1234)', latest: 'Latest Version: 1.129.0 (fedcba9)', released: 'shown', ran: [['update.showCurrentReleaseNotes', '1.129.0']] }
		});
	});

	test('the state has one line that names it, and BaseHalf does not wish its users happy coding', () => {
		const idle = (versions: { readonly basehalfVersion: string | undefined }) => {
			const { tooltip } = tooltipOf(versions);
			tooltip.renderState(State.Idle(UpdateType.Archive));
			return [tooltip.title, tooltip.domNode.querySelector('.state-message')?.textContent ?? null];
		};
		const ready = tooltipOf({ basehalfVersion: '0.5.0' }).tooltip;
		ready.renderState(State.Ready({ version: '0.5.1', productVersion: '0.5.1' }, false, false));

		assert.deepStrictEqual({ baseHalf: idle({ basehalfVersion: '0.5.0' }), base: idle({ basehalfVersion: undefined }), ready: ready.title }, {
			baseHalf: ['Up to Date', 'Automatic updates are enabled.'],
			base: ['Up to Date', 'Automatic updates are enabled. Happy Coding!'],
			ready: 'Restart to Update'
		});
	});
});
