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

// Dual-lobe phase function: sharp forward Mie beam + gentle backscatter
float dual_lobe_phase(float cosTheta, float gForward, float gBack, float forwardWeight) {
    return mix(henyey_greenstein_phase(cosTheta, gBack),
               henyey_greenstein_phase(cosTheta, gForward),
               forwardWeight);
}

// Interleaved Gradient Noise for screen-space ray jittering (prevents banding with 8-16 steps).
float ign_jitter(vec2 fragCoord) {
    return fract(52.9829189 * fract(dot(fragCoord, vec2(0.06711056, 0.00583715))));
}

// Lognormal height fog density with spatial micro-turbulent airborne dust motes
float sample_volumetric_fog_density(vec3 pos, float heightScale, float timeSec) {
    // Z-up world: height rides z; the mist swirl noise lives in the xy plane.
    float baseDensity = exp(-clamp(heightScale * pos.z, -3.0, 3.0));
    
    // Spatial noise perturbation for dynamic mist swirl and airborne dust motes
    vec2 p = pos.xy * 0.15 + vec2(timeSec * 0.02, -timeSec * 0.015);
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = fract(sin(dot(i, vec2(12.9898, 78.233))) * 43758.5453);
    float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(12.9898, 78.233))) * 43758.5453);
    float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(12.9898, 78.233))) * 43758.5453);
    float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(12.9898, 78.233))) * 43758.5453);
    float mistNoise = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);

    // Fine floating dust mote noise with turbulent air drift
    vec3 dp = pos * 1.25 + vec3(timeSec * 0.06, timeSec * 0.04, -timeSec * 0.05);
    float dust = fract(sin(dot(floor(dp), vec3(27.1, 61.7, 12.4))) * 43758.5453);
    float mote = smoothstep(0.70, 0.95, dust) * 0.50;

    return baseDensity * (0.80 + 0.35 * mistNoise + mote);
}

float sample_volumetric_fog_density(vec3 pos, float heightScale) {
    return sample_volumetric_fog_density(pos, heightScale, 0.0);
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
    // 16 steps with IGN dither for ultra-smooth god-ray integration without staircasing
    const int kNumSteps = 16;
    float jitter = ign_jitter(fragCoord);
    float stepSize = maxDist / float(kNumSteps);

    vec3 inscatter = vec3(0.0);
    float transmittance = 1.0;
    
    // Dynamic extinction scaling with Samosbor hazard triggers (samosbor.pulse)
    // Blue wavelengths scatter slightly more than red for deep atmospheric scattering
    float pulse = clamp(samosborPulse, 0.0, 1.0);
    vec3 baseExtinction = mix(vec3(0.024, 0.028, 0.034), vec3(0.085, 0.035, 0.015), pulse);
    float kAbsorption = (1.0 + pulse * 4.0);

    uvec3 gridDim = uvec3(uint(gridExt.x), uint(gridExt.y), uint(gridExt.z));

    for (int i = 0; i < kNumSteps; ++i) {
        float t = (float(i) + jitter) * stepSize;
        if (t >= maxDist) break;

        vec3 p = rayOrigin + rayDir * t;

        // Sample fog density at current ray position (with airborne dust turbulence)
        float density = sample_volumetric_fog_density(p, 0.04, timeSec);
        vec3 stepExtinction = density * baseExtinction * kAbsorption * stepSize;

        // Apply Beer-Lambert law
        float stepTransmittance = exp(-dot(stepExtinction, vec3(0.3333)));

        // 1. Headlamp forward scattering (sharp god-rays with hot tungsten core)
        vec3 toLamp = headlampPos - p;
        float lampDistSq = dot(toLamp, toLamp);
        float lampAtt = 1.0 / (1.0 + lampDistSq / max(headlampRadius * headlampRadius, 1e-4));
        float lampCos = dot(-rayDir, toLamp) * inversesqrt(max(lampDistSq, 1e-6));
        // Mie forward lobe for crisp light shafts (gForward = 0.72)
        float lampPhase = dual_lobe_phase(lampCos, 0.72, -0.20, 0.88);
        const vec3 kTungstenFog = vec3(1.04, 0.88, 0.68);
        vec3 lampColor = kTungstenFog * (headlampIntensity * lampAtt * lampPhase * 0.48);

        // 2. Fill light ambient scattering (cool deep atmospheric silhouette, prevents muddy grey)
        float fillCos = dot(-rayDir, normalize(fillDir));
        float fillPhase = henyey_greenstein_phase(fillCos, 0.25);
        vec3 fillColor = vec3(0.10, 0.14, 0.22) * (fillStrength * fillPhase * 0.15);

        // 3. 3D Light Grid Point Light In-scattering (Fluorescent tubes, sodium emergency lamps, bioluminescent tubes)
        vec3 pointLightScat = vec3(0.0);
#ifdef GIGA_VOLUMETRIC_GRID_BINDINGS
        vec3 localGridPos = p - gridMin;
        ivec3 cellCoord = ivec3(floor(localGridPos / cellSize));

        if (cellCoord.x >= 0 && cellCoord.x < int(gridDim.x) &&
            cellCoord.y >= 0 && cellCoord.y < int(gridDim.y) &&
            cellCoord.z >= 0 && cellCoord.z < int(gridDim.z)) {

            uint flatIdx = uint(cellCoord.x + cellCoord.y * int(gridDim.x) + cellCoord.z * int(gridDim.x * gridDim.y));
            LightGridCell cell = uGridCells[flatIdx];
            uint count = min(cell.count, 15u);

            for (uint k = 0u; k < count; ++k) {
                uint lightIdx = cell.lightIndices[k];
                if (lightIdx == 0u) continue; // Headlamp handled separately above

                PointLight pt = uPointLights[lightIdx];

                // Torus wrap on ALL three axes with 256 m period
                vec3 toPt = pt.posRadius.xyz - p;
                toPt -= 256.0 * floor((toPt + 128.0) / 256.0);
                float dPtSq = dot(toPt, toPt);
                float radius = pt.posRadius.w;

                if (dPtSq < radius * radius && dPtSq > 1e-6) {
                    float dPt = sqrt(dPtSq);
                    float ptAtt = clamp(1.0 - (dPt / radius), 0.0, 1.0);
                    ptAtt = ptAtt * ptAtt; // Quadratic falloff

                    float ptCos = dot(-rayDir, toPt) / max(dPt, 1e-3);
                    float ptPhase = dual_lobe_phase(ptCos, 0.52, -0.18, 0.82);

                    // Dynamic light response: 100Hz micro-flicker for fluorescent lights
                    vec3 ptCol = pt.colorIntensity.rgb;
                    if (ptCol.r < ptCol.b * 1.15) {
                        // Fluorescent tube 100Hz AC ballast flicker & phosphor tint
                        float flick = 1.0 + 0.045 * sin(timeSec * 628.3185 + pt.posRadius.x * 23.1 + pt.posRadius.y * 17.3 + pt.posRadius.z * 13.7);
                        ptCol *= flick * vec3(0.92, 0.98, 1.05);
                    } else if (ptCol.r > ptCol.b * 1.8) {
                        // Sodium warm emergency light
                        ptCol = mix(ptCol, vec3(1.0, 0.58, 0.10), 0.45);
                    }

                    pointLightScat += ptCol * (pt.colorIntensity.w * ptAtt * ptPhase * 1.30);
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
