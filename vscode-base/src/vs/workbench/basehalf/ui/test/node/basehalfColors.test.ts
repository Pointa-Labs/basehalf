/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { readdirSync, readFileSync } from 'fs';
import { join, sep } from '../../../../../base/common/path.js';
import { FileAccess } from '../../../../../base/common/network.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

/**
 * The sources that may write a literal color, each with why (light and dark, rule 3). Every other color is a
 * variable of the theme: one of the base's, or one BaseHalf registers in `ui/common/basehalfColors.ts`.
 */
const MAY_WRITE_A_COLOR: Readonly<Record<string, string>> = {
	'src/vs/workbench/basehalf/ui/common/basehalfColors.ts': 'the one place the colors of BaseHalf are written',
	'src/vs/workbench/basehalf/markdown/common/basehalfNotePalette.ts': 'the values a note stores for its colors: a format of the file, read and written as it is',
	'src/vs/workbench/basehalf/agentArea/common/basehalfAgentSkill.ts': 'the same stored values, as the skill tells them to an agent',
	'src/vs/workbench/basehalf/generation/browser/basehalfGenerationInputReading.ts': 'the white a picture is flattened on before it goes to a provider: a part of the picture sent, not of a look'
};

/** A color written as a value: `#rgb` to `#rrggbbaa`, a color function, and in a stylesheet the names of white and black. */
const literalColor = /(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/;
const namedColor = /(?:^|[\s:,(])(?:white|black)(?=[\s;,)!]|$)/;

/** A line of a source without what is no color of a look: a comment, the black of a mask, a stored value in a selector. */
function withoutWhatIsNoColor(line: string, stylesheet: boolean): string {
	let text = line.replace(/\/\*.*?\*\//g, '');
	if (stylesheet) {
		// A mask draws nothing: its black says where what lies under it shows.
		if (/^\s*(?:-webkit-)?mask(?:-image)?\s*:/.test(text)) {
			return '';
		}
		// A selector that finds a stored color of a note names the value the file holds.
		text = text.replace(/\[style\*="[^"]*"(?: i)?\]/g, '');
	} else {
		text = text.replace(/(^|[^:'"`])\/\/.*$/, '$1');
	}
	return text;
}

suite('BaseHalf: a color is a color of the theme', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const repository = join(FileAccess.asFileUri('').fsPath, '..');
	const roots = [
		join('src', 'vs', 'workbench', 'basehalf'),
		...readdirSync(join(repository, 'src', 'vs', 'platform'), { encoding: 'utf8' }).filter(name => name.startsWith('basehalf')).map(name => join('src', 'vs', 'platform', name)),
		...readdirSync(join(repository, 'extensions', 'basehalf'), { encoding: 'utf8' }).filter(name => name.endsWith('-src')).map(name => join('extensions', 'basehalf', name))
	];

	/** Every source of BaseHalf's that a window or a page runs, by its path in the repository. */
	function* sources(): Iterable<{ readonly path: string; readonly text: string }> {
		for (const root of roots) {
			for (const entry of readdirSync(join(repository, root), { recursive: true, encoding: 'utf8' })) {
				const path = join(root, entry).split(sep).join('/');
				if (!/\.(ts|tsx|css|html)$/.test(path) || /(^|\/)test\//.test(path) || /(^|\/)node_modules\//.test(path)) {
					continue;
				}
				yield { path, text: readFileSync(join(repository, root, entry), 'utf8') };
			}
		}
	}

	test('no source of BaseHalf writes a literal color outside the palette', () => {
		// A literal color has one value under every theme, so what it draws stays as it is when the theme changes:
		// that is how the canvas stayed black in a light window (D148). The sources are read, not the output.
		const writing: string[] = [];
		let read = 0;
		for (const { path, text } of sources()) {
			read++;
			if (MAY_WRITE_A_COLOR[path]) {
				continue;
			}
			const stylesheet = path.endsWith('.css');
			let inComment = false;
			text.split('\n').forEach((raw, index) => {
				let line = raw;
				if (inComment) {
					const end = line.indexOf('*/');
					if (end === -1) {
						return;
					}
					inComment = false;
					line = line.slice(end + 2);
				}
				line = withoutWhatIsNoColor(line, stylesheet);
				const start = line.indexOf('/*');
				if (start !== -1) {
					inComment = true;
					line = line.slice(0, start);
				}
				if (literalColor.test(line) || (stylesheet && namedColor.test(line))) {
					writing.push(`${path}:${index + 1}: ${raw.trim().slice(0, 120)}`);
				}
			});
		}
		assert.deepStrictEqual({ read: read > 500, writing }, { read: true, writing: [] });
	});

	test('nothing of BaseHalf asks the system whether it is light or dark', () => {
		// The theme is the answer, and the base asks the system for it when `window.autoDetectColorScheme` says
		// so. The window styles under the class of the theme's kind on the workbench's root, a page under the
		// class the workbench keeps on its body (light and dark, rule 2).
		const asking: string[] = [];
		for (const { path, text } of sources()) {
			if (text.includes('prefers-color-scheme')) {
				asking.push(path);
			}
		}
		assert.deepStrictEqual(asking, []);
	});
});
