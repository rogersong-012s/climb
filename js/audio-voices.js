// Local PCM voice models for the game BGM. These are generated once from
// instrument-specific excitation/envelope models; they are not recordings or
// third-party sample assets.
const TAU = Math.PI * 2;
const MODEL_SAMPLE_RATE = 32000;

function midiToFrequency(midi) {
  return 440 * Math.pow(2, (Number(midi) - 69) / 12);
}

function allocate(context, durationSeconds) {
  const sampleRate = Math.min(MODEL_SAMPLE_RATE, context.sampleRate || MODEL_SAMPLE_RATE);
  const frameCount = Math.max(1, Math.ceil(sampleRate * durationSeconds));
  const buffer = context.createBuffer(1, frameCount, sampleRate);
  return { buffer, data: buffer.getChannelData(0), sampleRate };
}

function normalize(data, targetPeak = 0.76) {
  let peak = 0;
  for (let index = 0; index < data.length; index += 1) peak = Math.max(peak, Math.abs(data[index]));
  if (peak < 1e-6) return;
  const scale = targetPeak / peak;
  for (let index = 0; index < data.length; index += 1) data[index] *= scale;
}

function makeNoise(seed) {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 0xffffffff * 2 - 1;
  };
}

function createPluckedVoice(context, {
  baseMidi,
  durationSeconds,
  partials,
  attackSeconds,
  decaySeconds,
  drive = 1,
  inharmonicity = 0,
  vibratoHz = 0,
  vibratoRadians = 0,
  pickNoise = 0,
  targetPeak = 0.76
}) {
  const sample = allocate(context, durationSeconds);
  const fundamental = midiToFrequency(baseMidi);
  const noise = makeNoise(Math.round(fundamental * 1000) ^ 0x6f3a21);
  const partialBank = partials.map((coefficient, index) => {
    const partialNumber = index + 1;
    const stiffness = Math.sqrt(1 + inharmonicity * partialNumber * partialNumber);
    return {
      coefficient,
      phaseRate: TAU * fundamental * partialNumber * stiffness,
      phaseVibrato: partialNumber,
      decay: decaySeconds / Math.pow(partialNumber, 0.36)
    };
  });

  for (let index = 0; index < sample.data.length; index += 1) {
    const time = index / sample.sampleRate;
    const attack = 1 - Math.exp(-time / Math.max(0.001, attackSeconds));
    let wave = 0;
    const vibrato = vibratoHz > 0
      ? Math.sin(TAU * vibratoHz * time) * vibratoRadians * Math.min(1, time / 0.12)
      : 0;
    for (const partial of partialBank) {
      const phase = partial.phaseRate * time + vibrato * partial.phaseVibrato;
      wave += partial.coefficient * Math.sin(phase) * Math.exp(-time / Math.max(0.04, partial.decay));
    }
    if (drive > 1) wave = Math.tanh(wave * drive) / Math.tanh(drive);
    const pick = pickNoise * noise() * Math.exp(-time / 0.012);
    sample.data[index] = attack * (wave + pick);
  }

  normalize(sample.data, targetPeak);
  return sample.buffer;
}

function createBowedVoice(context, { baseMidi, durationSeconds, targetPeak = 0.68 }) {
  const sample = allocate(context, durationSeconds);
  const fundamental = midiToFrequency(baseMidi);
  const partials = [1, 0.7, 0.47, 0.31, 0.2, 0.12];
  const detuneCents = [-4.5, 0, 4.2];
  const partialFrequencies = partials.map((coefficient, index) => ({
    coefficient,
    partialNumber: index + 1,
    frequencies: detuneCents.map((cents) =>
      fundamental * (index + 1) * Math.pow(2, cents / 1200))
  }));

  for (let index = 0; index < sample.data.length; index += 1) {
    const time = index / sample.sampleRate;
    const attack = 1 - Math.exp(-time / 0.16);
    const release = Math.min(1, Math.max(0.08, (durationSeconds - time) / 0.28));
    const vibrato = Math.sin(TAU * 5.1 * time) * 0.004 * Math.min(1, time / 0.35);
    let wave = 0;
    for (const partial of partialFrequencies) {
      let layer = 0;
      for (const frequency of partial.frequencies) {
        layer += Math.sin(TAU * frequency * time + vibrato * partial.partialNumber);
      }
      wave += partial.coefficient * layer / detuneCents.length;
    }
    sample.data[index] = wave * attack * release * 0.42;
  }

  normalize(sample.data, targetPeak);
  return sample.buffer;
}

function createPianoVoice(context, { baseMidi = 60, durationSeconds = 2.1, targetPeak = 0.74 } = {}) {
  const sample = allocate(context, durationSeconds);
  const fundamental = midiToFrequency(baseMidi);
  const noise = makeNoise(0x1a2b3c4d);
  const partials = [1, 0.72, 0.46, 0.31, 0.21, 0.14, 0.09, 0.055];
  const stringDetunes = [-0.12, 0, 0.1];
  const pianoPartials = partials.map((coefficient, index) => {
    const partialNumber = index + 1;
    const inharmonicity = 0.00016 * partialNumber * partialNumber;
    const frequency = fundamental * partialNumber * Math.sqrt(1 + inharmonicity);
    return {
      coefficient,
      frequencies: stringDetunes.map((cents) => frequency * Math.pow(2, cents / 1200)),
      decay: 1.2 / Math.pow(partialNumber, 0.42)
    };
  });

  for (let index = 0; index < sample.data.length; index += 1) {
    const time = index / sample.sampleRate;
    let wave = 0;
    for (const partial of pianoPartials) {
      let stringStack = 0;
      for (const frequency of partial.frequencies) {
        stringStack += Math.sin(TAU * frequency * time);
      }
      wave += partial.coefficient * (stringStack / stringDetunes.length) * Math.exp(-time / partial.decay);
    }
    const hammer = noise() * 0.055 * Math.exp(-time / 0.004);
    sample.data[index] = (wave + hammer) * (1 - Math.exp(-time / 0.0018));
  }

  normalize(sample.data, targetPeak);
  return sample.buffer;
}

function highPassNoise(noise, sampleRate, cutoffHz, state) {
  const input = noise();
  const coefficient = state.coefficient ?? Math.exp(-TAU * cutoffHz / sampleRate);
  state.low = (1 - coefficient) * input + coefficient * state.low;
  return input - state.low;
}

function createDrumVoice(context, kind) {
  const settings = {
    kick: { duration: 0.32, peak: 0.86 },
    snare: { duration: 0.24, peak: 0.78 },
    hatClosed: { duration: 0.075, peak: 0.58 },
    hatOpen: { duration: 0.34, peak: 0.64 },
    crash: { duration: 0.82, peak: 0.72 },
    tomHigh: { duration: 0.26, peak: 0.72 },
    tomLow: { duration: 0.34, peak: 0.72 }
  }[kind];
  const sample = allocate(context, settings.duration);
  const noise = makeNoise(0x47e19a2d ^ kind.length * 9127);
  const highPassCutoff = {
    kick: 1700, snare: 1050, hatClosed: 6200, hatOpen: 6200,
    crash: 4300, tomHigh: 950, tomLow: 950
  }[kind];
  const filterState = {
    low: 0,
    coefficient: Math.exp(-TAU * highPassCutoff / sample.sampleRate)
  };

  for (let index = 0; index < sample.data.length; index += 1) {
    const time = index / sample.sampleRate;
    let value = 0;
    if (kind === 'kick') {
      const phase = TAU * (42 * time + 88 * 0.047 * (1 - Math.exp(-time / 0.047)));
      const body = Math.sin(phase) * Math.exp(-time / 0.17);
      const click = highPassNoise(noise, sample.sampleRate, 1700, filterState) * Math.exp(-time / 0.006);
      value = body * 0.92 + click * 0.2;
    } else if (kind === 'snare') {
      const wire = highPassNoise(noise, sample.sampleRate, 1050, filterState);
      const shell = Math.sin(TAU * 185 * time) * Math.exp(-time / 0.075);
      value = wire * Math.exp(-time / 0.095) * 0.72 + shell * 0.34;
    } else if (kind === 'hatClosed' || kind === 'hatOpen') {
      const wire = highPassNoise(noise, sample.sampleRate, 6200, filterState);
      const decay = kind === 'hatClosed' ? 0.024 : 0.19;
      const metal = Math.sin(TAU * 7110 * time) * 0.18 + Math.sin(TAU * 9430 * time) * 0.1;
      value = (wire * 0.82 + metal) * Math.exp(-time / decay);
    } else if (kind === 'crash') {
      const wire = highPassNoise(noise, sample.sampleRate, 4300, filterState);
      const metal = Math.sin(TAU * 5380 * time) * 0.22 +
        Math.sin(TAU * 6920 * time) * 0.17 + Math.sin(TAU * 8760 * time) * 0.12;
      value = (wire * 0.82 + metal) * Math.exp(-time / 0.42);
    } else {
      const startFrequency = kind === 'tomHigh' ? 195 : 130;
      const endFrequency = kind === 'tomHigh' ? 105 : 67;
      const glideSeconds = kind === 'tomHigh' ? 0.09 : 0.13;
      const phase = TAU * (endFrequency * time + (startFrequency - endFrequency) * glideSeconds *
        (1 - Math.exp(-time / glideSeconds)));
      const body = Math.sin(phase) * Math.exp(-time / 0.19);
      const attack = highPassNoise(noise, sample.sampleRate, 950, filterState) * Math.exp(-time / 0.012);
      value = body * 0.9 + attack * 0.12;
    }
    sample.data[index] = value;
  }

  normalize(sample.data, settings.peak);
  return sample.buffer;
}

export function createInstrumentSampleBank(context) {
  return Object.freeze({
    rhythmGuitar: Object.freeze({
      baseMidi: 60,
      buffer: createPluckedVoice(context, {
        baseMidi: 60,
        durationSeconds: 0.42,
        partials: [1, 0.82, 0.65, 0.48, 0.34, 0.25, 0.17, 0.11],
        attackSeconds: 0.0025,
        decaySeconds: 0.18,
        drive: 3.4,
        pickNoise: 0.13,
        targetPeak: 0.74
      })
    }),
    leadGuitar: Object.freeze({
      baseMidi: 72,
      buffer: createPluckedVoice(context, {
        baseMidi: 72,
        durationSeconds: 1.7,
        partials: [1, 0.68, 0.5, 0.34, 0.25, 0.17, 0.11, 0.075],
        attackSeconds: 0.008,
        decaySeconds: 0.86,
        drive: 2.05,
        vibratoHz: 5.4,
        vibratoRadians: 0.025,
        pickNoise: 0.065,
        targetPeak: 0.72
      })
    }),
    bass: Object.freeze({
      baseMidi: 45,
      buffer: createPluckedVoice(context, {
        baseMidi: 45,
        durationSeconds: 1.25,
        partials: [1, 0.62, 0.35, 0.2, 0.12, 0.065],
        attackSeconds: 0.004,
        decaySeconds: 0.72,
        drive: 1.3,
        pickNoise: 0.035,
        targetPeak: 0.78
      })
    }),
    piano: Object.freeze({
      baseMidi: 60,
      buffer: createPianoVoice(context)
    }),
    strings: Object.freeze({
      baseMidi: 60,
      buffer: createBowedVoice(context, { baseMidi: 60, durationSeconds: 2.15 })
    }),
    brass: Object.freeze({
      baseMidi: 60,
      buffer: createPluckedVoice(context, {
        baseMidi: 60,
        durationSeconds: 1.1,
        partials: [1, 0.8, 0.65, 0.5, 0.35, 0.22, 0.13],
        attackSeconds: 0.045,
        decaySeconds: 0.72,
        drive: 1.08,
        pickNoise: 0.018,
        targetPeak: 0.7
      })
    }),
    kick: Object.freeze({ buffer: createDrumVoice(context, 'kick') }),
    snare: Object.freeze({ buffer: createDrumVoice(context, 'snare') }),
    hatClosed: Object.freeze({ buffer: createDrumVoice(context, 'hatClosed') }),
    hatOpen: Object.freeze({ buffer: createDrumVoice(context, 'hatOpen') }),
    crash: Object.freeze({ buffer: createDrumVoice(context, 'crash') }),
    tomHigh: Object.freeze({ buffer: createDrumVoice(context, 'tomHigh') }),
    tomLow: Object.freeze({ buffer: createDrumVoice(context, 'tomLow') })
  });
}
