import { GAME_CONFIG } from './config.js';

function legalPositionsForRange(range) {
  const fractions = GAME_CONFIG.monsterEventFractions;
  const positions = [];
  // Each five-floor band excludes its starting integer floor, but includes
  // candidates on the ending integer floor. The next band then starts after
  // that shared boundary, so no integer floor becomes the first candidate twice.
  const integerBoundaries = Number.isInteger(range.min) && Number.isInteger(range.max);
  const firstFloor = integerBoundaries ? range.min + 1 : Math.floor(range.min);
  const lastFloor = integerBoundaries ? range.max : Math.ceil(range.max) - 1;

  for (let floor = firstFloor; floor <= lastFloor; floor += 1) {
    for (const fraction of fractions) {
      const position = Number((floor + fraction).toFixed(1));
      const inRange = integerBoundaries
        ? floor <= range.max
        : position >= range.min && position < range.max;
      if (inRange && position < GAME_CONFIG.maxFloor) positions.push(position);
    }
  }

  // A zero-width custom range is useful for deterministic development fixtures:
  // treat its floor as the start of a five-floor interval while still selecting
  // one of the supported .2/.7 positions.
  if (positions.length === 0 && range.min === range.max) {
    return fractions
      .map((fraction) => Number((range.min + fraction).toFixed(1)))
      .filter((position) => position < GAME_CONFIG.maxFloor);
  }
  return positions;
}

export function scheduleMonsterEvents(random = Math.random, ranges = GAME_CONFIG.monsterEventFloors) {
  return ranges.map((range, index) => {
    const positions = legalPositionsForRange(range);
    const randomIndex = Math.min(positions.length - 1, Math.floor(random() * positions.length));
    return {
      id: index + 1,
      floor: positions[Math.max(0, randomIndex)],
      triggered: false,
      skipped: false,
      skipWindowUnlocked: false
    };
  }).filter((event) => Number.isFinite(event.floor));
}

export function firstCrossedMonsterEvent(previousProgress, nextProgress, events) {
  return events
    .filter((event) => !event.triggered && !event.skipped && previousProgress < event.floor && nextProgress >= event.floor)
    .sort((a, b) => a.floor - b.floor)[0] ?? null;
}
