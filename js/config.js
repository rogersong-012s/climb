const startFloor = 1;
const maxFloor = 101;
const monsterEventIntervalFloors = 5;
const monsterEventFloors = Object.freeze(Array.from(
  { length: Math.ceil((maxFloor - startFloor) / monsterEventIntervalFloors) },
  (_, index) => Object.freeze({
    min: startFloor + index * monsterEventIntervalFloors,
    max: Math.min(startFloor + (index + 1) * monsterEventIntervalFloors, maxFloor)
  })
));

export const GAME_CONFIG = Object.freeze({
  startFloor,
  maxFloor,
  initialClimbSpeed: 0.1,
  minClimbSpeed: 0.1,
  maxClimbSpeed: 0.3,
  hitSpeedBonus: 0.02,
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
  rhythmPrepareBeats: 2,
  rhythmReadyRingStartScale: 1.9,
  rhythmReadyFlashMs: 100,
  rhythmRespawnDelayMs: 100,
  rhythmBallEdgeGapPx: 12,
  monsterQteDurationMs: 6000,
  monsterMaxHp: 3,
  combatDamagePerHit: 1,
  combatRoundIntroDurationMs: 800,
  combatDefenseProjectileTravelTimeMs: 600,
  combatDefenseProjectileIntervalMs: 200,
  combatDefenseHitWindowMs: 200,
  combatDefenseResultDurationMs: 650,
  combatDefensePatterns: Object.freeze([
    Object.freeze({
      id: 'TWO_SHIELDS',
      shields: Object.freeze([
        Object.freeze({ id: 'left', x: 27, y: 66 }),
        Object.freeze({ id: 'right', x: 73, y: 66 })
      ]),
      projectiles: Object.freeze([
        Object.freeze({ id: 'A', targetShieldId: 'left', launchIndex: 0 }),
        Object.freeze({ id: 'B', targetShieldId: 'right', launchIndex: 1 })
      ])
    }),
    Object.freeze({
      id: 'THREE_SHIELDS',
      shields: Object.freeze([
        Object.freeze({ id: 'left', x: 20, y: 63 }),
        Object.freeze({ id: 'center', x: 50, y: 71 }),
        Object.freeze({ id: 'right', x: 80, y: 63 })
      ]),
      projectiles: Object.freeze([
        Object.freeze({ id: 'A', targetShieldId: 'left', launchIndex: 0 }),
        Object.freeze({ id: 'B', targetShieldId: 'center', launchIndex: 1 }),
        Object.freeze({ id: 'C', targetShieldId: 'right', launchIndex: 2 })
      ])
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
  monsterAttackToDebuffDelayMs: 500,
  monsterDebuffRevealDurationMs: 450,
  monsterDebuffToAnswerDelayMs: 800,
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

// Beat numbers are 1-based positions on a one-way track run.
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
  })
});

export const ANTI_DIZZINESS_MODE = Object.freeze({
  OFF: 'OFF',
  ON: 'ON'
});

export const UI_TEXT = Object.freeze({
  gameTitle: '登峰灶急',
  gameSubtitle: '一段一段轉身向上，踩節奏衝上台北 101！',
  menuEyebrow: 'READY, CLIMBER?',
  startButton: '開始登頂',
  howToTitle: '怎麼玩？',
  howToLines: ['樓梯會自動向上；依照球的節奏，在黃色拍點按 SPACE 或「踩！」。', '完成整組節奏可加速，速度會隨時間緩慢下降。', '到平台會轉身換一段樓梯；遇到怪物就點字母解法！'],
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
  combatAttackHit: '命中怪物！',
  combatAttackMiss: '攻擊落空，準備防禦',
  combatAttackRound: '攻擊回合！',
  combatDefenseRound: '防禦回合！',
  combatDefensePrompt: '點擊亮起的白盾',
  combatDefenseSuccess: '防禦成功',
  combatDefenseFailure: '防禦失敗',
  combatMonsterDefeated: '怪物擊敗！繼續攀登',
  turnFeedback: '平台到了！轉向下一段樓梯',
  platformPauseFeedback: '站穩平台，準備轉身',
  pauseAria: '暫停或繼續遊戲',
  floorSuffix: 'F'
});

export const MONSTER_EVENT_COUNT = GAME_CONFIG.monsterEventFloors.length;
