import type { WebContents } from 'electron';
import { app } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WindowSecurityMainService } from '../src/platform/windows/electron-main/windowSecurityMainService.js';

type AnyHandler = (...args: unknown[]) => unknown;

const electronMock = vi.hoisted(() => {
  const appHandlers = new Map<string, AnyHandler[]>();
  const appMock = {
    on: vi.fn((event: string, handler: AnyHandler) => {
      appHandlers.set(event, [...(appHandlers.get(event) ?? []), handler]);
    }),
  };
  return { appHandlers, appMock };
});

vi.mock('electron', () => ({
  app: electronMock.appMock,
}));

interface FakeWebContents extends Pick<WebContents, 'on' | 'setWindowOpenHandler'> {
  emitNavigation(url: string): { preventDefault: ReturnType<typeof vi.fn> };
  openWindow(): unknown;
}

function fakeWebContents(): FakeWebContents {
  let navigationHandler: ((event: { preventDefault: () => void }, url: string) => void) | null =
    null;
  let windowOpenHandler: (() => unknown) | null = null;
  return {
    on: vi.fn((event: string, handler: AnyHandler) => {
      if (event === 'will-navigate') {
        navigationHandler = handler as (event: { preventDefault: () => void }, url: string) => void;
      }
      return undefined as unknown as WebContents;
    }),
    setWindowOpenHandler: vi.fn((handler: () => unknown) => {
      windowOpenHandler = handler;
      return undefined;
    }),
    emitNavigation: (url: string) => {
      if (!navigationHandler) throw new Error('navigation handler was not registered');
      const event = { preventDefault: vi.fn() };
      navigationHandler(event, url);
      return event;
    },
    openWindow: () => {
      if (!windowOpenHandler) throw new Error('window open handler was not registered');
      return windowOpenHandler();
    },
  };
}

describe('WindowSecurityMainService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronMock.appHandlers.clear();
  });

  it('registers guards for every created webContents', () => {
    const service = new WindowSecurityMainService();
    service.registerWebContentsGuards();
    expect(app.on).toHaveBeenCalledWith('web-contents-created', expect.any(Function));

    const contents = fakeWebContents();
    const handler = electronMock.appHandlers.get('web-contents-created')?.[0];
    if (!handler) throw new Error('web-contents-created handler was not registered');
    handler({}, contents);

    expect(contents.on).toHaveBeenCalledWith('will-navigate', expect.any(Function));
    expect(contents.setWindowOpenHandler).toHaveBeenCalledWith(expect.any(Function));
  });

  it('prevents remote navigation while allowing the configured renderer URL', () => {
    const contents = fakeWebContents();
    const service = new WindowSecurityMainService({ rendererUrl: 'http://localhost:5173' });
    service.installWebContentsGuards(contents);

    expect(
      contents.emitNavigation('http://localhost:5173/workbench/electron-sandbox/desktop.main.tsx')
        .preventDefault,
    ).not.toHaveBeenCalled();
    expect(
      contents.emitNavigation('http://localhost:5173.evil.test').preventDefault,
    ).toHaveBeenCalledTimes(1);
    expect(contents.emitNavigation('https://example.com').preventDefault).toHaveBeenCalledTimes(1);
  });

  it('denies renderer-created windows', () => {
    const contents = fakeWebContents();
    const service = new WindowSecurityMainService();
    service.installWebContentsGuards(contents);

    expect(contents.openWindow()).toEqual({ action: 'deny' });
  });
});
