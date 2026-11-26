/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

// Cards that follow files renamed from outside the window.

import fs from 'fs';
import path from 'path';
import { readCanvasCardNumber } from './creation.mts';
import { workspacePath } from '../../context.mts';
import { assertCanvasFolder, openRootCanvas } from '../../lib/canvas.mts';
import { waitUntil } from '../../lib/steps.mts';

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
export async function assertCanvasCardFollowsOutsideRename(page) {
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
export async function assertCanvasFollowsRenamedOpenFolder(page) {
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
export async function assertCanvasCardsFollowManyOutsideRenames(page) {
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
