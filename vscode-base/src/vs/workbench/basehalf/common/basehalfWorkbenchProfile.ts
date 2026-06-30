/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VIEWLET_ID as FILES_VIEW_CONTAINER_ID, VIEW_ID as FILES_VIEW_ID } from '../../contrib/files/common/files.js';
import { REPOSITORIES_VIEW_PANE_ID, HISTORY_VIEW_PANE_ID, VIEWLET_ID as SCM_VIEW_CONTAINER_ID, VIEW_PANE_ID as SCM_VIEW_ID } from '../../contrib/scm/common/scm.js';
import { TERMINAL_VIEW_ID } from '../../contrib/terminal/common/terminal.js';
import { VIEWLET_ID as EXTENSIONS_VIEW_CONTAINER_ID } from '../../contrib/extensions/common/extensions.js';
import { VIEWLET_ID as SEARCH_VIEW_CONTAINER_ID, VIEW_ID as SEARCH_VIEW_ID } from '../../services/search/common/search.js';

export const BASEHALF_PRODUCT_PROFILE_ID = 'basehalf.canvasWorkbench';
export const BASEHALF_ACTIVITY_PINNED_VIEW_CONTAINERS_STORAGE_KEY = 'workbench.activity.pinnedViewlets2';
export const BASEHALF_ACTIVITY_VIEW_CONTAINERS_WORKSPACE_STATE_STORAGE_KEY = 'workbench.activity.viewletsWorkspaceState';
export const BASEHALF_ACTIVE_VIEWLET_STORAGE_KEY = 'workbench.sidebar.activeviewletid';

export type BaseHalfSurfaceKind = 'viewContainer' | 'view' | 'panel' | 'command';
export type BaseHalfSurfaceDisposition = 'primary' | 'remapped' | 'hidden';
export type BaseHalfProductArea = 'files' | 'git' | 'search' | 'canvas' | 'agent-area' | 'extensions' | 'debug' | 'testing' | 'remote' | 'chat';

export interface IBaseHalfWorkbenchSurface {
	readonly id: string;
	readonly kind: BaseHalfSurfaceKind;
	readonly area: BaseHalfProductArea;
	readonly source: string;
	readonly reason: string;
}

export const BASEHALF_PRIMARY_VIEW_CONTAINERS = [
	{
		id: FILES_VIEW_CONTAINER_ID,
		kind: 'viewContainer',
		area: 'files',
		source: 'src/vs/workbench/contrib/files/common/files.ts',
		reason: 'Files uses VS Code Explorer mechanics while activation is remapped into BaseHalf canvas/card navigation.'
	},
	{
		id: SCM_VIEW_CONTAINER_ID,
		kind: 'viewContainer',
		area: 'git',
		source: 'src/vs/workbench/contrib/scm/common/scm.ts',
		reason: 'Git uses VS Code SCM providers, view state, menus, quick input, and Git/GitHub extensions.'
	},
	{
		id: SEARCH_VIEW_CONTAINER_ID,
		kind: 'viewContainer',
		area: 'search',
		source: 'src/vs/workbench/services/search/common/search.ts',
		reason: 'Search uses VS Code search services and quick access, with BaseHalf result activation remapped into canvas/card navigation.'
	}
] as const satisfies readonly IBaseHalfWorkbenchSurface[];

export const BASEHALF_PRIMARY_VIEWS = [
	{
		id: FILES_VIEW_ID,
		kind: 'view',
		area: 'files',
		source: 'src/vs/workbench/contrib/files/common/files.ts',
		reason: 'Explorer tree is the product file tree; folders open canvases and files open card detail.'
	},
	{
		id: SCM_VIEW_ID,
		kind: 'view',
		area: 'git',
		source: 'src/vs/workbench/contrib/scm/common/scm.ts',
		reason: 'SCM changes view is the source control panel body.'
	},
	{
		id: REPOSITORIES_VIEW_PANE_ID,
		kind: 'view',
		area: 'git',
		source: 'src/vs/workbench/contrib/scm/common/scm.ts',
		reason: 'Repository picker/list stays because VS Code SCM uses it for multi-root repositories and branch/repository state.'
	},
	{
		id: HISTORY_VIEW_PANE_ID,
		kind: 'view',
		area: 'git',
		source: 'src/vs/workbench/contrib/scm/common/scm.ts',
		reason: 'SCM history is the VS Code-aligned replacement surface for prior hand-rolled Git graph work.'
	},
	{
		id: SEARCH_VIEW_ID,
		kind: 'view',
		area: 'search',
		source: 'src/vs/workbench/services/search/common/search.ts',
		reason: 'Search view remains visible; result open behavior is remapped by the BaseHalf navigation module.'
	}
] as const satisfies readonly IBaseHalfWorkbenchSurface[];

export const BASEHALF_REMAPPED_SURFACES = [
	{
		id: TERMINAL_VIEW_ID,
		kind: 'viewContainer',
		area: 'agent-area',
		source: 'src/vs/workbench/contrib/terminal/common/terminal.ts',
		reason: 'VS Code terminal APIs remain compatibility plumbing, but sessions render in the BaseHalf Agent Area.'
	},
	{
		id: 'workbench.action.terminal.new',
		kind: 'command',
		area: 'agent-area',
		source: 'src/vs/workbench/contrib/terminal/common/terminal.ts',
		reason: 'Terminal creation commands should create Agent Area shell/TUI sessions instead of reopening the stock terminal panel.'
	},
	{
		id: 'workbench.action.terminal.toggleTerminal',
		kind: 'command',
		area: 'agent-area',
		source: 'src/vs/workbench/contrib/terminal/common/terminal.ts',
		reason: 'Terminal focus/toggle commands should target the Agent Area terminal session type.'
	},
	{
		id: 'workbench.action.files.openFile',
		kind: 'command',
		area: 'canvas',
		source: 'src/vs/workbench/browser/actions/workspaceActions.ts',
		reason: 'File open commands should enter BaseHalf card detail by default; VS Code editor groups are fallback behavior.'
	},
	{
		id: 'explorer.openAndPassFocus',
		kind: 'command',
		area: 'canvas',
		source: 'src/vs/workbench/contrib/files/browser/fileCommands.ts',
		reason: 'Explorer keyboard activation should enter BaseHalf folder canvas or card detail instead of default tab-first editor focus.'
	},
	{
		id: 'explorer.newFile',
		kind: 'command',
		area: 'canvas',
		source: 'src/vs/workbench/contrib/files/browser/fileActions.ts',
		reason: 'New files should enter BaseHalf card detail after the Explorer create flow completes.'
	},
	{
		id: 'explorer.newFolder',
		kind: 'command',
		area: 'canvas',
		source: 'src/vs/workbench/contrib/files/browser/fileActions.ts',
		reason: 'New folders should become the active BaseHalf canvas after the Explorer create flow completes.'
	},
	{
		id: 'explorer.upload',
		kind: 'command',
		area: 'canvas',
		source: 'src/vs/workbench/contrib/files/browser/fileActions.ts',
		reason: 'Uploaded single files should open as BaseHalf card detail, preserving VS Code upload plumbing.'
	},
	{
		id: 'filesExplorer.paste',
		kind: 'command',
		area: 'canvas',
		source: 'src/vs/workbench/contrib/files/browser/fileActions.contribution.ts',
		reason: 'Pasted single files should open as BaseHalf card detail instead of default editor tabs.'
	},
	{
		id: 'filesExplorer.openFilePreserveFocus',
		kind: 'command',
		area: 'canvas',
		source: 'src/vs/workbench/contrib/files/browser/fileActions.contribution.ts',
		reason: 'Explorer preserve-focus activation should still use BaseHalf card detail for single workspace files.'
	},
	{
		id: 'search.action.openResult',
		kind: 'command',
		area: 'canvas',
		source: 'src/vs/workbench/contrib/search/browser/searchActionsNav.ts',
		reason: 'Search result activation should open the matching file as BaseHalf card detail while preserving the result selection.'
	},
	{
		id: 'workbench.action.quickOpen',
		kind: 'command',
		area: 'canvas',
		source: 'src/vs/workbench/contrib/search/browser/searchQuickAccess.contribution.ts',
		reason: 'Go to File accepts should route workspace files into BaseHalf card detail by default.'
	},
	{
		id: 'workbench.action.quickTextSearch',
		kind: 'command',
		area: 'canvas',
		source: 'src/vs/workbench/contrib/search/browser/searchActionsTextQuickAccess.ts',
		reason: 'Quick Search accepts should route matching workspace files into BaseHalf card detail by default.'
	}
] as const satisfies readonly IBaseHalfWorkbenchSurface[];

export const BASEHALF_HIDDEN_SURFACES = [
	{
		id: EXTENSIONS_VIEW_CONTAINER_ID,
		kind: 'viewContainer',
		area: 'extensions',
		source: 'src/vs/workbench/contrib/extensions/common/extensions.ts',
		reason: 'The full Marketplace/Extensions product surface is hidden while extension support is curated.'
	},
	{
		id: 'workbench.panel.chat',
		kind: 'viewContainer',
		area: 'chat',
		source: 'src/vs/workbench/contrib/chat/browser/chat.ts',
		reason: 'VS Code native Chat/Copilot/Sessions UI is not a BaseHalf product surface.'
	},
	{
		id: 'workbench.panel.chat.view.copilot',
		kind: 'view',
		area: 'chat',
		source: 'src/vs/workbench/contrib/chat/browser/chat.ts',
		reason: 'Agent UI is owned by BaseHalf Agent Area, not the stock chat view.'
	},
	{
		id: 'workbench.view.debug',
		kind: 'viewContainer',
		area: 'debug',
		source: 'src/vs/workbench/contrib/debug/common/debug.ts',
		reason: 'Run and Debug is not part of the initial BaseHalf left sidebar product surface.'
	},
	{
		id: 'workbench.view.extension.test',
		kind: 'viewContainer',
		area: 'testing',
		source: 'src/vs/workbench/contrib/testing/common/constants.ts',
		reason: 'Testing is not part of the initial BaseHalf left sidebar product surface.'
	},
	{
		id: 'workbench.view.remote',
		kind: 'viewContainer',
		area: 'remote',
		source: 'src/vs/workbench/contrib/remote/browser/remoteExplorer.ts',
		reason: 'Remote Explorer is hidden until there is an explicit BaseHalf remote-workspace product decision.'
	}
] as const satisfies readonly IBaseHalfWorkbenchSurface[];

export type BaseHalfExtensionFamily = 'git' | 'github' | 'github-authentication' | 'codex' | 'claude';

export const BASEHALF_CONFIGURATION_DEFAULTS = {
	'workbench.startupEditor': 'none',
	'workbench.welcome.enabled': false,
	'workbench.welcomePage.walkthroughs.openOnInstall': false,
	'workbench.welcomePage.experimentalOnboarding': false,
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
	'security.workspace.trust.startupPrompt': 'never',
	'security.workspace.trust.banner': 'never'
} as const;

export const BASEHALF_PROFILE_STORAGE_KEYS_TO_CLEAR = [
	'workbench.welcomePage.restorableWalkthroughs'
] as const;

export const BASEHALF_WORKSPACE_STORAGE_KEYS_TO_CLEAR = [
	BASEHALF_ACTIVE_VIEWLET_STORAGE_KEY
] as const;

export const BASEHALF_CLOSED_STARTUP_EDITOR_TYPE_IDS = [
	'workbench.editors.gettingStartedInput',
	'workbench.editors.agentSessionsWelcome',
	'workbench.editors.workspaceTrust',
	'workbench.editors.workspaceTrustRequiredEditor'
] as const;

export const BASEHALF_LEFT_SIDEBAR_PINNED_VIEW_CONTAINERS = [
	...BASEHALF_PRIMARY_VIEW_CONTAINERS.map((surface, order) => ({
		id: surface.id,
		pinned: true,
		visible: true,
		order
	})),
	...BASEHALF_HIDDEN_SURFACES.filter(surface => surface.kind === 'viewContainer').map((surface, index) => ({
		id: surface.id,
		pinned: false,
		visible: false,
		order: BASEHALF_PRIMARY_VIEW_CONTAINERS.length + index
	}))
] as const;

export const BASEHALF_LEFT_SIDEBAR_VIEW_CONTAINER_WORKSPACE_STATE = BASEHALF_LEFT_SIDEBAR_PINNED_VIEW_CONTAINERS.map(surface => ({
	id: surface.id,
	visible: surface.visible
})) as readonly { readonly id: string; readonly visible: boolean }[];

export interface IBaseHalfAllowedExtensionFamily {
	readonly family: BaseHalfExtensionFamily;
	readonly builtInExtensionIds: readonly string[];
	readonly externalSlotIds: readonly string[];
	readonly source: string;
	readonly reason: string;
}

export const BASEHALF_ALLOWED_EXTENSION_FAMILIES = [
	{
		family: 'git',
		builtInExtensionIds: ['vscode.git', 'vscode.git-base'],
		externalSlotIds: [],
		source: 'extensions/git/package.json; extensions/git-base/package.json',
		reason: 'VS Code Git is the source of truth for SCM operations and Git panel behavior.'
	},
	{
		family: 'github',
		builtInExtensionIds: ['vscode.github'],
		externalSlotIds: [],
		source: 'extensions/github/package.json',
		reason: 'VS Code GitHub extension supplies GitHub remote/publish integration.'
	},
	{
		family: 'github-authentication',
		builtInExtensionIds: ['vscode.github-authentication'],
		externalSlotIds: [],
		source: 'extensions/github-authentication/package.json',
		reason: 'VS Code GitHub authentication supplies browser/device auth and token storage.'
	},
	{
		family: 'codex',
		builtInExtensionIds: [],
		externalSlotIds: ['basehalf.agentArea.extension.codex'],
		source: 'BaseHalf Agent Area extension-host module',
		reason: 'Codex extension sessions are allowed only through the Agent Area extension-agent slot.'
	},
	{
		family: 'claude',
		builtInExtensionIds: [],
		externalSlotIds: ['basehalf.agentArea.extension.claude'],
		source: 'BaseHalf Agent Area extension-host module',
		reason: 'Claude Code extension sessions are allowed only through the Agent Area extension-agent slot.'
	}
] as const satisfies readonly IBaseHalfAllowedExtensionFamily[];

export const BASEHALF_REQUIRED_MODULE_COMPLETION_GATES = [
	'vscode-source-comparison',
	'keep-delete-boundary',
	'complete-ui-states',
	'interactions',
	'error-empty-loading-states',
	'tests-or-explicit-verification'
] as const;

export type BaseHalfModuleCompletionGate = typeof BASEHALF_REQUIRED_MODULE_COMPLETION_GATES[number];

export type BaseHalfMigrationModuleId =
	| 'workbench-window-profile'
	| 'explorer-files-navigation-canvas'
	| 'git-scm-github'
	| 'search-quick-input'
	| 'markdown-rich-editor'
	| 'agent-area-terminal-extension-agents'
	| 'extension-allowlist-auth-secrets'
	| 'bh-mirror-integration'
	| 'theming-layout'
	| 'packaging-dev-loop';

export interface IBaseHalfMigrationModuleTrack {
	readonly id: BaseHalfMigrationModuleId;
	readonly title: string;
	readonly vscodeSources: readonly string[];
	readonly baselineSources: readonly string[];
	readonly keep: readonly string[];
	readonly deleteOrHide: readonly string[];
	readonly completionGates: readonly BaseHalfModuleCompletionGate[];
}

export const BASEHALF_MIGRATION_MODULE_TRACKS = [
	moduleTrack({
		id: 'workbench-window-profile',
		title: 'Workbench window and product profile',
		vscodeSources: [
			'src/vs/workbench/workbench.desktop.main.ts',
			'src/vs/workbench/workbench.common.main.ts',
			'src/vs/code/electron-browser/workbench/workbench.ts',
			'product.json'
		],
		baselineSources: ['apps/desktop/src/main', 'apps/desktop/src/renderer'],
		keep: ['BaseHalf product identity', 'canvas-first startup state', 'workspace folder opening'],
		deleteOrHide: ['stock VS Code welcome/product surfaces that compete with canvas', 'old hand-rolled workbench shell']
	}),
	moduleTrack({
		id: 'explorer-files-navigation-canvas',
		title: 'Explorer, files, navigation, and canvas',
		vscodeSources: [
			'src/vs/workbench/contrib/files/browser/explorerViewlet.ts',
			'src/vs/workbench/contrib/files/browser/views/explorerView.ts',
			'src/vs/workbench/contrib/files/browser/fileCommands.ts',
			'src/vs/workbench/services/filesConfiguration/common/filesConfigurationService.ts'
		],
		baselineSources: ['packages/core/src/workspace', 'apps/desktop/src/canvas', 'apps/desktop/src/viewer'],
		keep: ['folder-as-canvas navigation', 'card detail full-screen flow', 'badge/reference graph overlays'],
		deleteOrHide: ['old custom file tree', 'default editor-tab activation as primary file-open behavior']
	}),
	moduleTrack({
		id: 'git-scm-github',
		title: 'Git, SCM, GitHub, and publish flows',
		vscodeSources: [
			'extensions/git/src',
			'extensions/github/src',
			'extensions/github-authentication/src',
			'src/vs/workbench/contrib/scm/browser/scm.contribution.ts',
			'src/vs/workbench/contrib/git/browser/git.contributions.ts'
		],
		baselineSources: ['apps/desktop/src/scm', 'apps/desktop/src/git', 'apps/desktop/src/github'],
		keep: ['BaseHalf placement and visual polish around the Git panel'],
		deleteOrHide: ['hand-rolled Git CLI UI state machine', 'custom Publish/auth popovers that duplicate VS Code quick input/auth']
	}),
	moduleTrack({
		id: 'search-quick-input',
		title: 'Search and quick input',
		vscodeSources: [
			'src/vs/workbench/contrib/search/browser/search.contribution.ts',
			'src/vs/workbench/contrib/search/browser/searchView.ts',
			'src/vs/workbench/services/quickinput/browser/quickInputService.ts',
			'src/vs/platform/quickinput'
		],
		baselineSources: ['packages/core/src/search', 'apps/desktop/src/search'],
		keep: ['agent-oriented search/brief semantics where they add BaseHalf value'],
		deleteOrHide: ['split popover/search widgets that should be VS Code QuickInput']
	}),
	moduleTrack({
		id: 'markdown-rich-editor',
		title: 'Markdown rich editor and projections',
		vscodeSources: [
			'src/vs/workbench/contrib/markdown/browser/markdown.contribution.ts',
			'src/vs/workbench/contrib/customEditor/browser/customEditor.contribution.ts',
			'src/vs/workbench/services/workingCopy/common/workingCopyService.ts',
			'src/vs/workbench/services/textfile/common/textfiles.ts'
		],
		baselineSources: ['apps/desktop/src/editor', 'apps/desktop/src/markdown', 'packages/core/src/mdSegment'],
		keep: ['BlockNote-style rich editing', 'YJS per-file projection', 'byte-stable mdSegment splice-save'],
		deleteOrHide: ['separate rich/source files', 'default tab-first Markdown open path']
	}),
	moduleTrack({
		id: 'agent-area-terminal-extension-agents',
		title: 'Agent Area, terminal sessions, and extension agents',
		vscodeSources: [
			'src/vs/workbench/contrib/terminal',
			'src/vs/platform/terminal',
			'src/vs/workbench/services/extensions',
			'src/vs/workbench/api/browser/mainThreadTerminalService.ts'
		],
		baselineSources: ['apps/desktop/src/terminal', 'apps/desktop/src/agent'],
		keep: ['Ghosty-inspired terminal interaction quality', 'right-side persistent agent area', 'five first-class session choices'],
		deleteOrHide: ['stock terminal panel as primary UI', 'VS Code native Chat/Copilot/Sessions product views']
	}),
	moduleTrack({
		id: 'extension-allowlist-auth-secrets',
		title: 'Curated extensions, authentication, and secrets',
		vscodeSources: [
			'src/vs/workbench/services/authentication/browser/authenticationService.ts',
			'src/vs/workbench/services/secrets/electron-browser/secretStorageService.ts',
			'src/vs/platform/extensionManagement/common/allowedExtensionsService.ts',
			'extensions/github-authentication/src'
		],
		baselineSources: ['apps/desktop/src/github', 'apps/desktop/src/settings'],
		keep: ['BaseHalf product allowlist decisions', 'workspace-safe auth UX'],
		deleteOrHide: ['full marketplace surface', 'settings-only GitHub sign-in dead ends']
	}),
	moduleTrack({
		id: 'bh-mirror-integration',
		title: '.bh mirror, focus, badge, ADHD, and canvas metadata',
		vscodeSources: [
			'src/vs/platform/files',
			'src/vs/workbench/services/files',
			'src/vs/workbench/services/workingCopy',
			'src/vs/workbench/contrib/customEditor/browser/customEditor.contribution.ts',
			'src/vs/workbench/contrib/webview/browser/webview.ts'
		],
		baselineSources: ['packages/core/src/badges', 'packages/core/src/canvas', 'packages/core/src/focus', 'packages/core/src/adhd', 'packages/desktop/src/renderer/src/components/AdhdControls.tsx'],
		keep: ['.bh/mirror YAML model', 'current_focus symlink contract', 'mutexed read-modify-write behavior', 'ADHD keyword and read-paragraph interactions in the rich editor'],
		deleteOrHide: ['old CLI/inbound/proposals/focus.md machinery']
	}),
	moduleTrack({
		id: 'theming-layout',
		title: 'Theming, layout, and VS Code visual alignment',
		vscodeSources: [
			'src/vs/workbench/browser/parts',
			'src/vs/workbench/services/layout',
			'src/vs/workbench/services/themes',
			'src/vs/workbench/contrib/scm/browser/media'
		],
		baselineSources: ['apps/desktop/src/styles', 'apps/desktop/src/components'],
		keep: ['canvas as persistent background', 'BaseHalf Agent Area placement'],
		deleteOrHide: ['custom controls where VS Code native controls already define the interaction']
	}),
	moduleTrack({
		id: 'packaging-dev-loop',
		title: 'Packaging, hot development loop, and verification',
		vscodeSources: [
			'scripts/code.sh',
			'scripts/code-cli.sh',
			'build/gulpfile.vscode.ts',
			'build/next/index.ts',
			'test/automation'
		],
		baselineSources: ['package.json', 'turbo.json', '.github/workflows'],
		keep: ['Mac-first desktop development workflow', 'full quality gate before direct pushes'],
		deleteOrHide: ['obsolete BaseHalf Electron-vite hot loop once VS Code loop is authoritative']
	})
] as const satisfies readonly IBaseHalfMigrationModuleTrack[];

export function isBaseHalfPrimaryViewContainer(id: string): boolean {
	return PRIMARY_VIEW_CONTAINER_IDS.has(id);
}

export function isBaseHalfPrimaryView(id: string): boolean {
	return PRIMARY_VIEW_IDS.has(id);
}

export function getBaseHalfSurfaceDisposition(id: string): BaseHalfSurfaceDisposition | undefined {
	if (PRIMARY_VIEW_CONTAINER_IDS.has(id) || PRIMARY_VIEW_IDS.has(id)) {
		return 'primary';
	}

	if (REMAPPED_SURFACE_IDS.has(id)) {
		return 'remapped';
	}

	if (HIDDEN_SURFACE_IDS.has(id)) {
		return 'hidden';
	}

	return undefined;
}

export function isBaseHalfAllowedBuiltInExtension(extensionId: string): boolean {
	return ALLOWED_BUILT_IN_EXTENSION_IDS.has(normalizeExtensionId(extensionId));
}

export function isBaseHalfAllowedProductExtension(extensionId: string): boolean {
	return isBaseHalfAllowedBuiltInExtension(extensionId);
}

export function isBaseHalfAgentExtensionSlot(slotId: string): boolean {
	return AGENT_EXTENSION_SLOT_IDS.has(slotId);
}

export function shouldBaseHalfHideViewContainer(id: string): boolean {
	return HIDDEN_VIEW_CONTAINER_IDS.has(id);
}

export function shouldBaseHalfCloseStartupEditor(typeId: string): boolean {
	return CLOSED_STARTUP_EDITOR_TYPE_IDS.has(typeId);
}

export function getIncompleteBaseHalfModuleTracks(): readonly IBaseHalfMigrationModuleTrack[] {
	return BASEHALF_MIGRATION_MODULE_TRACKS.filter(track => {
		const gates = new Set(track.completionGates);
		return BASEHALF_REQUIRED_MODULE_COMPLETION_GATES.some(gate => !gates.has(gate))
			|| track.vscodeSources.length === 0
			|| track.baselineSources.length === 0
			|| track.keep.length === 0
			|| track.deleteOrHide.length === 0;
	});
}

function moduleTrack(track: Omit<IBaseHalfMigrationModuleTrack, 'completionGates'>): IBaseHalfMigrationModuleTrack {
	return {
		...track,
		completionGates: BASEHALF_REQUIRED_MODULE_COMPLETION_GATES
	};
}

function normalizeExtensionId(extensionId: string): string {
	return extensionId.trim().toLowerCase();
}

const PRIMARY_VIEW_CONTAINER_IDS = new Set<string>(BASEHALF_PRIMARY_VIEW_CONTAINERS.map(surface => surface.id));
const PRIMARY_VIEW_IDS = new Set<string>(BASEHALF_PRIMARY_VIEWS.map(surface => surface.id));
const REMAPPED_SURFACE_IDS = new Set<string>(BASEHALF_REMAPPED_SURFACES.map(surface => surface.id));
const HIDDEN_SURFACE_IDS = new Set<string>(BASEHALF_HIDDEN_SURFACES.map(surface => surface.id));
const HIDDEN_VIEW_CONTAINER_IDS = new Set<string>(
	BASEHALF_HIDDEN_SURFACES.filter(surface => surface.kind === 'viewContainer').map(surface => surface.id)
);
const CLOSED_STARTUP_EDITOR_TYPE_IDS = new Set<string>(BASEHALF_CLOSED_STARTUP_EDITOR_TYPE_IDS);
const ALLOWED_BUILT_IN_EXTENSION_IDS = new Set<string>(
	BASEHALF_ALLOWED_EXTENSION_FAMILIES.flatMap(family => family.builtInExtensionIds.map(normalizeExtensionId))
);
const AGENT_EXTENSION_SLOT_IDS = new Set<string>(
	BASEHALF_ALLOWED_EXTENSION_FAMILIES.flatMap(family => family.externalSlotIds)
);
