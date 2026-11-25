import { keyboardImpl, locatorImpl, maskText, type TextEntryResult } from '@toets/core';
import { jsString } from '@toets/core/runner';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { locate, locatorCode } from '../locate.js';
import { focusLine, guarded, targetSchema, text, type ToolContext } from './shared.js';

const textSchema = z.string().max(500);
const maskSchema = z
  .boolean()
  .optional()
  .describe(
    'Show the text as •••• in this output and in step titles (PINs, passwords). Automatic for system password fields.',
  );

/** `keyboard: search, 9 presses` or `system`. */
function how(result: TextEntryResult): string {
  return result.via === 'system'
    ? 'system'
    : `keyboard: ${result.via}, ${result.presses} press${result.presses === 1 ? '' : 'es'}`;
}

/** The text as shown and as a code literal; masked text never appears in the output. */
function shown(value: string, masked: boolean): { display: string; literal: string } {
  return masked
    ? {
        display: JSON.stringify(maskText(value)),
        literal: `/* masked */ ${jsString(maskText(value))}`,
      }
    : { display: JSON.stringify(value), literal: jsString(value) };
}

export function registerTextTools(server: McpServer, { session }: ToolContext): void {
  server.registerTool(
    'fill',
    {
      title: 'Fill a text field',
      description: [
        "Replace a field's text like a user: focus moves to it with real D-pad presses, then its keyboard enters the text; exactly `locator.fill(text)` from a test. Never submits.",
        'The keyboard is a declared app keyboard listing the field in `fields` (opened with SELECT, typed key by key), else system text entry on a system text field (`text.input`). Fails with NO_KEYBOARD otherwise; see `capabilities` for the declared keyboards.',
        'Reports the keyboard used and the presses. Then `type`, `erase` or `submit` act on the same keyboard.',
      ].join(' '),
      inputSchema: z.object({ target: targetSchema, text: textSchema, mask: maskSchema }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ target, text: value, mask }) =>
      guarded(() =>
        session.exclusive(async () => {
          const { runtime } = session.launched();
          const locator = locate(runtime.app, target);
          const impl = locatorImpl(locator);
          if (!impl) throw new Error('locate() returned a non-toets locator');
          const result = await impl.fillWith(value, mask ? { mask: true } : {});
          const s = shown(value, result.masked);
          const opts = result.masked ? ', { mask: true }' : '';
          return text(
            `Filled ${String(locator)} with ${s.display} (${how(result)}).`,
            focusLine(await runtime.target.focused()),
            `Code: await ${locatorCode(locator)}.fill(${s.literal}${opts});`,
          );
        }),
      ),
  );

  server.registerTool(
    'type',
    {
      title: 'Type on the open keyboard',
      description: [
        'Type text at the end of the field on the keyboard in use: exactly `app.keyboard.type(text)`. The keyboard is the declared app keyboard holding focus, else system text entry on the focused system text field, else the only declared keyboard on screen.',
        'On an app keyboard each character is a D-pad walk to its key and SELECT, switching layers with the declared toggles. Fails with NO_KEYBOARD, AMBIGUOUS_KEYBOARD or CHAR_NOT_ON_KEYBOARD (lists the layers seen).',
      ].join(' '),
      inputSchema: z.object({ text: textSchema.min(1), mask: maskSchema }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ text: value, mask }) =>
      guarded(() =>
        session.exclusive(async () => {
          const { runtime } = session.launched();
          const result = await keyboard(runtime.app.keyboard).type(
            value,
            mask ? { mask: true } : {},
          );
          const s = shown(value, result.masked);
          const opts = result.masked ? ', { mask: true }' : '';
          return text(
            `Typed ${s.display} (${how(result)}).`,
            focusLine(await runtime.target.focused()),
            `Code: await app.keyboard.type(${s.literal}${opts});`,
          );
        }),
      ),
  );

  server.registerTool(
    'erase',
    {
      title: 'Erase characters',
      description:
        "Delete characters before the caret with the keyboard's backspace key: exactly `app.keyboard.erase(count)`. App keyboards need a declared `backspace` key (KEYBOARD_ACTION_MISSING otherwise).",
      inputSchema: z.object({
        count: z.number().int().positive().max(200).optional().describe('Characters. Default 1.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ count }) =>
      guarded(() =>
        session.exclusive(async () => {
          const { runtime } = session.launched();
          const result = await keyboard(runtime.app.keyboard).erase(count ?? 1);
          return text(
            `Erased ${count ?? 1} (${how(result)}).`,
            focusLine(await runtime.target.focused()),
            `Code: await app.keyboard.erase(${count === undefined ? '' : count});`,
          );
        }),
      ),
  );

  server.registerTool(
    'submit',
    {
      title: 'Submit the keyboard',
      description:
        "Press the keyboard's submit key: exactly `app.keyboard.submit()`. System keyboards use their action key (Search, Go, Done); app keyboards need a declared `submit` key (KEYBOARD_ACTION_MISSING otherwise).",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    () =>
      guarded(() =>
        session.exclusive(async () => {
          const { runtime } = session.launched();
          const result = await keyboard(runtime.app.keyboard).submit();
          return text(
            `Submitted (${how(result)}).`,
            focusLine(await runtime.target.focused()),
            'Code: await app.keyboard.submit();',
          );
        }),
      ),
  );
}

function keyboard(value: unknown) {
  const impl = keyboardImpl(value);
  if (!impl) throw new Error('app.keyboard is not a toets keyboard');
  return impl.entry;
}
