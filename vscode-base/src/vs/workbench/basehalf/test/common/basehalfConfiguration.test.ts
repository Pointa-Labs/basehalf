/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import '../../browser/basehalfConfiguration.contribution.js';
import { Extensions as ConfigurationExtensions, ConfigurationScope, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { tocData } from '../../../contrib/preferences/browser/settingsLayout.js';
import {
	BASEHALF_AGENT_DEFAULT_SESSION,
	BASEHALF_CANVAS_DEFAULT_ZOOM,
	BASEHALF_CANVAS_MAX_ZOOM,
	BASEHALF_CANVAS_MIN_ZOOM,
	BASEHALF_LEGACY_READING_MODE_SETTING,
	BaseHalfSetting,
	isBaseHalfAgentSessionKind,
	migrateLegacyBaseHalfReadingMode,
	normalizeBaseHalfAgentDefaultSession,
	normalizeBaseHalfCanvasZoom
} from '../../common/basehalfConfiguration.js';

suite('BaseHalfConfiguration', () => {
	test('registers the first product settings without BaseHalf Git or update detours', () => {
		const keys = Object.values(BaseHalfSetting);
		assert.deepStrictEqual(keys, [
			'basehalf.editor.readingMode',
			'basehalf.canvas.defaultZoom',
			'basehalf.agent.defaultSession'
		]);

		const properties = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).getConfigurationProperties();
		assert.strictEqual(properties[BaseHalfSetting.EditorReadingMode].section?.title, 'BaseHalf');
		assert.strictEqual(properties[BaseHalfSetting.EditorReadingMode].scope, ConfigurationScope.RESOURCE);
		assert.strictEqual(properties[BaseHalfSetting.EditorReadingMode].default, false);
		assert.ok(properties[BaseHalfSetting.EditorReadingMode].description?.includes('ADHD'));
		assert.strictEqual(properties[BaseHalfSetting.CanvasDefaultZoom].scope, ConfigurationScope.RESOURCE);
		assert.strictEqual(properties[BaseHalfSetting.CanvasDefaultZoom].default, BASEHALF_CANVAS_DEFAULT_ZOOM);
		assert.strictEqual(properties[BaseHalfSetting.AgentDefaultSession].scope, ConfigurationScope.WINDOW);
		assert.strictEqual(properties[BaseHalfSetting.AgentDefaultSession].default, BASEHALF_AGENT_DEFAULT_SESSION);

		for (const key of keys) {
			assert.strictEqual(key.startsWith('basehalf.git.'), false);
			assert.strictEqual(key.startsWith('basehalf.update.'), false);
		}
		assert.strictEqual(Object.keys(properties).some(key => key.startsWith('basehalf.git.') || key.startsWith('basehalf.update.')), false);
	});

	test('exposes BaseHalf as a first-class Settings UI category', () => {
		const basehalf = tocData.children?.find(child => child.id === 'basehalf');
		assert.strictEqual(basehalf?.label, 'BaseHalf');
		assert.deepStrictEqual(basehalf?.children?.map(child => child.id), [
			'basehalf/editor',
			'basehalf/canvas',
			'basehalf/agentArea'
		]);
		assert.deepStrictEqual(basehalf?.children?.map(child => child.settings), [
			['basehalf.editor.*'],
			['basehalf.canvas.*'],
			['basehalf.agent.*']
		]);
	});

	test('normalizes canvas default zoom using the product zoom range', () => {
		assert.strictEqual(BASEHALF_CANVAS_DEFAULT_ZOOM, 1);
		assert.strictEqual(normalizeBaseHalfCanvasZoom(1.25), 1.25);
		assert.strictEqual(normalizeBaseHalfCanvasZoom(Number.NaN), BASEHALF_CANVAS_DEFAULT_ZOOM);
		assert.strictEqual(normalizeBaseHalfCanvasZoom(BASEHALF_CANVAS_MIN_ZOOM - 1), BASEHALF_CANVAS_MIN_ZOOM);
		assert.strictEqual(normalizeBaseHalfCanvasZoom(BASEHALF_CANVAS_MAX_ZOOM + 1), BASEHALF_CANVAS_MAX_ZOOM);
	});

	test('normalizes Agent Area default sessions to the curated five choices', () => {
		assert.strictEqual(BASEHALF_AGENT_DEFAULT_SESSION, 'tui-codex');
		assert.strictEqual(isBaseHalfAgentSessionKind('tui-codex'), true);
		assert.strictEqual(isBaseHalfAgentSessionKind('tui-claude'), true);
		assert.strictEqual(isBaseHalfAgentSessionKind('extension-codex'), true);
		assert.strictEqual(isBaseHalfAgentSessionKind('extension-claude'), true);
		assert.strictEqual(isBaseHalfAgentSessionKind('terminal'), true);
		assert.strictEqual(isBaseHalfAgentSessionKind('git'), false);
		assert.strictEqual(normalizeBaseHalfAgentDefaultSession('terminal'), 'terminal');
		assert.strictEqual(normalizeBaseHalfAgentDefaultSession('git'), BASEHALF_AGENT_DEFAULT_SESSION);
	});

	test('migrates the legacy reading mode key without restoring Core settings as a runtime source', () => {
		assert.deepStrictEqual(migrateLegacyBaseHalfReadingMode(true, undefined), [
			[BaseHalfSetting.EditorReadingMode, { value: true }],
			[BASEHALF_LEGACY_READING_MODE_SETTING, { value: undefined }]
		]);
		assert.deepStrictEqual(migrateLegacyBaseHalfReadingMode(false, true), [
			[BASEHALF_LEGACY_READING_MODE_SETTING, { value: undefined }]
		]);
		assert.deepStrictEqual(migrateLegacyBaseHalfReadingMode('yes', undefined), []);
	});
});
