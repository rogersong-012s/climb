import { ANTI_DIZZINESS_MODE, GAME_CONFIG, UI_TEXT } from './config.js';
import { hitZoneWidthForCombo } from './combo.js';
import { applyHit, applyMiss, knockBack } from './climbing.js';
import { scheduleMonsterEvents, firstCrossedMonsterEvent } from './events.js';
import { applySolutionEffect, consumeDebuffDistance } from './effects.js';
import { chooseMonster } from './monsters.js';
import { clickQteTile, createQte } from './qte.js';
import { createRhythmRound, currentRhythmWindow, isCurrentRhythmHit, rhythmHitWindows, rhythmRoundProgress } from './rhythm.js';
import { stairNodeAt } from './stairs.js';

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
  const listeners = new Set();

  function notify() {
    listeners.forEach((listener) => listener(state));
  }

  function currentBallPosition() {
    return rhythmRoundProgress(state.rhythmRound);
  }

  function currentHitZoneWidth() {
    return hitZoneWidthForCombo(state.combo, state.debuff?.type ?? null);
  }

  function rhythmBeatDurationForCurrentDebuff() {
    const speedMultiplier = state.debuff?.type === 'SORE'
      ? GAME_CONFIG.debuffs.SORE.speedMultiplier
      : 1;
    return GAME_CONFIG.rhythmBeatDurationMs / speedMultiplier;
  }

  function isBallInZone() {
    return isCurrentRhythmHit(state.rhythmRound, currentHitZoneWidth());
  }

  function startNextRhythmRound() {
    state.rhythmRoundSerial += 1;
    state.rhythmRound = createRhythmRound(random, state.rhythmRoundSerial, rhythmBeatDurationForCurrentDebuff());
  }

  function triggerRhythmFeedback(kind) {
    state.rhythmFeedbackSerial = ++rhythmFeedbackSerial;
    state.rhythmFeedbackKind = kind;
  }

  function failRhythmRound() {
    if (!state.rhythmRound) return;
    applyMiss(state);
    setFeedback(UI_TEXT.miss, 'miss');
    triggerRhythmFeedback('miss');
    startNextRhythmRound();
  }

  function completeRhythmRound() {
    const result = applyHit(state);
    setFeedback(UI_TEXT.hit, 'hit');
    triggerRhythmFeedback('hit');
    startNextRhythmRound();
    return result;
  }

  function advanceRhythm(deltaMs) {
    let remainingMs = Math.max(0, deltaMs);
    while (remainingMs > 1e-6 && state.mode === 'CLIMBING' && state.rhythmRound) {
      const window = currentRhythmWindow(state.rhythmRound, currentHitZoneWidth());
      if (!window) {
        startNextRhythmRound();
        continue;
      }
      const untilMissMs = Math.max(0, window.endMs - state.rhythmRound.elapsedMs);
      if (remainingMs <= untilMissMs) {
        state.rhythmRound.elapsedMs += remainingMs;
        remainingMs = 0;
        break;
      }
      state.rhythmRound.elapsedMs += untilMissMs;
      remainingMs -= untilMissMs;
      failRhythmRound();
    }
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
    state.feedback = null;
    if (state.bestTimeMs === null || state.timerMs < state.bestTimeMs) {
      state.bestTimeMs = state.timerMs;
      state.bestUpdated = true;
      try { storage?.setItem(GAME_CONFIG.bestRecordStorageKey, String(Math.round(state.timerMs))); } catch { /* Local storage can be disabled. */ }
    }
  }

  function resolveSolution(solution) {
    const effectResult = applySolutionEffect(state, solution);
    state.stats.qteWins += 1;
    state.activeQte = null;
    state.mode = 'CLIMBING';
    state.rhythmTapSerial = rhythmTapSerial;
    state.rhythmFeedbackSerial = rhythmFeedbackSerial;
    startNextRhythmRound();
    setFeedback(effectResult.message, effectResult.kind);
  }

  function resolveQteFailure() {
    const monster = state.activeQte?.monster;
    if (!monster) return;
    state.stats.qteLosses += 1;
    knockBack(state, monster.failureKnockback, monster.failureDebuff);
    syncStairNode(state.progress);
    state.activeQte = null;
    state.mode = 'CLIMBING';
    startNextRhythmRound();
    const debuffName = monster.failureDebuff ? GAME_CONFIG.debuffs[monster.failureDebuff.type]?.name : '';
    const detail = monster.failureDebuff ? ' · 留下' + debuffName : '';
    setFeedback(UI_TEXT.knockback.replace('{floors}', String(monster.failureKnockback)) + detail, 'danger');
  }

  function beginMonsterEvent(event) {
    event.triggered = true;
    const monster = chooseMonster(random, options.monsters);
    state.activeQte = createQte(monster, random, monster.qteDurationMs ?? GAME_CONFIG.monsterQteDurationMs);
    state.rhythmRound = null;
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
    startNextRhythmRound();
    previousFrameTime = Number.isFinite(timestamp) ? timestamp : null;
    notify();
  }

  function pressRhythm(timestamp = globalThis.performance?.now?.()) {
    if (state.mode !== 'CLIMBING') return { status: 'ignored' };
    state.rhythmTapSerial = ++rhythmTapSerial;
    const previousFeedbackSerial = state.rhythmFeedbackSerial;
    if (state.mode === 'CLIMBING' && previousFrameTime !== null && Number.isFinite(timestamp)) {
      update(timestamp);
    }
    if (state.mode !== 'CLIMBING') return { status: 'ignored' };
    if (state.rhythmFeedbackSerial !== previousFeedbackSerial && state.rhythmFeedbackKind === 'miss') {
      return { status: 'missed-window' };
    }
    const round = state.rhythmRound;
    if (!round) return { status: 'ignored' };
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
    else if (result.status === 'complete') {
      resolveSolution(result.solution);
    }
    notify();
    return result;
  }

  function pause(timestamp = globalThis.performance?.now?.()) {
    if ((state.mode === 'CLIMBING' || state.mode === 'MONSTER_QTE') &&
        previousFrameTime !== null && Number.isFinite(timestamp)) {
      update(timestamp);
    }
    if (state.mode !== 'CLIMBING' && state.mode !== 'MONSTER_QTE') return false;
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
    if (state.mode !== 'CLIMBING' && state.mode !== 'MONSTER_QTE') return;

    let remainingMs = deltaMs;
    while (remainingMs > 1e-6) {
      if (state.mode === 'MONSTER_QTE') {
        if (!state.activeQte) break;
        const elapsedMs = Math.min(remainingMs, state.activeQte.remainingMs);
        state.timerMs += elapsedMs;
        state.activeQte.remainingMs = Math.max(0, state.activeQte.remainingMs - elapsedMs);
        remainingMs -= elapsedMs;
        if (state.activeQte.remainingMs <= 0) resolveQteFailure();
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
    pause,
    resume,
    setAntiDizzinessMode,
    update,
    subscribe
  };
}
