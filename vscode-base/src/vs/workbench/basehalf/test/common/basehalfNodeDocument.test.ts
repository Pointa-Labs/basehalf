/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	BASEHALF_NODE_DOCUMENT_MAX_BYTES,
	BASEHALF_NODE_DOCUMENT_VERSION,
	BASEHALF_NODE_PROMPT_MAX_LENGTH,
	BaseHalfNodeDocumentError,
	IBaseHalfNodeDocument,
	IBaseHalfNodeRecipe,
	IBaseHalfNodeResultArtifact,
	baseHalfIsReservedOutputTreePath,
	baseHalfNodeRecipeReferencesPath,
	beginBaseHalfNodeAttempt,
	cancelBaseHalfNodeAttempt,
	completeBaseHalfNodeAttempt,
	createBaseHalfNodeDocument,
	failBaseHalfNodeAttempt,
	forkBaseHalfNodeDocument,
	freezeBaseHalfNodeAttemptInputs,
	freezeBaseHalfNodeAttemptModel,
	freezeBaseHalfNodeAttemptProviderRequestId,
	replaceBaseHalfNodeAttemptProviderRequestId,
	getBaseHalfNodeAgentAuthoringContract,
	getBaseHalfNodeReadiness,
	getBaseHalfNodeResultArtifact,
	importBaseHalfNodeResult,
	interruptBaseHalfNodeAttempt,
	parseBaseHalfNodeDocument,
	parseBaseHalfNodeDocumentBytes,
	parseBaseHalfNodeDocumentForActiveHost,
	remapBaseHalfNodeRecipeInputBindings,
	removeBaseHalfNodeRecipeInputBindings,
	serializeBaseHalfNodeDocument,
	updateBaseHalfNodePrompt
} from '../../common/basehalfNodeDocument.js';
import { baseHalfNodeTestId } from './basehalfNodeTestFixtures.js';

suite('BaseHalfNodeDocument', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('creates and round-trips the small deeply frozen v3 document', () => {
		const document = createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(1),
			kind: 'video',
			title: 'Launch film',
			role: 'Generated result',
			recipe: recipe()
		});
		const serialized = serializeBaseHalfNodeDocument(document);
		const parsed = parseBaseHalfNodeDocument(serialized);

		assert.strictEqual(BASEHALF_NODE_DOCUMENT_VERSION, 3);
		assert.deepStrictEqual(Object.keys(parsed), ['version', 'id', 'kind', 'title', 'role', 'prompt', 'recipe', 'attempts']);
		assert.deepStrictEqual(parsed, document);
		assert.ok(serialized.endsWith('\n'));
		assert.strictEqual(Object.isFrozen(parsed), true);
		assert.strictEqual(Object.isFrozen(parsed.recipe), true);
		assert.strictEqual(Object.isFrozen(parsed.recipe?.parameters), true);
		assert.strictEqual(Object.isFrozen(parsed.recipe?.inputBindings), true);
		assert.strictEqual(Object.isFrozen(parsed.attempts), true);
	});

	test('rejects v2 and every retired lifecycle field without migration', () => {
		const empty = emptyDraft();
		assert.throws(() => parse({ ...empty, version: 2 }), /Unsupported node document version '2'/);
		for (const key of ['current', 'revisions', 'versions', 'selection', 'runs']) {
			assert.throws(() => parse({ ...empty, [key]: key === 'current' ? { source: 'empty', outputPaths: [] } : [] }), new RegExp(`unsupported property '${key}'`));
		}
	});

	test('publishes only agent-authorable draft fields', () => {
		const contract = getBaseHalfNodeAgentAuthoringContract();
		const schema = contract.schema as {
			readonly required: readonly string[];
			readonly properties: Readonly<Record<string, unknown>>;
		};
		assert.deepStrictEqual(schema.required, ['version', 'id', 'kind', 'title', 'role', 'prompt', 'attempts']);
		assert.strictEqual((schema.properties.result as boolean), false);
		assert.deepStrictEqual(contract.hostOwnedFields, ['result', 'attempts']);
		const examples = contract.examples as Readonly<Record<string, unknown>>;
		for (const example of Object.values(examples)) {
			const parsed = parse(example);
			assert.strictEqual(parsed.version, 3);
			assert.deepStrictEqual(parsed.attempts, []);
			assert.strictEqual(parsed.result, undefined);
		}
	});

	test('requires a caller-supplied canonical UUID and a supported result kind', () => {
		assert.throws(() => parse({ ...emptyDraft(), id: 'node-1' }), /canonical lowercase UUID/);
		assert.throws(() => parse({ ...emptyDraft(), id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'.toUpperCase() }), /canonical lowercase UUID/);
		assert.throws(() => parse({ ...emptyDraft(), kind: 'text' }), /document.kind/);
		assert.throws(() => parse({ ...emptyDraft(), unknown: true }), /unsupported property 'unknown'/);
	});

	test('persists a host-owned prompt before a recipe exists and freezes it into the first Attempt', () => {
		const empty = emptyDraft();
		assert.strictEqual(empty.recipe, undefined);
		assert.strictEqual(empty.prompt, '');

		const prompted = updateBaseHalfNodePrompt(empty, 'A slow orbit around a walnut speaker.');
		assert.strictEqual(parseBaseHalfNodeDocument(serializeBaseHalfNodeDocument(prompted)).prompt, prompted.prompt);

		const configured = createBaseHalfNodeDocument({
			...prompted,
			recipe: recipe()
		});
		const running = start(configured);
		assert.strictEqual(running.attempts[0].prompt, prompted.prompt);
		assert.throws(() => updateBaseHalfNodePrompt(running, 'Different intent'), /prompt is frozen/);
		assert.throws(() => parse({ ...running, prompt: 'Different intent' }), /document.prompt is frozen/);
	});

	test('bounds prompt text while preserving intentional tabs and line breaks', () => {
		const multiline = updateBaseHalfNodePrompt(emptyDraft(), 'First line\n\tSecond line\r\n');
		assert.strictEqual(multiline.prompt, 'First line\n\tSecond line\r\n');
		assert.strictEqual(updateBaseHalfNodePrompt(emptyDraft(), 'x'.repeat(BASEHALF_NODE_PROMPT_MAX_LENGTH)).prompt.length, BASEHALF_NODE_PROMPT_MAX_LENGTH);
		assert.throws(() => updateBaseHalfNodePrompt(emptyDraft(), 'x'.repeat(BASEHALF_NODE_PROMPT_MAX_LENGTH + 1)), /prompt is too long/);
		assert.throws(() => updateBaseHalfNodePrompt(emptyDraft(), 'unsafe\u0000prompt'), /cannot contain NUL/);
		assert.throws(() => updateBaseHalfNodePrompt(emptyDraft(), 'unsafe\u0001prompt'), /cannot contain control characters/);
	});

	test('keeps the prompt immutable after a failed Attempt', () => {
		const running = start(createBaseHalfNodeDocument({
			...configuredDraft(),
			prompt: 'Frozen failed intent'
		}));
		const failed = failBaseHalfNodeAttempt(running, 'attempt-1', {
			completedAt: '2026-08-13T08:01:00.000Z',
			error: 'provider unavailable'
		});
		assert.strictEqual(failed.attempts[0].prompt, 'Frozen failed intent');
		assert.throws(() => updateBaseHalfNodePrompt(failed, 'Changed after failure'), /prompt is frozen/);
		assert.throws(() => parse({ ...failed, prompt: 'Changed after failure' }), /document.prompt is frozen/);
	});

	test('starts one durable running attempt and every reader preserves it', () => {
		const running = start(configuredDraft());
		const source = serializeBaseHalfNodeDocument(running);

		assert.strictEqual(running.attempts[0].status, 'running');
		assert.deepStrictEqual(running.attempts[0].recipe, running.recipe);
		assert.strictEqual(parseBaseHalfNodeDocument(source).attempts[0].status, 'running');
		assert.strictEqual(parseBaseHalfNodeDocumentForActiveHost(source).attempts[0].status, 'running');
		assert.throws(() => beginBaseHalfNodeAttempt(running, beginOptions('attempt-2')), /already has an active attempt/);
		assert.deepStrictEqual(getBaseHalfNodeReadiness(running), { ready: false, code: 'busy' });
	});

	test('requires the running attempt to be unique and last', () => {
		const first = start(configuredDraft());
		const second = { ...first.attempts[0], id: 'attempt-2' };
		assert.throws(() => parse({ ...first, attempts: [first.attempts[0], second] }), /more than one running attempt/);
		const failed = failBaseHalfNodeAttempt(first, 'attempt-1', {
			completedAt: '2026-08-13T08:01:00.000Z',
			error: 'offline'
		});
		const retry = start(failed, 'attempt-2');
		assert.throws(() => parse({ ...retry, attempts: [retry.attempts[1], retry.attempts[0]] }), /running attempt must be the last/);
	});

	test('freezes model and direct-input snapshots only while an attempt is running', () => {
		const draft = createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(2),
			kind: 'video',
			title: 'Input film',
			role: 'Generated result',
			recipe: recipeWithInput()
		});
		const preparing = beginBaseHalfNodeAttempt(draft, {
			...beginOptions('attempt-input'),
			inputs: []
		});
		const withInputs = freezeBaseHalfNodeAttemptInputs(preparing, 'attempt-input', [{
			sourcePath: 'briefs/launch.md',
			slot: 'brief',
			order: 0,
			revision: 'sha256:brief-v1'
		}]);
		assert.throws(() => freezeBaseHalfNodeAttemptInputs(withInputs, 'attempt-input', withInputs.attempts[0].inputs), /already has frozen inputs/);

		const failed = failBaseHalfNodeAttempt(withInputs, 'attempt-input', {
			completedAt: '2026-08-13T08:01:00.000Z',
			error: 'provider unavailable'
		});
		assert.throws(() => freezeBaseHalfNodeAttemptModel(failed, 'attempt-input', { source: 'local' }), /is not running/);
		assert.strictEqual(Object.isFrozen(failed.attempts[0].recipe), true);
		assert.strictEqual(Object.isFrozen(failed.attempts[0].inputs), true);
	});

	test('persists one provider task id while an asynchronous attempt is running', () => {
		const running = start(configuredDraft());
		const submitted = freezeBaseHalfNodeAttemptProviderRequestId(running, 'attempt-1', 'provider/task-42');
		assert.strictEqual(submitted.attempts[0].providerRequestId, 'provider/task-42');
		assert.strictEqual(parseBaseHalfNodeDocument(serializeBaseHalfNodeDocument(submitted)).attempts[0].providerRequestId, 'provider/task-42');
		assert.strictEqual(freezeBaseHalfNodeAttemptProviderRequestId(submitted, 'attempt-1', 'provider/task-42').attempts[0].providerRequestId, 'provider/task-42');
		assert.throws(
			() => freezeBaseHalfNodeAttemptProviderRequestId(submitted, 'attempt-1', 'provider/task-43'),
			/already has a different provider request id/
		);
		const resubmitted = replaceBaseHalfNodeAttemptProviderRequestId(
			submitted,
			'attempt-1',
			'provider/task-42',
			'provider/task-43'
		);
		assert.strictEqual(resubmitted.attempts[0].providerRequestId, 'provider/task-43');
		assert.throws(
			() => replaceBaseHalfNodeAttemptProviderRequestId(resubmitted, 'attempt-1', 'provider/task-42', 'provider/task-44'),
			/no longer has the expected provider request id/
		);
		const failed = failBaseHalfNodeAttempt(submitted, 'attempt-1', {
			completedAt: '2026-08-13T08:01:00.000Z',
			error: 'provider failed after submission'
		});
		assert.strictEqual(failed.attempts[0].providerRequestId, 'provider/task-42');
	});

	test('retries in the same node with the exact frozen recipe snapshot', () => {
		const first = start(configuredDraft());
		const failed = failBaseHalfNodeAttempt(first, 'attempt-1', {
			completedAt: '2026-08-13T08:01:00.000Z',
			error: 'temporary provider failure',
			providerRequestId: 'provider-request-1',
			usage: { inputTokens: 4 },
			cost: { currency: 'USD', amount: '0.02', kind: 'actual' }
		});
		const retry = start(failed, 'attempt-2');

		assert.strictEqual(retry.attempts.length, 2);
		assert.deepStrictEqual(retry.attempts[0].recipe, retry.attempts[1].recipe);
		assert.deepStrictEqual(retry.recipe, retry.attempts[0].recipe);
		assert.strictEqual(retry.attempts[0].providerRequestId, 'provider-request-1');
		assert.deepStrictEqual(retry.attempts[0].usage, { inputTokens: 4 });
		assert.deepStrictEqual(retry.attempts[0].cost, { currency: 'USD', amount: '0.02', kind: 'actual' });
	});

	test('freezes the live recipe after the first attempt', () => {
		const failed = failBaseHalfNodeAttempt(start(configuredDraft()), 'attempt-1', {
			completedAt: '2026-08-13T08:01:00.000Z',
			error: 'offline'
		});
		const changedRecipe = { ...failed.recipe!, parameters: { prompt: 'different intent' } };
		assert.throws(() => parse({ ...failed, recipe: changedRecipe }), /recipe is frozen/);
		assert.throws(() => remapBaseHalfNodeRecipeInputBindings(failedWithInput(), 'briefs', 'moved'), /recipe is frozen/);
		assert.throws(() => removeBaseHalfNodeRecipeInputBindings(failedWithInput(), 'briefs/launch.md'), /recipe is frozen/);
	});

	test('still remaps and removes bindings from an unattempted draft', () => {
		const draft = createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(3),
			kind: 'video',
			title: 'Draft',
			role: 'Generated result',
			recipe: recipeWithInput()
		});
		const moved = remapBaseHalfNodeRecipeInputBindings(draft, 'briefs', 'inputs');
		assert.strictEqual(moved.recipe?.inputBindings[0].sourcePath, 'inputs/launch.md');
		assert.strictEqual(baseHalfNodeRecipeReferencesPath(moved, 'inputs'), true);
		const removed = removeBaseHalfNodeRecipeInputBindings(moved, 'inputs/launch.md');
		assert.deepStrictEqual(removed.recipe?.inputBindings, []);
	});

	test('success atomically seals exactly one result artifact', () => {
		const completed = completeBaseHalfNodeAttempt(start(configuredDraft()), 'attempt-1', {
			completedAt: '2026-08-13T08:01:00.000Z',
			artifact: artifact(),
			providerRequestId: 'provider-request-1',
			usage: { videoSeconds: 5 },
			cost: { currency: 'USD', amount: '0.30', kind: 'actual' }
		});

		assert.strictEqual(completed.attempts[0].status, 'succeeded');
		assert.deepStrictEqual(completed.result, {
			source: 'attempt',
			attemptId: 'attempt-1',
			artifact: artifact()
		});
		assert.deepStrictEqual(getBaseHalfNodeResultArtifact(completed), artifact());
		assert.deepStrictEqual(getBaseHalfNodeReadiness(completed), { ready: false, code: 'sealed' });
		assert.strictEqual(Object.isFrozen(completed.result), true);
		assert.strictEqual(Object.isFrozen(completed.result?.artifact), true);
	});

	test('forbids replacing a sealed result or adding another successful attempt', () => {
		const completed = completeBaseHalfNodeAttempt(start(configuredDraft()), 'attempt-1', {
			completedAt: '2026-08-13T08:01:00.000Z',
			artifact: artifact()
		});
		assert.throws(() => beginBaseHalfNodeAttempt(completed, beginOptions('attempt-2')), /sealed result node/);
		assert.throws(() => completeBaseHalfNodeAttempt(completed, 'attempt-1', {
			completedAt: '2026-08-13T08:02:00.000Z',
			artifact: { ...artifact(), id: 'replacement' }
		}), /is not running/);
		assert.throws(() => importBaseHalfNodeResult(completed, { ...artifact(), id: 'replacement' }), /sealed result cannot be replaced/);

		const duplicate = { ...completed.attempts[0], id: 'attempt-2' };
		assert.throws(() => parse({ ...completed, attempts: [completed.attempts[0], duplicate] }), /more than one successful attempt/);
	});

	test('requires an attempt result to point to the unique final success', () => {
		const completed = completeBaseHalfNodeAttempt(start(configuredDraft()), 'attempt-1', {
			completedAt: '2026-08-13T08:01:00.000Z',
			artifact: artifact()
		});
		const { result: _result, ...withoutResult } = completed;
		assert.throws(() => parse(withoutResult), /successful attempt requires its sealed attempt result/);
		assert.throws(() => parse({ ...completed, result: { ...completed.result, attemptId: 'missing' } }), /must point to the unique successful attempt/);
		assert.throws(() => parse({ ...completed, result: { ...completed.result, artifact: { ...artifact(), kind: 'image' } } }), /must match document.kind/);
	});

	test('imports only into an empty unconfigured draft and seals it', () => {
		const imported = importBaseHalfNodeResult(emptyDraft(), artifact());
		assert.deepStrictEqual(imported.result, { source: 'imported', artifact: artifact() });
		assert.deepStrictEqual(imported.attempts, []);
		assert.strictEqual(imported.recipe, undefined);
		assert.deepStrictEqual(getBaseHalfNodeReadiness(imported), { ready: false, code: 'sealed' });
		assert.throws(() => importBaseHalfNodeResult(configuredDraft(), artifact()), /empty draft with no recipe or attempts/);
		assert.throws(() => parse({ ...imported, recipe: recipe() }), /empty draft with no recipe or attempts/);
	});

	test('records failed, cancelled, and interrupted attempts without artifacts', () => {
		const failed = failBaseHalfNodeAttempt(start(configuredDraft()), 'attempt-1', {
			completedAt: '2026-08-13T08:01:00.000Z',
			error: 'provider failed'
		});
		assert.strictEqual(failed.attempts[0].status, 'failed');
		assert.strictEqual(failed.result, undefined);

		const cancelled = cancelBaseHalfNodeAttempt(start(configuredDraft()), 'attempt-1', {
			completedAt: '2026-08-13T08:01:00.000Z',
			error: 'user cancelled'
		});
		assert.strictEqual(cancelled.attempts[0].status, 'cancelled');

		const interrupted = interruptBaseHalfNodeAttempt(start(configuredDraft()), 'attempt-1', {
			error: 'host exited',
			providerRequestId: 'provider-request-1',
			usage: { inputTokens: 2 },
			cost: { currency: 'USD', amount: '0', kind: 'actual' }
		});
		assert.strictEqual(interrupted.attempts[0].status, 'interrupted');
		assert.strictEqual(interrupted.attempts[0].completedAt, undefined);
	});

	test('enforces terminal lifecycle timestamps and audit disclosures', () => {
		const running = start(configuredDraft());
		const submitted = parse({
			...running,
			attempts: [{ ...running.attempts[0], providerRequestId: 'too-early' }]
		});
		assert.strictEqual(submitted.attempts[0].providerRequestId, 'too-early');
		assert.throws(() => parse({
			...running,
			attempts: [{ ...running.attempts[0], usage: { videoSeconds: 5 } }]
		}), /running attempts cannot contain completed usage or cost/);
		assert.throws(() => parse({
			...running,
			attempts: [{ ...running.attempts[0], status: 'failed', completedAt: '2026-08-13T08:01:00.000Z' }]
		}), /failed attempts require an error message/);
		assert.throws(() => failBaseHalfNodeAttempt(running, 'attempt-1', {
			completedAt: '2026-08-13T07:59:00.000Z',
			error: 'clock error'
		}), /cannot precede the attempt start/);
	});

	test('forks authored setup but never aliases a result or attempt history', () => {
		const completed = completeBaseHalfNodeAttempt(start(configuredDraft()), 'attempt-1', {
			completedAt: '2026-08-13T08:01:00.000Z',
			artifact: artifact()
		});
		const fork = forkBaseHalfNodeDocument(completed, baseHalfNodeTestId(9));
		assert.strictEqual(fork.id, baseHalfNodeTestId(9));
		assert.strictEqual(fork.kind, completed.kind);
		assert.strictEqual(fork.result, undefined);
		assert.deepStrictEqual(fork.attempts, []);
		assert.deepStrictEqual(fork.recipe?.inputBindings, []);
		assert.strictEqual(fork.prompt, completed.prompt);
		assert.strictEqual(updateBaseHalfNodePrompt(fork, 'Fresh Draft intent').prompt, 'Fresh Draft intent');
	});

	test('reports structural model and source readiness for unsealed drafts', () => {
		assert.deepStrictEqual(getBaseHalfNodeReadiness(emptyDraft()), { ready: false, code: 'notExecutable' });
		const draft = createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(4),
			kind: 'video',
			title: 'Service film',
			role: 'Generated result',
			recipe: {
				...recipeWithInput(),
				modelServiceId: 'studio.video',
				modelId: 'video-v3'
			}
		});
		assert.deepStrictEqual(getBaseHalfNodeReadiness(draft, { availableModelServiceIds: [] }), { ready: false, code: 'modelServiceUnavailable' });
		assert.deepStrictEqual(getBaseHalfNodeReadiness(draft, {
			availableModelServiceIds: ['studio.video'],
			availableSourcePaths: []
		}), { ready: false, code: 'sourceUnavailable', missingSourcePaths: ['briefs/launch.md'] });
		assert.deepStrictEqual(getBaseHalfNodeReadiness(draft, {
			availableModelServiceIds: ['studio.video'],
			availableSourcePaths: ['briefs/launch.md']
		}), { ready: true, code: 'ready' });
	});

	test('keeps paths portable and protects derived metadata', () => {
		for (const path of ['/absolute.mp4', '../escape.mp4', 'C:/escape.mp4', '.bh/private.mp4', 'folder\\file.mp4', 'CON.mp4']) {
			assert.throws(() => importBaseHalfNodeResult(emptyDraft(), { ...artifact(), path }), BaseHalfNodeDocumentError);
		}
		assert.strictEqual(baseHalfIsReservedOutputTreePath('outputs/video.mp4'), true);
		assert.strictEqual(baseHalfIsReservedOutputTreePath('Outputs/video.mp4'), true);
		assert.strictEqual(baseHalfIsReservedOutputTreePath('archive/outputs/video.mp4'), false);
	});

	test('rejects malformed artifacts, model snapshots, and unbounded JSON', () => {
		assert.throws(() => importBaseHalfNodeResult(emptyDraft(), { ...artifact(), sha256: 'hex-is-not-supported' }), /unpadded Base64 SHA-256/);
		assert.throws(() => importBaseHalfNodeResult(emptyDraft(), { ...artifact(), kind: 'image' }), /must match document.kind/);
		assert.throws(() => beginBaseHalfNodeAttempt(configuredDraft(), {
			...beginOptions('attempt-1'),
			model: {
				source: 'service',
				connection: 'unavailable',
				serviceId: 'studio.video',
				capability: 'video'
			}
		}), /must identify the recipe's configured model service/);
		const tooDeep: Record<string, unknown> = {};
		let cursor = tooDeep;
		for (let index = 0; index < 20; index++) {
			cursor.next = {};
			cursor = cursor.next as Record<string, unknown>;
		}
		assert.throws(() => createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(5),
			kind: 'video',
			title: 'Too deep',
			role: 'Generated result',
			recipe: { ...recipe(), parameters: tooDeep as never }
		}), /maximum JSON nesting depth/);
	});

	test('enforces the UTF-8 byte budget and rejects invalid UTF-8 bytes', () => {
		const oversized = JSON.stringify({ ...emptyDraft(), padding: 'a'.repeat(BASEHALF_NODE_DOCUMENT_MAX_BYTES) });
		assert.throws(() => parseBaseHalfNodeDocument(oversized), /exceeds/);
		assert.throws(() => parseBaseHalfNodeDocumentBytes(new Uint8Array([0xC3, 0x28])), /valid UTF-8/);
		const bytes = new TextEncoder().encode(serializeBaseHalfNodeDocument(emptyDraft()));
		assert.deepStrictEqual(parseBaseHalfNodeDocumentBytes(bytes), emptyDraft());
	});
});

function parse(value: unknown): IBaseHalfNodeDocument {
	return parseBaseHalfNodeDocument(JSON.stringify(value));
}

function emptyDraft(): IBaseHalfNodeDocument {
	return createBaseHalfNodeDocument({
		id: baseHalfNodeTestId(1),
		kind: 'video',
		title: 'Launch film',
		role: 'Generated result'
	});
}

function configuredDraft(): IBaseHalfNodeDocument {
	return createBaseHalfNodeDocument({
		id: baseHalfNodeTestId(1),
		kind: 'video',
		title: 'Launch film',
		role: 'Generated result',
		recipe: recipe()
	});
}

function recipe(): IBaseHalfNodeRecipe {
	return {
		recipeId: 'ai-video.text-to-video',
		parameters: { prompt: 'A quiet orbit around the product', duration: 5 },
		inputBindings: []
	};
}

function recipeWithInput(): IBaseHalfNodeRecipe {
	return {
		...recipe(),
		inputBindings: [{ sourcePath: 'briefs/launch.md', slot: 'brief', order: 0 }]
	};
}

function beginOptions(id: string) {
	return {
		id,
		createdAt: '2026-08-13T08:00:00.000Z',
		startedAt: '2026-08-13T08:00:01.000Z',
		model: { source: 'local' as const },
		inputs: []
	};
}

function start(document: IBaseHalfNodeDocument, id = 'attempt-1'): IBaseHalfNodeDocument {
	return beginBaseHalfNodeAttempt(document, beginOptions(id));
}

function artifact(): IBaseHalfNodeResultArtifact {
	return {
		id: 'artifact-1',
		outputId: 'video-main',
		kind: 'video',
		path: 'outputs/launch-film.mp4',
		sha256: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
		size: 1024,
		label: 'Launch film'
	};
}

function failedWithInput(): IBaseHalfNodeDocument {
	const draft = createBaseHalfNodeDocument({
		id: baseHalfNodeTestId(8),
		kind: 'video',
		title: 'Input film',
		role: 'Generated result',
		recipe: recipeWithInput()
	});
	const running = beginBaseHalfNodeAttempt(draft, {
		...beginOptions('attempt-input'),
		inputs: [{
			sourcePath: 'briefs/launch.md',
			slot: 'brief',
			order: 0,
			revision: 'sha256:brief-v1'
		}]
	});
	return failBaseHalfNodeAttempt(running, 'attempt-input', {
		completedAt: '2026-08-13T08:01:00.000Z',
		error: 'offline'
	});
}
