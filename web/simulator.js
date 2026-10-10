export const STATE_COUNT = 32;
export const CHANNEL_COUNT = 32;
export const STATE_TO_CHANNEL = Object.freeze(Array.from({ length: 32 }, (_, index) => index));
export const ALPHA = 0.18;
export const BACKGROUND_FORCE = 0.002;
export const MEASUREMENT_NOISE = 0.003;
export const DEFAULT_STEPS = 160;
export const THRESHOLDS = Object.freeze({ peak: 0.055, antipodal: 0.045, fold8: 0.045, baselineRms: 0.025 });
const U32 = 0xffffffff;

export function hashSeed(value) {
  const bytes = new TextEncoder().encode(String(value));
  let h = 2166136261;
  for (const byte of bytes) h = Math.imul(h ^ byte, 16777619) >>> 0;
  return h || 0xa341316c;
}

export class XorShift32 {
  constructor(seed) {
    const state = seed >>> 0;
    this.state = state || 0xa341316c;
  }
  random() {
    let x = this.state >>> 0;
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    this.state = x;
    return x / 4294967296;
  }
}

function vector(values, label) {
  if (!Array.isArray(values) || values.length !== CHANNEL_COUNT) {
    throw new RangeError(`${label} must contain exactly ${CHANNEL_COUNT} values`);
  }
  if (!values.every(Number.isFinite)) throw new TypeError(`${label} values must all be finite`);
  return values;
}

export function edgeGradient(state) {
  const x = vector(state, "state");
  return x.map((value, index) => x[(index + 1) % STATE_COUNT] - value);
}

export function vertexLaplacian(state) {
  const x = vector(state, "state");
  const grad = edgeGradient(x);
  return x.map((_, index) => grad[(index + STATE_COUNT - 1) % STATE_COUNT] - grad[index]);
}

export function cascadeStep(state, drive = Array(STATE_COUNT).fill(0), alpha = ALPHA) {
  const x = vector(state, "state");
  const u = vector(drive, "drive");
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha > 0.25) {
    throw new RangeError("alpha must be finite and in (0, 0.25]");
  }
  const grad = edgeGradient(x);
  return x.map((value, index) => value - alpha * (grad[(index + STATE_COUNT - 1) % STATE_COUNT] - grad[index]) + u[index]);
}

function trace(forcing, onset, channel, strength) {
  let state = Array(STATE_COUNT).fill(0);
  const frames = [state.slice()];
  forcing.forEach((drive, index) => {
    const step = index + 1;
    const updated = cascadeStep(state, drive);
    if (step === onset) {
      for (const [offset, weight] of [[0, 1], [-1, 0.46], [1, 0.46], [-2, 0.16], [2, 0.16]]) {
        const target = (channel + offset + STATE_COUNT) % STATE_COUNT;
        updated[target] += strength * weight;
      }
    }
    state = updated;
    frames.push(state.slice());
  });
  return frames;
}

function measurement(frames, seed, salt) {
  const rng = new XorShift32(seed ^ salt);
  return frames.map((frame) => frame.map((value) => value + (2 * rng.random() - 1) * MEASUREMENT_NOISE));
}

export function simulatePair(seed, options = {}) {
  const steps = options.steps ?? DEFAULT_STEPS;
  if (!Number.isInteger(steps) || steps < 40) throw new RangeError("steps must be an integer of at least 40");
  const text = String(seed);
  const base = hashSeed(text);
  const params = new XorShift32(base ^ 0x2c1b3c6d);
  const low = Math.max(20, Math.floor(steps / 4));
  const high = Math.min(steps - 20, Math.floor((3 * steps) / 4));
  const eventOnset = options.eventOnset ?? (low + Math.floor(params.random() * (high - low + 1)));
  const eventChannel = options.eventChannel ?? Math.floor(params.random() * STATE_COUNT);
  const eventStrength = options.eventStrength ?? (0.10 + 0.18 * params.random());
  if (!Number.isInteger(eventOnset) || eventOnset < 1 || eventOnset > steps) throw new RangeError("eventOnset must be an integer within the simulated steps");
  if (!Number.isInteger(eventChannel) || eventChannel < 0 || eventChannel >= STATE_COUNT) throw new RangeError("eventChannel must be in [0, 31]");
  if (!Number.isFinite(eventStrength) || eventStrength <= 0) throw new RangeError("eventStrength must be finite and positive");

  const forcingRng = new XorShift32(base ^ 0x7f4a7c15);
  const forcing = Array.from({ length: steps }, () => Array.from({ length: STATE_COUNT }, () => (2 * forcingRng.random() - 1) * BACKGROUND_FORCE));
  const cleanTrace = trace(forcing, null, eventChannel, 0);
  const disturbedTrace = trace(forcing, eventOnset, eventChannel, eventStrength);
  const cleanObservation = measurement(cleanTrace, base, 0x1987a2b1);
  const reference = measurement(cleanTrace, base, 0x41c64e6d);
  const disturbedObservation = measurement(disturbedTrace, base, 0x6d2b79f5);
  const sideRng = new XorShift32(base ^ 0x3c6ef372);
  const disturbedSide = sideRng.random() < 0.5 ? "A" : "B";
  return { seed: text, cleanTrace, disturbedTrace, cleanObservation, reference, disturbedObservation, eventOnset, eventChannel, eventStrength, disturbedSide };
}

export function frameMetrics(observation, reference) {
  const observed = vector(observation, "observation");
  const clean = vector(reference, "reference");
  const residual = observed.map((value, index) => value - clean[index]);
  const peakResidual = Math.max(...residual.map(Math.abs));
  let antipodalResidual = 0;
  let fold8Residual = 0;
  for (let index = 0; index < 16; index++) antipodalResidual = Math.max(antipodalResidual, Math.abs(residual[index] - residual[index + 16]));
  for (let ring = 0; ring < 4; ring++) {
    for (let node = 0; node < 8; node++) {
      const left = 8 * ring + node;
      const right = 8 * ring + ((node + 1) % 8);
      fold8Residual = Math.max(fold8Residual, Math.abs(residual[left] - residual[right]));
    }
  }
  return {
    peakResidual,
    antipodalResidual,
    fold8Residual,
    alarm: peakResidual > THRESHOLDS.peak || antipodalResidual > THRESHOLDS.antipodal || fold8Residual > THRESHOLDS.fold8,
  };
}

export function rmsResidual(observation, reference) {
  const observed = vector(observation, "observation");
  const clean = vector(reference, "reference");
  return Math.sqrt(observed.reduce((sum, value, index) => sum + (value - clean[index]) ** 2, 0) / CHANNEL_COUNT);
}

export function firstAlert(traceFrames, referenceFrames, start, baseline = false) {
  if (traceFrames.length !== referenceFrames.length) throw new RangeError("trace and reference must have equal time lengths");
  for (let step = start; step < traceFrames.length; step++) {
    const flagged = baseline
      ? rmsResidual(traceFrames[step], referenceFrames[step]) > THRESHOLDS.baselineRms
      : frameMetrics(traceFrames[step], referenceFrames[step]).alarm;
    if (flagged) return step;
  }
  return null;
}
