/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface IBaseHalfPluginCatalogPublicKey {
	readonly keyId: string;
	readonly publicKey: string;
}

export function resolveBaseHalfPluginCatalogPublicKeys(
	existing: readonly IBaseHalfPluginCatalogPublicKey[],
	environment: NodeJS.ProcessEnv = process.env
): readonly IBaseHalfPluginCatalogPublicKey[] {
	const keyId = environment['BASEHALF_PLUGIN_CATALOG_KEY_ID']?.trim();
	const keyPath = environment['BASEHALF_PLUGIN_CATALOG_PUBLIC_KEY_PATH']?.trim();
	if (!!keyId !== !!keyPath) {
		throw new Error('BASEHALF_PLUGIN_CATALOG_KEY_ID and BASEHALF_PLUGIN_CATALOG_PUBLIC_KEY_PATH must be provided together.');
	}
	if (keyId && keyPath) {
		const publicKey = fs.readFileSync(path.resolve(keyPath), 'utf8');
		const parsed = crypto.createPublicKey(publicKey);
		if (parsed.asymmetricKeyType !== 'ec' || parsed.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
			throw new Error('The BaseHalf plugin catalog public key must be an EC P-256 SubjectPublicKeyInfo PEM key.');
		}
		return [{ keyId, publicKey }, ...existing.filter(candidate => candidate.keyId !== keyId)];
	}
	if (existing.length) {
		return existing;
	}
	throw new Error('Refusing to package BaseHalf without a pinned plugin catalog public key. Set BASEHALF_PLUGIN_CATALOG_KEY_ID and BASEHALF_PLUGIN_CATALOG_PUBLIC_KEY_PATH.');
}
