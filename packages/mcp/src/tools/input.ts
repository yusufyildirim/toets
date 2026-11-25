import { Key, TOETS_KEYS, type AppRuntime, type DirectionKey } from '@toets/core';
import { settleFocus } from '@toets/core/runner';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { locate, locatorCode } from '../locate.js';
import { focusLine, guarded, keySchema, targetSchema, text, type ToolContext } from './shared.js';

export function registerInputTools(server: McpServer, { session }: ToolContext): void {
  server.registerTool(
    'press',
    {
      title: 'Press remote keys',
      description: [
        'Press TV remote keys in order, like a user. This is the only way to interact: there is no click, tap, hover, type or scroll.',
        'UP/DOWN/LEFT/RIGHT move focus, SELECT activates the focused element, BACK goes back. Other keys depend on the platform (see `capabilities`); key overrides from the config apply, as in tests.',
        'Every key is checked before the first press. Returns where focus landed once it settled, and the matching test code. To reach a known element prefer `press_until_focused` (or `navigate_to`); use `press` for single steps and SELECT.',
      ].join(' '),
      inputSchema: z.object({
        keys: z
          .array(keySchema)
          .min(1)
          .max(50)
          .describe('Keys to press in order, e.g. ["DOWN", "DOWN", "SELECT"].'),
        holdMs: z
          .number()
          .int()
          .positive()
          .max(10_000)
          .optional()
          .describe('Hold each key this long (long press). Needs `key.longpress`.'),
        snapshot: z
          .boolean()
          .optional()
          .describe('Also return a text snapshot of the screen after pressing.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ keys, holdMs, snapshot }) =>
      guarded(() =>
        session.exclusive(async () => {
          const { runtime } = session.launched();
          for (const key of keys) {
            const error = runtime.checkKey(key, holdMs === undefined ? undefined : { holdMs });
            if (error) throw error;
          }
          const before = await runtime.target.focused();
          await press(runtime, keys, holdMs);
          // Like navigateTo between presses: until idle, focus moved, or the settle time passed.
          await settleFocus(runtime.target, before?.ref, runtime.timeouts.navigationSettleMs);
          const after = await runtime.target.focused();
          const onlyToets = keys.every((k) => TOETS_KEYS.includes(k));
          const stuck = onlyToets && before !== null && after?.ref === before.ref;
          return text(
            `Pressed ${keys.join(', ')}.`,
            focusLine(after),
            ...(stuck
              ? ['Focus did not move: edge of the screen, a blocked direction, or a focus trap.']
              : []),
            `Code: ${pressCode(keys, holdMs)}`,
            ...(snapshot ? ['', await runtime.snapshot()] : []),
          );
        }),
      ),
  );

  server.registerTool(
    'press_until_focused',
    {
      title: 'Press a direction until an element is focused',
      description: [
        'Press one D-pad direction until an element (or one of its descendants) is focused, reading focus after every press: exactly `app.focus.pressUntilFocused(key, locator)` from a test. The preferred way to reach an element: the app decides where each press goes, toets only checks.',
        'The element may not exist yet (virtualized lists render items as focus approaches). Fails fast with FOCUS_STUCK when a press does not move focus, FOCUS_LOOP when focus comes back to an element it left, FOCUS_UNREACHABLE after maxPresses; the message lists the elements focus passed.',
        'Then `press` SELECT to activate the element.',
      ].join(' '),
      inputSchema: z.object({
        key: z
          .enum([Key.UP, Key.DOWN, Key.LEFT, Key.RIGHT])
          .describe('The direction to press, e.g. "RIGHT" along a rail, "DOWN" through a menu.'),
        target: targetSchema,
        maxPresses: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe('Give up after this many presses. Default 50.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ key, target, maxPresses }) =>
      guarded(() =>
        session.exclusive(async () => {
          const { runtime } = session.launched();
          const locator = locate(runtime.app, target);
          const presses = await runtime.app.focus.pressUntilFocused(
            key as DirectionKey,
            locator,
            maxPresses === undefined ? undefined : { maxPresses },
          );
          const options = maxPresses === undefined ? '' : `, { maxPresses: ${maxPresses} }`;
          return text(
            presses === 0
              ? 'Already focused; no presses needed.'
              : `Focused after ${presses} ${key} press${presses === 1 ? '' : 'es'}.`,
            focusLine(await runtime.target.focused()),
            `Code: await app.focus.pressUntilFocused(Key.${key}, ${locatorCode(locator)}${options});`,
          );
        }),
      ),
  );

  server.registerTool(
    'navigate_to',
    {
      title: 'Navigate focus to element',
      description: [
        'Move focus to an element on screen with real D-pad presses and report the path: exactly `app.focus.navigateTo(locator)` from a test. Each press is aimed by element geometry and checked by reading focus; presses that do not move focus are learned and detoured around.',
        'Use it when the way there is not one direction; for one direction prefer `press_until_focused`, which fails faster and clearer. Then `press` SELECT to activate the element.',
        'Done when the element or one of its descendants is focused. Fails with the reason when the element is missing (TV lists are virtualized: use `press_until_focused` toward offscreen items) or unreachable.',
      ].join(' '),
      inputSchema: z.object({
        target: targetSchema,
        maxPresses: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe('Give up after this many presses. Default 50.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ target, maxPresses }) =>
      guarded(() =>
        session.exclusive(async () => {
          const { runtime } = session.launched();
          const locator = locate(runtime.app, target);
          const path = await runtime.app.focus.navigateTo(
            locator,
            maxPresses === undefined ? undefined : { maxPresses },
          );
          const options = maxPresses === undefined ? '' : `, { maxPresses: ${maxPresses} }`;
          return text(
            path.length === 0
              ? 'Already focused; no presses needed.'
              : `Focused after ${path.length} press${path.length === 1 ? '' : 'es'}: ${path.join(', ')}.`,
            focusLine(await runtime.target.focused()),
            `Code: await app.focus.navigateTo(${locatorCode(locator)}${options});`,
          );
        }),
      ),
  );
}

/** Presses `keys` through the core remote, with the call `pressCode` reports. */
async function press(runtime: AppRuntime, keys: readonly Key[], holdMs?: number): Promise<void> {
  const remote = runtime.app.remote;
  const [first] = keys;
  if (first === undefined) return;
  if (holdMs !== undefined) {
    for (const key of keys) await remote.longPress(key, holdMs);
  } else if (keys.length === 1) {
    await remote.press(first);
  } else if (keys.every((key) => key === first)) {
    await remote.repeat(first, keys.length);
  } else {
    await remote.sequence(keys);
  }
}

/** The `app.remote` call a test would make for these presses. */
function pressCode(keys: readonly Key[], holdMs: number | undefined): string {
  const k = (key: Key): string => `Key.${key}`;
  const [first] = keys;
  if (first === undefined) return '';
  if (holdMs !== undefined) {
    return keys.map((key) => `await app.remote.longPress(${k(key)}, ${holdMs});`).join(' ');
  }
  if (keys.length === 1) return `await app.remote.press(${k(first)});`;
  if (keys.every((key) => key === first)) {
    return `await app.remote.repeat(${k(first)}, ${keys.length});`;
  }
  return `await app.remote.sequence([${keys.map(k).join(', ')}]);`;
}
