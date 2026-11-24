import { createSdkHost, type SdkHost, type SdkSession } from '@toets/protocol/host';
import { createToets, type Toets, type ToetsOptions } from '../src/index.js';

export interface Harness {
  host: SdkHost;
  toets: Toets;
  session: SdkSession;
}

const open: Array<{ host: SdkHost; toets?: Toets }> = [];

/** Starts a real host and an SDK runtime connected to it. */
export async function connect(
  options: Partial<ToetsOptions> & {
    setup?: (toets: Toets) => void;
    extra?: Record<string, unknown>;
  } = {},
): Promise<Harness> {
  const host = await createSdkHost();
  const entry: { host: SdkHost; toets?: Toets } = { host };
  open.push(entry);
  const token = host.issueToken();
  const toets = createToets({
    framework: 'test',
    payload: { v: 1, sdkUrl: host.url, token, ...options.extra },
    ...options,
  });
  entry.toets = toets;
  options.setup?.(toets);
  toets.start();
  const session = await host.waitForSession(token, { timeoutMs: 5000 });
  return { host, toets, session };
}

export async function closeAll(): Promise<void> {
  for (const { host, toets } of open.splice(0)) {
    toets?.stop();
    await host.close();
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
