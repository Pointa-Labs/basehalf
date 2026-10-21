/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';

/**
 * BaseHalf: the pages that BaseHalf draws in Settings in place of a list of
 * settings (docs/specs/settings-pages.md). A page has an entry in the table of
 * contents marked `custom` in `settingsLayout.ts`; Settings opens at one with
 * the option `customSection` of `ISettingsEditorOptions`.
 */
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

class SettingsCustomSectionRegistry {
	private readonly descriptors = new Map<string, ISettingsCustomSectionDescriptor>();

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
}

export const settingsCustomSectionRegistry = new SettingsCustomSectionRegistry();
