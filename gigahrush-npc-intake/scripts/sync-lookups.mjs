import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const gameRoot = path.resolve(projectRoot, '..');
const checkOnly = process.argv.includes('--check');

function readGame(rel) {
  return readFileSync(path.join(gameRoot, rel), 'utf8');
}

function listTsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function enumEntries(source, enumName) {
  const match = source.match(new RegExp(`export\\s+enum\\s+${enumName}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match) return [];
  let nextValue = 0;
  return match[1].split('\n')
    .map(line => {
      const item = line.match(/^\s*([A-Z0-9_]+)\s*(?:=\s*([-0-9]+))?\s*,?\s*(?:(?:\/\/)\s*(.*))?$/);
      if (!item) return undefined;
      const id = item[1].toLowerCase();
      const value = item[2] === undefined ? nextValue : Number(item[2]);
      nextValue = value + 1;
      const label = (item[3] ?? id).split(/[—-]/)[0].trim();
      return { id, name: item[1], value, label: label || id };
    })
    .filter(Boolean);
}

function quotedIds(source, regex) {
  const ids = new Set();
  for (const match of source.matchAll(regex)) ids.add(match[1]);
  return [...ids].sort((a, b) => a.localeCompare(b));
}

function numberConstant(source, name) {
  const match = source.match(new RegExp(`export\\s+const\\s+${name}\\s*=\\s*(-?\\d+)`));
  return match ? Number(match[1]) : undefined;
}

function numberExpression(source, expression) {
  const text = String(expression ?? '').trim();
  const direct = Number(text);
  if (Number.isFinite(direct)) return direct;
  return numberConstant(source, text);
}

function sourceIndexForPackageIds(ids) {
  const npcPackageDir = path.join(gameRoot, 'src/data/npc_packages');
  const files = [...new Set([
    path.join(gameRoot, 'src/data/npc_plot_packages.ts'),
    path.join(gameRoot, 'src/data/npc_packages.ts'),
    ...listTsFiles(npcPackageDir),
    ...listTsFiles(path.join(gameRoot, 'src/gen')),
  ])];
  const out = new Map();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const rel = path.relative(gameRoot, file);
    for (const id of ids) {
      if (out.has(id)) continue;
      let at = source.indexOf(`'${id}'`);
      if (at < 0) at = source.indexOf(`"${id}"`);
      if (at < 0) continue;
      out.set(id, {
        sourceFile: rel,
        sourceLine: source.slice(0, at).split('\n').length,
      });
    }
  }
  return out;
}

function npcPackageLookupsFromGameRegistry() {
  const bridge = `
const modules = [
  './src/gen/design_floors/manifest.ts',
  './src/gen/living/side_quests.ts',
  './src/gen/ministry/content_manifest.ts',
  './src/gen/kvartiry/content_manifest.ts',
  './src/gen/maintenance/content_manifest.ts',
  './src/gen/hell/content_manifest.ts',
  './src/gen/void/content_manifest.ts',
];
for (const spec of modules) await import(spec);
const packages = await import('./src/data/npc_packages.ts');
const core = await import('./src/core/types.ts');
const proceduralVisuals = await import('./src/entities/procedural_visuals.ts');
const spriteSheet = await import('./src/render/sprites.ts');
const gameSprites = spriteSheet.generateSprites();
const enumId = (obj, value) => String(obj[value] ?? value).toLowerCase();
const packedPixels = pixels => pixels ? Array.from(pixels, pixel => pixel >>> 0) : undefined;
const visualPreview = pack => {
  if (!pack.visual?.npcVisualId) return undefined;
  const pixels = proceduralVisuals.generateNpcProfileSprite(
    pack.visual.spriteSeed ?? 1,
    pack.affiliation?.occupation,
    pack.affiliation?.faction,
    pack.demographics?.sex === 'female',
    pack.visual.sprite,
    pack.visual.npcVisualId,
  );
  return packedPixels(pixels);
};
const summaries = packages.allNpcPackages().map(pack => ({
  id: pack.id,
  kind: pack.kind,
  displayName: packages.npcPackageDisplayName(pack),
  publicLine: pack.bio?.publicLine ?? '',
  sex: pack.demographics?.sex ?? '',
  age: pack.demographics?.age ?? 0,
  faction: enumId(core.Faction, pack.affiliation?.faction),
  occupation: enumId(core.Occupation, pack.affiliation?.occupation),
  roleId: pack.affiliation?.roleId ?? '',
  homeFloorKey: pack.placement?.homeFloorKey ?? '',
  presence: pack.placement?.presence ?? '',
  mobility: pack.placement?.mobility ?? '',
  sprite: pack.visual?.sprite ?? '',
  npcVisualId: pack.visual?.npcVisualId ?? '',
  spriteSeed: pack.visual?.spriteSeed ?? 1,
  portraitHint: pack.visual?.portraitHint ?? '',
  visualPreviewSize: 64,
  visualPreview: visualPreview(pack),
  talkLines: (pack.speech?.talkLines ?? []).slice(0, 6),
  talkLinesPost: (pack.speech?.talkLinesPost ?? []).slice(0, 4),
  voiceTags: (pack.speech?.voiceTags ?? []).slice(0, 6),
  questIds: (pack.content?.questIds ?? []).slice(0, 12),
  source: 'game',
}));
const usedSprites = [...new Set(summaries
  .map(pack => pack.sprite)
  .filter(sprite => Number.isInteger(sprite) && gameSprites[sprite]))]
  .sort((a, b) => a - b);
const spritePreviews = Object.fromEntries(usedSprites.map(sprite => [sprite, packedPixels(gameSprites[sprite])]));
process.stdout.write(JSON.stringify({ summaries, spritePreviews }));
`;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', bridge], {
    cwd: gameRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr || result.stdout || `status ${result.status}`;
    throw new Error(`failed to build NPC package summaries from game registry: ${detail}`);
  }
  const payload = JSON.parse(result.stdout || '{"summaries":[]}');
  const summaries = payload.summaries ?? [];
  const sourceIndex = sourceIndexForPackageIds(summaries.map(pack => pack.id));
  const sourceLess = summaries
    .filter(pack => !sourceIndex.has(pack.id))
    .map(pack => pack.id)
    .sort((a, b) => a.localeCompare(b));
  if (sourceLess.length > 0) {
    throw new Error(`NPC package summaries missing source locations: ${sourceLess.join(', ')}`);
  }
  return {
    spritePreviews: payload.spritePreviews ?? {},
    summaries: summaries
    .map(pack => ({
      ...pack,
      ...sourceIndex.get(pack.id),
    }))
    .sort((a, b) => {
      const kindOrder = { plot: 0, design: 1, procedural: 2 };
      return (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9) ||
        String(a.homeFloorKey).localeCompare(String(b.homeFloorKey)) ||
        String(a.displayName).localeCompare(String(b.displayName));
    }),
  };
}

function zLabel(z) {
  return `z${z >= 0 ? '+' : ''}${z}`;
}

function floorOption(id, z, title, group) {
  return { id, z, group, label: `${zLabel(z)} - ${title} (${id})` };
}

function storyRouteDefsFromSource(coreSource, proceduralSource) {
  const titles = new Map([
    ['ministry', 'Министерство'],
    ['kvartiry', 'Квартиры'],
    ['living', 'Жилая зона'],
    ['maintenance', 'Коллекторы'],
    ['hell', 'Ад'],
    ['void', 'Пустота'],
  ]);
  const storyEntries = enumEntries(coreSource, 'FloorLevel');
  const block = proceduralSource.match(/const\s+STORY_Z_BY_FLOOR[\s\S]*?\{([\s\S]*?)\};/)?.[1] ?? '';
  const out = [];
  for (const match of block.matchAll(/\[FloorLevel\.([A-Z0-9_]+)\]\s*:\s*([^,\n]+)/g)) {
    const id = match[1].toLowerCase();
    if (!storyEntries.some(entry => entry.id === id)) continue;
    const z = numberExpression(proceduralSource, match[2]);
    if (z === undefined) continue;
    out.push({ id, z, title: titles.get(id) ?? id });
  }
  return out.sort((a, b) => b.z - a.z || a.id.localeCompare(b.id));
}

const core = readGame('src/core/types.ts');
const designFloors = readGame('src/data/design_floors.ts');
const proceduralFloors = readGame('src/data/procedural_floors.ts');
const items = readGame('src/data/items.ts');
const visuals = readGame('src/entities/npc_visuals.ts');
const demosSocial = readGame('src/data/demos_social.ts');
const demosPosts = readGame('src/data/demos_posts.ts');
const demosTraits = readGame('src/data/demos_traits.ts');

const itemBlock = items.slice(items.indexOf('export const ITEMS'));
const itemIds = quotedIds(itemBlock, /\bid\s*:\s*['"]([a-zA-Z0-9_:.-]+)['"]/g);
const itemSlots = {};
for (const match of itemBlock.matchAll(/[a-zA-Z0-9_]+\s*:\s*\{[^{}]*?\bid\s*:\s*['"]([a-zA-Z0-9_:.-]+)['"][^{}]*?\btype\s*:\s*ItemType\.([A-Z]+)/g)) {
  itemSlots[match[1]] = match[2] === 'WEAPON' ? 'weapon' : match[2] === 'TOOL' ? 'tool' : null;
}
const storyRouteDefs = storyRouteDefsFromSource(core, proceduralFloors);
const storyFloorKeys = storyRouteDefs.map(def => `story:${def.id}`);
const storyZ = new Set(storyRouteDefs.map(def => def.z));
const designRouteDefs = [...designFloors.matchAll(/\{\s*id:\s*'([a-z0-9_]+)'\s*,\s*z:\s*(-?\d+)\s*,\s*displayName:\s*'([^']+)'/g)]
  .map(match => ({ id: match[1], z: Number(match[2]), title: match[3] }))
  .sort((a, b) => b.z - a.z || a.id.localeCompare(b.id));
const designFloorKeys = designRouteDefs.map(def => `design:${def.id}`);
const designZ = new Set(designRouteDefs.map(def => def.z));
const proceduralFloorKeys = [];
const minZ = numberConstant(proceduralFloors, 'FLOOR_RUN_MIN_Z') ?? -50;
const maxZ = numberConstant(proceduralFloors, 'FLOOR_RUN_MAX_Z') ?? 50;
for (let z = minZ; z <= maxZ; z++) {
  if (!storyZ.has(z) && !designZ.has(z)) proceduralFloorKeys.push(`procedural:z${z}`);
}
const fixedFloorOptions = [
  ...storyRouteDefs.map(def => floorOption(`story:${def.id}`, def.z, def.title, 'route')),
  ...designRouteDefs.map(def => floorOption(`design:${def.id}`, def.z, def.title, 'route')),
].sort((a, b) => b.z - a.z || a.id.localeCompare(b.id));
const proceduralFloorOptions = proceduralFloorKeys
  .map(key => {
    const z = Number(key.match(/z(-?\d+)$/)?.[1] ?? 0);
    return floorOption(key, z, 'процедурный этаж', 'procedural');
  })
  .sort((a, b) => b.z - a.z || a.id.localeCompare(b.id));
const floorOptions = [...fixedFloorOptions, ...proceduralFloorOptions];
const visualIds = quotedIds(visuals, /\bid:\s*([A-Z0-9_]+|'[a-z0-9_:.-]+')/g)
  .map(id => id.startsWith('NPC_VISUAL_') ? 'floor_69_female' : id)
  .filter((id, index, list) => list.indexOf(id) === index)
  .sort((a, b) => a.localeCompare(b));

const roleNames = enumEntries(demosSocial, 'DemosSocialRoleId').map(entry => entry.id);
const roles = enumEntries(demosSocial, 'DemosSocialRoleId');
const edgeFlags = quotedIds(demosPosts, /export\s+const\s+DEMOS_EDGE_([A-Z_]+)/g)
  .map(id => id.toLowerCase())
  .sort((a, b) => a.localeCompare(b));
const perkIds = quotedIds(demosTraits, /\bid:\s*'([a-z0-9_]+)'/g);
const npcPackageLookups = npcPackageLookupsFromGameRegistry();

const lookupHints = {
  schema: 'gigahrush.npc-intake.lookup-hints',
  version: 1,
  generatedFrom: {
    coreTypes: 'src/core/types.ts',
    items: 'src/data/items.ts',
    designFloors: 'src/data/design_floors.ts',
    proceduralFloors: 'src/data/procedural_floors.ts',
    npcVisuals: 'src/entities/npc_visuals.ts',
    demosSocial: 'src/data/demos_social.ts',
    npcPackages: 'src/data/npc_packages.ts',
    npcRegistryImports: 'src/gen/design_floors/manifest.ts, story content manifests',
  },
  limits: {
    npcSocialLinks: 9,
    inventorySlots: 16,
    itemStack: 255,
    spriteSize: 64,
    spritePalette: 32,
  },
  factions: enumEntries(core, 'Faction'),
  occupations: enumEntries(core, 'Occupation'),
  floorKeys: floorOptions.map(option => option.id),
  floorOptions,
  storyFloorKeys,
  designFloorKeys,
  proceduralFloorKeys,
  itemIds,
  itemSlots,
  visualIds,
  spritePreviewSize: 64,
  spritePreviews: npcPackageLookups.spritePreviews,
  perkIds,
  demosRelationRoles: roles.length ? roles : roleNames,
  demosEdgeFlags: edgeFlags,
  npcPackageSummaries: npcPackageLookups.summaries,
};

const json = `${JSON.stringify(lookupHints, null, 2)}\n`;
const js = `// Generated by scripts/sync-lookups.mjs. Do not edit by hand.\nexport const lookupHints = ${JSON.stringify(lookupHints, null, 2)};\n`;

const jsonPath = path.join(projectRoot, 'src/data/lookup_hints.json');
const jsPath = path.join(projectRoot, 'src/data/lookup_hints.js');

if (checkOnly) {
  const currentJson = readFileSync(jsonPath, 'utf8');
  const currentJs = readFileSync(jsPath, 'utf8');
  if (currentJson !== json || currentJs !== js) {
    console.error('lookup hints are stale; run npm run sync:lookups');
    process.exit(1);
  }
} else {
  writeFileSync(jsonPath, json);
  writeFileSync(jsPath, js);
  console.log(`wrote ${path.relative(projectRoot, jsonPath)} and ${path.relative(projectRoot, jsPath)}`);
}
