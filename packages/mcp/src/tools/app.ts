import { Key, describeChain, targetChain, type AppRuntime, type LaunchOptions } from '@toets/core';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { describeKeyOverride, jsString } from '@toets/core/runner';
import { focusLine, guarded, text, type ToolContext } from './shared.js';

export function registerAppTools(server: McpServer, { session }: ToolContext): void {
  server.registerTool(
    'launch',
    {
      title: 'Launch app',
      description: [
        'Start (or restart) the app under test on a TV target, like `app.launch()` at the start of a test. Call this first: every other device tool needs a running app.',
        'Each launch starts clean: the previous instance is terminated and you are back on the start screen. With the toets SDK enabled it waits for the app to connect.',
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
            'Named app state to launch into. Needs the `app.state` capability (toets SDK in the app, `sdk` on in the config).',
          ),
        flags: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe('App feature flags for this launch. Needs `app.state`.'),
        deepLink: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Start the app from this deep link instead of its launcher entry (a cold start), e.g. `myapp://details/42`: the app's own canonical link, the same on every platform. The platform's `deepLink` mapper in the config translates it. Needs `deeplink.launch`.",
          ),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ target, clearData, state, flags, deepLink }) =>
      guarded(() =>
        session.exclusive(async () => {
          const opts: LaunchOptions = {
            ...(state !== undefined && { state }),
            ...(flags !== undefined && { flags }),
            ...(clearData !== undefined && { clearData }),
            ...(deepLink !== undefined && { deepLink }),
          };
          const { name, runtime } = await session.launch(target, opts);
          return text(
            `Launched on target "${name}" (${runtime.driver.platform}).`,
            ...(deepLink !== undefined ? [`Step: ${runtime.lastLaunchTitle ?? 'launch'}`] : []),
            sdkLine(runtime),
            focusLine(await runtime.target.focused()),
            `Code: ${launchCode(opts)}`,
            'Next: `snapshot` to see the screen, then `press_until_focused` / `navigate_to` / `press` to move focus.',
          );
        }),
      ),
  );

  server.registerTool(
    'open_deep_link',
    {
      title: 'Open a deep link in the running app',
      description: [
        'Deliver a deep link to the running app, as the OS does when a link is opened while the app runs (home screen rows, voice, search): exactly `app.openDeepLink(url)`. The app is not restarted; it routes the link itself.',
        "`url` is the app's own canonical link (`myapp://details/42`); the platform's `deepLink` mapper translates it, and the output shows the translation. Needs `deeplink.open` (Android TV, tvOS; browsers have no OS deep links). To start the app from a link, use `launch` with `deepLink`.",
        'Fails with DEEPLINK_UNHANDLED when no app handles the link. Assert focus right after: landing with nothing focused is the classic deep link bug.',
      ].join(' '),
      inputSchema: z.object({
        url: z.string().min(1).describe('Canonical deep link, an absolute URL.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ url }) =>
      guarded(() =>
        session.exclusive(async () => {
          const { runtime } = session.launched();
          await runtime.app.openDeepLink(url);
          return text(
            `Step: ${runtime.lastDeepLinkTitle ?? `openDeepLink ${url}`}`,
            focusLine(await runtime.target.focused()),
            `Code: await app.openDeepLink(${jsString(url)});`,
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
            ([key, o]) => `${key} = ${describeKeyOverride(o)}`,
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
            keyboardsLine(runtime),
            deepLinksLine(runtime),
          );
        }),
      ),
  );
}

/** Declared app keyboards and the fields `fill` types into with them. */
function keyboardsLine(runtime: AppRuntime): string {
  const keyboards = runtime.keyboards.map((k) => {
    const fields = (k.fields ?? []).map((f) => describeChain(targetChain(f)));
    return fields.length ? `${k.name} (fields: ${fields.join(', ')})` : k.name;
  });
  const system = runtime.capabilities.has('text.input')
    ? 'system text fields: yes (text.input)'
    : 'system text fields: no';
  return `Keyboards: ${keyboards.length ? keyboards.join('; ') : 'none declared'}; ${system}`;
}

/** Whether `launch({ deepLink })` and `open_deep_link` work on this target. */
function deepLinksLine(runtime: AppRuntime): string {
  const has = (c: 'deeplink.launch' | 'deeplink.open') =>
    runtime.capabilities.has(c) ? `yes (${c})` : `no (${c} missing)`;
  return `Deep links: launch from a link ${has('deeplink.launch')}; open in the running app ${has('deeplink.open')}`;
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
  if (opts.state !== undefined) parts.push(`state: ${jsString(opts.state)}`);
  if (opts.flags !== undefined) {
    const flags = Object.entries(opts.flags).map(
      ([k, v]) =>
        `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : jsString(k)}: ${typeof v === 'string' ? jsString(v) : String(v)}`,
    );
    parts.push(flags.length ? `flags: { ${flags.join(', ')} }` : 'flags: {}');
  }
  if (opts.clearData) parts.push('clearData: true');
  if (opts.deepLink !== undefined) parts.push(`deepLink: ${jsString(opts.deepLink)}`);
  return `await app.launch(${parts.length ? `{ ${parts.join(', ')} }` : ''});`;
}
