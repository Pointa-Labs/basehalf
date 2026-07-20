/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

export async function loadSequenceForStructuralCleanup<T>(
	path: string,
	load: () => Promise<T>
): Promise<T> {
	try {
		return await load();
	} catch (error) {
		throw new Error(
			`Cannot safely delete this Video node because Sequence '${path}' could not be read and verified. Open or repair that file, then try again.`,
			{ cause: error }
		);
	}
}
