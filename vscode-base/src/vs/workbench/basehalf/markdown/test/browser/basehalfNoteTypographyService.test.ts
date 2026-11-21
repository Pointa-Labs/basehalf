/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IDimension } from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { Emitter } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ConfigurationTarget, IConfigurationChangeEvent } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ILayoutService } from '../../../../../platform/layout/browser/layoutService.js';
import { BASEHALF_CONFIGURATION_NODE, BASEHALF_NOTES_SERIF_FONT, BaseHalfSetting } from '../../../shell/common/basehalfConfiguration.js';
import { BASEHALF_NOTE_TEXT_SIZES, BaseHalfNoteTypographyService } from '../../browser/basehalfNoteTypographyService.js';
import { BASEHALF_NOTE_CODE_FONT_FAMILY_PROPERTY, BASEHALF_NOTE_FONT_FAMILY_PROPERTY, BASEHALF_NOTE_FONT_SIZE_PROPERTY } from '../../common/basehalfNoteTypography.js';

suite('BaseHalfNoteTypographyService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	/** The element of a window drawn in Georgia, and a service over the settings `values`. */
	function setup(values: Record<string, unknown>) {
		const container = mainWindow.document.createElement('div');
		container.style.fontFamily = 'Georgia, serif';
		mainWindow.document.body.appendChild(container);
		store.add({ dispose: () => container.remove() });
		const configuration = new TestConfigurationService(values);
		const service = store.add(new BaseHalfNoteTypographyService(configuration, { mainContainer: container } as Partial<ILayoutService> as ILayoutService));
		const held = () => [BASEHALF_NOTE_FONT_FAMILY_PROPERTY, BASEHALF_NOTE_FONT_SIZE_PROPERTY, BASEHALF_NOTE_CODE_FONT_FAMILY_PROPERTY].map(name => container.style.getPropertyValue(name));
		const change = async (key: string, value: unknown) => {
			await configuration.setUserConfiguration(key, value);
			configuration.onDidChangeConfigurationEmitter.fire({
				affectsConfiguration: (candidate: string) => candidate === key,
				source: ConfigurationTarget.USER
			} as Partial<IConfigurationChangeEvent> as IConfigurationChangeEvent);
		};
		return { service, held, change };
	}

	test('the element of the window holds the typography from the start: the font of the window, 16 px, and the font of code', () => {
		const { service, held } = setup({ 'editor.fontFamily': 'Menlo' });
		assert.deepStrictEqual(
			{ typography: service.typography, held: held() },
			{
				typography: { fontFamily: 'Georgia, serif', fontSize: 16, codeFontFamily: 'Menlo, monospace' },
				held: ['Georgia, serif', '16px', 'Menlo, monospace']
			}
		);
	});

	test('each of the three settings is followed at once, and the element holds the new value when the change is told', async () => {
		const { service, held, change } = setup({ 'editor.fontFamily': 'Menlo' });
		const told: string[] = [];
		// Before the change is told the element still holds the old values, and after it the new ones.
		store.add(service.onWillChange(() => told.push(`will ${held().join(' | ')}`)));
		store.add(service.onDidChange(typography => told.push(`did ${held().join(' | ')} = ${typography.fontSize}`)));

		await change(BaseHalfSetting.NotesFontSize, 20);
		await change(BaseHalfSetting.NotesFontFamily, BASEHALF_NOTES_SERIF_FONT);
		await change('editor.fontFamily', 'Fira Code');
		// A size beyond what a note takes is the largest it takes; a second one beyond it changes nothing.
		await change(BaseHalfSetting.NotesFontSize, 40);
		await change(BaseHalfSetting.NotesFontSize, 60);
		// Another setting is no change of a note's typography.
		await change('editor.fontSize', 30);

		const serif = 'Charter, \'Iowan Old Style\', Georgia, serif, Georgia, serif';
		assert.deepStrictEqual(told, [
			'will Georgia, serif | 16px | Menlo, monospace',
			'did Georgia, serif | 20px | Menlo, monospace = 20',
			'will Georgia, serif | 20px | Menlo, monospace',
			`did ${serif} | 20px | Menlo, monospace = 20`,
			`will ${serif} | 20px | Menlo, monospace`,
			`did ${serif} | 20px | Fira Code, monospace = 20`,
			`will ${serif} | 20px | Fira Code, monospace`,
			`did ${serif} | 28px | Fira Code, monospace = 28`
		]);
		assert.deepStrictEqual(service.typography, { fontFamily: serif, fontSize: 28, codeFontFamily: 'Fira Code, monospace' });
	});

	test('a window that is starting gives its font once its element is laid out, before anything is drawn into it', () => {
		const container = mainWindow.document.createElement('div');
		container.style.fontFamily = 'Georgia, serif';
		store.add({ dispose: () => container.remove() });
		const onDidLayoutMainContainer = store.add(new Emitter<IDimension>());
		const service = store.add(new BaseHalfNoteTypographyService(
			new TestConfigurationService({ [BaseHalfSetting.NotesFontFamily]: 'Charter' }),
			{ mainContainer: container, onDidLayoutMainContainer: onDidLayoutMainContainer.event } as Partial<ILayoutService> as ILayoutService
		));
		const fonts = [service.typography.fontFamily];
		store.add(service.onDidChange(typography => fonts.push(`told ${typography.fontFamily}`)));
		mainWindow.document.body.appendChild(container);
		onDidLayoutMainContainer.fire({ width: 800, height: 600 });
		fonts.push(container.style.getPropertyValue(BASEHALF_NOTE_FONT_FAMILY_PROPERTY));
		// A later layout reads nothing again.
		container.style.fontFamily = 'Times';
		onDidLayoutMainContainer.fire({ width: 900, height: 600 });
		fonts.push(service.typography.fontFamily);
		assert.deepStrictEqual(fonts, [
			'Charter, sans-serif',
			'told Charter, Georgia, serif',
			'Charter, Georgia, serif',
			'Charter, Georgia, serif'
		]);
	});

	test('the text sizes a note takes are the limits and the default the setting is registered with', () => {
		const registered = BASEHALF_CONFIGURATION_NODE.properties![BaseHalfSetting.NotesFontSize];
		assert.deepStrictEqual(
			[BASEHALF_NOTE_TEXT_SIZES, BASEHALF_NOTE_TEXT_SIZES],
			[{ initial: registered.default, minimum: registered.minimum, maximum: registered.maximum }, { initial: 16, minimum: 12, maximum: 28 }]
		);
	});
});
