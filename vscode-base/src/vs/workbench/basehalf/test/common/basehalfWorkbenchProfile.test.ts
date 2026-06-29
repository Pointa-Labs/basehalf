/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
	BASEHALF_ALLOWED_EXTENSION_FAMILIES,
	BASEHALF_HIDDEN_SURFACES,
	BASEHALF_MIGRATION_MODULE_TRACKS,
	BASEHALF_PRIMARY_VIEW_CONTAINERS,
	BASEHALF_PRODUCT_PROFILE_ID,
	BASEHALF_REMAPPED_SURFACES,
	BASEHALF_REQUIRED_MODULE_COMPLETION_GATES,
	getBaseHalfSurfaceDisposition,
	getIncompleteBaseHalfModuleTracks,
	isBaseHalfAgentExtensionSlot,
	isBaseHalfAllowedBuiltInExtension,
	isBaseHalfPrimaryViewContainer
} from '../../common/basehalfWorkbenchProfile.js';

suite('BaseHalfWorkbenchProfile', () => {
	test('declares only Files, Git, and Search as primary left-sidebar containers', () => {
		assert.strictEqual(BASEHALF_PRODUCT_PROFILE_ID, 'basehalf.canvasWorkbench');
		assert.deepStrictEqual(
			BASEHALF_PRIMARY_VIEW_CONTAINERS.map(surface => surface.id),
			[
				'workbench.view.explorer',
				'workbench.view.scm',
				'workbench.view.search'
			]
		);

		assert.strictEqual(isBaseHalfPrimaryViewContainer('workbench.view.explorer'), true);
		assert.strictEqual(isBaseHalfPrimaryViewContainer('workbench.view.scm'), true);
		assert.strictEqual(isBaseHalfPrimaryViewContainer('workbench.view.search'), true);
		assert.strictEqual(isBaseHalfPrimaryViewContainer('workbench.view.extensions'), false);
		assert.strictEqual(isBaseHalfPrimaryViewContainer('workbench.panel.chat'), false);
		assert.strictEqual(isBaseHalfPrimaryViewContainer('terminal'), false);
	});

	test('classifies stock VS Code surfaces as primary, remapped, or hidden', () => {
		assert.strictEqual(getBaseHalfSurfaceDisposition('workbench.view.explorer'), 'primary');
		assert.strictEqual(getBaseHalfSurfaceDisposition('workbench.scm.repositories'), 'primary');
		assert.strictEqual(getBaseHalfSurfaceDisposition('terminal'), 'remapped');
		assert.strictEqual(getBaseHalfSurfaceDisposition('workbench.action.terminal.new'), 'remapped');
		assert.strictEqual(getBaseHalfSurfaceDisposition('workbench.view.extensions'), 'hidden');
		assert.strictEqual(getBaseHalfSurfaceDisposition('workbench.panel.chat'), 'hidden');
		assert.strictEqual(getBaseHalfSurfaceDisposition('workbench.view.debug'), 'hidden');
		assert.strictEqual(getBaseHalfSurfaceDisposition('unknown.surface'), undefined);
	});

	test('keeps visible, remapped, and hidden surface ids disjoint', () => {
		const primaryIds = new Set<string>(BASEHALF_PRIMARY_VIEW_CONTAINERS.map(surface => surface.id));
		const remappedIds = new Set<string>(BASEHALF_REMAPPED_SURFACES.map(surface => surface.id));
		const hiddenIds = new Set<string>(BASEHALF_HIDDEN_SURFACES.map(surface => surface.id));

		for (const id of primaryIds) {
			assert.strictEqual(remappedIds.has(id), false, `${id} cannot be both primary and remapped`);
			assert.strictEqual(hiddenIds.has(id), false, `${id} cannot be both primary and hidden`);
		}

		for (const id of remappedIds) {
			assert.strictEqual(hiddenIds.has(id), false, `${id} cannot be both remapped and hidden`);
		}
	});

	test('allows only the curated built-in extension families without wildcard marketplace exposure', () => {
		assert.strictEqual(isBaseHalfAllowedBuiltInExtension('vscode.git'), true);
		assert.strictEqual(isBaseHalfAllowedBuiltInExtension('VSCODE.GITHUB-AUTHENTICATION'), true);
		assert.strictEqual(isBaseHalfAllowedBuiltInExtension('vscode.github'), true);
		assert.strictEqual(isBaseHalfAllowedBuiltInExtension('github.copilot'), false);
		assert.strictEqual(isBaseHalfAllowedBuiltInExtension('ms-python.python'), false);
		assert.strictEqual(isBaseHalfAllowedBuiltInExtension('basehalf.basehalf'), false);

		assert.strictEqual(isBaseHalfAgentExtensionSlot('basehalf.agentArea.extension.codex'), true);
		assert.strictEqual(isBaseHalfAgentExtensionSlot('basehalf.agentArea.extension.claude'), true);
		assert.strictEqual(isBaseHalfAgentExtensionSlot('basehalf.sidebar.agent'), false);

		assert.deepStrictEqual(
			BASEHALF_ALLOWED_EXTENSION_FAMILIES.map(family => family.family),
			['git', 'github', 'github-authentication', 'codex', 'claude']
		);
	});

	test('requires every migration module track to carry all product-complete gates', () => {
		assert.deepStrictEqual(getIncompleteBaseHalfModuleTracks(), []);
		assert.deepStrictEqual(
			BASEHALF_REQUIRED_MODULE_COMPLETION_GATES,
			[
				'vscode-source-comparison',
				'keep-delete-boundary',
				'complete-ui-states',
				'interactions',
				'error-empty-loading-states',
				'tests-or-explicit-verification'
			]
		);

		for (const track of BASEHALF_MIGRATION_MODULE_TRACKS) {
			assert.ok(track.vscodeSources.length > 0, `${track.id} must name VS Code source files`);
			assert.ok(track.baselineSources.length > 0, `${track.id} must name old BaseHalf baseline sources`);
			assert.ok(track.keep.length > 0, `${track.id} must state what BaseHalf keeps`);
			assert.ok(track.deleteOrHide.length > 0, `${track.id} must state what gets deleted or hidden`);
			assert.deepStrictEqual(track.completionGates, BASEHALF_REQUIRED_MODULE_COMPLETION_GATES);
		}
	});
});
