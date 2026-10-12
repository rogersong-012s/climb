import { GAME_CONFIG, RHYTHM_TYPES } from './config.js';

export const RHYTHM_PHASE = Object.freeze({
  SPAWN_READY: 'SPAWN_READY',
  MOVING: 'MOVING',
  RESOLVED: 'RESOLVED',
  FINISHED: 'FINISHED'
});

export function createRhythmRound(
  random = Math.random,
  id = 0,
  beatDurationMs = GAME_CONFIG.rhythmBeatDurationMs,
  readyDurationMs = beatDurationMs * GAME_CONFIG.rhythmPrepareBeats
) {
  const typeIds = Object.keys(RHYTHM_TYPES);
  const pickedIndex = Math.min(typeIds.length - 1, Math.floor(random() * typeIds.length));
  const typeId = typeIds[Math.max(0, pickedIndex)];
  const type = RHYTHM_TYPES[typeId];
  return {
    id,
    typeId,
    label: type.label,
    color: type.color,
    totalBeats: type.totalBeats,
    hitBeats: [...type.hitBeats],
    beatDurationMs,
    readyDurationMs,
    readyElapsedMs: 0,
    elapsedMs: 0,
    respawnRemainingMs: 0,
    inputIndex: 0,
    phase: RHYTHM_PHASE.SPAWN_READY,
    resolvedKind: null,
    launchSerial: null
  };
}

export function rhythmRoundDurationMs(round) {
  return round ? round.totalBeats * (round.beatDurationMs ?? GAME_CONFIG.rhythmBeatDurationMs) : 0;
}

export function rhythmRoundProgress(round) {
  if (!round || round.phase === RHYTHM_PHASE.SPAWN_READY) return 0;
  return Math.max(0, Math.min(1, round.elapsedMs / rhythmRoundDurationMs(round)));
}

export function rhythmHitWindows(round, widthRatio) {
  if (!round) return [];
  return round.hitBeats.map((beat, index) => ({
    beat,
    center: beat / round.totalBeats,
    width: widthRatio / round.totalBeats,
    status: index < round.inputIndex
      ? 'complete'
      : round.phase === RHYTHM_PHASE.MOVING && index === round.inputIndex
        ? 'current'
        : round.phase === RHYTHM_PHASE.SPAWN_READY
          ? 'locked'
          : 'upcoming'
  }));
}

export function currentRhythmWindow(round, widthRatio) {
  if (!round || round.phase !== RHYTHM_PHASE.MOVING) return null;
  const beat = round.hitBeats[round.inputIndex];
  if (beat === undefined) return null;
  const beatDurationMs = round.beatDurationMs ?? GAME_CONFIG.rhythmBeatDurationMs;
  const halfWindowMs = beatDurationMs * widthRatio / 2;
  const centerMs = beat * beatDurationMs;
  return {
    beat,
    startMs: centerMs - halfWindowMs,
    centerMs,
    endMs: centerMs + halfWindowMs
  };
}

export function isCurrentRhythmHit(round, widthRatio) {
  const window = currentRhythmWindow(round, widthRatio);
  return Boolean(window && round.elapsedMs >= window.startMs && round.elapsedMs <= window.endMs);
}
