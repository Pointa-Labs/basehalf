/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * Portable project paths: paths relative to a workspace folder that name the
 * same item on every file system BaseHalf runs on, as templates, the agent
 * command line, and plugin file transitions take them. Pure.
 */

/** The longest project path BaseHalf accepts. */
export const BASEHALF_PROJECT_PATH_MAX_LENGTH = 1024;

/**
 * Returns a portable, case-insensitive identity key for a validated project
 * path: two paths with the same key name the same item on a volume that
 * ignores letter case.
 */
export function baseHalfProjectPathKey(value: string): string {
	return value.normalize('NFC').toLowerCase();
}

/**
 * Describes why a project-relative path cannot safely round-trip across
 * supported hosts, or returns `undefined` for a portable path: one in NFC,
 * relative, with `/` between its segments, no empty, `.`, or `..` segment,
 * no segment `.bh`, no segment ending in a dot or a space, no reserved device
 * name, and none of the characters Windows refuses in a name.
 */
export function baseHalfProjectPathProblem(value: string): string | undefined {
	if (value !== value.normalize('NFC')) {
		return 'must use Unicode NFC normalization.';
	}
	if (value.includes('\\') || value.startsWith('/') || /[<>:"|?*\u0000-\u001F\u007F-\u009F]/.test(value) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
		return 'must be a portable project-relative path.';
	}
	const segments = value.split('/');
	if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
		return 'cannot contain empty, current, or parent path segments.';
	}
	if (segments.some(segment => segment.toLowerCase() === '.bh')) {
		return 'cannot target BaseHalf derived workspace metadata.';
	}
	if (segments.some(segment => /[. ]$/.test(segment))) {
		return 'cannot contain a segment ending in a dot or space.';
	}
	if (segments.some(segment => /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment))) {
		return 'cannot contain a reserved device-name segment.';
	}
	return undefined;
}
