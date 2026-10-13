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
  readyDurationMs = beatDurationMs * GAME_CONFIG.rhythmPrepareBeats,
  unlockedTypeIds = ['RED', 'BLUE'],
  typeWeights = GAME_CONFIG.rhythmTypeWeights
) {
  const typeIds = [...new Set(unlockedTypeIds)]
    .filter((typeId) => Boolean(RHYTHM_TYPES[typeId]))
    .map((typeId) => ({ typeId, weight: Math.max(0, Number(typeWeights?.[typeId] ?? 1)) }))
    .filter((entry) => Number.isFinite(entry.weight) && entry.weight > 0);
  const pool = typeIds.length ? typeIds : ['RED', 'BLUE'].map((typeId) => ({ typeId, weight: 1 }));
  const totalWeight = pool.reduce((total, entry) => total + entry.weight, 0);
  let selection = Math.min(1 - Number.EPSILON, Math.max(0, random())) * totalWeight;
  let typeId = pool[pool.length - 1].typeId;
  for (const entry of pool) {
    selection -= entry.weight;
    if (selection < 0) {
      typeId = entry.typeId;
      break;
    }
  }
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
    pressCount: 0,
    inputLocked: false,
    inputIndex: 0,
    resolvedHits: type.hitBeats.map(() => null),
    successCount: 0,
    missApplied: false,
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
  return round.hitBeats.map((beat, index) => {
    const widthBeats = rhythmWindowWidthBeats(round, widthRatio, index);
    const result = round.resolvedHits?.[index];
    let status = 'upcoming';
    if (result === 'success') status = 'success';
    else if (result === 'missed') status = 'missed';
    else if (result === 'fail') status = 'fail';
    else if (round.inputLocked || round.pressCount >= round.hitBeats.length) status = 'locked';
    else if (round.phase === RHYTHM_PHASE.MOVING && index === round.inputIndex) status = 'current';
    else if (round.phase === RHYTHM_PHASE.SPAWN_READY) status = 'locked';
    return {
      beat,
      center: beat / round.totalBeats,
      width: widthBeats / round.totalBeats,
      status
    };
  });
}

export function rhythmWindowForIndex(round, widthRatio, index) {
  if (!round || round.phase !== RHYTHM_PHASE.MOVING) return null;
  const beat = round.hitBeats[index];
  if (beat === undefined) return null;
  const widthBeats = rhythmWindowWidthBeats(round, widthRatio, index);
  const beatDurationMs = round.beatDurationMs ?? GAME_CONFIG.rhythmBeatDurationMs;
  const centerMs = beat * beatDurationMs;
  const halfWindowMs = beatDurationMs * widthBeats / 2;
  return {
    beat,
    widthBeats,
    startMs: centerMs - halfWindowMs,
    centerMs,
    endMs: centerMs + halfWindowMs
  };
}

function rhythmWindowWidthBeats(round, widthRatio, index) {
  const beat = round.hitBeats[index];
  if (beat === undefined) return 0;
  const previousGap = index > 0 ? beat - round.hitBeats[index - 1] : Infinity;
  const nextGap = index + 1 < round.hitBeats.length
    ? round.hitBeats[index + 1] - beat
    : Infinity;
  const trackEdgeGap = Math.max(0, 2 * Math.min(beat, round.totalBeats - beat));
  // Keep adjacent visible and interactive windows in sync and non-overlapping.
  return Math.max(0, Math.min(widthRatio, previousGap * 0.9, nextGap * 0.9, trackEdgeGap));
}

export function currentRhythmWindow(round, widthRatio) {
  if (!round || round.phase !== RHYTHM_PHASE.MOVING) return null;
  return rhythmWindowForIndex(round, widthRatio, round.inputIndex);
}

export function isCurrentRhythmHit(round, widthRatio) {
  const window = currentRhythmWindow(round, widthRatio);
  return Boolean(window && round.elapsedMs >= window.startMs && round.elapsedMs <= window.endMs);
}
