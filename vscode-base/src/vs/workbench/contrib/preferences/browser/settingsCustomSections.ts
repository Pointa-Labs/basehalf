/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';

export interface ISettingsCustomSectionLayout {
	readonly width: number;
	readonly height: number;
}

export interface ISettingsCustomSection extends IDisposable {
	create(parent: HTMLElement): void;
	setInput(input: string | undefined): void;
	setVisible(visible: boolean): void;
	layout(dimension: ISettingsCustomSectionLayout): void;
	focus(): void;
}

export interface ISettingsCustomSectionDescriptor {
	readonly id: string;
	create(instantiationService: IInstantiationService): ISettingsCustomSection;
}

export interface ISettingsCustomSectionRequest {
	readonly id: string;
	readonly input?: string;
}

class SettingsCustomSectionRegistry {
	private readonly descriptors = new Map<string, ISettingsCustomSectionDescriptor>();
	private readonly _onDidRequest = new Emitter<ISettingsCustomSectionRequest>();
	readonly onDidRequest: Event<ISettingsCustomSectionRequest> = this._onDidRequest.event;

	private pendingRequest: ISettingsCustomSectionRequest | undefined;

	register(descriptor: ISettingsCustomSectionDescriptor): IDisposable {
		const id = descriptor.id.trim();
		if (!id || this.descriptors.has(id)) {
			throw new Error(`Settings custom section '${id}' is already registered.`);
		}
		this.descriptors.set(id, descriptor);
		return toDisposable(() => {
			if (this.descriptors.get(id) === descriptor) {
				this.descriptors.delete(id);
			}
		});
	}

	get(id: string): ISettingsCustomSectionDescriptor | undefined {
		return this.descriptors.get(id);
	}

	request(id: string, input?: string): ISettingsCustomSectionRequest {
		const request = Object.freeze({ id: id.trim(), ...(input ? { input } : {}) });
		if (!request.id || !this.descriptors.has(request.id)) {
			throw new Error(`Unknown Settings custom section '${request.id}'.`);
		}
		this.pendingRequest = request;
		this._onDidRequest.fire(request);
		return request;
	}

	peekPendingRequest(): ISettingsCustomSectionRequest | undefined {
		return this.pendingRequest;
	}

	consumePendingRequest(request: ISettingsCustomSectionRequest): boolean {
		if (this.pendingRequest !== request) {
			return false;
		}
		this.pendingRequest = undefined;
		return true;
	}
}

export const settingsCustomSectionRegistry = new SettingsCustomSectionRegistry();
