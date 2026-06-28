import { describe, expect, it, vi } from 'vitest';
import type {
  AuthenticationSession,
  AuthenticationSessionsChangeEvent,
} from '../src/workbench/services/authentication/common/authentication.js';
import {
  AuthenticationMainService,
  type AuthenticationProvider,
} from '../src/workbench/services/authentication/electron-main/authenticationMainService.js';

const session = (
  providerId = 'github',
  account: AuthenticationSession['account'] = { id: 'ada', label: 'ada' },
): AuthenticationSession => ({
  id: 'github',
  providerId,
  account,
  scopes: ['repo'],
});

describe('AuthenticationMainService', () => {
  it('routes session operations through registered providers', async () => {
    const provider: AuthenticationProvider = {
      id: 'github',
      label: 'GitHub',
      getSessions: vi.fn(async () => [session()]),
      createSession: vi.fn(async () => session()),
      removeSession: vi.fn(async () => undefined),
    };
    const service = new AuthenticationMainService();
    service.registerProvider(provider);

    await expect(service.getSessions('github')).resolves.toEqual([session()]);
    await expect(service.createSession('github', 'tok')).resolves.toEqual(session());
    await service.removeSession('github', 'github');

    expect(provider.createSession).toHaveBeenCalledWith('tok');
    expect(provider.removeSession).toHaveBeenCalledWith('github');
  });

  it('forwards VS Code-style provider session change events with provider metadata', () => {
    const events: unknown[] = [];
    let providerListener: ((event: AuthenticationSessionsChangeEvent) => void) | undefined;
    const provider: AuthenticationProvider = {
      id: 'github',
      label: 'GitHub',
      getSessions: vi.fn(async () => [session()]),
      createSession: vi.fn(async () => session()),
      removeSession: vi.fn(async () => undefined),
      onDidChangeSessions: vi.fn((listener) => {
        providerListener = listener;
        return () => {
          providerListener = undefined;
        };
      }),
    };
    const service = new AuthenticationMainService();
    const unregister = service.registerProvider(provider);
    service.onDidChangeSessions((event) => events.push(event));
    const change = { added: [session()], removed: [], changed: [] };

    providerListener?.(change);
    unregister();
    providerListener?.({ added: [], removed: [session()], changed: [] });

    expect(events).toEqual([{ providerId: 'github', label: 'GitHub', event: change }]);
  });

  it('creates precise session deltas for providers that have not exposed their own event yet', async () => {
    const events: unknown[] = [];
    let current: readonly AuthenticationSession[] = [];
    const provider: AuthenticationProvider = {
      id: 'github',
      label: 'GitHub',
      getSessions: vi.fn(async () => current),
      createSession: vi.fn(async () => {
        current =
          current.length === 0
            ? [session('github', { id: 'grace', label: 'grace' })]
            : [session('github', { id: 'ada', label: 'ada' })];
        return current[0] ?? null;
      }),
      removeSession: vi.fn(async () => {
        current = [];
      }),
    };
    const service = new AuthenticationMainService();
    service.registerProvider(provider);
    service.onDidChangeSessions((event) => events.push(event));

    await service.createSession('github', 'tok');
    await service.createSession('github', 'tok2');
    await service.removeSession('github', 'github');

    expect(events).toEqual([
      {
        providerId: 'github',
        label: 'GitHub',
        event: {
          added: [session('github', { id: 'grace', label: 'grace' })],
          removed: [],
          changed: [],
        },
      },
      {
        providerId: 'github',
        label: 'GitHub',
        event: {
          added: [],
          removed: [],
          changed: [session('github', { id: 'ada', label: 'ada' })],
        },
      },
      {
        providerId: 'github',
        label: 'GitHub',
        event: {
          added: [],
          removed: [session('github', { id: 'ada', label: 'ada' })],
          changed: [],
        },
      },
    ]);
  });
});
