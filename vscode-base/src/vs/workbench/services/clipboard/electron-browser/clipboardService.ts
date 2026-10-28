/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { URI } from '../../../../base/common/uri.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { ILogService } from '../../../../platform/log/common/log.js';
// BaseHalf: files on the clipboard are written and read as BaseHalf's clipboard writes and reads them (D104).
import { IBaseHalfClipboardService } from '../../../basehalf/clipboard/common/basehalfClipboard.js';

export class NativeClipboardService implements IClipboardService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@INativeHostService private readonly nativeHostService: INativeHostService,
		@ILogService private readonly logService: ILogService,
		@IBaseHalfClipboardService private readonly baseHalfClipboardService: IBaseHalfClipboardService
	) { }

	async triggerPaste(targetWindowId: number): Promise<void> {
		this.logService.trace('NativeClipboardService#triggerPaste called');
		return this.nativeHostService.triggerPaste({ targetWindowId });
	}

	async readImage(): Promise<Uint8Array> {
		return this.nativeHostService.readImage();
	}

	async writeText(text: string, type?: 'selection' | 'clipboard'): Promise<void> {
		this.logService.trace('NativeClipboardService#writeText called with type:', type, ' with text.length:', text.length);
		return this.nativeHostService.writeClipboardText(text, type);
	}

	async readText(type?: 'selection' | 'clipboard'): Promise<string> {
		this.logService.trace('NativeClipboardService#readText called with type:', type);
		return this.nativeHostService.readClipboardText(type);
	}

	async readFindText(): Promise<string> {
		if (isMacintosh) {
			return this.nativeHostService.readClipboardFindText();
		}

		return '';
	}

	async writeFindText(text: string): Promise<void> {
		if (isMacintosh) {
			return this.nativeHostService.writeClipboardFindText(text);
		}
	}

	// BaseHalf: the files, their paths as text, and BaseHalf's record in one
	// write, and the files of BaseHalf's record or of another app's copy read
	// back; a draft has no file and is left out (D104).
	async writeResources(resources: URI[]): Promise<void> {
		return this.baseHalfClipboardService.writeItems(resources, false);
	}

	async readResources(): Promise<URI[]> {
		const transfer = await this.baseHalfClipboardService.readItems();
		return transfer?.items.filter(item => !item.draft).map(item => item.resource) ?? [];
	}

	async hasResources(): Promise<boolean> {
		return (await this.readResources()).length > 0;
	}
}

registerSingleton(IClipboardService, NativeClipboardService, InstantiationType.Delayed);
