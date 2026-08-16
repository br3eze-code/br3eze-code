import roster from '../../config/specialist-agent-roster.json' with { type: 'json' };

const teams = Object.freeze(roster.teams.map((team) => Object.freeze({
  ...team,
  dependsOn: Object.freeze([...team.dependsOn]),
  handoffsTo: Object.freeze([...team.handoffsTo]),
  owns: Object.freeze([...team.owns])
})));

const byId = new Map(teams.map((team) => [team.id, team]));
const bySkill = new Map(teams.map((team) => [team.skill, team]));

export function listSpecialistTeams() {
  return teams.map((team) => ({
    ...team,
    dependsOn: [...team.dependsOn],
    handoffsTo: [...team.handoffsTo],
    owns: [...team.owns]
  }));
}

export function getSpecialistTeam(identifier) {
  if (!identifier || typeof identifier !== 'string') return null;
  const team = byId.get(identifier) || bySkill.get(identifier);
  return team ? {
    ...team,
    dependsOn: [...team.dependsOn],
    handoffsTo: [...team.handoffsTo],
    owns: [...team.owns]
  } : null;
}

export function resolveSpecialistForSkill(skillName) {
  return getSpecialistTeam(skillName);
}

export function canHandoff(fromTeam, toTeam) {
  const source = getSpecialistTeam(fromTeam);
  return Boolean(source && source.handoffsTo.includes(toTeam));
}

export function validateSpecialistRoster() {
  const ids = new Set();
  const skills = new Set();
  const errors = [];

  for (const team of teams) {
    if (ids.has(team.id)) errors.push(`duplicate team id: ${team.id}`);
    if (skills.has(team.skill)) errors.push(`duplicate skill: ${team.skill}`);
    ids.add(team.id);
    skills.add(team.skill);

    for (const dependency of team.dependsOn) {
      if (!byId.has(dependency)) errors.push(`${team.id} depends on unknown team: ${dependency}`);
    }
    for (const handoff of team.handoffsTo) {
      if (!byId.has(handoff)) errors.push(`${team.id} hands off to unknown team: ${handoff}`);
    }
  }

  return { valid: errors.length === 0, errors, teamCount: teams.length };
}

export { roster };
export default {
  listSpecialistTeams,
  getSpecialistTeam,
  resolveSpecialistForSkill,
  canHandoff,
  validateSpecialistRoster
};
