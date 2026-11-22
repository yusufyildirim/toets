import type { MediaInfo } from '@dpad-tv/protocol';
import type { Media, Network, PlatformEvent, PlatformInfo, RecordedRequest } from '../api.js';
import type { Capability } from '../capabilities.js';
import { DpadError, docsLink } from '../errors.js';
import type { MockServerLike, RequestFilter } from '../mock.js';
import type { Platform } from '../platform.js';
import type { RuntimeContext } from './context.js';

/** `app.media`: playback state from the SDK `media` domain. */
export class MediaImpl implements Media {
  constructor(readonly ctx: RuntimeContext) {}

  async get(): Promise<MediaInfo | null> {
    this.ctx.requireCapability('media.state', 'Reading media state');
    const media = await this.ctx.target.media();
    return media ?? null;
  }
}

/** `app.network`: mock handlers and recorded requests on the host-side mock server. */
export class NetworkImpl implements Network {
  constructor(readonly ctx: RuntimeContext) {}

  /** The mock server, or a `DpadError` explaining how to enable it. */
  server(): MockServerLike {
    const mock = this.ctx.mock;
    if (!mock) {
      throw new DpadError('MOCK_DISABLED', 'Network mocking is not enabled for this project.', {
        hint: "Enable it in the dpad config (dpad: { mock: true }), or declare requires('network.mock') to skip where it is off.",
        docs: docsLink('core/network'),
      });
    }
    return mock;
  }

  use(...handlers: readonly unknown[]): void {
    this.server().use(...handlers);
  }

  resetHandlers(): void {
    this.server().resetHandlers();
  }

  async requests(filter?: RequestFilter): Promise<readonly RecordedRequest[]> {
    return this.server().requests(filter);
  }
}

/** `app.platform`: which platform this is and what it can do. */
export class PlatformInfoImpl implements PlatformInfo {
  constructor(private readonly ctx: RuntimeContext) {}

  get name(): Platform {
    return this.ctx.target.driver.platform;
  }

  get capabilities(): ReadonlySet<Capability> {
    const caps = new Set(this.ctx.target.capabilities);
    if (this.ctx.mock) caps.add('network.mock');
    return caps;
  }

  has(capability: Capability): boolean {
    return this.capabilities.has(capability);
  }

  async emit(event: PlatformEvent): Promise<void> {
    this.ctx.requireCapability('platform.events', `Emitting '${event}'`);
    const driver = this.ctx.target.driver;
    const emit = driver.emit?.bind(driver);
    if (!emit) {
      throw new DpadError(
        'DRIVER_CONTRACT',
        `${driver.platform} declares 'platform.events' but does not implement emit().`,
        {
          hint: 'This is a driver bug; report it to the driver package.',
          docs: docsLink('core/capabilities'),
        },
      );
    }
    await this.ctx.step({ kind: 'emit', title: `platform.emit ${event}` }, () => emit(event));
  }
}
