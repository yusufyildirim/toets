import {
  ToetsError,
  packageDocsLink,
  type DeepLinkMapper,
  type TranslatedDeepLink,
} from '@toets/core';

const DOCS = packageDocsLink('core', 'deep-links');

/**
 * Translates a canonical link into the URL the simulator opens: the mapper's result, or the
 * link unchanged. It must be an absolute URL (a scheme the app registers).
 */
export function translateTvosDeepLink(
  link: URL,
  mapper: DeepLinkMapper<string> | undefined,
): TranslatedDeepLink {
  const mapped: unknown = mapper ? mapper(link) : link.href;
  let absolute = false;
  if (typeof mapped === 'string') {
    try {
      new URL(mapped);
      absolute = true;
    } catch {
      // relative
    }
  }
  if (!absolute) {
    throw new ToetsError(
      'DEEPLINK_INVALID',
      `The tvos deepLink mapper returned ${JSON.stringify(mapped) ?? 'undefined'} for ${link.href}, which is not an absolute URL.`,
      {
        hint: 'Return the full URL the app opens, with its scheme (`myapp://details/42`), from `app.tvOS.deepLink`.',
        docs: DOCS,
      },
    );
  }
  return { description: mapped as string, data: mapped };
}

/** URL schemes an app registers (`CFBundleURLTypes` > `CFBundleURLSchemes` of its Info.plist), lowercased. */
export function urlSchemes(urlTypes: unknown): ReadonlySet<string> {
  const schemes = new Set<string>();
  if (!Array.isArray(urlTypes)) return schemes;
  for (const type of urlTypes) {
    const list: unknown = (type as { CFBundleURLSchemes?: unknown } | null)?.CFBundleURLSchemes;
    if (!Array.isArray(list)) continue;
    for (const scheme of list) if (typeof scheme === 'string') schemes.add(scheme.toLowerCase());
  }
  return schemes;
}

/**
 * `DEEPLINK_UNHANDLED` when the app does not register the URL's scheme, else `null`. XCTest
 * opens any URL in the app without complaint, so the check reads what the system would route.
 */
export function unregisteredScheme(
  url: string,
  bundleId: string,
  schemes: ReadonlySet<string>,
): ToetsError | null {
  const scheme = new URL(url).protocol.slice(0, -1).toLowerCase();
  if (schemes.has(scheme)) return null;
  const registered = schemes.size ? [...schemes].join(', ') : 'none';
  return new ToetsError(
    'DEEPLINK_UNHANDLED',
    `${bundleId} does not handle the deep link ${url}: it registers no "${scheme}" URL scheme (registered: ${registered}).`,
    {
      hint: "Register the URL scheme in the app's Info.plist (`CFBundleURLTypes` > `CFBundleURLSchemes`), or translate the link with `app.tvOS.deepLink` when this platform's form differs. Universal links (https) are not supported.",
      docs: DOCS,
    },
  );
}
