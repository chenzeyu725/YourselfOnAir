const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { server } = require('../server');

function get(pathname, port) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method: 'GET' }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('health endpoint returns ok', async (t) => {
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  t.after(() => server.close());

  const res = await get('/api/health', port);
  const parsed = JSON.parse(res.body);

  assert.equal(res.status, 200);
  assert.equal(parsed.ok, true);
});

test('workspaces endpoint returns list', async (t) => {
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  t.after(() => server.close());

  const res = await get('/api/workspaces', port);
  const parsed = JSON.parse(res.body);

  assert.equal(res.status, 200);
  assert.ok(Array.isArray(parsed));
  assert.ok(parsed.length > 0);
});
