import type { World } from '../../core/world';
import type { CameraView } from '../../systems/camera';
import type {
  ResolvedVisualGeometryProfile,
  VisualGeometryMode,
} from '../../data/visual_geometry_profiles';

export type MeshGraphicsMode = VisualGeometryMode;

export interface MeshPassContext {
  world: World;
  camera: CameraView;
  floorKey: string;
  seed: number;
  time: number;
  fogDensity?: number;
  fogColor?: readonly [number, number, number];
  ambient?: number;
  lightTex?: WebGLTexture | null;
  cellsTex?: WebGLTexture | null;
  doorStatesTex?: WebGLTexture | null;
  doorTimersTex?: WebGLTexture | null;
  lightBlinksTex?: WebGLTexture | null;
  samosborAlert?: boolean;
  dynamicLightCount?: number;
  dynamicLightsPos?: Float32Array;
  dynamicLightsColor?: Float32Array;
  dynamicLightsRadius?: Float32Array;
  mode: MeshGraphicsMode;
  profile: ResolvedVisualGeometryProfile;
}

export interface MeshPassStats {
  enabled: boolean;
  skippedReason: string;
  instances: number;
  triangles: number;
  cpuMs: number;
  visibleInstances: number;
  submittedTriangles: number;
  drawCalls: number;
  chunksConsidered: number;
  chunksBuilt: number;
  visualSlotBytesScanned: number;
  visualSlotMergeOutputs: number;
  unknownVisualSlotCodes: number;
  cpuUpdateMs: number;
  cpuBufferMs: number;
  cpuUploadMs: number;
}

export interface MeshPassHandle {
  update(context: MeshPassContext): MeshPassStats;
  render(gl: WebGL2RenderingContext, context: MeshPassContext): void;
  dispose(gl: WebGL2RenderingContext): void;
  stats(): MeshPassStats;
}

export function emptyMeshPassStats(skippedReason = ''): MeshPassStats {
  return {
    enabled: false,
    skippedReason,
    instances: 0,
    triangles: 0,
    cpuMs: 0,
    visibleInstances: 0,
    submittedTriangles: 0,
    drawCalls: 0,
    chunksConsidered: 0,
    chunksBuilt: 0,
    visualSlotBytesScanned: 0,
    visualSlotMergeOutputs: 0,
    unknownVisualSlotCodes: 0,
    cpuUpdateMs: 0,
    cpuBufferMs: 0,
    cpuUploadMs: 0,
  };
}

export interface MeshCameraUniforms {
  camX: number;
  camY: number;
  sinA: number;
  cosA: number;
  pitch: number;
  height: number;
  fovScale: number;
  near: number;
  far: number;
}

export interface MeshProjectedPoint {
  right: number;
  forward: number;
  up: number;
  ndcX: number;
  ndcY: number;
  depth: number;
  clipX: number;
  clipY: number;
  clipZ: number;
  clipW: number;
}
