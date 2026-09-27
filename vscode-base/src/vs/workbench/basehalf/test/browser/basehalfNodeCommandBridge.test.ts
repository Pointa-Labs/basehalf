/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
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
import { BaseHalfNodeCommandHandler, responseForCompletedAttempt } from '../../browser/basehalfNodeCommandHandler.js';
import { IBaseHalfNodeExecutionService } from '../../browser/basehalfNodeExecutionService.js';
import { IBaseHalfAgentAreaService } from '../../common/basehalfAgentArea.js';
import { IBaseHalfAgentCapabilityRegistryService } from '../../common/basehalfAgentCapabilities.js';
import { IBaseHalfCanvasRecipeRegistryService } from '../../common/basehalfCanvasRecipes.js';
import {
	beginBaseHalfNodeAttempt,
	completeBaseHalfNodeAttempt,
	createBaseHalfNodeDocument,
	failBaseHalfNodeAttempt,
	IBaseHalfNodeDocument
} from '../../common/basehalfNodeDocument.js';
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

	test('runs a verified Agent Area node through the shared execution service', async () => {
		const harness = createHarness();
		const response = await harness.handler.handle(requestEvent('/work/scenes', 'scenes/shot.bhnode'));

		assert.strictEqual(harness.runCalls.length, 1);
		assert.strictEqual(harness.runCalls[0].relativePath, 'scenes/shot.bhnode');
		assert.strictEqual(response?.ok, true);
		assert.strictEqual(response?.outcome, 'succeeded');
		if (!response || response.type === 'runOperation' || response.type === 'listCapabilities') {
			throw new Error('Expected a node-run response.');
		}
		assert.strictEqual(response?.nodePath, 'scenes/shot.bhnode');
		assert.strictEqual(response?.attempt?.id, 'run-1');
		assert.strictEqual(response?.result?.attemptId, 'run-1');
		assert.strictEqual(response?.result?.artifactPath, 'outputs/shot/run-1/artifacts/shot.mp4');
	});

	test('ignores unknown processes but promptly rejects a released Agent Area process', async () => {
		const wrongProcess = createHarness({ ownership: 'unknown' });
		assert.strictEqual(await wrongProcess.handler.handle(requestEvent('/work', 'shot.bhnode')), undefined);
		assert.strictEqual(wrongProcess.runCalls.length, 0);

		const releasedProcess = createHarness({ ownership: 'released' });
		assert.strictEqual((await releasedProcess.handler.handle(requestEvent('/work', 'shot.bhnode')))?.outcome, 'rejected');
		assert.strictEqual(releasedProcess.runCalls.length, 0);

		const wrongWorkspace = createHarness();
		assert.strictEqual(await wrongWorkspace.handler.handle({ ...requestEvent('/work', 'shot.bhnode'), workspaceId: 'other' }), undefined);
		assert.strictEqual(wrongWorkspace.runCalls.length, 0);
	});

	test('rejects dirty, non-portable, non-node, and symbolic-link targets before execution', async () => {
		for (const [event, options] of [
			[requestEvent('/work', 'dirty.bhnode'), { dirty: true }],
			[requestEvent('/work', '../outside.bhnode'), {}],
			[requestEvent('/work', 'notes.md'), {}],
			[requestEvent('/work', 'linked/shot.bhnode'), { symbolicLinkPath: '/work/linked' }]
		] as const) {
			const harness = createHarness(options);
			const response = await harness.handler.handle(event);
			assert.strictEqual(response?.outcome, 'rejected');
			assert.strictEqual(harness.runCalls.length, 0);
		}
	});

	test('reports a completed failed attempt without changing its outcome to a rejection', () => {
		const document = completedDocument('failed');
		const response = responseForCompletedAttempt('shot.bhnode', 'run-1', document);
		assert.strictEqual(response.ok, false);
		assert.strictEqual(response.outcome, 'failed');
		assert.strictEqual(response.attempt?.status, 'failed');
		assert.strictEqual(response.result, undefined);
	});

	test('keeps a host-owned attempt running when the Agent bridge disconnects', async () => {
		let settleRun: ((document: IBaseHalfNodeDocument) => void) | undefined;
		const runPromise = new Promise<IBaseHalfNodeDocument>(resolve => settleRun = resolve);
		const harness = createHarness({ runPromise });
		const cancellation = new CancellationTokenSource();
		try {
			const responsePromise = harness.handler.handle(requestEvent('/work', 'shot.bhnode'), cancellation.token);
			await harness.runStarted;
			cancellation.cancel();
			assert.deepStrictEqual(harness.cancelCalls, []);
			settleRun?.(completedDocument('succeeded'));
			const response = await responsePromise;
			if (!response || response.type === 'runOperation' || response.type === 'listCapabilities') {
				throw new Error('Expected a node-run response.');
			}
			assert.strictEqual(response?.outcome, 'succeeded');
			assert.strictEqual(response?.result?.attemptId, 'run-1');
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

	test('lists the host contract, admitted recipes, and public reviewed extension metadata after verifying Agent Area ownership and cwd', async () => {
		const harness = createHarness({ reviewedOperation: true, templates: ['studio.workflow.starter'] });
		const response = await harness.handler.handle(operationDiscoveryEvent());
		assert.strictEqual(response?.type, 'listCapabilities');
		if (response?.type !== 'listCapabilities') {
			throw new Error('Expected a capability discovery response.');
		}
		assert.strictEqual(response.outcome, 'succeeded');
		assert.strictEqual(response.host?.nodeDocument.fileExtension, '.bhnode');
		assert.deepStrictEqual(response.host?.nodeDocument.resultKinds, ['file', 'image', 'video', 'audio', 'pdf', 'presentation']);
		assert.deepStrictEqual(response.host?.contextEdge, {
			source: 'direct-content',
			resultNodeSource: 'sealed-result',
			target: 'direct-context',
			autoRun: false,
			recursive: false,
			storedBy: 'downstream',
			markdownFrontmatterKey: 'upstream',
			nodeDocumentField: 'upstream',
			roleAndOrderOwner: 'target-recipe-binding',
			label: 'none'
		});
		assert.deepStrictEqual({
			documentVersion: response.host?.nodeDocument.documentVersion,
			inputBinding: response.host?.nodeDocument.inputBinding,
			contractVersion: response.host?.nodeDocument.authoring.contractVersion,
			upstreamRequired: ((response.host?.nodeDocument.authoring.schema as { required?: readonly string[] } | undefined)?.required ?? []).includes('upstream'),
			bindingRule: (response.host?.nodeDocument.authoring.rules as readonly string[] | undefined)?.some(rule => rule.includes('must be listed in the node\'s upstream'))
		}, {
			documentVersion: 4,
			inputBinding: { scope: 'node-upstream', fields: ['sourcePath', 'slot', 'order'] },
			contractVersion: 2,
			upstreamRequired: true,
			bindingRule: true
		});
		assert.deepStrictEqual(response.host?.nodeDocument.lifecycle, {
			attempts: 'host-owned',
			result: 'host-owned-single-file',
			retry: 'frozen-only'
		});
		assert.deepStrictEqual(response.host?.operations.map(operation => operation.id), ['basehalf.workspace.move', 'basehalf.canvas.create-from-template']);
		assert.deepStrictEqual(response.host?.templates, [{ id: 'studio.workflow.starter', label: 'starter' }]);
		assert.deepStrictEqual(response.host?.operations[0].parameters.map(parameter => [parameter.name, parameter.type, parameter.required]), [['from', 'string', true], ['to', 'string', true]]);
		assert.deepStrictEqual(response.host?.operations[1].parameters[0].values, ['studio.workflow.starter']);
		assert.strictEqual(response.recipes?.length, 1);
		assert.strictEqual(response.recipes?.[0].id, 'studio.workflow.render-image');
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
		assert.deepStrictEqual(withoutTemplates?.type === 'listCapabilities' ? withoutTemplates.host?.operations.map(operation => operation.id) : undefined, ['basehalf.workspace.move']);
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

	test('maps the host move operation to the agent move command with both paths resolved in the workspace folder', async () => {
		const result = { from: 'a.md', to: 'docs/b.md', upstream: { updated: ['n.md'], skipped: [] } };
		const harness = createHarness({ files: ['a.md', 'n.md', 'docs/readme.md'], commandResult: result });
		const response = await harness.handler.handle(operationEvent('basehalf.workspace.move', { from: 'a.md', to: 'docs/b.md' }, '/work/docs'));
		assert.deepStrictEqual({
			outcome: response?.outcome,
			result: response?.type === 'runOperation' ? response.result : undefined,
			calls: harness.commandCalls.map(call => {
				const argument = call.argument as { workspaceFolder: URI; source: URI; target: URI; from: string; to: string };
				return [call.id, argument.workspaceFolder.path, argument.source.path, argument.target.path, argument.from, argument.to];
			})
		}, {
			outcome: 'succeeded',
			result,
			calls: [['_basehalf.workspace.agentMove', '/work', '/work/a.md', '/work/docs/b.md', 'a.md', 'docs/b.md']]
		});
	});

	test('lets an agent move keep an existing non-portable folder name, and never dispatches a cancelled request', async () => {
		const harness = createHarness({ files: ['2024:25/draft.md'], commandResult: {} });
		const response = await harness.handler.handle(operationEvent('basehalf.workspace.move', { from: '2024:25/draft.md', to: '2024:25/final.md' }));
		const cancelled = createHarness({ files: ['a.md'], commandResult: {} });
		const source = new CancellationTokenSource();
		source.cancel();
		const cancelledResponse = await cancelled.handler.handle(operationEvent('basehalf.workspace.move', { from: 'a.md', to: 'b.md' }), source.token);
		source.dispose();
		assert.deepStrictEqual([response?.outcome, harness.commandCalls.length, cancelledResponse?.outcome, cancelled.commandCalls.length], ['succeeded', 1, 'cancelled', 0]);
	});

	test('resolves an agent move to the spelling on disk, keeping the new name as given', async () => {
		const resolved = [];
		for (const [files, caseInsensitive, from, to] of [
			[['Branches/SVD.md', 'Topics/x.md'], true, 'branches/svd.md', 'topics/Singular.md'],
			[['cafe\u0301.md'], false, 'caf\u00e9.md', 'b.md'],
			[['cafe\u0301.md'], true, 'cafe\u0301.md', 'Caf\u00e9.md']
		] as const) {
			const harness = createHarness({ files, caseInsensitive, commandResult: {} });
			const response = await harness.handler.handle(operationEvent('basehalf.workspace.move', { from, to }));
			const argument = harness.commandCalls[0]?.argument as { from: string; to: string } | undefined;
			resolved.push([response?.outcome, argument?.from, argument?.to]);
		}
		assert.deepStrictEqual(resolved, [
			['succeeded', 'Branches/SVD.md', 'Topics/Singular.md'],
			['succeeded', 'cafe\u0301.md', 'b.md'],
			// A case-only rename keeps the item's normalization form.
			['succeeded', 'cafe\u0301.md', 'Cafe\u0301.md']
		]);
	});

	test('refuses an agent move out of or into .bh, outside the folder, to a non-portable name, of a missing item, onto an existing one, into itself, through a link, or in a marked folder', async () => {
		const cases: [string, string, Parameters<typeof createHarness>[0], string][] = [
			['.bh/mirror/a.md/badge.yaml', 'b.md', { files: ['a.md'] }, 'inside .bh/'],
			['a.md', '.BH/a.md', { files: ['a.md'] }, 'inside .bh/'],
			['a.md', '../outside.md', { files: ['a.md'] }, 'relative to the workspace folder'],
			['/work/a.md', 'b.md', { files: ['a.md'] }, 'relative to the workspace folder'],
			['a.md', 'b?.md', { files: ['a.md'] }, 'portable'],
			['a.md', 'new?/b.md', { files: ['a.md'] }, 'portable'],
			['a.md', 'archive/', { files: ['a.md'] }, 'not a folder to move it into'],
			['.', 'b.md', { files: ['a.md'] }, 'relative to the workspace folder'],
			['caf\u0065\u0301.md', 'caf\u00e9.md', { files: ['caf\u0065\u0301.md'] }, 'only in Unicode normalization'],
			['a.md', 'A.md', { files: ['a.md', 'A.md'], caseInsensitive: true }, 'already exists'],
			['a.md', 'inner/b.md', { files: ['a.md', 'inner/c.md'], nestedFolder: '/work/inner' }, 'another workspace folder'],
			['a.md', 'a.md', { files: ['a.md'] }, 'the same path'],
			['missing.md', 'b.md', { files: ['a.md'] }, 'not to the current directory'],
			['a.md', 'b.md', { files: ['b.md'] }, 'may already have been moved'],
			['a.md', 'c.md', { files: ['a.md', 'c.md'] }, 'not a folder to move it into'],
			['notes', 'notes/inner', { files: ['notes/a.md'] }, 'is inside'],
			['linked/a.md', 'b.md', { files: ['linked/a.md'], symbolicLinkPath: '/work/linked' }, 'symbolic link'],
			['a.md', 'linked/b.md', { files: ['a.md', 'linked/c.md'], symbolicLinkPath: '/work/linked' }, 'symbolic link'],
			['a.md', 'b.md', { files: ['a.md', '.basehalf-no-workspace-setup'] }, 'source tree']
		];
		const outcomes = [];
		for (const [from, to, options, reason] of cases) {
			const harness = createHarness(options);
			const response = await harness.handler.handle(operationEvent('basehalf.workspace.move', { from, to }));
			const error = response?.type === 'runOperation' ? response.error ?? '' : '';
			outcomes.push([from, to, response?.outcome, harness.commandCalls.length, error.includes(reason) ? reason : error]);
		}
		assert.deepStrictEqual(outcomes, cases.map(([from, to, , reason]) => [from, to, 'rejected', 0, reason]));
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
		readonly runPromise?: Promise<IBaseHalfNodeDocument>;
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
	} = {}) {
		const runCalls: Array<{ resource: URI; workspaceFolder: URI; relativePath: string }> = [];
		const cancelCalls: Array<{ resource: URI; runId: string }> = [];
		const commandCalls: Array<{ id: string; argument: unknown; cancellationToken?: CancellationToken }> = [];
		let notifyRunStarted: (() => void) | undefined;
		const runStarted = new Promise<void>(resolve => notifyRunStarted = resolve);
		let notifyCommandStarted: (() => void) | undefined;
		const commandStarted = new Promise<void>(resolve => notifyCommandStarted = resolve);
		const workspace = {
			getWorkspace: () => ({ id: 'workspace' }),
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
			realpath: async (resource: URI) => resource,
			stat,
			exists: async (resource: URI) => stat(resource).then(() => true, () => false),
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
		const execution = {
			onDidChange: Event.None,
			getActiveRun: () => ({ resource: URI.file('/work/scenes/shot.bhnode'), runId: 'run-1', phase: 'running' }),
			run: (node: { resource: URI; workspaceFolder: URI; relativePath: string }) => {
				runCalls.push(node);
				notifyRunStarted?.();
				return options.runPromise ?? Promise.resolve(completedDocument('succeeded'));
			},
			cancel: (resource: URI, runId: string) => {
				cancelCalls.push({ resource, runId });
				return true;
			}
		} as unknown as IBaseHalfNodeExecutionService;
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
		const recipe = {
			extensionId: 'studio.workflow',
			id: 'studio.workflow.render-image',
			label: 'Render image',
			description: 'Create one image from direct context.',
			modelCapability: 'image' as const,
			inputs: [{ id: 'prompt', label: 'Prompt', accepts: ['text'] as const, minItems: 1, maxItems: 1 }],
			parameters: [{ id: 'quality', label: 'Quality', type: 'enum' as const, default: 'standard', options: [{ value: 'standard', label: 'Standard' }] }],
			outputs: [{ id: 'image', kind: 'image' as const, extensions: ['.png'], minItems: 1, maxItems: 1, primary: true as const }]
		};
		const recipes = {
			getRecipes: () => [recipe],
			getTemplates: () => (options.templateCount === undefined
				? options.templates ?? []
				: Array.from({ length: options.templateCount }, (_, index) => `studio.workflow.template-${index}`))
				.map(id => ({ id, label: id.split('.').at(-1) ?? id }))
		} as unknown as IBaseHalfCanvasRecipeRegistryService;
		const commands = {
				executeCommand: async (id: string, argument: unknown, cancellationToken?: CancellationToken) => {
					commandCalls.push({ id, argument, cancellationToken });
				notifyCommandStarted?.();
				return options.commandPromise ?? options.commandResult;
			}
		} as unknown as ICommandService;
		return {
			handler: new BaseHalfNodeCommandHandler(workspace, fileService, workingCopies, agentArea, execution, capabilities, recipes, commands),
			runCalls,
			cancelCalls,
			commandCalls,
			runStarted,
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

function completedDocument(status: 'succeeded' | 'failed'): IBaseHalfNodeDocument {
	const initial = createBaseHalfNodeDocument({
		id: baseHalfNodeTestId(1),
		kind: 'video',
		title: 'Shot',
		role: 'result',
		recipe: { recipeId: 'basehalf.test.create-video', parameters: {}, inputBindings: [] }
	});
	const running = beginBaseHalfNodeAttempt(initial, {
		id: 'run-1',
		createdAt: '2026-07-18T00:00:00.000Z',
		startedAt: '2026-07-18T00:00:00.000Z',
		model: { source: 'local' },
		inputs: []
	});
	if (status === 'failed') {
		return failBaseHalfNodeAttempt(running, 'run-1', {
			completedAt: '2026-07-18T00:00:01.000Z',
			error: 'generation failed'
		});
	}
	return completeBaseHalfNodeAttempt(running, 'run-1', {
		completedAt: '2026-07-18T00:00:01.000Z',
		artifact: {
			id: 'artifact-1',
			outputId: 'video',
			kind: 'video',
			path: 'outputs/shot/run-1/artifacts/shot.mp4',
			sha256: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
			size: 1
		}
	});
}
