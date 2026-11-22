import type { DriverModule } from '../../src/index.js';
import { FakeDriver } from '../../src/testing/index.js';

/** The last driver created, so tests can inspect it. */
export const created: { driver?: FakeDriver } = {};

/** A driver package stand-in: default-exports a web DriverModule over FakeDriver. */
const module: DriverModule = {
  platform: 'web',
  async createDriver() {
    created.driver = new FakeDriver({ root: { testId: 'root' } });
    return created.driver;
  },
};

export default module;
