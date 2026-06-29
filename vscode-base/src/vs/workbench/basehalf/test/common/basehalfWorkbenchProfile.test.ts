/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
	BASEHALF_ACTIVITY_PINNED_VIEW_CONTAINERS_STORAGE_KEY,
	BASEHALF_ACTIVITY_VIEW_CONTAINERS_WORKSPACE_STATE_STORAGE_KEY,
	BASEHALF_ALLOWED_EXTENSION_FAMILIES,
	BASEHALF_ACTIVE_VIEWLET_STORAGE_KEY,
	BASEHALF_CLOSED_STARTUP_EDITOR_TYPE_IDS,
	BASEHALF_CONFIGURATION_DEFAULTS,
	BASEHALF_HIDDEN_SURFACES,
	BASEHALF_LEFT_SIDEBAR_PINNED_VIEW_CONTAINERS,
	BASEHALF_LEFT_SIDEBAR_VIEW_CONTAINER_WORKSPACE_STATE,
	BASEHALF_MIGRATION_MODULE_TRACKS,
	BASEHALF_PRIMARY_VIEW_CONTAINERS,
	BASEHALF_PRODUCT_PROFILE_ID,
	BASEHALF_PROFILE_STORAGE_KEYS_TO_CLEAR,
	BASEHALF_REMAPPED_SURFACES,
	BASEHALF_REQUIRED_MODULE_COMPLETION_GATES,
	BASEHALF_WORKSPACE_STORAGE_KEYS_TO_CLEAR,
	getBaseHalfSurfaceDisposition,
	getIncompleteBaseHalfModuleTracks,
	isBaseHalfAgentExtensionSlot,
	isBaseHalfAllowedBuiltInExtension,
	isBaseHalfPrimaryViewContainer,
	shouldBaseHalfCloseStartupEditor,
	shouldBaseHalfHideViewContainer
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
		assert.strictEqual(getBaseHalfSurfaceDisposition('explorer.openAndPassFocus'), 'remapped');
		assert.strictEqual(getBaseHalfSurfaceDisposition('explorer.upload'), 'remapped');
		assert.strictEqual(getBaseHalfSurfaceDisposition('filesExplorer.paste'), 'remapped');
		assert.strictEqual(getBaseHalfSurfaceDisposition('search.action.openResult'), 'remapped');
		assert.strictEqual(getBaseHalfSurfaceDisposition('workbench.action.quickOpen'), 'remapped');
		assert.strictEqual(getBaseHalfSurfaceDisposition('workbench.action.quickTextSearch'), 'remapped');
		assert.strictEqual(getBaseHalfSurfaceDisposition('workbench.view.extensions'), 'hidden');
		assert.strictEqual(getBaseHalfSurfaceDisposition('workbench.panel.chat'), 'hidden');
		assert.strictEqual(getBaseHalfSurfaceDisposition('workbench.view.debug'), 'hidden');
		assert.strictEqual(getBaseHalfSurfaceDisposition('unknown.surface'), undefined);
	});

	test('declares the VS Code open-entry commands remapped into canvas navigation', () => {
		assert.deepStrictEqual(
			BASEHALF_REMAPPED_SURFACES.filter(surface => surface.area === 'canvas').map(surface => surface.id),
			[
				'workbench.action.files.openFile',
				'explorer.openAndPassFocus',
				'explorer.newFile',
				'explorer.newFolder',
				'explorer.upload',
				'filesExplorer.paste',
				'filesExplorer.openFilePreserveFocus',
				'search.action.openResult',
				'workbench.action.quickOpen',
				'workbench.action.quickTextSearch'
			]
		);
	});

	test('selects hidden view containers without deregistering VS Code registries', () => {
		assert.strictEqual(shouldBaseHalfHideViewContainer('workbench.view.extensions'), true);
		assert.strictEqual(shouldBaseHalfHideViewContainer('workbench.panel.chat'), true);
		assert.strictEqual(shouldBaseHalfHideViewContainer('workbench.view.debug'), true);
		assert.strictEqual(shouldBaseHalfHideViewContainer('workbench.view.extension.test'), true);
		assert.strictEqual(shouldBaseHalfHideViewContainer('workbench.view.remote'), true);
		assert.strictEqual(shouldBaseHalfHideViewContainer('workbench.panel.chat.view.copilot'), false);
		assert.strictEqual(shouldBaseHalfHideViewContainer('terminal'), false);
		assert.strictEqual(shouldBaseHalfHideViewContainer('workbench.view.scm'), false);
	});

	test('declares VS Code activity-bar storage that keeps only BaseHalf sidebar containers pinned', () => {
		assert.strictEqual(BASEHALF_ACTIVITY_PINNED_VIEW_CONTAINERS_STORAGE_KEY, 'workbench.activity.pinnedViewlets2');
		assert.strictEqual(BASEHALF_ACTIVITY_VIEW_CONTAINERS_WORKSPACE_STATE_STORAGE_KEY, 'workbench.activity.viewletsWorkspaceState');
		assert.strictEqual(BASEHALF_ACTIVE_VIEWLET_STORAGE_KEY, 'workbench.sidebar.activeviewletid');

		assert.deepStrictEqual(
			BASEHALF_LEFT_SIDEBAR_PINNED_VIEW_CONTAINERS.filter(surface => surface.pinned).map(surface => surface.id),
			[
				'workbench.view.explorer',
				'workbench.view.scm',
				'workbench.view.search'
			]
		);
		assert.ok(BASEHALF_LEFT_SIDEBAR_PINNED_VIEW_CONTAINERS.some(surface => surface.id === 'workbench.view.extensions' && !surface.pinned && !surface.visible));
		assert.ok(BASEHALF_LEFT_SIDEBAR_PINNED_VIEW_CONTAINERS.some(surface => surface.id === 'workbench.view.debug' && !surface.pinned && !surface.visible));
		assert.ok(BASEHALF_LEFT_SIDEBAR_VIEW_CONTAINER_WORKSPACE_STATE.some(surface => surface.id === 'workbench.view.search' && surface.visible));
		assert.ok(BASEHALF_LEFT_SIDEBAR_VIEW_CONTAINER_WORKSPACE_STATE.some(surface => surface.id === 'workbench.view.remote' && !surface.visible));
	});

	test('defaults the VS Code workbench away from competing startup and agent surfaces', () => {
		assert.strictEqual(BASEHALF_CONFIGURATION_DEFAULTS['workbench.startupEditor'], 'none');
		assert.strictEqual(BASEHALF_CONFIGURATION_DEFAULTS['workbench.welcome.enabled'], false);
		assert.strictEqual(BASEHALF_CONFIGURATION_DEFAULTS['workbench.welcomePage.walkthroughs.openOnInstall'], false);
		assert.strictEqual(BASEHALF_CONFIGURATION_DEFAULTS['workbench.welcomePage.experimentalOnboarding'], false);
		assert.strictEqual(BASEHALF_CONFIGURATION_DEFAULTS['chat.disableAIFeatures'], true);
		assert.strictEqual(BASEHALF_CONFIGURATION_DEFAULTS['chat.agent.enabled'], false);
		assert.strictEqual(BASEHALF_CONFIGURATION_DEFAULTS['chat.agentsControl.enabled'], 'hidden');
		assert.strictEqual(BASEHALF_CONFIGURATION_DEFAULTS['chat.viewSessions.enabled'], false);
		assert.strictEqual(BASEHALF_CONFIGURATION_DEFAULTS['chat.agentsHandoffTip.mode'], 'hidden');
		assert.strictEqual(BASEHALF_CONFIGURATION_DEFAULTS['chat.titleBar.signIn.enabled'], false);
		assert.strictEqual(BASEHALF_CONFIGURATION_DEFAULTS['chat.titleBar.openInAgentsWindow.enabled'], false);
		assert.strictEqual(BASEHALF_CONFIGURATION_DEFAULTS['chat.agentHost.enabled'], false);
		assert.strictEqual(BASEHALF_CONFIGURATION_DEFAULTS['chat.agentHost.claudeAgent.enabled'], false);
		assert.strictEqual(BASEHALF_CONFIGURATION_DEFAULTS['chat.agentHost.codexAgent.enabled'], false);
		assert.strictEqual(BASEHALF_CONFIGURATION_DEFAULTS['chat.agents.claude.preferAgentHost'], false);
		assert.strictEqual(BASEHALF_CONFIGURATION_DEFAULTS['chat.editor.claude.preferAgentHost'], false);
		assert.strictEqual(BASEHALF_CONFIGURATION_DEFAULTS['security.workspace.trust.startupPrompt'], 'never');
		assert.strictEqual(BASEHALF_CONFIGURATION_DEFAULTS['security.workspace.trust.banner'], 'never');
	});

	test('clears restorable VS Code welcome state that bypasses startupEditor', () => {
		assert.deepStrictEqual(BASEHALF_PROFILE_STORAGE_KEYS_TO_CLEAR, ['workbench.welcomePage.restorableWalkthroughs']);
		assert.deepStrictEqual(BASEHALF_WORKSPACE_STORAGE_KEYS_TO_CLEAR, ['workbench.sidebar.activeviewletid']);
	});

	test('closes restored VS Code startup editors that would cover the BaseHalf canvas', () => {
		assert.deepStrictEqual(
			BASEHALF_CLOSED_STARTUP_EDITOR_TYPE_IDS,
			[
				'workbench.editors.gettingStartedInput',
				'workbench.editors.agentSessionsWelcome',
				'workbench.editors.workspaceTrust',
				'workbench.editors.workspaceTrustRequiredEditor'
			]
		);

		assert.strictEqual(shouldBaseHalfCloseStartupEditor('workbench.editors.gettingStartedInput'), true);
		assert.strictEqual(shouldBaseHalfCloseStartupEditor('workbench.editors.agentSessionsWelcome'), true);
		assert.strictEqual(shouldBaseHalfCloseStartupEditor('workbench.editors.textResourceEditor'), false);
		assert.strictEqual(shouldBaseHalfCloseStartupEditor('workbench.input.searchEditor'), false);
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
