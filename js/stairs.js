import { GAME_CONFIG } from './config.js';

const NODE_EPSILON = 1e-8;
const STAIR_FLIGHT_DISTANCE = 0.5;

export const STAIR_VIEW_MODE = Object.freeze({
  POINT_ZERO: 'POINT_ZERO',
  POINT_FIVE: 'POINT_FIVE'
});

export function stairNodeAt(progress) {
  const boundedProgress = Math.max(
    GAME_CONFIG.startFloor,
    Math.min(GAME_CONFIG.maxFloor, progress)
  );
  const floor = Math.floor(boundedProgress + NODE_EPSILON);
  const fraction = boundedProgress - floor;
  const pointFive = fraction >= 0.5 - NODE_EPSILON;
  const viewMode = pointFive ? STAIR_VIEW_MODE.POINT_FIVE : STAIR_VIEW_MODE.POINT_ZERO;
  const nodeProgress = floor + (pointFive ? STAIR_FLIGHT_DISTANCE : 0);

  return {
    floor: Math.floor(nodeProgress),
    nodeProgress,
    nextNodeProgress: Math.min(GAME_CONFIG.maxFloor, nodeProgress + STAIR_FLIGHT_DISTANCE),
    segmentIndex: Math.round((nodeProgress - GAME_CONFIG.startFloor) / STAIR_FLIGHT_DISTANCE),
    viewMode
  };
}

export function stairSegmentProgress(progress, nodeProgress) {
  const ratio = (progress - nodeProgress) / STAIR_FLIGHT_DISTANCE;
  return Math.max(0, Math.min(1, ratio));
}

export function formatStairProgress(progress) {
  const rounded = Math.round((progress + Number.EPSILON) * 100) / 100;
  return Number.isInteger(rounded) ? rounded.toFixed(1) : String(rounded);
}
