#ifndef VOLUMETRIC_FOG_GLSL
#define VOLUMETRIC_FOG_GLSL

// volumetric_fog.glsl — ЕДИНЫЙ заголовок света: универсальная запись источника
// (точка/конус — один структ), world-aligned light grid на весь тор, прямой
// свет поверхностям (surface_light) и объёмное рассеяние в дымке
// (march_volumetric_fog). Закон один: КАЖДЫЙ источник освещает КАЖДУЮ
// поверхность и каждый шаг тумана одним и тем же кодом; тень — через
// giga_shadow(), который каждый шейдер определяет своим лучшим средством
// (raymarch — DDA-лучом по вокселному зеркалу, растровые пассы пока стабом).
//
// Shared SSBO structures & layout contracts matching shaders/light_grid.comp.

struct PointLight {
    vec4 posRadius;      // xyz = world position (m), w = radius (m)
    vec4 colorIntensity; // rgb = linear color (0..1), w = effective intensity
    vec4 dirCone;        // xyz = spot direction (unit), w = cos(outer half-angle);
                         // w <= -1.5 — сентинель «омни» (конуса нет). Один структ
                         // на лампочку, налобник, прожектор и трассер — универсальные
                         // источники живут вместе по построению.
};

struct LightGridCell {
    uint count;            // number of intersecting lights (max 31)
    uint lightIndices[31]; // indices into uPointLights array
};

// Сетка света = ВЕСЬ тор: 64³ клеток по 4 м = 256 м = kWorldExtent, привязана к
// миру, не к камере. Индекс — floor(p/4) & 63, как cell_index у вокселей: врап
// на битовом И, промахов «вне коробки» не существует по построению. Камерная
// коробка 64×32×64 м была классом багов сама по себе — свет за её гранью
// просто исчезал, хотя видимость 128 м. [gpu_light_grid.h — числа обязаны
// совпадать]
const int   kLightGridDim  = GIGA_LIGHT_GRID_DIM;  // -D из CMakeLists <- gpu_light_grid.h
const float kLightGridCell = GIGA_LIGHT_GRID_CELL;

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
// t*sqrt(t) вместо pow(t,1.5): pow компилируется в exp/log, а эта фаза
// считается [шаги дымки]×[света клетки] раз на пиксель — миллиардный масштаб.
float henyey_greenstein_phase(float cosTheta, float g) {
    float g2 = g * g;
    float t = max(1.0 + g2 - 2.0 * g * cosTheta, 1e-4);
    return (1.0 - g2) / (12.566370614 * t * sqrt(t));
}

// Interleaved Gradient Noise for screen-space ray jittering (prevents banding with 8-16 steps).
float ign_jitter(vec2 fragCoord) {
    return fract(52.9829189 * fract(dot(fragCoord, vec2(0.06711056, 0.00583715))));
}

// Дистанционный туман — ЕДИНСТВЕННАЯ формула на весь рендер (мир, пропсы,
// провода, ткань, частицы). Гладкое смыкание в чёрный ровно на радиусе fogEnd —
// той же дистанции, где march/cull обрезают геометрию, — поэтому «границы
// видимости» не существует по построению: поверхность тонет в ноль РАНЬШЕ, чем
// перестаёт рисоваться. smoothstep даёт нулевую производную на обоих концах
// (ни вход в дымку, ни смыкание не читаются полосой) и ТОЧНО 1.0 при
// d >= fogEnd — закон «туман в чёрный прячет шов тора» ([main.cpp]) выполняется
// без страховочного if. Хоронит kFogDistScale=0.20 — рудимент выпиленной
// высотной формулы: тот множитель сжимал дистанцию так, что fog≡0 на всей
// видимой дальности, и граница march читалась резким обрывом в черноту.
float distance_fog(float dist, float fogStart, float fogEnd) {
    return smoothstep(fogStart, fogEnd, dist);
}

// Ближайший торический образ вектора «от точки к свету», все ТРИ оси, период
// пушится (никогда не литерал — половинный период сворачивал свет со 130 м в
// 2 м, фантомное свечение не там).
vec3 wrap_nearest(vec3 d, float period) {
    return d - period * floor((d + 0.5 * period) / period);
}

// Затухание по радиусу: квадратичный спад, тот же для дымки и поверхностей —
// один источник обязан выглядеть одинаково в воздухе и на стене.
float light_attenuation(float dist, float radius) {
    float a = clamp(1.0 - dist / radius, 0.0, 1.0);
    return a * a;
}

// Конус прожектора: 1.0 для омни (w <= -1.5); иначе гладкий спад от внутренней
// границы к внешней. toPoint — единичный вектор ОТ света К точке.
float spot_factor(vec4 dirCone, vec3 toPoint) {
    if (dirCone.w <= -1.5) return 1.0;
    float cosA = dot(dirCone.xyz, toPoint);
    float cosOuter = dirCone.w;
    float cosInner = mix(cosOuter, 1.0, 0.4);
    return smoothstep(cosOuter, cosInner, cosA);
}

#ifdef GIGA_VOLUMETRIC_GRID_BINDINGS
uint light_cell_index(vec3 p) {
    ivec3 c = ivec3(floor(p / kLightGridCell)) & (kLightGridDim - 1);
    return uint(c.x) | (uint(c.y) << 6) | (uint(c.z) << 12);
}

// Тень: 1.0 = свет виден из точки, 0.0 = перекрыт. ПРОТОТИП — определение
// обязан дать каждый шейдер, включающий этот заголовок: raymarch.frag марширует
// DDA-луч по вокселному зеркалу (та же геометрия, что у физики — прокарвил
// дыру, свет хлынул в тот же кадр); растровые пассы без зеркала пока отвечают
// 1.0 (честный шов следующего инкремента, а не тихий обход).
float giga_shadow(vec3 p, vec3 dirToLight, float dist);

// Прямой свет поверхности от всех источников клетки: ламберт + Блинн-Фонг,
// wrap/радиус/конус/тень — один цикл на мир, тела и пропсы. Возвращает диффуз
// (МНОЖИТСЯ на альбедо снаружи) и спекуляр (уже окрашен светом) через out.
// camDist — дистанция пикселя до камеры, fogStart — pc.fog.x: из них выводится
// БЮДЖЕТ теневых лучей. Список клетки отсортирован по вкладу (light_grid.comp),
// поэтому бюджет уходит сильнейшим, а отброшенный хвост — самые тусклые и
// стабильные (состав не мерцает). Без бюджета плотное поле ламп (блейм, до 31
// света на клетку) жгло до 31 DDA-луча НА ПИКСЕЛЬ — 20 мс кадра (замер
// 2026-08-17). Ступени: вблизи 8, до старта дымки 4, дальше (вклад тонет в
// тумане) 2.
void surface_light(vec3 P, vec3 N, vec3 viewDir, float specPow,
                   float specIntensity, float wrapPeriod,
                   float camDist, float fogStart,
                   out vec3 outDiffuse, out vec3 outSpecular) {
    outDiffuse = vec3(0.0);
    outSpecular = vec3(0.0);

    uint budget = camDist < 0.25 * fogStart ? 8u : (camDist < fogStart ? 4u : 2u);

    // Прямая индексация, НЕ копия структа: `LightGridCell c = ...` грузит все
    // 128 Б клетки, здесь читаются только count и первые индексы бюджета.
    uint cellIdx = light_cell_index(P);
    uint cellCount = min(uGridCells[cellIdx].count, 31u);
    for (uint k = 0u; k < cellCount && budget > 0u; ++k) {
        PointLight lt = uPointLights[uGridCells[cellIdx].lightIndices[k]];

        vec3 toL = wrap_nearest(lt.posRadius.xyz - P, wrapPeriod);
        float dSq = dot(toL, toL);
        float radius = lt.posRadius.w;
        if (dSq >= radius * radius) continue;

        float d = sqrt(max(dSq, 1e-6));
        vec3 L = toL / max(d, 1e-3);

        float ndotl = dot(N, L);
        if (ndotl <= 0.0) continue;

        float att = light_attenuation(d, radius) * spot_factor(lt.dirCone, -L);
        float power = lt.colorIntensity.w * att;
        // Порог вклада ДО теневого луча: неощутимый свет не заслуживает DDA.
        if (power * ndotl < 0.004) continue;

        budget--;
        // Старт — четверть атома от грани вдоль нормали (не родиться в своём
        // же теле), финиш — 0.2 м до источника (не врезаться в его арматуру:
        // лампочка висит вплотную к потолку).
        float vis = giga_shadow(P + N * 0.06, L, d - 0.26);
        if (vis <= 0.0) continue;

        vec3 lightCol = lt.colorIntensity.rgb * (power * vis);
        outDiffuse += lightCol * ndotl;

        vec3 H = normalize(L + viewDir);
        float ndoth = max(dot(N, H), 0.0);
        outSpecular += lightCol * (pow(ndoth, specPow) * specIntensity);
    }
}

// Raymarching Volumetric Accumulation
// Marches through the world-aligned light grid & uniform fog, accumulating
// in-scattered light per source (радиус+конус+фаза — та же запись источника,
// что и у поверхностей). Налобник — обычный свет №0 сетки: его аналитический
// двойник здесь удалён (он учитывался ДВАЖДЫ — сеткой и формулой).
// Returns vec4(inscatteredColor.rgb, transmittance).
//
// Плотность тумана: БАЗА ОДНОРОДНА. «Высотный туман» exp(-k*z) — анти-торовая
// идея по построению: на замкнутой оси высоты не существует, любая функция
// АБСОЛЮТНОЙ координаты рвётся швом на границе врапа. ЗАКОН: любой будущий
// пространственный градиент обязан быть периодическим по экстенту тора
// (wrap_delta), а «низ» брать из гравитационного фрейма слоя.
const float kFogBaseDensity = 0.20;
float sample_volumetric_fog_density(vec3 pos) {
    float baseDensity = kFogBaseDensity;
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

vec4 march_volumetric_fog(
    vec3 rayOrigin,
    vec3 rayDir,
    float maxDist,
    vec2 fragCoord,
    vec3 fillDir,
    float fillStrength,
    float wrapPeriod,
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

    for (int i = 0; i < kNumSteps; ++i) {
        float t = (float(i) + jitter) * stepSize;
        if (t >= maxDist) break;

        vec3 p = rayOrigin + rayDir * t;

        // Sample fog density at current ray position
        float density = sample_volumetric_fog_density(p);
        float stepExtinction = density * kAbsorption * stepSize;

        // Apply Beer-Lambert law
        float stepTransmittance = exp(-stepExtinction);

        // 1. Fill light ambient scattering
        float fillCos = dot(-rayDir, normalize(fillDir));
        float fillPhase = henyey_greenstein_phase(fillCos, 0.25);
        vec3 fillColor = vec3(0.20, 0.22, 0.28) * (fillStrength * fillPhase * 0.15);

        // 2. Light grid in-scattering — точки, конусы (луч прожектора в дымке —
        // это ЭТОТ член), налобник как свет №0.
        vec3 pointLightScat = vec3(0.0);
        // Прямая индексация вместо копии структа — см. surface_light: копия
        // тянула 128 Б клетки НА КАЖДЫЙ ШАГ дымки (5.7 GB/кадр на 1440p).
        // Список отсортирован по вкладу — гало хвоста из >16 тусклых ламп
        // неразличимо, а фаза на шаг дымки миллиардного масштаба.
        uint stepCellIdx = light_cell_index(p);
        uint stepCount = min(uGridCells[stepCellIdx].count, 16u);
        for (uint k = 0u; k < stepCount; ++k) {
            PointLight pt = uPointLights[uGridCells[stepCellIdx].lightIndices[k]];

            vec3 toPt = wrap_nearest(pt.posRadius.xyz - p, wrapPeriod);
            float dPtSq = dot(toPt, toPt);
            float radius = pt.posRadius.w;
            if (dPtSq >= radius * radius) continue;

            float dPt = sqrt(dPtSq);
            float ptAtt = light_attenuation(dPt, radius);
            ptAtt *= spot_factor(pt.dirCone, -toPt / max(dPt, 1e-3));

            // GOD RAYS: теневой DDA-луч из точки дымки к источнику — дыра в
            // стене режет столб света, решётка полосует конус фонаря. Бюджет
            // по смыслу: КОНУСНЫЕ источники (их форма и есть god ray) плюс
            // ОДИН сильнейший свет шага (k==0, список отсортирован по вкладу);
            // омни-хвост в плотном поле неразличим, а луч на каждый из 16
            // стоил 23 мс кадра (замер 2026-08-17, блейм). Финиш d-0.26 — не
            // врезаться в арматуру источника, как у surface_light.
            // …и омни-луч только в РАЗРЕЖЕННЫХ клетках (<=4 светов): одинокий
            // столб света у дыры читается, в плотном поле он тонет в общем
            // гало, а стоит 7 мс (замер: 11.8 -> 18.6 на блейме).
            if ((pt.dirCone.w > -1.5 || (k == 0u && stepCount <= 4u)) &&
                ptAtt > 0.001) {
                ptAtt *= giga_shadow(p, toPt / max(dPt, 1e-3), dPt - 0.26);
            }

            // No normalize(): a sample landing on the light centre
            // would emit NaN into the additive inscatter term.
            float ptCos = dot(-rayDir, toPt) / max(dPt, 1e-3);
            float ptPhase = henyey_greenstein_phase(ptCos, 0.40);

            pointLightScat += pt.colorIntensity.rgb * (pt.colorIntensity.w * ptAtt * ptPhase);
        }

        vec3 totalStepLight = fillColor + pointLightScat;

        // In-scattering integral evaluation
        vec3 stepInscatter = totalStepLight * density * transmittance * (1.0 - stepTransmittance);
        inscatter += stepInscatter;
        transmittance *= stepTransmittance;

        if (transmittance < 0.01) break; // Early ray termination
    }

    return vec4(inscatter, transmittance);
}
#endif // GIGA_VOLUMETRIC_GRID_BINDINGS

#endif // VOLUMETRIC_FOG_GLSL
