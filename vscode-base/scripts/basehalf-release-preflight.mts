/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { pathToFileURL } from 'url';

export function validateControlPlaneBaseUrl(rawValue: string): string {
	if (!rawValue || rawValue.trim() !== rawValue) {
		throw new Error('The control-plane URL must be a non-empty value without surrounding whitespace.');
	}
	if (/[\u0000-\u001f\u007f]/.test(rawValue)) {
		throw new Error('The control-plane URL must not contain control characters.');
	}

	let url: URL;
	try {
		url = new URL(rawValue);
	} catch {
		throw new Error('The control-plane URL is invalid.');
	}
	if (url.protocol !== 'https:') {
		throw new Error('The control-plane URL must use HTTPS.');
	}
	if (url.username || url.password) {
		throw new Error('The control-plane URL must not contain credentials.');
	}
	if (url.search || url.hash) {
		throw new Error('The control-plane URL must not contain a query or fragment.');
	}
	if (!url.hostname || url.pathname !== '/') {
		throw new Error('The control-plane URL must contain only an HTTPS origin.');
	}

	return url.origin;
}

function main(argv: string[]): void {
	if (argv.length !== 2 || argv[0] !== 'control-url') {
		throw new Error('Usage: basehalf-release-preflight.mts control-url <https-origin>');
	}
	process.stdout.write(`${validateControlPlaneBaseUrl(argv[1] ?? '')}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		main(process.argv.slice(2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
