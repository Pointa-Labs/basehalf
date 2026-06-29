import {
  pick as pickDialog,
  pickWithInputValue as pickWithInputValueDialog,
} from '../../dialogs/browser/dialogService.js';
import type {
  CreateQuickPickOptions,
  IQuickInputService,
  IQuickPick,
  IQuickPickItem,
  QuickPickManyOptions,
  QuickPickSingleOptions,
  QuickPickValueResult,
} from '../common/quickInput.js';
import { QuickAccessController } from './quickAccessController.js';
import { QuickInputController } from './quickInputController.js';

export type {
  CreateQuickPickOptions,
  IKeyMods,
  IQuickInputButton,
  IQuickInputService,
  IQuickNavigateConfiguration,
  IQuickPick,
  IQuickPickDidAcceptEvent,
  IQuickPickItem,
  IQuickPickItemButtonEvent,
  IQuickPickSeparator,
  IQuickPickSeparatorButtonEvent,
  IQuickPickWillAcceptEvent,
  QuickInputValidationSeverity,
  QuickPickBaseOptions,
  QuickPickItemOrSeparator,
  QuickPickManyOptions,
  QuickPickOption,
  QuickPickOptions,
  QuickPickSelectionChange,
  QuickPickSelectionNormalizer,
  QuickPickSingleOptions,
  QuickPickSortOptions,
  QuickPickValueResult,
} from '../common/quickInput.js';
export {
  ItemActivation,
  NO_KEY_MODS,
  QuickPickFocus,
  isKeyModified,
  isQuickPickItem,
  isQuickPickSeparator,
} from '../common/quickInput.js';

class DialogBackedQuickInputService implements IQuickInputService {
  readonly quickAccess = new QuickAccessController(undefined, this);
  private readonly controller = new QuickInputController();

  createQuickPick<T extends IQuickPickItem>(_options: CreateQuickPickOptions = {}): IQuickPick<T> {
    return this.controller.createQuickPick<T>(_options);
  }

  focus(): void {
    this.controller.focus();
  }

  navigate(next: boolean): void {
    this.controller.navigate(next);
  }

  accept(): void {
    this.controller.accept();
  }

  cancel(): void {
    this.controller.cancel();
  }

  pick(opts: QuickPickSingleOptions): Promise<string | null>;
  pick(opts: QuickPickManyOptions): Promise<readonly string[] | null>;
  pick(
    opts: QuickPickSingleOptions | QuickPickManyOptions,
  ): Promise<string | readonly string[] | null> {
    return opts.canSelectMany === true ? pickDialog(opts) : pickDialog(opts);
  }

  pickWithInputValue(opts: QuickPickSingleOptions): Promise<QuickPickValueResult | null> {
    return pickWithInputValueDialog(opts);
  }
}

/**
 * Browser quick input service boundary.
 *
 * The current implementation still renders through DialogHost, but callers now
 * depend on the quickinput platform service instead of dialog primitives. That
 * mirrors VS Code's `IQuickInputService` boundary and lets SCM/quick access move
 * toward raw quick pick lifecycles without touching each caller again.
 */
export const quickInputService: IQuickInputService = new DialogBackedQuickInputService();

export function pick(opts: QuickPickSingleOptions): Promise<string | null>;
export function pick(opts: QuickPickManyOptions): Promise<readonly string[] | null>;
export function pick(
  opts: QuickPickSingleOptions | QuickPickManyOptions,
): Promise<string | readonly string[] | null> {
  return opts.canSelectMany === true ? quickInputService.pick(opts) : quickInputService.pick(opts);
}

export function pickWithInputValue(
  opts: QuickPickSingleOptions,
): Promise<QuickPickValueResult | null> {
  return quickInputService.pickWithInputValue(opts);
}
