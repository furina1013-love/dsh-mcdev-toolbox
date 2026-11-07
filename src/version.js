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
  { min: [1, 16, 0], java: 8, singular: false, itemDefinitions: false, resultKey: 'item', ingredientStyle: 'object', neoforgeMeta: null, resourcePack: 5, dataPack: 5 }
];

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(value ?? ''));
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

function atLeast(current, wanted) {
  for (let index = 0; index < 3; index += 1) {
    if (current[index] !== wanted[index]) return current[index] > wanted[index];
  }
  return true;
}

/** Version-specific conventions shared by all tools. Unknown versions fall back to the nearest lower profile. */
export function versionProfile(minecraftVersion) {
  const current = parseVersion(minecraftVersion);
  if (current === undefined) return { known: false, java: undefined, dataDirStyle: 'plural', itemDefinitions: false, resultKey: 'item', ingredientStyle: 'object', neoforgeMeta: undefined, resourcePack: undefined, dataPack: undefined };
  if (current[0] !== 1) return { known: false, java: 21, dataDirStyle: 'singular', itemDefinitions: true, resultKey: 'id', ingredientStyle: 'string', neoforgeMeta: 'neoforge.mods.toml', resourcePack: undefined, dataPack: undefined };
  const match = TABLE.find((entry) => atLeast(current, entry.min));
  if (match === undefined) return { known: false, java: current[1] >= 1 && current[2] >= 18 ? 17 : 8, dataDirStyle: 'plural', itemDefinitions: false, resultKey: 'item', ingredientStyle: 'object', neoforgeMeta: undefined, resourcePack: undefined, dataPack: undefined };
  return {
    known: true,
    java: match.java,
    dataDirStyle: match.singular ? 'singular' : 'plural',
    itemDefinitions: match.itemDefinitions,
    resultKey: match.resultKey,
    ingredientStyle: match.ingredientStyle,
    neoforgeMeta: match.neoforgeMeta,
    resourcePack: match.resourcePack,
    dataPack: match.dataPack
  };
}

export { parseVersion, atLeast };
