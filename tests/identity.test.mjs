import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../lib/database.mjs';
import { createApi } from '../lib/http-api.mjs';

async function request(api, url, method = 'GET', headers = {}) {
  let status; let body = '';
  await api.handler({ method, url, headers: { host: 'localhost', ...headers }, socket: { remoteAddress: '127.0.0.1' } }, {
    headersSent: false,
    writeHead(value) { status = value; },
    end(value) { body = value || ''; }
  });
  return { status, value: body ? JSON.parse(body) : null };
}

test('OIDC proxy maps an active Fanasa identity to its tenant and role', async () => {
  process.env.NEOCONTRACT_TRUST_PROXY_AUTH = 'true';
  const db = await createDatabase({ dataDir: 'memory://' });
  await db.query("UPDATE contracts.app_users SET status='active' WHERE subject='demo-admin'");
  const api = await createApi({ database: db, authMode: 'oidc-proxy' });
  const result = await request(api, '/api/bootstrap', 'GET', {
    'x-auth-request-sub': 'demo-admin',
    'x-auth-request-email': 'demo.admin@fanasa.example'
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.value.access.identity.roles, ['contract_admin']);
  assert.equal(result.value.tenant.slug, 'titan');
  await api.close();
});

test('viewer identity cannot mutate contract data', async () => {
  process.env.NEOCONTRACT_TRUST_PROXY_AUTH = 'true';
  const db = await createDatabase({ dataDir: 'memory://' });
  await db.query("UPDATE contracts.app_users SET status='active' WHERE subject='demo-viewer'");
  const api = await createApi({ database: db, authMode: 'oidc-proxy' });
  const result = await request(api, '/api/settings', 'PUT', {
    'x-auth-request-sub': 'demo-viewer',
    'x-auth-request-email': 'demo.viewer@fanasa.example'
  });
  assert.equal(result.status, 403);
  assert.equal(result.value.code, 'role_forbidden');
  await api.close();
});
