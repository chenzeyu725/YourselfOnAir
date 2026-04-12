const { data } = require('./data');

const state = JSON.parse(JSON.stringify(data));

const allowedVisibility = new Set(['private', 'team']);
const allowedSourceTypes = new Set(['document', 'chat', 'image', 'log']);
const allowedTaskKinds = new Set(['chat', 'doc', 'analysis']);
const allowedTaskStatus = new Set(['queued', 'running', 'done', 'failed']);
const allowedAudience = new Set(['internal', 'external', 'partner']);
const allowedPolicyChangeStatus = new Set(['pending', 'approved', 'rejected']);

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

function normalizeEvidenceRefs(evidenceRefs, fieldName = 'evidenceRefs') {
  if (evidenceRefs === undefined) return undefined;
  if (!Array.isArray(evidenceRefs) || evidenceRefs.some((ref) => typeof ref !== 'string' || ref.trim() === '')) {
    badRequest(`${fieldName} must be an array of non-empty strings when provided`);
  }
  return evidenceRefs.map((ref) => ref.trim());
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

  const normalizedEvidenceRefs = normalizeEvidenceRefs(payload.evidenceRefs);

  const item = {
    id: nextId('task', state.tasks),
    kind: payload.kind,
    prompt: payload.prompt,
    status: 'queued',
    evidenceRefs: normalizedEvidenceRefs || []
  };

  state.tasks.push(item);
  return item;
}

function createTaskFromTemplate(payload) {
  if (!payload?.templateId) {
    badRequest('templateId is required');
  }

  const template = state.taskTemplates.find((t) => t.id === payload.templateId);
  if (!template) {
    notFound('task template not found');
  }

  const workspace = payload.workspaceId
    ? state.workspaces.find((w) => w.id === payload.workspaceId)
    : state.workspaces[0];
  if (!workspace) {
    badRequest('workspaceId is invalid');
  }

  const prompt = (payload.prompt || template.promptTemplate).replaceAll('{workspaceName}', workspace.name);
  const payloadEvidenceRefs = normalizeEvidenceRefs(payload.evidenceRefs);
  const templateEvidenceRefs = normalizeEvidenceRefs(template.defaultEvidenceRefs, 'template.defaultEvidenceRefs') || [];
  const evidenceRefs = payloadEvidenceRefs || templateEvidenceRefs;

  const item = {
    id: nextId('task', state.tasks),
    kind: template.kind,
    prompt,
    status: 'queued',
    evidenceRefs,
    templateId: template.id,
    workspaceId: workspace.id
  };

  state.tasks.push(item);
  return item;
}

function updateTaskStatus(taskId, payload) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) notFound('task not found');

  const { status, evidenceRefs } = payload || {};
  if (status === undefined && evidenceRefs === undefined) {
    badRequest('at least one of status or evidenceRefs is required');
  }

  if (status !== undefined && !allowedTaskStatus.has(status)) {
    badRequest('status must be one of: queued, running, done, failed');
  }

  const normalizedEvidenceRefs = normalizeEvidenceRefs(evidenceRefs);
  if (normalizedEvidenceRefs !== undefined) {
    task.evidenceRefs = normalizedEvidenceRefs;
  }

  const nextStatus = status === undefined ? task.status : status;
  if (nextStatus === 'done' && (!Array.isArray(task.evidenceRefs) || task.evidenceRefs.length === 0)) {
    badRequest('task without evidenceRefs cannot be marked as done');
  }

  if (status !== undefined) {
    task.status = status;
  }
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

function createPolicyChangeRequest(payload) {
  if (!payload?.policyId || !payload?.proposedRule || !payload?.reason || !payload?.requestedBy) {
    badRequest('policyId, proposedRule, reason and requestedBy are required');
  }

  const policy = state.policies.find((p) => p.id === payload.policyId);
  if (!policy) notFound('policy not found');

  const item = {
    id: nextId('pcr', state.policyChangeRequests),
    policyId: payload.policyId,
    proposedRule: payload.proposedRule,
    reason: payload.reason,
    status: 'pending',
    requestedBy: payload.requestedBy,
    approvedBy: null,
    rejectedBy: null,
    rejectReason: null,
    requestedAt: nowDate(),
    approvedAt: null,
    rejectedAt: null
  };

  state.policyChangeRequests.push(item);
  return item;
}

function rejectPolicyChangeRequest(requestId, payload) {
  const req = state.policyChangeRequests.find((x) => x.id === requestId);
  if (!req) notFound('policy change request not found');

  const { status, rejectedBy, rejectReason } = payload || {};
  if (!allowedPolicyChangeStatus.has(status)) {
    badRequest('status must be one of: pending, approved, rejected');
  }
  if (status !== 'rejected') {
    badRequest('only rejected status is supported for PATCH');
  }
  if (!rejectedBy) {
    badRequest('rejectedBy is required');
  }
  if (!rejectReason) {
    badRequest('rejectReason is required');
  }
  if (req.status !== 'pending') {
    badRequest(`cannot reject request in ${req.status} status`);
  }

  req.status = 'rejected';
  req.rejectedBy = rejectedBy;
  req.rejectReason = rejectReason;
  req.rejectedAt = nowDate();

  return req;
}

function approvePolicyChangeRequest(requestId, payload) {
  const req = state.policyChangeRequests.find((x) => x.id === requestId);
  if (!req) notFound('policy change request not found');

  const { status, approvedBy } = payload || {};
  if (!allowedPolicyChangeStatus.has(status)) {
    badRequest('status must be one of: pending, approved, rejected');
  }
  if (status !== 'approved') {
    badRequest('only approved status is supported for PATCH');
  }
  if (!approvedBy) {
    badRequest('approvedBy is required');
  }
  if (req.status !== 'pending') {
    badRequest(`cannot approve request in ${req.status} status`);
  }

  const policy = state.policies.find((p) => p.id === req.policyId);
  if (!policy) notFound('linked policy not found');

  req.status = 'approved';
  req.approvedBy = approvedBy;
  req.approvedAt = nowDate();

  policy.rule = req.proposedRule;
  policy.changedBy = approvedBy;

  return req;
}

function deleteTask(taskId) {
  const index = state.tasks.findIndex((task) => task.id === taskId);
  if (index < 0) notFound('task not found');
  const [deleted] = state.tasks.splice(index, 1);
  return deleted;
}

function deleteDocument(documentId) {
  const index = state.documents.findIndex((doc) => doc.id === documentId);
  if (index < 0) notFound('document not found');
  const [deleted] = state.documents.splice(index, 1);
  return deleted;
}

function deleteWorkspace(workspaceId, options = {}) {
  const { force = false } = options;
  const index = state.workspaces.findIndex((workspace) => workspace.id === workspaceId);
  if (index < 0) notFound('workspace not found');

  const relatedDocuments = state.documents.filter((doc) => doc.workspaceId === workspaceId).map((doc) => doc.id);
  const relatedTasks = state.tasks.filter((task) => task.workspaceId === workspaceId).map((task) => task.id);
  if (!force && (relatedDocuments.length > 0 || relatedTasks.length > 0)) {
    badRequest('workspace has related resources, use force=true to delete', {
      relatedDocuments,
      relatedTasks
    });
  }

  if (force) {
    state.documents = state.documents.filter((doc) => doc.workspaceId !== workspaceId);
    state.tasks = state.tasks.filter((task) => task.workspaceId !== workspaceId);
  }

  const [deleted] = state.workspaces.splice(index, 1);
  return deleted;
}

module.exports = {
  state,
  createWorkspace,
  createDocument,
  createTask,
  createTaskFromTemplate,
  createPolicy,
  updateTaskStatus,
  deleteTask,
  deleteDocument,
  deleteWorkspace,
  createPolicyChangeRequest,
  approvePolicyChangeRequest,
  rejectPolicyChangeRequest
};
