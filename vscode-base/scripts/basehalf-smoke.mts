/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { _electron } from '@playwright/test';
import { execFileSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';
import { filesContaining, pngSize, recordVideoNodeStates, solidPng, startVideoSmokeProvider } from './basehalf-smoke-video.mts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(__dirname);
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const product = JSON.parse(fs.readFileSync(path.join(root, 'product.json'), 'utf8'));

assertProductIdentity();

const opts = parseArgs(process.argv.slice(2));
const runsNewWindowWelcome = !opts.zoomOnly && !opts.canvasOnly && !opts.contentOnly && !opts.pluginOnly && !opts.settingsOnly;
const AGENT_CREATED_CARD_PATH = 'agent-angle.md';
const AGENT_CREATED_CARD_CONTENT = [
	'# Agent angle',
	'',
	'Created externally as another context-consuming document.',
	''
].join('\n');
const FAR_FIXTURE_CONTENT = '# Far\n\nkeeps the docs canvas taller than the viewport at high zoom\n';
// The file BaseHalf writes at `.bh/.gitignore` before it writes a layout, byte for byte.
const BH_IGNORE_FILE = [
	'# Written by BaseHalf. Card positions and BaseHalf\'s working files are',
	'# not shared through git.',
	'/.gitignore',
	'canvas.yaml',
	'!canvas.yaml/',
	'/cache/',
	'*.basehalf-tmp',
	''
].join('\n');
const LEGACY_REFERENCES_RECORD_PATH = path.join('.bh', 'legacy-references.yaml');
// A complete legacy pair from a release before D37: guide.md's badge lists
// far.md under `references`, and far.md's badge lists guide.md under
// `referenced_by`.
const LEGACY_GUIDE_BADGE = [
	'path: "docs/guide.md"',
	'kind: file',
	'description: "Guide badge"',
	'references:',
	'  - "docs/far.md"',
	''
].join('\n');
const LEGACY_FAR_BADGE = [
	'path: "docs/far.md"',
	'kind: file',
	'referenced_by:',
	'  - "docs/guide.md"',
	''
].join('\n');
const CANVAS_MALFORMED_EMPHASIS_PARAGRAPH = '曾经繁华的长安，如今已是断壁残垣。宫殿倾颓，街市萧条，只有那巍峨的山河依旧矗立，仿佛在无声地诉说着往日的辉煌。春风吹过，城中的草木却长得异常茂盛**，';
const CANVAS_MALFORMED_EMPHASIS_NEEDLE = '异常茂盛**，';
const SMOKE_WINDOW_CONTENT_SIZE = Object.freeze({ width: 1280, height: 860 });
// The Video node steps (D58) work in a folder of their own with two images,
// against the local test provider of basehalf-smoke-video.mts.
const VIDEO_FOLDER = 'video-smoke';
const VIDEO_NODE = `${VIDEO_FOLDER}/video.bhnode`;
// What Generate makes beside VIDEO_NODE once that holds a video.
const VIDEO_SIBLING_NODE = `${VIDEO_FOLDER}/video 2.bhnode`;
// The second node made from the create menu, for generations that end without a video.
const VIDEO_SECOND_NODE = `${VIDEO_FOLDER}/video-2.bhnode`;
const VIDEO_AGENT_NODE = `${VIDEO_FOLDER}/agent-shot.bhnode`;
const VIDEO_START_IMAGE = `${VIDEO_FOLDER}/start.png`;
const VIDEO_END_IMAGE = `${VIDEO_FOLDER}/end.png`;
const VIDEO_MODEL = 'doubao-seedance-2-5-260628';
// A model id the user adds to the channel; BaseHalf gives it the general profile.
const VIDEO_USER_MODEL = 'smoke-relay-video-model';
const VIDEO_PROMPT = 'A cyclist rides along the sea at dusk, the camera follows slowly';
// The prompt once `@` has typed the name of the end frame into it.
const VIDEO_PROMPT_WITH_NAME = `${VIDEO_PROMPT} Image 2`;
// The test provider makes a video in this long; Generate first asks 3 s after the task is made.
const VIDEO_PROVIDER_DURATION_MS = 2_000;
// The relay holds each create request this long, so the node's file is read while it is `submitting`.
const VIDEO_PROVIDER_CREATE_HOLD_MS = 1_500;
const VIDEO_GENERATION_TIMEOUT_MS = 60_000;
const VIDEO_NODE_STEPS = Object.freeze([
	'video-node-create-opens-panel',
	'video-node-prompt-saves-without-dialog',
	'video-providers-add-channel',
	'video-panel-model-and-settings',
	'video-provider-key-stays-secret',
	'video-panel-inputs-and-names',
	'video-panel-placement',
	'video-generate-writes-video',
	'video-capture-frames',
	'video-card-keeps-its-player',
	'video-generate-again-makes-sibling',
	'video-generation-fails-and-stops',
	'video-agent-runs-node'
]);
const videoSmoke = { provider: undefined, channelId: undefined };
const runRoot = opts.output ?? fs.mkdtempSync(path.join(os.tmpdir(), 'basehalf-smoke-'));
const logsPath = path.join(runRoot, 'logs');
const crashesPath = path.join(runRoot, 'crashes');
const userDataDir = path.join(runRoot, 'user-data');
const sharedDataDir = path.join(runRoot, 'shared-data');
const extensionsDir = path.join(runRoot, 'extensions');
// On macOS the temporary folder lies behind a symbolic link (/var is
// /private/var). The window opens the workspace by that path, while a shell in
// its terminal reports the real one: `basehalf --run-node` must find the
// workspace either way.
const workspacePath = path.join(runRoot, 'workspace');
// Where the window installs the BaseHalf skill instead of the home folder, so
// the smoke never reads or changes the agents' settings of the machine it runs
// on, and what the record of the selection agents can see does is the same on
// every machine. The window keeps its real home folder: macOS finds the
// keychain through it, and saving a provider key needs the keychain.
const smokeHome = path.join(runRoot, 'home');

for (const dir of [logsPath, crashesPath, userDataDir, sharedDataDir, extensionsDir, workspacePath, smokeHome]) {
	fs.mkdirSync(dir, { recursive: true });
}

// Context menus come from BaseHalf's product default (`window.menuStyle:
// custom`), not from this profile: every step that reads a menu also checks
// that default, since Playwright cannot inspect a native macOS context menu.
// Welcome runs force the broader stock startup choice: Folder/Workspace must
// still return to the canvas, while the empty New Window must keep BaseHalf
// Welcome.
fs.mkdirSync(path.join(userDataDir, 'User'), { recursive: true });
fs.writeFileSync(
	path.join(userDataDir, 'User', 'settings.json'),
	JSON.stringify(runsNewWindowWelcome ? { 'workbench.startupEditor': 'welcomePage' } : {}, null, '\t'),
	'utf8'
);

if (opts.verifyUninstalled || opts.verifyInstalled) {
	if (!fs.existsSync(externalPluginFixturePath())) {
		throw new Error(`Cannot verify an uninstalled plugin without the preserved fixture at ${externalPluginFixturePath()}`);
	}
} else {
	createFixtureWorkspace(workspacePath);
	prepareExternalPluginFixture();
}
// What the fixture holds under .bh/ before BaseHalf first opens it.
const bhTreeBeforeLaunch = readBhTree();
// What git shows of the fixture before BaseHalf first opens it.
const gitStatusBeforeLaunch = gitStatusOfWorkspace();

const electronPath = opts.packagedApp ? getPackagedElectronPath(opts.packagedApp) : getDevElectronPath();

const args = [
	// The development Electron takes the source tree as its application path.
	// A packaged application carries its own.
	...(opts.packagedApp ? [] : [root]),
	workspacePath,
	'--skip-release-notes',
	...(runsNewWindowWelcome ? [] : ['--skip-welcome']),
	'--disable-telemetry',
	'--disable-experiments',
	'--no-cached-data',
	'--disable-updates',
	'--disable-extension=vscode.vscode-api-tests',
	`--crash-reporter-directory=${crashesPath}`,
	'--disable-workspace-trust',
	`--logsPath=${logsPath}`,
	`--user-data-dir=${userDataDir}`,
	`--shared-data-dir=${sharedDataDir}`,
	`--extensions-dir=${extensionsDir}`,
	'--use-inmemory-secretstorage',
	'--enable-smoke-test-driver'
];

if (opts.verbose) {
	args.push('--verbose');
}

const env = {
	...process.env,
	// Harness processes (agents, editor terminals) may export this; it would
	// make the dev Electron start as plain node and never open a window.
	ELECTRON_RUN_AS_NODE: undefined,
	...(opts.packagedApp ? { NODE_ENV: undefined, VSCODE_DEV: undefined } : { NODE_ENV: 'development', VSCODE_DEV: '1' }),
	VSCODE_CLI: '1',
	BASEHALF_SMOKE_AGENT_SKILL_HOME: smokeHome,
	TERM: 'dumb',
	COLORTERM: '',
	NO_COLOR: '1',
	NODE_DISABLE_COLORS: '1',
	FORCE_COLOR: '0',
	ELECTRON_ENABLE_STACK_DUMPING: '1',
	ELECTRON_ENABLE_LOGGING: '1'
};

let app;
let smokeFailed = false;
let canvasViewportBeforeCardDetail;
const pageErrors = [];
try {
	if (!fs.existsSync(electronPath)) {
		throw new Error(opts.packagedApp
			? `The packaged application has no executable at ${electronPath}.`
			: `Dev Electron was not found at ${electronPath}. Run npm run electron or npm run basehalf:smoke first.`);
	}

	app = await _electron.launch({ executablePath: electronPath, args, timeout: 60_000, env });
	const page = await app.firstWindow();
	observePage(page);

	await assertNativeWindowResizeResponsive(app, page);
	await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });
	await page.locator('.basehalf-canvas-workbench').waitFor({ state: 'visible', timeout: 60_000 });
	if (opts.newWindowOnly) {
		await step('new-window-basehalf-welcome', () => assertNewWindowBaseHalfWelcome(app, page));
		const summary = {
			ok: true,
			workspace: workspacePath,
			checks: ['new-window-basehalf-welcome']
		};
		if (opts.keep || opts.output) {
			summary.runRoot = runRoot;
		}
		console.log(JSON.stringify(summary, null, 2));
	} else {
	if (runsNewWindowWelcome) {
		await step('new-window-basehalf-welcome', () => assertNewWindowBaseHalfWelcome(app, page));
	}
	if (!opts.settingsOnly && !opts.pluginOnly) {
		await step('fresh-canvas-framed', () => assertFreshCanvasFramed(page));
		await step('first-canvas-render-saves-places-out-of-git', () => assertFirstCanvasRenderSavesPlacesOutOfGit(page));
		await step('root-titlebar-breadcrumb', () => assertBaseHalfRootTitlebarBreadcrumb(page));
		await step('canvas-grid-scoped-to-canvas', () => assertCanvasGridScopedToCanvas(page));
		await step('product-theme-and-cards', () => assertProductThemeAndCards(page));
		await step('layout-control-at-the-left-end', () => assertLayoutControlAtTheLeftEnd(page));
	}
		if (!opts.zoomOnly && !opts.pluginOnly && !opts.contentOnly && !opts.settingsOnly) {
		await step('canvas-double-click-create-menu', () => assertCanvasDoubleClickCreateMenu(page));
		await step('canvas-create-result-node-submenu', () => assertCanvasCreateResultNodeSubmenu(page));
		await step('canvas-create-note-file-folder', () => assertCanvasCreateNoteFileAndFolder(page));
		await step('canvas-note-selection-controls', () => assertCanvasNoteInlineWysiwygEditor(page));
		await step('canvas-numeric-folder-names', () => assertCanvasNumericFolderNames(page));
	}

		if (opts.settingsOnly) {
			await step('settings-basehalf-category', () => assertBaseHalfSettingsCategory(page));
			await step('video-providers-page', () => assertVideoProvidersPage(page));
			await step('settings-about-page', () => assertBaseHalfAboutPage(page));
			console.log(JSON.stringify({
				ok: true,
				workspace: workspacePath,
				checks: ['settings-basehalf-category', 'video-providers-page', 'settings-about-page']
			}, null, 2));
		} else if (opts.pluginOnly) {
			if (opts.externalPluginId) {
				const checks = opts.verifyUninstalled
					? await assertExternalPluginUninstalled(page)
					: opts.verifyInstalled
						? await assertExternalPluginInstalledRelaunch(page)
					: opts.seedVsix
						? await assertExternalPluginUpdate(page)
						: await assertExternalPluginLifecycle(page);
				console.log(JSON.stringify({ ok: true, workspace: workspacePath, checks, runRoot }, null, 2));
			} else {
				await step('no-plugin-surface', () => assertNoPluginSurface(page));
				await step('video-workflow-template', () => assertVideoWorkflowTemplate(page));
				await runVideoNodeSteps(page);
				console.log(JSON.stringify({
					ok: true,
					workspace: workspacePath,
					checks: [
						'video-workflow-template',
						'no-plugin-surface',
						...VIDEO_NODE_STEPS
					]
				}, null, 2));
			}
		} else if (opts.contentOnly) {
			await step('quick-open-readme', () => quickOpen(page, 'README.md'));
			await step('readme-card-detail', () => assertCardDetail(page, 'README.md'));
			await step('card-detail-holds-no-layout-control', () => assertCardDetailHoldsNoLayoutControl(page));
			await step('readme-rich-file-attachment', () => assertMarkdownRichFileAttachment(page));
			await step('readme-no-editor-tab', () => assertNoEditorTabFor(page, 'README.md'));
			await step('quick-open-media', () => quickOpen(page, 'concept.svg'));
			await step('media-card-detail-projection', () => assertMediaCardDetail(page));
			await step('quick-open-pdf', () => quickOpen(page, 'textbook.pdf'));
			await step('pdf-card-detail-projection', () => assertPdfCardDetail(page));
			await step('pdf-no-editor-tab', () => assertNoEditorTabFor(page, 'textbook.pdf'));
			await step('pdf-grow-three-branches', () => assertPdfGrowsThreeBranches(page));
			console.log(JSON.stringify({
				ok: true,
				workspace: workspacePath,
				checks: [
					'card-detail-holds-no-layout-control',
					'readme-rich-file-attachment',
					'readme-no-editor-tab',
					'media-card-detail-projection',
					'pdf-card-detail-projection',
					'pdf-no-editor-tab',
					'pdf-grow-three-branches'
				]
			}, null, 2));
			} else if (opts.zoomOnly) {
				await step('canvas-zoom-controls', () => assertCanvasZoomControls(page));
				await step('canvas-snap-guides', () => assertCanvasSnapGuides(page));
				await step('canvas-scroll-before-card-detail', () => scrollCanvasWorkbenchForCardDetail(page));
				await step('quick-open-readme', () => quickOpen(page, 'README.md'));
				await step('readme-card-detail', () => assertCardDetail(page, 'README.md'));
				await step('readme-card-detail-covers-scrolled-canvas', () => assertCardDetailCoversCanvasViewport(page));
				console.log(JSON.stringify({
					ok: true,
					workspace: workspacePath,
					checks: [
						'fresh-canvas-framed',
						'first-canvas-render-saves-places-out-of-git',
						'root-titlebar-breadcrumb',
						'canvas-grid-scoped-to-canvas',
						'canvas-zoom-controls',
						'canvas-snap-guides',
						'readme-card-detail-covers-scrolled-canvas'
					]
				}, null, 2));
			} else if (opts.canvasOnly) {
			await step('canvas-inline-rename', () => assertCanvasInlineRename(page));
			await step('canvas-card-badge-preview-connectors', () => assertCanvasCardBadgePreviewAndConnectors(page));
			await step('canvas-unreadable-badge-recovers', () => assertCanvasUnreadableBadgeRecovers(page));
			await step('canvas-card-follows-outside-rename', () => assertCanvasCardFollowsOutsideRename(page));
			await step('canvas-follows-renamed-open-folder', () => assertCanvasFollowsRenamedOpenFolder(page));
			await step('canvas-cards-follow-many-outside-renames', () => assertCanvasCardsFollowManyOutsideRenames(page));
			await step('canvas-new-files-go-to-the-end', () => assertCanvasNewFilesGoToTheEnd(page));
			await step('canvas-note-wheel-scroll', () => assertCanvasNoteWheelScroll(page));
			await step('canvas-note-renders-markdown', () => assertCanvasNoteRendersMarkdown(page));
			await step('agent-creates-card', () => assertAgentCreatesCard(page));
			await step('canvas-connection-handle-capture', () => assertCanvasConnectionHandleCapture(page));
			await step('canvas-connect-into-note', () => assertCanvasConnectIntoNote(page));
			await step('canvas-derived-edge-visible', () => assertCanvasEdgeVisible(page, 'docs', AGENT_CREATED_CARD_PATH));
			await step('canvas-undo-after-closing-note', () => assertCanvasUndoAfterClosingNote(page));
			await step('canvas-edge-follows-card-drag-live', () => assertCanvasEdgeFollowsCardDragLive(page));
			await step('canvas-edge-half-reconnect', () => assertCanvasEdgeHalfReconnect(page));
			await step('agent-upstream-edit-draws-edge', () => assertAgentUpstreamEditDrawsEdge(page));
			await step('badge-editor-upstream-downstream', () => assertBadgeEditorUpstreamDownstream(page));
			await step('edge-delete-scoped-to-canvas', () => assertEdgeDeleteScopedToCanvas(page, AGENT_CREATED_CARD_PATH));
			await step('edge-delete-removes-reference', () => assertEdgeDeleteRemovesReference(page, AGENT_CREATED_CARD_PATH));
			await step('canvas-create-from-connection', () => assertCanvasCreateFromConnection(page));
			await step('canvas-zoom-controls', () => assertCanvasZoomControls(page));
			await step('canvas-snap-guides', () => assertCanvasSnapGuides(page));
			await step('canvas-selection-and-arrangement', () => assertCanvasSelectionAndArrangement(page));
			await step('agent-sees-selection', () => assertAgentSeesSelection(page));
			await step('note-that-cannot-hold-a-list', () => assertNoteThatCannotHoldAListKeepsItWithBaseHalf(page));
		console.log(JSON.stringify({
			ok: true,
			workspace: workspacePath,
			checks: [
				'fresh-canvas-framed',
				'first-canvas-render-saves-places-out-of-git',
				'root-titlebar-breadcrumb',
				'canvas-grid-scoped-to-canvas',
				'canvas-double-click-create-menu',
				'canvas-create-result-node-submenu',
				'canvas-create-note-file-folder',
				'canvas-note-selection-controls',
				'canvas-numeric-folder-names',
				'canvas-inline-rename',
				'canvas-card-badge-preview-connectors',
				'canvas-unreadable-badge-recovers',
				'canvas-card-follows-outside-rename',
				'canvas-follows-renamed-open-folder',
				'canvas-cards-follow-many-outside-renames',
				'canvas-new-files-go-to-the-end',
				'canvas-note-wheel-scroll',
				'canvas-note-renders-markdown',
				'agent-creates-card',
				'canvas-connection-handle-capture',
				'canvas-connect-into-note',
				'canvas-derived-edge-visible',
				'canvas-undo-after-closing-note',
				'canvas-edge-follows-card-drag-live',
				'canvas-edge-half-reconnect',
					'agent-upstream-edit-draws-edge',
					'badge-editor-upstream-downstream',
					'edge-delete-scoped-to-canvas',
					'edge-delete-removes-reference',
					'canvas-create-from-connection',
					'canvas-zoom-controls',
					'canvas-snap-guides',
					'canvas-selection-and-arrangement',
					'note-that-cannot-hold-a-list'
			]
		}, null, 2));
	} else {
	await step('open-editors-hidden', () => assertOpenEditorsHidden(page));
	await step('competing-view-containers-hidden', () => assertCompetingViewContainersHidden(page));
	await step('statusbar-curated', () => assertStatusBarCurated(page));
	await step('hidden-surface-runtime-guard', () => assertHiddenSurfaceCommandsStayHidden(page));
	await step('agent-area-five-choices-command-unavailable-state', () => assertAgentAreaChoices(page));
	await step('global-auxiliary-toggle-opens-agent-area', () => assertGlobalAuxiliaryToggleOpensAgentArea(page));
	await step('agent-area-terminal-command-no-stock-panel', () => assertAgentAreaTerminalCommand(page));
	await step('agent-area-tui-session-process-semantics', () => assertAgentAreaTuiSession(page));
	await step('toggle-panel-remaps-to-agent-area', () => assertTogglePanelRemapsToAgentArea(page));
	await step('agent-area-tabs-and-splits', () => assertAgentAreaTabsAndSplits(page));
		await step('source-control-git-provider', () => assertSourceControlPanel(page));
		commitFixtureChanges(workspacePath, 'smoke changes');
		await step('git-refresh', () => runCommand(page, 'Git: Refresh'));
		await step('source-control-publish-branch-action', () => assertSourceControlPublishBranchAction(page));
		await step('git-branch-checkout-quickpick', () => assertGitBranchCheckoutQuickPick(page));

		await step('canvas-inline-rename', () => assertCanvasInlineRename(page));
		await step('canvas-card-badge-preview-connectors', () => assertCanvasCardBadgePreviewAndConnectors(page));
		await step('canvas-unreadable-badge-recovers', () => assertCanvasUnreadableBadgeRecovers(page));
		await step('canvas-card-follows-outside-rename', () => assertCanvasCardFollowsOutsideRename(page));
		await step('canvas-follows-renamed-open-folder', () => assertCanvasFollowsRenamedOpenFolder(page));
		await step('canvas-cards-follow-many-outside-renames', () => assertCanvasCardsFollowManyOutsideRenames(page));
		await step('canvas-new-files-go-to-the-end', () => assertCanvasNewFilesGoToTheEnd(page));
		await step('canvas-note-wheel-scroll', () => assertCanvasNoteWheelScroll(page));
		await step('canvas-note-renders-markdown', () => assertCanvasNoteRendersMarkdown(page));
		await step('agent-creates-card', () => assertAgentCreatesCard(page));
		await step('canvas-connection-handle-capture', () => assertCanvasConnectionHandleCapture(page));
		await step('canvas-connect-into-note', () => assertCanvasConnectIntoNote(page));
		await step('canvas-derived-edge-visible', () => assertCanvasEdgeVisible(page, 'docs', AGENT_CREATED_CARD_PATH));
		await step('canvas-undo-after-closing-note', () => assertCanvasUndoAfterClosingNote(page));
		await step('canvas-edge-follows-card-drag-live', () => assertCanvasEdgeFollowsCardDragLive(page));
		await step('canvas-edge-half-reconnect', () => assertCanvasEdgeHalfReconnect(page));
		await step('agent-upstream-edit-draws-edge', () => assertAgentUpstreamEditDrawsEdge(page));
		await step('badge-editor-upstream-downstream', () => assertBadgeEditorUpstreamDownstream(page));
		await step('edge-delete-scoped-to-canvas', () => assertEdgeDeleteScopedToCanvas(page, AGENT_CREATED_CARD_PATH));
		await step('edge-delete-removes-reference', () => assertEdgeDeleteRemovesReference(page, AGENT_CREATED_CARD_PATH));
		await step('canvas-create-from-connection', () => assertCanvasCreateFromConnection(page));
		await step('canvas-snap-guides', () => assertCanvasSnapGuides(page));
		await step('canvas-selection-and-arrangement', () => assertCanvasSelectionAndArrangement(page));
		await step('agent-sees-selection', () => assertAgentSeesSelection(page));
		await step('note-that-cannot-hold-a-list', () => assertNoteThatCannotHoldAListKeepsItWithBaseHalf(page));
	await step('canvas-scroll-before-card-detail', () => scrollCanvasWorkbenchForCardDetail(page));
	await step('quick-open-readme', () => quickOpen(page, 'README.md'));
	await step('readme-card-detail', () => assertCardDetail(page, 'README.md'));
	await step('readme-titlebar-breadcrumbs', () => assertBaseHalfTitlebarBreadcrumbs(page));
	await step('readme-card-detail-compact-header', () => assertCardDetailCompactHeader(page));
	await step('card-detail-holds-no-layout-control', () => assertCardDetailHoldsNoLayoutControl(page));
	await step('readme-card-detail-covers-scrolled-canvas', () => assertCardDetailCoversCanvasViewport(page));
	await step('readme-rich-save-status-hidden', () => assertMarkdownRichSaveStatusHidden(page));
	await step('readme-rich-blockquote-editable', () => assertMarkdownRichBlockquoteEditable(page));
	// Runs while the document is untouched: block-to-line accounting is exact
	// only for unedited blocks, and later steps type into this file.
	await step('readme-rich-passthrough-edit-in-source', () => assertMarkdownRichPassthroughEditInSource(page));
	await step('readme-rich-block-menu-portal', () => assertMarkdownRichBlockMenuPortal(page));
	await step('readme-rich-slash-menu-themed-portal', () => assertMarkdownRichSlashMenuThemedPortal(page));
	await step('readme-rich-reading-mode-off', () => assertMarkdownRichReadingModeDisabled(page));
	await step('readme-rich-reading-mode-on', () => assertMarkdownRichReadingModeEnabledFromWorkspaceSettings(page));
	await step('readme-rich-editor-edit-save', () => assertMarkdownRichEditorEditsAndSaves(page));
	await step('readme-rich-undo-redo-roundtrip', () => assertMarkdownRichUndoRedoRoundtrip(page));
	await step('readme-rich-undo-stops-at-load', () => assertMarkdownRichUndoStopsAtLoad(page));
	await step('readme-rich-menu-undo-routes-to-editor', () => assertMarkdownRichMenuUndoRoutesToEditor(page));
	await step('readme-rich-external-merge-preserves-cursor', () => assertMarkdownRichExternalMergePreservesCursor(page));
	await step('readme-rich-context-menu-rich-clipboard', () => assertMarkdownRichContextMenuClipboard(page));
	await step('readme-rich-composition-defers-autosave', () => assertMarkdownRichCompositionDefersAutosave(page));
	await step('readme-rich-composition-queues-single-undo', () => assertMarkdownRichCompositionQueuesSingleUndo(page));
	await step('readme-rich-file-link-autocomplete', () => assertMarkdownRichFileLinkAutocomplete(page));
	await step('readme-rich-file-attachment', () => assertMarkdownRichFileAttachment(page));
	await step('readme-no-editor-tab', () => assertNoEditorTabFor(page, 'README.md'));
	await step('workspace-open-installs-nothing', () => assertWorkspaceOpenInstallsNothing());
	await step('readme-card-detail-badge-zone', () => assertCardDetailBadgeZone(page));
	await step('badge-quick-access-note-search', () => assertBadgeQuickAccessFindsNote(page));
	await step('initial-native-back-root-canvas', () => assertNativeBackOpensPreviousCanvas(page, ''));
	await step('initial-native-forward-readme-card', () => assertNativeForwardOpensCardDetail(page, 'README.md', {
		coldRichQuickInputQuery: 'src/app.ts'
	}));

	await step('quick-open-app-side', () => quickOpen(page, 'src/app.ts', 'Alt+Enter'));
	await step('app-card-detail', () => assertCardDetail(page, 'app.ts'));
	await step('app-no-editor-tab', () => assertNoEditorTabFor(page, 'app.ts'));
	await step('source-card-save-action-hidden', () => assertSourceCardSaveActionHidden(page));
	await step('source-card-detail-flush-on-navigation', () => assertSourceCardFlushesBeforeNavigation(page));
	await step('readme-card-detail-after-flush', () => assertCardDetail(page, 'README.md'));
	await step('readme-no-editor-tab-after-flush', () => assertNoEditorTabFor(page, 'README.md'));
	await step('quick-open-media', () => quickOpen(page, 'concept.svg'));
	await step('media-card-detail-projection', () => assertMediaCardDetail(page));
	await step('media-no-editor-tab', () => assertNoEditorTabFor(page, 'concept.svg'));
	await step('quick-open-pdf', () => quickOpen(page, 'textbook.pdf'));
	await step('pdf-card-detail-projection', () => assertPdfCardDetail(page));
	await step('pdf-no-editor-tab', () => assertNoEditorTabFor(page, 'textbook.pdf'));
	await step('pdf-grow-three-branches', () => assertPdfGrowsThreeBranches(page));
	await step('no-plugin-surface', () => assertNoPluginSurface(page));
	await step('video-workflow-template', () => assertVideoWorkflowTemplate(page));
	await runVideoNodeSteps(page);

	await step('quick-text-search-readme-routing', () => quickOpen(page, '%needle-basehalf-routing'));
	// The reveal highlight is transient, so assert it right after navigation.
	await step('quick-text-search-readme-reveals-routing-line', () => assertMarkdownRichRevealsText(page, 'needle-basehalf-routing'));
	await step('quick-text-search-readme-card-detail', () => assertCardDetail(page, 'README.md'));
	await step('quick-text-search-readme-no-editor-tab', () => assertNoEditorTabFor(page, 'README.md'));
	await step('quick-text-search-readme-second', () => quickOpen(page, '%needle-basehalf-second'));
	await step('quick-text-search-readme-reveals-second-line', () => assertMarkdownRichRevealsText(page, 'needle-basehalf-second'));
	await step('quick-text-search-readme-second-card-detail', () => assertCardDetail(page, 'README.md'));
	await step('quick-text-search-readme-second-no-editor-tab', () => assertNoEditorTabFor(page, 'README.md'));
	await step('quick-text-search-app-side', () => quickOpen(page, '%needleSymbol', 'Alt+Enter'));
	await step('quick-text-search-app-card-detail', () => assertCardDetail(page, 'app.ts'));
	await step('quick-text-search-app-no-editor-tab', () => assertNoEditorTabFor(page, 'app.ts'));

	await step('explorer-folder-row-canvas-open', () => openExplorerRow(page, 'docs'));
	await step('explorer-folder-row-canvas', () => assertCanvasFolder(page, 'docs'));
	await step('explorer-file-row-card-open', () => openExplorerRow(page, 'guide.md'));
	await step('explorer-file-row-card-detail', () => assertCardDetail(page, 'guide.md'));
	await step('canvas-breadcrumbs-removed', () => assertCanvasBreadcrumbsRemoved(page));
	await step('native-back-folder-navigation', () => assertNativeBackOpensPreviousCanvas(page, 'docs'));
	await step('canvas-zoom-controls', () => assertCanvasZoomControls(page));
	await step('native-forward-card-navigation', () => assertNativeForwardOpensCardDetail(page, 'guide.md'));
	await step('explorer-file-row-no-editor-tab', () => assertNoEditorTabFor(page, 'guide.md'));

	await step('folder-quick-open', () => quickOpen(page, 'docs'));
	await step('folder-quick-open-canvas', async () => {
		await assertCanvasFolder(page, 'docs');
		await assertCanvasContainsCard(page, 'docs/guide.md');
	});
	await step('migration-moves-seeded-legacy-pair', () => assertMigrationMovesSeededLegacyPair(page));
	await step('explorer-rename-cascades-mirror', () => assertExplorerRenameCascadesMirror(page));
	await step('settings-basehalf-category', () => assertBaseHalfSettingsCategory(page));
	await step('settings-about-page', () => assertBaseHalfAboutPage(page));
	await step('readme-badge-closes-on-rich-editor-activation', () => assertBadgeClosesOnRichEditorActivation(page));
	// Viewing, editing, and navigating never write focus state into the
	// workspace, and nothing installs agent guides, a harness, or a
	// .gitignore later in the session either.
	await step('nothing-installed-after-session', () => assertWorkspaceOpenInstallsNothing());

	const summary = {
		ok: true,
		workspace: workspacePath,
		checks: [
			'product-identity-basehalf',
			'canvas-visible',
			'new-window-basehalf-welcome',
			'fresh-canvas-framed',
			'first-canvas-render-saves-places-out-of-git',
			'root-titlebar-breadcrumb',
			'canvas-grid-scoped-to-canvas',
			'canvas-create-result-node-submenu',
			'canvas-create-note-file-folder',
			'canvas-note-selection-controls',
			'canvas-numeric-folder-names',
			'open-editors-hidden',
			'competing-view-containers-hidden',
			'statusbar-curated',
			'hidden-surface-runtime-guard',
			'agent-area-five-choices-command-unavailable-state',
			'global-auxiliary-toggle-opens-agent-area',
			'agent-area-terminal-command-no-stock-panel',
			'agent-area-tui-session-process-semantics',
			'agent-area-tabs-and-splits',
			'source-control-git-provider',
			'source-control-publish-branch-action',
			'git-branch-checkout-quickpick',
			'canvas-inline-rename',
			'canvas-card-badge-preview-connectors',
			'canvas-unreadable-badge-recovers',
			'canvas-card-follows-outside-rename',
			'canvas-follows-renamed-open-folder',
			'canvas-cards-follow-many-outside-renames',
			'canvas-new-files-go-to-the-end',
			'canvas-note-wheel-scroll',
			'canvas-note-renders-markdown',
			'agent-creates-card',
			'canvas-connection-handle-capture',
			'canvas-connect-into-note',
			'canvas-derived-edge-visible',
			'canvas-undo-after-closing-note',
			'canvas-edge-follows-card-drag-live',
			'canvas-edge-half-reconnect',
			'agent-upstream-edit-draws-edge',
			'badge-editor-upstream-downstream',
			'edge-delete-scoped-to-canvas',
			'edge-delete-removes-reference',
			'canvas-create-from-connection',
			'migration-moves-seeded-legacy-pair',
			'explorer-rename-cascades-mirror',
			'canvas-snap-guides',
			'canvas-selection-and-arrangement',
			'note-that-cannot-hold-a-list',
			'card-detail-covers-scrolled-canvas',
			'markdown-rich-save-status-hidden',
			'markdown-rich-blockquote-editable',
			'markdown-rich-block-menu-portal',
			'markdown-rich-slash-menu-themed-portal',
			'markdown-rich-reading-mode-settings-toggle',
			'quick-open-card-detail',
			'basehalf-titlebar-breadcrumbs',
			'markdown-rich-editor-edit-save',
			'markdown-rich-undo-redo-single-trigger',
			'markdown-rich-undo-stops-at-load',
			'markdown-rich-menu-undo-single-trigger',
			'markdown-rich-composition-queues-single-undo',
			'workspace-open-installs-nothing',
			'card-detail-badge-zone',
			'badge-quick-access-note-search',
			'initial-native-back-root-canvas',
			'initial-native-forward-readme-card',
			'quick-open-side-card-detail-no-tab',
			'source-card-save-action-hidden',
			'source-card-detail-flush-on-navigation',
			'media-card-detail-projection-no-tab',
			'video-workflow-template',
			...VIDEO_NODE_STEPS,
			'quick-text-search-card-detail-no-tab',
			'quick-text-search-selection-focus',
			'quick-text-search-repeated-selection-focus',
			'quick-text-search-side-card-detail-no-tab',
			'explorer-folder-row-canvas',
			'canvas-breadcrumbs-removed',
			'native-back-folder-navigation',
			'canvas-zoom-controls',
			'native-forward-card-navigation',
			'explorer-file-row-card-detail-no-tab',
			'folder-quick-open-canvas',
			'settings-basehalf-category',
			'settings-about-page',
			'badge-closes-on-rich-editor-activation',
			'nothing-installed-after-session'
		]
	};
	if (opts.keep || opts.output) {
		summary.runRoot = runRoot;
	}
	console.log(JSON.stringify(summary, null, 2));
	}
	}
} catch (error) {
	smokeFailed = true;
	await writeFailureArtifacts(error);
	throw error;
} finally {
	if (app) {
		await closeElectronApplication(app);
	}
	await stopVideoSmokeProvider();

	if (!opts.keep && !opts.output && !smokeFailed) {
		fs.rmSync(runRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	} else if (smokeFailed && !opts.keep && !opts.output) {
		console.error(`[basehalf-smoke] preserved failure artifacts: ${runRoot}`);
	}
}

function parseArgs(args) {
	const parsed = {
		keep: false,
		verbose: false,
		zoomOnly: false,
		canvasOnly: false,
		contentOnly: false,
		pluginOnly: false,
		settingsOnly: false,
		newWindowOnly: false,
		externalPluginId: undefined,
		externalPluginExtension: undefined,
		externalPluginVersion: undefined,
		seedVsix: undefined,
		verifyUninstalled: false,
		verifyInstalled: false,
		output: undefined,
		packagedApp: undefined
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		switch (arg) {
			case '--keep':
				parsed.keep = true;
				break;
			case '--verbose':
				parsed.verbose = true;
				break;
			case '--zoom-only':
				parsed.zoomOnly = true;
				break;
			case '--canvas-only':
				parsed.canvasOnly = true;
				break;
			case '--content-only':
				parsed.contentOnly = true;
				break;
			case '--plugin-only':
				parsed.pluginOnly = true;
				break;
			case '--settings-only':
				parsed.settingsOnly = true;
				break;
			case '--new-window-only':
				parsed.newWindowOnly = true;
				break;
			case '--external-plugin-id':
				parsed.externalPluginId = requireValue(args, ++i, arg).toLowerCase();
				break;
			case '--external-plugin-extension':
				parsed.externalPluginExtension = requireValue(args, ++i, arg).replace(/^\./, '').toLowerCase();
				break;
			case '--external-plugin-version':
				parsed.externalPluginVersion = requireValue(args, ++i, arg);
				break;
			case '--seed-vsix':
				parsed.seedVsix = path.resolve(requireValue(args, ++i, arg));
				break;
			case '--verify-uninstalled':
				parsed.verifyUninstalled = true;
				break;
			case '--verify-installed':
				parsed.verifyInstalled = true;
				break;
			case '--output':
				parsed.output = path.resolve(requireValue(args, ++i, arg));
				break;
			case '--packaged-app':
				parsed.packagedApp = path.resolve(requireValue(args, ++i, arg));
				break;
			case '--help':
				printHelpAndExit();
				break;
			default:
				throw new Error(`Unknown argument: ${arg}`);
		}
	}
	if (parsed.externalPluginId) {
		throw new Error('The reviewed-plugin lifecycle slice cannot run while the plugin platform is frozen: the product has no plugin surface (docs/specs/built-in-ai-video-and-plugin-freeze.md).');
	}
	if (parsed.externalPluginId && (!parsed.pluginOnly || !parsed.externalPluginExtension || !parsed.externalPluginVersion)) {
		throw new Error('--external-plugin-id requires --plugin-only, --external-plugin-extension, and --external-plugin-version.');
	}
	if ((parsed.seedVsix || parsed.verifyUninstalled || parsed.verifyInstalled) && !parsed.externalPluginId) {
		throw new Error('--seed-vsix and verification modes require --external-plugin-id.');
	}
	if (parsed.verifyUninstalled && parsed.verifyInstalled) {
		throw new Error('--verify-installed and --verify-uninstalled are mutually exclusive.');
	}
	if (parsed.newWindowOnly && (parsed.zoomOnly || parsed.canvasOnly || parsed.contentOnly || parsed.pluginOnly || parsed.settingsOnly)) {
		throw new Error('--new-window-only cannot be combined with another smoke slice.');
	}

	return parsed;
}

function requireValue(args, index, flag) {
	const value = args[index];
	if (!value || value.startsWith('--')) {
		throw new Error(`${flag} requires a value`);
	}
	return value;
}

function printHelpAndExit() {
	console.log(`Usage: npm run basehalf:smoke-no-compile -- [options]

Options:
	  --output <path>     Store smoke logs/user-data/crashes in this directory.
	  --packaged-app <path>
	                      Run against a packaged application bundle or folder instead of
	                      the development build, for example ../VSCode-darwin-arm64/BaseHalf.app.
	  --keep              Keep the generated temporary directory after the run.
	  --zoom-only         Run the lower-left zoom and card-snapping controls slice.
	  --canvas-only       Run the canvas/edge interaction slice without unrelated workbench suites.
  --content-only      Run Card Detail media/PDF rendering and rich attachment integration.
  --plugin-only       Check that there is no plugin surface and run the built-in AI Video slice,
                      with the Video node steps against the local test provider.
  --settings-only     Run BaseHalf Settings and its Video Providers page.
  --new-window-only   Open a new empty window and verify the BaseHalf Welcome surface.
  --external-plugin-id <id>
                      Run the reviewed remote-plugin lifecycle slice. Refused while
                      the plugin platform is frozen.
  --external-plugin-extension <ext>
                      File extension contributed by the reviewed test plugin.
  --external-plugin-version <version>
                      Remote version expected after install or update.
  --seed-vsix <path>  Preinstall an older VSIX before exercising remote update.
  --verify-uninstalled
                      Relaunch an existing output profile and verify source fallback.
  --verify-installed  Relaunch an existing output profile and verify cached admission.
  --verbose           Echo renderer console logs and pass --verbose to the dev Electron app.
`);
	process.exit(0);
}

function assertProductIdentity() {
	const expected = {
		nameShort: 'BaseHalf',
		nameLong: 'BaseHalf',
		applicationName: 'basehalf',
		dataFolderName: '.basehalf',
		sharedDataFolderName: '.basehalf-shared',
		serverApplicationName: 'basehalf-server',
		serverDataFolderName: '.basehalf-server',
		tunnelApplicationName: 'basehalf-tunnel',
		win32DirName: 'BaseHalf',
		win32NameVersion: 'BaseHalf',
		win32RegValueName: 'BaseHalf',
		win32AppUserModelId: 'PointaLabs.BaseHalf',
		win32ShellNameShort: '&BaseHalf',
		win32TunnelServiceMutex: 'basehalf-tunnelservice',
		win32TunnelMutex: 'basehalf-tunnel',
		urlProtocol: 'basehalf',
		darwinBundleIdentifier: 'com.pointalabs.basehalf',
		linuxIconName: 'basehalf'
	};

	for (const [key, value] of Object.entries(expected)) {
		if (product[key] !== value) {
			throw new Error(`BaseHalf product identity mismatch: product.${key} is ${JSON.stringify(product[key])}, expected ${JSON.stringify(value)}.`);
		}
	}

	if (packageJson.name !== 'basehalf-vscode-dev') {
		throw new Error(`BaseHalf dev package identity mismatch: package.name is ${JSON.stringify(packageJson.name)}, expected "basehalf-vscode-dev".`);
	}

	// The BaseHalf darwin update service (updateService.basehalfDarwin.ts) polls
	// an Ed25519-signed manifest from this URL; quality + a strict x.y.z
	// basehalfVersion are what its feed gating requires.
	if (product.updateUrl !== 'https://github.com/Pointa-Labs/basehalf/releases/latest/download') {
		throw new Error(`BaseHalf product.json updateUrl must point at the releases/latest/download feed; got ${JSON.stringify(product.updateUrl)}.`);
	}
	if (product.quality !== 'stable') {
		throw new Error(`BaseHalf product.json quality must be "stable" (the update service is disabled without it); got ${JSON.stringify(product.quality)}.`);
	}
	if (!/^\d+\.\d+\.\d+$/.test(product.basehalfVersion ?? '')) {
		throw new Error(`BaseHalf product.json basehalfVersion must be strict x.y.z; got ${JSON.stringify(product.basehalfVersion)}.`);
	}
}

function shouldLogConsoleMessage(message) {
	if (opts.verbose) {
		return true;
	}
	if (message.type() !== 'error') {
		return false;
	}

	const text = message.text();
	return !text.includes('[Extension Host (stderr)] Debugger listening on')
		&& !text.includes('[Extension Host (stderr)] For help, see: https://nodejs.org/learn/getting-started/debugging');
}

function observePage(page, label) {
	const sourceLabel = label ? `${label} ` : '';
	page.on('pageerror', error => {
		pageErrors.push(error);
		console.error(`[basehalf-smoke] ${sourceLabel}pageerror: ${error.stack || error.message}`);
	});
	page.on('console', message => {
		if (shouldLogConsoleMessage(message)) {
			const location = message.location();
			const source = location.url ? ` (${location.url}:${location.lineNumber + 1})` : '';
			console.error(`[basehalf-smoke] ${sourceLabel}console.${message.type()}: ${message.text()}${source}`);
		}
	});
}

async function setNativeWindowContentSize(application, page, size) {
	const browserWindow = await application.browserWindow(page);
	await browserWindow.evaluate((window, target) => window.setContentSize(target.width, target.height, false), size);
	await page.waitForFunction(
		target => window.innerWidth === target.width && window.innerHeight === target.height,
		size,
		{ timeout: 10_000 }
	);
}

async function assertNativeWindowResizeResponsive(application, page) {
	// `page.setViewportSize()` installs a Chromium device-metrics override in
	// Electron. That makes the native frame resizable while the workbench stays
	// frozen at the old CSS viewport, leaving apparent dead space and preventing
	// canvas layout from following a user window resize. Exercise two real
	// BrowserWindow sizes instead so the smoke harness also guards the desktop
	// resize contract it depends on.
	await setNativeWindowContentSize(application, page, { width: 1184, height: 780 });
	await setNativeWindowContentSize(application, page, SMOKE_WINDOW_CONTENT_SIZE);
}

async function step(name, run) {
	console.error(`[basehalf-smoke] start ${name}`);
	await run();
	console.error(`[basehalf-smoke] pass ${name}`);
}

function createFixtureWorkspace(workspace) {
	fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
	fs.mkdirSync(path.join(workspace, 'docs'), { recursive: true });
	fs.mkdirSync(path.join(workspace, '.bh', 'mirror'), { recursive: true });
	// Park the delay-based auto-save far beyond the test timeouts: with the
	// product default (250ms) it would write the source-card marker on its
	// own, making the flush-on-navigation step pass even with the navigation
	// flush broken. The rich Markdown autosave has its own webview timer and
	// is unaffected; it gets a dedicated disk assertion instead.
	fs.mkdirSync(path.join(workspace, '.vscode'), { recursive: true });
	// Deletes made by the smoke are permanent, so a run leaves nothing in the
	// system trash of the machine it runs on.
	fs.writeFileSync(path.join(workspace, '.vscode', 'settings.json'), JSON.stringify({ 'files.autoSaveDelay': 3_600_000, 'files.enableTrash': false, 'basehalf.agents.offerSkill': false }, null, '\t'), 'utf8');
	fs.writeFileSync(path.join(workspace, 'README.md'), [
		'# Smoke README',
		'',
		'soft-line-alpha',
		'soft-line-beta',
		'soft-line-gamma',
		'',
		CANVAS_MALFORMED_EMPHASIS_PARAGRAPH,
		'',
		'> **Smoke editable quote.** It keeps a [guide link](docs/guide.md) as a rich quote block.',
		'',
		'- **Smoke nested item** starts here',
		'  nested-menu-anchor continuation',
		'',
		'needle-basehalf-routing',
		'',
		'needle-basehalf-second',
		'',
		'External merge target paragraph.',
		'',
		'<div class="smoke-raw-island">raw html island</div>',
		''
	].join('\n'), 'utf8');
	fs.writeFileSync(path.join(workspace, 'src', 'app.ts'), 'export const needleSymbol = 42;\n', 'utf8');
	// Keep the media fixture below docs so the root-canvas framing contract is
	// unchanged by this additional smoke-only file.
	fs.writeFileSync(path.join(workspace, 'docs', 'concept.svg'), [
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">',
		'  <rect width="320" height="180" fill="#1f2937"/>',
		'  <circle cx="160" cy="90" r="54" fill="#60a5fa"/>',
		'</svg>',
		''
	].join('\n'), 'utf8');
	fs.writeFileSync(path.join(workspace, 'docs', 'textbook.pdf'), createMinimalPdfFixture());
	fs.writeFileSync(path.join(workspace, 'docs', 'guide.md'), '# Guide\n\nfolder target\n', 'utf8');
	fs.writeFileSync(path.join(workspace, 'docs', 'far.md'), FAR_FIXTURE_CONTENT, 'utf8');
	fs.mkdirSync(path.join(workspace, '.bh', 'mirror', 'README.md'), { recursive: true });
	// The fixture is a folder that BaseHalf has written layouts in before: its
	// ignore file is there, so the layouts below are on disk and not in git.
	fs.writeFileSync(path.join(workspace, '.bh', '.gitignore'), BH_IGNORE_FILE, 'utf8');
	fs.writeFileSync(path.join(workspace, '.bh', 'mirror', 'README.md', 'badge.yaml'), [
		'path: "README.md"',
		'kind: file',
		'description: "Smoke file badge"',
		''
	].join('\n'), 'utf8');
	fs.writeFileSync(path.join(workspace, '.bh', 'mirror', 'README.md', 'adhd.yaml'), [
		'path: "README.md"',
		'kind: file',
		'highlight_keywords:',
		'  - "Smoke"',
		'read_paragraphs:',
		'  - [1, 2]',
		''
	].join('\n'), 'utf8');
	fs.writeFileSync(path.join(workspace, '.bh', 'mirror', 'canvas.yaml'), [
		'path: ""',
		'size:',
		'  width: 2400',
		'  height: 1600',
		'cards:',
		'  - path: "README.md"',
		'    kind: file',
		'    x: -140',
		'    y: -110',
		'    width: 300',
		'    height: 220',
		'edges: []',
		''
	].join('\n'), 'utf8');
	fs.mkdirSync(path.join(workspace, '.bh', 'mirror', 'docs'), { recursive: true });
	fs.writeFileSync(path.join(workspace, '.bh', 'mirror', 'docs', 'canvas.yaml'), [
		'path: "docs"',
		'size:',
		'  width: 2400',
		'  height: 1600',
		'cards:',
		'  - path: "docs/guide.md"',
		'    kind: file',
		'    x: -140',
		'    y: -110',
		'    width: 300',
		'    height: 220',
		'  - path: "docs/far.md"',
		'    kind: file',
		'    x: 420',
		'    y: 980',
		'    width: 300',
		'    height: 220',
		'edges: []',
		''
	].join('\n'), 'utf8');
	initializeGitWorkspace(workspace);
	configureGitAuthor(workspace);
	commitFixtureChanges(workspace, 'initial smoke fixture');
	execFileSync('git', ['branch', 'branch-picker-target'], { cwd: workspace, stdio: 'ignore' });
	fs.appendFileSync(path.join(workspace, 'README.md'), '\nscm dirty change\n', 'utf8');
	fs.appendFileSync(path.join(workspace, 'src', 'app.ts'), '\nexport const smokeDirtyChange = true;\n', 'utf8');
}

function prepareExternalPluginFixture() {
	if (!opts.externalPluginId) {
		return;
	}
	fs.writeFileSync(externalPluginFixturePath(), '{"kept":true}\n', 'utf8');
	if (!opts.seedVsix) {
		return;
	}
	if (!fs.existsSync(opts.seedVsix)) {
		throw new Error(`Seed VSIX does not exist: ${opts.seedVsix}`);
	}
	const manifest = JSON.parse(execFileSync('unzip', ['-p', opts.seedVsix, 'extension/package.json'], { encoding: 'utf8' }));
	const manifestId = `${manifest.publisher}.${manifest.name}`.toLowerCase();
	if (manifestId !== opts.externalPluginId) {
		throw new Error(`Seed VSIX id mismatch: expected ${opts.externalPluginId}, received ${manifestId}`);
	}
	const extractionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'basehalf-plugin-seed-'));
	try {
		execFileSync('unzip', ['-q', opts.seedVsix, '-d', extractionRoot]);
		const target = path.join(extensionsDir, `${manifestId}-${manifest.version}`);
		fs.rmSync(target, { recursive: true, force: true });
		fs.cpSync(path.join(extractionRoot, 'extension'), target, { recursive: true });
	} finally {
		fs.rmSync(extractionRoot, { recursive: true, force: true });
	}
}

function externalPluginFixturePath() {
	return path.join(workspacePath, `reviewed-plugin.${opts.externalPluginExtension}`);
}

function initializeGitWorkspace(workspace) {
	try {
		execFileSync('git', ['init', '-b', 'main'], { cwd: workspace, stdio: 'ignore' });
	} catch {
		execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' });
		execFileSync('git', ['checkout', '-B', 'main'], { cwd: workspace, stdio: 'ignore' });
	}
}

function configureGitAuthor(workspace) {
	execFileSync('git', ['config', 'user.email', 'basehalf-smoke@example.invalid'], { cwd: workspace, stdio: 'ignore' });
	execFileSync('git', ['config', 'user.name', 'BaseHalf Smoke'], { cwd: workspace, stdio: 'ignore' });
}

function commitFixtureChanges(workspace, message) {
	execFileSync('git', ['add', '.'], { cwd: workspace, stdio: 'ignore' });
	execFileSync('git', ['commit', '-m', message], { cwd: workspace, stdio: 'ignore' });
}

function getPackagedElectronPath(packagedApp) {
	switch (process.platform) {
		case 'darwin':
			return path.join(packagedApp, 'Contents', 'MacOS', product.nameShort);
		case 'linux':
			return path.join(packagedApp, product.applicationName);
		case 'win32':
			return path.join(packagedApp, `${product.nameShort}.exe`);
		default:
			throw new Error(`Unsupported platform: ${process.platform}`);
	}
}

function getDevElectronPath() {
	switch (process.platform) {
		case 'darwin':
			return path.join(root, '.build', 'electron', `${product.nameLong}.app`, 'Contents', 'MacOS', product.nameShort);
		case 'linux':
			return path.join(root, '.build', 'electron', product.applicationName);
		case 'win32':
			return path.join(root, '.build', 'electron', `${product.nameShort}.exe`);
		default:
			throw new Error(`Unsupported platform: ${process.platform}`);
	}
}

async function quickOpen(page, value, acceptKey = 'Enter') {
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
	await fillAndAcceptQuickOpen(page, value, acceptKey);
}

async function fillAndAcceptQuickOpen(page, value, acceptKey) {
	const quickInput = visibleQuickInput(page);
	await quickInput.waitFor({ state: 'visible', timeout: 15_000 });
	await quickInput.fill(value);
	await waitForQuickInputResult(page, value);
	if (await quickInput.isVisible().catch(() => false)) {
		await page.keyboard.press(acceptKey);
		try {
			await quickInput.waitFor({ state: 'hidden', timeout: 5_000 });
		} catch {
			await page.keyboard.press('Escape');
			await quickInput.waitFor({ state: 'hidden', timeout: 15_000 });
		}
	}
}

async function runCommand(page, value) {
	const ran = await tryRunCommand(page, value, { expectedBestRowText: value });
	if (!ran) {
		throw new Error(`Command not found in QuickInput: ${value}`);
	}
}

async function assertNewWindowBaseHalfWelcome(application, workspacePage) {
	await workspacePage.locator('.gettingStartedContainer').waitFor({ state: 'detached', timeout: 30_000 });
	const workspaceEditorPart = workspacePage.locator('.part.editor.basehalf-canvas-host');
	if (!await workspaceEditorPart.evaluate(element => element.classList.contains('basehalf-canvas-on-top'))) {
		throw new Error('A non-empty workspace did not return to the BaseHalf canvas after the competing Welcome editor opened.');
	}

	const existingWindows = new Set(application.windows());
	const [welcomePage] = await Promise.all([
		application.waitForEvent('window', { timeout: 60_000 }),
		runCommand(workspacePage, 'New Window')
	]);
	if (existingWindows.has(welcomePage)) {
		throw new Error('The New Window command did not create a distinct Electron window.');
	}

	observePage(welcomePage, 'new-window');
	await setNativeWindowContentSize(application, welcomePage, SMOKE_WINDOW_CONTENT_SIZE);
	await welcomePage.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });
	const welcome = welcomePage.locator('.gettingStartedContainer');
	await welcome.waitFor({ state: 'visible', timeout: 60_000 });
	const heading = welcome.locator('h1.product-name', { hasText: 'BaseHalf' });
	await heading.waitFor({ state: 'visible', timeout: 15_000 });
	await welcome.locator('button', { hasText: 'Open Folder as Canvas' }).first().waitFor({ state: 'visible', timeout: 15_000 });
	await welcome.getByText('Recent Canvases', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
	await welcomePage.locator('.basehalf-canvas-empty', { hasText: 'No folder' }).waitFor({ state: 'attached', timeout: 15_000 });

	const layerState = await welcomePage.evaluate(() => {
		const editorPart = document.querySelector('.part.editor.basehalf-canvas-host');
		const welcomeContainer = document.querySelector('.gettingStartedContainer');
		const productHeading = welcomeContainer?.querySelector('h1.product-name');
		if (!(productHeading instanceof HTMLElement)) {
			return { canvasOnTop: editorPart?.classList.contains('basehalf-canvas-on-top') ?? false, welcomeTopmost: false };
		}
		const bounds = productHeading.getBoundingClientRect();
		const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
		return {
			canvasOnTop: editorPart?.classList.contains('basehalf-canvas-on-top') ?? false,
			welcomeTopmost: hit?.closest('.gettingStartedContainer') === welcomeContainer
		};
	});
	if (layerState.canvasOnTop || !layerState.welcomeTopmost) {
		throw new Error(`The BaseHalf Welcome surface is obscured by the empty canvas: ${JSON.stringify(layerState)}`);
	}

	await welcomePage.close();
	await workspacePage.bringToFront();
	await workspacePage.locator('.basehalf-canvas-workbench').waitFor({ state: 'visible', timeout: 15_000 });
}

async function runCommandWhenAvailable(page, value, timeout = 30_000) {
	const deadline = Date.now() + timeout;
	do {
		if (await tryRunCommand(page, value, { expectedBestRowText: value })) {
			return;
		}
		await page.waitForTimeout(250);
	} while (Date.now() < deadline);
	throw new Error(`Command did not become available in QuickInput: ${value}`);
}

async function tryRunCommand(page, value, options = {}) {
	let quickInput;
	for (let attempt = 0; attempt < 3; attempt++) {
		const previousQuickInput = visibleQuickInput(page);
		if (await previousQuickInput.isVisible().catch(() => false)) {
			await page.keyboard.press('Escape');
			await previousQuickInput.waitFor({ state: 'hidden', timeout: 15_000 });
		}
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
		const candidate = visibleQuickInput(page);
		await candidate.waitFor({ state: 'visible', timeout: 15_000 });
		if (await candidate.fill(`>${value}`, { timeout: 3_000 }).then(() => true, () => false)) {
			quickInput = candidate;
			break;
		}
	}
	if (!quickInput) {
		throw new Error(`Could not open QuickInput for command: ${value}`);
	}
	const firstRow = page.locator('.quick-input-list .monaco-list-row[role="option"]').first();
	await firstRow.waitFor({ state: 'visible', timeout: 15_000 });
	const firstRowText = ((await firstRow.getAttribute('aria-label')) ?? (await firstRow.textContent()) ?? '').replace(/\s+/g, ' ').trim();
	if (/^No matching/.test(firstRowText) || (options.expectedBestRowText && !isExpectedCommandRow(firstRowText, options.expectedBestRowText))) {
		await page.keyboard.press('Escape');
		await quickInput.waitFor({ state: 'hidden', timeout: 15_000 });
		return false;
	}
	const disabled = await firstRow.evaluate(row => {
		const element = row;
		return element.getAttribute('aria-disabled') === 'true'
			|| element.classList.contains('disabled')
			|| !!element.querySelector('.disabled');
	});
	if (disabled) {
		await page.keyboard.press('Escape');
		await quickInput.waitFor({ state: 'hidden', timeout: 15_000 });
		return false;
	}
	await page.keyboard.press('Enter');
	try {
		await quickInput.waitFor({ state: 'hidden', timeout: 15_000 });
	} catch (error) {
		await page.keyboard.press('Escape');
		await quickInput.waitFor({ state: 'hidden', timeout: 15_000 });
		return false;
	}
	return true;
}

function visibleQuickInput(page) {
	return page.locator('.quick-input-widget:visible input:visible').last();
}

function isExpectedCommandRow(rowText, expectedText) {
	return rowText === expectedText
		|| rowText.startsWith(`${expectedText} `)
		|| rowText.startsWith(`${expectedText},`)
		|| rowText.endsWith(`: ${expectedText}`)
		// Rows for commands with a keybinding append it after the title
		// (e.g. "BaseHalf: Split Agent Pane Right, ⌘D").
		|| rowText.includes(`: ${expectedText},`)
		|| rowText.includes(`: ${expectedText} `);
}

async function waitForQuickInputResult(page, query) {
	const expectedToken = path.basename(query.startsWith('%') ? query.slice(1) : query).toLocaleLowerCase();
	await page.waitForFunction(({ expectedQuery, expectedToken }) => {
		const widget = Array.from(document.querySelectorAll('.quick-input-widget')).find(candidate => {
			const element = candidate;
			const rect = element.getBoundingClientRect();
			const style = getComputedStyle(element);
			return style.display !== 'none'
				&& style.visibility !== 'hidden'
				&& rect.width > 0
				&& rect.height > 0;
		});
		const input = widget?.querySelector('input');
		if (!widget || !input || input.value !== expectedQuery) {
			return false;
		}
		const rows = Array.from(widget.querySelectorAll('.quick-input-list .monaco-list-row[role="option"]'));
		const hasResult = rows.some(row => {
			const text = (row.getAttribute('aria-label') ?? row.textContent ?? '').replace(/\s+/g, ' ').trim();
			return text
				&& text !== 'No matching results'
				&& text.toLocaleLowerCase().includes(expectedToken);
		});
		return hasResult;
	}, { expectedQuery: query, expectedToken }, { timeout: 15_000 });
}

async function openExplorerRow(page, label) {
	const row = page.locator('.explorer-viewlet .monaco-list-row', { hasText: label }).first();
	if (!(await row.isVisible().catch(() => false))) {
		const explorerAction = page.locator([
			'.part.activitybar .action-label.codicon-explorer-view-icon',
			'.part.activitybar .action-label[aria-label^="Explorer"]',
			'.part.activitybar .action-label[aria-label^="Files"]',
			'.part.sidebar .composite-bar .action-label.codicon-explorer-view-icon',
			'.part.sidebar .composite-bar .action-label[aria-label^="Explorer"]',
			'.part.sidebar .composite-bar .action-label[aria-label^="Files"]',
		].join(', ')).first();
		if (await explorerAction.isVisible().catch(() => false)) {
			await explorerAction.click();
		} else {
			// Projection webviews keep keyboard focus inside their iframe. Return it
			// to the workbench before invoking a host command-palette keybinding.
			await page.locator('.part.sidebar .title-label').click();
			await runCommand(page, 'Focus on Files Explorer');
		}
	}
	await row.waitFor({ state: 'visible', timeout: 20_000 });
	await row.click();
	const isFolder = (await row.getAttribute('aria-expanded')) !== null;
	const openKey = process.platform === 'darwin' && !isFolder ? 'Meta+ArrowDown' : 'Enter';
	await page.keyboard.press(openKey);
}

async function assertOpenEditorsHidden(page) {
	const headers = await page.locator('.pane-header h3.title').evaluateAll(nodes => nodes.map(node => (node.textContent || '').trim()).filter(text => text === 'Open Editors'));
	if (headers.length) {
		throw new Error('Open Editors view is visible in Explorer');
	}
}

async function assertCompetingViewContainersHidden(page) {
	const forbidden = ['Extensions', 'Chat', 'Run and Debug', 'Debug Console', 'Testing', 'Test Results', 'Problems', 'Remote Explorer', 'Terminal'];
	const started = Date.now();
	let visibleForbidden = [];
	while (Date.now() - started < 5_000) {
		const visibleTitles = await visibleViewContainerTitles(page);
		visibleForbidden = forbidden.filter(title => visibleTitles.includes(title));
		if (!visibleForbidden.length) {
			return;
		}
		await page.waitForTimeout(100);
	}

	throw new Error(`Competing VS Code view containers are visible: ${visibleForbidden.join(', ')}`);
}

async function visibleViewContainerTitles(page) {
	return page.locator('.part.sidebar .title-label h2, .part.panel .title-label h2, .part.auxiliarybar .title-label h2').evaluateAll(nodes => nodes
		.filter(node => {
			const element = node;
			const rect = element.getBoundingClientRect();
			const style = getComputedStyle(element);
			return style.display !== 'none'
				&& style.visibility !== 'hidden'
				&& rect.width > 0
				&& rect.height > 0
				&& rect.right > 0
				&& rect.bottom > 0
				&& rect.left < window.innerWidth
				&& rect.top < window.innerHeight;
		})
		.map(node => (node.textContent || '').replace(/\s+/g, ' ').trim())
		.filter(Boolean));
}

async function assertProductThemeAndCards(page) {
	// The product color theme comes from the default themes extension. When it
	// is not loaded the window keeps its startup colors, and a color that an
	// extension contributes, such as a Git status color, has no value. The
	// theme loads after the extensions are registered, so wait for it.
	const started = Date.now();
	let state;
	while (Date.now() - started < 20_000) {
		state = await page.evaluate(() => {
			const workbench = document.querySelector('.monaco-workbench');
			const sidebar = document.querySelector('.part.sidebar');
			const editor = document.querySelector('.part.editor');
			return {
				gitModifiedColor: getComputedStyle(workbench).getPropertyValue('--vscode-gitDecoration-modifiedResourceForeground').trim(),
				themeClasses: [...workbench.classList].filter(name => name.startsWith('vscode-theme-')),
				floatingPanels: workbench.classList.contains('floating-panels'),
				sidebarRadius: sidebar ? parseFloat(getComputedStyle(sidebar).borderTopLeftRadius) : 0,
				// The gap between the sidebar card and the canvas card.
				cardGap: sidebar && editor ? Math.round(editor.getBoundingClientRect().left - sidebar.getBoundingClientRect().right) : -1
			};
		});
		if (state.gitModifiedColor && state.themeClasses.length && state.floatingPanels && state.sidebarRadius === 8 && state.cardGap === 4) {
			return;
		}
		await page.waitForTimeout(200);
	}
	throw new Error(`The product theme or the card layout is not applied: ${JSON.stringify(state)}`);
}

async function assertStatusBarCurated(page) {
	// The status bar stays curated: Git/notification entries remain, while the
	// remote-window indicator and the problems counter point at flows BaseHalf
	// hides. Both entries register asynchronously, so hold the assertion over a
	// settle window instead of sampling once.
	await page.locator('.part.statusbar').waitFor({ state: 'visible', timeout: 20_000 });
	const started = Date.now();
	let sawVisibleEntry = false;
	while (Date.now() - started < 5_000) {
		const visibleEntryIds = await page.locator('.part.statusbar .statusbar-item').evaluateAll(nodes => nodes
			.filter(node => {
				const rect = node.getBoundingClientRect();
				return getComputedStyle(node).display !== 'none' && rect.width > 0 && rect.height > 0;
			})
			.map(node => node.id));
		const visibleCurated = visibleEntryIds.filter(id => id === 'status.host' || id === 'status.problems');
		if (visibleCurated.length) {
			throw new Error(`Curated status bar entries are visible: ${visibleCurated.join(', ')}`);
		}
		sawVisibleEntry ||= visibleEntryIds.length > 0;
		if (sawVisibleEntry && Date.now() - started >= 2_000) {
			return;
		}
		await page.waitForTimeout(200);
	}

	if (!sawVisibleEntry) {
		throw new Error('No visible status bar entries found; the curated status bar assertion never exercised real entries');
	}
}

async function assertHiddenSurfaceCommandsStayHidden(page) {
	for (const command of [
		'Extensions: Install Extensions',
		'Extensions: Install from VSIX...',
		'Extensions: Install Extension from Location...'
	]) {
		await assertCommandAbsentFromPalette(page, command);
	}
	const hiddenSurfaceCommands = [
		'Extensions: Focus on Extensions View',
		'Chat: Open Chat',
		'View: Show Run and Debug',
		'Debug Console: Focus on Debug Console View',
		'View: Show Testing',
		'Problems: Focus on Problems View',
		'View: Show Remote Explorer'
	];
	let exercisedCommands = 0;
	for (const command of hiddenSurfaceCommands) {
		console.error(`[basehalf-smoke] try hidden command ${command}`);
		if (await tryRunCommand(page, command, { expectedBestRowText: command })) {
			exercisedCommands++;
		}
		await assertCompetingViewContainersHidden(page);
		console.error(`[basehalf-smoke] pass hidden command ${command}`);
	}
	if (!exercisedCommands) {
		throw new Error('Hidden surface runtime guard did not exercise any VS Code command palette entries');
	}
}

async function assertCommandAbsentFromPalette(page, command) {
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
	const quickInput = visibleQuickInput(page);
	await quickInput.waitFor({ state: 'visible', timeout: 15_000 });
	await quickInput.fill(`>${command}`);
	const firstRow = page.locator('.quick-input-list .monaco-list-row[role="option"]').first();
	await firstRow.waitFor({ state: 'visible', timeout: 15_000 });
	const rowText = ((await firstRow.getAttribute('aria-label')) ?? (await firstRow.textContent()) ?? '').replace(/\s+/g, ' ').trim();
	await page.keyboard.press('Escape');
	await quickInput.waitFor({ state: 'hidden', timeout: 15_000 });
	if (!/^No matching/.test(rowText) && isExpectedCommandRow(rowText, command)) {
		throw new Error(`Stock extension installation command is exposed in the BaseHalf command palette: ${command}`);
	}
}

async function assertAgentAreaChoices(page) {
	// The Agent Area chrome mounts when the auxiliary-bar pane materializes, so
	// open it first (an extension session also proves the unavailable state).
	await runCommand(page, 'New Codex Extension Session');
	await page.locator('.basehalf-agent-area').waitFor({ state: 'visible', timeout: 20_000 });
	await assertAgentAreaOwnsAuxiliaryBarChrome(page);
	const choices = await page.locator('.basehalf-agent-empty-choice .basehalf-agent-empty-choice-label').evaluateAll(nodes => nodes.map(node => (node.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
	const expected = ['Codex', 'Claude Code', 'Codex Extension', 'Claude Code Extension', 'Terminal'];
	if (choices.join('|') !== expected.join('|')) {
		throw new Error(`Unexpected Agent Area choices: ${choices.join(', ')}`);
	}

	await page.locator('.basehalf-agent-tab.unavailable', { hasText: 'Codex Extension' }).waitFor({ state: 'visible', timeout: 15_000 });
	await page.locator('.basehalf-agent-session-state', { hasText: /openai\.chatgpt|trusted workspace/ }).waitFor({ state: 'visible', timeout: 15_000 });
	// The missing curated extension must surface a concrete next step: an
	// Install action wired to the configured extension gallery (not a dead end).
	await page.locator('.basehalf-agent-session-state-retry', { hasText: /^(Install |Trust Workspace)/ }).waitFor({ state: 'visible', timeout: 15_000 });
	await assertAgentAreaSurfaceKind(page, 'extension');
	await page.locator('.basehalf-agent-tab.unavailable .basehalf-agent-tab-close').click();
	await dismissAgentToasts(page);
	// With no tabs left the empty-state picker is the whole surface.
	await page.locator('.basehalf-agent-area-empty.visible').waitFor({ state: 'visible', timeout: 15_000 });
	await runCommand(page, 'Toggle Agent Area');
	await page.locator('.basehalf-agent-area').waitFor({ state: 'hidden', timeout: 15_000 });
}

async function assertAgentAreaOwnsAuxiliaryBarChrome(page) {
	await page.locator('.part.auxiliarybar > .title').waitFor({ state: 'hidden', timeout: 15_000 });
	await page.waitForFunction(() => {
		const auxiliaryBar = document.querySelector('.part.auxiliarybar');
		const agentArea = document.querySelector('.basehalf-agent-area');
		if (!auxiliaryBar || !agentArea) {
			return false;
		}

		const auxiliaryRect = auxiliaryBar.getBoundingClientRect();
		const areaRect = agentArea.getBoundingClientRect();
		return Math.abs(auxiliaryRect.top - areaRect.top) <= 1
			&& Math.abs(auxiliaryRect.bottom - areaRect.bottom) <= 1;
	}, null, { timeout: 15_000 });
}

async function assertGlobalAuxiliaryToggleOpensAgentArea(page) {
	await runCommand(page, 'Toggle Secondary Side Bar Visibility');
	await page.locator('.basehalf-agent-area').waitFor({ state: 'visible', timeout: 15_000 });
	await assertAgentAreaOwnsAuxiliaryBarChrome(page);
	await runCommand(page, 'Toggle Secondary Side Bar Visibility');
	await page.locator('.basehalf-agent-area').waitFor({ state: 'hidden', timeout: 15_000 });
}

// Soft-closed tabs/panes leave undo toasts for a grace period; dismissing them
// finalizes (disposes) the closed sessions and keeps later steps unambiguous.
async function dismissAgentToasts(page) {
	await page.locator('.basehalf-agent-toast').first().waitFor({ state: 'visible', timeout: 15_000 });
	while (await page.locator('.basehalf-agent-toast-dismiss').count()) {
		await page.locator('.basehalf-agent-toast-dismiss').first().click();
	}
	await page.locator('.basehalf-agent-toast').first().waitFor({ state: 'hidden', timeout: 15_000 });
}

async function assertAgentAreaTerminalCommand(page) {
	await runCommand(page, 'Terminal: Create New Terminal');
	await page.locator('.basehalf-agent-area').waitFor({ state: 'visible', timeout: 20_000 });
	await page.locator('.basehalf-agent-tab.active').first().waitFor({ state: 'visible', timeout: 20_000 });
	await page.waitForFunction(() => {
		const activeSession = document.querySelector('.basehalf-agent-area-session.active');
		return !!activeSession?.querySelector('.terminal-wrapper, .xterm');
	}, null, { timeout: 20_000 });
	await assertAgentAreaSurfaceKind(page, 'terminal');
	await assertAgentAreaTerminalClipboardPaste(page);
	await assertAgentAreaTerminalGhosttyEnvAndAnsiColors(page);
	await assertAgentAreaTerminalScrollbarFollowsScrollback(page);
	await assertAgentAreaTerminalVersionAndWheelReports(page);
	await assertStockTerminalPanelHidden(page);
	await runCommand(page, 'Toggle Agent Area');
	await page.locator('.basehalf-agent-area').waitFor({ state: 'hidden', timeout: 15_000 });
	await assertStockTerminalPanelHidden(page);
}

// A shell that is still starting can be ended, or lose part of its startup,
// by a Control+C. The prompt is there once the terminal has text that no
// longer changes.
async function waitForAgentAreaTerminalPrompt(page) {
	const deadline = Date.now() + 20_000;
	let previous = '';
	do {
		const text = await page.evaluate(() => {
			const wrapper = document.querySelector('.basehalf-agent-area-session.active.kind-terminal .terminal-wrapper') as HTMLElement & { xterm?: { buffer?: { active?: { length: number; getLine(index: number): { translateToString(trimRight?: boolean): string } | undefined } } } } | null;
			const buffer = wrapper?.xterm?.buffer?.active;
			const lines: string[] = [];
			for (let index = 0; buffer && index < buffer.length; index++) {
				lines.push(buffer.getLine(index)?.translateToString(true) ?? '');
			}
			return lines.join('\n').trim();
		});
		if (text && text === previous) {
			return;
		}
		previous = text;
		await page.waitForTimeout(400);
	} while (Date.now() < deadline);
	throw new Error('The Agent Area terminal showed no settled shell prompt within 20 seconds.');
}

async function assertAgentAreaTerminalClipboardPaste(page) {
	const marker = `BH_TYPELESS_PASTE_${Date.now()}`;
	const terminal = page.locator('.basehalf-agent-area-session.active.kind-terminal .xterm').first();
	await terminal.click();
	// The probe ends with Control+C, so the shell has to be at its prompt first.
	await waitForAgentAreaTerminalPrompt(page);
	const allowClipboardOverwrite = process.env.CI === 'true'
		|| process.env.CI === '1'
		|| process.env.BASEHALF_SMOKE_ALLOW_CLIPBOARD_OVERWRITE === '1';

	// Use Electron's native clipboard rather than the renderer Clipboard API:
	// vscode-file pages intentionally lack browser clipboard permission, while
	// Typeless writes the macOS pasteboard before synthesizing the paste shortcut.
	// Do not touch a rich clipboard: Electron cannot restore every arbitrary OS
	// pasteboard flavor atomically, so preserving images/files/RTF wins over this
	// assertion when a developer runs the smoke with such data copied. CI owns an
	// ephemeral clipboard and always exercises the native shortcut path; developers
	// can opt into the same behavior with BASEHALF_SMOKE_ALLOW_CLIPBOARD_OVERWRITE=1.
	const clipboardState = await app.evaluate(({ clipboard }, { text, allowClipboardOverwrite }) => {
		const formats = clipboard.availableFormats();
		const textOnly = formats.every(format => {
			const normalized = format.toLowerCase();
			return normalized === 'text'
				|| normalized === 'string'
				|| normalized === 'utf8_string'
				|| normalized.startsWith('text/plain')
				|| normalized === 'public.utf8-plain-text';
		});
		if (!textOnly && !allowClipboardOverwrite) {
			return { exercised: false, previousText: '' };
		}
		const previousText = clipboard.readText();
		clipboard.writeText(text);
		return { exercised: true, previousText };
	}, { text: marker, allowClipboardOverwrite });
	if (!clipboardState.exercised) {
		console.error('[basehalf-smoke] skip Agent Area shortcut paste probe: preserving non-text clipboard formats');
		return;
	}

	try {
		const pasteShortcut = process.platform === 'darwin'
			? 'Meta+V'
			: process.platform === 'win32'
				? 'Control+V'
				: 'Control+Shift+V';
		await page.keyboard.press(pasteShortcut);
		await page.waitForFunction(expected => {
			const wrapper = document.querySelector('.basehalf-agent-area-session.active.kind-terminal .terminal-wrapper') as HTMLElement & { xterm?: { buffer?: { active?: { length: number; getLine(index: number): { isWrapped: boolean; translateToString(trimRight?: boolean): string } | undefined } } } } | null;
			const buffer = wrapper?.xterm?.buffer?.active;
			if (!buffer) {
				return false;
			}
			// The marker follows the prompt and may wrap onto the next row.
			let logicalLine = '';
			for (let index = 0; index < buffer.length; index++) {
				const line = buffer.getLine(index);
				const text = line?.translateToString(true) ?? '';
				if (line?.isWrapped) {
					logicalLine += text;
					continue;
				}
				if (logicalLine.includes(expected)) {
					return true;
				}
				logicalLine = text;
			}
			return logicalLine.includes(expected);
		}, marker, { timeout: 15_000 });
	} finally {
		// Never execute the probe, and do not leave the smoke test's marker in the
		// user's clipboard after exercising the same shortcut Typeless dispatches.
		try {
			await page.keyboard.press('Control+C');
		} finally {
			await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), clipboardState.previousText);
		}
	}
}

async function assertAgentAreaTuiSession(page) {
	await runCommand(page, 'New Claude Code TUI Session');
	await page.locator('.basehalf-agent-area').waitFor({ state: 'visible', timeout: 20_000 });
	// The TUI session either launches the agent CLI as its terminal process, or —
	// when the CLI is not installed on this machine — surfaces the launch failure
	// with install guidance instead of pretending the session is fine.
	await page.waitForFunction(() => {
		const activeSession = document.querySelector('.basehalf-agent-area-session.active');
		if (!activeSession) {
			return false;
		}
		if (activeSession.classList.contains('has-state')) {
			const stateText = activeSession.querySelector('.basehalf-agent-session-state')?.textContent || '';
			return /claude/i.test(stateText) && /restart/i.test(stateText);
		}
		return !!activeSession.querySelector('.basehalf-agent-session-surface .terminal-wrapper, .basehalf-agent-session-surface .xterm');
	}, null, { timeout: 20_000 });
	await assertAgentAreaSurfaceKind(page, 'terminal');
	await assertStockTerminalPanelHidden(page);
	const tabCountBefore = await page.locator('.basehalf-agent-tab').count();
	await page.locator('.basehalf-agent-tab.active .basehalf-agent-tab-close').click();
	await page.waitForFunction(expected => document.querySelectorAll('.basehalf-agent-tab').length < expected, tabCountBefore, { timeout: 20_000 });
	await dismissAgentToasts(page);
	await runCommand(page, 'Toggle Agent Area');
	await page.locator('.basehalf-agent-area').waitFor({ state: 'hidden', timeout: 15_000 });
}

async function assertAgentAreaTabsAndSplits(page) {
	await runCommand(page, 'Toggle Agent Area');
	await page.locator('.basehalf-agent-area').waitFor({ state: 'visible', timeout: 20_000 });
	await runCommand(page, 'Split Agent Pane Right');
	await page.waitForFunction(() => document.querySelectorAll('.basehalf-agent-area-session.active').length === 2, null, { timeout: 20_000 });
	await page.locator('.basehalf-agent-divider.row').waitFor({ state: 'visible', timeout: 15_000 });
	await assertAgentAreaGhosttySplitVisuals(page);
	await runCommand(page, 'Close Agent Pane');
	await page.waitForFunction(() => document.querySelectorAll('.basehalf-agent-area-session.active').length === 1, null, { timeout: 20_000 });
	await page.locator('.basehalf-agent-toast-undo').first().click();
	await page.waitForFunction(() => document.querySelectorAll('.basehalf-agent-area-session.active').length === 2, null, { timeout: 20_000 });
	await runCommand(page, 'Close Agent Pane');
	await dismissAgentToasts(page);
	await page.waitForFunction(() => document.querySelectorAll('.basehalf-agent-area-session.active').length === 1, null, { timeout: 20_000 });
	await assertStockTerminalPanelHidden(page);
	await runCommand(page, 'Toggle Agent Area');
	await page.locator('.basehalf-agent-area').waitFor({ state: 'hidden', timeout: 15_000 });
}

async function assertTogglePanelRemapsToAgentArea(page) {
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+J' : 'Control+J');
	await page.locator('.basehalf-agent-area').waitFor({ state: 'visible', timeout: 15_000 });
	await assertStockTerminalPanelHidden(page);
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+J' : 'Control+J');
	await page.locator('.basehalf-agent-area').waitFor({ state: 'hidden', timeout: 15_000 });
	await assertStockTerminalPanelHidden(page);
}

async function assertStockTerminalPanelHidden(page) {
	const visibleTerminalPanelTitles = await page.locator('.part.panel .title-label h2').evaluateAll(nodes => nodes
		.filter(node => {
			const element = node;
			const rect = element.getBoundingClientRect();
			const style = getComputedStyle(element);
			return style.display !== 'none'
				&& style.visibility !== 'hidden'
				&& rect.width > 0
				&& rect.height > 0
				&& rect.right > 0
				&& rect.bottom > 0
				&& rect.left < window.innerWidth
				&& rect.top < window.innerHeight;
		})
		.map(node => (node.textContent || '').replace(/\s+/g, ' ').trim())
		.filter(text => text === 'Terminal'));
	if (visibleTerminalPanelTitles.length) {
		throw new Error('Stock VS Code Terminal panel is visible instead of BaseHalf Agent Area');
	}
}

async function assertAgentAreaSurfaceKind(page, kind) {
	await page.waitForFunction(expectedKind => {
		const area = document.querySelector('.basehalf-agent-area');
		const activeSession = document.querySelector('.basehalf-agent-area-session.active');
		if (!(area instanceof HTMLElement) || !(activeSession instanceof HTMLElement)) {
			return false;
		}

		const terminal = expectedKind === 'terminal';
		const expectedAreaClass = terminal ? 'active-kind-terminal' : 'active-kind-extension';
		const expectedSessionClass = terminal ? 'kind-terminal' : 'kind-extension';
		if (!area.classList.contains(expectedAreaClass) || !activeSession.classList.contains(expectedSessionClass)) {
			return false;
		}

		const probe = document.createElement('div');
		probe.style.position = 'absolute';
		probe.style.pointerEvents = 'none';
		probe.style.backgroundColor = terminal
			? 'var(--vscode-terminal-background, #1f1f1f)'
			: 'var(--vscode-sideBar-background)';
		document.querySelector('.monaco-workbench')?.appendChild(probe);
		const expectedBackground = getComputedStyle(probe).backgroundColor;
		probe.remove();

		const paletteProbe = document.createElement('div');
		paletteProbe.style.position = 'absolute';
		paletteProbe.style.pointerEvents = 'none';
		paletteProbe.style.color = 'var(--vscode-terminal-foreground)';
		paletteProbe.style.borderColor = 'var(--vscode-terminal-ansiBlue)';
		paletteProbe.style.backgroundColor = 'var(--vscode-terminal-ansiRed)';
		document.querySelector('.monaco-workbench')?.appendChild(paletteProbe);
		const paletteStyle = getComputedStyle(paletteProbe);
		const terminalHasGhosttyPalette = !terminal
			|| (paletteStyle.color === 'rgb(204, 204, 204)'
				&& paletteStyle.borderColor === 'rgb(0, 120, 212)'
				&& paletteStyle.backgroundColor === 'rgb(247, 73, 73)');
		paletteProbe.remove();

		// Browser-style tab chrome: the tab bar is a darker frame than the
		// content, the active tab adopts the exact content background so it
		// flows into the pane below, and the frame/content hairline is a 1px
		// overlay (breakable under the active tab) rather than a border.
		const tabsBar = area.querySelector('.basehalf-agent-area-tabs');
		const activeTab = area.querySelector('.basehalf-agent-tab.active');
		const meanChannel = (color: string): number => {
			const parts = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
			if (parts.length < 3) {
				return NaN;
			}
			const scale = parts.every(value => value <= 1.001) ? 255 : 1;
			return (parts[0] + parts[1] + parts[2]) / 3 * scale;
		};
		const terminalHasBrowserTabChrome = !terminal
			|| (tabsBar instanceof HTMLElement && activeTab instanceof HTMLElement
				&& meanChannel(getComputedStyle(tabsBar).backgroundColor) < meanChannel(expectedBackground)
				&& getComputedStyle(activeTab).backgroundColor === expectedBackground
				&& getComputedStyle(tabsBar, '::after').height === '1px');

		// Ghostty-style terminal surface: keep the configured terminal
		// background as the dominant surface. A neutral linear sheen is okay;
		// colored radial glows are not.
		const overlayStyle = getComputedStyle(activeSession, '::after');
		const terminalHasNeutralSurface = !terminal
			|| (overlayStyle.backgroundImage.includes('linear-gradient')
				&& !overlayStyle.backgroundImage.includes('radial-gradient')
				&& overlayStyle.mixBlendMode === 'normal'
				&& overlayStyle.pointerEvents === 'none');

		const viewport = activeSession.querySelector('.xterm-viewport');
		const slider = activeSession.querySelector('.xterm-slider');
		const overviewRuler = activeSession.querySelector('.xterm-decoration-overview-ruler');
		const surface = activeSession.querySelector('.basehalf-agent-session-surface');
		const xterm = activeSession.querySelector('.xterm');
		const scrollableElement = activeSession.querySelector('.xterm-scrollable-element');
		const commandDecoration = activeSession.querySelector('.terminal-command-decoration, .terminal-command-guide');
		const terminalHasOverlayScroller = !terminal
			|| ((viewport instanceof HTMLElement && getComputedStyle(viewport).right === '0px')
				&& (slider instanceof HTMLElement && getComputedStyle(slider).borderRadius !== '0px')
				&& (!(overviewRuler instanceof HTMLElement) || getComputedStyle(overviewRuler).display === 'none'));
		const terminalHasTightGutter = !terminal
			|| (surface instanceof HTMLElement && xterm instanceof HTMLElement && scrollableElement instanceof HTMLElement
				&& (() => {
					const sessionBox = activeSession.getBoundingClientRect();
					const surfaceBox = surface.getBoundingClientRect();
					const left = Math.round(surfaceBox.left - sessionBox.left);
					const right = Math.round(sessionBox.right - surfaceBox.right);
					const top = Math.round(surfaceBox.top - sessionBox.top);
					const bottom = Math.round(sessionBox.bottom - surfaceBox.bottom);
					const xtermStyle = getComputedStyle(xterm);
					const scrollableStyle = getComputedStyle(scrollableElement);
					const commandDecorationHidden = !(commandDecoration instanceof HTMLElement)
						|| getComputedStyle(commandDecoration).display === 'none';
					return left >= 0 && left <= 1
						&& right >= 0 && right <= 1
						&& top >= 0 && top <= 3
						&& bottom >= 0 && bottom <= 3
						&& Number.parseFloat(xtermStyle.paddingLeft) <= 3
						&& Number.parseFloat(scrollableStyle.paddingLeft) <= 3
						&& Number.parseFloat(scrollableStyle.marginLeft) >= -3
						&& commandDecorationHidden;
				})());

		return getComputedStyle(area).backgroundColor === expectedBackground
			&& getComputedStyle(activeSession).backgroundColor === expectedBackground
			&& terminalHasGhosttyPalette
			&& terminalHasBrowserTabChrome
			&& terminalHasNeutralSurface
			&& terminalHasOverlayScroller
			&& terminalHasTightGutter;
	}, kind, { timeout: 15_000 });
}

async function assertAgentAreaTerminalGhosttyEnvAndAnsiColors(page) {
	const terminal = page.locator('.basehalf-agent-area-session.active.kind-terminal .xterm').first();
	await terminal.click();
	await page.keyboard.insertText(`node -e "console.log('BH_NO_COLOR='+(process.env.NO_COLOR||'<empty>')); console.log('BH_TERM='+process.env.TERM); console.log('BH_COLORTERM='+process.env.COLORTERM); console.log('BH_TERM_PROGRAM='+process.env.TERM_PROGRAM); console.log('BH_TERM_PROGRAM_VERSION='+process.env.TERM_PROGRAM_VERSION); console.log('BH_SYNC_OUTPUT='+(process.env.CLAUDE_CODE_FORCE_SYNC_OUTPUT||'<empty>')); console.log('BH_FORCE_COLOR='+(process.env.FORCE_COLOR||'<empty>')); console.log('BH_NODE_DISABLE_COLORS='+(process.env.NODE_DISABLE_COLORS||'<empty>')); process.stdout.write('\\x1b[31mBH_RED_SENTINEL\\x1b[0m \\x1b[36mBH_CYAN_SENTINEL\\x1b[0m\\n')"`);
	await page.keyboard.press('Enter');

	await page.waitForFunction(({ expectedVersion, expectedSyncOutput }) => {
		const getActiveXtermBufferText = (): string => {
			const wrapper = document.querySelector('.basehalf-agent-area-session.active.kind-terminal .terminal-wrapper') as HTMLElement & { xterm?: { buffer?: { active?: { length: number; getLine(index: number): { translateToString(trimRight?: boolean): string } | undefined } } } } | null;
			const buffer = wrapper?.xterm?.buffer?.active;
			if (!buffer) {
				return '';
			}

			const lines: string[] = [];
			for (let index = 0; index < buffer.length; index++) {
				lines.push(buffer.getLine(index)?.translateToString(true) ?? '');
			}
			return lines.join('\n');
		};
		const text = getActiveXtermBufferText();
		return text.includes('BH_NO_COLOR=<empty>')
			&& text.includes('BH_TERM=xterm-256color')
			&& text.includes('BH_COLORTERM=truecolor')
			&& text.includes('BH_TERM_PROGRAM=BaseHalf')
			&& text.includes(`BH_TERM_PROGRAM_VERSION=${expectedVersion}`)
			&& text.includes(`BH_SYNC_OUTPUT=${expectedSyncOutput}`)
			&& text.includes('BH_FORCE_COLOR=<empty>')
			&& text.includes('BH_NODE_DISABLE_COLORS=<empty>')
			&& text.includes('BH_RED_SENTINEL')
			&& text.includes('BH_CYAN_SENTINEL');
	}, { expectedVersion: product.basehalfVersion, expectedSyncOutput: process.platform === 'win32' ? '<empty>' : '1' }, { timeout: 20_000 });

	await page.waitForFunction(() => {
		const activeXtermHasPaletteText = (marker: string, paletteIndex: number): boolean => {
			const wrapper = document.querySelector('.basehalf-agent-area-session.active.kind-terminal .terminal-wrapper') as HTMLElement & { xterm?: { buffer?: { active?: { length: number; getLine(index: number): { translateToString(trimRight?: boolean): string; getCell(index: number): { isFgPalette(): boolean; getFgColor(): number } | undefined } | undefined } } } } | null;
			const buffer = wrapper?.xterm?.buffer?.active;
			if (!buffer) {
				return false;
			}

			for (let row = 0; row < buffer.length; row++) {
				const line = buffer.getLine(row);
				const text = line?.translateToString(true) ?? '';
				let start = text.indexOf(marker);
				while (line && start >= 0) {
					for (let column = start; column < start + marker.length; column++) {
						const cell = line.getCell(column);
						if (cell?.isFgPalette() && cell.getFgColor() === paletteIndex) {
							return true;
						}
					}
					start = text.indexOf(marker, start + 1);
				}
			}

			return false;
		};
		return activeXtermHasPaletteText('BH_RED_SENTINEL', 1)
			&& activeXtermHasPaletteText('BH_CYAN_SENTINEL', 6);
	}, null, { timeout: 20_000 });
}

// A terminal program that prints the terminal's XTVERSION reply, or counts the
// wheel reports it receives while tracking the mouse in the alternate buffer.
function agentAreaTerminalProbeSource() {
	return String.raw`
const mode = process.argv[2];
process.stdin.setRawMode(true);
process.stdin.setEncoding('latin1');
const finish = line => {
	process.stdin.setRawMode(false);
	console.log(line);
	process.exit(0);
};
if (mode === 'xtversion') {
	let reply = '';
	setTimeout(() => finish('BH_XTVERSION=<none>'), 5000);
	process.stdin.on('data', chunk => {
		reply += chunk;
		const match = /\x1bP>\|([^\x1b]*)\x1b\\/.exec(reply);
		if (match) {
			finish('BH_XTVERSION=' + match[1]);
		}
	});
	process.stdout.write('\x1b[>0q');
} else {
	let up = 0;
	let down = 0;
	process.stdout.write('\x1b[?1049h\x1b[?1000h\x1b[?1006hBH_WHEEL_READY');
	process.stdin.on('data', chunk => {
		for (const match of chunk.matchAll(/\x1b\[<(\d+);\d+;\d+[Mm]/g)) {
			if (match[1] === '64') {
				up++;
			} else if (match[1] === '65') {
				down++;
			}
		}
		if (chunk.includes('q')) {
			process.stdout.write('\x1b[?1006l\x1b[?1000l\x1b[?1049l');
			finish('BH_WHEEL_REPORTS=' + up + ',' + down);
		}
	});
}
`;
}

async function waitForActiveAgentAreaTerminalLine(page, prefix) {
	const handle = await page.waitForFunction(expectedPrefix => {
		const wrapper = document.querySelector('.basehalf-agent-area-session.active.kind-terminal .terminal-wrapper') as HTMLElement & { xterm?: { buffer?: { active?: { length: number; getLine(index: number): { translateToString(trimRight?: boolean): string } | undefined } } } } | null;
		const buffer = wrapper?.xterm?.buffer?.active;
		for (let index = buffer ? buffer.length - 1 : -1; index >= 0; index--) {
			const line = buffer?.getLine(index)?.translateToString(true) ?? '';
			if (line.startsWith(expectedPrefix)) {
				return line;
			}
		}
		return false;
	}, prefix, { timeout: 20_000 });
	return await handle.jsonValue();
}

function readAgentAreaTerminalScrollbar(page) {
	return page.evaluate(() => {
		const scrollbar = document.querySelector('.basehalf-agent-area-session.active.kind-terminal .xterm-scrollable-element > .xterm-scrollbar.xterm-vertical');
		const slider = scrollbar?.querySelector('.xterm-slider');
		if (!(scrollbar instanceof HTMLElement) || !(slider instanceof HTMLElement)) {
			return undefined;
		}
		const style = getComputedStyle(scrollbar);
		return { opacity: style.opacity, pointerEvents: style.pointerEvents, trackHeight: scrollbar.offsetHeight, sliderHeight: slider.offsetHeight };
	});
}

function agentAreaTerminalScrollbarIsShown(scrollbar) {
	return scrollbar?.opacity === '1' && scrollbar.pointerEvents !== 'none' && scrollbar.sliderHeight < scrollbar.trackHeight;
}

function agentAreaTerminalScrollbarIsHidden(scrollbar) {
	return scrollbar?.opacity === '0' && scrollbar.pointerEvents === 'none';
}

async function waitForAgentAreaTerminalScrollbar(page, isExpected, expectation) {
	const deadline = Date.now() + 15_000;
	let scrollbar;
	do {
		scrollbar = await readAgentAreaTerminalScrollbar(page);
		if (isExpected(scrollbar)) {
			return;
		}
		await page.waitForTimeout(100);
	} while (Date.now() < deadline);
	throw new Error(`Agent Area terminal scrollbar is not ${expectation}: ${JSON.stringify(scrollbar ?? 'no scrollbar element')}`);
}

// With more output than rows, the terminal shows its scrollbar while the
// pointer is over it and hides it once the pointer has left
// (docs/specs/agent-area-terminal.md).
async function assertAgentAreaTerminalScrollbarFollowsScrollback(page) {
	const terminal = page.locator('.basehalf-agent-area-session.active.kind-terminal .xterm').first();
	await terminal.click();
	await page.keyboard.insertText(`node -e "for (let row = 0; row < 200; row++) { console.log('BH_SCROLLBACK_' + row); }"`);
	await page.keyboard.press('Enter');
	await waitForActiveAgentAreaTerminalLine(page, 'BH_SCROLLBACK_199');

	const box = await terminal.boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await waitForAgentAreaTerminalScrollbar(page, agentAreaTerminalScrollbarIsShown, 'shown, with a slider shorter than its track, while the pointer is over a terminal with scrollback');
	await page.mouse.move(box.x / 2, box.y + box.height / 2);
	await waitForAgentAreaTerminalScrollbar(page, agentAreaTerminalScrollbarIsHidden, 'hidden after the pointer left the terminal');
}

// Agent Area terminals answer XTVERSION as BaseHalf and turn a trackpad
// gesture into one wheel report per accumulated row, Ghostty-style
// (docs/specs/agent-area-terminal.md).
async function assertAgentAreaTerminalVersionAndWheelReports(page) {
	const probe = path.join(runRoot, 'agent-area-terminal-probe.cjs');
	fs.writeFileSync(probe, agentAreaTerminalProbeSource());
	const terminal = page.locator('.basehalf-agent-area-session.active.kind-terminal .xterm').first();
	await terminal.click();

	await page.keyboard.insertText(`node ${JSON.stringify(probe)} xtversion`);
	await page.keyboard.press('Enter');
	const version = await waitForActiveAgentAreaTerminalLine(page, 'BH_XTVERSION=');
	if (version !== `BH_XTVERSION=BaseHalf(${product.basehalfVersion})`) {
		throw new Error(`Agent Area terminal answered XTVERSION with ${version}`);
	}

	await page.keyboard.insertText(`node ${JSON.stringify(probe)} wheel`);
	await page.keyboard.press('Enter');
	await page.waitForFunction(() => {
		const wrapper = document.querySelector('.basehalf-agent-area-session.active.kind-terminal .terminal-wrapper') as HTMLElement & { xterm?: { buffer?: { active?: { type: string } }; modes?: { mouseTrackingMode: string } } } | null;
		return wrapper?.xterm?.buffer?.active?.type === 'alternate' && wrapper.xterm.modes?.mouseTrackingMode === 'vt200';
	}, null, { timeout: 20_000 });
	const cellHeight = await page.evaluate(() => {
		const wrapper = document.querySelector('.basehalf-agent-area-session.active.kind-terminal .terminal-wrapper') as HTMLElement & { xterm?: { _core?: { _renderService?: { dimensions?: { css?: { cell?: { height?: number } } } } } } } | null;
		return wrapper?.xterm?._core?._renderService?.dimensions?.css?.cell?.height ?? 0;
	});
	const box = await terminal.boundingBox();
	const pointer = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	// A trackpad gesture, shaped like Chromium's precise macOS wheel events
	// (wheelDelta is three times the pixel delta). CDP-synthesized wheel events
	// always carry one notch, which reads as a physical wheel, so they serve as
	// the two notches afterwards. Their pixel delta is far from three rows, so
	// that a notch counted as pixels changes the number of reports.
	const deltas = [2, 3, 5, 7, 9, 11, 12, 11, 9, 7, 5, 4, 3, 2, 1];
	await page.evaluate(async ({ deltas, pointer }) => {
		const screen = document.querySelector('.basehalf-agent-area-session.active.kind-terminal .xterm-screen');
		for (const delta of deltas) {
			screen?.dispatchEvent(new WheelEvent('wheel', { deltaY: -delta, deltaMode: 0, wheelDeltaY: 3 * delta, clientX: pointer.x, clientY: pointer.y, bubbles: true, cancelable: true }));
			await new Promise(resolve => setTimeout(resolve, 8));
		}
	}, { deltas, pointer });
	await page.mouse.move(pointer.x, pointer.y);
	await page.mouse.wheel(0, -200);
	await page.mouse.wheel(0, -200);
	await page.waitForTimeout(500);
	// The alternate buffer has no rows to scroll to, so the pointer over the
	// terminal brings up no scrollbar.
	await waitForAgentAreaTerminalScrollbar(page, agentAreaTerminalScrollbarIsHidden, 'hidden for a program in the alternate buffer under the pointer');
	await page.keyboard.press('q');
	const reports = await waitForActiveAgentAreaTerminalLine(page, 'BH_WHEEL_REPORTS=');
	const [up, down] = String(reports).slice('BH_WHEEL_REPORTS='.length).split(',').map(Number);
	const pixels = deltas.reduce((total, delta) => total + delta, 0);
	// Less than a row accumulates; a row or more sends the whole rows and drops the fraction.
	let pendingPixels = 0;
	let trackpadRows = 0;
	for (const delta of deltas) {
		pendingPixels += delta;
		if (pendingPixels >= cellHeight) {
			trackpadRows += Math.floor(pendingPixels / cellHeight);
			pendingPixels = 0;
		}
	}
	const expected = trackpadRows + 2 * 3;
	if (!(cellHeight > 0) || down !== 0 || Math.abs(up - expected) > 1) {
		throw new Error(`Agent Area terminal sent ${up} up and ${down} down wheel reports for ${pixels}px of trackpad scroll and two wheel notches; expected ${expected} (cell height ${cellHeight}).`);
	}
}

async function assertAgentAreaGhosttySplitVisuals(page) {
	await page.waitForFunction(() => {
		const area = document.querySelector('.basehalf-agent-area');
		const sessions = [...document.querySelectorAll('.basehalf-agent-area-session.active.kind-terminal')]
			.filter((node): node is HTMLElement => node instanceof HTMLElement);
		const dimOverlay = sessions.find(session => session.classList.contains('dimmed'))?.querySelector('.basehalf-agent-pane-dim');
		const dividerLine = document.querySelector('.basehalf-agent-divider-line');
		const handle = sessions[0]?.querySelector('.basehalf-agent-pane-handle');
		const dropPreview = sessions[0]?.querySelector('.basehalf-agent-pane-drop-preview');
		const hud = document.querySelector('.basehalf-agent-resize-hud');
		if (!(area instanceof HTMLElement)
			|| !(dimOverlay instanceof HTMLElement)
			|| !(dividerLine instanceof HTMLElement)
			|| !(handle instanceof HTMLElement)
			|| !(dropPreview instanceof HTMLElement)
			|| !(hud instanceof HTMLElement)) {
			return false;
		}

		const dividerProbe = document.createElement('div');
		dividerProbe.style.position = 'absolute';
		dividerProbe.style.pointerEvents = 'none';
		dividerProbe.style.backgroundColor = 'var(--basehalf-agent-terminal-divider)';
		area.appendChild(dividerProbe);
		const expectedDivider = getComputedStyle(dividerProbe).backgroundColor;
		dividerProbe.remove();

		const dimOpacity = Number.parseFloat(getComputedStyle(dimOverlay).opacity);
		const handleStyle = getComputedStyle(handle);
		const dropStyle = getComputedStyle(dropPreview);
		const hudStyle = getComputedStyle(hud);

		return dimOpacity > 0 && dimOpacity <= 0.16
			&& getComputedStyle(dividerLine).backgroundColor === expectedDivider
			&& handleStyle.width === '80px'
			&& handleStyle.height === '12px'
			&& handleStyle.backgroundColor === 'rgba(0, 0, 0, 0)'
			&& dropStyle.borderTopWidth === '0px'
			&& hudStyle.borderTopWidth === '0px'
			&& hudStyle.boxShadow !== 'none';
	}, null, { timeout: 15_000 });

	const firstSession = page.locator('.basehalf-agent-area-session.active.kind-terminal').first();
	const box = await firstSession.boundingBox();
	if (!box) {
		throw new Error('Agent Area split session is not visible for handle reveal check');
	}
	await page.mouse.move(box.x + box.width / 2, box.y + 4);
	await page.waitForFunction(() => {
		const handle = document.querySelector('.basehalf-agent-area-session.active.kind-terminal .basehalf-agent-pane-handle');
		return handle instanceof HTMLElement && Number.parseFloat(getComputedStyle(handle).opacity) > 0;
	}, null, { timeout: 15_000 });
}

async function assertBaseHalfSettingsCategory(page) {
	await runCommand(page, 'Open Settings (UI)');
	const editor = page.locator('.settings-editor').first();
	await editor.waitFor({ state: 'visible', timeout: 20_000 });

	const toc = editor.locator('.settings-toc-container').first();
	await toc.waitFor({ state: 'visible', timeout: 20_000 });
	const basehalfEntry = toc.locator('.settings-toc-entry', { hasText: /^BaseHalf$/ }).first();
	await basehalfEntry.waitFor({ state: 'visible', timeout: 20_000 });
	await basehalfEntry.click();

	await page.waitForFunction(() => {
		const settingsEditor = document.querySelector('.settings-editor');
		const text = (settingsEditor?.textContent ?? '').replace(/\s+/g, ' ');
		return text.includes('BaseHalf')
			&& text.includes('ADHD')
			&& (text.includes('Reading Mode') || text.includes('basehalf.editor.readingMode'));
	}, null, { timeout: 20_000 });
}

// The About page is in Settings below BaseHalf, and holds BaseHalf's own
// version and the way to the release notes (app update, "Where an update
// shows"). The smoke runs with updates switched off, so the state it shows
// is that one.
async function assertBaseHalfAboutPage(page) {
	await runCommand(page, 'About BaseHalf');
	const settingsEditor = page.locator('.settings-editor').first();
	await settingsEditor.waitFor({ state: 'visible', timeout: 20_000 });
	const about = settingsEditor.locator('.basehalf-about').first();
	await about.waitFor({ state: 'visible', timeout: 20_000 });
	await about.locator('h1', { hasText: /^About$/ }).waitFor({ state: 'visible', timeout: 15_000 });
	await settingsEditor.locator('.settings-toc-container .monaco-list-row.selected .settings-toc-entry', { hasText: /^About$/ }).waitFor({ state: 'visible', timeout: 15_000 });

	const version = JSON.parse(fs.readFileSync(path.join(root, 'product.json'), 'utf8')).basehalfVersion;
	const shown = (await about.innerText()).replace(/\s+/g, ' ');
	if (!shown.includes(`Current Version: ${version}`) || !shown.includes('Release Notes') || !shown.includes('Updates Disabled')) {
		throw new Error(`The About page does not show BaseHalf's version ${version}, the release notes, and the state of updates: ${shown}`);
	}
	// It is what the main surface shows.
	const onTop = await page.evaluate(() => {
		const rect = document.querySelector('.basehalf-about h1')?.getBoundingClientRect();
		const top = rect ? document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) : null;
		return top?.closest('.basehalf-about') ? 'the page' : `${top?.tagName.toLowerCase()}.${String(top?.className).split(/\s+/).slice(0, 3).join('.')}`;
	});
	if (onTop !== 'the page') {
		throw new Error(`The About page is open and not shown: on top of its title is ${onTop}.`);
	}
}

// The Video Providers page (D58, video node, "Providers and channels") is in
// Settings below BaseHalf, in the place of the former Models & Providers page,
// and opens from its command.
async function openVideoProvidersPage(page) {
	await runCommand(page, 'Video Providers');
	const settingsEditor = page.locator('.settings-editor').first();
	await settingsEditor.waitFor({ state: 'visible', timeout: 20_000 });
	const providers = settingsEditor.locator('.basehalf-video-providers').first();
	await providers.waitFor({ state: 'visible', timeout: 20_000 });
	await providers.locator('h1', { hasText: /^Video Providers$/ }).waitFor({ state: 'visible', timeout: 15_000 });
	await settingsEditor.locator('.settings-toc-container .monaco-list-row.selected .settings-toc-entry', { hasText: /^Video Providers$/ }).waitFor({ state: 'visible', timeout: 15_000 });
	if (await page.locator('.quick-input-widget:visible').count() !== 0) {
		throw new Error('Video Providers remained inside QuickInput instead of opening inside Settings');
	}
	return providers;
}

async function closeVideoProvidersPage(page, providers) {
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+W' : 'Control+W');
	await providers.waitFor({ state: 'hidden', timeout: 15_000 });
}

// A new profile has no provider, and Add Provider… offers the six presets of
// the specification. The retired Models & Providers page is gone.
async function assertVideoProvidersPage(page) {
	const providers = await openVideoProvidersPage(page);
	if (await page.locator('.basehalf-model-connections').count() !== 0) {
		throw new Error('The retired Models & Providers page is still mounted beside Video Providers');
	}
	await providers.locator('.basehalf-video-providers-empty', { hasText: 'No providers yet.' }).waitFor({ state: 'visible', timeout: 15_000 });
	const presets = await openVideoProviderPresetMenu(page, providers);
	const labels = await presets.evaluateAll(actions => actions.map(action => (action.textContent ?? '').trim()));
	const expected = ['Volcengine Ark', 'BytePlus ModelArk', 'Alibaba Cloud Model Studio', 'MiniMax', 'Google Gemini', 'OpenAI Compatible'];
	if (JSON.stringify(labels) !== JSON.stringify(expected)) {
		throw new Error(`Add Provider… must offer the six presets ${JSON.stringify(expected)}, got ${JSON.stringify(labels)}`);
	}
	await page.keyboard.press('Escape');
	await presets.first().waitFor({ state: 'hidden', timeout: 10_000 });
	await closeVideoProvidersPage(page, providers);
}

// Opens the preset menu of Add Provider… and returns its actions.
async function openVideoProviderPresetMenu(page, providers) {
	await providers.locator('.basehalf-video-providers-header .basehalf-video-providers-add').click();
	const actions = page.locator('.context-view.monaco-menu-container .action-label').filter({ visible: true });
	await actions.first().waitFor({ state: 'visible', timeout: 10_000 });
	// The menu takes pointer input 100 ms after it opened (see clickCanvasCreateAction).
	await page.waitForTimeout(150);
	return actions;
}

// The plugin platform is frozen and AI Video is built in
// (docs/specs/built-in-ai-video-and-plugin-freeze.md). The product has no
// plugin surface: the sidebar shows exactly Files, Git, and Search, and no
// command opens Plugins or manages a plugin.
async function assertNoPluginSurface(page) {
	if (await page.locator('.part.sidebar .sidebar-utility-footer').count()) {
		throw new Error('The retired custom sidebar plugin footer is still mounted');
	}
	const compositeBarLabels = await page.locator([
		'.part.activitybar .composite-bar .action-item .action-label',
		'.part.sidebar .composite-bar .action-item .action-label'
	].join(', ')).evaluateAll(elements => elements
		.filter(element => (element as HTMLElement).offsetParent !== null)
		.map(element => (element.getAttribute('aria-label') ?? '').trim())
		.filter(label => label.length > 0 && !/^Additional Views/.test(label)));
	const expectedAreas = [/^(Explorer|Files)\b/, /^Source Control\b/, /^Search\b/];
	if (compositeBarLabels.length !== expectedAreas.length
		|| !expectedAreas.every(area => compositeBarLabels.some(label => area.test(label)))) {
		throw new Error(`The sidebar does not show exactly Files, Git, and Search: ${JSON.stringify(compositeBarLabels)}`);
	}
	if (await page.locator('.basehalf-plugins-view, .basehalf-plugin-library').count()) {
		throw new Error('A frozen plugin surface is mounted in the workbench');
	}

	const previousQuickInput = visibleQuickInput(page);
	if (await previousQuickInput.isVisible().catch(() => false)) {
		await page.keyboard.press('Escape');
		await previousQuickInput.waitFor({ state: 'hidden', timeout: 15_000 });
	}
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
	const quickInput = visibleQuickInput(page);
	await quickInput.waitFor({ state: 'visible', timeout: 15_000 });
	// Positive control: the palette must show a command it is known to have,
	// so that a list without plugin commands is a filtered command list and not
	// an unfilled or stale one.
	await quickInput.fill('>Reload Window');
	const controlRow = page.locator('.quick-input-list .monaco-list-row[role="option"]', { hasText: 'Reload Window' }).first();
	await controlRow.waitFor({ state: 'visible', timeout: 15_000 });
	// No letter sequence of "Plugin" matches "Reload Window", so the control
	// row leaving the list shows that the list was filtered for the new query.
	await quickInput.fill('>Plugin');
	await controlRow.waitFor({ state: 'hidden', timeout: 15_000 });
	const readCommandRows = () => page.locator('.quick-input-list .monaco-list-row[role="option"]')
		.evaluateAll(rows => rows.map(row => (row.getAttribute('aria-label') ?? row.textContent ?? '').replace(/\s+/g, ' ').trim()));
	let commandRows = await readCommandRows();
	for (let settledReads = 0; settledReads < 2;) {
		await page.waitForTimeout(250);
		const next = await readCommandRows();
		settledReads = JSON.stringify(next) === JSON.stringify(commandRows) ? settledReads + 1 : 0;
		commandRows = next;
	}
	await page.keyboard.press('Escape');
	await quickInput.waitFor({ state: 'hidden', timeout: 15_000 });
	const pluginCommands = commandRows.filter(row => /plug-?in/i.test(row));
	if (pluginCommands.length) {
		throw new Error(`The Command Palette still lists plugin commands: ${JSON.stringify(pluginCommands)}`);
	}
}

async function assertExternalPluginLifecycle(page) {
	await step('external-plugin-install', async () => {
		const library = await openExternalPluginLibrary(page);
		await runExternalPluginAction(library, 'install');
		await waitForExternalPluginAction(library, 'open');
		await assertExternalPluginInstalledVersion(library);
		await closeExternalPluginLibrary(library);
	});
	await step('external-plugin-projection', async () => {
		await quickOpen(page, path.basename(externalPluginFixturePath()));
		await waitForExternalPluginProjection(page, `Workflow Smoke ${opts.externalPluginVersion}`);
	});
	await step('external-plugin-disable-source-fallback', async () => {
		const library = await openExternalPluginLibrary(page);
		await runExternalPluginAction(library, 'disable');
		await waitForExternalPluginAction(library, 'enable');
		await runNativePluginRuntimeActionIfVisible(page, library);
		await closeExternalPluginLibrary(library);
		await reopenExternalPluginFixture(page);
		await waitForExternalPluginSourceFallback(page);
	});
	await step('external-plugin-enable-projection', async () => {
		const library = await openExternalPluginLibrary(page);
		await runExternalPluginAction(library, 'enable');
		await waitForExternalPluginAction(library, 'disable');
		await runNativePluginRuntimeActionIfVisible(page, library);
		await closeExternalPluginLibrary(library);
		await reopenExternalPluginFixture(page);
		await waitForExternalPluginProjection(page, `Workflow Smoke ${opts.externalPluginVersion}`);
	});
	await step('external-plugin-uninstall-preserves-data', async () => {
		const library = await openExternalPluginLibrary(page);
		await runExternalPluginAction(library, 'uninstall');
		const dialog = page.locator('.monaco-dialog-box', { hasText: 'Existing project files and generated outputs stay on disk.' }).first();
		await dialog.waitFor({ state: 'visible', timeout: 20_000 });
		await dialog.locator('.monaco-button', { hasText: /^Uninstall$/ }).click();
		await dialog.waitFor({ state: 'hidden', timeout: 20_000 });
		await waitForExternalPluginAction(library, 'install');
		if (!fs.existsSync(externalPluginFixturePath()) || fs.readFileSync(externalPluginFixturePath(), 'utf8') !== '{"kept":true}\n') {
			throw new Error('Uninstall changed or removed the external plugin project file');
		}
		await closeExternalPluginLibrary(library);
	});
	return [
		'external-plugin-server-install',
		'external-plugin-projection',
		'external-plugin-disable-source-fallback',
		'external-plugin-enable-projection',
		'external-plugin-uninstall-data-retention'
	];
}

async function assertExternalPluginUpdate(page) {
	await step('external-plugin-seeded-catalog-admission', async () => {
		const library = await openExternalPluginLibrary(page);
		await waitForExternalPluginAction(library, 'update');
		await closeExternalPluginLibrary(library);
	});
	await step('external-plugin-seeded-projection', async () => {
		await quickOpen(page, path.basename(externalPluginFixturePath()));
		await waitForExternalPluginProjection(page, 'Your plugin owns this central project surface');
	});
	await step('external-plugin-native-update', async () => {
		const library = await openExternalPluginLibrary(page);
		await runExternalPluginAction(library, 'update');
		await waitForExternalPluginAction(library, 'open');
		await assertExternalPluginInstalledVersion(library);
		await runNativePluginRuntimeActionIfVisible(page, library, true);
		await closeExternalPluginLibrary(library);
		await reopenExternalPluginFixture(page);
		await waitForExternalPluginProjection(page, `Workflow Smoke ${opts.externalPluginVersion}`);
	});
	return ['external-plugin-seeded-catalog-admission', 'external-plugin-seeded-version-active', 'external-plugin-native-restart-update'];
}

async function assertExternalPluginUninstalled(page) {
	await step('external-plugin-relaunch-source-fallback', async () => {
		if (!fs.existsSync(externalPluginFixturePath()) || fs.readFileSync(externalPluginFixturePath(), 'utf8') !== '{"kept":true}\n') {
			throw new Error('The external plugin project file did not survive relaunch');
		}
		await waitUntil(
			() => !fs.readdirSync(extensionsDir).some(name => name.toLowerCase().startsWith(`${opts.externalPluginId}-`)),
			'VS Code extension management to delete the plugin marked for removal after relaunch',
			15_000
		);
		await quickOpen(page, path.basename(externalPluginFixturePath()));
		await waitForExternalPluginSourceFallback(page);
	});
	return ['external-plugin-relaunch-source-fallback', 'external-plugin-user-data-preserved'];
}

async function assertExternalPluginInstalledRelaunch(page) {
	await step('external-plugin-relaunch-cached-admission', async () => {
		const profile = JSON.parse(fs.readFileSync(path.join(extensionsDir, 'extensions.json'), 'utf8'));
		if (!profile.some(extension => extension.identifier?.id?.toLowerCase() === opts.externalPluginId && extension.version === opts.externalPluginVersion)) {
			throw new Error(`The expected installed plugin is absent from the VS Code extension profile: ${JSON.stringify(profile)}`);
		}
		const library = await openExternalPluginLibrary(page);
		await library.locator('.basehalf-plugin-library-catalog-status', { hasText: 'Signed remote catalog verified' }).waitFor({ state: 'visible', timeout: 45_000 });
		await waitForExternalPluginAction(library, 'open');
		await assertExternalPluginInstalledVersion(library);
		await closeExternalPluginLibrary(library);
		await quickOpen(page, path.basename(externalPluginFixturePath()));
		await waitForExternalPluginProjection(page, `Workflow Smoke ${opts.externalPluginVersion}`);
	});
	return ['external-plugin-relaunch-cached-admission', 'external-plugin-relaunch-remote-refresh', 'external-plugin-relaunch-projection'];
}

async function openExternalPluginLibrary(page) {
	const productConfig = await page.evaluate(() => {
		const configuration = globalThis.vscode?.context?.configuration?.();
		return {
			basehalfPlugins: configuration?.product?.basehalfPlugins,
			basehalfProductKeys: Object.keys(configuration?.product ?? {}).filter(key => key.toLowerCase().includes('basehalf'))
		};
	});
	if (!productConfig.basehalfPlugins) {
		throw new Error(`Remote plugin distribution is absent from the renderer product configuration: ${JSON.stringify(productConfig)}`);
	}
	const pluginsAction = page.locator([
		'.part.activitybar .action-label[aria-label^="Plugins"]',
		'.part.activitybar .action-label.codicon-extensions',
		'.part.sidebar .composite-bar .action-label[aria-label^="Plugins"]',
		'.part.sidebar .composite-bar .action-label.codicon-extensions'
	].join(', ')).first();
	await pluginsAction.waitFor({ state: 'visible', timeout: 20_000 });
	await pluginsAction.click();
	const sidebarRow = page.locator(`.basehalf-plugins-view [data-extension-id="${opts.externalPluginId}"]`).first();
	await sidebarRow.waitFor({ state: 'visible', timeout: 45_000 });
	await sidebarRow.click();
	const library = page.locator('.basehalf-plugin-library').first();
	await library.waitFor({ state: 'visible', timeout: 20_000 });
	const row = library.locator(`[data-extension-id="${opts.externalPluginId}"]`).first();
	await row.waitFor({ state: 'visible', timeout: 20_000 });
	await row.click();
	await library.locator('.basehalf-plugin-library-detail code', { hasText: opts.externalPluginId }).waitFor({ state: 'visible', timeout: 20_000 });
	return library;
}

async function runExternalPluginAction(library, action) {
	const button = library.locator(`[data-plugin-action="${action}"][data-extension-id="${opts.externalPluginId}"]`).first();
	await button.waitFor({ state: 'visible', timeout: 30_000 });
	await button.click();
}

async function waitForExternalPluginAction(library, action) {
	await library.locator(`[data-plugin-action="${action}"][data-extension-id="${opts.externalPluginId}"]`).first().waitFor({ state: 'visible', timeout: 60_000 });
}

async function assertExternalPluginInstalledVersion(library) {
	const row = library.locator('.basehalf-plugin-library-meta-row', { hasText: 'Installed' }).filter({ hasText: opts.externalPluginVersion }).first();
	await row.waitFor({ state: 'visible', timeout: 30_000 });
}

async function closeExternalPluginLibrary(library) {
	await library.locator('[data-action="close"]').click();
	await library.waitFor({ state: 'detached', timeout: 20_000 });
}

async function runNativePluginRuntimeActionIfVisible(page, library, required = false) {
	const action = library.locator('.basehalf-plugin-library-actions .action-label', { hasText: /Restart Extensions|Reload Window/ }).first();
	const visible = await action.isVisible({ timeout: 5_000 }).catch(() => false);
	if (!visible) {
		if (required) {
			throw new Error('The native extension runtime action was not offered after updating an active plugin');
		}
		return;
	}
	await action.click();
	await page.waitForTimeout(1_500);
}

async function reopenExternalPluginFixture(page) {
	await quickOpen(page, 'README.md');
	await page.locator('.basehalf-card-detail-title', { hasText: shownFileName('README.md') }).waitFor({ state: 'visible', timeout: 20_000 });
	await quickOpen(page, path.basename(externalPluginFixturePath()));
}

async function waitForExternalPluginProjection(page, marker) {
	await page.locator('.basehalf-card-detail.visible').waitFor({ state: 'visible', timeout: 20_000 });
	const started = Date.now();
	while (Date.now() - started < 30_000) {
		for (const frame of page.frames()) {
			const text = await frame.locator('body').textContent().catch(() => '');
			if (text?.includes(marker)) {
				return;
			}
		}
		await page.waitForTimeout(100);
	}
	throw new Error(`External plugin projection did not render marker: ${marker}`);
}

async function waitForExternalPluginSourceFallback(page) {
	await page.locator('.basehalf-card-detail.visible .basehalf-card-detail-surface.active .basehalf-card-detail-source').waitFor({ state: 'visible', timeout: 30_000 });
}

async function assertSourceControlPanel(page) {
	await runCommand(page, 'Source Control: Focus on Changes View');
	await page.locator('.part.sidebar .title-label h2', { hasText: /Source Control/i }).waitFor({ state: 'visible', timeout: 20_000 });
	const changesPane = page.locator('.pane', { has: page.locator('.pane-header', { hasText: 'Changes' }) }).first();
	await changesPane.locator('.scm-view').waitFor({ state: 'visible', timeout: 20_000 });
	await changesPane.locator('.monaco-button', { hasText: /Commit/ }).first().waitFor({ state: 'visible', timeout: 20_000 });

	await changesPane.evaluate(async element => {
		const started = Date.now();
		while (Date.now() - started < 20_000) {
			// The SCM tree is virtualized, so only assert an actual rendered
			// change instead of requiring every dirty file to share the DOM.
			const text = element.textContent?.replace(/\s+/g, ' ') ?? '';
			if (text.includes('main')
				&& text.includes('Changes')
				&& text.includes('README.md')) {
				return;
			}
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		const text = element.textContent?.replace(/\s+/g, ' ') ?? '';
		throw new Error(`Source Control Changes view did not show expected Git state: ${text}`);
	});
}

async function assertSourceControlPublishBranchAction(page) {
	await runCommand(page, 'Source Control: Focus on Changes View');
	await page.waitForFunction(() => {
		const buttons = Array.from(document.querySelectorAll('.pane .monaco-button'));
		return buttons.some(button => (button.textContent || '').replace(/\s+/g, ' ').includes('Publish Branch'));
	}, null, { timeout: 20_000 });
}

async function assertGitBranchCheckoutQuickPick(page) {
	await page.locator('.part.statusbar .statusbar-item', { hasText: 'main' }).first().click();
	const quickInput = visibleQuickInput(page);
	await quickInput.waitFor({ state: 'visible', timeout: 15_000 });
	await quickInput.fill('branch-picker-target');
	await waitForQuickInputResult(page, 'branch-picker-target');

	const firstRow = page.locator('.quick-input-list .monaco-list-row[role="option"]').first();
	await firstRow.waitFor({ state: 'visible', timeout: 15_000 });
	const firstRowText = ((await firstRow.getAttribute('aria-label')) ?? (await firstRow.textContent()) ?? '').replace(/\s+/g, ' ').trim();
	if (!firstRowText.includes('branch-picker-target')) {
		await page.keyboard.press('Escape');
		await quickInput.waitFor({ state: 'hidden', timeout: 15_000 });
		throw new Error(`Git branch picker did not offer branch-picker-target first: ${firstRowText}`);
	}

	await page.keyboard.press('Escape');
	await quickInput.waitFor({ state: 'hidden', timeout: 20_000 });
}

/** The name BaseHalf shows for a file: a note has no extension there (canvas card name). */
function shownFileName(relativePath) {
	return path.basename(relativePath).replace(/(?<=.)\.(?:md|markdown)$/i, '');
}

async function assertCardDetail(page, title) {
	await page.locator('.basehalf-card-detail.visible').waitFor({ state: 'visible', timeout: 20_000 });
	await page.locator('.basehalf-card-detail-title', { hasText: shownFileName(title) }).waitFor({ state: 'visible', timeout: 20_000 });
	const activeSurface = page.locator('.basehalf-card-detail-surface.active');
	await activeSurface.waitFor({ state: 'visible', timeout: 8_000 });
	const richHost = activeSurface.locator('.basehalf-card-detail-markdown-rich-webview');
	if (await richHost.count()) {
		// A first rich surface is active immediately so its iframe loads at normal
		// priority. It is not interactive until the webview acknowledges both the
		// document commit and settled focus boundary.
		const renderedHost = activeSurface.locator(
			'[data-basehalf-rendered][data-basehalf-render-state="rendered"].basehalf-card-detail-markdown-rich-webview'
		);
		await renderedHost.waitFor({ state: 'visible', timeout: 8_000 });
		await page.waitForFunction(host => !host.inert && host.getAttribute('aria-busy') === null, await renderedHost.elementHandle(), { timeout: 8_000 });
		const lifecycle = await renderedHost.evaluate(host => ({
			hostInert: host.inert,
			hostBusy: host.getAttribute('aria-busy'),
			surfaceRendered: host.closest('.basehalf-card-detail-surface')?.getAttribute('data-basehalf-rendered'),
			surfaceState: host.closest('.basehalf-card-detail-surface')?.getAttribute('data-basehalf-render-state')
		}));
		if (lifecycle.hostInert || lifecycle.hostBusy !== null
			|| lifecycle.surfaceRendered === null || lifecycle.surfaceState !== 'rendered') {
			throw new Error(`The rich Card Detail first-frame lifecycle is incomplete: ${JSON.stringify(lifecycle)}`);
		}
		await activeMarkdownRichFrame(page, '.basehalf-card-detail-surface.active');
	}
}

async function assertMediaCardDetail(page) {
	await assertCardDetail(page, 'concept.svg');
	const active = page.locator('.basehalf-card-detail-surface.active');
	await active.locator('.basehalf-card-detail-media-webview').waitFor({ state: 'visible', timeout: 8_000 });
	const pressed = page.locator('.basehalf-card-detail-projection[aria-label="View"]');
	if (await pressed.count() > 0 && await pressed.getAttribute('aria-pressed') !== 'true') {
		throw new Error('Supported media did not select the registered View projection by default');
	}
	if (await page.locator('.basehalf-card-detail-projection[aria-label="Source"]').count() > 0) {
		throw new Error('Direct-render image media exposed the raw Source projection');
	}

	const started = Date.now();
	while (Date.now() - started < 8_000) {
		for (const frame of page.frames()) {
			if (await frame.locator('img#media').count().catch(() => 0) > 0) {
				return;
			}
		}
		await page.waitForTimeout(100);
	}
	throw new Error('Media projection webview did not render the local SVG');
}

// Where the title bar shows the layout controls (docs/specs/layout-controls.md).
function readLayoutControls(page) {
	return page.evaluate(() => {
		const labels = selector => Array.from(document.querySelectorAll(selector)).map(node => node.getAttribute('aria-label') ?? '');
		const button = document.querySelector('.part.titlebar .titlebar-left .left-toolbar-container .action-label');
		const rect = button?.getBoundingClientRect();
		const topmost = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
		return {
			left: labels('.part.titlebar .titlebar-left .left-toolbar-container .action-label'),
			right: labels('.part.titlebar .titlebar-right .action-toolbar-container .action-label'),
			rect: rect ? [rect.left, rect.top, rect.width, rect.height] : undefined,
			// "Visible" does not see a control that another element covers.
			onTop: !!button && !!topmost && (topmost === button || button.contains(topmost)),
			fullscreen: !!document.querySelector('.monaco-workbench.fullscreen')
		};
	});
}

async function assertLayoutControlAtTheLeftEnd(page) {
	const button = page.locator('.part.titlebar .titlebar-left .left-toolbar-container .action-label');
	const sideBar = page.locator('[id="workbench.parts.sidebar"]');
	await button.first().waitFor({ state: 'visible', timeout: 15_000 });
	await sideBar.waitFor({ state: 'visible', timeout: 8_000 });

	// The control of the sidebar is at the left end, once, and not in the
	// right group.
	const shown = await readLayoutControls(page);
	if (shown.left.length !== 1 || !shown.left[0].startsWith('Toggle Primary Side Bar') || !shown.onTop) {
		throw new Error(`The left end of the title bar does not hold the control of the sidebar: ${JSON.stringify(shown)}`);
	}
	if (shown.right.some(label => label.startsWith('Toggle Primary Side Bar'))) {
		throw new Error(`The right group of the title bar still holds the control of the sidebar: ${JSON.stringify(shown.right)}`);
	}
	// On macOS it follows the window buttons.
	if (process.platform === 'darwin' && !shown.fullscreen && Math.abs(shown.rect[0] - 80) > 0.5) {
		throw new Error(`The control of the sidebar is not 80 px from the left edge of the window: ${JSON.stringify(shown.rect)}`);
	}

	// It hides the sidebar and stays where it is.
	await button.click();
	await sideBar.waitFor({ state: 'hidden', timeout: 8_000 });
	const hidden = await readLayoutControls(page);
	if (JSON.stringify(hidden.rect) !== JSON.stringify(shown.rect) || !hidden.onTop) {
		throw new Error(`The control of the sidebar moved when the sidebar was hidden: ${JSON.stringify({ shown: shown.rect, hidden: hidden.rect, onTop: hidden.onTop })}`);
	}

	// Leave the window as it was, with the pointer off the control so that its
	// tooltip does not stay over the sidebar.
	await button.click();
	await sideBar.waitFor({ state: 'visible', timeout: 8_000 });
	await page.mouse.move(640, await page.evaluate(() => window.innerHeight - 6));
}

async function assertCardDetailHoldsNoLayoutControl(page) {
	await page.locator('.basehalf-card-detail.visible').waitFor({ state: 'visible', timeout: 8_000 });
	// The header of a card holds what acts on the card: its views and Close.
	const header = await page.evaluate(() => Array.from(document.querySelectorAll('.basehalf-card-detail.visible .basehalf-card-detail-actions button'))
		.filter(node => node.getBoundingClientRect().width > 0)
		.map(node => node.getAttribute('aria-label') ?? ''));
	if (header.some(label => /side ?bar/i.test(label) || label === 'Focus on document') || header.at(-1) !== 'Close') {
		throw new Error(`The header of Card Detail holds a layout control: ${JSON.stringify(header)}`);
	}
	if (await page.locator('.basehalf-card-detail-focus').count()) {
		throw new Error('The header of Card Detail still holds the button that hides the sidebar');
	}
	// The control of the sidebar is in the title bar while a card is open.
	const controls = await readLayoutControls(page);
	if (controls.left.length !== 1 || !controls.left[0].startsWith('Toggle Primary Side Bar') || !controls.onTop) {
		throw new Error(`The title bar does not hold the control of the sidebar while a card is open: ${JSON.stringify(controls)}`);
	}
}

async function assertPdfCardDetail(page, expectedName = 'textbook.pdf') {
	await assertCardDetail(page, expectedName);
	const pressed = page.locator('.basehalf-card-detail-projection[aria-label="View"]');
	if (await pressed.count() > 0 && await pressed.getAttribute('aria-pressed') !== 'true') {
		throw new Error('PDF did not select the registered View projection by default');
	}
	if (await page.locator('.basehalf-card-detail-projection[aria-label="Source"]').count() > 0) {
		throw new Error('A binary PDF exposed the raw Source projection');
	}

	const started = Date.now();
	let diagnostic = '';
	while (Date.now() - started < 15_000) {
		for (const frame of page.frames()) {
			const root = frame.locator('#basehalf-pdf-viewer');
			if (await root.count().catch(() => 0) === 0) {
				continue;
			}
			const container = root.locator('embedpdf-container');
			const documentContent = container.locator('#document-content');
			const status = await root.getAttribute('data-status');
			const pageCount = await root.getAttribute('data-page-count');
			if (status === 'ready' && pageCount === '1' && await container.count() > 0 && await documentContent.count() > 0) {
				return;
			}
			diagnostic = await frame.locator('body').evaluate(body => {
				const viewer = body.querySelector('#basehalf-pdf-viewer');
				const error = body.querySelector('#basehalf-pdf-error');
				return JSON.stringify({
					source: viewer?.getAttribute('data-source'),
					status: viewer?.getAttribute('data-status'),
					pageCount: viewer?.getAttribute('data-page-count'),
					container: viewer?.querySelector('embedpdf-container') !== null,
					error: error?.textContent,
					errorHidden: error?.hasAttribute('hidden'),
					body: body.textContent?.replace(/\s+/g, ' ').trim()
				});
			});
		}
		await page.waitForTimeout(100);
	}
	throw new Error(`PDF projection webview did not render the local fixture: ${diagnostic}`);
}

// Each branch note is created with the PDF in its `upstream` frontmatter, in
// its first saved bytes (D37): the PDF → note edge appears and nothing else is
// written for the connection.
async function assertPdfGrowsThreeBranches(page) {
	const sourcePath = path.join(workspacePath, 'docs', 'textbook.pdf');
	const sourceMirrorPath = path.join(workspacePath, '.bh', 'mirror', 'docs', 'textbook.pdf');
	const branchNames = ['textbook-note.md', 'textbook-note-2.md', 'textbook-note-3.md'];

	for (let index = 0; index < branchNames.length; index++) {
		if (index > 0) {
			await quickOpen(page, 'textbook.pdf');
			await assertPdfCardDetail(page);
		}

		const action = await selectPdfFixtureText(page);
		await action.click();
		const name = branchNames[index];
		const branchPath = path.join(workspacePath, 'docs', name);
		await waitUntil(() => fs.existsSync(branchPath), `${name} to be created from the PDF selection`, 15_000);
		await assertCanvasFolder(page, 'docs');
		const branchCard = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="docs/${name}"]`);
		await branchCard.waitFor({ state: 'visible', timeout: 15_000 });
		await waitForCanvasCardSelection(page, `docs/${name}`, 15_000);
		if (await page.locator('.basehalf-card-detail.visible').isVisible().catch(() => false)) {
			throw new Error(`${name} opened Card Detail instead of returning to the PDF canvas`);
		}
		const branchEditor = await waitForCanvasNoteInlineEditor(page, `docs/${name}`);
		const markdown = fs.readFileSync(branchPath, 'utf8');
		if (!markdown.includes('> BaseHalf PDF') || !markdown.includes('Source: [textbook.pdf](./textbook.pdf), page 1')) {
			throw new Error(`${name} did not preserve the selected passage and source page as ordinary Markdown`);
		}
		if (!markdown.startsWith('---\nupstream:\n  - docs/textbook.pdf\n---\n')) {
			throw new Error(`${name} did not list the PDF as upstream in its first bytes: ${JSON.stringify(markdown.slice(0, 120))}`);
		}
		await assertCanvasEdgeVisible(page, 'docs/textbook.pdf', `docs/${name}`);
		for (const mirrorPath of [
			path.join(sourceMirrorPath, 'badge.yaml'),
			path.join(sourceMirrorPath, 'upstream.yaml'),
			path.join(workspacePath, '.bh', 'mirror', 'docs', name, 'badge.yaml'),
			path.join(workspacePath, '.bh', 'mirror', 'docs', name, 'upstream.yaml')
		]) {
			if (fs.existsSync(mirrorPath)) {
				throw new Error(`Growing ${name} wrote ${path.relative(workspacePath, mirrorPath)}; the connection belongs only in the note`);
			}
		}
		await page.keyboard.press('Escape');
		await branchEditor.host.waitFor({ state: 'detached', timeout: 10_000 });
	}

	if (!fs.existsSync(sourcePath)) {
		throw new Error('Growing PDF branches unexpectedly moved or removed the source document');
	}
	for (const name of branchNames) {
		await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="docs/${name}"]`).waitFor({ state: 'visible', timeout: 15_000 });
	}
}

async function selectPdfFixtureText(page) {
	let diagnostic = '';
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		for (const frame of page.frames()) {
			const root = frame.locator('#basehalf-pdf-viewer[data-status="ready"]');
			if (await root.count().catch(() => 0) === 0) {
				continue;
			}
			const images = root.locator('embedpdf-container').locator('#document-content img');
			const candidates = [];
			for (let index = 0; index < await images.count(); index++) {
				const box = await images.nth(index).boundingBox();
				if (box) {
					candidates.push({ box, area: box.width * box.height });
				}
			}
			const pageImage = candidates.sort((a, b) => b.area - a.area)[0]?.box;
			if (!pageImage) {
				diagnostic = JSON.stringify({ status: 'ready', renderedPageImages: await images.count() });
				continue;
			}

			const action = frame.locator('button', { hasText: 'Grow branch' }).last();
			// Both ends of an EmbedPDF text-selection drag must land on glyphs.
			// The fixture line starts at x=40pt and has a 120pt baseline on a
			// 300x200pt page, so keep the drag comfortably inside the rendered text
			// instead of ending in the large blank area to its right.
			for (const yRatio of [0.39, 0.36, 0.42]) {
				await page.mouse.move(pageImage.x + pageImage.width * 0.15, pageImage.y + pageImage.height * yRatio);
				await page.mouse.down();
				await page.mouse.move(pageImage.x + pageImage.width * 0.66, pageImage.y + pageImage.height * yRatio, { steps: 24 });
				await page.mouse.up();
				if (await action.waitFor({ state: 'visible', timeout: 1_500 }).then(() => true, () => false)) {
					return action;
				}
			}
			diagnostic = await root.locator('embedpdf-container').evaluate(async element => {
				const registry = await element.registry;
				const interaction = registry.getPlugin('interaction-manager')?.provides();
				const selection = registry.getPlugin('selection')?.provides();
				return JSON.stringify({
					plugins: registry.getAllPlugins().map(plugin => plugin.id),
					mode: interaction?.forDocument('basehalf-document').getActiveMode(),
					selection: selection?.getState('basehalf-document')
				});
			});
		}
		await page.waitForTimeout(100);
	}
	throw new Error(`The PDF selection menu did not expose Grow branch for the fixture text: ${diagnostic}`);
}

async function assertVideoWorkflowTemplate(page) {
	const workflowName = 'Video Starter Workflow';
	const workflowRoot = path.join(workspacePath, workflowName);
	await openRootCanvas(page);
	await runCommandWhenAvailable(page, 'Create Video Workflow…');
	await waitUntil(() => [
		'brief.md',
		'script.md',
		'shots/shot-01/storyboard.md',
		'shots/shot-01/audio-plan.md',
		'shots/shot-01/clip.bhnode',
		'video-sequence.json'
	].every(relativePath => fs.existsSync(path.join(workflowRoot, relativePath))), 'video workflow template files to be created', 20_000);
	await assertCanvasFolder(page, '');
	const workflowCard = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${workflowName}"]`);
	await workflowCard.waitFor({ state: 'visible', timeout: 15_000 });
	await waitForCanvasCardSelection(page, workflowName, 15_000);
	if (await page.locator('.basehalf-card-detail.visible').isVisible().catch(() => false)) {
		throw new Error('Canvas template creation opened content instead of staying on the parent canvas');
	}
	await workflowCard.dblclick();
	await assertCanvasFolder(page, workflowName);
	for (const relativePath of [
		'brief.md',
		'script.md',
			'video-sequence.json',
		'shots'
	]) {
		await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${workflowName}/${relativePath}"]`).waitFor({ state: 'attached', timeout: 15_000 });
	}
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${workflowName}/shots"]`).dblclick();
	await assertCanvasFolder(page, `${workflowName}/shots`);
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${workflowName}/shots/shot-01"]`).dblclick();
	await assertCanvasFolder(page, `${workflowName}/shots/shot-01`);
	for (const relativePath of [
		'storyboard.md',
		'audio-plan.md',
		'clip.bhnode'
	]) {
		await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${workflowName}/shots/shot-01/${relativePath}"]`).waitFor({ state: 'attached', timeout: 15_000 });
	}
	// The starter makes one empty Video node of version 5, whose inputs are
	// the shot's notes, and no planning nodes (D58).
	const shotNodes = fs.readdirSync(path.join(workflowRoot, 'shots/shot-01')).filter(name => name.toLowerCase().endsWith('.bhnode'));
	const clipNode = JSON.parse(fs.readFileSync(path.join(workflowRoot, 'shots/shot-01/clip.bhnode'), 'utf8'));
	if (JSON.stringify(shotNodes) !== JSON.stringify(['clip.bhnode'])
		// A new Video node may start with the settings last used on this computer.
		|| JSON.stringify(Object.keys(clipNode).filter(key => key !== 'generation')) !== JSON.stringify(['version', 'id', 'kind', 'title', 'prompt', 'upstream'])
		|| clipNode.version !== 5
		|| clipNode.kind !== 'video'
		|| clipNode.prompt !== ''
		|| JSON.stringify(clipNode.upstream) !== JSON.stringify([`${workflowName}/shots/shot-01/storyboard.md`, `${workflowName}/shots/shot-01/audio-plan.md`])) {
		throw new Error(`The starter workflow did not produce one empty Video node: ${JSON.stringify({ shotNodes, clipNode })}`);
	}
	// Template references are stored once, in each target: a Markdown target
	// keeps them in its frontmatter, merged by the planner.
	const script = fs.readFileSync(path.join(workflowRoot, 'script.md'), 'utf8');
	if (!script.startsWith(`---\nupstream:\n  - ${workflowName}/brief.md\n---\n# Script\n`)) {
		throw new Error(`The starter workflow did not store the brief → script connection in script.md: ${JSON.stringify(script.slice(0, 120))}`);
	}
	if (fs.existsSync(path.join(workspacePath, '.bh', 'mirror', workflowName, 'brief.md', 'badge.yaml'))) {
		throw new Error('The starter workflow wrote a badge for a template connection');
	}
}

// --- The Video node (D58, docs/specs/video-node.md) ------------------------------------------
//
// Acceptance criteria 2, 4, 6, 8 to 17, 19, and 20, the two frames of 3, and
// the choice of a user's model id of 7, through the window and against the
// local test provider with its test key; no paid provider is called. The
// steps run in order, each where the one before ended.

async function runVideoNodeSteps(page) {
	await step('video-node-create-opens-panel', () => assertVideoNodeCreateOpensPanel(page));
	await step('video-node-prompt-saves-without-dialog', () => assertVideoNodePromptSavesWithoutDialog(page));
	await step('video-providers-add-channel', () => assertVideoProvidersAddChannel(page));
	await step('video-panel-model-and-settings', () => assertVideoPanelModelAndSettings(page));
	await step('video-provider-key-stays-secret', () => assertVideoProviderKeyStaysSecret(page));
	await step('video-panel-inputs-and-names', () => assertVideoPanelInputsAndNames(page));
	await step('video-panel-placement', () => assertVideoPanelPlacement(page));
	await step('video-generate-writes-video', () => assertVideoGenerateWritesVideo(page));
	await step('video-capture-frames', () => assertVideoCaptureFrames(page));
	await step('video-card-keeps-its-player', () => assertVideoCardKeepsItsPlayer(page));
	await step('video-generate-again-makes-sibling', () => assertVideoGenerateAgainMakesSibling(page));
	await step('video-generation-fails-and-stops', () => assertVideoGenerationFailsAndStops(page));
	await step('video-agent-runs-node', () => assertVideoAgentRunsNode(page));
}

async function videoSmokeProvider() {
	videoSmoke.provider ??= await startVideoSmokeProvider({ durationMs: VIDEO_PROVIDER_DURATION_MS, holdCreateMs: VIDEO_PROVIDER_CREATE_HOLD_MS });
	return videoSmoke.provider;
}

async function stopVideoSmokeProvider() {
	const provider = videoSmoke.provider;
	videoSmoke.provider = undefined;
	await provider?.close().catch(error => console.error(`[basehalf-smoke] the video test provider did not stop: ${error instanceof Error ? error.message : String(error)}`));
}

// Criteria 8 and 12, and the first half of 10: a Video node made from the
// create menu is selected and shows its panel with the prompt focused,
// nothing has moved the view, and with no model chosen Generate is disabled
// and says why, also in its tooltip.
async function assertVideoNodeCreateOpensPanel(page) {
	await videoSmokeProvider();
	createVideoSmokeFolder();
	await quickOpen(page, VIDEO_FOLDER);
	await assertCanvasFolder(page, VIDEO_FOLDER);
	const start = videoCanvasCard(page, VIDEO_START_IMAGE);
	await start.waitFor({ state: 'visible', timeout: 20_000 });
	await videoCanvasCard(page, VIDEO_END_IMAGE).waitFor({ state: 'visible', timeout: 20_000 });
	// At half size, with the images at the top left, the middle of the view
	// has room for the new card, which is 720 by 405.
	await setCanvasZoomPercent(page, 50);
	const canvasBox = await page.locator('.basehalf-canvas-cards').boundingBox();
	await panCanvasCardTo(page, start, { x: canvasBox.x + 40, y: canvasBox.y + 60 });
	const viewBefore = await readCanvasView(page);

	await clickCanvasCreateSubmenuAction(page, 'New Media or Document', 'Video');
	await waitUntil(() => fs.existsSync(videoWorkspaceFile(VIDEO_NODE)), `the create menu to make ${VIDEO_NODE}`, 20_000);
	const created = readVideoNode(VIDEO_NODE);
	// No generation ran on this computer yet, so the node chooses no model.
	if (JSON.stringify(Object.keys(created).sort()) !== JSON.stringify(['id', 'kind', 'prompt', 'title', 'upstream', 'version'])
		|| created.version !== 5 || created.kind !== 'video' || created.title !== 'Video' || created.prompt !== '' || created.upstream.length !== 0) {
		throw new Error(`The create menu made an unexpected Video node: ${JSON.stringify(created)}`);
	}
	await waitForCanvasCardSelection(page, VIDEO_NODE, 15_000);
	const panel = await waitForVideoPanel(page, VIDEO_NODE);
	await waitForReading(() => readVideoPanel(panel), seen => seen.promptFocused, 'the prompt of the new Video node to have the keyboard focus');
	assertSameCanvasView(viewBefore, await readCanvasView(page), 'Making a Video node and opening its panel');
	const shown = await waitForReading(() => readVideoPanel(panel), seen => seen.generate?.disabled === true, 'Generate to be disabled while no model is chosen');
	// No model and no prompt: the first blocker is the model.
	if (shown.generate.label !== 'Choose a model to generate.' || shown.model !== 'Choose Model' || !shown.modelOutlined || shown.generate.stop) {
		throw new Error(`Without a model, Generate must say so as its name and the model button must be outlined: ${JSON.stringify(shown)}`);
	}
	await panel.locator('button.bh-video-panel-generate').hover();
	await page.locator('.workbench-hover', { hasText: 'Choose a model to generate.' }).waitFor({ state: 'visible', timeout: 10_000 });
	await page.mouse.move(canvasBox.x + 8, canvasBox.y + canvasBox.height - 8);
}

// Criteria 9 and 10: the prompt typed with the keyboard is saved to the
// node's file when the user clicks the canvas, without a model and without a
// dialog, and the panel goes with the card's selection.
async function assertVideoNodePromptSavesWithoutDialog(page) {
	const panel = videoPanel(page, VIDEO_NODE);
	await waitForReading(() => readVideoPanel(panel), seen => seen.promptFocused, 'the prompt to keep the keyboard focus');
	await page.keyboard.type(VIDEO_PROMPT);
	await waitForReading(() => readVideoPanel(panel), seen => seen.prompt === VIDEO_PROMPT, 'the prompt to hold what was typed');
	await clickBlankVideoCanvas(page);
	await waitUntil(() => readVideoNode(VIDEO_NODE).prompt === VIDEO_PROMPT, `the typed prompt to be saved in ${VIDEO_NODE}`, 10_000);
	await waitForReading(() => page.locator('.basehalf-canvas-video-panel-surface').count(), count => count === 0, 'the Video panel to go when its card is no longer selected');
	// Saving never asks, also a moment later.
	await page.waitForTimeout(500);
	if (await page.locator('.monaco-dialog-box').count() !== 0) {
		throw new Error(`Saving the prompt of a Video node opened a dialog: ${await page.locator('.monaco-dialog-box').first().innerText()}`);
	}
	if (readVideoNode(VIDEO_NODE).generation !== undefined) {
		throw new Error(`Saving the prompt chose a model: ${JSON.stringify(readVideoNode(VIDEO_NODE))}`);
	}
}

// Criterion 6, and the start of 7: a Volcengine Ark channel starts with its
// endpoint, Seedance 2.5, and no key. It is pointed at the test provider, a
// relay on this computer that speaks the same format, and gets a model id
// of the user's own.
async function assertVideoProvidersAddChannel(page) {
	const provider = await videoSmokeProvider();
	const providers = await openVideoProvidersPage(page);
	const presets = await openVideoProviderPresetMenu(page, providers);
	await presets.filter({ hasText: /^Volcengine Ark$/ }).click();
	const rows = providers.locator('.basehalf-video-provider-row');
	await waitForReading(() => rows.count(), count => count === 1, 'Volcengine Ark to be added');
	videoSmoke.channelId = await rows.first().getAttribute('data-channel-id');
	const added = await waitForReading(() => readVideoProviderEditor(providers), seen => seen.endpoint !== null, 'the editor of the new provider');
	if (added.name !== 'Volcengine Ark' || added.endpoint !== 'https://ark.cn-beijing.volces.com/api/v3' || added.keySet
		|| JSON.stringify(added.models) !== JSON.stringify([{ id: VIDEO_MODEL, label: 'Seedance 2.5' }])) {
		throw new Error(`A new Volcengine Ark provider must start with its endpoint, Seedance 2.5, and no key: ${JSON.stringify(added)}`);
	}
	await providers.locator('#basehalf-video-provider-endpoint').click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
	await page.keyboard.type(provider.seedanceBaseUrl);
	await page.keyboard.press('Enter');
	await waitForReading(() => readVideoProviderEditor(providers), seen => seen.endpoint === provider.seedanceBaseUrl && seen.status === 'Saved.', 'the endpoint of the test provider to be saved');
	await providers.locator('.basehalf-video-provider-model-add input').click();
	await page.keyboard.type(VIDEO_USER_MODEL);
	await page.keyboard.press('Enter');
	await waitForReading(() => readVideoProviderEditor(providers), seen => JSON.stringify(seen.models.map(model => model.id)) === JSON.stringify([VIDEO_MODEL, VIDEO_USER_MODEL]), 'the model id to be added after Seedance 2.5');
	await closeVideoProvidersPage(page, providers);
	await assertCanvasFolder(page, VIDEO_FOLDER);
}

// Criteria 11 and 12: the model menu lists the channel's models and the way
// to Video Providers; with a model and no key, Generate names the key; the
// settings popover shows only what the model accepts, and its button sums up
// what the file stores; another model keeps what it accepts and takes its
// default for the rest.
async function assertVideoPanelModelAndSettings(page) {
	const panel = await selectVideoCard(page, VIDEO_NODE);
	await panel.locator('button.bh-video-panel-model').click();
	const menu = await waitForReading(() => readVideoModelMenu(panel), seen => seen !== null, 'the model menu to open');
	const expectedMenu = {
		groups: [{ label: 'Volcengine Ark', detail: 'No API key', items: ['Seedance 2.5', VIDEO_USER_MODEL] }],
		end: ['Manage Video Providers…']
	};
	if (JSON.stringify(menu) !== JSON.stringify(expectedMenu)) {
		throw new Error(`The model menu must list the models of the provider, then Manage Video Providers…: ${JSON.stringify(menu)}`);
	}
	await clickVideoModel(page, panel, VIDEO_MODEL);
	const chosen = { mode: 'frames', ratio: '16:9', resolution: '720p', duration: 5, audio: true, channel: videoSmoke.channelId, model: VIDEO_MODEL };
	await waitUntil(() => canonicalJson(readVideoNode(VIDEO_NODE).generation) === canonicalJson(chosen), 'choosing Seedance 2.5 to store its channel, model, and default settings', 10_000);
	const blocked = await waitForReading(() => readVideoPanel(panel), seen => seen.model === 'Seedance 2.5' && seen.generate?.label === 'Volcengine Ark has no API key. Add one in Video Providers.', 'Generate to name the missing key');
	if (!blocked.generate.disabled || !blocked.modelOutlined) {
		throw new Error(`Without a key, Generate must be disabled and the model button outlined: ${JSON.stringify(blocked)}`);
	}

	const seedanceKeys = ['mode:frames', 'mode:reference', 'ratio:16:9', 'ratio:4:3', 'ratio:1:1', 'ratio:3:4', 'ratio:9:16', 'ratio:21:9', 'ratio:adaptive', 'resolution:480p', 'resolution:720p', 'resolution:1080p', 'duration:slider', 'duration:auto', 'sound'];
	let settings = await openVideoSettings(panel);
	if (settings.width !== 300 || JSON.stringify(settings.keys) !== JSON.stringify(seedanceKeys)
		|| JSON.stringify(settings.checked) !== JSON.stringify(['mode:frames', 'ratio:16:9', 'resolution:720p', 'sound'])
		|| JSON.stringify(settings.slider) !== JSON.stringify({ min: 4, max: 30, value: 5, disabled: false }) || settings.disabled.length !== 0) {
		throw new Error(`The settings popover must show what Seedance 2.5 accepts, 300 px wide: ${JSON.stringify(settings)}`);
	}
	await assertVideoSettingsSummary(panel, 'Frames · 16:9 · 720p · 5s · Sound', chosen);
	await panel.locator('.bh-video-panel-menu.settings [data-key="resolution:1080p"]').click();
	await assertVideoSettingsSummary(panel, 'Frames · 16:9 · 1080p · 5s · Sound', { ...chosen, resolution: '1080p' });
	// Seedance 2.5 can choose its own length.
	await panel.locator('.bh-video-panel-menu.settings [data-key="duration:auto"]').click();
	await assertVideoSettingsSummary(panel, 'Frames · 16:9 · 1080p · Auto · Sound', { ...chosen, resolution: '1080p', duration: -1 });
	await closeVideoPanelMenu(page, panel, 'settings');

	// The general profile has no Auto: the duration takes its default, the rest stays.
	await panel.locator('button.bh-video-panel-model').click();
	await waitForReading(() => readVideoModelMenu(panel), seen => seen !== null, 'the model menu to open again');
	await clickVideoModel(page, panel, VIDEO_USER_MODEL);
	await assertVideoSettingsSummary(panel, 'Frames · 16:9 · 1080p · 5s · Sound', { ...chosen, model: VIDEO_USER_MODEL, resolution: '1080p' });
	settings = await openVideoSettings(panel);
	if (JSON.stringify(settings.keys) !== JSON.stringify(seedanceKeys.filter(key => key !== 'duration:auto')) || settings.slider?.max !== 15) {
		throw new Error(`The settings popover of a model BaseHalf does not know must show the general profile, 4 to 15 seconds without Auto: ${JSON.stringify(settings)}`);
	}
	await closeVideoPanelMenu(page, panel, 'settings');
	await panel.locator('button.bh-video-panel-model').click();
	await waitForReading(() => readVideoModelMenu(panel), seen => seen !== null, 'the model menu to open a third time');
	await clickVideoModel(page, panel, VIDEO_MODEL);
	await assertVideoSettingsSummary(panel, 'Frames · 16:9 · 1080p · 5s · Sound', { ...chosen, resolution: '1080p' });
	await clickBlankVideoCanvas(page);
}

// Criterion 6: the key is typed into the page and saved; the page then says
// that a key is set and never shows it, and no workspace file holds it. With
// the key, Generate is enabled.
async function assertVideoProviderKeyStaysSecret(page) {
	const provider = await videoSmokeProvider();
	const providers = await openVideoProvidersPage(page);
	const keyInput = providers.locator('.basehalf-video-provider-key-row input[type="password"]');
	await keyInput.click();
	await waitForReading(() => keyInput.evaluate(input => input === input.ownerDocument.activeElement, undefined, { timeout: 2_000 }), focused => focused, 'the key field to have the keyboard focus');
	await page.keyboard.type(provider.key);
	await page.keyboard.press('Enter');
	const saved = await waitForReading(() => readVideoProviderEditor(providers), seen => seen.keySet && seen.status === 'Key saved.', 'the key to be saved');
	if (saved.keyState !== 'A key is set. It is encrypted on this computer and never shown.' || saved.rowKey !== 'Key set') {
		throw new Error(`The page must say that a key is set: ${JSON.stringify(saved)}`);
	}
	const inPage = await page.evaluate(key => ({
		markup: document.documentElement.outerHTML.includes(key),
		fields: Array.from(document.querySelectorAll('input, textarea')).some(field => field.value.includes(key))
	}), provider.key);
	if (inPage.markup || inPage.fields) {
		throw new Error(`The window holds the provider key after it was saved: ${JSON.stringify(inPage)}`);
	}
	const files = filesContaining(workspacePath, provider.key);
	if (files.length) {
		throw new Error(`The provider key is in workspace files: ${files.join(', ')}`);
	}
	await closeVideoProvidersPage(page, providers);
	await assertCanvasFolder(page, VIDEO_FOLDER);
	const panel = await selectVideoCard(page, VIDEO_NODE);
	const ready = await waitForReading(() => readVideoPanel(panel), seen => seen.generate?.disabled === false, 'Generate to be enabled once the provider has a key');
	if (ready.generate.label !== 'Generate' || ready.modelOutlined) {
		throw new Error(`With a model, a key, and a prompt, Generate must be ready: ${JSON.stringify(ready)}`);
	}
}

// Criteria 3, 4, 11, and 13: an image connected with Pick on Canvas and one
// connected by a drawn line are the start and end frames, in upstream order,
// and the ratio follows the start frame; the swap arrow exchanges their two
// entries and nothing else, in one undo step; `@` lists the inputs by name
// and types the chosen one; a name of no input is underlined.
async function assertVideoPanelInputsAndNames(page) {
	let panel = await selectVideoCard(page, VIDEO_NODE);
	const empty = await readVideoPanel(panel);
	if (JSON.stringify(empty.emptySlots) !== JSON.stringify(['start', 'end'])) {
		throw new Error(`Frames mode on Seedance 2.5 must show an empty start and end slot: ${JSON.stringify(empty)}`);
	}
	await panel.locator('button.bh-video-panel-slot.empty[data-role="start"]').click();
	const addMenu = panel.locator('.bh-video-panel-menu.add');
	await addMenu.waitFor({ state: 'visible', timeout: 10_000 });
	await addMenu.locator('.bh-video-panel-menu-item[data-key="pick"]').click();
	await page.locator('.basehalf-video-pick-banner').waitFor({ state: 'visible', timeout: 10_000 });
	await clickCanvasCardOnTop(page, VIDEO_START_IMAGE);
	await waitUntil(() => JSON.stringify(readVideoNode(VIDEO_NODE).upstream) === JSON.stringify([VIDEO_START_IMAGE]), 'Pick on Canvas to connect start.png', 10_000);
	await page.locator('.basehalf-video-pick-banner').waitFor({ state: 'detached', timeout: 10_000 });
	// The click that picked selected nothing.
	await waitForCanvasCardSelection(page, VIDEO_NODE);

	await drawCanvasConnectionInto(page, VIDEO_END_IMAGE, VIDEO_NODE);
	await waitUntil(() => JSON.stringify(readVideoNode(VIDEO_NODE).upstream) === JSON.stringify([VIDEO_START_IMAGE, VIDEO_END_IMAGE]), 'the drawn connection to add end.png after start.png', 10_000);
	panel = await selectVideoCard(page, VIDEO_NODE);
	const frames = await waitForReading(() => readVideoPanel(panel), seen => seen.start?.path === VIDEO_START_IMAGE && seen.end?.path === VIDEO_END_IMAGE, 'the panel to show start.png and end.png as the frames');
	if (frames.start.name !== 'Image 1' || frames.end.name !== 'Image 2' || frames.settings !== 'Frames · Adaptive · 1080p · 5s · Sound') {
		throw new Error(`The frames must be named by upstream order, and the ratio must follow the start frame: ${JSON.stringify(frames)}`);
	}
	const settings = await openVideoSettings(panel);
	const ratios = settings.keys.filter(key => key.startsWith('ratio:'));
	if (settings.note !== 'Follows the start frame' || JSON.stringify(settings.disabled) !== JSON.stringify(ratios) || !settings.checked.includes('ratio:adaptive')) {
		throw new Error(`With a start frame, Seedance 2.5 takes only an adaptive ratio, and the popover must say so: ${JSON.stringify(settings)}`);
	}
	await closeVideoPanelMenu(page, panel, 'settings');

	const beforeSwap = readVideoNode(VIDEO_NODE);
	await panel.locator('button.bh-video-panel-swap').click();
	await waitUntil(() => canonicalJson(readVideoNode(VIDEO_NODE)) === canonicalJson({ ...beforeSwap, upstream: [VIDEO_END_IMAGE, VIDEO_START_IMAGE] }), 'the swap arrow to exchange the two entries and change nothing else', 10_000);
	await waitForReading(() => readVideoPanel(panel), seen => seen.start?.path === VIDEO_END_IMAGE && seen.start.name === 'Image 1' && seen.end?.path === VIDEO_START_IMAGE, 'the panel to show the swapped frames, named by their new order');
	await waitForReading(() => page.evaluate(() => !!document.activeElement?.closest('.basehalf-canvas-workbench')), inside => inside, 'the keyboard focus to stay on the canvas after the swap');
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
	await waitUntil(() => canonicalJson(readVideoNode(VIDEO_NODE)) === canonicalJson(beforeSwap), 'one undo to put the two frames back', 10_000);
	await waitForReading(() => readVideoPanel(panel), seen => seen.start?.path === VIDEO_START_IMAGE && seen.end?.path === VIDEO_END_IMAGE, 'the panel to show the frames in their first order again');

	await panel.locator('textarea.bh-video-panel-prompt-input').click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
	await page.keyboard.type(' @');
	const mention = await waitForReading(() => readVideoMentionMenu(panel), seen => seen !== null && seen.options.length > 0, 'typing @ to list the inputs that have a name');
	if (JSON.stringify(mention.options.map(option => option.label)) !== JSON.stringify(['Image 1', 'Image 2'])
		|| !mention.options[0].file.startsWith('start') || !mention.options[1].file.startsWith('end')) {
		throw new Error(`@ must list Image 1 (start.png) and Image 2 (end.png): ${JSON.stringify(mention)}`);
	}
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Enter');
	const named = await waitForReading(() => readVideoPanel(panel), seen => seen.prompt === VIDEO_PROMPT_WITH_NAME, 'choosing Image 2 to type its name');
	if (await readVideoMentionMenu(panel) !== null || JSON.stringify(named.names) !== JSON.stringify([{ text: 'Image 2', known: true, underlined: false }])) {
		throw new Error(`The chosen name must be typed and marked as a known input: ${JSON.stringify(named)}`);
	}
	await page.keyboard.type(' Video 1');
	await waitForReading(() => readVideoPanel(panel), seen => JSON.stringify(seen.names) === JSON.stringify([{ text: 'Image 2', known: true, underlined: false }, { text: 'Video 1', known: false, underlined: true }]), 'Video 1, the name of no input, to be underlined');
	for (let index = 0; index < ' Video 1'.length; index++) {
		await page.keyboard.press('Backspace');
	}
	await waitForReading(() => readVideoPanel(panel), seen => seen.prompt === VIDEO_PROMPT_WITH_NAME, 'the prompt to end with the name of Image 2 again');
	await waitUntil(() => readVideoNode(VIDEO_NODE).prompt === VIDEO_PROMPT_WITH_NAME, 'the prompt with the name to be saved', 10_000);
}

// Criterion 10: opening the panel moves the canvas neither way; it sits 10
// px below its card, centered, as wide as the specification says, when there
// is room below; it hides while its card is off the canvas and comes back
// with it; and it goes when the card is deselected.
async function assertVideoPanelPlacement(page) {
	await clickBlankVideoCanvas(page);
	const card = videoCanvasCard(page, VIDEO_NODE);
	const home = await card.boundingBox();
	const canvasBox = await page.locator('.basehalf-canvas-cards').boundingBox();
	const top = { x: canvasBox.x + 100, y: canvasBox.y + 40 };
	await panCanvasCardTo(page, card, top);
	const viewBefore = await readCanvasView(page);
	await clickCanvasCardOnTop(page, VIDEO_NODE);
	await waitForCanvasCardSelection(page, VIDEO_NODE);
	await waitForVideoPanel(page, VIDEO_NODE);
	assertSameCanvasView(viewBefore, await readCanvasView(page), 'Opening the Video panel');
	// The panel emerges from the card's edge in 140 ms; it is measured where it comes to rest.
	const placed = await waitForReading(() => readVideoPanelGeometry(page, VIDEO_NODE), seen => seen !== null && !seen.moving, 'the panel to come to rest');
	const width = Math.min(512, placed.host.width - 24);
	const left = Math.min(Math.max((placed.card.left + placed.card.right - width) / 2, 12), placed.host.width - 12 - width);
	if (placed.card.bottom + 10 + 220 > placed.host.height - 12) {
		throw new Error(`The step must leave room below the card for the tallest panel: ${JSON.stringify(placed)}`);
	}
	if (placed.placement !== 'below' || Math.abs(placed.panel.top - (placed.card.bottom + 10)) > 1.5
		|| Math.abs(placed.panel.width - width) > 1.5 || Math.abs(placed.panel.left - left) > 1.5
		|| placed.panel.height < 132 - 1 || placed.panel.height > 220 + 1) {
		throw new Error(`The panel must be ${width} px wide, centered 10 px below its card: ${JSON.stringify({ placed, width, left })}`);
	}
	await panCanvasCardTo(page, card, { x: canvasBox.x + canvasBox.width + 80, y: top.y });
	await waitForReading(() => readVideoPanelGeometry(page, VIDEO_NODE), seen => seen?.visible === 'false' && seen.visibility === 'hidden', 'the panel to hide while its card is off the canvas');
	await panCanvasCardTo(page, card, top);
	await waitForReading(() => readVideoPanelGeometry(page, VIDEO_NODE), seen => seen?.visible === 'true' && seen.visibility === 'visible' && seen.placement === 'below', 'the panel to show again below its card');
	await clickBlankVideoCanvas(page);
	await waitForReading(() => page.locator('.basehalf-canvas-video-panel-surface').count(), count => count === 0, 'the panel to go when its card is deselected');
	await panCanvasCardTo(page, card, { x: home.x, y: home.y });
}

// Criterion 14 (and 11, the request shows what the panel showed): Generate
// writes the task as `submitting`, then `running` with the provider's task
// id; the card shows the phase; the provider gets one request with both
// frames; the video lands in outputs/<node id>/<task id>.mp4 with a
// `generated` result, and the card plays it.
async function assertVideoGenerateWritesVideo(page) {
	const provider = await videoSmokeProvider();
	const panel = await selectVideoCard(page, VIDEO_NODE);
	const ready = await waitForReading(() => readVideoPanel(panel), seen => seen.generate?.disabled === false && seen.prompt === VIDEO_PROMPT_WITH_NAME, 'Generate to be enabled');
	const node = readVideoNode(VIDEO_NODE);
	const requestsBefore = provider.mock.requests.length;
	const recording = recordVideoNodeStates(videoWorkspaceFile(VIDEO_NODE), document => document.result !== undefined || ['failed', 'stopped'].includes(document.task?.state), VIDEO_GENERATION_TIMEOUT_MS);
	await panel.locator('button.bh-video-panel-generate').click();
	const generating = await waitForReading(() => readVideoCard(page, VIDEO_NODE), seen => seen?.state === 'generating', 'the card to show the generation');
	if (!['Waiting', 'Generating', 'Downloading'].includes(generating.phase) || !/^\d+:\d\d$/.test(generating.elapsed ?? '') || !generating.progress) {
		throw new Error(`A generating card must show its phase, the time since the start, and a progress bar: ${JSON.stringify(generating)}`);
	}
	await waitForReading(() => readVideoPanel(panel), seen => seen.generate?.stop === true && seen.generate.label === 'Stop Generating' && !seen.generate.disabled, 'Generate to become the stop square');
	if (await page.locator('.monaco-dialog-box').count() !== 0) {
		throw new Error('Generate asked a question before it ran');
	}
	const { states, document } = await recording;
	const observed = states.filter(state => state.state !== 'idle');
	const taskId = observed[0]?.taskId;
	const remoteId = observed[1]?.remoteId;
	if (observed.length !== 3 || observed[0].state !== 'submitting' || observed[0].remoteId !== undefined || observed[1].state !== 'running'
		|| observed[1].taskId !== taskId || !remoteId || observed[2].state !== 'result') {
		throw new Error(`The node's file must go submitting, running with the provider's task id, then show the result: ${JSON.stringify(states)}`);
	}
	const requests = provider.requestsSince(requestsBefore);
	if (requests.length !== 1 || requests[0].taskId !== remoteId || requests[0].model !== VIDEO_MODEL || requests[0].prompt !== VIDEO_PROMPT_WITH_NAME
		|| JSON.stringify(requests[0].parts) !== JSON.stringify(['text', 'image_url first_frame data:image/png', 'image_url last_frame data:image/png'])
		|| requests[0].body?.ratio !== 'adaptive' || requests[0].body?.resolution !== '1080p' || requests[0].body?.duration !== 5 || requests[0].body?.generate_audio !== true) {
		throw new Error(`The test provider must get one request with the prompt, the two frames, and the panel's settings: ${JSON.stringify(requests)}`);
	}
	const sent = { provider: 'ark', model: VIDEO_MODEL, prompt: VIDEO_PROMPT_WITH_NAME, inputs: [VIDEO_START_IMAGE, VIDEO_END_IMAGE], mode: 'frames', ratio: 'adaptive', resolution: '1080p', duration: 5, audio: true };
	const result = document.result;
	if (document.task !== undefined || result?.source !== 'generated'
		|| canonicalJson(result.artifact) !== canonicalJson({ kind: 'video', path: `outputs/${node.id}/${taskId}.mp4`, size: provider.video.length })
		|| result.generation?.taskId !== taskId || result.generation.remoteId !== remoteId || canonicalJson(result.generation.request) !== canonicalJson(sent)) {
		throw new Error(`The node must show the generated video with the request the panel showed: ${JSON.stringify(document)}`);
	}
	// What the settings button said is what was sent.
	if (ready.settings !== 'Frames · Adaptive · 1080p · 5s · Sound') {
		throw new Error(`The settings button must sum up what is sent: ${JSON.stringify(ready)}`);
	}
	const video = path.join(workspacePath, 'outputs', node.id, `${taskId}.mp4`);
	if (!fs.readFileSync(video).equals(provider.video)) {
		throw new Error(`${video} must hold the test provider's video`);
	}
	await waitForReading(() => readVideoCard(page, VIDEO_NODE), seen => seen?.state === 'video' && seen.video !== null && seen.video.readyState >= 1, 'the card to show the video');
	const played = await playVideoCard(page, VIDEO_NODE);
	if (played.error || !(played.currentTime >= 0.3) || played.width !== 320 || played.height !== 180 || !(played.duration > 1.5 && played.duration < 2.5) || !played.controls) {
		throw new Error(`The card must play the video, with its controls while selected: ${JSON.stringify(played)}`);
	}
}

// Criterion 20: Capture Frame writes the current, the first, and the last
// frame as PNGs beside the node, named after it, and their cards appear to
// the right of the video card.
async function assertVideoCaptureFrames(page) {
	await selectVideoCard(page, VIDEO_NODE);
	const toolbar = page.locator('.basehalf-video-context-toolbar');
	await toolbar.locator('[data-video-action="captureFrame"]').waitFor({ state: 'visible', timeout: 15_000 });
	const actions = await toolbar.locator('[data-video-action]').evaluateAll(buttons => buttons.map(button => button.getAttribute('data-video-action')));
	if (JSON.stringify(actions) !== JSON.stringify(['captureFrame', 'revealVideo', 'openFullPreview'])) {
		throw new Error(`The toolbar of a card with a video must offer Capture Frame, Reveal, and Open: ${JSON.stringify(actions)}`);
	}
	// The current frame is the one the card's player shows.
	await seekVideoCard(page, VIDEO_NODE, 1);
	const frames = [['current', 'Video frame at 1s.png'], ['first', 'Video first frame.png'], ['last', 'Video last frame.png']];
	for (const [frame, name] of frames) {
		await captureVideoCardFrame(page, frame, `${VIDEO_FOLDER}/${name}`);
	}
	const layout = readVideoCanvasLayout();
	const video = readCanvasCardGeometry(layout, VIDEO_NODE);
	for (const [, name] of frames) {
		const size = pngSize(fs.readFileSync(path.join(workspacePath, VIDEO_FOLDER, name)));
		const row = readCanvasCardGeometry(layout, `${VIDEO_FOLDER}/${name}`);
		if (size?.width !== 320 || size.height !== 180) {
			throw new Error(`${name} must be a 320 by 180 PNG of the video: ${JSON.stringify(size)}`);
		}
		if (!video || !row || row.x < video.x + video.width) {
			throw new Error(`The card of ${name} must appear to the right of the video card: ${JSON.stringify({ video, row })}`);
		}
	}
}

// "The card": the card of a node changes in place when its node changes. A
// video that plays in it goes on playing while the panel saves the prompt,
// with no frame of the loading face, and pauses where it is when the card is
// deselected; selecting the card again keeps the same player.
async function assertVideoCardKeepsItsPlayer(page) {
	const before = readVideoNode(VIDEO_NODE);
	let panel = await selectVideoCard(page, VIDEO_NODE);
	const started = await page.evaluate(async path => {
		const card = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(element => element.getAttribute('data-basehalf-card-path') === path);
		const video = card?.querySelector('.bh-video-card[data-state="video"] video.bh-video-card-video');
		if (!card || !(video instanceof HTMLVideoElement)) {
			return { error: 'The card has no video element' };
		}
		video.dataset.smokePlayer = 'kept';
		video.muted = true;
		video.loop = true;
		const frames = [];
		globalThis.__bhVideoCardFrames = frames;
		globalThis.__bhVideoCardSampling = true;
		const sample = () => {
			const current = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(element => element.getAttribute('data-basehalf-card-path') === path);
			const player = current?.querySelector('video.bh-video-card-video');
			frames.push({
				sameCard: current === card,
				samePlayer: player === video,
				loading: /Checking content/.test(current?.textContent ?? ''),
				paused: video.paused
			});
			if (globalThis.__bhVideoCardSampling && frames.length < 5_000) {
				requestAnimationFrame(sample);
			}
		};
		try {
			await video.play();
		} catch (error) {
			return { error: `The video did not play: ${String(error)}` };
		}
		requestAnimationFrame(sample);
		return { time: video.currentTime };
	}, VIDEO_NODE);
	if (started.error) {
		throw new Error(started.error);
	}
	const edited = `${before.prompt} Slowly.`;
	await replaceVideoPrompt(page, panel, edited);
	await waitUntil(() => readVideoNode(VIDEO_NODE).prompt === edited, 'the panel to save the edited prompt', 10_000);
	// The canvas reads the changed node again and shows it in the same card.
	await page.waitForTimeout(1_500);
	const playing = await page.evaluate(() => {
		globalThis.__bhVideoCardSampling = false;
		const frames = globalThis.__bhVideoCardFrames ?? [];
		return {
			frames: frames.length,
			replaced: frames.filter(frame => !frame.sameCard || !frame.samePlayer).length,
			loading: frames.filter(frame => frame.loading).length,
			paused: frames.filter(frame => frame.paused).length,
			time: document.querySelector('video[data-smoke-player="kept"]')?.currentTime ?? null
		};
	});
	if (playing.frames < 30 || playing.replaced !== 0 || playing.loading !== 0 || playing.paused !== 0 || !(playing.time > started.time)) {
		throw new Error(`A playing video must go on playing in the same card while its node changes: ${JSON.stringify({ started, playing })}`);
	}
	const readPlayer = () => page.evaluate(path => {
		const card = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(element => element.getAttribute('data-basehalf-card-path') === path);
		const video = card?.querySelector('video.bh-video-card-video');
		return video instanceof HTMLVideoElement ? { kept: video.dataset.smokePlayer === 'kept', paused: video.paused, controls: video.controls } : null;
	}, VIDEO_NODE);
	await clickBlankVideoCanvas(page);
	await waitForReading(readPlayer, seen => seen?.kept === true && seen.paused && !seen.controls, 'the deselected card to keep its player, paused and without controls');
	panel = await selectVideoCard(page, VIDEO_NODE);
	await waitForReading(readPlayer, seen => seen?.kept === true && seen.controls, 'the selected card to show the same player with its controls');
	await replaceVideoPrompt(page, panel, before.prompt);
	await waitUntil(() => readVideoNode(VIDEO_NODE).prompt === before.prompt, 'the panel to save the prompt again', 10_000);
}

// Criterion 17: Generate on a node that holds a video makes a node beside it
// with the same prompt, settings, and inputs, to its right, selects it, and
// runs there; the original node does not change.
async function assertVideoGenerateAgainMakesSibling(page) {
	const provider = await videoSmokeProvider();
	const original = fs.readFileSync(videoWorkspaceFile(VIDEO_NODE), 'utf8');
	const originalNode = JSON.parse(original);
	const panel = await selectVideoCard(page, VIDEO_NODE);
	await waitForReading(() => readVideoPanel(panel), seen => seen.generate?.disabled === false && !seen.generate.stop, 'Generate to be enabled on the node that holds a video');
	const requestsBefore = provider.mock.requests.length;
	// Cmd/Ctrl+Enter in the prompt generates.
	await panel.locator('textarea.bh-video-panel-prompt-input').click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
	await waitUntil(() => fs.existsSync(videoWorkspaceFile(VIDEO_SIBLING_NODE)), `Generate to make ${VIDEO_SIBLING_NODE}`, 20_000);
	const recording = recordVideoNodeStates(videoWorkspaceFile(VIDEO_SIBLING_NODE), document => document.result !== undefined || ['failed', 'stopped'].includes(document.task?.state), VIDEO_GENERATION_TIMEOUT_MS);
	await waitForCanvasCardSelection(page, VIDEO_SIBLING_NODE, 20_000);
	await page.locator(`.basehalf-canvas-video-panel-surface[data-basehalf-card-path="${VIDEO_SIBLING_NODE}"]`).waitFor({ state: 'attached', timeout: 15_000 });
	const { states, document } = await recording;
	const observed = states.filter(state => state.state !== 'idle').map(state => state.state);
	if (JSON.stringify(observed) !== JSON.stringify(['submitting', 'running', 'result'])) {
		throw new Error(`The new node must run the generation: ${JSON.stringify(states)}`);
	}
	if (document.title !== 'Video 2' || document.prompt !== originalNode.prompt || canonicalJson(document.generation) !== canonicalJson(originalNode.generation)
		|| JSON.stringify(document.upstream) !== JSON.stringify(originalNode.upstream) || document.result?.source !== 'generated'
		|| !fs.existsSync(path.join(workspacePath, ...document.result.artifact.path.split('/')))) {
		throw new Error(`The new node must have the original's prompt, settings, and inputs, and its own video: ${JSON.stringify(document)}`);
	}
	if (fs.readFileSync(videoWorkspaceFile(VIDEO_NODE), 'utf8') !== original) {
		throw new Error(`Generating again changed ${VIDEO_NODE}`);
	}
	const layout = readVideoCanvasLayout();
	const originalRow = readCanvasCardGeometry(layout, VIDEO_NODE);
	const siblingRow = readCanvasCardGeometry(layout, VIDEO_SIBLING_NODE);
	if (!originalRow || !siblingRow || siblingRow.x < originalRow.x + originalRow.width) {
		throw new Error(`The new node's card must appear to the right of the original: ${JSON.stringify({ originalRow, siblingRow })}`);
	}
	if (provider.requestsSince(requestsBefore).length !== 1) {
		throw new Error(`Generating again must send one request: ${JSON.stringify(provider.requestsSince(requestsBefore))}`);
	}
}

// Criteria 15 and 16: a task the provider fails ends as failed with the
// provider's message on the card; a request whose answer never comes ends
// with the message about the provider's console and is not sent again; the
// stop square ends a running task as stopped and keeps no video. A new node
// starts with the model and settings of the last generation.
async function assertVideoGenerationFailsAndStops(page) {
	const provider = await videoSmokeProvider();
	await clickBlankVideoCanvas(page);
	// At a quarter size the middle of the view has room for another node.
	await setCanvasZoomPercent(page, 25);
	await clickCanvasCreateSubmenuAction(page, 'New Media or Document', 'Video');
	await waitUntil(() => fs.existsSync(videoWorkspaceFile(VIDEO_SECOND_NODE)), `the create menu to make ${VIDEO_SECOND_NODE}`, 20_000);
	const created = readVideoNode(VIDEO_SECOND_NODE);
	const lastUsed = { mode: 'frames', ratio: '16:9', resolution: '1080p', duration: 5, audio: true, channel: videoSmoke.channelId, model: VIDEO_MODEL };
	if (canonicalJson(created.generation) !== canonicalJson(lastUsed)) {
		throw new Error(`A new Video node must start with the model and settings of the last generation: ${JSON.stringify(created)}`);
	}
	await waitForCanvasCardSelection(page, VIDEO_SECOND_NODE, 15_000);
	const panel = await waitForVideoPanel(page, VIDEO_SECOND_NODE);
	await waitForReading(() => readVideoPanel(panel), seen => seen.promptFocused, 'the prompt of the second Video node to have the keyboard focus');

	await page.keyboard.type('[mock:fail] A storm over the pier');
	let ended = await generateVideoUntilEnded(page, panel, VIDEO_SECOND_NODE);
	const failure = 'The provider could not make the video: The video could not be made: the output may contain sensitive content.';
	if (JSON.stringify(ended.states.map(state => state.state)) !== JSON.stringify(['submitting', 'running', 'failed']) || ended.document.task.error !== failure || ended.requests.length !== 1) {
		throw new Error(`A task the provider fails must end as failed with its message: ${JSON.stringify(ended)}`);
	}
	await waitForReading(() => readVideoCard(page, VIDEO_SECOND_NODE), seen => seen?.state === 'failed' && seen.message === failure, 'the card to show the provider\'s message');

	await replaceVideoPrompt(page, panel, '[mock:drop] A storm over the pier');
	ended = await generateVideoUntilEnded(page, panel, VIDEO_SECOND_NODE);
	const unknown = 'The request may have reached the provider, but no answer came back. Check the provider\'s console before generating again: a second request may be charged again.';
	if (JSON.stringify(ended.states.map(state => state.state)) !== JSON.stringify(['submitting', 'failed']) || !ended.document.task.error.startsWith(unknown)
		|| ended.requests.length !== 1 || ended.requests[0].prompt !== '[mock:drop] A storm over the pier') {
		throw new Error(`A request without an answer must end with the message about the provider's console: ${JSON.stringify(ended)}`);
	}
	await waitForReading(() => readVideoCard(page, VIDEO_SECOND_NODE), seen => seen?.state === 'failed' && seen.message === ended.document.task.error, 'the card to show that the outcome is unknown');
	// Nothing sends the request again.
	await page.waitForTimeout(VIDEO_PROVIDER_CREATE_HOLD_MS + 2_000);
	if (provider.requestsSince(ended.requestsBefore).length !== 1) {
		throw new Error(`A request whose outcome is unknown was sent again: ${JSON.stringify(provider.requestsSince(ended.requestsBefore))}`);
	}

	await replaceVideoPrompt(page, panel, '[mock:slow] A storm over the pier');
	const previousTask = readVideoNode(VIDEO_SECOND_NODE).task?.id;
	const recording = recordVideoNodeStates(videoWorkspaceFile(VIDEO_SECOND_NODE), document => document.result !== undefined || (document.task?.id !== previousTask && ['failed', 'stopped'].includes(document.task?.state)), VIDEO_GENERATION_TIMEOUT_MS);
	await panel.locator('button.bh-video-panel-generate').click();
	await waitUntil(() => readVideoNode(VIDEO_SECOND_NODE).task?.state === 'running', 'the slow task to run', 20_000);
	await waitForReading(() => readVideoPanel(panel), seen => seen.generate?.stop === true, 'Generate to become the stop square');
	await panel.locator('button.bh-video-panel-generate').click();
	const stopped = await recording;
	const stoppedPath = stopped.states.filter(state => state.state !== 'idle' && state.taskId !== previousTask).map(state => state.state);
	if (JSON.stringify(stoppedPath) !== JSON.stringify(['submitting', 'running', 'stopped']) || !stopped.document.task.endedAt || stopped.document.result !== undefined) {
		throw new Error(`The stop square must end the task as stopped: ${JSON.stringify(stopped)}`);
	}
	await waitForReading(() => readVideoCard(page, VIDEO_SECOND_NODE), seen => seen?.state === 'stopped' && seen.message === 'Stopped', 'the card to say Stopped');
	await waitForReading(() => readVideoPanel(panel), seen => seen.generate?.stop === false && seen.generate.disabled === false, 'Generate to start a new generation in the same node');
	if (fs.existsSync(path.join(workspacePath, 'outputs', created.id))) {
		throw new Error(`A node whose generations ended without a video has files in outputs/${created.id}`);
	}
}

// Criteria 19 and 2: a Video node an agent wrote with a title, a prompt,
// upstream, and generation shows on the canvas; `basehalf --run-node` in an
// Agent Area terminal starts it without a question and prints its path once
// its task is recorded; the video lands as one Generate makes.
async function assertVideoAgentRunsNode(page) {
	const provider = await videoSmokeProvider();
	const prompt = 'The pier at noon, seen from the water';
	fs.writeFileSync(videoWorkspaceFile(VIDEO_AGENT_NODE), `${JSON.stringify({
		version: 5,
		id: randomUUID(),
		kind: 'video',
		title: 'Agent shot',
		prompt,
		upstream: [VIDEO_START_IMAGE],
		generation: { model: VIDEO_MODEL, mode: 'frames', ratio: '16:9', resolution: '720p', duration: 5, audio: true }
	}, null, '\t')}\n`, 'utf8');
	await videoCanvasCard(page, VIDEO_AGENT_NODE).waitFor({ state: 'attached', timeout: 20_000 });
	await runCommand(page, 'Terminal: Create New Terminal');
	await page.locator('.basehalf-agent-area').waitFor({ state: 'visible', timeout: 20_000 });
	const terminal = page.locator('.basehalf-agent-area-session.active.kind-terminal .xterm').first();
	await terminal.waitFor({ state: 'visible', timeout: 20_000 });
	await terminal.click();
	await waitForAgentAreaTerminalPrompt(page);
	const requestsBefore = provider.mock.requests.length;
	const recording = recordVideoNodeStates(videoWorkspaceFile(VIDEO_AGENT_NODE), document => document.result !== undefined || ['failed', 'stopped'].includes(document.task?.state), VIDEO_GENERATION_TIMEOUT_MS);
	await page.keyboard.insertText(`basehalf --run-node ${VIDEO_AGENT_NODE}`);
	await page.keyboard.press('Enter');
	const answer = await readAgentAreaTerminalJson(page, `"nodePath":${JSON.stringify(VIDEO_AGENT_NODE)}`);
	const recorded = readVideoNode(VIDEO_AGENT_NODE);
	if (answer.ok !== true || answer.outcome !== 'succeeded' || answer.nodePath !== VIDEO_AGENT_NODE || (recorded.task === undefined && recorded.result === undefined)) {
		throw new Error(`basehalf --run-node must print the node's path once its task is recorded: ${JSON.stringify({ answer, recorded })}`);
	}
	if (await page.locator('.monaco-dialog-box').count() !== 0) {
		throw new Error('basehalf --run-node asked a question');
	}
	const { states, document } = await recording;
	const sent = { provider: 'ark', model: VIDEO_MODEL, prompt, inputs: [VIDEO_START_IMAGE], mode: 'frames', ratio: 'adaptive', resolution: '720p', duration: 5, audio: true };
	if (JSON.stringify(states.filter(state => state.state !== 'idle').map(state => state.state)) !== JSON.stringify(['submitting', 'running', 'result'])
		|| document.result?.source !== 'generated' || canonicalJson(document.result.generation.request) !== canonicalJson(sent)) {
		throw new Error(`The node an agent ran must end with a generated video: ${JSON.stringify({ states, document })}`);
	}
	const requests = provider.requestsSince(requestsBefore);
	if (requests.length !== 1 || JSON.stringify(requests[0].parts) !== JSON.stringify(['text', 'image_url first_frame data:image/png'])) {
		throw new Error(`The agent's run must send one request with the prompt and the start frame: ${JSON.stringify(requests)}`);
	}
	await runCommand(page, 'Toggle Agent Area');
	await page.locator('.basehalf-agent-area').waitFor({ state: 'hidden', timeout: 15_000 });
	// After all these generations, no workspace file holds the key.
	const files = filesContaining(workspacePath, provider.key);
	if (files.length) {
		throw new Error(`The provider key is in workspace files: ${files.join(', ')}`);
	}
}

// --- Video node helpers ---

function createVideoSmokeFolder() {
	const folder = path.join(workspacePath, VIDEO_FOLDER);
	fs.mkdirSync(folder, { recursive: true });
	fs.writeFileSync(path.join(folder, 'start.png'), solidPng(160, 90, [37, 99, 235]));
	fs.writeFileSync(path.join(folder, 'end.png'), solidPng(160, 90, [245, 158, 11]));
	// The images lie at the left, one above the other.
	const mirror = path.join(workspacePath, '.bh', 'mirror', VIDEO_FOLDER);
	fs.mkdirSync(mirror, { recursive: true });
	fs.writeFileSync(path.join(mirror, 'canvas.yaml'), [
		`path: "${VIDEO_FOLDER}"`,
		'size:',
		'  width: 2400',
		'  height: 1600',
		'cards:',
		`  - path: "${VIDEO_START_IMAGE}"`,
		'    kind: file',
		'    x: 0',
		'    y: 0',
		'    width: 300',
		'    height: 220',
		`  - path: "${VIDEO_END_IMAGE}"`,
		'    kind: file',
		'    x: 0',
		'    y: 300',
		'    width: 300',
		'    height: 220',
		'edges: []',
		''
	].join('\n'), 'utf8');
}

function videoWorkspaceFile(relativePath) {
	return path.join(workspacePath, ...relativePath.split('/'));
}

function readVideoNode(relativePath) {
	return JSON.parse(fs.readFileSync(videoWorkspaceFile(relativePath), 'utf8'));
}

function readVideoCanvasLayout() {
	return fs.readFileSync(path.join(workspacePath, '.bh', 'mirror', VIDEO_FOLDER, 'canvas.yaml'), 'utf8');
}

// JSON with its keys sorted, to compare documents whatever order they were written in.
function canonicalJson(value) {
	return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
		? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]))
		: item);
}

// Reads with `read` until `accept` takes what it read; fails with the last reading.
async function waitForReading(read, accept, description, timeoutMs = 15_000) {
	const deadline = Date.now() + timeoutMs;
	let value;
	let failure;
	for (; ;) {
		try {
			value = await read();
			failure = undefined;
			if (accept(value)) {
				return value;
			}
		} catch (error) {
			failure = error;
		}
		if (Date.now() > deadline) {
			throw new Error(`Timed out waiting for ${description}; last read: ${failure ? `failed with ${failure instanceof Error ? failure.message : String(failure)}` : JSON.stringify(value)}`);
		}
		await new Promise(resolve => setTimeout(resolve, 50));
	}
}

function assertSameCanvasView(before, after, what) {
	if (Math.abs(before.x - after.x) > 0.5 || Math.abs(before.y - after.y) > 0.5 || Math.abs(before.zoom - after.zoom) > 0.001) {
		throw new Error(`${what} must not pan or zoom the canvas: ${JSON.stringify({ before, after })}`);
	}
}

async function setCanvasZoomPercent(page, percent) {
	const controller = await openCanvasZoomMenu(page);
	await controller.input.fill(`${percent}%`);
	await controller.input.press('Enter');
	await controller.menu.waitFor({ state: 'hidden', timeout: 10_000 });
	await page.waitForFunction(expected => Number(document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom')) === expected, percent / 100, { timeout: 10_000 });
}

function videoCanvasCard(page, cardPath) {
	return page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${cardPath}"]`);
}

function videoPanel(page, cardPath) {
	return page.locator(`.basehalf-canvas-video-panel-surface[data-basehalf-card-path="${cardPath}"] .bh-video-panel`);
}

// Clicks a point of the card that is on top: a panel, a toolbar, or another
// card can lie over part of it.
async function clickCanvasCardOnTop(page, cardPath) {
	const point = await page.evaluate(path => {
		const card = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(element => element.getAttribute('data-basehalf-card-path') === path);
		const rect = card?.getBoundingClientRect();
		if (!card || !rect) {
			return undefined;
		}
		for (const [x, y] of [[0.5, 0.5], [0.3, 0.5], [0.7, 0.5], [0.5, 0.3], [0.5, 0.7], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) {
			const point = { x: rect.left + rect.width * x, y: rect.top + rect.height * y };
			if (card.contains(document.elementFromPoint(point.x, point.y))) {
				return point;
			}
		}
		return undefined;
	}, cardPath);
	if (!point) {
		throw new Error(`No part of the card ${cardPath} is on top to click`);
	}
	await page.mouse.click(point.x, point.y);
}

async function clickBlankVideoCanvas(page) {
	const point = await emptyCanvasPoint(page);
	await page.mouse.click(point.x, point.y);
	await waitForReading(() => page.locator('.react-flow__node.selected').count(), count => count === 0, 'a click on the blank canvas to end the selection');
}

async function selectVideoCard(page, cardPath) {
	const selected = await page.evaluate(path => Array.from(document.querySelectorAll('.basehalf-canvas-card'))
		.find(card => card.getAttribute('data-basehalf-card-path') === path)?.closest('.react-flow__node')?.classList.contains('selected') === true, cardPath);
	if (!selected) {
		await clickCanvasCardOnTop(page, cardPath);
	}
	await waitForCanvasCardSelection(page, cardPath, 15_000);
	return waitForVideoPanel(page, cardPath);
}

// The panel of the selected Video card, once the scene shows it and it has read its node.
async function waitForVideoPanel(page, cardPath, timeoutMs = 15_000) {
	await waitForReading(() => page.evaluate(path => {
		const surfaces = Array.from(document.querySelectorAll('.basehalf-canvas-video-panel-surface'));
		const surface = surfaces.find(element => element.getAttribute('data-basehalf-card-path') === path);
		return {
			surfaces: surfaces.map(element => element.getAttribute('data-basehalf-card-path')),
			visible: surface?.getAttribute('data-visible') ?? null,
			state: surface?.querySelector('.bh-video-panel')?.getAttribute('data-state') ?? null
		};
	}, cardPath), seen => seen.visible === 'true' && seen.state === 'ready', `the Video panel of ${cardPath} to show`, timeoutMs);
	return videoPanel(page, cardPath);
}

function readVideoPanel(panel) {
	return panel.evaluate(element => {
		const text = selector => element.querySelector(selector)?.textContent?.trim() ?? null;
		const prompt = element.querySelector('textarea.bh-video-panel-prompt-input');
		const generate = element.querySelector('button.bh-video-panel-generate');
		const frame = use => {
			const slot = element.querySelector(`.bh-video-panel-slot[data-use="${use}"]`);
			return slot ? {
				name: slot.querySelector('.bh-video-panel-input-name')?.textContent ?? null,
				path: slot.querySelector('.bh-video-panel-remove')?.getAttribute('data-key')?.replace(/^remove:/, '') ?? null
			} : null;
		};
		return {
			prompt: prompt?.value ?? null,
			promptFocused: !!prompt && element.ownerDocument.activeElement === prompt,
			model: text('.bh-video-panel-model-label'),
			modelOutlined: element.querySelector('.bh-video-panel-model')?.classList.contains('outlined') ?? false,
			settings: text('.bh-video-panel-settings-label'),
			generate: generate ? {
				disabled: generate.getAttribute('aria-disabled') === 'true',
				label: generate.getAttribute('aria-label'),
				stop: generate.classList.contains('stop')
			} : null,
			emptySlots: Array.from(element.querySelectorAll('.bh-video-panel-slot.empty')).map(slot => slot.getAttribute('data-role')),
			start: frame('start-frame'),
			end: frame('end-frame'),
			names: Array.from(element.querySelectorAll('.bh-video-panel-prompt-overlay .bh-video-panel-name')).map(name => ({
				text: name.textContent,
				known: !name.classList.contains('unknown'),
				underlined: getComputedStyle(name).textDecorationLine.includes('underline')
			}))
		};
	}, undefined, { timeout: 2_000 });
}

function readVideoModelMenu(panel) {
	return panel.evaluate(element => {
		const menu = element.querySelector('.bh-video-panel-menu.model');
		const label = item => item.querySelector('.bh-video-panel-menu-label')?.textContent ?? null;
		return menu ? {
			groups: Array.from(menu.querySelectorAll('.bh-video-panel-menu-group')).map(group => ({
				label: group.querySelector('.bh-video-panel-menu-heading-label')?.textContent ?? null,
				detail: group.querySelector('.bh-video-panel-menu-heading-detail')?.textContent ?? null,
				items: Array.from(group.querySelectorAll('.bh-video-panel-menu-item')).map(label)
			})),
			end: Array.from(menu.querySelectorAll(':scope > .bh-video-panel-menu-item')).map(label)
		} : null;
	}, undefined, { timeout: 2_000 });
}

async function clickVideoModel(page, panel, model) {
	await panel.locator(`.bh-video-panel-menu.model .bh-video-panel-menu-item[data-key="model:${videoSmoke.channelId}:${model}"]`).click();
	await waitForReading(() => panel.locator('.bh-video-panel-menu.model').count(), count => count === 0, 'the model menu to close after a choice');
}

function readVideoSettingsPopover(panel) {
	return panel.evaluate(element => {
		const popover = element.querySelector('.bh-video-panel-menu.settings');
		if (!popover) {
			return null;
		}
		const keys = selector => Array.from(popover.querySelectorAll(selector)).map(control => control.getAttribute('data-key'));
		const slider = popover.querySelector('input.bh-video-panel-slider');
		return {
			width: Math.round(popover.getBoundingClientRect().width),
			focusInside: popover.contains(element.ownerDocument.activeElement),
			keys: keys('[data-key]'),
			checked: keys('[data-key][aria-checked="true"]'),
			disabled: keys('[data-key][aria-disabled="true"]'),
			slider: slider ? { min: Number(slider.min), max: Number(slider.max), value: Number(slider.value), disabled: slider.disabled } : null,
			note: popover.querySelector('.bh-video-panel-setting-note')?.textContent ?? null
		};
	}, undefined, { timeout: 2_000 });
}

// Opens the settings popover and waits for the keyboard focus to be inside it,
// so that a later Escape reaches it.
async function openVideoSettings(panel) {
	await panel.locator('button.bh-video-panel-settings').click();
	return waitForReading(() => readVideoSettingsPopover(panel), seen => seen !== null && seen.focusInside, 'the settings popover to open with the focus inside');
}

async function closeVideoPanelMenu(page, panel, kind) {
	// An Escape that arrives before the focus does reaches nobody.
	await waitForReading(() => panel.evaluate((element, menuKind) => element.querySelector(`.bh-video-panel-menu.${menuKind}`)?.contains(element.ownerDocument.activeElement) === true, kind, { timeout: 2_000 }), inside => inside, `the keyboard focus to be in the ${kind} menu`);
	await page.keyboard.press('Escape');
	await waitForReading(() => panel.locator(`.bh-video-panel-menu.${kind}`).count(), count => count === 0, `Escape to close the ${kind} menu`);
}

// The settings button says `summary`, and the node's file stores `generation`.
async function assertVideoSettingsSummary(panel, summary, generation) {
	await waitForReading(() => readVideoPanel(panel), seen => seen.settings === summary, `the settings button to read ${summary}`);
	await waitUntil(() => canonicalJson(readVideoNode(VIDEO_NODE).generation) === canonicalJson(generation), `${VIDEO_NODE} to store ${JSON.stringify(generation)}`, 10_000);
}

function readVideoMentionMenu(panel) {
	return panel.evaluate(element => {
		const menu = element.querySelector('.bh-video-panel-menu.mention');
		return menu ? {
			options: Array.from(menu.querySelectorAll('.bh-video-panel-mention')).map(option => ({
				label: option.querySelector('.bh-video-panel-mention-label')?.textContent ?? null,
				file: option.querySelector('.bh-video-panel-mention-file')?.textContent ?? '',
				active: option.getAttribute('aria-selected') === 'true'
			}))
		} : null;
	}, undefined, { timeout: 2_000 });
}

function readVideoProviderEditor(providers) {
	return providers.evaluate(root => ({
		name: root.querySelector('.basehalf-video-provider-row[aria-current="page"] .basehalf-video-provider-row-name')?.textContent ?? null,
		rowKey: root.querySelector('.basehalf-video-provider-row[aria-current="page"] .basehalf-video-provider-row-key')?.getAttribute('aria-label') ?? null,
		endpoint: root.querySelector('#basehalf-video-provider-endpoint')?.value ?? null,
		models: Array.from(root.querySelectorAll('li.basehalf-video-provider-model')).map(chip => ({
			id: chip.getAttribute('data-model'),
			label: chip.querySelector('.basehalf-video-provider-model-name')?.textContent ?? null
		})),
		keySet: root.querySelector('.basehalf-video-provider-key-state')?.classList.contains('set') ?? false,
		keyState: root.querySelector('.basehalf-video-provider-key-state')?.textContent?.trim() ?? null,
		status: root.querySelector('.basehalf-video-providers-status')?.textContent ?? null
	}), undefined, { timeout: 2_000 });
}

function readVideoCard(page, cardPath) {
	return page.evaluate(path => {
		const card = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(element => element.getAttribute('data-basehalf-card-path') === path);
		const face = card?.querySelector('.bh-video-card');
		if (!face) {
			return null;
		}
		const video = face.querySelector('video.bh-video-card-video');
		return {
			state: face.getAttribute('data-state'),
			phase: face.querySelector('.bh-video-card-phase')?.textContent ?? null,
			elapsed: face.querySelector('.bh-video-card-elapsed')?.textContent ?? null,
			progress: !!face.querySelector('.bh-video-card-progress[role="progressbar"]'),
			message: face.querySelector('.bh-video-card-message')?.textContent ?? null,
			video: video ? { readyState: video.readyState, width: video.videoWidth, height: video.videoHeight, error: video.error?.message ?? null } : null
		};
	}, cardPath);
}

// Plays the card's video for a moment, muted, and reports what it played.
function playVideoCard(page, cardPath) {
	return page.evaluate(async path => {
		const card = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(element => element.getAttribute('data-basehalf-card-path') === path);
		const video = card?.querySelector('.bh-video-card[data-state="video"] video.bh-video-card-video');
		if (!(video instanceof HTMLVideoElement)) {
			return { error: 'The card has no video element' };
		}
		video.muted = true;
		try {
			await video.play();
		} catch (error) {
			return { error: `play() failed: ${error}` };
		}
		const started = performance.now();
		while (video.currentTime < 0.3 && !video.error && performance.now() - started < 5_000) {
			await new Promise(resolve => setTimeout(resolve, 50));
		}
		const played = { currentTime: video.currentTime, duration: video.duration, width: video.videoWidth, height: video.videoHeight, controls: video.controls, error: video.error?.message ?? null };
		video.pause();
		return played;
	}, cardPath);
}

// Moves the card's player to `seconds`, as the user does with its controls.
async function seekVideoCard(page, cardPath, seconds) {
	const seeked = await page.evaluate(async ({ path, seconds }) => {
		const card = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(element => element.getAttribute('data-basehalf-card-path') === path);
		const video = card?.querySelector('.bh-video-card[data-state="video"] video.bh-video-card-video');
		if (!(video instanceof HTMLVideoElement)) {
			return { error: 'The card has no video element' };
		}
		const event = name => new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(`no ${name} event within 10 s`)), 10_000);
			video.addEventListener(name, () => {
				clearTimeout(timer);
				resolve(undefined);
			}, { once: true });
		});
		try {
			if (video.readyState < 1) {
				await event('loadedmetadata');
			}
			const done = event('seeked');
			video.currentTime = seconds;
			await done;
		} catch (error) {
			return { error: String(error) };
		}
		return { currentTime: video.currentTime };
	}, { path: cardPath, seconds });
	if (seeked.error || Math.abs(seeked.currentTime - seconds) > 0.05) {
		throw new Error(`The card's player did not move to ${seconds} s: ${JSON.stringify(seeked)}`);
	}
}

async function captureVideoCardFrame(page, frame, relativePath) {
	await page.locator('.basehalf-video-context-toolbar [data-video-action="captureFrame"]').click();
	const item = page.locator(`.basehalf-video-capture-menu [data-video-frame="${frame}"]`);
	await item.waitFor({ state: 'visible', timeout: 10_000 });
	await item.click();
	await waitUntil(() => fs.existsSync(videoWorkspaceFile(relativePath)), `Capture Frame to write ${relativePath}`, 20_000);
	await waitUntil(() => readCanvasCardGeometry(readVideoCanvasLayout(), relativePath) !== undefined, `the card of ${relativePath} to get a place`, 10_000);
	await videoCanvasCard(page, relativePath).waitFor({ state: 'attached', timeout: 15_000 });
}

// The card and its panel relative to the canvas, which the scene places the panel in.
function readVideoPanelGeometry(page, cardPath) {
	return page.evaluate(path => {
		const flow = document.querySelector('.basehalf-canvas-cards .react-flow');
		const node = Array.from(document.querySelectorAll('.react-flow__node')).find(element => element.getAttribute('data-id') === path);
		const surface = Array.from(document.querySelectorAll('.basehalf-canvas-video-panel-surface')).find(element => element.getAttribute('data-basehalf-card-path') === path);
		if (!flow || !node || !surface) {
			return null;
		}
		const origin = flow.getBoundingClientRect();
		const relative = rect => ({ left: rect.left - origin.left, top: rect.top - origin.top, right: rect.right - origin.left, bottom: rect.bottom - origin.top, width: rect.width, height: rect.height });
		return {
			host: { width: flow.clientWidth, height: flow.clientHeight },
			card: relative(node.getBoundingClientRect()),
			panel: relative(surface.getBoundingClientRect()),
			placement: surface.getAttribute('data-panel-placement'),
			visible: surface.getAttribute('data-visible'),
			visibility: getComputedStyle(surface).visibility,
			moving: surface.getAnimations().some(animation => animation.playState !== 'finished') || !['none', '0px', '0px 0px'].includes(getComputedStyle(surface).translate)
		};
	}, cardPath);
}

// Draws a connection from the east handle of `sourcePath` to the west handle
// of `targetPath`; the target stores it in its upstream list.
async function drawCanvasConnectionInto(page, sourcePath, targetPath) {
	await startCanvasConnectionDrag(page, sourcePath);
	const target = await page.locator(`.react-flow__node[data-id="${targetPath}"] > .basehalf-canvas-card-connect-handle.west`).boundingBox();
	if (!target) {
		await page.mouse.up();
		throw new Error(`The card ${targetPath} has no west connection handle`);
	}
	await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
	await page.waitForFunction(() => document.querySelector('.react-flow__connection-path') !== null, null, { timeout: 10_000 });
	await page.mouse.up();
}

async function replaceVideoPrompt(page, panel, text) {
	await panel.locator('textarea.bh-video-panel-prompt-input').click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
	await page.keyboard.type(text);
	await waitForReading(() => readVideoPanel(panel), seen => seen.prompt === text, `the prompt to read ${text}`);
}

// Clicks Generate and waits until the node's new task ends or its video arrives.
async function generateVideoUntilEnded(page, panel, cardPath) {
	const provider = await videoSmokeProvider();
	await waitForReading(() => readVideoPanel(panel), seen => seen.generate?.disabled === false && !seen.generate.stop, 'Generate to be enabled');
	const previousTask = readVideoNode(cardPath).task?.id;
	const requestsBefore = provider.mock.requests.length;
	const recording = recordVideoNodeStates(videoWorkspaceFile(cardPath), document => document.result !== undefined
		|| (document.task?.id !== previousTask && ['failed', 'stopped'].includes(document.task?.state)), VIDEO_GENERATION_TIMEOUT_MS);
	await panel.locator('button.bh-video-panel-generate').click();
	const { states, document } = await recording;
	return {
		states: states.filter(state => state.state !== 'idle' && (previousTask === undefined || state.taskId !== previousTask)),
		document,
		requestsBefore,
		requests: provider.requestsSince(requestsBefore)
	};
}

// The JSON line a command printed in the active Agent Area terminal, with
// the rows a long line wraps onto joined.
async function readAgentAreaTerminalJson(page, marker) {
	const line = await waitForReading(() => page.evaluate(expected => {
		const wrapper = document.querySelector('.basehalf-agent-area-session.active.kind-terminal .terminal-wrapper');
		const buffer = wrapper?.xterm?.buffer?.active;
		if (!buffer) {
			return null;
		}
		const lines = [];
		for (let index = 0; index < buffer.length; index++) {
			const row = buffer.getLine(index);
			const text = row?.translateToString(true) ?? '';
			if (row?.isWrapped && lines.length) {
				lines[lines.length - 1] += text;
			} else {
				lines.push(text);
			}
		}
		return lines.reverse().find(text => text.trimStart().startsWith('{') && text.includes(expected)) ?? null;
	}, marker), found => typeof found === 'string', 'the Agent Area terminal to print the answer of basehalf --run-node', 30_000);
	return JSON.parse(line.trim());
}

// Lets the window draw `count` frames; the adjacent chrome checks below sample after it.
async function waitForVideoChromeFrames(page, count = 2) {
	await page.evaluate(frames => new Promise<void>(resolve => {
		let remaining = frames;
		const next = () => {
			remaining--;
			if (remaining <= 0) {
				resolve();
				return;
			}
			requestAnimationFrame(next);
		};
		requestAnimationFrame(next);
	}), count);
}

async function waitForAdjacentChromeAnimations(page, minimumSurfaceCount = 1) {
	await page.waitForFunction(minimumCount => {
		const surfaces = Array.from(document.querySelectorAll('.basehalf-canvas-adjacent-chrome'))
			.filter(surface => surface instanceof HTMLElement);
		return surfaces.length >= minimumCount
			&& surfaces.every(surface => surface.getAnimations().every(animation => animation.playState === 'finished'));
	}, minimumSurfaceCount, { timeout: 3_000 });
}

function assertAdjacentChromeSurfaceState(surface, expectedState, context) {
	if (!surface) {
		throw new Error(`Adjacent chrome surface disappeared ${context}`);
	}
	const suppressed = expectedState === 'suppressed';
	const screenTranslateY = surface.translateY * surface.zoom;
	const directionalTravelIsWrong = suppressed && (
		(surface.placement === 'above' && screenTranslateY <= 0)
		|| (surface.placement === 'below' && screenTranslateY >= 0)
		|| Math.abs(Math.abs(screenTranslateY) - 6) > 0.75
	);
	if (surface.state !== expectedState
		|| surface.visible === suppressed
		|| Math.abs(surface.opacity - 1) > 0.001
		|| surface.visibility !== (suppressed ? 'hidden' : 'visible')
		|| surface.scale !== 'none'
		|| (surface.placement !== 'above' && surface.placement !== 'below')
		|| directionalTravelIsWrong
		|| (!suppressed && Math.abs(screenTranslateY) > 0.25)
		|| (suppressed ? surface.pointerEvents !== 'none' : surface.pointerEvents === 'none')
		|| (suppressed ? surface.ariaHidden !== 'true' : surface.ariaHidden === 'true')
		|| surface.inert !== suppressed
		|| Math.abs(surface.translateTransitionMs - 88) > 1
		|| surface.visibilityTransitionMs !== 0
		|| Math.abs(surface.visibilityTransitionDelayMs - (suppressed ? 88 : 0)) > 1
		|| surface.opacityTransitionMs !== 0) {
		throw new Error(`Adjacent chrome did not become ${expectedState} ${context}: ${JSON.stringify(surface)}`);
	}
}

async function captureAdjacentChromeSurface(locator) {
	return locator.evaluate(element => {
		if (!(element instanceof HTMLElement)) {
			throw new Error('Adjacent chrome is not an HTMLElement');
		}
		const style = getComputedStyle(element);
		const parseTimes = value => value.split(',').map(part => {
			const token = part.trim();
			return token.endsWith('ms')
				? Number.parseFloat(token)
				: token.endsWith('s') ? Number.parseFloat(token) * 1_000 : 0;
		});
		const properties = style.transitionProperty.split(',').map(property => property.trim());
		const durations = parseTimes(style.transitionDuration);
		const delays = parseTimes(style.transitionDelay);
		const timingFor = property => {
			const index = properties.findIndex(candidate => candidate === property || candidate === 'all');
			return index < 0 ? { duration: 0, delay: 0 } : {
				duration: durations[index % durations.length] ?? 0,
				delay: delays[index % delays.length] ?? 0
			};
		};
		const translateNumbers = style.translate === 'none'
			? []
			: style.translate.match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
		const translateTiming = timingFor('translate');
		const visibilityTiming = timingFor('visibility');
		const opacityTiming = timingFor('opacity');
		return {
			state: element.dataset.chromeState,
			placement: element.dataset.placement,
			ariaHidden: element.getAttribute('aria-hidden'),
			inert: element.inert,
			opacity: Number.parseFloat(style.opacity || '1'),
			visibility: style.visibility,
			pointerEvents: style.pointerEvents,
			translate: style.translate,
			translateY: translateNumbers.length >= 2 ? translateNumbers[1] : 0,
			scale: style.scale,
			zoom: Number.parseFloat(style.getPropertyValue('--basehalf-canvas-zoom')) || 1,
			travel: Number.parseFloat(style.getPropertyValue('--basehalf-adjacent-chrome-travel')) || 0,
			transitionProperty: style.transitionProperty,
			transitionDelay: style.transitionDelay,
			maxTransitionMs: Math.max(0, ...parseTimes(style.transitionDuration)),
			maxAnimationMs: Math.max(0, ...parseTimes(style.animationDuration)),
			translateTransitionMs: translateTiming.duration,
			visibilityTransitionMs: visibilityTiming.duration,
			visibilityTransitionDelayMs: visibilityTiming.delay,
			opacityTransitionMs: opacityTiming.duration,
			animationName: style.animationName,
			visible: style.display !== 'none'
				&& style.visibility !== 'hidden'
				&& element.getClientRects().length > 0,
			identity: element.dataset.smokeAdjacentChromeIdentity,
			reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
			animationCount: element.getAnimations().length
		};
	});
}

async function assertAdjacentChromeMotionContract(page, locator, context) {
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await waitForVideoChromeFrames(page);
	const regular = await captureAdjacentChromeSurface(locator);
	if (regular.reducedMotion
		|| regular.animationName !== 'basehalf-canvas-adjacent-chrome-emerge'
		|| Math.abs(regular.maxAnimationMs - 140) > 1
		|| Math.abs(regular.translateTransitionMs - 88) > 1
		|| regular.visibilityTransitionMs !== 0
		|| regular.visibilityTransitionDelayMs !== 0
		|| regular.opacityTransitionMs !== 0
		|| Math.abs(regular.opacity - 1) > 0.001
		|| regular.visibility !== 'visible'
		|| regular.scale !== 'none'
		|| Math.abs(regular.translateY * regular.zoom) > 0.25) {
		throw new Error(`Adjacent chrome has no restrained enter/exit motion ${context}: ${JSON.stringify(regular)}`);
	}
	try {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await waitForVideoChromeFrames(page);
		const reduced = await captureAdjacentChromeSurface(locator);
		if (!reduced.reducedMotion
			|| reduced.maxTransitionMs !== 0
			|| reduced.maxAnimationMs !== 0
			|| reduced.animationCount !== 0
			|| reduced.opacityTransitionMs !== 0
			|| Math.abs(reduced.opacity - 1) > 0.001
			|| reduced.visibility !== 'visible'
			|| reduced.scale !== 'none'
			|| Math.abs(reduced.translateY * reduced.zoom) > 0.25) {
			throw new Error(`Adjacent chrome ignored reduced motion ${context}: ${JSON.stringify(reduced)}`);
		}

		const originalState = await locator.evaluate(element => {
			if (!(element instanceof HTMLElement)) {
				throw new Error('Adjacent chrome is not an HTMLElement');
			}
			const state = {
				chromeState: element.dataset.chromeState,
				ariaHidden: element.getAttribute('aria-hidden'),
				inert: element.inert
			};
			element.dataset.chromeState = 'suppressed';
			element.setAttribute('aria-hidden', 'true');
			element.inert = true;
			return state;
		});
		try {
			await waitForVideoChromeFrames(page);
			const reducedSuppressed = await captureAdjacentChromeSurface(locator);
			if (!reducedSuppressed.reducedMotion
				|| reducedSuppressed.maxTransitionMs !== 0
				|| reducedSuppressed.maxAnimationMs !== 0
				|| reducedSuppressed.animationCount !== 0
				|| reducedSuppressed.opacityTransitionMs !== 0
				|| Math.abs(reducedSuppressed.opacity - 1) > 0.001
				|| reducedSuppressed.visibility !== 'hidden'
				|| reducedSuppressed.pointerEvents !== 'none'
				|| reducedSuppressed.ariaHidden !== 'true'
				|| !reducedSuppressed.inert
				|| reducedSuppressed.scale !== 'none'
				|| Math.abs(reducedSuppressed.translateY * reducedSuppressed.zoom) > 0.25) {
				throw new Error(`Suppressed adjacent chrome ignored reduced motion ${context}: ${JSON.stringify(reducedSuppressed)}`);
			}
		} finally {
			await locator.evaluate((element, state) => {
				if (!(element instanceof HTMLElement)) {
					return;
				}
				if (state.chromeState === undefined) {
					delete element.dataset.chromeState;
				} else {
					element.dataset.chromeState = state.chromeState;
				}
				if (state.ariaHidden === null) {
					element.removeAttribute('aria-hidden');
				} else {
					element.setAttribute('aria-hidden', state.ariaHidden);
				}
				element.inert = state.inert;
			}, originalState);
			await waitForVideoChromeFrames(page);
		}
	} finally {
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await waitForVideoChromeFrames(page);
	}
}

function readCanvasCardGeometry(raw, cardPath) {
	const lines = raw.split(/\r?\n/);
	const marker = `- path: ${JSON.stringify(cardPath)}`;
	const start = lines.findIndex(line => line.trim() === marker);
	if (start < 0) {
		return undefined;
	}
	const geometry = {};
	for (let index = start + 1; index < lines.length; index++) {
		const trimmed = lines[index].trim();
		if (trimmed.startsWith('- path:') || trimmed === 'edges:') {
			break;
		}
		const match = /^(x|y|width|height):\s*(-?\d+(?:\.\d+)?)$/.exec(trimmed);
		if (match) {
			geometry[match[1]] = Number(match[2]);
		}
	}
	return Number.isFinite(geometry.x) && Number.isFinite(geometry.y)
		? geometry
		: undefined;
}

async function openRootCanvas(page) {
	if (await page.locator('.basehalf-command-center-breadcrumb-segment.current.root').isVisible().catch(() => false)) {
		return;
	}
	const root = page.locator('button.basehalf-command-center-breadcrumb-segment.root').first();
	await root.waitFor({ state: 'visible', timeout: 15_000 });
	await root.click();
	await assertCanvasFolder(page, '');
}

async function assertBaseHalfRootTitlebarBreadcrumb(page) {
	const breadcrumbs = page.locator('.basehalf-command-center-breadcrumbs');
	await breadcrumbs.waitFor({ state: 'visible', timeout: 15_000 });
	const labels = (await breadcrumbs.locator('.basehalf-command-center-breadcrumb-segment').allTextContents()).map(label => label.trim());
	const workspaceName = path.basename(workspacePath);
	if (labels.length !== 1 || labels[0] !== workspaceName) {
		throw new Error(`Unexpected root canvas breadcrumb path: ${JSON.stringify(labels)}`);
	}
	const current = breadcrumbs.locator('[aria-current="page"]');
	if (await current.textContent() !== workspaceName) {
		throw new Error('The workspace root is not the current breadcrumb segment');
	}
	await page.locator('.basehalf-command-center-search[aria-label]').waitFor({ state: 'visible', timeout: 10_000 });
}

async function assertBaseHalfTitlebarBreadcrumbs(page) {
	const breadcrumbs = page.locator('.basehalf-command-center-breadcrumbs');
	await breadcrumbs.waitFor({ state: 'visible', timeout: 15_000 });
	const labels = (await breadcrumbs.locator('.basehalf-command-center-breadcrumb-segment').allTextContents()).map(label => label.trim());
	if (labels.length !== 2 || labels[0] !== path.basename(workspacePath) || labels[1] !== 'README') {
		throw new Error(`Unexpected README breadcrumb path: ${JSON.stringify(labels)}`);
	}
	const current = breadcrumbs.locator('[aria-current="page"]');
	if (await current.textContent() !== 'README') {
		throw new Error('The current breadcrumb segment is not the name of README.md');
	}
	// The name of the open note has no extension in the title either.
	const detailTitle = (await page.locator('.basehalf-card-detail-title').first().textContent())?.trim();
	if (detailTitle !== 'README') {
		throw new Error(`Card Detail names the open note ${JSON.stringify(detailTitle)}`);
	}
	const search = page.locator('.basehalf-command-center-search[aria-label]');
	await search.waitFor({ state: 'visible', timeout: 10_000 });

	// Passive breadcrumb chrome must never bubble into the parent Quick Open
	// action, whether activated by pointer or by the ActionBar keyboard path.
	const quickInput = visibleQuickInput(page);
	await current.click();
	await quickInput.waitFor({ state: 'hidden', timeout: 1_000 });
	await breadcrumbs.locator('.basehalf-command-center-breadcrumb-separator').first().click();
	await quickInput.waitFor({ state: 'hidden', timeout: 1_000 });
	const locationGroup = page.locator('.command-center-quick-pick.basehalf-location-mode');
	await locationGroup.focus();
	await page.keyboard.press('Enter');
	await quickInput.waitFor({ state: 'hidden', timeout: 1_000 });
	await assertCardDetail(page, 'README.md');

	// Search remains an explicit action inside the otherwise passive group.
	await search.click();
	await quickInput.waitFor({ state: 'visible', timeout: 10_000 });
	await page.keyboard.press('Escape');
	await quickInput.waitFor({ state: 'hidden', timeout: 10_000 });

	await breadcrumbs.locator('button.basehalf-command-center-breadcrumb-segment').first().click();
	await page.locator('.basehalf-card-detail.visible').waitFor({ state: 'hidden', timeout: 20_000 });
	await page.locator('.basehalf-canvas-cards').waitFor({ state: 'visible', timeout: 15_000 });

	await clickCommandCenterNavigationButton(page, 'arrow-left', 'Go Back');
	await assertCardDetail(page, 'README.md');
}

async function assertCardDetailCompactHeader(page) {
	const chrome = await page.evaluate(() => {
		const header = document.querySelector('.basehalf-card-detail-header');
		const projections = document.querySelector('.basehalf-card-detail-projections.visible');
		const buttons = Array.from(document.querySelectorAll('.basehalf-card-detail-projection'));
		const activeButton = document.querySelector('.basehalf-card-detail-projection.checked');
		const close = document.querySelector('.basehalf-card-detail-close');
		if (!(header instanceof HTMLElement) || !(projections instanceof HTMLElement) || !(activeButton instanceof HTMLElement) || !(close instanceof HTMLElement) || buttons.length !== 3) {
			throw new Error('Missing Markdown card detail header projection controls');
		}

		const projectionStyle = getComputedStyle(projections);
		return {
			headerHeight: header.getBoundingClientRect().height,
			projectionBackground: projectionStyle.backgroundColor,
			projectionBorderWidths: [projectionStyle.borderTopWidth, projectionStyle.borderRightWidth, projectionStyle.borderBottomWidth, projectionStyle.borderLeftWidth],
			projectionPadding: [projectionStyle.paddingTop, projectionStyle.paddingRight, projectionStyle.paddingBottom, projectionStyle.paddingLeft],
			projectionGap: projectionStyle.columnGap,
			activeBackground: getComputedStyle(activeButton).backgroundColor,
			closeMarginLeft: getComputedStyle(close).marginLeft,
			buttonSizes: buttons.map(button => {
				const rect = button.getBoundingClientRect();
				return { width: rect.width, height: rect.height };
			})
		};
	});

	if (chrome.headerHeight > 36.5
		|| chrome.projectionBackground !== 'rgba(0, 0, 0, 0)'
		|| chrome.projectionBorderWidths.some(width => width !== '0px')
		|| chrome.projectionPadding.some(padding => padding !== '0px')
		|| chrome.projectionGap !== '0px'
		|| chrome.activeBackground === 'rgba(0, 0, 0, 0)'
		|| chrome.closeMarginLeft !== '2px'
		|| chrome.buttonSizes.some(size => Math.abs(size.width - 24) > 0.5 || Math.abs(size.height - 24) > 0.5)) {
		throw new Error(`Card detail header is not compact and unboxed: ${JSON.stringify(chrome)}`);
	}

	const hoverTarget = page.locator('.basehalf-card-detail-projection:not(.checked)').first();
	await hoverTarget.hover();
	const hoverOutline = await hoverTarget.evaluate(element => {
		const style = getComputedStyle(element);
		return { style: style.outlineStyle, width: style.outlineWidth };
	});
	if (hoverOutline.style !== 'none' && hoverOutline.width !== '0px') {
		throw new Error(`Card detail projection hover must not look like keyboard focus: ${JSON.stringify(hoverOutline)}`);
	}
}

// Opening a workspace installs nothing: BaseHalf creates no agent guide, no
// .bh/agent-harness, and no .gitignore (the fixture has none of them), and no
// focus mirror file exists.
async function assertWorkspaceOpenInstallsNothing() {
	for (const rel of ['CLAUDE.md', 'AGENTS.md', '.github/copilot-instructions.md', '.gitignore', '.bh/agent-harness']) {
		if (lstatOrUndefined(path.join(workspacePath, rel))) {
			throw new Error(`Opening the workspace must not create ${rel}`);
		}
	}
	assertNoFocusMirrorFiles();
}

// Opening the workspace and rendering its first canvas write nothing under
// .bh/. Every seeded file keeps its bytes and nothing is added: no focus
// file, no harness, and no canvas.yaml for a folder nobody arranged. A fresh
// folder therefore still has no .bh/ after its first canvas render. The wait
// outlasts the viewport persist debounce and the bounded legacy-import wait,
// so a delayed writer has run by the time the tree is compared.
// Every card has a saved place (canvas card placement). The first drawing of
// a canvas gives the cards that had no row a place and saves it. That is the
// only thing it writes, and git shows none of it.
async function assertFirstCanvasRenderSavesPlacesOutOfGit(page) {
	const layoutPath = path.join(workspacePath, '.bh', 'mirror', 'canvas.yaml');
	const shown = await page.locator('.basehalf-canvas-card[data-basehalf-card-path]').evaluateAll(cards => cards.map(card => card.getAttribute('data-basehalf-card-path')));
	if (shown.length < 2 || !shown.includes('README.md')) {
		throw new Error(`The root canvas must show the fixture's cards before their places are checked: ${JSON.stringify(shown)}`);
	}
	const rowsOf = () => {
		const raw = fs.readFileSync(layoutPath, 'utf8');
		return Object.fromEntries(shown.map(cardPath => [cardPath, readCanvasCardGeometry(raw, cardPath)]));
	};
	const deadline = Date.now() + 10_000;
	while (Object.values(rowsOf()).some(row => row === undefined)) {
		if (Date.now() > deadline) {
			throw new Error(`Every shown card must get a row in the first drawing: ${JSON.stringify(rowsOf())}`);
		}
		await page.waitForTimeout(100);
	}
	const raw = fs.readFileSync(layoutPath, 'utf8');
	const rows = rowsOf();
	// The row the user had is as it was. Every other row is marked as BaseHalf's choice.
	const expectedReadme = { x: -140, y: -110, width: 300, height: 220 };
	if (JSON.stringify(rows['README.md']) !== JSON.stringify(expectedReadme) || /- path: "README\.md"\n(?: {4}.*\n)* {4}auto: true/.test(raw)) {
		throw new Error(`The first drawing must not change a row that was there: ${JSON.stringify(rows['README.md'])}`);
	}
	const unmarked = shown.filter(cardPath => cardPath !== 'README.md' && !new RegExp(`- path: ${JSON.stringify(cardPath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n(?: {4}.*\\n)*? {4}auto: true`).test(raw));
	if (unmarked.length > 0) {
		throw new Error(`A place BaseHalf chose must be marked as its own choice: ${unmarked.join(', ')}`);
	}
	// What is drawn is what is stored.
	const drawn = await readCanvasCardPlaces(page, shown);
	const off = shown.filter(cardPath => Math.abs(drawn[cardPath].x - rows[cardPath].x) > 1 || Math.abs(drawn[cardPath].y - rows[cardPath].y) > 1);
	if (off.length > 0) {
		throw new Error(`A card must be drawn where its row says: ${JSON.stringify(off.map(cardPath => ({ cardPath, drawn: drawn[cardPath], row: rows[cardPath] })))}`);
	}
	// No two cards that BaseHalf placed meet.
	const meets = (first, second) => first.x < second.x + second.width && second.x < first.x + first.width && first.y < second.y + second.height && second.y < first.y + first.height;
	const overlapping = shown.flatMap((first, index) => shown.slice(index + 1).filter(second => meets(rows[first], rows[second])).map(second => `${first} on ${second}`));
	if (overlapping.length > 0) {
		throw new Error(`The first drawing must not put a card on another card: ${overlapping.join(', ')}`);
	}

	// Showing a canvas writes layouts and nothing else.
	const after = readBhTree();
	const changed = [...new Set([...Object.keys(bhTreeBeforeLaunch), ...Object.keys(after)])]
		.filter(rel => bhTreeBeforeLaunch[rel] !== after[rel] && !rel.endsWith('/canvas.yaml') && !rel.endsWith('/'))
		.sort();
	if (changed.length > 0) {
		throw new Error(`Opening the workspace and rendering its first canvas must write only layouts under .bh/: ${changed.join(', ')}`);
	}
	if (fs.readFileSync(path.join(workspacePath, '.bh', '.gitignore'), 'utf8') !== BH_IGNORE_FILE) {
		throw new Error('The ignore file under .bh/ must be the one BaseHalf writes.');
	}
	// And git shows none of it.
	const status = gitStatusOfWorkspace();
	if (status !== gitStatusBeforeLaunch) {
		throw new Error(`Opening the workspace and rendering its first canvas must change nothing that git shows.\nBefore:\n${gitStatusBeforeLaunch}\nAfter:\n${status}`);
	}
}

// The canvas places of the given cards, as the scene draws them.
async function readCanvasCardPlaces(page, cardPaths) {
	return page.evaluate(paths => {
		const places = {};
		for (const cardPath of paths) {
			const card = [...document.querySelectorAll('.basehalf-canvas-card[data-basehalf-card-path]')].find(element => element.getAttribute('data-basehalf-card-path') === cardPath);
			const node = card?.closest('.react-flow__node');
			const match = node ? /translate\((-?\d+(?:\.\d+)?)px,\s*(-?\d+(?:\.\d+)?)px\)/.exec(node.style.transform) : undefined;
			places[cardPath] = match ? { x: Number(match[1]), y: Number(match[2]) } : { x: NaN, y: NaN };
		}
		return places;
	}, cardPaths);
}

function gitStatusOfWorkspace() {
	return execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: workspacePath, encoding: 'utf8' });
}

// Every entry under the workspace's .bh/, keyed by workspace-relative path:
// directories end with '/', symbolic links map to their target, and files map
// to a hash of their bytes.
function readBhTree() {
	const tree = {};
	const pending = [path.join(workspacePath, '.bh')];
	while (pending.length > 0) {
		const directory = pending.pop();
		let entries;
		try {
			entries = fs.readdirSync(directory, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const entryPath = path.join(directory, entry.name);
			const rel = path.relative(workspacePath, entryPath).split(path.sep).join('/');
			if (entry.isSymbolicLink()) {
				tree[rel] = `link:${fs.readlinkSync(entryPath)}`;
			} else if (entry.isDirectory()) {
				tree[`${rel}/`] = 'directory';
				pending.push(entryPath);
			} else {
				tree[rel] = createHash('sha256').update(fs.readFileSync(entryPath)).digest('hex');
			}
		}
	}
	return tree;
}

// Neither the retired current-focus link nor any per-node focus file exists.
function assertNoFocusMirrorFiles() {
	if (lstatOrUndefined(path.join(workspacePath, '.bh', 'current_focus.yaml'))) {
		throw new Error('.bh/current_focus.yaml must not be written');
	}
	const pending = [path.join(workspacePath, '.bh', 'mirror')];
	while (pending.length > 0) {
		const directory = pending.pop();
		let entries;
		try {
			entries = fs.readdirSync(directory, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const entryPath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				pending.push(entryPath);
			} else if (entry.name === 'focus.yaml') {
				throw new Error(`Focus mirror file must not be written: ${path.relative(workspacePath, entryPath)}`);
			}
		}
	}
}

function lstatOrUndefined(filePath) {
	try {
		return fs.lstatSync(filePath);
	} catch {
		return undefined;
	}
}

// The card detail's Badge zone: expand it, author a note (flush-on-blur writes
// .bh/mirror), confirm the persisted value survives the zone's re-render, and
// cycle the collapse toggle.
async function assertCardDetailBadgeZone(page) {
	const toggle = page.locator('[data-testid="card-detail-badge-toggle"]');
	await toggle.waitFor({ state: 'visible', timeout: 20_000 });
	if (!(await page.locator('.basehalf-card-detail-badge-body').isVisible().catch(() => false))) {
		await toggle.click();
		await page.locator('.basehalf-card-detail-badge-body').waitFor({ state: 'visible', timeout: 20_000 });
	}

	const prompt = page.locator('.basehalf-card-detail-badge .basehalf-canvas-card-badge-prompt');
	await prompt.waitFor({ state: 'visible', timeout: 20_000 });
	await prompt.click();
	await prompt.fill('Badge smoke note for agents');
	await prompt.blur();
	await page.waitForFunction(() => {
		const el = document.querySelector('.basehalf-card-detail-badge .basehalf-canvas-card-badge-prompt');
		return el instanceof HTMLTextAreaElement && el.value.includes('Badge smoke note for agents');
	}, undefined, { timeout: 20_000 });

	await toggle.click();
	await page.locator('.basehalf-card-detail-badge-body').waitFor({ state: 'detached', timeout: 20_000 });
	await page.locator('[data-testid="card-detail-badge-toggle"]').click();
	await page.locator('.basehalf-card-detail-badge-body').waitFor({ state: 'visible', timeout: 20_000 });
}

// Clicking into the rich Markdown document while the centered Badge popover is
// open should use that same first click for the editor, not leave the popover
// hanging around until a second click.
async function assertBadgeClosesOnRichEditorActivation(page) {
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+W' : 'Control+W');
	await page.waitForTimeout(1_000);
	await quickOpen(page, 'README.md');
	await assertCardDetail(page, 'README.md');
	const rich = page.locator('.basehalf-card-detail-projection[aria-label="Rich"]');
	if (await rich.count()) {
		const pressed = await rich.getAttribute('aria-pressed').catch(() => 'false');
		if (pressed !== 'true') {
			await rich.click();
		}
	}
	const toggle = page.locator('[data-testid="card-detail-badge-toggle"]');
	await toggle.waitFor({ state: 'visible', timeout: 20_000 });
	if (!(await page.locator('.basehalf-card-detail-badge-body').isVisible().catch(() => false))) {
		await toggle.click({ force: true });
	}
	await page.locator('.basehalf-card-detail-badge-body').waitFor({ state: 'visible', timeout: 20_000 });
	const frame = await activeMarkdownRichFrame(page);
	const editable = frame.locator('.bn-editor [contenteditable="true"], .bn-editor[contenteditable="true"], .ProseMirror[contenteditable="true"]').first();
	await editable.waitFor({ state: 'visible', timeout: 20_000 });
	await editable.click({ position: { x: 24, y: 180 } });
	await page.locator('.basehalf-card-detail-badge-body').waitFor({ state: 'detached', timeout: 5_000 });
}

// `badge ` quick access finds the note authored above and routes back into the
// card detail — the full write-to-search loop over .bh/mirror.
async function assertBadgeQuickAccessFindsNote(page) {
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
	const quickInput = visibleQuickInput(page);
	await quickInput.waitFor({ state: 'visible', timeout: 15_000 });
	await quickInput.fill('badge smoke note for agents');
	const row = page.locator('.quick-input-list .monaco-list-row[role="option"]', { hasText: 'Badge smoke note for agents' }).first();
	await row.waitFor({ state: 'visible', timeout: 15_000 });
	await page.keyboard.press('Enter');
	await quickInput.waitFor({ state: 'hidden', timeout: 15_000 });
	await assertCardDetail(page, 'README.md');
}

async function assertFreshCanvasFramed(page) {
	await page.locator('.basehalf-canvas-card').first().waitFor({ state: 'visible', timeout: 20_000 });
	await page.waitForFunction(() => {
		const root = document.querySelector('.basehalf-canvas-workbench');
		const cardsLayer = document.querySelector('.basehalf-canvas-cards');
		const viewport = cardsLayer?.querySelector('.react-flow__viewport');
		const cards = Array.from(document.querySelectorAll('.basehalf-canvas-card'));
		if (!(root instanceof HTMLElement) || !(cardsLayer instanceof HTMLElement) || !(viewport instanceof HTMLElement) || cards.length < 2) {
			return false;
		}

		const rootRect = root.getBoundingClientRect();
		const rects = cards
			.map(card => card.getBoundingClientRect())
			.filter(rect => rect.width > 0 && rect.height > 0);
		if (rects.length < 2) {
			return false;
		}
		const negativeCard = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
		if (!(negativeCard instanceof HTMLElement)) {
			return false;
		}
		const negativeNode = negativeCard.closest('.react-flow__node');
		if (!(negativeNode instanceof HTMLElement)) {
			return false;
		}
		const negativeTransform = getComputedStyle(negativeNode).transform;
		const negativeMatrix = negativeTransform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(negativeTransform);
		const viewportTransform = getComputedStyle(viewport).transform;
		const viewportMatrix = viewportTransform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(viewportTransform);
		const reportedZoom = Number(root.dataset.zoom);
		if (negativeMatrix.m41 >= 0 || negativeMatrix.m42 >= 0 || !Number.isFinite(reportedZoom) || Math.abs(viewportMatrix.a - reportedZoom) > 0.01) {
			return false;
		}

		const minLeft = Math.min(...rects.map(rect => rect.left)) - rootRect.left;
		const minTop = Math.min(...rects.map(rect => rect.top)) - rootRect.top;
		const maxRight = Math.max(...rects.map(rect => rect.right)) - rootRect.left;
		const maxBottom = Math.max(...rects.map(rect => rect.bottom)) - rootRect.top;
		return minLeft >= 10
			&& minTop >= 10
			&& maxRight <= rootRect.width - 10
			&& maxBottom <= rootRect.height - 10;
	}, null, { timeout: 20_000 });

	const canvasFocusState = await page.locator('.basehalf-canvas-cards').evaluate(element => {
		if (!(element instanceof HTMLElement)) {
			return { focused: false, outlineStyle: '', outlineWidth: '' };
		}
		element.focus();
		const style = getComputedStyle(element);
		return {
			focused: document.activeElement === element,
			outlineStyle: style.outlineStyle,
			outlineWidth: style.outlineWidth,
		};
	});
	if (!canvasFocusState.focused) {
		throw new Error('Expected the canvas scene host to remain programmatically focusable');
	}
	if (canvasFocusState.outlineStyle !== 'none' && canvasFocusState.outlineWidth !== '0px') {
		throw new Error(`Expected the focused canvas scene host to avoid a full-surface outline: ${JSON.stringify(canvasFocusState)}`);
	}
}

async function assertCanvasGridScopedToCanvas(page) {
	// React Flow owns the world-space grid inside the same scene as its nodes
	// and edges. It must fill only the island, never become a workbench-level
	// CSS background that can drift independently from the viewport transform.
	await page.waitForFunction(() => {
		const canvas = document.querySelector('.basehalf-canvas-workbench');
		const cards = document.querySelector('.basehalf-canvas-cards');
		if (!(canvas instanceof HTMLElement) || !(cards instanceof HTMLElement)) {
			return false;
		}
		const background = cards.querySelector('.react-flow__background');
		const pattern = background?.querySelector('pattern');
		if (!(background instanceof SVGElement) || !(pattern instanceof SVGElement)) {
			return false;
		}
		const canvasRect = cards.getBoundingClientRect();
		const backgroundRect = background.getBoundingClientRect();
		return background.closest('.basehalf-canvas-react-island') === cards
			&& getComputedStyle(canvas).backgroundImage === 'none'
			&& Math.abs(backgroundRect.left - canvasRect.left) <= 1
			&& Math.abs(backgroundRect.top - canvasRect.top) <= 1
			&& Math.abs(backgroundRect.width - canvasRect.width) <= 1
			&& Math.abs(backgroundRect.height - canvasRect.height) <= 1;
	}, null, { timeout: 10_000 });
}

function canvasZoomController(page) {
	const trigger = page.locator('.basehalf-canvas-zoom-value:visible');
	const menu = page.locator('.basehalf-canvas-zoom-menu:visible');
	return {
		trigger,
		menu,
		input: menu.locator('.basehalf-canvas-zoom-input'),
		action: action => menu.locator(`[data-zoom-action="${action}"]`)
	};
}

async function openCanvasZoomMenu(page) {
	const controller = canvasZoomController(page);
	await controller.trigger.waitFor({ state: 'visible', timeout: 10_000 });
	if (!await controller.menu.isVisible().catch(() => false)) {
		await controller.trigger.click();
	}
	await controller.menu.waitFor({ state: 'visible', timeout: 10_000 });
	if (await controller.menu.getAttribute('role') !== 'dialog'
		|| await controller.trigger.getAttribute('aria-expanded') !== 'true') {
		throw new Error('Canvas zoom trigger did not open its dialog');
	}
	return controller;
}

async function zoomCanvas(page, action, options = {}) {
	if (options.preserveFocus) {
		const acted = await page.evaluate(({ actionName, useMetaKey }) => {
			const activeElement = document.activeElement;
			const root = activeElement?.closest('.basehalf-canvas-workbench');
			if (!(activeElement instanceof HTMLElement) || !(root instanceof HTMLElement)) {
				throw new Error('Canvas zoom shortcut requires focus inside the visible canvas');
			}
			const zoom = Number(root.dataset.zoom);
			if (actionName === 'out' && zoom <= 0.2 || actionName === 'in' && zoom >= 4) {
				return false;
			}
			const key = actionName === 'reset' ? '0' : actionName === 'out' ? '-' : actionName === 'in' ? '=' : undefined;
			if (!key) {
				throw new Error(`Canvas zoom action cannot preserve focus through a shortcut: ${actionName}`);
			}
			const event = new KeyboardEvent('keydown', {
				key,
				metaKey: useMetaKey,
				ctrlKey: !useMetaKey,
				bubbles: true,
				cancelable: true
			});
			activeElement.dispatchEvent(event);
			if (!event.defaultPrevented) {
				throw new Error(`Canvas zoom shortcut was not handled: ${actionName}`);
			}
			return true;
		}, { actionName: action, useMetaKey: process.platform === 'darwin' });
		await page.locator('.basehalf-canvas-zoom-menu').waitFor({ state: 'hidden', timeout: 10_000 });
		return acted;
	}

	const controller = await openCanvasZoomMenu(page);
	const actionButton = controller.action(action);
	await actionButton.waitFor({ state: 'visible', timeout: 10_000 });
	if (!await actionButton.isEnabled()) {
		await page.keyboard.press('Escape');
		await controller.menu.waitFor({ state: 'hidden', timeout: 10_000 });
		return false;
	}
	await actionButton.click();
	await controller.menu.waitFor({ state: 'hidden', timeout: 10_000 });
	return true;
}

async function assertCanvasContainsCard(page, path) {
	await page.locator('.basehalf-card-detail.visible').waitFor({ state: 'hidden', timeout: 20_000 });
	const card = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${path}"]`);
	if (await card.isVisible({ timeout: 2_000 }).catch(() => false)) {
		return;
	}
	for (let attempt = 0; attempt < 8; attempt++) {
		if (!await zoomCanvas(page, 'out')) {
			break;
		}
		if (await card.isVisible({ timeout: 500 }).catch(() => false)) {
			return;
		}
	}
	const canvas = page.locator('.basehalf-canvas-cards');
	for (let attempt = 0; attempt < 8; attempt++) {
		const bounds = await canvas.boundingBox();
		if (!bounds) {
			break;
		}
		const startX = bounds.x + bounds.width / 2;
		const startY = bounds.y + bounds.height / 2;
		await page.mouse.move(startX, startY);
		await page.mouse.down({ button: 'middle' });
		await page.mouse.move(bounds.x + bounds.width - 16, bounds.y + bounds.height - 16, { steps: 8 });
		await page.mouse.up({ button: 'middle' });
		if (await card.isVisible({ timeout: 500 }).catch(() => false)) {
			return;
		}
	}
	await card.waitFor({ state: 'visible', timeout: 20_000 });
}

async function assertCanvasFolder(page, folderPath) {
	await page.locator('.basehalf-card-detail.visible').waitFor({ state: 'hidden', timeout: 20_000 });
	await page.locator('.basehalf-canvas-react-island').waitFor({ state: 'visible', timeout: 20_000 });
	const currentFolder = page.locator(folderPath
		? '.basehalf-command-center-breadcrumb-segment.current'
		: '.basehalf-command-center-breadcrumb-segment.current.root').last();
	const expectedPath = [path.basename(workspacePath), ...folderPath.split('/').filter(Boolean)].join(' / ');
	const deadline = Date.now() + 20_000;
	let actualPath;
	do {
		if (await currentFolder.isVisible().catch(() => false)) {
			actualPath = await currentFolder.getAttribute('title');
			if (actualPath === expectedPath) {
				return;
			}
		}
		await page.waitForTimeout(100);
	} while (Date.now() < deadline);
	throw new Error(`Expected the ${folderPath || '<root>'} canvas, got ${actualPath || '<empty>'}`);
}

async function assertCanvasBreadcrumbsRemoved(page) {
	const count = await page.locator('.basehalf-breadcrumb').count();
	if (count !== 0) {
		throw new Error(`Expected BaseHalf breadcrumbs to be removed, found ${count}`);
	}
}

async function assertNativeBackOpensPreviousCanvas(page, expectedFolderPath) {
	await clickCommandCenterNavigationButton(page, 'arrow-left', 'Go Back');
	await assertCanvasFolder(page, expectedFolderPath);
}

async function assertCanvasZoomControls(page) {
	await zoomCanvas(page, 'reset');
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '1', null, { timeout: 10_000 });
	const beforeGesture = await page.evaluate(() => {
		const root = document.querySelector('.basehalf-canvas-workbench');
		const controls = document.querySelector('.basehalf-canvas-zoom-controls');
		const chrome = controls?.closest('.basehalf-canvas-chrome');
		const snapToggle = controls?.querySelector('.basehalf-canvas-snap-toggle');
		const viewport = document.querySelector('.basehalf-canvas-cards .react-flow__viewport');
		if (!(root instanceof HTMLElement)
			|| !(controls instanceof HTMLElement)
			|| !(chrome instanceof HTMLElement)
			|| !(snapToggle instanceof HTMLButtonElement)
			|| !(viewport instanceof HTMLElement)) {
			throw new Error('Missing React Flow zoom geometry');
		}
		const rootRect = root.getBoundingClientRect();
		const controlsRect = controls.getBoundingClientRect();
		const framePaint = element => {
			const style = getComputedStyle(element);
			return {
				backgroundColor: style.backgroundColor,
				borderTopWidth: style.borderTopWidth,
				borderRightWidth: style.borderRightWidth,
				borderBottomWidth: style.borderBottomWidth,
				borderLeftWidth: style.borderLeftWidth,
				boxShadow: style.boxShadow
			};
		};
		return {
			controls: { left: controlsRect.left, top: controlsRect.top, right: controlsRect.right, bottom: controlsRect.bottom },
			viewport: getComputedStyle(viewport).transform,
			leftGap: controlsRect.left - rootRect.left,
			bottomGap: rootRect.bottom - controlsRect.bottom,
			snapPressed: snapToggle.getAttribute('aria-pressed'),
			railChrome: { container: framePaint(chrome), controls: framePaint(controls) },
			center: { x: rootRect.left + rootRect.width / 2, y: rootRect.top + rootRect.height / 2 }
		};
	});
	if (beforeGesture.snapPressed !== 'true') {
		throw new Error(`Expected Canvas snap to be enabled by default: ${JSON.stringify(beforeGesture)}`);
	}
	if (Object.values(beforeGesture.railChrome).some(chrome =>
		!['transparent', 'rgba(0, 0, 0, 0)'].includes(chrome.backgroundColor)
		|| chrome.borderTopWidth !== '0px'
		|| chrome.borderRightWidth !== '0px'
		|| chrome.borderBottomWidth !== '0px'
		|| chrome.borderLeftWidth !== '0px'
		|| chrome.boxShadow !== 'none')) {
		throw new Error(`Expected unframed Canvas view controls: ${JSON.stringify(beforeGesture.railChrome)}`);
	}
	if (beforeGesture.leftGap < 8 || beforeGesture.leftGap > 20 || beforeGesture.bottomGap < 12 || beforeGesture.bottomGap > 24) {
		throw new Error(`Expected Canvas view controls in the lower-left of the canvas viewport: ${JSON.stringify(beforeGesture)}`);
	}
	await page.locator('.basehalf-canvas-zoom-value').blur();
	await page.mouse.move(beforeGesture.center.x, beforeGesture.center.y);
	if (opts.output) {
		await page.screenshot({ path: path.join(logsPath, 'canvas-zoom-rail.png'), fullPage: true });
	}
	const snapToggle = page.locator('.basehalf-canvas-snap-toggle:visible');
	await snapToggle.click();
	if (await snapToggle.getAttribute('aria-pressed') !== 'false') {
		throw new Error('Canvas snap toggle did not expose its disabled state');
	}
	await snapToggle.click();
	if (await snapToggle.getAttribute('aria-pressed') !== 'true') {
		throw new Error('Canvas snap toggle did not restore its enabled state');
	}
	// The scroll starts on empty canvas. In the middle the pointer would be
	// moved onto a card, and a long note at rest takes such a scroll.
	const emptyCanvas = await emptyCanvasPoint(page);
	await page.mouse.move(emptyCanvas.x, emptyCanvas.y);
	await page.mouse.wheel(80, 120);
	await page.waitForFunction(previous => {
		const viewport = document.querySelector('.basehalf-canvas-cards .react-flow__viewport');
		return viewport instanceof HTMLElement && getComputedStyle(viewport).transform !== previous;
	}, beforeGesture.viewport, { timeout: 10_000 });
	// React Flow reports the final viewport on moveEnd. Let that report settle
	// before starting a separate imperative zoom command. Chromium may surface
	// this pixel wheel input as a trackpad pinch on macOS, so use the settled
	// runtime zoom instead of assuming the gesture was a pure pan.
	await page.waitForTimeout(250);
	const zoomAfterGesture = Number(await page.locator('.basehalf-canvas-workbench').getAttribute('data-zoom'));
	if (!Number.isFinite(zoomAfterGesture) || zoomAfterGesture <= 0) {
		throw new Error(`Expected a valid runtime zoom after the viewport gesture; got ${zoomAfterGesture}`);
	}
	const afterGesture = await page.locator('.basehalf-canvas-zoom-controls').boundingBox();
	if (!afterGesture || Math.abs(afterGesture.x - beforeGesture.controls.left) > 1 || Math.abs(afterGesture.y - beforeGesture.controls.top) > 1) {
		throw new Error(`Expected zoom chrome to stay fixed while the canvas viewport changes: ${JSON.stringify({ beforeGesture, afterGesture })}`);
	}

	let controller = await openCanvasZoomMenu(page);
	await controller.input.waitFor({ state: 'visible', timeout: 10_000 });
	const [menuBox, controlsBox] = await Promise.all([controller.menu.boundingBox(), page.locator('.basehalf-canvas-zoom-controls').boundingBox()]);
	if (!menuBox || !controlsBox || menuBox.y + menuBox.height > controlsBox.y - 1) {
		throw new Error(`Expected the Canvas zoom dialog above its lower-left controls: ${JSON.stringify({ menuBox, controlsBox })}`);
	}
	if (!await controller.input.evaluate(input => document.activeElement === input)) {
		throw new Error('Opening Canvas zoom options did not focus the percentage input');
	}
	if (opts.output) {
		await page.screenshot({ path: path.join(logsPath, 'canvas-zoom-menu.png'), fullPage: true });
	}
	await controller.trigger.click();
	await controller.menu.waitFor({ state: 'hidden', timeout: 10_000 });
	if (await controller.trigger.getAttribute('aria-expanded') !== 'false') {
		throw new Error('Clicking the open Canvas zoom trigger did not close its dialog');
	}
	controller = await openCanvasZoomMenu(page);
	await page.keyboard.press('Escape');
	await controller.menu.waitFor({ state: 'hidden', timeout: 10_000 });
	if (await controller.trigger.getAttribute('aria-expanded') !== 'false'
		|| !await controller.trigger.evaluate(trigger => document.activeElement === trigger)) {
		throw new Error('Escape did not close Canvas zoom options and restore trigger focus');
	}

	controller = await openCanvasZoomMenu(page);
	await controller.input.fill('37.5%');
	await controller.input.press('Enter');
	await controller.menu.waitFor({ state: 'hidden', timeout: 10_000 });
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '0.375', null, { timeout: 10_000 });

	controller = await openCanvasZoomMenu(page);
	if (await controller.input.inputValue() !== '37.5') {
		throw new Error(`Canvas zoom percentage did not round-trip exactly: ${await controller.input.inputValue()}`);
	}
	await controller.input.press('Enter');
	await controller.menu.waitFor({ state: 'hidden', timeout: 10_000 });
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '0.375', null, { timeout: 10_000 });

	controller = await openCanvasZoomMenu(page);
	await controller.input.press('ArrowDown');
	if (await page.locator('.basehalf-canvas-zoom-menu-action:focus').getAttribute('data-zoom-action') !== 'in') {
		throw new Error('Canvas zoom dialog did not move keyboard focus from its input to the first enabled action');
	}
	await page.keyboard.press('Enter');
	await controller.menu.waitFor({ state: 'hidden', timeout: 10_000 });
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '0.475', null, { timeout: 10_000 });
	if (!await controller.trigger.evaluate(trigger => document.activeElement === trigger)) {
		throw new Error('Keyboard activation of a Canvas zoom action did not restore trigger focus');
	}

	controller = await openCanvasZoomMenu(page);
	await controller.input.fill('50');
	await controller.input.press('Enter');
	await controller.menu.waitFor({ state: 'hidden', timeout: 10_000 });
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '0.5', null, { timeout: 10_000 });
	await page.locator('.basehalf-canvas-zoom-value', { hasText: '50%' }).waitFor({ state: 'visible', timeout: 10_000 });
	if (await controller.trigger.getAttribute('aria-expanded') !== 'false'
		|| !await controller.trigger.evaluate(trigger => document.activeElement === trigger)) {
		throw new Error('Committing a Canvas zoom percentage did not close the dialog and restore trigger focus');
	}

	const nextZoom = 0.6;
	await zoomCanvas(page, 'in');
	await page.waitForFunction(expected => Number(document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom')) === expected, nextZoom, { timeout: 10_000 });
	await page.locator('.basehalf-canvas-zoom-value', { hasText: `${Math.round(nextZoom * 100)}%` }).waitFor({ state: 'visible', timeout: 10_000 });
	await zoomCanvas(page, 'reset');
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '1', null, { timeout: 10_000 });
	await page.locator('.basehalf-canvas-zoom-value', { hasText: '100%' }).waitFor({ state: 'visible', timeout: 10_000 });

	controller = await openCanvasZoomMenu(page);
	const workbenchZoomBefore = await page.evaluate(() => ({
		devicePixelRatio: window.devicePixelRatio,
		innerWidth: window.innerWidth,
		innerHeight: window.innerHeight
	}));
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+=' : 'Control+=');
	await controller.menu.waitFor({ state: 'hidden', timeout: 10_000 });
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '1.1', null, { timeout: 10_000 });
	const workbenchZoomAfter = await page.evaluate(() => ({
		devicePixelRatio: window.devicePixelRatio,
		innerWidth: window.innerWidth,
		innerHeight: window.innerHeight
	}));
	if (JSON.stringify(workbenchZoomAfter) !== JSON.stringify(workbenchZoomBefore)) {
		throw new Error(`Canvas zoom shortcut also changed the workbench zoom: ${JSON.stringify({ workbenchZoomBefore, workbenchZoomAfter })}`);
	}
	await zoomCanvas(page, 'reset');
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '1', null, { timeout: 10_000 });

	await zoomCanvas(page, 'preset-400');
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '4', null, { timeout: 10_000 });
	controller = await openCanvasZoomMenu(page);
	await controller.input.press('ArrowDown');
	if (await page.locator('.basehalf-canvas-zoom-menu-action:focus').getAttribute('data-zoom-action') !== 'out') {
		throw new Error('Canvas zoom keyboard navigation did not skip the disabled Zoom In action at 400%');
	}
	await page.keyboard.press('Escape');
	await controller.menu.waitFor({ state: 'hidden', timeout: 10_000 });
	await zoomCanvas(page, 'reset');
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '1', null, { timeout: 10_000 });

	const beforeFitTransform = await page.locator('.basehalf-canvas-cards .react-flow__viewport').evaluate(viewport => getComputedStyle(viewport).transform);
	await zoomCanvas(page, 'fit');
	await page.waitForFunction(previousTransform => {
		const root = document.querySelector('.basehalf-canvas-workbench');
		const viewport = document.querySelector('.basehalf-canvas-cards .react-flow__viewport');
		if (!(root instanceof HTMLElement) || !(viewport instanceof HTMLElement)) {
			return false;
		}
		const transform = getComputedStyle(viewport).transform;
		const matrix = transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(transform);
		return transform !== previousTransform
			&& Math.abs(matrix.a - Number(root.dataset.zoom)) < 0.01
			&& document.querySelector('.basehalf-canvas-zoom-value')?.textContent?.trim() === `${Math.round(Number(root.dataset.zoom) * 100)}%`;
	}, beforeFitTransform, { timeout: 10_000 });

	await zoomCanvas(page, 'reset');
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '1', null, { timeout: 10_000 });
	await page.locator('.basehalf-canvas-zoom-value', { hasText: '100%' }).waitFor({ state: 'visible', timeout: 10_000 });
}

async function assertNativeForwardOpensCardDetail(page, title, options = {}) {
	await clickCommandCenterNavigationButton(page, 'arrow-right', 'Go Forward');
	if (options.coldRichQuickInputQuery) {
		// The probe opens Quick Input while the cold rich generation boots, before
		// its first frame. Wait until that generation's iframe exists: a Quick
		// Input that is already open when the surface mounts pauses the boot
		// before any iframe is created, which is a different path and would make
		// this probe race the navigation itself.
		await page.locator('.basehalf-card-detail-surface.active .basehalf-card-detail-markdown-rich-webview iframe')
			.first().waitFor({ state: 'attached', timeout: 20_000 });
		const focusBeforeQuickInput = await page.evaluate(() => {
			const active = document.activeElement;
			return active instanceof HTMLElement ? {
				tag: active.tagName,
				classes: active.className,
				id: active.id,
				ariaLabel: active.getAttribute('aria-label')
			} : undefined;
		});
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
		const quickInput = visibleQuickInput(page);
		try {
			await quickInput.waitFor({ state: 'visible', timeout: 15_000 });
		} catch (error) {
			const focusAfterQuickInput = await page.evaluate(() => {
				const active = document.activeElement;
				const widget = document.querySelector('.quick-input-widget');
				return {
					active: active instanceof HTMLElement ? {
						tag: active.tagName,
						classes: active.className,
						id: active.id,
						ariaLabel: active.getAttribute('aria-label')
					} : undefined,
					widgetDisplay: widget instanceof HTMLElement ? getComputedStyle(widget).display : undefined,
					hostState: document.querySelector('.basehalf-card-detail-surface.active .basehalf-card-detail-markdown-rich-webview')?.getAttribute('data-basehalf-render-state')
				};
			});
			throw new Error(`Cold rich Quick Input did not remain visible: ${JSON.stringify({ focusBeforeQuickInput, focusAfterQuickInput, cause: String(error) })}`);
		}

		await page.locator('.basehalf-card-detail.visible').waitFor({ state: 'visible', timeout: 20_000 });
		await page.locator('.basehalf-card-detail-title', { hasText: shownFileName(title) }).waitFor({ state: 'visible', timeout: 20_000 });
		const activeSurface = page.locator('.basehalf-card-detail-surface.active');
		const richHost = activeSurface.locator('.basehalf-card-detail-markdown-rich-webview');
		await richHost.waitFor({ state: 'visible', timeout: 8_000 });
		const coldFrame = richHost.locator('iframe').first();
		await coldFrame.waitFor({ state: 'attached', timeout: 8_000 });
		const coldFrameName = await coldFrame.getAttribute('name');
		if (!coldFrameName) {
			throw new Error('The cold rich focus probe could not identify its iframe generation');
		}
		const initialLifecycle = await richHost.evaluate(host => ({
			state: host.dataset.basehalfRenderState,
			inert: host.inert,
			busy: host.getAttribute('aria-busy'),
			rendered: host.hasAttribute('data-basehalf-rendered')
		}));
		if (initialLifecycle.state === 'rendered') {
			throw new Error(`The cold rich focus probe missed the first-frame boundary: ${JSON.stringify(initialLifecycle)}`);
		}
		if ((initialLifecycle.state !== 'booting' && initialLifecycle.state !== 'settling' && initialLifecycle.state !== 'paused')
			|| !initialLifecycle.inert || initialLifecycle.busy !== 'true' || initialLifecycle.rendered) {
			throw new Error(`The cold rich Card Detail started with an invalid lifecycle: ${JSON.stringify(initialLifecycle)}`);
		}

		await page.waitForFunction(({ host, expectedFrameName }) => {
			const state = host.dataset.basehalfRenderState;
			const sameGeneration = [...host.querySelectorAll('iframe')].some(frame => frame.name === expectedFrameName);
			return state === 'paused' || state === 'rendered' || !sameGeneration;
		}, { host: await richHost.elementHandle(), expectedFrameName: coldFrameName }, { timeout: 15_000 });
		const guardedLifecycle = await richHost.evaluate((host, expectedFrameName) => ({
			state: host.dataset.basehalfRenderState,
			inert: host.inert,
			busy: host.getAttribute('aria-busy'),
			rendered: host.hasAttribute('data-basehalf-rendered'),
			sameGeneration: [...host.querySelectorAll('iframe')].some(frame => frame.name === expectedFrameName)
		}), coldFrameName);
		if (guardedLifecycle.state !== 'paused' || !guardedLifecycle.inert
			|| guardedLifecycle.busy !== 'true' || guardedLifecycle.rendered || !guardedLifecycle.sameGeneration) {
			throw new Error(`The cold rich focus probe did not settle behind Quick Input: ${JSON.stringify({ coldFrameName, guardedLifecycle })}`);
		}
		const quickInputFocusAtBoundary = await quickInput.evaluate(input => ({
			visible: input.getClientRects().length > 0 && getComputedStyle(input).visibility !== 'hidden',
			focused: input.ownerDocument.activeElement === input
		})).catch(() => undefined);
		if (!quickInputFocusAtBoundary?.visible || !quickInputFocusAtBoundary.focused) {
			throw new Error(`The cold rich focus boundary displaced Quick Input: ${JSON.stringify(quickInputFocusAtBoundary)}`);
		}

		await quickInput.fill(options.coldRichQuickInputQuery);
		await waitForQuickInputResult(page, options.coldRichQuickInputQuery);
		const quickInputFocus = await quickInput.evaluate(input => ({
			visible: input.getClientRects().length > 0 && getComputedStyle(input).visibility !== 'hidden',
			focused: input.ownerDocument.activeElement === input,
			value: input.value
		})).catch(() => undefined);
		if (!quickInputFocus?.visible || !quickInputFocus.focused || quickInputFocus.value !== options.coldRichQuickInputQuery) {
			throw new Error(`The cold rich Card Detail displaced Quick Input: ${JSON.stringify(quickInputFocus)}`);
		}
		const guardedAfterQuery = await richHost.evaluate((host, expectedFrameName) => ({
			state: host.dataset.basehalfRenderState,
			inert: host.inert,
			busy: host.getAttribute('aria-busy'),
			rendered: host.hasAttribute('data-basehalf-rendered'),
			sameGeneration: [...host.querySelectorAll('iframe')].some(frame => frame.name === expectedFrameName)
		}), coldFrameName);
		if (guardedAfterQuery.state !== 'paused' || !guardedAfterQuery.inert
			|| guardedAfterQuery.busy !== 'true' || guardedAfterQuery.rendered || !guardedAfterQuery.sameGeneration) {
			throw new Error(`The cold rich generation escaped its focus guard while Quick Input still owned focus: ${JSON.stringify(guardedAfterQuery)}`);
		}

		await page.keyboard.press('Escape');
		await quickInput.waitFor({ state: 'hidden', timeout: 15_000 });
		const renderedHost = activeSurface.locator(
			'.basehalf-card-detail-markdown-rich-webview[data-basehalf-rendered][data-basehalf-render-state="rendered"]'
		);
		await renderedHost.waitFor({ state: 'visible', timeout: 15_000 });
		await page.waitForFunction(host => !host.inert, await renderedHost.elementHandle(), { timeout: 8_000 });
	}
	await assertCardDetail(page, title);
}

async function clickCommandCenterNavigationButton(page, codicon, label) {
	const selector = `.command-center .action-item:not(.disabled) .action-label.codicon-${codicon}:not(.disabled):not([aria-disabled="true"])`;
	const button = page.locator(selector).filter({ visible: true }).last();
	await button.waitFor({ state: 'visible', timeout: 15_000 });
	const ariaLabel = await button.getAttribute('aria-label');
	if (ariaLabel && !ariaLabel.startsWith(label)) {
		throw new Error(`Expected ${label} navigation control, got ${ariaLabel}`);
	}
	await button.click();
}

async function assertNoEditorTabFor(page, name) {
	let lastTabs = [];
	const started = Date.now();
	while (Date.now() - started < 5_000) {
		lastTabs = await page.locator('.monaco-workbench .part.editor .tabs-container .tab').evaluateAll(rows => rows.map(row => row.textContent?.replace(/\s+/g, ' ').trim()));
		if (!lastTabs.some(tab => tab && tab.includes(name))) {
			return;
		}
		await page.waitForTimeout(100);
	}

	throw new Error(`Unexpected VS Code editor tab for ${name}: ${lastTabs.join(', ')}`);
}

async function assertCanvasStillOnTop(page, context) {
	const state = await page.evaluate(() => {
		const editorPart = document.querySelector('.monaco-workbench .part.editor');
		const activeEditor = document.querySelector('.monaco-workbench .part.editor .editor-instance[aria-label]');
		return {
			canvasOnTop: editorPart?.classList.contains('basehalf-canvas-on-top') === true,
			activeEditor: activeEditor?.getAttribute('aria-label') ?? undefined
		};
	});
	if (!state.canvasOnTop || state.activeEditor !== undefined) {
		throw new Error(`Canvas lost its primary surface ${context}: ${JSON.stringify(state)}`);
	}
}

function canvasNoteInlineEditor(page, relativePath) {
	const host = page.getByTestId(`canvas-note-editor-${relativePath}`);
	return {
		host,
		surface: host.locator('.basehalf-canvas-markdown-inline').first(),
		editable: host.locator('.basehalf-canvas-markdown-inline > .ProseMirror').first()
	};
}

async function waitForCanvasCardSelection(page, relativePath, timeout = 10_000) {
	await page.waitForFunction(path => {
		const card = Array.from(document.querySelectorAll('.basehalf-canvas-card'))
			.find(candidate => candidate instanceof HTMLElement && candidate.dataset.basehalfCardPath === path);
		return card?.closest('.react-flow__node')?.classList.contains('selected') === true;
	}, relativePath, { timeout });
}

async function waitForCanvasNoteInlineEditor(page, relativePath) {
	const editor = canvasNoteInlineEditor(page, relativePath);
	await editor.host.waitFor({ state: 'visible', timeout: 10_000 });
	await editor.surface.waitFor({ state: 'visible', timeout: 10_000 });
	await editor.editable.waitFor({ state: 'visible', timeout: 10_000 });
	try {
		await page.waitForFunction(testId => {
			const host = document.querySelector(`[data-testid="${testId}"]`);
			const editable = host?.querySelector('.basehalf-canvas-markdown-inline > .ProseMirror');
			return editable instanceof HTMLElement
				&& editable.getAttribute('contenteditable') === 'true'
				&& (document.activeElement === editable || editable.contains(document.activeElement));
		}, `canvas-note-editor-${relativePath}`, { timeout: 10_000 });
	} catch (error) {
		const focus = await page.evaluate(() => {
			const active = document.activeElement;
			return {
				tag: active?.tagName,
				className: active instanceof HTMLElement ? active.className : undefined,
				role: active?.getAttribute('role'),
				ariaLabel: active?.getAttribute('aria-label'),
				cardPath: active instanceof HTMLElement
					? active.closest<HTMLElement>('.basehalf-canvas-card')?.dataset.basehalfCardPath
					: undefined,
				insideCardDetail: active instanceof HTMLElement && active.closest('.basehalf-card-detail') !== null,
				insideCanvas: active instanceof HTMLElement && active.closest('.basehalf-canvas-workbench') !== null
			};
		});
		throw new Error(`Canvas Note ${relativePath} mounted but did not receive focus: ${JSON.stringify(focus)} (${error instanceof Error ? error.message : String(error)})`);
	}
	const liveEditors = await page.locator('[data-testid^="canvas-note-editor-"]').count();
	if (liveEditors !== 1) {
		throw new Error(`Expected exactly one Canvas Note inline editor, got ${liveEditors}`);
	}
	return editor;
}

async function placeCanvasInlineCaretAfter(editable, token) {
	await editable.evaluate(async (root, expectedToken) => {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let node;
		while ((node = walker.nextNode())) {
			const offset = node.textContent?.indexOf(expectedToken) ?? -1;
			if (offset < 0) {
				continue;
			}
			node.parentElement?.scrollIntoView({ block: 'center', inline: 'nearest' });
			const range = document.createRange();
			range.setStart(node, offset + expectedToken.length);
			range.collapse(true);
			root.focus();
			const selection = root.ownerDocument.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);
			await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			return;
		}
		throw new Error(`Inline editor did not render visible token: ${expectedToken}`);
	}, token);
}

async function placeCanvasInlineCaretBefore(editable, token) {
	await editable.evaluate(async (root, expectedToken) => {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let node;
		while ((node = walker.nextNode())) {
			const offset = node.textContent?.indexOf(expectedToken) ?? -1;
			if (offset < 0) {
				continue;
			}
			const range = document.createRange();
			range.setStart(node, offset);
			range.collapse(true);
			root.focus();
			const selection = root.ownerDocument.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);
			root.ownerDocument.dispatchEvent(new Event('selectionchange'));
			await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			return;
		}
		throw new Error(`Inline editor did not render visible token: ${expectedToken}`);
	}, token);
}

async function selectCanvasInlineToken(editable, token) {
	await editable.evaluate(async (root, expectedToken) => {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let node;
		while ((node = walker.nextNode())) {
			const offset = node.textContent?.indexOf(expectedToken) ?? -1;
			if (offset < 0) {
				continue;
			}
			const range = document.createRange();
			range.setStart(node, offset);
			range.setEnd(node, offset + expectedToken.length);
			root.focus();
			const selection = root.ownerDocument.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);
			root.ownerDocument.dispatchEvent(new Event('selectionchange'));
			await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			return;
		}
		throw new Error(`Inline editor did not render selectable token: ${expectedToken}`);
	}, token);
}

async function clickCanvasInlineCaretAfter(page, editable, token) {
	const point = await editable.evaluate((root, expectedToken) => {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let node;
		while ((node = walker.nextNode())) {
			const offset = node.textContent?.indexOf(expectedToken) ?? -1;
			if (offset < 0) {
				continue;
			}
			const range = document.createRange();
			range.setStart(node, offset + expectedToken.length - 1);
			range.setEnd(node, offset + expectedToken.length);
			const rect = range.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) {
				throw new Error(`Inline token has no clickable text bounds: ${expectedToken}`);
			}
			return { x: rect.right - 0.25, y: rect.top + rect.height / 2 };
		}
		throw new Error(`Inline editor did not render visible token: ${expectedToken}`);
	}, token);
	await page.mouse.click(point.x, point.y);
}

async function dragSelectCanvasInline(page, editable, fromToken, toToken) {
	const points = await editable.evaluate(async (root, tokens) => {
		const scroller = root.parentElement;
		if (!(scroller instanceof HTMLElement)) {
			throw new Error('Inline editor has no scrolling surface');
		}
		const rangeFor = expectedToken => {
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
			let node;
			while ((node = walker.nextNode())) {
				const offset = node.textContent?.indexOf(expectedToken) ?? -1;
				if (offset < 0) {
					continue;
				}
				const character = Math.max(offset, offset + Math.floor(expectedToken.length / 2));
				const range = document.createRange();
				range.setStart(node, character);
				range.setEnd(node, Math.min((node.textContent?.length ?? 0), character + 1));
				const rect = range.getBoundingClientRect();
				if (rect.width <= 0 || rect.height <= 0) {
					throw new Error(`Inline token has no selectable text bounds: ${expectedToken}`);
				}
				return { node, offset, rect };
			}
			throw new Error(`Inline editor did not render selection token: ${expectedToken}`);
		};
		const from = rangeFor(tokens.fromToken);
		const to = rangeFor(tokens.toToken);
		const scrollerBounds = scroller.getBoundingClientRect();
		const fromTop = scroller.scrollTop + from.rect.top - scrollerBounds.top;
		const fromBottom = fromTop + from.rect.height;
		const toTop = scroller.scrollTop + to.rect.top - scrollerBounds.top;
		const toBottom = toTop + to.rect.height;
		const contentTop = Math.min(fromTop, toTop);
		const contentBottom = Math.max(fromBottom, toBottom);
		if (contentBottom - contentTop > scroller.clientHeight - 8) {
			throw new Error(`Inline selection endpoints do not fit in one visible viewport: ${tokens.fromToken} -> ${tokens.toToken}`);
		}
		const targetScrollTop = Math.max(0, contentBottom - scroller.clientHeight + 4);
		scroller.scrollTop = Math.min(scroller.scrollHeight - scroller.clientHeight, targetScrollTop);
		await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		const visiblePoint = expectedToken => {
			const refreshed = rangeFor(expectedToken);
			const viewport = scroller.getBoundingClientRect();
			const x = refreshed.rect.left + refreshed.rect.width / 2;
			const y = refreshed.rect.top + refreshed.rect.height / 2;
			const hit = document.elementFromPoint(x, y);
			if (refreshed.rect.bottom <= viewport.top + 2
				|| refreshed.rect.top >= viewport.bottom - 2
				|| !root.contains(hit)) {
				throw new Error(`Inline selection endpoint is not topmost and visible: ${expectedToken}`);
			}
			return { x, y };
		};
		return { from: visiblePoint(tokens.fromToken), to: visiblePoint(tokens.toToken) };
	}, { fromToken, toToken });
	await page.waitForFunction(({ x, y }) => {
		const hit = document.elementFromPoint(x, y);
		return !!hit?.closest('.basehalf-canvas-markdown-inline > .ProseMirror');
	}, points.from, { timeout: 2_000 });
	// Collapse any previous directional selection first. Starting a second drag
	// on an existing selection endpoint can invoke the browser's drag-selection
	// gesture instead of creating a new range.
	await page.mouse.click(points.from.x, points.from.y);
	await page.mouse.move(points.from.x, points.from.y);
	await page.mouse.down();
	await page.mouse.move(points.to.x, points.to.y, { steps: 12 });
	await page.mouse.up();
	return editable.evaluate(root => {
		const selection = root.ownerDocument.getSelection();
		const unitFor = node => {
			const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
			return element?.closest?.('[data-basehalf-markdown-unit]')?.getAttribute('data-basehalf-markdown-unit');
		};
		return {
			collapsed: selection?.isCollapsed ?? true,
			text: selection?.toString() ?? '',
			anchorUnit: unitFor(selection?.anchorNode),
			focusUnit: unitFor(selection?.focusNode)
		};
	});
}

async function assertNoCanvasNoteHeavyEditor(page, cardSelector, phase) {
	const canvasDom = await page.locator(cardSelector).locator([
		'.monaco-editor',
		'.bn-editor',
		'.basehalf-card-detail-markdown-rich',
		'.basehalf-card-detail-markdown-rich-webview',
		'iframe',
		'webview'
	].join(', ')).count();
	const richFrames = await markdownRichEditorFrameCount(page, cardSelector);
	const detailOpen = await page.locator('.basehalf-card-detail.visible').isVisible().catch(() => false);
	const parkedDom = detailOpen ? 0 : await page.locator('.basehalf-card-detail-body .basehalf-card-detail-markdown-rich').count();
	const parkedFrames = detailOpen ? 0 : await markdownRichEditorFrameCount(page, '.basehalf-card-detail-body');
	if (canvasDom !== 0 || richFrames !== 0 || parkedDom !== 0 || parkedFrames !== 0) {
		throw new Error(`Canvas Note mounted Monaco, BlockNote, or a rich Webview during ${phase}: ${JSON.stringify({ canvasDom, richFrames, parkedDom, parkedFrames })}`);
	}
}

async function captureCanvasCardComputedChrome(card) {
	return card.evaluate(element => {
		const node = element.closest('.react-flow__node');
		const workbench = element.closest('.basehalf-canvas-workbench');
		if (!(node instanceof HTMLElement) || !(workbench instanceof HTMLElement)) {
			throw new Error('Canvas card chrome capture could not resolve its scene node');
		}

		const probe = document.createElement('span');
		probe.style.position = 'absolute';
		probe.style.visibility = 'hidden';
		probe.style.pointerEvents = 'none';
		workbench.appendChild(probe);
		const resolveColor = property => {
			probe.style.color = `var(${property})`;
			return getComputedStyle(probe).color;
		};
		const colors = {
			activeBorder: resolveColor('--bh-canvas-active-border'),
			geometry: resolveColor('--bh-canvas-geometry'),
			geometryStrong: resolveColor('--bh-canvas-geometry-strong'),
			focusRing: resolveColor('--bh-canvas-focus-ring'),
			intent: resolveColor('--bh-canvas-intent')
		};
		probe.remove();

		const isVisible = element => {
			const style = getComputedStyle(element);
			const bounds = element.getBoundingClientRect();
			return style.display !== 'none'
				&& style.visibility !== 'hidden'
				&& Number.parseFloat(style.opacity) > 0
				&& bounds.width > 0
				&& bounds.height > 0;
		};
		const borderPaint = style => ({
			top: { width: style.borderTopWidth, style: style.borderTopStyle, color: style.borderTopColor },
			right: { width: style.borderRightWidth, style: style.borderRightStyle, color: style.borderRightColor },
			bottom: { width: style.borderBottomWidth, style: style.borderBottomStyle, color: style.borderBottomColor },
			left: { width: style.borderLeftWidth, style: style.borderLeftStyle, color: style.borderLeftColor }
		});
		const isPaintedBorder = border => Number.parseFloat(border.width) > 0
			&& border.style !== 'none'
			&& border.style !== 'hidden'
			&& border.color !== 'transparent'
			&& border.color !== 'rgba(0, 0, 0, 0)';
		// Probe the real hit-testing against the painted silhouette: the corner
		// arc comes from the card's own computed radius and live zoom, so these
		// samples also catch a scene radius that drifts from the CSS token.
		const cardRect = element.getBoundingClientRect();
		const cardZoom = element.offsetWidth > 0 ? cardRect.width / element.offsetWidth : 1;
		const cornerRadius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) * cardZoom;
		const cornerPoint = (corner, degrees, distance) => {
			const [vertical, horizontal] = corner.split('-');
			const xSign = horizontal === 'right' ? 1 : -1;
			const ySign = vertical === 'bottom' ? 1 : -1;
			const centerX = xSign > 0 ? cardRect.right - cornerRadius : cardRect.left + cornerRadius;
			const centerY = ySign > 0 ? cardRect.bottom - cornerRadius : cardRect.top + cornerRadius;
			const radians = degrees * Math.PI / 180;
			return { x: centerX + xSign * distance * Math.cos(radians), y: centerY + ySign * distance * Math.sin(radians) };
		};
		const describeHit = hit => hit instanceof Element ? `${hit.tagName.toLowerCase()}.${hit.getAttribute('class') ?? ''}` : null;
		const isResizeTarget = hit => hit instanceof Element && hit.closest('.react-flow__resize-control') !== null;
		const resizeLines = Array.from(node.querySelectorAll('.basehalf-canvas-node-resizer-line')).map(line => {
			const style = getComputedStyle(line);
			const borders = borderPaint(style);
			const bounds = line.getBoundingClientRect();
			const vertical = line.classList.contains('left') || line.classList.contains('right');
			return {
				className: line.getAttribute('class'),
				opacity: style.opacity,
				pointerEvents: style.pointerEvents,
				borders,
				painted: Object.values(borders).some(isPaintedBorder),
				coversOnlyStraightSide: vertical
					? Math.abs(bounds.top - (cardRect.top + cornerRadius)) <= 1 && Math.abs(bounds.bottom - (cardRect.bottom - cornerRadius)) <= 1
					: Math.abs(bounds.left - (cardRect.left + cornerRadius)) <= 1 && Math.abs(bounds.right - (cardRect.right - cornerRadius)) <= 1
			};
		});
		const resizeHandles = Array.from(node.querySelectorAll('.basehalf-canvas-node-resizer-handle')).map(handle => {
			const style = getComputedStyle(handle);
			const borders = borderPaint(style);
			const visible = isVisible(handle);
			const backgroundPainted = style.backgroundColor !== 'transparent'
				&& style.backgroundColor !== 'rgba(0, 0, 0, 0)';
			const corner = `${handle.classList.contains('top') ? 'top' : 'bottom'}-${handle.classList.contains('left') ? 'left' : 'right'}`;
			const bands = Array.from(handle.querySelectorAll('.basehalf-canvas-node-resize-corner-band'));
			const indicator = handle.querySelector('.basehalf-canvas-node-resize-corner-indicator');
			const indicatorStyle = indicator ? getComputedStyle(indicator) : undefined;
			// The band spans both sides of the rounded edge: the outer part below
			// the card and the inner strip above the card's content.
			const arcSamples = [10, 45, 80].flatMap(degrees => [3, -4].map(offset => {
				const point = cornerPoint(corner, degrees, cornerRadius + offset);
				const hit = document.elementFromPoint(point.x, point.y);
				return {
					degrees,
					offset,
					hitsBand: hit !== null && bands.includes(hit),
					cursor: hit ? getComputedStyle(hit).cursor : 'none',
					hit: describeHit(hit)
				};
			}));
			const inside = cornerPoint(corner, 45, cornerRadius - 12);
			const insideHit = document.elementFromPoint(inside.x, inside.y);
			const beyond = cornerPoint(corner, 45, cornerRadius + 16);
			const beyondHit = document.elementFromPoint(beyond.x, beyond.y);
			return {
				className: handle.getAttribute('class'),
				corner,
				visible,
				interactive: visible && arcSamples.every(sample => sample.hitsBand),
				painted: visible && (backgroundPainted || Object.values(borders).some(isPaintedBorder)),
				arcSamples,
				insideBelongsToCard: insideHit instanceof Element && element.contains(insideHit) && !isResizeTarget(insideHit),
				insideHit: describeHit(insideHit),
				beyondBandIsTarget: isResizeTarget(beyondHit),
				beyondHit: describeHit(beyondHit),
				borderColor: style.borderColor,
				backgroundColor: style.backgroundColor,
				opacity: style.opacity,
				pointerEvents: style.pointerEvents,
				indicatorVisible: visible
					&& indicatorStyle !== undefined
					&& indicatorStyle.display !== 'none'
					&& Number.parseFloat(indicatorStyle.opacity) > 0,
				indicatorStroke: indicatorStyle?.stroke ?? 'none'
			};
		});
		const connectionHandles = Array.from(node.querySelectorAll('.basehalf-canvas-card-connect-handle')).map(handle => {
			const style = getComputedStyle(handle);
			return {
				className: handle.getAttribute('class'),
				visible: isVisible(handle),
				pointerEvents: style.pointerEvents
			};
		});
		const cardStyle = getComputedStyle(element);
		const nodeStyle = getComputedStyle(node);
		const outlinePaint = style => Number.parseFloat(style.outlineWidth) > 0 && style.outlineStyle !== 'none'
			? { outlineColor: style.outlineColor, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth }
			: { outlineColor: 'transparent', outlineStyle: 'none', outlineWidth: '0px' };
		return {
			colors,
			cardFocusVisible: element.matches(':focus-visible'),
			nodeFocusVisible: node.matches(':focus-visible'),
			activeElementInside: element === document.activeElement || element.contains(document.activeElement),
			cardSelected: element.classList.contains('selected'),
			cardResizing: element.dataset.cardResizing === 'true',
			nodeSelected: node.classList.contains('selected'),
			nodeDragging: node.classList.contains('dragging'),
			nodeResizing: element.dataset.cardResizing === 'true',
			noteEditing: element.dataset.noteEditing === 'true',
			cardPaint: {
				backgroundColor: cardStyle.backgroundColor,
				borderTopColor: cardStyle.borderTopColor,
				borderRightColor: cardStyle.borderRightColor,
				borderBottomColor: cardStyle.borderBottomColor,
				borderLeftColor: cardStyle.borderLeftColor,
				boxShadow: cardStyle.boxShadow,
				...outlinePaint(cardStyle)
			},
			nodePaint: outlinePaint(nodeStyle),
			resizeLines,
			resizeHandles,
			connectionHandles,
			paintedResizeLines: resizeLines.filter(line => line.painted).length,
			paintedResizeHandles: resizeHandles.filter(handle => handle.painted).length,
			visibleResizeHandles: resizeHandles.filter(handle => handle.visible).length,
			interactiveResizeHandles: resizeHandles.filter(handle => handle.interactive).length,
			liveConnectionHandles: connectionHandles.filter(handle => handle.visible || handle.pointerEvents !== 'none').length
		};
	});
}

function assertCanvasCardChromeDoesNotUseIntent(chrome, phase) {
	const usages = [];
	for (const [property, color] of Object.entries(chrome.cardPaint)) {
		if (property.startsWith('border') && color === chrome.colors.intent) {
			usages.push(`card.${property}`);
		}
	}
	if (chrome.cardPaint.outlineStyle !== 'none'
		&& chrome.cardPaint.outlineWidth !== '0px'
		&& chrome.cardPaint.outlineColor === chrome.colors.intent) {
		usages.push('card.outlineColor');
	}
	if (chrome.nodePaint.outlineStyle !== 'none'
		&& chrome.nodePaint.outlineWidth !== '0px'
		&& chrome.nodePaint.outlineColor === chrome.colors.intent) {
		usages.push('node.outlineColor');
	}
	for (const [index, line] of chrome.resizeLines.entries()) {
		for (const [side, border] of Object.entries(line.borders)) {
			if (border.color === chrome.colors.intent) {
				usages.push(`resizeLine[${index}].${side}`);
			}
		}
	}
	for (const [index, handle] of chrome.resizeHandles.entries()) {
		if (handle.painted && handle.borderColor === chrome.colors.intent) {
			usages.push(`resizeHandle[${index}].borderColor`);
		}
		if (handle.painted && handle.backgroundColor === chrome.colors.intent) {
			usages.push(`resizeHandle[${index}].backgroundColor`);
		}
		if (handle.indicatorVisible && handle.indicatorStroke === chrome.colors.intent) {
			usages.push(`resizeHandle[${index}].indicatorStroke`);
		}
	}
	if (usages.length > 0) {
		throw new Error(`Canvas card used connection-intent paint during ${phase}: ${JSON.stringify({ usages, chrome })}`);
	}
}

function assertCanvasPointerChromeHasNoOutline(chrome, phase) {
	const painted = [];
	for (const [owner, paint] of [['card', chrome.cardPaint], ['node', chrome.nodePaint]]) {
		if (paint.outlineStyle !== 'none' && paint.outlineWidth !== '0px') {
			painted.push({ owner, color: paint.outlineColor, style: paint.outlineStyle, width: paint.outlineWidth });
		}
	}
	if (painted.length > 0) {
		throw new Error(`Pointer interaction rendered a focus outline during ${phase}: ${JSON.stringify({ painted, chrome })}`);
	}
}

function assertCanvasCardUsesActiveBorder(chrome, phase) {
	const sides = ['borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor'];
	const unexpected = sides.filter(side => chrome.cardPaint[side] !== chrome.colors.activeBorder);
	if (unexpected.length > 0) {
		throw new Error(`Active Canvas card did not use one steady border during ${phase}: ${JSON.stringify({ unexpected, chrome })}`);
	}
}

function assertCanvasCardPaintEqual(expected, actual, phase) {
	if (JSON.stringify(expected) !== JSON.stringify(actual)) {
		throw new Error(`Canvas card paint changed during ${phase}: ${JSON.stringify({ expected, actual })}`);
	}
}

function assertCanvasCardResizeChromeIsNeutral(chrome, phase) {
	assertCanvasCardChromeDoesNotUseIntent(chrome, phase);
	assertCanvasPointerChromeHasNoOutline(chrome, phase);
	assertCanvasCardUsesActiveBorder(chrome, phase);
	if (chrome.paintedResizeLines !== 0) {
		throw new Error(`Canvas card rendered a resize outline during ${phase}: ${JSON.stringify(chrome.resizeLines)}`);
	}
	if (chrome.paintedResizeHandles !== 0) {
		throw new Error(`Canvas card painted a resize control box during ${phase}: ${JSON.stringify(chrome.resizeHandles)}`);
	}
	// The corner indicator is the only resize paint: at most one arc, in the
	// neutral geometry color.
	const indicators = chrome.resizeHandles.filter(handle => handle.indicatorVisible);
	if (indicators.length > 1 || indicators.some(handle => handle.indicatorStroke !== chrome.colors.geometryStrong)) {
		throw new Error(`Canvas card showed more than one neutral corner indicator during ${phase}: ${JSON.stringify({ indicators, geometryStrong: chrome.colors.geometryStrong })}`);
	}
}

function assertCanvasCardHasRoundedCornerResizeTargets(chrome, phase) {
	const cursors = {
		'top-left': 'nwse-resize',
		'top-right': 'nesw-resize',
		'bottom-left': 'nesw-resize',
		'bottom-right': 'nwse-resize'
	};
	const corners = chrome.resizeHandles.map(handle => handle.corner).sort();
	const invalid = chrome.resizeHandles.filter(handle => !handle.interactive
		|| handle.painted
		|| handle.arcSamples.some(sample => sample.cursor !== cursors[handle.corner])
		|| !handle.insideBelongsToCard
		|| handle.beyondBandIsTarget);
	const misplacedSides = chrome.resizeLines.filter(line => !line.coversOnlyStraightSide);
	if (JSON.stringify(corners) !== JSON.stringify(['bottom-left', 'bottom-right', 'top-left', 'top-right'])
		|| invalid.length > 0
		|| misplacedSides.length > 0) {
		throw new Error(`Canvas card did not expose rounded corner and straight side resize targets during ${phase}: ${JSON.stringify({ corners, invalid, misplacedSides })}`);
	}
}

/**
 * A point on a card's corner resize band: on the corner arc's 45° radius, a few
 * screen pixels outside the painted edge.
 */
async function canvasCardCornerBandPoint(card, corner = 'bottom-right', outside = 4) {
	return card.evaluate((element, { corner, outside }) => {
		const rect = element.getBoundingClientRect();
		const zoom = element.offsetWidth > 0 ? rect.width / element.offsetWidth : 1;
		const radius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) * zoom;
		const [vertical, horizontal] = corner.split('-');
		const xSign = horizontal === 'right' ? 1 : -1;
		const ySign = vertical === 'bottom' ? 1 : -1;
		const distance = (radius + outside) * Math.SQRT1_2;
		return {
			x: (xSign > 0 ? rect.right - radius : rect.left + radius) + xSign * distance,
			y: (ySign > 0 ? rect.bottom - radius : rect.top + radius) + ySign * distance
		};
	}, { corner, outside });
}

async function waitForCanvasCardCornerIndicators(page, cardPath, expectedCorners, phase) {
	try {
		await page.waitForFunction(({ path, expected }) => {
			const card = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"]`);
			const node = card?.closest('.react-flow__node');
			if (!node) {
				return false;
			}
			const handles = Array.from(node.querySelectorAll('.basehalf-canvas-node-resizer-handle'));
			return handles.length === 4 && handles.every(handle => {
				const corner = `${handle.classList.contains('top') ? 'top' : 'bottom'}-${handle.classList.contains('left') ? 'left' : 'right'}`;
				const indicator = handle.querySelector('.basehalf-canvas-node-resize-corner-indicator');
				const opacity = indicator ? getComputedStyle(indicator).opacity : '0';
				return opacity === (expected.includes(corner) ? '1' : '0');
			});
		}, { path: cardPath, expected: expectedCorners }, { timeout: 3_000 });
	} catch (error) {
		throw new Error(`Corner indicators of ${cardPath} did not settle to ${JSON.stringify(expectedCorners)} ${phase}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

async function startCanvasNoteEditTransitionProbe(note, tokens, expectedPreviewIdentity, direction = 'enter', exactParagraph) {
	await note.evaluate((card, { expectedTokens, expectedPreviewIdentity, direction, exactParagraph, timeout, frameLimit }) => {
		type ProbePhase = 'static' | 'mounting' | 'ready' | 'missing';
		type ProbeFrame = {
			phase: ProbePhase;
			[key: string]: any;
		};
		type TransitionProbe = {
			direction: 'enter' | 'exit';
			frames: ProbeFrame[];
			finished: Promise<void>;
			outcome?: 'ready' | 'static' | 'deadline' | 'frame-limit' | 'cancelled';
			cancel: () => void;
		};
		if (direction !== 'enter' && direction !== 'exit') {
			throw new Error('Canvas Note transition probe received an invalid direction');
		}
		const scope = window as typeof window & { __basehalfSmokeNoteEditTransition?: TransitionProbe };
		scope.__basehalfSmokeNoteEditTransition?.cancel();
		const markedStaticPreview = card.querySelector('[data-smoke-preview-identity="' + CSS.escape(expectedPreviewIdentity) + '"]');
		const retainedExitFallback = direction === 'exit' ? card.querySelector('.basehalf-canvas-note-editor-fallback') : null;
		if (direction === 'exit' && !(retainedExitFallback instanceof HTMLElement)) {
			throw new Error('Canvas Note exit transition could not find the retained editing fallback');
		}
		if (retainedExitFallback instanceof HTMLElement) {
			if (markedStaticPreview && markedStaticPreview !== retainedExitFallback) {
				throw new Error('Canvas Note exit transition marker is not on the retained editing fallback');
			}
			const retainedIdentity = retainedExitFallback.getAttribute('data-smoke-preview-identity');
			if (retainedIdentity && retainedIdentity !== expectedPreviewIdentity) {
				throw new Error('Canvas Note exit transition retained fallback has an unexpected marker identity');
			}
			retainedExitFallback.setAttribute('data-smoke-preview-identity', expectedPreviewIdentity);
		}
		const originalStaticPreview = retainedExitFallback ?? markedStaticPreview;
		if (!(originalStaticPreview instanceof HTMLElement)) {
			throw new Error('Canvas Note transition probe could not find its marked static preview or retained editing fallback');
		}

		let animationFrame = 0;
		let targetFrames = 0;
		let sawInitialPhase = false;
		let settled = false;
		let deadlineTimer = 0;
		let settleProbe: (() => void) | undefined;
		const frames: ProbeFrame[] = [];
		const finished = new Promise<void>(resolve => settleProbe = resolve);
		let probe: TransitionProbe;
		const settle = (outcome: NonNullable<TransitionProbe['outcome']>) => {
			if (settled) {
				return;
			}
			settled = true;
			probe.outcome = outcome;
			cancelAnimationFrame(animationFrame);
			clearTimeout(deadlineTimer);
			settleProbe?.();
		};
		const visibleIntersection = (bounds: DOMRect, bodyBounds: DOMRect) => {
			const left = Math.max(bounds.left, bodyBounds.left, 0);
			const top = Math.max(bounds.top, bodyBounds.top, 0);
			const right = Math.min(bounds.right, bodyBounds.right, window.innerWidth);
			const bottom = Math.min(bounds.bottom, bodyBounds.bottom, window.innerHeight);
			return right - left > 1 && bottom - top > 1 ? { left, top, right, bottom } : undefined;
		};
		const ancestorsAreVisible = (element: Element) => {
			for (let current: Element | null = element; current; current = current.parentElement) {
				const style = getComputedStyle(current);
				if (style.display === 'none' || style.visibility === 'hidden' || Number.parseFloat(style.opacity) <= 0) {
					return false;
				}
				if (current === card) {
					break;
				}
			}
			return true;
		};
		const topmostPointBelongsTo = (element: HTMLElement, bounds: { left: number; top: number; right: number; bottom: number }) => {
			const points = [
				[(bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2],
				[bounds.left + (bounds.right - bounds.left) / 3, bounds.top + (bounds.bottom - bounds.top) / 3],
				[bounds.right - (bounds.right - bounds.left) / 3, bounds.bottom - (bounds.bottom - bounds.top) / 3]
			];
			return points.some(([x, y]) => {
				const hit = document.elementFromPoint(x, y);
				return hit === element || (hit !== null && element.contains(hit));
			});
		};
		const isActuallyVisible = (element: Element | null, body: HTMLElement): element is HTMLElement => {
			if (!(element instanceof HTMLElement) || !card.contains(element) || element.getClientRects().length === 0 || !ancestorsAreVisible(element)) {
				return false;
			}
			const visibleBounds = visibleIntersection(element.getBoundingClientRect(), body.getBoundingClientRect());
			return visibleBounds !== undefined && topmostPointBelongsTo(element, visibleBounds);
		};
		const isActuallyVisibleRange = (range: Range, parent: HTMLElement, surface: HTMLElement, body: HTMLElement) => {
			if (!ancestorsAreVisible(parent)) {
				return false;
			}
			const bodyBounds = body.getBoundingClientRect();
			return Array.from(range.getClientRects()).some(bounds => {
				const visibleBounds = visibleIntersection(bounds, bodyBounds);
				if (!visibleBounds) {
					return false;
				}
				const hit = document.elementFromPoint(
					(visibleBounds.left + visibleBounds.right) / 2,
					(visibleBounds.top + visibleBounds.bottom) / 2
				);
				return hit !== null
					&& surface.contains(hit)
					&& (hit === parent || parent.contains(hit) || hit.contains(parent));
			});
		};
		const relativeRect = (bounds: DOMRect, bodyBounds: DOMRect) => ({
			x: bounds.left - bodyBounds.left,
			y: bounds.top - bodyBounds.top,
			width: bounds.width,
			height: bounds.height
		});
		const captureExactParagraph = (surface: HTMLElement, body: HTMLElement) => {
			if (!exactParagraph) {
				return undefined;
			}
			const stablePrefix = exactParagraph.slice(0, 24);
			const paragraph = Array.from(surface.querySelectorAll('p')).find(candidate => candidate.textContent?.includes(stablePrefix));
			if (!(paragraph instanceof HTMLElement)) {
				return { text: undefined, visibleText: undefined, starCount: undefined, fullyVisible: false, glyphs: [] };
			}
			const bodyBounds = body.getBoundingClientRect();
			const paragraphBounds = paragraph.getBoundingClientRect();
			const glyphs = [];
			const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
			let node;
			while ((node = walker.nextNode())) {
				const parent = node.parentElement;
				if (!(parent instanceof HTMLElement)) {
					continue;
				}
				let offset = 0;
				for (const character of node.textContent ?? '') {
					const nextOffset = offset + character.length;
					const range = document.createRange();
					range.setStart(node, offset);
					range.setEnd(node, nextOffset);
					offset = nextOffset;
					if (!isActuallyVisibleRange(range, parent, surface, body)) {
						continue;
					}
					const bounds = range.getBoundingClientRect();
					const style = getComputedStyle(parent);
					glyphs.push({
						character,
						...relativeRect(bounds, bodyBounds),
						fontFamily: style.fontFamily,
						fontSize: style.fontSize,
						fontWeight: style.fontWeight,
						fontStyle: style.fontStyle,
						lineHeight: style.lineHeight,
						textDecorationLine: style.textDecorationLine
					});
				}
			}
			const text = paragraph.textContent ?? '';
			return {
				text,
				visibleText: glyphs.map(glyph => glyph.character).join(''),
				starCount: Array.from(text).filter(character => character === '*').length,
				fullyVisible: paragraphBounds.top >= bodyBounds.top - 1
					&& paragraphBounds.bottom <= bodyBounds.bottom + 1,
				rect: relativeRect(paragraphBounds, bodyBounds),
				glyphs
			};
		};
		const sample = () => {
			const node = card.closest('.react-flow__node');
			const isVisible = (element: Element) => {
				const style = getComputedStyle(element);
				return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
			};
			const chrome = {
				noteEditing: card.dataset.noteEditing === 'true',
				visibleResizeHandles: Array.from(node?.querySelectorAll('.basehalf-canvas-node-resizer-handle') ?? []).filter(isVisible).length,
				liveConnectionHandles: Array.from(node?.querySelectorAll('.basehalf-canvas-card-connect-handle') ?? []).filter(handle => isVisible(handle) && getComputedStyle(handle).pointerEvents !== 'none').length
			};
			const body = card.querySelector('.basehalf-canvas-card-body');
			if (!(body instanceof HTMLElement)) {
				frames.push({
					...chrome,
					phase: 'missing',
					devicePixelRatio: window.devicePixelRatio,
					originalPreviewIdentity: card.contains(originalStaticPreview) ? originalStaticPreview.getAttribute('data-smoke-preview-identity') ?? undefined : undefined,
					staticPreviewIsOriginal: false,
					fallbackIsOriginalPreview: false,
					tokens: expectedTokens.map(token => ({ token }))
				});
			} else {
				const readyHost = card.querySelector('.basehalf-canvas-note-editor.ready');
				const readySurface = readyHost?.querySelector('.basehalf-canvas-markdown-inline') ?? null;
				const fallback = card.querySelector('.basehalf-canvas-note-editor-fallback');
				const staticPreview = card.querySelector('.basehalf-canvas-card-preview .bh-md-preview:not(.basehalf-canvas-markdown-inline)');
				const staticPreviewIsOriginal = staticPreview === originalStaticPreview;
				const fallbackIsOriginalPreview = fallback === originalStaticPreview;
				let phase: ProbePhase = 'missing';
				let surface: HTMLElement | undefined;
				if (isActuallyVisible(readyHost, body) && isActuallyVisible(readySurface, body)) {
					phase = 'ready';
					surface = readySurface;
				} else if (fallbackIsOriginalPreview
					&& fallback.getAttribute('aria-hidden') !== 'true'
					&& !fallback.hasAttribute('inert')
					&& isActuallyVisible(fallback, body)) {
					phase = 'mounting';
					surface = fallback;
				} else if (staticPreviewIsOriginal
					&& !originalStaticPreview.classList.contains('basehalf-canvas-note-editor-fallback')
					&& originalStaticPreview.getAttribute('aria-hidden') !== 'true'
					&& !originalStaticPreview.hasAttribute('inert')
					&& isActuallyVisible(originalStaticPreview, body)) {
					phase = 'static';
					surface = originalStaticPreview;
				}

				const bodyBounds = body.getBoundingClientRect();
				const frame: ProbeFrame = {
					...chrome,
					phase,
					devicePixelRatio: window.devicePixelRatio,
					originalPreviewIdentity: card.contains(originalStaticPreview) ? originalStaticPreview.getAttribute('data-smoke-preview-identity') ?? undefined : undefined,
					staticPreviewIsOriginal,
					fallbackIdentity: fallback?.getAttribute('data-smoke-preview-identity') ?? undefined,
					fallbackIsOriginalPreview,
					body: surface ? {
						x: bodyBounds.left,
						y: bodyBounds.top,
						width: bodyBounds.width,
						height: bodyBounds.height
					} : undefined,
					surface: surface ? (() => {
						const bounds = surface.getBoundingClientRect();
						const style = getComputedStyle(surface);
						return {
							...relativeRect(bounds, bodyBounds),
							clientWidth: surface.clientWidth,
							offsetWidth: surface.offsetWidth,
							layoutGutter: surface.offsetWidth - surface.clientWidth,
							scrollTop: surface.scrollTop,
							scrollHeight: surface.scrollHeight,
							clientHeight: surface.clientHeight,
							overflowY: style.overflowY,
							scrollbarGutter: style.scrollbarGutter,
							paddingLeft: style.paddingLeft,
							paddingRight: style.paddingRight
						};
					})() : undefined,
					tokens: expectedTokens.map(token => ({ token }))
				};
				let textBlock: Element | undefined;
				if (surface) {
					frame.tokens = expectedTokens.map(token => {
						const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
						let node;
						while ((node = walker.nextNode())) {
							const offset = node.textContent?.indexOf(token) ?? -1;
							const parent = node.parentElement;
							if (offset < 0 || !(parent instanceof HTMLElement)) {
								continue;
							}
							const range = document.createRange();
							range.setStart(node, offset);
							range.setEnd(node, offset + token.length);
							if (!isActuallyVisibleRange(range, parent, surface, body)) {
								continue;
							}
							const bounds = range.getBoundingClientRect();
							const style = getComputedStyle(parent);
							textBlock ??= parent.closest('p, h1, h2, h3, h4, h5, h6, li, blockquote') ?? parent;
							return {
								token,
								...relativeRect(bounds, bodyBounds),
								font: {
									family: style.fontFamily,
									size: style.fontSize,
									lineHeight: style.lineHeight,
									weight: style.fontWeight,
									style: style.fontStyle,
									letterSpacing: style.letterSpacing,
									wordSpacing: style.wordSpacing
								}
							};
						}
						return { token };
					});
				}
				if (textBlock) {
					frame.textBlock = relativeRect(textBlock.getBoundingClientRect(), bodyBounds);
				}
				const alreadyCapturedPhase = frames.some(candidate => candidate.phase === phase && candidate.exactParagraph);
				if (surface && (phase === 'static' || phase === 'ready') && !alreadyCapturedPhase) {
					frame.exactParagraph = captureExactParagraph(surface, body);
				}
				frames.push(frame);
			}

			const phase = frames.at(-1)?.phase;
			const initialPhase: ProbePhase = direction === 'enter' ? 'static' : 'ready';
			const targetPhase: ProbePhase = direction === 'enter' ? 'ready' : 'static';
			sawInitialPhase ||= phase === initialPhase;
			targetFrames = sawInitialPhase && phase === targetPhase ? targetFrames + 1 : 0;
			if (targetFrames >= 4) {
				settle(targetPhase);
				return;
			}
			if (frames.length >= frameLimit) {
				settle('frame-limit');
				return;
			}
			animationFrame = requestAnimationFrame(sample);
		};
		probe = { direction, frames, finished, cancel: () => settle('cancelled') };
		scope.__basehalfSmokeNoteEditTransition = probe;
		deadlineTimer = window.setTimeout(() => settle('deadline'), timeout);
		sample();
	}, { expectedTokens: tokens, expectedPreviewIdentity, direction, exactParagraph, timeout: 5_000, frameLimit: 600 });
}

async function finishCanvasNoteEditTransitionProbe(page) {
	return page.evaluate(async () => {
		type TransitionProbe = {
			direction: 'enter' | 'exit';
			frames: Array<Record<string, any>>;
			finished: Promise<void>;
			outcome?: 'ready' | 'static' | 'deadline' | 'frame-limit' | 'cancelled';
			cancel: () => void;
		};
		const scope = window as typeof window & { __basehalfSmokeNoteEditTransition?: TransitionProbe };
		const probe = scope.__basehalfSmokeNoteEditTransition;
		if (!probe) {
			throw new Error('Canvas Note transition probe was not installed');
		}
		try {
			await probe.finished;
			return { direction: probe.direction, frames: probe.frames, outcome: probe.outcome };
		} finally {
			probe.cancel();
			if (scope.__basehalfSmokeNoteEditTransition === probe) {
				delete scope.__basehalfSmokeNoteEditTransition;
			}
		}
	});
}

async function cancelCanvasNoteEditTransitionProbe(page) {
	await page.evaluate(() => {
		type TransitionProbe = { cancel: () => void };
		const scope = window as typeof window & { __basehalfSmokeNoteEditTransition?: TransitionProbe };
		const probe = scope.__basehalfSmokeNoteEditTransition;
		try {
			probe?.cancel();
		} finally {
			if (scope.__basehalfSmokeNoteEditTransition === probe) {
				delete scope.__basehalfSmokeNoteEditTransition;
			}
		}
	});
}

function assertCanvasNoteTransitionFrames(result, tokens, expectedPreviewIdentity, direction) {
	const { frames, outcome } = result;
	const initialPhase = direction === 'enter' ? 'static' : 'ready';
	const targetPhase = direction === 'enter' ? 'ready' : 'static';
	if (result.direction !== direction || outcome !== targetPhase) {
		throw new Error('Canvas Note ' + direction + ' transition probe did not settle on ' + targetPhase + ': ' + JSON.stringify({
			direction: result.direction,
			outcome,
			phases: frames.map(frame => frame.phase)
		}));
	}
	const baseline = frames[0];
	if (!baseline || baseline.phase !== initialPhase || !baseline.body || !baseline.surface || !baseline.textBlock) {
		throw new Error('Canvas Note ' + direction + ' transition did not start from a measurable ' + initialPhase + ' frame: ' + JSON.stringify(baseline));
	}
	if (frames.length < 5 || frames.slice(-4).some(frame => frame.phase !== targetPhase)) {
		throw new Error('Canvas Note ' + direction + ' transition did not finish with four consecutive ' + targetPhase + ' frames: ' + JSON.stringify(frames.map(frame => frame.phase)));
	}

	const baselineTokens = new Map(baseline.tokens.map(metric => [metric.token, metric]));
	const numericFields = ['x', 'y', 'width', 'height'];
	const phaseOrder = direction === 'enter'
		? new Map([['static', 0], ['mounting', 1], ['ready', 2]])
		: new Map([['ready', 0], ['static', 1]]);
	const violations = [];
	let highestPhase = -1;
	for (const [frameIndex, frame] of frames.entries()) {
		const order = phaseOrder.get(frame.phase);
		if (order === undefined) {
			violations.push({ frameIndex, phase: frame.phase, issue: 'no genuinely visible Note surface' });
		} else if (order < highestPhase) {
			violations.push({ frameIndex, phase: frame.phase, issue: 'visible surface regressed after advancing', highestPhase });
		} else {
			highestPhase = order;
		}
		if (frame.noteEditing && (frame.visibleResizeHandles !== 0 || frame.liveConnectionHandles !== 0)) {
			violations.push({
				frameIndex,
				phase: frame.phase,
				issue: 'structural card chrome remained visible after Note editing began',
				visibleResizeHandles: frame.visibleResizeHandles,
				liveConnectionHandles: frame.liveConnectionHandles
			});
		}
		if (frame.originalPreviewIdentity !== expectedPreviewIdentity || !frame.staticPreviewIsOriginal) {
			violations.push({
				frameIndex,
				phase: frame.phase,
				issue: 'original static preview identity changed',
				expected: expectedPreviewIdentity,
				actual: frame.originalPreviewIdentity,
				staticPreviewIsOriginal: frame.staticPreviewIsOriginal
			});
		}
		if ((frame.phase === 'mounting' || frame.phase === 'ready')
			&& (frame.fallbackIdentity !== expectedPreviewIdentity || !frame.fallbackIsOriginalPreview)) {
			violations.push({
				frameIndex,
				phase: frame.phase,
				issue: 'editor fallback did not reuse the original static preview',
				expected: expectedPreviewIdentity,
				actual: frame.fallbackIdentity,
				fallbackIsOriginalPreview: frame.fallbackIsOriginalPreview
			});
		}
		if (!frame.body || !frame.textBlock) {
			violations.push({ frameIndex, phase: frame.phase, issue: 'missing visible content geometry' });
			continue;
		}
		if (!frame.surface || Math.abs(frame.surface.scrollTop - baseline.surface.scrollTop) > 1) {
			violations.push({
				frameIndex,
				phase: frame.phase,
				issue: 'visible surface scroll position changed',
				expected: baseline.surface.scrollTop,
				actual: frame.surface?.scrollTop
			});
		}
		const pixelRatio = Math.max(baseline.devicePixelRatio, frame.devicePixelRatio);
		for (const [area, actual, expected] of [['body', frame.body, baseline.body], ['textBlock', frame.textBlock, baseline.textBlock]]) {
			for (const field of numericFields) {
				const physicalDelta = Math.abs(actual[field] - expected[field]) * pixelRatio;
				if (physicalDelta > 1) {
					violations.push({ frameIndex, phase: frame.phase, area, field, physicalDelta, expected: expected[field], actual: actual[field] });
				}
			}
		}
		for (const token of tokens) {
			const expected = baselineTokens.get(token);
			const actual = frame.tokens.find(metric => metric.token === token);
			if (!expected?.font || !actual?.font) {
				violations.push({ frameIndex, phase: frame.phase, token, issue: 'missing visible token or font metrics' });
				continue;
			}
			for (const field of numericFields) {
				const physicalDelta = Math.abs(Number(actual[field]) - Number(expected[field])) * pixelRatio;
				if (!Number.isFinite(physicalDelta) || physicalDelta > 1) {
					violations.push({ frameIndex, phase: frame.phase, token, field, physicalDelta, expected: expected[field], actual: actual[field] });
				}
			}
			if (JSON.stringify(actual.font) !== JSON.stringify(expected.font)) {
				violations.push({ frameIndex, phase: frame.phase, token, issue: 'font changed', expected: expected.font, actual: actual.font });
			}
		}
	}
	if (violations.length > 0) {
		const phases = frames.map(frame => frame.phase).filter((phase, index, all) => index === 0 || phase !== all[index - 1]);
		throw new Error('Canvas Note ' + direction + ' transition exposed a visible geometry or font jump: ' + JSON.stringify({
			frameCount: frames.length,
			phases,
			surfaces: frames.map(frame => ({ phase: frame.phase, surface: frame.surface })),
			violationCount: violations.length,
			violations: violations.slice(0, 12)
		}));
	}
}

function assertCanvasNoteEditTransitionFrames(result, tokens, expectedPreviewIdentity) {
	assertCanvasNoteTransitionFrames(result, tokens, expectedPreviewIdentity, 'enter');
}

function assertCanvasMalformedParagraphTransition(result, exactParagraph) {
	const baselineFrame = result.frames.find(frame => frame.phase === 'static' && frame.exactParagraph);
	const firstReadyFrame = result.frames.find(frame => frame.phase === 'ready' && frame.exactParagraph);
	const baseline = baselineFrame?.exactParagraph;
	const firstReady = firstReadyFrame?.exactParagraph;
	if (!baseline || !firstReady
		|| !baseline.fullyVisible
		|| !firstReady.fullyVisible
		|| baseline.text !== exactParagraph
		|| firstReady.text !== exactParagraph
		|| baseline.visibleText !== exactParagraph
		|| firstReady.visibleText !== exactParagraph
		|| baseline.starCount !== 2
		|| firstReady.starCount !== 2) {
		throw new Error(`Canvas Note malformed emphasis changed between its static and first live frame: ${JSON.stringify({ baseline, firstReady })}`);
	}
	if (baseline.glyphs.length !== firstReady.glyphs.length) {
		throw new Error(`Canvas Note malformed emphasis changed its visible glyph count: ${JSON.stringify({ baseline: baseline.glyphs.length, firstReady: firstReady.glyphs.length })}`);
	}
	const pixelRatio = Math.max(baselineFrame.devicePixelRatio, firstReadyFrame.devicePixelRatio);
	const numericFields = ['x', 'y', 'width', 'height'];
	const mismatches = [];
	for (const field of numericFields) {
		const physicalDelta = Math.abs(baseline.rect[field] - firstReady.rect[field]) * pixelRatio;
		if (physicalDelta > 1) {
			mismatches.push({ area: 'paragraph', field, physicalDelta, baseline: baseline.rect[field], firstReady: firstReady.rect[field] });
		}
	}
	for (let index = 0; index < baseline.glyphs.length; index++) {
		const expected = baseline.glyphs[index];
		const actual = firstReady.glyphs[index];
		if (expected.character !== actual.character
			|| expected.fontFamily !== actual.fontFamily
			|| expected.fontSize !== actual.fontSize
			|| expected.fontWeight !== actual.fontWeight
			|| expected.fontStyle !== actual.fontStyle
			|| expected.lineHeight !== actual.lineHeight
			|| expected.textDecorationLine !== actual.textDecorationLine) {
			mismatches.push({ area: 'glyph-style', index, expected, actual });
			continue;
		}
		for (const field of numericFields) {
			const physicalDelta = Math.abs(expected[field] - actual[field]) * pixelRatio;
			if (physicalDelta > 1) {
				mismatches.push({ area: 'glyph-geometry', index, character: expected.character, field, physicalDelta, baseline: expected[field], firstReady: actual[field] });
			}
		}
	}
	if (mismatches.length > 0) {
		throw new Error(`Canvas Note malformed emphasis changed visible geometry on its first live frame: ${JSON.stringify({ mismatchCount: mismatches.length, mismatches: mismatches.slice(0, 12) })}`);
	}
}

async function startCanvasNoteExitTransitionProbe(note, tokens, expectedPreviewIdentity) {
	await startCanvasNoteEditTransitionProbe(note, tokens, expectedPreviewIdentity, 'exit');
}

async function finishCanvasNoteExitTransitionProbe(page) {
	return finishCanvasNoteEditTransitionProbe(page);
}

async function cancelCanvasNoteExitTransitionProbe(page) {
	await cancelCanvasNoteEditTransitionProbe(page);
}

function assertCanvasNoteExitTransitionFrames(result, tokens, expectedPreviewIdentity) {
	assertCanvasNoteTransitionFrames(result, tokens, expectedPreviewIdentity, 'exit');
}

async function installCanvasNoteZoomProbe(surface, mode) {
	return surface.evaluate((root, expectedMode) => {
		type ZoomProbe = {
			root: HTMLElement;
			card: HTMLElement;
			editable?: HTMLElement;
			mutationCount: number;
			scrollEvents: number;
			observer: MutationObserver;
			dispose: () => void;
		};
		const scope = window as typeof window & { __basehalfSmokeNoteZoomProbe?: ZoomProbe };
		scope.__basehalfSmokeNoteZoomProbe?.dispose();
		const card = root.closest('.basehalf-canvas-card');
		const editable = expectedMode === 'active' ? root.querySelector(':scope > .ProseMirror') : undefined;
		if (!(root instanceof HTMLElement)
			|| !(card instanceof HTMLElement)
			|| (expectedMode === 'active' && !(editable instanceof HTMLElement))) {
			throw new Error(`Could not install the ${expectedMode} Canvas Note zoom probe`);
		}
		const identity = `zoom-${expectedMode}-${Date.now()}-${Math.random()}`;
		const cardIdentity = `${identity}-card`;
		const editableIdentity = `${identity}-editable`;
		root.setAttribute('data-smoke-zoom-surface-identity', identity);
		card.setAttribute('data-smoke-zoom-card-identity', cardIdentity);
		editable?.setAttribute('data-smoke-zoom-editable-identity', editableIdentity);
		const probe: ZoomProbe = {
			root,
			card,
			editable: editable instanceof HTMLElement ? editable : undefined,
			mutationCount: 0,
			scrollEvents: 0,
			observer: undefined!,
			dispose: () => undefined
		};
		const observer = new MutationObserver(records => probe.mutationCount += records.length);
		const onScroll = () => probe.scrollEvents++;
		observer.observe(root, { attributes: true, characterData: true, childList: true, subtree: true });
		root.addEventListener('scroll', onScroll, { passive: true });
		probe.observer = observer;
		probe.dispose = () => {
			probe.mutationCount += observer.takeRecords().length;
			observer.disconnect();
			root.removeEventListener('scroll', onScroll);
			if (root.getAttribute('data-smoke-zoom-surface-identity') === identity) {
				root.removeAttribute('data-smoke-zoom-surface-identity');
			}
			if (card.getAttribute('data-smoke-zoom-card-identity') === cardIdentity) {
				card.removeAttribute('data-smoke-zoom-card-identity');
			}
			if (editable?.getAttribute('data-smoke-zoom-editable-identity') === editableIdentity) {
				editable.removeAttribute('data-smoke-zoom-editable-identity');
			}
		};
		scope.__basehalfSmokeNoteZoomProbe = probe;
		return { identity, cardIdentity, editableIdentity: probe.editable ? editableIdentity : undefined };
	}, mode);
}

async function captureCanvasNoteZoomState(page, mode, tokens, identities) {
	return page.evaluate(({ expectedMode, expectedTokens, identities }) => {
		type ZoomProbe = { root: HTMLElement; card: HTMLElement; editable?: HTMLElement };
		const scope = window as typeof window & { __basehalfSmokeNoteZoomProbe?: ZoomProbe };
		const probe = scope.__basehalfSmokeNoteZoomProbe;
		if (!probe || !probe.card.contains(probe.root)) {
			throw new Error('Canvas Note zoom probe lost its original surface');
		}
		const surface = probe.root;
		const card = probe.card;
		const editable = probe.editable;
		const body = card.querySelector('.basehalf-canvas-card-body');
		const workbench = card.closest('.basehalf-canvas-workbench');
		if (!(body instanceof HTMLElement) || !(workbench instanceof HTMLElement)) {
			throw new Error('Canvas Note zoom probe lost its card body or workbench');
		}
		const cardBounds = card.getBoundingClientRect();
		const bodyBounds = body.getBoundingClientRect();
		const surfaceBounds = surface.getBoundingClientRect();
		const scale = card.offsetWidth > 0 ? cardBounds.width / card.offsetWidth : Number.NaN;
		const logicalRect = (bounds: DOMRect) => ({
			x: (bounds.left - bodyBounds.left) / scale,
			y: (bounds.top - bodyBounds.top) / scale,
			width: bounds.width / scale,
			height: bounds.height / scale
		});
		const tokens = expectedTokens.map(token => {
			const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
			let node;
			while ((node = walker.nextNode())) {
				const offset = node.textContent?.indexOf(token) ?? -1;
				if (offset < 0) {
					continue;
				}
				const range = document.createRange();
				range.setStart(node, offset);
				range.setEnd(node, offset + token.length);
				return { token, ...logicalRect(range.getBoundingClientRect()) };
			}
			return { token };
		});
		const selection = document.getSelection();
		const selectionInside = editable instanceof HTMLElement
			&& selection?.anchorNode !== null
			&& selection?.focusNode !== null
			&& editable.contains(selection.anchorNode)
			&& editable.contains(selection.focusNode);
		const documentOffset = (node: Node, offset: number) => {
			const range = document.createRange();
			range.selectNodeContents(editable!);
			range.setEnd(node, offset);
			return range.toString().length;
		};
		const unitFor = (node: Node | null) => {
			const element = node?.nodeType === Node.ELEMENT_NODE ? node as Element : node?.parentElement;
			return element?.closest('[data-basehalf-markdown-unit]')?.getAttribute('data-basehalf-markdown-unit');
		};
		let caret;
		if (selectionInside && selection?.isCollapsed && selection.anchorNode?.nodeType === Node.TEXT_NODE && selection.anchorOffset > 0) {
			const range = document.createRange();
			range.setStart(selection.anchorNode, selection.anchorOffset - 1);
			range.setEnd(selection.anchorNode, selection.anchorOffset);
			caret = logicalRect(range.getBoundingClientRect());
		}
		const surfaceStyle = getComputedStyle(surface);
		const scrollbarStyle = getComputedStyle(surface, '::-webkit-scrollbar');
		return {
			mode: expectedMode,
			zoom: Number(workbench.dataset.zoom),
			scale,
			devicePixelRatio: window.devicePixelRatio,
			cardIdentity: card.getAttribute('data-smoke-zoom-card-identity'),
			surfaceIdentity: surface.getAttribute('data-smoke-zoom-surface-identity'),
			editableIdentity: editable?.getAttribute('data-smoke-zoom-editable-identity'),
			identities,
			previewLevel: card.dataset.previewLevel,
			noteEditing: card.dataset.noteEditing,
			hostCount: card.querySelectorAll('[data-testid^="canvas-note-editor-"]').length,
			body: { width: bodyBounds.width / scale, height: bodyBounds.height / scale },
			surface: {
				...logicalRect(surfaceBounds),
				clientWidth: surface.clientWidth,
				clientHeight: surface.clientHeight,
				scrollWidth: surface.scrollWidth,
				scrollHeight: surface.scrollHeight,
				scrollLeft: surface.scrollLeft,
				scrollTop: surface.scrollTop,
				webkitScrollbarWidth: scrollbarStyle.width,
				overflowY: surfaceStyle.overflowY,
				paddingLeft: surfaceStyle.paddingLeft,
				paddingRight: surfaceStyle.paddingRight
			},
			text: surface.textContent ?? '',
			html: surface.innerHTML,
			tokens,
			focused: editable instanceof HTMLElement
				? document.activeElement === editable || editable.contains(document.activeElement)
				: document.activeElement === surface || surface.contains(document.activeElement),
			selectionInside: selectionInside === true,
			selection: selectionInside && selection ? {
				collapsed: selection.isCollapsed,
				anchor: documentOffset(selection.anchorNode!, selection.anchorOffset),
				head: documentOffset(selection.focusNode!, selection.focusOffset),
				anchorUnit: unitFor(selection.anchorNode),
				headUnit: unitFor(selection.focusNode)
			} : undefined,
			caret
		};
	}, { expectedMode: mode, expectedTokens: tokens, identities });
}

async function finishCanvasNoteZoomProbe(page) {
	return page.evaluate(() => {
		type ZoomProbe = { mutationCount: number; scrollEvents: number; observer: MutationObserver; dispose: () => void };
		const scope = window as typeof window & { __basehalfSmokeNoteZoomProbe?: ZoomProbe };
		const probe = scope.__basehalfSmokeNoteZoomProbe;
		if (!probe) {
			throw new Error('Canvas Note zoom probe was not installed');
		}
		probe.mutationCount += probe.observer.takeRecords().length;
		const result = { mutationCount: probe.mutationCount, scrollEvents: probe.scrollEvents };
		probe.dispose();
		if (scope.__basehalfSmokeNoteZoomProbe === probe) {
			delete scope.__basehalfSmokeNoteZoomProbe;
		}
		return result;
	});
}

async function waitForCanvasNoteZoom(page, target) {
	await page.waitForFunction(expected => {
		const workbench = document.querySelector('.basehalf-canvas-workbench');
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
		if (!(workbench instanceof HTMLElement) || !(card instanceof HTMLElement) || card.offsetWidth <= 0) {
			return false;
		}
		const renderedScale = card.getBoundingClientRect().width / card.offsetWidth;
		return Math.abs(Number(workbench.dataset.zoom) - expected) <= 0.001
			&& Math.abs(renderedScale - expected) <= 0.005;
	}, target, { timeout: 10_000 });
}

function assertCanvasNoteZoomStates(states, mode, identities) {
	const expectedZooms = [1, 0.7, 0.2, 1];
	if (states.length !== expectedZooms.length) {
		throw new Error(`Canvas Note ${mode} zoom probe returned an unexpected state count: ${states.length}`);
	}
	const baseline = states[0];
	const exactSurfaceFields = ['clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight'];
	const approximateSurfaceFields = ['x', 'y', 'width', 'height', 'scrollLeft', 'scrollTop'];
	const exactSurfaceStyles = ['webkitScrollbarWidth', 'overflowY', 'paddingLeft', 'paddingRight'];
	const logicalRectFields = ['x', 'y', 'width', 'height'];
	const violations = [];
	for (let index = 0; index < states.length; index++) {
		const state = states[index];
		const expectedZoom = expectedZooms[index];
		if (Math.abs(state.zoom - expectedZoom) > 0.001 || Math.abs(state.scale - expectedZoom) > 0.005) {
			violations.push({ index, issue: 'zoom transform did not settle', expectedZoom, zoom: state.zoom, scale: state.scale });
		}
		if (state.cardIdentity !== identities.cardIdentity
			|| state.surfaceIdentity !== identities.identity
			|| state.editableIdentity !== identities.editableIdentity) {
			violations.push({ index, issue: 'zoom replaced a retained DOM owner', state, identities });
		}
		if (state.previewLevel !== 'preview'
			|| (mode === 'active' && (state.noteEditing !== 'true' || state.hostCount !== 1))
			|| (mode === 'resting' && (state.noteEditing !== undefined || state.hostCount !== 0))) {
			violations.push({ index, issue: 'zoom changed the Note projection state', previewLevel: state.previewLevel, noteEditing: state.noteEditing, hostCount: state.hostCount });
		}
		if (state.text !== baseline.text || state.html !== baseline.html) {
			violations.push({ index, issue: 'zoom mutated Note text or HTML', textMatches: state.text === baseline.text, htmlMatches: state.html === baseline.html });
		}
		for (const field of exactSurfaceFields) {
			if (state.surface[field] !== baseline.surface[field]) {
				violations.push({ index, area: 'surface', field, expected: baseline.surface[field], actual: state.surface[field] });
			}
		}
		for (const field of approximateSurfaceFields) {
			if (Math.abs(state.surface[field] - baseline.surface[field]) > 1) {
				violations.push({ index, area: 'surface', field, expected: baseline.surface[field], actual: state.surface[field] });
			}
		}
		for (const field of exactSurfaceStyles) {
			if (state.surface[field] !== baseline.surface[field]) {
				violations.push({ index, area: 'surface-style', field, expected: baseline.surface[field], actual: state.surface[field] });
			}
		}
		const logicalScrollbarWidth = Number.parseFloat(state.surface.webkitScrollbarWidth);
		if ((mode === 'active' && (state.surface.overflowY !== 'scroll'
			|| !Number.isFinite(logicalScrollbarWidth)
			|| logicalScrollbarWidth < 8
			|| logicalScrollbarWidth > 12))
			|| (mode === 'resting' && state.surface.overflowY !== 'hidden')) {
			violations.push({ index, issue: 'zoom changed the fixed logical scroll contract', surface: state.surface });
		}
		for (const field of ['width', 'height']) {
			if (Math.abs(state.body[field] - baseline.body[field]) * state.scale * state.devicePixelRatio > 1) {
				violations.push({ index, area: 'body', field, expected: baseline.body[field], actual: state.body[field] });
			}
		}
		for (const expectedToken of baseline.tokens) {
			const actualToken = state.tokens.find(token => token.token === expectedToken.token);
			if (!actualToken || logicalRectFields.some(field => !Number.isFinite(actualToken[field]))) {
				violations.push({ index, token: expectedToken.token, issue: 'zoom lost a logical token range' });
				continue;
			}
			for (const field of logicalRectFields) {
				const physicalDelta = Math.abs(actualToken[field] - expectedToken[field]) * state.scale * state.devicePixelRatio;
				if (physicalDelta > 1) {
					violations.push({ index, token: expectedToken.token, field, physicalDelta, expected: expectedToken[field], actual: actualToken[field] });
				}
			}
		}
		if (mode === 'active') {
			if (!state.focused || !state.selectionInside || !state.selection?.collapsed
				|| JSON.stringify(state.selection) !== JSON.stringify(baseline.selection)) {
				violations.push({ index, issue: 'zoom moved the active caret or focus', expected: baseline.selection, actual: state.selection, focused: state.focused, selectionInside: state.selectionInside });
			}
			if (!baseline.caret || !state.caret) {
				violations.push({ index, issue: 'zoom lost the caret geometry', expected: baseline.caret, actual: state.caret });
			} else {
				for (const field of logicalRectFields) {
					const physicalDelta = Math.abs(state.caret[field] - baseline.caret[field]) * state.scale * state.devicePixelRatio;
					if (physicalDelta > 1) {
						violations.push({ index, area: 'caret', field, physicalDelta, expected: baseline.caret[field], actual: state.caret[field] });
					}
				}
			}
		} else if (state.focused || state.selectionInside) {
			violations.push({ index, issue: 'resting zoom created an editing focus or selection', focused: state.focused, selectionInside: state.selectionInside });
		}
	}
	if (violations.length > 0) {
		throw new Error(`Canvas Note ${mode} zoom changed fixed logical layout or editor state: ${JSON.stringify({ violationCount: violations.length, violations: violations.slice(0, 16), states })}`);
	}
}

async function assertCanvasNoteProgrammaticZoomLayoutInvariantSequence(page, surface, mode, tokens) {
	// Exercise the menu command without transferring DOM focus to its trigger or
	// dialog. Pointer ownership is covered by the controls tests; this probe
	// isolates the invariant that zoom itself cannot reflow or mutate a Note.
	await zoomCanvas(page, 'reset', { preserveFocus: true });
	await waitForCanvasNoteZoom(page, 1);
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	const identities = await installCanvasNoteZoomProbe(surface, mode);
	const states = [];
	let sequenceError;
	let cleanupError;
	let probeResult;
	try {
		states.push(await captureCanvasNoteZoomState(page, mode, tokens, identities));
		for (const target of [0.7, 0.2]) {
			while (Number(await page.locator('.basehalf-canvas-workbench').getAttribute('data-zoom')) > target + 0.001) {
				const current = Number(await page.locator('.basehalf-canvas-workbench').getAttribute('data-zoom'));
				const next = Math.max(target, Math.round((current - 0.1) * 10) / 10);
				if (!await zoomCanvas(page, 'out', { preserveFocus: true })) {
					throw new Error(`Canvas zoom reached its minimum before ${target}`);
				}
				await waitForCanvasNoteZoom(page, next);
			}
			states.push(await captureCanvasNoteZoomState(page, mode, tokens, identities));
		}
		await zoomCanvas(page, 'reset', { preserveFocus: true });
		await waitForCanvasNoteZoom(page, 1);
		states.push(await captureCanvasNoteZoomState(page, mode, tokens, identities));
	} catch (error) {
		sequenceError = error;
	} finally {
		try {
			if (Number(await page.locator('.basehalf-canvas-workbench').getAttribute('data-zoom')) !== 1) {
				await zoomCanvas(page, 'reset', { preserveFocus: true });
				await waitForCanvasNoteZoom(page, 1).catch(() => undefined);
			}
		} catch (error) {
			cleanupError = error;
		}
		try {
			probeResult = await finishCanvasNoteZoomProbe(page);
		} catch (error) {
			cleanupError ??= error;
		}
	}
	if (sequenceError) {
		throw sequenceError;
	}
	if (cleanupError) {
		throw cleanupError;
	}
	assertCanvasNoteZoomStates(states, mode, identities);
	if (probeResult.mutationCount !== 0 || probeResult.scrollEvents !== 0) {
		throw new Error(`Canvas Note ${mode} zoom caused internal DOM or scroll mutation: ${JSON.stringify(probeResult)}`);
	}
}

// The selection agents can see: what the user selected is recorded in
// .bh/cache/selection.yaml while the current skill is installed, the status
// bar under the Agent Area shows it, and nothing reaches git.
async function assertAgentSeesSelection(page) {
	await closeCardDetailIfOpen(page);
	const recordPath = path.join(workspacePath, '.bh', 'cache', 'selection.yaml');
	const skillPath = path.join(smokeHome, '.claude', 'skills', 'basehalf', 'SKILL.md');
	const header = '# What the user selected last in BaseHalf. BaseHalf rewrites this file; see the basehalf skill.\n';
	const readRecord = () => {
		try {
			return fs.readFileSync(recordPath, 'utf8');
		} catch {
			return undefined;
		}
	};
	const statusText = () => page.evaluate(() => document.querySelector('.basehalf-agent-selection-text')?.textContent ?? null);
	const expectSelection = async (record, shown, what) => {
		await waitUntil(() => readRecord() === record, what, 10_000).catch(error => {
			throw new Error(`${what}: the record is ${JSON.stringify(readRecord())}`, { cause: error });
		});
		await page.waitForFunction(text => (document.querySelector('.basehalf-agent-selection-text')?.textContent ?? null) === text, shown, { timeout: 10_000 }).catch(async error => {
			throw new Error(`${what}: the status bar shows ${JSON.stringify(await statusText())}`, { cause: error });
		});
	};
	const pane = page.locator('.react-flow__pane');
	const readme = page.locator('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
	const src = page.locator('.basehalf-canvas-card[data-basehalf-card-path="src"]');

	// Without the skill there is no record and nothing in the status bar.
	await pane.click({ position: { x: 16, y: 16 } });
	await page.waitForTimeout(500);
	if (readRecord() !== undefined || await statusText() !== null) {
		throw new Error(`Without the skill, nothing may be recorded or shown: ${JSON.stringify({ record: readRecord(), shown: await statusText() })}`);
	}

	await runCommand(page, 'BaseHalf: Install Agent Skill');
	await waitUntil(() => fs.existsSync(skillPath), 'the skill in the window\'s home folder', 10_000);
	await zoomCanvas(page, 'reset');
	await readme.waitFor({ state: 'visible', timeout: 20_000 });
	await src.waitFor({ state: 'visible', timeout: 20_000 });
	await centerCanvasCards(page, [readme, src]);
	await pane.click({ position: { x: 16, y: 16 } });
	await expectSelection(`${header}selected: "folder"\npath: "."\n`, path.basename(workspacePath), 'nothing selected records the folder of the canvas');

	// The entry is in the status bar and has no command. With the Agent Area
	// hidden it is as wide as its text; with the Agent Area shown it starts
	// under the Agent Area's left edge.
	const measureEntry = () => page.evaluate(() => {
		const content = document.querySelector('.basehalf-agent-selection');
		const item = content?.parentElement;
		const statusbar = document.querySelector('.part.statusbar');
		const agentArea = document.querySelector('.part.auxiliarybar');
		const label = item?.querySelector('.statusbar-item-label');
		const text = document.querySelector('.basehalf-agent-selection-text')?.getBoundingClientRect();
		return {
			inStatusbar: !!item && !!statusbar?.contains(item),
			left: item?.getBoundingClientRect().left,
			width: item?.getBoundingClientRect().width,
			textWidth: text?.width,
			agentAreaLeft: agentArea instanceof HTMLElement && agentArea.offsetParent !== null ? agentArea.getBoundingClientRect().left : undefined,
			labelShown: label instanceof HTMLElement && getComputedStyle(label).display !== 'none',
			cursor: content ? getComputedStyle(content).cursor : undefined
		};
	});
	const agentArea = page.locator('.part.auxiliarybar');
	const agentAreaWasShown = await agentArea.isVisible();
	if (agentAreaWasShown) {
		await runCommand(page, 'Toggle Agent Area');
		await agentArea.waitFor({ state: 'hidden', timeout: 10_000 });
	}
	await page.waitForTimeout(300);
	const alone = await measureEntry();
	await runCommand(page, 'Toggle Agent Area');
	await agentArea.waitFor({ state: 'visible', timeout: 10_000 });
	await page.waitForTimeout(500);
	const underAgentArea = await measureEntry();
	if (!agentAreaWasShown) {
		await runCommand(page, 'Toggle Agent Area');
		await agentArea.waitFor({ state: 'hidden', timeout: 10_000 });
	}
	// Under the Agent Area the entry is as wide as its text and takes at most
	// 60% of the room there, from its right end.
	const room = underAgentArea.agentAreaLeft === undefined ? 0 : underAgentArea.left + underAgentArea.width - (underAgentArea.agentAreaLeft + 8);
	if (!alone.inStatusbar || alone.labelShown || alone.cursor !== 'default' || !(alone.textWidth > 20) || alone.width > 241
		|| !underAgentArea.inStatusbar || underAgentArea.agentAreaLeft === undefined || !(underAgentArea.textWidth > 20)
		|| underAgentArea.width > room * 0.6 + 1 || underAgentArea.left < underAgentArea.agentAreaLeft + 8) {
		throw new Error(`The entry must be in the status bar with no command, show its text, and stay in the right part of the room under the Agent Area: ${JSON.stringify({ alone, underAgentArea, room })}`);
	}

	await readme.click();
	await waitForCanvasCardSelection(page, 'README.md');
	await expectSelection(`${header}selected: "card"\npath: "README.md"\n`, 'README', 'one selected card is recorded by its path and shown by its name');

	// Earlier steps can leave README.md over part of another card: press src
	// where it is on top, away from its name, which selects nothing.
	const srcPoint = await src.evaluate(card => {
		const box = card.getBoundingClientRect();
		for (let y = box.top + 4; y < box.bottom - 4; y += 6) {
			for (let x = box.left + 4; x < box.right - 4; x += 6) {
				const hit = document.elementFromPoint(x, y);
				if (hit && card.contains(hit) && !hit.closest('.basehalf-canvas-card-caption')) {
					return { x, y };
				}
			}
		}
		return undefined;
	});
	if (!srcPoint) {
		throw new Error('No part of the src card is on top');
	}
	await page.keyboard.down('Shift');
	await page.mouse.click(srcPoint.x, srcPoint.y);
	await page.keyboard.up('Shift');
	await expectSelection(`${header}selected: "cards"\npaths:\n  - "src"\n  - "README.md"\n`, '2 cards selected', 'two selected cards are recorded in list order and shown by their number');

	await pane.click({ position: { x: 16, y: 16 } });
	await expectSelection(`${header}selected: "folder"\npath: "."\n`, path.basename(workspacePath), 'a click on empty canvas records the folder again');

	// Text selected in the note on its card: the lines it is on, and its text as the note shows it.
	await readme.locator('.bh-md-preview p', { hasText: 'soft-line-beta' }).first().dblclick();
	const editor = await waitForCanvasNoteInlineEditor(page, 'README.md');
	const ends = await editor.editable.evaluate(root => {
		const pointOf = (token, atEnd) => {
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
			let node;
			while ((node = walker.nextNode())) {
				const offset = node.textContent?.indexOf(token) ?? -1;
				if (offset >= 0) {
					const range = document.createRange();
					range.setStart(node, offset + (atEnd ? token.length : 0));
					range.collapse(true);
					const box = range.getClientRects()[0] ?? range.getBoundingClientRect();
					return { x: box.left + (atEnd ? 1 : -1), y: box.top + box.height / 2 };
				}
			}
			throw new Error(`No text ${token} in the note editor`);
		};
		return { from: pointOf('soft-line-beta', false), to: pointOf('soft-line-gamma', true) };
	});
	await page.mouse.move(ends.from.x + 1, ends.from.y);
	await page.mouse.down();
	await page.mouse.move(ends.to.x, ends.to.y, { steps: 8 });
	await page.mouse.up();
	const textRecord = `${header}selected: "text"\npath: "README.md"\nfirst_line: 4\nlast_line: 5\ntext: "soft-line-beta\\nsoft-line-gamma"\n`;
	await expectSelection(textRecord, 'soft-line-beta soft-line-gamma', 'selected text is recorded with its lines and shown by its start');

	// Focus elsewhere in the window keeps the record, and the note keeps showing the selection.
	// As when the user clicks into the Agent Area to ask an agent: its
	// terminal, or else the sidebar's list, takes focus. Neither opens anything.
	const movedTo = await page.evaluate(() => {
		const target = document.querySelector('.part.auxiliarybar .xterm-helper-textarea') ?? document.querySelector('.part.sidebar .monaco-list');
		if (!(target instanceof HTMLElement)) {
			return undefined;
		}
		target.focus();
		return target.className;
	});
	if (!movedTo) {
		throw new Error('Nothing outside the note could take focus');
	}
	await page.waitForTimeout(600);
	const kept = await editor.editable.evaluate(root => ({
		focused: root.contains(document.activeElement),
		highlighted: Array.from(root.querySelectorAll('.basehalf-canvas-markdown-inline-inactive-selection')).map(element => element.textContent).join('|')
	}));
	if (readRecord() !== textRecord || kept.focused || !kept.highlighted.includes('soft-line-beta') || !kept.highlighted.includes('soft-line-gamma')) {
		throw new Error(`Focus elsewhere must keep the record and the highlight: ${JSON.stringify({ record: readRecord(), ...kept })}`);
	}

	// An agent writes the note while the user is elsewhere: the selection
	// follows its text, keeps its highlight, and the record its new lines.
	const readmePath = path.join(workspacePath, 'README.md');
	const readmeBefore = fs.readFileSync(readmePath, 'utf8');
	if (!readmeBefore.startsWith('# Smoke README\n\n')) {
		throw new Error('The README fixture changed; this step writes above its first paragraph');
	}
	fs.writeFileSync(readmePath, readmeBefore.replace('# Smoke README\n\n', '# Smoke README\n\nAdded by an agent.\n\n'), 'utf8');
	const movedRecord = `${header}selected: "text"\npath: "README.md"\nfirst_line: 6\nlast_line: 7\ntext: "soft-line-beta\\nsoft-line-gamma"\n`;
	await expectSelection(movedRecord, 'soft-line-beta soft-line-gamma', 'the selection follows a write made elsewhere to lines 6 and 7');
	const afterWrite = await editor.editable.evaluate(root => ({
		focused: root.contains(document.activeElement),
		highlighted: Array.from(root.querySelectorAll('.basehalf-canvas-markdown-inline-inactive-selection')).map(element => element.textContent).join('|')
	}));
	if (afterWrite.focused || !afterWrite.highlighted.includes('soft-line-beta') || !afterWrite.highlighted.includes('soft-line-gamma')) {
		throw new Error(`After a write made elsewhere the note must still show the selection: ${JSON.stringify(afterWrite)}`);
	}
	fs.writeFileSync(readmePath, readmeBefore, 'utf8');
	await expectSelection(textRecord, 'soft-line-beta soft-line-gamma', 'the selection follows the note back to lines 4 and 5');

	// Escape ends the editing and leaves the card selected. Focus returns to
	// the note without a click, so the text is still selected when Escape comes.
	await editor.editable.evaluate(root => (root as HTMLElement).focus());
	await page.keyboard.press('Escape');
	await editor.host.waitFor({ state: 'detached', timeout: 15_000 });
	await expectSelection(`${header}selected: "card"\npath: "README.md"\n`, 'README', 'the card stays recorded after editing ends');

	// Card Detail's rich projection: selected text is recorded with its line,
	// stays drawn in grey while focus is elsewhere, and a press on the page
	// around the document, where no caret goes, ends the selection.
	await quickOpen(page, 'README.md');
	await assertCardDetail(page, 'README.md');
	await expectSelection(`${header}selected: "card"\npath: "README.md"\n`, 'README', 'Card Detail records its card');
	const frame = await activeMarkdownRichFrame(page);
	const frameBox = await (await frame.frameElement()).boundingBox();
	const word = await frame.evaluate(() => {
		const walker = document.createTreeWalker(document.querySelector('.ProseMirror') ?? document.body, NodeFilter.SHOW_TEXT);
		let node;
		while ((node = walker.nextNode())) {
			const offset = node.textContent?.indexOf('soft-line-beta') ?? -1;
			if (offset >= 0) {
				const range = document.createRange();
				range.setStart(node, offset);
				range.setEnd(node, offset + 'soft-line-beta'.length);
				const box = range.getBoundingClientRect();
				const scroll = document.querySelector('.basehalf-markdown-rich-scroll')?.getBoundingClientRect();
				const page = document.querySelector('.basehalf-markdown-rich-page')?.getBoundingClientRect();
				return { left: box.left, right: box.right, y: box.top + box.height / 2, blankX: scroll && page ? (scroll.left + page.left) / 2 : 4 };
			}
		}
		throw new Error('No soft-line-beta in Card Detail');
	});
	if (!frameBox) {
		throw new Error('Card Detail has no frame box');
	}
	await page.mouse.move(frameBox.x + word.left + 1, frameBox.y + word.y);
	await page.mouse.down();
	await page.mouse.move(frameBox.x + word.right - 1, frameBox.y + word.y, { steps: 6 });
	await page.mouse.up();
	await expectSelection(`${header}selected: "text"\npath: "README.md"\nfirst_line: 4\nlast_line: 4\ntext: "soft-line-beta"\n`, 'soft-line-beta', 'text selected in Card Detail is recorded with its line');
	const selectionStyle = () => frame.evaluate(() => {
		const paragraph = Array.from(document.querySelectorAll('.ProseMirror p')).find(element => element.textContent?.includes('soft-line-beta'));
		return {
			focused: document.querySelector('.ProseMirror')?.classList.contains('ProseMirror-focused'),
			background: paragraph ? getComputedStyle(paragraph, '::selection').backgroundColor : undefined
		};
	});
	const focusedSelection = await selectionStyle();
	await page.evaluate(() => {
		const elsewhere = document.querySelector('.part.auxiliarybar .xterm-helper-textarea') ?? document.querySelector('.part.sidebar .monaco-list');
		(elsewhere as HTMLElement | null)?.focus();
	});
	const unfocusedSelection = await selectionStyle();
	if (!focusedSelection.focused || unfocusedSelection.focused || !unfocusedSelection.background
		|| unfocusedSelection.background === focusedSelection.background || /^rgba\(0, 0, 0, 0\)$|^transparent$/.test(unfocusedSelection.background)) {
		throw new Error(`Card Detail must draw its selection in grey while focus is elsewhere: ${JSON.stringify({ focusedSelection, unfocusedSelection })}`);
	}
	await page.mouse.click(frameBox.x + word.blankX, frameBox.y + word.y);
	await expectSelection(`${header}selected: "card"\npath: "README.md"\n`, 'README', 'a press on the page around the document ends the selection');
	await closeCardDetailIfOpen(page);

	if (/\.bh\/cache/.test(gitStatusOfWorkspace())) {
		throw new Error(`The record must stay out of git: ${gitStatusOfWorkspace()}`);
	}

	// Without the skill the record and the entry go.
	await runCommand(page, 'BaseHalf: Remove Agent Skill');
	await waitUntil(() => readRecord() === undefined, 'the record to go with the skill', 10_000);
	await page.waitForFunction(() => document.querySelector('.basehalf-agent-selection-text') === null, null, { timeout: 10_000 });
	await pane.click({ position: { x: 16, y: 16 } });
}

async function assertCanvasNoteInlineWysiwygEditor(page) {
	await closeCardDetailIfOpen(page);
	const pane = page.locator('.react-flow__pane');
	const cardSelector = '.basehalf-canvas-card[data-basehalf-card-path="README.md"]';
	const note = page.locator(cardSelector);
	const folder = page.locator('.basehalf-canvas-card[data-basehalf-card-path="src"]');
	const readmePath = path.join(workspacePath, 'README.md');
	const originalMarkdown = fs.readFileSync(readmePath, 'utf8');
	const inlineEditor = canvasNoteInlineEditor(page, 'README.md');

	await zoomCanvas(page, 'reset');
	await note.waitFor({ state: 'visible', timeout: 20_000 });
	await folder.waitFor({ state: 'visible', timeout: 20_000 });
	await centerCanvasCards(page, [note]);
	await pane.click({ position: { x: 16, y: 16 } });

	const staticPreview = note.locator('.basehalf-canvas-card-preview .bh-md-preview').first();
	await staticPreview.waitFor({ state: 'visible', timeout: 20_000 });
	const staticPreviewIdentity = await staticPreview.evaluate(preview => {
		const identity = `preview-${Date.now()}-${Math.random()}`;
		preview.setAttribute('data-smoke-preview-identity', identity);
		return identity;
	});
	const staticPreviewHtml = await staticPreview.evaluate(preview => preview.innerHTML);
	const staticCardBox = await note.boundingBox();
	const softLineTokens = ['soft-line-alpha', 'soft-line-beta', 'soft-line-gamma'];
	const transitionTokens = ['Smoke README', ...softLineTokens];
	const visibleNeedle = 'soft-line-beta';
	const scrolledTransitionTokens = [CANVAS_MALFORMED_EMPHASIS_PARAGRAPH.slice(0, 12), CANVAS_MALFORMED_EMPHASIS_NEEDLE];
	const sourceParagraph = () => note.locator('.bh-md-preview p', { hasText: visibleNeedle }).first();
	const malformedParagraph = () => note.locator('.bh-md-preview p', { hasText: CANVAS_MALFORMED_EMPHASIS_NEEDLE }).first();
	const toolbar = page.getByRole('toolbar', { name: 'Actions for README.md', exact: true });
	const measureSoftLines = root => root.evaluate((content, tokens) => {
		const body = content.closest('.basehalf-canvas-card-body');
		if (!(body instanceof HTMLElement)) {
			throw new Error('Note content is not inside its card body');
		}
		const bodyBounds = body.getBoundingClientRect();
		return tokens.map(token => {
			const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
			let node;
			while ((node = walker.nextNode())) {
				const offset = node.textContent?.indexOf(token) ?? -1;
				if (offset < 0) {
					continue;
				}
				const range = document.createRange();
				range.setStart(node, offset);
				range.setEnd(node, offset + token.length);
				const bounds = range.getBoundingClientRect();
				return {
					x: bounds.left - bodyBounds.left,
					y: bounds.top - bodyBounds.top,
					height: bounds.height
				};
			}
			throw new Error(`Note content did not render soft-line token: ${token}`);
		});
	}, softLineTokens);
	const unselectedSoftLines = await measureSoftLines(staticPreview);
	if (new Set(unselectedSoftLines.map(metric => Math.round(metric.y * 10))).size !== softLineTokens.length) {
		throw new Error(`Static Note collapsed source soft lines: ${JSON.stringify(unselectedSoftLines)}`);
	}
	const restingCursor = await staticPreview.evaluate(preview => getComputedStyle(preview).cursor);
	if (restingCursor !== 'grab') {
		throw new Error(`A resting Note must remain a draggable card, got cursor=${restingCursor}`);
	}
	const restingChrome = await captureCanvasCardComputedChrome(note);
	assertCanvasCardChromeDoesNotUseIntent(restingChrome, 'resting Note pointer state');
	assertCanvasPointerChromeHasNoOutline(restingChrome, 'resting Note pointer state');
	if (restingChrome.cardSelected
		|| restingChrome.nodeSelected
		|| restingChrome.paintedResizeLines !== 0
		|| restingChrome.visibleResizeHandles !== 0
		|| restingChrome.interactiveResizeHandles !== 0) {
		throw new Error(`A resting Note exposed active structural chrome: ${JSON.stringify(restingChrome)}`);
	}
	const [restingGutterCardBefore, restingGutterBox] = await Promise.all([note.boundingBox(), staticPreview.boundingBox()]);
	const restingGutterScrollBefore = await staticPreview.evaluate(preview => preview.scrollTop);
	if (!restingGutterCardBefore || !restingGutterBox) {
		throw new Error('Could not measure the resting Note scrollbar gutter drag target');
	}
	const restingGutterPoint = {
		x: restingGutterBox.x + restingGutterBox.width - 5,
		y: restingGutterBox.y + Math.min(restingGutterBox.height - 16, Math.max(16, restingGutterBox.height * 0.78))
	};
	await page.mouse.move(restingGutterPoint.x, restingGutterPoint.y);
	await page.mouse.down();
	let coldDragChrome;
	try {
		await page.mouse.move(restingGutterPoint.x + 48, restingGutterPoint.y + 24, { steps: 8 });
		coldDragChrome = await page.waitForFunction(path => {
			const card = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"]`);
			const node = card?.closest('.react-flow__node');
			const canvas = card?.closest('.basehalf-canvas-cards');
			if (!(node instanceof HTMLElement)
				|| !(canvas instanceof HTMLElement)
				|| !node.classList.contains('dragging')
				|| canvas.dataset.nodeDragChrome !== 'dragging') {
				return false;
			}
			const surfaces = Array.from(document.querySelectorAll('.basehalf-canvas-adjacent-chrome'));
			const invalid = surfaces.filter(surface => {
				if (!(surface instanceof HTMLElement)) {
					return true;
				}
				const style = getComputedStyle(surface);
				const translateNumbers = style.translate === 'none'
					? []
					: style.translate.match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
				const translateY = translateNumbers.length >= 2 ? translateNumbers[1] : 0;
				const zoom = Number.parseFloat(style.getPropertyValue('--basehalf-canvas-zoom')) || 1;
				const screenTranslateY = translateY * zoom;
				const placement = surface.dataset.placement;
				return surface.dataset.chromeState !== 'suppressed'
					|| !surface.inert
					|| surface.getAttribute('aria-hidden') !== 'true'
					|| style.pointerEvents !== 'none'
					|| style.visibility !== 'hidden'
					|| Math.abs(Number.parseFloat(style.opacity || '1') - 1) > 0.001
					|| style.scale !== 'none'
					|| (placement === 'above' ? screenTranslateY <= 0 : placement === 'below' ? screenTranslateY >= 0 : true)
					|| Math.abs(Math.abs(screenTranslateY) - 6) > 0.75;
			});
			return invalid.length === 0 ? {
				mountedCount: surfaces.length,
				visibleCount: surfaces.filter(surface => getComputedStyle(surface).visibility !== 'hidden').length,
				selectedPaths: Array.from(document.querySelectorAll('.react-flow__node.selected')).flatMap(selected => {
					const selectedCard = selected.querySelector('.basehalf-canvas-card');
					return selectedCard instanceof HTMLElement && selectedCard.dataset.basehalfCardPath ? [selectedCard.dataset.basehalfCardPath] : [];
				})
			} : false;
		}, 'README.md', { timeout: 10_000 }).then(handle => handle.jsonValue());
		await waitForAdjacentChromeAnimations(page, coldDragChrome.mountedCount);
	} finally {
		await page.mouse.up();
	}
	if (coldDragChrome.visibleCount !== 0) {
		throw new Error(`An unselected Note exposed adjacent chrome during direct drag: ${JSON.stringify(coldDragChrome)}`);
	}
	await page.waitForFunction(path => {
		const card = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"]`);
		const node = card?.closest('.react-flow__node');
		const canvas = card?.closest('.basehalf-canvas-cards');
		const toolbar = document.querySelector('.basehalf-canvas-note-toolbar.basehalf-canvas-adjacent-chrome');
		const selected = Array.from(document.querySelectorAll('.react-flow__node.selected'));
		if (!(node instanceof HTMLElement)
			|| !(canvas instanceof HTMLElement)
			|| !(toolbar instanceof HTMLElement)
			|| selected.length !== 1
			|| selected[0] !== node
			|| node.classList.contains('dragging')
			|| canvas.dataset.nodeDragChrome !== undefined) {
			return false;
		}
		const style = getComputedStyle(toolbar);
		return toolbar.dataset.chromeState === 'present'
			&& !toolbar.inert
			&& toolbar.getAttribute('aria-hidden') !== 'true'
			&& style.pointerEvents !== 'none'
			&& style.visibility === 'visible'
			&& Math.abs(Number.parseFloat(style.opacity || '1') - 1) <= 0.001;
	}, 'README.md', { timeout: 10_000 });
	await waitForAdjacentChromeAnimations(page);
	const coldDropToolbar = page.locator('.basehalf-canvas-note-toolbar.basehalf-canvas-adjacent-chrome');
	assertAdjacentChromeSurfaceState(await captureAdjacentChromeSurface(coldDropToolbar), 'present', 'after directly dragging an unselected Note');
	const [restingGutterCardAfter, restingGutterScrollAfter] = await Promise.all([
		note.boundingBox(),
		staticPreview.evaluate(preview => preview.scrollTop)
	]);
	if (!restingGutterCardAfter
		|| Math.hypot(restingGutterCardAfter.x - restingGutterCardBefore.x, restingGutterCardAfter.y - restingGutterCardBefore.y) < 20
		|| Math.abs(restingGutterScrollAfter - restingGutterScrollBefore) > 1) {
		throw new Error(`The resting Note right gutter intercepted card dragging: ${JSON.stringify({ restingGutterCardBefore, restingGutterCardAfter, restingGutterScrollBefore, restingGutterScrollAfter })}`);
	}
	await pane.click({ position: { x: 16, y: 16 } });
	await toolbar.waitFor({ state: 'hidden', timeout: 10_000 });
	await centerCanvasCards(page, [note]);
	const restingZoomScrollTop = await staticPreview.evaluate(preview => {
		const maximum = Math.max(0, preview.scrollHeight - preview.clientHeight);
		const target = Math.min(32, Math.floor(maximum / 3));
		preview.scrollTop = target;
		return { maximum, target, actual: preview.scrollTop };
	});
	if (restingZoomScrollTop.maximum < 48
		|| restingZoomScrollTop.actual < 16
		|| Math.abs(restingZoomScrollTop.actual - restingZoomScrollTop.target) > 1) {
		throw new Error(`Could not establish a non-zero resting Note zoom position: ${JSON.stringify(restingZoomScrollTop)}`);
	}
	await assertCanvasNoteProgrammaticZoomLayoutInvariantSequence(page, staticPreview, 'resting', [visibleNeedle, CANVAS_MALFORMED_EMPHASIS_NEEDLE]);
	if (fs.readFileSync(readmePath, 'utf8') !== originalMarkdown) {
		throw new Error('Zooming the resting Canvas Note changed its Markdown source');
	}

	// Exercise the user's cold path before a preparatory selection can warm the
	// editor: the first click of this double-click selects the card, while the
	// second enters editing. Neither phase may replace or reflow the preview.
	await malformedParagraph().waitFor({ state: 'visible', timeout: 20_000 });
	const restingScrollState = await staticPreview.evaluate((preview, expectedParagraph) => {
		const maximum = Math.max(0, preview.scrollHeight - preview.clientHeight);
		const paragraph = Array.from(preview.querySelectorAll('p')).find(candidate => candidate.textContent === expectedParagraph);
		if (!(paragraph instanceof HTMLElement)) {
			throw new Error('Could not find the malformed emphasis paragraph in the resting Note');
		}
		const previewBounds = preview.getBoundingClientRect();
		const paragraphBounds = paragraph.getBoundingClientRect();
		const centered = preview.scrollTop + paragraphBounds.top - previewBounds.top - Math.max(0, (preview.clientHeight - paragraphBounds.height) / 2);
		const target = Math.max(0, Math.min(maximum, Math.round(centered)));
		preview.scrollTop = target;
		return { maximum, target, actual: preview.scrollTop, paragraphHeight: paragraphBounds.height, clientHeight: preview.clientHeight };
	}, CANVAS_MALFORMED_EMPHASIS_PARAGRAPH);
	if (restingScrollState.maximum < 48
		|| restingScrollState.actual < 24
		|| restingScrollState.paragraphHeight > restingScrollState.clientHeight
		|| Math.abs(restingScrollState.actual - restingScrollState.target) > 1) {
		throw new Error(`The long resting Note could not establish a meaningful scroll position: ${JSON.stringify(restingScrollState)}`);
	}
	const scrolledEntryPoint = await staticPreview.evaluate((preview, token) => {
		const body = preview.closest('.basehalf-canvas-card-body');
		if (!(body instanceof HTMLElement)) {
			throw new Error('Scrolled Note entry target is not inside its card body');
		}
		const bodyBounds = body.getBoundingClientRect();
		const previewBounds = preview.getBoundingClientRect();
		const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT);
		let node;
		while ((node = walker.nextNode())) {
			const offset = node.textContent?.indexOf(token) ?? -1;
			const parent = node.parentElement;
			if (offset < 0 || !(parent instanceof HTMLElement)) {
				continue;
			}
			const range = document.createRange();
			range.setStart(node, offset);
			range.setEnd(node, offset + token.length);
			for (const bounds of range.getClientRects()) {
				const left = Math.max(bounds.left, previewBounds.left, bodyBounds.left, 0);
				const top = Math.max(bounds.top, previewBounds.top, bodyBounds.top, 0);
				const right = Math.min(bounds.right, previewBounds.right, bodyBounds.right, window.innerWidth);
				const bottom = Math.min(bounds.bottom, previewBounds.bottom, bodyBounds.bottom, window.innerHeight);
				if (right - left <= 1 || bottom - top <= 1) {
					continue;
				}
				const point = { x: (left + right) / 2, y: (top + bottom) / 2 };
				const hit = document.elementFromPoint(point.x, point.y);
				if (hit && preview.contains(hit) && (hit === parent || parent.contains(hit) || hit.contains(parent))) {
					return point;
				}
			}
		}
		throw new Error(`Could not find a topmost visible Range for the scrolled Note token: ${token}`);
	}, CANVAS_MALFORMED_EMPHASIS_NEEDLE);
	await startCanvasNoteEditTransitionProbe(note, scrolledTransitionTokens, staticPreviewIdentity, 'enter', CANVAS_MALFORMED_EMPHASIS_PARAGRAPH);
	let directTransition;
	try {
		await page.mouse.dblclick(scrolledEntryPoint.x, scrolledEntryPoint.y);
		await waitForCanvasNoteInlineEditor(page, 'README.md');
		directTransition = await finishCanvasNoteEditTransitionProbe(page);
	} catch (error) {
		await cancelCanvasNoteEditTransitionProbe(page).catch(() => undefined);
		throw error;
	}
	assertCanvasNoteEditTransitionFrames(directTransition, scrolledTransitionTokens, staticPreviewIdentity);
	assertCanvasMalformedParagraphTransition(directTransition, CANVAS_MALFORMED_EMPHASIS_PARAGRAPH);
	if (fs.readFileSync(readmePath, 'utf8') !== originalMarkdown) {
		throw new Error('Opening the malformed Canvas Note paragraph changed its Markdown source');
	}
	await startCanvasNoteExitTransitionProbe(note, scrolledTransitionTokens, staticPreviewIdentity);
	let directExitTransition;
	try {
		await pane.click({ position: { x: 16, y: 16 } });
		await inlineEditor.host.waitFor({ state: 'detached', timeout: 15_000 });
		directExitTransition = await finishCanvasNoteExitTransitionProbe(page);
	} finally {
		await cancelCanvasNoteExitTransitionProbe(page).catch(() => undefined);
	}
	assertCanvasNoteExitTransitionFrames(directExitTransition, scrolledTransitionTokens, staticPreviewIdentity);
	await toolbar.waitFor({ state: 'hidden', timeout: 10_000 });
	const returnedRestingScrollTop = await staticPreview.evaluate(preview => preview.scrollTop);
	if (Math.abs(returnedRestingScrollTop - restingScrollState.actual) > 1
		|| await staticPreview.getAttribute('data-smoke-preview-identity') !== staticPreviewIdentity
		|| fs.readFileSync(readmePath, 'utf8') !== originalMarkdown) {
		throw new Error(`Cold direct Note editing changed its preview, scroll position, or Markdown: ${JSON.stringify({ restingScrollState, returnedRestingScrollTop })}`);
	}
	await staticPreview.evaluate(preview => preview.scrollTop = 0);

	await note.click();
	await toolbar.waitFor({ state: 'visible', timeout: 10_000 });
	const toolbarIdentity = `toolbar-${Date.now()}-${Math.random()}`;
	await toolbar.evaluate((element, identity) => element.setAttribute('data-smoke-toolbar-identity', identity), toolbarIdentity);
	const toolbarLabels = await toolbar.locator('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')));
	const expectedToolbarLabels = ['Background color', 'Heading 1', 'Heading 2', 'Heading 3', 'Paragraph', 'Bold', 'Italic', 'Bulleted list', 'Numbered list', 'Divider', 'Copy all', 'Expand README.md'];
	if (JSON.stringify(toolbarLabels) !== JSON.stringify(expectedToolbarLabels)) {
		throw new Error(`The Note toolbar has an unexpected action contract: ${JSON.stringify(toolbarLabels)}`);
	}
	const toolbarIconContract = {
		'Heading 1': 'heading1',
		'Heading 2': 'heading2',
		'Heading 3': 'heading3',
		Paragraph: 'paragraph',
		Bold: 'bold',
		Italic: 'italic',
		'Bulleted list': 'bulletList',
		'Numbered list': 'orderedList',
		Divider: 'divider',
		'Copy all': 'copy',
		'Expand README.md': 'expand'
	};
	for (const [label, iconName] of Object.entries(toolbarIconContract)) {
		const iconButton = toolbar.getByRole('button', { name: label, exact: true });
		const iconState = await iconButton.evaluate((button, expectedName) => {
			const iconElement = button.querySelector(':scope > svg.basehalf-canvas-note-toolbar-icon');
			return {
				name: iconElement?.getAttribute('data-basehalf-icon'),
				ariaHidden: iconElement?.getAttribute('aria-hidden'),
				focusable: iconElement?.getAttribute('focusable'),
				size: iconElement ? { width: getComputedStyle(iconElement).width, height: getComputedStyle(iconElement).height } : undefined,
				expectedName
			};
		}, iconName);
		if (iconState.name !== iconName
			|| iconState.ariaHidden !== 'true'
			|| iconState.focusable !== 'false'
			|| iconState.size?.width !== '18px'
			|| iconState.size?.height !== '18px') {
			throw new Error(`The Note toolbar icon contract is broken for ${label}: ${JSON.stringify({ iconName, iconState })}`);
		}
	}
	const expandButton = toolbar.getByRole('button', { name: 'Expand README.md', exact: true });
	if (!await expandButton.locator(':scope > svg[data-basehalf-icon="expand"]').count()) {
		throw new Error('The Note Expand action is not a screen-full toolbar button');
	}
	if (await page.locator('.basehalf-canvas-note-views, .basehalf-canvas-selection-toolbar').count() !== 0) {
		throw new Error('A selected Note rendered retired views or generic selection controls');
	}
	if (await note.getAttribute('data-preview-level') !== 'preview'
		|| await inlineEditor.host.count() !== 0
		|| await note.locator('.basehalf-canvas-note-editor-fallback').count() !== 0) {
		throw new Error('Selecting a Note replaced its static preview with an editor surface');
	}
	const selectedPreviewState = await staticPreview.evaluate((preview, expectedIdentity) => ({
		identity: preview.getAttribute('data-smoke-preview-identity'),
		html: preview.innerHTML,
		expectedIdentity
	}), staticPreviewIdentity);
	if (selectedPreviewState.identity !== selectedPreviewState.expectedIdentity || selectedPreviewState.html !== staticPreviewHtml) {
		throw new Error(`Selecting a Note replaced or rewrote its static preview: ${JSON.stringify(selectedPreviewState)}`);
	}
	const selectedSoftLines = await measureSoftLines(staticPreview);
	if (unselectedSoftLines.some((metric, index) => Math.abs(metric.x - selectedSoftLines[index].x) > 1
		|| Math.abs(metric.y - selectedSoftLines[index].y) > 1
		|| Math.abs(metric.height - selectedSoftLines[index].height) > 1)) {
		throw new Error(`Selecting a Note changed its soft-line layout: ${JSON.stringify({ unselectedSoftLines, selectedSoftLines })}`);
	}
	if (fs.readFileSync(readmePath, 'utf8') !== originalMarkdown) {
		throw new Error('Selecting a Note changed its Markdown source');
	}
	await assertNoCanvasNoteHeavyEditor(page, cardSelector, 'single-click selection');
	const backgroundButton = toolbar.getByRole('button', { name: 'Background color', exact: true });
	await backgroundButton.click();
	const blueBackground = page.getByRole('menuitemradio', { name: 'Blue background', exact: true });
	await blueBackground.click();
	await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute('data-note-background') === 'blue', cardSelector, { timeout: 3_000 });
	const appearancePath = path.join(workspacePath, '.bh', 'mirror', 'README.md', 'appearance.yaml');
	await waitUntil(() => fs.existsSync(appearancePath) && fs.readFileSync(appearancePath, 'utf8') === 'background: blue\n', 'Canvas Note background to persist');
	await backgroundButton.click();
	await page.getByRole('menuitemradio', { name: 'Default background', exact: true }).click();
	await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute('data-note-background') === 'default', cardSelector, { timeout: 3_000 });
	await waitUntil(() => fs.readFileSync(appearancePath, 'utf8') === 'background: default\n', 'Canvas Note background reset to persist');
	await page.waitForFunction(selector => {
		const card = document.querySelector(selector);
		if (!(card instanceof HTMLElement)) {
			return false;
		}
		const probe = document.createElement('span');
		probe.style.backgroundColor = 'var(--bh-card-surface)';
		card.appendChild(probe);
		const settled = getComputedStyle(card).backgroundColor === getComputedStyle(probe).backgroundColor;
		probe.remove();
		return settled;
	}, cardSelector, { timeout: 3_000 });
	let selectedNoteChrome = await captureCanvasCardComputedChrome(note);
	assertCanvasCardResizeChromeIsNeutral(selectedNoteChrome, 'selected Note pointer state');
	assertCanvasCardHasRoundedCornerResizeTargets(selectedNoteChrome, 'selected Note pointer state');
	if (!selectedNoteChrome.cardSelected
		|| !selectedNoteChrome.nodeSelected
		|| selectedNoteChrome.visibleResizeHandles !== 4
		|| selectedNoteChrome.interactiveResizeHandles !== 4) {
		throw new Error(`A selected Note did not expose four corner resize hit targets: ${JSON.stringify(selectedNoteChrome)}`);
	}
	try {
		await page.emulateMedia({ forcedColors: 'active' });
		await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
		const forcedSelectedChrome = await captureCanvasCardComputedChrome(note);
		if (forcedSelectedChrome.cardFocusVisible
			|| forcedSelectedChrome.cardPaint.outlineStyle === 'none'
			|| Number.parseFloat(forcedSelectedChrome.cardPaint.outlineWidth) !== 1
			|| forcedSelectedChrome.cardPaint.outlineColor !== forcedSelectedChrome.colors.activeBorder) {
			throw new Error(`Forced-colors selection did not render a one-pixel CanvasText outline: ${JSON.stringify(forcedSelectedChrome)}`);
		}
		await page.keyboard.press('Tab');
		await note.evaluate(card => {
			const node = card.closest('.react-flow__node-basehalf-card');
			if (!(node instanceof HTMLElement)) {
				throw new Error('Selected Note is missing its React Flow focus owner');
			}
			node.focus();
		});
		const forcedKeyboardChrome = await captureCanvasCardComputedChrome(note);
		if (!forcedKeyboardChrome.nodeFocusVisible
			|| forcedKeyboardChrome.cardFocusVisible
			|| (forcedKeyboardChrome.nodePaint.outlineStyle !== 'none' && forcedKeyboardChrome.nodePaint.outlineWidth !== '0px')
			|| forcedKeyboardChrome.cardPaint.outlineStyle === 'none'
			|| Number.parseFloat(forcedKeyboardChrome.cardPaint.outlineWidth) !== 2
			|| forcedKeyboardChrome.cardPaint.outlineColor !== forcedKeyboardChrome.colors.focusRing
			|| forcedKeyboardChrome.cardPaint.outlineColor === forcedSelectedChrome.cardPaint.outlineColor) {
			throw new Error(`Forced-colors keyboard focus did not replace selection with a two-pixel Highlight outline: ${JSON.stringify({ forcedSelectedChrome, forcedKeyboardChrome })}`);
		}
	} finally {
		await page.emulateMedia({ forcedColors: 'none' });
		await note.evaluate(async card => {
			await Promise.allSettled(card.getAnimations().map(animation => animation.finished));
		});
	}
	await note.evaluate(card => card.blur());
	await note.click();
	selectedNoteChrome = await captureCanvasCardComputedChrome(note);
	assertCanvasCardResizeChromeIsNeutral(selectedNoteChrome, 'pointer-restored selected Note after forced-colors');
	await page.keyboard.press('Tab');
	await note.evaluate(card => card.focus());
	const keyboardFocusedNoteChrome = await captureCanvasCardComputedChrome(note);
	if (!keyboardFocusedNoteChrome.cardFocusVisible
		|| keyboardFocusedNoteChrome.cardPaint.outlineStyle === 'none'
		|| keyboardFocusedNoteChrome.cardPaint.outlineWidth === '0px'
		|| keyboardFocusedNoteChrome.cardPaint.outlineColor !== keyboardFocusedNoteChrome.colors.focusRing) {
		throw new Error(`Keyboard focus did not render the Canvas focus ring: ${JSON.stringify(keyboardFocusedNoteChrome)}`);
	}
	assertCanvasCardUsesActiveBorder(keyboardFocusedNoteChrome, 'keyboard-focused selected Note');
	await note.evaluate(card => card.blur());
	await page.keyboard.press('Tab');
	await note.evaluate(card => {
		const node = card.closest('.react-flow__node-basehalf-card');
		if (!(node instanceof HTMLElement)) {
			throw new Error('Selected Note is missing its React Flow focus owner');
		}
		node.focus();
	});
	const keyboardFocusedNodeChrome = await captureCanvasCardComputedChrome(note);
	if (!keyboardFocusedNodeChrome.nodeFocusVisible
		|| keyboardFocusedNodeChrome.cardFocusVisible
		|| (keyboardFocusedNodeChrome.nodePaint.outlineStyle !== 'none' && keyboardFocusedNodeChrome.nodePaint.outlineWidth !== '0px')
		|| keyboardFocusedNodeChrome.cardPaint.outlineStyle === 'none'
		|| keyboardFocusedNodeChrome.cardPaint.outlineWidth === '0px'
		|| keyboardFocusedNodeChrome.cardPaint.outlineColor !== keyboardFocusedNodeChrome.colors.focusRing) {
		throw new Error(`React Flow focus owner did not project exactly one Canvas focus ring onto its card: ${JSON.stringify(keyboardFocusedNodeChrome)}`);
	}
	assertCanvasCardUsesActiveBorder(keyboardFocusedNodeChrome, 'keyboard-focused selected Note through React Flow owner');
	await note.evaluate(card => (card.closest('.react-flow__node-basehalf-card') as HTMLElement | null)?.blur());
	await note.click();
	selectedNoteChrome = await captureCanvasCardComputedChrome(note);
	assertCanvasCardResizeChromeIsNeutral(selectedNoteChrome, 'pointer-restored selected Note');

	const [selectedNoteBox, initialToolbarBox] = await Promise.all([note.boundingBox(), toolbar.boundingBox()]);
	if (!selectedNoteBox || !initialToolbarBox) {
		throw new Error('Could not measure the selected Note toolbar');
	}
	const toolbarIsSeparated = initialToolbarBox.y + initialToolbarBox.height <= selectedNoteBox.y - 8
		|| initialToolbarBox.y >= selectedNoteBox.y + selectedNoteBox.height + 8;
	if (!toolbarIsSeparated) {
		throw new Error('The Note toolbar overlaps the selected card or its connection area');
	}
	const stacking = await note.evaluate(card => {
		const node = card.closest('.react-flow__node');
		const controls = document.querySelector('.basehalf-canvas-note-toolbar');
		return {
			node: node ? Number(getComputedStyle(node).zIndex) : Number.NaN,
			controls: controls ? Number(getComputedStyle(controls).zIndex) : Number.NaN
		};
	});
	if (!Number.isFinite(stacking.node) || !Number.isFinite(stacking.controls) || stacking.controls <= stacking.node) {
		throw new Error(`Note controls do not stay above the selected node: ${JSON.stringify(stacking)}`);
	}
	for (let attempt = 0; attempt < 12; attempt++) {
		if (!await zoomCanvas(page, 'out')) {
			break;
		}
		await page.waitForTimeout(50);
	}
	await page.waitForFunction(() => Number(document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom')) <= 0.21, null, { timeout: 10_000 });
	const zoomedToolbarBox = await toolbar.boundingBox();
	if (!zoomedToolbarBox
		|| Math.abs(zoomedToolbarBox.width - initialToolbarBox.width) > 1
		|| Math.abs(zoomedToolbarBox.height - initialToolbarBox.height) > 1) {
		throw new Error('The Note toolbar changed screen size with canvas zoom');
	}
	if (await inlineEditor.host.count() !== 0) {
		throw new Error('Zooming a selected Note mounted its inline editor');
	}
	await zoomCanvas(page, 'reset');
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '1', null, { timeout: 10_000 });

	// The glyph, not the name: a double click on the name renames in place.
	await note.locator('.basehalf-canvas-card-caption-icon').dblclick();
	await page.waitForTimeout(250);
	if (await inlineEditor.host.count() !== 0
		|| await staticPreview.getAttribute('data-smoke-preview-identity') !== staticPreviewIdentity) {
		throw new Error('Double-clicking the Note header entered content editing or replaced its static preview');
	}

	// Use a block that is physically inside the clipped card viewport. A locator
	// can report later paragraphs as visible even when the card's overflow clips
	// their click point to an earlier block.
	await sourceParagraph().waitFor({ state: 'visible', timeout: 20_000 });
	await startCanvasNoteEditTransitionProbe(note, transitionTokens, staticPreviewIdentity);
	let activeInlineEditor;
	let editTransition;
	try {
		await sourceParagraph().dblclick();
		activeInlineEditor = await waitForCanvasNoteInlineEditor(page, 'README.md');
		editTransition = await finishCanvasNoteEditTransitionProbe(page);
	} catch (error) {
		await cancelCanvasNoteEditTransitionProbe(page).catch(() => undefined);
		throw error;
	}
	assertCanvasNoteEditTransitionFrames(editTransition, transitionTokens, staticPreviewIdentity);
	await assertNoCanvasNoteHeavyEditor(page, cardSelector, 'inline WYSIWYG editing');
	if (await toolbar.getAttribute('data-smoke-toolbar-identity') !== toolbarIdentity
		|| JSON.stringify(await toolbar.locator('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))) !== JSON.stringify(expectedToolbarLabels)) {
		throw new Error('Entering Note editing replaced or changed the selected-card toolbar');
	}
	const editingFallback = note.locator('.basehalf-canvas-note-editor-fallback');
	if (await editingFallback.count() !== 1 || await editingFallback.getAttribute('aria-hidden') !== 'true') {
		throw new Error('The ready Canvas inline editor did not retain one accessibility-hidden atomic exit frame');
	}
	const editingCursor = await activeInlineEditor.editable.evaluate(editable => getComputedStyle(editable).cursor);
	if (editingCursor !== 'text') {
		throw new Error(`The active Note editor must advertise text input, got cursor=${editingCursor}`);
	}
	await placeCanvasInlineCaretAfter(activeInlineEditor.editable, visibleNeedle);
	const activeZoomScrollTop = await activeInlineEditor.surface.evaluate(surface => {
		const maximum = Math.max(0, surface.scrollHeight - surface.clientHeight);
		const target = Math.min(24, Math.floor(maximum / 4));
		surface.scrollTop = target;
		return { maximum, target, actual: surface.scrollTop };
	});
	if (activeZoomScrollTop.maximum < 48
		|| activeZoomScrollTop.actual < 12
		|| Math.abs(activeZoomScrollTop.actual - activeZoomScrollTop.target) > 1) {
		throw new Error(`Could not establish a non-zero active Note zoom position: ${JSON.stringify(activeZoomScrollTop)}`);
	}
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	await assertCanvasNoteProgrammaticZoomLayoutInvariantSequence(page, activeInlineEditor.surface, 'active', transitionTokens);
	if (fs.readFileSync(readmePath, 'utf8') !== originalMarkdown) {
		throw new Error('Zooming the active Canvas Note changed its Markdown source');
	}
	await activeInlineEditor.surface.evaluate(surface => surface.scrollTop = 0);
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	const editingChrome = await captureCanvasCardComputedChrome(note);
	assertCanvasCardResizeChromeIsNeutral(editingChrome, 'active Note editing');
	assertCanvasCardPaintEqual(selectedNoteChrome.cardPaint, editingChrome.cardPaint, 'selected-to-editing transition');
	if (editingChrome.cardSelected
		|| editingChrome.paintedResizeLines !== 0
		|| editingChrome.visibleResizeHandles !== 0
		|| editingChrome.interactiveResizeHandles !== 0
		|| editingChrome.liveConnectionHandles !== 0) {
		throw new Error(`Editing a Note exposed structural selection chrome: ${JSON.stringify(editingChrome)}`);
	}
	const editingCardBox = await note.boundingBox();
	if (!staticCardBox || !editingCardBox
		|| Math.abs(staticCardBox.width - editingCardBox.width) > 1
		|| Math.abs(staticCardBox.height - editingCardBox.height) > 1) {
		throw new Error(`Opening the Canvas inline editor changed card geometry: ${JSON.stringify({ staticCardBox, editingCardBox })}`);
	}
	const editingSoftLines = await measureSoftLines(activeInlineEditor.surface);
	if (selectedSoftLines.some((metric, index) => Math.abs(metric.x - editingSoftLines[index].x) > 1
		|| Math.abs(metric.y - editingSoftLines[index].y) > 1
		|| Math.abs(metric.height - editingSoftLines[index].height) > 1)) {
		throw new Error(`Opening the Canvas inline editor changed its soft-line layout: ${JSON.stringify({ selectedSoftLines, editingSoftLines })}`);
	}
	await selectCanvasInlineToken(activeInlineEditor.editable, visibleNeedle);
	const boldButton = toolbar.getByRole('button', { name: 'Bold', exact: true });
	await boldButton.click();
	await page.waitForFunction(token => Array.from(document.querySelectorAll('.basehalf-canvas-markdown-inline > .ProseMirror strong')).some(element => element.textContent?.includes(token)), visibleNeedle, { timeout: 3_000 });
	const toolbarFormatFocus = await activeInlineEditor.editable.evaluate(editable => ({
		contenteditable: editable.getAttribute('contenteditable'),
		focused: document.activeElement === editable || editable.contains(document.activeElement),
		selection: document.getSelection()?.toString()
	}));
	if (toolbarFormatFocus.contenteditable !== 'true' || !toolbarFormatFocus.focused || toolbarFormatFocus.selection !== visibleNeedle) {
		throw new Error(`A toolbar format command lost the active editor selection: ${JSON.stringify(toolbarFormatFocus)}`);
	}
	await boldButton.click();
	await page.waitForFunction(token => !Array.from(document.querySelectorAll('.basehalf-canvas-markdown-inline > .ProseMirror strong')).some(element => element.textContent?.includes(token)), visibleNeedle, { timeout: 3_000 });
	const editingDragBefore = await note.boundingBox();
	const editingDragTarget = await activeInlineEditor.editable.boundingBox();
	if (!editingDragBefore || !editingDragTarget) {
		throw new Error('Could not measure the active Note drag fence');
	}
	await page.mouse.move(editingDragTarget.x + 12, editingDragTarget.y + Math.min(12, editingDragTarget.height / 2));
	await page.mouse.down();
	await page.mouse.move(editingDragTarget.x + 52, editingDragTarget.y + Math.min(30, editingDragTarget.height / 2 + 18), { steps: 6 });
	await page.mouse.up();
	const editingDragAfter = await note.boundingBox();
	if (!editingDragAfter
		|| Math.abs(editingDragBefore.x - editingDragAfter.x) > 1
		|| Math.abs(editingDragBefore.y - editingDragAfter.y) > 1) {
		throw new Error(`Dragging inside the active editor moved the canvas card: ${JSON.stringify({ editingDragBefore, editingDragAfter })}`);
	}
	const siblingQuote = activeInlineEditor.surface.locator('.basehalf-canvas-markdown-inline-unit blockquote', { hasText: 'Smoke editable quote.' }).first();
	await siblingQuote.click();
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-markdown-inline > .ProseMirror strong')?.textContent?.includes('Smoke editable quote.'), null, { timeout: 3_000 });
	const siblingSoftLines = activeInlineEditor.surface.locator('.basehalf-canvas-markdown-inline-unit p', { hasText: visibleNeedle }).first();
	await siblingSoftLines.click();
	await page.waitForFunction(token => document.querySelector('.basehalf-canvas-markdown-inline > .ProseMirror')?.textContent?.includes(token), visibleNeedle, { timeout: 3_000 });
	// Keep both endpoints in one clipped card viewport. This still crosses two
	// real top-level Markdown units, while leaving native pointer selection—not
	// programmatic scrolling during pointerdown—to own the directional range.
	const crossUnitSelectionToken = CANVAS_MALFORMED_EMPHASIS_PARAGRAPH.slice(0, 12);
	const upwardSelection = await dragSelectCanvasInline(page, activeInlineEditor.editable, crossUnitSelectionToken, 'soft-line-alpha');
	if (upwardSelection.collapsed
		|| !upwardSelection.text.includes('soft-line-beta')
		|| upwardSelection.anchorUnit === upwardSelection.focusUnit) {
		throw new Error(`Bottom-up Canvas Markdown selection stopped at a unit boundary: ${JSON.stringify(upwardSelection)}`);
	}
	const downwardSelection = await dragSelectCanvasInline(page, activeInlineEditor.editable, 'soft-line-alpha', crossUnitSelectionToken);
	if (downwardSelection.collapsed
		|| !downwardSelection.text.includes('soft-line-beta')
		|| downwardSelection.anchorUnit === downwardSelection.focusUnit) {
		throw new Error(`Top-down Canvas Markdown selection stopped at a unit boundary: ${JSON.stringify(downwardSelection)}`);
	}
	if (fs.readFileSync(readmePath, 'utf8') !== originalMarkdown) {
		throw new Error('Moving the caret or selecting across Markdown units changed source bytes without a text edit');
	}
	const crossUnitReplacement = 'canvas-cross-unit-replacement';
	await page.keyboard.insertText(crossUnitReplacement);
	await page.waitForFunction(marker => {
		const text = document.querySelector('.basehalf-canvas-markdown-inline > .ProseMirror')?.textContent ?? '';
		return text.includes(marker) && !text.includes('soft-line-beta');
	}, crossUnitReplacement, { timeout: 3_000 });
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
	await page.waitForFunction(marker => {
		const text = document.querySelector('.basehalf-canvas-markdown-inline > .ProseMirror')?.textContent ?? '';
		return !text.includes(marker) && text.includes('soft-line-beta') && text.includes('Smoke editable quote.');
	}, crossUnitReplacement, { timeout: 3_000 });

	await placeCanvasInlineCaretBefore(activeInlineEditor.editable, 'needle-basehalf-second');
	await page.keyboard.press('Backspace');
	await page.waitForFunction(() => {
		const root = document.querySelector('.basehalf-canvas-markdown-inline > .ProseMirror');
		if (!(root instanceof HTMLElement)) {
			return false;
		}
		const unitFor = token => {
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
			let node;
			while ((node = walker.nextNode())) {
				if (node.textContent?.includes(token)) {
					return node.parentElement?.closest('[data-basehalf-markdown-unit]')?.getAttribute('data-basehalf-markdown-unit');
				}
			}
			return undefined;
		};
		const first = unitFor('needle-basehalf-routing');
		const second = unitFor('needle-basehalf-second');
		return first !== undefined && first === second;
	}, null, { timeout: 3_000 });
	const joinedBoundaryMarkdown = originalMarkdown.replace(
		'needle-basehalf-routing\n\nneedle-basehalf-second',
		'needle-basehalf-routingneedle-basehalf-second'
	);
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S');
	await waitUntil(
		() => fs.readFileSync(readmePath, 'utf8') === joinedBoundaryMarkdown,
		'Backspace at a paragraph boundary to save one joined Markdown paragraph',
		15_000
	);
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
	await page.waitForFunction(() => {
		const units = Array.from(document.querySelectorAll('.basehalf-canvas-markdown-inline > .ProseMirror > [data-basehalf-markdown-unit]'));
		return units.some(unit => unit.textContent?.includes('needle-basehalf-routing'))
			&& units.some(unit => unit.textContent?.includes('needle-basehalf-second'))
			&& !units.some(unit => unit.textContent?.includes('needle-basehalf-routing') && unit.textContent?.includes('needle-basehalf-second'));
	}, null, { timeout: 3_000 });
	await pane.click({ position: { x: 16, y: 16 } });
	await inlineEditor.host.waitFor({ state: 'detached', timeout: 15_000 });
	await waitUntil(
		() => fs.readFileSync(readmePath, 'utf8') === originalMarkdown,
		'paragraph-boundary undo to restore exact Markdown bytes',
		15_000
	).catch(error => {
		throw new Error(`Paragraph-boundary undo saved unexpected Markdown: ${JSON.stringify(fs.readFileSync(readmePath, 'utf8'))}`, { cause: error });
	});
	await sourceParagraph().dblclick();
	await waitForCanvasNoteInlineEditor(page, 'README.md');

	const firstCaretMarker = ' canvas-inline-first';
	const secondCaretMarker = ' canvas-inline-second';
	await clickCanvasInlineCaretAfter(page, activeInlineEditor.editable, visibleNeedle);
	await page.keyboard.insertText(firstCaretMarker);
	// Let the first model edit close its undo group and deliberately cross VS
	// Code's 800 ms dirty-file tracker window. A BaseHalf-owned working copy must
	// stay on the Canvas instead of being opened in a native Monaco editor.
	await page.waitForTimeout(1_000);
	await page.keyboard.insertText(secondCaretMarker);
	await assertCanvasStillOnTop(page, 'before inline undo');
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
	await page.waitForFunction(({ first, second }) => {
		const text = document.querySelector('.basehalf-canvas-markdown-inline > .ProseMirror')?.textContent ?? '';
		return text.includes(first) && !text.includes(second);
	}, { first: firstCaretMarker, second: secondCaretMarker }, { timeout: 3_000 });
	await assertCanvasStillOnTop(page, 'after inline undo');
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y');
	await page.waitForFunction(({ first, second }) => {
		const text = document.querySelector('.basehalf-canvas-markdown-inline > .ProseMirror')?.textContent ?? '';
		return text.includes(first) && text.includes(second);
	}, { first: firstCaretMarker, second: secondCaretMarker }, { timeout: 3_000 });
	await assertCanvasStillOnTop(page, 'after inline redo');
	await startCanvasNoteExitTransitionProbe(note, transitionTokens, staticPreviewIdentity);
	let exitTransition;
	try {
		await pane.click({ position: { x: 16, y: 16 } });
		await inlineEditor.host.waitFor({ state: 'detached', timeout: 15_000 });
		exitTransition = await finishCanvasNoteExitTransitionProbe(page);
	} finally {
		await cancelCanvasNoteExitTransitionProbe(page).catch(() => undefined);
	}
	assertCanvasNoteExitTransitionFrames(exitTransition, transitionTokens, staticPreviewIdentity);
	await assertCanvasStillOnTop(page, 'after inline click-away');
	const caretMarker = `${firstCaretMarker}${secondCaretMarker}`;
	const expectedCaretMarkdown = originalMarkdown.replace(visibleNeedle, `${visibleNeedle}${caretMarker}`);
	await waitUntil(() => fs.readFileSync(readmePath, 'utf8') === expectedCaretMarkdown, 'click-away to durably save the localized Canvas inline edit', 15_000);
	const caretMarkdown = fs.readFileSync(readmePath, 'utf8');
	if (caretMarkdown !== expectedCaretMarkdown
		|| caretMarkdown.slice(0, caretMarkdown.indexOf(caretMarker)) + caretMarkdown.slice(caretMarkdown.indexOf(caretMarker) + caretMarker.length) !== originalMarkdown) {
		throw new Error('The Canvas inline editor changed bytes outside the visible needle edit');
	}
	await note.locator('.bh-md-preview', { hasText: caretMarker }).waitFor({ state: 'visible', timeout: 10_000 });
	await assertNoCanvasNoteHeavyEditor(page, cardSelector, 'inline click-away exit');

	const restoreReadmeFixture = async () => {
		// Test cleanup intentionally arrives as an external write. This also
		// verifies that the resting preview reconciles the same file after its
		// inline editor has been disposed.
		fs.writeFileSync(readmePath, originalMarkdown, 'utf8');
		await waitUntil(() => fs.readFileSync(readmePath, 'utf8') === originalMarkdown, 'README fixture cleanup', 15_000);
		await note.locator('.bh-md-preview p', { hasText: 'needle-basehalf-routing' }).first().waitFor({ state: 'visible', timeout: 15_000 });
	};
	await restoreReadmeFixture();
	await assertCanvasStillOnTop(page, 'after inline fixture restore');

	const quotePreview = () => note.locator('.bh-md-preview blockquote', { hasText: 'Smoke editable quote.' }).first();
	await quotePreview().waitFor({ state: 'visible', timeout: 10_000 });
	await quotePreview().dblclick();
	const quoteEditor = await waitForCanvasNoteInlineEditor(page, 'README.md');
	const activeQuote = quoteEditor.surface.locator('.basehalf-canvas-markdown-inline-unit blockquote', { hasText: 'Smoke editable quote.' }).first();
	await activeQuote.locator('strong', { hasText: 'Smoke editable quote.' }).waitFor({ state: 'visible', timeout: 5_000 });
	await activeQuote.locator('a', { hasText: 'guide link' }).waitFor({ state: 'visible', timeout: 5_000 });
	const visibleQuoteText = await activeQuote.innerText();
	if (visibleQuoteText.includes('**') || visibleQuoteText.includes('docs/guide.md')) {
		throw new Error(`Canvas inline WYSIWYG exposed Markdown markers or a link destination: ${JSON.stringify(visibleQuoteText)}`);
	}
	await assertNoCanvasNoteHeavyEditor(page, cardSelector, 'formatted inline WYSIWYG unit');
	// A press on the margin around the text leaves the keyboard in the text,
	// and the frame of the card stays the only frame: the editor's own element
	// never holds the focus and never draws the ring of a focused element.
	const quoteSurfaceBox = await quoteEditor.surface.boundingBox();
	if (!quoteSurfaceBox) {
		throw new Error('The Canvas inline editor has no box for the margin press');
	}
	await page.mouse.click(quoteSurfaceBox.x + 3, quoteSurfaceBox.y + quoteSurfaceBox.height / 2);
	await page.waitForTimeout(150);
	const afterMarginPress = await quoteEditor.surface.evaluate(surface => ({
		focusInText: !!document.activeElement?.closest('.basehalf-canvas-markdown-inline > .ProseMirror'),
		focusOnSurface: document.activeElement === surface,
		ring: getComputedStyle(surface).outlineStyle
	}));
	if (!afterMarginPress.focusInText || afterMarginPress.focusOnSurface || afterMarginPress.ring !== 'none') {
		throw new Error(`A press on the margin of the Canvas inline editor took the keyboard from the text: ${JSON.stringify(afterMarginPress)}`);
	}
	await page.keyboard.press('Escape');
	await inlineEditor.host.waitFor({ state: 'detached', timeout: 15_000 });
	if (fs.readFileSync(readmePath, 'utf8') !== originalMarkdown) {
		throw new Error('Opening and closing a formatted Canvas inline unit normalized its Markdown bytes');
	}
	await quotePreview().waitFor({ state: 'visible', timeout: 10_000 });
	await assertNoCanvasNoteHeavyEditor(page, cardSelector, 'formatted static preview');

	await sourceParagraph().waitFor({ state: 'visible', timeout: 10_000 });
	await sourceParagraph().dblclick();
	const expandInlineEditor = await waitForCanvasNoteInlineEditor(page, 'README.md');
	const expandMarker = ' canvas-expand-inline-marker';
	await placeCanvasInlineCaretAfter(expandInlineEditor.editable, visibleNeedle);
	await page.keyboard.insertText(expandMarker);
	await expandButton.click();
	await assertCardDetail(page, 'README.md');
	await inlineEditor.host.waitFor({ state: 'detached', timeout: 15_000 });
	const expectedExpandedMarkdown = originalMarkdown.replace(visibleNeedle, `${visibleNeedle}${expandMarker}`);
	await waitUntil(() => fs.readFileSync(readmePath, 'utf8') === expectedExpandedMarkdown, 'Expand to durably save Canvas inline edit before opening rich detail', 15_000);
	const expandedMarkdown = fs.readFileSync(readmePath, 'utf8');
	if (expandedMarkdown !== expectedExpandedMarkdown) {
		throw new Error('Expand did not preserve the exact Markdown bytes outside the active inline unit');
	}
	const detailFrame = await activeMarkdownRichFrame(page, '.basehalf-card-detail-surface.active');
	await detailFrame.locator('.bn-editor', { hasText: expandMarker }).waitFor({ state: 'visible', timeout: 15_000 });
	if (await markdownRichEditorFrameCount(page, '.basehalf-card-detail-surface.active') !== 1) {
		throw new Error('Expand did not leave exactly one rich editor in Card Detail');
	}
	await assertNoCanvasNoteHeavyEditor(page, cardSelector, 'expanded Card Detail');
	await assertNoEditorTabFor(page, 'README.md');
	await closeCardDetailIfOpen(page);
	await page.locator('.basehalf-canvas-cards').waitFor({ state: 'visible', timeout: 15_000 });
	await centerCanvasCards(page, [note]);
	await restoreReadmeFixture();

	await pane.click({ position: { x: 16, y: 16 } });
	await note.click();
	await toolbar.waitFor({ state: 'visible', timeout: 10_000 });
	await sourceParagraph().dblclick();
	await waitForCanvasNoteInlineEditor(page, 'README.md');
	await centerCanvasCards(page, [folder]);
	await folder.click({ modifiers: ['Shift'] });
	await page.getByRole('toolbar', { name: 'Actions for 2 selected cards', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
	await inlineEditor.host.waitFor({ state: 'detached', timeout: 15_000 });
	if (await page.locator('.basehalf-canvas-note-toolbar, [data-testid^="canvas-note-editor-"]').count() !== 0) {
		throw new Error('A multi-selection retained single-Note controls or its inline editor');
	}
	if (fs.readFileSync(readmePath, 'utf8') !== originalMarkdown) {
		throw new Error('Closing an unchanged inline editor for multi-selection changed Markdown');
	}
	await assertNoCanvasNoteHeavyEditor(page, cardSelector, 'multi-selection');

	await pane.click({ position: { x: 16, y: 16 } });
	await centerCanvasCards(page, [folder]);
	await folder.click();
	await page.getByRole('toolbar', { name: 'Selected card actions', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
	if (await page.locator('.basehalf-canvas-note-toolbar, [data-testid^="canvas-note-editor-"]').count() !== 0) {
		throw new Error('A non-Note card rendered Note controls or a Note inline editor');
	}

	const inlineSelectionErrors = pageErrors.filter(error => /Position \d+ out of range/.test(error.message));
	if (inlineSelectionErrors.length > 0) {
		throw new Error(`The Canvas inline editor produced an invalid document selection: ${inlineSelectionErrors.map(error => error.message).join('; ')}`);
	}
	if (fs.readFileSync(readmePath, 'utf8') !== originalMarkdown) {
		throw new Error('Canvas Note inline smoke did not restore the README fixture exactly');
	}
}

async function assertCanvasCardBadgePreviewAndConnectors(page) {
	const checkoutConflictDialog = page.locator('.monaco-dialog-box', { hasText: 'Your local changes would be overwritten by checkout' }).first();
	if (await checkoutConflictDialog.isVisible({ timeout: 5_000 }).catch(() => false)) {
		await checkoutConflictDialog.locator('.monaco-button', { hasText: 'Cancel' }).click();
		await checkoutConflictDialog.waitFor({ state: 'hidden', timeout: 10_000 });
	}

	const canvasPath = path.join(workspacePath, '.bh', 'mirror', 'canvas.yaml');
	const readmeBadgePath = path.join(workspacePath, '.bh', 'mirror', 'README.md', 'badge.yaml');
	await zoomCanvas(page, 'reset');
	await page.waitForFunction(() => Number(document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom')) >= 0.5, null, { timeout: 10_000 });

	const readme = page.locator('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
	await readme.waitFor({ state: 'visible', timeout: 20_000 });
	await centerCanvasCards(page, [readme]);
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]')?.getAttribute('data-preview-level') === 'preview', null, { timeout: 10_000 });
	const captionMetrics = await page.waitForFunction(() => {
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
		const caption = card?.querySelector('.basehalf-canvas-card-caption');
		const content = card?.querySelector('.basehalf-canvas-card-content');
		const badge = caption?.querySelector('.basehalf-canvas-card-caption-actions .basehalf-canvas-card-badge-toggle');
		if (!(card instanceof HTMLElement) || !(caption instanceof HTMLElement) || !(content instanceof HTMLElement)
			|| !(badge instanceof HTMLElement) || !caption.isConnected || caption.getBoundingClientRect().height <= 0) {
			return false;
		}
		const cardRect = card.getBoundingClientRect();
		const captionRect = caption.getBoundingClientRect();
		return {
			height: captionRect.height,
			gap: cardRect.top - captionRect.bottom,
			leftDelta: captionRect.left - cardRect.left,
			rightDelta: captionRect.right - cardRect.right,
			cardRadius: Number.parseFloat(getComputedStyle(card).borderTopLeftRadius),
			contentRadius: Number.parseFloat(getComputedStyle(content).borderTopLeftRadius),
			hasInternalHeader: card.querySelector('.basehalf-canvas-card-header, .basehalf-canvas-card-path') !== null
		};
	}, null, { timeout: 10_000 }).then(handle => handle.jsonValue());
	if (Math.abs(captionMetrics.height - 24) > 1
		|| Math.abs(captionMetrics.gap - 8) > 1
		|| Math.abs(captionMetrics.leftDelta) > 1
		|| Math.abs(captionMetrics.rightDelta) > 1
		|| Math.abs(captionMetrics.cardRadius - 22) > 0.5
		|| Math.abs(captionMetrics.contentRadius - 21) > 0.5
		|| captionMetrics.hasInternalHeader) {
		throw new Error(`Expected one external 24px caption and unified 22px card frame, got ${JSON.stringify(captionMetrics)}`);
	}
	await readme.locator('.basehalf-canvas-card-badge-toggle.lit:visible').waitFor({ state: 'visible', timeout: 10_000 });
	await readme.locator('.basehalf-canvas-card-preview', { hasText: /Smoke README|needle-basehalf-routing/ }).waitFor({ state: 'visible', timeout: 10_000 });
	await readme.locator('.basehalf-canvas-card-badge-toggle:visible').click();
	const badgePrompt = readme.locator('.basehalf-canvas-card-badge-prompt');
	await badgePrompt.waitFor({ state: 'visible', timeout: 10_000 });
	await page.waitForFunction(() => document.activeElement?.classList.contains('basehalf-canvas-card-badge-prompt'), null, { timeout: 10_000 });
	const compositionDraft = '中文组合输入尚未结束';
	await badgePrompt.evaluate((prompt, value) => {
		prompt.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		prompt.value = value;
		prompt.dispatchEvent(new InputEvent('input', {
			bubbles: true,
			data: value,
			inputType: 'insertCompositionText',
			isComposing: true
		}));
	}, compositionDraft);
	await page.waitForTimeout(450);
	if (fs.readFileSync(readmeBadgePath, 'utf8').includes(compositionDraft)) {
		throw new Error('Canvas Badge persisted an unfinished IME composition');
	}
	await badgePrompt.evaluate((prompt, value) => prompt.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: value })), compositionDraft);
	await waitUntil(() => fs.readFileSync(readmeBadgePath, 'utf8').includes(compositionDraft), 'canvas Badge to persist a completed IME composition');
	await badgePrompt.fill('Smoke file badge');
	await badgePrompt.evaluate(prompt => prompt.blur());
	await waitUntil(() => fs.readFileSync(readmeBadgePath, 'utf8').includes('description: "Smoke file badge"'), 'canvas Badge to restore the fixture after IME composition');
	await badgePrompt.focus();
	await page.keyboard.press('Escape');
	await readme.locator('.basehalf-canvas-card-preview', { hasText: /Smoke README|needle-basehalf-routing/ }).waitFor({ state: 'visible', timeout: 10_000 });
	await page.waitForFunction(() => {
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
		return document.activeElement?.classList.contains('basehalf-canvas-card-badge-toggle')
			&& card?.contains(document.activeElement);
	}, null, { timeout: 10_000 });
	await page.keyboard.press('Enter');
	await badgePrompt.waitFor({ state: 'visible', timeout: 10_000 });
	await page.waitForFunction(() => document.activeElement?.classList.contains('basehalf-canvas-card-badge-prompt'), null, { timeout: 10_000 });
	const promptValue = await badgePrompt.inputValue();
	if (promptValue !== 'Smoke file badge') {
		throw new Error(`Expected card badge face to load prompt, got ${JSON.stringify(promptValue)}`);
	}
	await badgePrompt.fill('First prompt line');
	await badgePrompt.press('Enter');
	await page.keyboard.type('Second prompt line');
	if (await badgePrompt.inputValue() !== 'First prompt line\nSecond prompt line'
		|| await readme.getAttribute('data-projection') !== 'badge') {
		throw new Error('Enter did not behave exclusively as a newline in the canvas Badge prompt');
	}
	await badgePrompt.evaluate(prompt => prompt.blur());
	await waitUntil(() => {
		const badgeYaml = fs.readFileSync(readmeBadgePath, 'utf8');
		return badgeYaml.includes('First prompt line') && badgeYaml.includes('Second prompt line');
	}, 'multiline canvas Badge prompt to persist');
	await clickCanvasBadgeToggle(readme);
	try {
		await readme.locator('.basehalf-canvas-card-preview', { hasText: /Smoke README|needle-basehalf-routing/ }).waitFor({ state: 'visible', timeout: 10_000 });
	} catch (error) {
		const state = await readme.evaluate(card => ({
			previewLevel: card.getAttribute('data-preview-level'),
			projection: card.getAttribute('data-projection'),
			text: card.textContent,
			activeElement: card.ownerDocument.activeElement?.className,
			previewCount: card.querySelectorAll('.basehalf-canvas-card-preview').length,
			badgeFaceCount: card.querySelectorAll('.basehalf-canvas-card-badge-face').length
		}));
		throw new Error(`Canvas Badge did not close after persisting a multiline prompt: ${JSON.stringify(state)}`, { cause: error });
	}
	await readme.locator('.basehalf-canvas-card-badge-toggle:visible').click();
	await badgePrompt.waitFor({ state: 'visible', timeout: 10_000 });
	const reloadedMultilinePrompt = await badgePrompt.evaluate(prompt => ({
		value: prompt.value,
		clientHeight: prompt.clientHeight,
		scrollHeight: prompt.scrollHeight
	}));
	if (reloadedMultilinePrompt.value !== 'First prompt line\nSecond prompt line'
		|| reloadedMultilinePrompt.clientHeight < 36
		|| Math.abs(reloadedMultilinePrompt.scrollHeight - reloadedMultilinePrompt.clientHeight) > 1) {
		throw new Error(`Reloaded canvas Badge prompt collapsed its multiline content: ${JSON.stringify(reloadedMultilinePrompt)}`);
	}
	await badgePrompt.fill(Array.from({ length: 12 }, (_, index) => `Long Badge prompt line ${index + 1}`).join('\n'));
	const longPromptLayout = await badgePrompt.evaluate(prompt => {
		const body = prompt.closest('.basehalf-canvas-card-badge-scroll');
		return {
			clientHeight: prompt.clientHeight,
			scrollHeight: prompt.scrollHeight,
			scrollable: prompt.classList.contains('scrollable'),
			outlineStyle: getComputedStyle(prompt).outlineStyle,
			bodyClientHeight: body?.clientHeight ?? 0,
			bodyScrollHeight: body?.scrollHeight ?? 0
		};
	});
	if (longPromptLayout.scrollable
		|| Math.abs(longPromptLayout.scrollHeight - longPromptLayout.clientHeight) > 1
		|| longPromptLayout.bodyScrollHeight <= longPromptLayout.bodyClientHeight
		|| longPromptLayout.outlineStyle !== 'none') {
		throw new Error(`Long canvas Badge prompt did not expand to its complete content: ${JSON.stringify(longPromptLayout)}`);
	}
	const lastBadgeActionVisibleAfterLongPrompt = await readme.locator('[data-testid="badge-add-downstream"]').evaluate(button => {
		const card = button.closest('.basehalf-canvas-card');
		const body = button.closest('.basehalf-canvas-card-badge-scroll');
		if (!(card instanceof HTMLElement) || !(body instanceof HTMLElement)) {
			return false;
		}
		body.scrollTop = body.scrollHeight;
		const buttonBox = button.getBoundingClientRect();
		const cardBox = card.getBoundingClientRect();
		return buttonBox.top >= cardBox.top && buttonBox.bottom <= cardBox.bottom;
	});
	if (!lastBadgeActionVisibleAfterLongPrompt) {
		throw new Error('The canvas Badge body could not scroll from a complete prompt to its last action, Add Downstream');
	}
	const canvasBadgeDraft = 'Canvas Badge prompt survives refresh and zoom';
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
	await page.keyboard.type(canvasBadgeDraft);
	await badgePrompt.evaluate(prompt => prompt.setAttribute('data-smoke-editor-instance', 'retained'));
	fs.appendFileSync(readmeBadgePath, '\n# trigger a background Badge refresh while the prompt is focused\n', 'utf8');
	await page.waitForTimeout(750);
	const retainedPromptState = await page.evaluate(expected => {
		const prompt = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"] .basehalf-canvas-card-badge-prompt');
		return prompt instanceof HTMLTextAreaElement
			&& document.activeElement === prompt
			&& prompt.getAttribute('data-smoke-editor-instance') === 'retained'
			&& prompt.value === expected;
	}, canvasBadgeDraft);
	if (!retainedPromptState) {
		throw new Error('Background Badge refresh replaced or unfocused the active canvas prompt');
	}
	for (let attempt = 0; attempt < 4; attempt++) {
		await zoomCanvas(page, 'out', { preserveFocus: true });
		await page.waitForTimeout(80);
	}
	await page.waitForFunction(([expected, marker]) => {
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
		const prompt = card?.querySelector('.basehalf-canvas-card-badge-prompt');
		return card?.getAttribute('data-preview-level') === 'interactive'
			&& card.getAttribute('data-projection') === 'badge'
			&& prompt instanceof HTMLTextAreaElement
			&& document.activeElement === prompt
			&& prompt.getAttribute('data-smoke-editor-instance') === marker
			&& prompt.value === expected;
	}, [canvasBadgeDraft, 'retained'], { timeout: 10_000 });
	await zoomCanvas(page, 'reset', { preserveFocus: true });
	await page.waitForFunction(expected => {
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
		const prompt = card?.querySelector('.basehalf-canvas-card-badge-prompt');
		return card?.getAttribute('data-preview-level') === 'interactive'
			&& prompt instanceof HTMLTextAreaElement
			&& prompt.value === expected;
	}, canvasBadgeDraft, { timeout: 10_000 });
	await badgePrompt.fill('Smoke file badge');
	await badgePrompt.evaluate(prompt => prompt.blur());
	await page.waitForFunction(() => !document.activeElement?.classList.contains('basehalf-canvas-card-badge-prompt'), null, { timeout: 10_000 });
	await waitUntil(() => fs.readFileSync(readmeBadgePath, 'utf8').includes('description: "Smoke file badge"'), 'canvas Badge prompt fixture value to be restored');
	await readme.locator('.basehalf-canvas-card-badge-toggle:visible').click();
	await readme.locator('.basehalf-canvas-card-preview', { hasText: /Smoke README|needle-basehalf-routing/ }).waitFor({ state: 'visible', timeout: 10_000 });

	const canvasBeforeZoom = fs.readFileSync(canvasPath, 'utf8');
	await page.locator('.react-flow__pane').click({ position: { x: 16, y: 16 } });
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]')?.getAttribute('data-preview-level') === 'preview', null, { timeout: 10_000 });
	await readme.evaluate(card => {
		card.querySelector('.basehalf-canvas-card-active')?.setAttribute('data-smoke-zoom-identity', 'active');
		card.querySelector('.basehalf-canvas-card-preview')?.setAttribute('data-smoke-zoom-identity', 'preview');
	});
	for (let attempt = 0; attempt < 12; attempt++) {
		if (!await zoomCanvas(page, 'out')) {
			break;
		}
		await page.waitForTimeout(80);
	}
	await page.waitForFunction(() => {
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
		const root = document.querySelector('.basehalf-canvas-workbench');
		return Number(root?.getAttribute('data-zoom')) <= 0.21
			&& card?.getAttribute('data-preview-level') === 'preview'
			&& card.querySelectorAll('.basehalf-canvas-card-active[data-smoke-zoom-identity="active"]').length === 1
			&& card.querySelectorAll('.basehalf-canvas-card-preview[data-smoke-zoom-identity="preview"]').length === 1
			&& card.querySelector('.basehalf-canvas-card-overview') === null
			&& card.querySelector('video, audio, textarea') === null;
	}, null, { timeout: 10_000 });
	await zoomCanvas(page, 'reset');
	await page.waitForFunction(() => {
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
		return card?.getAttribute('data-preview-level') === 'preview'
			&& card.querySelectorAll('.basehalf-canvas-card-active[data-smoke-zoom-identity="active"]').length === 1
			&& card.querySelectorAll('.basehalf-canvas-card-preview[data-smoke-zoom-identity="preview"]').length === 1
			&& card.querySelector('.basehalf-canvas-card-overview') === null;
	}, null, { timeout: 10_000 });
	await readme.locator('.basehalf-canvas-card-preview', { hasText: /Smoke README|needle-basehalf-routing/ }).waitFor({ state: 'visible', timeout: 10_000 });
	if (fs.readFileSync(canvasPath, 'utf8') !== canvasBeforeZoom) {
		throw new Error('Zooming the canvas changed persisted card geometry');
	}

	const readmeNode = page.locator('.react-flow__node', { has: readme });
	const readmeHandles = readmeNode.locator(':scope > .basehalf-canvas-card-connect-handle');
	const handleCount = await readmeHandles.count();
	if (handleCount !== 4) {
		throw new Error(`Expected four card connection handles, got ${handleCount}`);
	}
	await readme.hover();
	const visibleReadmeHandles = await page.waitForFunction(() => {
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
		const node = card?.closest('.react-flow__node');
		if (!node) {
			return false;
		}
		const count = Array.from(node.querySelectorAll(':scope > .basehalf-canvas-card-connect-handle')).filter(handle => {
			const style = getComputedStyle(handle);
			return Number(style.opacity) > 0.5 && style.pointerEvents !== 'none';
		}).length;
		return count === 4 ? count : false;
	}, null, { timeout: 10_000 }).then(handle => handle.jsonValue());
	if (visibleReadmeHandles !== 4) {
		throw new Error(`Expected all four React Flow handles on card hover, got ${visibleReadmeHandles}`);
	}
}

// The agent-created note with an `upstream` frontmatter list naming `entries`,
// exactly as the BaseHalf planner writes it; with no entries, the note's own
// bytes (the planner removes an emptied block together with its fences).
function agentNoteWithUpstream(entries) {
	return entries.length === 0
		? AGENT_CREATED_CARD_CONTENT
		: `---\nupstream:\n${entries.map(entry => `  - ${entry}\n`).join('')}---\n${AGENT_CREATED_CARD_CONTENT}`;
}

function readWorkspaceFile(relativePath) {
	const filePath = path.join(workspacePath, ...relativePath.split('/'));
	return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : undefined;
}

// Paths under .bh/ whose bytes differ from `before` (a readBhTree() snapshot).
// Machine-local runtime state under .bh/cache/ is not project metadata.
function bhTreeChangesSince(before) {
	const after = readBhTree();
	return [...new Set([...Object.keys(before), ...Object.keys(after)])]
		.filter(rel => before[rel] !== after[rel] && !rel.startsWith('.bh/cache/'))
		.sort();
}

// Notification toasts never render under --enable-smoke-test-driver (the
// stock NotificationsToasts skips them so they cannot cover smoke targets), so
// the smoke reads notifications from the notification center, opened from the
// status bar bell. The center lists every notification that is still open.
async function showNotificationsCenter(page) {
	const center = page.locator('.notifications-center.visible');
	if (!(await center.isVisible().catch(() => false))) {
		await page.locator('#status\\.notifications .statusbar-item-label').click();
	}
	await center.waitFor({ state: 'visible', timeout: 10_000 });
	return center;
}

async function hideNotificationsCenter(page) {
	const center = page.locator('.notifications-center.visible');
	if (await center.isVisible().catch(() => false)) {
		await page.locator('#status\\.notifications .statusbar-item-label').click();
		await center.waitFor({ state: 'hidden', timeout: 10_000 });
	}
}

// Waits for the open notification whose message contains `message` (a string
// or a RegExp) and returns its row in the notification center, which stays open.
async function waitForNotification(page, message, timeout = 15_000) {
	// A center that is opened before the notification arrives can close again
	// with nothing to show, and the notification does not reopen it. So the
	// center is opened again for as long as the notification is not listed.
	const deadline = Date.now() + timeout;
	for (; ;) {
		const center = await showNotificationsCenter(page);
		const item = center.locator('.notification-list-item', { hasText: message }).first();
		try {
			await item.waitFor({ state: 'visible', timeout: Math.max(250, Math.min(1_000, deadline - Date.now())) });
			return item;
		} catch (error) {
			if (Date.now() >= deadline) {
				throw error;
			}
		}
	}
}

// Waits for a notification, checks it, and clears it so later lookups of the
// same message never match it; then closes the notification center.
async function expectNotification(page, message, timeout = 15_000) {
	const item = await waitForNotification(page, message, timeout);
	await item.locator('.action-label.codicon-notifications-clear').evaluate(action => action.click());
	await item.waitFor({ state: 'hidden', timeout: 10_000 });
	await hideNotificationsCenter(page);
}

// Clicks an action button of the notification whose message contains
// `message`, then closes the notification center.
async function clickNotificationAction(page, message, action, timeout = 15_000) {
	const item = await waitForNotification(page, message, timeout);
	await item.locator('.notification-list-item-buttons-container .monaco-button', { hasText: action }).first().click();
	await item.waitFor({ state: 'hidden', timeout: 10_000 });
	await hideNotificationsCenter(page);
}

// Zooms out to at most 50% and centers `cards`, so every card and its
// connection handles are inside the visible canvas.
async function frameCanvasCardsForConnection(page, cards) {
	for (let attempt = 0; attempt < 16; attempt++) {
		const zoom = await page.locator('.basehalf-canvas-workbench').getAttribute('data-zoom').then(Number);
		if (zoom <= 0.5) {
			break;
		}
		if (!await zoomCanvas(page, 'out')) {
			break;
		}
		await page.waitForTimeout(50);
	}
	for (const card of cards) {
		await card.waitFor({ state: 'visible', timeout: 10_000 });
	}
	for (let attempt = 0; attempt < 4; attempt++) {
		await centerCanvasCards(page, cards);
		const canvasBounds = await page.locator('.basehalf-canvas-cards').boundingBox();
		const cardBounds = await Promise.all(cards.map(card => card.boundingBox()));
		if (canvasBounds && cardBounds.every(bounds => bounds
			&& bounds.x >= canvasBounds.x - 1
			&& bounds.y >= canvasBounds.y - 1
			&& bounds.x + bounds.width <= canvasBounds.x + canvasBounds.width + 1
			&& bounds.y + bounds.height <= canvasBounds.y + canvasBounds.height + 1)) {
			return;
		}
		if (!await zoomCanvas(page, 'out')) {
			break;
		}
		await page.waitForTimeout(50);
	}
	throw new Error('Connection fixture cards are not fully inside the visible canvas viewport');
}

// Connecting a card into an annotatable Markdown note stores the connection
// once, in the downstream note (D37): its first bytes gain an `upstream`
// frontmatter list, canvas.yaml gains only the anchor row, and nothing else
// under .bh/ changes. The first frontmatter BaseHalf adds is announced once.
async function assertCanvasConnectIntoNote(page) {
	const canvasPath = path.join(workspacePath, '.bh', 'mirror', 'canvas.yaml');
	const note = AGENT_CREATED_CARD_PATH;
	const docs = page.locator('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
	const noteCard = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${note}"]`);
	await frameCanvasCardsForConnection(page, [docs, noteCard]);
	const docsNode = page.locator('.react-flow__node', { has: docs });
	const noteNode = page.locator('.react-flow__node', { has: noteCard });
	const docsEast = docsNode.locator(':scope > .basehalf-canvas-card-connect-handle.east');
	const noteWest = noteNode.locator(':scope > .basehalf-canvas-card-connect-handle.west');
	await page.locator('.basehalf-canvas-cards').focus();
	await page.keyboard.press('Escape');
	await docs.click();

	if (readWorkspaceFile(note) !== AGENT_CREATED_CARD_CONTENT) {
		throw new Error(`${note} must start without frontmatter`);
	}
	const beforeCancelCanvas = fs.readFileSync(canvasPath, 'utf8');
	// A blank release opens the Create from Connection menu; Escape closes it
	// and writes nothing.
	const release = await dropCanvasConnectionOnBlank(page, 'docs');
	const cancelAction = await connectionCreateMenuAction(page, release, 'Note');
	await page.keyboard.press('Escape');
	await cancelAction.waitFor({ state: 'hidden', timeout: 10_000 });
	await page.waitForTimeout(150);
	if (fs.readFileSync(canvasPath, 'utf8') !== beforeCancelCanvas || readWorkspaceFile(note) !== AGENT_CREATED_CARD_CONTENT) {
		throw new Error('Expected closing the Create from Connection menu to write nothing to canvas.yaml or the note');
	}
	const draftCountAfterCancel = await page.locator('.react-flow__connection-path').count();
	if (draftCountAfterCancel !== 0) {
		throw new Error(`Expected connection draft to be removed after cancel, got ${draftCountAfterCancel}`);
	}

	const bhBeforeConnect = readBhTree();
	await docs.hover();
	await page.waitForFunction(() => getComputedStyle(document.querySelector('.react-flow__node[data-id="docs"] > .basehalf-canvas-card-connect-handle.east')).pointerEvents !== 'none', null, { timeout: 10_000 });
	const freshSourceBox = await docsEast.boundingBox();
	const freshTargetBox = await noteWest.boundingBox();
	if (!freshSourceBox || !freshTargetBox) {
		throw new Error('Missing React Flow handles after cancelled connection');
	}
	// Inside the outline the card keeps the pointer; press the handle's outside half.
	await page.mouse.move(freshSourceBox.x + freshSourceBox.width / 2 + 3, freshSourceBox.y + freshSourceBox.height / 2);
	await page.mouse.down();
	await page.mouse.move(freshTargetBox.x + freshTargetBox.width / 2, freshTargetBox.y + freshTargetBox.height / 2, { steps: 8 });
	await page.waitForFunction(() => document.querySelector('.react-flow__connection-path') !== null, null, { timeout: 10_000 });
	await page.mouse.up();

	await waitUntil(() => readWorkspaceFile(note) === agentNoteWithUpstream(['docs']), `the connection to be saved as the upstream frontmatter of ${note}`);
	await waitUntil(() => {
		const canvas = fs.readFileSync(canvasPath, 'utf8');
		return canvas.includes('from: "docs"')
			&& canvas.includes('from_anchor: east')
			&& canvas.includes(`to: "${note}"`)
			&& canvas.includes('to_anchor: west');
	}, 'canvas.yaml to persist the four-side anchor row');
	await clickNotificationAction(page, `Saved this connection inside ${note}.`, 'OK');
	const bhChanges = bhTreeChangesSince(bhBeforeConnect);
	if (bhChanges.some(rel => rel !== '.bh/mirror/canvas.yaml')) {
		throw new Error(`Connecting into a note may change only its bytes and the canvas.yaml anchor row, but .bh/ also changed: ${bhChanges.join(', ')}`);
	}
}

// Connection handles capture the pointer within 24 screen pixels of their
// anchor point at every zoom: coming from outside the card shows its handles
// and snaps the near one to a 16-pixel connection-intent circle, and a drag
// from there starts a connection. The released line stays drawn while the
// Create from Connection menu is open, and Escape removes it.
async function assertCanvasConnectionHandleCapture(page) {
	const docs = page.locator('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
	for (const percent of [40, 100]) {
		const controller = await openCanvasZoomMenu(page);
		await controller.input.fill(`${percent}%`);
		await controller.input.press('Enter');
		await controller.menu.waitFor({ state: 'hidden', timeout: 10_000 });
		const zoom = percent / 100;
		await page.waitForFunction(expected => Number(document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom')) === expected, zoom, { timeout: 10_000 });
		await centerCanvasCards(page, [docs]);
		await page.mouse.move(5, 5);
		// Pick a side whose outside is free: a neighbor's capture circle may cover it.
		const target = await page.evaluate(() => {
			const node = document.querySelector('.react-flow__node[data-id="docs"]');
			const rect = node?.getBoundingClientRect();
			if (!node || !rect) {
				return undefined;
			}
			const points = {
				east: { x: rect.right + 16, y: rect.top + rect.height / 2 },
				south: { x: rect.left + rect.width / 2, y: rect.bottom + 16 },
				west: { x: rect.left - 16, y: rect.top + rect.height / 2 },
				north: { x: rect.left + rect.width / 2, y: rect.top - 16 }
			};
			for (const [anchor, point] of Object.entries(points)) {
				const hit = document.elementFromPoint(point.x, point.y);
				if (hit?.matches('.basehalf-canvas-connect-capture') && hit.getAttribute('data-node-id') === 'docs' && hit.getAttribute('data-anchor') === anchor) {
					return { anchor, point };
				}
			}
			return undefined;
		});
		if (!target) {
			throw new Error(`No connection handle of docs captures a point 16 screen pixels outside its card at ${percent}%`);
		}
		await page.mouse.move(target.point.x, target.point.y, { steps: 4 });
		const snapped = await page.waitForFunction(({ anchor, zoom }) => {
			const node = document.querySelector('.react-flow__node[data-id="docs"]');
			const handle = node?.querySelector(`:scope > .basehalf-canvas-card-connect-handle.${anchor}`);
			const rest = node?.querySelector(`:scope > .basehalf-canvas-card-connect-handle:not(.${anchor})`);
			if (!handle || !rest || !handle.classList.contains('snapped') || getComputedStyle(handle).opacity !== '1' || getComputedStyle(rest).opacity !== '1') {
				return undefined;
			}
			const circle = element => {
				const style = getComputedStyle(element, '::before');
				return { diameter: parseFloat(style.width) * new DOMMatrixReadOnly(style.transform).a * zoom, background: style.backgroundColor };
			};
			const snap = circle(handle);
			const other = circle(rest);
			return Math.abs(snap.diameter - 16) <= 0.75 && Math.abs(other.diameter - 11) <= 0.75 && snap.background !== other.background
				? { snap, other }
				: undefined;
		}, { anchor: target.anchor, zoom }, { timeout: 10_000 }).catch(() => undefined);
		if (!snapped) {
			throw new Error(`The ${target.anchor} handle of docs did not snap to a 16-pixel intent circle at ${percent}%`);
		}
		await page.mouse.down();
		await page.mouse.move(target.point.x + (target.anchor === 'east' ? 12 : target.anchor === 'west' ? -12 : 0), target.point.y + (target.anchor === 'south' ? 12 : target.anchor === 'north' ? -12 : 0), { steps: 3 });
		await page.locator('.react-flow__connection-path').waitFor({ state: 'attached', timeout: 5_000 });
		const blank = await canvasReconnectBlankPoint(page, target.point);
		await page.mouse.move(blank.x, blank.y, { steps: 8 });
		await page.mouse.up();
		const cancelAction = await connectionCreateMenuAction(page, blank, 'Note');
		const dropLine = page.locator('[data-testid="canvas-connection-drop-line"]');
		if (await dropLine.count() !== 1) {
			throw new Error(`The released connection line must stay drawn while the menu is open at ${percent}%`);
		}
		const lineEnds = await dropLine.evaluate(path => {
			const ctm = path.getScreenCTM();
			const toScreen = point => {
				const screen = new DOMPoint(point.x, point.y).matrixTransform(ctm);
				return { x: screen.x, y: screen.y };
			};
			return ctm ? { start: toScreen(path.getPointAtLength(0)), end: toScreen(path.getPointAtLength(path.getTotalLength())) } : undefined;
		});
		const handleCenter = await page.evaluate(anchor => {
			const rect = document.querySelector(`.react-flow__node[data-id="docs"] > .basehalf-canvas-card-connect-handle.${anchor}`)?.getBoundingClientRect();
			return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined;
		}, target.anchor);
		if (!lineEnds || !handleCenter || pointDistance(lineEnds.end, blank) > 2 || pointDistance(lineEnds.start, handleCenter) > 2) {
			throw new Error(`The kept connection line must run from the ${target.anchor} handle to the release point at ${percent}%: ${JSON.stringify({ lineEnds, handleCenter, release: blank })}`);
		}
		// Escape at one zoom, a click on empty canvas at the other.
		const dismissPoint = percent === 100 ? await canvasReconnectBlankPoint(page, blank) : undefined;
		await assertDropLineLeavesWithMenu(page, () => dismissPoint ? page.mouse.click(dismissPoint.x, dismissPoint.y) : page.keyboard.press('Escape'));
		await cancelAction.waitFor({ state: 'hidden', timeout: 10_000 });
		await dropLine.waitFor({ state: 'detached', timeout: 5_000 });
	}
}

// Dismisses the Create from Connection menu and checks, on the first frame
// without the menu, that the kept connection line is already gone.
async function assertDropLineLeavesWithMenu(page, dismiss) {
	const firstFrameWithoutMenu = page.evaluate(() => new Promise(resolve => {
		const check = () => {
			const action = document.querySelector('.context-view.monaco-menu-container .action-label[aria-label="Note"]');
			if (action && action.getClientRects().length > 0) {
				requestAnimationFrame(check);
				return;
			}
			const line = document.querySelector('.basehalf-canvas-connection-drop-line');
			resolve(!!line && getComputedStyle(line).display !== 'none');
		};
		requestAnimationFrame(check);
	}));
	await dismiss();
	if (await firstFrameWithoutMenu) {
		throw new Error('The kept connection line was still drawn on the first frame after the menu closed');
	}
}

// Starts a connection drag from the east handle of `sourcePath`'s card and
// returns the pointer position once React Flow draws the draft path.
async function startCanvasConnectionDrag(page, sourcePath) {
	const card = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${sourcePath}"]`);
	const handleSelector = `.react-flow__node[data-id="${sourcePath}"] > .basehalf-canvas-card-connect-handle.east`;
	await card.hover();
	await page.waitForFunction(selector => getComputedStyle(document.querySelector(selector)).pointerEvents !== 'none', handleSelector, { timeout: 10_000 });
	const sourceBox = await page.locator(handleSelector).boundingBox();
	if (!sourceBox) {
		throw new Error('Missing React Flow connection geometry');
	}
	// Inside the outline the card keeps the pointer; press the handle's outside half.
	const sourcePoint = { x: sourceBox.x + sourceBox.width / 2 + 3, y: sourceBox.y + sourceBox.height / 2 };
	let connectionStartState;
	for (let attempt = 0; attempt < 3; attempt++) {
		await card.hover();
		await page.mouse.move(sourcePoint.x, sourcePoint.y);
		await page.mouse.down();
		// The connection gesture intentionally waits until the pointer crosses its
		// drag threshold; pointer-down alone does not create a draft path.
		await page.mouse.move(sourcePoint.x + 8 + attempt * 4, sourcePoint.y, { steps: 3 });
		if (await page.locator('.react-flow__connection-path').waitFor({ state: 'attached', timeout: 2_500 }).then(() => true, () => false)) {
			return sourcePoint;
		}
		connectionStartState = await page.evaluate(({ x, y, selector }) => {
			const target = document.elementFromPoint(x, y);
			const handle = document.querySelector(selector);
			return {
				targetClass: target?.getAttribute('class'),
				handleClass: handle?.getAttribute('class'),
				handlePointerEvents: handle ? getComputedStyle(handle).pointerEvents : undefined,
				handleOpacity: handle ? getComputedStyle(handle).opacity : undefined
			};
		}, { ...sourcePoint, selector: handleSelector });
		await page.mouse.up();
		await page.keyboard.press('Escape');
		await page.waitForTimeout(100);
	}
	throw new Error(`Connection gesture did not start from the visible handle: ${JSON.stringify(connectionStartState)}`);
}

// Drags a connection from `sourcePath` and releases it on empty canvas.
async function dropCanvasConnectionOnBlank(page, sourcePath) {
	const sourcePoint = await startCanvasConnectionDrag(page, sourcePath);
	const blank = await canvasReconnectBlankPoint(page, sourcePoint);
	await page.mouse.move(blank.x, blank.y, { steps: 8 });
	await page.mouse.up();
	return blank;
}

// Where canvas coordinates are on screen, and the box of the canvas.
async function readCanvasView(page) {
	return page.evaluate(() => {
		const viewport = document.querySelector('.react-flow__viewport');
		const flow = document.querySelector('.react-flow');
		const canvas = document.querySelector('.basehalf-canvas-cards');
		if (!viewport || !flow || !canvas) {
			throw new Error('Missing canvas view');
		}
		const matrix = new DOMMatrixReadOnly(getComputedStyle(viewport).transform);
		const origin = flow.getBoundingClientRect();
		const box = canvas.getBoundingClientRect();
		return { x: origin.left + matrix.e, y: origin.top + matrix.f, zoom: matrix.a, canvas: { left: box.left, top: box.top, right: box.right, bottom: box.bottom } };
	});
}

// A point on empty canvas where a released connection line opens the create
// menu: nothing is drawn there, and no card's handle is near enough to take the
// line. `where` picks the point:
// - 'rightEdge': 60 screen pixels inside the right edge of the canvas, so that
//   a card created there reaches past the edge and is partly out of sight.
// - 'besideCard': just left of a card other than `sourcePath`, level with its
//   top, so that a card created there lies on that card.
async function canvasConnectionReleasePoint(page, where, sourcePath) {
	const point = await page.evaluate(({ where, sourcePath }) => {
		const canvas = document.querySelector('.basehalf-canvas-cards')?.getBoundingClientRect();
		const pane = document.querySelector('.react-flow__pane');
		const viewport = document.querySelector('.react-flow__viewport');
		if (!canvas || !pane || !viewport) {
			throw new Error('Missing canvas for a connection release point');
		}
		const zoom = new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a;
		const nodes = [...document.querySelectorAll('.react-flow__node')].map(node => ({ path: node.getAttribute('data-id'), rect: node.getBoundingClientRect() }));
		const handles = nodes.flatMap(({ rect }) => [
			{ x: rect.left, y: rect.top + rect.height / 2 },
			{ x: rect.right, y: rect.top + rect.height / 2 },
			{ x: rect.left + rect.width / 2, y: rect.top },
			{ x: rect.left + rect.width / 2, y: rect.bottom }
		]);
		// The connection radius is 48 canvas pixels, and a capture circle 24 screen pixels.
		const clear = (x, y) => x > canvas.left + 50 && x < canvas.right - 50 && y > canvas.top + 50 && y < canvas.bottom - 50
			&& document.elementFromPoint(x, y) === pane
			&& handles.every(handle => Math.hypot(handle.x - x, handle.y - y) > Math.max(30, 60 * zoom));
		if (where === 'rightEdge') {
			const x = Math.round(canvas.right - 60);
			for (const fraction of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
				const y = Math.round(canvas.top + (canvas.bottom - canvas.top) * fraction);
				if (clear(x, y)) {
					return { x, y };
				}
			}
			return undefined;
		}
		for (const { path, rect } of nodes) {
			const x = Math.round(rect.left - 40 * zoom);
			const y = Math.round(rect.top - 10 * zoom);
			if (path !== sourcePath && clear(x, y)) {
				return { x, y, beside: path };
			}
		}
		return undefined;
	}, { where, sourcePath });
	if (!point) {
		throw new Error(`No empty canvas point to release a connection line at: ${where}`);
	}
	return point;
}

// Drags a connection from `sourcePath` and releases it at `point`. Returns the
// release point on screen and in canvas coordinates, and the view it was
// released in.
async function dropCanvasConnectionAt(page, sourcePath, point) {
	await startCanvasConnectionDrag(page, sourcePath);
	await page.mouse.move(point.x, point.y, { steps: 8 });
	const view = await readCanvasView(page);
	await page.mouse.up();
	return { screen: { x: point.x, y: point.y }, canvas: { x: (point.x - view.x) / view.zoom, y: (point.y - view.y) / view.zoom }, view };
}

// A card created from a connection line is where the line was released: the
// middle of its west side is at the release point, also when the card reaches
// past the edge of the window or into another card. Nothing else moves for
// it: no other card, and not the view, which is the user's to move (canvas
// card placement, criteria 34 and 35).
async function assertCanvasCardCreatedWhereLineWasReleased(page, canvasPath, cardPath, drop, otherRows) {
	const screenPixel = 1 / drop.view.zoom + 0.01;
	const released = candidate => candidate !== undefined
		&& Math.abs(candidate.x - drop.canvas.x) <= screenPixel && Math.abs(candidate.y + candidate.height / 2 - drop.canvas.y) <= screenPixel;
	// A drawing between the new file and its row can save another place for a
	// moment, so the row is read until it is the card's own.
	let row;
	const deadline = Date.now() + 10_000;
	while (!released(row = readCanvasCardGeometry(fs.readFileSync(canvasPath, 'utf8'), cardPath))) {
		if (Date.now() > deadline) {
			throw new Error(`${cardPath} must be where its line was released: ${JSON.stringify({ row, released: drop.canvas })}`);
		}
		await page.waitForTimeout(50);
	}
	const raw = fs.readFileSync(canvasPath, 'utf8');
	const moved = Object.entries(otherRows).filter(([otherPath, before]) => before !== undefined && JSON.stringify(readCanvasCardGeometry(raw, otherPath)) !== JSON.stringify(before)).map(([otherPath]) => otherPath);
	if (moved.length > 0) {
		throw new Error(`Creating ${cardPath} must not change another card's row: ${moved.join(', ')}`);
	}
	// What is drawn is what is stored.
	const drawnBy = Date.now() + 10_000;
	for (; ;) {
		const drawn = (await readCanvasCardPlaces(page, [cardPath]))[cardPath];
		if (Math.abs(drawn.x - row.x) <= 1 && Math.abs(drawn.y - row.y) <= 1) {
			break;
		}
		if (Date.now() > drawnBy) {
			throw new Error(`${cardPath} must be drawn where its row says: ${JSON.stringify({ drawn, row })}`);
		}
		await page.waitForTimeout(50);
	}
	// The view stays where the user had it, after everything the create starts has run.
	await page.waitForTimeout(500);
	const view = await readCanvasView(page);
	if (Math.abs(view.x - drop.view.x) > 0.5 || Math.abs(view.y - drop.view.y) > 0.5 || Math.abs(view.zoom - drop.view.zoom) > 0.001) {
		throw new Error(`Creating ${cardPath} must not move the view: ${JSON.stringify({ before: drop.view, after: view })}`);
	}
	return row;
}

// The Create from Connection menu item `label`, after checking the menu opened
// at the release point and not as Quick Input.
async function connectionCreateMenuAction(page, release, label) {
	const action = page.locator(`.context-view.monaco-menu-container .action-label[aria-label="${label}"]`).last();
	await action.waitFor({ state: 'visible', timeout: 10_000 });
	if (await page.locator('.quick-input-widget').isVisible()) {
		throw new Error('Create from Connection opened Quick Input instead of the canvas create menu');
	}
	const menu = await page.locator('.context-view.monaco-menu-container').last().boundingBox();
	if (!menu) {
		throw new Error('Missing Create from Connection menu geometry');
	}
	const nearest = {
		x: Math.min(Math.max(release.x, menu.x), menu.x + menu.width),
		y: Math.min(Math.max(release.y, menu.y), menu.y + menu.height)
	};
	if (pointDistance(nearest, release) > 32) {
		throw new Error(`Create from Connection menu opened at ${JSON.stringify(menu)}, away from the release point ${JSON.stringify(release)}`);
	}
	// VS Code attaches menu mouse-up listeners after a 100 ms guard against the
	// pointer event that opened the menu.
	await page.waitForTimeout(150);
	return action;
}

// Create from Connection: each item creates a node whose first bytes list the
// source as upstream (D37), draws the edge, and leaves the source unchanged. A
// created .bhnode, its card, and its edge go away in one canvas undo step. The
// card is where the line was released, and the view stays where it is.
async function assertCanvasCreateFromConnection(page) {
	const source = 'README.md';
	const canvasPath = path.join(workspacePath, '.bh', 'mirror', 'canvas.yaml');
	const notePath = path.join(workspacePath, 'untitled.md');
	if (fs.existsSync(notePath)) {
		throw new Error('Create from Connection needs a canvas without untitled.md');
	}
	const readme = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${source}"]`);
	await frameCanvasCardsForConnection(page, [readme]);
	await page.locator('.basehalf-canvas-cards').focus();
	await page.keyboard.press('Escape');
	const sourceBefore = readWorkspaceFile(source);

	// A connected node takes the first default name with no file or canvas row,
	// so an earlier step's leftover row can move it to `image-N.bhnode`.
	const imageNodes = () => fs.readdirSync(workspacePath).filter(name => /^image(-\d+)?\.bhnode$/.test(name));
	const imagesBefore = new Set(imageNodes());
	const rowsOfShownCards = async () => {
		const raw = fs.readFileSync(canvasPath, 'utf8');
		const shown = await page.locator('.basehalf-canvas-card[data-basehalf-card-path]').evaluateAll(cards => cards.map(card => card.getAttribute('data-basehalf-card-path')));
		return Object.fromEntries(shown.map(cardPath => [cardPath, readCanvasCardGeometry(raw, cardPath)]));
	};
	// Released near the right edge of the canvas: the card reaches past it.
	const rowsBeforeImage = await rowsOfShownCards();
	const imageDrop = await dropCanvasConnectionAt(page, source, await canvasConnectionReleasePoint(page, 'rightEdge', source));
	await (await connectionCreateMenuAction(page, imageDrop.screen, 'Image')).click();
	let image;
	await waitUntil(() => (image = imageNodes().find(name => !imagesBefore.has(name))) !== undefined, 'Create from Connection to create an image node');
	const imagePath = path.join(workspacePath, image);
	const imageRow = await assertCanvasCardCreatedWhereLineWasReleased(page, canvasPath, image, imageDrop, rowsBeforeImage);
	if ((imageRow.x + imageRow.width) * imageDrop.view.zoom + imageDrop.view.x <= imageDrop.view.canvas.right) {
		throw new Error(`The line must be released where the card reaches past the right edge of the canvas: ${JSON.stringify({ imageRow, view: imageDrop.view })}`);
	}
	const document = JSON.parse(fs.readFileSync(imagePath, 'utf8'));
	if (document.version !== 5 || document.kind !== 'image' || document.title !== 'Image' || JSON.stringify(document.upstream) !== JSON.stringify([source]) || Object.hasOwn(document, 'recipe')) {
		throw new Error(`Create from Connection created the wrong Image document: ${JSON.stringify(document)}`);
	}
	await assertCanvasEdgeVisible(page, source, image);
	// The new edge replaces the line kept while the menu was open.
	await page.locator('[data-testid="canvas-connection-drop-line"]').waitFor({ state: 'detached', timeout: 5_000 });
	await waitForCanvasCardSelection(page, image);
	await waitUntil(() => fs.readFileSync(canvasPath, 'utf8').includes(`to: "${image}"`), 'canvas.yaml to remember the anchors of the created edge');
	await readme.focus();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
	await waitUntil(() => !fs.existsSync(imagePath), `one canvas undo to remove the created ${image}`, 15_000);
	await assertCanvasEdgeGone(page, source, image);
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${image}"]`).waitFor({ state: 'detached', timeout: 10_000 });

	// Released just beside another card: the note lies on that card.
	const rowsBeforeNote = await rowsOfShownCards();
	const notePoint = await canvasConnectionReleasePoint(page, 'besideCard', source);
	const noteDrop = await dropCanvasConnectionAt(page, source, notePoint);
	await (await connectionCreateMenuAction(page, noteDrop.screen, 'Note')).click();
	await waitUntil(() => fs.existsSync(notePath), 'Create from Connection to create untitled.md');
	const noteRow = await assertCanvasCardCreatedWhereLineWasReleased(page, canvasPath, 'untitled.md', noteDrop, rowsBeforeNote);
	const besideRow = rowsBeforeNote[notePoint.beside];
	if (!besideRow || noteRow.x >= besideRow.x + besideRow.width || besideRow.x >= noteRow.x + noteRow.width
		|| noteRow.y >= besideRow.y + besideRow.height || besideRow.y >= noteRow.y + noteRow.height) {
		throw new Error(`The note released beside ${notePoint.beside} must lie on it: ${JSON.stringify({ noteRow, besideRow })}`);
	}
	const noteText = readWorkspaceFile('untitled.md');
	if (noteText !== `---\nupstream:\n  - ${source}\n---\n`) {
		throw new Error(`Create from Connection note must start with only its upstream frontmatter, got ${JSON.stringify(noteText)}`);
	}
	const editor = await waitForCanvasNoteInlineEditor(page, 'untitled.md');
	await assertCanvasEdgeVisible(page, source, 'untitled.md');
	await page.keyboard.press('Escape');
	await editor.host.waitFor({ state: 'detached', timeout: 10_000 });
	fs.rmSync(notePath, { force: true });
	await page.locator('.basehalf-canvas-card[data-basehalf-card-path="untitled.md"]').waitFor({ state: 'detached', timeout: 10_000 });
	if (readWorkspaceFile(source) !== sourceBefore) {
		throw new Error('Create from Connection changed the source card instead of only the new node');
	}
}

// Canvas undo of a connection after the note was opened and closed again:
// the undo step re-resolves the note and removes exactly its entry, leaving the
// note's original bytes; redo writes the entry back. The anchor row stays.
async function assertCanvasUndoAfterClosingNote(page) {
	const note = AGENT_CREATED_CARD_PATH;
	const canvasPath = path.join(workspacePath, '.bh', 'mirror', 'canvas.yaml');
	const connected = agentNoteWithUpstream(['docs']);
	if (readWorkspaceFile(note) !== connected) {
		throw new Error(`${note} must hold the docs connection before canvas undo`);
	}
	await openExplorerRow(page, note);
	await assertCardDetail(page, note);
	await closeCardDetailIfOpen(page);
	await assertCanvasFolder(page, '');
	const docs = page.locator('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
	await docs.waitFor({ state: 'visible', timeout: 10_000 });
	const undoKey = process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z';
	const redoKey = process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y';
	await docs.focus();
	await page.keyboard.press(undoKey);
	await waitUntil(() => readWorkspaceFile(note) === AGENT_CREATED_CARD_CONTENT, `canvas undo to remove the docs entry from ${note} after it was closed`, 15_000);
	await assertCanvasEdgeGone(page, 'docs', note);
	if (!fs.readFileSync(canvasPath, 'utf8').includes(`to: "${note}"`)) {
		throw new Error('Canvas undo of a connection removed its anchor row');
	}
	await docs.focus();
	await page.keyboard.press(redoKey);
	await waitUntil(() => readWorkspaceFile(note) === connected, `canvas redo to write the docs entry back into ${note}`, 15_000);
	await assertCanvasEdgeVisible(page, 'docs', note);
	// Leave docs centered at 100%, where the card drag and resize checks run.
	await zoomCanvas(page, 'reset');
	await page.waitForFunction(() => Number(document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom')) >= 0.5, null, { timeout: 10_000 });
	await centerCanvasCards(page, [docs]);
}

async function assertCanvasInlineRename(page) {
	const readme = page.locator('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
	await readme.focus();
	await page.keyboard.press('F2');
	const input = readme.locator('.basehalf-canvas-inline-name-input input');
	await input.waitFor({ state: 'visible', timeout: 10_000 });
	const value = await input.inputValue();
	if (value !== 'README') {
		throw new Error(`Expected inline rename to hold the name of the note, got ${JSON.stringify(value)}`);
	}
	if (await page.locator('.quick-input-widget').isVisible()) {
		throw new Error('Canvas rename unexpectedly opened Quick Input instead of the card-local editor');
	}
	await input.fill('README-renamed.md');
	await input.press('Escape');
	await page.waitForFunction(() => !document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"] .basehalf-canvas-inline-name-input input'), null, { timeout: 10_000 });
	await readme.waitFor({ state: 'visible', timeout: 10_000 });

	await readme.focus();
	await page.keyboard.press('F2');
	// Typed, not filled: the editor has the keyboard by itself. It holds the
	// name of the note, all of it selected, and the file keeps its extension.
	await waitForCanvasNameEditor(page, 'README.md', { value: 'README', selection: [0, 6] });
	await page.keyboard.type('README-renamed');
	await page.keyboard.press('Enter');
	await waitUntil(() => !fs.existsSync(path.join(workspacePath, 'README.md')) && fs.existsSync(path.join(workspacePath, 'README-renamed.md')), 'canvas inline rename to commit');
	const renamed = page.locator('.basehalf-canvas-card[data-basehalf-card-path="README-renamed.md"]');
	await renamed.waitFor({ state: 'visible', timeout: 10_000 });

	await renamed.focus();
	await page.keyboard.press('F2');
	const restoreInput = renamed.locator('.basehalf-canvas-inline-name-input input');
	await restoreInput.fill('README.md');
	await restoreInput.press('Enter');
	await waitUntil(() => fs.existsSync(path.join(workspacePath, 'README.md')) && !fs.existsSync(path.join(workspacePath, 'README-renamed.md')), 'canvas inline rename to restore the fixture');
	await readme.waitFor({ state: 'visible', timeout: 10_000 });
	// The name that restored the fixture was filled in with its extension: it
	// is the file name, and no second extension was added.
	if (fs.existsSync(path.join(workspacePath, 'README.md.md'))) {
		throw new Error('A note name typed with its extension got the extension twice');
	}
	await assertCanvasCardNameRenamesInPlace(page);
}

/** Waits until the rename editor of a card is open with the keyboard, and checks what it holds. */
async function waitForCanvasNameEditor(page, cardPath, expected) {
	const selector = `.basehalf-canvas-card[data-basehalf-card-path="${cardPath}"] .basehalf-canvas-inline-name-input input`;
	await page.locator(selector).waitFor({ state: 'visible', timeout: 10_000 });
	const read = () => page.evaluate(inputSelector => {
		const input = document.querySelector(inputSelector);
		return input instanceof HTMLInputElement
			? { value: input.value, selection: [input.selectionStart, input.selectionEnd], focused: document.activeElement === input }
			: undefined;
	}, selector);
	const wanted = JSON.stringify({ ...expected, focused: true });
	const deadline = Date.now() + 5_000;
	let seen;
	do {
		seen = await read();
		if (JSON.stringify(seen) === wanted) {
			return;
		}
		await page.waitForTimeout(50);
	} while (Date.now() < deadline);
	throw new Error(`The rename editor of ${cardPath} is not ready for typing: ${JSON.stringify({ expected, seen })}`);
}

/**
 * The name of a card (canvas card name): the text cursor over the text alone,
 * and the double click that renames in place.
 */
async function assertCanvasCardNameRenamesInPlace(page) {
	const cardSelector = cardPath => `.basehalf-canvas-card[data-basehalf-card-path="${cardPath}"]`;
	const readme = page.locator(cardSelector('README.md'));
	const docs = page.locator(cardSelector('docs'));
	const docsBefore = await docs.boundingBox();
	if (!docsBefore) {
		throw new Error('The docs card has no place before the card name checks');
	}
	const caption = cardPath => page.evaluate(selector => {
		const card = document.querySelector(selector);
		const label = card?.querySelector('.basehalf-canvas-card-label');
		const glyph = card?.querySelector('.basehalf-canvas-card-caption-icon');
		const badge = card?.querySelector('.basehalf-canvas-card-badge-toggle');
		const identity = card?.querySelector('.basehalf-canvas-card-caption-identity');
		if (!card || !label || !glyph || !badge || !identity) {
			return undefined;
		}
		const range = document.createRange();
		range.selectNodeContents(label);
		const labelBox = label.getBoundingClientRect();
		const glyphBox = glyph.getBoundingClientRect();
		const badgeBox = badge.getBoundingClientRect();
		const middle = labelBox.top + labelBox.height / 2;
		const cursorAt = (x, y) => {
			const hit = document.elementFromPoint(x, y);
			return hit ? getComputedStyle(hit).cursor : undefined;
		};
		const name = { x: labelBox.left + Math.min(12, labelBox.width / 2), y: middle };
		const glyphPoint = { x: glyphBox.left + glyphBox.width / 2, y: glyphBox.top + glyphBox.height / 2 };
		return {
			name,
			glyph: glyphPoint,
			text: label.textContent,
			rows: [...card.querySelectorAll('.basehalf-canvas-folder-preview-label')].map(row => row.textContent),
			labelLeft: labelBox.left,
			labelTop: labelBox.top,
			labelHeight: labelBox.height,
			font: (style => `${style.fontSize} ${style.fontWeight} ${style.lineHeight} ${style.color}`)(getComputedStyle(label)),
			labelWidth: labelBox.width,
			textWidth: range.getBoundingClientRect().width,
			identityWidth: identity.getBoundingClientRect().width,
			nameHit: document.elementFromPoint(name.x, name.y) === label,
			rightOfNameHit: document.elementFromPoint(labelBox.right + 8, middle) === label,
			cursors: {
				name: cursorAt(name.x, name.y),
				glyph: cursorAt(glyphPoint.x, glyphPoint.y),
				rightOfName: cursorAt(labelBox.right + 8, middle),
				badge: cursorAt(badgeBox.left + badgeBox.width / 2, badgeBox.top + badgeBox.height / 2)
			}
		};
	}, cardSelector(cardPath));
	const canvasState = () => page.evaluate(() => ({
		editor: document.querySelector('.basehalf-canvas-inline-name-input input')?.closest('.basehalf-canvas-card')?.getAttribute('data-basehalf-card-path') ?? null,
		selected: [...document.querySelectorAll('.basehalf-canvas-card.selected')].map(card => card.getAttribute('data-basehalf-card-path')),
		toolbar: !!document.querySelector('.basehalf-canvas-selection-toolbar, .basehalf-canvas-note-toolbar'),
		noteEditing: document.querySelectorAll('.basehalf-canvas-card[data-note-editing="true"]').length,
		cardDetail: !!document.querySelector('.basehalf-card-detail.visible')
	}));
	const expectState = async (expected, context) => {
		const deadline = Date.now() + 5_000;
		let seen;
		do {
			seen = await canvasState();
			if (JSON.stringify(seen) === JSON.stringify(expected)) {
				return;
			}
			await page.waitForTimeout(50);
		} while (Date.now() < deadline);
		throw new Error(`Unexpected canvas state ${context}: ${JSON.stringify({ expected, seen })}`);
	};
	const doubleClick = async point => {
		await page.mouse.move(point.x, point.y);
		await page.mouse.dblclick(point.x, point.y);
	};
	// The rename editor as it is drawn: where its text stands, in what type,
	// and whether anything frames it or says that the name cannot be used.
	const nameEditor = () => page.evaluate(() => {
		const input = document.querySelector('.basehalf-canvas-card .basehalf-canvas-inline-name-input input');
		const frame = input?.closest('.monaco-inputbox');
		if (!(input instanceof HTMLInputElement) || !frame) {
			return undefined;
		}
		const box = input.getBoundingClientRect();
		const style = getComputedStyle(input);
		const frameStyle = getComputedStyle(frame);
		const message = document.querySelector('.monaco-inputbox-message');
		return {
			left: box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
			top: box.top,
			height: box.height,
			width: box.width,
			font: `${style.fontSize} ${style.fontWeight} ${style.lineHeight} ${style.color}`,
			frame: [style.borderLeftWidth, style.paddingLeft, style.backgroundColor, style.outlineStyle, frameStyle.borderLeftWidth, frameStyle.borderTopWidth, frameStyle.backgroundColor, frameStyle.outlineStyle].join(' '),
			underlined: style.textDecorationLine.includes('underline'),
			message: message && message.getClientRects().length > 0 ? message.textContent : null
		};
	});

	await centerCanvasCards(page, [readme]);
	const atRest = await caption('README.md');
	// A note is named without its extension, on its card and in a folder card.
	const folderAtRest = await caption('docs');
	if (!atRest || !folderAtRest
		|| atRest.text !== 'README'
		|| folderAtRest.text !== 'docs'
		|| !folderAtRest.rows.some(row => row === 'guide' || row === 'far')
		|| folderAtRest.rows.some(row => /\.md$/i.test(row ?? ''))) {
		throw new Error(`A note is not named without its extension: ${JSON.stringify({ note: atRest?.text, folder: folderAtRest?.text, rows: folderAtRest?.rows })}`);
	}
	if (!atRest
		|| atRest.cursors.name !== 'text'
		|| atRest.cursors.glyph === 'text'
		|| atRest.cursors.rightOfName === 'text'
		|| atRest.cursors.badge === 'text'
		|| !atRest.nameHit
		|| atRest.rightOfNameHit
		|| Math.abs(atRest.labelWidth - atRest.textWidth) > 1
		|| atRest.labelWidth > atRest.identityWidth - 24) {
		throw new Error(`The name of a card does not take the text cursor over its text alone: ${JSON.stringify(atRest)}`);
	}

	// A double click on the name: the editor, the keyboard, and nothing opened.
	const placeBefore = await readme.boundingBox();
	// Changing a name selects no card: between the first press and the open
	// editor no frame shows a selected card or the toolbar of one. The two
	// clicks come as a person's do, so a toolbar that the first one brought up
	// would have its frames.
	await page.mouse.move(atRest.name.x, atRest.name.y);
	await page.evaluate(() => {
		const watch = { selected: 0, toolbar: 0, stop: false };
		(window as typeof window & { __basehalfSmokeNameSelection?: typeof watch }).__basehalfSmokeNameSelection = watch;
		const tick = () => {
			if (document.querySelector('.basehalf-canvas-card.selected')) {
				watch.selected++;
			}
			if (document.querySelector('.basehalf-canvas-selection-toolbar, .basehalf-canvas-note-toolbar')) {
				watch.toolbar++;
			}
			if (!watch.stop) {
				requestAnimationFrame(tick);
			}
		};
		requestAnimationFrame(tick);
	});
	await page.mouse.click(atRest.name.x, atRest.name.y);
	await page.waitForTimeout(200);
	await expectState({ editor: null, selected: [], toolbar: false, noteEditing: 0, cardDetail: false }, 'after one click on the name of a note');
	await page.mouse.click(atRest.name.x, atRest.name.y, { clickCount: 2 });
	await waitForCanvasNameEditor(page, 'README.md', { value: 'README', selection: [0, 6] });
	await expectState({ editor: 'README.md', selected: [], toolbar: false, noteEditing: 0, cardDetail: false }, 'after a double click on the name of a note');
	const selectionFrames = await page.evaluate(() => {
		const watch = (window as typeof window & { __basehalfSmokeNameSelection?: { selected: number; toolbar: number; stop: boolean } }).__basehalfSmokeNameSelection;
		if (!watch) {
			return { selected: -1, toolbar: -1 };
		}
		watch.stop = true;
		return { selected: watch.selected, toolbar: watch.toolbar };
	});
	if (selectionFrames.selected !== 0 || selectionFrames.toolbar !== 0) {
		throw new Error(`A double click on the name of a card showed the card selected on the way to its editor: ${JSON.stringify(selectionFrames)}`);
	}

	// The editor is not disturbed by what happens in the folder meanwhile: a
	// file of another card, and the very note that is being renamed. The caret
	// stands inside the typed text, so a caret that went to the end shows.
	await page.keyboard.type('README-by');
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('ArrowLeft');
	await page.evaluate(() => {
		const input = document.querySelector('.basehalf-canvas-inline-name-input input');
		const watch = { input, card: input?.closest('.basehalf-canvas-card'), lost: [] as string[], stop: false };
		(window as typeof window & { __basehalfSmokeNameEditor?: typeof watch }).__basehalfSmokeNameEditor = watch;
		const tick = () => {
			if (!(input instanceof HTMLInputElement) || !input.isConnected || document.activeElement !== input
				|| input.value !== 'README-by' || input.selectionStart !== 7 || input.selectionEnd !== 7) {
				watch.lost.push(JSON.stringify(input instanceof HTMLInputElement
					? { connected: input.isConnected, focused: document.activeElement === input, value: input.value, caret: [input.selectionStart, input.selectionEnd] }
					: null));
			}
			if (!watch.stop && watch.lost.length < 5) {
				requestAnimationFrame(tick);
			}
		};
		requestAnimationFrame(tick);
	});
	const nameEditorWatch = () => page.evaluate(() => {
		const watch = (window as typeof window & { __basehalfSmokeNameEditor?: { card: Element | null | undefined; lost: string[]; stop: boolean } }).__basehalfSmokeNameEditor;
		if (!watch) {
			return { lost: ['the watch of the rename editor is gone'], sameCard: true };
		}
		return {
			lost: watch.lost,
			sameCard: document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]') === watch.card
		};
	});
	// Another card's file: the card of the editor is kept as it is.
	const probePath = path.join(workspacePath, 'docs', 'name-editor-probe.md');
	const readmePath = path.join(workspacePath, 'README.md');
	const readmeBytes = fs.readFileSync(readmePath);
	fs.writeFileSync(probePath, '# Written while a name is edited\n', 'utf8');
	await page.waitForTimeout(1_200);
	fs.rmSync(probePath);
	await page.waitForTimeout(1_200);
	const afterOtherFile = await nameEditorWatch();
	if (afterOtherFile.lost.length > 0 || !afterOtherFile.sameCard) {
		throw new Error(`The rename editor did not stay as it was while another file of the folder changed: ${JSON.stringify(afterOtherFile)}`);
	}
	// The note that is being renamed: its card is drawn again with other
	// content, and the editor moves into the new drawing.
	fs.writeFileSync(readmePath, Buffer.concat([readmeBytes, Buffer.from('\nname-editor-probe\n', 'utf8')]));
	await readme.locator('.bh-md-preview p', { hasText: 'name-editor-probe' }).first().waitFor({ state: 'visible', timeout: 15_000 });
	const afterOwnFile = await nameEditorWatch();
	if (afterOwnFile.lost.length > 0 || afterOwnFile.sameCard) {
		throw new Error(`The rename editor did not move into the new drawing of its card: ${JSON.stringify(afterOwnFile)}`);
	}
	fs.writeFileSync(readmePath, readmeBytes);
	await readme.locator('.bh-md-preview p', { hasText: 'name-editor-probe' }).first().waitFor({ state: 'detached', timeout: 15_000 });
	const lost = await page.evaluate(() => {
		const watch = (window as typeof window & { __basehalfSmokeNameEditor?: { lost: string[]; stop: boolean } }).__basehalfSmokeNameEditor;
		if (!watch) {
			return ['the watch of the rename editor is gone'];
		}
		watch.stop = true;
		return watch.lost;
	});
	if (lost.length > 0) {
		throw new Error(`The rename editor did not stay as it was while the renamed note was written: ${lost.join(' ')}`);
	}
	// The caret is where it was: two characters before the end of the typed part.
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('ArrowRight');
	await page.keyboard.type('-name');
	await page.keyboard.press('Enter');
	await waitUntil(() => !fs.existsSync(path.join(workspacePath, 'README.md')) && fs.existsSync(path.join(workspacePath, 'README-by-name.md')), 'the double-clicked name to rename the note');
	const byName = page.locator(cardSelector('README-by-name.md'));
	await byName.waitFor({ state: 'visible', timeout: 10_000 });
	await expectState({ editor: null, selected: [], toolbar: false, noteEditing: 0, cardDetail: false }, 'after Enter in the rename editor');
	const placeAfter = await byName.boundingBox();
	if (!placeBefore || !placeAfter
		|| Math.abs(placeAfter.x - placeBefore.x) > 1 || Math.abs(placeAfter.y - placeBefore.y) > 1
		|| Math.abs(placeAfter.width - placeBefore.width) > 1 || Math.abs(placeAfter.height - placeBefore.height) > 1) {
		throw new Error(`A card renamed from its name did not keep its place: ${JSON.stringify({ placeBefore, placeAfter })}`);
	}

	// Escape renames nothing. Then the fixture gets its name back.
	const renamed = await caption('README-by-name.md');
	await doubleClick(renamed.name);
	await waitForCanvasNameEditor(page, 'README-by-name.md', { value: 'README-by-name', selection: [0, 14] });

	// The editor is the name made editable: its text stands where the name
	// stood, in the same type, and nothing frames it.
	const opened = await nameEditor();
	if (!opened || !renamed
		|| Math.abs(opened.left - renamed.labelLeft) > 0.5
		|| Math.abs(opened.top - renamed.labelTop) > 0.5
		|| Math.abs(opened.height - renamed.labelHeight) > 0.5
		|| Math.abs(opened.width - renamed.textWidth) > 1
		|| opened.font !== renamed.font
		|| opened.frame !== '0px 0px rgba(0, 0, 0, 0) none 0px 0px rgba(0, 0, 0, 0) none'
		|| opened.underlined || opened.message !== null) {
		throw new Error(`The rename editor is not the name in place: ${JSON.stringify({ opened, atRest: { left: renamed?.labelLeft, top: renamed?.labelTop, height: renamed?.labelHeight, width: renamed?.textWidth, font: renamed?.font } })}`);
	}
	// What is done inside the editor stays there: a click in the middle of the
	// text puts the caret there, and no card is selected by it.
	const editorBox = await page.locator('.basehalf-canvas-card .basehalf-canvas-inline-name-input input').boundingBox();
	if (!editorBox) {
		throw new Error('The rename editor has no box for the click inside it');
	}
	await page.mouse.click(editorBox.x + editorBox.width / 2, editorBox.y + editorBox.height / 2);
	await page.waitForTimeout(400);
	const caret = await page.evaluate(() => {
		const input = document.querySelector('.basehalf-canvas-card .basehalf-canvas-inline-name-input input');
		return input instanceof HTMLInputElement
			? { start: input.selectionStart ?? -1, end: input.selectionEnd ?? -1, length: input.value.length, focused: document.activeElement === input }
			: undefined;
	});
	if (!caret || !caret.focused || caret.start !== caret.end || caret.start <= 0 || caret.start >= caret.length) {
		throw new Error(`A click in the middle of the rename editor did not put the caret there: ${JSON.stringify(caret)}`);
	}
	await expectState({ editor: 'README-by-name.md', selected: [], toolbar: false, noteEditing: 0, cardDetail: false }, 'after a click inside the rename editor');
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
	// It is as wide as its text.
	await page.keyboard.type('ab');
	const short = await nameEditor();
	await page.keyboard.type('cdefgh');
	const longer = await nameEditor();
	if (!short || !longer || !(short.width < opened.width - 20) || !(longer.width > short.width + 20)) {
		throw new Error(`The rename editor is not as wide as its text: ${JSON.stringify({ opened: opened.width, short: short?.width, longer: longer?.width })}`);
	}
	// A name that cannot be used is marked in the text while it is typed, and
	// the reason comes when Enter is refused.
	await page.keyboard.type('/x');
	await page.waitForTimeout(400);
	const unusable = await nameEditor();
	if (!unusable?.underlined || unusable.message !== null) {
		throw new Error(`A name that cannot be used is not marked quietly while it is typed: ${JSON.stringify(unusable)}`);
	}
	await page.keyboard.press('Enter');
	await page.waitForTimeout(600);
	const refused = await nameEditor();
	if (!refused?.underlined || !refused.message) {
		throw new Error(`Enter on a name that cannot be used did not keep the editor open with the reason: ${JSON.stringify(refused)}`);
	}
	await page.keyboard.press('Backspace');
	await page.keyboard.press('Backspace');
	await page.waitForTimeout(400);
	const usable = await nameEditor();
	if (!usable || usable.underlined || usable.message !== null) {
		throw new Error(`A name that can be used again is still marked: ${JSON.stringify(usable)}`);
	}
	await page.keyboard.press('Escape');
	await expectState({ editor: null, selected: [], toolbar: false, noteEditing: 0, cardDetail: false }, 'after Escape in the rename editor');
	if (!fs.existsSync(path.join(workspacePath, 'README-by-name.md')) || fs.existsSync(path.join(workspacePath, 'abcdefgh.md'))) {
		throw new Error('Escape in the rename editor renamed the note');
	}
	await doubleClick(renamed.name);
	await waitForCanvasNameEditor(page, 'README-by-name.md', { value: 'README-by-name', selection: [0, 14] });
	await page.keyboard.type('README');
	await page.keyboard.press('Enter');
	await waitUntil(() => fs.existsSync(path.join(workspacePath, 'README.md')) && !fs.existsSync(path.join(workspacePath, 'README-by-name.md')), 'the double-clicked name to restore the fixture');
	await readme.waitFor({ state: 'visible', timeout: 10_000 });
	await expectState({ editor: null, selected: [], toolbar: false, noteEditing: 0, cardDetail: false }, 'after the fixture got its name back');

	// The glyph of a note is not the name: nothing opens.
	await doubleClick((await caption('README.md')).glyph);
	await page.waitForTimeout(600);
	// The glyph is the card: it selects it, and the card's toolbar comes up.
	await expectState({ editor: null, selected: ['README.md'], toolbar: true, noteEditing: 0, cardDetail: false }, 'after a double click on the glyph of a note');

	// The name of a folder is renamed in place, and the folder is not entered.
	// Earlier steps leave cards where their drags ended, and one can lie over
	// the name of a folder: the folder whose name is on top is taken.
	let folderPath;
	let folder;
	const seenFolders = {};
	for (const candidate of ['docs', 'src']) {
		await centerCanvasCards(page, [page.locator(cardSelector(candidate))]);
		const seen = await caption(candidate);
		seenFolders[candidate] = seen;
		if (seen?.nameHit) {
			folderPath = candidate;
			folder = seen;
			break;
		}
	}
	if (!folderPath || !folder) {
		throw new Error(`No folder card has its name on top for the card name checks: ${JSON.stringify(seenFolders)}`);
	}
	if (folder.cursors.name !== 'text' || folder.cursors.glyph === 'text') {
		throw new Error(`The name of a folder card does not take the text cursor: ${JSON.stringify(folder)}`);
	}
	await doubleClick(folder.name);
	await waitForCanvasNameEditor(page, folderPath, { value: folderPath, selection: [0, folderPath.length] });
	await expectState({ editor: folderPath, selected: [], toolbar: false, noteEditing: 0, cardDetail: false }, 'after a double click on the name of a folder');
	await assertCanvasFolder(page, '');
	await page.keyboard.press('Escape');
	await expectState({ editor: null, selected: [], toolbar: false, noteEditing: 0, cardDetail: false }, 'after Escape in the rename editor of a folder');

	// Hand the canvas back as the step found it: nothing selected, docs in place.
	const emptyCanvas = await page.evaluate(() => {
		const pane = document.querySelector('.react-flow__pane');
		if (!pane) {
			return undefined;
		}
		const rect = pane.getBoundingClientRect();
		for (let y = rect.bottom - 48; y > rect.top + 48; y -= 48) {
			for (let x = rect.right - 48; x > rect.left + 48; x -= 48) {
				if (document.elementFromPoint(x, y) === pane) {
					return { x, y };
				}
			}
		}
		return undefined;
	});
	if (!emptyCanvas) {
		throw new Error('No empty canvas point to end the selection after the card name checks');
	}
	await page.mouse.click(emptyCanvas.x, emptyCanvas.y);
	await expectState({ editor: null, selected: [], toolbar: false, noteEditing: 0, cardDetail: false }, 'after the card name checks');
	await panCanvasCardTo(page, docs, { x: docsBefore.x, y: docsBefore.y });
}

async function assertCanvasDoubleClickCreateMenu(page) {
	const pane = page.locator('.react-flow__pane');
	await pane.waitFor({ state: 'visible', timeout: 10_000 });
	const point = await pane.evaluate(element => {
		const rect = element.getBoundingClientRect();
		for (let y = rect.top + 48; y < rect.bottom - 48; y += 48) {
			for (let x = rect.left + 48; x < rect.right - 48; x += 48) {
				if (element.ownerDocument.elementFromPoint(x, y) === element) {
					return { x, y };
				}
			}
		}
		return undefined;
	});
	if (!point) {
		throw new Error('Could not find an unobstructed canvas point for the double-click create menu');
	}

	await page.mouse.dblclick(point.x, point.y, { button: 'left', delay: 50 });
	const createAction = page.locator('.context-view.monaco-menu-container .action-label[aria-label="New Note"]').last();
	await createAction.waitFor({ state: 'visible', timeout: 10_000 });
	await page.keyboard.press('Escape');
	await createAction.waitFor({ state: 'hidden', timeout: 10_000 });
}

async function assertCanvasCreateResultNodeSubmenu(page) {
	await clickCanvasCreateSubmenuAction(page, 'New Media or Document', 'Image');
	const nodePath = path.join(workspacePath, 'image.bhnode');
	await waitUntil(() => fs.existsSync(nodePath), 'canvas result-node submenu to create an image node');
	if (await page.locator('.quick-input-widget').isVisible()) {
		throw new Error('Canvas result-node submenu unexpectedly opened Quick Input');
	}
	const document = JSON.parse(fs.readFileSync(nodePath, 'utf8'));
	if (document.version !== 5 || document.kind !== 'image' || document.title !== 'Image' || JSON.stringify(document.upstream) !== '[]') {
		throw new Error(`Canvas result-node submenu created the wrong document: ${JSON.stringify(document)}`);
	}
	const card = page.locator('.basehalf-canvas-card[data-basehalf-card-path="image.bhnode"]');
	await card.waitFor({ state: 'visible', timeout: 10_000 });
	await waitForCanvasCardSelection(page, 'image.bhnode');
	if (await page.locator('.basehalf-card-detail.visible').isVisible().catch(() => false)) {
		throw new Error('Canvas result-node creation opened content instead of leaving the new card selected');
	}
	fs.rmSync(nodePath, { force: true });
	await card.waitFor({ state: 'hidden', timeout: 10_000 });
}

/**
 * Mirror file resilience, acceptance criterion 10 in the product: a
 * description file that cannot be read, here one left with merge conflict
 * markers, is not something the user has to repair. The card shows no issue,
 * the description field stays usable, and saving keeps the old file as a
 * recovery copy.
 */
/**
 * Following moved items: a described file that is renamed with the file
 * system, outside the workbench, keeps its description at the new name, and
 * nothing of it is left under the old name.
 */
async function assertCanvasCardFollowsOutsideRename(page) {
	const mirror = name => path.join(workspacePath, '.bh', 'mirror', name);
	const card = name => page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${name}"]`);
	const lit = name => page.waitForFunction(cardPath => {
		const toggle = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${cardPath}"] .basehalf-canvas-card-badge-toggle`);
		return toggle instanceof HTMLElement && toggle.classList.contains('lit');
	}, name, { timeout: 15_000 });
	const before = 'follow-before.md';
	const after = 'follow-after.md';
	const description = 'Follows its file wherever it goes';

	fs.writeFileSync(path.join(workspacePath, before), '# A note that is renamed outside the window\n\nIts card has a description, and the description has to follow it.\n', 'utf8');
	await card(before).waitFor({ state: 'visible', timeout: 15_000 });
	fs.mkdirSync(mirror(before), { recursive: true });
	fs.writeFileSync(path.join(mirror(before), 'badge.yaml'), `path: "${before}"\nkind: file\ndescription: "${description}"\n`, 'utf8');
	await lit(before);
	// BaseHalf takes the new description into what it follows after its quiet second.
	await page.waitForTimeout(3_000);

	fs.renameSync(path.join(workspacePath, before), path.join(workspacePath, after));
	await waitUntil(() => {
		const badge = fs.readFileSync(path.join(mirror(after), 'badge.yaml'), 'utf8');
		return badge.includes(`path: "${after}"`) && badge.includes(description) && !fs.existsSync(mirror(before));
	}, 'the description to follow the file that was renamed outside the window', 15_000);
	await lit(after);
	if (await card(before).count() !== 0) {
		throw new Error('A card was left for the old name of a file that was renamed outside the window');
	}

	fs.rmSync(path.join(workspacePath, after), { force: true });
	fs.rmSync(mirror(after), { recursive: true, force: true });
	await card(after).waitFor({ state: 'detached', timeout: 15_000 });
}

/**
 * Following moved items: the folder whose canvas is open is renamed with the
 * file system. The canvas shows the same folder at its new path, with its
 * cards, and never the empty canvas with the file system's error text.
 */
async function assertCanvasFollowsRenamedOpenFolder(page) {
	const mirror = name => path.join(workspacePath, '.bh', 'mirror', name);
	const card = name => page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${name}"]`);
	const before = 'follow-folder-before';
	const after = 'follow-folder-after';

	fs.mkdirSync(path.join(workspacePath, before));
	fs.writeFileSync(path.join(workspacePath, before, 'inside.md'), '# A note inside a folder that is renamed outside the window\n\nThe canvas of the folder is open while it happens.\n', 'utf8');
	// A described folder is followed, and its files are what it is recognized by.
	fs.mkdirSync(mirror(before), { recursive: true });
	fs.writeFileSync(path.join(mirror(before), 'badge.yaml'), `path: "${before}"\nkind: folder\ndescription: "A folder that is renamed while it is open"\n`, 'utf8');
	await card(before).waitFor({ state: 'visible', timeout: 15_000 });
	await card(before).dblclick();
	await assertCanvasFolder(page, before);
	await card(`${before}/inside.md`).waitFor({ state: 'visible', timeout: 15_000 });
	await page.waitForTimeout(3_000);

	let sawError = false;
	const watch = setInterval(() => {
		void page.locator('.basehalf-canvas-empty').count().then(count => { sawError ||= count > 0; }).catch(() => undefined);
	}, 100);
	try {
		fs.renameSync(path.join(workspacePath, before), path.join(workspacePath, after));
		await assertCanvasFolder(page, after);
		await card(`${after}/inside.md`).waitFor({ state: 'visible', timeout: 15_000 });
	} finally {
		clearInterval(watch);
	}
	if (sawError) {
		throw new Error('The canvas showed an empty folder with an error while its folder was renamed outside the window');
	}
	await waitUntil(() => fs.existsSync(path.join(mirror(after), 'badge.yaml')) && !fs.existsSync(path.join(mirror(before), 'badge.yaml')), 'the description of the renamed folder to follow it');

	await openRootCanvas(page);
	fs.rmSync(path.join(workspacePath, after), { recursive: true, force: true });
	fs.rmSync(mirror(after), { recursive: true, force: true });
	fs.rmSync(mirror(before), { recursive: true, force: true });
	await card(after).waitFor({ state: 'detached', timeout: 15_000 });
}

/**
 * Following moved items: many files of the open folder are renamed at once
 * from outside the window, right after one of them went through a temporary
 * name. Every card keeps its description and the place it was given, and no
 * card is drawn anywhere else on the way.
 */
async function assertCanvasCardsFollowManyOutsideRenames(page) {
	const folderName = 'follow-many';
	const count = 12;
	const number = index => String(index).padStart(2, '0');
	const before = index => `${folderName}/note-${number(index)}.md`;
	const after = index => `${folderName}/renamed-${number(index)}.md`;
	const mirror = (...segments) => path.join(workspacePath, '.bh', 'mirror', ...segments);
	const card = name => page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${name}"]`);
	const place = index => ({ x: (index % 4) * 340, y: Math.floor(index / 4) * 260 });
	const description = index => `About note ${index} of the folder`;

	fs.mkdirSync(path.join(workspacePath, folderName));
	for (let index = 0; index < count; index++) {
		fs.writeFileSync(path.join(workspacePath, before(index)), `# Note ${index}\n\nNote number ${index} of a folder whose files are renamed at once, with words of its own: item${index}, topic${index}, and remark${index}.\n`, 'utf8');
	}
	// The folder and three of its notes are described, and every card is placed by hand.
	fs.mkdirSync(mirror(folderName), { recursive: true });
	fs.writeFileSync(mirror(folderName, 'badge.yaml'), `path: "${folderName}"\nkind: folder\ndescription: "A folder whose files are renamed at once"\n`, 'utf8');
	for (const index of [0, 1, 2]) {
		fs.mkdirSync(mirror(before(index)), { recursive: true });
		fs.writeFileSync(mirror(before(index), 'badge.yaml'), `path: "${before(index)}"\nkind: file\ndescription: "${description(index)}"\n`, 'utf8');
	}
	fs.writeFileSync(mirror(folderName, 'canvas.yaml'), [
		`path: "${folderName}"`,
		'cards:',
		...Array.from({ length: count }, (_, index) => [`  - path: "${before(index)}"`, '    kind: file', `    x: ${place(index).x}`, `    y: ${place(index).y}`, '    width: 300', '    height: 220'].join('\n')),
		'edges: []',
		''
	].join('\n'), 'utf8');

	await card(folderName).waitFor({ state: 'visible', timeout: 15_000 });
	await card(folderName).dblclick();
	await assertCanvasFolder(page, folderName);
	await card(before(count - 1)).waitFor({ state: 'visible', timeout: 15_000 });
	// BaseHalf takes the fingerprints of what it follows after its quiet second.
	await page.waitForTimeout(3_000);

	// One note goes through a temporary name. Its card follows it, and the canvas has waited once.
	const temporary = path.join(workspacePath, folderName, 'note-00.tmp.md');
	fs.renameSync(path.join(workspacePath, before(0)), temporary);
	await page.waitForTimeout(150);
	fs.renameSync(temporary, path.join(workspacePath, after(0)));
	await waitUntil(() => fs.readFileSync(mirror(after(0), 'badge.yaml'), 'utf8').includes(description(0)), 'the description to follow a note that was renamed through a temporary name', 15_000);
	await card(after(0)).waitFor({ state: 'visible', timeout: 15_000 });
	await page.waitForTimeout(1_500);

	// Every frame while the other notes are renamed: the cards of the folder, and where they are drawn.
	await page.evaluate(prefix => {
		const cards = () => Array.from(document.querySelectorAll('.basehalf-canvas-card')).filter(element => element instanceof HTMLElement && element.dataset.basehalfCardPath?.startsWith(prefix));
		const placeOf = element => {
			const rect = element.getBoundingClientRect();
			return `${Math.round(rect.x / 4)},${Math.round(rect.y / 4)}`;
		};
		const places = new Set(cards().map(placeOf));
		const watch = { running: true, framesWithACardElsewhere: 0, fewestCards: cards().length };
		globalThis.basehalfFollowMany = watch;
		const tick = () => {
			if (!watch.running) {
				return;
			}
			const shown = cards();
			watch.fewestCards = Math.min(watch.fewestCards, shown.length);
			if (shown.some(element => !places.has(placeOf(element)))) {
				watch.framesWithACardElsewhere++;
			}
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	}, `${folderName}/`);

	for (let index = 1; index < count; index++) {
		fs.renameSync(path.join(workspacePath, before(index)), path.join(workspacePath, after(index)));
	}
	await waitUntil(() => {
		const canvas = fs.readFileSync(mirror(folderName, 'canvas.yaml'), 'utf8');
		return Array.from({ length: count }, (_, index) => index).every(index => canvas.includes(`path: "${after(index)}"`) && !canvas.includes(`path: "${before(index)}"`))
			&& [1, 2].every(index => fs.readFileSync(mirror(after(index), 'badge.yaml'), 'utf8').includes(description(index)) && !fs.existsSync(mirror(before(index))));
	}, 'every card to follow its note after many notes were renamed at once', 20_000);
	for (let index = 0; index < count; index++) {
		await card(after(index)).waitFor({ state: 'visible', timeout: 15_000 });
	}
	await page.waitForTimeout(1_000);
	const watch = await page.evaluate(() => {
		const state = globalThis.basehalfFollowMany;
		state.running = false;
		return { framesWithACardElsewhere: state.framesWithACardElsewhere, fewestCards: state.fewestCards };
	});
	const canvas = fs.readFileSync(mirror(folderName, 'canvas.yaml'), 'utf8');
	const displaced = Array.from({ length: count }, (_, index) => index).filter(index => readCanvasCardNumber(canvas, after(index), 'x') !== place(index).x || readCanvasCardNumber(canvas, after(index), 'y') !== place(index).y);
	if (displaced.length > 0 || watch.framesWithACardElsewhere > 0 || watch.fewestCards < count) {
		throw new Error(`After ${count - 1} notes were renamed at once outside the window: ${displaced.length} cards lost the place they were given, the canvas drew a card elsewhere in ${watch.framesWithACardElsewhere} frames, and showed as few as ${watch.fewestCards} of ${count} cards`);
	}

	await openRootCanvas(page);
	fs.rmSync(path.join(workspacePath, folderName), { recursive: true, force: true });
	fs.rmSync(mirror(folderName), { recursive: true, force: true });
	await card(folderName).waitFor({ state: 'detached', timeout: 15_000 });
}

// Canvas card placement: every card has a saved place. A folder that was never
// shown is drawn as the plain grid, and that drawing saves a row for each card.
// A file that is added afterwards goes to the end, no card that was there moves
// in any frame, a card the user drags is saved where it was dropped, and git
// shows none of the places.
// Canvas selection and arrangement (docs/specs/canvas-selection-and-arrangement.md):
// a marquee, the set of two cards and its box, moving and arranging the set,
// and Tidy Canvas with its question. Every pointer action is a real one.
async function assertCanvasSelectionAndArrangement(page) {
	const folderName = 'arranged';
	const names = ['a.md', 'b.md', 'c.md', 'd.md', 'e.md'];
	const mirror = (...segments) => path.join(workspacePath, '.bh', 'mirror', ...segments);
	const layoutPath = mirror(folderName, 'canvas.yaml');
	const card = name => page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}/${name}"]`);
	const rowsOf = () => {
		const raw = fs.existsSync(layoutPath) ? fs.readFileSync(layoutPath, 'utf8') : '';
		return Object.fromEntries(names.map(name => {
			const row = readCanvasCardGeometry(raw, `${folderName}/${name}`);
			return [name, row ? [row.x, row.y] : undefined];
		}));
	};
	const chosenRows = () => {
		const raw = fs.existsSync(layoutPath) ? fs.readFileSync(layoutPath, 'utf8') : '';
		return names.filter(name => new RegExp(`- path: "${folderName}/${name.replace(/[.]/g, '\\.')}"\\n(?: {4}.*\\n)*? {4}auto: true`).test(raw));
	};
	const same = (first, second) => JSON.stringify(first) === JSON.stringify(second);
	const rectOf = async name => {
		const box = await card(name).boundingBox();
		if (!box) {
			throw new Error(`The card of ${name} is not drawn.`);
		}
		return box;
	};
	const centreOf = async name => {
		const box = await rectOf(name);
		return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	};
	const readState = () => page.evaluate(prefix => {
		const box = document.querySelector('.basehalf-canvas-set-box')?.getBoundingClientRect();
		return {
			cards: Array.from(document.querySelectorAll('.basehalf-canvas-card.selected'))
				.map(element => element instanceof HTMLElement ? (element.dataset.basehalfCardPath ?? '').slice(prefix.length) : '')
				.sort(),
			connections: document.querySelectorAll('.react-flow__edge.selected').length,
			box: box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom } : null,
			count: document.querySelector('.basehalf-canvas-selection-toolbar.for-set')?.getAttribute('data-selected-count') ?? null,
			names: Array.from(document.querySelectorAll('.basehalf-canvas-selection-toolbar.for-set .basehalf-canvas-selection-action-label')).map(element => element.textContent),
			outlines: document.querySelectorAll('.basehalf-canvas-card.marquee-selected').length,
			question: document.querySelectorAll('[data-testid="canvas-tidy-question"]').length
		};
	}, `${folderName}/`);
	const elementAt = point => page.evaluate(({ x, y }) => {
		const element = document.elementFromPoint(x, y);
		return element ? String(element.getAttribute('class') ?? '').split(' ')[0] : '';
	}, point);
	const drag = async (from, to, beforeRelease) => {
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		for (let index = 1; index <= 10; index++) {
			await page.mouse.move(from.x + (to.x - from.x) * index / 10, from.y + (to.y - from.y) * index / 10);
			await page.waitForTimeout(16);
		}
		const during = beforeRelease ? await beforeRelease() : undefined;
		await page.mouse.up();
		await page.waitForTimeout(350);
		return during;
	};
	// A marquee from empty canvas below the cards up into the named ones.
	const marquee = async (boxed, beforeRelease) => {
		const rects = await Promise.all(boxed.map(rectOf));
		const all = await Promise.all(names.map(rectOf));
		const bottom = Math.max(...all.map(rect => rect.y + rect.height));
		const from = { x: Math.min(...rects.map(rect => rect.x)) + 24, y: bottom + 40 };
		const to = { x: Math.max(...rects.map(rect => rect.x + rect.width)) - 24, y: Math.min(...rects.map(rect => rect.y + rect.height)) - 30 };
		if (await elementAt(from) !== 'react-flow__pane') {
			throw new Error(`A marquee must begin on empty canvas, but ${JSON.stringify(from)} is on ${await elementAt(from)}.`);
		}
		return drag(from, to, beforeRelease);
	};
	const undoKey = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
	const expectState = async (expected, what) => {
		const state = await readState();
		const actual = { cards: state.cards, connections: state.connections, box: !!state.box, count: state.count };
		if (!same(actual, expected)) {
			throw new Error(`${what}: ${JSON.stringify({ actual, expected })}`);
		}
		return state;
	};

	fs.mkdirSync(path.join(workspacePath, folderName), { recursive: true });
	fs.writeFileSync(path.join(workspacePath, folderName, 'a.md'), '# A\n\nThe note that the two after it build on.\n', 'utf8');
	for (const name of ['b.md', 'c.md']) {
		fs.writeFileSync(path.join(workspacePath, folderName, name), `---\nupstream:\n  - ${folderName}/a.md\n---\n# ${name}\n\nA note that builds on a.md.\n`, 'utf8');
	}
	for (const name of ['d.md', 'e.md']) {
		fs.writeFileSync(path.join(workspacePath, folderName, name), `# ${name}\n\nA note without a connection.\n`, 'utf8');
	}
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}"]`).waitFor({ state: 'visible', timeout: 15_000 });
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}"]`).dblclick();
	await assertCanvasFolder(page, folderName);
	for (const name of names) {
		await card(name).waitFor({ state: 'visible', timeout: 15_000 });
	}
	await waitUntil(() => names.every(name => rowsOf()[name] !== undefined), 'the first drawing of the folder to save a row for every card', 15_000);
	await page.waitForFunction(() => document.querySelectorAll('.basehalf-canvas-edge-path').length >= 2, undefined, { timeout: 15_000 });
	await page.waitForTimeout(1_500);
	const first = rowsOf();
	const [originX, originY] = first['a.md'];
	if (!same(first, { 'a.md': [originX, originY], 'b.md': [originX + 340, originY], 'c.md': [originX + 680, originY], 'd.md': [originX + 1020, originY], 'e.md': [originX + 1360, originY] })) {
		throw new Error(`The five cards must start in one row of the plain grid: ${JSON.stringify(first)}`);
	}

	// A marquee selects the card it touches also when the card has a connection, and one card is one card.
	await marquee(['b.md']);
	await expectState({ cards: ['b.md'], connections: 0, box: false, count: null }, 'A marquee over a card with a connection must select that card and no connection');
	if (await elementAt(await centreOf('b.md')) === 'basehalf-canvas-set-box') {
		throw new Error('One card selected by a marquee must not be under a box.');
	}

	// While a marquee is drawn the cards show the outline and nothing is selected.
	const during = await marquee(['d.md', 'e.md'], readState);
	if (during.outlines !== 2 || during.cards.length !== 0 || during.box) {
		throw new Error(`While a marquee is drawn, the cards in it must show the outline and nothing may be selected yet: ${JSON.stringify(during)}`);
	}
	const set = await expectState({ cards: ['d.md', 'e.md'], connections: 0, box: true, count: '2' }, 'A marquee over two cards must make a set with a box and a toolbar');
	if (set.outlines !== 0) {
		throw new Error('No outline of the marquee may be left after it.');
	}
	// The toolbar of a set says what each of its buttons does, and shows no bare number.
	if (!same(set.names, ['Arrange', 'Duplicate', 'Copy Paths', 'Delete']) || await page.locator('.basehalf-canvas-selection-count').count() !== 0) {
		throw new Error(`The toolbar of a set must name its buttons: ${JSON.stringify(set.names)}`);
	}

	// The box takes the pointer: a click and a double click change nothing.
	const dCentre = await centreOf('d.md');
	const dRect = await rectOf('d.md');
	const eRect = await rectOf('e.md');
	const gap = { x: (dRect.x + dRect.width + eRect.x) / 2, y: dCentre.y };
	const dCaption = { x: dRect.x + 30, y: dRect.y - (dRect.y - set.box.top) / 2 };
	if (await elementAt(dCentre) !== 'basehalf-canvas-set-box' || await elementAt(gap) !== 'basehalf-canvas-set-box' || await elementAt(dCaption) !== 'basehalf-canvas-set-box') {
		throw new Error('The box of a set must be at the pointer over its cards, over their captions, and in its gaps.');
	}
	const circles = await page.evaluate(prefix => ['d.md', 'e.md', 'a.md'].map(name => document.querySelectorAll(`.basehalf-canvas-connect-capture[data-node-id="${prefix}${name}"]`).length), `${folderName}/`);
	if (!same(circles, [0, 0, 4])) {
		throw new Error(`The cards of a set must have no capture circles, and another card its four: ${JSON.stringify(circles)}`);
	}
	await page.mouse.click(dCentre.x, dCentre.y);
	await page.mouse.dblclick(gap.x, gap.y);
	await page.waitForTimeout(400);
	await expectState({ cards: ['d.md', 'e.md'], connections: 0, box: true, count: '2' }, 'A click and a double click inside the box must change nothing');
	if (await page.locator('.basehalf-canvas-card[data-note-editing="true"]').count() !== 0 || await page.locator('.basehalf-card-detail.visible').count() !== 0) {
		throw new Error('A double click inside the box must open nothing.');
	}

	// A Shift-click still reaches the card: one card is left, and a second Shift-click makes the set again.
	await page.keyboard.down('Shift');
	await page.mouse.click(dCentre.x, dCentre.y);
	await page.keyboard.up('Shift');
	await page.waitForTimeout(400);
	await expectState({ cards: ['e.md'], connections: 0, box: false, count: null }, 'A Shift-click on one card of a set of two must leave the other as the one selected card');
	await page.keyboard.down('Shift');
	await page.mouse.click(dCentre.x, dCentre.y);
	await page.keyboard.up('Shift');
	await page.waitForTimeout(400);
	await expectState({ cards: ['d.md', 'e.md'], connections: 0, box: true, count: '2' }, 'A Shift-click on a second card must make the same set as a marquee');

	// A drag from a gap moves the set, which stays selected, and one undo takes it back.
	await drag(gap, { x: gap.x + 30, y: gap.y + 110 });
	await waitUntil(() => !same(rowsOf()['d.md'], first['d.md']), 'the move of the set to be saved', 10_000);
	const movedRows = rowsOf();
	const delta = name => [movedRows[name][0] - first[name][0], movedRows[name][1] - first[name][1]];
	if (!same(delta('d.md'), delta('e.md')) || delta('d.md')[1] < 60
		|| !same([movedRows['a.md'], movedRows['b.md'], movedRows['c.md']], [first['a.md'], first['b.md'], first['c.md']])) {
		throw new Error(`A drag from a gap of the box must move the cards of the set by the same amount and no other card: ${JSON.stringify(movedRows)}`);
	}
	const movedState = await expectState({ cards: ['d.md', 'e.md'], connections: 0, box: true, count: '2' }, 'After it is moved, a set must still be the selection');
	// The box holds the captions above its cards: its top edge is above the cards by the caption.
	const boxIsAround = (box, rect) => !!box && Math.abs(box.left - rect.x) <= 3 && rect.y - box.top > 5 && rect.y - box.top < 45;
	const movedD = await rectOf('d.md');
	if (!boxIsAround(movedState.box, movedD)) {
		throw new Error(`After a move the box must be around its cards and their captions: ${JSON.stringify({ box: movedState.box, card: movedD })}`);
	}
	await page.keyboard.press(undoKey);
	await waitUntil(() => same(rowsOf(), first), 'undo to put the set back', 10_000);
	await page.waitForTimeout(600);
	const undoneState = await expectState({ cards: ['d.md', 'e.md'], connections: 0, box: true, count: '2' }, 'After undo of a move the set must still be the selection');
	const undoneD = await rectOf('d.md');
	if (!boxIsAround(undoneState.box, undoneD)) {
		throw new Error(`After undo the box must be around its cards and their captions: ${JSON.stringify({ box: undoneState.box, card: undoneD })}`);
	}

	// Escape during a move puts the set back and saves nothing.
	const gapNow = async () => {
		const left = await rectOf('d.md');
		const right = await rectOf('e.md');
		return { x: (left.x + left.width + right.x) / 2, y: left.y + left.height / 2 };
	};
	const escapeFrom = await gapNow();
	await drag(escapeFrom, { x: escapeFrom.x + 50, y: escapeFrom.y + 90 }, async () => {
		await page.keyboard.press('Escape');
		await page.waitForTimeout(200);
	});
	await page.waitForTimeout(600);
	if (!same(rowsOf(), first)) {
		throw new Error(`Escape during a move must save nothing: ${JSON.stringify(rowsOf())}`);
	}
	await expectState({ cards: ['d.md', 'e.md'], connections: 0, box: true, count: '2' }, 'After Escape during a move the set must still be the selection');

	// Arrange: a column from the corner of the box, and one undo.
	await page.locator('.basehalf-canvas-selection-toolbar [data-toolbar-item="arrange"]').click();
	await page.locator('.basehalf-canvas-arrange-menu-item[data-arrangement="column"]').click();
	const column = { ...first, 'e.md': [first['d.md'][0], first['d.md'][1] + 280] };
	await waitUntil(() => same(rowsOf(), column), 'Arrange to put the set in a column and to move no other card', 10_000);
	await expectState({ cards: ['d.md', 'e.md'], connections: 0, box: true, count: '2' }, 'After Arrange the set must still be the selection');
	await page.keyboard.press(undoKey);
	await waitUntil(() => same(rowsOf(), first) && chosenRows().length === names.length, 'one undo to take the arrangement back', 10_000);

	// Tidy Canvas moves every card, keeps the selection, and asks.
	const tidied = {
		'a.md': [originX, originY + 140],
		'b.md': [originX + 420, originY],
		'c.md': [originX + 420, originY + 280],
		'd.md': [originX + 840, originY],
		'e.md': [originX + 1180, originY]
	};
	await page.locator('[data-testid="canvas-tidy"]').click();
	await waitUntil(() => same(rowsOf(), tidied), 'Tidy Canvas to lay out the canvas along its connections', 10_000);
	await page.waitForTimeout(900);
	const asked = await expectState({ cards: ['d.md', 'e.md'], connections: 0, box: true, count: '2' }, 'Tidy Canvas must leave the selection as it is');
	if (asked.question !== 1) {
		throw new Error('After a tidy that moved a card, the question must be asked.');
	}
	const aRect = await rectOf('a.md');
	const bRect = await rectOf('b.md');
	if (aRect.x + aRect.width >= bRect.x) {
		throw new Error('After a tidy, a connection must run from left to right.');
	}

	// The question does not block the canvas, and Revert puts every card back, also one moved since.
	const eCentre = await centreOf('e.md');
	const eNow = await rectOf('e.md');
	const empty = { x: eCentre.x, y: eNow.y + eNow.height + 70 };
	if (await elementAt(empty) !== 'react-flow__pane') {
		throw new Error(`The point below e.md must be empty canvas, but it is on ${await elementAt(empty)}.`);
	}
	await page.mouse.click(empty.x, empty.y);
	await page.waitForTimeout(400);
	await drag(eCentre, { x: eCentre.x - 40, y: eCentre.y + 150 });
	await waitUntil(() => !same(rowsOf()['e.md'], tidied['e.md']), 'a card to be moved while the question is open', 10_000);
	if ((await readState()).question !== 1) {
		throw new Error('The question must stay open while a card is moved.');
	}
	await page.locator('[data-testid="canvas-tidy-revert"]').click();
	await waitUntil(() => same(rowsOf(), first) && chosenRows().length === names.length, 'Revert to put every card back and to give every row back as it was', 10_000);
	await page.waitForTimeout(600);
	if ((await readState()).question !== 0) {
		throw new Error('Revert must close the question.');
	}

	// Undo of a tidy closes the question. Keep closes it and changes no place.
	await page.locator('[data-testid="canvas-tidy"]').click();
	await waitUntil(() => same(rowsOf(), tidied), 'a second tidy', 10_000);
	await page.waitForTimeout(900);
	await page.keyboard.press(undoKey);
	await waitUntil(() => same(rowsOf(), first), 'undo to take the tidy back', 10_000);
	await page.waitForTimeout(600);
	if ((await readState()).question !== 0) {
		throw new Error('Undo of a tidy must close the question.');
	}
	await page.locator('[data-testid="canvas-tidy"]').click();
	await waitUntil(() => same(rowsOf(), tidied), 'a third tidy', 10_000);
	await page.waitForTimeout(900);
	await page.locator('[data-testid="canvas-tidy-keep"]').click();
	await page.waitForTimeout(400);
	if ((await readState()).question !== 0 || !same(rowsOf(), tidied)) {
		throw new Error(`Keep must close the question and change no place: ${JSON.stringify(rowsOf())}`);
	}
	// Keep leaves the focus on the canvas: undo works without a click, and so does the key of Tidy Canvas.
	await page.keyboard.press(undoKey);
	await waitUntil(() => same(rowsOf(), first), 'undo, right after Keep, to take the tidy back', 10_000);
	await page.keyboard.press('Shift+Alt+KeyF');
	await waitUntil(() => same(rowsOf(), tidied), 'Shift+Alt+F to tidy the canvas', 10_000);
	await page.waitForTimeout(900);
	await page.locator('[data-testid="canvas-tidy-keep"]').click();
	await page.waitForTimeout(400);
	// A tidied canvas: nothing moves and nothing is asked.
	await page.locator('[data-testid="canvas-tidy"]').click();
	await page.waitForTimeout(1_500);
	if ((await readState()).question !== 0 || !same(rowsOf(), tidied)) {
		throw new Error(`Tidying a tidied canvas must move no card and ask nothing: ${JSON.stringify(rowsOf())}`);
	}

	await openRootCanvas(page);
	fs.rmSync(path.join(workspacePath, folderName), { recursive: true, force: true });
	fs.rmSync(mirror(folderName), { recursive: true, force: true });
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}"]`).waitFor({ state: 'detached', timeout: 15_000 });
}

async function assertCanvasNewFilesGoToTheEnd(page) {
	const folderName = 'placed';
	const mirror = (...segments) => path.join(workspacePath, '.bh', 'mirror', ...segments);
	const layoutPath = mirror(folderName, 'canvas.yaml');
	const card = name => page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}/${name}"]`);
	const note = name => fs.writeFileSync(path.join(workspacePath, folderName, name), `# ${name}\n\nA note of the folder that tests where cards go, with words of its own: ${name}-alpha, ${name}-beta.\n`, 'utf8');
	const rowOf = name => {
		const raw = fs.existsSync(layoutPath) ? fs.readFileSync(layoutPath, 'utf8') : '';
		const row = readCanvasCardGeometry(raw, `${folderName}/${name}`);
		return row ? { x: row.x, y: row.y, chosen: new RegExp(`- path: "${folderName}/${name.replace(/[.]/g, '\\.')}"\\n(?: {4}.*\\n)*? {4}auto: true`).test(raw) } : undefined;
	};
	const hiddenInGit = () => gitStatusOfWorkspace().split('\n').filter(line => line.includes('.bh/')).sort().join('\n');
	// A folder, which is listed first, and three notes.
	const original = ['sub', 'b.md', 'c.md', 'd.md'];
	const added = ['a.md', 'x1.md', 'x2.md', 'x3.md'];
	const gitBefore = hiddenInGit();

	fs.mkdirSync(path.join(workspacePath, folderName, 'sub'), { recursive: true });
	fs.writeFileSync(path.join(workspacePath, folderName, 'sub', 'inside.md'), '# Inside\n\nA note inside the folder card that is dragged.\n', 'utf8');
	original.slice(1).forEach(note);
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}"]`).waitFor({ state: 'visible', timeout: 15_000 });
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}"]`).dblclick();
	await assertCanvasFolder(page, folderName);
	await card('d.md').waitFor({ state: 'visible', timeout: 15_000 });

	// The first drawing: the plain grid for four cards, saved as places BaseHalf chose.
	await waitUntil(() => original.every(name => rowOf(name) !== undefined), 'the first drawing of a folder to save a row for every card', 15_000);
	const first = Object.fromEntries(original.map(name => [name, rowOf(name)]));
	const expectedFirst = { 'sub': { x: 540, y: 690, chosen: true }, 'b.md': { x: 880, y: 690, chosen: true }, 'c.md': { x: 1220, y: 690, chosen: true }, 'd.md': { x: 1560, y: 690, chosen: true } };
	if (JSON.stringify(first) !== JSON.stringify(expectedFirst)) {
		throw new Error(`The first drawing of a folder must be the plain grid, saved as places BaseHalf chose: ${JSON.stringify(first)}`);
	}

	// Every frame while files are added: where the three cards that were there are drawn.
	await page.evaluate(paths => {
		const cardOf = cardPath => Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(element => element instanceof HTMLElement && element.dataset.basehalfCardPath === cardPath);
		const placeOf = element => {
			const rect = element.getBoundingClientRect();
			return `${Math.round(rect.x / 4)},${Math.round(rect.y / 4)}`;
		};
		const places = new Map(paths.map(cardPath => [cardPath, placeOf(cardOf(cardPath))]));
		const watch = { running: true, framesWithACardElsewhere: 0, framesWithACardMissing: 0 };
		globalThis.basehalfPlaced = watch;
		const tick = () => {
			if (!watch.running) {
				return;
			}
			for (const [cardPath, place] of places) {
				const element = cardOf(cardPath);
				if (!element) {
					watch.framesWithACardMissing++;
				} else if (placeOf(element) !== place) {
					watch.framesWithACardElsewhere++;
				}
			}
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	}, original.map(name => `${folderName}/${name}`));

	// A file whose name sorts before all others, and then three at once.
	note('a.md');
	await card('a.md').waitFor({ state: 'visible', timeout: 15_000 });
	await waitUntil(() => rowOf('a.md') !== undefined, 'a new file to get a saved place', 15_000);
	added.slice(1).forEach(note);
	for (const name of added) {
		await card(name).waitFor({ state: 'visible', timeout: 15_000 });
	}
	await waitUntil(() => added.every(name => rowOf(name) !== undefined), 'every new file to get a saved place', 15_000);
	await page.waitForTimeout(1_000);
	const watch = await page.evaluate(() => {
		const state = globalThis.basehalfPlaced;
		state.running = false;
		return { framesWithACardElsewhere: state.framesWithACardElsewhere, framesWithACardMissing: state.framesWithACardMissing };
	});
	const rows = Object.fromEntries([...original, ...added].map(name => [name, rowOf(name)]));
	// It was not sorted in: it is beside the last card. The row of five cells is then full, and a new row starts.
	const endPlaces = ['1900,690', '540,970', '880,970', '1220,970'];
	const addedPlaces = added.map(name => `${rows[name].x},${rows[name].y}`);
	if (original.some(name => JSON.stringify(rows[name]) !== JSON.stringify(expectedFirst[name]))
		|| addedPlaces[0] !== endPlaces[0]
		|| [...addedPlaces].sort().join(' ') !== [...endPlaces].sort().join(' ')
		|| added.some(name => !rows[name].chosen)
		|| watch.framesWithACardElsewhere > 0 || watch.framesWithACardMissing > 0) {
		throw new Error(`Files that are added must go to the end of the canvas, and no card that was there may move: ${JSON.stringify({ rows, watch })}`);
	}

	// The user drags a card: it is saved where it was dropped, as the user's, and no other row changes.
	// It is the folder card, taken by its middle: pressing on the text of a note can start editing it.
	const box = await card('sub').boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 - 130, { steps: 8 });
	await page.mouse.up();
	await waitUntil(() => rowOf('sub')?.chosen === false, 'a dragged card to be saved as the user\'s', 15_000);
	const afterDrag = Object.fromEntries([...original, ...added].map(name => [name, rowOf(name)]));
	// It went right and up by about the distance of the pointer, whatever the zoom is.
	const moved = { x: afterDrag['sub'].x - 540, y: afterDrag['sub'].y - 690 };
	if ([...original, ...added].some(name => name !== 'sub' && JSON.stringify(afterDrag[name]) !== JSON.stringify(rows[name]))
		|| moved.x < 20 || moved.x > 200 || moved.y > -60 || moved.y < -400) {
		throw new Error(`A drag must change the row of the dragged card and no other: ${JSON.stringify({ moved, afterDrag })}`);
	}

	// Git shows none of it: not the layouts, not the ignore file. The notes themselves are new files, as they should be.
	const status = gitStatusOfWorkspace();
	if (hiddenInGit() !== gitBefore || !status.includes(`${folderName}/a.md`)) {
		throw new Error(`Card places must not show in git, and the notes must:\n${status}`);
	}

	await openRootCanvas(page);
	fs.rmSync(path.join(workspacePath, folderName), { recursive: true, force: true });
	fs.rmSync(mirror(folderName), { recursive: true, force: true });
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}"]`).waitFor({ state: 'detached', timeout: 15_000 });
}

/** A point of the empty canvas, where a wheel or a click meets no card. */
async function emptyCanvasPoint(page) {
	const point = await page.evaluate(() => {
		const pane = document.querySelector('.basehalf-canvas-cards .react-flow__pane');
		if (!(pane instanceof HTMLElement)) {
			return undefined;
		}
		const box = pane.getBoundingClientRect();
		for (const y of [box.top + 28, box.bottom - 28, box.top + box.height / 2]) {
			for (const x of [box.left + 28, box.right - 28]) {
				if (document.elementFromPoint(x, y) === pane) {
					return { x, y };
				}
			}
		}
		return undefined;
	});
	if (!point) {
		throw new Error('The canvas has no empty place at its edges');
	}
	return point;
}

/**
 * Canvas wheel gestures: a scroll that starts on a long note at rest moves
 * the note, a scroll that starts on the canvas keeps moving the canvas over
 * the note and over its editor, and the note keeps its place.
 */
async function assertCanvasNoteWheelScroll(page) {
	const folderName = 'scrolled';
	const longPath = `${folderName}/long.md`;
	const longFile = path.join(workspacePath, folderName, 'long.md');
	const longNote = paragraphs => [
		'# Long',
		'',
		...Array.from({ length: paragraphs }, (_, index) => `Paragraph ${index + 1} of a note that is longer than its card, with enough words to fill a line or two.\n`)
	].join('\n');
	const card = name => page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}/${name}"]`);
	const state = cardPath => page.evaluate(target => {
		const element = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(candidate => candidate instanceof HTMLElement && candidate.dataset.basehalfCardPath === target);
		const note = element?.querySelector('.bh-md-preview');
		const viewport = document.querySelector('.react-flow__viewport');
		return {
			scrollTop: note instanceof HTMLElement ? note.scrollTop : undefined,
			overflow: note instanceof HTMLElement ? note.scrollHeight - note.clientHeight : undefined,
			editorScrollTop: element?.querySelector('.basehalf-canvas-note-editor.ready .basehalf-canvas-markdown-inline')?.scrollTop,
			text: note?.textContent ?? '',
			// The note drawn before its file changed carries this mark; a redrawn note does not.
			marked: note instanceof HTMLElement && note.dataset.smokeDrawnBefore === 'true',
			viewport: viewport instanceof HTMLElement ? getComputedStyle(viewport).transform : undefined
		};
	}, cardPath);
	// Waits until the card is as described, and checks that it stays so.
	const settled = async (cardPath, description, predicate) => {
		const deadline = Date.now() + 10_000;
		let last;
		do {
			last = await state(cardPath);
			if (predicate(last)) {
				await page.waitForTimeout(300);
				last = await state(cardPath);
				if (predicate(last)) {
					return last;
				}
			}
			await page.waitForTimeout(50);
		} while (Date.now() < deadline);
		throw new Error(`${description}: ${JSON.stringify({ ...last, text: last.text.length })}`);
	};
	// A scroll that starts on empty canvas and whose later events are delivered
	// to `selector`, as they are once the canvas has brought it under the
	// pointer. The events are sent in one task, so the quiet time cannot pass
	// between them however busy the machine is.
	const canvasGestureOver = async selector => {
		await page.waitForTimeout(600);
		const sent = await page.evaluate(targetSelector => {
			const pane = document.querySelector('.basehalf-canvas-cards .react-flow__pane');
			const target = document.querySelector(targetSelector);
			if (!(pane instanceof HTMLElement) || !(target instanceof HTMLElement)) {
				return false;
			}
			const wheel = element => {
				const box = element.getBoundingClientRect();
				element.dispatchEvent(new WheelEvent('wheel', { deltaY: -30, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, bubbles: true, cancelable: true }));
			};
			wheel(pane);
			for (let index = 0; index < 5; index++) {
				wheel(target);
			}
			return true;
		}, selector);
		if (!sent) {
			throw new Error(`The canvas gesture found no ${selector}`);
		}
		// The gesture ends, and the canvas reports its pan as ended.
		await page.waitForTimeout(600);
	};
	const middleOf = async name => {
		const box = await card(name).boundingBox();
		return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	};

	fs.mkdirSync(path.join(workspacePath, folderName), { recursive: true });
	fs.writeFileSync(path.join(workspacePath, folderName, 'fits.md'), '# Fits\n\nA note that fits its card.\n', 'utf8');
	fs.writeFileSync(longFile, longNote(40), 'utf8');
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}"]`).waitFor({ state: 'visible', timeout: 15_000 });
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}"]`).dblclick();
	await assertCanvasFolder(page, folderName);
	await card('long.md').waitFor({ state: 'visible', timeout: 15_000 });
	await zoomCanvas(page, 'reset');
	await centerCanvasCards(page, [card('long.md')]);
	const rest = await settled(longPath, 'A long note at rest must hold more than its card shows', now => now.scrollTop === 0 && now.overflow > 400);

	// The pointer is moved onto the note: a scroll moves the note and not the canvas.
	const first = await middleOf('long.md');
	await page.mouse.move(first.x, first.y);
	await page.mouse.wheel(0, 60);
	const scrolled = await settled(longPath, 'A scroll on a long note that the pointer was moved onto must move the note and not the canvas', now => now.scrollTop === 60 && now.viewport === rest.viewport);

	// The box that cuts the text of the scrolled note is the card content: no band without text is left under the outline.
	const cut = await card('long.md').evaluate(element => {
		const body = element.querySelector('.basehalf-canvas-card-body')?.getBoundingClientRect();
		const note = element.querySelector('.bh-md-preview')?.getBoundingClientRect();
		return body && note ? { top: note.top - body.top, bottom: body.bottom - note.bottom } : undefined;
	});
	if (!cut || Math.abs(cut.top) > 0.5 || Math.abs(cut.bottom) > 0.5) {
		throw new Error(`The text of a scrolled note must be cut at the top and the bottom of the card content: ${JSON.stringify(cut)}`);
	}

	// A scroll that starts on the canvas keeps moving the canvas when its events reach the note.
	await canvasGestureOver(`.basehalf-canvas-card[data-basehalf-card-path="${longPath}"] .bh-md-preview`);
	const panned = await state(longPath);
	if (panned.scrollTop !== 60 || panned.viewport === scrolled.viewport) {
		throw new Error(`A scroll that starts on the canvas must keep moving the canvas over a long note: ${JSON.stringify({ scrolled: scrolled.viewport, panned: panned.viewport, scrollTop: panned.scrollTop })}`);
	}

	// The pan has ended. The next scroll starts on the note and moves it.
	const second = await middleOf('long.md');
	await page.mouse.move(second.x, second.y);
	await page.mouse.wheel(0, 50);
	const pannedOn = await settled(longPath, 'A scroll that starts on a long note after a pan has ended must move the note', now => now.scrollTop === 110 && now.viewport === panned.viewport);

	// A note that fits its card has nothing to scroll: the canvas moves.
	const fits = await middleOf('fits.md');
	await page.mouse.move(fits.x, fits.y);
	await page.waitForTimeout(400);
	await page.mouse.wheel(0, 30);
	await settled(`${folderName}/fits.md`, 'A scroll on a note that fits its card must move the canvas', now => now.scrollTop === 0 && now.viewport !== pannedOn.viewport);

	// The note keeps its place when it is selected, deselected, and redrawn.
	const selectAt = await middleOf('long.md');
	await page.mouse.click(selectAt.x, selectAt.y);
	await waitForCanvasCardSelection(page, longPath);
	await settled(longPath, 'A selected note must keep its scroll position', now => now.scrollTop === 110);
	const empty = await emptyCanvasPoint(page);
	await page.mouse.click(empty.x, empty.y);
	await page.waitForFunction(target => !Array.from(document.querySelectorAll('.basehalf-canvas-card.selected')).some(element => element instanceof HTMLElement && element.dataset.basehalfCardPath === target), longPath, { timeout: 10_000 });
	await settled(longPath, 'A deselected note must keep its scroll position', now => now.scrollTop === 110);
	// The card builds a long note in parts as far as it shows (note rendering),
	// so the paragraph added at the end is not built yet: a new element tells
	// that the note was redrawn.
	await card('long.md').locator('.bh-md-preview').evaluate(note => note.setAttribute('data-smoke-drawn-before', 'true'));
	fs.writeFileSync(longFile, longNote(41), 'utf8');
	await settled(longPath, 'A note that is redrawn after its file changed must keep its scroll position', now => !now.marked && now.text.includes('Paragraph 1 ') && now.scrollTop === 110);

	// The editor opens where the note at rest was, and a scroll of the canvas goes on over it.
	await centerCanvasCards(page, [card('long.md')]);
	const editAt = await middleOf('long.md');
	await page.mouse.dblclick(editAt.x, editAt.y);
	const editor = await waitForCanvasNoteInlineEditor(page, longPath);
	const editing = await settled(longPath, 'The editor must open where the note at rest was', now => now.editorScrollTop === 110);
	await canvasGestureOver(`.basehalf-canvas-card[data-basehalf-card-path="${longPath}"] .basehalf-canvas-note-editor .basehalf-canvas-markdown-inline`);
	const afterEditorPan = await state(longPath);
	if (afterEditorPan.editorScrollTop !== 110 || afterEditorPan.viewport === editing.viewport) {
		throw new Error(`A scroll that starts on the canvas must keep moving the canvas over a note that is edited: ${JSON.stringify({ editing: editing.viewport, after: afterEditorPan.viewport, editorScrollTop: afterEditorPan.editorScrollTop })}`);
	}
	await page.keyboard.press('Escape');
	await editor.host.waitFor({ state: 'detached', timeout: 10_000 });
	await settled(longPath, 'A note must keep its scroll position when editing ends', now => now.scrollTop === 110);

	// Drawn again, the note holds its first part only, and a scroll to its end
	// builds the rest and shows its last paragraph (note rendering, rule 28).
	await card('long.md').locator('.bh-md-preview').evaluate(note => note.setAttribute('data-smoke-drawn-before', 'true'));
	fs.writeFileSync(longFile, longNote(40), 'utf8');
	const drawnAgain = await settled(longPath, 'A note drawn again must hold only the parts it shows', now => !now.marked && now.text.includes('Paragraph 1 ') && !now.text.includes('Paragraph 40'));
	await centerCanvasCards(page, [card('long.md')]);
	const endAt = await middleOf('long.md');
	await page.mouse.move(endAt.x, endAt.y);
	await page.waitForTimeout(400);
	for (let index = 0; index < 20; index++) {
		await page.mouse.wheel(0, 300);
	}
	await settled(longPath, 'A scroll to the end of a long note must build its last part and show its last paragraph', now => now.text.includes('Paragraph 40') && now.overflow > drawnAgain.overflow && now.overflow - now.scrollTop < 1);

	await openRootCanvas(page);
	fs.rmSync(path.join(workspacePath, folderName), { recursive: true, force: true });
	fs.rmSync(path.join(workspacePath, '.bh', 'mirror', folderName), { recursive: true, force: true });
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}"]`).waitFor({ state: 'detached', timeout: 15_000 });
}

// A note is shown rendered on its card: at rest, and in the blocks that stay
// as they are while another block of the card is edited. A table that is wider
// than the card scrolls sideways in its own box.
async function assertCanvasNoteRendersMarkdown(page) {
	const folderName = 'rendered';
	const notePath = `${folderName}/table.md`;
	const card = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${notePath}"]`);
	const shown = () => card.evaluate(element => {
		const note = element.querySelector('.basehalf-canvas-note-editor.ready .basehalf-canvas-markdown-inline') ?? element.querySelector('.bh-md-preview');
		const table = note?.querySelector('table');
		if (!(note instanceof HTMLElement) || !(table instanceof HTMLElement)) {
			return undefined;
		}
		const box = table.getBoundingClientRect();
		const mask = getComputedStyle(table).maskImage;
		return {
			headers: Array.from(table.querySelectorAll('thead th'), cell => cell.textContent).join('|'),
			cells: table.querySelectorAll('tbody td').length,
			linesInLastCell: table.querySelectorAll('tbody td:last-child br').length + 1,
			// A cell that broke a number would be higher than one line of text.
			numberCellLines: Math.round(table.querySelector('tbody td:nth-child(2)').getBoundingClientRect().height / box.height * 10) / 10,
			smallHeadings: note.querySelectorAll('h4').length,
			boxes: Array.from(note.querySelectorAll('li.bh-md-task input[type="checkbox"]'), input => input instanceof HTMLInputElement && input.checked && input.disabled ? 'done' : 'open').join('|'),
			tagsAsText: /<\/?(?:table|thead|tbody|tr|th|td|br|h4|input)\b/.test(note.textContent ?? ''),
			noteWiderThanCard: note.scrollWidth - note.clientWidth,
			table: `${Math.round(box.width)}x${Math.round(box.height)} holds ${table.scrollWidth}`,
			tableHoldsMore: table.scrollWidth > table.clientWidth,
			tableAt: Math.round(table.scrollLeft),
			fades: `${/^linear-gradient\(to right, rgba\(0, 0, 0, 0\)/.test(mask) ? 'left' : ''}${/rgba\(0, 0, 0, 0\)\)$/.test(mask) ? 'right' : ''}`,
			// The height of the table's box. The bar of a scrolled table lies over the box and adds nothing to it.
			tableBoxHeight: table.offsetHeight,
			systemScrollbar: table.offsetHeight - table.clientHeight,
			code: Array.from(note.querySelectorAll('pre'), pre => {
				const style = getComputedStyle(pre);
				return {
					size: `${Math.round(pre.getBoundingClientRect().width)}x${Math.round(pre.getBoundingClientRect().height)}`,
					lines: Math.round((pre.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) / parseFloat(style.lineHeight)),
					holdsMore: pre.scrollWidth > pre.clientWidth,
					hasBackground: style.backgroundColor !== 'rgba(0, 0, 0, 0)'
				};
			}),
			noteAt: note.scrollTop,
			viewport: getComputedStyle(document.querySelector('.react-flow__viewport')).transform
		};
	});
	// The bar of the note's table: whether it is shown, and whether it lies inside the lower edge of the table.
	const bar = () => card.evaluate(element => {
		const note = element.querySelector('.basehalf-canvas-note-editor.ready .basehalf-canvas-markdown-inline') ?? element.querySelector('.bh-md-preview');
		const table = note?.querySelector('table');
		const found = note?.querySelector('.basehalf-sideways-scrollbar');
		if (!(table instanceof HTMLElement) || !(found instanceof HTMLElement)) {
			return 'none';
		}
		const tableBox = table.getBoundingClientRect();
		const barBox = found.getBoundingClientRect();
		const inside = barBox.left >= tableBox.left && barBox.right <= tableBox.right && barBox.top >= tableBox.top && tableBox.bottom - barBox.bottom >= 0 && tableBox.bottom - barBox.bottom <= 4;
		// The bar is as long, of the table's shown width, as that width is of the table's full width.
		const proportional = Math.abs(barBox.width / tableBox.width - (table.clientWidth - 4) / table.scrollWidth) < 0.02;
		return `${getComputedStyle(found).opacity === '1' ? 'shown' : 'hidden'}${inside && proportional ? ' inside the lower edge' : ' misplaced'}, takes ${getComputedStyle(found).pointerEvents === 'none' ? 'no press' : 'presses'}`;
	});
	const columns = ['开始时间', 'ret_1h', 'ret_6h', 'ret_24h', 'vol_24h', 'buy_ratio', 'rel_volume', '标签 y'];

	fs.mkdirSync(path.join(workspacePath, folderName), { recursive: true });
	fs.writeFileSync(path.join(workspacePath, folderName, 'table.md'), [
		'First paragraph.',
		'',
		`| ${columns.join(' | ')} |`,
		`|${columns.map(() => '---').join('|')}|`,
		'| 11:00 | +0.72% | +1.74% | +12.02% | 1.10% | 49.8% | 1.34 | up<br>next |',
		'',
		'#### Small heading',
		'',
		'- [ ] open',
		'- [x] done',
		'',
		'```python',
		'short = 1',
		'next_ret = close.shift(-1) / close - 1               # one line of code that is longer than the card is wide',
		'```',
		''
	].join('\n'), 'utf8');
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}"]`).waitFor({ state: 'visible', timeout: 15_000 });
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}"]`).dblclick();
	await assertCanvasFolder(page, folderName);
	await card.waitFor({ state: 'visible', timeout: 15_000 });
	await zoomCanvas(page, 'reset');
	await centerCanvasCards(page, [card]);
	await card.locator('.bh-md-preview table').waitFor({ state: 'attached', timeout: 10_000 });

	const rest = await shown();
	const expected = {
		headers: columns.join('|'), cells: 8, linesInLastCell: 2, smallHeadings: 1, boxes: 'open|done', tagsAsText: false,
		noteWiderThanCard: 0, tableHoldsMore: true, tableAt: 0, fades: 'right', systemScrollbar: 0, noteAt: 0
	};
	const comparable = state => JSON.stringify(state, Object.keys(expected));
	if (comparable(rest) !== JSON.stringify(expected)) {
		throw new Error(`A note at rest must show its table, small heading, and task boxes rendered, with a table of eight columns that is cut at the right and no wider note: ${JSON.stringify(rest)}`);
	}
	// A code block is a box with a background, and a line of code is not broken: two lines of code are two lines high.
	const code = rest.code[0];
	if (rest.code.length !== 1 || code.lines !== 2 || !code.holdsMore || !code.hasBackground) {
		throw new Error(`A code block on a card must be a box of its own whose lines are not broken: ${JSON.stringify(rest.code)}`);
	}

	// A sideways scroll that begins on the table moves the table, and neither the note nor the canvas.
	const tableBox = await card.locator('.bh-md-preview table').boundingBox();
	await page.mouse.move(tableBox.x + tableBox.width / 2, tableBox.y + tableBox.height / 2);
	await page.waitForTimeout(400);
	await page.mouse.wheel(60, 0);
	await page.waitForFunction(target => {
		const table = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(candidate => candidate instanceof HTMLElement && candidate.dataset.basehalfCardPath === target)?.querySelector('.bh-md-preview table');
		return table instanceof HTMLElement && Math.round(table.scrollLeft) === 60;
	}, notePath, { timeout: 10_000 }).catch(() => undefined);
	const scrolled = await shown();
	if (JSON.stringify({ ...scrolled, tableAt: 0, fades: 'right' }) !== JSON.stringify(rest) || scrolled.tableAt !== 60 || scrolled.fades !== 'leftright') {
		throw new Error(`A sideways scroll on a table wider than its card must move the table and nothing else: ${JSON.stringify({ rest, scrolled })}`);
	}
	// While the table is scrolled, its bar lies over it, inside its lower edge. Before and after there is none to see.
	const barBeforeAnyScroll = rest.systemScrollbar === 0 ? 'none' : 'a system scrollbar';
	const barWhileScrolled = await bar();
	// The bar goes, and the quiet time passes, so that the double-click below is not part of the gesture.
	await page.waitForTimeout(1_300);
	const barAfterTheScroll = await bar();
	if (barBeforeAnyScroll !== 'none' || barWhileScrolled !== 'shown inside the lower edge, takes no press' || barAfterTheScroll !== 'hidden inside the lower edge, takes no press') {
		throw new Error(`The bar of a table must show inside its lower edge while the table is scrolled sideways, and at no other time: ${JSON.stringify({ barBeforeAnyScroll, barWhileScrolled, barAfterTheScroll })}`);
	}

	// The table cannot be edited on the card. It stays the same table, at the same place, while the paragraph is edited.
	await card.locator('.bh-md-preview p', { hasText: 'First paragraph.' }).dblclick();
	const editor = await waitForCanvasNoteInlineEditor(page, notePath);
	const editing = await shown();
	if (JSON.stringify(editing) !== JSON.stringify(scrolled)) {
		throw new Error(`A table and a code block must look the same, at the same sideways position, while another block of their note is edited: ${JSON.stringify({ scrolled, editing })}`);
	}
	// Opening the editor put the table back where it was: that is no scroll, and shows no bar.
	const barOnOpeningTheEditor = await bar();
	// In the editor the table scrolls as any box does, and shows the same bar and no other.
	const editorTableBox = await card.locator('.basehalf-canvas-note-editor table').first().boundingBox();
	await page.mouse.move(editorTableBox.x + editorTableBox.width / 2, editorTableBox.y + editorTableBox.height / 2);
	await page.mouse.wheel(-20, 0);
	await page.waitForFunction(target => {
		const table = Array.from(document.querySelectorAll('.basehalf-canvas-card')).find(candidate => candidate instanceof HTMLElement && candidate.dataset.basehalfCardPath === target)?.querySelector('.basehalf-canvas-note-editor table');
		return table instanceof HTMLElement && Math.round(table.scrollLeft) === 40;
	}, notePath, { timeout: 10_000 }).catch(() => undefined);
	const scrolledInTheEditor = await shown();
	const barInTheEditor = await bar();
	if (JSON.stringify({ ...scrolledInTheEditor, tableAt: 60 }) !== JSON.stringify(scrolled) || scrolledInTheEditor.tableAt !== 40
		|| barOnOpeningTheEditor !== 'none' || barInTheEditor !== 'shown inside the lower edge, takes no press') {
		throw new Error(`A table in the card's editor must scroll sideways with the same bar as at rest: ${JSON.stringify({ scrolled, scrolledInTheEditor, barOnOpeningTheEditor, barInTheEditor })}`);
	}
	await page.keyboard.press('Escape');
	await editor.host.waitFor({ state: 'detached', timeout: 10_000 });
	const after = await shown();
	if (JSON.stringify(after) !== JSON.stringify(scrolledInTheEditor)) {
		throw new Error(`A table must keep its sideways position when editing ends: ${JSON.stringify({ scrolledInTheEditor, after })}`);
	}

	await openRootCanvas(page);
	fs.rmSync(path.join(workspacePath, folderName), { recursive: true, force: true });
	fs.rmSync(path.join(workspacePath, '.bh', 'mirror', folderName), { recursive: true, force: true });
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${folderName}"]`).waitFor({ state: 'detached', timeout: 15_000 });
}

async function assertCanvasUnreadableBadgeRecovers(page) {
	const badgePath = path.join(workspacePath, '.bh', 'mirror', 'README.md', 'badge.yaml');
	const recoveryRoot = path.join(workspacePath, '.bh', 'cache', 'recovered');
	const recoveryDir = path.join(recoveryRoot, 'mirror', 'README.md');
	const readme = page.locator('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
	const fixture = fs.readFileSync(badgePath, 'utf8');
	// A toggle click that lands while the canvas re-renders after a file change
	// is dropped, so the face is opened and closed until it is in the wanted state.
	const setBadgeFace = async open => {
		for (let attempt = 0; attempt < 6; attempt++) {
			if ((await readme.getAttribute('data-projection') === 'badge') === open) {
				return;
			}
			await clickCanvasBadgeToggle(readme);
			await page.waitForFunction(wanted => {
				const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
				return (card?.getAttribute('data-projection') === 'badge') === wanted;
			}, open, { timeout: 2_000 }).catch(() => undefined);
		}
		throw new Error(`The README badge face did not ${open ? 'open' : 'close'}`);
	};
	const conflicted = 'path: "README.md"\nkind: file\n<<<<<<< HEAD\ndescription: "Ours"\n=======\ndescription: "Theirs"\n>>>>>>> feature\n';
	fs.writeFileSync(badgePath, conflicted, 'utf8');

	// The toggle is lit by a description or by an issue: the card now has neither.
	await page.waitForFunction(() => {
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
		const toggle = card?.querySelector('.basehalf-canvas-card-badge-toggle');
		return toggle instanceof HTMLElement && !toggle.classList.contains('lit');
	}, null, { timeout: 10_000 });
	await setBadgeFace(true);
	const badgePrompt = readme.locator('.basehalf-canvas-card-badge-prompt');
	await badgePrompt.waitFor({ state: 'visible', timeout: 10_000 });
	if (await badgePrompt.inputValue() !== '' || await readme.locator('[data-testid="badge-metadata-issue"]').count() !== 0) {
		throw new Error('A description file that cannot be read was shown as an issue instead of an empty description field');
	}

	await badgePrompt.fill('Recovered badge');
	await badgePrompt.evaluate(prompt => prompt.blur());
	await waitUntil(() => {
		const saved = fs.readFileSync(badgePath, 'utf8');
		return saved.includes('description: "Recovered badge"') && !saved.includes('<<<<<<<');
	}, 'a new description to replace the description file that could not be read');
	const copies = fs.existsSync(recoveryDir) ? fs.readdirSync(recoveryDir) : [];
	if (copies.length !== 1 || !/^badge\.[0-9a-f]{12}\.yaml$/.test(copies[0]) || fs.readFileSync(path.join(recoveryDir, copies[0]), 'utf8') !== conflicted) {
		throw new Error(`The description file that could not be read was not kept as one recovery copy: ${JSON.stringify(copies)}`);
	}
	await expectNotification(page, 'could not read the saved description of README.md');

	// Hand the fixture back as the next steps expect it.
	await badgePrompt.fill('Smoke file badge');
	await badgePrompt.evaluate(prompt => prompt.blur());
	await waitUntil(() => fs.readFileSync(badgePath, 'utf8').includes('description: "Smoke file badge"'), 'the fixture description to be restored');
	await setBadgeFace(false);
	await readme.locator('.basehalf-canvas-card-preview', { hasText: /Smoke README|needle-basehalf-routing/ }).waitFor({ state: 'visible', timeout: 10_000 });
	fs.writeFileSync(badgePath, fixture, 'utf8');
	fs.rmSync(recoveryRoot, { recursive: true, force: true });

	// Criterion 11: when the file system refuses to read the file, a line with
	// the cause takes the place of the description field, and nothing there
	// leads into `.bh/`. Permission bits do not refuse a read on Windows.
	if (process.platform === 'win32') {
		return;
	}
	const canvasPath = path.join(workspacePath, '.bh', 'mirror', 'canvas.yaml');
	const refreshMirror = () => fs.writeFileSync(canvasPath, fs.readFileSync(canvasPath));
	const issueNotice = page.locator('.basehalf-canvas-warning', { hasText: '1 description could not be loaded' });
	fs.chmodSync(badgePath, 0o000);
	try {
		refreshMirror();
		await issueNotice.waitFor({ state: 'visible', timeout: 10_000 });
		await setBadgeFace(true);
		const issue = readme.locator('[data-testid="badge-metadata-issue"]');
		await issue.waitFor({ state: 'visible', timeout: 10_000 });
		const shown = {
			text: (await issue.innerText()).replace(/\s+/g, ' '),
			buttons: await issue.locator('button').count(),
			prompts: await readme.locator('.basehalf-canvas-card-badge-prompt').count()
		};
		if (!shown.text.includes('BaseHalf could not load it:') || shown.buttons !== 0 || shown.prompts !== 0) {
			throw new Error(`A description the file system refuses to read was not shown as one line without a button: ${JSON.stringify(shown)}`);
		}
	} finally {
		fs.chmodSync(badgePath, 0o644);
	}
	refreshMirror();
	await issueNotice.waitFor({ state: 'detached', timeout: 10_000 });
	await badgePrompt.waitFor({ state: 'visible', timeout: 10_000 });
	await setBadgeFace(false);
	await readme.locator('.basehalf-canvas-card-preview', { hasText: /Smoke README|needle-basehalf-routing/ }).waitFor({ state: 'visible', timeout: 10_000 });
}

/**
 * Mirror file resilience, acceptance criterion 14: folders whose names look
 * like numbers leave their canvas readable. Cards next to them still move and
 * stay where they are dropped, and deleting the folders removes their rows
 * without a layout notice or a metadata notification.
 */
async function assertCanvasNumericFolderNames(page) {
	const canvasPath = path.join(workspacePath, '.bh', 'mirror', 'canvas.yaml');
	const savedGeometry = name => readCanvasCardGeometry(fs.readFileSync(canvasPath, 'utf8'), name);
	const cardFor = name => page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${name}"]`);
	await page.keyboard.press('Escape');

	for (const name of ['09', '2024']) {
		await clickCanvasCreateAction(page, 'New Folder...');
		const input = page.locator('.basehalf-canvas-inline-create-card input');
		await input.waitFor({ state: 'visible', timeout: 10_000 });
		await input.fill(name);
		await input.press('Enter');
		await waitUntil(() => fs.existsSync(path.join(workspacePath, name)) && fs.statSync(path.join(workspacePath, name)).isDirectory(), `canvas New Folder to create the folder ${name}`);
		await cardFor(name).waitFor({ state: 'visible', timeout: 10_000 });
		await waitForCanvasCardSelection(page, name);
		await waitUntil(() => savedGeometry(name) !== undefined, `the position of the folder ${name} to be saved`);
	}

	// A move reads the canvas that now holds `path: "09"` before it writes.
	// New cards can land outside the window, so pan to the one that moves and
	// hand the viewport back at the end, where later steps expect it.
	const anchor = cardFor('README.md');
	const anchorBefore = await anchor.boundingBox();
	const moved = cardFor('2024');
	await page.keyboard.press('Escape');
	await centerCanvasCards(page, [moved]);
	const savedBefore = savedGeometry('2024');
	const boxBefore = await moved.boundingBox();
	if (!savedBefore || !boxBefore || !anchorBefore) {
		throw new Error('Missing the 2024 folder card or the viewport anchor before the move');
	}
	const start = { x: boxBefore.x + boxBefore.width / 2, y: boxBefore.y + boxBefore.height / 2 };
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(start.x + 70, start.y + 45, { steps: 10 });
	await page.mouse.up();
	await waitUntil(() => {
		const saved = savedGeometry('2024');
		return saved !== undefined && (saved.x !== savedBefore.x || saved.y !== savedBefore.y);
	}, 'the moved 2024 folder card to be saved next to the 09 folder card');
	// A rejected save writes nothing, and the next render returns the card to
	// its old position. The saved position must have changed and must stay.
	// It is compared in canvas coordinates: the viewport may still be settling,
	// so the card's place on screen says nothing.
	const savedAfter = savedGeometry('2024');
	await page.waitForTimeout(500);
	const savedLater = savedGeometry('2024');
	if (!savedAfter || !savedLater || savedLater.x !== savedAfter.x || savedLater.y !== savedAfter.y
		|| (savedLater.x === savedBefore.x && savedLater.y === savedBefore.y)) {
		throw new Error(`The moved 2024 folder card did not stay where it was dropped: ${JSON.stringify({ savedBefore, savedAfter, savedLater })}`);
	}

	for (const name of ['2024', '09']) {
		await page.keyboard.press('Escape');
		await cardFor(name).click({ button: 'right' });
		const deleteAction = page.locator('.context-view.monaco-menu-container .action-label')
			.filter({ hasText: /^Delete\.\.\.$/ })
			.filter({ visible: true })
			.last();
		await deleteAction.waitFor({ state: 'visible', timeout: 10_000 });
		await page.waitForTimeout(150);
		await deleteAction.click();
		const dialog = page.locator('.monaco-dialog-box', { hasText: `'${name}'` }).first();
		await dialog.waitFor({ state: 'visible', timeout: 10_000 });
		await dialog.locator('.monaco-button', { hasText: /^(Delete Permanently|Move to Trash)$/ }).click();
		await waitUntil(() => !fs.existsSync(path.join(workspacePath, name)), `the folder ${name} to be deleted`);
		await cardFor(name).waitFor({ state: 'hidden', timeout: 10_000 });
		await waitUntil(() => savedGeometry(name) === undefined, `the row of the folder ${name} to leave canvas.yaml`);
	}

	// Toasts never render under the smoke driver, so open notifications are read from the center.
	const notices = await page.locator('.basehalf-canvas-warning').evaluateAll(elements => elements.map(element => element.textContent ?? ''));
	const center = await showNotificationsCenter(page);
	const notifications = await center.locator('.notification-list-item').evaluateAll(elements => elements.map(element => element.textContent ?? ''));
	await hideNotificationsCenter(page);
	const unexpected = [...notices, ...notifications].filter(text => /saved layout|saved card positions|card position|cards and badges/.test(text));
	if (unexpected.length > 0) {
		throw new Error(`Numeric folder names produced a layout notice or a metadata notification: ${JSON.stringify(unexpected)}`);
	}
	if (fs.existsSync(path.join(workspacePath, '.bh', 'cache', 'recovered'))) {
		throw new Error('Numeric folder names made BaseHalf save a recovery copy of a canvas it wrote itself');
	}
	await page.keyboard.press('Escape');
	await panCanvasCardTo(page, anchor, anchorBefore);
}

async function assertCanvasCreateNoteFileAndFolder(page) {
	const createButton = page.locator('.basehalf-canvas-create-button');
	await createButton.waitFor({ state: 'visible', timeout: 10_000 });

	await clickCanvasCreateAction(page, 'New File...');
	let input = page.locator('.basehalf-canvas-inline-create-card input');
	await input.waitFor({ state: 'visible', timeout: 10_000 });
	if (await input.inputValue() !== '' || await input.getAttribute('placeholder') !== 'filename.ext') {
		throw new Error('New File did not start with an empty exact-name input');
	}
	await input.fill('smoke-data.json');
	await input.press('Enter');
	await waitUntil(() => fs.existsSync(path.join(workspacePath, 'smoke-data.json')), 'canvas New File to create the exact extension');
	const dataCard = page.locator('.basehalf-canvas-card[data-basehalf-card-path="smoke-data.json"]');
	await dataCard.waitFor({ state: 'visible', timeout: 10_000 });
	if (await page.locator('.basehalf-card-detail.visible').isVisible().catch(() => false)) {
		throw new Error('Canvas New File opened Card Detail instead of staying on the canvas');
	}
	await waitForCanvasCardSelection(page, 'smoke-data.json');
	if (fs.existsSync(path.join(workspacePath, 'smoke-data.json.md'))) {
		throw new Error('Canvas New File appended .md to an explicitly named JSON file');
	}

	await clickCanvasCreateAction(page, 'New Folder...');
	input = page.locator('.basehalf-canvas-inline-create-card input');
	await input.waitFor({ state: 'visible', timeout: 10_000 });
	if (await input.inputValue() !== '' || await input.getAttribute('placeholder') !== 'Folder name') {
		throw new Error('New Folder did not start with an empty folder-name input');
	}
	await input.fill('smoke-folder');
	await input.press('Enter');
	await waitUntil(() => fs.existsSync(path.join(workspacePath, 'smoke-folder')) && fs.statSync(path.join(workspacePath, 'smoke-folder')).isDirectory(), 'canvas New Folder to create a real folder');
	const folderCard = page.locator('.basehalf-canvas-card[data-basehalf-card-path="smoke-folder"]');
	await folderCard.waitFor({ state: 'visible', timeout: 10_000 });
	if (await page.locator('.basehalf-card-detail.visible').isVisible().catch(() => false)) {
		throw new Error('Canvas New Folder navigated away from its parent canvas');
	}
	await waitForCanvasCardSelection(page, 'smoke-folder');

	await dataCard.dblclick();
	await assertCardDetail(page, 'smoke-data.json');
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+N' : 'Control+N');
	await waitUntil(() => fs.existsSync(path.join(workspacePath, 'untitled.md')), 'global New Note to create an untitled Markdown file');
	const untitledNote = page.locator('.basehalf-canvas-card[data-basehalf-card-path="untitled.md"]');
	await untitledNote.waitFor({ state: 'visible', timeout: 10_000 });
	if (await page.locator('.basehalf-card-detail.visible').isVisible().catch(() => false)) {
		throw new Error('Canvas New Note opened Card Detail instead of staying on the canvas');
	}
	await waitForCanvasCardSelection(page, 'untitled.md');
	const createdNoteEditor = await waitForCanvasNoteInlineEditor(page, 'untitled.md');
	await assertNoCanvasNoteHeavyEditor(page, '.basehalf-canvas-card[data-basehalf-card-path="untitled.md"]', 'new Note automatic inline editing');
	await page.keyboard.press('Escape');
	await createdNoteEditor.host.waitFor({ state: 'detached', timeout: 10_000 });
	fs.rmSync(path.join(workspacePath, 'untitled.md'), { force: true });
	await untitledNote.waitFor({ state: 'hidden', timeout: 10_000 });

	// The Create menu closes after dispatching its command. Its focus restoration
	// must not override the explicit New Note inline-edit intent.
	await clickCanvasCreateAction(page, 'New Note');
	await waitUntil(() => fs.existsSync(path.join(workspacePath, 'untitled.md')), 'canvas Create menu New Note to create an untitled Markdown file');
	await untitledNote.waitFor({ state: 'visible', timeout: 10_000 });
	if (await page.locator('.basehalf-card-detail.visible').isVisible().catch(() => false)) {
		throw new Error('Canvas Create menu New Note opened Card Detail instead of staying on the canvas');
	}
	await waitForCanvasCardSelection(page, 'untitled.md');
	const menuCreatedNoteEditor = await waitForCanvasNoteInlineEditor(page, 'untitled.md');
	await page.keyboard.press('Escape');
	await menuCreatedNoteEditor.host.waitFor({ state: 'detached', timeout: 10_000 });
	fs.rmSync(path.join(workspacePath, 'untitled.md'), { force: true });
	await untitledNote.waitFor({ state: 'hidden', timeout: 10_000 });

	// File intent remains distinct from Note intent even when the exact filename
	// is Markdown: select the card, but do not enter its inline editor.
	await clickCanvasCreateAction(page, 'New File...');
	input = page.locator('.basehalf-canvas-inline-create-card input');
	await input.waitFor({ state: 'visible', timeout: 10_000 });
	await input.fill('smoke-note.md');
	await input.press('Enter');
	await waitUntil(() => fs.existsSync(path.join(workspacePath, 'smoke-note.md')), 'canvas New File to create an exact Markdown filename');
	const emptyNote = page.locator('.basehalf-canvas-card[data-basehalf-card-path="smoke-note.md"]');
	await emptyNote.waitFor({ state: 'visible', timeout: 10_000 });
	await waitForCanvasCardSelection(page, 'smoke-note.md');
	if (await page.locator('.basehalf-card-detail.visible').isVisible().catch(() => false)) {
		throw new Error('Canvas New File treated an exact Markdown filename as an automatic Card Detail open');
	}
	if (await canvasNoteInlineEditor(page, 'smoke-note.md').host.count() !== 0) {
		throw new Error('Canvas New File treated an exact Markdown file as the New Note editing intent');
	}
	await centerCanvasCards(page, [emptyNote]);
	const emptyNotePlaceholder = emptyNote.locator('.basehalf-canvas-note-empty', { hasText: 'Double-click to edit' });
	await emptyNotePlaceholder.waitFor({ state: 'visible', timeout: 10_000 });
	await emptyNote.click();
	const emptyNoteEditor = canvasNoteInlineEditor(page, 'smoke-note.md');
	const emptyNoteToolbar = page.getByRole('toolbar', { name: 'Actions for smoke-note.md', exact: true });
	await emptyNoteToolbar.waitFor({ state: 'visible', timeout: 10_000 });
	const emptyToolbarLabels = await emptyNoteToolbar.locator('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')));
	const expectedEmptyToolbarLabels = ['Background color', 'Heading 1', 'Heading 2', 'Heading 3', 'Paragraph', 'Bold', 'Italic', 'Bulleted list', 'Numbered list', 'Divider', 'Copy all', 'Expand smoke-note.md'];
	if (JSON.stringify(emptyToolbarLabels) !== JSON.stringify(expectedEmptyToolbarLabels)) {
		throw new Error(`The empty Note toolbar has an unexpected action contract: ${JSON.stringify(emptyToolbarLabels)}`);
	}
	if (await emptyNote.getAttribute('data-preview-level') !== 'preview' || await emptyNoteEditor.host.count() !== 0) {
		throw new Error('Selecting a newly created empty Note mounted its editor before a double click');
	}
	await assertNoCanvasNoteHeavyEditor(page, '.basehalf-canvas-card[data-basehalf-card-path="smoke-note.md"]', 'empty Note selection');
	const emptyInlineOpenStarted = Date.now();
	await emptyNotePlaceholder.dblclick();
	const activeEmptyNoteEditor = await waitForCanvasNoteInlineEditor(page, 'smoke-note.md');
	console.error(`[basehalf-smoke] canvas-note-empty-inline-ready-ms ${Date.now() - emptyInlineOpenStarted}`);
	await assertNoCanvasNoteHeavyEditor(page, '.basehalf-canvas-card[data-basehalf-card-path="smoke-note.md"]', 'empty Note inline editing');
	const emptyNotePath = path.join(workspacePath, 'smoke-note.md');
	const initialEmptyNoteMarkdown = fs.readFileSync(emptyNotePath, 'utf8');
	if (initialEmptyNoteMarkdown.trim() !== '') {
		throw new Error(`A newly created empty Note had unexpected content before its first Canvas edit: ${JSON.stringify(initialEmptyNoteMarkdown)}`);
	}
	const projectionTokens = {
		heading1: 'Projection heading one',
		heading2: 'Projection heading two',
		heading3: 'Projection heading three',
		paragraph: 'Projection paragraph',
		emphasis: 'Projection bold italic',
		bullet: 'Projection bullet item',
		numbered: 'Projection numbered item',
		dividerTail: 'Projection divider tail',
		richHeading1: 'Rich command heading one',
		richHeading2: 'Rich command heading two',
		richHeading3: 'Rich command heading three',
		richParagraph: 'Rich command paragraph',
		richEmphasis: 'Rich command bold italic',
		richBullet: 'Rich command bullet item',
		richOrdered: 'Rich command numbered item',
		richDivider: 'Rich command divider anchor'
	};
	const projectionParagraphs = Object.values(projectionTokens);
	for (let index = 0; index < projectionParagraphs.length; index++) {
		await page.keyboard.insertText(projectionParagraphs[index]);
		if (index < projectionParagraphs.length - 1) {
			await page.keyboard.press('Enter');
		}
	}

	const applyBlockFormat = async (token, action, selector) => {
		await selectCanvasInlineToken(activeEmptyNoteEditor.editable, token);
		await emptyNoteToolbar.getByRole('button', { name: action, exact: true }).click();
		await activeEmptyNoteEditor.editable.locator(selector, { hasText: token }).waitFor({ state: 'visible', timeout: 3_000 });
	};
	await applyBlockFormat(projectionTokens.heading1, 'Heading 1', 'h1');
	await applyBlockFormat(projectionTokens.heading2, 'Heading 2', 'h2');
	await applyBlockFormat(projectionTokens.heading3, 'Heading 3', 'h3');
	await applyBlockFormat(projectionTokens.heading3, 'Bulleted list', 'ul li');
	await applyBlockFormat(projectionTokens.heading3, 'Heading 3', 'h3');
	await applyBlockFormat(projectionTokens.paragraph, 'Heading 1', 'h1');
	await applyBlockFormat(projectionTokens.paragraph, 'Paragraph', 'p');
	await selectCanvasInlineToken(activeEmptyNoteEditor.editable, projectionTokens.emphasis);
	await emptyNoteToolbar.getByRole('button', { name: 'Bold', exact: true }).click();
	await emptyNoteToolbar.getByRole('button', { name: 'Italic', exact: true }).click();
	const canvasEmphasis = activeEmptyNoteEditor.editable.locator('p', { hasText: projectionTokens.emphasis });
	await canvasEmphasis.locator('strong', { hasText: projectionTokens.emphasis }).waitFor({ state: 'visible', timeout: 3_000 });
	await canvasEmphasis.locator('em', { hasText: projectionTokens.emphasis }).waitFor({ state: 'visible', timeout: 3_000 });
	await applyBlockFormat(projectionTokens.bullet, 'Bulleted list', 'ul li');
	await selectCanvasInlineToken(activeEmptyNoteEditor.editable, projectionTokens.bullet);
	const bulletListItem = activeEmptyNoteEditor.editable.locator('ul li', { hasText: projectionTokens.bullet });
	await emptyNoteToolbar.getByRole('button', { name: 'Bulleted list', exact: true }).click();
	await bulletListItem.waitFor({ state: 'detached', timeout: 3_000 });
	await activeEmptyNoteEditor.editable.locator('.basehalf-canvas-markdown-inline-unit > p', { hasText: projectionTokens.bullet }).waitFor({ state: 'visible', timeout: 3_000 });
	await applyBlockFormat(projectionTokens.bullet, 'Bulleted list', 'ul li');
	await applyBlockFormat(projectionTokens.bullet, 'Numbered list', 'ol li');
	await applyBlockFormat(projectionTokens.bullet, 'Bulleted list', 'ul li');
	await applyBlockFormat(projectionTokens.numbered, 'Numbered list', 'ol li');
	await applyBlockFormat(projectionTokens.numbered, 'Heading 1', 'h1');
	await applyBlockFormat(projectionTokens.numbered, 'Numbered list', 'ol li');
	await selectCanvasInlineToken(activeEmptyNoteEditor.editable, projectionTokens.dividerTail);
	await emptyNoteToolbar.getByRole('button', { name: 'Divider', exact: true }).click();
	await activeEmptyNoteEditor.editable.locator('hr').waitFor({ state: 'visible', timeout: 3_000 });
	await activeEmptyNoteEditor.editable.locator('p', { hasText: projectionTokens.dividerTail }).waitFor({ state: 'visible', timeout: 3_000 });
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
	await activeEmptyNoteEditor.editable.locator('hr').waitFor({ state: 'detached', timeout: 3_000 });
	await activeEmptyNoteEditor.editable.locator('p', { hasText: projectionTokens.dividerTail }).waitFor({ state: 'visible', timeout: 3_000 });
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y');
	await activeEmptyNoteEditor.editable.locator('hr').waitFor({ state: 'visible', timeout: 3_000 });
	await activeEmptyNoteEditor.editable.locator('p', { hasText: projectionTokens.dividerTail }).waitFor({ state: 'visible', timeout: 3_000 });

	await emptyNoteToolbar.getByRole('button', { name: 'Expand smoke-note.md', exact: true }).click();
	await assertCardDetail(page, 'smoke-note.md');
	await emptyNoteEditor.host.waitFor({ state: 'detached', timeout: 15_000 });
	await waitUntil(() => {
		const markdown = fs.readFileSync(emptyNotePath, 'utf8');
		return projectionParagraphs.every(token => markdown.includes(token));
	}, 'Canvas formatting to save every edited block before Expand', 15_000);
	const canvasFormattedMarkdown = fs.readFileSync(emptyNotePath, 'utf8');
	const sourceSemantics = {
		heading1: new RegExp(`^# ${projectionTokens.heading1}$`, 'm').test(canvasFormattedMarkdown),
		heading2: new RegExp(`^## ${projectionTokens.heading2}$`, 'm').test(canvasFormattedMarkdown),
		heading3: new RegExp(`^### ${projectionTokens.heading3}$`, 'm').test(canvasFormattedMarkdown),
		paragraph: new RegExp(`^${projectionTokens.paragraph}$`, 'm').test(canvasFormattedMarkdown),
		bullet: new RegExp(`^[*+-] ${projectionTokens.bullet}$`, 'm').test(canvasFormattedMarkdown),
		numbered: new RegExp(`^1\\. ${projectionTokens.numbered}$`, 'm').test(canvasFormattedMarkdown),
		divider: /^---$/m.test(canvasFormattedMarkdown)
	};
	if (Object.values(sourceSemantics).some(value => !value)) {
		throw new Error(`Canvas toolbar did not save standard Markdown semantics: ${JSON.stringify({ sourceSemantics, canvasFormattedMarkdown })}`);
	}
	const projectionFrame = await activeMarkdownRichFrame(page, '.basehalf-card-detail-surface.active');
	await projectionFrame.locator('.bn-editor', { hasText: projectionTokens.dividerTail }).waitFor({ state: 'visible', timeout: 15_000 });
	const richBlocks = await projectionFrame.locator('.bn-block-content').evaluateAll(elements => elements.map(element => ({
		type: element.getAttribute('data-content-type'),
		level: element.getAttribute('data-level'),
		headingTag: element.querySelector('h1, h2, h3')?.tagName ?? null,
		text: element.textContent?.trim() ?? '',
		bold: element.querySelector('strong') !== null,
		italic: element.querySelector('em') !== null,
		divider: element.querySelector('hr') !== null
	})));
	const richBlock = token => richBlocks.find(block => block.text.includes(token));
	const richSemantics = {
		heading1: richBlock(projectionTokens.heading1)?.type === 'heading' && richBlock(projectionTokens.heading1)?.headingTag === 'H1',
		heading2: richBlock(projectionTokens.heading2)?.type === 'heading' && richBlock(projectionTokens.heading2)?.headingTag === 'H2',
		heading3: richBlock(projectionTokens.heading3)?.type === 'heading' && richBlock(projectionTokens.heading3)?.headingTag === 'H3',
		paragraph: richBlock(projectionTokens.paragraph)?.type === 'paragraph',
		bold: richBlock(projectionTokens.emphasis)?.type === 'paragraph' && richBlock(projectionTokens.emphasis)?.bold === true,
		italic: richBlock(projectionTokens.emphasis)?.type === 'paragraph' && richBlock(projectionTokens.emphasis)?.italic === true,
		bullet: richBlock(projectionTokens.bullet)?.type === 'bulletListItem',
		numbered: richBlock(projectionTokens.numbered)?.type === 'numberedListItem',
		divider: richBlocks.some(block => block.type === 'divider' && block.divider),
		dividerTail: richBlock(projectionTokens.dividerTail)?.type === 'paragraph'
	};
	if (Object.values(richSemantics).some(value => !value)) {
		throw new Error(`The rich projection did not preserve Canvas formatting semantics: ${JSON.stringify({ richSemantics, richBlocks })}`);
	}

	// Exercise the shared commands inside the real BlockNote projection. This
	// intentionally enters through the same validated webview message boundary
	// as the host adapter, then leaves the resulting Markdown for the Canvas
	// projection to parse after Card Detail closes.
	const richKey = decodeURIComponent(await projectionFrame.locator('#root').getAttribute('data-basehalf-key') ?? '');
	if (!richKey) {
		throw new Error('The rich projection did not expose its document key');
	}
	const sendRichFormat = async command => {
		await projectionFrame.evaluate(({ key, command }) => new Promise((resolve, reject) => {
			const message = { type: 'basehalf.markdownRich.command', key, command };
			const onMessage = event => {
				if (event.source !== window
					|| event.data?.type !== message.type
					|| event.data?.key !== key
					|| event.data?.command !== command) {
					return;
				}
				window.clearTimeout(timeout);
				window.removeEventListener('message', onMessage);
				resolve(undefined);
			};
			const timeout = window.setTimeout(() => {
				window.removeEventListener('message', onMessage);
				reject(new Error(`Timed out delivering rich editor command: ${command}`));
			}, 3_000);
			window.addEventListener('message', onMessage);
			window.postMessage(message, '*');
		}), { key: richKey, command });
	};
	const focusRichBlock = async token => {
		const block = projectionFrame.locator('.bn-block-content', { hasText: token }).first();
		await block.scrollIntoViewIfNeeded();
		await block.click();
		return block;
	};
	const selectRichToken = async token => {
		const selected = await projectionFrame.evaluate(expectedToken => {
			const root = document.querySelector('.bn-editor');
			if (!root) {
				return false;
			}
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
			while (walker.nextNode()) {
				const node = walker.currentNode;
				const start = node.textContent?.indexOf(expectedToken) ?? -1;
				if (start < 0) {
					continue;
				}
				const range = document.createRange();
				range.setStart(node, start);
				range.setEnd(node, start + expectedToken.length);
				const selection = window.getSelection();
				selection?.removeAllRanges();
				selection?.addRange(range);
				document.dispatchEvent(new Event('selectionchange'));
				return true;
			}
			return false;
		}, token);
		if (!selected) {
			throw new Error(`The rich projection did not render selectable text: ${token}`);
		}
		await page.waitForTimeout(50);
	};

	await focusRichBlock(projectionTokens.richHeading1);
	await sendRichFormat('setHeading1');
	await projectionFrame.locator('h1', { hasText: projectionTokens.richHeading1 }).waitFor({ state: 'visible', timeout: 3_000 });
	await sendRichFormat('setHeading1');
	await sendRichFormat('undo');
	await projectionFrame.locator('.bn-block-content[data-content-type="paragraph"]', { hasText: projectionTokens.richHeading1 }).waitFor({ state: 'visible', timeout: 3_000 });
	await sendRichFormat('redo');
	await projectionFrame.locator('h1', { hasText: projectionTokens.richHeading1 }).waitFor({ state: 'visible', timeout: 3_000 });
	await focusRichBlock(projectionTokens.richHeading2);
	await sendRichFormat('setHeading2');
	await projectionFrame.locator('h2', { hasText: projectionTokens.richHeading2 }).waitFor({ state: 'visible', timeout: 3_000 });
	await focusRichBlock(projectionTokens.richParagraph);
	await sendRichFormat('setHeading1');
	await projectionFrame.locator('h1', { hasText: projectionTokens.richParagraph }).waitFor({ state: 'visible', timeout: 3_000 });
	await sendRichFormat('setParagraph');
	await projectionFrame.locator('.bn-block-content[data-content-type="paragraph"]', { hasText: projectionTokens.richParagraph }).waitFor({ state: 'visible', timeout: 3_000 });

	await selectRichToken(projectionTokens.richEmphasis);
	await sendRichFormat('toggleBold');
	await sendRichFormat('toggleItalic');
	const richCommandEmphasis = projectionFrame.locator('.bn-block-content', { hasText: projectionTokens.richEmphasis });
	await richCommandEmphasis.locator('strong', { hasText: projectionTokens.richEmphasis }).waitFor({ state: 'visible', timeout: 3_000 });
	await richCommandEmphasis.locator('em', { hasText: projectionTokens.richEmphasis }).waitFor({ state: 'visible', timeout: 3_000 });

	await focusRichBlock(projectionTokens.richBullet);
	await sendRichFormat('toggleBulletList');
	await projectionFrame.locator('.bn-block-content[data-content-type="bulletListItem"]', { hasText: projectionTokens.richBullet }).waitFor({ state: 'visible', timeout: 3_000 });
	await sendRichFormat('toggleBulletList');
	await projectionFrame.locator('.bn-block-content[data-content-type="paragraph"]', { hasText: projectionTokens.richBullet }).waitFor({ state: 'visible', timeout: 3_000 });
	await sendRichFormat('toggleBulletList');
	await projectionFrame.locator('.bn-block-content[data-content-type="bulletListItem"]', { hasText: projectionTokens.richBullet }).waitFor({ state: 'visible', timeout: 3_000 });
	await focusRichBlock(projectionTokens.richOrdered);
	await sendRichFormat('toggleOrderedList');
	await projectionFrame.locator('.bn-block-content[data-content-type="numberedListItem"]', { hasText: projectionTokens.richOrdered }).waitFor({ state: 'visible', timeout: 3_000 });
	await sendRichFormat('toggleBulletList');
	await projectionFrame.locator('.bn-block-content[data-content-type="bulletListItem"]', { hasText: projectionTokens.richOrdered }).waitFor({ state: 'visible', timeout: 3_000 });
	await sendRichFormat('toggleOrderedList');
	await projectionFrame.locator('.bn-block-content[data-content-type="numberedListItem"]', { hasText: projectionTokens.richOrdered }).waitFor({ state: 'visible', timeout: 3_000 });

	const dividerCountBeforeRichCommand = await projectionFrame.locator('.bn-block-content[data-content-type="divider"] hr').count();
	await focusRichBlock(projectionTokens.richDivider);
	await sendRichFormat('insertDivider');
	await projectionFrame.waitForFunction(expected => document.querySelectorAll('.bn-block-content[data-content-type="divider"] hr').length === expected, dividerCountBeforeRichCommand + 1);
	await sendRichFormat('undo');
	await projectionFrame.waitForFunction(expected => document.querySelectorAll('.bn-block-content[data-content-type="divider"] hr').length === expected, dividerCountBeforeRichCommand);
	if (!(await projectionFrame.locator('h1', { hasText: projectionTokens.richHeading1 }).count())
		|| !(await projectionFrame.locator('.bn-block-content[data-content-type="numberedListItem"]', { hasText: projectionTokens.richOrdered }).count())) {
		throw new Error('One rich Undo crossed the formatting-command boundary');
	}
	await sendRichFormat('redo');
	await projectionFrame.waitForFunction(expected => document.querySelectorAll('.bn-block-content[data-content-type="divider"] hr').length === expected, dividerCountBeforeRichCommand + 1);

	await focusRichBlock(projectionTokens.richHeading3);
	await dispatchMarkdownRichComposition(projectionFrame, 'compositionstart');
	await sendRichFormat('setHeading3');
	if (await projectionFrame.locator('h3', { hasText: projectionTokens.richHeading3 }).count()) {
		throw new Error('The rich projection ran a formatting command before IME composition settled');
	}
	await dispatchMarkdownRichComposition(projectionFrame, 'compositionend');
	await projectionFrame.locator('h3', { hasText: projectionTokens.richHeading3 }).waitFor({ state: 'visible', timeout: 3_000 });

	await closeCardDetailIfOpen(page);
	await page.locator('.basehalf-canvas-cards').waitFor({ state: 'visible', timeout: 15_000 });
	await centerCanvasCards(page, [emptyNote]);
	await emptyNote.locator('.bh-md-preview h1', { hasText: projectionTokens.heading1 }).waitFor({ state: 'visible', timeout: 15_000 });
	await emptyNote.locator('.bh-md-preview h2', { hasText: projectionTokens.heading2 }).waitFor({ state: 'visible', timeout: 15_000 });
	await emptyNote.locator('.bh-md-preview h3', { hasText: projectionTokens.heading3 }).waitFor({ state: 'visible', timeout: 15_000 });
	await emptyNote.locator('.bh-md-preview p', { hasText: projectionTokens.paragraph }).waitFor({ state: 'visible', timeout: 15_000 });
	const previewEmphasis = emptyNote.locator('.bh-md-preview p', { hasText: projectionTokens.emphasis });
	await previewEmphasis.locator('strong', { hasText: projectionTokens.emphasis }).waitFor({ state: 'visible', timeout: 15_000 });
	await previewEmphasis.locator('em', { hasText: projectionTokens.emphasis }).waitFor({ state: 'visible', timeout: 15_000 });
	await emptyNote.locator('.bh-md-preview ul li', { hasText: projectionTokens.bullet }).waitFor({ state: 'visible', timeout: 15_000 });
	await emptyNote.locator('.bh-md-preview ol li', { hasText: projectionTokens.numbered }).waitFor({ state: 'visible', timeout: 15_000 });
	await page.waitForFunction(expected => {
		const preview = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="smoke-note.md"] .bh-md-preview');
		return preview?.querySelectorAll('hr').length === expected;
	}, dividerCountBeforeRichCommand + 1, { timeout: 15_000 });
	await emptyNote.locator('.bh-md-preview h1', { hasText: projectionTokens.richHeading1 }).waitFor({ state: 'visible', timeout: 15_000 });
	await emptyNote.locator('.bh-md-preview h2', { hasText: projectionTokens.richHeading2 }).waitFor({ state: 'visible', timeout: 15_000 });
	await emptyNote.locator('.bh-md-preview h3', { hasText: projectionTokens.richHeading3 }).waitFor({ state: 'visible', timeout: 15_000 });
	await emptyNote.locator('.bh-md-preview p', { hasText: projectionTokens.richParagraph }).waitFor({ state: 'visible', timeout: 15_000 });
	const richCommandPreviewEmphasis = emptyNote.locator('.bh-md-preview p', { hasText: projectionTokens.richEmphasis });
	await richCommandPreviewEmphasis.locator('strong', { hasText: projectionTokens.richEmphasis }).waitFor({ state: 'visible', timeout: 15_000 });
	await richCommandPreviewEmphasis.locator('em', { hasText: projectionTokens.richEmphasis }).waitFor({ state: 'visible', timeout: 15_000 });
	await emptyNote.locator('.bh-md-preview ul li', { hasText: projectionTokens.richBullet }).waitFor({ state: 'visible', timeout: 15_000 });
	const richFormattedMarkdown = fs.readFileSync(emptyNotePath, 'utf8');
	if (richFormattedMarkdown === canvasFormattedMarkdown) {
		throw new Error('The rich formatting adapter did not serialize any of its semantic edits');
	}
	if (!new RegExp(`^1\\. ${projectionTokens.richOrdered}$`, 'm').test(richFormattedMarkdown)
		|| !new RegExp(`^${projectionTokens.richDivider}\\n\\n(?:---|\\*\\*\\*)$`, 'm').test(richFormattedMarkdown)) {
		throw new Error(`The rich list or divider command did not save standard Markdown: ${JSON.stringify(richFormattedMarkdown)}`);
	}

	// A resting-toolbar command is accepted before its inline projection exists.
	// Expanding immediately afterwards must wait for that edit and its durable
	// working-copy flush instead of dropping or replaying the command later.
	await emptyNote.locator('.bh-md-preview p', { hasText: projectionTokens.paragraph }).dblclick();
	const reopenedEmptyNoteEditor = await waitForCanvasNoteInlineEditor(page, 'smoke-note.md');
	await reopenedEmptyNoteEditor.editable.locator('ol li', { hasText: projectionTokens.richOrdered }).waitFor({ state: 'visible', timeout: 15_000 });
	if ((await reopenedEmptyNoteEditor.editable.locator('hr').count()) !== dividerCountBeforeRichCommand + 1) {
		throw new Error('The Canvas editor did not parse the divider saved by the rich projection');
	}
	await selectCanvasInlineToken(reopenedEmptyNoteEditor.editable, projectionTokens.paragraph);
	await page.keyboard.press('Escape');
	await reopenedEmptyNoteEditor.host.waitFor({ state: 'detached', timeout: 15_000 });
	await emptyNote.locator('.bh-md-preview p', { hasText: projectionTokens.paragraph }).waitFor({ state: 'visible', timeout: 15_000 });
	await emptyNoteToolbar.getByRole('button', { name: 'Heading 2', exact: true }).click();
	await emptyNoteToolbar.getByRole('button', { name: 'Expand smoke-note.md', exact: true }).click();
	await assertCardDetail(page, 'smoke-note.md');
	const immediateExpandFrame = await activeMarkdownRichFrame(page, '.basehalf-card-detail-surface.active');
	await immediateExpandFrame.locator('h2', { hasText: projectionTokens.paragraph }).waitFor({ state: 'visible', timeout: 15_000 });
	await waitUntil(
		() => new RegExp(`^## ${projectionTokens.paragraph}$`, 'm').test(fs.readFileSync(emptyNotePath, 'utf8')),
		'resting format command to persist before immediate Expand',
		15_000
	);
	await closeCardDetailIfOpen(page);
	await page.locator('.basehalf-canvas-cards').waitFor({ state: 'visible', timeout: 15_000 });
	await centerCanvasCards(page, [emptyNote]);
	await emptyNote.locator('.bh-md-preview h2', { hasText: projectionTokens.paragraph }).waitFor({ state: 'visible', timeout: 15_000 });

	await emptyNote.locator('.bh-md-preview p', { hasText: projectionTokens.dividerTail }).dblclick();
	const selectionExitEditor = await waitForCanvasNoteInlineEditor(page, 'smoke-note.md');
	await selectCanvasInlineToken(selectionExitEditor.editable, projectionTokens.dividerTail);
	await page.keyboard.press('Escape');
	await selectionExitEditor.host.waitFor({ state: 'detached', timeout: 15_000 });
	await emptyNoteToolbar.getByRole('button', { name: 'Heading 1', exact: true }).click();
	await page.locator('.basehalf-canvas-card[data-basehalf-card-path="smoke-data.json"]').click();
	await selectionExitEditor.host.waitFor({ state: 'detached', timeout: 15_000 });
	await emptyNote.locator('.bh-md-preview h1', { hasText: projectionTokens.dividerTail }).waitFor({ state: 'visible', timeout: 15_000 });
	await waitUntil(
		() => new RegExp(`^# ${projectionTokens.dividerTail}$`, 'm').test(fs.readFileSync(emptyNotePath, 'utf8')),
		'resting format command to persist before selecting another card',
		15_000
	);

	// Direct navigation does not originate from the selected-card delegate. Its
	// navigation barrier must still wait for a resting format intent to mount,
	// execute, and reach disk before Quick Open changes the visible resource.
	await emptyNote.click();
	await emptyNoteToolbar.waitFor({ state: 'visible', timeout: 10_000 });
	await emptyNote.locator('.bh-md-preview h2', { hasText: projectionTokens.paragraph }).dblclick();
	const quickOpenExitEditor = await waitForCanvasNoteInlineEditor(page, 'smoke-note.md');
	await selectCanvasInlineToken(quickOpenExitEditor.editable, projectionTokens.paragraph);
	await page.keyboard.press('Escape');
	await quickOpenExitEditor.host.waitFor({ state: 'detached', timeout: 15_000 });
	await emptyNoteToolbar.getByRole('button', { name: 'Heading 3', exact: true }).click();
	await quickOpen(page, 'README.md');
	await assertCardDetail(page, 'README.md');
	await waitUntil(
		() => new RegExp(`^### ${projectionTokens.paragraph}$`, 'm').test(fs.readFileSync(emptyNotePath, 'utf8')),
		'resting format command to persist before direct Quick Open navigation',
		15_000
	);
	await closeCardDetailIfOpen(page);
	await page.locator('.basehalf-canvas-cards').waitFor({ state: 'visible', timeout: 15_000 });
	await centerCanvasCards(page, [emptyNote]);
	await emptyNote.locator('.bh-md-preview h3', { hasText: projectionTokens.paragraph }).waitFor({ state: 'visible', timeout: 15_000 });
	await assertNoCanvasNoteHeavyEditor(page, '.basehalf-canvas-card[data-basehalf-card-path="smoke-note.md"]', 'Canvas to rich projection round trip');
	if (await page.getByRole('button', { name: /save/i }).filter({ visible: true }).count()) {
		throw new Error('Inline Note editing exposed an explicit Save action');
	}

	for (const relativePath of ['smoke-data.json', 'smoke-folder', 'smoke-note.md']) {
		fs.rmSync(path.join(workspacePath, relativePath), { recursive: true, force: true });
	}
	await page.waitForFunction(() => !document.querySelector(
		'.basehalf-canvas-card[data-basehalf-card-path="smoke-data.json"],'
		+ '.basehalf-canvas-card[data-basehalf-card-path="smoke-folder"],'
		+ '.basehalf-canvas-card[data-basehalf-card-path="smoke-note.md"]'
	), null, { timeout: 10_000 });
}

async function clickCanvasCreateAction(page, label) {
	const createButton = page.locator('.basehalf-canvas-create-button');
	await createButton.focus();
	await page.keyboard.press('Enter');
	// A command keybinding is part of the menuitem's accessible name (for
	// example, "New Note ⌘N"). Match the visible action label so the helper
	// exercises both keybound and unbound create commands.
	const action = page.locator('.context-view.monaco-menu-container .action-label')
		.filter({ hasText: new RegExp(`^${escapeRegExp(label)}$`) })
		.filter({ visible: true })
		.last();
	await action.waitFor({ state: 'visible', timeout: 10_000 });
	// VS Code intentionally attaches menu mouse-up listeners after a 100 ms
	// guard against the pointer event that opened the menu. Let the real widget
	// settle, then use a normal Playwright click through its public interaction.
	await page.waitForTimeout(150);
	await action.click();
}

async function clickCanvasCreateSubmenuAction(page, submenuLabel, actionLabel) {
	const createButton = page.locator('.basehalf-canvas-create-button');
	await createButton.focus();
	await page.keyboard.press('Enter');
	const submenu = page.getByRole('menuitem', { name: submenuLabel, exact: true }).filter({ visible: true }).last();
	await submenu.waitFor({ state: 'visible', timeout: 10_000 });
	await page.waitForTimeout(150);
	await submenu.hover();
	const action = page.getByRole('menuitem', { name: actionLabel, exact: true }).filter({ visible: true }).last();
	await action.waitFor({ state: 'visible', timeout: 10_000 });
	await page.waitForTimeout(150);
	await action.click();
}

async function centerCanvasCards(page, cards) {
	const canvas = page.locator('.basehalf-canvas-cards');
	for (let attempt = 0; attempt < 4; attempt++) {
		const canvasBox = await canvas.boundingBox();
		const cardBoxes = await Promise.all(cards.map(card => card.boundingBox()));
		if (!canvasBox || cardBoxes.some(box => !box)) {
			await page.waitForTimeout(100);
			continue;
		}

		const boxes = cardBoxes;
		const left = Math.min(...boxes.map(box => box.x));
		const right = Math.max(...boxes.map(box => box.x + box.width));
		const top = Math.min(...boxes.map(box => box.y));
		const bottom = Math.max(...boxes.map(box => box.y + box.height));
		const deltaX = canvasBox.x + canvasBox.width / 2 - (left + right) / 2;
		const deltaY = canvasBox.y + canvasBox.height / 2 - (top + bottom) / 2;
		if (Math.abs(deltaX) < 2 && Math.abs(deltaY) < 2) {
			return;
		}

		await panCanvasToward(page, canvasBox, deltaX, deltaY);
	}

	throw new Error('Canvas viewport did not settle around the requested cards');
}

/**
 * Pans the canvas until `card` is at the screen position `expected`, so a
 * step that had to pan can hand the viewport back as it found it.
 */
async function panCanvasCardTo(page, card, expected) {
	const canvas = page.locator('.basehalf-canvas-cards');
	for (let attempt = 0; attempt < 12; attempt++) {
		const canvasBox = await canvas.boundingBox();
		const box = await card.boundingBox();
		if (!canvasBox || !box) {
			await page.waitForTimeout(100);
			continue;
		}
		const deltaX = expected.x - box.x;
		const deltaY = expected.y - box.y;
		if (Math.abs(deltaX) < 2 && Math.abs(deltaY) < 2) {
			return;
		}

		await panCanvasToward(page, canvasBox, deltaX, deltaY);
	}

	throw new Error('Canvas viewport did not return to where the step found it');
}

/** One middle-button pan toward the delta, as far as the canvas bounds allow. */
async function panCanvasToward(page, canvasBox, deltaX, deltaY) {
	const panStart = await page.evaluate(({ bounds, horizontal, vertical }) => {
		const xFractions = horizontal >= 0 ? [0.15, 0.3, 0.5, 0.7, 0.85] : [0.85, 0.7, 0.5, 0.3, 0.15];
		const yFractions = vertical >= 0 ? [0.15, 0.3, 0.5, 0.7, 0.85] : [0.85, 0.7, 0.5, 0.3, 0.15];
		for (const yFraction of yFractions) {
			for (const xFraction of xFractions) {
				const x = bounds.x + bounds.width * xFraction;
				const y = bounds.y + bounds.height * yFraction;
				// A drag by the middle button moves the canvas from empty canvas, from a
				// card, and from a connection. It does not from a toolbar or another
				// surface that keeps the pointer, and such a surface can lie on the
				// first point: the toolbar of a set is as wide as its names.
				const hit = document.elementFromPoint(x, y);
				if (hit?.closest('.react-flow__pane') && (hit.closest('.react-flow__node, .react-flow__edge') || !hit.closest('.nopan'))) {
					return { x, y };
				}
			}
		}
		return undefined;
	}, { bounds: canvasBox, horizontal: deltaX, vertical: deltaY });
	if (!panStart) {
		await page.waitForTimeout(100);
		return;
	}

	const startX = panStart.x;
	const startY = panStart.y;
	const maxDeltaX = Math.max(1, deltaX >= 0
		? canvasBox.x + canvasBox.width - startX - 12
		: startX - canvasBox.x - 12);
	const maxDeltaY = Math.max(1, deltaY >= 0
		? canvasBox.y + canvasBox.height - startY - 12
		: startY - canvasBox.y - 12);
	await page.mouse.move(startX, startY);
	await page.mouse.down({ button: 'middle' });
	await page.mouse.move(
		startX + Math.max(-maxDeltaX, Math.min(maxDeltaX, deltaX)),
		startY + Math.max(-maxDeltaY, Math.min(maxDeltaY, deltaY)),
		{ steps: 8 }
	);
	await page.mouse.up({ button: 'middle' });
	await page.waitForTimeout(50);
}

// A derived edge (from the reference graph) is drawn on the current canvas.
async function assertCanvasEdgeVisible(page, from, to) {
	await page.waitForFunction(([f, t]) => {
		return Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.some(p => p instanceof SVGPathElement && p.dataset.edgeId === `${f}${String.fromCharCode(0)}${t}`);
	}, [from, to], { timeout: 15_000 });
}

async function assertCanvasEdgeGone(page, from, to) {
	await page.waitForFunction(([f, t]) => {
		return !Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.some(p => p instanceof SVGPathElement && p.dataset.edgeId === `${f}${String.fromCharCode(0)}${t}`);
	}, [from, to], { timeout: 15_000 });
}

// The original regression: while the pointer is still down, React Flow's
// controlled node and custom edge must consume the same live geometry. Disk
// persistence intentionally happens only after pointer-up.
async function assertCanvasEdgeFollowsCardDragLive(page) {
	const canvasPath = path.join(workspacePath, '.bh', 'mirror', 'canvas.yaml');
	const docs = page.locator('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
	const docsNode = page.locator('.react-flow__node', { has: docs });
	await docs.click();
	const docsToolbar = page.locator('.basehalf-canvas-selection-toolbar.basehalf-canvas-adjacent-chrome');
	await docsToolbar.waitFor({ state: 'visible', timeout: 10_000 });
	await page.waitForFunction(() => {
		const toolbar = document.querySelector('.basehalf-canvas-selection-toolbar.basehalf-canvas-adjacent-chrome');
		return toolbar instanceof HTMLElement
			&& toolbar.dataset.chromeState === 'present'
			&& getComputedStyle(toolbar).visibility === 'visible'
			&& Math.abs(Number.parseFloat(getComputedStyle(toolbar).opacity || '1') - 1) <= 0.001;
	}, null, { timeout: 10_000 });
	await waitForAdjacentChromeAnimations(page);
	const docsToolbarIdentity = `docs-toolbar-${Date.now()}-${Math.random()}`;
	await docsToolbar.evaluate((toolbar, identity) => toolbar.dataset.smokeAdjacentChromeIdentity = identity, docsToolbarIdentity);
	const docsToolbarBefore = await captureAdjacentChromeSurface(docsToolbar);
	assertAdjacentChromeSurfaceState(docsToolbarBefore, 'present', 'for the selected docs card before drag');
	if (docsToolbarBefore.identity !== docsToolbarIdentity) {
		throw new Error(`Selected docs toolbar identity was not established before drag: ${JSON.stringify(docsToolbarBefore)}`);
	}
	await assertAdjacentChromeMotionContract(page, docsToolbar, 'for generic selected-card actions');
	await docsNode.locator(':scope > .basehalf-canvas-node-resizer-handle.bottom.right').waitFor({ state: 'visible', timeout: 10_000 });
	const activeBeforeDrag = await captureCanvasCardComputedChrome(docs);
	assertCanvasCardResizeChromeIsNeutral(activeBeforeDrag, 'selected docs card before drag');
	assertCanvasCardHasRoundedCornerResizeTargets(activeBeforeDrag, 'selected docs card before drag');
	if (!activeBeforeDrag.cardSelected
		|| !activeBeforeDrag.nodeSelected
		|| activeBeforeDrag.visibleResizeHandles !== 4
		|| activeBeforeDrag.interactiveResizeHandles !== 4) {
		throw new Error(`Selected docs card did not expose four corner resize hit targets before drag: ${JSON.stringify(activeBeforeDrag)}`);
	}
	const canvasBefore = fs.readFileSync(canvasPath, 'utf8');
	// The docs → note connection made by the connect step.
	const connectedEdgeId = `docs${String.fromCharCode(0)}${AGENT_CREATED_CARD_PATH}`;
	const before = await page.evaluate(edgeId => {
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
		const node = card?.closest('.react-flow__node');
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		if (!(card instanceof HTMLElement) || !(node instanceof HTMLElement) || !(edge instanceof SVGPathElement)) {
			return undefined;
		}
		const rect = card.getBoundingClientRect();
		return {
			startX: rect.left + rect.width / 2,
			startY: rect.top + rect.height / 2,
			edgePath: edge.getAttribute('d'),
			nodeTransform: getComputedStyle(node).transform
		};
	}, connectedEdgeId);
	if (!before?.edgePath) {
		throw new Error('Missing docs→note live edge geometry');
	}
	await page.evaluate(() => {
		const cards = document.querySelector('.basehalf-canvas-cards');
		if (!(cards instanceof HTMLElement)) {
			throw new Error('Missing canvas cards host before drag preview stability check');
		}
		cards.dataset.smokeLoadingPreviewObserved = String(cards.textContent?.includes('Loading preview…') === true);
		cards.dataset.smokeCardElementReplaced = 'false';
		cards.dataset.smokeReplacedCardPaths = '';
		const originalCards = new Map(Array.from(cards.querySelectorAll('.basehalf-canvas-card')).flatMap(card => {
			const path = card instanceof HTMLElement ? card.dataset.basehalfCardPath : undefined;
			return path ? [[path, card] as const] : [];
		}));
		const observer = new MutationObserver(() => {
			if (cards.textContent?.includes('Loading preview…')) {
				cards.dataset.smokeLoadingPreviewObserved = 'true';
			}
			for (const [path, original] of originalCards) {
				if (cards.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"]`) !== original) {
					cards.dataset.smokeCardElementReplaced = 'true';
					const replaced = new Set(cards.dataset.smokeReplacedCardPaths?.split('\n').filter(Boolean));
					replaced.add(path);
					cards.dataset.smokeReplacedCardPaths = [...replaced].join('\n');
				}
			}
		});
		observer.observe(cards, { childList: true, characterData: true, subtree: true });
	});

	await page.mouse.move(before.startX, before.startY);
	await page.mouse.down();
	await page.mouse.move(before.startX + 64, before.startY + 37, { steps: 10 });
	await page.waitForFunction(({ edgeId, edgePath, nodeTransform }) => {
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
		const node = card?.closest('.react-flow__node');
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		return node instanceof HTMLElement
			&& edge instanceof SVGPathElement
			&& getComputedStyle(node).transform !== nodeTransform
			&& edge.getAttribute('d') !== edgePath;
	}, { edgeId: connectedEdgeId, edgePath: before.edgePath, nodeTransform: before.nodeTransform }, { timeout: 10_000 });

	const endpointDistance = await page.evaluate(edgeId => {
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
		const node = card?.closest('.react-flow__node');
		const handle = node?.querySelector(':scope > .basehalf-canvas-card-connect-handle.east');
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		if (!(handle instanceof HTMLElement) || !(edge instanceof SVGPathElement)) {
			return Number.POSITIVE_INFINITY;
		}
		const point = edge.getPointAtLength(0);
		const ctm = edge.getScreenCTM();
		if (!ctm) {
			return Number.POSITIVE_INFINITY;
		}
		const screen = new DOMPoint(point.x, point.y).matrixTransform(ctm);
		const handleRect = handle.getBoundingClientRect();
		return Math.hypot(screen.x - (handleRect.left + handleRect.width / 2), screen.y - (handleRect.top + handleRect.height / 2));
	}, connectedEdgeId);
	if (endpointDistance > 3) {
		throw new Error(`Live edge endpoint drifted ${endpointDistance}px from the dragged card handle`);
	}
	if (fs.readFileSync(canvasPath, 'utf8') !== canvasBefore) {
		throw new Error('Canvas geometry persisted before the drag gesture completed');
	}
	// Let the selection transition that starts on pointer-down finish. The
	// release regression is a different transition: the old drag-only shadow
	// changed its target abruptly when React Flow removed `.dragging`.
	await page.waitForTimeout(180);
	await waitForAdjacentChromeAnimations(page);
	const dragChrome = await captureCanvasCardComputedChrome(docs);
	const dragToolbarChrome = await captureAdjacentChromeSurface(docsToolbar);
	assertCanvasCardResizeChromeIsNeutral(dragChrome, 'active docs card drag');
	assertCanvasCardPaintEqual(activeBeforeDrag.cardPaint, dragChrome.cardPaint, 'selected-to-drag transition');
	assertAdjacentChromeSurfaceState(dragToolbarChrome, 'suppressed', 'for the selected docs card during pointer-held drag');
	const dragPhase = await page.locator('.basehalf-canvas-cards').getAttribute('data-node-drag-chrome');
	if (!dragChrome.nodeDragging
		|| dragToolbarChrome.identity !== docsToolbarIdentity
		|| dragPhase !== 'dragging') {
		throw new Error(`Selected docs drag did not suppress the same generic toolbar: ${JSON.stringify({ dragChrome, dragToolbarChrome, dragPhase })}`);
	}

	await page.mouse.up();
	await waitUntil(() => fs.readFileSync(canvasPath, 'utf8') !== canvasBefore, 'dragged docs geometry to persist after pointer-up');
	await page.waitForTimeout(350);
	await waitForAdjacentChromeAnimations(page);
	const settledDragChrome = await captureCanvasCardComputedChrome(docs);
	const settledToolbarChrome = await captureAdjacentChromeSurface(docsToolbar);
	assertCanvasCardResizeChromeIsNeutral(settledDragChrome, 'selected docs card after drag');
	assertCanvasCardPaintEqual(activeBeforeDrag.cardPaint, settledDragChrome.cardPaint, 'drag pointer-up transition');
	assertAdjacentChromeSurfaceState(settledToolbarChrome, 'present', 'for the selected docs card after drag');
	const settledPhase = await page.locator('.basehalf-canvas-cards').getAttribute('data-node-drag-chrome');
	if (settledDragChrome.nodeDragging
		|| !settledDragChrome.cardSelected
		|| !settledDragChrome.nodeSelected
		|| settledToolbarChrome.identity !== docsToolbarIdentity
		|| settledPhase !== null) {
		throw new Error(`Docs card did not restore the same selected toolbar after drag: ${JSON.stringify({ settledDragChrome, settledToolbarChrome, settledPhase })}`);
	}
	if (await page.locator('.basehalf-canvas-cards').getAttribute('data-smoke-loading-preview-observed') === 'true') {
		throw new Error('Dragging a card replaced hydrated content with the Loading preview placeholder');
	}
	if (await page.locator('.basehalf-canvas-cards').getAttribute('data-smoke-card-element-replaced') === 'true') {
		const paths = await page.locator('.basehalf-canvas-cards').getAttribute('data-smoke-replaced-card-paths');
		throw new Error(`Dragging a card rebuilt card DOM instead of reconciling layout in place: ${paths}`);
	}

	const resizeBeforeBox = await docs.boundingBox();
	if (!resizeBeforeBox) {
		throw new Error('Could not measure the selected docs card before resize');
	}
	const resizeCanvasBefore = fs.readFileSync(canvasPath, 'utf8');
	const resizeBeforeChrome = await captureCanvasCardComputedChrome(docs);
	assertCanvasCardResizeChromeIsNeutral(resizeBeforeChrome, 'selected docs card before resize');
	assertCanvasCardPaintEqual(activeBeforeDrag.cardPaint, resizeBeforeChrome.cardPaint, 'drag-to-resize resting transition');
	const resizeStart = await canvasCardCornerBandPoint(docs, 'bottom-right');
	await page.mouse.move(1, 1);
	await waitForCanvasCardCornerIndicators(page, 'docs', [], 'with the pointer away from the selected docs card');
	await page.mouse.move(resizeStart.x, resizeStart.y);
	await waitForCanvasCardCornerIndicators(page, 'docs', ['bottom-right'], 'while hovering the docs card bottom-right band');
	await docs.evaluate(card => {
		const scope = window as typeof window & { __basehalfSmokeNoMoveResizeObserver?: MutationObserver };
		scope.__basehalfSmokeNoMoveResizeObserver?.disconnect();
		card.dataset.smokeNoMoveResizeObserved = String(card.dataset.cardResizing === 'true');
		const observer = new MutationObserver(records => {
			if (card.dataset.cardResizing === 'true' || records.some(record => record.oldValue === 'true')) {
				card.dataset.smokeNoMoveResizeObserved = 'true';
			}
		});
		observer.observe(card, { attributes: true, attributeFilter: ['data-card-resizing'], attributeOldValue: true });
		scope.__basehalfSmokeNoMoveResizeObserver = observer;
	});
	await page.mouse.move(resizeStart.x, resizeStart.y);
	await page.mouse.down();
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	const noMovePointerDownState = await docs.evaluate(card => ({
		cardResizing: card.dataset.cardResizing === 'true',
		observedResizeSession: card.dataset.smokeNoMoveResizeObserved === 'true'
	}));
	await page.mouse.up();
	await page.mouse.move(1, 1);
	await page.waitForTimeout(150);
	const noMoveFinalState = await docs.evaluate(card => {
		const scope = window as typeof window & { __basehalfSmokeNoMoveResizeObserver?: MutationObserver };
		const state = {
			cardResizing: card.dataset.cardResizing === 'true',
			observedResizeSession: card.dataset.smokeNoMoveResizeObserved === 'true'
		};
		scope.__basehalfSmokeNoMoveResizeObserver?.disconnect();
		delete scope.__basehalfSmokeNoMoveResizeObserver;
		delete card.dataset.smokeNoMoveResizeObserved;
		return state;
	});
	const noMoveAfterChrome = await captureCanvasCardComputedChrome(docs);
	assertCanvasCardResizeChromeIsNeutral(noMoveAfterChrome, 'selected docs card after resize-handle click');
	assertCanvasCardPaintEqual(resizeBeforeChrome.cardPaint, noMoveAfterChrome.cardPaint, 'resize-handle click transition');
	const lingeringConnectionHandles = noMoveAfterChrome.connectionHandles.filter(handle => /(?:^|\s)(?:connectingfrom|connectingto|clickconnecting|connection-target)(?:\s|$)/.test(handle.className ?? ''));
	if (noMovePointerDownState.cardResizing
		|| noMovePointerDownState.observedResizeSession
		|| noMoveFinalState.cardResizing
		|| noMoveFinalState.observedResizeSession
		|| noMoveAfterChrome.cardResizing
		|| noMoveAfterChrome.nodeResizing
		|| noMoveAfterChrome.liveConnectionHandles !== 0
		|| lingeringConnectionHandles.length !== 0) {
		throw new Error(`A no-move resize-handle click left active resize or connection chrome: ${JSON.stringify({ noMovePointerDownState, noMoveFinalState, lingeringConnectionHandles, noMoveAfterChrome })}`);
	}
	if (fs.readFileSync(canvasPath, 'utf8') !== resizeCanvasBefore) {
		throw new Error('A no-move resize-handle click changed Canvas geometry on disk');
	}
	await page.mouse.move(resizeStart.x, resizeStart.y);
	await page.mouse.down();
	await page.mouse.move(resizeStart.x + 48, resizeStart.y + 36, { steps: 10 });
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="docs"]')?.getAttribute('data-card-resizing') === 'true', null, { timeout: 10_000 });
	await waitForCanvasCardCornerIndicators(page, 'docs', ['bottom-right'], 'while resizing the docs card from its bottom-right band');
	const resizeDuringChrome = await captureCanvasCardComputedChrome(docs);
	assertCanvasCardResizeChromeIsNeutral(resizeDuringChrome, 'active docs card resize');
	assertCanvasCardPaintEqual(resizeBeforeChrome.cardPaint, resizeDuringChrome.cardPaint, 'resize pointer-down transition');
	if (!resizeDuringChrome.nodeResizing) {
		throw new Error(`Missing actively resized docs card before pointer-up chrome check: ${JSON.stringify(resizeDuringChrome)}`);
	}
	const resizeDuringBox = await docs.boundingBox();
	if (!resizeDuringBox
		|| resizeDuringBox.width < resizeBeforeBox.width + 24
		|| resizeDuringBox.height < resizeBeforeBox.height + 18) {
		throw new Error(`Dragging the resize handle did not change card dimensions live: ${JSON.stringify({ resizeBeforeBox, resizeDuringBox })}`);
	}
	if (fs.readFileSync(canvasPath, 'utf8') !== resizeCanvasBefore) {
		throw new Error('Canvas geometry persisted before the resize gesture completed');
	}
	await page.mouse.up();
	await waitUntil(() => fs.readFileSync(canvasPath, 'utf8') !== resizeCanvasBefore, 'resized docs geometry to persist after pointer-up');
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="docs"]')?.getAttribute('data-card-resizing') !== 'true', null, { timeout: 10_000 });
	await page.waitForTimeout(350);
	const resizeAfterChrome = await captureCanvasCardComputedChrome(docs);
	assertCanvasCardResizeChromeIsNeutral(resizeAfterChrome, 'selected docs card after resize hover');
	assertCanvasCardPaintEqual(resizeBeforeChrome.cardPaint, resizeAfterChrome.cardPaint, 'resize pointer-up transition');
	const resizeAfterBox = await docs.boundingBox();
	if (!resizeAfterBox
		|| resizeAfterBox.width < resizeBeforeBox.width + 24
		|| resizeAfterBox.height < resizeBeforeBox.height + 18) {
		throw new Error(`Resized docs card did not retain its new dimensions: ${JSON.stringify({ resizeBeforeBox, resizeAfterBox })}`);
	}
	await page.mouse.move(1, 1);
	await waitForCanvasCardCornerIndicators(page, 'docs', [], 'after the docs card resize settled and the pointer left its band');

	const restoreCanvasBefore = fs.readFileSync(canvasPath, 'utf8');
	const restoreStart = await canvasCardCornerBandPoint(docs, 'bottom-right');
	const restoreTarget = {
		x: restoreStart.x + resizeBeforeBox.width - resizeAfterBox.width,
		y: restoreStart.y + resizeBeforeBox.height - resizeAfterBox.height
	};
	// A selected card usually holds keyboard focus. The press moves focus off
	// it, and that element blur must not settle the resize session.
	const docsFocused = await docs.evaluate(card => {
		card.focus({ preventScroll: true });
		return card.ownerDocument.activeElement === card;
	});
	if (!docsFocused) {
		throw new Error('Could not focus the docs card before its fixture-size restore');
	}
	await page.mouse.move(restoreStart.x, restoreStart.y);
	await page.mouse.down();
	await page.mouse.move(restoreTarget.x, restoreTarget.y, { steps: 10 });
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="docs"]')?.getAttribute('data-card-resizing') === 'true', null, { timeout: 10_000 });
	const restoreDuringChrome = await captureCanvasCardComputedChrome(docs);
	assertCanvasCardResizeChromeIsNeutral(restoreDuringChrome, 'active docs card fixture-size restore');
	assertCanvasCardPaintEqual(resizeBeforeChrome.cardPaint, restoreDuringChrome.cardPaint, 'fixture-size restore pointer-down transition');
	const restoreDuringBox = await docs.boundingBox();
	if (!restoreDuringBox
		|| Math.abs(restoreDuringBox.width - resizeBeforeBox.width) > 2
		|| Math.abs(restoreDuringBox.height - resizeBeforeBox.height) > 2) {
		throw new Error(`Reverse resize did not restore the docs card fixture size live: ${JSON.stringify({ resizeBeforeBox, restoreDuringBox })}`);
	}
	if (fs.readFileSync(canvasPath, 'utf8') !== restoreCanvasBefore) {
		throw new Error('Restored Canvas geometry persisted before the resize gesture completed');
	}
	// Past the minimum size the card stops following the pointer, so the pointer
	// leaves the corner band. The corner the gesture started from keeps its
	// indicator until the gesture settles. Returning restores the fixture size,
	// because the resizer measures from the gesture's start.
	const excursion = { x: restoreTarget.x - restoreDuringBox.width, y: restoreTarget.y - restoreDuringBox.height };
	await page.mouse.move(excursion.x, excursion.y, { steps: 8 });
	await page.waitForFunction(() => {
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
		return card instanceof HTMLElement && card.offsetWidth <= 141 && card.offsetHeight <= 49;
	}, null, { timeout: 10_000 });
	const excursionInBand = await docs.evaluate((element, pointer) => {
		const rect = element.getBoundingClientRect();
		const zoom = element.offsetWidth > 0 ? rect.width / element.offsetWidth : 1;
		const radius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) * zoom;
		const centerX = rect.right - radius;
		const centerY = rect.bottom - radius;
		return pointer.x >= centerX && pointer.y >= centerY && Math.hypot(pointer.x - centerX, pointer.y - centerY) <= radius + 12;
	}, excursion);
	if (excursionInBand) {
		throw new Error(`The minimum-size excursion left the pointer on the bottom-right band: ${JSON.stringify(excursion)}`);
	}
	await waitForCanvasCardCornerIndicators(page, 'docs', ['bottom-right'], 'after the pointer left the band mid-resize');
	await page.mouse.move(restoreTarget.x, restoreTarget.y, { steps: 8 });
	await page.waitForFunction(({ width, height }) => {
		const rect = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="docs"]')?.getBoundingClientRect();
		return !!rect && Math.abs(rect.width - width) <= 2 && Math.abs(rect.height - height) <= 2;
	}, { width: resizeBeforeBox.width, height: resizeBeforeBox.height }, { timeout: 10_000 });
	await page.mouse.up();
	await waitUntil(() => fs.readFileSync(canvasPath, 'utf8') !== restoreCanvasBefore, 'restored docs geometry to persist after pointer-up');
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="docs"]')?.getAttribute('data-card-resizing') !== 'true', null, { timeout: 10_000 });
	await page.waitForTimeout(350);
	const restoreAfterChrome = await captureCanvasCardComputedChrome(docs);
	assertCanvasCardResizeChromeIsNeutral(restoreAfterChrome, 'selected docs card after fixture-size restore hover');
	assertCanvasCardPaintEqual(resizeBeforeChrome.cardPaint, restoreAfterChrome.cardPaint, 'fixture-size restore pointer-up transition');
	const restoredBox = await docs.boundingBox();
	if (!restoredBox
		|| Math.abs(restoredBox.width - resizeBeforeBox.width) > 2
		|| Math.abs(restoredBox.height - resizeBeforeBox.height) > 2) {
		throw new Error(`Docs card did not retain its restored fixture size: ${JSON.stringify({ resizeBeforeBox, restoredBox })}`);
	}
}

// A reference line is itself the reconnect affordance: its first directed
// half owns the source endpoint and its second half owns the target endpoint.
// Each preview must keep the opposite endpoint pinned. The target reconnect is
// then committed through the real semantic graph and canvas style mirrors.
// Both ends of a connection reconnect by dragging one half of its edge. The
// source end replaces the entry in the note's `upstream` list in place; the
// target end moves the entry to another card's store, here the src folder's
// .bh/mirror/src/upstream.yaml. Escape, a blank release, and a release on the
// excluded opposite card cancel without writing.
async function assertCanvasEdgeHalfReconnect(page) {
	const note = AGENT_CREATED_CARD_PATH;
	const connected = agentNoteWithUpstream(['docs']);
	const connectedEdgeId = `docs${String.fromCharCode(0)}${note}`;
	const docs = page.locator('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
	const src = page.locator('.basehalf-canvas-card[data-basehalf-card-path="src"]');
	const readme = page.locator('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
	const noteCard = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${note}"]`);
	await frameCanvasCardsForConnection(page, [docs, src, readme, noteCard]);
	if (readWorkspaceFile(note) !== connected) {
		throw new Error(`${note} must hold the docs connection before reconnecting`);
	}
	const handle = (card, side) => page.locator('.react-flow__node', { has: card }).locator(`:scope > .basehalf-canvas-card-connect-handle.${side}`);
	const srcUpstreamPath = path.join(workspacePath, '.bh', 'mirror', 'src', 'upstream.yaml');

	const canvasPath = path.join(workspacePath, '.bh', 'mirror', 'canvas.yaml');
	const canvasBeforeEscape = fs.readFileSync(canvasPath, 'utf8');
	const beforeSource = await canvasEdgeGestureGeometry(page, 'docs', note);
	const sourceBlank = await canvasReconnectBlankPoint(page, beforeSource.firstHalf);
	await page.mouse.move(beforeSource.firstHalf.x, beforeSource.firstHalf.y);
	await page.mouse.down();
	await page.mouse.move(sourceBlank.x, sourceBlank.y, { steps: 8 });
	await page.waitForFunction(edgeId => {
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		return edge instanceof SVGPathElement && edge.dataset.reconnectEnd === 'source';
	}, connectedEdgeId, { timeout: 10_000 });
	const sourcePreview = await canvasEdgeGestureGeometry(page, 'docs', note, { exposed: false });
	if (pointDistance(sourcePreview.source, beforeSource.source) < 8) {
		throw new Error('First-half drag did not move the source endpoint preview');
	}
	if (pointDistance(sourcePreview.target, beforeSource.target) > 3) {
		throw new Error('First-half drag moved the opposite target endpoint');
	}
	const stableGrabbingCursor = await page.evaluate(() => document.body.classList.contains('basehalf-canvas-edge-reconnecting'));
	if (!stableGrabbingCursor) {
		throw new Error('Edge reconnect lost its document-level grabbing cursor');
	}

	// Escape is a pure cancellation: the gesture lock and preview disappear,
	// and the subsequent physical pointer-up has no semantic effect.
	await page.keyboard.press('Escape');
	await page.mouse.up();
	await assertCanvasEdgeVisible(page, 'docs', note);
	await page.waitForFunction(edgeId => {
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		return edge instanceof SVGPathElement && edge.dataset.reconnectEnd === undefined;
	}, connectedEdgeId, { timeout: 10_000 });
	if (fs.readFileSync(canvasPath, 'utf8') !== canvasBeforeEscape || readWorkspaceFile(note) !== connected) {
		throw new Error('Escape committed an edge reconnect instead of cancelling it');
	}

	// A no-drag click selects only. Reference edges have no relationship-label
	// DOM at all, and their sole keyboard/screen-reader affordance is React
	// Flow's focusable edge wrapper.
	const clickGeometry = await canvasEdgeGestureGeometry(page, 'docs', note);
	await page.mouse.click(clickGeometry.firstHalf.x, clickGeometry.firstHalf.y);
	await page.waitForFunction(edgeId => Array.from(document.querySelectorAll('.basehalf-canvas-edge-hit.selected'))
		.some(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId), connectedEdgeId, { timeout: 10_000 });
	if (await visibleQuickInput(page).isVisible().catch(() => false)) {
		throw new Error('A single reference-edge click opened Quick Input');
	}
	const edgeAccessibility = await page.evaluate(edgeId => {
		const hit = Array.from(document.querySelectorAll('.basehalf-canvas-edge-hit'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		const wrapper = hit?.closest('.react-flow__edge');
		return wrapper instanceof SVGElement ? {
			labelElementCount: document.querySelectorAll('.basehalf-canvas-flow-edge-label').length,
			tabIndex: wrapper.tabIndex,
			role: wrapper.getAttribute('role'),
			roleDescription: wrapper.getAttribute('aria-roledescription'),
			ariaLabel: wrapper.getAttribute('aria-label')
		} : undefined;
	}, connectedEdgeId);
	if (!edgeAccessibility || edgeAccessibility.labelElementCount !== 0) {
		throw new Error('A reference edge rendered a relationship-label element');
	}
	if (edgeAccessibility.tabIndex !== 0 || edgeAccessibility.role !== 'group' || edgeAccessibility.roleDescription !== 'edge') {
		throw new Error('The reference edge wrapper is not the sole keyboard-accessible edge target');
	}
	if (!edgeAccessibility.ariaLabel
		|| !/^Context flows from /i.test(edgeAccessibility.ariaLabel)
		|| !edgeAccessibility.ariaLabel.includes('docs')
		|| !edgeAccessibility.ariaLabel.includes(note)
		|| /label|note|why/i.test(edgeAccessibility.ariaLabel)) {
		throw new Error(`Reference edge has the wrong accessible name: ${edgeAccessibility.ariaLabel ?? '<missing>'}`);
	}

	// Double-click is deliberately inert after the clean break: it must neither
	// revive Reference note Quick Input nor mutate the endpoint-and-anchor canvas row.
	const canvasBeforeDoubleClick = fs.readFileSync(canvasPath, 'utf8');
	await page.mouse.dblclick(clickGeometry.firstHalf.x, clickGeometry.firstHalf.y, { delay: 40 });
	await page.waitForTimeout(250);
	if (await visibleQuickInput(page).isVisible().catch(() => false)) {
		throw new Error('Double-clicking a reference edge opened Quick Input');
	}
	if (fs.readFileSync(canvasPath, 'utf8') !== canvasBeforeDoubleClick) {
		throw new Error('Double-clicking a reference edge changed canvas.yaml');
	}

	// The wrapper supports the stock React Flow keyboard selection contract.
	// First clear the mouse selection with Escape, then select it with Enter;
	// neither action has a label-editing side effect.
	await page.evaluate(edgeId => {
		const hit = Array.from(document.querySelectorAll('.basehalf-canvas-edge-hit'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		const wrapper = hit?.closest('.react-flow__edge');
		if (!(wrapper instanceof SVGElement) || wrapper.tabIndex !== 0) {
			throw new Error('Missing keyboard-focusable reference edge wrapper');
		}
		wrapper.focus();
	}, connectedEdgeId);
	await page.keyboard.press('Escape');
	await page.waitForFunction(edgeId => {
		const hit = Array.from(document.querySelectorAll('.basehalf-canvas-edge-hit'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		return hit?.closest('.react-flow__edge')?.classList.contains('selected') === false;
	}, connectedEdgeId, { timeout: 10_000 });
	await page.evaluate(edgeId => {
		const hit = Array.from(document.querySelectorAll('.basehalf-canvas-edge-hit'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		const wrapper = hit?.closest('.react-flow__edge');
		if (!(wrapper instanceof SVGElement)) {
			throw new Error('Missing reference edge wrapper for keyboard selection');
		}
		wrapper.focus();
	}, connectedEdgeId);
	await page.keyboard.press('Enter');
	await page.waitForFunction(edgeId => {
		const hit = Array.from(document.querySelectorAll('.basehalf-canvas-edge-hit'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		const wrapper = hit?.closest('.react-flow__edge');
		return wrapper instanceof SVGElement
			&& document.activeElement === wrapper
			&& wrapper.classList.contains('selected');
	}, connectedEdgeId, { timeout: 10_000 });
	if (await visibleQuickInput(page).isVisible().catch(() => false)) {
		throw new Error('Keyboard-selecting a reference edge opened Quick Input');
	}
	if (fs.readFileSync(canvasPath, 'utf8') !== canvasBeforeDoubleClick) {
		throw new Error('Keyboard-selecting a reference edge changed canvas.yaml');
	}

	// Releasing the source endpoint on its excluded opposite card is invalid,
	// not blank. It cancels and preserves the semantic edge.
	const invalidGeometry = await canvasEdgeGestureGeometry(page, 'docs', note);
	const oppositeBounds = await noteCard.boundingBox();
	if (!oppositeBounds) {
		throw new Error('Missing note card bounds for invalid reconnect smoke');
	}
	const canvasBeforeInvalidCard = fs.readFileSync(canvasPath, 'utf8');
	await page.mouse.move(invalidGeometry.firstHalf.x, invalidGeometry.firstHalf.y);
	await page.mouse.down();
	await page.mouse.move(oppositeBounds.x + oppositeBounds.width / 2, oppositeBounds.y + oppositeBounds.height / 2, { steps: 8 });
	await page.waitForFunction(edgeId => {
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		return edge instanceof SVGPathElement && edge.dataset.reconnectEnd === 'source';
	}, connectedEdgeId, { timeout: 10_000 });
	await page.mouse.up();
	await assertCanvasEdgeVisible(page, 'docs', note);
	await page.waitForFunction(edgeId => {
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		return edge instanceof SVGPathElement && edge.dataset.reconnectEnd === undefined;
	}, connectedEdgeId, { timeout: 10_000 });
	if (fs.readFileSync(canvasPath, 'utf8') !== canvasBeforeInvalidCard || readWorkspaceFile(note) !== connected) {
		throw new Error('Releasing on the excluded opposite card deleted or reconnected the edge');
	}

	// Source end: dropping it on README replaces the note's entry in place. Only
	// the note is written; README keeps its bytes.
	const readmeBefore = readWorkspaceFile('README.md');
	const sourceReconnectTarget = await handle(readme, 'east').boundingBox();
	if (!sourceReconnectTarget) {
		throw new Error('Missing README east handle for the source-end reconnect');
	}
	const beforeSourceReconnect = await canvasEdgeGestureGeometry(page, 'docs', note);
	await page.mouse.move(beforeSourceReconnect.firstHalf.x, beforeSourceReconnect.firstHalf.y);
	await page.mouse.down();
	await page.mouse.move(sourceReconnectTarget.x + sourceReconnectTarget.width / 2, sourceReconnectTarget.y + sourceReconnectTarget.height / 2, { steps: 8 });
	await page.waitForFunction(edgeId => {
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		return edge instanceof SVGPathElement && edge.dataset.reconnectEnd === 'source';
	}, connectedEdgeId, { timeout: 10_000 });
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]')?.classList.contains('connection-target') === true, null, { timeout: 10_000 });
	await page.mouse.up();
	await waitUntil(() => readWorkspaceFile(note) === agentNoteWithUpstream(['README.md']), 'the source-end reconnect to replace the note\'s upstream entry in place');
	await assertCanvasEdgeGone(page, 'docs', note);
	await assertCanvasEdgeVisible(page, 'README.md', note);
	if (readWorkspaceFile('README.md') !== readmeBefore) {
		throw new Error('A source-end reconnect changed the new upstream card instead of only the note');
	}

	// Restore the docs source with the same real first-half gesture.
	const restoreSourceTarget = await handle(docs, 'east').boundingBox();
	if (!restoreSourceTarget) {
		throw new Error('Missing docs east handle while restoring the source-end reconnect');
	}
	const beforeSourceRestore = await canvasEdgeGestureGeometry(page, 'README.md', note);
	await page.mouse.move(beforeSourceRestore.firstHalf.x, beforeSourceRestore.firstHalf.y);
	await page.mouse.down();
	await page.mouse.move(restoreSourceTarget.x + restoreSourceTarget.width / 2, restoreSourceTarget.y + restoreSourceTarget.height / 2, { steps: 8 });
	await page.waitForFunction(edgeId => {
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		return edge instanceof SVGPathElement && edge.dataset.reconnectEnd === 'source';
	}, `README.md${String.fromCharCode(0)}${note}`, { timeout: 10_000 });
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="docs"]')?.classList.contains('connection-target') === true, null, { timeout: 10_000 });
	await page.mouse.up();
	await waitUntil(() => readWorkspaceFile(note) === connected, 'the restored source-end reconnect to name docs again');
	await assertCanvasEdgeGone(page, 'README.md', note);
	await assertCanvasEdgeVisible(page, 'docs', note);

	// Target end: the preview moves only the target endpoint, and dropping it on
	// the src folder moves the entry into src's sidecar store.
	const reconnectTarget = await handle(src, 'west').boundingBox();
	if (!reconnectTarget) {
		throw new Error('Missing src west handle for the target-end reconnect');
	}
	const beforeTarget = await canvasEdgeGestureGeometry(page, 'docs', note);
	const targetBlank = await canvasReconnectBlankPoint(page, beforeTarget.secondHalf);
	await page.mouse.move(beforeTarget.secondHalf.x, beforeTarget.secondHalf.y);
	await page.mouse.down();
	await page.mouse.move(targetBlank.x, targetBlank.y, { steps: 8 });
	await page.waitForFunction(edgeId => {
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		return edge instanceof SVGPathElement && edge.dataset.reconnectEnd === 'target';
	}, connectedEdgeId, { timeout: 10_000 });
	const targetPreview = await canvasEdgeGestureGeometry(page, 'docs', note, { exposed: false });
	if (pointDistance(targetPreview.source, beforeTarget.source) > 3) {
		throw new Error('Second-half drag moved the opposite source endpoint');
	}
	if (pointDistance(targetPreview.target, beforeTarget.target) < 8) {
		throw new Error('Second-half drag did not move the target endpoint preview');
	}
	if (sourcePreview.path === targetPreview.path) {
		throw new Error('The two directed edge halves produced indistinguishable previews');
	}

	await page.mouse.move(reconnectTarget.x + reconnectTarget.width / 2, reconnectTarget.y + reconnectTarget.height / 2, { steps: 8 });
	await page.waitForFunction(() => {
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="src"]');
		const node = card?.closest('.react-flow__node');
		return card?.classList.contains('connection-target')
			&& card.classList.contains('west')
			&& node?.querySelector(':scope > .basehalf-canvas-card-connect-handle.west')?.classList.contains('connection-target');
	}, null, { timeout: 10_000 });
	await page.mouse.up();
	await assertCanvasEdgeGone(page, 'docs', note);
	await assertCanvasEdgeVisible(page, 'docs', 'src');
	await waitUntil(() => {
		const canvas = fs.readFileSync(canvasPath, 'utf8');
		return canvas.includes('from: "docs"')
			&& canvas.includes('to: "src"')
			&& canvas.includes('to_anchor: west');
	}, 'target-half reconnect anchors to persist in canvas.yaml');
	await waitUntil(() => fs.existsSync(srcUpstreamPath) && fs.readFileSync(srcUpstreamPath, 'utf8') === 'upstream:\n  - docs\n', 'the target-end reconnect to add docs to the src folder\'s upstream.yaml');
	await waitUntil(() => readWorkspaceFile(note) === AGENT_CREATED_CARD_CONTENT, 'the target-end reconnect to remove the entry, and its emptied frontmatter, from the note');

	// Restore the note as the target with the same real second-half gesture.
	const restoreTarget = await handle(noteCard, 'west').boundingBox();
	if (!restoreTarget) {
		throw new Error('Missing note west handle while restoring the reconnect fixture');
	}
	const beforeRestore = await canvasEdgeGestureGeometry(page, 'docs', 'src');
	await page.mouse.move(beforeRestore.secondHalf.x, beforeRestore.secondHalf.y);
	await page.mouse.down();
	await page.mouse.move(restoreTarget.x + restoreTarget.width / 2, restoreTarget.y + restoreTarget.height / 2, { steps: 8 });
	await page.waitForFunction(edgeId => {
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		return edge instanceof SVGPathElement && edge.dataset.reconnectEnd === 'target';
	}, `docs${String.fromCharCode(0)}src`, { timeout: 10_000 });
	await page.mouse.up();
	await assertCanvasEdgeGone(page, 'docs', 'src');
	await assertCanvasEdgeVisible(page, 'docs', note);
	await waitUntil(() => readWorkspaceFile(note) === connected, 'the restored target-end reconnect to write the note\'s upstream list again');
	await waitUntil(() => !fs.existsSync(srcUpstreamPath), 'the emptied src upstream.yaml to be removed');
}

// The screen geometry of the `from`→`to` edge. `firstHalf` and `secondHalf`
// are where a gesture grabs the source or the target end. Edges render beneath
// cards, so an edge between two cards that are not neighbours can pass under a
// third card; each half point is therefore the exposed point of that half
// nearest its quarter mark, where the edge's own hit path is the topmost
// element. Pass `exposed: false` to read only the path and its endpoints, for
// example during a drag preview.
async function canvasEdgeGestureGeometry(page, from, to, { exposed = true } = {}) {
	const geometry = await page.evaluate(([source, target]) => {
		const edgeId = `${source}${String.fromCharCode(0)}${target}`;
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		const hit = Array.from(document.querySelectorAll('.basehalf-canvas-edge-hit'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		if (!(edge instanceof SVGPathElement)) {
			return undefined;
		}
		const ctm = edge.getScreenCTM();
		const total = edge.getTotalLength();
		if (!ctm || total <= 0) {
			return undefined;
		}
		const screenPoint = ratio => {
			const point = edge.getPointAtLength(total * ratio);
			const screen = new DOMPoint(point.x, point.y).matrixTransform(ctm);
			return { x: screen.x, y: screen.y };
		};
		const exposedPoint = (preferred, low, high) => {
			for (let offset = 0; offset <= 0.25; offset += 0.01) {
				for (const ratio of offset === 0 ? [preferred] : [preferred - offset, preferred + offset]) {
					if (ratio < low || ratio > high) {
						continue;
					}
					const point = screenPoint(ratio);
					if (hit && document.elementFromPoint(point.x, point.y) === hit) {
						return point;
					}
				}
			}
			return undefined;
		};
		return {
			path: edge.getAttribute('d'),
			source: screenPoint(0),
			target: screenPoint(1),
			firstHalf: screenPoint(0.25),
			secondHalf: screenPoint(0.75),
			exposedFirstHalf: exposedPoint(0.25, 0.02, 0.45),
			exposedSecondHalf: exposedPoint(0.75, 0.55, 0.98)
		};
	}, [from, to]);
	if (!geometry?.path) {
		throw new Error(`Could not inspect ${from}→${to} edge geometry`);
	}
	const { exposedFirstHalf, exposedSecondHalf, ...result } = geometry;
	if (!exposed) {
		return result;
	}
	if (!exposedFirstHalf || !exposedSecondHalf) {
		throw new Error(`Cards cover the ${exposedFirstHalf ? 'target' : 'source'} half of the ${from}→${to} edge, so no gesture can grab it`);
	}
	return { ...result, firstHalf: exposedFirstHalf, secondHalf: exposedSecondHalf };
}

async function canvasReconnectBlankPoint(page, origin) {
	return page.evaluate(point => {
		const canvas = document.querySelector('.basehalf-canvas-cards')?.getBoundingClientRect();
		if (!canvas) {
			throw new Error('Missing canvas bounds for reconnect preview');
		}
		const cards = Array.from(document.querySelectorAll('.react-flow__node')).map(node => node.getBoundingClientRect());
		const candidates = [];
		for (const xRatio of [0.08, 0.25, 0.5, 0.75, 0.92]) {
			for (const yRatio of [0.08, 0.25, 0.5, 0.75, 0.92]) {
				candidates.push({ x: canvas.left + canvas.width * xRatio, y: canvas.top + canvas.height * yRatio });
			}
		}
		const distanceToRect = (candidate, rect) => Math.hypot(
			Math.max(rect.left - candidate.x, 0, candidate.x - rect.right),
			Math.max(rect.top - candidate.y, 0, candidate.y - rect.bottom)
		);
		return candidates.reduce((best, candidate) => {
			const cardDistance = cards.length > 0
				? Math.min(...cards.map(rect => distanceToRect(candidate, rect)))
				: Number.POSITIVE_INFINITY;
			const originDistance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
			const score = Math.min(cardDistance, originDistance);
			return !best || score > best.score ? { ...candidate, score } : best;
		}, undefined);
	}, origin).then(({ x, y }) => ({ x, y }));
}

function pointDistance(a, b) {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

// An AGENT creates a user file with its own tools. BaseHalf observes the real
// file and projects it as a card without requiring a canvas.yaml geometry row.
async function assertAgentCreatesCard(page) {
	fs.writeFileSync(path.join(workspacePath, AGENT_CREATED_CARD_PATH), AGENT_CREATED_CARD_CONTENT, 'utf8');

	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${AGENT_CREATED_CARD_PATH}"]`)
		.waitFor({ state: 'visible', timeout: 10_000 });
}

// Clicks a card's badge toggle by script. A locator resolves its element in
// one step and runs the script in the next; a re-render in between leaves the
// script holding a card that is no longer in the document, where a click does
// nothing. So the card on screen is looked up and clicked in the same step.
async function clickCanvasBadgeToggle(card) {
	await card.locator('.basehalf-canvas-card-badge-toggle:visible').waitFor({ state: 'visible', timeout: 10_000 });
	await card.evaluate(element => {
		const path = element.getAttribute('data-basehalf-card-path') ?? '';
		const live = element.isConnected ? element : document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"]`);
		const toggle = Array.from(live?.querySelectorAll('.basehalf-canvas-card-badge-toggle') ?? []).find(button => button.getClientRects().length > 0);
		if (!(toggle instanceof HTMLElement)) {
			throw new Error(`No visible badge toggle on the card ${path}`);
		}
		toggle.click();
	});
}

// Opens the badge face of a canvas card and waits for its Upstream section.
async function openCanvasBadgeFace(card) {
	await clickCanvasBadgeToggle(card);
	await card.locator('[data-testid="badge-upstream"]').waitFor({ state: 'visible', timeout: 10_000 });
}

async function closeCanvasBadgeFace(card) {
	await clickCanvasBadgeToggle(card);
	await card.locator('[data-testid="badge-upstream"]').waitFor({ state: 'detached', timeout: 10_000 });
}

// The Upstream rows of a canvas card's badge face, in list order, as
// `status:path` (a valid row names its target, an issue row its entry text).
async function canvasBadgeUpstreamRows(card) {
	return card.locator('[data-testid="badge-upstream-row"]').evaluateAll(rows => rows.map(row => {
		const name = row.querySelector('.basehalf-canvas-card-badge-link, .basehalf-canvas-card-badge-entry-text')?.getAttribute('title');
		return `${row.getAttribute('data-upstream-status')}:${name}`;
	}));
}

// An AGENT edits the note's `upstream` list as ordinary text (D37). The index
// picks up the saved file: a new entry draws its edge, and an entry that names
// nothing is one dangling issue on the card and an inline row in its badge
// editor, where Remove repairs it by explicit action. An open Card Detail
// refreshes its collapsed summary in place, keeping keyboard focus.
async function assertAgentUpstreamEditDrawsEdge(page) {
	const note = AGENT_CREATED_CARD_PATH;
	const notePath = path.join(workspacePath, note);
	const noteCard = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${note}"]`);
	const readme = page.locator('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
	const docs = page.locator('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
	await frameCanvasCardsForConnection(page, [readme, docs, noteCard]);
	fs.writeFileSync(notePath, agentNoteWithUpstream(['docs', 'README.md', 'missing-source.md']), 'utf8');
	await assertCanvasEdgeVisible(page, 'README.md', note);
	await assertCanvasEdgeVisible(page, 'docs', note);
	const issueMarker = noteCard.locator('.basehalf-canvas-card-badge-dot.issue[data-testid="card-reference-issue-marker"]:visible');
	await issueMarker.waitFor({ state: 'visible', timeout: 10_000 });
	if (await issueMarker.getAttribute('data-reference-issue-count') !== '1') {
		throw new Error('The dangling upstream entry did not expose exactly one card-level issue');
	}

	await openCanvasBadgeFace(noteCard);
	await page.waitForFunction(path => {
		const rows = Array.from(document.querySelectorAll(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"] [data-testid="badge-upstream-row"]`));
		return rows.map(row => row.getAttribute('data-upstream-status')).join(',') === 'valid,valid,dangling';
	}, note, { timeout: 10_000 });
	const rows = await canvasBadgeUpstreamRows(noteCard);
	if (JSON.stringify(rows) !== JSON.stringify(['valid:docs', 'valid:README.md', 'dangling:missing-source.md'])) {
		throw new Error(`The badge editor did not list the note's own upstream entries in file order: ${JSON.stringify(rows)}`);
	}
	await noteCard.locator('[data-testid="badge-downstream-empty"]', { hasText: 'Nothing draws on this card yet.' }).waitFor({ state: 'visible', timeout: 10_000 });
	await noteCard.locator('[data-testid="badge-upstream-row"][data-upstream-status="dangling"] [data-testid="badge-upstream-remove"]').click();
	await waitUntil(() => readWorkspaceFile(note) === agentNoteWithUpstream(['docs', 'README.md']), 'Remove to delete only the dangling entry from the note');
	await issueMarker.waitFor({ state: 'detached', timeout: 10_000 });
	await closeCanvasBadgeFace(noteCard);

	// Both sides of a merge added the list: BaseHalf cannot read it. The badge
	// states that in plain words and offers Rebuild List, which keeps every
	// connection after the user confirms. Nothing sends the user to the file.
	fs.writeFileSync(notePath, `---\nupstream:\n  - docs\nupstream:\n  - README.md\n---\n${AGENT_CREATED_CARD_CONTENT}`, 'utf8');
	await issueMarker.waitFor({ state: 'visible', timeout: 10_000 });
	await openCanvasBadgeFace(noteCard);
	const storeIssue = noteCard.locator('[data-testid="badge-upstream"] .basehalf-canvas-card-badge-issue-row[data-upstream-issue="store"]');
	await storeIssue.waitFor({ state: 'visible', timeout: 10_000 });
	const storeIssueText = await storeIssue.locator('.basehalf-canvas-card-badge-issue-message').textContent();
	if (storeIssueText !== 'BaseHalf can\'t read this upstream list.') {
		throw new Error(`The unreadable upstream list is not stated in plain words: ${JSON.stringify(storeIssueText)}`);
	}
	const upstreamSectionText = await noteCard.locator('[data-testid="badge-upstream"]').textContent() ?? '';
	if (/Open File|frontmatter|YAML|`/.test(upstreamSectionText)) {
		throw new Error(`The Upstream section names code or offers to open the file: ${JSON.stringify(upstreamSectionText)}`);
	}
	await storeIssue.locator('[data-testid="badge-upstream-rebuild"]').click();
	const rebuildDialog = page.locator('.monaco-dialog-box', { hasText: 'Rebuild the upstream list of' }).first();
	await rebuildDialog.waitFor({ state: 'visible', timeout: 10_000 });
	await rebuildDialog.locator('.monaco-button', { hasText: /^Rebuild List$/ }).click();
	await rebuildDialog.waitFor({ state: 'hidden', timeout: 10_000 });
	await waitUntil(() => readWorkspaceFile(note) === agentNoteWithUpstream(['docs', 'README.md']), 'Rebuild List to write one list that keeps both connections');
	await issueMarker.waitFor({ state: 'detached', timeout: 10_000 });
	await closeCanvasBadgeFace(noteCard);
	await assertCanvasEdgeVisible(page, 'README.md', note);
	await assertCanvasEdgeVisible(page, 'docs', note);

	// The same edit reaches an open Card Detail through its live refresh: the
	// collapsed summary changes in place and focus stays on the toggle.
	await openExplorerRow(page, note);
	await assertCardDetail(page, note);
	const detailBadgeToggle = page.locator('[data-testid="card-detail-badge-toggle"]');
	await detailBadgeToggle.waitFor({ state: 'visible', timeout: 10_000 });
	const detailSummaryIs = expected => page.waitForFunction(text => {
		const toggle = document.querySelector('.basehalf-card-detail.visible [data-testid="card-detail-badge-toggle"]');
		return toggle?.getAttribute('aria-expanded') === 'false'
			&& toggle.querySelector('.basehalf-card-detail-badge-summary')?.textContent?.trim() === text
			&& toggle.getAttribute('data-reference-issue-count') === '0';
	}, expected, { timeout: 10_000 });
	await detailSummaryIs('↑2 upstream · ↓0 downstream');
	await detailBadgeToggle.focus();
	fs.writeFileSync(notePath, agentNoteWithUpstream(['docs']), 'utf8');
	await detailSummaryIs('↑1 upstream · ↓0 downstream');
	await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'card-detail-badge-toggle', null, { timeout: 10_000 });
	fs.writeFileSync(notePath, agentNoteWithUpstream(['docs', 'README.md']), 'utf8');
	await detailSummaryIs('↑2 upstream · ↓0 downstream');
	await closeCardDetailIfOpen(page);
	await assertCanvasEdgeVisible(page, 'README.md', note);
	await assertCanvasEdgeVisible(page, 'docs', note);
}

// The badge editor edits a card's own Upstream list and shows its derived
// Downstream list. Add Upstream picks from the whole workspace folder (here a
// file in another folder) and writes only the note; × removes the entry.
// Downstream × and Add Downstream write the other card's list exactly as a
// canvas disconnect or connect would.
async function assertBadgeEditorUpstreamDownstream(page) {
	const note = AGENT_CREATED_CARD_PATH;
	const noteCard = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${note}"]`);
	const readme = page.locator('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
	const docs = page.locator('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
	await frameCanvasCardsForConnection(page, [readme, docs, noteCard]);
	if (readWorkspaceFile(note) !== agentNoteWithUpstream(['docs', 'README.md'])) {
		throw new Error(`${note} must list docs and README.md before the badge editor checks`);
	}
	const readmeBefore = readWorkspaceFile('README.md');
	const pickFromQuickInput = async (title, query, rowText) => {
		const widget = page.locator('.quick-input-widget:visible');
		await widget.locator('.quick-input-title', { hasText: title }).waitFor({ state: 'visible', timeout: 10_000 });
		await visibleQuickInput(page).fill(query);
		const row = widget.locator('.quick-input-list .monaco-list-row[role="option"]', { hasText: rowText }).first();
		await row.waitFor({ state: 'visible', timeout: 15_000 });
		await row.click();
		await widget.waitFor({ state: 'hidden', timeout: 10_000 });
	};

	await openCanvasBadgeFace(noteCard);
	const helper = await noteCard.locator('[data-testid="badge-upstream"] .basehalf-canvas-card-badge-helper').textContent();
	if (!helper?.includes('Saved inside this file')) {
		throw new Error(`The note's Upstream helper does not name its own store: ${JSON.stringify(helper)}`);
	}
	await noteCard.locator('[data-testid="badge-add-upstream"]').click();
	await pickFromQuickInput(`Add upstream to ${note}`, 'app.ts', 'src/app.ts');
	await waitUntil(() => readWorkspaceFile(note) === agentNoteWithUpstream(['docs', 'README.md', 'src/app.ts']), 'Add Upstream to append the picked workspace file to the note');
	const appRow = noteCard.locator('[data-testid="badge-upstream-row"][data-upstream-status="valid"]', { hasText: 'app.ts' });
	await appRow.waitFor({ state: 'visible', timeout: 10_000 });
	const appRemove = appRow.locator('.basehalf-canvas-card-badge-remove');
	if (await appRemove.getAttribute('aria-label') !== 'Remove src/app.ts from upstream') {
		throw new Error(`The Upstream × has the wrong accessible name: ${await appRemove.getAttribute('aria-label')}`);
	}
	await appRemove.click();
	await waitUntil(() => readWorkspaceFile(note) === agentNoteWithUpstream(['docs', 'README.md']), 'Upstream × to remove only that entry from the note');
	await closeCanvasBadgeFace(noteCard);

	await openCanvasBadgeFace(readme);
	const readmeDownstream = readme.locator(`[data-testid="badge-downstream-row"][data-downstream-path="${note}"]`);
	await readmeDownstream.waitFor({ state: 'visible', timeout: 10_000 });
	const downstreamRemove = readmeDownstream.locator('.basehalf-canvas-card-badge-remove');
	if (await downstreamRemove.getAttribute('title') !== `Remove from the upstream of ${note}`) {
		throw new Error(`The Downstream × tooltip does not name the file it writes: ${await downstreamRemove.getAttribute('title')}`);
	}
	await downstreamRemove.click();
	await waitUntil(() => readWorkspaceFile(note) === agentNoteWithUpstream(['docs']), 'Downstream × to remove README.md from the note\'s upstream list');
	await assertCanvasEdgeGone(page, 'README.md', note);
	await readme.locator('[data-testid="badge-downstream-empty"]').waitFor({ state: 'visible', timeout: 10_000 });
	await readme.locator('[data-testid="badge-add-downstream"]').click();
	await pickFromQuickInput('Add downstream of README.md', 'agent-angle', note);
	await waitUntil(() => readWorkspaceFile(note) === agentNoteWithUpstream(['docs', 'README.md']), 'Add Downstream to add README.md to the note\'s upstream list');
	await readmeDownstream.waitFor({ state: 'visible', timeout: 10_000 });
	await assertCanvasEdgeVisible(page, 'README.md', note);
	await closeCanvasBadgeFace(readme);
	if (readWorkspaceFile('README.md') !== readmeBefore) {
		throw new Error('Downstream edits on README changed README itself instead of the downstream note');
	}
}

// A note that starts with a horizontal rule cannot take an upstream list in
// its own text. BaseHalf keeps the list for it instead of refusing: the note's
// bytes never change, the connection is drawn, and the badge says where the
// list is. Once the note can hold a list, the kept list stays in use and Move
// into File moves it into the note.
async function assertNoteThatCannotHoldAListKeepsItWithBaseHalf(page) {
	const note = 'rule-note.md';
	const notePath = path.join(workspacePath, note);
	const keptPath = path.join(workspacePath, '.bh', 'mirror', note, 'upstream.yaml');
	const original = '---\nA line between two rules.\n---\n\nBody\n';
	fs.writeFileSync(notePath, original, 'utf8');
	const noteCard = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${note}"]`);
	await noteCard.waitFor({ state: 'visible', timeout: 10_000 });
	const readme = page.locator('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
	await frameCanvasCardsForConnection(page, [readme, noteCard]);

	await openCanvasBadgeFace(noteCard);
	const upstream = noteCard.locator('[data-testid="badge-upstream"]');
	const helper = await upstream.locator('.basehalf-canvas-card-badge-helper').textContent();
	if (!helper?.includes('BaseHalf keeps this list for this file.')) {
		throw new Error(`The badge does not say that BaseHalf keeps this note's list: ${JSON.stringify(helper)}`);
	}
	if (await upstream.locator('.basehalf-canvas-card-badge-issue-row').count() !== 0) {
		throw new Error('A note that only starts with a horizontal rule shows an upstream issue');
	}
	await noteCard.locator('[data-testid="badge-add-upstream"]').click();
	const widget = page.locator('.quick-input-widget:visible');
	await widget.locator('.quick-input-title', { hasText: `Add upstream to ${note}` }).waitFor({ state: 'visible', timeout: 10_000 });
	await visibleQuickInput(page).fill('README');
	const readmeRow = widget.locator('.quick-input-list .monaco-list-row[role="option"]', { hasText: 'README.md' }).first();
	await readmeRow.waitFor({ state: 'visible', timeout: 15_000 });
	await readmeRow.click();
	await widget.waitFor({ state: 'hidden', timeout: 10_000 });
	await waitUntil(() => fs.existsSync(keptPath) && fs.readFileSync(keptPath, 'utf8') === 'upstream:\n  - README.md\n', 'BaseHalf to keep the upstream list for the note');
	if (fs.readFileSync(notePath, 'utf8') !== original) {
		throw new Error(`Connecting into the note changed the note: ${JSON.stringify(fs.readFileSync(notePath, 'utf8'))}`);
	}
	const readmeUpstreamRow = noteCard.locator('[data-testid="badge-upstream-row"][data-upstream-status="valid"]', { hasText: 'README' });
	await readmeUpstreamRow.waitFor({ state: 'visible', timeout: 10_000 });
	const readmeUpstreamLink = readmeUpstreamRow.locator('.basehalf-canvas-card-badge-link');
	if (await readmeUpstreamLink.textContent() !== 'README' || await readmeUpstreamLink.getAttribute('title') !== 'README.md') {
		throw new Error(`An Upstream row does not name a note without its extension and keep the path in its tooltip: ${JSON.stringify({ text: await readmeUpstreamLink.textContent(), title: await readmeUpstreamLink.getAttribute('title') })}`);
	}
	await closeCanvasBadgeFace(noteCard);
	await assertCanvasEdgeVisible(page, 'README.md', note);

	// The rule is removed: the note could hold the list now. Its connection
	// stays, and the badge offers to move the list into the note.
	fs.writeFileSync(notePath, 'Body\n', 'utf8');
	await noteCard.locator('.basehalf-canvas-card-badge-dot.issue[data-testid="card-reference-issue-marker"]:visible').waitFor({ state: 'visible', timeout: 10_000 });
	await assertCanvasEdgeVisible(page, 'README.md', note);
	await openCanvasBadgeFace(noteCard);
	const moveIntoFile = upstream.locator('.basehalf-canvas-card-badge-issue-row[data-upstream-issue="misplaced"] .basehalf-canvas-card-badge-issue-action', { hasText: 'Move into File' });
	await moveIntoFile.waitFor({ state: 'visible', timeout: 10_000 });
	await moveIntoFile.click();
	await waitUntil(() => readWorkspaceFile(note) === '---\nupstream:\n  - README.md\n---\nBody\n' && !fs.existsSync(keptPath), 'Move into File to move the kept list into the note');
	await closeCanvasBadgeFace(noteCard);
	await assertCanvasEdgeVisible(page, 'README.md', note);

	// Leave the canvas as the following steps expect it.
	fs.rmSync(notePath);
	await noteCard.waitFor({ state: 'detached', timeout: 10_000 });
}

// Select the agent-drawn edge with the mouse and press Delete while focus is
// outside the canvas: nothing changes.
async function assertEdgeDeleteScopedToCanvas(page, target) {
	const point = await edgeScreenMidpoint(page, 'README.md', target);
	await page.mouse.click(point.x, point.y);
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-edge-hit.selected') !== null, null, { timeout: 10_000 });
	await page.evaluate(() => {
		const outside = document.querySelector('.part.sidebar');
		if (!(outside instanceof HTMLElement)) {
			throw new Error('Missing focus target outside the canvas');
		}
		outside.tabIndex = -1;
		outside.focus();
		if (document.activeElement !== outside || document.querySelector('.basehalf-canvas-cards')?.contains(document.activeElement)) {
			throw new Error('Could not move focus outside the canvas before testing scoped Delete');
		}
	});
	await page.keyboard.press('Delete');
	await page.waitForTimeout(200);
	if (readWorkspaceFile(target) !== agentNoteWithUpstream(['docs', 'README.md'])) {
		throw new Error('Delete outside the canvas removed the selected connection');
	}
	await assertCanvasEdgeVisible(page, 'README.md', target);
}

// Disconnect: Delete on the focused edge removes README.md from the target's
// own upstream list and nothing else; the line disappears.
async function assertEdgeDeleteRemovesReference(page, target) {
	const point = await edgeScreenMidpoint(page, 'README.md', target);

	await page.mouse.click(point.x, point.y);
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-edge-hit.selected') !== null, null, { timeout: 10_000 });
	await page.evaluate(edgeId => {
		const hit = Array.from(document.querySelectorAll('.basehalf-canvas-edge-hit'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		const wrapper = hit?.closest('.react-flow__edge');
		if (!(wrapper instanceof SVGElement) || wrapper.tabIndex !== 0) {
			throw new Error('Missing focusable selected edge wrapper for keyboard deletion');
		}
		const ariaLabel = wrapper.getAttribute('aria-label');
		if (!ariaLabel || /label|note|why/i.test(ariaLabel)) {
			throw new Error(`Selected reference edge has the wrong accessible name: ${ariaLabel ?? '<missing>'}`);
		}
		wrapper.focus();
		if (document.activeElement !== wrapper) {
			throw new Error('Selected edge wrapper did not accept keyboard focus');
		}
	}, `README.md${String.fromCharCode(0)}${target}`);
	const readmeBefore = readWorkspaceFile('README.md');
	await page.keyboard.press('Delete');

	await waitUntil(() => readWorkspaceFile(target) === agentNoteWithUpstream(['docs']), `disconnect to remove README.md from the upstream list of ${target}`);
	await assertCanvasEdgeGone(page, 'README.md', target);
	await assertCanvasEdgeVisible(page, 'docs', target);
	if (readWorkspaceFile('README.md') !== readmeBefore) {
		throw new Error('Disconnecting changed the upstream card instead of only the downstream note');
	}
	if (target === AGENT_CREATED_CARD_PATH) {
		fs.rmSync(path.join(workspacePath, target));
		await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${target}"]`)
			.waitFor({ state: 'detached', timeout: 10_000 });
	}
}

// The exposed point of the `from`→`to` edge nearest its middle: edges render
// beneath cards, so the middle itself can lie under a card between the ends.
async function edgeScreenMidpoint(page, from, to) {
	const point = await page.evaluate(([source, target]) => {
		const hit = Array.from(document.querySelectorAll('.basehalf-canvas-edge-hit'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === `${source}${String.fromCharCode(0)}${target}`);
		if (!(hit instanceof SVGPathElement)) {
			return undefined;
		}
		const ctm = hit.getScreenCTM();
		const total = hit.getTotalLength();
		if (!ctm || total <= 0) {
			return undefined;
		}
		for (let offset = 0; offset <= 0.45; offset += 0.01) {
			for (const ratio of offset === 0 ? [0.5] : [0.5 - offset, 0.5 + offset]) {
				const along = hit.getPointAtLength(total * ratio);
				const screen = new DOMPoint(along.x, along.y).matrixTransform(ctm);
				if (document.elementFromPoint(screen.x, screen.y) === hit) {
					return { x: screen.x, y: screen.y };
				}
			}
		}
		return undefined;
	}, [from, to]);
	if (!point) {
		throw new Error(`Could not locate an exposed point on the ${from}→${to} edge hit path`);
	}
	return point;
}

// A legacy badge pair draws no edge until the user moves it. The migration
// prompt appears once the seeded badges are detected; Move Connections writes
// the downstream note's `upstream` frontmatter, records the pair in
// .bh/legacy-references.yaml, and keeps the legacy keys until a later session.
async function assertMigrationMovesSeededLegacyPair(page) {
	const guideBadgePath = path.join(workspacePath, '.bh', 'mirror', 'docs', 'guide.md', 'badge.yaml');
	const farBadgePath = path.join(workspacePath, '.bh', 'mirror', 'docs', 'far.md', 'badge.yaml');
	const recordPath = path.join(workspacePath, LEGACY_REFERENCES_RECORD_PATH);
	if (readWorkspaceFile('docs/far.md') !== FAR_FIXTURE_CONTENT || fs.existsSync(recordPath)) {
		throw new Error('The migration fixture must start with the original far.md and no legacy connection record');
	}
	fs.mkdirSync(path.dirname(guideBadgePath), { recursive: true });
	fs.mkdirSync(path.dirname(farBadgePath), { recursive: true });
	fs.writeFileSync(guideBadgePath, LEGACY_GUIDE_BADGE, 'utf8');
	fs.writeFileSync(farBadgePath, LEGACY_FAR_BADGE, 'utf8');

	// We are on the docs canvas (previous step). A legacy pair is not a
	// connection: no edge until it is moved into far.md.
	await assertCanvasEdgeGone(page, 'docs/guide.md', 'docs/far.md');
	await clickNotificationAction(page, 'Connections from an earlier BaseHalf version are hidden until they are moved into your files. Move 1 connections?', 'Move Connections', 20_000);
	await waitUntil(() => readWorkspaceFile('docs/far.md') === `---\nupstream:\n  - docs/guide.md\n---\n${FAR_FIXTURE_CONTENT}`, 'Move Connections to write the pair into far.md\'s upstream frontmatter', 20_000);
	await waitUntil(() => {
		const record = fs.existsSync(recordPath) ? fs.readFileSync(recordPath, 'utf8') : '';
		return record.includes('docs/guide.md') && record.includes('docs/far.md') && /\bmigrated\b/.test(record);
	}, 'the moved pair to be recorded in .bh/legacy-references.yaml', 15_000);
	await expectNotification(page, 'Moved 1 connections into 1 files.');
	await assertCanvasEdgeVisible(page, 'docs/guide.md', 'docs/far.md');
	// Keys are removed only by a later detection, in a later session.
	if (fs.readFileSync(guideBadgePath, 'utf8') !== LEGACY_GUIDE_BADGE || fs.readFileSync(farBadgePath, 'utf8') !== LEGACY_FAR_BADGE) {
		throw new Error('The migration removed legacy badge keys in the session that moved them');
	}
}

// Rename a connected file through the Explorer. Its badge (description and
// legacy text) follows the file, and so does the legacy `referenced_by` item
// of the unmigrated pair. far.md's upstream entry is rewritten in place
// without a question, and the edge follows the file. The step then restores
// the fixture bytes.
async function assertExplorerRenameCascadesMirror(page) {
	const guideBadgeDir = path.join(workspacePath, '.bh', 'mirror', 'docs', 'guide.md');
	const farBadgeDir = path.join(workspacePath, '.bh', 'mirror', 'docs', 'far.md');
	const renamedBadgePath = path.join(workspacePath, '.bh', 'mirror', 'docs', 'guide-renamed.md', 'badge.yaml');
	const farBadgePath = path.join(farBadgeDir, 'badge.yaml');
	const farConnected = readWorkspaceFile('docs/far.md');
	const farRenamed = farConnected.replace('  - docs/guide.md\n', '  - docs/guide-renamed.md\n');
	const legacyFarRenamed = LEGACY_FAR_BADGE.replace('  - "docs/guide.md"', '  - "docs/guide-renamed.md"');
	const renamedBadge = LEGACY_GUIDE_BADGE.replace('path: "docs/guide.md"', 'path: "docs/guide-renamed.md"');
	if (farRenamed === farConnected) {
		throw new Error('The rename fixture must start with far.md listing docs/guide.md as upstream');
	}
	await assertCanvasEdgeVisible(page, 'docs/guide.md', 'docs/far.md');

	// The entry of far.md is rewritten without a question, and the edge follows the file.
	await renameExplorerEntry(page, 'guide.md', 'guide-renamed.md');
	await waitUntil(() => fs.existsSync(renamedBadgePath) && fs.readFileSync(renamedBadgePath, 'utf8') === renamedBadge, 'badge.yaml to follow the renamed file with its description and legacy text');
	await waitUntil(() => badgeMirrorIsAbsentOrCanonicalEmpty(path.join(guideBadgeDir, 'badge.yaml')), 'old badge.yaml to be absent or a canonical empty tombstone');
	await waitUntil(() => fs.readFileSync(farBadgePath, 'utf8') === legacyFarRenamed, 'the unmigrated pair\'s legacy referenced_by item to follow the rename');
	await waitUntil(() => readWorkspaceFile('docs/far.md') === farRenamed, 'far.md\'s upstream entry to be rewritten in place without a question', 20_000);
	await assertCanvasEdgeVisible(page, 'docs/guide-renamed.md', 'docs/far.md');
	if (await page.locator('.notifications-toasts .notification-list-item', { hasText: 'moved to' }).count() !== 0) {
		throw new Error('A rename through the Explorer asked whether to update the entries that name the item');
	}

	// Rename back: far.md returns to its exact bytes, and the badges return home.
	await renameExplorerEntry(page, 'guide-renamed.md', 'guide.md');
	await waitUntil(() => readWorkspaceFile('docs/far.md') === farConnected, 'far.md\'s upstream entry to be rewritten back', 20_000);
	await waitUntil(() => fs.existsSync(path.join(guideBadgeDir, 'badge.yaml'))
		&& fs.readFileSync(path.join(guideBadgeDir, 'badge.yaml'), 'utf8') === LEGACY_GUIDE_BADGE
		&& fs.readFileSync(farBadgePath, 'utf8') === LEGACY_FAR_BADGE, 'the badges to follow the rename back');
	await assertCanvasEdgeVisible(page, 'docs/guide.md', 'docs/far.md');

	// Restore the fixture. The legacy badges go first, so no later detection
	// offers the pair again once far.md loses its entry; then far.md's bytes
	// and the migration record.
	fs.rmSync(path.join(guideBadgeDir, 'badge.yaml'), { force: true });
	fs.rmSync(farBadgePath, { force: true });
	await page.waitForTimeout(1_500);
	fs.writeFileSync(path.join(workspacePath, 'docs', 'far.md'), FAR_FIXTURE_CONTENT, 'utf8');
	fs.rmSync(path.join(workspacePath, LEGACY_REFERENCES_RECORD_PATH), { force: true });
	await assertCanvasEdgeGone(page, 'docs/guide.md', 'docs/far.md');
}

// A retired badge is either gone or keeps no description; legacy reference
// text, when present, is kept verbatim until a migration removes it.
function badgeMirrorIsAbsentOrCanonicalEmpty(file) {
	if (!fs.existsSync(file)) {
		return true;
	}
	const contents = fs.readFileSync(file, 'utf8');
	return !/^description:/m.test(contents) && !/^orphan:/m.test(contents);
}

async function renameExplorerEntry(page, currentName, nextName) {
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			const row = page.locator('.explorer-viewlet .monaco-list-row', { hasText: currentName }).first();
			if (!(await row.isVisible().catch(() => false))) {
				await runCommand(page, 'Focus on Files Explorer');
			}
			await row.waitFor({ state: 'visible', timeout: 20_000 });
			await row.click();
			// BaseHalf routes Explorer activation into card detail. Keep the
			// Explorer selection, but close the card before rename so structural
			// preflight does not race a just-opened retained editor surface.
			await closeCardDetailIfOpen(page);
			await runCommand(page, 'Focus on Files Explorer');
			// macOS explorer rename is Enter; F2 elsewhere.
			await page.keyboard.press(process.platform === 'darwin' ? 'Enter' : 'F2');
			const input = page.locator('.explorer-viewlet .explorer-item .monaco-inputbox input');
			await input.waitFor({ state: 'visible', timeout: 10_000 });
			await input.fill(nextName);
			await page.keyboard.press('Enter');
			await input.waitFor({ state: 'hidden', timeout: 10_000 });
			return;
		} catch (error) {
			await page.keyboard.press('Escape').catch(() => undefined);
			if (attempt === 3) {
				throw error;
			}
			await page.waitForTimeout(250);
		}
	}
}

async function closeCardDetailIfOpen(page) {
	const detail = page.locator('.basehalf-card-detail.visible');
	const opened = await detail.waitFor({ state: 'visible', timeout: 2_000 }).then(() => true, () => false);
	if (!opened) {
		return;
	}
	await page.locator('.basehalf-card-detail-close').click();
	await detail.waitFor({ state: 'hidden', timeout: 10_000 });
}

async function assertCanvasSnapGuides(page) {
	// Snap against the same flow geometry regardless of the viewport left by
	// earlier canvas tests. Without this fit, the target can sit inside React
	// Flow's drag auto-pan zone; holding the pointer there while we inspect the
	// guide keeps panning the viewport and moves the node away from the axis.
	await zoomCanvas(page, 'fit');
	for (let i = 0; i < 10; i++) {
		const zoom = await page.locator('.basehalf-canvas-workbench').evaluate(root => Number(root.getAttribute('data-zoom')) || 1);
		if (zoom <= 0.5 || !(await zoomCanvas(page, 'out'))) {
			break;
		}
		await page.waitForFunction(previous => Number(document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom')) < previous, zoom, { timeout: 10_000 });
	}

	const readme = page.locator('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
	const docs = page.locator('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
	await readme.waitFor({ state: 'visible', timeout: 20_000 });
	await docs.waitFor({ state: 'visible', timeout: 20_000 });
	// The zoom change re-renders the cards, so the element the locator found
	// can be replaced before the scroll runs. Look it up again when that happens.
	for (let attempt = 0; ; attempt++) {
		try {
			await readme.scrollIntoViewIfNeeded();
			break;
		} catch (error) {
			if (attempt >= 4 || !/not attached/.test(String(error))) {
				throw error;
			}
		}
	}
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

	const geometry = await page.evaluate(() => {
		const readmeCard = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
		const docsCard = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
		const root = document.querySelector('.basehalf-canvas-workbench');
		if (!(readmeCard instanceof HTMLElement) || !(docsCard instanceof HTMLElement) || !(root instanceof HTMLElement)) {
			return undefined;
		}
		const readmeNode = readmeCard.closest('.react-flow__node');
		const docsNode = docsCard.closest('.react-flow__node');
		if (!(readmeNode instanceof HTMLElement) || !(docsNode instanceof HTMLElement)) {
			return undefined;
		}

		const matrixFor = (element) => {
			const transform = getComputedStyle(element).transform;
			return transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(transform);
		};
		const readmeMatrix = matrixFor(readmeNode);
		const docsMatrix = matrixFor(docsNode);
		// Card identity now lives in the stable caption outside the painted frame.
		// Start the drag there so the smoke exercises the same shared drag surface
		// that users see, instead of the Note body (which owns text interaction).
		const dragSurface = readmeCard.querySelector('.basehalf-canvas-card-caption-identity');
		const readmeRect = readmeCard.getBoundingClientRect();
		const dragRect = dragSurface instanceof HTMLElement ? dragSurface.getBoundingClientRect() : readmeRect;
		const rootRect = root.getBoundingClientRect();
		const zoom = Number(root.getAttribute('data-zoom')) || 1;
		const targetDraftX = docsMatrix.m41 + 3;
		const startX = dragRect.left + dragRect.width / 2;
		const startY = dragRect.top + dragRect.height / 2;
		const endX = startX + (targetDraftX - readmeMatrix.m41) * zoom;
		const endY = startY;
		if (startX < rootRect.left || startX > rootRect.right || startY < rootRect.top || startY > rootRect.bottom) {
			return undefined;
		}

		return {
			startX,
			startY,
			endX,
			endY,
			targetAxesX: [docsMatrix.m41, docsMatrix.m41 + docsNode.offsetWidth / 2, docsMatrix.m41 + docsNode.offsetWidth],
			draggedWidth: readmeNode.offsetWidth,
			draftX: targetDraftX,
			initialX: readmeMatrix.m41,
			zoom
		};
	});
	if (!geometry) {
		throw new Error('Missing visible canvas geometry for snap smoke');
	}

	await page.mouse.move(geometry.startX, geometry.startY);
	await page.mouse.down();
	await page.mouse.move(geometry.endX, geometry.endY, { steps: 14 });
	await page.waitForFunction(targetAxesX => Array.from(document.querySelectorAll('[data-testid="canvas-snap-guide"]')).some(line => {
		const x1 = Number(line.getAttribute('x1'));
		const x2 = Number(line.getAttribute('x2'));
		const y1 = Number(line.getAttribute('y1'));
		const y2 = Number(line.getAttribute('y2'));
		return Math.abs(x1 - x2) <= 0.1
			&& targetAxesX.some(axis => Math.abs(x1 - axis) <= 0.1)
			&& y2 > y1;
	}), geometry.targetAxesX, { timeout: 10_000 });

	const guides = await page.locator('[data-testid="canvas-snap-guide"]').evaluateAll(lines => lines.map(line => ({
		x1: Number(line.getAttribute('x1')),
		x2: Number(line.getAttribute('x2')),
		y1: Number(line.getAttribute('y1')),
		y2: Number(line.getAttribute('y2'))
	})));
	const verticalGuide = guides.find(guide => Math.abs(guide.x1 - guide.x2) <= 0.1
		&& geometry.targetAxesX.some(axis => Math.abs(guide.x1 - axis) <= 0.1)
		&& guide.y2 > guide.y1);
	if (!verticalGuide) {
		throw new Error(`Expected a vertical snap guide on a docs alignment axis ${JSON.stringify(geometry.targetAxesX)}, got ${JSON.stringify(guides)}`);
	}

	await page.mouse.up();
	await page.waitForFunction(() => document.querySelectorAll('[data-testid="canvas-snap-guide"]').length === 0, null, { timeout: 10_000 });

	const canvasPath = path.join(workspacePath, '.bh', 'mirror', 'canvas.yaml');
	await waitUntil(() => {
		const canvas = fs.readFileSync(canvasPath, 'utf8');
		const savedX = readCanvasCardNumber(canvas, 'README.md', 'x');
		return savedX !== undefined && [savedX, savedX + geometry.draggedWidth / 2, savedX + geometry.draggedWidth]
			.some(axis => Math.abs(axis - verticalGuide.x1) <= 0.1);
	}, 'README.md card to persist on the displayed docs snap axis');

	const snapToggle = page.locator('.basehalf-canvas-snap-toggle:visible');
	const pane = page.locator('.basehalf-canvas-cards .react-flow__pane');
	await pane.click({ position: { x: 20, y: 20 } });
	const toggleDrag = await readme.boundingBox();
	if (!toggleDrag) {
		throw new Error('README.md card disappeared before exercising the snap toggle');
	}
	const toggleDragStartX = toggleDrag.x + toggleDrag.width / 2;
	const toggleDragStartY = toggleDrag.y + toggleDrag.height / 2;
	await page.mouse.move(toggleDragStartX, toggleDragStartY);
	await page.mouse.down();
	await page.mouse.move(toggleDragStartX + 30, toggleDragStartY, { steps: 8 });
	await page.mouse.move(toggleDragStartX + 3 * geometry.zoom, toggleDragStartY, { steps: 8 });
	await page.waitForFunction(() => document.querySelectorAll('[data-testid="canvas-snap-guide"]').length > 0, null, { timeout: 10_000 });
	// A programmatic click lets the fixed viewport control change state while
	// React Flow still owns the pointer gesture.
	await snapToggle.evaluate(button => button.click());
	if (await snapToggle.getAttribute('aria-pressed') !== 'false') {
		throw new Error('Canvas snap toggle did not disable snapping during an active drag');
	}
	await page.waitForFunction(() => document.querySelectorAll('[data-testid="canvas-snap-guide"]').length === 0, null, { timeout: 10_000 });
	await page.mouse.up();
	await snapToggle.click();
	if (await snapToggle.getAttribute('aria-pressed') !== 'true') {
		throw new Error('Canvas snap toggle did not restore snapping after clearing the active guide');
	}
}

async function scrollCanvasWorkbenchForCardDetail(page) {
	const before = await page.evaluate(() => {
		const root = document.querySelector('.basehalf-canvas-workbench');
		const viewport = document.querySelector('.basehalf-canvas-cards .react-flow__viewport');
		if (!(root instanceof HTMLElement) || !(viewport instanceof HTMLElement)) {
			throw new Error('Missing React Flow canvas viewport');
		}
		return { transform: getComputedStyle(viewport).transform };
	});
	// On a card the pointer could be on a long note, which takes such a scroll.
	const emptyCanvas = await emptyCanvasPoint(page);
	await page.mouse.move(emptyCanvas.x, emptyCanvas.y);
	await page.mouse.wheel(90, 180);
	await page.waitForFunction(previous => {
		const viewport = document.querySelector('.basehalf-canvas-cards .react-flow__viewport');
		return viewport instanceof HTMLElement && getComputedStyle(viewport).transform !== previous;
	}, before.transform, { timeout: 10_000 });
	canvasViewportBeforeCardDetail = await page.locator('.basehalf-canvas-cards .react-flow__viewport').evaluate(viewport => getComputedStyle(viewport).transform);
}

async function assertCardDetailCoversCanvasViewport(page) {
	const geometry = await page.evaluate(() => {
		const root = document.querySelector('.basehalf-canvas-workbench');
		const detail = document.querySelector('.basehalf-card-detail.visible');
		const viewport = document.querySelector('.basehalf-canvas-cards .react-flow__viewport');
		const canvasChrome = root?.querySelector('.basehalf-canvas-chrome');
		if (!(root instanceof HTMLElement) || !(detail instanceof HTMLElement) || !(viewport instanceof HTMLElement) || !(canvasChrome instanceof HTMLElement)) {
			throw new Error('Missing visible BaseHalf card detail');
		}

		const rootRect = root.getBoundingClientRect();
		const detailRect = detail.getBoundingClientRect();
		const bottomProbe = document.elementFromPoint(rootRect.left + rootRect.width / 2, rootRect.bottom - 24);
		return {
			rootTop: rootRect.top,
			rootLeft: rootRect.left,
			rootBottom: rootRect.bottom,
			rootRight: rootRect.right,
			detailTop: detailRect.top,
			detailLeft: detailRect.left,
			detailBottom: detailRect.bottom,
			detailRight: detailRect.right,
			viewportTransform: getComputedStyle(viewport).transform,
			locked: root.classList.contains('basehalf-card-detail-open'),
			bottomProbeIsCanvas: !!bottomProbe?.closest('.basehalf-canvas-card, .basehalf-canvas-surface'),
			canvasChromeHidden: getComputedStyle(canvasChrome).display === 'none',
			zoomMenuVisible: Array.from(document.querySelectorAll('.basehalf-canvas-zoom-menu')).some(menu => menu instanceof HTMLElement && menu.offsetParent !== null)
		};
	});

	const tolerance = 1;
	if (!geometry.locked || geometry.viewportTransform !== canvasViewportBeforeCardDetail) {
		throw new Error(`Card detail did not preserve the React Flow viewport: ${JSON.stringify({ geometry, canvasViewportBeforeCardDetail })}`);
	}
	if (Math.abs(geometry.detailTop - geometry.rootTop) > tolerance
		|| Math.abs(geometry.detailLeft - geometry.rootLeft) > tolerance
		|| Math.abs(geometry.detailBottom - geometry.rootBottom) > tolerance
		|| Math.abs(geometry.detailRight - geometry.rootRight) > tolerance) {
		throw new Error(`Card detail does not cover canvas viewport: ${JSON.stringify(geometry)}`);
	}
	if (geometry.bottomProbeIsCanvas) {
		throw new Error(`Card detail leaves canvas visible at the bottom: ${JSON.stringify(geometry)}`);
	}
	if (!geometry.canvasChromeHidden || geometry.zoomMenuVisible) {
		throw new Error(`Card detail left Canvas zoom chrome interactive: ${JSON.stringify(geometry)}`);
	}
}

async function assertMarkdownRichSaveStatusHidden(page) {
	const toolbarCount = await page.locator('.basehalf-card-detail-markdown-rich-toolbar').count();
	if (toolbarCount !== 0) {
		throw new Error(`Markdown rich status should not create a toolbar, toolbarCount=${toolbarCount}`);
	}
	const headerMetaText = await page.locator('.basehalf-card-detail-meta').textContent().catch(() => '');
	if (/\b(Saving|Saved)\b/.test(headerMetaText ?? '')) {
		throw new Error(`Markdown rich status should not live under the title: ${headerMetaText}`);
	}
	const oldRichStatusCount = await page.locator('.basehalf-card-detail-markdown-rich-status').count();
	if (oldRichStatusCount !== 0) {
		throw new Error(`Markdown rich status should not render inside the editor, oldRichStatusCount=${oldRichStatusCount}`);
	}

	const status = page.locator('.basehalf-card-detail-save-status').first();
	await status.waitFor({ state: 'attached', timeout: 10_000 });
	const geometry = await status.evaluate(element => {
		const rect = element.getBoundingClientRect();
		const style = getComputedStyle(element);
		return {
			saveState: element.getAttribute('data-save-state'),
			text: element.textContent?.trim(),
			ariaHidden: element.getAttribute('aria-hidden'),
			display: style.display,
			width: rect.width,
			height: rect.height
		};
	});
	if (geometry.display !== 'none' || geometry.width !== 0 || geometry.height !== 0) {
		throw new Error(`Markdown rich save status should be hidden: ${JSON.stringify(geometry)}`);
	}
	if (geometry.saveState !== null || geometry.text !== '' || geometry.ariaHidden !== 'true') {
		throw new Error(`Markdown rich save status should not expose ordinary save state: ${JSON.stringify(geometry)}`);
	}
}

async function assertMarkdownRichBlockquoteEditable(page) {
	const frame = await activeMarkdownRichFrame(page);
	const quote = frame.locator('.bn-block-content[data-content-type="quote"]', { hasText: 'Smoke editable quote' }).first();
	await quote.waitFor({ state: 'visible', timeout: 20_000 });
	const rawQuoteCount = await frame.locator('.basehalf-raw-passthrough', { hasText: 'Smoke editable quote' }).count();
	if (rawQuoteCount !== 0) {
		throw new Error(`Markdown blockquote should be an editable BlockNote quote block, got ${rawQuoteCount} raw passthrough block(s)`);
	}
}

async function assertMarkdownRichBlockMenuPortal(page) {
	const frame = await activeMarkdownRichFrame(page);
	const content = frame.locator('.bn-block-content', { hasText: 'nested-menu-anchor continuation' }).first();
	await content.waitFor({ state: 'visible', timeout: 20_000 });
	await content.hover({ position: { x: 8, y: 8 } });

	const sideMenu = frame.locator('.basehalf-markdown-rich-portal .bn-side-menu').first();
	await sideMenu.waitFor({ state: 'visible', timeout: 10_000 });

	const geometry = await frame.evaluate(() => {
		const menu = document.querySelector<HTMLElement>('.basehalf-markdown-rich-portal .bn-side-menu');
		const portal = document.querySelector<HTMLElement>('.basehalf-markdown-rich-portal');
		const content = Array.from(document.querySelectorAll<HTMLElement>('.bn-block-content'))
			.find(element => element.textContent?.includes('nested-menu-anchor continuation')) ?? null;
		const rootGroup = document.querySelector<HTMLElement>('.bn-editor > .bn-block-group');
		const rect = (element: HTMLElement | null) => {
			if (!element) {
				return undefined;
			}
			const bounds = element.getBoundingClientRect();
			return {
				left: bounds.left,
				right: bounds.right,
				width: bounds.width
			};
		};
		return {
			menu: rect(menu),
			portal: rect(portal),
			content: rect(content),
			rootGroup: rect(rootGroup)
		};
	});

	if (!geometry.menu || !geometry.portal || !geometry.content || !geometry.rootGroup) {
		throw new Error(`Markdown rich block menu portal geometry missing: ${JSON.stringify(geometry)}`);
	}

	const tolerance = 1;
	const guideGap = 6;
	if (geometry.menu.right < geometry.portal.left - tolerance || geometry.menu.left > geometry.content.left + tolerance) {
		throw new Error(`Markdown rich block menu is not anchored in the left block gutter: ${JSON.stringify(geometry)}`);
	}
	if (geometry.content.left <= geometry.rootGroup.left + 8) {
		throw new Error(`Markdown rich smoke fixture did not create a nested continuation block: ${JSON.stringify(geometry)}`);
	}
	if (geometry.menu.right > geometry.rootGroup.left - guideGap + tolerance) {
		throw new Error(`Markdown rich nested block menu should leave a gap before the root indent guide: ${JSON.stringify(geometry)}`);
	}
}

async function assertMarkdownRichSlashMenuThemedPortal(page) {
	const frame = await activeMarkdownRichFrame(page);
	const editable = frame.locator('.bn-editor [contenteditable="true"], .bn-editor[contenteditable="true"], .ProseMirror[contenteditable="true"]').first();
	await editable.waitFor({ state: 'visible', timeout: 20_000 });
	await editable.click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
	await page.keyboard.press('Enter');
	await page.keyboard.insertText('/');

	const slashMenu = frame.locator('.basehalf-markdown-rich-portal .bn-suggestion-menu').first();
	await slashMenu.waitFor({ state: 'visible', timeout: 10_000 });

	const diagnostic = await frame.evaluate(() => {
		const menu = document.querySelector<HTMLElement>('.basehalf-markdown-rich-portal .bn-suggestion-menu');
		const portal = document.querySelector<HTMLElement>('.basehalf-markdown-rich-portal');
		const firstItem = document.querySelector<HTMLElement>('.basehalf-markdown-rich-portal .bn-suggestion-menu-item');
		const rect = menu?.getBoundingClientRect();
		const probe = rect ? document.elementFromPoint(rect.left + 12, rect.top + 12) as HTMLElement | null : null;
		const menuStyle = menu ? getComputedStyle(menu) : undefined;
		const itemStyle = firstItem ? getComputedStyle(firstItem) : undefined;
		return {
			portalClass: portal?.className ?? '',
			portalColorScheme: portal?.getAttribute('data-color-scheme') ?? '',
			portalMantineColorScheme: portal?.getAttribute('data-mantine-color-scheme') ?? '',
			menuText: menu?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
			menuBackground: menuStyle?.backgroundColor ?? '',
			menuColor: menuStyle?.color ?? '',
			menuBoxShadow: menuStyle?.boxShadow ?? '',
			itemHeight: itemStyle?.height ?? '',
			probeInsideMenu: !!probe?.closest('.bn-suggestion-menu')
		};
	});

	await page.keyboard.press('Escape');
	await page.keyboard.press('Backspace');

	if (!diagnostic.portalClass.includes('bn-root') || !diagnostic.portalClass.includes('bn-mantine')) {
		throw new Error(`Markdown rich slash menu portal is outside the BlockNote/Mantine theme scope: ${JSON.stringify(diagnostic)}`);
	}
	if (diagnostic.portalColorScheme !== 'dark' || diagnostic.portalMantineColorScheme !== 'dark') {
		throw new Error(`Markdown rich slash menu portal did not inherit the dark theme: ${JSON.stringify(diagnostic)}`);
	}
	if (!diagnostic.menuText.includes('Heading 1') || !diagnostic.menuText.includes('Paragraph')) {
		throw new Error(`Markdown rich slash menu items are missing: ${JSON.stringify(diagnostic)}`);
	}
	if (isTransparentCssColor(diagnostic.menuBackground) || isTransparentCssColor(diagnostic.menuColor) || diagnostic.menuBoxShadow === 'none') {
		throw new Error(`Markdown rich slash menu is mounted but unthemed: ${JSON.stringify(diagnostic)}`);
	}
	if (!diagnostic.probeInsideMenu) {
		throw new Error(`Markdown rich slash menu is not the top interactive surface: ${JSON.stringify(diagnostic)}`);
	}
}

async function assertMarkdownRichReadingModeDisabled(page) {
	const frame = await activeMarkdownRichFrame(page);
	const checkboxCount = await frame.locator('.basehalf-adhd-check').count();
	const keywordCount = await frame.locator('.basehalf-adhd-keyword').count();
	if (checkboxCount !== 0 || keywordCount !== 0) {
		throw new Error(`ADHD reading aids should be disabled by default, checkboxCount=${checkboxCount}, keywordCount=${keywordCount}`);
	}

	const content = frame.locator('.bn-block-content', { hasText: 'Smoke README' }).first();
	await content.waitFor({ state: 'visible', timeout: 20_000 });
	await openMarkdownRichContextMenuForText(frame, 'README');
	const menuText = await frame.locator('.basehalf-markdown-rich-context-menu').first().textContent({ timeout: 5_000 });
	await page.keyboard.press('Escape');
	if (menuText?.includes('Highlight')) {
		throw new Error(`ADHD highlight context item should be hidden while reading mode is off: ${menuText}`);
	}
}

async function assertMarkdownRichReadingModeEnabledFromWorkspaceSettings(page) {
	const vscodeDir = path.join(workspacePath, '.vscode');
	fs.mkdirSync(vscodeDir, { recursive: true });
	fs.writeFileSync(path.join(vscodeDir, 'settings.json'), JSON.stringify({
		'basehalf.editor.readingMode': true
	}, null, 2), 'utf8');

	const frame = await activeMarkdownRichFrame(page);
	await frame.locator('.basehalf-adhd-check').first().waitFor({ state: 'visible', timeout: 20_000 });
	await frame.locator('.basehalf-adhd-keyword', { hasText: 'Smoke' }).first().waitFor({ state: 'visible', timeout: 20_000 });
	const readStateAppearance = await frame.evaluate(() => {
		const checked = document.querySelector('.basehalf-adhd-check-checked');
		const unchecked = document.querySelector('.basehalf-adhd-check:not(.basehalf-adhd-check-checked)');
		const read = document.querySelector('.basehalf-adhd-read');
		const unread = document.querySelector('.basehalf-adhd-unread');
		if (!(checked instanceof HTMLElement) || !(unchecked instanceof HTMLElement) || !(read instanceof HTMLElement) || !(unread instanceof HTMLElement)) {
			return undefined;
		}
		const checkmarkStyle = getComputedStyle(checked, '::after');
		return {
			checkedBackground: getComputedStyle(checked).backgroundColor,
			uncheckedBackground: getComputedStyle(unchecked).backgroundColor,
			checkmarkOpacity: checkmarkStyle.opacity,
			checkmarkBorderRightWidth: checkmarkStyle.borderRightWidth,
			checkmarkBorderBottomWidth: checkmarkStyle.borderBottomWidth,
			checkboxTabIndex: checked.tabIndex,
			checkboxAriaLabel: checked.getAttribute('aria-label'),
			readColor: getComputedStyle(read).color,
			unreadColor: getComputedStyle(unread).color,
		};
	});
	if (!readStateAppearance
		|| readStateAppearance.checkedBackground === readStateAppearance.uncheckedBackground
		|| readStateAppearance.readColor === readStateAppearance.unreadColor
		|| readStateAppearance.checkmarkOpacity === '0'
		|| readStateAppearance.checkmarkBorderRightWidth === '0px'
		|| readStateAppearance.checkmarkBorderBottomWidth === '0px'
		|| readStateAppearance.checkboxTabIndex !== 0
		|| !readStateAppearance.checkboxAriaLabel) {
		throw new Error(`ADHD read and unread states should have distinct checkbox and prose styles: ${JSON.stringify(readStateAppearance)}`);
	}

	const content = frame.locator('.bn-block-content', { hasText: 'Smoke README' }).first();
	await content.waitFor({ state: 'visible', timeout: 20_000 });
	await openMarkdownRichContextMenuForText(frame, 'README');
	const menuText = await frame.locator('.basehalf-markdown-rich-context-menu').first().textContent({ timeout: 5_000 });
	await page.keyboard.press('Escape');
	if (!menuText?.includes('Highlight') && !menuText?.includes('Remove')) {
		throw new Error(`ADHD highlight context item should be available while reading mode is on: ${menuText}`);
	}
}

async function openMarkdownRichContextMenuForText(frame, text: string) {
	const opened = await frame.evaluate((needle: string) => {
		const root = document.querySelector<HTMLElement>('.bn-editor');
		const prosemirror = document.querySelector<HTMLElement>('.ProseMirror[contenteditable="true"], [contenteditable="true"].ProseMirror, .bn-editor [contenteditable="true"]');
		if (!root || !prosemirror) {
			return { ok: false, reason: 'missing editor root' };
		}

		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let node: Text | null = null;
		let start = -1;
		while (walker.nextNode()) {
			const current = walker.currentNode as Text;
			start = current.data.indexOf(needle);
			if (start >= 0) {
				node = current;
				break;
			}
		}
		if (!node) {
			return { ok: false, reason: 'text not found' };
		}

		const range = document.createRange();
		range.setStart(node, start);
		range.setEnd(node, start + needle.length);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);

		const rect = range.getBoundingClientRect();
		const x = Number.isFinite(rect.left) && rect.left > 0 ? rect.left + Math.min(12, Math.max(1, rect.width / 2)) : 120;
		const y = Number.isFinite(rect.top) && rect.top > 0 ? rect.top + Math.min(12, Math.max(1, rect.height / 2)) : 120;
		const target = node.parentElement ?? prosemirror;
		target.dispatchEvent(new MouseEvent('contextmenu', {
			bubbles: true,
			cancelable: true,
			clientX: x,
			clientY: y,
			button: 2
		}));
		return { ok: true };
	}, text);

	if (!opened.ok) {
		throw new Error(`Could not open Markdown rich context menu: ${JSON.stringify(opened)}`);
	}
}

async function assertMarkdownRichEditorEditsAndSaves(page) {
	const marker = `rich editor smoke ${Date.now()}`;
	const readmePath = path.join(workspacePath, 'README.md');
	const frame = await activeMarkdownRichFrame(page);
	const editable = frame.locator('.bn-editor [contenteditable="true"], .bn-editor[contenteditable="true"], .ProseMirror[contenteditable="true"]').first();
	await editable.waitFor({ state: 'visible', timeout: 20_000 });
	await editable.click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
	await page.keyboard.press('Enter');
	await page.keyboard.insertText(marker);

	await waitUntil(() => fs.readFileSync(readmePath, 'utf8').includes(marker), 'rich Markdown editor to persist edits', 15_000);
}

function markdownRichUndoRedoKey(kind) {
	const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
	return kind === 'undo' ? `${modifier}+z` : `${modifier}+Shift+z`;
}

async function markdownRichEditorHasText(frame, needle) {
	return (await frame.locator('.bn-editor', { hasText: needle }).count()) > 0;
}

async function typeMarkdownRichMarker(page, frame, marker) {
	const readmePath = path.join(workspacePath, 'README.md');
	const editable = frame.locator('.bn-editor [contenteditable="true"], .bn-editor[contenteditable="true"], .ProseMirror[contenteditable="true"]').first();
	await editable.waitFor({ state: 'visible', timeout: 20_000 });
	await editable.click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
	await page.keyboard.press('Enter');
	await page.keyboard.insertText(marker);
	await waitUntil(() => fs.readFileSync(readmePath, 'utf8').includes(marker), `rich editor to persist "${marker}"`, 15_000);
}

async function pressMarkdownRichKeyOnce(page, key, predicate, description) {
	await page.keyboard.press(key);
	await page.waitForTimeout(250);
	if (await predicate()) {
		return;
	}
	throw new Error(`A single ${key} did not ${description}`);
}

async function assertMarkdownRichUndoRedoRoundtrip(page) {
	const marker = `undo smoke ${Date.now()}`;
	const readmePath = path.join(workspacePath, 'README.md');
	const frame = await activeMarkdownRichFrame(page);
	await typeMarkdownRichMarker(page, frame, marker);

	await pressMarkdownRichKeyOnce(
		page,
		markdownRichUndoRedoKey('undo'),
		async () => !(await markdownRichEditorHasText(frame, marker)),
		`undo to remove "${marker}" from the rich editor`
	);
	await waitUntil(() => !fs.readFileSync(readmePath, 'utf8').includes(marker), 'undo to persist the marker removal', 15_000);

	await pressMarkdownRichKeyOnce(
		page,
		markdownRichUndoRedoKey('redo'),
		() => markdownRichEditorHasText(frame, marker),
		`redo to restore "${marker}" in the rich editor`
	);
	await waitUntil(() => fs.readFileSync(readmePath, 'utf8').includes(marker), 'redo to persist the restored marker', 15_000);
}

async function assertMarkdownRichUndoStopsAtLoad(page) {
	const readmePath = path.join(workspacePath, 'README.md');
	const frame = await activeMarkdownRichFrame(page);
	const editable = frame.locator('.bn-editor [contenteditable="true"], .bn-editor[contenteditable="true"], .ProseMirror[contenteditable="true"]').first();
	await editable.click();

	for (let attempt = 0; attempt < 12; attempt++) {
		await page.keyboard.press(markdownRichUndoRedoKey('undo'));
		await page.waitForTimeout(80);
	}

	if (!(await markdownRichEditorHasText(frame, 'Smoke editable quote'))) {
		throw new Error('Undo walked past the document load and dropped baseline content');
	}

	// Let a pending autosave settle, then confirm the file kept its baseline content too.
	await page.waitForTimeout(1_800);
	if (!fs.readFileSync(readmePath, 'utf8').includes('Smoke editable quote')) {
		throw new Error('Undo past the document load blanked README.md on disk');
	}
}

async function assertMarkdownRichExternalMergePreservesCursor(page) {
	const readmePath = path.join(workspacePath, 'README.md');
	const frame = await activeMarkdownRichFrame(page);
	const quote = frame.locator('.bn-block-content[data-content-type="quote"]', { hasText: 'Smoke editable quote' }).first();
	await quote.click();
	await page.keyboard.press('End');
	await page.keyboard.insertText(' MERGEMARK');
	await waitUntil(() => fs.readFileSync(readmePath, 'utf8').includes('MERGEMARK'), 'merge marker to persist', 15_000);

	const cursorBlock = () => frame.evaluate(() => {
		const anchor = document.getSelection()?.anchorNode;
		const element = anchor instanceof Element ? anchor : anchor?.parentElement;
		return element?.closest('[data-id]')?.getAttribute('data-id') ?? null;
	});
	const before = await cursorBlock();
	if (!before) {
		throw new Error('No cursor block before the external merge');
	}

	fs.writeFileSync(readmePath, fs.readFileSync(readmePath, 'utf8')
		.replace('External merge target paragraph.', 'External merge target paragraph (updated by agent).'), 'utf8');

	const deadline = Date.now() + 15_000;
	while (!(await markdownRichEditorHasText(frame, 'updated by agent'))) {
		if (Date.now() > deadline) {
			throw new Error('External change did not merge into the rich editor');
		}
		await page.waitForTimeout(150);
	}

	const after = await cursorBlock();
	if (after !== before) {
		throw new Error(`Cursor block changed across the external merge: ${before} -> ${after}`);
	}
	if (!(await markdownRichEditorHasText(frame, 'MERGEMARK'))) {
		throw new Error('Typed text was lost across the external merge');
	}

	// Undo must revert the user's own edit, never the external change.
	await pressMarkdownRichKeyOnce(
		page,
		markdownRichUndoRedoKey('undo'),
		async () => !(await markdownRichEditorHasText(frame, 'MERGEMARK')),
		'undo to remove the merge marker'
	);
	if (!(await markdownRichEditorHasText(frame, 'updated by agent'))) {
		throw new Error('Undo reverted the external change');
	}
	await waitUntil(() => !fs.readFileSync(readmePath, 'utf8').includes('MERGEMARK'), 'merge marker removal to persist', 15_000);
}

async function assertMarkdownRichContextMenuClipboard(page) {
	const frame = await activeMarkdownRichFrame(page);
	const source = frame.locator('.bn-block-content', { hasText: 'Smoke editable quote' }).first();
	await source.click({ clickCount: 3 });
	await page.waitForTimeout(200);
	await source.click({ button: 'right' });
	const copyButton = frame.locator('.basehalf-markdown-rich-context-menu button', { hasText: /^Copy$/ });
	await copyButton.waitFor({ state: 'visible', timeout: 5_000 });
	await copyButton.click();
	await page.waitForTimeout(400);

	// Paste must be offered at a bare cursor and preserve rich formatting.
	const target = frame.locator('.bn-block-content', { hasText: 'External merge target paragraph' }).first();
	await target.click();
	await page.keyboard.press('End');
	await target.click({ button: 'right' });
	const pasteButton = frame.locator('.basehalf-markdown-rich-context-menu button', { hasText: /^Paste$/ });
	await pasteButton.waitFor({ state: 'visible', timeout: 5_000 });
	await pasteButton.click();

	const deadline = Date.now() + 15_000;
	while ((await frame.locator('.bn-block-content strong', { hasText: 'Smoke editable quote' }).count()) < 2) {
		if (Date.now() > deadline) {
			throw new Error('Context menu paste did not reproduce the copied rich formatting');
		}
		await page.waitForTimeout(150);
	}
}

async function assertMarkdownRichCompositionDefersAutosave(page) {
	const marker = `imemark${Date.now()}`;
	const readmePath = path.join(workspacePath, 'README.md');
	const frame = await activeMarkdownRichFrame(page);
	const target = frame.locator('.bn-block-content', { hasText: 'External merge target paragraph' }).first();
	await target.click();
	await page.keyboard.press('End');

	await dispatchMarkdownRichComposition(frame, 'compositionstart');
	await page.keyboard.insertText(` ${marker}`);
	await page.waitForTimeout(2_500);
	if (fs.readFileSync(readmePath, 'utf8').includes(marker)) {
		throw new Error('Autosave serialized the document mid-composition');
	}

	await dispatchMarkdownRichComposition(frame, 'compositionend');
	await waitUntil(() => fs.readFileSync(readmePath, 'utf8').includes(marker), 'post-composition autosave to persist', 15_000);
}

async function assertMarkdownRichCompositionQueuesSingleUndo(page) {
	const marker = `imeundosmoke${Date.now()}`;
	const readmePath = path.join(workspacePath, 'README.md');
	const frame = await activeMarkdownRichFrame(page);
	const target = frame.locator('.bn-block-content', { hasText: 'External merge target paragraph' }).first();
	await target.click();
	await page.keyboard.press('End');

	await dispatchMarkdownRichComposition(frame, 'compositionstart');
	await page.keyboard.insertText(` ${marker}`);
	await page.keyboard.press(markdownRichUndoRedoKey('undo'));
	if (!(await markdownRichEditorHasText(frame, marker))) {
		throw new Error('Undo ran before the active IME composition committed');
	}

	await dispatchMarkdownRichComposition(frame, 'compositionend');
	await page.waitForTimeout(250);
	if (await markdownRichEditorHasText(frame, marker)) {
		throw new Error('The single queued undo did not remove the committed IME edit');
	}
	await page.waitForTimeout(1_800);
	if (fs.readFileSync(readmePath, 'utf8').includes(marker)) {
		throw new Error('The IME edit removed by queued undo was later persisted');
	}
}

async function dispatchMarkdownRichComposition(frame, type) {
	await frame.evaluate(eventType => {
		const active = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
		const target = active?.closest('.ProseMirror[contenteditable="true"], .bn-editor[contenteditable="true"]')
			?? document.querySelector('.ProseMirror[contenteditable="true"], .bn-editor[contenteditable="true"]');
		if (!(target instanceof HTMLElement)) {
			throw new Error('The active rich editor DOM target was unavailable for IME composition');
		}
		target.dispatchEvent(new CompositionEvent(eventType, { bubbles: true, cancelable: true }));
	}, type);
}

async function assertMarkdownRichFileLinkAutocomplete(page) {
	const readmePath = path.join(workspacePath, 'README.md');
	const frame = await activeMarkdownRichFrame(page);
	const target = frame.locator('.bn-block-content', { hasText: 'External merge target paragraph' }).first();
	await target.click();
	await page.keyboard.press('End');
	await page.keyboard.type(' [[', { delay: 80 });

	const menu = frame.locator('.bn-suggestion-menu');
	await menu.waitFor({ state: 'visible', timeout: 8_000 });
	await page.keyboard.type('gui', { delay: 80 });
	await frame.locator('.bn-suggestion-menu-item', { hasText: 'guide.md' }).first().waitFor({ state: 'visible', timeout: 8_000 });
	await page.keyboard.press('Enter');

	const deadline = Date.now() + 15_000;
	while ((await frame.locator('.bn-block-content a', { hasText: 'guide.md' }).count()) === 0) {
		if (Date.now() > deadline) {
			throw new Error('File link autocomplete did not insert a link');
		}
		await page.waitForTimeout(150);
	}
	await waitUntil(
		() => fs.readFileSync(readmePath, 'utf8').split('](docs/guide.md)').length >= 3,
		'the picked file link to persist as relative Markdown',
		15_000
	);
}

async function assertMarkdownRichFileAttachment(page) {
	const readmePath = path.join(workspacePath, 'README.md');
	const attachmentPath = path.join(workspacePath, 'attachments', 'handout.pdf');
	let frame = await activeMarkdownRichFrame(page);
	const target = frame.locator('.bn-block-content').last();
	await target.click();
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
	await page.keyboard.type('/file', { delay: 70 });
	const item = frame.locator('.bn-suggestion-menu-item', { hasText: 'File' }).first();
	await item.waitFor({ state: 'visible', timeout: 8_000 });
	await item.click();

	const addFile = frame.locator('.bn-add-file-button').last();
	await addFile.waitFor({ state: 'visible', timeout: 8_000 });
	await addFile.click();
	const input = frame.locator('.bn-file-input input[type="file"], input[type="file"]').last();
	await input.waitFor({ state: 'attached', timeout: 8_000 });
	await input.setInputFiles({
		name: 'handout.pdf',
		mimeType: 'application/pdf',
		buffer: createMinimalPdfFixture()
	});

	await waitUntil(() => fs.existsSync(attachmentPath), 'the inserted attachment to be written beside the document', 15_000);
	await waitUntil(
		() => fs.readFileSync(readmePath, 'utf8').includes('[handout.pdf](attachments/handout.pdf)'),
		'the inserted attachment to persist as a relative Markdown file link',
		15_000
	);

	// Close the live YJS projection and rebuild it from Markdown truth. A
	// standalone attachment link must come back as a first-class file block,
	// not regress into an ordinary blue paragraph link.
	await closeCardDetailIfOpen(page);
	await quickOpen(page, 'README.md');
	frame = await activeMarkdownRichFrame(page);
	const attachment = frame.locator('.bn-file-name-with-icon', { hasText: 'handout.pdf' }).last();
	await attachment.waitFor({ state: 'visible', timeout: 15_000 });
	await attachment.click();
	if (await frame.locator('[data-test="fileDownloadButton"]').count() > 0) {
		throw new Error('The stock BlockNote download action leaked into BaseHalf file semantics');
	}

	// Opening an attachment stays in the canvas/card-detail flow. Direct-render
	// binary media intentionally has no raw Source projection.
	await attachment.dblclick();
	await assertPdfCardDetail(page, 'handout.pdf');
	if (await page.locator('.basehalf-card-detail-projection[aria-label="Source"]').count() > 0) {
		throw new Error('A binary PDF exposed the raw Source projection');
	}

	// Return through the product's own history so this probe does not leave a
	// duplicate README entry in the surrounding navigation stack.
	await clickCommandCenterNavigationButton(page, 'arrow-left', 'Go Back');
	await assertCardDetail(page, 'README.md');
	frame = await activeMarkdownRichFrame(page);
	await frame.locator('.bn-file-name-with-icon', { hasText: 'handout.pdf' }).last().waitFor({ state: 'visible', timeout: 15_000 });
}

function createMinimalPdfFixture() {
	const stream = 'BT /F1 18 Tf 40 120 Td (BaseHalf PDF smoke) Tj ET';
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
		`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
	];
	let body = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
	const offsets = [0];
	for (let index = 0; index < objects.length; index++) {
		offsets.push(Buffer.byteLength(body, 'binary'));
		body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
	}
	const xref = Buffer.byteLength(body, 'binary');
	body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets.slice(1)) {
		body += `${String(offset).padStart(10, '0')} 00000 n \n`;
	}
	body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(body, 'binary');
}

async function assertMarkdownRichPassthroughEditInSource(page) {
	const frame = await activeMarkdownRichFrame(page);
	const island = frame.locator('.basehalf-raw-passthrough', { hasText: 'raw html island' }).first();
	await island.waitFor({ state: 'visible', timeout: 10_000 });
	// The block cannot be edited here, and it is shown rendered: its element, and not its tags as text.
	const islandShown = await island.evaluate(element => ({
		elements: Array.from(element.querySelectorAll('.basehalf-raw-passthrough-rendered *'), child => child.tagName.toLowerCase()).join(' '),
		text: element.querySelector('.basehalf-raw-passthrough-rendered')?.textContent?.trim()
	}));
	if (islandShown.elements !== 'div' || islandShown.text !== 'raw html island') {
		throw new Error(`A block the rich projection cannot edit must be shown rendered: ${JSON.stringify(islandShown)}`);
	}
	await island.hover();

	const edit = island.locator('.basehalf-raw-passthrough-edit');
	await edit.waitFor({ state: 'visible', timeout: 5_000 });
	await edit.click();

	// The card reopens in the source projection with the island's line selected.
	const sourceEditor = page.locator('.basehalf-card-detail-source-editor .monaco-editor');
	await sourceEditor.waitFor({ state: 'visible', timeout: 15_000 });
	// The whole block tile is selected; the cursor sits at the selection end,
	// which may include the tile's trailing blank line. Monaco marks the
	// cursor's line number as the active one.
	const islandLine = lineNumberForText('README.md', 'smoke-raw-island');
	await page.waitForFunction(({ first, last }) => {
		const active = document.querySelector('.basehalf-card-detail-source-editor .line-numbers.active-line-number');
		const line = Number(active?.textContent?.trim() ?? NaN);
		return line >= first && line <= last;
	}, { first: islandLine, last: islandLine + 1 }, { timeout: 15_000 });

	// Projection changes are view state, not location history. Return through
	// the in-card projection control so Back remains reserved for visited places.
	await page.locator('.basehalf-card-detail-projection[title="Rich"]').click();
	await activeMarkdownRichFrame(page);
}

async function assertMarkdownRichMenuUndoRoutesToEditor(page) {
	if (process.platform !== 'darwin') {
		return;
	}

	const marker = `menu undo smoke ${Date.now()}`;
	const readmePath = path.join(workspacePath, 'README.md');
	const frame = await activeMarkdownRichFrame(page);
	await typeMarkdownRichMarker(page, frame, marker);

	const clickMenuUndo = () => app.evaluate(({ Menu, BrowserWindow }) => {
		const editMenu = Menu.getApplicationMenu()?.items.find(item => item.label === 'Edit');
		const undoItem = editMenu?.submenu?.items.find(item => item.label === 'Undo');
		if (!undoItem) {
			throw new Error('Edit > Undo menu item was not found');
		}
		const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
		// Programmatic MenuItem.click forwards (event, window, webContents) to
		// the app's click handler, which reads event.triggeredByAccelerator.
		(undoItem.click as (event: object, window: unknown, webContents: unknown) => void)(
			{ triggeredByAccelerator: false },
			window,
			window?.webContents
		);
	});

	// The menubar deliberately drops actions when no window holds OS focus
	// (substrate behavior); parallel work on the machine can steal focus from
	// the test app, so take it back before each menu click.
	const focusWindow = () => app.evaluate(({ app: electronApp, BrowserWindow }) => {
		electronApp.focus({ steal: true });
		(BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0])?.focus();
	});

	await focusWindow();
	await page.waitForTimeout(150);
	await clickMenuUndo();
	await page.waitForTimeout(250);
	if (await markdownRichEditorHasText(frame, marker)) {
		throw new Error('A single Edit > Undo did not reach the rich editor');
	}
	await waitUntil(() => !fs.readFileSync(readmePath, 'utf8').includes(marker), 'menu undo to persist the marker removal', 15_000);
}

async function activeMarkdownRichFrame(page, ownerSelector) {
	const started = Date.now();
	let lastFrameUrls = [];
	while (Date.now() - started < 20_000) {
		const frames = page.frames();
		lastFrameUrls = frames.map(frame => frame.url()).filter(Boolean);
		for (const frame of frames) {
			const editorCount = await frame.locator('.basehalf-markdown-rich.ready .bn-editor').count().catch(() => 0);
			if (editorCount > 0 && await markdownRichFrameBelongsTo(frame, ownerSelector)) {
				return frame;
			}
		}
		await page.waitForTimeout(100);
	}

	throw new Error(`Markdown rich editor webview was not ready. Frames: ${lastFrameUrls.join(', ')}`);
}

async function markdownRichEditorFrameCount(page, ownerSelector) {
	const counts = await Promise.all(page.frames().map(async frame => {
		if (!await markdownRichFrameBelongsTo(frame, ownerSelector)) {
			return 0;
		}
		return frame.locator('.basehalf-markdown-rich.ready .bn-editor').count().catch(() => 0);
	}));
	return counts.reduce((total, count) => total + count, 0);
}

async function markdownRichFrameBelongsTo(frame, ownerSelector) {
	if (!ownerSelector) {
		return true;
	}
	let ownerFrame = frame;
	const mainFrame = frame.page().mainFrame();
	while (ownerFrame.parentFrame() && ownerFrame.parentFrame() !== mainFrame) {
		ownerFrame = ownerFrame.parentFrame();
	}
	const frameElement = await ownerFrame.frameElement().catch(() => undefined);
	return frameElement
		? frameElement.evaluate((element, selector) => element.closest(selector) !== null, ownerSelector).catch(() => false)
		: false;
}

async function assertSourceCardFlushesBeforeNavigation(page) {
	const marker = 'export const sourceFlushSmoke = true;';
	const appPath = path.join(workspacePath, 'src', 'app.ts');
	await page.locator('.basehalf-card-detail-source-editor .monaco-editor').click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
	await page.keyboard.insertText(`\n${marker}\n`);

	// The fixture workspace parks delay-based auto-save beyond the test
	// timeouts, so the ONLY thing that can put the marker on disk below is
	// the flush-before-navigation gate this step exists to prove.
	if (fs.readFileSync(appPath, 'utf8').includes(marker)) {
		throw new Error('Marker reached disk before navigation — the fixture auto-save override is not in effect and this step cannot prove the navigation flush');
	}

	await quickOpen(page, 'README.md');
	await waitUntil(() => fs.readFileSync(appPath, 'utf8').includes(marker), 'source card detail to flush before navigation');
}

async function assertSourceCardSaveActionHidden(page) {
	await page.locator('.basehalf-card-detail-source-editor .monaco-editor').waitFor({ state: 'visible', timeout: 15_000 });
	const sourceActionsCount = await page.locator('.basehalf-card-detail-source-actions').count();
	if (sourceActionsCount !== 0) {
		throw new Error(`Source card detail should not render a dedicated save actions container, count=${sourceActionsCount}`);
	}

	const saveButtonCount = await page.locator(
		'.basehalf-card-detail-actions .basehalf-card-detail-source-save, .basehalf-card-detail-actions button[aria-label="Save"], .basehalf-card-detail-actions button[title="Save"]'
	).count();
	if (saveButtonCount !== 0) {
		throw new Error(`Source card detail should not expose a manual Save button, count=${saveButtonCount}`);
	}
}

// Search navigation reveals the matched block in the rich projection: the
// block holding the needle carries the transient reveal highlight.
async function assertMarkdownRichRevealsText(page, needle) {
	const frame = await activeMarkdownRichFrame(page);
	await frame.waitForFunction(text => Array.from(document.querySelectorAll('.basehalf-markdown-rich-selection-reveal'))
		.some(block => block.textContent?.includes(text)), needle, { timeout: 10_000 });
}

function lineNumberForText(relativePath, needle) {
	const filePath = path.join(workspacePath, ...relativePath.split('/'));
	const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
	const index = lines.findIndex(line => line.includes(needle));
	if (index < 0) {
		throw new Error(`Did not find ${needle} in ${relativePath}`);
	}
	return index + 1;
}

function isTransparentCssColor(value) {
	if (!value || value === 'transparent') {
		return true;
	}
	const match = /^rgba?\(([^)]+)\)$/.exec(value);
	if (!match) {
		return false;
	}
	const parts = match[1].split(',').map(part => Number(part.trim()));
	return parts.length === 4 && parts[3] === 0;
}

async function waitUntil(predicate, description, timeoutMs = 10_000) {
	const started = Date.now();
	let lastError;
	while (Date.now() - started < timeoutMs) {
		try {
			if (predicate()) {
				return;
			}
		} catch (error) {
			lastError = error;
		}
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw new Error(`Timed out waiting for ${description}${lastError instanceof Error ? `; last observation failed: ${lastError.message}` : ''}`);
}

function readCanvasCardNumber(canvas, cardPath, field) {
	const match = new RegExp(`- path: "${escapeRegExp(cardPath)}"[\\s\\S]*?\\n    ${escapeRegExp(field)}: (-?\\d+(?:\\.\\d+)?)`).exec(canvas);
	return match ? Number(match[1]) : undefined;
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function writeFailureArtifacts(error) {
	console.error(`[basehalf-smoke] failed: ${error?.stack || error}`);
	console.error(`[basehalf-smoke] runRoot: ${runRoot}`);

	if (!app) {
		return;
	}

	const pages = app.windows();
	if (pages.length === 0) {
		return;
	}

	fs.mkdirSync(logsPath, { recursive: true });
	for (let index = 0; index < pages.length; index++) {
		const page = pages[index];
		const artifactName = index === 0 ? 'failure' : `failure-window-${index + 1}`;
		await page.screenshot({ path: path.join(logsPath, `${artifactName}.png`), fullPage: true }).catch(() => undefined);
		const html = await page.locator('html').evaluate(element => element.outerHTML).catch(() => undefined);
		if (html) {
			fs.writeFileSync(path.join(logsPath, `${artifactName}.html`), html, 'utf8');
		}
	}
}

async function closeElectronApplication(application, timeoutMs = 15_000) {
	const pid = application.process().pid;
	let timeoutHandle;
	try {
		await Promise.race([
			application.close(),
			new Promise((_, reject) => {
				timeoutHandle = setTimeout(
					() => reject(new Error(`Electron did not close within ${timeoutMs}ms`)),
					timeoutMs
				);
			}),
		]);
	} catch (error) {
		console.error(`[basehalf-smoke] graceful Electron shutdown failed; forcing process-tree cleanup: ${error instanceof Error ? error.message : String(error)}`);
		if (pid) {
			try {
				forceKillProcessTree(pid);
			} catch (killError) {
				console.error(`[basehalf-smoke] forced Electron cleanup failed: ${killError instanceof Error ? killError.message : String(killError)}`);
			}
		}
	} finally {
		if (timeoutHandle !== undefined) {
			clearTimeout(timeoutHandle);
		}
	}
}

function forceKillProcessTree(pid) {
	if (process.platform === 'win32') {
		execFileSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' });
		return;
	}

	try {
		process.kill(-pid, 'SIGKILL');
	} catch (groupError) {
		try {
			process.kill(pid, 'SIGKILL');
		} catch (processError) {
			if (groupError?.code !== 'ESRCH' || processError?.code !== 'ESRCH') {
				throw processError;
			}
		}
	}
}
