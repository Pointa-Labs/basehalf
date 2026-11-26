/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { BASEHALF_BUILTIN_CARD_PROJECTIONS, BASEHALF_NOTE_FORMS, BASEHALF_NOTES_OPEN_IN_SETTING, baseHalfCardProjectionOpenedIn, BaseHalfCardProjectionRegistryService, DEFAULT_BASEHALF_CARD_DETAIL_PROJECTION, defaultBaseHalfCardDetailProjection, IBaseHalfCardProjectionDescriptor, normalizeBaseHalfCardDetailProjection } from '../../common/basehalfCardDetail.js';
import { BASEHALF_CONFIGURATION_NODE, BASEHALF_NOTES_OPEN_INS, BaseHalfSetting } from '../../../shell/common/basehalfConfiguration.js';
import { baseHalfItemDisplayName, baseHalfNoteFileName, baseHalfNoteNameExtension, isBaseHalfMarkdownResource, isBaseHalfMediaResource } from '../../../workspace/common/basehalfItems.js';

suite('BaseHalfCardDetail', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('uses source as the fallback projection for non-Markdown files', () => {
		assert.strictEqual(DEFAULT_BASEHALF_CARD_DETAIL_PROJECTION, 'source');
		assert.strictEqual(defaultBaseHalfCardDetailProjection(URI.file('/workspace/app.ts')), 'source');
	});

	test('uses rich editing as the Markdown default projection', () => {
		assert.strictEqual(defaultBaseHalfCardDetailProjection(URI.file('/workspace/README.md')), 'rich');
		assert.strictEqual(defaultBaseHalfCardDetailProjection(URI.file('/workspace/docs/guide.markdown')), 'rich');
	});

	test('uses media as the default for supported local media', () => {
		assert.strictEqual(defaultBaseHalfCardDetailProjection(URI.file('/workspace/shot-01.mp4')), 'media');
		assert.strictEqual(defaultBaseHalfCardDetailProjection(URI.file('/workspace/concept.webp')), 'media');
		assert.strictEqual(defaultBaseHalfCardDetailProjection(URI.file('/workspace/textbook.pdf')), 'media');
		assert.strictEqual(isBaseHalfMediaResource(URI.file('/workspace/voice.ogg')), true);
		// The files a card shows, MOV among them (architecture invariants, "Product shell").
		assert.strictEqual(isBaseHalfMediaResource(URI.file('/workspace/edit.mov')), true);
		assert.strictEqual(isBaseHalfMediaResource(URI.file('/workspace/edit.avi')), false);
	});

	test('does not expose binary media through the source projection', () => {
		const registry = new BaseHalfCardProjectionRegistryService(new TestConfigurationService());
		for (const name of ['textbook.pdf', 'concept.webp', 'voice.ogg', 'lesson.mp4']) {
			const resource = URI.file(`/workspace/${name}`);
			assert.deepStrictEqual(registry.getProjections(resource).map(projection => projection.id), ['media']);
			assert.strictEqual(registry.normalizeProjection(resource, 'source'), 'media');
		}
		assert.deepStrictEqual(registry.getProjections(URI.file('/workspace/app.ts')).map(projection => projection.id), ['source']);
		registry.dispose();
	});

	test('normalizes Markdown-only projections to Markdown resources only', () => {
		assert.strictEqual(normalizeBaseHalfCardDetailProjection(URI.file('/workspace/README.md'), 'rich'), 'rich');
		assert.strictEqual(normalizeBaseHalfCardDetailProjection(URI.file('/workspace/README.md'), 'preview'), 'preview');
		assert.strictEqual(normalizeBaseHalfCardDetailProjection(URI.file('/workspace/app.ts'), 'rich'), 'source');
		assert.strictEqual(normalizeBaseHalfCardDetailProjection(URI.file('/workspace/app.ts'), 'preview'), 'source');
		assert.strictEqual(normalizeBaseHalfCardDetailProjection(URI.file('/workspace/app.ts'), undefined), 'source');
	});

	test('recognizes Markdown resources for card detail projections', () => {
		assert.strictEqual(isBaseHalfMarkdownResource(URI.file('/workspace/README.md')), true);
		assert.strictEqual(isBaseHalfMarkdownResource(URI.file('/workspace/docs/guide.markdown')), true);
		assert.strictEqual(isBaseHalfMarkdownResource(URI.file('/workspace/docs/guide.txt')), false);
		assert.strictEqual(isBaseHalfMarkdownResource(URI.file('/workspace/docs/md')), false);
	});

	test('names a note without its extension and every other item by its file name', () => {
		assert.deepStrictEqual(
			[
				['plan.md', false], ['Plan.MD', false], ['plan.markdown', false], ['v1.2.md', false],
				['data.csv', false], ['index.ts', false], ['notes.mdx', false], ['plan', false],
				['docs', true], ['drafts.md', true], ['.md', false]
			].map(([fileName, isFolder]) => [
				baseHalfItemDisplayName(fileName as string, isFolder as boolean),
				baseHalfNoteNameExtension(fileName as string)
			]),
			[
				['plan', '.md'], ['Plan', '.MD'], ['plan', '.markdown'], ['v1.2', '.md'],
				['data.csv', ''], ['index.ts', ''], ['notes.mdx', ''], ['plan', ''],
				['docs', ''], ['drafts.md', '.md'], ['.md', '']
			]
		);
	});

	test('gives a typed note name the extension its file had', () => {
		assert.deepStrictEqual(
			[
				baseHalfNoteFileName('Draft', '.md'),
				baseHalfNoteFileName('Draft', '.MD'),
				baseHalfNoteFileName('draft.md', '.md'),
				baseHalfNoteFileName('draft.MD', '.md'),
				baseHalfNoteFileName('draft.txt', '.md'),
				baseHalfNoteFileName('v1.2', '.markdown'),
				baseHalfNoteFileName('.md', '.md')
			],
			['Draft.md', 'Draft.MD', 'draft.md', 'draft.MD', 'draft.txt.md', 'v1.2.markdown', '.md.md']
		);
	});

	test('registers domain projections without widening a core union', () => {
		const registry = new BaseHalfCardProjectionRegistryService(new TestConfigurationService());
		let changes = 0;
		const listener = registry.onDidChangeProjections(() => changes++);
		const registration = registry.registerProjection({
			id: 'ai-video.storyboard',
			label: 'Storyboard',
			icon: 'codicon-layout',
			selector: { extensions: ['.story-board'] },
			order: 400,
			defaultPriority: 300
		});

		const resource = URI.file('/workspace/episode.story-board');
		assert.deepStrictEqual(registry.getProjections(resource).map(projection => projection.id), ['ai-video.storyboard', 'source']);
		assert.strictEqual(registry.defaultProjection(resource), 'ai-video.storyboard');
		assert.strictEqual(registry.normalizeProjection(resource, 'ai-video.storyboard'), 'ai-video.storyboard');
		assert.strictEqual(registry.normalizeProjection(URI.file('/workspace/episode.md'), 'ai-video.storyboard'), 'rich');
		assert.strictEqual(changes, 1);

		registration.dispose();
		assert.strictEqual(registry.defaultProjection(resource), 'source');
		assert.strictEqual(changes, 2);
		listener.dispose();
		registry.dispose();
	});

	test('matches an exact file name without taking over every file with the same extension', () => {
		const registry = new BaseHalfCardProjectionRegistryService(new TestConfigurationService());
		const registration = registry.registerProjection({
			id: 'pointa.video.sequence',
			label: 'Sequence',
			icon: 'codicon-list-ordered',
			selector: { fileNames: ['sequence.json'] },
			order: 400,
			defaultPriority: 300
		});

		assert.deepStrictEqual(registry.getProjections(URI.file('/workspace/sequence.json')).map(projection => projection.id), ['pointa.video.sequence', 'source']);
		assert.strictEqual(registry.defaultProjection(URI.file('/workspace/sequence.json')), 'pointa.video.sequence');
		assert.deepStrictEqual(registry.getProjections(URI.file('/workspace/shot.json')).map(projection => projection.id), ['source']);
		registration.dispose();
		registry.dispose();
	});

	test('a note opens in the form the setting names, and every other file as before', () => {
		const sequence: IBaseHalfCardProjectionDescriptor = { id: 'pointa.video.sequence', label: 'Sequence', icon: 'codicon-list-ordered', selector: { fileNames: ['sequence.json'] }, order: 400, defaultPriority: 300 };
		const projections = [...BASEHALF_BUILTIN_CARD_PROJECTIONS, sequence];
		const opensIn = (name: string, setting: unknown) => baseHalfCardProjectionOpenedIn(URI.file(`/workspace/${name}`), setting, projections);
		assert.deepStrictEqual(
			['rich', 'preview', 'source', undefined, '', 'media', 'pointa.video.sequence', 'Preview', 7].map(setting => [
				opensIn('plan.md', setting),
				opensIn('Guide.MARKDOWN', setting),
				opensIn('app.ts', setting),
				opensIn('notes.txt', setting),
				opensIn('shot.png', setting),
				opensIn('sequence.json', setting)
			]),
			[
				['rich', 'rich', 'source', 'source', 'media', 'pointa.video.sequence'],
				['preview', 'preview', 'source', 'source', 'media', 'pointa.video.sequence'],
				['source', 'source', 'source', 'source', 'media', 'pointa.video.sequence'],
				// Without a value, and with one that is none of a note's forms, a note opens in Rich.
				['rich', 'rich', 'source', 'source', 'media', 'pointa.video.sequence'],
				['rich', 'rich', 'source', 'source', 'media', 'pointa.video.sequence'],
				['rich', 'rich', 'source', 'source', 'media', 'pointa.video.sequence'],
				['rich', 'rich', 'source', 'source', 'media', 'pointa.video.sequence'],
				['rich', 'rich', 'source', 'source', 'media', 'pointa.video.sequence'],
				['rich', 'rich', 'source', 'source', 'media', 'pointa.video.sequence']
			]
		);
	});

	test('a form the note does not have leaves it in the form the priorities give', () => {
		const withoutPreview = BASEHALF_BUILTIN_CARD_PROJECTIONS.filter(projection => projection.id !== 'preview');
		const changesOnly: IBaseHalfCardProjectionDescriptor[] = [...BASEHALF_BUILTIN_CARD_PROJECTIONS.filter(projection => projection.id !== 'preview'), { id: 'preview', label: 'Preview', icon: 'codicon-preview', selector: { extensions: ['.md'] }, order: 200, isAvailable: () => false }];
		assert.deepStrictEqual([
			baseHalfCardProjectionOpenedIn(URI.file('/workspace/plan.md'), 'preview', withoutPreview),
			baseHalfCardProjectionOpenedIn(URI.file('/workspace/plan.md'), 'preview', changesOnly)
		], ['rich', 'rich']);
	});

	test('the registry reads the setting at each opening, and an opening that names a form keeps it', async () => {
		const configuration = new TestConfigurationService();
		const registry = new BaseHalfCardProjectionRegistryService(configuration);
		const note = URI.file('/workspace/plan.md');
		const code = URI.file('/workspace/app.ts');
		const read = () => [
			registry.defaultProjection(note),
			registry.normalizeProjection(note, undefined),
			registry.normalizeProjection(note, 'rich'),
			registry.normalizeProjection(note, 'source'),
			// A form the file does not have, as Changes once its last change went, is the form a note opens in.
			registry.normalizeProjection(note, 'changes'),
			registry.defaultProjection(code),
			registry.normalizeProjection(code, 'preview')
		];
		const before = read();
		await configuration.setUserConfiguration(BASEHALF_NOTES_OPEN_IN_SETTING, 'preview');
		const preview = read();
		await configuration.setUserConfiguration(BASEHALF_NOTES_OPEN_IN_SETTING, 'source');
		const source = read();
		assert.deepStrictEqual([before, preview, source], [
			['rich', 'rich', 'rich', 'source', 'rich', 'source', 'source'],
			['preview', 'preview', 'rich', 'source', 'preview', 'source', 'source'],
			['source', 'source', 'rich', 'source', 'source', 'source', 'source']
		]);
		registry.dispose();
	});

	test('the setting of the form a note opens in is registered under the name and with the values the registry reads', () => {
		const registered = BASEHALF_CONFIGURATION_NODE.properties![BaseHalfSetting.NotesOpenIn];
		assert.deepStrictEqual(
			[BASEHALF_NOTES_OPEN_IN_SETTING, [...BASEHALF_NOTE_FORMS], registered.enum, registered.default],
			[BaseHalfSetting.NotesOpenIn, [...BASEHALF_NOTES_OPEN_INS], [...BASEHALF_NOTE_FORMS], 'rich']
		);
	});

	test('rejects duplicate projection identifiers', () => {
		const registry = new BaseHalfCardProjectionRegistryService(new TestConfigurationService());
		assert.throws(() => registry.registerProjection({
			id: 'source',
			label: 'Other source',
			icon: 'codicon-code',
			order: 1
		}), /already registered/);
		registry.dispose();
	});
});
