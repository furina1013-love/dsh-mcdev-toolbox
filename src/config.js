const DEFAULTS = Object.freeze({
  enabled: true,
  maxOutputChars: 12000,
  gradleTimeoutMs: 180000,
  includeSubagents: false,
  includeExistingSessions: false,
  trustedRoots: Object.freeze([]),
  allowClientRuns: false,
  maxRunTimeoutMs: 900000
});

function stringList(value, name) {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > 20) throw new TypeError(name + ' must be an array of at most 20 absolute directory paths');
  return Object.freeze(value.map((item) => {
    if (typeof item !== 'string' || item.trim() === '' || !(item.startsWith('/') || /^[A-Za-z]:[\\/]/.test(item))) {
      throw new TypeError(name + ' entries must be absolute directory paths');
    }
    return item.trim();
  }));
}

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
    includeSubagents: raw.includeSubagents === undefined ? DEFAULTS.includeSubagents : Boolean(raw.includeSubagents),
    includeExistingSessions: raw.includeExistingSessions === undefined ? DEFAULTS.includeExistingSessions : Boolean(raw.includeExistingSessions),
    trustedRoots: stringList(raw.trustedRoots, 'trustedRoots'),
    allowClientRuns: raw.allowClientRuns === undefined ? DEFAULTS.allowClientRuns : Boolean(raw.allowClientRuns),
    maxRunTimeoutMs: positiveInteger(raw.maxRunTimeoutMs, DEFAULTS.maxRunTimeoutMs, 'maxRunTimeoutMs', 5000, 7200000)
  });
}
