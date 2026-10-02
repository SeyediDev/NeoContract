import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../lib/database.mjs';
import { createApi } from '../lib/http-api.mjs';

async function request(api, url, method = 'GET', headers = {}, payload) {
  let status; let body = '';
  const req={ method, url, headers: { host: 'localhost', ...headers }, socket: { remoteAddress: '127.0.0.1' } };
  if(payload!==undefined)req[Symbol.asyncIterator]=async function*(){yield Buffer.from(JSON.stringify(payload));};
  await api.handler(req, {
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

test('contract admin can list users and update status and roles', async () => {
  process.env.NEOCONTRACT_TRUST_PROXY_AUTH = 'true';
  const db = await createDatabase({ dataDir: 'memory://' });
  await db.query("UPDATE contracts.app_users SET status='active' WHERE subject='demo-admin'");
  const api = await createApi({ database: db, authMode: 'oidc-proxy' });
  const headers = {'x-auth-request-sub': 'demo-admin', 'x-auth-request-email': 'demo.admin@fanasa.example'};
  const list = await request(api, '/api/users', 'GET', headers);
  assert.equal(list.status, 200);
  assert.equal(list.value.users.length, 4);
  assert.ok(list.value.roles.some(role => role.role_key === 'viewer'));
  const viewer = list.value.users.find(user => user.subject === 'demo-viewer');
  const updated = await request(api, `/api/users/${viewer.id}`, 'PATCH', headers, {status:'active',roles:['viewer','account_manager']});
  assert.equal(updated.status, 200);
  const after = await request(api, '/api/users', 'GET', headers);
  assert.deepEqual(after.value.users.find(user=>user.id===viewer.id).roles,['account_manager','viewer']);
  const audit = await db.query("SELECT action,actor_user_id,target_user_id FROM contracts.app_user_audit");
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0].action, 'access_updated');
  await api.close();
});
