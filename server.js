const http = require('http');
const fs = require('fs');
const path = require('path');
const { data } = require('./api/data');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

const API_ROUTES = {
  '/api/health': () => ({ ok: true, service: 'yourself-on-air-mvp' }),
  '/api/workspaces': () => data.workspaces,
  '/api/documents': () => data.documents,
  '/api/tasks': () => data.tasks,
  '/api/policies': () => data.policies,
  '/api/distillation/self': () => data.distillation.self,
  '/api/distillation/expert': () => data.distillation.expert,
  '/api/provenance': () => data.distillation.provenance,
  '/api/fusion/preview': () => data.fusionPreview,
  '/api/billing': () => data.billing
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

function serveStaticFile(res, filePath) {
  fs.readFile(filePath, (err, file) => {
    if (err) return sendText(res, 'Not found', 404);

    const ext = path.extname(filePath);
    setSecurityHeaders(res);
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream' });
    res.end(file);
  });
}

function createServer() {
  return http.createServer((req, res) => {
    const rawUrl = decodeURIComponent(req.url || '/');
    const reqPath = new URL(req.url, `http://${req.headers.host}`).pathname;

    if (rawUrl.includes('..')) {
      return sendText(res, 'Forbidden', 403);
    }

    if (req.method !== 'GET') {
      return sendJson(res, { error: 'Method Not Allowed', allow: ['GET'] }, 405);
    }

    const apiHandler = API_ROUTES[reqPath];
    if (apiHandler) {
      return sendJson(res, apiHandler());
    }

    const normalized = reqPath === '/' ? '/index.html' : reqPath;
    const filePath = path.join(PUBLIC_DIR, normalized);

    if (!filePath.startsWith(PUBLIC_DIR)) {
      return sendText(res, 'Forbidden', 403);
    }

    return serveStaticFile(res, filePath);
  });
}

const server = createServer();

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`YourselfOnAir MVP running on http://localhost:${PORT}`);
  });
}

module.exports = { server, createServer, API_ROUTES };
