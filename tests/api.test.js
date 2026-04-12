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

test('write usage endpoint rejects request without api key', async (t) => {
  await withServer(t, async (port) => {
    const res = await request('/api/write-usage', port);
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
