import type { ChildProcess } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { TvosErrorCode, tvosError } from './errors.js';
import type { Simctl } from './simctl.js';

const START_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 20_000;

/**
 * Records the simulator screen with `simctl io recordVideo` (H.264 MP4). Native to Xcode: no
 * ffmpeg, no extra load on WebDriverAgent. Stopping sends SIGINT so the file is finalized.
 */
export class ScreenRecorder {
  private child: ChildProcess | undefined;
  private path: string | undefined;

  constructor(
    private readonly simctl: Simctl,
    private readonly udid: string,
  ) {}

  get recording(): boolean {
    return this.child !== undefined;
  }

  async start(path: string): Promise<void> {
    if (this.child)
      throw tvosError(TvosErrorCode.RECORDING_FAILED, 'A recording is already running.');
    const child = this.simctl.spawn([
      'io',
      this.udid,
      'recordVideo',
      '--codec=h264',
      '--force',
      path,
    ]);
    this.child = child;
    this.path = path;
    try {
      await new Promise<void>((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => {
          // Older Xcodes print nothing; a live process after the timeout means it records.
          if (child.exitCode === null) resolve();
          else reject(new Error(output));
        }, START_TIMEOUT_MS);
        const onData = (d: Buffer | string) => {
          output += d.toString();
          if (/Recording started/i.test(output)) {
            clearTimeout(timer);
            resolve();
          }
        };
        child.stderr?.on('data', onData);
        child.stdout?.on('data', onData);
        child.once('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
        child.once('exit', (code) => {
          clearTimeout(timer);
          reject(new Error(`recordVideo exited with code ${code}: ${output.trim()}`));
        });
      });
    } catch (cause) {
      this.child = undefined;
      child.kill('SIGKILL');
      throw tvosError(TvosErrorCode.RECORDING_FAILED, 'Screen recording did not start.', {
        hint: 'The simulator must be booted and the path writable.',
        docs: 'capabilities',
        cause,
      });
    }
  }

  /** Stops the recording and returns the MP4 path. */
  async stop(): Promise<string> {
    const child = this.child;
    const path = this.path;
    if (!child || !path) {
      throw tvosError(TvosErrorCode.RECORDING_FAILED, 'No recording is running.', {
        hint: 'Call startRecording() before stopRecording().',
      });
    }
    this.child = undefined;
    this.path = undefined;
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill('SIGINT');
      const timer = setTimeout(() => child.kill('SIGKILL'), STOP_TIMEOUT_MS);
      await exited;
      clearTimeout(timer);
    }
    const size = await stat(path).then(
      (s) => s.size,
      () => 0,
    );
    if (size === 0) {
      throw tvosError(TvosErrorCode.RECORDING_FAILED, `The recording at ${path} is empty.`, {
        hint: 'The recorder was probably killed before it could finalize the file.',
        docs: 'capabilities',
      });
    }
    return path;
  }
}
