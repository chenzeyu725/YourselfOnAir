const http = require('http');
const fs = require('fs');
const path = require('path');
const { data } = require('./api/data');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const json = (res, payload, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
};

const serveFile = (res, filePath) => {
  fs.readFile(filePath, (err, file) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath);
    const contentTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8'
    };

    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain; charset=utf-8' });
    res.end(file);
  });
};

const server = http.createServer((req, res) => {
  const reqPath = new URL(req.url, `http://${req.headers.host}`).pathname;

  if (reqPath === '/api/health') return json(res, { ok: true, service: 'yourself-on-air-mvp' });
  if (reqPath === '/api/workspaces') return json(res, data.workspaces);
  if (reqPath === '/api/documents') return json(res, data.documents);
  if (reqPath === '/api/tasks') return json(res, data.tasks);
  if (reqPath === '/api/policies') return json(res, data.policies);
  if (reqPath === '/api/billing') return json(res, data.billing);

  const normalized = reqPath === '/' ? '/index.html' : reqPath;
  const filePath = path.join(PUBLIC_DIR, normalized);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  serveFile(res, filePath);
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`YourselfOnAir MVP running on http://localhost:${PORT}`);
  });
}

module.exports = { server };
