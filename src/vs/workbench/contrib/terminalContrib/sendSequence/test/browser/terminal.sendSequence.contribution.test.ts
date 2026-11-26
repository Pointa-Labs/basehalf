/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { strictEqual } from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import type { ServicesAccessor } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService } from '../../../../../../platform/quickinput/common/quickInput.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { IConfigurationResolverService } from '../../../../../services/configurationResolver/common/configurationResolver.js';
import { IHistoryService } from '../../../../../services/history/common/history.js';
import { ITerminalInstance, ITerminalService } from '../../../../terminal/browser/terminal.js';
import { terminalSendSequenceCommand } from '../../browser/terminal.sendSequence.contribution.js';

suite('TerminalSendSequenceContribution', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('routes PowerShell paste sequences to the focused Agent Area terminal', async () => {
		let agentText = '';
		let stockText = '';
		const terminal = (hasFocus: boolean, onSend: (text: string) => void): ITerminalInstance => ({
			hasFocus,
			hasRemoteAuthority: false,
			attachToElement: () => undefined,
			setVisible: () => undefined,
			focusWhenReady: async () => undefined,
			sendText: (text: string) => onSend(text)
		}) as unknown as ITerminalInstance;
		const agentTerminal = terminal(true, text => agentText = text);
		const stockTerminal = terminal(false, text => stockText = text);
		const services = new Map<unknown, unknown>([
			[IQuickInputService, { input: async () => undefined }],
			[IConfigurationResolverService, { resolveAsync: async (_folder: unknown, text: unknown) => text }],
			[IWorkspaceContextService, { getWorkspaceFolder: () => null }],
			[IHistoryService, { getLastActiveWorkspaceRoot: () => undefined }],
			[ITerminalService, { activeInstance: stockTerminal }]
		]);
		const accessor = {
			get: <T>(id: unknown): T => {
				if (String(id) === 'baseHalfAgentAreaService') {
					return { activeTerminal: agentTerminal } as T;
				}
				if (!services.has(id)) {
					throw new Error(`Missing test service: ${String(id)}`);
				}
				return services.get(id) as T;
			}
		} as ServicesAccessor;

		await terminalSendSequenceCommand(accessor, { text: '\x16' });

		strictEqual(agentText, '\x16');
		strictEqual(stockText, '');
	});
});
