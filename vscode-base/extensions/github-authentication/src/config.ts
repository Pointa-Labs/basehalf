/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IConfig {
	// The client ID of the GitHub OAuth app
	gitHubClientId: string;
	gitHubClientSecret?: string;
}

export function readBaseHalfGitHubAuthConfig(env: Record<string, string | undefined> | undefined = typeof process !== 'undefined' ? process.env : undefined): Partial<IConfig> {
	if (!env) {
		return {};
	}

	const config: Partial<IConfig> = {};
	if (env.BASEHALF_GITHUB_CLIENT_ID) {
		config.gitHubClientId = env.BASEHALF_GITHUB_CLIENT_ID;
		if (env.BASEHALF_GITHUB_CLIENT_SECRET) {
			config.gitHubClientSecret = env.BASEHALF_GITHUB_CLIENT_SECRET;
		}
	}
	return config;
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
