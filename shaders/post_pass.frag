#version 450

layout(location = 0) in vec2 vNdc;
layout(location = 1) in vec2 vUv;

layout(location = 0) out vec4 outColor;

layout(binding = 0) uniform sampler2D sSceneColor;

layout(push_constant) uniform PostPush {
    // params0: x = timeSec, y = darkAdaptation (exposure factor), z = crtEnabled (1.0 or 0.0), w = chromaticAberration (e.g. 0.003)
    vec4 params0;
    // params1: x = curvature (e.g. 0.035), y = scanlineIntensity (e.g. 0.35), z = vignettePower (e.g. 0.40), w = phosphorWash (e.g. 0.04)
    vec4 params1;
    // resolution: x = width, y = height, z = 1.0/width, w = 1.0/height
    vec4 resolution;
} pc;

void main() {
    vec2 uv = vUv;
    bool crtOn = (pc.params0.z > 0.5);

    // 1. CRT Tube Curvature (Barrel Distortion)
    if (crtOn) {
        vec2 cc = uv * 2.0 - 1.0;
        float dist = dot(cc, cc);
        cc = cc * (1.0 + pc.params1.x * dist + pc.params1.x * 0.5 * dist * dist);
        uv = (cc + 1.0) * 0.5;

        // Clip pixels falling outside the curved phosphor surface
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
            outColor = vec4(0.0, 0.0, 0.0, 1.0);
            return;
        }
    }

    // 2. Radial Chromatic Aberration
    vec3 color;
    if (crtOn && pc.params0.w > 0.0) {
        vec2 uvCenter = vec2(0.5);
        vec2 toCenter = uv - uvCenter;
        float caDist = dot(toCenter, toCenter);
        float caOffset = pc.params0.w * caDist;

        color.r = texture(sSceneColor, uv + toCenter * caOffset).r;
        color.g = texture(sSceneColor, uv).g;
        color.b = texture(sSceneColor, uv - toCenter * caOffset).b;
    } else {
        color = texture(sSceneColor, uv).rgb;
    }

    // 3. High-Energy Phosphor Bloom / Halation on Lamps & Hot Highlights
    vec3 bloom = vec3(0.0);
    if (crtOn) {
        vec2 invRes = pc.resolution.zw;
        if (invRes.x <= 0.0) invRes = vec2(1.0 / 1920.0, 1.0 / 1080.0);

        vec2 bOffsets[8] = vec2[](
            vec2(-2.0, -2.0), vec2(2.0, -2.0), vec2(-2.0, 2.0), vec2(2.0, 2.0),
            vec2(-3.5, 0.0),  vec2(3.5, 0.0),  vec2(0.0, -3.5), vec2(0.0, 3.5)
        );
        float bWeights[8] = float[](
            0.10, 0.10, 0.10, 0.10,
            0.15, 0.15, 0.15, 0.15
        );

        for (int i = 0; i < 8; ++i) {
            vec3 s = texture(sSceneColor, uv + bOffsets[i] * invRes).rgb;
            float sLum = dot(s, vec3(0.2126, 0.7152, 0.0722));
            float sBright = max(sLum - 0.45, 0.0) * 1.5;
            bloom += s * sBright * bWeights[i];
        }
    }

    // 4. Экспозиции НЕТ ([ddalight.md] закон №10): «тёмная адаптация»
    // (marko-порт) глушила кадр по сумме ламп у камеры — вырезана 2026-08-17.
    // params0.y свободен.
    vec3 col = color + bloom * 0.25;

    // 5. Soviet CRT Phosphor Response & Scanlines
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));

    if (crtOn) {
        // Dynamic Scanlines: crisp, subtle scanlines that naturally bleed across bright phosphors
        float scanlineDepth = pc.params1.y * clamp(1.0 - lum * 0.75, 0.05, 0.45);
        float scan = 1.0 - scanlineDepth * (0.5 + 0.5 * sin(gl_FragCoord.y * 3.14159265));
        col *= scan;

        // Subpixel RGB Phosphor Triad Mask
        float triadX = mod(gl_FragCoord.x, 3.0);
        vec3 triadMask = (triadX < 1.0) ? vec3(1.03, 0.98, 0.98) : ((triadX < 2.0) ? vec3(0.98, 1.03, 0.98) : vec3(0.98, 0.98, 1.03));
        col *= triadMask;

        // Radial Tube Vignette
        vec2 vigUv = uv * (1.0 - uv);
        float vig = clamp(pow(16.0 * vigUv.x * vigUv.y, pc.params1.z), 0.0, 1.0);
        col *= vig;

        // Luminance-Modulated Phosphor Green Wash (preserves pitch black in shadows)
        vec3 phosphorTint = vec3(0.349, 0.949, 0.400);
        col += phosphorTint * (pc.params1.w * pow(clamp(lum, 0.0, 1.0), 0.8) * 0.5);
    }

    outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
