/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { parse as parseYaml } from '../../../../base/common/yaml.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { BASEHALF_AGENT_SHARED_SECTIONS } from '../../common/basehalfAgentLaunchInstructions.js';
import {
	BASEHALF_AGENT_SKILL_DESCRIPTION,
	BASEHALF_AGENT_SKILL_MARKDOWN,
	BASEHALF_AGENT_SKILL_TARGETS,
	BASEHALF_AGENT_SKILL_VERSION,
	baseHalfAgentSkillOffer,
	baseHalfAgentSkillState
} from '../../common/basehalfAgentSkill.js';

suite('BaseHalfAgentSkill', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('is a skill an agent can load: front matter first, a description that names what to recognize, and a short body', () => {
		const lines = BASEHALF_AGENT_SKILL_MARKDOWN.split('\n');
		const close = lines.indexOf('---', 1);
		const frontmatter = parseYaml(lines.slice(1, close).join('\n'), []);
		const field = (key: string) => frontmatter?.type === 'map' ? frontmatter.properties.find(property => property.key.value === key)?.value : undefined;
		const scalar = (key: string) => {
			const value = field(key);
			return value?.type === 'scalar' ? value.value : undefined;
		};
		const metadata = field('metadata');
		const version = metadata?.type === 'map' ? metadata.properties.find(property => property.key.value === 'version')?.value : undefined;

		assert.deepStrictEqual({
			opensWithFence: lines[0],
			name: scalar('name'),
			// Read back through YAML: the colon inside the description stays text.
			description: scalar('description'),
			withinLimit: BASEHALF_AGENT_SKILL_DESCRIPTION.length <= 1024,
			recognizableBy: ['`.bh/`', '`upstream`'].filter(cue => !BASEHALF_AGENT_SKILL_DESCRIPTION.includes(cue)),
			// The sign comes first, with the instruction to look for it in the working folder only.
			leadsWithTheSign: BASEHALF_AGENT_SKILL_DESCRIPTION.startsWith('A folder that contains a hidden `.bh/` directory is a BaseHalf workspace.') && BASEHALF_AGENT_SKILL_DESCRIPTION.includes('check whether your working folder has `.bh/`') && !/above/.test(BASEHALF_AGENT_SKILL_DESCRIPTION),
			version: version?.type === 'scalar' ? version.value : undefined,
			underLineLimit: lines.length < 500
		}, {
			opensWithFence: '---',
			name: 'basehalf',
			description: BASEHALF_AGENT_SKILL_DESCRIPTION,
			withinLimit: true,
			recognizableBy: [],
			leadsWithTheSign: true,
			version: BASEHALF_AGENT_SKILL_VERSION,
			underLineLimit: true
		});
	});

	test('says where a card\'s badge is, holds the launch sections word for word, and dictates no reading order', () => {
		const body = BASEHALF_AGENT_SKILL_MARKDOWN.slice(BASEHALF_AGENT_SKILL_MARKDOWN.indexOf('\n---\n') + 5);
		const phrases = [
			// The first thing it says is how to tell a BaseHalf workspace.
			'A folder is a BaseHalf workspace when it contains a `.bh/` directory.',
			'When it has no `.bh/` and a folder above it has one, that folder is the workspace folder.',
			'whether or not BaseHalf is running',
			'## A card\'s badge',
			'under `description` in `.bh/mirror/<path>/badge.yaml`',
			'`.bh/mirror/<path>/upstream.yaml`',
			'under the `upstream` key of its frontmatter',
			'It is stored nowhere. Find it by searching',
			'Read it from disk when you need it, and again before you rely on it later.',
			'basehalf --run-operation \'{"operationId":"basehalf.workspace.move","parameters":{"from":"old/path.md","to":"new/path.md"}}\''
		];
		assert.deepStrictEqual({
			missing: phrases.filter(phrase => !body.includes(phrase)),
			sharedSections: body.includes(BASEHALF_AGENT_SHARED_SECTIONS.join('\n')),
			// It publishes where things are; it does not tell an agent what to read first.
			dictatesOrder: /read (?:its|the) upstream (?:items |files )?first/i.test(body),
			// A skill is used outside Agent Area too.
			claimsAgentArea: body.includes('started from BaseHalf\'s Agent Area')
		}, { missing: [], sharedSections: true, dictatesOrder: false, claimsAgentArea: false });
	});

	test('goes to Claude Code\'s folder and the shared one, and is offered while a location lacks the bundled text', () => {
		assert.deepStrictEqual({
			targets: BASEHALF_AGENT_SKILL_TARGETS.map(target => [target.label, target.segments.join('/')]),
			states: [baseHalfAgentSkillState(undefined), baseHalfAgentSkillState(BASEHALF_AGENT_SKILL_MARKDOWN), baseHalfAgentSkillState(`${BASEHALF_AGENT_SKILL_MARKDOWN}edited`), baseHalfAgentSkillState('')],
			offers: [
				baseHalfAgentSkillOffer(['missing', 'missing']),
				baseHalfAgentSkillOffer(['current', 'missing']),
				baseHalfAgentSkillOffer(['outdated', 'current']),
				baseHalfAgentSkillOffer(['outdated', 'missing']),
				baseHalfAgentSkillOffer(['current', 'current'])
			]
		}, {
			targets: [['Claude Code', '.claude/skills/basehalf/SKILL.md'], ['Codex', '.agents/skills/basehalf/SKILL.md']],
			states: ['missing', 'current', 'outdated', 'outdated'],
			offers: ['install', 'install', 'update', 'install', undefined]
		});
	});
});
