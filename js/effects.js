import { UI_TEXT } from './config.js';

const MAX_DEBUFF_SEVERITY = 3;
const DEBUFF_EXPIRY_EPSILON = 1e-8;

export function getActiveDebuffs(state) {
  return Object.values(state.debuffs ?? {});
}

export function hasDebuff(state, type) {
  return Boolean(type && state.debuffs?.[type]);
}

export function removeDebuff(state, type) {
  if (!hasDebuff(state, type)) return false;
  delete state.debuffs[type];
  return true;
}

export function applyDebuff(state, debuff) {
  const durationFloors = Number(debuff?.durationFloors);
  if (!debuff?.type || !Number.isFinite(durationFloors) || durationFloors <= 0) return null;

  state.debuffs ??= {};
  const existing = state.debuffs[debuff.type];
  const next = {
    type: debuff.type,
    severity: existing
      ? Math.min(MAX_DEBUFF_SEVERITY, Math.max(1, Number(existing.severity) || 1) + 1)
      : 1,
    remainingFloors: durationFloors,
    totalFloors: durationFloors
  };
  state.debuffs[debuff.type] = next;
  state.debuffAppliedSerial = (Number(state.debuffAppliedSerial) || 0) + 1;
  return next;
}

export function consumeDebuffDistance(state, climbedFloors) {
  const debuffs = state.debuffs ?? {};
  const distance = Math.max(0, Number(climbedFloors) || 0);
  let expiredAny = false;
  for (const [type, debuff] of Object.entries(debuffs)) {
    if (distance > 0) {
      debuff.remainingFloors = Math.max(0, debuff.remainingFloors - distance);
    }
    if (debuff.remainingFloors <= DEBUFF_EXPIRY_EPSILON) {
      delete debuffs[type];
      expiredAny = true;
    }
  }
  return expiredAny;
}

export function applySolutionEffect(state, solution, { debuffAlreadyApplied = false } = {}) {
  switch (solution.effect) {
    case 'CURE':
      if (removeDebuff(state, solution.debuffType)) {
        return { message: UI_TEXT.debuffCured, kind: 'success', debuffCured: true };
      }
      return { message: UI_TEXT.qtePassed, kind: 'success', debuffCured: false };
    case 'PAN_ATTACK':
      if (!debuffAlreadyApplied) applyDebuff(state, solution.debuff);
      return { message: UI_TEXT.monsterWon, kind: 'success' };
    case 'APPLY_DEBUFF':
      if (!debuffAlreadyApplied) applyDebuff(state, solution.debuff);
      return { message: UI_TEXT.qtePassed, kind: 'success' };
    case 'NONE':
    default:
      return { message: UI_TEXT.qtePassed, kind: 'success' };
  }
}
