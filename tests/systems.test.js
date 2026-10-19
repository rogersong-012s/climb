import test from 'node:test';
import assert from 'node:assert/strict';
import { GAME_CONFIG, MONSTER_EVENT_COUNT } from '../js/config.js';
import { climbDistanceForCombo, hitZoneWidthForCombo } from '../js/combo.js';
import { scheduleMonsterEvents, firstCrossedMonsterEvent } from '../js/events.js';
import { MONSTERS } from '../js/monsters.js';
import { clickQteTile, createQte } from '../js/qte.js';
import { applyDebuff, applySolutionEffect, consumeDebuffDistance } from '../js/effects.js';
import { createGame } from '../js/game.js';
import { formatStairProgress, stairNodeAt, stairSegmentProgress, STAIR_VIEW_MODE } from '../js/stairs.js';

test('combo climbing distance starts at 0.10F, adds 0.02F, and caps at 0.30F', () => {
  assert.equal(climbDistanceForCombo(0), 0.1);
  assert.equal(climbDistanceForCombo(1), 0.12);
  assert.equal(climbDistanceForCombo(9), 0.28);
  assert.equal(climbDistanceForCombo(10), 0.3);
  assert.equal(climbDistanceForCombo(80), 0.3);
});

test('stair nodes alternate between whole floors and half-floor landings', () => {
  assert.deepEqual(stairNodeAt(1), {
    floor: 1,
    nodeProgress: 1,
    nextNodeProgress: 1.5,
    segmentIndex: 0,
    viewMode: STAIR_VIEW_MODE.POINT_ZERO
  });
  assert.equal(stairNodeAt(1.4999999999).viewMode, STAIR_VIEW_MODE.POINT_FIVE);
  assert.equal(stairNodeAt(1.5).viewMode, STAIR_VIEW_MODE.POINT_FIVE);
  assert.equal(stairNodeAt(2).viewMode, STAIR_VIEW_MODE.POINT_ZERO);
  assert.equal(stairNodeAt(2).segmentIndex, 2);
  assert.equal(stairSegmentProgress(1.25, 1), 0.5);
  assert.equal(formatStairProgress(8), '8.0');
  assert.equal(formatStairProgress(8.5), '8.5');
  assert.equal(formatStairProgress(8.12), '8.12');
});

test('reaching a half-floor starts a short turn and commits the next stair view', () => {
  const game = createGame({ storage: null, eventRanges: [] });
  game.start();
  game.update(0);
  const state = game.getState();
  state.progress = 1.4;
  state.combo = 1;
  state.climbDistance = 0.12;
  state.travelCycles = 0.25;
  state.zoneArmed = true;

  assert.equal(game.pressRhythm().status, 'hit');
  assert.equal(state.progress, 1.4);
  assert.equal(state.isMoving, true);
  assert.equal(state.stairViewMode, STAIR_VIEW_MODE.POINT_ZERO);
  assert.equal(state.isTurning, false);
  assert.equal(game.pressRhythm().status, 'moving');

  game.update(GAME_CONFIG.climbMoveDurationMs - 1);
  assert.ok(state.progress < 1.52);
  assert.equal(state.isTurning, false);
  game.update(GAME_CONFIG.climbMoveDurationMs);
  assert.equal(state.progress, 1.52);
  assert.equal(state.isTurning, true);
  assert.equal(state.turnTargetMode, STAIR_VIEW_MODE.POINT_FIVE);
  assert.equal(state.turnTargetProgress, 1.5);
  assert.equal(game.pressRhythm().status, 'turning');

  game.update(GAME_CONFIG.climbMoveDurationMs + GAME_CONFIG.stairTurnDurationMs - 1);
  assert.equal(state.isTurning, true);
  game.update(GAME_CONFIG.climbMoveDurationMs + GAME_CONFIG.stairTurnDurationMs);
  assert.equal(state.isTurning, false);
  assert.equal(state.stairViewMode, STAIR_VIEW_MODE.POINT_FIVE);
  assert.equal(state.stairNodeProgress, 1.5);
  assert.equal(state.stairSegmentIndex, 1);
  assert.equal(state.travelCycles, 0.25);
});

test('knockback to another floor with the same view mode updates the node without a fake turn', () => {
  const game = createGame({ storage: null, eventRanges: [] });
  game.start();
  game.update(0);
  const state = game.getState();
  state.progress = 6.1;
  state.stairViewMode = STAIR_VIEW_MODE.POINT_ZERO;
  state.stairNodeProgress = 6;
  state.stairSegmentIndex = 10;
  state.mode = 'MONSTER_QTE';
  state.activeQte = {
    monster: { failureKnockback: 3, failureDebuff: null },
    remainingMs: 1,
    durationMs: 1
  };

  game.update(2);

  assert.ok(Math.abs(state.progress - 3.1) < 1e-9);
  assert.equal(state.stairViewMode, STAIR_VIEW_MODE.POINT_ZERO);
  assert.equal(state.stairNodeProgress, 3);
  assert.equal(state.stairSegmentIndex, 4);
  assert.equal(state.isTurning, false);
});

test('hit zone shrinks symmetrically by width and never crosses its configured floor', () => {
  assert.equal(hitZoneWidthForCombo(0), 0.3);
  assert.equal(hitZoneWidthForCombo(12), 0.18);
  assert.equal(hitZoneWidthForCombo(30), GAME_CONFIG.minHitZoneWidth);
  assert.equal(hitZoneWidthForCombo(30, 'OBESITY'), GAME_CONFIG.minHitZoneWidth);
  assert.equal(hitZoneWidthForCombo(5, 'BLUR'), 0.25);
});

test('each configured range schedules one random monster floor within its inclusive bounds', () => {
  const events = scheduleMonsterEvents(() => 0.5);
  assert.equal(events.length, MONSTER_EVENT_COUNT);
  events.forEach((event, index) => {
    const range = GAME_CONFIG.monsterEventFloors[index];
    assert.ok(event.floor >= range.min && event.floor <= range.max);
    assert.equal(event.triggered, false);
  });
});

test('crossing an event floor is detected once, including a single hit that crosses the threshold', () => {
  const event = { id: 1, floor: 6, triggered: false };
  assert.equal(firstCrossedMonsterEvent(5.8, 6.05, [event]), event);
  event.triggered = true;
  assert.equal(firstCrossedMonsterEvent(5.8, 6.05, [event]), null);
});

test('QTE supports different solution lengths, repeated letters, and stable tile positions after a wrong input', () => {
  const monster = {
    name: '測試怪',
    qteDurationMs: 6000,
    solutions: [
      { word: 'ABBA', description: '長解法', effect: 'NONE' },
      { word: 'DOG', description: '短解法', effect: 'NONE' }
    ]
  };
  const qte = createQte(monster, () => 0.37);
  assert.ok(qte.tiles.length >= 8 && qte.tiles.length <= 12);
  for (const letter of 'ABBA') assert.ok(qte.tiles.some((tile) => tile.letter === letter));
  const original = qte.tiles.map((tile) => tile.id + ':' + tile.letter);
  const firstA = qte.tiles.find((tile) => tile.letter === 'A');
  assert.equal(clickQteTile(qte, firstA.id).status, 'progress');
  const wrong = qte.tiles.find((tile) => tile.visible && tile.letter !== 'B');
  assert.equal(clickQteTile(qte, wrong.id).status, 'reset');
  assert.deepEqual(qte.tiles.map((tile) => tile.id + ':' + tile.letter), original);
  assert.ok(qte.tiles.every((tile) => tile.visible));

  for (const letter of 'ABBA') {
    const tile = qte.tiles.find((candidate) => candidate.visible && candidate.letter === letter);
    clickQteTile(qte, tile.id);
  }
  assert.equal(qte.input, 'ABBA');
});

test('QTE data includes the current monster roster and data-driven solution lengths', () => {
  assert.deepEqual(MONSTERS.map((monster) => monster.id), ['muscle', 'eyes', 'pain', 'obese']);
  assert.ok(MONSTERS.some((monster) => monster.solutions.some((solution) => solution.word === 'YSS+2')));
  assert.ok(MONSTERS.some((monster) => monster.solutions.some((solution) => solution.word === 'DIET')));
  assert.ok(MONSTERS.every((monster) => monster.solutions.some((solution) => solution.effect === 'CURE')));
});

test('debuff duration decreases only with upward climb and expires at zero', () => {
  const state = { debuff: null };
  applyDebuff(state, { type: 'SORE', durationFloors: 2 });
  assert.equal(consumeDebuffDistance(state, 0.75), false);
  assert.equal(state.debuff.remainingFloors, 1.25);
  assert.equal(consumeDebuffDistance(state, 1.25), true);
  assert.equal(state.debuff, null);
});

test('QTE cure, attack and apply-debuff effects replace or clear the current status', () => {
  const state = { debuff: null };
  applySolutionEffect(state, { effect: 'APPLY_DEBUFF', debuff: { type: 'BLUR', durationFloors: 3 } });
  assert.equal(state.debuff.type, 'BLUR');
  applySolutionEffect(state, { effect: 'PAN_ATTACK', debuff: { type: 'SORE', durationFloors: 5 } });
  assert.equal(state.debuff.type, 'SORE');
  applySolutionEffect(state, { effect: 'CURE', debuffType: 'SORE' });
  assert.equal(state.debuff, null);
});

test('rhythm ball advances by elapsed time, HIT consumes a crossing once, and MISS resets combo', () => {
  const game = createGame({ storage: null, random: () => 0.5 });
  game.start();
  game.update(0);
  game.update(GAME_CONFIG.ballRoundTripMs / 4);
  const ballBefore = game.getBallPosition();
  assert.ok(game.isBallInZone(ballBefore));
  assert.equal(game.pressRhythm().status, 'hit');
  assert.equal(game.getState().progress, 1);
  assert.equal(game.getState().isMoving, true);
  assert.equal(game.getState().climbDistance, 0.12);
  const cyclesAfterHit = game.getState().travelCycles;
  assert.equal(game.pressRhythm().status, 'moving');
  assert.equal(game.getState().travelCycles, cyclesAfterHit);
  game.update(GAME_CONFIG.ballRoundTripMs / 4 + GAME_CONFIG.climbMoveDurationMs);
  assert.equal(game.getState().progress, 1.1);
  assert.equal(game.getState().travelCycles, cyclesAfterHit);
  game.update(GAME_CONFIG.ballRoundTripMs / 4 + GAME_CONFIG.climbMoveDurationMs + 200);
  assert.ok(game.getState().zoneArmed);
  assert.equal(game.pressRhythm().status, 'miss');
  assert.equal(game.getState().combo, 0);
  assert.equal(game.getState().climbDistance, GAME_CONFIG.baseClimbDistance);
});

test('pause/resume excludes paused time while active frames continue the timer and rhythm ball', () => {
  const game = createGame({ storage: null });
  game.start();
  game.update(0);
  game.update(250);
  const cycles = game.getState().travelCycles;
  game.pause();
  game.update(10000);
  assert.equal(game.getState().timerMs, 250);
  assert.equal(game.getState().travelCycles, cycles);
  game.resume();
  game.update(20000);
  game.update(20200);
  assert.equal(game.getState().timerMs, 450);
  assert.ok(game.getState().travelCycles > cycles);
});

test('SORE slows the ball without resetting its current phase', () => {
  const game = createGame({ storage: null });
  game.start();
  game.update(0);
  game.update(500);
  const cycles = game.getState().travelCycles;
  game.getState().debuff = { type: 'SORE', remainingFloors: 5, totalFloors: 5 };
  game.update(1500);
  assert.equal(game.getState().travelCycles - cycles, 0.36);
});

test('restarting clears transient run state but keeps the saved best time', () => {
  const saved = new Map([[GAME_CONFIG.bestRecordStorageKey, '12345']]);
  const storage = {
    getItem(key) { return saved.get(key) ?? null; },
    setItem(key, value) { saved.set(key, value); }
  };
  const game = createGame({ storage });
  game.start();
  const firstRun = game.getState();
  firstRun.combo = 9;
  firstRun.progress = 42;
  firstRun.debuff = { type: 'BLUR', remainingFloors: 3, totalFloors: 4 };
  game.start();
  const nextRun = game.getState();
  assert.equal(nextRun.progress, GAME_CONFIG.startFloor);
  assert.equal(nextRun.combo, 0);
  assert.equal(nextRun.climbDistance, GAME_CONFIG.baseClimbDistance);
  assert.equal(nextRun.debuff, null);
  assert.equal(nextRun.timerMs, 0);
  assert.equal(nextRun.monsterEvents.length, MONSTER_EVENT_COUNT);
  assert.equal(nextRun.bestTimeMs, 12345);
});

function driveGameUntil(game, timestampRef, targetMode, frameLimit = 16000) {
  for (let frame = 0; frame < frameLimit; frame += 1) {
    timestampRef.value += 20;
    game.update(timestampRef.value);
    const state = game.getState();
    if (state.mode === targetMode) return frame;
    if (state.mode === 'CLIMBING' && game.isBallInZone() && state.zoneArmed) {
      game.pressRhythm();
      if (game.getState().mode === targetMode) return frame;
    }
  }
  return -1;
}

function solveFirstAvailableSolution(game) {
  const qte = game.getState().activeQte;
  const solution = qte.monster.solutions[0];
  for (const letter of solution.word) {
    const tile = qte.tiles.find((candidate) => candidate.visible && candidate.letter === letter);
    assert.ok(tile, 'letter tile exists for ' + letter);
    game.pressQteLetter(tile.id);
  }
}

test('crossing a monster floor freezes the ball, successful QTE preserves combo, and resets the ball at the left', () => {
  const game = createGame({
    storage: null,
    random: () => 0,
    eventRanges: [{ min: 2, max: 2 }]
  });
  const timestamp = { value: 0 };
  game.start();
  game.update(timestamp.value);
  assert.notEqual(driveGameUntil(game, timestamp, 'MONSTER_QTE'), -1);
  const state = game.getState();
  const comboBefore = state.combo;
  const progressBefore = state.progress;
  const ballBefore = state.travelCycles;
  const timeBefore = state.timerMs;
  const qteTimeBefore = state.activeQte.remainingMs;
  game.pause();
  timestamp.value += 2000;
  game.update(timestamp.value);
  assert.equal(state.timerMs, timeBefore);
  assert.equal(state.activeQte.remainingMs, qteTimeBefore);
  game.resume();
  timestamp.value += 100;
  game.update(timestamp.value);
  timestamp.value += 100;
  game.update(timestamp.value);
  assert.equal(state.activeQte.remainingMs, qteTimeBefore - 100);
  assert.equal(state.monsterEvents[0].triggered, true);
  timestamp.value += 1000;
  game.update(timestamp.value);
  assert.equal(state.travelCycles, ballBefore);
  assert.equal(state.progress, progressBefore);
  solveFirstAvailableSolution(game);
  assert.equal(state.mode, 'CLIMBING');
  assert.equal(state.combo, comboBefore);
  assert.equal(state.stats.qteWins, 1);
  assert.equal(game.getBallPosition(), 0);
});

test('QTE timeout applies knockback without dropping below 1F, resets combo, and applies the monster debuff', () => {
  const game = createGame({
    storage: null,
    random: () => 0,
    eventRanges: [{ min: 2, max: 2 }]
  });
  const timestamp = { value: 0 };
  game.start();
  game.update(timestamp.value);
  assert.notEqual(driveGameUntil(game, timestamp, 'MONSTER_QTE'), -1);
  const state = game.getState();
  assert.ok(state.progress > 2);
  timestamp.value += GAME_CONFIG.monsterQteDurationMs + 1;
  game.update(timestamp.value);
  assert.equal(state.mode, 'CLIMBING');
  assert.equal(state.progress, GAME_CONFIG.startFloor);
  assert.equal(state.combo, 0);
  assert.equal(state.stats.qteLosses, 1);
  assert.deepEqual(state.debuff, { type: 'SORE', remainingFloors: 5, totalFloors: 5 });
  assert.equal(state.monsterEvents[0].triggered, true);
});

test('full deterministic climb completes ten monster events and records a win at 101F', () => {
  const saved = new Map();
  const storage = {
    getItem(key) { return saved.get(key) ?? null; },
    setItem(key, value) { saved.set(key, value); }
  };
  const game = createGame({ storage, random: () => 0 });
  const timestamp = { value: 0 };
  game.start();
  game.update(timestamp.value);

  for (let frame = 0; frame < 80000 && game.getState().mode !== 'RESULT'; frame += 1) {
    timestamp.value += 20;
    game.update(timestamp.value);
    const state = game.getState();
    if (state.mode === 'CLIMBING' && game.isBallInZone() && state.zoneArmed) game.pressRhythm();
    else if (state.mode === 'MONSTER_QTE') solveFirstAvailableSolution(game);
  }

  const state = game.getState();
  assert.equal(state.mode, 'RESULT');
  assert.equal(state.progress, GAME_CONFIG.maxFloor);
  assert.equal(state.monsterEvents.length, MONSTER_EVENT_COUNT);
  assert.equal(state.monsterEvents.filter((event) => event.triggered).length, MONSTER_EVENT_COUNT);
  assert.equal(state.stats.qteWins, MONSTER_EVENT_COUNT);
  assert.equal(state.stats.qteLosses, 0);
  assert.ok(state.stats.hits > 100);
  assert.equal(Number(saved.get(GAME_CONFIG.bestRecordStorageKey)), Math.round(state.timerMs));
});
