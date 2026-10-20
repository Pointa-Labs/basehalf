/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	addBaseHalfNodeUpstreamEntry,
	analyzeBaseHalfNodeUpstream,
	BASEHALF_NODE_DOCUMENT_MAX_BYTES,
	BASEHALF_NODE_DOCUMENT_VERSION,
	BASEHALF_NODE_KINDS,
	BaseHalfNodeDocumentError,
	BaseHalfNodeUpstreamEditError,
	baseHalfIsReservedOutputTreePath,
	createBaseHalfNodeDocument,
	extractBaseHalfNodeUpstreamLenient,
	forkBaseHalfNodeDocument,
	getBaseHalfNodeAgentAuthoringContract,
	getBaseHalfNodeResultArtifact,
	getBaseHalfNodeVideoFields,
	IBaseHalfNodeDocument,
	importBaseHalfNodeResult,
	parseBaseHalfNodeDocument,
	parseBaseHalfNodeDocumentBytes,
	removeBaseHalfNodeUpstreamEntry,
	replaceBaseHalfNodeUpstreamEntry,
	serializeBaseHalfNodeDocument,
	setBaseHalfNodeUpstream,
	withBaseHalfNodeVideoFields
} from '../../common/basehalfNodeDocument.js';
import {
	baseHalfVideoNodePhase,
	beginBaseHalfVideoTask,
	IBaseHalfNodeArtifact,
	IBaseHalfVideoGeneration,
	IBaseHalfVideoGenerationRecord,
	IBaseHalfVideoTask
} from '../../common/basehalfVideoNode.js';
import { baseHalfNodeTestId } from './basehalfNodeTestFixtures.js';

suite('BaseHalfNodeDocument', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('writes a Video node as version 6 with exactly the documented fields, in order', () => {
		assert.strictEqual(BASEHALF_NODE_DOCUMENT_VERSION, 6);
		const running = configuredVideo({ task: runningTask() });
		const written = JSON.parse(serializeBaseHalfNodeDocument(running));
		assert.deepStrictEqual(Object.keys(written), ['version', 'id', 'kind', 'title', 'prompt', 'upstream', 'generation', 'task']);
		assert.deepStrictEqual(parse(written), running);
		assert.ok(Object.isFrozen(running) && Object.isFrozen(running.upstream) && Object.isFrozen(running.task));

		const generated = configuredVideo({ result: generatedResult() });
		assert.deepStrictEqual(Object.keys(JSON.parse(serializeBaseHalfNodeDocument(generated))), ['version', 'id', 'kind', 'title', 'prompt', 'upstream', 'generation', 'result']);
		assert.deepStrictEqual(parseBaseHalfNodeDocument(serializeBaseHalfNodeDocument(generated)), generated);
		assert.deepStrictEqual(getBaseHalfNodeResultArtifact(generated), videoArtifact());
	});

	test('reads the example of the Video node specification as it is written', () => {
		// The specification's example with its provider and model ids replaced by the test catalog's.
		const document = parse({
			version: 6,
			id: '7766b3bb-c97d-4126-80eb-cb3f4fa82bc8',
			kind: 'video',
			title: 'Shot 1',
			prompt: '图片1里的人骑车经过海边，镜头缓慢跟随',
			upstream: ['frames/start.png', 'frames/end.png', 'notes/scene.md'],
			generation: { provider: 'acme', model: 'acme-motion-2', mode: 'frames', params: { resolution: '720p', duration: 5, sound: true } },
			task: runningTask()
		});
		assert.strictEqual(baseHalfVideoNodePhase(document), 'generating');
		assert.deepStrictEqual(document.task?.request.params, { resolution: '720p', duration: 5, sound: true });
	});

	test('shows a version 3, 4, or 5 file as unreadable, naming the version', () => {
		const v4 = {
			version: 4,
			id: baseHalfNodeTestId(2),
			kind: 'video',
			title: 'Legacy',
			role: 'Generated result',
			prompt: '',
			upstream: [],
			recipe: { recipeId: 'ai-video.text-to-video', parameters: {}, inputBindings: [] },
			attempts: []
		};
		assert.throws(() => parse(v4), (error: unknown) => error instanceof BaseHalfNodeDocumentError
			&& error.message === 'document.version 4 is no longer supported: this node was saved by an earlier BaseHalf.'
			&& error.earlierVersion === 4);
		assert.throws(() => parse({ ...v4, version: 3 }), /document.version 3 is no longer supported/);
		// A version 5 node of D58, with a channel and the settings of the window's model table.
		const v5 = { ...emptyVideo(), version: 5, generation: { channel: 'relay-3f2a', model: 'model-x', mode: 'frames', ratio: '16:9', resolution: '720p', duration: 5, audio: true } };
		assert.throws(() => parse(v5), (error: unknown) => error instanceof BaseHalfNodeDocumentError
			&& error.message === 'document.version 5 is no longer supported: this node was saved by an earlier BaseHalf.'
			&& error.earlierVersion === 5);
		assert.throws(() => parse({ ...emptyVideo(), version: 7 }), (error: unknown) => error instanceof BaseHalfNodeDocumentError
			&& /document.version must be 6; it is '7'/.test(error.message)
			&& error.earlierVersion === undefined);
		const withoutVersion: Record<string, unknown> = { ...emptyVideo() };
		delete withoutVersion.version;
		assert.throws(() => parse(withoutVersion), /document.version must be 6/);
	});

	test('refuses an unknown field with its path', () => {
		for (const field of ['role', 'recipe', 'attempts', 'lifecycle']) {
			assert.throws(() => parse({ ...emptyVideo(), [field]: [] }), new RegExp(`^BaseHalfNodeDocumentError: document\\.${field} is not a known field\\.$`));
		}
		assert.throws(() => parse({ ...emptyVideo(), generation: { ...generation(), ratio: '16:9' } }), /document\.generation\.ratio is not a known field/);
		assert.throws(() => parse({ ...emptyVideo(), generation: { ...generation(), channel: 'relay-3f2a' } }), /document\.generation\.channel is not a known field/);
		assert.throws(() => parse({ ...configuredVideo({ task: runningTask() }), task: { ...runningTask(), channel: 'relay-3f2a' } }), /document\.task\.channel is not a known field/);
		assert.throws(() => parse({ ...configuredVideo({ task: runningTask() }), task: { ...runningTask(), progress: 3 } }), /document\.task\.progress is not a known field/);
		assert.throws(() => parse({ ...emptyVideo(), result: { source: 'imported', artifact: { ...videoArtifact(), sha256: 'x' } } }), /document\.result\.artifact\.sha256 is not a known field/);
		assert.throws(() => parse({ ...emptyVideo(), result: { source: 'imported', artifact: videoArtifact(), generation: {} } }), /document\.result\.generation is not a known field/);
	});

	test('refuses a Video node with a task and a result together', () => {
		const together = { ...configuredVideo({ result: generatedResult() }), task: failedTask() };
		assert.throws(() => parse(together), /^BaseHalfNodeDocumentError: document\.task cannot be set while document\.result is set/);
		assert.throws(() => createBaseHalfNodeDocument({ id: baseHalfNodeTestId(3), kind: 'video', title: 'Both', task: failedTask(), result: generatedResult() }), BaseHalfNodeDocumentError);
	});

	test('refuses the video fields on every other kind of node', () => {
		for (const kind of BASEHALF_NODE_KINDS.filter(kind => kind !== 'video')) {
			const node = { version: 6, id: baseHalfNodeTestId(4), kind, title: 'Other', upstream: [] };
			assert.deepStrictEqual(Object.keys(JSON.parse(serializeBaseHalfNodeDocument(parse(node)))), ['version', 'id', 'kind', 'title', 'upstream']);
			assert.throws(() => parse({ ...node, prompt: 'A prompt' }), /document\.prompt is allowed only on a Video node/);
			assert.throws(() => parse({ ...node, generation: generation() }), /document\.generation is allowed only on a Video node/);
			assert.throws(() => parse({ ...node, task: failedTask() }), /document\.task is allowed only on a Video node/);
		}
		const image = { version: 6, id: baseHalfNodeTestId(4), kind: 'image', title: 'Frame', upstream: [] };
		assert.throws(() => parse({ ...image, result: { ...generatedResult(), artifact: { ...videoArtifact(), kind: 'image', path: 'outputs/x/frame.png' } } }), /document\.result\.source 'generated' is allowed only on a Video node/);
		assert.throws(() => parse({ ...image, result: { source: 'imported', artifact: videoArtifact() } }), /document\.result\.artifact\.kind must match document\.kind 'image'/);
	});

	test('requires a prompt on a Video node and checks the video fields through the video contract', () => {
		const withoutPrompt: Record<string, unknown> = { ...emptyVideo() };
		delete withoutPrompt.prompt;
		assert.throws(() => parse(withoutPrompt), /^BaseHalfNodeDocumentError: document\.prompt is required on a Video node\.$/);
		assert.throws(() => parse({ ...emptyVideo(), prompt: 7 }), /document\.prompt must be a string/);
		assert.throws(() => parse({ ...emptyVideo(), generation: { ...generation(), mode: 'storyboard' } }), /^BaseHalfNodeDocumentError: document\.generation\.mode must be one of frames, reference, extend, edit\.$/);
		assert.throws(() => parse({ ...emptyVideo(), generation: { ...generation(), provider: 'Acme Video' } }), /document\.generation\.provider contains unsupported characters/);
		assert.throws(() => parse({ ...emptyVideo(), generation: { ...generation(), params: { duration: [5] } } }), /document\.generation\.params\.duration must be text, a number, or true or false/);
		assert.throws(() => parse({ ...emptyVideo(), generation: { ...generation(), params: { 'two words': 1 } } }), /document\.generation\.params\.two words is not a parameter name/);
		assert.throws(() => parse({ ...emptyVideo(), task: { ...runningTask(), request: { ...request(), providerModel: '' } } }), /document\.task\.request\.providerModel cannot be empty/);
		// Only shapes are read: the catalog knows whether the model and its values exist.
		assert.deepStrictEqual(parse({ ...emptyVideo(), generation: { provider: 'gone', model: 'gone-model', mode: 'edit', params: { anything: 'goes', n: 1.5, on: false } } }).generation,
			{ provider: 'gone', model: 'gone-model', mode: 'edit', params: { anything: 'goes', n: 1.5, on: false } });
		const { remoteId: _remoteId, ...withoutRemoteId } = runningTask();
		assert.throws(() => parse({ ...emptyVideo(), task: withoutRemoteId }), /document\.task\.remoteId is required while the task is running/);
		assert.throws(() => parse({ ...emptyVideo(), prompt: 'a'.repeat(64 * 1024 + 1) }), /document\.prompt is longer than/);
	});

	test('creates an empty node of every kind; a Video node starts with an empty prompt', () => {
		for (const kind of BASEHALF_NODE_KINDS) {
			const node = createBaseHalfNodeDocument({ id: baseHalfNodeTestId(5), kind, title: 'New' });
			assert.deepStrictEqual(node.upstream, []);
			assert.strictEqual(node.result, undefined);
			assert.strictEqual(node.prompt, kind === 'video' ? '' : undefined);
		}
		assert.throws(() => createBaseHalfNodeDocument({ id: 'NOT-A-UUID', kind: 'video', title: 'Bad' }), /document\.id must be/);
		assert.throws(() => createBaseHalfNodeDocument({ id: '7766B3BB-C97D-4126-80EB-CB3F4FA82BC8', kind: 'video', title: 'Bad' }), /document\.id must be a canonical lowercase UUID/);
		assert.throws(() => createBaseHalfNodeDocument({ id: baseHalfNodeTestId(5), kind: 'video', title: '   ' }), /document\.title cannot be empty/);
	});

	test('imports a file only into an empty node', () => {
		const imported = importBaseHalfNodeResult(emptyVideo(), { kind: 'video', path: 'assets/clip.mp4', size: 10 });
		assert.deepStrictEqual(imported.result, { source: 'imported', artifact: { kind: 'video', path: 'assets/clip.mp4', size: 10 } });
		assert.strictEqual(baseHalfVideoNodePhase(imported), 'video');
		assert.throws(() => importBaseHalfNodeResult(imported, { kind: 'video', path: 'assets/other.mp4', size: 10 }), /already shows a file/);
		assert.throws(() => importBaseHalfNodeResult(configuredVideo({ task: failedTask() }), videoArtifact()), /has a generation/);
		assert.throws(() => importBaseHalfNodeResult(emptyVideo(), { kind: 'image', path: 'assets/frame.png', size: 1 }), /must match document\.kind 'video'/);
		const image = importBaseHalfNodeResult(createBaseHalfNodeDocument({ id: baseHalfNodeTestId(6), kind: 'image', title: 'Frame' }), { kind: 'image', path: 'assets/frame.png', size: 1 });
		assert.deepStrictEqual(Object.keys(JSON.parse(serializeBaseHalfNodeDocument(image))), ['version', 'id', 'kind', 'title', 'upstream', 'result']);
	});

	test('a copy keeps the title, prompt, and settings, and has no upstream entries, task, or result', () => {
		const source = configuredVideo({ result: generatedResult() });
		const copy = forkBaseHalfNodeDocument(source, baseHalfNodeTestId(30));
		assert.deepStrictEqual(copy, createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(30),
			kind: 'video',
			title: source.title,
			prompt: source.prompt,
			generation: source.generation
		}));
		assert.deepStrictEqual([copy.upstream, copy.task, copy.result], [[], undefined, undefined]);
		const failedCopy = forkBaseHalfNodeDocument(configuredVideo({ task: failedTask() }), baseHalfNodeTestId(31));
		assert.strictEqual(failedCopy.task, undefined);
		const image = importBaseHalfNodeResult(createBaseHalfNodeDocument({ id: baseHalfNodeTestId(6), kind: 'image', title: 'Frame', upstream: ['a.md'] }), { kind: 'image', path: 'assets/frame.png', size: 1 });
		assert.deepStrictEqual(forkBaseHalfNodeDocument(image, baseHalfNodeTestId(32)), createBaseHalfNodeDocument({ id: baseHalfNodeTestId(32), kind: 'image', title: 'Frame' }));
	});

	test('replaces the video fields of a Video node and keeps every other field', () => {
		const node = configuredVideo({});
		const next = withBaseHalfNodeVideoFields(node, { ...getBaseHalfNodeVideoFields(node), prompt: 'A new prompt' });
		assert.deepStrictEqual({ ...next, prompt: node.prompt }, node);
		assert.strictEqual(next.prompt, 'A new prompt');
		const started = withBaseHalfNodeVideoFields(node, beginBaseHalfVideoTask(getBaseHalfNodeVideoFields(node), {
			id: 'task-2',
			startedAt: '2026-10-15T09:00:00.000Z',
			request: request()
		}));
		assert.deepStrictEqual([started.task?.state, started.upstream, started.title], ['submitting', node.upstream, node.title]);
		assert.throws(() => withBaseHalfNodeVideoFields(createBaseHalfNodeDocument({ id: baseHalfNodeTestId(6), kind: 'image', title: 'Frame' }), { prompt: 'x' }), /document\.kind must be video/);
	});

	test('keeps paths portable and reserves only the root outputs tree', () => {
		for (const path of ['/absolute.mp4', '../escape.mp4', 'C:/escape.mp4', '.bh/private.mp4', 'folder\\file.mp4', 'CON.mp4']) {
			assert.throws(() => importBaseHalfNodeResult(emptyVideo(), { kind: 'video', path, size: 1 }), BaseHalfNodeDocumentError);
		}
		assert.strictEqual(baseHalfIsReservedOutputTreePath('outputs/video.mp4'), true);
		assert.strictEqual(baseHalfIsReservedOutputTreePath('Outputs/video.mp4'), true);
		assert.strictEqual(baseHalfIsReservedOutputTreePath('archive/outputs/video.mp4'), false);
	});

	test('enforces the UTF-8 byte budget and rejects invalid UTF-8 bytes', () => {
		const oversized = JSON.stringify({ ...emptyVideo(), prompt: 'a'.repeat(BASEHALF_NODE_DOCUMENT_MAX_BYTES) });
		assert.throws(() => parseBaseHalfNodeDocument(oversized), /exceeds/);
		assert.throws(() => parseBaseHalfNodeDocumentBytes(new Uint8Array([0xC3, 0x28])), /valid UTF-8/);
		const bytes = new TextEncoder().encode(serializeBaseHalfNodeDocument(emptyVideo()));
		assert.deepStrictEqual(parseBaseHalfNodeDocumentBytes(bytes), emptyVideo());
	});
});

suite('BaseHalfNodeDocument upstream', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('requires an upstream array and keeps every item verbatim', () => {
		const node = emptyVideo();
		const withoutUpstream: Record<string, unknown> = { ...node };
		delete withoutUpstream.upstream;
		assert.throws(() => parse(withoutUpstream), /document\.upstream must be an array/);
		assert.throws(() => parse({ ...node, upstream: 'a.md' }), /document\.upstream must be an array/);

		const odd = [' spaced.md ', 42, { path: 'x' }, '', 'node.bhnode', 'a.md', 'A.md', 'docs/'];
		const parsed = parse({ ...node, upstream: odd });
		assert.deepStrictEqual(parsed.upstream, odd);
		assert.deepStrictEqual(JSON.parse(serializeBaseHalfNodeDocument(parsed)).upstream, odd);
		assert.deepStrictEqual(analyzeBaseHalfNodeUpstream(parsed, 'node.bhnode').map(item => item.problem ?? item.path), [
			' spaced.md ', 'notString', 'notString', 'empty', 'self', 'a.md', 'duplicate', 'docs'
		]);
		const tooMany = parse({ ...node, upstream: Array.from({ length: 66 }, (_, index) => `n${index}.md`) });
		assert.deepStrictEqual(analyzeBaseHalfNodeUpstream(tooMany, 'x.bhnode').filter(item => item.problem).map(item => [item.index, item.problem]), [[64, 'overLimit'], [65, 'overLimit']]);
	});

	test('adds, removes, and replaces entries in every phase', () => {
		const phases = [
			emptyVideo(),
			configuredVideo({ task: runningTask() }),
			configuredVideo({ task: failedTask() }),
			configuredVideo({ result: generatedResult() })
		];
		for (const node of phases) {
			const added = addBaseHalfNodeUpstreamEntry(node, 'notes/extra.md/');
			assert.deepStrictEqual(added.upstream, [...node.upstream, 'notes/extra.md']);
			assert.deepStrictEqual({ ...added, upstream: node.upstream }, node);
			assert.strictEqual(addBaseHalfNodeUpstreamEntry(added, 'Notes/Extra.md'), added);
			assert.deepStrictEqual(removeBaseHalfNodeUpstreamEntry(added, 'notes/extra.md'), node);
			const replaced = replaceBaseHalfNodeUpstreamEntry(added, 'notes/extra.md', 'notes/renamed.md');
			assert.deepStrictEqual(replaced.upstream, [...node.upstream, 'notes/renamed.md']);
			assert.strictEqual(removeBaseHalfNodeUpstreamEntry(node, 'never-listed.md'), node);
		}
	});

	test('replaces an entry in place, or removes it when the new entry is already listed', () => {
		const node = configuredVideo({});
		assert.deepStrictEqual(replaceBaseHalfNodeUpstreamEntry(node, 'frames/start.png', 'frames/first.png').upstream, ['frames/first.png', 'frames/end.png', 'notes/scene.md']);
		assert.deepStrictEqual(replaceBaseHalfNodeUpstreamEntry(node, 'frames/start.png', 'notes/scene.md').upstream, ['frames/end.png', 'notes/scene.md']);
		assert.strictEqual(replaceBaseHalfNodeUpstreamEntry(node, 'gone.md', 'notes/scene.md'), node);
		assert.throws(() => replaceBaseHalfNodeUpstreamEntry(node, 'gone.md', 'new.md'), (error: unknown) => error instanceof BaseHalfNodeUpstreamEditError && error.refusal === 'entryMissing');
	});

	test('refuses a write past 64 entries', () => {
		const full = parse({ ...emptyVideo(), upstream: Array.from({ length: 64 }, (_, index) => `n${index}.md`) });
		assert.throws(() => addBaseHalfNodeUpstreamEntry(full, 'one-more.md'), (error: unknown) => error instanceof BaseHalfNodeUpstreamEditError && error.refusal === 'limit' && /already has 64 upstream entries/.test(error.message));
		assert.strictEqual(addBaseHalfNodeUpstreamEntry(full, 'n3.md'), full);
		assert.strictEqual(removeBaseHalfNodeUpstreamEntry(full, 'n3.md').upstream.length, 63);
		assert.throws(() => setBaseHalfNodeUpstream(full, [...full.upstream, 'x.md']), (error: unknown) => error instanceof BaseHalfNodeUpstreamEditError && error.refusal === 'limit');
	});

	test('a new input order changes the upstream list and nothing else', () => {
		const node = configuredVideo({ result: generatedResult() });
		const swapped = setBaseHalfNodeUpstream(node, ['frames/end.png', 'frames/start.png', 'notes/scene.md']);
		assert.deepStrictEqual(swapped.upstream, ['frames/end.png', 'frames/start.png', 'notes/scene.md']);
		assert.deepStrictEqual({ ...swapped, upstream: node.upstream }, node);
		assert.strictEqual(setBaseHalfNodeUpstream(node, [...node.upstream]), node);
	});

	test('extracts the upstream list of a version 6 node leniently, and nothing else', () => {
		const malformed = JSON.stringify({ version: 6, upstream: ['a.md', 3], task: 'broken', result: { artifact: { path: 'outputs/x/clip.mp4' } } });
		assert.deepStrictEqual(extractBaseHalfNodeUpstreamLenient(malformed), {
			readable: true,
			upstream: ['a.md', 3],
			resultArtifactPath: 'outputs/x/clip.mp4'
		});
		assert.deepStrictEqual(extractBaseHalfNodeUpstreamLenient(JSON.stringify({ version: 6, upstream: [] })), { readable: true, upstream: [] });
		assert.deepStrictEqual(extractBaseHalfNodeUpstreamLenient(JSON.stringify({ version: 5, upstream: ['a.md'] })), { readable: false, reason: 'document.version 5 is no longer supported: this node was saved by an earlier BaseHalf.' });
		const v4 = extractBaseHalfNodeUpstreamLenient(JSON.stringify({ version: 4, upstream: ['a.md'], recipe: { inputBindings: [] }, attempts: [] }));
		assert.deepStrictEqual(v4, { readable: false, reason: 'document.version 4 is no longer supported: this node was saved by an earlier BaseHalf.' });
		assert.strictEqual(extractBaseHalfNodeUpstreamLenient('{').readable, false);
		assert.strictEqual(extractBaseHalfNodeUpstreamLenient('[]').readable, false);
		assert.strictEqual(extractBaseHalfNodeUpstreamLenient(JSON.stringify({ version: 6, upstream: 'a.md' })).readable, false);
		assert.strictEqual(extractBaseHalfNodeUpstreamLenient(JSON.stringify({ version: 9 })).readable, false);
	});
});

suite('BaseHalfNodeDocument agent authoring', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('publishes the fields an agent may write and keeps the task and result for BaseHalf', () => {
		const contract = getBaseHalfNodeAgentAuthoringContract() as Record<string, any>;
		assert.strictEqual(contract.contractVersion, 4);
		assert.deepStrictEqual(contract.hostOwnedFields, ['task', 'result']);
		assert.deepStrictEqual(contract.schema.required, ['version', 'id', 'kind', 'title', 'prompt', 'upstream']);
		assert.deepStrictEqual(Object.keys(contract.schema.properties), ['version', 'id', 'kind', 'title', 'prompt', 'upstream', 'generation', 'task', 'result']);
		assert.deepStrictEqual([contract.schema.properties.task, contract.schema.properties.result], [false, false]);
		assert.deepStrictEqual(contract.schema.properties.kind, { const: 'video' });
		assert.deepStrictEqual(contract.schema.properties.version, { const: 6 });
		assert.deepStrictEqual(Object.keys(contract.schema.properties.generation.properties), ['provider', 'model', 'mode', 'params']);
		assert.deepStrictEqual(contract.examples.configured.generation, { provider: 'provider-id', model: 'model-id', mode: 'frames', params: { duration: 5 } });
		assert.ok(contract.rules.some((rule: string) => rule.includes('host.videoCatalog')));
		// With a model of this computer's catalog, the example names it.
		const fromCatalog = getBaseHalfNodeAgentAuthoringContract(generation()) as Record<string, any>;
		assert.deepStrictEqual(fromCatalog.examples.configured.generation, generation());
		for (const example of Object.values(contract.examples)) {
			const document = parse(example);
			assert.deepStrictEqual([document.task, document.result], [undefined, undefined]);
			assert.deepStrictEqual(JSON.parse(serializeBaseHalfNodeDocument(document)), example);
		}
		assert.ok(contract.rules.some((rule: string) => rule.includes('basehalf --run-node')));
		assert.doesNotMatch(JSON.stringify(contract), /recipe|attempt|binding|role|channel/i);
	});

	test('reads an agent-written Video node with a title, prompt, upstream, and settings, ready to run', () => {
		const written = {
			version: 6,
			id: baseHalfNodeTestId(40),
			kind: 'video',
			title: 'Shot 3',
			prompt: 'Image 1 slowly turns into Image 2.',
			upstream: ['frames/a.png', 'frames/b.png'],
			generation: { provider: 'acme', model: 'acme-motion-2', params: { duration: 8 } }
		};
		const document = parse(written);
		assert.strictEqual(baseHalfVideoNodePhase(document), 'empty');
		assert.deepStrictEqual(JSON.parse(serializeBaseHalfNodeDocument(document)), written);
		const started = withBaseHalfNodeVideoFields(document, beginBaseHalfVideoTask(getBaseHalfNodeVideoFields(document), {
			id: 'task-1',
			startedAt: '2026-10-15T08:00:00.000Z',
			request: { ...request(), prompt: document.prompt!, inputs: ['frames/a.png', 'frames/b.png'] }
		}));
		assert.strictEqual(baseHalfVideoNodePhase(started), 'generating');
	});
});

function parse(value: unknown): IBaseHalfNodeDocument {
	return parseBaseHalfNodeDocument(JSON.stringify(value));
}

function emptyVideo(): IBaseHalfNodeDocument {
	return createBaseHalfNodeDocument({ id: baseHalfNodeTestId(1), kind: 'video', title: 'Shot 1' });
}

function configuredVideo(fields: { readonly task?: IBaseHalfVideoTask; readonly result?: IBaseHalfNodeDocument['result'] }): IBaseHalfNodeDocument {
	return createBaseHalfNodeDocument({
		id: baseHalfNodeTestId(1),
		kind: 'video',
		title: 'Shot 1',
		prompt: 'The rider in Image 1 cycles along the coast.',
		upstream: ['frames/start.png', 'frames/end.png', 'notes/scene.md'],
		generation: generation(),
		...fields
	});
}

function generation(): IBaseHalfVideoGeneration {
	return { provider: 'acme', model: 'acme-motion-2', mode: 'frames', params: { resolution: '720p', duration: 5, sound: true } };
}

function request(): IBaseHalfVideoGenerationRecord {
	return {
		provider: 'acme',
		region: 'east',
		model: 'acme-motion-2',
		providerModel: 'acme-motion-2-e-260101',
		mode: 'frames',
		params: { resolution: '720p', duration: 5, sound: true },
		prompt: 'The rider in Image 1 cycles along the coast.\n\nThe sea at dusk.',
		inputs: ['frames/start.png', 'frames/end.png', 'notes/scene.md']
	};
}

function runningTask(): IBaseHalfVideoTask {
	return {
		id: '20261015T080000-k3f9',
		state: 'running',
		startedAt: '2026-10-15T08:00:00.000Z',
		remoteId: 'cgt-20261015080001-abcd',
		request: request()
	};
}

function failedTask(): IBaseHalfVideoTask {
	return {
		id: '20261015T080000-k3f9',
		state: 'failed',
		startedAt: '2026-10-15T08:00:00.000Z',
		endedAt: '2026-10-15T08:01:00.000Z',
		error: 'The key was refused.',
		request: request()
	};
}

function videoArtifact(): IBaseHalfNodeArtifact {
	return { kind: 'video', path: `outputs/${baseHalfNodeTestId(1)}/20261015T080000-k3f9.mp4`, size: 1024 };
}

function generatedResult(): NonNullable<IBaseHalfNodeDocument['result']> {
	return {
		source: 'generated',
		artifact: videoArtifact(),
		generation: {
			taskId: '20261015T080000-k3f9',
			remoteId: 'cgt-20261015080001-abcd',
			startedAt: '2026-10-15T08:00:00.000Z',
			completedAt: '2026-10-15T08:03:00.000Z',
			request: request()
		}
	};
}
