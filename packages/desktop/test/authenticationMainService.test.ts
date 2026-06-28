import { describe, expect, it, vi } from 'vitest';
import type { AuthenticationSession } from '../src/workbench/services/authentication/common/authentication.js';
import {
  AuthenticationMainService,
  type AuthenticationProvider,
} from '../src/workbench/services/authentication/electron-main/authenticationMainService.js';

const session = (providerId = 'github'): AuthenticationSession => ({
  id: 'github',
  providerId,
  account: { id: 'ada', label: 'ada' },
  scopes: ['repo'],
});

describe('AuthenticationMainService', () => {
  it('routes session operations through registered providers and emits changes', async () => {
    const events: unknown[] = [];
    const provider: AuthenticationProvider = {
      id: 'github',
      label: 'GitHub',
      getSessions: vi.fn(async () => [session()]),
      createSession: vi.fn(async () => session()),
      removeSession: vi.fn(async () => undefined),
    };
    const service = new AuthenticationMainService();
    service.registerProvider(provider);
    service.onDidChangeSessions((event) => events.push(event));

    await expect(service.getSessions('github')).resolves.toEqual([session()]);
    await expect(service.createSession('github', 'tok')).resolves.toEqual(session());
    await service.removeSession('github', 'github');

    expect(provider.createSession).toHaveBeenCalledWith('tok');
    expect(provider.removeSession).toHaveBeenCalledWith('github');
    expect(events).toEqual([{ providerId: 'github' }, { providerId: 'github' }]);
  });
});
