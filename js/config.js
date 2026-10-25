const startFloor = 1;
const maxFloor = 101;
const monsterEventIntervalFloors = 5;
const purpleBaseTotalBeats = 7;
const purpleBaseHitBeats = Object.freeze([0.5, 1, 2.5, 3, 3.5, 5, 5.5, 6]);
const monsterEventFloors = Object.freeze(Array.from(
  { length: Math.ceil((maxFloor - startFloor) / monsterEventIntervalFloors) },
  (_, index) => Object.freeze({
    min: startFloor + index * monsterEventIntervalFloors,
    max: Math.min(startFloor + (index + 1) * monsterEventIntervalFloors, maxFloor)
  })
));
const rhythmOrbPlatformAnchor = Object.freeze({ x: 350, y: 256 });

export const RHYTHM_AUDIO_CONFIG = Object.freeze({
  enabled: true,
  // Keep the shared output path at its current setting for SFX. The BGM path
  // removes a duplicated per-note attenuation and adds this separate lift.
  masterVolume: 0.26,
  masterGainBoostDb: 18,
  // Raise the shared non-BGM bus by +12 dB over its previous +6 dB setting.
  // The existing compressor and soft ceiling remain downstream for peak control.
  sfxMasterBoostDb: 18,
  audioSettingsStorageKey: 'dengfeng-zaoji-audio-settings-v1',
  defaultBgmVolumePercent: 45,
  defaultSfxVolumePercent: 90,
  // Combined with removal of the extra 0.26 per-note BGM factor and track trims,
  // this targets about +18 dB on the un-limited music path vs. the prior mix.
  bgmMasterBoostDb: 7.8,
  rhythmAudioOffsetMs: 0,
  bgmBars: 16,
  bgmBeatsPerBar: 4,
  bgmVolume: 0.42,
  bgmBusVolume: 0.78,
  bgmEncounterBusVolume: 0.78,
  bgmInstrumentBusLevels: Object.freeze({
    drums: 0.9,
    rhythmGuitar: 0.88,
    leadGuitar: 0.92,
    bass: 0.96,
    piano: 0.72,
    strings: 0.74,
    brass: 0.7
  }),
  bgmLookAheadSeconds: 0.12,
  bgmLateToleranceMs: 35,
  rhythmCueBusVolume: 1,
  feedbackBusVolume: 0.45,
  // Per-note trim: compensate for feedbackBusVolume without raising the shared SFX bus.
  // Both feedback sounds receive about +8 dB; prep cues and other SFX are unchanged.
  hitFeedbackVolume: 0.8,
  missFeedbackVolume: 0.55,
  hitFeedbackDurationSeconds: 0.14,
  missFeedbackDurationSeconds: 0.2,
  feedbackDuplicateGuardMs: 45,
  feedbackDuckDurationSeconds: 0.11,
  feedbackRhythmDuckGain: 1,
  feedbackBgmDuckGain: 1,
  prepCueVolume: 0.4,
  prepCueDurationSeconds: 0.14,
  prepCueNotesByType: Object.freeze({
    RED: Object.freeze([72, 74]),
    BLUE: Object.freeze([74, 77]),
    YELLOW: Object.freeze([76, 79]),
    GREEN: Object.freeze([79, 83]),
    PURPLE: Object.freeze([81, 84])
  }),
  lookAheadSeconds: 0.09,
  lateToleranceMs: 20,
});

export const GAME_CONFIG = Object.freeze({
  startFloor,
  maxFloor,
  initialClimbSpeed: 0.1,
  minClimbSpeed: 0.1,
  maxClimbSpeed: 0.3,
  hitSpeedBonus: 0.02,
  painClimbSpeedMultiplier: 0.8,
  monsterDefeatSpeedBonus: 0.01,
  monsterDefeatMaxSpeedBonus: 0.015,
  skipSkillMaxCharges: 3,
  skipSkillEnergyRequired: 48,
  skipSkillActivationSeconds: 2,
  skipSkillRhythmEnergy: Object.freeze({
    RED: 2.0,
    BLUE: 2.0,
    YELLOW: 4.0,
    GREEN: 6.0,
    PURPLE: 11.0
  }),
  skipSkillComboEnergyBonusPerCombo: 0.01,
  skipSkillComboEnergyBonusMaxCombo: 12,
  speedDecay: 0.005,
  stepCycleDistanceFloors: 0.1,
  basePlatformPauseDurationMs: 100,
  baseStairTurnDurationMs: 1200,
  turnReferenceSpeed: 0.25,
  antiDizzinessStorageKey: 'dengfeng-zaoji-anti-dizziness-mode-v1',
  initialHitZoneWidth: 0.3, // Timing tolerance as a fraction of one beat.
  hitZoneShrinkPerCombo: 0.01,
  minHitZoneWidth: 0.18,
  rhythmBeatDurationMs: 500,
  rhythmMoveSpeedMultiplier: 1.3,
  obesityClimbRewardMultiplier: 0.5,
  perfectRhythmSpeedBurstBonus: 0.1,
  perfectRhythmSpeedBurstDurationMs: 400,
  rhythmInputDebounceMs: 70,
  rhythmHitFlashDurationMs: 150,
  rhythmPrepareBeats: 2,
  rhythmReadyRingStartScale: 1.9,
  rhythmReadyFlashMs: 100,
  rhythmRespawnDelayBeats: 1,
  rhythmBgmBeatSnapToleranceMs: 8,
  heartPalpitationsWobbleIntervalMs: 1800,
  heartPalpitationsWobbleDurationMs: 250,
  heartPalpitationsWobbleXAmplitudePx: 10,
  heartPalpitationsWobbleYAmplitudePx: 5,
  heartPalpitationsMobileAmplitudeScale: 0.6,
  heartPalpitationsReducedAmplitudeScale: 0.4,
  lowBloodSugarDurationFloors: 5,
  lowBloodSugarRhythmInterval: 4,
  purpleRhythmStartOffsetBeats: 1,
  rhythmBallEdgeGapPx: 12,
  rhythmOrbApproachRangeFloors: 0.5,
  rhythmOrbCollectAnimationMs: 420,
  rhythmOrbUnlockToastMs: 2000,
  rhythmOrbPlatformAnchor,
  rhythmOrbUnlocks: Object.freeze([
    Object.freeze({ id: 'rhythm-yellow-16', floor: 16, typeId: 'YELLOW', platformAnchor: rhythmOrbPlatformAnchor }),
    Object.freeze({ id: 'rhythm-green-36', floor: 36, typeId: 'GREEN', platformAnchor: rhythmOrbPlatformAnchor }),
    Object.freeze({ id: 'rhythm-purple-61', floor: 61, typeId: 'PURPLE', platformAnchor: rhythmOrbPlatformAnchor })
  ]),
  // Keep weights centralized so future rhythm types can be tuned without changing selection logic.
  rhythmTypeWeights: Object.freeze({ RED: 1, BLUE: 1, YELLOW: 1, GREEN: 1, PURPLE: 1 }),
  monsterQteDurationMs: 2900,
  monsterQteFailureCompensationMs: 500,
  monsterQteFailureKnockbackFloors: 3,
  monsterQteFailureNoticeDurationMs: 1000,
  monsterEntranceShakeDurationMs: 300,
  monsterBaseHp: 100,
  monsterHpIncrement: 5,
  combatRoundIntroDurationMs: 800,
  combatDefenseVortexChargeDurationMs: 500,
  combatDefenseHitWindowMs: 300,
  combatDefenseLaserDurationMs: 220,
  combatDefenseHitEffectDurationMs: 360,
  combatDefenseShieldImpactReactionDurationMs: 120,
  // Percent of the stairwell arena height; the UI clamps this above the rhythm controls.
  combatDefenseShieldY: 87,
  combatDefenseVortexY: 54,
  combatDefenseLaserPierceAfterShieldPercent: 8,
  combatDefenseVortexFlashDurationMs: 200,
  combatDefenseInitialRandomDelayMinMs: 0,
  combatDefenseInitialRandomDelayMaxMs: 200,
  combatDefenseSuccessImpactDurationMs: 350,
  combatDefenseSuccessSplashDurationMs: 350,
  combatDefenseSuccessSplashOpacity: 0.22,
  combatDefenseResultDurationMs: 650,
  combatRapidTapDisabledDurationMs: 500,
  combatBaseAttackDamage: 30,
  combatRapidTapPrepareDelayMs: 100,
  combatRapidTapDurationMs: 2000,
  combatRapidTapDamage: 1,
  combatRhythmDamageMultipliers: Object.freeze({
    RED: 1,
    BLUE: 1,
    YELLOW: 1.05,
    GREEN: 1.15,
    PURPLE: 1.3
  }),
  upgradeChoiceCount: 2,
  combatRapidTapBallScale: 0.7,
  combatDefensePatterns: Object.freeze([
    Object.freeze({
      id: 'RED',
      color: 'red',
      laserColor: '#ff645b',
      attackTimesMs: Object.freeze([600, 1200])
    }),
    Object.freeze({
      id: 'BLUE',
      color: 'blue',
      laserColor: '#4285f4',
      attackTimesMs: Object.freeze([800, 1400, 2200])
    })
  ]),
  combatPlayerAttackDurationMs: 460,
  combatMonsterDeathDurationMs: 850,
  monsterEventIntervalFloors,
  monsterEventFractions: Object.freeze([0.2, 0.7]),
  monsterEventFloors,
  monsterWarningFlashDurationMs: 360,
  monsterWarningGapDurationMs: 150,
  monsterWarningFlashCount: 2,
  monsterWarningMaxOpacity: 0.3,
  monsterWarningReducedMotionOpacity: 0.14,
  monsterEntranceDurationMs: 700,
  monsterCastDurationMs: 600,
  monsterImpactEffectDurationMs: 340,
  monsterAttackToDebuffDelayMs: 250,
  monsterDebuffRevealDurationMs: 450,
  monsterDebuffToAnswerDelayMs: 400,
  monsterAnswerPreviewDurationMs: 1800,
  qteItemEntranceDurationMs: 200,
  qteItemMessageEntranceDurationMs: 250,
  qteItemHoldDurationMs: 1500,
  qteItemFadeDurationMs: 200,
  qteItemWhiteTransitionDurationMs: 400,
  debuffCureFlashDurationMs: 400,
  debuffCureFlashCount: 2,
  qteLetterMin: 8,
  qteLetterMax: 12,
  bestRecordStorageKey: 'dengfeng-zaoji-best-time-v1',
  feedbackDurationMs: 800,
  debuffs: {
    // Retained for compatibility with older saved/debug states; no current
    // scheduled monster applies this legacy movement penalty.
    SORE: { name: '痠痛', description: '節奏球移動速度降低', icon: '〰', speedMultiplier: 0.72 },
    BLACK_SPOTS: { name: '黑斑', description: '節奏 BAR 出現黑斑視覺干擾', icon: '◉' },
    BLUR: { name: '視野模糊', description: '節奏軌道微微模糊', icon: '◌', blurPx: 1.3 },
    OBESITY: { name: '肥胖', description: '一般攀登節奏全成功的加速獎勵減半', icon: '⬟' },
    LOW_BLOOD_SUGAR: { name: '低血糖', description: '每四顆攀登節奏球有一顆停用', icon: '◌' },
    PAIN: { name: '疼痛', description: '最終攀登速度與速度上限降低 20%', icon: '✦' },
    HEART_PALPITATIONS: { name: '心悸', description: '節奏 BAR 每 1.8 秒明顯震動一次', icon: '♡' }
  }
});

// Beat numbers are positions on a one-way track run; fractional beats are supported.
export const RHYTHM_TYPES = Object.freeze({
  RED: Object.freeze({
    label: '紅球',
    color: '#F26860',
    totalBeats: 5,
    hitBeats: Object.freeze([2, 3, 4])
  }),
  BLUE: Object.freeze({
    label: '藍球',
    color: '#4285F4',
    totalBeats: 5,
    hitBeats: Object.freeze([1, 3])
  }),
  YELLOW: Object.freeze({
    label: '黃球',
    color: '#F2D675',
    totalBeats: 6,
    hitBeats: Object.freeze([2.5, 3.5, 5, 5.5]),
    unlockFloor: 16
  }),
  GREEN: Object.freeze({
    label: '綠球',
    color: '#39C77A',
    totalBeats: 6,
    hitBeats: Object.freeze([1, 2.5, 3, 4, 4.5]),
    unlockFloor: 36
  }),
  PURPLE: Object.freeze({
    label: '紫球',
    color: '#9465EF',
    totalBeats: purpleBaseTotalBeats + GAME_CONFIG.purpleRhythmStartOffsetBeats,
    hitBeats: Object.freeze(purpleBaseHitBeats.map((beat) => beat + GAME_CONFIG.purpleRhythmStartOffsetBeats)),
    unlockFloor: 61
  })
});

export const ANTI_DIZZINESS_MODE = Object.freeze({
  OFF: 'OFF',
  ON: 'ON'
});

function defineUpgradeCard({ id, name, description, icon, color, effect }) {
  const frozenEffect = Object.freeze(effect);
  return Object.freeze({
    id,
    name,
    description: description(frozenEffect),
    icon,
    color,
    effect: frozenEffect
  });
}

export const UPGRADE_CARDS = Object.freeze([
  defineUpgradeCard({
    id: 'base-attack',
    name: '基礎攻擊強化',
    description: (effect) => '基礎攻擊力 +' + effect.perSelection,
    icon: '⚔',
    color: 'orange',
    effect: { type: 'base-attack', perSelection: 10 }
  }),
  defineUpgradeCard({
    id: 'rapid-tap-attack',
    name: '連打傷害強化',
    description: (effect) => '每次有效連打傷害 +' + effect.perSelection.toFixed(1),
    icon: 'ϟ',
    color: 'red',
    effect: { type: 'rapid-tap-damage', perSelection: 0.6 }
  }),
  defineUpgradeCard({
    id: 'rhythm-precision',
    name: '精準判定強化',
    description: (effect) => 'HIT 判定範圍 +' + Math.round(effect.perSelection * 100) + '%',
    icon: '◎',
    color: 'cyan',
    effect: { type: 'rhythm-precision', perSelection: 0.1 }
  }),
  defineUpgradeCard({
    id: 'rapid-tap-duration',
    name: '極限連打',
    description: (effect) => '每次選卡連打時間 +' + Math.round(effect.perSelection * 100) + '%',
    icon: 'ϟ',
    color: 'purple',
    effect: { type: 'rapid-tap-duration', perSelection: 0.4 }
  }),
  defineUpgradeCard({
    id: 'qte-duration',
    name: '反應強化',
    description: (effect) => '初遇 QTE／盾牌判定窗 +' + (effect.perSelectionMs / 1000).toFixed(1) + ' 秒\n成功造成怪物最大 HP ' + Math.round(effect.successDamageRatioPerSelection * 100) + '% 傷害',
    icon: '◷',
    color: 'blue',
    effect: { type: 'qte-duration', perSelectionMs: 300, successDamageRatioPerSelection: 0.04 }
  }),
  defineUpgradeCard({
    id: 'max-speed',
    name: '突破極限',
    description: (effect) => '速度上限 +' + effect.maxSpeedPerSelection.toFixed(2) + ' F/s、當前速度 +' + effect.currentSpeedPerSelection.toFixed(3) + ' F/s',
    icon: '↑',
    color: 'green',
    effect: { type: 'speed-breakthrough', maxSpeedPerSelection: 0.04, currentSpeedPerSelection: 0.025 }
  }),
  defineUpgradeCard({
    id: 'energy-gain',
    name: '能量增幅',
    description: (effect) => '節奏球獲得的技能能量 +' + Math.round(effect.perSelection * 100) + '%',
    icon: '✦',
    color: 'yellow',
    effect: { type: 'energy-gain', perSelection: 0.12 }
  })
]);

export const UI_TEXT = Object.freeze({
  gameTitle: '登峰灶急',
  gameSubtitle: '一段一段轉身向上，踩節奏衝上台北 101！',
  menuEyebrow: 'READY, CLIMBER?',
  startButton: '開始登頂',
  howToTitle: '怎麼玩？',
  howToLines: ['樓梯會自動向上；依照球的節奏，在黃色拍點按空白鍵或點擊畫面。', '完成整組節奏可加速，速度會隨時間緩慢下降。', '遇到怪物時依序拼字；戰鬥中按空白鍵或點擊畫面攻防。'],
  pauseTitle: '先喘口氣',
  pauseBody: '台北 101 不會趁你休息偷偷長高。',
  resumeButton: '繼續攀登',
  resultTitle: '登頂成功！',
  resultSubtitle: '你把 101 層樓踩成了自己的節拍。',
  retryButton: '再登一次',
  floorLabel: '目前樓層',
  timeLabel: '登頂時間',
  comboLabel: '最高 COMBO',
  hitsLabel: 'HIT',
  missesLabel: 'MISS',
  qteWinsLabel: 'QTE 成功',
  qteLossesLabel: 'QTE 失敗',
  qteTitle: '怪物來襲！',
  qteInstruction: '依序點出其中一組解法',
  qteWrong: '唉呀，順序不對！再試一次',
  qteSuccess: '漂亮！成功破解',
  qteFail: '時間到！被擊退',
  qteTimerLabel: '施法倒數',
  monsterLabel: '遭遇怪物',
  spellLabel: '正在施放',
  solutionsLabel: '可用解法',
  controlsLabel: '操作方式',
  keyboardLabel: '電腦：空白鍵',
  touchLabel: '手機：點擊踩踏區',
  bestNone: '尚未登頂',
  hit: 'HIT',
  miss: 'MISS',
  neutral: '抓準時機！',
  monsterWon: '怪物被你唬住了！',
  knockback: '退後 {floors} 層',
  debuffApplied: '留下 {name} 狀態',
  debuffCured: '魔法解除',
  qtePassed: '安全通過',
  combatAttackHit: '節奏命中！準備連打',
  combatAttackMiss: '攻擊落空，準備防禦',
  combatAttackRound: '攻擊回合！',
  combatDefenseRound: '防禦回合！',
  combatRapidTapDisabled: '連打已停用',
  combatDefensePrompt: '按下操作鍵防禦',
  combatDefenseSuccess: '防禦成功',
  combatDefenseFailure: '防禦失敗',
  combatMonsterDefeated: '怪物擊敗！繼續攀登',
  turnFeedback: '平台到了！轉向下一段樓梯',
  platformPauseFeedback: '站穩平台，準備轉身',
  pauseAria: '暫停或繼續遊戲',
  floorSuffix: 'F'
});

export const MONSTER_EVENT_COUNT = GAME_CONFIG.monsterEventFloors.length;
