/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type { LogLevel as ProxyLogLevel, ProxyAgentParams, ProxySupportSetting } from '@vscode/proxy-agent';
import { encodeBase64, VSBuffer } from '../../../base/common/buffer.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { getErrorMessage } from '../../../base/common/errors.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { localize } from '../../../nls.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { INativeEnvironmentService } from '../../environment/common/environment.js';
import { ILoggerService, ILogService, LogLevel } from '../../log/common/log.js';
import { INativeHostService } from '../../native/common/native.js';
import { systemCertificatesNodeDefault } from '../../request/common/request.js';
import { getResolvedShellEnv } from '../../shell/node/shellEnv.js';
import { IBaseHalfProviderService } from '../common/basehalfProviders.js';
import type { CancelResult, Catalog, CheckPayload, CheckResult, DownloadRequest, DownloadResult, PlaceRequest, PlaceResult, PollState, ProviderError, ProviderResponse, SubmitPayload, SubmitResult, TaskRef, VoicePreviewRequest, VoicePreviewResult, VoicesRequest, VoicesResult } from '../common/basehalfProviderTypes.js';
import { VideoProviderCommands } from '../node/commands.js';
import { plainMessage } from '../node/failure.js';
import { createNodeTransport, type NodeHttpModules } from '../node/http.js';
import { PROVIDER_MODULES } from '../node/registry.js';

/**
 * The provider service of the shared process (D75). Its requests are Node's
 * own, one connection each and never sent again by themselves, so that a
 * create reaches the provider once; the system's proxy settings, a proxy
 * auto-configuration, the proxy variables of the user's login shell,
 * `http.proxy`, `http.noProxy`, and the certificates the system trusts apply
 * to them as they applied in the extension host, through VS Code's proxy
 * agent. Node's modules, the agent, and the login shell's environment load
 * with the first call that may send. A call's requests end with its token,
 * when the window that made it closes or reloads. The log of the service gets
 * the method, path, status, and time of each exchange with a provider, and
 * nothing else.
 */
export class BaseHalfProviderService extends Disposable implements IBaseHalfProviderService {
	declare readonly _serviceBrand: undefined;

	private readonly commands: VideoProviderCommands;
	private modules: NodeHttpModules | undefined;
	private loading: Promise<void> | undefined;
	/** What each proxy last asked for, and the Basic authorization the user gave it. */
	private readonly proxyAuthenticate = new Map<string, string | string[]>();
	private readonly basicAuthorization = new Map<string, string>();

	constructor(
		@ILoggerService loggerService: ILoggerService,
		@INativeHostService private readonly nativeHostService: INativeHostService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@INativeEnvironmentService private readonly environmentService: INativeEnvironmentService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		const log = this._register(loggerService.createLogger('basehalfProviders', { name: localize('basehalfProviders.log', "BaseHalf Providers") }));
		const transport = createNodeTransport(() => {
			if (!this.modules) {
				throw new Error('The provider service sends nothing before its network modules have loaded.');
			}
			return this.modules;
		});
		this.commands = new VideoProviderCommands(PROVIDER_MODULES, { http: { log, transport } });
	}

	async catalog(): Promise<ProviderResponse<Catalog>> {
		return this.commands.catalog();
	}

	async check(request: CheckPayload): Promise<ProviderResponse<CheckResult>> {
		return this.commands.check(request);
	}

	async submit(request: SubmitPayload, token = CancellationToken.None): Promise<ProviderResponse<SubmitResult>> {
		return await this.notReady() ?? this.commands.submit(request, token);
	}

	async poll(task: TaskRef, token = CancellationToken.None): Promise<ProviderResponse<PollState>> {
		return await this.notReady() ?? this.commands.poll(task, token);
	}

	async download(request: DownloadRequest, token = CancellationToken.None): Promise<ProviderResponse<DownloadResult>> {
		return await this.notReady() ?? this.commands.download(request, token);
	}

	async cancel(task: TaskRef, token = CancellationToken.None): Promise<ProviderResponse<CancelResult>> {
		return await this.notReady() ?? this.commands.cancel(task, token);
	}

	async place(request: PlaceRequest): Promise<ProviderResponse<PlaceResult>> {
		return this.commands.place(request);
	}

	async voices(request: VoicesRequest, token = CancellationToken.None): Promise<ProviderResponse<VoicesResult>> {
		return await this.notReady() ?? this.commands.voices(request, token);
	}

	async voicePreview(request: VoicePreviewRequest, token = CancellationToken.None): Promise<ProviderResponse<VoicePreviewResult>> {
		return await this.notReady() ?? this.commands.voicePreview(request, token);
	}

	/** Loads what requests are sent with; the answer of a call that cannot send, since it did not load. */
	private async notReady(): Promise<{ readonly ok: false; readonly error: ProviderError } | undefined> {
		this.loading ??= this.load().catch(error => {
			this.loading = undefined;
			throw error;
		});
		try {
			await this.loading;
			return undefined;
		} catch (error) {
			this.logService.error('[BaseHalf Providers] what requests are sent with did not load', error);
			return { ok: false, error: { code: 'network', message: plainMessage(`BaseHalf could not load what it sends requests with: ${getErrorMessage(error)}`, []) } };
		}
	}

	private async load(): Promise<void> {
		const [http, https, proxyAgent, shellEnv] = await Promise.all([
			import('http'),
			import('https'),
			import('@vscode/proxy-agent'),
			// The proxy variables of the login shell, which the shared process, started
			// with the application's own environment, lacks when it was opened from the Dock.
			getResolvedShellEnv(this.configurationService, this.logService, this.environmentService.args, process.env).catch(error => {
				this.logService.warn(`[BaseHalf Providers] the login shell's environment did not resolve: ${getErrorMessage(error)}`);
				return {};
			})
		]);
		const config = <T>(key: string) => this.configurationService.getValue<T>(key);
		const params: ProxyAgentParams = {
			// The main process resolves with the session that every window uses.
			resolveProxy: url => this.nativeHostService.resolveProxy(url),
			getProxyURL: () => config<string>('http.proxy') || undefined,
			getProxySupport: () => config<ProxySupportSetting>('http.proxySupport') || 'override',
			getNoProxyConfig: () => config<string[]>('http.noProxy') || [],
			isAdditionalFetchSupportEnabled: () => false,
			isWebSocketPatchEnabled: () => false,
			// The certificates go with each request: the second way adds them to the
			// process's TLS, which the service leaves to the rest of the shared process.
			addCertificatesV1: () => config<boolean>('http.systemCertificates') !== false,
			addCertificatesV2: () => false,
			loadSystemCertificatesFromNode: () => config<boolean>('http.systemCertificatesNode') ?? systemCertificatesNodeDefault,
			// From the main process, which keeps them for every window, unless Node's own are chosen.
			loadAdditionalCertificates: () => (config<boolean>('http.systemCertificatesNode') ?? systemCertificatesNodeDefault)
				? proxyAgent.loadSystemCertificates({ loadSystemCertificatesFromNode: () => true, log: this.logService })
				: this.nativeHostService.loadCertificates(),
			lookupProxyAuthorization: (proxyURL, proxyAuthenticate, state) => this.lookupProxyAuthorization(proxyURL, proxyAuthenticate, state),
			getNetworkInterfaceCheckInterval: () => (config<number>('http.experimental.networkInterfaceCheckInterval') ?? 300) * 1000,
			log: this.logService,
			getLogLevel: () => proxyLogLevel(this.logService.getLevel(), proxyAgent.LogLevel),
			proxyResolveTelemetry: () => undefined,
			isUseHostProxyEnabled: () => true,
			env: { ...process.env, ...shellEnv }
		};
		const { resolveProxyWithRequest } = proxyAgent.createProxyResolver(params);
		this.modules = {
			http: proxyAgent.createHttpPatch(params, http, resolveProxyWithRequest),
			https: proxyAgent.createHttpPatch(params, https, resolveProxyWithRequest)
		};
	}

	/**
	 * What a proxy that asks for authentication gets, as in the extension host:
	 * a Kerberos ticket, which the main process asks for, or the user's name
	 * and password for the proxy, which the main process asks the user for
	 * once and BaseHalf keeps for this proxy while it runs.
	 */
	private async lookupProxyAuthorization(proxyURL: string, proxyAuthenticate: string | string[] | undefined, state: { kerberosRequested?: boolean; basicAuthCacheUsed?: boolean; basicAuthAttempt?: number }): Promise<string | undefined> {
		proxyURL = proxyURL.replace(/\/+$/, '');
		if (proxyAuthenticate) {
			this.proxyAuthenticate.set(proxyURL, proxyAuthenticate);
		}
		const header = proxyAuthenticate ?? this.proxyAuthenticate.get(proxyURL);
		const authenticate = Array.isArray(header) ? header : typeof header === 'string' ? [header] : [];
		if (authenticate.some(value => /^(Negotiate|Kerberos)( |$)/i.test(value)) && !state.kerberosRequested) {
			state.kerberosRequested = true;
			const kerberos = await this.nativeHostService.lookupKerberosAuthorization(proxyURL).catch(() => undefined);
			if (kerberos) {
				return kerberos;
			}
		}
		const basic = authenticate.find(value => /^Basic( |$)/i.test(value));
		if (!basic) {
			return undefined;
		}
		const cached = this.basicAuthorization.get(proxyURL);
		if (cached) {
			if (!state.basicAuthCacheUsed) {
				state.basicAuthCacheUsed = true;
				return cached;
			}
			// The proxy refused what was kept: ask again.
			this.basicAuthorization.delete(proxyURL);
		}
		state.basicAuthAttempt = (state.basicAuthAttempt ?? 0) + 1;
		const url = new URL(proxyURL);
		try {
			const credentials = await this.nativeHostService.lookupAuthorization({
				scheme: 'basic',
				host: url.hostname,
				port: Number(url.port),
				realm: / realm="([^"]+)"/i.exec(basic)?.[1] ?? '',
				isProxy: true,
				attempt: state.basicAuthAttempt
			});
			if (!credentials) {
				return undefined;
			}
			const authorization = `Basic ${encodeBase64(VSBuffer.fromString(`${credentials.username}:${credentials.password}`))}`;
			this.basicAuthorization.set(proxyURL, authorization);
			return authorization;
		} catch (error) {
			this.logService.error('[BaseHalf Providers] proxy authentication failed', error);
			return undefined;
		}
	}
}

function proxyLogLevel(level: LogLevel, levels: typeof ProxyLogLevel): ProxyLogLevel {
	switch (level) {
		case LogLevel.Trace: return levels.Trace;
		case LogLevel.Debug: return levels.Debug;
		case LogLevel.Info: return levels.Info;
		case LogLevel.Warning: return levels.Warning;
		case LogLevel.Error: return levels.Error;
		case LogLevel.Off: return levels.Off;
	}
}
