export const COMMON_LIGHTING_SRC = /* glsl */ `
#define MAX_DYNAMIC_LIGHTS 8

struct DynamicLight {
  vec3 pos;     // xy = world pos, z = height
  vec3 color;   // rgb color * intensity
  float radius; // attenuation radius
};

uniform int uDynamicLightCount;
uniform DynamicLight uDynamicLights[MAX_DYNAMIC_LIGHTS];

// 2D DDA Grid Raycast from worldPos to lightPos.
// Returns 1.0 if ray hits a wall before reaching light (occluded), 0.0 otherwise.
// Requires: bool lightBoundaryAt(ivec2 p) to be defined by the inclusion context.
float gridShadowRaycast(vec2 worldPos, vec2 lightPos) {
  vec2 rayDir = lightPos - worldPos;
  float dist = length(rayDir);
  if (dist < 0.01) return 0.0;
  rayDir /= dist;

  vec2 rayUnitStepSize = vec2(abs(1.0 / rayDir.x), abs(1.0 / rayDir.y));
  ivec2 mapCheck = ivec2(floor(worldPos));
  ivec2 targetMap = ivec2(floor(lightPos));
  vec2 rayLength1D;
  ivec2 step;

  if (rayDir.x < 0.0) {
    step.x = -1;
    rayLength1D.x = (worldPos.x - float(mapCheck.x)) * rayUnitStepSize.x;
  } else {
    step.x = 1;
    rayLength1D.x = (float(mapCheck.x) + 1.0 - worldPos.x) * rayUnitStepSize.x;
  }

  if (rayDir.y < 0.0) {
    step.y = -1;
    rayLength1D.y = (worldPos.y - float(mapCheck.y)) * rayUnitStepSize.y;
  } else {
    step.y = 1;
    rayLength1D.y = (float(mapCheck.y) + 1.0 - worldPos.y) * rayUnitStepSize.y;
  }

  float distanceWalked = 0.0;
  int maxSteps = int(dist) + 2;

  // We skip step 0 self-intersection by jumping to the loop 
  for (int i = 0; i < 32; i++) {
    if (i >= maxSteps || mapCheck == targetMap) break;
    
    if (rayLength1D.x < rayLength1D.y) {
      mapCheck.x += step.x;
      distanceWalked = rayLength1D.x;
      rayLength1D.x += rayUnitStepSize.x;
    } else {
      mapCheck.y += step.y;
      distanceWalked = rayLength1D.y;
      rayLength1D.y += rayUnitStepSize.y;
    }
    
    if (distanceWalked >= dist) break;
    
    if (lightBoundaryAt(mapCheck)) {
      return 1.0; // In shadow!
    }
  }
  return 0.0;
}

vec3 calculateDynamicLighting(vec3 worldPos, vec3 normal) {
  vec3 totalLight = vec3(0.0);
  for (int i = 0; i < MAX_DYNAMIC_LIGHTS; i++) {
    if (i >= uDynamicLightCount) break;
    DynamicLight dl = uDynamicLights[i];
    
    vec3 lightDir = dl.pos - worldPos;
    float dist = length(lightDir);
    if (dist > dl.radius) continue;
    
    // Check distance first
    float distToLight = dist;
    float lightRad = dl.radius;
    vec3 lightPos = dl.pos;
    if (distToLight >= lightRad) continue;
    
    // Check line of sight (shadow raycast against walls)
    float occluded = gridShadowRaycast(worldPos.xy, lightPos.xy);
    if (occluded > 0.5) continue;
    
    lightDir /= dist;
    
    // Hard check for normal (diffuse)
    // If surface is pointing away, no light!
    float ndl = dot(normal, lightDir);
    if (ndl <= 0.01) continue;
    
    // Attenuation
    float att = clamp(1.0 - (dist * dist) / (dl.radius * dl.radius), 0.0, 1.0);
    att *= att;
    
    totalLight += dl.color * ndl * att;
  }
  return totalLight;
}
`;
