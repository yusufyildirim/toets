import { describeElement, resolveLocator, screenshotPng, type ElementSnapshot } from '@toets/core';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { MATCHERS, runAssertion } from '../assertions.js';
import { locate, locatorCode } from '../locate.js';
import { failure, guarded, targetSchema, text, type ToolContext } from './shared.js';

export function registerInspectTools(server: McpServer, { session }: ToolContext): void {
  server.registerTool(
    'snapshot',
    {
      title: 'Text snapshot of the screen',
      description: [
        'Read the current screen as a YAML text snapshot, exactly what `app.snapshot()` returns in a test: one line per element in tree order, `testId "text" [states]`, nested by containment. States: focused, selected, busy, disabled, offscreen.',
        'Use it to see what is on screen and where focus is before deciding what to press. Cheap and deterministic: prefer it over `screenshot`.',
        'Wrappers without a test ID, text, focusability or state are left out; anonymous elements show as `text` or `element`. Pass `target` for one subtree (`locator.snapshot()`). The output can be pasted into `toMatchTextSnapshot`.',
      ].join(' '),
      inputSchema: z.object({ target: targetSchema.optional() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ target }) =>
      guarded(() =>
        session.exclusive(async () => {
          const { runtime } = session.launched();
          const yaml = target
            ? await locate(runtime.app, target).snapshot()
            : await runtime.app.snapshot();
          const focused = await runtime.target.focused();
          return {
            content: [
              { type: 'text', text: yaml },
              ...(focused
                ? []
                : [
                    {
                      type: 'text' as const,
                      text: 'Note: no element has focus (some TV apps show focus only after the first key press).',
                    },
                  ]),
            ],
          };
        }),
      ),
  );

  server.registerTool(
    'screenshot',
    {
      title: 'Screenshot',
      description: [
        'PNG screenshot of the screen (`app.screenshot()`), or of one element cropped from it (`locator.screenshot()`).',
        'Use only for visual questions (layout, images, colors, how the focus ring looks). To read text, test IDs and focus use `snapshot`.',
      ].join(' '),
      inputSchema: z.object({ target: targetSchema.optional() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ target }) =>
      guarded(() =>
        session.exclusive(async () => {
          const { runtime } = session.launched();
          const shot = target
            ? await locate(runtime.app, target).screenshot()
            : await runtime.app.screenshot();
          const png = screenshotPng(shot);
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
        'Use it to check a selector before writing it into a test: a locator used in an action or assertion must match exactly one element.',
        'Reports the screen as it is now, without waiting (use `assert` to wait for something).',
      ].join(' '),
      inputSchema: z.object({ target: targetSchema }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ target }) =>
      guarded(() =>
        session.exclusive(async () => {
          const { runtime } = session.launched();
          const locator = locate(runtime.app, target);
          const code = locatorCode(locator);
          const matches = await resolveLocator(locator);
          if (!matches.length) {
            return text(
              `No element matches ${code}.`,
              'Check `snapshot`. Offscreen items in virtualized lists do not exist until focus moves near them.',
            );
          }
          const lines = matches.map((el, i) => {
            const b = el.bounds;
            return `[${i}] ${describeElement(el)}${states(el)}  (bounds ${b.x},${b.y} ${b.width}x${b.height})`;
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
        'Check a condition with the same matcher code `expect` runs in a toets test: it retries until the condition holds or the timeout passes (waiting for app idle first when the SDK has it), and fails with the same message a test would.',
        'Locator matchers (need `target`): toBeVisible, toBeInViewport, toBeFocused, toHaveFocusWithin, toBeEnabled, toBeDisabled, toBeSelected, toBeBusy, toHaveText / toContainText (`expected`), toHaveCount (`count`). Screen: toMatchTextSnapshot (`expected` YAML from `snapshot`; `target` optional). Media (`media.state`): toBePlaying, toBePaused, toHaveMediaState (`expected`), toHavePosition (`seconds`, `tolerance`). Network (`network.mock`): toHaveRequested (`request`, `times`). Any of them with `not`.',
        'Use it to confirm an assertion before writing it; the result includes the test code line. A locator matching several elements fails (strict mode). TV trap: after pressing keys, assert focus with toBeFocused instead of assuming the press moved it.',
      ].join(' '),
      inputSchema: z.object({
        matcher: z.enum(MATCHERS),
        target: targetSchema.optional(),
        expected: z
          .string()
          .optional()
          .describe(
            'toHaveText: full text; toContainText: substring; toMatchTextSnapshot: snapshot YAML; toHaveMediaState: a media state (playing, paused, buffering, ...).',
          ),
        count: z.number().int().min(0).optional().describe('toHaveCount: expected match count.'),
        seconds: z.number().min(0).optional().describe('toHavePosition: playback position.'),
        tolerance: z
          .number()
          .min(0)
          .optional()
          .describe('toHavePosition: allowed difference in seconds. Default 1.'),
        request: z
          .object({
            method: z.string().optional().describe('HTTP method, e.g. GET.'),
            url: z
              .string()
              .optional()
              .describe('URL or path, matched by the mock server URL rules.'),
          })
          .optional()
          .describe('toHaveRequested: request filter. Default: any request.'),
        times: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('toHaveRequested: exact number of matching requests. Default: at least one.'),
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
          .describe(
            "How long to retry. Default: the target's expect timeout (config, or the test project's `expect.timeout`; 5000).",
          ),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (input) =>
      guarded(() =>
        session.exclusive(async () => {
          const { runtime, expectTimeoutMs } = session.launched();
          const result = await runAssertion(runtime, input, expectTimeoutMs);
          return result.pass
            ? text(`PASS in ${result.elapsedMs}ms: ${result.code}`)
            : failure(`FAIL after ${result.elapsedMs}ms: ${result.code}`, '', result.message);
        }),
      ),
  );
}

/** States worth knowing when picking a locator, in the text snapshot's vocabulary. */
function states(el: ElementSnapshot): string {
  const out: string[] = [];
  if (el.focused) out.push('focused');
  if (el.selected) out.push('selected');
  if (el.busy) out.push('busy');
  if (!el.enabled) out.push('disabled');
  if (!el.visible) out.push('hidden');
  else if (!el.inViewport) out.push('offscreen');
  return out.length ? ` [${out.join(', ')}]` : '';
}
