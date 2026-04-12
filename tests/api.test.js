const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.WRITE_API_KEY = 'test-write-key';
process.env.WRITE_QUOTA_PER_DAY = '3';
const { createServer, resetWriteUsage, loadStateFromDisk, persistStateToDisk } = require('../server');
const { state, resetState } = require('../api/store');

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
  resetState();
  resetWriteUsage();
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  await fn(server.address().port);
}

test('persists state to disk when STATE_FILE is configured', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoa-'));
  const stateFile = path.join(tmpDir, 'state.json');
  const originalStateFile = process.env.STATE_FILE;
  process.env.STATE_FILE = stateFile;

  try {
    resetState();
    const beforeCount = state.workspaces.length;
    state.workspaces.push({
      id: 'ws-999',
      name: '持久化测试空间',
      owner: 'qa',
      updatedAt: '2026-04-12',
      visibility: 'team'
    });
    persistStateToDisk();

    resetState();
    assert.equal(state.workspaces.some((x) => x.id === 'ws-999'), false);

    loadStateFromDisk();
    assert.equal(state.workspaces.length, beforeCount + 1);
    assert.equal(state.workspaces.some((x) => x.id === 'ws-999'), true);
  } finally {
    if (originalStateFile === undefined) {
      delete process.env.STATE_FILE;
    } else {
      process.env.STATE_FILE = originalStateFile;
    }
    resetState();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('persists audit logs and write usage to disk when STATE_FILE is configured', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoa-'));
  const stateFile = path.join(tmpDir, 'state.json');
  const originalStateFile = process.env.STATE_FILE;
  process.env.STATE_FILE = stateFile;

  try {
    await withServer(t, async (port) => {
      const headers = { 'x-api-key': 'test-write-key' };
      const createRes = await request('/api/workspaces', port, 'POST', {
        name: '持久化审计空间',
        owner: 'qa'
      }, headers);
      assert.equal(createRes.status, 201);
    });

    resetState();
    resetWriteUsage();
    loadStateFromDisk();

    assert.equal(state.workspaces.some((item) => item.name === '持久化审计空间'), true);
    const usage = await new Promise((resolve, reject) => {
      const server = createServer();
      server.listen(0, async () => {
        const port = server.address().port;
        try {
          const usageRes = await request('/api/write-usage', port, 'GET', null, { 'x-api-key': 'test-write-key' });
          const usagePayload = JSON.parse(usageRes.body);
          const logsRes = await request('/api/audit-logs', port);
          const logs = JSON.parse(logsRes.body);
          server.close(() => resolve({ usageRes, usagePayload, logs }));
        } catch (error) {
          server.close(() => reject(error));
        }
      });
    });

    assert.equal(usage.usageRes.status, 200);
    assert.equal(usage.usagePayload.used, 1);
    assert.equal(Array.isArray(usage.logs), true);
    assert.equal(usage.logs.some((log) => log.action === '/api/workspaces' && log.method === 'POST'), true);
  } finally {
    if (originalStateFile === undefined) {
      delete process.env.STATE_FILE;
    } else {
      process.env.STATE_FILE = originalStateFile;
    }
    resetState();
    resetWriteUsage();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

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

test('workspaces endpoint supports q/owner/sort/limit query', async (t) => {
  await withServer(t, async (port) => {
    const res = await request('/api/workspaces?owner=chen&q=%E9%9D%92&sortBy=name&order=desc&limit=1', port);
    const parsed = JSON.parse(res.body);

    assert.equal(res.status, 200);
    assert.equal(Array.isArray(parsed), true);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].owner, 'chen');
    assert.ok(parsed[0].name.includes('青'));
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

test('tasks endpoint supports status filter and offset pagination', async (t) => {
  await withServer(t, async (port) => {
    const headers = { 'x-api-key': 'test-write-key' };
    const createdRes = await request('/api/tasks', port, 'POST', {
      kind: 'analysis',
      prompt: '用于状态筛选测试'
    }, headers);
    const created = JSON.parse(createdRes.body);
    assert.equal(createdRes.status, 201);

    const updateRes = await request(
      `/api/tasks/${created.id}/status`,
      port,
      'PATCH',
      { status: 'running' },
      headers
    );
    assert.equal(updateRes.status, 200);

    const res = await request('/api/tasks?status=running&sortBy=id&order=asc&offset=0&limit=1', port);
    const parsed = JSON.parse(res.body);

    assert.equal(res.status, 200);
    assert.equal(Array.isArray(parsed), true);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].status, 'running');
  });
});

test('create task accepts valid workspaceId and can be filtered by workspaceId', async (t) => {
  await withServer(t, async (port) => {
    const headers = { 'x-api-key': 'test-write-key' };
    const createRes = await request('/api/tasks', port, 'POST', {
      kind: 'analysis',
      prompt: '关联到指定工作空间',
      workspaceId: 'ws-001'
    }, headers);
    const created = JSON.parse(createRes.body);

    assert.equal(createRes.status, 201);
    assert.equal(created.workspaceId, 'ws-001');

    const listRes = await request('/api/tasks?workspaceId=ws-001&sortBy=id&order=desc&limit=1', port);
    const list = JSON.parse(listRes.body);
    assert.equal(listRes.status, 200);
    assert.equal(Array.isArray(list), true);
    assert.equal(list.length, 1);
    assert.equal(list[0].workspaceId, 'ws-001');
  });
});

test('returns 400 when creating task with invalid workspaceId', async (t) => {
  await withServer(t, async (port) => {
    const res = await request('/api/tasks', port, 'POST', {
      kind: 'analysis',
      prompt: '非法工作空间',
      workspaceId: 'ws-404'
    }, { 'x-api-key': 'test-write-key' });
    const parsed = JSON.parse(res.body);

    assert.equal(res.status, 400);
    assert.equal(parsed.error, 'workspaceId is invalid');
  });
});

test('task templates endpoint returns list', async (t) => {
  await withServer(t, async (port) => {
    const res = await request('/api/task-templates?sortBy=id&order=asc', port);
    const parsed = JSON.parse(res.body);

    assert.equal(res.status, 200);
    assert.equal(Array.isArray(parsed), true);
    assert.ok(parsed.length >= 2);
    assert.equal(parsed[0].id, 'tpl-001');
  });
});

test('experts endpoint returns list and supports active status filter', async (t) => {
  await withServer(t, async (port) => {
    const res = await request('/api/experts?status=true&sortBy=id&order=asc', port);
    const parsed = JSON.parse(res.body);

    assert.equal(res.status, 200);
    assert.equal(Array.isArray(parsed), true);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].id, 'exp-001');
    assert.equal(parsed[0].isActive, true);
  });
});

test('create expert and activate via PATCH', async (t) => {
  await withServer(t, async (port) => {
    const headers = { 'x-api-key': 'test-write-key' };
    const createRes = await request('/api/experts', port, 'POST', {
      expertName: 'Finance Risk Lens',
      fiveLayers: {
        expressionDNA: '先红线后动作',
        mentalModels: ['风控分层', '损失厌恶'],
        decisionHeuristics: ['先定义坏结果', '再定义止损阈值'],
        antiPatterns: ['忽略现金流压力'],
        honestBoundaries: ['无法替代法务意见']
      }
    }, headers);
    const created = JSON.parse(createRes.body);
    assert.equal(createRes.status, 201);
    assert.equal(created.isActive, false);

    const activateRes = await request(`/api/experts/${created.id}/activate`, port, 'PATCH', {}, headers);
    const activated = JSON.parse(activateRes.body);
    assert.equal(activateRes.status, 200);
    assert.equal(activated.id, created.id);
    assert.equal(activated.isActive, true);

    const activeListRes = await request('/api/experts?status=true', port);
    const activeList = JSON.parse(activeListRes.body);
    assert.equal(activeListRes.status, 200);
    assert.equal(activeList.length, 1);
    assert.equal(activeList[0].id, created.id);

    const distillationRes = await request('/api/distillation/expert', port);
    const distillation = JSON.parse(distillationRes.body);
    assert.equal(distillationRes.status, 200);
    assert.equal(distillation.expertName, 'Finance Risk Lens');
  });
});

test('create task from template via POST', async (t) => {
  await withServer(t, async (port) => {
    const res = await request('/api/tasks/from-template', port, 'POST', {
      templateId: 'tpl-001',
      workspaceId: 'ws-001'
    }, { 'x-api-key': 'test-write-key' });
    const created = JSON.parse(res.body);

    assert.equal(res.status, 201);
    assert.equal(created.templateId, 'tpl-001');
    assert.equal(created.workspaceId, 'ws-001');
    assert.equal(created.kind, 'doc');
    assert.ok(created.prompt.includes('青云项目'));
  });
});

test('returns 404 when creating task from unknown template', async (t) => {
  await withServer(t, async (port) => {
    const res = await request('/api/tasks/from-template', port, 'POST', {
      templateId: 'tpl-404'
    }, { 'x-api-key': 'test-write-key' });
    const parsed = JSON.parse(res.body);

    assert.equal(res.status, 404);
    assert.equal(parsed.error, 'task template not found');
  });
});

test('returns 400 when creating task with invalid evidenceRefs', async (t) => {
  await withServer(t, async (port) => {
    const res = await request('/api/tasks', port, 'POST', {
      kind: 'analysis',
      prompt: '输出结论',
      evidenceRefs: ['doc-001', '']
    }, { 'x-api-key': 'test-write-key' });
    const parsed = JSON.parse(res.body);

    assert.equal(res.status, 400);
    assert.equal(parsed.error, 'evidenceRefs must be an array of non-empty strings when provided');
  });
});

test('trims evidenceRefs when creating task', async (t) => {
  await withServer(t, async (port) => {
    const res = await request('/api/tasks', port, 'POST', {
      kind: 'analysis',
      prompt: '输出结论',
      evidenceRefs: ['  doc-001#p2  ']
    }, { 'x-api-key': 'test-write-key' });
    const parsed = JSON.parse(res.body);

    assert.equal(res.status, 201);
    assert.deepEqual(parsed.evidenceRefs, ['doc-001#p2']);
  });
});

test('returns 400 for invalid list query params', async (t) => {
  await withServer(t, async (port) => {
    const res = await request('/api/tasks?limit=-1', port);
    const parsed = JSON.parse(res.body);

    assert.equal(res.status, 400);
    assert.equal(parsed.error, 'limit must be a non-negative integer');
  });
});

test('returns 400 when marking task done without evidenceRefs', async (t) => {
  await withServer(t, async (port) => {
    const createRes = await request('/api/tasks', port, 'POST', {
      kind: 'analysis',
      prompt: '输出结论'
    }, { 'x-api-key': 'test-write-key' });
    const created = JSON.parse(createRes.body);

    assert.equal(createRes.status, 201);

    const patchRes = await request(
      `/api/tasks/${created.id}/status`,
      port,
      'PATCH',
      { status: 'done' },
      { 'x-api-key': 'test-write-key' }
    );
    const parsed = JSON.parse(patchRes.body);
    assert.equal(patchRes.status, 400);
    assert.equal(parsed.error, 'task without evidenceRefs cannot be marked as done');
  });
});

test('allows marking task done when evidenceRefs exists', async (t) => {
  await withServer(t, async (port) => {
    const createRes = await request('/api/tasks', port, 'POST', {
      kind: 'analysis',
      prompt: '输出结论'
    }, { 'x-api-key': 'test-write-key' });

    const patchRes = await request(
      `/api/tasks/${JSON.parse(createRes.body).id}/status`,
      port,
      'PATCH',
      { status: 'done', evidenceRefs: ['doc-001#p3'] },
      { 'x-api-key': 'test-write-key' }
    );
    const updated = JSON.parse(patchRes.body);
    assert.equal(patchRes.status, 200);
    assert.equal(updated.status, 'done');
    assert.deepEqual(updated.evidenceRefs, ['doc-001#p3']);
  });
});

test('returns 400 when evidenceRefs payload is invalid', async (t) => {
  await withServer(t, async (port) => {
    const createRes = await request('/api/tasks', port, 'POST', {
      kind: 'analysis',
      prompt: '输出结论'
    }, { 'x-api-key': 'test-write-key' });
    const created = JSON.parse(createRes.body);

    const patchRes = await request(
      `/api/tasks/${created.id}/status`,
      port,
      'PATCH',
      { status: 'running', evidenceRefs: ['doc-001', ''] },
      { 'x-api-key': 'test-write-key' }
    );
    const parsed = JSON.parse(patchRes.body);
    assert.equal(patchRes.status, 400);
    assert.equal(parsed.error, 'evidenceRefs must be an array of non-empty strings when provided');
  });
});

test('updates evidenceRefs without changing status', async (t) => {
  await withServer(t, async (port) => {
    const createRes = await request('/api/tasks', port, 'POST', {
      kind: 'analysis',
      prompt: '补充证据'
    }, { 'x-api-key': 'test-write-key' });
    const created = JSON.parse(createRes.body);

    const patchRes = await request(
      `/api/tasks/${created.id}/status`,
      port,
      'PATCH',
      { evidenceRefs: ['doc-009#p2'] },
      { 'x-api-key': 'test-write-key' }
    );
    const updated = JSON.parse(patchRes.body);
    assert.equal(patchRes.status, 200);
    assert.equal(updated.status, 'queued');
    assert.deepEqual(updated.evidenceRefs, ['doc-009#p2']);
  });
});

test('returns 400 when status patch payload is empty', async (t) => {
  await withServer(t, async (port) => {
    const createRes = await request('/api/tasks', port, 'POST', {
      kind: 'analysis',
      prompt: '空更新'
    }, { 'x-api-key': 'test-write-key' });
    const created = JSON.parse(createRes.body);

    const patchRes = await request(
      `/api/tasks/${created.id}/status`,
      port,
      'PATCH',
      {},
      { 'x-api-key': 'test-write-key' }
    );
    const parsed = JSON.parse(patchRes.body);
    assert.equal(patchRes.status, 400);
    assert.equal(parsed.error, 'at least one of status or evidenceRefs is required');
  });
});

test('write usage endpoint returns current quota consumption', async (t) => {
  await withServer(t, async (port) => {
    const beforeRes = await request('/api/write-usage', port, 'GET', null, { 'x-api-key': 'test-write-key' });
    const before = JSON.parse(beforeRes.body);
    assert.equal(beforeRes.status, 200);
    assert.equal(beforeRes.headers['x-write-quota-limit'], '3');
    assert.equal(beforeRes.headers['x-write-quota-used'], '0');
    assert.equal(beforeRes.headers['x-write-quota-remaining'], '3');
    assert.equal(before.used, 0);
    assert.equal(before.remaining, 3);

    const createRes = await request('/api/workspaces', port, 'POST', {
      name: '配额测试空间',
      owner: 'qa'
    }, { 'x-api-key': 'test-write-key' });
    assert.equal(createRes.status, 201);

    const afterRes = await request('/api/write-usage', port, 'GET', null, { 'x-api-key': 'test-write-key' });
    const after = JSON.parse(afterRes.body);
    assert.equal(afterRes.status, 200);
    assert.equal(afterRes.headers['x-write-quota-used'], '1');
    assert.equal(afterRes.headers['x-write-quota-remaining'], '2');
    assert.equal(after.used, 1);
    assert.equal(after.remaining, 2);
    assert.equal(after.quotaPerDay, 3);
  });
});

test('write requests return quota headers after usage is consumed', async (t) => {
  await withServer(t, async (port) => {
    const res = await request('/api/tasks', port, 'POST', {
      kind: 'analysis',
      prompt: '校验响应头'
    }, { 'x-api-key': 'test-write-key' });

    assert.equal(res.status, 201);
    assert.equal(res.headers['x-write-quota-limit'], '3');
    assert.equal(res.headers['x-write-quota-used'], '1');
    assert.equal(res.headers['x-write-quota-remaining'], '2');
  });
});

test('audit logs capture write operations and support list queries', async (t) => {
  await withServer(t, async (port) => {
    const headers = { 'x-api-key': 'test-write-key' };
    const createRes = await request('/api/workspaces', port, 'POST', {
      name: '审计空间',
      owner: 'audit-user'
    }, headers);
    assert.equal(createRes.status, 201);

    const logsRes = await request('/api/audit-logs?actor=test-write-key&method=POST&limit=1&sortBy=id&order=desc', port);
    const logs = JSON.parse(logsRes.body);

    assert.equal(logsRes.status, 200);
    assert.equal(Array.isArray(logs), true);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].actor, 'test-write-key');
    assert.equal(logs[0].method, 'POST');
    assert.equal(logs[0].action, '/api/workspaces');
    assert.equal(typeof logs[0].createdAt, 'string');
  });
});

test('list endpoint supports date range query with dateField/dateFrom/dateTo', async (t) => {
  await withServer(t, async (port) => {
    const res = await request('/api/experts?dateField=createdAt&dateFrom=2026-04-11&dateTo=2026-04-11', port);
    const parsed = JSON.parse(res.body);

    assert.equal(res.status, 200);
    assert.equal(Array.isArray(parsed), true);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].id, 'exp-002');
  });
});

test('returns 400 when date range query is missing dateField', async (t) => {
  await withServer(t, async (port) => {
    const res = await request('/api/experts?dateFrom=2026-04-11', port);
    const parsed = JSON.parse(res.body);

    assert.equal(res.status, 400);
    assert.equal(parsed.error, 'dateField is required when dateFrom/dateTo is provided');
  });
});

test('returns 400 when date range query has invalid boundaries', async (t) => {
  await withServer(t, async (port) => {
    const formatRes = await request('/api/experts?dateField=createdAt&dateFrom=2026/04/11', port);
    const formatParsed = JSON.parse(formatRes.body);
    assert.equal(formatRes.status, 400);
    assert.equal(formatParsed.error, 'dateFrom must be in YYYY-MM-DD format');

    const orderRes = await request('/api/experts?dateField=createdAt&dateFrom=2026-04-12&dateTo=2026-04-11', port);
    const orderParsed = JSON.parse(orderRes.body);
    assert.equal(orderRes.status, 400);
    assert.equal(orderParsed.error, 'dateFrom must be <= dateTo');
  });
});

test('write usage endpoint rejects request without api key', async (t) => {
  await withServer(t, async (port) => {
    const res = await request('/api/write-usage', port);
    const parsed = JSON.parse(res.body);
    assert.equal(res.status, 401);
    assert.equal(parsed.error, 'unauthorized: missing or invalid x-api-key');
  });
});

test('state export endpoint returns portable snapshot with auth', async (t) => {
  await withServer(t, async (port) => {
    const headers = { 'x-api-key': 'test-write-key' };
    const createRes = await request('/api/workspaces', port, 'POST', {
      name: '导出快照样本空间',
      owner: 'qa'
    }, headers);
    assert.equal(createRes.status, 201);

    const exportRes = await request('/api/state/export', port, 'GET', null, headers);
    const payload = JSON.parse(exportRes.body);

    assert.equal(exportRes.status, 200);
    assert.equal(payload.__format, 'yoa-state-v2');
    assert.equal(typeof payload.exportedAt, 'string');
    assert.equal(Array.isArray(payload.state.workspaces), true);
    assert.equal(Array.isArray(payload.writeUsageEntries), true);
    assert.equal(Array.isArray(payload.auditLogs), true);
    assert.equal(payload.auditLogs.some((log) => log.action === '/api/workspaces'), true);
  });
});

test('state export endpoint rejects request without api key', async (t) => {
  await withServer(t, async (port) => {
    const res = await request('/api/state/export', port);
    const parsed = JSON.parse(res.body);

    assert.equal(res.status, 401);
    assert.equal(parsed.error, 'unauthorized: missing or invalid x-api-key');
  });
});

test('state import endpoint imports yoa-state-v2 snapshot and keeps quota accounting', async (t) => {
  await withServer(t, async (port) => {
    const today = new Date().toISOString().slice(0, 10);
    const payload = {
      __format: 'yoa-state-v2',
      state: {
        workspaces: [
          {
            id: 'ws-777',
            name: '导入工作空间',
            owner: 'importer',
            updatedAt: '2026-04-12',
            visibility: 'team'
          }
        ],
        documents: [],
        tasks: [],
        taskTemplates: [],
        policies: [],
        experts: [],
        policyChangeRequests: [],
        distillation: {
          self: {},
          expert: {},
          provenance: {}
        },
        fusionPreview: {},
        billing: {}
      },
      writeUsageEntries: [[`test-write-key::${today}`, 1]],
      auditLogs: [
        {
          id: 'audit-import-seed',
          createdAt: '2026-04-12T00:00:00.000Z',
          action: '/seed',
          method: 'POST',
          actor: 'seed'
        }
      ]
    };

    const importRes = await request('/api/state/import', port, 'POST', payload, { 'x-api-key': 'test-write-key' });
    const imported = JSON.parse(importRes.body);
    assert.equal(importRes.status, 200);
    assert.equal(imported.ok, true);
    assert.equal(imported.counts.workspaces, 1);

    const workspacesRes = await request('/api/workspaces', port);
    const workspaces = JSON.parse(workspacesRes.body);
    assert.equal(workspacesRes.status, 200);
    assert.equal(workspaces.some((item) => item.id === 'ws-777'), true);

    const usageRes = await request('/api/write-usage', port, 'GET', null, { 'x-api-key': 'test-write-key' });
    const usage = JSON.parse(usageRes.body);
    assert.equal(usageRes.status, 200);
    assert.equal(usage.used, 2);

    const logsRes = await request('/api/audit-logs', port);
    const logs = JSON.parse(logsRes.body);
    assert.equal(logs.some((item) => item.action === '/api/state/import'), true);
  });
});

test('state import endpoint supports dryRun preview without mutating state/quota/audit logs', async (t) => {
  await withServer(t, async (port) => {
    const headers = { 'x-api-key': 'test-write-key' };
    const today = new Date().toISOString().slice(0, 10);
    const payload = {
      __format: 'yoa-state-v2',
      state: {
        workspaces: [
          {
            id: 'ws-888',
            name: '预览导入工作空间',
            owner: 'previewer',
            updatedAt: '2026-04-12',
            visibility: 'team'
          }
        ],
        documents: [],
        tasks: [],
        taskTemplates: [],
        policies: [],
        experts: [],
        policyChangeRequests: [],
        distillation: {
          self: {},
          expert: {},
          provenance: {}
        },
        fusionPreview: {},
        billing: {}
      },
      writeUsageEntries: [[`test-write-key::${today}`, 2]],
      auditLogs: [
        {
          id: 'audit-import-dry-run',
          createdAt: '2026-04-12T00:00:00.000Z',
          action: '/dry-run',
          method: 'POST',
          actor: 'seed'
        }
      ]
    };

    const previewRes = await request('/api/state/import?dryRun=true', port, 'POST', payload, headers);
    const preview = JSON.parse(previewRes.body);
    assert.equal(previewRes.status, 200);
    assert.equal(preview.ok, true);
    assert.equal(preview.dryRun, true);
    assert.equal(preview.counts.workspaces, 1);

    const workspacesRes = await request('/api/workspaces', port);
    const workspaces = JSON.parse(workspacesRes.body);
    assert.equal(workspaces.some((item) => item.id === 'ws-888'), false);

    const usageRes = await request('/api/write-usage', port, 'GET', null, headers);
    const usage = JSON.parse(usageRes.body);
    assert.equal(usageRes.status, 200);
    assert.equal(usage.used, 0);

    const logsRes = await request('/api/audit-logs', port);
    const logs = JSON.parse(logsRes.body);
    assert.equal(logs.some((item) => item.action === '/api/state/import'), false);
  });
});

test('state import endpoint rejects request without api key', async (t) => {
  await withServer(t, async (port) => {
    const res = await request('/api/state/import', port, 'POST', { __format: 'yoa-state-v2', state: {} });
    const parsed = JSON.parse(res.body);

    assert.equal(res.status, 401);
    assert.equal(parsed.error, 'unauthorized: missing or invalid x-api-key');
  });
});

test('dashboard summary returns aggregated counts and quota', async (t) => {
  await withServer(t, async (port) => {
    const headers = { 'x-api-key': 'test-write-key' };
    const createRes = await request('/api/tasks', port, 'POST', {
      kind: 'analysis',
      prompt: 'dashboard 统计样本'
    }, headers);
    const created = JSON.parse(createRes.body);
    assert.equal(createRes.status, 201);

    const patchRes = await request(
      `/api/tasks/${created.id}/status`,
      port,
      'PATCH',
      { status: 'running' },
      headers
    );
    assert.equal(patchRes.status, 200);

    const res = await request('/api/dashboard/summary', port, 'GET', null, { 'x-api-key': 'test-write-key' });
    const parsed = JSON.parse(res.body);

    assert.equal(res.status, 200);
    assert.equal(typeof parsed.generatedAt, 'string');
    assert.equal(typeof parsed.counts.workspaces, 'number');
    assert.equal(typeof parsed.counts.documents, 'number');
    assert.equal(typeof parsed.counts.tasks, 'number');
    assert.equal(typeof parsed.tasksByStatus.running, 'number');
    assert.equal(typeof parsed.writeQuota.remaining, 'number');
    assert.equal(res.headers['x-write-quota-limit'], '3');
  });
});

test('dashboard summary supports workspace scoped view and completion rate', async (t) => {
  await withServer(t, async (port) => {
    const headers = { 'x-api-key': 'test-write-key' };
    const createRes = await request('/api/tasks', port, 'POST', {
      kind: 'analysis',
      prompt: 'workspace dashboard 样本',
      workspaceId: 'ws-001',
      evidenceRefs: ['doc-001#p1']
    }, headers);
    const created = JSON.parse(createRes.body);
    assert.equal(createRes.status, 201);

    const patchRes = await request(
      `/api/tasks/${created.id}/status`,
      port,
      'PATCH',
      { status: 'done' },
      headers
    );
    assert.equal(patchRes.status, 200);

    const res = await request(
      '/api/dashboard/summary?workspaceId=ws-001&recentAuditLimit=1',
      port,
      'GET',
      null,
      headers
    );
    const parsed = JSON.parse(res.body);

    assert.equal(res.status, 200);
    assert.equal(parsed.scope.workspaceId, 'ws-001');
    assert.equal(parsed.counts.workspaces, 1);
    assert.equal(parsed.tasksByStatus.done >= 1, true);
    assert.equal(parsed.completionRate, 1);
    assert.equal(Array.isArray(parsed.recentAuditLogs), true);
    assert.equal(parsed.recentAuditLogs.length, 1);
  });
});



test('dashboard summary supports task/document status filters', async (t) => {
  await withServer(t, async (port) => {
    const headers = { 'x-api-key': 'test-write-key' };
    const res = await request(
      '/api/dashboard/summary?taskStatus=done&documentStatus=indexed',
      port,
      'GET',
      null,
      headers
    );
    const parsed = JSON.parse(res.body);

    assert.equal(res.status, 200);
    assert.deepEqual(parsed.scope.taskStatus, ['done']);
    assert.deepEqual(parsed.scope.documentStatus, ['indexed']);
    assert.equal(parsed.counts.tasks, 1);
    assert.equal(parsed.counts.documents, 2);
    assert.equal(parsed.tasksByStatus.done, 1);
    assert.equal(parsed.completionRate, 1);
  });
});

test('dashboard summary returns 400 for invalid task/document status filters', async (t) => {
  await withServer(t, async (port) => {
    const headers = { 'x-api-key': 'test-write-key' };

    const invalidTaskStatusRes = await request(
      '/api/dashboard/summary?taskStatus=blocked',
      port,
      'GET',
      null,
      headers
    );
    const invalidTaskStatusPayload = JSON.parse(invalidTaskStatusRes.body);
    assert.equal(invalidTaskStatusRes.status, 400);
    assert.equal(invalidTaskStatusPayload.error, 'taskStatus must be comma-separated values of: queued, running, done, failed');

    const invalidDocumentStatusRes = await request(
      '/api/dashboard/summary?documentStatus=ready',
      port,
      'GET',
      null,
      headers
    );
    const invalidDocumentStatusPayload = JSON.parse(invalidDocumentStatusRes.body);
    assert.equal(invalidDocumentStatusRes.status, 400);
    assert.equal(invalidDocumentStatusPayload.error, 'documentStatus must be comma-separated values of: indexed, processing');
  });
});

test('dashboard summary supports task/document multi-status filters', async (t) => {
  await withServer(t, async (port) => {
    const headers = { 'x-api-key': 'test-write-key' };
    const res = await request(
      '/api/dashboard/summary?taskStatus=queued,done&documentStatus=indexed,processing',
      port,
      'GET',
      null,
      headers
    );
    const parsed = JSON.parse(res.body);

    assert.equal(res.status, 200);
    assert.deepEqual(parsed.scope.taskStatus, ['queued', 'done']);
    assert.deepEqual(parsed.scope.documentStatus, ['indexed', 'processing']);
    assert.equal(parsed.counts.tasks, 2);
    assert.equal(parsed.counts.documents, 3);
    assert.ok(parsed.tasksByStatus.queued >= 1);
    assert.ok(parsed.tasksByStatus.done >= 1);
    assert.ok(parsed.documentsByStatus.indexed >= 1);
    assert.ok(parsed.documentsByStatus.processing >= 1);
  });
});
test('dashboard summary supports recent audit log filtering by action/method/actor', async (t) => {
  await withServer(t, async (port) => {
    const headers = { 'x-api-key': 'test-write-key' };

    const wsRes = await request('/api/workspaces', port, 'POST', {
      name: '筛选审计空间',
      owner: 'qa'
    }, headers);
    assert.equal(wsRes.status, 201);

    const taskRes = await request('/api/tasks', port, 'POST', {
      kind: 'analysis',
      prompt: '生成审计筛选样本'
    }, headers);
    assert.equal(taskRes.status, 201);

    const summaryRes = await request(
      '/api/dashboard/summary?recentAuditAction=/api/tasks&recentAuditMethod=POST&recentAuditActor=test-write-key&recentAuditLimit=5',
      port,
      'GET',
      null,
      headers
    );
    const summary = JSON.parse(summaryRes.body);

    assert.equal(summaryRes.status, 200);
    assert.equal(Array.isArray(summary.recentAuditLogs), true);
    assert.equal(summary.recentAuditLogs.length, 1);
    assert.equal(summary.recentAuditLogs[0].action, '/api/tasks');
    assert.equal(summary.recentAuditLogs[0].method, 'POST');
    assert.equal(summary.recentAuditLogs[0].actor, 'test-write-key');
    assert.equal(summary.scope.recentAudit.limit, 5);
    assert.deepEqual(summary.scope.recentAudit.action, ['/api/tasks']);
    assert.deepEqual(summary.scope.recentAudit.method, ['POST']);
    assert.deepEqual(summary.scope.recentAudit.actor, ['test-write-key']);
  });
});

test('dashboard summary supports recent audit log filtering by targetId', async (t) => {
  await withServer(t, async (port) => {
    const headers = { 'x-api-key': 'test-write-key' };

    const createdWorkspaceRes = await request('/api/workspaces', port, 'POST', {
      name: '目标对象筛选空间',
      owner: 'qa'
    }, headers);
    assert.equal(createdWorkspaceRes.status, 201);
    const createdWorkspace = JSON.parse(createdWorkspaceRes.body);

    const summaryRes = await request(
      `/api/dashboard/summary?recentAuditAction=/api/workspaces&recentAuditTargetId=${createdWorkspace.id}&recentAuditLimit=5`,
      port,
      'GET',
      null,
      headers
    );
    const summary = JSON.parse(summaryRes.body);

    assert.equal(summaryRes.status, 200);
    assert.equal(Array.isArray(summary.recentAuditLogs), true);
    assert.equal(summary.recentAuditLogs.length, 1);
    assert.equal(summary.recentAuditLogs[0].action, '/api/workspaces');
    assert.equal(summary.recentAuditLogs[0].targetId, createdWorkspace.id);
    assert.deepEqual(summary.scope.recentAudit.targetId, [createdWorkspace.id]);
  });
});

test('dashboard summary supports recent audit multi-value filters', async (t) => {
  await withServer(t, async (port) => {
    const headers = { 'x-api-key': 'test-write-key' };

    const createdWorkspaceRes = await request('/api/workspaces', port, 'POST', {
      name: '多值筛选空间',
      owner: 'qa'
    }, headers);
    assert.equal(createdWorkspaceRes.status, 201);
    const createdWorkspace = JSON.parse(createdWorkspaceRes.body);

    const createdTaskRes = await request('/api/tasks', port, 'POST', {
      kind: 'analysis',
      prompt: '多值筛选任务'
    }, headers);
    assert.equal(createdTaskRes.status, 201);
    const createdTask = JSON.parse(createdTaskRes.body);

    const summaryRes = await request(
      `/api/dashboard/summary?recentAuditAction=/api/workspaces,/api/tasks&recentAuditMethod=POST&recentAuditTargetId=${createdWorkspace.id},${createdTask.id}&recentAuditActor=test-write-key&recentAuditLimit=10`,
      port,
      'GET',
      null,
      headers
    );
    const summary = JSON.parse(summaryRes.body);

    assert.equal(summaryRes.status, 200);
    assert.equal(summary.recentAuditLogs.length, 2);
    assert.deepEqual(summary.scope.recentAudit.action, ['/api/workspaces', '/api/tasks']);
    assert.deepEqual(summary.scope.recentAudit.method, ['POST']);
    assert.deepEqual(summary.scope.recentAudit.actor, ['test-write-key']);
    assert.deepEqual(summary.scope.recentAudit.targetId, [createdWorkspace.id, createdTask.id]);
    assert.ok(summary.recentAuditByTarget[createdWorkspace.id] >= 1);
    assert.ok(summary.recentAuditByTarget[createdTask.id] >= 1);
  });
});

test('dashboard summary supports recent audit log filtering by date range', async (t) => {
  await withServer(t, async (port) => {
    const headers = { 'x-api-key': 'test-write-key' };

    const wsRes = await request('/api/workspaces', port, 'POST', {
      name: '日期筛选审计空间',
      owner: 'qa'
    }, headers);
    assert.equal(wsRes.status, 201);

    const summaryRes = await request(
      '/api/dashboard/summary?recentAuditDateFrom=2099-01-01&recentAuditDateTo=2099-01-02',
      port,
      'GET',
      null,
      headers
    );
    const summary = JSON.parse(summaryRes.body);

    assert.equal(summaryRes.status, 200);
    assert.equal(Array.isArray(summary.recentAuditLogs), true);
    assert.equal(summary.recentAuditLogs.length, 0);
    assert.equal(summary.scope.recentAudit.dateFrom, '2099-01-01');
    assert.equal(summary.scope.recentAudit.dateTo, '2099-01-02');
  });
});

test('dashboard summary returns recentAuditByDate histogram', async (t) => {
  await withServer(t, async (port) => {
    const headers = { 'x-api-key': 'test-write-key' };
    const createWorkspaceRes = await request('/api/workspaces', port, 'POST', {
      name: '仪表盘直方图空间',
      owner: 'hist'
    }, headers);
    assert.equal(createWorkspaceRes.status, 201);

    const summaryRes = await request('/api/dashboard/summary?recentAuditAction=/api/workspaces', port, 'GET', null, headers);
    const summary = JSON.parse(summaryRes.body);
    const today = new Date().toISOString().slice(0, 10);

    assert.equal(summaryRes.status, 200);
    assert.equal(typeof summary.recentAuditByDate, 'object');
    assert.ok(summary.recentAuditByDate[today] >= 1);
  });
});

test('dashboard summary returns recentAuditByAction and recentAuditByMethod aggregations', async (t) => {
  await withServer(t, async (port) => {
    const headers = { 'x-api-key': 'test-write-key' };
    const createWorkspaceRes = await request('/api/workspaces', port, 'POST', {
      name: '仪表盘动作聚合空间',
      owner: 'audit'
    }, headers);
    assert.equal(createWorkspaceRes.status, 201);
    const workspace = JSON.parse(createWorkspaceRes.body);

    const createTaskRes = await request('/api/tasks', port, 'POST', {
      kind: 'analysis',
      prompt: '仪表盘动作聚合任务'
    }, headers);
    assert.equal(createTaskRes.status, 201);
    const task = JSON.parse(createTaskRes.body);

    const summaryRes = await request('/api/dashboard/summary?recentAuditLimit=10', port, 'GET', null, headers);
    const summary = JSON.parse(summaryRes.body);

    assert.equal(summaryRes.status, 200);
    assert.equal(typeof summary.recentAuditByAction, 'object');
    assert.equal(typeof summary.recentAuditByMethod, 'object');
    assert.equal(typeof summary.recentAuditByActor, 'object');
    assert.equal(typeof summary.recentAuditByTarget, 'object');
    assert.ok(summary.recentAuditByAction['/api/workspaces'] >= 1);
    assert.ok(summary.recentAuditByAction['/api/tasks'] >= 1);
    assert.ok(summary.recentAuditByMethod.POST >= 2);
    assert.ok(summary.recentAuditByActor['test-write-key'] >= 2);
    assert.ok(summary.recentAuditByTarget[workspace.id] >= 1);
    assert.ok(summary.recentAuditByTarget[task.id] >= 1);
  });
});

test('dashboard summary supports recentAuditGroupLimit for aggregation fields', async (t) => {
  await withServer(t, async (port) => {
    const headers = { 'x-api-key': 'test-write-key' };

    const wsRes = await request('/api/workspaces', port, 'POST', {
      name: '聚合限制空间',
      owner: 'audit'
    }, headers);
    assert.equal(wsRes.status, 201);

    const taskRes = await request('/api/tasks', port, 'POST', {
      kind: 'analysis',
      prompt: '聚合限制任务'
    }, headers);
    assert.equal(taskRes.status, 201);

    const summaryRes = await request('/api/dashboard/summary?recentAuditGroupLimit=1&recentAuditLimit=10', port, 'GET', null, headers);
    const summary = JSON.parse(summaryRes.body);

    assert.equal(summaryRes.status, 200);
    assert.equal(summary.scope.recentAudit.groupLimit, 1);
    assert.equal(Object.keys(summary.recentAuditByAction).length, 1);
    assert.equal(Object.keys(summary.recentAuditByMethod).length, 1);
    assert.equal(Object.keys(summary.recentAuditByActor).length, 1);
    assert.equal(Object.keys(summary.recentAuditByTarget).length, 1);
  });
});

test('dashboard summary returns 400 when recentAuditDateFrom is after recentAuditDateTo', async (t) => {
  await withServer(t, async (port) => {
    const headers = { 'x-api-key': 'test-write-key' };
    const res = await request(
      '/api/dashboard/summary?recentAuditDateFrom=2026-04-12&recentAuditDateTo=2026-04-11',
      port,
      'GET',
      null,
      headers
    );
    const parsed = JSON.parse(res.body);

    assert.equal(res.status, 400);
    assert.equal(parsed.error, 'recentAuditDateFrom must be <= recentAuditDateTo');
  });
});

test('dashboard summary returns 400 for invalid recentAuditGroupLimit', async (t) => {
  await withServer(t, async (port) => {
    const headers = { 'x-api-key': 'test-write-key' };
    const res = await request('/api/dashboard/summary?recentAuditGroupLimit=0', port, 'GET', null, headers);
    const parsed = JSON.parse(res.body);

    assert.equal(res.status, 400);
    assert.equal(parsed.error, 'recentAuditGroupLimit must be an integer between 1 and 20');
  });
});

test('dashboard summary returns 400 when workspaceId is invalid', async (t) => {
  await withServer(t, async (port) => {
    const res = await request('/api/dashboard/summary?workspaceId=ws-404', port, 'GET', null, { 'x-api-key': 'test-write-key' });
    const parsed = JSON.parse(res.body);

    assert.equal(res.status, 400);
    assert.equal(parsed.error, 'workspaceId is invalid');
  });
});

test('dashboard summary rejects request without api key', async (t) => {
  await withServer(t, async (port) => {
    const res = await request('/api/dashboard/summary', port);
    const parsed = JSON.parse(res.body);

    assert.equal(res.status, 401);
    assert.equal(parsed.error, 'unauthorized: missing or invalid x-api-key');
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

test('create and reject policy change request', async (t) => {
  await withServer(t, async (port) => {
    const createRes = await request('/api/policy-change-requests', port, 'POST', {
      policyId: 'policy-001',
      proposedRule: '外部场景统一回答“暂无可披露细节”。',
      reason: '拟采用更保守口径',
      requestedBy: 'ops-analyst'
    }, { 'x-api-key': 'test-write-key' });
    const created = JSON.parse(createRes.body);
    assert.equal(createRes.status, 201);

    const rejectRes = await request(
      `/api/policy-change-requests/${created.id}/reject`,
      port,
      'PATCH',
      { status: 'rejected', rejectedBy: 'compliance-lead', rejectReason: '缺少法务签字' },
      { 'x-api-key': 'test-write-key' }
    );
    const rejected = JSON.parse(rejectRes.body);
    assert.equal(rejectRes.status, 200);
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.rejectedBy, 'compliance-lead');
    assert.equal(rejected.rejectReason, '缺少法务签字');

    const policiesRes = await request('/api/policies', port);
    const policies = JSON.parse(policiesRes.body);
    const targetPolicy = policies.find((p) => p.id === 'policy-001');
    assert.equal(targetPolicy.rule.includes('暂无可披露细节'), false);
  });
});

test('delete task via DELETE', async (t) => {
  await withServer(t, async (port) => {
    const headers = { 'x-api-key': 'test-write-key' };
    const createRes = await request('/api/tasks', port, 'POST', {
      kind: 'analysis',
      prompt: '待删除任务'
    }, headers);
    const created = JSON.parse(createRes.body);
    assert.equal(createRes.status, 201);

    const deleteRes = await request(`/api/tasks/${created.id}`, port, 'DELETE', null, headers);
    const deleted = JSON.parse(deleteRes.body);
    assert.equal(deleteRes.status, 200);
    assert.equal(deleted.id, created.id);

    const listRes = await request('/api/tasks', port);
    const tasks = JSON.parse(listRes.body);
    assert.equal(tasks.some((task) => task.id === created.id), false);
  });
});

test('delete workspace requires force=true when related resources exist', async (t) => {
  await withServer(t, async (port) => {
    const headers = { 'x-api-key': 'test-write-key' };
    const createRes = await request('/api/workspaces', port, 'POST', {
      name: '删除前校验空间',
      owner: 'ops'
    }, headers);
    const workspace = JSON.parse(createRes.body);
    assert.equal(createRes.status, 201);

    const docRes = await request('/api/documents', port, 'POST', {
      name: '关联文档',
      type: 'pdf',
      workspaceId: workspace.id
    }, headers);
    assert.equal(docRes.status, 201);

    const deleteRes = await request(`/api/workspaces/${workspace.id}`, port, 'DELETE', null, headers);
    const parsed = JSON.parse(deleteRes.body);
    assert.equal(deleteRes.status, 400);
    assert.equal(parsed.error, 'workspace has related resources, use force=true to delete');
    assert.ok(Array.isArray(parsed.details.relatedDocuments));
  });
});

test('force deletes workspace and related resources', async (t) => {
  await withServer(t, async (port) => {
    const headers = { 'x-api-key': 'test-write-key' };
    const createRes = await request('/api/workspaces', port, 'POST', {
      name: '级联删除空间',
      owner: 'ops'
    }, headers);
    const workspace = JSON.parse(createRes.body);
    assert.equal(createRes.status, 201);

    const docRes = await request('/api/documents', port, 'POST', {
      name: '临时文档',
      type: 'md',
      workspaceId: workspace.id
    }, headers);
    const doc = JSON.parse(docRes.body);
    assert.equal(docRes.status, 201);

    const deleteRes = await request(`/api/workspaces/${workspace.id}?force=true`, port, 'DELETE', null, headers);
    assert.equal(deleteRes.status, 200);

    const docListRes = await request('/api/documents', port);
    const docs = JSON.parse(docListRes.body);
    assert.equal(docs.some((item) => item.id === doc.id), false);
  });
});

test('returns 400 when approving a rejected policy change request', async (t) => {
  await withServer(t, async (port) => {
    const createRes = await request('/api/policy-change-requests', port, 'POST', {
      policyId: 'policy-001',
      proposedRule: '只允许对外使用“项目探索中”。',
      reason: '收紧表达',
      requestedBy: 'ops-analyst'
    }, { 'x-api-key': 'test-write-key' });
    const created = JSON.parse(createRes.body);
    assert.equal(createRes.status, 201);

    const rejectRes = await request(
      `/api/policy-change-requests/${created.id}/reject`,
      port,
      'PATCH',
      { status: 'rejected', rejectedBy: 'compliance-lead', rejectReason: '证据不足' },
      { 'x-api-key': 'test-write-key' }
    );
    assert.equal(rejectRes.status, 200);

    const approveRes = await request(
      `/api/policy-change-requests/${created.id}/approve`,
      port,
      'PATCH',
      { status: 'approved', approvedBy: 'compliance-lead' },
      { 'x-api-key': 'test-write-key' }
    );
    const parsed = JSON.parse(approveRes.body);
    assert.equal(approveRes.status, 400);
    assert.equal(parsed.error, 'cannot approve request in rejected status');
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
    const fourth = await request('/api/tasks', port, 'POST', { kind: 'chat', prompt: 'd' }, headers);
    const parsed = JSON.parse(fourth.body);

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(third.status, 201);
    assert.equal(fourth.status, 429);
    assert.equal(parsed.error, 'write quota exceeded: 3/day');
  });
});
