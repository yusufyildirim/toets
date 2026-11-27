import {
  ToetsError,
  packageDocsLink,
  type DeepLinkMapper,
  type TranslatedDeepLink,
} from '@toets/core';
import { LAUNCH_PARAM, encodeLaunchPayloadParam, type LaunchPayload } from '@toets/protocol';

/**
 * The app URL with the payload as `?__toets=<base64url(JSON)>`. Existing query parameters and
 * the hash (hash routers) are preserved; an existing `__toets` parameter is replaced.
 */
export function launchUrl(appUrl: URL, payload: LaunchPayload): string {
  const url = new URL(appUrl);
  url.searchParams.set(LAUNCH_PARAM, encodeLaunchPayloadParam(payload));
  return url.href;
}

/**
 * The default web form of a canonical link: its route as a path relative to the app URL.
 * `myapp://details/42?x=1#t` -> `details/42?x=1#t` (host, path, query, hash);
 * `https://example.com/watch/42?t=1` -> `watch/42?t=1` (path, query, hash).
 */
export function defaultWebDeepLink(link: URL): string {
  const route = /^https?:$/.test(link.protocol)
    ? `${link.pathname}${link.search}${link.hash}`
    : `${link.host}${link.pathname}${link.search}${link.hash}`;
  return route.replace(/^\/+/, '');
}

/**
 * Translates a canonical link into the page URL to load: the mapper's result (or
 * {@link defaultWebDeepLink}), resolved against the app URL like a link on its page.
 */
export function translateWebDeepLink(
  appUrl: URL,
  link: URL,
  mapper: DeepLinkMapper<string> | undefined,
): TranslatedDeepLink {
  const mapped: unknown = mapper ? mapper(link) : defaultWebDeepLink(link);
  let url: URL | undefined;
  if (typeof mapped === 'string') {
    try {
      url = new URL(mapped, appUrl);
    } catch {
      // not a URL
    }
  }
  if (!url || !/^(https?|file):$/.test(url.protocol)) {
    throw new ToetsError(
      'DEEPLINK_INVALID',
      `The web deepLink mapper returned ${JSON.stringify(mapped) ?? 'undefined'} for ${link.href}, which is no page URL.`,
      {
        hint: "Return a path relative to the app `url` (`details/42`, `/details/42`) or an http(s) URL from `app.web.deepLink`. Browsers have no OS deep links: the link becomes the page's URL.",
        docs: packageDocsLink('core', 'deep-links'),
      },
    );
  }
  return { description: url.href, data: url.href };
}
