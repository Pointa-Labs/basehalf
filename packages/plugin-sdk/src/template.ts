import { portablePathKey, portableRelativePath } from './portablePath.js';

export const BASEHALF_CANVAS_TEMPLATE_VERSION = 1 as const;
export const BASEHALF_CANVAS_TEMPLATE_MAX_BYTES = 512 * 1024;

const MAX_ENTRIES = 100;
const MAX_TEXT_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_PARAMETERS = 128;
const MAX_PARAMETER_DEPTH = 12;
const MAX_CONTRIBUTION_ID_LENGTH = 128;
const ANCHORS = new Set<BaseHalfCanvasTemplateAnchor>(['north', 'east', 'south', 'west']);
const NODE_KINDS = new Set<BaseHalfCanvasTemplateNodeKind>([
  'file',
  'image',
  'video',
  'audio',
  'pdf',
  'presentation',
]);

export type BaseHalfCanvasTemplateAnchor = 'north' | 'east' | 'south' | 'west';
export type BaseHalfCanvasTemplateNodeKind =
  | 'file'
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'presentation';
export type BaseHalfCanvasTemplateJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly BaseHalfCanvasTemplateJsonValue[]
  | { readonly [key: string]: BaseHalfCanvasTemplateJsonValue };

export interface BaseHalfCanvasTemplateTextFile {
  readonly path: string;
  readonly contents: string;
}

export interface BaseHalfCanvasTemplateInputBinding {
  readonly sourcePath: string;
  readonly slot: string;
  readonly order: number;
}

export interface BaseHalfCanvasTemplateRecipe {
  readonly recipeId: string;
  readonly parameters: Readonly<Record<string, BaseHalfCanvasTemplateJsonValue>>;
  readonly inputBindings: readonly BaseHalfCanvasTemplateInputBinding[];
}

export interface BaseHalfCanvasTemplateNode {
  readonly path: string;
  readonly kind: BaseHalfCanvasTemplateNodeKind;
  readonly title: string;
  readonly role: string;
  readonly recipe?: BaseHalfCanvasTemplateRecipe;
}

export interface BaseHalfCanvasTemplateCard {
  readonly path: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface BaseHalfCanvasTemplateReference {
  readonly from: string;
  readonly to: string;
  readonly fromAnchor: BaseHalfCanvasTemplateAnchor;
  readonly toAnchor: BaseHalfCanvasTemplateAnchor;
}

export interface BaseHalfCanvasTemplate {
  readonly version: typeof BASEHALF_CANVAS_TEMPLATE_VERSION;
  readonly files: readonly BaseHalfCanvasTemplateTextFile[];
  readonly nodes: readonly BaseHalfCanvasTemplateNode[];
  readonly cards: readonly BaseHalfCanvasTemplateCard[];
  readonly references: readonly BaseHalfCanvasTemplateReference[];
}

export class BaseHalfCanvasTemplateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BaseHalfCanvasTemplateValidationError';
  }
}

/** Preserves literal template types while enforcing the public template v1 contract. */
export function defineBaseHalfCanvasTemplate<const T extends BaseHalfCanvasTemplate>(
  template: T,
): T {
  validateBaseHalfCanvasTemplate(template);
  return template;
}

/** Validates a parsed value against the public template v1 contract. */
export function validateBaseHalfCanvasTemplate(
  value: unknown,
): asserts value is BaseHalfCanvasTemplate {
  normalizeBaseHalfCanvasTemplate(value);
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw invalid('The canvas template must be serializable JSON.');
  }
  if (utf8Bytes(serialized) > BASEHALF_CANVAS_TEMPLATE_MAX_BYTES) {
    throw invalid(
      `The canvas template must be UTF-8 JSON no larger than ${BASEHALF_CANVAS_TEMPLATE_MAX_BYTES} bytes.`,
    );
  }
}

/** Parses and normalizes the exact static template format accepted by BaseHalf. */
export function parseBaseHalfCanvasTemplate(source: string): BaseHalfCanvasTemplate {
  if (typeof source !== 'string' || utf8Bytes(source) > BASEHALF_CANVAS_TEMPLATE_MAX_BYTES) {
    throw invalid(
      `The canvas template must be UTF-8 JSON no larger than ${BASEHALF_CANVAS_TEMPLATE_MAX_BYTES} bytes.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source.charCodeAt(0) === 0xfeff ? source.slice(1) : source);
  } catch {
    throw invalid('The canvas template is not valid JSON.');
  }
  return normalizeBaseHalfCanvasTemplate(parsed);
}

function normalizeBaseHalfCanvasTemplate(value: unknown): BaseHalfCanvasTemplate {
  const root = record(value, 'template');
  assertOnlyKeys(root, ['version', 'files', 'nodes', 'cards', 'references'], 'template');
  if (root.version !== BASEHALF_CANVAS_TEMPLATE_VERSION) {
    throw invalid(`Unsupported canvas template version '${String(root.version)}'.`);
  }

  const files = array(root.files, 'template.files').map((entry, index) =>
    parseTextFile(entry, `template.files[${index}]`),
  );
  const nodes = array(root.nodes, 'template.nodes').map((entry, index) =>
    parseNode(entry, `template.nodes[${index}]`),
  );
  const cards = array(root.cards, 'template.cards').map((entry, index) =>
    parseCard(entry, `template.cards[${index}]`),
  );
  const references = array(root.references, 'template.references').map((entry, index) =>
    parseReference(entry, `template.references[${index}]`),
  );
  const paths = [...files.map((file) => file.path), ...nodes.map((node) => node.path)];
  if (files.some((file) => file.path.toLowerCase().endsWith('.bhnode'))) {
    throw invalid('Template text files cannot use the reserved .bhnode extension.');
  }
  assertUniquePaths(paths, 'template file and node paths');
  assertNoPathPrefixConflicts(paths, 'template file and node paths');
  if (paths.length === 0) {
    throw invalid('The canvas template must create at least one file or node.');
  }
  const pathSet = new Set(paths);
  for (const node of nodes) {
    if (!node.path.toLowerCase().endsWith('.bhnode')) {
      throw invalid(`Template node '${node.path}' must use the .bhnode extension.`);
    }
    for (const binding of node.recipe?.inputBindings ?? []) {
      if (!pathSet.has(binding.sourcePath)) {
        throw invalid(`Template node '${node.path}' binds missing source '${binding.sourcePath}'.`);
      }
    }
  }

  assertUniquePaths(
    cards.map((card) => card.path),
    'template card paths',
  );
  for (const card of cards) {
    if (!pathSet.has(card.path)) {
      throw invalid(`Template card '${card.path}' does not have a matching file or node.`);
    }
  }

  assertUnique(
    references.map((reference) => `${reference.from}\u0000${reference.to}`),
    'template references',
  );
  const referenceSet = new Set(
    references.map((reference) => `${reference.from}\u0000${reference.to}`),
  );
  for (const reference of references) {
    if (!pathSet.has(reference.from) || !pathSet.has(reference.to)) {
      throw invalid(
        `Template reference '${reference.from}' to '${reference.to}' must connect created resources.`,
      );
    }
    if (reference.from === reference.to) {
      throw invalid(`Template reference '${reference.from}' cannot connect a resource to itself.`);
    }
  }
  for (const node of nodes) {
    for (const binding of node.recipe?.inputBindings ?? []) {
      if (!referenceSet.has(`${binding.sourcePath}\u0000${node.path}`)) {
        throw invalid(
          `Template node '${node.path}' binds '${binding.sourcePath}' without a matching direct reference.`,
        );
      }
    }
  }

  const totalTextBytes = files.reduce((total, file) => total + utf8Bytes(file.contents), 0);
  if (totalTextBytes > MAX_TOTAL_TEXT_BYTES) {
    throw invalid(`Template text files exceed ${MAX_TOTAL_TEXT_BYTES} bytes in total.`);
  }
  return Object.freeze({
    version: BASEHALF_CANVAS_TEMPLATE_VERSION,
    files: Object.freeze(files),
    nodes: Object.freeze(nodes),
    cards: Object.freeze(cards),
    references: Object.freeze(references),
  });
}

function parseTextFile(value: unknown, path: string): BaseHalfCanvasTemplateTextFile {
  const candidate = record(value, path);
  assertOnlyKeys(candidate, ['path', 'contents'], path);
  const contents = text(candidate.contents, `${path}.contents`, MAX_TEXT_FILE_BYTES, true);
  if (utf8Bytes(contents) > MAX_TEXT_FILE_BYTES) {
    throw invalid(`${path}.contents exceeds ${MAX_TEXT_FILE_BYTES} bytes.`);
  }
  return Object.freeze({ path: projectPath(candidate.path, `${path}.path`), contents });
}

function parseNode(value: unknown, path: string): BaseHalfCanvasTemplateNode {
  const candidate = record(value, path);
  assertOnlyKeys(candidate, ['path', 'kind', 'title', 'role', 'recipe'], path);
  const kind = text(candidate.kind, `${path}.kind`, 16) as BaseHalfCanvasTemplateNodeKind;
  if (!NODE_KINDS.has(kind)) {
    throw invalid(`${path}.kind must be a supported executable result kind.`);
  }
  const recipe =
    candidate.recipe === undefined ? undefined : parseRecipe(candidate.recipe, `${path}.recipe`);
  return Object.freeze({
    path: projectPath(candidate.path, `${path}.path`),
    kind,
    title: text(candidate.title, `${path}.title`, 240),
    role: text(candidate.role, `${path}.role`, 120),
    ...(recipe ? { recipe } : {}),
  });
}

function parseRecipe(value: unknown, path: string): BaseHalfCanvasTemplateRecipe {
  const candidate = record(value, path);
  assertOnlyKeys(candidate, ['recipeId', 'parameters', 'inputBindings'], path);
  const parameters = jsonObject(candidate.parameters, `${path}.parameters`, 0, {
    remaining: MAX_PARAMETERS,
  });
  const inputBindings = array(candidate.inputBindings, `${path}.inputBindings`).map(
    (entry, index) => {
      const bindingPath = `${path}.inputBindings[${index}]`;
      const binding = record(entry, bindingPath);
      assertOnlyKeys(binding, ['sourcePath', 'slot', 'order'], bindingPath);
      return Object.freeze({
        sourcePath: projectPath(binding.sourcePath, `${bindingPath}.sourcePath`),
        slot: text(binding.slot, `${bindingPath}.slot`, 120),
        order: integer(binding.order, `${bindingPath}.order`, 0, 63),
      });
    },
  );
  assertUnique(
    inputBindings.map((binding) => String(binding.order)),
    `${path} binding order`,
  );
  assertUnique(
    inputBindings.map((binding) => `${binding.sourcePath}\u0000${binding.slot}`),
    `${path} binding source and slot`,
  );
  assertUniquePaths(
    inputBindings.map((binding) => binding.sourcePath),
    `${path} binding source`,
  );
  inputBindings.sort((left, right) => left.order - right.order);
  for (let index = 0; index < inputBindings.length; index += 1) {
    if (inputBindings[index]?.order !== index) {
      throw invalid(`${path} binding order must be contiguous from zero.`);
    }
  }
  return Object.freeze({
    recipeId: identifier(candidate.recipeId, `${path}.recipeId`),
    parameters: Object.freeze(parameters),
    inputBindings: Object.freeze(inputBindings),
  });
}

function parseCard(value: unknown, path: string): BaseHalfCanvasTemplateCard {
  const candidate = record(value, path);
  assertOnlyKeys(candidate, ['path', 'x', 'y', 'width', 'height'], path);
  return Object.freeze({
    path: projectPath(candidate.path, `${path}.path`),
    x: finite(candidate.x, `${path}.x`, -1_000_000, 1_000_000),
    y: finite(candidate.y, `${path}.y`, -1_000_000, 1_000_000),
    width: finite(candidate.width, `${path}.width`, 140, 2400),
    height: finite(candidate.height, `${path}.height`, 48, 1800),
  });
}

function parseReference(value: unknown, path: string): BaseHalfCanvasTemplateReference {
  const candidate = record(value, path);
  assertOnlyKeys(candidate, ['from', 'to', 'fromAnchor', 'toAnchor'], path);
  return Object.freeze({
    from: projectPath(candidate.from, `${path}.from`),
    to: projectPath(candidate.to, `${path}.to`),
    fromAnchor: anchor(candidate.fromAnchor, `${path}.fromAnchor`),
    toAnchor: anchor(candidate.toAnchor, `${path}.toAnchor`),
  });
}

function jsonObject(
  value: unknown,
  path: string,
  depth: number,
  budget: { remaining: number },
): Record<string, BaseHalfCanvasTemplateJsonValue> {
  if (depth > MAX_PARAMETER_DEPTH) {
    throw invalid(`${path} exceeds the maximum nesting depth.`);
  }
  const candidate = record(value, path);
  const result: Record<string, BaseHalfCanvasTemplateJsonValue> = {};
  for (const [key, entry] of Object.entries(candidate)) {
    consume(budget, path);
    if (
      !key ||
      key.length > 128 ||
      key === '__proto__' ||
      key === 'constructor' ||
      key === 'prototype'
    ) {
      throw invalid(`${path} contains an invalid parameter name.`);
    }
    result[key] = jsonValue(entry, `${path}.${key}`, depth + 1, budget);
  }
  return result;
}

function jsonValue(
  value: unknown,
  path: string,
  depth: number,
  budget: { remaining: number },
): BaseHalfCanvasTemplateJsonValue {
  consume(budget, path);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalid(`${path} must be finite.`);
    return value;
  }
  if (typeof value === 'string') return text(value, path, 16 * 1024, true);
  if (Array.isArray(value)) {
    if (depth > MAX_PARAMETER_DEPTH || value.length > MAX_PARAMETERS) {
      throw invalid(`${path} is too complex.`);
    }
    return Object.freeze(
      value.map((entry, index) => jsonValue(entry, `${path}[${index}]`, depth + 1, budget)),
    );
  }
  return Object.freeze(jsonObject(value, path, depth, budget));
}

function projectPath(value: unknown, path: string): string {
  try {
    return portableRelativePath(value, path, { maximumLength: 1024 });
  } catch (error) {
    throw invalid((error as Error).message);
  }
}

function identifier(value: unknown, path: string): string {
  if (
    typeof value !== 'string' ||
    value.length > MAX_CONTRIBUTION_ID_LENGTH ||
    value.includes('\u0000')
  ) {
    throw invalid(`${path} is not a valid contribution identifier.`);
  }
  const result = value.trim();
  if (
    result !== value ||
    result !== result.toLowerCase() ||
    !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){2,}$/.test(result)
  ) {
    throw invalid(`${path} is not a valid contribution identifier.`);
  }
  return result;
}

function anchor(value: unknown, path: string): BaseHalfCanvasTemplateAnchor {
  if (typeof value !== 'string' || !ANCHORS.has(value as BaseHalfCanvasTemplateAnchor)) {
    throw invalid(`${path} must be north, east, south, or west.`);
  }
  return value as BaseHalfCanvasTemplateAnchor;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_ENTRIES) {
    throw invalid(`${path} must be an array of no more than ${MAX_ENTRIES} entries.`);
  }
  return [...value];
}

function text(value: unknown, path: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maximum || value.includes('\u0000')) {
    throw invalid(`${path} must be text no longer than ${maximum} characters.`);
  }
  const result = allowEmpty ? value : value.trim();
  if (!allowEmpty && !result) throw invalid(`${path} cannot be empty.`);
  return result;
}

function integer(value: unknown, path: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw invalid(`${path} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value as number;
}

function finite(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw invalid(`${path} must be a finite number from ${minimum} to ${maximum}.`);
  }
  return value;
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const accepted = new Set(allowed);
  const unexpected = Object.keys(value).find((key) => !accepted.has(key));
  if (unexpected) throw invalid(`${path} contains unsupported property '${unexpected}'.`);
}

function assertUnique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) {
    throw invalid(`${path} must not contain duplicates.`);
  }
}

function assertUniquePaths(values: readonly string[], path: string): void {
  assertUnique(values.map(portablePathKey), path);
}

function assertNoPathPrefixConflicts(values: readonly string[], path: string): void {
  const canonical = values.map(portablePathKey).sort();
  for (let index = 1; index < canonical.length; index += 1) {
    const previous = canonical[index - 1];
    const current = canonical[index];
    if (previous !== undefined && current?.startsWith(`${previous}/`)) {
      throw invalid(`${path} must not contain a resource and one of its descendants.`);
    }
  }
}

function consume(budget: { remaining: number }, path: string): void {
  budget.remaining -= 1;
  if (budget.remaining < 0) throw invalid(`${path} exceeds the parameter complexity limit.`);
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function invalid(message: string): BaseHalfCanvasTemplateValidationError {
  return new BaseHalfCanvasTemplateValidationError(message);
}
