#ifndef VOLUMETRIC_FOG_GLSL
#define VOLUMETRIC_FOG_GLSL

#include "surface_lib.glsl" // hash21 — единый не-sin хеш (К5)

// volumetric_fog.glsl — ЕДИНЫЙ заголовок света: универсальная запись источника
// (точка/конус — один структ), world-aligned light grid на весь тор, прямой
// свет поверхностям (surface_light) и объёмное рассеяние в дымке
// (march_volumetric_fog). Закон один: КАЖДЫЙ источник освещает КАЖДУЮ
// поверхность одним и тем же кодом; тень — через giga_shadow(), который
// каждый шейдер определяет своим DDA по вокселному зеркалу (raymarch —
// булев марш-близнец march(), растровые пассы — shadow_march.glsl).
//
// Shared SSBO structures & layout contracts matching shaders/light_grid.comp.

struct PointLight {
    vec4 posRadius;      // xyz = world position (m), w = radius (m)
    vec4 colorIntensity; // rgb = linear color (0..1), w = effective intensity
    vec4 dirCone;        // xyz = spot direction (unit), w = cos(outer half-angle);
                         // w <= -1.5 — сентинель «омни» (конуса нет). Один структ
                         // на лампочку, фонарик, прожектор и трассер — универсальные
                         // источники живут вместе по построению.
};

// Ёмкость клетки выводится из байтов клетки: -DGIGA_LIGHT_CELL_BYTES из
// CMakeLists <- gpu_light_grid.h kGridCellBytes (правило 9 — литералам сетки
// в шейдерах нельзя). Слоты = байты/слово − счётчик.
const uint kLightCellSlots = uint(GIGA_LIGHT_CELL_BYTES) / 4u - 1u;

struct LightGridCell {
    uint count;                         // intersecting lights (max kLightCellSlots)
    uint lightIndices[kLightCellSlots]; // indices into uPointLights array
};

// Сетка света = ВЕСЬ тор: 64³ клеток по 4 м = 256 м = kWorldExtent, привязана к
// миру, не к камере. Индекс — floor(p/4) & 63, как cell_index у вокселей: врап
// на битовом И, промахов «вне коробки» не существует по построению. Камерная
// коробка 64×32×64 м была классом багов сама по себе — свет за её гранью
// просто исчезал, хотя видимость 128 м. [gpu_light_grid.h — числа обязаны
// совпадать]
const int   kLightGridDim  = GIGA_LIGHT_GRID_DIM;  // -D из CMakeLists <- gpu_light_grid.h
const float kLightGridCell = GIGA_LIGHT_GRID_CELL;
// КЛАСТЕРЫ УДАЛЕНЫ 2026-08-23 (решение владельца). Механизм не работал ни
// одного кадра: биннинг выбрасывал все кластерные ссылки (id 98304+ против
// порога staticCount ~12646, light_grid.comp), а эта ветка была мёртвым
// кодом. Цена бага — клетка жила максимум 8 честными лампами при среднем
// 10.6, состав решался поклеточно, и на границах 4-метровых клеток свет и
// тени рвались прямоугольниками (скриншот владельца). Теперь клетка держит
// весь свой список честно.

#ifdef GIGA_VOLUMETRIC_GRID_BINDINGS
layout(set = 1, binding = 0, std430) readonly buffer PointLightBuffer {
    uint uPointLightCount;
    uint uCellOverflow;   // атомарный счёт переливших клеток пишет light_grid.comp
    uint uReserved1;      // бывший бюджет ламп дымки — член удалён 2026-08-20
    uint uShadowRayOverride; // 0 = авто-ступени 4/2/1; иначе бюджет лучей surface_light
    PointLight uPointLights[];
};

layout(set = 1, binding = 1, std430) readonly buffer LightGridBuffer {
    LightGridCell uGridCells[];
};
#endif

// Henyey-Greenstein anisotropic phase function for atmospheric scattering.
// t*sqrt(t) вместо pow(t,1.5): pow компилируется в exp/log, а фаза считается
// на каждом из 12 шагов дымки каждого пикселя (fill-рассеяние).
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
// Общий пол AO трёх потребителей (был триждый дубль 0.32 в raymarch/cube/prop
// — аудит 2026-08-20): тень окклюжна не чернит поверхность глубже трети.
const float kAoFloor = 0.32;

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
// обязан дать каждый шейдер, включающий этот заголовок, своим DDA по
// вокселному зеркалу: raymarch.frag — булев близнец march() (та же геометрия,
// что у физики — прокарвил дыру, свет хлынул в тот же кадр), растровые пассы
// (cube/prop) — shadow_march.glsl. Стабов нет ни у кого.
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

    // БЮДЖЕТА ЛУЧЕЙ НЕТ (шаг 3 light-cluster.md, владелец: «возврат
    // чистоты»): длина списка ограничена ПО ПОСТРОЕНИЮ кластеризацией бейка
    // (топ-K честных + кластеры), и пиксель маршит КАЖДУЮ честную лампу.
    // Ступени 8/4/2 и 4/2/1 умерли вместе с порогом вклада — в ядре не
    // осталось ни одной ветки от дистанции камеры. GIGA_SHADOW_RAYS остаётся
    // ИЗМЕРИТЕЛЬНОЙ ручкой: N != 0 капает марши для A/B.
    uint budget = uShadowRayOverride != 0u ? uShadowRayOverride : 0xFFFFu;

    // Прямая индексация, НЕ копия структа: `LightGridCell c = ...` грузит всю
    // клетку (kGridCellBytes), здесь читаются только count и индексы бюджета.
    uint cellIdx = light_cell_index(P);
    uint cellCount = min(uGridCells[cellIdx].count, kLightCellSlots);
    // ГИБРИД (решение владельца 2026-08-24, [gpu_light_grid.h]
    // kFullResLights): список клетки отсортирован по вкладу; полнорезный
    // пасс маршит ТОЛЬКО топ-K (жёсткий потолок стоимости пикселя),
    // полурезный полупасс — ТОЛЬКО хвост за K (свет не теряется — дешевеет).
    // Прочие потребители (тела/пропы) — весь список, как раньше.
#if defined(GIGA_LIGHT_HALF)
    uint kBegin = min(uint(GIGA_LIGHT_FULLRES_K), cellCount);
    uint kEnd = cellCount;
#elif defined(GIGA_LIGHT_SAMPLED)
    uint kBegin = 0u;
    uint kEnd = min(uint(GIGA_LIGHT_FULLRES_K), cellCount);
#else
    uint kBegin = 0u;
    uint kEnd = cellCount;
#endif
    for (uint k = kBegin; k < kEnd && budget > 0u; ++k) {
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
        if (power <= 0.0) continue; // погасший/надгробие: нет света — нет луча

        if (budget == 0u) continue;
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

// Свет ТОНКОГО антуража (провод/тент/частица) от списка своей клетки —
// закрытие S5-долга 2026-08-21: те же лампы и кластеры, что у поверхностей,
// БЕЗ теневого марша (списки уже отфильтрованы бейком видимости, тонкая
// декорация не окупает DDA; ошибка — «посветить лишним» в 4-м клетке).
// Форма вместо нормали там, где нормали нет: N с весом nWeight — тент даёт
// честный двусторонний |cos| (nWeight=1), провод и частица — среднее по
// ориентациям в альбедо-множителе вызывающего (nWeight=0).
vec3 dressing_light(vec3 P, vec3 N, float nWeight, float wrapPeriod) {
    uint cellIdx = light_cell_index(P);
    uint n = min(uGridCells[cellIdx].count, kLightCellSlots);
    vec3 sum = vec3(0.0);
    for (uint k = 0u; k < n; ++k) {
        PointLight lt = uPointLights[uGridCells[cellIdx].lightIndices[k]];
        vec3 toL = wrap_nearest(lt.posRadius.xyz - P, wrapPeriod);
        float dSq = dot(toL, toL);
        float radius = lt.posRadius.w;
        if (dSq >= radius * radius) continue;
        float d = sqrt(max(dSq, 1e-6));
        vec3 L = toL / max(d, 1e-3);
        float att = light_attenuation(d, radius) * spot_factor(lt.dirCone, -L);
        float shape = mix(1.0, abs(dot(N, L)), nWeight);
        sum += lt.colorIntensity.rgb * (lt.colorIntensity.w * att * shape);
    }
    return sum;
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
    // Вихрь мглы. Решётка шума ПЕРИОДИЧНА по тору ПО ПОСТРОЕНИЮ — закон пятью
    // строками выше нарушала эта самая функция (аудит 2026-08-20): абсолютная
    // pos.xy при частоте 0.15 давала 38.4 ячейки на 256 м — дробный хвост
    // рвался швом врапа. Вывод: число ячеек = ближайшее целое к прежней
    // частоте (256 × 0.15 → 38), решётка заворачивается mod N, все четыре
    // угла — тоже. Период — из тех же дефайнов, что сетка света (= экстент).
    const float periodM = float(kLightGridDim) * kLightGridCell;
    const float cells = floor(periodM * 0.15 + 0.5);
    vec2 p = pos.xy * (cells / periodM);
    vec2 i = mod(floor(p), cells);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    vec2 i10 = mod(i + vec2(1.0, 0.0), cells);
    vec2 i01 = mod(i + vec2(0.0, 1.0), cells);
    vec2 i11 = mod(i + vec2(1.0, 1.0), cells);
    // hash21 из surface_lib (К5): sin-хеш забракован в дереве за муар на
    // части драйверов — тут жил его последний экземпляр. Периодичность
    // тора цела: вход уже обёрнут mod(cells).
    float a = hash21(i);
    float b = hash21(i10);
    float c = hash21(i01);
    float d = hash21(i11);
    float mistNoise = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);

    return baseDensity * (0.85 + 0.30 * mistNoise);
}

// Мгла: шумовая ПРОЗРАЧНОСТЬ вдоль луча (Beer-Lambert по 12 шагам шумовой
// плотности + мгла самосбора). Fill-inscatter ВЫРЕЗАН аудитом 2026-08-25
// (К5): его сила была sunDir.w, солнце убрано в ноль решением владельца —
// член стал тождественным нулём, а 12 повторов его фазовой функции на
// пиксель были мёртвой работой (гало ламп удалено ещё 2026-08-20).
// Возврат свечения дымки, если захочется, — отдельным слоем, не сюда.
float march_volumetric_fog(
    vec3 rayOrigin,
    vec3 rayDir,
    float maxDist,
    vec2 fragCoord,
    float samosborPulse
) {
    // Step-count-invariant (measured 2026-08-03: 12 vs 24 steps, p99 frame
    // delta = 2/765) — raise freely if the IGN dither ever reads as noise.
    const int kNumSteps = 12;
    float jitter = ign_jitter(fragCoord);
    float stepSize = maxDist / float(kNumSteps);

    float transmittance = 1.0;
    // Dynamic extinction scaling when Samosbor hazard strikes (samosbor.pulse)
    float kAbsorption = 0.035 * (1.0 + clamp(samosborPulse, 0.0, 1.0) * 3.5);

    for (int i = 0; i < kNumSteps; ++i) {
        float t = (float(i) + jitter) * stepSize;
        if (t >= maxDist) break;
        float density = sample_volumetric_fog_density(rayOrigin + rayDir * t);
        transmittance *= exp(-density * kAbsorption * stepSize);
        if (transmittance < 0.01) break; // Early ray termination
    }
    return transmittance;
}
#endif // GIGA_VOLUMETRIC_GRID_BINDINGS

#endif // VOLUMETRIC_FOG_GLSL
