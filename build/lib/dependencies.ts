/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';
import cp from 'child_process';
const root = fs.realpathSync(path.dirname(path.dirname(import.meta.dirname)));

function getNpmProductionDependencies(folder: string): string[] {
	let raw: string;

	try {
		raw = cp.execSync('npm ls --all --omit=dev --parseable', { cwd: folder, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production' }, stdio: [null, null, null] });
	} catch (err) {
		const regex = /^npm ERR! .*$/gm;
		let match: RegExpExecArray | null;

		while (match = regex.exec(err.message)) {
			if (/ELSPROBLEMS/.test(match[0])) {
				continue;
			} else if (/invalid: xterm/.test(match[0])) {
				continue;
			} else if (/A complete log of this run/.test(match[0])) {
				continue;
			} else {
				throw err;
			}
		}

		raw = err.stdout;
	}

	// BaseHalf: `npm ls` also lists what only happens to lie in node_modules, and what that
	// depends on, so that what ships would depend on the machine. Only what the lockfile has
	// outside of its dev packages ships (D122).
	const lockPath = path.join(folder, 'package-lock.json');
	const lock: { [packagePath: string]: { dev?: boolean } } | undefined = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, 'utf8')).packages : undefined;
	const realFolder = fs.realpathSync(folder);

	return raw.split(/\r?\n/).filter(line => {
		if (!line.trim() || path.relative(root, line) === path.relative(root, folder)) {
			return false;
		}
		const entry = lock?.[path.relative(realFolder, line).split(path.sep).join('/')];
		return !lock || (!!entry && !entry.dev);
	});
}

export function getProductionDependencies(folderPath: string): string[] {
	const result = getNpmProductionDependencies(folderPath);
	// Account for distro npm dependencies
	const realFolderPath = fs.realpathSync(folderPath);
	const relativeFolderPath = path.relative(root, realFolderPath);
	const distroFolderPath = `${root}/.build/distro/npm/${relativeFolderPath}`;

	if (fs.existsSync(distroFolderPath)) {
		result.push(...getNpmProductionDependencies(distroFolderPath));
	}

	return [...new Set(result)];
}

if (import.meta.main) {
	console.log(JSON.stringify(getProductionDependencies(root), null, '  '));
}
