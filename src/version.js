const TABLE = [
  { min: [1, 21, 4], java: 21, singular: true, itemDefinitions: true, resultKey: 'id', ingredientStyle: 'string', neoforgeMeta: 'neoforge.mods.toml', resourcePack: 46, dataPack: 61 },
  { min: [1, 21, 2], java: 21, singular: true, itemDefinitions: false, resultKey: 'id', ingredientStyle: 'string', neoforgeMeta: 'neoforge.mods.toml', resourcePack: 42, dataPack: 57 },
  { min: [1, 21, 0], java: 21, singular: true, itemDefinitions: false, resultKey: 'id', ingredientStyle: 'string', neoforgeMeta: 'neoforge.mods.toml', resourcePack: 34, dataPack: 48 },
  { min: [1, 20, 5], java: 21, singular: false, itemDefinitions: false, resultKey: 'id', ingredientStyle: 'string', neoforgeMeta: 'neoforge.mods.toml', resourcePack: 32, dataPack: 41 },
  { min: [1, 20, 2], java: 17, singular: false, itemDefinitions: false, resultKey: 'item', ingredientStyle: 'object', neoforgeMeta: 'mods.toml', resourcePack: 18, dataPack: 18 },
  { min: [1, 20, 0], java: 17, singular: false, itemDefinitions: false, resultKey: 'item', ingredientStyle: 'object', neoforgeMeta: null, resourcePack: 15, dataPack: 15 },
  { min: [1, 19, 4], java: 17, singular: false, itemDefinitions: false, resultKey: 'item', ingredientStyle: 'object', neoforgeMeta: null, resourcePack: 13, dataPack: 13 },
  { min: [1, 19, 3], java: 17, singular: false, itemDefinitions: false, resultKey: 'item', ingredientStyle: 'object', neoforgeMeta: null, resourcePack: 12, dataPack: 12 },
  { min: [1, 19, 0], java: 17, singular: false, itemDefinitions: false, resultKey: 'item', ingredientStyle: 'object', neoforgeMeta: null, resourcePack: 9, dataPack: 10 },
  { min: [1, 18, 0], java: 17, singular: false, itemDefinitions: false, resultKey: 'item', ingredientStyle: 'object', neoforgeMeta: null, resourcePack: 8, dataPack: 9 },
  { min: [1, 17, 0], java: 16, singular: false, itemDefinitions: false, resultKey: 'item', ingredientStyle: 'object', neoforgeMeta: null, resourcePack: 7, dataPack: 7 },
  { min: [1, 16, 2], java: 8, singular: false, itemDefinitions: false, resultKey: 'item', ingredientStyle: 'object', neoforgeMeta: null, resourcePack: 6, dataPack: 6 },
  { min: [1, 16, 0], java: 8, singular: false, itemDefinitions: false, resultKey: 'item', ingredientStyle: 'object', neoforgeMeta: null, resourcePack: 5, dataPack: 5 },
  { min: [1, 15, 0], java: 8, singular: false, itemDefinitions: false, resultKey: 'item', ingredientStyle: 'object', neoforgeMeta: null, resourcePack: 5, dataPack: 5 },
  { min: [1, 13, 0], java: 8, singular: false, itemDefinitions: false, resultKey: 'item', ingredientStyle: 'object', neoforgeMeta: null, resourcePack: 4, dataPack: 4 },
  { min: [1, 12, 0], java: 8, singular: false, itemDefinitions: false, resultKey: 'item', ingredientStyle: 'object', neoforgeMeta: null, resourcePack: 3, dataPack: 3 },
  { min: [1, 11, 0], java: 8, singular: false, itemDefinitions: false, resultKey: 'item', ingredientStyle: 'object', neoforgeMeta: null, resourcePack: 3, dataPack: 3 },
  { min: [1, 9, 0], java: 8, singular: false, itemDefinitions: false, resultKey: 'item', ingredientStyle: 'object', neoforgeMeta: null, resourcePack: 2, dataPack: 2 },
  { min: [1, 7, 10], java: 8, singular: false, itemDefinitions: false, resultKey: 'item', ingredientStyle: 'object', neoforgeMeta: null, resourcePack: 1, dataPack: 1 },
  { min: [1, 7, 2], java: 8, singular: false, itemDefinitions: false, resultKey: 'item', ingredientStyle: 'object', neoforgeMeta: null, resourcePack: 1, dataPack: 1 }
];

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)(?:[.-](\d+))?/.exec(String(value ?? '').trim());
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

function atLeast(current, wanted) {
  for (let index = 0; index < 3; index += 1) {
    if (current[index] !== wanted[index]) return current[index] > wanted[index];
  }
  return true;
}

/** Newest supported Minecraft version encoded in the table. */
const NEWEST = TABLE[0].min;
/** Oldest supported Minecraft version encoded in the table. */
const OLDEST = TABLE[TABLE.length - 1].min;

function compare(current, other) {
  for (let index = 0; index < 3; index += 1) {
    if (current[index] !== other[index]) return current[index] - other[index];
  }
  return 0;
}

const SUPPORTED_RANGE = OLDEST[0] + '.' + OLDEST[1] + ' to ' + NEWEST.join('.');

/**
 * Pack formats verified after the newest table row. Values are only used when a
 * Minecraft version is named here explicitly; anything else newer than NEWEST is
 * reported as unknown so no guess reaches generated files.
 */
const VERIFIED_PACK_FORMATS = Object.freeze({
  '1.21.5': { resourcePack: 55, dataPack: 71 },
  '1.21.6': { resourcePack: 63, dataPack: 80 },
  '1.21.7': { resourcePack: 64, dataPack: 81 },
  '1.21.8': { resourcePack: 64, dataPack: 81 }
});

/**
 * Version-specific conventions shared by all tools.
 *
 * A version newer than the newest table row keeps the heuristic conventions of
 * that row but is reported as `known: false` with `newer: true`, because pack
 * formats and item definition rules change with most Minecraft releases and the
 * guess must never be presented as fact. Versions below the oldest row, or
 * outside 1.x, keep conservative fallbacks and are reported as unsupported.
 */
export function versionProfile(minecraftVersion) {
  const current = parseVersion(minecraftVersion);
  if (current === undefined) {
    return {
      parsed: false,
      known: false,
      newer: false,
      supported: false,
      range: SUPPORTED_RANGE,
      java: undefined,
      dataDirStyle: 'plural',
      itemDefinitions: false,
      resultKey: 'item',
      ingredientStyle: 'object',
      neoforgeMeta: undefined,
      resourcePack: undefined,
      dataPack: undefined
    };
  }
  const row = TABLE.find((entry) => atLeast(current, entry.min));
  const newer = current[0] === 1 && compare(current, NEWEST) > 0;
  const verified = newer ? VERIFIED_PACK_FORMATS[String(minecraftVersion).trim()] : undefined;
  const normalized = row === undefined
    ? {
      java: current[1] >= 18 ? 17 : 8,
      dataDirStyle: 'plural',
      itemDefinitions: false,
      resultKey: 'item',
      ingredientStyle: 'object',
      neoforgeMeta: undefined,
      resourcePack: undefined,
      dataPack: undefined
    }
    : {
      java: row.java,
      dataDirStyle: row.singular ? 'singular' : 'plural',
      itemDefinitions: row.itemDefinitions,
      resultKey: row.resultKey,
      ingredientStyle: row.ingredientStyle,
      neoforgeMeta: row.neoforgeMeta ?? undefined,
      resourcePack: row.resourcePack,
      dataPack: row.dataPack
    };
  const supported = current[0] === 1 && compare(current, OLDEST) >= 0;
  const profile = { ...normalized, parsed: true, known: supported && !newer, newer, supported, range: SUPPORTED_RANGE };
  if (newer) {
    // Never hand out a guessed pack format: newer releases renumber them and a
    // wrong number makes the generated resource or data pack silently invalid.
    profile.resourcePack = verified?.resourcePack;
    profile.dataPack = verified?.dataPack;
    profile.packFormatVerified = verified !== undefined;
  }
  return profile;
}

/**
 * Explain why a profile is not known, for tool output and warnings.
 * @returns a human-readable sentence, or undefined when the version is known.
 */
export function versionCaveat(profile) {
  if (profile.known) return undefined;
  if (profile.newer) {
    if (profile.packFormatVerified === true) {
      return 'Minecraft version is newer than this build supports (' + profile.range + '); pack formats come from the verified list, other conventions are guessed — verify item definition rules.';
    }
    return 'Minecraft version is newer than this build supports (' + profile.range + '); pack_format is unknown for this release, so no pack.mcmeta format is generated and item definition rules are guessed — check minecraft.wiki/w/Pack_format.';
  }
  if (profile.parsed !== false) {
    return 'Minecraft version is outside the supported range (' + profile.range + '); generated conventions are conservative fallbacks.';
  }
  return 'Minecraft version could not be parsed; generated conventions are conservative fallbacks.';
}

export { parseVersion, atLeast };
