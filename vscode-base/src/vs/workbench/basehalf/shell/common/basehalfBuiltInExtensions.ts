/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * The built-in extensions BaseHalf runs, which are also the ones that ship (D122): the
 * allowlist reads this file to decide what runs, and the build and the layout check read it
 * to decide what ships. They load the file as it is, so it imports nothing and holds only
 * syntax that stripping types removes.
 */

export const BASEHALF_THEME_EXTENSION_IDS: readonly string[] = ['vscode.theme-defaults'];

/**
 * VS Code's extensions that hold only a language and its grammar, with no code
 * to run (D118). Markdown's and the prompt language's are left out, so that a
 * note has no colors.
 */
export const BASEHALF_LANGUAGE_EXTENSION_IDS: readonly string[] = [
	'bat', 'clojure', 'coffeescript', 'cpp', 'csharp', 'css', 'dart', 'diff', 'docker', 'dotenv', 'fsharp', 'go', 'groovy', 'handlebars', 'hlsl', 'html',
	'ini', 'java', 'javascript', 'json', 'julia', 'latex', 'less', 'log', 'lua', 'make', 'objective-c', 'perl', 'php', 'powershell', 'pug', 'python',
	'r', 'razor', 'restructuredtext', 'ruby', 'rust', 'scss', 'shaderlab', 'shellscript', 'sql', 'swift', 'typescript', 'vb', 'xml', 'yaml'
].map(name => `vscode.${name}`);

export const BASEHALF_GIT_EXTENSION_IDS: readonly string[] = ['vscode.git', 'vscode.git-base', 'vscode.merge-conflict'];

/**
 * What shows a picture, a video, or a sound in VS Code's editor, where Git opens what Card
 * Detail does not: a deleted file, or a file of a commit in Graph.
 */
export const BASEHALF_MEDIA_PREVIEW_EXTENSION_IDS: readonly string[] = ['vscode.media-preview'];

export const BASEHALF_GITHUB_EXTENSION_IDS: readonly string[] = ['vscode.github'];

export const BASEHALF_GITHUB_AUTHENTICATION_EXTENSION_IDS: readonly string[] = ['vscode.github-authentication'];

/**
 * BaseHalf's own folder of bundles and fonts, for its editors and readers. It ships, and it
 * runs no code as an extension.
 */
export const BASEHALF_ASSETS_EXTENSION_ID = 'pointa.basehalf';

/**
 * Every built-in extension that ships, in lower case. Nothing else in `extensions/` is
 * built for the package.
 */
export const BASEHALF_PACKAGED_EXTENSION_IDS: ReadonlySet<string> = new Set([
	...BASEHALF_THEME_EXTENSION_IDS,
	...BASEHALF_LANGUAGE_EXTENSION_IDS,
	...BASEHALF_GIT_EXTENSION_IDS,
	...BASEHALF_MEDIA_PREVIEW_EXTENSION_IDS,
	...BASEHALF_GITHUB_EXTENSION_IDS,
	...BASEHALF_GITHUB_AUTHENTICATION_EXTENSION_IDS,
	BASEHALF_ASSETS_EXTENSION_ID
].map(id => id.toLowerCase()));

export function isBaseHalfPackagedExtension(publisher: string, name: string): boolean {
	return BASEHALF_PACKAGED_EXTENSION_IDS.has(`${publisher}.${name}`.toLowerCase());
}
