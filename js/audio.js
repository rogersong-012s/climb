import { GAME_CONFIG, RHYTHM_AUDIO_CONFIG } from './config.js';
import { RHYTHM_PHASE } from './rhythm.js';
import { createInstrumentSampleBank } from './audio-voices.js';

const RHYTHM_MODES = new Set(['CLIMBING', 'COMBAT_ATTACK']);
const BGM_ACTIVE_MODES = new Set([
  'CLIMBING', 'EVENT_WARNING', 'MONSTER_ENTRANCE', 'MONSTER_CAST', 'MONSTER_IMPACT',
  'ATTACK_TO_DEBUFF_DELAY', 'DEBUFF_REVEAL', 'DEBUFF_TO_ANSWER_DELAY', 'ANSWER_PREVIEW',
  'MONSTER_QTE', 'QTE_FAILURE_KNOCKBACK', 'COMBAT_ATTACK_INTRO', 'COMBAT_ATTACK',
  'COMBAT_RAPID_TAP', 'COMBAT_ATTACK_SETTLE', 'COMBAT_DEFENSE_INTRO', 'COMBAT_DEFENSE',
  'COMBAT_DEFENSE_SUCCESS', 'COMBAT_DEFENSE_FAILED', 'COMBAT_VICTORY'
]);
const TONE_PRIORITY = Object.freeze({ spawn: 0, tick: 1 });
const ROCK_CHORDS = Object.freeze({
  D: Object.freeze({ root: 38, fifth: 45, octave: 50, triad: Object.freeze([62, 66, 69, 74]), power: Object.freeze([50, 57, 62]) }),
  A: Object.freeze({ root: 33, fifth: 40, octave: 45, triad: Object.freeze([57, 61, 64, 69]), power: Object.freeze([45, 52, 57]) }),
  Bm: Object.freeze({ root: 35, fifth: 42, octave: 47, triad: Object.freeze([59, 62, 66, 71]), power: Object.freeze([47, 54, 59]) }),
  G: Object.freeze({ root: 31, fifth: 38, octave: 43, triad: Object.freeze([55, 59, 62, 67]), power: Object.freeze([43, 50, 55]) }),
  Em: Object.freeze({ root: 40, fifth: 47, octave: 52, triad: Object.freeze([64, 67, 71, 76]), power: Object.freeze([52, 59, 64]) })
});
const ROCK_PROGRESSION = Object.freeze(['D', 'A', 'Bm', 'G', 'D', 'A', 'Em', 'G', 'Bm', 'A', 'G', 'A', 'D', 'Bm', 'A', 'A']);
const ROCK_LEAD_PHRASES = Object.freeze([
  Object.freeze([74, 76, 78, 81]), Object.freeze([83, 81, 78, 76]),
  Object.freeze([78, 81, 83, 86]), Object.freeze([84, 83, 81, 78]),
  Object.freeze([74, 78, 81, 86]), Object.freeze([85, 83, 81, 78]),
  Object.freeze([78, 81, 83, 86]), Object.freeze([88, 86, 83, 81]),
  Object.freeze([86, 83, 81, 78]), Object.freeze([81, 83, 86, 88]),
  Object.freeze([86, 88, 90, 93]), Object.freeze([92, 90, 88, 86]),
  Object.freeze([83, 86, 88, 90]), Object.freeze([88, 86, 83, 81]),
  Object.freeze([81, 83, 86, 88]), Object.freeze([85, 83, 81, 78])
]);
function midiToFrequency(midi) {
  return 440 * Math.pow(2, (Number(midi) - 69) / 12);
}

function elapsedInRoundMs(round) {
  const readyMs = Math.max(0, Number(round?.readyDurationMs) || 0);
  const moveMs = Math.max(0, Number(round?.totalBeats) || 0) * Math.max(0, Number(round?.beatDurationMs) || 0);
  if (round?.phase === RHYTHM_PHASE.SPAWN_READY) {
    return Math.min(readyMs, Math.max(0, Number(round.readyElapsedMs) || 0));
  }
  if (round?.phase === RHYTHM_PHASE.FINISHED) return readyMs + moveMs;
  return readyMs + Math.min(moveMs, Math.max(0, Number(round?.elapsedMs) || 0));
}

function roundFingerprint(round) {
  return [
    round.id, round.typeId, round.totalBeats, round.beatDurationMs, round.readyDurationMs,
    (round.hitBeats ?? []).join(',')
  ].join('|');
}

function buildRhythmCueTimeline(round) {
  const beatMs = Math.max(0, Number(round.beatDurationMs) || 0);
  const notesByTime = new Map();

  function add(timeMs, kind, beat, role) {
    const safeTimeMs = Math.max(0, Number(timeMs) || 0);
    const key = Math.round(safeTimeMs * 1000);
    const candidate = { timeMs: safeTimeMs, kind, beat, role, typeId: round.typeId };
    const existing = notesByTime.get(key);
    if (!existing || TONE_PRIORITY[kind] > TONE_PRIORITY[existing.kind]) notesByTime.set(key, candidate);
  }

  // Each ball has only two fixed preparation cues; the BGM owns every later beat.
  add(0, 'spawn', 0, 'spawn');
  add(beatMs, 'tick', 1, 'prepare');
  return [...notesByTime.values()].sort((first, second) => first.timeMs - second.timeMs);
}

function buildBgmArrangement(config) {
  const bars = Math.max(1, Math.floor(Number(config.bgmBars) || 16));
  const beatsPerBar = Math.max(1, Math.floor(Number(config.bgmBeatsPerBar) || 4));
  const events = [];
  let order = 0;
  const add = (beat, kind, options = {}) => events.push({
    beat,
    kind,
    track: options.track ?? kind,
    midi: options.midi ?? null,
    chord: options.chord ?? null,
    pan: options.pan ?? 0,
    velocity: options.velocity ?? 0.5,
    durationBeats: options.durationBeats ?? 1,
    durationSeconds: options.durationSeconds ?? null,
    order: order++
  });

  for (let bar = 0; bar < bars; bar += 1) {
    const section = bar < 2 ? 'intro'
      : bar < 6 ? 'main'
        : bar < 10 ? 'development'
          : bar < 14 ? 'climax'
            : 'ending';
    const barBeat = bar * beatsPerBar;
    const chord = ROCK_CHORDS[ROCK_PROGRESSION[bar % ROCK_PROGRESSION.length]];
    const phrase = ROCK_LEAD_PHRASES[bar % ROCK_LEAD_PHRASES.length];
    const finalBar = section === 'ending' && bar === bars - 1;
    const sectionLevel = section === 'intro' ? 0.62
      : section === 'main' ? 0.88
        : section === 'development' ? 0.82
          : section === 'climax' ? 1
            : 0.9;

    // The 156 BPM four-on-the-floor pulse keeps the sports-racing drive steady.
    for (let beat = 0; beat < beatsPerBar; beat += 1) {
      const kickOnBeat = section !== 'intro' || beat === 0 || beat === 2;
      if (kickOnBeat) {
        add(barBeat + beat, 'kick', {
          track: 'drums', velocity: (beat === 0 ? 0.56 : 0.47) * sectionLevel,
          durationSeconds: 0.28
        });
      }

      if (beat === 1 || beat === 3) {
        add(barBeat + beat, 'snare', {
          track: 'drums', velocity: (beat === 3 ? 0.42 : 0.36) * sectionLevel,
          durationSeconds: 0.22
        });
      }

      // Even eighth-note hats are quiet; open hats mark phrase lifts.
      for (const subdivision of [0, 0.5]) {
        const open = subdivision === 0.5 && beat === 3 && [1, 5, 9, 13, 15].includes(bar);
        add(barBeat + beat + subdivision, open ? 'hatOpen' : 'hatClosed', {
          track: 'drums', velocity: (open ? 0.24 : 0.115) * sectionLevel,
          durationSeconds: open ? 0.31 : 0.068
        });
      }
    }

    if ([0, 2, 10, 12, 14].includes(bar)) {
      add(barBeat, 'crash', {
        track: 'drums', velocity: bar === 0 ? 0.24 : 0.42 * sectionLevel,
        durationSeconds: 0.78
      });
    }

    // Rhythm guitar plays restrained eighth-note power-chord strokes. Alternating
    // panning creates width while the centered drums and bass keep the beat firm.
    const guitarStrokes = bar < 2
      ? [0, 2, 4, 6]
      : Array.from({ length: beatsPerBar * 2 }, (_, index) => index);
    for (const eighth of guitarStrokes) {
      const beat = barBeat + eighth * 0.5;
      const downstroke = eighth % 2 === 0;
      const chordNotes = downstroke ? chord.power : [chord.power[1], chord.power[2]];
      add(beat, 'rhythmGuitar', {
        track: 'rhythmGuitar', chord: chordNotes,
        velocity: (bar < 2 ? 0.21 : downstroke ? 0.19 : 0.105) * sectionLevel,
        durationSeconds: bar < 2 ? 0.22 : 0.155,
        pan: downstroke ? -0.42 : 0.42
      });
    }

    // The bass starts with quarter-note anchors, then adds eighth-note motion.
    for (let beat = 0; beat < beatsPerBar; beat += 1) {
      const bassPattern = [chord.root, chord.root, chord.fifth, chord.root,
        chord.octave, chord.root, chord.fifth, chord.root];
      const includeOffbeat = bar >= 2 && section !== 'development';
      for (const subdivision of (includeOffbeat ? [0, 0.5] : [0])) {
        const step = beat * 2 + Math.round(subdivision * 2);
        add(barBeat + beat + subdivision, 'bass', {
          track: 'bass', midi: bassPattern[step % bassPattern.length],
          velocity: (subdivision === 0 ? 0.25 : 0.145) * sectionLevel,
          durationSeconds: subdivision === 0 ? 0.22 : 0.16
        });
      }
    }

    // Piano chord attacks are brief and sit behind the guitar rhythm.
    if (section === 'intro' || section === 'development' || section === 'ending') {
      for (const beat of [0, 2]) {
        add(barBeat + beat, 'piano', {
          track: 'piano', chord: chord.triad.slice(0, 3),
          velocity: (section === 'intro' ? 0.16 : 0.19) * sectionLevel,
          durationSeconds: 0.42
        });
      }
    } else if (section === 'main' || section === 'climax') {
      for (let beat = 0; beat < beatsPerBar; beat += 2) {
        add(barBeat + beat, 'piano', {
          track: 'piano', chord: [chord.triad[0] + 12, chord.triad[1] + 12],
          velocity: 0.13 * sectionLevel, durationSeconds: 0.32
        });
      }
    }

    // Sustained strings build from the middle section into the final chorus.
    if (section === 'development' || section === 'climax' || section === 'ending') {
      add(barBeat, 'strings', {
        track: 'strings', chord: chord.triad.slice(0, section === 'development' ? 2 : 3),
        velocity: (section === 'development' ? 0.12 : 0.18) * sectionLevel,
        durationBeats: beatsPerBar
      });
    }

    // The chorus gets short brass punches on the strong beats only.
    if (section === 'climax') {
      for (const beat of [0, 2]) {
        add(barBeat + beat, 'brass', {
          track: 'brass', chord: [chord.triad[0] + 12, chord.triad[2] + 12],
          velocity: 0.14 * sectionLevel, durationSeconds: 0.26
        });
      }
    }

    if (section === 'main' || section === 'climax' || section === 'ending') {
      for (let beat = 0; beat < beatsPerBar; beat += 1) {
        const lift = section === 'climax' && beat >= 2 ? 12 : 0;
        const midi = finalBar && beat === 3 ? 73 : phrase[beat] + lift;
        add(barBeat + beat, 'leadGuitar', {
          track: 'leadGuitar', midi,
          velocity: (section === 'climax' ? 0.29 : 0.24) * sectionLevel,
          durationSeconds: 0.31
        });
      }
    } else if (section === 'intro' && bar === 1) {
      for (const beat of [2, 3]) {
        add(barBeat + beat, 'leadGuitar', {
          track: 'leadGuitar', midi: phrase[beat] - 12,
          velocity: 0.13, durationSeconds: 0.26
        });
      }
    }

    if ([5, 9, 13, 15].includes(bar)) {
      [2, 2.5, 3, 3.5].forEach((beat, index) => {
        add(barBeat + beat, index < 2 ? 'tomHigh' : 'tomLow', {
          track: 'drums', velocity: (index === 3 ? 0.28 : 0.2) * sectionLevel,
          durationSeconds: 0.24
        });
      });
    }
  }

  return events.sort((first, second) => first.beat - second.beat || first.order - second.order);
}

export function createRhythmAudio({ config = RHYTHM_AUDIO_CONFIG, audioContextFactory = null } = {}) {
  let context = null;
  let masterGain = null;
  let bgmBoostGain = null;
  let outputLimiter = null;
  let bgmBus = null;
  const bgmInstrumentBuses = new Map();
  let instrumentSamples = null;
  let rhythmBus = null;
  let feedbackBus = null;
  let rhythmBusLevel = 1;
  let unavailable = false;
  let resumePromise = null;
  let latestState = null;
  let activeFingerprint = null;
  let finishedFingerprint = null;
  let timeline = [];
  let nextNoteIndex = 0;
  let originAudioTime = null;
  let rhythmOriginBgmBeatPosition = null;
  let rhythmNeedsReanchor = true;
  let wasPaused = false;
  let interrupted = false;
  let latestElapsedMs = 0;
  let bgmEvents = buildBgmArrangement(config);
  let bgmBeatPosition = 0;
  let lastBgmTimerMs = null;
  let transportBeatDurationMs = GAME_CONFIG.rhythmBeatDurationMs / GAME_CONFIG.rhythmMoveSpeedMultiplier;
  let bgmCycle = 0;
  let bgmEventIndex = 0;
  let bgmStarted = false;
  let bgmHeld = false;
  let bgmTerminal = false;
  let lastBgmBusLevel = null;
  let lastInputFeedbackId = null;
  let lastInputFeedbackKind = null;
  let lastInputFeedbackAt = -Infinity;
  const activeNotes = new Set();
  const loopBeats = Math.max(1, Number(config.bgmBars) || 16) * Math.max(1, Number(config.bgmBeatsPerBar) || 4);

  function effectiveBeatDurationMs(state) {
    const roundBeat = Number(state?.rhythmRound?.beatDurationMs);
    if (Number.isFinite(roundBeat) && roundBeat > 0) return roundBeat;
    const soreMultiplier = state?.debuffs?.SORE ? GAME_CONFIG.debuffs.SORE.speedMultiplier : 1;
    return GAME_CONFIG.rhythmBeatDurationMs /
      (Math.max(0.01, soreMultiplier) * GAME_CONFIG.rhythmMoveSpeedMultiplier);
  }

  function ensureContext() {
    if (context || unavailable || !config.enabled) return Boolean(context);
    try {
      if (audioContextFactory) {
        context = audioContextFactory();
      } else {
        const AudioContextConstructor = globalThis.AudioContext ??
          globalThis.webkitAudioContext ??
          globalThis.window?.AudioContext ??
          globalThis.window?.webkitAudioContext;
        if (!AudioContextConstructor) {
          unavailable = true;
          return false;
        }
        context = new AudioContextConstructor();
      }

      masterGain = context.createGain();
      bgmBoostGain = context.createGain();
      bgmBus = context.createGain();
      rhythmBus = context.createGain();
      feedbackBus = context.createGain();
      instrumentSamples = createInstrumentSampleBank(context);
      outputLimiter = typeof context.createDynamicsCompressor === 'function'
        ? context.createDynamicsCompressor()
        : null;
      const boost = Math.pow(10, (Number(config.masterGainBoostDb) || 0) / 20);
      masterGain.gain.setValueAtTime(Math.max(0, (Number(config.masterVolume) || 0) * boost), context.currentTime);
      // createNote previously attenuated every voice by masterVolume and then
      // applied masterVolume again at the output. Keep effects at their old
      // level, while removing that duplicate attenuation from the music path.
      bgmBoostGain.gain.setValueAtTime(
        Math.pow(10, (Number(config.bgmMasterBoostDb) || 0) / 20),
        context.currentTime
      );
      bgmBus.gain.setValueAtTime(Math.max(0, Number(config.bgmBusVolume) || 0.78), context.currentTime);
      rhythmBus.gain.setValueAtTime(Math.max(0, Number(config.rhythmCueBusVolume) || 1), context.currentTime);
      rhythmBusLevel = Math.max(0, Number(config.rhythmCueBusVolume) || 1);
      feedbackBus.gain.setValueAtTime(Math.max(0, Number(config.feedbackBusVolume) || 1), context.currentTime);
      for (const [track, level] of Object.entries(config.bgmInstrumentBusLevels ?? {})) {
        const bus = context.createGain();
        bus.gain.setValueAtTime(Math.max(0, Number(level) || 0), context.currentTime);
        bus.connect(bgmBus);
        bgmInstrumentBuses.set(track, bus);
      }
      bgmBus.connect(bgmBoostGain);
      bgmBoostGain.connect(masterGain);
      rhythmBus.connect(masterGain);
      feedbackBus.connect(masterGain);

      if (outputLimiter) {
        outputLimiter.threshold.setValueAtTime(-1.5, context.currentTime);
        outputLimiter.knee.setValueAtTime(2, context.currentTime);
        outputLimiter.ratio.setValueAtTime(16, context.currentTime);
        outputLimiter.attack.setValueAtTime(0.003, context.currentTime);
        outputLimiter.release.setValueAtTime(0.18, context.currentTime);
        masterGain.connect(outputLimiter);
      } else {
        masterGain.connect(context.destination);
      }

      // A gentle final ceiling catches fast transients that pass through the
      // compressor attack time. It is safety limiting, not a loudness claim.
      if (typeof context.createWaveShaper === 'function') {
        const softClipper = context.createWaveShaper();
        const curve = new Float32Array(2048);
        for (let index = 0; index < curve.length; index += 1) {
          const x = (index * 2) / (curve.length - 1) - 1;
          const magnitude = Math.abs(x);
          const shaped = magnitude <= 0.78
            ? magnitude
            : 0.78 + 0.11 * (1 - Math.exp(-(magnitude - 0.78) / 0.11));
          curve[index] = Math.sign(x) * Math.min(0.89, shaped);
        }
        softClipper.curve = curve;
        softClipper.oversample = '2x';
        if (outputLimiter) outputLimiter.connect(softClipper);
        else masterGain.disconnect(context.destination);
        if (!outputLimiter) masterGain.connect(softClipper);
        softClipper.connect(context.destination);
      } else if (outputLimiter) {
        outputLimiter.connect(context.destination);
      } else {
        // Last-resort ceiling for unusual Web Audio implementations without dynamics nodes.
        masterGain.gain.setValueAtTime(Math.min(0.95, Math.max(0, (Number(config.masterVolume) || 0) * boost)), context.currentTime);
      }
      lastBgmBusLevel = Number(config.bgmBusVolume) || 0.78;
      return true;
    } catch {
      unavailable = true;
      context = null;
      masterGain = null;
      bgmBoostGain = null;
      bgmBus = null;
      rhythmBus = null;
      feedbackBus = null;
      bgmInstrumentBuses.clear();
      instrumentSamples = null;
      outputLimiter = null;
      return false;
    }
  }

  function stopNote(note, now, fadeSeconds = 0.012) {
    if (note.stopping) return;
    note.stopping = true;
    try {
      note.output.gain.cancelScheduledValues(now);
      note.output.gain.setTargetAtTime(0, now, Math.max(0.002, fadeSeconds / 3));
    } catch { /* Audio may already be suspended or ended. */ }
    for (const oscillator of note.oscillators) {
      try { oscillator.stop(now + Math.max(0.008, fadeSeconds)); } catch { /* The source already ended. */ }
    }
  }

  function stopQueuedNotes({ track = null, includeStarted = true, preserveFinish = false, fadeSeconds = 0.012 } = {}) {
    if (!context) return;
    const now = context.currentTime;
    for (const note of activeNotes) {
      if (track && note.track !== track) continue;
      if (preserveFinish && note.role === 'finish') continue;
      if (includeStarted || note.when > now + 0.003) stopNote(note, now, fadeSeconds);
    }
  }

  function clearRhythmTimeline({ includeStarted = true, preserveFinish = false } = {}) {
    stopQueuedNotes({ track: 'rhythm', includeStarted, preserveFinish });
    activeFingerprint = null;
    finishedFingerprint = null;
    timeline = [];
    nextNoteIndex = 0;
    originAudioTime = null;
    rhythmOriginBgmBeatPosition = null;
    rhythmNeedsReanchor = true;
  }

  function trackSource(note, source, connectedNodes = []) {
    note.oscillators.add(source);
    source.onended = () => {
      note.oscillators.delete(source);
      try { source.disconnect(); } catch { /* Already disconnected. */ }
      connectedNodes.forEach((node) => {
        try { node.disconnect(); } catch { /* Already disconnected. */ }
      });
      if (note.oscillators.size === 0) {
        activeNotes.delete(note);
        try { note.output.disconnect(); } catch { /* Already disconnected. */ }
      }
    };
  }

  function createNote(track, when, durationSeconds, volume, role = 'note', instrumentTrack = null) {
    const safeDuration = Math.max(0.025, Number(durationSeconds) || 0.1);
    const note = {
      track,
      role,
      when,
      durationSeconds: safeDuration,
      output: context.createGain(),
      oscillators: new Set(),
      stopping: false
    };
    const voiceGain = track === 'bgm' ? 1 : Math.max(0, Number(config.masterVolume) || 0);
    const peak = Math.max(0, voiceGain * (Number(volume) || 0));
    note.output.gain.setValueAtTime(0.0001, when);
    note.output.gain.linearRampToValueAtTime(peak, when + 0.004);
    note.output.gain.exponentialRampToValueAtTime(0.0001, when + safeDuration);
    const destination = track === 'bgm'
      ? (bgmInstrumentBuses.get(instrumentTrack) ?? bgmBus)
      : track === 'feedback' ? feedbackBus : rhythmBus;
    note.output.connect(destination);
    activeNotes.add(note);
    return note;
  }

  function createOscillator(note, frequencyHz, waveType = 'sine', partialGain = 1, endFrequencyHz = null, decaySeconds = null, startOffset = 0) {
    const oscillator = context.createOscillator();
    const partial = context.createGain();
    const startAt = note.when + startOffset;
    oscillator.type = waveType;
    oscillator.frequency.setValueAtTime(Math.max(1, frequencyHz), startAt);
    if (Number.isFinite(endFrequencyHz) && endFrequencyHz > 0) {
      oscillator.frequency.exponentialRampToValueAtTime(
        endFrequencyHz,
        startAt + Math.max(0.015, note.durationSeconds * 0.8)
      );
    }
    partial.gain.setValueAtTime(Math.max(0.0001, partialGain), startAt);
    if (Number.isFinite(decaySeconds) && decaySeconds > 0) {
      partial.gain.exponentialRampToValueAtTime(
        0.0001,
        startAt + Math.min(decaySeconds, note.durationSeconds)
      );
    }
    oscillator.connect(partial);
    partial.connect(note.output);
    trackSource(note, oscillator, [partial]);
    oscillator.start(startAt);
    oscillator.stop(startAt + note.durationSeconds + 0.008);
  }

  function createSampleVoice(note, voiceName, { midi = null, pan = 0, startOffset = 0 } = {}) {
    const voice = instrumentSamples?.[voiceName];
    if (!voice?.buffer) return false;
    const source = context.createBufferSource();
    const startAt = note.when + Math.max(0, startOffset);
    source.buffer = voice.buffer;
    if (Number.isFinite(midi) && Number.isFinite(voice.baseMidi)) {
      const playbackRate = Math.pow(2, (midi - voice.baseMidi) / 12);
      source.playbackRate.setValueAtTime(Math.max(0.25, Math.min(4, playbackRate)), startAt);
    }
    let panner = null;
    if (Math.abs(pan) > 0.001 && typeof context.createStereoPanner === 'function') {
      panner = context.createStereoPanner();
      panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), startAt);
      source.connect(panner);
      panner.connect(note.output);
    } else {
      source.connect(note.output);
    }
    trackSource(note, source, panner ? [panner] : []);
    source.start(startAt);
    try { source.stop(startAt + note.durationSeconds + 0.012); } catch { /* Buffer may naturally end first. */ }
    return true;
  }

  function playRhythmCue(event, scheduledTime) {
    const now = context.currentTime;
    const when = Math.max(scheduledTime, now + 0.002);
    const duration = Math.max(0.06, Number(config.prepCueDurationSeconds) || 0.14);
    const volume = Math.max(0, Math.min(1, Number(config.prepCueVolume) || 0.52));
    const note = createNote('rhythm', when, duration, volume, event.role);
    const notePair = config.prepCueNotesByType?.[event.typeId] ?? [72, 74];
    const midi = Number(notePair[event.beat === 1 ? 1 : 0]) || 72;
    const frequency = midiToFrequency(midi);
    // Same soft electronic pluck for every color; only the two-note pitch pair changes.
    createOscillator(note, frequency, 'triangle', 0.52, frequency * 1.015, duration * 0.62);
    createOscillator(note, frequency * 2.01, 'sine', 0.075, frequency * 2, duration * 0.38);
  }

  function playBgmEvent(event, scheduledTime, beatMs) {
    const now = context.currentTime;
    const when = Math.max(scheduledTime, now + 0.002);
    const duration = Math.max(0.03, Number(event.durationSeconds) ||
      (Math.max(0.05, Number(event.durationBeats) || 1) * Math.max(1, beatMs) / 1000));
    const volume = (Number(config.bgmVolume) || 0.36) * Math.max(0, Number(event.velocity) || 0.4);
    const track = event.track ?? event.kind;
    const note = createNote('bgm', when, duration, volume, 'bgm', track);
    const playChord = (voiceName, notes, pan = 0) => {
      (notes ?? []).forEach((midi, index) => {
        const spread = notes.length > 1 ? (index / (notes.length - 1) - 0.5) * 0.16 : 0;
        createSampleVoice(note, voiceName, {
          midi: Number(midi),
          pan: Math.max(-1, Math.min(1, pan + spread)),
          startOffset: track === 'rhythmGuitar' ? index * 0.007 : 0
        });
      });
    };

    if (event.kind === 'kick' || event.kind === 'snare' || event.kind === 'hatClosed' ||
        event.kind === 'hatOpen' || event.kind === 'crash' || event.kind === 'tomHigh' || event.kind === 'tomLow') {
      const voiceName = event.kind === 'hatClosed' ? 'hatClosed' :
        event.kind === 'hatOpen' ? 'hatOpen' : event.kind;
      createSampleVoice(note, voiceName);
    } else if (event.kind === 'rhythmGuitar') {
      playChord('rhythmGuitar', event.chord, Number(event.pan) || 0);
    } else if (event.kind === 'leadGuitar') {
      createSampleVoice(note, 'leadGuitar', { midi: Number(event.midi) });
    } else if (event.kind === 'bass') {
      createSampleVoice(note, 'bass', { midi: Number(event.midi) });
    } else if (event.kind === 'piano' || event.kind === 'strings' || event.kind === 'brass') {
      playChord(event.kind, event.chord);
    }
  }

  function playInputFeedback(kind, eventId = null) {
    if (kind !== 'hit' && kind !== 'miss') return false;
    if (eventId !== null && eventId === lastInputFeedbackId) return false;
    if (!context || context.state !== 'running' || !feedbackBus) return false;
    if (eventId === null && kind === lastInputFeedbackKind &&
        (context.currentTime - lastInputFeedbackAt) * 1000 < Math.max(0, Number(config.feedbackDuplicateGuardMs) || 0)) {
      return false;
    }
    if (eventId !== null) lastInputFeedbackId = eventId;
    lastInputFeedbackKind = kind;
    lastInputFeedbackAt = context.currentTime;

    const isHit = kind === 'hit';
    const duration = isHit
      ? Number(config.hitFeedbackDurationSeconds) || 0.14
      : Number(config.missFeedbackDurationSeconds) || 0.2;
    const volume = isHit
      ? Number(config.hitFeedbackVolume) || 0.55
      : Number(config.missFeedbackVolume) || 0.4;
    const when = context.currentTime + 0.002;
    const duckDuration = Math.max(0.04, Number(config.feedbackDuckDurationSeconds) || 0.11);
    const duckBus = (bus, baseLevel, duckGain) => {
      if (!bus) return;
      const base = Math.max(0, Number(baseLevel) || 0);
      const now = context.currentTime;
      bus.gain.cancelScheduledValues(now);
      bus.gain.setValueAtTime(base, now);
      bus.gain.linearRampToValueAtTime(base * Math.max(0.1, Math.min(1, duckGain)), now + 0.004);
      bus.gain.setValueAtTime(base * Math.max(0.1, Math.min(1, duckGain)), now + duckDuration * 0.58);
      bus.gain.linearRampToValueAtTime(base, now + duckDuration);
    };
    duckBus(bgmBus, lastBgmBusLevel ?? Number(config.bgmBusVolume) ?? 0.78, config.feedbackBgmDuckGain ?? 0.9);
    duckBus(rhythmBus, rhythmBusLevel, config.feedbackRhythmDuckGain ?? 0.75);
    const note = createNote('feedback', when, duration, volume, `input-${kind}`);
    if (isHit) {
      // Inharmonic sine partials give a short bright bell/metal strike, distinct from the BGM plucks.
      createOscillator(note, 988, 'sine', 0.48, 988, duration * 0.72);
      createOscillator(note, 988 * 2.76, 'sine', 0.16, 988 * 2.76, duration * 0.34);
      createOscillator(note, 988 * 5.4, 'sine', 0.055, 988 * 5.4, duration * 0.2);
    } else {
      // A compact falling sine thump reads as a low electronic drum without a sharp alert tail.
      createOscillator(note, 142, 'sine', 0.58, 48, duration * 0.48);
      createOscillator(note, 68, 'triangle', 0.2, 52, duration * 0.65, 0.008);
    }
    return true;
  }

  function setBgmBusLevel(level) {
    if (!context || !bgmBus) return;
    const safeLevel = Math.max(0, Math.min(1, Number(level) || 0));
    if (lastBgmBusLevel !== null && Math.abs(lastBgmBusLevel - safeLevel) < 1e-5) return;
    const now = context.currentTime;
    bgmBus.gain.cancelScheduledValues(now);
    bgmBus.gain.setTargetAtTime(safeLevel, now, 0.055);
    lastBgmBusLevel = safeLevel;
  }

  function resetBgmCursor(position = bgmBeatPosition, includeCurrent = false) {
    const safePosition = Math.max(0, Number(position) || 0);
    const cycle = Math.floor(safePosition / loopBeats);
    const localBeat = safePosition - cycle * loopBeats;
    const index = bgmEvents.findIndex((event) => includeCurrent
      ? event.beat >= localBeat - 1e-6
      : event.beat > localBeat + 1e-6);
    if (index < 0) {
      bgmCycle = cycle + 1;
      bgmEventIndex = 0;
    } else {
      bgmCycle = cycle;
      bgmEventIndex = index;
    }
  }

  function advanceBgmCursor() {
    bgmEventIndex += 1;
    if (bgmEventIndex >= bgmEvents.length) {
      bgmEventIndex = 0;
      bgmCycle += 1;
    }
  }

  function updateBgmTransport(state) {
    const timerMs = Number(state?.timerMs);
    if (!Number.isFinite(timerMs)) return;
    const currentBeatMs = effectiveBeatDurationMs(state);
    if (lastBgmTimerMs === null || timerMs < lastBgmTimerMs - 1e-6) {
      bgmBeatPosition = 0;
      lastBgmTimerMs = timerMs;
      transportBeatDurationMs = currentBeatMs;
      bgmStarted = false;
      resetBgmCursor(0, true);
      return;
    }

    const deltaMs = Math.max(0, timerMs - lastBgmTimerMs);
    if (deltaMs > 0) bgmBeatPosition += deltaMs / Math.max(1, transportBeatDurationMs);
    lastBgmTimerMs = timerMs;

    if (deltaMs > 900) {
      // Do not replay a backlog of notes after a background-tab/frame stall.
      stopQueuedNotes({ track: 'bgm', includeStarted: false });
      resetBgmCursor(bgmBeatPosition, false);
      bgmHeld = false;
    }
    // Keep the musical phase continuous when a debuff changes tempo; only the
    // beat-to-time slope for future scheduling changes, never the song cursor.
    transportBeatDurationMs = currentBeatMs;
  }

  function scheduleBgm(state) {
    if (!context || context.state !== 'running' || !bgmBus) return;
    if (!bgmStarted) {
      resetBgmCursor(bgmBeatPosition, true);
      bgmStarted = true;
      bgmHeld = false;
    } else if (bgmHeld) {
      resetBgmCursor(bgmBeatPosition, false);
      bgmHeld = false;
    }

    const lowerDuringEvent = state.mode !== 'CLIMBING';
    setBgmBusLevel(lowerDuringEvent
      ? (Number(config.bgmEncounterBusVolume) || 0.56)
      : (Number(config.bgmBusVolume) || 0.78));

    const beatMs = Math.max(1, effectiveBeatDurationMs(state));
    const now = context.currentTime;
    const horizonSeconds = Math.max(0.025, Number(config.bgmLookAheadSeconds) || 0.12);
    const horizonBeat = bgmBeatPosition + horizonSeconds * 1000 / beatMs;
    const lateToleranceBeats = Math.max(0, Number(config.bgmLateToleranceMs) || 0) / beatMs;
    while (true) {
      const event = bgmEvents[bgmEventIndex];
      const absoluteBeat = bgmCycle * loopBeats + event.beat;
      if (absoluteBeat > horizonBeat + 1e-8) break;
      advanceBgmCursor();
      if (absoluteBeat < bgmBeatPosition - lateToleranceBeats) continue;
      const scheduledTime = now + Math.max(0, (absoluteBeat - bgmBeatPosition) * beatMs / 1000);
      playBgmEvent(event, scheduledTime, beatMs);
    }
  }

  function firstUnplayedNoteIndex(elapsedMs) {
    const toleranceMs = Math.max(0, Number(config.lateToleranceMs) || 0);
    const offsetMs = Number(config.rhythmAudioOffsetMs) || 0;
    const earliestCurrentEventMs = elapsedMs + offsetMs - toleranceMs;
    let index = 0;
    while (index < timeline.length && timeline[index].timeMs < earliestCurrentEventMs) index += 1;
    return index;
  }

  function cancelForPause() {
    stopQueuedNotes({ includeStarted: true, fadeSeconds: 0.018 });
    clearRhythmTimeline();
    rhythmNeedsReanchor = true;
    bgmHeld = true;
    if (context?.state === 'running') {
      try { void context.suspend().catch(() => {}); } catch { /* Optional audio only. */ }
    }
  }

  function syncRhythm(state) {
    const round = state.rhythmRound;
    if (!round || !RHYTHM_MODES.has(state.mode)) {
      if (activeFingerprint !== null) {
        const completedAttackRound = state.mode === 'COMBAT_RAPID_TAP';
        clearRhythmTimeline({ includeStarted: !completedAttackRound, preserveFinish: completedAttackRound });
      }
      return;
    }

    const roundFinished = round.phase === RHYTHM_PHASE.FINISHED;
    const elapsedMs = elapsedInRoundMs(round);
    latestElapsedMs = elapsedMs;
    const fingerprint = roundFingerprint(round);
    if (fingerprint !== activeFingerprint) {
      stopQueuedNotes({ track: 'rhythm', includeStarted: true });
      activeFingerprint = fingerprint;
      finishedFingerprint = null;
      timeline = buildRhythmCueTimeline(round);
      nextNoteIndex = firstUnplayedNoteIndex(elapsedMs);
      originAudioTime = context?.state === 'running' ? context.currentTime - elapsedMs / 1000 : null;
      rhythmOriginBgmBeatPosition = bgmBeatPosition - elapsedMs /
        Math.max(1, Number(round.beatDurationMs) || transportBeatDurationMs);
      rhythmNeedsReanchor = originAudioTime === null;
    } else if (rhythmNeedsReanchor && context?.state === 'running') {
      originAudioTime = context.currentTime - elapsedMs / 1000;
      nextNoteIndex = firstUnplayedNoteIndex(elapsedMs);
      rhythmNeedsReanchor = false;
    }

    if (roundFinished && state.mode === 'CLIMBING') {
      if (finishedFingerprint !== fingerprint) {
        stopQueuedNotes({ track: 'rhythm', includeStarted: true, preserveFinish: true });
        finishedFingerprint = fingerprint;
      }
      return;
    }
    if (!context || context.state !== 'running' || originAudioTime === null) return;

    const now = context.currentTime;
    const horizon = now + Math.max(0.025, Number(config.lookAheadSeconds) || 0.09);
    const lateToleranceSeconds = Math.max(0, Number(config.lateToleranceMs) || 0) / 1000;
    while (nextNoteIndex < timeline.length) {
      const event = timeline[nextNoteIndex];
      const offsetMs = Number(config.rhythmAudioOffsetMs) || 0;
      const scheduledTime = originAudioTime + (event.timeMs - offsetMs) / 1000;
      if (scheduledTime > horizon) break;
      nextNoteIndex += 1;
      if (scheduledTime < now - lateToleranceSeconds) {
        event.scheduleStatus = 'skipped-late';
        continue;
      }
      event.scheduleStatus = 'scheduled';
      event.scheduledAudioTimeSeconds = Math.max(scheduledTime, now + 0.002);
      event.actualSchedulingOffsetFromGameCenterMs =
        (event.scheduledAudioTimeSeconds - (originAudioTime + event.timeMs / 1000)) * 1000;
      playRhythmCue(event, scheduledTime);
    }
  }

  function sync(state = latestState) {
    if (!state) return;
    latestState = state;
    if (!config.enabled || unavailable) return;
    updateBgmTransport(state);

    if (state.mode === 'PAUSED') {
      if (!wasPaused) cancelForPause();
      wasPaused = true;
      return;
    }
    wasPaused = false;
    if (interrupted) return;

    if (state.mode === 'UPGRADE_SELECT') {
      if (!bgmHeld) {
        stopQueuedNotes({ track: 'bgm', includeStarted: true, fadeSeconds: 0.09 });
        clearRhythmTimeline();
        bgmHeld = true;
      }
      return;
    }
    if (state.mode === 'RESULT' || state.mode === 'GAME_OVER') {
      if (!bgmTerminal) {
        stopQueuedNotes({ track: 'bgm', includeStarted: true, fadeSeconds: 0.24 });
        clearRhythmTimeline();
        bgmTerminal = true;
      }
      return;
    }
    if (state.mode === 'MENU' || !BGM_ACTIVE_MODES.has(state.mode)) {
      if (state.mode === 'MENU') {
        stopQueuedNotes({ includeStarted: true, fadeSeconds: 0.06 });
        clearRhythmTimeline();
        bgmHeld = true;
      }
      return;
    }

    if (!context || context.state !== 'running') return;
    scheduleBgm(state);
    syncRhythm(state);
  }

  async function unlock() {
    if (!config.enabled || !ensureContext()) return false;
    if (context.state === 'running') {
      if (rhythmNeedsReanchor && latestState) sync(latestState);
      else if (latestState) sync(latestState);
      return true;
    }
    if (resumePromise) return resumePromise;
    try {
      resumePromise = Promise.resolve(context.resume()).then(() => {
        const running = context?.state === 'running';
        if (running && latestState) {
          rhythmNeedsReanchor = true;
          bgmHeld = bgmStarted;
          sync(latestState);
        }
        return running;
      }).catch(() => false).finally(() => { resumePromise = null; });
      return await resumePromise;
    } catch {
      resumePromise = null;
      return false;
    }
  }

  function interrupt() {
    interrupted = true;
    stopQueuedNotes({ includeStarted: true, fadeSeconds: 0.018 });
    rhythmNeedsReanchor = true;
    bgmHeld = true;
    if (context?.state === 'running') {
      try { void context.suspend().catch(() => {}); } catch { /* Optional audio only. */ }
    }
  }

  async function recover(state = latestState) {
    if (!state || state.mode === 'PAUSED' || !config.enabled || !context) return false;
    latestState = state;
    interrupted = false;
    rhythmNeedsReanchor = true;
    bgmHeld = bgmStarted;
    if (context.state === 'running') {
      sync(state);
      return true;
    }
    return unlock();
  }

  function reset() {
    stopQueuedNotes({ includeStarted: true, fadeSeconds: 0.012 });
    latestState = null;
    activeFingerprint = null;
    finishedFingerprint = null;
    timeline = [];
    nextNoteIndex = 0;
    originAudioTime = null;
    rhythmOriginBgmBeatPosition = null;
    rhythmNeedsReanchor = true;
    wasPaused = false;
    interrupted = false;
    latestElapsedMs = 0;
    bgmBeatPosition = 0;
    lastBgmTimerMs = null;
    transportBeatDurationMs = GAME_CONFIG.rhythmBeatDurationMs / GAME_CONFIG.rhythmMoveSpeedMultiplier;
    bgmCycle = 0;
    bgmEventIndex = 0;
    bgmStarted = false;
    bgmHeld = false;
    bgmTerminal = false;
    lastBgmBusLevel = null;
    lastInputFeedbackId = null;
    lastInputFeedbackKind = null;
    lastInputFeedbackAt = -Infinity;
  }

  function getDiagnostics() {
    const round = latestState?.rhythmRound;
    const beatDurationMs = round?.beatDurationMs
      ? Number(round.beatDurationMs)
      : effectiveBeatDurationMs(latestState);
    const prepareDurationMs = Number(round?.readyDurationMs) || 0;
    const prepareBeats = beatDurationMs > 0 ? prepareDurationMs / beatDurationMs : 0;
    const offsetMs = Number(config.rhythmAudioOffsetMs) || 0;
    const estimatedOutputLatencyMs = context
      ? Number.isFinite(context.outputLatency) ? context.outputLatency * 1000
        : Number.isFinite(context.baseLatency) ? context.baseLatency * 1000
          : null
      : null;
    const preparationCues = timeline.map((event) => {
      const plannedAudioTimeSeconds = originAudioTime === null
        ? null
        : originAudioTime + (event.timeMs - offsetMs) / 1000;
      const bgmBeatPosition = rhythmOriginBgmBeatPosition === null
        ? null
        : rhythmOriginBgmBeatPosition + event.beat;
      const fractionalBgmBeat = bgmBeatPosition === null
        ? null
        : ((bgmBeatPosition % 1) + 1) % 1;
      const bgmGridOffsetBeats = fractionalBgmBeat === null
        ? null
        : fractionalBgmBeat > 0.5 ? fractionalBgmBeat - 1 : fractionalBgmBeat;
      return {
        kind: event.kind,
        beatFromSpawn: event.beat,
        timeMs: event.timeMs,
        plannedAudioTimeSeconds,
        scheduledAudioTimeSeconds: event.scheduledAudioTimeSeconds ?? null,
        bgmBeatPosition,
        bgmGridOffsetBeats,
        scheduleStatus: event.scheduleStatus ?? 'pending'
      };
    });
    const hits = (round?.hitBeats ?? []).map((hitBeat, index) => {
      const gameTimeMs = prepareDurationMs + Number(hitBeat) * beatDurationMs;
      return {
        index: index + 1,
        movementBeat: hitBeat,
        beatFromSpawn: prepareBeats + Number(hitBeat),
        gameTimeMs,
        automaticRhythmCue: false,
        feedback: round?.resolvedHits?.[index] === 'success' ? 'hit'
          : round?.resolvedHits?.[index] === 'missed' ? 'miss'
            : 'only after actual input or lapse'
      };
    });
    const clockSkewMs = context?.state === 'running' && originAudioTime !== null
      ? (context.currentTime - originAudioTime) * 1000 - latestElapsedMs
      : null;
    const beatInLoop = loopBeats > 0 ? ((bgmBeatPosition % loopBeats) + loopBeats) % loopBeats : 0;

    return {
      active: Boolean(round && RHYTHM_MODES.has(latestState?.mode)),
      mode: latestState?.mode ?? null,
      typeId: round?.typeId ?? null,
      label: round?.label ?? null,
      phase: round?.phase ?? null,
      beatDurationMs,
      prepareDurationMs,
      prepareBeats,
      preparationCues,
      launchTimeFromSpawnMs: prepareDurationMs,
      totalMovementDurationMs: Number(round?.totalBeats || 0) * beatDurationMs,
      endpointTimeFromSpawnMs: prepareDurationMs + Number(round?.totalBeats || 0) * beatDurationMs,
      audioContextState: context?.state ?? 'not-created',
      interrupted,
      rhythmAudioOffsetMs: offsetMs,
      estimatedOutputLatencyMs,
      audioGameClockSkewMs: clockSkewMs,
      bgm: {
        bars: Number(config.bgmBars) || 16,
        beatsPerBar: Number(config.bgmBeatsPerBar) || 4,
        loopBeats,
        beatPosition: bgmBeatPosition,
        barInLoop: Math.floor(beatInLoop / Math.max(1, Number(config.bgmBeatsPerBar) || 4)) + 1,
        bpm: 60000 / Math.max(1, transportBeatDurationMs),
        held: bgmHeld,
        terminal: bgmTerminal
      },
      hits
    };
  }

  return Object.freeze({ sync, unlock, interrupt, recover, reset, getDiagnostics, playInputFeedback });
}
