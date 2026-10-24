/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	baseHalfMentionLabels,
	baseHalfPromptAsText,
	baseHalfPromptForEntries,
	baseHalfPromptMention,
	buildBaseHalfPromptParts,
	findBaseHalfPromptMentions,
	IBaseHalfMentionEntry,
	rebaseBaseHalfPromptMentions,
	rewriteBaseHalfPromptMentions
} from '../../common/basehalfGenerationMentions.js';
import { BASEHALF_VIDEO_DEFAULT_MODE_INPUTS, BASEHALF_VIDEO_TEXT_INPUT_MAX_LENGTH, IBaseHalfVideoInputSource, IBaseHalfVideoModeInputs, planBaseHalfVideoInputs } from '../../common/basehalfVideoCatalog.js';

function entry(path: string, key = path.toLowerCase()): IBaseHalfMentionEntry {
	return { path, key };
}

function source(path: string, kind: IBaseHalfVideoInputSource['kind'], available = true): IBaseHalfVideoInputSource {
	return { path, kind, available };
}

const REFERENCES: IBaseHalfVideoModeInputs = Object.freeze({
	startFrame: 'none',
	endFrame: 'none',
	images: Object.freeze({ min: 0, max: 3 }),
	videos: Object.freeze({ min: 0, max: 2 }),
	audios: Object.freeze({ min: 0, max: 1 }),
	source: 'none'
});

suite('BaseHalf generation mentions (D74)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('a mention is @[<entry>], with \\] for a ] of the entry, read in NFC; anything else is text', () => {
		const decomposed = 'cafe\u0301.png';
		const prompt = `@[shots/hero.png]走过 @[a\\]b.png] 和 @[${decomposed}]，@[] @[open.png @[two\nlines.png] mail@[x.png]`;
		assert.deepStrictEqual(findBaseHalfPromptMentions(prompt).map(mention => [mention.path, prompt.slice(mention.start, mention.end)]), [
			['shots/hero.png', '@[shots/hero.png]'],
			['a]b.png', '@[a\\]b.png]'],
			['caf\u00e9.png', `@[${decomposed}]`],
			['x.png', '@[x.png]']
		]);
		assert.deepStrictEqual([baseHalfPromptMention('a]b.png'), baseHalfPromptMention('shots/hero.png')], ['@[a\\]b.png]', '@[shots/hero.png]']);
	});

	test('a chip names its file as BaseHalf shows it, a note without .md, with as much of its folder as tells it from another of the same name', () => {
		assert.deepStrictEqual([...baseHalfMentionLabels(['a/hero.png', 'b/hero.png', 'c/d/hero.png', 'x/notes/scene.md', 'y/notes/scene.md', 'clip.mp4', 'brief.txt'])], [
			['a/hero.png', 'a/hero.png'],
			['b/hero.png', 'b/hero.png'],
			['c/d/hero.png', 'd/hero.png'],
			['x/notes/scene.md', 'x/notes/scene'],
			['y/notes/scene.md', 'y/notes/scene'],
			['clip.mp4', 'clip.mp4'],
			['brief.txt', 'brief.txt']
		]);
	});

	test('a removed input takes its mentions out with one space; an input rewritten in place takes its new path; adding and reordering change nothing', () => {
		const before = [entry('a.png'), entry('b.png'), entry('c.png')];
		assert.deepStrictEqual({
			removed: rewriteBaseHalfPromptMentions('@[a.png] 里的人骑车，背景是 @[c.png]', before, [entry('b.png'), entry('c.png')]),
			spaces: [
				rewriteBaseHalfPromptMentions('see @[a.png] now', before, before.slice(1)),
				rewriteBaseHalfPromptMentions('see @[a.png]', before, before.slice(1)),
				rewriteBaseHalfPromptMentions('@[a.png] @[a.png] @[b.png]', before, before.slice(1))
			],
			renamed: rewriteBaseHalfPromptMentions('@[a.png] meets @[c.png].', before, [entry('a.png'), entry('b.png'), entry('shots/c-2.png')], [{ from: 'c.png', to: 'shots/c-2.png' }]),
			respelled: rewriteBaseHalfPromptMentions('@[a.png] rides.', before, [entry('A.png', 'a.png'), entry('b.png'), entry('c.png')], [{ from: 'a.png', to: 'a.png' }]),
			reordered: rewriteBaseHalfPromptMentions('@[a.png] and @[c.png]', before, [entry('c.png'), entry('a.png'), entry('b.png')]),
			added: rewriteBaseHalfPromptMentions('@[a.png]', before, [...before, entry('d.png')]),
			unknown: rewriteBaseHalfPromptMentions('@[z.png] and @[a.png]', before, before.slice(1)),
			none: rewriteBaseHalfPromptMentions('No mention here.', before, [])
		}, {
			removed: '里的人骑车，背景是 @[c.png]',
			spaces: ['see now', 'see', '@[b.png]'],
			renamed: '@[a.png] meets @[shots/c-2.png].',
			respelled: '@[A.png] rides.',
			reordered: undefined,
			added: undefined,
			unknown: '@[z.png] and',
			none: undefined
		});
	});

	test('New Version names a recorded input where the card\'s list has it now; a template\'s draft rebases its mentions as its references', () => {
		assert.deepStrictEqual({
			moved: baseHalfPromptForEntries('@[a.png] beside @[notes/b.md] and @[gone.png]', ['a.png', 'notes/b.md'], ['shots/a.png', 'notes/b.md']),
			otherLength: baseHalfPromptForEntries('@[a.png]', ['a.png'], ['a.png', 'b.png']),
			rebased: rebaseBaseHalfPromptMentions('@[frames/start.png] comes alive.', path => `projects/one/${path}`),
			asText: baseHalfPromptAsText('@[a/hero.png] meets @[b/hero.png] and @[notes/scene.md].', ['a/hero.png', 'b/hero.png', 'notes/scene.md'])
		}, {
			moved: '@[shots/a.png] beside @[notes/b.md] and @[gone.png]',
			otherLength: '@[a.png]',
			rebased: '@[projects/one/frames/start.png] comes alive.',
			asText: 'a/hero.png meets b/hero.png and scene.'
		});
	});

	test('the prompt as sent names each sent input by its place in the request, a note by its name in quotes with its text under its name, and finds a mention of a file that is not connected', () => {
		const plan = planBaseHalfVideoInputs(REFERENCES, [
			source('frames/a.png', 'image'),
			source('clips/move.mp4', 'video'),
			source('notes/scene.md', 'text'),
			source('frames/b.png', 'image'),
			source('voice.mp3', 'audio'),
			source('notes/empty.md', 'text')
		]);
		const texts = new Map([['notes/scene.md', 'A rider on the coast.'], ['notes/empty.md', '  ']]);
		const textOf = (item: { readonly path: string }) => texts.get(item.path);
		const sent = buildBaseHalfPromptParts('  @[frames/b.png] follows @[clips/move.mp4] past @[notes/scene.md] to @[voice.mp3]. ', plan, textOf);
		const unconnected = buildBaseHalfPromptParts('@[frames/a.png] meets @[shots/hero.png] and @[shots/villain.png].', plan, textOf);
		const frames = buildBaseHalfPromptParts('@[start.png] turns to @[end.png].', planBaseHalfVideoInputs(BASEHALF_VIDEO_DEFAULT_MODE_INPUTS, [source('start.png', 'image'), source('end.png', 'image')]), () => undefined);
		assert.deepStrictEqual({ sent, unconnected, frames, empty: buildBaseHalfPromptParts('   ', [], () => undefined) }, {
			sent: {
				parts: [{ input: 'images', index: 1 }, ' follows ', { input: 'videos', index: 0 }, ' past "scene" to ', { input: 'audios', index: 0 }, '.\n\nscene:\nA rider on the coast.'],
				empty: false
			},
			unconnected: {
				parts: [{ input: 'images', index: 0 }, ' meets hero.png and villain.png.\n\nscene:\nA rider on the coast.'],
				unconnected: 'shots/hero.png',
				empty: false
			},
			frames: {
				parts: [{ input: 'startFrame' }, ' turns to ', { input: 'endFrame' }, '.'],
				empty: false
			},
			empty: { parts: [], empty: true }
		});
	});

	test('a prompt that is spoken or sung says a mentioned note\'s text in its place and the other notes\' texts after a blank line, all without names (D78)', () => {
		const speech = planBaseHalfVideoInputs({ ...REFERENCES, images: { min: 0, max: 0 }, videos: { min: 0, max: 0 } }, [
			source('notes/intro.md', 'text'),
			source('notes/outro.md', 'text'),
			source('tune.mp3', 'audio'),
			source('notes/empty.md', 'text')
		]);
		const texts = new Map([['notes/intro.md', 'Welcome to the coast.\n'], ['notes/outro.md', '  Thank you for listening.  '], ['notes/empty.md', ' ']]);
		const textOf = (item: { readonly path: string }) => texts.get(item.path);
		const spoken = (prompt: string) => buildBaseHalfPromptParts(prompt, speech, textOf, { spokenOrSung: true }).parts;
		assert.deepStrictEqual({
			// Criterion 86: the mentioned note is said as its text, and the second one follows.
			mentioned: spoken('@[notes/intro.md]'),
			inText: spoken('First: @[notes/intro.md] Then the tune @[tune.mp3].'),
			twice: spoken('@[notes/intro.md] @[notes/intro.md]'),
			notesOnly: spoken(''),
			both: spoken('@[notes/intro.md] @[notes/outro.md]'),
			// The same prompt that no voice says names its notes.
			described: buildBaseHalfPromptParts('@[notes/intro.md]', speech, textOf).parts
		}, {
			mentioned: ['Welcome to the coast.\n\nThank you for listening.'],
			inText: ['First: Welcome to the coast. Then the tune ', { input: 'audios', index: 0 }, '.\n\nThank you for listening.'],
			twice: ['Welcome to the coast. Welcome to the coast.\n\nThank you for listening.'],
			notesOnly: ['Welcome to the coast.\n\nThank you for listening.'],
			both: ['Welcome to the coast. Thank you for listening.'],
			described: ['"intro"\n\nintro:\nWelcome to the coast.\n\noutro:\nThank you for listening.']
		});
	});

	test('in a prompt that is spoken or sung, a Markdown note joins as its plain text, as a reader of its card says it; a song\'s [Verse], a text note, and the card\'s own prompt stay as written (D78)', () => {
		const speech = planBaseHalfVideoInputs({ ...REFERENCES, images: { min: 0, max: 0 }, videos: { min: 0, max: 0 } }, [
			source('notes/script.md', 'text'),
			source('notes/lyrics.markdown', 'text'),
			source('notes/plain.txt', 'text')
		]);
		const script = [
			'# Scene one',
			'',
			'Welcome to the **coast**, _friend_. See [the map](https://example.com/map) ~~twice~~.',
			'',
			'![A gull over the water](gull.png)',
			'',
			'- Bring `water`',
			'- Bring 2 > 1 & "snacks", it\'s fine',
			'  1. And a hat',
			'',
			'> A quoted line',
			'> and its second',
			'',
			'```',
			'Said as written:  *this*',
			'```',
			'',
			'---',
			'',
			'It&#39;s <b>bold</b>, and a<br>line <!-- a note to myself -->of its own.',
			'',
			'| Who | Says |',
			'| --- | --- |',
			'| Ann | Hi |',
			'',
			'<div align="center">',
			'Centered <i>words</i>',
			'</div>',
			'',
			'A pause <break time="1s" /> here, as List<String> stays.'
		].join('\n');
		const texts = new Map([
			['notes/script.md', script],
			['notes/lyrics.markdown', '[Verse]\nTide comes *in*\nTide goes out\n\n[Chorus]\nSing \\*now\\*'],
			['notes/plain.txt', '# Not a heading, **as written**']
		]);
		const textOf = (item: { readonly path: string }) => texts.get(item.path);
		assert.deepStrictEqual({
			spoken: buildBaseHalfPromptParts('Read **this**: @[notes/script.md]', speech, textOf, { spokenOrSung: true }).parts,
			// The same notes in a prompt that no voice says keep their Markdown under their names.
			described: buildBaseHalfPromptParts('@[notes/lyrics.markdown]', speech, textOf).parts
		}, {
			spoken: [[
				'Read **this**: Scene one',
				'',
				'Welcome to the coast, friend. See the map twice.',
				'',
				'Bring water',
				'Bring 2 > 1 & "snacks", it\'s fine',
				'And a hat',
				'',
				'A quoted line',
				'and its second',
				'',
				'Said as written:  *this*',
				'',
				'It\'s bold, and a',
				'line of its own.',
				'',
				'Who Says',
				'Ann Hi',
				'',
				'Centered words',
				'',
				'A pause <break time="1s" /> here, as List<String> stays.',
				'',
				'[Verse]',
				'Tide comes in',
				'Tide goes out',
				'',
				'[Chorus]',
				'Sing *now*',
				'',
				'# Not a heading, **as written**'
			].join('\n')],
			described: [`"lyrics"\n\nscript:\n${script}\n\nlyrics:\n[Verse]\nTide comes *in*\nTide goes out\n\n[Chorus]\nSing \\*now\\*\n\nplain.txt:\n# Not a heading, **as written**`]
		});
	});

	test('a note adds at most 16 KiB, cut between characters, never between the two halves of one', () => {
		const speech = planBaseHalfVideoInputs({ ...REFERENCES, images: { min: 0, max: 0 }, videos: { min: 0, max: 0 } }, [source('notes/long.md', 'text')]);
		// A character of two UTF-16 units whose second unit would be the first beyond the limit.
		const long = `${'a'.repeat(BASEHALF_VIDEO_TEXT_INPUT_MAX_LENGTH - 1)}\u{1F600} and more`;
		const fits = `${'a'.repeat(BASEHALF_VIDEO_TEXT_INPUT_MAX_LENGTH - 2)}\u{1F600} and more`;
		const sent = (text: string, spokenOrSung: boolean) => buildBaseHalfPromptParts('@[notes/long.md]', speech, () => text, { spokenOrSung }).parts[0] as string;
		const spoken = sent(long, true);
		const described = sent(long, false);
		assert.deepStrictEqual({
			spoken: [spoken.length, spoken.endsWith('a')],
			described: [described.length, described.endsWith('a')],
			// A character that fits whole is kept.
			fits: sent(fits, true).endsWith('\u{1F600}')
		}, {
			spoken: [BASEHALF_VIDEO_TEXT_INPUT_MAX_LENGTH - 1, true],
			described: ['"long"\n\nlong:\n'.length + BASEHALF_VIDEO_TEXT_INPUT_MAX_LENGTH - 1, true],
			fits: true
		});
	});
});
