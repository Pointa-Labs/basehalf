/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { MenuRegistry } from '../../../../../platform/actions/common/actions.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { BaseHalfCanvasTemplateRegistryService } from '../../../canvas/common/basehalfCanvasTemplateRegistry.js';
import { BaseHalfCardDetailSurfaceRegistryService } from '../../../cardDetail/browser/basehalfCardDetailSurface.js';
import { BaseHalfCardProjectionRegistryService } from '../../../cardDetail/common/basehalfCardDetail.js';
import { BaseHalfAgentCapabilityRegistryService } from '../../../agentArea/common/basehalfAgentCapabilities.js';
import { BaseHalfSequenceContribution } from '../../browser/basehalfSequence.contribution.js';
import { BASEHALF_STARTER_WORKFLOW_TEMPLATE_SOURCE } from '../../common/basehalfStarterWorkflowTemplate.js';

suite('BaseHalfSequenceContribution', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('registers the Sequence view, the starter template, the capability for agents, and the commands, with the ids they had in the extension (D75)', () => {
		const projections = store.add(new BaseHalfCardProjectionRegistryService());
		const surfaces = store.add(new BaseHalfCardDetailSurfaceRegistryService());
		const templates = store.add(new BaseHalfCanvasTemplateRegistryService());
		const capabilities = store.add(new BaseHalfAgentCapabilityRegistryService());
		const contribution = store.add(new BaseHalfSequenceContribution(projections, surfaces, templates, capabilities, store.add(new TestInstantiationService())));

		const sequence = URI.file('/workspace/video/video-sequence.json');
		assert.strictEqual(projections.defaultProjection(sequence), 'pointa.basehalf-ai-video.sequence');
		assert.deepStrictEqual(projections.getProjections(sequence).map(projection => projection.id), ['pointa.basehalf-ai-video.sequence', 'source']);
		assert.strictEqual(projections.defaultProjection(URI.file('/workspace/video/shot.json')), 'source');
		assert.strictEqual(surfaces.hasProvider('pointa.basehalf-ai-video.sequence'), true);

		const template = templates.getTemplate('pointa.basehalf-ai-video.starter-workflow');
		assert.deepStrictEqual([template?.label, template?.namespace, template?.source], ['Video Starter Workflow', 'pointa.basehalf-ai-video', BASEHALF_STARTER_WORKFLOW_TEMPLATE_SOURCE]);

		const capability = capabilities.getCapability('pointa.basehalf-ai-video.sequence-capability');
		assert.deepStrictEqual(capability?.documents.map(document => document.kind), ['pointa.basehalf-ai-video.shot', 'pointa.basehalf-ai-video.sequence']);
		const commands = [
			'pointa.basehalf-ai-video.inspectSequence',
			'pointa.basehalf-ai-video.addSequenceItemFromVideoResult',
			'pointa.basehalf-ai-video.moveSequenceItem',
			'pointa.basehalf-ai-video.removeSequenceItem',
			'pointa.basehalf-ai-video.repairSequenceItemPath'
		];
		assert.deepStrictEqual(capability?.operations.map(operation => operation.command), commands);
		assert.ok(capability?.operations.every(operation => operation.deterministic));
		// Add Video Result to Sequence takes a video card with its file.
		assert.deepStrictEqual(capability?.operations[1].parameters?.map(parameter => parameter.name), ['sequence', 'video', 'itemId', 'title']);
		const text = JSON.stringify(capability);
		for (const retired of ['recipe', '.aivideo', '.bhnode', 'Video node', 'nodeId', 'videoNodePath']) {
			assert.strictEqual(text.includes(retired), false, retired);
		}

		// Every command is in the Command Palette under BaseHalf.
		const titles = ['pointa.basehalf-ai-video.createWorkflow', ...commands].map(id => {
			assert.ok(CommandsRegistry.getCommand(id), id);
			const command = MenuRegistry.getCommand(id);
			const title = command?.title;
			const category = command?.category;
			return `${typeof category === 'string' ? category : category?.value}: ${typeof title === 'string' ? title : title?.value}`;
		});
		assert.deepStrictEqual(titles, [
			'BaseHalf: Create Video Workflow…',
			'BaseHalf: Show Video Sequence Status…',
			'BaseHalf: Add Video Result to Sequence…',
			'BaseHalf: Move Video Sequence Clip…',
			'BaseHalf: Remove Video Sequence Clip…',
			'BaseHalf: Repair Moved Video Sequence Clip…'
		]);

		contribution.dispose();
		assert.deepStrictEqual([
			projections.defaultProjection(sequence),
			surfaces.hasProvider('pointa.basehalf-ai-video.sequence'),
			templates.getTemplates().length,
			capabilities.getCapabilities().length
		], ['source', false, 0, 0]);
	});
});
