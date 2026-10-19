import { GAME_CONFIG } from './config.js';

export function hitZoneWidthForCombo(combo, debuffType = null, judgmentMultiplier = 1) {
  const baseWidth = Math.max(
    GAME_CONFIG.minHitZoneWidth,
    GAME_CONFIG.initialHitZoneWidth - Math.max(0, combo) * GAME_CONFIG.hitZoneShrinkPerCombo
  );
  const upgradeBonus = GAME_CONFIG.initialHitZoneWidth * Math.max(0, judgmentMultiplier - 1);
  const comboWidth = baseWidth + upgradeBonus;
  return comboWidth;
}
