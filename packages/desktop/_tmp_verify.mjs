import { join } from 'node:path';
import { _electron as electron } from 'playwright';
const app = await electron.launch({ args: [join(process.cwd(),'out','main','index.cjs')], env: { ...process.env, ELECTRON_RUN_AS_NODE: '', BH_CONFIG_DIR: '/tmp/bh-term-cfg2' } });
const win = await app.firstWindow();
await win.waitForTimeout(3000);
const xterm = await win.$('.xterm');
if (xterm) { await xterm.click(); await win.waitForTimeout(300);
  await win.keyboard.type('echo "Ghostty-style:  ✓ 中文 → 箭头 ── │ ╭╮╰╯  λ ∑"\r'); await win.waitForTimeout(900);
  await win.keyboard.type('ls -la | head -5\r'); await win.waitForTimeout(1500); }
await win.screenshot({ path: '/tmp/bh-term-verify/ghostty-look.png' });
await app.close();
