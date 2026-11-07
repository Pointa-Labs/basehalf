/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// BaseHalf's part of every window: the services and contributions that BaseHalf
// adds to VS Code's workbench. VS Code's workbench.common.main.ts imports this file
// once, as it imports terminal.all.ts; a new contribution of BaseHalf's goes here,
// not into VS Code's file (docs/harness/code-organization.md).

//#region Services

import './navigation/common/basehalfCanvasNavigationService.js';
import './canvas/common/basehalfCanvasViewportState.js';
import './references/common/basehalfBadgeMirror.js';
import './references/common/basehalfReferenceIndex.js';

//#endregion

//#region Contributions

// Contributions of one phase start in the order they are registered here.
import './shell/browser/basehalfConfiguration.contribution.js';
import './generation/browser/basehalfVideoProviders.contribution.js';
import './sequence/browser/basehalfSequence.contribution.js';
import './changes/browser/basehalfChanges.contribution.js';
import './mediaEdit/browser/basehalfMediaEdit.contribution.js';
import './cardDetail/browser/basehalfCardDetailPagePinch.js';
import './shell/browser/basehalfReleaseNotes.contribution.js';
import './shell/browser/basehalfAbout.contribution.js';
import './shell/browser/basehalfHover.contribution.js';
import './shell/browser/basehalfWorkbenchProfile.contribution.js';
import './navigation/browser/basehalfNavigation.contribution.js';
import './canvas/basehalfCanvas.all.js';
import './upkeep/browser/basehalfMirrorCascade.contribution.js';
import './upkeep/browser/basehalfKeptVersions.contribution.js';
import './markdown/browser/basehalfNoteFileRetention.contribution.js';
import './markdown/browser/basehalfNoteFileRoutes.contribution.js';
import './markdown/browser/basehalfNoteFileGit.contribution.js';
import './markdown/browser/basehalfNoteFileCopies.contribution.js';
import './generation/browser/basehalfGenerationCardCopy.contribution.js';
import './generation/browser/basehalfGenerationMentionFollower.contribution.js';
import './references/browser/basehalfBadgeQuickAccess.contribution.js';
import './references/browser/basehalfReferences.contribution.js';
import './references/browser/basehalfReferenceMigration.contribution.js';
import './upkeep/browser/basehalfLegacyCleanup.contribution.js';
import './upkeep/browser/basehalfGitExclude.contribution.js';
import './agentArea/browser/basehalfAgentSkill.contribution.js';
import './agentArea/browser/basehalfAgentSelection.contribution.js';
import './agentArea/browser/basehalfAgentArea.contribution.js';
import './agentArea/browser/basehalfAgentAreaTerminal.contribution.js';
import './generation/browser/basehalfNodeCommandBridge.contribution.js';

//#endregion
