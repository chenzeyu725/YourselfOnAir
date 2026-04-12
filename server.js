const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  state,
  hydrateState,
  getStateSnapshot,
  createWorkspace,
  createDocument,
  createTask,
  createTaskFromTemplate,
  createPolicy,
  createExpert,
  activateExpert,
  updateTaskStatus,
  deleteTask,
  deleteDocument,
  deleteWorkspace,
  createPolicyChangeRequest,
  approvePolicyChangeRequest,
  rejectPolicyChangeRequest
} = require('./api/store');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const WRITE_API_KEY = process.env.WRITE_API_KEY || 'dev-write-key';
const WRITE_QUOTA_PER_DAY = Number(process.env.WRITE_QUOTA_PER_DAY || 20);
const writeUsage = new Map();
const auditLogs = [];

function getStateFile() {
  return process.env.STATE_FILE || '';
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

const GET_ROUTES = {
  '/api/health': () => ({ ok: true, service: 'yourself-on-air-mvp' }),
  '/api/workspaces': () => state.workspaces,
  '/api/documents': () => state.documents,
  '/api/tasks': () => state.tasks,
  '/api/task-templates': () => state.taskTemplates,
  '/api/policies': () => state.policies,
  '/api/experts': () => state.experts,
  '/api/policy-change-requests': () => state.policyChangeRequests,
  '/api/audit-logs': () => auditLogs,
  '/api/distillation/self': () => state.distillation.self,
  '/api/distillation/expert': () => state.distillation.expert,
  '/api/provenance': () => state.distillation.provenance,
  '/api/fusion/preview': () => state.fusionPreview,
  '/api/billing': () => state.billing
};

const QUERYABLE_LIST_ROUTES = new Set([
  '/api/workspaces',
  '/api/documents',
  '/api/tasks',
  '/api/task-templates',
  '/api/policies',
  '/api/experts',
  '/api/policy-change-requests',
  '/api/audit-logs'
]);

const ALLOWED_TASK_STATUS = new Set(['queued', 'running', 'done', 'failed']);
const ALLOWED_DOCUMENT_STATUS = new Set(['indexed', 'processing']);

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function parseNonNegativeInt(value, field, max = Number.MAX_SAFE_INTEGER) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) {
    throw badRequest(`${field} must be a non-negative integer`);
  }
  if (num > max) {
    throw badRequest(`${field} must be <= ${max}`);
  }
  return num;
}

function parseDateBoundary(value, field) {
  if (value === null || value === undefined) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw badRequest(`${field} must be in YYYY-MM-DD format`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest(`${field} must be a valid date`);
  }
  return parsed;
}

function applyListQuery(items, query) {
  const q = query.get('q');
  const status = query.get('status');
  const action = query.get('action');
  const method = query.get('method');
  const workspaceId = query.get('workspaceId');
  const owner = query.get('owner');
  const actor = query.get('actor');
  const sortBy = query.get('sortBy');
  const orderRaw = query.get('order');
  const dateField = query.get('dateField');
  const dateFromRaw = query.get('dateFrom');
  const dateToRaw = query.get('dateTo');
  const limit = parseNonNegativeInt(query.get('limit'), 'limit', 100);
  const offset = parseNonNegativeInt(query.get('offset'), 'offset');
  const dateFrom = parseDateBoundary(dateFromRaw, 'dateFrom');
  const dateTo = parseDateBoundary(dateToRaw, 'dateTo');

  if ((dateFrom || dateTo) && !dateField) {
    throw badRequest('dateField is required when dateFrom/dateTo is provided');
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw badRequest('dateFrom must be <= dateTo');
  }
  const dateToInclusiveEnd = dateTo
    ? new Date(Date.UTC(dateTo.getUTCFullYear(), dateTo.getUTCMonth(), dateTo.getUTCDate(), 23, 59, 59, 999))
    : null;

  let result = [...items];

  if (q) {
    const normalized = q.toLowerCase();
    result = result.filter((item) => JSON.stringify(item).toLowerCase().includes(normalized));
  }
  if (status) {
    result = result.filter((item) => {
      if (item.status !== undefined) {
        return item.status === status;
      }
      if (typeof item.isActive === 'boolean') {
        return String(item.isActive) === status;
      }
      return false;
    });
  }
  if (action) {
    result = result.filter((item) => item.action === action);
  }
  if (method) {
    result = result.filter((item) => item.method === method);
  }
  if (workspaceId) {
    result = result.filter((item) => item.workspaceId === workspaceId);
  }
  if (owner) {
    result = result.filter((item) => item.owner === owner);
  }
  if (actor) {
    result = result.filter((item) => item.actor === actor);
  }
  if (dateField) {
    const sample = result.find((item) => Object.prototype.hasOwnProperty.call(item, dateField));
    if (!sample && result.length > 0) {
      throw badRequest(`dateField not found: ${dateField}`);
    }
    if (dateFrom || dateTo) {
      result = result.filter((item) => {
        const raw = item[dateField];
        if (typeof raw !== 'string') return false;
        const parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) return false;
        if (dateFrom && parsed < dateFrom) return false;
        if (dateToInclusiveEnd && parsed > dateToInclusiveEnd) return false;
        return true;
      });
    }
  }

  if (sortBy) {
    const sample = result.find((item) => Object.prototype.hasOwnProperty.call(item, sortBy));
    if (!sample) {
      throw badRequest(`sortBy field not found: ${sortBy}`);
    }

    const order = orderRaw || 'asc';
    if (order !== 'asc' && order !== 'desc') {
      throw badRequest('order must be asc or desc');
    }

    result.sort((a, b) => {
      const av = a[sortBy];
      const bv = b[sortBy];
      if (av === bv) return 0;
      if (av === undefined || av === null) return 1;
      if (bv === undefined || bv === null) return -1;
      if (av > bv) return order === 'asc' ? 1 : -1;
      return order === 'asc' ? -1 : 1;
    });
  }

  if (offset !== null) {
    result = result.slice(offset);
  }
  if (limit !== null) {
    result = result.slice(0, limit);
  }

  return result;
}

function getWriteQuotaOverview(apiKey) {
  const used = getWriteUsage(apiKey);
  return {
    date: new Date().toISOString().slice(0, 10),
    quotaPerDay: WRITE_QUOTA_PER_DAY,
    used,
    remaining: Math.max(WRITE_QUOTA_PER_DAY - used, 0)
  };
}

function getDashboardSummary(apiKey, options = {}) {
  const workspaceId = options.workspaceId || null;
  const recentAuditLimit = options.recentAuditLimit || 5;
  const recentAuditAction = options.recentAuditAction || null;
  const recentAuditMethod = options.recentAuditMethod || null;
  const recentAuditActor = options.recentAuditActor || null;
  const recentAuditTargetId = options.recentAuditTargetId || null;
  const recentAuditDateFrom = options.recentAuditDateFrom || null;
  const recentAuditDateTo = options.recentAuditDateTo || null;
  const taskStatus = options.taskStatus || null;
  const documentStatus = options.documentStatus || null;

  if (workspaceId && !state.workspaces.some((item) => item.id === workspaceId)) {
    throw badRequest('workspaceId is invalid');
  }
  if (taskStatus && !ALLOWED_TASK_STATUS.has(taskStatus)) {
    throw badRequest('taskStatus must be one of: queued, running, done, failed');
  }
  if (documentStatus && !ALLOWED_DOCUMENT_STATUS.has(documentStatus)) {
    throw badRequest('documentStatus must be one of: indexed, processing');
  }
  if (recentAuditDateFrom && recentAuditDateTo && recentAuditDateFrom > recentAuditDateTo) {
    throw badRequest('recentAuditDateFrom must be <= recentAuditDateTo');
  }
  const recentAuditDateToInclusiveEnd = recentAuditDateTo
    ? new Date(Date.UTC(
      recentAuditDateTo.getUTCFullYear(),
      recentAuditDateTo.getUTCMonth(),
      recentAuditDateTo.getUTCDate(),
      23,
      59,
      59,
      999
    ))
    : null;
  const serializeDateBoundary = (value) => (value ? value.toISOString().slice(0, 10) : null);

  const scopedWorkspaces = workspaceId
    ? state.workspaces.filter((item) => item.id === workspaceId)
    : state.workspaces;
  const workspaceScopedDocuments = workspaceId
    ? state.documents.filter((item) => item.workspaceId === workspaceId)
    : state.documents;
  const scopedDocuments = documentStatus
    ? workspaceScopedDocuments.filter((item) => item.status === documentStatus)
    : workspaceScopedDocuments;
  const workspaceScopedTasks = workspaceId
    ? state.tasks.filter((item) => item.workspaceId === workspaceId)
    : state.tasks;
  const scopedTasks = taskStatus
    ? workspaceScopedTasks.filter((item) => item.status === taskStatus)
    : workspaceScopedTasks;
  const scopedPolicyChangeRequests = workspaceId
    ? state.policyChangeRequests.filter((item) => item.workspaceId === workspaceId)
    : state.policyChangeRequests;

  const tasksByStatus = scopedTasks.reduce((acc, task) => {
    acc[task.status] = (acc[task.status] || 0) + 1;
    return acc;
  }, {});
  const documentsByStatus = scopedDocuments.reduce((acc, doc) => {
    acc[doc.status] = (acc[doc.status] || 0) + 1;
    return acc;
  }, {});
  const doneTasks = tasksByStatus.done || 0;
  const completionRate = scopedTasks.length === 0 ? null : Number((doneTasks / scopedTasks.length).toFixed(4));

  let recentAuditLogs = [...auditLogs];
  if (recentAuditAction) {
    recentAuditLogs = recentAuditLogs.filter((item) => item.action === recentAuditAction);
  }
  if (recentAuditMethod) {
    recentAuditLogs = recentAuditLogs.filter((item) => item.method === recentAuditMethod);
  }
  if (recentAuditActor) {
    recentAuditLogs = recentAuditLogs.filter((item) => item.actor === recentAuditActor);
  }
  if (recentAuditTargetId) {
    recentAuditLogs = recentAuditLogs.filter((item) => item.targetId === recentAuditTargetId);
  }
  if (recentAuditDateFrom || recentAuditDateToInclusiveEnd) {
    recentAuditLogs = recentAuditLogs.filter((item) => {
      const createdAt = new Date(item.createdAt);
      if (Number.isNaN(createdAt.getTime())) return false;
      if (recentAuditDateFrom && createdAt < recentAuditDateFrom) return false;
      if (recentAuditDateToInclusiveEnd && createdAt > recentAuditDateToInclusiveEnd) return false;
      return true;
    });
  }
  const recentAuditByDate = recentAuditLogs.reduce((acc, item) => {
    const createdAt = new Date(item.createdAt);
    if (Number.isNaN(createdAt.getTime())) return acc;
    const dateKey = createdAt.toISOString().slice(0, 10);
    acc[dateKey] = (acc[dateKey] || 0) + 1;
    return acc;
  }, {});
  const recentAuditByAction = recentAuditLogs.reduce((acc, item) => {
    if (!item.action) return acc;
    acc[item.action] = (acc[item.action] || 0) + 1;
    return acc;
  }, {});
  const recentAuditByMethod = recentAuditLogs.reduce((acc, item) => {
    if (!item.method) return acc;
    acc[item.method] = (acc[item.method] || 0) + 1;
    return acc;
  }, {});

  return {
    generatedAt: new Date().toISOString(),
    scope: {
      workspaceId,
      taskStatus,
      documentStatus,
      recentAudit: {
        limit: recentAuditLimit,
        action: recentAuditAction,
        method: recentAuditMethod,
        actor: recentAuditActor,
        targetId: recentAuditTargetId,
        dateFrom: serializeDateBoundary(recentAuditDateFrom),
        dateTo: serializeDateBoundary(recentAuditDateTo)
      }
    },
    counts: {
      workspaces: scopedWorkspaces.length,
      documents: scopedDocuments.length,
      tasks: scopedTasks.length,
      policies: state.policies.length,
      policyChangeRequests: scopedPolicyChangeRequests.length
    },
    tasksByStatus,
    documentsByStatus,
    completionRate,
    recentAuditLogs: recentAuditLogs.slice(-recentAuditLimit).reverse(),
    recentAuditByDate,
    recentAuditByAction,
    recentAuditByMethod,
    writeQuota: getWriteQuotaOverview(apiKey)
  };
}

function setWriteQuotaHeaders(res, apiKey) {
  const overview = getWriteQuotaOverview(apiKey);
  res.setHeader('X-Write-Quota-Date', overview.date);
  res.setHeader('X-Write-Quota-Limit', String(overview.quotaPerDay));
  res.setHeader('X-Write-Quota-Used', String(overview.used));
  res.setHeader('X-Write-Quota-Remaining', String(overview.remaining));
}

const POST_ROUTES = {
  '/api/workspaces': createWorkspace,
  '/api/documents': createDocument,
  '/api/tasks': createTask,
  '/api/tasks/from-template': createTaskFromTemplate,
  '/api/policies': createPolicy,
  '/api/experts': createExpert,
  '/api/policy-change-requests': createPolicyChangeRequest
};

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function sendJson(res, payload, status = 200) {
  setSecurityHeaders(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, text, status = 200) {
  setSecurityHeaders(res);
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function usageKeyForToday(apiKey, date = new Date()) {
  const day = date.toISOString().slice(0, 10);
  return `${apiKey}::${day}`;
}

function getWriteUsage(apiKey) {
  return writeUsage.get(usageKeyForToday(apiKey)) || 0;
}

function consumeWriteQuota(apiKey) {
  const key = usageKeyForToday(apiKey);
  const current = writeUsage.get(key) || 0;
  const next = current + 1;
  writeUsage.set(key, next);
  return next;
}

function resetWriteUsage() {
  writeUsage.clear();
  auditLogs.length = 0;
}

function pushAuditLog(entry) {
  const log = {
    id: `audit-${String(auditLogs.length + 1).padStart(4, '0')}`,
    createdAt: new Date().toISOString(),
    ...entry
  };
  auditLogs.push(log);
  return log;
}

function loadStateFromDisk() {
  const stateFile = getStateFile();
  if (!stateFile) return;
  if (!fs.existsSync(stateFile)) return;
  const content = fs.readFileSync(stateFile, 'utf-8');
  if (!content.trim()) return;
  const parsed = JSON.parse(content);

  if (parsed && parsed.__format === 'yoa-state-v2') {
    hydrateState(parsed.state || {});
    writeUsage.clear();
    if (Array.isArray(parsed.writeUsageEntries)) {
      parsed.writeUsageEntries.forEach((entry) => {
        if (Array.isArray(entry) && entry.length === 2) {
          writeUsage.set(entry[0], entry[1]);
        }
      });
    }
    auditLogs.length = 0;
    if (Array.isArray(parsed.auditLogs)) {
      auditLogs.push(...parsed.auditLogs);
    }
    return;
  }

  hydrateState(parsed);
}


function createPortableSnapshot() {
  return {
    __format: 'yoa-state-v2',
    exportedAt: new Date().toISOString(),
    state: getStateSnapshot(),
    writeUsageEntries: Array.from(writeUsage.entries()),
    auditLogs
  };
}

function importPortableSnapshot(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw badRequest('state import payload must be a JSON object');
  }

  if (payload.__format === 'yoa-state-v2') {
    if (!payload.state || typeof payload.state !== 'object' || Array.isArray(payload.state)) {
      throw badRequest('state import payload.state must be an object for yoa-state-v2');
    }
    hydrateState(payload.state);

    writeUsage.clear();
    if (Array.isArray(payload.writeUsageEntries)) {
      payload.writeUsageEntries.forEach((entry) => {
        if (Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string' && typeof entry[1] === 'number') {
          writeUsage.set(entry[0], entry[1]);
        }
      });
    }

    auditLogs.length = 0;
    if (Array.isArray(payload.auditLogs)) {
      payload.auditLogs.forEach((item) => {
        if (item && typeof item === 'object' && typeof item.id === 'string') {
          auditLogs.push(item);
        }
      });
    }
  } else {
    hydrateState(payload);
    writeUsage.clear();
    auditLogs.length = 0;
  }

  return {
    ok: true,
    importedAt: new Date().toISOString(),
    counts: {
      workspaces: state.workspaces.length,
      documents: state.documents.length,
      tasks: state.tasks.length,
      policies: state.policies.length,
      experts: state.experts.length,
      policyChangeRequests: state.policyChangeRequests.length
    },
    writeUsageEntries: writeUsage.size,
    auditLogs: auditLogs.length
  };
}

function previewPortableImport(payload) {
  const previousState = getStateSnapshot();
  const previousWriteUsageEntries = Array.from(writeUsage.entries());
  const previousAuditLogs = JSON.parse(JSON.stringify(auditLogs));
  const preview = importPortableSnapshot(payload);

  hydrateState(previousState);
  writeUsage.clear();
  previousWriteUsageEntries.forEach((entry) => writeUsage.set(entry[0], entry[1]));
  auditLogs.length = 0;
  auditLogs.push(...previousAuditLogs);

  return {
    ...preview,
    dryRun: true
  };
}

function persistStateToDisk() {
  const stateFile = getStateFile();
  if (!stateFile) return;
  const snapshot = createPortableSnapshot();
  const dir = path.dirname(stateFile);
  fs.mkdirSync(dir, { recursive: true });
  const tempFile = `${stateFile}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(snapshot, null, 2), 'utf-8');
  fs.renameSync(tempFile, stateFile);
}

function authorizeWriteRequest(req) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== WRITE_API_KEY) {
    const err = new Error('unauthorized: missing or invalid x-api-key');
    err.status = 401;
    return { ok: false, error: err };
  }

  const used = getWriteUsage(apiKey);
  if (used >= WRITE_QUOTA_PER_DAY) {
    const err = new Error(`write quota exceeded: ${WRITE_QUOTA_PER_DAY}/day`);
    err.status = 429;
    return { ok: false, error: err };
  }

  return { ok: true, apiKey };
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('invalid json body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function serveStaticFile(res, filePath) {
  fs.readFile(filePath, (err, file) => {
    if (err) return sendText(res, 'Not found', 404);

    const ext = path.extname(filePath);
    setSecurityHeaders(res);
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream' });
    res.end(file);
  });
}

async function handleApi(req, res, reqPath, reqUrl) {
  if (req.method === 'GET') {
    if (reqPath === '/api/dashboard/summary') {
      const auth = authorizeWriteRequest(req);
      if (!auth.ok) throw auth.error;
      const workspaceId = reqUrl.searchParams.get('workspaceId');
      const recentAuditLimit = parseNonNegativeInt(reqUrl.searchParams.get('recentAuditLimit'), 'recentAuditLimit', 50);
      const recentAuditAction = reqUrl.searchParams.get('recentAuditAction');
      const recentAuditMethod = reqUrl.searchParams.get('recentAuditMethod');
      const recentAuditActor = reqUrl.searchParams.get('recentAuditActor');
      const recentAuditTargetId = reqUrl.searchParams.get('recentAuditTargetId');
      const taskStatus = reqUrl.searchParams.get('taskStatus');
      const documentStatus = reqUrl.searchParams.get('documentStatus');
      const recentAuditDateFrom = parseDateBoundary(
        reqUrl.searchParams.get('recentAuditDateFrom'),
        'recentAuditDateFrom'
      );
      const recentAuditDateTo = parseDateBoundary(
        reqUrl.searchParams.get('recentAuditDateTo'),
        'recentAuditDateTo'
      );
      setWriteQuotaHeaders(res, auth.apiKey);
      sendJson(res, getDashboardSummary(auth.apiKey, {
        workspaceId,
        recentAuditLimit: recentAuditLimit === null ? 5 : recentAuditLimit,
        recentAuditAction,
        recentAuditMethod,
        recentAuditActor,
        recentAuditTargetId,
        recentAuditDateFrom,
        recentAuditDateTo,
        taskStatus,
        documentStatus
      }));
      return true;
    }

    if (reqPath === '/api/state/export') {
      const auth = authorizeWriteRequest(req);
      if (!auth.ok) throw auth.error;
      setWriteQuotaHeaders(res, auth.apiKey);
      sendJson(res, createPortableSnapshot());
      return true;
    }

    if (reqPath === '/api/write-usage') {
      const auth = authorizeWriteRequest(req);
      if (!auth.ok) throw auth.error;
      setWriteQuotaHeaders(res, auth.apiKey);
      sendJson(res, getWriteQuotaOverview(auth.apiKey));
      return true;
    }

    const getter = GET_ROUTES[reqPath];
    if (!getter) return false;
    const payload = getter();
    if (QUERYABLE_LIST_ROUTES.has(reqPath) && Array.isArray(payload)) {
      sendJson(res, applyListQuery(payload, reqUrl.searchParams));
      return true;
    }
    sendJson(res, payload);
    return true;
  }

  if (req.method === 'POST') {
    if (reqPath === '/api/state/import') {
      const auth = authorizeWriteRequest(req);
      if (!auth.ok) throw auth.error;
      const payload = await parseJsonBody(req);
      const dryRun = reqUrl.searchParams.get('dryRun') === 'true';
      const result = dryRun ? previewPortableImport(payload) : importPortableSnapshot(payload);
      if (!dryRun) {
        consumeWriteQuota(auth.apiKey);
      }
      setWriteQuotaHeaders(res, auth.apiKey);
      if (!dryRun) {
        pushAuditLog({
          action: '/api/state/import',
          method: 'POST',
          actor: auth.apiKey,
          targetId: null
        });
        persistStateToDisk();
      }
      sendJson(res, result);
      return true;
    }

    const creator = POST_ROUTES[reqPath];
    if (!creator) return false;
    const auth = authorizeWriteRequest(req);
    if (!auth.ok) throw auth.error;
    const payload = await parseJsonBody(req);
    const created = creator(payload);
    consumeWriteQuota(auth.apiKey);
    setWriteQuotaHeaders(res, auth.apiKey);
    pushAuditLog({
      action: reqPath,
      method: 'POST',
      actor: auth.apiKey,
      targetId: created.id || null
    });
    persistStateToDisk();
    sendJson(res, created, 201);
    return true;
  }

  if (req.method === 'PATCH') {
    const taskStatusMatch = reqPath.match(/^\/api\/tasks\/(task-\d+)\/status$/);
    if (taskStatusMatch) {
      const auth = authorizeWriteRequest(req);
      if (!auth.ok) throw auth.error;
      const payload = await parseJsonBody(req);
      const updated = updateTaskStatus(taskStatusMatch[1], payload);
      consumeWriteQuota(auth.apiKey);
      setWriteQuotaHeaders(res, auth.apiKey);
      pushAuditLog({
        action: '/api/tasks/:taskId/status',
        method: 'PATCH',
        actor: auth.apiKey,
        targetId: updated.id
      });
      persistStateToDisk();
      sendJson(res, updated);
      return true;
    }

    const policyApproveMatch = reqPath.match(/^\/api\/policy-change-requests\/(pcr-\d+)\/approve$/);
    if (policyApproveMatch) {
      const auth = authorizeWriteRequest(req);
      if (!auth.ok) throw auth.error;
      const payload = await parseJsonBody(req);
      const updated = approvePolicyChangeRequest(policyApproveMatch[1], payload);
      consumeWriteQuota(auth.apiKey);
      setWriteQuotaHeaders(res, auth.apiKey);
      pushAuditLog({
        action: '/api/policy-change-requests/:requestId/approve',
        method: 'PATCH',
        actor: auth.apiKey,
        targetId: updated.id
      });
      persistStateToDisk();
      sendJson(res, updated);
      return true;
    }

    const policyRejectMatch = reqPath.match(/^\/api\/policy-change-requests\/(pcr-\d+)\/reject$/);
    if (policyRejectMatch) {
      const auth = authorizeWriteRequest(req);
      if (!auth.ok) throw auth.error;
      const payload = await parseJsonBody(req);
      const updated = rejectPolicyChangeRequest(policyRejectMatch[1], payload);
      consumeWriteQuota(auth.apiKey);
      setWriteQuotaHeaders(res, auth.apiKey);
      pushAuditLog({
        action: '/api/policy-change-requests/:requestId/reject',
        method: 'PATCH',
        actor: auth.apiKey,
        targetId: updated.id
      });
      persistStateToDisk();
      sendJson(res, updated);
      return true;
    }

    const expertActivateMatch = reqPath.match(/^\/api\/experts\/(exp-\d+)\/activate$/);
    if (expertActivateMatch) {
      const auth = authorizeWriteRequest(req);
      if (!auth.ok) throw auth.error;
      const updated = activateExpert(expertActivateMatch[1]);
      consumeWriteQuota(auth.apiKey);
      setWriteQuotaHeaders(res, auth.apiKey);
      pushAuditLog({
        action: '/api/experts/:expertId/activate',
        method: 'PATCH',
        actor: auth.apiKey,
        targetId: updated.id
      });
      persistStateToDisk();
      sendJson(res, updated);
      return true;
    }

    return false;
  }

  if (req.method === 'DELETE') {
    const taskDeleteMatch = reqPath.match(/^\/api\/tasks\/(task-\d+)$/);
    if (taskDeleteMatch) {
      const auth = authorizeWriteRequest(req);
      if (!auth.ok) throw auth.error;
      const deleted = deleteTask(taskDeleteMatch[1]);
      consumeWriteQuota(auth.apiKey);
      setWriteQuotaHeaders(res, auth.apiKey);
      pushAuditLog({
        action: '/api/tasks/:taskId',
        method: 'DELETE',
        actor: auth.apiKey,
        targetId: deleted.id
      });
      persistStateToDisk();
      sendJson(res, deleted);
      return true;
    }

    const documentDeleteMatch = reqPath.match(/^\/api\/documents\/(doc-\d+)$/);
    if (documentDeleteMatch) {
      const auth = authorizeWriteRequest(req);
      if (!auth.ok) throw auth.error;
      const deleted = deleteDocument(documentDeleteMatch[1]);
      consumeWriteQuota(auth.apiKey);
      setWriteQuotaHeaders(res, auth.apiKey);
      pushAuditLog({
        action: '/api/documents/:documentId',
        method: 'DELETE',
        actor: auth.apiKey,
        targetId: deleted.id
      });
      persistStateToDisk();
      sendJson(res, deleted);
      return true;
    }

    const workspaceDeleteMatch = reqPath.match(/^\/api\/workspaces\/(ws-\d+)$/);
    if (workspaceDeleteMatch) {
      const auth = authorizeWriteRequest(req);
      if (!auth.ok) throw auth.error;
      const force = reqUrl.searchParams.get('force') === 'true';
      const deleted = deleteWorkspace(workspaceDeleteMatch[1], { force });
      consumeWriteQuota(auth.apiKey);
      setWriteQuotaHeaders(res, auth.apiKey);
      pushAuditLog({
        action: '/api/workspaces/:workspaceId',
        method: 'DELETE',
        actor: auth.apiKey,
        targetId: deleted.id
      });
      persistStateToDisk();
      sendJson(res, deleted);
      return true;
    }

    return false;
  }

  if (reqPath.startsWith('/api/')) {
    sendJson(res, { error: 'Method Not Allowed', allow: ['GET', 'POST', 'PATCH', 'DELETE'] }, 405);
    return true;
  }

  return false;
}

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const rawUrl = decodeURIComponent(req.url || '/');

      if (rawUrl.includes('..')) return sendText(res, 'Forbidden', 403);

      const reqUrl = new URL(req.url, `http://${req.headers.host}`);
      const reqPath = reqUrl.pathname;

      const apiHandled = await handleApi(req, res, reqPath, reqUrl);
      if (apiHandled) return;

      const normalized = reqPath === '/' ? '/index.html' : reqPath;
      const filePath = path.join(PUBLIC_DIR, normalized);

      if (!filePath.startsWith(PUBLIC_DIR)) return sendText(res, 'Forbidden', 403);
      return serveStaticFile(res, filePath);
    } catch (error) {
      const status = error.status || 500;
      const body = {
        error: error.message || 'internal server error'
      };
      if (error.details) body.details = error.details;
      return sendJson(res, body, status);
    }
  });
}

loadStateFromDisk();

const server = createServer();

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`YourselfOnAir MVP running on http://localhost:${PORT}`);
  });
}

module.exports = {
  server,
  createServer,
  GET_ROUTES,
  POST_ROUTES,
  authorizeWriteRequest,
  getWriteUsage,
  getWriteQuotaOverview,
  consumeWriteQuota,
  resetWriteUsage,
  loadStateFromDisk,
  persistStateToDisk,
  createPortableSnapshot,
  importPortableSnapshot
};
