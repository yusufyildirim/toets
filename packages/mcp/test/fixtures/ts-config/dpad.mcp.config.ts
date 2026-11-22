import { defineMcpConfig } from '../../../src/config.js';

export default defineMcpConfig({
  targets: {
    first: { driver: '../fake-driver-module.ts', app: { title: 'From TS' } },
    second: { driver: '../fake-driver-module.ts', options: { label: 'Second' } },
  },
  defaultTarget: 'second',
});
