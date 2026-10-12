import { ANTI_DIZZINESS_MODE, GAME_CONFIG, UI_TEXT } from './config.js';
import { formatStairProgress, stairSegmentProgress, STAIR_VIEW_MODE } from './stairs.js';
import { RHYTHM_PHASE } from './rhythm.js';

function formatTime(milliseconds) {
  const totalCs = Math.floor(Math.max(0, milliseconds) / 10);
  const minutes = Math.floor(totalCs / 6000);
  const seconds = Math.floor((totalCs % 6000) / 100);
  const centiseconds = totalCs % 100;
  return String(minutes).padStart(2, '0') + ':' +
    String(seconds).padStart(2, '0') + '.' + String(centiseconds).padStart(2, '0');
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
  const sceneFloor = byId('scene-floor');
  const sceneViewLabel = byId('scene-view-label');
  const sceneTarget = byId('scene-target');
  const sceneSignAFloor = byId('scene-sign-a-floor');
  const sceneSignBFloor = byId('scene-sign-b-floor');
  const timerValue = byId('timer-value');
  const speedNumber = byId('speed-number');
  const pauseButton = byId('pause-button');
  const track = byId('rhythm-track');
  const trackZones = byId('track-zones');
  const rhythmLabel = byId('rhythm-label');
  const ball = byId('rhythm-ball');
  const hitButton = byId('hit-button');
  const feedback = byId('feedback');
  const bestValue = byId('best-value');
  const debuffCard = byId('debuff-card');
  const announcer = byId('announcer');
  const comboStamp = byId('combo-stamp');
  const modalLayer = byId('modal-layer');
  const purifyFrame = byId('purify-frame');
  const qteLayer = byId('qte-layer');
  const gameRoot = byId('game');
  const arena = byId('arena');
  const climber = byId('climber');
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
  let lastQteMessage = '';
  let lastCombo = 0;
  let lastAnnouncement = '';
  let lastRhythmRound = null;
  let lastRhythmTapSerial = 0;
  let lastRhythmFeedbackSerial = 0;
  let lastRhythmLaunchSerial = 0;
  let lastMonsterImpactSerial = 0;
  let lastDebuffCureSerial = 0;
  let lastCombatViewMode = null;
  let lastCombatAttackSerial = 0;
  let lastCombatMonsterId = null;
  let lastCombatDamageFlashSerial = 0;

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

  function showModal(state) {
    const mode = state.mode;
    if (mode === lastMode) return;
    lastMode = mode;
    if (mode === 'CLIMBING' || mode === 'EVENT_WARNING' || mode === 'MONSTER_ENTRANCE' ||
        mode === 'MONSTER_CAST' || mode === 'MONSTER_IMPACT' || mode === 'ATTACK_TO_DEBUFF_DELAY' ||
        mode === 'DEBUFF_REVEAL' || mode === 'DEBUFF_TO_ANSWER_DELAY' || mode === 'ANSWER_PREVIEW' || mode === 'MONSTER_QTE' || mode.startsWith('COMBAT_')) {
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
          antiDizzinessSetting(state) +
          '<button class="primary-button" type="button" data-action="resume">' + UI_TEXT.resumeButton + '<span>↗</span></button>' +
        '</section>';
    } else if (mode === 'RESULT') {
      modalLayer.innerHTML =
        '<section class="modal-card result-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
          '<div class="confetti confetti-one"></div><div class="confetti confetti-two"></div>' +
          '<div class="modal-sticker trophy-sticker" aria-hidden="true">★</div>' +
          '<p class="modal-eyebrow">TOP FLOOR · MISSION COMPLETE</p><h2 id="modal-title">' + UI_TEXT.resultTitle + '</h2>' +
          '<p class="modal-lead">' + UI_TEXT.resultSubtitle + '</p>' +
          '<div class="result-time"><span>' + UI_TEXT.timeLabel + '</span><strong>' + formatTime(state.timerMs) + '</strong></div>' +
          '<div class="result-grid">' +
            resultStat(UI_TEXT.comboLabel, state.stats.maxCombo) +
            resultStat(UI_TEXT.hitsLabel, state.stats.hits) +
            resultStat(UI_TEXT.missesLabel, state.stats.misses) +
            resultStat(UI_TEXT.qteWinsLabel, state.stats.qteWins) +
            resultStat(UI_TEXT.qteLossesLabel, state.stats.qteLosses) +
            resultStat('本機最佳', state.bestTimeMs === null ? '—' : formatTime(state.bestTimeMs)) +
          '</div>' +
          '<button class="primary-button" type="button" data-action="start">' + UI_TEXT.retryButton + '<span>↻</span></button>' +
        '</section>';
    }
  }

  function resultStat(label, value) {
    return '<div class="result-stat"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>';
  }

  function viewNodeProgress(state, viewMode) {
    if (state.isTurning) {
      if (viewMode === state.turnFromMode) return state.turnFromProgress;
      if (viewMode === state.turnTargetMode) return state.turnTargetProgress;
    }
    if (viewMode === state.stairViewMode) return state.stairNodeProgress;
    return state.stairNodeProgress + 0.5;
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
    const safeMaxHp = Math.max(1, Number(maxHp) || GAME_CONFIG.monsterMaxHp);
    const safeHp = Math.max(0, Math.min(safeMaxHp, Number(hp) || 0));
    return '<div class="monster-vitals" aria-label="' + escapeHtml(monster.name) + ' HP ' + safeHp + ' / ' + safeMaxHp + '">' +
      '<strong class="monster-vitals-name">' + escapeHtml(monster.name) + '</strong>' +
      '<span class="monster-hp-track"><span class="monster-hp-fill" style="width:' + ((safeHp / safeMaxHp) * 100) + '%"></span></span>' +
      '<span class="monster-hp-value">' + safeHp + '/' + safeMaxHp + '</span>' +
    '</div>';
  }

  function combatMonsterMarkup(state, mode) {
    if (!state.activeMonster) return '';
    const defeated = mode === 'COMBAT_VICTORY' ? ' is-defeated' : '';
    return monsterPresenceMarkup(state.activeMonster, 'is-settled' + defeated) +
      monsterVitalsMarkup(state.activeMonster, state.monsterHp, state.monsterMaxHp);
  }

  function buildCombatDefenseMarkup(round) {
    if (!round) return '';
    const projectiles = round.projectiles.map((projectile) =>
      '<span class="defense-projectile" data-shot-id="' + escapeHtml(projectile.id) + '" aria-hidden="true"></span>'
    ).join('');
    const shields = round.shields.map((shield, index) =>
      '<button class="defense-shield" type="button" data-shield-id="' + escapeHtml(shield.id) + '" ' +
      'style="left:' + Number(shield.x) + '%;top:' + Number(shield.y) + '%" ' +
      'aria-label="盾牌 ' + (index + 1) + '，尚未亮起">' +
      '<svg viewBox="0 0 48 56" aria-hidden="true"><path d="M24 3 43 10v15c0 13-8 22-19 28C13 47 5 38 5 25V10z"/></svg>' +
      '</button>'
    ).join('');
    return '<div class="combat-defense-field" aria-label="點擊亮起的白盾防禦">' +
      projectiles + shields + '<p class="combat-defense-instruction">點擊亮起的白盾</p></div>';
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
      button.dataset.tileId = tile.id;
      button.textContent = tile.letter;
      const position = positions[Number(tile.id.slice(5)) % positions.length];
      button.style.left = position[0] + '%';
      button.style.top = position[1] + '%';
      button.style.setProperty('--tile-tilt', (Number(tile.id.slice(5)) % 2 ? '5deg' : '-4deg'));
      button.setAttribute('aria-label', '字母 ' + tile.letter);
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
      phaseMarkup = '<span class="player-attack-projectile is-firing" aria-hidden="true"></span>';
    } else if (mode === 'COMBAT_DEFENSE_INTRO') {
      phaseMarkup = '<p class="combat-round-prompt is-defense">' + escapeHtml(UI_TEXT.combatDefenseRound) + '</p>';
    } else if (mode === 'COMBAT_DEFENSE') {
      phaseMarkup = buildCombatDefenseMarkup(state.combatDefenseRound);
    } else if (mode === 'COMBAT_DEFENSE_SUCCESS') {
      phaseMarkup = '<div class="combat-shield" aria-hidden="true"><span>◆</span></div><p class="combat-feedback">' + escapeHtml(UI_TEXT.combatDefenseSuccess) + '</p>';
    } else if (mode === 'COMBAT_DEFENSE_FAILED') {
      phaseMarkup = '<p class="combat-feedback combat-defense-failed">' + escapeHtml(UI_TEXT.combatDefenseFailure) + '</p>';
    } else if (mode === 'COMBAT_VICTORY') {
      phaseMarkup = '<p class="combat-feedback combat-victory-label">' + escapeHtml(UI_TEXT.combatMonsterDefeated) + '</p>';
    }
    qteLayer.innerHTML = '<div class="qte-card combat-card">' + monsterMarkup + phaseMarkup + '</div>';
    qteLayer.classList.remove('is-urgent');
    qteLayer.style.removeProperty('--monster-entrance-delay');
    qteLayer.style.removeProperty('--monster-cast-delay');
    qteLayer.style.removeProperty('--combat-attack-delay');
    qteLayer.style.setProperty('--combat-round-intro-duration', GAME_CONFIG.combatRoundIntroDurationMs + 'ms');
    if (mode === 'COMBAT_ATTACK_SETTLE') {
      qteLayer.style.setProperty('--combat-attack-delay', -(GAME_CONFIG.combatPlayerAttackDurationMs - state.eventPhaseDurationMs) + 'ms');
    }
    lastQteObject = null;
    lastQteMessage = '';
    lastCombatViewMode = mode;
    if (mode !== 'COMBAT_ATTACK') lastCombatAttackSerial = state.combatAttackSerial;
  }

  function updateCombatDefenseRound(round) {
    if (!round) return;
    const nowMs = round.elapsedMs;
    round.projectiles.forEach((projectile) => {
      const ball = qteLayer.querySelector('[data-shot-id="' + projectile.id + '"]');
      const target = round.shields.find((shield) => shield.id === projectile.targetShieldId);
      if (!ball || !target) return;
      const visible = nowMs >= projectile.launchTimeMs && nowMs < projectile.impactTimeMs;
      ball.hidden = !visible;
      if (!visible) return;
      const rawProgress = Math.max(0, Math.min(1, (nowMs - projectile.launchTimeMs) /
        Math.max(1, projectile.impactTimeMs - projectile.launchTimeMs)));
      const easedProgress = 1 - (1 - rawProgress) ** 2;
      const x = 50 + (target.x - 50) * easedProgress;
      const y = 44 + (target.y - 44) * easedProgress - Math.sin(Math.PI * rawProgress) * 3;
      ball.style.left = x + '%';
      ball.style.top = y + '%';
      ball.classList.toggle('is-near-impact', nowMs >= projectile.windowStartMs);
    });

    round.shields.forEach((shield, index) => {
      const button = qteLayer.querySelector('[data-shield-id="' + shield.id + '"]');
      if (!button) return;
      const shots = round.projectiles.filter((projectile) => projectile.targetShieldId === shield.id);
      const active = shots.some((projectile) => projectile.status === 'active');
      const defended = shots.some((projectile) => projectile.status === 'defended' || projectile.status === 'blocked');
      const blocked = shots.some((projectile) => projectile.status === 'blocked');
      const missed = shots.some((projectile) => projectile.status === 'missed');
      const complete = shots.length > 0 && shots.every((projectile) => ['blocked', 'missed'].includes(projectile.status));
      button.classList.toggle('is-active', active);
      button.classList.toggle('is-defended', defended);
      button.classList.toggle('is-blocked', blocked);
      button.classList.toggle('is-missed', missed);
      button.classList.toggle('is-complete', complete);
      const stateText = active ? '現在點擊' : complete ? (missed ? '未擋下' : '已擋下') : defended ? '已點擊，等待抵達' : '尚未亮起';
      button.setAttribute('aria-label', '盾牌 ' + (index + 1) + '，' + stateText);
    });
  }

  function updateCombatVitals(state) {
    const fill = qteLayer.querySelector('.monster-hp-fill');
    const value = qteLayer.querySelector('.monster-hp-value');
    const vitals = qteLayer.querySelector('.monster-vitals');
    if (!fill || !value || !vitals) return;
    const maxHp = Math.max(1, state.monsterMaxHp ?? GAME_CONFIG.monsterMaxHp);
    const hp = Math.max(0, Math.min(maxHp, state.monsterHp ?? maxHp));
    fill.style.width = ((hp / maxHp) * 100) + '%';
    value.textContent = hp + '/' + maxHp;
    vitals.setAttribute('aria-label', state.activeMonster.name + ' HP ' + hp + ' / ' + maxHp);
  }

  function triggerCombatAttackAnimation(state) {
    if (state.combatAttackSerial < lastCombatAttackSerial) lastCombatAttackSerial = state.combatAttackSerial;
    if (state.combatAttackSerial <= lastCombatAttackSerial) return;
    lastCombatAttackSerial = state.combatAttackSerial;
    const projectile = qteLayer.querySelector('.player-attack-projectile');
    if (!projectile) return;
    projectile.classList.remove('is-firing');
    void qteLayer.offsetWidth;
    projectile.classList.add('is-firing');
  }

  function triggerCombatDefenseHitFlash(state) {
    if (state.combatDamageFlashSerial === lastCombatDamageFlashSerial) return;
    lastCombatDamageFlashSerial = state.combatDamageFlashSerial;
    qteLayer.classList.remove('is-combat-hit-flash');
    void qteLayer.offsetWidth;
    qteLayer.classList.add('is-combat-hit-flash');
  }

  function buildMonsterEntrance(monster, elapsedMs = 0, hp = GAME_CONFIG.monsterMaxHp, maxHp = GAME_CONFIG.monsterMaxHp) {
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
    const preview = document.createElement('div');
    preview.className = 'answer-preview' + (compact ? ' is-compact' : '');
    preview.setAttribute('role', 'status');
    preview.setAttribute('aria-label', '本次 QTE 可選答案');
    const [first, second] = (qte.monster.solutions ?? []).slice(0, 2);
    if (first) {
      const firstWord = document.createElement('strong');
      firstWord.className = 'answer-preview-word answer-preview-primary';
      firstWord.textContent = first.word;
      preview.append(firstWord);
    }
    if (first && second) {
      const separator = document.createElement('span');
      separator.className = 'answer-preview-or';
      separator.textContent = 'OR';
      preview.append(separator);
    }
    if (second) {
      const secondWord = document.createElement('strong');
      secondWord.className = 'answer-preview-word answer-preview-secondary';
      secondWord.textContent = second.word;
      preview.append(secondWord);
    }
    const hint = document.createElement('span');
    hint.className = 'answer-preview-hint';
    hint.textContent = '依序輸入，解除減益';
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
          '<div class="qte-topline"><span class="qte-alert">QTE</span><span class="qte-clock" id="qte-clock">6.0s</span></div>' +
          '<div class="qte-timer-track"><span id="qte-timer-bar"></span></div>' +
        '</div>' +
        monsterPresenceMarkup(monster) +
        monsterVitalsMarkup(monster, qte.monsterHp ?? GAME_CONFIG.monsterMaxHp, qte.monsterMaxHp ?? GAME_CONFIG.monsterMaxHp) +
        '<p class="qte-message" id="qte-message" aria-live="polite"></p>' +
        '<div class="letter-grid" id="letter-grid"></div>' +
      '</div>';
    showAnswerPreview(qte, true);
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
      button.setAttribute('aria-label', tile.visible ? '字母 ' + tile.letter : '字母 ' + tile.letter + ' 已選');
    });
  }

  function updateRhythmTrack(state, game) {
    const activeMode = state.mode === 'PAUSED' ? state.resumeMode : state.mode;
    const round = state.rhythmRound;
    const windows = game.getRhythmHitWindows();
    const ballDiameter = 24;
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
      ball.style.setProperty('--rhythm-ready-duration', (round?.readyDurationMs ?? GAME_CONFIG.rhythmBeatDurationMs) + 'ms');
      ball.style.setProperty('--rhythm-ready-flash-duration', GAME_CONFIG.rhythmReadyFlashMs + 'ms');
      ball.style.setProperty('--rhythm-ready-ring-size', (ringScale * 100) + '%');
      ball.style.setProperty('--rhythm-ready-ring-end-scale', String(1 / ringScale));
    }

    if (round) {
      rhythmLabel.textContent = (activeMode === 'COMBAT_ATTACK' ? '攻擊回合 · ' : '') +
        round.label + ' · ' + round.inputIndex + '/' + round.hitBeats.length;
    } else {
      const rhythmModeLabels = {
        COMBAT_ATTACK_INTRO: '準備攻擊',
        COMBAT_DEFENSE_INTRO: '準備防禦',
        COMBAT_DEFENSE: '點擊亮起的白盾',
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
      marker.classList.toggle('is-complete', window.status === 'complete');
      marker.classList.toggle('is-locked', window.status === 'locked');
      marker.dataset.status = window.status;
    });

    const ballVisible = Boolean(round && round.phase !== RHYTHM_PHASE.FINISHED);
    ball.hidden = !ballVisible;
    ball.style.display = ballVisible ? 'grid' : 'none';
    ball.style.left = trackPosition(game.getBallPosition());
    ball.style.setProperty('--rhythm-ball-color', round?.color ?? '#ff8038');
    ball.classList.toggle('is-ready', round?.phase === RHYTHM_PHASE.SPAWN_READY);
    ball.classList.toggle('is-paused', state.mode === 'PAUSED');
    const isRoundResolved = round?.phase === RHYTHM_PHASE.RESOLVED || round?.phase === RHYTHM_PHASE.FINISHED;
    track.classList.toggle('is-resolved', isRoundResolved);
    if (state.rhythmLaunchSerial !== lastRhythmLaunchSerial) {
      lastRhythmLaunchSerial = state.rhythmLaunchSerial;
      if (round?.launchSerial === state.rhythmLaunchSerial) {
        ball.classList.remove('is-launching');
        void ball.offsetWidth;
        ball.classList.add('is-launching');
      }
    }
    if (state.rhythmTapSerial !== lastRhythmTapSerial) {
      lastRhythmTapSerial = state.rhythmTapSerial;
      ball.classList.remove('is-tapping');
      void ball.offsetWidth;
      if (round) ball.classList.add('is-tapping');
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

  function render(state, game) {
    gameRoot.dataset.debuff = state.debuff?.type ?? 'NONE';
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
    const isCombat = activeMode.startsWith('COMBAT_') && Boolean(state.activeMonster);
    const isCombatAttack = activeMode === 'COMBAT_ATTACK';
    const isCombatDefense = activeMode === 'COMBAT_DEFENSE' && Boolean(state.combatDefenseRound);
    const isMonsterPresentation = isMonsterEntrance || isMonsterCast || isMonsterImpact || isAttackToDebuffDelay ||
      isDebuffReveal || isDebuffToAnswerDelay || isAnswerPreview;
    const isMonsterEventSequence = isEventWarning || isMonsterPresentation || isMonsterQte || isCombat;
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
    qteLayer.classList.toggle('is-combat', isCombat);
    qteLayer.classList.toggle('is-combat-attack-intro', activeMode === 'COMBAT_ATTACK_INTRO');
    qteLayer.classList.toggle('is-combat-attack', activeMode === 'COMBAT_ATTACK');
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
    const stepCycleDuration = Math.max(0.18, GAME_CONFIG.stepCycleDistanceFloors / (2 * Math.max(state.climbSpeed, GAME_CONFIG.minClimbSpeed)));
    const stepCycleDurationValue = stepCycleDuration.toFixed(2) + 's';
    if (arena.style.getPropertyValue('--step-cycle-duration') !== stepCycleDurationValue) {
      arena.style.setProperty('--step-cycle-duration', stepCycleDurationValue);
    }
    arena.classList.toggle('is-running', isAutoClimbing);
    const progressLabel = formatStairProgress(state.progress);
    const viewNodeLabel = formatStairProgress(state.stairNodeProgress);
    const nextNodeLabel = formatStairProgress(state.stairNodeProgress + 0.5);
    sceneSignAFloor.textContent = formatStairProgress(viewNodeProgress(state, STAIR_VIEW_MODE.POINT_ZERO)) + 'F';
    sceneSignBFloor.textContent = formatStairProgress(viewNodeProgress(state, STAIR_VIEW_MODE.POINT_FIVE)) + 'F';
    sceneFloor.textContent = progressLabel + 'F';
    sceneViewLabel.textContent = isAutoClimbing
      ? '正在上樓'
      : state.isLandingPaused ? '已到平台，站穩中' : state.isTurning ? '平台轉身中' : viewNodeLabel + 'F 視角';
    sceneTarget.textContent = isAutoClimbing
      ? '向上推進'
      : state.isLandingPaused ? '準備轉向下一段' : state.isTurning ? '轉向下一段樓梯' : '上行至 ' + nextNodeLabel + 'F';
    timerValue.textContent = formatTime(state.timerMs);
    speedNumber.textContent = state.climbSpeed.toFixed(3);

    updateRhythmTrack(state, game);
    track.classList.toggle('is-blurred', state.debuff?.type === 'BLUR');
    arena.classList.toggle('is-danger', state.feedback?.kind === 'danger');
    arena.classList.toggle('is-qte', isEventWarning || isMonsterPresentation || isMonsterQte || isCombat);
    arena.classList.toggle('is-event-paused', state.mode === 'PAUSED' && isMonsterEventSequence);
    gameRoot.classList.toggle('is-event-paused', state.mode === 'PAUSED' && isMonsterEventSequence);
    arena.classList.toggle('debuff-sore', state.debuff?.type === 'SORE');
    arena.classList.toggle('debuff-blur', state.debuff?.type === 'BLUR');
    arena.classList.toggle('debuff-fatigue', state.debuff?.type === 'FATIGUE');
    const acceptsRhythmInput = (state.mode === 'CLIMBING' || state.mode === 'COMBAT_ATTACK') && state.rhythmRound?.phase === RHYTHM_PHASE.MOVING;
    hitButton.disabled = !acceptsRhythmInput;
    hitButton.classList.toggle('is-ready', acceptsRhythmInput);
    hitButton.setAttribute('aria-label', '依照節奏踩拍');
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
    if (state.debuff && (!state.activeMonster || isDebuffEncounterVisible)) {
      const data = GAME_CONFIG.debuffs[state.debuff.type];
      debuffCard.hidden = false;
      byId('debuff-icon').textContent = data.icon;
      byId('debuff-name').textContent = data.name;
      byId('debuff-description').textContent = data.description;
      byId('debuff-remaining').textContent = state.debuff.remainingFloors.toFixed(1).replace(/\.0$/, '');
    } else {
      debuffCard.hidden = true;
    }
    debuffCard.classList.toggle('is-event-reveal', isDebuffReveal);
    debuffCard.classList.toggle('is-qte-overlay', isDebuffEncounterVisible);

    if (state.monsterImpactSerial > lastMonsterImpactSerial) {
      lastMonsterImpactSerial = state.monsterImpactSerial;
      gameRoot.classList.remove('is-monster-impact');
      void gameRoot.offsetWidth;
      gameRoot.classList.add('is-monster-impact');
      climber.classList.remove('is-monster-hit');
      void climber.offsetWidth;
      climber.classList.add('is-monster-hit');
    } else if (state.monsterImpactSerial < lastMonsterImpactSerial) {
      lastMonsterImpactSerial = state.monsterImpactSerial;
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

    if (isMonsterPresentation && state.activeMonster) {
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
        lastCombatAttackSerial = state.combatAttackSerial;
        lastCombatDamageFlashSerial = state.combatDamageFlashSerial;
        lastCombatViewMode = null;
      }
      if (lastCombatViewMode !== activeMode) buildCombatView(state, activeMode);
      qteLayer.hidden = false;
      updateCombatVitals(state);
      if (isCombatDefense) updateCombatDefenseRound(state.combatDefenseRound);
      if (isCombatAttack) triggerCombatAttackAnimation(state);
      triggerCombatDefenseHitFlash(state);
    } else {
      qteLayer.hidden = true;
      qteLayer.classList.remove('is-combat-hit-flash');
      lastQteObject = null;
      lastCombatViewMode = null;
      lastCombatMonsterId = null;
      lastCombatAttackSerial = state.combatAttackSerial;
      lastCombatDamageFlashSerial = state.combatDamageFlashSerial;
    }
    showModal(state);
    syncAntiDizzinessSetting(state);
  }

  modalLayer.addEventListener('click', (event) => {
    const setting = event.target.closest('[data-setting]');
    if (setting?.dataset.setting === 'anti-dizziness') {
      onAction('set-anti-dizziness-mode', setting.getAttribute('aria-checked') !== 'true');
      return;
    }
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'start') onAction('start');
    if (action === 'resume') onAction('resume');
  });
  pauseButton.addEventListener('click', () => {
    if (pauseButton.disabled) return;
    onAction(pauseButton.textContent === '▶' ? 'resume' : 'pause');
  });
  hitButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    onAction('rhythm');
  });
  hitButton.addEventListener('click', (event) => event.preventDefault());
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
      gameRoot.classList.remove('is-monster-impact');
    }
  });
  qteLayer.addEventListener('click', (event) => {
    const tileId = event.target.closest('[data-tile-id]')?.dataset.tileId;
    if (tileId) onAction('qte-letter', tileId);
    const shieldId = event.target.closest('[data-shield-id]')?.dataset.shieldId;
    if (shieldId) onAction('combat-shield', shieldId);
  });
  qteLayer.addEventListener('animationend', (event) => {
    if (event.target.matches('.player-attack-projectile') && event.animationName === 'player-attack-flight') {
      const monster = qteLayer.querySelector('.monster-presence');
      if (!monster) return;
      monster.classList.remove('is-combat-hit');
      void monster.offsetWidth;
      monster.classList.add('is-combat-hit');
    }
    if (event.target === qteLayer && event.animationName === 'combat-red-edge-hit') {
      qteLayer.classList.remove('is-combat-hit-flash');
    }
  });

  return { render };
}

export { formatTime };
