import { valid, validRange } from 'semver';

export const BASEHALF_FORBIDDEN_CONTRIBUTION_POINTS = [
  'viewsContainers',
  'views',
  'customEditors',
  'notebooks',
  'chatParticipants',
  'languageModelTools',
  'authentication',
] as const;

export interface BaseHalfCardProjectionContribution {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly extensions: readonly string[];
  readonly order?: number;
  readonly defaultPriority?: number;
}

export interface BaseHalfPluginManifest {
  readonly publisher: string;
  readonly name: string;
  readonly version: string;
  readonly displayName: string;
  readonly description: string;
  readonly license: string;
  readonly engines: {
    readonly vscode: string;
    readonly basehalf: string;
  };
  readonly main: string;
  readonly basehalf: {
    readonly primaryCommand: string;
    readonly primaryCommandLabel: string;
  };
  readonly enabledApiProposals?: readonly string[];
  readonly contributes: {
    readonly basehalfCardProjections?: readonly BaseHalfCardProjectionContribution[];
    readonly commands?: readonly {
      readonly command: string;
      readonly title: string;
      readonly category?: string;
    }[];
    readonly configuration?: unknown;
    readonly jsonValidation?: readonly {
      readonly fileMatch: string | readonly string[];
      readonly url: string;
    }[];
    readonly [key: string]: unknown;
  };
  readonly [key: string]: unknown;
}

/** Preserves literal manifest types while enforcing the BaseHalf publishing contract. */
export function defineBaseHalfPlugin<const T extends BaseHalfPluginManifest>(manifest: T): T {
  validateBaseHalfPluginManifest(manifest);
  return manifest;
}

export function validateBaseHalfPluginManifest(
  value: unknown,
): asserts value is BaseHalfPluginManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Plugin manifest must be an object.');
  }
  const manifest = value as Partial<BaseHalfPluginManifest>;
  const publisher = requiredText(manifest.publisher, 'publisher').toLowerCase();
  const name = requiredText(manifest.name, 'name').toLowerCase();
  const extensionId = `${publisher}.${name}`;
  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]\.[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/.test(extensionId)) {
    throw new Error(`Plugin identity '${extensionId}' is invalid.`);
  }
  const version = requiredText(manifest.version, 'version');
  if (!valid(version)) {
    throw new Error('Plugin manifest version must be valid SemVer.');
  }
  requiredText(manifest.displayName, 'displayName');
  requiredText(manifest.description, 'description');
  requiredText(manifest.license, 'license');
  requiredText(manifest.main, 'main');
  const primaryCommand = requiredText(manifest.basehalf?.primaryCommand, 'basehalf.primaryCommand');
  requiredText(manifest.basehalf?.primaryCommandLabel, 'basehalf.primaryCommandLabel');
  if (!primaryCommand.toLowerCase().startsWith(`${extensionId}.`)) {
    throw new Error(`Primary command '${primaryCommand}' must start with '${extensionId}.'.`);
  }
  const vscodeRange = requiredText(manifest.engines?.vscode, 'engines.vscode');
  const basehalfRange = requiredText(manifest.engines?.basehalf, 'engines.basehalf');
  if (!validRange(vscodeRange) || !validRange(basehalfRange)) {
    throw new Error('Plugin compatibility ranges must be valid SemVer ranges.');
  }
  if (manifest.enabledApiProposals?.length) {
    throw new Error('Published BaseHalf plugins cannot depend on proposed APIs.');
  }
  const contributes = manifest.contributes;
  if (!contributes || typeof contributes !== 'object' || Array.isArray(contributes)) {
    throw new Error('Plugin manifest must declare contributes.');
  }
  const forbidden = BASEHALF_FORBIDDEN_CONTRIBUTION_POINTS.filter((point) => point in contributes);
  if (forbidden.length) {
    throw new Error(`Plugin changes the fixed application shell: ${forbidden.join(', ')}.`);
  }
  if (!contributes.commands?.some((command) => command.command === primaryCommand)) {
    throw new Error(
      `Primary command '${primaryCommand}' must be declared in contributes.commands.`,
    );
  }
  const rawProjections = contributes.basehalfCardProjections;
  if (!Array.isArray(rawProjections) || rawProjections.length === 0) {
    throw new Error('Plugin manifest must contribute at least one BaseHalf card projection.');
  }
  const projections = rawProjections as readonly BaseHalfCardProjectionContribution[];
  const projectionIds = new Set<string>();
  for (const projection of projections) {
    requiredText(projection.id, 'basehalfCardProjections[].id');
    requiredText(projection.label, 'basehalfCardProjections[].label');
    if (!projection.id.toLowerCase().startsWith(`${extensionId}.`)) {
      throw new Error(`Projection '${projection.id}' must start with '${extensionId}.'.`);
    }
    if (projectionIds.has(projection.id.toLowerCase())) {
      throw new Error(`Projection '${projection.id}' is declared more than once.`);
    }
    projectionIds.add(projection.id.toLowerCase());
    if (
      !projection.extensions.length ||
      projection.extensions.some((extension) => !/^\.[a-z0-9][a-z0-9.-]*$/i.test(extension))
    ) {
      throw new Error(`Projection '${projection.id}' must declare valid file extensions.`);
    }
  }
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Plugin manifest is missing ${field}.`);
  }
  return value.trim();
}
