import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Cross-process mutex on a directory (`mkdir` is atomic). Playwright workers are separate
 * processes, so creating an AVD or its clean snapshot must be serialized on disk. A lock whose
 * owner process is gone, or that is older than `staleMs`, is taken over.
 */
export async function withFileLock<T>(
  lockDir: string,
  fn: () => Promise<T>,
  opts: { timeoutMs?: number; staleMs?: number; pollMs?: number } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 15 * 60_000;
  const staleMs = opts.staleMs ?? 20 * 60_000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await mkdir(lockDir);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      if (await isStale(lockDir, staleMs)) {
        await rm(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out after ${timeoutMs}ms waiting for lock ${lockDir}.`, {
          cause: e,
        });
      }
      await new Promise((r) => setTimeout(r, opts.pollMs ?? 500));
    }
  }
  await writeFile(join(lockDir, 'owner'), String(process.pid));
  try {
    return await fn();
  } finally {
    await rm(lockDir, { recursive: true, force: true });
  }
}

async function isStale(lockDir: string, staleMs: number): Promise<boolean> {
  try {
    const info = await stat(lockDir);
    if (Date.now() - info.mtimeMs > staleMs) return true;
    const pid = Number(await readFile(join(lockDir, 'owner'), 'utf8').catch(() => ''));
    if (!pid) return false; // being created right now
    try {
      process.kill(pid, 0);
      return false;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === 'ESRCH';
    }
  } catch {
    return false;
  }
}
