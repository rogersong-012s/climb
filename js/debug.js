import { GAME_CONFIG, RHYTHM_TYPES, UPGRADE_CARDS } from './config.js';

export const DEBUG_CONFIG = Object.freeze({
  enabled: false,
  rhythmPerfectRate: 0.8,
  rapidTapCount: 10,
  autoQTE: true,
  autoDefense: true,
  autoCardSelection: true,
  autoSkipWhenFull: true,
  autoSkipThreshold: 3,
  autoStart: true,
  failureMode: 'miss-one-random-target',
  defenseInputLeadMs: 75,
  cardSelectionDelayMs: 400,
  qteSuccessAtRemainingMs: 100
});

function readConfig() {
  let params;
  try {
    params = new URLSearchParams(globalThis.location?.search ?? '');
  } catch {
    params = new URLSearchParams();
  }
  const enabled = params.get('debug') === '1';
  const requestedRate = Number(params.get('rate'));
  const rhythmPerfectRate = params.has('rate') && Number.isFinite(requestedRate)
    ? Math.min(1, Math.max(0, requestedRate))
    : DEBUG_CONFIG.rhythmPerfectRate;
  return Object.freeze({
    ...DEBUG_CONFIG,
    enabled,
    rhythmPerfectRate,
    autoStart: params.get('autostart') !== '0'
  });
}

function makeStats() {
  const colors = Object.fromEntries(Object.keys(RHYTHM_TYPES).map((typeId) => [typeId, {
    ballsGenerated: 0,
    ballsCompleted: 0,
    disabledBallsGenerated: 0,
    disabledBallsCompleted: 0,
    perfectBalls: 0,
    successfulTargets: 0,
    resolvedTargets: 0,
    energy: 0
  }]));
  const stages = {
    '1–15F': { successfulTargets: 0, energy: 0 },
    '16–35F': { successfulTargets: 0, energy: 0 },
    '36–60F': { successfulTargets: 0, energy: 0 },
    '61–101F': { successfulTargets: 0, energy: 0 }
  };
  return {
    ballsGenerated: 0,
    ballsCompleted: 0,
    lowBloodSugarDisabledBallsGenerated: 0,
    lowBloodSugarDisabledBallsCompleted: 0,
    normalBallsGenerated: 0,
    normalBallsCompleted: 0,
    battleBallsGenerated: 0,
    battleBallsCompleted: 0,
    normalPerfectBalls: 0,
    normalImperfectBalls: 0,
    battlePerfectBalls: 0,
    battleImperfectBalls: 0,
    perfectBalls: 0,
    imperfectBalls: 0,
    successfulTargets: 0,
    resolvedTargets: 0,
    totalEnergy: 0,
    skillChargesEarned: 0,
    skillChargesUsed: 0,
    chargeHistory: [],
    monstersDefeated: 0,
    collisionEncounters: 0,
    collisionCalculatedDamage: 0,
    collisionDamage: 0,
    collisionDirectKills: 0,
    collisionHistory: [],
    upgrades: Object.fromEntries(UPGRADE_CARDS.map((card) => [card.id, 0])),
    colors,
    stages,
    completedRoundIds: new Set(),
    resolvedRoundIds: new Set(),
    defeatedEventIds: new Set()
  };
}

function stageKey(floor) {
  if (floor < 16) return '1–15F';
  if (floor < 36) return '16–35F';
  if (floor < 61) return '36–60F';
  return '61–101F';
}

export function createDebugController() {
  const config = readConfig();
  let stats = makeStats();
  let roundRecords = new Map();
  let roundDecisions = new Map();
  let handledRhythmTargets = new Map();
  let handledQtes = new Set();
  let defendedShots = new WeakMap();
  let lastTimestamp = null;
  let lastMode = null;
  let upgradeWaitMs = 0;
  let autoSkipPending = false;
  let reportedMilestones = new Set();
  let finalReported = false;
  let panel = null;

  if (config.enabled && globalThis.document) {
    const arena = document.getElementById('arena');
    if (arena) {
      panel = document.createElement('aside');
      panel.className = 'debug-status-panel';
      panel.setAttribute('aria-label', 'DEBUG MODE 狀態');
      panel.innerHTML = '<strong></strong><span></span><span></span><span></span><span></span>';
      arena.append(panel);
    }
    console.info('[DEBUG MODE] enabled · whole-ball perfect rate:', config.rhythmPerfectRate);
  }

  function recordCreatedRound(details) {
    const key = String(details.roundId);
    let record = roundRecords.get(key);
    if (!record) {
      const battle = details.mode === 'COMBAT_ATTACK';
      const disabled = Boolean(details.lowBloodSugarDisabled) && !battle;
      record = {
        roundId: key,
        typeId: details.typeId,
        targetCount: details.targetCount,
        battle,
        disabled,
        resolved: false,
        completed: false,
        cancelled: false,
        perfect: false
      };
      roundRecords.set(key, record);
      if (disabled) {
        stats.lowBloodSugarDisabledBallsGenerated += 1;
        if (stats.colors[details.typeId]) stats.colors[details.typeId].disabledBallsGenerated += 1;
      } else {
        stats.ballsGenerated += 1;
        if (battle) stats.battleBallsGenerated += 1;
        else stats.normalBallsGenerated += 1;
        if (stats.colors[details.typeId]) stats.colors[details.typeId].ballsGenerated += 1;
        roundDecisions.set(key, {
          perfect: Math.random() < config.rhythmPerfectRate,
          missSample: Math.random()
        });
      }
    } else if (!record.resolved && !record.completed) {
      // A rhythm orb can change the type of a still-stationary ball before it launches.
      if (record.typeId !== details.typeId) {
        if (stats.colors[record.typeId]) stats.colors[record.typeId].ballsGenerated -= 1;
        if (stats.colors[details.typeId]) stats.colors[details.typeId].ballsGenerated += 1;
        record.typeId = details.typeId;
      }
      record.targetCount = details.targetCount;
    }
  }

  function onRhythmRoundCreated(details) {
    recordCreatedRound(details);
    const alignment = details.bgmSpawnAlignment;
    if (alignment) {
      console.info('[DEBUG MODE] 節奏球生成同步', {
        '排程時 BGM 拍位': alignment.scheduledAtBeat,
        對齊整數拍: alignment.alignedBeat,
        預定生成拍位: alignment.targetBeat,
        實際生成拍位: alignment.actualBeatPosition,
        '生成偏差毫秒': alignment.generationOffsetMs,
        來源: alignment.source,
        原因: alignment.reason
      });
    }
  }

  function onRhythmSpawnScheduled(details) {
    console.info('[DEBUG MODE] 節奏球生成已排程', {
      '排程時 BGM 拍位': details.scheduledAtBeat,
      對齊整數拍: details.alignedBeat,
      預定生成拍位: details.targetBeat,
      等待毫秒: details.remainingMs,
      來源: details.source,
      原因: details.reason
    });
  }

  function onRhythmTargetResolved(details) {
    const color = stats.colors[details.typeId];
    stats.resolvedTargets += 1;
    if (color) color.resolvedTargets += 1;
    if (details.result !== 'success') return;

    stats.successfulTargets += 1;
    if (color) color.successfulTargets += 1;
    if (details.mode !== 'CLIMBING') return;

    const perTargetEnergy = Number.isFinite(details.energyGain)
      ? Math.max(0, details.energyGain)
      : (GAME_CONFIG.skipSkillRhythmEnergy[details.typeId] ?? 0) / Math.max(1, details.targetCount);
    stats.totalEnergy += perTargetEnergy;
    if (color) color.energy += perTargetEnergy;
    const stage = stats.stages[stageKey(details.floor)];
    if (stage) {
      stage.successfulTargets += 1;
      stage.energy += perTargetEnergy;
    }
  }

  function onRhythmRoundResolved(details) {
    const key = String(details.roundId);
    const record = roundRecords.get(key);
    if (!record || stats.resolvedRoundIds.has(key)) return;
    stats.resolvedRoundIds.add(key);
    record.resolved = true;
    record.perfect = Boolean(details.perfect);
  }

  function onRhythmRoundFinished(details) {
    const key = String(details.roundId);
    const record = roundRecords.get(key);
    if (!record || stats.completedRoundIds.has(key)) return;
    stats.completedRoundIds.add(key);
    record.completed = true;
    if (record.disabled) {
      stats.lowBloodSugarDisabledBallsCompleted += 1;
      if (stats.colors[record.typeId]) stats.colors[record.typeId].disabledBallsCompleted += 1;
      return;
    }
    stats.ballsCompleted += 1;
    if (record.battle) stats.battleBallsCompleted += 1;
    else stats.normalBallsCompleted += 1;
    if (stats.colors[record.typeId]) stats.colors[record.typeId].ballsCompleted += 1;
    if (!record.resolved) {
      // Rounds may only end unresolved if a game edge case closes one directly.
      onRhythmRoundResolved({ ...details, perfect: false });
    }
    if (record.perfect) {
      stats.perfectBalls += 1;
      if (record.battle) stats.battlePerfectBalls += 1;
      else stats.normalPerfectBalls += 1;
      if (stats.colors[record.typeId]) stats.colors[record.typeId].perfectBalls += 1;
    } else {
      stats.imperfectBalls += 1;
      if (record.battle) stats.battleImperfectBalls += 1;
      else stats.normalImperfectBalls += 1;
    }
  }

  const hooks = Object.freeze({
    onRhythmRoundCreated,
    onRhythmSpawnScheduled,
    onRhythmTargetResolved,
    onRhythmRoundResolved,
    onRhythmRoundFinished,
    onRhythmRoundCancelled(details) {
      const record = roundRecords.get(String(details.roundId));
      if (record) record.cancelled = true;
    },
    onSkillChargeEarned(details) {
      stats.skillChargesEarned += 1;
      const floor = Number(details?.floor);
      const timerMs = Number(details?.timerMs);
      stats.chargeHistory.push({
        index: stats.skillChargesEarned,
        floor: Number.isFinite(floor) ? Number(floor.toFixed(2)) : 0,
        gameTimeSeconds: Number.isFinite(timerMs) ? Number((timerMs / 1000).toFixed(1)) : 0,
        storedCharges: Number(details?.charges) || 0
      });
    },
    onSkipSkillUsed() {
      stats.skillChargesUsed += 1;
      autoSkipPending = false;
    },
    onMonsterDefeated(details) {
      const key = String(details.eventId ?? details.floor);
      if (stats.defeatedEventIds.has(key)) return;
      stats.defeatedEventIds.add(key);
      stats.monstersDefeated += 1;
    },
    onMonsterCollision(details) {
      const precise = (value) => Number((Number(value) || 0).toFixed(4));
      const collision = {
        floor: precise(details.floor),
        encounterAttempt: Math.max(0, Math.floor(Number(details.encounterAttempt) || 0)),
        effectiveSpeedFloorsPerSecond: precise(details.effectiveSpeedFloorsPerSecond),
        upgradeCount: Math.max(0, Math.floor(Number(details.upgradeCount) || 0)),
        multiplier: precise(details.multiplier),
        calculatedDamage: precise(details.calculatedDamage),
        actualDamage: precise(details.actualDamage),
        monsterHpBefore: precise(details.monsterHpBefore),
        monsterHpAfter: precise(details.monsterHpAfter),
        defeated: Boolean(details.defeated)
      };
      stats.collisionHistory.push(collision);
      stats.collisionCalculatedDamage += collision.calculatedDamage;
      stats.collisionDamage += collision.actualDamage;
      if (collision.multiplier > 0) stats.collisionEncounters += 1;
      if (collision.defeated) stats.collisionDirectKills += 1;
      console.info('[DEBUG MODE] 遭遇衝撞', collision);
    },
    onUpgradeChosen(details) {
      if (details.cardId in stats.upgrades) stats.upgrades[details.cardId] += 1;
    },
    onCombatAttackDamageCalculated(details) {
      const precise = (value) => Number((Number(value) || 0).toFixed(3));
      console.info('[DEBUG MODE] 戰鬥攻擊傷害', {
        '攻擊球': RHYTHM_TYPES[details.typeId]?.label ?? details.typeId ?? '未知',
        '成功拍點': details.successCount + '/' + details.totalCount,
        '基礎傷害': precise(details.baseDamage),
        '連打傷害': precise(details.rapidTapDamage),
        '倍率前傷害': precise(details.rawDamage),
        '顏色倍率': precise(details.colorMultiplier),
        '最終傷害': precise(details.finalDamage)
      });
    }
  });

  function decisionFor(round) {
    if (!round) return null;
    const key = String(round.id);
    if (!roundDecisions.has(key)) {
      roundDecisions.set(key, {
        perfect: Math.random() < config.rhythmPerfectRate,
        missSample: Math.random()
      });
    }
    const decision = roundDecisions.get(key);
    const missIndex = decision.perfect
      ? -1
      : Math.min(round.hitBeats.length - 1, Math.floor(decision.missSample * round.hitBeats.length));
    return { ...decision, missIndex };
  }

  function rhythmTargetIsInActualWindow(game, round, index) {
    if (!round || round.phase !== 'MOVING' || index < 0 || index >= round.hitBeats.length) return false;
    const target = game.getRhythmHitWindows().find((window) => window.beat === round.hitBeats[index]);
    if (!target || target.status !== 'current') return false;
    const centerMs = round.hitBeats[index] * round.beatDurationMs;
    const totalMs = round.totalBeats * round.beatDurationMs;
    const halfWindowMs = target.width * totalMs / 2;
    const nowMs = round.elapsedMs;
    return nowMs >= centerMs && nowMs <= centerMs + halfWindowMs;
  }

  function runRhythm(game, state, timestamp) {
    if (!['CLIMBING', 'COMBAT_ATTACK'].includes(state.mode)) return;
    const round = state.rhythmRound;
    if (!round || round.isLowBloodSugarDisabled || round.phase !== 'MOVING' || round.inputLocked) return;
    recordCreatedRound({
      roundId: round.id,
      typeId: round.typeId,
      targetCount: round.hitBeats.length,
      mode: state.mode
    });
    const decision = decisionFor(round);
    const index = round.inputIndex;
    if (index < 0 || index >= round.hitBeats.length || index === decision.missIndex) return;
    if (!rhythmTargetIsInActualWindow(game, round, index)) return;

    const key = String(round.id);
    let handled = handledRhythmTargets.get(key);
    if (!handled) {
      handled = new Set();
      handledRhythmTargets.set(key, handled);
    }
    if (handled.has(index)) return;
    const result = game.pressRhythm(timestamp);
    if (result.status === 'hit' || result.status === 'progress') handled.add(index);
  }

  function runQte(game, state, timestamp) {
    if (!config.autoQTE || state.mode !== 'MONSTER_QTE' || !state.activeQte) return;
    const qte = state.activeQte;
    if (qte.remainingMs > config.qteSuccessAtRemainingMs || handledQtes.has(qte.id)) return;
    const solution = qte.monster?.solutions?.find((entry) => entry.effect === 'CURE');
    if (!solution) return;
    handledQtes.add(qte.id);

    const availableTiles = qte.tiles.filter((tile) => tile.visible).map((tile) => ({ ...tile }));
    const tileIds = [];
    for (const letter of solution.word) {
      const index = availableTiles.findIndex((tile) => tile.letter === letter);
      if (index < 0) {
        console.warn('[DEBUG MODE] cure solution letters were not available:', solution.word);
        return;
      }
      tileIds.push(availableTiles[index].id);
      availableTiles.splice(index, 1);
    }

    for (const tileId of tileIds) {
      const result = game.pressQteLetter(tileId, timestamp);
      if (result.status === 'complete') return;
      if (result.status !== 'progress') {
        console.warn('[DEBUG MODE] QTE cure input did not advance:', result.status);
        return;
      }
    }
  }

  function runDefense(game, state, timestamp) {
    if (!config.autoDefense || state.mode !== 'COMBAT_DEFENSE' || !state.combatDefenseRound) return;
    const round = state.combatDefenseRound;
    let handled = defendedShots.get(round);
    if (!handled) {
      handled = new Set();
      defendedShots.set(round, handled);
    }
    const attack = round.attacks.find((shot) => shot.status === 'active' && !handled.has(shot.id));
    if (!attack) return;
    const untilImpactMs = attack.attackTimeMs - round.elapsedMs;
    if (untilImpactMs < 0 || untilImpactMs > config.defenseInputLeadMs) return;
    const result = game.pressCombatShield('central', timestamp);
    if (result.status === 'defended') handled.add(attack.id);
  }

  function runRapidTap(game, state, timestamp) {
    if (state.mode !== 'COMBAT_RAPID_TAP' || !state.combatRapidTap) return;
    const rapidTap = state.combatRapidTap;
    const count = Math.max(1, Math.floor(config.rapidTapCount));
    if (rapidTap.disabled || rapidTap.prepareRemainingMs > 0 || rapidTap.tapCount >= count) return;
    const targetElapsedMs = rapidTap.durationMs * (rapidTap.tapCount + 0.5) / count;
    if (rapidTap.elapsedMs + 1e-6 < targetElapsedMs) return;
    const result = game.pressRhythm(timestamp);
    if (result.status === 'tap') return;
  }

  function runCardSelection(game, state, timestamp, deltaMs) {
    if (!config.autoCardSelection || state.mode !== 'UPGRADE_SELECT') {
      upgradeWaitMs = 0;
      return;
    }
    upgradeWaitMs += deltaMs;
    if (upgradeWaitMs < config.cardSelectionDelayMs || !state.upgradeChoices.length) return;
    const choices = [...state.upgradeChoices];
    const chosenCard = choices[Math.floor(Math.random() * choices.length)];
    if (game.chooseUpgrade(chosenCard)) upgradeWaitMs = 0;
  }

  function runAutoSkip(game, state, timestamp) {
    autoSkipPending = config.autoSkipWhenFull &&
      state.skipSkillCharges >= config.autoSkipThreshold;
    if (!autoSkipPending || state.mode !== 'CLIMBING') return;
    if (!game.getSkipSkillStatus().canUse) return;
    if (game.useSkipSkill(timestamp)) autoSkipPending = false;
  }

  function getSnapshot(state) {
    const threshold = GAME_CONFIG.skipSkillEnergyRequired;
    const painMultiplier = state?.debuffs?.PAIN ? GAME_CONFIG.painClimbSpeedMultiplier : 1;
    const theoreticalCharges = Math.floor((stats.totalEnergy + 1e-8) / threshold);
    const wastedEnergy = Math.max(0,
      stats.totalEnergy - stats.skillChargesEarned * threshold - (state?.skipSkillEnergy ?? 0));
    const completed = stats.ballsCompleted;
    const completedTargets = stats.resolvedTargets;
    return {
      configuredPerfectRate: config.rhythmPerfectRate,
      configuredPerfectRatePercent: Math.round(config.rhythmPerfectRate * 100) + '%',
      failureMode: config.failureMode,
      ballsGenerated: stats.ballsGenerated,
      ballsCompleted: completed,
      normalBallsGenerated: stats.normalBallsGenerated,
      normalBallsCompleted: stats.normalBallsCompleted,
      lowBloodSugarDisabledBallsGenerated: stats.lowBloodSugarDisabledBallsGenerated,
      lowBloodSugarDisabledBallsCompleted: stats.lowBloodSugarDisabledBallsCompleted,
      battleBallsGenerated: stats.battleBallsGenerated,
      battleBallsCompleted: stats.battleBallsCompleted,
      normalPerfectBalls: stats.normalPerfectBalls,
      normalImperfectBalls: stats.normalImperfectBalls,
      battlePerfectBalls: stats.battlePerfectBalls,
      battleImperfectBalls: stats.battleImperfectBalls,
      perfectBalls: stats.perfectBalls,
      imperfectBalls: stats.imperfectBalls,
      perfectRateCompleted: completed ? stats.perfectBalls / completed : 0,
      perfectRateCompletedPercent: completed ? (stats.perfectBalls / completed * 100).toFixed(1) + '%' : '0%',
      successfulTargets: stats.successfulTargets,
      resolvedTargets: completedTargets,
      singleHitRate: completedTargets ? stats.successfulTargets / completedTargets : 0,
      singleHitRatePercent: completedTargets ? (stats.successfulTargets / completedTargets * 100).toFixed(1) + '%' : '0%',
      gameTimeSeconds: (state?.timerMs ?? 0) / 1000,
      baseSpeed: state?.climbSpeed ?? 0,
      maxSpeed: state?.maxClimbSpeed ?? 0,
      speedUpgradeCount: stats.upgrades['max-speed'] ?? 0,
      collisionDamageMultiplier: (stats.upgrades['max-speed'] ?? 0) *
        (Number(UPGRADE_CARDS.find((card) => card.id === 'max-speed')?.effect?.collisionMultiplierPerSelection) || 0),
      collisionEncounters: stats.collisionEncounters,
      collisionCalculatedDamage: Number(stats.collisionCalculatedDamage.toFixed(4)),
      collisionDamage: Number(stats.collisionDamage.toFixed(4)),
      collisionDirectKills: stats.collisionDirectKills,
      effectiveSpeedCap: (state?.maxClimbSpeed ?? 0) * painMultiplier,
      finalEffectiveSpeed: state?.climbSpeed !== undefined
        ? (Math.min(state.climbSpeed, state.maxClimbSpeed) +
          ((state.temporarySpeedBonusRemainingMs ?? 0) > 0 ? state.temporarySpeedBonus : 0)) * painMultiplier
        : 0,
      totalRhythmEnergy: stats.totalEnergy,
      theoreticalFullCharges: theoreticalCharges,
      theoreticalChargeEquivalent: stats.totalEnergy / threshold,
      skillChargesEarned: stats.skillChargesEarned,
      skillChargesUsed: stats.skillChargesUsed,
      chargeHistory: stats.chargeHistory.map((entry) => ({ ...entry })),
      currentStoredCharges: state?.skipSkillCharges ?? 0,
      maxStoredCharges: GAME_CONFIG.skipSkillMaxCharges,
      storedEnergy: state?.skipSkillEnergy ?? 0,
      energyWastedAtStorageCap: wastedEnergy,
      monstersDefeated: stats.monstersDefeated
    };
  }

  function report(label, state, final = false) {
    if (!globalThis.console) return;
    const snapshot = getSnapshot(state);
    const colorRows = Object.entries(stats.colors).map(([typeId, entry]) => ({
      rhythm: RHYTHM_TYPES[typeId]?.label ?? typeId,
      color: typeId,
      ballsGenerated: entry.ballsGenerated,
      ballsCompleted: entry.ballsCompleted,
      disabledBallsGenerated: entry.disabledBallsGenerated,
      disabledBallsCompleted: entry.disabledBallsCompleted,
      perfectBalls: entry.perfectBalls,
      successfulTargets: entry.successfulTargets,
      resolvedTargets: entry.resolvedTargets,
      energyContribution: Number(entry.energy.toFixed(3))
    }));
    const stageRows = Object.entries(stats.stages).map(([stage, entry]) => ({
      floorRange: stage,
      successfulTargets: entry.successfulTargets,
      energyContribution: Number(entry.energy.toFixed(3))
    }));
    const upgradeRows = Object.entries(stats.upgrades).map(([id, count]) => ({
      card: UPGRADE_CARDS.find((card) => card.id === id)?.name ?? id,
      acquired: count
    }));
    console.groupCollapsed('[DEBUG MODE] ' + label);
    console.table([snapshot]);
    console.table(colorRows);
    console.table(stageRows);
    if (final) {
      console.table(upgradeRows);
      console.table(stats.chargeHistory);
      console.table(stats.collisionHistory);
      console.log('[DEBUG MODE] 技能充能紀錄摘要', {
        totalEarned: stats.skillChargesEarned,
        totalUsed: stats.skillChargesUsed,
        remaining: state?.skipSkillCharges ?? 0,
        maxStored: GAME_CONFIG.skipSkillMaxCharges
      });
      console.log('[DEBUG MODE] 衝撞傷害摘要', {
        speedUpgradeCount: stats.upgrades['max-speed'] ?? 0,
        collisionMultiplier: snapshot.collisionDamageMultiplier,
        encounters: stats.collisionEncounters,
        totalCalculatedDamage: Number(stats.collisionCalculatedDamage.toFixed(4)),
        totalActualDamage: Number(stats.collisionDamage.toFixed(4)),
        directMonsterDefeats: stats.collisionDirectKills
      });
    }
    console.groupEnd();
  }

  function renderFinalChargeHistory(state) {
    if (!config.enabled || state.mode !== 'RESULT' || !globalThis.document) return;
    const card = document.querySelector('#modal-layer .result-card');
    if (!card) return;
    let section = card.querySelector('.debug-charge-history');
    if (!section) {
      section = document.createElement('section');
      section.className = 'debug-charge-history';
      section.setAttribute('aria-label', 'DEBUG 技能充能紀錄');
      card.querySelector('.primary-button')?.before(section);
    }
    section.replaceChildren();

    const title = document.createElement('h3');
    title.textContent = '技能充能紀錄';
    section.append(title);

    if (stats.chargeHistory.length) {
      const list = document.createElement('ol');
      for (const entry of stats.chargeHistory) {
        const item = document.createElement('li');
        item.textContent = `第 ${entry.index} 次：${entry.floor.toFixed(2)}F`;
        list.append(item);
      }
      section.append(list);
    } else {
      const empty = document.createElement('p');
      empty.textContent = '本局尚未充滿技能';
      section.append(empty);
    }

    const summary = document.createElement('p');
    summary.className = 'debug-charge-summary';
    summary.textContent = `累計充滿：${stats.skillChargesEarned} 次　累計使用：${stats.skillChargesUsed} 次　剩餘技能：${state.skipSkillCharges}/${GAME_CONFIG.skipSkillMaxCharges}`;
    section.append(summary);
  }

  function updatePanel(state) {
    if (!panel) return;
    const completed = stats.ballsCompleted;
    const rate = completed ? Math.round(stats.perfectBalls / completed * 100) : 0;
    panel.children[0].textContent = 'DEBUG MODE · ' + Math.round(config.rhythmPerfectRate * 100) + '%';
    panel.children[1].textContent = '樓層 ' + Number(state.progress).toFixed(1) + 'F';
    panel.children[2].textContent = '全成功 ' + stats.perfectBalls + '/' + completed + ' · ' + rate + '%';
    panel.children[3].textContent = '技能 ' + state.skipSkillCharges + '/' + GAME_CONFIG.skipSkillMaxCharges +
      (autoSkipPending ? ' · 待使用' : '');
    panel.children[4].textContent = '低血糖停用球 ' + stats.lowBloodSugarDisabledBallsCompleted +
      '/' + stats.lowBloodSugarDisabledBallsGenerated;
  }

  function reportMilestones(state) {
    for (const floor of [16, 36, 61]) {
      if (!reportedMilestones.has(floor) && state.progress >= floor) {
        reportedMilestones.add(floor);
        report('階段快照 ' + floor + 'F', state);
      }
    }
  }

  function reset() {
    if (!config.enabled) return;
    stats = makeStats();
    roundRecords = new Map();
    roundDecisions = new Map();
    handledRhythmTargets = new Map();
    handledQtes = new Set();
    defendedShots = new WeakMap();
    lastTimestamp = null;
    lastMode = null;
    upgradeWaitMs = 0;
    autoSkipPending = false;
    reportedMilestones = new Set();
    finalReported = false;
    if (panel) panel.classList.remove('is-result');
  }

  function update(timestamp, game) {
    if (!config.enabled || !game) return;
    const state = game.getState();
    let deltaMs = 0;
    if (lastTimestamp !== null && state.mode !== 'PAUSED' && lastMode !== 'PAUSED') {
      deltaMs = Math.max(0, timestamp - lastTimestamp);
    }
    lastTimestamp = timestamp;

    if (state.mode === 'PAUSED') {
      lastMode = state.mode;
      updatePanel(state);
      return;
    }

    runRhythm(game, state, timestamp);
    runQte(game, state, timestamp);
    runDefense(game, state, timestamp);
    runRapidTap(game, state, timestamp);
    runCardSelection(game, state, timestamp, lastMode === 'UPGRADE_SELECT' ? deltaMs : 0);
    runAutoSkip(game, state, timestamp);
    reportMilestones(state);
    if (state.mode === 'RESULT' && !finalReported) {
      finalReported = true;
      reportedMilestones.add(101);
      report('完整遊戲統計 · 101F', state, true);
      if (panel) panel.classList.add('is-result');
    }
    if (state.mode === 'RESULT') renderFinalChargeHistory(state);
    updatePanel(state);
    lastMode = state.mode;
  }

  return {
    enabled: config.enabled,
    autoStart: config.enabled && config.autoStart,
    config,
    hooks,
    reset,
    resetFrameClock() {
      lastTimestamp = null;
    },
    update
  };
}
