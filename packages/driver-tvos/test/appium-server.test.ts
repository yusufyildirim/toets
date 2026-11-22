import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { defaultAppiumHome, freePort, startAppiumServer } from '../src/appium-server.js';

// Starts the real, pinned Appium server (no simulator needed) to prove the package is a
// working APPIUM_HOME with the XCUITest driver.
describe('startAppiumServer', () => {
  let dir: string | undefined;
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('starts the pinned Appium with the XCUITest driver and stops it', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dpad-appium-'));
    const logFile = join(dir, 'appium.log');
    const server = await startAppiumServer({ logFile });
    try {
      const res = await fetch(new URL('status', server.url));
      expect(res.ok).toBe(true);
    } finally {
      await server.stop();
      await server.stop();
    }
    await expect(fetch(new URL('status', server.url))).rejects.toThrow();
    const log = await readFile(logFile, 'utf8');
    expect(log).toMatch(/xcuitest/i);
  }, 60_000);

  it('fails with a DpadError when the port is taken', async () => {
    dir ??= await mkdtemp(join(tmpdir(), 'dpad-appium-'));
    const port = await freePort();
    const first = await startAppiumServer({ logFile: join(dir, 'a.log'), port });
    try {
      await expect(
        startAppiumServer({ logFile: join(dir, 'b.log'), port, startTimeoutMs: 20_000 }),
      ).rejects.toMatchObject({ code: 'TVOS_APPIUM_START_FAILED' });
    } finally {
      await first.stop();
    }
  }, 60_000);

  it('uses this package as APPIUM_HOME', () => {
    expect(defaultAppiumHome()).toMatch(/driver-tvos$/);
  });
});
