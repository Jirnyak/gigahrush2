import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

import { Cell, DoorState, Feature, FloorLevel, Tex, W, type Entity } from '../src/core/types';
import { auditReachability } from '../src/core/world';
import { DESIGN_FLOOR_ROUTES } from '../src/data/design_floors';
import {
  FLOOR_ANOMALIES,
  FLOOR_GEOMETRIES,
  FLOOR_MAJORITY_FACTIONS,
  PROCEDURAL_FLOOR_ZS,
  makeProceduralFloorSpec,
  type FloorAnomalyId,
  type FloorGeometryId,
  type FloorMajorityId,
  zForStoryFloor,
} from '../src/data/procedural_floors';
import { FLOOR_NAMES, generateFloor, type FloorGeneration } from '../src/gen/floor_manifest';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import { generateProceduralFloor } from '../src/gen/procedural_floor';
import { getRouteCueMarkers } from '../src/systems/route_cues';

type Rgba = readonly [number, number, number, number];

interface CliOptions {
  seed: number;
  z?: number;
  geometry?: FloorGeometryId;
  majority?: FloorMajorityId;
  anomaly?: FloorAnomalyId;
  danger?: number;
  baseFloor?: FloorLevel;
  all: boolean;
  entry?: string;
  out: string;
  outDir: string;
  jsonOut: string;
}

const DEFAULT_OUT = 'tmp/floor-maps/procedural_floor.png';
const DEFAULT_ALL_OUT_DIR = 'tmp/floor-maps/all_route';

const crcTable = new Uint32Array(256);
for (let i = 0; i < crcTable.length; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[i] = c >>> 0;
}

function usage(): never {
  console.error([
    'Usage:',
    '  tsx scripts/render-procedural-floor-map.ts --seed 61061 --z -33 --geometry workshops --majority liquidators --anomaly wall_snake --danger 4 --out tmp/floor-maps/wall_snake.png',
    '  tsx scripts/render-procedural-floor-map.ts --seed 61061 --all --out-dir tmp/floor-maps/all_route_seed_61061',
    '',
    'Options:',
    '  --seed <n>       Run seed passed to makeProceduralFloorSpec.',
    '  --z <n>          Procedural route z for single-map mode.',
    '  --all            Render story floors, design floors, and procedural route stops.',
    '  --entry <id>     With --all, render only one entry by 001 index, z label, key, or title substring.',
    '  --geometry <id>  Optional forced geometry id.',
    '  --majority <id>  Optional forced majority id.',
    '  --anomaly <id>   Optional forced anomaly id.',
    '  --danger <n>     Optional forced danger 1..5.',
    '  --base-floor <n> Optional forced FloorLevel numeric id.',
    '  --out <path>     PNG output path. Default tmp/floor-maps/procedural_floor.png.',
    '  --out-dir <path> Directory output path for --all.',
  ].join('\n'));
  process.exit(2);
}

function readArg(args: readonly string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx < 0) return undefined;
  return args[idx + 1];
}

function parseNumberArg(args: readonly string[], name: string, fallback?: number): number {
  const raw = readArg(args, name);
  if (raw === undefined) {
    if (fallback !== undefined) return fallback;
    usage();
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) usage();
  return value;
}

function parseCli(): CliOptions {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) usage();
  const all = args.includes('--all');
  const seed = parseNumberArg(args, '--seed');
  const z = all && readArg(args, '--z') === undefined ? undefined : parseNumberArg(args, '--z');
  const out = readArg(args, '--out') ?? DEFAULT_OUT;
  const outDir = readArg(args, '--out-dir') ?? `${DEFAULT_ALL_OUT_DIR}_seed_${seed}`;
  const ext = path.extname(out);
  const jsonOut = `${out.slice(0, ext ? -ext.length : undefined)}.json`;
  const dangerRaw = readArg(args, '--danger');
  const baseFloorRaw = readArg(args, '--base-floor');
  return {
    seed,
    z,
    geometry: readArg(args, '--geometry') as FloorGeometryId | undefined,
    majority: readArg(args, '--majority') as FloorMajorityId | undefined,
    anomaly: readArg(args, '--anomaly') as FloorAnomalyId | undefined,
    danger: dangerRaw === undefined ? undefined : parseNumberArg(args, '--danger'),
    baseFloor: baseFloorRaw === undefined ? undefined : parseNumberArg(args, '--base-floor') as FloorLevel,
    all,
    entry: readArg(args, '--entry'),
    out,
    outDir,
    jsonOut,
  };
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, 'ascii');
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  name.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return out;
}

function encodePng(rgba: Buffer, width: number, height: number): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function setPixel(buf: Buffer, x: number, y: number, color: Rgba): void {
  if (x < 0 || y < 0 || x >= W || y >= W) return;
  const i = (y * W + x) * 4;
  buf[i] = color[0];
  buf[i + 1] = color[1];
  buf[i + 2] = color[2];
  buf[i + 3] = color[3];
}

function baseCellColor(cell: Cell, wallTex: Tex, floorTex: Tex): Rgba {
  if (cell === Cell.LIFT) return [74, 144, 205, 255];
  if (cell === Cell.DOOR) return [202, 170, 82, 255];
  if (cell === Cell.WATER) return [40, 108, 126, 255];
  if (cell === Cell.ABYSS) return [4, 5, 8, 255];
  if (cell === Cell.WALL) {
    if (wallTex === Tex.LARVA_BODY) return [232, 228, 205, 255];
    if (wallTex === Tex.DARK) return [8, 7, 8, 255];
    if (wallTex === Tex.HERMO_WALL) return [53, 154, 151, 255];
    if (wallTex === Tex.GUT) return [124, 44, 42, 255];
    if (wallTex === Tex.MEAT) return [96, 34, 38, 255];
    if (wallTex === Tex.METAL || wallTex === Tex.PIPE) return [66, 72, 74, 255];
    return [52, 54, 54, 255];
  }
  if (floorTex === Tex.F_GUT) return [58, 18, 22, 255];
  if (floorTex === Tex.F_MEAT) return [84, 25, 31, 255];
  if (floorTex === Tex.F_WATER) return [34, 74, 86, 255];
  if (floorTex === Tex.F_VOID) return [13, 12, 19, 255];
  if (floorTex === Tex.F_CONCRETE) return [94, 94, 88, 255];
  return [82, 80, 74, 255];
}

function dimUnreachable(color: Rgba): Rgba {
  return [
    Math.floor(color[0] * 0.46),
    Math.floor(color[1] * 0.46),
    Math.floor(color[2] * 0.46),
    color[3],
  ];
}

function stampCross(buf: Buffer, x: number, y: number, color: Rgba, radius: number): void {
  for (let d = -radius; d <= radius; d++) {
    setPixel(buf, x + d, y, color);
    setPixel(buf, x, y + d, color);
  }
}

function renderMap(generation: FloorGeneration): { png: Buffer; metrics: Record<string, unknown> } {
  const { world, spawnX, spawnY, entities } = generation;
  const spawnIdx = world.idx(Math.floor(spawnX), Math.floor(spawnY));
  const reachable = auditReachability(world, spawnIdx).reachable;
  const rgba = Buffer.alloc(W * W * 4);
  let reachableCells = 0;
  let walls = 0;
  let floors = 0;
  let meatWalls = 0;
  let gutFloors = 0;
  let larvaBlocks = 0;
  let hermoWalls = 0;
  let screens = 0;
  let lamps = 0;

  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const ci = world.idx(x, y);
      const cell = world.cells[ci] as Cell;
      const wallTex = world.wallTex[ci] as Tex;
      const floorTex = world.floorTex[ci] as Tex;
      let color = baseCellColor(cell, wallTex, floorTex);
      if (reachable[ci]) reachableCells++;
      else color = dimUnreachable(color);
      if (cell === Cell.WALL) walls++;
      if (cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.DOOR || cell === Cell.LIFT) floors++;
      if (cell === Cell.WALL && (wallTex === Tex.MEAT || wallTex === Tex.GUT)) meatWalls++;
      if (cell === Cell.FLOOR && (floorTex === Tex.F_GUT || floorTex === Tex.F_MEAT)) gutFloors++;
      if (cell === Cell.WALL && wallTex === Tex.LARVA_BODY) larvaBlocks++;
      if (wallTex === Tex.HERMO_WALL || world.hermoWall[ci]) hermoWalls++;
      if ((world.features[ci] as Feature) === Feature.SCREEN) screens++;
      if ((world.features[ci] as Feature) === Feature.LAMP) lamps++;
      setPixel(rgba, x, y, color);
    }
  }

  for (const door of world.doors.values()) {
    const x = door.idx % W;
    const y = (door.idx / W) | 0;
    const color: Rgba = door.state === DoorState.HERMETIC_OPEN || door.state === DoorState.HERMETIC_CLOSED
      ? [100, 238, 220, 255]
      : [230, 184, 92, 255];
    setPixel(rgba, x, y, color);
  }
  for (const cue of getRouteCueMarkers(world)) {
    stampCross(rgba, Math.floor(cue.x), Math.floor(cue.y), [244, 239, 226, 255], 3);
    stampCross(rgba, Math.floor(cue.targetX), Math.floor(cue.targetY), [122, 238, 205, 255], 2);
  }
  for (const entity of entities as readonly Entity[]) {
    if (!entity.alive) continue;
    setPixel(rgba, Math.floor(entity.x), Math.floor(entity.y), [220, 48, 62, 255]);
  }
  stampCross(rgba, Math.floor(spawnX), Math.floor(spawnY), [74, 255, 120, 255], 5);

  return {
    png: encodePng(rgba, W, W),
    metrics: {
      width: W,
      height: W,
      spawnX,
      spawnY,
      rooms: world.rooms.length,
      doors: world.doors.size,
      containers: world.containers.length,
      entities: entities.length,
      routeCues: getRouteCueMarkers(world).length,
      reachableCells,
      walls,
      floors,
      meatWalls,
      gutFloors,
      larvaBlocks,
      hermoWalls,
      screens,
      lamps,
    },
  };
}

function proceduralSpecForCli(cli: CliOptions, z: number): ReturnType<typeof makeProceduralFloorSpec> {
  const base = makeProceduralFloorSpec(cli.seed, z);
  const forcedGeometry = cli.geometry ? FLOOR_GEOMETRIES.find(def => def.id === cli.geometry) : undefined;
  const forcedMajority = cli.majority ? FLOOR_MAJORITY_FACTIONS.find(def => def.id === cli.majority) : undefined;
  const forcedAnomaly = cli.anomaly ? FLOOR_ANOMALIES.find(def => def.id === cli.anomaly) : undefined;
  const titleGeometry = forcedGeometry ?? FLOOR_GEOMETRIES.find(def => def.id === base.geometryId);
  const titleMajority = forcedMajority ?? FLOOR_MAJORITY_FACTIONS.find(def => def.id === base.majorityId);
  const titleAnomaly = forcedAnomaly ?? FLOOR_ANOMALIES.find(def => def.id === base.anomalyId);
  const titlePrefix = titleAnomaly && titleAnomaly.id !== 'none' ? `${titleAnomaly.title}: ` : '';
  return {
    ...base,
    ...(cli.geometry ? { geometryId: cli.geometry } : {}),
    ...(cli.majority ? { majorityId: cli.majority } : {}),
    ...(cli.anomaly ? { anomalyId: cli.anomaly } : {}),
    ...(cli.danger !== undefined ? { danger: cli.danger } : {}),
    ...(cli.baseFloor !== undefined ? { baseFloor: cli.baseFloor } : {}),
    ...(forcedGeometry || forcedMajority || forcedAnomaly
      ? {
          title: `${titlePrefix}${titleGeometry?.title ?? base.geometryId}, ${titleMajority?.title ?? base.majorityId}`,
        }
      : {}),
  };
}

function fileSafeTitle(title: string): string {
  return title
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 140);
}

function zLabel(z: number): string {
  return z >= 0 ? `z+${z}` : `z${z}`;
}

interface BatchEntry {
  kind: 'story' | 'design' | 'procedural';
  z: number;
  key: string;
  title: string;
  generate: () => FloorGeneration;
  spec?: unknown;
}

function batchEntries(seed: number): BatchEntry[] {
  const storyFloors = [
    FloorLevel.MINISTRY,
    FloorLevel.KVARTIRY,
    FloorLevel.LIVING,
    FloorLevel.MAINTENANCE,
    FloorLevel.HELL,
    FloorLevel.VOID,
  ] as const;
  const entries: BatchEntry[] = storyFloors.map(floor => ({
    kind: 'story',
    z: zForStoryFloor(floor),
    key: `story_${FloorLevel[floor].toLowerCase()}`,
    title: FLOOR_NAMES[floor],
    generate: () => generateFloor(floor, seed),
    spec: { floor },
  }));
  for (const route of DESIGN_FLOOR_ROUTES) {
    entries.push({
      kind: 'design',
      z: route.z,
      key: route.id,
      title: route.displayName,
      generate: () => generateDesignFloor(route.id, seed),
      spec: route,
    });
  }
  for (const z of PROCEDURAL_FLOOR_ZS) {
    const spec = makeProceduralFloorSpec(seed, z);
    entries.push({
      kind: 'procedural',
      z,
      key: spec.key,
      title: spec.title,
      generate: () => generateProceduralFloor(spec),
      spec,
    });
  }
  return entries.sort((a, b) => b.z - a.z || a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key));
}

function entryMatches(entry: BatchEntry, index: number, rawNeedle: string): boolean {
  const needle = rawNeedle.trim().toLowerCase();
  if (!needle) return false;
  const ordinal = String(index + 1).padStart(3, '0');
  if (needle === ordinal || needle === String(index + 1)) return true;
  if (needle === zLabel(entry.z).toLowerCase() || needle === String(entry.z)) return true;
  if (entry.key.toLowerCase() === needle) return true;
  return entry.title.toLowerCase().includes(needle);
}

async function writeRenderedMap(out: string, jsonOut: string, rendered: { png: Buffer; metrics: Record<string, unknown> }, metadata: Record<string, unknown>): Promise<void> {
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, rendered.png);
  await writeFile(jsonOut, `${JSON.stringify({ ...metadata, ...rendered.metrics }, null, 2)}\n`);
}

async function renderSingle(cli: CliOptions): Promise<void> {
  if (cli.z === undefined) usage();
  const spec = proceduralSpecForCli(cli, cli.z);
  const generation = generateProceduralFloor(spec);
  const rendered = renderMap(generation);

  await writeRenderedMap(cli.out, cli.jsonOut, rendered, { kind: 'procedural', z: cli.z, key: spec.key, title: spec.title, spec });

  console.log(`wrote ${cli.out}`);
  console.log(`wrote ${cli.jsonOut}`);
}

async function renderAll(cli: CliOptions): Promise<void> {
  const allEntries = batchEntries(cli.seed);
  const entries = cli.entry ? allEntries.filter((entry, i) => entryMatches(entry, i, cli.entry ?? '')) : allEntries;
  if (entries.length === 0) {
    throw new Error(`No route entry matched --entry ${cli.entry}`);
  }
  const manifest: Record<string, unknown>[] = [];
  await mkdir(cli.outDir, { recursive: true });
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const globalIndex = allEntries.indexOf(entry);
    const ordinal = globalIndex >= 0 ? globalIndex + 1 : i + 1;
    const prefix = `${String(ordinal).padStart(3, '0')}_${zLabel(entry.z)}_${entry.kind}_${entry.key}_${fileSafeTitle(entry.title)}`;
    const pngPath = path.join(cli.outDir, `${prefix}.png`);
    const jsonPath = path.join(cli.outDir, `${prefix}.json`);
    const generation = entry.generate();
    const rendered = renderMap(generation);
    const metadata = {
      index: ordinal,
      total: allEntries.length,
      kind: entry.kind,
      z: entry.z,
      key: entry.key,
      title: entry.title,
      spec: entry.spec,
      png: path.basename(pngPath),
      json: path.basename(jsonPath),
    };
    await writeRenderedMap(pngPath, jsonPath, rendered, metadata);
    manifest.push({ ...metadata, ...rendered.metrics });
    console.log(`${ordinal}/${allEntries.length} ${zLabel(entry.z)} ${entry.kind} ${entry.title}`);
  }
  const manifestPath = path.join(cli.outDir, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify({ seed: cli.seed, count: entries.length, entries: manifest }, null, 2)}\n`);
  console.log(`wrote ${manifestPath}`);
}

const cli = parseCli();
if (cli.all) {
  await renderAll(cli);
} else {
  await renderSingle(cli);
}
