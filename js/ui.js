import { ANTI_DIZZINESS_MODE, GAME_CONFIG, RHYTHM_TYPES, UI_TEXT, UPGRADE_CARDS } from './config.js';
import { formatStairProgress, stairSegmentProgress, STAIR_VIEW_MODE } from './stairs.js';
import { getActiveDebuffs } from './effects.js';
import { QTE_CONTEXT } from './qte.js';
import { RHYTHM_PHASE } from './rhythm.js';
import { loadAudioSettings } from './audio-settings.js';
import { QTE_ITEM_PRESENTATIONS } from './monsters.js';

function formatTime(milliseconds) {
  const totalCs = Math.floor(Math.max(0, milliseconds) / 10);
  const minutes = Math.floor(totalCs / 6000);
  const seconds = Math.floor((totalCs % 6000) / 100);
  const centiseconds = totalCs % 100;
  return String(minutes).padStart(2, '0') + ':' +
    String(seconds).padStart(2, '0') + '.' + String(centiseconds).padStart(2, '0');
}

function formatCombatNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(Number(numeric.toFixed(2))) : '0';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function eventWarningOpacity(state) {
  const flashDurationMs = GAME_CONFIG.monsterWarningFlashDurationMs;
  const gapDurationMs = GAME_CONFIG.monsterWarningGapDurationMs;
  const flashCount = GAME_CONFIG.monsterWarningFlashCount;
  const pulseIntervalMs = flashDurationMs + gapDurationMs;
  const elapsedMs = state.eventPhaseElapsedMs ?? 0;
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  const maxOpacity = reducedMotion
    ? GAME_CONFIG.monsterWarningReducedMotionOpacity
    : GAME_CONFIG.monsterWarningMaxOpacity;

  for (let pulse = 0; pulse < flashCount; pulse += 1) {
    const pulseElapsedMs = elapsedMs - pulse * pulseIntervalMs;
    if (pulseElapsedMs < 0 || pulseElapsedMs > flashDurationMs) continue;
    const progress = Math.min(1, pulseElapsedMs / flashDurationMs);
    return maxOpacity * Math.sin(Math.PI * progress) ** 2;
  }
  return 0;
}

function easeTurn(value) {
  const t = Math.max(0, Math.min(1, value));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function turnOverlayOpacity(progress) {
  const smooth = (value) => {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  };
  return progress < 0.06 ? smooth(progress / 0.06) : 1;
}

// The return flight sits beside the first flight, separated by the landing
// guard wall. Matching this spacing at both ends keeps the camera on the same
// axis as the official stair artwork after the second quarter turn.
const TURN_FLIGHT_SPACING = 5.6;

function yawForTurn(progress) {
  // Keep a short final settle at the exact target camera so the last Canvas
  // frame has the same projection as the official SVG before controls resume.
  if (progress >= 0.97) return -Math.PI;
  return -easeTurn(progress / 0.97) * Math.PI;
}

function parseSvgPath(pathData) {
  const tokens = String(pathData ?? '').match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi) ?? [];
  const contours = [];
  let contour = [];
  let index = 0;
  let command = null;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;

  const isCommand = (token) => /^[a-zA-Z]$/.test(token);
  const pushPoint = (nextX, nextY) => {
    x = nextX;
    y = nextY;
    contour.push({ x, y });
  };
  const finishContour = (closed = false) => {
    if (contour.length > 1) contours.push({ points: contour, closed });
    contour = [];
  };

  while (index < tokens.length) {
    if (isCommand(tokens[index])) {
      command = tokens[index++];
      const upper = command.toUpperCase();
      if (upper === 'Z') {
        if (contour.length && (contour[contour.length - 1].x !== startX || contour[contour.length - 1].y !== startY)) {
          contour.push({ x: startX, y: startY });
        }
        finishContour(true);
        x = startX;
        y = startY;
        command = null;
      }
      continue;
    }

    if (!command) break;
    const upper = command.toUpperCase();
    const relative = command !== upper;
    if (upper === 'M' || upper === 'L') {
      const nextXValue = Number(tokens[index++]);
      const nextYValue = Number(tokens[index++]);
      if (!Number.isFinite(nextXValue) || !Number.isFinite(nextYValue)) break;
      const nextX = relative ? x + nextXValue : nextXValue;
      const nextY = relative ? y + nextYValue : nextYValue;
      if (upper === 'M') {
        if (contour.length) finishContour(false);
        startX = nextX;
        startY = nextY;
        pushPoint(nextX, nextY);
        command = relative ? 'l' : 'L';
      } else {
        pushPoint(nextX, nextY);
      }
    } else if (upper === 'H') {
      const nextValue = Number(tokens[index++]);
      pushPoint(relative ? x + nextValue : nextValue, y);
    } else if (upper === 'V') {
      const nextValue = Number(tokens[index++]);
      pushPoint(x, relative ? y + nextValue : nextValue);
    } else {
      return [];
    }
  }
  if (contour.length) finishContour(false);
  return contours;
}

function triangulateContour(points) {
  const vertices = [];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const previous = vertices[vertices.length - 1];
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > 1e-7) {
      vertices.push({ point, index });
    }
  }
  if (vertices.length > 2 && Math.hypot(
    vertices[0].point.x - vertices[vertices.length - 1].point.x,
    vertices[0].point.y - vertices[vertices.length - 1].point.y
  ) <= 1e-7) vertices.pop();
  if (vertices.length < 3) return [];

  const cross = (a, b, c) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  let area = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index].point;
    const next = vertices[(index + 1) % vertices.length].point;
    area += current.x * next.y - next.x * current.y;
  }
  const winding = area >= 0 ? 1 : -1;
  const remaining = vertices.map((_, index) => index);
  const triangles = [];
  const contains = (point, a, b, c) => {
    const first = cross(a, b, point) * winding;
    const second = cross(b, c, point) * winding;
    const third = cross(c, a, point) * winding;
    return first >= -1e-7 && second >= -1e-7 && third >= -1e-7;
  };

  while (remaining.length > 3) {
    let earFound = false;
    for (let index = 0; index < remaining.length; index += 1) {
      const previousIndex = remaining[(index + remaining.length - 1) % remaining.length];
      const currentIndex = remaining[index];
      const nextIndex = remaining[(index + 1) % remaining.length];
      const a = vertices[previousIndex].point;
      const b = vertices[currentIndex].point;
      const c = vertices[nextIndex].point;
      if (cross(a, b, c) * winding <= 1e-7) continue;
      let containsVertex = false;
      for (const candidateIndex of remaining) {
        if (candidateIndex === previousIndex || candidateIndex === currentIndex || candidateIndex === nextIndex) continue;
        if (contains(vertices[candidateIndex].point, a, b, c)) {
          containsVertex = true;
          break;
        }
      }
      if (containsVertex) continue;
      triangles.push([vertices[previousIndex].index, vertices[currentIndex].index, vertices[nextIndex].index]);
      remaining.splice(index, 1);
      earFound = true;
      break;
    }
    if (!earFound) {
      // Remove a collinear contour point and retry; this avoids producing a
      // self-intersecting fan for SVG paths with long horizontal/vertical runs.
      let collinearIndex = -1;
      for (let index = 0; index < remaining.length; index += 1) {
        const previousIndex = remaining[(index + remaining.length - 1) % remaining.length];
        const currentIndex = remaining[index];
        const nextIndex = remaining[(index + 1) % remaining.length];
        if (Math.abs(cross(
          vertices[previousIndex].point,
          vertices[currentIndex].point,
          vertices[nextIndex].point
        )) <= 1e-7) {
          collinearIndex = index;
          break;
        }
      }
      if (collinearIndex < 0) return [];
      remaining.splice(collinearIndex, 1);
    }
  }
  if (remaining.length === 3) {
    triangles.push(remaining.map((index) => vertices[index].index));
  }
  return triangles;
}

function isConvexContour(points) {
  const contour = points.length > 2 && Math.hypot(
    points[0].x - points[points.length - 1].x,
    points[0].y - points[points.length - 1].y
  ) <= 1e-7 ? points.slice(0, -1) : points;
  let winding = 0;
  for (let index = 0; index < contour.length; index += 1) {
    const a = contour[index];
    const b = contour[(index + 1) % contour.length];
    const c = contour[(index + 2) % contour.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) <= 1e-7) continue;
    const nextWinding = Math.sign(cross);
    if (winding && nextWinding !== winding) return false;
    winding = nextWinding;
  }
  return winding !== 0;
}

function facesForContour(points) {
  const isClosed = points.length > 2 && Math.hypot(
    points[0].x - points[points.length - 1].x,
    points[0].y - points[points.length - 1].y
  ) <= 1e-7;
  if (!isConvexContour(points)) return triangulateContour(points);
  const count = isClosed ? points.length - 1 : points.length;
  return [Array.from({ length: count }, (_, index) => index)];
}

function strokeRibbon(start, end, width) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6 || width <= 0) return [];
  const offsetX = -dy / length * width / 2;
  const offsetY = dx / length * width / 2;
  return [
    { x: start.x + offsetX, y: start.y + offsetY },
    { x: end.x + offsetX, y: end.y + offsetY },
    { x: end.x - offsetX, y: end.y - offsetY },
    { x: start.x - offsetX, y: start.y - offsetY }
  ];
}

function strokeJoin(point, width) {
  const radius = width / 2;
  return Array.from({ length: 8 }, (_, index) => {
    const angle = index / 8 * Math.PI * 2;
    return { x: point.x + Math.cos(angle) * radius, y: point.y + Math.sin(angle) * radius };
  });
}

function offsetWorldGeometry(geometry, offsetX) {
  if (!offsetX) return geometry;
  return geometry.map((primitive) => ({
    ...primitive,
    points: primitive.points.map((point) => ({ ...point, x: point.x + offsetX })),
    ...(primitive.gradient ? {
      gradient: {
        ...primitive.gradient,
        start: { ...primitive.gradient.start, x: primitive.gradient.start.x + offsetX },
        end: { ...primitive.gradient.end, x: primitive.gradient.end.x + offsetX }
      }
    } : {})
  }));
}

function createOfficialStairGeometry(svg, canvas, width, height, yaw, shift, scale, layer, orderOffset = 0) {
  const bounds = canvas.getBoundingClientRect();
  const focal = height * 0.92;
  const horizon = height * 0.34;
  const cameraHeight = 1.58;
  const floor = svg.querySelector('.stair-flight');
  if (!floor) return [];

  const previousShift = svg.style.getPropertyValue('--climb-shift');
  const previousScale = svg.style.getPropertyValue('--climb-scale');
  const previousShiftPriority = svg.style.getPropertyPriority('--climb-shift');
  const previousScalePriority = svg.style.getPropertyPriority('--climb-scale');
  svg.style.setProperty('--climb-shift', shift + '%');
  svg.style.setProperty('--climb-scale', String(scale));

  try {
    const readContour = (path) => {
      const matrix = path.getScreenCTM();
      if (!matrix) return [];
      return parseSvgPath(path.getAttribute('d')).map((contour) => ({
        closed: contour.closed,
        points: contour.points.map((point) => ({
          x: matrix.a * point.x + matrix.c * point.y + matrix.e - bounds.left,
          y: matrix.b * point.x + matrix.d * point.y + matrix.f - bounds.top
        }))
      }));
    };
    const getBox = (points) => ({
      minY: Math.min(...points.map((point) => point.y)),
      maxY: Math.max(...points.map((point) => point.y))
    });
    const depthForLevel = (screenY, level) => {
      const offset = Math.max(8, screenY - horizon);
      return Math.max(0.2, (cameraHeight - level) * focal / offset);
    };
    const worldPoint = (point, depth, yaw) => {
      const cameraX = (point.x - width / 2) * depth / focal;
      const cameraY = cameraHeight + (horizon - point.y) * depth / focal;
      const cosine = Math.cos(yaw);
      const sine = Math.sin(yaw);
      return {
        x: cameraX * cosine + depth * sine,
        y: cameraY,
        z: -cameraX * sine + depth * cosine
      };
    };
    const visibleOpacity = (path) => {
      let opacity = 1;
      for (let element = path; element && element !== svg.parentElement; element = element.parentElement) {
        const value = Number.parseFloat(getComputedStyle(element).opacity);
        if (Number.isFinite(value)) opacity *= value;
      }
      return opacity;
    };
    const gradientColors = {
      stepTread: '#f1eee8',
      stepRiser: '#bebbb1',
      sideStringer: '#cbc7bd',
      stairRightWall: '#e3dfd6'
    };
    const paintFor = (path, property) => {
      const value = path.getAttribute(property) || getComputedStyle(path)[property];
      const gradientId = value?.match(/url\(["']?#([^"')]+)["']?\)/)?.[1];
      return gradientId ? gradientColors[gradientId] ?? '#d8d5cc' : value === 'none' ? null : value;
    };
    const toPrimitives = (path, contours, mapper, matrix, order) => {
      if (!contours.length) return [];
      const fill = paintFor(path, 'fill');
      const stroke = paintFor(path, 'stroke');
      const localFillOpacity = Number.parseFloat(path.getAttribute('fill-opacity'));
      const localStrokeOpacity = Number.parseFloat(path.getAttribute('stroke-opacity'));
      const fillOpacity = visibleOpacity(path) * (Number.isFinite(localFillOpacity) ? localFillOpacity : 1);
      const strokeOpacity = visibleOpacity(path) * (Number.isFinite(localStrokeOpacity) ? localStrokeOpacity : 1);
      const strokeStyle = getComputedStyle(path);
      const strokeWidth = Number.parseFloat(strokeStyle.strokeWidth) || 0;
      const scale = Math.hypot(matrix.a, matrix.b) || 1;
      const lineWidthPixels = strokeWidth * scale;
      const output = [];
      let suborder = 0;

      for (const contour of contours) {
        const points = contour.points.map(mapper);
        if (contour.closed && fill && fill !== 'none') {
          for (const face of facesForContour(contour.points)) {
            output.push({
              kind: 'polygon',
              points: face.map((index) => points[index]),
              fill, opacity: fillOpacity, layer, order, suborder: suborder++,
              surfaceId: 'stair:' + order
            });
          }
        }
        if (stroke && stroke !== 'none' && lineWidthPixels > 0) {
          const segmentCount = points.length - 1;
          for (let pointIndex = 0; pointIndex < segmentCount; pointIndex += 1) {
            const ribbon = strokeRibbon(contour.points[pointIndex], contour.points[pointIndex + 1], lineWidthPixels);
            if (!ribbon.length) continue;
            output.push({
              kind: 'polygon', points: ribbon.map(mapper), fill: stroke,
              opacity: strokeOpacity, layer, order, suborder: suborder++,
              surfaceId: 'stair:' + order
            });
          }
          if (contour.closed) {
            const uniquePointCount = Math.hypot(
              contour.points[0].x - contour.points[contour.points.length - 1].x,
              contour.points[0].y - contour.points[contour.points.length - 1].y
            ) < 1e-7 ? contour.points.length - 1 : contour.points.length;
            for (let pointIndex = 0; pointIndex < uniquePointCount; pointIndex += 1) {
              const join = strokeJoin(contour.points[pointIndex], lineWidthPixels);
              output.push({
                kind: 'polygon', points: join.map(mapper), fill: stroke,
                opacity: strokeOpacity, layer, order, suborder: suborder++,
                surfaceId: 'stair:' + order
              });
            }
          } else if (strokeStyle.strokeLinecap === 'round' && contour.points.length > 1) {
            for (const pointIndex of [0, contour.points.length - 1]) {
              const cap = strokeJoin(contour.points[pointIndex], lineWidthPixels);
              output.push({
                kind: 'polygon', points: cap.map(mapper), fill: stroke,
                opacity: strokeOpacity, layer, order, suborder: suborder++
              });
            }
          }
        }
      }
      return output;
    };

    const allPaths = Array.from(svg.querySelectorAll('path'));
    const facePaths = Array.from(floor.children).filter((element) => element.localName === 'path');
    const pathData = new Map(allPaths.map((path) => [path, readContour(path)]));
    const stepAnchors = [];
    const stepSurfaces = [];
    const faceMapping = new Map();
    let level = cameraHeight - 0.3;

    for (let pathIndex = 0; pathIndex < facePaths.length; pathIndex += 2) {
      const treadPath = facePaths[pathIndex];
      const treadContours = pathData.get(treadPath) ?? [];
      const treadPoints = treadContours.flatMap((contour) => contour.points);
      if (!treadPoints.length) continue;
      const treadBox = getBox(treadPoints);
      const treadLevel = level;
      faceMapping.set(treadPath, (point) => worldPoint(point, depthForLevel(point.y, treadLevel), yaw));
      stepSurfaces.push({ ...treadBox, level });
      stepAnchors.push({ y: treadBox.minY, depth: depthForLevel(treadBox.minY, level) });
      const treadNearDepth = depthForLevel(treadBox.maxY, level);
      stepAnchors.push({ y: treadBox.maxY, depth: treadNearDepth });

      const riserPath = facePaths[pathIndex + 1];
      const riserContours = pathData.get(riserPath) ?? [];
      if (!riserContours.length) continue;
      const riserPoints = riserContours.flatMap((contour) => contour.points);
      const riserBox = getBox(riserPoints);
      faceMapping.set(riserPath, (point) => worldPoint(point, treadNearDepth, yaw));
      level = cameraHeight + (horizon - riserBox.maxY) * treadNearDepth / focal;
      stepSurfaces.push({ ...riserBox, level });
      stepAnchors.push({ y: riserBox.maxY, depth: treadNearDepth });
    }

    stepAnchors.sort((first, second) => first.y - second.y);
    const depthAtY = (screenY) => {
      if (screenY <= stepAnchors[0].y) return stepAnchors[0].depth;
      for (let index = 1; index < stepAnchors.length; index += 1) {
        const before = stepAnchors[index - 1];
        const after = stepAnchors[index];
        if (screenY <= after.y) {
          const ratio = (screenY - before.y) / Math.max(1, after.y - before.y);
          return before.depth + (after.depth - before.depth) * ratio;
        }
      }
      return stepAnchors[stepAnchors.length - 1].depth;
    };

    const geometry = [];
    for (const [pathOrder, path] of allPaths.entries()) {
      const contours = pathData.get(path) ?? [];
      const matrix = path.getScreenCTM();
      if (!matrix || !contours.length) continue;
      const inFlight = Boolean(path.closest('.stair-flight'));
      let mapper = faceMapping.get(path);
      if (!mapper) mapper = (point) => {
        let depth = depthAtY(point.y);
        if (inFlight) {
          const surface = stepSurfaces.reduce((closest, candidate) => {
            const distance = point.y < candidate.minY
              ? candidate.minY - point.y
              : point.y > candidate.maxY ? point.y - candidate.maxY : 0;
            return distance < closest.distance ? { candidate, distance } : closest;
          }, { candidate: stepSurfaces[0], distance: Infinity }).candidate;
          depth = depthForLevel(point.y, surface.level);
        }
        return worldPoint(point, depth, yaw);
      };
      geometry.push(...toPrimitives(path, contours, mapper, matrix, orderOffset + pathOrder));
    }
    return geometry;
  } finally {
    if (previousShift) svg.style.setProperty('--climb-shift', previousShift, previousShiftPriority);
    else svg.style.removeProperty('--climb-shift');
    if (previousScale) svg.style.setProperty('--climb-scale', previousScale, previousScalePriority);
    else svg.style.removeProperty('--climb-scale');
  }
}

function createOfficialAngleGeometry(svg, canvas, width, height, yaw, shift, scale, layer, orderOffset = 0) {
  const bounds = canvas.getBoundingClientRect();
  const focal = height * 0.92;
  const horizon = height * 0.34;
  const cameraHeight = 1.58;
  const wallDepth = 5.98;
  const previousShift = svg.style.getPropertyValue('--climb-shift');
  const previousScale = svg.style.getPropertyValue('--climb-scale');
  const previousOpacity = svg.style.getPropertyValue('opacity');
  const previousShiftPriority = svg.style.getPropertyPriority('--climb-shift');
  const previousScalePriority = svg.style.getPropertyPriority('--climb-scale');
  const previousOpacityPriority = svg.style.getPropertyPriority('opacity');
  svg.style.setProperty('--climb-shift', shift + '%');
  svg.style.setProperty('--climb-scale', String(scale));
  svg.style.setProperty('opacity', '1');

  try {
    const readContours = (element) => {
      const matrix = element.getScreenCTM();
      if (!matrix) return [];
      let contours = [];
      if (element.localName === 'path') {
        contours = parseSvgPath(element.getAttribute('d'));
      } else if (element.localName === 'rect') {
        const x = Number(element.getAttribute('x')) || 0;
        const y = Number(element.getAttribute('y')) || 0;
        const w = Number(element.getAttribute('width')) || 0;
        const h = Number(element.getAttribute('height')) || 0;
        contours = [{ closed: true, points: [
          { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }
        ] }];
      } else if (element.localName === 'line') {
        contours = [{ closed: false, points: [
          { x: Number(element.getAttribute('x1')) || 0, y: Number(element.getAttribute('y1')) || 0 },
          { x: Number(element.getAttribute('x2')) || 0, y: Number(element.getAttribute('y2')) || 0 }
        ] }];
      } else if (element.localName === 'circle') {
        const cx = Number(element.getAttribute('cx')) || 0;
        const cy = Number(element.getAttribute('cy')) || 0;
        const radius = Number(element.getAttribute('r')) || 0;
        const points = Array.from({ length: 25 }, (_, index) => {
          const angle = index / 24 * Math.PI * 2;
          return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
        });
        contours = [{ closed: true, points }];
      } else if (element.localName === 'polygon' || element.localName === 'polyline') {
        const values = (element.getAttribute('points') ?? '').match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
        const points = [];
        for (let index = 0; index + 1 < values.length; index += 2) points.push({ x: values[index], y: values[index + 1] });
        if (element.localName === 'polygon' && points.length) points.push(points[0]);
        contours = points.length > 1 ? [{ closed: element.localName === 'polygon', points }] : [];
      }
      return contours.map((contour) => ({
        closed: contour.closed,
        points: contour.points.map((point) => ({
          x: matrix.a * point.x + matrix.c * point.y + matrix.e - bounds.left,
          y: matrix.b * point.x + matrix.d * point.y + matrix.f - bounds.top
        }))
      }));
    };
    const isDisplayHidden = (element) => {
      for (let node = element; node && node !== svg.parentElement; node = node.parentElement) {
        if (getComputedStyle(node).display === 'none') return true;
      }
      return false;
    };
    const opacityAt = (element) => {
      let opacity = 1;
      for (let node = element; node && node !== svg; node = node.parentElement) {
        const value = Number.parseFloat(getComputedStyle(node).opacity);
        if (Number.isFinite(value)) opacity *= value;
      }
      return opacity;
    };
    const resolvePaint = (element, property) => {
      const value = element.getAttribute(property) || getComputedStyle(element)[property];
      const gradientId = value?.match(/url\(["']?#([^"')]+)["']?\)/)?.[1];
      if (!gradientId) return value === 'none' ? null : value;
      return { gradient: svg.querySelector('#' + gradientId) };
    };
    const worldPoint = (point, depth) => {
      const cameraX = (point.x - width / 2) * depth / focal;
      const cameraY = cameraHeight + (horizon - point.y) * depth / focal;
      const cosine = Math.cos(yaw);
      const sine = Math.sin(yaw);
      return {
        x: cameraX * cosine + depth * sine,
        y: cameraY,
        z: -cameraX * sine + depth * cosine
      };
    };
    const gradientFor = (paint, element, matrix, depthAt) => {
      if (!paint?.gradient) return null;
      const gradient = paint.gradient;
      const units = gradient.getAttribute('gradientUnits') || 'objectBoundingBox';
      const box = element.getBBox();
      const coordinate = (attribute, origin, extent, fallback) => {
        const raw = gradient.getAttribute(attribute);
        if (raw === null) return origin + extent * fallback;
        if (raw.endsWith('%')) return origin + extent * Number.parseFloat(raw) / 100;
        const value = Number.parseFloat(raw);
        return units === 'objectBoundingBox' ? origin + extent * value : value;
      };
      const toWorld = (x, y) => {
        const screenPoint = {
          x: matrix.a * x + matrix.c * y + matrix.e - bounds.left,
          y: matrix.b * x + matrix.d * y + matrix.f - bounds.top
        };
        return worldPoint(screenPoint, depthAt(screenPoint));
      };
      const start = toWorld(
        coordinate('x1', box.x, box.width, 0),
        coordinate('y1', box.y, box.height, 0)
      );
      const end = toWorld(
        coordinate('x2', box.x, box.width, 1),
        coordinate('y2', box.y, box.height, 0)
      );
      const stops = Array.from(gradient.querySelectorAll('stop')).map((stop) => {
        const rawOffset = stop.getAttribute('offset') ?? '0';
        const offset = rawOffset.endsWith('%')
          ? Number.parseFloat(rawOffset) / 100
          : Number.parseFloat(rawOffset);
        const style = getComputedStyle(stop);
        const color = stop.getAttribute('stop-color') || style.stopColor || '#e8e5dc';
        const stopOpacity = Number.parseFloat(stop.getAttribute('stop-opacity') || style.stopOpacity);
        const opacity = Number.isFinite(stopOpacity) ? stopOpacity : 1;
        const hex = color.match(/^#([\da-f]{6})$/i)?.[1];
        const rgba = hex
          ? 'rgba(' + parseInt(hex.slice(0, 2), 16) + ',' + parseInt(hex.slice(2, 4), 16) + ',' + parseInt(hex.slice(4, 6), 16) + ',' + opacity + ')'
          : color;
        return { offset: Math.max(0, Math.min(1, offset)), color: rgba };
      }).filter((stop) => Number.isFinite(stop.offset));
      return { start, end, stops };
    };
    const output = [];
    const elements = Array.from(svg.querySelectorAll('path, rect, circle, polygon, polyline, line'));
    for (const [elementOrder, element] of elements.entries()) {
      if (isDisplayHidden(element)) continue;
      if (element.closest('.stair-flight, .old-rails, .old-stair-shadow')) continue;
      const contours = readContours(element);
      if (!contours.length) continue;
      const allPoints = contours.flatMap((contour) => contour.points);
      const minX = Math.min(...allPoints.map((point) => point.x));
      const maxX = Math.max(...allPoints.map((point) => point.x));
      const minY = Math.min(...allPoints.map((point) => point.y));
      const maxY = Math.max(...allPoints.map((point) => point.y));
      if (minX <= 1 && minY <= 1 && maxX >= width - 1 && maxY >= height - 1) continue;

      const fillPaint = resolvePaint(element, 'fill');
      const strokePaint = resolvePaint(element, 'stroke');
      if (/(?:Left|Right)Wall$/.test(fillPaint?.gradient?.id ?? '')) continue;
      const fill = typeof fillPaint === 'string' ? fillPaint : fillPaint?.gradient ? '#e8e5dc' : null;
      const stroke = typeof strokePaint === 'string' ? strokePaint : null;
      const style = getComputedStyle(element);
      const matrix = element.getScreenCTM();
      const strokeWidth = Number.parseFloat(style.strokeWidth) || 0;
      const fillOpacityValue = Number.parseFloat(style.fillOpacity);
      const strokeOpacityValue = Number.parseFloat(style.strokeOpacity);
      const fillOpacity = opacityAt(element) * (Number.isFinite(fillOpacityValue) ? fillOpacityValue : 1);
      const strokeOpacity = opacityAt(element) * (Number.isFinite(strokeOpacityValue) ? strokeOpacityValue : 1);
      const screenScale = matrix ? Math.hypot(matrix.a, matrix.b) || 1 : 1;
      const lineWidthPixels = strokeWidth * screenScale;
      const floorSurface = Boolean(fill && contours.some((contour) => contour.closed) &&
        maxX - minX > width * 0.9 && minY > height * 0.55 && maxY > height * 0.92);
      let suborder = 0;
      const surfaceDepthAt = (point) => floorSurface
        ? cameraHeight * focal / Math.max(8, point.y - horizon)
        : wallDepth;
      for (const contour of contours) {
        const points = contour.points.map((point) => {
          const depth = surfaceDepthAt(point);
          return worldPoint(point, depth);
        });
        if (contour.closed && fill && fill !== 'none') {
          const gradient = gradientFor(fillPaint, element, matrix, surfaceDepthAt);
          for (const face of facesForContour(contour.points)) {
            output.push({
              kind: 'polygon',
              points: face.map((index) => points[index]),
              fill, gradient, opacity: fillOpacity, floorSurface, layer,
              order: orderOffset + elementOrder, suborder: suborder++,
              surfaceId: svg.id + ':' + (floorSurface ? 'floor' : 'wall') + ':' + yaw
            });
          }
        }
        if (stroke && stroke !== 'none' && lineWidthPixels > 0) {
          for (let index = 0; index + 1 < points.length; index += 1) {
            const ribbon = strokeRibbon(contour.points[index], contour.points[index + 1], lineWidthPixels);
            if (!ribbon.length) continue;
            output.push({
              kind: 'polygon', points: ribbon.map((point) => worldPoint(point, surfaceDepthAt(point))),
              fill: stroke,
              opacity: strokeOpacity, floorSurface, layer, order: orderOffset + elementOrder, suborder: suborder++,
              surfaceId: svg.id + ':' + (floorSurface ? 'floor' : 'wall') + ':' + yaw
            });
          }
          if (contour.closed) {
            const uniquePointCount = Math.hypot(
              contour.points[0].x - contour.points[contour.points.length - 1].x,
              contour.points[0].y - contour.points[contour.points.length - 1].y
            ) < 1e-7 ? contour.points.length - 1 : contour.points.length;
            for (let pointIndex = 0; pointIndex < uniquePointCount; pointIndex += 1) {
              const join = strokeJoin(contour.points[pointIndex], lineWidthPixels);
              output.push({
                kind: 'polygon',
                points: join.map((point) => worldPoint(point, surfaceDepthAt(point))),
                fill: stroke, opacity: strokeOpacity, floorSurface, layer,
                order: orderOffset + elementOrder, suborder: suborder++,
                surfaceId: svg.id + ':' + (floorSurface ? 'floor' : 'wall') + ':' + yaw
              });
            }
          } else if (style.strokeLinecap === 'round' && contour.points.length > 1) {
            for (const pointIndex of [0, contour.points.length - 1]) {
              const cap = strokeJoin(contour.points[pointIndex], lineWidthPixels);
              output.push({
                kind: 'polygon',
                points: cap.map((point) => worldPoint(point, surfaceDepthAt(point))),
                fill: stroke, opacity: strokeOpacity, floorSurface, layer,
                order: orderOffset + elementOrder, suborder: suborder++
              });
            }
          }
        }
      }
    }
    return output;
  } finally {
    if (previousShift) svg.style.setProperty('--climb-shift', previousShift, previousShiftPriority);
    else svg.style.removeProperty('--climb-shift');
    if (previousScale) svg.style.setProperty('--climb-scale', previousScale, previousScalePriority);
    else svg.style.removeProperty('--climb-scale');
    if (previousOpacity) svg.style.setProperty('opacity', previousOpacity, previousOpacityPriority);
    else svg.style.removeProperty('opacity');
  }
}

function renderTurnScene(canvas, context, state, progress, stairGeometry) {
  if (!canvas || !context) return;
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;

  const width = bounds.width;
  const height = bounds.height;
  const pixelRatio = Math.min(2, globalThis.devicePixelRatio || 1);
  const pixelWidth = Math.round(width * pixelRatio);
  const pixelHeight = Math.round(height * pixelRatio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#f3f1e9';
  context.fillRect(0, 0, width, height);

  const yaw = yawForTurn(progress);
  const cameraHeight = 1.58;
  const focal = height * 0.92;
  const horizon = height * 0.34;
  const near = 0.08;
  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);
  const cameraWorldX = -TURN_FLIGHT_SPACING * easeTurn(progress);
  const primitives = [];
  let roomOrder = 0;

  function cameraPoint(point) {
    // Hand-built room shell points use tuples; SVG-derived meshes use named
    // coordinates. Normalize both before projecting through the same camera.
    const x = (Array.isArray(point) ? point[0] : point.x) - cameraWorldX;
    const y = Array.isArray(point) ? point[1] : point.y;
    const z = Array.isArray(point) ? point[2] : point.z;
    return {
      x: x * cosYaw - z * sinYaw,
      y: y - cameraHeight,
      depth: x * sinYaw + z * cosYaw
    };
  }

  function project(point) {
    return {
      x: width / 2 + point.x * focal / point.depth,
      y: horizon - point.y * focal / point.depth
    };
  }

  function clipPolygon(points) {
    const halfWidthAtUnitDepth = width / (2 * focal);
    const planes = [
      (point) => point.depth - near,
      (point) => point.x + point.depth * halfWidthAtUnitDepth,
      (point) => point.depth * halfWidthAtUnitDepth - point.x,
      (point) => point.depth * horizon / focal - point.y,
      (point) => point.y + point.depth * (height - horizon) / focal
    ];
    let clipped = points;
    for (const distanceToPlane of planes) {
      if (!clipped.length) break;
      const output = [];
      let previous = clipped[clipped.length - 1];
      let previousDistance = distanceToPlane(previous);
      for (const current of clipped) {
        const currentDistance = distanceToPlane(current);
        const previousInside = previousDistance >= -1e-8;
        const currentInside = currentDistance >= -1e-8;
        if (currentInside !== previousInside) {
          const amount = previousDistance / (previousDistance - currentDistance);
          output.push({
            x: previous.x + (current.x - previous.x) * amount,
            y: previous.y + (current.y - previous.y) * amount,
            depth: previous.depth + (current.depth - previous.depth) * amount
          });
        }
        if (currentInside) output.push(current);
        previous = current;
        previousDistance = currentDistance;
      }
      clipped = output;
    }
    return clipped;
  }

  function clipLine(start, end, includeViewport = true) {
    const halfWidthAtUnitDepth = width / (2 * focal);
    const planes = [(point) => point.depth - near];
    if (includeViewport) planes.push(
      (point) => point.x + point.depth * halfWidthAtUnitDepth,
      (point) => point.depth * halfWidthAtUnitDepth - point.x,
      (point) => point.depth * horizon / focal - point.y,
      (point) => point.y + point.depth * (height - horizon) / focal
    );
    let firstAmount = 0;
    let lastAmount = 1;
    for (const distanceToPlane of planes) {
      const firstDistance = distanceToPlane(start);
      const lastDistance = distanceToPlane(end);
      if (firstDistance < 0 && lastDistance < 0) return null;
      if ((firstDistance < 0) !== (lastDistance < 0)) {
        const amount = firstDistance / (firstDistance - lastDistance);
        if (firstDistance < 0) firstAmount = Math.max(firstAmount, amount);
        else lastAmount = Math.min(lastAmount, amount);
        if (firstAmount > lastAmount) return null;
      }
    }
    const interpolate = (amount) => ({
      x: start.x + (end.x - start.x) * amount,
      y: start.y + (end.y - start.y) * amount,
      depth: start.depth + (end.depth - start.depth) * amount
    });
    return {
      points: [interpolate(firstAmount), interpolate(lastAmount)],
      firstAmount,
      lastAmount
    };
  }

  function colorAtGradientOffset(stops, offset) {
    if (!stops.length) return '#e8e5dc';
    const read = (color) => {
      const values = color.match(/rgba?\(([^)]+)\)/i)?.[1].split(',').map((value) => Number.parseFloat(value.trim()));
      if (values?.length >= 3 && values.every(Number.isFinite)) return [values[0], values[1], values[2], values[3] ?? 1];
      const hex = color.match(/^#([\da-f]{6})$/i)?.[1];
      return hex
        ? [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), 1]
        : null;
    };
    const before = [...stops].reverse().find((stop) => stop.offset <= offset) ?? stops[0];
    const after = stops.find((stop) => stop.offset >= offset) ?? stops[stops.length - 1];
    const first = read(before.color);
    const second = read(after.color);
    if (!first || !second) return before.color;
    const span = after.offset - before.offset;
    const ratio = span > 1e-7 ? Math.max(0, Math.min(1, (offset - before.offset) / span)) : 0;
    const rgba = first.map((value, index) => value + (second[index] - value) * ratio);
    return 'rgba(' + Math.round(rgba[0]) + ',' + Math.round(rgba[1]) + ',' + Math.round(rgba[2]) + ',' + rgba[3] + ')';
  }

  function addPolygon(points, fill, stroke = null, lineWidth = 0.012, floorSurface = false) {
    const faces = points.length === 4
      ? [[0, 1, 2], [0, 2, 3]]
      : points.slice(2).map((_, index) => [0, index + 1, index + 2]);
    const surfaceOrder = roomOrder++;
    for (const [faceIndex, face] of faces.entries()) {
      const cameraPoints = face.map((index) => cameraPoint(points[index]));
      primitives.push({
        kind: 'polygon',
        points: cameraPoints,
        fill,
        stroke,
        lineWidth,
        floorSurface,
        layer: 0,
        order: surfaceOrder,
        suborder: faceIndex,
        surfaceId: 'room-shell:' + surfaceOrder,
        depth: cameraPoints.reduce((sum, point) => sum + point.depth, 0) / cameraPoints.length
      });
    }
  }

  // Two parallel flight bays share one continuous landing. The camera walks
  // through the guarded opening as it turns, so the return flight occupies the
  // adjacent bay instead of appearing through a blank wall or from empty space.
  addPolygon([[-8.4, 0, -6.1], [2.8, 0, -6.1], [2.8, 0, 6.1], [-8.4, 0, 6.1]], '#e9e6de', null, 0.012, true);
  // The divider is a real half-wall with wall returns and a high lintel; the
  // central opening is the U-turn landing between the parallel stair flights.
  addPolygon([[-2.8, 0, -6.1], [-2.8, 3.6, -6.1], [-2.8, 3.6, -2.8], [-2.8, 0, -2.8]], '#f7f5ef');
  addPolygon([[-2.8, 0, 2.8], [-2.8, 3.6, 2.8], [-2.8, 3.6, 6.1], [-2.8, 0, 6.1]], '#f7f5ef');
  addPolygon([[-2.8, 0, -2.8], [-2.8, 0.82, -2.8], [-2.8, 0.82, 2.8], [-2.8, 0, 2.8]], '#e8e4da');
  addPolygon([[-2.8, 3.05, -2.8], [-2.8, 3.6, -2.8], [-2.8, 3.6, 2.8], [-2.8, 3.05, 2.8]], '#eeeae2');
  addPolygon([[-2.8, 0.82, -2.95], [-2.8, 3.05, -2.95], [-2.8, 3.05, -2.8], [-2.8, 0.82, -2.8]], '#e4e1d8');
  addPolygon([[-2.8, 0.82, 2.8], [-2.8, 3.05, 2.8], [-2.8, 3.05, 2.95], [-2.8, 0.82, 2.95]], '#e4e1d8');
  addPolygon([[-2.74, 0.82, -2.8], [-2.74, 0.94, -2.8], [-2.74, 0.94, 2.8], [-2.74, 0.82, 2.8]], '#344247');
  addPolygon([[-2.73, 0.94, -2.8], [-2.73, 0.98, -2.8], [-2.73, 0.98, 2.8], [-2.73, 0.94, 2.8]], '#aeb8b5');
  addPolygon([[2.8, 0, -6.1], [2.8, 0, 6.1], [2.8, 3.6, 6.1], [2.8, 3.6, -6.1]], '#eeeae2');
  addPolygon([[-8.4, 0, 6.1], [-8.4, 3.6, 6.1], [2.8, 3.6, 6.1], [2.8, 0, 6.1]], '#e4e1d8');
  addPolygon([[-8.4, 0, -6.1], [2.8, 0, -6.1], [2.8, 3.6, -6.1], [-8.4, 3.6, -6.1]], '#f0ede5');
  addPolygon([[-8.4, 3.6, -6.1], [2.8, 3.6, -6.1], [2.8, 3.6, 6.1], [-8.4, 3.6, 6.1]], '#eceae2');
  addPolygon([[-8.4, 0, -6.1], [-8.4, 0, 6.1], [-8.4, 3.6, 6.1], [-8.4, 3.6, -6.1]], '#eeeae2');
  const cameraGradientCache = new Map();
  for (const shape of stairGeometry ?? []) {
    const cameraPoints = shape.points.map(cameraPoint);
    if (shape.kind === 'polygon') {
      let gradient = null;
      if (shape.gradient) {
        gradient = cameraGradientCache.get(shape.gradient);
        if (!gradient) {
          gradient = {
            start: cameraPoint(shape.gradient.start),
            end: cameraPoint(shape.gradient.end),
            stops: shape.gradient.stops
          };
          cameraGradientCache.set(shape.gradient, gradient);
        }
      }
      primitives.push({
        kind: 'polygon', points: cameraPoints, fill: shape.fill,
        gradient,
        opacity: shape.opacity,
        floorSurface: shape.floorSurface,
        layer: shape.layer,
        order: shape.order,
        suborder: shape.suborder,
        surfaceId: shape.surfaceId,
        depth: cameraPoints.reduce((sum, point) => sum + point.depth, 0) / cameraPoints.length
      });
    } else {
      primitives.push({
        kind: 'line', points: cameraPoints, color: shape.color,
        worldWidth: shape.worldWidth, opacity: shape.opacity,
        floorSurface: shape.floorSurface,
        layer: shape.layer,
        order: shape.order,
        suborder: shape.suborder,
        depth: (cameraPoints[0].depth + cameraPoints[1].depth) / 2
      });
    }
  }

  if (progress >= 0.97) {
    // At the handoff angle, honor the SVG's actual painter layers and DOM
    // order: scene illustration first, then the official stair-core paths.
    primitives.sort((first, second) =>
      (first.layer ?? 0) - (second.layer ?? 0) ||
      (first.order ?? 0) - (second.order ?? 0) ||
      (first.suborder ?? 0) - (second.suborder ?? 0));
  } else {
    // Landing/floor planes span a broad depth range. Sorting the whole plane
    // by its center can paint its near half over the stairs, so paint floors
    // first and let walls, rails, and stair surfaces resolve their depth after.
    primitives.sort((first, second) => {
      if (Boolean(first.floorSurface) !== Boolean(second.floorSurface)) {
        return first.floorSurface ? -1 : 1;
      }
      const depthOrder = Math.round(second.depth * 1000) - Math.round(first.depth * 1000);
      if (depthOrder) return depthOrder;
      if (first.surfaceId && first.surfaceId === second.surfaceId) {
        return (first.order ?? 0) - (second.order ?? 0) ||
          (first.suborder ?? 0) - (second.suborder ?? 0);
      }
      return 0;
    });
  }
  const canvasGradientCache = new Map();
  const canvasGradientFor = (gradient) => {
    if (!gradient?.stops?.length) return null;
    if (canvasGradientCache.has(gradient)) return canvasGradientCache.get(gradient);
    const clippedGradient = clipLine(gradient.start, gradient.end, false);
    if (!clippedGradient || clippedGradient.lastAmount - clippedGradient.firstAmount <= 1e-7) {
      canvasGradientCache.set(gradient, null);
      return null;
    }
    const [startPoint, endPoint] = clippedGradient.points;
    const start = project(startPoint);
    const end = project(endPoint);
    const canvasGradient = context.createLinearGradient(start.x, start.y, end.x, end.y);
    const startOffset = clippedGradient.firstAmount;
    const endOffset = clippedGradient.lastAmount;
    canvasGradient.addColorStop(0, colorAtGradientOffset(gradient.stops, startOffset));
    for (const stop of gradient.stops) {
      if (stop.offset <= startOffset || stop.offset >= endOffset) continue;
      canvasGradient.addColorStop((stop.offset - startOffset) / (endOffset - startOffset), stop.color);
    }
    canvasGradient.addColorStop(1, colorAtGradientOffset(gradient.stops, endOffset));
    canvasGradientCache.set(gradient, canvasGradient);
    return canvasGradient;
  };
  for (const primitive of primitives) {
    context.globalAlpha = primitive.opacity ?? 1;
    if (primitive.kind === 'line') {
      const clippedLine = clipLine(primitive.points[0], primitive.points[1]);
      if (!clippedLine) continue;
      const [start, end] = clippedLine.points;
      const p1 = project(start);
      const p2 = project(end);
      const averageDepth = Math.max(near, (start.depth + end.depth) / 2);
      context.beginPath();
      context.moveTo(p1.x, p1.y);
      context.lineTo(p2.x, p2.y);
      context.strokeStyle = primitive.color;
      context.lineWidth = Math.max(1, primitive.worldWidth * focal / averageDepth);
      context.lineCap = 'round';
      context.stroke();
      continue;
    }

    const clipped = clipPolygon(primitive.points);
    if (clipped.length < 3) continue;
    const projected = clipped.map(project);
    context.beginPath();
    context.moveTo(projected[0].x, projected[0].y);
    for (let index = 1; index < projected.length; index += 1) context.lineTo(projected[index].x, projected[index].y);
    context.closePath();
    context.fillStyle = canvasGradientFor(primitive.gradient) ?? primitive.fill;
    context.fill();
    if (primitive.stroke) {
      const averageDepth = Math.max(near, primitive.depth);
      context.strokeStyle = primitive.stroke;
      context.lineWidth = Math.max(1, primitive.lineWidth * focal / averageDepth);
      context.stroke();
    }
  }
  context.globalAlpha = 1;
}

export function createUI(onAction) {
  const byId = (id) => document.getElementById(id);
  const floorProgress = byId('floor-progress');
  const floorProgressFill = byId('floor-progress-fill');
  const floorProgressCurrent = byId('floor-progress-current');
  const floorProgressMilestones = Array.from(floorProgress.querySelectorAll('.floor-progress-milestone'));
  const sceneSignAUp = byId('scene-sign-a-up');
  const sceneSignADown = byId('scene-sign-a-down');
  const sceneSignBFloor = byId('scene-sign-b-floor');
  const timerValue = byId('timer-value');
  const speedNumber = byId('speed-number');
  const pauseButton = byId('pause-button');
  const track = byId('rhythm-track');
  const trackShake = byId('rhythm-track-shake');
  trackShake.style.setProperty('--heart-wobble-duration', GAME_CONFIG.heartPalpitationsWobbleDurationMs + 'ms');
  let lastHeartWobbleProfile = '';
  let lastHeartWobbleSerial = 0;
  const trackZones = byId('track-zones');
  const rhythmLabel = byId('rhythm-label');
  const desktopControlHint = document.querySelector('.control-hint .desktop-hint');
  const mobileControlHint = document.querySelector('.control-hint .mobile-hint');
  const controlHintCopy = byId('control-hint-copy');
  const ball = byId('rhythm-ball');
  const ballVisual = byId('rhythm-ball-visual');
  const skipSkillButton = byId('skip-skill');
  const skipSkillCount = byId('skip-skill-count');
  const skipSkillStatus = byId('skip-skill-status');
  const skipSkillEnergy = byId('skip-skill-energy');
  const skipSkillMeter = skipSkillEnergy.closest('.skip-skill-meter');
  let rhythmTrackWidth = 0;
  const measureRhythmTrack = () => {
    const width = track.clientWidth;
    if (Number.isFinite(width) && width > 0) rhythmTrackWidth = width;
  };
  measureRhythmTrack();
  if (typeof ResizeObserver !== 'undefined') {
    const rhythmTrackResizeObserver = new ResizeObserver(measureRhythmTrack);
    rhythmTrackResizeObserver.observe(track);
  } else {
    window.addEventListener('resize', measureRhythmTrack, { passive: true });
    window.addEventListener('orientationchange', measureRhythmTrack, { passive: true });
  }
  track.style.setProperty('--rhythm-hit-flash-duration', GAME_CONFIG.rhythmHitFlashDurationMs + 'ms');
  const feedback = byId('feedback');
  const bestValue = byId('best-value');
  const debuffCard = byId('debuff-card');
  const announcer = byId('announcer');
  const comboStamp = byId('combo-stamp');
  const modalLayer = byId('modal-layer');
  const purifyFrame = byId('purify-frame');
  const qteLayer = byId('qte-layer');
  Object.values(QTE_ITEM_PRESENTATIONS)
    .filter((presentation) => presentation.visual === 'image' && presentation.assetPath)
    .forEach((presentation) => {
      const image = new Image();
      image.decoding = 'async';
      image.src = presentation.assetPath;
    });
  const qteFailureNotice = byId('qte-failure-notice');
  const gameRoot = byId('game');
  const arena = byId('arena');
  const climber = byId('climber');
  const rhythmOrbScene = byId('rhythm-orb-scene');
  const rhythmOrb = byId('rhythm-orb');
  const rhythmOrbToast = byId('rhythm-orb-toast');
  const sceneA = byId('scene-a');
  const sceneB = byId('scene-b');
  const sceneStairs = byId('scene-stairs');
  const turnScene = byId('turn-scene');
  const turnSceneContext = turnScene?.getContext?.('2d') ?? null;
  const turnSceneCache = { ZERO_TO_HALF: null, HALF_TO_ZERO: null };
  let turnSceneCacheKey = '';
  let turnSceneResizeTimer = 0;
  let turnSceneResizeObserver = null;
  let lastMode = null;
  let lastQteObject = null;
  let lastQteItemUse = null;
  let lastQteMessage = '';
  let lastCombo = 0;
  let lastAnnouncement = '';
  let lastDebuffListSignature = null;
  let lastRhythmRound = null;
  let lastRhythmTapSerial = 0;
  let lastRhythmFeedbackSerial = 0;
  let lastRhythmLaunchSerial = 0;
  let lastRhythmOrbCollectSerial = 0;
  let lastMonsterImpactSerial = 0;
  let lastDebuffAppliedSerial = 0;
  let lastDebuffCureSerial = 0;
  let lastCombatViewMode = null;
  let lastCombatMonsterId = null;
  let resultTab = 'summary';
  let latestState = null;
  let lastRenderedMode = null;

  function antiDizzinessSetting(state) {
    const enabled = state.antiDizzinessMode === ANTI_DIZZINESS_MODE.ON;
    return '<div class="accessibility-setting">' +
      '<span class="setting-copy"><strong>防暈模式</strong><small>開啟後，以簡易轉場取代旋轉動畫</small></span>' +
      '<button class="setting-switch' + (enabled ? ' is-on' : '') + '" type="button" role="switch" data-setting="anti-dizziness" aria-label="防暈模式" aria-checked="' + enabled + '">' +
        '<span class="setting-switch-track"><span></span></span><span class="setting-switch-state">' + (enabled ? 'ON' : 'OFF') + '</span>' +
      '</button>' +
    '</div>';
  }

  function syncAntiDizzinessSetting(state) {
    const toggle = modalLayer.querySelector('[data-setting="anti-dizziness"]');
    if (!toggle) return;
    const enabled = state.antiDizzinessMode === ANTI_DIZZINESS_MODE.ON;
    toggle.setAttribute('aria-checked', String(enabled));
    toggle.classList.toggle('is-on', enabled);
    const value = toggle.querySelector('.setting-switch-state');
    if (value) value.textContent = enabled ? 'ON' : 'OFF';
  }

  function audioVolumeSettings() {
    const settings = loadAudioSettings();
    const slider = (key, label, value) =>
      '<label class="audio-volume-row" for="pause-' + key + '-volume">' +
        '<span class="audio-volume-label">' + label + '</span>' +
        '<span class="audio-volume-value" data-volume-value="' + key + '">' + value + '%</span>' +
        '<input class="audio-volume-slider" id="pause-' + key + '-volume" type="range" min="0" max="100" step="1" value="' + value + '" data-audio-volume="' + key + 'Percent" aria-label="' + label + '" />' +
      '</label>';
    return '<section class="pause-audio-settings" aria-label="音量設定">' +
      '<h3>音量設定</h3>' +
      slider('bgm', 'BGM 音量', settings.bgmPercent) +
      slider('sfx', '其他音效', settings.sfxPercent) +
    '</section>';
  }

  function showModal(state) {
    const mode = state.mode;
    modalLayer.classList.toggle('is-upgrade-selection', mode === 'UPGRADE_SELECT');
    if (mode === lastMode) return;
    lastMode = mode;
    if (mode === 'CLIMBING' || mode === 'EVENT_WARNING' || mode === 'MONSTER_ENTRANCE' ||
        mode === 'MONSTER_CAST' || mode === 'MONSTER_IMPACT' || mode === 'ATTACK_TO_DEBUFF_DELAY' ||
        mode === 'DEBUFF_REVEAL' || mode === 'DEBUFF_TO_ANSWER_DELAY' || mode === 'ANSWER_PREVIEW' ||
        mode === 'MONSTER_QTE' || mode === 'QTE_FAILURE_KNOCKBACK' || mode.startsWith('QTE_ITEM_') || mode.startsWith('COMBAT_')) {
      modalLayer.hidden = true;
      modalLayer.innerHTML = '';
      return;
    }
    modalLayer.hidden = false;
    if (mode === 'MENU') {
      modalLayer.innerHTML =
        '<section class="modal-card menu-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
          '<div class="modal-sticker" aria-hidden="true">↟</div>' +
          '<p class="modal-eyebrow">' + UI_TEXT.menuEyebrow + '</p>' +
          '<h2 id="modal-title">' + UI_TEXT.gameTitle + '</h2>' +
          '<p class="modal-lead">' + UI_TEXT.gameSubtitle + '</p>' +
          '<div class="how-to"><h3>' + UI_TEXT.howToTitle + '</h3><ol>' +
            UI_TEXT.howToLines.map((line) => '<li>' + escapeHtml(line) + '</li>').join('') +
          '</ol></div>' +
          antiDizzinessSetting(state) +
          '<button class="primary-button" type="button" data-action="start">' + UI_TEXT.startButton + '<span>↗</span></button>' +
          '<p class="modal-best">本機最佳　<strong>' + (state.bestTimeMs === null ? UI_TEXT.bestNone : formatTime(state.bestTimeMs)) + '</strong></p>' +
        '</section>';
    } else if (mode === 'PAUSED') {
      modalLayer.innerHTML =
        '<section class="modal-card pause-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
          '<div class="modal-sticker pause-sticker" aria-hidden="true">☕</div>' +
          '<p class="modal-eyebrow">PAUSE · 深呼吸一下</p><h2 id="modal-title">' + UI_TEXT.pauseTitle + '</h2>' +
          '<p class="modal-lead">' + UI_TEXT.pauseBody + '</p>' +
          '<div class="pause-summary"><span>樓層 <b>' + Math.floor(state.progress) + 'F</b></span><span>時間 <b>' + formatTime(state.timerMs) + '</b></span></div>' +
          audioVolumeSettings() +
          antiDizzinessSetting(state) +
          '<button class="primary-button" type="button" data-action="resume">' + UI_TEXT.resumeButton + '<span>↗</span></button>' +
        '</section>';
    } else if (mode === 'UPGRADE_SELECT') {
      const cards = state.upgradeChoices
        .map((cardId) => UPGRADE_CARDS.find((card) => card.id === cardId))
        .filter(Boolean);
      modalLayer.innerHTML =
        '<section class="modal-card upgrade-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
          '<div class="modal-sticker upgrade-sticker" aria-hidden="true">✦</div>' +
          '<p class="modal-eyebrow">MONSTER DEFEATED · REWARD</p>' +
          '<h2 id="modal-title">選擇一項強化</h2>' +
          '<p class="modal-lead">選擇後立即生效，並持續至本局結束</p>' +
          '<div class="upgrade-grid">' + cards.map((card) =>
            '<button class="upgrade-card is-' + escapeHtml(card.color) + '" type="button" data-upgrade-id="' + escapeHtml(card.id) + '">' +
              '<span class="upgrade-card-icon" aria-hidden="true">' + escapeHtml(card.icon) + '</span>' +
              '<strong class="upgrade-card-name">' + escapeHtml(card.name) + '</strong>' +
              '<span class="upgrade-card-description">' + escapeHtml(card.description) + '</span>' +
              '<span class="upgrade-card-action">選擇強化 <b aria-hidden="true">↗</b></span>' +
            '</button>'
          ).join('') + '</div>' +
        '</section>';
    } else if (mode === 'RESULT') {
      const report = state.runReport;
      modalLayer.innerHTML =
        '<section class="modal-card result-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
          '<div class="confetti confetti-one"></div><div class="confetti confetti-two"></div>' +
          '<div class="modal-sticker trophy-sticker" aria-hidden="true">★</div>' +
          '<p class="modal-eyebrow">TOP FLOOR · MISSION COMPLETE</p><h2 id="modal-title">' + UI_TEXT.resultTitle + '</h2>' +
          '<p class="modal-lead">' + UI_TEXT.resultSubtitle + '</p>' +
          (report ? '<div class="result-tabs" role="tablist" aria-label="戰報檢視方式">' +
            '<button class="result-tab' + (resultTab === 'summary' ? ' is-active' : '') + '" type="button" role="tab" aria-selected="' + (resultTab === 'summary') + '" data-report-tab="summary">總覽</button>' +
            '<button class="result-tab' + (resultTab === 'details' ? ' is-active' : '') + '" type="button" role="tab" aria-selected="' + (resultTab === 'details') + '" data-report-tab="details">詳細戰報</button>' +
          '</div>' : '') +
          (report && resultTab === 'details'
            ? '<div class="result-detail-content" role="tabpanel" tabindex="0">' + resultDetailsMarkup(report) + '</div>'
            : '<div class="result-summary-content" role="tabpanel">' +
              '<div class="result-time"><span>' + UI_TEXT.timeLabel + '</span><strong>' + formatTime(state.timerMs) + '</strong></div>' +
              '<div class="result-grid">' +
                resultStat(UI_TEXT.comboLabel, state.stats.maxCombo) +
                resultStat(UI_TEXT.hitsLabel, state.stats.hits) +
                resultStat(UI_TEXT.missesLabel, state.stats.misses) +
                resultStat(UI_TEXT.qteWinsLabel, state.stats.qteWins) +
                resultStat(UI_TEXT.qteLossesLabel, state.stats.qteLosses) +
                resultStat('擊敗怪物', report?.combat?.monstersDefeated ?? 0) +
              '</div>' +
              (report ? '<div class="result-highlight-row">' +
                resultStat('總攀登距離', formatReportNumber(report.climbing.totalClimbedFloors, 2) + ' F') +
                resultStat('節奏成功率', formatPercent(report.rhythm.overall.hitSuccessRate)) +
                resultStat('技能取得 / 使用', report.energy.chargesEarned + ' / ' + report.energy.chargesUsed) +
              '</div>' : '') +
            '</div>') +
          (report ? '<div class="result-report-actions">' +
            '<button class="result-report-button" type="button" data-report-action="export">匯出 JSON 戰報</button>' +
            '<button class="result-report-button is-secondary" type="button" data-report-action="copy">複製 JSON</button>' +
          '</div><p class="result-report-feedback" data-report-feedback aria-live="polite"></p>' : '') +
          '<button class="primary-button" type="button" data-action="start">' + UI_TEXT.retryButton + '<span>↻</span></button>' +
        '</section>';
    }
  }

  function resultStat(label, value) {
    return '<div class="result-stat"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>';
  }

  function formatReportNumber(value, digits = 2) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric.toLocaleString('zh-Hant', { maximumFractionDigits: digits }) : '0';
  }

  function formatReportSeconds(value) {
    return formatReportNumber(value, 2) + ' 秒';
  }

  function formatPercent(value) {
    return formatReportNumber((Number(value) || 0) * 100, 1) + '%';
  }

  function resultDetailSection(title, rows, className = '') {
    const content = rows.length
      ? rows.map(([label, value]) => '<div class="result-detail-row"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>').join('')
      : '<p class="result-detail-empty">本局沒有紀錄</p>';
    return '<section class="result-detail-section ' + className + '"><h3>' + escapeHtml(title) + '</h3><div class="result-detail-rows">' + content + '</div></section>';
  }

  function resultDetailsMarkup(report) {
    const timing = report.timing ?? {};
    const climbing = report.climbing ?? {};
    const combat = report.combat ?? {};
    const qte = report.qte ?? {};
    const rhythm = report.rhythm ?? {};
    const energy = report.energy ?? {};
    const formatUpgradeSnapshot = (snapshot) => Object.entries(snapshot ?? {})
      .map(([key, value]) => key + ': ' + formatReportNumber(value, 3))
      .join(' · ') || '—';
    const timingRows = [
      ['戰報格式 / 模式', 'v' + (report.schemaVersion ?? '1.0') + ' · ' + (report.run?.mode === 'debug' ? 'DEBUG' : '一般遊玩')],
      ['結算 / 樓層', (report.run?.result ?? '—') + ' · ' + report.run?.startFloor + 'F → ' + report.run?.finalFloor + 'F'],
      ['官方遊戲時間', formatReportSeconds(timing.gameTimeSeconds)],
      ['一般攀登', formatReportSeconds(timing.normalClimbingSeconds)],
      ['遭遇 QTE', formatReportSeconds(timing.encounterQteSeconds)],
      ['戰鬥', formatReportSeconds(timing.combatSeconds)],
      ['防禦補救 QTE', formatReportSeconds(timing.emergencyQteSeconds)],
      ['動畫與轉場', formatReportSeconds(timing.animationTransitionSeconds)],
      ['其他遊戲事件', formatReportSeconds(timing.otherEventSeconds)],
      ['強化選卡（另計）', formatReportSeconds(timing.upgradeSelectionSeconds)],
      ['實際經過時間', formatReportSeconds(timing.realElapsedSeconds)],
      ['未分類差額', formatReportSeconds(timing.unclassifiedSeconds)]
    ];
    const climbingRows = [
      ['累計正向攀登（含重爬）', formatReportNumber(climbing.totalClimbedFloors, 2) + ' F'],
      ['QTE 擊退距離', formatReportNumber(climbing.knockedBackFloors, 2) + ' F'],
      ['時間加權基礎速度', formatReportNumber(climbing.averageBaseSpeedFloorsPerSecond, 3) + ' F/s'],
      ['平均有效速度', formatReportNumber(climbing.averageEffectiveSpeedFloorsPerSecond, 3) + ' F/s'],
      ['最高有效速度', formatReportNumber(climbing.maxEffectiveSpeedFloorsPerSecond, 3) + ' F/s'],
      ['完美節奏衝刺累計', formatReportSeconds(climbing.temporaryBurstSeconds) + ' · 額外攀登 ' + formatReportNumber(climbing.temporaryBurstDistanceFloors, 3) + ' F'],
      ['疼痛 DEBUFF 影響攀登', formatReportSeconds(climbing.painDebuffAffectedSeconds) + ' · ' + formatReportNumber(climbing.painDebuffAffectedDistanceFloors, 3) + ' F'],
      ['最終基礎速度 / 有效速度', formatReportNumber(climbing.finalBaseSpeedFloorsPerSecond, 3) + ' / ' + formatReportNumber(climbing.finalEffectiveSpeedFloorsPerSecond, 3) + ' F/s'],
      ['最終速度上限', formatReportNumber(climbing.finalSpeedCapFloorsPerSecond, 3) + ' F/s'],
      ['含負面狀態的平均上限', formatReportNumber(climbing.averageEffectiveSpeedCapFloorsPerSecond, 3) + ' F/s'],
      ['基礎速度達上限時間', formatReportSeconds(climbing.timeAtSpeedCapSeconds) + '（' + formatPercent(climbing.timeAtSpeedCapRatio) + '）'],
      ['高於未強化速度上限時間', formatReportSeconds(climbing.timeAboveNoSpeedUpgradeCapSeconds)],
      ['速度上限強化次數', String(climbing.speedCapUpgradeCount ?? 0)]
    ];
    const speedUpgradeRows = (climbing.speedCapUpgradeHistory ?? []).map((upgrade, index) => [
      '第 ' + (index + 1) + ' 次 · Lv.' + upgrade.level,
      upgrade.floor + 'F · ' + formatReportSeconds(upgrade.gameTimeSeconds) + ' · 強化後上限 ' + formatReportNumber(upgrade.speedCapFloorsPerSecond, 3) + ' F/s'
    ]);
    const intervalRows = (climbing.floorIntervals ?? []).map((interval) =>
      [interval.fromFloor + 'F–' + interval.toFloor + 'F', formatReportNumber(interval.climbedFloors, 2) + ' F / ' + formatReportSeconds(interval.climbingSeconds) + ' / ' + formatReportNumber(interval.averageEffectiveSpeedFloorsPerSecond, 3) + ' F/s']
    );
    const combatRows = [
      ['擊敗 / 跳過怪物', (combat.monstersDefeated ?? 0) + ' / ' + (combat.monstersSkipped ?? 0)],
      ['遭遇嘗試', String(combat.encounterAttempts ?? 0)],
      ['攻擊回合', String(combat.totalAttackRounds ?? 0)],
      ['一回合擊敗', String(combat.oneRoundKills ?? 0)],
      ['兩回合擊敗', String(combat.twoRoundKills ?? 0)],
      ['三回合以上擊敗', String(combat.threeOrMoreRoundKills ?? 0)],
      ['QTE 直接擊敗', String(combat.qteOnlyKills ?? 0)],
      ['計算傷害 / 實際扣血', formatReportNumber(combat.calculatedDamage, 2) + ' / ' + formatReportNumber(combat.actualDamage, 2)],
      ['基礎攻擊傷害', formatReportNumber(combat.baseAttackDamage, 2)],
      ['連打傷害', formatReportNumber(combat.rapidTapDamage, 2)],
      ['有效連打輸入（A / D）', (combat.rapidTapKeyboardA ?? 0) + ' / ' + (combat.rapidTapKeyboardD ?? 0) + ' 次 · 全部 ' + (combat.rapidTapInputCount ?? 0)],
      ['節奏顏色加成傷害', formatReportNumber(combat.colorMultiplierBonusDamage, 2)],
      ['QTE 強化傷害', formatReportNumber(combat.qteDamage, 2)],
      ['每隻擊敗怪物平均戰鬥時間', formatReportSeconds(combat.averageBattleSecondsPerDefeatedMonster)]
    ];
    const qteRows = [
      ['一般遭遇 QTE', (qte.encounterSuccesses ?? 0) + ' 成功 / ' + (qte.encounterFailures ?? 0) + ' 失敗（' + formatPercent(qte.encounterSuccessRate) + '）'],
      ['防禦補救 QTE', (qte.emergencySuccesses ?? 0) + ' 成功 / ' + (qte.emergencyFailures ?? 0) + ' 失敗（' + formatPercent(qte.emergencySuccessRate) + '）'],
      ['被踢退樓次數', String(qte.knockbackCount ?? 0)],
      ['反應強化取得次數', String(qte.qteTimeUpgradeCount ?? 0)],
      ['最大失敗補償時間', formatReportSeconds(qte.maxFailureCompensationSeconds)],
      ['初遇 QTE 強化傷害', formatReportNumber(qte.encounterQteDamage, 2)],
      ['盾牌防禦強化傷害', formatReportNumber(qte.shieldQteDamage, 2)],
      ['盾牌成功防禦 / 攻擊次數', (qte.shieldDefenseSuccesses ?? 0) + ' / ' + (qte.shieldDefenseAttempts ?? 0)],
      ['反應傷害觸發（初遇 / 盾牌）', (qte.encounterReactionDamageTriggers ?? 0) + ' / ' + (qte.shieldReactionDamageTriggers ?? 0)],
      ['QTE 強化總傷害', formatReportNumber(qte.qteDamage, 2)]
    ];
    const energyRows = [
      ['基礎能量', formatReportNumber(energy.baseEnergy, 2)],
      ['COMBO 額外能量', formatReportNumber(energy.comboBonusEnergy, 2)],
      ['能量增幅卡額外能量', formatReportNumber(energy.upgradeBonusEnergy, 2)],
      ['所有合資格 HIT 能量', formatReportNumber(energy.totalEligibleEnergy, 2)],
      ['滿技能上限時阻擋能量', formatReportNumber(energy.energyBlockedAtMaxCharges, 2)],
      ['技能充滿 / 使用', (energy.chargesEarned ?? 0) + ' / ' + (energy.chargesUsed ?? 0)],
      ['成功跳過怪物', String(energy.successfulMonsterSkips ?? 0)],
      ['剩餘技能 / 能量', (energy.remainingCharges ?? 0) + ' / ' + formatReportNumber(energy.remainingEnergy, 2)]
    ];
    const rhythmRows = [
      ['整體球數 / 完美球', (rhythm.overall?.ballsSpawned ?? 0) + ' / ' + (rhythm.overall?.perfectBalls ?? 0)],
      ['可操作球 / 完美球', (rhythm.overall?.eligibleBalls ?? 0) + ' / ' + (rhythm.overall?.perfectBalls ?? 0)],
      ['低血糖停用球 / 拍點', (rhythm.overall?.disabledBalls ?? 0) + ' / ' + (rhythm.overall?.disabledTargets ?? 0)],
      ['成功 HIT / 漏拍', (rhythm.overall?.targetsHit ?? 0) + ' / ' + (rhythm.overall?.targetsMissed ?? 0)],
      ['整體 HIT 成功率', formatPercent(rhythm.overall?.hitSuccessRate)],
      ['完美球率', formatPercent(rhythm.overall?.perfectBallRate)],
      ['錯誤按鍵', String(rhythm.overall?.incorrectPresses ?? 0)],
      ['最高 COMBO', String(rhythm.maxCombo ?? report.stats?.maxCombo ?? 0)]
    ];
    const purposeNames = { climbing: '一般攀登', combatAttack: '戰鬥攻擊' };
    for (const [purpose, colors] of Object.entries(rhythm.byPurpose ?? {})) {
      for (const [typeId, color] of Object.entries(colors)) {
        rhythmRows.push([
          purposeNames[purpose] + ' · ' + (RHYTHM_TYPES[typeId]?.label ?? typeId),
          '球 ' + color.ballsSpawned + '，HIT ' + color.targetsHit + '，漏拍 ' + color.targetsMissed +
            '，完美 ' + color.perfectBalls + '/' + color.eligibleBalls + '（' + formatPercent(color.hitSuccessRate) + '）' +
            (color.disabledBalls ? '，低血糖停用 ' + color.disabledBalls + ' 球' : '')
        ]);
      }
    }
    const upgradeName = (id) => UPGRADE_CARDS.find((card) => card.id === id)?.name ?? id;
    const upgradeRows = Object.entries(report.upgrades?.counts ?? {}).map(([id, count]) => [upgradeName(id), String(count) + ' 次']);
    const upgradeHistoryRows = (report.upgrades?.history ?? []).map((upgrade, index) => [
      '第 ' + (index + 1) + ' 次 · ' + upgradeName(upgrade.upgradeId),
      upgrade.floor + 'F · ' + formatReportSeconds(upgrade.gameTimeSeconds) + ' · Lv.' + upgrade.level +
        ' · 前：' + formatUpgradeSnapshot(upgrade.valuesBefore) + ' · 後：' + formatUpgradeSnapshot(upgrade.valuesAfter)
    ]);
    const monsterRows = (report.monsterRecords ?? []).map((monster) => {
      const name = monster.monsterName ?? (monster.result === 'skipped' ? '跳過（未遭遇，種類未抽選）' : '未知怪物');
      const resultName = { defeated: '擊敗', skipped: '跳過', pending: '未完成' }[monster.result] ?? monster.result;
      return [
        '#' + (monster.monsterOrdinal ?? '—') + ' ' + name + ' · ' + monster.floor + 'F',
        resultName + ' · 遭遇 ' + monster.encounterAttempts + ' 次' +
          ((monster.encounterHistory?.length ?? 0) > 1 ? '（重遇樓層：' + monster.encounterHistory.slice(1).map((attempt) => attempt.floor + 'F').join('、') + '）' : '') +
          ' · 攻擊 ' + monster.attackRounds + ' 回合 · 實扣 ' + formatReportNumber(monster.totalDamage, 2) +
          ' · 初遇 QTE ' + formatReportNumber(monster.encounterQteDamage, 2) +
          ' · 盾牌 QTE ' + formatReportNumber(monster.shieldQteDamage, 2)
      ];
    });
    const splitRows = (report.floorSplits ?? []).map((split) => [
      split.toFloor + 'F 首次抵達',
      '區間 ' + formatReportSeconds(split.elapsedGameTimeSeconds) + ' · 累計 ' + formatReportSeconds(split.firstReachedGameTimeSeconds)
    ]);
    return [
      resultDetailSection('時間分布', timingRows),
      resultDetailSection('攀登與速度', climbingRows),
      resultDetailSection('速度上限強化歷程', speedUpgradeRows),
      resultDetailSection('分段平均速度', intervalRows),
      resultDetailSection('怪物與戰鬥', combatRows),
      resultDetailSection('怪物遭遇紀錄', monsterRows),
      resultDetailSection('QTE', qteRows),
      resultDetailSection('節奏球與技能充能', rhythmRows.concat(energyRows)),
      resultDetailSection('強化卡取得次數', upgradeRows),
      resultDetailSection('強化卡歷程（含前後數值）', upgradeHistoryRows),
      resultDetailSection('樓層分段（首次抵達）', splitRows)
    ].join('');
  }

  function reportFilename(report) {
    const date = new Date(report?.run?.finishedAt ?? Date.now());
    const pad = (value) => String(value).padStart(2, '0');
    return 'dengfeng-run-' + date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate()) + '-' +
      pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds()) + '.json';
  }

  async function exportRunReport(report) {
    if (!report || typeof document === 'undefined') return '目前沒有可匯出的戰報';
    const json = JSON.stringify(report, null, 2);
    const filename = reportFilename(report);
    try {
      const file = new File([json], filename, { type: 'application/json;charset=utf-8' });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: '登峰灶急戰報', files: [file] });
        return '已開啟分享選單';
      }
    } catch (error) {
      if (error?.name === 'AbortError') return '已取消分享';
    }
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return '戰報已開始下載';
  }

  async function copyRunReport(report) {
    if (!report || typeof document === 'undefined') return '目前沒有可複製的戰報';
    const json = JSON.stringify(report, null, 2);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(json);
        return 'JSON 戰報已複製';
      }
    } catch { /* Fall through to the legacy selection copy for Safari and embedded browsers. */ }
    const textarea = document.createElement('textarea');
    textarea.value = json;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch { copied = false; }
    textarea.remove();
    if (copied) return 'JSON 戰報已複製';
    globalThis.prompt?.('複製下方 JSON 戰報：', json);
    return '已開啟複製備援';
  }

  function viewNodeProgress(state, viewMode) {
    if (state.isTurning) {
      if (viewMode === state.turnFromMode) return state.turnFromProgress;
      if (viewMode === state.turnTargetMode) return state.turnTargetProgress;
    }
    if (viewMode === state.stairViewMode) return state.stairNodeProgress;
    return state.stairNodeProgress + 0.5;
  }

  function updateWallFloorSigns(state) {
    const zeroProgress = Math.max(
      GAME_CONFIG.startFloor,
      Math.min(GAME_CONFIG.maxFloor, viewNodeProgress(state, STAIR_VIEW_MODE.POINT_ZERO))
    );
    const zeroFloor = Math.floor(zeroProgress + 1e-8);
    const upLabel = zeroFloor < GAME_CONFIG.maxFloor ? '↑ ' + (zeroFloor + 1) + 'F' : 'TOP';
    const downLabel = '↓ ' + zeroFloor + 'F';
    if (sceneSignAUp.textContent !== upLabel) sceneSignAUp.textContent = upLabel;
    if (sceneSignADown.textContent !== downLabel) sceneSignADown.textContent = downLabel;

    const halfProgress = Math.max(
      GAME_CONFIG.startFloor,
      Math.min(GAME_CONFIG.maxFloor, viewNodeProgress(state, STAIR_VIEW_MODE.POINT_FIVE))
    );
    const nextFloor = Math.min(GAME_CONFIG.maxFloor, Math.floor(halfProgress + 1e-8) + 1);
    const halfLabel = nextFloor + 'F';
    if (sceneSignBFloor.textContent !== halfLabel) sceneSignBFloor.textContent = halfLabel;
  }

  function sceneCameraAt(progress) {
    const platformApproach = progress <= 0.8
      ? progress / 0.8
      : 1 + (progress - 0.8) * 2;
    return {
      shift: 46 * platformApproach,
      scale: 1 + 0.55 * platformApproach
    };
  }

  function setSceneProgress(svg, progress) {
    const camera = sceneCameraAt(progress);
    const shift = camera.shift.toFixed(2) + '%';
    const scale = camera.scale.toFixed(4);
    if (svg.style.getPropertyValue('--climb-shift') !== shift) svg.style.setProperty('--climb-shift', shift);
    if (svg.style.getPropertyValue('--climb-scale') !== scale) svg.style.setProperty('--climb-scale', scale);
  }

  function ensureTurnSceneCache() {
    if (turnSceneResizeTimer) {
      window.clearTimeout(turnSceneResizeTimer);
      turnSceneResizeTimer = 0;
    }
    const bounds = arena.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return false;
    const pixelRatio = Math.min(2, globalThis.devicePixelRatio || 1);
    const key = bounds.width.toFixed(2) + 'x' + bounds.height.toFixed(2) + '@' + pixelRatio;
    if (key === turnSceneCacheKey && turnSceneCache.ZERO_TO_HALF && turnSceneCache.HALF_TO_ZERO) return true;

    const canvasWidth = Math.round(bounds.width * pixelRatio);
    const canvasHeight = Math.round(bounds.height * pixelRatio);
    if (turnScene.width !== canvasWidth) turnScene.width = canvasWidth;
    if (turnScene.height !== canvasHeight) turnScene.height = canvasHeight;

    const cameraProperties = ['--camera-bob', '--motion-x', '--motion-y'];
    const previousCameraProperties = cameraProperties.map((property) => ({
      property,
      value: arena.style.getPropertyValue(property),
      priority: arena.style.getPropertyPriority(property)
    }));
    cameraProperties.forEach((property) => arena.style.setProperty(property, '0px'));

    try {
      const sourceCamera = sceneCameraAt(1);
      const targetCamera = sceneCameraAt(0);
      const sharedStairs = [
        ...createOfficialStairGeometry(sceneStairs, arena, bounds.width, bounds.height, 0, sourceCamera.shift, sourceCamera.scale, 2),
        ...offsetWorldGeometry(
          createOfficialStairGeometry(sceneStairs, arena, bounds.width, bounds.height, -Math.PI, targetCamera.shift, targetCamera.scale, 2, 100000),
          -TURN_FLIGHT_SPACING
        )
      ];
      const zeroToHalf = [
        ...createOfficialAngleGeometry(sceneA, arena, bounds.width, bounds.height, 0, sourceCamera.shift, sourceCamera.scale, 1),
        ...offsetWorldGeometry(
          createOfficialAngleGeometry(sceneB, arena, bounds.width, bounds.height, -Math.PI, targetCamera.shift, targetCamera.scale, 1, 100000),
          -TURN_FLIGHT_SPACING
        ),
        ...sharedStairs
      ];
      const halfToZero = [
        ...createOfficialAngleGeometry(sceneB, arena, bounds.width, bounds.height, 0, sourceCamera.shift, sourceCamera.scale, 1),
        ...offsetWorldGeometry(
          createOfficialAngleGeometry(sceneA, arena, bounds.width, bounds.height, -Math.PI, targetCamera.shift, targetCamera.scale, 1, 100000),
          -TURN_FLIGHT_SPACING
        ),
        ...sharedStairs
      ];
      turnSceneCache.ZERO_TO_HALF = zeroToHalf;
      turnSceneCache.HALF_TO_ZERO = halfToZero;
      turnSceneCacheKey = key;
      return true;
    } finally {
      previousCameraProperties.forEach(({ property, value, priority }) => {
        if (value) arena.style.setProperty(property, value, priority);
        else arena.style.removeProperty(property);
      });
    }
  }

  function scheduleTurnScenePreload(delay = 0) {
    if (turnSceneResizeTimer) window.clearTimeout(turnSceneResizeTimer);
    turnSceneResizeTimer = window.setTimeout(() => {
      turnSceneResizeTimer = 0;
      requestAnimationFrame(ensureTurnSceneCache);
    }, delay);
  }

  if (typeof ResizeObserver !== 'undefined') {
    turnSceneResizeObserver = new ResizeObserver(() => scheduleTurnScenePreload(120));
    turnSceneResizeObserver.observe(arena);
  }
  window.addEventListener('resize', () => scheduleTurnScenePreload(120), { passive: true });
  requestAnimationFrame(ensureTurnSceneCache);

  function monsterPresenceMarkup(monster, className = '') {
    return '<div class="monster-presence monster-' + escapeHtml(monster.id) + (className ? ' ' + className : '') + '" aria-hidden="true"><span class="monster-horns"></span><span class="monster-eye left-eye"></span><span class="monster-eye right-eye"></span><span class="monster-mouth"></span><i class="monster-arm arm-left"></i><i class="monster-arm arm-right"></i></div>';
  }

  function monsterVitalsMarkup(monster, hp, maxHp) {
    const safeMaxHp = Math.max(1, Number(maxHp) || GAME_CONFIG.monsterBaseHp);
    const safeHp = Math.max(0, Math.min(safeMaxHp, Number(hp) || 0));
    const displayedHp = formatCombatNumber(safeHp);
    const displayedMaxHp = formatCombatNumber(safeMaxHp);
    return '<div class="monster-vitals" aria-label="' + escapeHtml(monster.name) + ' HP ' + displayedHp + ' / ' + displayedMaxHp + '">' +
      '<strong class="monster-vitals-name">' + escapeHtml(monster.name) + '</strong>' +
      '<span class="monster-hp-track"><span class="monster-hp-fill" style="width:' + ((safeHp / safeMaxHp) * 100) + '%"></span></span>' +
      '<span class="monster-hp-value">' + displayedHp + '/' + displayedMaxHp + '</span>' +
    '</div>';
  }

  function combatMonsterMarkup(state, mode) {
    if (!state.activeMonster) return '';
    const defeated = mode === 'COMBAT_VICTORY' ? ' is-defeated' : '';
    return monsterPresenceMarkup(state.activeMonster, 'is-settled' + defeated) +
      monsterVitalsMarkup(state.activeMonster, state.monsterHp, state.monsterMaxHp);
  }

  function buildCombatDefenseMarkup(round, { shieldVisible = false, showVortex = true, showInstruction = false } = {}) {
    if (!round) return '';
    const impactSplashes = round.attacks.map((attack) =>
      '<span class="defense-impact-splash" data-impact-id="' + escapeHtml(attack.id) + '" aria-hidden="true" hidden></span>'
    ).join('');
    const shield = round.shield;
    const arenaRect = arena.getBoundingClientRect();
    const rhythmPanel = track.closest('.rhythm-panel');
    const rhythmPanelRect = rhythmPanel?.getBoundingClientRect();
    if (arenaRect.height > 0 && rhythmPanelRect?.height > 0) {
      const viewportWidth = globalThis.innerWidth || gameRoot.clientWidth;
      const shieldHeight = Math.min(124, Math.max(96, viewportWidth * 0.26));
      const safeCenterY = rhythmPanelRect.top - arenaRect.top - shieldHeight / 2 - 8;
      const safeYPercent = safeCenterY / arenaRect.height * 100;
      shield.y = Math.min(
        GAME_CONFIG.combatDefenseShieldY,
        Math.max(0, safeYPercent)
      );
    }
    const visibleClass = shieldVisible ? ' is-visible' : '';
    const laserStartY = GAME_CONFIG.combatDefenseVortexY;
    const blockedLaserHeight = Math.max(0, Number(shield.y) - laserStartY);
    const piercingLaserHeight = blockedLaserHeight + GAME_CONFIG.combatDefenseLaserPierceAfterShieldPercent;
    const lasers = round.attacks.map((attack) =>
      '<span class="defense-laser" data-laser-id="' + escapeHtml(attack.id) + '" aria-hidden="true" ' +
      'style="--laser-progress:0;--laser-impact-start-progress:' +
      (piercingLaserHeight > 0 ? blockedLaserHeight / piercingLaserHeight : 1) + '" hidden></span>'
    ).join('');
    const shieldMarkup = '<div class="defense-shield is-' + escapeHtml(round.shieldColor) + visibleClass + '" ' +
      'style="left:' + Number(shield.x) + '%;top:' + Number(shield.y) + '%" ' +
      'aria-label="' + (round.shieldColor === 'red' ? '紅盾，防禦兩次攻擊' : '藍盾，防禦三次攻擊') + '">' +
      '<svg viewBox="0 0 48 56" aria-hidden="true"><path d="M24 3 43 10v15c0 13-8 22-19 28C13 47 5 38 5 25V10z"/></svg>' +
      '<svg class="defense-shield-cracks" viewBox="0 0 48 56" aria-hidden="true" hidden>' +
      '<path class="defense-crack-outline" d="M24 27 20 21 22 16 17 11 M20 21 14 22 10 18 M24 27 28 21 26 15 31 10 M28 21 35 22 39 18 M24 27 18 26 13 24 8 26 M13 24 11 20 M24 27 30 27 36 25 40 28 M36 25 39 22 M24 27 20 33 22 39 17 46 M20 33 14 31 10 36 M24 27 28 33 26 39 31 46 M28 33 35 31 39 36"/>' +
      '<path class="defense-crack-core" d="M24 27 20 21 22 16 17 11 M20 21 14 22 10 18 M24 27 28 21 26 15 31 10 M28 21 35 22 39 18 M24 27 18 26 13 24 8 26 M13 24 11 20 M24 27 30 27 36 25 40 28 M36 25 39 22 M24 27 20 33 22 39 17 46 M20 33 14 31 10 36 M24 27 28 33 26 39 31 46 M28 33 35 31 39 36"/>' +
      '</svg>' +
      '<b>×' + round.attackCount + '</b></div>';
    const vortex = showVortex
      ? '<div class="defense-vortex is-' + escapeHtml(round.shieldColor) + '" aria-hidden="true"><i></i><i></i><i></i></div>'
      : '';
    const instruction = showInstruction
      ? '<p class="combat-defense-instruction">SPACE／點擊畫面任意處防禦</p>'
      : '';
    return '<div class="combat-defense-field is-' + escapeHtml(round.shieldColor) + '" style="--laser-color:' +
      escapeHtml(round.laserColor) + ';--shield-y:' + Number(shield.y) + '%;--laser-start-y:' + laserStartY +
      '%;--laser-blocked-height:' + blockedLaserHeight + '%;--laser-pierce-height:' + piercingLaserHeight +
      '%;--combat-defense-vortex-flash-duration:' + GAME_CONFIG.combatDefenseVortexFlashDurationMs +
      'ms;--combat-defense-success-impact-duration:' + GAME_CONFIG.combatDefenseSuccessImpactDurationMs +
      'ms;--combat-defense-success-splash-duration:' + GAME_CONFIG.combatDefenseSuccessSplashDurationMs +
      'ms;--combat-defense-success-splash-opacity:' + GAME_CONFIG.combatDefenseSuccessSplashOpacity +
      '" aria-label="依盾牌亮起時按操作鍵防禦">' +
      vortex + lasers + impactSplashes + shieldMarkup + instruction + '</div>';
  }

  function appendQteTiles(grid, qte) {
    const positions = [
      [14, 12], [39, 8], [66, 16], [87, 11], [23, 41], [55, 35],
      [84, 45], [10, 67], [39, 76], [69, 68], [91, 82], [53, 93]
    ];
    qte.tiles.forEach((tile) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'letter-tile';
      if (/^[+0-9]$/.test(tile.letter)) button.classList.add('is-symbol-tile');
      button.dataset.tileId = tile.id;
      button.textContent = tile.letter;
      const position = positions[Number(tile.id.slice(5)) % positions.length];
      button.style.left = position[0] + '%';
      button.style.top = position[1] + '%';
      button.style.setProperty('--tile-tilt', (Number(tile.id.slice(5)) % 2 ? '5deg' : '-4deg'));
      button.setAttribute('aria-label', 'QTE 字元 ' + tile.letter);
      grid.append(button);
    });
  }

  function buildCombatView(state, mode) {
    const monster = state.activeMonster;
    if (!monster) return;
    const monsterMarkup = combatMonsterMarkup(state, mode);
    let phaseMarkup = '';
    if (mode === 'COMBAT_ATTACK_INTRO') {
      phaseMarkup = '<p class="combat-round-prompt is-attack">' + escapeHtml(UI_TEXT.combatAttackRound) + '</p>';
    } else if (mode === 'COMBAT_ATTACK') {
      phaseMarkup = '<span class="player-attack-projectile" aria-hidden="true"></span>';
    } else if (mode === 'COMBAT_ATTACK_SETTLE') {
      phaseMarkup = '<span class="player-attack-projectile is-firing" aria-hidden="true"></span>' +
        '<p class="combat-feedback combat-damage-label">DMG ' + formatCombatNumber(Math.max(0, Number(state.combatPendingDamage) || 0)) + '</p>';
    } else if (mode === 'COMBAT_DEFENSE_INTRO') {
      phaseMarkup = '<p class="combat-round-prompt is-defense">' + escapeHtml(UI_TEXT.combatDefenseRound) + '</p>' +
        buildCombatDefenseMarkup(state.combatDefenseRound, { shieldVisible: false, showVortex: true });
    } else if (mode === 'COMBAT_DEFENSE') {
      phaseMarkup = buildCombatDefenseMarkup(state.combatDefenseRound, {
        shieldVisible: true,
        showVortex: true,
        showInstruction: true
      });
    } else if (mode === 'COMBAT_DEFENSE_SUCCESS') {
      const defenseRound = state.combatDefenseRound;
      phaseMarkup = buildCombatDefenseMarkup(defenseRound, { shieldVisible: true, showVortex: false }) +
        '<p class="combat-feedback">' + escapeHtml(UI_TEXT.combatDefenseSuccess) + '</p>';
    } else if (mode === 'COMBAT_DEFENSE_FAILED') {
      phaseMarkup = buildCombatDefenseMarkup(state.combatDefenseRound, { shieldVisible: true, showVortex: false }) +
        '<p class="combat-feedback combat-defense-failed">' + escapeHtml(UI_TEXT.combatDefenseFailure) + '</p>';
    } else if (mode === 'COMBAT_VICTORY') {
      phaseMarkup = '<p class="combat-feedback combat-victory-label">' + escapeHtml(UI_TEXT.combatMonsterDefeated) + '</p>';
    }
    qteLayer.innerHTML = '<div class="qte-card combat-card">' + monsterMarkup + phaseMarkup + '</div>';
    qteLayer.classList.remove('is-urgent');
    qteLayer.style.removeProperty('--monster-entrance-delay');
    qteLayer.style.removeProperty('--monster-cast-delay');
    qteLayer.style.removeProperty('--combat-attack-delay');
    qteLayer.style.setProperty('--combat-round-intro-duration',
      (mode === 'COMBAT_DEFENSE_INTRO'
        ? GAME_CONFIG.combatDefenseVortexChargeDurationMs
        : GAME_CONFIG.combatRoundIntroDurationMs) + 'ms');
    if (mode === 'COMBAT_ATTACK_SETTLE') {
      qteLayer.style.setProperty('--combat-attack-delay', -(GAME_CONFIG.combatPlayerAttackDurationMs - state.eventPhaseDurationMs) + 'ms');
    }
    lastQteObject = null;
    lastQteMessage = '';
    lastCombatViewMode = mode;
  }

  function updateCombatDefenseRound(round, state, mode) {
    if (!round) return;
    const isResultPhase = mode === 'COMBAT_DEFENSE_SUCCESS' || mode === 'COMBAT_DEFENSE_FAILED';
    const nowMs = round.elapsedMs + (isResultPhase ? state.eventPhaseElapsedMs : 0);
    round.attacks.forEach((attack) => {
      const laser = qteLayer.querySelector('[data-laser-id="' + attack.id + '"]');
      const impactElapsedMs = nowMs - attack.attackTimeMs;
      if (laser) {
        const inFlight = nowMs >= attack.launchTimeMs && nowMs < attack.attackTimeMs &&
          ['scheduled', 'active', 'defended'].includes(attack.status);
        const inImpact = ['blocked', 'missed'].includes(attack.status) && impactElapsedMs >= 0 &&
          impactElapsedMs < GAME_CONFIG.combatDefenseLaserDurationMs;
        const visible = inFlight || inImpact;
        const flightProgress = attack.flightDurationMs > 0
          ? Math.max(0, Math.min(1, (nowMs - attack.launchTimeMs) / attack.flightDurationMs))
          : (nowMs >= attack.launchTimeMs ? 1 : 0);
        const impactStatus = inImpact ? attack.status : '';
        const impactStatusChanged = impactStatus && laser.dataset.impactStatus !== impactStatus;
        if (impactStatusChanged) {
          laser.classList.remove('is-blocked', 'is-piercing');
          laser.style.animationDelay = '-' + Math.max(0, impactElapsedMs) + 'ms';
          void laser.offsetWidth;
          laser.dataset.impactStatus = impactStatus;
        } else if (!impactStatus && laser.dataset.impactStatus) {
          delete laser.dataset.impactStatus;
          laser.style.removeProperty('animation-delay');
        }
        laser.hidden = !visible;
        laser.style.setProperty('--laser-progress', String(inImpact ? 1 : flightProgress));
        laser.classList.toggle('is-flying', inFlight);
        laser.classList.toggle('is-blocked', inImpact && attack.status === 'blocked');
        laser.classList.toggle('is-piercing', inImpact && attack.status === 'missed');
      }

      const splash = qteLayer.querySelector('[data-impact-id="' + attack.id + '"]');
      if (!splash) return;
      const splashDurationMs = attack.status === 'blocked'
        ? GAME_CONFIG.combatDefenseSuccessSplashDurationMs
        : GAME_CONFIG.combatDefenseHitEffectDurationMs;
      const splashVisible = ['blocked', 'missed'].includes(attack.status) && impactElapsedMs >= 0 &&
        impactElapsedMs < splashDurationMs;
      splash.hidden = !splashVisible;
      if (splashVisible && splash.dataset.effect !== attack.status) {
        splash.dataset.effect = attack.status;
        splash.classList.remove('is-active', 'is-white', 'is-red', 'is-blue');
        splash.classList.add(attack.status === 'blocked' ? 'is-white' : round.shieldColor === 'red' ? 'is-red' : 'is-blue');
        splash.style.animationDelay = '-' + Math.max(0, impactElapsedMs) + 'ms';
        void splash.offsetWidth;
        splash.classList.add('is-active');
      } else if (!splashVisible && splash.dataset.effect) {
        delete splash.dataset.effect;
        splash.classList.remove('is-active', 'is-white', 'is-red', 'is-blue');
        splash.style.removeProperty('animation-delay');
      }
    });

    const shield = qteLayer.querySelector('.defense-shield');
    if (!shield) return;
    const shots = round.attacks;
    const active = shots.some((attack) => attack.status === 'active');
    const defended = shots.some((attack) => attack.status === 'defended');
    const blocked = shots.some((attack) => attack.status === 'blocked' &&
      nowMs >= attack.attackTimeMs && nowMs - attack.attackTimeMs < GAME_CONFIG.combatDefenseSuccessImpactDurationMs);
    const missed = shots.some((attack) => attack.status === 'missed' &&
      nowMs >= attack.attackTimeMs && nowMs - attack.attackTimeMs < GAME_CONFIG.combatDefenseLaserDurationMs);
    shield.classList.toggle('is-active', active);
    shield.classList.toggle('is-defended', defended);
    shield.classList.toggle('is-blocked', blocked);
    shield.classList.toggle('is-missed', missed);
    shield.classList.toggle('is-complete', round.resolvedCount >= round.attackCount);
    const crackAttack = round.shieldCracked
      ? shots.find((attack) => attack.id === round.shieldCrackAttackId)
      : null;
    const cracks = shield.querySelector('.defense-shield-cracks');
    if (cracks) {
      const isCracked = Boolean(crackAttack);
      const crackAgeMs = isCracked ? Math.max(0, nowMs - round.shieldCrackImpactAtMs) : 0;
      const impactDurationMs = GAME_CONFIG.combatDefenseShieldImpactReactionDurationMs;
      cracks.hidden = !isCracked;
      cracks.classList.toggle('is-active', isCracked);
      shield.classList.toggle('is-cracked', isCracked);
      shield.classList.toggle('is-crack-impact', isCracked && crackAgeMs < impactDurationMs);
      if (isCracked && cracks.dataset.attackId !== crackAttack.id) {
        cracks.dataset.attackId = crackAttack.id;
        shield.style.setProperty('--combat-defense-shield-impact-duration', impactDurationMs + 'ms');
        shield.style.animationDelay = '-' + Math.min(crackAgeMs, impactDurationMs) + 'ms';
        void cracks.offsetWidth;
      } else if (!isCracked && cracks.dataset.attackId) {
        delete cracks.dataset.attackId;
        shield.classList.remove('is-crack-impact');
        shield.style.removeProperty('--combat-defense-shield-impact-duration');
        shield.style.removeProperty('animation-delay');
      }
    }
    shield.setAttribute('aria-label', (round.shieldColor === 'red' ? '紅盾，' : '藍盾，') +
      (active ? '現在按下防禦' : defended ? '已按下，等待雷射發射' : '待命'));

    const vortex = qteLayer.querySelector('.defense-vortex');
    if (vortex) {
      if (vortex.dataset.flashEndListener !== 'true') {
        vortex.dataset.flashEndListener = 'true';
        vortex.addEventListener('animationend', (event) => {
          if (event.animationName !== 'defense-vortex-rhythm-flash') return;
          vortex.classList.remove('is-rhythm-flash');
          vortex.style.removeProperty('--vortex-flash-delay');
        });
      }
      const flashSerial = Number(round.vortexFlashSerial) || 0;
      const renderedFlashSerial = Number(vortex.dataset.flashSerial) || 0;
      if (flashSerial !== renderedFlashSerial) {
        vortex.dataset.flashSerial = String(flashSerial);
        vortex.classList.remove('is-rhythm-flash');
        vortex.style.setProperty('--vortex-flash-delay', '0ms');
        void vortex.offsetWidth;
        vortex.classList.add('is-rhythm-flash');
      }
    }
  }

  function updateCombatVitals(state) {
    const fill = qteLayer.querySelector('.monster-hp-fill');
    const value = qteLayer.querySelector('.monster-hp-value');
    const vitals = qteLayer.querySelector('.monster-vitals');
    if (!fill || !value || !vitals) return;
    const maxHp = Math.max(1, state.monsterMaxHp ?? GAME_CONFIG.monsterBaseHp);
    const hp = Math.max(0, Math.min(maxHp, state.monsterHp ?? maxHp));
    fill.style.width = ((hp / maxHp) * 100) + '%';
    const displayedHp = formatCombatNumber(hp);
    const displayedMaxHp = formatCombatNumber(maxHp);
    value.textContent = displayedHp + '/' + displayedMaxHp;
    vitals.setAttribute('aria-label', state.activeMonster.name + ' HP ' + displayedHp + ' / ' + displayedMaxHp);
  }

  function buildMonsterEntrance(monster, elapsedMs = 0, hp = GAME_CONFIG.monsterBaseHp, maxHp = GAME_CONFIG.monsterBaseHp) {
    const entranceElapsedMs = Math.min(GAME_CONFIG.monsterEntranceDurationMs, Math.max(0, elapsedMs));
    qteLayer.style.setProperty('--monster-entrance-delay', -entranceElapsedMs + 'ms');
    qteLayer.classList.remove('is-urgent');
    qteLayer.innerHTML = '<div class="qte-card qte-entrance-card">' +
      monsterPresenceMarkup(monster, 'is-descending') +
      monsterVitalsMarkup(monster, hp, maxHp) +
      '<span class="monster-cast-energy" aria-hidden="true"></span>' +
      '<span class="monster-hit-flare" aria-hidden="true"></span>' +
      '</div>';
    lastQteMessage = '';
    lastQteObject = null;
  }

  function showAnswerPreview(qte, compact = false) {
    const card = qteLayer.querySelector('.qte-card');
    if (!card || !qte?.monster || card.querySelector('.answer-preview')) return;
    const isDefenseRecovery = qte.context === QTE_CONTEXT.DEFENSE_RECOVERY;
    const preview = document.createElement('div');
    preview.className = 'answer-preview' + (compact ? ' is-compact' : '') +
      (isDefenseRecovery ? ' is-defense-recovery' : '');
    preview.setAttribute('role', 'status');
    preview.setAttribute('aria-label', isDefenseRecovery ? '防禦補救 QTE 正確解法' : '本次 QTE 可選答案');
    const [first, second] = (qte.solutions ?? qte.monster.solutions ?? []).slice(0, 2);
    if (first) {
      const firstWord = document.createElement('strong');
      firstWord.className = 'answer-preview-word answer-preview-primary';
      firstWord.textContent = first.word;
      preview.append(firstWord);
    }
    if (!isDefenseRecovery && first && second) {
      const separator = document.createElement('span');
      separator.className = 'answer-preview-or';
      separator.textContent = 'OR';
      preview.append(separator);
    }
    if (!isDefenseRecovery && second) {
      const secondWord = document.createElement('strong');
      secondWord.className = 'answer-preview-word answer-preview-secondary';
      secondWord.textContent = second.word;
      preview.append(secondWord);
    }
    const hint = document.createElement('span');
    hint.className = 'answer-preview-hint';
    hint.textContent = isDefenseRecovery ? '依序輸入，避免新增減益' : '依序輸入，解除減益';
    preview.append(hint);
    card.append(preview);
  }

  function buildQte(qte) {
    const monster = qte.monster;
    const settledMonster = qteLayer.querySelector('.monster-presence');
    qteLayer.style.removeProperty('--monster-entrance-delay');
    qteLayer.style.removeProperty('--monster-cast-delay');
    qteLayer.innerHTML =
      '<div class="qte-card">' +
        '<div class="qte-banner">' +
          '<div class="qte-topline"><span class="qte-alert">QTE</span><span class="qte-clock" id="qte-clock">' + (qte.remainingMs / 1000).toFixed(1) + 's</span></div>' +
          '<div class="qte-timer-track"><span id="qte-timer-bar"></span></div>' +
        '</div>' +
        monsterPresenceMarkup(monster) +
        monsterVitalsMarkup(monster, qte.monsterHp ?? GAME_CONFIG.monsterBaseHp, qte.monsterMaxHp ?? GAME_CONFIG.monsterBaseHp) +
        '<p class="qte-message" id="qte-message" aria-live="polite"></p>' +
        '<div class="letter-grid" id="letter-grid"></div>' +
      '</div>';
    showAnswerPreview(qte, qte.context !== QTE_CONTEXT.DEFENSE_RECOVERY);
    const qteMonster = qteLayer.querySelector('.monster-presence');
    if (settledMonster && qteMonster) {
      settledMonster.classList.remove('is-descending');
      settledMonster.classList.add('is-settled');
      qteMonster.replaceWith(settledMonster);
    }
    const grid = byId('letter-grid');
    lastQteMessage = '';
    appendQteTiles(grid, qte);
  }

  function buildQteItemUse(itemUse, state) {
    const presentation = QTE_ITEM_PRESENTATIONS[itemUse.itemId] ?? {
      id: 'generic', name: itemUse.word || '解法道具', visual: 'wordmark',
      fallbackText: itemUse.word || 'ITEM', accent: 'blue'
    };
    const visual = presentation.visual === 'image' && presentation.assetPath
      ? '<img class="qte-item-image" src="' + escapeHtml(presentation.assetPath) + '" data-fallback-text="' + escapeHtml(presentation.fallbackText ?? itemUse.word ?? 'ITEM') + '" alt="" draggable="false" />'
      : '<span class="qte-item-wordmark" aria-hidden="true">' + escapeHtml(presentation.fallbackText ?? itemUse.word ?? 'ITEM') + '</span>';
    const monster = state.activeMonster;
    const monsterMarkup = monster
      ? monsterPresenceMarkup(monster, 'is-settled') + monsterVitalsMarkup(monster, state.monsterHp, state.monsterMaxHp)
      : '';
    qteLayer.style.removeProperty('--monster-entrance-delay');
    qteLayer.style.removeProperty('--monster-cast-delay');
    qteLayer.style.setProperty('--qte-item-entrance-duration', GAME_CONFIG.qteItemEntranceDurationMs + 'ms');
    qteLayer.style.setProperty('--qte-item-message-duration', GAME_CONFIG.qteItemMessageEntranceDurationMs + 'ms');
    qteLayer.style.setProperty('--qte-item-fade-duration', GAME_CONFIG.qteItemFadeDurationMs + 'ms');
    qteLayer.style.setProperty('--qte-item-transition-duration', GAME_CONFIG.qteItemWhiteTransitionDurationMs + 'ms');
    qteLayer.innerHTML = '<div class="qte-card qte-item-card">' + monsterMarkup +
      '<div class="qte-item-presentation' + (presentation.visual === 'image' ? ' is-image-item' : '') + '" data-item-id="' + escapeHtml(presentation.id ?? itemUse.itemId ?? 'generic') + '" data-accent="' + escapeHtml(presentation.accent ?? 'blue') + '">' +
        '<div class="qte-item-art" role="img" aria-label="' + escapeHtml(presentation.name ?? itemUse.word ?? '解法道具') + '">' + visual +
          '<span class="qte-item-flare" aria-hidden="true"></span>' +
        '</div>' +
        '<p class="qte-item-message">' + escapeHtml(itemUse.message) + '</p>' +
      '</div>' +
    '</div>';
    const presentationElement = qteLayer.querySelector('.qte-item-presentation');
    if (presentationElement && presentation.visual === 'image') {
      presentationElement.style.setProperty('--item-image-scale', String(presentation.visualScale ?? 1));
    }
    const productImage = qteLayer.querySelector('.qte-item-image');
    if (productImage) {
      const showFallback = () => {
        const fallback = document.createElement('span');
        fallback.className = 'qte-item-wordmark';
        fallback.setAttribute('aria-hidden', 'true');
        fallback.textContent = productImage.dataset.fallbackText || itemUse.word || 'ITEM';
        productImage.replaceWith(fallback);
      };
      productImage.addEventListener('error', showFallback, { once: true });
      if (productImage.complete && productImage.naturalWidth === 0) showFallback();
    }
    lastQteMessage = '';
    lastQteObject = null;
  }

  function updateQte(qte) {
    if (lastQteObject !== qte) {
      buildQte(qte);
      lastQteObject = qte;
    }
    const ratio = Math.max(0, qte.remainingMs / qte.durationMs);
    qteLayer.classList.toggle('is-urgent', ratio <= 0.25);
    byId('qte-timer-bar').style.transform = 'scaleX(' + ratio + ')';
    byId('qte-clock').textContent = (qte.remainingMs / 1000).toFixed(1) + 's';
    const message = qte.message ?? '';
    byId('qte-message').textContent = message;
    if (message && message !== lastQteMessage) {
      const card = qteLayer.querySelector('.qte-card');
      card.classList.remove('is-shaking');
      void card.offsetWidth;
      card.classList.add('is-shaking');
    }
    lastQteMessage = message;
    qte.tiles.forEach((tile) => {
      const button = qteLayer.querySelector('[data-tile-id="' + tile.id + '"]');
      if (!button) return;
      button.classList.toggle('is-used', !tile.visible);
      button.disabled = !tile.visible;
      button.setAttribute('aria-label', tile.visible ? 'QTE 字元 ' + tile.letter : 'QTE 字元 ' + tile.letter + ' 已選');
    });
  }

  function updateRhythmTrack(state, game) {
    const activeMode = state.mode === 'PAUSED' ? state.resumeMode : state.mode;
    const rapidTap = activeMode === 'COMBAT_RAPID_TAP' ? state.combatRapidTap : null;
    const rapidTapControlsActive = Boolean(rapidTap && !rapidTap.disabled);
    if (desktopControlHint) desktopControlHint.textContent = rapidTapControlsActive ? 'A / D 連打' : 'SPACE';
    if (mobileControlHint) mobileControlHint.textContent = rapidTapControlsActive ? '觸控連打' : '點擊任意處';
    if (controlHintCopy) controlHintCopy.textContent = rapidTapControlsActive
      ? (globalThis.matchMedia?.('(pointer: coarse)')?.matches ? '快速輸出' : '可同時按')
      : '依序踩拍';
    const mobileWobble = globalThis.matchMedia?.('(max-width: 600px)')?.matches ?? false;
    const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
    const heartProfile = [mobileWobble, reducedMotion, state.antiDizzinessMode].join(':');
    if (heartProfile !== lastHeartWobbleProfile) {
      lastHeartWobbleProfile = heartProfile;
      const scale = (mobileWobble ? GAME_CONFIG.heartPalpitationsMobileAmplitudeScale : 1) *
        (state.antiDizzinessMode === ANTI_DIZZINESS_MODE.ON ? GAME_CONFIG.heartPalpitationsReducedAmplitudeScale : 1) *
        (reducedMotion ? GAME_CONFIG.heartPalpitationsReducedAmplitudeScale : 1);
      const x = GAME_CONFIG.heartPalpitationsWobbleXAmplitudePx * scale;
      const y = GAME_CONFIG.heartPalpitationsWobbleYAmplitudePx * scale;
      trackShake.style.setProperty('--heart-wobble-x', x + 'px');
      trackShake.style.setProperty('--heart-wobble-y', y + 'px');
      trackShake.style.setProperty('--heart-wobble-mid-x', x * .55 + 'px');
      trackShake.style.setProperty('--heart-wobble-mid-y', y * .5 + 'px');
      trackShake.style.setProperty('--heart-wobble-small-x', x * .28 + 'px');
      trackShake.style.setProperty('--heart-wobble-small-y', y * .22 + 'px');
      trackShake.style.setProperty('--heart-wobble-tiny-x', x * .2 + 'px');
      trackShake.style.setProperty('--heart-wobble-tiny-y', y * .2 + 'px');
    }
    const round = state.rhythmRound;
    const windows = game.getRhythmHitWindows();
    const ballDiameter = 25;
    const ballRadius = ballDiameter / 2;
    const edgeInset = ballRadius + GAME_CONFIG.rhythmBallEdgeGapPx;
    const trackPosition = (progress) => 'calc(' + (progress * 100) + '% + ' + (edgeInset - 2 * edgeInset * progress) + 'px)';
    if (round !== lastRhythmRound) {
      track.classList.remove('is-rhythm-hit', 'is-rhythm-miss', 'is-feedback-active');
      trackZones.replaceChildren(...windows.map((window) => {
        const marker = document.createElement('span');
        marker.className = 'track-zone';
        marker.dataset.beat = String(window.beat);
        return marker;
      }));
      lastRhythmRound = round;
      track.dataset.rhythmType = round?.typeId ?? '';
      track.setAttribute('aria-label', round ? round.label + '節奏軌道' : '節奏判定軌道');
      const ringScale = GAME_CONFIG.rhythmReadyRingStartScale;
      ballVisual.style.setProperty('--rhythm-ready-flash-duration', GAME_CONFIG.rhythmReadyFlashMs + 'ms');
      ballVisual.style.setProperty('--rhythm-ready-ring-size', (ringScale * 100) + '%');
    }

    if (rapidTap?.disabled) {
      rhythmLabel.textContent = '連打已停用';
      rhythmLabel.classList.remove('is-rapid-tap-counter', 'is-tap-pop', 'is-low-blood-sugar-disabled');
      rhythmLabel.classList.add('is-rapid-tap-disabled');
    } else if (rapidTap) {
      rhythmLabel.textContent = '連打 ×' + rapidTap.tapCount;
      rhythmLabel.classList.remove('is-rapid-tap-disabled', 'is-tap-pop', 'is-low-blood-sugar-disabled');
      rhythmLabel.classList.add('is-rapid-tap-counter');
    } else if (round) {
      rhythmLabel.classList.remove('is-rapid-tap-counter', 'is-rapid-tap-disabled', 'is-low-blood-sugar-disabled', 'is-tap-pop');
      rhythmLabel.textContent = round.isLowBloodSugarDisabled
        ? '低血糖｜暫時無法操作'
        : round.inputLocked
        ? '按鍵額度已用完'
        : (activeMode === 'COMBAT_ATTACK' ? '攻擊回合 · ' : '') +
          round.label + ' · ' + round.successCount + '/' + round.hitBeats.length;
      if (round.inputLocked) rhythmLabel.classList.add('is-rapid-tap-disabled');
      if (round.isLowBloodSugarDisabled) rhythmLabel.classList.add('is-low-blood-sugar-disabled');
    } else {
      rhythmLabel.classList.remove('is-rapid-tap-counter', 'is-rapid-tap-disabled', 'is-low-blood-sugar-disabled', 'is-tap-pop');
      const rhythmModeLabels = {
        COMBAT_ATTACK_INTRO: '準備攻擊',
        COMBAT_RAPID_TAP: '連打輸出',
        COMBAT_DEFENSE_INTRO: '準備防禦',
        COMBAT_DEFENSE: 'SPACE／點擊任意處防禦',
        MONSTER_QTE: 'QTE 中斷節奏'
      };
      rhythmLabel.textContent = rhythmModeLabels[activeMode] ?? '等待節奏球';
    }
    windows.forEach((window, index) => {
      const marker = trackZones.children[index];
      if (!marker) return;
      marker.style.left = trackPosition(window.center);
      marker.style.width = 'calc(' + (window.width * 100) + '% - ' + (2 * edgeInset * window.width) + 'px)';
      marker.classList.toggle('is-current', window.status === 'current');
      marker.classList.toggle('is-complete', window.status === 'success');
      marker.classList.toggle('is-fail', window.status === 'fail');
      marker.classList.toggle('is-missed', window.status === 'missed');
      marker.classList.toggle('is-locked', window.status === 'locked');
      marker.dataset.status = window.status;
    });

    const rapidTapActive = Boolean(rapidTap && !rapidTap.disabled);
    const ballVisible = Boolean((round && round.phase !== RHYTHM_PHASE.FINISHED) || rapidTapActive);
    ball.hidden = !ballVisible;
    ball.style.display = ballVisible ? 'block' : 'none';
    const ballProgress = rapidTapActive
      ? rapidTap.elapsedMs / Math.max(1, rapidTap.durationMs)
      : game.getBallPosition();
    const normalizedBallProgress = Math.max(0, Math.min(1, Number.isFinite(ballProgress) ? ballProgress : 0));
    const ballX = edgeInset + normalizedBallProgress * Math.max(0, rhythmTrackWidth - edgeInset * 2);
    ball.style.transform = 'translate3d(' + ballX.toFixed(3) + 'px, 0, 0)';
    ballVisual.style.setProperty('--rhythm-ball-color', rapidTapActive ? '#ffd166' : round?.color ?? '#ff8038');
    ballVisual.style.setProperty('--rhythm-ball-scale', String(GAME_CONFIG.combatRapidTapBallScale));
    const isReady = round?.phase === RHYTHM_PHASE.SPAWN_READY;
    const readyProgress = isReady
      ? Math.max(0, Math.min(1, (round.readyElapsedMs ?? 0) / Math.max(1, round.readyDurationMs ?? 1)))
      : 1;
    const ringEndScale = 1 / GAME_CONFIG.rhythmReadyRingStartScale;
    ballVisual.style.setProperty('--rhythm-ready-ring-scale', String(1 - readyProgress * (1 - ringEndScale)));
    ballVisual.style.setProperty('--rhythm-ready-ring-opacity', String(isReady ? .92 * (1 - readyProgress) : 0));
    ballVisual.classList.toggle('is-ready', isReady);
    ballVisual.classList.toggle('is-paused', state.mode === 'PAUSED');
    ballVisual.classList.toggle('is-rapid-tap-ball', rapidTapActive);
    track.classList.toggle('is-rapid-tap', rapidTapActive);
    track.classList.toggle('is-rapid-tap-disabled', Boolean(rapidTap?.disabled));
    track.classList.toggle('is-low-blood-sugar-disabled', Boolean(round?.isLowBloodSugarDisabled));
    track.dataset.lowBloodSugarDisabled = round?.isLowBloodSugarDisabled ? 'true' : '';
    const isRoundResolved = round?.phase === RHYTHM_PHASE.RESOLVED || round?.phase === RHYTHM_PHASE.FINISHED;
    const blackSpotsSeverity = Math.max(0, Math.min(3, Number(state.debuffs?.BLACK_SPOTS?.severity) || 0));
    track.dataset.blackSpots = blackSpotsSeverity ? String(blackSpotsSeverity) : '';
    const heartbeatTrackMode = ['CLIMBING', 'COMBAT_ATTACK', 'COMBAT_RAPID_TAP'].includes(activeMode);
    const shouldWobble = Boolean(
      heartbeatTrackMode &&
      state.debuffs?.HEART_PALPITATIONS &&
      state.heartPalpitationsWobbleRemainingMs > 0
    );
    if (shouldWobble && state.heartPalpitationsWobbleSerial !== lastHeartWobbleSerial) {
      lastHeartWobbleSerial = state.heartPalpitationsWobbleSerial;
      trackShake.classList.remove('is-heartbeat-wobble');
      void trackShake.offsetWidth;
      trackShake.classList.add('is-heartbeat-wobble');
    } else if (!shouldWobble) {
      trackShake.classList.remove('is-heartbeat-wobble');
    }
    trackShake.classList.toggle('is-game-paused', state.mode === 'PAUSED');
    trackShake.classList.toggle('is-anti-dizziness', state.antiDizzinessMode === ANTI_DIZZINESS_MODE.ON);
    track.classList.toggle('is-input-locked', Boolean(round?.inputLocked));
    track.classList.toggle('is-resolved', isRoundResolved || Boolean(round?.inputLocked));
    if (round?.inputLocked) track.classList.remove('is-rhythm-hit', 'is-rhythm-miss', 'is-feedback-active');
    if (state.rhythmLaunchSerial !== lastRhythmLaunchSerial) {
      lastRhythmLaunchSerial = state.rhythmLaunchSerial;
      if (round?.launchSerial === state.rhythmLaunchSerial) {
        ballVisual.classList.remove('is-launching');
        void ballVisual.offsetWidth;
        ballVisual.classList.add('is-launching');
      }
    }
    if (state.rhythmTapSerial !== lastRhythmTapSerial) {
      lastRhythmTapSerial = state.rhythmTapSerial;
      ballVisual.classList.remove('is-tapping');
      void ballVisual.offsetWidth;
      if (round || rapidTap) ballVisual.classList.add('is-tapping');
      if (rapidTap) {
        rhythmLabel.classList.remove('is-tap-pop');
        void rhythmLabel.offsetWidth;
        rhythmLabel.classList.add('is-tap-pop');
      }
    }
    if (state.rhythmFeedbackSerial !== lastRhythmFeedbackSerial) {
      lastRhythmFeedbackSerial = state.rhythmFeedbackSerial;
      track.classList.remove('is-rhythm-hit', 'is-rhythm-miss');
      track.classList.remove('is-feedback-active');
      void track.offsetWidth;
      track.classList.add(state.rhythmFeedbackKind === 'hit' ? 'is-rhythm-hit' : 'is-rhythm-miss');
      if (isRoundResolved) track.classList.add('is-feedback-active');
    }
  }

  function updateRhythmOrb(state, sceneProgress) {
    const activeMode = state.mode === 'PAUSED' ? state.resumeMode : state.mode;
    const collect = state.rhythmOrbFeedback;
    const isCollecting = Boolean(collect && state.timerMs < collect.collectUntilMs);
    const toastIsVisible = Boolean(collect && state.timerMs < collect.toastUntilMs);
    rhythmOrb.style.setProperty('--rhythm-orb-collect-duration', GAME_CONFIG.rhythmOrbCollectAnimationMs + 'ms');
    rhythmOrbToast.style.setProperty('--rhythm-orb-toast-duration', GAME_CONFIG.rhythmOrbUnlockToastMs + 'ms');
    if (state.rhythmOrbCollectSerial !== lastRhythmOrbCollectSerial) {
      lastRhythmOrbCollectSerial = state.rhythmOrbCollectSerial;
      rhythmOrb.classList.remove('is-collecting');
      rhythmOrbToast.classList.remove('is-visible');
      void rhythmOrb.offsetWidth;
      if (isCollecting) rhythmOrb.classList.add('is-collecting');
      if (toastIsVisible) rhythmOrbToast.classList.add('is-visible');
    }

    const collected = new Set(state.collectedRhythmOrbs ?? []);
    const approachRange = GAME_CONFIG.rhythmOrbApproachRangeFloors;
    const upcoming = activeMode === 'CLIMBING' && !state.isLandingPaused && !state.isTurning
      ? GAME_CONFIG.rhythmOrbUnlocks
        .filter((orb) => !collected.has(orb.id) && orb.floor >= state.progress - 1e-8)
        .sort((a, b) => a.floor - b.floor)[0] ?? null
      : null;
    const distance = upcoming ? Math.max(0, upcoming.floor - state.progress) : Infinity;
    const approaching = Boolean(upcoming && distance <= approachRange && !isCollecting);
    const visibleOrb = isCollecting ? collect : approaching ? upcoming : null;
    const visibleType = visibleOrb ? RHYTHM_TYPES[visibleOrb.typeId] : null;
    const anchor = visibleOrb?.platformAnchor ?? GAME_CONFIG.rhythmOrbPlatformAnchor;
    const orbTransform = 'translate(' + anchor.x + ' ' + anchor.y + ')';
    if (rhythmOrb.getAttribute('transform') !== orbTransform) rhythmOrb.setAttribute('transform', orbTransform);
    if (visibleType) {
      rhythmOrb.style.setProperty('--rhythm-orb-color', visibleType.color);
      rhythmOrbScene.style.setProperty('--rhythm-orb-color', visibleType.color);
    }
    rhythmOrb.setAttribute('visibility', visibleOrb ? 'visible' : 'hidden');
    rhythmOrbScene.style.setProperty('--rhythm-orb-collect-duration', GAME_CONFIG.rhythmOrbCollectAnimationMs + 'ms');
    setSceneProgress(rhythmOrbScene, isCollecting
      ? collect.sceneProgress ?? sceneProgress
      : sceneProgress);
    rhythmOrb.classList.toggle('is-collecting', isCollecting);

    if (toastIsVisible) {
      const type = RHYTHM_TYPES[collect.typeId];
      rhythmOrbToast.textContent = '獲得新節奏光球';
      rhythmOrbToast.style.setProperty('--rhythm-orb-color', type.color);
      rhythmOrbToast.hidden = false;
      rhythmOrbToast.classList.add('is-visible');
    } else {
      rhythmOrbToast.hidden = true;
      rhythmOrbToast.classList.remove('is-visible');
    }
  }

  function replayRedImpactFrame(className) {
    gameRoot.classList.remove('is-monster-impact', 'is-debuff-applied');
    void gameRoot.offsetWidth;
    gameRoot.classList.add(className);
  }

  function render(state, game) {
    latestState = state;
    if (state.mode === 'RESULT' && lastRenderedMode !== 'RESULT') resultTab = 'summary';
    lastRenderedMode = state.mode;
    gameRoot.dataset.debuff = Object.keys(state.debuffs ?? {}).join(' ') || 'NONE';
    const activeMode = state.mode === 'PAUSED' ? state.resumeMode : state.mode;
    const isEventWarning = activeMode === 'EVENT_WARNING';
    const isMonsterEntrance = activeMode === 'MONSTER_ENTRANCE';
    const isMonsterCast = activeMode === 'MONSTER_CAST';
    const isMonsterImpact = activeMode === 'MONSTER_IMPACT';
    const isAttackToDebuffDelay = activeMode === 'ATTACK_TO_DEBUFF_DELAY';
    const isDebuffReveal = activeMode === 'DEBUFF_REVEAL';
    const isDebuffToAnswerDelay = activeMode === 'DEBUFF_TO_ANSWER_DELAY';
    const isAnswerPreview = activeMode === 'ANSWER_PREVIEW';
    const isMonsterQte = activeMode === 'MONSTER_QTE' && Boolean(state.activeQte);
    const isQteItemUse = Boolean(state.qteItemUse) && activeMode.startsWith('QTE_ITEM_');
    const isQteFailureNotice = activeMode === 'QTE_FAILURE_KNOCKBACK';
    const isCombat = activeMode.startsWith('COMBAT_') && Boolean(state.activeMonster);
    const isCombatDefense = activeMode === 'COMBAT_DEFENSE' && Boolean(state.combatDefenseRound);
    const isMonsterPresentation = isMonsterEntrance || isMonsterCast || isMonsterImpact || isAttackToDebuffDelay ||
      isDebuffReveal || isDebuffToAnswerDelay || isAnswerPreview;
    const isMonsterEventSequence = isEventWarning || isMonsterPresentation || isMonsterQte || isQteItemUse || isCombat;
    const warningOpacity = isEventWarning ? eventWarningOpacity(state) : 0;
    gameRoot.classList.toggle('is-event-warning', isEventWarning);
    gameRoot.classList.toggle('is-game-paused', state.mode === 'PAUSED');
    gameRoot.style.setProperty('--event-warning-opacity', warningOpacity.toFixed(3));
    gameRoot.style.setProperty('--monster-impact-duration', GAME_CONFIG.monsterImpactEffectDurationMs + 'ms');
    const wasCasting = qteLayer.classList.contains('is-casting');
    qteLayer.classList.toggle('is-entrance', isMonsterEntrance);
    qteLayer.classList.toggle('is-casting', isMonsterCast);
    qteLayer.classList.toggle('is-impact', isMonsterImpact);
    qteLayer.classList.toggle('is-debuff-reveal', isDebuffReveal);
    qteLayer.classList.toggle('is-debuff-delay', isDebuffToAnswerDelay);
    qteLayer.classList.toggle('is-answer-preview', isAnswerPreview);
    qteLayer.classList.toggle('is-active', isMonsterQte);
    qteLayer.classList.toggle('is-qte-item-use', isQteItemUse);
    qteLayer.classList.toggle('is-item-reveal', activeMode === 'QTE_ITEM_REVEAL');
    qteLayer.classList.toggle('is-item-message', activeMode === 'QTE_ITEM_MESSAGE');
    qteLayer.classList.toggle('is-item-hold', activeMode === 'QTE_ITEM_HOLD');
    qteLayer.classList.toggle('is-item-fade', activeMode === 'QTE_ITEM_FADE');
    qteLayer.classList.toggle('is-item-transition', activeMode === 'QTE_ITEM_TRANSITION');
    qteLayer.classList.toggle('is-defense-recovery-qte', isMonsterQte && state.activeQte?.context === QTE_CONTEXT.DEFENSE_RECOVERY);
    qteLayer.classList.toggle('is-combat', isCombat);
    qteLayer.classList.toggle('is-combat-attack-intro', activeMode === 'COMBAT_ATTACK_INTRO');
    qteLayer.classList.toggle('is-combat-attack', activeMode === 'COMBAT_ATTACK');
    qteLayer.classList.toggle('is-combat-rapid-tap', activeMode === 'COMBAT_RAPID_TAP');
    qteLayer.classList.toggle('is-combat-defense-intro', activeMode === 'COMBAT_DEFENSE_INTRO');
    qteLayer.classList.toggle('is-combat-defense', activeMode === 'COMBAT_DEFENSE');
    qteLayer.classList.toggle('is-combat-defense-success', activeMode === 'COMBAT_DEFENSE_SUCCESS');
    qteLayer.classList.toggle('is-combat-defense-failed', activeMode === 'COMBAT_DEFENSE_FAILED');
    qteLayer.classList.toggle('is-combat-victory', activeMode === 'COMBAT_VICTORY');
    qteLayer.classList.toggle('is-paused', state.mode === 'PAUSED');
    qteLayer.style.setProperty('--monster-entrance-duration', GAME_CONFIG.monsterEntranceDurationMs + 'ms');
    qteLayer.style.setProperty('--monster-cast-duration', GAME_CONFIG.monsterCastDurationMs + 'ms');
    qteLayer.style.setProperty('--combat-attack-duration', GAME_CONFIG.combatPlayerAttackDurationMs + 'ms');
    qteLayer.style.setProperty('--combat-shield-duration', GAME_CONFIG.combatDefenseResultDurationMs + 'ms');
    qteLayer.style.setProperty('--combat-defense-laser-duration', GAME_CONFIG.combatDefenseLaserDurationMs + 'ms');
    qteLayer.style.setProperty('--combat-defense-hit-effect-duration', GAME_CONFIG.combatDefenseHitEffectDurationMs + 'ms');
    qteLayer.dataset.debuff = state.activeMonster?.failureDebuff?.type ?? 'NONE';
    if (isMonsterCast && !wasCasting) {
      qteLayer.style.setProperty('--monster-cast-delay', -Math.max(0, state.eventPhaseElapsedMs) + 'ms');
    } else if (!isMonsterCast) {
      qteLayer.style.removeProperty('--monster-cast-delay');
    }
    const sceneView = state.stairViewMode === STAIR_VIEW_MODE.POINT_ZERO ? 'point-zero' : 'point-five';
    const visibleView = sceneView;
    const isAutoClimbing = state.mode === 'CLIMBING' && !state.isLandingPaused && !state.isTurning;
    const turnProgress = state.isTurning
      ? Math.min(1, Math.max(0, 1 - state.turnRemainingMs / Math.max(1, state.turnDurationMs)))
      : 0;
    const isSimpleTurning = state.isTurning && state.turnTransitionMode === ANTI_DIZZINESS_MODE.ON;
    arena.dataset.segment = String(state.stairSegmentIndex);
    arena.dataset.view = visibleView;
    arena.classList.toggle('is-turning', state.isTurning);
    arena.classList.toggle('is-paused', state.mode === 'PAUSED');
    arena.classList.toggle('is-simple-turn', isSimpleTurning);
    arena.classList.toggle('is-landing-paused', state.isLandingPaused);
    const accessibleSceneView = isSimpleTurning && turnProgress >= 0.5
      ? (state.turnTargetMode === STAIR_VIEW_MODE.POINT_ZERO ? 'point-zero' : 'point-five')
      : visibleView;
    byId('scene-a').setAttribute('aria-hidden', accessibleSceneView !== 'point-zero');
    byId('scene-b').setAttribute('aria-hidden', accessibleSceneView !== 'point-five');
    const segmentOrigin = state.isTurning ? state.turnFromProgress : state.stairNodeProgress;
    const sceneProgress = stairSegmentProgress(state.progress, segmentOrigin);
    const targetProgress = state.isTurning
      ? stairSegmentProgress(state.progress, state.turnTargetProgress)
      : sceneProgress;
    if (isSimpleTurning) {
      const showingTarget = turnProgress >= 0.5;
      const activeView = showingTarget ? state.turnTargetMode : state.turnFromMode;
      sceneA.style.opacity = String(activeView === STAIR_VIEW_MODE.POINT_ZERO ? 1 : 0);
      sceneB.style.opacity = String(activeView === STAIR_VIEW_MODE.POINT_FIVE ? 1 : 0);
      arena.style.setProperty('--simple-turn-cover', String((Math.sin(Math.PI * turnProgress) * 0.96).toFixed(3)));
    } else {
      sceneA.style.removeProperty('opacity');
      sceneB.style.removeProperty('opacity');
      arena.style.setProperty('--simple-turn-cover', '0');
    }
    if (state.isTurning) {
      turnScene.style.opacity = isSimpleTurning ? '0' : String(turnOverlayOpacity(turnProgress));
    } else {
      turnScene.style.opacity = '0';
    }
    const showingSimpleTarget = isSimpleTurning && turnProgress >= 0.5;
    setSceneProgress(sceneA, isSimpleTurning
      ? (showingSimpleTarget ? 0 : state.turnFromMode === STAIR_VIEW_MODE.POINT_ZERO ? 1 : 0)
      : state.isTurning && state.turnTargetMode === STAIR_VIEW_MODE.POINT_ZERO ? targetProgress : sceneProgress);
    setSceneProgress(sceneB, isSimpleTurning
      ? (showingSimpleTarget ? 0 : state.turnFromMode === STAIR_VIEW_MODE.POINT_FIVE ? 1 : 0)
      : state.isTurning && state.turnTargetMode === STAIR_VIEW_MODE.POINT_FIVE ? targetProgress : sceneProgress);
    setSceneProgress(sceneStairs, isSimpleTurning
      ? (showingSimpleTarget ? 0 : 1)
      : sceneProgress);
    if (state.isTurning && !isSimpleTurning) {
      ensureTurnSceneCache();
      const cacheKey = state.turnFromMode === STAIR_VIEW_MODE.POINT_ZERO ? 'ZERO_TO_HALF' : 'HALF_TO_ZERO';
      renderTurnScene(turnScene, turnSceneContext, state, turnProgress, turnSceneCache[cacheKey] ?? []);
    }
    const cameraBob = isAutoClimbing ? Math.sin(state.stepPhase * Math.PI * 2) * 1.2 : 0;
    arena.style.setProperty('--camera-bob', cameraBob.toFixed(2) + 'px');
    const effectiveClimbSpeed = game.getEffectiveClimbSpeed();
    const stepCycleDuration = Math.max(0.18, GAME_CONFIG.stepCycleDistanceFloors / (2 * Math.max(effectiveClimbSpeed, 0.001)));
    const stepCycleDurationValue = stepCycleDuration.toFixed(2) + 's';
    if (arena.style.getPropertyValue('--step-cycle-duration') !== stepCycleDurationValue) {
      arena.style.setProperty('--step-cycle-duration', stepCycleDurationValue);
    }
    arena.classList.toggle('is-running', isAutoClimbing);
    updateWallFloorSigns(state);
    const currentFloor = Math.max(GAME_CONFIG.startFloor, Math.min(GAME_CONFIG.maxFloor, Number(state.progress) || GAME_CONFIG.startFloor));
    const floorProgressRatio = Math.max(0, Math.min(1, (currentFloor - GAME_CONFIG.startFloor) / (GAME_CONFIG.maxFloor - GAME_CONFIG.startFloor)));
    const floorProgressPercent = (floorProgressRatio * 100).toFixed(3) + '%';
    const floorProgressScale = floorProgressRatio.toFixed(5);
    const displayedFloor = Math.floor(currentFloor);
    const floorProgressLabel = displayedFloor + 'F';
    if (floorProgress.style.getPropertyValue('--floor-progress') !== floorProgressPercent) {
      floorProgress.style.setProperty('--floor-progress', floorProgressPercent);
    }
    if (floorProgress.style.getPropertyValue('--floor-progress-scale') !== floorProgressScale) {
      floorProgress.style.setProperty('--floor-progress-scale', floorProgressScale);
    }
    floorProgressCurrent.textContent = floorProgressLabel;
    for (const milestone of floorProgressMilestones) {
      milestone.classList.toggle('is-reached', currentFloor + 1e-8 >= Number(milestone.dataset.floor));
    }
    floorProgress.classList.toggle('is-complete', floorProgressRatio >= 1);
    if (floorProgress.getAttribute('aria-valuenow') !== currentFloor.toFixed(2)) {
      floorProgress.setAttribute('aria-valuenow', currentFloor.toFixed(2));
      floorProgress.setAttribute('aria-valuetext', floorProgressLabel);
    }
    timerValue.textContent = formatTime(state.timerMs);
    speedNumber.textContent = effectiveClimbSpeed.toFixed(3);

    const skipStatus = game.getSkipSkillStatus();
    const hasMaxSkipCharges = skipStatus.charges >= skipStatus.maxCharges;
    const visibleEnergy = hasMaxSkipCharges ? skipStatus.energyRequired : skipStatus.energy;
    const energyPercent = skipStatus.energyRequired > 0
      ? Math.max(0, Math.min(100, visibleEnergy / skipStatus.energyRequired * 100))
      : 0;
    skipSkillCount.textContent = skipStatus.charges + '/' + skipStatus.maxCharges;
    skipSkillStatus.textContent = state.mode === 'PAUSED'
      ? '暫停中'
      : skipStatus.isReady ? '可用'
      : skipStatus.windowOpen ? (skipStatus.charges > 0 ? '不可使用' : '未充能')
      : skipStatus.nextMonsterFloor === null ? '無目標' : hasMaxSkipCharges ? 'MAX' : '待命';
    skipSkillEnergy.style.width = energyPercent.toFixed(2) + '%';
    skipSkillMeter.setAttribute('aria-valuemax', String(skipStatus.energyRequired));
    skipSkillMeter.setAttribute('aria-valuenow', String(visibleEnergy.toFixed(2)));
    skipSkillButton.disabled = !skipStatus.canUse;
    skipSkillButton.classList.toggle('is-window-open', skipStatus.windowOpen);
    skipSkillButton.classList.toggle('is-ready', skipStatus.isReady);
    const targetDescription = skipStatus.nextMonsterFloor === null
      ? '之後沒有怪物'
      : '下一隻怪物在 ' + formatStairProgress(skipStatus.nextMonsterFloor) + 'F';
    skipSkillButton.setAttribute('aria-label', '跳過怪物，' + skipStatus.charges + ' / ' + skipStatus.maxCharges + ' 次，' + targetDescription + (skipStatus.canUse ? '，可使用' : ''));

    updateRhythmTrack(state, game);
    updateRhythmOrb(state, sceneProgress);
    track.classList.toggle('is-blurred', Boolean(state.debuffs?.BLUR));
    arena.classList.toggle('is-danger', state.feedback?.kind === 'danger');
    arena.classList.toggle('is-qte', isEventWarning || isMonsterPresentation || isMonsterQte || isQteItemUse || isCombat);
    const shakeStartMs = Math.max(0,
      GAME_CONFIG.monsterEntranceDurationMs - GAME_CONFIG.monsterEntranceShakeDurationMs);
    arena.classList.toggle('is-monster-entrance-impact',
      isMonsterEntrance && state.eventPhaseElapsedMs >= shakeStartMs &&
      state.antiDizzinessMode !== ANTI_DIZZINESS_MODE.ON);
    arena.style.setProperty('--monster-entrance-shake-duration', GAME_CONFIG.monsterEntranceShakeDurationMs + 'ms');
    qteFailureNotice.hidden = !isQteFailureNotice;
    qteFailureNotice.classList.toggle('is-paused', state.mode === 'PAUSED');
    qteFailureNotice.style.setProperty('--qte-failure-notice-duration', GAME_CONFIG.monsterQteFailureNoticeDurationMs + 'ms');
    byId('qte-knockback-distance').textContent = '-' + GAME_CONFIG.monsterQteFailureKnockbackFloors + 'F';
    arena.classList.toggle('is-event-paused', state.mode === 'PAUSED' && isMonsterEventSequence);
    gameRoot.classList.toggle('is-event-paused', state.mode === 'PAUSED' && isMonsterEventSequence);
    arena.classList.toggle('debuff-blur', Boolean(state.debuffs?.BLUR));
    pauseButton.disabled = state.mode === 'MENU' || state.mode === 'RESULT';
    pauseButton.textContent = state.mode === 'PAUSED' ? '▶' : 'Ⅱ';
    pauseButton.setAttribute('aria-label', state.mode === 'PAUSED' ? UI_TEXT.resumeButton : UI_TEXT.pauseAria);
    bestValue.textContent = state.bestTimeMs === null ? UI_TEXT.bestNone : formatTime(state.bestTimeMs);

    if (state.feedback) {
      feedback.textContent = state.feedback.message;
      feedback.className = 'feedback-pill is-' + state.feedback.kind;
      if (state.feedback.message !== lastAnnouncement) {
        announcer.textContent = state.feedback.message;
        lastAnnouncement = state.feedback.message;
      }
    } else if (state.mode === 'CLIMBING') {
      feedback.textContent = UI_TEXT.neutral;
      feedback.className = 'feedback-pill';
    }

    if (state.combo !== lastCombo) {
      comboStamp.classList.toggle('is-visible', state.combo >= 2);
      byId('combo-stamp-value').textContent = String(state.combo);
      lastCombo = state.combo;
    } else {
      comboStamp.classList.toggle('is-visible', state.combo >= 2);
      byId('combo-stamp-value').textContent = String(state.combo);
    }

    const isDebuffEncounterVisible = state.monsterDebuffApplied &&
      (isDebuffReveal || isDebuffToAnswerDelay || isAnswerPreview || isMonsterQte);
    const debuffs = getActiveDebuffs(state)
      .filter((debuff) => GAME_CONFIG.debuffs[debuff.type])
      .sort((first, second) => Object.keys(GAME_CONFIG.debuffs).indexOf(first.type) - Object.keys(GAME_CONFIG.debuffs).indexOf(second.type));
    const debuffSignature = debuffs.map((debuff) => [
      debuff.type,
      debuff.severity,
      Number(debuff.remainingFloors).toFixed(1)
    ].join(':')).join('|');
    if (debuffSignature !== lastDebuffListSignature) {
      lastDebuffListSignature = debuffSignature;
      debuffCard.textContent = '';
      debuffs.forEach((debuff) => {
        const data = GAME_CONFIG.debuffs[debuff.type];
        const severity = Math.max(1, Math.min(3, Number(debuff.severity) || 1));
        const severityName = ['', '一般', '中度', '重度'][severity];
        const remaining = Number(debuff.remainingFloors).toFixed(1);
        const entry = document.createElement('div');
        entry.className = 'debuff-card-item';
        entry.dataset.severity = String(severity);
        entry.setAttribute('role', 'status');
        entry.setAttribute('aria-label', data.name + '，' + severityName + '，剩餘 ' + remaining + ' 層');

        const icon = document.createElement('span');
        icon.className = 'debuff-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = data.icon;

        const info = document.createElement('span');
        info.className = 'debuff-info';
        const name = document.createElement('strong');
        name.textContent = data.name;
        info.appendChild(name);

        const level = document.createElement('span');
        level.className = 'debuff-severity';
        level.textContent = severityName;

        const count = document.createElement('b');
        count.className = 'debuff-count';
        const floors = document.createElement('i');
        floors.textContent = remaining;
        count.appendChild(floors);
        count.appendChild(document.createTextNode('F'));
        entry.appendChild(icon);
        entry.appendChild(info);
        entry.appendChild(level);
        entry.appendChild(count);
        debuffCard.appendChild(entry);
      });
    }
    debuffCard.hidden = debuffs.length === 0;
    debuffCard.classList.toggle('is-event-reveal', isDebuffReveal);
    debuffCard.classList.toggle('is-qte-overlay', isDebuffEncounterVisible || Boolean(state.activeMonster));

    if (state.monsterImpactSerial > lastMonsterImpactSerial) {
      lastMonsterImpactSerial = state.monsterImpactSerial;
      replayRedImpactFrame('is-monster-impact');
      climber.classList.remove('is-monster-hit');
      void climber.offsetWidth;
      climber.classList.add('is-monster-hit');
    } else if (state.monsterImpactSerial < lastMonsterImpactSerial) {
      lastMonsterImpactSerial = state.monsterImpactSerial;
    }

    if (state.debuffAppliedSerial > lastDebuffAppliedSerial) {
      lastDebuffAppliedSerial = state.debuffAppliedSerial;
      replayRedImpactFrame('is-debuff-applied');
    } else if (state.debuffAppliedSerial < lastDebuffAppliedSerial) {
      lastDebuffAppliedSerial = state.debuffAppliedSerial;
    }

    purifyFrame.style.setProperty('--debuff-cure-flash-duration', GAME_CONFIG.debuffCureFlashDurationMs + 'ms');
    purifyFrame.style.setProperty('--debuff-cure-flash-count', String(GAME_CONFIG.debuffCureFlashCount));
    if (state.debuffCureSerial > lastDebuffCureSerial) {
      lastDebuffCureSerial = state.debuffCureSerial;
      purifyFrame.classList.remove('is-active');
      void purifyFrame.offsetWidth;
      purifyFrame.classList.add('is-active');
    } else if (state.debuffCureSerial < lastDebuffCureSerial) {
      lastDebuffCureSerial = state.debuffCureSerial;
    }

    climber.classList.toggle('is-falling', state.feedback?.kind === 'danger');

    if (isQteItemUse) {
      qteLayer.hidden = false;
      if (lastQteItemUse !== state.qteItemUse) {
        buildQteItemUse(state.qteItemUse, state);
        lastQteItemUse = state.qteItemUse;
      }
      const message = qteLayer.querySelector('.qte-item-message');
      const showMessage = ['QTE_ITEM_MESSAGE', 'QTE_ITEM_HOLD', 'QTE_ITEM_FADE'].includes(activeMode);
      message?.classList.toggle('is-visible', showMessage);
      message?.classList.toggle('is-leaving', activeMode === 'QTE_ITEM_FADE');
      qteLayer.querySelector('.qte-item-art')?.classList.toggle('is-leaving', activeMode === 'QTE_ITEM_FADE');
      updateCombatVitals(state);
    } else if (isMonsterPresentation && state.activeMonster) {
      let presence = qteLayer.querySelector('.monster-presence');
      if (!presence || (isMonsterEntrance && !presence.classList.contains('is-descending'))) {
        buildMonsterEntrance(state.activeMonster, state.eventPhaseElapsedMs, state.monsterHp, state.monsterMaxHp);
        presence = qteLayer.querySelector('.monster-presence');
      }
      if (presence && !isMonsterEntrance && presence.classList.contains('is-descending')) {
        presence.classList.remove('is-descending');
        presence.classList.add('is-settled');
      }
      if (isAnswerPreview) showAnswerPreview(state.preparedQte);
      else qteLayer.querySelector('.answer-preview')?.remove();
      updateCombatVitals(state);
      qteLayer.hidden = false;
    } else if (isMonsterQte && state.activeQte) {
      qteLayer.hidden = false;
      updateQte(state.activeQte);
      updateCombatVitals(state);
    } else if (isCombat && state.activeMonster) {
      if (lastCombatMonsterId !== state.activeMonster.id) {
        lastCombatMonsterId = state.activeMonster.id;
        lastCombatViewMode = null;
      }
      if (lastCombatViewMode !== activeMode) buildCombatView(state, activeMode);
      qteLayer.hidden = false;
      updateCombatVitals(state);
      if (isCombatDefense || activeMode === 'COMBAT_DEFENSE_SUCCESS' || activeMode === 'COMBAT_DEFENSE_FAILED') {
        updateCombatDefenseRound(state.combatDefenseRound, state, activeMode);
      }
    } else {
      qteLayer.hidden = true;
      lastQteObject = null;
      lastQteItemUse = null;
      lastCombatViewMode = null;
      lastCombatMonsterId = null;
    }
    showModal(state);
    syncAntiDizzinessSetting(state);
  }

  modalLayer.addEventListener('click', (event) => {
    const reportTab = event.target.closest('[data-report-tab]')?.dataset.reportTab;
    if (reportTab && latestState?.runReport) {
      resultTab = reportTab;
      lastMode = null;
      showModal(latestState);
      return;
    }
    const reportAction = event.target.closest('[data-report-action]')?.dataset.reportAction;
    if (reportAction && latestState?.runReport) {
      const feedback = modalLayer.querySelector('[data-report-feedback]');
      const operation = reportAction === 'copy'
        ? copyRunReport(latestState.runReport)
        : exportRunReport(latestState.runReport);
      Promise.resolve(operation).then((message) => {
        if (feedback?.isConnected) feedback.textContent = message;
      }).catch(() => {
        if (feedback?.isConnected) feedback.textContent = reportAction === 'copy'
          ? '複製未成功，請改用匯出或再次嘗試'
          : '匯出未成功，請改用複製 JSON';
      });
      return;
    }
    const setting = event.target.closest('[data-setting]');
    if (setting?.dataset.setting === 'anti-dizziness') {
      onAction('set-anti-dizziness-mode', setting.getAttribute('aria-checked') !== 'true');
      return;
    }
    const upgradeId = event.target.closest('[data-upgrade-id]')?.dataset.upgradeId;
    if (upgradeId) {
      onAction('choose-upgrade', upgradeId);
      return;
    }
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'start') onAction('start');
    if (action === 'resume') onAction('resume');
  });
  modalLayer.addEventListener('input', (event) => {
    const slider = event.target.closest('[data-audio-volume]');
    if (!slider) return;
    const settingKey = slider.dataset.audioVolume;
    const value = Math.max(0, Math.min(100, Math.round(Number(slider.value) || 0)));
    slider.value = String(value);
    const label = modalLayer.querySelector('[data-volume-value="' + settingKey.replace('Percent', '') + '"]');
    if (label) label.textContent = value + '%';
    const settings = loadAudioSettings();
    settings[settingKey] = value;
    onAction('set-audio-volume', settings);
  });
  pauseButton.addEventListener('click', () => {
    if (pauseButton.disabled) return;
    onAction(pauseButton.textContent === '▶' ? 'resume' : 'pause');
  });
  skipSkillButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!skipSkillButton.disabled) onAction('use-skip-skill');
  });
  gameRoot.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' || event.button !== 0) return;
    if (event.target.closest('button, a, input, select, textarea, [data-action], [data-setting], [data-tile-id], .modal-layer')) return;
    event.preventDefault();
    onAction('rhythm');
  }, { passive: false });
  track.addEventListener('animationend', (event) => {
    if (event.target !== track || !['rhythm-hit-flash', 'rhythm-miss-shake'].includes(event.animationName)) return;
    track.classList.remove('is-rhythm-hit', 'is-rhythm-miss', 'is-feedback-active');
  });
  climber.addEventListener('animationend', (event) => {
    if (event.animationName === 'monster-player-impact') climber.classList.remove('is-monster-hit');
  });
  purifyFrame.addEventListener('animationend', (event) => {
    if (event.animationName === 'debuff-cure-frame') purifyFrame.classList.remove('is-active');
  });
  gameRoot.addEventListener('animationend', (event) => {
    if (event.target === gameRoot && event.animationName === 'monster-impact-vignette') {
      gameRoot.classList.remove('is-monster-impact', 'is-debuff-applied');
    }
  });
  qteLayer.addEventListener('click', (event) => {
    const tileId = event.target.closest('[data-tile-id]')?.dataset.tileId;
    if (tileId) onAction('qte-letter', tileId);
  });
  qteLayer.addEventListener('animationend', (event) => {
    if (event.target.matches('.player-attack-projectile') && event.animationName === 'player-attack-flight') {
      const monster = qteLayer.querySelector('.monster-presence');
      if (!monster) return;
      monster.classList.remove('is-combat-hit');
      void monster.offsetWidth;
      monster.classList.add('is-combat-hit');
    }
  });

  return { render };
}

export { formatTime };
