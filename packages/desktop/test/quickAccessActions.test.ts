import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { quickInputService } from '../src/platform/quickinput/browser/quickInputService.js';
import {
  quickAccessWorkbenchActions,
  registerQuickAccessActions,
  runQuickOpenAction,
  runShowCommandsAction,
} from '../src/workbench/browser/actions/quickAccessActions.js';
import { getWorkbenchAction } from '../src/workbench/browser/actions/workbenchActions.js';
import { registerCommandPaletteQuickAccessProviders } from '../src/workbench/browser/quickaccess/quickAccessContributions.js';
import {
  COMMANDS_QUICK_ACCESS_PREFIX,
  WORKBENCH_QUICK_OPEN_COMMAND_ID,
  WORKBENCH_SHOW_COMMANDS_COMMAND_ID,
} from '../src/workbench/common/quickaccess/commandPaletteProviders.js';

describe('quick access workbench actions', () => {
  beforeEach(() => {
    registerCommandPaletteQuickAccessProviders();
  });

  afterEach(() => {
    quickInputService.quickAccess.hide();
  });

  it('exports VS Code-style quick access command ids', () => {
    expect(quickAccessWorkbenchActions.map((action) => action.id)).toEqual([
      WORKBENCH_QUICK_OPEN_COMMAND_ID,
      WORKBENCH_SHOW_COMMANDS_COMMAND_ID,
    ]);
  });

  it('registers quick access workbench actions idempotently', () => {
    registerQuickAccessActions();
    registerQuickAccessActions();

    expect(getWorkbenchAction(WORKBENCH_QUICK_OPEN_COMMAND_ID)?.label).toBe('Go to File...');
    expect(getWorkbenchAction(WORKBENCH_SHOW_COMMANDS_COMMAND_ID)?.label).toBe('Show All Commands');
  });

  it('opens default quick access and the commands provider through command helpers', () => {
    runQuickOpenAction();
    expect(quickInputService.quickAccess.getState()).toMatchObject({
      visible: true,
      value: '',
      filterValue: '',
    });

    runQuickOpenAction('notes');
    expect(quickInputService.quickAccess.getState()).toMatchObject({
      visible: true,
      value: 'notes',
      filterValue: 'notes',
    });

    runShowCommandsAction();
    expect(quickInputService.quickAccess.getState()).toMatchObject({
      visible: true,
      value: COMMANDS_QUICK_ACCESS_PREFIX,
      filterValue: '',
    });
  });
});
