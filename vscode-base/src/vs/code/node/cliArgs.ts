/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NativeParsedArgs } from '../../platform/environment/common/argv.js';

const BASEHALF_EXTENSION_MUTATION_ERROR = 'BaseHalf installs and updates code plugins only through its reviewed Plugins library.';

type ExtensionMutationArgs = Partial<NativeParsedArgs>;

/**
 * Returns the user-facing error for command-line extension mutations that must
 * go through BaseHalf's reviewed Plugins library.
 */
export function getBaseHalfExtensionMutationError(args: ExtensionMutationArgs, isBaseHalf: boolean): string | undefined {
	if (!isBaseHalf) {
		return undefined;
	}

	if (args['install-extension']?.length || args['install-builtin-extension']?.length || args['update-extensions']) {
		return BASEHALF_EXTENSION_MUTATION_ERROR;
	}

	return undefined;
}

/**
 * Rewrites `--folder-uri <uri>` / `--file-uri <uri>` pairs into a single
 * `--flag=value` token so the URI is not a standalone argv entry. Used on
 * Windows to avoid Chromium filtering URL-like tokens before main.js runs.
 * See https://github.com/microsoft/vscode/issues/209072.
 */
export function combineUriFlags(args: string[]): string[] {
	const result: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === '--') { // end-of-options marker: copy the rest verbatim
			result.push(...args.slice(i));
			break;
		}
		if ((arg === '--folder-uri' || arg === '--file-uri') && i + 1 < args.length && !args[i + 1].startsWith('-')) {
			result.push(`${arg}=${args[i + 1]}`);
			i++; // skip the value, it's now part of the flag
		} else {
			result.push(arg);
		}
	}
	return result;
}
