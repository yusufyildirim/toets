import { describe, expect, it } from 'vitest';
import { ToetsError, Key, type ActionInfo } from '../src/index.js';
import { setup } from './fixtures.js';

describe('remote', () => {
  it('presses keys through the driver and logs them', async () => {
    const { app, driver, runtime } = setup();
    await app.remote.press(Key.RIGHT);
    await app.remote.longPress(Key.SELECT, 700);
    expect(driver.presses).toEqual([
      { key: 'RIGHT', opts: undefined },
      { key: 'SELECT', opts: { holdMs: 700 } },
    ]);
    expect(runtime.keyLog.map((k) => k.key)).toEqual(['RIGHT', 'SELECT']);
  });

  it('repeats and sequences as grouped steps', async () => {
    const steps: string[] = [];
    const { app, driver } = setup({
      runtime: { hooks: { step: (info, run) => (steps.push(info.title), run()) } },
    });
    await app.remote.repeat(Key.RIGHT, 2);
    await app.remote.sequence([Key.DOWN, Key.SELECT]);
    expect(driver.presses.map((p) => p.key)).toEqual(['RIGHT', 'RIGHT', 'DOWN', 'SELECT']);
    expect(steps).toEqual([
      'repeat RIGHT x2',
      'press RIGHT',
      'press RIGHT',
      'sequence DOWN, SELECT',
      'press DOWN',
      'press SELECT',
    ]);
  });

  it('refuses keys the platform lacks, with a hint', async () => {
    const { app, driver } = setup({ capabilities: [] });
    const err = await app.remote.press(Key.RED).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToetsError);
    expect(err).toMatchObject({ code: 'KEY_UNSUPPORTED' });
    expect((err as ToetsError).message).toBe(
      "web has no RED key: it needs capability 'key.color'.",
    );
    expect((err as ToetsError).hint).toContain("requires('key.color')");
    await expect(app.remote.longPress(Key.SELECT)).rejects.toThrow('key.longpress');
    expect(driver.presses).toEqual([]);
  });

  it('checks every key of a sequence or repeat before pressing the first', async () => {
    const { app, driver } = setup({ capabilities: [] });
    await expect(app.remote.sequence([Key.RIGHT, Key.PLAY_PAUSE])).rejects.toMatchObject({
      code: 'KEY_UNSUPPORTED',
    });
    await expect(app.remote.repeat(Key.RED, 2)).rejects.toMatchObject({ code: 'KEY_UNSUPPORTED' });
    expect(driver.presses).toEqual([]);
  });

  it('tells whether a key would be sent, after overrides', () => {
    const { runtime } = setup({
      capabilities: ['key.longpress'],
      runtime: { keyOverrides: { FAST_FORWARD: { as: Key.RIGHT, holdMs: 800 } } },
    });
    expect(runtime.checkKey(Key.RIGHT)).toBeNull();
    expect(runtime.checkKey(Key.FAST_FORWARD)).toBeNull();
    expect(runtime.checkKey(Key.REWIND)?.code).toBe('KEY_UNSUPPORTED');
    expect(runtime.checkKey('KEYCODE_ENTER' as Key)?.code).toBe('UNKNOWN_KEY');
    const noHold = setup({ capabilities: [] }).runtime;
    expect(noHold.checkKey(Key.SELECT, { holdMs: 500 })?.message).toContain('key.longpress');
  });

  it('applies key overrides, checks the performed key and flags the step', async () => {
    const infos: ActionInfo[] = [];
    const { app, driver, runtime } = setup({
      capabilities: ['key.longpress'],
      runtime: {
        keyOverrides: { FAST_FORWARD: { as: Key.RIGHT, holdMs: 800 } },
        hooks: { step: (info, run) => (infos.push(info), run()) },
      },
    });
    await app.remote.press(Key.FAST_FORWARD);
    expect(driver.presses).toEqual([{ key: 'RIGHT', opts: { holdMs: 800 } }]);
    expect(infos[0]).toEqual({
      kind: 'press',
      title: 'press FAST_FORWARD (override: hold RIGHT 800ms)',
      override: { key: 'FAST_FORWARD', performedAs: 'hold RIGHT 800ms' },
    });
    expect(runtime.keyLog[0]).toMatchObject({
      key: 'FAST_FORWARD',
      performedAs: 'hold RIGHT 800ms',
    });
  });

  it('rejects unknown keys and bad counts', async () => {
    const { app } = setup();
    await expect(app.remote.press('KEYCODE_DPAD_UP' as Key)).rejects.toMatchObject({
      code: 'UNKNOWN_KEY',
    });
    await expect(app.remote.repeat(Key.UP, -1)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
