/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { parse as parseYaml } from '../../../../../base/common/yaml.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { writeBaseHalfNoteBlock } from '../../../markdown/common/basehalfNoteWriter.js';
import { BASEHALF_AGENT_SHARED_SECTIONS } from '../../common/basehalfAgentLaunchInstructions.js';
import {
	BASEHALF_AGENT_NOTE_FORMATS_SECTION,
	BASEHALF_AGENT_OWN_IMAGE_SECTION,
	BASEHALF_AGENT_SKILL_COPY_SEGMENTS,
	BASEHALF_AGENT_SKILL_DESCRIPTION,
	BASEHALF_AGENT_SKILL_MARKDOWN,
	BASEHALF_AGENT_SKILL_TARGETS,
	BASEHALF_AGENT_SKILL_VERSION,
	baseHalfAgentSkillCopyTakesBundledText,
	baseHalfAgentSkillOffer,
	baseHalfAgentSkillState,
	baseHalfAgentSkillVersion,
	baseHalfIsAgentSkillText
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
			'You can move and rename files and folders with ordinary tools.',
			// D63: generation cards and their drafts.
			'`.bh/mirror/<path>/generation.yaml`',
			'`made.yaml`',
			'basehalf --generate'
		];
		assert.deepStrictEqual({
			missing: phrases.filter(phrase => !body.includes(phrase)),
			sharedSections: body.includes(BASEHALF_AGENT_SHARED_SECTIONS.join('\n')),
			// It publishes where things are; it does not tell an agent what to read first.
			dictatesOrder: /read (?:its|the) upstream (?:items |files )?first/i.test(body),
			// A skill is used outside Agent Area too.
			claimsAgentArea: body.includes('started from BaseHalf\'s Agent Area'),
			retired: ['.bhnode', '--run-node', 'outputs/', 'host.videoCatalog', 'Video node'].filter(phrase => BASEHALF_AGENT_SKILL_MARKDOWN.includes(phrase))
		}, { missing: [], sharedSections: true, dictatesOrder: false, claimsAgentArea: false, retired: [] });
	});

	test('says where an image or a sound the agent made itself goes: the folder of the canvas the selection names, after the shared sections and outside the launch instruction', () => {
		const body = BASEHALF_AGENT_SKILL_MARKDOWN.slice(BASEHALF_AGENT_SKILL_MARKDOWN.indexOf('\n---\n') + 5);
		const section = BASEHALF_AGENT_OWN_IMAGE_SECTION.join('\n');
		assert.deepStrictEqual({
			version: BASEHALF_AGENT_SKILL_VERSION,
			inBody: body.includes(section),
			afterShared: body.indexOf(section) > body.indexOf(BASEHALF_AGENT_SHARED_SECTIONS.join('\n')),
			beforeTheFormats: body.indexOf(section) < body.indexOf(BASEHALF_AGENT_NOTE_FORMATS_SECTION.join('\n')),
			missing: ['a tool of your own', 'the folder of the canvas the user works on', '`.bh/cache/selection.yaml`', '`folder`', 'ask the user'].filter(phrase => !section.includes(phrase)),
			inLaunchInstruction: BASEHALF_AGENT_SHARED_SECTIONS.join('\n').includes('image you make')
		}, { version: '11', inBody: true, afterShared: true, beforeTheFormats: true, missing: [], inLaunchInstruction: false });
	});

	test('describes the record of what the user selected, and names the request it answers', () => {
		const body = BASEHALF_AGENT_SKILL_MARKDOWN.slice(BASEHALF_AGENT_SKILL_MARKDOWN.indexOf('\n---\n') + 5);
		const section = body.slice(body.indexOf('## What the user selected'), body.indexOf('\n## ', body.indexOf('## What the user selected') + 1));
		assert.deepStrictEqual({
			version: BASEHALF_AGENT_SKILL_VERSION,
			// Only in a BaseHalf workspace, so that every other session is not sent looking.
			namesTheRequest: BASEHALF_AGENT_SKILL_DESCRIPTION.includes('In such a workspace, also use it when a request does not say which file or text it is about'),
			afterTheBadge: body.indexOf('## What the user selected') > body.indexOf('## A card\'s badge'),
			missing: [
				'`.bh/cache/selection.yaml`',
				'it is about what they selected',
				'the request wins',
				'only while BaseHalf is open',
				'Never write it.',
				'`selected`', '`folder`', '`card`', '`cards`', '`paths`', '`text`', '`path`', '`first_line`', '`last_line`', '`text_is_cut: true`',
				'The workspace folder itself is `.`.'
			].filter(phrase => !section.includes(phrase)),
			inLaunchInstruction: BASEHALF_AGENT_SHARED_SECTIONS.join('\n').includes('selection.yaml')
		}, { version: '11', namesTheRequest: true, afterTheBadge: true, missing: [], inLaunchInstruction: false });
	});

	test('tells agents the formats a note keeps, each spelled as BaseHalf\'s writer writes it, last and outside the launch instruction (note formats, rule 86)', () => {
		const body = BASEHALF_AGENT_SKILL_MARKDOWN.slice(BASEHALF_AGENT_SKILL_MARKDOWN.indexOf('\n---\n') + 5);
		const section = BASEHALF_AGENT_NOTE_FORMATS_SECTION.join('\n');
		const text = (value: string, styles: object = {}) => ({ type: 'text', text: value, styles });
		const paragraph = (...content: unknown[]) => ({ type: 'paragraph', props: {}, content, children: [] });
		const forms = [
			paragraph(text('underlined words', { underline: true })),
			paragraph(text('red words', { textColor: 'red' })),
			paragraph(text('words on yellow', { backgroundColor: 'yellow' })),
			paragraph(text('both', { textColor: 'red', backgroundColor: 'yellow' })),
			{ type: 'image', props: { url: 'diagram.png', name: 'Diagram', caption: '', showPreview: true, previewWidth: 320 }, children: [] },
			{ type: 'image', props: { url: 'photo.png', name: 'Photo', caption: 'A caption', showPreview: true }, children: [] },
			{ type: 'video', props: { url: 'clip.mp4', name: 'clip.mp4', caption: '', showPreview: true }, children: [] },
			{ type: 'audio', props: { url: 'talk.mp3', name: 'talk.mp3', caption: '', showPreview: true }, children: [] },
			paragraph({ type: 'link', href: 'my%20file.md', content: [text('my file')] })
		].map(block => `\`${writeBaseHalfNoteBlock(block)}\``);
		const toggle = writeBaseHalfNoteBlock({ type: 'toggleListItem', props: {}, content: [text('Title')], children: [paragraph(text('The blocks it holds.'))] });
		assert.deepStrictEqual({
			version: BASEHALF_AGENT_SKILL_VERSION,
			last: body.trimEnd().endsWith(section),
			notWritten: forms.filter(form => !section.includes(form)),
			toggle: section.includes(`\`\`\`\n${toggle}\n\`\`\``),
			palette: ['gray `#9b9a97` and `#3f3e3b`', 'pink `#e36aaf` and `#62294b`'].filter(color => !section.includes(color)),
			keepsOthers: section.includes('keeps any other spelling as written'),
			inLaunchInstruction: BASEHALF_AGENT_SHARED_SECTIONS.join('\n').includes('<u>')
		}, { version: '11', last: true, notWritten: [], toggle: true, palette: [], keepsOthers: true, inLaunchInstruction: false });
	});

	test('links Claude Code\'s folder and the shared one to BaseHalf\'s own copy, and is offered until one of them is linked', () => {
		const copy = URI.file('/home/user/.basehalf/agent-skill/basehalf');
		assert.deepStrictEqual({
			targets: BASEHALF_AGENT_SKILL_TARGETS.map(target => [target.label, target.segments.join('/')]),
			copy: BASEHALF_AGENT_SKILL_COPY_SEGMENTS.join('/'),
			states: [
				baseHalfAgentSkillState({ kind: 'missing' }, copy),
				baseHalfAgentSkillState({ kind: 'link', target: copy }, copy),
				baseHalfAgentSkillState({ kind: 'link', target: URI.file('/home/user/my-skills/basehalf') }, copy),
				baseHalfAgentSkillState({ kind: 'folder' }, copy),
				baseHalfAgentSkillState({ kind: 'file' }, copy)
			],
			offers: [
				baseHalfAgentSkillOffer(['missing', 'missing']),
				baseHalfAgentSkillOffer(['copy', 'missing']),
				baseHalfAgentSkillOffer(['copy', 'copy']),
				baseHalfAgentSkillOffer(['other', 'copy']),
				// A link the user removed for one agent stays removed.
				baseHalfAgentSkillOffer(['linked', 'missing']),
				baseHalfAgentSkillOffer(['linked', 'linked'])
			]
		}, {
			targets: [['Claude Code', '.claude/skills/basehalf'], ['Codex', '.agents/skills/basehalf']],
			copy: '.basehalf/agent-skill/basehalf',
			states: ['missing', 'linked', 'other', 'copy', 'other'],
			offers: ['install', 'install', 'update', 'update', undefined, undefined]
		});
	});

	test('keeps BaseHalf\'s own copy at the bundled text, never over a higher version', () => {
		const withVersion = (version: string) => BASEHALF_AGENT_SKILL_MARKDOWN.replace(`version: "${BASEHALF_AGENT_SKILL_VERSION}"`, `version: "${version}"`);
		const ours = Number(BASEHALF_AGENT_SKILL_VERSION);
		assert.deepStrictEqual({
			version: baseHalfAgentSkillVersion(BASEHALF_AGENT_SKILL_MARKDOWN),
			lower: baseHalfAgentSkillVersion(withVersion(String(ours - 1))),
			none: baseHalfAgentSkillVersion('# no front matter\n'),
			takes: {
				missing: baseHalfAgentSkillCopyTakesBundledText(undefined),
				unreadable: baseHalfAgentSkillCopyTakesBundledText(''),
				lower: baseHalfAgentSkillCopyTakesBundledText(withVersion(String(ours - 1))),
				sameOtherBytes: baseHalfAgentSkillCopyTakesBundledText(`${BASEHALF_AGENT_SKILL_MARKDOWN}edited\n`),
				same: baseHalfAgentSkillCopyTakesBundledText(BASEHALF_AGENT_SKILL_MARKDOWN),
				higher: baseHalfAgentSkillCopyTakesBundledText(withVersion(String(ours + 1)))
			},
			// Only BaseHalf's own text, of any version, is BaseHalf's to replace.
			isBaseHalfs: {
				bundled: baseHalfIsAgentSkillText(BASEHALF_AGENT_SKILL_MARKDOWN),
				earlier: baseHalfIsAgentSkillText(withVersion('3')),
				anotherSkill: baseHalfIsAgentSkillText('---\nname: basehalf-notes\nmetadata:\n  version: "1"\n---\n\nMine.\n'),
				noVersion: baseHalfIsAgentSkillText('---\nname: basehalf\n---\n\nMine.\n'),
				noFrontMatter: baseHalfIsAgentSkillText('name: basehalf\n')
			}
		}, {
			version: ours,
			lower: ours - 1,
			none: undefined,
			takes: { missing: true, unreadable: true, lower: true, sameOtherBytes: true, same: false, higher: false },
			isBaseHalfs: { bundled: true, earlier: true, anotherSkill: false, noVersion: false, noFrontMatter: false }
		});
	});
});
