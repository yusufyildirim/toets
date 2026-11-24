/**
 * The demo platform's driver module: `platforms.web({ driver: <this file> })` runs tests against
 * {@link DemoTvApp} in memory, no browser or device needed.
 */
import type { DriverModule } from '@toets/core';
import { DemoTvApp, registry } from './app.ts';

const demoDriverModule: DriverModule = {
  platform: 'web',
  async createDriver() {
    registry.app = new DemoTvApp();
    return registry.app;
  },
};

export default demoDriverModule;
