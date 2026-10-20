/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BASEHALF_AGENT_LAUNCH_INSTRUCTIONS } from '../../common/basehalfAgentLaunchInstructions.js';

suite('BaseHalfAgentLaunchInstructions', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('stays under 4 KiB in UTF-8', () => {
		assert.ok(VSBuffer.fromString(BASEHALF_AGENT_LAUNCH_INSTRUCTIONS).byteLength < 4096);
	});

	test('locks the contract phrases and the example block', () => {
		const phrases = [
			'relative to the workspace folder',
			'keep its frontmatter, including the upstream list',
			// An agent moves files with its own tools: BaseHalf follows them.
			'You can move and rename files and folders with ordinary tools.',
			'an entry that names the old path of a moved item is broken until it is updated',
			'Never move, rename, or delete anything under `.bh/`.',
			'Never delete or regenerate `.bh/`',
			'out of date',
			'basehalf --list-capabilities',
			'```yaml\n---\nupstream:\n  - courses/linear-algebra/overview.md\n  - sources/strang.pdf\n---\n```'
		];
		assert.deepStrictEqual(phrases.filter(phrase => !BASEHALF_AGENT_LAUNCH_INSTRUCTIONS.includes(phrase)), []);
	});

	test('covers where it runs, relationships, preservation, and canvas workflows in that order', () => {
		const order = [
			'inside a BaseHalf workspace',
			'.bh/mirror/<path>/badge.yaml',
			'`A → B` means A\'s context flows into B',
			'under the `upstream` key of its frontmatter',
			'Markdown links never create relationships',
			'edit it in place',
			'with ordinary tools',
			'BaseHalf updates them when it sees the move',
			'list those files under the new note\'s `upstream`',
			'basehalf --list-capabilities',
			'BaseHalf writes `task` and `result`',
			'`generation` holds `provider`, `model`, `mode`, and `params`',
			'host.videoCatalog',
			'basehalf --run-node',
			'prints the path of the node that runs',
			'only for operations that discovery returned',
			'A generation continues after the session closes',
			'only inside Agent Area terminals'
		];
		const positions = order.map(phrase => BASEHALF_AGENT_LAUNCH_INSTRUCTIONS.indexOf(phrase));
		assert.ok(positions.every(position => position >= 0), `missing: ${order.filter((_, index) => positions[index] < 0).join(', ')}`);
		assert.deepStrictEqual(positions, [...positions].sort((a, b) => a - b));
	});

	test('never points agents at the retired focus mirror, the agent harness, the retired move operation, or recipes', () => {
		assert.deepStrictEqual(
			['.bh/current_focus.yaml', '/focus.yaml', 'agent-harness', 'basehalf.workspace.move', 'instead of `mv`', 'recipe', 'attempt', 'slot'].filter(phrase => BASEHALF_AGENT_LAUNCH_INSTRUCTIONS.includes(phrase)),
			[]
		);
	});
});
