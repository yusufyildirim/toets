import type { Domain, FocusGraphNode, MediaInfo, SdkSession } from '@dpad-tv/protocol';
import type { Capability } from '../capabilities.js';
import type { Driver } from '../driver.js';
import type { SelectorChain } from '../selectors.js';
import type { ElementSnapshot, UITree } from '../snapshot.js';
import type { IdleCheck } from './retry.js';
import { evaluateChain, protocolToTree, toSnapshot, walkTree } from './tree.js';

/** Capabilities each SDK domain adds to a target. */
export const DOMAIN_CAPABILITIES: Readonly<Record<Domain, readonly Capability[]>> = {
  tree: [],
  focus: ['focus.graph'],
  sync: ['sync.idle'],
  media: ['media.state'],
  state: ['app.state'],
  logs: ['logs'],
  metrics: [],
};

/** Every capability an SDK can add; assumed for `requires` checks when the SDK is enabled. */
export const SDK_CAPABILITIES: readonly Capability[] = [
  ...new Set(Object.values(DOMAIN_CAPABILITIES).flat()),
];

export interface TargetOptions {
  /** Quiet period the SDK must observe before reporting idle. */
  readonly idleQuietMs: number;
  readonly log: (message: string) => void;
}

/**
 * One app target: a driver plus, when connected, an SDK session. Composes them per VISION:
 * the SDK answers tree, query, focus, focus graph, media and idle; the driver does input,
 * launch and screenshots. An SDK failure never fails a read: the target logs it and falls back
 * to the driver, so the SDK stays an accelerator.
 */
export class Target {
  private session: SdkSession | null = null;

  constructor(
    readonly driver: Driver,
    private readonly opts: TargetOptions,
  ) {}

  get sdk(): SdkSession | null {
    return this.session;
  }

  attach(session: SdkSession): void {
    this.session = session;
    void session.closed.then(
      () => this.detach(session),
      () => this.detach(session),
    );
  }

  detach(session?: SdkSession): void {
    if (!session || this.session === session) this.session = null;
  }

  /** Driver capabilities plus the connected SDK's domains. */
  get capabilities(): ReadonlySet<Capability> {
    const caps = new Set(this.driver.capabilities);
    for (const domain of this.session?.domains ?? []) {
      for (const cap of DOMAIN_CAPABILITIES[domain] ?? []) caps.add(cap);
    }
    return caps;
  }

  has(domain: Domain): boolean {
    return this.session?.domains.has(domain) ?? false;
  }

  private async viaSdk<T>(
    domain: Domain,
    run: (s: SdkSession) => Promise<T>,
  ): Promise<T | undefined> {
    const session = this.session;
    if (!session || !session.domains.has(domain)) return undefined;
    try {
      return await run(session);
    } catch (e) {
      this.opts.log(`SDK ${domain} request failed, using the driver instead: ${String(e)}`);
      return undefined;
    }
  }

  private sdkTree(): Promise<UITree | undefined> {
    return this.viaSdk('tree', async (s) => protocolToTree((await s.request('tree.get', {})).root));
  }

  async tree(): Promise<UITree> {
    return (await this.sdkTree()) ?? (await this.driver.tree());
  }

  async query(chain: SelectorChain): Promise<readonly ElementSnapshot[]> {
    const tree = await this.sdkTree();
    return tree ? evaluateChain(tree, chain) : await this.driver.query(chain);
  }

  async focused(): Promise<ElementSnapshot | null> {
    const tree = await this.sdkTree();
    if (!tree) return await this.driver.focused();
    for (const node of walkTree(tree.root)) if (node.focused) return toSnapshot(node);
    return null;
  }

  /** The SDK focus graph, or `null` without the `focus` domain. */
  async focusGraph(): Promise<readonly FocusGraphNode[] | null> {
    return (
      (await this.viaSdk('focus', async (s) => (await s.request('focus.graph', {})).nodes)) ?? null
    );
  }

  /** Media state from the SDK; `undefined` when the `media` domain is unavailable. */
  async media(): Promise<MediaInfo | null | undefined> {
    const session = this.session;
    if (!session || !session.domains.has('media')) return undefined;
    return (await session.request('media.get', {})).media;
  }

  async waitForIdle(budgetMs: number): Promise<IdleCheck> {
    const session = this.session;
    if (!session || !session.domains.has('sync')) return { supported: false };
    try {
      const result = await session.request(
        'sync.waitForIdle',
        { timeoutMs: Math.round(budgetMs), quietMs: this.opts.idleQuietMs },
        { timeoutMs: budgetMs + 2000 },
      );
      return { supported: true, idle: result.idle, busy: result.busy };
    } catch (e) {
      this.opts.log(`SDK idle wait failed, polling instead: ${String(e)}`);
      return { supported: false };
    }
  }
}
