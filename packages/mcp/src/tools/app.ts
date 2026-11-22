import { Key, type AppRuntime, type LaunchOptions } from '@dpad-tv/core';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { focusLine, guarded, quote, text, type ToolContext } from './shared.js';

export function registerAppTools(server: McpServer, { session }: ToolContext): void {
  server.registerTool(
    'launch',
    {
      title: 'Launch app',
      description: [
        'Start (or restart) the app under test on a TV target, like `app.launch()` at the start of a test. Call this first: every other device tool needs a running app.',
        'Each launch starts clean: the previous instance is terminated and you are back on the start screen. With the dpad SDK enabled it waits for the app to connect.',
        'Returns the platform, the SDK status and the focused element; call `snapshot` next to see the screen.',
      ].join(' '),
      inputSchema: z.object({
        target: z
          .string()
          .optional()
          .describe(
            'Configured target name (see `capabilities`), e.g. a test project name. Default: the current or default target.',
          ),
        clearData: z.boolean().optional().describe('Clear app data/storage before launching.'),
        state: z
          .string()
          .optional()
          .describe(
            'Named app state to launch into. Needs the `app.state` capability (dpad SDK in the app, `sdk` on in the config).',
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
          const opts: LaunchOptions = {
            ...(state !== undefined && { state }),
            ...(flags !== undefined && { flags }),
            ...(clearData !== undefined && { clearData }),
          };
          const { name, runtime } = await session.launch(target, opts);
          return text(
            `Launched on target "${name}" (${runtime.driver.platform}).`,
            sdkLine(runtime),
            focusLine(await runtime.target.focused()),
            `Code: ${launchCode(opts)}`,
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
        'Describe a TV target: platform, capabilities, which remote keys work (after the configured key overrides), SDK and mocking status, and the configured targets.',
        'Check it before pressing anything beyond the D-pad and SELECT, or relying on media or app state. Tests gate on the same capability names with `requires`.',
        'Starts the target if needed, without launching the app.',
      ].join(' '),
      inputSchema: z.object({
        target: z.string().optional().describe('Configured target name. Default: the current one.'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ target }) =>
      guarded(() =>
        session.exclusive(async () => {
          const { name, runtime, launched } = await session.describe(target);
          const keys = Object.values(Key);
          const supported = keys.filter((k) => runtime.checkKey(k) === null);
          const missing = keys.filter((k) => !supported.includes(k));
          const overrides = Object.entries(runtime.keyOverrides).map(
            ([key, o]) =>
              `${key} = ${o.holdMs === undefined ? 'press' : 'hold'} ${o.as}${o.holdMs === undefined ? '' : ` ${o.holdMs}ms`}`,
          );
          const declared = [...runtime.declaredCapabilities].sort();
          const current = runtime.capabilities;
          const pending = declared.filter((c) => !current.has(c));
          return text(
            `Target: ${name} (platform ${runtime.driver.platform}), app ${launched ? 'running' : 'not launched'}`,
            `Configured targets: ${session.targetNames.join(', ')}`,
            `Capabilities: ${[...current].sort().join(', ') || 'none beyond D-pad and SELECT'}`,
            ...(pending.length ? [`Once the SDK connects (at launch): ${pending.join(', ')}`] : []),
            sdkLine(runtime),
            `Network mocking: ${runtime.mock ? `on (${runtime.mock.url})` : 'off'}`,
            `Keys: ${supported.join(' ')}`,
            ...(missing.length ? [`Unsupported keys: ${missing.join(' ')}`] : []),
            ...(overrides.length ? [`Key overrides: ${overrides.join(', ')}`] : []),
          );
        }),
      ),
  );
}

function sdkLine(runtime: AppRuntime): string {
  const session = runtime.target.sdk;
  if (session) {
    return `SDK: connected (${session.hello.sdk}, ${session.hello.framework}), domains: ${[...session.domains].sort().join(', ')}`;
  }
  return runtime.sdkHost ? 'SDK: enabled, not connected' : 'SDK: off (black-box)';
}

function launchCode(opts: LaunchOptions): string {
  const parts: string[] = [];
  if (opts.state !== undefined) parts.push(`state: ${quote(opts.state)}`);
  if (opts.flags !== undefined) {
    const flags = Object.entries(opts.flags).map(
      ([k, v]) =>
        `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : quote(k)}: ${typeof v === 'string' ? quote(v) : String(v)}`,
    );
    parts.push(flags.length ? `flags: { ${flags.join(', ')} }` : 'flags: {}');
  }
  if (opts.clearData) parts.push('clearData: true');
  return `await app.launch(${parts.length ? `{ ${parts.join(', ')} }` : ''});`;
}
