import { COMMON_LIGHTING_SRC } from '../shaders_common';
import { MAX_DRAW, W, Cell } from '../../core/types';

export const MESH_VERT_SRC = /* glsl */ `#version 300 es
precision highp float;

in vec3 aWorld;
in vec3 aNormal;
in vec3 aColor;

uniform vec2 uCam;
uniform vec2 uDir;
uniform vec2 uPlane;
uniform vec2 uPitchHeight;
uniform vec2 uResolution;
uniform float uInvDet;
uniform float uWorldSize;
uniform float uMaxDraw;
uniform float uMeshRadius;

out vec3 vColor;
out vec3 vNormal;
out float vForward;
out float vDistance;
out vec2 vWorldXY;

float torusDelta(float value, float origin) {
  float d = value - origin;
  float halfSize = uWorldSize * 0.5;
  if (d > halfSize) d -= uWorldSize;
  if (d < -halfSize) d += uWorldSize;
  return d;
}

void main() {
  float dx = torusDelta(aWorld.x, uCam.x);
  float dy = torusDelta(aWorld.y, uCam.y);
  float tx = uInvDet * (uDir.y * dx - uDir.x * dy);
  float ty = uInvDet * (-uPlane.y * dx + uPlane.x * dy);
  float clipY = 2.0 * (aWorld.z - uPitchHeight.y) - 2.0 * uPitchHeight.x * ty;
  gl_Position = vec4(tx, clipY, ty - 0.2, ty);
  vColor = aColor;
  vNormal = normalize(aNormal);
  vForward = ty;
  vDistance = length(vec2(dx, dy));
  vWorldXY = aWorld.xy;
}
`;

export const MESH_FRAG_SRC = /* glsl */ `#version 300 es
precision highp float;

in vec3 vColor;
in vec3 vNormal;
in float vForward;
in float vDistance;
in vec2 vWorldXY;

uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uAmbient;
uniform float uTime;
uniform float uMaxDraw;
uniform float uMeshRadius;
uniform float uWorldSize;
uniform sampler2D uLight;
uniform float uLightOn;     // 1.0 when the baked lightmap is bound

// Add dynamic lighting arrays
uniform highp usampler2D uCells;
uniform highp usampler2D uDoorStates;
uniform highp usampler2D uLightBlinks; // W×W: light blink frequency (uint8)
uniform int uSamosborAlert;            // 1 if samosbor red alert is active

out vec4 fragColor;

const float MAX_DRAW = ${MAX_DRAW.toFixed(1)};
const int W_SIZE = ${W};
const int W_SIZE_MASK = W_SIZE - 1;

uint sampleCell(ivec2 p) {
  return texelFetch(uCells, p & W_SIZE_MASK, 0).r;
}

uint sampleDoor(ivec2 p) {
  return texelFetch(uDoorStates, p & W_SIZE_MASK, 0).r;
}

bool lightBoundaryAt(ivec2 p) {
  uint cell = sampleCell(p);
  uint doorState = cell == ${Cell.DOOR}u ? sampleDoor(p) : 0u;
  // Wall, Lift, Abyss, or closed door block light
  if (cell == ${Cell.WALL}u || cell == ${Cell.LIFT}u || cell == ${Cell.ABYSS}u) return true;
  if (cell != ${Cell.DOOR}u) return false;
  return doorState != 0u && doorState != 3u;
}

${COMMON_LIGHTING_SRC}

const float MESH_NEAR = 0.1;


float bakedLightAt(int x, int y, int wmask) {
  return texelFetch(uLight, ivec2(x & wmask, y & wmask), 0).r;
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

vec3 sampleLightSmooth(vec2 pos, int wmask) {
  vec2 p = pos - 0.5;
  ivec2 c = ivec2(floor(p));
  vec2 f = p - vec2(c);
  float l00 = bakedLightAt(c.x,     c.y,     wmask);
  float l10 = bakedLightAt(c.x + 1, c.y,     wmask);
  float l01 = bakedLightAt(c.x,     c.y + 1, wmask);
  float l11 = bakedLightAt(c.x + 1, c.y + 1, wmask);
  float lx0 = mix(l00, l10, f.x);
  float lx1 = mix(l01, l11, f.x);
  float v   = mix(lx0, lx1, f.y);
  float gx  = mix(l10 - l00, l11 - l01, f.y);
  float gy  = lx1 - lx0;
  v *= getBlinkPulse(c);
  return vec3(v, gx, gy);
}

void main() {
  if (vForward <= MESH_NEAR) discard;
  vec3 nrm = normalize(vNormal);
  float fakeDiffuse = max(0.0, dot(nrm, normalize(vec3(-0.42, 0.58, 0.72))));

  float shade;
  if (uLightOn > 0.5) {
    // Same baked lightmap the raycaster uses: meshes sit in the real lamp light,
    // so an object in an unlit cell stays dark (grounded contact shadow).
    int wmask = int(uWorldSize) - 1;
    vec3 ls = sampleLightSmooth(vWorldXY, wmask);
    float baked = ls.x;
    vec2 grad = ls.yz;
    float ndl = 0.0;
    if (dot(grad, grad) > 1e-6) ndl = max(dot(nrm.xy, normalize(grad)), 0.0);
    float eye = (1.0 - smoothstep(0.5, 11.0, vDistance)) * 0.22;
    float litBase = clamp(uAmbient + baked * (1.0 - uAmbient) + eye, 0.0, 1.2);
    litBase = pow(clamp(litBase, 0.0, 1.0), 1.32);
    float dirShade = 0.6 + 0.4 * ndl;
    shade = clamp(litBase * dirShade + fakeDiffuse * 0.08, 0.05, 1.25);
  } else {
    float side = 0.78 + 0.08 * sin(uTime * 0.7 + vColor.r * 6.2831);
    shade = clamp(uAmbient + fakeDiffuse * 0.58 + side * 0.18, 0.12, 1.0);
  }
  
  vec3 wPos = vec3(vWorldXY.x, vWorldXY.y, 0.5); // approximate mid-height
  vec3 dynLight = calculateDynamicLighting(wPos, nrm);
  shade += min(1.0, dot(dynLight, vec3(0.333)));
  
  float fogBase = max(0.0, vForward * max(0.02, uFogDensity));
  float fog = clamp(1.0 - exp(-fogBase * fogBase * 1.15), 0.0, 0.92);
  float fadeWidth = clamp(uMeshRadius * 0.22, 1.0, 3.0);
  float edgeFade = smoothstep(max(0.0, uMeshRadius - fadeWidth), uMeshRadius, vDistance);
  vec3 finalColor = vColor * shade;
  
  // Basic heuristic for emissive meshes: very bright yellow colors or when samosbor alert is active
  if (vColor.r > 0.9 && vColor.g > 0.7 && vColor.b < 0.5 && shade > 0.8) {
    if (uSamosborAlert == 1) finalColor = mix(finalColor, vec3(1.0, 0.1, 0.1) * getBlinkPulse(ivec2(int(wPos.x), int(wPos.y))), 0.8);
    else finalColor *= getBlinkPulse(ivec2(int(wPos.x), int(wPos.y)));
  }
  
  vec3 color = mix(finalColor, uFogColor, max(fog, edgeFade * 0.86));
  fragColor = vec4(color, 1.0);
}
`;

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('mesh shader allocation failed');
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown error';
    gl.deleteShader(shader);
    throw new Error(`mesh shader compile error: ${log}`);
  }
  return shader;
}

export function createMeshProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, MESH_VERT_SRC);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, MESH_FRAG_SRC);
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    throw new Error('mesh program allocation failed');
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown error';
    gl.deleteProgram(program);
    throw new Error(`mesh program link error: ${log}`);
  }
  return program;
}
