import { describe, expect, it } from 'vitest';
import { connect, detailsScreen } from './helpers.js';

const LINKS = ['key.back', 'deeplink.launch', 'deeplink.open'] as const;

describe('deep link tools', () => {
  it('launches from a link, showing the translation and the test code', async () => {
    const h = await connect({
      capabilities: [...LINKS],
      driverOptions: { deepLink: (link) => `https://example.com/watch${link.pathname}` },
    });
    const out = await h.ok('launch', { deepLink: 'myapp://details/42', clearData: true });
    expect(out).toContain(
      'Step: launch clearData (deepLink: myapp://details/42 → https://example.com/watch/42)',
    );
    expect(out).toContain(
      "Code: await app.launch({ clearData: true, deepLink: 'myapp://details/42' });",
    );
    expect(h.driver.launches[0]?.deepLink?.description).toBe('https://example.com/watch/42');
  });

  it('opens a link in the running app and reports where focus landed', async () => {
    const h = await connect({ capabilities: [...LINKS] });
    await h.ok('launch');
    h.driver.onDeepLink = (_link, d) => d.setScreen(detailsScreen);
    const out = await h.ok('open_deep_link', { url: 'myapp://details/2' });
    expect(out).toBe(
      [
        'Step: openDeepLink myapp://details/2',
        'Focus: play "Play"',
        "Code: await app.openDeepLink('myapp://details/2');",
      ].join('\n'),
    );
    expect(h.driver.openedLinks).toHaveLength(1);
  });

  it('explains links it cannot open', async () => {
    const h = await connect({ capabilities: [...LINKS] });
    expect(await h.err('open_deep_link', { url: 'myapp://x' })).toContain('MCP_NOT_LAUNCHED');
    await h.ok('launch');
    expect(await h.err('open_deep_link', { url: 'details/2' })).toContain('DEEPLINK_INVALID');
  });

  it('reports the deep link capabilities', async () => {
    const web = await connect({ capabilities: ['deeplink.launch'] });
    expect(await web.ok('capabilities')).toContain(
      'Deep links: launch from a link yes (deeplink.launch); open in the running app no (deeplink.open missing)',
    );
    await web.ok('launch');
    expect(await web.err('open_deep_link', { url: 'myapp://x' })).toContain(
      "requires('deeplink.open')",
    );
  });
});
