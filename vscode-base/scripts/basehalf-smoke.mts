/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { _electron } from '@playwright/test';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(__dirname);
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const product = JSON.parse(fs.readFileSync(path.join(root, 'product.json'), 'utf8'));

assertProductIdentity();

const opts = parseArgs(process.argv.slice(2));
const runsNewWindowWelcome = !opts.zoomOnly && !opts.canvasOnly && !opts.contentOnly && !opts.pluginOnly && !opts.settingsOnly;
const AGENT_CREATED_CARD_PATH = 'agent-angle.md';
const CANVAS_MALFORMED_EMPHASIS_PARAGRAPH = '曾经繁华的长安，如今已是断壁残垣。宫殿倾颓，街市萧条，只有那巍峨的山河依旧矗立，仿佛在无声地诉说着往日的辉煌。春风吹过，城中的草木却长得异常茂盛**，';
const CANVAS_MALFORMED_EMPHASIS_NEEDLE = '异常茂盛**，';
const SMOKE_VIDEO_PROVIDER_SPEC_ID = 'pointa.basehalf-ai-video.byteplus-modelark';
const SMOKE_VIDEO_MODEL_ID = 'dreamina-seedance-2-0-mini-260615';
const SMOKE_VIDEO_MODEL_LABEL = 'Seedance 2.0 Mini';
const SMOKE_VIDEO_ALTERNATE_MODEL_ID = 'seedance-1-5-pro-251215';
const SMOKE_VIDEO_ALTERNATE_MODEL_LABEL = 'Seedance 1.5 Pro';
const SMOKE_WINDOW_CONTENT_SIZE = Object.freeze({ width: 1280, height: 860 });
const VIDEO_COMPOSER_SCREEN_GAP = 10;
const VIDEO_COMPOSER_SCREEN_WIDTH = 512;
const VIDEO_COMPOSER_SCREEN_HEIGHT = 160;
const VIDEO_COMPOSER_VIEWPORT_MARGIN = 12;
const runRoot = opts.output ?? fs.mkdtempSync(path.join(os.tmpdir(), 'basehalf-smoke-'));
const logsPath = path.join(runRoot, 'logs');
const crashesPath = path.join(runRoot, 'crashes');
const userDataDir = path.join(runRoot, 'user-data');
const sharedDataDir = path.join(runRoot, 'shared-data');
const extensionsDir = path.join(runRoot, 'extensions');
const workspacePath = path.join(runRoot, 'workspace');

for (const dir of [logsPath, crashesPath, userDataDir, sharedDataDir, extensionsDir, workspacePath]) {
	fs.mkdirSync(dir, { recursive: true });
}

// Playwright cannot inspect a native macOS context menu. The smoke profile is
// disposable, so use VS Code's custom renderer here to exercise the same menu
// registrations and commands without changing product settings. Welcome runs
// also force the broader stock startup choice: Folder/Workspace must still
// return to the canvas, while the empty New Window must keep BaseHalf Welcome.
fs.mkdirSync(path.join(userDataDir, 'User'), { recursive: true });
fs.writeFileSync(
	path.join(userDataDir, 'User', 'settings.json'),
	JSON.stringify({
		'window.menuStyle': 'custom',
		...(runsNewWindowWelcome ? { 'workbench.startupEditor': 'welcomePage' } : {})
	}, null, '\t'),
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

const electronPath = getDevElectronPath();

const args = [
	root,
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
	NODE_ENV: 'development',
	// Harness processes (agents, editor terminals) may export this; it would
	// make the dev Electron start as plain node and never open a window.
	ELECTRON_RUN_AS_NODE: undefined,
	VSCODE_DEV: '1',
	VSCODE_CLI: '1',
	BASEHALF_SMOKE_PROVIDER_VALIDATION: '1',
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
		throw new Error(`Dev Electron was not found at ${electronPath}. Run npm run electron or npm run basehalf:smoke first.`);
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
		await step('root-titlebar-breadcrumb', () => assertBaseHalfRootTitlebarBreadcrumb(page));
		await step('canvas-grid-scoped-to-canvas', () => assertCanvasGridScopedToCanvas(page));
	}
		if (!opts.zoomOnly && !opts.pluginOnly && !opts.contentOnly && !opts.settingsOnly) {
		await step('canvas-double-click-create-menu', () => assertCanvasDoubleClickCreateMenu(page));
		await step('canvas-create-result-node-submenu', () => assertCanvasCreateResultNodeSubmenu(page));
		await step('canvas-create-note-file-folder', () => assertCanvasCreateNoteFileAndFolder(page));
		await step('canvas-note-selection-controls', () => assertCanvasNoteInlineWysiwygEditor(page));
	}

		if (opts.settingsOnly) {
			await step('settings-basehalf-category', () => assertBaseHalfSettingsCategory(page));
			await step('global-model-connections-editor', () => assertGlobalModelConnectionsEditor(page));
			console.log(JSON.stringify({
				ok: true,
				workspace: workspacePath,
				checks: ['settings-basehalf-category', 'global-model-connections-editor']
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
				await step('curated-plugin-manager', () => assertCuratedPluginManager(page, true));
				await step('video-workflow-template', () => assertVideoWorkflowTemplate(page));
				await step('video-node-ui', () => assertVideoNodeUI(page));
				await step('video-workflow-node-run', () => assertVideoWorkflowNodeRun(page));
				console.log(JSON.stringify({
					ok: true,
					workspace: workspacePath,
					checks: [
						'video-workflow-template',
						'video-node-ui',
						'video-workflow-node-run',
						'curated-plugin-manager'
					]
				}, null, 2));
			}
		} else if (opts.contentOnly) {
			await step('quick-open-readme', () => quickOpen(page, 'README.md'));
			await step('readme-card-detail', () => assertCardDetail(page, 'README.md'));
			await step('card-detail-focus-document', () => assertCardDetailFocusDocument(page));
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
					'card-detail-focus-document',
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
			await step('canvas-derived-edge-visible', () => assertCanvasEdgeVisible(page, 'docs', 'src'));
			await step('canvas-edge-follows-card-drag-live', () => assertCanvasEdgeFollowsCardDragLive(page));
			await step('canvas-edge-half-reconnect', () => assertCanvasEdgeHalfReconnect(page));
			await step('agent-creates-card', () => assertAgentCreatesCard(page));
			await step('agent-reference-draws-edge', () => assertAgentReferenceDrawsEdge(page));
			await step('edge-delete-scoped-to-canvas', () => assertEdgeDeleteScopedToCanvas(page, AGENT_CREATED_CARD_PATH));
			await step('edge-delete-removes-reference', () => assertEdgeDeleteRemovesReference(page, AGENT_CREATED_CARD_PATH));
			await step('canvas-zoom-controls', () => assertCanvasZoomControls(page));
			await step('canvas-snap-guides', () => assertCanvasSnapGuides(page));
		console.log(JSON.stringify({
			ok: true,
			workspace: workspacePath,
			checks: [
				'fresh-canvas-framed',
				'root-titlebar-breadcrumb',
				'canvas-grid-scoped-to-canvas',
				'canvas-double-click-create-menu',
				'canvas-create-result-node-submenu',
				'canvas-create-note-file-folder',
				'canvas-note-selection-controls',
				'canvas-inline-rename',
				'canvas-card-badge-preview-connectors',
				'canvas-derived-edge-visible',
				'canvas-edge-follows-card-drag-live',
				'canvas-edge-half-reconnect',
				'agent-creates-card',
					'agent-reference-draws-edge',
					'edge-delete-scoped-to-canvas',
					'edge-delete-removes-reference',
					'canvas-zoom-controls',
					'canvas-snap-guides'
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

		await step('canvas-card-badge-preview-connectors', () => assertCanvasCardBadgePreviewAndConnectors(page));
		await step('canvas-derived-edge-visible', () => assertCanvasEdgeVisible(page, 'docs', 'src'));
		await step('canvas-edge-follows-card-drag-live', () => assertCanvasEdgeFollowsCardDragLive(page));
		await step('canvas-edge-half-reconnect', () => assertCanvasEdgeHalfReconnect(page));
		await step('agent-creates-card', () => assertAgentCreatesCard(page));
		await step('agent-reference-draws-edge', () => assertAgentReferenceDrawsEdge(page));
		await step('edge-delete-scoped-to-canvas', () => assertEdgeDeleteScopedToCanvas(page, AGENT_CREATED_CARD_PATH));
		await step('edge-delete-removes-reference', () => assertEdgeDeleteRemovesReference(page, AGENT_CREATED_CARD_PATH));
		await step('canvas-snap-guides', () => assertCanvasSnapGuides(page));
	await step('canvas-scroll-before-card-detail', () => scrollCanvasWorkbenchForCardDetail(page));
	await step('quick-open-readme', () => quickOpen(page, 'README.md'));
	await step('readme-card-detail', () => assertCardDetail(page, 'README.md'));
	await step('readme-titlebar-breadcrumbs', () => assertBaseHalfTitlebarBreadcrumbs(page));
	await step('readme-card-detail-compact-header', () => assertCardDetailCompactHeader(page));
	await step('card-detail-focus-document', () => assertCardDetailFocusDocument(page));
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
	await step('workspace-setup-agent-protocol-files', () => assertWorkspaceSetupAgentProtocolFiles());
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
	await step('curated-plugin-manager', () => assertCuratedPluginManager(page, true));
	await step('video-workflow-template', () => assertVideoWorkflowTemplate(page));
	await step('video-node-ui', () => assertVideoNodeUI(page));
	await step('video-workflow-node-run', () => assertVideoWorkflowNodeRun(page));

	await step('quick-text-search-readme-routing', () => quickOpen(page, '%needle-basehalf-routing'));
	await step('quick-text-search-readme-card-detail', () => assertCardDetail(page, 'README.md'));
	await step('quick-text-search-readme-no-editor-tab', () => assertNoEditorTabFor(page, 'README.md'));
	await step('quick-text-search-readme-focus-routing-line', () => assertFocusLine('README.md', lineNumberForText('README.md', 'needle-basehalf-routing')));
	await step('quick-text-search-readme-second', () => quickOpen(page, '%needle-basehalf-second'));
	await step('quick-text-search-readme-second-card-detail', () => assertCardDetail(page, 'README.md'));
	await step('quick-text-search-readme-second-no-editor-tab', () => assertNoEditorTabFor(page, 'README.md'));
	await step('quick-text-search-readme-focus-second-line', () => assertFocusLine('README.md', lineNumberForText('README.md', 'needle-basehalf-second')));
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
	await step('explorer-rename-cascades-mirror', () => assertExplorerRenameCascadesMirror(page));
	await step('settings-basehalf-category', () => assertBaseHalfSettingsCategory(page));
	await step('readme-badge-closes-on-rich-editor-activation', () => assertBadgeClosesOnRichEditorActivation(page));
	await step('release-notes-system-page', () => assertBaseHalfReleaseNotesSystemPage(page));

	const summary = {
		ok: true,
		workspace: workspacePath,
		checks: [
			'product-identity-basehalf',
			'canvas-visible',
			'new-window-basehalf-welcome',
			'fresh-canvas-framed',
			'root-titlebar-breadcrumb',
			'canvas-grid-scoped-to-canvas',
			'canvas-create-result-node-submenu',
			'canvas-create-note-file-folder',
			'canvas-note-selection-controls',
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
			'canvas-card-badge-preview-connectors',
			'canvas-derived-edge-visible',
			'canvas-edge-follows-card-drag-live',
			'agent-creates-card',
			'agent-reference-draws-edge',
			'edge-delete-scoped-to-canvas',
			'edge-delete-removes-reference',
			'explorer-rename-cascades-mirror',
			'canvas-snap-guides',
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
			'workspace-setup-agent-protocol-files',
			'card-detail-badge-zone',
			'badge-quick-access-note-search',
			'initial-native-back-root-canvas',
			'initial-native-forward-readme-card',
			'quick-open-side-card-detail-no-tab',
			'source-card-save-action-hidden',
			'source-card-detail-flush-on-navigation',
			'media-card-detail-projection-no-tab',
			'video-node-ui',
			'video-workflow-template-node-run',
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
			'badge-closes-on-rich-editor-activation',
			'release-notes-system-page'
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
		output: undefined
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
			case '--help':
				printHelpAndExit();
				break;
			default:
				throw new Error(`Unknown argument: ${arg}`);
		}
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
	  --keep              Keep the generated temporary directory after the run.
	  --zoom-only         Run the lower-left zoom and card-snapping controls slice.
	  --canvas-only       Run the canvas/edge interaction slice without unrelated workbench suites.
  --content-only      Run Card Detail media/PDF rendering and rich attachment integration.
  --plugin-only       Run the curated plugin and AI Video integration slice.
  --settings-only     Run BaseHalf Settings and its Models & Providers section.
  --new-window-only   Open a new empty window and verify the BaseHalf Welcome surface.
  --external-plugin-id <id>
                      Run the reviewed remote-plugin lifecycle slice.
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
	fs.writeFileSync(path.join(workspace, '.vscode', 'settings.json'), JSON.stringify({ 'files.autoSaveDelay': 3_600_000 }, null, '\t'), 'utf8');
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
	fs.writeFileSync(path.join(workspace, 'docs', 'far.md'), '# Far\n\nkeeps the docs canvas taller than the viewport at high zoom\n', 'utf8');
	fs.mkdirSync(path.join(workspace, '.bh', 'mirror', 'README.md'), { recursive: true });
	fs.writeFileSync(path.join(workspace, '.bh', 'mirror', 'README.md', 'badge.yaml'), [
		'path: "README.md"',
		'kind: file',
		'description: "Smoke file badge"',
		'references: []',
		'referenced_by: []',
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
	await assertStockTerminalPanelHidden(page);
	await runCommand(page, 'Toggle Agent Area');
	await page.locator('.basehalf-agent-area').waitFor({ state: 'hidden', timeout: 15_000 });
	await assertStockTerminalPanelHidden(page);
}

async function assertAgentAreaTerminalClipboardPaste(page) {
	const marker = `BH_TYPELESS_PASTE_${Date.now()}`;
	const terminal = page.locator('.basehalf-agent-area-session.active.kind-terminal .xterm').first();
	await terminal.click();
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
			const wrapper = document.querySelector('.basehalf-agent-area-session.active.kind-terminal .terminal-wrapper') as HTMLElement & { xterm?: { buffer?: { active?: { length: number; getLine(index: number): { translateToString(trimRight?: boolean): string } | undefined } } } } | null;
			const buffer = wrapper?.xterm?.buffer?.active;
			if (!buffer) {
				return false;
			}
			for (let index = 0; index < buffer.length; index++) {
				if ((buffer.getLine(index)?.translateToString(true) ?? '').includes(expected)) {
					return true;
				}
			}
			return false;
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
	await page.keyboard.insertText(`node -e "console.log('BH_NO_COLOR='+(process.env.NO_COLOR||'<empty>')); console.log('BH_TERM='+process.env.TERM); console.log('BH_COLORTERM='+process.env.COLORTERM); console.log('BH_TERM_PROGRAM='+process.env.TERM_PROGRAM); console.log('BH_FORCE_COLOR='+(process.env.FORCE_COLOR||'<empty>')); console.log('BH_NODE_DISABLE_COLORS='+(process.env.NODE_DISABLE_COLORS||'<empty>')); process.stdout.write('\\x1b[31mBH_RED_SENTINEL\\x1b[0m \\x1b[36mBH_CYAN_SENTINEL\\x1b[0m\\n')"`);
	await page.keyboard.press('Enter');

	await page.waitForFunction(() => {
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
			&& text.includes('BH_TERM_PROGRAM=vscode')
			&& text.includes('BH_FORCE_COLOR=<empty>')
			&& text.includes('BH_NODE_DISABLE_COLORS=<empty>')
			&& text.includes('BH_RED_SENTINEL')
			&& text.includes('BH_CYAN_SENTINEL');
	}, null, { timeout: 20_000 });

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
			&& (text.includes('Reading Mode') || text.includes('basehalf.editor.readingMode'))
			&& !text.includes('basehalf.models.services');
	}, null, { timeout: 20_000 });
}

async function assertGlobalModelConnectionsEditor(page) {
	await runCommand(page, 'Models & Providers');
	const settingsEditor = page.locator('.settings-editor').first();
	await settingsEditor.waitFor({ state: 'visible', timeout: 20_000 });
	const editor = settingsEditor.locator('.basehalf-model-connections').first();
	await editor.waitFor({ state: 'visible', timeout: 20_000 });
	await editor.locator('h1', { hasText: /^Models & Providers$/ }).waitFor({ state: 'visible', timeout: 15_000 });
	const selectedTocEntry = settingsEditor.locator('.settings-toc-container .monaco-list-row.selected .settings-toc-entry', { hasText: /^Models & Providers$/ });
	await selectedTocEntry.waitFor({ state: 'visible', timeout: 15_000 });
	if (await page.locator('.quick-input-widget:visible').count() !== 0) {
		throw new Error('Models & Providers remained inside QuickInput instead of opening inside Settings');
	}
	const copy = ((await editor.textContent()) ?? '').replace(/\s+/g, ' ').trim();
	if (copy.includes('Add Model Service')
		|| copy.includes('Endpoint')
		|| copy.includes('Provider ID')
		|| copy.includes('Deployment ID')
		|| copy.includes('Authorization')) {
		throw new Error(`Models & Providers exposed the retired generic connection contract: ${copy}`);
	}
	const providerRows = editor.locator('.basehalf-model-provider-row');
	if (await providerRows.count() > 0) {
		const firstRow = providerRows.first();
		if (await firstRow.getAttribute('data-provider-id') !== 'byteplus'
			|| await firstRow.getAttribute('data-connection-state') !== 'locked'
			|| await firstRow.locator('.basehalf-model-provider-status').getAttribute('aria-label') !== 'Locked') {
			throw new Error('The Models & Providers list is not backed by official declarative contracts');
		}
		await firstRow.getByText('BytePlus', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
		await editor.locator('.basehalf-model-connection-detail-copy p', { hasText: /^2 video models$/ }).waitFor({ state: 'visible', timeout: 10_000 });
		await firstRow.focus();
		await firstRow.press('ArrowDown');
		const secondRow = editor.locator('.basehalf-model-provider-row[aria-current="page"][data-provider-id="minimax"]');
		await secondRow.waitFor({ state: 'visible', timeout: 10_000 });
		await secondRow.press('Home');
		await editor.locator('.basehalf-model-provider-row[aria-current="page"][data-provider-id="byteplus"]').waitFor({ state: 'visible', timeout: 10_000 });
	} else {
		await editor.getByText('No official model providers are available.', { exact: false }).waitFor({ state: 'visible', timeout: 15_000 });
	}
	if (await editor.locator('button[data-action="close"]').count() !== 0) {
		throw new Error('Models & Providers retained its retired standalone-editor close action');
	}
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+W' : 'Control+W');
	await editor.waitFor({ state: 'hidden', timeout: 15_000 });
}

async function assertCuratedPluginManager(page, installIfAvailable = false) {
	const pluginsAction = page.locator([
		'.part.activitybar .action-label[aria-label^="Plugins"]',
		'.part.activitybar .action-label.codicon-extensions',
		'.part.sidebar .composite-bar .action-label[aria-label^="Plugins"]',
		'.part.sidebar .composite-bar .action-label.codicon-extensions'
	].join(', ')).first();
	await pluginsAction.waitFor({ state: 'visible', timeout: 15_000 });
	if (await page.locator('.part.sidebar .sidebar-utility-footer').count()) {
		throw new Error('The retired custom sidebar plugin footer is still mounted');
	}
	await pluginsAction.click();
	await page.locator('.part.sidebar .title-label h2', { hasText: /^Plugins$/ }).waitFor({ state: 'visible', timeout: 15_000 });
	const pluginsView = page.locator('.basehalf-plugins-view').first();
	await pluginsView.waitFor({ state: 'visible', timeout: 15_000 });
	const sidebarRow = pluginsView.locator('[data-extension-id="pointa.basehalf-ai-video"]', { hasText: 'AI Video' }).first();
	await sidebarRow.waitFor({ state: 'visible', timeout: 15_000 });
	const sidebarText = (await pluginsView.textContent()) ?? '';
	if (!sidebarText.includes('starter workflows') || sidebarText.includes('Marketplace')) {
		throw new Error(`The native Plugins view exposed an unexpected catalog: ${sidebarText.replace(/\s+/g, ' ').trim()}`);
	}
	if (!await sidebarRow.locator('.extension-list-item').count()) {
		throw new Error('The Plugins view is not using the native VS Code extension-row renderer');
	}
	await sidebarRow.hover();
	await sidebarRow.locator('.action-label.manage').first().click();
	await page.locator('.context-view .action-label', { hasText: /^Open Details$/ }).waitFor({ state: 'visible', timeout: 15_000 });
	await page.keyboard.press('Escape');
	await sidebarRow.click({ button: 'right' });
	await page.locator('.context-view .action-label', { hasText: /^Open Details$/ }).waitFor({ state: 'visible', timeout: 15_000 });
	await page.keyboard.press('Escape');
	await sidebarRow.click();
	const library = page.locator('.basehalf-plugin-library').first();
	try {
		await library.waitFor({ state: 'visible', timeout: 15_000 });
	} catch (error) {
		const diagnostics = await page.evaluate(() => ({
			notifications: Array.from(document.querySelectorAll('.notifications-toasts, .monaco-dialog-box')).map(element => element.textContent?.replace(/\s+/g, ' ').trim()),
			editorText: document.querySelector('.part.editor')?.textContent?.replace(/\s+/g, ' ').trim(),
			tabs: Array.from(document.querySelectorAll('.part.editor .tab')).map(element => element.textContent?.replace(/\s+/g, ' ').trim())
		}));
		throw new Error(`Plugin Library did not open: ${JSON.stringify(diagnostics)}; ${error}`);
	}
	const row = library.locator('.basehalf-plugin-library-row', { hasText: 'AI Video' }).first();
	await row.waitFor({ state: 'visible', timeout: 15_000 });
	await row.click();
	const allText = (await library.textContent()) ?? '';
	if (!allText.includes('starter workflows')) {
		throw new Error('The Plugin Library did not describe the AI Video domain plugin');
	}
	if (allText.includes('Marketplace')) {
		throw new Error('The Plugin Library exposed a Marketplace product surface');
	}
	if (await visibleQuickInput(page).isVisible().catch(() => false)) {
		throw new Error('Manage Plugins reopened the retired Quick Pick instead of the central Library');
	}
	if (installIfAvailable) {
		const install = library.locator('[data-plugin-action="install"][data-extension-id="pointa.basehalf-ai-video"]').first();
		const enable = library.locator('[data-plugin-action="enable"][data-extension-id="pointa.basehalf-ai-video"]').first();
		const open = library.locator('[data-plugin-action="open"][data-extension-id="pointa.basehalf-ai-video"]').first();
		if (await install.isVisible({ timeout: 2_000 }).catch(() => false)) {
			await install.click();
			await open.waitFor({ state: 'visible', timeout: 60_000 });
		} else if (await enable.isVisible({ timeout: 2_000 }).catch(() => false)) {
			await enable.click();
			await runNativePluginRuntimeActionIfVisible(page, library);
			await open.waitFor({ state: 'visible', timeout: 15_000 });
		} else if (!await open.isVisible({ timeout: 2_000 }).catch(() => false)) {
			const diagnostics = await library.locator('[data-plugin-action]').evaluateAll(elements => elements.map(element => ({
				action: (element as HTMLElement).dataset.pluginAction,
				extensionId: (element as HTMLElement).dataset.extensionId,
				text: element.textContent?.trim()
			})));
			throw new Error(`The curated plugin exposed neither Install nor Open in the central Library: ${JSON.stringify(diagnostics)}; ${(await library.textContent())?.replace(/\s+/g, ' ').trim()}`);
		}
	}
	const selectedPluginsAction = page.locator([
		'.part.activitybar .action-item.checked .action-label[aria-label^="Plugins"]',
		'.part.activitybar .action-item.checked .action-label.codicon-extensions',
		'.part.sidebar .composite-bar .action-item.checked .action-label[aria-label^="Plugins"]',
		'.part.sidebar .composite-bar .action-item.checked .action-label.codicon-extensions'
	].join(', ')).first();
	await selectedPluginsAction.waitFor({ state: 'visible', timeout: 15_000 });
	await assertNoEditorTabFor(page, 'Plugins');
	await library.locator('[data-action="close"]').click();
	await library.waitFor({ state: 'detached', timeout: 15_000 });
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
	await page.locator('.basehalf-card-detail-title', { hasText: 'README.md' }).waitFor({ state: 'visible', timeout: 20_000 });
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

async function assertBaseHalfReleaseNotesSystemPage(page) {
	await runCommand(page, 'Show Release Notes');
	const frame = await activeReleaseNotesFrame(page);
	await frame.locator('body', { hasText: 'BaseHalf is moving onto a real VS Code substrate' }).waitFor({ state: 'visible', timeout: 20_000 });
	await frame.locator('body', { hasText: 'Release Notes open as a system page' }).waitFor({ state: 'visible', timeout: 20_000 });
	await assertNoEditorTabFor(page, 'Release Notes');
	if (await page.locator('.basehalf-command-center-breadcrumbs').isVisible().catch(() => false)) {
		throw new Error('BaseHalf file breadcrumbs remained visible over a system page');
	}
}

async function activeReleaseNotesFrame(page) {
	const started = Date.now();
	let lastFrameUrls = [];
	while (Date.now() - started < 20_000) {
		const frames = page.frames();
		lastFrameUrls = frames.map(frame => frame.url()).filter(Boolean);
		for (const frame of frames) {
			const hasReleaseNotes = await frame.locator('body', { hasText: 'BaseHalf is moving onto a real VS Code substrate' }).count().catch(() => 0);
			if (hasReleaseNotes > 0) {
				return frame;
			}
		}
		await page.waitForTimeout(100);
	}

	throw new Error(`BaseHalf Release Notes webview was not ready. Frames: ${lastFrameUrls.join(', ')}`);
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

async function assertCardDetail(page, title) {
	await page.locator('.basehalf-card-detail.visible').waitFor({ state: 'visible', timeout: 20_000 });
	await page.locator('.basehalf-card-detail-title', { hasText: title }).waitFor({ state: 'visible', timeout: 20_000 });
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

async function assertCardDetailFocusDocument(page) {
	const action = page.locator('.basehalf-card-detail-focus');
	const sideBar = page.locator('[id="workbench.parts.sidebar"]');
	await action.waitFor({ state: 'visible', timeout: 8_000 });
	const initiallyVisible = await sideBar.isVisible();

	await action.click();
	await sideBar.waitFor({ state: initiallyVisible ? 'hidden' : 'visible', timeout: 8_000 });
	if (await action.getAttribute('aria-pressed') !== String(initiallyVisible)) {
		throw new Error('The document focus action did not mirror sidebar visibility');
	}

	// The action is an explicit view toggle, so leave the disposable smoke
	// profile in exactly the state in which the learner entered Card Detail.
	await action.click();
	await sideBar.waitFor({ state: initiallyVisible ? 'visible' : 'hidden', timeout: 8_000 });
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

async function assertPdfGrowsThreeBranches(page) {
	const sourcePath = path.join(workspacePath, 'docs', 'textbook.pdf');
	const sourceBadgePath = path.join(workspacePath, '.bh', 'mirror', 'docs', 'textbook.pdf', 'badge.yaml');
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

		const targetBadgePath = path.join(workspacePath, '.bh', 'mirror', 'docs', name, 'badge.yaml');
		await waitUntil(() => fs.existsSync(sourceBadgePath) && fs.existsSync(targetBadgePath), `${name} badge endpoints to be written`, 15_000);
		const sourceBadge = fs.readFileSync(sourceBadgePath, 'utf8');
		const targetBadge = fs.readFileSync(targetBadgePath, 'utf8');
		if (!sourceBadge.includes(`docs/${name}`) || !targetBadge.includes('docs/textbook.pdf')) {
			throw new Error(`${name} did not persist the two-sided PDF context-flow reference`);
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
		'shots/shot-01/storyboard-frame.bhnode',
		'shots/shot-01/audio-plan.bhnode',
		'shots/shot-01/clip-plan.bhnode',
		'shots/shot-01/audio.bhnode',
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
		'storyboard-frame.bhnode',
		'audio-plan.bhnode',
		'clip-plan.bhnode',
		'audio.bhnode',
		'clip.bhnode'
	]) {
		await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${workflowName}/shots/shot-01/${relativePath}"]`).waitFor({ state: 'attached', timeout: 15_000 });
	}
	const frameNode = JSON.parse(fs.readFileSync(path.join(workflowRoot, 'shots/shot-01/storyboard-frame.bhnode'), 'utf8'));
	if (frameNode.version !== 3
		|| frameNode.kind !== 'image'
		|| frameNode.recipe?.recipeId !== 'pointa.basehalf-ai-video.storyboard-frame'
		|| frameNode.recipe?.inputBindings?.[0]?.sourcePath !== `${workflowName}/shots/shot-01/storyboard.md`) {
		throw new Error(`The starter workflow did not produce a host-owned executable node: ${JSON.stringify(frameNode)}`);
	}
}

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

async function captureVideoAttachedChrome(page, canvasPath) {
	// A deliberate pane pan may move the upper toolbar beyond the viewport while
	// the Composer remains partially visible. Stabilize every mounted surface,
	// then let the caller decide whether its context requires the toolbar too.
	await waitForAdjacentChromeAnimations(page);
	return page.evaluate(path => {
		const card = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"]`);
		const caption = card?.querySelector('.basehalf-canvas-card-caption');
		const node = card?.closest('.react-flow__node');
		const composer = document.querySelector(`.basehalf-video-composer[data-node-path="${CSS.escape(path)}"]`);
		const portal = composer?.closest('.basehalf-canvas-video-composer-surface');
		const canvas = document.querySelector('.basehalf-canvas-cards');
		const viewport = document.querySelector('.react-flow__viewport');
		if (!(card instanceof HTMLElement)
			|| !(caption instanceof HTMLElement)
			|| !(node instanceof HTMLElement)
			|| !(composer instanceof HTMLElement)
			|| !(portal instanceof HTMLElement)
			|| !(canvas instanceof HTMLElement)
			|| !(viewport instanceof HTMLElement)) {
			throw new Error(`Missing attached Video chrome for ${path}`);
		}
		const rect = value => {
			const bounds = value.getBoundingClientRect();
			return {
				left: bounds.left,
				top: bounds.top,
				right: bounds.right,
				bottom: bounds.bottom,
				width: bounds.width,
				height: bounds.height
			};
		};
		const visible = value => {
			if (!(value instanceof HTMLElement) || value.getClientRects().length === 0) {
				return false;
			}
			for (let current = value; current instanceof HTMLElement; current = current.parentElement) {
				const style = getComputedStyle(current);
				if (style.display === 'none'
					|| style.visibility === 'hidden'
					|| Number.parseFloat(style.opacity || '1') <= 0.01) {
					return false;
				}
			}
			return true;
		};
		const chrome = value => {
			if (!(value instanceof HTMLElement)) {
				return undefined;
			}
			const style = getComputedStyle(value);
			const parseTimes = raw => raw.split(',').map(part => {
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
				state: value.dataset.chromeState,
				placement: value.dataset.placement,
				ariaHidden: value.getAttribute('aria-hidden'),
				inert: value.inert,
				opacity: Number.parseFloat(style.opacity || '1'),
				visibility: style.visibility,
				pointerEvents: style.pointerEvents,
				translate: style.translate,
				translateY: translateNumbers.length >= 2 ? translateNumbers[1] : 0,
				scale: style.scale,
				zoom: Number.parseFloat(style.getPropertyValue('--basehalf-canvas-zoom')) || 1,
				travel: Number.parseFloat(style.getPropertyValue('--basehalf-adjacent-chrome-travel')) || 0,
				transitionDuration: style.transitionDuration,
				transitionDelay: style.transitionDelay,
				transitionProperty: style.transitionProperty,
				translateTransitionMs: translateTiming.duration,
				visibilityTransitionMs: visibilityTiming.duration,
				visibilityTransitionDelayMs: visibilityTiming.delay,
				opacityTransitionMs: opacityTiming.duration,
				animationName: style.animationName,
				animationDuration: style.animationDuration,
				visible: visible(value)
			};
		};
		const toolbar = document.querySelector(`.basehalf-video-context-toolbar[data-node-path="${CSS.escape(path)}"]`);
		const popover = Array.from(composer.querySelectorAll('.basehalf-video-composer-popover'))
			.find(candidate => visible(candidate));
		const prompt = composer.querySelector('textarea.basehalf-video-prompt, .basehalf-video-prompt-copy');
		const selectedNodes = Array.from(document.querySelectorAll('.react-flow__node.selected'));
		const viewportMatrix = new DOMMatrixReadOnly(getComputedStyle(viewport).transform);
		return {
			card: rect(card),
			caption: rect(caption),
			composer: rect(composer),
			portal: rect(portal),
			canvas: rect(canvas),
			toolbar: toolbar instanceof HTMLElement ? rect(toolbar) : undefined,
			toolbarChrome: chrome(toolbar),
			portalChrome: chrome(portal),
			portalDataVisible: portal.dataset.visible === 'true',
			popover: popover instanceof HTMLElement ? rect(popover) : undefined,
			placement: composer.dataset.placement ?? portal.dataset.placement,
			popoverPlacement: popover instanceof HTMLElement ? popover.dataset.popoverPlacement : undefined,
			viewportTransform: getComputedStyle(viewport).transform,
			zoom: viewportMatrix.a || 1,
			composerIdentity: composer.dataset.smokeVideoComposerIdentity,
			portalIdentity: portal.dataset.smokeVideoComposerPortalIdentity,
			toolbarIdentity: toolbar instanceof HTMLElement ? toolbar.dataset.smokeVideoToolbarIdentity : undefined,
			promptIdentity: prompt instanceof HTMLElement ? prompt.dataset.smokeVideoPromptIdentity : undefined,
			promptValue: prompt instanceof HTMLTextAreaElement ? prompt.value : prompt?.textContent ?? '',
			promptSelectionStart: prompt instanceof HTMLTextAreaElement ? prompt.selectionStart : undefined,
			promptSelectionEnd: prompt instanceof HTMLTextAreaElement ? prompt.selectionEnd : undefined,
			composerCount: document.querySelectorAll(`.basehalf-video-composer[data-node-path="${CSS.escape(path)}"]`).length,
			portalCount: document.querySelectorAll('.basehalf-canvas-video-composer-surface').length,
			toolbarCount: document.querySelectorAll(`.basehalf-video-context-toolbar[data-node-path="${CSS.escape(path)}"]`).length,
			visibleComposerCount: Array.from(document.querySelectorAll('.basehalf-video-composer')).filter(candidate => visible(candidate)).length,
			visibleToolbarCount: Array.from(document.querySelectorAll('.basehalf-video-context-toolbar')).filter(candidate => visible(candidate)).length,
			visibleAdjacentChromeCount: Array.from(document.querySelectorAll('.basehalf-canvas-adjacent-chrome')).filter(candidate => visible(candidate)).length,
			visiblePopoverCount: Array.from(composer.querySelectorAll('.basehalf-video-composer-popover')).filter(candidate => visible(candidate)).length,
			portalOwnsComposer: portal.contains(composer),
			contextViewOwnsComposer: composer.closest('.context-view') !== null,
			selected: selectedNodes.length === 1 && selectedNodes[0] === node,
			nodeDragging: node.classList.contains('dragging'),
			nodeDragChrome: canvas.dataset.nodeDragChrome,
			cardFocused: document.activeElement === card || card.contains(document.activeElement),
			promptFocused: prompt instanceof HTMLElement && document.activeElement === prompt
		};
	}, canvasPath);
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

function assertVideoAdjacentChromeState(snapshot, expectedState, toolbarIdentity, context) {
	assertAdjacentChromeSurfaceState(snapshot.toolbarChrome, expectedState, `${context} (toolbar)`);
	const suppressed = expectedState === 'suppressed';
	const composerStateIsCorrect = snapshot.portalChrome
		&& snapshot.portalChrome.state === (suppressed ? 'manipulating' : 'present')
		&& snapshot.portalChrome.visible
		&& snapshot.portalChrome.visibility === 'visible'
		&& snapshot.portalChrome.pointerEvents === (suppressed ? 'none' : 'auto')
		&& snapshot.portalChrome.ariaHidden === (suppressed ? 'true' : 'false')
		&& snapshot.portalChrome.inert === suppressed;
	if (snapshot.toolbarCount !== 1
		|| snapshot.toolbarIdentity !== toolbarIdentity
		|| snapshot.visibleToolbarCount !== (suppressed ? 0 : 1)
		|| snapshot.visibleComposerCount !== 1
		|| !composerStateIsCorrect
		|| (suppressed
			? snapshot.nodeDragChrome !== 'dragging' && snapshot.nodeDragChrome !== 'settling'
			: snapshot.nodeDragChrome !== undefined)) {
		throw new Error(`Video adjacent chrome broke ${context}: ${JSON.stringify({ expectedState, toolbarIdentity, snapshot })}`);
	}
}

async function waitForVideoAdjacentChromeState(page, canvasPath, expectedState) {
	await page.waitForFunction(({ path, expected }) => {
		const card = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"]`);
		const node = card?.closest('.react-flow__node');
		const canvas = card?.closest('.basehalf-canvas-cards');
		const toolbar = document.querySelector(`.basehalf-video-context-toolbar[data-node-path="${CSS.escape(path)}"]`);
		const composer = document.querySelector(`.basehalf-video-composer[data-node-path="${CSS.escape(path)}"]`);
		const portal = composer?.closest('.basehalf-canvas-video-composer-surface');
		if (!(node instanceof HTMLElement)
			|| !(canvas instanceof HTMLElement)
			|| !(toolbar instanceof HTMLElement)
			|| !(portal instanceof HTMLElement)) {
			return false;
		}
		const suppressed = expected === 'suppressed';
		const matchesToolbar = element => {
			const style = getComputedStyle(element);
			const translateNumbers = style.translate === 'none'
				? []
				: style.translate.match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
			const translateY = translateNumbers.length >= 2 ? translateNumbers[1] : 0;
			const zoom = Number.parseFloat(style.getPropertyValue('--basehalf-canvas-zoom')) || 1;
			const screenTranslateY = translateY * zoom;
			const placement = element.dataset.placement;
			const directionMatches = !suppressed
				? Math.abs(screenTranslateY) <= 0.25
				: (placement === 'above' ? screenTranslateY > 0 : placement === 'below' ? screenTranslateY < 0 : false)
					&& Math.abs(Math.abs(screenTranslateY) - 6) <= 0.75;
			return element.dataset.chromeState === expected
				&& element.inert === suppressed
				&& (suppressed ? element.getAttribute('aria-hidden') === 'true' : element.getAttribute('aria-hidden') !== 'true')
				&& (suppressed ? style.pointerEvents === 'none' : style.pointerEvents !== 'none')
				&& Math.abs(Number.parseFloat(style.opacity || '1') - 1) <= 0.001
				&& style.visibility === (suppressed ? 'hidden' : 'visible')
				&& style.scale === 'none'
				&& directionMatches;
		};
		const portalStyle = getComputedStyle(portal);
		const portalMatches = portal.dataset.chromeState === (suppressed ? 'manipulating' : 'present')
			&& portal.dataset.visible === 'true'
			&& portalStyle.visibility === 'visible'
			&& portal.inert === suppressed
			&& (suppressed ? portal.getAttribute('aria-hidden') === 'true' : portal.getAttribute('aria-hidden') === 'false')
			&& (suppressed ? portalStyle.pointerEvents === 'none' : portalStyle.pointerEvents !== 'none');
		return matchesToolbar(toolbar)
			&& portalMatches
			&& (suppressed
				? node.classList.contains('dragging') && canvas.dataset.nodeDragChrome === 'dragging'
				: !node.classList.contains('dragging') && canvas.dataset.nodeDragChrome === undefined);
	}, { path: canvasPath, expected: expectedState }, { timeout: 10_000 });
	await waitForAdjacentChromeAnimations(page, 2);
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

async function markVideoAttachedChromeIdentity(page, canvasPath, prefix, promptValue) {
	const identity = {
		composer: `${prefix}-composer`,
		portal: `${prefix}-portal`,
		prompt: `${prefix}-prompt`
	};
	await page.locator(`.basehalf-video-composer[data-node-path="${canvasPath}"]`).evaluate((surface, options) => {
		const portal = surface.closest('.basehalf-canvas-video-composer-surface');
		const prompt = surface.querySelector('textarea.basehalf-video-prompt, .basehalf-video-prompt-copy');
		if (!(portal instanceof HTMLElement) || !(prompt instanceof HTMLElement)) {
			throw new Error('The Video Composer has no owned Portal or Prompt projection to identity-check');
		}
		surface.dataset.smokeVideoComposerIdentity = options.identity.composer;
		portal.dataset.smokeVideoComposerPortalIdentity = options.identity.portal;
		prompt.dataset.smokeVideoPromptIdentity = options.identity.prompt;
		if (prompt instanceof HTMLTextAreaElement && options.promptValue !== undefined) {
			prompt.value = options.promptValue;
			prompt.dispatchEvent(new Event('input', { bubbles: true }));
			prompt.focus({ preventScroll: true });
			const start = Math.min(7, prompt.value.length);
			const end = Math.min(Math.max(start + 9, start), prompt.value.length);
			prompt.setSelectionRange(start, end);
		}
	}, { identity, promptValue });
	return identity;
}

function assertVideoComposerState(snapshot, expected, context, expectedChromeState = 'present') {
	const problems = [];
	const suppressed = expectedChromeState === 'suppressed';
	const expectedVisibleComposerCount = snapshot.portalDataVisible ? 1 : 0;
	const expectedCaptionGap = 8 * snapshot.zoom;
	const expectedCaptionHeight = 24 * snapshot.zoom;
	if (Math.abs(snapshot.card.top - snapshot.caption.bottom - expectedCaptionGap) > 2
		|| Math.abs(snapshot.caption.height - expectedCaptionHeight) > 2
		|| Math.abs(snapshot.caption.left - snapshot.card.left) > 2
		|| Math.abs(snapshot.caption.right - snapshot.card.right) > 2) {
		problems.push('external caption is detached from the card frame');
	}
	if (snapshot.composerCount !== 1
		|| snapshot.visibleComposerCount !== expectedVisibleComposerCount
		|| snapshot.portalCount !== 1) {
		problems.push('not exactly one mounted Composer Portal');
	}
	if (!snapshot.portalOwnsComposer || snapshot.contextViewOwnsComposer) {
		problems.push('Composer is not exclusively owned by its node Portal');
	}
	if (!snapshot.selected) {
		problems.push('Video node is not the sole selection');
	}
	if (snapshot.composerIdentity !== expected.composer
		|| snapshot.portalIdentity !== expected.portal
		|| snapshot.promptIdentity !== expected.prompt) {
		problems.push('Composer, Portal, or Prompt DOM identity changed');
	}
	if (expected.promptValue !== undefined && snapshot.promptValue !== expected.promptValue) {
		problems.push('Prompt value changed');
	}
	if (expected.promptSelectionStart !== undefined
		&& (snapshot.promptSelectionStart !== expected.promptSelectionStart || snapshot.promptSelectionEnd !== expected.promptSelectionEnd)) {
		problems.push('Prompt selection changed');
	}
	if (problems.length > 0) {
		throw new Error(`Video Composer state broke ${context}: ${problems.join('; ')} ${JSON.stringify(snapshot)}`);
	}
}

function assertVideoComposerBelowCard(snapshot, context, tolerance = 2) {
	const cardCenter = (snapshot.card.left + snapshot.card.right) / 2;
	const composerCenter = (snapshot.composer.left + snapshot.composer.right) / 2;
	const composerHalfWidth = snapshot.composer.width / 2;
	const minimumCenter = snapshot.canvas.left + VIDEO_COMPOSER_VIEWPORT_MARGIN + composerHalfWidth;
	const maximumCenter = snapshot.canvas.right - VIDEO_COMPOSER_VIEWPORT_MARGIN - composerHalfWidth;
	const expectedCenter = minimumCenter <= maximumCenter
		? Math.min(maximumCenter, Math.max(minimumCenter, cardCenter))
		: (snapshot.canvas.left + snapshot.canvas.right) / 2;
	const belowGap = snapshot.composer.top - snapshot.card.bottom;
	const aboveGap = snapshot.card.top - snapshot.composer.bottom;
	const verticalPlacementIsCorrect = snapshot.placement === 'below'
		? Math.abs(belowGap - VIDEO_COMPOSER_SCREEN_GAP) <= tolerance
		: snapshot.placement === 'above'
			? Math.abs(aboveGap - VIDEO_COMPOSER_SCREEN_GAP) <= tolerance
			: snapshot.placement === 'clamped-below'
				? Math.abs(snapshot.composer.bottom - (snapshot.canvas.bottom - VIDEO_COMPOSER_VIEWPORT_MARGIN)) <= tolerance
				: snapshot.placement === 'clamped-above'
					? Math.abs(snapshot.composer.top - (snapshot.canvas.top + VIDEO_COMPOSER_VIEWPORT_MARGIN)) <= tolerance
					: false;
	if (!verticalPlacementIsCorrect || Math.abs(expectedCenter - composerCenter) > tolerance) {
		throw new Error(`Video Composer detached from the card ${context}: ${JSON.stringify({ belowGap, aboveGap, cardCenter, composerCenter, expectedCenter, snapshot })}`);
	}
}

function assertVideoResultToolbarAboveCard(snapshot, context, tolerance = 2) {
	if (!snapshot.toolbar) {
		throw new Error(`Video Result toolbar disappeared ${context}: ${JSON.stringify(snapshot)}`);
	}
	const cardCenter = (snapshot.card.left + snapshot.card.right) / 2;
	const toolbarCenter = (snapshot.toolbar.left + snapshot.toolbar.right) / 2;
	const gap = snapshot.caption.top - snapshot.toolbar.bottom;
	if (Math.abs(gap - 10) > tolerance || Math.abs(cardCenter - toolbarCenter) > tolerance) {
		throw new Error(`Video Result toolbar detached from the card ${context}: ${JSON.stringify({ gap, cardCenter, toolbarCenter, snapshot })}`);
	}
}

function assertVideoChromeTranslatedTogether(before, after, context, includeToolbar = false, tolerance = 2) {
	const cardDelta = {
		x: after.card.left - before.card.left,
		y: after.card.top - before.card.top
	};
	const composerDelta = {
		x: after.composer.left - before.composer.left,
		y: after.composer.top - before.composer.top
	};
	const captionDelta = {
		x: after.caption.left - before.caption.left,
		y: after.caption.top - before.caption.top
	};
	const sizeDrift = Math.max(
		Math.abs(after.card.width - before.card.width),
		Math.abs(after.card.height - before.card.height),
		Math.abs(after.caption.width - before.caption.width),
		Math.abs(after.caption.height - before.caption.height),
		Math.abs(after.composer.width - before.composer.width),
		Math.abs(after.composer.height - before.composer.height)
	);
	let toolbarDelta;
	if (includeToolbar && before.toolbar && after.toolbar) {
		toolbarDelta = {
			x: after.toolbar.left - before.toolbar.left,
			y: after.toolbar.top - before.toolbar.top
		};
	}
	if (Math.hypot(cardDelta.x, cardDelta.y) < 1
		|| Math.abs(cardDelta.x - composerDelta.x) > tolerance
		|| Math.abs(cardDelta.y - composerDelta.y) > tolerance
		|| Math.abs(cardDelta.x - captionDelta.x) > tolerance
		|| Math.abs(cardDelta.y - captionDelta.y) > tolerance
		|| sizeDrift > tolerance
		|| (includeToolbar && (!toolbarDelta
			|| Math.abs(cardDelta.x - toolbarDelta.x) > tolerance
			|| Math.abs(cardDelta.y - toolbarDelta.y) > tolerance))) {
		throw new Error(`Video attached chrome did not translate with its card ${context}: ${JSON.stringify({ cardDelta, captionDelta, composerDelta, toolbarDelta, sizeDrift, before, after })}`);
	}
}

function assertVideoChromeLayoutUnchanged(before, after, context, includeToolbar = false, tolerance = 1) {
	const drift = (left, right) => Math.max(...['left', 'top', 'right', 'bottom', 'width', 'height']
		.map(key => Math.abs(left[key] - right[key])));
	const composerDrift = drift(before.composer, after.composer);
	const cardDrift = drift(before.card, after.card);
	const captionDrift = drift(before.caption, after.caption);
	const toolbarDrift = includeToolbar && before.toolbar && after.toolbar
		? drift(before.toolbar, after.toolbar)
		: includeToolbar ? Number.POSITIVE_INFINITY : 0;
	if (composerDrift > tolerance
		|| cardDrift > tolerance
		|| captionDrift > tolerance
		|| toolbarDrift > tolerance
		|| after.viewportTransform !== before.viewportTransform) {
		throw new Error(`Video attached chrome moved unexpectedly ${context}: ${JSON.stringify({ composerDrift, cardDrift, captionDrift, toolbarDrift, before, after })}`);
	}
}

async function assertVideoAttachedChromeFollowsPointerDrag(page, { canvasPath, card, expected, includeToolbar = false }) {
	const snapToggle = page.locator('.basehalf-canvas-snap-toggle:visible');
	const snapWasEnabled = await snapToggle.getAttribute('aria-pressed') === 'true';
	if (snapWasEnabled) {
		await snapToggle.evaluate(button => button.click());
		await page.waitForFunction(() => document.querySelector('.basehalf-canvas-snap-toggle')?.getAttribute('aria-pressed') === 'false');
	}
	const start = await page.evaluate(path => {
		const card = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"]`);
		if (!(card instanceof HTMLElement)) {
			throw new Error(`Missing Video card drag surface for ${path}`);
		}
		const rejectedTarget = 'button, input, textarea, select, video, audio, a, [role="button"], [contenteditable="true"], .nodrag, .nopan, .nowheel, .basehalf-canvas-node-resizer-handle, .basehalf-canvas-card-connect-handle';
		for (const selector of ['.basehalf-video-stage', '.basehalf-canvas-card-caption-identity']) {
			const surface = card.querySelector(selector);
			if (!(surface instanceof HTMLElement)) {
				continue;
			}
			const rect = surface.getBoundingClientRect();
			const candidates = [
				{ x: rect.left + rect.width * 0.68, y: rect.top + rect.height * 0.62 },
				{ x: rect.left + rect.width * 0.34, y: rect.top + rect.height * 0.66 },
				{ x: rect.right - 18, y: rect.top + rect.height / 2 },
				{ x: rect.left + 18, y: rect.top + rect.height / 2 }
			];
			for (const candidate of candidates) {
				const hit = document.elementFromPoint(candidate.x, candidate.y);
				const rejected = hit instanceof Element ? hit.closest(rejectedTarget) : null;
				if (!(hit instanceof Element) || !card.contains(hit) || (rejected && card.contains(rejected))) {
					continue;
				}
				return {
					...candidate,
					selector,
					hitTag: hit.tagName,
					hitClass: hit.getAttribute('class') ?? '',
					cardClass: card.className
				};
			}
		}
		throw new Error(`No non-interactive Video drag point exists for ${path}`);
	}, canvasPath);
	const toolbarIdentity = `video-drag-toolbar-${Date.now()}-${Math.random()}`;
	await page.locator(`.basehalf-video-context-toolbar[data-node-path="${canvasPath}"]`).evaluate((toolbar, identity) => {
		toolbar.dataset.smokeVideoToolbarIdentity = identity;
	}, toolbarIdentity);
	await waitForVideoAdjacentChromeState(page, canvasPath, 'present');
	const before = await captureVideoAttachedChrome(page, canvasPath);
	let previous = before;
	assertVideoComposerState(before, expected, 'before pointer-held drag');
	assertVideoAdjacentChromeState(before, 'present', toolbarIdentity, 'before pointer-held drag');
	assertVideoComposerBelowCard(before, 'before pointer-held drag');
	if (includeToolbar) {
		assertVideoResultToolbarAboveCard(before, 'before pointer-held drag');
	}
	const horizontalDirection = (previous.card.left + previous.card.right) / 2 >= (previous.canvas.left + previous.canvas.right) / 2 ? -1 : 1;
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	try {
		for (const [index, delta] of [
			{ x: 22 * horizontalDirection, y: -8 },
			{ x: 45 * horizontalDirection, y: -18 },
			{ x: 70 * horizontalDirection, y: -10 },
			{ x: 94 * horizontalDirection, y: -24 }
		].entries()) {
			await page.mouse.move(start.x + delta.x, start.y + delta.y, { steps: 4 });
			try {
				await page.waitForFunction(({ path, left, top }) => {
					const current = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"]`)?.getBoundingClientRect();
					return current !== undefined
						&& Math.hypot(current.left - left, current.top - top) >= 2;
				}, { path: canvasPath, left: previous.card.left, top: previous.card.top }, { timeout: 10_000 });
			} catch (error) {
				throw new Error(`Pointer-held Video drag did not move its card at step ${index + 1}: ${JSON.stringify({ start, delta, previous })}`, { cause: error });
			}
			await waitForVideoAdjacentChromeState(page, canvasPath, 'suppressed');
			const next = await captureVideoAttachedChrome(page, canvasPath);
			assertVideoComposerState(next, expected, `during pointer-held drag step ${index + 1}`, 'suppressed');
			assertVideoAdjacentChromeState(next, 'suppressed', toolbarIdentity, `during pointer-held drag step ${index + 1}`);
			if (!next.nodeDragging) {
				throw new Error(`Video node moved without retaining its live drag state before pointer-up at step ${index + 1}: ${JSON.stringify({ start, next })}`);
			}
			previous = next;
		}
	} finally {
		await page.mouse.up();
	}
	await page.waitForFunction(path => !document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"]`)?.closest('.react-flow__node')?.classList.contains('dragging'), canvasPath, { timeout: 10_000 });
	if (snapWasEnabled) {
		await snapToggle.click();
		await page.waitForFunction(() => document.querySelector('.basehalf-canvas-snap-toggle')?.getAttribute('aria-pressed') === 'true');
	}
	await waitForVideoAdjacentChromeState(page, canvasPath, 'present');
	const settled = await captureVideoAttachedChrome(page, canvasPath);
	assertVideoComposerState(settled, expected, 'after pointer-held drag');
	assertVideoAdjacentChromeState(settled, 'present', toolbarIdentity, 'after pointer-held drag');
	assertVideoComposerBelowCard(settled, 'after pointer-held drag');
	if (includeToolbar) {
		assertVideoResultToolbarAboveCard(settled, 'after pointer-held drag');
	}
	assertVideoChromeTranslatedTogether(before, settled, 'across pointer-held drag and release', true);
	return settled;
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

async function captureVideoEdgeDropState(page, canvasPath) {
	return page.evaluate(path => {
		const card = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"]`);
		const node = card?.closest('.react-flow__node');
		const canvas = card?.closest('.basehalf-canvas-cards');
		const viewport = canvas?.querySelector('.react-flow__viewport');
		const composer = document.querySelector(`.basehalf-video-composer[data-node-path="${CSS.escape(path)}"]`);
		const portal = composer?.closest('.basehalf-canvas-video-composer-surface');
		const prompt = composer?.querySelector('textarea.basehalf-video-prompt, .basehalf-video-prompt-copy');
		const toolbars = Array.from(document.querySelectorAll(`.basehalf-video-context-toolbar[data-node-path="${CSS.escape(path)}"]`));
		if (!(card instanceof HTMLElement)
			|| !(node instanceof HTMLElement)
			|| !(canvas instanceof HTMLElement)
			|| !(viewport instanceof HTMLElement)
			|| !(composer instanceof HTMLElement)
			|| !(portal instanceof HTMLElement)) {
			throw new Error(`Missing Video edge-drop projection for ${path}`);
		}
		const rect = element => {
			const bounds = element.getBoundingClientRect();
			return {
				left: bounds.left,
				top: bounds.top,
				right: bounds.right,
				bottom: bounds.bottom,
				width: bounds.width,
				height: bounds.height
			};
		};
		const nodeMatrix = new DOMMatrixReadOnly(getComputedStyle(node).transform);
		const portalStyle = getComputedStyle(portal);
		const toolbar = toolbars[0];
		const toolbarStyle = toolbar instanceof HTMLElement ? getComputedStyle(toolbar) : undefined;
		const selected = Array.from(document.querySelectorAll('.react-flow__node.selected'));
		return {
			card: rect(card),
			composer: rect(composer),
			canvas: rect(canvas),
			viewportTransform: getComputedStyle(viewport).transform,
			nodeTransform: getComputedStyle(node).transform,
			flowPosition: { x: nodeMatrix.e, y: nodeMatrix.f },
			cardIdentity: card.dataset.smokeEdgeDropCardIdentity,
			composerIdentity: composer.dataset.smokeVideoComposerIdentity,
			portalIdentity: portal.dataset.smokeVideoComposerPortalIdentity,
			promptIdentity: prompt instanceof HTMLElement ? prompt.dataset.smokeVideoPromptIdentity : undefined,
			selected: selected.length === 1 && selected[0] === node,
			nodeDragging: node.classList.contains('dragging'),
			nodeDragChrome: canvas.dataset.nodeDragChrome,
			toolbarCount: toolbars.length,
			toolbarVisibility: toolbarStyle?.visibility,
			composerDataVisible: portal.dataset.visible === 'true',
			composerPlacement: portal.dataset.placement,
			composerChromeState: portal.dataset.chromeState,
			composerVisibility: portalStyle.visibility,
			composerPointerEvents: portalStyle.pointerEvents,
			composerAriaHidden: portal.getAttribute('aria-hidden'),
			composerInert: portal.inert
		};
	}, canvasPath);
}

async function videoCardDragPoint(page, canvasPath) {
	return page.evaluate(path => {
		const card = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"]`);
		if (!(card instanceof HTMLElement)) {
			throw new Error(`Missing Video drag surface for ${path}`);
		}
		const rejectedTarget = 'button, input, textarea, select, video, audio, a, [role="button"], [contenteditable="true"], .nodrag, .nopan, .nowheel, .basehalf-canvas-node-resizer-handle, .basehalf-canvas-card-connect-handle';
		for (const selector of ['.basehalf-video-stage', '.basehalf-canvas-card-caption-identity']) {
			const surface = card.querySelector(selector);
			if (!(surface instanceof HTMLElement)) {
				continue;
			}
			const bounds = surface.getBoundingClientRect();
			for (const candidate of [
				{ x: bounds.left + bounds.width * 0.62, y: bounds.top + bounds.height * 0.5 },
				{ x: bounds.left + bounds.width * 0.34, y: bounds.top + bounds.height * 0.5 },
				{ x: bounds.left + 18, y: bounds.top + bounds.height * 0.5 },
				{ x: bounds.right - 18, y: bounds.top + bounds.height * 0.5 }
			]) {
				const hit = document.elementFromPoint(candidate.x, candidate.y);
				const rejected = hit instanceof Element ? hit.closest(rejectedTarget) : null;
				if (hit instanceof Element && card.contains(hit) && (!rejected || !card.contains(rejected))) {
					return candidate;
				}
			}
		}
		throw new Error(`No non-interactive Video drag point exists for ${path}`);
	}, canvasPath);
}

async function assertVideoEdgeDropDoesNotPanForAdjacentChrome(page, {
	canvasPath,
	canvasYamlPath,
	expected
}) {
	const snapToggle = page.locator('.basehalf-canvas-snap-toggle:visible');
	const snapWasEnabled = await snapToggle.getAttribute('aria-pressed') === 'true';
	if (snapWasEnabled) {
		await snapToggle.evaluate(button => button.click());
		await page.waitForFunction(() => document.querySelector('.basehalf-canvas-snap-toggle')?.getAttribute('aria-pressed') === 'false');
	}
	const cardIdentity = `video-edge-drop-${Date.now()}-${Math.random()}`;
	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${canvasPath}"]`).evaluate((card, identity) => {
		card.dataset.smokeEdgeDropCardIdentity = identity;
	}, cardIdentity);
	const original = await captureVideoEdgeDropState(page, canvasPath);

	const dragToTop = async (targetTop, expectedChrome, context) => {
		const before = await captureVideoEdgeDropState(page, canvasPath);
		const point = await videoCardDragPoint(page, canvasPath);
		const deltaY = targetTop - before.card.top;
		const end = { x: point.x, y: point.y + deltaY };
		if (end.y < before.canvas.top + 32 || end.y > before.canvas.bottom - 32) {
			throw new Error(`Video ${context} drop point entered the native auto-pan band: ${JSON.stringify({ before, point, end, targetTop })}`);
		}
		const canvasBefore = fs.readFileSync(canvasYamlPath, 'utf8');
		let held;
		await page.mouse.move(point.x, point.y);
		await page.mouse.down();
		try {
			await page.mouse.move(end.x, end.y, { steps: 12 });
			await page.waitForFunction(({ path, previousTop, chrome, composerGap }) => {
				const card = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"]`);
				const node = card?.closest('.react-flow__node');
				const canvas = card?.closest('.basehalf-canvas-cards');
				if (!(card instanceof HTMLElement) || !(node instanceof HTMLElement) || !(canvas instanceof HTMLElement) || !node.classList.contains('dragging')) {
					return false;
				}
				const cardRect = card.getBoundingClientRect();
				const canvasRect = canvas.getBoundingClientRect();
				const toolbarCount = document.querySelectorAll(`.basehalf-video-context-toolbar[data-node-path="${CSS.escape(path)}"]`).length;
				if (Math.abs(cardRect.top - previousTop) < 40) {
					return false;
				}
				return chrome === 'top'
					? toolbarCount === 0
					: chrome === 'bottom'
						? cardRect.bottom + composerGap >= canvasRect.bottom - 0.5
						: toolbarCount === 1 && cardRect.bottom + composerGap < canvasRect.bottom - 0.5;
			}, {
				path: canvasPath,
				previousTop: before.card.top,
				chrome: expectedChrome,
				composerGap: VIDEO_COMPOSER_SCREEN_GAP
			}, { timeout: 10_000 });
			held = await captureVideoEdgeDropState(page, canvasPath);
		} finally {
			await page.mouse.up();
		}
		await page.waitForFunction(path => {
			const card = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"]`);
			const node = card?.closest('.react-flow__node');
			const canvas = card?.closest('.basehalf-canvas-cards');
			const selected = Array.from(document.querySelectorAll('.react-flow__node.selected'));
			return node instanceof HTMLElement
				&& canvas instanceof HTMLElement
				&& !node.classList.contains('dragging')
				&& canvas.dataset.nodeDragChrome === undefined
				&& selected.length === 1
				&& selected[0] === node;
		}, canvasPath, { timeout: 10_000 });
		await waitUntil(() => fs.readFileSync(canvasYamlPath, 'utf8') !== canvasBefore, `Video ${context} drop geometry to persist`);
		await page.waitForFunction(({ path, chrome }) => {
			const toolbarCount = document.querySelectorAll(`.basehalf-video-context-toolbar[data-node-path="${CSS.escape(path)}"]`).length;
			const composer = document.querySelector(`.basehalf-video-composer[data-node-path="${CSS.escape(path)}"]`);
			const portal = composer?.closest('.basehalf-canvas-video-composer-surface');
			if (!(portal instanceof HTMLElement)) {
				return false;
			}
			const placement = portal.dataset.placement;
			const expectedSide = chrome === 'top'
				? placement === 'below' || placement === 'clamped-below'
				: chrome === 'bottom'
					? placement === 'above' || placement === 'clamped-above'
					: placement === 'below' || placement === 'above' || placement === 'clamped-below' || placement === 'clamped-above';
			return (chrome === 'top' ? toolbarCount === 0 : toolbarCount === 1)
				&& expectedSide
				&& portal.dataset.visible === 'true'
				&& portal.dataset.chromeState === 'present'
				&& getComputedStyle(portal).visibility === 'visible'
				&& !portal.inert;
		}, { path: canvasPath, chrome: expectedChrome }, { timeout: 10_000 });
		await waitForAdjacentChromeAnimations(page);
		const after = await captureVideoEdgeDropState(page, canvasPath);
		const cardDrift = Math.max(...['left', 'top', 'right', 'bottom', 'width', 'height']
			.map(key => Math.abs(held.card[key] - after.card[key])));
		const persisted = readCanvasCardGeometry(fs.readFileSync(canvasYamlPath, 'utf8'), canvasPath);
		const movedFarEnough = Math.abs(held.card.top - before.card.top) >= 40;
		const heldReachedChromeRegion = expectedChrome === 'top'
			? held.toolbarCount === 0
			: expectedChrome === 'bottom'
				? held.card.bottom + VIDEO_COMPOSER_SCREEN_GAP >= held.canvas.bottom - 0.5
				: held.toolbarCount === 1 && held.card.bottom + VIDEO_COMPOSER_SCREEN_GAP < held.canvas.bottom - 0.5;
		if (before.viewportTransform !== held.viewportTransform
			|| held.viewportTransform !== after.viewportTransform
			|| held.nodeTransform !== after.nodeTransform
			|| cardDrift > 1
			|| !movedFarEnough
			|| !heldReachedChromeRegion
			|| !persisted
			|| Math.abs(persisted.x - held.flowPosition.x) > 1
			|| Math.abs(persisted.y - held.flowPosition.y) > 1
			|| !after.selected
			|| after.cardIdentity !== cardIdentity
			|| after.composerIdentity !== expected.composer
			|| after.portalIdentity !== expected.portal
			|| after.promptIdentity !== expected.prompt) {
			throw new Error(`Video ${context} pointer-up moved the viewport or changed the user drop: ${JSON.stringify({ before, held, after, persisted, targetTop, cardDrift, movedFarEnough, heldReachedChromeRegion })}`);
		}
		if (expectedChrome === 'top' && (after.toolbarCount !== 0
			|| !after.composerDataVisible
			|| after.composerVisibility !== 'visible'
			|| after.composerInert
			|| after.composerAriaHidden === 'true'
			|| (after.composerPlacement !== 'below' && after.composerPlacement !== 'clamped-below'))) {
			throw new Error(`Video top-edge drop did not locally hide only the clipped upper chrome: ${JSON.stringify(after)}`);
		}
		if (expectedChrome === 'bottom' && (after.toolbarCount !== 1
			|| after.toolbarVisibility !== 'visible'
			|| !after.composerDataVisible
			|| after.composerVisibility !== 'visible'
			|| after.composerInert
			|| after.composerAriaHidden === 'true'
			|| after.composerPointerEvents === 'none'
			|| (after.composerPlacement !== 'above' && after.composerPlacement !== 'clamped-above'))) {
			throw new Error(`Video bottom-edge drop did not flip the Composer above the card: ${JSON.stringify(after)}`);
		}
		return after;
	};

	const topTarget = original.canvas.top + 48;
	await dragToTop(topTarget, 'top', 'top-edge');
	const atTop = await captureVideoEdgeDropState(page, canvasPath);
	const bottomTarget = atTop.canvas.bottom - atTop.card.height + 48;
	await dragToTop(bottomTarget, 'bottom', 'bottom-edge');
	const restored = await dragToTop(original.card.top, 'restored', 'fixture restore');
	if (restored.toolbarCount !== 1 || !restored.composerDataVisible || restored.composerVisibility !== 'visible') {
		throw new Error(`Video edge-drop smoke did not restore its centered chrome fixture: ${JSON.stringify({ original, restored })}`);
	}
	if (snapWasEnabled) {
		await snapToggle.click();
		await page.waitForFunction(() => document.querySelector('.basehalf-canvas-snap-toggle')?.getAttribute('aria-pressed') === 'true');
	}
}

async function assertVideoComposerResizeAndKeyboardGeometry(page, {
	canvasPath,
	canvasYamlPath,
	card,
	expected
}) {
	const node = page.locator('.react-flow__node').filter({ has: card }).first();
	const resizeHandle = node.locator('.basehalf-canvas-node-resizer-handle.bottom.right');
	await resizeHandle.waitFor({ state: 'visible', timeout: 10_000 });
	const beforeResize = await captureVideoAttachedChrome(page, canvasPath);
	const cardBeforeResize = await card.boundingBox();
	const handleBeforeResize = await resizeHandle.boundingBox();
	if (!cardBeforeResize || !handleBeforeResize) {
		throw new Error('Could not measure the selected Video card before resize');
	}
	const canvasBeforeResize = fs.readFileSync(canvasYamlPath, 'utf8');
	const resizeStart = {
		x: handleBeforeResize.x + handleBeforeResize.width / 2,
		y: handleBeforeResize.y + handleBeforeResize.height / 2
	};
	await page.evaluate(path => {
		const state = window as typeof window & { __basehalfVideoResizeTimeline?: string[] };
		state.__basehalfVideoResizeTimeline = [];
		const record = () => {
			const card = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"]`);
			const portal = document.querySelector('.basehalf-canvas-video-composer-surface');
			state.__basehalfVideoResizeTimeline?.push(`${card?.getAttribute('data-card-resizing') ?? '-'}:${portal?.getAttribute('data-chrome-state') ?? '-'}:${portal?.hasAttribute('inert') ? 'inert' : 'live'}`);
		};
		const observer = new MutationObserver(record);
		for (const element of [
			document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"]`),
			document.querySelector('.basehalf-canvas-video-composer-surface')
		]) {
			if (element) {
				observer.observe(element, { attributes: true, attributeFilter: ['data-card-resizing', 'data-chrome-state', 'inert'] });
			}
		}
		window.setTimeout(() => observer.disconnect(), 12_000);
		record();
	}, canvasPath);
	await page.mouse.move(resizeStart.x, resizeStart.y);
	await page.mouse.down();
	try {
		await page.mouse.move(resizeStart.x + 44, resizeStart.y + 32, { steps: 8 });
		await page.waitForFunction(() => (window as typeof window & { __basehalfVideoResizeTimeline?: string[] })
			.__basehalfVideoResizeTimeline?.some(entry => entry.endsWith(':manipulating:inert')) === true,
		null, { timeout: 10_000 });
	} finally {
		await page.mouse.up();
	}
	await page.waitForFunction(path => {
		const card = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"]`);
		const portal = document.querySelector('.basehalf-canvas-video-composer-surface');
		return card?.dataset.cardResizing !== 'true' && portal?.getAttribute('data-chrome-state') === 'present';
	}, canvasPath, { timeout: 10_000 });
	await waitUntil(() => fs.readFileSync(canvasYamlPath, 'utf8') !== canvasBeforeResize, 'Video resize geometry to persist');
	const afterResize = await captureVideoAttachedChrome(page, canvasPath);
	const cardAfterResize = await card.boundingBox();
	assertVideoComposerState(afterResize, expected, 'after live Video resize');
	assertVideoComposerBelowCard(afterResize, 'after live Video resize');
	if (!cardAfterResize
		|| cardAfterResize.width < cardBeforeResize.width + 20
		|| cardAfterResize.height < cardBeforeResize.height + 16
		|| afterResize.composerIdentity !== beforeResize.composerIdentity
		|| afterResize.promptIdentity !== beforeResize.promptIdentity) {
		throw new Error(`Video resize lost live geometry or Composer identity: ${JSON.stringify({ cardBeforeResize, cardAfterResize, beforeResize, afterResize })}`);
	}

	const undoKey = process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z';
	const redoKey = process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y';
	await card.focus();
	await page.keyboard.press(undoKey);
	await page.waitForFunction(({ path, width, height }) => {
		const bounds = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"]`)?.getBoundingClientRect();
		return !!bounds && Math.abs(bounds.width - width) <= 2 && Math.abs(bounds.height - height) <= 2;
	}, { path: canvasPath, width: cardBeforeResize.width, height: cardBeforeResize.height }, { timeout: 10_000 });
	await waitUntil(() => fs.readFileSync(canvasYamlPath, 'utf8') === canvasBeforeResize, 'Video resize undo to restore persisted geometry');
	await page.keyboard.press(redoKey);
	await page.waitForFunction(({ path, width, height }) => {
		const bounds = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"]`)?.getBoundingClientRect();
		return !!bounds && Math.abs(bounds.width - width) <= 2 && Math.abs(bounds.height - height) <= 2;
	}, { path: canvasPath, width: cardAfterResize.width, height: cardAfterResize.height }, { timeout: 10_000 });
	await page.keyboard.press(undoKey);
	await page.waitForFunction(({ path, width, height }) => {
		const bounds = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"]`)?.getBoundingClientRect();
		return !!bounds && Math.abs(bounds.width - width) <= 2 && Math.abs(bounds.height - height) <= 2;
	}, { path: canvasPath, width: cardBeforeResize.width, height: cardBeforeResize.height }, { timeout: 10_000 });

	await waitUntil(() => fs.readFileSync(canvasYamlPath, 'utf8') === canvasBeforeResize, 'Video resize redo roundtrip to restore persisted geometry');
	const beforeNudge = await captureVideoAttachedChrome(page, canvasPath);
	const cardBeforeNudge = await card.boundingBox();
	const canvasBeforeNudge = fs.readFileSync(canvasYamlPath, 'utf8');
	if (!cardBeforeNudge) {
		throw new Error('Could not measure the selected Video card before keyboard nudge');
	}
	await card.focus();
	await page.keyboard.down('Shift');
	await page.keyboard.down('ArrowRight');
	try {
		await page.waitForFunction(path => document.querySelector('.basehalf-canvas-video-composer-surface')?.getAttribute('data-chrome-state') === 'manipulating'
			&& document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"]`)?.getBoundingClientRect().left !== undefined,
		canvasPath, { timeout: 3_000 });
		const duringNudge = await captureVideoAttachedChrome(page, canvasPath);
		if (duringNudge.portalChrome?.state !== 'manipulating'
			|| !duringNudge.portalChrome.inert
			|| duringNudge.composerIdentity !== beforeNudge.composerIdentity
			|| duringNudge.promptIdentity !== beforeNudge.promptIdentity) {
			throw new Error(`Keyboard geometry did not preserve one inert Composer: ${JSON.stringify({ beforeNudge, duringNudge })}`);
		}
	} finally {
		await page.keyboard.up('ArrowRight');
		await page.keyboard.up('Shift');
	}
	await page.waitForFunction(path => {
		const card = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"]`);
		const portal = document.querySelector('.basehalf-canvas-video-composer-surface');
		return portal?.getAttribute('data-chrome-state') === 'present'
			&& card instanceof HTMLElement
			&& (document.activeElement === card || card.contains(document.activeElement));
	}, canvasPath, { timeout: 10_000 });
	await waitUntil(() => fs.readFileSync(canvasYamlPath, 'utf8') !== canvasBeforeNudge, 'Video keyboard geometry to persist');
	await page.waitForFunction(({ path, left }) => (document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"]`)?.getBoundingClientRect().left ?? Number.NEGATIVE_INFINITY) >= left + 5,
		{ path: canvasPath, left: cardBeforeNudge.x }, { timeout: 10_000 });
	const cardAfterNudge = await card.boundingBox();
	const afterNudge = await captureVideoAttachedChrome(page, canvasPath);
	if (!cardAfterNudge
		|| cardAfterNudge.x < cardBeforeNudge.x + 5
		|| afterNudge.composerIdentity !== beforeNudge.composerIdentity
		|| afterNudge.promptIdentity !== beforeNudge.promptIdentity) {
		throw new Error(`Keyboard nudge did not move the card and preserve Composer identity: ${JSON.stringify({ cardBeforeNudge, cardAfterNudge, beforeNudge, afterNudge })}`);
	}
	// The mirror write becomes observable just before its workspace undo element
	// is published. Let that same commit continuation finish before invoking Undo.
	await page.waitForTimeout(250);
	await page.keyboard.press(undoKey);
	await page.waitForFunction(({ path, left }) => Math.abs((document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"]`)?.getBoundingClientRect().left ?? Number.POSITIVE_INFINITY) - left) <= 2,
	{ path: canvasPath, left: cardBeforeNudge.x }, { timeout: 10_000 });
	await page.keyboard.press(redoKey);
	await page.waitForFunction(({ path, left }) => Math.abs((document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"]`)?.getBoundingClientRect().left ?? Number.POSITIVE_INFINITY) - left) <= 2,
	{ path: canvasPath, left: cardAfterNudge.x }, { timeout: 10_000 });
	await page.keyboard.press(undoKey);
	await page.waitForFunction(({ path, left }) => Math.abs((document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(path)}"]`)?.getBoundingClientRect().left ?? Number.POSITIVE_INFINITY) - left) <= 2,
	{ path: canvasPath, left: cardBeforeNudge.x }, { timeout: 10_000 });
	await waitUntil(() => fs.readFileSync(canvasYamlPath, 'utf8') === canvasBeforeNudge, 'Video keyboard undo to restore persisted geometry');
}

async function assertVideoNodeUI(page) {
	const workflowName = 'Video Starter Workflow';
	const relativeNodePath = 'shots/shot-01/clip.bhnode';
	const canvasPath = `${workflowName}/${relativeNodePath}`;
	const nodePath = path.join(workspacePath, workflowName, relativeNodePath);
	const startFramePath = `${workflowName}/shots/shot-01/smoke-start-frame.svg`;
	const endFramePath = `${workflowName}/shots/shot-01/smoke-end-frame.svg`;
	for (const [relativePath, fill] of [[startFramePath, '#4f7cff'], [endFramePath, '#dc6b8a']]) {
		fs.writeFileSync(path.join(workspacePath, relativePath), [
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">',
			`  <rect width="320" height="180" fill="${fill}"/>`,
			'</svg>',
			''
		].join('\n'), 'utf8');
	}
	const nodeDocument = JSON.parse(fs.readFileSync(nodePath, 'utf8'));
	if (nodeDocument.version !== 3
		|| nodeDocument.kind !== 'video'
		|| nodeDocument.recipe !== undefined
		|| nodeDocument.result !== undefined
		|| !Array.isArray(nodeDocument.attempts)
		|| nodeDocument.attempts.length !== 0) {
		throw new Error(`The starter clip is not an empty Video Draft: ${JSON.stringify(nodeDocument)}`);
	}

	const clip = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${canvasPath}"]`);
	const audio = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${workflowName}/shots/shot-01/audio.bhnode"]`);
	const shot = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${workflowName}/shots/shot-01/shot.json"]`);
	const startFrame = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${startFramePath}"]`);
	const endFrame = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${endFramePath}"]`);
	await clip.waitFor({ state: 'attached', timeout: 15_000 });
	await audio.waitFor({ state: 'attached', timeout: 15_000 });
	await shot.waitFor({ state: 'attached', timeout: 15_000 });
	await startFrame.waitFor({ state: 'attached', timeout: 15_000 });
	await endFrame.waitFor({ state: 'attached', timeout: 15_000 });
	await zoomCanvas(page, 'reset');
	await centerCanvasCards(page, [clip, audio]);
	await page.waitForFunction(({ videoPath, audioPath }) => {
		const video = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${videoPath}"]`);
		const audio = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${audioPath}"]`);
		return video instanceof HTMLElement
			&& video.dataset.previewLevel !== 'shell'
			&& video.dataset.nodeKind === 'video'
			&& video.dataset.nodeLifecycle === 'draft'
			&& video.querySelector('.basehalf-video-stage') !== null
			&& audio instanceof HTMLElement
			&& audio.dataset.previewLevel !== 'shell';
	}, { videoPath: canvasPath, audioPath: `${workflowName}/shots/shot-01/audio.bhnode` }, { timeout: 15_000 });

	const videoPresentation = await clip.evaluate(card => {
		const stage = card.querySelector<HTMLElement>('.basehalf-video-stage');
		const caption = card.querySelector<HTMLElement>('.basehalf-canvas-card-caption');
		const content = card.querySelector<HTMLElement>('.basehalf-canvas-card-content');
		const badge = caption?.querySelector<HTMLElement>('.basehalf-canvas-card-caption-actions .basehalf-canvas-card-badge-toggle');
		const cardRect = card.getBoundingClientRect();
		const stageRect = stage?.getBoundingClientRect();
		const captionRect = caption?.getBoundingClientRect();
		return {
		nodeKind: card.dataset.nodeKind,
		nodeLifecycle: card.dataset.nodeLifecycle,
		hasVideoClass: card.classList.contains('node-kind-video'),
		hasEmptyDraftClass: card.classList.contains('empty-video-draft'),
		hasInternalHeader: card.querySelector('.basehalf-canvas-card-header, .basehalf-canvas-card-path') !== null,
		hasVisibleCaption: caption instanceof HTMLElement && caption.getClientRects().length > 0,
		captionGap: captionRect ? cardRect.top - captionRect.bottom : undefined,
		captionHeight: captionRect?.height,
		badgeInCaption: badge instanceof HTMLElement,
		cardRadius: Number.parseFloat(getComputedStyle(card).borderTopLeftRadius),
		contentRadius: content ? Number.parseFloat(getComputedStyle(content).borderTopLeftRadius) : undefined,
		hasStage: card.querySelector('.basehalf-video-stage') !== null,
		hasStageHint: card.querySelector('.basehalf-video-stage-hint') !== null,
		hasVisibleStatus: card.querySelector('.basehalf-video-state') !== null,
		hasGenericResult: card.querySelector('.basehalf-canvas-node-result, .basehalf-canvas-node-result-label, .basehalf-canvas-node-result-value') !== null,
		stageAspectRatio: stageRect && stageRect.height > 0 ? stageRect.width / stageRect.height : undefined,
		text: card.textContent ?? ''
		};
	});
	if (videoPresentation.nodeKind !== 'video'
		|| videoPresentation.nodeLifecycle !== 'draft'
		|| !videoPresentation.hasVideoClass
		|| !videoPresentation.hasEmptyDraftClass
		|| videoPresentation.hasInternalHeader
		|| !videoPresentation.hasVisibleCaption
		|| videoPresentation.captionGap === undefined
		|| Math.abs(videoPresentation.captionGap - 8) > 1
		|| videoPresentation.captionHeight === undefined
		|| Math.abs(videoPresentation.captionHeight - 24) > 1
		|| !videoPresentation.badgeInCaption
		|| Math.abs(videoPresentation.cardRadius - 22) > 0.5
		|| videoPresentation.contentRadius === undefined
		|| Math.abs(videoPresentation.contentRadius - 21) > 0.5
		|| !videoPresentation.hasStage
		|| videoPresentation.hasStageHint
		|| videoPresentation.hasVisibleStatus
		|| videoPresentation.hasGenericResult
		|| videoPresentation.stageAspectRatio === undefined
		|| Math.abs(videoPresentation.stageAspectRatio - (16 / 9)) > 0.03
		|| /\b(?:Result|Empty Draft)\b/.test(videoPresentation.text)) {
		throw new Error(`The empty Video Draft did not use the dedicated card UI: ${JSON.stringify(videoPresentation)}`);
	}
	if (await page.locator('.basehalf-video-composer').count() !== 0) {
		throw new Error('The Video Composer mounted before its node was selected');
	}
	const clipSizeBeforeComposer = await clip.evaluate(card => {
		const rect = card.getBoundingClientRect();
		return { width: rect.width, height: rect.height };
	});

	await clip.locator('.basehalf-video-stage').click();
	await waitForCanvasCardSelection(page, canvasPath, 10_000);
	await page.waitForFunction(path => {
		const selected = Array.from(document.querySelectorAll('.react-flow__node.selected'));
		const card = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${path}"]`);
		return selected.length === 1 && card instanceof HTMLElement && selected[0].contains(card);
	}, canvasPath, { timeout: 10_000 });
	if (await page.locator('.basehalf-video-result-toolbar').count() !== 0) {
		throw new Error('Selecting a Video Draft exposed Result-only controls');
	}
	const uploadToolbar = page.locator('.basehalf-video-draft-toolbar');
	await uploadToolbar.waitFor({ state: 'visible', timeout: 10_000 });
	const uploadLabels = await uploadToolbar.locator(':scope > button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')));
	if (JSON.stringify(uploadLabels) !== JSON.stringify(['Upload Video'])
		|| await uploadToolbar.getAttribute('role') !== 'toolbar'
		|| await page.locator('.basehalf-canvas-selection-toolbar:visible').count() !== 0) {
		throw new Error(`The empty Video Draft did not expose the upload-only toolbar: ${JSON.stringify({ uploadLabels, role: await uploadToolbar.getAttribute('role') })}`);
	}
	const composer = page.locator(`.basehalf-video-composer[data-node-path="${canvasPath}"]`);
	await composer.waitFor({ state: 'visible', timeout: 10_000 });
	await waitForAdjacentChromeAnimations(page, 2);
	const compactComposerPresentation = await composer.evaluate((surface, path) => {
		const card = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${path}"]`);
		const canvas = document.querySelector('.basehalf-canvas-cards');
		if (!(card instanceof HTMLElement) || !(canvas instanceof HTMLElement)) {
			throw new Error(`Missing Video card or canvas for ${path}`);
		}
		const cardRect = card.getBoundingClientRect();
		const canvasRect = canvas.getBoundingClientRect();
		const composerRect = surface.getBoundingClientRect();
		const portal = surface.closest('.basehalf-canvas-video-composer-surface');
		const labelledById = surface.getAttribute('aria-labelledby');
		const labelledBy = labelledById ? document.getElementById(labelledById) : null;
		const prompt = surface.querySelector('textarea.basehalf-video-prompt');
		const metadata = surface.querySelector('.basehalf-video-composer-metadata');
		return {
			role: surface.getAttribute('role'),
			ariaModal: surface.getAttribute('aria-modal'),
			accessibleName: labelledBy?.textContent?.trim() ?? '',
			labelIsOwned: labelledBy instanceof HTMLElement && surface.contains(labelledBy),
			placement: surface.dataset.placement,
			hasExpandedClass: surface.classList.contains('expanded'),
			hasOldChrome: surface.querySelector([
				'.basehalf-node-local-header',
				'.basehalf-node-local-title',
				'.basehalf-node-local-role',
				'.basehalf-node-local-close',
				'.basehalf-node-local-mode-switch',
				'.basehalf-node-local-readiness',
				'[role="tablist"]',
				'[role="tab"]',
				'[role="tabpanel"]',
				'[role="dialog"]'
			].join(', ')) !== null,
			toolsCount: surface.querySelectorAll('.basehalf-video-composer-tools').length,
			toolCount: surface.querySelectorAll('.basehalf-video-composer-tool').length,
			referencesCount: surface.querySelectorAll('.basehalf-video-composer-tool.codicon-references').length,
			addCount: surface.querySelectorAll('.basehalf-video-composer-tool.codicon-add').length,
			promptCount: surface.querySelectorAll('textarea.basehalf-video-prompt').length,
			promptFocused: prompt instanceof HTMLTextAreaElement && document.activeElement === prompt,
			promptResize: prompt instanceof HTMLTextAreaElement ? getComputedStyle(prompt).resize : undefined,
			metadataCount: surface.querySelectorAll('.basehalf-video-composer-metadata').length,
			metadataDisplay: metadata instanceof HTMLElement ? getComputedStyle(metadata).display : undefined,
			footerMessage: surface.querySelector('.basehalf-node-local-footer-message')?.textContent?.trim() ?? '',
			modelTriggerCount: surface.querySelectorAll('.basehalf-video-model-trigger[data-video-composer-trigger="models"]').length,
			settingsTriggerCount: surface.querySelectorAll('.basehalf-video-settings-trigger[data-video-composer-trigger="settings"]').length,
			attemptsTriggerCount: surface.querySelectorAll('.basehalf-video-attempts-trigger').length,
			controlsCount: surface.querySelectorAll('.basehalf-video-composer-controls').length,
			primaryCount: surface.querySelectorAll('.basehalf-video-composer-primary').length,
			primaryDisabled: surface.querySelector<HTMLButtonElement>('.basehalf-video-composer-primary')?.disabled,
			primaryAction: surface.querySelector<HTMLElement>('.basehalf-video-composer-primary')?.dataset.nodeAction,
			overlayRootCount: surface.querySelectorAll('.basehalf-video-composer-overlay-root').length,
			popoverCount: surface.querySelectorAll('.basehalf-video-composer-popover').length,
			portalCount: document.querySelectorAll('.basehalf-canvas-video-composer-surface').length,
			ownedByPortal: portal instanceof HTMLElement && portal.contains(surface),
			ownedByContextView: surface.closest('.context-view') !== null,
			containedByCard: card.contains(surface),
			viewportWidth: window.innerWidth,
			canvasWidth: canvasRect.width,
			cardLeft: cardRect.left,
			cardTop: cardRect.top,
			cardRight: cardRect.right,
			cardBottom: cardRect.bottom,
			cardWidth: cardRect.width,
			cardHeight: cardRect.height,
			composerLeft: composerRect.left,
			composerTop: composerRect.top,
			composerRight: composerRect.right,
			composerBottom: composerRect.bottom,
			composerWidth: composerRect.width,
			composerHeight: composerRect.height
		};
	}, canvasPath);
	const expectedComposerWidth = Math.min(
		VIDEO_COMPOSER_SCREEN_WIDTH,
		compactComposerPresentation.canvasWidth - VIDEO_COMPOSER_VIEWPORT_MARGIN * 2
	);
	const composerCenter = (compactComposerPresentation.composerLeft + compactComposerPresentation.composerRight) / 2;
	const cardCenter = (compactComposerPresentation.cardLeft + compactComposerPresentation.cardRight) / 2;
	const placementIsAdjacent = compactComposerPresentation.placement === 'below'
		&& Math.abs(compactComposerPresentation.composerTop - compactComposerPresentation.cardBottom - VIDEO_COMPOSER_SCREEN_GAP) <= 3
		&& Math.abs(composerCenter - cardCenter) <= 3;
	if (await page.locator('.basehalf-video-composer:visible').count() !== 1
		|| compactComposerPresentation.role !== 'region'
		|| compactComposerPresentation.ariaModal !== null
		|| !compactComposerPresentation.accessibleName
		|| !compactComposerPresentation.labelIsOwned
		|| !placementIsAdjacent
		|| compactComposerPresentation.hasExpandedClass
		|| compactComposerPresentation.hasOldChrome
		|| compactComposerPresentation.toolsCount !== 0
		|| compactComposerPresentation.toolCount !== 0
		|| compactComposerPresentation.referencesCount !== 0
		|| compactComposerPresentation.addCount !== 0
		|| compactComposerPresentation.promptCount !== 1
		|| compactComposerPresentation.promptResize !== 'none'
		|| compactComposerPresentation.metadataCount !== 1
		|| compactComposerPresentation.metadataDisplay === 'none'
		|| compactComposerPresentation.footerMessage !== ''
		|| compactComposerPresentation.modelTriggerCount !== 1
		|| compactComposerPresentation.settingsTriggerCount !== 1
		|| compactComposerPresentation.attemptsTriggerCount !== 0
		|| compactComposerPresentation.controlsCount !== 1
		|| compactComposerPresentation.primaryCount !== 1
		|| compactComposerPresentation.primaryDisabled !== false
		|| compactComposerPresentation.primaryAction !== 'add'
		|| compactComposerPresentation.overlayRootCount !== 1
		|| compactComposerPresentation.popoverCount !== 0
		|| compactComposerPresentation.portalCount !== 1
		|| !compactComposerPresentation.ownedByPortal
		|| compactComposerPresentation.ownedByContextView
		|| compactComposerPresentation.containedByCard
		|| Math.abs(compactComposerPresentation.cardWidth - clipSizeBeforeComposer.width) > 1
		|| Math.abs(compactComposerPresentation.cardHeight - clipSizeBeforeComposer.height) > 1
		|| Math.abs(compactComposerPresentation.composerWidth - expectedComposerWidth) > 3
		|| Math.abs(compactComposerPresentation.composerHeight - VIDEO_COMPOSER_SCREEN_HEIGHT) > 3) {
		throw new Error(`Selecting the Video Draft did not mount the compact node-adjacent Composer: ${JSON.stringify({
			...compactComposerPresentation,
			expectedComposerWidth,
			placementIsAdjacent,
			clipSizeBeforeComposer
		})}`);
	}

	const smokePromptValue = 'A quiet product film with a slow camera orbit and restrained studio light.';
	const draftIdentity = await markVideoAttachedChromeIdentity(page, canvasPath, 'basehalf-smoke-video-draft', smokePromptValue);
	let stableComposerContext = await captureVideoAttachedChrome(page, canvasPath);
	let expectedDraftState = {
		...draftIdentity,
		promptValue: smokePromptValue,
		promptSelectionStart: stableComposerContext.promptSelectionStart,
		promptSelectionEnd: stableComposerContext.promptSelectionEnd
	};
	assertVideoComposerState(stableComposerContext, expectedDraftState, 'before exercising attached interactions');
	assertVideoComposerBelowCard(stableComposerContext, 'before exercising attached interactions');

	stableComposerContext = await assertVideoAttachedChromeFollowsPointerDrag(page, {
		canvasPath,
		card: clip,
		expected: expectedDraftState
	});
	await assertVideoEdgeDropDoesNotPanForAdjacentChrome(page, {
		canvasPath,
		canvasYamlPath: path.join(workspacePath, '.bh', 'mirror', workflowName, 'shots', 'shot-01', 'canvas.yaml'),
		expected: expectedDraftState
	});
	stableComposerContext = await captureVideoAttachedChrome(page, canvasPath);
	await assertVideoComposerResizeAndKeyboardGeometry(page, {
		canvasPath,
		canvasYamlPath: path.join(workspacePath, '.bh', 'mirror', workflowName, 'shots', 'shot-01', 'canvas.yaml'),
		card: clip,
		expected: expectedDraftState
	});
	stableComposerContext = await captureVideoAttachedChrome(page, canvasPath);

	const pane = page.locator('.basehalf-canvas-cards .react-flow__pane');
	const paneBox = await pane.boundingBox();
	if (!paneBox) {
		throw new Error('Could not measure the Canvas pane for the Video Composer pan contract');
	}
	await page.mouse.move(paneBox.x + 18, paneBox.y + 18);
	await page.mouse.wheel(36, 28);
	await page.waitForFunction(previous => {
		const viewport = document.querySelector('.react-flow__viewport');
		return viewport instanceof HTMLElement && getComputedStyle(viewport).transform !== previous;
	}, stableComposerContext.viewportTransform, { timeout: 10_000 });
	await waitForVideoChromeFrames(page);
	const afterPan = await captureVideoAttachedChrome(page, canvasPath);
	assertVideoComposerState(afterPan, expectedDraftState, 'after Canvas pan');
	assertVideoComposerBelowCard(afterPan, 'after Canvas pan');
	assertVideoChromeTranslatedTogether(stableComposerContext, afterPan, 'during Canvas pan');
	stableComposerContext = afterPan;

	await composer.locator('textarea.basehalf-video-prompt').focus();
	if (!await zoomCanvas(page, 'in', { preserveFocus: true })) {
		throw new Error('Canvas refused the Video Composer zoom-in contract');
	}
	await waitForVideoChromeFrames(page);
	const afterZoom = await captureVideoAttachedChrome(page, canvasPath);
	assertVideoComposerState(afterZoom, expectedDraftState, 'after Canvas zoom');
	assertVideoComposerBelowCard(afterZoom, 'after Canvas zoom');
	if (afterZoom.viewportTransform === stableComposerContext.viewportTransform
		|| Math.abs(afterZoom.composer.width - stableComposerContext.composer.width) > 2
		|| Math.abs(afterZoom.composer.height - stableComposerContext.composer.height) > 2) {
		throw new Error(`Video Composer did not keep stable screen-space geometry through Canvas zoom: ${JSON.stringify({ before: stableComposerContext, after: afterZoom })}`);
	}
	stableComposerContext = afterZoom;

	const beforeZoomMenu = stableComposerContext;
	const zoomController = await openCanvasZoomMenu(page);
	await waitForVideoChromeFrames(page);
	const zoomMenuOpen = await captureVideoAttachedChrome(page, canvasPath);
	assertVideoComposerState(zoomMenuOpen, expectedDraftState, 'while the Canvas zoom menu is open');
	assertVideoComposerBelowCard(zoomMenuOpen, 'while the Canvas zoom menu is open');
	assertVideoChromeLayoutUnchanged(beforeZoomMenu, zoomMenuOpen, 'while opening the Canvas zoom menu');
	await page.keyboard.press('Escape');
	await zoomController.menu.waitFor({ state: 'hidden', timeout: 10_000 });
	await waitForVideoChromeFrames(page);
	const afterZoomMenu = await captureVideoAttachedChrome(page, canvasPath);
	assertVideoComposerState(afterZoomMenu, expectedDraftState, 'after Escape closed the Canvas zoom menu');
	assertVideoComposerBelowCard(afterZoomMenu, 'after Escape closed the Canvas zoom menu');
	assertVideoChromeLayoutUnchanged(beforeZoomMenu, afterZoomMenu, 'after closing the Canvas zoom menu');
	stableComposerContext = afterZoomMenu;

	const modelTrigger = composer.locator('.basehalf-video-model-trigger[data-video-composer-trigger="models"]');
	const settingsTrigger = composer.locator('.basehalf-video-settings-trigger[data-video-composer-trigger="settings"]');
	const overlayRoot = composer.locator('.basehalf-video-composer-overlay-root');
	const modelsPopover = composer.locator('.basehalf-video-composer-popover.models');
	const settingsPopover = composer.locator('.basehalf-video-composer-popover.settings');
	const inputsPopover = composer.locator('.basehalf-video-composer-popover.inputs');

	await modelTrigger.click();
	await modelsPopover.waitFor({ state: 'visible', timeout: 10_000 });
	await waitForVideoChromeFrames(page);
	const modelOpenContext = await captureVideoAttachedChrome(page, canvasPath);
	assertVideoComposerState(modelOpenContext, expectedDraftState, 'while opening the catalog-first model picker');
	assertVideoComposerBelowCard(modelOpenContext, 'while opening the catalog-first model picker');
	assertVideoChromeLayoutUnchanged(stableComposerContext, modelOpenContext, 'while opening the catalog-first model picker');
	const modelsPopoverIsLocal = await overlayRoot.locator('.basehalf-video-composer-popover.models').count() === 1;
	const targetModel = modelsPopover.locator(`.basehalf-video-model-option[data-spec-id="${SMOKE_VIDEO_PROVIDER_SPEC_ID}"][data-model-id="${SMOKE_VIDEO_MODEL_ID}"]`);
	await targetModel.waitFor({ state: 'visible', timeout: 10_000 });
	const modelsPopoverBounds = await modelsPopover.boundingBox();
	const modelPickerGeometry = await modelsPopover.evaluate(popover => {
		const rows = [...popover.querySelectorAll<HTMLElement>('.basehalf-video-model-option')];
		const ordinaryRows = rows.filter(row => !row.classList.contains('exceptional'));
		const copy = ordinaryRows[0]?.querySelector<HTMLElement>('.basehalf-video-model-option-copy');
		const state = ordinaryRows[0]?.querySelector<HTMLElement>('.basehalf-video-model-option-state');
		const label = ordinaryRows[0]?.querySelector<HTMLElement>('.basehalf-video-model-option-label');
		const meta = ordinaryRows[0]?.querySelector<HTMLElement>('.basehalf-video-model-option-meta');
		const rects = rows.map(row => row.getBoundingClientRect());
		return {
			ordinaryRowHeights: ordinaryRows.map(row => row.getBoundingClientRect().height),
			copyWidth: copy?.getBoundingClientRect().width,
			stateWidth: state?.getBoundingClientRect().width,
			labelWhiteSpace: label ? getComputedStyle(label).whiteSpace : undefined,
			metaWhiteSpace: meta ? getComputedStyle(meta).whiteSpace : undefined,
			overlaps: rects.some((rect, index) => index > 0 && rects[index - 1].bottom > rect.top + 0.5),
			searchCount: popover.querySelectorAll('input, [role="searchbox"]').length,
			horizontalOverflow: popover.scrollWidth > popover.clientWidth + 1
		};
	});
	if (await composer.locator('.basehalf-video-composer-popover:visible').count() !== 1
		|| await modelTrigger.getAttribute('aria-expanded') !== 'true'
		|| await settingsTrigger.getAttribute('aria-expanded') !== 'false'
		|| await modelTrigger.getAttribute('aria-controls') !== await modelsPopover.getAttribute('id')
		|| await modelsPopover.getAttribute('role') !== 'dialog'
		|| await modelsPopover.getAttribute('aria-modal') !== 'false'
		|| await overlayRoot.getAttribute('data-overlay') !== 'models'
		|| !modelsPopoverIsLocal
		|| await targetModel.getAttribute('data-model-availability') !== 'connection-required'
		|| await targetModel.getAttribute('aria-pressed') !== 'false'
		|| await targetModel.isDisabled()
		|| !((await targetModel.getAttribute('aria-label')) ?? '').includes('Connect')
		|| await targetModel.locator('.codicon-lock').count() !== 1
		|| await modelsPopover.locator('select.basehalf-video-capability-select').count() !== 0
		|| !modelsPopoverBounds
		|| Math.abs(modelsPopoverBounds.width - 224) > 2
		|| modelsPopoverBounds.height > 320.5
		|| modelPickerGeometry.ordinaryRowHeights.some(height => Math.abs(height - 48) > 1)
		|| (modelPickerGeometry.copyWidth ?? 0) < 120
		|| (modelPickerGeometry.stateWidth ?? 17) > 16.5
		|| modelPickerGeometry.labelWhiteSpace !== 'nowrap'
		|| modelPickerGeometry.metaWhiteSpace !== 'nowrap'
		|| modelPickerGeometry.overlaps
		|| modelPickerGeometry.searchCount !== 0
		|| modelPickerGeometry.horizontalOverflow
		|| await page.locator('.quick-input-widget:visible').count() !== 0) {
		throw new Error(`The empty Video Draft did not expose a clickable locked catalog model: ${JSON.stringify({
			modelExpanded: await modelTrigger.getAttribute('aria-expanded'),
			settingsExpanded: await settingsTrigger.getAttribute('aria-expanded'),
			overlay: await overlayRoot.getAttribute('data-overlay'),
			modelsPopoverIsLocal,
			targetAvailability: await targetModel.getAttribute('data-model-availability'),
				targetPressed: await targetModel.getAttribute('aria-pressed'),
				targetDisabled: await targetModel.isDisabled(),
				lockCount: await targetModel.locator('.codicon-lock').count(),
				targetText: (await targetModel.textContent())?.replace(/\s+/g, ' ').trim(),
				popoverCount: await composer.locator('.basehalf-video-composer-popover:visible').count(),
				modelsPopoverBounds,
				controls: await modelTrigger.getAttribute('aria-controls'),
				popoverId: await modelsPopover.getAttribute('id'),
				role: await modelsPopover.getAttribute('role'),
				modal: await modelsPopover.getAttribute('aria-modal'),
			genericSelects: await modelsPopover.locator('select.basehalf-video-capability-select').count(),
			modelPickerGeometry,
				quickInputs: await page.locator('.quick-input-widget:visible').count()
			})}`);
	}
	const modelPanBefore = await captureVideoAttachedChrome(page, canvasPath);
	await page.mouse.move(paneBox.x + 22, paneBox.y + 22);
	await page.mouse.wheel(-28, 34);
	await page.waitForFunction(previous => {
		const viewport = document.querySelector('.react-flow__viewport');
		return viewport instanceof HTMLElement && getComputedStyle(viewport).transform !== previous;
	}, modelPanBefore.viewportTransform, { timeout: 10_000 });
	await waitForVideoChromeFrames(page);
	const modelPanAfter = await captureVideoAttachedChrome(page, canvasPath);
	assertVideoComposerState(modelPanAfter, expectedDraftState, 'after panning from the video model picker');
	assertVideoComposerBelowCard(modelPanAfter, 'after panning from the video model picker');
	assertVideoChromeTranslatedTogether(modelPanBefore, modelPanAfter, 'while panning from the video model picker');
	if (modelPanAfter.visiblePopoverCount !== 0 || await modelsPopover.isVisible()) {
		throw new Error('Panning the Canvas did not close the local Video model picker');
	}
	await modelTrigger.click();
	await modelsPopover.waitFor({ state: 'visible', timeout: 10_000 });
	await targetModel.waitFor({ state: 'visible', timeout: 10_000 });

	// A locked catalog row owns connection setup. It leaves the canvas, opens the
	// BH Settings (never another picker), then returns to the exact Draft and
	// selects only the model that initiated the intent.
	await targetModel.click();
	const settingsEditor = page.locator('.settings-editor').first();
	await settingsEditor.waitFor({ state: 'visible', timeout: 20_000 });
	const connectionEditor = settingsEditor.locator('.basehalf-model-connections').first();
	await connectionEditor.waitFor({ state: 'visible', timeout: 20_000 });
	await composer.waitFor({ state: 'hidden', timeout: 15_000 });
	const selectedProvider = connectionEditor.locator(`.basehalf-model-provider-row[data-spec-id="${SMOKE_VIDEO_PROVIDER_SPEC_ID}"][aria-current="page"]`);
	const connectionForm = connectionEditor.locator(`.basehalf-model-connection-form[data-provider-id="${SMOKE_VIDEO_PROVIDER_SPEC_ID}"]`);
	await selectedProvider.waitFor({ state: 'visible', timeout: 15_000 });
	await connectionForm.waitFor({ state: 'visible', timeout: 15_000 });
	const connectionCopy = ((await connectionEditor.locator('.basehalf-model-connection-detail').textContent()) ?? '').replace(/\s+/g, ' ').trim();
	const apiKeyInput = connectionForm.locator('input[type="password"]');
	if (await page.locator('.quick-input-widget:visible').count() !== 0
		|| await connectionEditor.locator('h2', { hasText: 'BytePlus' }).count() !== 1
		|| await connectionEditor.locator('.basehalf-model-connection-models', { hasText: SMOKE_VIDEO_MODEL_LABEL }).count() !== 1
		|| await apiKeyInput.count() !== 1
		|| await connectionForm.locator('input, select').count() !== 1
		|| connectionCopy.includes('Endpoint')
		|| connectionCopy.includes('Provider ID')
		|| connectionCopy.includes('Deployment ID')
		|| connectionCopy.includes('Region')
		|| connectionCopy.includes('Authorization')) {
		throw new Error(`The locked model did not route to its minimal official provider form: ${connectionCopy}`);
	}
	await apiKeyInput.fill('basehalf-smoke-not-a-real-provider-key');
	await connectionForm.locator('button[data-action="verify"]').click();
	await connectionEditor.waitFor({ state: 'hidden', timeout: 20_000 });
	await page.locator('.basehalf-canvas-workbench').waitFor({ state: 'visible', timeout: 15_000 });
	await composer.waitFor({ state: 'visible', timeout: 20_000 });
	if (await connectionEditor.locator('input[type="password"]').evaluateAll(inputs => inputs.some(input => input.value.length > 0))) {
		throw new Error('The cached Models & Providers section retained an API key in its hidden DOM after save');
	}
	await page.waitForFunction(({ path, label }) => {
		const surface = document.querySelector(`.basehalf-video-composer[data-node-path="${CSS.escape(path)}"]`);
		const primary = surface?.querySelector<HTMLButtonElement>('.basehalf-video-composer-primary');
		return surface?.querySelector('.basehalf-video-model-trigger .basehalf-video-trigger-label')?.textContent?.trim() === label
			&& primary?.dataset.nodeAction === 'run'
			&& primary.disabled === false;
	}, { path: canvasPath, label: SMOKE_VIDEO_MODEL_LABEL }, { timeout: 20_000 });
	if (await page.locator('.quick-input-widget:visible').count() !== 0) {
		throw new Error('Saving the provider form returned through QuickInput instead of directly to the Video Draft');
	}

	const returnedIdentity = await markVideoAttachedChromeIdentity(page, canvasPath, 'basehalf-smoke-video-connected', smokePromptValue);
	stableComposerContext = await captureVideoAttachedChrome(page, canvasPath);
	expectedDraftState = {
		...returnedIdentity,
		promptValue: smokePromptValue,
		promptSelectionStart: stableComposerContext.promptSelectionStart,
		promptSelectionEnd: stableComposerContext.promptSelectionEnd
	};
	assertVideoComposerState(stableComposerContext, expectedDraftState, 'after returning from the inline provider connection editor');
	assertVideoComposerBelowCard(stableComposerContext, 'after returning from the inline provider connection editor');

	await modelTrigger.click();
	await modelsPopover.waitFor({ state: 'visible', timeout: 10_000 });
	const connectedSelection = await modelsPopover.evaluate((popover, expected) => {
		const rows = Array.from(popover.querySelectorAll<HTMLElement>('.basehalf-video-model-option'));
		const selected = rows.filter(row => row.getAttribute('aria-pressed') === 'true');
		const target = rows.find(row => row.dataset.specId === expected.specId && row.dataset.modelId === expected.modelId);
		return {
			targetAvailability: target?.dataset.modelAvailability,
			targetSelected: target?.getAttribute('aria-pressed'),
			targetText: target?.textContent?.replace(/\s+/g, ' ').trim(),
			selectedModels: selected.map(row => row.dataset.modelId),
			availableOutsideConnection: rows.filter(row => row.dataset.modelAvailability === 'available' && row.dataset.specId !== expected.specId).map(row => row.dataset.modelId),
			connectionRequiredOutsideScope: rows.filter(row => row.dataset.specId !== expected.specId && row.dataset.modelAvailability === 'connection-required').length,
			genericSelects: popover.querySelectorAll('select.basehalf-video-capability-select').length
		};
	}, { specId: SMOKE_VIDEO_PROVIDER_SPEC_ID, modelId: SMOKE_VIDEO_MODEL_ID });
	if (connectedSelection.targetAvailability !== 'available'
		|| connectedSelection.targetSelected !== 'true'
		|| connectedSelection.selectedModels.length !== 1
		|| connectedSelection.selectedModels[0] !== SMOKE_VIDEO_MODEL_ID
		|| connectedSelection.availableOutsideConnection.length !== 0
		|| connectedSelection.connectionRequiredOutsideScope < 1
		|| connectedSelection.genericSelects !== 0) {
		throw new Error(`The provider return did not unlock the exact connection scope and select only its target model: ${JSON.stringify(connectedSelection)}`);
	}
	await settingsTrigger.click();
	await settingsPopover.waitFor({ state: 'visible', timeout: 10_000 });
	await waitForVideoChromeFrames(page);
	const settingsOpenContext = await captureVideoAttachedChrome(page, canvasPath);
	assertVideoComposerState(settingsOpenContext, expectedDraftState, 'while opening model-specific video settings');
	assertVideoComposerBelowCard(settingsOpenContext, 'while opening model-specific video settings');
	assertVideoChromeLayoutUnchanged(stableComposerContext, settingsOpenContext, 'while opening model-specific video settings');
	const settingsPopoverText = (await settingsPopover.textContent())?.replace(/\s+/g, ' ').trim() ?? '';
	const settingsPopoverIsLocal = await overlayRoot.locator('.basehalf-video-composer-popover.settings').count() === 1;
	const settingsPopoverBounds = await settingsPopover.boundingBox();
	const canonicalSelection = await settingsPopover.evaluate(popover => {
		const surface = popover.closest('.basehalf-video-composer');
		const methodListbox = popover.querySelector<HTMLSelectElement>('select.basehalf-video-method-listbox');
		return {
			model: surface?.querySelector('.basehalf-video-model-trigger .basehalf-video-trigger-label')?.textContent?.trim(),
			mode: popover.querySelector<HTMLElement>('.basehalf-video-mode-segmented [role="radio"][aria-checked="true"]')?.textContent?.trim()
				?? methodListbox?.selectedOptions[0]?.textContent?.split(' — ', 1)[0]?.trim(),
			methodControlCount: popover.querySelectorAll('.basehalf-video-mode-segmented, select.basehalf-video-method-listbox, .basehalf-video-fixed-method').length,
			primaryAction: surface?.querySelector<HTMLElement>('.basehalf-video-composer-primary')?.dataset.nodeAction,
			primaryDisabled: surface?.querySelector<HTMLButtonElement>('.basehalf-video-composer-primary')?.disabled,
			genericSelects: popover.querySelectorAll('select.basehalf-video-capability-select').length,
			popoverCount: surface?.querySelectorAll('.basehalf-video-composer-popover').length
		};
	});
	if (await composer.locator('.basehalf-video-composer-popover:visible').count() !== 1
		|| await modelTrigger.getAttribute('aria-expanded') !== 'false'
		|| await settingsTrigger.getAttribute('aria-expanded') !== 'true'
		|| await settingsTrigger.getAttribute('aria-controls') !== await settingsPopover.getAttribute('id')
		|| await settingsPopover.getAttribute('role') !== 'dialog'
		|| await settingsPopover.getAttribute('aria-modal') !== 'false'
		|| await overlayRoot.getAttribute('data-overlay') !== 'settings'
		|| !settingsPopoverIsLocal
		|| !settingsPopoverBounds
		|| Math.abs(settingsPopoverBounds.width - 256) > 2
		|| settingsPopoverBounds.height > 360.5
		|| await settingsPopover.locator('.basehalf-video-settings-model').count() !== 0
		|| !settingsPopoverText.includes('Video generation')
		|| !settingsPopoverText.includes('Generate method')
		|| canonicalSelection.model !== SMOKE_VIDEO_MODEL_LABEL
		|| !canonicalSelection.mode
		|| canonicalSelection.methodControlCount !== 1
		|| canonicalSelection.primaryAction !== 'run'
		|| canonicalSelection.primaryDisabled !== false
		|| canonicalSelection.genericSelects !== 0
		|| canonicalSelection.popoverCount !== 1) {
		throw new Error(`The selected model did not expose one schema-driven settings popover: ${JSON.stringify({
			settingsPopoverText,
			modelExpanded: await modelTrigger.getAttribute('aria-expanded'),
				settingsExpanded: await settingsTrigger.getAttribute('aria-expanded'),
				overlay: await overlayRoot.getAttribute('data-overlay'),
				settingsPopoverIsLocal,
				settingsPopoverBounds,
				controls: await settingsTrigger.getAttribute('aria-controls'),
				popoverId: await settingsPopover.getAttribute('id'),
				role: await settingsPopover.getAttribute('role'),
				modal: await settingsPopover.getAttribute('aria-modal'),
				settingsModelCount: await settingsPopover.locator('.basehalf-video-settings-model').count(),
				canonicalSelection
		})}`);
	}
	const methodListbox = settingsPopover.locator('select.basehalf-video-method-listbox');
	const startEndMethod = settingsPopover.getByRole('radio', { name: 'Start + End Frames', exact: true });
	if (await methodListbox.count() === 1) {
		const startEndOption = methodListbox.locator('option[value="first-last-frame-to-video"]');
		if (await startEndOption.count() !== 1 || await startEndOption.isDisabled()) {
			throw new Error('The reviewed Start + End Frames method was hidden or disabled because its frame inputs are still empty');
		}
		await methodListbox.selectOption('first-last-frame-to-video');
	} else {
		if (await startEndMethod.count() !== 1 || await startEndMethod.isDisabled()) {
			throw new Error('The reviewed Start + End Frames method was hidden or disabled because its frame inputs are still empty');
		}
		await startEndMethod.click();
	}
	await page.waitForFunction(path => {
		const surface = document.querySelector(`.basehalf-video-composer[data-node-path="${CSS.escape(path)}"]`);
		const popover = surface?.querySelector<HTMLElement>('.basehalf-video-composer-popover.settings');
		const selectedMethod = popover?.querySelector<HTMLElement>('.basehalf-video-mode-segmented [role="radio"][aria-checked="true"]')?.textContent?.trim()
			?? popover?.querySelector<HTMLSelectElement>('select.basehalf-video-method-listbox')?.value;
		return selectedMethod === 'Start + End Frames' || selectedMethod === 'first-last-frame-to-video';
	}, canvasPath, { timeout: 10_000 });
	const incompleteFrameMethod = await settingsPopover.evaluate(popover => {
		const surface = popover.closest('.basehalf-video-composer');
		return {
			mode: popover.querySelector<HTMLElement>('.basehalf-video-mode-segmented [role="radio"][aria-checked="true"]')?.textContent?.trim()
				?? popover.querySelector<HTMLSelectElement>('select.basehalf-video-method-listbox')?.selectedOptions[0]?.textContent?.split(' — ', 1)[0]?.trim(),
			status: popover.querySelector<HTMLElement>('.basehalf-video-capability-status')?.textContent?.trim(),
			primaryAction: surface?.querySelector<HTMLButtonElement>('.basehalf-video-composer-primary')?.dataset.nodeAction,
			primaryDisabled: surface?.querySelector<HTMLButtonElement>('.basehalf-video-composer-primary')?.disabled,
			primaryLabel: surface?.querySelector<HTMLButtonElement>('.basehalf-video-composer-primary')?.getAttribute('aria-label'),
			parameterFields: popover.querySelectorAll('.basehalf-video-capability-field').length,
			frameRoles: [...(surface?.querySelectorAll<HTMLElement>('.basehalf-video-frame-slot') ?? [])].map(slot => slot.dataset.frameRole),
			emptyFrameSlots: surface?.querySelectorAll('.basehalf-video-frame-slot.empty').length,
			frameRemoveActions: surface?.querySelectorAll('.basehalf-video-frame-slot-remove').length,
			frameSwapActions: surface?.querySelectorAll('.basehalf-video-frame-swap').length
		};
	});
	if (incompleteFrameMethod.mode !== 'Start + End Frames'
		|| incompleteFrameMethod.status !== 'Add Start Frame.'
		|| incompleteFrameMethod.primaryAction !== 'configure'
		|| incompleteFrameMethod.primaryDisabled !== false
		|| !incompleteFrameMethod.primaryLabel?.includes('Add Start Frame.')
		|| incompleteFrameMethod.parameterFields < 2
		|| incompleteFrameMethod.frameRoles.join(',') !== 'first-frame,last-frame'
		|| incompleteFrameMethod.emptyFrameSlots !== 2
		|| incompleteFrameMethod.frameRemoveActions !== 0
		|| incompleteFrameMethod.frameSwapActions !== 0) {
		throw new Error(`A valid incomplete frame method did not remain selected with its settings visible: ${JSON.stringify(incompleteFrameMethod)}`);
	}
	await page.keyboard.press('Escape');
	await settingsPopover.waitFor({ state: 'hidden', timeout: 10_000 });
	const canvasYamlPath = path.join(workspacePath, '.bh', 'mirror', workflowName, 'shots', 'shot-01', 'canvas.yaml');
	const targetBadgePath = path.join(workspacePath, '.bh', 'mirror', ...canvasPath.split('/'), 'badge.yaml');
	const startFrameBadgePath = path.join(workspacePath, '.bh', 'mirror', ...startFramePath.split('/'), 'badge.yaml');
	const endFrameBadgePath = path.join(workspacePath, '.bh', 'mirror', ...endFramePath.split('/'), 'badge.yaml');
	await composer.locator('.basehalf-video-frame-slot[data-frame-role="first-frame"] .basehalf-video-frame-slot-open').click();
	const inputPickBanner = page.locator(`.basehalf-video-input-pick-banner[data-target-node-path="${canvasPath}"]`);
	await inputPickBanner.waitFor({ state: 'visible', timeout: 10_000 });
	await startFrame.waitFor({ state: 'visible', timeout: 10_000 });
	await page.waitForFunction(({ sourcePath, targetPath }) => document.querySelector(
		`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(sourcePath)}"]`
	)?.classList.contains('basehalf-video-input-pick-eligible') === true
		&& document.querySelector(
			`.basehalf-video-input-pick-banner[data-target-node-path="${CSS.escape(targetPath)}"]`
		)?.textContent?.includes('Select a highlighted card') === true,
	{ sourcePath: startFramePath, targetPath: canvasPath }, { timeout: 10_000 });
	const pickPanBefore = await captureVideoAttachedChrome(page, canvasPath);
	const bannerBeforePan = await inputPickBanner.boundingBox();
	await page.mouse.move(paneBox.x + 26, paneBox.y + 26);
	await page.mouse.wheel(24, -20);
	await page.waitForFunction(previous => {
		const viewport = document.querySelector('.react-flow__viewport');
		return viewport instanceof HTMLElement && getComputedStyle(viewport).transform !== previous;
	}, pickPanBefore.viewportTransform, { timeout: 10_000 });
	const bannerAfterPan = await inputPickBanner.boundingBox();
	if (!bannerBeforePan
		|| !bannerAfterPan
		|| Math.abs(bannerAfterPan.x - bannerBeforePan.x) > 1
		|| Math.abs(bannerAfterPan.y - 12) > 1
		|| await inputPickBanner.getAttribute('data-target-node-path') !== canvasPath) {
		throw new Error(`Canvas pan did not preserve the fixed input-pick request banner: ${JSON.stringify({ bannerBeforePan, bannerAfterPan })}`);
	}
	const checkpointedBeforeCancelledPick = JSON.parse(fs.readFileSync(nodePath, 'utf8'));
	if (checkpointedBeforeCancelledPick.recipe?.recipeId !== 'pointa.basehalf-ai-video.generate-video'
		|| checkpointedBeforeCancelledPick.recipe?.parameters?.generationMode !== 'first-last-frame-to-video'
		|| checkpointedBeforeCancelledPick.recipe?.inputBindings?.length !== 0) {
		throw new Error(`Canvas pick did not checkpoint the exact frame method before accepting an input: ${JSON.stringify(checkpointedBeforeCancelledPick.recipe)}`);
	}
	const nodeBeforeCancelledPick = fs.readFileSync(nodePath, 'utf8');
	const canvasBeforeCancelledPick = fs.readFileSync(canvasYamlPath, 'utf8');
	await page.keyboard.press('Escape');
	await inputPickBanner.waitFor({ state: 'detached', timeout: 10_000 });
	await page.waitForFunction(targetPath => {
		const slot = document.querySelector(
			`.basehalf-video-composer[data-node-path="${CSS.escape(targetPath)}"] .basehalf-video-frame-slot[data-frame-role="first-frame"]`
		);
		return document.activeElement === slot?.querySelector('.basehalf-video-frame-slot-open');
	}, canvasPath, { timeout: 10_000 });
	if (fs.readFileSync(nodePath, 'utf8') !== nodeBeforeCancelledPick
		|| fs.readFileSync(canvasYamlPath, 'utf8') !== canvasBeforeCancelledPick) {
		throw new Error('Cancelling Video input pick changed the target document or graph');
	}

	const addInputTrigger = composer.locator('.basehalf-video-input-add-trigger');
	const addInputHit = await addInputTrigger.evaluate(button => {
		const bounds = button.getBoundingClientRect();
		const x = bounds.x + bounds.width / 2;
		const y = bounds.y + bounds.height / 2;
		const hit = document.elementFromPoint(x, y);
		return {
			bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
			hitsTrigger: hit === button || button.contains(hit),
			hitStack: document.elementsFromPoint(x, y).slice(0, 6).map(element => ({
				tag: element.tagName,
				className: element.getAttribute('class'),
				ariaLabel: element.getAttribute('aria-label')
			}))
		};
	});
	if (!addInputHit.hitsTrigger) {
		throw new Error(`Add input pointer region was covered by another canvas control: ${JSON.stringify(addInputHit)}`);
	}
	await addInputTrigger.click();
	const addInputAfterClick = await page.evaluate(targetPath => {
		const surface = document.querySelector(`.basehalf-video-composer[data-node-path="${CSS.escape(targetPath)}"]`);
		return {
			expanded: surface?.querySelector('.basehalf-video-input-add-trigger')?.getAttribute('aria-expanded'),
			popoverCount: surface?.querySelectorAll('.basehalf-video-composer-popover.inputs').length
		};
	}, canvasPath);
	if (addInputAfterClick.expanded !== 'true' || addInputAfterClick.popoverCount !== 1) {
		throw new Error(`Add input pointer activation did not open Inputs: ${JSON.stringify({ addInputHit, addInputAfterClick })}`);
	}
	await inputsPopover.waitFor({ state: 'visible', timeout: 10_000 });
	const startPickFromInputs = inputsPopover.getByRole('button', { name: 'Pick Start Frame from canvas', exact: true });
	await startPickFromInputs.waitFor({ state: 'visible', timeout: 10_000 });
	await startPickFromInputs.click();
	await inputPickBanner.waitFor({ state: 'visible', timeout: 10_000 });
	await inputPickBanner.getByRole('button', { name: 'Cancel', exact: true }).click();
	await inputPickBanner.waitFor({ state: 'detached', timeout: 10_000 });
	await inputsPopover.waitFor({ state: 'visible', timeout: 10_000 });
	await page.waitForFunction(targetPath => {
		const popover = document.querySelector(
			`.basehalf-video-composer[data-node-path="${CSS.escape(targetPath)}"] .basehalf-video-composer-popover.inputs`
		);
		const origin = Array.from(popover?.querySelectorAll<HTMLButtonElement>('.basehalf-video-input-pick-action') ?? [])
			.find(button => button.textContent?.trim() === 'Pick Start Frame from canvas');
		return origin !== undefined && document.activeElement === origin;
	}, canvasPath, { timeout: 10_000 });
	await page.keyboard.press('Escape');
	await inputsPopover.waitFor({ state: 'hidden', timeout: 10_000 });
	await page.waitForFunction(targetPath => {
		const addInput = document.querySelector(
			`.basehalf-video-composer[data-node-path="${CSS.escape(targetPath)}"] .basehalf-video-input-add-trigger`
		);
		return document.activeElement === addInput;
	}, canvasPath, { timeout: 10_000 });

	await composer.locator('.basehalf-video-frame-slot[data-frame-role="first-frame"] .basehalf-video-frame-slot-open').click();
	await page.waitForFunction(({ sourcePath, targetPath }) => document.querySelector(
		`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(sourcePath)}"]`
	)?.classList.contains('basehalf-video-input-pick-eligible') === true
		&& document.querySelector(
			`.basehalf-video-input-pick-banner[data-target-node-path="${CSS.escape(targetPath)}"]`
		)?.textContent?.includes('Select a highlighted card') === true,
	{ sourcePath: startFramePath, targetPath: canvasPath }, { timeout: 10_000 });
	for (let attempt = 0; attempt < 5; attempt++) {
		await zoomCanvas(page, 'in');
	}
	let offscreenPickReady = false;
	for (let attempt = 0; attempt < 12; attempt++) {
		const geometry = await page.evaluate(({ sourcePath, targetPath }) => {
			const canvas = document.querySelector<HTMLElement>('.basehalf-canvas-cards');
			const source = document.querySelector<HTMLElement>(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(sourcePath)}"]`);
			const target = document.querySelector<HTMLElement>(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(targetPath)}"]`);
			const targetSurface = document.querySelector<HTMLElement>(`.basehalf-video-composer[data-node-path="${CSS.escape(targetPath)}"]`);
			const viewport = document.querySelector<HTMLElement>('.react-flow__viewport');
			if (!canvas || !source || !target || !viewport) {
				return undefined;
			}
			const canvasRect = canvas.getBoundingClientRect();
			const sourceRect = source.getBoundingClientRect();
			const targetRect = target.getBoundingClientRect();
			return {
				canvas: { x: canvasRect.x, y: canvasRect.y, width: canvasRect.width, height: canvasRect.height },
				source: { x: sourceRect.x, y: sourceRect.y, width: sourceRect.width, height: sourceRect.height },
				target: { x: targetRect.x, y: targetRect.y, width: targetRect.width, height: targetRect.height },
				targetOffscreen: targetSurface?.dataset.visibility === 'anchor-offscreen',
				viewportTransform: getComputedStyle(viewport).transform
			};
		}, { sourcePath: startFramePath, targetPath: canvasPath });
		if (!geometry) {
			throw new Error('Canvas pick geometry was unavailable while navigating to an eligible source');
		}
		const sourceCenterX = geometry.source.x + geometry.source.width / 2;
		const sourceCenterY = geometry.source.y + geometry.source.height / 2;
		const canvasCenterX = geometry.canvas.x + geometry.canvas.width / 2;
		const canvasCenterY = geometry.canvas.y + geometry.canvas.height / 2;
		const targetCenterX = geometry.target.x + geometry.target.width / 2;
		const targetCenterY = geometry.target.y + geometry.target.height / 2;
		const sourceVisible = geometry.source.x >= geometry.canvas.x
			&& geometry.source.y >= geometry.canvas.y
			&& geometry.source.x + geometry.source.width <= geometry.canvas.x + geometry.canvas.width
			&& geometry.source.y + geometry.source.height <= geometry.canvas.y + geometry.canvas.height;
		if (sourceVisible && geometry.targetOffscreen) {
			offscreenPickReady = true;
			break;
		}
		const desiredSourceCenterX = targetCenterX < sourceCenterX
			? geometry.canvas.x + geometry.source.width / 2 + 24
			: geometry.canvas.x + geometry.canvas.width - geometry.source.width / 2 - 24;
		const desiredSourceCenterY = targetCenterY < sourceCenterY
			? geometry.canvas.y + geometry.source.height / 2 + 24
			: geometry.canvas.y + geometry.canvas.height - geometry.source.height / 2 - 24;
		const deltaX = Math.max(-480, Math.min(480, sourceCenterX - (Number.isFinite(desiredSourceCenterX) ? desiredSourceCenterX : canvasCenterX)));
		const deltaY = Math.max(-320, Math.min(320, sourceCenterY - (Number.isFinite(desiredSourceCenterY) ? desiredSourceCenterY : canvasCenterY)));
		await page.mouse.move(geometry.canvas.x + 20, geometry.canvas.y + 20);
		await page.mouse.wheel(deltaX, deltaY);
		await page.waitForFunction(previous => {
			const viewport = document.querySelector<HTMLElement>('.react-flow__viewport');
			return !!viewport && getComputedStyle(viewport).transform !== previous;
		}, geometry.viewportTransform, { timeout: 10_000 });
	}
	if (!offscreenPickReady) {
		throw new Error('Canvas pan/zoom could not expose the eligible source with the target Composer suspended');
	}
	const offscreenViewportBeforeCommit = await page.locator('.react-flow__viewport').evaluate(viewport => getComputedStyle(viewport).transform);
	await startFrame.focus();
	await page.keyboard.press('Enter');
	await inputPickBanner.waitFor({ state: 'detached', timeout: 15_000 });
	const offscreenCommit = await page.evaluate(targetPath => {
		const surface = document.querySelector<HTMLElement>(`.basehalf-video-composer[data-node-path="${CSS.escape(targetPath)}"]`);
		const viewport = document.querySelector<HTMLElement>('.react-flow__viewport');
		return {
			visibility: surface?.dataset.visibility,
			inputsPopoverOpen: surface?.querySelector('.basehalf-video-composer-popover.inputs') !== null,
			viewportTransform: viewport ? getComputedStyle(viewport).transform : undefined
		};
	}, canvasPath);
	if (offscreenCommit.visibility !== 'anchor-offscreen'
		|| offscreenCommit.inputsPopoverOpen
		|| offscreenCommit.viewportTransform !== offscreenViewportBeforeCommit) {
		throw new Error(`Off-screen input completion moved the viewport or focused a hidden surface: ${JSON.stringify({ offscreenCommit, offscreenViewportBeforeCommit })}`);
	}
	await zoomCanvas(page, 'reset');
	for (let attempt = 0; attempt < 12; attempt++) {
		const geometry = await page.evaluate(targetPath => {
			const canvas = document.querySelector<HTMLElement>('.basehalf-canvas-cards');
			const target = document.querySelector<HTMLElement>(`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(targetPath)}"]`);
			const surface = document.querySelector<HTMLElement>(`.basehalf-video-composer[data-node-path="${CSS.escape(targetPath)}"]`);
			const viewport = document.querySelector<HTMLElement>('.react-flow__viewport');
			if (!canvas || !target || !viewport) {
				return undefined;
			}
			const canvasRect = canvas.getBoundingClientRect();
			const targetRect = target.getBoundingClientRect();
			return {
				visible: surface?.dataset.visibility !== 'anchor-offscreen',
				canvas: { x: canvasRect.x, y: canvasRect.y, width: canvasRect.width, height: canvasRect.height },
				target: { x: targetRect.x, y: targetRect.y, width: targetRect.width, height: targetRect.height },
				viewportTransform: getComputedStyle(viewport).transform
			};
		}, canvasPath);
		if (!geometry) {
			throw new Error('Target geometry was unavailable while restoring deferred input focus');
		}
		if (geometry.visible) {
			break;
		}
		const deltaX = Math.max(-480, Math.min(480,
			geometry.target.x + geometry.target.width / 2 - (geometry.canvas.x + geometry.canvas.width / 2)));
		const deltaY = Math.max(-320, Math.min(320,
			geometry.target.y + geometry.target.height / 2 - (geometry.canvas.y + geometry.canvas.height / 2)));
		await page.mouse.move(geometry.canvas.x + 20, geometry.canvas.y + 20);
		await page.mouse.wheel(deltaX, deltaY);
		await page.waitForFunction(previous => {
			const viewport = document.querySelector<HTMLElement>('.react-flow__viewport');
			return !!viewport && getComputedStyle(viewport).transform !== previous;
		}, geometry.viewportTransform, { timeout: 10_000 });
	}
	await page.waitForFunction(targetPath => {
		const surface = document.querySelector<HTMLElement>(`.basehalf-video-composer[data-node-path="${CSS.escape(targetPath)}"]`);
		const slot = surface?.querySelector<HTMLElement>('.basehalf-video-frame-slot[data-frame-role="first-frame"]');
		return surface?.dataset.visibility !== 'anchor-offscreen'
			&& !!slot
			&& (document.activeElement === slot.querySelector('.basehalf-video-frame-slot-open'));
	}, canvasPath, { timeout: 15_000 });
	await settingsTrigger.focus();
	const viewportBeforeDeferredFocusProbe = await page.locator('.react-flow__viewport').evaluate(viewport => getComputedStyle(viewport).transform);
	await page.mouse.move(paneBox.x + 26, paneBox.y + 26);
	await page.mouse.wheel(2, -1);
	await page.waitForFunction(previous => {
		const viewport = document.querySelector<HTMLElement>('.react-flow__viewport');
		return !!viewport && getComputedStyle(viewport).transform !== previous;
	}, viewportBeforeDeferredFocusProbe, { timeout: 10_000 });
	if (!await settingsTrigger.evaluate(element => document.activeElement === element)) {
		throw new Error('A later viewport update replayed the already-consumed deferred input focus');
	}
	await page.waitForFunction(({ targetPath, sourcePath }) => {
		const surface = document.querySelector(`.basehalf-video-composer[data-node-path="${CSS.escape(targetPath)}"]`);
		const start = surface?.querySelector<HTMLElement>('.basehalf-video-frame-slot[data-frame-role="first-frame"]');
		const end = surface?.querySelector<HTMLElement>('.basehalf-video-frame-slot[data-frame-role="last-frame"]');
		return start?.classList.contains('empty') === false
			&& start?.textContent?.includes(sourcePath.split('/').at(-1) ?? sourcePath)
			&& end?.classList.contains('empty') === true;
	}, { targetPath: canvasPath, sourcePath: startFramePath }, { timeout: 15_000 });
	const startOnlyNodeContents = fs.readFileSync(nodePath, 'utf8');

	await composer.locator('.basehalf-video-frame-slot[data-frame-role="last-frame"] .basehalf-video-frame-slot-open').click();
	await page.waitForFunction(({ sourcePath, targetPath }) => document.querySelector(
		`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(sourcePath)}"]`
	)?.classList.contains('basehalf-video-input-pick-eligible') === true
		&& document.querySelector(
			`.basehalf-video-input-pick-banner[data-target-node-path="${CSS.escape(targetPath)}"]`
		)?.textContent?.includes('Select a highlighted card') === true,
	{ sourcePath: endFramePath, targetPath: canvasPath }, { timeout: 10_000 });
	await endFrame.focus();
	await page.keyboard.press('Enter');
	await page.waitForFunction(({ targetPath, startPath, endPath }) => {
		const surface = document.querySelector(`.basehalf-video-composer[data-node-path="${CSS.escape(targetPath)}"]`);
		const start = surface?.querySelector<HTMLElement>('.basehalf-video-frame-slot[data-frame-role="first-frame"]');
		const end = surface?.querySelector<HTMLElement>('.basehalf-video-frame-slot[data-frame-role="last-frame"]');
		return start?.textContent?.includes(startPath.split('/').at(-1) ?? startPath)
			&& end?.textContent?.includes(endPath.split('/').at(-1) ?? endPath)
			&& surface?.querySelector('.basehalf-video-frame-swap') !== null;
	}, { targetPath: canvasPath, startPath: startFramePath, endPath: endFramePath }, { timeout: 15_000 });
	await waitUntil(() => {
		const saved = JSON.parse(fs.readFileSync(nodePath, 'utf8'));
		const bindings = saved.recipe?.inputBindings ?? [];
		const canvas = fs.readFileSync(canvasYamlPath, 'utf8');
		const targetBadge = fs.existsSync(targetBadgePath) ? fs.readFileSync(targetBadgePath, 'utf8') : '';
		const startBadge = fs.existsSync(startFrameBadgePath) ? fs.readFileSync(startFrameBadgePath, 'utf8') : '';
		const endBadge = fs.existsSync(endFrameBadgePath) ? fs.readFileSync(endFrameBadgePath, 'utf8') : '';
		return bindings.length === 2
			&& bindings.some(binding => binding.sourcePath === startFramePath && binding.slot === 'first-frame' && typeof binding.sourceRevision === 'string')
			&& bindings.some(binding => binding.sourcePath === endFramePath && binding.slot === 'last-frame' && typeof binding.sourceRevision === 'string')
			&& saved.recipe?.parameters?.videoModelSnapshot?.inputs?.['first-frame'] === 1
			&& saved.recipe?.parameters?.videoModelSnapshot?.inputs?.['last-frame'] === 1
			&& canvas.split('\nedges:\n')[1]?.split(`to: "${canvasPath}"`).length === 3
			&& targetBadge.includes(startFramePath)
			&& targetBadge.includes(endFramePath)
			&& startBadge.includes(canvasPath)
			&& endBadge.includes(canvasPath);
	}, 'Video Start and End bindings plus two graph edges to persist', 15_000);
	const twoFrameNodeContents = fs.readFileSync(nodePath, 'utf8');
	const twoFrameCanvasContents = fs.readFileSync(canvasYamlPath, 'utf8');

	await composer.locator('.basehalf-video-frame-slot[data-frame-role="last-frame"] .basehalf-video-frame-slot-open').focus();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
	await page.waitForFunction(({ targetPath, startPath }) => {
		const surface = document.querySelector(`.basehalf-video-composer[data-node-path="${CSS.escape(targetPath)}"]`);
		const start = surface?.querySelector<HTMLElement>('.basehalf-video-frame-slot[data-frame-role="first-frame"]');
		const end = surface?.querySelector<HTMLElement>('.basehalf-video-frame-slot[data-frame-role="last-frame"]');
		return start?.textContent?.includes(startPath.split('/').at(-1) ?? startPath) === true
			&& end?.classList.contains('empty') === true;
	}, { targetPath: canvasPath, startPath: startFramePath }, { timeout: 15_000 });
	await waitUntil(() => {
		const saved = JSON.parse(fs.readFileSync(nodePath, 'utf8'));
		const bindings = saved.recipe?.inputBindings ?? [];
		const canvas = fs.readFileSync(canvasYamlPath, 'utf8');
		const targetBadge = fs.existsSync(targetBadgePath) ? fs.readFileSync(targetBadgePath, 'utf8') : '';
		const startBadge = fs.existsSync(startFrameBadgePath) ? fs.readFileSync(startFrameBadgePath, 'utf8') : '';
		const endBadge = fs.existsSync(endFrameBadgePath) ? fs.readFileSync(endFrameBadgePath, 'utf8') : '';
		return bindings.length === 1
			&& bindings[0]?.sourcePath === startFramePath
			&& bindings[0]?.slot === 'first-frame'
			&& saved.recipe?.parameters?.videoModelSnapshot?.inputs?.['first-frame'] === 1
			&& saved.recipe?.parameters?.videoModelSnapshot?.inputs?.['last-frame'] === undefined
			&& canvas.includes(`from: "${startFramePath}"`)
			&& !canvas.includes(`from: "${endFramePath}"`)
			&& targetBadge.includes(startFramePath)
			&& !targetBadge.includes(endFramePath)
			&& startBadge.includes(canvasPath)
			&& !endBadge.includes(canvasPath);
	}, 'Undo to atomically remove the End binding, reciprocal reference, and canvas edge', 15_000);

	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y');
	await page.waitForFunction(({ targetPath, startPath, endPath }) => {
		const surface = document.querySelector(`.basehalf-video-composer[data-node-path="${CSS.escape(targetPath)}"]`);
		const start = surface?.querySelector<HTMLElement>('.basehalf-video-frame-slot[data-frame-role="first-frame"]');
		const end = surface?.querySelector<HTMLElement>('.basehalf-video-frame-slot[data-frame-role="last-frame"]');
		return start?.textContent?.includes(startPath.split('/').at(-1) ?? startPath) === true
			&& end?.textContent?.includes(endPath.split('/').at(-1) ?? endPath) === true;
	}, { targetPath: canvasPath, startPath: startFramePath, endPath: endFramePath }, { timeout: 15_000 });
	await waitUntil(() => {
		const saved = JSON.parse(fs.readFileSync(nodePath, 'utf8'));
		const bindings = saved.recipe?.inputBindings ?? [];
		const canvas = fs.readFileSync(canvasYamlPath, 'utf8');
		const targetBadge = fs.existsSync(targetBadgePath) ? fs.readFileSync(targetBadgePath, 'utf8') : '';
		const startBadge = fs.existsSync(startFrameBadgePath) ? fs.readFileSync(startFrameBadgePath, 'utf8') : '';
		const endBadge = fs.existsSync(endFrameBadgePath) ? fs.readFileSync(endFrameBadgePath, 'utf8') : '';
		return bindings.length === 2
			&& bindings.some(binding => binding.sourcePath === startFramePath && binding.slot === 'first-frame')
			&& bindings.some(binding => binding.sourcePath === endFramePath && binding.slot === 'last-frame')
			&& canvas.includes(`from: "${startFramePath}"`)
			&& canvas.includes(`from: "${endFramePath}"`)
			&& targetBadge.includes(startFramePath)
			&& targetBadge.includes(endFramePath)
			&& startBadge.includes(canvasPath)
			&& endBadge.includes(canvasPath);
	}, 'Redo to atomically restore the End binding, reciprocal reference, and canvas edge', 15_000);

	await composer.locator('.basehalf-video-frame-slot[data-frame-role="first-frame"] .basehalf-video-frame-slot-replace').click();
	await page.waitForFunction(targetPath => {
		const text = document.querySelector(
			`.basehalf-video-input-pick-banner[data-target-node-path="${CSS.escape(targetPath)}"]`
		)?.textContent ?? '';
		return text.includes('Press Escape to cancel') && !text.includes('Checking saved canvas sources');
	}, canvasPath, { timeout: 15_000 });
	fs.writeFileSync(nodePath, startOnlyNodeContents, 'utf8');
	await inputPickBanner.waitFor({ state: 'detached', timeout: 15_000 });
	await page.waitForFunction(targetPath => {
		const surface = document.querySelector<HTMLElement>(
			`.basehalf-video-composer[data-node-path="${CSS.escape(targetPath)}"]`
		);
		const end = surface?.querySelector<HTMLElement>('.basehalf-video-frame-slot[data-frame-role="last-frame"]');
		const status = surface?.querySelector('.basehalf-node-local-footer-message')?.textContent ?? '';
		return end?.classList.contains('empty') === true
			&& status.trim() === 'Add End Frame.';
	}, canvasPath, { timeout: 15_000 });
	if (fs.readFileSync(nodePath, 'utf8') !== startOnlyNodeContents
		|| fs.readFileSync(canvasYamlPath, 'utf8') !== twoFrameCanvasContents) {
		throw new Error('An external old-configuration write was swallowed or mutated by the pending input pick');
	}

	fs.writeFileSync(nodePath, twoFrameNodeContents, 'utf8');
	await page.waitForFunction(({ targetPath, startPath, endPath }) => {
		const surface = document.querySelector(`.basehalf-video-composer[data-node-path="${CSS.escape(targetPath)}"]`);
		const start = surface?.querySelector<HTMLElement>('.basehalf-video-frame-slot[data-frame-role="first-frame"]');
		const end = surface?.querySelector<HTMLElement>('.basehalf-video-frame-slot[data-frame-role="last-frame"]');
		return start?.textContent?.includes(startPath.split('/').at(-1) ?? startPath) === true
			&& end?.textContent?.includes(endPath.split('/').at(-1) ?? endPath) === true;
	}, { targetPath: canvasPath, startPath: startFramePath, endPath: endFramePath }, { timeout: 15_000 });

	const preservedModelSwitchNode = fs.readFileSync(nodePath, 'utf8');
	const preservedModelSwitchCanvas = fs.readFileSync(canvasYamlPath, 'utf8');
	const preservedModelSwitchChrome = await captureVideoAttachedChrome(page, canvasPath);
	await modelTrigger.click();
	await modelsPopover.waitFor({ state: 'visible', timeout: 10_000 });
	const alternateModel = modelsPopover.locator(
		`.basehalf-video-model-option[data-spec-id="${SMOKE_VIDEO_PROVIDER_SPEC_ID}"][data-model-id="${SMOKE_VIDEO_ALTERNATE_MODEL_ID}"]`
	);
	await alternateModel.waitFor({ state: 'visible', timeout: 10_000 });
	if (await alternateModel.getAttribute('data-model-availability') !== 'available'
		|| await alternateModel.getAttribute('aria-pressed') !== 'false'
		|| await alternateModel.isDisabled()) {
		throw new Error(`The second exact model in the connected scope was not selectable: ${JSON.stringify({
			availability: await alternateModel.getAttribute('data-model-availability'),
			selected: await alternateModel.getAttribute('aria-pressed'),
			disabled: await alternateModel.isDisabled()
		})}`);
	}
	await alternateModel.click();
	await modelsPopover.waitFor({ state: 'hidden', timeout: 10_000 });
	await page.waitForFunction(({ targetPath, label }) => {
		const surface = document.querySelector(`.basehalf-video-composer[data-node-path="${CSS.escape(targetPath)}"]`);
		return surface?.querySelector('.basehalf-video-model-trigger .basehalf-video-trigger-label')?.textContent?.trim() === label;
	}, { targetPath: canvasPath, label: SMOKE_VIDEO_ALTERNATE_MODEL_LABEL }, { timeout: 10_000 });
	const alternateModelInputPresentation = await composer.evaluate((surface, expected) => {
		const slots = [...surface.querySelectorAll<HTMLElement>('.basehalf-video-frame-slot')].map(slot => ({
			role: slot.dataset.frameRole,
			empty: slot.classList.contains('empty'),
			text: slot.textContent?.replace(/\s+/g, ' ').trim()
		}));
		return {
			model: surface.querySelector('.basehalf-video-model-trigger .basehalf-video-trigger-label')?.textContent?.trim(),
			slots,
			startMatches: slots[0]?.text?.includes(expected.startName),
			endMatches: slots[1]?.text?.includes(expected.endName)
		};
	}, { startName: startFramePath.split('/').at(-1), endName: endFramePath.split('/').at(-1) });
	const alternateModelChrome = await captureVideoAttachedChrome(page, canvasPath);
	if (fs.readFileSync(nodePath, 'utf8') !== preservedModelSwitchNode
		|| fs.readFileSync(canvasYamlPath, 'utf8') !== preservedModelSwitchCanvas
		|| alternateModelInputPresentation.model !== SMOKE_VIDEO_ALTERNATE_MODEL_LABEL
		|| alternateModelInputPresentation.slots.map(slot => slot.role).join(',') !== 'first-frame,last-frame'
		|| alternateModelInputPresentation.slots.some(slot => slot.empty)
		|| !alternateModelInputPresentation.startMatches
		|| !alternateModelInputPresentation.endMatches
		|| alternateModelChrome.promptValue !== preservedModelSwitchChrome.promptValue
		|| alternateModelChrome.viewportTransform !== preservedModelSwitchChrome.viewportTransform) {
		throw new Error(`Changing exact models rewrote inputs, graph, prompt, or viewport before review: ${JSON.stringify({
			presentation: alternateModelInputPresentation,
			promptBefore: preservedModelSwitchChrome.promptValue,
			promptAfter: alternateModelChrome.promptValue,
			viewportBefore: preservedModelSwitchChrome.viewportTransform,
			viewportAfter: alternateModelChrome.viewportTransform,
			nodeChanged: fs.readFileSync(nodePath, 'utf8') !== preservedModelSwitchNode,
			canvasChanged: fs.readFileSync(canvasYamlPath, 'utf8') !== preservedModelSwitchCanvas
		})}`);
	}

	await settingsTrigger.click();
	await settingsPopover.waitFor({ state: 'visible', timeout: 10_000 });
	const modelAdjustmentDetails = await settingsPopover.locator('.basehalf-video-settings-adjustments li').allTextContents();
	if (modelAdjustmentDetails.length !== 1
		|| !modelAdjustmentDetails[0].includes('Fixed Camera')
		|| !modelAdjustmentDetails[0].includes('Off')
		|| !modelAdjustmentDetails[0].includes('No compatible saved value was present.')) {
		throw new Error(`The exact-model switch did not expose its complete scalar adjustment detail: ${JSON.stringify(modelAdjustmentDetails)}`);
	}
	await page.keyboard.press('Escape');
	await settingsPopover.waitFor({ state: 'hidden', timeout: 10_000 });

	await composer.locator('.basehalf-video-frame-slot[data-frame-role="first-frame"] .basehalf-video-frame-slot-remove').click();
	await page.waitForFunction(targetPath => {
		const surface = document.querySelector(`.basehalf-video-composer[data-node-path="${CSS.escape(targetPath)}"]`);
		return surface?.querySelector('.basehalf-video-frame-slot[data-frame-role="first-frame"]')?.classList.contains('empty') === true
			&& surface?.querySelector('.basehalf-video-frame-slot[data-frame-role="last-frame"]')?.classList.contains('empty') === false;
	}, canvasPath, { timeout: 15_000 });
	await settingsTrigger.click();
	await settingsPopover.waitFor({ state: 'visible', timeout: 10_000 });
	const blockerBeforeCheckpoint = await settingsPopover.locator('.basehalf-video-capability-status').textContent();
	const adjustmentsBeforeCheckpoint = await settingsPopover.locator('.basehalf-video-settings-adjustments li').allTextContents();
	if (blockerBeforeCheckpoint?.trim() !== 'Add Start Frame.'
		|| JSON.stringify(adjustmentsBeforeCheckpoint) !== JSON.stringify(modelAdjustmentDetails)) {
		throw new Error(`The missing-input blocker did not outrank the complete model adjustment detail: ${JSON.stringify({
			blockerBeforeCheckpoint,
			adjustmentsBeforeCheckpoint,
			modelAdjustmentDetails
		})}`);
	}
	await page.keyboard.press('Escape');
	await settingsPopover.waitFor({ state: 'hidden', timeout: 10_000 });

	await composer.locator('.basehalf-video-frame-slot[data-frame-role="first-frame"] .basehalf-video-frame-slot-open').click();
	await inputPickBanner.waitFor({ state: 'visible', timeout: 15_000 });
	await page.keyboard.press('Escape');
	await inputPickBanner.waitFor({ state: 'detached', timeout: 10_000 });
	await waitUntil(() => {
		const saved = JSON.parse(fs.readFileSync(nodePath, 'utf8'));
		return saved.recipe?.modelId === SMOKE_VIDEO_ALTERNATE_MODEL_ID
			&& saved.recipe?.inputBindings?.length === 1
			&& saved.recipe.inputBindings[0]?.sourcePath === endFramePath
			&& saved.recipe.inputBindings[0]?.slot === 'last-frame';
	}, 'the alternate exact model checkpoint to persist before a cancelled Start pick', 15_000);
	await settingsTrigger.click();
	await settingsPopover.waitFor({ state: 'visible', timeout: 10_000 });
	const blockerAfterCheckpoint = await settingsPopover.locator('.basehalf-video-capability-status').textContent();
	const adjustmentsAfterCheckpoint = await settingsPopover.locator('.basehalf-video-settings-adjustments li').allTextContents();
	if (blockerAfterCheckpoint?.trim() !== 'Add Start Frame.'
		|| JSON.stringify(adjustmentsAfterCheckpoint) !== JSON.stringify(modelAdjustmentDetails)) {
		throw new Error(`Input checkpoint and Cancel lost the reviewable blocker or adjustment detail: ${JSON.stringify({
			blockerAfterCheckpoint,
			adjustmentsAfterCheckpoint,
			modelAdjustmentDetails
		})}`);
	}
	await page.keyboard.press('Escape');
	await settingsPopover.waitFor({ state: 'hidden', timeout: 10_000 });

	await composer.locator('.basehalf-video-frame-slot[data-frame-role="first-frame"] .basehalf-video-frame-slot-open').click();
	await inputPickBanner.waitFor({ state: 'visible', timeout: 10_000 });
	await page.waitForFunction(({ sourcePath, targetPath }) => document.querySelector(
		`.basehalf-canvas-card[data-basehalf-card-path="${CSS.escape(sourcePath)}"]`
	)?.classList.contains('basehalf-video-input-pick-eligible') === true
		&& document.querySelector(
			`.basehalf-video-input-pick-banner[data-target-node-path="${CSS.escape(targetPath)}"]`
		)?.textContent?.includes('Select a highlighted card') === true,
	{ sourcePath: startFramePath, targetPath: canvasPath }, { timeout: 10_000 });
	await startFrame.focus();
	await page.keyboard.press('Enter');
	await page.waitForFunction(({ targetPath, sourcePath }) => {
		const surface = document.querySelector(`.basehalf-video-composer[data-node-path="${CSS.escape(targetPath)}"]`);
		const start = surface?.querySelector<HTMLElement>('.basehalf-video-frame-slot[data-frame-role="first-frame"]');
		return start?.classList.contains('empty') === false
			&& start.textContent?.includes(sourcePath.split('/').at(-1) ?? sourcePath) === true;
	}, { targetPath: canvasPath, sourcePath: startFramePath }, { timeout: 15_000 });
	await waitUntil(() => {
		const saved = JSON.parse(fs.readFileSync(nodePath, 'utf8'));
		const bindings = saved.recipe?.inputBindings ?? [];
		const canvas = fs.readFileSync(canvasYamlPath, 'utf8');
		return bindings.length === 2
			&& bindings.some(binding => binding.sourcePath === startFramePath && binding.slot === 'first-frame')
			&& bindings.some(binding => binding.sourcePath === endFramePath && binding.slot === 'last-frame')
			&& canvas.split('\nedges:\n')[1]?.split(`to: "${canvasPath}"`).length === 3;
	}, 'the Start binding and its graph edge to be restored after adjustment review', 15_000);

	await modelTrigger.click();
	await modelsPopover.waitFor({ state: 'visible', timeout: 10_000 });
	const originalModel = modelsPopover.locator(
		`.basehalf-video-model-option[data-spec-id="${SMOKE_VIDEO_PROVIDER_SPEC_ID}"][data-model-id="${SMOKE_VIDEO_MODEL_ID}"]`
	);
	await originalModel.click();
	await modelsPopover.waitFor({ state: 'hidden', timeout: 10_000 });
	await page.waitForFunction(({ targetPath, label }) => {
		const surface = document.querySelector(`.basehalf-video-composer[data-node-path="${CSS.escape(targetPath)}"]`);
		return surface?.querySelector('.basehalf-video-model-trigger .basehalf-video-trigger-label')?.textContent?.trim() === label;
	}, { targetPath: canvasPath, label: SMOKE_VIDEO_MODEL_LABEL }, { timeout: 10_000 });
	const restoredModelCanvas = fs.readFileSync(canvasYamlPath, 'utf8');
	await composer.locator('.basehalf-video-frame-slot[data-frame-role="first-frame"] .basehalf-video-frame-slot-replace').click();
	await inputPickBanner.waitFor({ state: 'visible', timeout: 15_000 });
	await page.keyboard.press('Escape');
	await inputPickBanner.waitFor({ state: 'detached', timeout: 10_000 });
	await waitUntil(() => {
		const saved = JSON.parse(fs.readFileSync(nodePath, 'utf8'));
		return saved.recipe?.modelId === SMOKE_VIDEO_MODEL_ID
			&& saved.recipe?.inputBindings?.length === 2
			&& saved.recipe.inputBindings.some(binding => binding.sourcePath === startFramePath && binding.slot === 'first-frame')
			&& saved.recipe.inputBindings.some(binding => binding.sourcePath === endFramePath && binding.slot === 'last-frame');
	}, 'the original exact model to persist after a cancelled replacement pick', 15_000);
	const restoredModelChrome = await captureVideoAttachedChrome(page, canvasPath);
	const restoredModelSlots = await composer.locator('.basehalf-video-frame-slot').evaluateAll(slots => slots.map(slot => ({
		role: (slot as HTMLElement).dataset.frameRole,
		empty: slot.classList.contains('empty')
	})));
	if (fs.readFileSync(canvasYamlPath, 'utf8') !== restoredModelCanvas
		|| restoredModelSlots.map(slot => slot.role).join(',') !== 'first-frame,last-frame'
		|| restoredModelSlots.some(slot => slot.empty)
		|| restoredModelChrome.promptValue !== preservedModelSwitchChrome.promptValue
		|| restoredModelChrome.viewportTransform !== preservedModelSwitchChrome.viewportTransform) {
		throw new Error(`Restoring the original exact model changed graph, slot roles, prompt, or viewport: ${JSON.stringify({
			restoredModelSlots,
			promptBefore: preservedModelSwitchChrome.promptValue,
			promptAfter: restoredModelChrome.promptValue,
			viewportBefore: preservedModelSwitchChrome.viewportTransform,
			viewportAfter: restoredModelChrome.viewportTransform,
			canvasChanged: fs.readFileSync(canvasYamlPath, 'utf8') !== restoredModelCanvas
		})}`);
	}

	fs.rmSync(path.join(workspacePath, startFramePath));
	await startFrame.waitFor({ state: 'detached', timeout: 15_000 });
	await page.waitForFunction(({ targetPath, sourcePath }) => {
		const surface = document.querySelector<HTMLElement>(
			`.basehalf-video-composer[data-node-path="${CSS.escape(targetPath)}"]`
		);
		const slot = document.querySelector<HTMLElement>(
			`.basehalf-video-composer[data-node-path="${CSS.escape(targetPath)}"] .basehalf-video-frame-slot[data-frame-role="first-frame"]`
		);
		const remove = slot?.querySelector<HTMLButtonElement>('.basehalf-video-frame-slot-remove');
		const status = surface?.querySelector('.basehalf-node-local-footer-message')?.textContent ?? '';
		return slot?.classList.contains('empty') === false
			&& slot?.textContent?.includes(sourcePath.split('/').at(-1) ?? sourcePath) === true
			&& remove?.disabled === false
			&& status.includes(sourcePath)
			&& status.includes('missing');
	}, { targetPath: canvasPath, sourcePath: startFramePath }, { timeout: 15_000 });
	const missingSourceBinding = JSON.parse(fs.readFileSync(nodePath, 'utf8')).recipe?.inputBindings
		?.find(binding => binding.sourcePath === startFramePath);
	if (missingSourceBinding?.slot !== 'first-frame') {
		throw new Error('Deleting a bound Start source silently removed or relabelled its durable binding');
	}

	await composer.locator('.basehalf-video-frame-slot[data-frame-role="first-frame"] .basehalf-video-frame-slot-remove').click();
	await page.waitForFunction(targetPath => {
		const surface = document.querySelector(`.basehalf-video-composer[data-node-path="${CSS.escape(targetPath)}"]`);
		return surface?.querySelector('.basehalf-video-frame-slot[data-frame-role="first-frame"]')?.classList.contains('empty') === true
			&& surface?.querySelector('.basehalf-video-frame-slot[data-frame-role="last-frame"]')?.classList.contains('empty') === false;
	}, canvasPath, { timeout: 15_000 });
	await waitUntil(() => {
		const saved = JSON.parse(fs.readFileSync(nodePath, 'utf8'));
		const bindings = saved.recipe?.inputBindings ?? [];
		const canvas = fs.readFileSync(canvasYamlPath, 'utf8');
		const targetBadge = fs.existsSync(targetBadgePath) ? fs.readFileSync(targetBadgePath, 'utf8') : '';
		const startBadge = fs.existsSync(startFrameBadgePath) ? fs.readFileSync(startFrameBadgePath, 'utf8') : '';
		return bindings.length === 1
			&& bindings[0]?.sourcePath === endFramePath
			&& bindings[0]?.slot === 'last-frame'
			&& saved.recipe?.parameters?.videoModelSnapshot?.inputs?.['first-frame'] === undefined
			&& saved.recipe?.parameters?.videoModelSnapshot?.inputs?.['last-frame'] === 1
			&& !canvas.includes(`from: "${startFramePath}"`)
			&& canvas.includes(`from: "${endFramePath}"`)
			&& !targetBadge.includes(startFramePath)
			&& targetBadge.includes(endFramePath)
			&& !startBadge.includes(canvasPath);
	}, 'missing Video Start source removal to atomically clear its binding, reference pair, and canvas edge', 15_000);

	await composer.locator('.basehalf-video-frame-slot[data-frame-role="last-frame"] .basehalf-video-frame-slot-remove').click();
	await page.waitForFunction(targetPath => document.querySelector(
		`.basehalf-video-composer[data-node-path="${CSS.escape(targetPath)}"] .basehalf-video-frame-slot[data-frame-role="last-frame"]`
	)?.classList.contains('empty') === true, canvasPath, { timeout: 15_000 });
	await waitUntil(() => {
		const saved = JSON.parse(fs.readFileSync(nodePath, 'utf8'));
		const canvas = fs.readFileSync(canvasYamlPath, 'utf8');
		return (saved.recipe?.inputBindings?.length ?? 0) === 0
			&& !canvas.split('\nedges:\n')[1]?.includes(`to: "${canvasPath}"`);
	}, 'Video frame removals to clear both bindings and graph edges', 15_000);

	await settingsTrigger.click();
	await settingsPopover.waitFor({ state: 'visible', timeout: 10_000 });
	if (await settingsPopover.locator('select.basehalf-video-method-listbox').count() === 1) {
		await settingsPopover.locator('select.basehalf-video-method-listbox').selectOption('text-to-video');
	} else {
		await settingsPopover.getByRole('radio', { name: 'Text to Video', exact: true }).click();
	}
	await page.waitForFunction(path => {
		const surface = document.querySelector(`.basehalf-video-composer[data-node-path="${CSS.escape(path)}"]`);
		const popover = surface?.querySelector<HTMLElement>('.basehalf-video-composer-popover.settings');
		const selectedMethod = popover?.querySelector<HTMLElement>('.basehalf-video-mode-segmented [role="radio"][aria-checked="true"]')?.textContent?.trim()
			?? popover?.querySelector<HTMLSelectElement>('select.basehalf-video-method-listbox')?.value;
		return (selectedMethod === 'Text to Video' || selectedMethod === 'text-to-video')
			&& surface?.querySelector<HTMLButtonElement>('.basehalf-video-composer-primary')?.disabled === false
			&& surface.querySelector('.basehalf-video-frame-strip') === null;
	}, canvasPath, { timeout: 10_000 });
	stableComposerContext = await captureVideoAttachedChrome(page, canvasPath);
	assertVideoComposerState(stableComposerContext, expectedDraftState, 'after returning the incomplete frame method to Text to Video');
	assertVideoComposerBelowCard(stableComposerContext, 'after returning the incomplete frame method to Text to Video');

	await page.keyboard.press('Escape');
	await settingsPopover.waitFor({ state: 'hidden', timeout: 10_000 });
	await composer.waitFor({ state: 'visible', timeout: 10_000 });
	await page.waitForFunction(path => {
		const surface = document.querySelector(`.basehalf-video-composer[data-node-path="${path}"]`);
		return surface instanceof HTMLElement
			&& document.activeElement === surface.querySelector('.basehalf-video-settings-trigger[data-video-composer-trigger="settings"]');
	}, canvasPath, { timeout: 10_000 });
	await waitForVideoChromeFrames(page);
	const overlayClosedContext = await captureVideoAttachedChrome(page, canvasPath);
	assertVideoComposerState(overlayClosedContext, expectedDraftState, 'after Escape closed settings');
	assertVideoComposerBelowCard(overlayClosedContext, 'after Escape closed settings');
	assertVideoChromeLayoutUnchanged(stableComposerContext, overlayClosedContext, 'after Escape closed settings');
	if (await composer.locator('.basehalf-video-composer-popover:visible').count() !== 0
		|| await settingsTrigger.getAttribute('aria-expanded') !== 'false') {
		throw new Error('The first Escape did not close only the Video settings popover');
	}
	const paidRunDialog = page.locator('.monaco-dialog-box', { hasText: 'The provider determines the exact charge.' }).first();
	await composer.locator('.basehalf-video-composer-primary[data-node-action="run"]').click();
	await paidRunDialog.waitFor({ state: 'visible', timeout: 20_000 });
	const paidRunCopy = (await paidRunDialog.textContent())?.replace(/\s+/g, ' ').trim() ?? '';
	if (!paidRunCopy.includes(SMOKE_VIDEO_MODEL_LABEL)
		|| !paidRunCopy.includes('Method: Text to Video')
		|| !paidRunCopy.includes('This action may create a paid provider task.')) {
		throw new Error(`Video paid-run disclosure omitted request material: ${paidRunCopy}`);
	}
	await paidRunDialog.locator('.monaco-button', { hasText: /^Cancel$/ }).click();
	await paidRunDialog.waitFor({ state: 'hidden', timeout: 10_000 });
	const cancelledDisclosureDocument = JSON.parse(fs.readFileSync(nodePath, 'utf8'));
	if ((cancelledDisclosureDocument.attempts?.length ?? 0) !== 0 || cancelledDisclosureDocument.result !== undefined) {
		throw new Error('Cancelling the paid-run disclosure created an Attempt or Result');
	}
	stableComposerContext = overlayClosedContext;

	await page.keyboard.press('Escape');
	await page.waitForFunction(path => {
		const card = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${path}"]`);
		const composer = document.querySelector(`.basehalf-video-composer[data-node-path="${path}"]`);
		return card instanceof HTMLElement && composer instanceof HTMLElement && composer.offsetParent !== null
			&& (document.activeElement === card || card.contains(document.activeElement));
	}, canvasPath, { timeout: 10_000 });
	await waitForVideoChromeFrames(page);
	const cardFocusedContext = await captureVideoAttachedChrome(page, canvasPath);
	assertVideoComposerState(cardFocusedContext, expectedDraftState, 'after Escape returned focus to the selected card');
	assertVideoComposerBelowCard(cardFocusedContext, 'after Escape returned focus to the selected card');
	if (!cardFocusedContext.cardFocused || cardFocusedContext.visiblePopoverCount !== 0) {
		throw new Error(`Escape did not return focus to the selected Video card while retaining its Composer: ${JSON.stringify(cardFocusedContext)}`);
	}
	stableComposerContext = cardFocusedContext;

	const agentAreaWasVisible = await page.locator('.basehalf-agent-area:visible').count() > 0;
	let canvasWidthBeforeAgentArea = stableComposerContext.canvas.width;
	if (agentAreaWasVisible) {
		await runCommand(page, 'Toggle Agent Area');
		await page.locator('.basehalf-agent-area').waitFor({ state: 'hidden', timeout: 15_000 });
		await page.waitForFunction(previousWidth => {
			const canvas = document.querySelector('.basehalf-canvas-cards');
			return canvas instanceof HTMLElement && canvas.getBoundingClientRect().width >= previousWidth + 40;
		}, canvasWidthBeforeAgentArea, { timeout: 15_000 });
		await waitForVideoChromeFrames(page);
		const wideCanvasContext = await captureVideoAttachedChrome(page, canvasPath);
		assertVideoComposerState(wideCanvasContext, expectedDraftState, 'after temporarily closing the Agent Area');
		assertVideoComposerBelowCard(wideCanvasContext, 'after temporarily closing the Agent Area');
		canvasWidthBeforeAgentArea = wideCanvasContext.canvas.width;
	}
	await runCommand(page, 'Toggle Agent Area');
	await page.locator('.basehalf-agent-area').waitFor({ state: 'visible', timeout: 15_000 });
	await page.waitForFunction(previousWidth => {
		const canvas = document.querySelector('.basehalf-canvas-cards');
		return canvas instanceof HTMLElement && Math.abs(canvas.getBoundingClientRect().width - previousWidth) >= 40;
	}, canvasWidthBeforeAgentArea, { timeout: 15_000 });
	await waitForVideoChromeFrames(page);
	const narrowCanvasContext = await captureVideoAttachedChrome(page, canvasPath);
	assertVideoComposerState(narrowCanvasContext, expectedDraftState, 'after the Agent Area narrowed the Canvas');
	assertVideoComposerBelowCard(narrowCanvasContext, 'after the Agent Area narrowed the Canvas');
	if (narrowCanvasContext.canvas.width >= canvasWidthBeforeAgentArea - 40) {
		throw new Error(`Opening the Agent Area did not exercise a materially narrower Canvas: ${JSON.stringify({ before: canvasWidthBeforeAgentArea, after: narrowCanvasContext.canvas.width })}`);
	}
	if (!agentAreaWasVisible) {
		await runCommand(page, 'Toggle Agent Area');
		await page.locator('.basehalf-agent-area').waitFor({ state: 'hidden', timeout: 15_000 });
		await page.waitForFunction(previousWidth => {
			const canvas = document.querySelector('.basehalf-canvas-cards');
			return canvas instanceof HTMLElement && canvas.getBoundingClientRect().width >= previousWidth + 40;
		}, narrowCanvasContext.canvas.width, { timeout: 15_000 });
		await waitForVideoChromeFrames(page);
		const restoredCanvasContext = await captureVideoAttachedChrome(page, canvasPath);
		assertVideoComposerState(restoredCanvasContext, expectedDraftState, 'after closing the Agent Area');
		assertVideoComposerBelowCard(restoredCanvasContext, 'after closing the Agent Area');
		stableComposerContext = restoredCanvasContext;
	}

	// Selection alone owns the node-local Portal: switching away removes it,
	// reselecting creates exactly one, and clicking the pane fully deselects it.
	// The preceding resize exercise intentionally leaves some unrelated cards
	// outside the visible canvas. Switch selection through the card's native
	// click handler without asking Playwright to scroll the graph DOM beneath
	// the workbench titlebar.
	await shot.evaluate(card => card.click());
	await waitForCanvasCardSelection(page, `${workflowName}/shots/shot-01/shot.json`, 10_000);
	await composer.waitFor({ state: 'hidden', timeout: 10_000 });
	if (await page.locator('.basehalf-canvas-video-composer-surface').count() !== 0) {
		throw new Error('Switching from Video to Shot left a stale Video Composer Portal mounted');
	}
	await waitUntil(() => {
		try {
			const saved = JSON.parse(fs.readFileSync(nodePath, 'utf8'));
			return saved.prompt === smokePromptValue
				&& saved.recipe?.recipeId === 'pointa.basehalf-ai-video.generate-video'
				&& saved.recipe?.modelServiceId === SMOKE_VIDEO_PROVIDER_SPEC_ID
				&& saved.recipe?.parameters?.generationMode === 'text-to-video'
				&& saved.recipe?.parameters?.videoModelSnapshot?.catalogId === 'pointa.basehalf-ai-video.official-models'
				&& saved.recipe?.parameters?.videoModelSnapshot?.inputs?.['text-prompt'] === 1;
		} catch {
			return false;
		}
	}, 'auto-bound Video Draft to persist one canonical catalog selection when selection leaves the Composer', 15_000);

	// A stale/foreign snapshot and a leftover scalar must never leave the card
	// looking runnable. Reopening schema-driven settings for the still-reviewed
	// selected model rewrites one canonical parameter object.
	const canonicalDraft = JSON.parse(fs.readFileSync(nodePath, 'utf8'));
	const noncanonicalDraft = {
		...canonicalDraft,
		recipe: {
			...canonicalDraft.recipe,
			parameters: {
				...canonicalDraft.recipe.parameters,
				legacyQuality: 'ultra',
				videoModelSnapshot: {
					...canonicalDraft.recipe.parameters.videoModelSnapshot,
					catalogId: 'foreign.video.models',
					inputs: { 'text-prompt': 0 }
				}
			}
		}
	};
	fs.writeFileSync(nodePath, `${JSON.stringify(noncanonicalDraft, null, '\t')}\n`, 'utf8');
	await page.waitForFunction(path => {
		const card = document.querySelector<HTMLElement>(`.basehalf-canvas-card[data-basehalf-card-path="${path}"]`);
		const stage = card?.querySelector<HTMLElement>('.basehalf-video-stage');
		return card?.dataset.nodeStatus === 'needs-input'
			&& stage?.title.includes('snapshot.catalogId must match expected catalog') === true;
	}, canvasPath, { timeout: 15_000 });

	await clip.locator('.basehalf-video-stage').click();
	await waitForCanvasCardSelection(page, canvasPath, 10_000);
	await composer.waitFor({ state: 'visible', timeout: 10_000 });
	await page.waitForFunction(path => {
		const surface = document.querySelector(`.basehalf-video-composer[data-node-path="${path}"]`);
		const primary = surface?.querySelector<HTMLButtonElement>('.basehalf-video-composer-primary');
		const message = surface?.querySelector('.basehalf-node-local-footer-message')?.textContent ?? '';
		return primary?.disabled === false
			&& (primary.dataset.nodeAction === 'run'
				|| (primary.dataset.nodeAction === 'configure' && message.includes('Choose a reviewed video model')));
	}, canvasPath, { timeout: 20_000 });
	if (await composer.locator('.basehalf-video-composer-primary[data-node-action="configure"]').count()) {
		await composer.locator('.basehalf-video-composer-primary[data-node-action="configure"]').click();
	} else {
		await settingsTrigger.click();
	}
	await settingsPopover.waitFor({ state: 'visible', timeout: 10_000 });
	await page.waitForFunction(path => {
		const surface = document.querySelector(`.basehalf-video-composer[data-node-path="${path}"]`);
		const primary = surface?.querySelector<HTMLButtonElement>('.basehalf-video-composer-primary');
		return primary?.dataset.nodeAction === 'run' && primary.disabled === false;
	}, canvasPath, { timeout: 20_000 });
	await page.keyboard.press('Escape');
	await shot.evaluate(card => card.click());
	await waitForCanvasCardSelection(page, `${workflowName}/shots/shot-01/shot.json`, 10_000);
	await composer.waitFor({ state: 'hidden', timeout: 10_000 });
	await waitUntil(() => {
		try {
			const repaired = JSON.parse(fs.readFileSync(nodePath, 'utf8'));
			return repaired.recipe?.parameters?.legacyQuality === undefined
				&& repaired.recipe?.parameters?.videoModelSnapshot?.catalogId === 'pointa.basehalf-ai-video.official-models'
				&& repaired.recipe?.parameters?.videoModelSnapshot?.inputs?.['text-prompt'] === 1;
		} catch {
			return false;
		}
	}, 'Video settings to rewrite stale snapshot inputs, catalog ownership, and leftover scalars canonically', 15_000);

	await clip.locator('.basehalf-video-stage').click();
	await waitForCanvasCardSelection(page, canvasPath, 10_000);
	await composer.waitFor({ state: 'visible', timeout: 10_000 });
	const reselectedIdentity = await markVideoAttachedChromeIdentity(page, canvasPath, 'basehalf-smoke-video-reselected');
	const reselectedState = { ...reselectedIdentity, promptValue: smokePromptValue };
	let reselectedContext = await captureVideoAttachedChrome(page, canvasPath);
	assertVideoComposerState(reselectedContext, reselectedState, 'after switching back to the Video Draft');
	assertVideoComposerBelowCard(reselectedContext, 'after switching back to the Video Draft');

	// Find a point whose actual hit target is the pane. React Flow requires the
	// real pointer sequence (a synthetic click lacks its pane-press ownership),
	// while transformed cards make any fixed coordinate unreliable here.
	const panePoint = await page.evaluate(() => {
		const pane = document.querySelector('.react-flow__pane');
		if (!(pane instanceof HTMLElement)) {
			return undefined;
		}
		const bounds = pane.getBoundingClientRect();
		for (let y = bounds.bottom - 8; y >= bounds.top + 8; y -= 24) {
			for (let x = bounds.right - 8; x >= bounds.left + 8; x -= 24) {
				if (document.elementFromPoint(x, y) === pane) {
					return { x, y };
				}
			}
		}
		return undefined;
	});
	if (!panePoint) {
		throw new Error('Could not find a real React Flow pane hit target for the Video deselection contract');
	}
	await page.mouse.click(panePoint.x, panePoint.y);
	await page.waitForFunction(() => document.querySelectorAll('.react-flow__node.selected').length === 0
		&& document.querySelectorAll('.basehalf-video-composer').length === 0
		&& document.querySelectorAll('.basehalf-canvas-video-composer-surface').length === 0, null, { timeout: 10_000 });
	await clip.locator('.basehalf-video-stage').click();
	await waitForCanvasCardSelection(page, canvasPath, 10_000);
	await composer.waitFor({ state: 'visible', timeout: 10_000 });
	const finalDraftIdentity = await markVideoAttachedChromeIdentity(page, canvasPath, 'basehalf-smoke-video-final-reselect');
	const finalDraftState = { ...finalDraftIdentity, promptValue: smokePromptValue };
	reselectedContext = await captureVideoAttachedChrome(page, canvasPath);
	assertVideoComposerState(reselectedContext, finalDraftState, 'after pane deselect and Video reselect');
	assertVideoComposerBelowCard(reselectedContext, 'after pane deselect and Video reselect');

	const persistedDraft = JSON.parse(fs.readFileSync(nodePath, 'utf8'));
	const refreshedNodeDocument = { ...persistedDraft, title: 'Shot 01 clip refreshed' };
	fs.writeFileSync(nodePath, `${JSON.stringify(refreshedNodeDocument, null, '\t')}\n`, 'utf8');
	await page.waitForFunction(path => {
		const card = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${path}"]`);
		return card?.querySelector('.basehalf-canvas-card-label')?.textContent?.trim() === 'Shot 01 clip refreshed';
	}, canvasPath, { timeout: 15_000 });
	await waitForVideoChromeFrames(page);
	const hydratedContext = await captureVideoAttachedChrome(page, canvasPath);
	assertVideoComposerState(hydratedContext, finalDraftState, 'after hydrating the selected Video Draft');
	assertVideoComposerBelowCard(hydratedContext, 'after hydrating the selected Video Draft');

	await shot.evaluate(card => card.click());
	await waitForCanvasCardSelection(page, `${workflowName}/shots/shot-01/shot.json`, 10_000);
	await composer.waitFor({ state: 'hidden', timeout: 10_000 });
	if (await page.locator('.basehalf-canvas-video-composer-surface').count() !== 0) {
		throw new Error('Leaving the hydrated Video Draft left a stale Composer Portal mounted');
	}

	await assertVideoResultToolbar(page, {
		workflowName,
		canvasPath,
		nodePath,
		draft: refreshedNodeDocument,
		clip,
		audio
	});
}

async function assertVideoResultToolbar(page, { workflowName, canvasPath, nodePath, draft, clip, audio }) {
	const frozenRecipe = {
		recipeId: 'smoke.video-result',
		parameters: {},
		inputBindings: []
	};
	const runningAttempt = {
		id: 'smoke-video-result-attempt',
		status: 'running',
		createdAt: '2026-08-13T12:00:00.000Z',
		startedAt: '2026-08-13T12:00:01.000Z',
		prompt: 'A sealed smoke-test video result.',
		recipe: frozenRecipe,
		model: { source: 'local' },
		inputs: []
	};
	const attemptDocument = {
		...draft,
		title: 'Shot 01 clip result',
		prompt: runningAttempt.prompt,
		recipe: frozenRecipe,
		attempts: [runningAttempt]
	};
	fs.writeFileSync(nodePath, `${JSON.stringify(attemptDocument, null, '\t')}\n`, 'utf8');
	await page.waitForFunction(path => {
		const card = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${path}"]`);
		return card instanceof HTMLElement && card.dataset.nodeLifecycle === 'attempt';
	}, canvasPath, { timeout: 15_000 });
	if (await page.locator('.basehalf-video-result-toolbar').count() !== 0) {
		throw new Error('An active Video Attempt exposed Result-only controls');
	}

	const relativeArtifactPath = 'outputs/smoke-video-result.mp4';
	const artifactPath = path.join(workspacePath, relativeArtifactPath);
	const artifactBytes = Buffer.from([
		0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
		0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
		0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32
	]);
	fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
	fs.writeFileSync(artifactPath, artifactBytes);
	const artifact = {
		id: 'smoke-video-result-artifact',
		outputId: 'smoke-video-result-output',
		kind: 'video',
		path: relativeArtifactPath,
		sha256: createHash('sha256').update(artifactBytes).digest('base64url'),
		size: artifactBytes.byteLength,
		label: 'Smoke video result'
	};
	const resultDocument = {
		...attemptDocument,
		result: {
			source: 'attempt',
			attemptId: runningAttempt.id,
			artifact
		},
		attempts: [{
			...runningAttempt,
			status: 'succeeded',
			completedAt: '2026-08-13T12:00:02.000Z'
		}]
	};
	fs.writeFileSync(nodePath, `${JSON.stringify(resultDocument, null, '\t')}\n`, 'utf8');
	await page.waitForFunction(path => {
		const card = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${path}"]`);
		return card instanceof HTMLElement && card.dataset.nodeLifecycle === 'result';
	}, canvasPath, { timeout: 15_000 });

	await zoomCanvas(page, 'reset');
	await centerCanvasCards(page, [clip]);
	await clip.locator('.basehalf-video-stage').click();
	await waitForCanvasCardSelection(page, canvasPath, 10_000);
	const toolbar = page.locator('.basehalf-video-result-toolbar');
	await toolbar.waitFor({ state: 'visible', timeout: 10_000 });
	const labels = await toolbar.locator(':scope > button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')));
	const expectedLabels = ['Copy Settings to New Draft', 'Show Details', 'More Actions', 'Open Full Preview'];
	if (JSON.stringify(labels) !== JSON.stringify(expectedLabels)
		|| await toolbar.getAttribute('role') !== 'toolbar'
		|| await toolbar.getAttribute('data-placement') !== 'above'
		|| await page.locator('.basehalf-video-result-toolbar:visible').count() !== 1) {
		throw new Error(`The sealed Video Result toolbar contract is wrong: ${JSON.stringify({ labels, expectedLabels, role: await toolbar.getAttribute('role'), placement: await toolbar.getAttribute('data-placement') })}`);
	}

	await page.waitForFunction(path => document.querySelector(`.basehalf-video-composer[data-node-path="${CSS.escape(path)}"]`) === null
		&& document.querySelector('.basehalf-canvas-video-composer-surface') === null,
	canvasPath, { timeout: 15_000 });
	await page.waitForTimeout(100);
	await toolbar.waitFor({ state: 'visible', timeout: 15_000 });
	if (await page.locator(`.basehalf-video-composer[data-node-path="${canvasPath}"]`).count() !== 0
		|| await page.locator('.basehalf-canvas-video-composer-surface').count() !== 0) {
		throw new Error('A verified Video Result retained the lower Composer');
	}

	const toolbarButtons = toolbar.locator(':scope > button');
	const initialTabStops = await toolbarButtons.evaluateAll(buttons => buttons.map(button => button.tabIndex));
	if (JSON.stringify(initialTabStops) !== JSON.stringify([0, -1, -1, -1])) {
		throw new Error(`The Video Result toolbar did not expose one roving tab stop: ${JSON.stringify(initialTabStops)}`);
	}
	await toolbarButtons.first().focus();
	await page.keyboard.press('ArrowRight');
	if (await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) !== 'Show Details') {
		throw new Error('ArrowRight did not move focus to the next Video Result action');
	}
	const movedTabStops = await toolbarButtons.evaluateAll(buttons => buttons.map(button => button.tabIndex));
	if (JSON.stringify(movedTabStops) !== JSON.stringify([-1, 0, -1, -1])) {
		throw new Error(`The Video Result toolbar did not move its roving tab stop: ${JSON.stringify(movedTabStops)}`);
	}
	await page.keyboard.press('End');
	if (await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) !== 'Open Full Preview') {
		throw new Error('End did not move focus to the last Video Result action');
	}
	await page.keyboard.press('Escape');
	await page.waitForFunction(path => {
		const card = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${path}"]`);
		return card instanceof HTMLElement && (document.activeElement === card || card.contains(document.activeElement));
	}, canvasPath, { timeout: 10_000 });
	await waitForVideoChromeFrames(page);
	if (await page.locator(`.basehalf-video-composer[data-node-path="${canvasPath}"]`).count() !== 0
		|| await page.locator('.basehalf-canvas-video-composer-surface').count() !== 0) {
		throw new Error('Result toolbar focus navigation remounted the lower Composer');
	}

	await toolbar.getByRole('button', { name: 'More Actions', exact: true }).click();
	const contextMenu = page.locator('.context-view.monaco-menu-container:visible').last();
	await contextMenu.waitFor({ state: 'visible', timeout: 10_000 });
	if (await contextMenu.locator('[role="menuitem"], .action-label').count() === 0) {
		throw new Error('More Actions opened an empty context menu');
	}
	await page.keyboard.press('Escape');
	await contextMenu.waitFor({ state: 'hidden', timeout: 10_000 });
	await waitForVideoChromeFrames(page);
	if (await page.locator(`.basehalf-video-composer[data-node-path="${canvasPath}"]`).count() !== 0) {
		throw new Error('Result More menu remounted the lower Composer');
	}

	// The graph node can legitimately sit beneath the Plugins sidebar after the
	// preceding responsive-layout checks. Close that unrelated workbench chrome
	// before the real Shift-click; allowing Playwright to scroll a transformed
	// React Flow node into view would move the graph without updating its model.
	const primarySidebar = page.locator('.part.sidebar');
	if (await primarySidebar.isVisible().catch(() => false)) {
		await runCommand(page, 'Toggle Primary Side Bar Visibility');
		await page.locator('.part.sidebar').waitFor({ state: 'hidden', timeout: 10_000 });
	}
	await audio.click({ modifiers: ['Shift'] });
	await page.getByRole('toolbar', { name: 'Actions for 2 selected cards', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
	if (await page.locator('.basehalf-video-result-toolbar:visible').count() !== 0
		|| await page.locator('.basehalf-video-composer:visible').count() !== 0
		|| await page.locator('.basehalf-canvas-video-composer-surface').count() !== 0) {
		throw new Error('Multi-selection retained single-Video Result chrome instead of structural controls');
	}
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

async function assertVideoWorkflowNodeRun(page) {
	const workflowName = 'Video Starter Workflow';
	const relativeNodePath = 'shots/shot-01/storyboard-frame.bhnode';
	const nodePath = path.join(workspacePath, workflowName, relativeNodePath);
	const card = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${workflowName}/${relativeNodePath}"]`);
	await card.waitFor({ state: 'visible', timeout: 15_000 });
	await zoomCanvas(page, 'reset');
	await centerCanvasCards(page, [card]);
	await page.waitForFunction(path => document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${path}"]`)?.getAttribute('data-preview-level') !== 'shell', `${workflowName}/${relativeNodePath}`, { timeout: 10_000 });
	const action = card.locator('.basehalf-canvas-node-action');
	await page.waitForFunction(path => {
		const button = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${path}"] .basehalf-canvas-node-action`);
		return button instanceof HTMLButtonElement
			&& button.offsetParent !== null
			&& button.dataset.nodeAction === 'run'
			&& button.getAttribute('aria-disabled') !== 'true'
			&& button.textContent?.trim() === 'Generate';
	}, `${workflowName}/${relativeNodePath}`, { timeout: 20_000 });
	if ((await action.textContent())?.trim() !== 'Generate') {
		throw new Error(`The executable Draft did not expose one Generate action: ${(await action.textContent()) ?? 'missing'}`);
	}
	await action.evaluate(button => {
		const state = window as typeof window & {
			__basehalfSmokeNodeActionRegressed?: boolean;
			__basehalfSmokeSawNodeCancel?: boolean;
		};
		state.__basehalfSmokeSawNodeCancel = false;
		state.__basehalfSmokeNodeActionRegressed = false;
		const capture = () => {
			if (button instanceof HTMLButtonElement
				&& button.dataset.nodeAction === 'cancel'
				&& button.textContent?.trim() === 'Cancel') {
				state.__basehalfSmokeSawNodeCancel = true;
			}
		};
		new MutationObserver(capture).observe(button, {
			attributes: true,
			childList: true,
			characterData: true,
			subtree: true
		});
		const card = button.closest('.basehalf-canvas-card');
		if (card) {
			new MutationObserver(() => {
				const current = card.querySelector<HTMLButtonElement>('.basehalf-canvas-node-action');
				if (current?.dataset.nodeAction === 'cancel'
					&& current.textContent?.trim() === 'Cancel') {
					state.__basehalfSmokeSawNodeCancel = true;
				}
				if (state.__basehalfSmokeSawNodeCancel && current?.dataset.nodeAction === 'run') {
					state.__basehalfSmokeNodeActionRegressed = true;
				}
			}).observe(card, {
				attributes: true,
				childList: true,
				characterData: true,
				subtree: true
			});
		}
	});
	await action.click();
	await page.waitForFunction(() => (window as typeof window & { __basehalfSmokeSawNodeCancel?: boolean }).__basehalfSmokeSawNodeCancel === true, null, { timeout: 10_000 });
	await waitUntil(() => {
		try {
			const node = JSON.parse(fs.readFileSync(nodePath, 'utf8'));
			const attempt = node.attempts?.find(candidate => candidate.id === node.result?.attemptId);
			const output = node.result?.artifact?.path;
			return attempt?.status === 'succeeded'
				&& node.result?.source === 'attempt'
				&& typeof output === 'string'
				&& fs.existsSync(path.join(workspacePath, output));
		} catch {
			return false;
		}
	}, 'canvas node attempt to seal one Result', 20_000);
	if (await page.evaluate(() => (window as typeof window & { __basehalfSmokeNodeActionRegressed?: boolean }).__basehalfSmokeNodeActionRegressed === true)) {
		throw new Error('The canvas node action reverted to Generate while execution was active.');
	}
	await card.locator('.basehalf-canvas-card-media-visual').waitFor({ state: 'visible', timeout: 15_000 });
	const node = JSON.parse(fs.readFileSync(nodePath, 'utf8'));
	const attempt = node.attempts?.[0];
	const artifact = node.result?.artifact;
	if (node.attempts?.length !== 1
		|| attempt?.recipe?.recipeId !== node.recipe?.recipeId
		|| !/^v1;source=[A-Za-z0-9_-]{43};sha256=[A-Za-z0-9_-]{43}$/.test(attempt?.inputs?.[0]?.revision ?? '')
		|| attempt?.status !== 'succeeded'
		|| node.result?.source !== 'attempt'
		|| node.result?.attemptId !== attempt.id
		|| artifact?.kind !== 'image'
		|| typeof artifact.sha256 !== 'string'
		|| artifact.sha256.length !== 43
		|| typeof artifact.size !== 'number') {
		throw new Error('The node did not preserve frozen inputs, Attempt audit, and its sealed Result.');
	}
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
	if (labels.length !== 2 || labels[0] !== path.basename(workspacePath) || labels[1] !== 'README.md') {
		throw new Error(`Unexpected README breadcrumb path: ${JSON.stringify(labels)}`);
	}
	const current = breadcrumbs.locator('[aria-current="page"]');
	if (await current.textContent() !== 'README.md') {
		throw new Error('The current breadcrumb segment is not README.md');
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

// Workspace setup ran on open: the agent-protocol pointers exist on disk —
// hint sections in CLAUDE.md/AGENTS.md, the agent-harness index, and the
// .bh/cache/ gitignore line appended to the fixture's existing .gitignore.
async function assertWorkspaceSetupAgentProtocolFiles() {
	const deadline = Date.now() + 20_000;
	for (; ;) {
		try {
			for (const rel of ['CLAUDE.md', 'AGENTS.md']) {
				const content = fs.readFileSync(path.join(workspacePath, rel), 'utf8');
				if (!content.includes('<!-- bh:workspace-hint -->') || !content.includes('.bh/current_focus.yaml')) {
					throw new Error(`${rel} is missing the BaseHalf workspace hint`);
				}
			}
			const index = fs.readFileSync(path.join(workspacePath, '.bh/agent-harness/index.md'), 'utf8');
			if (!index.startsWith('<!-- bh:agent-harness managed')) {
				throw new Error('.bh/agent-harness/index.md is missing the managed sentinel');
			}
			return;
		} catch (error) {
			if (Date.now() > deadline) {
				throw error;
			}
			await new Promise(resolve => setTimeout(resolve, 500));
		}
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
	await page.mouse.move(beforeGesture.center.x, beforeGesture.center.y);
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
		await page.locator('.basehalf-card-detail-title', { hasText: title }).waitFor({ state: 'visible', timeout: 20_000 });
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
		const resizeLines = Array.from(node.querySelectorAll('.basehalf-canvas-node-resizer-line')).map(line => {
			const style = getComputedStyle(line);
			const borders = borderPaint(style);
			return {
				className: line.getAttribute('class'),
				opacity: style.opacity,
				pointerEvents: style.pointerEvents,
				borders,
				painted: Object.values(borders).some(isPaintedBorder)
			};
		});
		const resizeHandles = Array.from(node.querySelectorAll('.basehalf-canvas-node-resizer-handle')).map(handle => {
			const style = getComputedStyle(handle);
			const bounds = handle.getBoundingClientRect();
			const borders = borderPaint(style);
			const visible = isVisible(handle);
			const backgroundPainted = style.backgroundColor !== 'transparent'
				&& style.backgroundColor !== 'rgba(0, 0, 0, 0)';
			return {
				className: handle.getAttribute('class'),
				visible,
				interactive: visible && style.pointerEvents !== 'none',
				painted: visible && (backgroundPainted || Object.values(borders).some(isPaintedBorder)),
				width: bounds.width,
				height: bounds.height,
				cursor: style.cursor,
				borderColor: style.borderColor,
				backgroundColor: style.backgroundColor,
				opacity: style.opacity,
				pointerEvents: style.pointerEvents
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
		throw new Error(`Canvas card painted visible resize points during ${phase}: ${JSON.stringify(chrome.resizeHandles)}`);
	}
}

function assertCanvasCardHasInvisibleCornerResizeTargets(chrome, phase) {
	const interactive = chrome.resizeHandles.filter(handle => handle.interactive);
	const diagonalCursors = new Set(['nesw-resize', 'nwse-resize']);
	const invalid = interactive.filter(handle => handle.painted
		|| handle.width < 15.5
		|| handle.height < 15.5
		|| !diagonalCursors.has(handle.cursor));
	if (interactive.length !== 4 || invalid.length > 0) {
		throw new Error(`Canvas card did not expose four invisible corner resize targets during ${phase}: ${JSON.stringify({ interactive, invalid })}`);
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
	assertCanvasCardHasInvisibleCornerResizeTargets(selectedNoteChrome, 'selected Note pointer state');
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

	await note.locator('.basehalf-canvas-card-caption-identity').dblclick();
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
	await readme.locator('.basehalf-canvas-card-badge-toggle:visible').evaluate(button => button.click());
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
	const addReferenceVisibleAfterLongPrompt = await readme.locator('.basehalf-canvas-card-add-reference').evaluate(button => {
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
	if (!addReferenceVisibleAfterLongPrompt) {
		throw new Error('The canvas Badge body could not scroll from a complete prompt to Add reference');
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

	const docs = page.locator('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
	const src = page.locator('.basehalf-canvas-card[data-basehalf-card-path="src"]');
	for (let attempt = 0; attempt < 8 && (!await docs.isVisible() || !await src.isVisible()); attempt++) {
		if (!await zoomCanvas(page, 'out')) {
			break;
		}
		await page.waitForTimeout(50);
	}
	await docs.waitFor({ state: 'visible', timeout: 10_000 });
	await src.waitFor({ state: 'visible', timeout: 10_000 });
	await centerCanvasCards(page, [docs, src]);
	await zoomCanvas(page, 'reset');
	await page.waitForFunction(() => Number(document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom')) >= 0.5, null, { timeout: 10_000 });
	await docs.locator('.basehalf-canvas-folder-preview-label', { hasText: 'guide.md' }).waitFor({ state: 'visible', timeout: 10_000 });
	await src.locator('.basehalf-canvas-folder-preview-label', { hasText: 'app.ts' }).waitFor({ state: 'visible', timeout: 10_000 });
	const docsNode = page.locator('.react-flow__node', { has: docs });
	const srcNode = page.locator('.react-flow__node', { has: src });
	const docsEast = docsNode.locator(':scope > .basehalf-canvas-card-connect-handle.east');
	const srcWest = srcNode.locator(':scope > .basehalf-canvas-card-connect-handle.west');
	await page.locator('.basehalf-canvas-cards').focus();
	await page.keyboard.press('Escape');
	await docs.click();
	await docs.hover();
	await page.waitForFunction(() => getComputedStyle(document.querySelector('.react-flow__node[data-id="docs"] > .basehalf-canvas-card-connect-handle.east')).pointerEvents !== 'none', null, { timeout: 10_000 });
	const sourceBox = await docsEast.boundingBox();
	const targetBox = await srcWest.boundingBox();
	const canvasBox = await page.locator('.basehalf-canvas-cards').boundingBox();
	if (!sourceBox || !targetBox || !canvasBox) {
		throw new Error('Missing React Flow connection geometry');
	}

	const docsBadgePath = path.join(workspacePath, '.bh', 'mirror', 'docs', 'badge.yaml');
	const srcBadgePath = path.join(workspacePath, '.bh', 'mirror', 'src', 'badge.yaml');
	const beforeCancelCanvas = fs.readFileSync(canvasPath, 'utf8');
	const sourcePoint = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
	let connectionStarted = false;
	let connectionStartState;
	for (let attempt = 0; attempt < 3 && !connectionStarted; attempt++) {
		await docs.hover();
		await page.mouse.move(sourcePoint.x, sourcePoint.y);
		await page.mouse.down();
		// The connection gesture intentionally waits until the pointer crosses its
		// drag threshold; pointer-down alone does not create a draft path.
		await page.mouse.move(sourcePoint.x + 8 + attempt * 4, sourcePoint.y, { steps: 3 });
		connectionStarted = await page.locator('.react-flow__connection-path').waitFor({ state: 'attached', timeout: 2_500 })
			.then(() => true, () => false);
		if (!connectionStarted) {
			connectionStartState = await page.evaluate(({ x, y }) => {
				const target = document.elementFromPoint(x, y);
				const handle = document.querySelector('.react-flow__node[data-id="docs"] > .basehalf-canvas-card-connect-handle.east');
				return {
					targetClass: target?.getAttribute('class'),
					handleClass: handle?.getAttribute('class'),
					handlePointerEvents: handle ? getComputedStyle(handle).pointerEvents : undefined,
					handleOpacity: handle ? getComputedStyle(handle).opacity : undefined
				};
			}, sourcePoint);
			await page.mouse.up();
			await page.keyboard.press('Escape');
			await page.waitForTimeout(100);
		}
	}
	if (!connectionStarted) {
		throw new Error(`Connection gesture did not start from the visible handle: ${JSON.stringify(connectionStartState)}`);
	}
	await page.mouse.move(canvasBox.x + canvasBox.width - 30, canvasBox.y + canvasBox.height - 80, { steps: 8 });
	await page.mouse.up();
	await page.waitForTimeout(150);
	const afterCancelCanvas = fs.readFileSync(canvasPath, 'utf8');
	if (afterCancelCanvas !== beforeCancelCanvas) {
		throw new Error('Expected blank connection release to cancel without changing canvas.yaml');
	}
	const draftCountAfterCancel = await page.locator('.react-flow__connection-path').count();
	if (draftCountAfterCancel !== 0) {
		throw new Error(`Expected connection draft to be removed after cancel, got ${draftCountAfterCancel}`);
	}

	await docs.hover();
	await page.waitForFunction(() => getComputedStyle(document.querySelector('.react-flow__node[data-id="docs"] > .basehalf-canvas-card-connect-handle.east')).pointerEvents !== 'none', null, { timeout: 10_000 });
	const freshSourceBox = await docsEast.boundingBox();
	const freshTargetBox = await srcWest.boundingBox();
	if (!freshSourceBox || !freshTargetBox) {
		throw new Error('Missing React Flow handles after cancelled connection');
	}
	await page.mouse.move(freshSourceBox.x + freshSourceBox.width / 2, freshSourceBox.y + freshSourceBox.height / 2);
	await page.mouse.down();
	await page.mouse.move(freshTargetBox.x + freshTargetBox.width / 2, freshTargetBox.y + freshTargetBox.height / 2, { steps: 8 });
	await page.waitForFunction(() => document.querySelector('.react-flow__connection-path') !== null, null, { timeout: 10_000 });
	await page.mouse.up();

	await waitUntil(() => {
		const canvas = fs.readFileSync(canvasPath, 'utf8');
		return canvas.includes('from: "docs"')
			&& canvas.includes('from_anchor: east')
			&& canvas.includes('to: "src"')
			&& canvas.includes('to_anchor: west');
	}, 'canvas.yaml to persist a four-side edge');
	await waitUntil(() => fs.existsSync(docsBadgePath) && fs.readFileSync(docsBadgePath, 'utf8').includes('- "src"'), 'source badge reference to persist');
	await waitUntil(() => fs.existsSync(srcBadgePath) && fs.readFileSync(srcBadgePath, 'utf8').includes('- "docs"'), 'target badge inbound reference to persist');
}

async function assertCanvasInlineRename(page) {
	const readme = page.locator('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
	await readme.focus();
	await page.keyboard.press('F2');
	const input = readme.locator('.basehalf-canvas-inline-name-input input');
	await input.waitFor({ state: 'visible', timeout: 10_000 });
	const value = await input.inputValue();
	if (value !== 'README.md') {
		throw new Error(`Expected inline rename to retain the card name, got ${JSON.stringify(value)}`);
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
	const commitInput = readme.locator('.basehalf-canvas-inline-name-input input');
	await commitInput.fill('README-renamed.md');
	await commitInput.press('Enter');
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
	if (document.kind !== 'image' || document.title !== 'Image') {
		throw new Error(`Canvas result-node submenu created the wrong document: ${JSON.stringify(document)}`);
	}
	const card = page.locator('.basehalf-canvas-card[data-basehalf-card-path="image.bhnode"]');
	await card.waitFor({ state: 'visible', timeout: 10_000 });
	await waitForCanvasCardSelection(page, 'image.bhnode');
	if (await page.locator('.basehalf-card-detail.visible').isVisible().catch(() => false)
		|| await page.locator('.basehalf-node-local-surface').isVisible().catch(() => false)) {
		throw new Error('Canvas result-node creation opened content instead of leaving the new card selected');
	}
	fs.rmSync(nodePath, { force: true });
	await card.waitFor({ state: 'hidden', timeout: 10_000 });
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

		const panStart = await page.evaluate(({ bounds, horizontal, vertical }) => {
			const xFractions = horizontal >= 0 ? [0.15, 0.3, 0.5, 0.7, 0.85] : [0.85, 0.7, 0.5, 0.3, 0.15];
			const yFractions = vertical >= 0 ? [0.15, 0.3, 0.5, 0.7, 0.85] : [0.85, 0.7, 0.5, 0.3, 0.15];
			for (const yFraction of yFractions) {
				for (const xFraction of xFractions) {
					const x = bounds.x + bounds.width * xFraction;
					const y = bounds.y + bounds.height * yFraction;
					if (document.elementFromPoint(x, y)?.closest('.react-flow__pane')) {
						return { x, y };
					}
				}
			}
			return undefined;
		}, { bounds: canvasBox, horizontal: deltaX, vertical: deltaY });
		if (!panStart) {
			await page.waitForTimeout(100);
			continue;
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

	throw new Error('Canvas viewport did not settle around the requested cards');
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
	assertCanvasCardHasInvisibleCornerResizeTargets(activeBeforeDrag, 'selected docs card before drag');
	if (!activeBeforeDrag.cardSelected
		|| !activeBeforeDrag.nodeSelected
		|| activeBeforeDrag.visibleResizeHandles !== 4
		|| activeBeforeDrag.interactiveResizeHandles !== 4) {
		throw new Error(`Selected docs card did not expose four corner resize hit targets before drag: ${JSON.stringify(activeBeforeDrag)}`);
	}
	const canvasBefore = fs.readFileSync(canvasPath, 'utf8');
	const before = await page.evaluate(() => {
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
		const node = card?.closest('.react-flow__node');
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === `docs${String.fromCharCode(0)}src`);
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
	});
	if (!before?.edgePath) {
		throw new Error('Missing docs→src live edge geometry');
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
	await page.waitForFunction(({ edgePath, nodeTransform }) => {
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
		const node = card?.closest('.react-flow__node');
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === `docs${String.fromCharCode(0)}src`);
		return node instanceof HTMLElement
			&& edge instanceof SVGPathElement
			&& getComputedStyle(node).transform !== nodeTransform
			&& edge.getAttribute('d') !== edgePath;
	}, { edgePath: before.edgePath, nodeTransform: before.nodeTransform }, { timeout: 10_000 });

	const endpointDistance = await page.evaluate(() => {
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
		const node = card?.closest('.react-flow__node');
		const handle = node?.querySelector(':scope > .basehalf-canvas-card-connect-handle.east');
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === `docs${String.fromCharCode(0)}src`);
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
	});
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

	const resizeHandle = docsNode.locator(':scope > .basehalf-canvas-node-resizer-handle.bottom.right');
	const [resizeBeforeBox, resizeHandleBox] = await Promise.all([docs.boundingBox(), resizeHandle.boundingBox()]);
	if (!resizeBeforeBox || !resizeHandleBox) {
		throw new Error('Could not measure the selected docs card before resize');
	}
	const resizeCanvasBefore = fs.readFileSync(canvasPath, 'utf8');
	const resizeBeforeChrome = await captureCanvasCardComputedChrome(docs);
	assertCanvasCardResizeChromeIsNeutral(resizeBeforeChrome, 'selected docs card before resize');
	assertCanvasCardPaintEqual(activeBeforeDrag.cardPaint, resizeBeforeChrome.cardPaint, 'drag-to-resize resting transition');
	const resizeStart = {
		x: resizeHandleBox.x + resizeHandleBox.width / 2,
		y: resizeHandleBox.y + resizeHandleBox.height / 2
	};
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

	const restoreHandleBox = await resizeHandle.boundingBox();
	if (!restoreHandleBox) {
		throw new Error('Could not measure the docs card handle before restoring its fixture size');
	}
	const restoreCanvasBefore = fs.readFileSync(canvasPath, 'utf8');
	const restoreStart = {
		x: restoreHandleBox.x + restoreHandleBox.width / 2,
		y: restoreHandleBox.y + restoreHandleBox.height / 2
	};
	await page.mouse.move(restoreStart.x, restoreStart.y);
	await page.mouse.down();
	await page.mouse.move(
		restoreStart.x + resizeBeforeBox.width - resizeAfterBox.width,
		restoreStart.y + resizeBeforeBox.height - resizeAfterBox.height,
		{ steps: 10 }
	);
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
async function assertCanvasEdgeHalfReconnect(page) {
	const docs = page.locator('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
	const src = page.locator('.basehalf-canvas-card[data-basehalf-card-path="src"]');
	const readme = page.locator('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
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
	await docs.waitFor({ state: 'visible', timeout: 10_000 });
	await src.waitFor({ state: 'visible', timeout: 10_000 });
	await readme.waitFor({ state: 'visible', timeout: 10_000 });
	await centerCanvasCards(page, [docs, src, readme]);
	const canvasBounds = await page.locator('.basehalf-canvas-cards').boundingBox();
	const cardBounds = await Promise.all([docs.boundingBox(), src.boundingBox(), readme.boundingBox()]);
	if (!canvasBounds || cardBounds.some(bounds => !bounds || bounds.x < canvasBounds.x - 1 || bounds.y < canvasBounds.y - 1
		|| bounds.x + bounds.width > canvasBounds.x + canvasBounds.width + 1
		|| bounds.y + bounds.height > canvasBounds.y + canvasBounds.height + 1)) {
		throw new Error('Edge reconnect fixture cards are not fully inside the visible canvas viewport');
	}

	const readmeWest = page.locator('.react-flow__node', { has: readme }).locator(':scope > .basehalf-canvas-card-connect-handle.west');
	const reconnectTarget = await readmeWest.boundingBox();
	if (!reconnectTarget) {
		throw new Error('Missing endpoint handles for edge half reconnect smoke');
	}

	const canvasPath = path.join(workspacePath, '.bh', 'mirror', 'canvas.yaml');
	const canvasBeforeEscape = fs.readFileSync(canvasPath, 'utf8');
	const beforeSource = await canvasEdgeGestureGeometry(page, 'docs', 'src');
	const sourceBlank = await canvasReconnectBlankPoint(page, beforeSource.firstHalf);
	await page.mouse.move(beforeSource.firstHalf.x, beforeSource.firstHalf.y);
	await page.mouse.down();
	await page.mouse.move(sourceBlank.x, sourceBlank.y, { steps: 8 });
	await page.waitForFunction(edgeId => {
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		return edge instanceof SVGPathElement && edge.dataset.reconnectEnd === 'source';
	}, `docs${String.fromCharCode(0)}src`, { timeout: 10_000 });
	const sourcePreview = await canvasEdgeGestureGeometry(page, 'docs', 'src');
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
	await assertCanvasEdgeVisible(page, 'docs', 'src');
	await page.waitForFunction(edgeId => {
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		return edge instanceof SVGPathElement && edge.dataset.reconnectEnd === undefined;
	}, `docs${String.fromCharCode(0)}src`, { timeout: 10_000 });
	if (fs.readFileSync(canvasPath, 'utf8') !== canvasBeforeEscape) {
		throw new Error('Escape committed an edge reconnect instead of cancelling it');
	}

	// A no-drag click selects only. Reference edges have no relationship-label
	// DOM at all, and their sole keyboard/screen-reader affordance is React
	// Flow's focusable edge wrapper.
	const clickGeometry = await canvasEdgeGestureGeometry(page, 'docs', 'src');
	await page.mouse.click(clickGeometry.firstHalf.x, clickGeometry.firstHalf.y);
	await page.waitForFunction(edgeId => Array.from(document.querySelectorAll('.basehalf-canvas-edge-hit.selected'))
		.some(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId), `docs${String.fromCharCode(0)}src`, { timeout: 10_000 });
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
	}, `docs${String.fromCharCode(0)}src`);
	if (!edgeAccessibility || edgeAccessibility.labelElementCount !== 0) {
		throw new Error('A reference edge rendered a relationship-label element');
	}
	if (edgeAccessibility.tabIndex !== 0 || edgeAccessibility.role !== 'group' || edgeAccessibility.roleDescription !== 'edge') {
		throw new Error('The reference edge wrapper is not the sole keyboard-accessible edge target');
	}
	if (!edgeAccessibility.ariaLabel
		|| !/^Context flows from /i.test(edgeAccessibility.ariaLabel)
		|| !edgeAccessibility.ariaLabel.includes('docs')
		|| !edgeAccessibility.ariaLabel.includes('src')
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
	}, `docs${String.fromCharCode(0)}src`);
	await page.keyboard.press('Escape');
	await page.waitForFunction(edgeId => {
		const hit = Array.from(document.querySelectorAll('.basehalf-canvas-edge-hit'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		return hit?.closest('.react-flow__edge')?.classList.contains('selected') === false;
	}, `docs${String.fromCharCode(0)}src`, { timeout: 10_000 });
	await page.evaluate(edgeId => {
		const hit = Array.from(document.querySelectorAll('.basehalf-canvas-edge-hit'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		const wrapper = hit?.closest('.react-flow__edge');
		if (!(wrapper instanceof SVGElement)) {
			throw new Error('Missing reference edge wrapper for keyboard selection');
		}
		wrapper.focus();
	}, `docs${String.fromCharCode(0)}src`);
	await page.keyboard.press('Enter');
	await page.waitForFunction(edgeId => {
		const hit = Array.from(document.querySelectorAll('.basehalf-canvas-edge-hit'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		const wrapper = hit?.closest('.react-flow__edge');
		return wrapper instanceof SVGElement
			&& document.activeElement === wrapper
			&& wrapper.classList.contains('selected');
	}, `docs${String.fromCharCode(0)}src`, { timeout: 10_000 });
	if (await visibleQuickInput(page).isVisible().catch(() => false)) {
		throw new Error('Keyboard-selecting a reference edge opened Quick Input');
	}
	if (fs.readFileSync(canvasPath, 'utf8') !== canvasBeforeDoubleClick) {
		throw new Error('Keyboard-selecting a reference edge changed canvas.yaml');
	}

	// Releasing the source endpoint on its excluded opposite card is invalid,
	// not blank. It cancels and preserves the semantic edge.
	const invalidGeometry = await canvasEdgeGestureGeometry(page, 'docs', 'src');
	const srcBounds = await src.boundingBox();
	if (!srcBounds) {
		throw new Error('Missing src card bounds for invalid reconnect smoke');
	}
	const canvasBeforeInvalidCard = fs.readFileSync(canvasPath, 'utf8');
	await page.mouse.move(invalidGeometry.firstHalf.x, invalidGeometry.firstHalf.y);
	await page.mouse.down();
	await page.mouse.move(srcBounds.x + srcBounds.width / 2, srcBounds.y + srcBounds.height / 2, { steps: 8 });
	await page.waitForFunction(edgeId => {
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		return edge instanceof SVGPathElement && edge.dataset.reconnectEnd === 'source';
	}, `docs${String.fromCharCode(0)}src`, { timeout: 10_000 });
	await page.mouse.up();
	await assertCanvasEdgeVisible(page, 'docs', 'src');
	await page.waitForFunction(edgeId => {
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		return edge instanceof SVGPathElement && edge.dataset.reconnectEnd === undefined;
	}, `docs${String.fromCharCode(0)}src`, { timeout: 10_000 });
	if (fs.readFileSync(canvasPath, 'utf8') !== canvasBeforeInvalidCard) {
		throw new Error('Releasing on the excluded opposite card deleted or reconnected the edge');
	}

	const beforeTarget = await canvasEdgeGestureGeometry(page, 'docs', 'src');
	const targetBlank = await canvasReconnectBlankPoint(page, beforeTarget.secondHalf);
	await page.mouse.move(beforeTarget.secondHalf.x, beforeTarget.secondHalf.y);
	await page.mouse.down();
	await page.mouse.move(targetBlank.x, targetBlank.y, { steps: 8 });
	await page.waitForFunction(edgeId => {
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		return edge instanceof SVGPathElement && edge.dataset.reconnectEnd === 'target';
	}, `docs${String.fromCharCode(0)}src`, { timeout: 10_000 });
	const targetPreview = await canvasEdgeGestureGeometry(page, 'docs', 'src');
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
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
		const node = card?.closest('.react-flow__node');
		return card?.classList.contains('connection-target')
			&& card.classList.contains('west')
			&& node?.querySelector(':scope > .basehalf-canvas-card-connect-handle.west')?.classList.contains('connection-target');
	}, null, { timeout: 10_000 });
	await page.mouse.up();
	await assertCanvasEdgeGone(page, 'docs', 'src');
	await assertCanvasEdgeVisible(page, 'docs', 'README.md');

	const docsBadgePath = path.join(workspacePath, '.bh', 'mirror', 'docs', 'badge.yaml');
	const srcBadgePath = path.join(workspacePath, '.bh', 'mirror', 'src', 'badge.yaml');
	const readmeBadgePath = path.join(workspacePath, '.bh', 'mirror', 'README.md', 'badge.yaml');
	await waitUntil(() => {
		const canvas = fs.readFileSync(canvasPath, 'utf8');
		return canvas.includes('from: "docs"')
			&& canvas.includes('to: "README.md"')
			&& canvas.includes('to_anchor: west');
	}, 'target-half reconnect styling to persist in canvas.yaml');
	await waitUntil(() => fs.readFileSync(docsBadgePath, 'utf8').includes('- "README.md"')
		&& !fs.readFileSync(docsBadgePath, 'utf8').includes('- "src"'), 'target-half reconnect to replace the source reference');
	await waitUntil(() => fs.readFileSync(readmeBadgePath, 'utf8').includes('- "docs"'), 'target-half reconnect inbound reference to persist');
	await waitUntil(() => !fs.existsSync(srcBadgePath) || !fs.readFileSync(srcBadgePath, 'utf8').includes('- "docs"'), 'old target inbound reference to be removed');

	// Restore the fixture with the same real second-half gesture so later smoke
	// steps do not inherit a reverse docs↔README pair or altered graph topology.
	const srcWest = page.locator('.react-flow__node', { has: src }).locator(':scope > .basehalf-canvas-card-connect-handle.west');
	const restoreTarget = await srcWest.boundingBox();
	if (!restoreTarget) {
		throw new Error('Missing src west handle while restoring the reconnect fixture');
	}
	const beforeRestore = await canvasEdgeGestureGeometry(page, 'docs', 'README.md');
	await page.mouse.move(beforeRestore.secondHalf.x, beforeRestore.secondHalf.y);
	await page.mouse.down();
	await page.mouse.move(restoreTarget.x + restoreTarget.width / 2, restoreTarget.y + restoreTarget.height / 2, { steps: 8 });
	await page.waitForFunction(edgeId => {
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === edgeId);
		return edge instanceof SVGPathElement && edge.dataset.reconnectEnd === 'target';
	}, `docs${String.fromCharCode(0)}README.md`, { timeout: 10_000 });
	await page.mouse.up();
	await assertCanvasEdgeGone(page, 'docs', 'README.md');
	await assertCanvasEdgeVisible(page, 'docs', 'src');
	await waitUntil(() => {
		const canvas = fs.readFileSync(canvasPath, 'utf8');
		return canvas.includes('from: "docs"') && canvas.includes('to: "src"') && canvas.includes('to_anchor: west');
	}, 'restored target-half reconnect styling to persist');
	await waitUntil(() => fs.readFileSync(docsBadgePath, 'utf8').includes('- "src"')
		&& !fs.readFileSync(docsBadgePath, 'utf8').includes('- "README.md"'), 'restored docs reference to persist');
	await waitUntil(() => fs.existsSync(srcBadgePath) && fs.readFileSync(srcBadgePath, 'utf8').includes('- "docs"'), 'restored src inbound reference to persist');
	await waitUntil(() => !fs.readFileSync(readmeBadgePath, 'utf8').includes('- "docs"'), 'temporary README inbound reference to be removed');
}

async function canvasEdgeGestureGeometry(page, from, to) {
	const geometry = await page.evaluate(([source, target]) => {
		const edge = Array.from(document.querySelectorAll('.basehalf-canvas-edge-path'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === `${source}${String.fromCharCode(0)}${target}`);
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
		return {
			path: edge.getAttribute('d'),
			source: screenPoint(0),
			target: screenPoint(1),
			firstHalf: screenPoint(0.25),
			secondHalf: screenPoint(0.75)
		};
	}, [from, to]);
	if (!geometry?.path) {
		throw new Error(`Could not inspect ${from}→${to} edge geometry`);
	}
	return geometry;
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
	fs.writeFileSync(path.join(workspacePath, AGENT_CREATED_CARD_PATH), [
		'# Agent angle',
		'',
		'Created externally as another context-consuming document.',
		''
	].join('\n'), 'utf8');

	await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${AGENT_CREATED_CARD_PATH}"]`)
		.waitFor({ state: 'visible', timeout: 10_000 });
}

// An AGENT (external process) writes one badge endpoint for an explicit
// reference, without a canvas.yaml edge. The incomplete pair stays out of the
// graph but remains discoverable and recoverable from the Badge UI: Repair
// writes the reciprocal endpoint, while Discard scrubs the abandoned half.
async function assertAgentReferenceDrawsEdge(page) {
	const readmeBadgePath = path.join(workspacePath, '.bh', 'mirror', 'README.md', 'badge.yaml');
	const docsBadgePath = path.join(workspacePath, '.bh', 'mirror', 'docs', 'badge.yaml');
	const targetBadgeDirectory = path.join(workspacePath, '.bh', 'mirror', AGENT_CREATED_CARD_PATH);
	const targetBadgePath = path.join(targetBadgeDirectory, 'badge.yaml');
	fs.writeFileSync(readmeBadgePath, [
		'path: "README.md"',
		'kind: file',
		'description: "Agent source write observed"',
		'references:',
		`  - "${AGENT_CREATED_CARD_PATH}"`,
		'referenced_by: []',
		''
	].join('\n'), 'utf8');
	const readme = page.locator('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
	await readme.waitFor({ state: 'attached', timeout: 10_000 });
	await centerCanvasCards(page, [readme]);
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]')?.getAttribute('data-preview-level') !== 'shell', null, { timeout: 10_000 });
	const sourceIssueMarker = readme.locator('.basehalf-canvas-card-badge-dot.issue[data-testid="card-reference-issue-marker"]:visible');
	await sourceIssueMarker.waitFor({ state: 'visible', timeout: 10_000 });
	if (await sourceIssueMarker.getAttribute('data-reference-issue-count') !== '1') {
		throw new Error('The source-only Agent write did not expose exactly one card-level reference issue');
	}
	await readme.locator('.basehalf-canvas-card-badge-toggle:visible').evaluate(button => button.click());
	const prompt = readme.locator('.basehalf-canvas-card-badge-prompt');
	await page.waitForFunction(() => {
		const input = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"] .basehalf-canvas-card-badge-prompt');
		return input instanceof HTMLTextAreaElement && input.value === 'Agent source write observed';
	}, null, { timeout: 10_000 });
	if (await readme.locator('.basehalf-canvas-card-badge-row').count() !== 0) {
		throw new Error('The badge face exposed a one-sided Agent reference as a real relationship');
	}
	const repairIssue = readme.locator(`[data-testid="reference-issue"][data-reference-from="README.md"][data-reference-to="${AGENT_CREATED_CARD_PATH}"]`);
	await repairIssue.waitFor({ state: 'visible', timeout: 10_000 });
	if (await repairIssue.getAttribute('data-reference-reason') !== 'incomplete'
		|| await repairIssue.getAttribute('data-reference-direction') !== 'outbound') {
		throw new Error('The source-only Agent write rendered the wrong reference issue state');
	}
	if (await repairIssue.locator('[data-testid="reference-issue-repair"]').getAttribute('aria-label') !== `Repair reference README.md to ${AGENT_CREATED_CARD_PATH}`) {
		throw new Error('The source-only Agent write did not expose the expected Repair action');
	}
	if (await page.evaluate(edgeId => Array.from(document.querySelectorAll('.basehalf-canvas-edge-hit'))
		.some(edge => edge.getAttribute('data-edge-id') === edgeId), `README.md${String.fromCharCode(0)}${AGENT_CREATED_CARD_PATH}`)) {
		throw new Error('A one-sided Agent reference was drawn before its reciprocal backlink existed');
	}

	await repairIssue.locator('[data-testid="reference-issue-repair"]').evaluate(button => button.click());
	await waitUntil(() => fs.existsSync(targetBadgePath)
		&& fs.readFileSync(readmeBadgePath, 'utf8').includes(`- "${AGENT_CREATED_CARD_PATH}"`)
		&& fs.readFileSync(targetBadgePath, 'utf8').includes('- "README.md"'), 'Repair to persist both reciprocal reference endpoints');
	await repairIssue.waitFor({ state: 'detached', timeout: 10_000 });
	await sourceIssueMarker.waitFor({ state: 'detached', timeout: 10_000 });
	const repairedReferenceRow = readme.locator('.basehalf-canvas-card-badge-row', { hasText: AGENT_CREATED_CARD_PATH });
	await repairedReferenceRow.waitFor({ state: 'visible', timeout: 10_000 });
	const restingRemoveOpacity = Number(await repairedReferenceRow.locator('.basehalf-canvas-card-badge-remove').evaluate(button => getComputedStyle(button).opacity));
	if (restingRemoveOpacity < 0.35) {
		throw new Error(`Reference remove action was undiscoverable without hover, opacity=${restingRemoveOpacity}`);
	}
	await assertCanvasEdgeVisible(page, 'README.md', AGENT_CREATED_CARD_PATH);

	// Manufacture another source-only pair while keeping the repaired relation.
	// Discard must scrub either possible half without disturbing valid neighbors.
	await page.locator('.react-flow__pane').click({ position: { x: 16, y: 16 } });
	fs.writeFileSync(readmeBadgePath, [
		'path: "README.md"',
		'kind: file',
		'description: "Agent source write observed"',
		'references:',
		`  - "${AGENT_CREATED_CARD_PATH}"`,
		'  - "docs"',
		'referenced_by: []',
		''
	].join('\n'), 'utf8');
	const discardIssue = readme.locator('[data-testid="reference-issue"][data-reference-from="README.md"][data-reference-to="docs"]');
	await discardIssue.waitFor({ state: 'visible', timeout: 10_000 });
	await sourceIssueMarker.waitFor({ state: 'visible', timeout: 10_000 });
	await assertCanvasEdgeGone(page, 'README.md', 'docs');
	await discardIssue.locator('[data-testid="reference-issue-discard"]').evaluate(button => button.click());
	await waitUntil(() => {
		const readmeBadge = fs.readFileSync(readmeBadgePath, 'utf8');
		const docsBadge = fs.existsSync(docsBadgePath) ? fs.readFileSync(docsBadgePath, 'utf8') : '';
		return !readmeBadge.includes('- "docs"')
			&& !docsBadge.includes('- "README.md"')
			&& readmeBadge.includes(`- "${AGENT_CREATED_CARD_PATH}"`);
	}, 'Discard to scrub both possible halves while preserving the repaired reference');
	await discardIssue.waitFor({ state: 'detached', timeout: 10_000 });
	await sourceIssueMarker.waitFor({ state: 'detached', timeout: 10_000 });
	await assertCanvasEdgeGone(page, 'README.md', 'docs');
	await assertCanvasEdgeVisible(page, 'README.md', AGENT_CREATED_CARD_PATH);
	await readme.locator('.basehalf-canvas-card-badge-toggle:visible').evaluate(button => button.click());
	await prompt.waitFor({ state: 'detached', timeout: 10_000 });

	// Remove the target half again, then keep the prospective TARGET detail open
	// across an external reciprocal write. The collapsed toggle itself remains
	// focused while its summary refreshes, so a background Agent write neither
	// leaks an incomplete edge nor strands keyboard focus on a detached button.
	fs.mkdirSync(targetBadgeDirectory, { recursive: true });
	fs.writeFileSync(targetBadgePath, [
		`path: "${AGENT_CREATED_CARD_PATH}"`,
		'kind: file',
		'references: []',
		'referenced_by: []',
		''
	].join('\n'), 'utf8');
	await assertCanvasEdgeGone(page, 'README.md', AGENT_CREATED_CARD_PATH);
	await openExplorerRow(page, AGENT_CREATED_CARD_PATH);
	await assertCardDetail(page, AGENT_CREATED_CARD_PATH);
	await page.locator('[data-testid="card-detail-badge-toggle"]').waitFor({ state: 'visible', timeout: 10_000 });
	const initialDetailBadge = await page.evaluate(() => {
		const detail = document.querySelector('.basehalf-card-detail.visible');
		const toggle = detail?.querySelector('[data-testid="card-detail-badge-toggle"]');
		const summary = toggle?.querySelector('.basehalf-card-detail-badge-summary');
		const glyph = toggle?.querySelector('.basehalf-file-glyph');
		return {
			expanded: toggle?.getAttribute('aria-expanded'),
			bodyCount: detail?.querySelectorAll('.basehalf-card-detail-badge-body').length ?? -1,
			summary: summary?.textContent?.trim(),
			summaryEmpty: summary?.classList.contains('empty'),
			glyphTone: glyph instanceof SVGElement ? glyph.style.color : undefined
		};
	});
	if (initialDetailBadge.expanded !== 'false'
		|| initialDetailBadge.bodyCount !== 0
		|| initialDetailBadge.summary !== 'What agents should know about this file'
		|| initialDetailBadge.summaryEmpty !== true
		|| !initialDetailBadge.glyphTone?.includes('--basehalf-detail-badge-ghost')) {
		throw new Error(`Open target detail exposed a one-sided Agent reference: ${JSON.stringify(initialDetailBadge)}`);
	}

	const detailBadgeToggle = page.locator('[data-testid="card-detail-badge-toggle"]');
	await detailBadgeToggle.focus();
	fs.writeFileSync(targetBadgePath, [
		`path: "${AGENT_CREATED_CARD_PATH}"`,
		'kind: file',
		'references: []',
		'referenced_by:',
		'  - "README.md"',
		''
	].join('\n'), 'utf8');

	// The same still-open detail must receive the reciprocal write through its
	// live badge refresh path: collapsed summary/glyph become relational without
	// a navigation round trip and focus returns to the replacement toggle.
	await page.waitForFunction(expectedTitle => {
		const detail = document.querySelector('.basehalf-card-detail.visible');
		const title = detail?.querySelector('.basehalf-card-detail-title')?.textContent ?? '';
		const toggle = detail?.querySelector('[data-testid="card-detail-badge-toggle"]');
		const summary = toggle?.querySelector('.basehalf-card-detail-badge-summary');
		const glyph = toggle?.querySelector('.basehalf-file-glyph');
		return title.includes(expectedTitle)
			&& toggle?.getAttribute('aria-expanded') === 'false'
			&& detail?.querySelector('.basehalf-card-detail-badge-body') === null
			&& summary?.textContent?.trim() === '0 references · ← 1'
			&& !summary.classList.contains('empty')
			&& toggle?.getAttribute('data-reference-issue-count') === '0'
			&& document.activeElement === toggle
			&& glyph instanceof SVGElement
			&& glyph.style.color.includes('--vscode-textLink-foreground');
	}, AGENT_CREATED_CARD_PATH, { timeout: 10_000 });
	await detailBadgeToggle.click();
	const detailBadgeBody = page.locator('.basehalf-card-detail-badge-body');
	await detailBadgeBody.waitFor({ state: 'visible', timeout: 10_000 });
	await page.waitForFunction(() => document.activeElement?.classList.contains('basehalf-canvas-card-badge-prompt'), null, { timeout: 10_000 });
	const inboundToggle = detailBadgeBody.locator('.basehalf-canvas-card-inbound-toggle', { hasText: '← 1 referenced by' });
	await inboundToggle.waitFor({ state: 'visible', timeout: 10_000 });

	// A background Agent write must not rebuild the Badge zone while keyboard
	// focus Tabs among its controls. The explicit inbound action that follows
	// must still force an immediate render and restore focus to its new button.
	const detailPrompt = detailBadgeBody.locator('.basehalf-canvas-card-badge-prompt');
	await detailPrompt.focus();
	fs.writeFileSync(targetBadgePath, [
		`path: "${AGENT_CREATED_CARD_PATH}"`,
		'kind: file',
		'description: "Agent refresh while Badge controls are focused"',
		'references: []',
		'referenced_by:',
		'  - "README.md"',
		''
	].join('\n'), 'utf8');
	await page.waitForTimeout(500);
	await page.keyboard.press('Tab');
	await page.waitForFunction(() => {
		const active = document.activeElement;
		const prompt = document.querySelector('.basehalf-card-detail.visible .basehalf-canvas-card-badge-prompt');
		return active?.classList.contains('basehalf-canvas-card-add-reference')
			&& prompt instanceof HTMLTextAreaElement
			&& prompt.value === '';
	}, null, { timeout: 10_000 });
	await page.keyboard.press('Tab');
	await page.waitForFunction(() => document.activeElement?.classList.contains('basehalf-canvas-card-inbound-toggle'), null, { timeout: 10_000 });
	await page.keyboard.press('Enter');
	const reciprocalRow = detailBadgeBody.locator('.basehalf-canvas-card-badge-row', { hasText: 'README.md' });
	await reciprocalRow.waitFor({ state: 'visible', timeout: 10_000 });
	await page.waitForFunction(() => document.activeElement?.classList.contains('basehalf-canvas-card-inbound-toggle'), null, { timeout: 10_000 });
	if (await reciprocalRow.locator('.basehalf-canvas-card-badge-direction').textContent() !== '←') {
		throw new Error('The reciprocal target detail rendered the Agent relationship with the wrong direction');
	}
	await detailBadgeToggle.click();
	await detailBadgeBody.waitFor({ state: 'detached', timeout: 10_000 });
	await closeCardDetailIfOpen(page);
	await assertCanvasEdgeVisible(page, 'README.md', AGENT_CREATED_CARD_PATH);
	await page.locator('.basehalf-canvas-card[data-basehalf-card-path="README.md"] .basehalf-canvas-card-badge-dot:visible')
		.waitFor({ state: 'visible', timeout: 10_000 });
}

// Select the agent-drawn edge with the mouse and delete it with the keyboard:
// the semantic reference is scrubbed from badge.yaml and the line disappears.
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
	const readmeBadgePath = path.join(workspacePath, '.bh', 'mirror', 'README.md', 'badge.yaml');
	if (!fs.readFileSync(readmeBadgePath, 'utf8').includes(`- "${target}"`)) {
		throw new Error('Delete outside the canvas removed the selected semantic edge');
	}
	await assertCanvasEdgeVisible(page, 'README.md', target);
}

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
	await page.keyboard.press('Delete');

	const readmeBadgePath = path.join(workspacePath, '.bh', 'mirror', 'README.md', 'badge.yaml');
	const targetBadgePath = path.join(workspacePath, '.bh', 'mirror', target, 'badge.yaml');
	await waitUntil(() => !fs.readFileSync(readmeBadgePath, 'utf8').includes(`- "${target}"`), `README badge reference to ${target} to be removed`);
	await waitUntil(() => !fs.existsSync(targetBadgePath) || !fs.readFileSync(targetBadgePath, 'utf8').includes('- "README.md"'), `${target} backlink to README to be removed`);
	await assertCanvasEdgeGone(page, 'README.md', target);
	if (target === AGENT_CREATED_CARD_PATH) {
		fs.rmSync(path.join(workspacePath, target));
		await page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${target}"]`)
			.waitFor({ state: 'detached', timeout: 10_000 });
	}
}

async function edgeScreenMidpoint(page, from, to) {
	const point = await page.evaluate(([source, target]) => {
		const hit = Array.from(document.querySelectorAll('.basehalf-canvas-edge-hit'))
			.find(candidate => candidate instanceof SVGPathElement && candidate.dataset.edgeId === `${source}${String.fromCharCode(0)}${target}`);
		if (!(hit instanceof SVGPathElement)) {
			return undefined;
		}
		const mid = hit.getPointAtLength(hit.getTotalLength() / 2);
		const ctm = hit.getScreenCTM();
		return ctm ? new DOMPoint(mid.x, mid.y).matrixTransform(ctm) : undefined;
	}, [from, to]);
	if (!point) {
		throw new Error(`Could not locate the ${from}→${to} edge hit path`);
	}
	return point;
}

// Rename an annotated file through the Explorer: the badge follows the file,
// the graph rewrites on both sides, and the derived edge keeps drawing at the
// new path. Renames back at the end so later steps see the original fixture.
async function assertExplorerRenameCascadesMirror(page) {
	const guideBadgeDir = path.join(workspacePath, '.bh', 'mirror', 'docs', 'guide.md');
	const farBadgeDir = path.join(workspacePath, '.bh', 'mirror', 'docs', 'far.md');
	fs.mkdirSync(guideBadgeDir, { recursive: true });
	fs.mkdirSync(farBadgeDir, { recursive: true });
	fs.writeFileSync(path.join(guideBadgeDir, 'badge.yaml'), [
		'path: "docs/guide.md"',
		'kind: file',
		'description: "Guide badge"',
		'references:',
		'  - "docs/far.md"',
		'referenced_by: []',
		''
	].join('\n'), 'utf8');
	fs.writeFileSync(path.join(farBadgeDir, 'badge.yaml'), [
		'path: "docs/far.md"',
		'kind: file',
		'references: []',
		'referenced_by:',
		'  - "docs/guide.md"',
		''
	].join('\n'), 'utf8');

	// We are on the docs canvas (previous step) — the seeded edge draws.
	await assertCanvasEdgeVisible(page, 'docs/guide.md', 'docs/far.md');

	await renameExplorerEntry(page, 'guide.md', 'guide-renamed.md');
	await waitUntil(() => {
		const moved = path.join(workspacePath, '.bh', 'mirror', 'docs', 'guide-renamed.md', 'badge.yaml');
		return fs.existsSync(moved) && fs.readFileSync(moved, 'utf8').includes('path: "docs/guide-renamed.md"');
	}, 'badge.yaml to follow the renamed file');
	await waitUntil(() => badgeMirrorIsAbsentOrCanonicalEmpty(path.join(guideBadgeDir, 'badge.yaml')), 'old badge.yaml to be absent or a canonical empty tombstone');
	await waitUntil(() => fs.readFileSync(path.join(farBadgeDir, 'badge.yaml'), 'utf8').includes('- "docs/guide-renamed.md"'), 'inbound reference to be rewritten');
	await assertCanvasEdgeVisible(page, 'docs/guide-renamed.md', 'docs/far.md');

	// Restore the fixture: rename back and let the cascade carry it home.
	await renameExplorerEntry(page, 'guide-renamed.md', 'guide.md');
	await waitUntil(() => {
		const restored = path.join(guideBadgeDir, 'badge.yaml');
		if (!fs.existsSync(restored)) {
			return false;
		}
		const contents = fs.readFileSync(restored, 'utf8');
		return contents.includes('path: "docs/guide.md"')
			&& contents.includes('description: "Guide badge"')
			&& contents.includes('- "docs/far.md"');
	}, 'badge.yaml to reuse the target tombstone and follow the rename back');
}

function badgeMirrorIsAbsentOrCanonicalEmpty(file) {
	if (!fs.existsSync(file)) {
		return true;
	}
	const contents = fs.readFileSync(file, 'utf8');
	return !/^description:/m.test(contents)
		&& /^references:\s*\[\]\s*$/m.test(contents)
		&& /^referenced_by:\s*\[\]\s*$/m.test(contents)
		&& !/^\s+-\s+/m.test(contents);
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
	await readme.scrollIntoViewIfNeeded();
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
		return {
			transform: getComputedStyle(viewport).transform,
			point: { x: root.getBoundingClientRect().left + 28, y: root.getBoundingClientRect().top + 28 }
		};
	});
	await page.mouse.move(before.point.x, before.point.y);
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
	await island.hover();

	const edit = island.locator('.basehalf-raw-passthrough-edit');
	await edit.waitFor({ state: 'visible', timeout: 5_000 });
	await edit.click();

	// The card reopens in the source projection with the island's line selected.
	const sourceEditor = page.locator('.basehalf-card-detail-source-editor .monaco-editor');
	await sourceEditor.waitFor({ state: 'visible', timeout: 15_000 });
	// The whole block tile is selected; the recorded cursor sits at the
	// selection end, which may include the tile's trailing blank line.
	const islandLine = lineNumberForText('README.md', 'smoke-raw-island');
	const focusPath = path.join(workspacePath, '.bh', 'mirror', 'README.md', 'focus.yaml');
	await waitUntil(() => {
		if (!fs.existsSync(focusPath)) {
			return false;
		}
		const content = fs.readFileSync(focusPath, 'utf8');
		const line = Number(/^ {2}line: (\d+)$/m.exec(content)?.[1] ?? NaN);
		return content.includes('projection: source') && line >= islandLine && line <= islandLine + 1;
	}, `focus.yaml to record the source selection at the raw island (line ${islandLine})`);

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

async function assertFocusLine(relativePath, line) {
	const focusPath = path.join(workspacePath, '.bh', 'mirror', ...relativePath.split('/'), 'focus.yaml');
	await waitUntil(() => {
		if (!fs.existsSync(focusPath)) {
			return false;
		}
		const content = fs.readFileSync(focusPath, 'utf8');
		return content.includes('projection: rich')
			&& content.includes('cursor:')
			&& content.includes(`  line: ${line}`);
	}, `focus.yaml for ${relativePath} to point at line ${line}`);
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
