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

    // 3. Asymmetric Dark Adaptation & Exposure Modulation
    float exposure = max(pc.params0.y, 0.01);
    vec3 col = max(color, vec3(0.0)) * exposure;

    // 4. Tone Mapping & Dynamic Range Compression for HDR radiance
    vec3 srgb = clamp(col, 0.0, 1.0);

    // 5. CRT Phosphor Mask, 3px Scanlines, Tube Vignette, and Phosphor Wash
    if (crtOn) {
        // 3px periodic scanlines (alternating dark bands)
        float scanY = mod(gl_FragCoord.y, 3.0);
        float scan = (scanY < 1.0) ? (1.0 - pc.params1.y) : ((scanY < 2.0) ? (1.0 - pc.params1.y * 0.4) : 1.0);
        srgb *= scan;

        // RGB Phosphor Triads (subpixel vertical mask)
        float triadX = mod(gl_FragCoord.x, 3.0);
        vec3 triadMask = (triadX < 1.0) ? vec3(1.05, 0.95, 0.95) : ((triadX < 2.0) ? vec3(0.95, 1.05, 0.95) : vec3(0.95, 0.95, 1.05));
        srgb *= triadMask;

        // Radial Tube Vignette
        vec2 vigUv = uv * (1.0 - uv);
        float vig = clamp(pow(16.0 * vigUv.x * vigUv.y, pc.params1.z), 0.0, 1.0);
        srgb *= vig;

        // Soviet Phosphor Green Wash (#59F266 = rgb(0.349, 0.949, 0.400) @ faint alpha)
        vec3 phosphorTint = vec3(0.349, 0.949, 0.400);
        srgb += phosphorTint * pc.params1.w;
    }

    outColor = vec4(clamp(srgb, 0.0, 1.0), 1.0);
}
