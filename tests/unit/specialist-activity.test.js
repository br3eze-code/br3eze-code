import {
  buildActivityIdentity,
  normalizeSpecialistActivity,
  summarizeSpecialistActivities,
} from '../../src/core/specialist-activity.js';
import { normalizeContractorWork } from '../../src/core/contractor-work-queue.js';
import { buildChannelUiPolicy } from '../../src/core/channel-ui-policy.js';

const scope = { tenantId: 'tenant-a', projectId: 'project-a', userId: 'user-a', siteId: 'site-a', domain: 'general' };

test('activity identity is stable across channels', () => {
  const base = { tenantId: 'tenant-a', projectId: 'project-a', wbsId: 'WP-ENG-004', agentRole: 'engineer' };
  expect(buildActivityIdentity({ ...base, channel: 'telegram' })).toEqual(buildActivityIdentity({ ...base, channel: 'whatsapp' }));
  expect(buildActivityIdentity(base).activityNumber).toBe('ACT-ENGINEER-WP-ENG-004');
});

test('contractor work exposes chart activity identifiers and supports QA', () => {
  const work = normalizeContractorWork({ wbsId: 'WP-QA-001', agentRole: 'qa', status: 'in_progress' }, scope);
  expect(work.activityId).toContain('tenant-a_project-a_WP-QA-001');
  expect(work.activityNumber).toBe('ACT-QA-WP-QA-001');
  expect(work.chartKey).toBe('qa:ACT-QA-WP-QA-001');
});

test('chart aggregation is tenant and project scoped', () => {
  const activities = [
    normalizeSpecialistActivity({ ...scope, wbsId: 'WP-ENG-001', agentRole: 'engineer', status: 'in_progress', plannedHours: 4, actualHours: 2, channel: 'telegram' }),
    normalizeSpecialistActivity({ ...scope, wbsId: 'WP-PRO-001', agentRole: 'procurement', status: 'verified', plannedHours: 3, actualHours: 3, channel: 'whatsapp' }),
    normalizeSpecialistActivity({ ...scope, tenantId: 'tenant-b', wbsId: 'WP-ENG-002', agentRole: 'engineer', plannedHours: 100 }),
  ];
  const summary = summarizeSpecialistActivities(activities, scope);
  expect(summary.activityCount).toBe(2);
  expect(summary.activityNumbers).toEqual(['ACT-ENGINEER-WP-ENG-001', 'ACT-PROCUREMENT-WP-PRO-001']);
  expect(summary.plannedHours).toBe(7);
  expect(summary.byRole).toEqual({ engineer: 1, procurement: 1 });
});

test('eligible specialist channel policy exposes activity actions', () => {
  const policy = buildChannelUiPolicy({ channel: 'telegram', role: 'operator', agentRole: 'qa', authorizedCapabilities: ['*'] });
  expect(policy.actions).toContain('team.activity_chart');
  expect(policy.actions).toContain('team.specialist_detail');
});
