import { type WebContents, app } from 'electron';

export interface WindowSecurityMainServiceOptions {
  readonly rendererUrl?: string | undefined;
}

/**
 * Global webContents navigation policy, following VS Code's Electron-main
 * security split: window creation owns BrowserWindow construction, while the
 * application-level security service guards every webContents that appears.
 */
export class WindowSecurityMainService {
  constructor(private readonly opts: WindowSecurityMainServiceOptions = {}) {}

  registerWebContentsGuards(): void {
    app.on('web-contents-created', (_event, contents) => {
      this.installWebContentsGuards(contents);
    });
  }

  installWebContentsGuards(contents: Pick<WebContents, 'on' | 'setWindowOpenHandler'>): void {
    contents.on('will-navigate', (event, url) => {
      const rendererUrl = this.opts.rendererUrl ?? process.env.ELECTRON_RENDERER_URL ?? '';
      if (isAllowedRendererNavigation(url, rendererUrl)) return;
      event.preventDefault();
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  }
}

export function isAllowedRendererNavigation(url: string, rendererUrl: string): boolean {
  if (rendererUrl === '') return false;
  try {
    const target = new URL(url);
    const allowed = new URL(rendererUrl);
    const allowedPath = allowed.pathname.endsWith('/') ? allowed.pathname : `${allowed.pathname}/`;
    return (
      target.origin === allowed.origin &&
      (target.pathname === allowed.pathname || target.pathname.startsWith(allowedPath))
    );
  } catch {
    return false;
  }
}
