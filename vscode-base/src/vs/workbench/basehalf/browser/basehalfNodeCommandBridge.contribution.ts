/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from '../../../base/common/cancellation.js';
import { Disposable, toDisposable } from '../../../base/common/lifecycle.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';
import { IBaseHalfNodeCommandRequestEvent, ITerminalBackend } from '../../../platform/terminal/common/terminal.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../common/contributions.js';
import { ITerminalInstanceService } from '../../contrib/terminal/browser/terminal.js';
import { IWorkingCopyService } from '../../services/workingCopy/common/workingCopyService.js';
import { IBaseHalfAgentAreaService } from '../common/basehalfAgentArea.js';
import { IBaseHalfAgentCapabilityRegistryService } from '../common/basehalfAgentCapabilities.js';
import { IBaseHalfCanvasRecipeRegistryService } from '../common/basehalfCanvasRecipes.js';
import { IBaseHalfNodeExecutionService } from './basehalfNodeExecutionService.js';
import { BaseHalfNodeCommandHandler } from './basehalfNodeCommandHandler.js';

export class BaseHalfNodeCommandBackendGeneration {
	private value = 0;

	get current(): number {
		return this.value;
	}

	restart(): void {
		this.value++;
	}

	key(requestId: number): string {
		return `${this.value}:${requestId}`;
	}

	isCurrent(value: number): boolean {
		return value === this.value;
	}
}

class BaseHalfNodeCommandBridgeContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.basehalfNodeCommandBridge';
	private readonly handler: BaseHalfNodeCommandHandler;

	constructor(
		@ITerminalInstanceService terminalInstanceService: ITerminalInstanceService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService,
		@IFileService fileService: IFileService,
		@IWorkingCopyService workingCopyService: IWorkingCopyService,
		@IBaseHalfAgentAreaService agentAreaService: IBaseHalfAgentAreaService,
		@IBaseHalfNodeExecutionService executionService: IBaseHalfNodeExecutionService,
		@IBaseHalfAgentCapabilityRegistryService agentCapabilityRegistryService: IBaseHalfAgentCapabilityRegistryService,
		@IBaseHalfCanvasRecipeRegistryService canvasRecipeRegistryService: IBaseHalfCanvasRecipeRegistryService,
		@ICommandService commandService: ICommandService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.handler = new BaseHalfNodeCommandHandler(
			workspaceContextService,
			fileService,
			workingCopyService,
			agentAreaService,
			executionService,
			agentCapabilityRegistryService,
			canvasRecipeRegistryService,
			commandService
		);
		for (const backend of terminalInstanceService.getRegisteredBackends()) {
			this.registerBackend(backend);
		}
		this._register(terminalInstanceService.onDidRegisterBackend(backend => this.registerBackend(backend)));
		this._register(agentAreaService.onDidReleaseTerminalProcess(persistentProcessId => {
			for (const backend of terminalInstanceService.getRegisteredBackends()) {
				if (backend.remoteAuthority === undefined && backend.releaseBaseHalfNodeCommandBridge) {
					void backend.releaseBaseHalfNodeCommandBridge(persistentProcessId).catch(error => {
						this.logService.error('BaseHalf could not release an Agent Area node command bridge', error);
					});
				}
			}
		}));
	}

	private registerBackend(backend: ITerminalBackend): void {
		if (backend.remoteAuthority !== undefined
			|| !backend.onBaseHalfNodeCommandRequest
			|| !backend.onBaseHalfNodeCommandCancellationRequest
			|| !backend.acceptBaseHalfNodeCommandResponse) {
			return;
		}
		const generation = new BaseHalfNodeCommandBackendGeneration();
		const cancellations = new Map<string, { readonly persistentProcessId: number; readonly source: CancellationTokenSource }>();
		const cancelOutstandingRequests = () => {
			for (const cancellation of cancellations.values()) {
				cancellation.source.cancel();
				cancellation.source.dispose();
			}
			cancellations.clear();
		};
		this._register(toDisposable(() => {
			cancelOutstandingRequests();
		}));
		this._register(backend.onPtyHostRestart(() => {
			generation.restart();
			cancelOutstandingRequests();
		}));
		this._register(backend.onBaseHalfNodeCommandRequest(event => {
			const requestGeneration = generation.current;
			const requestKey = generation.key(event.requestId);
			const cancellation = new CancellationTokenSource();
			const previous = cancellations.get(requestKey);
			previous?.source.cancel();
			previous?.source.dispose();
			cancellations.set(requestKey, { persistentProcessId: event.persistentProcessId, source: cancellation });
			void this.handleRequest(backend, event, cancellation.token, () => generation.isCurrent(requestGeneration)).finally(() => {
				if (cancellations.get(requestKey)?.source === cancellation) {
					cancellations.delete(requestKey);
				}
				cancellation.dispose();
			});
		}));
		this._register(backend.onBaseHalfNodeCommandCancellationRequest(event => {
			const cancellation = cancellations.get(generation.key(event.requestId));
			if (cancellation?.persistentProcessId === event.persistentProcessId) {
				cancellation.source.cancel();
			}
		}));
	}

	private async handleRequest(
		backend: ITerminalBackend,
		event: IBaseHalfNodeCommandRequestEvent,
		cancellationToken: CancellationToken,
		isCurrentGeneration: () => boolean
	): Promise<void> {
		const response = await this.handler.handle(event, cancellationToken);
		if (!response || !isCurrentGeneration()) {
			return;
		}
		try {
			await backend.acceptBaseHalfNodeCommandResponse?.(event.requestId, response);
		} catch (error) {
			this.logService.error('BaseHalf could not return the node run result to its Agent Area terminal', error);
		}
	}
}

registerWorkbenchContribution2(
	BaseHalfNodeCommandBridgeContribution.ID,
	BaseHalfNodeCommandBridgeContribution,
	WorkbenchPhase.AfterRestored
);
