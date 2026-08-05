import { floorKeyForFloorInstance } from '../../data/floor_keys';
import {
  floorInstanceAllowsNpcs,
  floorInstanceAllowsSamosbor,
  floorInstanceById,
  type FloorInstanceDef,
  type FloorInstanceExitRuleId,
  type FloorInstanceGeneratorId,
  type FloorInstanceMonsterPolicyId,
  type FloorInstanceNpcPolicyId,
  type FloorInstanceSamosborPolicyId,
} from '../../data/floor_instances';
import { hashSeed } from '../../core/rand';
import { withoutNpcEntities } from '../entity_filters';
import { generateFloor, type FloorGeneration } from '../floor_manifest';

export interface FloorInstanceGenerationExtras {
  floorInstanceId: string;
  floorInstanceKey: string;
  floorInstanceGeneratorId: FloorInstanceGeneratorId;
  floorInstanceNpcPolicy: FloorInstanceNpcPolicyId;
  floorInstanceMonsterPolicy: FloorInstanceMonsterPolicyId;
  floorInstanceSamosborPolicy: FloorInstanceSamosborPolicyId;
  floorInstanceExitRule: FloorInstanceExitRuleId;
  floorInstanceLore: string;
  floorInstanceTags: readonly string[];
}

export type FloorInstanceGeneration = FloorGeneration & FloorInstanceGenerationExtras;

type FloorInstanceGenerator = (
  def: FloorInstanceDef,
  runSeed: number,
  instanceSeed: number,
) => FloorGeneration;

const DEFAULT_FLOOR_INSTANCE_RUN_SEED = 0x46494e53;

function normalizedInstanceSeed(seed: unknown): number {
  return typeof seed === 'number' && Number.isFinite(seed)
    ? Math.abs(Math.trunc(seed)) % 0x7fffffff
    : 0;
}

export function floorInstanceGenerationSeed(
  def: FloorInstanceDef | string,
  runSeed = DEFAULT_FLOOR_INSTANCE_RUN_SEED,
  instanceSeed = 0,
): number {
  const resolved = typeof def === 'string' ? floorInstanceById(def) : def;
  if (!resolved) throw new Error(`Unknown floor instance: ${String(def)}`);
  return hashSeed(
    `floor-instance:${resolved.id}:${resolved.seedTag}:${normalizedInstanceSeed(instanceSeed)}`,
    runSeed,
  );
}

function storyPocketFloorInstance(
  def: FloorInstanceDef,
  runSeed: number,
  instanceSeed: number,
): FloorGeneration {
  const generationSeed = floorInstanceGenerationSeed(def, runSeed, instanceSeed);
  const generation = generateFloor(def.baseFloor, generationSeed);
  return floorInstanceAllowsNpcs(def) ? generation : withoutNpcEntities(generation);
}

const FLOOR_INSTANCE_GENERATORS: Record<FloorInstanceGeneratorId, FloorInstanceGenerator> = {
  story_pocket: storyPocketFloorInstance,
};

export function floorInstanceGeneratorIds(): readonly FloorInstanceGeneratorId[] {
  return Object.keys(FLOOR_INSTANCE_GENERATORS) as FloorInstanceGeneratorId[];
}

export function validateFloorInstanceGenerators(instances: readonly FloorInstanceDef[]): void {
  for (const def of instances) {
    if (!FLOOR_INSTANCE_GENERATORS[def.generatorId]) {
      throw new Error(`Missing floor instance generator: ${def.id} -> ${def.generatorId}`);
    }
  }
}

export function floorInstanceGenerationExtras(def: FloorInstanceDef): FloorInstanceGenerationExtras {
  return {
    floorInstanceId: def.id,
    floorInstanceKey: floorKeyForFloorInstance(def.id),
    floorInstanceGeneratorId: def.generatorId,
    floorInstanceNpcPolicy: def.npcPolicy,
    floorInstanceMonsterPolicy: def.monsterPolicy,
    floorInstanceSamosborPolicy: def.samosborPolicy,
    floorInstanceExitRule: def.exitRule,
    floorInstanceLore: def.lore,
    floorInstanceTags: def.tags,
  };
}

export function floorInstanceGenerationExtrasForKey(key: string): FloorInstanceGenerationExtras | undefined {
  const prefix = 'floor_instance:';
  if (!key.startsWith(prefix)) return undefined;
  const def = floorInstanceById(key.slice(prefix.length));
  return def ? floorInstanceGenerationExtras(def) : undefined;
}

export function floorInstanceSamosborReplacementAllowed(def: FloorInstanceDef | string): boolean {
  return floorInstanceAllowsSamosbor(def);
}

export function generateFloorInstance(
  defOrId: FloorInstanceDef | string,
  runSeed = DEFAULT_FLOOR_INSTANCE_RUN_SEED,
  instanceSeed = 0,
): FloorInstanceGeneration {
  const def = typeof defOrId === 'string' ? floorInstanceById(defOrId) : defOrId;
  if (!def) throw new Error(`Unknown floor instance: ${String(defOrId)}`);
  const generator = FLOOR_INSTANCE_GENERATORS[def.generatorId];
  if (!generator) throw new Error(`Missing floor instance generator: ${def.id} -> ${def.generatorId}`);
  return {
    ...generator(def, runSeed, normalizedInstanceSeed(instanceSeed)),
    ...floorInstanceGenerationExtras(def),
  };
}
