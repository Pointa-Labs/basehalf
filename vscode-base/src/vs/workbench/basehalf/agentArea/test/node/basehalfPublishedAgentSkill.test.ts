/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'fs';
import { FileAccess } from '../../../../../base/common/network.js';
import { join } from '../../../../../base/common/path.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	BASEHALF_AGENT_SKILL_FILE_NAME,
	BASEHALF_AGENT_SKILL_HOME_PAGE,
	BASEHALF_AGENT_SKILL_MARKDOWN,
	BASEHALF_AGENT_SKILL_NAME,
	BASEHALF_AGENT_SKILL_PLUGIN_VERSION,
	BASEHALF_AGENT_SKILL_REPOSITORY,
	BASEHALF_AGENT_SKILL_VERSION,
	baseHalfIsAgentSkillText
} from '../../common/basehalfAgentSkill.js';

/** What writes the published copy again after a change of the skill's text. */
const PUBLISH = 'Run `npm run basehalf:publish-agent-skill` in vscode-base/ and commit what it writes.';

/**
 * The copy of the skill that the repository publishes for installers and
 * directories of skills (agent skill, "The published copy", D157). The text
 * is written once, in the application's source; these files are derived from
 * it, and this suite fails while one of them differs.
 */
suite('BaseHalf: the repository publishes the agent skill as the application ships it', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	// `out/` is in vscode-base/, which is in the repository.
	const repository = join(FileAccess.asFileUri('').fsPath, '..', '..');
	const inRepository = (...segments: string[]) => join(repository, ...segments);
	const plugin = (...segments: string[]) => inRepository('skills', ...segments);
	const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'));

	test('skills/basehalf/SKILL.md holds exactly the bundled bytes, and is the only entry of its folder', () => {
		const file = plugin(BASEHALF_AGENT_SKILL_NAME, BASEHALF_AGENT_SKILL_FILE_NAME);
		assert.ok(existsSync(file), `The repository has no skills/${BASEHALF_AGENT_SKILL_NAME}/${BASEHALF_AGENT_SKILL_FILE_NAME}. ${PUBLISH}`);
		const published = readFileSync(file, 'utf8');
		// Compared as texts first, so that a difference shows as the lines that differ.
		assert.strictEqual(published, BASEHALF_AGENT_SKILL_MARKDOWN, `The published skill differs from version ${BASEHALF_AGENT_SKILL_VERSION} of the bundled text. ${PUBLISH}`);
		assert.ok(readFileSync(file).equals(Buffer.from(BASEHALF_AGENT_SKILL_MARKDOWN, 'utf8')), `The published skill differs from the bundled text in its bytes. ${PUBLISH}`);
		assert.deepStrictEqual({
			// An installer copies the folder whole, and the application takes over a copy only when it
			// holds nothing but BaseHalf's `SKILL.md` (agent skill, "Installing and removing").
			entries: readdirSync(plugin(BASEHALF_AGENT_SKILL_NAME)),
			isBaseHalfs: baseHalfIsAgentSkillText(published),
			// The installers require that the front matter's name is the folder's.
			namesItsFolder: published.startsWith(`---\nname: ${BASEHALF_AGENT_SKILL_NAME}\n`)
		}, { entries: [BASEHALF_AGENT_SKILL_FILE_NAME], isBaseHalfs: true, namesItsFolder: true });
	});

	test('skills/ is a Claude Code plugin of the text\'s version, listed by the marketplace file at the root', () => {
		const manifest = json(plugin('.claude-plugin', 'plugin.json'));
		const marketplace = json(inRepository('.claude-plugin', 'marketplace.json'));
		assert.deepStrictEqual({
			name: manifest.name,
			// An agent takes a new copy of a plugin when its version changes: it changes with the text.
			version: manifest.version,
			// The folder of the skill, in the plugin's folder: the plugin has no second copy of the text.
			skills: manifest.skills,
			license: manifest.license,
			homepage: manifest.homepage,
			repository: manifest.repository,
			marketplace: {
				name: marketplace.name,
				owner: typeof marketplace.owner?.name,
				plugins: marketplace.plugins.map((entry: { name: string; source: string }) => [entry.name, entry.source])
			}
		}, {
			name: BASEHALF_AGENT_SKILL_NAME,
			version: BASEHALF_AGENT_SKILL_PLUGIN_VERSION,
			skills: [`./${BASEHALF_AGENT_SKILL_NAME}`],
			license: 'Apache-2.0',
			homepage: BASEHALF_AGENT_SKILL_HOME_PAGE,
			repository: BASEHALF_AGENT_SKILL_REPOSITORY,
			marketplace: { name: BASEHALF_AGENT_SKILL_NAME, owner: 'string', plugins: [[BASEHALF_AGENT_SKILL_NAME, './skills']] }
		}, `The plugin's manifest or the marketplace file is not what the bundled text gives. ${PUBLISH}`);
	});

	test('the plugin\'s folder holds the license, a README that says what the skill needs and where BaseHalf is, and nothing else', () => {
		const readme = readFileSync(plugin('README.md'), 'utf8');
		const commands = ['npx skills add Pointa-Labs/basehalf', 'claude plugin install basehalf --marketplace Pointa-Labs/basehalf'];
		const entries: string[] = [];
		const links: string[] = [];
		const walk = (folder: string, prefix: string) => {
			for (const name of readdirSync(folder).sort()) {
				const path = `${prefix}${name}`;
				const stat = lstatSync(join(folder, name));
				if (stat.isSymbolicLink()) {
					links.push(path);
				} else if (stat.isDirectory()) {
					walk(join(folder, name), `${path}/`);
				} else {
					entries.push(path);
				}
			}
		};
		walk(plugin(), '');
		assert.deepStrictEqual({
			// An agent copies the whole folder of a plugin: these files, no link, and no file of the system's.
			entries,
			links,
			license: readFileSync(plugin('LICENSE')).equals(readFileSync(inRepository('LICENSE'))),
			// A directory of plugins asks for a README of at least 40 words.
			readmeHasWords: readme.split(/\s+/).filter(word => /\w/.test(word)).length >= 40,
			readmeLacks: ['`.bh/`', `${BASEHALF_AGENT_SKILL_HOME_PAGE}/download`, ...commands].filter(phrase => !readme.includes(phrase)),
			// The repository's README gives the same two commands.
			repositoryReadmeLacks: commands.filter(command => !readFileSync(inRepository('README.md'), 'utf8').includes(command))
		}, {
			entries: ['.claude-plugin/plugin.json', 'LICENSE', 'README.md', `${BASEHALF_AGENT_SKILL_NAME}/${BASEHALF_AGENT_SKILL_FILE_NAME}`],
			links: [],
			license: true,
			readmeHasWords: true,
			readmeLacks: [],
			repositoryReadmeLacks: []
		}, `The plugin's folder is not what the repository publishes. ${PUBLISH}`);
	});
});
