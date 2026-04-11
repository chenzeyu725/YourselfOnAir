const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createServer } = require('../server');

function request(pathname, port, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const headers = {};
    let payload;
    if (body !== null) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
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
    assert.ok(parsed.length >= 2);
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

test('create workspace via POST', async (t) => {
  await withServer(t, async (port) => {
    const createRes = await request('/api/workspaces', port, 'POST', {
      name: '研发协作空间',
      owner: 'engineering',
      visibility: 'team'
    });
    const created = JSON.parse(createRes.body);

    assert.equal(createRes.status, 201);
    assert.equal(created.name, '研发协作空间');

    const listRes = await request('/api/workspaces', port);
    const list = JSON.parse(listRes.body);
    assert.ok(list.some((x) => x.id === created.id));
  });
});

test('create task and update status via PATCH', async (t) => {
  await withServer(t, async (port) => {
    const createRes = await request('/api/tasks', port, 'POST', {
      kind: 'analysis',
      prompt: '对比两版方案风险'
    });
    const created = JSON.parse(createRes.body);

    assert.equal(createRes.status, 201);
    assert.equal(created.status, 'queued');

    const patchRes = await request(`/api/tasks/${created.id}/status`, port, 'PATCH', { status: 'running' });
    const updated = JSON.parse(patchRes.body);

    assert.equal(patchRes.status, 200);
    assert.equal(updated.status, 'running');
  });
});

test('returns 400 for invalid json body', async (t) => {
  await withServer(t, async (port) => {
    const rawRes = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/workspaces',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        }
      );
      req.on('error', reject);
      req.write('{bad-json');
      req.end();
    });

    const parsed = JSON.parse(rawRes.body);
    assert.equal(rawRes.status, 400);
    assert.equal(parsed.error, 'invalid json body');
  });
});

test('returns 400 for invalid workspace payload', async (t) => {
  await withServer(t, async (port) => {
    const res = await request('/api/workspaces', port, 'POST', { owner: 'ops' });
    const parsed = JSON.parse(res.body);

    assert.equal(res.status, 400);
    assert.equal(parsed.error, 'name and owner are required');
  });
});

test('blocks directory traversal', async (t) => {
  await withServer(t, async (port) => {
    const res = await request('/../server.js', port);
    assert.equal(res.status, 403);
  });
});
