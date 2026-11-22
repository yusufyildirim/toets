import { DpadError, docsLink } from '@dpad-tv/core';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { assertionToCode, MATCHERS } from '../runtime/matchers.js';
import { targetToCode } from '../runtime/target.js';
import { describeElement } from '../runtime/text-snapshot.js';
import { failure, guarded, targetSchema, text, type ToolContext } from './shared.js';

export function registerInspectTools(server: McpServer, { session }: ToolContext): void {
  server.registerTool(
    'snapshot',
    {
      title: 'Text snapshot of the screen',
      description: [
        'Read the current screen as a YAML text snapshot: visible elements with test IDs, text and state ([focused], [focus-within], [selected], [disabled], [busy], [offscreen]).',
        'Use it to see what is on screen and where focus is before deciding what to press. Cheap and deterministic: prefer it over `screenshot`.',
        'Wrappers without a test ID, focusability or text are collapsed. Pass `target` to read one subtree.',
      ].join(' '),
      inputSchema: z.object({ target: targetSchema.optional() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ target }) =>
      guarded(() =>
        session.exclusive(async () => {
          const runtime = session.launchedRuntime();
          const yaml = await runtime.snapshot(target);
          const focused = await runtime.focused();
          return text(...(focused ? [] : ['# no element has focus']), yaml);
        }),
      ),
  );

  server.registerTool(
    'screenshot',
    {
      title: 'Screenshot',
      description: [
        'PNG screenshot of the screen, or of one element when the target has `screenshot.element`.',
        'Use only for visual questions (layout, images, colors, how the focus ring looks). To read text, test IDs and focus use `snapshot`.',
      ].join(' '),
      inputSchema: z.object({ target: targetSchema.optional() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ target }) =>
      guarded(() =>
        session.exclusive(async () => {
          const png = await session.launchedRuntime().screenshot(target);
          return {
            content: [
              { type: 'image', data: Buffer.from(png).toString('base64'), mimeType: 'image/png' },
            ],
          };
        }),
      ),
  );

  server.registerTool(
    'query',
    {
      title: 'Find elements',
      description: [
        'Find elements by test ID and/or text; reports every match with its state and bounds, and the locator a test should use.',
        'Use it to check a selector before writing it into a test: a locator must match exactly one element.',
        'Reports the screen as it is now, without waiting (use `assert` to wait for something).',
      ].join(' '),
      inputSchema: z.object({ target: targetSchema }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ target }) =>
      guarded(() =>
        session.exclusive(async () => {
          const matches = await session.launchedRuntime().query(target);
          const code = targetToCode(target);
          if (!matches.length) {
            return text(
              `No element matches ${code}.`,
              'Check `snapshot`. Offscreen items in virtualized lists do not exist until focus moves near them.',
            );
          }
          const lines = matches.map((el, i) => {
            const b = el.bounds;
            return `[${i}] ${describeElement(el)}  (bounds ${b.x},${b.y} ${b.width}x${b.height})`;
          });
          const [only] = matches;
          const advice =
            matches.length === 1
              ? `Locator: ${code} matches exactly one element.`
              : `Locator ${code} is ambiguous; use a test ID${
                  matches.some((m) => m.testId) ? ' (listed above)' : ''
                }, \`exact\`, or \`nth\`.`;
          return text(
            `${matches.length} match${matches.length === 1 ? '' : 'es'} for ${code}:`,
            ...lines,
            only && matches.length === 1 && only.testId && target.testId === undefined
              ? `${advice} Prefer the test ID: app.getByTestId('${only.testId}').`
              : advice,
          );
        }),
      ),
  );

  server.registerTool(
    'assert',
    {
      title: 'Assert like a test',
      description: [
        'Check a condition exactly as a dpad test would, retrying until it holds or the timeout passes: toBeVisible, toBeFocused, toHaveText, toContainText, optionally negated with `not`.',
        'Use it to confirm an assertion before writing it; the result includes the test code line. Fails when the target matches more than one element.',
        'TV trap: after pressing keys, assert focus with toBeFocused instead of assuming the press moved it.',
      ].join(' '),
      inputSchema: z.object({
        target: targetSchema,
        matcher: z.enum(MATCHERS),
        expected: z
          .string()
          .optional()
          .describe(
            'Expected text. Required for toHaveText (full text) and toContainText (substring).',
          ),
        not: z
          .boolean()
          .optional()
          .describe('Negate the matcher, like `expect(x).not.toBeVisible()`.'),
        timeoutMs: z
          .number()
          .int()
          .min(0)
          .max(60_000)
          .optional()
          .describe('How long to retry. Default from config (5000).'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ target, matcher, expected, not, timeoutMs }) =>
      guarded(() =>
        session.exclusive(async () => {
          const runtime = session.launchedRuntime();
          const textMatcher = matcher === 'toHaveText' || matcher === 'toContainText';
          if (textMatcher && expected === undefined) {
            throw new DpadError('MCP_BAD_INPUT', `${matcher} needs \`expected\` text.`, {
              hint: 'Pass `expected`, e.g. { "matcher": "toHaveText", "expected": "Home" }.',
              docs: docsLink('mcp/tools'),
            });
          }
          const assertion = { matcher, expected, not };
          const code = assertionToCode(assertion, targetToCode(target));
          const result = await runtime.assert(
            target,
            assertion,
            timeoutMs ?? session.expectTimeoutMs,
          );
          return result.pass
            ? text(`PASS in ${result.elapsedMs}ms: ${code}`)
            : failure(`FAIL after ${result.elapsedMs}ms: ${code}`, `Received: ${result.received}`);
        }),
      ),
  );
}
