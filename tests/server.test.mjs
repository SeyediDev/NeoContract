import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { request } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createStaticServer } from '../server.mjs';

let fixtureRoot;
let server;
let port;
let symlinksAvailable = true;
const home = '<!doctype html><html lang="fa"><body>دموی قرارداد</body></html>';

function send(path, method = 'GET') {
  return new Promise((resolveResponse, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method }, res => {
      const chunks = [];
      res.on('data', data => chunks.push(data));
      res.on('end', () => resolveResponse({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks)
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'neocontract-http-'));
  const publicRoot = join(fixtureRoot, 'public');
  await Promise.all([mkdir(publicRoot), mkdir(join(fixtureRoot, 'public-extra'))]);
  await Promise.all([
    writeFile(join(publicRoot, 'index.html'), home),
    writeFile(join(publicRoot, 'app.js'), 'console.log("demo");'),
    writeFile(join(publicRoot, 'styles.css'), 'body { color: #123; }'),
    writeFile(join(publicRoot, 'catalog.json'), '{"services":87}'),
    writeFile(join(publicRoot, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>'),
    writeFile(join(publicRoot, 'raw.bin'), Buffer.from([0, 1, 2, 255])),
    writeFile(join(publicRoot, 'report file.txt'), 'report'),
    writeFile(join(fixtureRoot, 'public-extra', 'secret.txt'), 'outside-public'),
    mkdir(join(publicRoot, 'folder')),
    mkdir(join(publicRoot, 'nested'))
  ]);
  await writeFile(join(publicRoot, 'nested', 'inside.txt'), 'inside-public');
  try {
    const kind = process.platform === 'win32' ? 'junction' : 'dir';
    await symlink(join(fixtureRoot, 'public-extra'), join(publicRoot, 'outside-link'), kind);
    await symlink(join(publicRoot, 'nested'), join(publicRoot, 'inside-link'), kind);
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) throw error;
    symlinksAvailable = false;
  }
  server = createStaticServer({ publicRoot });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  port = server.address().port;
});

after(async () => {
  if (server?.listening) await new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
  if (fixtureRoot) {
    // Only remove the uniquely named temporary fixture created by this suite.
    assert.equal(dirname(resolve(fixtureRoot)), resolve(tmpdir()));
    assert.ok(basename(fixtureRoot).startsWith('neocontract-http-'));
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('serves the index and static assets with MIME types and byte lengths', async () => {
  const checks = [
    ['/', 'text/html; charset=utf-8', home],
    ['/app.js?v=123', 'text/javascript; charset=utf-8', 'console.log("demo");'],
    ['/styles.css', 'text/css; charset=utf-8', 'body { color: #123; }'],
    ['/catalog.json', 'application/json; charset=utf-8', '{"services":87}'],
    ['/icon.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"/>'],
    ['/report%20file.txt', 'application/octet-stream', 'report']
  ];
  for (const [path, contentType, body] of checks) {
    const result = await send(path);
    assert.equal(result.status, 200, path);
    assert.equal(result.headers['content-type'], contentType, path);
    assert.equal(result.headers['content-length'], String(Buffer.byteLength(body)), path);
    assert.equal(result.headers['x-content-type-options'], 'nosniff', path);
    assert.equal(result.body.toString(), body, path);
  }
  const binary = await send('/raw.bin');
  assert.deepEqual(binary.body, Buffer.from([0, 1, 2, 255]));
});

test('HEAD returns GET headers without a response body', async () => {
  for (const path of ['/', '/raw.bin', '/missing.js', '/%xx', '/../public-extra/secret.txt']) {
    const get = await send(path);
    const head = await send(path, 'HEAD');
    assert.equal(head.status, get.status, path);
    for (const header of ['content-type', 'content-length', 'cache-control']) {
      assert.equal(head.headers[header], get.headers[header], path);
    }
    assert.equal(head.body.length, 0, path);
  }
});

test('unsupported methods return 405 with the allowed methods', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const result = await send('/app.js', method);
    assert.equal(result.status, 405, method);
    assert.equal(result.headers.allow, 'GET, HEAD', method);
    assert.equal(result.body.toString(), 'Method Not Allowed', method);
  }
});

test('malformed encoding, invalid request targets and control characters return 400', async () => {
  for (const path of ['/%', '/%ZZ', '/%E0%A4%A', '/%C0%AF', '/%00', '/%0A', '/%7F', 'http://localhost/app.js']) {
    const result = await send(path);
    assert.equal(result.status, 400, path);
    assert.equal(result.body.toString(), 'Bad Request', path);
  }
  assert.equal((await send('/app.js')).status, 200, 'a bad request must not crash the server');
});

test('path traversal cannot read siblings with a shared public prefix', async () => {
  for (const path of [
    '/../public-extra/secret.txt',
    '/%2e%2e/public-extra/secret.txt',
    '/..%2fpublic-extra%2fsecret.txt',
    '/..%5cpublic-extra%5csecret.txt',
    '/nested/../../public-extra/secret.txt',
    '/index.html%3A%24DATA'
  ]) {
    const result = await send(path);
    assert.equal(result.status, 403, path);
    assert.equal(result.body.toString(), 'Forbidden', path);
    assert.ok(!result.body.includes('outside-public'), path);
  }
});

test('physical path boundary blocks symlink escapes and permits internal links', async t => {
  if (!symlinksAvailable) return t.skip('This environment does not permit symlink/junction creation.');
  const outside = await send('/outside-link/secret.txt');
  assert.equal(outside.status, 403);
  assert.equal(outside.body.toString(), 'Forbidden');
  const inside = await send('/inside-link/inside.txt');
  assert.equal(inside.status, 200);
  assert.equal(inside.body.toString(), 'inside-public');
});

test('missing files and directories return 404 without an HTML fallback', async () => {
  for (const path of ['/missing.js', '/missing.css', '/missing.json', '/missing-route', '/folder', '/folder/']) {
    const result = await send(path);
    assert.equal(result.status, 404, path);
    assert.equal(result.headers['content-type'], 'text/plain; charset=utf-8', path);
    assert.equal(result.body.toString(), 'Not Found', path);
  }
});

test('a missing index returns 404 and the server can still serve other files', async () => {
  await rm(join(fixtureRoot, 'public', 'index.html'));
  assert.equal((await send('/')).status, 404);
  assert.equal((await send('/app.js')).status, 200);
});
