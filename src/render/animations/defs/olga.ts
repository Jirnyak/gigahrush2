import { EntityType } from '../../../core/types';
import {
  NPC_VISUAL_OLGA_DMITRIEVNA,
  artSpriteManifestRow,
} from '../../../data/art_sprite_manifest';
import { getGeneratedAnimationFramePack } from '../generated_frames';
import { RENDER_ANIMATION_PRIORITY, type RenderAnimationClipDef, type RenderAnimationSource } from '../types';

const OLGA_PLOT_NPC_ID = 'olga';

function requireOlgaArt() {
  const row = artSpriteManifestRow(NPC_VISUAL_OLGA_DMITRIEVNA);
  if (!row) throw new Error(`missing art sprite metadata for ${NPC_VISUAL_OLGA_DMITRIEVNA}`);
  return row;
}

const OLGA_ART = requireOlgaArt();

interface OlgaFrameFacts {
  source: RenderAnimationSource;
  width: number;
  height: number;
}

function framePackFacts(framePackId: string, fallbackFrameCount: number): OlgaFrameFacts {
  const pack = getGeneratedAnimationFramePack(framePackId);
  if (!pack) {
    return {
      source: { kind: 'staticFallback', frameCount: fallbackFrameCount, fallback: 'static' },
      width: OLGA_ART.width,
      height: OLGA_ART.height,
    };
  }
  return {
    source: {
      kind: 'framePack',
      framePackId: pack.id,
      frameCount: pack.frameCount,
      width: pack.width,
      height: pack.height,
      fallback: 'static',
    },
    width: pack.width,
    height: pack.height,
  };
}

const OLGA_SELECTOR = {
  entityType: EntityType.NPC,
  npcVisualId: NPC_VISUAL_OLGA_DMITRIEVNA,
  fallbackPlotNpcId: OLGA_PLOT_NPC_ID,
} as const;
const OLGA_WALK_FRAMES = framePackFacts('olga_dmitrievna_walk', 6);
const OLGA_HARM_FRAMES = framePackFacts('olga_dmitrievna_harm', 3);

export const OLGA_DMITRIEVNA_WALK_CLIP: RenderAnimationClipDef = {
  id: 'olga_dmitrievna_walk',
  channel: 'entity_sprite',
  selector: OLGA_SELECTOR,
  trigger: { kind: 'moving' },
  playback: {
    loop: true,
    fps: 9,
    phaseByDistance: true,
  },
  priority: RENDER_ANIMATION_PRIORITY.locomotion,
  source: OLGA_WALK_FRAMES.source,
  anchor: {
    width: OLGA_WALK_FRAMES.width,
    height: OLGA_WALK_FRAMES.height,
    anchorFeet: OLGA_ART.anchorFeet,
  },
};

export const OLGA_DMITRIEVNA_HARM_CLIP: RenderAnimationClipDef = {
  id: 'olga_dmitrievna_harm',
  channel: 'entity_sprite',
  selector: OLGA_SELECTOR,
  trigger: { kind: 'damaged' },
  playback: {
    once: true,
    fps: 12,
    retriggerCooldownSec: 0.25,
  },
  priority: RENDER_ANIMATION_PRIORITY.harm,
  source: OLGA_HARM_FRAMES.source,
  anchor: {
    width: OLGA_HARM_FRAMES.width,
    height: OLGA_HARM_FRAMES.height,
    anchorFeet: OLGA_ART.anchorFeet,
  },
};

export const OLGA_RENDER_ANIMATION_CLIPS: readonly RenderAnimationClipDef[] = [
  OLGA_DMITRIEVNA_WALK_CLIP,
  OLGA_DMITRIEVNA_HARM_CLIP,
];
