/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// The notice that git leaves out the files put into notes (files in notes, rule 46; criterion 15).

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { workspacePath } from '../../context.mts';
import { hideNotificationsCenter, showNotificationsCenter } from '../../lib/notifications.mts';
import { waitUntil } from '../../lib/steps.mts';

const MESSAGE = 'Git leaves out the files put into notes here';
const USERS_OWN = 'node_modules/\n';
const EARLY_LINES = '# BaseHalf derived cache\n.bh/\n';

/**
 * A repository of its own inside the workspace folder, whose `.gitignore`
 * holds the two lines early versions wrote among the user's own: the first
 * files in its store show one notice, without a path, with Remove, Show, and
 * Keep; Remove, once confirmed, deletes exactly those two lines, and a file
 * put into the store after it shows no notice again.
 */
export async function assertNoteFilesGitNotice(page) {
	const folder = path.join(workspacePath, 'git-notice');
	const repository = path.join(folder, 'repository');
	const ignoreFile = path.join(repository, '.gitignore');
	fs.mkdirSync(repository, { recursive: true });
	execFileSync('git', ['init', '-q'], { cwd: repository, stdio: 'ignore' });
	fs.writeFileSync(ignoreFile, `${USERS_OWN}${EARLY_LINES}*.log\n`, 'utf8');
	const put = (name) => {
		const stored = path.join(repository, '.bh', 'attachments', 'aaaaaaaaaa', name);
		fs.mkdirSync(path.dirname(stored), { recursive: true });
		fs.writeFileSync(stored, name);
	};
	try {
		// Two files at once, as two pictures put into a note together.
		put('one.png');
		put('two.png');
		const center = await showNotificationsCenter(page);
		const notice = center.locator('.notification-list-item', { hasText: MESSAGE });
		await notice.first().waitFor({ state: 'visible', timeout: 15_000 });
		// The other files of the store come in the same window: still one notice.
		await new Promise(resolve => setTimeout(resolve, 1_000));
		const shown = {
			count: await notice.count(),
			message: await notice.first().locator('.notification-list-item-message').innerText(),
			actions: await notice.first().locator('.notification-list-item-buttons-container .monaco-button').allInnerTexts(),
		};
		if (shown.count !== 1 || shown.actions.join(',') !== 'Remove,Show,Keep' || /\/|git-notice|repository/.test(shown.message)) {
			throw new Error(`The notice of the early lines should come once, name no path, and offer Remove, Show, and Keep: ${JSON.stringify(shown)}`);
		}
		await notice.first().locator('.notification-list-item-buttons-container .monaco-button', { hasText: 'Remove' }).click();
		await hideNotificationsCenter(page);
		const confirmation = page.locator('.monaco-dialog-box', { hasText: 'Remove the two lines from .gitignore?' }).first();
		await confirmation.waitFor({ state: 'visible', timeout: 10_000 });
		await confirmation.locator('.monaco-button', { hasText: /^Remove$/ }).click();
		await confirmation.waitFor({ state: 'hidden', timeout: 10_000 });
		await waitUntil(() => fs.readFileSync(ignoreFile, 'utf8') === `${USERS_OWN}*.log\n`, 'Remove to delete exactly the two early lines from .gitignore');

		// Git keeps the store now: a file put into it after Remove says nothing.
		put('three.png');
		await new Promise(resolve => setTimeout(resolve, 1_500));
		const again = await showNotificationsCenter(page);
		const left = await again.locator('.notification-list-item', { hasText: MESSAGE }).count();
		await hideNotificationsCenter(page);
		if (left !== 0) {
			throw new Error(`The notice came again after Remove: ${left}`);
		}
	} finally {
		fs.rmSync(folder, { recursive: true, force: true });
	}
}
