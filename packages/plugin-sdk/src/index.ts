import { valid, validRange } from 'semver';
import { portableRelativePath } from './portablePath.js';
import {
  type BaseHalfCanvasTemplate,
  type BaseHalfCanvasTemplateInputBinding,
  type BaseHalfCanvasTemplateJsonValue,
  parseBaseHalfCanvasTemplate,
  validateBaseHalfCanvasTemplate,
} from './template.js';

export {
  BASEHALF_CANVAS_TEMPLATE_MAX_BYTES,
  BASEHALF_CANVAS_TEMPLATE_VERSION,
  BaseHalfCanvasTemplateValidationError,
  defineBaseHalfCanvasTemplate,
  parseBaseHalfCanvasTemplate,
  validateBaseHalfCanvasTemplate,
} from './template.js';
export type {
  BaseHalfCanvasTemplate,
  BaseHalfCanvasTemplateAnchor,
  BaseHalfCanvasTemplateCard,
  BaseHalfCanvasTemplateInputBinding,
  BaseHalfCanvasTemplateJsonValue,
  BaseHalfCanvasTemplateNode,
  BaseHalfCanvasTemplateNodeKind,
  BaseHalfCanvasTemplateRecipe,
  BaseHalfCanvasTemplateReference,
  BaseHalfCanvasTemplateTextFile,
} from './template.js';

export const BASEHALF_FORBIDDEN_CONTRIBUTION_POINTS = [
  'viewsContainers',
  'views',
  'customEditors',
  'notebooks',
  'chatParticipants',
  'languageModelTools',
  'authentication',
] as const;

export const BASEHALF_ALLOWED_CONTRIBUTION_POINTS = [
  'commands',
  'configuration',
  'jsonValidation',
  'basehalfAgentCapabilities',
  'basehalfCardProjections',
  'basehalfStructuralCleanups',
  'basehalfCanvasRecipes',
  'basehalfCanvasTemplates',
  'basehalfModelProviderCatalogs',
  'basehalfVideoModelCatalogs',
] as const;

export const BASEHALF_CANVAS_CONTENT_KINDS = [
  'text',
  'code',
  'file',
  'folder',
  'image',
  'video',
  'audio',
  'pdf',
  'presentation',
] as const;

export const BASEHALF_CANVAS_OUTPUT_KINDS = [
  'file',
  'image',
  'video',
  'audio',
  'pdf',
  'presentation',
] as const;

export type BaseHalfCanvasContentKind = (typeof BASEHALF_CANVAS_CONTENT_KINDS)[number];
export type BaseHalfCanvasOutputKind = (typeof BASEHALF_CANVAS_OUTPUT_KINDS)[number];
export type BaseHalfCanvasRecipeModelCapability = 'text' | 'image' | 'video' | 'audio';
export type BaseHalfModelCapability = BaseHalfCanvasRecipeModelCapability;
export type BaseHalfCanvasRecipeValue =
  | null
  | boolean
  | number
  | string
  | readonly BaseHalfCanvasRecipeValue[]
  | { readonly [key: string]: BaseHalfCanvasRecipeValue };

export interface BaseHalfCardProjectionContribution {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly extensions?: readonly string[];
  readonly fileNames?: readonly string[];
  readonly order?: number;
  readonly defaultPriority?: number;
}

export interface BaseHalfStructuralCleanupContribution {
  readonly id: string;
  readonly extensions: readonly string[];
}

export interface BaseHalfVideoModelCatalogContribution {
  readonly id: string;
  readonly resource: string;
}

/**
 * Points at a host-validated, versioned provider connection catalog shipped in
 * the extension. Connection fields and credential rules never live inline in
 * package.json.
 */
export interface BaseHalfModelProviderCatalogContribution {
  readonly id: string;
  readonly resource: string;
}

export interface BaseHalfCanvasRecipeInputContribution {
  readonly id: string;
  readonly label: string;
  readonly accepts: readonly BaseHalfCanvasContentKind[];
  readonly minItems: number;
  readonly maxItems: number;
}

interface BaseHalfCanvasRecipeParameterBase {
  readonly id: string;
  readonly label: string;
  readonly required?: boolean;
}

export interface BaseHalfCanvasRecipeStringParameterContribution
  extends BaseHalfCanvasRecipeParameterBase {
  readonly type: 'string' | 'multiline';
  readonly default?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
}

export interface BaseHalfCanvasRecipeNumberParameterContribution
  extends BaseHalfCanvasRecipeParameterBase {
  readonly type: 'number';
  readonly default?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly step?: number;
}

export interface BaseHalfCanvasRecipeBooleanParameterContribution
  extends BaseHalfCanvasRecipeParameterBase {
  readonly type: 'boolean';
  readonly default?: boolean;
}

export interface BaseHalfCanvasRecipeEnumOptionContribution {
  readonly value: string;
  readonly label: string;
}

export interface BaseHalfCanvasRecipeEnumParameterContribution
  extends BaseHalfCanvasRecipeParameterBase {
  readonly type: 'enum';
  readonly default?: string;
  readonly options: readonly BaseHalfCanvasRecipeEnumOptionContribution[];
}

export type BaseHalfCanvasRecipeParameterContribution =
  | BaseHalfCanvasRecipeStringParameterContribution
  | BaseHalfCanvasRecipeNumberParameterContribution
  | BaseHalfCanvasRecipeBooleanParameterContribution
  | BaseHalfCanvasRecipeEnumParameterContribution;

export interface BaseHalfCanvasRecipeOutputContribution {
  readonly id: string;
  readonly kind: BaseHalfCanvasOutputKind;
  readonly extensions: readonly string[];
  readonly minItems: number;
  readonly maxItems: number;
  readonly primary?: boolean;
}

export interface BaseHalfCanvasRecipeContribution {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: string;
  readonly modelCapability?: BaseHalfModelCapability;
  /** Exact reviewed catalog owned by this extension. Required only for video recipes. */
  readonly videoModelCatalogId?: string;
  readonly inputs?: readonly BaseHalfCanvasRecipeInputContribution[];
  readonly parameters?: readonly BaseHalfCanvasRecipeParameterContribution[];
  readonly outputs: readonly BaseHalfCanvasRecipeOutputContribution[];
}

export interface BaseHalfCanvasTemplateContribution {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly resource: string;
}

export type BaseHalfAgentOperationParameterType =
  | 'uri'
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'enum';

export interface BaseHalfAgentDocumentFormatContribution {
  readonly kind: string;
  readonly version: number;
  readonly fileExtensions: readonly string[];
  readonly schemaSummary: string;
}

export interface BaseHalfAgentOperationParameterContribution {
  readonly name: string;
  readonly type: BaseHalfAgentOperationParameterType;
  readonly required: boolean;
  readonly description: string;
  readonly values?: readonly string[];
}

export interface BaseHalfAgentOperationContribution {
  readonly id: string;
  readonly command: string;
  readonly description: string;
  readonly deterministic: true;
  readonly parameters?: readonly BaseHalfAgentOperationParameterContribution[];
  readonly returns: {
    readonly type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'void';
    readonly description: string;
  };
}

export interface BaseHalfAgentCapabilityContribution {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly documents?: readonly BaseHalfAgentDocumentFormatContribution[];
  readonly operations?: readonly BaseHalfAgentOperationContribution[];
}

export interface BaseHalfPluginManifest {
  readonly publisher: string;
  readonly name: string;
  readonly version: string;
  readonly displayName: string;
  readonly description: string;
  readonly license: string;
  readonly repository:
    | string
    | {
        readonly type?: string;
        readonly url: string;
        readonly directory?: string;
      };
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
    readonly basehalfAgentCapabilities?: readonly BaseHalfAgentCapabilityContribution[];
    readonly basehalfCardProjections?: readonly BaseHalfCardProjectionContribution[];
    readonly basehalfStructuralCleanups?: readonly BaseHalfStructuralCleanupContribution[];
    readonly basehalfCanvasRecipes?: readonly BaseHalfCanvasRecipeContribution[];
    readonly basehalfCanvasTemplates?: readonly BaseHalfCanvasTemplateContribution[];
    readonly basehalfModelProviderCatalogs?: readonly BaseHalfModelProviderCatalogContribution[];
    readonly basehalfVideoModelCatalogs?: readonly BaseHalfVideoModelCatalogContribution[];
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
  const manifest = record(value, 'Plugin manifest');
  const publisher = boundedText(manifest.publisher, 'publisher', 50);
  const name = boundedText(manifest.name, 'name', 100);
  const extensionId = `${publisher}.${name}`;
  if (
    publisher !== publisher.toLowerCase() ||
    name !== name.toLowerCase() ||
    !/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]\.[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/.test(extensionId)
  ) {
    throw new Error(`Plugin identity '${extensionId}' is invalid.`);
  }
  const version = requiredText(manifest.version, 'version');
  if (manifest.version !== version || valid(version) !== version) {
    throw new Error('Plugin manifest version must be canonical SemVer without build metadata.');
  }
  boundedText(manifest.displayName, 'displayName', 200);
  boundedText(manifest.description, 'description', 2_000);
  boundedText(manifest.license, 'license', 200);
  portableRelativePath(requiredText(manifest.main, 'main').replace(/^\.\//, ''), 'main', {
    maximumLength: 500,
    reserveBaseHalfState: true,
  });
  requireHttpsRepository(manifest.repository);

  for (const field of ['extensionDependencies', 'extensionPack'] as const) {
    if (field in manifest) {
      throw new Error(`Published BaseHalf plugins cannot declare ${field}.`);
    }
  }

  const basehalf = record(manifest.basehalf, 'basehalf');
  assertOnlyKeys(basehalf, ['primaryCommand', 'primaryCommandLabel'], 'basehalf');
  const primaryCommand = requiredText(basehalf.primaryCommand, 'basehalf.primaryCommand');
  boundedText(basehalf.primaryCommandLabel, 'basehalf.primaryCommandLabel', 100);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(primaryCommand) ||
    !primaryCommand.toLowerCase().startsWith(`${extensionId}.`)
  ) {
    throw new Error(`Primary command '${primaryCommand}' must start with '${extensionId}.'.`);
  }

  const engines = record(manifest.engines, 'engines');
  const vscodeRange = requiredText(engines.vscode, 'engines.vscode');
  const basehalfRange = requiredText(engines.basehalf, 'engines.basehalf');
  if (!validRange(vscodeRange) || !validRange(basehalfRange)) {
    throw new Error('Plugin compatibility ranges must be valid SemVer ranges.');
  }
  if (
    manifest.enabledApiProposals !== undefined &&
    (!Array.isArray(manifest.enabledApiProposals) || manifest.enabledApiProposals.length > 0)
  ) {
    throw new Error('Published BaseHalf plugins cannot depend on proposed APIs.');
  }

  const contributes = record(manifest.contributes, 'contributes');
  const unsupported = Object.keys(contributes).filter(
    (point) =>
      !BASEHALF_ALLOWED_CONTRIBUTION_POINTS.includes(
        point as (typeof BASEHALF_ALLOWED_CONTRIBUTION_POINTS)[number],
      ),
  );
  if (unsupported.length) {
    throw new Error(
      `Plugin changes the fixed application shell: ${unsupported.sort().join(', ')}.`,
    );
  }
  const commands = validateCommands(contributes.commands, extensionId, primaryCommand);
  validateConfiguration(contributes.configuration, extensionId);
  validateJsonValidation(contributes.jsonValidation);

  const projections = contributionArray(
    contributes.basehalfCardProjections,
    'basehalfCardProjections',
  );
  const recipes = contributionArray(contributes.basehalfCanvasRecipes, 'basehalfCanvasRecipes');
  const structuralCleanups = contributionArray(
    contributes.basehalfStructuralCleanups,
    'basehalfStructuralCleanups',
  );
  const templates = contributionArray(
    contributes.basehalfCanvasTemplates,
    'basehalfCanvasTemplates',
  );
  const videoModelCatalogs = contributionArray(
    contributes.basehalfVideoModelCatalogs,
    'basehalfVideoModelCatalogs',
  );
  const modelProviderCatalogs = contributionArray(
    contributes.basehalfModelProviderCatalogs,
    'basehalfModelProviderCatalogs',
  );
  const agentCapabilities = contributionArray(
    contributes.basehalfAgentCapabilities,
    'basehalfAgentCapabilities',
  );
  if (
    projections.length +
      recipes.length +
      templates.length +
      modelProviderCatalogs.length +
      videoModelCatalogs.length +
      agentCapabilities.length +
      structuralCleanups.length ===
    0
  ) {
    throw new Error(
      'Plugin manifest must contribute a BaseHalf Agent capability, card projection, canvas recipe, canvas template, model provider catalog, video model catalog, or structural cleanup.',
    );
  }
  validateAgentCapabilities(extensionId, agentCapabilities, commands);
  const projectionIds = validateProjections(extensionId, projections);
  const structuralCleanupIds = validateStructuralCleanups(extensionId, structuralCleanups);
  validateModelProviderCatalogs(extensionId, modelProviderCatalogs);
  const videoModelCatalogIds = validateVideoModelCatalogs(extensionId, videoModelCatalogs);
  const recipeIds = validateRecipes(extensionId, recipes, videoModelCatalogIds);
  validateTemplates(extensionId, templates);
  validateActivationEvents(
    manifest.activationEvents,
    commands,
    projectionIds,
    recipeIds,
    structuralCleanupIds,
  );
}

/**
 * Applies the cross-resource checks that require both a manifest and one of its
 * static canvas templates. Structural validation alone cannot prove that a
 * recipe exists or that its parameters, direct inputs, and primary output fit
 * the node that uses it.
 */
export function validateBaseHalfCanvasTemplateAgainstManifest(
  templateValue: unknown,
  manifestValue: unknown,
): asserts templateValue is BaseHalfCanvasTemplate {
  validateBaseHalfPluginManifest(manifestValue);
  validateBaseHalfCanvasTemplate(templateValue);
  const manifest = manifestValue as BaseHalfPluginManifest;
  const template = templateValue as BaseHalfCanvasTemplate;
  const recipes = new Map(
    (manifest.contributes.basehalfCanvasRecipes ?? []).map((recipe) => [recipe.id, recipe]),
  );
  const resources = new Map<string, BaseHalfCanvasContentKind>([
    ...template.files.map((file) => [file.path, contentKindForPath(file.path)] as const),
    ...template.nodes.map((node) => [node.path, node.kind] as const),
  ]);
  const references = new Set(
    template.references.map((reference) => `${reference.from}\u0000${reference.to}`),
  );

  for (const node of template.nodes) {
    if (!node.recipe) continue;
    const recipe = recipes.get(node.recipe.recipeId);
    if (!recipe) {
      throw new Error(
        `Canvas template node '${node.path}' uses undeclared recipe '${node.recipe.recipeId}'.`,
      );
    }
    const primary = recipe.outputs.find((output) => output.primary === true);
    if (!primary || primary.kind !== node.kind) {
      throw new Error(
        `Canvas template node '${node.path}' does not match recipe '${recipe.id}' primary output kind.`,
      );
    }
    validateTemplateParameters(node.recipe.parameters, recipe);
    validateTemplateBindings(node.path, node.recipe.inputBindings, resources, references, recipe);
  }
}

/** Parses a UTF-8 template and applies its owning manifest's complete contract. */
export function parseBaseHalfCanvasTemplateForManifest(
  source: string,
  manifest: unknown,
): BaseHalfCanvasTemplate {
  const template = parseBaseHalfCanvasTemplate(source);
  validateBaseHalfCanvasTemplateAgainstManifest(template, manifest);
  return template;
}

function validateTemplateParameters(
  values: Readonly<Record<string, BaseHalfCanvasTemplateJsonValue>>,
  recipe: BaseHalfCanvasRecipeContribution,
): void {
  const definitions = new Map(
    (recipe.parameters ?? []).map((parameter) => [parameter.id, parameter]),
  );
  for (const id of Object.keys(values)) {
    if (!definitions.has(id)) {
      throw new Error(
        `Canvas template sets undeclared parameter '${id}' for recipe '${recipe.id}'.`,
      );
    }
  }
  for (const [id, parameter] of definitions) {
    const value = Object.prototype.hasOwnProperty.call(values, id) ? values[id] : parameter.default;
    if (value === undefined) {
      if (parameter.required === true) {
        throw new Error(
          `Canvas template omits required parameter '${id}' for recipe '${recipe.id}'.`,
        );
      }
      continue;
    }
    let validValue = false;
    switch (parameter.type) {
      case 'string':
      case 'multiline':
        validValue =
          typeof value === 'string' &&
          (parameter.required !== true || value.trim().length > 0) &&
          (parameter.minLength === undefined || value.length >= parameter.minLength) &&
          (parameter.maxLength === undefined || value.length <= parameter.maxLength);
        break;
      case 'number':
        validValue =
          typeof value === 'number' &&
          Number.isFinite(value) &&
          (parameter.minimum === undefined || value >= parameter.minimum) &&
          (parameter.maximum === undefined || value <= parameter.maximum);
        break;
      case 'boolean':
        validValue = typeof value === 'boolean';
        break;
      case 'enum':
        validValue =
          typeof value === 'string' && parameter.options.some((option) => option.value === value);
        break;
    }
    if (!validValue) {
      throw new Error(`Canvas template parameter '${id}' is invalid for recipe '${recipe.id}'.`);
    }
  }
}

function validateTemplateBindings(
  nodePath: string,
  bindings: readonly BaseHalfCanvasTemplateInputBinding[],
  resources: ReadonlyMap<string, BaseHalfCanvasContentKind>,
  references: ReadonlySet<string>,
  recipe: BaseHalfCanvasRecipeContribution,
): void {
  const slots = new Map((recipe.inputs ?? []).map((slot) => [slot.id, slot]));
  for (const binding of bindings) {
    const sourceKind = resources.get(binding.sourcePath);
    const slot = slots.get(binding.slot);
    if (!sourceKind || !slot) {
      throw new Error(`Canvas template has an invalid input binding for node '${nodePath}'.`);
    }
    if (!slot.accepts.includes(sourceKind)) {
      throw new Error(
        `Canvas template binds incompatible resource '${binding.sourcePath}' to '${binding.slot}'.`,
      );
    }
    if (!references.has(`${binding.sourcePath}\u0000${nodePath}`)) {
      throw new Error(
        `Canvas template binds '${binding.sourcePath}' without a direct reference to '${nodePath}'.`,
      );
    }
  }
  for (const [slotId, slot] of slots) {
    const count = bindings.filter((binding) => binding.slot === slotId).length;
    if (count < slot.minItems || count > slot.maxItems) {
      throw new Error(
        `Canvas template has ${count} inputs for '${slotId}', outside recipe '${recipe.id}' range.`,
      );
    }
  }
}

function contentKindForPath(resourcePath: string): BaseHalfCanvasContentKind {
  const dot = resourcePath.lastIndexOf('.');
  const extension = dot >= 0 ? resourcePath.slice(dot).toLowerCase() : '';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg'].includes(extension)) {
    return 'image';
  }
  if (['.mp4', '.mov', '.webm', '.m4v', '.avi', '.mkv'].includes(extension)) return 'video';
  if (['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'].includes(extension)) return 'audio';
  if (extension === '.pdf') return 'pdf';
  if (['.ppt', '.pptx', '.key'].includes(extension)) return 'presentation';
  if (
    [
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.py',
      '.rs',
      '.go',
      '.java',
      '.c',
      '.cc',
      '.cpp',
      '.h',
      '.hpp',
      '.css',
      '.html',
      '.sh',
    ].includes(extension)
  ) {
    return 'code';
  }
  if (['.md', '.mdx', '.txt', '.json', '.yaml', '.yml', '.toml', '.csv'].includes(extension)) {
    return 'text';
  }
  return 'file';
}

function validateCommands(
  value: unknown,
  extensionId: string,
  primaryCommand: string,
): ReadonlySet<string> {
  const commands = contributionArray(value, 'commands', true);
  if (commands.length > 128) {
    throw new Error('Plugin declares too many commands.');
  }
  const ids = new Set<string>();
  for (const [index, value] of commands.entries()) {
    const command = record(value, `commands[${index}]`);
    assertOnlyKeys(
      command,
      ['command', 'title', 'shortTitle', 'category', 'enablement', 'icon'],
      `commands[${index}]`,
    );
    const id = requiredText(command.command, `commands[${index}].command`);
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) ||
      !id.toLowerCase().startsWith(`${extensionId}.`)
    ) {
      throw new Error(`Plugin command '${id}' is not owned by '${extensionId}'.`);
    }
    if (ids.has(id)) {
      throw new Error(`Plugin command '${id}' is declared more than once.`);
    }
    ids.add(id);
    boundedText(command.title, `commands[${index}].title`, 200);
    optionalBoundedText(command.shortTitle, `commands[${index}].shortTitle`, 100);
    optionalBoundedText(command.category, `commands[${index}].category`, 100);
    optionalBoundedText(command.enablement, `commands[${index}].enablement`, 1_000);
    if (command.icon !== undefined && typeof command.icon !== 'string' && !isRecord(command.icon)) {
      throw new Error(`Plugin command '${id}' has an invalid icon.`);
    }
  }
  if (!ids.has(primaryCommand)) {
    throw new Error(
      `Primary command '${primaryCommand}' must be declared in contributes.commands.`,
    );
  }
  return ids;
}

function validateConfiguration(value: unknown, extensionId: string): void {
  if (value === undefined) return;
  const configurations = Array.isArray(value) ? value : [value];
  if (
    configurations.length === 0 ||
    configurations.length > 32 ||
    configurations.some((candidate) => !isRecord(candidate))
  ) {
    throw new Error("Plugin contribution 'configuration' is invalid.");
  }
  const propertyIds = new Set<string>();
  const budget = { remaining: 4_096 };
  for (const [index, value] of configurations.entries()) {
    const configuration = record(value, `configuration[${index}]`);
    const properties = record(configuration.properties, `configuration[${index}].properties`);
    const entries = Object.entries(properties);
    if (entries.length === 0 || entries.length > 256) {
      throw new Error(`Plugin configuration[${index}] must declare 1-256 settings.`);
    }
    for (const [propertyId, schema] of entries) {
      const canonicalId = propertyId.toLowerCase();
      if (
        propertyId.length > 200 ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(propertyId) ||
        !canonicalId.startsWith(`${extensionId}.`) ||
        propertyIds.has(canonicalId)
      ) {
        throw new Error(
          `Plugin configuration setting '${propertyId}' is invalid, duplicated, or outside '${extensionId}'.`,
        );
      }
      propertyIds.add(canonicalId);
      if (schema === undefined) {
        throw new Error(`Plugin configuration setting '${propertyId}' is missing its schema.`);
      }
    }
    validateConfigurationSchema(
      configuration,
      `configuration[${index}]`,
      0,
      budget,
      new WeakSet<object>(),
    );
  }
}

function validateConfigurationSchema(
  value: unknown,
  field: string,
  depth: number,
  budget: { remaining: number },
  ancestors: WeakSet<object>,
): void {
  budget.remaining -= 1;
  if (budget.remaining < 0 || depth > 12) {
    throw new Error(`Plugin ${field} exceeds the configuration complexity limit.`);
  }
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Plugin ${field} must be finite JSON.`);
    return;
  }
  if (typeof value === 'string') {
    if (value.length > 100_000 || value.includes('\u0000')) {
      throw new Error(`Plugin ${field} contains invalid configuration text.`);
    }
    return;
  }
  if (!value || typeof value !== 'object') {
    throw new Error(`Plugin ${field} must contain JSON-compatible configuration data.`);
  }
  if (ancestors.has(value)) {
    throw new Error(`Plugin ${field} contains a configuration cycle.`);
  }
  ancestors.add(value);
  const entries = Array.isArray(value) ? value.entries() : Object.entries(value);
  const size = Array.isArray(value) ? value.length : Object.keys(value).length;
  if (size > 1_000) {
    throw new Error(`Plugin ${field} exceeds the configuration collection limit.`);
  }
  for (const [key, entry] of entries) {
    if (
      typeof key === 'string' &&
      (!key ||
        key.length > 200 ||
        key === '__proto__' ||
        key === 'constructor' ||
        key === 'prototype')
    ) {
      throw new Error(`Plugin ${field} contains an invalid configuration key.`);
    }
    validateConfigurationSchema(entry, `${field}.${String(key)}`, depth + 1, budget, ancestors);
  }
  ancestors.delete(value);
}

function validateJsonValidation(value: unknown): void {
  const validators = contributionArray(value, 'jsonValidation');
  if (validators.length > 64) {
    throw new Error("Plugin contribution 'jsonValidation' has too many entries.");
  }
  for (const [index, value] of validators.entries()) {
    const validator = record(value, `jsonValidation[${index}]`);
    assertOnlyKeys(validator, ['fileMatch', 'url'], `jsonValidation[${index}]`);
    const matches = Array.isArray(validator.fileMatch)
      ? validator.fileMatch
      : [validator.fileMatch];
    if (
      matches.length === 0 ||
      matches.length > 64 ||
      matches.some(
        (match) =>
          typeof match !== 'string' ||
          !match.trim() ||
          match.length > 500 ||
          containsControlCharacter(match),
      )
    ) {
      throw new Error(`Plugin jsonValidation[${index}].fileMatch is invalid.`);
    }
    portableRelativePath(validator.url, `jsonValidation[${index}].url`, {
      maximumLength: 500,
      requireExtension: '.json',
      reserveBaseHalfState: true,
    });
  }
}

function validateActivationEvents(
  value: unknown,
  commands: ReadonlySet<string>,
  projections: ReadonlySet<string>,
  recipes: ReadonlySet<string>,
  structuralCleanups: ReadonlySet<string>,
): void {
  if (value === undefined) return;
  if (
    !Array.isArray(value) ||
    value.length > 256 ||
    value.some((event) => typeof event !== 'string')
  ) {
    throw new Error('Plugin activationEvents are invalid.');
  }
  for (const event of value as string[]) {
    const [kind, id, extra] = event.split(':');
    const allowed =
      typeof id === 'string' &&
      !!id &&
      extra === undefined &&
      ((kind === 'onCommand' && commands.has(id)) ||
        (kind === 'onBaseHalfCardProjection' && projections.has(id)) ||
        (kind === 'onBaseHalfCanvasRecipe' && recipes.has(id)) ||
        (kind === 'onBaseHalfStructuralCleanup' && structuralCleanups.has(id)));
    if (!allowed) {
      throw new Error(`Plugin activation event '${event}' is not tied to a declared contribution.`);
    }
  }
}

function validateStructuralCleanups(
  extensionId: string,
  values: readonly unknown[],
): ReadonlySet<string> {
  if (values.length > 16) {
    throw new Error('basehalfStructuralCleanups cannot contain more than 16 contributions.');
  }
  const ids = new Set<string>();
  for (const [index, value] of values.entries()) {
    const cleanup = record(value, `basehalfStructuralCleanups[${index}]`);
    assertOnlyKeys(cleanup, ['id', 'extensions'], `basehalfStructuralCleanups[${index}]`);
    const id = ownedContributionId(cleanup.id, extensionId, ids, 'Structural cleanup');
    const extensions = contributionArray(cleanup.extensions, `${id}.extensions`, true);
    if (
      extensions.length > 16 ||
      new Set(extensions.map((extension) => String(extension).toLowerCase())).size !==
        extensions.length ||
      extensions.some(
        (extension) => typeof extension !== 'string' || !/^\.[a-z0-9][a-z0-9.-]*$/i.test(extension),
      )
    ) {
      throw new Error(`Structural cleanup '${id}' must declare valid file extensions.`);
    }
  }
  return ids;
}

function validateProjections(extensionId: string, values: readonly unknown[]): ReadonlySet<string> {
  if (values.length > 64) {
    throw new Error('basehalfCardProjections cannot contain more than 64 projections.');
  }
  const ids = new Set<string>();
  for (const [index, value] of values.entries()) {
    const projection = record(value, `basehalfCardProjections[${index}]`);
    assertOnlyKeys(
      projection,
      ['id', 'label', 'icon', 'extensions', 'fileNames', 'order', 'defaultPriority'],
      `basehalfCardProjections[${index}]`,
    );
    const id = ownedContributionId(projection.id, extensionId, ids, 'Projection');
    boundedText(projection.label, 'basehalfCardProjections[].label', 80);
    const icon = optionalBoundedText(projection.icon, `${id}.icon`, 64);
    if (icon !== undefined && !/^[a-z][a-z0-9-]*$/.test(icon)) {
      throw new Error(`Projection '${id}' has an invalid icon.`);
    }
    const extensions = contributionArray(
      projection.extensions,
      `basehalfCardProjections[${id}].extensions`,
      false,
    );
    const fileNames = contributionArray(
      projection.fileNames,
      `basehalfCardProjections[${id}].fileNames`,
      false,
    );
    if (
      (extensions.length === 0 && fileNames.length === 0) ||
      extensions.length > 64 ||
      fileNames.length > 64 ||
      new Set(extensions.map((extension) => String(extension).toLowerCase())).size !==
        extensions.length ||
      new Set(fileNames.map((fileName) => String(fileName).toLowerCase())).size !==
        fileNames.length ||
      extensions.some(
        (extension) => typeof extension !== 'string' || !/^\.[a-z0-9][a-z0-9.-]*$/i.test(extension),
      ) ||
      fileNames.some(
        (fileName) =>
          typeof fileName !== 'string' ||
          !/^[a-z0-9][a-z0-9._-]*$/i.test(fileName) ||
          fileName === '.' ||
          fileName === '..',
      )
    ) {
      throw new Error(`Projection '${id}' must declare valid file extensions or exact file names.`);
    }
    optionalFiniteNumber(projection.order, `${id}.order`);
    optionalFiniteNumber(projection.defaultPriority, `${id}.defaultPriority`);
  }
  return ids;
}

function validateRecipes(
  extensionId: string,
  values: readonly unknown[],
  videoModelCatalogIds: ReadonlySet<string>,
): ReadonlySet<string> {
  if (values.length > 64) {
    throw new Error('basehalfCanvasRecipes cannot contain more than 64 recipes.');
  }
  const ids = new Set<string>();
  for (const value of values) {
    const recipe = record(value, 'basehalfCanvasRecipes[]');
    assertOnlyKeys(
      recipe,
      [
        'id',
        'label',
        'description',
        'icon',
        'modelCapability',
        'videoModelCatalogId',
        'inputs',
        'parameters',
        'outputs',
      ],
      'basehalfCanvasRecipes[]',
    );
    const id = ownedContributionId(recipe.id, extensionId, ids, 'Canvas recipe');
    boundedText(recipe.label, `${id}.label`, 80);
    optionalBoundedText(recipe.description, `${id}.description`, 500);
    const icon = optionalBoundedText(recipe.icon, `${id}.icon`, 64);
    if (icon !== undefined && !/^[a-z][a-z0-9-]*$/.test(icon)) {
      throw new Error(`Canvas recipe '${id}' has an invalid icon.`);
    }
    if (
      recipe.modelCapability !== undefined &&
      (typeof recipe.modelCapability !== 'string' ||
        !['text', 'image', 'video', 'audio'].includes(recipe.modelCapability))
    ) {
      throw new Error(`Canvas recipe '${id}' has an invalid model capability.`);
    }
    if (recipe.modelCapability === 'video') {
      const catalogId = ownedContributionId(
        recipe.videoModelCatalogId,
        extensionId,
        new Set<string>(),
        `Canvas recipe '${id}' video model catalog`,
      );
      if (!videoModelCatalogIds.has(catalogId)) {
        throw new Error(
          `Canvas recipe '${id}' references undeclared video model catalog '${catalogId}'.`,
        );
      }
    } else if (recipe.videoModelCatalogId !== undefined) {
      throw new Error(
        `Canvas recipe '${id}' cannot declare a video model catalog without video model capability.`,
      );
    }
    validateRecipeInputs(id, contributionArray(recipe.inputs, `${id}.inputs`));
    const parameters = contributionArray(recipe.parameters, `${id}.parameters`);
    validateRecipeParameters(id, parameters);
    if (recipe.modelCapability === 'video' && parameters.length > 0) {
      throw new Error(
        `Video recipe '${id}' must use reviewed catalog settings instead of static parameters.`,
      );
    }
    const outputs = contributionArray(recipe.outputs, `${id}.outputs`, true);
    validateRecipeOutputs(id, outputs);
    if (
      recipe.modelCapability === 'video' &&
      record(outputs[0], `${id}.outputs[0]`).kind !== 'video'
    ) {
      throw new Error(`Video recipe '${id}' must produce a video Result.`);
    }
    if (
      record(outputs[0], `${id}.outputs[0]`).kind === 'video' &&
      recipe.modelCapability !== undefined &&
      recipe.modelCapability !== 'video'
    ) {
      throw new Error(
        `Local video recipe '${id}' must omit model capability, or use the reviewed video model capability.`,
      );
    }
  }
  return ids;
}

function validateRecipeInputs(recipeId: string, values: readonly unknown[]): void {
  if (values.length > 16) {
    throw new Error(`Canvas recipe '${recipeId}' has too many inputs.`);
  }
  const ids = new Set<string>();
  let maximumItems = 0;
  for (const value of values) {
    const input = record(value, `${recipeId}.inputs[]`);
    assertOnlyKeys(
      input,
      ['id', 'label', 'accepts', 'minItems', 'maxItems'],
      `${recipeId}.inputs[]`,
    );
    const id = localId(input.id, `${recipeId}.input`, ids);
    boundedText(input.label, `${recipeId}.input.${id}.label`, 80);
    const accepts = contributionArray(input.accepts, `${recipeId}.input.${id}.accepts`, true);
    if (
      accepts.length > BASEHALF_CANVAS_CONTENT_KINDS.length ||
      new Set(accepts).size !== accepts.length ||
      accepts.some(
        (kind) => !BASEHALF_CANVAS_CONTENT_KINDS.includes(kind as BaseHalfCanvasContentKind),
      )
    ) {
      throw new Error(
        `Canvas recipe '${recipeId}' input '${id}' has invalid accepted content kinds.`,
      );
    }
    validateItemRange(input.minItems, input.maxItems, `${recipeId}.input.${id}`);
    maximumItems += input.maxItems as number;
  }
  if (maximumItems > 64) {
    throw new Error(`Canvas recipe '${recipeId}' can bind no more than 64 inputs in total.`);
  }
}

function validateRecipeParameters(recipeId: string, values: readonly unknown[]): void {
  if (values.length > 32) {
    throw new Error(`Canvas recipe '${recipeId}' has too many parameters.`);
  }
  const ids = new Set<string>();
  for (const value of values) {
    const parameter = record(value, `${recipeId}.parameters[]`);
    const id = localId(parameter.id, `${recipeId}.parameter`, ids);
    boundedText(parameter.label, `${recipeId}.parameter.${id}.label`, 80);
    if (parameter.required !== undefined && typeof parameter.required !== 'boolean') {
      throw new Error(`Canvas recipe '${recipeId}' parameter '${id}' has invalid required state.`);
    }
    switch (parameter.type) {
      case 'string':
      case 'multiline':
        validateStringParameter(recipeId, id, parameter);
        break;
      case 'number':
        validateNumberParameter(recipeId, id, parameter);
        break;
      case 'boolean':
        assertOnlyKeys(
          parameter,
          ['id', 'label', 'required', 'type', 'default'],
          `${recipeId}.parameter.${id}`,
        );
        if (parameter.default !== undefined && typeof parameter.default !== 'boolean') {
          throw new Error(
            `Canvas recipe '${recipeId}' parameter '${id}' has an invalid boolean default.`,
          );
        }
        break;
      case 'enum':
        validateEnumParameter(recipeId, id, parameter);
        break;
      default:
        throw new Error(`Canvas recipe '${recipeId}' parameter '${id}' has an invalid type.`);
    }
  }
}

function validateStringParameter(
  recipeId: string,
  id: string,
  parameter: Record<string, unknown>,
): void {
  assertOnlyKeys(
    parameter,
    ['id', 'label', 'required', 'type', 'default', 'minLength', 'maxLength'],
    `${recipeId}.parameter.${id}`,
  );
  const minimum = optionalInteger(
    parameter.minLength,
    `${recipeId}.parameter.${id}.minLength`,
    0,
    100_000,
  );
  const maximum = optionalInteger(
    parameter.maxLength,
    `${recipeId}.parameter.${id}.maxLength`,
    1,
    100_000,
  );
  if (minimum !== undefined && maximum !== undefined && maximum < minimum) {
    throw new Error(`Canvas recipe '${recipeId}' parameter '${id}' has an invalid length range.`);
  }
  if (parameter.default !== undefined) {
    const defaultValue = boundedText(
      parameter.default,
      `${recipeId}.parameter.${id}.default`,
      maximum ?? 100_000,
      true,
    );
    if (parameter.required === true && defaultValue.trim().length === 0) {
      throw new Error(
        `Canvas recipe '${recipeId}' required parameter '${id}' has a blank default.`,
      );
    }
    if (minimum !== undefined && defaultValue.length < minimum) {
      throw new Error(
        `Canvas recipe '${recipeId}' parameter '${id}' default is shorter than minLength.`,
      );
    }
  }
}

function validateNumberParameter(
  recipeId: string,
  id: string,
  parameter: Record<string, unknown>,
): void {
  assertOnlyKeys(
    parameter,
    ['id', 'label', 'required', 'type', 'default', 'minimum', 'maximum', 'step'],
    `${recipeId}.parameter.${id}`,
  );
  const minimum = optionalFiniteNumber(parameter.minimum, `${recipeId}.parameter.${id}.minimum`);
  const maximum = optionalFiniteNumber(parameter.maximum, `${recipeId}.parameter.${id}.maximum`);
  if (minimum !== undefined && maximum !== undefined && maximum < minimum) {
    throw new Error(`Canvas recipe '${recipeId}' parameter '${id}' has an invalid number range.`);
  }
  const step = optionalFiniteNumber(parameter.step, `${recipeId}.parameter.${id}.step`);
  if (step !== undefined && step <= 0) {
    throw new Error(`Canvas recipe '${recipeId}' parameter '${id}' step must be positive.`);
  }
  const defaultValue = optionalFiniteNumber(
    parameter.default,
    `${recipeId}.parameter.${id}.default`,
  );
  if (
    defaultValue !== undefined &&
    ((minimum !== undefined && defaultValue < minimum) ||
      (maximum !== undefined && defaultValue > maximum))
  ) {
    throw new Error(`Canvas recipe '${recipeId}' parameter '${id}' default is outside its range.`);
  }
}

function validateEnumParameter(
  recipeId: string,
  id: string,
  parameter: Record<string, unknown>,
): void {
  assertOnlyKeys(
    parameter,
    ['id', 'label', 'required', 'type', 'default', 'options'],
    `${recipeId}.parameter.${id}`,
  );
  const options = contributionArray(parameter.options, `${recipeId}.parameter.${id}.options`, true);
  if (options.length > 50) {
    throw new Error(
      `Canvas recipe '${recipeId}' parameter '${id}' has an invalid enum option count.`,
    );
  }
  const values = new Set<string>();
  for (const value of options) {
    const option = record(value, `${recipeId}.parameter.${id}.options[]`);
    assertOnlyKeys(option, ['value', 'label'], `${recipeId}.parameter.${id}.options[]`);
    const optionValue = boundedText(option.value, `${recipeId}.parameter.${id}.option.value`, 100);
    boundedText(option.label, `${recipeId}.parameter.${id}.option.label`, 100);
    if (values.has(optionValue)) {
      throw new Error(
        `Canvas recipe '${recipeId}' parameter '${id}' has duplicate enum value '${optionValue}'.`,
      );
    }
    values.add(optionValue);
  }
  if (
    parameter.default !== undefined &&
    (typeof parameter.default !== 'string' || !values.has(parameter.default))
  ) {
    throw new Error(`Canvas recipe '${recipeId}' parameter '${id}' default is not an enum option.`);
  }
}

function validateRecipeOutputs(recipeId: string, values: readonly unknown[]): void {
  if (values.length !== 1) {
    throw new Error(
      `Canvas recipe '${recipeId}' must declare exactly one output for one Result node.`,
    );
  }
  const ids = new Set<string>();
  for (const value of values) {
    const output = record(value, `${recipeId}.outputs[]`);
    assertOnlyKeys(
      output,
      ['id', 'kind', 'extensions', 'minItems', 'maxItems', 'primary'],
      `${recipeId}.outputs[]`,
    );
    const id = localId(output.id, `${recipeId}.output`, ids);
    if (!BASEHALF_CANVAS_OUTPUT_KINDS.includes(output.kind as BaseHalfCanvasOutputKind)) {
      throw new Error(`Canvas recipe '${recipeId}' output '${id}' has an invalid content kind.`);
    }
    const extensions = contributionArray(
      output.extensions,
      `${recipeId}.output.${id}.extensions`,
      true,
    );
    if (
      extensions.length > 16 ||
      new Set(extensions.map((extension) => String(extension).toLowerCase())).size !==
        extensions.length ||
      extensions.some(
        (extension) =>
          typeof extension !== 'string' || !/^\.[a-z0-9][a-z0-9.-]{0,15}$/i.test(extension),
      )
    ) {
      throw new Error(`Canvas recipe '${recipeId}' output '${id}' has invalid file extensions.`);
    }
    validateItemRange(output.minItems, output.maxItems, `${recipeId}.output.${id}`);
    if (output.primary !== undefined && typeof output.primary !== 'boolean') {
      throw new Error(`Canvas recipe '${recipeId}' output '${id}' has invalid primary state.`);
    }
    if (output.primary !== true) {
      throw new Error(`Canvas recipe '${recipeId}' must declare exactly one primary output.`);
    }
    if (output.minItems !== 1 || output.maxItems !== 1) {
      throw new Error(
        `Canvas recipe '${recipeId}' primary output must produce exactly one artifact.`,
      );
    }
  }
  const primary = values.find((value) => isRecord(value) && value.primary === true) as
    | Record<string, unknown>
    | undefined;
  if (primary?.minItems !== 1 || primary.maxItems !== 1) {
    throw new Error(
      `Canvas recipe '${recipeId}' primary output must produce exactly one artifact.`,
    );
  }
}

function validateTemplates(extensionId: string, values: readonly unknown[]): void {
  if (values.length > 64) {
    throw new Error('basehalfCanvasTemplates cannot contain more than 64 templates.');
  }
  const ids = new Set<string>();
  for (const value of values) {
    const template = record(value, 'basehalfCanvasTemplates[]');
    assertOnlyKeys(
      template,
      ['id', 'label', 'description', 'resource'],
      'basehalfCanvasTemplates[]',
    );
    const id = ownedContributionId(template.id, extensionId, ids, 'Canvas template');
    boundedText(template.label, `${id}.label`, 80);
    optionalBoundedText(template.description, `${id}.description`, 500);
    try {
      portableRelativePath(template.resource, `${id}.resource`, {
        maximumLength: 500,
        requireExtension: '.json',
        reserveBaseHalfState: true,
      });
    } catch {
      throw new Error(`Canvas template '${id}' resource must be a canonical relative JSON path.`);
    }
  }
}

function validateVideoModelCatalogs(
  extensionId: string,
  values: readonly unknown[],
): ReadonlySet<string> {
  if (values.length > 8) {
    throw new Error('basehalfVideoModelCatalogs cannot contain more than 8 catalogs.');
  }
  const ids = new Set<string>();
  for (const value of values) {
    const catalog = record(value, 'basehalfVideoModelCatalogs[]');
    assertOnlyKeys(catalog, ['id', 'resource'], 'basehalfVideoModelCatalogs[]');
    const id = ownedContributionId(catalog.id, extensionId, ids, 'Video model catalog');
    try {
      portableRelativePath(catalog.resource, `${id}.resource`, {
        maximumLength: 500,
        requireExtension: '.json',
        reserveBaseHalfState: true,
      });
    } catch {
      throw new Error(
        `Video model catalog '${id}' resource must be a canonical relative JSON path.`,
      );
    }
  }
  return ids;
}

function validateModelProviderCatalogs(extensionId: string, values: readonly unknown[]): void {
  if (values.length > 8) {
    throw new Error('basehalfModelProviderCatalogs cannot contain more than 8 catalogs.');
  }
  const ids = new Set<string>();
  for (const value of values) {
    const catalog = record(value, 'basehalfModelProviderCatalogs[]');
    assertOnlyKeys(catalog, ['id', 'resource'], 'basehalfModelProviderCatalogs[]');
    const id = ownedContributionId(catalog.id, extensionId, ids, 'Model provider catalog');
    try {
      portableRelativePath(catalog.resource, `${id}.resource`, {
        maximumLength: 500,
        requireExtension: '.json',
        reserveBaseHalfState: true,
      });
    } catch {
      throw new Error(
        `Model provider catalog '${id}' resource must be a canonical relative JSON path.`,
      );
    }
  }
}

function validateAgentCapabilities(
  extensionId: string,
  values: readonly unknown[],
  declaredCommands: ReadonlySet<string>,
): void {
  if (values.length > 32) {
    throw new Error('basehalfAgentCapabilities cannot contain more than 32 capabilities.');
  }
  const capabilityIds = new Set<string>();
  const operationIds = new Set<string>();
  for (const value of values) {
    const capability = record(value, 'basehalfAgentCapabilities[]');
    assertOnlyKeys(
      capability,
      ['id', 'label', 'description', 'documents', 'operations'],
      'basehalfAgentCapabilities[]',
    );
    let serialized: string;
    try {
      serialized = JSON.stringify(capability);
    } catch {
      throw new Error('BaseHalf Agent capability must be JSON-serializable.');
    }
    if (new TextEncoder().encode(serialized).byteLength > 64 * 1024) {
      throw new Error('BaseHalf Agent capability cannot exceed 65536 UTF-8 bytes.');
    }

    const id = ownedContributionId(capability.id, extensionId, capabilityIds, 'Agent capability');
    boundedText(capability.label, `${id}.label`, 80);
    optionalBoundedText(capability.description, `${id}.description`, 500);
    const documents = contributionArray(capability.documents, `${id}.documents`);
    const operations = contributionArray(capability.operations, `${id}.operations`);
    if (documents.length === 0 && operations.length === 0) {
      throw new Error(`Agent capability '${id}' must declare a document or operation.`);
    }
    validateAgentDocuments(extensionId, id, documents);
    validateAgentOperations(extensionId, id, operations, declaredCommands, operationIds);
  }
}

function validateAgentDocuments(
  extensionId: string,
  capabilityId: string,
  values: readonly unknown[],
): void {
  if (values.length > 16) {
    throw new Error(`Agent capability '${capabilityId}' has too many document formats.`);
  }
  const kinds = new Set<string>();
  for (const value of values) {
    const document = record(value, `${capabilityId}.documents[]`);
    assertOnlyKeys(
      document,
      ['kind', 'version', 'fileExtensions', 'schemaSummary'],
      `${capabilityId}.documents[]`,
    );
    const kind = ownedContributionId(document.kind, extensionId, kinds, 'Agent document kind');
    integer(document.version, `${kind}.version`, 1, 1_000_000);
    const extensions = contributionArray(document.fileExtensions, `${kind}.fileExtensions`, true);
    if (
      extensions.length > 16 ||
      new Set(extensions.map((extension) => String(extension).toLowerCase())).size !==
        extensions.length ||
      extensions.some(
        (extension) =>
          typeof extension !== 'string' || !/^\.[A-Za-z0-9][A-Za-z0-9.-]{0,15}$/.test(extension),
      )
    ) {
      throw new Error(`Agent document '${kind}' must declare valid file extensions.`);
    }
    boundedText(document.schemaSummary, `${kind}.schemaSummary`, 2_000);
  }
}

function validateAgentOperations(
  extensionId: string,
  capabilityId: string,
  values: readonly unknown[],
  declaredCommands: ReadonlySet<string>,
  operationIds: Set<string>,
): void {
  if (values.length > 64) {
    throw new Error(`Agent capability '${capabilityId}' has too many operations.`);
  }
  const publishedCommands = new Set<string>();
  for (const value of values) {
    const operation = record(value, `${capabilityId}.operations[]`);
    assertOnlyKeys(
      operation,
      ['id', 'command', 'description', 'deterministic', 'parameters', 'returns'],
      `${capabilityId}.operations[]`,
    );
    const id = ownedContributionId(operation.id, extensionId, operationIds, 'Agent operation');
    const command = boundedText(operation.command, `${id}.command`, 200);
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(command) ||
      !command.toLowerCase().startsWith(`${extensionId}.`) ||
      !declaredCommands.has(command)
    ) {
      throw new Error(
        `Agent operation '${id}' command '${command}' must be an owned declared command.`,
      );
    }
    if (publishedCommands.has(command)) {
      throw new Error(`Agent capability '${capabilityId}' publishes command '${command}' twice.`);
    }
    publishedCommands.add(command);
    if (operation.deterministic !== true) {
      throw new Error(`Agent operation '${id}' must be deterministic.`);
    }
    boundedText(operation.description, `${id}.description`, 500);
    validateAgentParameters(id, contributionArray(operation.parameters, `${id}.parameters`));
    const returns = record(operation.returns, `${id}.returns`);
    assertOnlyKeys(returns, ['type', 'description'], `${id}.returns`);
    if (
      !['object', 'array', 'string', 'number', 'boolean', 'void'].includes(String(returns.type))
    ) {
      throw new Error(`Agent operation '${id}' has an invalid return type.`);
    }
    boundedText(returns.description, `${id}.returns.description`, 500);
  }
}

function validateAgentParameters(operationId: string, values: readonly unknown[]): void {
  if (values.length > 32) {
    throw new Error(`Agent operation '${operationId}' has too many parameters.`);
  }
  const names = new Set<string>();
  for (const value of values) {
    const parameter = record(value, `${operationId}.parameters[]`);
    assertOnlyKeys(
      parameter,
      ['name', 'type', 'required', 'description', 'values'],
      `${operationId}.parameters[]`,
    );
    const name = boundedText(parameter.name, `${operationId}.parameters[].name`, 64);
    if (!/^[a-z][A-Za-z0-9]{0,63}$/.test(name) || names.has(name)) {
      throw new Error(
        `Agent operation '${operationId}' has invalid or duplicate parameter '${name}'.`,
      );
    }
    names.add(name);
    if (
      !['uri', 'string', 'integer', 'number', 'boolean', 'enum'].includes(String(parameter.type))
    ) {
      throw new Error(`Agent operation '${operationId}' parameter '${name}' has an invalid type.`);
    }
    if (typeof parameter.required !== 'boolean') {
      throw new Error(
        `Agent operation '${operationId}' parameter '${name}' must declare required.`,
      );
    }
    boundedText(parameter.description, `${operationId}.parameters.${name}.description`, 300);
    if (parameter.type === 'enum') {
      const choices = contributionArray(
        parameter.values,
        `${operationId}.parameters.${name}.values`,
        true,
      );
      if (
        choices.length > 32 ||
        new Set(choices).size !== choices.length ||
        choices.some(
          (choice) => typeof choice !== 'string' || !choice.trim() || choice.length > 100,
        )
      ) {
        throw new Error(`Agent operation '${operationId}' parameter '${name}' has invalid values.`);
      }
    } else if (parameter.values !== undefined) {
      throw new Error(
        `Agent operation '${operationId}' parameter '${name}' can only use values for enum.`,
      );
    }
  }
}

function requireHttpsRepository(value: unknown): string {
  const candidate =
    typeof value === 'string'
      ? value.trim()
      : isRecord(value) && 'url' in value
        ? String(value.url ?? '').trim()
        : '';
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || !url.hostname) throw new Error('not https');
    return url.href;
  } catch {
    throw new Error('Plugin manifest repository must be an absolute HTTPS URL.');
  }
}

function ownedContributionId(
  value: unknown,
  extensionId: string,
  seen: Set<string>,
  kind: string,
): string {
  const id = requiredText(value, `${kind} id`);
  if (
    id !== value ||
    id.length > 128 ||
    !/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2,}$/.test(id) ||
    !id.startsWith(`${extensionId}.`)
  ) {
    throw new Error(`${kind} '${id}' must start with '${extensionId}.'.`);
  }
  if (seen.has(id)) {
    throw new Error(`${kind} '${id}' is declared more than once.`);
  }
  seen.add(id);
  return id;
}

function localId(value: unknown, field: string, seen: Set<string>): string {
  const id = requiredText(value, field);
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) {
    throw new Error(`Canvas ${field} id '${id}' is invalid.`);
  }
  if (seen.has(id)) {
    throw new Error(`Canvas recipe has duplicate ${field} id '${id}'.`);
  }
  seen.add(id);
  return id;
}

function validateItemRange(minimumValue: unknown, maximumValue: unknown, field: string): void {
  const minimum = integer(minimumValue, `${field}.minItems`, 0, 64);
  const maximum = integer(maximumValue, `${field}.maxItems`, 1, 64);
  if (maximum < minimum) {
    throw new Error(`Canvas field '${field}' has an invalid item range.`);
  }
}

function contributionArray(
  value: unknown,
  field: string,
  requireItems = false,
): readonly unknown[] {
  if (value === undefined && !requireItems) return [];
  if (!Array.isArray(value) || (requireItems && value.length === 0)) {
    throw new Error(
      `Plugin contribution '${field}' must be ${requireItems ? 'a non-empty' : 'an'} array.`,
    );
  }
  return value;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) {
    throw new Error(`${field} contains unsupported fields: ${unknown.join(', ')}.`);
  }
}

function requiredText(value: unknown, field: string): string {
  return boundedText(value, field, Number.MAX_SAFE_INTEGER);
}

function boundedText(value: unknown, field: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== 'string') {
    throw new Error(`Plugin manifest is missing ${field}.`);
  }
  const result = allowEmpty ? value : value.trim();
  if ((!allowEmpty && !result) || result.length > maximum || result.includes('\u0000')) {
    throw new Error(
      `Plugin manifest field '${field}' must contain ${allowEmpty ? `at most ${maximum}` : `1-${maximum}`} characters.`,
    );
  }
  return result;
}

function optionalBoundedText(value: unknown, field: string, maximum: number): string | undefined {
  return value === undefined ? undefined : boundedText(value, field, maximum);
}

function optionalInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number | undefined {
  return value === undefined ? undefined : integer(value, field, minimum, maximum);
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(
      `Plugin manifest field '${field}' must be an integer from ${minimum} to ${maximum}.`,
    );
  }
  return value as number;
}

function optionalFiniteNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Plugin manifest field '${field}' must be a finite number.`);
  }
  return value;
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}
