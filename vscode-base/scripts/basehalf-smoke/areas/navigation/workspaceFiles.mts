/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// What happens to the files of the workspace: a legacy pair migrated, and a rename in the Explorer that the mirror follows.

import fs from 'fs';
import path from 'path';
import process from 'process';
import { workspacePath } from '../../context.mts';
import { FAR_FIXTURE_CONTENT } from '../../fixture.mts';
import { assertCanvasEdgeGone, assertCanvasEdgeVisible } from '../../lib/canvas.mts';
import { closeCardDetailIfOpen } from '../../lib/cardDetail.mts';
import { clickNotificationAction, expectNotification } from '../../lib/notifications.mts';
import { runCommand } from '../../lib/quickInput.mts';
import { waitUntil } from '../../lib/steps.mts';
import { readWorkspaceFile } from '../../lib/workspace.mts';

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

// A legacy badge pair draws no edge until the user moves it. The migration
// prompt appears once the seeded badges are detected; Move Connections writes
// the downstream note's `upstream` frontmatter, records the pair in
// .bh/legacy-references.yaml, and keeps the legacy keys until a later session.
export async function assertMigrationMovesSeededLegacyPair(page) {
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
export async function assertExplorerRenameCascadesMirror(page) {
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
