const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createServer } = require('../server');

function request(pathname, port, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function withServer(t, fn) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  await fn(server.address().port);
}

test('health endpoint returns ok', async (t) => {
  await withServer(t, async (port) => {
    const res = await request('/api/health', port);
    const parsed = JSON.parse(res.body);

    assert.equal(res.status, 200);
    assert.equal(parsed.ok, true);
  });
});

test('workspaces endpoint returns list', async (t) => {
  await withServer(t, async (port) => {
    const res = await request('/api/workspaces', port);
    const parsed = JSON.parse(res.body);

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(parsed));
    assert.ok(parsed.length > 0);
  });
});

test('distillation endpoints expose self and expert structures', async (t) => {
  await withServer(t, async (port) => {
    const selfRes = await request('/api/distillation/self', port);
    const expertRes = await request('/api/distillation/expert', port);

    const selfParsed = JSON.parse(selfRes.body);
    const expertParsed = JSON.parse(expertRes.body);

    assert.equal(selfRes.status, 200);
    assert.equal(expertRes.status, 200);
    assert.ok(Array.isArray(selfParsed.workMemory.preferredWorkflow));
    assert.ok(Array.isArray(expertParsed.fiveLayers.mentalModels));
  });
});

test('fusion preview returns weighted strategy', async (t) => {
  await withServer(t, async (port) => {
    const res = await request('/api/fusion/preview', port);
    const parsed = JSON.parse(res.body);

    assert.equal(res.status, 200);
    assert.equal(typeof parsed.weights.enterpriseFacts, 'number');
    assert.equal(typeof parsed.sampleOutput, 'string');
  });
});

test('rejects non-GET method with 405', async (t) => {
  await withServer(t, async (port) => {
    const res = await request('/api/health', port, 'POST');
    const parsed = JSON.parse(res.body);

    assert.equal(res.status, 405);
    assert.equal(parsed.error, 'Method Not Allowed');
  });
});

test('blocks directory traversal', async (t) => {
  await withServer(t, async (port) => {
    const res = await request('/../server.js', port);
    assert.equal(res.status, 403);
  });
});
