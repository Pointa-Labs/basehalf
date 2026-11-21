/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BASEHALF_SETTING_RULES } from '../../../../../platform/configuration/common/basehalfSettingsCatalog.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { baseHalfGeneralSettings, BaseHalfSettingRow, IBaseHalfShownSetting } from '../../browser/basehalfGeneralSettingsPage.js';
import { BASEHALF_CONFIGURATION_NODE } from '../../common/basehalfConfiguration.js';

/** The General page of BaseHalf's Settings, and the row of a setting (BaseHalf's Settings, "The General page"). */
suite('BaseHalf General settings', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	/** What a row wrote, by setting, in order. */
	class RecordingConfigurationService extends TestConfigurationService {
		readonly written: [string, unknown][] = [];
		override updateValue(key: string, value: unknown): Promise<void> {
			this.written.push([key, value]);
			return this.setUserConfiguration(key, value);
		}
	}

	function row(setting: IBaseHalfShownSetting, value: unknown): { element: HTMLElement; service: RecordingConfigurationService; row: BaseHalfSettingRow } {
		const service = new RecordingConfigurationService({});
		void service.setUserConfiguration(setting.key, value);
		const parent = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(parent);
		store.add({ dispose: () => parent.remove() });
		const created = store.add(new BaseHalfSettingRow(parent, setting, 'row', service));
		return { element: parent, service, row: created };
	}

	function change(element: HTMLInputElement | HTMLSelectElement, value: string): void {
		element.value = value;
		element.dispatchEvent(new Event('change'));
	}

	test('the page and About hold the shown settings of the catalog, each once', () => {
		const shown = BASEHALF_SETTING_RULES.filter(rule => rule.class === 'shown').flatMap(rule => rule.patterns)
			.flatMap(pattern => pattern === 'basehalf.*' ? Object.keys(BASEHALF_CONFIGURATION_NODE.properties ?? {}) : [pattern]);
		const general = baseHalfGeneralSettings().flatMap(section => section.settings.map(setting => setting.key));
		assert.deepStrictEqual([...general, 'update.mode'].sort(), [...shown].sort());
	});

	test('the rows of the page, in its order, with a line only under the names that need one', () => {
		assert.deepStrictEqual(baseHalfGeneralSettings().map(section => `${section.title}: ${section.settings.map(setting => `${setting.label}${setting.description ? '*' : ''} (${setting.control.kind})`).join(', ')}`), [
			'Window: Zoom (choice)',
			'Canvas: Zoom of a New Folder* (choice)',
			'Notes: Reading Aids* (switch)',
			'Code: Font (text), Font Size* (number), Wrap Long Lines* (choice)',
			'Files: Show the .bh Folder* (switch)',
			'Agent Area: First Session* (choice), Terminal Font (text), Terminal Font Size (number), Offer the BaseHalf Skill* (switch)'
		]);
	});

	test('a switch shows the value in effect and writes the other one', () => {
		const { element, service } = row({ key: 'a.switch', label: 'A Switch', control: { kind: 'switch' } }, true);
		const control = element.querySelector<HTMLButtonElement>('button[role="switch"]')!;
		const before = control.getAttribute('aria-checked');
		control.click();
		assert.deepStrictEqual({ before, written: service.written }, { before: 'true', written: [['a.switch', false]] });
	});

	test('a choice lists a value that is none of its choices, named as it is written', () => {
		const options = [{ value: 0, label: '100%' }, { value: 1, label: '120%' }];
		const { element, service } = row({ key: 'a.choice', label: 'A Choice', control: { kind: 'choice', options } }, 0.5);
		const select = element.querySelector('select')!;
		const listed = Array.from(select.options).map(option => `${option.value}=${option.textContent}`);
		change(select, '1');
		assert.deepStrictEqual({ listed, chosen: '0.5', written: service.written }, { listed: ['0=100%', '0.5=0.5', '1=120%'], chosen: '0.5', written: [['a.choice', 1]] });
	});

	test('a number outside what the setting takes becomes the nearest it takes, and an emptied field shows the value in effect', () => {
		const { element, service } = row({ key: 'a.number', label: 'A Number', control: { kind: 'number', minimum: 6, maximum: 100 } }, 12);
		const input = element.querySelector('input')!;
		change(input, '500');
		const afterLarge = input.value;
		change(input, '');
		assert.deepStrictEqual({ afterLarge, afterEmpty: input.value, written: service.written }, { afterLarge: '100', afterEmpty: '100', written: [['a.number', 100]] });
	});

	test('a text is written without the spaces around it', () => {
		const { element, service } = row({ key: 'a.text', label: 'A Text', control: { kind: 'text' } }, 'Menlo');
		change(element.querySelector('input')!, '  Fira Code  ');
		assert.deepStrictEqual(service.written, [['a.text', 'Fira Code']]);
	});

	test('a row names its control, and its line describes it', () => {
		const { element } = row({ key: 'a.switch', label: 'A Switch', description: 'One line.', control: { kind: 'switch' } }, false);
		const control = element.querySelector<HTMLButtonElement>('button[role="switch"]')!;
		const label = element.querySelector('label')!;
		assert.deepStrictEqual({
			labelFor: label.htmlFor === control.id,
			described: element.ownerDocument.getElementById(control.getAttribute('aria-describedby')!)?.textContent
		}, { labelFor: true, described: 'One line.' });
	});
});
