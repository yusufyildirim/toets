import { KEY_CAPABILITY, Key } from '@dpad-tv/core';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { focusLine, guarded, text, type ToolContext } from './shared.js';

export function registerAppTools(server: McpServer, { session }: ToolContext): void {
  server.registerTool(
    'launch',
    {
      title: 'Launch app',
      description: [
        'Start (or restart) the app under test on a TV target. Call this first: every other device tool needs a running app.',
        'Relaunching terminates the running instance, so it also resets you to the start screen.',
        'Returns the platform and the focused element; call `snapshot` next to see the screen.',
      ].join(' '),
      inputSchema: z.object({
        target: z
          .string()
          .optional()
          .describe(
            'Configured target name (see `capabilities`). Default: the current or default target.',
          ),
        clearData: z.boolean().optional().describe('Clear app data/storage before launching.'),
        state: z
          .string()
          .optional()
          .describe(
            'Named app state to launch into. Needs the `app.state` capability (dpad SDK in the app).',
          ),
        flags: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe('App feature flags for this launch. Needs `app.state`.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ target, clearData, state, flags }) =>
      guarded(() =>
        session.exclusive(async () => {
          const { name, runtime } = await session.launch(target, (rt) =>
            rt.launch({
              ...(clearData !== undefined && { clearData }),
              ...(state !== undefined && { state }),
              ...(flags !== undefined && { flags }),
            }),
          );
          return text(
            `Launched on target "${name}" (${runtime.platform}).`,
            focusLine(await runtime.focused()),
            'Next: `snapshot` to see the screen, then `navigate_to` / `press` to move focus.',
          );
        }),
      ),
  );

  server.registerTool(
    'capabilities',
    {
      title: 'Target capabilities',
      description: [
        'Describe the current TV target: platform, capabilities, which remote keys exist, and the configured targets.',
        'Check it before pressing anything beyond the D-pad and SELECT, or relying on media/app state.',
        'Tests gate on the same names with `requires`.',
      ].join(' '),
      inputSchema: z.object({
        target: z.string().optional().describe('Configured target name. Default: the current one.'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ target }) =>
      guarded(() =>
        session.exclusive(async () => {
          const info = await session.describe(target);
          const caps = info.runtime.capabilities;
          const keys = Object.values(Key);
          const supported = keys.filter((k) => {
            const needed = KEY_CAPABILITY[k];
            return needed === null || caps.has(needed);
          });
          const missing = keys.filter((k) => !supported.includes(k));
          return text(
            `Target: ${info.name} (platform ${info.platform}), app ${info.launched ? 'running' : 'not launched'}`,
            `Configured targets: ${session.targetNames.join(', ')}`,
            `Capabilities: ${[...caps].sort().join(', ') || 'none beyond D-pad and SELECT'}`,
            `Keys: ${supported.join(' ')}`,
            ...(missing.length ? [`Unsupported keys: ${missing.join(' ')}`] : []),
          );
        }),
      ),
  );
}
