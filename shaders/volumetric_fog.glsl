#ifndef VOLUMETRIC_FOG_GLSL
#define VOLUMETRIC_FOG_GLSL

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
// Слоты >= базы — КЛАСТЕРЫ (light-cluster.md): агрегаты хвостовых ламп из
// бейка. Светят аналитически, БЕЗ теневого марша (решение владельца: они
// дальние/слабые и запечённо-достижимы; ошибка — «посветить лишним»).
const uint kClusterSlotBase = uint(GIGA_LIGHT_CLUSTER_BASE);

#ifdef GIGA_VOLUMETRIC_GRID_BINDINGS
layout(set = 1, binding = 0, std430) readonly buffer PointLightBuffer {
    uint uPointLightCount;
    uint uCellOverflow;   // атомарный счёт переливших клеток пишет light_grid.comp
    uint uShadowFlags;    // ИЗМЕРИТЕЛЬНЫЕ биты (бывший uReserved1, слово живо
                          // с гибели бюджета дымки — занято, не заведено)
    uint uShadowRayOverride; // бюджет теневых маршей на пиксель (0 = все лампы)
    PointLight uPointLights[];
};

// Измерительные биты uShadowFlags — «мерим, не играем» (закон GIGA_SKIP):
//   NOSUB — теневой луч НЕ входит в субвоксельный DDA частичных клеток
//           (перекрывают только ЦЕЛЬНЫЕ): изолирует цену масок 128 МБ;
//   TAIL  — лампы за бюджетом маршей светят АНАЛИТИЧЕСКИ (как кластеры),
//           а не выбрасываются: та же яркость, ноль теневых лучей.
//   STATS — считать лучи и «пустые» лучи атомиками (замер потолка).
const uint kShadowFlagStats = 8u;
//   NOMASK — не читать маску теней из бейка (поведение до 2026-08-23): A/B
//            самой оптимизации одним бинарём, картинка и fps рядом.
const uint kShadowFlagNoMask = 16u;
const uint kShadowFlagNoSub = 1u;
const uint kShadowFlagTail = 2u;

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
    // TAIL: за бюджетом лампа не выбрасывается, а светит аналитически — цикл
    // обязан дойти до конца списка (иначе «бюджет» режет СВЕТ, а не тени).
    bool analyticTail = (uShadowFlags & kShadowFlagTail) != 0u;

    // Прямая индексация, НЕ копия структа: `LightGridCell c = ...` грузит всю
    // клетку (kGridCellBytes), здесь читаются только count и индексы бюджета.
    uint cellIdx = light_cell_index(P);
    uint cellCount = min(uGridCells[cellIdx].count, kLightCellSlots);
    for (uint k = 0u; k < cellCount && (budget > 0u || analyticTail); ++k) {
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

        // Кластер — аналитически, без марша; лампа — честный DDA. С флагом
        // TAIL хвост за бюджетом идёт тем же аналитическим путём (один закон
        // на кластеры и хвост: свет без теневого луча, а не темнота).
        if (uGridCells[cellIdx].lightIndices[k] >= kClusterSlotBase ||
            (budget == 0u && analyticTail)) {
            vec3 cCol = lt.colorIntensity.rgb * (power * ndotl);
            outDiffuse += cCol;
            continue;
        }
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
        PointLight lt =
            uPointLights[uGridCells[cellIdx].lightIndices[k] & 0x00FFFFFFu];
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
    float a = fract(sin(dot(i,   vec2(12.9898, 78.233))) * 43758.5453);
    float b = fract(sin(dot(i10, vec2(12.9898, 78.233))) * 43758.5453);
    float c = fract(sin(dot(i01, vec2(12.9898, 78.233))) * 43758.5453);
    float d = fract(sin(dot(i11, vec2(12.9898, 78.233))) * 43758.5453);
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

        // 2. Ламповый член дымки (гало вокруг источников; god rays жили тут
        // же) УДАЛЁН решением владельца 2026-08-20 — «минимум систем, ядро
        // отполировать»: поверхностный свет несёт картинку целиком, а цикл
        // «12 шагов × лампы клетки на КАЖДЫЙ пиксель» был половиной
        // перерасхода кадра (замер вычитанием: без него худший зал 25-30 →
        // 30-60 fps, вместе со ступенями теней 4/2/1 — 60-80). Возврат гало —
        // отдельным слоем (например, в полразрешения) поверх этого члена, не
        // в ядро. Дымка осталась: fill-рассеяние, шум плотности, мгла
        // самосбора; дистанционный туман — другая формула (distance_fog).
        vec3 totalStepLight = fillColor;

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
