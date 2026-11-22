import { ProtocolError } from '@dpad-tv/protocol';

/**
 * Every dpad error explains itself: what happened, the likely cause and fix (`hint`)
 * and where to read more (`docs`). Agents act on these fields; keep them specific.
 */
export class DpadError extends Error {
  readonly code: string;
  readonly hint: string | undefined;
  readonly docs: string | undefined;

  constructor(
    code: string,
    message: string,
    opts: { hint?: string; docs?: string; cause?: unknown } = {},
  ) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = 'DpadError';
    this.code = code;
    this.hint = opts.hint;
    this.docs = opts.docs;
    // Runners such as Playwright Test print `stack`, not `toString()`: lead it with the code,
    // hint and docs so they reach the test output.
    if (typeof this.stack === 'string') {
      const frames = this.stack.indexOf('\n    at ');
      this.stack = this.toString() + (frames === -1 ? '' : this.stack.slice(frames));
    }
  }

  /** `DpadError [CODE]: message`, then `Hint:` and `Docs:` lines when set. */
  override toString(): string {
    let out = `${this.name} [${this.code}]: ${this.message}`;
    if (this.hint) out += `\nHint: ${this.hint}`;
    if (this.docs) out += `\nDocs: ${describeDocs(this.docs)}`;
    return out;
  }
}

/** A docs path plus, for package pages, where the installed package ships it. */
function describeDocs(path: string): string {
  const pkg = /^reference\/([^/]+)\/docs\/(.+)$/.exec(path);
  return pkg ? `${path} (offline: node_modules/@dpad-tv/${pkg[1]}/docs/${pkg[2]}.md)` : path;
}

/**
 * Surfaces an SDK host `ProtocolError` as a `DpadError` with the same code, hint and docs, so
 * users see one error type. Anything else is returned unchanged.
 */
export function fromProtocolError(error: unknown): unknown {
  if (!(error instanceof ProtocolError)) return error;
  return new DpadError(error.code, error.message, {
    ...(error.hint === undefined ? {} : { hint: error.hint }),
    ...(error.docs === undefined ? {} : { docs: error.docs }),
    cause: error,
  });
}

/**
 * `DpadError.docs` holds a docs site path (e.g. `concepts/focus`), resolved against the site
 * once its domain is decided. This names a guide page: `docs/<slug>.md` in the repository.
 */
export function docsLink(slug: string): string {
  return slug;
}

/**
 * Docs site path of a page a package ships, `reference/<pkg>/docs/<page>`. In an install it is
 * `node_modules/@dpad-tv/<pkg>/docs/<page>.md`.
 */
export function packageDocsLink(pkg: string, page: string): string {
  return `reference/${pkg}/docs/${page}`;
}
