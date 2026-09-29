import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultPublicRoot = fileURLToPath(new URL('./public/', import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function isWithin(root, file) {
  const path = relative(root, file);
  return path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path);
}

function reply(req, res, status, message, headers = {}) {
  const data = Buffer.from(message);
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  res.end(req.method === 'HEAD' ? undefined : data);
}

export function createStaticServer({ publicRoot = defaultPublicRoot, apiHandler } = {}) {
  const root = resolve(publicRoot);
  return createServer(async (req, res) => {
    if (apiHandler && await apiHandler(req, res)) return;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      reply(req, res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
      return;
    }

    const target = req.url || '/';
    let requested;
    try {
      if (!target.startsWith('/')) throw new Error('Invalid request target');
      requested = decodeURIComponent(target.split('?')[0]);
      if (/[\x00-\x1f\x7f]/.test(requested)) throw new Error('Invalid path');
    } catch {
      reply(req, res, 400, 'Bad Request');
      return;
    }

    // Treat both separator styles as paths, including encoded Windows traversal.
    requested = requested.replace(/\\/g, '/');
    const file = resolve(root, '.' + (requested === '/' ? '/index.html' : requested));
    // Colons may name NTFS alternate data streams and are not public asset names.
    if (!isWithin(root, file) || requested.includes(':')) {
      reply(req, res, 403, 'Forbidden');
      return;
    }

    try {
      // Enforce the same boundary after resolving symlinks and Windows junctions.
      const [physicalRoot, physicalFile] = await Promise.all([realpath(root), realpath(file)]);
      if (!isWithin(physicalRoot, physicalFile)) {
        reply(req, res, 403, 'Forbidden');
        return;
      }
      const metadata = await stat(physicalFile);
      if (!metadata.isFile()) {
        reply(req, res, 404, 'Not Found');
        return;
      }
      const data = req.method === 'HEAD' ? null : await readFile(physicalFile);
      res.writeHead(200, {
        'Content-Type': types[extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': data ? data.length : metadata.size,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(data ?? undefined);
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code)) {
        reply(req, res, 404, 'Not Found');
      } else if (['EACCES', 'EPERM'].includes(error.code)) {
        reply(req, res, 403, 'Forbidden');
      } else {
        reply(req, res, 500, 'Internal Server Error');
      }
    }
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { createApi } = await import('./lib/http-api.mjs');
  const app = await createApi({ dataDir: process.env.NEOCONTRACT_DATA_DIR, connectionString: process.env.NEOCONTRACT_DATABASE_URL });
  const server = createStaticServer({ apiHandler: app.handler });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(async () => { await app.close(); process.exit(0); }));
  const port = Number(process.env.PORT || 4173);
  server.listen(port, '127.0.0.1', () => {
    console.log(`NeoContract demo: http://127.0.0.1:${server.address().port}`);
  });
}
