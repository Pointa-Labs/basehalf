/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
	ADD_SEQUENCE_ITEM_COMMAND_ID,
	CREATE_WORKFLOW_COMMAND_ID,
	HOST_CREATE_FROM_TEMPLATE_COMMAND_ID,
	INSPECT_SEQUENCE_COMMAND_ID,
	MOVE_SEQUENCE_ITEM_COMMAND_ID,
	REMOVE_SEQUENCE_ITEM_COMMAND_ID,
	REPAIR_SEQUENCE_ITEM_PATH_COMMAND_ID,
	STARTER_TEMPLATE_ID
} from './domain';
import { addSequenceItemFromVideoResultCommand, inspectSequenceCommand, moveSequenceItemCommand, removeSequenceItemCommand, repairSequenceItemPathCommand } from './sequenceCommands';
import { resolveSequenceProjection, SEQUENCE_PROJECTION_ID } from './sequenceProjection';
import { VideoProviderCommands } from './providers/commands.ts';
import { PROVIDER_MODULES } from './providers/registry.ts';
import { VIDEO_PROVIDER_COMMANDS } from './providers/types.ts';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	context.subscriptions.push(vscode.commands.registerCommand(CREATE_WORKFLOW_COMMAND_ID, () =>
		vscode.commands.executeCommand(HOST_CREATE_FROM_TEMPLATE_COMMAND_ID, STARTER_TEMPLATE_ID)));
	context.subscriptions.push(vscode.commands.registerCommand(INSPECT_SEQUENCE_COMMAND_ID, inspectSequenceCommand));
	context.subscriptions.push(vscode.commands.registerCommand(ADD_SEQUENCE_ITEM_COMMAND_ID, addSequenceItemFromVideoResultCommand));
	context.subscriptions.push(vscode.commands.registerCommand(MOVE_SEQUENCE_ITEM_COMMAND_ID, moveSequenceItemCommand));
	context.subscriptions.push(vscode.commands.registerCommand(REMOVE_SEQUENCE_ITEM_COMMAND_ID, removeSequenceItemCommand));
	context.subscriptions.push(vscode.commands.registerCommand(REPAIR_SEQUENCE_ITEM_PATH_COMMAND_ID, repairSequenceItemPathCommand));
	// Deleting a video changes no Sequence: its clip shows as missing (D63).
	context.subscriptions.push(vscode.basehalf.registerCardProjectionProvider(SEQUENCE_PROJECTION_ID, {
		resolveCardProjection: resolveSequenceProjection
	}));

	// The model catalog and the provider requests of the generations of image
	// and video cards (D59, D64). The window passes the credentials with every
	// call; nothing is kept here between calls. The log gets the method, path,
	// status, and time of each exchange with a provider, and nothing else.
	const log = vscode.window.createOutputChannel('BaseHalf AI Video', { log: true });
	context.subscriptions.push(log);
	const providers = new VideoProviderCommands(PROVIDER_MODULES, { http: { log } });
	context.subscriptions.push(vscode.commands.registerCommand(VIDEO_PROVIDER_COMMANDS.catalog, () => providers.catalog()));
	context.subscriptions.push(vscode.commands.registerCommand(VIDEO_PROVIDER_COMMANDS.check, (request: unknown) => providers.check(request)));
	context.subscriptions.push(vscode.commands.registerCommand(VIDEO_PROVIDER_COMMANDS.submit, (request: unknown) => providers.submit(request)));
	context.subscriptions.push(vscode.commands.registerCommand(VIDEO_PROVIDER_COMMANDS.poll, (task: unknown) => providers.poll(task)));
	context.subscriptions.push(vscode.commands.registerCommand(VIDEO_PROVIDER_COMMANDS.download, (request: unknown) => providers.download(request)));
	context.subscriptions.push(vscode.commands.registerCommand(VIDEO_PROVIDER_COMMANDS.cancel, (task: unknown) => providers.cancel(task)));
}
