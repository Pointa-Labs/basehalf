/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { BaseHalfAgentSessionKind } from '../../common/basehalfAgentArea.js';
import { baseHalfAgentSessionCloseQuestion, baseHalfClosingSessionAsks, baseHalfClosingWindowAsks, baseHalfSomethingRunsInAgentSession } from '../../common/basehalfAgentSessionClose.js';

suite('BaseHalfAgentSessionClose', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('something runs in an agent\'s session while its program runs, and in a shell with a child process', () => {
		const kinds: BaseHalfAgentSessionKind[] = ['tui-codex', 'tui-claude', 'terminal', 'extension-codex', 'extension-claude'];
		const runs = (programRuns: boolean, hasChildProcesses: boolean) => kinds.filter(kind => baseHalfSomethingRunsInAgentSession({ kind, programRuns, hasChildProcesses }));
		assert.deepStrictEqual(
			{ idle: runs(true, false), withChild: runs(true, true), ended: runs(false, false), endedWithStaleChild: runs(false, true) },
			{ idle: ['tui-codex', 'tui-claude'], withChild: ['tui-codex', 'tui-claude', 'terminal'], ended: [], endedWithStaleChild: [] }
		);
	});

	test('closing a session asks with confirmOnKill as panel or always', () => {
		assert.deepStrictEqual(
			['never', 'editor', 'panel', 'always', undefined, 'other'].filter(value => baseHalfClosingSessionAsks(value)),
			['panel', 'always']
		);
	});

	test('closing the window asks as confirmOnExit says', () => {
		const idle = [{ running: false }, { running: false }];
		const busy = [{ running: false }, { running: true }];
		const asks = (sessions: readonly { running: boolean }[]) => ['never', 'always', 'hasChildProcesses', undefined].filter(value => baseHalfClosingWindowAsks(value, sessions));
		assert.deepStrictEqual(
			{ none: asks([]), idle: asks(idle), busy: asks(busy) },
			{ none: [], idle: ['always'], busy: ['always', 'hasChildProcesses'] }
		);
	});

	test('the question names one running session, counts several, and names what the button does', () => {
		assert.deepStrictEqual(
			[
				baseHalfAgentSessionCloseQuestion('close', ['sleep']),
				baseHalfAgentSessionCloseQuestion('kill', ['Claude Code']),
				baseHalfAgentSessionCloseQuestion('close', ['sleep', 'Codex', 'vim']),
				baseHalfAgentSessionCloseQuestion('quit', ['sleep'], 3),
				baseHalfAgentSessionCloseQuestion('reloadWindow', ['sleep', 'Codex'], 2),
				baseHalfAgentSessionCloseQuestion('closeWindow', [], 1),
				baseHalfAgentSessionCloseQuestion('closeWindow', [], 4),
				// Another folder is opened in the window.
				baseHalfAgentSessionCloseQuestion('closeFolder', ['sleep'], 2),
				// Kill All Terminals.
				baseHalfAgentSessionCloseQuestion('kill', ['sleep', 'Claude Code'])
			],
			[
				{ message: '“sleep” is still running.', primaryButton: 'Close Session' },
				{ message: '“Claude Code” is still running.', primaryButton: 'Kill Session' },
				{ message: '3 sessions are still running.', primaryButton: 'Close Sessions' },
				{ message: '“sleep” is still running.', primaryButton: 'Quit' },
				{ message: '2 sessions are still running.', primaryButton: 'Reload Window' },
				{ message: 'The Agent Area has an open session.', primaryButton: 'Close Window' },
				{ message: 'The Agent Area has 4 open sessions.', primaryButton: 'Close Window' },
				{ message: '“sleep” is still running.', primaryButton: 'Close Folder' },
				{ message: '2 sessions are still running.', primaryButton: 'Kill Sessions' }
			]
		);
	});
});
