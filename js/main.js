import { createGame } from './game.js';
import { createUI } from './ui.js';
import { ANTI_DIZZINESS_MODE } from './config.js';

const game = createGame();
const ui = createUI((action, payload) => {
  if (action === 'start') game.start();
  else if (action === 'rhythm') game.pressRhythm();
  else if (action === 'qte-letter') game.pressQteLetter(payload);
  else if (action === 'pause') game.pause();
  else if (action === 'resume') game.resume();
  else if (action === 'set-anti-dizziness-mode') game.setAntiDizzinessMode(payload ? ANTI_DIZZINESS_MODE.ON : ANTI_DIZZINESS_MODE.OFF);
});

game.subscribe((state) => ui.render(state, game));

document.addEventListener('keydown', (event) => {
  if (event.code === 'Space') {
    event.preventDefault();
    if (!event.repeat) game.pressRhythm();
  } else if (event.code === 'Escape') {
    if (game.getState().mode === 'PAUSED') game.resume();
    else game.pause();
  }
});

function pauseForFocusLoss() {
  const mode = game.getState().mode;
  if (mode === 'CLIMBING' || mode === 'MONSTER_QTE') game.pause();
}
window.addEventListener('blur', pauseForFocusLoss);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseForFocusLoss();
});

function frame(timestamp) {
  game.update(timestamp);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
