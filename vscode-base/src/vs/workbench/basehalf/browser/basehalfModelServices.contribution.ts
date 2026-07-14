/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../platform/actions/common/actions.js';
import { IDialogService } from '../../../platform/dialogs/common/dialogs.js';
import { ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../platform/notification/common/notification.js';
import { IQuickInputService, IQuickPickItem } from '../../../platform/quickinput/common/quickInput.js';
import {
	BASEHALF_CONFIGURE_MODEL_SERVICE_COMMAND_ID,
	BASEHALF_MANAGE_MODEL_SERVICES_COMMAND_ID,
	BASEHALF_MODEL_CAPABILITIES,
	BaseHalfModelCapability,
	BaseHalfModelServiceAuthorization,
	IBaseHalfModelServiceConfiguration,
	IBaseHalfModelServiceDescriptor,
	IBaseHalfModelServiceService,
	sanitizeBaseHalfModelServiceConfiguration,
} from '../common/basehalfModelServices.js';

interface IModelServicePick extends IQuickPickItem {
	readonly service?: IBaseHalfModelServiceDescriptor;
	readonly add?: boolean;
}

interface IModelServiceActionPick extends IQuickPickItem {
	readonly action: 'edit' | 'key' | 'remove';
}

interface ICapabilityPick extends IQuickPickItem {
	readonly capability: BaseHalfModelCapability;
}

interface IAuthorizationPick extends IQuickPickItem {
	readonly authorization: BaseHalfModelServiceAuthorization;
}

interface IModelServiceUiServices {
	readonly modelServices: IBaseHalfModelServiceService;
	readonly quickInput: IQuickInputService;
	readonly dialogs: IDialogService;
	readonly notifications: INotificationService;
}

registerAction2(class ManageBaseHalfModelServicesAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_MANAGE_MODEL_SERVICES_COMMAND_ID,
			title: localize2('basehalf.models.manage', 'Manage Model Services'),
			category: localize2('basehalf.category', 'BaseHalf'),
			f1: true,
			menu: {
				id: MenuId.MenubarPreferencesMenu,
				group: '2_configuration',
				order: 20
			}
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const ui = modelServiceUiServices(accessor);
		const services = await ui.modelServices.getServices();
		const picks: IModelServicePick[] = [
			{
				label: `$(add) ${localize('basehalf.models.add', 'Add Model Service')}`,
				detail: localize('basehalf.models.addDetail', 'Create one reusable connection for every reviewed plugin.'),
				add: true
			},
			...services.map(candidate => ({
				label: candidate.label,
				description: candidate.configured ? localize('basehalf.models.configured', 'Configured') : localize('basehalf.models.missingKey', 'API key required'),
				detail: `${candidate.endpoint} · ${candidate.capabilities.join(', ')}`,
				service: candidate
			}))
		];
		const pick = await ui.quickInput.pick(picks, {
			title: localize('basehalf.models.manageTitle', 'Model Services'),
			placeHolder: localize('basehalf.models.managePlaceholder', 'Choose a connection to manage')
		});
		if (!pick) {
			return;
		}
		if (pick.add) {
			await configureModelService(ui);
			return;
		}
		if (pick.service) {
			await manageExistingModelService(ui, pick.service);
		}
	}
});

registerAction2(class ConfigureBaseHalfModelServiceAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_CONFIGURE_MODEL_SERVICE_COMMAND_ID,
			title: localize2('basehalf.models.configure', 'Configure Model Service'),
			category: localize2('basehalf.category', 'BaseHalf'),
			f1: false
		});
	}

	override async run(accessor: ServicesAccessor, serviceId?: unknown): Promise<void> {
		const ui = modelServiceUiServices(accessor);
		const existing = typeof serviceId === 'string'
			? (await ui.modelServices.getServices()).find(service => service.id === serviceId.trim().toLowerCase())
			: undefined;
		await configureModelService(ui, existing);
	}
});

async function manageExistingModelService(ui: IModelServiceUiServices, service: IBaseHalfModelServiceDescriptor): Promise<void> {
	const action = await ui.quickInput.pick<IModelServiceActionPick>([
		{
			label: localize('basehalf.models.editConnection', 'Edit Connection'),
			detail: localize('basehalf.models.editConnectionDetail', 'Change endpoint, capabilities, or authorization without exposing the saved key.'),
			action: 'edit'
		},
		...service.authorization === 'none' ? [] : [{
			label: service.configured ? localize('basehalf.models.replaceKey', 'Replace API Key') : localize('basehalf.models.setKey', 'Set API Key'),
			detail: localize('basehalf.models.keyStorageDetail', 'The key is encrypted in application credential storage.'),
			action: 'key' as const
		}],
		{
			label: localize('basehalf.models.remove', 'Remove Connection'),
			detail: localize('basehalf.models.removeDetail', 'Remove the global connection and its saved credential.'),
			action: 'remove'
		}
	], {
		title: service.label,
		placeHolder: localize('basehalf.models.chooseAction', 'Choose an action')
	});
	if (!action) {
		return;
	}
	switch (action.action) {
		case 'edit':
			await configureModelService(ui, service);
			break;
		case 'key':
			await setModelServiceApiKey(ui, service);
			break;
		case 'remove': {
			const confirmation = await ui.dialogs.confirm({
				message: localize('basehalf.models.confirmRemove', 'Remove {0}?', service.label),
				detail: localize('basehalf.models.confirmRemoveDetail', 'Plugins will no longer be able to use this connection. Project files and generated outputs are not affected.'),
				primaryButton: localize('basehalf.models.removeButton', 'Remove')
			});
			if (confirmation.confirmed) {
				await ui.modelServices.remove(service.id);
				ui.notifications.info(localize('basehalf.models.removed', '{0} was removed.', service.label));
			}
			break;
		}
	}
}

async function configureModelService(ui: IModelServiceUiServices, existing?: IBaseHalfModelServiceDescriptor): Promise<void> {
	const label = await ui.quickInput.input({
		title: existing ? localize('basehalf.models.editTitle', 'Edit Model Service') : localize('basehalf.models.addTitle', 'Add Model Service'),
		prompt: localize('basehalf.models.namePrompt', 'Name shown to every plugin.'),
		value: existing?.label,
		placeHolder: localize('basehalf.models.namePlaceholder', 'Example: Studio generation account'),
		validateInput: async value => value.trim() ? value.trim().length <= 80 ? undefined : localize('basehalf.models.nameLong', 'Use 80 characters or fewer.') : localize('basehalf.models.nameRequired', 'Enter a name.')
	});
	if (label === undefined) {
		return;
	}

	const knownIds = new Set((await ui.modelServices.getServices()).map(service => service.id));
	const suggestedId = slugModelServiceId(label);
	const id = existing?.id ?? await ui.quickInput.input({
		title: localize('basehalf.models.idTitle', 'Connection ID'),
		prompt: localize('basehalf.models.idPrompt', 'Stable ID shared by plugins. It cannot be changed later.'),
		value: suggestedId,
		validateInput: async value => {
			const normalized = value.trim().toLowerCase();
			if (!/^[a-z][a-z0-9.-]{0,63}$/.test(normalized)) {
				return localize('basehalf.models.invalidId', 'Use 1–64 lowercase letters, numbers, dots, or hyphens, starting with a letter.');
			}
			return knownIds.has(normalized) ? localize('basehalf.models.duplicateId', 'That connection ID already exists.') : undefined;
		}
	});
	if (id === undefined) {
		return;
	}

	const endpoint = await ui.quickInput.input({
		title: localize('basehalf.models.endpointTitle', 'Service Endpoint'),
		prompt: localize('basehalf.models.endpointPrompt', 'Use HTTPS. Plain HTTP is allowed only for a service on this computer.'),
		value: existing?.endpoint ?? 'https://',
		placeHolder: 'https://api.example.com/v1',
		validateInput: async value => sanitizeBaseHalfModelServiceConfiguration(id, {
			label,
			endpoint: value,
			capabilities: ['text'],
			authorization: 'none'
		}) ? undefined : localize('basehalf.models.invalidEndpoint', 'Enter an HTTPS endpoint, or an HTTP localhost endpoint, without a query or fragment.')
	});
	if (endpoint === undefined) {
		return;
	}

	const capabilities = await ui.quickInput.pick<ICapabilityPick>(BASEHALF_MODEL_CAPABILITIES.map(capability => ({
		label: capabilityLabel(capability),
		capability,
		picked: existing?.capabilities.includes(capability) ?? true
	})), {
		title: localize('basehalf.models.capabilitiesTitle', 'Model Capabilities'),
		placeHolder: localize('basehalf.models.capabilitiesPlaceholder', 'Select what this connection can generate'),
		canPickMany: true
	});
	if (!capabilities?.length) {
		return;
	}

	const authorizationPicks: IAuthorizationPick[] = [
		{ label: localize('basehalf.models.authBearer', 'Bearer API Key'), description: 'Authorization: Bearer …', authorization: 'bearer', picked: (existing?.authorization ?? 'bearer') === 'bearer' },
		{ label: localize('basehalf.models.authHeader', 'API Key Header'), description: localize('basehalf.models.authHeaderDescription', 'A provider-specific header such as x-api-key'), authorization: 'header', picked: existing?.authorization === 'header' },
		{ label: localize('basehalf.models.authNone', 'No API Key'), description: localize('basehalf.models.authNoneDescription', 'For a trusted local service'), authorization: 'none', picked: existing?.authorization === 'none' }
	];
	const authorizationPick = await ui.quickInput.pick<IAuthorizationPick>(authorizationPicks, {
		title: localize('basehalf.models.authorizationTitle', 'Authorization'),
		placeHolder: localize('basehalf.models.authorizationPlaceholder', 'Choose how plugins authenticate'),
		canPickMany: false
	});
	if (!authorizationPick) {
		return;
	}

	const headerName = authorizationPick.authorization === 'header'
		? await ui.quickInput.input({
			title: localize('basehalf.models.headerTitle', 'API Key Header'),
			value: existing?.headerName ?? 'x-api-key',
			validateInput: async value => /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(value.trim()) ? undefined : localize('basehalf.models.invalidHeader', 'Enter a valid HTTP header name.')
		})
		: undefined;
	if (authorizationPick.authorization === 'header' && headerName === undefined) {
		return;
	}

	const configuration: IBaseHalfModelServiceConfiguration = {
		id,
		label: label.trim(),
		endpoint,
		capabilities: capabilities.map(item => item.capability),
		authorization: authorizationPick.authorization,
		...(headerName ? { headerName } : {})
	};
	await ui.modelServices.upsert(configuration);
	const needsKey = configuration.authorization !== 'none' && (!existing?.configured || existing.authorization === 'none');
	if (needsKey) {
		if (!await setModelServiceApiKey(ui, configuration)) {
			ui.notifications.warn(localize('basehalf.models.savedNeedsKey', '{0} was saved, but plugins cannot use it until an API key is added.', configuration.label));
		}
	} else {
		ui.notifications.info(localize('basehalf.models.saved', '{0} is available to reviewed plugins.', configuration.label));
	}
}

async function setModelServiceApiKey(ui: IModelServiceUiServices, service: IBaseHalfModelServiceConfiguration): Promise<boolean> {
	const apiKey = await ui.quickInput.input({
		title: localize('basehalf.models.apiKeyTitle', '{0} API Key', service.label),
		prompt: localize('basehalf.models.apiKeyPrompt', 'Stored encrypted for this BaseHalf installation. The value is never shown again.'),
		password: true,
		validateInput: async value => value.trim() ? undefined : localize('basehalf.models.apiKeyRequired', 'Enter an API key.')
	});
	if (apiKey === undefined) {
		return false;
	}
	await ui.modelServices.upsert(service, apiKey);
	ui.notifications.info(localize('basehalf.models.keySaved', '{0} is configured and available to reviewed plugins.', service.label));
	return true;
}

function modelServiceUiServices(accessor: ServicesAccessor): IModelServiceUiServices {
	return {
		modelServices: accessor.get(IBaseHalfModelServiceService),
		quickInput: accessor.get(IQuickInputService),
		dialogs: accessor.get(IDialogService),
		notifications: accessor.get(INotificationService),
	};
}

function slugModelServiceId(value: string): string {
	const slug = value.trim().toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^[^a-z]+/, '').replace(/-+$/g, '').slice(0, 64);
	return slug || 'model-service';
}

function capabilityLabel(capability: BaseHalfModelCapability): string {
	switch (capability) {
		case 'text': return localize('basehalf.models.text', 'Text');
		case 'image': return localize('basehalf.models.image', 'Image');
		case 'video': return localize('basehalf.models.video', 'Video');
		case 'audio': return localize('basehalf.models.audio', 'Audio');
	}
}
