/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BASEHALF_AGENT_SESSION_NAME_LIMIT, baseHalfAgentSessionName, baseHalfAgentTabName } from '../../common/basehalfAgentSessionName.js';

suite('BaseHalfAgentSessionName', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('a plain terminal is named by the base\'s title and description, and Terminal until it has one', () => {
		assert.deepStrictEqual(
			[
				baseHalfAgentSessionName({ kind: 'terminal', ownName: 'Terminal', allowAgentCliTitle: true }),
				baseHalfAgentSessionName({ kind: 'terminal', ownName: 'Terminal', terminalTitle: '', terminalDescription: '', allowAgentCliTitle: true }),
				baseHalfAgentSessionName({ kind: 'terminal', ownName: 'Terminal', terminalTitle: 'zsh', terminalDescription: 'sub', allowAgentCliTitle: true }),
				// The title a program set counts only as the base took it into its title.
				baseHalfAgentSessionName({ kind: 'terminal', ownName: 'Terminal', terminalTitle: 'vim', programTitle: 'ignored', allowAgentCliTitle: true })
			],
			[
				{ name: 'Terminal', description: '' },
				{ name: 'Terminal', description: '' },
				{ name: 'zsh', description: 'sub' },
				{ name: 'vim', description: '' }
			]
		);
	});

	test('an agent\'s session shows the title its program set when the setting allows, and the agent\'s name otherwise', () => {
		const claude = { kind: 'tui-claude' as const, ownName: 'Claude Code', terminalTitle: 'node' };
		assert.deepStrictEqual(
			[
				baseHalfAgentSessionName({ ...claude, allowAgentCliTitle: true }),
				baseHalfAgentSessionName({ ...claude, programTitle: '✳ Fix the flaky test', allowAgentCliTitle: true }),
				baseHalfAgentSessionName({ ...claude, programTitle: '✳ Fix the flaky test', allowAgentCliTitle: false }),
				baseHalfAgentSessionName({ ...claude, programTitle: ' \t ', allowAgentCliTitle: true }),
				baseHalfAgentSessionName({ kind: 'tui-codex', ownName: 'Codex', terminalTitle: 'codex', terminalDescription: 'docs', programTitle: 'review', allowAgentCliTitle: true })
			],
			[
				{ name: 'Claude Code', description: '' },
				{ name: '✳ Fix the flaky test', description: '' },
				{ name: 'Claude Code', description: '' },
				{ name: 'Claude Code', description: '' },
				{ name: 'review', description: 'docs' }
			]
		);
	});

	test('a session that an extension draws keeps its own name', () => {
		assert.deepStrictEqual(
			baseHalfAgentSessionName({ kind: 'extension-claude', ownName: 'Claude Code Extension', terminalTitle: 'zsh', terminalDescription: 'sub', programTitle: 'x', allowAgentCliTitle: true }),
			{ name: 'Claude Code Extension', description: '' }
		);
	});

	test('a name is one line of a bounded length', () => {
		const long = 'a'.repeat(1000);
		const name = baseHalfAgentSessionName({ kind: 'terminal', ownName: 'Terminal', terminalTitle: `one\ntwo\r\tthree ${long}`, terminalDescription: ` in\nfolder `, allowAgentCliTitle: true });
		assert.deepStrictEqual(
			{ start: name.name.slice(0, 14), length: name.name.length, description: name.description },
			{ start: 'onetwothree aa', length: BASEHALF_AGENT_SESSION_NAME_LIMIT, description: 'infolder' }
		);
	});

	test('a name the user gave a tab stands alone', () => {
		const session = { name: 'zsh', description: 'sub' };
		assert.deepStrictEqual(
			[baseHalfAgentTabName('  build  ', session), baseHalfAgentTabName(undefined, session), baseHalfAgentTabName(' ', session), baseHalfAgentTabName(undefined, undefined)],
			[{ name: 'build', description: '' }, session, session, { name: '', description: '' }]
		);
	});
});
