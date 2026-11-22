import type { DriverModule } from '@dpad-tv/core';
import { FakeTvApp, registry, TVOS_CAPABILITIES } from './fake-app.js';

const module: DriverModule = {
  platform: 'tvos',
  async createDriver(_options, ctx) {
    if (!ctx.device) throw new Error('the tvOS fake needs a device lease');
    registry.device = ctx.device.address;
    registry.driver = new FakeTvApp('tvos', TVOS_CAPABILITIES, ctx);
    return registry.driver;
  },
};

export default module;
