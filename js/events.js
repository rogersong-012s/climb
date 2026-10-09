import { GAME_CONFIG } from './config.js';

function randomIntInclusive(min, max, random = Math.random) {
  return Math.floor(random() * (max - min + 1)) + min;
}

export function scheduleMonsterEvents(random = Math.random, ranges = GAME_CONFIG.monsterEventFloors) {
  return ranges.map((range, index) => ({
    id: index + 1,
    floor: randomIntInclusive(range.min, range.max, random),
    triggered: false
  }));
}

export function firstCrossedMonsterEvent(previousProgress, nextProgress, events) {
  return events
    .filter((event) => !event.triggered && previousProgress < event.floor && nextProgress >= event.floor)
    .sort((a, b) => a.floor - b.floor)[0] ?? null;
}
