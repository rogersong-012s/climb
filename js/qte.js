import { GAME_CONFIG } from './config.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function shuffle(items, random = Math.random) {
  const result = items.slice();
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function createQte(monster, random = Math.random, durationMs = monster.qteDurationMs ?? GAME_CONFIG.monsterQteDurationMs) {
  const requiredLetters = monster.solutions.flatMap((solution) => [...solution.word]);
  const targetSize = Math.max(
    GAME_CONFIG.qteLetterMin,
    Math.min(GAME_CONFIG.qteLetterMax, requiredLetters.length + 2)
  );
  while (requiredLetters.length < targetSize) {
    requiredLetters.push(ALPHABET[Math.floor(random() * ALPHABET.length)]);
  }
  const tiles = shuffle(requiredLetters, random).map((letter, index) => ({
    id: 'tile-' + index,
    letter,
    visible: true
  }));
  return {
    id: 'qte-' + Math.floor(random() * 1_000_000_000),
    monster,
    durationMs,
    remainingMs: durationMs,
    input: '',
    tiles
  };
}

export function clickQteTile(qte, tileId) {
  const tile = qte.tiles.find((candidate) => candidate.id === tileId);
  if (!tile || !tile.visible) return { status: 'ignored' };

  const nextInput = qte.input + tile.letter;
  const candidates = qte.monster.solutions.filter((solution) => solution.word.startsWith(nextInput));
  if (candidates.length === 0) {
    qte.input = '';
    qte.tiles.forEach((candidate) => { candidate.visible = true; });
    return { status: 'reset' };
  }

  tile.visible = false;
  qte.input = nextInput;
  const solution = candidates.find((candidate) => candidate.word === nextInput);
  if (solution) return { status: 'complete', solution };
  return { status: 'progress', input: nextInput };
}
