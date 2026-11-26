/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflowDirectory = path.join(repositoryRoot, '.github', 'workflows');
const workflowFiles = fs.readdirSync(workflowDirectory)
	.filter(file => /\.ya?ml$/i.test(file))
	.sort();

let actionCount = 0;
for (const file of workflowFiles) {
	const lines = fs.readFileSync(path.join(workflowDirectory, file), 'utf8').split(/\r?\n/);
	for (let index = 0; index < lines.length; index++) {
		const match = /^\s*(?:-\s*)?uses:\s*([^\s#]+)\s*(?:#\s*(\S.*))?$/.exec(lines[index] ?? '');
		if (!match) {
			continue;
		}
		actionCount++;
		const action = match[1] ?? '';
		const versionComment = match[2] ?? '';
		assert.match(action, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/, `${file}:${index + 1} must pin the action to a full commit SHA.`);
		assert.match(versionComment, /^v[0-9]+(?:\.[0-9]+){0,2}$/, `${file}:${index + 1} must retain the reviewed action version in a comment.`);
	}
}

assert.ok(actionCount > 0, 'No workflow actions were found.');
console.log(`Verified ${actionCount} workflow action pins.`);
