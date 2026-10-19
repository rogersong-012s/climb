import { UI_TEXT } from './config.js';

const MAX_DEBUFF_SEVERITY = 3;
const DEBUFF_EXPIRY_EPSILON = 1e-8;
const LOW_BLOOD_SUGAR_DEBUFF_ID = 'LOW_BLOOD_SUGAR';
const HEART_PALPITATIONS_DEBUFF_ID = 'HEART_PALPITATIONS';

function resetHeartPalpitationsClock(state) {
  state.heartPalpitationsUntilWobbleMs = null;
  state.heartPalpitationsWobbleRemainingMs = 0;
}

export function getActiveDebuffs(state) {
  return Object.values(state.debuffs ?? {});
}

export function hasDebuff(state, type) {
  return Boolean(type && state.debuffs?.[type]);
}

export function removeDebuff(state, type) {
  if (!hasDebuff(state, type)) return false;
  delete state.debuffs[type];
  if (type === LOW_BLOOD_SUGAR_DEBUFF_ID) state.lowBloodSugarRhythmBallCount = 0;
  if (type === HEART_PALPITATIONS_DEBUFF_ID) resetHeartPalpitationsClock(state);
  return true;
}

export function applyDebuff(state, debuff) {
  const durationFloors = Number(debuff?.durationFloors);
  if (!debuff?.type || !Number.isFinite(durationFloors) || durationFloors <= 0) return null;

  state.debuffs ??= {};
  const existing = state.debuffs[debuff.type];
  if (debuff.type === LOW_BLOOD_SUGAR_DEBUFF_ID && !existing) {
    state.lowBloodSugarRhythmBallCount = 0;
  }
  if (debuff.type === HEART_PALPITATIONS_DEBUFF_ID && !existing) {
    resetHeartPalpitationsClock(state);
  }
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
      if (type === LOW_BLOOD_SUGAR_DEBUFF_ID) state.lowBloodSugarRhythmBallCount = 0;
      if (type === HEART_PALPITATIONS_DEBUFF_ID) resetHeartPalpitationsClock(state);
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
    case 'REDUCE_DEBUFF_DURATION': {
      const debuff = state.debuffs?.[solution.debuffType];
      const multiplier = Number(solution.durationMultiplier);
      if (!debuff || !Number.isFinite(multiplier) || multiplier <= 0) {
        return { message: UI_TEXT.qtePassed, kind: 'success', debuffCured: false };
      }
      debuff.remainingFloors *= multiplier;
      if (debuff.remainingFloors <= DEBUFF_EXPIRY_EPSILON) {
        removeDebuff(state, solution.debuffType);
        return { message: UI_TEXT.debuffCured, kind: 'success', debuffCured: true };
      }
      return { message: UI_TEXT.qtePassed, kind: 'success', debuffCured: false };
    }
    case 'CURE_AND_APPLY_DEBUFF': {
      const debuffCured = removeDebuff(state, solution.debuffType);
      const debuffApplied = solution.debuff ? applyDebuff(state, solution.debuff) : null;
      return {
        message: debuffCured ? UI_TEXT.debuffCured : UI_TEXT.qtePassed,
        kind: 'success',
        debuffCured,
        debuffApplied: Boolean(debuffApplied)
      };
    }
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
