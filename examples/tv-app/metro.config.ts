import { getDefaultConfig } from 'expo/metro-config';

const config = getDefaultConfig(import.meta.dirname);

type ResolveRequest = NonNullable<NonNullable<typeof config.resolver>['resolveRequest']>;

const noop: Record<string, string> = {
  '@toets/sdk-react-native': '@toets/sdk-react-native/noop',
  '@toets/sdk': '@toets/sdk/noop',
};
const resolveRequest: ResolveRequest = (context, moduleName, platform) =>
  context.resolveRequest(context, noop[moduleName] ?? moduleName, platform);

/**
 * The toets SDK ships only in e2e builds (`TOETS_E2E=1`, the build scripts' default). Any other
 * bundle gets its inert no-op module, so production builds carry no SDK code. Clear Metro's
 * cache (`--clear`) when switching.
 */
export default process.env.TOETS_E2E === '1'
  ? config
  : { ...config, resolver: { ...config.resolver, resolveRequest } };
