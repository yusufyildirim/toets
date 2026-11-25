/**
 * Text entry, owned by the core for every platform: declared app keyboards (typed with D-pad
 * walks and SELECT over the tree) and system text entry (the driver's `text` input, reached
 * with real D-pad presses). `Locator.fill`, `app.keyboard` and their matchers build on it.
 */
import type {
  ElementTarget,
  Keyboard,
  KeyboardDefinition,
  Locator,
  TextEntryOptions,
} from '../api.js';
import type { DriverTextInput } from '../driver.js';
import { ToetsError, packageDocsLink } from '../errors.js';
import { DIRECTION_KEY, Key } from '../keys.js';
import type { Selector, SelectorChain } from '../selectors.js';
import type { ElementRef, ElementSnapshot, UINode, UITree } from '../snapshot.js';
import type { RuntimeContext } from './context.js';
import type { FocusImpl, NavigationGoal } from './focus.js';
import { describeChain, describeElement, strictModeError, type LocatorImpl } from './locator.js';
import type { RemoteImpl } from './remote.js';
import { sleep } from './retry.js';
import { planRoute } from './route.js';
import {
  evaluateChain,
  focusedIn,
  isMasked,
  maskText,
  normalizeText,
  toSnapshot,
  walkTree,
} from './tree.js';

const DOCS = packageDocsLink('core', 'text-input');
const POLL_MS = 50;
/** Toggle presses one character may take while searching the layers. */
const MAX_LAYER_PRESSES = 12;

const TARGET_KEYS = ['testId', 'text', 'exact', 'nth'] as const;
const DEFINITION_KEYS = [
  'name',
  'root',
  'fields',
  'keys',
  'layers',
  'space',
  'backspace',
  'clear',
  'submit',
] as const;

function invalid(message: string): ToetsError {
  return new ToetsError('INVALID_ARGUMENT', message, {
    hint: "e.g. defineKeyboard({ name: 'search', root: { testId: 'osk' }, fields: [{ testId: 'search_query' }] }).",
    docs: DOCS,
  });
}

function checkTarget(value: unknown, where: string): ElementTarget {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(`${where} must be a target object ({ testId, text, exact, nth }).`);
  }
  const t = value as Record<string, unknown>;
  for (const key of Object.keys(t)) {
    if (!(TARGET_KEYS as readonly string[]).includes(key)) {
      throw invalid(`${where} has an unknown key '${key}' (use testId, text, exact, nth).`);
    }
  }
  if (t.testId === undefined && t.text === undefined) {
    throw invalid(`${where} needs testId and/or text.`);
  }
  if (t.testId !== undefined && (typeof t.testId !== 'string' || !t.testId)) {
    throw invalid(`${where}.testId must be a non-empty string.`);
  }
  if (t.text !== undefined && (typeof t.text !== 'string' || !t.text)) {
    throw invalid(`${where}.text must be a non-empty string.`);
  }
  if (t.exact !== undefined && typeof t.exact !== 'boolean') {
    throw invalid(`${where}.exact must be a boolean.`);
  }
  if (t.nth !== undefined && (!Number.isInteger(t.nth) || (t.nth as number) < 0)) {
    throw invalid(`${where}.nth must be a non-negative integer.`);
  }
  return Object.freeze({ ...(t as ElementTarget) });
}

function checkTargets(value: unknown, where: string): readonly ElementTarget[] {
  if (!Array.isArray(value)) throw invalid(`${where} must be an array of targets.`);
  return Object.freeze(value.map((t, i) => checkTarget(t, `${where}[${i}]`)));
}

/**
 * Declares an app-drawn keyboard so `fill` and `app.keyboard` can type on it with the D-pad.
 * Validates the definition and returns a frozen copy; pass it to the `keyboards` option.
 *
 * @example
 * export const search = defineKeyboard({
 *   name: 'search',
 *   root: { testId: 'osk' },
 *   fields: [{ testId: 'search_query' }],
 *   layers: [{ testId: 'osk_shift' }, { testId: 'osk_symbols' }],
 *   space: { testId: 'osk_space' },
 *   backspace: { testId: 'osk_del' },
 *   clear: { testId: 'osk_clear' },
 *   submit: { testId: 'osk_go' },
 * });
 */
export function defineKeyboard(definition: KeyboardDefinition): KeyboardDefinition {
  if (typeof definition !== 'object' || definition === null) {
    throw invalid('defineKeyboard() takes a keyboard definition object.');
  }
  const d = definition as unknown as Record<string, unknown>;
  for (const key of Object.keys(d)) {
    if (!(DEFINITION_KEYS as readonly string[]).includes(key)) {
      throw invalid(`Keyboard definition has an unknown key '${key}'.`);
    }
  }
  if (typeof d.name !== 'string' || !d.name.trim()) {
    throw invalid('A keyboard needs a non-empty name.');
  }
  const name = d.name;
  const where = (key: string) => `Keyboard '${name}' ${key}`;
  const out: { -readonly [K in keyof KeyboardDefinition]?: KeyboardDefinition[K] } = {
    name,
    root: checkTarget(d.root, where('root')),
  };
  if (d.fields !== undefined) out.fields = checkTargets(d.fields, where('fields'));
  if (d.keys !== undefined) out.keys = checkTargets(d.keys, where('keys'));
  if (d.layers !== undefined) out.layers = checkTargets(d.layers, where('layers'));
  for (const key of ['space', 'backspace', 'clear', 'submit'] as const) {
    if (d[key] !== undefined) out[key] = checkTarget(d[key], where(key));
  }
  return Object.freeze(out as KeyboardDefinition);
}

/** Validates the `keyboards` option: definitions with unique names (`DUPLICATE_KEYBOARD`). */
export function checkKeyboards(value: unknown): readonly KeyboardDefinition[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw invalid('The keyboards option takes an array of defineKeyboard() definitions.');
  }
  const out = value.map((d) => defineKeyboard(d as KeyboardDefinition));
  const seen = new Set<string>();
  for (const d of out) {
    if (seen.has(d.name)) {
      throw new ToetsError(
        'DUPLICATE_KEYBOARD',
        `Two keyboards are named '${d.name}'; names identify keyboards in steps and errors.`,
        {
          hint: 'Give every defineKeyboard() a unique name. Each level of the keyboards option (config, project, test.use) replaces the one above, so list every keyboard once per level.',
          docs: DOCS,
        },
      );
    }
    seen.add(d.name);
  }
  return Object.freeze(out);
}

/** The selector chain of a target: `getByTestId(testId).getByText(text, { exact }).nth(nth)`. */
export function targetChain(t: ElementTarget): SelectorChain {
  const chain: Selector[] = [];
  if (t.testId !== undefined) chain.push({ kind: 'testId', value: t.testId });
  if (t.text !== undefined) {
    chain.push(
      t.exact ? { kind: 'text', value: t.text, exact: true } : { kind: 'text', value: t.text },
    );
  }
  if (t.nth !== undefined) chain.push({ kind: 'nth', index: t.nth });
  return chain;
}

const describeTarget = (t: ElementTarget) => describeChain(targetChain(t));

// ---------------------------------------------------------------------------------------------
// Reading a keyboard from one tree

interface KeyView {
  readonly el: ElementSnapshot;
  /** What pressing it types. */
  readonly chars: string;
}

interface ToggleView {
  readonly index: number;
  readonly el: ElementSnapshot;
}

/** A declared keyboard as one tree shows it. */
export interface KeyboardView {
  readonly def: KeyboardDefinition;
  readonly root: UINode;
  readonly keys: readonly KeyView[];
  readonly toggles: readonly ToggleView[];
  readonly space: ElementSnapshot | null;
  readonly backspace: ElementSnapshot | null;
  readonly clear: ElementSnapshot | null;
  readonly submit: ElementSnapshot | null;
  /** Visible focusable elements inside the keyboard: the route planner's model. */
  readonly focusables: readonly ElementSnapshot[];
  /** `lower`, `upper`, `mixed`, `digits` or `symbols`, from the character keys shown. */
  readonly layer: string;
  /** Identifies the layer: the characters shown. */
  readonly signature: string;
  /** The element holding focus inside the keyboard, if any. */
  readonly focused: ElementSnapshot | null;
}

const length = (text: string) => [...text].length;

/** Names a layer from its one-character keys. */
export function layerName(chars: readonly string[]): string {
  const singles = chars.filter((c) => length(c) === 1);
  const letters = singles.filter((c) => c.toLowerCase() !== c.toUpperCase());
  if (letters.length) {
    if (letters.every((c) => c === c.toLowerCase())) return 'lower';
    if (letters.every((c) => c === c.toUpperCase())) return 'upper';
    return 'mixed';
  }
  const digits = singles.filter((c) => /\p{Nd}/u.test(c));
  return digits.length * 2 >= singles.length && digits.length > 0 ? 'digits' : 'symbols';
}

/** Parent links of a subtree, for mapping a match to the focusable element that holds it. */
function parents(root: UINode): Map<UINode, UINode> {
  const out = new Map<UINode, UINode>();
  const visit = (node: UINode) => {
    for (const child of node.children) {
      out.set(child, node);
      visit(child);
    }
  };
  visit(root);
  return out;
}

function nodesByRef(root: UINode): Map<ElementRef, UINode> {
  const out = new Map<ElementRef, UINode>();
  for (const node of walkTree(root)) out.set(node.ref, node);
  return out;
}

/** The element focus lands on for a match: itself, its focusable ancestor or descendant. */
function pressable(node: UINode, up: ReadonlyMap<UINode, UINode>): UINode {
  if (node.focusable) return node;
  for (let p = up.get(node); p; p = up.get(p)) if (p.focusable) return p;
  for (const d of walkTree(node)) if (d.focusable) return d;
  return node;
}

/**
 * The visible matches of `def.root`. Several visible roots are a strict mode violation when
 * `strict`, else the first is used (snapshots never throw).
 */
function rootOf(tree: UITree, def: KeyboardDefinition, strict: boolean): UINode | null {
  const chain = targetChain(def.root);
  const matches = evaluateChain(tree, chain).filter((m) => m.visible);
  if (matches.length > 1 && strict) throw strictModeError(chain, matches);
  const first = matches[0];
  if (!first) return null;
  for (const node of walkTree(tree.root)) if (node.ref === first.ref) return node;
  return null;
}

/** Reads `def` from `tree`; `null` when its root is not visible (the keyboard is closed). */
export function viewKeyboard(
  tree: UITree,
  def: KeyboardDefinition,
  strict = true,
): KeyboardView | null {
  const root = rootOf(tree, def, strict);
  if (!root) return null;
  const sub: UITree = { root, viewport: tree.viewport };
  const up = parents(root);
  const byRef = nodesByRef(root);
  const resolve = (t: ElementTarget): UINode[] => {
    const out: UINode[] = [];
    for (const m of evaluateChain(sub, targetChain(t))) {
      const node = byRef.get(m.ref);
      if (!node || !node.visible) continue;
      const target = pressable(node, up);
      if (!out.includes(target)) out.push(target);
    }
    return out;
  };
  const first = (t: ElementTarget | undefined) => {
    const node = t ? resolve(t)[0] : undefined;
    return node ? toSnapshot(node) : null;
  };
  const toggles: ToggleView[] = [];
  (def.layers ?? []).forEach((t, index) => {
    const node = resolve(t)[0];
    if (node) toggles.push({ index, el: toSnapshot(node) });
  });
  const space = first(def.space);
  const backspace = first(def.backspace);
  const clear = first(def.clear);
  const submit = first(def.submit);
  const special = new Set<ElementRef>(
    [space, backspace, clear, submit, ...toggles.map((t) => t.el)].flatMap((e) =>
      e ? [e.ref] : [],
    ),
  );
  const keyNodes: UINode[] = def.keys
    ? def.keys.flatMap(resolve)
    : [...walkTree(root)].filter(
        (n) => n.focusable && n.visible && n.text !== null && length(n.text) === 1,
      );
  const keys: KeyView[] = [];
  const seen = new Set<ElementRef>();
  for (const node of keyNodes) {
    const chars = normalizeText(node.text);
    if (chars === null || special.has(node.ref) || seen.has(node.ref)) continue;
    seen.add(node.ref);
    keys.push({ el: toSnapshot(node), chars });
  }
  const chars = keys.map((k) => k.chars);
  const focusables = [...walkTree(root)].filter((n) => n.focusable && n.visible).map(toSnapshot);
  const focusedNode = [...walkTree(root)].find((n) => n.focused);
  return {
    def,
    root,
    keys,
    toggles,
    space,
    backspace,
    clear,
    submit,
    focusables,
    layer: layerName(chars),
    signature: [...chars].sort().join('\u0000'),
    focused: focusedNode ? toSnapshot(focusedNode) : null,
  };
}

/** Bracket content of a collapsed keyboard in snapshots: `keyboard: search, layer: lower`. */
export function describeKeyboardView(view: KeyboardView): string {
  const parts = [`keyboard: ${view.def.name}`, `layer: ${view.layer}`];
  const f = view.focused;
  if (f) {
    const label = f.text ?? f.testId;
    if (label !== null) parts.push(`focused: ${JSON.stringify(label)}`);
  }
  return parts.join(', ');
}

/** Refs of the visible declared keyboards in `tree`, with their snapshot line content. */
export function collapsedKeyboards(
  tree: UITree,
  defs: readonly KeyboardDefinition[],
): Map<ElementRef, string> {
  const out = new Map<ElementRef, string>();
  for (const def of defs) {
    const view = viewKeyboard(tree, def, false);
    if (view) out.set(view.root.ref, describeKeyboardView(view));
  }
  return out;
}

/** Whether `inner` is `outer` or inside it. */
function contains(tree: UITree, outer: ElementRef, inner: ElementRef): boolean {
  for (const node of walkTree(tree.root)) {
    if (node.ref !== outer) continue;
    for (const d of walkTree(node)) if (d.ref === inner) return true;
    return false;
  }
  return false;
}

/** The declared keyboard whose `fields` lists `field` (by element, or one inside the other). */
function keyboardForField(
  tree: UITree,
  defs: readonly KeyboardDefinition[],
  field: ElementSnapshot,
): KeyboardDefinition | null {
  for (const def of defs) {
    for (const t of def.fields ?? []) {
      for (const m of evaluateChain(tree, targetChain(t))) {
        // The declared field, an element inside it, or the focusable wrapping it.
        if (contains(tree, m.ref, field.ref)) return def;
        if (field.focusable && contains(tree, field.ref, m.ref)) return def;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Typing

/** What a text action did, for step annotations and MCP output. */
export interface TextEntryResult {
  /** The keyboard name, or `system`. */
  readonly via: string;
  /** Remote presses made (D-pad and SELECT), system text entry excluded. */
  readonly presses: number;
  /** The text was masked (the `mask` option, or a password field). */
  readonly masked: boolean;
}

/** How a field shows its text: the value of a system field, else its normalized text. */
function shownText(el: ElementSnapshot): string {
  return el.editable ? (el.value ?? '') : (normalizeText(el.text) ?? '');
}

const display = (text: string | null | undefined, mask: boolean) =>
  JSON.stringify(mask ? maskText(text ?? '') : (text ?? ''));

/** Whether `shown` displays `expected`: equal (whitespace-normalized), or masked of its length. */
function shows(shown: string, expected: string): boolean {
  if ((normalizeText(shown) ?? '') === (normalizeText(expected) ?? '')) return true;
  return expected !== '' && isMasked(shown) && length(shown) === length(expected);
}

/** Same element across trees: same ref and text, or same test ID and text. */
function sameElement(a: ElementSnapshot | null, b: ElementSnapshot): boolean {
  if (!a || a.text !== b.text) return false;
  return a.ref === b.ref || (b.testId !== null && a.testId === b.testId);
}

/** Re-finds a field in a fresh tree. */
type FieldFinder = (tree: UITree) => ElementSnapshot | null;

type Resolved =
  | { readonly kind: 'app'; readonly def: KeyboardDefinition; readonly view: KeyboardView }
  | { readonly kind: 'system'; readonly field: ElementSnapshot | null };

/** Text entry for one app: `fill`, `app.keyboard` and the keyboard matchers. */
export class TextEntry {
  constructor(
    readonly ctx: RuntimeContext,
    private readonly remote: RemoteImpl,
    private readonly focus: FocusImpl,
  ) {}

  private get keyboards(): readonly KeyboardDefinition[] {
    return this.ctx.keyboards;
  }

  /** Text snapshot collapse map for the declared keyboards on screen. */
  collapsed(tree: UITree): Map<ElementRef, string> {
    return collapsedKeyboards(tree, this.keyboards);
  }

  /** `search (layer: lower)`, `system`, or `null` when no keyboard is open. */
  async openKeyboard(): Promise<string | null> {
    const tree = await this.ctx.target.tree();
    const open = this.keyboards.flatMap((def) => {
      const view = viewKeyboard(tree, def, false);
      return view ? [`${def.name} (layer: ${view.layer})`] : [];
    });
    if (open.length) return open.join(', ');
    const text = this.systemText();
    if (text && (await text.isOpen())) return 'system';
    return null;
  }

  private systemText(): DriverTextInput | null {
    return this.ctx.target.capabilities.has('text.input')
      ? (this.ctx.target.driver.text ?? null)
      : null;
  }

  private requireSystem(feature: string): DriverTextInput {
    this.ctx.requireCapability('text.input', feature);
    const text = this.ctx.target.driver.text;
    if (!text) {
      throw new ToetsError(
        'DRIVER_CONTRACT',
        `The ${this.ctx.target.driver.platform} driver declares 'text.input' but has no text input.`,
        { docs: packageDocsLink('core', 'drivers') },
      );
    }
    return text;
  }

  // ----- fill

  async fill(
    locator: LocatorImpl,
    text: string,
    opts: TextEntryOptions = {},
  ): Promise<TextEntryResult> {
    if (typeof text !== 'string') {
      throw new ToetsError('INVALID_ARGUMENT', 'fill() takes the text as a string.', {
        docs: DOCS,
      });
    }
    const field = await locator.resolveOne();
    const tree = await this.ctx.target.tree();
    const def = keyboardForField(tree, this.keyboards, field);
    if (def) {
      const mask = opts.mask === true;
      const result = { via: def.name, presses: 0, masked: mask };
      await this.ctx.step(
        {
          kind: 'fill',
          title: `fill ${locator.description} ${display(text, mask)} (keyboard: ${def.name})`,
          summary: () => `${result.presses} presses`,
        },
        async () => {
          result.presses = await this.fillApp(def, locator, text, mask);
        },
      );
      return result;
    }
    if (field.editable) {
      const mask = opts.mask === true || field.secure;
      const result = { via: 'system', presses: 0, masked: mask };
      this.requireSystem('fill() on a system text field');
      await this.ctx.step(
        {
          kind: 'fill',
          title: `fill ${locator.description} ${display(text, mask)} (system)`,
          summary: () => `${result.presses} presses`,
        },
        async () => {
          result.presses = await this.fillSystem(locator, text, mask);
        },
      );
      return result;
    }
    throw new ToetsError(
      'NO_KEYBOARD',
      `fill() found no keyboard for ${locator.description} (${describeElement(field)}): it is not a system text field, and no declared keyboard lists it in fields.`,
      {
        hint: `Add the field to the fields of its keyboard: defineKeyboard({ ..., fields: [{ testId: '${field.testId ?? 'field_id'}' }] }) in the keyboards option.${this.oldSdkHint()}`,
        docs: DOCS,
      },
    );
  }

  private oldSdkHint(): string {
    const protocol = this.ctx.target.sdk?.hello.protocol;
    return protocol && /^1\.0\./.test(protocol)
      ? ` The connected SDK speaks protocol ${protocol}, which does not report system text fields: update the app's toets SDK.`
      : '';
  }

  private async fillSystem(locator: LocatorImpl, text: string, mask: boolean): Promise<number> {
    const input = this.requireSystem('fill() on a system text field');
    // A system keyboard open on another field covers the app: close it first, as a user does.
    if ((await input.isOpen()) && !(await locator.resolveOne()).focused) await input.close();
    const path = await this.focus.navigateTo(locator as unknown as Locator);
    const field = await locator.resolveOne();
    const wasOpen = await input.isOpen();
    await input.replace(field, text);
    if (!wasOpen && (await input.isOpen())) await input.close();
    await this.verify(
      async () => {
        const matches = await locator.resolve();
        return matches.length === 1 && matches[0] ? shownText(matches[0]) : null;
      },
      text,
      mask,
      { action: 'fill', via: 'system', presses: path.length, field: locator.description },
    );
    return path.length;
  }

  private async fillApp(
    def: KeyboardDefinition,
    locator: LocatorImpl,
    text: string,
    mask: boolean,
  ): Promise<number> {
    let presses = 0;
    let tree = await this.ctx.target.tree();
    if (!viewKeyboard(tree, def)) {
      presses += (await this.focus.navigateTo(locator as unknown as Locator)).length;
      await this.remote.press(Key.SELECT);
      presses++;
      const opened = await this.ctx.retry(async () => {
        tree = await this.ctx.target.tree();
        return { ok: viewKeyboard(tree, def) !== null, value: null };
      }, this.ctx.timeouts.actionMs);
      if (!opened.ok) {
        throw new ToetsError(
          'NO_KEYBOARD',
          `SELECT on ${locator.description} did not open keyboard '${def.name}' (${describeTarget(def.root)}) within ${this.ctx.timeouts.actionMs}ms.`,
          {
            hint: "Check that SELECT on the field opens the keyboard and that the keyboard's root target matches it (app.snapshot()).",
            docs: DOCS,
          },
        );
      }
    }
    const finder: FieldFinder = (t) => {
      const matches = evaluateChain(t, locator.chain);
      return matches.length === 1 ? (matches[0] ?? null) : null;
    };
    const typist = new Typist(this, def, finder, mask, locator.description);
    await typist.clearField();
    await typist.type(text);
    await this.verify(
      async () => {
        const el = finder(await this.ctx.target.tree());
        return el ? shownText(el) : null;
      },
      text,
      mask,
      {
        action: 'fill',
        via: def.name,
        presses: presses + typist.presses,
        field: locator.description,
      },
    );
    return presses + typist.presses;
  }

  /** Waits until the field shows `expected`; `TEXT_NOT_ENTERED` otherwise. */
  async verify(
    read: () => Promise<string | null>,
    expected: string,
    mask: boolean,
    info: { action: string; via: string; presses: number; field: string },
    test: (shown: string) => boolean = (shown) => shows(shown, expected),
  ): Promise<void> {
    const result = await this.ctx.retry(async () => {
      const shown = await read();
      return { ok: shown !== null && test(shown), value: shown };
    }, this.ctx.timeouts.actionMs);
    if (result.ok) return;
    const shown = result.value;
    const how = info.via === 'system' ? 'system text entry' : `keyboard '${info.via}'`;
    throw new ToetsError(
      'TEXT_NOT_ENTERED',
      `${info.action} entered ${display(expected, mask)} with ${how} (${info.presses} presses), but ${info.field} shows ${
        shown === null || shown === undefined
          ? 'no single element'
          : display(shown, mask && !isMasked(shown))
      } after ${this.ctx.timeouts.actionMs}ms.`,
      {
        hint:
          info.via === 'system'
            ? 'The platform did not put the text into the field. Check that the field is enabled and not read-only, and that the app does not rewrite its value (formatting, max length).'
            : 'A press landed on the wrong key or the app dropped it. Check the keyboard definition (keys, layers) against app.snapshot(); a placeholder shown inside the field element reads as text, so keep placeholders outside it.',
        docs: DOCS,
      },
    );
  }

  // ----- app.keyboard

  /**
   * The keyboard `app.keyboard` acts on, waiting up to `actionMs` for one like other actions
   * wait for their element (focus returning to a field after its system keyboard closed).
   */
  async resolve(action: string): Promise<Resolved> {
    const found = await this.ctx.retry(async () => {
      try {
        return { ok: true, value: await this.resolveNow(action) };
      } catch (e) {
        if (e instanceof ToetsError && e.code === 'NO_KEYBOARD') return { ok: false, value: null };
        throw e;
      }
    }, this.ctx.timeouts.actionMs);
    return found.ok && found.value ? found.value : this.resolveNow(action);
  }

  private async resolveNow(action: string): Promise<Resolved> {
    const tree = await this.ctx.target.tree();
    const focused = focusedIn(tree);
    const views = this.keyboards.flatMap((def) => {
      const view = viewKeyboard(tree, def);
      return view ? [view] : [];
    });
    const holding = views.find((v) => v.root.focusWithin);
    if (holding) return { kind: 'app', def: holding.def, view: holding };
    if (focused?.editable) return { kind: 'system', field: focused };
    const system = this.systemText();
    if (system && (await system.isOpen())) return { kind: 'system', field: focused };
    const only = views.length === 1 ? views[0] : undefined;
    if (only) return { kind: 'app', def: only.def, view: only };
    if (views.length > 1) {
      throw new ToetsError(
        'AMBIGUOUS_KEYBOARD',
        `app.keyboard.${action}: keyboards ${views.map((v) => `'${v.def.name}'`).join(', ')} are on screen and none holds focus. Focus is on ${describeElement(focused)}.`,
        {
          hint: 'Move focus into the keyboard you mean (app.focus.navigateTo), or use fill() on its field.',
          docs: DOCS,
        },
      );
    }
    throw new ToetsError(
      'NO_KEYBOARD',
      `app.keyboard.${action}: no keyboard is open. Focus is on ${describeElement(focused)}, which is not a system text field, and no declared keyboard is on screen.`,
      {
        hint: `Open the keyboard first, e.g. await field.fill('') or SELECT on the field. App-drawn keyboards must be declared with defineKeyboard() in the keyboards option${this.keyboards.length ? ` (declared: ${this.keyboards.map((k) => k.name).join(', ')})` : ''}.${this.oldSdkHint()}`,
        docs: DOCS,
      },
    );
  }

  /** The single visible field of `def.fields` in `tree`. */
  private declaredField(def: KeyboardDefinition): FieldFinder | null {
    if (!def.fields?.length) return null;
    const fields = def.fields;
    return (tree) => {
      const matches = fields.flatMap((t) =>
        evaluateChain(tree, targetChain(t)).filter((m) => m.visible),
      );
      return matches.length === 1 ? (matches[0] ?? null) : null;
    };
  }

  async type(text: string, opts: TextEntryOptions = {}): Promise<TextEntryResult> {
    if (typeof text !== 'string') {
      throw new ToetsError('INVALID_ARGUMENT', 'app.keyboard.type() takes the text as a string.', {
        docs: DOCS,
      });
    }
    const target = await this.resolve('type');
    if (target.kind === 'app') {
      const mask = opts.mask === true;
      const result = { via: target.def.name, presses: 0, masked: mask };
      await this.ctx.step(
        {
          kind: 'type',
          title: `type ${display(text, mask)} (keyboard: ${target.def.name})`,
          summary: () => `${result.presses} presses`,
        },
        async () => {
          const finder = this.declaredField(target.def);
          const before = finder ? finder(await this.ctx.target.tree()) : null;
          const typist = new Typist(this, target.def, finder, mask, 'the field');
          await typist.type(text);
          result.presses = typist.presses;
          if (finder && before) {
            const was = shownText(before);
            await this.verify(
              async () => {
                const el = finder(await this.ctx.target.tree());
                return el ? shownText(el) : null;
              },
              was + text,
              mask,
              {
                action: 'type',
                via: target.def.name,
                presses: typist.presses,
                field: describeElement(before),
              },
              (shown) =>
                shows(shown, was + text) ||
                (!was.length || !shown.startsWith(was) ? shown.endsWith(text) : false) ||
                (isMasked(shown) && length(shown) === length(was) + length(text)),
            );
          }
        },
      );
      return result;
    }
    const input = this.requireSystem('app.keyboard.type() on a system text field');
    const mask = opts.mask === true || (target.field?.secure ?? false);
    await this.ctx.step(
      { kind: 'type', title: `type ${display(text, mask)} (system)` },
      async () => {
        const before = target.field?.editable ? target.field : null;
        await input.insert(text, before);
        if (before) await this.verifySystemLength(before, length(text), 'type', text, mask);
      },
    );
    return { via: 'system', presses: 0, masked: mask };
  }

  /** Waits until the focused field's value has `delta` more characters than `before`. */
  private async verifySystemLength(
    before: ElementSnapshot,
    delta: number,
    action: string,
    text: string,
    mask: boolean,
  ): Promise<void> {
    const was = before.value ?? '';
    const want = Math.max(0, length(was) + delta);
    await this.verify(
      async () => {
        const f = await this.ctx.target.focused();
        return f?.editable ? (f.value ?? '') : null;
      },
      text,
      mask,
      { action, via: 'system', presses: 0, field: describeElement(before) },
      (shown) => length(shown) === want && (delta <= 0 || mask || shown.includes(text)),
    );
  }

  async erase(count = 1): Promise<TextEntryResult> {
    if (!Number.isInteger(count) || count < 1) {
      throw new ToetsError(
        'INVALID_ARGUMENT',
        `app.keyboard.erase() takes a positive integer count, got ${count}.`,
        { docs: DOCS },
      );
    }
    const target = await this.resolve('erase');
    if (target.kind === 'app') {
      const backspace = this.actionKey(target.def, 'backspace', 'erase');
      const result = { via: target.def.name, presses: 0, masked: false };
      await this.ctx.step(
        {
          kind: 'erase',
          title: `erase ${count} (keyboard: ${target.def.name})`,
          summary: () => `${result.presses} presses`,
        },
        async () => {
          const typist = new Typist(this, target.def, this.declaredField(target.def), false, '');
          for (let i = 0; i < count; i++) await typist.pressAction(backspace, 'backspace');
          result.presses = typist.presses;
        },
      );
      return result;
    }
    const input = this.requireSystem('app.keyboard.erase() on a system text field');
    await this.ctx.step({ kind: 'erase', title: `erase ${count} (system)` }, async () => {
      const before = target.field?.editable ? target.field : null;
      await input.deleteBackward(count, before);
      if (before) await this.verifySystemLength(before, -count, 'erase', '', before.secure);
    });
    return { via: 'system', presses: 0, masked: false };
  }

  async submit(): Promise<TextEntryResult> {
    const target = await this.resolve('submit');
    if (target.kind === 'app') {
      const key = this.actionKey(target.def, 'submit', 'submit');
      const result = { via: target.def.name, presses: 0, masked: false };
      await this.ctx.step(
        {
          kind: 'submit',
          title: `submit (keyboard: ${target.def.name})`,
          summary: () => `${result.presses} presses`,
        },
        async () => {
          const typist = new Typist(this, target.def, null, false, '');
          await typist.pressAction(key, 'submit');
          result.presses = typist.presses;
        },
      );
      return result;
    }
    const input = this.requireSystem('app.keyboard.submit() on a system text field');
    const field = target.field?.editable ? target.field : null;
    await this.ctx.step({ kind: 'submit', title: 'submit (system)' }, () => input.submit(field));
    return { via: 'system', presses: 0, masked: false };
  }

  /** The declared target of an action key; `KEYBOARD_ACTION_MISSING` when not declared. */
  actionKey(
    def: KeyboardDefinition,
    key: 'backspace' | 'clear' | 'submit',
    action: string,
  ): ElementTarget {
    const target = def[key];
    if (target) return target;
    throw new ToetsError(
      'KEYBOARD_ACTION_MISSING',
      `${action} needs the ${key} key of keyboard '${def.name}', which its definition does not declare.`,
      {
        hint: `Add it to the definition: defineKeyboard({ name: '${def.name}', ..., ${key}: { testId: '...' } }).`,
        docs: DOCS,
      },
    );
  }

  // ----- shared with Typist

  get runtime(): RuntimeContext {
    return this.ctx;
  }

  get remoteImpl(): RemoteImpl {
    return this.remote;
  }

  get focusImpl(): FocusImpl {
    return this.focus;
  }
}

/** One text action on an app keyboard: D-pad walks and SELECT, with a press count. */
class Typist {
  presses = 0;

  constructor(
    private readonly entry: TextEntry,
    private readonly def: KeyboardDefinition,
    private readonly field: FieldFinder | null,
    private readonly mask: boolean,
    private readonly fieldName: string,
  ) {}

  private get ctx(): RuntimeContext {
    return this.entry.runtime;
  }

  private async read(): Promise<{ tree: UITree; view: KeyboardView }> {
    const tree = await this.ctx.target.tree();
    const view = viewKeyboard(tree, this.def);
    if (view) return { tree, view };
    throw new ToetsError(
      'NO_KEYBOARD',
      `Keyboard '${this.def.name}' (${describeTarget(this.def.root)}) closed while typing.`,
      {
        hint: 'A key press closed the keyboard or left the screen. Check the screen in app.snapshot() and the key targets of the definition.',
        docs: DOCS,
      },
    );
  }

  private shown(tree: UITree): string | null {
    const el = this.field?.(tree);
    return el ? shownText(el) : null;
  }

  /** Types `text` key by key, switching layers when a character is not shown. */
  async type(text: string): Promise<void> {
    let rest = text;
    while (rest.length) {
      const read = await this.read();
      const at = matchKey(read.view, rest);
      // After layer toggles, walk on the tree that shows the key's layer.
      const { key, tree, view } = at ? { key: at, ...read } : await this.findLayer(rest, read.view);
      const chars = key.chars;
      const label = this.mask ? 'key •' : `key ${JSON.stringify(chars)}`;
      await this.press(key.el, label, tree, view, 'field');
      rest = rest.slice(chars.length);
    }
  }

  /** Empties the field: the clear key, else backspace once per character shown. */
  async clearField(): Promise<void> {
    const { tree } = await this.read();
    const shown = this.shown(tree);
    if (shown === '') return;
    if (this.def.clear) {
      await this.pressAction(this.def.clear, 'clear');
      return;
    }
    if (!this.def.backspace) {
      this.entry.actionKey(this.def, 'clear', 'fill');
    }
    const backspace = this.def.backspace as ElementTarget;
    const count = shown === null ? 0 : length(shown);
    for (let i = 0; i < count; i++) {
      const changed = await this.pressAction(backspace, 'backspace');
      if (!changed) break;
    }
  }

  /** Navigates to a declared action key and presses SELECT. Whether the field changed. */
  async pressAction(
    target: ElementTarget,
    name: 'backspace' | 'clear' | 'submit',
  ): Promise<boolean> {
    const { tree, view } = await this.read();
    const el = view[name];
    if (!el) {
      throw new ToetsError(
        'KEYBOARD_ACTION_MISSING',
        `Keyboard '${this.def.name}' declares ${name} as ${describeTarget(target)}, but it is not on screen.`,
        {
          hint: `Check the ${name} target against app.snapshot(); it resolves inside the keyboard root.`,
          docs: DOCS,
        },
      );
    }
    const label = `key ${JSON.stringify(el.text ?? el.testId ?? name)}`;
    return this.press(el, label, tree, view, name === 'submit' ? 'idle' : 'field');
  }

  /**
   * One key: walk to it, SELECT, then wait for the effect (`field`: the field text changes;
   * `layer`: the keys change; `idle`: the app settles). Whether the awaited change happened.
   */
  private async press(
    el: ElementSnapshot,
    label: string,
    tree: UITree,
    view: KeyboardView,
    effect: 'field' | 'layer' | 'idle',
  ): Promise<boolean> {
    return this.ctx.step({ kind: 'key', title: label }, async () => {
      await this.moveTo(el, label, tree, view);
      const before = effect === 'layer' ? view.signature : this.shown(tree);
      await this.entry.remoteImpl.press(Key.SELECT);
      this.presses++;
      if (effect === 'idle' || (effect === 'field' && before === null)) {
        // Nothing to watch: let the app react before the next tree read.
        const idle = await this.ctx.target.waitForIdle(this.ctx.idle.budgetMs);
        if (!idle.supported) await sleep(2 * POLL_MS);
        return true;
      }
      return this.waitForChange(async () => {
        const t = await this.ctx.target.tree();
        if (effect === 'field') return this.shown(t);
        return viewKeyboard(t, this.def)?.signature ?? null;
      }, before);
    });
  }

  /** Polls `read` until it differs from `before`, up to `navigationSettleMs`. */
  private async waitForChange(
    read: () => Promise<string | null>,
    before: string | null,
  ): Promise<boolean> {
    const settleMs = this.ctx.timeouts.navigationSettleMs;
    const deadline = performance.now() + settleMs;
    await this.ctx.target.waitForIdle(settleMs);
    for (;;) {
      if ((await read()) !== before) return true;
      if (performance.now() >= deadline) return false;
      await sleep(POLL_MS);
    }
  }

  /**
   * Moves focus to `el`: a walk planned from the tree and pressed at once, verified by reading
   * focus; on a wrong prediction, step-by-step navigation from wherever focus landed.
   */
  private async moveTo(
    el: ElementSnapshot,
    label: string,
    tree: UITree,
    view: KeyboardView,
  ): Promise<void> {
    // Focus read now, not from `tree`: the app may have moved it since (a dialog resetting
    // focus after an error), and a walk planned from a stale start misses.
    const focused = await this.ctx.target.focused();
    if (sameElement(focused, el)) return;
    if (focused && view.focusables.some((f) => f.ref === focused.ref)) {
      const nodes = view.focusables.map((f) => ({ id: f.ref, bounds: f.bounds }));
      const route = planRoute(nodes, focused.ref, el.ref);
      if (route && route.length) {
        for (const d of route) {
          await this.entry.remoteImpl.press(DIRECTION_KEY[d]);
          this.presses++;
        }
        if (await this.focusLands(el)) return;
        this.ctx.log(
          `keyboard '${this.def.name}': planned walk ${route.join(', ')} to ${label} missed; navigating step by step`,
        );
      }
    }
    const goal: NavigationGoal = {
      description: label,
      resolveOne: () => this.locate(el),
    };
    this.presses += (await this.entry.focusImpl.navigateToGoal(goal)).length;
  }

  /**
   * Whether focus lands on `el` within `navigationSettleMs`. Polls focus without waiting for
   * idle: the walk is shortest, so it passes `el` only at its end.
   */
  private async focusLands(el: ElementSnapshot): Promise<boolean> {
    const deadline = performance.now() + this.ctx.timeouts.navigationSettleMs;
    for (;;) {
      if (sameElement(await this.ctx.target.focused(), el)) return true;
      if (performance.now() >= deadline) return false;
      await sleep(POLL_MS);
    }
  }

  /** `el` in a fresh tree: same ref and text, else same test ID and text inside the keyboard. */
  private async locate(el: ElementSnapshot): Promise<ElementSnapshot> {
    const result = await this.ctx.retry(async () => {
      const { view } = await this.read();
      const all = [...walkTree(view.root)].map(toSnapshot);
      const found =
        all.find((n) => n.ref === el.ref && n.text === el.text) ??
        all.find((n) => n.testId !== null && n.testId === el.testId && n.text === el.text);
      return { ok: !!found, value: found };
    }, this.ctx.timeouts.actionMs);
    if (result.ok && result.value) return result.value;
    throw new ToetsError(
      'ELEMENT_NOT_FOUND',
      `Key ${describeElement(el)} of keyboard '${this.def.name}' left the screen.`,
      {
        hint: 'The keyboard changed layer or closed while focus moved to the key. Check app.snapshot().',
        docs: DOCS,
      },
    );
  }

  /**
   * Presses the declared layer toggles until a key for the start of `rest` shows. Explores the
   * toggles as a graph of layers (each toggle tried once per layer), so it always ends.
   */
  private async findLayer(
    rest: string,
    first: KeyboardView,
  ): Promise<{ key: KeyView; tree: UITree; view: KeyboardView }> {
    // The app may still be switching layers after the last key (one-shot Shift).
    await this.ctx.target.waitForIdle(this.ctx.idle.budgetMs);
    let { tree, view } = await this.read();
    const seen = new Set([first.layer, view.layer]);
    const moves = new Map<string, Map<number, string>>();
    const toggleSets = new Map<string, readonly ToggleView[]>();
    for (let attempt = 0; ; attempt++) {
      const key = matchKey(view, rest);
      if (key) return { key, tree, view };
      seen.add(view.layer);
      toggleSets.set(view.signature, view.toggles);
      const tried = moves.get(view.signature) ?? new Map<number, string>();
      moves.set(view.signature, tried);
      const toggle =
        view.toggles.find((t) => !tried.has(t.index)) ??
        stepToward(view.signature, moves, toggleSets, view.toggles);
      if (!toggle || attempt >= MAX_LAYER_PRESSES) throw this.charMissing(rest, seen);
      const from = view.signature;
      const name = describeElement(toggle.el);
      await this.press(
        toggle.el,
        `key ${JSON.stringify(toggle.el.text ?? name)}`,
        tree,
        view,
        'layer',
      );
      ({ tree, view } = await this.read());
      tried.set(toggle.index, view.signature);
      if (from === view.signature) this.ctx.log(`toggle ${name} did not change the layer`);
    }
  }

  private charMissing(rest: string, layers: ReadonlySet<string>): ToetsError {
    const char = [...rest][0] ?? rest;
    return new ToetsError(
      'CHAR_NOT_ON_KEYBOARD',
      `Keyboard '${this.def.name}' has no key for ${this.mask ? 'a masked character' : JSON.stringify(char)} on any layer reached (${[...layers].join(', ')}).`,
      {
        hint: 'Declare the layer toggles (layers), and keys whose text is not one character (keys, space). Check the keys in app.snapshot() on each layer.',
        docs: DOCS,
      },
    );
  }
}

/** The longest key whose text starts `rest`; the space key for a leading space. */
function matchKey(view: KeyboardView, rest: string): KeyView | null {
  let best: KeyView | null = null;
  for (const key of view.keys) {
    if (rest.startsWith(key.chars) && (!best || key.chars.length > best.chars.length)) best = key;
  }
  if (!best && rest.startsWith(' ') && view.space) return { el: view.space, chars: ' ' };
  return best;
}

/** First toggle on the shortest known path to a layer that still has an untried toggle. */
function stepToward(
  from: string,
  moves: ReadonlyMap<string, ReadonlyMap<number, string>>,
  toggleSets: ReadonlyMap<string, readonly ToggleView[]>,
  here: readonly ToggleView[],
): ToggleView | null {
  const hasUntried = (sig: string) => {
    const set = toggleSets.get(sig);
    if (!set) return true; // never seen: unexplored
    const tried = moves.get(sig);
    return set.some((t) => !tried?.has(t.index));
  };
  const queue: { sig: string; first: number | null }[] = [{ sig: from, first: null }];
  const seen = new Set([from]);
  while (queue.length) {
    const { sig, first } = queue.shift() as { sig: string; first: number | null };
    for (const [index, next] of moves.get(sig) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      const step = first ?? index;
      if (hasUntried(next)) return here.find((t) => t.index === step) ?? null;
      queue.push({ sig: next, first: step });
    }
  }
  return null;
}

/**
 * `app.keyboard`.
 *
 * @internal
 */
export class KeyboardImpl implements Keyboard {
  constructor(readonly entry: TextEntry) {}

  get ctx(): RuntimeContext {
    return this.entry.runtime;
  }

  async type(text: string, opts?: TextEntryOptions): Promise<void> {
    await this.entry.type(text, opts);
  }

  async erase(count?: number): Promise<void> {
    await this.entry.erase(count);
  }

  async submit(): Promise<void> {
    await this.entry.submit();
  }
}

/**
 * The text entry behind `app.keyboard`, or `null` for anything else.
 *
 * @internal
 */
export function keyboardImpl(value: unknown): KeyboardImpl | null {
  return value instanceof KeyboardImpl ? value : null;
}
