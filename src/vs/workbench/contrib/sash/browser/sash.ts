/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { clamp } from '../../../../base/common/numbers.js';
import { addDisposableListener, onDidRegisterWindow } from '../../../../base/browser/dom.js';
import { releaseSashHover, setGlobalSashSize, setGlobalHoverDelay } from '../../../../base/browser/ui/sash/sash.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { createStyleSheet } from '../../../../base/browser/domStylesheets.js';
import { webviewMouseActivityEvent } from '../../webview/common/webview.js';

export const minSize = 1;
export const maxSize = 20; // see also https://ux.stackexchange.com/questions/39023/what-is-the-optimum-button-size-of-touch-screen-applications

export class SashSettingsController extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.sash';

	private readonly styleSheet = createStyleSheet();

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();

		const onDidChangeSize = Event.filter(configurationService.onDidChangeConfiguration, e => e.affectsConfiguration('workbench.sash.size'));
		onDidChangeSize(this.onDidChangeSize, this, this._store);
		this.onDidChangeSize();

		const onDidChangeHoverDelay = Event.filter(configurationService.onDidChangeConfiguration, e => e.affectsConfiguration('workbench.sash.hoverDelay'));
		onDidChangeHoverDelay(this.onDidChangeHoverDelay, this, this._store);
		this.onDidChangeHoverDelay();
		// BaseHalf: a pointer that moves inside a webview is over no sash of that
		// window. A sash that the pointer left straight into the webview was never
		// told so, and would keep its hover line.
		this._register(Event.runAndSubscribe(onDidRegisterWindow, ({ window, disposables }) => {
			disposables.add(addDisposableListener(window, webviewMouseActivityEvent, () => releaseSashHover(window)));
		}, { window: mainWindow, disposables: this._store }));
	}

	private onDidChangeSize(): void {
		const configuredSize = this.configurationService.getValue<number>('workbench.sash.size');
		const size = clamp(configuredSize, 4, 20);
		const hoverSize = clamp(configuredSize, 1, 8);

		this.styleSheet.textContent = `
			.monaco-workbench {
				--vscode-sash-size: ${size}px;
				--vscode-sash-hover-size: ${hoverSize}px;
			}
		`;

		setGlobalSashSize(size);
	}

	private onDidChangeHoverDelay(): void {
		setGlobalHoverDelay(this.configurationService.getValue<number>('workbench.sash.hoverDelay'));
	}
}
