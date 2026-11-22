import type { DriverModule } from '@dpad-tv/core';
import { FakeDriver } from '@dpad-tv/core/testing';

/** A driver package stand-in: default-exports a DriverModule over FakeDriver. */
const module: DriverModule<{ label?: string }> = {
  platform: 'web',
  async createDriver(options, ctx) {
    const label = options.label ?? String(ctx.app.title ?? 'Hello');
    return new FakeDriver({
      initialFocus: 'hello',
      root: {
        children: [
          {
            id: 'hello',
            testId: 'hello',
            text: label,
            focusable: true,
            bounds: { x: 0, y: 0, width: 100, height: 100 },
          },
        ],
      },
    });
  },
};

export default module;
