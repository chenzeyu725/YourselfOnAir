const data = {
  workspaces: [
    { id: 'ws-001', name: '青云项目', owner: 'chen', updatedAt: '2026-04-11' },
    { id: 'ws-002', name: '增长实验室', owner: 'team-growth', updatedAt: '2026-04-10' }
  ],
  documents: [
    { id: 'doc-001', name: '客户周报模板.docx', type: 'docx', workspaceId: 'ws-001', status: 'indexed' },
    { id: 'doc-002', name: '销售对话记录.md', type: 'md', workspaceId: 'ws-001', status: 'indexed' },
    { id: 'doc-003', name: '运营策略白皮书.pdf', type: 'pdf', workspaceId: 'ws-002', status: 'processing' }
  ],
  tasks: [
    { id: 'task-001', kind: 'chat', prompt: '生成本周客户沟通建议', status: 'done' },
    { id: 'task-002', kind: 'doc', prompt: '生成项目复盘PPT提纲', status: 'queued' }
  ],
  policies: [
    {
      id: 'policy-001',
      audience: 'external',
      title: '外部口径-收入预期',
      rule: '外部沟通仅使用“项目仍在验证商业化路径”表述，不披露具体金额。'
    }
  ],
  billing: {
    plan: 'Pro',
    seats: 3,
    storageGB: 20,
    usedGB: 2.6,
    renewDate: '2026-05-11'
  }
};

module.exports = { data };
