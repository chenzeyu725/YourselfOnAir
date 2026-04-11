const data = {
  workspaces: [
    { id: 'ws-001', name: '青云项目', owner: 'chen', updatedAt: '2026-04-11', visibility: 'team' },
    { id: 'ws-002', name: '增长实验室', owner: 'team-growth', updatedAt: '2026-04-10', visibility: 'private' }
  ],
  documents: [
    {
      id: 'doc-001',
      name: '客户周报模板.docx',
      type: 'docx',
      workspaceId: 'ws-001',
      status: 'indexed',
      sourceType: 'document',
      checksum: 'sha256:22adf...'
    },
    {
      id: 'doc-002',
      name: '销售对话记录.md',
      type: 'md',
      workspaceId: 'ws-001',
      status: 'indexed',
      sourceType: 'chat',
      checksum: 'sha256:8bc9a...'
    },
    {
      id: 'doc-003',
      name: '运营策略白皮书.pdf',
      type: 'pdf',
      workspaceId: 'ws-002',
      status: 'processing',
      sourceType: 'document',
      checksum: 'sha256:b13f1...'
    }
  ],
  tasks: [
    {
      id: 'task-001',
      kind: 'chat',
      prompt: '生成本周客户沟通建议',
      status: 'done',
      evidenceRefs: ['doc-001#p2', 'doc-002#L18-L44']
    },
    {
      id: 'task-002',
      kind: 'doc',
      prompt: '生成项目复盘PPT提纲',
      status: 'queued',
      evidenceRefs: []
    }
  ],
  policies: [
    {
      id: 'policy-001',
      audience: 'external',
      title: '外部口径-收入预期',
      rule: '外部沟通仅使用“项目仍在验证商业化路径”表述，不披露具体金额。',
      approvalRequired: true,
      changedBy: 'ops-manager'
    }
  ],
  policyChangeRequests: [
    {
      id: 'pcr-001',
      policyId: 'policy-001',
      proposedRule: '外部沟通统一使用“项目仍在验证商业化路径”口径，不披露收入金额与时间点。',
      reason: '统一对外话术，降低不一致披露风险',
      status: 'approved',
      requestedBy: 'ops-manager',
      approvedBy: 'compliance-lead',
      rejectedBy: null,
      rejectReason: null,
      requestedAt: '2026-04-10',
      approvedAt: '2026-04-10',
      rejectedAt: null
    }
  ],
  distillation: {
    self: {
      workMemory: {
        projects: ['青云项目', '增长实验室'],
        preferredWorkflow: ['先列目标', '后列约束', '再给两套备选方案'],
        recurringDecisionBasis: ['ROI优先', '可追溯证据优先', '沟通成本最低优先']
      },
      workPersona: {
        tone: '清晰直接，避免空话',
        responseStyle: ['结论先行', '给执行步骤', '说明风险'],
        timeManagement: '默认给出24小时内可落地动作'
      }
    },
    expert: {
      expertName: 'Nuwa-style Expert Lens',
      fiveLayers: {
        expressionDNA: '短句、强判断、少形容词',
        mentalModels: ['第一性原理', '机会成本', '逆向验证'],
        decisionHeuristics: ['先算上限/下限', '先去掉不可行项，再优化可行项'],
        antiPatterns: ['不基于证据的拍脑袋承诺', '为了好看而牺牲可执行性'],
        honestBoundaries: ['无法替代真实一手访谈', '无法保证对未来事件给出确定预测']
      }
    },
    provenance: {
      ingestionPattern: 'multi-source-ingestion',
      sourceBuckets: ['聊天记录', '工作文档', '策略复盘', '外部专家公开材料'],
      rule: '回答必须附带 evidenceRefs'
    }
  },
  fusionPreview: {
    weights: {
      enterpriseFacts: 0.5,
      selfStyle: 0.25,
      expertLens: 0.2,
      taskConstraints: 0.05
    },
    sampleOutput: '建议先保留现有获客漏斗主链路，只优化转化损耗最高的两步，并在外部沟通中统一使用“验证商业化路径”口径。'
  },
  billing: {
    plan: 'Pro',
    seats: 3,
    storageGB: 20,
    usedGB: 2.6,
    renewDate: '2026-05-11'
  }
};

module.exports = { data };
