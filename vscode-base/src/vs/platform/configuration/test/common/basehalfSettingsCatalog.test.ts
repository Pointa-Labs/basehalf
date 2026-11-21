/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { NullLogService } from '../../../log/common/log.js';
import { BASEHALF_LOCKED_SETTINGS, BASEHALF_SETTING_RULES, baseHalfSettingClass, baseHalfSettingRule, isBaseHalfSettingListed, isBaseHalfSettingLocked } from '../../common/basehalfSettingsCatalog.js';
import { ConfigurationModelParser } from '../../common/configurationModels.js';

/** The catalog of settings and the lock (the settings BaseHalf offers, D137). */
suite('BaseHalf settings catalog', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('a setting has the class of the first rule that names it', () => {
		assert.deepStrictEqual([
			'basehalf.canvas.defaultZoom', 'window.zoomLevel', 'editor.fontSize', 'terminal.integrated.fontSize', 'update.mode',
			'window.commandCenter', 'workbench.editor.showTabs', 'files.autoSave', 'chat.disableAIFeatures', 'task.allowAutomaticTasks',
			'terminal.integrated.persistentSessionScrollback', 'terminal.integrated.enablePersistentSessions', 'terminal.integrated.suggest.enabled',
			'chat.editing.confirmEditRequestRemoval', 'task.autoDetect', 'editor.inlineSuggest.enabled', 'editor.suggest.showMethods', 'terminal.integrated.tabs.location',
			'workbench.browser.pageZoom', 'breadcrumbs.filePath', 'notebook.lineNumbers', 'telemetry.telemetryLevel',
			'editor.suggest.showWords', 'editor.minimap.enabled', 'workbench.localHistory.enabled', 'workbench.colorTheme', 'git.autofetch', 'files.enableTrash',
			'terminal.integrated.cwd', 'terminal.integrated.tabs.title', 'http.proxy', 'window.menuStyle',
			'editor.formatOnSave', 'json.format.enable', 'json.colorDecorators.enable', 'problems.decorations.enabled', 'files.autoSaveWhenNoErrors', 'editor.formatOnType'
		].map(key => `${key}: ${baseHalfSettingClass(key)}`), [
			'basehalf.canvas.defaultZoom: shown', 'window.zoomLevel: shown', 'editor.fontSize: shown', 'terminal.integrated.fontSize: shown', 'update.mode: shown',
			'window.commandCenter: locked', 'workbench.editor.showTabs: locked', 'files.autoSave: locked', 'chat.disableAIFeatures: locked', 'task.allowAutomaticTasks: locked',
			'terminal.integrated.persistentSessionScrollback: pending', 'terminal.integrated.enablePersistentSessions: pending', 'terminal.integrated.suggest.enabled: pending',
			'chat.editing.confirmEditRequestRemoval: unlisted', 'task.autoDetect: unlisted', 'editor.inlineSuggest.enabled: unlisted', 'editor.suggest.showMethods: unlisted', 'terminal.integrated.tabs.location: unlisted',
			'workbench.browser.pageZoom: unlisted', 'breadcrumbs.filePath: unlisted', 'notebook.lineNumbers: unlisted', 'telemetry.telemetryLevel: unlisted',
			'editor.suggest.showWords: advanced', 'editor.minimap.enabled: advanced', 'workbench.localHistory.enabled: advanced', 'workbench.colorTheme: advanced', 'git.autofetch: advanced', 'files.enableTrash: advanced',
			'terminal.integrated.cwd: advanced', 'terminal.integrated.tabs.title: advanced', 'http.proxy: advanced', 'window.menuStyle: advanced',
			'editor.formatOnSave: advanced', 'json.format.enable: advanced', 'json.colorDecorators.enable: unlisted', 'problems.decorations.enabled: advanced', 'files.autoSaveWhenNoErrors: locked', 'editor.formatOnType: unlisted'
		]);
	});

	test('a setting the catalog does not know is listed as advanced, and has no rule', () => {
		assert.deepStrictEqual({
			rule: baseHalfSettingRule('claudeCode.useTerminal'),
			class: baseHalfSettingClass('claudeCode.useTerminal'),
			listed: isBaseHalfSettingListed('claudeCode.useTerminal')
		}, { rule: undefined, class: 'advanced', listed: true });
	});

	test('only the shown and the advanced settings are listed', () => {
		assert.deepStrictEqual(
			['window.zoomLevel', 'editor.minimap.enabled', 'window.commandCenter', 'terminal.integrated.enableBell', 'notebook.lineNumbers'].map(key => isBaseHalfSettingListed(key)),
			[true, true, false, false, false]
		);
	});

	test('every locked setting has a value and is in no other rule\'s place', () => {
		const locked = Object.keys(BASEHALF_LOCKED_SETTINGS);
		assert.strictEqual(locked.length, 49);
		assert.deepStrictEqual(locked.filter(key => BASEHALF_LOCKED_SETTINGS[key] === undefined || !isBaseHalfSettingLocked(key) || baseHalfSettingClass(key) !== 'locked'), []);
		// A rule never claims the class: the locked settings are the ones with a value.
		assert.deepStrictEqual(BASEHALF_SETTING_RULES.filter(rule => rule.class === 'locked'), []);
	});

	test('a settings file cannot set a locked setting, also not for one language', () => {
		const parser = new ConfigurationModelParser('test', new NullLogService());
		parser.parse(JSON.stringify({
			'window.commandCenter': false,
			'workbench.secondarySideBar.forceMaximized': true,
			'editor.fontSize': 20,
			'[plaintext]': { 'breadcrumbs.enabled': true, 'editor.wordWrap': 'on' }
		}));
		const model = parser.configurationModel;
		assert.deepStrictEqual({
			keys: model.keys,
			commandCenter: model.getValue('window.commandCenter'),
			forceMaximized: model.getValue('workbench.secondarySideBar.forceMaximized'),
			fontSize: model.getValue('editor.fontSize'),
			plaintext: model.override('plaintext').getValue('editor.wordWrap'),
			plaintextBreadcrumbs: model.override('plaintext').getValue('breadcrumbs.enabled')
		}, {
			keys: ['editor.fontSize', '[plaintext]'],
			commandCenter: undefined,
			forceMaximized: undefined,
			fontSize: 20,
			plaintext: 'on',
			plaintextBreadcrumbs: undefined
		});
	});

	test('a settings file without a locked setting is read as it is', () => {
		const parser = new ConfigurationModelParser('test', new NullLogService());
		parser.parse(JSON.stringify({ 'editor.fontSize': 20, 'unknown.setting': 1, '[plaintext]': { 'editor.wordWrap': 'on' } }));
		assert.deepStrictEqual(parser.configurationModel.keys, ['editor.fontSize', 'unknown.setting', '[plaintext]']);
	});
});
