import { getDefaultConfig } from 'expo/metro-config';

const config = getDefaultConfig(import.meta.dirname);

type ResolveRequest = NonNullable<NonNullable<typeof config.resolver>['resolveRequest']>;

const noop: Record<string, string> = {
  '@dpad-tv/sdk-react-native': '@dpad-tv/sdk-react-native/noop',
  '@dpad-tv/sdk': '@dpad-tv/sdk/noop',
};
const resolveRequest: ResolveRequest = (context, moduleName, platform) =>
  context.resolveRequest(context, noop[moduleName] ?? moduleName, platform);

/**
 * The dpad SDK ships only in e2e builds (`DPAD_E2E=1`, the build scripts' default). Any other
 * bundle gets its inert no-op module, so production builds carry no SDK code. Clear Metro's
 * cache (`--clear`) when switching.
 */
export default process.env.DPAD_E2E === '1'
  ? config
  : { ...config, resolver: { ...config.resolver, resolveRequest } };
