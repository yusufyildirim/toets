/** The part of a WebdriverIO `Browser` the driver uses. Kept small so tests can fake it. */
export interface TvosSession {
  execute(script: string, ...args: unknown[]): Promise<unknown>;
  /** WebDriver "Get Active Element": on tvOS the focused element, without an id when none is. */
  getActiveElement(): Promise<unknown>;
  takeScreenshot(): Promise<string>;
  deleteSession(): Promise<unknown>;
}

export interface SessionRequest {
  /** Appium server base URL. */
  readonly serverUrl: string;
  readonly capabilities: Readonly<Record<string, unknown>>;
  readonly timeoutMs: number;
}

/** Opens a WebdriverIO session; resolves to the real `WebdriverIO.Browser`. */
export type CreateSession = (req: SessionRequest) => Promise<TvosSession>;

export const createWebdriverioSession: CreateSession = async ({
  serverUrl,
  capabilities,
  timeoutMs,
}) => {
  // Loaded on demand: the device provider runs in the runner's main process without it.
  const { remote } = await import('webdriverio');
  const url = new URL(serverUrl);
  const browser = await remote({
    protocol: url.protocol === 'https:' ? 'https' : 'http',
    hostname: url.hostname,
    port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
    path: url.pathname,
    logLevel: 'silent',
    connectionRetryCount: 0,
    connectionRetryTimeout: timeoutMs,
    capabilities: capabilities as WebdriverIO.Capabilities,
  });
  return browser;
};
