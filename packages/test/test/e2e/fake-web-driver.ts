import type { DriverModule } from '@toets/core';
import { FakeTvApp, registry, WEB_CAPABILITIES } from './fake-app.js';

const module: DriverModule = {
  platform: 'web',
  async createDriver(_options, ctx) {
    registry.driver = new FakeTvApp('web', WEB_CAPABILITIES, ctx);
    return registry.driver;
  },
};

export default module;
