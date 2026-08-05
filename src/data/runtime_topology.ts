import type { FloorAnomalyId } from './procedural_floors';

export type RuntimeTopologyDirtyFlag =
  | 'cells'
  | 'wallTex'
  | 'floorTex'
  | 'features'
  | 'fog'
  | 'containerMap'
  | 'doors'
  | 'railTrainCells';

export type RuntimeTopologyFeatureId = Extract<
  FloorAnomalyId,
  'wall_snake' | 'living_tunnels' | 'section_shift' | 'conway_life' | 'rail_trains' | 'bad_apple_world' | 'sandpile_perekrytie'
>;

export interface RuntimeTopologyContract {
  id: RuntimeTopologyFeatureId;
  cadence: string;
  maxArenaCells: number;
  maxArenaCount: number;
  cacheKey: string;
  invalidatesOn: readonly string[];
  dirtyFlags: readonly RuntimeTopologyDirtyFlag[];
  routeCriticalProtections: readonly string[];
  counterplay: readonly string[];
  saveBehavior: string;
}

export const RUNTIME_TOPOLOGY_LIMITS = {
  conwayLifeMaxArenas: 4,
  conwayLifeMaxArenaCells: 48 * 48,
  conwayLifeWorldWindowCells: 128 * 128,
  livingTunnelsMaxRoots: 16,
  livingTunnelsMaxTrailPatches: 180,
  livingTunnelsMaxPatchCells: 13,
  wallSnakeMaxSnakes: 128,
  wallSnakeMaxPathCells: 192,
  wallSnakeMaxBodyCells: 96,
  sectionShiftMaxSections: 6,
  sectionShiftMaxSectionCells: 720,
  sandpileMaxArenas: 3,
  sandpileMaxArenaCells: 40 * 32,
  badAppleMaxScreens: 2,
  badApplePixelsPerScreen: 144 * 108,
  railTrainMaxTrains: 8,
  railTrainMaxLength: 16,
} as const;

export const RUNTIME_TOPOLOGY_CONTRACTS: readonly RuntimeTopologyContract[] = [
  {
    id: 'wall_snake',
    cadence: '0.78s batched larva topology tick; snakes keep internal phase but cell dirty/path cache invalidation happens only on the batch, with one bounded flesh regrowth attempt',
    maxArenaCells: RUNTIME_TOPOLOGY_LIMITS.wallSnakeMaxSnakes * RUNTIME_TOPOLOGY_LIMITS.wallSnakeMaxPathCells,
    maxArenaCount: RUNTIME_TOPOLOGY_LIMITS.wallSnakeMaxSnakes,
    cacheKey: 'WeakMap<World, SnakeFieldRuntime | null> from [wall_snake:*] room tags and current meat/larva cells; visual ticks are batched to avoid per-frame navigation rebakes',
    invalidatesOn: ['new World object', 'route transition/load', 'samosbor rebuild'],
    dirtyFlags: ['cells', 'wallTex', 'floorTex'],
    routeCriticalProtections: ['lift cells', 'doors', 'abyss', 'aptMask', 'hermoWall', 'containers'],
    counterplay: ['step off the warned black head cell', 'bait with metal/food/raw meat/mushroom mass', 'wait for the eaten tail cavern'],
    saveBehavior: 'No custom save section; larvae and flesh regrowth are rebuilt from room tags and current World cells/textures.',
  },
  {
    id: 'living_tunnels',
    cadence: '0.42s root step, max 4 catch-up steps per update',
    maxArenaCells: RUNTIME_TOPOLOGY_LIMITS.livingTunnelsMaxRoots *
      RUNTIME_TOPOLOGY_LIMITS.livingTunnelsMaxTrailPatches *
      RUNTIME_TOPOLOGY_LIMITS.livingTunnelsMaxPatchCells,
    maxArenaCount: RUNTIME_TOPOLOGY_LIMITS.livingTunnelsMaxRoots,
    cacheKey: 'WeakMap<World, LivingTunnelRuntime | null> from [living_tunnel:*] room tags',
    invalidatesOn: ['new World object', 'route transition/load', 'samosbor rebuild'],
    dirtyFlags: ['cells', 'wallTex', 'floorTex', 'features', 'fog'],
    routeCriticalProtections: ['lift cells and local lift-button buffers', 'doors', 'abyss', 'aptMask', 'hermoWall', 'containers', 'apparatus', 'screens'],
    counterplay: ['sealant tube on roots or fresh cuts', 'jackhammer or UV pause', 'clear old trail before retreating'],
    saveBehavior: 'No custom save section; roots are rebuilt from room tags and trail state is transient.',
  },
  {
    id: 'section_shift',
    cadence: 'warn and paint next seam, then 4.5-10.5s local topology shift while inside a tagged section',
    maxArenaCells: RUNTIME_TOPOLOGY_LIMITS.sectionShiftMaxSections *
      RUNTIME_TOPOLOGY_LIMITS.sectionShiftMaxSectionCells,
    maxArenaCount: RUNTIME_TOPOLOGY_LIMITS.sectionShiftMaxSections,
    cacheKey: 'WeakMap<World, ShiftRuntime | null> from [section_shift:*] room tags',
    invalidatesOn: ['new World object', 'route transition/load', 'samosbor rebuild'],
    dirtyFlags: ['cells', 'wallTex', 'floorTex', 'fog'],
    routeCriticalProtections: ['same-room safe destination search', 'warning corridors', 'lift buttons', 'aptMask', 'hermoWall', 'doors'],
    counterplay: ['leave before warning expires', 'use the apparatus to freeze shifts for 45s with cooldown'],
    saveBehavior: 'No custom save section; sections are rebuilt from room tags.',
  },
  {
    id: 'sandpile_perekrytie',
    cadence: 'player-triggered 4.25s collapse countdown; passive hint at most every 7s while standing on unstable slab',
    maxArenaCells: RUNTIME_TOPOLOGY_LIMITS.sandpileMaxArenas *
      RUNTIME_TOPOLOGY_LIMITS.sandpileMaxArenaCells,
    maxArenaCount: RUNTIME_TOPOLOGY_LIMITS.sandpileMaxArenas,
    cacheKey: 'WeakMap<World, SandpileRuntime | null> from [sandpile_perekrytie:*] room tags',
    invalidatesOn: ['new World object', 'route transition/load', 'samosbor rebuild'],
    dirtyFlags: ['cells', 'wallTex', 'floorTex', 'features', 'fog'],
    routeCriticalProtections: ['lift cells and lift-button buffers', 'doors', 'abyss', 'aptMask', 'hermoWall', 'containers', 'apparatus'],
    counterplay: ['read crack warnings', 'trigger collapse from edge and retreat', 'use stabilizer apparatus with metal sheet/sealant/gear', 'use safe rim route'],
    saveBehavior: 'No custom save section; arena descriptors come from room tags and collapsed cells persist through World/floor-memory snapshots.',
  },
  {
    id: 'conway_life',
    cadence: '0.75s active cellular tick inside one 128x128 world window; random window changes every 60s',
    maxArenaCells: RUNTIME_TOPOLOGY_LIMITS.conwayLifeWorldWindowCells +
      RUNTIME_TOPOLOGY_LIMITS.conwayLifeMaxArenas *
      RUNTIME_TOPOLOGY_LIMITS.conwayLifeMaxArenaCells,
    maxArenaCount: RUNTIME_TOPOLOGY_LIMITS.conwayLifeMaxArenas + 1,
    cacheKey: 'WeakMap<World, ConwayLifeRuntime> from current World cells plus optional "Игра жизнь:" room names',
    invalidatesOn: ['new World object', 'route transition/load', 'samosbor rebuild'],
    dirtyFlags: ['cells', 'wallTex', 'floorTex', 'features', 'fog'],
    routeCriticalProtections: ['doors and near-door cells', 'aptMask', 'hermoWall', 'containers', 'lifts', 'lift buttons'],
    counterplay: ['apparatus freeze/reset', 'wrench or UV', 'circuit board or relay diagram'],
    saveBehavior: 'No custom save section; active window and optional room arena masks are rebuilt from current World cells.',
  },
  {
    id: 'rail_trains',
    cadence: 'every update; only train segment maps and passengers move',
    maxArenaCells: RUNTIME_TOPOLOGY_LIMITS.railTrainMaxTrains * RUNTIME_TOPOLOGY_LIMITS.railTrainMaxLength * 2,
    maxArenaCount: RUNTIME_TOPOLOGY_LIMITS.railTrainMaxTrains,
    cacheKey: 'world.railTracks/world.railTrains plus rebuilt world.railTrainCells map',
    invalidatesOn: ['generation install', 'samosbor rebuild rail snapshot install', 'route transition/load'],
    dirtyFlags: ['railTrainCells'],
    routeCriticalProtections: ['platform safe-exit search', 'non-wall platform cells', 'train cells do not rewrite World.cells'],
    counterplay: ['wait on platform', 'board only while stopped', 'exit at platform', 'avoid rail cells when warned'],
    saveBehavior: 'Runtime train offsets are snapshotted for rebuild; cell occupancy map is rebuilt each update.',
  },
  {
    id: 'bad_apple_world',
    cadence: 'source frame step from packed video, about 15 fps while active',
    maxArenaCells: RUNTIME_TOPOLOGY_LIMITS.badAppleMaxScreens * RUNTIME_TOPOLOGY_LIMITS.badApplePixelsPerScreen,
    maxArenaCount: RUNTIME_TOPOLOGY_LIMITS.badAppleMaxScreens,
    cacheKey: 'WeakMap<World, BadAppleRuntime | null> from [bad_apple:*] room tags',
    invalidatesOn: ['new World object', 'route transition/load', 'samosbor rebuild', 'debug spawn', 'relight pass'],
    dirtyFlags: ['cells', 'wallTex', 'floorTex', 'features', 'fog', 'containerMap', 'doors'],
    routeCriticalProtections: ['site scorer avoids hard-protected cells', 'projector corridor is explicit', 'player cell stays floor with damage warning'],
    counterplay: ['toggle projector with E', 'stand on white/safe cells', 'leave the screen rectangle'],
    saveBehavior: 'No custom save section; frame and active state are stored in room tag.',
  },
] as const;

export function runtimeTopologyContractById(id: RuntimeTopologyFeatureId): RuntimeTopologyContract {
  const contract = RUNTIME_TOPOLOGY_CONTRACTS.find(row => row.id === id);
  if (!contract) throw new Error(`Missing runtime topology contract: ${id}`);
  return contract;
}
