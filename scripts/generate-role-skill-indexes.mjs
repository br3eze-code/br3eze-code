import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.argv[2] || path.resolve('skills');
const roles = {
  'agentos-specialist-swarm': { role: 'specialist-swarm', kind: 'coordination', approval: ['role.assign', 'handoff.commit'] },
  'agentos-project-manager': { role: 'project-manager', kind: 'coordination', approval: ['scope.change', 'budget.commit', 'subcontract.commit', 'closeout.accept'] },
  'agentos-planner': { role: 'planner', kind: 'planning', approval: ['baseline.commit', 'scope.change'] },
  'agentos-engineer': { role: 'engineer', kind: 'technical', approval: ['code.write', 'config.write', 'deploy', 'device.mutation'] },
  'agentos-accountant': { role: 'accountant', kind: 'commercial', approval: ['ledger.write', 'payment.release', 'refund', 'settlement.release'] },
  'agentos-secretary': { role: 'secretary', kind: 'coordination', approval: ['message.send', 'calendar.commit', 'record.share'] },
  'agentos-procurement': { role: 'procurement', kind: 'commercial', approval: ['supplier.commit', 'purchase.order', 'tender.award'] },
  'agentos-expeditor': { role: 'expeditor', kind: 'fulfillment', approval: ['shipment.change', 'vendor.escalate', 'notify.send'] },
  'agentos-designer': { role: 'designer', kind: 'design', approval: ['design.publish', 'scope.change'] },
  'agentos-draftsman': { role: 'draftsman', kind: 'document-control', approval: ['document.issue', 'document.publish', 'record.share'] },
  'agentos-qa': { role: 'qa', kind: 'quality', approval: ['defect.waive', 'qa.accept', 'commissioning.accept', 'closeout.accept'] },
  'agentos-editor': { role: 'editor', kind: 'document-control', approval: ['document.publish', 'record.share', 'message.send'] }
};

const template = ({ role, kind, approval }) => `/**\n * AgentOS ${role} specialist skill entry point.\n * The index is metadata and an execution-context factory; policy still validates every action.\n */\nexport const specialist = Object.freeze({\n  role: '${role}',\n  kind: '${kind}',\n  approvalRequired: Object.freeze(${JSON.stringify(approval)}),\n  createContext(input = {}) {\n    const required = ['userId', 'tenantId'];\n    const missing = required.filter((key) => !input[key]);\n    if (missing.length) throw new Error(\`Missing specialist context: \${missing.join(', ')}\`);\n    return Object.freeze({\n      ...input,\n      agentRole: '${role}',\n      skillPackage: '${role}',\n      approvalRequired: [...specialist.approvalRequired]\n    });\n  }\n});\n\nexport const role = specialist.role;\nexport const createContext = specialist.createContext;\nexport default specialist;\n`;

for (const [packageName, metadata] of Object.entries(roles)) {
  const dir = path.join(root, packageName);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'index.js'), template(metadata));
}
console.log(`Generated ${Object.keys(roles).length} role skill indexes in ${root}`);
