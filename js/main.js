import { createGame } from './game.js';
import { createUI } from './ui.js';
import { ANTI_DIZZINESS_MODE } from './config.js';
import { createDebugController } from './debug.js';
import { createRhythmAudio } from './audio.js';

const debug = createDebugController();
const game = createGame({ debugHooks: debug.enabled ? debug.hooks : null });
const rhythmAudio = createRhythmAudio();
let lastRhythmFeedbackSerial = null;
if (debug.enabled && typeof window !== 'undefined') {
  window.__rhythmAudioDebug = () => rhythmAudio.getDiagnostics();
  console.info('[RHYTHM AUDIO DEBUG] Use __rhythmAudioDebug() to inspect the current ball timeline.');
}
const ui = createUI((action, payload) => {
  if (action === 'start') startGame();
  else if (action === 'rhythm') {
    void rhythmAudio.unlock();
    game.pressRhythm();
  } else if (action === 'qte-letter') game.pressQteLetter(payload);
  else if (action === 'combat-shield') game.pressCombatShield(payload);
  else if (action === 'choose-upgrade') game.chooseUpgrade(payload);
  else if (action === 'use-skip-skill') game.useSkipSkill();
  else if (action === 'pause') game.pause();
  else if (action === 'resume') resumeGame();
  else if (action === 'set-anti-dizziness-mode') game.setAntiDizzinessMode(payload ? ANTI_DIZZINESS_MODE.ON : ANTI_DIZZINESS_MODE.OFF);
  else if (action === 'set-audio-volume') rhythmAudio.setVolumeSettings(payload);
});

function startGame() {
  if (debug.enabled) debug.reset();
  lastRhythmFeedbackSerial = null;
  rhythmAudio.reset();
  void rhythmAudio.unlock();
  game.start(globalThis.performance?.now?.());
}

function resumeGame() {
  // Resume is called from a user gesture so iOS Safari can unlock audio.
  void rhythmAudio.unlock();
  game.resume();
  void rhythmAudio.recover(game.getState());
}

game.subscribe((state) => {
  rhythmAudio.sync(state);
  const feedbackSerial = Number(state.rhythmFeedbackSerial) || 0;
  if (lastRhythmFeedbackSerial === null || feedbackSerial < lastRhythmFeedbackSerial) {
    lastRhythmFeedbackSerial = feedbackSerial;
  } else if (feedbackSerial > lastRhythmFeedbackSerial) {
    const eventCount = Math.min(12, feedbackSerial - lastRhythmFeedbackSerial);
    for (let index = 0; index < eventCount; index += 1) {
      const eventSerial = feedbackSerial - eventCount + index + 1;
      rhythmAudio.playInputFeedback(state.rhythmFeedbackKind, eventSerial);
    }
    lastRhythmFeedbackSerial = feedbackSerial;
  }
  ui.render(state, game);
});

// Some browsers suspend Web Audio until the first user gesture. This is a
// no-op after the context is running and never gates game input.
document.addEventListener('pointerdown', () => {
  if (!['MENU', 'PAUSED', 'GAME_OVER'].includes(game.getState().mode)) {
    void rhythmAudio.unlock();
  }
}, { passive: true });

document.addEventListener('keydown', (event) => {
  if (event.code === 'Space') {
    if (event.target instanceof Element && event.target.closest('button, input, select, textarea, [contenteditable="true"]')) return;
    event.preventDefault();
    if (!event.repeat) {
      if (!['MENU', 'PAUSED', 'GAME_OVER'].includes(game.getState().mode)) void rhythmAudio.unlock();
      game.pressRhythm();
    }
  } else if (event.code === 'Escape') {
    if (game.getState().mode === 'PAUSED') resumeGame();
    else game.pause();
  }
});

function pauseForFocusLoss() {
  rhythmAudio.interrupt();
  if (debug.enabled) {
    game.resetFrameClock();
    debug.resetFrameClock();
    return;
  }
  const mode = game.getState().mode;
  if ([
    'CLIMBING', 'EVENT_WARNING', 'MONSTER_ENTRANCE', 'MONSTER_CAST', 'MONSTER_IMPACT',
    'ATTACK_TO_DEBUFF_DELAY', 'DEBUFF_REVEAL', 'DEBUFF_TO_ANSWER_DELAY', 'ANSWER_PREVIEW', 'MONSTER_QTE',
    'COMBAT_ATTACK_INTRO', 'COMBAT_ATTACK', 'COMBAT_RAPID_TAP', 'COMBAT_ATTACK_SETTLE', 'COMBAT_DEFENSE_INTRO',
    'COMBAT_DEFENSE', 'COMBAT_DEFENSE_SUCCESS', 'COMBAT_DEFENSE_FAILED', 'COMBAT_VICTORY', 'UPGRADE_SELECT'
  ].includes(mode)) game.pause();
}
window.addEventListener('blur', pauseForFocusLoss);
window.addEventListener('focus', () => {
  if (!debug.enabled) return;
  game.resetFrameClock();
  debug.resetFrameClock();
  if (!document.hidden) void rhythmAudio.recover(game.getState());
});
document.addEventListener('visibilitychange', () => {
  if (debug.enabled) {
    game.resetFrameClock();
    debug.resetFrameClock();
    if (document.hidden) rhythmAudio.interrupt();
    else void rhythmAudio.recover(game.getState());
  } else if (document.hidden) {
    pauseForFocusLoss();
  }
});

function frame(timestamp) {
  game.update(timestamp);
  if (debug.enabled) debug.update(timestamp, game);
  const state = game.getState();
  // UPGRADE_SELECT freezes gameplay and game.timerMs, so keep the BGM's own
  // AudioContext-based transport/scheduler advancing for this modal only.
  if (state.mode === 'UPGRADE_SELECT') rhythmAudio.sync(state);
  requestAnimationFrame(frame);
}

if (debug.autoStart) startGame();
requestAnimationFrame(frame);
