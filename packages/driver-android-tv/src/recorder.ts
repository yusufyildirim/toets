import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Adb } from './adb.js';
import type { CommandRunner, SpawnedProcess } from './command.js';
import { androidError } from './errors.js';

/** `screenrecord` stops by itself after 180 s on most Android versions. */
const SEGMENT_SECONDS = 180;

export interface RecorderOptions {
  /** Host directory for finished videos. */
  readonly outputDir: string;
  /** Video bit rate in bits per second. Default 4 Mbps. */
  readonly bitRate?: number;
  /** Optional `ffmpeg` binary used to join segments of recordings longer than 180 s. */
  readonly ffmpeg?: string;
  readonly runner: CommandRunner;
  readonly log?: (message: string) => void;
  /**
   * A segment that ends earlier than this (or with an error) is a failure, not the time
   * limit, and is not restarted. Default 10 000 ms.
   */
  readonly minSegmentMs?: number;
}

interface RecordingSession {
  readonly id: string;
  readonly segments: string[];
  readonly output: string[];
  proc: SpawnedProcess | undefined;
  stopping: boolean;
  failure: string | undefined;
}

/**
 * Records the screen with the device's `screenrecord`. Long recordings are recorded as
 * consecutive 180 s segments; with `ffmpeg` available they are joined into one file,
 * otherwise the last segment (which holds the end of the test) is returned and the others are
 * listed in the log.
 */
export class ScreenRecorder {
  private session: RecordingSession | undefined;
  private counter = 0;

  constructor(
    private readonly adb: Adb,
    private readonly opts: RecorderOptions,
  ) {}

  get recording(): boolean {
    return this.session !== undefined;
  }

  async start(): Promise<void> {
    if (this.session) return;
    const id = `dpad-${Date.now()}-${this.counter++}`;
    const session: RecordingSession = {
      id,
      segments: [],
      output: [],
      proc: undefined,
      stopping: false,
      failure: undefined,
    };
    this.session = session;
    this.startSegment(session);
  }

  /** Stops recording, pulls the video to the host and returns its path. */
  async stop(): Promise<string> {
    const session = this.session;
    if (!session) {
      throw androidError('ANDROID_RECORDING_FAILED', 'stopRecording() called without a recording.');
    }
    session.stopping = true;
    // SIGINT makes screenrecord finalize the MP4; killing the local adb would truncate it.
    // The device is leased to this worker, so its only screenrecord is ours.
    await this.adb.run(['shell', 'pkill', '-INT', '-x', 'screenrecord']);
    const proc = session.proc;
    const exited = await Promise.race([
      proc ? proc.exited.then(() => true) : true,
      new Promise<false>((r) => setTimeout(() => r(false), 15_000)),
    ]);
    if (!exited) proc?.kill('SIGKILL');
    this.session = undefined;

    const local: string[] = [];
    for (const remote of session.segments) {
      const file = join(this.opts.outputDir, remote.slice(remote.lastIndexOf('/') + 1));
      try {
        await this.adb.pull(remote, file);
        local.push(file);
      } catch (e) {
        session.failure ??= (e as Error).message;
      }
      await this.adb.run(['shell', 'rm', '-f', remote]);
    }
    if (local.length === 0) {
      throw androidError(
        'ANDROID_RECORDING_FAILED',
        `screenrecord produced no video${session.failure ? `: ${session.failure}` : '.'}`,
        { hint: 'Some emulator images lack a hardware video encoder; try another system image.' },
      );
    }
    if (local.length === 1) return local[0]!;
    return this.join(local, session.id);
  }

  private startSegment(session: RecordingSession): void {
    const remote = `/sdcard/${session.id}-${session.segments.length}.mp4`;
    session.segments.push(remote);
    const startedAt = Date.now();
    const proc = this.adb.spawn(
      [
        'shell',
        'screenrecord',
        '--bit-rate',
        String(this.opts.bitRate ?? 4_000_000),
        '--time-limit',
        String(SEGMENT_SECONDS),
        remote,
      ],
      {
        onLine: (line) => {
          session.output.push(line);
          if (session.output.length > 20) session.output.shift();
        },
      },
    );
    session.proc = proc;
    void proc.exited.then((code) => {
      if (this.session !== session || session.stopping) return;
      if (code === 0 && Date.now() - startedAt >= (this.opts.minSegmentMs ?? 10_000)) {
        // Hit the time limit while still recording: continue in a new segment.
        this.startSegment(session);
        return;
      }
      session.failure = `screenrecord exited with code ${code}: ${session.output.join(' ').trim()}`;
      this.opts.log?.(`video: ${session.failure}`);
    });
  }

  private async join(files: string[], id: string): Promise<string> {
    const ffmpeg = this.opts.ffmpeg;
    if (ffmpeg) {
      const list = join(this.opts.outputDir, `${id}.txt`);
      const out = join(this.opts.outputDir, `${id}.mp4`);
      await writeFile(list, files.map((f) => `file '${f.replace(/'/g, `'\\''`)}'`).join('\n'));
      const res = await this.opts.runner.run(
        ffmpeg,
        ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out],
        { timeoutMs: 300_000 },
      );
      if (res.exitCode === 0) return out;
      this.opts.log?.(`video: ffmpeg could not join segments: ${res.stderr.trim().slice(-500)}`);
    }
    this.opts.log?.(
      `video: recording split into ${files.length} segments (screenrecord limit); returning the last. All: ${files.join(', ')}`,
    );
    return files[files.length - 1]!;
  }
}
