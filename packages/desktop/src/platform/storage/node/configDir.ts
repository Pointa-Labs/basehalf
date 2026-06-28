import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export function defaultConfigDir(): string {
  if (process.env.BH_CONFIG_DIR) return process.env.BH_CONFIG_DIR;
  const home = homedir();
  switch (platform()) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'basehalf');
    case 'win32':
      return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'basehalf');
    default:
      return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'basehalf');
  }
}
