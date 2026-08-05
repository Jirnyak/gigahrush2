import { MAX_DRAW, W } from '../../core/types';
import {
  EMPTY_RESOLVED_VISUAL_GEOMETRY_PROFILE,
} from '../../data/visual_geometry_profiles';
import {
  MESH_VERTEX_STRIDE,
  buildMeshVertexBatch,
  type MeshInstance as DrawMeshInstance,
} from './buffers';
import { createMeshProgram } from './shaders';
import {
  MeshInstanceFlag,
  collectMeshSceneWithStats,
  type MeshInstance as SceneMeshInstance,
} from './scene_collect';
import { emptyMeshPassStats, type MeshPassContext, type MeshPassHandle, type MeshPassStats } from './types';
import { visualCellDefByCode, type VisualCellFamily } from '../../data/visual_cell_slots';
import { collectVoxelChunks } from './voxel/field';
import type { VoxelChunkMesh, VoxelProfile, VoxelVisualFamily } from './voxel/types';

const MAX_GPU_TRIANGLES = 96_000;
const FLOATS_PER_VERTEX = MESH_VERTEX_STRIDE;

interface MeshGlResources {
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  vertexBuffer: WebGLBuffer;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function cloneStats(stats: MeshPassStats): MeshPassStats {
  return { ...stats };
}

function colorForSceneInstance(instance: SceneMeshInstance): readonly [number, number, number] {
  if ((instance.flags & MeshInstanceFlag.Emissive) !== 0) return [210, 174, 96];
  if (instance.modelId.includes('column')) return [112, 114, 108];
  if (instance.modelId.includes('machine') || instance.modelId.includes('apparatus')) return [82, 92, 88];
  if (instance.modelId.includes('pipe') || instance.modelId.includes('cable')) return [92, 74, 56];
  if (instance.modelId.includes('panel') || instance.modelId.includes('button')) return [82, 92, 92];
  if (instance.modelId.includes('meat') || instance.modelId.includes('organic')) return [112, 50, 50];
  if (instance.modelId.includes('cave')) return [92, 90, 82];
  if (instance.modelId.includes('collector')) return [74, 70, 60];
  if (instance.modelId.includes('corridor')) return [96, 96, 88];
  if (instance.modelId.includes('bed')) return [94, 82, 82];
  if (instance.modelId.includes('chair') || instance.modelId.includes('table') || instance.modelId.includes('desk') || instance.modelId.includes('shelf')) return [112, 82, 52];
  return [118, 112, 96];
}

function drawInstanceFromScene(instance: SceneMeshInstance): DrawMeshInstance {
  return {
    kind: instance.modelId,
    x: instance.x,
    y: instance.y,
    z: instance.z,
    yaw: instance.yaw,
    scaleX: instance.scaleX,
    scaleY: instance.scaleY,
    scaleZ: instance.scaleZ,
    color: colorForSceneInstance(instance),
    seed: instance.seed,
  };
}

function collectMeshInstances(context: MeshPassContext, out: DrawMeshInstance[], stats: MeshPassStats): void {
  out.length = 0;
  const scene = collectMeshSceneWithStats(context);
  for (const instance of scene.instances) out.push(drawInstanceFromScene(instance));
  const chunkArea = Math.max(1, Math.floor(context.profile.chunkSize || 8) ** 2);
  const chunks = Math.ceil(scene.stats.cellsScanned / chunkArea);
  stats.chunksConsidered = chunks;
  stats.chunksBuilt = chunks;
  stats.visualSlotBytesScanned = Math.min(context.profile.visualSlotScanCap, scene.stats.visualSlotsRead);
  stats.visualSlotMergeOutputs = scene.instances.filter(instance => (instance.flags & MeshInstanceFlag.Merged) !== 0).length;
  stats.unknownVisualSlotCodes = scene.stats.unknownVisualCodes;
}

function voxelFamilyForVisualCell(family: VisualCellFamily): VoxelVisualFamily | undefined {
  switch (family) {
    case 'pipe':
      return 'pipe';
    case 'cable':
      return 'cable';
    case 'organic':
      return 'organic';
    case 'ceiling':
    case 'lamp':
      return 'ceiling';
    case 'clutter':
      return 'rubble';
    default:
      return undefined;
  }
}

function classifyVoxelVisualSlot(code: number): VoxelVisualFamily | undefined {
  const def = visualCellDefByCode(code);
  return def ? voxelFamilyForVisualCell(def.family) : undefined;
}

function voxelStyleForFloorKey(floorKey: string): VoxelProfile['style'] {
  if (floorKey.includes('maintenance') || floorKey.includes('industrial')) return 'maintenance';
  if (floorKey.includes('hell') || floorKey.includes('meat')) return 'hell';
  if (floorKey.includes('void') || floorKey.includes('dark')) return 'void';
  return 'concrete';
}

function collectVoxelMeshes(context: MeshPassContext, out: VoxelChunkMesh[], stats: MeshPassStats): void {
  out.length = 0;
  const profile = context.profile;
  if (!profile.voxelEnabled || profile.voxelRadius <= 0 || profile.triangleCap <= 0) return;
  const dynamicDrawRadius = context.fogDensity !== undefined && context.fogDensity > 0.0
    ? Math.max(profile.radius, Math.ceil(2.0 / context.fogDensity))
    : profile.radius;
  const meshDrawRadius = Math.max(0, Math.min(MAX_DRAW, Math.floor(dynamicDrawRadius)));
  const voxelTriangleCap = Math.max(48, Math.min(900, Math.floor(profile.triangleCap * 0.16)));
  const voxelProfile: VoxelProfile = {
    voxelEnabled: true,
    key: `${profile.key}:voxel`,
    chunkSize: profile.chunkSize,
    fieldDepth: context.mode === 'high' ? 8 : 6,
    triangleCap: voxelTriangleCap,
    solidVoxelCap: context.mode === 'high' ? 220 : 128,
    maxChunksPerFrame: Math.min(profile.maxChunksPerFrame, context.mode === 'high' ? 2 : 1),
    voxelRadius: Math.max(profile.voxelRadius, meshDrawRadius),
    visualSlotsPerCell: 16,
    style: voxelStyleForFloorKey(context.floorKey),
  };
  const voxelStats = collectVoxelChunks({
    world: context.world,
    cameraX: context.camera.x,
    cameraY: context.camera.y,
    seed: context.seed ^ profile.seed,
    floorKey: context.floorKey,
    profile: voxelProfile,
    visualSlotClassifier: classifyVoxelVisualSlot,
  }, out);
  stats.chunksConsidered += voxelStats.chunksConsidered;
  stats.chunksBuilt += voxelStats.chunksBuilt;
}

function getUniforms(gl: WebGL2RenderingContext, program: WebGLProgram): Record<string, WebGLUniformLocation | null> {
  const names = [
    'uCam',
    'uDir',
    'uPlane',
    'uPitchHeight',
    'uResolution',
    'uInvDet',
    'uWorldSize',
    'uMaxDraw',
    'uMeshRadius',
    'uFogColor',
    'uFogDensity',
    'uAmbient',
    'uTime',
    'uLight',
    'uLightOn',
    'uCells',
    'uDoorStates',
    'uLightBlinks',
    'uSamosborAlert',
    'uDynamicLightCount',
  ];
  const out: Record<string, WebGLUniformLocation | null> = {};
  for (const name of names) out[name] = gl.getUniformLocation(program, name);
  for (let i = 0; i < 8; i++) {
    out[`uDynamicLights[${i}].pos`] = gl.getUniformLocation(program, `uDynamicLights[${i}].pos`);
    out[`uDynamicLights[${i}].color`] = gl.getUniformLocation(program, `uDynamicLights[${i}].color`);
    out[`uDynamicLights[${i}].radius`] = gl.getUniformLocation(program, `uDynamicLights[${i}].radius`);
  }
  return out;
}

function createResources(gl: WebGL2RenderingContext): MeshGlResources {
  const program = createMeshProgram(gl);
  const vao = gl.createVertexArray();
  const vertexBuffer = gl.createBuffer();
  if (!vao || !vertexBuffer) {
    if (vao) gl.deleteVertexArray(vao);
    if (vertexBuffer) gl.deleteBuffer(vertexBuffer);
    gl.deleteProgram(program);
    throw new Error('mesh buffer allocation failed');
  }
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, MAX_GPU_TRIANGLES * 3 * FLOATS_PER_VERTEX * 4, gl.DYNAMIC_DRAW);
  const stride = FLOATS_PER_VERTEX * 4;
  const bindAttrib = (name: string, size: number, offset: number): void => {
    const loc = gl.getAttribLocation(program, name);
    if (loc < 0) throw new Error(`mesh shader missing attribute ${name}`);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
  };
  bindAttrib('aWorld', 3, 0);
  bindAttrib('aNormal', 3, 3 * 4);
  bindAttrib('aColor', 3, 6 * 4);
  gl.bindVertexArray(null);
  return { program, vao, vertexBuffer, uniforms: getUniforms(gl, program) };
}

class MeshPass implements MeshPassHandle {
  private resources: MeshGlResources | null;
  private vertexData: Float32Array<ArrayBufferLike> = new Float32Array(MAX_GPU_TRIANGLES * 3 * FLOATS_PER_VERTEX);
  private vertexCount = 0;
  private needsUpload = false;
  private lastStats: MeshPassStats;
  private disposed = false;
  private readonly instanceScratch: DrawMeshInstance[] = [];
  private readonly voxelScratch: VoxelChunkMesh[] = [];

  constructor(gl: WebGL2RenderingContext) {
    try {
      this.resources = createResources(gl);
      this.lastStats = emptyMeshPassStats('not updated');
    } catch (err) {
      this.resources = null;
      this.lastStats = emptyMeshPassStats(err instanceof Error ? err.message : 'mesh init failed');
    }
  }

  update(context: MeshPassContext): MeshPassStats {
    const start = nowMs();
    const profile = context.profile ?? EMPTY_RESOLVED_VISUAL_GEOMETRY_PROFILE;
    const stats = emptyMeshPassStats();
    if (this.disposed) {
      stats.skippedReason = 'disposed';
      this.lastStats = stats;
      return cloneStats(stats);
    }
    if (context.mode === 'off' || !profile.enabled) {
      stats.skippedReason = 'mode_off';
      this.vertexCount = 0;
      this.needsUpload = false;
      this.lastStats = stats;
      return cloneStats(stats);
    }
    if (!this.resources) {
      stats.skippedReason = this.lastStats.skippedReason || 'mesh resources unavailable';
      this.lastStats = stats;
      return cloneStats(stats);
    }
    const instanceOut = this.instanceScratch;
    collectMeshInstances({ ...context, profile }, instanceOut, stats);
    collectVoxelMeshes({ ...context, profile }, this.voxelScratch, stats);
    const bufferStart = nowMs();
    const result = buildMeshVertexBatch(
      instanceOut,
      Math.min(MAX_GPU_TRIANGLES, Math.max(0, profile.triangleCap)),
      this.vertexData,
      this.voxelScratch,
    );
    stats.cpuBufferMs = nowMs() - bufferStart;
    stats.enabled = result.vertexCount > 0 && result.triangleCount > 0;
    stats.skippedReason = stats.enabled ? '' : 'no visible mesh instances';
    stats.visibleInstances = instanceOut.length;
    stats.instances = stats.visibleInstances;
    stats.submittedTriangles = result.triangleCount;
    stats.triangles = stats.submittedTriangles;
    stats.drawCalls = stats.enabled ? 1 : 0;
    this.vertexData = result.vertices;
    this.vertexCount = result.vertexCount;
    this.needsUpload = stats.enabled;
    stats.cpuUpdateMs = nowMs() - start;
    stats.cpuMs = stats.cpuUpdateMs;
    this.lastStats = stats;
    return cloneStats(stats);
  }

  render(gl: WebGL2RenderingContext, context: MeshPassContext): void {
    if (!this.resources || !this.lastStats.enabled || this.vertexCount <= 0) return;
    const uploadStart = nowMs();
    const { program, vao, vertexBuffer, uniforms } = this.resources;
    if (this.needsUpload) {
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.vertexData, 0, this.vertexCount * FLOATS_PER_VERTEX);
      this.needsUpload = false;
    }
    this.lastStats.cpuUploadMs = nowMs() - uploadStart;

    const fovScale = Math.tan((context.camera.fovRadians || Math.PI / 2) * 0.5);
    const dirX = Math.cos(context.camera.angle);
    const dirY = Math.sin(context.camera.angle);
    const planeX = -dirY * fovScale;
    const planeY = dirX * fovScale;
    const invDet = 1.0 / (planeX * dirY - dirX * planeY);
    const fog: readonly [number, number, number] = context.fogColor ?? [5, 5, 8];
    const fogDensity = context.fogDensity ?? 0.065;

    gl.useProgram(program);
    gl.uniform2f(uniforms.uCam, context.camera.x, context.camera.y);
    gl.uniform2f(uniforms.uDir, dirX, dirY);
    gl.uniform2f(uniforms.uPlane, planeX, planeY);
    gl.uniform2f(uniforms.uPitchHeight, context.camera.pitch, context.camera.height);
    gl.uniform2f(uniforms.uResolution, 320, 200);
    const dynamicDrawRadius = context.fogDensity !== undefined && context.fogDensity > 0.0
      ? Math.max(context.profile.radius, Math.ceil(2.0 / context.fogDensity))
      : context.profile.radius;
    const meshDrawRadius = Math.max(0, Math.min(MAX_DRAW, Math.floor(dynamicDrawRadius)));

    gl.uniform1f(uniforms.uInvDet, invDet);
    gl.uniform1f(uniforms.uWorldSize, W);
    gl.uniform1f(uniforms.uMaxDraw, MAX_DRAW);
    gl.uniform1f(uniforms.uMeshRadius, Math.max(0.1, meshDrawRadius));
    gl.uniform3f(uniforms.uFogColor, fog[0] / 255, fog[1] / 255, fog[2] / 255);
    gl.uniform1f(uniforms.uFogDensity, fogDensity);
    gl.uniform1f(uniforms.uAmbient, context.ambient ?? 0.18);
    gl.uniform1f(uniforms.uTime, context.time);
    // Bind the same baked lightmap the raycaster uses so meshes share scene lighting.
    if (context.lightTex) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, context.lightTex);
      gl.uniform1i(uniforms.uLight, 0);
      gl.uniform1f(uniforms.uLightOn, 1.0);
    } else {
      gl.uniform1f(uniforms.uLightOn, 0.0);
    }
    
    // Dynamic Lights
    gl.uniform1i(uniforms.uDynamicLightCount, context.dynamicLightCount ?? 0);
    if (context.dynamicLightCount && context.dynamicLightCount > 0 && context.dynamicLightsPos && context.dynamicLightsColor && context.dynamicLightsRadius) {
      for (let i = 0; i < context.dynamicLightCount && i < 8; i++) {
        gl.uniform3f(uniforms[`uDynamicLights[${i}].pos`]!, context.dynamicLightsPos[i * 3], context.dynamicLightsPos[i * 3 + 1], context.dynamicLightsPos[i * 3 + 2]);
        gl.uniform3f(uniforms[`uDynamicLights[${i}].color`]!, context.dynamicLightsColor[i * 3], context.dynamicLightsColor[i * 3 + 1], context.dynamicLightsColor[i * 3 + 2]);
        gl.uniform1f(uniforms[`uDynamicLights[${i}].radius`]!, context.dynamicLightsRadius[i]);
      }
    }
    
    gl.uniform1i(uniforms.uSamosborAlert, context.samosborAlert ? 1 : 0);
    
    // Bind data textures to fixed units so sampler types always match.
    // Units must be assigned unconditionally — inactive uniforms must not
    // shift subsequent bindings, otherwise usampler2D may receive a float
    // texture and cause GL_INVALID_OPERATION on drawArrays.
    const bindTexAt = (unit: number, tex: WebGLTexture | null | undefined, unif: WebGLUniformLocation | null) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      if (tex) gl.bindTexture(gl.TEXTURE_2D, tex);
      if (unif !== null) gl.uniform1i(unif, unit);
    };

    bindTexAt(1, context.cellsTex, uniforms.uCells);
    bindTexAt(2, context.doorStatesTex, uniforms.uDoorStates);
    bindTexAt(3, context.lightBlinksTex, uniforms.uLightBlinks);

    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-1.0, -2.0);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.useProgram(null);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
  }

  dispose(gl: WebGL2RenderingContext): void {
    this.disposed = true;
    if (!this.resources) {
      this.lastStats = emptyMeshPassStats('disposed');
      return;
    }
    gl.deleteBuffer(this.resources.vertexBuffer);
    gl.deleteVertexArray(this.resources.vao);
    gl.deleteProgram(this.resources.program);
    this.resources = null;
    this.vertexCount = 0;
    this.needsUpload = false;
    this.lastStats = emptyMeshPassStats('disposed');
  }

  stats(): MeshPassStats {
    return cloneStats(this.lastStats);
  }
}

export function createMeshPass(gl: WebGL2RenderingContext): MeshPassHandle {
  return new MeshPass(gl);
}
