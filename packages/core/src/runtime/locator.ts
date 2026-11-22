import type { Locator, Screenshot, ScreenshotOptions } from '../api.js';
import { DpadError, packageDocsLink } from '../errors.js';
import type { Selector, SelectorChain } from '../selectors.js';
import type { ElementSnapshot } from '../snapshot.js';
import type { RuntimeContext } from './context.js';
import { cropPng, createScreenshot } from './screenshot.js';
import { renderTextSnapshot } from './text-snapshot.js';
import { findNode } from './tree.js';

function describeSelector(step: Selector): string {
  switch (step.kind) {
    case 'testId':
      return `getByTestId(${quote(step.value)})`;
    case 'text': {
      const value = step.value instanceof RegExp ? String(step.value) : quote(step.value);
      return `getByText(${value}${step.exact ? ', { exact: true }' : ''})`;
    }
    case 'focused':
      return 'focus.current()';
    case 'nth':
      return step.index === 0 ? 'first()' : `nth(${step.index})`;
  }
}

const quote = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** Deterministic description of a chain, e.g. `getByTestId('rail').getByText('Alpha').first()`. */
export function describeChain(chain: SelectorChain): string {
  return chain.map(describeSelector).join('.');
}

/** Describes an element for messages: `card_a "Alpha"`. */
export function describeElement(el: ElementSnapshot | null): string {
  if (!el) return 'nothing';
  const name = el.testId ?? 'element';
  return el.text ? `${name} ${JSON.stringify(el.text)}` : name;
}

export function strictModeError(
  chain: SelectorChain,
  matches: readonly ElementSnapshot[],
): DpadError {
  const shown = matches.slice(0, 5).map((m) => `  - ${describeElement(m)}`);
  if (matches.length > 5) shown.push(`  - ... ${matches.length - 5} more`);
  return new DpadError(
    'STRICT_MODE_VIOLATION',
    `${describeChain(chain)} resolved to ${matches.length} elements:\n${shown.join('\n')}`,
    {
      hint: 'Make the locator unique: prefer a more specific test ID, scope it (getByTestId(rail).getByText(...)), or pick one with .first() / .nth(i).',
      docs: packageDocsLink('core', 'locators'),
    },
  );
}

export class LocatorImpl {
  constructor(
    readonly ctx: RuntimeContext,
    readonly chain: SelectorChain,
  ) {}

  get description(): string {
    return describeChain(this.chain);
  }

  private child(step: Selector): Locator {
    return createLocator(this.ctx, [...this.chain, step]);
  }

  getByTestId(testId: string): Locator {
    return this.child({ kind: 'testId', value: testId });
  }

  getByText(text: string | RegExp, opts?: { exact?: boolean }): Locator {
    return this.child(
      opts?.exact === undefined
        ? { kind: 'text', value: text }
        : { kind: 'text', value: text, exact: opts.exact },
    );
  }

  first(): Locator {
    return this.nth(0);
  }

  nth(index: number): Locator {
    if (!Number.isInteger(index) || index < 0) {
      throw new DpadError('INVALID_ARGUMENT', `nth() needs a non-negative integer, got ${index}.`, {
        docs: packageDocsLink('core', 'locators'),
      });
    }
    return this.child({ kind: 'nth', index });
  }

  /** Current matches, no waiting. */
  resolve(): Promise<readonly ElementSnapshot[]> {
    return this.ctx.target.query(this.chain);
  }

  /** Waits for exactly one match (strict); throws on several. */
  async resolveOne(timeoutMs = this.ctx.timeouts.actionMs): Promise<ElementSnapshot> {
    const result = await this.ctx.retry(async () => {
      const matches = await this.resolve();
      if (matches.length > 1) throw strictModeError(this.chain, matches);
      return { ok: matches.length === 1, value: matches[0] };
    }, timeoutMs);
    if (result.ok && result.value) return result.value;
    throw new DpadError(
      'ELEMENT_NOT_FOUND',
      `${this.description} matched no element within ${timeoutMs}ms.`,
      {
        hint: 'Check the test ID or text against app.snapshot(). On TV, lists are often virtualized: an element far from focus may not exist until focus moves near it.',
        docs: packageDocsLink('core', 'locators'),
        cause: result.error,
      },
    );
  }

  async count(): Promise<number> {
    return (await this.resolve()).length;
  }

  async text(): Promise<string | null> {
    return (await this.resolveOne()).text;
  }

  async testId(): Promise<string | null> {
    return (await this.resolveOne()).testId;
  }

  async isVisible(): Promise<boolean> {
    const matches = await this.resolve();
    if (matches.length > 1) throw strictModeError(this.chain, matches);
    return matches[0]?.visible ?? false;
  }

  async isFocused(): Promise<boolean> {
    const matches = await this.resolve();
    if (matches.length > 1) throw strictModeError(this.chain, matches);
    return matches[0]?.focused ?? false;
  }

  async screenshot(opts?: ScreenshotOptions): Promise<Screenshot> {
    const el = await this.resolveOne();
    const shot = await this.ctx.captureScreen(opts);
    return createScreenshot(cropPng(shot.png, el.bounds, shot.viewportWidth));
  }

  async snapshot(): Promise<string> {
    const el = await this.resolveOne();
    const tree = await this.ctx.target.tree();
    const node = findNode(tree, el.ref);
    if (!node) {
      throw new DpadError(
        'ELEMENT_DETACHED',
        `${this.description} resolved to an element missing from the tree.`,
        {
          hint: 'The screen changed between the lookup and the snapshot; retry once it settles. If it persists, the driver reports inconsistent element refs (driver bug).',
          docs: packageDocsLink('core', 'text-snapshots'),
        },
      );
    }
    return renderTextSnapshot(tree, node);
  }

  toString(): string {
    return this.description;
  }
}

export function createLocator(ctx: RuntimeContext, chain: SelectorChain): Locator {
  return new LocatorImpl(ctx, chain) as unknown as Locator;
}

/** The implementation behind a public `Locator`, or `null` for anything else. */
export function locatorImpl(value: unknown): LocatorImpl | null {
  return value instanceof LocatorImpl ? value : null;
}

export function isLocator(value: unknown): value is Locator {
  return value instanceof LocatorImpl;
}
