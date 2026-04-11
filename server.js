const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  state,
  createWorkspace,
  createDocument,
  createTask,
  createPolicy,
  updateTaskStatus,
  createPolicyChangeRequest,
  approvePolicyChangeRequest
} = require('./api/store');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const WRITE_API_KEY = process.env.WRITE_API_KEY || 'dev-write-key';
const WRITE_QUOTA_PER_DAY = Number(process.env.WRITE_QUOTA_PER_DAY || 20);
const writeUsage = new Map();

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
  '/api/policies': () => state.policies,
  '/api/policy-change-requests': () => state.policyChangeRequests,
  '/api/distillation/self': () => state.distillation.self,
  '/api/distillation/expert': () => state.distillation.expert,
  '/api/provenance': () => state.distillation.provenance,
  '/api/fusion/preview': () => state.fusionPreview,
  '/api/billing': () => state.billing
};

function getWriteQuotaOverview(apiKey) {
  const used = getWriteUsage(apiKey);
  return {
    date: new Date().toISOString().slice(0, 10),
    quotaPerDay: WRITE_QUOTA_PER_DAY,
    used,
    remaining: Math.max(WRITE_QUOTA_PER_DAY - used, 0)
  };
}

const POST_ROUTES = {
  '/api/workspaces': createWorkspace,
  '/api/documents': createDocument,
  '/api/tasks': createTask,
  '/api/policies': createPolicy,
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

async function handleApi(req, res, reqPath) {
  if (req.method === 'GET') {
    if (reqPath === '/api/write-usage') {
      const auth = authorizeWriteRequest(req);
      if (!auth.ok) throw auth.error;
      sendJson(res, getWriteQuotaOverview(auth.apiKey));
      return true;
    }

    const getter = GET_ROUTES[reqPath];
    if (!getter) return false;
    sendJson(res, getter());
    return true;
  }

  if (req.method === 'POST') {
    const creator = POST_ROUTES[reqPath];
    if (!creator) return false;
    const auth = authorizeWriteRequest(req);
    if (!auth.ok) throw auth.error;
    const payload = await parseJsonBody(req);
    const created = creator(payload);
    consumeWriteQuota(auth.apiKey);
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
      sendJson(res, updated);
      return true;
    }

    return false;
  }

  if (reqPath.startsWith('/api/')) {
    sendJson(res, { error: 'Method Not Allowed', allow: ['GET', 'POST', 'PATCH'] }, 405);
    return true;
  }

  return false;
}

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const rawUrl = decodeURIComponent(req.url || '/');
      const reqPath = new URL(req.url, `http://${req.headers.host}`).pathname;

      if (rawUrl.includes('..')) return sendText(res, 'Forbidden', 403);

      const apiHandled = await handleApi(req, res, reqPath);
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
  resetWriteUsage
};
