/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The catalog of settings (the settings BaseHalf offers, D137): the class of every setting that
 * the base and the extensions that ship register, and the value of each setting that BaseHalf
 * keeps. It imports nothing, so that every process reads the same rules: the reading of a
 * settings file, which drops a locked setting, the lists of Settings, and the check that names a
 * setting without a class.
 */

/**
 * - `shown`: BaseHalf's Settings lists it, and the advanced list does.
 * - `advanced`: the advanced list holds it; it works as in the base.
 * - `locked`: BaseHalf's value holds, whatever a settings file says; no list shows it.
 * - `pending`: a surface of BaseHalf's has or could have what it names and does not follow it
 *   yet; no list shows it until the surface does.
 * - `unlisted`: it belongs to what BaseHalf does not have; no list shows it.
 */
export type BaseHalfSettingClass = 'shown' | 'advanced' | 'locked' | 'pending' | 'unlisted';

export interface IBaseHalfSettingRule {
	readonly class: BaseHalfSettingClass;
	/** What the settings of the rule have in common, in the words of the specification. */
	readonly family: string;
	/** Names of settings; `*` stands for any text. */
	readonly patterns: readonly string[];
}

/**
 * The settings BaseHalf keeps, each with its value, under the reason it is kept. A value in a
 * settings file has no effect on them.
 */
export const BASEHALF_LOCKED_SETTINGS: Readonly<Record<string, unknown>> = Object.freeze({
	// The title bar is BaseHalf's: the location, its search, and the buttons of the window.
	'window.commandCenter': true,
	'window.customTitleBarVisibility': 'auto',
	'window.titleBarStyle': 'custom',
	'window.nativeTabs': false,
	'window.nativeFullScreen': true,
	// BaseHalf has no editor tabs.
	'workbench.editor.showTabs': 'none',
	'zenMode.showTabs': 'none',
	'breadcrumbs.enabled': false,
	// The shape of the shell: Files, Git, and Search at the left with their icons above, the Agent Area at the right, each a card.
	'workbench.activityBar.location': 'top',
	'workbench.sideBar.location': 'left',
	'workbench.experimental.modernUI': true,
	// Nothing covers the canvas by a setting.
	'workbench.secondarySideBar.forceMaximized': false,
	'workbench.secondarySideBar.defaultVisibility': 'visibleInWorkspace',
	'workbench.panel.opensMaximized': 'never',
	'workbench.panel.defaultLocation': 'bottom',
	'workbench.editor.useModal': 'some',
	'workbench.startupEditor': 'welcomePageInEmptyWorkbench',
	'workbench.welcomePage.walkthroughs.openOnInstall': false,
	'workbench.welcomePage.experimentalOnboarding': false,
	'search.mode': 'view',
	'git.mergeEditor': false,
	'scm.workingSets.enabled': false,
	'scm.workingSets.default': 'current',
	// Files save by themselves: nothing in BaseHalf shows an unsaved file, and agents read the disk.
	'files.autoSave': 'afterDelay',
	'files.autoSaveWhenNoErrors': false,
	// The base's AI features stay off.
	'chat.disableAIFeatures': true,
	'chat.agent.enabled': false,
	'chat.agentsControl.enabled': 'hidden',
	'chat.unifiedAgentsBar.enabled': false,
	'chat.agentSessionProjection.enabled': false,
	'chat.viewSessions.enabled': false,
	'chat.agentsHandoffTip.mode': 'hidden',
	'chat.titleBar.signIn.enabled': false,
	'chat.titleBar.openInAgentsWindow.enabled': false,
	'chat.agentHost.enabled': false,
	'chat.agentHost.claudeAgent.enabled': false,
	'chat.agentHost.codexAgent.enabled': false,
	'chat.agents.claude.preferAgentHost': false,
	'chat.editor.claude.preferAgentHost': false,
	// Workspace trust stays off: BaseHalf has no surface for it, and an untrusted folder would run without Git.
	'security.workspace.trust.enabled': false,
	'security.workspace.trust.startupPrompt': 'never',
	'security.workspace.trust.banner': 'never',
	'security.workspace.trust.untrustedFiles': 'prompt',
	'security.workspace.trust.emptyWindow': true,
	// Hidden surfaces stay shut, and a folder starts no task by itself.
	'task.allowAutomaticTasks': 'off',
	'debug.internalConsoleOptions': 'neverOpen',
	'testing.automaticallyOpenPeekView': 'never',
	'testing.automaticallyOpenTestResults': 'neverOpen',
	'testing.countBadge': 'off'
});

/**
 * The rules, read in order: the first rule that names a setting gives its class. A locked setting
 * is named by `BASEHALF_LOCKED_SETTINGS` and comes before every rule here.
 */
export const BASEHALF_SETTING_RULES: readonly IBaseHalfSettingRule[] = [
	// Shown: BaseHalf's Settings lists them under its own names.
	{ class: 'shown', family: 'BaseHalf', patterns: ['basehalf.*'] },
	{ class: 'shown', family: 'Appearance', patterns: ['workbench.colorTheme', 'window.autoDetectColorScheme'] },
	{ class: 'shown', family: 'Window size', patterns: ['window.zoomLevel'] },
	{ class: 'shown', family: 'Code font', patterns: ['editor.fontFamily', 'editor.fontSize', 'editor.wordWrap'] },
	{ class: 'shown', family: 'Terminal font', patterns: ['terminal.integrated.fontFamily', 'terminal.integrated.fontSize'] },
	{ class: 'shown', family: 'Updates', patterns: ['update.mode'] },
	// Advanced: they work as in the base.
	{
		class: 'advanced', family: 'Agent Area: the name of a session', patterns: [
			'terminal.integrated.tabs.title', 'terminal.integrated.tabs.description', 'terminal.integrated.tabs.separator', 'terminal.integrated.tabs.allowAgentCliTitle'
		]
	},
	// Unlisted: they belong to what BaseHalf does not have.
	{
		class: 'unlisted', family: 'Agent Area: the processes of sessions kept through a reload', patterns: [
			'terminal.integrated.enablePersistentSessions', 'terminal.integrated.persistentSession*'
		]
	},
	{ class: 'unlisted', family: 'Agent Area: a setting of the bell the base retired', patterns: ['terminal.integrated.enableBell'] },
	{ class: 'advanced', family: 'Agent Area: the bell', patterns: ['terminal.integrated.enableVisualBell', 'terminal.integrated.bellDuration'] },
	{ class: 'advanced', family: 'Agent Area: closing with a session running', patterns: ['terminal.integrated.confirmOnExit', 'terminal.integrated.confirmOnKill'] },
	{
		class: 'advanced', family: 'Agent Area: clicks and the accessible view', patterns: [
			'terminal.integrated.rightClickBehavior', 'terminal.integrated.middleClickBehavior', 'terminal.integrated.accessibleView*'
		]
	},
	{ class: 'advanced', family: 'Agent Area: the folder of a split', patterns: ['terminal.integrated.splitCwd'] },
	{ class: 'unlisted', family: 'Agent Area: suggestions of a shell', patterns: ['terminal.integrated.suggest.*'] },
	{
		class: 'advanced', family: 'JSON files: formatting, suggestions, and marks', patterns: [
			'editor.formatOnSave', 'editor.formatOnSaveMode', 'editor.formatOnPaste', 'editor.defaultFormatter', 'editor.codeActionsOnSave', 'editor.suggest.showProperties',
			'editor.suggest.showValues', 'editor.suggest.showModules', 'editor.suggest.showConstants', 'problems.decorations.enabled', 'problems.visibility',
			'problems.showCurrentInStatus', 'accessibility.signals.lineHasError', 'accessibility.signals.lineHasWarning', 'accessibility.signals.positionHasError',
			'accessibility.signals.positionHasWarning', 'accessibility.signals.format', 'accessibility.signalOptions.experimental.delays.warningAtPosition',
			'accessibility.signalOptions.experimental.delays.errorAtPosition'
		]
	},
	{ class: 'unlisted', family: 'JSON: a setting the base retired', patterns: ['json.colorDecorators.enable'] },
	{ class: 'advanced', family: 'JSON', patterns: ['json.*'] },
	{
		class: 'unlisted', family: 'Chat and agents of the base', patterns: [
			'chat.*', 'inlineChat.*', 'agents.*', 'mcp', 'mcp.*', 'github.copilot.*', 'onboarding.*', 'imageCarousel.*'
		]
	},
	{
		class: 'unlisted', family: 'Tasks, the integrated browser, profiles', patterns: [
			'task.*', 'workbench.browser.*', 'workbench.settings.applyToAllProfiles', 'window.newWindowProfile'
		]
	},
	{ class: 'unlisted', family: 'Notebooks', patterns: ['notebook.*', 'interactiveWindow.*'] },
	{ class: 'unlisted', family: 'Debug', patterns: ['debug.*', 'launch'] },
	{ class: 'unlisted', family: 'Testing', patterns: ['testing.*'] },
	{ class: 'unlisted', family: 'Tasks', patterns: ['task.*'] },
	{ class: 'unlisted', family: 'Remote', patterns: ['remote.*'] },
	{
		class: 'unlisted', family: 'Problems, Timeline, Merge Editor, Outline, breadcrumbs', patterns: [
			'problems.*', 'timeline.*', 'mergeEditor.*', 'outline.*', 'breadcrumbs.*', 'git.timeline.*', 'merge-conflict.diffViewPosition'
		]
	},
	{ class: 'unlisted', family: 'Telemetry and experiments', patterns: ['telemetry.*', 'workbench.enableExperiments', 'update.channel'] },
	{
		class: 'unlisted', family: 'Editor: needs a language service', patterns: [
			'editor.inlineSuggest.*', 'editor.parameterHints.*', 'editor.inlayHints.*', 'editor.gotoLocation.*', 'editor.semanticHighlighting.enabled',
			'editor.semanticTokenColorCustomizations', 'editor.stablePeek', 'editor.peekWidgetDefaultFocus', 'editor.definitionLinkOpensInPeek', 'editor.renameOnType',
			'editor.linkedEditing', 'editor.rename.enablePreview', 'editor.showUnused', 'editor.showDeprecated', 'editor.foldingImportsByDefault',
			'editor.defaultFoldingRangeProvider', 'editor.aiStats.enabled', 'editor.acceptSuggestionOnCommitCharacter', 'editor.suggestOnTriggerCharacters',
			'editor.screenReaderAnnounceInlineSuggestion', 'editor.inlineCompletionsAccessibilityVerbose', 'editor.experimental.preferTreeSitter.*',
			'editor.experimental.treeSitterTelemetry', 'editor.suggest.showMethods', 'editor.suggest.showFunctions', 'editor.suggest.showConstructors',
			'editor.suggest.showDeprecated', 'editor.suggest.showFields', 'editor.suggest.showVariables', 'editor.suggest.showClasses', 'editor.suggest.showStructs',
			'editor.suggest.showInterfaces', 'editor.suggest.showModules', 'editor.suggest.showProperties', 'editor.suggest.showEvents', 'editor.suggest.showOperators',
			'editor.suggest.showUnits', 'editor.suggest.showValues', 'editor.suggest.showConstants', 'editor.suggest.showEnums', 'editor.suggest.showEnumMembers',
			'editor.suggest.showKeywords', 'editor.suggest.showColors', 'editor.suggest.showFiles', 'editor.suggest.showReferences', 'editor.suggest.showCustomcolors',
			'editor.suggest.showFolders', 'editor.suggest.showTypeParameters', 'editor.suggest.showUsers', 'editor.suggest.showIssues'
		]
	},
	{
		class: 'unlisted', family: 'Editor: needs a formatter', patterns: [
			'editor.formatOnSave', 'editor.formatOnSaveMode', 'editor.formatOnPaste', 'editor.formatOnType', 'editor.defaultFormatter', 'editor.codeActionsOnSave',
			'editor.codeActions.triggerOnFocusChange', 'files.autoSaveWhenNoErrors', 'files.refactoring.autoSave', 'files.defaultLanguage'
		]
	},
	{
		class: 'unlisted', family: 'Editor tabs and groups', patterns: [
			'workbench.editor.titleScrollbarSizing', 'workbench.editor.titleScrollbarVisibility', 'workbench.editor.wrapTabs', 'workbench.editor.scrollToSwitchTabs',
			'workbench.editor.highlightModifiedTabs', 'workbench.editor.decorations.*', 'workbench.editor.customLabels.*', 'workbench.editor.labelFormat',
			'workbench.editor.untitled.labelFormat', 'workbench.editor.tabAction*', 'workbench.editor.showTabIndex', 'workbench.editor.tabSizing*', 'workbench.editor.pinnedTab*',
			'workbench.editor.preventPinnedEditorClose', 'workbench.editor.dragToOpenWindow', 'workbench.editor.showIcons',
			'workbench.editor.doubleClickTabToToggleEditorGroupSizes', 'workbench.editor.splitSizing', 'workbench.editor.splitOnDragAndDrop',
			'workbench.editor.openSideBySideDirection', 'workbench.editor.closeEmptyGroups', 'workbench.editor.limit.perEditorGroup', 'workbench.editor.autoLockGroups',
			'workbench.editor.revealIfOpen', 'workbench.editor.enablePreviewFromQuickOpen', 'workbench.editor.markdownDefaultEditorInAgentsWindow',
			'window.density.editorTabHeight', 'window.doubleClickIconToClose', 'explorer.openEditors.*'
		]
	},
	{
		class: 'unlisted', family: 'Workbench: no surface', patterns: [
			'workbench.commandPalette.experimental.*', 'workbench.commandPalette.showAskInChat', 'workbench.secondarySideBar.showLabels', 'workbench.reduceTransparency',
			'workbench.tips.enabled', 'workbench.activityBar.autoHide', 'workbench.activityBar.compact', 'workbench.activityBar.iconClickBehavior', 'workbench.productIconTheme',
			'workbench.*cloudChanges*', 'workbench.experimental.share.enabled', 'workbench.externalUriOpeners', 'workbench.remoteIndicator.*',
			'workbench.settings.showAISearchToggle', 'workbench.settings.enableNaturalLanguageSearch', 'workbench.settings.applyToAllProfiles', 'window.newWindowProfile',
			'workbench.browser.*'
		]
	},
	{
		class: 'unlisted', family: 'Terminal: the stock panel and its tabs', patterns: [
			'terminal.integrated.tabs.*', 'terminal.integrated.defaultLocation', 'terminal.integrated.hideOnStartup', 'terminal.integrated.hideOnLastClosed',
			'terminal.integrated.automationProfile.*', 'terminal.integrated.agentHostProfile.*', 'terminal.integrated.persistentSession*',
			'terminal.integrated.enablePersistentSessions', 'terminal.integrated.splitCwd', 'terminal.integrated.enableBell', 'terminal.integrated.enableVisualBell',
			'terminal.integrated.bellDuration', 'terminal.integrated.initialHint*', 'terminal.integrated.accessibleView*', 'terminal.integrated.stickyScroll.*',
			'terminal.integrated.shellIntegration.decorationsEnabled', 'terminal.integrated.shellIntegration.showCommandGuide', 'terminal.integrated.confirmOnExit',
			'terminal.integrated.middleClickBehavior', 'terminal.integrated.allowInUntrustedWorkspace'
		]
	},
	{
		class: 'unlisted', family: 'Search: the Search Editor and AI search', patterns: [
			'search.location', 'search.searchEditor.*', 'search.searchView.*', 'search.quickOpen.includeSymbols', 'search.experimental.closedNotebookRichContentResults'
		]
	},
	{ class: 'unlisted', family: 'Git: AI and commit diagnostics', patterns: ['git.addAICoAuthor', 'git.diagnosticsCommitHook.*'] },
	{
		class: 'unlisted', family: 'Extensions: the Marketplace', patterns: [
			'extensions.ignoreRecommendations', 'extensions.showRecommendationsOnlyOnDemand', 'extensions.closeExtensionDetailsOnViewChange', 'extensions.webWorker',
			'extensions.supportVirtualWorkspaces', 'extensions.supportAgentsWindow', 'extensions.supportUntrustedWorkspaces',
			'extensions.experimental.deferredStartupFinishedActivation', 'extensions.experimental.issueQuickAccess', 'extensions.allowOpenInModalEditor',
			'extensions.supportNodeGlobalNavigator', 'extensions.verifySignature', 'extensions.autoRestart', 'extensions.gallery.serviceUrl'
		]
	},
	{
		class: 'unlisted', family: 'Accessibility: hidden features', patterns: [
			'accessibility.signals.lineHasBreakpoint', 'accessibility.signals.onDebugBreak', 'accessibility.signals.lineHasInlineSuggestion',
			'accessibility.signals.nextEditSuggestion', 'accessibility.signals.chat*', 'accessibility.signals.editsUndone', 'accessibility.signals.editsKept',
			'accessibility.signals.voiceRecording*', 'accessibility.signals.notebookCell*', 'accessibility.signals.noInlayHints', 'accessibility.signals.task*',
			'accessibility.signals.format', 'accessibility.signals.lineHasError', 'accessibility.signals.lineHasWarning', 'accessibility.signals.positionHasError',
			'accessibility.signals.positionHasWarning', 'accessibility.signalOptions.experimental.delays.warningAtPosition',
			'accessibility.signalOptions.experimental.delays.errorAtPosition', 'accessibility.verbosity.panelChat', 'accessibility.verbosity.inlineChat',
			'accessibility.verbosity.terminalChatOutput', 'accessibility.verbosity.sessionsChat', 'accessibility.verbosity.chatQuestionCarousel',
			'accessibility.verbosity.inlineCompletions', 'accessibility.verbosity.emptyEditorHint', 'accessibility.verbosity.notebook', 'accessibility.verbosity.replEditor',
			'accessibility.verbosity.debug', 'accessibility.verbosity.walkthrough', 'accessibility.verbosity.survey', 'accessibility.debugWatchVariableAnnouncements',
			'accessibility.replEditor.*', 'accessibility.openChatEditedFiles', 'accessibility.verboseChatProgressUpdates', 'accessibility.chat.*'
		]
	},
	{ class: 'advanced', family: 'Text editor', patterns: ['editor.*', 'diffEditor.*'] },
	{ class: 'advanced', family: 'Files', patterns: ['files.*', 'explorer.*'] },
	{ class: 'advanced', family: 'Search', patterns: ['search.*'] },
	{
		class: 'advanced', family: 'Source control and Git', patterns: [
			'scm.*', 'git.*', 'github.*', 'github-enterprise.*', 'github-authentication.*', 'merge-conflict.*', 'mediaPreview.*'
		]
	},
	{ class: 'advanced', family: 'Terminal', patterns: ['terminal.*'] },
	{ class: 'advanced', family: 'Workbench', patterns: ['workbench.*', 'zenMode.*', 'screencastMode.*'] },
	{ class: 'advanced', family: 'Window', patterns: ['window.*'] },
	{ class: 'advanced', family: 'Accessibility', patterns: ['accessibility.*'] },
	{ class: 'advanced', family: 'Agent extensions', patterns: ['extensions.*', 'comments.*', 'output.*'] },
	{ class: 'advanced', family: 'Application', patterns: ['http.*', 'update.*', 'keyboard.*', 'application.*', 'network.*', 'security.*', 'issueReporter.*'] }
];

const compiledRules = BASEHALF_SETTING_RULES.map(rule => ({
	rule,
	tests: rule.patterns.map(pattern => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`))
}));
const lockedRule: IBaseHalfSettingRule = { class: 'locked', family: 'Kept by BaseHalf', patterns: Object.keys(BASEHALF_LOCKED_SETTINGS) };
const rulesByKey = new Map<string, IBaseHalfSettingRule | undefined>();

/** The rule that names a setting, or none: a setting the catalog does not know. */
export function baseHalfSettingRule(key: string): IBaseHalfSettingRule | undefined {
	if (rulesByKey.has(key)) {
		return rulesByKey.get(key);
	}
	const rule = Object.prototype.hasOwnProperty.call(BASEHALF_LOCKED_SETTINGS, key)
		? lockedRule
		: compiledRules.find(candidate => candidate.tests.some(test => test.test(key)))?.rule;
	rulesByKey.set(key, rule);
	return rule;
}

/**
 * The class of a setting. One the catalog does not know, as a setting of an extension the user
 * installed, is advanced: it is listed and works as its extension says.
 */
export function baseHalfSettingClass(key: string): BaseHalfSettingClass {
	return baseHalfSettingRule(key)?.class ?? 'advanced';
}

/** Whether BaseHalf keeps the setting at its own value. */
export function isBaseHalfSettingLocked(key: string): boolean {
	return Object.prototype.hasOwnProperty.call(BASEHALF_LOCKED_SETTINGS, key);
}

/** Whether a list of settings shows the setting: the shown and the advanced ones. */
export function isBaseHalfSettingListed(key: string): boolean {
	const type = baseHalfSettingClass(key);
	return type === 'shown' || type === 'advanced';
}
