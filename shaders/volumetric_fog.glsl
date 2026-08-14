#ifndef VOLUMETRIC_FOG_GLSL
#define VOLUMETRIC_FOG_GLSL

// volumetric_fog.glsl — Shared GLSL header for raymarching volumetric fog & light attenuation.
//
// Shared SSBO structures & layout contracts matching shaders/light_grid.comp.

struct PointLight {
    vec4 posRadius;      // xyz = world position (m), w = radius (m)
    vec4 colorIntensity; // rgb = linear color (0..1), w = effective intensity
};

struct LightGridCell {
    uint count;            // number of intersecting lights (max 15)
    uint lightIndices[15]; // indices into uPointLights array
};

#ifdef GIGA_VOLUMETRIC_GRID_BINDINGS
layout(set = 1, binding = 0, std430) readonly buffer PointLightBuffer {
    uint uPointLightCount;
    uint uReserved0;
    uint uReserved1;
    uint uReserved2;
    PointLight uPointLights[];
};

layout(set = 1, binding = 1, std430) readonly buffer LightGridBuffer {
    LightGridCell uGridCells[];
};
#endif

// Henyey-Greenstein anisotropic phase function for atmospheric scattering.
float henyey_greenstein_phase(float cosTheta, float g) {
    float g2 = g * g;
    float denom = max(1.0 + g2 - 2.0 * g * cosTheta, 1e-4);
    return (1.0 - g2) / (12.566370614 * denom * sqrt(denom));
}

// Interleaved Gradient Noise for screen-space ray jittering (prevents banding with 8-16 steps).
float ign_jitter(vec2 fragCoord) {
    return fract(52.9829189 * fract(dot(fragCoord, vec2(0.06711056, 0.00583715))));
}

// Lognormal height fog density with spatial micro-turbulent mist
float sample_volumetric_fog_density(vec3 pos, float heightScale) {
    // Z-up world: height rides z; the mist swirl noise lives in the xy plane.
    float baseDensity = exp(-clamp(heightScale * pos.z, -3.0, 3.0));
    // Spatial noise perturbation for dynamic mist swirl
    vec2 p = pos.xy * 0.15;
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = fract(sin(dot(i, vec2(12.9898, 78.233))) * 43758.5453);
    float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(12.9898, 78.233))) * 43758.5453);
    float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(12.9898, 78.233))) * 43758.5453);
    float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(12.9898, 78.233))) * 43758.5453);
    float mistNoise = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);

    return baseDensity * (0.85 + 0.30 * mistNoise);
}

// Raymarching Volumetric Accumulation
// Marches through 3D Light Grid & height fog, accumulating in-scattered light.
// Returns vec4(inscatteredColor.rgb, transmittance).
vec4 march_volumetric_fog(
    vec3 rayOrigin,
    vec3 rayDir,
    float maxDist,
    vec2 fragCoord,
    vec3 headlampPos,
    float headlampIntensity,
    float headlampRadius,
    vec3 fillDir,
    float fillStrength,
    vec3 gridMin,
    vec3 gridExt,
    vec3 cellSize,
    float timeSec,
    float samosborPulse
) {
    // Step-count-invariant (measured 2026-08-03: 12 vs 24 steps, p99 frame
    // delta = 2/765) — raise freely if the IGN dither ever reads as noise.
    const int kNumSteps = 12;
    float jitter = ign_jitter(fragCoord);
    float stepSize = maxDist / float(kNumSteps);

    vec3 inscatter = vec3(0.0);
    float transmittance = 1.0;
    // Dynamic extinction scaling when Samosbor hazard strikes (samosbor.pulse)
    float kAbsorption = 0.035 * (1.0 + clamp(samosborPulse, 0.0, 1.0) * 3.5);

    uvec3 gridDim = uvec3(uint(gridExt.x), uint(gridExt.y), uint(gridExt.z));

    for (int i = 0; i < kNumSteps; ++i) {
        float t = (float(i) + jitter) * stepSize;
        if (t >= maxDist) break;

        vec3 p = rayOrigin + rayDir * t;

        // Sample fog density at current ray position
        float density = sample_volumetric_fog_density(p, 0.04);
        float stepExtinction = density * kAbsorption * stepSize;

        // Apply Beer-Lambert law
        float stepTransmittance = exp(-stepExtinction);

        // 1. Headlamp forward scattering
        vec3 toLamp = headlampPos - p;
        float lampDistSq = dot(toLamp, toLamp);
        float lampAtt = 1.0 / (1.0 + lampDistSq / max(headlampRadius * headlampRadius, 1e-4));
        float lampCos = dot(-rayDir, toLamp) * inversesqrt(max(lampDistSq, 1e-6));
        float lampPhase = henyey_greenstein_phase(lampCos, 0.55);
        vec3 lampColor = vec3(0.95, 0.92, 0.85) * (headlampIntensity * lampAtt * lampPhase * 0.35);

        // 2. Fill light ambient scattering
        float fillCos = dot(-rayDir, normalize(fillDir));
        float fillPhase = henyey_greenstein_phase(fillCos, 0.25);
        vec3 fillColor = vec3(0.20, 0.22, 0.28) * (fillStrength * fillPhase * 0.15);

        // 3. 3D Light Grid Point Light In-scattering
        vec3 pointLightScat = vec3(0.0);
#ifdef GIGA_VOLUMETRIC_GRID_BINDINGS
        vec3 localGridPos = p - gridMin;
        ivec3 cellCoord = ivec3(floor(localGridPos / cellSize));

        if (cellCoord.x >= 0 && cellCoord.x < int(gridDim.x) &&
            cellCoord.y >= 0 && cellCoord.y < int(gridDim.y) &&
            cellCoord.z >= 0 && cellCoord.z < int(gridDim.z)) {

            uint flatIdx = uint(cellCoord.x + cellCoord.y * int(gridDim.x) + cellCoord.z * int(gridDim.x * gridDim.y));
            LightGridCell cell = uGridCells[flatIdx];

            for (uint k = 0u; k < cell.count && k < 15u; ++k) {
                uint lightIdx = cell.lightIndices[k];
                PointLight pt = uPointLights[lightIdx];

                // Torus wrap on ALL three axes with the true 256 m period
                // (kWorldExtent). The old 128 m half-period folded a light
                // 130 m away to 2 m — phantom fog glow in the wrong place —
                // and y never wrapped at all.
                vec3 toPt = pt.posRadius.xyz - p;
                toPt -= 256.0 * floor((toPt + 128.0) / 256.0);
                float dPtSq = dot(toPt, toPt);
                float radius = pt.posRadius.w;

                if (dPtSq < radius * radius) {
                    float dPt = sqrt(dPtSq);
                    float ptAtt = clamp(1.0 - (dPt / radius), 0.0, 1.0);
                    ptAtt *= ptAtt; // Smooth falloff quadratic

                    // No normalize(): a sample landing on the light centre
                    // would emit NaN into the additive inscatter term.
                    float ptCos = dot(-rayDir, toPt) / max(dPt, 1e-3);
                    float ptPhase = henyey_greenstein_phase(ptCos, 0.40);

                    pointLightScat += pt.colorIntensity.rgb * (pt.colorIntensity.w * ptAtt * ptPhase);
                }
            }
        }
#endif

        vec3 totalStepLight = lampColor + fillColor + pointLightScat;

        // In-scattering integral evaluation
        vec3 stepInscatter = totalStepLight * density * transmittance * (1.0 - stepTransmittance);
        inscatter += stepInscatter;
        transmittance *= stepTransmittance;

        if (transmittance < 0.01) break; // Early ray termination
    }

    return vec4(inscatter, transmittance);
}

// 13-parameter overload for backwards compatibility when samosborPulse is omitted
vec4 march_volumetric_fog(
    vec3 rayOrigin,
    vec3 rayDir,
    float maxDist,
    vec2 fragCoord,
    vec3 headlampPos,
    float headlampIntensity,
    float headlampRadius,
    vec3 fillDir,
    float fillStrength,
    vec3 gridMin,
    vec3 gridExt,
    vec3 cellSize,
    float timeSec
) {
    return march_volumetric_fog(
        rayOrigin, rayDir, maxDist, fragCoord,
        headlampPos, headlampIntensity, headlampRadius,
        fillDir, fillStrength, gridMin, gridExt, cellSize,
        timeSec, 0.0
    );
}

#endif // VOLUMETRIC_FOG_GLSL
