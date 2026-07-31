/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { _electron } from '@playwright/test';
import { execFileSync } from 'child_process';
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
const AGENT_CREATED_CARD_PATH = 'agent-angle.md';
const runRoot = opts.output ?? fs.mkdtempSync(path.join(os.tmpdir(), 'basehalf-smoke-'));
const logsPath = path.join(runRoot, 'logs');
const crashesPath = path.join(runRoot, 'crashes');
const userDataDir = path.join(runRoot, 'user-data');
const extensionsDir = path.join(runRoot, 'extensions');
const workspacePath = path.join(runRoot, 'workspace');

for (const dir of [logsPath, crashesPath, userDataDir, extensionsDir, workspacePath]) {
	fs.mkdirSync(dir, { recursive: true });
}

// Playwright cannot inspect a native macOS context menu. The smoke profile is
// disposable, so use VS Code's custom renderer here to exercise the same menu
// registrations and commands without changing product or user settings.
fs.mkdirSync(path.join(userDataDir, 'User'), { recursive: true });
fs.writeFileSync(
	path.join(userDataDir, 'User', 'settings.json'),
	JSON.stringify({ 'window.menuStyle': 'custom' }, null, '\t'),
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
	'--skip-welcome',
	'--disable-telemetry',
	'--disable-experiments',
	'--no-cached-data',
	'--disable-updates',
	'--disable-extension=vscode.vscode-api-tests',
	`--crash-reporter-directory=${crashesPath}`,
	'--disable-workspace-trust',
	`--logsPath=${logsPath}`,
	`--user-data-dir=${userDataDir}`,
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
	TERM: 'dumb',
	COLORTERM: '',
	NO_COLOR: '1',
	NODE_DISABLE_COLORS: '1',
	FORCE_COLOR: '0',
	ELECTRON_ENABLE_STACK_DUMPING: '1',
	ELECTRON_ENABLE_LOGGING: '1'
};

let app;
let canvasViewportBeforeCardDetail;
try {
	if (!fs.existsSync(electronPath)) {
		throw new Error(`Dev Electron was not found at ${electronPath}. Run npm run electron or npm run basehalf:smoke first.`);
	}

	app = await _electron.launch({ executablePath: electronPath, args, timeout: 60_000, env });
	const page = await app.firstWindow();
	page.on('pageerror', error => console.error(`[basehalf-smoke] pageerror: ${error.stack || error.message}`));
	page.on('console', message => {
		if (shouldLogConsoleMessage(message)) {
			const location = message.location();
			const source = location.url ? ` (${location.url}:${location.lineNumber + 1})` : '';
			console.error(`[basehalf-smoke] console.${message.type()}: ${message.text()}${source}`);
		}
	});

	await page.setViewportSize({ width: 1280, height: 860 });
	await page.locator('.monaco-workbench').waitFor({ state: 'visible', timeout: 60_000 });
	await page.locator('.basehalf-canvas-workbench').waitFor({ state: 'visible', timeout: 60_000 });
	await step('fresh-canvas-framed', () => assertFreshCanvasFramed(page));
	await step('root-titlebar-breadcrumb', () => assertBaseHalfRootTitlebarBreadcrumb(page));
	await step('canvas-grid-scoped-to-canvas', () => assertCanvasGridScopedToCanvas(page));
	if (!opts.pluginOnly && !opts.contentOnly && !opts.settingsOnly) {
		await step('canvas-double-click-create-menu', () => assertCanvasDoubleClickCreateMenu(page));
		await step('canvas-create-result-node-submenu', () => assertCanvasCreateResultNodeSubmenu(page));
		await step('canvas-create-note-file-folder', () => assertCanvasCreateNoteFileAndFolder(page));
		await step('canvas-note-selection-controls', () => assertCanvasNoteSelectionControls(page));
	}

		if (opts.settingsOnly) {
			await step('settings-basehalf-category', () => assertBaseHalfSettingsCategory(page));
			await step('global-model-services-manager', () => assertGlobalModelServicesManager(page));
			console.log(JSON.stringify({
				ok: true,
				workspace: workspacePath,
				checks: ['settings-basehalf-category', 'global-model-services-manager']
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
				await step('video-workflow-node-run', () => assertVideoWorkflowNodeRun(page));
				console.log(JSON.stringify({
					ok: true,
					workspace: workspacePath,
					checks: [
						'video-workflow-template',
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
	await step('initial-native-forward-readme-card', () => assertNativeForwardOpensCardDetail(page, 'README.md'));

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
} catch (error) {
	await writeFailureArtifacts(error);
	throw error;
} finally {
	if (app) {
		await app.close().catch(() => undefined);
	}

	if (!opts.keep && !opts.output) {
		fs.rmSync(runRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
}

function parseArgs(args) {
	const parsed = {
		keep: false,
		verbose: false,
		canvasOnly: false,
		contentOnly: false,
		pluginOnly: false,
		settingsOnly: false,
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
  --canvas-only       Run the canvas/edge interaction slice without unrelated workbench suites.
  --content-only      Run Card Detail media/PDF rendering and rich attachment integration.
  --plugin-only       Run the curated plugin and AI Video integration slice.
  --settings-only     Run BaseHalf Settings and global model-service management.
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
	await waitForQuickInputResult(page);
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
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
	const quickInput = visibleQuickInput(page);
	await quickInput.waitFor({ state: 'visible', timeout: 15_000 });
	await quickInput.fill(`>${value}`);
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

async function waitForQuickInputResult(page) {
	await page.waitForFunction(() => {
		const input = Array.from(document.querySelectorAll('.quick-input-widget input')).find(candidate => {
			const element = candidate;
			const rect = element.getBoundingClientRect();
			const style = getComputedStyle(element);
			return style.display !== 'none'
				&& style.visibility !== 'hidden'
				&& rect.width > 0
				&& rect.height > 0;
		});
		const inputVisible = !!input && (() => {
			const element = input;
			const rect = element.getBoundingClientRect();
			const style = getComputedStyle(element);
			return style.display !== 'none'
				&& style.visibility !== 'hidden'
				&& rect.width > 0
				&& rect.height > 0;
		})();
		const rows = Array.from(document.querySelectorAll('.quick-input-list .monaco-list-row[role="option"]'));
		const hasResult = rows.some(row => {
			const text = (row.getAttribute('aria-label') ?? row.textContent ?? '').replace(/\s+/g, ' ').trim();
			return text && text !== 'No matching results';
		});
		return hasResult || !inputVisible;
	}, null, { timeout: 15_000 });
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
			&& (text.includes('Model Services') || text.includes('basehalf.models.services'));
	}, null, { timeout: 20_000 });
}

async function assertGlobalModelServicesManager(page) {
	const manageLink = page.locator('.settings-editor a', { hasText: 'Manage Model Services' }).first();
	await manageLink.waitFor({ state: 'visible', timeout: 15_000 });
	await manageLink.click();
	const widget = page.locator('.quick-input-widget:visible').last();
	await widget.waitFor({ state: 'visible', timeout: 15_000 });
	await widget.locator('.quick-input-title', { hasText: 'Model Services' }).waitFor({ state: 'visible', timeout: 15_000 });
	await widget.locator('.quick-input-list .monaco-list-row', { hasText: 'Add Model Service' }).first().waitFor({ state: 'visible', timeout: 15_000 });
	await page.keyboard.press('Escape');
	await widget.waitFor({ state: 'hidden', timeout: 15_000 });
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
	await waitForQuickInputResult(page);

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
	// The projection surface must ACTIVATE via its first-frame signal. The
	// bound must stay below the workbench's 10s wedged-boot fallback swap,
	// or a broken rendered ack would still pass here.
	await page.locator('.basehalf-card-detail-surface.active').waitFor({ state: 'visible', timeout: 8_000 });
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
		await assertCardDetail(page, name);
		const branchPath = path.join(workspacePath, 'docs', name);
		await waitUntil(() => fs.existsSync(branchPath), `${name} to be created from the PDF selection`, 15_000);
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
	}

	if (!fs.existsSync(sourcePath)) {
		throw new Error('Growing PDF branches unexpectedly moved or removed the source document');
	}
	await closeCardDetailIfOpen(page);
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
	if (frameNode.version !== 2
		|| frameNode.kind !== 'image'
		|| frameNode.recipe?.recipeId !== 'pointa.basehalf-ai-video.storyboard-frame'
		|| frameNode.recipe?.inputBindings?.[0]?.sourcePath !== `${workflowName}/shots/shot-01/storyboard.md`) {
		throw new Error(`The starter workflow did not produce a host-owned executable node: ${JSON.stringify(frameNode)}`);
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
	const resetZoom = page.locator('.basehalf-canvas-zoom-button[aria-label="Reset Zoom"]');
	if (await resetZoom.isEnabled()) {
		await resetZoom.click();
	}
	await centerCanvasCards(page, [card]);
	await page.waitForFunction(path => document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${path}"]`)?.getAttribute('data-preview-level') !== 'shell', `${workflowName}/${relativeNodePath}`, { timeout: 10_000 });
	const action = card.locator('.basehalf-canvas-node-action');
	await page.waitForFunction(path => {
		const button = document.querySelector(`.basehalf-canvas-card[data-basehalf-card-path="${path}"] .basehalf-canvas-node-action`);
		return button instanceof HTMLButtonElement
			&& button.offsetParent !== null
			&& button.dataset.nodeAction === 'run'
			&& button.getAttribute('aria-disabled') !== 'true'
			&& button.textContent?.trim() === 'Run';
	}, `${workflowName}/${relativeNodePath}`, { timeout: 20_000 });
	if ((await action.textContent())?.trim() !== 'Run') {
		throw new Error(`The executable node did not expose one Run action: ${(await action.textContent()) ?? 'missing'}`);
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
			const run = node.runs?.find(candidate => candidate.id === node.current?.runId);
			const output = node.current?.outputPaths?.[0];
			return run?.status === 'succeeded'
				&& node.current?.source === 'run'
				&& typeof output === 'string'
				&& fs.existsSync(path.join(workspacePath, output));
		} catch {
			return false;
		}
	}, 'canvas node run to persist Current and History', 20_000);
	if (await page.evaluate(() => (window as typeof window & { __basehalfSmokeNodeActionRegressed?: boolean }).__basehalfSmokeNodeActionRegressed === true)) {
		throw new Error('The canvas node action reverted to Run while execution was active.');
	}
	await card.locator('.basehalf-canvas-card-media-visual').waitFor({ state: 'visible', timeout: 15_000 });
	const node = JSON.parse(fs.readFileSync(nodePath, 'utf8'));
	const run = node.runs?.[0];
	const primary = run?.artifacts?.find(artifact => artifact.id === run.primaryArtifactId);
	if (node.runs?.length !== 1
		|| run?.recipe?.recipeId !== node.recipe?.recipeId
		|| !/^v1;source=[A-Za-z0-9_-]{43};sha256=[A-Za-z0-9_-]{43}$/.test(run?.inputs?.[0]?.revision ?? '')
		|| primary?.kind !== 'image'
		|| typeof primary.sha256 !== 'string'
		|| primary.sha256.length !== 43
		|| typeof primary.size !== 'number') {
		throw new Error('The node did not preserve verified inputs, artifacts, and recipe state in History.');
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

async function assertCanvasContainsCard(page, path) {
	await page.locator('.basehalf-card-detail.visible').waitFor({ state: 'hidden', timeout: 20_000 });
	const card = page.locator(`.basehalf-canvas-card[data-basehalf-card-path="${path}"]`);
	if (await card.isVisible({ timeout: 2_000 }).catch(() => false)) {
		return;
	}
	const zoomOut = page.locator('.basehalf-canvas-zoom-button[aria-label="Zoom Out"]');
	for (let attempt = 0; attempt < 8 && await zoomOut.isEnabled(); attempt++) {
		await zoomOut.click();
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
	const reset = page.locator('.basehalf-canvas-zoom-button[aria-label="Reset Zoom"]');
	if (await reset.isEnabled()) {
		await reset.click();
	}
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '1', null, { timeout: 10_000 });
	const beforeGesture = await page.evaluate(() => {
		const root = document.querySelector('.basehalf-canvas-workbench');
		const controls = document.querySelector('.basehalf-canvas-zoom-controls');
		const viewport = document.querySelector('.basehalf-canvas-cards .react-flow__viewport');
		if (!(root instanceof HTMLElement) || !(controls instanceof HTMLElement) || !(viewport instanceof HTMLElement)) {
			throw new Error('Missing React Flow zoom geometry');
		}
		const rootRect = root.getBoundingClientRect();
		const controlsRect = controls.getBoundingClientRect();
		return {
			controls: { left: controlsRect.left, top: controlsRect.top },
			viewport: getComputedStyle(viewport).transform,
			rightGap: rootRect.right - controlsRect.right,
			bottomGap: rootRect.bottom - controlsRect.bottom,
			center: { x: rootRect.left + rootRect.width / 2, y: rootRect.top + rootRect.height / 2 }
		};
	});
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
	if (beforeGesture.rightGap < 4 || beforeGesture.rightGap > 24 || beforeGesture.bottomGap < 6 || beforeGesture.bottomGap > 32) {
		throw new Error(`Expected zoom controls in the bottom-right of the canvas viewport: ${JSON.stringify(beforeGesture)}`);
	}

	const initialZoom = zoomAfterGesture;
	const nextZoom = Number((initialZoom + 0.1).toFixed(4));
	await page.locator('.basehalf-canvas-zoom-button[aria-label="Zoom In"]').click();
	await page.waitForFunction(expected => Number(document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom')) === expected, nextZoom, { timeout: 10_000 });
	await page.locator('.basehalf-canvas-zoom-value', { hasText: `${Math.round(nextZoom * 100)}%` }).waitFor({ state: 'visible', timeout: 10_000 });
	for (let index = 0; index < 5; index++) {
		await page.locator('.basehalf-canvas-zoom-button[aria-label="Zoom In"]').click();
	}
	await page.waitForFunction(() => {
		const root = document.querySelector('.basehalf-canvas-workbench');
		const viewport = document.querySelector('.basehalf-canvas-cards .react-flow__viewport');
		if (!(root instanceof HTMLElement) || !(viewport instanceof HTMLElement)) {
			return false;
		}
		const transform = getComputedStyle(viewport).transform;
		const matrix = transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(transform);
		return Math.abs(matrix.a - Number(root.dataset.zoom)) < 0.01;
	}, null, { timeout: 10_000 });
	await page.locator('.basehalf-canvas-zoom-button[aria-label="Reset Zoom"]').click();
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '1', null, { timeout: 10_000 });
	await page.locator('.basehalf-canvas-zoom-value', { hasText: '100%' }).waitFor({ state: 'visible', timeout: 10_000 });
}

async function assertNativeForwardOpensCardDetail(page, title) {
	await clickCommandCenterNavigationButton(page, 'arrow-right', 'Go Forward');
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

async function assertCanvasNoteSelectionControls(page) {
	await closeCardDetailIfOpen(page);
	const pane = page.locator('.react-flow__pane');
	const note = page.locator('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
	const folder = page.locator('.basehalf-canvas-card[data-basehalf-card-path="src"]');
	const resetZoom = page.locator('.basehalf-canvas-zoom-button[aria-label="Reset Zoom"]');
	const zoomOut = page.locator('.basehalf-canvas-zoom-button[aria-label="Zoom Out"]');
	if (await resetZoom.isEnabled()) {
		await resetZoom.click();
	}
	await note.waitFor({ state: 'visible', timeout: 20_000 });
	await folder.waitFor({ state: 'visible', timeout: 20_000 });
	await centerCanvasCards(page, [note]);
	await pane.click({ position: { x: 16, y: 16 } });
	await note.click();

	const toolbar = page.getByRole('toolbar', { name: 'README.md note actions', exact: true });
	const views = page.getByRole('region', { name: 'README.md note views', exact: true });
	await toolbar.waitFor({ state: 'visible', timeout: 10_000 });
	await views.waitFor({ state: 'visible', timeout: 10_000 });
	if (await page.locator('.basehalf-canvas-selection-toolbar').count() !== 0) {
		throw new Error('A selected Note rendered both specialized and generic selection controls');
	}
	const openButton = toolbar.locator('button').last();
	if (!await openButton.evaluate(button => button.classList.contains('codicon-screen-full'))) {
		throw new Error('The Note open action is not the last toolbar button');
	}

	const initialBoxes = await Promise.all([note.boundingBox(), toolbar.boundingBox(), views.boundingBox()]);
	const [initialNoteBox, initialToolbarBox, initialViewsBox] = initialBoxes;
	if (!initialNoteBox || !initialToolbarBox || !initialViewsBox) {
		throw new Error('Could not measure the selected Note controls');
	}
	if (initialToolbarBox.y + initialToolbarBox.height > initialNoteBox.y - 8) {
		throw new Error('The Note toolbar overlaps the top connection area');
	}
	if (initialViewsBox.y < initialNoteBox.y + initialNoteBox.height + 8) {
		throw new Error('The Note views panel overlaps the bottom connection area');
	}
	const pointerPolicy = await views.evaluate(element => {
		const actions = element.querySelector('.basehalf-canvas-note-view-actions');
		return {
			panel: getComputedStyle(element).pointerEvents,
			actions: actions ? getComputedStyle(actions).pointerEvents : ''
		};
	});
	if (pointerPolicy.panel !== 'none' || pointerPolicy.actions === 'none') {
		throw new Error(`The Note views panel blocks background interactions outside its actions: ${JSON.stringify(pointerPolicy)}`);
	}
	const stacking = await note.evaluate((card, controlsSelector) => {
		const node = card.closest('.react-flow__node');
		const controls = document.querySelector(controlsSelector);
		return {
			node: node ? Number(getComputedStyle(node).zIndex) : Number.NaN,
			controls: controls ? Number(getComputedStyle(controls).zIndex) : Number.NaN
		};
	}, '.basehalf-canvas-note-toolbar');
	if (!Number.isFinite(stacking.node) || !Number.isFinite(stacking.controls) || stacking.controls <= stacking.node) {
		throw new Error(`Note controls do not stay above the selected node: ${JSON.stringify(stacking)}`);
	}

	for (let attempt = 0; attempt < 12 && await zoomOut.isEnabled(); attempt++) {
		await zoomOut.click();
		await page.waitForTimeout(50);
	}
	await page.waitForFunction(() => Number(document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom')) <= 0.21, null, { timeout: 10_000 });
	const zoomedBoxes = await Promise.all([toolbar.boundingBox(), views.boundingBox()]);
	const [zoomedToolbarBox, zoomedViewsBox] = zoomedBoxes;
	if (!zoomedToolbarBox || !zoomedViewsBox
		|| Math.abs(zoomedToolbarBox.width - initialToolbarBox.width) > 1
		|| Math.abs(zoomedToolbarBox.height - initialToolbarBox.height) > 1
		|| Math.abs(zoomedViewsBox.width - initialViewsBox.width) > 1
		|| Math.abs(zoomedViewsBox.height - initialViewsBox.height) > 1) {
		throw new Error('Note controls changed screen size with canvas zoom');
	}
	await openButton.click();
	await assertCardDetail(page, 'README.md');
	await page.locator('.basehalf-card-detail-surface.active .basehalf-card-detail-markdown-rich').waitFor({ state: 'visible', timeout: 15_000 });
	await closeCardDetailIfOpen(page);
	await toolbar.waitFor({ state: 'visible', timeout: 10_000 });
	await views.waitFor({ state: 'visible', timeout: 10_000 });
	await page.waitForFunction(() => Number(document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom')) <= 0.21, null, { timeout: 10_000 });
	await resetZoom.click();
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom') === '1', null, { timeout: 10_000 });

	const canvasBox = await page.locator('.basehalf-canvas-cards').boundingBox();
	const centeredNoteBox = await note.boundingBox();
	if (!canvasBox || !centeredNoteBox) {
		throw new Error('Could not measure the canvas before the Note edge-placement check');
	}
	const panX = canvasBox.x + canvasBox.width - 12 - (centeredNoteBox.x + centeredNoteBox.width);
	const panY = canvasBox.y + canvasBox.height - 12 - (centeredNoteBox.y + centeredNoteBox.height);
	const panStart = { x: canvasBox.x + canvasBox.width / 2, y: canvasBox.y + 40 };
	await page.mouse.move(panStart.x, panStart.y);
	await page.mouse.down({ button: 'middle' });
	await page.mouse.move(panStart.x + panX, panStart.y + panY, { steps: 8 });
	await page.mouse.up({ button: 'middle' });
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-note-toolbar')?.getAttribute('data-placement') === 'stack-above', null, { timeout: 10_000 });
	const edgeBoxes = await Promise.all([
		page.locator('.basehalf-canvas-cards').boundingBox(),
		toolbar.boundingBox(),
		views.boundingBox()
	]);
	const [edgeCanvasBox, edgeToolbarBox, edgeViewsBox] = edgeBoxes;
	if (!edgeCanvasBox || !edgeToolbarBox || !edgeViewsBox
		|| edgeToolbarBox.x < edgeCanvasBox.x + 7
		|| edgeViewsBox.x < edgeCanvasBox.x + 7
		|| edgeToolbarBox.x + edgeToolbarBox.width > edgeCanvasBox.x + edgeCanvasBox.width - 7
		|| edgeViewsBox.x + edgeViewsBox.width > edgeCanvasBox.x + edgeCanvasBox.width - 7
		|| edgeToolbarBox.y < edgeCanvasBox.y + 7
		|| edgeViewsBox.y < edgeCanvasBox.y + 7
		|| edgeToolbarBox.y + edgeToolbarBox.height > edgeCanvasBox.y + edgeCanvasBox.height - 7
		|| edgeViewsBox.y + edgeViewsBox.height > edgeCanvasBox.y + edgeCanvasBox.height - 7) {
		throw new Error('Note controls escaped the canvas at the lower-right viewport edge');
	}
	await centerCanvasCards(page, [note]);
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-note-toolbar')?.getAttribute('data-placement') === 'split', null, { timeout: 10_000 });
	const cardsHost = page.locator('.basehalf-canvas-cards');
	const originalHostWidth = await cardsHost.evaluate(element => element.style.width);
	const originalHostBox = await cardsHost.boundingBox();
	if (!originalHostBox || originalHostBox.width <= 600) {
		throw new Error('The canvas is too narrow for the resize-observer smoke check');
	}
	const resizedHostWidth = Math.round(originalHostBox.width * 0.62);
	await cardsHost.evaluate((element, width) => { element.style.width = `${width}px`; }, resizedHostWidth);
	await page.waitForFunction(width => {
		const host = document.querySelector('.basehalf-canvas-cards');
		const controls = document.querySelector('.basehalf-canvas-note-views');
		if (!(host instanceof HTMLElement) || !(controls instanceof HTMLElement)) {
			return false;
		}
		const hostRect = host.getBoundingClientRect();
		const controlsRect = controls.getBoundingClientRect();
		return Math.abs(hostRect.width - width) <= 1
			&& controlsRect.left >= hostRect.left + 7
			&& controlsRect.right <= hostRect.right - 7;
	}, resizedHostWidth, { timeout: 10_000 });
	await cardsHost.evaluate((element, width) => { element.style.width = width; }, originalHostWidth);
	await page.waitForFunction(width => Math.abs(document.querySelector('.basehalf-canvas-cards')?.getBoundingClientRect().width - width) <= 1, originalHostBox.width, { timeout: 10_000 });

	await pane.click({ position: { x: 16, y: 16 } });
	await toolbar.waitFor({ state: 'hidden', timeout: 10_000 });
	await views.waitFor({ state: 'hidden', timeout: 10_000 });
	await centerCanvasCards(page, [folder]);
	await folder.click();
	await page.getByRole('toolbar', { name: 'Selected card actions', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
	if (await page.locator('.basehalf-canvas-note-toolbar, .basehalf-canvas-note-views').count() !== 0) {
		throw new Error('A non-Note card rendered Note selection controls');
	}

	await centerCanvasCards(page, [note]);
	await pane.click({ position: { x: 16, y: 16 } });
	await note.click();
	await centerCanvasCards(page, [folder]);
	await folder.click({ modifiers: ['Shift'] });
	await page.getByRole('toolbar', { name: 'Actions for 2 selected cards', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
	if (await page.locator('.basehalf-canvas-note-toolbar, .basehalf-canvas-note-views').count() !== 0) {
		throw new Error('A multi-selection rendered single-Note controls');
	}

	const selectNote = async () => {
		await centerCanvasCards(page, [note]);
		await pane.click({ position: { x: 16, y: 16 } });
		await note.click();
		await toolbar.waitFor({ state: 'visible', timeout: 10_000 });
		await views.waitFor({ state: 'visible', timeout: 10_000 });
	};

	await selectNote();
	await views.getByRole('button', { name: 'Source', exact: true }).click();
	await assertCardDetail(page, 'README.md');
	await page.locator('.basehalf-card-detail-surface.active .basehalf-card-detail-source').waitFor({ state: 'visible', timeout: 15_000 });
	await assertNoEditorTabFor(page, 'README.md');
	await closeCardDetailIfOpen(page);

	await selectNote();
	await views.getByRole('button', { name: 'Preview', exact: true }).click();
	await assertCardDetail(page, 'README.md');
	await page.locator('.basehalf-card-detail-surface.active .basehalf-card-detail-markdown-preview').waitFor({ state: 'visible', timeout: 15_000 });
	await closeCardDetailIfOpen(page);

	await selectNote();
	await openButton.click();
	await assertCardDetail(page, 'README.md');
	await page.locator('.basehalf-card-detail-surface.active .basehalf-card-detail-markdown-rich').waitFor({ state: 'visible', timeout: 15_000 });
	await closeCardDetailIfOpen(page);

	await centerCanvasCards(page, [note]);
	await pane.click({ position: { x: 16, y: 16 } });
	await note.dblclick({ delay: 40 });
	await assertCardDetail(page, 'README.md');
	await page.locator('.basehalf-card-detail-surface.active .basehalf-card-detail-markdown-rich').waitFor({ state: 'visible', timeout: 15_000 });
	await closeCardDetailIfOpen(page);
}

async function assertCanvasCardBadgePreviewAndConnectors(page) {
	const checkoutConflictDialog = page.locator('.monaco-dialog-box', { hasText: 'Your local changes would be overwritten by checkout' }).first();
	if (await checkoutConflictDialog.isVisible({ timeout: 5_000 }).catch(() => false)) {
		await checkoutConflictDialog.locator('.monaco-button', { hasText: 'Cancel' }).click();
		await checkoutConflictDialog.waitFor({ state: 'hidden', timeout: 10_000 });
	}

	const resetZoom = page.locator('.basehalf-canvas-zoom-button[aria-label="Reset Zoom"]');
	const zoomOut = page.locator('.basehalf-canvas-zoom-button[aria-label="Zoom Out"]');
	const canvasPath = path.join(workspacePath, '.bh', 'mirror', 'canvas.yaml');
	const readmeBadgePath = path.join(workspacePath, '.bh', 'mirror', 'README.md', 'badge.yaml');
	if (await resetZoom.isEnabled()) {
		await resetZoom.click();
	}
	await page.waitForFunction(() => Number(document.querySelector('.basehalf-canvas-workbench')?.getAttribute('data-zoom')) >= 0.5, null, { timeout: 10_000 });

	const readme = page.locator('.basehalf-canvas-card[data-basehalf-card-path="README.md"]');
	await readme.waitFor({ state: 'visible', timeout: 20_000 });
	await centerCanvasCards(page, [readme]);
	await page.waitForFunction(() => document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"]')?.getAttribute('data-preview-level') === 'preview', null, { timeout: 10_000 });
	const fullHeaderMetrics = await page.waitForFunction(() => {
		const header = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="README.md"] .basehalf-canvas-card-header');
		if (!(header instanceof HTMLElement) || !header.isConnected || header.getBoundingClientRect().height <= 0) {
			return false;
		}
		return { height: header.getBoundingClientRect().height, boxSizing: getComputedStyle(header).boxSizing };
	}, null, { timeout: 10_000 }).then(handle => handle.jsonValue());
	if (fullHeaderMetrics.boxSizing !== 'border-box' || fullHeaderMetrics.height > 45) {
		throw new Error(`Expected compact 44px card header, got ${JSON.stringify(fullHeaderMetrics)}`);
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
		await zoomOut.evaluate(button => button.click());
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
	await resetZoom.evaluate(button => button.click());
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
	for (let attempt = 0; attempt < 12 && await zoomOut.isEnabled(); attempt++) {
		await zoomOut.click();
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
	if (await resetZoom.isEnabled()) {
		await resetZoom.click();
	}
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
		if (!await zoomOut.isEnabled()) {
			break;
		}
		await zoomOut.click();
		await page.waitForTimeout(50);
	}
	await docs.waitFor({ state: 'visible', timeout: 10_000 });
	await src.waitFor({ state: 'visible', timeout: 10_000 });
	await centerCanvasCards(page, [docs, src]);
	if (await resetZoom.isEnabled()) {
		await resetZoom.click();
	}
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
	if (!await card.evaluate(element => element.classList.contains('selected'))) {
		throw new Error('Canvas result-node submenu did not select the new image node');
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
	await assertCardDetail(page, 'smoke-data.json');
	if (fs.existsSync(path.join(workspacePath, 'smoke-data.json.md'))) {
		throw new Error('Canvas New File appended .md to an explicitly named JSON file');
	}
	await page.locator('.basehalf-card-detail-close').click();
	await page.locator('.basehalf-canvas-card[data-basehalf-card-path="smoke-data.json"]').waitFor({ state: 'visible', timeout: 10_000 });

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
	if (!await folderCard.evaluate(element => element.classList.contains('selected'))) {
		throw new Error('Canvas New Folder did not select the new folder on its parent canvas');
	}

	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+N' : 'Control+N');
	await waitUntil(() => fs.existsSync(path.join(workspacePath, 'untitled.md')), 'global New Note to create an untitled Markdown file');
	const titleInput = page.locator('.basehalf-card-detail-title-input input');
	await titleInput.waitFor({ state: 'visible', timeout: 15_000 });
	if (await titleInput.inputValue() !== 'untitled.md') {
		throw new Error(`New Note did not focus the real filename, got ${JSON.stringify(await titleInput.inputValue())}`);
	}
	// Renaming is a structural edit and must flush the newly opened rich
	// working copy first. Wait for that working copy to finish attaching.
	await activeMarkdownRichFrame(page);
	await titleInput.fill('smoke-note.md');
	await titleInput.press('Enter');
	await waitUntil(() => fs.existsSync(path.join(workspacePath, 'smoke-note.md')) && !fs.existsSync(path.join(workspacePath, 'untitled.md')), 'new-note title rename to move the real file');
	await assertCardDetail(page, 'smoke-note.md');
	await page.locator('.basehalf-card-detail-surface.active .basehalf-card-detail-markdown-rich').waitFor({ state: 'visible', timeout: 15_000 });
	await page.locator('.basehalf-card-detail-close').click();
	await page.locator('.basehalf-canvas-card[data-basehalf-card-path="smoke-note.md"]').waitFor({ state: 'visible', timeout: 10_000 });

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
	const action = page.getByRole('menuitem', { name: label, exact: true }).filter({ visible: true }).last();
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

		const startX = canvasBox.x + canvasBox.width / 2;
		const startY = canvasBox.y + canvasBox.height / 2;
		const maxDeltaX = Math.max(1, canvasBox.width / 2 - 12);
		const maxDeltaY = Math.max(1, canvasBox.height / 2 - 12);
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
	const dragPaint = await page.evaluate(() => {
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
		const node = card?.closest('.react-flow__node');
		if (!(card instanceof HTMLElement) || !(node instanceof HTMLElement) || !node.classList.contains('dragging')) {
			throw new Error('Missing actively dragged docs card before pointer-up paint check');
		}
		const style = getComputedStyle(card);
		return {
			backgroundColor: style.backgroundColor,
			borderColor: style.borderColor,
			boxShadow: style.boxShadow
		};
	});

	await page.mouse.up();
	await waitUntil(() => fs.readFileSync(canvasPath, 'utf8') !== canvasBefore, 'dragged docs geometry to persist after pointer-up');
	await page.waitForTimeout(350);
	const settledPaint = await page.evaluate(() => {
		const card = document.querySelector('.basehalf-canvas-card[data-basehalf-card-path="docs"]');
		if (!(card instanceof HTMLElement)) {
			throw new Error('Missing docs card after pointer-up paint check');
		}
		const style = getComputedStyle(card);
		return {
			backgroundColor: style.backgroundColor,
			borderColor: style.borderColor,
			boxShadow: style.boxShadow
		};
	});
	if (JSON.stringify(dragPaint) !== JSON.stringify(settledPaint)) {
		throw new Error(`Dragging changed card paint at pointer-up: ${JSON.stringify({ dragPaint, settledPaint })}`);
	}
	if (await page.locator('.basehalf-canvas-cards').getAttribute('data-smoke-loading-preview-observed') === 'true') {
		throw new Error('Dragging a card replaced hydrated content with the Loading preview placeholder');
	}
	if (await page.locator('.basehalf-canvas-cards').getAttribute('data-smoke-card-element-replaced') === 'true') {
		const paths = await page.locator('.basehalf-canvas-cards').getAttribute('data-smoke-replaced-card-paths');
		throw new Error(`Dragging a card rebuilt card DOM instead of reconciling layout in place: ${paths}`);
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
	const zoomOut = page.locator('.basehalf-canvas-zoom-button[aria-label="Zoom Out"]');
	for (let attempt = 0; attempt < 16; attempt++) {
		const zoom = await page.locator('.basehalf-canvas-workbench').getAttribute('data-zoom').then(Number);
		if (zoom <= 0.5) {
			break;
		}
		if (!await zoomOut.isEnabled()) {
			break;
		}
		await zoomOut.click();
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
	await quickOpen(page, AGENT_CREATED_CARD_PATH);
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
	const zoomOut = page.locator('.basehalf-canvas-zoom-button[aria-label="Zoom Out"]');
	for (let i = 0; i < 10; i++) {
		const zoom = await page.locator('.basehalf-canvas-workbench').evaluate(root => Number(root.getAttribute('data-zoom')) || 1);
		if (zoom <= 0.5 || !(await zoomOut.isEnabled())) {
			break;
		}
		await zoomOut.click();
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
		const readmeRect = readmeCard.getBoundingClientRect();
		const rootRect = root.getBoundingClientRect();
		const zoom = Number(root.getAttribute('data-zoom')) || 1;
		const targetDraftX = docsMatrix.m41 + 3;
		const startX = readmeRect.left + readmeRect.width / 2;
		const startY = readmeRect.top + readmeRect.height / 2;
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
		if (!(root instanceof HTMLElement) || !(detail instanceof HTMLElement) || !(viewport instanceof HTMLElement)) {
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
			bottomProbeIsCanvas: !!bottomProbe?.closest('.basehalf-canvas-card, .basehalf-canvas-surface')
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

async function activeMarkdownRichFrame(page) {
	const started = Date.now();
	let lastFrameUrls = [];
	while (Date.now() - started < 20_000) {
		const frames = page.frames();
		lastFrameUrls = frames.map(frame => frame.url()).filter(Boolean);
		for (const frame of frames) {
			const editorCount = await frame.locator('.basehalf-markdown-rich.ready .bn-editor').count().catch(() => 0);
			if (editorCount > 0) {
				return frame;
			}
		}
		await page.waitForTimeout(100);
	}

	throw new Error(`Markdown rich editor webview was not ready. Frames: ${lastFrameUrls.join(', ')}`);
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

	const page = app.windows()[0];
	if (!page) {
		return;
	}

	fs.mkdirSync(logsPath, { recursive: true });
	await page.screenshot({ path: path.join(logsPath, 'failure.png'), fullPage: true }).catch(() => undefined);
	const html = await page.locator('html').evaluate(element => element.outerHTML).catch(() => undefined);
	if (html) {
		fs.writeFileSync(path.join(logsPath, 'failure.html'), html, 'utf8');
	}
}
