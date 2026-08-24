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
import { BASEHALF_NODE_COMMAND_BRIDGE_HOOK_ENV, BASEHALF_NODE_COMMAND_BRIDGE_VERSION, BaseHalfNodeCommandOutcome, IBaseHalfAgentCapabilityDiscoveryExtension, IBaseHalfAgentCapabilityDiscoveryRecipe, IBaseHalfAgentCapabilityDiscoveryResponse, IBaseHalfNodeCommandResponse } from '../../common/terminal.js';
import { BaseHalfNodeCommandServer, requestBaseHalfNodeCommand, resolveBaseHalfCliDirectory } from '../../node/basehalfNodeCommandBridge.js';

suite('BaseHalfNodeCommandServer', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('accepts only the fixed run-node protocol over its private socket', async () => {
		let calls = 0;
		const server = new BaseHalfNodeCommandServer(async request => {
			calls++;
			assert.strictEqual(request.type, 'runNode');
			if (request.type !== 'runNode') {
				throw new Error('Unexpected request type.');
			}
			return {
				version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
				ok: true,
				outcome: 'succeeded',
				nodePath: request.relativePath,
				attempt: { id: 'attempt-1', status: 'succeeded' },
				result: { source: 'attempt', attemptId: 'attempt-1', artifactPath: 'outputs/node/attempt-1/video.mp4' }
			};
		}, new NullLogService());

		try {
			await server.start();
			if (process.platform !== 'win32') {
				assert.strictEqual(fs.statSync(server.ipcHandlePath).mode & 0o777, 0o600);
			}
			const response = await requestBaseHalfNodeCommand(server.ipcHandlePath, {
				version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
				type: 'runNode',
				cwd: '/work',
				relativePath: 'shot.bhnode'
			});
			assert.strictEqual(response.outcome, 'succeeded');
			assert.strictEqual(response.nodePath, 'shot.bhnode');
			assert.strictEqual(calls, 1);

			const unsupported = await rawRequest(server.ipcHandlePath, '/command', '{}');
			assert.strictEqual(unsupported.statusCode, 404);
			assert.strictEqual(unsupported.body.outcome, 'rejected');
			assert.strictEqual(calls, 1);
		} finally {
			server.dispose();
		}
		if (process.platform !== 'win32') {
			assert.strictEqual(fs.existsSync(server.ipcHandlePath), false);
		}
	});

	test('CLI prints one JSON response and maps the final outcome to its exit code', async () => {
		for (const [outcome, expectedExitCode] of [['succeeded', 0], ['failed', 1]] as const) {
			const server = new BaseHalfNodeCommandServer(async request => ({
				version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
				ok: outcome === 'succeeded',
				outcome,
				nodePath: request.type === 'runNode' ? request.relativePath : '',
				attempt: { id: 'attempt-1', status: outcome },
				...(outcome === 'succeeded'
					? { result: { source: 'attempt' as const, attemptId: 'attempt-1', artifactPath: 'outputs/node/attempt-1/video.mp4' } }
					: {})
			}), new NullLogService());
			try {
				await server.start();
				const result = await runCli(server.ipcHandlePath);
				assert.strictEqual(result.exitCode, expectedExitCode);
				assert.strictEqual(result.stdout.trim().split('\n').length, 1);
				const response = JSON.parse(result.stdout) as { outcome: BaseHalfNodeCommandOutcome; nodePath: string };
				assert.strictEqual(response.outcome, outcome);
				assert.strictEqual(response.nodePath, 'shot.bhnode');
			} finally {
				server.dispose();
			}
		}
	});

	test('CLI rejects a missing node path with one JSON response and a non-zero exit code', async () => {
		const result = await runCli(undefined, ['--run-node']);
		assert.strictEqual(result.exitCode, 1);
		assert.strictEqual(result.stdout.trim().split('\n').length, 1);
		const response = JSON.parse(result.stdout) as { outcome: BaseHalfNodeCommandOutcome; nodePath: string };
		assert.strictEqual(response.outcome, 'rejected');
		assert.strictEqual(response.nodePath, '');
	});

	test('CLI rejects valid requests when no Agent Area hook is present', async () => {
		const nodeResult = await runCli(undefined, ['--run-node', 'shot.bhnode']);
		assert.strictEqual(nodeResult.exitCode, 1);
		assert.strictEqual((JSON.parse(nodeResult.stdout) as { outcome: string }).outcome, 'rejected');

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

			const mismatched = await rawRequest(server.ipcHandlePath, '/run-node', JSON.stringify({
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

	test('CLI discovers host, recipe, and extension capabilities through the private bridge without internal dispatch metadata', async () => {
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
				}],
				recipes: [sampleRecipe]
			});
		}, new NullLogService());
		try {
			await server.start();
			const result = await runCli(server.ipcHandlePath, ['--list-capabilities']);
			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(result.stdout.trim().split('\n').length, 1);
			const response = JSON.parse(result.stdout) as { type: string; recipes: readonly unknown[]; extensions: readonly unknown[] };
			assert.strictEqual(response.type, 'listCapabilities');
			assert.strictEqual(response.recipes.length, 1);
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
				type: 'runNode',
				cwd: '/work',
				relativePath: 'shot.bhnode'
			});
			await started;
			server.dispose();
			const response = await promiseWithDeadline(responsePromise, 500);
			assert.strictEqual(response.outcome, 'rejected');
			assert.strictEqual(response.nodePath, 'shot.bhnode');
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
			if (request.type !== 'runNode') {
				throw new Error('Unexpected request type.');
			}
			notifyStarted?.();
			let listener: { dispose(): void } | undefined;
			return new Promise<IBaseHalfNodeCommandResponse>(resolve => {
				listener = cancellationToken.onCancellationRequested(() => {
					notifyCancelled?.();
					resolve({
						version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
						ok: false,
						outcome: 'cancelled',
						nodePath: request.relativePath,
						attempt: { id: 'run-1', status: 'cancelled' }
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

const sampleRecipe: IBaseHalfAgentCapabilityDiscoveryRecipe = {
	id: 'studio.workflow.render-image',
	label: 'Render image',
	description: 'Create one image from direct context.',
	modelCapability: 'image',
	inputs: [{ id: 'prompt', label: 'Prompt', accepts: ['text'], minItems: 1, maxItems: 1 }],
	parameters: [{ id: 'quality', label: 'Quality', type: 'enum', default: 'standard', options: [{ value: 'standard', label: 'Standard' }] }],
	outputs: [{ id: 'image', kind: 'image', extensions: ['.png'], minItems: 1, maxItems: 1, primary: true }]
};

function capabilityDiscoveryResponse(options: {
	readonly recipes?: readonly IBaseHalfAgentCapabilityDiscoveryRecipe[];
	readonly extensions?: readonly IBaseHalfAgentCapabilityDiscoveryExtension[];
} = {}): IBaseHalfAgentCapabilityDiscoveryResponse {
	return {
		version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
		type: 'listCapabilities',
		ok: true,
		outcome: 'succeeded',
		host: {
			nodeDocument: {
				fileExtension: '.bhnode',
				documentVersion: 3,
				resultKinds: ['file', 'image', 'video', 'audio', 'pdf', 'presentation'],
				inputBinding: { scope: 'direct-inbound-reference', fields: ['sourcePath', 'slot', 'order'] },
				lifecycle: { attempts: 'host-owned', result: 'host-owned-single-file', retry: 'frozen-only' },
				runCommand: 'basehalf --run-node <workspace-relative-.bhnode-path>',
				authoring: {
					contractVersion: 1,
					schema: { type: 'object' },
					examples: {},
					hostOwnedFields: ['result', 'attempts'],
					rules: ['Write only the published authorable fields.']
				}
			},
			contextEdge: {
				source: 'direct-content',
				resultNodeSource: 'sealed-result',
				target: 'direct-context',
				autoRun: false,
				recursive: false,
				roleAndOrderOwner: 'target-recipe-binding',
				label: 'none'
			},
			templates: [],
			operations: []
		},
		recipes: options.recipes ?? [],
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

async function runCli(ipcHandlePath: string | undefined, args: readonly string[] = ['--run-node', 'shot.bhnode']): Promise<{ exitCode: number | null; stdout: string }> {
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
		type: 'runNode',
		cwd: '/work',
		relativePath: 'shot.bhnode'
	});
	let request: import('http').ClientRequest | undefined;
	const completion = new Promise<void>((resolve, reject) => {
		request = http.request({
			socketPath,
			path: '/run-node',
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
