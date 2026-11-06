const DEFAULTS = Object.freeze({
  enabled: true,
  maxOutputChars: 12000,
  gradleTimeoutMs: 180000,
  includeSubagents: false
});

function positiveInteger(value, fallback, name, min, max) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(name + ' must be an integer from ' + min + ' to ' + max);
  }
  return value;
}

/** Validate host configuration without adding a runtime dependency. */
export function resolveConfig(raw = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('mcdev-toolbox config must be an object');
  return Object.freeze({
    enabled: raw.enabled === undefined ? DEFAULTS.enabled : Boolean(raw.enabled),
    maxOutputChars: positiveInteger(raw.maxOutputChars, DEFAULTS.maxOutputChars, 'maxOutputChars', 2000, 16000),
    gradleTimeoutMs: positiveInteger(raw.gradleTimeoutMs, DEFAULTS.gradleTimeoutMs, 'gradleTimeoutMs', 5000, 900000),
    includeSubagents: raw.includeSubagents === undefined ? DEFAULTS.includeSubagents : Boolean(raw.includeSubagents)
  });
}
