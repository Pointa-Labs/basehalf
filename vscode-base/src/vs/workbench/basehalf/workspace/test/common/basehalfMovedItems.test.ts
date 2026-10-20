/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BASEHALF_FINGERPRINT_FULL_HASH_MAX_BYTES, BASEHALF_FINGERPRINT_MAX_PIECES, BASEHALF_FINGERPRINT_WINDOW_BYTES, baseHalfComputeFileFingerprint, baseHalfFingerprintSimilarity, baseHalfMovedItemPath, baseHalfRecognizeMovedItems, baseHalfTextPieces, IBaseHalfFileFingerprint, IBaseHalfFollowedItem } from '../../common/basehalfMovedItems.js';

const PDF = '%PDF\u0000';

function source(content: string) {
	const bytes = VSBuffer.fromString(content);
	return { size: bytes.byteLength, read: async (position: number, length: number) => bytes.slice(position, position + length) };
}

/** A note of `count` sentences, one per line, of which the listed ones are changed. */
function note(count: number, changed: readonly number[] = []): string {
	// Every line has words of its own, so the share of lines that changed is the share of the content.
	return Array.from({ length: count }, (_, index) => changed.includes(index)
		? `rewritten${index} differently${index} worded${index} entirely${index}`
		: `sentence${index} unchanged${index} original${index} wording${index}`).join('\n');
}

/** Another note that shares no sentence with {@link note}. */
function otherNote(count: number, changed: readonly number[] = []): string {
	return Array.from({ length: count }, (_, index) => changed.includes(index)
		? `replaced${index} elsewhere${index} anew${index} otherwise${index}`
		: `second${index} document${index} keeps${index} lines${index}`).join('\n');
}

function foldersOf(files: readonly string[]): Set<string> {
	const folders = new Set<string>();
	for (const file of files) {
		const segments = file.split('/');
		for (let length = 1; length < segments.length; length++) {
			folders.add(segments.slice(0, length).join('/'));
		}
	}
	return folders;
}

/**
 * One comparison between two states of a folder. Every file of `before` has a
 * fingerprint in the snapshot, as the followed files and the files directly in
 * a followed folder do.
 */
async function recognize(before: Record<string, string>, after: Record<string, string>, followed: readonly IBaseHalfFollowedItem[], earlierPairs?: ReadonlyMap<string, string>) {
	const beforeFolders = foldersOf(Object.keys(before));
	const afterFolders = foldersOf(Object.keys(after));
	const disappearedFingerprints = new Map<string, IBaseHalfFileFingerprint>();
	const presentFingerprints: IBaseHalfFileFingerprint[] = [];
	for (const [path, content] of Object.entries(before)) {
		const fingerprint = await baseHalfComputeFileFingerprint(source(content));
		if (fingerprint) {
			if (after[path] !== undefined) {
				presentFingerprints.push(fingerprint);
			} else {
				disappearedFingerprints.set(path, fingerprint);
			}
		}
	}
	const fingerprinted: string[] = [];
	const moves = await baseHalfRecognizeMovedItems({
		disappeared: followed.filter(item => item.kind === 'file' ? after[item.path] === undefined : !afterFolders.has(item.path)),
		disappearedFingerprints,
		appearedFiles: Object.keys(after).filter(path => before[path] === undefined).map(path => ({ path, size: VSBuffer.fromString(after[path]).byteLength })),
		appearedFolders: new Set([...afterFolders].filter(folder => !beforeFolders.has(folder))),
		earlierPairs,
		presentFingerprints,
		fingerprint: async (path, withPieces) => {
			fingerprinted.push(`${path}${withPieces ? ' (pieces)' : ''}`);
			return baseHalfComputeFileFingerprint(source(after[path]), withPieces);
		}
	});
	return { moves: moves.map(move => `${move.from} -> ${move.to} [${move.kind}, ${move.rule}]`), fingerprinted, raw: moves };
}

const file = (path: string): IBaseHalfFollowedItem => ({ path, kind: 'file' });
const folder = (path: string): IBaseHalfFollowedItem => ({ path, kind: 'folder' });

suite('BaseHalfMovedItems', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('a fingerprint is the size and hash, with pieces for text, three windows for a large file, and nothing for an empty one', async () => {
		const reads: string[] = [];
		const size = BASEHALF_FINGERPRINT_FULL_HASH_MAX_BYTES + 3;
		const large = await baseHalfComputeFileFingerprint({
			size,
			read: async (position, length) => {
				reads.push(`${position}+${length}`);
				return VSBuffer.alloc(length);
			}
		});
		const text = await baseHalfComputeFileFingerprint(source('# Title\n\nOne line.\n'));
		const binary = await baseHalfComputeFileFingerprint(source(`${PDF}one line.\n`));

		assert.deepStrictEqual({
			empty: await baseHalfComputeFileFingerprint(source('')),
			text: [text?.size, text?.hash.length, (text?.pieces?.length ?? 0) / 2, text?.sampled],
			sameContentSameHash: text?.hash === (await baseHalfComputeFileFingerprint(source('# Title\n\nOne line.\n'), false))?.hash,
			binaryHasPieces: binary?.pieces !== undefined,
			large: [large?.size, large?.hash.length, large?.pieces],
			reads
		}, {
			empty: undefined,
			text: [19, 64, 3, undefined],
			sameContentSameHash: true,
			binaryHasPieces: false,
			large: [size, 64, undefined],
			reads: [`0+${BASEHALF_FINGERPRINT_WINDOW_BYTES}`, `${Math.floor(size / 2) - BASEHALF_FINGERPRINT_WINDOW_BYTES / 2}+${BASEHALF_FINGERPRINT_WINDOW_BYTES}`, `${size - BASEHALF_FINGERPRINT_WINDOW_BYTES}+${BASEHALF_FINGERPRINT_WINDOW_BYTES}`]
		});
	});

	test('the pieces of a text are its words, and similarity counts how much of the larger file is shared', () => {
		const pieces = (text: string) => (baseHalfTextPieces(text).pieces?.length ?? 0) / 2;
		const fingerprint = (text: string): IBaseHalfFileFingerprint => ({ size: text.length, hash: '', ...baseHalfTextPieces(text) });
		const similarity = (a: string, b: string) => Math.round(baseHalfFingerprintSimilarity(fingerprint(a), fingerprint(b)) * 100);
		const long = Array.from({ length: BASEHALF_FINGERPRINT_MAX_PIECES + 200 }, (_, index) => `word${index}`).join(' ');
		const longEdited = long.replace('word7 ', 'changed7 ');
		// What an agent does when it is asked to tighten a note: every sentence is reworded, most words stay.
		const original = 'We ran a survey of 40 students in March about how they study. 31 of them study in the evening after 9 pm. 27 said that the exam weeks in June are when they need a study tool most.';
		const reworded = 'In March we surveyed 40 students about how they study. 31 study in the evening after 9 pm. 27 said they need a study tool most during the June exam weeks.';

		assert.deepStrictEqual({
			words: pieces('First sentence. Second one! A third? Yes; done.'),
			repeatedAndCase: pieces('one one ONE two'),
			// A script without spaces is taken in pairs of characters.
			chinese: pieces('第一句。第二句'),
			mixed: pieces('BaseHalf画布canvas'),
			sampled: [baseHalfTextPieces(long).sampled, pieces(long)],
			aThirdChanged: similarity(note(9), note(9, [1, 4, 7])) >= 50,
			twoThirdsChanged: similarity(note(9), note(9, [0, 1, 3, 4, 6, 7])) >= 50,
			unchanged: similarity(note(9), note(9)),
			reworded: similarity(original, reworded) >= 50,
			chineseReworded: similarity('我们在三月调查了四十名学生的学习习惯。', '三月我们调查了四十名学生的学习习惯,结果如下。') >= 50,
			// A shared heading is a small part of two short notes.
			shortNotesWithOneHeading: similarity('# Notes\nBuy milk and bread for the week.', '# Notes\nCall the dentist about Thursday.') >= 50,
			nothingToCompare: similarity('', note(3)),
			// Both files keep their smallest hashes, so a long note still compares.
			longNoteOneWordChanged: similarity(long, longEdited) >= 95
		}, {
			words: 8,
			repeatedAndCase: 2,
			chinese: 4,
			mixed: 3,
			sampled: [true, BASEHALF_FINGERPRINT_MAX_PIECES],
			aThirdChanged: true,
			twoThirdsChanged: false,
			unchanged: 100,
			reworded: true,
			chineseReworded: true,
			shortNotesWithOneHeading: false,
			nothingToCompare: 0,
			longNoteOneWordChanged: true
		});
	});

	test('a renamed file is paired by its content, and only a file of the same size is hashed', async () => {
		const renamed = await recognize(
			{ 'papers/x.pdf': `${PDF}body`, 'notes/keep.md': note(3) },
			{ 'papers/y.pdf': `${PDF}body`, 'notes/keep.md': note(3), 'notes/new.txt': 'something else of another size' },
			[file('papers/x.pdf'), file('notes/keep.md')]
		);
		const nothingGone = await recognize({ 'a.md': note(3) }, { 'a.md': note(3), 'b.md': note(3) }, [file('a.md')]);

		assert.deepStrictEqual({ renamed: [renamed.moves, renamed.fingerprinted], nothingGone: [nothingGone.moves, nothingGone.fingerprinted] }, {
			renamed: [['papers/x.pdf -> papers/y.pdf [file, sameContent]'], ['papers/y.pdf']],
			// A copy is not a move: nothing disappeared, so nothing is read.
			nothingGone: [[], []]
		});
	});

	test('among several files with the same content the file name decides, and otherwise nothing is paired', async () => {
		const before = { 'papers/x.pdf': `${PDF}body` };
		const named = await recognize(before, { 'inbox/x.pdf': `${PDF}body`, 'inbox/y.pdf': `${PDF}body` }, [file('papers/x.pdf')]);
		const unnamed = await recognize(before, { 'inbox/y.pdf': `${PDF}body`, 'inbox/z.pdf': `${PDF}body` }, [file('papers/x.pdf')]);
		const two = await recognize(
			{ 'a/x.pdf': `${PDF}body`, 'a/y.pdf': `${PDF}body` },
			{ 'b/x.pdf': `${PDF}body`, 'b/z.pdf': `${PDF}body` },
			[file('a/x.pdf'), file('a/y.pdf')]
		);

		// The same for notes: what rule 1 leaves open, rule 2 does not decide by the order of the paths.
		const notes = await recognize({ 'a/x.md': note(6) }, { 'b/y.md': note(6), 'c/z.md': note(6) }, [file('a/x.md')]);

		assert.deepStrictEqual({ named: named.moves, unnamed: unnamed.moves, notes: notes.moves, two: two.moves }, {
			named: ['papers/x.pdf -> inbox/x.pdf [file, sameContent]'],
			unnamed: [],
			notes: [],
			// The name pairs one; the one left on each side is then decided too.
			two: ['a/x.pdf -> b/x.pdf [file, sameContent]', 'a/y.pdf -> b/z.pdf [file, sameContent]']
		});
	});

	test('a renamed and edited note is paired when at least half of it is unchanged, and a changed file that is not text is not', async () => {
		const edited = await recognize({ 'notes/research.md': note(9) }, { 'notes/survey.md': note(9, [1, 4, 7]) }, [file('notes/research.md')]);
		const rewritten = await recognize({ 'notes/research.md': note(9) }, { 'notes/survey.md': note(9, [0, 1, 3, 4, 6, 7]) }, [file('notes/research.md')]);
		const binary = await recognize({ 'a.pdf': `${PDF}${note(9)}` }, { 'b.pdf': `${PDF}${note(9, [1])}` }, [file('a.pdf')]);
		// Two notes renamed and edited at once: each goes to its own text.
		const two = await recognize(
			{ 'one.md': note(10), 'two.md': otherNote(10) },
			{ 'first.md': otherNote(10, [0, 5]), 'second.md': note(10, [8, 9]) },
			[file('one.md'), file('two.md')]
		);
		// Two files appear that both come from the note: the more similar one is it.
		const best = await recognize({ 'one.md': note(10) }, { 'near.md': note(10, [0]), 'far.md': note(10, [7, 8, 9]) }, [file('one.md')]);

		assert.deepStrictEqual({ edited: edited.moves, rewritten: rewritten.moves, binary: binary.moves, two: two.moves, best: best.moves }, {
			edited: ['notes/research.md -> notes/survey.md [file, similarContent]'],
			rewritten: [],
			binary: [],
			two: ['one.md -> second.md [file, similarContent]', 'two.md -> first.md [file, similarContent]'],
			best: ['one.md -> near.md [file, similarContent]']
		});
	});

	test('most of a file has to be unchanged, and most of what was particular to it has to be still there', async () => {
		const template = (own: string) => `# Meeting notes\n\nAttendees and agenda go at the top of every meeting note.\nDecisions are listed under their own heading, one per line.\nActions carry an owner and a date, and are reviewed next time.\n\n${own}`;
		const frame = (prompt: string) => `{\n  "kind": "node",\n  "version": 3,\n  "recipe": { "id": "basehalf.video.compose", "engine": "default" },\n  "inputs": [], "outputs": [], "state": "draft",\n  "prompt": ${JSON.stringify(prompt)}\n}`;
		const kept = (count: number, path: (index: number) => string, content: (own: string) => string) => Object.fromEntries(Array.from({ length: count }, (_, index) => [path(index), content(`Topic${index} covers point${index}, detail${index} and outcome${index}.`)]));
		const meetings = kept(5, index => `meetings/1${index}.md`, template);
		const nodes = kept(4, index => `keep${index}.bhnode`, frame);
		const budget = 'Budget review: the travel line is cut by a tenth.';
		const hiring = 'Hiring: two offers go out on Friday afternoon.';
		// One note is deleted and another is created, with other notes of the same template still there.
		const templates = await recognize({ 'meetings/03.md': template(budget), ...meetings }, { 'meetings/07.md': template(hiring), ...meetings }, [file('meetings/03.md')]);
		const frames = await recognize(
			{ 'a.bhnode': frame('A slow pan across the harbor at dawn, in muted colors.'), ...nodes },
			{ 'b.bhnode': frame('A fast cut between three faces in a crowded market.'), ...nodes },
			[file('a.bhnode')]
		);
		const heading = await recognize({ 'todo.md': '# Notes\nBuy milk and bread for the week.' }, { 'calls.md': '# Notes\nCall the dentist about Thursday.' }, [file('todo.md')]);
		// The same template note, renamed and with its own text edited a little, is still paired.
		const own = 'Budget review: the travel line is cut by a tenth.\nThe hardware line stays as it was planned in spring.\nThe training line';
		const renamedTemplateNote = await recognize({ 'meetings/03.md': template(`${own} moves to the next quarter.`), ...meetings }, { 'meetings/budget.md': template(`${own} is dropped.`), ...meetings }, [file('meetings/03.md')]);
		// A small note of ordinary words, renamed and edited among notes that use the same words.
		const ordinary = (index: number) => `The plan for the week is to read the notes and write the report.\nThen we meet and talk about the next steps for item${index}.`;
		const sameWords = Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`log/${index}.md`, ordinary(index)]));
		const smallNote = await recognize(
			{ 'week.md': 'The plan for the week: read the notes, write the report, and meet about the next steps.', ...sameWords },
			{ 'this-week.md': 'The plan for this week: read the notes, write the report, then meet about the next steps.', ...sameWords },
			[file('week.md')]
		);
		// The same note gets a line of new words that no other file has: they do not outweigh the ordinary words that stayed.
		const newWords = await recognize(
			{ 'week.md': 'The plan for the week: read the notes, write the report, and meet about the next steps.', ...sameWords },
			{ 'this-week.md': 'The plan for the week: read the notes, write the report, and meet about the next steps.\nZanzibar quokka xylophone marzipan.', ...sameWords },
			[file('week.md')]
		);
		// With one other note of the template, the template is still most of what was particular to the note.
		const oneOtherNote = await recognize(
			{ 'meetings/03.md': template(budget), 'meetings/01.md': template('Kickoff: names, roles, and the first milestone.') },
			{ 'meetings/07.md': template(hiring), 'meetings/01.md': template('Kickoff: names, roles, and the first milestone.') },
			[file('meetings/03.md')]
		);

		assert.deepStrictEqual({ templates: templates.moves, frames: frames.moves, heading: heading.moves, renamedTemplateNote: renamedTemplateNote.moves, smallNote: smallNote.moves, newWords: newWords.moves, oneOtherNote: oneOtherNote.moves }, {
			templates: [],
			frames: [],
			heading: [],
			renamedTemplateNote: ['meetings/03.md -> meetings/budget.md [file, similarContent]'],
			smallNote: ['week.md -> this-week.md [file, similarContent]'],
			newWords: ['week.md -> this-week.md [file, similarContent]'],
			// Accepted, as git accepts it: nothing tells these two apart from one note that was edited.
			oneOtherNote: ['meetings/03.md -> meetings/07.md [file, similarContent]']
		});
	});

	test('a folder follows more than half of its files to a folder that appeared, and what is below it moves along', async () => {
		const renamed = await recognize(
			{ 'old/a.pdf': `${PDF}a`, 'old/one.md': note(6), 'old/two.md': note(6, [0]), 'old/sub/deep.md': note(4) },
			{ 'new/a.pdf': `${PDF}a`, 'new/one.md': note(6), 'new/two.md': 'Nothing of the old note is left in this one.', 'new/sub/deep.md': note(4) },
			[folder('old'), folder('old/sub'), file('old/a.pdf'), file('old/one.md'), file('old/two.md'), file('old/sub/deep.md')]
		);
		const mostRewritten = await recognize(
			{ 'old/a.md': note(6), 'old/b.md': note(6, [0]), 'old/c.md': note(6, [1]) },
			{ 'new/a.md': note(6), 'new/b.md': 'All new.', 'new/c.md': 'Also all new.' },
			[folder('old'), file('old/a.md'), file('old/b.md')]
		);

		assert.deepStrictEqual({
			renamed: renamed.moves,
			rewrittenNoteMovesAlong: baseHalfMovedItemPath(renamed.raw, 'old/two.md'),
			deepFolderMovesAlong: baseHalfMovedItemPath(renamed.raw, 'old/sub'),
			elsewhere: baseHalfMovedItemPath(renamed.raw, 'other/x.md'),
			mostRewritten: mostRewritten.moves
		}, {
			// One entry: the folder. Its files and folders take the same relative paths.
			renamed: ['old -> new [folder, folderFiles]'],
			rewrittenNoteMovesAlong: 'new/two.md',
			deepFolderMovesAlong: 'new/sub',
			elsewhere: undefined,
			// One file of three is not most of the folder: only that file is followed.
			mostRewritten: ['old/a.md -> new/a.md [file, sameContent]']
		});
	});

	test('files moved into a folder that was already there keep their cards and leave the old folder behind, and a file that left a moved folder goes first', async () => {
		const merged = await recognize(
			{ 'old/a.md': note(5), 'old/b.md': note(5, [0]), 'there/keep.md': note(2) },
			{ 'there/a.md': note(5), 'there/b.md': note(5, [0]), 'there/keep.md': note(2) },
			[folder('old'), folder('there'), file('old/a.md'), file('old/b.md')]
		);
		const leaving = await recognize(
			{ 'old/a.md': note(5), 'old/b.md': note(5, [0]), 'old/c.md': note(5, [1]) },
			{ 'new/a.md': note(5), 'new/b.md': note(5, [0]), 'other/c.md': note(5, [1]) },
			[folder('old'), file('old/a.md'), file('old/c.md')]
		);

		// The files were moved one by one and paired as they went; the folder goes last.
		const oneByOne = await recognize(
			{ 'old/a.md': note(5), 'old/b.md': note(5, [0]) },
			{ 'new/a.md': note(5), 'new/b.md': note(5, [0]) },
			[folder('old')],
			new Map([['old/a.md', 'new/a.md'], ['old/b.md', 'new/b.md']])
		);

		assert.deepStrictEqual({ merged: merged.moves, leaving: leaving.moves, oneByOne: [oneByOne.moves, oneByOne.fingerprinted] }, {
			merged: ['old/a.md -> there/a.md [file, sameContent]', 'old/b.md -> there/b.md [file, sameContent]'],
			leaving: ['old/c.md -> other/c.md [file, sameContent]', 'old -> new [folder, folderFiles]'],
			oneByOne: [['old -> new [folder, folderFiles]'], []]
		});
	});
});
