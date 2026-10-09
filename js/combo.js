import { GAME_CONFIG } from './config.js';

export function hitZoneWidthForCombo(combo, debuffType = null) {
  const comboWidth = Math.max(
    GAME_CONFIG.minHitZoneWidth,
    GAME_CONFIG.initialHitZoneWidth - Math.max(0, combo) * GAME_CONFIG.hitZoneShrinkPerCombo
  );
  if (debuffType === 'FATIGUE') {
    return Math.max(GAME_CONFIG.fatigueMinHitZoneWidth, comboWidth - GAME_CONFIG.fatigueHitZonePenalty);
  }
  return comboWidth;
}
