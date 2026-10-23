import test from 'node:test';
import assert from 'node:assert/strict';

// This local-only contract suite expects a fixture started without bindings.
const base = 'http://127.0.0.1:15189';
const id = '57de6bf9-14a3-4f73-8272-484ca031afc8';
async function request(path, status, method = 'GET') {
  const response = await fetch(base + path, { method, signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, status);
  const body = await response.text();
  assert.doesNotMatch(body, /Password|Host=|password=|StackTrace|Redis__Configuration/);
  return body ? JSON.parse(body) : null;
}

test('process liveness does not require database bindings', async () => {
  assert.deepEqual(await request('/health/live', 200), { alive: true });
});
test('missing bindings never imply readiness', async () => {
  assert.deepEqual(await request('/health/ready', 503), { ready: false });
});
test('empty UUID is rejected before data operations', async () => {
  await request('/acceptance/probes/00000000-0000-0000-0000-000000000000', 400, 'POST');
});
test('write with missing bindings fails without disclosing connection details', async () => {
  assert.deepEqual(await request(`/acceptance/probes/${id}`, 503, 'POST'), { id, available: false });
});
test('read with missing bindings fails without inventing persisted data', async () => {
  assert.deepEqual(await request(`/acceptance/probes/${id}`, 503), { id, available: false });
});
test('non-UUID route cannot reach SQL or Redis operations', async () => {
  await request('/acceptance/probes/not-a-guid', 404);
});
