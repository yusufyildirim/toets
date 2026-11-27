import {
  ToetsError,
  packageDocsLink,
  type DeepLinkMapper,
  type TranslatedDeepLink,
} from '@toets/core';
import { LAUNCH_PARAM } from '@toets/protocol';

/**
 * An Android intent a deep link translates to, for apps whose links are not a plain VIEW URI
 * (Fire TV content intents: a custom action with extras and no URI). Started with
 * `am start -p <package>`, never with a component: the OS resolves the activity from the app's
 * intent filters, which is what a deep link test checks.
 */
export interface AndroidDeepLink {
  /** Data URI (`am start -d`). */
  readonly uri?: string;
  /** Intent action. Default `android.intent.action.VIEW`. */
  readonly action?: string;
  /** Intent categories (`-c`). `DEFAULT` is added by the OS for activity starts. */
  readonly categories?: readonly string[];
  /** MIME type (`-t`). */
  readonly mimeType?: string;
  /** Typed extras: strings `--es`, booleans `--ez`, integers `--ei` (`--el` beyond 32 bits), other numbers `--ef`. */
  readonly extras?: Readonly<Record<string, string | number | boolean>>;
}

/** The intent toets starts, normalized from the mapper's result. */
export interface AndroidIntent {
  readonly action: string;
  readonly uri?: string;
  readonly categories: readonly string[];
  readonly mimeType?: string;
  readonly extras: readonly (readonly [string, string | number | boolean])[];
}

export const VIEW_ACTION = 'android.intent.action.VIEW';
const DOCS = packageDocsLink('core', 'deep-links');

function invalid(link: URL, problem: string): ToetsError {
  return new ToetsError(
    'DEEPLINK_INVALID',
    `The android-tv deepLink mapper returned ${problem} for ${link.href}.`,
    {
      hint: 'Return a URI string, or an intent `{ uri?, action?, categories?, mimeType?, extras? }` with a `uri` or an `action`, from `app.androidTV.deepLink` (a Fire TV project sets it in its own `app`).',
      docs: DOCS,
    },
  );
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v !== '';

/**
 * Translates a canonical link into the intent to start: the mapper's result, or the link
 * unchanged as a VIEW intent.
 */
export function translateAndroidDeepLink(
  link: URL,
  mapper: DeepLinkMapper<string | AndroidDeepLink> | undefined,
): TranslatedDeepLink {
  const mapped: unknown = mapper ? mapper(link) : link.href;
  const intent = toIntent(link, mapped);
  return { description: describeIntent(intent), data: intent };
}

function toIntent(link: URL, mapped: unknown): AndroidIntent {
  if (typeof mapped === 'string') {
    if (mapped === '') throw invalid(link, 'an empty string');
    return { action: VIEW_ACTION, uri: mapped, categories: [], extras: [] };
  }
  if (typeof mapped !== 'object' || mapped === null || Array.isArray(mapped)) {
    throw invalid(link, describeValue(mapped));
  }
  const { uri, action, categories, mimeType, extras } = mapped as Record<string, unknown>;
  if (uri !== undefined && !nonEmpty(uri)) throw invalid(link, `uri ${describeValue(uri)}`);
  if (action !== undefined && !nonEmpty(action))
    throw invalid(link, `action ${describeValue(action)}`);
  if (mimeType !== undefined && !nonEmpty(mimeType))
    throw invalid(link, `mimeType ${describeValue(mimeType)}`);
  if (uri === undefined && action === undefined)
    throw invalid(link, 'an intent without uri or action');
  if (categories !== undefined && !(Array.isArray(categories) && categories.every(nonEmpty))) {
    throw invalid(link, `categories ${describeValue(categories)}`);
  }
  const extraEntries: [string, string | number | boolean][] = [];
  if (extras !== undefined) {
    if (typeof extras !== 'object' || extras === null || Array.isArray(extras)) {
      throw invalid(link, `extras ${describeValue(extras)}`);
    }
    for (const [key, value] of Object.entries(extras)) {
      if (key === '' || key === LAUNCH_PARAM)
        throw invalid(link, `the reserved extra ${describeValue(key)}`);
      const ok =
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value));
      if (!ok) throw invalid(link, `extra ${key} = ${describeValue(value)}`);
      extraEntries.push([key, value]);
    }
  }
  return {
    action: (action as string | undefined) ?? VIEW_ACTION,
    ...(uri === undefined ? {} : { uri: uri as string }),
    categories: (categories as string[] | undefined) ?? [],
    ...(mimeType === undefined ? {} : { mimeType: mimeType as string }),
    extras: extraEntries,
  };
}

function describeValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (typeof value === 'function') return 'a function';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * The intent in words: the URI alone for a plain VIEW intent, else
 * `intent <action> [uri] [categories [...]] [type <mime>] [extras { key: value }]`.
 */
export function describeIntent(intent: AndroidIntent): string {
  const plain =
    intent.action === VIEW_ACTION &&
    intent.uri !== undefined &&
    intent.categories.length === 0 &&
    intent.mimeType === undefined &&
    intent.extras.length === 0;
  if (plain) return intent.uri!;
  const parts = ['intent', intent.action];
  if (intent.uri !== undefined) parts.push(intent.uri);
  if (intent.categories.length) parts.push(`categories [${intent.categories.join(', ')}]`);
  if (intent.mimeType !== undefined) parts.push(`type ${intent.mimeType}`);
  if (intent.extras.length) {
    const extras = intent.extras.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ');
    parts.push(`extras { ${extras} }`);
  }
  return parts.join(' ');
}

const INT32 = 2 ** 31;

/**
 * `am start` intent arguments: `-a`, `-d`, `-c`, `-t`, typed extras and `-p <package>`. Never
 * `-n`: the OS picks the activity from the app's intent filters.
 */
export function intentArgs(intent: AndroidIntent, pkg: string): string[] {
  const args = ['-a', intent.action];
  if (intent.uri !== undefined) args.push('-d', intent.uri);
  for (const category of intent.categories) args.push('-c', category);
  if (intent.mimeType !== undefined) args.push('-t', intent.mimeType);
  for (const [key, value] of intent.extras) args.push(...extraArgs(key, value));
  args.push('-p', pkg);
  return args;
}

function extraArgs(key: string, value: string | number | boolean): string[] {
  if (typeof value === 'string') return ['--es', key, value];
  if (typeof value === 'boolean') return ['--ez', key, String(value)];
  if (Number.isInteger(value)) {
    return [value >= -INT32 && value < INT32 ? '--ei' : '--el', key, String(value)];
  }
  return ['--ef', key, String(value)];
}
