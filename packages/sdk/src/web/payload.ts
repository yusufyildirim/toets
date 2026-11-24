import { LAUNCH_GLOBAL, LAUNCH_PARAM } from '@toets/protocol';
import { getGlobal } from '../env.js';

/**
 * Finds the launch payload of a web app: `window.__TOETS__` (set by an init script) or the
 * `__toets` query parameter (also accepted inside a hash route, e.g. `#/home?__toets=...`).
 * Returns the raw value; `decodeLaunchPayload` validates it.
 */
export function discoverWebPayload(): unknown {
  const g = getGlobal();
  if (g[LAUNCH_GLOBAL] !== undefined && g[LAUNCH_GLOBAL] !== null) return g[LAUNCH_GLOBAL];
  const loc = g.location as { search?: string; hash?: string } | undefined;
  if (!loc) return undefined;
  const re = new RegExp(`[?&#]${LAUNCH_PARAM}=([^&#]*)`);
  const m = re.exec(loc.search || '') || re.exec(loc.hash || '');
  if (!m) return undefined;
  try {
    return decodeURIComponent(m[1] as string);
  } catch {
    return undefined;
  }
}
