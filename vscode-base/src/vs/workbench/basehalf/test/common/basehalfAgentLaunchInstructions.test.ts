/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
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
			'update every `upstream` entry that names its old path',
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
			'list those files under the new note\'s `upstream`',
			'basehalf --list-capabilities',
			'basehalf --run-node',
			'basehalf --run-operation',
			'Never author attempts or results',
			'Accepted runs continue after the session closes',
			'only inside Agent Area terminals'
		];
		const positions = order.map(phrase => BASEHALF_AGENT_LAUNCH_INSTRUCTIONS.indexOf(phrase));
		assert.ok(positions.every(position => position >= 0), `missing: ${order.filter((_, index) => positions[index] < 0).join(', ')}`);
		assert.deepStrictEqual(positions, [...positions].sort((a, b) => a - b));
	});

	test('never points agents at the retired focus mirror or agent harness', () => {
		assert.deepStrictEqual(
			['.bh/current_focus.yaml', '/focus.yaml', 'agent-harness'].filter(phrase => BASEHALF_AGENT_LAUNCH_INSTRUCTIONS.includes(phrase)),
			[]
		);
	});
});
