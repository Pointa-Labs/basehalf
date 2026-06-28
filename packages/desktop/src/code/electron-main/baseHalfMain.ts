import { BaseHalfApplication } from './app.js';
import { MainChannelRegistry } from './mainChannelRegistry.js';
import { baseHalfMainPaths, createBaseHalfMainServices } from './mainProcessServices.js';

export interface BaseHalfMainOptions {
  readonly here: string;
  readonly env?: BaseHalfMainEnvironment;
  readonly log?: Pick<Console, 'error'>;
  readonly exit?: (code: number) => void;
}

export interface BaseHalfMainEnvironment {
  readonly ELECTRON_RENDERER_URL?: string | undefined;
}

/**
 * The main BaseHalf Electron startup coordinator, mirroring VS Code's
 * `CodeMain`. It owns top-level startup order; service composition and app
 * lifecycle stay in sibling modules.
 */
export class BaseHalfMain {
  private readonly env: BaseHalfMainEnvironment;
  private readonly log: Pick<Console, 'error'>;
  private readonly exit: (code: number) => void;

  constructor(private readonly opts: BaseHalfMainOptions) {
    this.env = opts.env ?? process.env;
    this.log = opts.log ?? console;
    this.exit = opts.exit ?? ((code: number) => process.exit(code));
  }

  main(): void {
    void this.startup().catch((error: unknown) => {
      this.log.error(error);
      process.exitCode = 1;
      this.exit(1);
    });
  }

  protected async startup(): Promise<void> {
    const services = createBaseHalfMainServices({
      ...baseHalfMainPaths(this.opts.here),
      rendererUrl: this.env.ELECTRON_RENDERER_URL,
    });

    new MainChannelRegistry(services.channelRegistry).register();
    services.windowLifecycle.registerQuitHandlers();

    await new BaseHalfApplication(services.application).startup();
  }
}
