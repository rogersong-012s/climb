import { GAME_CONFIG, RHYTHM_TYPES } from './config.js';

export function createRhythmRound(random = Math.random, id = 0, beatDurationMs = GAME_CONFIG.rhythmBeatDurationMs) {
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
    elapsedMs: 0,
    inputIndex: 0
  };
}

export function rhythmRoundDurationMs(round) {
  return round ? round.totalBeats * (round.beatDurationMs ?? GAME_CONFIG.rhythmBeatDurationMs) : 0;
}

export function rhythmRoundProgress(round) {
  if (!round) return 0;
  const movingElapsed = Math.max(0, round.elapsedMs - GAME_CONFIG.rhythmStartDelayMs);
  return Math.max(0, Math.min(1, movingElapsed / rhythmRoundDurationMs(round)));
}

export function rhythmHitWindows(round, widthRatio) {
  if (!round) return [];
  return round.hitBeats.map((beat, index) => ({
    beat,
    center: beat / round.totalBeats,
    width: widthRatio / round.totalBeats,
    status: index < round.inputIndex ? 'complete' : index === round.inputIndex ? 'current' : 'upcoming'
  }));
}

export function currentRhythmWindow(round, widthRatio) {
  if (!round) return null;
  const beat = round.hitBeats[round.inputIndex];
  if (beat === undefined) return null;
  const beatDurationMs = round.beatDurationMs ?? GAME_CONFIG.rhythmBeatDurationMs;
  const halfWindowMs = beatDurationMs * widthRatio / 2;
  const centerMs = GAME_CONFIG.rhythmStartDelayMs + beat * beatDurationMs;
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
