import { GAME_CONFIG } from './config.js';
import { applyDebuff } from './effects.js';

export function applyHit(state, speedRewardMultiplier = 1) {
  state.combo += 1;
  state.stats.hits += 1;
  state.stats.maxCombo = Math.max(state.stats.maxCombo, state.combo);
  const maxClimbSpeed = Number.isFinite(state.maxClimbSpeed)
    ? state.maxClimbSpeed
    : GAME_CONFIG.maxClimbSpeed;
  const rewardMultiplier = Math.max(0, Number(speedRewardMultiplier) || 0);
  state.climbSpeed = Math.min(maxClimbSpeed, state.climbSpeed + GAME_CONFIG.hitSpeedBonus * rewardMultiplier);
  return { climbSpeed: state.climbSpeed };
}

export function applyMiss(state) {
  state.combo = 0;
  state.stats.misses += 1;
}

export function knockBack(state, floors, debuff = null) {
  state.progress = Math.max(GAME_CONFIG.startFloor, state.progress - floors);
  state.combo = 0;
  if (debuff) applyDebuff(state, debuff);
}
