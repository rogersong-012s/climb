import { GAME_CONFIG } from './config.js';
import { applyDebuff } from './effects.js';

export function applyHit(state) {
  state.combo += 1;
  state.stats.hits += 1;
  state.stats.maxCombo = Math.max(state.stats.maxCombo, state.combo);
  state.climbSpeed = Math.min(GAME_CONFIG.maxClimbSpeed, state.climbSpeed + GAME_CONFIG.hitSpeedBonus);
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
