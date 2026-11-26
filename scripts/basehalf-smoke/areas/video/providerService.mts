/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';
import { logsPath } from '../../context.mts';

// AI Video is BaseHalf's own code (D75; built-in AI Video and no plugins,
// criteria 10 and 11): after the generations of the suite, no extension host
// has loaded the AI Video extension, and the provider service in the shared
// process has logged the requests it sent.
export async function assertProviderRequestsFromSharedProcess() {
	const logs = filesBelow(logsPath);
	const extensionHostLogs = logs.filter(file => path.basename(file) === 'exthost.log');
	if (extensionHostLogs.length === 0) {
		throw new Error(`No extension host log is below ${logsPath}`);
	}
	const naming = extensionHostLogs.filter(file => fs.readFileSync(file, 'utf8').includes('pointa.basehalf-ai-video'));
	if (naming.length) {
		throw new Error(`An extension host names the AI Video extension: ${naming.join(', ')}`);
	}
	const providerLog = logs.find(file => path.basename(file) === 'basehalfProviders.log');
	const sent = providerLog ? fs.readFileSync(providerLog, 'utf8').split('\n').filter(line => /\bPOST \/\S* 2\d\d \d+ ms$/.test(line)) : [];
	if (sent.length === 0) {
		throw new Error(`The provider service in the shared process logged no request it sent: ${providerLog ?? `no basehalfProviders.log below ${logsPath}`}`);
	}
}

function filesBelow(folder: string): string[] {
	if (!fs.existsSync(folder)) {
		return [];
	}
	return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
		const file = path.join(folder, entry.name);
		return entry.isDirectory() ? filesBelow(file) : entry.isFile() ? [file] : [];
	});
}
