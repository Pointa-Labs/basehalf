/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { assertConflictHasItsActions, assertPicturesInTheEditor, assertChangedCardsAreMarked, assertChangedFileOpensAsUsual, assertCodeCardAsTheEditor, assertCommitBoxTakesSpaces, assertLastChangeGoes, assertMultiFileDiff, assertStagedBinaryOpens, assertViewsOfASoundTakeTurns, assertRowOpensTheChangesView, assertRowsOfOtherKinds, assertWhatOpenedLastIsInFront, finishChangedFiles, prepareChangedFiles } from './areas/workbench/changes.mts';
import { AGENT_CREATED_CARD_PATH, assertAgentCreatesCard, assertAgentSeesSelection, assertAgentUpstreamEditDrawsEdge } from './areas/canvas/agents.mts';
import { assertBadgeEditorUpstreamDownstream, assertCanvasCardBadgePreviewAndConnectors, assertCanvasUnreadableBadgeRecovers } from './areas/canvas/badges.mts';
import { assertCanvasConnectIntoNote, assertCanvasConnectionHandleCapture, assertCanvasCreateFromConnection, assertCanvasPulledLineIsTheConnection, assertCanvasUndoAfterClosingNote } from './areas/canvas/connections.mts';
import { assertCanvasCopyPasteKeys } from './areas/canvas/clipboard.mts';
import {
	assertCanvasConnectedFilesAppearBeside,
	assertCanvasCreateMenuMakesDrafts,
	assertCanvasCreateNote,
	assertCanvasDoubleClickCreateMenu,
	assertCanvasNewFilesGoToTheEnd,
	assertCanvasNewFolder,
	assertCanvasNumericFolderNames
} from './areas/canvas/creation.mts';
import { assertDocumentCardsShowCovers, assertDocumentCoverHidesAndShows } from './areas/canvas/documents.mts';
import { assertCanvasDropIntoFolder } from './areas/canvas/dropIntoFolder.mts';
import { assertCanvasExactUndo, assertFilesFollowCanvasDeletes } from './areas/canvas/exactUndo.mts';
import { assertCanvasEdgeFollowsCardDragLive, assertCanvasEdgeHalfReconnect, assertCanvasEdgeLetGoOnEmptyCanvas, assertEdgeDeleteRemovesReference, assertEdgeDeleteScopedToCanvas } from './areas/canvas/edges.mts';
import { assertCanvasCardFollowsOutsideRename, assertCanvasCardsFollowManyOutsideRenames, assertCanvasFollowsRenamedOpenFolder } from './areas/canvas/followRenames.mts';
import { assertCanvasInlineRename } from './areas/canvas/names.mts';
import { assertCanvasNoteInlineWysiwygEditor } from './areas/canvas/noteEditor.mts';
import { assertCanvasNoteResizeWhileEditing } from './areas/canvas/noteResize.mts';
import { assertCanvasNoteTitleNamesFile } from './areas/canvas/noteTitle.mts';
import { assertCanvasNoteUndoAsksNothing } from './areas/canvas/noteUndo.mts';
import { assertCanvasNoteLinksOpenTheirTargets, assertCanvasNoteMediaPlaysOnWhenDrawnAgain, assertCanvasNoteMediaReactAtRest, assertCanvasNotePaletteInBothAppearances, assertCanvasNotePictureEditsOnTheCard, assertCanvasNoteRendersMarkdown, assertCanvasNoteWheelScroll, assertNoteThatCannotHoldAListKeepsItWithBaseHalf } from './areas/canvas/notes.mts';
import { assertCanvasMarqueeSelectsConnections, assertCanvasSelectionAndArrangement } from './areas/canvas/selection.mts';
import { assertCanvasSnapGuides, assertCanvasZoomControls } from './areas/canvas/zoomAndSnap.mts';
import {
	assertBadgeClosesOnRichEditorActivation,
	assertBadgeQuickAccessFindsNote,
	assertBaseHalfTitlebarBreadcrumbs,
	assertCardDetailBadgeZone,
	assertCardDetailCompactHeader,
	assertCardDetailCoversCanvasViewport,
	assertCardDetailHoldsNoLayoutControl,
	assertCardDetailRenameIsCanvasUndo,
	assertMediaCardDetail,
	assertPdfCardDetail,
	assertPdfGrowsThreeBranches,
	assertSourceCardFlushesBeforeNavigation,
	assertSourceCardSaveActionHidden,
	scrollCanvasWorkbenchForCardDetail
} from './areas/cardDetail/cardDetail.mts';
import { assertNoteBlockMenuChoiceIsOneUndo, assertNoteBlockMenuEscapeClosesEveryList, assertNoteBlockMenuFiles, assertNoteBlockMenuLooks, assertNoteBlockMenuPlacement } from './areas/cardDetail/noteBlockMenu.mts';
import { assertNoteFormatsCopyCarriesMarkdown, assertNoteFormatsCopyIntoSource, assertNoteFormatsSelectAllTakesEveryBlock, assertNoteFormatsInlineFormatsStored, assertNoteFormatsInputMethod, assertNoteFormatsMenuPaste, assertNoteFormatsOutlineFollowsToggles, assertNoteFormatsPaletteInBothAppearances, assertNoteFormatsPasteFromAPage, assertNoteFormatsKeepTypedLetters, assertNoteFormatsKeysStayInRich, assertNoteFormatsLinksOpenTheirTargets, assertNoteFormatsMediaFromTheMenu, assertNoteFormatsOfferOnlyWhatTheFileKeeps, assertNoteFormatsToggleStored, openNoteFormatsNote } from './areas/cardDetail/noteFormats.mts';
import { assertNoteFormatsMediaAsksForNoRefusedAddress, assertPreviewNoteMediaPlaysOnWhenDrawnAgain } from './areas/cardDetail/noteMediaDrawnAgain.mts';
import { assertBookCardDetail, assertBookGrowsBranch, assertBookTurnsPages } from './areas/cardDetail/books.mts';
import { assertCardDetailEditShowsOnItsCard } from './areas/cardDetail/editOnCard.mts';
import { assertCardDetailImageCropBack } from './areas/cardDetail/imageCropBack.mts';
import { assertNoteFilesGitNotice } from './areas/cardDetail/noteFilesGit.mts';
import { assertCardDetailImageEdit } from './areas/cardDetail/imageEdit.mts';
import { assertCardDetailMediaPinch } from './areas/cardDetail/mediaPinch.mts';
import { assertNotePictureEditInPlace, assertNotePictureEditTallInView } from './areas/cardDetail/notePictureEdit.mts';
import { assertNoteSoundEditInPlace, assertNoteVideoEditInPlace } from './areas/cardDetail/noteMediaEdit.mts';
import { assertCardDetailSoundEdit } from './areas/cardDetail/soundEdit.mts';
import { assertCardDetailVideoEdit } from './areas/cardDetail/videoEdit.mts';
import { assertCardDetailVideoEdgeFollow } from './areas/cardDetail/videoEdge.mts';
import {
	assertMarkdownRichBlockMenuPortal,
	assertMarkdownRichBlockquoteEditable,
	assertMarkdownRichCompositionDefersAutosave,
	assertMarkdownRichCompositionQueuesSingleUndo,
	assertMarkdownRichContextMenuClipboard,
	assertMarkdownRichEditorEditsAndSaves,
	assertMarkdownRichExternalMergePreservesCursor,
	assertMarkdownRichFileAttachment,
	assertMarkdownRichFileCopyHoldsTheFile,
	assertMarkdownRichFileLinkAutocomplete,
	assertMarkdownRichHandlesFollowZoom,
	assertMarkdownRichMenuUndoRoutesToEditor,
	assertMarkdownRichPassthroughEditInSource,
	assertMarkdownRichReadingModeDisabled,
	assertMarkdownRichReadingModeEnabledFromWorkspaceSettings,
	assertMarkdownRichSaveStatusHidden,
	assertMarkdownRichSlashMenuThemedPortal,
	assertMarkdownRichUndoRedoRoundtrip,
	assertMarkdownRichUndoStopsAtLoad
} from './areas/cardDetail/richEditor.mts';
import { assertCanvasBreadcrumbsRemoved, assertCanvasContainsCard, assertMarkdownRichRevealsText } from './areas/navigation/navigation.mts';
import { assertExplorerRenameCascadesMirror, assertExplorerShowsBhFolderBySetting, assertMigrationMovesSeededLegacyPair } from './areas/navigation/workspaceFiles.mts';
import { runAudioCardSteps } from './areas/video/audioCards.mts';
import { assertLandingLeftNoPartialFile, runGenerationCardSteps } from './areas/video/generationCards.mts';
import { assertProviderRequestsFromSharedProcess } from './areas/video/providerService.mts';
import { assertNoPluginSurface, assertSequenceAddsGeneratedVideo, assertVideoWorkflowTemplate } from './areas/video/workflowTemplate.mts';
import {
	assertAgentAreaChoices,
	assertAgentAreaTabStripMovesWithTheWheel,
	assertAgentAreaTabsAndSplits,
	assertAgentAreaTerminalCommand,
	assertAgentAreaTuiSession,
	assertGlobalAuxiliaryToggleOpensAgentArea,
	assertTogglePanelRemapsToAgentArea
} from './areas/workbench/agentArea.mts';
import { assertCompetingViewContainersHidden, assertHiddenSurfaceCommandsStayHidden, assertOpenEditorsHidden, assertStatusBarCurated } from './areas/workbench/hiddenSurfaces.mts';
import { assertBaseHalfAboutPage, assertBaseHalfSettingsCategory, assertProvidersPage } from './areas/workbench/settings.mts';
import { assertGitBranchCheckoutQuickPick, assertSourceControlChangesAsTree, assertSourceControlLeavesOutSystemFiles, assertSourceControlPanel, assertSourceControlPublishBranchAction } from './areas/workbench/sourceControl.mts';
import {
	assertBaseHalfRootTitlebarBreadcrumb,
	assertCanvasGridScopedToCanvas,
	assertFirstCanvasRenderSavesPlacesOutOfGit,
	assertFreshCanvasFramed,
	assertLayoutControlAtTheLeftEnd,
	assertNewWindowBaseHalfWelcome,
	assertProductThemeAndCards,
	assertTitleBarLocationOpensSearch
} from './areas/workbench/startup.mts';
import { app, workspacePath } from './context.mts';
import { assertCardComesToAChangeInView, assertCardKeepsItsPlace, assertCardStandsAtWhatWasRead, assertViewsOfANoteGoOn, assertCodeCardFace, assertCodeCardWheel, assertEditingOnTheCard, assertExpandAndCommit, assertLargeFileKeepsItsHead, assertSourceIsTheEditor, prepareCodeCards } from './areas/workbench/codeCards.mts';
import { commitFixtureChanges } from './fixture.mts';
import { assertCanvasEdgeVisible, assertCanvasFolder } from './lib/canvas.mts';
import { assertCardDetail, assertNativeBackOpensPreviousCanvas, assertNativeForwardOpensCardDetail, assertNoEditorTabFor } from './lib/cardDetail.mts';
import { quickOpen, runCommand } from './lib/quickInput.mts';
import { step } from './lib/steps.mts';
import { assertWorkspaceOpenInstallsNothing, openExplorerRow } from './lib/workspace.mts';

/**
 * What each suite of the smoke does, by name: its steps, in order (README.md in
 * this folder). suiteList.mts gives the order of the suites and says what each
 * covers. Each suite runs in a process of its own, on a BaseHalf of its own with
 * a fresh fixture workspace, and needs nothing from another suite.
 */
export const SUITES = {
	workbench: runWorkbenchSuite,
	canvas: runCanvasSuite,
	cardDetail: runCardDetailSuite,
	navigation: runNavigationSuite,
	video: runVideoSuite
};

/**
 * What a suite on the canvas does first, as each slice of the old script did:
 * the canvas of the fresh workspace framed and its places saved, the window as
 * it opens, and the pointer resting off the controls.
 */
async function startOnFreshCanvas(page) {
	await step('fresh-canvas-framed', () => assertFreshCanvasFramed(page));
	await step('first-canvas-render-saves-places-out-of-git', () => assertFirstCanvasRenderSavesPlacesOutOfGit(page));
	await step('root-titlebar-breadcrumb', () => assertBaseHalfRootTitlebarBreadcrumb(page));
	await step('canvas-grid-scoped-to-canvas', () => assertCanvasGridScopedToCanvas(page));
	await step('product-theme-and-cards', () => assertProductThemeAndCards(page));
	await step('layout-control-at-the-left-end', () => assertLayoutControlAtTheLeftEnd(page));
}

/** The window at startup, the surfaces BaseHalf hides, the Agent Area, Source Control, and Settings. */
async function runWorkbenchSuite(page) {
	await step('new-window-basehalf-welcome', () => assertNewWindowBaseHalfWelcome(app, page));
	await startOnFreshCanvas(page);
	await step('title-bar-location-opens-search', () => assertTitleBarLocationOpensSearch(page));
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
	await step('agent-area-tab-strip-moves-with-the-wheel', () => assertAgentAreaTabStripMovesWithTheWheel(page));
	await step('source-control-git-provider', () => assertSourceControlPanel(page));
	await step('source-control-changes-as-tree', () => assertSourceControlChangesAsTree(page));
	await step('source-control-leaves-out-system-files', () => assertSourceControlLeavesOutSystemFiles(page));
	commitFixtureChanges(workspacePath, 'smoke changes');
	await step('git-refresh', () => runCommand(page, 'Git: Refresh'));
	await step('changes-prepare', () => prepareChangedFiles(page));
	await step('changes-code-card-as-the-editor', () => assertCodeCardAsTheEditor(page));
	await step('changes-marks-on-cards', () => assertChangedCardsAreMarked(page));
	await step('changes-opens-as-usual', () => assertChangedFileOpensAsUsual(page));
	await step('changes-row-opens-the-view', () => assertRowOpensTheChangesView(page));
	await step('changes-last-change-goes', () => assertLastChangeGoes(page));
	await step('changes-rows-of-other-kinds', () => assertRowsOfOtherKinds(page));
	await step('changes-views-of-a-sound', () => assertViewsOfASoundTakeTurns(page));
	await step('changes-multi-file-diff', () => assertMultiFileDiff(page));
	await step('changes-staged-binary-opens', () => assertStagedBinaryOpens(page));
	await step('changes-what-opened-last-is-in-front', () => assertWhatOpenedLastIsInFront(page));
	await step('commit-box-takes-spaces', () => assertCommitBoxTakesSpaces(page));
	await step('changes-finish', () => finishChangedFiles(page));
	await step('git-conflict-has-its-actions', () => assertConflictHasItsActions(page));
	await step('git-pictures-in-the-editor', () => assertPicturesInTheEditor(page));
	await step('code-cards-prepare', () => prepareCodeCards(page));
	await step('code-card-face', () => assertCodeCardFace(page));
	await step('code-card-wheel', () => assertCodeCardWheel(page));
	await step('code-card-keeps-its-place', () => assertCardKeepsItsPlace(page));
	await step('source-is-the-editor', () => assertSourceIsTheEditor(page));
	await step('code-card-stands-at-what-was-read', () => assertCardStandsAtWhatWasRead(page));
	await step('code-card-comes-to-a-change-in-view', () => assertCardComesToAChangeInView(page));
	await step('code-card-views-of-a-note', () => assertViewsOfANoteGoOn(page));
	await step('code-card-editing', () => assertEditingOnTheCard(page));
	await step('code-card-expand-and-commit', () => assertExpandAndCommit(page));
	await step('code-card-large-file', () => assertLargeFileKeepsItsHead(page));
	await step('source-control-publish-branch-action', () => assertSourceControlPublishBranchAction(page));
	await step('git-branch-checkout-quickpick', () => assertGitBranchCheckoutQuickPick(page));
	await step('settings-basehalf-category', () => assertBaseHalfSettingsCategory(page));
	await step('providers-page', () => assertProvidersPage(page));
	await step('settings-about-page', () => assertBaseHalfAboutPage(page));
}

/** The canvas: creating, editing Notes, renaming, cards that follow renames, connections, badges, selection, zoom, snapping, and the covers of PDFs and books. */
async function runCanvasSuite(page) {
	await startOnFreshCanvas(page);
	await step('canvas-double-click-create-menu', () => assertCanvasDoubleClickCreateMenu(page));
	await step('canvas-create-menu-makes-drafts', () => assertCanvasCreateMenuMakesDrafts(page));
	await step('canvas-new-folder', () => assertCanvasNewFolder(page));
	await step('canvas-copy-paste-keys', () => assertCanvasCopyPasteKeys(page));
	await step('canvas-exact-undo', () => assertCanvasExactUndo(page));
	await step('canvas-files-follow-deletes', () => assertFilesFollowCanvasDeletes(page));
	await step('canvas-create-note', () => assertCanvasCreateNote(page));
	await step('canvas-note-title-names-file', () => assertCanvasNoteTitleNamesFile(page));
	await step('canvas-note-selection-controls', () => assertCanvasNoteInlineWysiwygEditor(page));
	await step('canvas-note-resize-while-editing', () => assertCanvasNoteResizeWhileEditing(page));
	await step('canvas-note-undo-asks-nothing', () => assertCanvasNoteUndoAsksNothing(page));
	await step('canvas-numeric-folder-names', () => assertCanvasNumericFolderNames(page));
	await step('canvas-inline-rename', () => assertCanvasInlineRename(page));
	await step('canvas-card-badge-preview-connectors', () => assertCanvasCardBadgePreviewAndConnectors(page));
	await step('canvas-unreadable-badge-recovers', () => assertCanvasUnreadableBadgeRecovers(page));
	await step('canvas-card-follows-outside-rename', () => assertCanvasCardFollowsOutsideRename(page));
	await step('canvas-follows-renamed-open-folder', () => assertCanvasFollowsRenamedOpenFolder(page));
	await step('canvas-cards-follow-many-outside-renames', () => assertCanvasCardsFollowManyOutsideRenames(page));
	await step('canvas-new-files-go-to-the-end', () => assertCanvasNewFilesGoToTheEnd(page));
	await step('canvas-connected-files-appear-beside', () => assertCanvasConnectedFilesAppearBeside(page));
	await step('canvas-note-wheel-scroll', () => assertCanvasNoteWheelScroll(page));
	await step('canvas-note-renders-markdown', () => assertCanvasNoteRendersMarkdown(page));
	await step('canvas-note-links-open-their-targets', () => assertCanvasNoteLinksOpenTheirTargets(page));
	await step('canvas-note-media-react-at-rest', () => assertCanvasNoteMediaReactAtRest(page));
	await step('canvas-note-media-plays-on-when-drawn-again', () => assertCanvasNoteMediaPlaysOnWhenDrawnAgain(page));
	await step('canvas-note-picture-edits-on-the-card', () => assertCanvasNotePictureEditsOnTheCard(page));
	await step('canvas-note-palette-in-both-appearances', () => assertCanvasNotePaletteInBothAppearances(page));
	await step('agent-creates-card', () => assertAgentCreatesCard(page));
	await step('canvas-connection-handle-capture', () => assertCanvasConnectionHandleCapture(page));
	await step('canvas-connect-into-note', () => assertCanvasConnectIntoNote(page));
	await step('canvas-derived-edge-visible', () => assertCanvasEdgeVisible(page, 'docs', AGENT_CREATED_CARD_PATH));
	await step('canvas-undo-after-closing-note', () => assertCanvasUndoAfterClosingNote(page));
	await step('canvas-edge-follows-card-drag-live', () => assertCanvasEdgeFollowsCardDragLive(page));
	await step('canvas-edge-half-reconnect', () => assertCanvasEdgeHalfReconnect(page));
	await step('canvas-edge-let-go-on-empty-canvas', () => assertCanvasEdgeLetGoOnEmptyCanvas(page));
	await step('agent-upstream-edit-draws-edge', () => assertAgentUpstreamEditDrawsEdge(page));
	await step('badge-editor-upstream-downstream', () => assertBadgeEditorUpstreamDownstream(page));
	await step('edge-delete-scoped-to-canvas', () => assertEdgeDeleteScopedToCanvas(page, AGENT_CREATED_CARD_PATH));
	await step('edge-delete-removes-reference', () => assertEdgeDeleteRemovesReference(page, AGENT_CREATED_CARD_PATH));
	await step('canvas-create-from-connection', () => assertCanvasCreateFromConnection(page));
	await step('canvas-pulled-line-is-the-connection', () => assertCanvasPulledLineIsTheConnection(page));
	await step('canvas-zoom-controls', () => assertCanvasZoomControls(page));
	await step('canvas-snap-guides', () => assertCanvasSnapGuides(page));
	await step('canvas-selection-and-arrangement', () => assertCanvasSelectionAndArrangement(page));
	await step('canvas-marquee-selects-connections', () => assertCanvasMarqueeSelectsConnections(page));
	await step('canvas-drop-into-folder', () => assertCanvasDropIntoFolder(page));
	await step('agent-sees-selection', () => assertAgentSeesSelection(page));
	await step('note-that-cannot-hold-a-list', () => assertNoteThatCannotHoldAListKeepsItWithBaseHalf(page));
	await step('canvas-document-cards-show-covers', () => assertDocumentCardsShowCovers(page));
	await step('canvas-document-cover-hides-and-shows', () => assertDocumentCoverHidesAndShows(page));
}

/** Card Detail and its projections: the rich Markdown editor, source, media, PDF, and books; the editors of a video, an image, and a sound; back and forward from it. */
async function runCardDetailSuite(page) {
	await startOnFreshCanvas(page);
	await step('canvas-scroll-before-card-detail', () => scrollCanvasWorkbenchForCardDetail(page));
	await step('quick-open-readme', () => quickOpen(page, 'README.md'));
	await step('readme-card-detail', () => assertCardDetail(page, 'README.md'));
	await step('readme-titlebar-breadcrumbs', () => assertBaseHalfTitlebarBreadcrumbs(page));
	await step('readme-card-detail-compact-header', () => assertCardDetailCompactHeader(page));
	await step('card-detail-holds-no-layout-control', () => assertCardDetailHoldsNoLayoutControl(page));
	await step('readme-card-detail-covers-scrolled-canvas', () => assertCardDetailCoversCanvasViewport(page));
	await step('readme-rich-save-status-hidden', () => assertMarkdownRichSaveStatusHidden(page));
	await step('readme-rich-blockquote-editable', () => assertMarkdownRichBlockquoteEditable(page));
	await step('readme-rich-passthrough-edit-in-source', () => assertMarkdownRichPassthroughEditInSource(page));
	await step('readme-rich-block-menu-portal', () => assertMarkdownRichBlockMenuPortal(page));
	await step('readme-rich-handles-follow-zoom', () => assertMarkdownRichHandlesFollowZoom(page));
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
	await step('readme-rich-file-copy-holds-the-file', () => assertMarkdownRichFileCopyHoldsTheFile(page));
	await step('note-files-git-notice', () => assertNoteFilesGitNotice(page));
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
	await step('quick-open-book', () => quickOpen(page, 'primer.epub'));
	await step('book-card-detail', () => assertBookCardDetail(page));
	await step('book-no-editor-tab', () => assertNoEditorTabFor(page, 'primer.epub'));
	await step('book-turns-pages', () => assertBookTurnsPages(page));
	await step('book-grows-branch', () => assertBookGrowsBranch(page));
	await step('readme-badge-closes-on-rich-editor-activation', () => assertBadgeClosesOnRichEditorActivation(page));
	await step('card-detail-rename-is-canvas-undo', () => assertCardDetailRenameIsCanvasUndo(page));
	await step('card-detail-video-edit', () => assertCardDetailVideoEdit(page));
	await step('card-detail-video-edge-follow', () => assertCardDetailVideoEdgeFollow(page));
	await step('card-detail-image-edit', () => assertCardDetailImageEdit(page));
	await step('card-detail-image-crop-back', () => assertCardDetailImageCropBack(page));
	await step('card-detail-edit-shows-on-its-card', () => assertCardDetailEditShowsOnItsCard(page));
	await step('card-detail-sound-edit', () => assertCardDetailSoundEdit(page));
	await step('card-detail-media-pinch', () => assertCardDetailMediaPinch(page));
	await step('note-picture-edit-in-place', () => assertNotePictureEditInPlace(page));
	await step('note-picture-edit-tall-in-view', () => assertNotePictureEditTallInView(page));
	await step('note-video-edit-in-place', () => assertNoteVideoEditInPlace(page));
	await step('note-sound-edit-in-place', () => assertNoteSoundEditInPlace(page));
	await step('note-formats-open', () => openNoteFormatsNote(page));
	await step('note-formats-offer-only-what-the-file-keeps', () => assertNoteFormatsOfferOnlyWhatTheFileKeeps(page));
	await step('note-formats-keys-stay-in-rich', () => assertNoteFormatsKeysStayInRich(page));
	await step('note-formats-keep-typed-letters', () => assertNoteFormatsKeepTypedLetters(page));
	await step('note-formats-links-open-their-targets', () => assertNoteFormatsLinksOpenTheirTargets(page));
	await step('note-formats-media-from-the-menu', () => assertNoteFormatsMediaFromTheMenu(page));
	await step('note-formats-inline-formats-stored', () => assertNoteFormatsInlineFormatsStored(page));
	await step('note-formats-toggle-stored', () => assertNoteFormatsToggleStored(page));
	await step('note-block-menu-looks', () => assertNoteBlockMenuLooks(page));
	await step('note-block-menu-choice-is-one-undo', () => assertNoteBlockMenuChoiceIsOneUndo(page));
	await step('note-block-menu-files', () => assertNoteBlockMenuFiles(page));
	await step('note-block-menu-placement', () => assertNoteBlockMenuPlacement(page));
	await step('note-block-menu-escape-closes-every-list', () => assertNoteBlockMenuEscapeClosesEveryList(page));
	await step('note-formats-input-method', () => assertNoteFormatsInputMethod(page));
	await step('note-formats-outline-follows-toggles', () => assertNoteFormatsOutlineFollowsToggles(page));
	await step('note-formats-palette-in-both-appearances', () => assertNoteFormatsPaletteInBothAppearances(page));
	await step('note-formats-copy-carries-markdown', () => assertNoteFormatsCopyCarriesMarkdown(page));
	await step('note-formats-select-all-takes-every-block', () => assertNoteFormatsSelectAllTakesEveryBlock(page));
	await step('note-formats-paste-from-a-page', () => assertNoteFormatsPasteFromAPage(page));
	await step('note-formats-copy-into-source', () => assertNoteFormatsCopyIntoSource(page));
	await step('note-formats-menu-paste', () => assertNoteFormatsMenuPaste(page));
	await step('preview-note-media-plays-on-when-drawn-again', () => assertPreviewNoteMediaPlaysOnWhenDrawnAgain(page));
	await step('note-formats-media-asks-for-no-refused-address', () => assertNoteFormatsMediaAsksForNoRefusedAddress(page));
}

/** Quick Text Search, the Explorer, back and forward between folders and cards, and what happens to the files of the workspace. */
async function runNavigationSuite(page) {
	await startOnFreshCanvas(page);
	await step('quick-text-search-readme-routing', () => quickOpen(page, '%needle-basehalf-routing'));
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
	await step('explorer-shows-bh-by-setting', () => assertExplorerShowsBhFolderBySetting(page));
	await step('nothing-installed-after-session', () => assertWorkspaceOpenInstallsNothing());
}

/** Generation cards of images, videos, and sounds: drafts, the panel, the voice menu, generations against the local test provider, Providers, the starter template, and Sequence. */
async function runVideoSuite(page) {
	await step('no-plugin-surface', () => assertNoPluginSurface(page));
	await step('video-workflow-template', () => assertVideoWorkflowTemplate(page));
	await runGenerationCardSteps(page);
	await step('video-sequence-adds-generated-video', () => assertSequenceAddsGeneratedVideo(page));
	await runAudioCardSteps(page);
	await step('video-landing-leaves-no-partial-file', () => assertLandingLeftNoPartialFile());
	await step('video-requests-from-provider-service', () => assertProviderRequestsFromSharedProcess());
}
