import { calculateActivitySchedule, activityLogicTable } from '../../src/core/activity-schedule.js';

test('calculates forward pass, backward pass, total float, and free float', () => {
  const schedule = calculateActivitySchedule([
    { id: 'A', duration: 3, specialistRole: 'planner' },
    { id: 'B', duration: 2, predecessors: ['A'], specialistRole: 'engineer' },
    { id: 'C', duration: 4, predecessors: ['A'], specialistRole: 'designer' },
    { id: 'D', duration: 1, predecessors: ['B', 'C'], specialistRole: 'qa' },
  ]);

  expect(schedule.projectDuration).toBe(8);
  const rows = Object.fromEntries(schedule.activities.map((activity) => [activity.id, activity]));
  expect(rows.A).toMatchObject({ earlyStart: 0, earlyFinish: 3, lateStart: 0, lateFinish: 3, totalFloat: 0, critical: true });
  expect(rows.B).toMatchObject({ earlyStart: 3, earlyFinish: 5, lateStart: 5, lateFinish: 7, totalFloat: 2, freeFloat: 2, critical: false });
  expect(rows.C).toMatchObject({ earlyStart: 3, earlyFinish: 7, lateStart: 3, lateFinish: 7, totalFloat: 0, freeFloat: 0, critical: true });
  expect(rows.D).toMatchObject({ earlyStart: 7, earlyFinish: 8, lateStart: 7, lateFinish: 8, totalFloat: 0, critical: true });

  expect(activityLogicTable(schedule)).toEqual(expect.arrayContaining([
    expect.objectContaining({ activityNumber: 'ACT-001', id: 'A', specialistRole: 'planner' }),
    expect.objectContaining({ activityNumber: 'ACT-004', id: 'D', status: 'planned' }),
  ]));
});

test('rejects dependency cycles and unknown predecessors', () => {
  expect(() => calculateActivitySchedule([
    { id: 'A', duration: 1, predecessors: ['B'] },
    { id: 'B', duration: 1, predecessors: ['A'] },
  ])).toThrow('dependency cycle');
  expect(() => calculateActivitySchedule([{ id: 'A', duration: 1, predecessors: ['missing'] }])).toThrow('Unknown predecessor');
});
