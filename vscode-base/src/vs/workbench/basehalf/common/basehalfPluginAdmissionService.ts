/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';

export interface IBaseHalfVerifiedPluginAdmission {
	readonly extensionId: string;
	readonly versions: readonly string[];
}

export const IBaseHalfPluginAdmissionService = createDecorator<IBaseHalfPluginAdmissionService>('basehalfPluginAdmissionService');

/**
 * Synchronous runtime admission derived only from a catalog that the catalog
 * service has already signature-verified. Keeping this registry separate from
 * catalog loading avoids a dependency cycle through extension management.
 */
export interface IBaseHalfPluginAdmissionService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;
	replaceVerifiedPlugins(plugins: readonly IBaseHalfVerifiedPluginAdmission[]): void;
	isAllowed(extensionId: string, version?: string): boolean;
}

export class BaseHalfPluginAdmissionService extends Disposable implements IBaseHalfPluginAdmissionService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private verifiedVersions = new Map<string, ReadonlySet<string>>();

	replaceVerifiedPlugins(plugins: readonly IBaseHalfVerifiedPluginAdmission[]): void {
		const next = new Map<string, ReadonlySet<string>>();
		for (const plugin of plugins) {
			const extensionId = plugin.extensionId.toLowerCase();
			if (!extensionId || plugin.versions.length === 0) {
				continue;
			}
			next.set(extensionId, new Set(plugin.versions));
		}

		if (equals(this.verifiedVersions, next)) {
			return;
		}
		this.verifiedVersions = next;
		this._onDidChange.fire();
	}

	isAllowed(extensionId: string, version?: string): boolean {
		const versions = this.verifiedVersions.get(extensionId.toLowerCase());
		return !!versions && (version === undefined || versions.has(version));
	}
}

function equals(first: ReadonlyMap<string, ReadonlySet<string>>, second: ReadonlyMap<string, ReadonlySet<string>>): boolean {
	if (first.size !== second.size) {
		return false;
	}
	for (const [extensionId, versions] of first) {
		const otherVersions = second.get(extensionId);
		if (!otherVersions || versions.size !== otherVersions.size || [...versions].some(version => !otherVersions.has(version))) {
			return false;
		}
	}
	return true;
}

registerSingleton(IBaseHalfPluginAdmissionService, BaseHalfPluginAdmissionService, InstantiationType.Delayed);
