/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { CancellationError } from '../../../base/common/errors.js';
import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { extname } from '../../../base/common/resources.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { IBaseHalfProjectFileTransition } from './basehalfProjectFileTransitions.js';

export const BASEHALF_PLUGIN_STRUCTURAL_CLEANUP_MAX_TRANSITIONS = 256;

export interface IBaseHalfPluginStructuralCleanupProvider {
	prepareDelete(resource: URI, token: CancellationToken): Promise<readonly IBaseHalfProjectFileTransition[]>;
}

export const IBaseHalfPluginStructuralCleanupService = createDecorator<IBaseHalfPluginStructuralCleanupService>('baseHalfPluginStructuralCleanupService');

export interface IBaseHalfPluginStructuralCleanupService {
	readonly _serviceBrand: undefined;
	registerDescriptor(extensionId: string, id: string, extensions: readonly string[]): IDisposable;
	activationEvents(resource: URI): readonly string[];
	registerProvider(extensionId: string, provider: IBaseHalfPluginStructuralCleanupProvider): IDisposable;
	prepareDelete(resource: URI, token: CancellationToken): Promise<readonly IBaseHalfProjectFileTransition[]>;
}

export class BaseHalfPluginStructuralCleanupService implements IBaseHalfPluginStructuralCleanupService {
	declare readonly _serviceBrand: undefined;

	private readonly providers = new Map<string, IBaseHalfPluginStructuralCleanupProvider>();
	private readonly descriptors = new Map<string, { readonly extensionId: string; readonly extensions: readonly string[] }>();

	registerDescriptor(extensionId: string, id: string, extensions: readonly string[]): IDisposable {
		const key = id.toLowerCase();
		if (this.descriptors.has(key)) {
			throw new Error(`A BaseHalf structural cleanup descriptor with id '${id}' is already registered.`);
		}
		const descriptor = { extensionId: extensionId.toLowerCase(), extensions: Object.freeze(extensions.map(extension => extension.toLowerCase())) };
		this.descriptors.set(key, descriptor);
		return toDisposable(() => {
			if (this.descriptors.get(key) === descriptor) {
				this.descriptors.delete(key);
			}
		});
	}

	activationEvents(resource: URI): readonly string[] {
		const extension = extname(resource).toLowerCase();
		return Object.freeze([...this.descriptors]
			.filter(([, descriptor]) => descriptor.extensions.includes(extension))
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([id]) => `onBaseHalfStructuralCleanup:${id}`));
	}

	registerProvider(extensionId: string, provider: IBaseHalfPluginStructuralCleanupProvider): IDisposable {
		const id = extensionId.toLowerCase();
		if (this.providers.has(id)) {
			throw new Error(`Extension '${extensionId}' already registered a BaseHalf structural cleanup provider.`);
		}
		this.providers.set(id, provider);
		return toDisposable(() => {
			if (this.providers.get(id) === provider) {
				this.providers.delete(id);
			}
		});
	}

	async prepareDelete(resource: URI, token: CancellationToken): Promise<readonly IBaseHalfProjectFileTransition[]> {
		const transitions: IBaseHalfProjectFileTransition[] = [];
		const resources = new Set<string>();
		const extension = extname(resource).toLowerCase();
		const matchingExtensionIds = new Set([...this.descriptors.values()]
			.filter(descriptor => descriptor.extensions.includes(extension))
			.map(descriptor => descriptor.extensionId));
		for (const [extensionId, provider] of [...this.providers].sort(([left], [right]) => left.localeCompare(right))) {
			if (!matchingExtensionIds.has(extensionId)) {
				continue;
			}
			if (token.isCancellationRequested) {
				throw new CancellationError();
			}
			const proposed = await provider.prepareDelete(resource, token);
			if (token.isCancellationRequested) {
				throw new CancellationError();
			}
			if (!Array.isArray(proposed)
				|| proposed.length > BASEHALF_PLUGIN_STRUCTURAL_CLEANUP_MAX_TRANSITIONS
				|| transitions.length + proposed.length > BASEHALF_PLUGIN_STRUCTURAL_CLEANUP_MAX_TRANSITIONS) {
				throw new Error(`Extension '${extensionId}' proposed too many structural cleanup changes.`);
			}
			for (const transition of proposed) {
				if (!transition || !URI.isUri(transition.resource) || !(transition.expected instanceof VSBuffer)
					|| !(transition.next instanceof VSBuffer) || typeof transition.label !== 'string') {
					throw new Error(`Extension '${extensionId}' proposed an invalid structural cleanup change.`);
				}
				const key = transition.resource.toString();
				if (resources.has(key)) {
					throw new Error(`More than one structural cleanup change targeted '${transition.resource.path}'.`);
				}
				resources.add(key);
				transitions.push({
					resource: transition.resource,
					expected: transition.expected.clone(),
					next: transition.next.clone(),
					label: transition.label
				});
			}
		}
		return Object.freeze(transitions);
	}
}

registerSingleton(IBaseHalfPluginStructuralCleanupService, BaseHalfPluginStructuralCleanupService, InstantiationType.Delayed);
