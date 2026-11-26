/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

export interface IBaseHalfMarkdownRichStableSnapshotOptions<T> {
	readonly waitForCompositionSettled: () => Promise<void>;
	readonly waitForPendingSaveSettled: () => Promise<void>;
	readonly isComposing: () => boolean;
	readonly isFrozen: () => boolean;
	readonly revision: () => number;
	readonly serialize: () => Promise<T>;
}

/**
 * Capture the byte-preserving Rich projection only after IME input and an
 * earlier save round-trip settle. Serialization itself contains await points,
 * so retry when the editor revision changes under the snapshot. Returning
 * `undefined` means the structural fence was released before a stable snapshot
 * could be published.
 */
export async function baseHalfCaptureStableMarkdownRichSnapshot<T>(options: IBaseHalfMarkdownRichStableSnapshotOptions<T>): Promise<{ readonly value: T; readonly revision: number } | undefined> {
	await options.waitForCompositionSettled();
	await options.waitForPendingSaveSettled();
	while (options.isFrozen()) {
		const revision = options.revision();
		const value = await options.serialize();
		if (options.revision() === revision && !options.isComposing()) {
			return { value, revision };
		}
		await options.waitForCompositionSettled();
	}
	return undefined;
}
