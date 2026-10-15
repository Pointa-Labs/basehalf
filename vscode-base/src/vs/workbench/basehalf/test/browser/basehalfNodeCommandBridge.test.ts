/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Event } from '../../../../base/common/event.js';
import { extUri } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { FileOperationError, FileOperationResult, IFileService } from '../../../../platform/files/common/files.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { BASEHALF_NODE_COMMAND_BRIDGE_VERSION, IBaseHalfAgentOperationCommandRequest, IBaseHalfNodeCommandRequestEvent } from '../../../../platform/terminal/common/terminal.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkingCopyService } from '../../../services/workingCopy/common/workingCopyService.js';
import { BaseHalfNodeCommandBackendGeneration } from '../../browser/basehalfNodeCommandBridge.contribution.js';
import { BaseHalfNodeCommandHandler } from '../../browser/basehalfNodeCommandHandler.js';
import { IBaseHalfAgentAreaService } from '../../common/basehalfAgentArea.js';
import { IBaseHalfAgentCapabilityRegistryService } from '../../common/basehalfAgentCapabilities.js';
import { IBaseHalfCanvasTemplateRegistryService } from '../../common/basehalfCanvasTemplateRegistry.js';
import { createBaseHalfNodeDocument, serializeBaseHalfNodeDocument } from '../../common/basehalfNodeDocument.js';
import { BaseHalfVideoGenerationError, IBaseHalfVideoGenerationService } from '../../common/basehalfVideoGeneration.js';
import { baseHalfNodeTestId } from '../common/basehalfNodeTestFixtures.js';

suite('BaseHalfNodeCommandBridge', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const workspaceFolder = URI.file('/work');

	test('invalidates old request ids when the pty host restarts', () => {
		const generation = new BaseHalfNodeCommandBackendGeneration();
		const oldGeneration = generation.current;
		const oldKey = generation.key(1);

		generation.restart();

		assert.strictEqual(generation.isCurrent(oldGeneration), false);
		assert.notStrictEqual(generation.key(1), oldKey);
		assert.strictEqual(generation.isCurrent(generation.current), true);
	});

	test('starts the generation of a verified Agent Area Video node and prints the path of the node that runs', async () => {
		const harness = createHarness();
		const response = await harness.handler.handle(requestEvent('/work/scenes', 'scenes/shot.bhnode'));

		assert.deepStrictEqual(harness.generateCalls.map(resource => resource.path), ['/work/scenes/shot.bhnode']);
		assert.deepStrictEqual(response, {
			version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
			type: 'runNode',
			ok: true,
			outcome: 'succeeded',
			nodePath: 'scenes/shot.bhnode'
		});
	});

	test('finds the command directory of a workspace opened through a link by its real path', async () => {
		// The shell reports /private/work/scenes for /work/scenes, as macOS does under /tmp and /var.
		const harness = createHarness({ linkedFrom: '/private' });
		const response = await harness.handler.handle(requestEvent('/private/work/scenes', 'scenes/shot.bhnode'));
		const outside = await harness.handler.handle(requestEvent('/private/elsewhere', 'scenes/shot.bhnode'));
		assert.deepStrictEqual({
			generated: harness.generateCalls.map(resource => resource.path),
			response: response?.type === 'runNode' ? [response.ok, response.ok ? response.nodePath : undefined] : response,
			outside: outside?.ok
		}, {
			generated: ['/work/scenes/shot.bhnode'],
			response: [true, 'scenes/shot.bhnode'],
			outside: false
		});
	});

	test('prints the path of the new node when the node already held a video', async () => {
		const harness = createHarness({ generated: URI.file('/work/scenes/shot-2.bhnode') });
		const response = await harness.handler.handle(requestEvent('/work/scenes', 'scenes/shot.bhnode'));
		assert.deepStrictEqual([response?.outcome, response?.type === 'runNode' ? response.nodePath : undefined], ['succeeded', 'scenes/shot-2.bhnode']);
	});

	test('ignores unknown processes but promptly rejects a released Agent Area process', async () => {
		const wrongProcess = createHarness({ ownership: 'unknown' });
		assert.strictEqual(await wrongProcess.handler.handle(requestEvent('/work', 'shot.bhnode')), undefined);
		assert.strictEqual(wrongProcess.generateCalls.length, 0);

		const releasedProcess = createHarness({ ownership: 'released' });
		assert.strictEqual((await releasedProcess.handler.handle(requestEvent('/work', 'shot.bhnode')))?.outcome, 'rejected');
		assert.strictEqual(releasedProcess.generateCalls.length, 0);

		const wrongWorkspace = createHarness();
		assert.strictEqual(await wrongWorkspace.handler.handle({ ...requestEvent('/work', 'shot.bhnode'), workspaceId: 'other' }), undefined);
		assert.strictEqual(wrongWorkspace.generateCalls.length, 0);
	});

	test('rejects dirty, non-portable, non-node, and symbolic-link targets before generating', async () => {
		for (const [event, options] of [
			[requestEvent('/work', 'dirty.bhnode'), { dirty: true }],
			[requestEvent('/work', '../outside.bhnode'), {}],
			[requestEvent('/work', 'notes.md'), {}],
			[requestEvent('/work', 'linked/shot.bhnode'), { symbolicLinkPath: '/work/linked' }]
		] as const) {
			const harness = createHarness(options);
			const response = await harness.handler.handle(event);
			assert.strictEqual(response?.outcome, 'rejected');
			assert.strictEqual(harness.generateCalls.length, 0);
		}
	});

	test('rejects a node that is not a Video node or cannot be read, without generating', async () => {
		const image = serializeBaseHalfNodeDocument(createBaseHalfNodeDocument({ id: baseHalfNodeTestId(2), kind: 'image', title: 'Frame' }));
		const legacy = JSON.stringify({ version: 4, id: baseHalfNodeTestId(3), kind: 'video', title: 'Old', role: 'Clip', prompt: '', upstream: [], attempts: [] });
		for (const [source, message] of [[image, /Only a Video node runs; 'shot\.bhnode' is not a Video node/], [legacy, /can't be read: document\.version 4 is no longer supported/]] as const) {
			const harness = createHarness({ nodeSource: source });
			const response = await harness.handler.handle(requestEvent('/work', 'shot.bhnode'));
			assert.strictEqual(response?.outcome, 'rejected');
			assert.match(response?.error ?? '', message);
			assert.strictEqual(harness.generateCalls.length, 0);
		}
	});

	test('reports a generation the node cannot start as rejected, with its reason', async () => {
		const harness = createHarness({ generationError: new BaseHalfVideoGenerationError('Choose a model first.') });
		const response = await harness.handler.handle(requestEvent('/work', 'shot.bhnode'));
		assert.deepStrictEqual([response?.ok, response?.outcome, response?.error], [false, 'rejected', 'Choose a model first.']);
	});

	test('keeps a started generation running when the Agent bridge disconnects', async () => {
		let settleGeneration: ((resource: URI) => void) | undefined;
		const generationPromise = new Promise<URI>(resolve => settleGeneration = resolve);
		const harness = createHarness({ generationPromise });
		const cancellation = new CancellationTokenSource();
		try {
			const responsePromise = harness.handler.handle(requestEvent('/work', 'shot.bhnode'), cancellation.token);
			await harness.generationStarted;
			cancellation.cancel();
			settleGeneration?.(URI.file('/work/shot.bhnode'));
			const response = await responsePromise;
			assert.deepStrictEqual([response?.outcome, response?.type === 'runNode' ? response.nodePath : undefined], ['succeeded', 'shot.bhnode']);
			assert.deepStrictEqual(harness.stopCalls, []);
		} finally {
			cancellation.dispose();
		}
	});

	test('executes only an installed reviewed operation with validated typed parameters', async () => {
		const harness = createHarness({ reviewedOperation: true, commandResult: { count: 1 } });
		const response = await harness.handler.handle(operationEvent('studio.workflow.sequence-inspect', {
			sequence: 'workflow/sequence.json',
			limit: 4,
			strict: true,
			mode: 'current'
		}));
		assert.strictEqual(response?.type, 'runOperation');
		if (response?.type !== 'runOperation') {
			throw new Error('Expected an operation response.');
		}
		assert.strictEqual(response.outcome, 'succeeded');
		assert.deepStrictEqual(response.result, { count: 1 });
		assert.strictEqual(harness.commandCalls.length, 1);
		assert.strictEqual(harness.commandCalls[0].id, 'studio.workflow.inspectSequence');
		const argument = harness.commandCalls[0].argument as Record<string, unknown>;
		assert.strictEqual((argument.sequence as URI).toString(), URI.file('/work/workflow/sequence.json').toString());
		assert.deepStrictEqual({ ...argument, sequence: undefined }, {
			sequence: undefined,
			limit: 4,
			strict: true,
			mode: 'current'
		});
		assert.strictEqual(harness.commandCalls[0].cancellationToken, CancellationToken.None);
	});

	test('lists the host contract, the admitted templates, and public reviewed extension metadata after verifying Agent Area ownership and cwd', async () => {
		const harness = createHarness({ reviewedOperation: true, templates: ['studio.workflow.starter'] });
		const response = await harness.handler.handle(operationDiscoveryEvent());
		assert.strictEqual(response?.type, 'listCapabilities');
		if (response?.type !== 'listCapabilities') {
			throw new Error('Expected a capability discovery response.');
		}
		assert.strictEqual(response.outcome, 'succeeded');
		assert.deepStrictEqual(Object.keys(response.host?.nodeDocument ?? {}), ['fileExtension', 'documentVersion', 'nodeKinds', 'lifecycle', 'runCommand', 'authoring']);
		assert.strictEqual(response.host?.nodeDocument.fileExtension, '.bhnode');
		assert.deepStrictEqual(response.host?.nodeDocument.nodeKinds, ['file', 'image', 'video', 'audio', 'pdf', 'presentation']);
		assert.deepStrictEqual(response.host?.contextEdge, {
			source: 'direct-content',
			resultNodeSource: 'node-result',
			target: 'direct-context',
			autoRun: false,
			recursive: false,
			storedBy: 'downstream',
			markdownFrontmatterKey: 'upstream',
			nodeDocumentField: 'upstream',
			inputOrder: 'target-upstream-order',
			label: 'none'
		});
		assert.deepStrictEqual({
			documentVersion: response.host?.nodeDocument.documentVersion,
			contractVersion: response.host?.nodeDocument.authoring.contractVersion,
			hostOwnedFields: response.host?.nodeDocument.authoring.hostOwnedFields,
			runCommand: response.host?.nodeDocument.runCommand
		}, {
			documentVersion: 5,
			contractVersion: 3,
			hostOwnedFields: ['task', 'result'],
			runCommand: 'basehalf --run-node <workspace-relative-.bhnode-path>'
		});
		assert.deepStrictEqual(response.host?.nodeDocument.lifecycle, {
			task: 'host-owned',
			result: 'host-owned-single-file'
		});
		assert.deepStrictEqual(response.host?.operations.map(operation => operation.id), ['basehalf.canvas.create-from-template']);
		assert.deepStrictEqual(response.host?.templates, [{ id: 'studio.workflow.starter', label: 'starter' }]);
		assert.deepStrictEqual(response.host?.operations[0].parameters[0].values, ['studio.workflow.starter']);
		assert.strictEqual(Object.hasOwn(response, 'recipes'), false);
		assert.strictEqual(response.extensions?.length, 1);
		assert.deepStrictEqual(response.extensions?.[0], {
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
				parameters: [
					{ name: 'sequence', type: 'uri', required: true, description: 'Sequence path.' },
					{ name: 'limit', type: 'integer', required: true, description: 'Maximum.' },
					{ name: 'strict', type: 'boolean', required: true, description: 'Strict mode.' },
					{ name: 'mode', type: 'enum', required: true, description: 'Pin mode.', values: ['current', 'exact'] }
				],
				returns: { type: 'object', description: 'Inspection.' }
			}]
		});
		const serialized = JSON.stringify(response);
		assert.doesNotMatch(serialized, /recipe|binding|attempt/i);
		assert.strictEqual(serialized.includes('studio.workflow.inspectSequence'), false);
		assert.strictEqual(serialized.includes('extensionId'), false);
		assert.strictEqual(serialized.includes('/work'), false);
		assert.strictEqual(serialized.toLowerCase().includes('secret'), false);
		assert.strictEqual(serialized.includes('basehalf.canvas.create-from-template'), true);
		assert.strictEqual(harness.commandCalls.length, 0);

		const outside = await harness.handler.handle(operationDiscoveryEvent('/outside'));
		assert.strictEqual(outside?.outcome, 'rejected');
		const unknown = createHarness({ ownership: 'unknown', reviewedOperation: true });
		assert.strictEqual(await unknown.handler.handle(operationDiscoveryEvent()), undefined);
		const withoutTemplates = await createHarness().handler.handle(operationDiscoveryEvent());
		assert.strictEqual(withoutTemplates?.type, 'listCapabilities');
		assert.deepStrictEqual(withoutTemplates?.type === 'listCapabilities' ? withoutTemplates.host?.operations.map(operation => operation.id) : undefined, []);
	});

	test('rejects operation discovery before serialization when the reviewed capability count exceeds the protocol bound', async () => {
		const harness = createHarness({ reviewedOperation: true, capabilityCount: 257 });
		const response = await harness.handler.handle(operationDiscoveryEvent());
		assert.strictEqual(response?.type, 'listCapabilities');
		assert.strictEqual(response?.outcome, 'rejected');
		assert.strictEqual(harness.commandCalls.length, 0);
	});

	test('rejects capability discovery when admitted templates exceed the bounded public contract', async () => {
		const harness = createHarness({ templateCount: 257 });
		const response = await harness.handler.handle(operationDiscoveryEvent());
		assert.strictEqual(response?.type, 'listCapabilities');
		assert.strictEqual(response?.outcome, 'rejected');
	});

	test('rejects undeclared operations, unknown parameters, bad types, and unsafe URI paths before command dispatch', async () => {
		for (const [operationId, parameters, options] of [
			['studio.workflow.not-reviewed', {}, { reviewedOperation: true }],
			['studio.workflow.sequence-inspect', { sequence: 'workflow/sequence.json', unknown: true }, { reviewedOperation: true }],
			['studio.workflow.sequence-inspect', { sequence: 'workflow/sequence.json', limit: 1.5, strict: true, mode: 'current' }, { reviewedOperation: true }],
			['studio.workflow.sequence-inspect', { sequence: '../outside.json', limit: 1, strict: true, mode: 'current' }, { reviewedOperation: true }],
			['studio.workflow.sequence-inspect', { sequence: 'linked/sequence.json', limit: 1, strict: true, mode: 'current' }, { reviewedOperation: true, symbolicLinkPath: '/work/linked' }]
		] as const) {
			const harness = createHarness(options);
			const response = await harness.handler.handle(operationEvent(operationId, parameters));
			assert.strictEqual(response?.outcome, 'rejected');
			assert.strictEqual(harness.commandCalls.length, 0);
		}
	});

	test('maps the host-reviewed template operation to the installed template and command directory', async () => {
		const harness = createHarness({ templates: ['studio.workflow.starter'], commandResult: { templateId: 'studio.workflow.starter', projectPath: 'Starter' } });
		const response = await harness.handler.handle(operationEvent('basehalf.canvas.create-from-template', {
			templateId: 'studio.workflow.starter'
		}, '/work/projects'));
		assert.strictEqual(response?.outcome, 'succeeded');
		assert.strictEqual(harness.commandCalls[0].id, 'basehalf.canvas.createFromTemplate');
		const argument = harness.commandCalls[0].argument as { templateId: string; targetFolder: URI };
		assert.strictEqual(argument.templateId, 'studio.workflow.starter');
		assert.strictEqual(argument.targetFolder.toString(), URI.file('/work/projects').toString());

		const rejected = createHarness({ templates: ['studio.workflow.starter'] });
		assert.strictEqual((await rejected.handler.handle(operationEvent('basehalf.canvas.create-from-template', {
			templateId: 'other.workflow.starter'
		})))?.outcome, 'rejected');
		assert.strictEqual(rejected.commandCalls.length, 0);
	});

	test('the retired move operation is refused: an agent moves files with its own tools', async () => {
		const harness = createHarness({ files: ['a.md'], commandResult: {} });
		const response = await harness.handler.handle(operationEvent('basehalf.workspace.move', { from: 'a.md', to: 'b.md' }));
		assert.deepStrictEqual({ outcome: response?.outcome, calls: harness.commandCalls.length }, { outcome: 'rejected', calls: 0 });
	});

	test('propagates cancellation into template creation and never reports a late command result as success', async () => {
		let settleCommand: ((value: unknown) => void) | undefined;
		const commandPromise = new Promise<unknown>(resolve => settleCommand = resolve);
		const harness = createHarness({ templates: ['studio.workflow.starter'], commandPromise });
		const cancellation = new CancellationTokenSource();
		try {
			const responsePromise = harness.handler.handle(operationEvent('basehalf.canvas.create-from-template', {
				templateId: 'studio.workflow.starter'
			}), cancellation.token);
			await harness.commandStarted;
			const argument = harness.commandCalls[0].argument as { cancellationToken: typeof cancellation.token };
			assert.strictEqual(argument.cancellationToken, cancellation.token);
			cancellation.cancel();
			assert.strictEqual(argument.cancellationToken.isCancellationRequested, true);
			assert.strictEqual(harness.commandCalls[0].cancellationToken?.isCancellationRequested, true);
			assert.strictEqual((await promiseWithDeadline(responsePromise, 500))?.outcome, 'cancelled');
			settleCommand?.({ templateId: 'studio.workflow.starter', projectPath: 'Starter' });
			await Promise.resolve();
		} finally {
			cancellation.dispose();
		}
	});

	test('passes cancellation to a reviewed plugin operation and stops waiting for an uncooperative command', async () => {
		let settleCommand: ((value: unknown) => void) | undefined;
		const commandPromise = new Promise<unknown>(resolve => settleCommand = resolve);
		const harness = createHarness({ reviewedOperation: true, commandPromise });
		const cancellation = new CancellationTokenSource();
		try {
			const responsePromise = harness.handler.handle(operationEvent('studio.workflow.sequence-inspect', {
				sequence: 'workflow/sequence.json',
				limit: 4,
				strict: true,
				mode: 'current'
			}), cancellation.token);
			await harness.commandStarted;
			const commandCancellation = harness.commandCalls[0].cancellationToken;
			assert.strictEqual(commandCancellation, cancellation.token);
			cancellation.cancel();
			assert.strictEqual(commandCancellation?.isCancellationRequested, true);
			const response = await promiseWithDeadline(responsePromise, 500);
			assert.strictEqual(response?.outcome, 'cancelled');
			assert.strictEqual(response?.ok, false);
			settleCommand?.({ count: 1 });
			await Promise.resolve();
			assert.strictEqual(response?.outcome, 'cancelled');
		} finally {
			cancellation.dispose();
		}
	});

	function createHarness(options: {
		readonly ownership?: 'owned' | 'released' | 'unknown';
		readonly dirty?: boolean;
		readonly symbolicLinkPath?: string;
		/** The text of every `.bhnode`; a Video node by default. */
		readonly nodeSource?: string;
		/** The node the generation runs in; the requested node by default. */
		readonly generated?: URI;
		readonly generationError?: Error;
		readonly generationPromise?: Promise<URI>;
		readonly reviewedOperation?: boolean;
		readonly capabilityCount?: number;
		readonly templates?: readonly string[];
		readonly templateCount?: number;
		readonly commandResult?: unknown;
		readonly commandPromise?: Promise<unknown>;
		/** Workspace-relative files that exist; when set, anything else below the folder does not. */
		readonly files?: readonly string[];
		readonly caseInsensitive?: boolean;
		readonly nestedFolder?: string;
		/** The workspace folder is reached through a link: its real path starts with this. */
		readonly linkedFrom?: string;
	} = {}) {
		const generateCalls: URI[] = [];
		const stopCalls: URI[] = [];
		const commandCalls: Array<{ id: string; argument: unknown; cancellationToken?: CancellationToken }> = [];
		let notifyGenerationStarted: (() => void) | undefined;
		const generationStarted = new Promise<void>(resolve => notifyGenerationStarted = resolve);
		const nodeSource = options.nodeSource ?? serializeBaseHalfNodeDocument(createBaseHalfNodeDocument({ id: baseHalfNodeTestId(1), kind: 'video', title: 'Shot' }));
		let notifyCommandStarted: (() => void) | undefined;
		const commandStarted = new Promise<void>(resolve => notifyCommandStarted = resolve);
		const workspace = {
			getWorkspace: () => ({ id: 'workspace', folders: [{ uri: workspaceFolder }, ...(options.nestedFolder ? [{ uri: URI.file(options.nestedFolder) }] : [])] }),
			getWorkspaceFolder: (resource: URI) => options.nestedFolder && extUri.isEqualOrParent(resource, URI.file(options.nestedFolder))
				? { uri: URI.file(options.nestedFolder) }
				: extUri.isEqualOrParent(resource, workspaceFolder) ? { uri: workspaceFolder } : undefined
		} as unknown as IWorkspaceContextService;
		const files = options.files?.map(path => URI.joinPath(workspaceFolder, path).path);
		const stat = async (resource: URI) => {
			if (files) {
				const isFile = files.includes(resource.path);
				const isDirectory = resource.path === workspaceFolder.path || files.some(path => path.startsWith(`${resource.path}/`));
				if (!isFile && !isDirectory) {
					throw new FileOperationError('not found', FileOperationResult.FILE_NOT_FOUND);
				}
				return { isFile, isDirectory, isSymbolicLink: resource.fsPath === options.symbolicLinkPath };
			}
			return {
				isFile: resource.path.endsWith('.bhnode'),
				isDirectory: !resource.path.endsWith('.bhnode'),
				isSymbolicLink: resource.fsPath === options.symbolicLinkPath
			};
		};
		const fileService = {
			realpath: async (resource: URI) => options.linkedFrom && !resource.path.startsWith(`${options.linkedFrom}/`) ? URI.file(`${options.linkedFrom}${resource.path}`) : resource,
			stat,
			exists: async (resource: URI) => stat(resource).then(() => true, () => false),
			readFile: async (resource: URI) => {
				await stat(resource);
				return { resource, value: VSBuffer.fromString(nodeSource) };
			},
			resolve: async (resource: URI) => {
				await stat(resource);
				const names = new Set((files ?? [])
					.filter(path => path.startsWith(`${resource.path}/`))
					.map(path => path.slice(resource.path.length + 1).split('/')[0]));
				return { children: [...names].map(name => ({ name })) };
			},
			hasCapability: () => !options.caseInsensitive
		} as unknown as IFileService;
		const workingCopies = {
			isDirty: (resource: URI) => options.dirty === true && resource.path.endsWith('dirty.bhnode')
		} as unknown as IWorkingCopyService;
		const agentArea = {
			onDidReleaseTerminalProcess: Event.None,
			ownsTerminalProcess: () => options.ownership === undefined || options.ownership === 'owned',
			terminalProcessOwnership: () => options.ownership ?? 'owned'
		} as unknown as IBaseHalfAgentAreaService;
		const generation = {
			onDidChangeProgress: Event.None,
			generate: (resource: URI) => {
				generateCalls.push(resource);
				notifyGenerationStarted?.();
				if (options.generationError) {
					return Promise.reject(options.generationError);
				}
				return options.generationPromise ?? Promise.resolve(options.generated ?? resource);
			},
			stop: async (resource: URI) => { stopCalls.push(resource); },
			isGenerating: () => false
		} as unknown as IBaseHalfVideoGenerationService;
		const operation = {
			id: 'studio.workflow.sequence-inspect',
			command: 'studio.workflow.inspectSequence',
			description: 'Inspect Sequence.',
			deterministic: true as const,
			parameters: [
				{ name: 'sequence', type: 'uri' as const, required: true, description: 'Sequence path.' },
				{ name: 'limit', type: 'integer' as const, required: true, description: 'Maximum.' },
				{ name: 'strict', type: 'boolean' as const, required: true, description: 'Strict mode.' },
				{ name: 'mode', type: 'enum' as const, required: true, description: 'Pin mode.', values: ['current', 'exact'] }
			],
			returns: { type: 'object' as const, description: 'Inspection.' }
		};
		const capability = {
			extensionId: 'studio.workflow',
			id: 'studio.workflow.capability',
			label: 'Workflow tools',
			description: 'Reviewed local workflow operations.',
			documents: [{
				kind: 'studio.workflow.sequence',
				version: 1,
				fileExtensions: ['.json'],
				schemaSummary: 'An ordered list of exact result references.'
			}],
			operations: [operation]
		};
		const capabilities = {
			getOperation: (id: string) => options.reviewedOperation && id === operation.id
				? { capability, operation }
				: undefined,
			getCapabilities: () => options.reviewedOperation
				? Array.from({ length: options.capabilityCount ?? 1 }, (_, index) => ({
					...capability,
					id: index === 0 ? capability.id : `studio.workflow.capability-${index}`
				}))
				: []
		} as unknown as IBaseHalfAgentCapabilityRegistryService;
		const templates = {
			getTemplates: () => (options.templateCount === undefined
				? options.templates ?? []
				: Array.from({ length: options.templateCount }, (_, index) => `studio.workflow.template-${index}`))
				.map(id => ({ id, label: id.split('.').at(-1) ?? id }))
		} as unknown as IBaseHalfCanvasTemplateRegistryService;
		const commands = {
				executeCommand: async (id: string, argument: unknown, cancellationToken?: CancellationToken) => {
					commandCalls.push({ id, argument, cancellationToken });
				notifyCommandStarted?.();
				return options.commandPromise ?? options.commandResult;
			}
		} as unknown as ICommandService;
		return {
			handler: new BaseHalfNodeCommandHandler(workspace, fileService, workingCopies, agentArea, generation, capabilities, templates, commands),
			generateCalls,
			stopCalls,
			commandCalls,
			generationStarted,
			commandStarted
		};
	}
});

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

function requestEvent(cwd: string, relativePath: string): IBaseHalfNodeCommandRequestEvent {
	return {
		requestId: 1,
		persistentProcessId: 7,
		workspaceId: 'workspace',
		request: {
			version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
			type: 'runNode',
			cwd,
			relativePath
		}
	};
}

function operationEvent(
	operationId: string,
	parameters: IBaseHalfAgentOperationCommandRequest['parameters'],
	cwd = '/work'
): IBaseHalfNodeCommandRequestEvent {
	return {
		requestId: 2,
		persistentProcessId: 7,
		workspaceId: 'workspace',
		request: {
			version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
			type: 'runOperation',
			cwd,
			operationId,
			parameters
		}
	};
}

function operationDiscoveryEvent(cwd = '/work'): IBaseHalfNodeCommandRequestEvent {
	return {
		requestId: 3,
		persistentProcessId: 7,
		workspaceId: 'workspace',
		request: {
			version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
			type: 'listCapabilities',
			cwd
		}
	};
}
