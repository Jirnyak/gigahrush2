/* ── WebGL raycaster engine ────────────────────────────────────── *
 * GPU-accelerated DDA raycasting via fragment shader.             *
 * Replaces the software raycaster loop from engine.ts.             *
 * World data is uploaded as data textures; all 64×64 game         *
 * textures are packed into a single atlas.                        *
 * ────────────────────────────────────────────────────────────── */

import {
  W, Cell, TEX, Tex, MAX_DRAW, Feature, ContainerKind,
  type Entity, EntityType, ProjType, MonsterKind,
} from '../core/types';
import { World, type WorldGridDirtyRect } from '../core/world';
import { getActiveSamosborVariant } from '../systems/samosbor_variants_runtime';
import {
  entityUsesProceduralSprite,
  entityWorldSpriteScale,
  generateProceduralEntitySprite,
  proceduralEntitySpriteKey,
} from '../entities/procedural_visuals';
import type { TexData } from './textures';
import type { SpriteData } from './sprites';
import type { BloodParticle } from './blood';
import { getCritterRenderEnabled } from './critters';
import { containerSpr, featureSpr } from './sprite_index';
import { generateItemSprite, itemDropDefId, itemSpriteKey } from './item_sprites';
import {
  animatedEntityTextureOverride,
  beginAnimatedEntityTextureFrame,
  getAnimatedEntityTextureDebugStats,
  hasAnimatedEntityTextureResolvers,
  recordDrawnAnimatedEntityTexture,
  resetAnimatedEntityTextureOverride,
} from './animations/textures';
import { ENTITY_MASK_VISIBLE, getEntityIndex } from '../systems/entity_index';
import type { CameraView } from '../systems/camera';
import { isPlayerEntity } from '../systems/player_actor';
import {
  EMPTY_RESOLVED_VISUAL_DETAIL_PROFILE,
  VISUAL_DETAIL_FAMILY_CODES,
  type ResolvedVisualDetailFamily,
  type ResolvedVisualDetailProfile,
} from '../data/visual_detail_profiles';
import {
  EMPTY_RESOLVED_VISUAL_GEOMETRY_PROFILE,
  type ResolvedVisualGeometryProfile,
} from '../data/visual_geometry_profiles';
import {
  EMPTY_RESOLVED_VISUAL_SURFACE_PROFILE,
  VISUAL_SURFACE_CEILING_PATTERN_CODES,
  VISUAL_SURFACE_FLOOR_PATTERN_CODES,
  VISUAL_SURFACE_TRIM_CODES,
  VISUAL_SURFACE_WALL_BAND_CODES,
  type ResolvedVisualSurfaceProfile,
} from '../data/visual_surface_profiles';
import {
  createMeshPass,
  createMeshPassStats,
  type MeshPassContext,
  type MeshPassHandle,
  type MeshPassStats,
} from './mesh';
import { COMMON_LIGHTING_SRC } from './shaders_common';

export interface DynamicSkyTexture {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint32Array;
  readonly ambientTint?: { r: number; g: number; b: number };
  readonly fogTint?: { r: number; g: number; b: number };
  dirty: boolean;
}

export interface RenderSceneDebugStats {
  visibleSprites: number;
  drawnSprites: number;
  visibleEntityQueryResults: number;
  spriteCap: number;
  meshEnabled: boolean;
  meshInstances: number;
  meshTriangles: number;
  meshDrawCalls: number;
  activeAnimatedSprites: number;
  drawnAnimatedSprites: number;
  animatedSpriteTextureCacheSize: number;
}

/* ── Constants ─────────────────────────────────────────────────── */
export const SCR_W = 320;
export const SCR_H = 200;
const DEFAULT_FOV_RADIANS = Math.PI / 2;

/* ── Texture atlas layout ─────────────────────────────────────── *
 * All game textures (64×64 each) are packed into a single 2D     *
 * texture atlas. Layout: ATLAS_COLS textures per row.             */
const ATLAS_COLS = 8;             // 8 textures per row
const ATLAS_TEX_SIZE = TEX;       // 64px each texture
const PARTICLE_INSTANCE_CAP = 256;
const PARTICLE_WORLD_SCREEN_SCALE = 0.018;
const PARTICLE_MIN_SCREEN_SIZE = 0.55;
const PARTICLE_MAX_SCREEN_SIZE = 4.0;
const PARTICLE_FADE_START = 6;
const PARTICLE_CULL_DIST = Math.min(MAX_DRAW, 16);
const PROCEDURAL_SPRITE_CACHE_MAX = 8192;
const PROCEDURAL_SPRITE_CACHE_TARGET = 8192;
const ITEM_SPRITE_CACHE_MAX = 8192;
const ITEM_SPRITE_CACHE_TARGET = 8192;
const ITEM_DROP_WORLD_SPRITE_SCALE = 0.34;
const VISIBLE_SPRITE_CAP = 512;
const VISIBLE_ENTITY_QUERY_CAP = VISIBLE_SPRITE_CAP * 2;

const visibleEntityQuery: Entity[] = [];
const STATIC_OBJECT_RADIUS = MAX_DRAW;
const lastRenderSceneDebugStats: RenderSceneDebugStats = {
  visibleSprites: 0,
  drawnSprites: 0,
  visibleEntityQueryResults: 0,
  spriteCap: VISIBLE_SPRITE_CAP,
  meshEnabled: false,
  meshInstances: 0,
  meshTriangles: 0,
  meshDrawCalls: 0,
  activeAnimatedSprites: 0,
  drawnAnimatedSprites: 0,
  animatedSpriteTextureCacheSize: 0,
};

const enum VisibleSpriteSource {
  ENTITY = 0,
  ITEM_DROP = 1,
  FEATURE = 2,
  CONTAINER = 3,
}

export function getRenderSceneDebugStats(): RenderSceneDebugStats {
  return { ...lastRenderSceneDebugStats };
}

export function getMeshPassDebugStats(): MeshPassStats {
  return glState?.meshPass?.stats() ?? createMeshPassStats();
}

/* ── GLSL Shaders ─────────────────────────────────────────────── */

const VERT_SRC = /* glsl */ `#version 300 es
precision highp float;
in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;        // 0..1
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// The raycaster fragment shader — performs DDA per pixel column
const FRAG_SRC = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

/* ── Uniforms ─────────────────────────────────────────────────── */
uniform vec2  uResolution;       // screen size (320, 200)
uniform vec2  uPos;              // player position
uniform float uAngle;            // player angle
uniform float uPitch;            // camera pitch (-1..1)
uniform float uFogDensity;
uniform float uGlitch;
uniform float uPlaneLen;
uniform float uCamHeight;        // 0..1 (0.5 = default)
uniform float uFlashlight;       // 0..1
uniform float uToolBeam;         // directed tool pulse, 0..1.05
uniform float uToolBeamRange;    // directed tool reach in cells
uniform float uAmbient;          // floor ambient light
uniform float uTime;
uniform int   uLightQuality;     // 0=off,1=low,2=medium,3=high,4=experimental
uniform int   uPurpleFog;        // 1 if player is in fogged area
uniform vec3  uFogColor;         // active samosbor variant fog tint

/* ── Data textures ────────────────────────────────────────────── */
uniform highp usampler2D uCells;      // W×W: cell type (uint8)
uniform highp usampler2D uWallTex;    // W×W: wall texture id
uniform highp usampler2D uFloorTex;   // W×W: floor texture id
uniform highp usampler2D uFeatures;   // W×W: features
uniform highp usampler2D uCeil;        // W×W: render-only ceiling-height tiers
uniform sampler2D uLight;             // W×W: lightmap (float)
uniform highp usampler2D uLightBlinks; // W×W: light blink frequency (uint8)
uniform int uSamosborAlert;           // 1 if samosbor red alert is active
uniform highp usampler2D uFog;        // W×W: fog density
uniform highp usampler2D uDoorStates; // W×W: door states (0=open, 1=closed, 2=locked, 3=hopen, 4=hclosed)

/* ── Texture atlas ────────────────────────────────────────────── */
uniform sampler2D uAtlas;             // packed texture atlas
uniform vec2  uAtlasSize;             // atlas dimensions in pixels
uniform int   uUseDynamicSky;         // roof/open-air ceiling override
uniform sampler2D uDynamicSky;        // 1024×1024 dynamic sky/cloud texture
uniform vec3  uDynamicSkyTint;
uniform vec3  uBaseFogColor;

/* ── Surface marks overlay (blood, bullet holes, etc.) ────────── */
uniform sampler2D uSurfaceAtlas;      // 512×512 RGBA atlas of 16×16 cell overlays
uniform highp usampler2D uSurfaceIdx; // W×W: cell → atlas slot (0=none, 1+ = slot)

/* ── Render-only deterministic micro-detail families ─────────── */
uniform int uDetailFloorCount;
uniform vec4 uDetailFloor0;      // family code, density 0..1, scale, seed
uniform vec4 uDetailFloor1;
uniform vec3 uDetailFloorColor0; // RGB color
uniform vec3 uDetailFloorColor1;
uniform int uDetailWallCount;
uniform vec4 uDetailWall0;
uniform vec4 uDetailWall1;
uniform vec3 uDetailWallColor0;
uniform vec3 uDetailWallColor1;
uniform vec4 uDetailLightDust;
uniform vec3 uDetailLightDustColor;

/* ── Room-scale surface material profile ─────────────────────── */
uniform vec4 uSurfaceProfileA;   // floor pattern, wall band, ceiling pattern, trim
uniform vec4 uSurfaceProfileB;   // grime, seam strength, light panel chance, vent chance
uniform float uSurfaceProfileSeed;


/* ── Depth output (for sprite clipping on CPU) ────────────────── */
// We write depth into a color attachment that gets read back
out vec4 fragColor;

const int W_SIZE = ${W};
const int MAX_STEPS = ${MAX_DRAW * 2};
const float MAX_DIST = ${MAX_DRAW.toFixed(1)};
const float TEX_F = ${TEX.toFixed(1)};
const int TEX_I = ${TEX};
const int ATLAS_COLS_I = ${ATLAS_COLS};
const float PI = 3.14159265;

/* ── Helpers ──────────────────────────────────────────────────── */

/* --- TONEMAPPING INJECTION --- */
vec3 ACESFilm(vec3 x) {
    if (uLightQuality < 2) return clamp(x, 0.0, 1.0); // fallback
    
    x = pow(max(x, 0.0), vec3(1.1)); // легкая цветокоррекция перед ACES
    
    float a = 2.51;
    float b = 0.03;
    float c = 2.43;
    float d = 0.59;
    float e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
/* ----------------------------- */

int wrapI(int v) {
  return ((v % W_SIZE) + W_SIZE) % W_SIZE;
}

vec2 wrapF(vec2 v) {
  return mod(mod(v, float(W_SIZE)) + float(W_SIZE), float(W_SIZE));
}

// Sample world data texture (W×W) — textures use NEAREST
uint sampleCell(ivec2 p) {
  ivec2 wp = ivec2(wrapI(p.x), wrapI(p.y));
  return texelFetch(uCells, wp, 0).r;
}

uint sampleWallTex(ivec2 p) {
  ivec2 wp = ivec2(wrapI(p.x), wrapI(p.y));
  return texelFetch(uWallTex, wp, 0).r;
}

uint sampleFloorTex(ivec2 p) {
  ivec2 wp = ivec2(wrapI(p.x), wrapI(p.y));
  return texelFetch(uFloorTex, wp, 0).r;
}

uint sampleFeature(ivec2 p) {
  ivec2 wp = ivec2(wrapI(p.x), wrapI(p.y));
  return texelFetch(uFeatures, wp, 0).r;
}

bool organicLightCell(ivec2 p) {
  ivec2 wp = ivec2(wrapI(p.x), wrapI(p.y));
  uint wallTex = texelFetch(uWallTex, wp, 0).r;
  uint floorTex = texelFetch(uFloorTex, wp, 0).r;
  return wallTex == ${Tex.MEAT}u || wallTex == ${Tex.GUT}u || wallTex == ${Tex.LARVA_BODY}u ||
         floorTex == ${Tex.F_MEAT}u || floorTex == ${Tex.F_GUT}u;
}

float organicLightPulse(ivec2 p) {
  if (!organicLightCell(p)) return 1.0;
  ivec2 wp = ivec2(wrapI(p.x), wrapI(p.y));
  float phase = float((wp.x * 13 + wp.y * 17) & 63) * 0.09817477;
  return 0.78 + 0.22 * (0.5 + 0.5 * sin(uTime * 0.72 + phase));
}

float getBlinkPulse(ivec2 p) {
  uint freqU = texelFetch(uLightBlinks, p, 0).r;
  float freq = float(freqU);
  if (uSamosborAlert == 1) freq = 3.0; // override for red alert
  if (freq <= 0.0) return 1.0;
  
  float h = fract(sin(float(p.x) * 12.9898 + float(p.y) * 78.233) * 43758.5453);
  
  if (uSamosborAlert == 1) {
    float t = fract(uTime * 1.5 - h * 0.2); // slight stagger, sharp strobe
    return (t < 0.4) ? 1.0 : 0.2;
  }
  
  // Broken fluorescent stutter
  float t = uTime * freq * 4.0 + h * 100.0;
  float n = fract(sin(floor(t)) * 137.5453);
  return (n > 0.3) ? 1.0 : 0.1;
}

float sampleLight(ivec2 p) {
  ivec2 wp = ivec2(wrapI(p.x), wrapI(p.y));
  return texelFetch(uLight, wp, 0).r * organicLightPulse(wp) * getBlinkPulse(wp);
}

// Fast power-of-two wrap (W_SIZE is a power of two).
int wrapFast(int v) { return v & (W_SIZE - 1); }
float bakedLightRaw(int x, int y) { return texelFetch(uLight, ivec2(wrapFast(x), wrapFast(y)), 0).r; }

// Bilinear baked light + analytic gradient at a continuous world position.
// .x = smooth light value, .yz = horizontal light gradient (toward brighter light).
// The flesh pulse is applied once at the sampled cell, not per tap (cheap).
vec3 sampleLightSmooth(vec2 pos) {
  vec2 p = pos - 0.5;            // cell i center sits at i+0.5
  ivec2 c = ivec2(floor(p));
  vec2 f = p - vec2(c);
  float l00 = bakedLightRaw(c.x,     c.y);
  float l10 = bakedLightRaw(c.x + 1, c.y);
  float l01 = bakedLightRaw(c.x,     c.y + 1);
  float l11 = bakedLightRaw(c.x + 1, c.y + 1);
  float lx0 = mix(l00, l10, f.x);
  float lx1 = mix(l01, l11, f.x);
  float v   = mix(lx0, lx1, f.y);
  float gx  = mix(l10 - l00, l11 - l01, f.y);
  float gy  = lx1 - lx0;
  ivec2 baseCell = ivec2(int(floor(pos.x)), int(floor(pos.y)));
  v *= organicLightPulse(baseCell) * getBlinkPulse(baseCell);
  return vec3(v, gx, gy);
}

uint sampleFog(ivec2 p) {
  ivec2 wp = ivec2(wrapI(p.x), wrapI(p.y));
  return texelFetch(uFog, wp, 0).r;
}

uint sampleDoor(ivec2 p) {
  ivec2 wp = ivec2(wrapI(p.x), wrapI(p.y));
  return texelFetch(uDoorStates, wp, 0).r;
}

// Sample from texture atlas by texture id and texel coordinates
vec4 sampleAtlas(uint texId, int tx, int ty) {
  int txi = int(texId);
  int atlasX = (txi % ATLAS_COLS_I) * TEX_I + (tx & (TEX_I - 1));
  int atlasY = (txi / ATLAS_COLS_I) * TEX_I + (ty & (TEX_I - 1));
  return texelFetch(uAtlas, ivec2(atlasX, atlasY), 0);
}

/* Surface overlay: blend mark on top of base color */
const int SURF_ATLAS_COLS = 32; // 32 slots per row in 512px atlas
vec3 blendSurface(vec3 base, ivec2 cell, int subX, int subY) {
  uint slot = texelFetch(uSurfaceIdx, cell, 0).r;
  if (slot == 0u) return base;
  int s = int(slot) - 1; // 0-based slot index
  int ax = (s % SURF_ATLAS_COLS) * 16 + (subX & 15);
  int ay = (s / SURF_ATLAS_COLS) * 16 + (subY & 15);
  vec4 m = texelFetch(uSurfaceAtlas, ivec2(ax, ay), 0);
  float a = m.a;
  if (a < 0.004) return base;
  return mix(base, m.rgb, a);
}

vec3 fogColor() {
  return uPurpleFog == 1 ? uFogColor
                         : uBaseFogColor;
}

vec3 applyFogV(vec3 c, float f) {
  vec3 fc = fogColor();
  return mix(c, fc, f);
}

float distanceFog(float dist) {
  if (uFogDensity <= 0.0) return 0.0;
  float x = max(0.0, dist * uFogDensity);
  // Linear/exponential fog as specified
  return clamp(1.0 - exp(-x), 0.0, 0.985);
}

vec3 applyLocalFog(vec3 c, ivec2 p, float baseF) {
  vec3 outColor = applyFogV(c, baseF);
  float localFog = float(sampleFog(p)) / 255.0;
  if (localFog <= 0.02) return outColor;
  float phase = float((p.x * 11 + p.y * 7) & 63) * 0.0997331;
  float pulse = 0.82 + 0.18 * sin(uTime * 1.65 + phase);
  float f = clamp(localFog * 0.78 * pulse, 0.0, 0.88);
  return mix(outColor, uFogColor, f);
}

bool lightBoundary(uint cell, uint rawDoorState) {
  if (cell == ${Cell.WALL}u || cell == ${Cell.LIFT}u || cell == ${Cell.ABYSS}u) return true;
  if (cell != ${Cell.DOOR}u) return false;
  uint doorState = rawDoorState & 127u;
  return doorState != 0u && doorState != 3u;
}

bool lightBoundaryAt(ivec2 p) {
  uint cell = sampleCell(p);
  uint doorState = cell == ${Cell.DOOR}u ? sampleDoor(p) : 0u;
  return lightBoundary(cell, doorState);
}

${COMMON_LIGHTING_SRC}

float contactAoFloor(ivec2 cell) {
  float n = 0.0;
  n += lightBoundaryAt(cell + ivec2( 1,  0)) ? 1.0 : 0.0;
  n += lightBoundaryAt(cell + ivec2(-1,  0)) ? 1.0 : 0.0;
  n += lightBoundaryAt(cell + ivec2( 0,  1)) ? 1.0 : 0.0;
  n += lightBoundaryAt(cell + ivec2( 0, -1)) ? 1.0 : 0.0;
  return clamp(1.0 - n * 0.095, 0.62, 1.0);
}

float contactAoWall(ivec2 cell, int side, int texY) {
  float bottom = smoothstep(38.0, 63.0, float(texY)) * 0.22;
  ivec2 a = side == 0 ? ivec2(0, 1) : ivec2(1, 0);
  float corner = 0.0;
  corner += lightBoundaryAt(cell + a) ? 1.0 : 0.0;
  corner += lightBoundaryAt(cell - a) ? 1.0 : 0.0;
  float sideShade = side == 1 ? 0.13 : 0.0;
  return clamp(1.0 - bottom - corner * 0.045 - sideShade, 0.56, 1.0);
}

vec3 materialResponse(uint texId, vec3 base, int tx, int ty, ivec2 cell, float lit, float beam) {
  float luma = dot(base, vec3(0.299, 0.587, 0.114));
  vec3 color = base;

  if (texId == ${Tex.CONCRETE}u || texId == ${Tex.BRICK}u || texId == ${Tex.PANEL}u ||
      texId == ${Tex.HERMO_WALL}u || texId == ${Tex.F_CONCRETE}u || texId == ${Tex.F_LINO}u) {
    float panelSeam = max(1.0 - smoothstep(0.0, 2.0, float(tx & 15)),
                          1.0 - smoothstep(0.0, 2.0, float(ty & 15)));
    color = mix(vec3(luma), color, 1.10);
    color = mix(color, color * vec3(0.70, 0.68, 0.63), panelSeam * 0.18);
    color += vec3(0.030, 0.027, 0.022) * smoothstep(0.18, 0.72, luma);
  } else if (texId == ${Tex.TILE_W}u || texId == ${Tex.METAL}u || texId == ${Tex.PIPE}u ||
             texId == ${Tex.F_TILE}u || texId == ${Tex.F_MARBLE_TILE}u || texId == ${Tex.MARBLE}u) {
    float seam = max(1.0 - smoothstep(0.0, 1.4, float(tx & 7)),
                     1.0 - smoothstep(0.0, 1.4, float(ty & 7)));
    float cold = smoothstep(0.22, 0.96, lit + beam * 0.65);
    color = mix(color, color * vec3(0.72, 0.78, 0.83), seam * 0.16);
    color += vec3(0.030, 0.050, 0.070) * cold;
  } else if (texId == ${Tex.F_WATER}u) {
    float edge = smoothstep(0.30, 1.0, lit + beam);
    color = mix(color, vec3(0.07, 0.12, 0.13), 0.14);
    color += vec3(0.020, 0.050, 0.060) * edge;
  } else if (texId == ${Tex.MEAT}u || texId == ${Tex.GUT}u || texId == ${Tex.LARVA_BODY}u ||
             texId == ${Tex.F_MEAT}u || texId == ${Tex.F_GUT}u) {
    float wet = smoothstep(0.25, 0.95, lit + beam) * organicLightPulse(cell);
    color = mix(color, color * vec3(1.09, 0.82, 0.76), 0.18);
    color += vec3(0.055, 0.012, 0.009) * wet;
  } else if (texId == ${Tex.VOID_WALL}u || texId == ${Tex.F_VOID}u || texId == ${Tex.F_ABYSS}u || texId == ${Tex.DARK}u) {
    int proof = (tx * 3 + ty * 5 + cell.x * 7 + cell.y * 11) & 31;
    float sharp = proof == 0 ? 1.0 : 0.0;
    color = mix(color, color * vec3(0.78, 0.95, 0.82), 0.13);
    color += vec3(0.018, 0.090, 0.034) * sharp * smoothstep(0.18, 0.9, lit + beam);
  }

  return clamp(color, 0.0, 1.0);
}

/* --- NORMAL MAP INJECTION --- */
vec2 perturbNormal(vec2 baseNormal, vec3 texColor, float strength) {
    if (uLightQuality < 3) return baseNormal;
    
    // Вычисляем "высоту" на основе яркости текстуры
    float height = dot(texColor, vec3(0.299, 0.587, 0.114));
    
    // Используем аппаратные производные (стандартно для WebGL2 / ES 3.0)
    float dHx = dFdx(height);
    float dHy = dFdy(height);
    
    // Формируем сдвиг нормали
    vec2 bump = vec2(-dHx, -dHy) * strength;
    
    // Смешиваем с базовой нормалью (считая, что она в пространстве экрана/мира)
    return normalize(baseNormal + bump);
}
/* ---------------------------- */

/* --- AO INJECTION START --- */
float computeVoxelAO(ivec2 cell, vec2 normal, highp usampler2D cellMap) {
    if (uLightQuality < 3) return 1.0;
    
    vec2 tangent = vec2(-normal.y, normal.x);
    ivec2 t1 = ivec2(tangent);
    ivec2 t2 = ivec2(-tangent);
    
    ivec2 checkPos1 = cell - ivec2(normal) + t1;
    ivec2 checkPos2 = cell - ivec2(normal) + t2;
    
    uint c1 = texelFetch(cellMap, checkPos1, 0).r;
    uint c2 = texelFetch(cellMap, checkPos2, 0).r;
    
    float ao = 1.0;
    bool isSolid1 = (c1 != 0u && c1 != ${Cell.ABYSS}u && c1 != ${Cell.WATER}u);
    bool isSolid2 = (c2 != 0u && c2 != ${Cell.ABYSS}u && c2 != ${Cell.WATER}u);
    
    if (isSolid1) ao -= 0.35;
    if (isSolid2) ao -= 0.35;
    
    return max(0.3, ao);
}

float computeFloorAO(ivec2 cell, vec2 worldPos, highp usampler2D cellMap) {
    if (uLightQuality < 3) return 1.0;
    
    vec2 localPos = fract(worldPos);
    float ao = 1.0;
    
    uint nN = texelFetch(cellMap, cell + ivec2(0, -1), 0).r;
    uint nS = texelFetch(cellMap, cell + ivec2(0, 1), 0).r;
    uint nE = texelFetch(cellMap, cell + ivec2(1, 0), 0).r;
    uint nW = texelFetch(cellMap, cell + ivec2(-1, 0), 0).r;
    
    if (nN != 0u && nN != ${Cell.ABYSS}u) { if (localPos.y < 0.2) ao -= (0.2 - localPos.y) * 2.0; }
    if (nS != 0u && nS != ${Cell.ABYSS}u) { if (localPos.y > 0.8) ao -= (localPos.y - 0.8) * 2.0; }
    if (nW != 0u && nW != ${Cell.ABYSS}u) { if (localPos.x < 0.2) ao -= (0.2 - localPos.x) * 2.0; }
    if (nE != 0u && nE != ${Cell.ABYSS}u) { if (localPos.x > 0.8) ao -= (localPos.x - 0.8) * 2.0; }
    
    return max(0.4, ao);
}
/* --- AO INJECTION END --- */

// Render-only shine layer: hard directional diffuse shaping + specular glints
// driven by the player's light, plus a soft bump from the baked-light gradient.
// Sits on top of materialResponse and is gated by the lighting quality setting.
//   ndl      = surface-facing factor toward the light (walls: N路L; floors: ~0)
//   drive    = player light strength reaching this surface (0..1)
//   grad     = baked-light gradient (.x horizontal, .y vertical)
//   dirShape = how much hard directional diffuse to apply (walls 1.0, floors 0.0)
vec3 applyLightFX(vec3 color, uint texId, float ndl, float drive, vec2 grad, float dirShape) {
  if (uLightQuality < 2) return color;

  float shininess; vec3 specTint = vec3(1.0);
  if (texId == ${Tex.F_WATER}u) { shininess = 1.0; specTint = vec3(0.72, 0.90, 1.0); }
  else if (texId == ${Tex.TILE_W}u || texId == ${Tex.METAL}u || texId == ${Tex.PIPE}u ||
           texId == ${Tex.F_TILE}u || texId == ${Tex.F_MARBLE_TILE}u || texId == ${Tex.MARBLE}u) { shininess = 0.85; specTint = vec3(0.82, 0.90, 1.0); }
  else if (texId == ${Tex.MEAT}u || texId == ${Tex.GUT}u || texId == ${Tex.LARVA_BODY}u ||
           texId == ${Tex.F_MEAT}u || texId == ${Tex.F_GUT}u) { shininess = 0.66; specTint = vec3(1.0, 0.52, 0.46); }
  else { shininess = 0.12; }

  float pl = clamp(drive, 0.0, 1.0);
  float nl = clamp(ndl, 0.0, 1.0);

  // Directional diffuse (walls): faced surfaces brighten, grazing fall to shadow.
  float diffuse = mix(0.52, 1.30, nl);
  color *= mix(1.0, diffuse, pl * dirShape);

  // Specular glint driven directly by the player light (not by baked light).
  // Kept moderate so wet/metal reads as a soft sheen, not a plastic mirror.
  if (pl > 0.001 && shininess > 0.0) {
    float spec;
    if (dirShape > 0.5) {
      float specExp = mix(6.0, 40.0, shininess);   // matte = broad, metal = tighter
      spec = pow(nl, specExp) * (0.10 + shininess * 0.55);
    } else {
      // Floor / wet sheen: strongest near light and at light-pool edges.
      float edge = clamp(0.18 + length(grad) * 5.0, 0.0, 1.0);
      spec = edge * shininess * shininess * 0.7;
    }
    color += specTint * spec * pl * 0.5;
  }

  // Soft directional bump from the baked-light gradient (lamp pools), high+.
  if (uLightQuality >= 3) {
    float bump = clamp((grad.x + grad.y) * 0.5, -0.5, 0.5);
    color *= 1.0 + bump * 0.18;
  }

  return uLightQuality >= 3 ? color : clamp(color, 0.0, 1.0);
}

float flashlightBoost(float dist) {
  if (uFlashlight <= 0.0) return 0.0;
  float radius = 8.5;
  if (dist >= radius) return 0.0;
  float t = 1.0 - dist / radius;
  return uFlashlight * t * t * 0.95;
}

// Always-on soft near-player light so material shaping / glints stay visible even
// without an equipped flashlight. Render-only; fades out with distance.
float eyeLight(float dist) {
  return (1.0 - smoothstep(0.5, 11.0, dist)) * 0.22;
}

// Shadow-deepening contrast curve: pulls low/mid light down while keeping
// highlights, so the scene reads dark and atmospheric instead of flat/washed.
float shadeCurve(float lit) {
  return pow(clamp(lit, 0.0, 1.0), 1.32);
}

float toolBeamBoost(float dist, float rayDX, float rayDY) {
  if (uToolBeam <= 0.0 || uToolBeamRange <= 0.0) return 0.0;
  vec2 forward = vec2(cos(uAngle), sin(uAngle));
  vec2 delta = vec2(rayDX, rayDY) * dist;
  float along = dot(delta, forward);
  if (along <= 0.35 || along > uToolBeamRange) return 0.0;
  float side = abs(dot(delta, vec2(-forward.y, forward.x)));
  float halfWidth = min(1.05, 0.36 + along * 0.055);
  float edge = 1.0 - smoothstep(halfWidth * 0.68, halfWidth, side);
  float falloff = 1.0 - along / uToolBeamRange;
  float flicker = 0.94 + 0.06 * sin(uTime * 57.0 + along * 3.1);
  return uToolBeam * edge * (0.24 + falloff * 0.76) * flicker;
}

vec3 applyToolBeamTint(vec3 c, float beam) {
  if (beam <= 0.0) return c;
  vec3 tint = vec3(0.70, 0.96, 1.0);
  float a = min(0.34, beam * 0.28);
  return min(mix(c, max(c, tint), a) + tint * beam * 0.08, vec3(1.0));
}

// Hash noise for hell eye overlay (matches pixutil.noise on CPU)
float noiseI(int x, int y, int s) {
  int n = x * 374761393 + y * 668265263 + s * 1274126177;
  n = (n ^ (n >> 13)) * 1103515245;
  n = n ^ (n >> 16);
  return float(n & 0x7fff) / 32767.0;
}

float clampSigned(float v, float lim) {
  return clamp(v, -lim, lim);
}

float toroidalDelta(float a, float b) {
  float d = b - a;
  if (d > float(W_SIZE) * 0.5) d -= float(W_SIZE);
  if (d < -float(W_SIZE) * 0.5) d += float(W_SIZE);
  return d;
}

vec3 applyHellEye(vec3 base, int texXi, int texYi, int cellX, int cellY) {
  float marker = noiseI(cellX, cellY, 901);
  if (marker < 0.84) return base;

  int eyeCount = marker > 0.97 ? 3 : (marker > 0.915 ? 2 : 1);
  float blinkSpeed = 0.25 + noiseI(cellX, cellY, 902) * 0.9;
  float cycle = fract(uTime * blinkSpeed + noiseI(cellX, cellY, 903) * 5.0);
  float eyelid = cycle < 0.16 ? max(0.04, abs(cycle - 0.08) / 0.08) : 1.0;
  float toPlayerX = toroidalDelta(float(cellX) + 0.5, uPos.x);
  float toPlayerY = toroidalDelta(float(cellY) + 0.5, uPos.y);
  float playerDist = sqrt(toPlayerX * toPlayerX + toPlayerY * toPlayerY);
  float track = playerDist < 7.5 ? (1.0 - playerDist / 7.5) : 0.0;

  float tx = float(texXi);
  float ty = float(texYi);
  vec3 color = base;

  for (int ei = 0; ei < 3; ei++) {
    if (ei >= eyeCount) break;
    float ox = 12.0 + noiseI(cellX + ei * 17, cellY, 904) * 40.0;
    float oy = 14.0 + noiseI(cellX, cellY + ei * 23, 905) * 36.0;
    float rx = 6.0 + noiseI(cellX + ei * 31, cellY, 906) * 7.0;
    float ry = max(1.2, rx * (0.12 + eyelid * 0.42));
    float dx = tx - ox;
    float dy = ty - oy;
    float norm = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
    if (norm > 1.0) continue;

    // Sclera
    color = mix(color, vec3(230.0/255.0, 216.0/255.0, 182.0/255.0), 0.78);

    float idleShiftX = (noiseI(cellX, cellY, 907 + ei) - 0.5) * 1.4;
    float idleShiftY = (noiseI(cellX, cellY, 909 + ei) - 0.5) * 1.1;
    float irisShiftX = idleShiftX + clampSigned(toPlayerX * 0.55 * track, rx * 0.24);
    float irisShiftY = idleShiftY + clampSigned(toPlayerY * 0.55 * track, ry * 0.28);
    float irisR = rx * 0.42;
    float pupilR = rx * 0.18;
    float ix = tx - (ox + irisShiftX);
    float iy = ty - (oy + irisShiftY);
    float irisNorm = (ix * ix + iy * iy) / (irisR * irisR);
    if (irisNorm < 1.0 && eyelid > 0.18) {
      color = mix(color, vec3(186.0/255.0, 46.0/255.0, 28.0/255.0), 0.82);
    }
    float pupilNorm = (ix * ix + iy * iy) / (pupilR * pupilR);
    if (pupilNorm < 1.0 && eyelid > 0.22) {
      color = mix(color, vec3(18.0/255.0, 8.0/255.0, 6.0/255.0), 0.92);
    }
    float glintDx = tx - (ox - rx * 0.18);
    float glintDy = ty - (oy - ry * 0.22);
    float glint = glintDx * glintDx + glintDy * glintDy;
    if (glint < 3.5 && eyelid > 0.35) {
      color = mix(color, vec3(1.0, 248.0/255.0, 238.0/255.0), 0.85);
    }
  }
  return color;
}

vec3 applyHellLamp(vec3 base, int texXi, int texYi, int cellX, int cellY, float dist) {
  float tx = (float(texXi) - 31.5) / 32.0;
  float ty = (float(texYi) - 31.5) / 32.0;
  float r = sqrt(tx * tx + ty * ty);
  float a = atan(ty, tx);
  float seed = noiseI(cellX, cellY, 941);
  float breathe = 0.5 + 0.5 * sin(uTime * 0.72 + seed * 6.2831853);
  float aperture = 0.16 + breathe * 0.075;
  float fold = sin(a * 9.0 + seed * 11.0 + uTime * 0.26) * 0.026 +
               sin(a * 17.0 - seed * 7.0) * 0.012;
  float edge = aperture + fold;
  float hole = 1.0 - smoothstep(edge * 0.72, edge, r);
  float rim = 1.0 - smoothstep(0.018, 0.074, abs(r - edge));
  float flesh = 1.0 - smoothstep(0.31, 0.66, r);
  float wet = noiseI(cellX + texXi, cellY + texYi, 947) * 0.18;
  vec3 meat = vec3(95.0/255.0 + wet, 23.0/255.0 + wet * 0.35, 18.0/255.0 + wet * 0.22);
  vec3 ring = vec3(154.0/255.0 + wet, 42.0/255.0 + wet * 0.4, 25.0/255.0 + wet * 0.25);
  vec3 light = vec3(1.0, 172.0/255.0, 42.0/255.0);
  float distGlow = max(0.0, 1.0 - dist * 0.14);
  vec3 color = mix(base, meat, flesh * 0.82);
  color = mix(color, ring, rim * 0.78);
  color += light * distGlow * (hole * 1.25 + rim * 0.34);
  return min(color, vec3(1.0));
}

float detailRect(vec2 uv, vec2 center, vec2 size) {
  vec2 d = abs(uv - center) / max(size, vec2(0.001));
  return 1.0 - smoothstep(0.82, 1.0, max(d.x, d.y));
}

float detailLine(float v, float width) {
  return 1.0 - smoothstep(width, width + 0.025, abs(v));
}

float surfaceSeam1(int coord, int size, float width) {
  int s = max(2, size);
  int c = coord % s;
  if (c < 0) c += s;
  float edge = float(min(c, s - 1 - c));
  return 1.0 - smoothstep(width, width + 1.65, edge);
}

float surfaceGridSeam(int tx, int ty, int size, float width) {
  return max(surfaceSeam1(tx, size, width), surfaceSeam1(ty, size, width));
}

bool architecturalMaterial(uint texId) {
  return texId == ${Tex.CONCRETE}u || texId == ${Tex.BRICK}u || texId == ${Tex.PANEL}u ||
         texId == ${Tex.TILE_W}u || texId == ${Tex.METAL}u || texId == ${Tex.PIPE}u ||
         texId == ${Tex.HERMO_WALL}u || texId == ${Tex.MARBLE}u ||
         texId == ${Tex.F_CONCRETE}u || texId == ${Tex.F_LINO}u || texId == ${Tex.F_TILE}u ||
         texId == ${Tex.F_WOOD}u || texId == ${Tex.F_CARPET}u || texId == ${Tex.F_MARBLE_TILE}u ||
         texId == ${Tex.F_PARQUET}u || texId == ${Tex.CEIL}u;
}

bool organicOrVoidMaterial(uint texId) {
  return texId == ${Tex.MEAT}u || texId == ${Tex.GUT}u || texId == ${Tex.LARVA_BODY}u ||
         texId == ${Tex.F_MEAT}u || texId == ${Tex.F_GUT}u ||
         texId == ${Tex.VOID_WALL}u || texId == ${Tex.F_VOID}u ||
         texId == ${Tex.F_ABYSS}u || texId == ${Tex.DARK}u;
}

int effectiveFloorPattern(uint texId, int profilePattern) {
  if (texId == ${Tex.F_TILE}u || texId == ${Tex.F_MARBLE_TILE}u) return ${VISUAL_SURFACE_FLOOR_PATTERN_CODES.smallTile};
  if (texId == ${Tex.F_LINO}u || texId == ${Tex.F_PARQUET}u) return ${VISUAL_SURFACE_FLOOR_PATTERN_CODES.lino};
  if (texId == ${Tex.F_WATER}u) return ${VISUAL_SURFACE_FLOOR_PATTERN_CODES.wetConcrete};
  if (texId == ${Tex.METAL}u || texId == ${Tex.PIPE}u) return ${VISUAL_SURFACE_FLOOR_PATTERN_CODES.metalGrid};
  return profilePattern;
}

int effectiveWallBand(uint texId, int profileBand) {
  if (organicOrVoidMaterial(texId)) return ${VISUAL_SURFACE_WALL_BAND_CODES.none};
  if (texId == ${Tex.TILE_W}u || texId == ${Tex.MARBLE}u) return ${VISUAL_SURFACE_WALL_BAND_CODES.tileWainscot};
  if (texId == ${Tex.PIPE}u || texId == ${Tex.METAL}u) return ${VISUAL_SURFACE_WALL_BAND_CODES.serviceStrip};
  if (texId == ${Tex.BRICK}u || texId == ${Tex.CONCRETE}u || texId == ${Tex.HERMO_WALL}u) {
    return profileBand == ${VISUAL_SURFACE_WALL_BAND_CODES.none} ? ${VISUAL_SURFACE_WALL_BAND_CODES.concreteBlocks} : profileBand;
  }
  return profileBand;
}

int effectiveTrim(uint texId, int profileTrim) {
  if (organicOrVoidMaterial(texId)) return ${VISUAL_SURFACE_TRIM_CODES.none};
  if (texId == ${Tex.PIPE}u || texId == ${Tex.METAL}u) return ${VISUAL_SURFACE_TRIM_CODES.metalRail};
  return profileTrim;
}

vec3 applySurfaceGrime(vec3 color, ivec2 cell, int tx, int ty, float materialBoost) {
  float grime = clamp(uSurfaceProfileB.x, 0.0, 1.0) * materialBoost;
  if (grime <= 0.001) return color;
  float coarse = noiseI(cell.x * 5 + (tx >> 3), cell.y * 7 + (ty >> 3), int(uSurfaceProfileSeed) + 811);
  float fine = noiseI(cell.x * 13 + tx, cell.y * 17 + ty, int(uSurfaceProfileSeed) + 823);
  float mask = smoothstep(0.58, 0.98, coarse * 0.72 + fine * 0.28);
  return mix(color, color * vec3(0.66, 0.64, 0.58), mask * grime * 0.34);
}

vec3 applyFloorSurfaceProfile(vec3 base, uint texId, ivec2 cell, int tx, int ty) {
  int pattern = effectiveFloorPattern(texId, int(uSurfaceProfileA.x + 0.5));
  float seamStrength = clamp(uSurfaceProfileB.y, 0.0, 1.0);
  vec3 color = base;

  if (organicOrVoidMaterial(texId)) {
    color = applySurfaceGrime(color, cell, tx, ty, texId == ${Tex.F_VOID}u || texId == ${Tex.F_ABYSS}u ? 0.35 : 0.85);
    return color;
  }

  if (pattern == ${VISUAL_SURFACE_FLOOR_PATTERN_CODES.checker}) {
    float checker = ((cell.x + cell.y) & 1) == 0 ? 0.0 : 1.0;
    vec3 low = color * vec3(0.60, 0.61, 0.58);
    vec3 high = min(color * vec3(1.24, 1.22, 1.14) + vec3(0.035), vec3(1.0));
    color = mix(low, high, checker);
    float grout = max(surfaceGridSeam(tx, ty, 64, 0.8), surfaceGridSeam(tx, ty, 32, 0.45) * 0.55);
    color = mix(color, color * vec3(0.42, 0.43, 0.40), grout * (0.25 + seamStrength * 0.35));
  } else if (pattern == ${VISUAL_SURFACE_FLOOR_PATTERN_CODES.smallTile}) {
    float seam = surfaceGridSeam(tx, ty, 16, 0.85);
    float tileRoll = noiseI(cell.x * 11 + (tx >> 4), cell.y * 13 + (ty >> 4), int(uSurfaceProfileSeed) + 829);
    color = mix(color * vec3(0.82, 0.86, 0.87), color * vec3(1.10, 1.12, 1.12), tileRoll * 0.35);
    color = mix(color, color * vec3(0.38, 0.43, 0.45), seam * (0.42 + seamStrength * 0.35));
  } else if (pattern == ${VISUAL_SURFACE_FLOOR_PATTERN_CODES.lino}) {
    float seam = surfaceGridSeam(tx, ty, 32, 0.65);
    float strip = float(((cell.x + (tx >> 5)) & 1) == 0);
    color = mix(color * vec3(0.84, 0.92, 0.78), color * vec3(1.06, 1.03, 0.92), strip * 0.38);
    color = mix(color, color * vec3(0.53, 0.55, 0.48), seam * (0.24 + seamStrength * 0.25));
  } else if (pattern == ${VISUAL_SURFACE_FLOOR_PATTERN_CODES.wetConcrete}) {
    float seam = surfaceGridSeam(tx, ty, 64, 0.85);
    float wet = smoothstep(0.60, 0.98, noiseI(cell.x * 3 + (tx >> 2), cell.y * 5 + (ty >> 2), int(uSurfaceProfileSeed) + 839));
    color = mix(color, color * vec3(0.48, 0.55, 0.52), wet * 0.28);
    color += vec3(0.018, 0.027, 0.026) * wet;
    color = mix(color, color * vec3(0.44), seam * (0.20 + seamStrength * 0.28));
  } else if (pattern == ${VISUAL_SURFACE_FLOOR_PATTERN_CODES.metalGrid}) {
    float grid = max(surfaceGridSeam(tx, ty, 16, 0.8), surfaceSeam1(tx + ty, 8, 0.5) * 0.45);
    float plate = float((((cell.x + cell.y) + (tx >> 5) + (ty >> 5)) & 1) == 0);
    color = mix(color * vec3(0.62, 0.68, 0.69), color * vec3(0.82, 0.88, 0.86), plate * 0.35);
    color += vec3(0.026, 0.040, 0.042) * (1.0 - grid);
    color = mix(color, color * vec3(0.32, 0.36, 0.36), grid * (0.50 + seamStrength * 0.38));
  } else {
    float slab = surfaceGridSeam(tx, ty, 64, 0.65);
    color = mix(color, color * vec3(0.55, 0.54, 0.50), slab * seamStrength * 0.28);
  }

  return clamp(applySurfaceGrime(color, cell, tx, ty, architecturalMaterial(texId) ? 1.0 : 0.45), 0.0, 1.0);
}

vec3 applyWallSurfaceProfile(vec3 base, uint texId, ivec2 cell, int side, int tx, int ty) {
  int band = effectiveWallBand(texId, int(uSurfaceProfileA.y + 0.5));
  int trim = effectiveTrim(texId, int(uSurfaceProfileA.w + 0.5));
  float seamStrength = clamp(uSurfaceProfileB.y, 0.0, 1.0);
  vec3 color = base;

  if (organicOrVoidMaterial(texId)) {
    color = applySurfaceGrime(color, cell, tx, ty, texId == ${Tex.VOID_WALL}u || texId == ${Tex.DARK}u ? 0.25 : 0.82);
    return color;
  }

  float lower = smoothstep(34.0, 41.0, float(ty));
  if (band == ${VISUAL_SURFACE_WALL_BAND_CODES.tileWainscot}) {
    float seam = surfaceGridSeam(tx, ty, 16, 0.8);
    vec3 tile = mix(vec3(0.56, 0.62, 0.62), vec3(0.78, 0.82, 0.80), noiseI(cell.x + (tx >> 4), cell.y + (ty >> 4), int(uSurfaceProfileSeed) + 853) * 0.34);
    tile = mix(tile, tile * vec3(0.34, 0.39, 0.40), seam * (0.48 + seamStrength * 0.28));
    color = mix(color, tile, lower * 0.68);
  } else if (band == ${VISUAL_SURFACE_WALL_BAND_CODES.panelLower}) {
    float seam = max(surfaceSeam1(tx, 24, 0.65), surfaceSeam1(ty, 32, 0.55));
    vec3 panel = color * vec3(0.60, 0.61, 0.57) + vec3(0.025, 0.022, 0.018);
    panel = mix(panel, panel * vec3(0.42), seam * (0.32 + seamStrength * 0.22));
    color = mix(color, panel, lower * 0.62);
  } else if (band == ${VISUAL_SURFACE_WALL_BAND_CODES.concreteBlocks}) {
    float seam = max(surfaceSeam1(tx + ((ty >> 4) & 1) * 16, 32, 0.75), surfaceSeam1(ty, 16, 0.65));
    color = mix(color, color * vec3(0.50, 0.50, 0.47), seam * (0.30 + seamStrength * 0.28));
  } else if (band == ${VISUAL_SURFACE_WALL_BAND_CODES.serviceStrip}) {
    float strip = 1.0 - smoothstep(0.0, 3.5, abs(float(ty) - 34.0));
    float seam = max(surfaceSeam1(tx, 16, 0.7), surfaceSeam1(ty, 8, 0.4));
    vec3 service = color * vec3(0.42, 0.48, 0.48) + vec3(0.030, 0.042, 0.038);
    service = mix(service, service * vec3(0.34), seam * 0.45);
    color = mix(color, service, strip * 0.88);
  }

  if (trim == ${VISUAL_SURFACE_TRIM_CODES.baseboard}) {
    float baseboard = smoothstep(56.0, 61.0, float(ty));
    color = mix(color, color * vec3(0.42, 0.35, 0.25), baseboard * 0.58);
  } else if (trim == ${VISUAL_SURFACE_TRIM_CODES.concretePlinth}) {
    float plinth = smoothstep(53.0, 61.0, float(ty));
    color = mix(color, color * vec3(0.46, 0.46, 0.42), plinth * 0.55);
  } else if (trim == ${VISUAL_SURFACE_TRIM_CODES.metalRail}) {
    float rail = max(1.0 - smoothstep(0.0, 2.2, abs(float(ty) - 45.0)),
                     1.0 - smoothstep(0.0, 1.6, abs(float(ty) - 14.0)));
    color = mix(color, vec3(0.18, 0.24, 0.24), rail * 0.62);
    color += vec3(0.030, 0.044, 0.042) * rail;
  }

  float ventChance = clamp(uSurfaceProfileB.w, 0.0, 1.0);
  if (ventChance > 0.001 && architecturalMaterial(texId)) {
    float roll = noiseI(cell.x + side * 19, cell.y - side * 23, int(uSurfaceProfileSeed) + 863);
    if (roll < ventChance) {
      vec2 uv = (vec2(float(tx), float(ty)) + 0.5) / TEX_F;
      float box = detailRect(uv, vec2(0.50, 0.22 + noiseI(cell.x, cell.y, int(uSurfaceProfileSeed) + 867) * 0.18), vec2(0.15, 0.055));
      float slats = step(0.55, fract(float(ty) * 0.34));
      vec3 vent = mix(vec3(0.035, 0.045, 0.045), vec3(0.16, 0.18, 0.17), slats * 0.35);
      color = mix(color, vent, box * 0.66);
    }
  }

  return clamp(applySurfaceGrime(color, cell, tx, ty, architecturalMaterial(texId) ? 1.0 : 0.35), 0.0, 1.0);
}

vec3 applyCeilingSurfaceProfile(vec3 base, uint texId, ivec2 cell, int tx, int ty) {
  int pattern = int(uSurfaceProfileA.z + 0.5);
  float seamStrength = clamp(uSurfaceProfileB.y, 0.0, 1.0);
  vec3 color = base;

  if (pattern == ${VISUAL_SURFACE_CEILING_PATTERN_CODES.panelGrid}) {
    float seam = surfaceGridSeam(tx, ty, 32, 0.8);
    color = mix(color, color * vec3(0.46, 0.47, 0.45), seam * (0.35 + seamStrength * 0.32));
  } else if (pattern == ${VISUAL_SURFACE_CEILING_PATTERN_CODES.servicePanels}) {
    float seam = max(surfaceGridSeam(tx, ty, 32, 0.8), surfaceGridSeam(tx, ty, 16, 0.45) * 0.48);
    float strip = surfaceSeam1(tx + cell.x * 3, 12, 0.45) * 0.35;
    color = mix(color * vec3(0.82, 0.86, 0.84), color * vec3(0.42, 0.47, 0.47), max(seam, strip) * (0.48 + seamStrength * 0.24));
  } else if (pattern == ${VISUAL_SURFACE_CEILING_PATTERN_CODES.lowConcrete}) {
    float seam = surfaceGridSeam(tx, ty, 64, 0.75);
    color = mix(color, color * vec3(0.50, 0.50, 0.47), seam * seamStrength * 0.34);
  } else if (pattern == ${VISUAL_SURFACE_CEILING_PATTERN_CODES.organicRibs}) {
    float rib = 1.0 - smoothstep(0.0, 0.055, abs(sin(float(tx + cell.x * 9) * 0.24 + noiseI(cell.x, cell.y, int(uSurfaceProfileSeed) + 877) * 2.4)));
    color = mix(color, color * vec3(1.18, 0.64, 0.58), rib * 0.34);
  }

  float panelChance = clamp(uSurfaceProfileB.z, 0.0, 1.0);
  if (panelChance > 0.001 && pattern != ${VISUAL_SURFACE_CEILING_PATTERN_CODES.organicRibs}) {
    float roll = noiseI(cell.x * 5, cell.y * 7, int(uSurfaceProfileSeed) + 881);
    if (roll < panelChance) {
      vec2 uv = (vec2(float(tx), float(ty)) + 0.5) / TEX_F;
      float panel = detailRect(uv, vec2(0.5), vec2(0.24, 0.15));
      color = mix(color, vec3(0.72, 0.76, 0.64), panel * 0.52);
      color += vec3(0.040, 0.045, 0.026) * panel;
    }
  }

  return clamp(applySurfaceGrime(color, cell, tx, ty, architecturalMaterial(texId) ? 0.75 : 0.25), 0.0, 1.0);
}

float detailMaterialBoost(int family, uint texId, bool floorSurface) {
  if (texId == ${Tex.F_ABYSS}u || texId == ${Tex.DARK}u) {
    return family == ${VISUAL_DETAIL_FAMILY_CODES.proof_specks} ? 0.65 : 0.0;
  }
  bool organic = texId == ${Tex.MEAT}u || texId == ${Tex.GUT}u || texId == ${Tex.LARVA_BODY}u ||
                 texId == ${Tex.F_MEAT}u || texId == ${Tex.F_GUT}u;
  bool voidTex = texId == ${Tex.VOID_WALL}u || texId == ${Tex.F_VOID}u;
  bool industrial = texId == ${Tex.METAL}u || texId == ${Tex.PIPE}u || texId == ${Tex.F_WATER}u;
  bool paperOk = texId == ${Tex.F_LINO}u || texId == ${Tex.F_PARQUET}u || texId == ${Tex.F_WOOD}u || texId == ${Tex.F_CONCRETE}u;
  bool concrete = texId == ${Tex.CONCRETE}u || texId == ${Tex.PANEL}u || texId == ${Tex.BRICK}u ||
                  texId == ${Tex.HERMO_WALL}u || texId == ${Tex.F_CONCRETE}u || texId == ${Tex.F_LINO}u;

  if (family == ${VISUAL_DETAIL_FAMILY_CODES.paper_scraps} || family == ${VISUAL_DETAIL_FAMILY_CODES.newspaper_bits}) {
    return floorSurface && paperOk && !organic && !voidTex ? 1.0 : 0.0;
  }
  if (family == ${VISUAL_DETAIL_FAMILY_CODES.crumbs}) {
    return floorSurface && !organic && !voidTex ? 0.85 : 0.0;
  }
  if (family == ${VISUAL_DETAIL_FAMILY_CODES.floor_dust}) {
    return floorSurface && !organic ? (voidTex ? 0.25 : 0.85) : 0.0;
  }
  if (family == ${VISUAL_DETAIL_FAMILY_CODES.wall_cracks} || family == ${VISUAL_DETAIL_FAMILY_CODES.chipped_concrete}) {
    return concrete || texId == ${Tex.MARBLE}u ? 1.0 : (industrial ? 0.45 : 0.2);
  }
  if (family == ${VISUAL_DETAIL_FAMILY_CODES.cobweb_corner}) {
    return !floorSurface && !organic && !voidTex && !industrial ? 0.85 : 0.0;
  }
  if (family == ${VISUAL_DETAIL_FAMILY_CODES.rust_grit}) {
    return industrial || texId == ${Tex.F_CONCRETE}u || texId == ${Tex.CONCRETE}u ? 1.0 : 0.0;
  }
  if (family == ${VISUAL_DETAIL_FAMILY_CODES.wet_dirt}) {
    return floorSurface && !voidTex ? (industrial || texId == ${Tex.F_TILE}u || texId == ${Tex.F_CONCRETE}u ? 1.0 : 0.38) : 0.0;
  }
  if (family == ${VISUAL_DETAIL_FAMILY_CODES.bone_crumbs}) {
    return floorSurface && !voidTex ? (organic ? 1.0 : 0.48) : 0.0;
  }
  if (family == ${VISUAL_DETAIL_FAMILY_CODES.gut_threads}) {
    return organic ? 1.0 : 0.0;
  }
  if (family == ${VISUAL_DETAIL_FAMILY_CODES.proof_specks}) {
    return voidTex ? 1.0 : 0.22;
  }
  return 0.0;
}

vec3 applyMicroDetailSlot(vec3 base, vec4 slot, vec3 slotColor, bool floorSurface, uint texId, ivec2 cell, int tx, int ty) {
  int family = int(slot.x + 0.5);
  float density = clamp(slot.y, 0.0, 1.0);
  if (family <= 0 || density <= 0.0) return base;
  float materialBoost = detailMaterialBoost(family, texId, floorSurface);
  if (materialBoost <= 0.0) return base;

  vec2 uv = (vec2(float(tx), float(ty)) + 0.5) / TEX_F;
  int seed = int(slot.w);
  float cellRoll = noiseI(cell.x + family * 23, cell.y - family * 31, seed + 17);
  float local = noiseI(cell.x * 7 + tx * 13, cell.y * 11 + ty * 5, seed + family * 41);
  vec3 detail = slotColor;
  float scale = max(0.25, slot.z);
  float a = 0.0;

  if (family == ${VISUAL_DETAIL_FAMILY_CODES.paper_scraps} || family == ${VISUAL_DETAIL_FAMILY_CODES.newspaper_bits}) {
    if (cellRoll < density * 3.8) {
      vec2 center = vec2(
        0.18 + 0.64 * noiseI(cell.x, cell.y, seed + 101),
        0.20 + 0.60 * noiseI(cell.y, cell.x, seed + 103)
      );
      vec2 size = vec2(0.040, 0.018) * scale * (family == ${VISUAL_DETAIL_FAMILY_CODES.newspaper_bits} ? 0.72 : 1.0);
      float ink = family == ${VISUAL_DETAIL_FAMILY_CODES.newspaper_bits}
        ? step(0.56, noiseI(tx, ty, seed + cell.x * 3 + cell.y * 5))
        : 0.0;
      a = detailRect(uv, center, size) * (0.34 + ink * 0.15);
      detail = mix(detail, vec3(0.09, 0.10, 0.09), ink * 0.38);
    }
  } else if (family == ${VISUAL_DETAIL_FAMILY_CODES.crumbs} || family == ${VISUAL_DETAIL_FAMILY_CODES.bone_crumbs} ||
             family == ${VISUAL_DETAIL_FAMILY_CODES.proof_specks}) {
    float chance = density * (family == ${VISUAL_DETAIL_FAMILY_CODES.proof_specks} ? 0.55 : 0.72);
    float speck = step(1.0 - chance, local);
    float edge = step(0.88, noiseI(tx + cell.x, ty + cell.y, seed + 7));
    a = speck * (0.16 + edge * 0.18);
    if (family == ${VISUAL_DETAIL_FAMILY_CODES.proof_specks}) {
      detail += vec3(0.06, 0.20, 0.10) * edge;
      a *= 0.75;
    }
  } else if (family == ${VISUAL_DETAIL_FAMILY_CODES.floor_dust}) {
    float n = noiseI(cell.x * 3 + (tx >> 2), cell.y * 5 + (ty >> 2), seed + 29);
    a = smoothstep(0.72, 0.98, n) * density * 0.34;
    detail = mix(base * 0.72, detail, 0.35);
  } else if (family == ${VISUAL_DETAIL_FAMILY_CODES.wall_cracks}) {
    if (cellRoll < density * 4.2) {
      float x = uv.x - (0.16 + 0.68 * noiseI(cell.x, cell.y, seed + 131));
      float kink = sin(uv.y * 24.0 + cellRoll * 6.2831853) * 0.028;
      a = detailLine(x + kink, 0.010 + density * 0.018) * (0.22 + density * 0.55);
    }
  } else if (family == ${VISUAL_DETAIL_FAMILY_CODES.chipped_concrete}) {
    if (cellRoll < density * 3.4) {
      vec2 center = vec2(
        0.14 + 0.72 * noiseI(cell.x, cell.y, seed + 151),
        0.16 + 0.68 * noiseI(cell.y, cell.x, seed + 157)
      );
      float chip = detailRect(uv, center, vec2(0.026, 0.020) * scale);
      a = chip * (0.20 + local * 0.20);
    }
  } else if (family == ${VISUAL_DETAIL_FAMILY_CODES.cobweb_corner}) {
    float corner = max(
      1.0 - smoothstep(0.0, 0.22, length(uv - vec2(0.03, 0.03))),
      1.0 - smoothstep(0.0, 0.22, length(uv - vec2(0.97, 0.03)))
    );
    float strand = max(detailLine(uv.x + uv.y - 0.22, 0.009), detailLine(uv.x - uv.y, 0.007));
    a = corner * strand * density * 0.55 * step(0.42, cellRoll);
  } else if (family == ${VISUAL_DETAIL_FAMILY_CODES.rust_grit}) {
    float streak = floorSurface
      ? smoothstep(0.83, 0.99, local)
      : detailLine(uv.x - 0.22 - noiseI(cell.x, cell.y, seed + 181) * 0.55, 0.015);
    a = streak * density * (floorSurface ? 0.72 : 0.46);
  } else if (family == ${VISUAL_DETAIL_FAMILY_CODES.wet_dirt}) {
    float puddle = detailRect(uv, vec2(0.5 + (cellRoll - 0.5) * 0.42, 0.55), vec2(0.16, 0.055) * scale);
    float edge = smoothstep(0.40, 0.96, local);
    a = puddle * edge * density * 0.95;
    detail = mix(detail, vec3(0.04, 0.05, 0.04), 0.55);
  } else if (family == ${VISUAL_DETAIL_FAMILY_CODES.gut_threads}) {
    float thread = max(
      detailLine(sin(uv.x * 18.0 + cellRoll * 4.0) * 0.08 + uv.y - 0.35, 0.014),
      detailLine(cos(uv.y * 15.0 + cellRoll * 5.0) * 0.07 + uv.x - 0.62, 0.012)
    );
    a = thread * density * 0.74 * step(0.34, cellRoll);
  }

  a = clamp(a * materialBoost, 0.0, 0.45);
  return mix(base, detail, a);
}

vec3 applyFloorMicroDetail(vec3 base, uint texId, ivec2 cell, int tx, int ty) {
  vec3 color = base;
  if (uDetailFloorCount > 0) color = applyMicroDetailSlot(color, uDetailFloor0, uDetailFloorColor0, true, texId, cell, tx, ty);
  if (uDetailFloorCount > 1) color = applyMicroDetailSlot(color, uDetailFloor1, uDetailFloorColor1, true, texId, cell, tx, ty);
  return color;
}

vec3 applyWallMicroDetail(vec3 base, uint texId, ivec2 cell, int tx, int ty) {
  vec3 color = base;
  if (uDetailWallCount > 0) color = applyMicroDetailSlot(color, uDetailWall0, uDetailWallColor0, false, texId, cell, tx, ty);
  if (uDetailWallCount > 1) color = applyMicroDetailSlot(color, uDetailWall1, uDetailWallColor1, false, texId, cell, tx, ty);
  return color;
}

/* --- VOLUMETRIC INJECTION --- */
vec3 computeVolumetricGodRays(float rayDist, vec3 baseColor, vec2 rayDir) {
    if (uLightQuality < 3) return baseColor;
    
    // Фонарик светит вперед. Наш текущий луч: rayDir.
    // Чем ближе луч к центру экрана и чем больше дистанция, тем больше "пыли" он просвечивает.
    float centerDot = dot(normalize(rayDir), normalize(vec2(cos(uAngle), sin(uAngle))));
    float shaft = max(0.0, centerDot);
    shaft = pow(shaft, 12.0); // Узкий луч фонарика
    
    // Интегрируем по длине (чем дальше стена, тем больше пыли просвечено)
    float volIntensity = shaft * rayDist * 0.05 * uFlashlight;
    vec3 dustColor = vec3(0.9, 0.95, 1.0);
    return baseColor + dustColor * volIntensity;
}
/* ---------------------------- */

vec3 applyLightDust(vec3 base, vec2 fragCoord, float dist, float rayDX, float rayDY, float fogF) {
  float density = clamp(uDetailLightDust.y, 0.0, 1.0);
  if (density <= 0.0) return base;
  float beam = max(flashlightBoost(dist), toolBeamBoost(dist, rayDX, rayDY));
  if (beam <= 0.015) return base;
  float nearFade = 1.0 - smoothstep(2.0, MAX_DIST * 0.72, dist);
  float fogFade = 1.0 - smoothstep(0.18, 0.82, fogF);
  float sparkle = step(1.0 - density * 0.13, noiseI(int(fragCoord.x) * 5, int(fragCoord.y) * 7, int(uDetailLightDust.w) + 601));
  float a = sparkle * beam * nearFade * fogFade * density * 0.55;
  return min(base + uDetailLightDustColor * a, vec3(1.0));
}

vec3 shadeWall(uint texId, vec3 base, ivec2 cell, int side, int texX, int texY, float dist, float lit, float beam) {
  vec3 color = applyWallSurfaceProfile(base, texId, cell, side, texX, texY);
  color = applyWallMicroDetail(color, texId, cell, texX, texY);
  color = materialResponse(texId, color, texX, texY, cell, lit, beam);
  color = blendSurface(color, cell, texX >> 2, texY >> 2);
  if (texId == ${Tex.MEAT}u || texId == ${Tex.GUT}u) {
    color = applyHellEye(color, texX, texY, cell.x, cell.y);
  }
  color *= contactAoWall(cell, side, texY);
  color *= shadeCurve(lit);
  return applyToolBeamTint(color, beam);
}

vec3 shadePlane(uint texId, vec3 base, ivec2 cell, int tx, int ty, float dist, float lit, float beam, bool ceiling, bool surface) {
  vec3 color = base;
  if (texId == ${Tex.F_WATER}u && surface) {
    int flowX = tx + int(uTime * 5.0);
    int flowY = ty - int(uTime * 12.0);
    flowX += int(sin(float(ty) * 0.1 + uTime * 1.5) * 3.0);
    color = sampleAtlas(${Tex.F_WATER}u, flowX, flowY).rgb;

    float bar = max(
      1.0 - smoothstep(1.0, 2.0, mod(float(tx), 16.0)),
      1.0 - smoothstep(1.0, 2.0, mod(float(ty), 16.0))
    );
    float n = noiseI(cell.x * 64 + tx, cell.y * 64 + ty, 111);
    vec3 grate = vec3(0.18 + n * 0.05, 0.20 + n * 0.05, 0.16 + n * 0.04);
    color = mix(color, grate, bar);
  }

  if (ceiling) {
    color = applyCeilingSurfaceProfile(color, texId, cell, tx, ty);
    if (texId == ${Tex.CEIL}u) color = applyWallMicroDetail(color, texId, cell, tx, ty);
  } else if (surface) {
    color = applyFloorSurfaceProfile(color, texId, cell, tx, ty);
    color = applyFloorMicroDetail(color, texId, cell, tx, ty);
  }
  color = materialResponse(texId, color, tx, ty, cell, lit, beam);
  if (surface) color = blendSurface(color, cell, tx >> 2, ty >> 2);
  float ao = contactAoFloor(cell);
  if (ceiling) ao = mix(1.0, ao, 0.45);
  float litC = shadeCurve(lit);
  if (surface) litC *= 0.78;   // floors get less light -> read darker than walls (atmosphere)
  color *= ao * litC;
  return applyToolBeamTint(color, beam);
}

/* ── Main fragment shader ─────────────────────────────────────── */
void main() {
  vec2 fragCoord = gl_FragCoord.xy;
  // Flip Y: WebGL has origin at bottom-left, our screen has origin at top-left
  float col = fragCoord.x;
  float row = uResolution.y - 1.0 - fragCoord.y;
  float pixelDepth = 1.0; // per-pixel depth for gl_FragDepth (0=near, 1=far)

  float horizonShift = floor(uPitch * uResolution.y);
  float HALF_H = floor(uResolution.y * 0.5) + horizonShift;

  float dirX = cos(uAngle);
  float dirY = sin(uAngle);
  float planeLen = uPlaneLen;
  float planeX = -dirY * planeLen;
  float planeY =  dirX * planeLen;

  float camX = 2.0 * col / uResolution.x - 1.0;
  float rayDX = dirX + planeX * camX;
  float rayDY = dirY + planeY * camX;

  int mapX = int(floor(uPos.x));
  int mapY = int(floor(uPos.y));
  float ddx = abs(1.0 / rayDX);
  float ddy = abs(1.0 / rayDY);
  int stepX = rayDX < 0.0 ? -1 : 1;
  int stepY = rayDY < 0.0 ? -1 : 1;
  float sdx = rayDX < 0.0 ? (uPos.x - float(mapX)) * ddx : (float(mapX) + 1.0 - uPos.x) * ddx;
  float sdy = rayDY < 0.0 ? (uPos.y - float(mapY)) * ddy : (float(mapY) + 1.0 - uPos.y) * ddy;

  int side = 0;
  bool hit = false;
  float dist = MAX_DIST;
  uint wallTexId = 0u;

  /* ── DDA loop ───────────────────────────────────────────── */
  for (int step = 0; step < MAX_STEPS; step++) {
    if (sdx < sdy) { sdx += ddx; mapX += stepX; side = 0; }
    else            { sdy += ddy; mapY += stepY; side = 1; }

    float stepDist = side == 0 ? sdx - ddx : sdy - ddy;
    if (stepDist > MAX_DIST) break;

    ivec2 wp = ivec2(wrapI(mapX), wrapI(mapY));
    uint cell = texelFetch(uCells, wp, 0).r;

    if (cell == ${Cell.WALL}u) {
      dist = stepDist;
      wallTexId = texelFetch(uWallTex, wp, 0).r;
      if (wallTexId == 0u) wallTexId = ${Tex.CONCRETE}u;
      hit = true;
      break;
    }
    if (cell == ${Cell.LIFT}u) {
      dist = stepDist;
      wallTexId = ${Tex.LIFT_DOOR}u;
      hit = true;
      break;
    }
    if (cell == ${Cell.ABYSS}u) {
      dist = stepDist;
      wallTexId = ${Tex.DARK}u;
      hit = true;
      break;
    }
    if (cell == ${Cell.DOOR}u) {
      uint rawDoorState = texelFetch(uDoorStates, wp, 0).r;
      uint doorState = rawDoorState & 127u;
      // 0=OPEN, 3=HERMETIC_OPEN — these are passable
      if (doorState != 0u && doorState != 3u) {
        dist = stepDist;
        wallTexId = doorState == 4u ? ${Tex.DOOR_HERMETIC}u : (doorState == 2u ? ${Tex.DOOR_METAL}u : ${Tex.DOOR_WOOD}u);
        hit = true;
        break;
      }
    }
  }

  if (!hit) dist = MAX_DIST;
  if (dist < 0.001) dist = 0.001;

  float lineH = uResolution.y / dist;
  // Render-only per-cell ceiling height: tier t → wall top reaches (1 + t*0.5).
  // Floor contact (drawEnd) and the walk level never move; only the top rises.
  float ceilH = 1.0 + float(texelFetch(uCeil, ivec2(wrapI(mapX), wrapI(mapY)), 0).r) * 0.5;
  float rawDrawStart = HALF_H - lineH * (ceilH - uCamHeight);
  float drawStart = max(0.0, rawDrawStart);
  float drawEnd   = min(uResolution.y - 1.0, HALF_H + lineH * uCamHeight);

  // Texture X coordinate
  float wallHitX;
  if (side == 0) wallHitX = uPos.y + dist * rayDY;
  else           wallHitX = uPos.x + dist * rayDX;
  wallHitX -= floor(wallHitX);
  int texXi = int(floor(wallHitX * TEX_F)) & (TEX_I - 1);
  if (side == 0 && rayDX < 0.0) texXi = TEX_I - 1 - texXi;
  if (side == 1 && rayDY > 0.0) texXi = TEX_I - 1 - texXi;

  float fogF = distanceFog(dist);

  vec3 pixel = fogColor(); // default = fog
  float wallDist = MAX_DIST + 10.0;
  bool wallDrawn = false;

  if (hit && row >= drawStart && row <= drawEnd) {
      wallDist = dist;
      wallDrawn = true;
      // ── Wall ──
      ivec2 hitCell = ivec2(wrapI(mapX), wrapI(mapY));
      float toolBeam = toolBeamBoost(dist, rayDX, rayDY);
      float fbWall = flashlightBoost(dist);
      vec2 lgradWall = vec2(0.0);
      float baseLitWall;
      if (uLightQuality > 0) { vec3 ls = sampleLightSmooth(uPos + vec2(rayDX, rayDY) * dist); baseLitWall = ls.x; lgradWall = ls.yz; }
      else baseLitWall = sampleLight(hitCell);
      float cellLit = min(1.0, uAmbient + baseLitWall * (1.0 - uAmbient) + fbWall + toolBeam * 0.82);
      float d = row - rawDrawStart;
      int texYi = int(floor(d / lineH * TEX_F)) & (TEX_I - 1);
      vec3 c = sampleAtlas(wallTexId, texXi, texYi).rgb;

      uint hitCellType = texelFetch(uCells, hitCell, 0).r;
      if (hitCellType == ${Cell.DOOR}u) {
        uint rawDoorState = texelFetch(uDoorStates, hitCell, 0).r;
        bool cracked = (rawDoorState & 128u) != 0u;
        if (cracked) {
          float glitch = noiseI(hitCell.x * 10 + texXi, hitCell.y * 10 + texYi, 42);
          if (glitch > 0.6) {
            c *= 0.3;
          }
        }
      }

      if (hitCellType == ${Cell.ABYSS}u) {
        float glitch = noiseI(hitCell.x + texYi, hitCell.y + texXi, int(floor(uTime * 18.0)) + 1337);
        float scan = step(0.72, fract((float(texYi) + uTime * 38.0) * 0.19 + glitch));
        vec3 dark = vec3(3.0/255.0, 5.0/255.0, 8.0/255.0);
        vec3 cut = vec3(30.0/255.0, 8.0/255.0, 46.0/255.0);
        c = mix(dark, cut, scan * (0.35 + glitch * 0.45));
      }
      c = shadeWall(wallTexId, c, hitCell, side, texXi, texYi, dist, cellLit, toolBeam);
      // Wall face normal (XY, pointing back toward the viewer) for directional light.
      vec2 wN = side == 0 ? vec2(rayDX < 0.0 ? 1.0 : -1.0, 0.0)
                          : vec2(0.0, rayDY < 0.0 ? 1.0 : -1.0);

      /* --- NORMAL MAP INJECTION --- */
      float bumpStrength = 15.0;
      if (wallTexId == ${Tex.F_WATER}u) { bumpStrength = 0.5; }
      else if (wallTexId == ${Tex.TILE_W}u || wallTexId == ${Tex.METAL}u || wallTexId == ${Tex.PIPE}u ||
               wallTexId == ${Tex.F_TILE}u || wallTexId == ${Tex.F_MARBLE_TILE}u || wallTexId == ${Tex.MARBLE}u) { bumpStrength = 3.0; }
      else if (wallTexId == ${Tex.CONCRETE}u || wallTexId == ${Tex.BRICK}u) { bumpStrength = 25.0; }
      bumpStrength *= max(0.0, 1.0 - dist / 15.0);
      wN = perturbNormal(wN, c, bumpStrength);
      /* ---------------------------- */

      float ndlWall = max(dot(wN, normalize(-vec2(rayDX, rayDY))), 0.0);
      float driveWall = clamp(fbWall + toolBeam + eyeLight(dist), 0.0, 1.0);
      c = applyLightFX(c, wallTexId, ndlWall, driveWall, lgradWall, 1.0);

      vec3 wPos = vec3(uPos.x + rayDX * dist, uPos.y + rayDY * dist, (float(row) - rawDrawStart) / lineH);
      vec3 dynWall = calculateDynamicLighting(wPos, vec3(wN, 0.0));
      c = min(vec3(1.0), c + c * dynWall);
      pixel = applyLocalFog(c, hitCell, fogF);
      pixelDepth = min(1.0, dist / MAX_DIST);
  }

  if (row > (hit ? drawEnd : HALF_H)) {
      // ── Floor ──
      float rowDist = row - HALF_H;
      if (rowDist > 0.0) {
        float currentDist = (uResolution.y * uCamHeight) / rowDist;
        if (currentDist <= MAX_DIST) {
          float floorX = uPos.x + rayDX * currentDist;
          float floorY = uPos.y + rayDY * currentDist;

          ivec2 fCell = ivec2(wrapI(int(floor(floorX))), wrapI(int(floor(floorY))));
          int ftx = int(floor(floorX * TEX_F)) & (TEX_I - 1);
          int fty = int(floor(floorY * TEX_F)) & (TEX_I - 1);
          float ff = distanceFog(currentDist);
          float toolBeam = toolBeamBoost(currentDist, rayDX, rayDY);
          float fbFloor = flashlightBoost(currentDist);
          vec2 lgradFloor = vec2(0.0);
          float baseLitFloor;
          if (uLightQuality > 0) { vec3 ls = sampleLightSmooth(vec2(floorX, floorY)); baseLitFloor = ls.x; lgradFloor = ls.yz; }
          else baseLitFloor = sampleLight(fCell);
          float fLit = min(1.0, uAmbient + baseLitFloor * (1.0 - uAmbient) + fbFloor + toolBeam * 0.82);

          uint fCellType = texelFetch(uCells, fCell, 0).r;
          if (fCellType == ${Cell.ABYSS}u) {
            vec3 fc = sampleAtlas(${Tex.F_ABYSS}u, ftx, fty).rgb;
            float scan = step(0.78, fract((float(fty) + uTime * 26.0) * 0.23));
            fc = mix(fc * 0.35, vec3(22.0/255.0, 6.0/255.0, 34.0/255.0), scan * 0.45);
            fc = shadePlane(${Tex.F_ABYSS}u, fc, fCell, ftx, fty, currentDist, fLit, toolBeam, false, false);
            pixel = applyLocalFog(fc, fCell, ff);
            pixelDepth = min(1.0, currentDist / MAX_DIST);
          } else {
            uint floorTexId = fCellType == ${Cell.WATER}u
              ? ${Tex.F_WATER}u
              : texelFetch(uFloorTex, fCell, 0).r;
            if (floorTexId == 0u) floorTexId = ${Tex.F_CONCRETE}u;
            vec3 fc = sampleAtlas(floorTexId, ftx, fty).rgb;
            fc = shadePlane(floorTexId, fc, fCell, ftx, fty, currentDist, fLit, toolBeam, false, true);
            float driveFloor = clamp(fbFloor + toolBeam + eyeLight(currentDist), 0.0, 1.0);
            fc = applyLightFX(fc, floorTexId, 0.0, driveFloor, lgradFloor, 0.0);
            fc *= computeFloorAO(fCell, vec2(floorX, floorY), uCells);

            vec3 fPos = vec3(floorX, floorY, 0.0);
            vec3 dynFloor = calculateDynamicLighting(fPos, vec3(0.0, 0.0, 1.0));
            fc = min(vec3(1.0), fc + fc * dynFloor);

            /* --- REFLECTIONS INJECTION --- */
            if (uLightQuality >= 3 && fCellType == ${Cell.WATER}u) {
              if (hit) {
                float reflectFactor = 0.4 * clamp(1.0 - (currentDist / MAX_DIST), 0.0, 1.0);
                int rXi = texXi; 
                float wallYProj = (float(HALF_H) - rowDist - rawDrawStart) / lineH;
                int rYi = int(fract(wallYProj) * float(TEX_I));
                
                if (wallYProj >= 0.0 && wallYProj <= 1.0) {
                  vec3 reflectColor = sampleAtlas(wallTexId, rXi, rYi).rgb;
                  float refBaseLitWall;
                  ivec2 hitCell = ivec2(wrapI(mapX), wrapI(mapY));
                  if (uLightQuality > 0) {
                    vec3 ls = sampleLightSmooth(uPos + vec2(rayDX, rayDY) * dist);
                    refBaseLitWall = ls.x;
                  } else {
                    refBaseLitWall = sampleLight(hitCell);
                  }
                  reflectColor *= refBaseLitWall; 
                  fc = mix(fc, reflectColor, reflectFactor);
                }
              }
            }
            /* ----------------------------- */

            pixel = applyLocalFog(fc, fCell, ff);
            pixelDepth = min(1.0, currentDist / MAX_DIST);
          }
        }
      }
  } else if (row < HALF_H) {
      // ── Ceiling ──
      float rowDist = HALF_H - row;
      if (rowDist > 0.0) {
        // Render-only variable ceiling height. worldZ(d) = uCamHeight + slope*d
        // rises with distance; march ceiling cells from near to far. The ray meets
        // a cell's ceiling plane when worldZ reaches that cell's height; a step
        // DOWN to a lower ceiling draws a vertical riser (concrete soffit) so two
        // ceiling planes never overlap. Bounded; far flat ceiling reuses the last
        // marched height. The step cap is tunable.
        float slope = rowDist / uResolution.y;
        int cmx = int(floor(uPos.x));
        int cmy = int(floor(uPos.y));
        float csdx = rayDX < 0.0 ? (uPos.x - float(cmx)) * ddx : (float(cmx) + 1.0 - uPos.x) * ddx;
        float csdy = rayDY < 0.0 ? (uPos.y - float(cmy)) * ddy : (float(cmy) + 1.0 - uPos.y) * ddy;
        float dEnter = 0.0;
        float currentDist = -1.0;
        bool isRiser = false;
        int cside = 0;
        float marchHc = 1.0;
        float prevHc = 1.0 + float(texelFetch(uCeil, ivec2(wrapI(int(floor(uPos.x))), wrapI(int(floor(uPos.y)))), 0).r) * 0.5;
        for (int cs = 0; cs < 16; cs++) {
          ivec2 mc = ivec2(wrapI(cmx), wrapI(cmy));
          marchHc = 1.0 + float(texelFetch(uCeil, mc, 0).r) * 0.5;
          if (uCamHeight + slope * dEnter >= marchHc) { currentDist = dEnter + 0.001; isRiser = true; break; }
          float dExit = min(csdx, csdy);
          if (uCamHeight + slope * dExit >= marchHc) { currentDist = (marchHc - uCamHeight) / slope; break; }
          prevHc = marchHc;
          if (csdx < csdy) { dEnter = csdx; csdx += ddx; cmx += stepX; cside = 0; }
          else             { dEnter = csdy; csdy += ddy; cmy += stepY; cside = 1; }
          if (dEnter > MAX_DIST) break;
        }
        if (currentDist < 0.0) currentDist = (marchHc - uCamHeight) / slope;
        if (currentDist <= MAX_DIST && (!wallDrawn || currentDist < wallDist)) {
          float floorX = uPos.x + rayDX * currentDist;
          float floorY = uPos.y + rayDY * currentDist;

          ivec2 cCell = ivec2(wrapI(int(floor(floorX))), wrapI(int(floor(floorY))));
          int ftx = int(floor(floorX * TEX_F)) & (TEX_I - 1);
          int fty = int(floor(floorY * TEX_F)) & (TEX_I - 1);
          float ff = distanceFog(currentDist);
          float toolBeam = toolBeamBoost(currentDist, rayDX, rayDY);
          float baseLitCeil = uLightQuality > 0 ? sampleLightSmooth(vec2(floorX, floorY)).x : sampleLight(cCell);
          float cLit = min(1.0, uAmbient + baseLitCeil * (1.0 - uAmbient) + flashlightBoost(currentDist) + toolBeam * 0.82);

          if (isRiser) {
            // Vertical concrete soffit between two ceiling heights.
            float wallHitX;
            if (cside == 0) wallHitX = uPos.y + rayDY * currentDist;
            else            wallHitX = uPos.x + rayDX * currentDist;
            wallHitX -= floor(wallHitX);
            int rtx = int(floor(wallHitX * TEX_F)) & (TEX_I - 1);
            if (cside == 0 && rayDX < 0.0) rtx = TEX_I - 1 - rtx;
            if (cside == 1 && rayDY > 0.0) rtx = TEX_I - 1 - rtx;
            float z = uCamHeight + slope * currentDist;
            int rty = int(floor((prevHc - z) * TEX_F)) & (TEX_I - 1);

            vec3 rc = sampleAtlas(${Tex.CEIL}u, rtx, rty).rgb * (0.40 + cLit * 0.42);
            rc = applyToolBeamTint(rc, toolBeam);
            pixel = applyLocalFog(rc, cCell, ff);
            pixelDepth = min(1.0, currentDist / MAX_DIST);
          } else {
          uint cCellType = texelFetch(uCells, cCell, 0).r;
          if (cCellType == ${Cell.ABYSS}u) {
            vec3 cc = sampleAtlas(${Tex.DARK}u, ftx, fty).rgb * 0.22;
            float scan = step(0.8, fract((float(ftx) + uTime * 21.0) * 0.21));
            cc = mix(cc, vec3(18.0/255.0, 5.0/255.0, 28.0/255.0), scan * 0.42);
            cc = shadePlane(${Tex.DARK}u, cc, cCell, ftx, fty, currentDist, cLit, toolBeam, true, false);
            pixel = applyLocalFog(cc, cCell, ff);
            pixelDepth = min(1.0, currentDist / MAX_DIST);
          } else {
            uint feat = texelFetch(uFeatures, cCell, 0).r;
            if (feat == ${Feature.LAMP}u) {
              vec3 cc;
              if (organicLightCell(cCell)) {
                cc = sampleAtlas(${Tex.CEIL}u, ftx, fty).rgb * (0.25 + cLit * 0.35);
                cc = applyHellLamp(cc, ftx, fty, cCell.x, cCell.y, currentDist);
                cc = applyToolBeamTint(cc, toolBeam);
              } else {
                if (uUseDynamicSky == 1) {
                  vec2 skyUv = wrapF(vec2(floorX, floorY)) / float(W_SIZE);
                  cc = texture(uDynamicSky, skyUv).rgb * uDynamicSkyTint;
                  cc *= 0.45 + cLit * 0.55;
                } else {
                  cc = sampleAtlas(${Tex.CEIL}u, ftx, fty).rgb;
                  cc = shadePlane(${Tex.CEIL}u, cc, cCell, ftx, fty, currentDist, cLit, toolBeam, true, false);
                  vec3 cPos = vec3(floorX, floorY, uCamHeight + slope * currentDist);
                  vec3 dynCeil = calculateDynamicLighting(cPos, vec3(0.0, 0.0, -1.0));
                  cc = min(vec3(1.0), cc + cc * dynCeil);
                }
                vec2 lampUv = (vec2(float(ftx), float(fty)) + 0.5) / TEX_F - vec2(0.5);
                float lampR = length(lampUv);
                float spot = 1.0 - smoothstep(0.045, 0.16, lampR);
                float halo = 1.0 - smoothstep(0.10, 0.34, lampR);
                float distGlow = max(0.0, 1.0 - currentDist * 0.16);
                vec3 lampTint = uSamosborAlert == 1 ? vec3(1.0, 0.1, 0.1) : vec3(1.0, 190.0/255.0, 74.0/255.0);
                cc = min(cc + lampTint * distGlow * (spot * 0.34 + halo * 0.075), vec3(1.0));
                if (uUseDynamicSky == 1) cc = applyToolBeamTint(cc, toolBeam);
              }
              pixel = applyLocalFog(cc, cCell, ff);
              pixelDepth = min(1.0, currentDist / MAX_DIST);
            } else if (feat == ${Feature.CANDLE}u) {
              float glow = max(0.0, 1.0 - currentDist * 0.18);
              pixel = applyLocalFog(vec3(240.0/255.0 * glow, 180.0/255.0 * glow, 50.0/255.0 * glow), cCell, ff);
              pixelDepth = min(1.0, currentDist / MAX_DIST);
            } else {
              vec3 cc;
              if (uUseDynamicSky == 1) {
                vec2 skyUv = wrapF(vec2(floorX, floorY)) / float(W_SIZE);
                cc = texture(uDynamicSky, skyUv).rgb * uDynamicSkyTint;
                cc *= 0.45 + cLit * 0.55;
              } else {
                cc = sampleAtlas(${Tex.CEIL}u, ftx, fty).rgb;
                cc = shadePlane(${Tex.CEIL}u, cc, cCell, ftx, fty, currentDist, cLit, toolBeam, true, false);
                vec3 cPos = vec3(floorX, floorY, uCamHeight + slope * currentDist);
                vec3 dynCeil = calculateDynamicLighting(cPos, vec3(0.0, 0.0, -1.0));
                cc = min(vec3(1.0), cc + cc * dynCeil);
              }
              if (uUseDynamicSky == 1) cc = applyToolBeamTint(cc, toolBeam);
              pixel = applyLocalFog(cc, cCell, ff);
              pixelDepth = min(1.0, currentDist / MAX_DIST);
            }
          }
          }
        }
      }
  }

  // Точечное внедрение Volumetric God Rays
  pixel = computeVolumetricGodRays(pixelDepth * MAX_DIST, pixel, vec2(rayDX, rayDY));
  pixel = applyLightDust(pixel, fragCoord, pixelDepth * MAX_DIST, rayDX, rayDY, distanceFog(pixelDepth * MAX_DIST));

  // ТОЧКА ВНЕДРЕНИЯ
  pixel = ACESFilm(pixel);

  // Encode depth into alpha for CPU readback (sprite clipping)
  float normDist = dist / MAX_DIST;
  fragColor = vec4(pixel, normDist);
  gl_FragDepth = clamp(1.0 - 0.1 / max(0.001, pixelDepth * MAX_DIST), 0.0, 1.0);
}
`;

/* ── Sprite vertex/fragment shaders ───────────────────────────── */
const SPRITE_VERT_SRC = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
in vec2 aPos;       // quad corner (-0.5..0.5)
in vec2 aTexCoord;  // 0..1

uniform vec2  uResolution;
uniform float uScreenX;     // sprite center X on screen
uniform float uShearX;      // X shear offset (0 at top, uShearX at bottom)
uniform float uSpriteW;     // sprite width in pixels
uniform float uSpriteH;     // sprite height in pixels
uniform float uStartY;      // top Y in pixels
uniform float uDepth;       // normalized depth for z-test
uniform vec3  uSpriteWorldPos;
uniform vec3  uShadowTip;   // x = tipScreenX, y = tipScreenY, z = tipW
uniform int   uIsShadow;    // 1=reflection, 2=blob, 3=dynamic shadow

out vec2 vTexCoord;
out float vDepth;
out vec2 vWorldPos;

void main() {
  float px = uScreenX + aPos.x * uSpriteW + (0.5 - aPos.y) * uShearX;
  float py = uStartY + (0.5 - aPos.y) * uSpriteH;

  if (uIsShadow == 3) {
    float blend = 0.5 - aPos.y; // 1.0 at top (head), 0.0 at foot (base)
    float baseW = uSpriteW;
    float baseX = uScreenX + uShearX; // foot X
    float baseY = uStartY + uSpriteH; // foot Y
    float curW = mix(baseW, uShadowTip.z, blend);
    float curX = mix(baseX, uShadowTip.x, blend);
    float curY = mix(baseY, uShadowTip.y, blend);
    px = curX + aPos.x * curW;
    py = curY;
  }

  // Convert to NDC: x: [0, res.x] → [-1, 1], y: [0, res.y] → [-1, 1] (flipped)
  float ndcX = (px / uResolution.x) * 2.0 - 1.0;
  float ndcY = 1.0 - (py / uResolution.y) * 2.0;

  gl_Position = vec4(ndcX, ndcY, 0.0, 1.0);
  vTexCoord = aTexCoord;
  vDepth = uDepth;
  vWorldPos = uSpriteWorldPos.xy;
}
`;

const SPRITE_FRAG_SRC = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

in vec2 vTexCoord;
in float vDepth;
in vec2 vWorldPos;
uniform sampler2D uSpriteTex;
uniform float uFogF;
uniform vec3  uFogColor;
uniform int   uIsProjectile;
uniform float uTime;
uniform float uSeed;
uniform int   uIsShadow;      // 1 = shadow mode: sprite silhouette as floor shadow
uniform float uShadowFloorH;  // camHeight * halfH — for per-pixel floor depth in shadow mode
uniform vec2  uResolution;

// Scene Lighting Uniforms
uniform sampler2D uLight;
uniform highp usampler2D uLightBlinks;
uniform float uAmbient;
uniform float uFlashlight;
uniform float uToolBeam;
uniform float uToolBeamRange;
uniform vec2 uPos;
uniform float uAngle;
uniform int uSamosborAlert;
uniform int uLightQuality;

// Dynamic lights and shadows
uniform highp usampler2D uCells;
uniform highp usampler2D uDoorStates;

const int W_SIZE = ${W};
const int W_SIZE_MASK = W_SIZE - 1;

int wrapI(int v) {
  return v & W_SIZE_MASK;
}

uint sampleCell(ivec2 p) {
  ivec2 wp = ivec2(wrapI(p.x), wrapI(p.y));
  return texelFetch(uCells, wp, 0).r;
}

float getBlinkPulse(ivec2 p) {
  uint freqU = texelFetch(uLightBlinks, p, 0).r;
  float freq = float(freqU);
  if (uSamosborAlert == 1) freq = 3.0; // override for red alert
  if (freq <= 0.0) return 1.0;
  
  float h = fract(sin(float(p.x) * 12.9898 + float(p.y) * 78.233) * 43758.5453);
  
  if (uSamosborAlert == 1) {
    float t = fract(uTime * 1.5 - h * 0.2); // slight stagger, sharp strobe
    return (t < 0.4) ? 1.0 : 0.2;
  }
  
  // Broken fluorescent stutter
  float t = uTime * freq * 4.0 + h * 100.0;
  float n = fract(sin(floor(t)) * 137.5453);
  return (n > 0.3) ? 1.0 : 0.1;
}

float flashlightBoost(float dist) {
  if (uFlashlight <= 0.0) return 0.0;
  float t = max(0.0, 1.0 - dist / 11.5);
  return uFlashlight * t * t * 0.95;
}

float toolBeamBoost(float dist, float rayDX, float rayDY) {
  if (uToolBeam <= 0.0 || uToolBeamRange <= 0.0) return 0.0;
  vec2 forward = vec2(cos(uAngle), sin(uAngle));
  vec2 delta = vec2(rayDX, rayDY) * dist;
  float along = dot(delta, forward);
  if (along <= 0.35 || along > uToolBeamRange) return 0.0;
  float side = abs(dot(delta, vec2(-forward.y, forward.x)));
  float halfWidth = min(1.05, 0.36 + along * 0.055);
  float edge = 1.0 - smoothstep(halfWidth * 0.68, halfWidth, side);
  float falloff = 1.0 - along / uToolBeamRange;
  float flicker = 0.94 + 0.06 * sin(uTime * 57.0 + along * 3.1);
  return uToolBeam * edge * (0.24 + falloff * 0.76) * flicker;
}

float eyeLight(float dist) {
  return (1.0 - smoothstep(0.5, 11.0, dist)) * 0.22;
}

uint sampleDoor(ivec2 p) {
  ivec2 wp = ivec2(wrapI(p.x), wrapI(p.y));
  return texelFetch(uDoorStates, wp, 0).r;
}

bool lightBoundaryAt(ivec2 p) {
  uint cell = sampleCell(p);
  uint rawDoorState = cell == ${Cell.DOOR}u ? sampleDoor(p) : 0u;
  uint doorState = rawDoorState & 127u;
  // Wall, Lift, Abyss, or closed door block light
  if (cell == ${Cell.WALL}u || cell == ${Cell.LIFT}u || cell == ${Cell.ABYSS}u) return true;
  if (cell != ${Cell.DOOR}u) return false;
  return doorState != 0u && doorState != 3u;
}

out vec4 fragColor;

${COMMON_LIGHTING_SRC}

/* ── procedural flame noise ── */
float fHash(float n) { return fract(sin(n) * 43758.5453123); }
float fNoise(vec2 p, float s) {
  vec2 ip = floor(p), fp = fract(p);
  fp = fp * fp * (3.0 - 2.0 * fp);
  float n = ip.x + ip.y * 157.0 + s * 113.0;
  return mix(mix(fHash(n), fHash(n+1.0), fp.x),
             mix(fHash(n+157.0), fHash(n+158.0), fp.x), fp.y);
}
float fFbm(vec2 p, float s) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += fNoise(p, s) * a; p *= 2.13; a *= 0.48; s += 137.0;
  }
  return v;
}

void main() {
  /* ── Reflection (uIsShadow == 1) ── */
  if (uIsShadow == 1) {
    vec4 sc = texture(uSpriteTex, vec2(vTexCoord.x, vTexCoord.y));
    if (sc.a < 0.5) discard;
    float raycasterRow = uResolution.y - gl_FragCoord.y;
    float belowHorizon = raycasterRow - vDepth;
    if (belowHorizon <= 0.5) discard;
    float floorDist = uShadowFloorH / belowHorizon;
    gl_FragDepth = clamp(1.0 - 0.1 / max(0.1, floorDist), 0.0, 1.0) - 0.0004;
    float fade = smoothstep(1.0, 0.0, vTexCoord.y);
    float a = uSeed * fade * (1.0 - uFogF * 0.85);
    vec3 tintColor = mix(sc.rgb, vec3(0.05, 0.1, 0.15), 0.6);
    fragColor = vec4(tintColor, a * sc.a);
    return;
  }

  /* ── Drop Shadow (uIsShadow == 2) ── */
  if (uIsShadow == 2) {
    vec2 uv = vTexCoord - vec2(0.5, 0.5);
    float d = length(uv);
    float a = smoothstep(0.5, 0.1, d);
    if (a < 0.05) discard;
    gl_FragDepth = vDepth - 0.0004;
    fragColor = vec4(0.0, 0.0, 0.0, a * uSeed * (1.0 - uFogF * 0.85));
    return;
  }

  /* ── True Dynamic Shadow (uIsShadow == 3) ── */
  if (uIsShadow == 3) {
    vec4 sc = texture(uSpriteTex, vTexCoord);
    if (sc.a < 0.5) discard;
    
    float raycasterRow = uResolution.y - gl_FragCoord.y;
    float belowHorizon = raycasterRow - vDepth;
    if (belowHorizon <= 0.5) discard;
    float floorDist = uShadowFloorH / belowHorizon;
    gl_FragDepth = clamp(1.0 - 0.1 / max(0.1, floorDist), 0.0, 1.0) - 0.0004;
    float fade = smoothstep(0.0, 0.9, vTexCoord.y); // fade out towards tip (y=0)
    fragColor = vec4(0.0, 0.0, 0.0, uSeed * sc.a * fade * (1.0 - uFogF * 0.85));
    return;
  }

  /* ── Procedural flame tongue (uIsProjectile == 2) ── */
  if (uIsProjectile == 2) {
    vec2 uv = vTexCoord - 0.5;

    // Quick circular discard to avoid wasting fragments on corners
    float rawR = length(uv);
    if (rawR > 0.48) discard;

    // Flame widens at base (uv.y<0), tapers at top (uv.y>0)
    float taper = 1.0 + uv.y * 0.8;
    float dist = length(uv * vec2(2.5 * taper, 1.6));

    // Animated noise scrolling upward — unique per projectile
    float t = uTime * 7.0;
    float sd = uSeed;
    vec2 nUV = uv * 6.0 + vec2(sin(sd * 7.13) * 10.0, -t);

    float n1 = fFbm(nUV, sd);
    float n2 = fFbm(nUV * 1.7 + 3.7, sd + 77.0);
    float n3 = fNoise(nUV * 4.5 + 1.3, sd + 200.0);

    // Core + noise − strong radial falloff
    float core = max(0.0, 1.0 - dist * 1.3);
    float flame = core * 1.2 + n1 * 0.45 + n2 * 0.25 - dist * 0.65;
    flame += n3 * 0.1;

    // Aggressive discard — anything dim gets tossed
    if (flame < 0.15) discard;

    // Temperature → color: hot white → yellow → orange → dark red
    float heat = clamp(flame * 1.5, 0.0, 1.0);
    vec3 col;
    if (heat > 0.75) {
      col = mix(vec3(1.0, 0.9, 0.4), vec3(1.0, 1.0, 0.9), (heat - 0.75) * 4.0);
    } else if (heat > 0.42) {
      col = mix(vec3(1.0, 0.45, 0.05), vec3(1.0, 0.9, 0.4), (heat - 0.42) / 0.33);
    } else {
      col = mix(vec3(0.6, 0.08, 0.0), vec3(1.0, 0.45, 0.05), heat / 0.42);
    }

    float alpha = smoothstep(0.15, 0.4, flame);
    float glow = 1.0 - uFogF * 0.15;  // flames punch through fog hard
    gl_FragDepth = vDepth;
    fragColor = vec4(col * alpha * glow * 2.2, 1.0);
    return;
  }

  vec4 c = texture(uSpriteTex, vec2(vTexCoord.x, 1.0 - vTexCoord.y));
  if (c.a < 0.5) discard;
  gl_FragDepth = vDepth;

  vec3 rgb = c.rgb;
  if (uIsProjectile == 1) {
    // Additive glow: boost brightness, resist fog heavily
    float glow = 1.0 - uFogF * 0.3;
    rgb *= glow * 1.5;
    // Pre-multiplied additive: write bright color with full alpha
    fragColor = vec4(rgb, 1.0);
  } else {
    // 1. Calculate lighting at base of sprite
    ivec2 baseCell = ivec2(wrapI(int(floor(vWorldPos.x))), wrapI(int(floor(vWorldPos.y))));
    float baseLight = texelFetch(uLight, baseCell, 0).r * getBlinkPulse(baseCell);
    
    vec2 delta = vWorldPos - uPos;
    float dist = length(delta);
    float rayDX = dist > 0.0 ? delta.x / dist : 0.0;
    float rayDY = dist > 0.0 ? delta.y / dist : 0.0;
    
    float fb = flashlightBoost(dist);
    float tb = toolBeamBoost(dist, rayDX, rayDY);
    float el = eyeLight(dist);
    
    // 2. Combine into cellLit
    float cellLit = min(1.0, uAmbient + baseLight * (1.0 - uAmbient) + fb + tb * 0.82 + el);
    
    // Apply shadeCurve (from webgl.ts)
    cellLit = pow(clamp(cellLit, 0.0, 1.0), 1.32);
    
    // 3. Modulate RGB
    rgb *= cellLit;

    rgb = mix(rgb, uFogColor, uFogF);
    
    // Normal for sprite: we assume it faces the camera, but since lighting is 2D-ish
    // let's just use an upward/camera-facing normal.
    // Actually, a simple up-normal vec3(0,0,1) works for omni lights.
    vec3 wPos = vec3(vWorldPos.x, vWorldPos.y, 0.5); // approximate mid-height
    vec3 dynLight = calculateDynamicLighting(wPos, vec3(0.0, 0.0, 1.0));
    rgb = min(vec3(1.0), rgb + rgb * dynLight);
    
    fragColor = vec4(rgb, c.a);
  }
}
`;

/* ── Blit shader (render low-res FBO to screen) ───────────────── */
const BLIT_VERT_SRC = /* glsl */ `#version 300 es
precision highp float;
in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const BLIT_FRAG_SRC = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform float uGlitch;
uniform float uTime;
uniform float uSamosborActive; // 1.0 during samosbor
uniform int uSamosborStyle; // data-driven SamosborScreenFxId code
uniform float uSamosborPost;
uniform vec3 uSamosborTint;
uniform float uScreenInterference;
uniform sampler2D uBloomTex;   // blurred bright-pass glow (additive)
uniform float uBloomStrength;  // 0 disables bloom entirely
out vec4 fragColor;

/* ── Noise helpers ────────────────────────────────────────────── */
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = clamp(vUV, vec2(0.001), vec2(0.999));
  float t = uTime;
  float interferenceMode = clamp(uScreenInterference, 0.0, 1.0);
  float baselineStrength = interferenceMode * 0.34;
  float glitchStrength = clamp(uGlitch, 0.0, 1.0);
  float samosborStrength = uSamosborActive > 0.5 ? clamp(uSamosborPost, 0.0, 1.0) : 0.0;
  float postStrength = max(max(glitchStrength, samosborStrength), baselineStrength);

  if (postStrength <= 0.001) {
    vec3 baseColor = texture(uTex, vUV).rgb;
    baseColor += texture(uBloomTex, vUV).rgb * uBloomStrength;
    fragColor = vec4(clamp(baseColor, 0.0, 1.0), 1.0);
    return;
  }

  /* ── State distortion: weak neuro-interface drift, stronger only for hazards ── */
  if (glitchStrength > 0.0 || baselineStrength > 0.0) {
    float driftStrength = max(glitchStrength, baselineStrength * 0.72);
    float slowWave = sin(uv.y * 2.7 + t * 0.5) * 0.0008;
    float fastWiggle = sin(uv.y * 23.0 + t * 3.1) * 0.0004;
    uv.x += (slowWave + fastWiggle) * driftStrength;
  }

  /* ── Samosbor glitch: coherent band drift without expensive per-pixel hashes ── */
  if (glitchStrength > 0.0) {
    float bandId = floor(uv.y * 42.0);
    float tick = floor(t * 7.0);
    float bandPhase = fract(bandId * 0.6180339 + tick * 0.173);
    float bandMask = step(0.92 - glitchStrength * 0.9, bandPhase);
    float fineMask = step(0.985 - glitchStrength * 0.22, fract(uv.y * 180.0 + t * 0.85));
    float shift = ((bandPhase - 0.5) * bandMask * 0.032 + fineMask * 0.006) * glitchStrength;
    uv.x += shift;
    uv.y += (fract(bandId * 0.37 + tick * 0.29) - 0.5) * bandMask * glitchStrength * 0.0035;
  }

  vec2 sampleUv = clamp(uv, vec2(0.001), vec2(0.999));
  vec3 color = texture(uTex, sampleUv).rgb;
  float filterStrength = max(glitchStrength, baselineStrength);
  if (filterStrength > 0.0) {
    float ca = baselineStrength * 0.0011 + glitchStrength * 0.004 + sin(t * 1.3) * 0.0002 * filterStrength;
    vec2 caOff = vec2(ca, ca * 0.3);
    vec4 cL = texture(uTex, clamp(sampleUv + caOff, vec2(0.001), vec2(0.999)));
    vec4 cC = texture(uTex, sampleUv);
    vec4 cR = texture(uTex, clamp(sampleUv - caOff, vec2(0.001), vec2(0.999)));
    color = vec3(cL.r, cC.g, cR.b);

    float bleedStr = 0.24 * baselineStrength + 0.22 * glitchStrength;
    vec3 bleed = (cL.rgb + cC.rgb + cR.rgb) / 3.0;
    color = mix(color, bleed, bleedStr);

    float scanY = gl_FragCoord.y;
    float scanWave = 0.5 + 0.5 * sin(scanY * 3.14159265);
    float scanNoise = hash21(vec2(floor(scanY / 4.0), floor(t * 8.0)));
    float scanDark = (0.016 + scanNoise * 0.014) * filterStrength + glitchStrength * 0.045;
    color *= 1.0 - scanWave * scanDark;
    color *= 1.0 + sin(scanY * 0.19 + t * 1.4) * 0.006 * filterStrength;

    float grain = (hash21(vUV * 680.0 + fract(t * 8.3)) - 0.5) * 0.055;
    grain += (hash21(vUV * 220.0 + fract(t * 4.9 + 1.0)) - 0.5) * 0.018;
    color += grain * filterStrength;

    vec2 vc = uv - 0.5;
    float vig = 1.0 - dot(vc, vc) * 0.6;
    color *= mix(1.0, vig, min(0.55, filterStrength));

    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    vec3 phosphor = mix(vec3(luma), color, 0.78) * vec3(0.96, 1.025, 0.99);
    color = mix(color, phosphor, 0.18 * filterStrength);
    color = (color - 0.5) * (1.0 + 0.035 * filterStrength) + 0.5;
    color += vec3(0.0, 0.004, 0.002) * filterStrength;
  }

  /* ── Samosbor: cheap variant-shaped post grade ──────────────── */
  if (uSamosborActive > 0.5 && samosborStrength > 0.01) {
    float post = samosborStrength;
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    float desat = uSamosborStyle == 6 ? 0.48 : (uSamosborStyle == 5 ? 0.12 : 0.0);
    float tintMix = uSamosborStyle == 6 ? 0.13 : 0.06;
    color = mix(color, vec3(luma), desat * post);
    color = mix(color, uSamosborTint, tintMix * post);

    vec2 tile = floor(vUV * vec2(72.0, 46.0));
    float gridNoise = fract(tile.x * 0.7548777 + tile.y * 0.5698403 + floor(t * 5.0) * 0.137) - 0.5;
    float scanPulse = step(0.972, fract(gl_FragCoord.y * 0.067 + t * 1.6));
    float stylePulse = (uSamosborStyle == 2 || uSamosborStyle == 4 || uSamosborStyle == 6) ? 1.25 : 0.85;
    color += uSamosborTint * (gridNoise * 0.08 + scanPulse * 0.045 * stylePulse) * post;
  }

  color += texture(uBloomTex, vUV).rgb * uBloomStrength;
  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

/* ── Bloom prefilter: extract bright pixels (soft-knee bright pass) ─ */
const BLOOM_PREFILTER_FRAG_SRC = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;     // full-res scene color (LDR)
uniform vec2 uTexel;        // 1.0 / sceneResolution
uniform float uThreshold;   // luminance threshold for glow
out vec4 fragColor;

void main() {
  // 4-tap box downsample reduces shimmer/fireflies before blurring.
  vec3 c = texture(uTex, vUV + uTexel * vec2(-1.0, -1.0)).rgb
         + texture(uTex, vUV + uTexel * vec2( 1.0, -1.0)).rgb
         + texture(uTex, vUV + uTexel * vec2(-1.0,  1.0)).rgb
         + texture(uTex, vUV + uTexel * vec2( 1.0,  1.0)).rgb;
  c *= 0.25;
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // Soft knee so glow ramps in smoothly rather than hard-clipping.
  float knee = 0.18;
  float soft = clamp((luma - uThreshold + knee) / (2.0 * knee), 0.0, 1.0);
  float contrib = max(soft * soft, max(luma - uThreshold, 0.0) / max(luma, 1e-4));
  fragColor = vec4(c * contrib, 1.0);
}
`;

/* ── Bloom blur: separable 9-tap Gaussian (ping-pong H then V) ─── */
const BLOOM_BLUR_FRAG_SRC = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uDir;   // (texel,0) horizontal or (0,texel) vertical, in bloom resolution
out vec4 fragColor;

void main() {
  float w0 = 0.227027;
  float w1 = 0.1945946;
  float w2 = 0.1216216;
  float w3 = 0.054054;
  float w4 = 0.016216;
  vec3 result = texture(uTex, vUV).rgb * w0;
  result += (texture(uTex, vUV + uDir * 1.0).rgb + texture(uTex, vUV - uDir * 1.0).rgb) * w1;
  result += (texture(uTex, vUV + uDir * 2.0).rgb + texture(uTex, vUV - uDir * 2.0).rgb) * w2;
  result += (texture(uTex, vUV + uDir * 3.0).rgb + texture(uTex, vUV - uDir * 3.0).rgb) * w3;
  result += (texture(uTex, vUV + uDir * 4.0).rgb + texture(uTex, vUV - uDir * 4.0).rgb) * w4;
  fragColor = vec4(result, 1.0);
}
`;

/* ── Blood particle shaders (flat-color quads in screen space) ── */
const PARTICLE_VERT_SRC = /* glsl */ `#version 300 es
precision highp float;
in vec2 aPos;       // quad corner (-0.5..0.5)
in vec4 aParticle;  // screenX, screenY, size, depth
in vec4 aColor;
uniform vec2  uResolution;
out float vDepth;
out vec4 vColor;
out vec2 vLocal;
void main() {
  float px = aParticle.x + aPos.x * aParticle.z;
  float py = aParticle.y + aPos.y * aParticle.z;
  float ndcX = (px / uResolution.x) * 2.0 - 1.0;
  float ndcY = 1.0 - (py / uResolution.y) * 2.0;
  gl_Position = vec4(ndcX, ndcY, 0.0, 1.0);
  vDepth = aParticle.w;
  vColor = aColor;
  vLocal = aPos;
}
`;

const PARTICLE_FRAG_SRC = /* glsl */ `#version 300 es
precision highp float;
in float vDepth;
in vec4 vColor;
in vec2 vLocal;
out vec4 fragColor;
void main() {
  float d = length(vLocal);
  if (d > 0.5) discard;
  float edge = 1.0 - smoothstep(0.18, 0.5, d);
  gl_FragDepth = vDepth;
  fragColor = vec4(vColor.rgb, vColor.a * edge);
}
`;

/* ── WebGL State ──────────────────────────────────────────────── */
interface GLState {
  gl: WebGL2RenderingContext;
  // Raycaster
  rayProgram: WebGLProgram;
  rayVAO: WebGLVertexArrayObject;
  rayFBO: WebGLFramebuffer;
  rayColorTex: WebGLTexture;
  rayDepthTex: WebGLTexture;
  // Blit
  blitProgram: WebGLProgram;
  blitVAO: WebGLVertexArrayObject;
  // Bloom (additive screen-space glow)
  bloomPrefilterProgram: WebGLProgram;
  bloomPrefilterUniforms: Record<string, WebGLUniformLocation | null>;
  bloomBlurProgram: WebGLProgram;
  bloomBlurUniforms: Record<string, WebGLUniformLocation | null>;
  bloomVAOPrefilter: WebGLVertexArrayObject;
  bloomVAOBlur: WebGLVertexArrayObject;
  bloomTexA: WebGLTexture;
  bloomFBO_A: WebGLFramebuffer;
  bloomTexB: WebGLTexture;
  bloomFBO_B: WebGLFramebuffer;
  // Particle rendering
  particleProgram: WebGLProgram;
  particleVAO: WebGLVertexArrayObject;
  particleInstanceBuffer: WebGLBuffer;
  particleColorBuffer: WebGLBuffer;
  particleInstanceData: Float32Array;
  particleColorData: Float32Array;
  particleUniforms: Record<string, WebGLUniformLocation | null>;
  // Data textures
  cellsTex: WebGLTexture;
  wallTexTex: WebGLTexture;
  floorTexTex: WebGLTexture;
  featuresTex: WebGLTexture;
  ceilTex: WebGLTexture;
  lightTex: WebGLTexture;
  lightBlinksTex: WebGLTexture;
  fogTex: WebGLTexture;
  doorStatesTex: WebGLTexture;
  atlasTex: WebGLTexture;
  dynamicSkyTex: WebGLTexture;
  dynamicSkyW: number;
  dynamicSkyH: number;
  // Sprite rendering
  spriteProgram: WebGLProgram;
  spriteVAO: WebGLVertexArrayObject;
  spriteTextures: WebGLTexture[];   // individual sprite textures
  spriteGroundInsets: Float32Array;  // transparent bottom rows per sprite, normalized 0..1
  proceduralSpriteTextures: Map<number, ProceduralSpriteCacheEntry>;
  itemSpriteTextures: Map<string, ProceduralSpriteCacheEntry>;
  proceduralSpriteUseTick: number;
  // Surface marks
  surfaceAtlasTex: WebGLTexture;    // 512×512 RGBA atlas of 16×16 overlays
  surfaceIdxTex: WebGLTexture;      // W×W R16UI cell→slot mapping
  surfacePixels: Uint8Array;
  surfaceIndex: Uint16Array;
  surfaceSlotByCell: Map<number, number>;
  surfaceCellBySlot: Int32Array;
  surfaceIndexPatch: Uint16Array;
  surfaceVersion: number;
  surfaceUploadMs: number;
  surfaceCamTileX: number;
  surfaceCamTileY: number;
  cellVersion: number;
  wallTexVersion: number;
  floorTexVersion: number;
  featureVersion: number;
  ceilHeightVersion: number;
  lightVersion: number;
  lightBlinksVersion: number;
  fogVersion: number;
  doorStatesData: Uint8Array;
  // Uniforms cache
  rayUniforms: Record<string, WebGLUniformLocation | null>;
  blitUniforms: Record<string, WebGLUniformLocation | null>;
  spriteUniforms: Record<string, WebGLUniformLocation | null>;
  
  dynamicLightCount: number;
  dynamicLightsPos: Float32Array;
  dynamicLightsColor: Float32Array;
  dynamicLightsRadius: Float32Array;

  shadowCasterCount: number;
  shadowCasters: Float32Array; // 32 * 4 floats (x, y, height, radius)

  meshPass?: MeshPassHandle;
}

interface ProceduralSpriteCacheEntry {
  texture: WebGLTexture;
  usedAt: number;
}

let glState: GLState | null = null;
let activeDynamicSky: DynamicSkyTexture | null = null;
const visibleEntities: (Entity | null)[] = [];
const visibleDx: number[] = [];
const visibleDy: number[] = [];
const visibleDist: number[] = [];
const visibleOrder: number[] = [];
const visibleSpriteIdx: number[] = [];
const visibleSpriteScale: number[] = [];
const visibleSpriteZ: number[] = [];
const visibleProjectile: number[] = [];
const visibleSeed: number[] = [];
const visibleSource: VisibleSpriteSource[] = [];

/* ── Shader compilation helpers ───────────────────────────────── */
function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${log}`);
  }
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`Program link error: ${log}`);
  }
  return prog;
}

function createProgram(gl: WebGL2RenderingContext, vSrc: string, fSrc: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fSrc);
  const prog = linkProgram(gl, vs, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return prog;
}

function getUniforms(gl: WebGL2RenderingContext, prog: WebGLProgram, names: string[]): Record<string, WebGLUniformLocation | null> {
  const u: Record<string, WebGLUniformLocation | null> = {};
  for (const n of names) u[n] = gl.getUniformLocation(prog, n);
  return u;
}

function planeLenForFov(fovRadians: number): number {
  const fov = Number.isFinite(fovRadians) ? fovRadians : DEFAULT_FOV_RADIANS;
  const clamped = Math.max(Math.PI / 3, Math.min((110 * Math.PI) / 180, fov));
  return Math.tan(clamped * 0.5);
}

function detailDensity01(row: ResolvedVisualDetailFamily | undefined): number {
  if (!row || !Number.isFinite(row.density)) return 0;
  return Math.max(0, Math.min(1, row.density / 255));
}

function uploadVisualDetailSlot(
  gl: WebGL2RenderingContext,
  uniforms: Record<string, WebGLUniformLocation | null>,
  slotName: string,
  colorName: string,
  row: ResolvedVisualDetailFamily | undefined,
): void {
  if (!row) {
    gl.uniform4f(uniforms[slotName], 0, 0, 1, 0);
    gl.uniform3f(uniforms[colorName], 0, 0, 0);
    return;
  }
  gl.uniform4f(
    uniforms[slotName],
    row.familyCode,
    detailDensity01(row),
    Math.max(0.1, Math.min(4, row.scale)),
    row.seed & 0xffff,
  );
  gl.uniform3f(
    uniforms[colorName],
    row.color[0] / 255,
    row.color[1] / 255,
    row.color[2] / 255,
  );
}

function uploadVisualDetailUniforms(
  gl: WebGL2RenderingContext,
  uniforms: Record<string, WebGLUniformLocation | null>,
  profile: ResolvedVisualDetailProfile | undefined,
): void {
  const resolved = profile ?? EMPTY_RESOLVED_VISUAL_DETAIL_PROFILE;
  gl.uniform1i(uniforms['uDetailFloorCount'], Math.min(2, resolved.floorFamilies.length));
  uploadVisualDetailSlot(gl, uniforms, 'uDetailFloor0', 'uDetailFloorColor0', resolved.floorFamilies[0]);
  uploadVisualDetailSlot(gl, uniforms, 'uDetailFloor1', 'uDetailFloorColor1', resolved.floorFamilies[1]);
  gl.uniform1i(uniforms['uDetailWallCount'], Math.min(2, resolved.wallFamilies.length));
  uploadVisualDetailSlot(gl, uniforms, 'uDetailWall0', 'uDetailWallColor0', resolved.wallFamilies[0]);
  uploadVisualDetailSlot(gl, uniforms, 'uDetailWall1', 'uDetailWallColor1', resolved.wallFamilies[1]);
  uploadVisualDetailSlot(gl, uniforms, 'uDetailLightDust', 'uDetailLightDustColor', resolved.lightDust);
}

function uploadVisualSurfaceUniforms(
  gl: WebGL2RenderingContext,
  uniforms: Record<string, WebGLUniformLocation | null>,
  profile: ResolvedVisualSurfaceProfile | undefined,
): void {
  const resolved = profile ?? EMPTY_RESOLVED_VISUAL_SURFACE_PROFILE;
  gl.uniform4f(
    uniforms['uSurfaceProfileA'],
    resolved.floorPatternCode,
    resolved.wallBandCode,
    resolved.ceilingPatternCode,
    resolved.trimCode,
  );
  gl.uniform4f(
    uniforms['uSurfaceProfileB'],
    Math.max(0, Math.min(1, resolved.grime)),
    Math.max(0, Math.min(1, resolved.seamStrength)),
    Math.max(0, Math.min(1, resolved.lightPanelChance)),
    Math.max(0, Math.min(1, resolved.ventChance)),
  );
  gl.uniform1f(uniforms['uSurfaceProfileSeed'], resolved.seed & 0xffff);
}

function meshPassContext(
  world: World,
  camera: CameraView,
  time: number,
  fogDensity: number,
  fogColor: readonly [number, number, number],
  profile: ResolvedVisualGeometryProfile,
  ambient: number,
  state: GLState,
  samosborActive: boolean,
): MeshPassContext {
  return {
    world,
    camera,
    floorKey: profile.key,
    seed: profile.seed,
    time,
    fogDensity,
    fogColor,
    ambient,
    lightTex: state.lightTex,
    lightBlinksTex: state.lightBlinksTex,
    samosborAlert: samosborActive,
    cellsTex: state.cellsTex,
    doorStatesTex: state.doorStatesTex,
    dynamicLightCount: state.dynamicLightCount,
    dynamicLightsPos: state.dynamicLightsPos,
    dynamicLightsColor: state.dynamicLightsColor,
    dynamicLightsRadius: state.dynamicLightsRadius,
    mode: profile.mode,
    profile,
  };
}

function updateAndRenderMeshPass(
  state: GLState,
  world: World,
  camera: CameraView,
  time: number,
  fogDensity: number,
  fogColor: readonly [number, number, number],
  profile: ResolvedVisualGeometryProfile,
  ambient: number,
  samosborActive: boolean,
): void {
  if (!state.meshPass) return;
  const context = meshPassContext(world, camera, time, fogDensity, fogColor, profile, ambient, state, samosborActive);
  const stats = state.meshPass.update(context);
  lastRenderSceneDebugStats.meshEnabled = stats.enabled;
  lastRenderSceneDebugStats.meshInstances = stats.visibleInstances;
  lastRenderSceneDebugStats.meshTriangles = stats.submittedTriangles;
  lastRenderSceneDebugStats.meshDrawCalls = stats.drawCalls;
  if (stats.enabled) state.meshPass.render(state.gl, context);
}

function createOptionalMeshPass(gl: WebGL2RenderingContext): MeshPassHandle | undefined {
  try {
    return createMeshPass(gl);
  } catch (error) {
    console.warn('Mesh pass disabled:', error);
    return undefined;
  }
}

/* ── Create fullscreen quad VAO ───────────────────────────────── */
function createQuadVAO(gl: WebGL2RenderingContext, prog: WebGLProgram): WebGLVertexArrayObject {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  // Two triangles covering [-1,1]
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,  1, -1,  -1, 1,
    -1,  1,  1, -1,   1, 1,
  ]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return vao;
}

/* ── Create data texture (R8UI or R32F) ───────────────────────── */
function createDataTexR8UI(gl: WebGL2RenderingContext, w: number, h: number, data: Uint8Array): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, w, h, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, data);
  return tex;
}

function createDataTexR32F(gl: WebGL2RenderingContext, w: number, h: number, data: Float32Array): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, data);
  return tex;
}

function bindTextureUnit(gl: WebGL2RenderingContext, tex: WebGLTexture, loc: WebGLUniformLocation | null, unit: number): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(loc, unit);
}

function createDynamicSkyTex(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([9, 12, 20, 255]));
  return tex;
}

function uploadDynamicSkyTexture(): void {
  if (!glState) return;
  const { gl } = glState;
  gl.bindTexture(gl.TEXTURE_2D, glState.dynamicSkyTex);
  const sky = activeDynamicSky;
  if (!sky) {
    if (glState.dynamicSkyW !== 1 || glState.dynamicSkyH !== 1) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([9, 12, 20, 255]));
      glState.dynamicSkyW = 1;
      glState.dynamicSkyH = 1;
    }
    return;
  }

  const pixels = new Uint8Array(sky.pixels.buffer, sky.pixels.byteOffset, sky.pixels.byteLength);
  if (glState.dynamicSkyW !== sky.width || glState.dynamicSkyH !== sky.height) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, sky.width, sky.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    glState.dynamicSkyW = sky.width;
    glState.dynamicSkyH = sky.height;
  } else {
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, sky.width, sky.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  }
  sky.dirty = false;
}

export function setDynamicSkyTexture(sky: DynamicSkyTexture | null): void {
  activeDynamicSky = sky;
  uploadDynamicSkyTexture();
}

/* ── Build texture atlas from TexData[] ───────────────────────── */
function buildAtlas(gl: WebGL2RenderingContext, textures: TexData[]): WebGLTexture {
  const count = textures.length;
  const rows = Math.ceil(count / ATLAS_COLS);
  const atlasW = ATLAS_COLS * ATLAS_TEX_SIZE;
  const atlasH = rows * ATLAS_TEX_SIZE;
  // TexData is Uint32Array in 0xAABBGGRR format — need to convert to RGBA8
  const pixels = new Uint8Array(atlasW * atlasH * 4);

  for (let i = 0; i < count; i++) {
    const td = textures[i];
    const ax = (i % ATLAS_COLS) * ATLAS_TEX_SIZE;
    const ay = Math.floor(i / ATLAS_COLS) * ATLAS_TEX_SIZE;
    for (let y = 0; y < ATLAS_TEX_SIZE; y++) {
      for (let x = 0; x < ATLAS_TEX_SIZE; x++) {
        const c = td[y * ATLAS_TEX_SIZE + x];
        const dstIdx = ((ay + y) * atlasW + (ax + x)) * 4;
        pixels[dstIdx + 0] = c & 0xFF;            // R
        pixels[dstIdx + 1] = (c >> 8) & 0xFF;     // G
        pixels[dstIdx + 2] = (c >> 16) & 0xFF;    // B
        pixels[dstIdx + 3] = 255;                  // A
      }
    }
  }

  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, atlasW, atlasH, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return tex;
}

function createSpriteTexture(gl: WebGL2RenderingContext, spr: SpriteData): WebGLTexture {
  const srcSize = Math.sqrt(spr.length) | 0;
  const targetSize = 128;
  const pixels = new Uint8Array(targetSize * targetSize * 4);

  for (let y = 0; y < targetSize; y++) {
    const sy = Math.floor((y / targetSize) * srcSize);
    for (let x = 0; x < targetSize; x++) {
      const sx = Math.floor((x / targetSize) * srcSize);
      const c = spr[sy * srcSize + sx];
      const idx = (y * targetSize + x) * 4;
      pixels[idx + 0] = c & 0xFF;
      pixels[idx + 1] = (c >> 8) & 0xFF;
      pixels[idx + 2] = (c >> 16) & 0xFF;
      pixels[idx + 3] = (c >>> 24) & 0xFF;
    }
  }

  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, targetSize, targetSize, 0,
    gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return tex;
}

function spriteGroundInset(sprite: SpriteData): number {
  const size = Math.sqrt(sprite.length) | 0;
  if (size <= 0 || size * size !== sprite.length) return 0;
  for (let y = size - 1; y >= 0; y--) {
    const row = y * size;
    for (let x = 0; x < size; x++) {
      if ((sprite[row + x] >>> 24) !== 0) {
        return (size - 1 - y) / size;
      }
    }
  }
  return 0;
}

function buildSpriteGroundInsets(sprites: SpriteData[]): Float32Array {
  const insets = new Float32Array(sprites.length);
  for (let i = 0; i < sprites.length; i++) insets[i] = spriteGroundInset(sprites[i]);
  return insets;
}

/* ── Build individual sprite textures ─────────────────────────── */
function buildSpriteTextures(gl: WebGL2RenderingContext, sprites: SpriteData[]): WebGLTexture[] {
  const result: WebGLTexture[] = [];
  for (const spr of sprites) result.push(createSpriteTexture(gl, spr));
  return result;
}

function usesStaticObjectGroundInset(source: VisibleSpriteSource): boolean {
  return source === VisibleSpriteSource.FEATURE
    || source === VisibleSpriteSource.CONTAINER;
}

function trimProceduralSpriteCache(): void {
  if (!glState || glState.proceduralSpriteTextures.size <= PROCEDURAL_SPRITE_CACHE_MAX) return;
  const { gl, proceduralSpriteTextures } = glState;
  while (proceduralSpriteTextures.size > PROCEDURAL_SPRITE_CACHE_TARGET) {
    let oldestKey = 0;
    let oldestUse = Number.MAX_SAFE_INTEGER;
    for (const [key, entry] of proceduralSpriteTextures) {
      if (entry.usedAt < oldestUse) {
        oldestUse = entry.usedAt;
        oldestKey = key;
      }
    }
    const oldest = proceduralSpriteTextures.get(oldestKey);
    if (!oldest) break;
    gl.deleteTexture(oldest.texture);
    proceduralSpriteTextures.delete(oldestKey);
  }
}

function trimItemSpriteCache(): void {
  if (!glState || glState.itemSpriteTextures.size <= ITEM_SPRITE_CACHE_MAX) return;
  const { gl, itemSpriteTextures } = glState;
  while (itemSpriteTextures.size > ITEM_SPRITE_CACHE_TARGET) {
    let oldestKey = '';
    let oldestUse = Number.MAX_SAFE_INTEGER;
    for (const [key, entry] of itemSpriteTextures) {
      if (key === '' || entry.usedAt < oldestUse) {
        oldestUse = entry.usedAt;
        oldestKey = key;
      }
    }
    const oldest = itemSpriteTextures.get(oldestKey);
    if (!oldest) break;
    gl.deleteTexture(oldest.texture);
    itemSpriteTextures.delete(oldestKey);
  }
}

function itemDropTexture(e: Entity | null): WebGLTexture | null {
  if (!glState || !e || e.type !== EntityType.ITEM_DROP) return null;
  const defId = itemDropDefId(e);
  if (!defId) return null;
  const key = itemSpriteKey(defId);
  const cached = glState.itemSpriteTextures.get(key);
  glState.proceduralSpriteUseTick++;
  if (cached) {
    cached.usedAt = glState.proceduralSpriteUseTick;
    return cached.texture;
  }
  const texture = createSpriteTexture(glState.gl, generateItemSprite(defId));
  glState.itemSpriteTextures.set(key, { texture, usedAt: glState.proceduralSpriteUseTick });
  trimItemSpriteCache();
  return texture;
}

function visibleEntitySpriteSource(e: Entity): VisibleSpriteSource {
  // Only real inventory payload drops use generated item textures and small world scale.
  if (e.type === EntityType.ITEM_DROP && itemDropDefId(e)) return VisibleSpriteSource.ITEM_DROP;
  return VisibleSpriteSource.ENTITY;
}

function proceduralEntityTexture(e: Entity): WebGLTexture | null {
  if (!glState || !entityUsesProceduralSprite(e)) return null;
  const key = proceduralEntitySpriteKey(e);
  const cached = glState.proceduralSpriteTextures.get(key);
  glState.proceduralSpriteUseTick++;
  if (cached) {
    cached.usedAt = glState.proceduralSpriteUseTick;
    return cached.texture;
  }
  const sprite = generateProceduralEntitySprite(e);
  if (!sprite) return null;
  const texture = createSpriteTexture(glState.gl, sprite);
  glState.proceduralSpriteTextures.set(key, { texture, usedAt: glState.proceduralSpriteUseTick });
  trimProceduralSpriteCache();
  return texture;
}

export function rebuildProceduralSpriteCache(entities: readonly Entity[]): number {
  if (!glState) return 0;
  const { gl, proceduralSpriteTextures, itemSpriteTextures } = glState;
  for (const entry of proceduralSpriteTextures.values()) gl.deleteTexture(entry.texture);
  proceduralSpriteTextures.clear();
  for (const entry of itemSpriteTextures.values()) gl.deleteTexture(entry.texture);
  itemSpriteTextures.clear();
  resetAnimatedEntityTextureOverride(gl);
  let built = 0;
  for (const e of entities) {
    if (!e.alive || !entityUsesProceduralSprite(e)) continue;
    const key = proceduralEntitySpriteKey(e);
    if (proceduralSpriteTextures.has(key)) continue;
    const sprite = generateProceduralEntitySprite(e);
    if (!sprite) continue;
    glState.proceduralSpriteUseTick++;
    proceduralSpriteTextures.set(key, {
      texture: createSpriteTexture(gl, sprite),
      usedAt: glState.proceduralSpriteUseTick,
    });
    built++;
    if (proceduralSpriteTextures.size >= PROCEDURAL_SPRITE_CACHE_MAX) break;
  }
  for (const e of entities) {
    if (!e.alive || e.type !== EntityType.ITEM_DROP) continue;
    const defId = itemDropDefId(e);
    if (!defId) continue;
    const key = itemSpriteKey(defId);
    if (itemSpriteTextures.has(key)) continue;
    glState.proceduralSpriteUseTick++;
    itemSpriteTextures.set(key, {
      texture: createSpriteTexture(gl, generateItemSprite(defId)),
      usedAt: glState.proceduralSpriteUseTick,
    });
    built++;
    if (itemSpriteTextures.size >= ITEM_SPRITE_CACHE_MAX) break;
  }
  return built;
}

/* ── Build door state map from World ──────────────────────────── */
function rebuildDoorStates(world: World, out?: Uint8Array): Uint8Array {
  // Default: 0 = OPEN (passable). Cells without doors stay 0.
  const ds = out ?? new Uint8Array(W * W);
  ds.fill(0);
  for (const [ci, door] of world.doors) {
    const isCracked = door.hp !== undefined && door.maxHp !== undefined && door.hp < door.maxHp * 0.5;
    ds[ci] = door.state | (isCracked ? 128 : 0);
  }
  return ds;
}

function syncDoorStates(world: World, out: Uint8Array): boolean {
  let dirty = false;
  for (const [ci, door] of world.doors) {
    const isCracked = door.hp !== undefined && door.maxHp !== undefined && door.hp < door.maxHp * 0.5;
    const state = door.state | (isCracked ? 128 : 0);
    if (out[ci] !== state) {
      out[ci] = state;
      dirty = true;
    }
  }
  return dirty;
}

/* ── Surface marks atlas ─────────────────────────────────────── *
 * Pack surfaceMap entries into a 512×512 RGBA atlas (32×32 grid   *
 * of 16×16 tiles = max 1024 cells). Returns atlas pixels + index. */
const SURF_ATLAS_SIZE = 512;         // 512×512 total
const SURF_ATLAS_COLS = 32;          // 32 tiles per row
const SURF_MAX_SLOTS = SURF_ATLAS_COLS * SURF_ATLAS_COLS; // 1024
const SURF_UPLOAD_MIN_INTERVAL_MS = 100;

interface SurfaceUploadData {
  pixels: Uint8Array;
  index: Uint16Array;
  slotByCell: Map<number, number>;
  cellBySlot: Int32Array;
}

function copySurfaceCellToAtlas(pixels: Uint8Array, slot: number, cellData: Uint8Array): void {
  const s = slot - 1;
  const ax = (s % SURF_ATLAS_COLS) * 16;
  const ay = Math.floor(s / SURF_ATLAS_COLS) * 16;
  for (let py = 0; py < 16; py++) {
    for (let px = 0; px < 16; px++) {
      const si = (py * 16 + px) << 2;
      const di = ((ay + py) * SURF_ATLAS_SIZE + (ax + px)) * 4;
      pixels[di]     = cellData[si];
      pixels[di + 1] = cellData[si + 1];
      pixels[di + 2] = cellData[si + 2];
      pixels[di + 3] = cellData[si + 3];
    }
  }
}

function buildSurfaceData(world: World, camX: number, camY: number, out?: SurfaceUploadData): SurfaceUploadData {
  const pixels = out?.pixels ?? new Uint8Array(SURF_ATLAS_SIZE * SURF_ATLAS_SIZE * 4);
  const index = out?.index ?? new Uint16Array(W * W); // 0 = no mark
  const slotByCell = out?.slotByCell ?? new Map<number, number>();
  const cellBySlot = out?.cellBySlot ?? new Int32Array(SURF_MAX_SLOTS);
  pixels.fill(0);
  index.fill(0);
  slotByCell.clear();
  cellBySlot.fill(-1);

  // Sort cells by toroidal distance to camera — nearest 1024 get atlas slots
  const entries = Array.from(world.surfaceMap.entries());
  if (entries.length > SURF_MAX_SLOTS) {
    const camCX = Math.floor(camX), camCY = Math.floor(camY);
    entries.sort((a, b) => {
      const ax = a[0] % W, ay = (a[0] / W) | 0;
      const bx = b[0] % W, by = (b[0] / W) | 0;
      let dax = ax - camCX; if (dax > W / 2) dax -= W; else if (dax < -W / 2) dax += W;
      let day = ay - camCY; if (day > W / 2) day -= W; else if (day < -W / 2) day += W;
      let dbx = bx - camCX; if (dbx > W / 2) dbx -= W; else if (dbx < -W / 2) dbx += W;
      let dby = by - camCY; if (dby > W / 2) dby -= W; else if (dby < -W / 2) dby += W;
      return (dax * dax + day * day) - (dbx * dbx + dby * dby);
    });
  }

  let slot = 0;
  for (const [ci, cellData] of entries) {
    if (slot >= SURF_MAX_SLOTS) break;
    slot++; // 1-based slot numbers (0 = "no mark")
    index[ci] = slot;
    slotByCell.set(ci, slot);
    cellBySlot[slot - 1] = ci;
    copySurfaceCellToAtlas(pixels, slot, cellData);
  }
  return { pixels, index, slotByCell, cellBySlot };
}

function findFreeSurfaceSlot(cellBySlot: Int32Array): number {
  for (let i = 0; i < cellBySlot.length; i++) {
    if (cellBySlot[i] < 0) return i + 1;
  }
  return 0;
}

function uploadSurfaceAtlasTile(gl: WebGL2RenderingContext, glState: GLState, slot: number): void {
  const s = slot - 1;
  const ax = (s % SURF_ATLAS_COLS) * 16;
  const ay = Math.floor(s / SURF_ATLAS_COLS) * 16;
  gl.bindTexture(gl.TEXTURE_2D, glState.surfaceAtlasTex);
  gl.pixelStorei(gl.UNPACK_ROW_LENGTH, SURF_ATLAS_SIZE);
  gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, ax);
  gl.pixelStorei(gl.UNPACK_SKIP_ROWS, ay);
  try {
    gl.texSubImage2D(gl.TEXTURE_2D, 0, ax, ay, 16, 16, gl.RGBA, gl.UNSIGNED_BYTE, glState.surfacePixels);
  } finally {
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  }
}

function uploadSurfaceIndexCell(gl: WebGL2RenderingContext, glState: GLState, ci: number, slot: number): void {
  glState.surfaceIndexPatch[0] = slot;
  gl.bindTexture(gl.TEXTURE_2D, glState.surfaceIdxTex);
  gl.texSubImage2D(
    gl.TEXTURE_2D,
    0,
    ci % W,
    (ci / W) | 0,
    1,
    1,
    gl.RED_INTEGER,
    gl.UNSIGNED_SHORT,
    glState.surfaceIndexPatch,
  );
}

function uploadSurfaceDirtyCells(world: World, glState: GLState, dirtyCells: readonly number[]): boolean {
  if (dirtyCells.length <= 0) return false;
  const { gl } = glState;
  for (const ci of dirtyCells) {
    const cellData = world.surfaceMap.get(ci);
    if (!cellData) return false;

    let slot = glState.surfaceSlotByCell.get(ci) ?? 0;
    if (slot > 0 && glState.surfaceCellBySlot[slot - 1] !== ci) return false;
    if (slot <= 0) {
      if (world.surfaceMap.size > SURF_MAX_SLOTS) return false;
      slot = findFreeSurfaceSlot(glState.surfaceCellBySlot);
      if (slot <= 0) return false;
      glState.surfaceSlotByCell.set(ci, slot);
      glState.surfaceCellBySlot[slot - 1] = ci;
      glState.surfaceIndex[ci] = slot;
      uploadSurfaceIndexCell(gl, glState, ci, slot);
    }

    copySurfaceCellToAtlas(glState.surfacePixels, slot, cellData);
    uploadSurfaceAtlasTile(gl, glState, slot);
  }
  return true;
}

function createDataTexR16UI(gl: WebGL2RenderingContext, w: number, h: number, data: Uint16Array): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI, w, h, 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT, data);
  return tex;
}

function createParticleVAO(
  gl: WebGL2RenderingContext,
  prog: WebGLProgram,
  capacity: number,
): {
  vao: WebGLVertexArrayObject;
  instanceBuffer: WebGLBuffer;
  colorBuffer: WebGLBuffer;
  instanceData: Float32Array;
  colorData: Float32Array;
} {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);

  const quadBuffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -0.5, -0.5,
     0.5, -0.5,
    -0.5,  0.5,
    -0.5,  0.5,
     0.5, -0.5,
     0.5,  0.5,
  ]), gl.STATIC_DRAW);
  const posLoc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  const instanceData = new Float32Array(capacity * 4);
  const instanceBuffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, instanceData.byteLength, gl.DYNAMIC_DRAW);
  const particleLoc = gl.getAttribLocation(prog, 'aParticle');
  gl.enableVertexAttribArray(particleLoc);
  gl.vertexAttribPointer(particleLoc, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(particleLoc, 1);

  const colorData = new Float32Array(capacity * 4);
  const colorBuffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, colorData.byteLength, gl.DYNAMIC_DRAW);
  const colorLoc = gl.getAttribLocation(prog, 'aColor');
  gl.enableVertexAttribArray(colorLoc);
  gl.vertexAttribPointer(colorLoc, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(colorLoc, 1);

  gl.bindVertexArray(null);
  return { vao, instanceBuffer, colorBuffer, instanceData, colorData };
}

/* ── Initialize WebGL ─────────────────────────────────────────── */
export function initWebGL(
  canvas: HTMLCanvasElement,
  textures: TexData[],
  sprites: SpriteData[],
  world: World,
): WebGL2RenderingContext {
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    }) as WebGL2RenderingContext | null;
  } catch (e) {
    console.error('WebGL context creation failed', e);
  }
  if (!gl) throw new Error('WebGL2 not supported');

  // Enable float textures
  const floatExt = gl.getExtension('EXT_color_buffer_float');
  if (!floatExt) {
    // Fallback: we can still work without it, will use RGBA8 readback
    console.warn('EXT_color_buffer_float not available — depth readback via RGBA');
  }

  // ── Raycaster program ──
  const rayProgram = createProgram(gl, VERT_SRC, FRAG_SRC);
  const rayVAO = createQuadVAO(gl, rayProgram);
  const rayUniforms = getUniforms(gl, rayProgram, [
    'uResolution', 'uPos', 'uAngle', 'uPitch', 'uFogDensity',
    'uGlitch', 'uPlaneLen', 'uCamHeight', 'uFlashlight', 'uToolBeam', 'uToolBeamRange', 'uAmbient', 'uTime', 'uLightQuality', 'uPurpleFog', 'uFogColor',
    'uCells', 'uWallTex', 'uFloorTex', 'uFeatures', 'uCeil', 'uLight', 'uFog',
    'uDoorStates', 'uAtlas', 'uAtlasSize', 'uUseDynamicSky', 'uDynamicSky',
    'uDynamicSkyTint', 'uBaseFogColor', 'uSurfaceAtlas', 'uSurfaceIdx',
    'uDetailFloorCount', 'uDetailFloor0', 'uDetailFloor1', 'uDetailFloorColor0', 'uDetailFloorColor1',
    'uDetailWallCount', 'uDetailWall0', 'uDetailWall1', 'uDetailWallColor0', 'uDetailWallColor1',
    'uDetailLightDust', 'uDetailLightDustColor',
    'uSurfaceProfileA', 'uSurfaceProfileB', 'uSurfaceProfileSeed', 'uDynamicLightCount',
    'uLightBlinks', 'uSamosborAlert'
  ]);
  
  for (let i = 0; i < 8; i++) {
    rayUniforms[`uDynamicLights[${i}].pos`] = gl.getUniformLocation(rayProgram, `uDynamicLights[${i}].pos`);
    rayUniforms[`uDynamicLights[${i}].color`] = gl.getUniformLocation(rayProgram, `uDynamicLights[${i}].color`);
    rayUniforms[`uDynamicLights[${i}].radius`] = gl.getUniformLocation(rayProgram, `uDynamicLights[${i}].radius`);
  }
  rayUniforms['uShadowCasterCount'] = gl.getUniformLocation(rayProgram, 'uShadowCasterCount');
  for (let i = 0; i < 32; i++) {
    rayUniforms[`uShadowCasters[${i}]`] = gl.getUniformLocation(rayProgram, `uShadowCasters[${i}]`);
  }

  // ── Blit program ──
  const blitProgram = createProgram(gl, BLIT_VERT_SRC, BLIT_FRAG_SRC);
  const blitVAO = createQuadVAO(gl, blitProgram);
  const blitUniforms = getUniforms(gl, blitProgram, ['uTex', 'uGlitch', 'uTime', 'uSamosborActive', 'uSamosborStyle', 'uSamosborPost', 'uSamosborTint', 'uScreenInterference', 'uBloomTex', 'uBloomStrength']);

  // ── Bloom programs (bright-pass prefilter + separable blur) ──
  const bloomPrefilterProgram = createProgram(gl, BLIT_VERT_SRC, BLOOM_PREFILTER_FRAG_SRC);
  const bloomVAOPrefilter = createQuadVAO(gl, bloomPrefilterProgram);
  const bloomPrefilterUniforms = getUniforms(gl, bloomPrefilterProgram, ['uTex', 'uTexel', 'uThreshold']);
  const bloomBlurProgram = createProgram(gl, BLIT_VERT_SRC, BLOOM_BLUR_FRAG_SRC);
  const bloomVAOBlur = createQuadVAO(gl, bloomBlurProgram);
  const bloomBlurUniforms = getUniforms(gl, bloomBlurProgram, ['uTex', 'uDir']);

  // ── Sprite program ──
  const spriteProgram = createProgram(gl, SPRITE_VERT_SRC, SPRITE_FRAG_SRC);
  const spriteVAO = createSpriteVAO(gl, spriteProgram);
  const spriteUniforms = getUniforms(gl, spriteProgram, [
    'uResolution', 'uScreenX', 'uShearX', 'uSpriteW', 'uSpriteH', 'uStartY', 'uDepth',
    'uSpriteTex', 'uFogColor', 'uFogF', 'uIsShadow', 'uShadowFloorH', 'uIsProjectile', 'uTime', 'uSeed', 'uSpriteWorldPos',
    'uCells', 'uDoorStates', 'uDynamicLightCount', 'uShadowTip',
    'uPos', 'uAngle', 'uLight', 'uLightBlinks', 'uAmbient', 'uSamosborAlert',
    'uFlashlight', 'uToolBeam', 'uToolBeamRange', 'uLightQuality'
  ]);
  for (let i = 0; i < 8; i++) {
    spriteUniforms[`uDynamicLights[${i}].pos`] = gl.getUniformLocation(spriteProgram, `uDynamicLights[${i}].pos`);
    spriteUniforms[`uDynamicLights[${i}].color`] = gl.getUniformLocation(spriteProgram, `uDynamicLights[${i}].color`);
    spriteUniforms[`uDynamicLights[${i}].radius`] = gl.getUniformLocation(spriteProgram, `uDynamicLights[${i}].radius`);
  }
  spriteUniforms['uShadowCasterCount'] = gl.getUniformLocation(spriteProgram, 'uShadowCasterCount');
  for (let i = 0; i < 32; i++) {
    spriteUniforms[`uShadowCasters[${i}]`] = gl.getUniformLocation(spriteProgram, `uShadowCasters[${i}]`);
  }

  // ── Particle program ──
  const particleProgram = createProgram(gl, PARTICLE_VERT_SRC, PARTICLE_FRAG_SRC);
  const particleBuffers = createParticleVAO(gl, particleProgram, PARTICLE_INSTANCE_CAP);
  const particleUniforms = getUniforms(gl, particleProgram, ['uResolution']);

  // ── FBO for low-res raycaster output ──
  const rayColorTex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, rayColorTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, SCR_W, SCR_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  const rayDepthTex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, rayDepthTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, SCR_W, SCR_H, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);

  const rayFBO = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, rayFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rayColorTex, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, rayDepthTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // ── Bloom FBOs (half-res, linear-filtered ping-pong targets) ──
  const BLOOM_W = Math.max(1, SCR_W >> 1);
  const BLOOM_H = Math.max(1, SCR_H >> 1);
  const makeBloomTarget = (): { tex: WebGLTexture; fbo: WebGLFramebuffer } => {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, BLOOM_W, BLOOM_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo };
  };
  const bloomA = makeBloomTarget();
  const bloomB = makeBloomTarget();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // ── Data textures ──
  const cellsTex = createDataTexR8UI(gl, W, W, world.cells);
  const wallTexTex = createDataTexR8UI(gl, W, W, world.wallTex);
  const floorTexTex = createDataTexR8UI(gl, W, W, world.floorTex);
  const featuresTex = createDataTexR8UI(gl, W, W, world.features);
  const ceilTex = createDataTexR8UI(gl, W, W, world.ceilHeight);
  const lightTex = createDataTexR32F(gl, W, W, world.light);
  const lightBlinksTex = createDataTexR8UI(gl, W, W, world.lightBlinks);
  const fogTex = createDataTexR8UI(gl, W, W, world.fog);
  const doorStatesData = rebuildDoorStates(world);
  const doorStatesTex = createDataTexR8UI(gl, W, W, doorStatesData);

  // ── Surface marks atlas & index ──
  const surfData = buildSurfaceData(world, 0, 0);
  const surfaceAtlasTex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, surfaceAtlasTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SURF_ATLAS_SIZE, SURF_ATLAS_SIZE, 0,
    gl.RGBA, gl.UNSIGNED_BYTE, surfData.pixels);
  const surfaceIdxTex = createDataTexR16UI(gl, W, W, surfData.index);

  // ── Texture atlas ──
  const atlasTex = buildAtlas(gl, textures);
  const dynamicSkyTex = createDynamicSkyTex(gl);

  // ── Sprite textures ──
  const spriteTextures = buildSpriteTextures(gl, sprites);
  const spriteGroundInsets = buildSpriteGroundInsets(sprites);
  const meshPass = createOptionalMeshPass(gl);

  glState = {
    gl,
    rayProgram, rayVAO, rayFBO, rayColorTex, rayDepthTex,
    blitProgram, blitVAO,
    bloomPrefilterProgram, bloomPrefilterUniforms,
    bloomBlurProgram, bloomBlurUniforms,
    bloomVAOPrefilter, bloomVAOBlur,
    bloomTexA: bloomA.tex, bloomFBO_A: bloomA.fbo,
    bloomTexB: bloomB.tex, bloomFBO_B: bloomB.fbo,
    particleProgram,
    particleVAO: particleBuffers.vao,
    particleInstanceBuffer: particleBuffers.instanceBuffer,
    particleColorBuffer: particleBuffers.colorBuffer,
    particleInstanceData: particleBuffers.instanceData,
    particleColorData: particleBuffers.colorData,
    particleUniforms,
    cellsTex, wallTexTex, floorTexTex, featuresTex, ceilTex, lightTex, lightBlinksTex, fogTex,
    doorStatesTex, atlasTex,
    dynamicSkyTex,
    dynamicSkyW: 1,
    dynamicSkyH: 1,
    spriteProgram, spriteVAO, spriteTextures, spriteGroundInsets,
    proceduralSpriteTextures: new Map(),
    itemSpriteTextures: new Map(),
    proceduralSpriteUseTick: 0,
    surfaceAtlasTex, surfaceIdxTex,
    surfacePixels: surfData.pixels,
    surfaceIndex: surfData.index,
    surfaceSlotByCell: surfData.slotByCell,
    surfaceCellBySlot: surfData.cellBySlot,
    surfaceIndexPatch: new Uint16Array(1),
    surfaceVersion: world.surfaceVersion,
    surfaceUploadMs: 0,
    surfaceCamTileX: 0,
    surfaceCamTileY: 0,
    cellVersion: world.cellVersion,
    wallTexVersion: world.wallTexVersion,
    floorTexVersion: world.floorTexVersion,
    featureVersion: world.featureVersion,
    ceilHeightVersion: world.ceilHeightVersion,
    lightVersion: world.lightVersion,
    lightBlinksVersion: world.lightVersion,
    fogVersion: world.fogVersion,
    doorStatesData,
    rayUniforms, blitUniforms, spriteUniforms,
    dynamicLightCount: 0,
    dynamicLightsPos: new Float32Array(8 * 3),
    dynamicLightsColor: new Float32Array(8 * 3),
    dynamicLightsRadius: new Float32Array(8),

    shadowCasterCount: 0,
    shadowCasters: new Float32Array(32 * 4),
    meshPass,
  };
  world.clearPendingSurfaceDirtyCells();
  uploadDynamicSkyTexture();

  return gl;
}

/* ── Create sprite quad VAO ───────────────────────────────────── */
function createSpriteVAO(gl: WebGL2RenderingContext, prog: WebGLProgram): WebGLVertexArrayObject {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  // Quad: position + texcoord
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    // pos.x, pos.y, uv.x, uv.y
    -0.5, -0.5, 0, 0,
     0.5, -0.5, 1, 0,
    -0.5,  0.5, 0, 1,
    -0.5,  0.5, 0, 1,
     0.5, -0.5, 1, 0,
     0.5,  0.5, 1, 1,
  ]), gl.STATIC_DRAW);
  const posLoc = gl.getAttribLocation(prog, 'aPos');
  const texLoc = gl.getAttribLocation(prog, 'aTexCoord');
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
  if (texLoc >= 0) {
    gl.enableVertexAttribArray(texLoc);
    gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 16, 8);
  }
  gl.bindVertexArray(null);
  return vao;
}

function uploadGridTexture(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  format: number,
  type: number,
  data: ArrayBufferView,
  rects: readonly WorldGridDirtyRect[] | null,
): void {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  if (!rects || rects.length === 0) {
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, W, format, type, data);
    return;
  }
  gl.pixelStorei(gl.UNPACK_ROW_LENGTH, W);
  try {
    for (const rect of rects) {
      if (rect.w <= 0 || rect.h <= 0) continue;
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, rect.x);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, rect.y);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, rect.x, rect.y, rect.w, rect.h, format, type, data);
    }
  } finally {
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  }
}

/* ── Update world data textures (call after world changes) ────── */
export function updateWorldData(world: World): void {
  if (!glState) return;
  const { gl } = glState;

  gl.bindTexture(gl.TEXTURE_2D, glState.cellsTex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, W, gl.RED_INTEGER, gl.UNSIGNED_BYTE, world.cells);
  glState.cellVersion = world.cellVersion;

  gl.bindTexture(gl.TEXTURE_2D, glState.wallTexTex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, W, gl.RED_INTEGER, gl.UNSIGNED_BYTE, world.wallTex);
  glState.wallTexVersion = world.wallTexVersion;

  gl.bindTexture(gl.TEXTURE_2D, glState.floorTexTex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, W, gl.RED_INTEGER, gl.UNSIGNED_BYTE, world.floorTex);
  glState.floorTexVersion = world.floorTexVersion;

  gl.bindTexture(gl.TEXTURE_2D, glState.featuresTex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, W, gl.RED_INTEGER, gl.UNSIGNED_BYTE, world.features);
  glState.featureVersion = world.featureVersion;
  glState.lightVersion = world.lightVersion;
  glState.lightBlinksVersion = world.lightVersion;

  gl.bindTexture(gl.TEXTURE_2D, glState.lightTex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, W, gl.RED, gl.FLOAT, world.light);
  
  gl.bindTexture(gl.TEXTURE_2D, glState.lightBlinksTex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, W, gl.RED_INTEGER, gl.UNSIGNED_BYTE, world.lightBlinks);

  gl.bindTexture(gl.TEXTURE_2D, glState.fogTex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, W, gl.RED_INTEGER, gl.UNSIGNED_BYTE, world.fog);
  glState.fogVersion = world.fogVersion;

  gl.bindTexture(gl.TEXTURE_2D, glState.doorStatesTex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, W, gl.RED_INTEGER, gl.UNSIGNED_BYTE, rebuildDoorStates(world, glState.doorStatesData));

  glState.surfaceVersion = -1;
  glState.surfaceUploadMs = 0;
  glState.surfaceCamTileX = Number.NaN;
  glState.surfaceCamTileY = Number.NaN;
  world.clearPendingGridDirtyRects();

  // Also update dynamic data
  updateDynamicData(world);
}

/** Lightweight per-frame update: fog, door states, wallTex (for slides) */
export function updateDynamicData(world: World, camX = 0, camY = 0): void {
  if (!glState) return;
  const { gl } = glState;

  if (world.cellVersion !== glState.cellVersion) {
    uploadGridTexture(gl, glState.cellsTex, gl.RED_INTEGER, gl.UNSIGNED_BYTE, world.cells, world.takeCellDirtyRects());
    glState.cellVersion = world.cellVersion;
  }

  if (world.featureVersion !== glState.featureVersion) {
    uploadGridTexture(gl, glState.featuresTex, gl.RED_INTEGER, gl.UNSIGNED_BYTE, world.features, world.takeFeatureDirtyRects());
    glState.featureVersion = world.featureVersion;
  }

  if (world.ceilHeightVersion !== glState.ceilHeightVersion) {
    uploadGridTexture(gl, glState.ceilTex, gl.RED_INTEGER, gl.UNSIGNED_BYTE, world.ceilHeight, null);
    glState.ceilHeightVersion = world.ceilHeightVersion;
  }
  if (world.lightVersion !== glState.lightVersion) {
    gl.bindTexture(gl.TEXTURE_2D, glState.lightTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, W, gl.RED, gl.FLOAT, world.light);
    glState.lightVersion = world.lightVersion;
  }

  if (world.wallTexVersion !== glState.wallTexVersion) {
    uploadGridTexture(gl, glState.wallTexTex, gl.RED_INTEGER, gl.UNSIGNED_BYTE, world.wallTex, world.takeWallTexDirtyRects());
    glState.wallTexVersion = world.wallTexVersion;
  }

  if (world.floorTexVersion !== glState.floorTexVersion) {
    uploadGridTexture(gl, glState.floorTexTex, gl.RED_INTEGER, gl.UNSIGNED_BYTE, world.floorTex, world.takeFloorTexDirtyRects());
    glState.floorTexVersion = world.floorTexVersion;
  }

  if (world.fogVersion !== glState.fogVersion) {
    uploadGridTexture(gl, glState.fogTex, gl.RED_INTEGER, gl.UNSIGNED_BYTE, world.fog, world.takeFogDirtyRects());
    glState.fogVersion = world.fogVersion;
  }

  // Door states
  if (syncDoorStates(world, glState.doorStatesData)) {
    gl.bindTexture(gl.TEXTURE_2D, glState.doorStatesTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, W, gl.RED_INTEGER, gl.UNSIGNED_BYTE, glState.doorStatesData);
  }

  // Surface marks (blood, bullet holes, etc.)
  const surfaceCamTileX = Math.floor(camX / 4);
  const surfaceCamTileY = Math.floor(camY / 4);
  const surfaceCameraDirty = world.surfaceMap.size > SURF_MAX_SLOTS
    && (surfaceCamTileX !== glState.surfaceCamTileX || surfaceCamTileY !== glState.surfaceCamTileY);
  const surfaceDirty = world.surfaceVersion !== glState.surfaceVersion || surfaceCameraDirty;
  if (surfaceDirty) {
    const now = performance.now();
    const forceUpload = glState.surfaceVersion < 0;
    if (!forceUpload && now - glState.surfaceUploadMs < SURF_UPLOAD_MIN_INTERVAL_MS) return;
    const dirtyCells = forceUpload || surfaceCameraDirty ? null : world.pendingSurfaceDirtyCells();
    const partialUpload = dirtyCells !== null && dirtyCells.length > 0
      ? uploadSurfaceDirtyCells(world, glState, dirtyCells)
      : false;
    if (!partialUpload) {
      const surfData = buildSurfaceData(world, camX, camY, {
        pixels: glState.surfacePixels,
        index: glState.surfaceIndex,
        slotByCell: glState.surfaceSlotByCell,
        cellBySlot: glState.surfaceCellBySlot,
      });
      gl.bindTexture(gl.TEXTURE_2D, glState.surfaceAtlasTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SURF_ATLAS_SIZE, SURF_ATLAS_SIZE, gl.RGBA, gl.UNSIGNED_BYTE, surfData.pixels);
      gl.bindTexture(gl.TEXTURE_2D, glState.surfaceIdxTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, W, gl.RED_INTEGER, gl.UNSIGNED_SHORT, surfData.index);
    }
    world.clearPendingSurfaceDirtyCells();
    glState.surfaceVersion = world.surfaceVersion;
    glState.surfaceUploadMs = now;
    glState.surfaceCamTileX = surfaceCamTileX;
    glState.surfaceCamTileY = surfaceCamTileY;
  }
}

/* ── Render scene via WebGL ───────────────────────────────────── */
export function renderSceneGL(
  world: World,
  textures: TexData[],
  sprites: SpriteData[],
  entities: Entity[],
  camera: CameraView,
  fogDensity: number,
  glitch: number,
  flashlight = 0,
  time = 0,
  bloodParticles: BloodParticle[] = [],
  samosborActive = false,
  ambientLight = 0.12,
  toolBeam = 0,
  toolBeamRange = 0,
  screenInterference = 0,
  visualDetailProfile: ResolvedVisualDetailProfile = EMPTY_RESOLVED_VISUAL_DETAIL_PROFILE,
  visualGeometryProfile: ResolvedVisualGeometryProfile = EMPTY_RESOLVED_VISUAL_GEOMETRY_PROFILE,
  visualSurfaceProfile: ResolvedVisualSurfaceProfile = EMPTY_RESOLVED_VISUAL_SURFACE_PROFILE,
  lightingQuality = 4,
  currentFps?: number,
): void {
  lastRenderSceneDebugStats.meshEnabled = visualGeometryProfile.enabled;
  lastRenderSceneDebugStats.meshInstances = 0;
  lastRenderSceneDebugStats.meshTriangles = 0;
  lastRenderSceneDebugStats.meshDrawCalls = 0;
  lastRenderSceneDebugStats.activeAnimatedSprites = 0;
  lastRenderSceneDebugStats.drawnAnimatedSprites = 0;
  lastRenderSceneDebugStats.animatedSpriteTextureCacheSize = getAnimatedEntityTextureDebugStats().cacheSize;
  if (!glState) {
    lastRenderSceneDebugStats.visibleSprites = 0;
    lastRenderSceneDebugStats.drawnSprites = 0;
    lastRenderSceneDebugStats.visibleEntityQueryResults = 0;
    lastRenderSceneDebugStats.meshEnabled = false;
    return;
  }
  const { gl } = glState;
  const px = camera.x;
  const py = camera.y;
  const pAngle = camera.angle;
  const pPitch = camera.pitch;
  const camHeight = camera.height;
  const planeLen = planeLenForFov(camera.fovRadians || DEFAULT_FOV_RADIANS);

  // Check if player is in purple fog
  const pci = world.idx(Math.floor(px), Math.floor(py));
  const purpleFog = world.fog[pci] > 50 ? 1 : 0;
  const activeVariant = getActiveSamosborVariant();
  const defaultFogRgb: [number, number, number] = [80, 0, 120];
  const fogRgb: readonly [number, number, number] = activeVariant?.fogColor ?? defaultFogRgb;
  const samosborStyle = samosborScreenFxCode(activeVariant?.visual.screenFx);
  const samosborPost = samosborActive ? activeVariant?.visual.postIntensity ?? 0 : 0;

  // ── Pass 1: Raycaster into FBO ──
  gl.bindFramebuffer(gl.FRAMEBUFFER, glState.rayFBO);
  gl.viewport(0, 0, SCR_W, SCR_H);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  gl.useProgram(glState.rayProgram);
  const ru = glState.rayUniforms;
  gl.uniform2f(ru['uResolution']!, SCR_W, SCR_H);
  gl.uniform2f(ru['uPos']!, px, py);
  gl.uniform1f(ru['uAngle']!, pAngle);
  gl.uniform1f(ru['uPitch']!, pPitch);
  gl.uniform1f(ru['uFogDensity']!, fogDensity);
  gl.uniform1f(ru['uGlitch']!, glitch);
  gl.uniform1f(ru['uPlaneLen']!, planeLen);
  gl.uniform1f(ru['uCamHeight']!, camHeight);
  gl.uniform1f(ru['uFlashlight']!, flashlight);
  gl.uniform1f(ru['uToolBeam']!, toolBeam);
  gl.uniform1f(ru['uToolBeamRange']!, toolBeamRange);
  gl.uniform1f(ru['uAmbient']!, ambientLight);
  gl.uniform1f(ru['uTime']!, time);
  gl.uniform1i(ru['uLightQuality']!, lightingQuality);
  gl.uniform1i(ru['uPurpleFog']!, purpleFog);
  gl.uniform3f(ru['uFogColor']!, fogRgb[0] / 255, fogRgb[1] / 255, fogRgb[2] / 255);
  const skyTint = activeDynamicSky?.ambientTint;
  const skyR = skyTint ? Math.max(0.65, Math.min(1.25, skyTint.r / 112)) : 1;
  const skyG = skyTint ? Math.max(0.65, Math.min(1.25, skyTint.g / 120)) : 1;
  const skyB = skyTint ? Math.max(0.65, Math.min(1.25, skyTint.b / 136)) : 1;
  const skyFog = activeDynamicSky?.fogTint;
  const meshFogRgb: readonly [number, number, number] = purpleFog
    ? fogRgb
    : skyFog
      ? [skyFog.r, skyFog.g, skyFog.b]
      : [5, 5, 8];
  gl.uniform1i(ru['uUseDynamicSky']!, activeDynamicSky ? 1 : 0);
  gl.uniform3f(ru['uDynamicSkyTint']!, skyR, skyG, skyB);
  gl.uniform3f(
    ru['uBaseFogColor']!,
    skyFog ? skyFog.r / 255 : 5 / 255,
    skyFog ? skyFog.g / 255 : 5 / 255,
    skyFog ? skyFog.b / 255 : 8 / 255,
  );
  uploadVisualDetailUniforms(gl, ru, visualDetailProfile);
  uploadVisualSurfaceUniforms(gl, ru, visualSurfaceProfile);

  // Dynamic Lights (Framework)
  let dynLightCount = 0;
  if (flashlight > 0.0) {
    gl.uniform3f(ru[`uDynamicLights[0].pos`]!, px, py, camHeight);
    gl.uniform3f(ru[`uDynamicLights[0].color`]!, 1.5, 1.4, 1.2); // Warm bright light
    gl.uniform1f(ru[`uDynamicLights[0].radius`]!, 10.0);
    
    glState.dynamicLightsPos[0] = px;
    glState.dynamicLightsPos[1] = py;
    glState.dynamicLightsPos[2] = camHeight;
    glState.dynamicLightsColor[0] = 1.5;
    glState.dynamicLightsColor[1] = 1.4;
    glState.dynamicLightsColor[2] = 1.2;
    glState.dynamicLightsRadius[0] = 10.0;
    
    dynLightCount++;
  }

  const maxDrawGrid = Math.ceil(MAX_DRAW);
  const cx = Math.floor(px);
  const cy = Math.floor(py);
  const lightCandidates: { lx: number, ly: number, lz: number, r: number, g: number, b: number, radius: number, dist2: number }[] = [];

  for (let dy = -maxDrawGrid; dy <= maxDrawGrid; dy++) {
    for (let dx = -maxDrawGrid; dx <= maxDrawGrid; dx++) {
      const dist2 = dx * dx + dy * dy;
      if (dist2 > MAX_DRAW * MAX_DRAW) continue;

      const wx = world.wrap(cx + dx);
      const wy = world.wrap(cy + dy);
      const idx = world.idx(wx, wy);
      const feat = world.features[idx];
      
      let lr = 0, lg = 0, lb = 0, lrad = 0;
      if (feat === Feature.LAMP) {
        lr = 1.0; lg = 0.9; lb = 0.8; lrad = 8.0;
      } else if (feat === Feature.CANDLE) {
        lr = 0.8; lg = 0.5; lb = 0.2; lrad = 5.0;
      }
      
      if (lrad > 0) {
        const lx = cx + dx + 0.5;
        const ly = cy + dy + 0.5;
        const lz = (feat === Feature.LAMP) ? (1.0 + Math.max(0, world.ceilHeight[idx]) * 0.5) - 0.1 : 0.4;
        lightCandidates.push({ lx, ly, lz, r: lr, g: lg, b: lb, radius: lrad, dist2 });
      }
    }
  }

  lightCandidates.sort((A, B) => A.dist2 - B.dist2);

  for (const c of lightCandidates) {
    if (dynLightCount >= 8) break;
    gl.uniform3f(ru[`uDynamicLights[${dynLightCount}].pos`]!, c.lx, c.ly, c.lz);
    gl.uniform3f(ru[`uDynamicLights[${dynLightCount}].color`]!, c.r, c.g, c.b);
    gl.uniform1f(ru[`uDynamicLights[${dynLightCount}].radius`]!, c.radius);
    
    glState.dynamicLightsPos[dynLightCount * 3 + 0] = c.lx;
    glState.dynamicLightsPos[dynLightCount * 3 + 1] = c.ly;
    glState.dynamicLightsPos[dynLightCount * 3 + 2] = c.lz;
    glState.dynamicLightsColor[dynLightCount * 3 + 0] = c.r;
    glState.dynamicLightsColor[dynLightCount * 3 + 1] = c.g;
    glState.dynamicLightsColor[dynLightCount * 3 + 2] = c.b;
    glState.dynamicLightsRadius[dynLightCount] = c.radius;
    
    dynLightCount++;
  }

  gl.uniform1i(ru['uDynamicLightCount']!, dynLightCount);
  glState.dynamicLightCount = dynLightCount; // Save for mesh and sprites

  // Shadow Casters
  let shadowCasterCount = 0;
  for (const e of entities) {
    if (shadowCasterCount >= 32) break;
    if (e.type === EntityType.PROJECTILE || e.type === EntityType.EFFECT || e.type === EntityType.BILLBOARD || e.type === EntityType.LIGHT) continue;
    
    let radius = 0.25;
    let height = 0.8;
    if (e.type === EntityType.ITEM_DROP) {
      radius = 0.15;
      height = 0.15;
    }
    
    const dx = e.x - px;
    const dy = e.y - py;
    if (dx * dx + dy * dy > MAX_DRAW * MAX_DRAW) continue;

    glState.shadowCasters[shadowCasterCount * 4 + 0] = e.x;
    glState.shadowCasters[shadowCasterCount * 4 + 1] = e.y;
    glState.shadowCasters[shadowCasterCount * 4 + 2] = height;
    glState.shadowCasters[shadowCasterCount * 4 + 3] = radius;
    shadowCasterCount++;
  }
  glState.shadowCasterCount = shadowCasterCount;
  gl.uniform1i(ru['uShadowCasterCount']!, shadowCasterCount);
  if (shadowCasterCount > 0) {
    const loc = ru['uShadowCasters[0]'];
    if (loc) gl.uniform4fv(loc, glState.shadowCasters.subarray(0, shadowCasterCount * 4));
  }

  // Bind data textures to texture units.
  bindTextureUnit(gl, glState.cellsTex, ru['uCells']!, 0);
  bindTextureUnit(gl, glState.wallTexTex, ru['uWallTex']!, 1);
  bindTextureUnit(gl, glState.floorTexTex, ru['uFloorTex']!, 2);
  bindTextureUnit(gl, glState.featuresTex, ru['uFeatures']!, 3);
  bindTextureUnit(gl, glState.lightTex, ru['uLight']!, 4);
  bindTextureUnit(gl, glState.fogTex, ru['uFog']!, 5);
  bindTextureUnit(gl, glState.doorStatesTex, ru['uDoorStates']!, 6);
  bindTextureUnit(gl, glState.atlasTex, ru['uAtlas']!, 7);
  bindTextureUnit(gl, glState.surfaceAtlasTex, ru['uSurfaceAtlas']!, 8);
  bindTextureUnit(gl, glState.surfaceIdxTex, ru['uSurfaceIdx']!, 9);
  bindTextureUnit(gl, glState.dynamicSkyTex, ru['uDynamicSky']!, 10);
  bindTextureUnit(gl, glState.ceilTex, ru['uCeil']!, 11);
  bindTextureUnit(gl, glState.lightBlinksTex, ru['uLightBlinks']!, 12);
  
  gl.uniform1i(ru['uSamosborAlert']!, samosborActive ? 1 : 0);

  // Atlas size
  const atlasRows = Math.ceil(textures.length / ATLAS_COLS);
  gl.uniform2f(ru['uAtlasSize']!, ATLAS_COLS * ATLAS_TEX_SIZE, atlasRows * ATLAS_TEX_SIZE);

  // Draw fullscreen quad — enable depth write via gl_FragDepth
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.ALWAYS);
  gl.bindVertexArray(glState.rayVAO);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // ── Render sprites into FBO (with depth test against raycaster) ──
  gl.depthFunc(gl.LESS);
  updateAndRenderMeshPass(glState, world, camera, time, fogDensity, meshFogRgb, visualGeometryProfile, ambientLight, samosborActive);
  renderSpritesGL(
    world,
    sprites,
    entities,
    px,
    py,
    pAngle,
    pPitch,
    fogDensity,
    purpleFog,
    camHeight,
    time,
    fogRgb,
    planeLen,
    true,
    visualGeometryProfile.enabled && visualGeometryProfile.includeEntities,
    visualGeometryProfile.enabled,
    ambientLight,
    flashlight,
    toolBeam,
    toolBeamRange,
    samosborActive,
    lightingQuality,
  );

  // ── Render transient particles into FBO ──
  if (bloodParticles.length > 0) {
    renderParticlesGL(bloodParticles, px, py, pAngle, pPitch, camHeight, fogDensity, purpleFog, fogRgb, planeLen);
  }

  gl.disable(gl.DEPTH_TEST);

  // ── Render critters pass (stub for marx_74) ──
  if (getCritterRenderEnabled(currentFps)) {
    // Critters will be rendered here
  }

  // ── Pass 1.5: Bloom (bright-pass prefilter + separable Gaussian blur) ──
  // Render-only glow; gated to high/experimental lighting quality. Result lands in bloomTexA.
  let bloomStrength = 0;
  if (lightingQuality >= 3) {
    bloomStrength = lightingQuality >= 4 ? 0.15 : 0.08;
    const bw = Math.max(1, SCR_W >> 1);
    const bh = Math.max(1, SCR_H >> 1);
    gl.viewport(0, 0, bw, bh);

    // Bright-pass: scene color → bloomFBO_A
    gl.bindFramebuffer(gl.FRAMEBUFFER, glState.bloomFBO_A);
    gl.useProgram(glState.bloomPrefilterProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, glState.rayColorTex);
    gl.uniform1i(glState.bloomPrefilterUniforms['uTex']!, 0);
    gl.uniform2f(glState.bloomPrefilterUniforms['uTexel']!, 1 / SCR_W, 1 / SCR_H);
    gl.uniform1f(glState.bloomPrefilterUniforms['uThreshold']!, 0.95);
    gl.bindVertexArray(glState.bloomVAOPrefilter);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Separable blur (horizontal A→B, then vertical B→A)
    gl.useProgram(glState.bloomBlurProgram);
    gl.bindVertexArray(glState.bloomVAOBlur);
    gl.bindFramebuffer(gl.FRAMEBUFFER, glState.bloomFBO_B);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, glState.bloomTexA);
    gl.uniform1i(glState.bloomBlurUniforms['uTex']!, 0);
    gl.uniform2f(glState.bloomBlurUniforms['uDir']!, 1 / bw, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindFramebuffer(gl.FRAMEBUFFER, glState.bloomFBO_A);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, glState.bloomTexB);
    gl.uniform1i(glState.bloomBlurUniforms['uTex']!, 0);
    gl.uniform2f(glState.bloomBlurUniforms['uDir']!, 0, 1 / bh);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // ── Pass 2: Blit FBO to screen with glitch ──
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

  gl.useProgram(glState.blitProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, glState.rayColorTex);
  gl.uniform1i(glState.blitUniforms['uTex']!, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, glState.bloomTexA);
  gl.uniform1i(glState.blitUniforms['uBloomTex']!, 1);
  gl.uniform1f(glState.blitUniforms['uBloomStrength']!, bloomStrength);
  gl.uniform1f(glState.blitUniforms['uGlitch']!, glitch);
  gl.uniform1f(glState.blitUniforms['uTime']!, time);
  gl.uniform1f(glState.blitUniforms['uSamosborActive']!, samosborActive ? 1.0 : 0.0);
  gl.uniform1i(glState.blitUniforms['uSamosborStyle']!, samosborStyle);
  gl.uniform1f(glState.blitUniforms['uSamosborPost']!, samosborPost);
  gl.uniform3f(glState.blitUniforms['uSamosborTint']!, fogRgb[0] / 255, fogRgb[1] / 255, fogRgb[2] / 255);
  gl.uniform1f(glState.blitUniforms['uScreenInterference']!, Math.max(0, Math.min(1, screenInterference)));

  gl.bindVertexArray(glState.blitVAO);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function toroidalDelta(a: number, b: number): number {
  let d = a - b;
  if (d > W / 2) d -= W;
  if (d < -W / 2) d += W;
  return d;
}

function wrapWorldFloat(v: number): number {
  return ((v % W) + W) % W;
}

function distanceFogFactor(dist: number, fogDensity: number): number {
  if (fogDensity <= 0 || dist <= 0) return 0;
  const x = dist * fogDensity;
  // Linear/exponential fog as specified: visibility = exp(-fogDensity * distance)
  // Distance factor will use inverse: factor = 1.0 - visibility
  return Math.min(0.985, Math.max(0, 1.0 - Math.exp(-x)));
}



function samosborScreenFxCode(screenFx: string | undefined): number {
  switch (screenFx) {
    case 'wet_noise': return 1;
    case 'electric_static': return 2;
    case 'meat_pulse': return 3;
    case 'green_signal': return 4;
    case 'gold_bell': return 5;
    case 'white_exposure': return 6;
    case 'violet_noise':
    default: return 0;
  }
}

function hasTumannikRenderOffset(e: Entity): boolean {
  if (e.monsterKind !== MonsterKind.TUMANNIK) return false;
  const ai = e.ai;
  return Math.abs(ai?.fogOffsetX ?? 0) > 0.05 || Math.abs(ai?.fogOffsetY ?? 0) > 0.05;
}

function pushVisibleSprite(
  count: number,
  entity: Entity | null,
  dx: number,
  dy: number,
  dist: number,
  spriteIdx: number,
  scale: number,
  spriteZ: number,
  projectile: number,
  seed: number,
  source: VisibleSpriteSource,
): number {
  if (count >= VISIBLE_SPRITE_CAP || spriteIdx < 0) return count;
  visibleEntities[count] = entity;
  visibleDx[count] = dx;
  visibleDy[count] = dy;
  visibleDist[count] = dist;
  visibleSpriteIdx[count] = spriteIdx;
  visibleSpriteScale[count] = scale;
  visibleSpriteZ[count] = spriteZ;
  visibleProjectile[count] = projectile;
  visibleSeed[count] = seed;
  visibleSource[count] = source;
  visibleOrder[count] = count;
  return count + 1;
}

function featureSpriteScale(feature: Feature): number {
  switch (feature) {
    case Feature.CANDLE: return 0.34;
    case Feature.LAMP: return 0.48;
    case Feature.CHAIR: return 0.42;
    case Feature.TABLE:
    case Feature.DESK: return 0.55;
    case Feature.BED: return 0.75;
    case Feature.STOVE:
    case Feature.SINK:
    case Feature.TOILET: return 0.58;
    case Feature.SHELF:
    case Feature.MACHINE:
    case Feature.APPARATUS: return 0.7;
    case Feature.LIFT_BUTTON:
    case Feature.SCREEN:
    case Feature.SLIDE: return 0.52;
    default: return 0.5;
  }
}

function featureSpriteZ(feature: Feature, tier: number = 0): number {
  switch (feature) {
    case Feature.LIFT_BUTTON:
    case Feature.SCREEN:
    case Feature.SLIDE: return 0.22;
    case Feature.LAMP: return (1.0 + Math.max(0, tier) * 0.5) - 0.88;
    default: return 0;
  }
}

function featureOffset(feature: Feature, x: number, y: number): { ox: number; oy: number } {
  const h = ((x * 73856093) ^ (y * 19349663) ^ (feature * 83492791)) >>> 0;
  return {
    ox: (((h & 3) - 1.5) * 0.035),
    oy: ((((h >>> 2) & 3) - 1.5) * 0.035),
  };
}

function containerSpriteScale(kind: ContainerKind): number {
  switch (kind) {
    case ContainerKind.CASHBOX: return 0.42;
    case ContainerKind.SECRET_STASH: return 0.45;
    case ContainerKind.TRASH_BIN: return 0.52;
    case ContainerKind.WOODEN_CHEST:
    case ContainerKind.WEAPON_CRATE:
    case ContainerKind.EMERGENCY_BOX: return 0.58;
    case ContainerKind.MEDICAL_CABINET:
    case ContainerKind.METAL_CABINET:
    case ContainerKind.FILING_CABINET:
    case ContainerKind.TOOL_LOCKER:
    case ContainerKind.FRIDGE:
    case ContainerKind.SAFE: return 0.68;
    default: return 0.58;
  }
}

function collectStaticObjectSprites(world: World, px: number, py: number, count: number): number {
  const maxDist2 = MAX_DRAW * MAX_DRAW;
  for (const container of world.containers) {
    if (container.access === 'secret' && !container.discovered) continue;
    const ox = container.x + 0.55;
    const oy = container.y + 0.5;
    const dx = toroidalDelta(ox, px);
    const dy = toroidalDelta(oy, py);
    const dist = dx * dx + dy * dy;
    if (dist >= maxDist2) continue;
    count = pushVisibleSprite(
      count,
      null,
      dx,
      dy,
      dist,
      containerSpr(container.kind),
      containerSpriteScale(container.kind),
      0,
      0,
      container.id,
      VisibleSpriteSource.CONTAINER,
    );
    if (count >= VISIBLE_SPRITE_CAP) return count;
  }

  const cx = Math.floor(px);
  const cy = Math.floor(py);
  for (let oy = -STATIC_OBJECT_RADIUS; oy <= STATIC_OBJECT_RADIUS; oy++) {
    const y = world.wrap(cy + oy);
    for (let ox = -STATIC_OBJECT_RADIUS; ox <= STATIC_OBJECT_RADIUS; ox++) {
      const x = world.wrap(cx + ox);
      const idx = world.idx(x, y);
      const feature = world.features[idx] as Feature;
      if (feature === Feature.NONE || feature === Feature.CANDLE) continue;
      const cell = world.cells[idx];
      if (cell !== Cell.FLOOR && cell !== Cell.WATER) continue;
      const off = featureOffset(feature, x, y);
      const sx = x + 0.5 + off.ox;
      const sy = y + 0.5 + off.oy;
      const dx = toroidalDelta(sx, px);
      const dy = toroidalDelta(sy, py);
      const dist = dx * dx + dy * dy;
      if (dist >= maxDist2) continue;
      count = pushVisibleSprite(
        count,
        null,
        dx,
        dy,
        dist,
        featureSpr(feature),
        featureSpriteScale(feature),
        featureSpriteZ(feature, world.ceilHeight[idx]),
        0,
        idx,
        VisibleSpriteSource.FEATURE,
      );
      if (count >= VISIBLE_SPRITE_CAP) return count;
    }
  }
  return count;
}

/* ── Sprite rendering (GL) ────────────────────────────────────── */
function renderSpritesGL(
  world: World,
  _sprites: SpriteData[],
  _entities: Entity[],
  px: number, py: number, pAngle: number, pPitch: number,
  fogDensity: number, purpleFog: number,
  camHeight: number,
  time: number,
  activeFogRgb: readonly [number, number, number],
  planeLen: number,
  renderStaticObjectSprites: boolean,
  meshBackedBillboardSprites: boolean,
  meshBackedFeatures: boolean = false,
  ambientLight: number = 0.12,
  flashlight: number = 0,
  toolBeam: number = 0,
  toolBeamRange: number = 0,
  samosborActive: boolean = false,
  lightingQuality: number = 4,
): void {
  if (!glState) return;
  const { gl } = glState;

  const dirX = Math.cos(pAngle);
  const dirY = Math.sin(pAngle);
  const planeX = -dirY * planeLen;
  const planeY = dirX * planeLen;
  const horizonShift = Math.floor(pPitch * SCR_H);
  const halfH = Math.floor(SCR_H / 2) + horizonShift;
  const invDet = 1.0 / (planeX * dirY - dirX * planeY);

  // Fog color
  const skyFog = activeDynamicSky?.fogTint;
  const fogR = purpleFog ? activeFogRgb[0] / 255 : skyFog ? skyFog.r / 255 : 5 / 255;
  const fogG = purpleFog ? activeFogRgb[1] / 255 : skyFog ? skyFog.g / 255 : 5 / 255;
  const fogB = purpleFog ? activeFogRgb[2] / 255 : skyFog ? skyFog.b / 255 : 8 / 255;
  beginAnimatedEntityTextureFrame();
  const canResolveAnimatedEntityTextures = hasAnimatedEntityTextureResolvers();

  // Collect visible entities without per-frame record allocation.
  let visibleCount = 0;
  getEntityIndex().queryRadiusCapped(px, py, MAX_DRAW, visibleEntityQuery, ENTITY_MASK_VISIBLE, VISIBLE_ENTITY_QUERY_CAP);
  lastRenderSceneDebugStats.visibleEntityQueryResults = visibleEntityQuery.length;
  for (const e of visibleEntityQuery) {
    if (!e.alive || isPlayerEntity(e)) continue;
    if (meshBackedBillboardSprites && e.type === EntityType.BILLBOARD) continue;
    const renderX = hasTumannikRenderOffset(e) ? wrapWorldFloat(e.x + (e.ai?.fogOffsetX ?? 0)) : e.x;
    const renderY = hasTumannikRenderOffset(e) ? wrapWorldFloat(e.y + (e.ai?.fogOffsetY ?? 0)) : e.y;
    const dx = toroidalDelta(renderX, px);
    const dy = toroidalDelta(renderY, py);
    const dist = dx * dx + dy * dy;
    if (dist < MAX_DRAW * MAX_DRAW) {
      const isProjectile = e.type === EntityType.PROJECTILE
        ? (e.projType === ProjType.FLAME ? 2 : 1)
        : 0;
      visibleCount = pushVisibleSprite(
        visibleCount,
        e,
        dx,
        dy,
        dist,
        e.sprite ?? 0,
        entityWorldSpriteScale(e),
        e.spriteZ ?? 0,
        isProjectile,
        (e.id % 997) * 0.137,
        visibleEntitySpriteSource(e),
      );
      if (visibleCount >= VISIBLE_SPRITE_CAP) break;
    }
    if (hasTumannikRenderOffset(e)) {
      const realDx = toroidalDelta(e.x, px);
      const realDy = toroidalDelta(e.y, py);
      const realDist = realDx * realDx + realDy * realDy;
      const realLight = world.light[world.idx(Math.floor(e.x), Math.floor(e.y))] ?? 0;
      if (realDist < 4.2 * 4.2 || realLight >= 0.28) {
        visibleCount = pushVisibleSprite(
          visibleCount,
          e,
          realDx,
          realDy,
          realDist,
          e.sprite ?? 0,
          Math.min(0.7, entityWorldSpriteScale(e)),
          e.spriteZ ?? 0,
          0,
          (e.id % 997) * 0.137 + 19,
          VisibleSpriteSource.ENTITY,
        );
        if (visibleCount >= VISIBLE_SPRITE_CAP) break;
      }
    }
  }
  if (renderStaticObjectSprites) {
    visibleCount = collectStaticObjectSprites(world, px, py, visibleCount);
  }
  visibleEntities.length = visibleCount;
  visibleDx.length = visibleCount;
  visibleDy.length = visibleCount;
  visibleDist.length = visibleCount;
  visibleOrder.length = visibleCount;
  visibleSpriteIdx.length = visibleCount;
  visibleSpriteScale.length = visibleCount;
  visibleSpriteZ.length = visibleCount;
  visibleProjectile.length = visibleCount;
  visibleSeed.length = visibleCount;
  visibleSource.length = visibleCount;
  // Sort far to near
  visibleOrder.sort((a, b) => visibleDist[b] - visibleDist[a]);
  lastRenderSceneDebugStats.visibleSprites = visibleCount;

  gl.useProgram(glState.spriteProgram);
  // Depth test is already enabled by caller with LESS func
  // Enable blending for alpha-tested sprites
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const su = glState.spriteUniforms;
  gl.uniform2f(su['uResolution']!, SCR_W, SCR_H);
  gl.uniform3f(su['uFogColor']!, fogR, fogG, fogB);
  gl.uniform1f(su['uTime']!, time);
  gl.bindVertexArray(glState.spriteVAO);
  gl.uniform1i(su['uIsShadow']!, 0);

  // Scene Lighting Uniforms for Sprites
  gl.uniform2f(su['uPos']!, px, py);
  gl.uniform1f(su['uAngle']!, pAngle);
  gl.uniform1f(su['uAmbient']!, ambientLight);
  gl.uniform1f(su['uFlashlight']!, flashlight);
  gl.uniform1f(su['uToolBeam']!, toolBeam);
  gl.uniform1f(su['uToolBeamRange']!, toolBeamRange);
  gl.uniform1i(su['uSamosborAlert']!, samosborActive ? 1 : 0);
  gl.uniform1i(su['uLightQuality']!, lightingQuality);

  // Dynamic Lights (Framework)
  gl.uniform1i(su['uDynamicLightCount']!, glState.dynamicLightCount);
  if (glState.dynamicLightCount > 0) {
    for (let i = 0; i < glState.dynamicLightCount && i < 8; i++) {
      gl.uniform3f(su[`uDynamicLights[${i}].pos`]!, glState.dynamicLightsPos[i * 3], glState.dynamicLightsPos[i * 3 + 1], glState.dynamicLightsPos[i * 3 + 2]);
      gl.uniform3f(su[`uDynamicLights[${i}].color`]!, glState.dynamicLightsColor[i * 3], glState.dynamicLightsColor[i * 3 + 1], glState.dynamicLightsColor[i * 3 + 2]);
      gl.uniform1f(su[`uDynamicLights[${i}].radius`]!, glState.dynamicLightsRadius[i]);
    }
  }

  gl.uniform1i(su['uShadowCasterCount']!, glState.shadowCasterCount);
  if (glState.shadowCasterCount > 0) {
    const loc = su['uShadowCasters[0]'];
    if (loc) gl.uniform4fv(loc, glState.shadowCasters.subarray(0, glState.shadowCasterCount * 4));
  }

  // Bind data textures for shadows and lighting
  bindTextureUnit(gl, glState.cellsTex, su['uCells']!, 1);
  bindTextureUnit(gl, glState.doorStatesTex, su['uDoorStates']!, 2);
  bindTextureUnit(gl, glState.lightTex, su['uLight']!, 3);
  bindTextureUnit(gl, glState.lightBlinksTex, su['uLightBlinks']!, 4);

  let drawnSprites = 0;
  for (let oi = 0; oi < visibleCount; oi++) {
    const vi = visibleOrder[oi];
    const e = visibleEntities[vi];
    const dx = visibleDx[vi];
    const dy = visibleDy[vi];
    const dist = visibleDist[vi];
    const txf = invDet * (dirY * dx - dirX * dy);
    const tyf = invDet * (-planeY * dx + planeX * dy);
    if (tyf <= 0.1) continue;

    const spriteScreenX = Math.floor((SCR_W / 2) * (1 + txf / tyf));
    const rawH = Math.abs(Math.floor(SCR_H / tyf));
    const source = visibleSource[vi];
    const scale = source === VisibleSpriteSource.ITEM_DROP
      ? visibleSpriteScale[vi] * ITEM_DROP_WORLD_SPRITE_SCALE
      : visibleSpriteScale[vi];
    const spriteH = Math.floor(rawH * scale);
    const spriteW = spriteH;

    const spriteZ = visibleSpriteZ[vi];
    const sprIdx = visibleSpriteIdx[vi];
    const groundInset = usesStaticObjectGroundInset(source) ? glState.spriteGroundInsets[sprIdx] ?? 0 : 0;
    const footY = halfH + Math.floor(rawH * camHeight) - Math.floor(rawH * spriteZ);
    const startY = footY - spriteH + Math.floor(spriteH * groundInset);

    const ff = distanceFogFactor(Math.sqrt(dist), fogDensity);
    const isProjectile = visibleProjectile[vi];
    const normDepth = Math.max(0.0, Math.min(1.0, 1.0 - 0.1 / Math.max(0.1, tyf)));

    // Bind sprite texture. Item drops, animated frames and procedural actors
    // can override the shared atlas without changing saved entity payloads.
    let animatedSpriteTexture = false;
    let spriteTex = source === VisibleSpriteSource.ITEM_DROP ? itemDropTexture(e) : null;
    if (!spriteTex && e && source !== VisibleSpriteSource.ITEM_DROP && canResolveAnimatedEntityTextures) {
      const animationTexture = animatedEntityTextureOverride(gl, e, world, time, sprIdx, source, scale, spriteZ);
      if (animationTexture) {
        spriteTex = animationTexture.texture;
        animatedSpriteTexture = true;
      }
    }
    if (!spriteTex && e) spriteTex = proceduralEntityTexture(e);
    if (!spriteTex && sprIdx >= 0 && sprIdx < glState.spriteTextures.length) {
      spriteTex = glState.spriteTextures[sprIdx];
    }
    if (!spriteTex) continue;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, spriteTex);
    gl.uniform1i(su['uSpriteTex']!, 0);

    const skipTexture = meshBackedFeatures && (source === VisibleSpriteSource.FEATURE || source === VisibleSpriteSource.CONTAINER);

    /* ── Drop Shadow & Reflection ─────────────────────────── */
    if (!isProjectile && spriteH > 2) {
      const ex = px + dx, ey = py + dy;
      const eci = world.idx(Math.floor(ex), Math.floor(ey));
      const eFloor = world.cells[eci] & 0xFF;
      const eLight = world.light[eci] ?? 0;

      // 1) Reflection on glossy floors (19 = F_WATER, 51 = F_MARBLE_TILE, 10 = F_TILE)
      if (eFloor === 19 || eFloor === 51 || eFloor === 10) {
        const refAlpha = eFloor === 19 ? 0.6 : (eFloor === 51 ? 0.25 : 0.15);
        gl.uniform1i(su['uIsShadow']!, 1);
        gl.uniform1f(su['uShadowFloorH']!, camHeight * SCR_H);
        gl.uniform1f(su['uScreenX']!, spriteScreenX);
        gl.uniform1f(su['uShearX']!, 0);
        gl.uniform1f(su['uSpriteW']!, spriteW);
        gl.uniform1f(su['uSpriteH']!, spriteH);
        gl.uniform1f(su['uStartY']!, footY);
        gl.uniform1f(su['uDepth']!, halfH);
        gl.uniform1f(su['uFogF']!, ff);
        gl.uniform1i(su['uIsProjectile']!, 0);
        gl.uniform1f(su['uSeed']!, refAlpha);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }

      // 2) Drop shadow blob (for ambient lighting)
      let shadowIntensity = eLight;

      let bestLight: { x: number, y: number, r: number, g: number, b: number } | null = null;
      let bestWeight = -1;
      for (let i = 0; i < glState.dynamicLightCount; i++) {
        const lx = glState.dynamicLightsPos[i * 3];
        const ly = glState.dynamicLightsPos[i * 3 + 1];
        const radius = glState.dynamicLightsRadius[i];
        const dist = Math.hypot(ex - lx, ey - ly);
        if (dist < radius) {
          const lr = glState.dynamicLightsColor[i * 3];
          const lg = glState.dynamicLightsColor[i * 3 + 1];
          const lb = glState.dynamicLightsColor[i * 3 + 2];
          const weight = (1.0 - dist / radius) * Math.max(lr, lg, lb);
          if (weight > bestWeight) {
            bestWeight = weight;
            bestLight = { x: lx, y: ly, r: lr, g: lg, b: lb };
          }
        }
      }

      if (bestLight) {
        // True dynamic 2D projection drop shadow (uIsShadow == 3)
        // Project onto floor away from the light source
        const lx = bestLight.x;
        const ly = bestLight.y;
        
        let lgx = (ex - lx);
        let lgy = (ey - ly);
        const ldist = Math.hypot(lgx, lgy);
        if (ldist > 0) { lgx /= ldist; lgy /= ldist; }
        
        // Shadow length (longer if light is close, shorter if far, but capped)
        const shadowLen = Math.min(4.0, Math.max(0.5, 2.0 / (ldist + 0.1)));
        
        const shadowWorldX = (px + dx) + lgx * shadowLen;
        const shadowWorldY = (py + dy) + lgy * shadowLen;
        
        // Project shadow tip to screen
        const dxTip = shadowWorldX - px;
        const dyTip = shadowWorldY - py;
        const invDet = 1.0 / (planeX * dirY - dirX * planeY);
        const transformX = invDet * (dirY * dxTip - dirX * dyTip);
        const transformYTip = invDet * (-planeY * dxTip + planeX * dyTip);

        if (transformYTip > 0.1) {
          const tipScreenX = (SCR_W / 2) * (1.0 + transformX / transformYTip);
          const tipScreenY = halfH + Math.floor(camHeight * SCR_H) / transformYTip;
          const rawHTip = Math.abs(SCR_H / transformYTip);
          const tipW = Math.floor(rawHTip * scale);
          
          shadowIntensity = Math.max(shadowIntensity, bestWeight * 1.2);
          const shadowAlpha = Math.min(0.8, 0.4 + shadowIntensity * 0.5);

          gl.uniform1i(su['uIsShadow']!, 3);
          gl.uniform1f(su['uShadowFloorH']!, camHeight * SCR_H);
          gl.uniform3f(su['uShadowTip']!, tipScreenX, tipScreenY, tipW);
          gl.uniform1f(su['uScreenX']!, spriteScreenX);
          gl.uniform1f(su['uShearX']!, 0);
          gl.uniform1f(su['uSpriteW']!, spriteW);
          gl.uniform1f(su['uSpriteH']!, spriteH);
          gl.uniform1f(su['uStartY']!, startY);
          gl.uniform1f(su['uDepth']!, halfH);
          gl.uniform1f(su['uFogF']!, ff);
          gl.uniform1i(su['uIsProjectile']!, 0);
          gl.uniform1f(su['uSeed']!, shadowAlpha);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          gl.depthMask(false);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
      }


      gl.depthMask(true);
      gl.uniform1i(su['uIsShadow']!, 0);
    }

    if (skipTexture) continue;

    // Set uniforms for the actual sprite
    gl.uniform1i(su['uIsShadow']!, 0);
    gl.uniform1f(su['uScreenX']!, spriteScreenX);
    gl.uniform1f(su['uShearX']!, 0);
    gl.uniform1f(su['uSpriteW']!, spriteW);
    gl.uniform1f(su['uSpriteH']!, spriteH);
    gl.uniform1f(su['uStartY']!, startY);
    gl.uniform1f(su['uDepth']!, normDepth);
    gl.uniform1f(su['uFogF']!, ff);
    gl.uniform1i(su['uIsProjectile']!, isProjectile);
    gl.uniform3f(su['uSpriteWorldPos']!, px + dx, py + dy, spriteZ);
    if (isProjectile === 2) {
      gl.uniform1f(su['uSeed']!, visibleSeed[vi]);
    }

    // Switch blend mode: additive for projectiles (incl. flame), alpha for everything else
    if (isProjectile) {
      gl.blendFunc(gl.ONE, gl.ONE);
      // Flame: disable depth write — purely additive visual, should not occlude
      if (isProjectile === 2) gl.depthMask(false);
    } else {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    drawnSprites++;
    if (animatedSpriteTexture) recordDrawnAnimatedEntityTexture();

    // Restore depth mask if it was disabled for flame
    if (isProjectile === 2) gl.depthMask(true);
  }
  lastRenderSceneDebugStats.drawnSprites = drawnSprites;
  const animationStats = getAnimatedEntityTextureDebugStats();
  lastRenderSceneDebugStats.activeAnimatedSprites = animationStats.activeSprites;
  lastRenderSceneDebugStats.drawnAnimatedSprites = animationStats.drawnSprites;
  lastRenderSceneDebugStats.animatedSpriteTextureCacheSize = animationStats.cacheSize;

  gl.disable(gl.BLEND);
}

/* ── Transient particle rendering ─────────────────────────────── */
function renderParticlesGL(
  particles: BloodParticle[],
  px: number, py: number, pAngle: number, pPitch: number,
  _camHeight: number,
  fogDensity: number,
  purpleFog: number,
  activeFogRgb: readonly [number, number, number],
  planeLen: number,
): void {
  if (!glState || particles.length === 0) return;
  const { gl } = glState;

  const dirX = Math.cos(pAngle);
  const dirY = Math.sin(pAngle);
  const planeX = -dirY * planeLen;
  const planeY = dirX * planeLen;
  const horizonShift = Math.floor(pPitch * SCR_H);
  const halfH = Math.floor(SCR_H / 2) + horizonShift;
  const invDet = 1.0 / (planeX * dirY - dirX * planeY);
  const skyFog = activeDynamicSky?.fogTint;
  const fogR = purpleFog ? activeFogRgb[0] / 255 : skyFog ? skyFog.r / 255 : 5 / 255;
  const fogG = purpleFog ? activeFogRgb[1] / 255 : skyFog ? skyFog.g / 255 : 5 / 255;
  const fogB = purpleFog ? activeFogRgb[2] / 255 : skyFog ? skyFog.b / 255 : 8 / 255;

  let visibleCount = 0;
  const instanceData = glState.particleInstanceData;
  const colorData = glState.particleColorData;
  for (const p of particles) {
    if (visibleCount >= PARTICLE_INSTANCE_CAP) break;
    let dx = p.x - px;
    let dy = p.y - py;
    if (dx > W / 2) dx -= W;
    if (dx < -W / 2) dx += W;
    if (dy > W / 2) dy -= W;
    if (dy < -W / 2) dy += W;

    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= PARTICLE_CULL_DIST) continue;

    const txf = invDet * (dirY * dx - dirX * dy);
    const tyf = invDet * (-planeY * dx + planeX * dy);
    if (tyf <= 0.1) continue;

    const sx = Math.floor((SCR_W / 2) * (1 + txf / tyf));
    const screenSize = Math.min(
      PARTICLE_MAX_SCREEN_SIZE,
      (SCR_H / tyf) * PARTICLE_WORLD_SCREEN_SCALE * Math.max(0.5, p.size),
    );
    if (screenSize < PARTICLE_MIN_SCREEN_SIZE) continue;
    const pad = Math.ceil(screenSize + 1);
    if (sx < -pad || sx >= SCR_W + pad) continue;

    const sy = Math.floor(halfH + SCR_H / (tyf * 2) - p.z * SCR_H / tyf); // at impact height
    if (sy < -pad || sy >= SCR_H + pad) continue;

    const distFade = dist <= PARTICLE_FADE_START
      ? 1
      : Math.max(0, (PARTICLE_CULL_DIST - dist) / (PARTICLE_CULL_DIST - PARTICLE_FADE_START));
    const fogF = distanceFogFactor(dist, fogDensity);
    const alpha = Math.min(1, p.life * 5) * (p.alpha ?? 1) * distFade * (1 - fogF * 0.75);
    if (alpha <= 0.03) continue;
    const invFogF = 1 - fogF;
    const normDepth = Math.max(0.0, Math.min(0.999, 1.0 - 0.1 / Math.max(0.1, tyf)));
    const di = visibleCount << 2;
    instanceData[di] = sx;
    instanceData[di + 1] = sy;
    instanceData[di + 2] = screenSize;
    instanceData[di + 3] = normDepth;
    colorData[di] = (p.r / 255) * invFogF + fogR * fogF;
    colorData[di + 1] = (p.g / 255) * invFogF + fogG * fogF;
    colorData[di + 2] = (p.b / 255) * invFogF + fogB * fogF;
    colorData[di + 3] = alpha;
    visibleCount++;
  }

  if (visibleCount === 0) return;

  gl.useProgram(glState.particleProgram);
  // Depth test already enabled by caller
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);

  const pu = glState.particleUniforms;
  gl.uniform2f(pu['uResolution']!, SCR_W, SCR_H);
  gl.bindVertexArray(glState.particleVAO);

  const uploadFloats = visibleCount * 4;
  gl.bindBuffer(gl.ARRAY_BUFFER, glState.particleInstanceBuffer);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, instanceData, 0, uploadFloats);
  gl.bindBuffer(gl.ARRAY_BUFFER, glState.particleColorBuffer);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, colorData, 0, uploadFloats);

  gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, visibleCount);

  gl.depthMask(true);
  gl.disable(gl.BLEND);
}

/* ── Dispose all GL resources ─────────────────────────────────── */
export function disposeWebGL(): void {
  if (!glState) return;
  const { gl } = glState;
  glState.meshPass?.dispose(gl);
  gl.deleteProgram(glState.rayProgram);
  gl.deleteProgram(glState.blitProgram);
  gl.deleteProgram(glState.bloomPrefilterProgram);
  gl.deleteProgram(glState.bloomBlurProgram);
  gl.deleteProgram(glState.spriteProgram);
  gl.deleteProgram(glState.particleProgram);
  gl.deleteFramebuffer(glState.rayFBO);
  gl.deleteTexture(glState.rayDepthTex);
  gl.deleteTexture(glState.rayColorTex);
  gl.deleteFramebuffer(glState.bloomFBO_A);
  gl.deleteFramebuffer(glState.bloomFBO_B);
  gl.deleteTexture(glState.bloomTexA);
  gl.deleteTexture(glState.bloomTexB);
  gl.deleteTexture(glState.cellsTex);
  gl.deleteTexture(glState.wallTexTex);
  gl.deleteTexture(glState.floorTexTex);
  gl.deleteTexture(glState.featuresTex);
  gl.deleteTexture(glState.ceilTex);
  gl.deleteTexture(glState.lightTex);
  gl.deleteTexture(glState.fogTex);
  gl.deleteTexture(glState.doorStatesTex);
  gl.deleteTexture(glState.atlasTex);
  gl.deleteTexture(glState.dynamicSkyTex);
  gl.deleteTexture(glState.surfaceAtlasTex);
  gl.deleteTexture(glState.surfaceIdxTex);
  for (const t of glState.spriteTextures) gl.deleteTexture(t);
  for (const entry of glState.proceduralSpriteTextures.values()) gl.deleteTexture(entry.texture);
  for (const entry of glState.itemSpriteTextures.values()) gl.deleteTexture(entry.texture);
  resetAnimatedEntityTextureOverride(gl);
  glState = null;
}
