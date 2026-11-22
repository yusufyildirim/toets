/**
 * Implementation of the `dpad-conformance` command: runs the conformance suite against any
 * SDK implementation by launching it through shell commands. See `docs/conformance.md`.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { formatConformanceReport, runConformance, type ConformanceLaunch } from './index.js';

export interface CliOptions {
  readonly launch: string;
  readonly terminate: string | undefined;
  readonly fixture: boolean;
  readonly name: string | undefined;
  readonly only: string[];
  readonly connectTimeoutMs: number | undefined;
}

const USAGE = `Usage: dpad-conformance --launch "<command>" [options]

Runs the dpad protocol conformance suite against an SDK. The launch command starts the app
(or a program embedding the SDK) with the launch payload, available as the {payload}
placeholder (base64url) and the DPAD_PAYLOAD environment variable.

Options:
  --launch <cmd>      Command that starts the app. Required.
  --terminate <cmd>   Command that stops the app. Default: kill the launch process.
  --fixture           The app implements the conformance fixture (enables behavioral checks).
  --name <name>       Name shown in the report.
  --only <id>         Run only checks with this id or id prefix. Repeatable.
  --timeout <ms>      Connect timeout per launch. Default 15000.
`;

/** Parses argv (without node and script). Throws with a usage message on bad input. */
export function parseArgs(argv: readonly string[]): CliOptions {
  let launch: string | undefined;
  let terminate: string | undefined;
  let name: string | undefined;
  let connectTimeoutMs: number | undefined;
  let fixture = false;
  const only: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} needs a value\n\n${USAGE}`);
      return v;
    };
    if (arg === '--launch') launch = value();
    else if (arg === '--terminate') terminate = value();
    else if (arg === '--name') name = value();
    else if (arg === '--only') only.push(value());
    else if (arg === '--fixture') fixture = true;
    else if (arg === '--timeout') {
      connectTimeoutMs = Number(value());
      if (!Number.isFinite(connectTimeoutMs) || connectTimeoutMs <= 0)
        throw new Error('--timeout must be a positive number');
    } else if (arg === '--help' || arg === '-h') throw new Error(USAGE);
    else throw new Error(`Unknown argument ${arg}\n\n${USAGE}`);
  }
  if (!launch) throw new Error(`--launch is required\n\n${USAGE}`);
  return { launch, terminate, fixture, name, only, connectTimeoutMs };
}

/** Replaces `{payload}` with the base64url payload (shell safe by construction). */
export function renderCommand(template: string, launch: ConformanceLaunch): string {
  return template.split('{payload}').join(launch.encoded);
}

function run(command: string, env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(command, { shell: true, stdio: ['ignore', 'inherit', 'inherit'], env });
}

function waitExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once('exit', () => resolve()));
}

export async function main(): Promise<void> {
  let opts: CliOptions;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 2;
    return;
  }
  let child: ChildProcess | undefined;
  const report = await runConformance(
    {
      name: opts.name ?? opts.launch,
      fixture: opts.fixture,
      launch(launch) {
        const env = { ...process.env, DPAD_PAYLOAD: launch.encoded };
        child = run(renderCommand(opts.launch, launch), env);
      },
      async terminate() {
        if (opts.terminate) await waitExit(run(opts.terminate, process.env));
        if (child) {
          child.kill('SIGTERM');
          await waitExit(child);
          child = undefined;
        }
      },
    },
    {
      ...(opts.only.length > 0 ? { only: opts.only } : {}),
      ...(opts.connectTimeoutMs === undefined ? {} : { connectTimeoutMs: opts.connectTimeoutMs }),
      onResult: (r) => process.stderr.write(`${r.status.toUpperCase()} ${r.id}\n`),
    },
  );
  process.stdout.write(`${formatConformanceReport(report)}\n`);
  process.exitCode = report.passed ? 0 : 1;
}
