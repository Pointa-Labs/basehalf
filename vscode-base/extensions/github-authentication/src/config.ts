/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IConfig {
	// The client ID of the GitHub OAuth app
	gitHubClientId: string;
	gitHubClientSecret?: string;
}

interface IBaseHalfGitHubAuthenticationProductConfig {
	readonly clientId?: unknown;
	readonly clientSecret?: unknown;
	readonly gitHubClientId?: unknown;
	readonly gitHubClientSecret?: unknown;
}

interface IBaseHalfProductConfig {
	readonly basehalfGitHubAuthentication?: IBaseHalfGitHubAuthenticationProductConfig;
}

export function readBaseHalfGitHubAuthConfig(
	env: Record<string, string | undefined> | undefined = typeof process !== 'undefined' ? process.env : undefined,
	product: unknown = undefined
): Partial<IConfig> {
	const config: Partial<IConfig> = {};
	if (env?.BASEHALF_GITHUB_CLIENT_ID) {
		config.gitHubClientId = env.BASEHALF_GITHUB_CLIENT_ID;
		if (env.BASEHALF_GITHUB_CLIENT_SECRET) {
			config.gitHubClientSecret = env.BASEHALF_GITHUB_CLIENT_SECRET;
		}
		return config;
	}

	const productConfig = readBaseHalfGitHubAuthenticationProductConfig(product);
	return productConfig.gitHubClientId ? productConfig : config;
}

export function applyBaseHalfGitHubAuthConfig(config: Partial<IConfig>): void {
	if (!config.gitHubClientId) {
		return;
	}

	Config.gitHubClientId = config.gitHubClientId;
	Config.gitHubClientSecret = config.gitHubClientSecret;
}

// For easy access to mixin client ID and secret
//
// NOTE: GitHub client secrets cannot be secured when running in a native client so in other words, the client secret is
// not really a secret... so we allow the client secret in code. It is brought in before we publish VS Code. Reference:
// https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/best-practices-for-creating-an-oauth-app#client-secrets
export const Config: IConfig = {
	gitHubClientId: '01ab8ac9400c4e429b23',
	...readBaseHalfGitHubAuthConfig()
};

function readBaseHalfGitHubAuthenticationProductConfig(product: unknown): Partial<IConfig> {
	if (!isObject(product)) {
		return {};
	}

	const config = (product as IBaseHalfProductConfig).basehalfGitHubAuthentication;
	if (!isObject(config)) {
		return {};
	}

	const gitHubClientId = readString(config.gitHubClientId) ?? readString(config.clientId);
	if (!gitHubClientId) {
		return {};
	}

	const gitHubClientSecret = readString(config.gitHubClientSecret) ?? readString(config.clientSecret);
	return gitHubClientSecret
		? { gitHubClientId, gitHubClientSecret }
		: { gitHubClientId };
}

function readString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
