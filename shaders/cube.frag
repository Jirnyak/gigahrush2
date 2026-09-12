#version 450
#extension GL_GOOGLE_include_directive : require
// ШЕЙДЕР ТЕЛ (body.vert) — и только их. До аудита 2026-08-25 это был общий
// шейдер «мир+тела» на ~670 строк: мир давно рисует raymarch.frag, а тела
// приходят с vMat = 0 (body.vert:73) — вся процедурная поверхность
// (surface/seam/mottle/chroma/бамп, ~380 строк) была недостижима у
// единственного потребителя по построению: у материала 0 sigma/chroma/bump
// нули, surface() == 1.0 точно. Слим бит-эквивалентен для тел.
// Мир-половина живёт в raymarch.frag — ЕДИНСТВЕННОМ владельце поверхности.
//
// Свет: линейное пространство, кодирование в sRGB в самом конце (свапчейн
// UNORM в SRGB_NONLINEAR — презентация не кодирует, см. vk_swapchain.cpp).
// Камерного источника нет ([CANON.md] S5); солнца нет (S15).
layout(location = 0) in vec3 vNormal;
layout(location = 1) in vec3 vColor;
layout(location = 2) in vec3 vWorldPos;
// Baked corner occlusion; body.vert пишет константу 1.0.
layout(location = 3) in float vAo;
// Материал: body.vert пишет константу 0 — интерфейс вершинной стадии общий,
// само значение здесь не читается (см. шапку).
layout(location = 4) flat in uint vMat;

#include "material_surface.glsl"
#include "surface_lib.glsl" // общие шум/ambient/spec (дедуп К5)

#define GIGA_VOLUMETRIC_GRID_BINDINGS
#include "volumetric_fog.glsl"

// Настоящие тени: DDA-луч по теневому сету вокселного зеркала (set 2,
// [voxel_mirror.h]) — тела ПРИНИМАЮТ тени мира тем же лучом, что и стены.
// Отбрасывать свои тела пока не могут — их нет в зеркале ([ddalight.md]).
#define GIGA_SHADOW_SET 2
#include "shadow_march.glsl"

layout(push_constant) uniform Push {
    mat4 viewProj;
    vec4 camPos;   // xyz = camera world position, w = МЁРТВАЯ ЛЕЙНА (нуль)
    vec4 fog;      // x = fog start, y = fog end, z = МЁРТВАЯ ЛЕЙНА, w = ambient
    vec4 torus;    // x = wrap period; y = direct-light AO share;
                   // z = samosborPulse; w = время (см. cube.vert).
                   // Блок обязан побайтно совпадать с cube.vert (общий лейаут).
} pc;

layout(location = 0) out vec4 outColor;

const float kGamma = 2.2;

void main() {
    vec3 n = normalize(vNormal);
    vec3 albedo = pow(vColor, vec3(kGamma));

    // Тела без карт: шершавость — константа гладкой кожи/ткани.
    float roughness = 0.50;
    vec3 toCam = pc.camPos.xyz - vWorldPos;
    float d = length(toCam);
    vec3 V = toCam / max(d, 1e-4);
    float specPow, specIntensity;
    spec_terms(roughness, specPow, specIntensity);

    // Прямой свет — ЕДИНЫЙ цикл по light grid: лампы этажа, фонарик в руке,
    // мобы, трассеры, конусы. Камерного источника в сетке нет (S5).
    // [volumetric_fog.glsl]
    vec3 directDiffuse, directSpec;
    surface_light(vWorldPos, n, V, specPow, specIntensity, pc.torus.x,
                  d, pc.fog.x, directDiffuse, directSpec);

    // Направленный fill («солнце») ВЫРЕЗАН решением владельца 2026-08-25:
    // в Гигахруще нет солнца (S15) — свет только лампы + ambient.

    // World +Z as "up" is a render-local aesthetic choice, not a claim about
    // gravity — gravity is a vector and lives in the sim (world.gravity()).
    // Deleting this term changes pixels, never outcomes.
    vec3 amb = hemi_ambient(n, pc.fog.w); // единая шкала ambient (К5)

    float ao = kAoFloor + (1.0 - kAoFloor) * vAo;
    float aoDirect = mix(1.0, ao, pc.torus.y);
    vec3 lit = albedo * (amb * ao + directDiffuse * aoDirect) + directSpec * aoDirect;

    // (Эмиссива нет: тела ходят с vMat=0 — kMatEmissive[0] == 0.)

    // Dynamically scale fog opacity & flickering during Samosbor hazard triggers
    // fog.y is kWorldExtent*0.50*fogScale, so fogScale = fog.y / (extent*0.5) and
    // the pulse is (1 - fogScale) / (1 - kSamosborFogSqueeze). Both constants used
    // to be wrong here: the divisor was 128.0*0.50 = 64 instead of the 128 that is
    // kWorldExtent*0.5, and the ramp was /0.70 instead of /0.66. Together they ran
    // samosborPulse едет ГОТОВЫМ в torus.z (как у prop.frag/raymarch) — прежний
    // обратный вывод из fog.y был третьей реализацией одной величины и вёз
    // дубль kSamosborFogSqueeze литералом 0.66 (аудит 2026-08-20).
    float samosborPulse = clamp(pc.torus.z, 0.0, 1.0);

    // Volumetric fog raymarching with world-aligned light grid & Samosbor pulse
    float fogT = march_volumetric_fog(
        pc.camPos.xyz,
        normalize(vWorldPos - pc.camPos.xyz),
        min(d, pc.fog.y),
        gl_FragCoord.xy,
        samosborPulse
    );
    lit = lit * fogT;

    float fog = distance_fog(d, pc.fog.x, pc.fog.y);

    // Dynamic Samosbor fog flickering
    float fogFlicker = 1.0 + samosborPulse * 0.35 * sin(pc.torus.w * 22.0 + vWorldPos.x * 0.4 + vWorldPos.y * 0.3);
    fog = clamp(fog * fogFlicker, 0.0, 1.0);

    lit = mix(lit, vec3(0.0), fog);

    // ACES Filmic Tonemapping to compress highlights with rich filmic toe & shoulder:
    vec3 x = max(lit, vec3(0.0));
    vec3 mapped = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
    vec3 srgb = pow(mapped, vec3(1.0 / kGamma));

    outColor = vec4(srgb, 1.0);
}
