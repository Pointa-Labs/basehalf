/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BASEHALF_HIDDEN_COMMAND_FAMILIES, BASEHALF_KEPT_COMMANDS, baseHalfHiddenCommandError, getBaseHalfHiddenCommandFamily, isBaseHalfHiddenCommand } from '../../common/basehalfHiddenCommands.js';
import { BASEHALF_HIDDEN_SURFACES, BASEHALF_REMAPPED_SURFACES } from '../../common/basehalfWorkbenchProfile.js';

suite('BaseHalfHiddenCommands', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('names the family of a command BaseHalf does not have', () => {
		assert.deepStrictEqual(
			[
				'workbench.action.chat.triggerSetup',
				'workbench.action.chat.manageLanguageModelAuthentication',
				'workbench.mcp.listServer',
				'agentsVoice.resetOnboarding',
				'workbench.action.openImagesInCarousel',
				'workbench.action.tasks.runTask',
				'debug.addConfiguration',
				'workbench.action.debug.start',
				'workbench.view.debug',
				'notebook.cell.execute',
				'testing.runAll',
				'workbench.action.remote.showMenu',
				'github.copyVscodeDevLinkFile',
				'workbench.profiles.actions.manageProfiles',
				'workbench.action.browser.open',
				'workbench.view.extensions',
				'workbench.actions.view.problems',
				'files.openTimeline',
				'outline.focus',
				'mergeEditor.acceptMerge',
				'search.action.openNewEditor',
				'workbench.action.output.toggleOutput',
				'workbench.panel.output.focus',
				'workbench.action.positionPanelLeft',
				'workbench.action.splitEditorRight',
				'workbench.action.moveEditorToNextGroup',
				'workbench.action.showMultipleEditorTabs',
				'workbench.editSessions.actions.resetAuth',
				'breadcrumbs.toggle',
				'workbench.action.toggleSidebarPosition',
				'workbench.action.activityBarLocation.bottom',
				'toggle.window.commandCenter',
				'workbench.action.toggleAutoSave',
				'workbench.action.toggleLightDarkThemes',
				'workbench.action.moveView',
				'workbench.action.openWalkthrough',
				'workbench.action.showInteractivePlayground',
				// What Keyboard Shortcuts still listed (D146).
				'editor.action.inlineSuggest.commit',
				'editor.action.accessibleViewAcceptInlineCompletion',
				'editor.action.triggerParameterHints',
				'editor.action.rename',
				'inlayHints.startReadingLineWithHint',
				'workbench.extensions.action.showExtensionsWithIds',
				'editor.action.extensioneditor.showfind',
				'variables.collapse',
				'workbench.action.edits.submit',
				'scm.input.triggerSetup',
				'workbench.scm.action.graph.addHistoryItemToChat',
				'editor.closeTestPeek',
				// What the shell still listed under another name, or of what BaseHalf does not have (D150).
				'workbench.action.togglePanel',
				'basehalf.internal.terminal.toggleView',
				'refactorPreview',
				'refactorPreview.apply',
				'workbench.action.closeEditorsInGroup',
				'workbench.action.openNextRecentlyUsedEditorInGroup',
				'workbench.action.quickOpenLeastRecentlyUsedEditorInGroup',
				'workbench.action.closeEditorsToTheLeft',
				'workbench.action.focusAboveGroupWithoutWrap',
				'workbench.files.action.saveAllInGroup',
				'workbench.action.nextAuxiliaryBarView',
				'workbench.action.selectProductIconTheme',
				'workbench.action.addComment',
				'comments.reply',
				'editor.action.nextCommentThreadAction',
				'workbench.actions.workbench.panel.comments.toggleResolvedComments',
				'workbench.action.terminal.attachToSession',
				'workbench.action.terminal.clearPreviousSessionHistory',
				'terminal.toggleVisibility',
				'terminal.focus',
				'workbench.action.openEditorAtIndex3',
				'workbench.action.focusOtherSideEditor',
				'workbench.action.toggleWindowAlwaysOnTop',
				'workbench.action.enableCompactAuxiliaryWindow',
				'workbench.action.resetViewLocations',
				'workbench.scm.history.resetViewLocation',
				'workbench.view.explorer.resetViewContainerLocation',
				'workbench.action.unifiedQuickAccess'
			].map(getBaseHalfHiddenCommandFamily),
			[
				'chat', 'chat', 'chat', 'chat', 'chat',
				'tasks',
				'debug', 'debug', 'debug',
				'notebooks',
				'testing',
				'remote', 'remote',
				'profiles',
				'browser',
				'marketplace',
				'problems',
				'timeline-and-outline', 'timeline-and-outline',
				'merge-editor',
				'search-editor',
				'panel', 'panel', 'panel',
				'editor-tabs-and-groups', 'editor-tabs-and-groups', 'editor-tabs-and-groups',
				'cloud',
				'shell-shape', 'shell-shape', 'shell-shape', 'shell-shape', 'shell-shape', 'shell-shape', 'shell-shape',
				'welcome', 'welcome',
				'inline-suggestions', 'inline-suggestions',
				'language-service-features', 'language-service-features', 'language-service-features',
				'marketplace', 'marketplace',
				'debug',
				'chat', 'chat', 'chat',
				'testing',
				'panel', 'panel', 'panel', 'panel',
				'editor-tabs-and-groups', 'editor-tabs-and-groups', 'editor-tabs-and-groups', 'editor-tabs-and-groups', 'editor-tabs-and-groups', 'editor-tabs-and-groups',
				'shell-shape',
				'marketplace',
				'comment-threads', 'comment-threads', 'comment-threads', 'comment-threads',
				'terminal-kept-sessions', 'terminal-kept-sessions',
				'panel', 'panel',
				'editor-tabs-and-groups', 'editor-tabs-and-groups', 'editor-tabs-and-groups', 'editor-tabs-and-groups',
				'shell-shape', 'shell-shape', 'shell-shape',
				'chat'
			]
		);
	});

	test('keeps the commands of BaseHalf\'s own surfaces', () => {
		const kept = [
			// Files, Source Control and Git, and Search.
			'explorer.newFile', 'workbench.view.explorer', 'workbench.view.scm', 'workbench.view.search', 'git.commit', 'git.showOutput',
			'merge-conflict.accept.current', 'workbench.action.findInFiles', 'search.action.openResult', 'search.action.replaceAll',
			// The terminal's commands, which the Agent Area takes.
			'workbench.action.terminal.new', 'workbench.action.terminal.split', 'workbench.action.terminal.focus', 'workbench.action.terminal.clear',
			'workbench.action.terminal.toggleTerminal', 'workbench.action.terminal.kill', 'workbench.action.terminal.relaunch',
			// Source's editor.
			'actions.find', 'editor.action.formatDocument', 'editor.fold', 'editor.action.insertCursorBelow', 'editor.action.insertSnippet',
			'workbench.action.openSnippets', 'editor.action.marker.next', 'workbench.action.gotoSymbol', 'workbench.action.closeActiveEditor',
			// The comments of code, and the editors of the one group.
			'editor.action.commentLine', 'editor.action.blockComment', 'editor.action.addCommentLine', 'workbench.action.closeAllEditors',
			'workbench.action.nextEditor', 'workbench.action.openNextRecentlyUsedEditor', 'workbench.action.closeOtherEditors', 'workbench.action.files.saveAll',
			// The parts of the window, and what the base's image preview does in the editor of a deleted picture.
			'workbench.action.focusSideBar', 'workbench.action.focusAuxiliaryBar', 'workbench.action.maximizeAuxiliaryBar', 'workbench.action.nextSideBarView',
			'workbench.action.focusActivityBar', 'workbench.action.selectIconTheme', 'imagePreview.zoomIn',
			// Hiding a view of a part and showing it again, the terminal's own commands, and the windows of the product.
			'workbench.scm.history.toggleVisibility', 'workbench.scm.history.removeView', 'workbench.action.terminal.focusNext', 'workbench.action.switchWindow',
			'workbench.action.toggleFullScreen', 'workbench.action.quickOpen', 'workbench.action.showCommands',
			// The window and its settings.
			'workbench.action.toggleZenMode', 'workbench.action.openGlobalKeybindings', 'workbench.action.selectTheme', 'workbench.action.openSettings',
			'workbench.action.zoomIn', 'workbench.action.toggleSidebarVisibility', 'workbench.action.toggleAuxiliaryBar', 'workbench.action.customizeLayout',
			// Output, which opens as a document, and what a developer needs.
			'workbench.action.showOutputChannels', 'workbench.action.showLogs', 'workbench.action.output.show.main',
			'workbench.action.reloadWindow', 'workbench.action.toggleDevTools', 'workbench.extensions.action.devtoolsExtensionHost',
			'workbench.extensions.action.openExtensionsFolder', 'workbench.extensions.action.extensionHostProfile',
			// What JSON's language service makes, and what the editor does without one.
			'editor.action.triggerSuggest', 'editor.action.showHover', 'editor.action.revealDefinition', 'editor.action.quickFix', 'editor.action.goToReferences',
			// Installing an agent extension, Help, and the new file of the File menu.
			'workbench.extensions.installExtension', 'workbench.action.showAboutDialog', 'workbench.action.openLicenseUrl', 'welcome.showNewFileEntries',
			// The base's plumbing, which Git calls at a commit.
			'_aiEdits.hasAiContributions', '_chat.editSessions.accept', '_open.mergeEditor',
			// BaseHalf's own commands.
			'basehalf.agentArea.newTab', 'basehalf.video.providers', 'pointa.basehalf-ai-video.createWorkflow'
		];
		assert.deepStrictEqual(kept.filter(isBaseHalfHiddenCommand), []);
	});

	test('hides the commands the hidden surfaces name, and none that BaseHalf remaps', () => {
		assert.deepStrictEqual(
			BASEHALF_HIDDEN_SURFACES.filter(surface => surface.kind === 'command' && !isBaseHalfHiddenCommand(surface.id)).map(surface => surface.id),
			[]
		);
		assert.deepStrictEqual(
			BASEHALF_REMAPPED_SURFACES.filter(surface => surface.kind === 'command' && isBaseHalfHiddenCommand(surface.id)).map(surface => surface.id),
			[]
		);
	});

	test('every family has a reason, and no command is listed twice', () => {
		const seen = new Set<string>();
		const problems: string[] = [];
		for (const family of BASEHALF_HIDDEN_COMMAND_FAMILIES) {
			if (!family.reason.trim()) {
				problems.push(`${family.family} has no reason`);
			}
			if (!family.commands.length) {
				problems.push(`${family.family} names no command`);
			}
			for (const command of family.commands) {
				if (command.startsWith('_') && command.includes('*')) {
					problems.push(`${command} names the base's plumbing by a pattern`);
				}
				if (seen.has(command)) {
					problems.push(`${command} is listed twice`);
				}
				seen.add(command);
			}
		}
		assert.deepStrictEqual(problems, []);
		assert.strictEqual(new Set(BASEHALF_HIDDEN_COMMAND_FAMILIES.map(family => family.family)).size, BASEHALF_HIDDEN_COMMAND_FAMILIES.length);
	});

	test('a kept command is one a pattern would hide, and has its reason', () => {
		const stale = BASEHALF_KEPT_COMMANDS.filter(kept => !kept.reason.trim() || !BASEHALF_HIDDEN_COMMAND_FAMILIES.some(family => family.commands.some(command => matches(command, kept.id))));
		assert.deepStrictEqual(stale, []);
		assert.deepStrictEqual(BASEHALF_KEPT_COMMANDS.filter(kept => isBaseHalfHiddenCommand(kept.id)), []);
	});

	test('a pattern matches whole ids only', () => {
		assert.deepStrictEqual(
			['merge.acceptAllInput1', 'merge-conflict.next', 'extensions.sort.name', 'extension.open', 'workbench.action.focusNextGroup', 'workbench.action.focusNextPart', 'xdebug.start', 'debug'].map(isBaseHalfHiddenCommand),
			[true, false, true, false, true, false, false, false]
		);
	});

	test('the error of a hidden command is the base\'s for a command that does not exist', () => {
		assert.strictEqual(baseHalfHiddenCommandError('debug.addConfiguration').message, 'command \'debug.addConfiguration\' not found');
	});
});

function matches(pattern: string, id: string): boolean {
	const literal = pattern.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
	return new RegExp(`^${literal.join('.*')}$`).test(id);
}
