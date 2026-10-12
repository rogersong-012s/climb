import { UI_TEXT } from './config.js';

export function applyDebuff(state, debuff) {
  if (!debuff || !debuff.type || debuff.durationFloors <= 0) return null;
  state.debuff = {
    type: debuff.type,
    remainingFloors: debuff.durationFloors,
    totalFloors: debuff.durationFloors
  };
  return state.debuff;
}

export function consumeDebuffDistance(state, climbedFloors) {
  if (!state.debuff || climbedFloors <= 0) return false;
  state.debuff.remainingFloors = Math.max(0, state.debuff.remainingFloors - climbedFloors);
  if (state.debuff.remainingFloors <= 1e-8) {
    state.debuff = null;
    return true;
  }
  return false;
}

export function applySolutionEffect(state, solution) {
  switch (solution.effect) {
    case 'CURE':
      if (state.debuff?.type === solution.debuffType) {
        state.debuff = null;
        return { message: UI_TEXT.debuffCured, kind: 'success', debuffCured: true };
      }
      return { message: UI_TEXT.qtePassed, kind: 'success', debuffCured: false };
    case 'PAN_ATTACK':
      applyDebuff(state, solution.debuff);
      return { message: UI_TEXT.monsterWon, kind: 'success' };
    case 'APPLY_DEBUFF':
      applyDebuff(state, solution.debuff);
      return { message: UI_TEXT.qtePassed, kind: 'success' };
    case 'NONE':
    default:
      return { message: UI_TEXT.qtePassed, kind: 'success' };
  }
}
