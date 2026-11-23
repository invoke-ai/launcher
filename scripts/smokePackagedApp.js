/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const { chromium } = require('playwright-core');

async function packagedPage(profile, signal) {
  // Attach only after Electron has created its BrowserWindow. Attaching during
  // the initial blank target can leave the test looking at the wrong document.
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && !signal.aborted) {
    let port;
    try {
      [port] = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    if (port) {
      const endpoint = `http://127.0.0.1:${Number(port)}`;
      // Chromium may have written the port file while the first window is still starting.
      let targets = [];
      try {
        const response = await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(3000) });
        if (response.ok) {
          targets = await response.json();
        }
      } catch (error) {
        if (!(error.name === 'TimeoutError' || error.cause?.code === 'ECONNREFUSED')) {
          throw error;
        }
      }
      const target = targets.find((t) => t.type === 'page' && t.url.endsWith('/app.asar/out/renderer/index.html'));
      if (target) {
        const browser = await chromium.connectOverCDP(endpoint, { timeout: 5000 });
        const page = browser
          .contexts()[0]
          .pages()
          .find((p) => p.url() === target.url);
        if (!page) {
          throw new Error('Packaged renderer disappeared before the smoke test attached');
        }
        page.setDefaultTimeout(15000);
        return page;
      }
    }
    await delay(100);
  }
  throw new Error('Packaged app did not load its renderer within 30 seconds');
}

async function exerciseTerminal(page) {
  await page.getByRole('button', { name: 'Open Terminal' }).click();
  await page.getByRole('button', { name: 'Start Dev Console' }).click();
  const input = page.locator('.xterm-helper-textarea').last();
  const command = process.platform === 'win32' ? '& $env:INVOKE_SMOKE_UV --version' : '"$INVOKE_SMOKE_UV" --version';
  await input.pressSequentially(command);
  await input.press('Enter');
  // The command line itself does not contain this output. Seeing it requires
  // the packaged renderer, preload, native PTY and the bundled uv to work.
  await page.waitForFunction(() => /uv \d+\.\d+\.\d+/.test(document.querySelector('.xterm-rows')?.textContent ?? ''));
}

async function run(executable) {
  const profile = await mkdtemp(path.join(tmpdir(), 'invoke-launcher-smoke-'));
  const directory = path.dirname(executable);
  const uv =
    process.platform === 'darwin'
      ? '../Resources/bin/uv'
      : `resources/bin/${process.platform === 'win32' ? 'uv.exe' : 'uv'}`;
  const child = spawn(
    executable,
    [
      `--user-data-dir=${profile}`,
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0',
      // Keep update checks offline and avoid a native update dialog during the test.
      '--proxy-server=127.0.0.1:1',
    ],
    { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, INVOKE_SMOKE_UV: path.resolve(directory, uv) } }
  );
  const exited = once(child, 'exit');
  const controller = new AbortController();
  try {
    const page = await Promise.race([
      packagedPage(profile, controller.signal).then(async (p) => {
        await exerciseTerminal(p);
        return p;
      }),
      exited.then(([code, signal]) => {
        throw new Error(`Launcher exited before the PTY check: ${code ?? signal}`);
      }),
    ]);
    await page.close();
    const [code, signal] = await Promise.race([
      exited,
      delay(10000, undefined, { ref: false }).then(() => {
        throw new Error('Launcher did not exit after closing the window');
      }),
    ]);
    if (code !== 0) {
      throw new Error(`Launcher quit with ${code ?? signal}`);
    }
    console.log('Packaged renderer, native terminal, bundled uv and normal exit passed');
  } finally {
    controller.abort();
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 3 });
  }
}

run(path.resolve(process.argv[2])).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
