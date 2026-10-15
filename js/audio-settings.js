import { RHYTHM_AUDIO_CONFIG } from './config.js';

const DEFAULTS = Object.freeze({
  bgmPercent: RHYTHM_AUDIO_CONFIG.defaultBgmVolumePercent,
  sfxPercent: RHYTHM_AUDIO_CONFIG.defaultSfxVolumePercent
});

function normalizePercent(value, fallback) {
  if (typeof value !== 'number' &&
      !(typeof value === 'string' && value.trim() !== '')) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(0, Math.min(100, Math.round(parsed)))
    : fallback;
}

export function normalizeAudioSettings(value = {}) {
  return {
    bgmPercent: normalizePercent(value.bgmPercent, DEFAULTS.bgmPercent),
    sfxPercent: normalizePercent(value.sfxPercent, DEFAULTS.sfxPercent)
  };
}

export function loadAudioSettings() {
  try {
    const raw = globalThis.localStorage?.getItem(RHYTHM_AUDIO_CONFIG.audioSettingsStorageKey);
    if (!raw) return { ...DEFAULTS };
    return normalizeAudioSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveAudioSettings(value) {
  const settings = normalizeAudioSettings(value);
  try {
    globalThis.localStorage?.setItem(
      RHYTHM_AUDIO_CONFIG.audioSettingsStorageKey,
      JSON.stringify(settings)
    );
  } catch { /* Storage can be blocked in private or restricted browsing modes. */ }
  return settings;
}

// A square curve gives useful adjustment range at the quiet end while preserving
// exact silence at 0% and the current calibrated level at 100%.
export function audioPercentToGain(value) {
  const percent = normalizePercent(value, 0);
  return percent === 0 ? 0 : (percent / 100) ** 2;
}
