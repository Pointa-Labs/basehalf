/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

interface BaseHalfWebviewApi<State = unknown> {
	postMessage(message: unknown): void;
	getState(): State | undefined;
	setState(state: State): void;
}

declare function acquireVsCodeApi<State = unknown>(): BaseHalfWebviewApi<State>;

declare module '*.css';
