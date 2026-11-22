import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Serves a single-page app from `root`, falling back to `index.html` for unknown paths. Without
 * a build it answers 503 with the build command, so runs that only need the API (native
 * targets) still start; `missingBuild` reports that case at startup.
 */
export async function startStaticServer(root: string, port: number): Promise<Server> {
  const base = resolve(root);
  const index = join(base, 'index.html');
  const server = createServer((req, res) => {
    void (async () => {
      if (!(await isFile(index))) {
        res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(missingBuildMessage(base));
        return;
      }
      const { pathname } = new URL(req.url ?? '/', 'http://localhost');
      const candidate = normalize(join(base, decodeURIComponent(pathname)));
      const file = candidate.startsWith(base) && (await isFile(candidate)) ? candidate : index;
      res.writeHead(200, {
        'content-type': MIME[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-cache',
      });
      createReadStream(file).pipe(res);
    })();
  });
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, () => resolvePromise(server));
  });
}

/** Why the static server can not serve the app yet, or `null` when `root` holds a build. */
export async function missingBuild(root: string): Promise<string | null> {
  const base = resolve(root);
  return (await isFile(join(base, 'index.html'))) ? null : missingBuildMessage(base);
}

function missingBuildMessage(base: string): string {
  return `No web build found at ${base}. Run \`pnpm build:web\` first.`;
}
