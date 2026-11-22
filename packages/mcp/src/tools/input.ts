import { DPAD_KEYS, type Key } from '@dpad-tv/core';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { targetToCode } from '../runtime/target.js';
import { describeElement } from '../runtime/text-snapshot.js';
import { focusLine, guarded, keySchema, targetSchema, text, type ToolContext } from './shared.js';

export function registerInputTools(server: McpServer, { session }: ToolContext): void {
  server.registerTool(
    'press',
    {
      title: 'Press remote keys',
      description: [
        'Press TV remote keys in order, like a user. This is the only way to interact: there is no click, tap, hover, type or scroll.',
        'UP/DOWN/LEFT/RIGHT move focus, SELECT activates the focused element, BACK goes back. Other keys depend on the platform (see `capabilities`).',
        'Returns where focus landed and the matching test code. To reach a known element prefer `navigate_to`; use `press` for single steps and SELECT.',
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
          const runtime = session.launchedRuntime();
          const before = await runtime.focused();
          await runtime.press(keys, holdMs === undefined ? {} : { holdMs });
          const after = await runtime.focused();
          const onlyDpad = keys.every((k) => DPAD_KEYS.includes(k));
          const stuck = onlyDpad && before !== null && after?.ref === before.ref;
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
    'navigate_to',
    {
      title: 'Navigate focus to element',
      description: [
        'Move focus to an element with real D-pad presses, choosing directions from element geometry, and report the path.',
        'Use it to reach a known element instead of guessing presses, then `press` SELECT to activate it.',
        'Done when the element or one of its descendants is focused. Fails with the reason when the element is missing (TV lists are virtualized: move toward offscreen items first) or unreachable.',
        'In a test: `await app.focus.navigateTo(locator)`.',
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
          const runtime = session.launchedRuntime();
          const result = await runtime.navigateTo(target, { maxPresses: maxPresses ?? 50 });
          return text(
            result.presses === 0
              ? 'Already focused; no presses needed.'
              : `Focused after ${result.presses} press${result.presses === 1 ? '' : 'es'}; path: ${result.path.join(' ')}.`,
            `Focus: ${describeElement(result.focused)}`,
            `Code: await app.focus.navigateTo(${targetToCode(target)});`,
          );
        }),
      ),
  );
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
