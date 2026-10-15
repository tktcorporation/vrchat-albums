#!/usr/bin/env bun
import { $ } from 'bun';
import { join } from 'node:path';
const home = process.env.HOME;
if (!home) throw new Error('HOME is required');
const matches = [
  ...new Bun.Glob('.cache/ms-playwright/chromium-*/chrome-linux/chrome').scanSync({ cwd: home }),
];
const chromium = matches[0] ? join(home, matches[0]) : '';
if (!chromium) throw new Error('Playwright Chromium was not found');
const profile = '/tmp/puppeteer_dev_chrome_profile-cdp-mcp';
// Chrome は crashpad handler を別プロセスとして残すため、両方を掃除の対象にする。
const staleProcessPatterns = [
  `chrome.*--user-data-dir=${profile}`,
  `chrome_crashpad_handler.*${profile}`,
];
async function cleanup() {
  for (const pattern of staleProcessPatterns) await $`pkill -f ${pattern}`.quiet().nothrow();
}
await cleanup();
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, async () => {
    await cleanup();
    process.exit(0);
  });
// クライアントが stdin を閉じた場合など、シグナルを介さない正常終了もここだけを通る。
// exit ハンドラは同期しか実行できないので、cleanup() と同じ対象を spawnSync で掃除する。
process.on('exit', () => {
  for (const pattern of staleProcessPatterns) {
    Bun.spawnSync(['pkill', '-f', pattern], { stdout: 'ignore', stderr: 'ignore' });
  }
});
const child = Bun.spawn(
  [
    'chrome-devtools-mcp',
    '--headless',
    '--isolated',
    `--executablePath=${chromium}`,
    '--chromeArg=--no-sandbox',
    '--chromeArg=--disable-setuid-sandbox',
    `--chromeArg=--user-data-dir=${profile}`,
  ],
  { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' },
);
process.exit(await child.exited);
