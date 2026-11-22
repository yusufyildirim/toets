import { CONFORMANCE_FIXTURE } from '@dpad-tv/protocol';
import { formatConformanceReport, runConformance } from '@dpad-tv/protocol/conformance';
import { createElement as h, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { load, type Adapter } from './helpers.js';
import { fire, render, type FakeInstance, type Rendered } from './renderer.js';

const { testIds, states, text } = CONFORMANCE_FIXTURE;

const box = (left: number, top: number, width: number, height: number) => ({
  style: { left, top, width, height },
});

function Fixture(): ReactNode {
  return h(
    'RCTView',
    box(0, 0, 1920, 1080),
    h('RCTView', { testID: testIds.a, focusable: true, ...box(100, 100, 300, 200) }),
    h('RCTView', { testID: testIds.b, focusable: true, ...box(450, 100, 300, 200) }),
    h('RCTText', { testID: testIds.text, ...box(100, 400, 600, 50) }, text),
  );
}

/**
 * Each launch is a fresh app process: new module state, the payload delivered through the
 * root's initial props (the Android path), focus moved by simulated native events.
 */
function fixtureApp() {
  let sdk: Adapter | null = null;
  let rendered: Rendered | null = null;
  let focused: FakeInstance | null = null;

  const moveFocus = (testId: string): void => {
    const next = rendered!.byTestId(testId);
    fire('focus', next);
    if (focused && focused !== next) fire('blur', focused);
    focused = next;
  };

  return {
    name: '@dpad-tv/sdk-react-native (fake Fabric renderer, Android payload path)',
    fixture: true,
    async launch({ encoded }: { encoded: string }) {
      ({ sdk } = await load('android'));
      focused = null;
      sdk.onState(async (state, flags) => {
        if (state === states.focusA) moveFocus(testIds.a);
        else if (state === states.focusB) moveFocus(testIds.b);
        else if (state === states.log) console.info(String(flags.marker));
        else if (state === states.busy) {
          const done = sdk!.markBusy('conformance busy');
          setTimeout(done, Number(flags.ms));
        } else if (state === states.fail) throw new Error('conformance failure');
      });
      sdk.startDpad();
      rendered = render(h(sdk.DpadRoot, { initialProps: { __dpad: encoded } }, h(Fixture)));
    },
    terminate() {
      sdk?.getDpad()?.stop();
      rendered?.unmount();
      rendered = null;
    },
  };
}

describe('conformance', () => {
  it('passes the protocol conformance suite', { timeout: 60_000 }, async () => {
    const report = await runConformance(fixtureApp(), { connectTimeoutMs: 5000 });
    expect(report.passed, formatConformanceReport(report)).toBe(true);
    const skipped = report.results.filter((r) => r.status === 'skip').map((r) => r.id);
    // Every domain is announced, so there is no unavailable domain to probe.
    expect(skipped).toEqual(['rpc.domain-unavailable']);
  });
});
