/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	BASEHALF_NODE_DOCUMENT_MAX_BYTES,
	BaseHalfNodeCurrentSource,
	BaseHalfNodeDocumentError,
	BaseHalfNodeJsonValue,
	BaseHalfNodeRunStatus,
	IBaseHalfNodeDocument,
	beginBaseHalfNodeRun,
	cancelBaseHalfNodeRun,
	completeBaseHalfNodeRun,
	createBaseHalfNodeDocument,
	failBaseHalfNodeRun,
	forkBaseHalfNodeDocument,
	freezeBaseHalfNodeRunInputs,
	freezeBaseHalfNodeRunModel,
	getBaseHalfNodeCurrentPrimaryArtifact,
	getBaseHalfNodeAgentAuthoringContract,
	getBaseHalfNodeReadiness,
	importBaseHalfNodeCurrent,
	interruptBaseHalfNodeRun,
	isBaseHalfNodeDocumentStale,
	baseHalfIsReservedOutputTreePath,
	baseHalfNodeRecipeReferencesPath,
	parseBaseHalfNodeDocument,
	parseBaseHalfNodeDocumentBytes,
	parseBaseHalfNodeDocumentForActiveHost,
	remapBaseHalfNodeRecipeInputBindings,
	removeBaseHalfNodeRecipeInputBindings,
	selectBaseHalfNodeCurrent,
	serializeBaseHalfNodeDocument,
} from '../../common/basehalfNodeDocument.js';
import { baseHalfNodeTestId } from './basehalfNodeTestFixtures.js';

suite('BaseHalfNodeDocument', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('creates and round-trips a readable, deeply immutable v2 document', () => {
		const document = parse(successfulDocument());
		const serialized = serializeBaseHalfNodeDocument(document);
		const roundTripped = parseBaseHalfNodeDocument(serialized);

		assert.ok(serialized.endsWith('\n'));
		assert.ok(serialized.includes('\n\t"current"'));
		assert.deepStrictEqual(roundTripped, document);
		assert.strictEqual(Object.isFrozen(document), true);
		assert.strictEqual(Object.isFrozen(document.current), true);
		assert.strictEqual(Object.isFrozen(document.current.outputPaths), true);
		assert.strictEqual(Object.isFrozen(document.runs), true);
		assert.strictEqual(Object.isFrozen(document.revisions), true);
		assert.strictEqual(Object.isFrozen(document.runs[0]), true);
		assert.strictEqual(Object.isFrozen(document.runs[0].recipe.parameters), true);
		assert.strictEqual(Object.isFrozen(document.runs[0].artifacts), true);
	});

	test('requires a caller-supplied stable id and creates an empty content node without a recipe', () => {
		const document = createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(7),
			kind: 'file',
			title: 'Handoff',
			role: 'result'
		});

		assert.deepStrictEqual(document, {
			version: 2,
			id: baseHalfNodeTestId(7),
			kind: 'file',
			title: 'Handoff',
			role: 'result',
			current: { source: 'empty', outputPaths: [] },
			revisions: [],
			runs: []
		});
		assert.deepStrictEqual(getBaseHalfNodeReadiness(document), { ready: false, code: 'notExecutable' });
		assert.throws(() => parse({ ...baseDocument(), kind: 'text' }), /document.kind/);
		assert.throws(() => parse({ ...baseDocument(), kind: 'code' }), /document.kind/);
		assert.throws(() => parse({ ...baseDocument(), id: 'node-7' }), /canonical lowercase UUID/);
		assert.throws(() => parse({ ...baseDocument(), id: '6F690FA8-04AB-49C1-A6C8-44DF124DEDF3' }), /canonical lowercase UUID/);
	});

	test('publishes parser-backed authoring examples that round-trip as empty lifecycle documents', () => {
		const contract = getBaseHalfNodeAgentAuthoringContract();
		const schema = contract.schema as { readonly properties: { readonly id: { readonly pattern: string; readonly minLength: number; readonly maxLength: number } } };
		assert.deepStrictEqual(schema.properties.id, {
			type: 'string',
			pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
			minLength: 36,
			maxLength: 36
		});
		const examples = contract.examples as Record<string, unknown>;
		for (const example of Object.values(examples)) {
			const parsed = parseBaseHalfNodeDocument(JSON.stringify(example));
			assert.deepStrictEqual(parsed, example);
			assert.deepStrictEqual(parsed.current, { source: 'empty', outputPaths: [] });
			assert.deepStrictEqual(parsed.revisions, []);
			assert.deepStrictEqual(parsed.runs, []);
		}
	});

	test('forks a copied result container without aliasing identity, connections, or history', () => {
		const original = parse(successfulDocument());
		const fork = forkBaseHalfNodeDocument(original, baseHalfNodeTestId(2));

		assert.strictEqual(fork.id, baseHalfNodeTestId(2));
		assert.strictEqual(fork.kind, original.kind);
		assert.strictEqual(fork.title, original.title);
		assert.strictEqual(fork.role, original.role);
		assert.deepStrictEqual(fork.recipe, {
			...original.recipe,
			inputBindings: []
		});
		assert.deepStrictEqual(fork.current, { source: 'empty', outputPaths: [] });
		assert.deepStrictEqual(fork.revisions, []);
		assert.deepStrictEqual(fork.runs, []);
		assert.strictEqual(Object.isFrozen(fork), true);
		assert.strictEqual(Object.isFrozen(fork.recipe?.inputBindings), true);
	});

	test('preserves a persisted running record until the execution owner recovers it on disk', () => {
		const value = baseDocument({
			current: { source: 'empty', outputPaths: [] },
			runs: [runningRun()]
		});

		const parsed = parse(value);
		assert.strictEqual(parsed.runs[0].status, 'running');
		assert.strictEqual(parsed.runs[0].startedAt, '2026-07-18T08:00:01.000Z');
		assert.strictEqual(parsed.runs[0].completedAt, undefined);
		assert.strictEqual(parseBaseHalfNodeDocument(serializeBaseHalfNodeDocument(parsed)).runs[0].status, 'running');
		assert.deepStrictEqual(parsed.runs[0].model, serviceModel());
		assert.throws(() => parse(baseDocument({
			current: { source: 'empty', outputPaths: [] },
			runs: [runningRun(), { ...runningRun(), id: 'run-active-2' }]
		})), /more than one active run/);
	});

	test('keeps an unresolved service selection as failed audit history but never accepts it as success', () => {
		const unavailableModel = {
			source: 'service' as const,
			connection: 'unavailable' as const,
			serviceId: 'studio.image',
			capability: 'image' as const,
			modelId: 'image-v2'
		};
		const failed = parse({
			...baseDocument(),
			current: { source: 'empty', outputPaths: [] },
			runs: [{ ...failedRun(), model: unavailableModel }]
		});
		assert.deepStrictEqual(failed.runs[0].model, unavailableModel);

		assert.throws(() => parse({
			...successfulDocument(),
			runs: [{ ...successRun(), model: unavailableModel }]
		}), /successful runs require a resolved model connection/);
		assert.throws(() => parse({
			...baseDocument(),
			current: { source: 'empty', outputPaths: [] },
			runs: [{ ...failedRun(), model: { ...unavailableModel, serviceLabel: 'must not be invented' } }]
		}), /unsupported property 'serviceLabel'/);
	});

	test('gives every reader the same persisted running lifecycle state', () => {
		const source = JSON.stringify(baseDocument({
			current: { source: 'empty', outputPaths: [] },
			runs: [runningRun()]
		}));

		assert.strictEqual(parseBaseHalfNodeDocumentForActiveHost(source).runs[0].status, 'running');
		assert.strictEqual(parseBaseHalfNodeDocument(source).runs[0].status, 'running');
	});

	test('serializing a live in-memory run does not recover it prematurely', () => {
		const document = createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(1),
			kind: 'image',
			title: 'Poster',
			role: 'result',
			current: { source: 'empty', outputPaths: [] },
			recipe: recipe(),
			runs: [runningRun()]
		});

		assert.strictEqual(document.runs[0].status, 'running');
		assert.strictEqual(JSON.parse(serializeBaseHalfNodeDocument(document)).runs[0].status, 'running');
		assert.strictEqual(parseBaseHalfNodeDocument(serializeBaseHalfNodeDocument(document)).runs[0].status, 'running');
	});

	test('rejects oversized, unsupported, and excessively complex documents', () => {
		assert.throws(() => parseBaseHalfNodeDocumentBytes(new Uint8Array([0xc3, 0x28])), /valid UTF-8/);
		assert.throws(
			() => parseBaseHalfNodeDocument(`${JSON.stringify(baseDocument())}${' '.repeat(BASEHALF_NODE_DOCUMENT_MAX_BYTES)}`),
			/BaseHalfNodeDocumentError/
		);
		assert.throws(() => parse({ ...baseDocument(), unexpected: true }), /unsupported property 'unexpected'/);
		assert.throws(() => parse({ ...baseDocument(), current: { source: 'empty', text: 'legacy', outputPaths: [] } }), /unsupported property 'text'/);
		assert.throws(() => parse({ ...successfulDocument(), runs: [{ ...successRun(), textOutput: 'legacy' }] }), /unsupported property 'textOutput'/);
		assert.throws(() => parse({ ...baseDocument(), version: 1 }), /Unsupported node document version/);
		assert.throws(() => createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(1),
			kind: 'image',
			title: 'Poster',
			role: 'result',
			recipe: { ...recipe(), parameters: { value: Number.POSITIVE_INFINITY } }
		}), /finite numbers/);
		assert.throws(() => parse({
			...baseDocument(),
			recipe: { ...recipe(), inputBindings: [{ ...recipe().inputBindings[0], revision: 'not-allowed' }] }
		}), /unsupported property 'revision'/);
		assert.throws(() => parse({
			...successfulDocument(),
			runs: [{ ...successRun(), model: { ...serviceModel(), apiKey: 'must-never-persist' } }]
		}), /unsupported property 'apiKey'/);
		assert.throws(() => parse({
			...successfulDocument(),
			runs: [{ ...successRun(), providerRequestId: 'request\nsecret' }]
		}), /providerRequestId contains unsupported characters/);
		assert.throws(() => parse({
			...successfulDocument(),
			runs: [{ ...successRun(), usage: { inputTokens: -1 } }]
		}), /inputTokens must be an integer/);
		assert.throws(() => parse({
			...successfulDocument(),
			runs: [{ ...successRun(), cost: { currency: 'usd', amount: '01.0', kind: 'actual' } }]
		}), /currency must use three uppercase letters/);
	});

	test('accepts only portable project-relative input and output paths', () => {
		for (const sourcePath of [
			'/tmp/input.md', '../input.md', 'folder/../input.md', 'C:/input.md', 'https://example.com/input.md',
			'folder\\input.md', '.bh/mirror/input.md', '.BH/mirror/input.md', 'folder/CON.txt', 'folder/aux',
			'folder/trailing. ', 'folder/control\u0001.md', 'folder/cafe\u0301.md'
		]) {
			assert.throws(() => parse({
				...baseDocument(),
				recipe: { ...recipe(), inputBindings: [{ sourcePath, slot: 'prompt', order: 0 }] },
				runs: []
			}), /project-relative path|parent path segments|workspace metadata|reserved device-name|ending in a dot or space|control characters|NFC normalization|NFC-normalized/);
		}

		const value = successfulDocument();
		value.runs[0].outputPaths = ['../outside.png'];
		value.current.outputPaths = ['../outside.png'];
		assert.throws(() => parse(value), /parent path segments/);
	});

	test('identifies only the host-reserved root output tree', () => {
		const nodeId = baseHalfNodeTestId(91);
		const runId = baseHalfNodeTestId(92);
		assert.strictEqual(baseHalfIsReservedOutputTreePath('outputs'), true);
		assert.strictEqual(baseHalfIsReservedOutputTreePath(`outputs/${nodeId}/${runId}/inputs/node.bhnode`), true);
		assert.strictEqual(baseHalfIsReservedOutputTreePath(`outputs/${nodeId}/${runId}/artifacts/node.bhnode`), true);
		assert.strictEqual(baseHalfIsReservedOutputTreePath(`draft/outputs/${nodeId}/${runId}/inputs/node.bhnode`), false);
		assert.strictEqual(baseHalfIsReservedOutputTreePath('../outputs/node.bhnode'), false);
	});

	test('rejects duplicate run ids, binding orders, binding identities, and output paths', () => {
		const success = successRun();
		assert.throws(() => parse({
			...baseDocument(),
			current: { source: 'run', runId: success.id, outputPaths: success.outputPaths },
			runs: [success, clone(success)]
		}), /runs ids must not contain duplicates/);

		assert.throws(() => parse({
			...baseDocument(),
			recipe: {
				...recipe(),
				inputBindings: [
					{ sourcePath: 'brief.md', slot: 'prompt', order: 0 },
					{ sourcePath: 'style.png', slot: 'reference', order: 0 }
				]
			},
			runs: []
		}), /orders must not contain duplicates/);

		assert.throws(() => parse({
			...baseDocument(),
			recipe: {
				...recipe(),
				inputBindings: [
					{ sourcePath: 'brief.md', slot: 'prompt', order: 0 },
					{ sourcePath: 'brief.md', slot: 'prompt', order: 1 }
				]
			},
			runs: []
		}), /source paths must not contain duplicates/);

		assert.throws(() => parse({
			...baseDocument(),
			recipe: {
				...recipe(),
				inputBindings: [
					{ sourcePath: 'Brief.md', slot: 'prompt', order: 0 },
					{ sourcePath: 'brief.md', slot: 'reference', order: 1 }
				]
			},
			runs: []
		}), /source paths must not contain duplicates/);

		const duplicateOutputs = successfulDocument();
		duplicateOutputs.runs[0].outputPaths = ['generated/poster.png', 'generated/poster.png'];
		duplicateOutputs.current.outputPaths = [...duplicateOutputs.runs[0].outputPaths];
		assert.throws(() => parse(duplicateOutputs), /outputPaths must not contain duplicates/);
	});

	test('rejects Current pointers to unsuccessful, missing, or mismatched run outputs', () => {
		const failed = failedRun();
		assert.throws(() => parse({
			...baseDocument(),
			current: { source: 'run', runId: failed.id, outputPaths: [] },
			runs: [failed]
		}), /must point to a successful run/);

		assert.throws(() => parse({
			...baseDocument(),
			current: { source: 'run', runId: 'missing', outputPaths: [] },
			runs: []
		}), /must point to a successful run/);

		const mismatched = successfulDocument();
		mismatched.current.outputPaths = ['generated/other.png'];
		assert.throws(() => parse(mismatched), /content must match its selected run output/);
		assert.throws(() => parse({
			...baseDocument(),
			current: { source: 'imported', outputPaths: [] }
		}), /requires revisionId/);
	});

	test('requires the primary artifact kind to match the node while allowing supplementary artifacts', () => {
		const value = successfulDocument();
		value.runs[0].artifacts.push({ ...artifact('outputs/notes.md', 'file'), id: 'notes', outputId: 'notes' });
		value.runs[0].outputPaths.push('outputs/notes.md');
		value.current.outputPaths.push('outputs/notes.md');
		const document = parse(value);

		assert.deepStrictEqual(getBaseHalfNodeCurrentPrimaryArtifact(document), {
			id: 'primary',
			outputId: 'result',
			kind: 'image',
			path: 'generated/poster.png',
			sha256: 'A'.repeat(43),
			size: 123
		});
		const mismatched = successfulDocument();
		mismatched.kind = 'video';
		mismatched.runs[0].artifacts = [artifact('outputs/clip-plan.md', 'file')];
		mismatched.runs[0].outputPaths = ['outputs/clip-plan.md'];
		mismatched.current.outputPaths = ['outputs/clip-plan.md'];
		assert.throws(() => parse(mismatched), /primary artifact must match document.kind/);
		assert.throws(() => parse({
			...successfulDocument(),
			runs: [{ ...successfulDocument().runs[0], primaryArtifactId: 'missing' }]
		}), /valid primaryArtifactId/);
		assert.throws(() => parse({
			...successfulDocument(),
			runs: [{ ...successfulDocument().runs[0], artifacts: [{ ...successfulDocument().runs[0].artifacts[0], sha256: 'not-a-digest' }] }]
		}), /Base64 SHA-256/);

		const fileValue = successfulDocument();
		fileValue.kind = 'file';
		fileValue.runs[0].artifacts = [artifact('outputs/result.md', 'file')];
		fileValue.runs[0].outputPaths = ['outputs/result.md'];
		fileValue.current.outputPaths = ['outputs/result.md'];
		assert.strictEqual(parse(fileValue).kind, 'file');
	});

	test('reports structural, model-service, direct-source, and busy readiness independently', () => {
		const document = parse(successfulDocument());
		assert.deepStrictEqual(getBaseHalfNodeReadiness(document), { ready: true, code: 'ready' });
		assert.deepStrictEqual(getBaseHalfNodeReadiness(document, { availableModelServiceIds: [] }), {
			ready: false,
			code: 'modelServiceUnavailable'
		});
		assert.deepStrictEqual(getBaseHalfNodeReadiness(document, {
			availableModelServiceIds: ['studio.image'],
			availableSourcePaths: []
		}), {
			ready: false,
			code: 'sourceUnavailable',
			missingSourcePaths: ['brief.md']
		});
		assert.deepStrictEqual(getBaseHalfNodeReadiness(document, {
			availableModelServiceIds: ['STUDIO.IMAGE'],
			availableSourcePaths: ['brief.md']
		}), { ready: true, code: 'ready' });

		const busy = createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(1),
			kind: 'image',
			title: 'Poster',
			role: 'result',
			recipe: recipe(),
			runs: [runningRun()]
		});
		assert.deepStrictEqual(getBaseHalfNodeReadiness(busy), { ready: false, code: 'busy' });
	});

	test('does not require a model connection for a deterministic local recipe', () => {
		const localRecipe = clone(recipe());
		delete localRecipe.modelServiceId;
		delete localRecipe.modelId;
		const document = createBaseHalfNodeDocument({
			id: baseHalfNodeTestId(1),
			kind: 'image',
			title: 'Poster',
			role: 'result',
			recipe: localRecipe
		});

		assert.deepStrictEqual(getBaseHalfNodeReadiness(document, {
			availableModelServiceIds: [],
			availableSourcePaths: ['brief.md']
		}), { ready: true, code: 'ready' });
	});

	test('marks selected generated Current stale only when its recipe or direct inputs change', () => {
		const document = parse(successfulDocument());
		const unchangedInput = [{ sourcePath: 'brief.md', slot: 'prompt', order: 0, revision: 'sha256:brief-v1' }];

		assert.strictEqual(isBaseHalfNodeDocumentStale(document), false);
		assert.strictEqual(isBaseHalfNodeDocumentStale(document, unchangedInput), false);
		assert.strictEqual(isBaseHalfNodeDocumentStale(document, [{ ...unchangedInput[0], revision: 'sha256:brief-v2' }]), true);

		const changedRecipe = createBaseHalfNodeDocument({
			...document,
			recipe: { ...document.recipe!, parameters: { quality: 'draft', seed: 7 } }
		});
		assert.strictEqual(isBaseHalfNodeDocumentStale(changedRecipe, unchangedInput), true);

		const imported = importBaseHalfNodeCurrent(document, importedRevision('import-current', 'assets/current.png'));
		assert.strictEqual(isBaseHalfNodeDocumentStale(imported, [{ ...unchangedInput[0], revision: 'changed' }]), false);
	});

	test('remaps live recipe bindings for file and folder moves without rewriting immutable run history', () => {
		const document = parse(successfulDocument());
		const moved = remapBaseHalfNodeRecipeInputBindings(document, 'brief.md', 'story/brief.md');
		assert.strictEqual(moved.recipe?.inputBindings[0].sourcePath, 'story/brief.md');
		assert.strictEqual(moved.runs[0].recipe.inputBindings[0].sourcePath, 'brief.md');
		assert.strictEqual(moved.runs[0].inputs[0].sourcePath, 'brief.md');
		assert.strictEqual(remapBaseHalfNodeRecipeInputBindings(document, 'unrelated.md', 'other.md'), document);

		const folderDocument = createBaseHalfNodeDocument({
			...document,
			current: { source: 'empty', outputPaths: [] },
			runs: [],
			recipe: {
				...document.recipe!,
				inputBindings: [{ sourcePath: 'references/Style.PNG', slot: 'prompt', order: 0 }]
			}
		});
		assert.strictEqual(remapBaseHalfNodeRecipeInputBindings(folderDocument, 'REFERENCES', 'assets/references').recipe?.inputBindings[0].sourcePath, 'assets/references/Style.PNG');

		const changedSelection = createBaseHalfNodeDocument({
			...document,
			recipe: { ...document.recipe!, modelServiceId: 'studio.other', modelId: 'image-v3' }
		});
		assert.strictEqual(changedSelection.recipe?.modelId, 'image-v3');
		assert.deepStrictEqual(changedSelection.runs[0].recipe, document.runs[0].recipe);
		assert.deepStrictEqual(changedSelection.runs[0].model, document.runs[0].model);
	});

	test('removes deleted live recipe inputs without changing immutable run snapshots', () => {
		const document = createBaseHalfNodeDocument({
			...parse(successfulDocument()),
			recipe: {
				...parse(successfulDocument()).recipe!,
				inputBindings: [
					{ sourcePath: 'references/style.png', slot: 'context', order: 0 },
					{ sourcePath: 'brief.md', slot: 'prompt', order: 1 }
				]
			}
		});

		assert.strictEqual(baseHalfNodeRecipeReferencesPath(document, 'REFERENCES'), true);
		assert.strictEqual(baseHalfNodeRecipeReferencesPath(document, 'unrelated'), false);
		const removed = removeBaseHalfNodeRecipeInputBindings(document, 'references');
		assert.deepStrictEqual(removed.recipe?.inputBindings, [
			{ sourcePath: 'brief.md', slot: 'prompt', order: 0 }
		]);
		assert.deepStrictEqual(removed.runs, document.runs);
		assert.strictEqual(removeBaseHalfNodeRecipeInputBindings(document, 'unrelated'), document);
	});

	test('selects only successful History without changing immutable run records', () => {
		const initial = parse({
			...baseDocument(),
			current: { source: 'empty', outputPaths: [] },
			runs: [failedRun(), successRun()]
		});
		const selected = selectBaseHalfNodeCurrent(initial, 'run-success');

		assert.deepStrictEqual(selected.current, {
			source: 'run',
			runId: 'run-success',
			outputPaths: ['generated/poster.png']
		});
		assert.deepStrictEqual(selected.runs, initial.runs);
		assert.strictEqual(initial.current.source, 'empty');
		assert.throws(() => selectBaseHalfNodeCurrent(initial, 'run-failed'), /not successful/);
		assert.throws(() => selectBaseHalfNodeCurrent(initial, 'missing'), /does not exist/);
	});

	test('imports or replaces Current by appending an immutable selectable revision', () => {
		const initial = parse(successfulDocument());
		const firstRevision = importedRevision('import-1', 'assets/replacement.png');
		const imported = importBaseHalfNodeCurrent(initial, firstRevision);

		assert.deepStrictEqual(imported.current, { source: 'imported', revisionId: 'import-1', outputPaths: ['assets/replacement.png'] });
		assert.deepStrictEqual(imported.revisions, [firstRevision]);
		assert.deepStrictEqual(imported.runs, initial.runs);
		assert.deepStrictEqual(initial.current.outputPaths, ['generated/poster.png']);

		const replaced = importBaseHalfNodeCurrent(imported, importedRevision('import-2', 'assets/replacement-2.png'));
		assert.strictEqual(replaced.revisions.length, 2);
		assert.strictEqual(replaced.current.revisionId, 'import-2');
		assert.strictEqual(selectBaseHalfNodeCurrent(replaced, 'import-1').current.revisionId, 'import-1');
		assert.throws(() => importBaseHalfNodeCurrent(initial, importedRevision('import-invalid', '.bh/replacement.png')), /workspace metadata/);
		assert.throws(() => importBaseHalfNodeCurrent(initial, {
			...importedRevision('run-success', 'assets/collision.png')
		}), /version ids must not contain duplicates/);
		assert.throws(() => importBaseHalfNodeCurrent(initial, {
			...importedRevision('import-wrong-kind', 'assets/wrong.mp4'),
			artifacts: [{ ...artifact('assets/wrong.mp4', 'video'), outputId: 'imported' }]
		}), /primary artifact must match document.kind/);
	});

	test('provides immutable begin, complete, fail, cancel, and interrupt lifecycle helpers', () => {
		const initial = parse(baseDocument());
		const began = beginBaseHalfNodeRun(initial, {
			id: 'run-new',
			createdAt: '2026-07-18T09:00:00.000Z',
			startedAt: '2026-07-18T09:00:01.000Z',
			model: serviceModel(),
			inputs: [{ sourcePath: 'brief.md', slot: 'prompt', order: 0, revision: 'sha256:brief-v2' }]
		});

		assert.strictEqual(initial.runs.length, 0);
		assert.strictEqual(began.runs[0].status, 'running');
		assert.deepStrictEqual(getBaseHalfNodeReadiness(began), { ready: false, code: 'busy' });
		assert.throws(() => beginBaseHalfNodeRun(began, {
			id: 'run-other',
			createdAt: '2026-07-18T09:00:02.000Z',
			startedAt: '2026-07-18T09:00:03.000Z',
			model: serviceModel(),
			inputs: [{ sourcePath: 'brief.md', slot: 'prompt', order: 0, revision: 'sha256:brief-v2' }]
		}), /already has an active run/);

		const completed = completeBaseHalfNodeRun(began, 'run-new', {
			completedAt: '2026-07-18T09:00:04.000Z',
			artifacts: [artifact('generated/poster-v2.png')],
			primaryArtifactId: 'primary',
			providerRequestId: 'provider/request-2',
			usage: { inputTokens: 120, outputTokens: 4, images: 1 },
			cost: { currency: 'USD', amount: '0.042', kind: 'actual' }
		});
		assert.strictEqual(completed.runs[0].status, 'succeeded');
		assert.deepStrictEqual(completed.runs[0].model, serviceModel());
		assert.strictEqual(completed.runs[0].providerRequestId, 'provider/request-2');
		assert.deepStrictEqual(completed.runs[0].usage, { inputTokens: 120, outputTokens: 4, images: 1 });
		assert.deepStrictEqual(completed.runs[0].cost, { currency: 'USD', amount: '0.042', kind: 'actual' });
		assert.deepStrictEqual(completed.current, {
			source: 'run',
			runId: 'run-new',
			outputPaths: ['generated/poster-v2.png']
		});
		assert.strictEqual(began.runs[0].status, 'running');

		const failedStart = beginBaseHalfNodeRun(completed, {
			id: 'run-failure',
			createdAt: '2026-07-18T09:01:00.000Z',
			startedAt: '2026-07-18T09:01:01.000Z',
			model: serviceModel(),
			inputs: [{ sourcePath: 'brief.md', slot: 'prompt', order: 0, revision: 'sha256:brief-v3' }]
		});
		const failed = failBaseHalfNodeRun(failedStart, 'run-failure', {
			completedAt: '2026-07-18T09:01:02.000Z',
			error: 'The request failed.'
		});
		assert.strictEqual(failed.runs[1].status, 'failed');
		assert.deepStrictEqual(failed.runs[1].model, serviceModel());
		assert.deepStrictEqual(failed.current, completed.current);

		const cancelledStart = beginBaseHalfNodeRun(failed, {
			id: 'run-cancelled',
			createdAt: '2026-07-18T09:02:00.000Z',
			startedAt: '2026-07-18T09:02:01.000Z',
			model: serviceModel(),
			inputs: [{ sourcePath: 'brief.md', slot: 'prompt', order: 0, revision: 'sha256:brief-v4' }]
		});
		const cancelled = cancelBaseHalfNodeRun(cancelledStart, 'run-cancelled', {
			completedAt: '2026-07-18T09:02:02.000Z'
		});
		assert.strictEqual(cancelled.runs[2].status, 'cancelled');
		assert.deepStrictEqual(cancelled.runs[2].model, serviceModel());
		assert.deepStrictEqual(cancelled.current, completed.current);
		assert.throws(() => completeBaseHalfNodeRun(cancelled, 'run-cancelled', {
			completedAt: '2026-07-18T09:02:03.000Z',
			artifacts: [artifact('generated/late.png')],
			primaryArtifactId: 'primary'
		}), /is not running/);

		const interruptedStart = beginBaseHalfNodeRun(cancelled, {
			id: 'run-interrupted',
			createdAt: '2026-07-18T09:03:00.000Z',
			startedAt: '2026-07-18T09:03:01.000Z',
			model: serviceModel(),
			inputs: [{ sourcePath: 'brief.md', slot: 'prompt', order: 0, revision: 'sha256:brief-v5' }]
		});
		const interrupted = interruptBaseHalfNodeRun(interruptedStart, 'run-interrupted', {
			completedAt: '2026-07-18T09:03:02.000Z',
			error: 'The executor stopped.'
		});
		assert.strictEqual(interrupted.runs[3].status, 'interrupted');
		assert.strictEqual(interrupted.runs[3].error, 'The executor stopped.');
		assert.deepStrictEqual(interrupted.current, completed.current);
	});

	test('persists preparation before freezing provider and input snapshots', () => {
		const initial = parse(baseDocument());
		const preparing = beginBaseHalfNodeRun(initial, {
			id: 'run-preparing',
			createdAt: '2026-07-18T09:00:00.000Z',
			startedAt: '2026-07-18T09:00:00.000Z',
			model: {
				source: 'service', connection: 'unavailable', serviceId: 'studio.image',
				capability: 'image', modelId: 'image-v2'
			},
			inputs: []
		});

		assert.deepStrictEqual(preparing.runs[0].inputs, []);
		assert.strictEqual(parseBaseHalfNodeDocument(serializeBaseHalfNodeDocument(preparing)).runs[0].status, 'running');
		const modelFrozen = freezeBaseHalfNodeRunModel(preparing, 'run-preparing', serviceModel());
		assert.deepStrictEqual(modelFrozen.runs[0].model, serviceModel());
		const frozen = freezeBaseHalfNodeRunInputs(modelFrozen, 'run-preparing', [
			{ sourcePath: 'brief.md', slot: 'prompt', order: 0, revision: 'sha256:brief-v2' }
		]);
		assert.deepStrictEqual(frozen.runs[0].inputs, [
			{ sourcePath: 'brief.md', slot: 'prompt', order: 0, revision: 'sha256:brief-v2' }
		]);
		assert.throws(() => freezeBaseHalfNodeRunInputs(frozen, 'run-preparing', frozen.runs[0].inputs), /already has frozen inputs/);
		assert.throws(() => completeBaseHalfNodeRun(preparing, 'run-preparing', {
			completedAt: '2026-07-18T09:00:01.000Z',
			artifacts: [artifact('generated/poster-v2.png')],
			primaryArtifactId: 'primary'
		}), /inputs must match/);
	});

	test('sorts bindings by their explicit order before comparing snapshots', () => {
		const value = successfulDocument();
		value.recipe.inputBindings = [
			{ sourcePath: 'style.png', slot: 'reference', order: 1 },
			{ sourcePath: 'brief.md', slot: 'prompt', order: 0 }
		];
		value.runs[0].recipe.inputBindings = clone(value.recipe.inputBindings);
		value.runs[0].inputs = [
			{ sourcePath: 'style.png', slot: 'reference', order: 1, revision: 'sha256:style-v1' },
			{ sourcePath: 'brief.md', slot: 'prompt', order: 0, revision: 'sha256:brief-v1' }
		];

		const document = parse(value);
		assert.deepStrictEqual(document.recipe!.inputBindings.map(binding => binding.sourcePath), ['brief.md', 'style.png']);
		assert.strictEqual(isBaseHalfNodeDocumentStale(document, [
			{ sourcePath: 'style.png', slot: 'reference', order: 1, revision: 'sha256:style-v1' },
			{ sourcePath: 'brief.md', slot: 'prompt', order: 0, revision: 'sha256:brief-v1' }
		]), false);
	});

	test('uses the dedicated document error for malformed JSON', () => {
		let thrown: unknown;
		try {
			parseBaseHalfNodeDocument('{');
		} catch (error) {
			thrown = error;
		}
		assert.ok(thrown instanceof BaseHalfNodeDocumentError);
	});
});

interface ITestBinding {
	sourcePath: string;
	slot: string;
	order: number;
	revision?: string;
}

interface ITestRecipe {
	recipeId: string;
	modelServiceId?: string;
	modelId?: string;
	parameters: Record<string, BaseHalfNodeJsonValue>;
	inputBindings: ITestBinding[];
}

interface ITestRun {
	id: string;
	status: BaseHalfNodeRunStatus;
	createdAt: string;
	startedAt?: string;
	completedAt?: string;
	recipe: ITestRecipe;
	model: ReturnType<typeof serviceModel> | { source: 'local' };
	inputs: Array<ITestBinding & { revision: string }>;
	artifacts: Array<ReturnType<typeof artifact>>;
	primaryArtifactId?: string;
	providerRequestId?: string;
	usage?: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; images?: number; videoSeconds?: number; audioSeconds?: number };
	cost?: { currency: string; amount: string; kind: 'actual' | 'estimated' };
	outputPaths: string[];
	error?: string;
}

interface ITestCurrent {
	source: BaseHalfNodeCurrentSource;
	runId?: string;
	revisionId?: string;
	outputPaths: string[];
}

interface ITestDocument {
	version: number;
	id: string;
	kind: 'file' | 'image' | 'video' | 'audio' | 'pdf' | 'presentation';
	title: string;
	role: string;
	current: ITestCurrent;
	recipe: ITestRecipe;
	revisions: ReturnType<typeof importedRevision>[];
	runs: ITestRun[];
}

function successfulDocument(): ITestDocument {
	const run = successRun();
	return baseDocument({
		current: { source: 'run', runId: run.id, outputPaths: [...run.outputPaths] },
		runs: [run]
	});
}

function baseDocument(overrides: Partial<ITestDocument> = {}): ITestDocument {
	return {
		version: 2,
		id: baseHalfNodeTestId(1),
		kind: 'image',
		title: 'Poster',
		role: 'result',
		current: { source: 'empty', outputPaths: [] },
		recipe: recipe(),
		revisions: [],
		runs: [],
		...overrides
	};
}

function recipe(): ITestRecipe {
	return {
		recipeId: 'pointa.image.generate',
		modelServiceId: 'studio.image',
		modelId: 'image-v2',
		parameters: { quality: 'high', seed: 7 },
		inputBindings: [{ sourcePath: 'brief.md', slot: 'prompt', order: 0 }]
	};
}

function successRun(): ITestRun {
	return {
		id: 'run-success',
		status: 'succeeded',
		createdAt: '2026-07-18T08:00:00.000Z',
		startedAt: '2026-07-18T08:00:01.000Z',
		completedAt: '2026-07-18T08:00:03.000Z',
		recipe: recipe(),
		model: serviceModel(),
		inputs: [{ sourcePath: 'brief.md', slot: 'prompt', order: 0, revision: 'sha256:brief-v1' }],
		artifacts: [artifact('generated/poster.png')],
		primaryArtifactId: 'primary',
		outputPaths: ['generated/poster.png']
	};
}

function runningRun(): ITestRun {
	return {
		id: 'run-active',
		status: 'running',
		createdAt: '2026-07-18T08:00:00.000Z',
		startedAt: '2026-07-18T08:00:01.000Z',
		recipe: recipe(),
		model: serviceModel(),
		inputs: [{ sourcePath: 'brief.md', slot: 'prompt', order: 0, revision: 'sha256:brief-v1' }],
		artifacts: [],
		outputPaths: []
	};
}

function failedRun(): ITestRun {
	return {
		id: 'run-failed',
		status: 'failed',
		createdAt: '2026-07-18T07:00:00.000Z',
		startedAt: '2026-07-18T07:00:01.000Z',
		completedAt: '2026-07-18T07:00:02.000Z',
		recipe: recipe(),
		model: serviceModel(),
		inputs: [{ sourcePath: 'brief.md', slot: 'prompt', order: 0, revision: 'sha256:brief-v0' }],
		artifacts: [],
		outputPaths: [],
		error: 'The request failed.'
	};
}

function artifact(path: string, kind: 'file' | 'image' | 'video' | 'audio' | 'pdf' | 'presentation' = 'image') {
	return {
		id: 'primary',
		outputId: 'result',
		kind,
		path,
		sha256: 'A'.repeat(43),
		size: 123
	};
}

function serviceModel() {
	return {
		source: 'service' as const,
		connection: 'resolved' as const,
		serviceId: 'studio.image',
		serviceLabel: 'Studio image',
		connectionIdentity: `sha256:${'A'.repeat(43)}`,
		capability: 'image' as const,
		modelId: 'image-v2'
	};
}

function importedRevision(id: string, path: string) {
	return {
		id,
		source: 'imported' as const,
		createdAt: '2026-07-18T09:00:00.000Z',
		artifacts: [{ ...artifact(path), outputId: 'imported' }],
		primaryArtifactId: 'primary'
	};
}

function parse(value: unknown): IBaseHalfNodeDocument {
	return parseBaseHalfNodeDocument(JSON.stringify(value));
}

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value));
}
