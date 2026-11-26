/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IFileStat } from '../../../../../platform/files/common/files.js';
import { BASEHALF_ITEM_RULES_WITHOUT_SETTINGS, BaseHalfItemRulesReader, baseHalfIsFollowedPath, baseHalfIsShownPath, baseHalfItemRules, baseHalfShownEntries } from '../../common/basehalfItemRules.js';

suite('BaseHalf item rules', () => {

	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	const entry = (path: string, isDirectory: boolean): IFileStat => ({ resource: URI.file(`/workspace/${path}`), name: path.slice(path.lastIndexOf('/') + 1), isFile: !isDirectory, isDirectory, isSymbolicLink: false, children: undefined });
	const shown = (rules: ReturnType<typeof baseHalfItemRules>, folder: string, folders: readonly string[], files: readonly string[]) =>
		baseHalfShownEntries(rules, folder, [...folders.map(name => entry(folder ? `${folder}/${name}` : name, true)), ...files.map(name => entry(folder ? `${folder}/${name}` : name, false))]).map(stat => stat.name);

	// The defaults of BaseHalf: the base's, `.bh`, and the agent files of the workspace folder.
	const filesExclude = { '**/.git': true, '**/.svn': true, '**/.DS_Store': true, '**/Thumbs.db': true, '**/.bh': true, 'AGENTS.md': true, 'CLAUDE.md': true };
	const searchExclude = { '**/node_modules': true, '**/bower_components': true, '**/*.code-search': true };

	test('a folder named as a build or a dependency folder has a card, as in Files', () => {
		assert.deepStrictEqual(
			shown(baseHalfItemRules(filesExclude, searchExclude), '', ['src', 'build', 'out', 'dist', 'target', 'vendor', 'node_modules', '.vscode', '.next', '.bh', '.git', '.svn'], ['a.md', 'AGENTS.md', 'CLAUDE.md', '.DS_Store', 'Thumbs.db', 'desktop.ini']),
			['src', 'build', 'out', 'dist', 'target', 'vendor', 'node_modules', '.vscode', '.next', 'a.md']
		);
	});

	test('what files.exclude leaves out has no card: by name, by path, at any depth, by a sibling, and not a pattern that is off', () => {
		const rules = baseHalfItemRules({ ...filesExclude, '**/build': true, 'drafts': true, '**/*.log': true, '**/*.js': { when: '$(basename).ts' }, '**/keep': false }, searchExclude);
		assert.deepStrictEqual({
			root: shown(rules, '', ['build', 'drafts', 'keep', 'notes'], ['a.md', 'run.log', 'a.js', 'a.ts', 'b.js']),
			nested: shown(rules, 'notes', ['build', 'drafts'], ['AGENTS.md', 'x.log', 'x.md'])
		}, {
			root: ['keep', 'notes', 'a.md', 'a.ts', 'b.js'],
			// `drafts` and the agent files are left out of the workspace folder itself only.
			nested: ['drafts', 'AGENTS.md', 'x.md']
		});
	});

	test('what is never an item stays out whatever the settings say', () => {
		const everything = baseHalfItemRules({}, {});
		assert.deepStrictEqual({
			entries: shown(everything, '', ['.bh', '.git', 'docs'], ['CLAUDE.md', 'AGENTS.md', '.DS_Store', 'Thumbs.db', 'desktop.ini', 'a.md']),
			nested: shown(everything, 'docs', ['.bh', '.git'], ['CLAUDE.md', '.DS_Store']),
			paths: ['docs/a.md', '.bh/mirror', 'docs/.bh/attachments/a.png', '.git/config', 'CLAUDE.md', 'docs/CLAUDE.md', 'docs/.DS_Store', '', 'docs//a.md'].map(path => baseHalfIsFollowedPath(everything, path, false))
		}, {
			entries: ['docs', 'a.md'],
			nested: ['CLAUDE.md'],
			paths: [true, false, false, false, false, true, false, false, false]
		});
	});

	test('BaseHalf follows what Search does not leave out, whether Files shows it or not', () => {
		const rules = baseHalfItemRules({ ...filesExclude, 'hidden': true }, { ...searchExclude, 'archive': true });
		const paths = ['notes/a.md', 'build/a.md', 'hidden/a.md', 'node_modules/pkg/readme.md', 'web/node_modules/pkg/readme.md', 'archive/a.md', 'notes/archive/a.md', 'a.code-search'];
		assert.deepStrictEqual({
			followed: paths.filter(path => baseHalfIsFollowedPath(rules, path, false)),
			shown: paths.filter(path => baseHalfIsShownPath(rules, path, false)),
			folders: ['node_modules', 'web/node_modules', 'build'].map(path => baseHalfIsFollowedPath(rules, path, true)),
			walkExclude: rules.walkExclude,
			withoutSettings: paths.filter(path => !baseHalfIsFollowedPath(BASEHALF_ITEM_RULES_WITHOUT_SETTINGS, path, false))
		}, {
			followed: ['notes/a.md', 'build/a.md', 'hidden/a.md', 'notes/archive/a.md'],
			shown: ['notes/a.md', 'build/a.md', 'node_modules/pkg/readme.md', 'web/node_modules/pkg/readme.md', 'archive/a.md', 'notes/archive/a.md', 'a.code-search'],
			folders: [false, false, true],
			walkExclude: { '**/.bh': true, '**/.git': true, '**/node_modules': true, '**/bower_components': true, '**/*.code-search': true, 'archive': true },
			withoutSettings: []
		});
	});

	test('the rules are those of the settings, read again when one of the two changes', async () => {
		const configuration = new TestConfigurationService({ files: { exclude: { 'drafts': true } }, search: { exclude: { '**/node_modules': true } } });
		const reader = disposables.add(new BaseHalfItemRulesReader(configuration));
		const folder = URI.file('/workspace');
		const events: string[] = [];
		disposables.add(reader.onDidChangeShown(() => events.push('shown')));
		disposables.add(reader.onDidChangeFollowed(() => events.push('followed')));
		const read = () => [baseHalfIsShownPath(reader.of(folder), 'drafts/a.md', false), baseHalfIsFollowedPath(reader.of(folder), 'node_modules/a.md', false)];
		const before = read();
		const same = reader.of(folder) === reader.of(folder);
		const change = async (key: string, value: unknown) => {
			await configuration.setUserConfiguration(key, value);
			configuration.onDidChangeConfigurationEmitter.fire({ affectsConfiguration: (changed: string) => changed === key } as Parameters<typeof configuration.onDidChangeConfigurationEmitter.fire>[0]);
		};
		await change('files.exclude', {});
		const shownAgain = read();
		await change('search.exclude', {});
		await change('editor.fontSize', 14);
		assert.deepStrictEqual({ before, same, shownAgain, after: read(), events }, {
			before: [false, false],
			same: true,
			shownAgain: [true, false],
			after: [true, true],
			events: ['shown', 'followed']
		});
	});
});
