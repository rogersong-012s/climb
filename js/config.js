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
  monsterDefeatSpeedBonus: 0.01,
  monsterDefeatMaxSpeedBonus: 0.015,
  skipSkillMaxCharges: 3,
  skipSkillEnergyRequired: 48,
  skipSkillActivationSeconds: 2,
  skipSkillRhythmEnergy: Object.freeze({
    RED: 1.0,
    BLUE: 1.0,
    YELLOW: 3.0,
    GREEN: 6.0,
    PURPLE: 10.0
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
  fatigueHitZonePenalty: 0.04,
  fatigueMinHitZoneWidth: 0.14,
  rhythmBeatDurationMs: 500,
  rhythmMoveSpeedMultiplier: 1.3,
  perfectRhythmSpeedBurstBonus: 0.1,
  perfectRhythmSpeedBurstDurationMs: 400,
  rhythmInputDebounceMs: 70,
  rhythmHitFlashDurationMs: 150,
  rhythmPrepareBeats: 2,
  rhythmReadyRingStartScale: 1.9,
  rhythmReadyFlashMs: 100,
  rhythmRespawnDelayBeats: 1,
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
  monsterQteDurationMs: 6000,
  monsterQteDurationMultiplier: 2 / 3,
  monsterQteFailureKnockbackFloors: 3,
  monsterQteFailureNoticeDurationMs: 1000,
  combatDefenseRecoveryQteDurationMs: 4000, // Current encounter QTE duration after the 2/3 multiplier.
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
  combatBaseAttackDamage: 20,
  upgradeBaseAttackBonus: 5,
  combatRapidTapPrepareDelayMs: 100,
  combatRapidTapDurationMs: 2000,
  combatRapidTapDamageMultiplier: 2,
  upgradeRapidTapDamageBonus: 0.6,
  upgradeRhythmJudgmentBonus: 0.1,
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
  monsterWarningFlashDurationMs: 600,
  monsterWarningGapDurationMs: 250,
  monsterWarningFlashCount: 2,
  monsterWarningMaxOpacity: 0.3,
  monsterWarningReducedMotionOpacity: 0.14,
  monsterEntranceDurationMs: 700,
  monsterCastDurationMs: 1000,
  monsterImpactEffectDurationMs: 340,
  monsterAttackToDebuffDelayMs: 250,
  monsterDebuffRevealDurationMs: 450,
  monsterDebuffToAnswerDelayMs: 400,
  monsterAnswerPreviewDurationMs: 1800,
  debuffCureFlashDurationMs: 400,
  debuffCureFlashCount: 2,
  qteLetterMin: 8,
  qteLetterMax: 12,
  bestRecordStorageKey: 'dengfeng-zaoji-best-time-v1',
  feedbackDurationMs: 800,
  debuffs: {
    SORE: { name: '痠痛', description: '節奏球移動速度降低', icon: '〰', speedMultiplier: 0.72 },
    BLUR: { name: '視野模糊', description: '節奏軌道微微模糊', icon: '◌', blurPx: 1.3 },
    FATIGUE: { name: '疲勞', description: '節奏判定區額外縮小', icon: '…', hitZonePenalty: 0.04 }
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

export const UPGRADE_CARDS = Object.freeze([
  Object.freeze({
    id: 'base-attack',
    name: '基礎攻擊強化',
    description: '基礎攻擊力 +' + GAME_CONFIG.upgradeBaseAttackBonus,
    icon: '⚔',
    accent: 'orange'
  }),
  Object.freeze({
    id: 'rapid-tap-attack',
    name: '連擊攻擊強化',
    description: '每次連打傷害 +' + GAME_CONFIG.upgradeRapidTapDamageBonus.toFixed(1),
    icon: 'ϟ',
    accent: 'blue'
  }),
  Object.freeze({
    id: 'rhythm-precision',
    name: '節奏精準強化',
    description: '節奏判定範圍 +' + Math.round(GAME_CONFIG.upgradeRhythmJudgmentBonus * 100) + '%',
    icon: '◎',
    accent: 'lime'
  })
]);

export const UI_TEXT = Object.freeze({
  gameTitle: '登峰灶急',
  gameSubtitle: '一段一段轉身向上，踩節奏衝上台北 101！',
  menuEyebrow: 'READY, CLIMBER?',
  startButton: '開始登頂',
  howToTitle: '怎麼玩？',
  howToLines: ['樓梯會自動向上；依照球的節奏，在黃色拍點按 SPACE 或點擊畫面。', '完成整組節奏可加速，速度會隨時間緩慢下降。', '遇到怪物時依序拼字；戰鬥中按 SPACE 或點擊畫面攻防。'],
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
