/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

// Writes the copy of the agent skill that the repository publishes (agent skill, "The published
// copy", D157) from the text the application bundles: `skills/basehalf/SKILL.md`, the version of
// the plugin in `skills/.claude-plugin/plugin.json`, and `skills/LICENSE`. The text is written
// once, in `basehalfAgentSkill.ts`; run this after a change of it. A unit test fails while the
// files differ from what this writes (`basehalfPublishedAgentSkill.test.ts`).
//
// It reads the compiled source, so `npm run basehalf:publish-agent-skill` transpiles first.
const repository = path.dirname(import.meta.dirname);
const compiled = path.join(repository, 'out', 'vs', 'workbench', 'basehalf', 'agentArea', 'common', 'basehalfAgentSkill.js');
if (!fs.existsSync(compiled)) {
	throw new Error(`The compiled source is missing: ${compiled}. Run npm run basehalf:publish-agent-skill, which transpiles first.`);
}

const skill = await import(pathToFileURL(compiled).href) as {
	readonly BASEHALF_AGENT_SKILL_NAME: string;
	readonly BASEHALF_AGENT_SKILL_FILE_NAME: string;
	readonly BASEHALF_AGENT_SKILL_VERSION: string;
	readonly BASEHALF_AGENT_SKILL_PLUGIN_VERSION: string;
	readonly BASEHALF_AGENT_SKILL_MARKDOWN: string;
};

const inRepository = (...segments: string[]) => path.join(repository, ...segments);
const written: string[] = [];
const write = (file: string, content: string | Buffer) => {
	const before = fs.existsSync(file) ? fs.readFileSync(file) : undefined;
	const after = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
	if (before?.equals(after)) {
		return;
	}
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, after);
	written.push(path.relative(repository, file));
};

write(inRepository('skills', skill.BASEHALF_AGENT_SKILL_NAME, skill.BASEHALF_AGENT_SKILL_FILE_NAME), skill.BASEHALF_AGENT_SKILL_MARKDOWN);

// Only the version is derived. The rest of the manifest is written by hand and kept as it is.
const manifestFile = inRepository('skills', '.claude-plugin', 'plugin.json');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as Record<string, unknown>;
manifest.version = skill.BASEHALF_AGENT_SKILL_PLUGIN_VERSION;
write(manifestFile, `${JSON.stringify(manifest, undefined, 2)}\n`);

write(inRepository('skills', 'LICENSE'), fs.readFileSync(inRepository('LICENSE')));

console.log(written.length
	? `Published version ${skill.BASEHALF_AGENT_SKILL_VERSION} of the agent skill: ${written.join(', ')}`
	: `The published agent skill already holds version ${skill.BASEHALF_AGENT_SKILL_VERSION}.`);
