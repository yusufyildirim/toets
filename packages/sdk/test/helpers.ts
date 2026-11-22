import { createSdkHost, type SdkHost, type SdkSession } from '@dpad-tv/protocol/host';
import { createDpad, type Dpad, type DpadOptions } from '../src/index.js';

export interface Harness {
  host: SdkHost;
  dpad: Dpad;
  session: SdkSession;
}

const open: Array<{ host: SdkHost; dpad?: Dpad }> = [];

/** Starts a real host and an SDK runtime connected to it. */
export async function connect(
  options: Partial<DpadOptions> & {
    setup?: (dpad: Dpad) => void;
    extra?: Record<string, unknown>;
  } = {},
): Promise<Harness> {
  const host = await createSdkHost();
  const entry: { host: SdkHost; dpad?: Dpad } = { host };
  open.push(entry);
  const token = host.issueToken();
  const dpad = createDpad({
    framework: 'test',
    payload: { v: 1, sdkUrl: host.url, token, ...options.extra },
    ...options,
  });
  entry.dpad = dpad;
  options.setup?.(dpad);
  dpad.start();
  const session = await host.waitForSession(token, { timeoutMs: 5000 });
  return { host, dpad, session };
}

export async function closeAll(): Promise<void> {
  for (const { host, dpad } of open.splice(0)) {
    dpad?.stop();
    await host.close();
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
