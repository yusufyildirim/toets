import { describe, expect, it } from 'vitest';
import { AppLogStream, parseLogLine } from '../src/logs.js';
import { Simctl } from '../src/simctl.js';
import { FakeRunner } from './helpers.js';

const line = (fields: Record<string, unknown>) =>
  JSON.stringify({
    eventType: 'logEvent',
    timestamp: '2026-11-22 10:00:00.123456+0100',
    ...fields,
  });

describe('parseLogLine', () => {
  it('maps unified log levels and timestamps', () => {
    expect(parseLogLine(line({ messageType: 'Default', eventMessage: 'hello' }))).toEqual({
      level: 'info',
      message: 'hello',
      timestamp: Date.parse('2026-11-22T10:00:00.123+01:00'),
      source: 'app',
    });
    expect(parseLogLine(line({ messageType: 'Debug', eventMessage: 'd' }))?.level).toBe('debug');
    expect(parseLogLine(line({ messageType: 'Error', eventMessage: 'e' }))?.level).toBe('error');
    expect(parseLogLine(line({ messageType: 'Fault', eventMessage: 'f' }))?.level).toBe('error');
  });

  it('skips headers, other events and garbage', () => {
    expect(parseLogLine('Filtering the log data using "process == \\"X\\""')).toBeNull();
    expect(parseLogLine(line({ eventType: 'activityCreateEvent', eventMessage: 'x' }))).toBeNull();
    expect(parseLogLine('{not json')).toBeNull();
    expect(parseLogLine(line({ eventMessage: 1 }))).toBeNull();
  });
});

describe('AppLogStream', () => {
  it('streams the app process log and drains buffered entries across chunk boundaries', () => {
    const runner = new FakeRunner();
    const stream = new AppLogStream(new Simctl('/set', runner), 'UDID', 'My "App"');
    stream.start();
    const { args, child } = runner.spawned[0]!;
    expect(args).toEqual([
      'xcrun',
      'simctl',
      '--set',
      '/set',
      'spawn',
      'UDID',
      'log',
      'stream',
      '--style',
      'ndjson',
      '--level',
      'info',
      '--predicate',
      'process == "My \\"App\\""',
    ]);
    const text = `Filtering...\n${line({ eventMessage: 'one' })}\n${line({ eventMessage: 'two' })}\n`;
    child.stdout.write(text.slice(0, 40));
    child.stdout.write(text.slice(40));
    expect(stream.drain().map((e) => e.message)).toEqual(['one', 'two']);
    expect(stream.drain()).toEqual([]);
    stream.stop();
    expect(child.signals).toEqual(['SIGTERM']);
  });

  it('reports an unexpected end of the stream and dropped entries', () => {
    const runner = new FakeRunner();
    const stream = new AppLogStream(new Simctl(undefined, runner), 'UDID', 'App');
    stream.start();
    const { child } = runner.spawned[0]!;
    child.stdout.write(
      Array.from({ length: 5002 }, (_, i) => line({ eventMessage: `m${i}` })).join('\n') + '\n',
    );
    child.exit(1);
    const drained = stream.drain();
    expect(drained[0]).toMatchObject({
      level: 'warn',
      source: 'driver',
      message: expect.stringContaining('3 older log entries were dropped'),
    });
    expect(drained.at(-1)).toMatchObject({
      level: 'warn',
      source: 'driver',
      message: expect.stringContaining('log stream ended'),
    });
  });
});
