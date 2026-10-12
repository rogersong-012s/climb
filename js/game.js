import { ANTI_DIZZINESS_MODE, GAME_CONFIG, UI_TEXT } from './config.js';
import { hitZoneWidthForCombo } from './combo.js';
import { applyHit, applyMiss, knockBack } from './climbing.js';
import { scheduleMonsterEvents, firstCrossedMonsterEvent } from './events.js';
import { applyDebuff, applySolutionEffect, consumeDebuffDistance } from './effects.js';
import { chooseMonster } from './monsters.js';
import { clickQteTile, createQte } from './qte.js';
import { createRhythmRound, currentRhythmWindow, isCurrentRhythmHit, rhythmHitWindows, rhythmRoundDurationMs, rhythmRoundProgress, RHYTHM_PHASE } from './rhythm.js';
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
const PAUSABLE_MODES = new Set(['CLIMBING', ...MONSTER_EVENT_PHASES, 'MONSTER_QTE', ...COMBAT_MODES]);

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
    stepPhase: 0,
    pendingMonsterEvent: null,
    activeMonsterEvent: null,
    activeMonster: null,
    monsterHp: null,
    monsterMaxHp: null,
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

function timeToClimbDistance(distance, speed) {
  if (distance <= 0) return 0;
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

function platformTransitionDurationsForSpeed(speed) {
  const referenceSpeed = GAME_CONFIG.turnReferenceSpeed;
  const safeSpeed = Math.min(
    GAME_CONFIG.maxClimbSpeed,
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
  const listeners = new Set();

  function notify() {
    listeners.forEach((listener) => listener(state));
  }

  function currentBallPosition() {
    return rhythmRoundProgress(state.rhythmRound);
  }

  function currentHitZoneWidth() {
    const effectiveMode = state.mode === 'PAUSED' ? state.resumeMode : state.mode;
    if (effectiveMode === 'COMBAT_ATTACK') return hitZoneWidthForCombo(0, null);
    return hitZoneWidthForCombo(state.combo, state.debuff?.type ?? null);
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
      rhythmPrepareDurationForCurrentDebuff()
    );
  }

  function triggerRhythmFeedback(kind) {
    state.rhythmFeedbackSerial = ++rhythmFeedbackSerial;
    state.rhythmFeedbackKind = kind;
  }

  function failRhythmRound() {
    const round = state.rhythmRound;
    if (!round || round.phase !== RHYTHM_PHASE.MOVING) return;
    if (state.mode === 'COMBAT_ATTACK') setFeedback(UI_TEXT.combatAttackMiss, 'miss');
    else {
      applyMiss(state);
      setFeedback(UI_TEXT.miss, 'miss');
    }
    round.phase = RHYTHM_PHASE.RESOLVED;
    round.resolvedKind = 'miss';
    triggerRhythmFeedback('miss');
  }

  function completeRhythmRound() {
    const round = state.rhythmRound;
    if (!round || round.phase !== RHYTHM_PHASE.MOVING) return null;
    let result = null;
    if (state.mode === 'COMBAT_ATTACK') {
      setFeedback(UI_TEXT.combatAttackHit, 'hit');
    } else {
      result = applyHit(state);
      setFeedback(UI_TEXT.hit, 'hit');
    }
    round.phase = RHYTHM_PHASE.RESOLVED;
    round.resolvedKind = 'hit';
    triggerRhythmFeedback('hit');
    return result;
  }

  function applyPendingCombatDamage() {
    if (state.combatPendingDamage <= 0) return;
    const currentHp = state.monsterHp ?? state.monsterMaxHp ?? GAME_CONFIG.monsterMaxHp;
    state.monsterHp = Math.max(0, currentHp - state.combatPendingDamage);
    state.combatPendingDamage = 0;
  }

  function finishCombatAttackRound(round) {
    state.rhythmRound = null;
    if (round.resolvedKind === 'hit') beginCombatRapidTap();
    else beginCombatDefenseIntro();
  }

  function beginCombatRapidTap() {
    if (!state.activeMonster || (state.monsterHp ?? 0) <= 0) {
      beginCombatVictory();
      return;
    }
    state.rhythmRound = null;
    state.combatRapidTap = {
      prepareRemainingMs: GAME_CONFIG.combatRapidTapPrepareDelayMs,
      elapsedMs: 0,
      durationMs: GAME_CONFIG.combatRapidTapDurationMs / GAME_CONFIG.rhythmMoveSpeedMultiplier,
      tapCount: 0
    };
    state.mode = 'COMBAT_RAPID_TAP';
    setFeedback(UI_TEXT.combatRapidTapPrompt, 'hit');
  }

  function finishCombatRapidTap() {
    const rapidTap = state.combatRapidTap;
    if (!rapidTap || state.mode !== 'COMBAT_RAPID_TAP') return;
    const damage = GAME_CONFIG.combatRapidTapBaseDamage +
      rapidTap.tapCount * GAME_CONFIG.combatRapidTapDamageMultiplier;
    state.combatRapidTap = null;
    state.combatPendingDamage = damage;
    setFeedback('DMG ' + damage, 'hit');
    enterMonsterPhase('COMBAT_ATTACK_SETTLE', GAME_CONFIG.combatPlayerAttackDurationMs);
  }

  function advanceCombatRapidTap(deltaMs) {
    const rapidTap = state.combatRapidTap;
    if (!rapidTap || state.mode !== 'COMBAT_RAPID_TAP') return Math.max(0, deltaMs);
    let remainingMs = Math.max(0, deltaMs);
    if (rapidTap.prepareRemainingMs > 0) {
      const preparedMs = Math.min(remainingMs, rapidTap.prepareRemainingMs);
      rapidTap.prepareRemainingMs -= preparedMs;
      remainingMs -= preparedMs;
    }
    if (rapidTap.prepareRemainingMs <= 1e-6 && remainingMs > 0) {
      const movingMs = Math.min(remainingMs, Math.max(0, rapidTap.durationMs - rapidTap.elapsedMs));
      rapidTap.elapsedMs += movingMs;
      remainingMs -= movingMs;
      if (rapidTap.elapsedMs + 1e-6 >= rapidTap.durationMs) {
        rapidTap.elapsedMs = rapidTap.durationMs;
        finishCombatRapidTap();
      }
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

    round.attacks.forEach((attack) => {
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
      }
      state.combatDefenseImpactSerial += 1;
      round.resolvedCount += 1;
    });

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

      const window = currentRhythmWindow(round, currentHitZoneWidth());
      const untilMissMs = window ? Math.max(0, window.endMs - round.elapsedMs) : Infinity;
      if (window && untilMissMs < untilFinishMs - 1e-6 && remainingMs > untilMissMs + 1e-6) {
        round.elapsedMs += untilMissMs;
        remainingMs -= untilMissMs;
        failRhythmRound();
        continue;
      }
      if (remainingMs < untilFinishMs - 1e-6) {
        round.elapsedMs += remainingMs;
        remainingMs = 0;
        break;
      }

      round.elapsedMs = durationMs;
      remainingMs = Math.max(0, remainingMs - untilFinishMs);
      if (round.phase === RHYTHM_PHASE.MOVING) failRhythmRound();
      finishRhythmRound(round);
    }
    return remainingMs;
  }

  function advanceAutomaticClimb(deltaMs, exactDistance = null) {
    const previousProgress = state.progress;
    const integrated = integrateClimbSpeed(state.climbSpeed, deltaMs / 1000);
    state.climbSpeed = Math.max(GAME_CONFIG.minClimbSpeed, integrated.speed);
    const distance = exactDistance ?? integrated.distance;
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

    const transitionDurations = platformTransitionDurationsForSpeed(state.climbSpeed);
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
    state.combatDefenseRound = null;
    state.rhythmRound = null;
    state.combatRapidTap = null;
    enterMonsterPhase('COMBAT_VICTORY', GAME_CONFIG.combatMonsterDeathDurationMs);
    setFeedback(UI_TEXT.combatMonsterDefeated, 'success');
  }

  function finishMonsterCombat() {
    if (state.activeMonsterEvent) state.activeMonsterEvent.defeated = true;
    state.activeMonster = null;
    state.activeMonsterEvent = null;
    state.monsterHp = null;
    state.monsterMaxHp = null;
    state.combatDefenseRound = null;
    state.combatRapidTap = null;
    state.combatPendingDamage = 0;
    state.eventPhaseElapsedMs = 0;
    state.eventPhaseDurationMs = 0;
    state.mode = 'CLIMBING';
    startNextRhythmRound();
    setFeedback(UI_TEXT.combatMonsterDefeated, 'success');
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
    event.triggered = true;
    state.activeMonsterEvent = event;
    state.activeMonster = chooseMonster(random, options.monsters);
    state.monsterMaxHp = Math.max(1, state.activeMonster.maxHp ?? GAME_CONFIG.monsterMaxHp);
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

  function pressRhythm(timestamp = globalThis.performance?.now?.()) {
    const modeBeforeUpdate = state.mode;
    const roundBeforeUpdate = state.rhythmRound;
    const rapidTapBeforeUpdate = state.combatRapidTap;
    const previousFeedbackSerial = state.rhythmFeedbackSerial;
    if (previousFrameTime !== null && Number.isFinite(timestamp)) update(timestamp);
    if (state.mode !== modeBeforeUpdate) return { status: 'ignored' };

    if (modeBeforeUpdate === 'COMBAT_DEFENSE') return tryDefendCentralShield();
    if (modeBeforeUpdate === 'COMBAT_RAPID_TAP') {
      const rapidTap = state.combatRapidTap;
      if (!rapidTap || rapidTap !== rapidTapBeforeUpdate || rapidTap.prepareRemainingMs > 1e-6 ||
          rapidTap.elapsedMs >= rapidTap.durationMs) return { status: 'ignored' };
      rapidTap.tapCount += 1;
      state.rhythmTapSerial = ++rhythmTapSerial;
      setFeedback('TAP × ' + rapidTap.tapCount, 'hit');
      notify();
      return { status: 'tapped', tapCount: rapidTap.tapCount };
    }
    if (modeBeforeUpdate !== 'CLIMBING' && modeBeforeUpdate !== 'COMBAT_ATTACK') return { status: 'ignored' };
    if (state.rhythmFeedbackSerial !== previousFeedbackSerial && state.rhythmFeedbackKind === 'miss') {
      return { status: 'missed-window' };
    }
    // A press that advances the old ball to its endpoint must not spill into
    // the newly spawned ball, even if a long frame also consumed its ready beat.
    if (state.rhythmRound !== roundBeforeUpdate) return { status: 'ignored' };
    const round = state.rhythmRound;
    if (!round || round.phase !== RHYTHM_PHASE.MOVING) return { status: 'ignored' };
    state.rhythmTapSerial = ++rhythmTapSerial;
    if (!isBallInZone()) {
      failRhythmRound();
      notify();
      return { status: 'miss' };
    }

    round.inputIndex += 1;
    if (round.inputIndex >= round.hitBeats.length) {
      const result = completeRhythmRound();
      notify();
      return { status: 'hit', ...result };
    }
    setFeedback('拍點 ' + round.inputIndex + '/' + round.hitBeats.length, 'neutral');
    notify();
    return { status: 'progress', inputIndex: round.inputIndex, totalInputs: round.hitBeats.length };
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
      const debuffEndProgress = state.debuff && state.debuff.remainingFloors > 1e-8
        ? previousProgress + state.debuff.remainingFloors
        : Infinity;
      const boundary = Math.min(
        GAME_CONFIG.maxFloor,
        nextNodeProgress,
        nextMonsterEvent?.floor ?? Infinity,
        debuffEndProgress
      );
      const distanceToBoundary = Math.max(0, boundary - previousProgress);
      const boundaryTimeMs = timeToClimbDistance(distanceToBoundary, state.climbSpeed) * 1000;
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
    notify();
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(state);
    return () => listeners.delete(listener);
  }

  return {
    getState: () => state,
    getBallPosition: currentBallPosition,
    getHitZoneWidth: currentHitZoneWidth,
    getRhythmHitWindows: () => rhythmHitWindows(state.rhythmRound, currentHitZoneWidth()),
    isBallInZone,
    start,
    pressRhythm,
    pressQteLetter,
    pressCombatShield,
    pause,
    resume,
    setAntiDizzinessMode,
    update,
    subscribe
  };
}
