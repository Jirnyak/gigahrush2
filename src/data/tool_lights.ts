export interface ToolLightDef {
  id: string;
  passive: boolean;
  drainPerSecond: number;
  renderIntensity: number;
  minChargeRatio: number;
  moveMultiplier: number;
  actorLightScore: number;
  dropLightScore: number;
}

export const TOOL_LIGHT_DEFS: readonly ToolLightDef[] = [
  {
    id: 'flashlight',
    passive: false,
    drainPerSecond: 1,
    renderIntensity: 1,
    minChargeRatio: 0.25,
    moveMultiplier: 1,
    actorLightScore: 0.72,
    dropLightScore: 0.74,
  },
  {
    id: 'liquidator_flashlamp',
    passive: false,
    drainPerSecond: 1.15,
    renderIntensity: 1.35,
    minChargeRatio: 0.22,
    moveMultiplier: 0.82,
    actorLightScore: 0.9,
    dropLightScore: 0.88,
  },
  {
    id: 'uv_spotlight',
    passive: false,
    drainPerSecond: 0,
    renderIntensity: 0,
    minChargeRatio: 0,
    moveMultiplier: 1,
    actorLightScore: 0,
    dropLightScore: 0,
  },
];

const TOOL_LIGHT_BY_ID: Readonly<Record<string, ToolLightDef>> = Object.fromEntries(
  TOOL_LIGHT_DEFS.map(def => [def.id, def]),
);

export function toolLightDef(toolId: string | undefined): ToolLightDef | undefined {
  return toolId ? TOOL_LIGHT_BY_ID[toolId] : undefined;
}

export function passiveToolLightDrainPerSecond(toolId: string | undefined): number {
  const def = toolLightDef(toolId);
  return def?.passive ? def.drainPerSecond : 0;
}

export function passiveToolLightMoveMultiplier(toolId: string | undefined): number {
  const def = toolLightDef(toolId);
  return def?.passive ? def.moveMultiplier : 1;
}

export function passiveToolLightRenderIntensity(
  toolId: string | undefined,
  durability: { cur: number; max: number } | null,
): number {
  const def = toolLightDef(toolId);
  if (!def?.passive || !durability || durability.max <= 0 || durability.cur <= 0) return 0;
  const charge = Math.max(def.minChargeRatio, Math.min(1, durability.cur / durability.max));
  return def.renderIntensity * charge;
}

export function activeToolLightDrainPerSecond(toolId: string | undefined): number {
  const def = toolLightDef(toolId);
  return def && !def.passive && def.renderIntensity > 0 ? def.drainPerSecond : 0;
}

export function activeToolLightMoveMultiplier(toolId: string | undefined): number {
  const def = toolLightDef(toolId);
  return def && !def.passive && def.renderIntensity > 0 ? def.moveMultiplier : 1;
}

export function activeToolLightRenderIntensity(
  toolId: string | undefined,
  durability: { cur: number; max: number } | null,
): number {
  const def = toolLightDef(toolId);
  if (!def || def.passive || def.renderIntensity <= 0 || !durability || durability.max <= 0 || durability.cur <= 0) return 0;
  const charge = Math.max(def.minChargeRatio, Math.min(1, durability.cur / durability.max));
  return def.renderIntensity * charge;
}

export function equippedToolLightScore(toolId: string | undefined): number {
  const def = toolLightDef(toolId);
  return def?.passive ? def.actorLightScore : 0;
}

export function droppedToolLightScore(itemId: string): number {
  return toolLightDef(itemId)?.dropLightScore ?? 0;
}
