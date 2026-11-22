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
  }

  override toString(): string {
    let out = `${this.name} [${this.code}]: ${this.message}`;
    if (this.hint) out += `\nHint: ${this.hint}`;
    if (this.docs) out += `\nDocs: ${this.docs}`;
    return out;
  }
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
 * Docs are referenced by page slug (e.g. `concepts/focus`), resolved against the docs site
 * once its domain is decided. Shipped docs live at `node_modules/@dpad-tv/<pkg>/docs/<slug>.md`.
 */
export function docsLink(slug: string): string {
  return `docs/${slug}`;
}
