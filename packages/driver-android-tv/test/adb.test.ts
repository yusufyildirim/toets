import { DpadError } from '@dpad-tv/core';
import { describe, expect, it } from 'vitest';
import { Adb } from '../src/adb.js';
import { shellQuote } from '../src/command.js';
import { FakeRunner } from './fake-runner.js';

const make = (runner = new FakeRunner()) => ({
  runner,
  adb: new Adb(runner, '/sdk/adb', 'emulator-5554', {}),
});

describe('shellQuote', () => {
  it('leaves safe words alone and single-quotes the rest', () => {
    expect(shellQuote('am')).toBe('am');
    expect(shellQuote('tv.dpad/.Main')).toBe('tv.dpad/.Main');
    expect(shellQuote('')).toBe("''");
    expect(shellQuote('a b')).toBe("'a b'");
    expect(shellQuote(`{"v":1,"s":"it's $HOME"}`)).toBe(`'{"v":1,"s":"it'\\''s $HOME"}'`);
  });
});

describe('Adb', () => {
  it('targets the serial and joins shell arguments safely', async () => {
    const { runner, adb } = make();
    await adb.shell(['echo', 'a b']);
    expect(runner.calls[0]).toMatchObject({
      file: '/sdk/adb',
      args: ['-s', 'emulator-5554', 'shell', "echo 'a b'"],
    });
  });

  it('throws a DpadError naming the command on failure', async () => {
    const { runner, adb } = make();
    runner.on('pm clear', { exitCode: 1, stderr: 'boom' });
    const err = await adb.clearData('com.x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DpadError);
    expect((err as DpadError).code).toBe('ANDROID_COMMAND_FAILED');
    expect((err as DpadError).message).toContain('boom');
  });

  it('passes string extras to am start and detects failures in its output', async () => {
    const { runner, adb } = make();
    runner.on('am start', 'Starting: Intent { cmp=com.x/.Main }\nStatus: ok\nComplete\n');
    await adb.startActivity(
      { component: 'com.x/.Main', action: 'android.intent.action.MAIN' },
      { __dpad: '{"v":1,"mockUrl":"http://localhost:1234"}' },
    );
    expect(runner.calls[0]?.args.at(-1)).toBe(
      `am start -W -n com.x/.Main -a android.intent.action.MAIN --es __dpad '{"v":1,"mockUrl":"http://localhost:1234"}'`,
    );

    runner.on(
      'am start',
      'Starting: Intent { cmp=com.x/.Nope }\nError type 3\nError: Activity class {com.x/com.x.Nope} does not exist.\n',
    );
    const err = await adb.startActivity({ component: 'com.x/.Nope' }).catch((e: unknown) => e);
    expect((err as DpadError).code).toBe('ANDROID_LAUNCH_FAILED');
    expect((err as DpadError).message).toContain('does not exist');
  });

  it('resolves the leanback launcher activity first', async () => {
    const { runner, adb } = make();
    runner.on('LEANBACK_LAUNCHER', 'priority=0 preferredOrder=0 match=0x108000\ncom.x/.TvMain\n');
    expect(await adb.resolveLauncher('com.x')).toEqual({
      component: 'com.x/.TvMain',
      action: 'android.intent.action.MAIN',
      category: 'android.intent.category.LEANBACK_LAUNCHER',
    });
    runner
      .on('LEANBACK_LAUNCHER', 'No activity found\n')
      .on('category.LAUNCHER ', 'com.x/.PhoneMain\n');
    expect((await adb.resolveLauncher('com.x'))?.category).toBe('android.intent.category.LAUNCHER');
    runner.on('category.LAUNCHER ', 'No activity found\n');
    expect(await adb.resolveLauncher('com.x')).toBeNull();
  });

  it('reads the exact package uid', async () => {
    const { runner, adb } = make();
    runner.on('pm list packages -U', 'package:com.x.debug uid:10100\npackage:com.x uid:10096\n');
    expect(await adb.appUid('com.x')).toBe(10096);
    expect(await adb.appUid('com.y')).toBeNull();
  });

  it('checks installation, installs and reverses ports', async () => {
    const { runner, adb } = make();
    runner.on('pm path', { exitCode: 1 });
    expect(await adb.isInstalled('com.x')).toBe(false);
    runner.on('pm path', 'package:/data/app/base.apk\n');
    expect(await adb.isInstalled('com.x')).toBe(true);

    runner.on(' install ', 'Performing Streamed Install\nSuccess\n');
    await adb.install('/tmp/app.apk');
    await adb.reverse(9323);
    await adb.removeReverse(9323);
    expect(runner.lines()).toContain('adb -s emulator-5554 install -r -t -g /tmp/app.apk');
    expect(runner.lines()).toContain('adb -s emulator-5554 reverse tcp:9323 tcp:9323');
    expect(runner.lines()).toContain('adb -s emulator-5554 reverse --remove tcp:9323');

    runner.on(' install ', 'Failure [INSTALL_FAILED_NO_MATCHING_ABIS]\n');
    await expect(adb.install('/tmp/app.apk')).rejects.toThrow(/NO_MATCHING_ABIS/);
  });

  it('waits for boot completion and times out with a clear error', async () => {
    const { runner, adb } = make();
    let polls = 0;
    runner.on('get-state', 'device\n').on('sys.boot_completed', () => (++polls >= 3 ? '1' : ''));
    await adb.waitForBoot(5_000, 1);
    expect(polls).toBe(3);

    runner.on('get-state', { exitCode: 1, stderr: 'device offline' });
    const err = await adb.waitForBoot(20, 1).catch((e: unknown) => e);
    expect((err as DpadError).code).toBe('ANDROID_DEVICE_NOT_READY');
  });

  it('fails emulator console commands that answer KO', async () => {
    const { runner, adb } = make();
    runner.on(' emu ', 'KO: snapshot not found\n');
    await expect(adb.emu(['avd', 'snapshot', 'load', 'x'])).rejects.toThrow(/snapshot not found/);
  });
});
