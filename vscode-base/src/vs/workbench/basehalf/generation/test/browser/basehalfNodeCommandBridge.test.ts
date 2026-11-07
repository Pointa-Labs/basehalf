/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Event } from '../../../../../base/common/event.js';
import { extUri } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FileOperationError, FileOperationResult, IFileService } from '../../../../../platform/files/common/files.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { BASEHALF_NODE_COMMAND_BRIDGE_VERSION, IBaseHalfAgentOperationCommandRequest, IBaseHalfNodeCommandRequestEvent } from '../../../../../platform/terminal/common/terminal.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IWorkingCopyService } from '../../../../services/workingCopy/common/workingCopyService.js';
import { BaseHalfNodeCommandBackendGeneration } from '../../browser/basehalfNodeCommandBridge.contribution.js';
import { BaseHalfNodeCommandHandler } from '../../browser/basehalfNodeCommandHandler.js';
import { IBaseHalfAgentAreaService } from '../../../agentArea/common/basehalfAgentArea.js';
import { IBaseHalfAgentCapabilityRegistryService } from '../../../agentArea/common/basehalfAgentCapabilities.js';
import { IBaseHalfCanvasTemplateRegistryService } from '../../../canvas/common/basehalfCanvasTemplateRegistry.js';
import { readBaseHalfSidecarUpstream } from '../../../references/common/basehalfReferenceStore.js';
import { BASEHALF_GENERATION_EXTENSIONS, baseHalfGenerationKindOfPath, parseBaseHalfGenerationInfo } from '../../common/basehalfGenerationInfo.js';
import { IBaseHalfVideoCatalogProvider } from '../../common/basehalfVideoCatalog.js';
import { baseHalfGenerationMissingFileMessage, BaseHalfVideoGenerationError, IBaseHalfGenerateOptions, IBaseHalfGenerationCardStore, IBaseHalfVideoCatalogService, IBaseHalfVideoGenerationService, IBaseHalfVideoProviderSettingsService } from '../../common/basehalfVideoGeneration.js';
import { TEST_VIDEO_CATALOG } from '../common/basehalfVideoCatalogFixture.js';

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

	test('starts the generation of a verified card as an agent and prints every card it lands on', async () => {
		const harness = createHarness();
		const response = await harness.handler.handle(requestEvent('/work/scenes', 'scenes/shot.mp4'));

		assert.deepStrictEqual({
			generated: harness.generateCalls.map(call => [call.resource.path, call.options]),
			response
		}, {
			// An agent's values are refused, never made legal.
			generated: [['/work/scenes/shot.mp4', { agent: true }]],
			response: {
				version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
				type: 'generate',
				ok: true,
				outcome: 'succeeded',
				path: 'scenes/shot.mp4',
				cards: ['scenes/shot.mp4']
			}
		});
	});

	test('generates a draft, which has no file, and prints the new draft of a card that has its file and every image of several', async () => {
		const draft = createHarness({ drafts: ['scenes/next.mp4'] });
		const fromDraft = await draft.handler.handle(requestEvent('/work', 'scenes/next.mp4'));
		const again = createHarness({ generated: ['/work/scenes/shot-2.mp4'] });
		const fromFile = await again.handler.handle(requestEvent('/work', 'scenes/shot.mp4'));
		const several = createHarness({ drafts: ['frames/image.png'], generated: ['/work/frames/image.png', '/work/frames/image-2.png', '/work/frames/image-3.png'] });
		const images = await several.handler.handle(requestEvent('/work/frames', 'frames/image.png'));
		// An audio draft generates as an image or a video draft does, and every song of several is printed (D78).
		const sound = createHarness({ drafts: ['voice/audio.mp3'] });
		const fromSound = await sound.handler.handle(requestEvent('/work', 'voice/audio.mp3'));
		const songs = createHarness({ drafts: ['songs/audio.wav'], generated: ['/work/songs/audio.wav', '/work/songs/audio-2.wav'] });
		const fromSongs = await songs.handler.handle(requestEvent('/work/songs', 'songs/audio.wav'));
		const spoken = createHarness({ generated: ['/work/voice/audio-2.mp3'] });
		const fromSoundFile = await spoken.handler.handle(requestEvent('/work', 'voice/audio.mp3'));
		assert.deepStrictEqual([fromDraft, fromFile, images, fromSound, fromSongs, fromSoundFile].map(response => response?.type === 'generate' ? [response.ok, response.cards] : response), [
			[true, ['scenes/next.mp4']],
			[true, ['scenes/shot-2.mp4']],
			[true, ['frames/image.png', 'frames/image-2.png', 'frames/image-3.png']],
			[true, ['voice/audio.mp3']],
			[true, ['songs/audio.wav', 'songs/audio-2.wav']],
			[true, ['voice/audio-2.mp3']]
		]);
		assert.deepStrictEqual(draft.generateCalls.map(call => call.resource.path), ['/work/scenes/next.mp4']);
	});

	test('finds the command directory of a workspace opened through a link by its real path', async () => {
		// The shell reports /private/work/scenes for /work/scenes, as macOS does under /tmp and /var.
		const harness = createHarness({ linkedFrom: '/private' });
		const response = await harness.handler.handle(requestEvent('/private/work/scenes', 'scenes/shot.mp4'));
		const outside = await harness.handler.handle(requestEvent('/private/elsewhere', 'scenes/shot.mp4'));
		assert.deepStrictEqual({
			generated: harness.generateCalls.map(call => call.resource.path),
			response: response?.type === 'generate' ? [response.ok, response.cards] : response,
			outside: outside?.ok
		}, {
			generated: ['/work/scenes/shot.mp4'],
			response: [true, ['scenes/shot.mp4']],
			outside: false
		});
	});

	test('ignores unknown processes but promptly rejects a released Agent Area process', async () => {
		const wrongProcess = createHarness({ ownership: 'unknown' });
		assert.strictEqual(await wrongProcess.handler.handle(requestEvent('/work', 'shot.mp4')), undefined);
		assert.strictEqual(wrongProcess.generateCalls.length, 0);

		const releasedProcess = createHarness({ ownership: 'released' });
		assert.strictEqual((await releasedProcess.handler.handle(requestEvent('/work', 'shot.mp4')))?.outcome, 'rejected');
		assert.strictEqual(releasedProcess.generateCalls.length, 0);

		const wrongWorkspace = createHarness();
		assert.strictEqual(await wrongWorkspace.handler.handle({ ...requestEvent('/work', 'shot.mp4'), workspaceId: 'other' }), undefined);
		assert.strictEqual(wrongWorkspace.generateCalls.length, 0);
	});

	test('refuses a path that is not a generation card of the workspace folder before generating', async () => {
		const refusals: string[] = [];
		for (const [path, options] of [
			['../outside.mp4', {}],
			['.bh/mirror/shot.mp4/generation.yaml', {}],
			['scenes/notes.md', {}],
			// A sound of an extension that no audio card has.
			['voice/take.opus', {}],
			// The retired node document is an ordinary file (D63).
			['scenes/shot.bhnode', {}],
			// A video without generation information, and a path that names nothing.
			['scenes/imported.mp4', { plainFiles: ['scenes/imported.mp4'] }],
			['scenes/nothing.mp4', { missing: ['scenes/nothing.mp4'] }],
			// A draft in a folder that is not on this computer.
			['gone/draft.mp4', { drafts: ['gone/draft.mp4'], missing: ['gone'] }],
			['linked/shot.mp4', { symbolicLinkPath: '/work/linked' }],
			['scenes/link.mp4', { symbolicLinkPath: '/work/scenes/link.mp4' }],
			['scenes/folder.mp4', { folders: ['scenes/folder.mp4'] }]
		] as const) {
			const harness = createHarness(options);
			const response = await harness.handler.handle(requestEvent('/work', path));
			refusals.push(`${path}: ${response?.outcome} ${harness.generateCalls.length}`);
			assert.strictEqual(response?.type === 'generate' ? response.cards : 'none', undefined, path);
		}
		assert.deepStrictEqual(refusals, [
			'../outside.mp4: rejected 0',
			'.bh/mirror/shot.mp4/generation.yaml: rejected 0',
			'scenes/notes.md: rejected 0',
			'voice/take.opus: rejected 0',
			'scenes/shot.bhnode: rejected 0',
			'scenes/imported.mp4: rejected 0',
			'scenes/nothing.mp4: rejected 0',
			'gone/draft.mp4: rejected 0',
			'linked/shot.mp4: rejected 0',
			'scenes/link.mp4: rejected 0',
			'scenes/folder.mp4: rejected 0'
		]);
	});

	test('refuses a card whose generated file is gone as Generate does, before generating: a missing file is not a draft', async () => {
		const answers: unknown[] = [];
		for (const [path, options] of [
			// Its made.yaml stays where its file was. Only that the record is there counts, not what it says,
			// so a record that cannot be read is refused alike: the harness gives no file a content to read.
			['scenes/gone.mp4', { missing: ['scenes/gone.mp4'], made: ['scenes/gone.mp4'] }],
			// Also when its folder is gone with it.
			['lost/frame.png', { missing: ['lost'], made: ['lost/frame.png'] }]
		] as const) {
			const harness = createHarness(options);
			answers.push([await harness.handler.handle(requestEvent('/work', path)), harness.generateCalls.length]);
		}
		assert.deepStrictEqual(answers, [
			[{
				version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
				type: 'generate',
				ok: false,
				outcome: 'rejected',
				path: 'scenes/gone.mp4',
				error: 'gone.mp4 is not there any more: it was moved or deleted. Restore it to generate from it.'
			}, 0],
			[{
				version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
				type: 'generate',
				ok: false,
				outcome: 'rejected',
				path: 'lost/frame.png',
				error: baseHalfGenerationMissingFileMessage('frame.png')
			}, 0]
		]);
		// A path that holds a file is no missing file, whatever its record says.
		const present = createHarness({ made: ['scenes/shot.mp4'] });
		assert.deepStrictEqual([(await present.handler.handle(requestEvent('/work', 'scenes/shot.mp4')))?.ok, present.generateCalls.length], [true, 1]);
	});

	test('reports a generation the card cannot start as rejected, with its plain reason', async () => {
		const harness = createHarness({ generationError: new BaseHalfVideoGenerationError('This card is already generating.') });
		const response = await harness.handler.handle(requestEvent('/work', 'shot.mp4'));
		assert.deepStrictEqual(response, {
			version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
			type: 'generate',
			ok: false,
			outcome: 'rejected',
			path: 'shot.mp4',
			error: 'This card is already generating.'
		});
	});

	test('keeps a started generation running when the Agent bridge disconnects', async () => {
		let settleGeneration: ((resource: URI) => void) | undefined;
		const generationPromise = new Promise<URI>(resolve => settleGeneration = resolve);
		const harness = createHarness({ generationPromise });
		const cancellation = new CancellationTokenSource();
		try {
			const responsePromise = harness.handler.handle(requestEvent('/work', 'shot.mp4'), cancellation.token);
			await harness.generationStarted;
			cancellation.cancel();
			settleGeneration?.(URI.file('/work/shot.mp4'));
			const response = await responsePromise;
			assert.deepStrictEqual([response?.outcome, response?.type === 'generate' ? response.cards : undefined], ['succeeded', ['shot.mp4']]);
			assert.deepStrictEqual(harness.stopCalls, []);
		} finally {
			cancellation.dispose();
		}
	});

	test('executes only an operation that discovery offers, with validated typed parameters', async () => {
		const harness = createHarness({ withOperation: true, commandResult: { count: 1 } });
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

	test('lists no provider and says why when the model catalog cannot be loaded', async () => {
		const harness = createHarness({ modelCatalogFails: true });
		const response = await harness.handler.handle(operationDiscoveryEvent());
		assert.deepStrictEqual(response?.type === 'listCapabilities' ? [response.outcome, response.host?.modelCatalog] : undefined, [
			'succeeded',
			{ providers: [], error: 'The provider service did not answer.' }
		]);
	});

	test('lists the host contract, the templates, and the capabilities after verifying Agent Area ownership and cwd', async () => {
		const harness = createHarness({ withOperation: true, templates: ['studio.workflow.starter'] });
		const response = await harness.handler.handle(operationDiscoveryEvent());
		assert.strictEqual(response?.type, 'listCapabilities');
		if (response?.type !== 'listCapabilities') {
			throw new Error('Expected a capability discovery response.');
		}
		assert.strictEqual(response.outcome, 'succeeded');
		// D63: generation cards replace the node document, and the catalog is the model catalog.
		assert.deepStrictEqual(Object.keys(response.host ?? {}), ['generationCards', 'contextEdge', 'templates', 'operations', 'modelCatalog']);
		const cards = response.host!.generationCards;
		assert.deepStrictEqual({ ...cards, authoring: undefined }, {
			fileExtensions: {
				image: BASEHALF_GENERATION_EXTENSIONS.image.map(extension => `.${extension}`),
				video: BASEHALF_GENERATION_EXTENSIONS.video.map(extension => `.${extension}`),
				audio: BASEHALF_GENERATION_EXTENSIONS.audio.map(extension => `.${extension}`)
			},
			generationFile: '.bh/mirror/<path>/generation.yaml',
			inputsFile: '.bh/mirror/<path>/upstream.yaml',
			hostOwned: ['.bh/mirror/<path>/made.yaml', '.bh/cache/generation/'],
			generateCommand: 'basehalf --generate <workspace-relative-path>',
			authoring: undefined
		});
		assert.deepStrictEqual(response.host?.contextEdge, {
			source: 'direct-content',
			target: 'direct-context',
			autoRun: false,
			recursive: false,
			storedBy: 'downstream',
			markdownFrontmatterKey: 'upstream',
			inputOrder: 'target-upstream-order',
			label: 'none'
		});
		// The example is a card of the catalog's, written and read back as BaseHalf writes and reads it.
		const authoring = cards.authoring as Record<string, any>;
		const example = parseBaseHalfGenerationInfo(authoring.examples.generation);
		assert.deepStrictEqual({
			contractVersion: authoring.contractVersion,
			schemaFields: Object.keys(authoring.schema.properties),
			card: [authoring.examples.card, baseHalfGenerationKindOfPath(authoring.examples.card)],
			files: [authoring.examples.generationFile, authoring.examples.inputsFile],
			example: { readable: example.readable, provider: example.info.provider, model: example.info.model, mode: example.info.mode, params: example.info.params },
			inputs: readBaseHalfSidecarUpstream(authoring.examples.inputs, { nodePath: authoring.examples.card }).items.map(item => item.path),
			// The example's prompt mentions its inputs by their entries (D74).
			prompt: example.info.prompt,
			rules: (authoring.rules as string[]).filter(rule => /made\.yaml|draft|basehalf --generate|host\.modelCatalog|upstream\.yaml/.test(rule)).length
		}, {
			contractVersion: 7,
			schemaFields: ['prompt', 'provider', 'model', 'mode', 'params'],
			card: ['shots/shot-01/clip.mp4', 'video'],
			files: ['.bh/mirror/shots/shot-01/clip.mp4/generation.yaml', '.bh/mirror/shots/shot-01/clip.mp4/upstream.yaml'],
			example: { readable: true, provider: 'borealis', model: 'borealis-one', mode: 'frames', params: { caption: '', strength: 0.5 } },
			inputs: ['frames/start.png', 'frames/end.png', 'notes/scene.md'],
			prompt: 'The rider in @[frames/start.png] cycles along the coast, as @[notes/scene.md] describes; the camera follows slowly.',
			rules: 9
		});
		// The model catalog, from which an agent chooses a generation; the example is of a provider set up here.
		const providers = response.host?.modelCatalog.providers as readonly Record<string, any>[];
		assert.deepStrictEqual({
			providers: providers.map(provider => `${provider.id} ${provider.setUp ? 'set up' : 'not set up'} in ${provider.region}: ${provider.models.map((model: Record<string, any>) => `${model.id} [${model.regions.join(' ')}] ${model.modes.map((mode: Record<string, unknown>) => mode.id).join('/')}`).join(', ')}`),
			parameters: providers[0].models[0].parameters.map((parameter: Record<string, unknown>) => parameter.name),
			secretFree: !/apiKey"?\s*:|baseUrl|endpoint|providerModels|console/.test(JSON.stringify(response.host?.modelCatalog)),
			priceFree: !/"(estimate|currency|price)"\s*:/.test(JSON.stringify(response.host?.modelCatalog)),
			error: response.host?.modelCatalog.error
		}, {
			providers: [
				'acme not set up in east: acme-motion-2 [east west] frames/reference, acme-still [east] frames, acme-clip [east west] extend/edit, acme-legacy [east] frames',
				'borealis set up in main: borealis-one [main] frames'
			],
			parameters: ['resolution', 'ratio', 'duration', 'sound', 'seed', 'negative_prompt'],
			secretFree: true,
			priceFree: true,
			error: undefined
		});
		assert.doesNotMatch(JSON.stringify(response.host), /bhnode|--run-node|videoCatalog|nodeDocument|node-result|outputs\//);
		assert.deepStrictEqual(response.host?.operations.map(operation => operation.id), ['basehalf.canvas.create-from-template']);
		assert.deepStrictEqual(response.host?.templates, [{ id: 'studio.workflow.starter', label: 'starter' }]);
		assert.deepStrictEqual(response.host?.operations[0].parameters[0].values, ['studio.workflow.starter']);
		assert.strictEqual(Object.hasOwn(response, 'recipes'), false);
		assert.strictEqual(response.extensions?.length, 1);
		assert.deepStrictEqual(response.extensions?.[0], {
			id: 'studio.workflow.capability',
			label: 'Workflow tools',
			description: 'Local workflow operations.',
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
		const unknown = createHarness({ ownership: 'unknown', withOperation: true });
		assert.strictEqual(await unknown.handler.handle(operationDiscoveryEvent()), undefined);
		const withoutTemplates = await createHarness().handler.handle(operationDiscoveryEvent());
		assert.strictEqual(withoutTemplates?.type, 'listCapabilities');
		assert.deepStrictEqual(withoutTemplates?.type === 'listCapabilities' ? withoutTemplates.host?.operations.map(operation => operation.id) : undefined, []);
	});

	test('rejects operation discovery before serialization when the capability count exceeds the protocol bound', async () => {
		const harness = createHarness({ withOperation: true, capabilityCount: 257 });
		const response = await harness.handler.handle(operationDiscoveryEvent());
		assert.strictEqual(response?.type, 'listCapabilities');
		assert.strictEqual(response?.outcome, 'rejected');
		assert.strictEqual(harness.commandCalls.length, 0);
	});

	test('rejects capability discovery when the templates exceed the bounded public contract', async () => {
		const harness = createHarness({ templateCount: 257 });
		const response = await harness.handler.handle(operationDiscoveryEvent());
		assert.strictEqual(response?.type, 'listCapabilities');
		assert.strictEqual(response?.outcome, 'rejected');
	});

	test('rejects undeclared operations, unknown parameters, bad types, and unsafe URI paths before command dispatch', async () => {
		for (const [operationId, parameters, options] of [
			['studio.workflow.not-offered', {}, { withOperation: true }],
			['studio.workflow.sequence-inspect', { sequence: 'workflow/sequence.json', unknown: true }, { withOperation: true }],
			['studio.workflow.sequence-inspect', { sequence: 'workflow/sequence.json', limit: 1.5, strict: true, mode: 'current' }, { withOperation: true }],
			['studio.workflow.sequence-inspect', { sequence: '../outside.json', limit: 1, strict: true, mode: 'current' }, { withOperation: true }],
			['studio.workflow.sequence-inspect', { sequence: 'linked/sequence.json', limit: 1, strict: true, mode: 'current' }, { withOperation: true, symbolicLinkPath: '/work/linked' }]
		] as const) {
			const harness = createHarness(options);
			const response = await harness.handler.handle(operationEvent(operationId, parameters));
			assert.strictEqual(response?.outcome, 'rejected');
			assert.strictEqual(harness.commandCalls.length, 0);
		}
	});

	test('maps the host template operation to the template and the command directory', async () => {
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

	test('passes cancellation to an operation and stops waiting for an uncooperative command', async () => {
		let settleCommand: ((value: unknown) => void) | undefined;
		const commandPromise = new Promise<unknown>(resolve => settleCommand = resolve);
		const harness = createHarness({ withOperation: true, commandPromise });
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
		/** Workspace-relative paths whose card information is a draft's: nothing is there. */
		readonly drafts?: readonly string[];
		/** Workspace-relative files with an image or video extension and no generation information. */
		readonly plainFiles?: readonly string[];
		/** Workspace-relative paths at which nothing is. */
		readonly missing?: readonly string[];
		/** Workspace-relative paths of folders, whatever their name. */
		readonly folders?: readonly string[];
		/** Workspace-relative card paths whose `made.yaml` is there. */
		readonly made?: readonly string[];
		/** The cards the generation lands on, by path; the requested card by default. */
		readonly generated?: readonly string[];
		readonly generationError?: Error;
		readonly generationPromise?: Promise<URI>;
		readonly withOperation?: boolean;
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
		/** The model catalog could not be loaded. */
		readonly modelCatalogFails?: boolean;
	} = {}) {
		const generateCalls: { readonly resource: URI; readonly options: IBaseHalfGenerateOptions | undefined }[] = [];
		const stopCalls: URI[] = [];
		const commandCalls: Array<{ id: string; argument: unknown; cancellationToken?: CancellationToken }> = [];
		let notifyGenerationStarted: (() => void) | undefined;
		const generationStarted = new Promise<void>(resolve => notifyGenerationStarted = resolve);
		let notifyCommandStarted: (() => void) | undefined;
		const commandStarted = new Promise<void>(resolve => notifyCommandStarted = resolve);
		const workspace = {
			getWorkspace: () => ({ id: 'workspace', folders: [{ uri: workspaceFolder }, ...(options.nestedFolder ? [{ uri: URI.file(options.nestedFolder) }] : [])] }),
			getWorkspaceFolder: (resource: URI) => options.nestedFolder && extUri.isEqualOrParent(resource, URI.file(options.nestedFolder))
				? { uri: URI.file(options.nestedFolder) }
				: extUri.isEqualOrParent(resource, workspaceFolder) ? { uri: workspaceFolder } : undefined
		} as unknown as IWorkspaceContextService;
		const files = options.files?.map(path => URI.joinPath(workspaceFolder, path).path);
		const absolute = (paths: readonly string[] | undefined) => new Set((paths ?? []).map(path => URI.joinPath(workspaceFolder, path).path));
		const drafts = absolute(options.drafts);
		const missing = absolute([...(options.drafts ?? []), ...(options.missing ?? [])]);
		const folders = absolute(options.folders);
		const plainFiles = absolute(options.plainFiles);
		const madeRecords = new Set((options.made ?? []).map(path => URI.joinPath(workspaceFolder, '.bh', 'mirror', ...path.split('/'), 'made.yaml').path));
		const stat = async (resource: URI) => {
			if (madeRecords.has(resource.path)) {
				return { isFile: true, isDirectory: false, isSymbolicLink: false };
			}
			if (files) {
				const isFile = files.includes(resource.path);
				const isDirectory = resource.path === workspaceFolder.path || files.some(path => path.startsWith(`${resource.path}/`));
				if (!isFile && !isDirectory) {
					throw new FileOperationError('not found', FileOperationResult.FILE_NOT_FOUND);
				}
				return { isFile, isDirectory, isSymbolicLink: resource.fsPath === options.symbolicLinkPath };
			}
			if ([...missing].some(path => resource.path === path || resource.path.startsWith(`${path}/`))) {
				throw new FileOperationError('not found', FileOperationResult.FILE_NOT_FOUND);
			}
			// Everything named like an image, a video, a sound, a note, or a node file is a file; the rest are folders.
			const isFile = !folders.has(resource.path) && /\.(?:mp4|png|mp3|wav|md|bhnode)$/.test(resource.path);
			return { isFile, isDirectory: !isFile, isSymbolicLink: resource.fsPath === options.symbolicLinkPath };
		};
		const fileService = {
			realpath: async (resource: URI) => {
				await stat(resource);
				return options.linkedFrom && !resource.path.startsWith(`${options.linkedFrom}/`) ? URI.file(`${options.linkedFrom}${resource.path}`) : resource;
			},
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
		const cardStore = {
			// A draft whose folder is here, or a file with an image or video extension that has generation information.
			isGenerationCard: async (resource: URI) => drafts.has(resource.path)
				? await stat(URI.joinPath(resource, '..')).then(folder => folder.isDirectory, () => false)
				: !!baseHalfGenerationKindOfPath(resource.path) && !plainFiles.has(resource.path) && await stat(resource).then(item => item.isFile, () => false)
		} as unknown as IBaseHalfGenerationCardStore;
		const workingCopies = {
			isDirty: (resource: URI) => options.dirty === true && resource.path.endsWith('dirty.md')
		} as unknown as IWorkingCopyService;
		const agentArea = {
			onDidReleaseTerminalProcess: Event.None,
			ownsTerminalProcess: () => options.ownership === undefined || options.ownership === 'owned',
			terminalProcessOwnership: () => options.ownership ?? 'owned'
		} as unknown as IBaseHalfAgentAreaService;
		const generation = {
			onDidChangeProgress: Event.None,
			generate: (resource: URI, generateOptions?: IBaseHalfGenerateOptions) => {
				generateCalls.push({ resource, options: generateOptions });
				notifyGenerationStarted?.();
				if (options.generationError) {
					return Promise.reject(options.generationError);
				}
				if (options.generationPromise) {
					return options.generationPromise.then(card => [card]);
				}
				return Promise.resolve(options.generated?.map(path => URI.file(path)) ?? [resource]);
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
			description: 'Local workflow operations.',
			documents: [{
				kind: 'studio.workflow.sequence',
				version: 1,
				fileExtensions: ['.json'],
				schemaSummary: 'An ordered list of exact result references.'
			}],
			operations: [operation]
		};
		const capabilities = {
			getOperation: (id: string) => options.withOperation && id === operation.id
				? { capability, operation }
				: undefined,
			getCapabilities: () => options.withOperation
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
		const modelCatalog = {
			whenReady: async () => {
				if (options.modelCatalogFails) {
					throw new Error('The provider service did not answer.');
				}
				return TEST_VIDEO_CATALOG;
			}
		} as unknown as IBaseHalfVideoCatalogService;
		const videoProviders = {
			getStatus: (provider: IBaseHalfVideoCatalogProvider) => ({
				region: provider.regions[0],
				setUp: provider.id === 'borealis',
				endpoint: provider.regions[0].baseUrl,
				customEndpoint: false,
				credentials: new Set<string>()
			})
		} as unknown as IBaseHalfVideoProviderSettingsService;
		return {
			handler: new BaseHalfNodeCommandHandler(workspace, fileService, workingCopies, agentArea, generation, cardStore, capabilities, templates, commands, modelCatalog, videoProviders),
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
			type: 'generate',
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
