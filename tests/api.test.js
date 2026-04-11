const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
process.env.WRITE_API_KEY = 'test-write-key';
process.env.WRITE_QUOTA_PER_DAY = '2';
const { createServer, resetWriteUsage } = require('../server');

function request(pathname, port, method = 'GET', body = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const headers = { ...extraHeaders };
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
  resetWriteUsage();
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
    }, { 'x-api-key': 'test-write-key' });
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
    }, { 'x-api-key': 'test-write-key' });
    const created = JSON.parse(createRes.body);

    assert.equal(createRes.status, 201);
    assert.equal(created.status, 'queued');

    const patchRes = await request(
      `/api/tasks/${created.id}/status`,
      port,
      'PATCH',
      { status: 'running' },
      { 'x-api-key': 'test-write-key' }
    );
    const updated = JSON.parse(patchRes.body);

    assert.equal(patchRes.status, 200);
    assert.equal(updated.status, 'running');
  });
});

test('create and approve policy change request', async (t) => {
  await withServer(t, async (port) => {
    const createRes = await request('/api/policy-change-requests', port, 'POST', {
      policyId: 'policy-001',
      proposedRule: '外部沟通仅可披露“仍在验证商业化路径”，禁止披露收入规模与预测值。',
      reason: '避免多渠道披露口径不一致',
      requestedBy: 'ops-analyst'
    }, { 'x-api-key': 'test-write-key' });
    const created = JSON.parse(createRes.body);

    assert.equal(createRes.status, 201);
    assert.equal(created.status, 'pending');

    const approveRes = await request(
      `/api/policy-change-requests/${created.id}/approve`,
      port,
      'PATCH',
      { status: 'approved', approvedBy: 'compliance-lead' },
      { 'x-api-key': 'test-write-key' }
    );
    const approved = JSON.parse(approveRes.body);
    assert.equal(approveRes.status, 200);
    assert.equal(approved.status, 'approved');
    assert.equal(approved.approvedBy, 'compliance-lead');

    const policiesRes = await request('/api/policies', port);
    const policies = JSON.parse(policiesRes.body);
    const targetPolicy = policies.find((p) => p.id === 'policy-001');
    assert.equal(targetPolicy.changedBy, 'compliance-lead');
    assert.equal(targetPolicy.rule, created.proposedRule);
  });
});

test('returns 400 when approving with invalid status', async (t) => {
  await withServer(t, async (port) => {
    const createRes = await request('/api/policy-change-requests', port, 'POST', {
      policyId: 'policy-001',
      proposedRule: '只允许发布已公开信息，不允许给出预测数字。',
      reason: '管控外部风险',
      requestedBy: 'ops-analyst'
    }, { 'x-api-key': 'test-write-key' });
    const created = JSON.parse(createRes.body);

    const approveRes = await request(
      `/api/policy-change-requests/${created.id}/approve`,
      port,
      'PATCH',
      { status: 'pending', approvedBy: 'compliance-lead' },
      { 'x-api-key': 'test-write-key' }
    );
    const parsed = JSON.parse(approveRes.body);
    assert.equal(approveRes.status, 400);
    assert.equal(parsed.error, 'only approved status is supported for PATCH');
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
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': 'test-write-key'
          }
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
    const res = await request('/api/workspaces', port, 'POST', { owner: 'ops' }, { 'x-api-key': 'test-write-key' });
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

test('returns 401 for write api without x-api-key', async (t) => {
  await withServer(t, async (port) => {
    const res = await request('/api/tasks', port, 'POST', {
      kind: 'chat',
      prompt: 'test auth'
    });
    const parsed = JSON.parse(res.body);

    assert.equal(res.status, 401);
    assert.equal(parsed.error, 'unauthorized: missing or invalid x-api-key');
  });
});

test('returns 429 when write quota exceeded', async (t) => {
  await withServer(t, async (port) => {
    const headers = { 'x-api-key': 'test-write-key' };
    const first = await request('/api/tasks', port, 'POST', { kind: 'chat', prompt: 'a' }, headers);
    const second = await request('/api/tasks', port, 'POST', { kind: 'chat', prompt: 'b' }, headers);
    const third = await request('/api/tasks', port, 'POST', { kind: 'chat', prompt: 'c' }, headers);
    const parsed = JSON.parse(third.body);

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(third.status, 429);
    assert.equal(parsed.error, 'write quota exceeded: 2/day');
  });
});
