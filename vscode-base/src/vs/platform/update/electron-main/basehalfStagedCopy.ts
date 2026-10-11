/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFileSync } from 'child_process';
import * as electron from 'electron';
import { readdirSync } from 'fs';
import { dirname, join } from '../../../base/common/path.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { ILogService } from '../../log/common/log.js';
import { IProductService } from '../../product/common/productService.js';
import { bundlePathFromExec } from '../node/basehalfUpdateProtocol.js';
import { baseHalfAnotherRunUses, baseHalfBundleVersion, baseHalfCanSwapIn, baseHalfChooseStagedCopy, baseHalfSwapIn } from '../node/basehalfUpdateStore.js';

export interface IBaseHalfStagedCopy {
	/** The bundle this process runs from. */
	readonly bundle: string;
	/** The staged copy beside it. */
	readonly path: string;
	readonly version: string;
}

/**
 * The complete staged copy of a newer version beside the bundle this process
 * runs from, if there is one that this user can swap in.
 */
export function baseHalfFindStagedCopy(runningVersion: string | undefined): IBaseHalfStagedCopy | undefined {
	const bundle = bundlePathFromExec(process.execPath);
	if (!bundle || !runningVersion || process.execPath.includes('/AppTranslocation/') || !baseHalfCanSwapIn(bundle)) {
		return undefined;
	}
	const parent = dirname(bundle);
	try {
		const chosen = baseHalfChooseStagedCopy(readdirSync(parent), runningVersion, entry => baseHalfBundleVersion(join(parent, entry)));
		return chosen ? { bundle, path: join(parent, chosen.entry), version: chosen.version } : undefined;
	} catch {
		return undefined; // Unreadable parent dir: nothing is staged there.
	}
}

/**
 * Whether another run of the application executes from the bundle. What
 * cannot be told, or not within a few seconds, is taken as in use.
 */
export function baseHalfAnotherRunUsesBundle(bundle: string): boolean {
	try {
		return baseHalfAnotherRunUses(execFileSync('/bin/ps', ['-Ao', 'pid=,ppid=,comm='], { encoding: 'utf8', timeout: 5000 }), bundle, process.pid);
	} catch {
		return true;
	}
}

/**
 * At a start, before the application is created: a staged copy of a newer
 * version that a run before this one left behind takes the bundle's place
 * (app update, "At a start"). The run that staged it was killed or crashed,
 * or its swap failed.
 *
 * Returns true when it did. This process then runs from a bundle that was
 * renamed aside, has asked to be started again, and has to end without doing
 * anything more.
 */
export function baseHalfSwapStagedCopyAtStart(environmentMainService: IEnvironmentMainService, configurationService: IConfigurationService, productService: IProductService, logService: ILogService): boolean {
	// Only where the update service is switched on (see AbstractUpdateService.initialize()).
	if (!environmentMainService.isBuilt || environmentMainService.disableUpdates
		|| !productService.updateUrl || !productService.commit
		|| configurationService.getValue('update.mode') === 'none') {
		return false;
	}
	// Not in a start that something waits for: it would see this process end
	// and take that for the end of the run. The update is shown as ready
	// instead.
	if (environmentMainService.args.wait || environmentMainService.isExtensionDevelopment || environmentMainService.extensionTestsLocationURI) {
		return false;
	}
	const staged = baseHalfFindStagedCopy(productService.basehalfVersion);
	if (!staged) {
		return false;
	}
	if (baseHalfAnotherRunUsesBundle(staged.bundle)) {
		// It still reads from the bundle. This run shows the update as ready instead.
		logService.info('update#swapStagedCopyAtStart - another BaseHalf runs from this bundle, not swapping');
		return false;
	}

	try {
		baseHalfSwapIn(staged.bundle, staged.path, process.pid);
	} catch (err) {
		// This run goes on as it is.
		logService.error('update#swapStagedCopyAtStart - swap failed', err);
		return false;
	}

	logService.info(`update#swapStagedCopyAtStart - ${staged.version} took the bundle's place, starting again`);
	logService.flush();
	// What Finder asked this start to open is opened by the next one.
	const askedToOpen = (globalThis as { macOpenFiles?: string[] }).macOpenFiles ?? [];
	electron.app.relaunch({ args: [...process.argv.slice(1), ...askedToOpen] });
	return true;
}
