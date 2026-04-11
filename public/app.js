async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
  return res.json();
}

function renderList(targetId, list, formatter) {
  const target = document.getElementById(targetId);
  target.innerHTML = '';
  list.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = formatter(item);
    target.appendChild(li);
  });
}

(async function init() {
  const [workspaces, documents, tasks, policies, billing, selfDistill, expertDistill, provenance, fusionPreview] = await Promise.all([
  const [workspaces, documents, tasks, policies, billing] = await Promise.all([
    fetchJson('/api/workspaces'),
    fetchJson('/api/documents'),
    fetchJson('/api/tasks'),
    fetchJson('/api/policies'),
    fetchJson('/api/billing'),
    fetchJson('/api/distillation/self'),
    fetchJson('/api/distillation/expert'),
    fetchJson('/api/provenance'),
    fetchJson('/api/fusion/preview')
  ]);

  renderList('workspaces', workspaces, (w) => `${w.name}（owner: ${w.owner} / ${w.visibility}）`);
  renderList('documents', documents, (d) => `${d.name} [${d.type}] - ${d.status} (${d.sourceType})`);
  renderList('tasks', tasks, (t) => `${t.kind.toUpperCase()}：${t.prompt}（${t.status}） evidence=${t.evidenceRefs.length}`);
  renderList('policies', policies, (p) => `${p.audience} / ${p.title} / approval=${p.approvalRequired}`);

  renderList('self-workflow', selfDistill.workMemory.preferredWorkflow, (x) => x);
  renderList('expert-models', expertDistill.fiveLayers.mentalModels, (x) => x);
  renderList('expert-boundaries', expertDistill.fiveLayers.honestBoundaries, (x) => x);

  document.getElementById('provenance-pattern').textContent = provenance.ingestionPattern;
  document.getElementById('provenance-rule').textContent = provenance.rule;
  document.getElementById('fusion-weights').textContent = JSON.stringify(fusionPreview.weights);
  document.getElementById('fusion-output').textContent = fusionPreview.sampleOutput;
    fetchJson('/api/billing')
  ]);

  renderList('workspaces', workspaces, (w) => `${w.name}（owner: ${w.owner}）`);
  renderList('documents', documents, (d) => `${d.name} [${d.type}] - ${d.status}`);
  renderList('tasks', tasks, (t) => `${t.kind.toUpperCase()}：${t.prompt}（${t.status}）`);
  renderList('policies', policies, (p) => `${p.audience} / ${p.title}`);

  document.getElementById('plan').textContent = billing.plan;
  document.getElementById('storage').textContent = `${billing.usedGB}GB / ${billing.storageGB}GB`;
  document.getElementById('renew').textContent = billing.renewDate;
})();
