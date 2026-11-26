/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BASEHALF_SETTING_RULES } from '../../../../../platform/configuration/common/basehalfSettingsCatalog.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { BaseHalfSettingRow } from '../../browser/basehalfSettingsListPage.js';
import { baseHalfShownSettings, IBaseHalfShownSetting } from '../../browser/basehalfShownSettings.js';
import { BASEHALF_CONFIGURATION_NODE } from '../../common/basehalfConfiguration.js';
import { BaseHalfSettingsListPageId } from '../../common/basehalfSettings.js';

/** The pages of BaseHalf's Settings that list settings, and the row of a setting (BaseHalf's Settings, "The pages"). */
suite('BaseHalf settings list pages', () => {
	const pages: readonly BaseHalfSettingsListPageId[] = ['general', 'canvas', 'notes', 'agentArea'];
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

	test('the pages and About hold the shown settings of the catalog, each once: every setting of BaseHalf\'s own is on a page', () => {
		const shown = BASEHALF_SETTING_RULES.filter(rule => rule.class === 'shown').flatMap(rule => rule.patterns)
			.flatMap(pattern => pattern === 'basehalf.*' ? Object.keys(BASEHALF_CONFIGURATION_NODE.properties ?? {}) : [pattern]);
		const listed = pages.flatMap(page => baseHalfShownSettings(page)).flatMap(section => section.settings.map(setting => setting.key));
		assert.deepStrictEqual([...listed, 'update.mode'].sort(), [...shown].sort());
	});

	test('the rows of each page, in its order, with a line only under the names that need one', () => {
		assert.deepStrictEqual(pages.flatMap(page => baseHalfShownSettings(page).map(section => `${page} / ${section.title ?? '-'}: ${section.settings.map(setting => `${setting.label}${setting.description ? '*' : ''} (${setting.control.kind})`).join(', ')}`)), [
			'general / Window: Appearance (choice), Match the System* (switch), Zoom* (choice)',
			'general / Code: Font (text), Font Size* (number), Wrap Long Lines* (choice)',
			'general / Files: Show the .bh Folder* (switch)',
			'canvas / -: Zoom of a New Folder* (choice), Mouse Wheel* (choice), Snap to Cards* (switch), Background (choice), Play Videos Under the Pointer* (switch)',
			'notes / -: Font* (choice), Text Size* (number), Opens In (choice), Reading Aids* (switch)',
			'agentArea / Sessions: First Session* (choice), Reopen Sessions* (switch)',
			'agentArea / Terminal: Font (text), Font Size (number)',
			'agentArea / Agents: Offer the BaseHalf Skill* (switch), Share the Selection* (switch)'
		]);
	});

	test('a choice shows the value of a setting that is an empty text, and a font that is none of the choices by its own name', () => {
		const font = baseHalfShownSettings('notes').flatMap(section => section.settings).find(setting => setting.key === 'basehalf.notes.fontFamily')!;
		const standard = row(font, '').element.querySelector('select')!;
		const own = row(font, 'Avenir Next').element.querySelector('select')!;
		assert.deepStrictEqual({
			standard: standard.selectedOptions[0]?.textContent,
			own: own.selectedOptions[0]?.textContent,
			listed: Array.from(own.options).map(option => option.textContent)
		}, { standard: 'Default', own: 'Avenir Next', listed: ['Default', 'Serif', 'Monospace', 'Avenir Next'] });
	});

	test('a check box shows the value in effect and writes the other one', () => {
		const { element, service } = row({ key: 'a.switch', label: 'A Switch', control: { kind: 'switch' } }, true);
		const control = element.querySelector<HTMLButtonElement>('button[role="checkbox"]')!;
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

	test('the zoom of a window that is none of the choices is listed by its percentage', () => {
		const zoom = baseHalfShownSettings('general').flatMap(section => section.settings).find(setting => setting.key === 'window.zoomLevel')!;
		const { element } = row(zoom, 0.5);
		const select = element.querySelector('select')!;
		assert.deepStrictEqual({ chosen: select.selectedOptions[0]?.textContent, around: Array.from(select.options).map(option => option.textContent).slice(3, 6) }, { chosen: '110%', around: ['100%', '110%', '120%'] });
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

	test('an emptied text is written as no value', () => {
		const { element, service } = row({ key: 'a.text', label: 'A Text', control: { kind: 'text' } }, 'Menlo');
		change(element.querySelector('input')!, '   ');
		assert.deepStrictEqual(service.written, [['a.text', undefined]]);
	});

	test('a check box changes as it is clicked, so a second click is its way back', () => {
		const { element, service } = row({ key: 'a.switch', label: 'A Switch', control: { kind: 'switch' } }, false);
		const control = element.querySelector<HTMLButtonElement>('button[role="checkbox"]')!;
		control.click();
		control.click();
		assert.deepStrictEqual(service.written, [['a.switch', true], ['a.switch', false]]);
	});

	test('a check box is named by the setting\'s name and described by its line, and a press on the line changes it', () => {
		const { element, service } = row({ key: 'a.switch', label: 'A Switch', description: 'One line.', control: { kind: 'switch' } }, false);
		const control = element.querySelector<HTMLButtonElement>('button[role="checkbox"]')!;
		const line = element.querySelector<HTMLLabelElement>('label.basehalf-settings-row-description')!;
		const named = element.ownerDocument.getElementById(control.getAttribute('aria-labelledby')!)?.textContent;
		const described = element.ownerDocument.getElementById(control.getAttribute('aria-describedby')!)?.textContent;
		line.click();
		assert.deepStrictEqual({ named, described, lineFor: line.htmlFor === control.id, written: service.written }, { named: 'A Switch', described: 'One line.', lineFor: true, written: [['a.switch', true]] });
	});

	test('a field is labelled by the setting\'s name, and its line, above it, describes it', () => {
		const { element } = row({ key: 'a.text', label: 'A Text', description: 'One line.', control: { kind: 'text' } }, 'Menlo');
		const input = element.querySelector('input')!;
		const label = element.querySelector<HTMLLabelElement>('label.basehalf-settings-row-label')!;
		const order = Array.from(element.querySelector('.basehalf-settings-row')!.children).map(child => child.className.split(' ')[0]);
		assert.deepStrictEqual({
			labelFor: label.htmlFor === input.id,
			described: element.ownerDocument.getElementById(input.getAttribute('aria-describedby')!)?.textContent,
			order
		}, { labelFor: true, described: 'One line.', order: ['basehalf-settings-row-label', 'basehalf-settings-row-description', 'basehalf-settings-row-value'] });
	});

	test('a setting that a settings file sets has the mark of a changed setting, and one with no value has none', () => {
		const set = row({ key: 'a.text', label: 'A Text', control: { kind: 'text' } }, 'Menlo').element.querySelector('.basehalf-settings-row')!;
		const unset = row({ key: 'b.text', label: 'B Text', control: { kind: 'text' } }, undefined).element.querySelector('.basehalf-settings-row')!;
		assert.deepStrictEqual({ set: set.classList.contains('is-configured'), unset: unset.classList.contains('is-configured') }, { set: true, unset: false });
	});
});
