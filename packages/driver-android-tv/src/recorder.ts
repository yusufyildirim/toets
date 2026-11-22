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
}

interface RecordingSession {
  readonly id: string;
  readonly segments: string[];
  proc: SpawnedProcess | undefined;
  stopping: boolean;
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
    const session: RecordingSession = { id, segments: [], proc: undefined, stopping: false };
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
      await this.adb.pull(remote, file);
      await this.adb.run(['shell', 'rm', '-f', remote]);
      local.push(file);
    }
    if (local.length === 0) {
      throw androidError('ANDROID_RECORDING_FAILED', 'screenrecord produced no video.', {
        hint: 'Some emulator images lack a hardware video encoder; try another system image.',
      });
    }
    if (local.length === 1) return local[0]!;
    return this.join(local, session.id);
  }

  private startSegment(session: RecordingSession): void {
    const remote = `/sdcard/${session.id}-${session.segments.length}.mp4`;
    session.segments.push(remote);
    const proc = this.adb.spawn([
      'shell',
      'screenrecord',
      '--bit-rate',
      String(this.opts.bitRate ?? 4_000_000),
      '--time-limit',
      String(SEGMENT_SECONDS),
      remote,
    ]);
    session.proc = proc;
    void proc.exited.then(() => {
      // Hit the time limit while still recording: continue in a new segment.
      if (this.session === session && !session.stopping) this.startSegment(session);
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
