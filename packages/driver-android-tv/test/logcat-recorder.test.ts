import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Adb } from '../src/adb.js';
import { LogcatCollector, parseLogcatLine } from '../src/logcat.js';
import { ScreenRecorder } from '../src/recorder.js';
import { FakeRunner } from './fake-runner.js';

describe('parseLogcatLine', () => {
  it('parses `-v epoch -v uid` lines', () => {
    expect(
      parseLogcatLine('  1795371169.124 10063  1382  3443 E native  : E0000 grpc: failed'),
    ).toEqual({
      timestamp: 1795371169124,
      uid: '10063',
      pid: 1382,
      level: 'E',
      tag: 'native',
      message: 'E0000 grpc: failed',
    });
    expect(
      parseLogcatLine(
        '         1795371175.727  wifi   821   821 I wpa_supplicant: wlan0: BEACON-LOSS ',
      )?.uid,
    ).toBe('wifi');
    expect(parseLogcatLine('--------- beginning of main')).toBeNull();
  });
});

describe('LogcatCollector', () => {
  const make = (scope: 'app' | 'all', maxEntries?: number) => {
    const runner = new FakeRunner();
    const collector = new LogcatCollector(new Adb(runner, 'adb', 'emulator-5554', {}), {
      scope,
      packageName: 'com.x',
      ...(maxEntries ? { maxEntries } : {}),
    });
    collector.setAppUid(10096);
    return { runner, collector };
  };

  it('keeps app lines and system warnings naming the app in `app` scope', () => {
    const { collector } = make('app');
    collector.accept('1.000 10096 100 100 D App: debug line');
    collector.accept('1.001 1000 50 50 I ActivityManager: Start proc com.x');
    collector.accept('1.002 1000 50 50 E ActivityManager: ANR in com.x');
    collector.accept('1.003 1000 50 50 E Other: unrelated');
    expect(collector.drain()).toEqual([
      { level: 'debug', message: 'App: debug line', timestamp: 1000, source: 'app' },
      {
        level: 'error',
        message: 'ActivityManager: ANR in com.x',
        timestamp: 1002,
        source: 'device',
      },
    ]);
    expect(collector.drain()).toEqual([]);
  });

  it('keeps everything in `all` scope', () => {
    const { collector } = make('all');
    collector.accept('1.003 1000 50 50 W Other: unrelated');
    expect(collector.drain()).toEqual([
      { level: 'warn', message: 'Other: unrelated', timestamp: 1003, source: 'device' },
    ]);
  });

  it('bounds its buffer and reports dropped lines', () => {
    const { collector } = make('all', 2);
    for (let i = 0; i < 5; i++) collector.accept(`1.00${i} 1000 50 50 I T: line ${i}`);
    const out = collector.drain();
    expect(out.map((e) => e.message)).toEqual([
      'toets: 3 older log lines were dropped (buffer full)',
      'T: line 3',
      'T: line 4',
    ]);
  });

  it('streams from the device and stops its process', async () => {
    const { runner, collector } = make('app');
    collector.start();
    collector.start();
    expect(runner.lines('spawn')).toEqual([
      'adb -s emulator-5554 logcat -v epoch -v uid -v printable -T 1',
    ]);
    runner.processes[0]!.emit('2.000 10096 1 1 I App: streamed');
    expect(collector.drain()).toHaveLength(1);
    await collector.stop();
    expect(runner.processes[0]!.signals).toEqual(['SIGTERM']);
  });
});

describe('ScreenRecorder', () => {
  it('records with screenrecord, finalizes with SIGINT and pulls the file', async () => {
    const runner = new FakeRunner();
    const outputDir = mkdtempSync(join(tmpdir(), 'toets-rec-'));
    const recorder = new ScreenRecorder(new Adb(runner, 'adb', 'emulator-5554', {}), {
      outputDir,
      runner,
    });
    await recorder.start();
    expect(recorder.recording).toBe(true);
    const spawn = runner.lines('spawn')[0]!;
    expect(spawn).toMatch(
      /^adb -s emulator-5554 shell screenrecord --bit-rate 4000000 --time-limit 180 \/sdcard\/toets-\d+-0-0\.mp4$/,
    );
    const remote = spawn.split(' ').pop()!;

    runner.on('pkill', () => {
      runner.processes[0]!.exit(0);
      return '';
    });
    const file = await recorder.stop();
    expect(file).toBe(join(outputDir, remote.slice('/sdcard/'.length)));
    expect(runner.lines('run')).toEqual([
      'adb -s emulator-5554 shell pkill -INT -x screenrecord',
      `adb -s emulator-5554 pull ${remote} ${file}`,
      `adb -s emulator-5554 shell rm -f ${remote}`,
    ]);
    expect(recorder.recording).toBe(false);
    await expect(recorder.stop()).rejects.toMatchObject({ code: 'ANDROID_RECORDING_FAILED' });
  });

  it('continues in a new segment at the 180 s limit and joins segments with ffmpeg', async () => {
    const runner = new FakeRunner();
    const outputDir = mkdtempSync(join(tmpdir(), 'toets-rec-'));
    const logs: string[] = [];
    const recorder = new ScreenRecorder(new Adb(runner, 'adb', 'emulator-5554', {}), {
      outputDir,
      runner,
      ffmpeg: '/usr/bin/ffmpeg',
      log: (m) => logs.push(m),
      minSegmentMs: 0,
    });
    await recorder.start();
    runner.processes[0]!.exit(0); // time limit reached
    await new Promise((r) => setTimeout(r, 0));
    expect(runner.lines('spawn')).toHaveLength(2);
    expect(runner.lines('spawn')[1]).toMatch(/-1\.mp4$/);

    runner.on('pkill', () => {
      runner.processes[1]!.exit(0);
      return '';
    });
    const file = await recorder.stop();
    expect(file).toMatch(/toets-\d+-0\.mp4$/);
    expect(
      runner.lines('run').filter((l) => l.startsWith('adb -s emulator-5554 pull')),
    ).toHaveLength(2);
    expect(runner.lines('run').at(-1)).toContain('ffmpeg -y -f concat -safe 0');

    // Without ffmpeg the last segment is returned and the split is logged.
    runner.on('ffmpeg', { exitCode: 1, stderr: 'nope' });
    await recorder.start();
    runner.processes[2]!.exit(0);
    await new Promise((r) => setTimeout(r, 0));
    runner.on('pkill', () => {
      runner.processes[3]!.exit(0);
      return '';
    });
    expect(await recorder.stop()).toMatch(/-1\.mp4$/);
    expect(logs.join('\n')).toContain('split into 2 segments');
  });

  it('does not restart a failing screenrecord and explains the failure', async () => {
    const runner = new FakeRunner();
    const outputDir = mkdtempSync(join(tmpdir(), 'toets-rec-'));
    const recorder = new ScreenRecorder(new Adb(runner, 'adb', 'emulator-5554', {}), {
      outputDir,
      runner,
    });
    runner.on(' pull ', { exitCode: 1, stderr: 'remote object does not exist' });
    await recorder.start();
    runner.processes[0]!.emit('ERROR: unable to configure video encoder');
    runner.processes[0]!.exit(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(runner.lines('spawn')).toHaveLength(1);
    const err = await recorder.stop().catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'ANDROID_RECORDING_FAILED' });
    expect((err as Error).message).toContain('unable to configure video encoder');
  });
});
