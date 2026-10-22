/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { FileAccess } from '../../../../base/common/network.js';
import { join } from '../../../../base/common/path.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { NullLogService } from '../../../log/common/log.js';
import {
	BASEHALF_AGENT_DISCOVERY_GENERATE_COMMAND,
	BASEHALF_AGENT_DISCOVERY_GENERATION_EXTENSIONS,
	BASEHALF_AGENT_DISCOVERY_GENERATION_FILE,
	BASEHALF_AGENT_DISCOVERY_HOST_OWNED,
	BASEHALF_AGENT_DISCOVERY_INPUTS_FILE,
	BASEHALF_NODE_COMMAND_BRIDGE_HOOK_ENV,
	BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
	BaseHalfGenerateCommandOutcome,
	IBaseHalfAgentCapabilityDiscoveryExtension,
	IBaseHalfAgentCapabilityDiscoveryModelCatalog,
	IBaseHalfAgentCapabilityDiscoveryResponse,
	IBaseHalfNodeCommandResponse
} from '../../common/terminal.js';
import { BaseHalfNodeCommandServer, requestBaseHalfNodeCommand, resolveBaseHalfCliDirectory } from '../../node/basehalfNodeCommandBridge.js';

suite('BaseHalfNodeCommandServer', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('accepts only the fixed generate protocol over its private socket', async () => {
		let calls = 0;
		const server = new BaseHalfNodeCommandServer(async request => {
			calls++;
			assert.strictEqual(request.type, 'generate');
			if (request.type !== 'generate') {
				throw new Error('Unexpected request type.');
			}
			return {
				version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
				type: 'generate',
				ok: true,
				outcome: 'succeeded',
				path: request.relativePath,
				cards: [request.relativePath]
			};
		}, new NullLogService());

		try {
			await server.start();
			if (process.platform !== 'win32') {
				assert.strictEqual(fs.statSync(server.ipcHandlePath).mode & 0o777, 0o600);
			}
			const response = await requestBaseHalfNodeCommand(server.ipcHandlePath, {
				version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
				type: 'generate',
				cwd: '/work',
				relativePath: 'shot.mp4'
			});
			assert.deepStrictEqual([response.outcome, response.path, response.cards], ['succeeded', 'shot.mp4', ['shot.mp4']]);
			assert.strictEqual(calls, 1);

			const unsupported = await rawRequest(server.ipcHandlePath, '/command', '{}');
			assert.strictEqual(unsupported.statusCode, 404);
			assert.strictEqual(unsupported.body.outcome, 'rejected');
			// The retired endpoint and request type are gone (D63).
			const retired = await rawRequest(server.ipcHandlePath, '/run-node', JSON.stringify({ version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION, type: 'runNode', cwd: '/work', relativePath: 'shot.bhnode' }));
			assert.strictEqual(retired.statusCode, 404);
			const retiredType = await rawRequest(server.ipcHandlePath, '/generate', JSON.stringify({ version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION, type: 'runNode', cwd: '/work', relativePath: 'shot.bhnode' }));
			assert.strictEqual(retiredType.statusCode, 400);
			const earlierVersion = await rawRequest(server.ipcHandlePath, '/generate', JSON.stringify({ version: 4, type: 'generate', cwd: '/work', relativePath: 'shot.mp4' }));
			assert.strictEqual(earlierVersion.statusCode, 400);
			assert.strictEqual(calls, 1);
		} finally {
			server.dispose();
		}
		if (process.platform !== 'win32') {
			assert.strictEqual(fs.existsSync(server.ipcHandlePath), false);
		}
	});

	test('CLI prints every card that generates as one JSON line and maps the outcome to its exit code', async () => {
		for (const [outcome, expectedExitCode] of [['succeeded', 0], ['rejected', 1]] as const) {
			const server = new BaseHalfNodeCommandServer(async request => ({
				version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
				type: 'generate' as const,
				ok: outcome === 'succeeded',
				outcome,
				path: request.type === 'generate' ? request.relativePath : '',
				...(outcome === 'succeeded' ? { cards: ['shots/image.png', 'shots/image-2.png'] } : { error: 'Choose a model to generate.' })
			}), new NullLogService());
			try {
				await server.start();
				const result = await runCli(server.ipcHandlePath);
				assert.strictEqual(result.exitCode, expectedExitCode);
				assert.strictEqual(result.stdout.trim().split('\n').length, 1);
				const response = JSON.parse(result.stdout) as { type: string; outcome: BaseHalfGenerateCommandOutcome; path: string; cards?: string[]; error?: string };
				assert.deepStrictEqual(response, outcome === 'succeeded'
					? { version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION, type: 'generate', ok: true, outcome, path: 'shots/image.png', cards: ['shots/image.png', 'shots/image-2.png'] }
					: { version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION, type: 'generate', ok: false, outcome, path: 'shots/image.png', error: 'Choose a model to generate.' });
			} finally {
				server.dispose();
			}
		}
	});

	test('rejects a generate response that is not the one of a started generation or a plain refusal', async () => {
		const started = { version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION, type: 'generate', ok: true, outcome: 'succeeded', path: 'shot.mp4', cards: ['shot.mp4'] };
		const variants = [
			// The retired answer of --run-node.
			{ version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION, type: 'runNode', ok: true, outcome: 'succeeded', nodePath: 'shot.bhnode' },
			{ ...started, cards: [] },
			{ ...started, cards: Array.from({ length: 17 }, (_, index) => `shot-${index + 1}.png`) },
			{ ...started, cards: [42] },
			{ ...started, error: 'Not both.' },
			{ ...started, result: { source: 'attempt', attemptId: 'attempt-1', artifactPath: 'outputs/x.mp4' } },
			{ ...started, ok: false, outcome: 'failed' },
			{ ...started, ok: false },
			{ version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION, type: 'generate', ok: false, outcome: 'rejected', path: 'shot.mp4' },
			{ version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION, type: 'generate', ok: false, outcome: 'rejected', path: 'shot.mp4', error: 'No.', cards: ['shot.mp4'] }
		];
		const outcomes: string[] = [];
		for (const variant of variants) {
			const server = new BaseHalfNodeCommandServer(async () => variant as unknown as IBaseHalfNodeCommandResponse, new NullLogService());
			try {
				await server.start();
				const response = await requestBaseHalfNodeCommand(server.ipcHandlePath, {
					version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
					type: 'generate',
					cwd: '/work',
					relativePath: 'shot.mp4'
				});
				outcomes.push(`${response.outcome}: ${response.error}`);
			} finally {
				server.dispose();
			}
		}
		assert.deepStrictEqual(outcomes, variants.map(() => 'rejected: Command response does not match the supported protocol.'));
	});

	test('CLI rejects a missing card path with one JSON line and a non-zero exit code', async () => {
		for (const args of [['--generate'], ['--generate', '--list-capabilities']]) {
			const result = await runCli(undefined, args);
			assert.strictEqual(result.exitCode, 1);
			assert.strictEqual(result.stdout.trim().split('\n').length, 1);
			const response = JSON.parse(result.stdout) as { type: string; outcome: BaseHalfGenerateCommandOutcome; path: string };
			assert.deepStrictEqual([response.type, response.outcome, response.path], ['generate', 'rejected', ''], args.join(' '));
		}
	});

	test('CLI rejects valid requests when no Agent Area hook is present', async () => {
		const generateResult = await runCli(undefined, ['--generate', 'shot.mp4']);
		assert.strictEqual(generateResult.exitCode, 1);
		assert.deepStrictEqual(JSON.parse(generateResult.stdout), {
			version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
			type: 'generate',
			ok: false,
			outcome: 'rejected',
			path: 'shot.mp4',
			error: 'Generating is available only inside a BaseHalf Agent Area terminal.'
		});

		const operationResult = await runCli(undefined, ['--run-operation', JSON.stringify({
			operationId: 'studio.workflow.sequence-inspect',
			parameters: { sequence: 'workflow/sequence.json' }
		})]);
		assert.strictEqual(operationResult.exitCode, 1);
		assert.strictEqual((JSON.parse(operationResult.stdout) as { outcome: string }).outcome, 'rejected');

		const discoveryResult = await runCli(undefined, ['--list-capabilities']);
		assert.strictEqual(discoveryResult.exitCode, 1);
		assert.strictEqual((JSON.parse(discoveryResult.stdout) as { outcome: string }).outcome, 'rejected');
	});

	test('carries one reviewed operation request and response without exposing another endpoint', async () => {
		const server = new BaseHalfNodeCommandServer(async request => {
			assert.strictEqual(request.type, 'runOperation');
			if (request.type !== 'runOperation') {
				throw new Error('Unexpected request type.');
			}
			assert.deepStrictEqual(request.parameters, { sequence: 'workflow/sequence.json', count: 2 });
			return {
				version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
				type: 'runOperation',
				ok: true,
				outcome: 'succeeded',
				operationId: request.operationId,
				result: { updated: 2 }
			};
		}, new NullLogService());
		try {
			await server.start();
			const response = await requestBaseHalfNodeCommand(server.ipcHandlePath, {
				version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
				type: 'runOperation',
				cwd: '/work',
				operationId: 'studio.workflow.sequence-update',
				parameters: { sequence: 'workflow/sequence.json', count: 2 }
			});
			assert.strictEqual(response.outcome, 'succeeded');
			assert.deepStrictEqual(response.result, { updated: 2 });

			const mismatched = await rawRequest(server.ipcHandlePath, '/generate', JSON.stringify({
				version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
				type: 'runOperation',
				cwd: '/work',
				operationId: 'studio.workflow.sequence-update',
				parameters: {}
			}));
			assert.strictEqual(mismatched.statusCode, 400);
			assert.strictEqual(mismatched.body.outcome, 'rejected');
		} finally {
			server.dispose();
		}
	});

	test('accepts cancellation as a terminal reviewed-operation outcome', async () => {
		const server = new BaseHalfNodeCommandServer(async request => {
			assert.strictEqual(request.type, 'runOperation');
			return {
				version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
				type: 'runOperation',
				ok: false,
				outcome: 'cancelled',
				operationId: request.type === 'runOperation' ? request.operationId : ''
			};
		}, new NullLogService());
		try {
			await server.start();
			const response = await requestBaseHalfNodeCommand(server.ipcHandlePath, {
				version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
				type: 'runOperation',
				cwd: '/work',
				operationId: 'studio.workflow.sequence-inspect',
				parameters: { sequence: 'workflow/sequence.json' }
			});
			assert.strictEqual(response.outcome, 'cancelled');
			assert.strictEqual(response.ok, false);
		} finally {
			server.dispose();
		}
	});

	test('CLI accepts exactly one JSON operation request and returns exactly one JSON response', async () => {
		const server = new BaseHalfNodeCommandServer(async request => {
			if (request.type !== 'runOperation') {
				throw new Error('Unexpected request type.');
			}
			return {
				version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
				type: 'runOperation',
				ok: true,
				outcome: 'succeeded',
				operationId: request.operationId,
				result: { accepted: request.parameters }
			};
		}, new NullLogService());
		try {
			await server.start();
			const payload = JSON.stringify({ operationId: 'studio.workflow.sequence-inspect', parameters: { sequence: 'workflow/sequence.json' } });
			const result = await runCli(server.ipcHandlePath, ['--run-operation', payload]);
			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(result.stdout.trim().split('\n').length, 1);
			const response = JSON.parse(result.stdout) as { outcome: string; operationId: string };
			assert.strictEqual(response.outcome, 'succeeded');
			assert.strictEqual(response.operationId, 'studio.workflow.sequence-inspect');
		} finally {
			server.dispose();
		}

		for (const args of [
			['--run-operation'],
			['--run-operation', '{'],
			['--run-operation', JSON.stringify({ operationId: 'studio.workflow.sequence-inspect', parameters: {}, extra: true })]
		]) {
			const result = await runCli(undefined, args);
			assert.strictEqual(result.exitCode, 1);
			assert.strictEqual((JSON.parse(result.stdout) as { outcome: string }).outcome, 'rejected');
		}
		const valuedDiscovery = await runCli(undefined, ['--list-capabilities=unexpected']);
		assert.strictEqual(valuedDiscovery.exitCode, 1);
		assert.strictEqual((JSON.parse(valuedDiscovery.stdout) as { outcome: string }).outcome, 'rejected');
	});

	test('CLI discovers host and extension capabilities through the private bridge without internal dispatch metadata', async () => {
		const server = new BaseHalfNodeCommandServer(async request => {
			assert.strictEqual(request.type, 'listCapabilities');
			return capabilityDiscoveryResponse({
				extensions: [{
					id: 'studio.workflow.capability',
					label: 'Workflow tools',
					description: 'Reviewed local workflow operations.',
					documents: [{
						kind: 'studio.workflow.sequence',
						version: 1,
						fileExtensions: ['.json'],
						schemaSummary: 'An ordered list of exact result references.'
					}],
					operations: [{
						id: 'studio.workflow.sequence-inspect',
						description: 'Inspect Sequence.',
						deterministic: true,
						parameters: [{ name: 'sequence', type: 'uri', required: true, description: 'Sequence path.' }],
						returns: { type: 'object', description: 'Inspection.' }
					}]
				}]
			});
		}, new NullLogService());
		try {
			await server.start();
			const result = await runCli(server.ipcHandlePath, ['--list-capabilities']);
			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(result.stdout.trim().split('\n').length, 1);
			const response = JSON.parse(result.stdout) as { type: string; extensions: readonly unknown[]; host: Record<string, any> };
			assert.strictEqual(response.type, 'listCapabilities');
			assert.strictEqual(Object.hasOwn(response, 'recipes'), false);
			assert.deepStrictEqual(Object.keys(response.host), ['generationCards', 'contextEdge', 'templates', 'operations', 'modelCatalog']);
			assert.deepStrictEqual([response.host.generationCards.authoring.contractVersion, response.host.generationCards.generateCommand], [5, 'basehalf --generate <workspace-relative-path>']);
			assert.deepStrictEqual(response.host.modelCatalog.providers.map((provider: { id: string }) => provider.id), ['acme']);
			assert.strictEqual(response.extensions.length, 1);
			assert.strictEqual(result.stdout.includes('command'), false);
			assert.strictEqual(result.stdout.includes('extensionId'), false);

			const extraField = await rawRequest(server.ipcHandlePath, '/list-capabilities', JSON.stringify({
				version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
				type: 'listCapabilities',
				cwd: '/work',
				extra: true
			}));
			assert.strictEqual(extraField.statusCode, 400);
			assert.strictEqual(extraField.body.type, 'listCapabilities');

			const tooLarge = await rawRequest(server.ipcHandlePath, '/list-capabilities', JSON.stringify({
				version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
				type: 'listCapabilities',
				cwd: `/${'x'.repeat(20 * 1024)}`
			}));
			assert.strictEqual(tooLarge.statusCode, 413);
			assert.strictEqual(tooLarge.body.type, 'listCapabilities');

			const mismatched = await rawRequest(server.ipcHandlePath, '/run-operation', JSON.stringify({
				version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
				type: 'listCapabilities',
				cwd: '/work'
			}));
			assert.strictEqual(mismatched.statusCode, 400);
			assert.strictEqual(mismatched.body.type, 'listCapabilities');
		} finally {
			server.dispose();
		}
	});

	test('replaces an oversized discovery payload with a bounded rejection', async () => {
		const extensions = Array.from({ length: 20 }, (_, capabilityIndex) => ({
			id: `studio.workflow.capability-${capabilityIndex}`,
			label: 'Workflow tools',
			documents: [],
			operations: Array.from({ length: 64 }, (_, operationIndex) => ({
				id: `studio.workflow.operation-${capabilityIndex}-${operationIndex}`,
				description: 'x'.repeat(500),
				deterministic: true as const,
				parameters: [],
				returns: { type: 'object' as const, description: 'x'.repeat(500) }
			}))
		}));
		const server = new BaseHalfNodeCommandServer(async () => capabilityDiscoveryResponse({ extensions }), new NullLogService());
		try {
			await server.start();
			const response = await requestBaseHalfNodeCommand(server.ipcHandlePath, {
				version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
				type: 'listCapabilities',
				cwd: '/work'
			});
			assert.strictEqual(response.outcome, 'rejected');
			assert.strictEqual(response.extensions, undefined);
			assert.strictEqual(response.error, 'Command response is too large.');
		} finally {
			server.dispose();
		}
	});

	test('rejects discovery responses with undeclared fields before returning them to the CLI', async () => {
		const server = new BaseHalfNodeCommandServer(async () => capabilityDiscoveryResponse({
			extensions: [{
				id: 'studio.workflow.capability',
				label: 'Workflow tools',
				documents: [],
				operations: [],
				extensionId: 'studio.workflow'
			} as unknown as IBaseHalfAgentCapabilityDiscoveryExtension]
		}) as unknown as IBaseHalfNodeCommandResponse, new NullLogService());
		try {
			await server.start();
			const result = await runCli(server.ipcHandlePath, ['--list-capabilities']);
			assert.strictEqual(result.exitCode, 1);
			const response = JSON.parse(result.stdout) as { type: string; outcome: string };
			assert.strictEqual(response.type, 'listCapabilities');
			assert.strictEqual(response.outcome, 'rejected');
		} finally {
			server.dispose();
		}
	});

	test('rejects discovery responses that describe recipes, node documents, the retired catalog key, or the pre-D37 reference storage', async () => {
		const current = capabilityDiscoveryResponse();
		const host = current.host!;
		const legacyContextEdge: Record<string, unknown> = { ...host.contextEdge };
		for (const key of ['storedBy', 'markdownFrontmatterKey']) {
			delete legacyContextEdge[key];
		}
		const { modelCatalog, ...withoutCatalog } = host;
		const cards = host.generationCards;
		const variants = [
			{ ...current, recipes: [] },
			// The `.bhnode` contract and its edge literals are gone (D63).
			{ ...current, host: { ...host, nodeDocument: { fileExtension: '.bhnode', documentVersion: 6 } } },
			{ ...current, host: { ...host, contextEdge: { ...host.contextEdge, resultNodeSource: 'node-result' } } },
			{ ...current, host: { ...host, contextEdge: { ...host.contextEdge, nodeDocumentField: 'upstream' } } },
			{ ...current, host: { ...withoutCatalog, videoCatalog: modelCatalog } },
			{ ...current, host: { ...host, contextEdge: legacyContextEdge } },
			{ ...current, host: { ...host, contextEdge: { ...host.contextEdge, storedBy: 'both-ends' } } },
			// What an agent may write is stated exactly, and BaseHalf keeps what is its own.
			{ ...current, host: { ...host, generationCards: undefined } },
			{ ...current, host: { ...host, generationCards: { ...cards, generationFile: '.bh/mirror/<path>/node.yaml' } } },
			{ ...current, host: { ...host, generationCards: { ...cards, hostOwned: ['.bh/cache/generation/'] } } },
			{ ...current, host: { ...host, generationCards: { ...cards, generateCommand: 'basehalf --run-node <workspace-relative-.bhnode-path>' } } },
			{ ...current, host: { ...host, generationCards: { ...cards, fileExtensions: { ...cards.fileExtensions, video: ['.mp4', '.bhnode'] } } } },
			{ ...current, host: { ...host, generationCards: { ...cards, authoring: { ...cards.authoring, contractVersion: 4 } } } },
			{ ...current, host: { ...host, generationCards: { ...cards, authoring: { ...cards.authoring, hostOwnedFields: ['task', 'result'] } } } },
			{ ...current, host: { ...host, generationCards: { ...cards, authoring: { ...cards.authoring, rules: [] } } } },
			// The model catalog is always there, as a list of providers.
			{ ...current, host: { ...host, modelCatalog: undefined } },
			{ ...current, host: { ...host, modelCatalog: { providers: ['acme'] } } },
			{ ...current, host: { ...host, modelCatalog: { providers: [], credentials: { apiKey: 'x' } } } }
		];
		const outcomes: string[] = [];
		for (const variant of variants) {
			const server = new BaseHalfNodeCommandServer(async () => variant as unknown as IBaseHalfNodeCommandResponse, new NullLogService());
			try {
				await server.start();
				const response = await requestBaseHalfNodeCommand(server.ipcHandlePath, {
					version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
					type: 'listCapabilities',
					cwd: '/work'
				});
				outcomes.push(`${response.outcome}: ${response.error}`);
			} finally {
				server.dispose();
			}
		}
		assert.deepStrictEqual(outcomes, variants.map(() => 'rejected: Command response does not match the supported protocol.'));
	});

	test('releases an in-flight request promptly when terminal ownership ends', async () => {
		let notifyStarted: (() => void) | undefined;
		const started = new Promise<void>(resolve => notifyStarted = resolve);
		const server = new BaseHalfNodeCommandServer(async () => {
			notifyStarted?.();
			return new Promise(() => { });
		}, new NullLogService());
		try {
			await server.start();
			const responsePromise = requestBaseHalfNodeCommand(server.ipcHandlePath, {
				version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
				type: 'generate',
				cwd: '/work',
				relativePath: 'shot.mp4'
			});
			await started;
			server.dispose();
			const response = await promiseWithDeadline(responsePromise, 500);
			assert.strictEqual(response.outcome, 'rejected');
			assert.strictEqual(response.path, 'shot.mp4');
		} finally {
			server.dispose();
		}
	});

	test('cancels the in-flight callback when its client disconnects', async () => {
		let notifyStarted: (() => void) | undefined;
		let notifyCancelled: (() => void) | undefined;
		const started = new Promise<void>(resolve => notifyStarted = resolve);
		const cancelled = new Promise<void>(resolve => notifyCancelled = resolve);
		const server = new BaseHalfNodeCommandServer((request, cancellationToken) => {
			if (request.type !== 'generate') {
				throw new Error('Unexpected request type.');
			}
			notifyStarted?.();
			let listener: { dispose(): void } | undefined;
			return new Promise<IBaseHalfNodeCommandResponse>(resolve => {
				listener = cancellationToken.onCancellationRequested(() => {
					notifyCancelled?.();
					resolve({
						version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
						type: 'generate',
						ok: false,
						outcome: 'rejected',
						path: request.relativePath,
						error: 'The request was cancelled.'
					});
				});
			}).finally(() => listener?.dispose());
		}, new NullLogService());
		try {
			await server.start();
			const client = await startAbortableNodeRequest(server.ipcHandlePath);
			void client.completion.catch(() => undefined);
			await started;
			client.abort();
			await promiseWithDeadline(cancelled, 500);
		} finally {
			server.dispose();
		}
	});

	test('resolves the product CLI in development and packaged desktop layouts', () => {
		const developmentRoot = join('workspace', 'basehalf');
		const developmentCli = join(developmentRoot, 'bin', 'basehalf');
		assert.strictEqual(
			resolveBaseHalfCliDirectory(developmentRoot, 'basehalf', false, candidate => candidate === developmentCli),
			join(developmentRoot, 'bin')
		);

		const packagedRoot = join('install', 'resources', 'app');
		const packagedCli = join('install', 'bin', 'basehalf.cmd');
		assert.strictEqual(
			resolveBaseHalfCliDirectory(packagedRoot, 'basehalf', true, candidate => candidate === packagedCli),
			join('install', 'bin')
		);
		assert.strictEqual(resolveBaseHalfCliDirectory(packagedRoot, 'basehalf', false, () => false), undefined);
	});
});

function capabilityDiscoveryResponse(options: {
	readonly extensions?: readonly IBaseHalfAgentCapabilityDiscoveryExtension[];
	readonly modelCatalog?: IBaseHalfAgentCapabilityDiscoveryModelCatalog;
} = {}): IBaseHalfAgentCapabilityDiscoveryResponse {
	return {
		version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
		type: 'listCapabilities',
		ok: true,
		outcome: 'succeeded',
		host: {
			generationCards: {
				fileExtensions: BASEHALF_AGENT_DISCOVERY_GENERATION_EXTENSIONS,
				generationFile: BASEHALF_AGENT_DISCOVERY_GENERATION_FILE,
				inputsFile: BASEHALF_AGENT_DISCOVERY_INPUTS_FILE,
				hostOwned: BASEHALF_AGENT_DISCOVERY_HOST_OWNED,
				generateCommand: BASEHALF_AGENT_DISCOVERY_GENERATE_COMMAND,
				authoring: {
					contractVersion: 5,
					schema: { type: 'object' },
					examples: {},
					rules: ['In generation.yaml write only prompt, provider, model, mode, and params.']
				}
			},
			contextEdge: {
				source: 'direct-content',
				target: 'direct-context',
				autoRun: false,
				recursive: false,
				storedBy: 'downstream',
				markdownFrontmatterKey: 'upstream',
				inputOrder: 'target-upstream-order',
				label: 'none'
			},
			templates: [],
			operations: [],
			modelCatalog: options.modelCatalog ?? { providers: [{ id: 'acme', label: 'Acme Video', setUp: false, region: 'east', regions: [], models: [] }] }
		},
		extensions: options.extensions ?? []
	};
}

function promiseWithDeadline<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`Request did not settle within ${milliseconds}ms.`)), milliseconds);
		promise.then(
			value => {
				clearTimeout(timer);
				resolve(value);
			},
			error => {
				clearTimeout(timer);
				reject(error);
			}
		);
	});
}

async function runCli(ipcHandlePath: string | undefined, args: readonly string[] = ['--generate', 'shots/image.png']): Promise<{ exitCode: number | null; stdout: string }> {
	const cliPath = join(FileAccess.asFileUri('').fsPath, 'cli.js');
	return new Promise((resolve, reject) => {
		const env = { ...process.env };
		if (ipcHandlePath === undefined) {
			delete env[BASEHALF_NODE_COMMAND_BRIDGE_HOOK_ENV];
		} else {
			env[BASEHALF_NODE_COMMAND_BRIDGE_HOOK_ENV] = ipcHandlePath;
		}
		const child = spawn(process.execPath, [cliPath, ...args], {
			env
		});
		const stdout: Buffer[] = [];
		child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
		child.on('error', reject);
		child.on('exit', exitCode => resolve({ exitCode, stdout: Buffer.concat(stdout).toString('utf8') }));
	});
}

async function rawRequest(socketPath: string, path: string, body: string): Promise<{ statusCode: number | undefined; body: Record<string, unknown> }> {
	const http = await import('http');
	return new Promise((resolve, reject) => {
		const request = http.request({
			socketPath,
			path,
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'content-length': Buffer.byteLength(body)
			}
		}, response => {
			const chunks: Buffer[] = [];
			response.on('data', (chunk: Buffer) => chunks.push(chunk));
			response.on('error', reject);
			response.on('end', () => {
				resolve({
					statusCode: response.statusCode,
					body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
				});
			});
		});
		request.on('error', reject);
		request.end(body);
	});
}

async function startAbortableNodeRequest(socketPath: string): Promise<{ abort(): void; completion: Promise<void> }> {
	const http = await import('http');
	const body = JSON.stringify({
		version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
		type: 'generate',
		cwd: '/work',
		relativePath: 'shot.mp4'
	});
	let request: import('http').ClientRequest | undefined;
	const completion = new Promise<void>((resolve, reject) => {
		request = http.request({
			socketPath,
			path: '/generate',
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'content-length': Buffer.byteLength(body)
			}
		}, response => {
			response.resume();
			response.on('end', resolve);
			response.on('error', reject);
		});
		request.on('error', reject);
		request.end(body);
	});
	return { abort: () => request?.destroy(), completion };
}
