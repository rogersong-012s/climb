import { ANTI_DIZZINESS_MODE, GAME_CONFIG, UI_TEXT, UPGRADE_CARDS } from './config.js';
import { hitZoneWidthForCombo } from './combo.js';
import { applyHit, applyMiss, knockBack } from './climbing.js';
import { scheduleMonsterEvents, firstCrossedMonsterEvent } from './events.js';
import { applyDebuff, applySolutionEffect, consumeDebuffDistance } from './effects.js';
import { chooseMonster } from './monsters.js';
import { clickQteTile, createQte } from './qte.js';
import { createRhythmRound, currentRhythmWindow, isCurrentRhythmHit, rhythmHitWindows, rhythmRoundDurationMs, rhythmRoundProgress, rhythmWindowForIndex, RHYTHM_PHASE } from './rhythm.js';
import { stairNodeAt } from './stairs.js';

const MONSTER_EVENT_PHASES = new Set([
  'EVENT_WARNING', 'MONSTER_ENTRANCE', 'MONSTER_CAST', 'MONSTER_IMPACT',
  'ATTACK_TO_DEBUFF_DELAY', 'DEBUFF_REVEAL', 'DEBUFF_TO_ANSWER_DELAY', 'ANSWER_PREVIEW'
]);
const COMBAT_TIMED_PHASES = new Set([
  'COMBAT_ATTACK_INTRO', 'COMBAT_ATTACK_SETTLE', 'COMBAT_DEFENSE_INTRO',
  'COMBAT_DEFENSE_SUCCESS', 'COMBAT_DEFENSE_FAILED', 'COMBAT_VICTORY'
]);
const COMBAT_MODES = new Set(['COMBAT_ATTACK', 'COMBAT_RAPID_TAP', 'COMBAT_DEFENSE', ...COMBAT_TIMED_PHASES]);
const PAUSABLE_MODES = new Set(['CLIMBING', 'UPGRADE_SELECT', ...MONSTER_EVENT_PHASES, 'MONSTER_QTE', ...COMBAT_MODES]);

function freshState(bestTimeMs = null, antiDizzinessMode = ANTI_DIZZINESS_MODE.OFF) {
  const stairNode = stairNodeAt(GAME_CONFIG.startFloor);
  return {
    mode: 'MENU',
    resumeMode: null,
    progress: GAME_CONFIG.startFloor,
    stairViewMode: stairNode.viewMode,
    stairNodeProgress: stairNode.nodeProgress,
    stairSegmentIndex: stairNode.segmentIndex,
    climbSpeed: GAME_CONFIG.initialClimbSpeed,
    maxClimbSpeed: GAME_CONFIG.maxClimbSpeed,
    temporarySpeedBonus: 0,
    temporarySpeedBonusRemainingMs: 0,
    stepPhase: 0,
    pendingMonsterEvent: null,
    activeMonsterEvent: null,
    activeMonster: null,
    monsterHp: null,
    monsterMaxHp: null,
    upgradeChoices: [],
    runUpgrades: {
      baseAttackDamage: GAME_CONFIG.combatBaseAttackDamage,
      rapidTapDamage: GAME_CONFIG.combatRapidTapDamageMultiplier,
      rhythmJudgmentLevel: 0
    },
    combatDefenseRound: null,
    combatRapidTap: null,
    combatPendingDamage: 0,
    combatDefenseImpactSerial: 0,
    preparedQte: null,
    monsterDebuffApplied: false,
    monsterImpactSerial: 0,
    debuffCureSerial: 0,
    eventPhaseElapsedMs: 0,
    eventPhaseDurationMs: 0,
    isLandingPaused: false,
    landingPauseDurationMs: 0,
    landingPauseRemainingMs: 0,
    isTurning: false,
    turnDurationMs: 0,
    turnRemainingMs: 0,
    turnTransitionMode: null,
    turnFromMode: null,
    turnFromProgress: null,
    turnTargetMode: null,
    turnTargetProgress: null,
    turnTargetSegmentIndex: null,
    combo: 0,
    rhythmRound: null,
    rhythmRoundSerial: 0,
    unlockedRhythmTypes: ['RED', 'BLUE'],
    collectedRhythmOrbs: [],
    rhythmOrbCollectSerial: 0,
    rhythmOrbFeedback: null,
    rhythmTapSerial: 0,
    rhythmFeedbackSerial: 0,
    rhythmFeedbackKind: null,
    rhythmLaunchSerial: 0,
    timerMs: 0,
    monsterEvents: [],
    activeQte: null,
    debuff: null,
    feedback: null,
    stats: { hits: 0, misses: 0, qteWins: 0, qteLosses: 0, maxCombo: 0 },
    bestTimeMs,
    antiDizzinessMode,
    bestUpdated: false
  };
}

function integrateClimbSpeed(speed, seconds) {
  const minimum = GAME_CONFIG.minClimbSpeed;
  const decay = GAME_CONFIG.speedDecay;
  if (seconds <= 0) return { speed: Math.max(minimum, speed), distance: 0 };

  const timeToMinimum = decay > 0 ? Math.max(0, (speed - minimum) / decay) : Infinity;
  const decayingSeconds = Math.min(seconds, timeToMinimum);
  const nextSpeed = Math.max(minimum, speed - decay * decayingSeconds);
  const distance = ((speed + nextSpeed) / 2) * decayingSeconds +
    minimum * (seconds - decayingSeconds);
  return { speed: nextSpeed, distance };
}

function timeToClimbDistance(distance, speed, temporaryBonus = 0, bonusRemainingSeconds = 0) {
  if (distance <= 0) return 0;
  if (temporaryBonus > 0 && bonusRemainingSeconds > 0) {
    const bonusSeconds = Math.max(0, bonusRemainingSeconds);
    const boostedDistance = integrateClimbSpeed(speed, bonusSeconds).distance + temporaryBonus * bonusSeconds;
    if (distance <= boostedDistance) {
      let low = 0;
      let high = bonusSeconds;
      for (let iteration = 0; iteration < 48; iteration += 1) {
        const midpoint = (low + high) / 2;
        const midpointDistance = integrateClimbSpeed(speed, midpoint).distance + temporaryBonus * midpoint;
        if (midpointDistance < distance) low = midpoint;
        else high = midpoint;
      }
      return (low + high) / 2;
    }
    const speedAfterBonus = integrateClimbSpeed(speed, bonusSeconds).speed;
    return bonusSeconds + timeToClimbDistance(distance - boostedDistance, speedAfterBonus);
  }
  const minimum = GAME_CONFIG.minClimbSpeed;
  const decay = GAME_CONFIG.speedDecay;
  if (decay <= 0) return distance / speed;
  if (speed <= minimum) return distance / minimum;

  const timeToMinimum = (speed - minimum) / decay;
  const distanceBeforeMinimum = speed * timeToMinimum - 0.5 * decay * timeToMinimum ** 2;
  if (distance <= distanceBeforeMinimum) {
    const discriminant = Math.max(0, speed ** 2 - 2 * decay * distance);
    return (speed - Math.sqrt(discriminant)) / decay;
  }
  return timeToMinimum + (distance - distanceBeforeMinimum) / minimum;
}

function platformTransitionDurationsForSpeed(speed, maxSpeed = GAME_CONFIG.maxClimbSpeed) {
  const referenceSpeed = GAME_CONFIG.turnReferenceSpeed;
  const safeSpeed = Math.min(
    maxSpeed,
    Math.max(GAME_CONFIG.minClimbSpeed, speed)
  );
  const ratio = referenceSpeed / safeSpeed;
  return {
    pauseMs: GAME_CONFIG.basePlatformPauseDurationMs * ratio,
    turnMs: GAME_CONFIG.baseStairTurnDurationMs * ratio
  };
}

function readBest(storage) {
  try {
    const raw = storage?.getItem(GAME_CONFIG.bestRecordStorageKey);
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function readAntiDizzinessMode(storage) {
  try {
    return storage?.getItem(GAME_CONFIG.antiDizzinessStorageKey) === ANTI_DIZZINESS_MODE.ON
      ? ANTI_DIZZINESS_MODE.ON
      : ANTI_DIZZINESS_MODE.OFF;
  } catch {
    return ANTI_DIZZINESS_MODE.OFF;
  }
}

export function createGame(options = {}) {
  const random = options.random ?? Math.random;
  let storage = options.storage;
  if (storage === undefined) {
    try { storage = globalThis.localStorage; } catch { storage = null; }
  }
  let state = freshState(readBest(storage), readAntiDizzinessMode(storage));
  let previousFrameTime = null;
  let rhythmTapSerial = 0;
  let rhythmFeedbackSerial = 0;
  let rhythmLaunchSerial = 0;
  let lastRhythmInputTimerMs = -Infinity;
  const listeners = new Set();

  function notify() {
    listeners.forEach((listener) => listener(state));
  }

  function effectiveClimbSpeed() {
    return state.climbSpeed + (state.temporarySpeedBonusRemainingMs > 0 ? state.temporarySpeedBonus : 0);
  }

  function clearTemporarySpeedBonus() {
    state.temporarySpeedBonus = 0;
    state.temporarySpeedBonusRemainingMs = 0;
  }

  function triggerPerfectClimbSpeedBurst() {
    state.temporarySpeedBonus = GAME_CONFIG.perfectRhythmSpeedBurstBonus;
    state.temporarySpeedBonusRemainingMs = GAME_CONFIG.perfectRhythmSpeedBurstDurationMs;
  }

  function currentBallPosition() {
    return rhythmRoundProgress(state.rhythmRound);
  }

  function currentHitZoneWidth() {
    const effectiveMode = state.mode === 'PAUSED' ? state.resumeMode : state.mode;
    const judgmentMultiplier = 1 + state.runUpgrades.rhythmJudgmentLevel * GAME_CONFIG.upgradeRhythmJudgmentBonus;
    if (effectiveMode === 'COMBAT_ATTACK') return hitZoneWidthForCombo(0, null, judgmentMultiplier);
    return hitZoneWidthForCombo(state.combo, state.debuff?.type ?? null, judgmentMultiplier);
  }

  function drawUpgradeChoices() {
    const pool = [...UPGRADE_CARDS];
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.min(index, Math.max(0, Math.floor(random() * (index + 1))));
      [pool[index], pool[randomIndex]] = [pool[randomIndex], pool[index]];
    }
    return pool.slice(0, Math.min(GAME_CONFIG.upgradeChoiceCount, pool.length)).map((card) => card.id);
  }

  function rhythmBeatDurationForCurrentDebuff() {
    const speedMultiplier = state.debuff?.type === 'SORE'
      ? GAME_CONFIG.debuffs.SORE.speedMultiplier
      : 1;
    return GAME_CONFIG.rhythmBeatDurationMs / (speedMultiplier * GAME_CONFIG.rhythmMoveSpeedMultiplier);
  }

  function rhythmPrepareDurationForCurrentDebuff() {
    const speedMultiplier = state.debuff?.type === 'SORE'
      ? GAME_CONFIG.debuffs.SORE.speedMultiplier
      : 1;
    return (GAME_CONFIG.rhythmBeatDurationMs * GAME_CONFIG.rhythmPrepareBeats) / speedMultiplier;
  }

  function isBallInZone() {
    return isCurrentRhythmHit(state.rhythmRound, currentHitZoneWidth());
  }

  function startNextRhythmRound() {
    state.rhythmRoundSerial += 1;
    state.rhythmRound = createRhythmRound(
      random,
      state.rhythmRoundSerial,
      rhythmBeatDurationForCurrentDebuff(),
      rhythmPrepareDurationForCurrentDebuff(),
      state.unlockedRhythmTypes,
      GAME_CONFIG.rhythmTypeWeights
    );
  }

  function collectRhythmOrb(orb) {
    if (!orb || state.collectedRhythmOrbs.includes(orb.id) || state.unlockedRhythmTypes.includes(orb.typeId)) return false;
    state.collectedRhythmOrbs.push(orb.id);
    state.unlockedRhythmTypes.push(orb.typeId);
    state.rhythmOrbCollectSerial += 1;
    state.rhythmOrbFeedback = {
      id: orb.id,
      typeId: orb.typeId,
      floor: orb.floor,
      platformAnchor: orb.platformAnchor ?? GAME_CONFIG.rhythmOrbPlatformAnchor,
      sceneProgress: 1,
      collectUntilMs: state.timerMs + GAME_CONFIG.rhythmOrbCollectAnimationMs,
      toastUntilMs: state.timerMs + GAME_CONFIG.rhythmOrbUnlockToastMs
    };

    // If a new round was prepared in the same long frame that reached the orb,
    // let that still-stationary ball draw from the newly unlocked pool as well.
    const round = state.rhythmRound;
    if (round?.phase === RHYTHM_PHASE.SPAWN_READY) {
      const replacement = createRhythmRound(
        random,
        round.id,
        round.beatDurationMs,
        round.readyDurationMs,
        state.unlockedRhythmTypes,
        GAME_CONFIG.rhythmTypeWeights
      );
      replacement.readyElapsedMs = round.readyElapsedMs;
      state.rhythmRound = replacement;
    }
    return true;
  }

  function nextRhythmOrbAfter(progress) {
    return GAME_CONFIG.rhythmOrbUnlocks
      .filter((orb) => !state.collectedRhythmOrbs.includes(orb.id) && orb.floor > progress + 1e-8)
      .sort((a, b) => a.floor - b.floor)[0] ?? null;
  }

  function triggerRhythmFeedback(kind) {
    state.rhythmFeedbackSerial = ++rhythmFeedbackSerial;
    state.rhythmFeedbackKind = kind;
  }

  function finishRhythmTargets(round) {
    if (round.resolvedHits.some((result) => result === null) || round.phase !== RHYTHM_PHASE.MOVING) return false;
    const successCount = round.resolvedHits.filter((result) => result === 'success').length;
    const isPerfect = successCount === round.hitBeats.length;
    round.phase = RHYTHM_PHASE.RESOLVED;
    round.resolvedKind = isPerfect ? 'hit' : 'miss';
    round.successCount = successCount;

    if (state.mode === 'COMBAT_ATTACK') {
      setFeedback('攻擊節奏 ' + successCount + '/' + round.hitBeats.length, isPerfect ? 'hit' : 'miss');
      return true;
    }

    if (isPerfect) {
      applyHit(state);
      if (state.mode === 'CLIMBING') triggerPerfectClimbSpeedBurst();
      setFeedback(UI_TEXT.hit, 'hit');
    } else {
      if (!round.missApplied) {
        applyMiss(state);
        round.missApplied = true;
      }
      setFeedback(UI_TEXT.miss, 'miss');
    }
    return true;
  }

  function syncRhythmInputIndex(round) {
    const nextIndex = round.resolvedHits.findIndex((result) => result === null);
    round.inputIndex = nextIndex < 0 ? round.hitBeats.length : nextIndex;
  }

  function applyRhythmMiss(round) {
    if (state.mode === 'CLIMBING' && !round.missApplied) {
      applyMiss(state);
      round.missApplied = true;
    }
  }

  function resolveRhythmTarget(round, targetIndex) {
    if (!round || round.phase !== RHYTHM_PHASE.MOVING ||
        targetIndex < 0 || targetIndex >= round.hitBeats.length ||
        round.resolvedHits[targetIndex] !== null) return false;
    round.resolvedHits[targetIndex] = 'success';
    round.successCount = round.resolvedHits.filter((result) => result === 'success').length;
    syncRhythmInputIndex(round);
    setFeedback('拍點 ' + round.successCount + '/' + round.hitBeats.length, 'neutral');
    triggerRhythmFeedback('hit');
    finishRhythmTargets(round);
    return true;
  }

  function expireRhythmTarget(round, targetIndex) {
    if (!round || round.phase !== RHYTHM_PHASE.MOVING || round.resolvedHits[targetIndex] !== null) return false;
    round.resolvedHits[targetIndex] = 'missed';
    round.missedCount = (round.missedCount ?? 0) + 1;
    syncRhythmInputIndex(round);
    applyRhythmMiss(round);
    setFeedback(state.mode === 'COMBAT_ATTACK' ? '攻擊拍點失誤' : UI_TEXT.miss, 'miss');
    triggerRhythmFeedback('miss');
    finishRhythmTargets(round);
    return true;
  }

  function applyPendingCombatDamage() {
    if (state.combatPendingDamage <= 0) return;
    const currentHp = state.monsterHp ?? state.monsterMaxHp ?? GAME_CONFIG.monsterBaseHp;
    state.monsterHp = Math.max(0, currentHp - state.combatPendingDamage);
    state.combatPendingDamage = 0;
  }

  function finishCombatAttackRound(round) {
    const totalCount = round.hitBeats.length;
    const successCount = round.resolvedHits.filter((result) => result === 'success').length;
    const isPerfect = totalCount > 0 && successCount === totalCount;
    // Perfect rounds defer all damage until the rapid-tap run completes, so
    // the base damage is included exactly once with the tap bonus.
    state.combatPendingDamage = isPerfect ? 0 : totalCount > 0
      ? Math.round(state.runUpgrades.baseAttackDamage * (successCount / totalCount))
      : 0;
    state.rhythmRound = null;
    beginCombatRapidTap(isPerfect);
  }

  function beginCombatRapidTap(enabled = false) {
    if (!state.activeMonster || (state.monsterHp ?? 0) <= 0) {
      beginCombatVictory();
      return;
    }
    state.rhythmRound = null;
    state.combatRapidTap = {
      elapsedMs: 0,
      durationMs: enabled
        ? GAME_CONFIG.combatRapidTapDurationMs / GAME_CONFIG.rhythmMoveSpeedMultiplier
        : GAME_CONFIG.combatRapidTapDisabledDurationMs,
      prepareRemainingMs: enabled ? GAME_CONFIG.combatRapidTapPrepareDelayMs : 0,
      tapCount: 0,
      disabled: !enabled
    };
    state.mode = 'COMBAT_RAPID_TAP';
    setFeedback(enabled ? '快速連打！' : UI_TEXT.combatRapidTapDisabled, enabled ? 'hit' : 'neutral');
  }

  function finishCombatRapidTap() {
    const rapidTap = state.combatRapidTap;
    if (!rapidTap || state.mode !== 'COMBAT_RAPID_TAP') return;
    if (!rapidTap.disabled) {
      state.combatPendingDamage = Math.round(
        state.runUpgrades.baseAttackDamage + rapidTap.tapCount * state.runUpgrades.rapidTapDamage
      );
    }
    state.combatRapidTap = null;
    setFeedback('DMG ' + state.combatPendingDamage, 'hit');
    enterMonsterPhase('COMBAT_ATTACK_SETTLE', GAME_CONFIG.combatPlayerAttackDurationMs);
  }

  function advanceCombatRapidTap(deltaMs) {
    const rapidTap = state.combatRapidTap;
    if (!rapidTap || state.mode !== 'COMBAT_RAPID_TAP') return Math.max(0, deltaMs);
    let remainingMs = Math.max(0, deltaMs);
    const prepareElapsedMs = Math.min(remainingMs, Math.max(0, rapidTap.prepareRemainingMs));
    rapidTap.prepareRemainingMs = Math.max(0, rapidTap.prepareRemainingMs - prepareElapsedMs);
    remainingMs -= prepareElapsedMs;
    const elapsedMs = Math.min(remainingMs, Math.max(0, rapidTap.durationMs - rapidTap.elapsedMs));
    rapidTap.elapsedMs += elapsedMs;
    remainingMs -= elapsedMs;
    if (rapidTap.elapsedMs + 1e-6 >= rapidTap.durationMs) {
      rapidTap.elapsedMs = rapidTap.durationMs;
      finishCombatRapidTap();
    }
    return remainingMs;
  }

  function createCombatDefenseRound() {
    const patterns = GAME_CONFIG.combatDefensePatterns;
    const patternIndex = Math.min(patterns.length - 1, Math.floor(random() * patterns.length));
    const pattern = patterns[Math.max(0, patternIndex)];
    const shield = { id: 'central', x: 50, y: GAME_CONFIG.combatDefenseShieldY };
    const flashDurationMs = GAME_CONFIG.combatDefenseVortexFlashDurationMs;
    const minDelayMs = GAME_CONFIG.combatDefenseInitialRandomDelayMinMs;
    const maxDelayMs = GAME_CONFIG.combatDefenseInitialRandomDelayMaxMs;
    const initialRandomDelayMs = minDelayMs + random() * Math.max(0, maxDelayMs - minDelayMs);
    const attacks = pattern.attackTimesMs.map((attackOffsetMs, index) => {
      const attackTimeMs = initialRandomDelayMs + attackOffsetMs;
      const flashStartTimeMs = initialRandomDelayMs + (index === 0 ? 0 : pattern.attackTimesMs[index - 1]);
      const launchTimeMs = flashStartTimeMs + flashDurationMs;
      return {
        id: String.fromCharCode(65 + index),
        flashStartTimeMs,
        launchTimeMs,
        flightDurationMs: Math.max(0, attackTimeMs - launchTimeMs),
        attackTimeMs,
        windowStartMs: attackTimeMs - GAME_CONFIG.combatDefenseHitWindowMs,
        status: 'scheduled'
      };
    });
    return {
      patternId: pattern.id,
      shield,
      initialRandomDelayMs,
      shieldColor: pattern.color,
      laserColor: pattern.laserColor,
      vortexFlashTimesMs: attacks.map((attack) => attack.flashStartTimeMs),
      vortexFlashSerial: 0,
      attackCount: attacks.length,
      attacks,
      elapsedMs: 0,
      durationMs: attacks.reduce((latest, attack) => Math.max(latest, attack.attackTimeMs), 0),
      resolvedCount: 0,
      shieldCracked: false,
      shieldCrackAttackId: null,
      shieldCrackImpactAtMs: null,
      shieldCrackClearAtMs: null,
      failed: false
    };
  }

  function beginCombatDefense() {
    if (!state.activeMonster || (state.monsterHp ?? 0) <= 0) {
      beginCombatVictory();
      return;
    }
    const round = state.combatDefenseRound;
    if (!round || round.attacks.length === 0) {
      beginCombatDefenseSuccess();
      return;
    }
    round.elapsedMs = 0;
    round.vortexFlashSerial = round.initialRandomDelayMs <= 0 ? 1 : 0;
    state.eventPhaseElapsedMs = 0;
    state.eventPhaseDurationMs = 0;
    state.mode = 'COMBAT_DEFENSE';
    setFeedback(UI_TEXT.combatDefensePrompt, 'neutral');
  }

  function advanceCombatDefenseRound(deltaMs) {
    const round = state.combatDefenseRound;
    if (!round) return;
    const previousElapsedMs = round.elapsedMs;
    const elapsedMs = Math.min(round.durationMs, round.elapsedMs + Math.max(0, deltaMs));
    round.elapsedMs = elapsedMs;

    round.vortexFlashTimesMs.forEach((flashTimeMs) => {
      if (flashTimeMs > previousElapsedMs && flashTimeMs <= elapsedMs) {
        round.vortexFlashSerial += 1;
      }
    });

    round.attacks.forEach((attack, attackIndex) => {
      if (attack.status === 'scheduled' && elapsedMs >= attack.windowStartMs) {
        attack.status = 'active';
      }
      if (elapsedMs + 1e-6 < attack.attackTimeMs ||
          !['active', 'defended'].includes(attack.status)) return;

      if (attack.status === 'defended') {
        attack.status = 'blocked';
      } else {
        attack.status = 'missed';
        round.failed = true;
        const nextAttack = round.attacks[attackIndex + 1];
        round.shieldCracked = true;
        round.shieldCrackAttackId = attack.id;
        round.shieldCrackImpactAtMs = attack.attackTimeMs;
        // Keep the crack through the next vortex cue; restore the shield as its next
        // defense window opens, immediately before the shield lights up.
        // A final-shot crack has no clear time and remains until the defense round exits.
        round.shieldCrackClearAtMs = nextAttack ? nextAttack.windowStartMs : null;
      }
      state.combatDefenseImpactSerial += 1;
      round.resolvedCount += 1;
    });

    if (round.shieldCracked && round.shieldCrackClearAtMs !== null &&
        elapsedMs >= round.shieldCrackClearAtMs) {
      round.shieldCracked = false;
      round.shieldCrackAttackId = null;
      round.shieldCrackImpactAtMs = null;
      round.shieldCrackClearAtMs = null;
    }

    if (round.resolvedCount >= round.attacks.length) {
      if (round.failed) beginCombatDefenseFailure();
      else beginCombatDefenseSuccess();
    }
  }

  function beginRhythmMovement(round) {
    if (state.rhythmRound !== round || round.phase !== RHYTHM_PHASE.SPAWN_READY) return;
    round.phase = RHYTHM_PHASE.MOVING;
    round.readyElapsedMs = round.readyDurationMs;
    round.launchSerial = ++rhythmLaunchSerial;
    state.rhythmLaunchSerial = rhythmLaunchSerial;
  }

  function finishRhythmRound(round) {
    if (state.rhythmRound !== round) return;
    round.phase = RHYTHM_PHASE.FINISHED;
    if (state.mode === 'COMBAT_ATTACK') {
      finishCombatAttackRound(round);
      return;
    }
    round.respawnRemainingMs = GAME_CONFIG.rhythmRespawnDelayMs;
  }

  function advanceRhythm(deltaMs) {
    let remainingMs = Math.max(0, deltaMs);
    while (remainingMs > 1e-6 && (state.mode === 'CLIMBING' || state.mode === 'COMBAT_ATTACK') && state.rhythmRound) {
      const round = state.rhythmRound;
      if (round.phase === RHYTHM_PHASE.SPAWN_READY) {
        const untilLaunchMs = Math.max(0, round.readyDurationMs - round.readyElapsedMs);
        const elapsedMs = Math.min(remainingMs, untilLaunchMs);
        round.readyElapsedMs += elapsedMs;
        remainingMs -= elapsedMs;
        if (round.readyElapsedMs + 1e-6 >= round.readyDurationMs) {
          round.readyElapsedMs = round.readyDurationMs;
          beginRhythmMovement(round);
          continue;
        }
        break;
      }

      if (round.phase === RHYTHM_PHASE.FINISHED) {
        const elapsedMs = Math.min(remainingMs, round.respawnRemainingMs);
        round.respawnRemainingMs = Math.max(0, round.respawnRemainingMs - elapsedMs);
        remainingMs -= elapsedMs;
        if (round.respawnRemainingMs <= 1e-6) {
          startNextRhythmRound();
          continue;
        }
        break;
      }

      const durationMs = rhythmRoundDurationMs(round);
      const untilFinishMs = Math.max(0, durationMs - round.elapsedMs);
      if (round.phase === RHYTHM_PHASE.RESOLVED) {
        const elapsedMs = Math.min(remainingMs, untilFinishMs);
        round.elapsedMs += elapsedMs;
        remainingMs -= elapsedMs;
        if (round.elapsedMs + 1e-6 >= durationMs) {
          round.elapsedMs = durationMs;
          finishRhythmRound(round);
          continue;
        }
        break;
      }

      if (round.phase !== RHYTHM_PHASE.MOVING) {
        finishRhythmRound(round);
        continue;
      }

      const nextTargetIndex = round.resolvedHits.findIndex((result) => result === null);
      if (nextTargetIndex < 0) {
        finishRhythmTargets(round);
        continue;
      }
      round.inputIndex = nextTargetIndex;
      const window = rhythmWindowForIndex(round, currentHitZoneWidth(), nextTargetIndex);
      const untilMissMs = window ? Math.max(0, window.endMs - round.elapsedMs) : Infinity;
      const nextBoundaryMs = Math.min(untilMissMs, untilFinishMs);
      if (remainingMs + 1e-6 < nextBoundaryMs) {
        round.elapsedMs += remainingMs;
        remainingMs = 0;
        break;
      }

      round.elapsedMs += nextBoundaryMs;
      remainingMs = Math.max(0, remainingMs - nextBoundaryMs);
      if (window && round.elapsedMs + 1e-6 >= window.endMs) {
        expireRhythmTarget(round, nextTargetIndex);
      }
      if (round.elapsedMs + 1e-6 >= durationMs) {
        round.elapsedMs = durationMs;
        while (round.phase === RHYTHM_PHASE.MOVING) {
          const openIndex = round.resolvedHits.findIndex((result) => result === null);
          if (openIndex < 0) {
            finishRhythmTargets(round);
            break;
          }
          expireRhythmTarget(round, openIndex);
        }
        finishRhythmRound(round);
        continue;
      }
      if (remainingMs <= 1e-6) break;
    }
    return remainingMs;
  }

  function advanceAutomaticClimb(deltaMs, exactDistance = null) {
    const previousProgress = state.progress;
    const integrated = integrateClimbSpeed(state.climbSpeed, deltaMs / 1000);
    state.climbSpeed = Math.max(GAME_CONFIG.minClimbSpeed, integrated.speed);
    const boostedMs = Math.min(deltaMs, state.temporarySpeedBonusRemainingMs);
    const distance = exactDistance ?? integrated.distance +
      (state.temporarySpeedBonusRemainingMs > 0
        ? state.temporarySpeedBonus * boostedMs / 1000
        : 0);
    state.temporarySpeedBonusRemainingMs = Math.max(0, state.temporarySpeedBonusRemainingMs - deltaMs);
    if (state.temporarySpeedBonusRemainingMs <= 0) state.temporarySpeedBonus = 0;
    state.progress = Math.min(GAME_CONFIG.maxFloor, previousProgress + distance);
    state.stepPhase = (state.stepPhase + distance / GAME_CONFIG.stepCycleDistanceFloors) % 1;
    advanceRhythm(deltaMs);
    consumeDebuffDistance(state, state.progress - previousProgress);
  }

  function setFeedback(message, kind = 'neutral') {
    state.feedback = { message, kind, untilMs: state.timerMs + GAME_CONFIG.feedbackDurationMs };
  }

  function clearStairTurn() {
    state.isLandingPaused = false;
    state.landingPauseDurationMs = 0;
    state.landingPauseRemainingMs = 0;
    state.isTurning = false;
    state.turnDurationMs = 0;
    state.turnRemainingMs = 0;
    state.turnTransitionMode = null;
    state.turnFromMode = null;
    state.turnFromProgress = null;
    state.turnTargetMode = null;
    state.turnTargetProgress = null;
    state.turnTargetSegmentIndex = null;
  }

  function commitStairNode(node) {
    state.stairViewMode = node.viewMode;
    state.stairNodeProgress = node.nodeProgress;
    state.stairSegmentIndex = node.segmentIndex;
    clearStairTurn();
  }

  function syncStairNode(progress, animate = true) {
    const target = stairNodeAt(progress);
    if (target.viewMode === state.stairViewMode && target.nodeProgress !== state.stairNodeProgress) {
      // Knockback may skip to a lower floor that reuses the same camera angle.
      state.stairNodeProgress = target.nodeProgress;
      state.stairSegmentIndex = target.segmentIndex;
      clearStairTurn();
      return true;
    }
    const alreadyAtTarget = target.viewMode === state.stairViewMode &&
      target.nodeProgress === state.stairNodeProgress;

    if (alreadyAtTarget) {
      state.stairSegmentIndex = target.segmentIndex;
      if (state.isTurning || state.isLandingPaused) clearStairTurn();
      return false;
    }

    if (!animate) {
      commitStairNode(target);
      return true;
    }

    const transitionDurations = platformTransitionDurationsForSpeed(state.climbSpeed, state.maxClimbSpeed);
    state.isLandingPaused = true;
    state.landingPauseDurationMs = transitionDurations.pauseMs;
    state.landingPauseRemainingMs = transitionDurations.pauseMs;
    state.turnFromMode = state.stairViewMode;
    state.turnFromProgress = state.stairNodeProgress;
    state.turnTargetMode = target.viewMode;
    state.turnTargetProgress = target.nodeProgress;
    state.turnTargetSegmentIndex = target.segmentIndex;
    state.turnDurationMs = transitionDurations.turnMs;
    setFeedback(UI_TEXT.platformPauseFeedback, 'turn');
    return true;
  }

  function beginStairTurn() {
    if (!state.isLandingPaused || !state.turnTargetMode) return;
    // Freeze the selected style when animation starts; a pause-menu change
    // during the turn only affects the next platform.
    state.turnTransitionMode = state.antiDizzinessMode;
    state.isLandingPaused = false;
    state.landingPauseRemainingMs = 0;
    state.isTurning = true;
    state.turnRemainingMs = state.turnDurationMs;
    setFeedback(UI_TEXT.turnFeedback, 'turn');
  }

  function finishStairTurn() {
    if (!state.isTurning || !state.turnTargetMode) return;
    state.stairViewMode = state.turnTargetMode;
    state.stairNodeProgress = state.turnTargetProgress;
    state.stairSegmentIndex = state.turnTargetSegmentIndex;
    clearStairTurn();
    setFeedback(UI_TEXT.turnFeedback, 'turn');
    startPendingMonsterEvent();
  }

  function startPendingMonsterEvent() {
    const event = state.pendingMonsterEvent;
    if (!event) return false;
    state.pendingMonsterEvent = null;
    beginMonsterEvent(event);
    return true;
  }

  function finishGame() {
    state.progress = GAME_CONFIG.maxFloor;
    state.mode = 'RESULT';
    state.activeQte = null;
    state.preparedQte = null;
    state.activeMonster = null;
    state.activeMonsterEvent = null;
    state.monsterHp = null;
    state.monsterMaxHp = null;
    state.combatDefenseRound = null;
    state.combatRapidTap = null;
    state.combatPendingDamage = 0;
    state.monsterDebuffApplied = false;
    state.eventPhaseElapsedMs = 0;
    state.eventPhaseDurationMs = 0;
    state.feedback = null;
    if (state.bestTimeMs === null || state.timerMs < state.bestTimeMs) {
      state.bestTimeMs = state.timerMs;
      state.bestUpdated = true;
      try { storage?.setItem(GAME_CONFIG.bestRecordStorageKey, String(Math.round(state.timerMs))); } catch { /* Local storage can be disabled. */ }
    }
  }

  function resolveSolution(solution) {
    const effectResult = applySolutionEffect(state, solution);
    if (effectResult.debuffCured) state.debuffCureSerial += 1;
    state.stats.qteWins += 1;
    state.activeQte = null;
    state.preparedQte = null;
    state.monsterDebuffApplied = false;
    state.eventPhaseElapsedMs = 0;
    state.eventPhaseDurationMs = 0;
    state.rhythmTapSerial = rhythmTapSerial;
    state.rhythmFeedbackSerial = rhythmFeedbackSerial;
    state.rhythmLaunchSerial = rhythmLaunchSerial;
    lastRhythmInputTimerMs = -Infinity;

    if (effectResult.debuffCured && state.activeMonster) {
      state.combatDefenseRound = null;
      state.combatPendingDamage = 0;
      beginCombatAttackIntro();
      setFeedback(effectResult.message, effectResult.kind);
      return;
    }

    state.activeMonster = null;
    state.activeMonsterEvent = null;
    state.monsterHp = null;
    state.monsterMaxHp = null;
    state.combatDefenseRound = null;
    state.combatRapidTap = null;
    state.mode = 'CLIMBING';
    startNextRhythmRound();
    setFeedback(effectResult.message, effectResult.kind);
  }

  function resolveQteFailure() {
    const monster = state.activeQte?.monster;
    if (!monster) return;
    state.stats.qteLosses += 1;
    // The monster's cast already applied its debuff before the QTE preview.
    // Keep the existing failure knockback/combo rules without applying it twice.
    knockBack(state, monster.failureKnockback, state.monsterDebuffApplied ? null : monster.failureDebuff);
    syncStairNode(state.progress);
    state.activeQte = null;
    state.preparedQte = null;
    state.activeMonster = null;
    state.activeMonsterEvent = null;
    state.monsterHp = null;
    state.monsterMaxHp = null;
    state.combatDefenseRound = null;
    state.combatRapidTap = null;
    state.monsterDebuffApplied = false;
    state.eventPhaseElapsedMs = 0;
    state.eventPhaseDurationMs = 0;
    state.mode = 'CLIMBING';
    startNextRhythmRound();
    const debuffName = monster.failureDebuff ? GAME_CONFIG.debuffs[monster.failureDebuff.type]?.name : '';
    const detail = monster.failureDebuff ? ' · 留下' + debuffName : '';
    setFeedback(UI_TEXT.knockback.replace('{floors}', String(monster.failureKnockback)) + detail, 'danger');
  }

  function beginCombatAttackIntro() {
    if (!state.activeMonster || (state.monsterHp ?? 0) <= 0) {
      beginCombatVictory();
      return;
    }
    state.rhythmRound = null;
    state.combatDefenseRound = null;
    state.combatRapidTap = null;
    enterMonsterPhase('COMBAT_ATTACK_INTRO', GAME_CONFIG.combatRoundIntroDurationMs);
  }

  function beginCombatAttack() {
    if (!state.activeMonster || (state.monsterHp ?? 0) <= 0) return;
    state.combatDefenseRound = null;
    state.combatRapidTap = null;
    state.combatPendingDamage = 0;
    state.eventPhaseElapsedMs = 0;
    state.eventPhaseDurationMs = 0;
    state.mode = 'COMBAT_ATTACK';
    startNextRhythmRound();
  }

  function beginCombatDefenseIntro() {
    if (!state.activeMonster || (state.monsterHp ?? 0) <= 0) {
      beginCombatVictory();
      return;
    }
    state.rhythmRound = null;
    state.combatRapidTap = null;
    state.combatDefenseRound = createCombatDefenseRound();
    enterMonsterPhase('COMBAT_DEFENSE_INTRO', GAME_CONFIG.combatDefenseVortexChargeDurationMs);
  }

  function beginCombatDefenseSuccess() {
    enterMonsterPhase('COMBAT_DEFENSE_SUCCESS', GAME_CONFIG.combatDefenseResultDurationMs);
    setFeedback(UI_TEXT.combatDefenseSuccess, 'success');
  }

  function beginCombatDefenseFailure() {
    if (!state.activeMonster) return;
    enterMonsterPhase('COMBAT_DEFENSE_FAILED', GAME_CONFIG.combatDefenseResultDurationMs);
    setFeedback(UI_TEXT.combatDefenseFailure, 'neutral');
  }

  function beginCombatVictory() {
    const event = state.activeMonsterEvent;
    if (state.activeMonster && (state.monsterHp ?? 1) <= 0 && event && !event.defeatRewardGranted) {
      event.defeatRewardGranted = true;
      state.maxClimbSpeed += GAME_CONFIG.monsterDefeatMaxSpeedBonus;
      state.climbSpeed = Math.min(
        state.maxClimbSpeed,
        state.climbSpeed + GAME_CONFIG.monsterDefeatSpeedBonus
      );
    }
    state.combatDefenseRound = null;
    state.rhythmRound = null;
    state.combatRapidTap = null;
    enterMonsterPhase('COMBAT_VICTORY', GAME_CONFIG.combatMonsterDeathDurationMs);
    setFeedback(UI_TEXT.combatMonsterDefeated, 'success');
  }

  function finishMonsterCombat() {
    const event = state.activeMonsterEvent;
    if (event) event.defeated = true;
    state.activeMonster = null;
    state.monsterHp = null;
    state.monsterMaxHp = null;
    state.combatDefenseRound = null;
    state.combatRapidTap = null;
    state.combatPendingDamage = 0;
    state.eventPhaseElapsedMs = 0;
    state.eventPhaseDurationMs = 0;
    state.activeQte = null;
    state.preparedQte = null;
    state.rhythmRound = null;

    if (event && !event.upgradeRewardGranted) {
      event.upgradeRewardGranted = true;
      state.upgradeChoices = drawUpgradeChoices();
      state.mode = 'UPGRADE_SELECT';
      setFeedback('選擇一項強化', 'success');
      return;
    }

    state.activeMonsterEvent = null;
    state.upgradeChoices = [];
    state.mode = 'CLIMBING';
    startNextRhythmRound();
    setFeedback(UI_TEXT.combatMonsterDefeated, 'success');
  }

  function chooseUpgrade(cardId) {
    if (state.mode !== 'UPGRADE_SELECT' || !state.upgradeChoices.includes(cardId)) return false;
    if (cardId === 'base-attack') {
      state.runUpgrades.baseAttackDamage += GAME_CONFIG.upgradeBaseAttackBonus;
    } else if (cardId === 'rapid-tap-attack') {
      state.runUpgrades.rapidTapDamage += GAME_CONFIG.upgradeRapidTapDamageBonus;
    } else if (cardId === 'rhythm-precision') {
      state.runUpgrades.rhythmJudgmentLevel += 1;
    } else {
      return false;
    }

    state.upgradeChoices = [];
    state.activeMonsterEvent = null;
    state.mode = 'CLIMBING';
    startNextRhythmRound();
    previousFrameTime = null;
    const card = UPGRADE_CARDS.find((candidate) => candidate.id === cardId);
    setFeedback((card?.name ?? '強化') + '已生效', 'success');
    notify();
    return true;
  }

  function advanceCombatPhase() {
    switch (state.mode) {
      case 'COMBAT_ATTACK_INTRO': beginCombatAttack(); break;
      case 'COMBAT_ATTACK_SETTLE':
        applyPendingCombatDamage();
        if ((state.monsterHp ?? 0) <= 0) beginCombatVictory();
        else beginCombatDefenseIntro();
        break;
      case 'COMBAT_DEFENSE_INTRO': beginCombatDefense(); break;
      case 'COMBAT_DEFENSE_SUCCESS':
      case 'COMBAT_DEFENSE_FAILED': beginCombatAttackIntro(); break;
      case 'COMBAT_VICTORY': finishMonsterCombat(); break;
      default: break;
    }
  }

  function beginMonsterEvent(event) {
    clearTemporarySpeedBonus();
    event.triggered = true;
    state.activeMonsterEvent = event;
    state.activeMonster = chooseMonster(random, options.monsters);
    const monsterOrder = Math.max(1, Number.isFinite(event.id)
      ? event.id
      : state.monsterEvents.indexOf(event) + 1);
    state.monsterMaxHp = GAME_CONFIG.monsterBaseHp + (monsterOrder - 1) * GAME_CONFIG.monsterHpIncrement;
    state.monsterHp = Math.min(state.monsterMaxHp, Math.max(0, state.activeMonster.initialHp ?? state.monsterMaxHp));
    state.combatDefenseRound = null;
    state.combatRapidTap = null;
    state.combatPendingDamage = 0;
    state.activeQte = null;
    state.preparedQte = createQte(
      state.activeMonster,
      random,
      state.activeMonster.qteDurationMs ?? GAME_CONFIG.monsterQteDurationMs
    );
    state.preparedQte.monsterHp = state.monsterHp;
    state.preparedQte.monsterMaxHp = state.monsterMaxHp;
    state.monsterDebuffApplied = false;
    state.rhythmRound = null;
    state.eventPhaseElapsedMs = 0;
    state.eventPhaseDurationMs = GAME_CONFIG.monsterWarningFlashCount * GAME_CONFIG.monsterWarningFlashDurationMs +
      Math.max(0, GAME_CONFIG.monsterWarningFlashCount - 1) * GAME_CONFIG.monsterWarningGapDurationMs;
    state.mode = 'EVENT_WARNING';
  }

  function beginMonsterEntrance() {
    if (!state.activeMonster) return;
    enterMonsterPhase('MONSTER_ENTRANCE', GAME_CONFIG.monsterEntranceDurationMs);
  }

  function enterMonsterPhase(mode, durationMs) {
    state.eventPhaseElapsedMs = 0;
    state.eventPhaseDurationMs = Math.max(0, durationMs);
    state.mode = mode;
  }

  function beginMonsterCast() {
    if (!state.activeMonster) return;
    enterMonsterPhase('MONSTER_CAST', GAME_CONFIG.monsterCastDurationMs);
  }

  function beginMonsterImpact() {
    if (!state.activeMonster) return;
    state.monsterImpactSerial += 1;
    enterMonsterPhase('MONSTER_IMPACT', GAME_CONFIG.monsterImpactEffectDurationMs);
  }

  function beginAttackToDebuffDelay() {
    if (!state.activeMonster) return;
    enterMonsterPhase('ATTACK_TO_DEBUFF_DELAY', GAME_CONFIG.monsterAttackToDebuffDelayMs);
  }

  function beginMonsterDebuffReveal() {
    if (!state.activeMonster) return;
    const appliedDebuff = applyDebuff(state, state.activeMonster.failureDebuff);
    state.monsterDebuffApplied = Boolean(appliedDebuff);
    enterMonsterPhase('DEBUFF_REVEAL', GAME_CONFIG.monsterDebuffRevealDurationMs);
  }

  function beginDebuffToAnswerDelay() {
    if (!state.activeMonster) return;
    enterMonsterPhase('DEBUFF_TO_ANSWER_DELAY', GAME_CONFIG.monsterDebuffToAnswerDelayMs);
  }

  function beginMonsterAnswerPreviewDisplay() {
    if (!state.activeMonster) return;
    enterMonsterPhase('ANSWER_PREVIEW', GAME_CONFIG.monsterAnswerPreviewDurationMs);
  }

  function advanceMonsterEventPhase() {
    switch (state.mode) {
      case 'EVENT_WARNING': beginMonsterEntrance(); break;
      case 'MONSTER_ENTRANCE': beginMonsterCast(); break;
      case 'MONSTER_CAST': beginMonsterImpact(); break;
      case 'MONSTER_IMPACT': beginAttackToDebuffDelay(); break;
      case 'ATTACK_TO_DEBUFF_DELAY': beginMonsterDebuffReveal(); break;
      case 'DEBUFF_REVEAL': beginDebuffToAnswerDelay(); break;
      case 'DEBUFF_TO_ANSWER_DELAY': beginMonsterAnswerPreviewDisplay(); break;
      case 'ANSWER_PREVIEW': beginMonsterQte(); break;
      default: break;
    }
  }

  function beginMonsterQte() {
    if (!state.activeMonster || !state.preparedQte) return;
    // The QTE letters are prepared before the answer preview, but become
    // interactive only when the preview phase has fully elapsed.
    state.activeQte = state.preparedQte;
    state.preparedQte = null;
    state.eventPhaseElapsedMs = 0;
    state.eventPhaseDurationMs = 0;
    state.mode = 'MONSTER_QTE';
  }

  function start(timestamp = globalThis.performance?.now?.()) {
    const bestTimeMs = state.bestTimeMs;
    const antiDizzinessMode = state.antiDizzinessMode;
    state = freshState(bestTimeMs, antiDizzinessMode);
    state.monsterEvents = scheduleMonsterEvents(random, options.eventRanges ?? GAME_CONFIG.monsterEventFloors);
    state.mode = 'CLIMBING';
    state.rhythmTapSerial = rhythmTapSerial;
    state.rhythmFeedbackSerial = rhythmFeedbackSerial;
    state.rhythmLaunchSerial = rhythmLaunchSerial;
    lastRhythmInputTimerMs = -Infinity;
    startNextRhythmRound();
    previousFrameTime = Number.isFinite(timestamp) ? timestamp : null;
    notify();
  }

  function tryDefendCentralShield() {
    if (state.mode !== 'COMBAT_DEFENSE' || !state.combatDefenseRound) return { status: 'ignored' };
    const nowMs = state.combatDefenseRound.elapsedMs;
    const attack = state.combatDefenseRound.attacks.find((shot) => shot.status === 'active' &&
      nowMs >= shot.windowStartMs && nowMs < shot.attackTimeMs);
    if (!attack) return { status: 'ignored' };
    attack.status = 'defended';
    notify();
    return { status: 'defended', attackId: attack.id };
  }

  function pressCombatRapidTap() {
    const rapidTap = state.combatRapidTap;
    if (!rapidTap || rapidTap.disabled || rapidTap.prepareRemainingMs > 0 ||
        rapidTap.elapsedMs >= rapidTap.durationMs) return { status: 'ignored' };
    rapidTap.tapCount += 1;
    state.rhythmTapSerial = ++rhythmTapSerial;
    setFeedback('連打 ×' + rapidTap.tapCount, 'hit');
    notify();
    return { status: 'tap', tapCount: rapidTap.tapCount };
  }

  function pressRhythm(timestamp = globalThis.performance?.now?.()) {
    const modeBeforeUpdate = state.mode;
    const roundBeforeUpdate = state.rhythmRound;
    if (previousFrameTime !== null && Number.isFinite(timestamp)) update(timestamp);
    if (state.mode !== modeBeforeUpdate) return { status: 'ignored' };

    if (modeBeforeUpdate === 'COMBAT_DEFENSE') return tryDefendCentralShield();
    if (modeBeforeUpdate === 'COMBAT_RAPID_TAP') return pressCombatRapidTap();
    if (modeBeforeUpdate !== 'CLIMBING' && modeBeforeUpdate !== 'COMBAT_ATTACK') return { status: 'ignored' };
    // A press that advances the old ball to its endpoint must not spill into
    // the newly spawned ball, even if a long frame also consumed its ready beat.
    if (state.rhythmRound !== roundBeforeUpdate) return { status: 'ignored' };
    const round = state.rhythmRound;
    if (!round || round.phase !== RHYTHM_PHASE.MOVING) return { status: 'ignored' };
    if (round.inputLocked) return { status: 'ignored' };
    if (round.pressCount >= round.hitBeats.length) {
      round.inputLocked = true;
      setFeedback('本輪按鍵額度已用完', 'neutral');
      notify();
      return { status: 'locked', pressCount: round.pressCount, pressLimit: round.hitBeats.length };
    }
    if (state.timerMs - lastRhythmInputTimerMs < GAME_CONFIG.rhythmInputDebounceMs) {
      return { status: 'debounced' };
    }
    lastRhythmInputTimerMs = state.timerMs;
    round.pressCount += 1;
    state.rhythmTapSerial = ++rhythmTapSerial;
    const wasInWindow = isBallInZone();
    if (wasInWindow) {
      resolveRhythmTarget(round, round.inputIndex);
    } else {
      round.failedPressCount = (round.failedPressCount ?? 0) + 1;
      applyRhythmMiss(round);
      setFeedback(state.mode === 'COMBAT_ATTACK' ? '攻擊拍點失誤' : UI_TEXT.miss, 'miss');
      triggerRhythmFeedback('miss');
    }
    notify();
    return {
      status: wasInWindow ? (round.phase === RHYTHM_PHASE.RESOLVED && round.resolvedKind === 'hit' ? 'hit' : 'progress') : 'miss',
      inputIndex: round.inputIndex,
      totalInputs: round.hitBeats.length,
      successCount: round.successCount,
      pressCount: round.pressCount,
      pressLimit: round.hitBeats.length
    };
  }

  function pressQteLetter(tileId, timestamp = globalThis.performance?.now?.()) {
    if (state.mode === 'MONSTER_QTE' && previousFrameTime !== null && Number.isFinite(timestamp)) {
      update(timestamp);
    }
    if (state.mode !== 'MONSTER_QTE' || !state.activeQte) return { status: 'ignored' };
    const result = clickQteTile(state.activeQte, tileId);
    if (result.status === 'reset') state.activeQte.message = UI_TEXT.qteWrong;
    else if (result.status === 'progress') state.activeQte.message = '';
    else if (result.status === 'complete') resolveSolution(result.solution);
    notify();
    return result;
  }

  function pressCombatShield(shieldId = 'central', timestamp = globalThis.performance?.now?.()) {
    if (state.mode !== 'COMBAT_DEFENSE' || shieldId !== 'central') return { status: 'ignored' };
    if (previousFrameTime !== null && Number.isFinite(timestamp)) update(timestamp);
    return tryDefendCentralShield();
  }

  function pause(timestamp = globalThis.performance?.now?.()) {
    if (PAUSABLE_MODES.has(state.mode) &&
        previousFrameTime !== null && Number.isFinite(timestamp)) {
      update(timestamp);
    }
    if (!PAUSABLE_MODES.has(state.mode)) return false;
    state.resumeMode = state.mode;
    state.mode = 'PAUSED';
    previousFrameTime = null;
    notify();
    return true;
  }

  function resume() {
    if (state.mode !== 'PAUSED') return false;
    state.mode = state.resumeMode ?? 'CLIMBING';
    state.resumeMode = null;
    previousFrameTime = null;
    notify();
    return true;
  }

  function setAntiDizzinessMode(mode) {
    if (mode !== ANTI_DIZZINESS_MODE.ON && mode !== ANTI_DIZZINESS_MODE.OFF) return false;
    if (state.antiDizzinessMode === mode) return true;
    state.antiDizzinessMode = mode;
    try { storage?.setItem(GAME_CONFIG.antiDizzinessStorageKey, mode); } catch { /* Local storage can be disabled. */ }
    notify();
    return true;
  }

  function update(timestamp) {
    const now = Number.isFinite(timestamp) ? timestamp : 0;
    if (previousFrameTime === null) {
      previousFrameTime = now;
      return;
    }
    const deltaMs = Math.max(0, now - previousFrameTime);
    previousFrameTime = now;
    if (state.mode !== 'CLIMBING' && state.mode !== 'MONSTER_QTE' &&
        !MONSTER_EVENT_PHASES.has(state.mode) && !COMBAT_MODES.has(state.mode)) return;

    let remainingMs = deltaMs;
    while (remainingMs > 1e-6) {
      if (MONSTER_EVENT_PHASES.has(state.mode)) {
        const durationMs = Math.max(0, state.eventPhaseDurationMs);
        const untilPhaseEndMs = Math.max(0, durationMs - state.eventPhaseElapsedMs);
        const elapsedMs = Math.min(remainingMs, untilPhaseEndMs);
        state.timerMs += elapsedMs;
        state.eventPhaseElapsedMs += elapsedMs;
        remainingMs -= elapsedMs;
        if (state.eventPhaseElapsedMs + 1e-6 >= durationMs) {
          advanceMonsterEventPhase();
          continue;
        }
        break;
      }

      if (COMBAT_TIMED_PHASES.has(state.mode)) {
        const durationMs = Math.max(0, state.eventPhaseDurationMs);
        const untilPhaseEndMs = Math.max(0, durationMs - state.eventPhaseElapsedMs);
        const elapsedMs = Math.min(remainingMs, untilPhaseEndMs);
        state.timerMs += elapsedMs;
        state.eventPhaseElapsedMs += elapsedMs;
        remainingMs -= elapsedMs;
        if (state.eventPhaseElapsedMs + 1e-6 >= durationMs) {
          advanceCombatPhase();
          continue;
        }
        break;
      }

      if (state.mode === 'MONSTER_QTE') {
        if (!state.activeQte) break;
        const elapsedMs = Math.min(remainingMs, state.activeQte.remainingMs);
        state.timerMs += elapsedMs;
        state.activeQte.remainingMs = Math.max(0, state.activeQte.remainingMs - elapsedMs);
        remainingMs -= elapsedMs;
        if (state.activeQte.remainingMs <= 0) resolveQteFailure();
        continue;
      }
      if (state.mode === 'COMBAT_DEFENSE') {
        const round = state.combatDefenseRound;
        if (!round) break;
        const elapsedMs = Math.min(remainingMs, Math.max(0, round.durationMs - round.elapsedMs));
        state.timerMs += elapsedMs;
        remainingMs -= elapsedMs;
        advanceCombatDefenseRound(elapsedMs);
        if (state.mode !== 'COMBAT_DEFENSE') continue;
        break;
      }
      if (state.mode === 'COMBAT_RAPID_TAP') {
        const beforeMs = remainingMs;
        remainingMs = advanceCombatRapidTap(remainingMs);
        state.timerMs += beforeMs - remainingMs;
        if (state.mode !== 'COMBAT_RAPID_TAP' && remainingMs > 1e-6) continue;
        break;
      }
      if (state.mode === 'COMBAT_ATTACK') {
        const beforeMs = remainingMs;
        remainingMs = advanceRhythm(remainingMs);
        state.timerMs += beforeMs - remainingMs;
        if (state.mode !== 'COMBAT_ATTACK' && remainingMs > 1e-6) continue;
        remainingMs = 0;
        continue;
      }
      if (state.mode !== 'CLIMBING') break;

      if (state.isLandingPaused) {
        const elapsedMs = Math.min(remainingMs, state.landingPauseRemainingMs);
        state.timerMs += elapsedMs;
        advanceRhythm(elapsedMs);
        state.landingPauseRemainingMs = Math.max(0, state.landingPauseRemainingMs - elapsedMs);
        remainingMs -= elapsedMs;
        if (state.landingPauseRemainingMs <= 0) beginStairTurn();
        continue;
      }

      if (state.isTurning) {
        const elapsedMs = Math.min(remainingMs, state.turnRemainingMs);
        state.timerMs += elapsedMs;
        advanceRhythm(elapsedMs);
        state.turnRemainingMs = Math.max(0, state.turnRemainingMs - elapsedMs);
        remainingMs -= elapsedMs;
        if (state.turnRemainingMs <= 0) finishStairTurn();
        continue;
      }

      if (state.progress >= GAME_CONFIG.maxFloor - 1e-8) {
        state.progress = GAME_CONFIG.maxFloor;
        state.pendingMonsterEvent = null;
        syncStairNode(state.progress, false);
        finishGame();
        break;
      }

      const previousProgress = state.progress;
      const nextNodeProgress = stairNodeAt(previousProgress).nextNodeProgress;
      const nextMonsterEvent = state.monsterEvents
        .filter((event) => !event.triggered && event.floor > previousProgress + 1e-8)
        .sort((first, second) => first.floor - second.floor)[0] ?? null;
      const nextRhythmOrb = nextRhythmOrbAfter(previousProgress);
      const debuffEndProgress = state.debuff && state.debuff.remainingFloors > 1e-8
        ? previousProgress + state.debuff.remainingFloors
        : Infinity;
      const boundary = Math.min(
        GAME_CONFIG.maxFloor,
        nextNodeProgress,
        nextMonsterEvent?.floor ?? Infinity,
        nextRhythmOrb?.floor ?? Infinity,
        debuffEndProgress
      );
      const distanceToBoundary = Math.max(0, boundary - previousProgress);
      const boundaryTimeMs = timeToClimbDistance(
        distanceToBoundary,
        state.climbSpeed,
        state.temporarySpeedBonus,
        state.temporarySpeedBonusRemainingMs / 1000
      ) * 1000;
      const reachesBoundary = boundaryTimeMs <= remainingMs + 1e-6;
      const elapsedMs = reachesBoundary ? Math.max(0, boundaryTimeMs) : remainingMs;
      if (elapsedMs <= 1e-6) {
        if (state.debuff && state.debuff.remainingFloors <= 1e-8) {
          state.debuff = null;
          continue;
        }
        break;
      }

      state.timerMs += elapsedMs;
      advanceAutomaticClimb(elapsedMs, reachesBoundary ? distanceToBoundary : null);
      remainingMs = Math.max(0, remainingMs - elapsedMs);

      if (!reachesBoundary) continue;
      state.progress = boundary;
      const crossedEvent = firstCrossedMonsterEvent(previousProgress, boundary, state.monsterEvents);
      if (crossedEvent) {
        crossedEvent.triggered = true;
        state.pendingMonsterEvent = crossedEvent;
      }
      if (nextRhythmOrb && Math.abs(boundary - nextRhythmOrb.floor) <= 1e-8) {
        collectRhythmOrb(nextRhythmOrb);
      }

      if (boundary >= GAME_CONFIG.maxFloor - 1e-8) {
        state.progress = GAME_CONFIG.maxFloor;
        state.pendingMonsterEvent = null;
        syncStairNode(state.progress, false);
        finishGame();
        break;
      }

      if (Math.abs(boundary - nextNodeProgress) <= 1e-8) {
        state.stepPhase = 0;
        syncStairNode(boundary);
      }
      if (!state.isLandingPaused && !state.isTurning) startPendingMonsterEvent();
    }

    if (state.feedback && state.timerMs >= state.feedback.untilMs) state.feedback = null;
    if (state.rhythmOrbFeedback && state.timerMs >= state.rhythmOrbFeedback.toastUntilMs) {
      state.rhythmOrbFeedback = null;
    }
    notify();
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(state);
    return () => listeners.delete(listener);
  }

  return {
    getState: () => state,
    getEffectiveClimbSpeed: effectiveClimbSpeed,
    getBallPosition: currentBallPosition,
    getHitZoneWidth: currentHitZoneWidth,
    getRhythmHitWindows: () => rhythmHitWindows(state.rhythmRound, currentHitZoneWidth()),
    isBallInZone,
    start,
    pressRhythm,
    pressQteLetter,
    pressCombatShield,
    chooseUpgrade,
    pause,
    resume,
    setAntiDizzinessMode,
    update,
    subscribe
  };
}
