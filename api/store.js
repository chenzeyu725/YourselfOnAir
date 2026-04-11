const { data } = require('./data');

const state = JSON.parse(JSON.stringify(data));

const allowedVisibility = new Set(['private', 'team']);
const allowedSourceTypes = new Set(['document', 'chat', 'image', 'log']);
const allowedTaskKinds = new Set(['chat', 'doc', 'analysis']);
const allowedTaskStatus = new Set(['queued', 'running', 'done', 'failed']);
const allowedAudience = new Set(['internal', 'external', 'partner']);

const nowDate = () => new Date().toISOString().slice(0, 10);

function nextId(prefix, collection) {
  const nums = collection
    .map((x) => {
      const m = String(x.id || '').match(/-(\d+)$/);
      return m ? Number(m[1]) : 0;
    })
    .sort((a, b) => b - a);
  return `${prefix}-${String((nums[0] || 0) + 1).padStart(3, '0')}`;
}

function badRequest(message, details = {}) {
  const err = new Error(message);
  err.code = 'BAD_REQUEST';
  err.status = 400;
  err.details = details;
  throw err;
}

function notFound(message) {
  const err = new Error(message);
  err.code = 'NOT_FOUND';
  err.status = 404;
  throw err;
}

function createWorkspace(payload) {
  if (!payload?.name || !payload?.owner) {
    badRequest('name and owner are required');
  }

  const visibility = payload.visibility || 'private';
  if (!allowedVisibility.has(visibility)) {
    badRequest('visibility must be private or team');
  }

  const item = {
    id: nextId('ws', state.workspaces),
    name: payload.name,
    owner: payload.owner,
    updatedAt: nowDate(),
    visibility
  };

  state.workspaces.push(item);
  return item;
}

function createDocument(payload) {
  if (!payload?.name || !payload?.type || !payload?.workspaceId) {
    badRequest('name, type and workspaceId are required');
  }

  const ws = state.workspaces.find((w) => w.id === payload.workspaceId);
  if (!ws) notFound('workspace not found');

  const sourceType = payload.sourceType || 'document';
  if (!allowedSourceTypes.has(sourceType)) {
    badRequest('sourceType must be one of: document, chat, image, log');
  }

  const item = {
    id: nextId('doc', state.documents),
    name: payload.name,
    type: payload.type,
    workspaceId: payload.workspaceId,
    status: 'processing',
    sourceType,
    checksum: payload.checksum || 'sha256:pending'
  };

  state.documents.push(item);
  return item;
}

function createTask(payload) {
  if (!payload?.kind || !payload?.prompt) {
    badRequest('kind and prompt are required');
  }
  if (!allowedTaskKinds.has(payload.kind)) {
    badRequest('kind must be one of: chat, doc, analysis');
  }

  const item = {
    id: nextId('task', state.tasks),
    kind: payload.kind,
    prompt: payload.prompt,
    status: 'queued',
    evidenceRefs: Array.isArray(payload.evidenceRefs) ? payload.evidenceRefs : []
  };

  state.tasks.push(item);
  return item;
}

function updateTaskStatus(taskId, payload) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) notFound('task not found');

  const { status } = payload || {};
  if (!allowedTaskStatus.has(status)) {
    badRequest('status must be one of: queued, running, done, failed');
  }

  task.status = status;
  return task;
}

function createPolicy(payload) {
  if (!payload?.audience || !payload?.title || !payload?.rule) {
    badRequest('audience, title and rule are required');
  }
  if (!allowedAudience.has(payload.audience)) {
    badRequest('audience must be one of: internal, external, partner');
  }

  const item = {
    id: nextId('policy', state.policies),
    audience: payload.audience,
    title: payload.title,
    rule: payload.rule,
    approvalRequired: payload.approvalRequired !== false,
    changedBy: payload.changedBy || 'system'
  };

  state.policies.push(item);
  return item;
}

module.exports = {
  state,
  createWorkspace,
  createDocument,
  createTask,
  createPolicy,
  updateTaskStatus
};
