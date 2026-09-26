import {
  QUALITY_PRESETS, qualityName as sharedQualityName, frameRate as sharedFrameRate, renderScale,
} from '../../shared/render-policy.js';

export const QUALITY_STORAGE_KEY = 'habitat-riverscape-quality';
export const ULTRA_PIXELS = 3840 * 2160;
export const qualityName = value => value === 'ultra' ? 'ultra' : sharedQualityName(value);
export function frameRate(profile, requested = 60, onBattery = false) {
  if (profile !== 'ultra') return sharedFrameRate(profile, requested, onBattery);
  if (!Number.isFinite(requested) || requested <= 0) return 0;
  return Math.min(requested, onBattery ? 20 : 30);
}
// Rendering budgets, kept separate from animation and habitat behaviour. The reference
// profile reproduces the uploaded rendering/density settings for local A/B checks.
export const PROFILES = Object.freeze({
  balanced: Object.freeze({
    name: 'balanced',
    shadowSize: 2048,
    // Every frame: at 20-30 fps a slower shadow refresh makes moving shadows step visibly.
    shadowHz: Infinity,
    batteryShadowHz: Infinity,
    aoSamples: 8,
    backgroundDensity: 0.7,
    backgroundRows: 20,
    backgroundCols: 2,
    powerPreference: 'low-power',
  }),
  reference: Object.freeze({
    name: 'reference',
    shadowSize: 4096,
    shadowHz: Infinity,
    batteryShadowHz: Infinity,
    aoSamples: 12,
    backgroundDensity: 1,
    backgroundRows: 30,
    backgroundCols: 6,
    powerPreference: 'high-performance',
  }),
});

export function renderSettings({
  profile = 'balanced', wallpaper = false, pixelRatio = 1, onBattery = false,
} = {}) {
  const budget = PROFILES[profile] || PROFILES.balanced;
  const ultra = profile === 'ultra';
  const dpr = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  const referenceResolution = wallpaper ? Math.min(2, Math.max(1.5, dpr)) : 1.5;
  return {
    ...budget,
    name: ultra ? 'ultra' : budget.name,
    // Supersample ordinary displays too: a 1080p desktop gets a 2880 × 1620
    // image downsampled to its screen. Retina uses its native density, never DPR².
    resolution: budget.name === 'reference' ? referenceResolution : ultra && !onBattery ?
      Math.max(1.5, dpr) : renderScale(ultra ? 'balanced' : profile, pixelRatio, onBattery),
    maxPixels: budget.name === 'reference' ? Infinity : ultra && !onBattery ?
      ULTRA_PIXELS : QUALITY_PRESETS[sharedQualityName(profile)].pixels,
    referenceResolution,
    shadowSize: ultra && !onBattery ? 4096 : budget.shadowSize,
    aoSamples: ultra && !onBattery ? 12 : budget.aoSamples,
    clarity: ultra && !onBattery ? 0.12 : 0,
    shadowHz: onBattery ? budget.batteryShadowHz : budget.shadowHz,
    // The leaf shader uses quarter-sample coverage for translucent tissue. Keep 4x
    // MSAA and the HDR format: changing either would be a much larger visual change.
    samples: 4,
  };
}

export { framebufferSize } from '../../shared/render-policy.js';
