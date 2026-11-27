import { describe, expect, it } from 'vitest';
import {
  formatFailureDump,
  ToetsError,
  type ActionInfo,
  type Capability,
  type TranslatedDeepLink,
} from '../src/index.js';
import { ALL_KEYS, setup } from './fixtures.js';

const LINKS: Capability[] = [...ALL_KEYS, 'deeplink.launch', 'deeplink.open'];

function recordSteps() {
  const titles: string[] = [];
  const kinds: string[] = [];
  const hooks = {
    step: <T>(i: ActionInfo, run: () => Promise<T>) => {
      titles.push(i.title);
      kinds.push(i.kind);
      return run();
    },
  };
  return { titles, kinds, hooks };
}

describe('launch({ deepLink })', () => {
  it('translates the link once and passes it to the driver with the payload', async () => {
    let calls = 0;
    const { app, driver } = setup({
      capabilities: LINKS,
      driver: {
        deepLink: (link) => (calls++, `https://example.com/watch${link.pathname}`),
      },
    });
    await app.launch({ deepLink: 'myapp://details/42', clearData: true });
    expect(calls).toBe(1);
    expect(driver.launches).toEqual([
      {
        payload: { v: 1 },
        clearData: true,
        deepLink: {
          description: 'https://example.com/watch/42',
          data: 'https://example.com/watch/42',
        },
      },
    ]);
  });

  it('combines with state and flags, which reach the app through the payload', async () => {
    const { app, driver } = setup({ capabilities: LINKS, sdk: true });
    await app.launch({ deepLink: 'myapp://details/42', state: 'signed-in', flags: { a: true } });
    expect(driver.launches[0]).toMatchObject({
      payload: { state: 'signed-in', flags: { a: true }, token: 'token-1' },
      deepLink: { description: 'myapp://details/42' },
    });
  });

  it('shows the translation in the step title', async () => {
    const steps = recordSteps();
    const { app } = setup({
      capabilities: LINKS,
      driver: {
        deepLink: (link) =>
          link.host === 'details'
            ? `intent com.example.PLAY extras { contentId: "${link.pathname.slice(1)}" }`
            : link.href,
      },
      runtime: { hooks: steps.hooks },
    });
    await app.launch({ deepLink: 'myapp://details/42' });
    await app.launch({ deepLink: 'myapp://home', clearData: true });
    expect(steps.titles).toEqual([
      'launch (deepLink: myapp://details/42 → intent com.example.PLAY extras { contentId: "42" })',
      'launch clearData (deepLink: myapp://home)',
    ]);
  });

  it('refuses links that are not absolute URLs, before touching the app', async () => {
    const steps = recordSteps();
    const { app, driver } = setup({ capabilities: LINKS, runtime: { hooks: steps.hooks } });
    for (const link of ['details/42', '/details/42', '', 42 as unknown as string]) {
      const err = await app.launch({ deepLink: link }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ToetsError);
      expect(err).toMatchObject({ code: 'DEEPLINK_INVALID' });
      expect((err as ToetsError).message).toBe(
        `Deep link ${JSON.stringify(link)} is not an absolute URL.`,
      );
    }
    expect(driver.launches).toEqual([]);
    // The failure is still a reported step.
    expect(steps.titles[0]).toBe('launch (deepLink: details/42)');
  });

  it('reports a mapper that throws as DEEPLINK_INVALID naming the platform and link', async () => {
    const { app, driver } = setup({
      capabilities: LINKS,
      driver: {
        platform: 'android-tv',
        deepLink: () => {
          throw new Error('no id');
        },
      },
    });
    const err = await app.launch({ deepLink: 'myapp://details' }).catch((e: unknown) => e);
    expect(err).toMatchObject({
      code: 'DEEPLINK_INVALID',
      message: 'The android-tv deepLink mapper threw for myapp://details: no id',
    });
    expect((err as ToetsError).hint).toContain('`deepLink` mapper in the android-tv app config');
    expect(driver.launches).toEqual([]);
  });

  it('keeps toets errors a translation throws', async () => {
    const { app } = setup({
      capabilities: LINKS,
      driver: {
        deepLink: () => {
          throw new ToetsError('DEEPLINK_INVALID', 'mapper returned 42');
        },
      },
    });
    await expect(app.launch({ deepLink: 'myapp://x' })).rejects.toMatchObject({
      code: 'DEEPLINK_INVALID',
      message: 'mapper returned 42',
    });
  });

  it('needs deeplink.launch', async () => {
    const { app, driver } = setup();
    await expect(app.launch({ deepLink: 'myapp://details/42' })).rejects.toMatchObject({
      code: 'CAPABILITY_MISSING',
      message:
        "launch({ deepLink }) needs capability 'deeplink.launch', which web does not have here.",
    });
    expect(driver.launches).toEqual([]);
  });

  it('passes driver errors (unhandled links) through', async () => {
    const { app, driver, runtime } = setup({ capabilities: LINKS });
    driver.onDeepLink = () => {
      throw new ToetsError('DEEPLINK_UNHANDLED', 'No activity handles it.');
    };
    await expect(app.launch({ deepLink: 'nope://x' })).rejects.toMatchObject({
      code: 'DEEPLINK_UNHANDLED',
    });
    expect(runtime.isLaunched).toBe(false);
  });

  it('adds the trampoline hint when the SDK never connects after a deep link launch', async () => {
    const { app } = setup({ capabilities: LINKS, sdk: { connect: false } });
    const plain = (await app.launch().catch((e: unknown) => e)) as ToetsError;
    expect(plain.code).toBe('SDK_NOT_CONNECTED');
    expect(plain.hint).not.toContain('trampoline');
    const fromLink = (await app
      .launch({ deepLink: 'myapp://details/42' })
      .catch((e: unknown) => e)) as ToetsError;
    expect(fromLink.code).toBe('SDK_NOT_CONNECTED');
    expect(fromLink.hint).toContain('trampoline activities (splash, router) must forward');
  });
});

describe('openDeepLink', () => {
  it('delivers the translated link to the running app as a step', async () => {
    const steps = recordSteps();
    const { app, driver } = setup({
      capabilities: LINKS,
      driver: { deepLink: (link) => `https://example.com/watch${link.pathname}` },
      runtime: { hooks: steps.hooks },
    });
    await app.launch();
    await app.openDeepLink('myapp://details/42');
    expect(driver.openedLinks).toEqual([
      { description: 'https://example.com/watch/42', data: 'https://example.com/watch/42' },
    ]);
    // No relaunch: the app receives the link while running.
    expect(driver.launches).toHaveLength(1);
    expect(steps.titles.at(-1)).toBe(
      'openDeepLink myapp://details/42 → https://example.com/watch/42',
    );
    expect(steps.kinds.at(-1)).toBe('openDeepLink');
  });

  it('lets the app react to the link', async () => {
    const { app, driver } = setup({ capabilities: LINKS });
    driver.onDeepLink = (link: TranslatedDeepLink, d) => {
      if (link.description === 'myapp://settings') d.focus('menu_settings');
    };
    await app.launch();
    await app.openDeepLink('myapp://settings');
    await expect(app.getByTestId('menu_settings').isFocused()).resolves.toBe(true);
  });

  it('needs deeplink.open, also where launching from links works (web)', async () => {
    const { app } = setup({ capabilities: [...ALL_KEYS, 'deeplink.launch'] });
    await app.launch();
    const err = (await app.openDeepLink('myapp://x').catch((e: unknown) => e)) as ToetsError;
    expect(err.code).toBe('CAPABILITY_MISSING');
    expect(err.message).toBe(
      "app.openDeepLink() needs capability 'deeplink.open', which web does not have here.",
    );
    expect(err.hint).toBe(
      "Declare requires('deeplink.open') on the test so it is skipped on platforms without it.",
    );
  });

  it('needs a launched app', async () => {
    const { app, driver } = setup({ capabilities: LINKS });
    await expect(app.openDeepLink('myapp://x')).rejects.toMatchObject({
      code: 'APP_NOT_LAUNCHED',
    });
    await app.launch();
    await app.terminate();
    await expect(app.openDeepLink('myapp://x')).rejects.toMatchObject({
      code: 'APP_NOT_LAUNCHED',
    });
    expect(driver.openedLinks).toEqual([]);
  });

  it('validates the link like launch', async () => {
    const { app } = setup({ capabilities: LINKS });
    await app.launch();
    await expect(app.openDeepLink('details/42')).rejects.toMatchObject({
      code: 'DEEPLINK_INVALID',
    });
  });

  it('reports a driver that declares deeplink.open without open() as a driver bug', async () => {
    const { app, driver } = setup({ capabilities: LINKS });
    (driver as { deepLinks?: unknown }).deepLinks = {
      translate: () => ({ description: 'x', data: 'x' }),
    };
    await app.launch();
    await expect(app.openDeepLink('myapp://x')).rejects.toMatchObject({ code: 'DRIVER_CONTRACT' });
  });
});

describe('failure dump', () => {
  it('shows the last launch and deep link with their translations, cleared by isolate', async () => {
    const { app, runtime } = setup({
      capabilities: LINKS,
      driver: { deepLink: (link) => `https://example.com${link.pathname}` },
    });
    await app.launch({ deepLink: 'myapp://details/42' });
    await app.openDeepLink('myapp://details/43');
    const dump = await runtime.failureDump();
    expect(dump.lastLaunch).toBe('launch (deepLink: myapp://details/42 → https://example.com/42)');
    expect(dump.lastDeepLink).toBe('openDeepLink myapp://details/43 → https://example.com/43');
    const text = formatFailureDump(dump);
    expect(text).toContain(
      '- last launch: launch (deepLink: myapp://details/42 → https://example.com/42)\n',
    );
    expect(text).toContain(
      '- last deep link: openDeepLink myapp://details/43 → https://example.com/43\n',
    );

    // A new launch starts a new history.
    await app.launch();
    expect((await runtime.failureDump()).lastDeepLink).toBeNull();

    await runtime.isolate();
    const after = await runtime.failureDump();
    expect(after.lastLaunch).toBeNull();
    expect(formatFailureDump(after)).not.toContain('last launch');
  });
});
