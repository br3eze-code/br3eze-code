import { describe, expect, test } from '@jest/globals';
import {
  canHandoff,
  getSpecialistTeam,
  listSpecialistTeams,
  resolveSpecialistForSkill,
  validateSpecialistRoster
} from '../../src/core/specialist-agent-roster.js';

describe('specialist agent roster', () => {
  test('covers all eleven specialist teams', () => {
    const teams = listSpecialistTeams();
    expect(teams).toHaveLength(11);
    expect(teams.map((team) => team.skill)).toEqual(expect.arrayContaining([
      'designer',
      'catalog-specialist',
      'pricing-promotions-specialist',
      'inventory-specialist',
      'orders-checkout-specialist',
      'voucher-access-specialist',
      'fulfillment-expeditor-specialist',
      'procurement-specialist',
      'billing-payments-specialist',
      'product-specialist',
      'project-manager'
    ]));
  });

  test('resolves voucher ownership to Voucher and Access Specialist', () => {
    expect(resolveSpecialistForSkill('voucher-access-specialist')).toMatchObject({
      id: 'voucher-access',
      name: 'Voucher and Access Specialist'
    });
  });

  test('enforces declared handoff boundaries', () => {
    expect(canHandoff('fulfillment-expeditor', 'procurement')).toBe(true);
    expect(canHandoff('procurement', 'billing-payments')).toBe(true);
    expect(canHandoff('voucher-access', 'designer')).toBe(false);
  });

  test('supports lookup by team id and returns null for unknown teams', () => {
    expect(getSpecialistTeam('project-manager')?.skill).toBe('project-manager');
    expect(getSpecialistTeam('missing-team')).toBeNull();
  });

  test('has valid references for every dependency and handoff', () => {
    expect(validateSpecialistRoster()).toEqual({ valid: true, errors: [], teamCount: 11 });
  });
});
