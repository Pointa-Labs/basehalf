import {
  type PickerQuickAccessDisposableStore,
  type PickerQuickAccessItem,
  type PickerQuickAccessPicks,
  PickerQuickAccessProvider,
} from '../../../platform/quickinput/browser/pickerQuickAccess.js';
import type {
  CancellationToken,
  QuickAccessProviderRunOptions,
} from '../../../platform/quickinput/common/quickAccess.js';
import type {
  IKeyMods,
  IQuickPickDidAcceptEvent,
} from '../../../platform/quickinput/common/quickInput.js';
import {
  type CommandPaletteAction,
  type IMatch,
  filterCommandPaletteActions,
} from '../../common/quickaccess/commandPaletteModel.js';
import {
  type BuildCommandPaletteActionsBaseArgs,
  COMMANDS_QUICK_ACCESS_ID,
  COMMANDS_QUICK_ACCESS_PREFIX,
  buildCommandPaletteActions,
} from '../../common/quickaccess/commandPaletteProviders.js';

export interface CommandsQuickAccessPick extends PickerQuickAccessItem {
  readonly commandId: string;
  readonly action: CommandPaletteAction;
}

export type CommandsQuickAccessContextProvider = () => BuildCommandPaletteActionsBaseArgs;

/**
 * Provider-owned path for the `>` commands quick access prefix.
 *
 * This mirrors VS Code's commands quick access boundary: the provider owns
 * command pick creation, filtering, and accept execution while the current React
 * command palette can continue rendering the same command model during the
 * transition.
 */
export class CommandsQuickAccessProvider extends PickerQuickAccessProvider<CommandsQuickAccessPick> {
  constructor(private readonly getContext: CommandsQuickAccessContextProvider) {
    super(COMMANDS_QUICK_ACCESS_PREFIX);
  }

  protected getPicks(
    filter: string,
    _disposables: PickerQuickAccessDisposableStore,
    token: CancellationToken,
    _runOptions?: QuickAccessProviderRunOptions,
  ): PickerQuickAccessPicks<CommandsQuickAccessPick> {
    if (token.isCancellationRequested) return [];

    const context = this.getContext();
    const actions = buildCommandPaletteActions({
      ...context,
      providerId: COMMANDS_QUICK_ACCESS_ID,
    });
    const { filtered, matchMap } = filterCommandPaletteActions({
      actions,
      query: filter,
      current: context.current,
      recentFiles: context.recentFiles,
    });
    const items = filtered.map((action) => commandActionToPick(action, matchMap.get(action.id)));
    return {
      items,
      active: items[0],
    };
  }
}

function commandActionToPick(
  action: CommandPaletteAction,
  matches: readonly IMatch[] | undefined,
): CommandsQuickAccessPick {
  const detail = detailForAction(action);
  return {
    id: action.id,
    commandId: action.id,
    action,
    label: action.label,
    description: action.category,
    ...(detail !== undefined && { detail }),
    ...(matches !== undefined && { highlights: matches.map(matchToHighlight) }),
    accept: (_keyMods: IKeyMods, _event: IQuickPickDidAcceptEvent) => {
      action.run();
    },
  };
}

function detailForAction(action: CommandPaletteAction): string | undefined {
  const parts = [action.sub, action.hint, action.shortcut].filter(
    (part): part is string => part !== undefined && part.length > 0,
  );
  return parts.length > 0 ? parts.join(' - ') : undefined;
}

function matchToHighlight(match: IMatch): [number, number] {
  return [match.start, match.end];
}
