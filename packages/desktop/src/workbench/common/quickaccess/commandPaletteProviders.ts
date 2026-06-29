import type {
  QuickAccessProviderDescriptor,
  QuickAccessProviderHelp,
} from '../../../platform/quickinput/common/quickAccess.js';
import type {
  CommandPaletteAction,
  CommandPaletteFileEntry,
  CommandPaletteSearchHit,
  CommandPaletteWorkspace,
  IMatch,
} from './commandPaletteModel.js';
import { filterCommandPaletteActions } from './commandPaletteModel.js';

export const DEFAULT_COMMAND_PALETTE_QUICK_ACCESS_ID = 'basehalf.quickAccess.anything';
export const COMMANDS_QUICK_ACCESS_ID = 'basehalf.quickAccess.commands';
export const COMMANDS_QUICK_ACCESS_PREFIX = '>';
export const WORKBENCH_QUICK_OPEN_COMMAND_ID = 'workbench.action.quickOpen';
export const WORKBENCH_SHOW_COMMANDS_COMMAND_ID = 'workbench.action.showCommands';
export const WORKBENCH_OPEN_FOLDER_COMMAND_ID = 'workbench.action.files.openFolder';

export type CommandPaletteProviderDescriptor = Pick<
  QuickAccessProviderDescriptor,
  'id' | 'prefix' | 'placeholder' | 'helpEntries'
>;

export interface CommandPaletteQuickAccessProvider {
  readonly descriptor: CommandPaletteProviderDescriptor;
  readonly includeAdditionalPicks: boolean;
  readonly dataRequirements: CommandPaletteQuickAccessDataRequirements;
  readonly buildActions: (args: BuildCommandPaletteActionsBaseArgs) => CommandPaletteAction[];
  readonly buildRows: (args: BuildCommandPaletteRowsArgs) => CommandPaletteRowsBuildResult;
}

export interface CommandPaletteQuickAccessContribution {
  readonly id: string;
  readonly buildActions: () => readonly CommandPaletteAction[];
  readonly buildAdditionalActions?: (
    args: CommandPaletteQuickAccessAdditionalActionsArgs,
  ) => readonly CommandPaletteAction[];
}

export interface CommandPaletteQuickAccessAdditionalActionsArgs {
  readonly query: string;
  readonly filtered: readonly CommandPaletteAction[];
}

export interface BuildCommandPaletteActionsBaseArgs {
  readonly workspaces: readonly CommandPaletteWorkspace[];
  readonly current: string | null;
  readonly files: readonly CommandPaletteFileEntry[];
  readonly filesWorkspace: string | null;
  readonly recentFiles?: readonly string[];
  readonly modifierLabel: string;
  readonly tildifyPath: (path: string) => string;
  readonly useWorkspace: (name: string) => void;
  readonly openFile: (
    file: string,
    opts?: { readonly pinned?: boolean; readonly matchQuery?: string },
  ) => void;
  readonly pickAndAdd: () => void;
  readonly createDemo: () => void;
  readonly newNote: () => void;
  readonly promptForNewNote: () => void;
  readonly openSettings: () => void;
  readonly quickAccessContributions?: readonly CommandPaletteQuickAccessContribution[];
}

export interface BuildCommandPaletteActionsArgs extends BuildCommandPaletteActionsBaseArgs {
  readonly providerId?: string;
}

export interface BuildCommandPaletteRowsArgs extends BuildCommandPaletteActionsArgs {
  readonly query: string;
  readonly contentHits: readonly CommandPaletteSearchHit[];
  readonly hitsQuery: string;
  readonly hitsWorkspace: string | null;
}

export interface CommandPaletteRowsBuildResult {
  readonly rows: readonly CommandPaletteAction[];
  readonly matchMap: Map<string, IMatch[]>;
}

export interface CommandPaletteQuickAccessDataRequirements {
  readonly files: boolean;
  readonly contentSearch: boolean;
  readonly gitState: boolean;
}

export interface CommandPaletteQuickAccessProviderState {
  readonly providerId?: string;
  readonly value?: string;
}

const commandPaletteQuickAccessHelpEntries: readonly QuickAccessProviderHelp[] = [
  {
    description: 'Switch workspace, open a file, or run an action',
    commandId: WORKBENCH_QUICK_OPEN_COMMAND_ID,
  },
];

const commandsQuickAccessHelpEntries: readonly QuickAccessProviderHelp[] = [
  {
    prefix: COMMANDS_QUICK_ACCESS_PREFIX,
    description: 'Show and run commands',
    commandId: WORKBENCH_SHOW_COMMANDS_COMMAND_ID,
  },
];

const defaultCommandPaletteQuickAccessProvider: CommandPaletteQuickAccessProvider = {
  descriptor: {
    id: DEFAULT_COMMAND_PALETTE_QUICK_ACCESS_ID,
    prefix: '',
    placeholder: 'Switch workspace, open a file, run an action...',
    helpEntries: commandPaletteQuickAccessHelpEntries,
  },
  includeAdditionalPicks: true,
  dataRequirements: {
    files: true,
    contentSearch: true,
    gitState: true,
  },
  buildActions: (args) => [
    ...workspacePicks(args),
    ...filePicks(args),
    ...chromeActionPicks(args),
    ...contributionPicks(args),
  ],
  buildRows: (args) => buildDefaultCommandPaletteRows(args),
};

const commandsQuickAccessProvider: CommandPaletteQuickAccessProvider = {
  descriptor: {
    id: COMMANDS_QUICK_ACCESS_ID,
    prefix: COMMANDS_QUICK_ACCESS_PREFIX,
    placeholder: 'Type the name of a command to run',
    helpEntries: commandsQuickAccessHelpEntries,
  },
  includeAdditionalPicks: false,
  dataRequirements: {
    files: false,
    contentSearch: false,
    gitState: true,
  },
  buildActions: (args) => [...chromeActionPicks(args), ...contributionPicks(args)],
  buildRows: (args) => buildCommandsQuickAccessRows(args),
};

export const COMMAND_PALETTE_QUICK_ACCESS_PROVIDERS: readonly CommandPaletteQuickAccessProvider[] =
  [defaultCommandPaletteQuickAccessProvider, commandsQuickAccessProvider];

export function commandPaletteQuickAccessProviderForId(
  providerId: string | undefined,
): CommandPaletteQuickAccessProvider {
  return (
    COMMAND_PALETTE_QUICK_ACCESS_PROVIDERS.find(
      (provider) => provider.descriptor.id === providerId,
    ) ?? defaultCommandPaletteQuickAccessProvider
  );
}

export function commandPaletteQuickAccessProviderForValue(
  value: string | undefined,
): CommandPaletteQuickAccessProvider {
  if (value !== undefined && value.length > 0) {
    const explicit = [...COMMAND_PALETTE_QUICK_ACCESS_PROVIDERS]
      .filter((provider) => provider.descriptor.prefix.length > 0)
      .sort((a, b) => b.descriptor.prefix.length - a.descriptor.prefix.length)
      .find((provider) => value.startsWith(provider.descriptor.prefix));
    if (explicit !== undefined) return explicit;
  }
  return defaultCommandPaletteQuickAccessProvider;
}

export function commandPaletteQuickAccessProviderForState(
  state: CommandPaletteQuickAccessProviderState,
): CommandPaletteQuickAccessProvider {
  const idMatch =
    state.providerId === undefined
      ? undefined
      : COMMAND_PALETTE_QUICK_ACCESS_PROVIDERS.find(
          (provider) => provider.descriptor.id === state.providerId,
        );
  return idMatch ?? commandPaletteQuickAccessProviderForValue(state.value);
}

export function commandPaletteProviderIncludesAdditionalPicks(
  providerId: string | undefined,
): boolean {
  return commandPaletteQuickAccessProviderForId(providerId).includeAdditionalPicks;
}

export function buildCommandPaletteActions(
  args: BuildCommandPaletteActionsArgs,
): CommandPaletteAction[] {
  return commandPaletteQuickAccessProviderForId(args.providerId).buildActions(args);
}

export function buildCommandPaletteRows(
  args: BuildCommandPaletteRowsArgs,
): CommandPaletteRowsBuildResult {
  return commandPaletteQuickAccessProviderForState({
    ...(args.providerId !== undefined && { providerId: args.providerId }),
  }).buildRows(args);
}

function workspacePicks(args: BuildCommandPaletteActionsBaseArgs): CommandPaletteAction[] {
  return args.workspaces
    .filter((workspace) => workspace.name !== args.current)
    .map((workspace) => ({
      id: `ws:${workspace.name}`,
      label: workspace.name,
      hint: args.tildifyPath(workspace.path),
      category: 'Workspace' as const,
      run: () => args.useWorkspace(workspace.name),
    }));
}

function filePicks(args: BuildCommandPaletteActionsBaseArgs): CommandPaletteAction[] {
  if (args.filesWorkspace !== args.current || args.current === null) return [];
  const recentRank = new Map<string, number>();
  args.recentFiles?.forEach((path, idx) => recentRank.set(path, idx));
  return [...args.files]
    .sort((a, b) => {
      const ra = recentRank.get(a.file);
      const rb = recentRank.get(b.file);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      return a.file.localeCompare(b.file);
    })
    .map((file) => {
      const basename = file.file.includes('/')
        ? (file.file.split('/').pop() ?? file.file)
        : file.file;
      return {
        id: `file:${file.file}`,
        label: basename,
        category: 'File' as const,
        ...(file.file.includes('/') && { hint: file.file }),
        ...(file.prompt !== undefined && file.prompt.length > 0 && { searchAlso: file.prompt }),
        run: () => args.openFile(file.file, { pinned: true }),
      };
    });
}

function chromeActionPicks(args: BuildCommandPaletteActionsBaseArgs): CommandPaletteAction[] {
  const out: CommandPaletteAction[] = [
    {
      id: WORKBENCH_OPEN_FOLDER_COMMAND_ID,
      label: 'Add folder…',
      category: 'Action',
      run: args.pickAndAdd,
    },
  ];
  if (args.current === null) {
    out.push({
      id: 'action:try-demo',
      label: 'Try a demo workspace…',
      hint: '~/BaseHalf-Demo',
      category: 'Action',
      run: args.createDemo,
    });
  }
  if (args.current !== null) {
    out.push(
      {
        id: 'action:new-note',
        label: 'New note',
        category: 'Action',
        shortcut: `${args.modifierLabel}N`,
        run: args.newNote,
      },
      {
        id: 'action:new-note-at-path',
        label: 'New note at path…',
        category: 'Action',
        run: args.promptForNewNote,
      },
    );
  }
  out.push({
    id: 'action:settings',
    label: 'Settings…',
    category: 'Action',
    shortcut: `${args.modifierLabel},`,
    run: args.openSettings,
  });
  return out;
}

function contributionPicks(args: BuildCommandPaletteActionsBaseArgs): CommandPaletteAction[] {
  return (
    args.quickAccessContributions?.flatMap((contribution) => contribution.buildActions()) ?? []
  );
}

export function buildContentSearchActions(args: {
  readonly contentHits: readonly CommandPaletteSearchHit[];
  readonly hitsQuery: string;
  readonly hitsWorkspace: string | null;
  readonly current: string | null;
  readonly query: string;
  readonly filtered: readonly CommandPaletteAction[];
  readonly openFile: (
    file: string,
    opts?: { readonly pinned?: boolean; readonly matchQuery?: string },
  ) => void;
}): CommandPaletteAction[] {
  const q = args.query.trim();
  if (q.length < 3 || args.hitsQuery !== q || args.hitsWorkspace !== args.current) return [];
  const shownFiles = new Set(
    args.filtered
      .filter((action) => action.category === 'File')
      .map((action) => action.id.slice('file:'.length)),
  );
  const out: CommandPaletteAction[] = [];
  for (const hit of args.contentHits) {
    if (shownFiles.has(hit.file)) continue;
    const basename = hit.file.includes('/') ? (hit.file.split('/').pop() ?? hit.file) : hit.file;
    const snippet = hit.matches[0]?.text;
    out.push({
      id: `search:${hit.file}`,
      label: basename,
      category: 'Search',
      ...(hit.file.includes('/') && { hint: hit.file }),
      ...(snippet !== undefined && snippet.length > 0 && { sub: snippet }),
      run: () => args.openFile(hit.file, { pinned: true, matchQuery: q }),
    });
  }
  return out;
}

export function buildCommandPaletteAdditionalActions(args: {
  readonly query: string;
  readonly filtered: readonly CommandPaletteAction[];
  readonly quickAccessContributions?: readonly CommandPaletteQuickAccessContribution[];
}): CommandPaletteAction[] {
  return (
    args.quickAccessContributions?.flatMap(
      (contribution) =>
        contribution.buildAdditionalActions?.({
          query: args.query,
          filtered: args.filtered,
        }) ?? [],
    ) ?? []
  );
}

export function combineCommandPaletteRows(
  filtered: readonly CommandPaletteAction[],
  contentActions: readonly CommandPaletteAction[],
  gitMatches: readonly CommandPaletteAction[],
): CommandPaletteAction[] {
  return [...filtered, ...contentActions, ...gitMatches];
}

function buildDefaultCommandPaletteRows(
  args: BuildCommandPaletteRowsArgs,
): CommandPaletteRowsBuildResult {
  const actions = defaultCommandPaletteQuickAccessProvider.buildActions(args);
  const { filtered, matchMap } = filterCommandPaletteActions({
    actions,
    query: args.query,
    current: args.current,
    ...(args.recentFiles !== undefined && { recentFiles: args.recentFiles }),
  });
  const contentActions = buildContentSearchActions({
    contentHits: args.contentHits,
    hitsQuery: args.hitsQuery,
    hitsWorkspace: args.hitsWorkspace,
    current: args.current,
    query: args.query,
    filtered,
    openFile: args.openFile,
  });
  const contributedAdditionalActions = buildCommandPaletteAdditionalActions({
    query: args.query,
    filtered,
    ...(args.quickAccessContributions !== undefined && {
      quickAccessContributions: args.quickAccessContributions,
    }),
  });
  return {
    rows: combineCommandPaletteRows(filtered, contentActions, contributedAdditionalActions),
    matchMap,
  };
}

function buildCommandsQuickAccessRows(
  args: BuildCommandPaletteRowsArgs,
): CommandPaletteRowsBuildResult {
  const actions = commandsQuickAccessProvider.buildActions(args);
  const { filtered, matchMap } = filterCommandPaletteActions({
    actions,
    query: args.query,
    current: args.current,
    ...(args.recentFiles !== undefined && { recentFiles: args.recentFiles }),
  });
  return { rows: filtered, matchMap };
}
