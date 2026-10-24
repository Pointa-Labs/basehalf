/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type { IBaseHalfAgentCapabilityContribution } from '../../plugins/common/basehalfAgentCapabilities.js';
import {
	BASEHALF_SEQUENCE_ADD_COMMAND_ID,
	BASEHALF_SEQUENCE_CAPABILITY_ID,
	BASEHALF_SEQUENCE_INSPECT_COMMAND_ID,
	BASEHALF_SEQUENCE_KIND,
	BASEHALF_SEQUENCE_MOVE_COMMAND_ID,
	BASEHALF_SEQUENCE_REMOVE_COMMAND_ID,
	BASEHALF_SEQUENCE_REPAIR_COMMAND_ID,
	BASEHALF_SHOT_KIND
} from './basehalfSequence.js';

/**
 * What agents learn of a video workflow (Video Sequence): the shot and
 * Sequence documents they may write, and the Sequence operations BaseHalf
 * runs for them. Each operation is a command of the Sequence; the Agent
 * operation executor gives it its parameters, with every `uri` as a URI.
 */
export const BASEHALF_SEQUENCE_CAPABILITY = Object.freeze<IBaseHalfAgentCapabilityContribution>(
{
	id: BASEHALF_SEQUENCE_CAPABILITY_ID,
	label: 'Video Workflow Documents',
	description: 'Describe shots and arrange videos in playback order, without adding another canvas, editor, or renderer.',
	documents: [
		{
			kind: BASEHALF_SHOT_KIND,
			version: 1,
			fileExtensions: ['.json'],
			schemaSummary: 'A shot.json root object with version 1, kind pointa.basehalf-ai-video.shot, a stable id, a title, and clipNodePath, the path of the shot\'s video card (.mp4, .mov, .m4v, or .webm), a draft until it generates. clipNodePath is relative to the directory containing that shot.json file.'
		},
		{
			kind: BASEHALF_SEQUENCE_KIND,
			version: 1,
			fileExtensions: ['.json'],
			schemaSummary: 'A video-sequence.json root object with version 1, kind pointa.basehalf-ai-video.sequence, and ordered items. Every item has a unique id, a title, and videoPath, a video file (.mp4, .mov, .m4v, or .webm) relative to the directory containing video-sequence.json; for a video BaseHalf generated, generationId is the id of its made.yaml. An item is available when its path is a video file and, with a generationId, that file\'s made.yaml has it.'
		}
	],
	operations: [
		{
			id: 'pointa.basehalf-ai-video.sequence-inspect',
			command: BASEHALF_SEQUENCE_INSPECT_COMMAND_ID,
			description: 'Check that every clip names a video file and, with a generationId, the video of that generation, without changing the Sequence.',
			deterministic: true,
			parameters: [
				{ name: 'sequence', type: 'uri', required: true, description: 'URI of the existing Sequence JSON file in the open local workspace.' }
			],
			returns: { type: 'object', description: 'Validation status and the state of each clip: available, missing, or changed.' }
		},
		{
			id: 'pointa.basehalf-ai-video.sequence-add',
			command: BASEHALF_SEQUENCE_ADD_COMMAND_ID,
			description: 'Append one video card with its file to playback order, with the id of its made.yaml when it has one.',
			deterministic: true,
			parameters: [
				{ name: 'sequence', type: 'uri', required: true, description: 'URI of the existing Sequence JSON file.' },
				{ name: 'video', type: 'uri', required: true, description: 'URI of a video file below the directory containing video-sequence.json.' },
				{ name: 'itemId', type: 'string', required: true, description: 'Unique stable id for the new Sequence item.' },
				{ name: 'title', type: 'string', required: false, description: 'Optional human-readable clip title.' }
			],
			returns: { type: 'object', description: 'The add operation, saved item, saved Sequence document, and fresh inspection.' }
		},
		{
			id: 'pointa.basehalf-ai-video.sequence-move',
			command: BASEHALF_SEQUENCE_MOVE_COMMAND_ID,
			description: 'Move one clip by one position in playback order.',
			deterministic: true,
			parameters: [
				{ name: 'sequence', type: 'uri', required: true, description: 'URI of the existing Sequence JSON file.' },
				{ name: 'itemId', type: 'string', required: true, description: 'Stable id of the Sequence item to move.' },
				{
					name: 'direction',
					type: 'enum',
					required: true,
					description: 'Move the item one position earlier or later.',
					values: ['up', 'down']
				}
			],
			returns: { type: 'object', description: 'The saved Sequence document after the move.' }
		},
		{
			id: 'pointa.basehalf-ai-video.sequence-remove',
			command: BASEHALF_SEQUENCE_REMOVE_COMMAND_ID,
			description: 'Remove one clip from playback order and keep its video.',
			deterministic: true,
			parameters: [
				{ name: 'sequence', type: 'uri', required: true, description: 'URI of the existing Sequence JSON file.' },
				{ name: 'itemId', type: 'string', required: true, description: 'Stable id of the Sequence item to remove.' }
			],
			returns: { type: 'object', description: 'The remove operation, removed item, saved Sequence document, and fresh inspection.' }
		},
		{
			id: 'pointa.basehalf-ai-video.sequence-repair-path',
			command: BASEHALF_SEQUENCE_REPAIR_COMMAND_ID,
			description: 'Update only the path of one clip after a bounded scan finds exactly one video whose made.yaml has the clip\'s generationId.',
			deterministic: true,
			parameters: [
				{ name: 'sequence', type: 'uri', required: true, description: 'URI of the existing Sequence JSON file.' },
				{ name: 'itemId', type: 'string', required: true, description: 'Stable id of the Sequence item whose missing path should be repaired.' }
			],
			returns: { type: 'object', description: 'Fresh Sequence inspection after the explicit path repair.' }
		}
	]
});
