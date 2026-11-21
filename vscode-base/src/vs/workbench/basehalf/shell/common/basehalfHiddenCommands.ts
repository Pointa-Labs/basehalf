/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The commands of the base that BaseHalf does not have (D141, docs/specs/commands-and-menus.md).
// This module imports nothing, so that the base's services that read it load nothing with it.

export type BaseHalfHiddenCommandFamilyId =
	| 'chat'
	| 'tasks'
	| 'debug'
	| 'notebooks'
	| 'testing'
	| 'remote'
	| 'profiles'
	| 'browser'
	| 'marketplace'
	| 'problems'
	| 'timeline-and-outline'
	| 'merge-editor'
	| 'search-editor'
	| 'panel'
	| 'editor-tabs-and-groups'
	| 'cloud'
	| 'welcome'
	| 'shell-shape'
	| 'inline-suggestions'
	| 'language-service-features'
	| 'comment-threads'
	| 'terminal-kept-sessions';

export interface IBaseHalfHiddenCommandFamily {
	readonly family: BaseHalfHiddenCommandFamilyId;
	/** Command ids. A `*` stands for any run of characters, so that a pattern names a whole family. */
	readonly commands: readonly string[];
	/**
	 * The categories the Command Palette lists the family under, where every command of the category
	 * is the family's. A command of such a category that no pattern names fails the check of the list.
	 */
	readonly paletteCategories: readonly string[];
	readonly reason: string;
}

// A command whose id starts with `_` is the base's plumbing between its own parts: the extensions BaseHalf ships
// call some of them (Git asks `_aiEdits.*` at every commit), so no pattern names them. The few that the Command
// Palette offers are named one by one.

export interface IBaseHalfKeptCommand {
	readonly id: string;
	readonly reason: string;
}

export const BASEHALF_HIDDEN_COMMAND_FAMILIES: readonly IBaseHalfHiddenCommandFamily[] = [
	{
		family: 'chat',
		commands: [
			'workbench.action.chat.*',
			'workbench.action.chatEditor.*',
			'workbench.action.openChat*',
			'workbench.action.quickchat.*',
			'workbench.action.openQuickChat',
			'workbench.action.newChatWindow',
			'workbench.action.openAgent*',
			'workbench.action.openWorkspaceInAgentsWindow',
			'workbench.action.showAgentSessionsQuickAccess',
			'workbench.action.openLanguageModelsJson',
			'workbench.action.askVScode',
			'workbench.action.speech.*',
			'workbench.action.onboarding.*',
			'workbench.action.welcomeOnboarding2026',
			'workbench.action.openImagesInCarousel',
			'workbench.chat.*',
			'workbench.edit.chat.*',
			'workbench.panel.chat*',
			'workbench.command.new.*',
			'chat.*',
			'chatEditing.*',
			'chatEditor.*',
			'inlineChat.*',
			'inlineChat2.*',
			'inlineChatWidget.*',
			'interactiveEditor.*',
			'agentSession.*',
			'agentSessions.*',
			'agentSessionSection.*',
			'agentSessionsViewer.*',
			'aiCustomization.*',
			'aiCustomizationManagement.*',
			'planReviewFeedback.*',
			'agentsVoice.*',
			'voiceTranscripts.*',
			'workbench.view.voiceTranscripts*',
			'workbench.mcp.*',
			'workbench.views.mcp.*',
			'workbench.agentPlugins.*',
			'workbench.views.agentPlugins.*',
			'workbench.action.terminal.chat.*',
			'workbench.action.terminal.startVoice',
			'workbench.action.terminal.stopVoice',
			'workbench.action.editorDictation.*',
			'github.copilot.*',
			'toggle.chat.*',
			'sessions.tunnelHost.*',
			'lm.*',
			'welcome.newWorkspaceChat',
			'search.action.searchWithAI',
			// What Keyboard Shortcuts still listed of the family (D146): the palette never listed these.
			'workbench.action.edits.*',
			'keywordActivation.*',
			'scm.input.triggerSetup',
			'scm.editor.triggerSetup',
			'workbench.scm.action.graph.addHistoryItem*ToChat'
		],
		paletteCategories: ['Chat', 'Inline Chat', 'MCP', 'Voice', 'Agent Sessions', 'Agent Plugins'],
		reason: 'The Agent Area is BaseHalf\'s surface for agents. The base\'s chat, its agents, its tool servers, its voice input, and its setup are off, and none of their commands turns them on.'
	},
	{
		family: 'tasks',
		commands: ['workbench.action.tasks.*'],
		paletteCategories: ['Tasks'],
		reason: 'BaseHalf has no tasks (D137): an agent runs a folder\'s commands in the Agent Area.'
	},
	{
		family: 'debug',
		commands: [
			'debug.*',
			'workbench.debug.*',
			'workbench.action.debug.*',
			'editor.debug.*',
			'repl.*',
			'workbench.panel.repl*',
			'workbench.view.debug*',
			'breakpointWidget.*',
			'closeBreakpointWidget',
			'workbench.action.debugRenderer',
			'workbench.action.debugExtensionHostAndRenderer',
			'workbench.extensions.action.debugExtensionHost',
			// The views of Run and Debug, whose own commands Keyboard Shortcuts still listed (D146).
			'callStack.*',
			'callStackWidget.*',
			'variables.*',
			'watch.*',
			'loadedScripts.*'
		],
		paletteCategories: ['Debug', 'Run and Debug', 'Debug Console'],
		reason: 'No debugger ships, and Run and Debug with its console is hidden.'
	},
	{
		family: 'notebooks',
		commands: [
			'notebook.*',
			'workbench.notebook.*',
			'interactive.*',
			'noteMultiCursor.*',
			'_notebook.selectKernel',
			'workbench.action.toggleNotebookClipboardLog'
		],
		paletteCategories: ['Notebook', 'Interactive Window'],
		reason: 'Nothing ships that opens a notebook.'
	},
	{
		family: 'testing',
		commands: [
			'testing.*',
			'workbench.panel.testResults*',
			'workbench.view.testing.*',
			'workbench.view.testCoverage.*',
			'workbench.view.extension.test*',
			'editor.closeTestPeek'
		],
		paletteCategories: ['Test', 'Testing', 'Test Results'],
		reason: 'No test provider ships, and Testing with its results is hidden.'
	},
	{
		family: 'remote',
		commands: [
			'workbench.action.remote.*',
			'workbench.view.remote*',
			'workbench.remote.*',
			'remote.tunnel.*',
			'workbench.action.openRemoteSettings*',
			'workbench.action.pauseSocketWriting',
			'workbench.action.triggerReconnect',
			'github.copyVscodeDevLink*',
			'github.openOnVscodeDev'
		],
		paletteCategories: ['Remote', 'Remote Tunnels', 'Ports'],
		reason: 'BaseHalf opens local folders: it has no remote window, no forwarded ports, and no link that opens a repository in the base\'s web editor.'
	},
	{
		family: 'profiles',
		commands: ['workbench.profiles.actions.*', 'workbench.action.openProfile.*'],
		paletteCategories: ['Profiles'],
		reason: 'BaseHalf has no profiles (D137): one product with one arrangement has one set of settings.'
	},
	{
		family: 'browser',
		commands: ['workbench.action.browser.*', 'toggle.workbench.browser.*'],
		paletteCategories: ['Browser'],
		reason: 'BaseHalf has no integrated browser (D137): a page opens in the system\'s browser.'
	},
	{
		family: 'marketplace',
		commands: [
			'workbench.view.extensions*',
			'workbench.views.extensions.*',
			'extensions.*',
			'extension.bisect.*',
			'workbench.action.browseColorThemesInMarketplace',
			'workbench.extensions.actions.gallery.signIn',
			// A product icon theme comes only from an extension, and BaseHalf installs none that has one (D150).
			'workbench.action.selectProductIconTheme',
			// The actions of the Extensions view and of an extension's page, which Keyboard Shortcuts still
			// listed by their ids (D146). What a developer needs of the extension host is kept, below.
			'workbench.extensions.action.*',
			'editor.action.extensioneditor.*'
		],
		paletteCategories: [],
		reason: 'BaseHalf has no Extensions view and no Marketplace (D45, D76): it runs its built-in extensions and installs only the agent extensions.'
	},
	{
		family: 'problems',
		commands: [
			'workbench.actions.view.problems',
			'workbench.actions.view.toggleProblems',
			'workbench.action.problems.focus',
			'workbench.panel.markers*',
			'problems.*',
			'workbench.actions.workbench.panel.markers.*',
			'workbench.actions.table.workbench.panel.markers.*',
			'workbench.actions.treeView.workbench.panel.markers.*'
		],
		paletteCategories: ['Problems'],
		reason: 'Problems is a view of the base\'s bottom panel, which BaseHalf\'s shell does not have. The marks of a mistake show in Source, and Go to Next Problem moves between them.'
	},
	{
		family: 'timeline-and-outline',
		commands: ['timeline.*', 'files.openTimeline', 'git.timeline.*', 'github.timeline.*', 'outline.*'],
		paletteCategories: ['Timeline', 'Outline'],
		reason: 'Timeline and Outline are hidden views: the Graph of Source Control shows a file\'s commits, and the note\'s own outline its headings.'
	},
	{
		family: 'merge-editor',
		commands: ['merge.*', 'mergeEditor.*', 'git.openMergeEditor'],
		paletteCategories: ['Merge Editor', 'Merge Editor (Dev)'],
		reason: 'A conflict is resolved in the file with its actions (D123); the merge editor would cover the canvas.'
	},
	{
		family: 'search-editor',
		commands: [
			'search.action.openNewEditor',
			'search.action.openNewEditorToSide',
			'search.action.openNewEditorFromView',
			'search.action.openEditor',
			'search.action.openInEditor',
			'search.searchEditor.*',
			'search.action.focusQueryEditorWidget',
			'search.action.focusFilesToInclude',
			'search.action.focusFilesToExclude',
			'rerunSearchEditorSearch',
			'toggleSearchEditor*',
			'increaseSearchEditorContextLines',
			'decreaseSearchEditorContextLines',
			'selectAllSearchEditorMatches',
			'cleanSearchEditorState'
		],
		paletteCategories: ['Search Editor'],
		reason: 'The Search Editor is an editor tab that would cover the canvas; results stay in the Search view.'
	},
	{
		family: 'panel',
		commands: [
			'workbench.action.focusPanel',
			'workbench.action.closePanel',
			'workbench.action.toggleMaximizedPanel',
			'workbench.action.positionPanel*',
			'workbench.action.alignPanel*',
			'workbench.action.nextPanelView',
			'workbench.action.previousPanelView',
			'workbench.action.movePanelTo*',
			'workbench.action.moveSecondarySideBarToPanel',
			'workbench.action.moveSidePanelToPanel',
			'workbench.action.output.toggleOutput',
			'workbench.panel.output*',
			'workbench.output.action.*',
			'workbench.actions.workbench.panel.output.*',
			'workbench.action.output.activeOutputLogLevel*',
			'workbench.action.openActiveLogOutputFile*',
			'workbench.action.saveActiveLogOutputAs',
			'terminal.focus',
			'workbench.action.terminal.focusTabs',
			'workbench.action.terminal.moveToTerminalPanel',
			// The panel's toggle, which BaseHalf had made one more name for showing the Agent Area, and the toggle of
			// the base's terminal view, which opened the view BaseHalf closes until the window stopped answering (D150).
			'workbench.action.togglePanel',
			'basehalf.internal.terminal.toggleView',
			// The Refactor Preview, a view of the panel.
			'refactorPreview',
			'refactorPreview.*'
		],
		paletteCategories: ['Refactor Preview'],
		reason: 'BaseHalf\'s shell has no bottom panel: terminals are in the Agent Area, and output opens as a document over the canvas.'
	},
	{
		family: 'editor-tabs-and-groups',
		commands: [
			'workbench.action.splitEditor*',
			'workbench.action.joinEditorInGroup',
			'workbench.action.toggleSplitEditorInGroup*',
			'workbench.action.newGroup*',
			'workbench.action.moveEditorTo*Group',
			'workbench.action.moveActiveEditorGroup*',
			'workbench.action.duplicateActiveEditorGroup*',
			'workbench.action.editorLayout*',
			'workbench.action.toggleEditorGroupLayout',
			'workbench.action.focus*Group',
			'workbench.action.navigateEditorGroups',
			'workbench.action.joinTwoGroups',
			'workbench.action.joinAllGroups',
			'workbench.action.closeEditorsInOtherGroups',
			'workbench.action.closeAllGroups',
			'workbench.action.closeEditorInAllGroups',
			'workbench.action.lockEditorGroup',
			'workbench.action.unlockEditorGroup',
			'workbench.action.toggleEditorGroupLock',
			'workbench.action.toggleEditorWidths',
			'workbench.action.evenEditorWidths',
			'workbench.action.minimizeOtherEditors*',
			'workbench.action.maximizeEditor*',
			'workbench.action.toggleMaximizeEditorGroup',
			'workbench.action.copyEditorGroupToNewWindow',
			'workbench.action.moveEditorGroupToNewWindow',
			'workbench.action.copyEditorToNewWindow',
			'workbench.action.moveEditorToNewWindow',
			'workbench.action.restoreEditorsToMainWindow',
			'workbench.action.newEmptyEditorWindow',
			'workbench.action.pinEditor',
			'workbench.action.unpinEditor',
			'workbench.action.keepEditor',
			'workbench.action.closeActivePinnedEditor',
			'workbench.action.toggleKeepEditors',
			'workbench.action.toggleSeparatePinnedEditorTabs',
			'workbench.action.showMultipleEditorTabs',
			'workbench.action.showEditorTab',
			'workbench.action.hideEditorTabs',
			'workbench.action.zenHideEditorTabs',
			'workbench.action.zenShowEditorTab',
			'workbench.action.zenShowMultipleEditorTabs',
			'workbench.action.configureEditorTabs',
			'workbench.action.editorActions*',
			'workbench.action.hideEditorActions',
			'workbench.action.showEditorActions',
			'toggle.workbench.editor.editorActionsLocation',
			'workbench.action.moveEditorLeftInGroup',
			'workbench.action.moveEditorRightInGroup',
			'workbench.action.moveEditorToStart',
			'workbench.action.moveEditorToEnd',
			'workbench.action.toggleEditorVisibility',
			'workbench.action.toggleLockedScrolling',
			'workbench.action.createTerminalEditor*',
			'workbench.action.terminal.moveToEditor',
			'workbench.action.terminal.moveIntoNewWindow',
			'workbench.action.terminal.newInNewWindow',
			'workbench.action.terminal.killEditor',
			// With one group, a command "in Group" does what the same command without the words does (D150).
			'workbench.action.closeEditorsInGroup',
			'workbench.action.nextEditorInGroup',
			'workbench.action.previousEditorInGroup',
			'workbench.action.open*RecentlyUsedEditorInGroup',
			'workbench.action.quickOpen*RecentlyUsedEditorInGroup',
			'workbench.action.showEditorsInActiveGroup',
			'workbench.action.showEditorsInGroup',
			'workbench.files.action.saveAllInGroup',
			// The order of tabs, which BaseHalf does not show.
			'workbench.action.closeEditorsToTheLeft',
			'workbench.action.closeEditorsToTheRight',
			'workbench.action.firstEditorInGroup',
			'workbench.action.lastEditorInGroup',
			// A group among several.
			'workbench.action.closeGroup',
			'workbench.action.focus*GroupWithoutWrap',
			'layoutEditorGroups'
		],
		paletteCategories: [],
		reason: 'A file opens in Card Detail, and there is one editor group without tabs: BaseHalf takes a split back, and a tab, a pinned editor, or an editor in a window of its own has no place to show.'
	},
	{
		family: 'cloud',
		commands: ['workbench.editSessions.*', 'workbench.userDataSync.*', 'workbench.userData.actions.*', 'workbench.action.continueOn.*'],
		paletteCategories: ['Cloud Changes', 'Settings Sync'],
		reason: 'No service is configured that would keep changes or settings in the cloud.'
	},
	{
		family: 'welcome',
		commands: [
			'workbench.action.openWalkthrough',
			'welcome.showAllWalkthroughs',
			'welcome.goBack',
			'welcome.markStep*',
			'walkthroughs.*',
			'resetGettingStartedProgress',
			'workbench.action.showInteractivePlayground',
			'workbench.action.interactivePlayground.*',
			'workbench.action.getStartedWithAccessibilityFeatures'
		],
		paletteCategories: [],
		reason: 'An empty window shows the Welcome page by itself, and in a folder BaseHalf closes it, so opening it there does nothing; a walkthrough and the editor playground are the base\'s own tutorials, and the playground would cover the canvas.'
	},
	{
		family: 'shell-shape',
		commands: [
			'breadcrumbs.*',
			'workbench.action.toggleSidebarPosition',
			'workbench.action.moveSideBarLeft',
			'workbench.action.moveSideBarRight',
			'workbench.action.activityBarLocation.*',
			'workbench.action.toggleActivityBarVisibility',
			'toggle.window.commandCenter',
			'toggle.window.customTitleBarVisibility*',
			'toggle.toggleCustomTitleBar',
			'hideCustomTitleBar*',
			'showCustomTitleBar',
			'workbench.action.toggleAutoSave',
			'workbench.action.toggleLightDarkThemes',
			'workbench.trust.*',
			'workbench.action.newWindowTab',
			'workbench.action.showNextWindowTab',
			'workbench.action.showPreviousWindowTab',
			'workbench.action.moveWindowTabToNewWindow',
			'workbench.action.mergeAllWindowTabs',
			'workbench.action.toggleWindowTabsBar',
			'workbench.action.moveView',
			'workbench.action.moveFocusedView',
			// Settings and Output stand in the overlay: moved out of it, they would stand over the canvas as editors.
			'workbench.action.moveModalEditorToMain',
			'workbench.action.moveModalEditorToWindow',
			// The Agent Area has one view: there is no next one to step to (D150).
			'workbench.action.nextAuxiliaryBarView',
			'workbench.action.previousAuxiliaryBarView'
		],
		paletteCategories: [],
		reason: 'Each only changes what BaseHalf keeps as it is: it writes a setting that BaseHalf keeps at its own value (D137), needs one at another value, as the tabs of the system\'s windows do, switches to a theme BaseHalf never switches to, or moves a view out of its place.'
	},
	{
		family: 'inline-suggestions',
		commands: ['editor.action.inlineSuggest.*', 'editor.action.accessibleViewAcceptInlineCompletion'],
		paletteCategories: [],
		reason: 'Inline suggestions and inline edits have no provider in BaseHalf: the base\'s chat extension makes them, and it does not run (D137 has their settings as unlisted).'
	},
	{
		family: 'language-service-features',
		commands: [
			'editor.action.triggerParameterHints',
			'closeParameterHints',
			'showNextParameterHint',
			'showPrevParameterHint',
			'editor.inlayHints.*',
			'inlayHints.*',
			'editor.action.rename',
			'acceptRenameInput',
			'acceptRenameInputWithPreview',
			'cancelRenameInput',
			'focusNextRenameSuggestion',
			'focusPreviousRenameSuggestion',
			'editor.action.linkedEditing',
			'cancelLinkedEditingInput'
		],
		paletteCategories: [],
		reason: 'Parameter hints, inlay hints, renaming a symbol, and linked editing come from a language service, and JSON\'s, the one that runs (D142), makes none of them (D137 has their settings as unlisted).'
	},
	{
		family: 'comment-threads',
		commands: [
			'comments.*',
			'commentsClearFilterText',
			'commentsFocusFilter',
			'commentsFocusViewFromFilter',
			'workbench.action.addComment',
			'workbench.action.collapseAllComments',
			'workbench.action.expandAllComments',
			'workbench.action.expandUnresolvedComments',
			'workbench.action.focusCommentOnCurrentLine',
			'workbench.action.hideComment',
			'workbench.action.toggleCommenting',
			'workbench.panel.comments*',
			'workbench.actions.workbench.panel.comments.*',
			'editor.action.nextCommentThreadAction',
			'editor.action.previousCommentThreadAction',
			'editor.action.nextCommentedRangeAction',
			'editor.action.previousCommentedRangeAction',
			'editor.action.nextCommentingRange',
			'editor.action.previousCommentingRange',
			'editor.action.submitComment'
		],
		paletteCategories: ['Comments'],
		reason: 'A thread of comments comes from an extension that provides comments, and BaseHalf runs none. The comments of code, Toggle Line Comment and the like, are the editor\'s own and stay.'
	},
	{
		family: 'terminal-kept-sessions',
		commands: [
			'workbench.action.terminal.attachToSession',
			'workbench.action.terminal.detachSession',
			'workbench.action.terminal.clearPreviousSessionHistory'
		],
		paletteCategories: [],
		reason: 'The base keeps the process of a terminal through a reload. BaseHalf brings back the arrangement of the Agent Area and starts every session anew (D147), so there is no kept session to attach to.'
	}
];

/**
 * Commands that a pattern above names and that BaseHalf has. Each needs its reason: a kept command is
 * offered and runs like any other.
 */
export const BASEHALF_KEPT_COMMANDS: readonly IBaseHalfKeptCommand[] = [
	{ id: 'workbench.extensions.action.devtoolsExtensionHost', reason: 'A developer debugs the extension host, which runs the agent extensions and BaseHalf\'s own.' },
	{ id: 'workbench.extensions.action.openExtensionsFolder', reason: 'A developer looks at the folder an agent extension was installed into.' },
	{ id: 'workbench.extensions.action.extensionHostProfile', reason: 'The profiler of the extension host, a developer\'s tool.' },
	{ id: 'workbench.extensions.action.stopExtensionHostProfile', reason: 'The profiler of the extension host, a developer\'s tool.' },
	{ id: 'workbench.extensions.action.saveExtensionHostProfile', reason: 'The profiler of the extension host, a developer\'s tool.' },
	{ id: 'workbench.extensions.action.openExtensionHostProfile', reason: 'The profiler of the extension host, a developer\'s tool.' }
];

/**
 * Commands that BaseHalf has and that no menu holds but the Command Palette's (D150): a tool that few use is
 * found by its name, not beside what everyone uses. Keyboard Shortcuts lists it like any other command.
 */
export const BASEHALF_PALETTE_ONLY_COMMANDS: readonly IBaseHalfKeptCommand[] = [
	{ id: 'workbench.action.openSnippets', reason: 'Configure Snippets makes snippets for code, a tool of Source: it is not beside Settings in the gear\'s menu and the Preferences menu.' }
];

const PALETTE_ONLY_COMMAND_IDS = new Set<string>(BASEHALF_PALETTE_ONLY_COMMANDS.map(command => command.id));

/** Whether the command is in no menu but the Command Palette's. */
export function isBaseHalfPaletteOnlyCommand(commandId: string): boolean {
	return PALETTE_ONLY_COMMAND_IDS.has(commandId);
}

/**
 * Whether the command is one of BaseHalf's own, by its id. Keyboard Shortcuts lists such a command by its name:
 * one that has neither a key nor an entry of the Command Palette is a command of a menu, which takes what the
 * menu was opened on, or one that BaseHalf's parts call, and is not listed (D150).
 */
export function isBaseHalfOwnCommand(commandId: string): boolean {
	return commandId.startsWith('basehalf.') || commandId.startsWith('pointa.');
}

const KEPT_COMMAND_IDS = new Set<string>(BASEHALF_KEPT_COMMANDS.map(command => command.id));
const HIDDEN_COMMAND_IDS = new Map<string, BaseHalfHiddenCommandFamilyId>();
const HIDDEN_COMMAND_PATTERNS: { readonly family: BaseHalfHiddenCommandFamilyId; readonly pattern: RegExp }[] = [];
for (const { family, commands } of BASEHALF_HIDDEN_COMMAND_FAMILIES) {
	for (const command of commands) {
		if (command.includes('*')) {
			HIDDEN_COMMAND_PATTERNS.push({ family, pattern: baseHalfCommandPatternToRegExp(command) });
		} else {
			HIDDEN_COMMAND_IDS.set(command, family);
		}
	}
}

// A menu asks about every one of its items each time it is drawn.
const familyOfCommand = new Map<string, BaseHalfHiddenCommandFamilyId | undefined>();

function baseHalfCommandPatternToRegExp(pattern: string): RegExp {
	const literal = pattern.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
	return new RegExp(`^${literal.join('.*')}$`);
}

/** The family of a command that BaseHalf does not have, or `undefined` for a command it has. */
export function getBaseHalfHiddenCommandFamily(commandId: string): BaseHalfHiddenCommandFamilyId | undefined {
	if (familyOfCommand.has(commandId)) {
		return familyOfCommand.get(commandId);
	}
	let family: BaseHalfHiddenCommandFamilyId | undefined;
	if (!KEPT_COMMAND_IDS.has(commandId)) {
		family = HIDDEN_COMMAND_IDS.get(commandId) ?? HIDDEN_COMMAND_PATTERNS.find(({ pattern }) => pattern.test(commandId))?.family;
	}
	familyOfCommand.set(commandId, family);
	return family;
}

/**
 * Whether BaseHalf does not have the command: the Command Palette and the menus leave it out, no key
 * runs it, and executing it by its id fails as executing a command that does not exist.
 */
export function isBaseHalfHiddenCommand(commandId: string): boolean {
	return getBaseHalfHiddenCommandFamily(commandId) !== undefined;
}

/** The error of executing a command that BaseHalf does not have: the base's own for an unknown command. */
export function baseHalfHiddenCommandError(commandId: string): Error {
	return new Error(`command '${commandId}' not found`);
}
