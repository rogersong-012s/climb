import { GAME_CONFIG, RHYTHM_TYPES, UPGRADE_CARDS } from './config.js';

const TIME_CATEGORIES = Object.freeze([
  'normalClimbingMs',
  'encounterQteMs',
  'combatMs',
  'emergencyQteMs',
  'animationTransitionMs',
  'otherEventMs'
]);

function makeColorStats() {
  return Object.fromEntries(Object.keys(RHYTHM_TYPES).map((typeId) => [typeId, {
    ballsSpawned: 0,
    targetsHit: 0,
    targetsMissed: 0,
    completedBalls: 0,
    eligibleBalls: 0,
    perfectBalls: 0,
    disabledBalls: 0,
    disabledTargets: 0,
    incorrectPresses: 0
  }]));
}

function roundNumber(value, digits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** digits;
  return Math.round((numeric + Number.EPSILON) * factor) / factor;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function eventTimeSeconds(timerMs) {
  return roundNumber(Math.max(0, Number(timerMs) || 0) / 1000, 3);
}

function stageForFloor(floor) {
  const index = Math.max(0, Math.min(9, Math.floor((Number(floor) - GAME_CONFIG.startFloor) / 10)));
  return index;
}

export function createRunStatistics({ mode = 'manual', startedAtMs = Date.now() } = {}) {
  const upgradeCounts = Object.fromEntries(UPGRADE_CARDS.map((card) => [card.id, 0]));
  const data = {
    schemaVersion: '1.1',
    game: '登峰灶急',
    run: {
      mode: mode === 'debug' ? 'debug' : 'manual',
      result: 'in-progress',
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: null,
      startFloor: GAME_CONFIG.startFloor,
      finalFloor: GAME_CONFIG.startFloor
    },
    timing: {
      gameTimeSeconds: 0,
      normalClimbingSeconds: 0,
      encounterQteSeconds: 0,
      combatSeconds: 0,
      emergencyQteSeconds: 0,
      animationTransitionSeconds: 0,
      otherEventSeconds: 0,
      upgradeSelectionSeconds: 0,
      realElapsedSeconds: 0,
      unclassifiedSeconds: 0
    },
    climbing: {
      totalClimbedFloors: 0,
      knockedBackFloors: 0,
      averageBaseSpeedFloorsPerSecond: 0,
      averageEffectiveSpeedFloorsPerSecond: 0,
      maxEffectiveSpeedFloorsPerSecond: 0,
      temporaryBurstSeconds: 0,
      temporaryBurstDistanceFloors: 0,
      painDebuffAffectedSeconds: 0,
      painDebuffAffectedDistanceFloors: 0,
      finalBaseSpeedFloorsPerSecond: 0,
      finalEffectiveSpeedFloorsPerSecond: 0,
      finalSpeedCapFloorsPerSecond: 0,
      finalEffectiveSpeedCapFloorsPerSecond: 0,
      averageEffectiveSpeedCapFloorsPerSecond: 0,
      timeAtSpeedCapSeconds: 0,
      timeAtSpeedCapRatio: 0,
      timeAboveNoSpeedUpgradeCapSeconds: 0,
      speedCapUpgradeCount: 0,
      speedCapUpgradeHistory: [],
      floorIntervals: Array.from({ length: 10 }, (_, index) => ({
        fromFloor: GAME_CONFIG.startFloor + index * 10,
        toFloor: Math.min(GAME_CONFIG.maxFloor, GAME_CONFIG.startFloor + (index + 1) * 10),
        climbedFloors: 0,
        climbingSeconds: 0,
        averageEffectiveSpeedFloorsPerSecond: 0
      }))
    },
    combat: {
      monstersDefeated: 0,
      monstersSkipped: 0,
      encounterAttempts: 0,
      totalAttackRounds: 0,
      averageKillAttackRounds: 0,
      oneRoundKills: 0,
      twoRoundKills: 0,
      threeOrMoreRoundKills: 0,
      qteOnlyKills: 0,
      calculatedDamage: 0,
      actualDamage: 0,
      baseAttackDamage: 0,
      rapidTapDamage: 0,
      rapidTapInputCount: 0,
      rapidTapKeyboardSpace: 0,
      rapidTapMouse: 0,
      rapidTapTouch: 0,
      rapidTapOtherInputs: 0,
      rapidTapDebugInputs: 0,
      shieldDefenseAttempts: 0,
      shieldDefenseSuccesses: 0,
      colorMultiplierBonusDamage: 0,
      qteDamage: 0,
      encounterQteDamage: 0,
      shieldQteDamage: 0,
      averageBattleSecondsPerDefeatedMonster: 0
    },
    qte: {
      encounterAttempts: 0,
      encounterSuccesses: 0,
      encounterFailures: 0,
      encounterSuccessRate: 0,
      emergencyAttempts: 0,
      emergencySuccesses: 0,
      emergencyFailures: 0,
      emergencySuccessRate: 0,
      knockbackCount: 0,
      qteTimeUpgradeCount: 0,
      maxFailureCompensationSeconds: 0,
      qteDamage: 0,
      encounterQteDamage: 0,
      shieldQteDamage: 0,
      reactionDamageTriggers: 0,
      encounterReactionDamageTriggers: 0,
      shieldReactionDamageTriggers: 0,
      shieldDefenseAttempts: 0,
      shieldDefenseSuccesses: 0
    },
    rhythm: {
      overall: { ballsSpawned: 0, targetsHit: 0, targetsMissed: 0, completedBalls: 0, eligibleBalls: 0, perfectBalls: 0, disabledBalls: 0, disabledTargets: 0, incorrectPresses: 0 },
      maxCombo: 0,
      byPurpose: {
        climbing: makeColorStats(),
        combatAttack: makeColorStats()
      }
    },
    energy: {
      totalEligibleEnergy: 0,
      baseEnergy: 0,
      comboBonusEnergy: 0,
      upgradeBonusEnergy: 0,
      energyBlockedAtMaxCharges: 0,
      chargesEarned: 0,
      chargesUsed: 0,
      successfulMonsterSkips: 0,
      remainingCharges: 0,
      remainingEnergy: 0
    },
    upgrades: {
      counts: { ...upgradeCounts },
      history: []
    },
    floorSplits: [],
    monsterRecords: []
  };

  const monsterByEventId = new Map();
  const seenRhythmRoundIds = new Set();
  const seenRhythmTargetIds = new Set();
  const seenResolvedRhythmRoundIds = new Set();
  const battleStartedAtByEventId = new Map();
  const defeatedAtByEventId = new Set();
  const lastSplit = { floor: GAME_CONFIG.startFloor, timerMs: 0 };
  let climbingTimeMs = 0;
  let weightedBaseSpeedTime = 0;
  let weightedSpeedCapTime = 0;
  let speedCapTimeMs = 0;
  let aboveUnupgradedCapMs = 0;
  let speedCapUpgradeBonus = 0;
  let battleDurationTotalMs = 0;
  let defeatedAttackRoundsTotal = 0;
  let startWallTimeMs = startedAtMs;

  function monsterRecord(event, monster = null) {
    if (!event) return null;
    const key = String(event.id);
    if (!monsterByEventId.has(key)) {
      const record = {
        monsterOrdinal: Number(event.id) || null,
        monsterType: monster?.id ?? null,
        monsterName: monster?.name ?? null,
        floor: roundNumber(event.floor, 2),
        result: 'pending',
        attackRounds: 0,
        battleDurationSeconds: 0,
        calculatedDamage: 0,
        totalDamage: 0,
        baseAttackDamage: 0,
        rapidTapDamage: 0,
        colorMultiplierBonusDamage: 0,
        qteDamage: 0,
        encounterQteDamage: 0,
        shieldQteDamage: 0,
        encounterAttempts: 0,
        encounterHistory: []
      };
      data.monsterRecords.push(record);
      monsterByEventId.set(key, record);
    }
    const record = monsterByEventId.get(key);
    if (monster && !record.monsterType) {
      record.monsterType = monster.id ?? null;
      record.monsterName = monster.name ?? null;
    }
    return record;
  }

  function recordTime(category, milliseconds) {
    const amount = Math.max(0, Number(milliseconds) || 0);
    if (!amount) return;
    const key = TIME_CATEGORIES.includes(category) ? category : 'otherEventMs';
    data.timing[key.replace(/Ms$/, 'Seconds')] += amount / 1000;
  }

  function recordClimbSegment(segment) {
    const elapsedMs = Math.max(0, Number(segment.elapsedMs) || 0);
    const distance = Math.max(0, Number(segment.distanceFloors) || 0);
    if (elapsedMs <= 0 || distance <= 0) return;
    const seconds = elapsedMs / 1000;
    const startFloor = Number(segment.startFloor) || GAME_CONFIG.startFloor;
    const endFloor = Math.max(startFloor, Number(segment.endFloor) || startFloor);
    const painMultiplier = Math.max(0, Number(segment.painMultiplier) || 1);
    const currentMax = Math.max(0, Number(segment.maxSpeed) || 0);
    const normalSpeedStart = Math.max(0, Number(segment.normalSpeedStart) || 0);
    const effectiveSpeedStart = Math.max(0, Number(segment.effectiveSpeedStart) || 0);
    const temporaryBurstMs = Math.min(
      elapsedMs,
      Math.max(0, Number(segment.temporarySpeedBonusDurationMs) || 0)
    );
    const temporarySpeedBonus = Math.max(0, Number(segment.temporarySpeedBonus) || 0);

    data.climbing.totalClimbedFloors += distance;
    climbingTimeMs += elapsedMs;
    weightedBaseSpeedTime += normalSpeedStart * seconds;
    data.climbing.maxEffectiveSpeedFloorsPerSecond = Math.max(
      data.climbing.maxEffectiveSpeedFloorsPerSecond,
      effectiveSpeedStart
    );
    weightedSpeedCapTime += currentMax * painMultiplier * seconds;
    if (temporaryBurstMs > 0) {
      data.climbing.temporaryBurstSeconds += temporaryBurstMs / 1000;
      data.climbing.temporaryBurstDistanceFloors +=
        temporarySpeedBonus * painMultiplier * (temporaryBurstMs / 1000);
    }
    if (painMultiplier < 1) {
      data.climbing.painDebuffAffectedSeconds += seconds;
      data.climbing.painDebuffAffectedDistanceFloors += distance;
    }
    if (normalSpeedStart >= currentMax - 1e-7) speedCapTimeMs += elapsedMs;
    const noUpgradeCap = Math.max(0, currentMax - speedCapUpgradeBonus) * painMultiplier;
    if (normalSpeedStart * painMultiplier > noUpgradeCap + 1e-7) aboveUnupgradedCapMs += elapsedMs;

    let remainingDistance = distance;
    const span = Math.max(1e-9, endFloor - startFloor);
    for (const interval of data.climbing.floorIntervals) {
      const overlap = Math.max(0, Math.min(endFloor, interval.toFloor) - Math.max(startFloor, interval.fromFloor));
      if (overlap <= 0) continue;
      const allocatedDistance = Math.min(remainingDistance, distance * (overlap / span));
      const allocatedMs = elapsedMs * (allocatedDistance / distance);
      interval.climbedFloors += allocatedDistance;
      interval.climbingSeconds += allocatedMs / 1000;
      remainingDistance -= allocatedDistance;
    }
    if (remainingDistance > 1e-8) {
      const interval = data.climbing.floorIntervals[stageForFloor(endFloor - 1e-8)];
      if (interval) {
        interval.climbedFloors += remainingDistance;
        interval.climbingSeconds += elapsedMs * (remainingDistance / distance) / 1000;
      }
    }
  }

  function recordKnockback(distanceFloors) {
    data.climbing.knockedBackFloors += Math.max(0, Number(distanceFloors) || 0);
    data.qte.knockbackCount += 1;
  }

  function recordFloorArrivals(startFloor, endFloor, timerMs) {
    const start = Number(startFloor) || GAME_CONFIG.startFloor;
    const end = Math.max(start, Number(endFloor) || start);
    for (let floor = 11; floor <= GAME_CONFIG.maxFloor; floor += 10) {
      if (start >= floor - 1e-8 || end < floor - 1e-8 || data.floorSplits.some((split) => split.toFloor === floor)) continue;
      const atMs = Math.max(0, Number(timerMs) || 0);
      data.floorSplits.push({
        fromFloor: lastSplit.floor,
        toFloor: floor,
        elapsedGameTimeSeconds: eventTimeSeconds(atMs - lastSplit.timerMs),
        firstReachedGameTimeSeconds: eventTimeSeconds(atMs)
      });
      lastSplit.floor = floor;
      lastSplit.timerMs = atMs;
    }
  }

  function recordMonsterEncounter(event, monster, timerMs = 0) {
    const record = monsterRecord(event, monster);
    if (!record || record.result === 'defeated' || record.result === 'skipped') return;
    record.encounterAttempts += 1;
    record.encounterHistory.push({
      attempt: record.encounterAttempts,
      gameTimeSeconds: eventTimeSeconds(timerMs),
      floor: roundNumber(event.floor, 2)
    });
    data.combat.encounterAttempts += 1;
  }

  function recordQteStart(context, compensationMs = 0) {
    if (context === 'defense-recovery') data.qte.emergencyAttempts += 1;
    else data.qte.encounterAttempts += 1;
    if (context !== 'defense-recovery') {
      data.qte.maxFailureCompensationSeconds = Math.max(
        data.qte.maxFailureCompensationSeconds,
        Math.max(0, Number(compensationMs) || 0) / 1000
      );
    }
  }

  function recordQteResult(context, success) {
    if (context === 'defense-recovery') {
      if (success) data.qte.emergencySuccesses += 1;
      else data.qte.emergencyFailures += 1;
      return;
    }
    if (success) data.qte.encounterSuccesses += 1;
    else data.qte.encounterFailures += 1;
  }

  function recordQteDamage(event, calculatedDamage, actualDamage, source = 'encounter') {
    const calculated = Math.max(0, Number(calculatedDamage) || 0);
    const actual = Math.max(0, Number(actualDamage) || 0);
    const isShieldDefense = source === 'shield-defense';
    const category = isShieldDefense ? 'shieldQteDamage' : 'encounterQteDamage';
    data.qte.qteDamage += actual;
    data.qte[category] += actual;
    data.qte.reactionDamageTriggers += 1;
    data.qte[isShieldDefense ? 'shieldReactionDamageTriggers' : 'encounterReactionDamageTriggers'] += 1;
    data.combat.calculatedDamage += calculated;
    data.combat.actualDamage += actual;
    data.combat.qteDamage += actual;
    data.combat[category] += actual;
    const record = monsterRecord(event);
    if (record) {
      record.calculatedDamage += calculated;
      record.totalDamage += actual;
      record.qteDamage += actual;
      record[category] += actual;
    }
  }

  function recordShieldDefenseResult(event, defended) {
    data.qte.shieldDefenseAttempts += 1;
    data.combat.shieldDefenseAttempts += 1;
    if (defended) {
      data.qte.shieldDefenseSuccesses += 1;
      data.combat.shieldDefenseSuccesses += 1;
    }
    monsterRecord(event);
  }

  function recordRapidTapInput(source = 'manual', isDebugRun = false) {
    data.combat.rapidTapInputCount += 1;
    if (source === 'keyboard-space') data.combat.rapidTapKeyboardSpace += 1;
    else if (source === 'mouse') data.combat.rapidTapMouse += 1;
    else if (source === 'touch') data.combat.rapidTapTouch += 1;
    else if (isDebugRun) data.combat.rapidTapDebugInputs += 1;
    else data.combat.rapidTapOtherInputs += 1;
  }

  function recordCombatStart(event, timerMs) {
    if (!event) return;
    const key = String(event.id);
    if (!battleStartedAtByEventId.has(key)) battleStartedAtByEventId.set(key, Math.max(0, Number(timerMs) || 0));
  }

  function recordAttackRound(event) {
    const record = monsterRecord(event);
    if (!record) return;
    record.attackRounds += 1;
    data.combat.totalAttackRounds += 1;
  }

  function recordCombatDamage(event, breakdown) {
    const calculated = Math.max(0, Number(breakdown.calculatedDamage) || 0);
    const actual = Math.max(0, Number(breakdown.actualDamage) || 0);
    const factor = calculated > 0 ? Math.min(1, actual / calculated) : 0;
    const base = Math.max(0, Number(breakdown.baseAttackDamage) || 0) * factor;
    const rapid = Math.max(0, Number(breakdown.rapidTapDamage) || 0) * factor;
    const color = Math.max(0, Number(breakdown.colorMultiplierBonusDamage) || 0) * factor;
    data.combat.calculatedDamage += calculated;
    data.combat.actualDamage += actual;
    data.combat.baseAttackDamage += base;
    data.combat.rapidTapDamage += rapid;
    data.combat.colorMultiplierBonusDamage += color;
    const record = monsterRecord(event);
    if (record) {
      record.calculatedDamage += calculated;
      record.totalDamage += actual;
      record.baseAttackDamage += base;
      record.rapidTapDamage += rapid;
      record.colorMultiplierBonusDamage += color;
    }
  }

  function recordMonsterDefeated(event, timerMs) {
    const record = monsterRecord(event);
    if (!record || record.result === 'skipped' || defeatedAtByEventId.has(String(event.id))) return;
    defeatedAtByEventId.add(String(event.id));
    record.result = 'defeated';
    const startMs = battleStartedAtByEventId.get(String(event.id));
    const durationMs = Number.isFinite(startMs) ? Math.max(0, (Number(timerMs) || 0) - startMs) : 0;
    record.battleDurationSeconds = eventTimeSeconds(durationMs);
    battleDurationTotalMs += durationMs;
    defeatedAttackRoundsTotal += record.attackRounds;
  }

  function recordMonsterSkipped(event, timerMs) {
    const record = monsterRecord(event, event?.monster ?? null);
    if (!record || record.result === 'skipped' || record.result === 'defeated') return;
    record.result = 'skipped';
    record.skippedAtGameTimeSeconds = eventTimeSeconds(timerMs);
    data.combat.monstersSkipped += 1;
    data.energy.successfulMonsterSkips += 1;
  }

  function recordRhythmSpawn(roundId, typeId, mode) {
    if (seenRhythmRoundIds.has(roundId)) return;
    seenRhythmRoundIds.add(roundId);
    const purpose = mode === 'COMBAT_ATTACK' ? 'combatAttack' : 'climbing';
    const colorStats = data.rhythm.byPurpose[purpose]?.[typeId];
    if (!colorStats) return;
    colorStats.ballsSpawned += 1;
    data.rhythm.overall.ballsSpawned += 1;
  }

  function recordRhythmTarget(roundId, typeId, mode, targetIndex, success) {
    const eventId = String(roundId) + ':' + String(targetIndex);
    if (seenRhythmTargetIds.has(eventId)) return;
    seenRhythmTargetIds.add(eventId);
    const purpose = mode === 'COMBAT_ATTACK' ? 'combatAttack' : 'climbing';
    const colorStats = data.rhythm.byPurpose[purpose]?.[typeId];
    if (!colorStats) return;
    const key = success ? 'targetsHit' : 'targetsMissed';
    colorStats[key] += 1;
    data.rhythm.overall[key] += 1;
  }

  function recordIncorrectPress(roundId, typeId, mode) {
    const purpose = mode === 'COMBAT_ATTACK' ? 'combatAttack' : 'climbing';
    const colorStats = data.rhythm.byPurpose[purpose]?.[typeId];
    if (!colorStats) return;
    colorStats.incorrectPresses += 1;
    data.rhythm.overall.incorrectPresses += 1;
  }

  function recordRhythmBallResolved(round, mode) {
    if (!round || seenResolvedRhythmRoundIds.has(round.id)) return;
    seenResolvedRhythmRoundIds.add(round.id);
    const purpose = mode === 'COMBAT_ATTACK' ? 'combatAttack' : 'climbing';
    const colorStats = data.rhythm.byPurpose[purpose]?.[round.typeId];
    if (!colorStats) return;
    const successCount = (round.resolvedHits ?? []).filter((result) => result === 'success').length;
    const totalCount = round.hitBeats?.length ?? 0;
    colorStats.completedBalls += 1;
    data.rhythm.overall.completedBalls += 1;
    if (round.isLowBloodSugarDisabled) {
      colorStats.disabledBalls += 1;
      colorStats.disabledTargets += totalCount;
      data.rhythm.overall.disabledBalls += 1;
      data.rhythm.overall.disabledTargets += totalCount;
      return;
    }
    colorStats.eligibleBalls += 1;
    data.rhythm.overall.eligibleBalls += 1;
    if (totalCount > 0 && successCount === totalCount) {
      colorStats.perfectBalls += 1;
      data.rhythm.overall.perfectBalls += 1;
    }
  }

  function recordMaxCombo(combo) {
    data.rhythm.maxCombo = Math.max(data.rhythm.maxCombo, Math.max(0, Number(combo) || 0));
  }

  function recordEnergyGain({ baseEnergy = 0, comboBonusEnergy = 0, upgradeBonusEnergy = 0, eligibleEnergy = 0, blockedEnergy = 0 } = {}) {
    data.energy.baseEnergy += Math.max(0, Number(baseEnergy) || 0);
    data.energy.comboBonusEnergy += Math.max(0, Number(comboBonusEnergy) || 0);
    data.energy.upgradeBonusEnergy += Math.max(0, Number(upgradeBonusEnergy) || 0);
    data.energy.totalEligibleEnergy += Math.max(0, Number(eligibleEnergy) || 0);
    data.energy.energyBlockedAtMaxCharges += Math.max(0, Number(blockedEnergy) || 0);
  }

  function recordChargeEarned() { data.energy.chargesEarned += 1; }
  function recordChargeUsed() { data.energy.chargesUsed += 1; }

  function recordUpgradeSelection({ cardId, floor, timerMs, level, before, after, selectionWallTimeMs = 0 }) {
    if (cardId in data.upgrades.counts) data.upgrades.counts[cardId] = Math.max(0, Number(level) || 0);
    data.upgrades.history.push({
      floor: roundNumber(floor, 2),
      gameTimeSeconds: eventTimeSeconds(timerMs),
      upgradeId: cardId,
      level: Math.max(0, Number(level) || 0),
      valuesBefore: { ...before },
      valuesAfter: { ...after }
    });
    data.timing.upgradeSelectionSeconds += Math.max(0, Number(selectionWallTimeMs) || 0) / 1000;
    if (cardId === 'max-speed') {
      speedCapUpgradeBonus += Number(UPGRADE_CARDS.find((card) => card.id === cardId)?.effect?.maxSpeedPerSelection) || 0;
      data.climbing.speedCapUpgradeCount += 1;
      data.climbing.speedCapUpgradeHistory.push({
        floor: roundNumber(floor, 2),
        gameTimeSeconds: eventTimeSeconds(timerMs),
        level: Math.max(0, Number(level) || 0),
        speedCapFloorsPerSecond: roundNumber(after.speedCapFloorsPerSecond, 4)
      });
    }
    if (cardId === 'qte-duration') data.qte.qteTimeUpgradeCount += 1;
  }

  function finalize({
    result = 'victory',
    timerMs = 0,
    wallEndedAtMs = Date.now(),
    finalFloor = GAME_CONFIG.maxFloor,
    baseSpeed = 0,
    effectiveSpeed = 0,
    speedCap = 0,
    effectiveSpeedCap = 0,
    remainingCharges = 0,
    remainingEnergy = 0,
    stateStats = {}
  } = {}) {
    const officialMs = Math.max(0, Number(timerMs) || 0);
    const classifiedMs = TIME_CATEGORIES.reduce((sum, key) => sum + (Number(data.timing[key.replace(/Ms$/, 'Seconds')]) || 0) * 1000, 0);
    const actualClimbSeconds = climbingTimeMs / 1000;
    const defeated = data.monsterRecords.filter((record) => record.result === 'defeated').length;
    data.combat.monstersDefeated = defeated;
    data.combat.averageKillAttackRounds = defeated > 0 ? defeatedAttackRoundsTotal / defeated : 0;
    data.combat.oneRoundKills = data.monsterRecords.filter((record) => record.result === 'defeated' && record.attackRounds === 1).length;
    data.combat.twoRoundKills = data.monsterRecords.filter((record) => record.result === 'defeated' && record.attackRounds === 2).length;
    data.combat.threeOrMoreRoundKills = data.monsterRecords.filter((record) => record.result === 'defeated' && record.attackRounds >= 3).length;
    data.combat.qteOnlyKills = data.monsterRecords.filter((record) => record.result === 'defeated' && record.attackRounds === 0).length;
    data.combat.averageBattleSecondsPerDefeatedMonster = defeated > 0 ? battleDurationTotalMs / 1000 / defeated : 0;
    data.qte.encounterSuccessRate = data.qte.encounterAttempts > 0
      ? data.qte.encounterSuccesses / data.qte.encounterAttempts : 0;
    data.qte.emergencySuccessRate = data.qte.emergencyAttempts > 0
      ? data.qte.emergencySuccesses / data.qte.emergencyAttempts : 0;
    data.rhythm.overall.hitSuccessRate = data.rhythm.overall.targetsHit + data.rhythm.overall.targetsMissed > 0
      ? data.rhythm.overall.targetsHit / (data.rhythm.overall.targetsHit + data.rhythm.overall.targetsMissed) : 0;
    data.rhythm.overall.perfectBallRate = data.rhythm.overall.eligibleBalls > 0
      ? data.rhythm.overall.perfectBalls / data.rhythm.overall.eligibleBalls : 0;
    for (const purpose of Object.values(data.rhythm.byPurpose)) {
      for (const color of Object.values(purpose)) {
        color.hitSuccessRate = color.targetsHit + color.targetsMissed > 0
          ? color.targetsHit / (color.targetsHit + color.targetsMissed) : 0;
        color.perfectBallRate = color.eligibleBalls > 0 ? color.perfectBalls / color.eligibleBalls : 0;
      }
    }
    for (const interval of data.climbing.floorIntervals) {
      interval.averageEffectiveSpeedFloorsPerSecond = interval.climbingSeconds > 0
        ? interval.climbedFloors / interval.climbingSeconds : 0;
      interval.climbedFloors = roundNumber(interval.climbedFloors, 4);
      interval.climbingSeconds = roundNumber(interval.climbingSeconds, 3);
      interval.averageEffectiveSpeedFloorsPerSecond = roundNumber(interval.averageEffectiveSpeedFloorsPerSecond, 4);
    }

    const normalClimbMs = Number(data.timing.normalClimbingSeconds) * 1000;
    const unclassifiedMs = Math.max(0, officialMs - classifiedMs);
    const wallElapsedMs = Math.max(0, (Number(wallEndedAtMs) || 0) - startWallTimeMs);
    data.run.result = result;
    data.run.finishedAt = new Date(wallEndedAtMs).toISOString();
    data.run.finalFloor = roundNumber(finalFloor, 2);
    data.timing.gameTimeSeconds = roundNumber(officialMs / 1000, 3);
    data.timing.normalClimbingSeconds = roundNumber(data.timing.normalClimbingSeconds, 3);
    data.timing.encounterQteSeconds = roundNumber(data.timing.encounterQteSeconds, 3);
    data.timing.combatSeconds = roundNumber(data.timing.combatSeconds, 3);
    data.timing.emergencyQteSeconds = roundNumber(data.timing.emergencyQteSeconds, 3);
    data.timing.animationTransitionSeconds = roundNumber(data.timing.animationTransitionSeconds, 3);
    data.timing.otherEventSeconds = roundNumber(data.timing.otherEventSeconds, 3);
    data.timing.realElapsedSeconds = roundNumber(wallElapsedMs / 1000, 3);
    data.timing.unclassifiedSeconds = roundNumber(unclassifiedMs / 1000, 3);

    data.climbing.averageEffectiveSpeedFloorsPerSecond = climbingTimeMs > 0
      ? data.climbing.totalClimbedFloors / actualClimbSeconds : 0;
    data.climbing.averageBaseSpeedFloorsPerSecond = climbingTimeMs > 0
      ? weightedBaseSpeedTime / actualClimbSeconds : 0;
    data.climbing.averageBaseSpeedFloorsPerSecond = roundNumber(data.climbing.averageBaseSpeedFloorsPerSecond, 4);
    data.climbing.temporaryBurstSeconds = roundNumber(data.climbing.temporaryBurstSeconds, 3);
    data.climbing.temporaryBurstDistanceFloors = roundNumber(data.climbing.temporaryBurstDistanceFloors, 4);
    data.climbing.painDebuffAffectedSeconds = roundNumber(data.climbing.painDebuffAffectedSeconds, 3);
    data.climbing.painDebuffAffectedDistanceFloors = roundNumber(data.climbing.painDebuffAffectedDistanceFloors, 4);
    data.climbing.maxEffectiveSpeedFloorsPerSecond = roundNumber(data.climbing.maxEffectiveSpeedFloorsPerSecond, 4);
    data.climbing.averageEffectiveSpeedFloorsPerSecond = roundNumber(data.climbing.averageEffectiveSpeedFloorsPerSecond, 4);
    data.climbing.finalBaseSpeedFloorsPerSecond = roundNumber(baseSpeed, 4);
    data.climbing.finalEffectiveSpeedFloorsPerSecond = roundNumber(effectiveSpeed, 4);
    data.climbing.finalSpeedCapFloorsPerSecond = roundNumber(speedCap, 4);
    data.climbing.finalEffectiveSpeedCapFloorsPerSecond = roundNumber(effectiveSpeedCap, 4);
    data.climbing.averageEffectiveSpeedCapFloorsPerSecond = climbingTimeMs > 0
      ? weightedSpeedCapTime / actualClimbSeconds : 0;
    data.climbing.averageEffectiveSpeedCapFloorsPerSecond = roundNumber(data.climbing.averageEffectiveSpeedCapFloorsPerSecond, 4);
    data.climbing.timeAtSpeedCapSeconds = roundNumber(speedCapTimeMs / 1000, 3);
    data.climbing.timeAtSpeedCapRatio = normalClimbMs > 0
      ? roundNumber(speedCapTimeMs / normalClimbMs, 4) : 0;
    data.climbing.timeAboveNoSpeedUpgradeCapSeconds = roundNumber(aboveUnupgradedCapMs / 1000, 3);
    data.climbing.totalClimbedFloors = roundNumber(data.climbing.totalClimbedFloors, 4);
    data.climbing.knockedBackFloors = roundNumber(data.climbing.knockedBackFloors, 4);

    for (const key of [
      'calculatedDamage', 'actualDamage', 'baseAttackDamage', 'rapidTapDamage',
      'rapidTapInputCount', 'rapidTapKeyboardSpace', 'rapidTapMouse', 'rapidTapTouch', 'rapidTapOtherInputs', 'rapidTapDebugInputs',
      'shieldDefenseAttempts', 'shieldDefenseSuccesses', 'colorMultiplierBonusDamage', 'qteDamage',
      'encounterQteDamage', 'shieldQteDamage', 'averageKillAttackRounds',
      'averageBattleSecondsPerDefeatedMonster'
    ]) data.combat[key] = roundNumber(data.combat[key], 4);
    for (const key of ['qteDamage', 'encounterQteDamage', 'shieldQteDamage']) {
      data.qte[key] = roundNumber(data.qte[key], 4);
    }
    data.energy.totalEligibleEnergy = roundNumber(data.energy.totalEligibleEnergy, 6);
    data.energy.baseEnergy = roundNumber(data.energy.baseEnergy, 6);
    data.energy.comboBonusEnergy = roundNumber(data.energy.comboBonusEnergy, 6);
    data.energy.upgradeBonusEnergy = roundNumber(data.energy.upgradeBonusEnergy, 6);
    data.energy.energyBlockedAtMaxCharges = roundNumber(data.energy.energyBlockedAtMaxCharges, 6);
    data.energy.remainingCharges = Math.max(0, Number(remainingCharges) || 0);
    data.energy.remainingEnergy = roundNumber(remainingEnergy, 6);
    data.combat.encounterAttempts = data.qte.encounterAttempts;

    for (const record of data.monsterRecords) {
      for (const key of ['battleDurationSeconds', 'calculatedDamage', 'totalDamage', 'baseAttackDamage', 'rapidTapDamage', 'colorMultiplierBonusDamage', 'qteDamage', 'encounterQteDamage', 'shieldQteDamage']) {
        record[key] = roundNumber(record[key], 4);
      }
    }
    for (const split of data.floorSplits) {
      split.elapsedGameTimeSeconds = roundNumber(split.elapsedGameTimeSeconds, 3);
      split.firstReachedGameTimeSeconds = roundNumber(split.firstReachedGameTimeSeconds, 3);
    }
    data.combat.totalDamage = data.combat.actualDamage;
    data.combat.totalCalculatedDamage = data.combat.calculatedDamage;
    data.qte.totalSuccessDamage = data.qte.qteDamage;
    data.upgrades.counts = { ...upgradeCounts, ...data.upgrades.counts };
    data.stats = {
      hits: Math.max(0, Number(stateStats.hits) || 0),
      misses: Math.max(0, Number(stateStats.misses) || 0),
      qteWins: Math.max(0, Number(stateStats.qteWins) || 0),
      qteLosses: Math.max(0, Number(stateStats.qteLosses) || 0),
      maxCombo: Math.max(data.rhythm.maxCombo, Number(stateStats.maxCombo) || 0)
    };
    data.rhythm.maxCombo = data.stats.maxCombo;
    data.energy.chargesEarned = Math.max(data.energy.chargesEarned, 0);
    data.energy.chargesUsed = Math.max(data.energy.chargesUsed, 0);
    data.energy.successfulMonsterSkips = data.combat.monstersSkipped;
    data.run.officialTimeSeconds = data.timing.gameTimeSeconds;
    return deepFreeze(JSON.parse(JSON.stringify(data)));
  }

  function recordFinalFloorArrival(timerMs) {
    recordFloorArrivals(GAME_CONFIG.maxFloor - 1e-7, GAME_CONFIG.maxFloor, timerMs);
  }

  return {
    data,
    recordTime,
    recordClimbSegment,
    recordKnockback,
    recordFloorArrivals,
    recordFinalFloorArrival,
    recordMonsterEncounter,
    recordQteStart,
    recordQteResult,
    recordQteDamage,
    recordShieldDefenseResult,
    recordRapidTapInput,
    recordCombatStart,
    recordAttackRound,
    recordCombatDamage,
    recordMonsterDefeated,
    recordMonsterSkipped,
    recordRhythmSpawn,
    recordRhythmTarget,
    recordIncorrectPress,
    recordRhythmBallResolved,
    recordMaxCombo,
    recordEnergyGain,
    recordChargeEarned,
    recordChargeUsed,
    recordUpgradeSelection,
    finalize
  };
}
