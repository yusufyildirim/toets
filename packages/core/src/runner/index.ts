/**
 * `@dpad-tv/core/runner`: what a runner needs to bring a target up and down. Shared by
 * `@dpad-tv/test` (one target per Playwright worker) and `@dpad-tv/mcp` (one per session), so
 * driver loading, device selection, the SDK host and the mock server behave the same in both.
 * Node only. Test authors never import it.
 */
export { selectDeviceProvider, type DeviceSelection } from './devices.js';
export { importUserModule, loadDriverModule } from './load.js';
export {
  mergeRuntimeConfig,
  RunningTarget,
  type MockServerFactory,
  type RuntimeConfig,
  type TargetConfig,
  type TargetContext,
} from './target.js';
export { settleFocus } from '../runtime/focus.js';
export { jsString } from '../runtime/locator.js';
export { describeKeyOverride } from '../runtime/remote.js';
