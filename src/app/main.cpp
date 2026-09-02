// gigahrush2 entry point.
//
// Brings up an SDL3 window + Vulkan, builds the level stack, seeds an alife
// population and embodies one of its records as the player (who owns the
// CameraTag + Controller — the "player is just an embodied record" model,
// [npcs.md]), and runs a fixed-timestep sim loop against a variable-rate render
// loop with an ImGui HUD.
//
// The default world is the floor-MODULE stack: several distinct 128^3 floors,
// each themed by its FloorKind (floor_gen.h / floors.md) and wired through a
// FloorRegistry. Only the ACTIVE floor is kept live — its World is generated and
// its crowd embodied on entry, and folded back into the cold pool on exit
// (streaming, floor_stream.h / master_prompt #9). `[` and `]` ride down/up a
// floor.
//
// Controls are DATA, not code: every key lives in the KeybindTable
// ([keybind.h]) as a row mapping a scancode to a console command
// ([console.h]), rebindable in the pause menu (Esc) and persisted to
// gigahrush2.keys. Defaults: WASD move, mouse look (hold right mouse / Tab),
// Space jump, F fly, Q door, E interact, [ / ] floor travel, ~ console.
#include <SDL3/SDL.h>
#include <algorithm>
#include <SDL3/SDL_vulkan.h>

#include <chrono>
#include <future>   // фоновая запись floor-файла (5a)   // покомпонентный замер [carve] — carve-hitch.md
#include <cmath>
#include <climits>  // INT_MIN — the gas reseed sentinel
#include <cstdint>
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <string>
#include <mutex>    // канал восстановленных сущностей (v20/F): хук в воркере
#include <unordered_map>
#include <vector>

#include "imgui.h"
#include "imgui_impl_sdl3.h"

#include "app/hud_ui.h"
#include "app/settings_ui.h"
#include "core/math.h"
#include "game/mob_table.h"
#include "core/tick.h"
#include "core/wrap.h"
#include "ecs/components.h"
#include "ecs/registry.h"
#include "game/ai.h"       // the utility AI — adapted, wired, and dormant by default
#include "game/encumbrance.h" // carried weight -> mass, speed, fatigue, noise
#include "game/door.h"   // НОВАЯ дверь: зарастание материей (2026-08-28)
#include "game/room.h"   // комнаты этажа: объявляет модуль, roomAt (2026-08-28)
#include "game/room_supply.h" // ОСНАЩЕНИЕ+ЗАПАС комнат из сущностей (S12.4)
#include "game/focus.h"  // ФОКУС: одна цель под прицелом (2026-08-28)
#include "sim/camera.h"   // camera_forward — единственная формула взгляда
#include "game/embody.h"
#include "game/impact.h"
#include "game/elevator.h"
#include "game/console.h"
#include "game/fast_travel.h" // §24 lattice hub unlock + boarding
#include "game/keybind.h"
#include "game/floor_catalog.h"
#include "game/floor_registry.h"
#include "game/floor_spec.h"
#include "game/floor_stream.h"
#include "game/macro_sim.h"
#include "game/mob_spawn.h"
#include "game/monster_traits.h"
#include "game/needs.h"
#include "game/rumour.h"
#include "game/speech.h"
#include "game/samosbor.h"
#include "game/contract.h"
#include "game/barter.h"        // сделка ([conversation.md]); vendor.h — термы
#include "game/conversation.h"
#include "game/dice.h"
#include "game/economy.h"
#include "game/craft.h"
#include "game/quest.h"
#include "game/container.h"
#include "game/combat.h"
#include "game/status.h"
#include "game/rpg.h"
#include "game/extraction.h"
#include "game/save.h"
#include "game/faction_relations.h"
#include "game/witness.h"      // S19: деяние/свидетель/цена — witness_step, deed_publish
#include "game/loot.h"
#include "game/weapon_table.h"
#include "game/event_bus.h"
#include "game/floors/khrushi/khrushi.h"
#include "game/floors/padic/padic.h"
#include "game/flicker.h"
#include "game/light_bake.h"
#include "game/prop_system.h"
#include "game/investigate.h"
#include "game/noise.h"
#include "game/wander.h"
#include "game/npc_pool.h"
#include "game/macro_sim.h"
#include "input/input.h"
#include "render/body_pass.h"
#include "render/material_textures.h"
#include "render/material_table.h" // kMaterial — generated albedo table
#include "render/gpu_medium_pass.h"
#include "world/material_props.h" // material_phase — sphere не маскирует жидкость
#include "world/medium.h" // агрегаты S16.4 — HUD/дыхание читают клетку тела
#include "render/verlet_pass.h"
#include "render/prop_pass.h"

#include "render/gpu_timer.h"
#include "render/gpu_light_grid.h"
#include "core/prof.h"  // GIGA_PROF=1 — per-system свод кадра ([prof] ниже)

#include "render/gpu_cull_pass.h"
#include "app/ui_shell.h"
#include "audio/audio_system.h"
#include "render/imgui_layer.h"
#include "render/intro_ui.h"
#include "render/conversation_ui.h"
#include "render/inventory_ui.h"
#include "render/vk_device.h"
#include "render/vk_renderer.h"
#include "render/vk_swapchain.h"
#include "render/voxel_mirror.h"
#include "render/raymarch_pass.h"
#include "render/screenshot.h"
#include "sim/camera.h"
#include "sim/controller.h"
#include "sim/diffusion.h"
#include "sim/physics.h"
#include "sim/rigid.h"
#include "world/destruct.h"
#include "world/stain.h"
#include "world/level_stack.h"
#include "world/nav.h"
#include "game/rebake.h"

using namespace giga;

namespace {

// Which binary is this? NDEBUG is the one thing every optimized CMake
// configuration defines and Debug does not, so it needs no CMake cooperation.
#ifdef NDEBUG
constexpr const char* kBuildKind = "optimized";
#else
constexpr const char* kBuildKind = "DEBUG — NO OPTIMIZATION, ~10x slower sim";
#endif

constexpr int kWinW = 1280;
constexpr int kWinH = 720;

// Fixed sim step (seconds). Physics + controller run at this rate; rendering is
// uncapped and interpolation is skipped for simplicity (the step is small).
// The sim tick rate now lives in core/tick.h so the tests can see the same number.
// See that header for why it is 125 and not 120.

// Lighting tunables, packed into the dead lanes of CubePush (see cube.frag).
// The floors are windowless interiors and ambient is deliberately near-black;
// raise kAmbient and the world flattens back into an evenly-lit mosaic.
//
// НАЛОБНИКА БОЛЬШЕ НЕТ (владелец 2026-08-20, [CANON.md] S5 «света от камеры не
// существует»). Он был вторым источником света мимо GpuLightGrid: интенсивность
// ехала в `camPos.w`, радиус в `fog.z`, и три шейдера считали по ним обратный
// квадрат. Обе лейны теперь МЁРТВЫ и пушатся нулями — намеренно, а не по
// забывчивости: занять их нечем, а `CubePush` уже ровно 128 Б, то есть
// гарантированный потолок пуш-констант ([material_textures.h]).
// Свет в руке — предмет: `flashlight` в слоте Tool идёт через `add_light`
// с конусом и параллаксом от руки (см. ниже по файлу), и NPC получат тот же
// путь. Разбор — [markoaudit/plans/headlamp-death.md].
constexpr float kAmbient = 0.06f;       // fog.w, scales the atmospheric hemispheric term
// How much of the DIRECT light (grid + fill) baked AO is allowed to occlude.
// Ambient is always fully occluded; this is the share of the lamp, and it is a dial
// because occluding a direct light is not physical — it is a legibility choice. At
// 0 AO is nearly invisible in this scene, because ambient is only ~8% of the image
// here (see cube.frag). 0.65 reads as contact shadow without making corridors feel
// like caves. «Доля лампы» здесь читается как доля СЕТОЧНОГО света: после смерти
// налобника прямой свет — это лампы этажа и фонарик в руке.
constexpr float kAoDirect = 0.65f;
// How far the world closes in at the peak of a samosbor, as a fraction of the normal
// fog end. The fog is the ONLY visual the hazard has right now, and it is deliberately
// a range squeeze rather than a colour: fog mixes to BLACK and the encode satisfies
// f(0) == 0, which is what hides the toroidal wrap seam ([cube.frag]). Tinting the fog
// would break that unless the clear colour moved with it, and a visible seam is the
// worst failure this renderer has. Pulling the range IN is strictly safe — more fog
// hides the seam harder, never less.
constexpr float kSamosborFogSqueeze = 0.34f;

// Статические эмиттеры светоматериалов активного этажа ([game/light_bake.h]):
// печётся в refresh_floor_props, читается collect_scene_lights. Файловый
// статик, как g_saveSlot — этаж один, владелец один.
static std::vector<game::BakedLight> g_bakedFloorLights;
// Поле светоячеек под этими эмиттерами: полный субвоксельный скан 128³ платится
// один раз при постройке этажа; карв и спавн неона латают поле по своим
// dirtyCells — фриз 284 мс на каждом разрушении неона убит этим разделением
// ([markoaudit/plans/neon-topology.md] §4).
static game::EmitterField g_emitterField;
// Идентичность кластеров между бейками — из СВЯЗНОСТИ атомов (решение
// владельца 2026-08-24): id компоненты переживает изменение формы, позиция —
// производная для рендера. Сбрасывается постройкой этажа вместе с таблицей.
static game::EmitterClusters g_emitterClusters;

// ЛОГ СВЕТА В ФАЙЛ (GIGA_LIGHT_LOG=1 -> light_debug.log рядом с бинарём).
// Просьба владельца 2026-08-23: он играет и даёт фидбек, а строки в stderr
// ловить не может — диагностика обязана оседать в файл сама. Пишем сюда то,
// по чему судят о жизни ламп: рождение неона, пересборку статик-таблицы,
// надгробия и переработку слотов, свапы бейка видимости.
static void light_log(const char* fmt, ...) {
    static const bool on = [] {
        const char* e = std::getenv("GIGA_LIGHT_LOG");
        return e && std::atol(e) != 0;
    }();
    if (!on) return;
    std::FILE* f = std::fopen("light_debug.log", "a");
    if (!f) return;
    va_list ap;
    va_start(ap, fmt);
    std::vfprintf(f, fmt, ap);
    va_end(ap);
    std::fclose(f);
}

// Статик-таблица света этажа (план light-visibility-bake §1.1): пропы-света +
// кластеры светоматериалов, СТАБИЛЬНЫЕ слот-id на поколение таблицы. Одна
// нумерация на три потребителя: слот в GpuLightGrid (uPointLights[0..S)), id
// в бейке видимости ([game/rebake.h] set_light_table) и PropLight.slot на
// сущности. Перестраивается при постройке этажа и при карве светоматериала;
// g_staticTableGen — сигнал collect_scene_lights перезалить таблицу в рендер.
static std::vector<game::LightVisLamp> g_staticLamps;
static std::vector<gpu::GpuPointLight> g_staticLightBase;
static std::vector<std::uint32_t> g_bakedLightSlots; // слот на кластер бейка
// id компоненты светоматериала -> её слот. СТАБИЛЬНОСТЬ СЛОТОВ
// (баг найден и починен 2026-08-23): раньше таблица пересобиралась с нуля и
// слоты раздавались по порядку обхода, поэтому гибель ОДНОЙ лампы сдвигала
// id всех следующих — а запечённая видимость продолжала ссылаться на старые
// номера, и до полного ребейка (до секунды) часть клеток светила ЧУЖИМИ
// лампами. Теперь таблица в пределах этажа только РАСТЁТ: проп узнаёт свой
// слот по PropLight.slot, кластер светоматериала — по id связной компоненты
// атомов ([game/light_bake.h] EmitterClusters; матчить по позиции центроида —
// хардкод и ошибка, решение владельца 2026-08-24: отломил кусок — центроид
// уехал — система видела ДРУГУЮ лампу), а умершая лампа оставляет НАДГРОБИЕ
// (радиус 0) вместо сдвига соседей. Заголовок gpu_light_grid.h обещал эту
// стабильность с самого начала — теперь код ей соответствует.
static std::vector<std::pair<std::uint32_t, std::uint32_t>> g_bakedSlotById;
// Поколение таблицы, в котором слот умер (kAlive = живой). ПЕРЕРАБОТКА СЛОТОВ
// (закон дома «пул с переработкой», CANON S11): новая лампа занимает мёртвый
// слот, если он есть, и только иначе растит таблицу. Условие переработки —
// слот обязан быть мёртв ДО последнего завершённого полного бейка видимости:
// пока живы запечённые списки, ссылающиеся на этот номер, отдать его новой
// лампе значит подсветить ею чужие клетки — тот самый баг, который здесь и
// чинится. g_lightVisTableGen — поколение таблицы на момент последнего свапа
// полного бейка.
static constexpr std::uint32_t kSlotAlive = 0xFFFFFFFFu;
static std::vector<std::uint32_t> g_slotDeadGen;
static std::uint32_t g_lightVisTableGen = 0;
static std::uint32_t g_staticTableGen = 0;
static std::uint32_t g_lightTableUploadedGen = 0;

// Швы game <-> render, которые обязаны совпадать (game render не видит):
// сетка бейка видимости = светосетка рендера; «нет слота» — одно значение.
static_assert(gpu::kGridDimX == game::kLightVisDim &&
                  gpu::kGridDimY == game::kLightVisDim &&
                  gpu::kGridDimZ == game::kLightVisDim,
              "бейк видимости и светосетка рендера обязаны жить в одной сетке");
static_assert(gpu::kGridCellMeters == game::kLightVisCellM,
              "клетка светосетки: рендер и бейк разошлись");
static_assert(game::kNoLightSlot == gpu::kNoLightSlot,
              "сентинель «нет слота» обязан быть одним значением");

// GIGA_SKIP=world,bodies,props,physdraw,lightgrid — ИЗМЕРИТЕЛЬНЫЕ тумблеры:
// выключить пасс и прочитать дельту fps. Существуют потому, что на MoltenVK
// по-пассовые GPU-таймстемпы внутри одного рендер-пасса схлопываются к нулю
// (gpu_timer.h §PORTABILITY; замер владельца 2026-08-20: сумма пассов 1.8 мс
// при frame 19.7 мс) — раскладку кадра на этом железе даёт только вычитание.
// Не режим игры: активные скипы печатаются вслух при старте.
static bool skip_pass(const char* name) {
    static const std::string list = [] {
        const char* e = std::getenv("GIGA_SKIP");
        std::string s = e ? e : "";
        if (!s.empty())
            std::fprintf(stderr, "[skip] GIGA_SKIP=%s — measuring, not playing\n",
                         s.c_str());
        return s;
    }();
    return list.find(name) != std::string::npos;
}

// Перестройка статик-таблицы. Слоты пропов пишутся прямо в PropLight.slot;
// пропы чужого слоя и сорванные (без StaticPropTag) получают kNoLightSlot и
// светят динамическим хвостом. Интенсивность в base всегда 0 — её каждый кадр
// пишет collect_scene_lights (мерцание/обесточка/поломка; 0 = надгробие).
//
// reset — постройка этажа: таблица начинается с нуля (за ней всё равно идёт
// полный бейк видимости). Без reset (карв по светоматериалу) слоты СТАБИЛЬНЫ:
// см. вывод у g_bakedSlotById.
static void rebuild_static_light_table(Registry& reg, LayerId layer,
                                       bool reset) {
    // GIGA_LIGHT_BUDGET=N — A/B-ручка ТОЛЬКО ДЛЯ ЗАМЕРА (перф-кривая
    // 2026-08-18: сколько мс кадра стоят марши к лампам). Режет статик-таблицу
    // до первых N ламп — детерминированно и воспроизводимо; срезанные лампы не
    // светят вовсе (слот kNoLightSlot, вслух ниже).
    static const std::uint32_t kBudget = [] {
        const char* e = std::getenv("GIGA_LIGHT_BUDGET");
        const long v = e ? std::atol(e) : 0;
        return (v > 0 && v < static_cast<long>(gpu::kRootLights))
                   ? static_cast<std::uint32_t>(v)
                   : gpu::kRootLights;
    }();
    if (reset) {
        g_staticLamps.clear();
        g_staticLightBase.clear();
        g_bakedSlotById.clear();
        g_slotDeadGen.clear();
    }
    g_slotDeadGen.resize(g_staticLamps.size(), kSlotAlive);
    g_bakedLightSlots.clear();
    // Подтверждённые этой пересборкой слоты; неподтверждённые станут
    // надгробиями (лампа умерла) — но НЕ исчезнут, иначе поедут чужие id.
    std::vector<std::uint8_t> confirmed(g_staticLamps.size(), 0);
    std::uint32_t budgetDropped = 0;
    // Записать лампу В КОНКРЕТНЫЙ слот (или в новый, если slot невалиден).
    // Переработка: свободный мёртвый слот, безопасный по поколению (см. вывод
    // у g_slotDeadGen). Курсор — чтобы не сканировать таблицу с нуля на каждую
    // новую лампу: слоты слева от него уже разобраны этой пересборкой.
    std::uint32_t recycleCursor = 0;
    const auto take_dead_slot = [&]() -> std::uint32_t {
        for (; recycleCursor < g_staticLamps.size(); ++recycleCursor) {
            const std::uint32_t i = recycleCursor;
            if (confirmed[i] || g_slotDeadGen[i] == kSlotAlive) continue;
            if (g_slotDeadGen[i] >= g_lightVisTableGen) continue; // списки живы
            ++recycleCursor;
            return i;
        }
        return game::kNoLightSlot;
    };
    const auto put_lamp = [&](std::uint32_t slot, const vec3& pos,
                              float radiusM, const vec3& color) -> std::uint32_t {
        if (slot >= g_staticLamps.size()) slot = take_dead_slot();
        if (slot >= g_staticLamps.size()) {
            if (g_staticLamps.size() >= kBudget) {
                ++budgetDropped;
                return game::kNoLightSlot;
            }
            slot = static_cast<std::uint32_t>(g_staticLamps.size());
            g_staticLamps.emplace_back();
            g_staticLightBase.emplace_back();
            g_slotDeadGen.push_back(kSlotAlive);
            confirmed.push_back(0);
        }
        g_staticLamps[slot] = {pos, radiusM, color};
        gpu::GpuPointLight& base = g_staticLightBase[slot];
        base.posRadius = vec4{pos.x, pos.y, pos.z, radiusM};
        base.colorIntensity = vec4{color.x, color.y, color.z, 0.0f};
        // w = -2: сентинель «омни» (см. add_light). Конусные статики появятся
        // вместе с первым конусным пропом — биннинг конус всё равно не режет.
        base.dirCone = vec4{0.0f, 0.0f, 1.0f, -2.0f};
        confirmed[slot] = 1;
        g_slotDeadGen[slot] = kSlotAlive;
        return slot;
    };
    auto lampView = reg.view<const Transform, game::PropLight>();
    for (auto e : lampView) {
        const Transform& tr = lampView.get<const Transform>(e);
        game::PropLight& pl = lampView.get<game::PropLight>(e);
        if (tr.layer != layer || !reg.all_of<game::StaticPropTag>(e)) {
            pl.slot = game::kNoLightSlot;
            continue;
        }
        // Проп помнит свой слот сам — он и есть стабильная идентичность.
        pl.slot = put_lamp(pl.slot, tr.pos + vec3{0.0f, 0.0f, -pl.dropM},
                           pl.radiusM, pl.color);
    }
    // Кластеры светоматериала узнают свой слот по id связной компоненты
    // ([game/light_bake.h]): id переживает изменение формы, позиция кластера
    // между пересборками может уехать сколько угодно — слот тот же.
    std::vector<std::pair<std::uint32_t, std::uint32_t>> byId =
        std::move(g_bakedSlotById);
    std::sort(byId.begin(), byId.end());
    g_bakedSlotById.clear();
    for (const game::BakedLight& bl : g_bakedFloorLights) {
        std::uint32_t slot = game::kNoLightSlot;
        const auto it = std::lower_bound(
            byId.begin(), byId.end(),
            std::pair<std::uint32_t, std::uint32_t>{bl.id, 0u});
        if (it != byId.end() && it->first == bl.id) slot = it->second;
        slot = put_lamp(slot, bl.pos, bl.radiusM, bl.color);
        g_bakedLightSlots.push_back(slot);
        if (slot != game::kNoLightSlot) g_bakedSlotById.emplace_back(bl.id, slot);
    }
    // Неподтверждённые слоты — надгробия: лампа умерла, но её НОМЕР остаётся
    // занятым, иначе запечённые списки начнут указывать на чужие лампы.
    // Радиус 0 = бейк её не печёт, биннинг не биннит, кадр не светит.
    std::uint32_t tombstoned = 0;
    for (std::size_t i = 0; i < g_staticLamps.size(); ++i) {
        if (confirmed[i]) continue;
        if (g_staticLamps[i].radiusM == 0.0f) continue; // уже надгробие
        g_staticLamps[i].radiusM = 0.0f;
        g_staticLightBase[i].posRadius.w = 0.0f;
        g_staticLightBase[i].colorIntensity.w = 0.0f;
        g_slotDeadGen[i] = g_staticTableGen; // переработается после полного бейка
        ++tombstoned;
    }
    if (tombstoned > 0)
        light_log("[slots] %u lamps died -> tombstones; table %zu slots\n",
                  tombstoned, g_staticLamps.size());
    if (tombstoned > 0)
        std::fprintf(stderr,
                     "[light-grid] %u lamps died -> tombstones (slots stay, ids "
                     "of the rest do not move; recycled after the next full "
                     "light bake)\n",
                     tombstoned);
    if (budgetDropped > 0)
        std::fprintf(stderr,
                     "[light-grid] GIGA_LIGHT_BUDGET=%u: %u static lamps cut\n",
                     kBudget, budgetDropped);
    light_log("[slots] table rebuilt: %zu slots, %zu baked clusters, gen %u "
              "(recycle allowed below gen %u)\n",
              g_staticLamps.size(), g_bakedLightSlots.size(),
              g_staticTableGen + 1, g_lightVisTableGen);
    ++g_staticTableGen;
}

// Поколение мутаций мира активного этажа — асинк-ребейк
// ([markoaudit/plans/async-rebake.md] §2). Пишут ровно два карв-сайта (консоль
// и боевой); двери НЕ пишут — нав печётся по премисе all-open ([game/door.h])
// и от тоггла не стареет. Читатель — RebakeScheduler ([game/rebake.h]):
// bakedGen != worldGen ⇔ запечённое устарело, планировщик сам доводит фоновым
// циклом. (dirtyGen-буфер светосетки вырезан чисткой 2026-08-23.) МОНОТОННО
// через всю сессию, на этаже НЕ сбрасывается.
static std::uint64_t g_worldGen = 0;

// Кольцо wall-clock кадров для перф-свода --shot (пишется в топе кадра).
static const float* g_wallRing = nullptr;
static unsigned g_wallSeen = 0;
static float g_wallFirstMs = -1.0f;  // первый кадр (загрузка); в кольце его нет

// Покомпонентный замер карв-пути ([markoaudit/plans/carve-hitch.md],
// инкремент 1 — ТОЛЬКО замер, чинить до чисел запрещено). Компоненты копятся
// за кадр (боевой дренаж даёт пачку карвов за подшаг), строка [carve]
// печатается в хвосте кадра — после flush() зеркала, когда известны и
// prop_skin, и цена стейджинга. Wall-clock, не сим-тики: это диагностика
// хитча КАДРА, а не SLA планировщика (тот меряется тиками, [game/rebake.h]).
struct CarveTiming {
    bool carved = false;
    std::size_t cells = 0;     // Σ dirtyCells за кадр
    float sphereMs = 0.0f;     // carve_sphere
    float lightMatMs = 0.0f;   // bake_material_lights + статик-таблица ламп
    float mirrorMarkMs = 0.0f; // voxelMirror.mark_dirty (только метки)
    float diffMs = 0.0f;       // mark_diffusion_dirty
    float patchMs = 0.0f;      // nav.patch_carved_cells
    float partMs = 0.0f;       // spawn_carve_particles
    float anchorMs = 0.0f;     // anchor_validate_step
    float antrMs = 0.0f;       // antourage_carve_step_here
    float siteMs = 0.0f;       // весь карв-сайт скобкой (site−Σ = немеряное)
    float propSkinMs = 0.0f;   // merge_ecs_prop_meshes в хвосте кадра
    float lgridMs = 0.0f;      // collect_scene_lights + update_and_dispatch
    float flushMs = 0.0f;      // voxelMirror.flush (CPU-сторона стейджинга)
};
static CarveTiming g_carveT;

// СТОРОЖ ЗАРАСТАНИЯ (GIGA_REGROW_WATCH, баг «дыра заросла»): кольцо
// выбитых атомов + скан «стал ли атом снова твёрдым» в CPU-каноне.
// WATCH=1 — скан раз в 25 тиков в сим-секции; WATCH=2 — скан в ЧЕТЫРЁХ
// точках кадра (после шва / после дверей / после сима / после рендера),
// каждая печатает своё имя: виновник — система между двумя точками.
struct RegrowAtom {
    std::uint32_t key;
    CellType was;
};
static int g_regrowWatch = 0; // 0 выкл / 1 редкий скан / 2 поточечный
static std::vector<RegrowAtom> g_regrowRing;
static std::size_t g_regrowHead = 0;
static std::uint32_t g_regrowVerifies = 0;

static void regrow_check(World& w, gpu::VoxelMirror& mirror,
                         const char* where, std::uint64_t tick) {
    if (g_regrowRing.empty()) return;
    const SubField<CellType>* rf =
        w.subfields().find<CellType>(kSubMaterialName);
    for (auto& ca : g_regrowRing) {
        if (ca.key == 0 && ca.was == 0) continue;
        const std::size_t ci = ca.key >> 9;
        const int bit = static_cast<int>(ca.key & 511u);
        const CellType* pg = rf ? rf->page(ci) : nullptr;
        CellType m = kCellAir;
        if (pg) m = pg[bit];
        else {
            const CellType base = w.grid().types()[ci];
            const SubMask& mk = w.grid().masks()[ci];
            if (mk.test(bit)) m = base;
            else if (mk.empty() && material_is_medium(base)) m = base;
        }
        if (m == kCellAir || material_is_medium(m)) continue;
        std::fprintf(stderr,
                     "[regrow] tick %llu ТОЧКА <%s> cell %zu bit %d: был %s, "
                     "стал %s — ВОСКРЕС В CPU-КАНОНЕ\n",
                     static_cast<unsigned long long>(tick), where, ci, bit,
                     kMatNames[static_cast<int>(ca.was)],
                     kMatNames[static_cast<int>(m)]);
        if (g_regrowVerifies < 3) {
            ++g_regrowVerifies;
            const bool ok = mirror.verify(w);
            std::fprintf(stderr, "[regrow] mirror verify: %s\n",
                         ok ? "CPU==GPU" : "DIVERGED");
        }
        ca.key = 0;
        ca.was = 0;
    }
}
// CPU-цена мира-автомата в кадре (профиль по числам, закон дома): шов
// назад (apply) и запись подтиков (record). Лейна poll УБИТА (К1-15,
// аудит 2026-08-25): печатала вечный 0.00 — читалось «poll бесплатен»
// вместо правды «poll не существует» (умер с CPU-протоколом).
static float g_mediumApplyMs = 0.0f;
static float g_mediumRecMs = 0.0f;
static float carve_ms_since(std::chrono::steady_clock::time_point t0) {
    return std::chrono::duration<float, std::milli>(
               std::chrono::steady_clock::now() - t0)
        .count();
}

// [prof] GIGA_PROF=1 — постоянная per-system разбивка CPU-кадра. Детектор
// [hitch] ниже печатает разбор только дороже порога (50 мс) — кадр между
// бюджетом и порогом был НЕМЫМ (слепая зона §59.25). Здесь каждая именованная
// система копит мс в g_profFrameMs, топ следующего кадра толкает суммы в
// кольца ([core/prof.h]) и раз в 256 кадров печатает свод: медиана/p90/пик
// по каждой строке + счётчики live + GPU-пассы. Выключено (по умолчанию) —
// ноль замеров: prof_now() не читает часы, prof_add() — одна ветка.
enum ProfSlot : unsigned {
    // внутри сим-тика (сумма по подшагам кадра)
    kProfTick,        // весь while(simAccum) — «прочее тика» = tick − сумма имён
    kProfNoise,       // noise_step — старение поля шума
    kProfDiffusion,   // ai_panic_publish_step + diffusion_tick
    kProfAi,          // ai_step + ai_equip_step
    kProfController,  // controller_step
    kProfWander,      // ai_patrol_step + wander_step (толпа)
    kProfAcoustics,   // noise_acoustics_step + investigate_step (скелет слуха)
    kProfCombat,      // player_melee..mob_attack..hazard..projectile..charge
    kProfPhysics,     // slow_step + physics_step (агенты)
    kProfRigid,       // rigid_body_step (твердотелы/рагдоллы)
    kProfImpact,      // attachment_reaper_step + impact_damage_step
    kProfNeeds,       // encumbrance_step + needs_step
    // раз в кадр
    kProfFocus,       // focus_pick — прицел интеракций
    kProfWitness,     // witness_step (S19)
    kProfNav,         // nav.step — амортизированный ребейк
    kProfBigJudge,    // большой суд — порция флуда/конверсии (big-judge.md)
    kProfCount
};
static const char* const kProfName[kProfCount] = {
    "tick",   "noise",     "diffusion", "ai",     "controller",
    "wander", "acoustics", "combat",    "physics", "rigid",
    "impact", "needs",     "focus",     "witness", "nav",
    "big_judge"};
static const bool g_profOn = [] {
    const char* e = std::getenv("GIGA_PROF");
    return e != nullptr && e[0] != '\0' && e[0] != '0';
}();
static float g_profFrameMs[kProfCount] = {};
static giga::prof::Ring g_profRing[kProfCount];
// Накопительный счёт тел, разбуженных долгом писателя АВТОМАТА (шов
// mediumMaskChanged → rigid_wake_dirty_cells) — печатается в rigid-stats.
static std::uint64_t g_profMediumRigidWakes = 0;
static std::chrono::steady_clock::time_point prof_now() {
    return g_profOn ? std::chrono::steady_clock::now()
                    : std::chrono::steady_clock::time_point{};
}
static void prof_add(unsigned slot, std::chrono::steady_clock::time_point t0) {
    if (g_profOn) g_profFrameMs[slot] += carve_ms_since(t0);
}

// Метки кадра для детектора хитча (carve-hitch.md, инкремент 1б): что
// происходило в кадре, который только что закончился. Пишутся по ходу кадра,
// читаются в топе СЛЕДУЮЩЕГО — wall-clock кадра впервые известен там, — там
// же сбрасываются. Детектор закрывает вопрос «CPU или GPU» наверняка: любой
// ощутимый затык обязан оставить строку [hitch] с разбором.
struct FrameMark {
    float carveMs = 0.0f;     // [carve] total этого кадра
    float lightSwapMs = 0.0f; // залив свапа бейка видимости на GPU
    float propSkinMs = 0.0f;  // merge_ecs_prop_meshes
    bool floorEntry = false;  // begin_floor_nav: Fresh-бейк (свет+rooms) синхронно
    // ВЕРХНЕУРОВНЕВЫЕ СЕКЦИИ КАДРА (2026-08-22). Хитч-лог владельца принёс
    // кадры ~1000 мс со ВСЕМИ нулевыми метками и малым GPU — слепая зона
    // класса 59.25: точечные метки не покрывают кадр целиком. Две секции
    // делят его без дыр: simMs — от верха кадра до начала записи рендера
    // (события, весь сим, консоль); renderMs — запись+сабмит+презент.
    // «other» в печати = wall − sim − render (ожидание vsync/своп/хвост).
    float simMs = 0.0f;
    float renderMs = 0.0f;
};
static FrameMark g_frameMark;
// Верх кадра — точка отсчёта секций; ставится в блоке детектора хитча.
static std::chrono::steady_clock::time_point g_frameT0;

// Долг каждого запечённого слоя перед карвом — dirtyCells ([world/destruct.h]);
// диффузия — единственный слой с ГОТОВЫМ поклеточным O(1)-приёмником, у
// которого было НОЛЬ вызывающих: опасность текла сквозь закрытые двери и не
// текла сквозь свежий пролом (markoaudit-systems.md §1.8). Гейт по слою —
// битсет построен для driver.layer; чужой слой перестроит on_floor_built.
static void mark_diffusion_dirty(DiffusionDriver& driver, const MacroGrid& grid,
                                 LayerId layer,
                                 const std::vector<std::uint32_t>& dirtyCells) {
    if (driver.layer != layer) return;
    for (std::uint32_t idx : dirtyCells) {
        const int x = static_cast<int>(idx % kMacroDim);
        const int y = static_cast<int>((idx / kMacroDim) % kMacroDim);
        const int z = static_cast<int>(idx / (kMacroDim * kMacroDim));
        diffusion_mark_cell(grid, driver.scratch, x, y, z);
    }
}

// «Задел ли карв светоматериал» отвечает patch_emitter_field по dirtyCells
// ПОСЛЕ карва: поле помнит, что светило до, — сравнение честное и
// субвоксельное. Прежняя проверка до карва спрашивала только тип ячейки и не
// видела неон, нарисованный атомами ([markoaudit/plans/neon-topology.md] §4).

float samosbor_fog_scale(const game::SamosborState& st); // определение ниже

static void collect_scene_lights(gpu::GpuLightGrid& grid, const vec3& camPos,
                                 float timeSec, const game::SamosborState& samosbor,
                                 const Registry& reg, LayerId activeLayer,
                                 const game::NoiseField* noiseField = nullptr,
                                 const game::PowerGridState* powerGrid = nullptr,
                                 const vec3& camForward = vec3{1.0f, 0.0f, 0.0f},
                                 const vec3& camUp = vec3{0.0f, 0.0f, 1.0f},
                                 const game::NpcPool* pool = nullptr,
                                 Entity player = entt::null) {
    // Перестроенная статик-таблица (вход этажа, карв светоматериала) — залить
    // один раз; кадр дальше пишет только интенсивности и динамический хвост.
    if (g_lightTableUploadedGen != g_staticTableGen) {
        grid.set_static_table(g_staticLightBase.data(),
                              static_cast<std::uint32_t>(g_staticLightBase.size()));
        g_lightTableUploadedGen = g_staticTableGen;
    }
    grid.clear_lights();

    // Свет от камеры ЗАПРЕЩЁН (решение владельца 2026-08-17): НПЦ = игрок,
    // бесплатного налобника не существует. Фонарик будет ПРЕДМЕТОМ инвентаря —
    // add_light с конусом, тем же, каким получат его и NPC. [ddalight.md]
    //
    // Единственный закон калла: источник существует, если его сфера СВОЕГО
    // радиуса касается сферы видимости (радиус тумана) вокруг КАМЕРЫ. Общих
    // констант нет — лампы разные, решает радиус каждой. Иначе лампа
    // «загорается» при приближении (репорт владельца — каллы были 32-48 м при
    // видимости 128). Камерный сорт и kMaxPointLights мертвы (V-A/V-C):
    // отбор статикам даёт бейк видимости, динамиков — единицы. [ddalight.md]
    // Радиус видимости — ТА ЖЕ формула, что fog.y пуша (kWorldExtent/2 ×
    // множитель самосбора): ручная копия без fogScale разъехалась (К1-13,
    // аудит 2026-08-25) — весь самосбор свет отбирался по полному радиусу,
    // и параметр samosbor в сигнатуре висел неиспользуемым.
    const float kFogRadius =
        kWorldExtent * 0.5f * samosbor_fog_scale(samosbor);
    auto light_reaches_view = [&](const vec3& pos, float radius) {
        const float dx = wrap_delta_f(camPos.x, pos.x, kWorldExtent);
        const float dy = wrap_delta_f(camPos.y, pos.y, kWorldExtent);
        const float dz = wrap_delta_f(camPos.z, pos.z, kWorldExtent);
        const float reach = kFogRadius + radius;
        return dx * dx + dy * dy + dz * dz <= reach * reach;
    };

    // 2. Тревога самосбора БОЛЬШЕ НЕ СВЕТИТ ОТ КАМЕРЫ. Здесь жил последний
    // камерный источник (add_light(camPos+3м, 48 м) — прямое нарушение S5
    // «света от камеры не существует», найден аудитом 2026-08-20 в тридцати
    // строках под самим законом) — удалён. Тревогу несут сирена (аудио) и
    // сжатие мглы (fogScale/samosborPulse); аварийное ЦВЕТНОЕ освещение по
    // варианту самосбора — это программа ЩИТКА (S15.4: «аварийное освещение —
    // другая программа щитка»), а не источник из воздуха.

    // 3. Mob Emitters (Lampovy & Lampoglaz)
    for (auto e : reg.view<const game::MobRef, const Transform>()) {
        const Transform& tr = reg.get<const Transform>(e);
        if (tr.layer != activeLayer) continue;
        const game::MobRef& m = reg.get<const game::MobRef>(e);
        const auto kind = static_cast<game::MobKind>(m.kind);

        if (kind == game::MobKind::Lampovy && light_reaches_view(tr.pos, 12.0f)) {
            grid.add_light(tr.pos + vec3{0.0f, 0.0f, 1.2f}, 12.0f, vec3{1.0f, 0.88f, 0.65f}, 2.0f);
        } else if (kind == game::MobKind::Lampoglaz && light_reaches_view(tr.pos, 16.0f)) {
            grid.add_light(tr.pos + vec3{0.0f, 0.0f, 1.5f}, 16.0f, vec3{0.70f, 0.95f, 1.0f}, 2.8f);
        }
    }

    // 4. Маячок неоткрытого ящика УДАЛЁН (решение владельца 2026-08-21,
    // реализм: ящик не лампа; лут ищется глазами и фонарём). Ящик — проп
    // (B1), светиться может только строкой props.csv, как любой проп.

    // 5. Flying Tracer & Plasma Projectile Light Emitters
    for (auto e : reg.view<const game::Projectile, const Transform>()) {
        const Transform& tr = reg.get<const Transform>(e);
        if (tr.layer != activeLayer) continue;
        const game::Projectile& proj = reg.get<const game::Projectile>(e);
        if (proj.ttlMs == 0) continue;

        if (light_reaches_view(tr.pos, 10.0f)) {
            // One colour for every shot in the air. It used to be two, keyed on
            // `Projectile::team` — but a bullet no longer knows whose it is, and a
            // HUD that claimed otherwise would be teaching the player a rule the
            // simulation stopped having.
            vec3 pcol = vec3{1.0f, 0.85f, 0.40f};
            grid.add_light(tr.pos, 10.0f, pcol, 2.5f);
        }
    }

    // 6. «Свет из шума» УДАЛЁН (2026-08-17). Блок вешал мерцающий свет на
    // КАМЕРУ по каждому громкому событию — а шум шагов существует только на
    // земле (grounded-гейт encumbrance_step), поэтому читалось как «налобник
    // включается от WASD и гаснет в прыжке» (репорт владельца). Пока свет
    // красил один туман, обман был незаметен; когда лампы стали освещать
    // поверхности — вылез. Звук из физики, свет из ПРЕДМЕТОВ; синестезии не
    // место в сетке. [ddalight.md]

    // 7. Пропы-света: ЛЮБОЙ проп, чья строка data/props.csv светит, — PropLight
    // испечён при спавне ([prop_system.h]), спец-случая «лампочка» нет; радиус,
    // цвет и интенсивность — из таблицы. Гейты: Interactable.active (выкручена/
    // разбита) для всех; power cut и хрущёвское мерцание — только для mains
    // (проп на общей сети, interact LightBulb); прибор со своим питанием живёт
    // при обесточке. [ddalight.md]
    std::uint32_t dbgTotal = 0, dbgLit = 0, dbgUnpowered = 0, dbgInactive = 0,
                  dbgCulled = 0;
    {
        auto lampView = reg.view<const Transform, const game::PropLight>();
        for (auto e : lampView) {
            const Transform& tr = lampView.get<const Transform>(e);
            if (tr.layer != activeLayer) continue;
            ++dbgTotal;
            const game::PropLight& pl = lampView.get<const game::PropLight>(e);
            if (const auto* ia = reg.try_get<const game::Interactable>(e);
                ia && !ia->active) {
                ++dbgInactive;
                continue;
            }

            const vec3 pos = tr.pos + vec3{0.0f, 0.0f, -pl.dropM};
            const auto profile = static_cast<game::FlickerProfile>(pl.flicker);
            // Только mains-профиль сидит на общей сети — power cut гасит его;
            // прибор со своим питанием живёт при обесточке. (Сеть под
            // пересмотром владельца — глубже не связываемся.)
            if (profile == game::FlickerProfile::Mains && powerGrid &&
                powerGrid->is_power_cut(pos)) {
                ++dbgUnpowered;
                continue;
            }

            // ЕДИНАЯ функция мерцания ([game/flicker.h] == shaders/flicker.glsl):
            // та же математика красит emissive плафона в prop.frag — свет и
            // арматура пульсируют синхронно по построению.
            const float intensity =
                pl.intensity * game::flicker_factor(profile, pos, timeSec);

            // Заякоренный проп — статик-слот: в кадре пишется ТОЛЬКО
            // интенсивность, позиция/радиус испечены таблицей, камерного калла
            // нет (видимость — свойство геометрии, не камеры; S7). Слот
            // kNoLightSlot у заякоренного = срез GIGA_LIGHT_BUDGET (no-op в
            // set_static_intensity). Сорванный в RagdollRoll — динамический
            // хвост со своей живой позицией (план §3.4).
            if (reg.all_of<game::StaticPropTag>(e)) {
                grid.set_static_intensity(pl.slot, intensity);
            } else {
                if (!light_reaches_view(pos, pl.radiusM)) {
                    ++dbgCulled;
                    continue;
                }
                grid.add_light(pos, pl.radiusM, pl.color, intensity);
            }
            ++dbgLit;
        }
    }

    // 8. Светоматериалы — статические эмиттеры бейка этажа ([light_bake.h]):
    // нарисованная светом вывеска, неоновая полоса, вылепленная вокселями
    // лампа — настоящие источники, с тенями и гало. Слоты назначены
    // rebuild_static_light_table; в кадре — только интенсивность (кластер не
    // мерцает, но слот обязан переписываться после нуля clear_lights, и это
    // же место умрёт клеточным мерцанием от щитка, S15.4).
    for (std::size_t i = 0; i < g_bakedFloorLights.size(); ++i) {
        grid.set_static_intensity(g_bakedLightSlots[i],
                                  g_bakedFloorLights[i].intensity);
    }

    // 9. Свет из РУК: экипированный инструмент игрока ([equip.h] Tool), чья
    // строка data/items.csv светит — фонарик конусом по взгляду. Это ПРЕДМЕТ,
    // не свет камеры: его находят в луте, экипируют решением (`equip`), его
    // можно проиграть в кости или отдать — закон «НПЦ = игрок» цел. NPC
    // получат тот же путь, когда ai_equip_step научится инструментам.
    // Цвет пока белый — цветовые колонки items.csv добавим с первым цветным
    // носимым источником ([item_table.h]).
    if (pool && reg.valid(player)) {
        const game::NpcRef* nr = reg.try_get<game::NpcRef>(player);
        const game::Equipped* eq = reg.try_get<game::Equipped>(player);
        if (nr && eq && pool->valid(nr->id))
            // ДВЕ РУКИ (two-hands.md, верб «светить»): светящий предмет
            // светит из ТОЙ руки, где лежит — фонарик на ЛКМ или ПКМ, или
            // по одному в каждой. Параллакс руки зеркален по стороне.
            for (int hIdx = 0; hIdx < 2; ++hIdx) {
                const game::ItemId tool = game::equipped_hand(
                    pool->inventory(nr->id), *eq, hIdx == 1);
                if (tool == game::kInvalidItem) continue;
                const game::ItemDef& d = game::item_def(tool);
                if (d.lightRadiusMm != 0 && d.lightIntensityE3 != 0) {
                    // Фонарик — В РУКЕ, не в глазу. Свет с нулевым параллаксом
                    // от камеры не может показать НИ ОДНОЙ тени по построению
                    // (заслон прячет путь света и путь взгляда одновременно) и
                    // читается «искусственным кругом» (репорт владельца).
                    // Рука: полплеча вправо (0.28), локоть ниже глаз (0.30),
                    // чуть вперёд (0.10) — параллакс возвращает тени и живой
                    // край луча; камера просто рендерит. NPC получат ту же
                    // руку от своего Transform/facing.
                    const vec3 right = normalize(cross(camForward, camUp));
                    // ПКМ-рука справа (+0.28), ЛКМ — слева (−0.28).
                    const float side = hIdx == 1 ? 0.28f : -0.28f;
                    const vec3 handPos = vec3{
                        camPos.x + right.x * side - camUp.x * 0.30f + camForward.x * 0.10f,
                        camPos.y + right.y * side - camUp.y * 0.30f + camForward.y * 0.10f,
                        camPos.z + right.z * side - camUp.z * 0.30f + camForward.z * 0.10f};
                    const float radius =
                        static_cast<float>(d.lightRadiusMm) * 0.001f;
                    const float intensity =
                        static_cast<float>(d.lightIntensityE3) * 0.001f *
                        game::flicker_factor(
                            static_cast<game::FlickerProfile>(d.flickerProfile),
                            handPos, timeSec);
                    const vec3 white{1.0f, 1.0f, 1.0f};
                    if (d.lightConeDeg != 0) {
                        const float cosOuter = std::cos(
                            static_cast<float>(d.lightConeDeg) *
                            (3.14159265f / 180.0f));
                        grid.add_light(handPos, radius, white, intensity,
                                       camForward, cosOuter);
                    } else {
                        grid.add_light(handPos, radius, white, intensity);
                    }
                }
            }
    }

    // GIGA_LIGHT_DBG=1: строка раз в ~2 с — кто из пропов-светов жив и куда
    // делись остальные. На GPU теперь едет вся таблица (кап-512 мёртв);
    // static/dynamic — граница секций. Диагностика «ниже не светятся»
    // ([ddalight.md]).
    static const bool kLightDbg = std::getenv("GIGA_LIGHT_DBG") != nullptr;
    if (kLightDbg) {
        static std::uint32_t frame = 0;
        if ((frame++ % 120u) == 0u) {
            std::fprintf(stderr,
                         "[light-dbg] props total=%u lit=%u inactive=%u unpowered=%u culled=%u"
                         " | static=%u total=%u dropped=%u\n",
                         dbgTotal, dbgLit, dbgInactive, dbgUnpowered, dbgCulled,
                         grid.static_count(), grid.active_light_count(),
                         grid.overflow_dropped());
        }
    }
}

static bool contains_icase(const char* haystack, const char* needle) {
    if (!haystack || !needle || !*needle) return true;
    for (; *haystack; ++haystack) {
        const char* h = haystack;
        const char* n = needle;
        while (*h && *n && (std::tolower(static_cast<unsigned char>(*h)) == std::tolower(static_cast<unsigned char>(*n)))) {
            ++h; ++n;
        }
        if (!*n) return true;
    }
    return false;
}

static void DrawCraftingWindowUI(bool* p_open, game::CraftingState& crafting, 
                          game::Inventory& inv, game::CraftStation currentStation, 
                          std::uint64_t simTick, Registry& reg, Entity player,
                          game::NpcPool& pool, std::uint32_t& outCrafted, 
                          std::uint32_t& outScrapped, std::uint32_t& outLearned) 
{
    if (!p_open || !*p_open) return;

    ImGui::SetNextWindowSize(ImVec2(820, 560), ImGuiCond_FirstUseEver);
    if (!ImGui::Begin("Workbench & Crafting Studio", p_open)) {
        ImGui::End();
        return;
    }

    static int selectedRecipeId = 1;
    static int craftQty = 1;
    static char recipeFilter[64] = "";
    static bool showOnlyKnown = false;

    const char* stationNames[] = { "Bare Hands (Any)", "Workbench", "Lathe", "Lab", "Net Terminal" };
    const char* matNames[] = { "Mech", "Elec", "Cons", "Bio", "Chem", "Metal", "Psi", "Meta" };

    ImGui::TextColored(ImVec4(0.35f, 0.85f, 1.0f, 1.0f), "Station: %s | Cert Tier: T%u",
                       stationNames[static_cast<std::size_t>(currentStation)], crafting.tier);
    ImGui::Separator();

    ImGui::Text("Material Bank:");
    ImGui::SameLine();
    for (std::size_t i = 0; i < game::kCraftMaterials; ++i) {
        ImGui::Text("%s: %u", matNames[i], crafting.mat[i]);
        if (i < game::kCraftMaterials - 1) ImGui::SameLine();
    }
    ImGui::Separator();

    if (ImGui::BeginTabBar("CraftingTabs")) {
        if (ImGui::BeginTabItem("Craft Items")) {
            ImGui::BeginChild("RecipeListPane", ImVec2(340, 320), true);
            ImGui::InputText("Filter", recipeFilter, sizeof(recipeFilter));
            ImGui::Checkbox("Known Only", &showOnlyKnown);

            ImGui::Separator();
            if (ImGui::BeginListBox("##Recipes", ImVec2(-FLT_MIN, -FLT_MIN))) {
                for (game::ItemId id = 1; id <= game::kCraftRecipeCount; ++id) {
                    const bool isKnown = game::craft_known(crafting, id);
                    if (showOnlyKnown && !isKnown) continue;

                    const char* name = game::item_name(id);
                    if (recipeFilter[0] != '\0' && !contains_icase(name, recipeFilter)) continue;

                    const game::CraftFail fail = game::craft_check(crafting, inv, id, currentStation);

                    char label[128];
                    snprintf(label, sizeof(label), "%s [%s]%s", 
                             name, isKnown ? "Learned" : "Locked", 
                             fail == game::CraftFail::None ? " *" : "");

                    bool isSelected = (selectedRecipeId == static_cast<int>(id));
                    if (ImGui::Selectable(label, isSelected)) {
                        selectedRecipeId = static_cast<int>(id);
                    }
                    if (isSelected) ImGui::SetItemDefaultFocus();
                }
                ImGui::EndListBox();
            }
            ImGui::EndChild();

            ImGui::SameLine();

            ImGui::BeginChild("RecipeDetailPane", ImVec2(0, 320), true);
            if (selectedRecipeId >= 1 && selectedRecipeId <= static_cast<int>(game::kCraftRecipeCount)) {
                const auto id = static_cast<game::ItemId>(selectedRecipeId);
                const game::CraftRecipe& rec = game::craft_recipe(id);
                const char* itemName = game::item_name(id);
                const bool known = game::craft_known(crafting, id);
                const game::CraftFail checkResult = game::craft_check(crafting, inv, id, currentStation);

                ImGui::TextColored(ImVec4(1.0f, 0.9f, 0.4f, 1.0f), "%s", itemName);
                ImGui::Text("Required Tier: T%u | Required Bench: %s", rec.tier, stationNames[rec.station]);
                ImGui::Text("Knowledge Status: %s", known ? "Learned" : "Not Learned");
                ImGui::Separator();

                std::uint32_t missing[game::kCraftMaterials] = {};
                game::craft_missing(crafting, id, missing);

                ImGui::Text("Required Components:");
                if (ImGui::BeginTable("CompTable", 4, ImGuiTableFlags_BordersInnerH | ImGuiTableFlags_RowBg)) {
                    ImGui::TableSetupColumn("Material");
                    ImGui::TableSetupColumn("Required");
                    ImGui::TableSetupColumn("In Bank");
                    ImGui::TableSetupColumn("Shortfall");
                    ImGui::TableHeadersRow();

                    for (std::size_t i = 0; i < game::kCraftMaterials; ++i) {
                        if (rec.comp[i] == 0) continue;
                        ImGui::TableNextRow();
                        ImGui::TableSetColumnIndex(0); ImGui::Text("%s", matNames[i]);
                        ImGui::TableSetColumnIndex(1); ImGui::Text("%u", rec.comp[i]);
                        ImGui::TableSetColumnIndex(2); ImGui::Text("%u", crafting.mat[i]);
                        ImGui::TableSetColumnIndex(3);
                        if (missing[i] > 0) {
                            ImGui::TextColored(ImVec4(1.0f, 0.3f, 0.3f, 1.0f), "-%u", missing[i]);
                        } else {
                            ImGui::TextColored(ImVec4(0.3f, 1.0f, 0.3f, 1.0f), "OK");
                        }
                    }
                    ImGui::EndTable();
                }

                ImGui::Separator();
                ImGui::SliderInt("Quantity", &craftQty, 1, 10);

                const bool canCraft = (checkResult == game::CraftFail::None);
                if (!canCraft) ImGui::BeginDisabled();

                if (ImGui::Button("Craft Item(s)", ImVec2(160, 32))) {
                    for (int q = 0; q < craftQty; ++q) {
                        game::CraftResult res = game::craft_item(crafting, inv, id, currentStation);
                        if (res.fail == game::CraftFail::None) {
                            outCrafted++;
                            game::sync_armour(reg, pool, player);
                        } else {
                            break;
                        }
                    }
                }

                if (!canCraft) {
                    ImGui::EndDisabled();
                    ImGui::SameLine();
                    ImGui::TextColored(ImVec4(1.0f, 0.4f, 0.4f, 1.0f), "[%s]", game::craft_fail_text(checkResult));
                }
            }
            ImGui::EndChild();

            ImGui::EndTabItem();
        }

        if (ImGui::BeginTabItem("Disassemble Inventory")) {
            ImGui::Text("Disassemble items into base materials (Requires Workbench).");
            if (currentStation != game::CraftStation::Workbench) {
                ImGui::TextColored(ImVec4(1.0f, 0.3f, 0.3f, 1.0f), "WARNING: Requires a Workbench!");
            }
            ImGui::Separator();

            if (ImGui::BeginTable("DisassemblyTable", 5, ImGuiTableFlags_ScrollY | ImGuiTableFlags_Borders | ImGuiTableFlags_RowBg, ImVec2(0, 350))) {
                ImGui::TableSetupColumn("Slot", ImGuiTableColumnFlags_WidthFixed, 40.0f);
                ImGui::TableSetupColumn("Item Name");
                ImGui::TableSetupColumn("Count", ImGuiTableColumnFlags_WidthFixed, 60.0f);
                ImGui::TableSetupColumn("Est. Value");
                ImGui::TableSetupColumn("Action", ImGuiTableColumnFlags_WidthFixed, 120.0f);
                ImGui::TableHeadersRow();

                for (int slot = 0; slot < game::kInvSlots; ++slot) {
                    const game::ItemSlot& s = inv.slots[slot];
                    if (!game::item_valid(s.item) || s.count == 0) continue;

                    ImGui::TableNextRow();
                    ImGui::TableSetColumnIndex(0); ImGui::Text("#%d", slot);
                    ImGui::TableSetColumnIndex(1); ImGui::Text("%s", game::item_name(s.item));
                    ImGui::TableSetColumnIndex(2); ImGui::Text("%u", s.count);
                    ImGui::TableSetColumnIndex(3); ImGui::Text("%d rub", game::item_def(s.item).value);
                    ImGui::TableSetColumnIndex(4);

                    char btnId[32];
                    snprintf(btnId, sizeof(btnId), "Scrap##%d", slot);

                    const bool canDis = (currentStation == game::CraftStation::Workbench);
                    if (!canDis) ImGui::BeginDisabled();

                    if (ImGui::Button(btnId)) {
                        game::DisassembleResult dres = game::craft_disassemble(
                            crafting, inv, slot, currentStation, static_cast<std::uint32_t>(simTick));
                        if (dres.fail == game::CraftFail::None) {
                            outScrapped++;
                            if (dres.learned) outLearned++;
                            game::sync_armour(reg, pool, player);
                        }
                    }

                    if (!canDis) ImGui::EndDisabled();
                }
                ImGui::EndTable();
            }

            ImGui::EndTabItem();
        }

        ImGui::EndTabBar();
    }

    ImGui::End();
}

// ── Debug console overlay (~) ──────────────────────────────────────────────
// Thin ImGui shell over game::Console ([console.h]): parsing, the command
// table, and contextual completion are HEADLESS game code (tested in
// game_test); this only draws a log, one input line, Tab completion and
// Up/Down history. The '`'/'~' chars are filtered so the toggle key never
// types into its own console.
struct ConsoleUiRefs {
    game::Console* con;
    const game::ConsoleContext* ctx;
    std::vector<std::string>* log;
    std::vector<std::string>* history;
    int* histPos;
};

static int ConsoleInputCallback(ImGuiInputTextCallbackData* data) {
    ConsoleUiRefs& ui = *static_cast<ConsoleUiRefs*>(data->UserData);
    if (data->EventFlag == ImGuiInputTextFlags_CallbackCharFilter)
        return (data->EventChar == '`' || data->EventChar == '~') ? 1 : 0;
    if (data->EventFlag == ImGuiInputTextFlags_CallbackCompletion) {
        const char* cands[16];
        const std::uint32_t n = ui.con->complete(*ui.ctx, data->Buf, cands, 16);
        if (n == 0) return 0;
        // The word under completion starts after the last space — the same
        // split rule Console::complete used to produce the candidates.
        int ws = data->BufTextLen;
        while (ws > 0 && data->Buf[ws - 1] != ' ' && data->Buf[ws - 1] != '\t')
            --ws;
        // Longest common prefix of the candidates; with one candidate that is
        // the whole token and a trailing space arms the next argument.
        char lcp[128];
        std::snprintf(lcp, sizeof lcp, "%s", cands[0]);
        for (std::uint32_t i = 1; i < n; ++i) {
            std::size_t j = 0;
            while (lcp[j] && cands[i][j] == lcp[j]) ++j;
            lcp[j] = '\0';
        }
        data->DeleteChars(ws, data->BufTextLen - ws);
        data->InsertChars(ws, lcp);
        if (n == 1) data->InsertChars(data->CursorPos, " ");
        if (n > 1) { // ambiguous: show the choices like a shell would
            std::string listed;
            for (std::uint32_t i = 0; i < n; ++i) {
                listed += cands[i];
                listed += ' ';
            }
            ui.log->push_back(listed);
        }
        return 0;
    }
    if (data->EventFlag == ImGuiInputTextFlags_CallbackHistory) {
        if (ui.history->empty()) return 0;
        int& pos = *ui.histPos;
        if (data->EventKey == ImGuiKey_UpArrow) {
            if (pos < 0) pos = static_cast<int>(ui.history->size()) - 1;
            else if (pos > 0) --pos;
        } else if (data->EventKey == ImGuiKey_DownArrow) {
            if (pos >= 0 && pos < static_cast<int>(ui.history->size()) - 1) ++pos;
            else pos = -1;
        }
        data->DeleteChars(0, data->BufTextLen);
        if (pos >= 0) data->InsertChars(0, (*ui.history)[pos].c_str());
        return 0;
    }
    return 0;
}

static void DrawConsoleUI(bool* p_open, bool* p_focus, char* inputBuf,
                          std::size_t inputCap, game::Console& con,
                          game::ConsoleContext& ctx,
                          std::vector<std::string>& log,
                          std::vector<std::string>& history, int& histPos) {
    if (!*p_open) return;
    const ImGuiIO& io = ImGui::GetIO();
    ImGui::SetNextWindowPos(ImVec2(0, 0));
    ImGui::SetNextWindowSize(ImVec2(io.DisplaySize.x, io.DisplaySize.y * 0.45f));
    if (!ImGui::Begin("Console", p_open,
                      ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoResize |
                          ImGuiWindowFlags_NoCollapse)) {
        ImGui::End();
        return;
    }
    const float footer =
        ImGui::GetStyle().ItemSpacing.y + ImGui::GetFrameHeightWithSpacing();
    ImGui::BeginChild("##console_log", ImVec2(0, -footer), true,
                      ImGuiWindowFlags_HorizontalScrollbar);
    for (const std::string& s : log) ImGui::TextUnformatted(s.c_str());
    if (ImGui::GetScrollY() >= ImGui::GetScrollMaxY() - 1.0f)
        ImGui::SetScrollHereY(1.0f);
    ImGui::EndChild();

    ConsoleUiRefs ui{&con, &ctx, &log, &history, &histPos};
    ImGui::SetNextItemWidth(-FLT_MIN);
    const ImGuiInputTextFlags flags =
        ImGuiInputTextFlags_EnterReturnsTrue |
        ImGuiInputTextFlags_CallbackCompletion |
        ImGuiInputTextFlags_CallbackHistory |
        ImGuiInputTextFlags_CallbackCharFilter;
    if (*p_focus) {
        ImGui::SetKeyboardFocusHere();
        *p_focus = false;
    }
    if (ImGui::InputText("##console_in", inputBuf, inputCap, flags,
                         ConsoleInputCallback, &ui)) {
        if (inputBuf[0]) {
            log.push_back(std::string("> ") + inputBuf);
            char outMsg[256];
            con.exec(ctx, inputBuf, outMsg, sizeof outMsg);
            if (outMsg[0]) log.push_back(outMsg);
            // `help` lists the registry itself, so a new command's usage/help
            // shows up here with no console edit — the table IS the docs.
            if (std::strcmp(inputBuf, "help") == 0) {
                for (std::size_t i = 0; i < con.count(); ++i) {
                    const game::ConsoleCommand& c = con.at(i);
                    log.push_back(std::string("  ") + c.usage + " — " + c.help);
                }
            }
            history.push_back(inputBuf);
            histPos = -1;
            inputBuf[0] = '\0';
        }
        *p_focus = true; // stay in the input line for the next command
    }
    ImGui::End();
}

// The player's unencumbered walk speed. Named here because the survival clock now
// scales it every tick, so the base value has to live somewhere that is not the
// Controller it overwrites — otherwise the first exhausted tick would halve the
// speed and the second would halve the already-halved value, decaying to zero.
// Matches Controller::moveSpeed's own default ([components.h]).
constexpr float kPlayerWalkSpeed = 6.0f;       // fog.w, scales the hemispheric term

// The demo floor stack: one row per floor MODULE. Numbers are the in-game labels
// the FloorRegistry assigns (floors.md); kinds are picked to show every geometry
// family side by side. Floor 0 is the residential hub the player starts on.
struct DemoFloor {
    int number;
    game::FloorKind kind;
};
//
// The numbers are DEEP on purpose, and this is a correction rather than content.
// The stack used to be 0..4, and every depth budget in the game keys off |z|:
//
//   * `anchor_for_floor` snaps anything within a few floors of 0 to FloorBit::Z0, so
//     all five floors drew from the same habitat slice of the 69-kind roster.
//   * `samosbor_duty01` at |z| <= 4 is ~2%, so the depth gradient the samosbor clock
//     exists to produce was invisible — one duty figure, five floors.
//   * `economy_band` put every floor in E0, capping loot at 90 roubles, so the
//     extraction loop's entire risk/reward curve was flat.
//
// Three shipped systems were therefore unobservable, and no test would have said so
// because each of them is correct in isolation. The anchors the mob ecology actually
// authors are {-50, -36, -26, 0, +14, +30}, so the stack now reaches them: the hub,
// two shallow floors, then the four descending anchors and the two above.
constexpr DemoFloor kDemoFloors[] = {
    {0, game::FloorKind::Residential},   // start / hub — E0, samosbor ~2% duty
    {1, game::FloorKind::Commercial},
    {2, game::FloorKind::Industrial},
    {-8, game::FloorKind::Derelict},     // E1
    {-14, game::FloorKind::Industrial},  // E2
    {-26, game::FloorKind::Derelict},    // anchor ZMinus26 — E3
    {-36, game::FloorKind::Industrial},  // anchor ZMinus36
    {-50, game::FloorKind::Derelict},    // anchor ZMinus50 — E4, samosbor ~94% duty
    {14, game::FloorKind::Commercial},   // anchor ZPlus14 — up is depth too
    {30, game::FloorKind::Residential},  // anchor ZPlus30
};

// The floor catalog — the data-driven "ANY number -> a floor" index
// ([floor_catalog.h]). The pattern rows (the modulo V-shape defaults) and every
// module folder's explicit claim (the padic module claims 4) come from
// build_default_floor_catalog; the demo rows above are layered on as this app's
// own claims. Built once. A refused claim — two floors on one number — logs
// loudly here and is RED in tests/suite_floorcatalog.inl, so a duplicate can
// never silently shadow a module.
const game::FloorCatalog& floor_catalog() {
    static game::FloorCatalog cat;
    static const bool ok = [] {
        bool good = game::build_default_floor_catalog(cat);
        for (const DemoFloor& f : kDemoFloors)
            good &= cat.claim(f.number, {"demo", f.kind});
        if (!good)
            std::fprintf(stderr,
                         "[floors] catalog claim REFUSED: %d conflicts, first at "
                         "floor %d — two modules on one number\n",
                         cat.conflicts(), cat.first_conflict());
        return good;
    }();
    (void)ok;
    return cat;
}

// How far the world has closed in, as a multiplier on the fog range.
//
// The fog is the only visual a samosbor has right now. It ramps IN over the first
// fifth of the Active phase and eases back OUT across the Aftermath, so one number —
// `samosbor_phase01` — produces both halves with no extra state to keep in sync.
//
// A squeeze and NOT a tint, deliberately: fog mixes to black and the encode satisfies
// f(0) == 0, which is what hides the toroidal wrap seam ([cube.frag]). Tinting would
// break that unless the clear colour moved with it, and a visible seam is the worst
// failure this renderer has. Pulling the range in is strictly safe — more fog hides
// the seam harder, never less.
float samosbor_fog_scale(const game::SamosborState& st) {
    const float p = game::samosbor_phase01(st);
    if (st.phase == static_cast<std::uint8_t>(game::SamosborPhase::Active)) {
        const float in_ = p < 0.2f ? p / 0.2f : 1.0f;
        return 1.0f - (1.0f - kSamosborFogSqueeze) * in_;
    }
    if (st.phase == static_cast<std::uint8_t>(game::SamosborPhase::Aftermath))
        return kSamosborFogSqueeze + (1.0f - kSamosborFogSqueeze) * p;
    return 1.0f;
}

// Point the fresh player's camera somewhere interesting and start ON FOOT.
// Полёт — отладочный чит (владелец, 2026-08-17), не режим по умолчанию:
// жилец прибывает на этаж телом, с гравитацией и трением, а не свободной
// камерой. Включается только явной консольной командой `fly`.
void aim_player(Registry& reg, Entity player) {
    auto& cam = reg.get<CameraTag>(player);
    cam.yaw = 0.8f;
    cam.pitch = -0.5f;
    reg.get<Controller>(player).fly = false;
}

// Kind / rule-set for ANY floor number, resolved through the catalog: an
// explicit claim when one exists, else the pattern defaults. TOTAL — pick any
// number and there is a floor there ([floor_catalog.h]), which is what lets
// teleport and streaming stop caring whether a number was hand-listed.
game::FloorKind kind_for_floor(int number) {
    return floor_catalog().resolve(number).kind;
}
const game::FloorSpec* spec_for_floor(int number) {
    return &game::floor_spec(kind_for_floor(number));
}

// Ceiling on how many monsters one floor may add. The V-shape budget saturates
// at 4096 on the deepest floors, which shares a pool with the embodied crowd and
// would be a large one-frame allocation; the demo floors (|number| <= 4) are far
// below this anyway, so it is a guard rail rather than a live limit.
constexpr std::uint32_t kMobSpawnCap = 600;

// Where a run lives on disk: a DIRECTORY PER SLOT, because the save is modular
// like the game is ([game/save.h]) and the main menu picks SLOTS, not files.
// `gigahrush2_save/slot<N>/run.sav` carries the run; each visited floor is its
// own `floor_<F>.sav` beside it, written when the player leaves that floor and
// read back whenever the floor is built again. `giga_game` does no file I/O by
// design — it links giga_core and nothing platform-shaped ([AGENTS.md]) — so
// every fopen is HERE and the formats are over there.
constexpr int kMaxSaveSlots = 8;
int g_saveSlot = 1;

void slot_dir_path(char* out, std::size_t cap, int slot) {
    std::snprintf(out, cap, "gigahrush2_save/slot%d", slot);
}
void run_save_path(char* out, std::size_t cap) {
    std::snprintf(out, cap, "gigahrush2_save/slot%d/run.sav", g_saveSlot);
}
void floor_save_path(int floor, char* out, std::size_t cap) {
    std::snprintf(out, cap, "gigahrush2_save/slot%d/floor_%d.sav", g_saveSlot,
                  floor);
}
bool slot_occupied(int slot) {
    char p[128];
    std::snprintf(p, sizeof p, "gigahrush2_save/slot%d/run.sav", slot);
    if (std::FILE* f = std::fopen(p, "rb")) {
        std::fclose(f);
        return true;
    }
    return false;
}

// WRITE BESIDE, THEN RENAME OVER. Never `fopen(path, "wb")` on the real save.
//
// "wb" truncates to zero length BEFORE the first byte is written, so the window
// between the truncation and the last fwrite is a window in which the player's
// previous save no longer exists and the new one does not exist yet. Anything that
// ends the process in that window — a disk that fills, a kill, a crash in the very
// code that is serializing — leaves a zero- or half-length file where a finished run
// used to be. That is not a corrupted save the player can be warned about; it is
// their progress, gone, and produced by the button whose entire purpose is to keep it.
// This was the only defect in the 2026-08-09 audit sweep that DESTROYS work rather
// than distorting behaviour (Docs/MASTER_ROADMAP.md 0.1а), which is why it goes first.
//
// The temp file absorbs the whole window. Until the rename, the old save is the only
// thing under `path` and it is untouched; after the rename it is replaced in one
// step. rename(2) over an existing file is atomic within a filesystem, and the temp
// is deliberately created in the SAME directory so the two are never on different
// volumes — that is the one thing that would silently turn the rename into a
// copy-then-delete and hand the window back.
//
// Every save in the game goes through here — run.sav via write_run, each floor_N.sav
// via write_floor_file — so the guarantee is not per-call-site discipline.
//
// HONEST LIMIT, stated because the next reader will otherwise assume more: this
// makes the replacement atomic, not DURABLE. There is no fsync, so a power cut can
// still lose bytes the OS had only in its page cache. Closing that needs
// fsync()/_commit() behind a platform ifdef plus a directory fsync on POSIX, and it
// buys protection against a strictly rarer event than the one above. Deliberately not
// done here; when it is, it belongs in this function and nowhere else.
bool write_bytes_file(const std::vector<std::uint8_t>& bytes, const char* path) {
    std::error_code ec; // error_code overloads: the app builds -fno-exceptions
    const std::filesystem::path finalPath(path);
    std::filesystem::create_directories(finalPath.parent_path(), ec);

    std::filesystem::path tmpPath(finalPath);
    tmpPath += ".tmp";
    const std::string tmpStr = tmpPath.string();

    std::FILE* f = std::fopen(tmpStr.c_str(), "wb");
    if (!f) return false;
    const std::size_t n = std::fwrite(bytes.data(), 1, bytes.size(), f);
    // fclose can fail where fwrite succeeded: buffered bytes only reach the OS here,
    // so a full disk usually surfaces at this call and nowhere earlier. Treating a
    // failed close as success is how a truncated file gets renamed over a good one.
    const bool wrote = (n == bytes.size()) && (std::fclose(f) == 0);
    if (!wrote) {
        std::filesystem::remove(tmpPath, ec); // leave no debris; old save stands
        return false;
    }

    std::filesystem::rename(tmpPath, finalPath, ec);
    if (ec) {
        std::filesystem::remove(tmpPath, ec);
        return false;
    }
    return true;
}

bool read_bytes_file(std::vector<std::uint8_t>& bytes, const char* path) {
    std::FILE* f = std::fopen(path, "rb");
    if (!f) return false;
    bytes.clear();
    std::uint8_t chunk[4096];
    for (;;) {
        const std::size_t got = std::fread(chunk, 1, sizeof(chunk), f);
        if (got == 0) break;
        bytes.insert(bytes.end(), chunk, chunk + got);
    }
    std::fclose(f);
    return true;
}

bool write_run(const game::SaveState& st, const char* path) {
    std::vector<std::uint8_t> bytes;
    game::save_write(st, bytes);
    return write_bytes_file(bytes, path);
}

void flush_floor_write(); // 5a, определён ниже — синхронный писатель ждёт хвост

// Persist one floor's exact grid + СУЩНОСТИ (v20/F) to its own file. A floor
// transition is a load screen, so this is sanctioned I/O ([jirnyak.md] §6).
// ЖДЁТ фоновый хвост (аудит F, жук №1): провалившаяся поездка (`[` на дне
// стека) оставляет игрока НА этаже, чей async-кодек ещё летит; F5 в этом
// окне писал ТОТ ЖЕ floor_<N>.sav.tmp вторым потоком — перемешанные байты,
// rename битого поверх хорошего, CRC-отказ и «pristine» на следующем входе.
// Этот же flush закрывает крэш-окно дюпа (№4): floor-файл покинутого этажа
// долетает до диска РАНЬШЕ, чем save_run_now запишет run.sav с лутом.
bool write_floor_file(const World& w, int floor,
                      const game::FloorEntityState& ents,
                      const game::FloorModuleKey& key) {
    flush_floor_write();
    std::vector<std::uint8_t> bytes;
    game::floor_file_write(w, floor, bytes, &ents, &key);
    char path[128];
    floor_save_path(floor, path, sizeof path);
    return write_bytes_file(bytes, path);
}

// --- 5a (elevators-2x2.md, решение владельца): ДИСК — ФОНОМ ----------------
// Кодек снимка бежит на main (слот World тут же перерабатывается под
// целевой этаж — фоновому энкодеру не из чего читать), а вот запись байтов
// на диск (~2 c из замеренных ~2.9 c кадра свапа) кадру не принадлежит.
// Один полёт за раз: новый старт ждёт прежний (поездки разделены секундами),
// а КАЖДЫЙ ЧИТАТЕЛЬ floor-файлов обязан сперва дождаться хвоста —
// flush_floor_write зовут F9-загрузка, prebuild-старт (restore-ветка читает
// файл воркером!) и выход.
std::future<bool> g_floorWritePending;
void flush_floor_write() {
    if (g_floorWritePending.valid()) {
        const bool ok = g_floorWritePending.get();
        if (!ok)
            std::fprintf(stderr, "[save] BACKGROUND floor write FAILED\n");
    }
}
void write_floor_file_async(const World& w, int floor,
                            game::FloorEntityState ents,
                            game::FloorModuleKey key) {
    flush_floor_write();
    // Кадру принадлежит только КОПИЯ того, что читает кодек (грид + страницы
    // суб-материалов, memcpy сотни мс) — сам RLE-кодек (замерен 2.7 с!) и
    // диск уезжают в фон. Слот World перерабатывается сразу после свапа,
    // поэтому фоновому кодеку не из чего читать, кроме копии; RAM транзиентно
    // щедрая — закон владельца. Сущности (v20/F) собраны вызывающим на
    // главном потоке (ECS воркеру не принадлежит) и едут значением.
    const auto t0 = std::chrono::steady_clock::now();
    auto types = std::make_shared<std::vector<CellType>>(w.grid().types());
    auto masks = std::make_shared<std::vector<SubMask>>(w.grid().masks());
    std::shared_ptr<SubField<CellType>> mats;
    if (const SubField<CellType>* f =
            w.subfields().find<CellType>(kSubMaterialName))
        mats = std::make_shared<SubField<CellType>>(*f);
    auto ep = std::make_shared<game::FloorEntityState>(std::move(ents));
    char path[128];
    floor_save_path(floor, path, sizeof path);
    std::string p(path);
    std::fprintf(stderr, "[lift] leave %d: copy %.0f ms, encode+disk in background\n",
                 floor,
                 std::chrono::duration<float, std::milli>(
                     std::chrono::steady_clock::now() - t0)
                     .count());
    g_floorWritePending =
        std::async(std::launch::async, [types, masks, mats, ep, key, floor, p]() {
            World tmp;
            tmp.grid().types_mut() = std::move(*types);
            tmp.grid().masks_mut() = std::move(*masks);
            if (mats)
                tmp.subfields().get_or_create<CellType>(kSubMaterialName) =
                    std::move(*mats);
            std::vector<std::uint8_t> bytes;
            game::floor_file_write(tmp, floor, bytes, ep.get(), &key);
            return write_bytes_file(bytes, p.c_str());
        });
}

// --- КАНАЛ ВОССТАНОВЛЕННЫХ СУЩНОСТЕЙ (v20/F, S20.6) ------------------------
// Хук restore бежит и в prebuild-ВОРКЕРЕ (build_world_half), а спавн
// сущностей — только на главном потоке в ECS-половине прибытия. Мост — карта
// «этаж → секции сущностей» под мьютексом: хук кладёт, прибытие забирает.
// Наличие записи == «этаж ВОССТАНОВЛЕН» (эта же запись — сигнал развилки
// сидеров: restore не сеет). Пустые секции — законное состояние (всё
// вынесено/сломано), поэтому сигнал — присутствие ключа, не размер.
std::mutex g_restoreMx;
std::unordered_map<int, game::FloorEntityState> g_pendingRestore;

bool take_pending_restore(int floor, game::FloorEntityState& out) {
    std::lock_guard<std::mutex> lk(g_restoreMx);
    auto it = g_pendingRestore.find(floor);
    if (it == g_pendingRestore.end()) return false;
    out = std::move(it->second);
    g_pendingRestore.erase(it);
    return true;
}

// Stamp a floor's saved state over its freshly generated geometry, if a file
// exists. Absent file = pristine floor; a REFUSED file is said out loud —
// в том числе ModuleChanged (S20.6 закон 4: модуль изменился → честная
// перегенерация, полуслияние запрещено).
bool apply_floor_file(World& w, int floor, const game::FloorModuleKey& key) {
    // СТУХШАЯ запись умирает ДО чтения (аудит F, жук №3): отменённый prebuild
    // или провал поездки оставляли запись в карте; если СЛЕДУЮЩЕЕ чтение
    // файла откажет, прибытие взяло бы RAM-состояние на пристинной материи —
    // сидеры молчат, якорная проба массово детачит. Стирание первым делом
    // делает «запись есть == ЭТО построение восстановлено» инвариантом.
    {
        std::lock_guard<std::mutex> lk(g_restoreMx);
        g_pendingRestore.erase(floor);
    }
    char path[128];
    floor_save_path(floor, path, sizeof path);
    std::vector<std::uint8_t> bytes;
    if (!read_bytes_file(bytes, path)) return false;
    game::SaveError err = game::SaveError::None;
    game::FloorEntityState ents;
    if (!game::floor_file_read(bytes.data(), bytes.size(), w, nullptr, &err,
                               &key, &ents)) {
        std::fprintf(stderr, "[save] %s refused: %s (floor regenerates pristine)\n",
                     path, game::save_error_text(err));
        return false;
    }
    {
        std::lock_guard<std::mutex> lk(g_restoreMx);
        g_pendingRestore[floor] = std::move(ents);
    }
    return true;
}

// False when there is no save, when it cannot be read, or when the format refuses it.
// `err` says which, and `game::save_error_text` turns that into a sentence for the
// player. An absent file leaves `err` at None, which is how "first run" is told apart
// from "your save is from an older build" — the two need different words.
bool read_run(game::SaveState& st, const char* path, game::SaveError& err) {
    err = game::SaveError::None;
    std::FILE* f = std::fopen(path, "rb");
    if (!f) return false;
    std::vector<std::uint8_t> bytes;
    std::uint8_t chunk[1024];
    for (;;) {
        const std::size_t got = std::fread(chunk, 1, sizeof(chunk), f);
        if (got == 0) break;
        bytes.insert(bytes.end(), chunk, chunk + got);
    }
    std::fclose(f);
    // An empty file yields bytes.data() == nullptr, which save_read reports as TooShort
    // rather than dereferencing.
    return game::save_read(bytes.data(), bytes.size(), st, &err);
}

// Repopulate the active floor's monsters: clear whatever was on the layer, then
// spawn this floor's roster from the global table ([monsters.md]). Mobs are not
// alife records — they do not fold back, they are simply destroyed and remade,
// deterministically per (floor, seed).
// Containers are placed on the same trigger as monsters and with the same
// determinism, so a floor you leave and return to holds the same crates in the same
// rooms. Kept separate from refresh_floor_mobs because an emptied container is world
// state a save must eventually keep, while a monster is not ([container.h]).
std::uint32_t refresh_floor_containers(Registry& reg, const World& world,
                                      int floorNumber, LayerId layer) {
    // Clear whatever the previous occupant of this layer slot left behind.
    std::vector<Entity> old_;
    for (auto e : reg.view<const game::Container, const Transform>())
        if (reg.get<const Transform>(e).layer == layer) old_.push_back(e);
    for (Entity e : old_) reg.destroy(e);

    return game::spawn_floor_containers(
        reg, world, floorNumber, kind_for_floor(floorNumber), layer,
        /*seed=*/0xC0FFEEu ^ static_cast<std::uint32_t>(floorNumber) * 0x9e3779b9u,
        /*cap=*/64);
}

std::uint32_t refresh_floor_mobs(Registry& reg, const World& world, int floorNumber,
                                 LayerId layer) {
    game::despawn_layer_mobs(reg, layer);
    const game::FloorKind kind = kind_for_floor(floorNumber);
    const game::FloorSpec& spec = game::floor_spec(kind);
    // `kind` twice, deliberately: the theme drives the head-count multiplier and
    // the kind drives the ROOM PITCH that packs are placed by. theme_for_kind is not
    // invertible, so the spawner cannot recover the second from the first.
    std::uint32_t count = game::spawn_floor_mobs(
        reg, world, floorNumber, game::danger_for_hostility(spec.hostility),
        game::theme_for_kind(kind), layer,
        /*seed=*/0xB0B5EEDu ^ static_cast<std::uint32_t>(floorNumber) * 0x9e3779b9u,
        kMobSpawnCap, kind);

    // Sync Armour components for all spawned mobs according to monster_traits
    for (auto e : reg.view<const game::MobRef, const Transform>()) {
        if (reg.get<const Transform>(e).layer == layer) {
            const game::MobRef& m = reg.get<const game::MobRef>(e);
            game::sync_monster_armour(reg, e, m.kind);
        }
    }
    return count;
}

// СИДЕР пропов этажа — ТОЛЬКО ветка generate (S20.6 закон 2: restore НЕ
// сеет; на restore пропы приходят из записей снимка). Клир слота и световой
// хвост живут отдельно (floor_light_rebuild) — их платят ОБЕ ветки.
std::uint32_t seed_floor_props(Registry& reg, const World& world,
                               int floorNumber, LayerId layer,
                               unsigned padicSeed, game::EventBus& bus) {
    const std::uint32_t wallSeed =
        1337u ^ (static_cast<std::uint32_t>(floorNumber) * 0x9e3779b9u);
    std::uint32_t count = game::seed_wall_interactables(reg, world, layer, wallSeed);
    std::fprintf(stderr, "[props] wall devices seeded: %u\n", count);
    if (std::getenv("GIGA_ANTOURAGE_DEBUG") != nullptr) {
        int shown = 0;
        for (auto e : reg.view<const game::Interactable, const Transform>()) {
            if (reg.get<const game::Interactable>(e).kind !=
                game::InteractKind::ElectricalShield)
                continue;
            const vec3& p = reg.get<const Transform>(e).pos;
            std::fprintf(stderr, "[props] shield at (%.1f %.1f %.1f)\n", p.x,
                         p.y, p.z);
            if (++shown == 4) break;
        }
    }

    // Ceiling BareBulb/FloodLamp cosmetics are still PropPlacer-driven, but
    // LightBulb Interactables live in ECS so lighting/HUD never read propPass
    // ([jirnyak.md] §18 — last get_prop_positions sim path).
    count += game::seed_ceiling_lights(reg, world, layer, wallSeed);
    if (kind_for_floor(floorNumber) == game::FloorKind::Padic)
        count += game::seed_padic_props(reg, world, layer, floorNumber, padicSeed, bus);
    if (kind_for_floor(floorNumber) == game::FloorKind::Khrushi)
        count += game::seed_khrushi_props(reg, world, layer, floorNumber, padicSeed, bus);
    // Общий мебельный сидер УМЕР (rooms-object F + S10: политика расстановки
    // в общем коде — дефект). Мебель ставит МОДУЛЬ по своим комнатам, как
    // свет и антураж; глагольный вектор пропа делает её видимой выбору цели.
    return count;
}

// СВЕТОВОЙ ХВОСТ постройки этажа — обе ветки развилки, ПОСЛЕ того как пропы
// существуют (сидер или записи снимка): эмиттеры материалов, кластеры,
// статик-таблица ламп. PropLight.slot не персистится — перештамповка здесь
// и есть его законная идентичность на генерацию.
void floor_light_rebuild(Registry& reg, const World& world, int floorNumber,
                         LayerId layer) {
    // Светоматериалы → статические эмиттеры ([game/light_bake.h]): полный
    // скан поля + кластеризация при каждой постройке этажа, той же геометрии,
    // что и всё. Единственное место полного скана — дальше поле только
    // латается; идентичность компонент начинается с нуля вместе с таблицей.
    game::rebuild_emitter_field(world, g_emitterField);
    g_emitterClusters = {};
    g_bakedFloorLights =
        game::bake_material_lights(world, g_emitterField, g_emitterClusters);
    if (!g_bakedFloorLights.empty())
        std::fprintf(stderr, "[light-bake] floor %d: %zu emitter clusters\n",
                     floorNumber, g_bakedFloorLights.size());

    // Статик-таблица света — из только что расставленных пропов и кластеров;
    // begin_floor_nav (следом за нами у всех вызывающих) отдаст её бейку
    // видимости ДО start_fresh.
    rebuild_static_light_table(reg, layer, /*reset=*/true);
}



// Upload StaticPropTag + PropMesh entities into PropPass after PropPlacer fills
// non-interactable cosmetics. Interactable shapes (Terminal, ElectricalShield,
// BareBulb, FloodLamp) are ECS-owned — PropPlacer only reserves their slots.
// [jirnyak.md] §18 PropPass passive skin.
// One rebuild = the whole scene list: ECS props PLUS the floor's baked
// antourage ([game/antourage]). Clears first — add_instance appends, and with
// real shapes in the catalog a second merge would double every mesh.
// Pack the game-side wire chains into the render pass's POD format (render
// never includes game/, so the translation lives here in the app).
static void upload_wires(gpu::VerletPass& verletPass,
                         const game::AntourageBake* ab) {
    if (!verletPass.ready()) return;
    static std::vector<gpu::GpuWireChain> packed;
    packed.clear();
    if (ab != nullptr) {
        for (const game::WireChain& c : ab->wires) {
            gpu::GpuWireChain g{};
            g.meta = vec4{c.restLen, 1.0f, c.massKg, 0.0f};
            for (int i = 0; i < gpu::kWireChainPoints; ++i) {
                const bool pinned = (c.pinMask >> i) & 1u;
                g.cur[i] = vec4{c.p[i].x, c.p[i].y, c.p[i].z,
                                pinned ? 0.0f : 1.0f};
                g.prev[i] = vec4{c.p[i].x, c.p[i].y, c.p[i].z, 0.0f};
            }
            packed.push_back(g);
        }
    }
    verletPass.upload_wires(packed.data(),
                            static_cast<std::uint32_t>(packed.size()));
    if (std::getenv("GIGA_WIRE_DBG") != nullptr)
        for (std::size_t i = 0; i < packed.size() && i < 20; ++i)
            std::fprintf(stderr, "[wire] %zu mid (%.1f %.1f %.1f)\n", i,
                         packed[i].cur[4].x, packed[i].cur[4].y,
                         packed[i].cur[4].z);
}

// Pack the game-side cloth sheets into the render pass's POD format — the
// third primitive's twin of upload_wires (render never includes game/).
static void upload_cloths(gpu::VerletPass& verletPass,
                          const game::AntourageBake* ab) {
    if (!verletPass.ready()) return;
    static std::vector<gpu::GpuClothSheet> packed;
    packed.clear();
    static_assert(gpu::kClothGridPoints == game::kClothPoints,
                  "grid shape is the CPU/GPU lockstep");
    if (ab != nullptr) {
        for (const game::ClothSheet& s : ab->cloths) {
            gpu::GpuClothSheet g{};
            g.meta = vec4{s.restX, 1.0f, s.restY, 0.0f};
            for (int i = 0; i < gpu::kClothGridPoints; ++i) {
                const bool pinned = (s.pinMask >> i) & 1u;
                g.cur[i] = vec4{s.p[i].x, s.p[i].y, s.p[i].z,
                                pinned ? 0.0f : 1.0f};
                g.prev[i] = vec4{s.p[i].x, s.p[i].y, s.p[i].z, 0.0f};
            }
            packed.push_back(g);
        }
    }
    verletPass.upload_cloths(packed.data(),
                             static_cast<std::uint32_t>(packed.size()));
    if (std::getenv("GIGA_WIRE_DBG") != nullptr)
        for (std::size_t i = 0; i < packed.size() && i < 20; ++i)
            std::fprintf(stderr, "[cloth] %zu top (%.1f %.1f %.1f)\n", i,
                         packed[i].cur[3].x, packed[i].cur[3].y,
                         packed[i].cur[3].z);
}

// --- unified particle pool: the app-side packing seam -----------------------
// Render never includes game/ ([ARCHITECTURE.md]), so bursts proposed in game/
// ([game/particles.h]) become GpuParticle records HERE: the material tint is
// resolved against the generated kMaterial albedo, and velocities/lifetimes
// jitter deterministically off the burst seed (xorshift — no global RNG).
namespace {

struct ParticleRng {
    std::uint32_t s;
    // [-1, 1)
    float next() {
        s ^= s << 13;
        s ^= s >> 17;
        s ^= s << 5;
        return static_cast<float>(static_cast<std::int32_t>(s)) *
               (1.0f / 2147483648.0f);
    }
};

void pack_particles(std::vector<gpu::GpuParticle>& out, const vec3& pos,
                    const vec3& dir, const game::ParticleDef& def,
                    const vec3& tint, std::uint8_t count, std::uint32_t seed) {
    ParticleRng rng{seed * 0x9e3779b9u + 1u};
    for (std::uint8_t k = 0; k < count; ++k) {
        gpu::GpuParticle p{};
        const float life = def.lifeS * (0.7f + 0.3f * (rng.next() * 0.5f + 0.5f));
        p.posLife = vec4{pos.x + rng.next() * 0.12f, pos.y + rng.next() * 0.12f,
                         pos.z + rng.next() * 0.12f, life};
        p.velTotal = vec4{(dir.x + rng.next() * 0.6f) * def.speedMps,
                          (dir.y + rng.next() * 0.6f) * def.speedMps,
                          (dir.z + rng.next() * 0.6f) * def.speedMps, life};
        p.colorSize = vec4{tint.x, tint.y, tint.z, def.sizeM};
        p.phys = vec4{def.gravityMul, def.drag, def.bounce,
                      static_cast<float>(def.emissive)};
        out.push_back(p);
    }
}

void drain_particle_bursts(gpu::VerletPass& pass,
                           game::ParticleBurstQueue& q) {
    if (!pass.ready() || q.count == 0) {
        q.clear();
        return;
    }
    static std::vector<gpu::GpuParticle> tmp;
    tmp.clear();
    for (std::uint16_t i = 0; i < q.count; ++i) {
        const game::ParticleBurst& b = q.items[i];
        const game::ParticleDef& def = game::kParticleTable[b.kind];
        const vec3 tint = def.colorFromMaterial
                              ? kMaterial[b.matId < kMatCount ? b.matId : 0]
                              : vec3{def.r, def.g, def.b};
        if (b.kind == static_cast<std::uint8_t>(game::ParticleKind::Shard)) {
            // Черепки — свой банк пула: спавн-POD тот же, разворот в пары
            // делает пасс (ось/кувырок из сида — bit-identical).
            static std::vector<gpu::GpuParticle> shardTmp;
            shardTmp.clear();
            pack_particles(shardTmp, b.pos, b.dir, def, tint, b.count,
                           b.seed);
            pass.spawn_shards(shardTmp.data(),
                              static_cast<std::uint32_t>(shardTmp.size()),
                              b.seed);
            continue;
        }
        pack_particles(tmp, b.pos, b.dir, def, tint, b.count, b.seed);
    }
    pass.spawn_particles(tmp.data(), static_cast<std::uint32_t>(tmp.size()));
    q.clear();
}

// Carve → dust + debris: CarveResult already names every removed sub-voxel
// WITH its material ([world/destruct.h] CarvedVoxel), so the puff is tinted by
// the very wall it came from. Sampled with a stride — a blast stays a cloud,
// not tens of thousands of sprites.
void spawn_carve_particles(gpu::VerletPass& pass, const CarveResult& res,
                           std::uint32_t seed) {
    if (!pass.ready()) return;
    static std::vector<gpu::GpuParticle> tmp;
    tmp.clear();
    const auto voxel_pos = [](const CarvedVoxel& v) {
        const int cx = static_cast<int>(v.cell) & 127;
        const int cy = (static_cast<int>(v.cell) >> 7) & 127;
        const int cz = (static_cast<int>(v.cell) >> 14) & 127;
        const int sx = v.bit & 7, sy = (v.bit >> 3) & 7, sz = v.bit >> 6;
        return vec3{(static_cast<float>(cx * 8 + sx) + 0.5f) * kVoxelSize,
                    (static_cast<float>(cy * 8 + sy) + 0.5f) * kVoxelSize,
                    (static_cast<float>(cz * 8 + sz) + 0.5f) * kVoxelSize};
    };
    const game::ParticleDef& dust =
        game::particle_def(game::ParticleKind::Dust);
    const std::size_t nd = res.destroyed.size();
    const std::size_t sd = nd > 48 ? nd / 48 : 1;
    for (std::size_t i = 0; i < nd; i += sd) {
        const CarvedVoxel& v = res.destroyed[i];
        const vec3 tint = kMaterial[v.mat < kMatCount ? v.mat : 0];
        pack_particles(tmp, voxel_pos(v), vec3{0.0f, 0.0f, 0.35f}, dust, tint,
                       1, seed ^ static_cast<std::uint32_t>(i));
    }
    const game::ParticleDef& debris =
        game::particle_def(game::ParticleKind::Debris);
    const std::size_t nt = res.detached.size();
    const std::size_t st = nt > 24 ? nt / 24 : 1;
    for (std::size_t i = 0; i < nt; i += st) {
        const CarvedVoxel& v = res.detached[i];
        const vec3 tint = kMaterial[v.mat < kMatCount ? v.mat : 0];
        pack_particles(tmp, voxel_pos(v), vec3{0.0f, 0.0f, -0.2f}, debris,
                       tint, 1, seed ^ 0x5bd1e995u ^
                                    static_cast<std::uint32_t>(i));
    }
    pass.spawn_particles(tmp.data(), static_cast<std::uint32_t>(tmp.size()));
}

} // namespace

// КЭШ СЛИТЫХ ИНСТАНСОВ (аудит 2026-08-25, К1-6): пока падают куски
// антуража, кадр раньше пересобирал ВЕСЬ список (ECS-вью по пропам + проба
// живости КАЖДОГО инстанса антуража об сетку) 8 секунд после любого
// выстрела — кандидат в хитчи. Сбор (дорогой) и эмиссия (дешёвая) разъяты:
// кэш строится только на реальную смену набора (propPassNeedsRebuild),
// падающие кадры платят memcpy кэша + свои несколько кусков.
static std::vector<std::pair<std::uint8_t, gpu::PropInstance>>
    g_propMergeCache;

static void emit_prop_instances(
    gpu::PropPass& propPass,
    const std::vector<game::DetachedPiece>* falling) {
    propPass.clear_instances();
    for (const auto& [shape, pi] : g_propMergeCache)
        propPass.add_instance(static_cast<gpu::PropShape>(shape), pi);
    // ОТРЕЗАННЫЕ куски в полёте ([antourage.h] DetachedPiece): те же шейпы,
    // трансформ — от падающего тела; живут в списке ровно пока летят —
    // рендеру не нужен второй путь и второй шейдер.
    if (falling != nullptr) {
        for (const game::DetachedPiece& d : *falling) {
            gpu::PropInstance pi{};
            pi.origin = d.pos;
            pi.yaw = d.yaw;
            pi.scale = d.scale;
            pi.matId = d.matId;
            pi.color = kMaterial[d.matId < kMatCount ? d.matId : 0];
            if (d.shape < static_cast<std::uint8_t>(gpu::kPropShapeCount))
                propPass.add_instance(static_cast<gpu::PropShape>(d.shape),
                                      pi);
        }
    }
}

static void merge_ecs_prop_meshes(const Registry& reg, LayerId layer,
                                  gpu::PropPass& propPass,
                                  const game::AntourageBake* ab,
                                  const World& world,
                                  std::vector<vec3>* dripEmitters = nullptr,
                                  const std::vector<game::DetachedPiece>* falling =
                                      nullptr) {
    g_propMergeCache.clear();
    auto cache_instance = [](std::uint8_t shape, const gpu::PropInstance& pi) {
        g_propMergeCache.emplace_back(shape, pi);
    };
    static std::vector<game::PropMeshInstance> insts;
    insts.clear();
    game::collect_static_prop_mesh_instances(reg, layer, insts);
    for (const auto& m : insts) {
        if (m.shape >= static_cast<std::uint8_t>(gpu::kPropShapeCount)) continue;
        gpu::PropInstance pi{};
        pi.origin    = m.origin;
        pi.yaw       = m.yaw;
        pi.color     = m.color;
        pi.scale     = m.scale;
        pi.matId     = m.matId;
        pi.emissive  = m.emissive;
        pi.flags     = m.flags;
        pi.animPhase = m.animPhase;
        cache_instance(m.shape, pi);
    }
    if (ab == nullptr) {
        emit_prop_instances(propPass, falling);
        return;
    }
    // UNIVERSAL antourage instances ([game/antourage/antourage.h]): the core
    // renders whatever a module emitted — shape + transform + material +
    // anchors — with zero knowledge of what it depicts. Aliveness reads the
    // LIVE grid: carve an anchor away and the piece stops being drawn.
    static const bool antourageDebug =
        std::getenv("GIGA_ANTOURAGE_DEBUG") != nullptr;
    if (dripEmitters) dripEmitters->clear();
    for (const game::AntourageInstance& it : ab->instances) {
        if (!game::antourage_alive(world, it)) {
            // A severed pipe piece: its anchor was carved away, so the mesh
            // stops drawing — and the stump becomes a DRIP emitter for the
            // unified particle pool (owner's design: якорь мёртв → эмиттер).
            if (dripEmitters && it.matId == kMatPipeMetal &&
                dripEmitters->size() < 96)
                dripEmitters->push_back(it.pos);
            continue;
        }
        gpu::PropInstance pi{};
        pi.origin = it.pos;
        pi.yaw = it.yaw;
        pi.scale = it.scale;
        pi.matId = it.matId;
        pi.emissive = antourageDebug ? 220 : it.emissive;
        const bool ownColor =
            it.color.x != 0.0f || it.color.y != 0.0f || it.color.z != 0.0f;
        pi.color = antourageDebug ? vec3{1.0f, 0.0f, 1.0f}
                   : ownColor     ? it.color
                                  : kMaterial[it.matId < kMatCount ? it.matId
                                                                   : 0];
        if (it.shape < static_cast<std::uint8_t>(gpu::kPropShapeCount))
            cache_instance(it.shape, pi);
    }

    emit_prop_instances(propPass, falling);
}

// Kick off this floor's navigation bake on a worker thread — the Fresh mode of
// the RebakeScheduler ([game/rebake.h]).
//
// This used to block: coarse ~1.9 s + fine ~1.8 s, measured, so every elevator ride
// froze the frame for ~3.7 s. The bake is not naive — it is already fanned across
// all 20 hardware threads by core/jobs.h — it is simply a lot of work (128 wrapped
// BFS over a 128^3 grid). performance.md declares load time unbounded, so the
// freeze was within contract and still the worst thing the player felt.
//
// Now the player moves, looks, fights and loots immediately; the floor's crowd
// stands still until the bake lands, because wander_step no-ops on an empty flow
// field. That degradation is automatic rather than special-cased.
//
// The worker owns oracle SNAPSHOTS by value (клиренс-поле нава 4 МиБ +
// телесный битсет комнат 256 КиБ), never a pointer into the live grid — so
// there is no ordering contract with door toggles or carves any more, and
// floor changes cancel-join in tens of ms ([game/rebake.h]).
void begin_floor_nav(const World& world, int floorNumber,
                     game::RebakeScheduler& bake) {
    // Поколение мутаций МОНОТОННО через всю сессию, на этаже НЕ сбрасывается
    // (бухгалтерия RebakeScheduler сверяет поколения между этажами).
    // Fresh-снапшот просто отражает текущее поколение.
    const game::FloorKind kind = kind_for_floor(floorNumber);
    // Кадр входа на этаж платит синхронный Fresh-бейк (свет 1144 мс по замеру
    // 2026-08-21, rooms ~23 мс) — детектор хитча обязан назвать его по имени.
    g_frameMark.floorEntry = true;
    // Статик-таблица света (испечена refresh_floor_props) — бейку видимости
    // ДО start_fresh: Fresh печёт свет синхронно из неё. Ёмкость клетки
    // приходит от рендера — game лейаут-агностичен ([game/light_vis_bake.h]).
    bake.set_light_table(g_staticLamps.data(), g_staticLamps.size(),
                         gpu::kGridCellSlots, g_staticTableGen);
    // Секция rooms умерла (rooms-object F): комнаты — раскраска roomAt из
    // rooms_declare, flow-полей по виду больше нет — на балансе −18 МиБ.
    bake.start_fresh(world.grid(), kind, floorNumber, g_worldGen);
    // Nav memory AT THE START of the bake, which is the number no document carried
    // and the only moment it can be wrong. The scheduler frees the live flow field
    // in start_fresh (the AsyncBake 260-MiB-peak lesson), so this reads ~1 MiB —
    // the four resident/snapshot bitsets.
    // The matching post-swap figure is on the `[nav]` line from finish_floor_nav.
    std::fprintf(stderr, "[nav] bake begins: nav holds %.1f MiB\n",
                 static_cast<double>(bake.resident_bytes()) / (1024.0 * 1024.0));
}

// Called once the bake has landed: hand the new floor's inhabitants somewhere to
// walk. Separate from begin_floor_nav because it can only run after the swap.
std::uint32_t finish_floor_nav(Registry& reg, LayerId layer, std::uint32_t seed,
                               const game::RebakeScheduler& bake) {
    std::uint32_t n = game::wander_init(reg, layer, seed);
    std::uint32_t aiCount = game::ai_init(reg, layer);
    std::fprintf(stderr,
                 "[nav] bake coarse %.0f ms | fine %.0f ms | resident %.1f MiB | "
                 "%u agents wandering | %u AI brains attached "
                 "(async, off the main thread)\n",
                 bake.last_coarse_ms(), bake.last_fine_ms(),
                 static_cast<double>(bake.resident_bytes()) / (1024.0 * 1024.0),
                 n, aiCount);
    return n;
}

// Wake up in someone else's body.
//
// There is no player singleton: the player IS whichever entity holds a CameraTag
// plus a Controller ([npcs.md], embody.h). So death is not a special case needing
// a save-game — it is losing those two components and gaining them somewhere else.
// This picks a living resident already embodied on the floor and hangs the camera
// on it. The building carries on; you are just someone new in it.
//
// Returns entt::null when the floor has nobody left to be, which is the honest
// end state and the caller must handle it.
Entity possess_a_survivor(Registry& reg, game::NpcPool& pool, LayerId layer) {
    // Choose first, mutate after: adding a component while a view is being
    // iterated can dangle that view if EnTT has to grow its pool container. The
    // pools involved here already exist, so this is insurance rather than a fix —
    // but it is the same rule combat.cpp had to learn the hard way.
    Entity chosen = entt::null;
    game::NpcId chosenId = game::kInvalidNpc;
    for (auto e : reg.view<const game::NpcRef, const Transform>()) {
        if (reg.get<const Transform>(e).layer != layer) continue;
        if (reg.all_of<CameraTag>(e)) continue;      // already the player
        const game::NpcId id = reg.get<const game::NpcRef>(e).id;
        if (!pool.valid(id) || !pool.alive(id)) continue;
        chosen = e;
        chosenId = id;
        break;
    }
    if (chosen == entt::null) return entt::null;

    CameraTag cam;
    cam.eyeOffset =
        vec3{0.0f, 0.0f, game::body_eye_height(pool.height_mm(chosenId))};
    reg.emplace<CameraTag>(chosen, cam);
    reg.emplace<Controller>(chosen, Controller{7.0f, {0, 0, 0}, false});
    pool.set_player(chosenId, true);
    std::fprintf(stderr, "[death] possessed record %u\n", chosenId);
    return chosen;
}

Entity possess_nearest_survivor(Registry& reg, game::NpcPool& pool, LayerId layer, const vec3& playerPos, float reachM) {
    Entity chosen = entt::null;
    game::NpcId chosenId = game::kInvalidNpc;
    float bestD2 = reachM * reachM;

    for (auto e : reg.view<const game::NpcRef, const Transform>()) {
        if (reg.get<const Transform>(e).layer != layer) continue;
        if (reg.all_of<CameraTag>(e)) continue;      // already the player
        const game::NpcId id = reg.get<const game::NpcRef>(e).id;
        if (!pool.valid(id) || !pool.alive(id)) continue;

        const vec3& pos = reg.get<const Transform>(e).pos;
        // wrap_dist2: все три оси (голый y = сосед в 2 м через шов невиден).
        float d2 = wrap_dist2(playerPos, pos, kWorldExtent);
        if (d2 < bestD2) {
            bestD2 = d2;
            chosen = e;
            chosenId = id;
        }
    }
    if (chosen == entt::null) return entt::null;

    // Detach camera & controller from current player body. Keep the old entity
    // handle so POSRPG can move person-progression onto the new body — the old
    // body stays alive in the world (unlike death / elevator fold_back).
    Entity oldPlayer = entt::null;
    for (auto e : reg.view<CameraTag, const game::NpcRef>()) {
        if (reg.get<const Transform>(e).layer != layer) continue;
        const game::NpcId oldId = reg.get<const game::NpcRef>(e).id;
        oldPlayer = e;
        reg.remove<CameraTag>(e);
        reg.remove<Controller>(e);
        pool.set_player(oldId, false);
        break;
    }

    CameraTag cam;
    cam.eyeOffset =
        vec3{0.0f, 0.0f, game::body_eye_height(pool.height_mm(chosenId))};
    reg.emplace<CameraTag>(chosen, cam);
    reg.emplace<Controller>(chosen, Controller{7.0f, {0, 0, 0}, false});
    pool.set_player(chosenId, true);
    // POSRPG: RpgStats + kill tally + cumulative shots/hits follow the mind.
    // Chambered mag stays on oldPlayer (physical). [combat.h]
    if (oldPlayer != entt::null)
        game::transfer_player_progression(reg, oldPlayer, chosen);
    std::fprintf(stderr, "[gameplay] Voluntarily possessed resident #%u\n", chosenId);
    return chosen;
}

} // namespace

int main(int argc, char** argv) {
    // ОТМЕТКА СБОРКИ — первой строкой всякого запуска. Вопрос «тот ли билд
    // я запустил» стоил владельцу целого круга тестирования 2026-08-28:
    // рядом с рабочим деревом лежит старый бинарь (gigahrush2_backup), и
    // отличить их в игре было нечем. Теперь любой лог сам себя датирует.
    std::fprintf(stderr, "[build] gigahrush2 собран %s %s\n", __DATE__,
                 __TIME__);
    // --shot FILE [--frames N] [--ride N]: render, capture, exit.
    //
    // Visual work has to be looked at, and grabbing the window through the compositor
    // proved unreliable — another window can come to the front between focusing the
    // game and copying the pixels, and then the "proof" is a screenshot of a browser.
    // This reads the presented swapchain image directly and quits, so the window is up
    // for a couple of seconds instead of indefinitely. [screenshot.h]
    const char* shotPath = nullptr;
    int shotFrames = 600;    // ~10 s at 60 Hz: long enough for the first nav bake
    int shotRide = 0;        // floors to descend before capturing
    // --floor N: ride straight to a labelled floor (up OR down — --ride only
    // descends, which made the padic floor at +4 unreachable in a --shot
    // proof). Uses the console teleport seam, so it exercises the real ride.
    int shotFloor = 0;
    bool shotFloorWanted = false;
    int shotFramesSeen = 0;
    int shotRideDone = 0;
    gpu::Capture shotCap{};
    bool hasCustomPos = false;
    vec3 customPos{89.0f, 71.0f, 2.9f};
    bool hasCustomAng = false;
    float customYaw = 0.8f, customPitch = -0.5f;
    bool shotOrbit = false;
    std::string shotAction;
    bool shotActionConsumed = false; // one-shot save/load; attack stays held
    // Дебаг-портянка по умолчанию СКРЫТА (плейтест владельца 2026-08-17):
    // игрок стартует с чистым худом ([hud_ui.h]); F1 / `hud` открывает её.
    bool showHud = false;
    // --no-crt: сырой кадр без пост-обработки (диагностика, пиксель-точные
    // сравнения скриншотов). Сама трубка — vk_renderer.h.
    bool noCrt = false;
    // --mirror-verify: after every wholesale upload and every ~300 frames, read
    // the GPU voxel mirror back and memcmp it against the CPU grid. Diagnostic
    // (queue-idles); the proof harness for the raymarch migration's stage 1.
    bool mirrorVerify = false;
    std::uint32_t mirrorFrame = 0;

    for (int i = 1; i < argc; ++i) {
        std::string a = argv[i];
        if (a == "--shot" && i + 1 < argc) shotPath = argv[++i];
        else if (a == "--frames" && i + 1 < argc) shotFrames = std::atoi(argv[++i]);
        else if (a == "--ride" && i + 1 < argc) shotRide = std::atoi(argv[++i]);
        else if (a == "--floor" && i + 1 < argc) {
            shotFloor = std::atoi(argv[++i]);
            shotFloorWanted = true;
        }
        else if (a == "--no-hud" || a == "--nohud") showHud = false;
        else if (a == "--no-crt" || a == "--nocrt") noCrt = true;
        else if (a == "--mirror-verify") mirrorVerify = true;
        else if (a == "--pos" && i + 3 < argc) {
            customPos.x = static_cast<float>(std::atof(argv[++i]));
            customPos.y = static_cast<float>(std::atof(argv[++i]));
            customPos.z = static_cast<float>(std::atof(argv[++i]));
            hasCustomPos = true;
        }
        else if (a == "--yaw" && i + 1 < argc) { customYaw = static_cast<float>(std::atof(argv[++i])); hasCustomAng = true; }
        else if (a == "--pitch" && i + 1 < argc) { customPitch = static_cast<float>(std::atof(argv[++i])); hasCustomAng = true; }
        else if (a == "--orbit") { shotOrbit = true; }
        else if (a == "--action" && i + 1 < argc) { shotAction = argv[++i]; }
    }

    // SAY WHICH BINARY THIS IS, every launch. An unoptimized tree is ~10x
    // slower on the sim (measured 2026-08-05: 62 ms/frame at -O0 against 5.9 ms
    // at -O3, same scene) — and it looks exactly like a performance regression
    // in whatever landed last, because nothing about the build says otherwise.
    // Cheap line, one whole debugging session saved. Rebuild with
    // `cmake -S . -B build -DCMAKE_BUILD_TYPE=Release`.
    std::fprintf(stderr, "[build] %s\n", kBuildKind);

    if (!SDL_Init(SDL_INIT_VIDEO | SDL_INIT_AUDIO)) {
        std::fprintf(stderr, "SDL_Init: %s\n", SDL_GetError());
        return 1;
    }

    SDL_Window* window = SDL_CreateWindow(
        "gigahrush2 — voxel core", kWinW, kWinH,
        SDL_WINDOW_VULKAN | SDL_WINDOW_RESIZABLE);
    if (!window) {
        std::fprintf(stderr, "SDL_CreateWindow: %s\n", SDL_GetError());
        SDL_Quit();
        return 1;
    }

    gpu::VulkanDevice device;
#ifdef NDEBUG
    const bool wantValidation = false;
#else
    const bool wantValidation = true;
#endif
    if (!device.init(window, wantValidation)) {
        std::fprintf(stderr, "Vulkan device init failed\n");
        SDL_DestroyWindow(window);
        SDL_Quit();
        return 1;
    }

    gpu::VulkanRenderer renderer;
    if (!renderer.init(device, window, GIGA_SHADER_DIR)) {
        std::fprintf(stderr, "Renderer init failed\n");
        device.destroy();
        SDL_DestroyWindow(window);
        SDL_Quit();
        return 1;
    }

    renderer.crtEnabled = !noCrt;

    gpu::GpuLightGrid lightGrid;
    if (!lightGrid.init(&device, GIGA_SHADER_DIR)) {
        std::fprintf(stderr, "[light-grid] pass init failed\n");
    }

    // GPU mirror of the active floor's voxel truth ([render/voxel_mirror.h]).
    // Инитится ДО cube/body-пассов: они несут его теневой сет (set 2,
    // [ddalight.md]) в своих pipeline layout'ах.
    gpu::VoxelMirror voxelMirror;
    if (!voxelMirror.init(device)) {
        std::fprintf(stderr, "Voxel mirror init failed\n");
        lightGrid.destroy();
        renderer.destroy();
        device.destroy();
        SDL_DestroyWindow(window);
        SDL_Quit();
        return 1;
    }

    gpu::MaterialTextures materialTex;
    if (!materialTex.init(device, lightGrid.descriptor_set_layout(),
                       voxelMirror.shadow_set_layout())) {
        std::fprintf(stderr, "Cube pass init failed\n");
        voxelMirror.destroy();
        lightGrid.destroy();
        renderer.destroy();
        device.destroy();
        SDL_DestroyWindow(window);
        SDL_Quit();
        return 1;
    }

    // The world renderer: a fullscreen two-level DDA over the mirror
    // ([render/raymarch_pass.h]). MaterialTextures is the texture-array
    // owner and the body/prop pipeline-layout donor until the mesher deletion
    // lands; its record() is no longer called, so invalidate() is free.
    gpu::RaymarchPass raymarchPass;
    if (!raymarchPass.init(device, renderer.renderPass, GIGA_SHADER_DIR,
                           voxelMirror, materialTex,
                           lightGrid.descriptor_set_layout())) {
        std::fprintf(stderr, "Raymarch pass init failed\n");
        voxelMirror.destroy();
        materialTex.destroy();
        lightGrid.destroy();
        renderer.destroy();
        device.destroy();
        SDL_DestroyWindow(window);
        SDL_Quit();
        return 1;
    }

    // Draws the population: one instanced, lit box per embodied entity, sharing
    // the world pass's render pass + depth so bodies and voxels occlude cleanly.
    gpu::BodyPass bodyPass;
    if (!bodyPass.init(device, renderer.renderPass, GIGA_SHADER_DIR, lightGrid.descriptor_set_layout(), voxelMirror.shadow_set_layout())) {
        std::fprintf(stderr, "Body pass init failed\n");
        raymarchPass.destroy();
        voxelMirror.destroy();
        materialTex.destroy();
        lightGrid.destroy();
        renderer.destroy();
        device.destroy();
        SDL_DestroyWindow(window);
        SDL_Quit();
        return 1;
    }

    // GPU-instanced arbitrary prop meshes (cylinders, arches, barrels, pipes).
    // Shares MaterialTextures' pipeline layout and cube.frag so props receive identical
    // PBR lighting, fog, and material shading as the voxel world.
    gpu::PropPass propPass;
    if (!propPass.init(&device, materialTex.pipeline_layout(),
                       renderer.renderPass, GIGA_SHADER_DIR)) {
        std::fprintf(stderr, "[prop] pass init failed (continuing without props)\n");
        // Non-fatal: the game runs fine without props.
    }

    gpu::GpuCullPass cullPass;
    if (!cullPass.init(&device, GIGA_SHADER_DIR)) {
        std::fprintf(stderr, "[cull] pass init failed (continuing without GPU culling)\n");
    }

    // GPU-verlet antourage: hanging wires AND cloth sheets, one pass, one
    // compute shader — a chain is a lattice at H=1 ([render/verlet_pass.h]).
    gpu::VerletPass verletPass;
    if (!verletPass.init(&device, renderer.renderPass, GIGA_SHADER_DIR,
                         voxelMirror.masks_buffer(), voxelMirror.types_buffer(),
                         lightGrid.descriptor_set_layout())) {
        std::fprintf(stderr,
                     "[verlet] pass init failed (continuing without antourage "
                     "verlet)\n");
    }

    // GPU-газ 4 захардкоженных каналов УМЕР (инкремент 4, CANON S16.6:
    // хардкод каналов газа запрещён — газ = строка таблицы): toxic_gas
    // теперь МАТЕРИЯ мира-автомата (засев вырезан 2026-08-25), HUD
    // читает агрегат клетки (S16.4). Химия горения потеряна осознанно
    // (решение владельца 2026-08-23).

    // МИР-АВТОМАТ (CANON S16): единственный двигатель материи — Margolus-
    // правило прямо в каноническом pagePool зеркала ([render/gpu_medium_pass.h]).
    // Такт — каждый 4-й сим-тик (решение владельца 2026-08-24): 125/4 =
    // 31.25 Гц, падение 0.25 м x 31.25 = 7.8 м/с; пауза и детерминизм
    // бесплатно — стоят сим-часы, стоит материя.
    gpu::GpuMediumPass mediumPass;
    if (!mediumPass.init(&device, GIGA_SHADER_DIR, voxelMirror)) {
        std::fprintf(stderr,
                     "[medium] pass init failed (continuing without automaton)\n");
    }
    std::uint64_t mediumSubstepsDone = 0;

    // Частицы живут ТРЕТЬИМ БАНКОМ пула VerletPass (слияние 2026-09-01):
    // отдельного пасса больше нет — кровь/пыль/искры/капли симулятся тем же
    // verlet_sim.comp и коллизят о то же зеркало.
    // Severed pipe stumps ([merge_ecs_prop_meshes]) — each drips on a slow
    // clock while its floor stays loaded. Refilled at every prop merge.
    std::vector<vec3> dripEmitters;
    // Antourage legs cut loose and still falling ([antourage.h] DetachedPiece).
    // Transient render/sim state, never persisted: a reloaded floor re-bakes its
    // dressing whole, so anything mid-air simply never happened.
    std::vector<game::DetachedPiece> antourageFalling;


    gpu::ImGuiLayer hud;
    if (!hud.init(device, window, renderer.postRenderPass,
                  static_cast<std::uint32_t>(renderer.swap().images.size()))) {
        std::fprintf(stderr, "ImGui init failed\n");
        bodyPass.destroy();
        raymarchPass.destroy();
        voxelMirror.destroy();
        materialTex.destroy();
        renderer.destroy();
        device.destroy();
        SDL_DestroyWindow(window);
        SDL_Quit();
        return 1;
    }

    // --- World + ECS setup -------------------------------------------------
    // Build the world population-first, then embody the player from it ([npcs.md]).
    LevelStack stack;
    // §22: lazy nav field rebake under frame budget after carves.
    Registry reg;
    // Navigation for the ONE live floor. Re-baked on every floor entry; ~128 MiB
    // for the flow fields, which is affordable precisely because streaming keeps
    // a single floor resident (performance.md).
    // Baked asynchronously; owns both the live graph the tick reads and the
    // pending one a worker fills — plus the two live walkability bitsets and
    // the background-rebake planner that keeps the bake current as the floor
    // is carved (game/rebake.h).
    game::RebakeScheduler nav;
    game::NpcPool pool;
    pool.init();
    // SLOT RECYCLING IS DELIBERATELY NOT ARMED HERE, and the line is left in place
    // rather than omitted so the gate travels with it. Armed, a dead slot returns to an
    // intrusive free list and a birth stops being a one-way draw on a finite reserve:
    // measured in suite_npcpool.inl, 101,000 births cost 1,000 slots armed against
    // 101,000 unarmed, and over 250 macro ticks against a 60-slot reserve the population
    // holds at 3002 with 0 births refused instead of decaying to 2336 with 1197 refused.
    //
    // ARMED. A recycled id is a REUSED id, so every place that holds a bare NpcId ACROSS
    // TIME had to become generation-checked first. All of them now are, and the count is
    // written out because "fix one and declare victory" is how this would have shipped
    // broken — I made that mistake twice and was corrected twice:
    //   DONE  MacroSim::Journey::id  — stamps the departing generation, compares on landing.
    //   DONE  Contract::giver        — an NpcHandle; contract_step polls handle_valid().
    //                                  Measured A/B: with a bare id the job paid 700 rub to
    //                                  a newborn who never offered it and read Complete;
    //                                  with the handle it pays 0 and Fails.
    //   DONE  QuestProgress::giver   — the identical defect, same fix, quest.cpp now polls
    //                                  handle_valid(p.giver).
    //   DONE  Relationship::target   — the generation went into the dead `pad` field, so
    //                                  rel_ (128 B/row, 128.0 MiB at capacity) gained
    //                                  nothing. social_edge_target() returns kInvalidNpc for
    //                                  a stale edge, so the line callers already wrote for
    //                                  empty slots makes staleness safe by construction.
    //   DONE  FloorModule::candidate — an NpcHandle in the same 32 bits (a 20-bit id leaves
    //                                  room for the 12-bit generation). A stale designate
    //                                  RE-DESIGNATES from the floor's live roster instead of
    //                                  handing the camera to whoever inherited the slot.
    //   DONE  NpcRef::id — шестое хранилище закрыто ПОКОЛЕНИЕМ (E-2
    //                      skeleton-anchor, 2026-08-29): NpcRef несёт gen слота
    //                      на момент воплощения, npc_ref_current — единственная
    //                      проверка, fold_back со стейл-ссылкой не пишет строку
    //                      наследника. Прежний аргумент «по графу вызовов»
    //                      (совместная смерть записи и тела в combat.cpp) был
    //                      хрупким по собственному признанию — третий вызывающий
    //                      pool.kill() больше ничего не инвалидирует.
    pool.set_recycling(true);
    //
    // The demo seeds ~1,930 records into 2^20, so the reserve is not the binding
    // constraint at this size — this matters at design scale, not in the test bed.
    // The macro society: the whole cold population — aging, old-age mortality,
    // births, bounded migration — advancing on its own coarse clock, decoupled from
    // the 125 Hz sim and from the render loop. This is the piece that makes the
    // world live whether or not anyone is looking at it. [macrosim.md]
    //
    // Declared beside the pool because both live the whole session. `init()` must
    // precede `set_floors_from`. The birth target latches on the FIRST `step()` and
    // deliberately not here: main seeds the world between this line and the first
    // macro tick, so latching now would read a living count of 0 and no birth would
    // ever happen.
    game::MacroSim macroSim;
    game::MacroParams macroParams;  // targetPopulation 0 -> hold the seeded size
    game::MacroStats macroStats{};  // last macro tick's tallies, for the HUD
    macroSim.init();
    // Who hates whom — and it MOVES. `relations_drain_deaths` bends this matrix by
    // who killed whom, so ten dead citizens push the Citizens row across the
    // hostility boundary and `faction_feud_step` turns the building's crowd on you.
    // Until this line `kBaseFactionMatrix` had no caller anywhere in src/, which
    // made six faction functions dead code. [faction_relations.h]
    game::FactionRelations factionRel = game::kBaseFactionMatrix;
    game::RelationTick relTick{};   // last drain's tallies, for the HUD
    std::uint32_t feudHits = 0;     // running total of NPC-vs-NPC hits that landed
    // Transient event ring ([events.md]). Combat publishes deaths into it; it is
    // cleared once per frame, so a listener must consume within the frame or use
    // the opt-in log.
    game::EventBus bus;
    bus.init();
    // Recent noises, fading ([noise.h]). A sibling of the bus, not a part of it: the
    // bus is "this happened" and is wiped every tick, this is "this happened HERE and
    // is still fading". No init() — it is a 2 KB POD with no allocation anywhere.
    game::NoiseField noiseField;
    // Акустика на скелете (G, S20.1): шары путевых дистанций живых шумов —
    // ~7.5 МБ, на куче. Бейкается одним шагом перед потребителями слуха.
    auto noiseAcoustics = std::make_unique<game::NoiseAcoustics>();
    game::FloorRegistry registry;

    // Streaming keeps only the ACTIVE floor's World + crowd live; every other
    // floor folds into the cold pool (floor_stream.h, master_prompt #9). This is
    // what makes a deep 2^20-person building affordable: the sim tick is O(live
    // entities), so exactly one floor's worth is ever simulated.
    game::FloorStreamer streamer;

    int currentFloor = 0;                         // in-game label of the live floor
    const game::FloorSpec* currentSpec = nullptr; // its rule-set (HUD only)

        game::Doors doors;              // НОВАЯ дверь: ГДЕ и ЧЕМ; состояний нет
    std::vector<std::uint32_t> doorDirty; // клетки тогглов — дренаж швом карва
    // Комнаты этажа: объявляет модуль (S12.1), перештамповка на каждом входе
    // (rooms_declare). Живут в reg.ctx() (прецедент AnchorBins), чтобы живые
    // хуки supply на швах предметов/пропов не тащили их через сигнатуры.
    game::FloorRooms& floorRooms = reg.ctx().emplace<game::FloorRooms>();
    game::Focus g_focus;            // цель под прицелом этого кадра ([focus.h])
        // 5c: обвес лифтовых порталов — game::dress_lift_portals
    // ([game/door.h]): кнопка снаружи (DoorRef на створку хаба — активация
    // ссылкой S18), панель в кабине, дефолт «закрыто». Перенесён в
    // game-слой, чтобы быть headless-тестируемым (suite_doors).
    auto dress_lift_portals = [&](LayerId nl) {
        const game::FloorSpec* sp = spec_for_floor(currentFloor);
        if (sp == nullptr) return;
        game::dress_lift_portals(reg, stack.layer(nl), doors, currentFloor,
                                 *sp,
                                 streamer.floor_seed_of(registry, currentFloor),
                                 nl, doorDirty);
    };
    bool doorWanted = false;        // E (единая интеракция), consumed once
    bool interactWanted = false;    // E, consumed by one sim step (Terminal / ControlPanel / Relief interact)
    bool possessWanted = false;     // P, consumed by one sim step (Voluntary Mind Projection / Body Swap)
    bool throwWanted = false;       // Z, consumed by one sim step (player_throw_step)
    char elevDiagLine[160] = {};
    std::uint64_t elevDiagAt = 0;
    game::PowerGridState powerGrid{};
    // Ключ модуля этажа (S20.6 закон 4) — kind И сид И версия генерации; им
    // подписывается каждый floor-файл и им же он спрашивается на restore.
    auto module_key_for = [&](int floorNo) {
        const game::FloorKind k = kind_for_floor(floorNo);
        return game::FloorModuleKey{
            static_cast<std::uint8_t>(k),
            streamer.floor_seed_of(registry, floorNo),
            game::module_gen_version(k)};
    };
    // СУЩНОСТНАЯ ПОЛОВИНА прибытия — РАЗВИЛКА (S20.6 закон 2: restore НЕ
    // сеет). Обе ветки: клир слота + обесточка с нуля (ключи PowerGridState
    // бесэтажны — саботаж щитка на этаже 0 гасил те же клетки на всех этажах;
    // чистка каждым прибытием убивает межэтажный дефект по построению).
    // generate: сидеры ящиков и пропов — ПОСЛЕ клира (прежний порядок сеял
    // ящики до clear_layer_props, и клир убивал их той же активацией — этаж
    // прибытия жил без единого ящика с посадки «ящик-проп» 2026-08-21).
    // restore: сущности из снимка + якорная проба (закон 3), сидеры молчат.
    // Возвращает «этаж восстановлен» — обвес лифта (dress) сеют только на
    // generate, состояние створок на restore несёт сама материя снимка.
    auto floor_entity_half = [&](LayerId nl, int floorNo) -> bool {
        game::FloorEntityState ents;
        const bool restored = take_pending_restore(floorNo, ents);
        powerGrid = game::PowerGridState{};
        game::clear_layer_props(reg, nl);
        if (restored) {
            const std::size_t np = game::spawn_prop_records(
                reg, stack.layer(nl), nl, ents.props.data(),
                ents.props.size(), bus);
            game::spawn_corpse_records(reg, nl, floorNo, ents.corpses.data(),
                                       ents.corpses.size());
            game::spawn_pickup_records(reg, nl, ents.pickups.data(),
                                       ents.pickups.size());
            game::spawn_debris_records(reg, nl, floorNo, ents.debris.data(),
                                       ents.debris.size());
            game::restore_power_keys(powerGrid, ents.powerKeys.data(),
                                     ents.powerKeys.size());
            std::fprintf(stderr,
                         "[persist] floor %d entities RESTORED: %zu props, "
                         "%zu corpses, %zu pickups, %zu debris, %zu power "
                         "keys\n",
                         floorNo, np, ents.corpses.size(),
                         ents.pickups.size(), ents.debris.size(),
                         ents.powerKeys.size());
        } else {
            refresh_floor_containers(reg, stack.layer(nl), floorNo, nl);
            seed_floor_props(reg, stack.layer(nl), floorNo, nl,
                             streamer.floor_seed_of(registry, floorNo), bus);
        }
        floor_light_rebuild(reg, stack.layer(nl), floorNo, nl);
        return restored;
    };
    // Флаг «текущее прибытие — restore»: пишет floor_entity_half на каждом
    // прибытии, читает шаг дверей (dress только на generate).
    bool arrivedRestored = false;
    // Doors derive from THE FLOOR'S OWN SEED — streamer.floor_seed_of(), the same
    // value its geometry was generated from. There used to be a separate
    // kDoorSeed constant here, and it was a bug factory, not a knob: door_build
    // asks the grid whether each doorway is still an architectural opening, and
    // with the doorway list derived from a DIFFERENT seed than the walls, the
    // padic floor kept only the ~5% of doors that matched by coincidence
    // (measured: 1302 of ~26k). One floor, one seed, every consumer.

    Entity player = entt::null;

    {
        // Register every floor MODULE (number -> module + build recipe), then
        // load ONLY floor 0. The rest stay cold until the elevator enters them,
        // and leaving a floor folds its crowd back — re-entry re-embodies the same
        // records, so the population never grows per visit.
        streamer.init(stack, /*keepRadius=*/0);
        // The registered building = the catalog's EXPLICIT CLAIMS: the demo rows
        // plus every module folder's own number (padic's 4 arrives here without
        // this file naming it). Pattern floors stay unregistered defaults until
        // something claims or streams them.
        for (int f = game::kMinFloor; f <= game::kMaxFloor; ++f) {
            const game::FloorDef* def = floor_catalog().claimed(f);
            if (!def) continue;
            // Vary the seed per floor so same-kind floors still differ.
            std::uint32_t fseed =
                1337u ^ (static_cast<std::uint32_t>(f) * 0x9e3779b9u);
            streamer.add_module(registry, f, def->kind, fseed);
        }
        // Migration destinations are the REGISTERED floor set, never a [lo,hi] band.
        // This stack is legitimately sparse — {0,1,2,-8,-14,-26,-36,-50,14,30} — so a
        // uniform draw over [-50,30] would send 71 of every 81 travellers to a floor
        // that does not exist. Must run after the add_module loop above (the registry
        // is the authoritative live set) and before the first `step()`. Re-call after
        // any renumber. [macro_sim.h]
        macroSim.set_floors_from(registry);
        // POPULATE THE WHOLE BUILDING, not just the floor about to be loaded.
        //
        // Measured before this line existed: a fresh run held 420 records — one floor's
        // worth — because `ensure_loaded` seeds a module's crowd on its FIRST LOAD, so
        // the population only came into existence where the player had already been.
        // That made every macro counter structurally zero rather than merely quiet:
        // migration and the social sweep both skip `pool.embodied` ([macro_sim.h] works
        // on COLD records only), and with a single loaded floor every existing record was
        // embodied, so there were no eligible candidates at all.
        //
        // Seeding here gives the other nine floors a cold population that ages, dies,
        // gives birth and migrates before anyone has ever visited them — which is the
        // difference between a world that lives when unobserved and one that only exists
        // where the camera has been. Costs ~4,200 records against a 2^20 pool and touches
        // no layer, no geometry and no ECS entity.
        // A visited floor IS its snapshot: hand the streamer the way to get one
        // back, and it restores immediately after generating — before the pipes
        // are routed and the lamps are hung, so nothing is ever anchored to
        // geometry that is about to change under it. [problems.md] §42
        streamer.set_floor_restore([&streamer, &registry](World& w,
                                                          int floorNumber) {
            // Ключ строится здесь, а не module_key_for: хук бежит и в
            // prebuild-воркере, капчер минимален и только-чтение.
            const game::FloorKind k = kind_for_floor(floorNumber);
            const game::FloorModuleKey key{
                static_cast<std::uint8_t>(k),
                streamer.floor_seed_of(registry, floorNumber),
                game::module_gen_version(k)};
            return apply_floor_file(w, floorNumber, key);
        });

        const std::uint32_t seeded = streamer.seed_all_modules(pool);
        std::fprintf(stderr, "[pop] seeded %u cold records across %u registered floors\n",
                     seeded, macroSim.floor_count());

        game::NpcId playerId = game::kInvalidNpc;
        game::LoadResult start =
            streamer.ensure_loaded(stack, registry, reg, pool, 0, playerId);
        player = start.player;
        currentFloor = 0;
        currentSpec = spec_for_floor(0);
        if (player != entt::null) {
            aim_player(reg, player);
            if (hasCustomPos) reg.get<Transform>(player).pos = customPos;
            if (hasCustomAng) {
                auto& cam = reg.get<CameraTag>(player);
                cam.yaw = customYaw;
                cam.pitch = customPitch;
            }
            LayerId l0 = reg.get<Transform>(player).layer;
            // Комнаты РАНЬШЕ сидеров: спавн паков селится в объявленных
            // комнатах (mob_spawn читает их из reg.ctx), двери — по тегу.
            game::rooms_declare(floorRooms, currentFloor,
                                *spec_for_floor(currentFloor),
                                streamer.floor_seed_of(registry, currentFloor));
            refresh_floor_mobs(reg, stack.layer(l0), 0, l0);
            // Развилка сущностей (S20.6): сидеры ИЛИ записи снимка.
            arrivedRestored = floor_entity_half(l0, 0);
            // Doors BEFORE the bake: door_build leaves every door open, so the
            // walkability bitsets built at the top of begin_floor_nav carry the
            // all-open geometry (an upper bound on connectivity) the bake must
            // assume. No freeze: the worker owns a snapshot, never the grid,
            // so doors may move mid-bake. [door.h, game/rebake.h]
            game::rooms_supply_rebuild(floorRooms, reg, l0);
            game::door_declare(doors, floorRooms, currentFloor,
                           *spec_for_floor(currentFloor),
                           streamer.floor_seed_of(registry, currentFloor));
            if (!arrivedRestored) dress_lift_portals(l0);
            begin_floor_nav(stack.layer(l0), 0, nav);
            game::ai_init(reg, l0);
            if (propPass.ready()) {
                merge_ecs_prop_meshes(reg, l0, propPass,
                                      streamer.antourage_at_layer(registry, l0),
                                      stack.layer(l0), &dripEmitters);
                upload_wires(verletPass, streamer.antourage_at_layer(registry, l0));
                upload_cloths(verletPass, streamer.antourage_at_layer(registry, l0));
            }
        }
    }

    if (player == entt::null) {
        std::fprintf(stderr, "population seeding failed to embody a player\n");
        hud.destroy();
        bodyPass.destroy();
        raymarchPass.destroy();
        voxelMirror.destroy();
        materialTex.destroy();
        renderer.destroy();
        device.destroy();
        SDL_DestroyWindow(window);
        SDL_Quit();
        return 1;
    }

    // The mirror's first full snapshot: whichever mode built the initial world,
    // its geometry (doors included) is final by here. Arrival sites re-upload;
    // carve and doors stream dirty cells from their existing seams.
    {
        World& w0 = stack.layer(reg.get<Transform>(player).layer);
        voxelMirror.upload_all(w0);
        if (mirrorVerify) voxelMirror.verify(w0);
    }

    InputState input;
    // Start with mouse-look on so the camera rotates immediately. Tab toggles
    // it (freeing the cursor for the HUD); holding the right mouse button also
    // engages look while held.
    input.set_mouselook(true);
    SDL_SetWindowRelativeMouseMode(window, true);

    bool running = true;
    float simAccum = 0.0f;
    // Monotonic sim-time (seconds), advanced one kSimDt per fixed step. The AI
    // re-plan stagger ([ai.md] #12c) schedules each agent's next decision
    // against an absolute deadline on this clock; frozen with the sim while
    // paused. ЖИВАЯ: ai_step давно распаркован и читает её шестым аргументом
    // — прежняя пометка «[[maybe_unused]]… PARKED» пережила эпоху и звала
    // аудитора удалить живой узел (К1-15, аудит 2026-08-25).
    double simNow = 0.0;
    std::uint64_t prevTicks = SDL_GetPerformanceCounter();
    const double freq = static_cast<double>(SDL_GetPerformanceFrequency());

    // CPU time spent inside each pass's record(), reported in the HUD. The HUD is
    // built before the passes run, so these carry last frame's figures — which is
    // what you want anyway when reading a steady-state number. This exists so
    // "the renderer is slow" is a measurement and not a guess: it separates the
    // CPU instance-build cost from GPU fill/present cost, which need opposite
    // fixes.
    float cubeMs = 0.0f;
    float bodyMs = 0.0f;

    // Sim tick index. Drives the wander stagger, which spreads the crowd's
    // steering across kWanderPeriod ticks with no per-agent scheduling state.
    std::uint64_t simTick = 0;
    std::uint32_t meleeHits = 0;   // cumulative, for the HUD
    // Mobs steered by SOUND on the last sim tick ([investigate.h]). Not cumulative: the
    // point of the readout is "is anything investigating right now", and a running
    // total would answer a different question badly.
    std::uint32_t heardMobs = 0;
    // The samosbor clock. One per live floor; the demo keeps one floor live, so one
    // clock, re-armed on arrival ([samosbor.h]).
    game::SamosborRng sbRng{0x5A303B0Du};
    game::SamosborState samosbor = game::samosbor_new_game(sbRng);
    std::uint32_t samosborCycles = 0;
    std::int16_t samosborDamage = 0;
    // The last thing overheard, and when. Held rather than recomputed per frame
    // because a rumour is something you were TOLD — it should stay on screen after you
    // walk away, not vanish the moment the speaker is out of range.
    // The job on offer from whoever is nearest, and the book of taken ones.
    // The whole run in ONE struct, because that is exactly what gets written to disk.
    // `contracts` and `ledger` below are REFERENCES into it, not copies: every one of
    // the ~30 existing use sites keeps working untouched, and there is no "which copy is
    // authoritative at save time" question — the answer that bug always gives is "the
    // stale one". A load is then `runState = in;` and both references see it. [save.h]
    game::SaveState runState;
    game::ContractBook& contracts = runState.book;
    game::Contract offer{};
    char offerLine[200] = {};
    // Quest offer from the same proximity sweep that feeds contract_offer. One
    // body can carry both a procedural contract AND an authored quest, and both
    // are displayed side-by-side — E takes whichever is pending. Contract is
    // preferred when both land simultaneously (walk-in economy vs authored story);
    // in practice the 8% quest share keeps collisions rare. [quest.h]
    game::QuestId questOffer = game::kInvalidQuest;
    game::NpcId questOfferGiver = game::kInvalidNpc;
    char questOfferLine[320] = {};
    char rumourLine[160] = {};
    std::uint64_t rumourAt = 0;
    // The murmur, next to the rumour and deliberately separate from it: a rumour is a
    // FACT the player can go and check, speech is what the nearest body sounds like.
    // Different clock, different colour, no shared state. rumour.h states its own rule in
    // capitals — a rumour must be TRUE and CHECKABLE — which a bark is not, and that is
    // why this is a sibling rather than an extension. [speech.h]
    //
    // A const char*, not a char buffer: kSpeechText holds static-duration literals, so
    // there is nothing to copy and nothing to truncate.
    const char* speechLine = nullptr;
    game::SpeechSituation speechSit = game::SpeechSituation::Ambient;
    game::SpeechMemory speechMem;
    std::uint64_t speechAt = 0;
    game::NeedsTick needs{};   // last step's report, for the HUD
    // Last encumbrance report. Read by THREE consumers a frame apart — the
    // Controller's speed chain, the footstep noise radius and the HUD — which is
    // why the sweep reports instead of writing: one producer, three readers, no
    // second writer of anyone's movement.
    game::EncumbranceTick encumbrance{};
    int needsHpLost = 0;       // running total, so the HUD is not one tick
    game::RunLedger& ledger = runState.ledger;
    // v16: счёт живёт в ран-стейте, как леджер — F5/F9 больше не забывают
    // вклад и долг ([economy.h], [save.h] SAVBANK).
    game::BankAccount& bankAcct = runState.bank;
    // F5 saves, F9 loads. Recorded as intent and acted on in the sim loop, the same
    // shape sellWanted/buyWanted use: a load rewrites world state and belongs on the
    // sim's clock, not the window's.
    bool saveWanted = false;
    bool loadWanted = false;
    // THE MAIN MENU — a separate app SCREEN, not a pause overlay. The world
    // behind it is built but frozen; the run starts (or a slot loads) only when
    // a menu row says so, which is also what makes a full v6 world restore
    // safe: it happens before the player has touched anything. --shot captures
    // skip the menu and start Playing directly, so a stray save directory can
    // never alter a deterministic capture.
    // ЕДИНЫЙ источник истины экрана/окна/страницы меню ([ui_shell.h]).
    // --shot прыгает сразу в Playing: харнесс снимает игру, не заставку.
    UiShell shell;
    shell.screen = shotPath ? AppScreen::Playing : AppScreen::Intro;
    IntroFx introFx;  // пиксельная сборка TENEVIK GAMES -> титул [intro_ui.h]
    if (shell.sim_frozen()) {
        input.set_mouselook(false);
        SDL_SetWindowRelativeMouseMode(window, false);
    }
    auto menu_start_playing = [&]() {
        shell.screen = AppScreen::Playing;
        shell.menuPage = 0;
        input.set_mouselook(true);
        SDL_SetWindowRelativeMouseMode(window, true);
    };
    // What the last save or load actually said. A save that fails silently is a save the
    // player only finds out about by losing a run.
    char saveLine[96] = {};
    std::uint64_t saveLineAt = 0;
    std::int32_t containerTake = 0;   // roubles pulled out of crates
    std::int32_t contractPaid = 0;    // roubles paid by finished jobs
    game::QuestLog& quests = runState.quests;  // lives in SaveState; F5/F9 persists it
    std::int32_t questPaid = 0;       // roubles paid by finished quests
    // (sold/spent/vendorKind died with the Vendor window: trade is a barter
    // DEAL against the partner's own bag now — [conversation.md]. The faction
    // matrix keeps its live consumer: barter_terms_for prices by the PARTNER's
    // faction row, per body instead of per floor.)
    std::uint32_t deaths = 0;
    std::uint32_t kills = 0;       // carried across possession
    // The character sheet, carried across possession for the same reason `kills`
    // is: a death takes the body, not the person's progression. Seeded level 1 so
    // the very first embodiment (which happens below, before any death) has
    // something valid to fall back to; embody_as_player overwrites it with the
    // record's own rolled build.
    game::RpgStats carriedRpg = game::fresh_rpg(1);
    bool attackHeld = false;
    bool rmbHeld = false; // ПКМ-рука (two-hands.md)
    // Carve scratch + result, reused across ops so a carve allocates nothing
    // after warmup ([world/destruct.h]).
    CarveScratch carveScratch;
    CarveResult carveResult;
    // Macro cells the stain layer dirtied this tick ([world/stain.h]) — the
    // same debt CarveResult::dirtyCells carries, drained into the mirror below.
    std::vector<std::uint32_t> stainDirty;
    // Combat → geometry seam ([combat.h]): bullets/melee propose, sim disposes
    // below on the sim clock, through the same path as the console carve row.
    game::CarveProposalQueue combatCarves;
    // Combat/impact → particle seam ([game/particles.h]): blood and sparks are
    // proposed as bursts during the sim step and drained into the GPU pool.
    game::ParticleBurstQueue particleBursts;

    bool healWanted = false;
    bool eatWanted = false;       // G, consumed by one sim step
    bool reliefWanted = false;    // P, осознанное облегчение ([needs.h])
    bool drinkWanted = false;     // T, consumed by one sim step
    bool craftWanted = false;     // C, consumed by one sim step
    bool scrapWanted = false;     // X, consumed by one sim step
    // Run state, not world state, so it lives beside the ledger. CraftingState is a
    // 96-byte POD ([craft.h]) — nothing to own, nothing to free. craft_init zeroes the
    // material bank, sets tier 0 and marks the nine default-known recipes.
    //
    // This is the first reader the nine authored craft_* columns in data/items.csv have
    // ever had: 446 items carried them and item_table.h:17 said in as many words
    // "crafting is not implemented".
    // Конфиг utility-AI. `enabled` ЖИВЁТ true с включения толпы — прежняя
    // проза «defaults FALSE… dormant» пережила эпоху и врала читателю
    // (аудит 2026-08-25, К1-15): флаг не конфиг, а исторический рубильник.
    game::AiConfig aiCfg;
    aiCfg.enabled = true;   // utility AI live; brains attached in finish_floor_nav
    aiCfg.memory = true;    // second axis: needs a real AiMemory* at ai_step
    // Demand column owned HERE ([ai.h] "No global state"). Id-indexed so an
    // elevator fold keeps the row: the cold NpcId is the key, not the body.
    // Passed to every ai_step; null would be bit-for-bit the pre-memory pass.
    game::AiMemory aiMem;
    // The danger field's producer loop ([diffusion.h]): panicked bodies publish,
    // the driver sweeps at its own cadence, ai_step's threat term finally reads
    // a real number. Lives beside aiMem because both are per-run brain state
    // that survives floor travel; the FIELD does not (on_floor_built re-parks it).
    DiffusionDriver diffusionDriver;
    game::AiTick aiTick{};
    std::uint64_t lastAimemLogTick = ~0ull;
    // Cumulative residents finished off by attrition since the run began. A running
    // total rather than a per-step count, because the failure it watches for is
    // slow: one death per second reads as noise per step and as a morgue per minute.
    std::uint32_t crowdDead = 0;
    game::CraftingState crafting{};
    game::craft_init(crafting);
    std::uint32_t crafted = 0, scrapped = 0, recipesLearned = 0;
    // Content-layer statuses (zhelemish / web / spore / govnyak). Slowed is the
    // velocity CAP in combat.h; this is the authored table that decides what
    // lands and for how long. Main-owned: Inventory is POD and status must not
    // reach into it — gate checks happen at apply sites below.
    game::StatusSet playerStatus{};
    std::uint64_t lastStatusLogTick = ~0ull;
    std::int32_t healed = 0;
    float ateFood = 0.0f;      // food points that LANDED, for the HUD
    float drankWater = 0.0f;
    std::int32_t consumeHpCost = 0;   // HP paid for risky food, running total

    // ── Debug console (~) ───────────────────────────────────────────────
    // The registry + default commands are game code ([console.h]); the app owns
    // only the overlay state and the two seams: the per-frame context refresh
    // and the teleport REQUEST (client proposes, server disposes — the app
    // performs the ride at the top of a frame, never mid-draw).
    game::Console console;
    if (!game::console_register_defaults(console))
        std::fprintf(stderr, "[console] duplicate default command REFUSED\n");
    // Аудио: процедурный DSP + артистские override'ы ([audio.md], политика
    // текстур). Микс на главном потоке; отказ устройства — тишина, не смерть.
    audio::AudioSystem audioSys;
    audioSys.init();

    game::ConsoleContext consoleCtx;
    bool showConsole = false;
    bool consoleFocus = false;
    // Инвентарная сетка ([inventory.md]): UI-состояние здесь, игровые данные —
    // только по указателям в момент отрисовки. Заявка применяется НИЖЕ по
    // кадру, на существующих примитивах.
    InvUiState invUi;
    // Цель обыска — ящик или труп, чьи слоты показаны второй сеткой
    // ([inventory_ui.h] InvUiSide). entt::null = одиночный экран «свой».
    // Протухает вместе с окном (см. инвалидацию перед отрисовкой).
    Entity lootEntity = entt::null;
    bool lootIsCorpse = false;
    // Бартер ([conversation.md]): экран обыска в deal-режиме против пул-строки
    // NPC. Метки — игровое состояние сделки, живут тут (виджет их рисует).
    bool lootIsBarter = false;
    game::NpcId convNpc = game::kInvalidNpc;   // собеседник (и партнёр сделки)
    Entity convEntity = entt::null;
    char convLine[256] = {};                   // последняя реплика в меню
    ConvUiState convUi{};
    std::uint64_t barterOwnMarks = 0, barterOtherMarks = 0;
    char dealLine[160] = {};
    // Партия в кости ([dice.h]) — одна за раз, за столом разговора.
    game::DiceGame diceGame{};
    bool bankCounterOpen = false;   // стойка кассы ([economy.h] teller)
    char consoleInput[256] = {};
    std::vector<std::string> consoleLog;
    std::vector<std::string> consoleHistory;
    int consoleHistPos = -1;
    int pendingTeleport = game::ConsoleContext::kNoRequest;
    int pendingLandHub = -1; // lattice hub for fast-travel land; -1 = keep x/y
    // §24 fast-travel unlock set. Discovery: boarding a hub unlocks THIS floor.
    // Start floor 0 unlocked so the first hub ride has somewhere to go back to.
    game::FastTravelState fastTravel;
    fastTravel.unlock(0);

    // ── Key bindings ────────────────────────────────────────────────────
    // Keys are DATA: a KeybindTable row maps a scancode to a console command
    // ([keybind.h]), so the event loop below does one lookup per keydown and
    // the old per-key `if` chain is gone. The table parses/serializes bytes;
    // the fopen lives HERE, the same split save.h uses.
    game::KeybindTable binds;
    if (!game::keybind_register_defaults(binds))
        std::fprintf(stderr, "[keybind] duplicate default bind REFUSED\n");
    constexpr const char* kBindsPath = "gigahrush2.keys";
    {
        std::FILE* f = std::fopen(kBindsPath, "rb");
        if (f) {
            char text[4096];
            const std::size_t n = std::fread(text, 1, sizeof text - 1, f);
            text[n] = '\0';
            std::fclose(f);
            binds.parse(text);
        }
    }
    input.set_move_binds(game::keybind_move_binds(binds));
    auto save_binds = [&]() {
        char text[4096];
        const std::size_t n = binds.serialize(text, sizeof text);
        std::FILE* f = std::fopen(kBindsPath, "wb");
        if (!f) return;
        std::fwrite(text, 1, n, f);
        std::fclose(f);
    };
    // The rebind capture (settings, Controls tab): index of the row waiting
    // for a key, -1 when idle. menuPage 0 = main items, 1 = settings.
    int rebindCapture = -1;
    int menuPage = 0;

    // ── UI-настройки приложения ([settings_ui.h]) ───────────────────────
    // Один текстовый файл рядом с биндами, тот же паттерн save_binds: ключ
    // значение на строку. Настройки человека, не персонажа — сейв рана их
    // не трогает ([menu.md]).
    constexpr const char* kUiCfgPath = "gigahrush2.ui";
    bool fullscreenState = false;
    auto save_ui_cfg = [&]() {
        std::FILE* f = std::fopen(kUiCfgPath, "wb");
        if (!f) return;
        std::size_t hn = 0;
        HudElement* els = hud_elements(hn);
        for (std::size_t i = 0; i < hn; ++i)
            std::fprintf(f, "hud %s %d\n", els[i].id, els[i].on ? 1 : 0);
        std::fprintf(f, "crt %d\nfullscreen %d\n", renderer.crtEnabled ? 1 : 0,
                     fullscreenState ? 1 : 0);
        const audio::AudioConfig& ac = audioSys.mixer().config();
        std::fprintf(f, "vol_master %.3f\nvol_sfx %.3f\nvol_ambient %.3f\n",
                     static_cast<double>(ac.masterGain),
                     static_cast<double>(ac.sfxGain),
                     static_cast<double>(ac.ambientGain));
        std::fclose(f);
    };
    {
        std::FILE* f = std::fopen(kUiCfgPath, "rb");
        if (f) {
            char line[128];
            auto clamp01 = [](float v) {
                return v < 0.0f ? 0.0f : v > 1.0f ? 1.0f : v;
            };
            while (std::fgets(line, sizeof line, f)) {
                char id[32];
                int iv = 0;
                float fv = 0.0f;
                if (std::sscanf(line, "hud %31s %d", id, &iv) == 2) {
                    std::size_t hn = 0;
                    HudElement* els = hud_elements(hn);
                    for (std::size_t i = 0; i < hn; ++i)
                        if (std::strcmp(els[i].id, id) == 0)
                            els[i].on = iv != 0;
                } else if (std::sscanf(line, "crt %d", &iv) == 1) {
                    // --no-crt — диагностический CLI-override и он сильнее
                    // сохранённого предпочтения: флаг просят на ОДИН запуск.
                    if (!noCrt) renderer.crtEnabled = iv != 0;
                } else if (std::sscanf(line, "fullscreen %d", &iv) == 1) {
                    fullscreenState = iv != 0;
                } else if (std::sscanf(line, "vol_master %f", &fv) == 1) {
                    audioSys.mixer().config().masterGain = clamp01(fv);
                } else if (std::sscanf(line, "vol_sfx %f", &fv) == 1) {
                    audioSys.mixer().config().sfxGain = clamp01(fv);
                } else if (std::sscanf(line, "vol_ambient %f", &fv) == 1) {
                    audioSys.mixer().config().ambientGain = clamp01(fv);
                }
            }
            std::fclose(f);
            if (fullscreenState) SDL_SetWindowFullscreen(window, true);
        }
    }
    // Страница настроек — ОДНА ([settings_ui.h]), из главного меню и из
    // паузы; заявка применяется тут же, сохранение немедленное (паттерн
    // ребинда: настройка, которую app потом уронит, не должна пропасть).
    auto draw_settings_page = [&]() {
        SettingsCtx sctx;
        sctx.binds = &binds;
        sctx.rebindCapture = &rebindCapture;
        sctx.crtEnabled = &renderer.crtEnabled;
        sctx.fullscreen = &fullscreenState;
        sctx.audio = &audioSys.mixer().config();
        const SettingsRequest sreq = settings_ui_draw(sctx);
        if (sreq.bindsReset) {
            binds.clear();
            game::keybind_register_defaults(binds);
            save_binds();
            input.set_move_binds(game::keybind_move_binds(binds));
            rebindCapture = -1;
        }
        if (sreq.uiChanged) {
            SDL_SetWindowFullscreen(window, fullscreenState);
            save_ui_cfg();
        }
    };
    // The display name of an action's current key, for menu rows and HUD
    // prompts — so a rebind renames every hint with no further edit.
    auto bind_key = [&](const char* action) -> const char* {
        const game::KeyBind* kb = binds.find(action);
        const char* name =
            kb ? SDL_GetScancodeName(static_cast<SDL_Scancode>(kb->scancode))
               : "";
        return (name && *name) ? name : "?";
    };
    // The commands a key/menu row dispatches read the SAME context the typed
    // console does; player/floor move under it, so it is re-pointed each frame.
    auto refresh_console_ctx = [&]() {
        consoleCtx.ecs = &reg;
        consoleCtx.pool = &pool;
        consoleCtx.bus = &bus;
        consoleCtx.stack = &stack;
        consoleCtx.floors = &registry;
        consoleCtx.catalog = &floor_catalog();
        consoleCtx.player = player;
        consoleCtx.currentFloor = currentFloor;
        consoleCtx.fastTravel = &fastTravel; // §24 hub unlock bitset
    };
    auto exec_command = [&](const char* line) {
        char msg[256];
        console.exec(consoleCtx, line, msg, sizeof msg);
        if (showConsole && msg[0]) consoleLog.push_back(msg);
    };

    // THE save, one law: run.sav (the run) + the resident floor's own file
    // (its geometry). F5 calls it, and so does the autosave at the end of
    // every ride — a transition is a load screen, where I/O belongs. [save.h]
    auto save_run_now = [&]() -> bool {
        const game::NpcRef* nr =
            reg.valid(player) ? reg.try_get<game::NpcRef>(player) : nullptr;
        if (!nr || !pool.valid(nr->id)) return false;
        const vec3& sp = reg.get<Transform>(player).pos;
        const LayerId pl = reg.get<Transform>(player).layer;
        runState.player.clock = pool.needs(nr->id);
        runState.player.inv = pool.inventory(nr->id);
        runState.player.hp = pool.hp(nr->id);
        runState.player.maxHp = pool.max_hp(nr->id);
        // The equip DECISIONS ride the snapshot ([save.h] eq) — the player
        // decided by hand, a load must not re-decide for them.
        if (const auto* peqS = reg.try_get<game::Equipped>(player))
            runState.player.eq = *peqS;
        // The SIGNED floor, explicitly: NpcPool::floor() is the seeding label
        // and LayerId is a recycled storage slot. [save.h]
        runState.player.floorNumber = currentFloor;
        runState.player.cx = static_cast<std::uint8_t>(
            wrap_macro(static_cast<int>(sp.x / kCellSize)));
        runState.player.cy = static_cast<std::uint8_t>(
            wrap_macro(static_cast<int>(sp.y / kCellSize)));
        runState.player.cz = static_cast<std::uint8_t>(
            wrap_macro(static_cast<int>(sp.z / kCellSize)));
        // Version 7: character sheet + crafting bank. Prefer the live entity
        // component; fall back to the death-surviving carried snapshot so a
        // mid-death F5 still banks progression. [save.h] SAVRPG
        if (const game::RpgStats* rs = reg.try_get<game::RpgStats>(player))
            runState.rpg = *rs;
        else
            runState.rpg = carriedRpg;
        runState.craft = crafting;
        // Version 8 / SAVMAG: chambered mag + kill tally. Lazy-attach stays
        // lazy — only mark hasRanged when the body actually carries the
        // component (elevator rule). kills is the person-state local that
        // death-possession already stamps onto a new body.
        if (const game::PlayerRanged* pr = reg.try_get<game::PlayerRanged>(player)) {
            runState.hasRanged = 1;
            runState.ranged = *pr;
        } else {
            runState.hasRanged = 0;
            runState.ranged = game::PlayerRanged{};
        }
        runState.kills = kills;
        // Version 9 / SAVSTAT: live status effects. Local person-state — not an
        // ECS component — so capture is a direct assignment. F5 mid-haze must
        // not wipe timers on F9. [status.h]
        runState.status = playerStatus;
        // v10 / SAVCLOCK: the two run-scoped clocks. Both are plain locals in this
        // function's scope, which is exactly why they were never saved — nothing in
        // save.cpp could see them. The samosbor one is the central crisis machine,
        // and saving inside an Active phase used to hand back an Idle automaton with
        // `count` 0 on load; the fast-travel one is every hub the player has
        // discovered ([problems.md] §43). [samosbor.h] [fast_travel.h]
        runState.samosbor = samosbor;
        runState.fastTravel = fastTravel;
        // v20/F: сущности резидентного этажа едут в ЕГО файл (материя И
        // сущности одним снимком под ключом модуля), не в run.sav.
        // v6: the macro world travels whole — pool table, macro clock, faction
        // matrix. The society you come back to is the one you left. [save.h]
        pool.save_rows(runState.poolBlob);
        macroSim.save_state(runState.macroBlob);
        runState.factions = factionRel;
        {
            game::FloorEntityState ents;
            game::gather_floor_entities(reg, pl, currentFloor, ents,
                                        &powerGrid);
            write_floor_file(stack.layer(pl), currentFloor, ents,
                             module_key_for(currentFloor));
        }
        char runPath[128];
        run_save_path(runPath, sizeof runPath);
        return write_run(runState, runPath);
    };

    // One ride, either shape: the elevator keys ([ / ]) pass a DIRECTION, the
    // console teleport passes an ABSOLUTE registered floor. Everything after
    // the streamer call — the arrival refresh of mobs/containers/doors/nav/
    // props and the per-floor clocks — is identical, which is exactly why it
    // lives here once instead of twice.
    // `landHub` (default -1): lattice hub index for §24 fast-travel landings;
    // -1 keeps mirrored x/y (debug teleport / ±1 ride). Absolute path only.
    //
    // THE LIVE LAYER LIVES HERE, not inside the frame loop, and `do_ride` writes
    // it back before returning. It used to be declared at the top of the loop
    // body, which the lambda (defined above it) could not reach — so a ride left
    // the enclosing `activeLayer` pointing at the slot the streamer had just
    // recycled, and the REST OF THAT FRAME ran against the departed floor's
    // World: carve, door_step, the mirror flush and bodyPass.record all took the
    // wrong layer. Two of the four travel sites (F9, --shot) had each grown their
    // own `activeLayer = nl;` patch; the console teleport and the [ / ] keys had
    // not. With `keepRadius = 0` there are exactly two slots and `ensure_loaded`
    // allocates before `unload` frees, so the id alternates on EVERY ride — the
    // corruption was guaranteed, not occasional. [problems.md] §24.
    LayerId activeLayer = reg.get<Transform>(player).layer;
    // Половина «покинуть этаж» — общая для синхронной поездки (do_ride) и
    // лифтовой машины (elevators-2x2.md): записи мира, файл этажа, AIMEM.
    auto leave_current_floor = [&]() {
        // Всё накопленное этажом — мир И сущности — уезжает в ЕГО файл ДО
        // переработки слота (v20/F, S20.6: «этаж помнит ВСЁ»). Сбор — на
        // главном потоке (ECS воркеру не принадлежит), кодек и диск — фоном.
        const LayerId leaveLayer = reg.valid(player)
                                       ? reg.get<Transform>(player).layer
                                       : static_cast<LayerId>(0);
        {
            game::FloorEntityState ents;
            game::gather_floor_entities(reg, leaveLayer, currentFloor, ents,
                                        &powerGrid);
            write_floor_file_async(stack.layer(leaveLayer), currentFloor,
                                   std::move(ents),
                                   module_key_for(currentFloor));
        }
        // AIMEM: clear MotionOwner::Ai on the leaving floor before the
        // streamer recycles the layer. unload() also releases; this is the
        // keyboard/--shot leave seam so a ride without an immediate unload
        // still cannot strand tokens. Idempotent. [ai.h]
        {
            const std::uint32_t released =
                game::ai_release(reg, leaveLayer);
            std::fprintf(stderr,
                         "[aimem] LEAVE floor=%d layer=%u released=%u "
                         "mem_rows=%u\n",
                         currentFloor, static_cast<unsigned>(leaveLayer),
                         released, aiMem.rows());
        }
    };
    // Половина «прибыть» — общий хвост обеих поездок: всё, что делает свежий
    // этаж домом (журналы, двери, Fresh-бейк, зеркала GPU, тело в безопасной
    // клетке). Вынесено из do_ride ради лифтовой машины — у неё между leave
    // и arrive лежит асинхронный Prebuild, а хвост обязан быть ТЕМ ЖЕ кодом.
    // Прибытие разрезано на ШАГИ (5d, решение владельца: «фриз лечить по
    // уму»): синхронный путь зовёт все подряд, лифтовая машина — ПО КАДРУ ЗА
    // ШАГ за закрытой створкой, чтобы рендер дышал. Свет остаётся синхронным
    // внутри своего шага (решение владельца) — его 1.3-2.9 с живут одним
    // кадром, остальное больше не складывается с ним в один 10-секундный.
    auto arrive_head = [&](game::RideResult ride, int landHub) -> LayerId {
        if (!ride.moved) return kInvalidLayer;
        player = ride.player;
        currentFloor = ride.floor;
        // (vendorKind died with the window; barter prices by the partner's
        // own faction, per body — [conversation.md].)
        // §24 discovery: landing on (or via) a lattice hub unlocks THIS floor
        // for the fast-travel network. Boarding the cabin is the discover act.
        if (landHub >= 0)
            fastTravel.unlock(currentFloor);
        // Deepest point reached, for the run score. |z|, because depth is
        // bidirectional: the roof is as far from safety as the basement.
        // [extraction.h]
        game::record_floor(ledger, currentFloor);
        // A new floor gets its own clock at its own depth. Not carried over:
        // the cooldown is a function of |z|, so inheriting a 30-minute surface
        // gap into the void would silently cancel the entire depth gradient.
        //
        // That reasoning was right and the function was wrong, for as long as this
        // line existed. `samosbor_new_game` is the DEPTH-INDEPENDENT flat 120..180 s
        // new-game roll — its own doc says "once per RUN" — so re-arming with it did
        // the exact thing the sentence above refuses: at |z| = 50, where the authored
        // cooldown is 60 s, it handed out 2-3x the calm that floor is meant to give,
        // and riding down-and-back-up was a free reset of the depth pressure. It also
        // zeroed `count`, and `count` is what `MobDef::minSamosbor` unlocks against —
        // with a stack of demo floors the player rides constantly, so the fog roster
        // was pinned at count 0 forever and the whole `min_samosbor` column of
        // data/mobs.csv was dead data. Both defects silent. [samosbor.h] names them.
        samosbor = game::samosbor_enter_floor(samosbor, currentFloor, sbRng);
        // The CONTRACT call ([diffusion.h]): a LevelStack slot is recycled, and
        // generate_floor clears the grid but not the FieldRegistry, so the
        // departed floor's danger would keep sitting in the arrival's cells.
        // The layer-id backstop inside diffusion_tick cannot see this case.
        diffusion_driver_on_floor_built(diffusionDriver,
                                        stack.layer(reg.get<Transform>(player).layer),
                                        reg.get<Transform>(player).layer);
        // A rumour is about a FLOOR, so carrying one across a ride makes it
        // false. Caught on a capture: the line read "самосбор здесь часто
        // (17.2%)" while the HUD's own duty for the floor underfoot said 35.0%
        // — the number was true of the floor the speaker was standing on, two
        // rides ago. The whole premise of this system is that a rumour is
        // checkable, so a stale one is worse than none. [rumour.h]
        rumourLine[0] = 0;
        rumourAt = 0;
        // A gunshot on the floor you just left must not be audible to the crowd
        // on the one you arrived at. The streamer RECYCLES LayerId slots, so a
        // surviving record would not merely be stale — it would match the new
        // floor's layer id and be heard there. [noise.h]
        game::noise_clear(noiseField);
        currentSpec = spec_for_floor(currentFloor);
        // Mobs belong to the floor, not to the player: the departed layer's are
        // destroyed and the arrival's are spawned fresh (deterministically, so
        // a floor looks the same every visit).
        return reg.get<Transform>(player).layer;
    };
    auto arrive_refresh = [&](LayerId nl) {
        // Комнаты РАНЬШЕ сидеров: спавн паков селится в объявленных комнатах
        // (mob_spawn читает их из reg.ctx), двери потом — по тегу.
        game::rooms_declare(floorRooms, currentFloor,
                            *spec_for_floor(currentFloor),
                            streamer.floor_seed_of(registry, currentFloor));
        refresh_floor_mobs(reg, stack.layer(nl), currentFloor, nl);
        // РАЗВИЛКА S20.6 (закон 2): первый вход — сидеры, ревизит — записи
        // снимка (клир слота, обесточка, свет — внутри, обеими ветками).
        arrivedRestored = floor_entity_half(nl, currentFloor);
        // Doors before the bake: all-open geometry into the bitsets. No
        // freeze — the worker owns a snapshot. [door.h, game/rebake.h]
    };
    auto arrive_doors_nav = [&](LayerId nl) {
        game::rooms_supply_rebuild(floorRooms, reg, nl);
        game::door_declare(doors, floorRooms, currentFloor,
                           *spec_for_floor(currentFloor),
                           streamer.floor_seed_of(registry, currentFloor));
        // Обвес лифта — СИДЕР (кнопка/панель — сущности, дефолт «закрыто» —
        // состояние): на restore кнопки приходят записями, створки — материей
        // снимка; пересеивать их значило бы воскрешать сорванное (закон 2).
        if (!arrivedRestored) dress_lift_portals(nl);
        begin_floor_nav(stack.layer(nl), currentFloor, nav);
    };
    auto arrive_upload = [&](LayerId nl) {
        voxelMirror.upload_all(stack.layer(nl));
        if (mirrorVerify) voxelMirror.verify(stack.layer(nl));
        if (propPass.ready()) {
            merge_ecs_prop_meshes(reg, nl, propPass,
                                  streamer.antourage_at_layer(registry, nl),
                                  stack.layer(nl), &dripEmitters);
                upload_wires(verletPass, streamer.antourage_at_layer(registry, nl));
                upload_cloths(verletPass, streamer.antourage_at_layer(registry, nl));
        }
        // ride_elevator keeps x/y and plants z=kArrivalCoord. ~1-in-5 Residential
        // columns are solid at that z, so without this the body freezes in a
        // wall forever (physics backs out every tick). F9 already calls
        // place_body_at_cell; keyboard/--shot did not. [save.h]
        game::place_body_safely(reg, stack.layer(nl), player);
        // Publish the new slot to the enclosing frame. ONE place.
        activeLayer = nl;
        save_run_now();
    };
    auto arrive_after_ride = [&](game::RideResult ride, int landHub) -> bool {
        const auto t0 = std::chrono::steady_clock::now();
        const LayerId nl = arrive_head(ride, landHub);
        if (nl == kInvalidLayer) return false;
        arrive_refresh(nl);
        arrive_doors_nav(nl);
        arrive_upload(nl);
        std::fprintf(stderr, "[lift] arrive %d: %.0f ms (sync, one frame)\n",
                     currentFloor,
                     std::chrono::duration<float, std::milli>(
                         std::chrono::steady_clock::now() - t0)
                         .count());
        return true;
    };
    // ПОЛНАЯ пересборка резидентного этажа с диска/генерации — «Новая игра»
    // (аудит F, жук №2): этаж 0 строится ДО меню и мог быть ВОССТАНОВЛЕН из
    // файлов прежнего рана в слоте по умолчанию (материя — испокон, сущности
    // — с v20). Свежий ран обязан начаться на девственном этаже: после вайпа
    // слота файлов нет → ensure_loaded генерирует, развилка сущностей идёт
    // generate-веткой и сеет всё свежим. Тот же F9-хребет: unload → build →
    // сущностная половина → двери/нав/зеркала → тело.
    auto rebuild_current_floor = [&]() {
        flush_floor_write();
        {
            std::lock_guard<std::mutex> lk(g_restoreMx);
            g_pendingRestore.clear(); // бут мог начитать чужой слот
        }
        game::NpcId pid = reg.valid(player) ? reg.get<game::NpcRef>(player).id
                                            : game::kInvalidNpc;
        streamer.unload(stack, registry, reg, pool, currentFloor);
        const game::LoadResult lr = streamer.ensure_loaded(
            stack, registry, reg, pool, currentFloor, pid);
        const LayerId nl = lr.layer;
        activeLayer = nl;
        player = pid != game::kInvalidNpc
                     ? game::embody_as_player(reg, pool, pid, nl)
                     : lr.player;
        game::rooms_declare(floorRooms, currentFloor,
                            *spec_for_floor(currentFloor),
                            streamer.floor_seed_of(registry, currentFloor));
        refresh_floor_mobs(reg, stack.layer(nl), currentFloor, nl);
        arrivedRestored = floor_entity_half(nl, currentFloor);
        diffusion_driver_on_floor_built(diffusionDriver, stack.layer(nl), nl);
        arrive_doors_nav(nl);
        voxelMirror.upload_all(stack.layer(nl));
        if (mirrorVerify) voxelMirror.verify(stack.layer(nl));
        if (propPass.ready()) {
            merge_ecs_prop_meshes(reg, nl, propPass,
                                  streamer.antourage_at_layer(registry, nl),
                                  stack.layer(nl), &dripEmitters);
            upload_wires(verletPass, streamer.antourage_at_layer(registry, nl));
            upload_cloths(verletPass, streamer.antourage_at_layer(registry, nl));
        }
        if (reg.valid(player)) {
            game::place_body_safely(reg, stack.layer(nl), player);
            aim_player(reg, player);
        }
    };

    auto do_ride = [&](bool absolute, int target, int landHub = -1) -> bool {
        // Pass the player's durable record id so the destination crowd skips it
        // instead of spawning a second player.
        game::NpcId pid = reg.valid(player) ? reg.get<game::NpcRef>(player).id
                                            : game::kInvalidNpc;
        leave_current_floor();
        game::RideResult ride =
            absolute ? streamer.teleport(stack, registry, reg, pool, player,
                                         currentFloor, target, game::kArrivalCoord,
                                         pid, landHub)
                     : streamer.travel(stack, registry, reg, pool, player,
                                       currentFloor, target, game::kArrivalCoord,
                                       pid);
        return arrive_after_ride(ride, landHub);
    };

    // --- Лифтовая машина (elevators-2x2.md; ЗАКОН ДВЕРЕЙ — один пекарь) -----
    // Idle -> Prebuilding: воркер строит мир целевого этажа в свободный слот,
    // игрок заперт в кабине столба; -> WaitFresh: мир свапнут, игрок уже в
    // кабине НАЗНАЧЕНИЯ, Fresh-бейк печётся «за закрытыми дверьми»; -> Idle:
    // nav.step() вернул true (Fresh-свап) — двери открылись. Лифт сам ничего
    // не печёт и не ждёт констант: финал даёт существующий сигнал пекаря.
    enum class LiftRide : std::uint8_t {
        Idle,
        Prebuilding,
        SwapRefresh,   // 5d: шаги посадки — по кадру за шаг, за створкой
        SwapDoorsNav,  // двери+нав (свет синхронный — толстый кадр один)
        SwapUpload,    // зеркала GPU + автосейв
        WaitFresh
    };
    LiftRide liftRide = LiftRide::Idle;
    int liftDst = 0;
    int liftHub = -1;
    std::uint64_t liftT0 = 0; // сим-тик старта: строка [lift] ride + иллюзия
    // Fresh-свап целевого этажа уже прошёл; двери ждут ещё и ПОЛНОГО
    // пробуждения сред (mediumPass.wakes_pending — решение владельца:
    // лавина будильника этажа целиком за закрытыми дверьми).
    bool liftFreshDone = false;
    LayerId liftSwapLayer = kInvalidLayer; // слой шагов посадки (5d)
    auto start_lift_ride = [&](int dst, int hub) -> bool {
        if (liftRide != LiftRide::Idle) return false;
        std::function<void()> job;
        if (!streamer.prebuild_begin(stack, registry, dst, job)) {
            // Уже резидентен или нет слота — редкий дев-случай: честная
            // синхронная поездка тем же законом прибытия.
            return do_ride(/*absolute=*/true, dst, hub);
        }
        // Хвост фоновой записи — ДО старта воркера: restore-ветка Prebuild
        // читает файл целевого этажа, а туда-обратно (0->4->0) целевой этаж
        // и есть последний покинутый.
        flush_floor_write();
        // Створка посадки зарастает — игрок заперт в кабине (механизм-API
        // новой двери; дренаж doorDirty — швом карва в топе кадра).
        if (hub >= 0 && hub < 4 && doors.lift[hub] != game::kNoPortal)
            game::door_close(stack.layer(activeLayer),
                             doors.list[doors.lift[hub]], reg, activeLayer,
                             doorDirty);
        nav.start_prebuild(std::move(job));
        liftRide = LiftRide::Prebuilding;
        liftFreshDone = false;
        liftDst = dst;
        liftHub = hub;
        liftT0 = simTick;
        return true;
    };

    while (running) {
        activeLayer = reg.get<Transform>(player).layer;
        bool propPassNeedsRebuild = false;
        // dressingSetChanged МЁРТВ (2026-08-31, приказ владельца): смерть
        // антуража больше НЕ триггерит upload_wires/upload_cloths. Аплоад
        // пишет rest-позы бейка поверх ЖИВОГО GPU-сима всего этажа — провод,
        // потерявший последний якорь, телепортировался в дефолт-катенарию и
        // падал из неё; любая смерть жёсткой ноги сбрасывала ВСЕ провода и
        // шторы этажа (вторая половина §28.4). Страховка §59.26 («GPU не
        // симулирует убитые цепи») живёт в покадровом пути: wire_live_pins +
        // FallClock → write_wire_alive/write_wire_pins — и заперта гейтом
        // verlet_test «мёртвый элемент замирает». Аплоады верле — только
        // вход на этаж и полный ребилд.

        // The dressing's half of every geometry mutation, next to the ECS-prop
        // half (anchor_validate_step): whatever emptied these cells — a blast,
        // a bullet, an opening door — the baked antourage anchored to them is
        // severed, sheds debris through the shared particle queue, and the
        // instance list owes a re-pack. True = "the GPU is drawing a lie".
        const auto antourage_carve_step_here =
            [&](const std::vector<std::uint32_t>& dirty,
                std::uint32_t seed) -> bool {
            const game::AntourageBake* ab =
                streamer.antourage_at_layer(registry, activeLayer);
            if (ab == nullptr || dirty.empty()) return false;
            return game::antourage_carve_step(stack.layer(activeLayer), *ab,
                                              dirty.data(), dirty.size(),
                                              particleBursts, seed,
                                              &antourageFalling) > 0;
        };

        // §22: amortize nav field rebake under frame budget.
        std::uint64_t now = SDL_GetPerformanceCounter();
        float frameDt = static_cast<float>((now - prevTicks) / freq);
        prevTicks = now;
        // Wall-clock гистограмма кадра для [gpu-shot]-свода: GPU-таймер не
        // видит CPU-кость (сим, толпа, сбор света, презент). Пишем последние
        // 256 кадров кольцом; свод печатает медиану/пик на выходе --shot.
        // Первый кадр в кольцо НЕ входит: он несёт загрузку/первые бейки
        // (сотни мс) и в коротком прогоне маскирует настоящий пик стационара —
        // свод печатает его отдельной строкой (вопрос «пик 621 мс = первый
        // кадр?» из core-stabilization.md перестаёт быть вопросом: первый
        // кадр назван по имени, пик кольца — всегда стационар).
        {
            static float wallRing[256];
            static unsigned wallHead = 0;
            if (g_wallFirstMs < 0.0f) {
                g_wallFirstMs = frameDt * 1000.0f;
            } else {
                wallRing[wallHead & 255u] = frameDt * 1000.0f;
                ++wallHead;
            }
            g_wallRing = wallRing;
            g_wallSeen = wallHead;
        }

        // Детектор хитча ([markoaudit/plans/carve-hitch.md], инкремент 1б):
        // «не знаю, может GPU» перестаёт быть ответом — любой ощутимый затык
        // обязан оставить строку с разбором. Порог ВЫВЕДЕН, не выбран: глазу
        // заметен кадр от ~3 vsync-периодов, 3×16.7 = 50 мс при 60 Гц
        // (GIGA_HITCH_MS переопределяет — на 120 Гц панели порог вдвое ниже).
        // frameDt меряет ПРЕДЫДУЩИЙ кадр — метки g_frameMark копились в нём же
        // и сбрасываются здесь. CPU-виновник виден метками; GPU-виновник —
        // длинным кадром при пустых метках, его проход называют пики окна
        // GPU-таймера ([render/gpu_timer.h]: пик — 31 кадр, спайк может доехать
        // строкой-двумя позже; dropped растёт = цифры несвежие).
        {
            static const float hitchMs = [] {
                const char* e = std::getenv("GIGA_HITCH_MS");
                return e != nullptr ? static_cast<float>(std::atof(e)) : 50.0f;
            }();
            const float wallMs = frameDt * 1000.0f;
            if (wallMs > hitchMs && g_wallSeen > 1) {
                const auto& gt = renderer.timer;
                std::fprintf(
                    stderr,
                    "[hitch] frame %.0f ms | cpu sim %.1f render %.1f "
                    "other %.1f | carve %.2f, light_swap %.2f, "
                    "prop_skin %.2f, entry %d | gpu peak %.1f ms: lgrid %.1f, "
                    "vflush %.1f, cull %.1f, simphys %.1f, world %.1f, "
                    "bodies %.1f, props %.1f, drawphys %.1f, hud %.1f "
                    "(dropped %u)\n",
                    static_cast<double>(wallMs),
                    static_cast<double>(g_frameMark.simMs),
                    static_cast<double>(g_frameMark.renderMs),
                    static_cast<double>(wallMs - g_frameMark.simMs -
                                        g_frameMark.renderMs),
                    static_cast<double>(g_frameMark.carveMs),
                    static_cast<double>(g_frameMark.lightSwapMs),
                    static_cast<double>(g_frameMark.propSkinMs),
                    g_frameMark.floorEntry ? 1 : 0,
                    static_cast<double>(gt.frame_ms_max()),
                    static_cast<double>(gt.pass_ms_max(gpu::GpuPass::LightGrid)),
                    static_cast<double>(gt.pass_ms_max(gpu::GpuPass::VoxelFlush)),
                    static_cast<double>(gt.pass_ms_max(gpu::GpuPass::Cull)),
                    static_cast<double>(gt.pass_ms_max(gpu::GpuPass::SimPhysics)),
                    static_cast<double>(gt.pass_ms_max(gpu::GpuPass::World)),
                    static_cast<double>(gt.pass_ms_max(gpu::GpuPass::Bodies)),
                    static_cast<double>(gt.pass_ms_max(gpu::GpuPass::Props)),
                    static_cast<double>(gt.pass_ms_max(gpu::GpuPass::DrawPhysics)),
                    static_cast<double>(gt.pass_ms_max(gpu::GpuPass::Hud)),
                    gt.dropped());
            }
            // [prof] свод per-system: суммы прошлого кадра — в кольца, раз в
            // 256 кадров (~4 с) — печать. Читается здесь же, где хитч-детектор,
            // потому что это единственная точка, где wall-clock кадра уже
            // известен, а метки ещё не сброшены.
            if (g_profOn && g_wallSeen > 1) {
                static giga::prof::Ring profWall, profSim, profRender,
                    profCarve, profLightSwap, profPropSkin, profMedApply,
                    profMedRec, profMedLoop, profMedFrontier;
                profMedLoop.push(mediumPass.apply_loop_ms());
                profMedFrontier.push(mediumPass.apply_frontier_ms());
                profWall.push(wallMs);
                profSim.push(g_frameMark.simMs);
                profRender.push(g_frameMark.renderMs);
                profCarve.push(g_frameMark.carveMs);
                profLightSwap.push(g_frameMark.lightSwapMs);
                profPropSkin.push(g_frameMark.propSkinMs);
                profMedApply.push(g_mediumApplyMs);
                profMedRec.push(g_mediumRecMs);
                for (unsigned s = 0; s < kProfCount; ++s) {
                    g_profRing[s].push(g_profFrameMs[s]);
                    g_profFrameMs[s] = 0.0f;
                }
                static unsigned profFrames = 0;
                if ((++profFrames & 255u) == 0u) {
                    const giga::prof::Stats w = giga::prof::ring_stats(profWall);
                    std::fprintf(stderr,
                                 "[prof] ===== %u кадров | wall med %.2f p90 "
                                 "%.2f peak %.2f мс | medium live %u quanta %u "
                                 "| bodies %u =====\n",
                                 profFrames, static_cast<double>(w.median),
                                 static_cast<double>(w.p90),
                                 static_cast<double>(w.peak),
                                 mediumPass.live_count(),
                                 mediumPass.live_quanta(),
                                 bodyPass.last_instance_count());
                    const auto line = [](const char* name,
                                         const giga::prof::Ring& r) {
                        const giga::prof::Stats st = giga::prof::ring_stats(r);
                        std::fprintf(stderr,
                                     "[prof] %-11s med %8.3f  p90 %8.3f  peak "
                                     "%8.3f\n",
                                     name, static_cast<double>(st.median),
                                     static_cast<double>(st.p90),
                                     static_cast<double>(st.peak));
                    };
                    line("sim", profSim);
                    line("render", profRender);
                    for (unsigned s = 0; s < kProfCount; ++s)
                        line(kProfName[s], g_profRing[s]);
                    line("carve", profCarve);
                    line("light_swap", profLightSwap);
                    line("prop_skin", profPropSkin);
                    line("med_apply", profMedApply);
                    line("med_record", profMedRec);
                    line("med_loop", profMedLoop);
                    line("med_frontier", profMedFrontier);
                    // Состав окна последнего применения: cmp-only = чистая
                    // цена memcmp неизменённых, copied = memcpy+recount.
                    std::fprintf(stderr,
                                 "[prof] med-apply-mix window %u cmp-only %u "
                                 "copied %u lazy %u skip-fresh %u\n",
                                 mediumPass.apply_window(),
                                 mediumPass.apply_cmp_only(),
                                 mediumPass.apply_copied(),
                                 mediumPass.apply_lazy(),
                                 mediumPass.apply_skip_fresh());
                    // Большой суд (big-judge.md): очередь/фаза/вердикты.
                    {
                        const BigCourtStatus bj = big_judge_status();
                        std::fprintf(stderr,
                                     "[prof] big-judge pending %u phase %u "
                                     "case %u conv-left %u | loose %u "
                                     "supported %u retries %u\n",
                                     bj.pending, bj.phase, bj.caseNodes,
                                     bj.convertLeft, bj.verdictsLoose,
                                     bj.verdictsSupported, bj.retries);
                    }
                    // Состав rigid-сцены последнего тика (§59.11): разводит
                    // «спящие платят за бины» от «дорогая физика бодрых».
                    if (const RigidStats* rs = reg.ctx().find<RigidStats>())
                        std::fprintf(stderr,
                                     "[prof] rigid-stats bodies %u awake %u "
                                     "agents %u links %u | noisy %u "
                                     "quiet-no-touch %u | bins %.3f ms "
                                     "solve %.3f ms (последний тик) | "
                                     "medium-wakes %llu (всего)\n",
                                     rs->bodies, rs->awake, rs->agents,
                                     rs->links, rs->noisyBodies,
                                     rs->quietNoTouch,
                                     static_cast<double>(rs->binsMs),
                                     static_cast<double>(rs->solveMs),
                                     static_cast<unsigned long long>(
                                         g_profMediumRigidWakes));
                    if (renderer.timer.supported()) {
                        const auto& gt = renderer.timer;
                        std::fprintf(
                            stderr,
                            "[prof] gpu lgrid %.2f vflush %.2f cull %.2f "
                            "simphys %.2f world %.2f bodies %.2f props %.2f "
                            "drawphys %.2f hud %.2f light %.2f raster %.2f | "
                            "frame %.2f peak %.2f (dropped %u)\n",
                            static_cast<double>(
                                gt.pass_ms(gpu::GpuPass::LightGrid)),
                            static_cast<double>(
                                gt.pass_ms(gpu::GpuPass::VoxelFlush)),
                            static_cast<double>(gt.pass_ms(gpu::GpuPass::Cull)),
                            static_cast<double>(
                                gt.pass_ms(gpu::GpuPass::SimPhysics)),
                            static_cast<double>(gt.pass_ms(gpu::GpuPass::World)),
                            static_cast<double>(
                                gt.pass_ms(gpu::GpuPass::Bodies)),
                            static_cast<double>(gt.pass_ms(gpu::GpuPass::Props)),
                            static_cast<double>(
                                gt.pass_ms(gpu::GpuPass::DrawPhysics)),
                            static_cast<double>(gt.pass_ms(gpu::GpuPass::Hud)),
                            static_cast<double>(gt.pass_ms(gpu::GpuPass::Light)),
                            static_cast<double>(
                                gt.pass_ms(gpu::GpuPass::Raster)),
                            static_cast<double>(gt.frame_ms()),
                            static_cast<double>(gt.frame_ms_max()),
                            gt.dropped());
                    }
                }
            }
            g_frameMark = FrameMark{};
            g_frameT0 = std::chrono::steady_clock::now();
        }

        // A console teleport is executed HERE, at the top of a frame, never in
        // the ImGui callback that requested it: mid-draw the frame's layer and
        // camera state are already committed, and yanking the world under them
        // is exactly the class of bug the request seam exists to prevent.
        if (pendingTeleport != game::ConsoleContext::kNoRequest) {
            const int dst = pendingTeleport;
            const int hub = pendingLandHub;
            pendingTeleport = game::ConsoleContext::kNoRequest;
            pendingLandHub = -1;
            // Дев-телепорт во время лифтовой поездки молча гасится: два
            // одновременных перехода делят два физических слота и мир под
            // закрытыми дверьми — гонка по построению.
            if (liftRide == LiftRide::Idle) do_ride(/*absolute=*/true, dst, hub);
        }
        // Консоль заспавнила якорный проп (cmd_prop) — та же безопасная
        // точка, что телепорт: шкура PropPass перестраивается этим кадром,
        // иначе проп существует в симе, но невидим (fuel_barrel 2026-08-22).
        if (consoleCtx.propsChanged) {
            consoleCtx.propsChanged = false;
            propPassNeedsRebuild = true;
        }

        // Events are transient by design ([events.md]): whatever was published
        // last frame has had its chance to be consumed. Clearing here rather than
        // at the end means a consumer added later sees a full frame's batch.
        // Drain the bus BEFORE clearing it. `finalize_deaths` publishes NpcDied with
        // the victim's pool id and the mob kind, which is exactly what a Hunt job needs
        // to count and what a giver's death needs to fail a contract — so both hook the
        // same event the kill feed does rather than inventing a second notion of death.
        for (std::uint32_t i = 0; i < bus.size(); ++i) {
            const game::Event& ev = bus.events()[i];
            if (ev.type != game::EventType::NpcDied) continue;
            if (ev.type == game::EventType::NpcDied) {
                // `b` is the mob kind, 0xFF when the dead thing was not a monster.
                //
                // AND `c` IS THE KILLER, which this site ignored until 2026-08-12.
                // A Hunt job counted ANY monster death on the floor — one killed by
                // another monster, by a hazard, by a fall. [problems.md] §40 filed
                // that as sloppiness because it was nearly unobservable: monsters
                // could not hit each other, so almost every mob death really was the
                // player's doing.
                //
                // Removing `Projectile::team` the same day turned it into an
                // EXPLOIT. Monsters now shoot each other as a matter of course, so a
                // contract for eight Krysnozhka completes while the player stands
                // still and watches. That is the friendly-fire change handing the
                // player a reward system it was never meant to touch — and it is the
                // reason this is fixed in the same session rather than filed.
                //
                // The player is the CAMERA HOLDER, not a stored id: "the player is
                // not special, it is whoever holds the components" ([AGENTS.md]), so
                // a possessed body earns its own kills without a second rule.
                // XP already worked this way — `finalize_deaths` credits `d.killer`
                // — which is exactly why the two disagreed and only this one paid out
                // for a death across the room.
                if (ev.b != 0xFFu &&
                    ev.c == static_cast<std::uint32_t>(entt::to_integral(player))) {
                    game::contract_on_kill(contracts, static_cast<std::uint8_t>(ev.b));
                    game::quest_on_kill(quests, static_cast<std::uint8_t>(ev.b));
                }
                // `a` is the pool id, kInvalidNpc when the dead thing had no record.
                // Giver death fails Active contracts AND Active quests the same way.
                if (ev.a != game::kInvalidNpc) {
                    game::contract_on_giver_died(contracts, ev.a);
                    game::quest_on_giver_died(quests, ev.a);
                }


            }
        }
        // Diplomacy reads the same ring, in the same frame-top drain, and for the same
        // reason: one notion of death, not three. Deliberately here and NOT beside
        // `finalize_deaths` in the substep — a frame can run several substeps, each
        // publishing Deed, and a per-substep drain would re-read the earlier
        // substeps' events and bill those deeds again. `witness_step` is only
        // snapshot-bounded WITHIN one call. Draining once per frame, immediately before
        // `bus.clear()`, is exactly the contract the header asks for and is
        // double-count-free.
        //
        // S19 ЗАКРЫЛ ВСЕВИДЕНИЕ: relations_drain_deaths гнул матрицу без
        // единого свидетеля; теперь убийство — деяние (Deed kill из
        // finalize_deaths), и дипломатию двигает ТОЛЬКО воспринявший
        // (sub_march-зрение / skeleton_audible-слух). Незамеченное убийство
        // оставляет труп, но не дипломатию. [witness.h]
        {
            const auto profWitnessT0 = prof_now();
            const game::WitnessTick wt = game::witness_step(
                reg, pool, factionRel, bus, floorRooms,
                stack.layer(activeLayer), activeLayer, simTick);
            prof_add(kProfWitness, profWitnessT0);
            relTick = {};
            relTick.kills = wt.witnessed;  // HUD: замеченные деяния кадра
            relTick.changes = wt.changes;
        }
        bus.clear();

        // Планировщик допекания ([game/rebake.h]): раз в кадр, в топе кадра до
        // сим-подшагов — летопись мутаций (часы — сим-тики), свап готовых
        // секций фонового Rebake (rooms -> coarse -> fine, живые структуры
        // пишутся только здесь, на главном потоке) и старт новых циклов по
        // дебаунсу/дедлайну. true ровно на кадре Fresh-свапа — момент, когда
        // толпе нового этажа пора ходить; Rebake-свапы пересева не требуют.
        const auto profNavT0 = prof_now();
        if (nav.step(simTick, g_worldGen)) {
            const LayerId l = reg.valid(player)
                                  ? reg.get<Transform>(player).layer
                                  : LayerId{0};
            finish_floor_nav(reg, l, 0xA11FEu, nav);
            // Лифт: Fresh-свап целевого этажа — первая половина «дверей»;
            // вторая — пустая очередь пробуждений сред (ниже).
            if (liftRide == LiftRide::WaitFresh) liftFreshDone = true;
        }
        prof_add(kProfNav, profNavT0);
        // Лифтовая машина, фаза свапа: воркер отдал мир — ecs-половина,
        // перенос тела в кабину назначения и ВЕСЬ обычный хвост прибытия
        // (arrive_after_ride запускает Fresh-бейк через begin_floor_nav);
        // дальше ждём Fresh-свапа выше. Тот же топ кадра, что у телепорта:
        // мир не дёргается под закоммиченным кадром.
        if (liftRide == LiftRide::Prebuilding && nav.take_prebuilt()) {
            game::NpcId pid = reg.valid(player)
                                  ? reg.get<game::NpcRef>(player).id
                                  : game::kInvalidNpc;
            leave_current_floor();
            streamer.prebuild_finish(stack, registry, reg, pool, pid);
            const game::FloorSpec* dspec = spec_for_floor(liftDst);
            const int arriveH =
                dspec ? game::lift_entrance(
                            dspec->kind, liftDst, liftHub,
                            streamer.floor_seed_of(registry, liftDst))
                            .h
                      : game::kArrivalCoord;
            game::RideResult ride = streamer.teleport(
                stack, registry, reg, pool, player, currentFloor, liftDst,
                static_cast<std::uint8_t>(arriveH), pid, liftHub);
            liftSwapLayer = arrive_head(ride, liftHub);
            if (liftSwapLayer != kInvalidLayer) {
                liftRide = LiftRide::SwapRefresh; // шаги — по кадру (5d)
            } else {
                streamer.prebuild_cancel();
                liftRide = LiftRide::Idle;
            }
        } else if (liftRide == LiftRide::SwapRefresh) {
            const auto tS = std::chrono::steady_clock::now();
            arrive_refresh(liftSwapLayer);
            std::fprintf(stderr, "[lift] swap: refresh %.0f ms\n",
                         std::chrono::duration<float, std::milli>(
                             std::chrono::steady_clock::now() - tS)
                             .count());
            liftRide = LiftRide::SwapDoorsNav;
        } else if (liftRide == LiftRide::SwapDoorsNav) {
            const auto tS = std::chrono::steady_clock::now();
            arrive_doors_nav(liftSwapLayer);
            // Кабина назначения зарастает до готовности (двери объявлены).
            if (liftHub >= 0 && liftHub < 4 &&
                doors.lift[liftHub] != game::kNoPortal)
                game::door_close(stack.layer(liftSwapLayer),
                                 doors.list[doors.lift[liftHub]], reg,
                                 liftSwapLayer, doorDirty);
            std::fprintf(stderr, "[lift] swap: doors+nav %.0f ms\n",
                         std::chrono::duration<float, std::milli>(
                             std::chrono::steady_clock::now() - tS)
                             .count());
            liftRide = LiftRide::SwapUpload;
        } else if (liftRide == LiftRide::SwapUpload) {
            const auto tS = std::chrono::steady_clock::now();
            arrive_upload(liftSwapLayer);
            std::fprintf(stderr, "[lift] swap: upload %.0f ms\n",
                         std::chrono::duration<float, std::milli>(
                             std::chrono::steady_clock::now() - tS)
                             .count());
            liftRide = LiftRide::WaitFresh;
        }
        // Двери открываются, когда запечено И допробужено: Fresh-свап
        // прошёл, а очередь пробуждений будильника этажа выпита — вся вода
        // этажа уже в живом списке автомата и падает физикой за закрытыми
        // дверьми (решение владельца 2026-08-27). Замер — всегда.
        if (liftRide == LiftRide::WaitFresh && liftFreshDone &&
            !mediumPass.wakes_pending()) {
            liftRide = LiftRide::Idle;
            liftFreshDone = false;
            // «Лифт приехал» — створка субвоксельно открывается.
            if (liftHub >= 0 && liftHub < 4 &&
                doors.lift[liftHub] != game::kNoPortal)
                game::door_open(stack.layer(activeLayer),
                                doors.list[doors.lift[liftHub]], doorDirty);
            std::fprintf(stderr,
                         "[lift] ride to %d: %llu ticks cabin-to-doors "
                         "(baked+woken)\n",
                         currentFloor,
                         static_cast<unsigned long long>(simTick - liftT0));
        }
        // Кабина заперта на всю поездку: контроллер в бокс — тело держится в
        // клетке шахты (стены столба держат остальное), взгляд свободен.
        // Створки/анимация — инкремент 5.
        if (liftRide != LiftRide::Idle && reg.valid(player) && liftHub >= 0) {
            std::uint8_t ccx = 0, ccy = 0;
            game::fast_hub_cell(liftHub, ccx, ccy);
            auto& ltr = reg.get<Transform>(player);
            ltr.pos.x = (static_cast<float>(ccx) + 0.5f) * kCellSize;
            ltr.pos.y = (static_cast<float>(ccy) + 0.5f) * kCellSize;
        }
        // ФОКУС ПРИЦЕЛА — состояние КАДРА, не рисования ([game/focus.h]).
        // Считался внутри HUD-ветки (под showHud/playing/valid), а
        // потребитель — обработчик E — живёт в сим-ветке: цель зависела от
        // того, рисуется ли табличка. Теперь одна точка, до всех читателей.
        if (reg.valid(player) && activeLayer != kInvalidLayer) {
            const auto& camF = reg.get<CameraTag>(player);
            const vec3 aimF = camera_forward(camF.yaw, camF.pitch);
            vec3 eyeF = reg.get<Transform>(player).pos;
            if (const auto* nrF = reg.try_get<game::NpcRef>(player))
                if (pool.valid(nrF->id))
                    eyeF.z += game::body_eye_height(pool.height_mm(nrF->id));
            const auto profFocusT0 = prof_now();
            g_focus = game::focus_pick(reg, stack.layer(activeLayer),
                                       activeLayer, eyeF, aimF, doors, player);
            prof_add(kProfFocus, profFocusT0);
            // ФАКТЫ ВМЕСТО ДОГАДОК (владелец: «таблички нет, смотрю в
            // упор»): раз в игровую секунду — что видит прицел. GIGA_FOCUS_DBG.
            static const bool kFocusDbg =
                std::getenv("GIGA_FOCUS_DBG") != nullptr;
            static std::uint64_t focusSaid = 0;
            if (kFocusDbg && simTick - focusSaid > kSimHz) {
                focusSaid = simTick;
                game::FocusDebug fd{};
                game::focus_pick_debug(reg, stack.layer(activeLayer),
                                       activeLayer, eyeF, aimF, doors, fd,
                                       player);
                std::fprintf(stderr,
                             "[focus] eye(%.1f,%.1f,%.1f) aim(%.2f,%.2f,%.2f)"
                             " | ents %u (в reach %u, в конусе %u, видимых %u)"
                             " | portals %u (в reach %u, в конусе %u, видимых"
                             " %u) -> what=%d dist=%.2f | ближ ent %.1f м"
                             " (%.1f,%.1f,%.1f), ближ door %.1f м"
                             " (%.1f,%.1f,%.1f)\n",
                             eyeF.x, eyeF.y, eyeF.z, aimF.x, aimF.y, aimF.z,
                             fd.entTotal, fd.entReach, fd.entCone, fd.entSeen,
                             fd.portTotal, fd.portReach, fd.portCone,
                             fd.portSeen, static_cast<int>(g_focus.what),
                             g_focus.dist, fd.nearEntDist, fd.nearEntPos.x,
                             fd.nearEntPos.y, fd.nearEntPos.z, fd.nearPortDist,
                             fd.nearPortPos.x, fd.nearPortPos.y,
                             fd.nearPortPos.z);
            }
        } else {
            g_focus = game::Focus{};
        }
        if (frameDt > 0.1f) frameDt = 0.1f; // clamp after a stall

        // --- events --------------------------------------------------------
        // Keydown dispatch is ONE table lookup ([keybind.h]): the row's console
        // command runs through the same registry a typed line uses, and its
        // effect lands as a request bit drained after this loop. The old per-key
        // `if` chain is gone — adding a key action is a KeybindTable row plus a
        // ConsoleCommand row, no app edit.
        refresh_console_ctx();
        SDL_Event e;
        while (SDL_PollEvent(&e)) {
            hud.process_event(e);
            if (e.type == SDL_EVENT_QUIT) running = false;
            if (shell.screen == AppScreen::Intro &&
                (e.type == SDL_EVENT_KEY_DOWN ||
                 e.type == SDL_EVENT_MOUSE_BUTTON_DOWN)) {
                // Заставка ждёт ЛЮБОЙ ввод и уходит в меню ([ui_shell.h]).
                // Клетки логотипа не пропадают — перетекают в титул меню.
                shell.screen = AppScreen::Menu;
                shell.menuPage = 0;
                introFx.retarget_title(ImGui::GetIO().DisplaySize.x,
                                       ImGui::GetIO().DisplaySize.y);
                continue;
            }
            if (e.type == SDL_EVENT_KEY_DOWN && !e.key.repeat) {
                if (rebindCapture >= 0) {
                    // The menu is listening: this key becomes the row's binding
                    // (Esc cancels). Saved immediately — a rebind the app then
                    // crashes on would otherwise be lost.
                    if (e.key.scancode != SDL_SCANCODE_ESCAPE)
                        binds.rebind(binds.at(static_cast<std::size_t>(rebindCapture)).action,
                                     static_cast<std::uint16_t>(e.key.scancode));
                    rebindCapture = -1;
                    save_binds();
                    input.set_move_binds(game::keybind_move_binds(binds));
                } else {
                    // Открытая сетка владеет клавишами так же, как текстовый
                    // ввод: обычные бинды молчат (E внутри инвентаря — это
                    // «экипировать», а не глобальный interact), kBindTyping
                    // пробиваются, чтобы закрыть то, что открыли.
                    //
                    // Консоль — по showConsole, НЕ по WantTextInput: фокус
                    // слетает с поля после Enter или клика по логу, и одну
                    // клавишу спустя WantTextInput уже false при открытой
                    // консоли — так буквы набора дёргали бинды. И пока консоль
                    // открыта, глушится ВСЯ таблица, включая kBindTyping-
                    // тумблеры окон: их право пробивать typing существует,
                    // чтобы I закрывала сетку, которая сама же и глушит, — а не
                    // чтобы L в набранном `fly` открывала лифт (ровно это и
                    // происходило). Единственное исключение — сам тумблер
                    // консоли, иначе её нечем закрыть с клавиатуры.
                    const bool typing = showConsole ||
                                        ImGui::GetIO().WantTextInput ||
                                        shell.window != UiWindow::None;
                    const game::KeyBind* kb = binds.find_scancode(
                        static_cast<std::uint16_t>(e.key.scancode));
                    // Plain rows fire only in live play; kBindAlways rows (menu,
                    // console, hud) fire while paused, kBindTyping rows even
                    // while a text field owns the keyboard — so the toggle key
                    // can always close what it opened. This gate also stops a
                    // vendor-filter keystroke from eating rations, which the old
                    // chain happily did.
                    // Playing — все бинды по typing-правилу; Pause — только
                    // kBindAlways (menu/console/hud). Intro/Menu — ничего.
                    if (kb &&
                        (shell.playing() ||
                         (shell.screen == AppScreen::Pause &&
                          (kb->flags & game::kBindAlways))) &&
                        (!typing ||
                         ((kb->flags & game::kBindTyping) &&
                          (!showConsole ||
                           std::strcmp(kb->action, "console") == 0))))
                        exec_command(kb->command);
                }
            }
            // While the pause menu is up, ignore all look/move input: ImGui owns
            // the cursor and the game is frozen.
            if (shell.playing()) {
                // Клик по открытой сетке — выбор клетки, не замах: пока
                // инвентарь владеет курсором, мышь до боя не доходит.
                if (e.type == SDL_EVENT_MOUSE_BUTTON_DOWN &&
                    e.button.button == SDL_BUTTON_LEFT &&
                    shell.window == UiWindow::None) {
                    attackHeld = true;
                } else if (e.type == SDL_EVENT_MOUSE_BUTTON_UP &&
                           e.button.button == SDL_BUTTON_LEFT) {
                    attackHeld = false;
                }
                // ПКМ = вторая РУКА (two-hands.md): тот же гейт по окну,
                // что у ЛКМ — клик по сетке до боя не доходит.
                if (e.type == SDL_EVENT_MOUSE_BUTTON_DOWN &&
                    e.button.button == SDL_BUTTON_RIGHT &&
                    shell.window == UiWindow::None) {
                    rmbHeld = true;
                } else if (e.type == SDL_EVENT_MOUSE_BUTTON_UP &&
                           e.button.button == SDL_BUTTON_RIGHT) {
                    rmbHeld = false;
                }
                // МОГИЛА ЗАЖИМА-ВЗГЛЯДА НА ПКМ (приказ владельца 2026-08-31):
                // ПКМ — вторая РУКА (эпик двух рук, план two-hands.md),
                // взгляд остаётся тогглом Tab (mouselook-бинд).
                // Feed movement/look events unless the HUD wants the cursor (only
                // relevant when look is off — relative mode hides the cursor).
                if (input.mouselook() || !ImGui::GetIO().WantCaptureMouse)
                    input.handle_event(e);
            }
        }

        // --- console requests ---------------------------------------------
        // Drain the one-shot request bits ([console.h]) that bound keys, menu
        // buttons and typed console lines all set. The app performs each effect
        // HERE, at its safe point — the same client-proposes/server-disposes
        // seam the floor teleport rides.
        {
            using game::ConsoleRequest;
            const std::uint32_t reqs = consoleCtx.take_requests();
            auto has = [&](ConsoleRequest r) {
                return (reqs & game::request_bit(r)) != 0;
            };
            if (has(ConsoleRequest::Quit)) running = false;
            if (has(ConsoleRequest::Menu) &&
                (shell.screen == AppScreen::Playing || shell.screen == AppScreen::Pause)) {
                // Esc: открытое окно закрывается ПЕРВЫМ, пауза — вторым; один
                // источник истины делает порядок выразимым одной веткой.
                // Pausing frees the cursor so the menu is clickable and the OS
                // window can be moved / minimised; leaving re-arms mouselook.
                if (shell.playing() && shell.window != UiWindow::None) {
                    shell.close_window();
                    input.set_mouselook(true);
                    SDL_SetWindowRelativeMouseMode(window, true);
                } else {
                    shell.screen = shell.screen == AppScreen::Pause
                                       ? AppScreen::Playing
                                       : AppScreen::Pause;
                    if (shell.playing()) {
                        menuPage = 0;
                        rebindCapture = -1;
                    }
                    input.set_mouselook(shell.playing());
                    SDL_SetWindowRelativeMouseMode(window, shell.playing());
                }
            }
            if (has(ConsoleRequest::Hud)) showHud = !showHud;
            if (has(ConsoleRequest::Console)) {
                // Opening frees the cursor so the input line is clickable; the
                // '`' char itself is filtered in the InputText callback so the
                // toggle never types into its own console.
                showConsole = !showConsole;
                consoleFocus = showConsole;
                if (showConsole) {
                    input.set_mouselook(false);
                    SDL_SetWindowRelativeMouseMode(window, false);
                }
            }
            if (has(ConsoleRequest::Mouselook) && shell.playing()) {
                const bool on = !input.mouselook();
                input.set_mouselook(on);
                SDL_SetWindowRelativeMouseMode(window, on);
            }
            if (has(ConsoleRequest::Inventory)) {
                // Открытие освобождает курсор для клеток; закрытие возвращает
                // mouselook — сетка, в отличие от консоли, открывается по сто
                // раз за ран, и «верни взгляд руками» стало бы налогом.
                shell.toggle(UiWindow::Inventory);
                const bool giveMouse = shell.window == UiWindow::None;
                input.set_mouselook(giveMouse);
                SDL_SetWindowRelativeMouseMode(window, giveMouse);
            }
            // Floor travel (#8/#9): streams the destination in on demand and
            // folds the departed floor's crowd back into the cold pool, so only
            // ONE floor is ever live. The whole depart/arrive sequence is shared
            // with the console teleport — see do_ride above the loop.
            // Гейт liftRide: дев-поездка поверх лифтовой машины = два
            // перехода на двух слотах разом (та же причина, что у телепорта).
            if (has(ConsoleRequest::FloorDown) && shell.playing() &&
                liftRide == LiftRide::Idle)
                do_ride(/*absolute=*/false, -1);
            if (has(ConsoleRequest::FloorUp) && shell.playing() &&
                liftRide == LiftRide::Idle)
                do_ride(/*absolute=*/false, +1);
            // Fly stays a PlayerCommand button: the bridge queues the edge and
            // the server flips the state ([netcode-seam]).
            if (has(ConsoleRequest::Fly) && shell.playing()) input.queue_fly_toggle();
            // Survival / persistence / trade one-shots are recorded as INTENT
            // and acted on in the sim loop, exactly as before: they mutate pool
            // rows or world state, which belongs on the sim's clock, not the
            // window's. (Set even while paused so a menu button lands on the
            // first tick after resume rather than vanishing.)
            if (has(ConsoleRequest::Heal)) healWanted = true;
            if (has(ConsoleRequest::Eat)) eatWanted = true;
            if (has(ConsoleRequest::Relief)) reliefWanted = true;
            if (has(ConsoleRequest::Drink)) drinkWanted = true;
            if (has(ConsoleRequest::Possess)) possessWanted = true;
            if (has(ConsoleRequest::Save)) saveWanted = true;
            if (has(ConsoleRequest::Load)) loadWanted = true;
            if (has(ConsoleRequest::Scrap)) scrapWanted = true;
            if (has(ConsoleRequest::Elevator)) {
                shell.toggle(UiWindow::Elevator);
                if (shell.window != UiWindow::None) input.set_mouselook(false);
            }
            if (has(ConsoleRequest::Craft)) {
                craftWanted = true;
                shell.toggle(UiWindow::Craft);
                if (shell.window != UiWindow::None) input.set_mouselook(false);
            }
            // ATTR1: spend one unspent point. HP ptrs from the pool row so
            // STR immediately credits max-HP the same way award_xp does.
            if ((has(ConsoleRequest::AttrStr) || has(ConsoleRequest::AttrAgi) ||
                 has(ConsoleRequest::AttrInt)) &&
                reg.valid(player)) {
                if (auto* rs = reg.try_get<game::RpgStats>(player)) {
                    std::int16_t* hp = nullptr;
                    std::int16_t* maxHp = nullptr;
                    if (const game::NpcRef* nr =
                            reg.try_get<game::NpcRef>(player)) {
                        if (pool.valid(nr->id)) {
                            hp = &pool.hp(nr->id);
                            maxHp = &pool.max_hp(nr->id);
                        }
                    }
                    game::Attr which = game::Attr::Str;
                    const char* tag = "str";
                    if (has(ConsoleRequest::AttrAgi)) {
                        which = game::Attr::Agi;
                        tag = "agi";
                    } else if (has(ConsoleRequest::AttrInt)) {
                        which = game::Attr::Int;
                        tag = "int";
                    }
                    const bool ok = game::spend_attr_point(*rs, which, hp, maxHp);
                    std::fprintf(stderr,
                                 "[attr] spend %s ok=%d pts_left=%u "
                                 "str=%u agi=%u int=%u\n",
                                 tag, ok ? 1 : 0, rs->attrPoints,
                                 rs->attr[0], rs->attr[1], rs->attr[2]);
                }
            }
            // Z: pull the pin. One-shot like Interact — a held key would empty the
            // bag at the weapon's own cooldown, and a grenade is not an automatic.
            if (has(ConsoleRequest::Throw)) throwWanted = true;
            // Interact takes the job on offer — contract first, then quest if
            // no contract is pending. Both clear on take so a second press is
            // harmless. Quest accept refuses a dead giver or a chain gate;
            // contract_accept refuses the same. [quest.h, contract.h]
            if (has(ConsoleRequest::Interact)) {
                interactWanted = true;
                // Единая интеракция: дверь — такой же потребитель E, как
                // терминал/ящик (door_toggle_near no-op без проёма рядом).
                doorWanted = true;
                if (game::contract_accept(contracts, offer, ledger)) {
                    offer = game::Contract{};
                    offerLine[0] = 0;
                } else if (game::quest_valid(questOffer) &&
                           questOfferGiver != game::kInvalidNpc &&
                           game::quest_accept(quests, pool, questOffer,
                                              questOfferGiver, currentFloor,
                                              ledger)) {
                    questOffer = game::kInvalidQuest;
                    questOfferGiver = game::kInvalidNpc;
                    questOfferLine[0] = 0;
                }
            }
        }

        // The layer the player is currently on drives sim + render below.
        // activeLayer already defined at frame top

        // МИР-АВТОМАТ, шов кадра (ДО сим-писателей — порядок закон):
        // 1) apply_readback — страницы, что автомат вернул прошлым кадром,
        //    ложатся в CPU-канон: карв этого кадра режет уже СВЕЖУЮ воду
        //    (инкремент 3 — обратный поток байт-копией, отставание <= кадра);
        // 2) poll_activity — пробуждение соседей/усыпление по ActOut.
        // Смена слоя = live-набор указывает в старый мир — сброс.
        if (mediumPass.ready() && activeLayer != kInvalidLayer) {
            static LayerId mediumLayer = static_cast<LayerId>(~0u);
            if (mediumLayer != activeLayer) {
                mediumLayer = activeLayer;
                mediumPass.clear_live();
                big_judge_reset(); // очередь дел указывала в уехавший этаж
                mediumSubstepsDone = simTick / 4;
                // БУДИЛЬНИК ЭТАЖА (вердикт владельца 2026-08-27, «висячая
                // вода»): генераторный налив (pour_level падика) СПИТ с
                // рождения — не в списке автомата, и висячую воду в шахтах
                // не будит ничто (пуля ищет твёрдый атом и пролетает воду
                // насквозь — наблюдение владельца). При активации этажа
                // будим ВСЕ клетки с материей сред. Универсально через
                // агрегаты S16.4 (medium_level пишет сам генератор в
                // medium_recount) — будильник модуля не знает; вода с
                // опорой оседает в подтик и засыпает нутром, висячая —
                // честно падает автоматом на глазах. Скан 128³ один раз на
                // смену слоя, не на тик.
                {
                    World& mw = stack.layer(activeLayer);
                    const std::uint32_t* lvl = medium_level_data(mw);
                    static std::vector<std::uint32_t> wet;
                    wet.clear();
                    if (lvl)
                        for (std::uint32_t ci = 0; ci < kMacroCells; ++ci)
                            if (lvl[ci] != 0u) wet.push_back(ci);
                    if (!wet.empty()) {
                        mediumPass.wake_cells(wet.data(), wet.size(), mw,
                                              voxelMirror);
                        std::fprintf(stderr,
                                     "[medium] floor alarm: %zu cells with "
                                     "medium woken on layer switch\n",
                                     wet.size());
                    }
                    // ВХОДНАЯ РАЗВЁРТКА СУДЬИ (S20.5): единственный момент,
                    // когда судья бегает по среде. Автомат двигает только
                    // подвижную материю, а подвижное — не опора, значит ход
                    // автомата не может осиротить статику ПО ПОСТРОЕНИЮ —
                    // покадровый судья на изменениях масок был выброшен как
                    // избыточный (и дорогой: 27k бюджетных флудов за 2000
                    // кадров на floor 0). Остаются легаси-висяки старых
                    // миров «статик на куче» — их снимает один суд клеток с
                    // подвижной материей и их соседей на активации этажа.
                    {
                        static std::vector<std::uint32_t> mobileCells;
                        collect_mobile_support_cells(mw, mobileCells);
                        if (!mobileCells.empty()) {
                            static CarveScratch judgeScratch;
                            static CarveResult judgeResult;
                            const std::int32_t judged = detach_judge_cells(
                                mw, mobileCells.data(), mobileCells.size(),
                                judgeScratch, judgeResult);
                            std::fprintf(stderr,
                                         "[judge] entry sweep: %zu cells, "
                                         "%d converted\n",
                                         mobileCells.size(), judged);
                            if (judged > 0) {
                                voxelMirror.mark_dirty(
                                    judgeResult.dirtyCells.data(),
                                    judgeResult.dirtyCells.size());
                                mediumPass.wake_cells(
                                    judgeResult.dirtyCells.data(),
                                    judgeResult.dirtyCells.size(), mw,
                                    voxelMirror);
                                // Конверсия — писатель (S20.4): маска стоит,
                                // но МАТЕРИАЛ сменился на подвижный — якоря
                                // на конвертированном мертвы World-пробой,
                                // антураж и спящие тела платят тот же долг.
                                // Нав не трогаем: проходимость — от масок,
                                // они не менялись.
                                if (game::anchor_validate_step(
                                        reg, mw, activeLayer, bus,
                                        judgeResult.dirtyCells,
                                        &particleBursts, 0x5EEDBEEFu) > 0)
                                    propPassNeedsRebuild = true;
                                antourage_carve_step_here(
                                    judgeResult.dirtyCells, 0x5EEDBEEFu);
                                rigid_wake_dirty_cells(
                                    reg, activeLayer,
                                    judgeResult.dirtyCells.data(),
                                    judgeResult.dirtyCells.size());
                            }
                        }
                    }
                }
            }
            static std::vector<std::uint32_t> mediumMaskChanged;
            mediumMaskChanged.clear();
            const auto ctMedA = std::chrono::steady_clock::now();
            mediumPass.apply_readback(stack.layer(activeLayer), voxelMirror,
                                      &mediumMaskChanged);
            if (g_regrowWatch >= 2 && activeLayer != kInvalidLayer)
                regrow_check(stack.layer(activeLayer), voxelMirror, "шов",
                             simTick);
            g_mediumApplyMs = carve_ms_since(ctMedA);
            // Маски обломков (инкремент 5) едут с материей: изменённые
            // клетки — нав-долг тем же патчем, что у карва (O(1)/клетка):
            // по осевшему завалу ходят, дыра от уехавшего рубла проходима.
            if (!mediumMaskChanged.empty()) {
                nav.patch_carved_cells(stack.layer(activeLayer).grid(),
                                       mediumMaskChanged.data(),
                                       mediumMaskChanged.size());
                // Из якорного долга автомату остаётся ТОЛЬКО пробуждение
                // тел (S20.4-уточнение): подвижное — не опора (S20.5), так
                // что ход автомата не рвёт ни якоря, ни антураж по
                // построению; но ТЕЛО честно лежит и на куче — куча уехала,
                // спящий труп обязан проснуться и упасть.
                // Замер §59.11-пересмотра: сколько тел будит ИМЕННО автомат
                // (кандидат «водопады держат rigid бодрым» против «тело на
                // теле не касается мира и не спит»). Печать — rigid-stats.
                g_profMediumRigidWakes += rigid_wake_dirty_cells(
                    reg, activeLayer, mediumMaskChanged.data(),
                    mediumMaskChanged.size());
            }
            // Покадрового судьи связности на изменениях масок БОЛЬШЕ НЕТ
            // (S20.5, замер 2026-08-29): автомат двигает только подвижную
            // материю, подвижное — не опора, значит ход автомата не может
            // осиротить статику по построению. Легаси-висяки снимает
            // входная развёртка на активации этажа (блок будильника выше);
            // писатели статики (карв, дверь) судят своими развёртками.
            // poll_activity МЁРТВ: живой список и пробуждение строит сам GPU
            // (GPU-резидентная петля, решение владельца 2026-08-24).

            // БОЛЬШОЙ СУД (big-judge.md): порция флуда опоры или конверсии
            // кадром; конвертированные клетки качаются в зеркало и автомат
            // тем же швом, что entry-sweep (маски НЕ меняются — нав/свет/
            // якоря не должники конверсии; их долги придут mediumMaskChanged
            // когда автомат реально сдвинет рыхлое).
            // Порция суда переехала В СИМ-ЦИКЛ (2026-08-31, решение
            // владельца): кадровый темп привязывал скорость обрушения к fps
            // (60 порций/с на 60 fps, 30 на 30) — против закона каденса
            // S16.3 «в игре ничего не должно зависеть от кадра». Теперь
            // порция идёт на СИМ-ТИК (125 Гц) и стоит на паузе вместе с
            // миром. Размер порции — крутить ПО ЗАМЕРУ [prof] big-judge.
        }

        // --- fixed-step simulation ----------------------------------------
        // Frozen while the pause menu is up; drop accumulated time so resuming
        // does not fast-forward the missed interval.
        if (shell.sim_frozen()) {
            simAccum = 0.0f;
        } else {
            simAccum += frameDt;
            // The embodied AI steers against the live floor's baked danger field
            // ([diffusion.md]); it is null when the floor seeds none -> threat reads
            // 0 and no one flees, the scorer's stubbed-input stance ([ai.md]).
            // Fetched once per frame: the fixed loop below never (re)creates it.
            World& activeWorld = stack.layer(activeLayer);
            // `danger` is LIVE now: ai_panic_publish_step below writes panic into
            // the field through the driver, diffusion_tick sweeps it, and ai_step's
            // threat term reads a real number — the long-open §52 debt. The fetch
            // is re-done after diffusion_tick inside the loop, because the first
            // publish on a floor CREATES the field and this pre-loop pointer
            // predates it.
            const Field<float>* danger = activeWorld.fields().find<float>("danger");
            const MacroGrid& activeGrid = activeWorld.grid();
            int guard = 0;
            const auto profTickT0 = prof_now();
            while (simAccum >= kSimDt && guard++ < 8) {
                // Age the noise field ONCE per tick, at the top ([noise.h]). Everything
                // published later in this tick therefore gets a full tick of life before
                // it can expire, and investigate_step below reads a field that nothing has yet
                // mutated this tick — so a gunshot fired on tick N is investigated on
                // tick N+1 rather than racing the pass that fired it.
                const auto profNoiseT0 = prof_now();
                game::noise_step(noiseField,
                                 static_cast<std::uint32_t>(kSimDt * 1000.0f + 0.5f));
                prof_add(kProfNoise, profNoiseT0);
                // БОЛЬШОЙ СУД (big-judge.md): порция флуда опоры или
                // конверсии НА СИМ-ТИК (не на кадр — закон каденса S16.3;
                // переезд 2026-08-31). Конвертированные клетки качаются в
                // зеркало и автомат тем же швом, что entry-sweep.
                {
                    const auto profBigT0 = prof_now();
                    static std::vector<std::uint32_t> bigDirty;
                    bigDirty.clear();
                    big_judge_step(stack.layer(activeLayer), bigDirty);
                    if (!bigDirty.empty()) {
                        voxelMirror.mark_dirty(bigDirty.data(),
                                               bigDirty.size());
                        mediumPass.wake_cells(bigDirty.data(), bigDirty.size(),
                                              stack.layer(activeLayer),
                                              voxelMirror);
                        // ДОЛГИ ПИСАТЕЛЯ — зеркально entry-sweep (плейтест
                        // владельца 2026-08-31: лампы висели в пустоте после
                        // обрушения — конверсия меняет МАТЕРИАЛ на подвижный,
                        // якоря на нём мертвы World-пробой; антураж (провода/
                        // тряпки) и спящие тела платят тот же долг. Нав не
                        // трогаем: маски не менялись.
                        if (game::anchor_validate_step(
                                reg, stack.layer(activeLayer), activeLayer,
                                bus, bigDirty, &particleBursts,
                                0x5EEDBEEFu) > 0)
                            propPassNeedsRebuild = true;
                        antourage_carve_step_here(bigDirty, 0x5EEDBEEFu);
                        rigid_wake_dirty_cells(reg, activeLayer,
                                               bigDirty.data(),
                                               bigDirty.size());
                    }
                    prof_add(kProfBigJudge, profBigT0);
                }
                // While the console is OPEN, WASD is text, not movement: skip
                // the bridge and park the intent so the body does not glide on
                // the last pre-console wishDir. The open inventory grid owns
                // the keys the same way ([inventory.md]). showConsole, не
                // `showConsole && WantTextInput`: фокус слетает с поля после
                // Enter/клика по логу, и тело шло по WASD при открытой консоли.
                if (showConsole || shell.window != UiWindow::None) {
                    if (reg.valid(player))
                        if (auto* c = reg.try_get<Controller>(player))
                            c->wishDir = vec3{0, 0, 0};
                } else {
                    input.apply(reg, kSimDt);
                }
                // CARVE wall proof locomotion: input.apply clears wishDir from
                // keyboard (no keys in --shot), so face+walk MUST land after
                // apply and BEFORE controller_step consumes wishDir. The later
                // shotAction=="wall" block only holds attackHeld + logs.
                if (shotPath &&
                    (shotAction == "wall" || shotAction == "rpgcmbt") &&
                    reg.valid(player) &&
                    shotFramesSeen >= 30 && nav.ready()) {
                    const Transform& ptr = reg.get<Transform>(player);
                    const MacroGrid& g = stack.layer(activeLayer).grid();
                    const float cx = ptr.pos.x;
                    const float cy = ptr.pos.y;
                    const float cz = ptr.pos.z;
                    const float eyeZ = cz + 0.7f;
                    float bestD2 = 1.0e12f;
                    float bestDx = 0.0f, bestDy = 0.0f;
                    // Wider ring than melee reach so open-room spawns still
                    // find a wall; walk closes the gap (kPlayerWalkSpeed).
                    for (int pass = 0; pass < 2 && bestD2 >= 1.0e12f; ++pass) {
                        const float sampleZ =
                            pass == 0 ? eyeZ : (eyeZ - kCellSize);
                        const int gz =
                            static_cast<int>(sampleZ / kCellSize);
                        if (gz < 0 || gz >= kMacroDim) continue;
                        for (int ox = -8; ox <= 8; ++ox) {
                            for (int oy = -8; oy <= 8; ++oy) {
                                if (ox == 0 && oy == 0) continue;
                                const float px =
                                    cx + static_cast<float>(ox) * kCellSize;
                                const float py =
                                    cy + static_cast<float>(oy) * kCellSize;
                                const int gx = wrap_macro(
                                    static_cast<int>(px / kCellSize));
                                const int gy = wrap_macro(
                                    static_cast<int>(py / kCellSize));
                                if (g.cell(gx, gy, wrap_macro(gz)) ==
                                    kCellAir)
                                    continue;
                                const float dx =
                                    wrap_delta_f(cx, px, kWorldExtent);
                                const float dy =
                                    wrap_delta_f(cy, py, kWorldExtent);
                                const float d2 = dx * dx + dy * dy;
                                if (d2 < bestD2) {
                                    bestD2 = d2;
                                    bestDx = dx;
                                    bestDy = dy;
                                }
                            }
                        }
                    }
                    if (bestD2 < 1.0e12f) {
                        auto& cam = reg.get<CameraTag>(player);
                        // camera_forward / walk fwd: yaw=atan2(dy,dx) (Z-up).
                        cam.yaw = std::atan2(bestDy, bestDx);
                        cam.pitch = 0.0f;
                        if (auto* ctl = reg.try_get<Controller>(player)) {
                            // Walk старт и так дефолт (aim_player), но харнесс
                            // не должен зависеть от чужого дефолта: wall walk
                            // needs ground locomotion, спелим её явно.
                            ctl->fly = false;
                            // Always walk forward while out of unarmed reach
                            // (~1.9 m). wishDir.x is camera-local forward.
                            if (bestD2 > 1.2f * 1.2f)
                                ctl->wishDir = {1.0f, 0.0f, 0.0f};
                        }
                    }
                }
                // Embodied crowd (#12): needs decay, then the utility brain

                // re-plans (identity-staggered) and steers each NON-player body's
                // Velocity — BEFORE the controller/physics that integrate it, the
                // same locomotion path as the player ([ai.md], [npcs.md]).
                // PARKED: game::needs_step(reg, pool, kSimDt);  <- branch 3-arg call
                // main already steps the clock at line ~1043 with the layer-scoped
                // 4-arg signature and keeps its NeedsTick report for the HUD. The branch
                // call operated on its per-entity Needs COMPONENT; main keeps the
                // survival clock in the pool row, because the elevator destroys the body
                // and a component would reset the clock on every floor ride.
                // THE UTILITY AI, UNPARKED — and dormant, which is not the same as absent.
                //
                // It sat commented out because two systems writing Velocity fight every
                // tick. That is now settled by a TOKEN rather than by hope: `AiBrain::motion`
                // decides per body, and both foreign writers — wander_step and
                // faction_feud_step — carry `if (ai_owns_motion(reg, e)) continue;`.
                // MEASURED over 200 ticks x 24 bodies: ai_step wrote Velocity 2400 times,
                // wander_step 300, and BOTH in one tick ZERO times; wander wrote 0 times
                // while the token was held and 600 once delegated. [ai.h]
                //
                // `aiCfg.enabled` is TRUE and `aiMem` is passed every tick. Memory is the
                // demand column owned above; null would disable recall/record bit-for-bit.
                // `ai_init` attaches brains in finish_floor_nav; `ai_release` runs on floor
                // leave (do_ride + --shot travel) and again inside FloorStreamer::unload.
                // Clearing enabled mid-run without release would strand MotionOwner::Ai
                // and freeze bodies under wander_step — that trap is what AIMEM closes.
                // NOTE the `activeLayer` argument: the parked call was
                // `ai_step(reg, pool, danger, activeGrid, simNow, kSimDt)` against an older
                // SIX-argument signature with no layer, so it would not even have compiled
                // if anyone had uncommented it. That is what "parked until adapted" was
                // really hiding — a commented-out call is not a call, and nothing checks it.
                // §23 hermetic flee: doors + activeWorld let IntentFlee steer toward
                // door_nearest_shelter (sealed apartments) before −∇danger / memory.
                // Эрранды по виду комнаты умерли (rooms-object F) — комнатную
                // наводку интентов возвращает agent-goals скором S13.
                const auto profDiffT0 = prof_now();
                game::ai_panic_publish_step(reg, pool, diffusionDriver,
                                            activeWorld, activeLayer, kSimDt);
                diffusion_tick(diffusionDriver, activeWorld, activeLayer, simTick);
                prof_add(kProfDiffusion, profDiffT0);
                danger = activeWorld.fields().find<float>("danger");
                const auto profAiT0 = prof_now();
                aiTick = game::ai_step(reg, pool, danger, activeGrid, activeLayer, simNow,
                                       kSimDt, aiCfg, &aiMem, nullptr, &activeWorld);
                // Intent first, wardrobe second: the equip DECIDER re-scores
                // each body's bag on its own staggered slot. [ai.h] [equip.h]
                game::ai_equip_step(reg, pool, activeLayer, simTick);
                prof_add(kProfAi, profAiT0);
                // AIMEM proof trail: once nav has brains and AI is on, emit a
                // compact stderr pulse so a --shot harness can assert the store
                // is live (rows/writes/recalled) without parsing the HUD.
                if (aiCfg.enabled && (lastAimemLogTick == ~0ull ||
                                     simTick - lastAimemLogTick >= 60ull)) {
                    lastAimemLogTick = simTick;
                    // Эрранд-половина пульса умерла с flow-полями (rooms-object F).
                    std::fprintf(stderr,
                                 "[aimem] STEP tick=%llu layer=%u seen=%u replan=%u "
                                 "own_ai=%u own_wander=%u "
                                 "recall=%u filed=%u fled=%u "
                                 "rows=%u writes=%u coal=%u evict=%u bytes=%zu\n",
                                 static_cast<unsigned long long>(simTick),
                                 static_cast<unsigned>(activeLayer),
                                 aiTick.considered, aiTick.replanned,
                                 aiTick.aiOwned, aiTick.wanderOwned,
                                 aiTick.recalled, aiTick.remembered,
                                 aiTick.memoryFled, aiMem.rows(),
                                 aiMem.writes(), aiMem.coalesced(),
                                 aiMem.evictions(), aiMem.resident_bytes());
                    // THE HISTOGRAM IS THE ACCEPTANCE NUMBER, not own_ai alone.
                    // [problems.md] §27's diagnosis is that the crowd's argmax is a
                    // pure function of (faction, id) and therefore CONSTANT IN
                    // TIME; a histogram that moves between two of these lines is
                    // the evidence that the scorer became a decision. Printed on
                    // the same 60-tick cadence so a --shot harness can diff two.
                    char intents[256];
                    int at = 0;
                    for (std::uint8_t i = 0; i < game::kIntentCount; ++i) {
                        if (aiTick.byIntent[i] == 0) continue;
                        at += std::snprintf(intents + at,
                                            sizeof(intents) - static_cast<std::size_t>(at),
                                            " %s=%u", game::kIntentName[i],
                                            aiTick.byIntent[i]);
                        if (at >= static_cast<int>(sizeof(intents)) - 1) break;
                    }
                    std::fprintf(stderr, "[aimem] INTENT tick=%llu%s\n",
                                 static_cast<unsigned long long>(simTick), intents);
                }
                const auto profCtlT0 = prof_now();
                controller_step(reg, kSimDt, &activeWorld.gravity());
                prof_add(kProfController, profCtlT0);
                // Steer the crowd BEFORE physics: wander writes horizontal
                // velocity, physics integrates it and resolves collision.
                // Банк тикает ЗДЕСЬ же: bank_open идемпотентен по (этаж, сид)
                // и потому зовётся каждый тик — у travel-сайтов главного цикла
                // уже дважды ловили «починили один из двух» ([economy.h] сама
                // рекомендует эту проводку); bank_step O(1) и почти всегда
                // выходит сразу. Закрывает запись §52 в check_wired.
                game::bank_open(bankAcct, currentFloor, 0xBA4B5EEDu);
                {
                    const game::BankTick bt = game::bank_step(bankAcct, simTick);
                    if (bt.earned || bt.paid)
                        std::fprintf(stderr,
                                     "[bank] period: +%d earned, -%d paid, "
                                     "deposit %lld, debt %lld\n",
                                     bt.earned, bt.paid,
                                     static_cast<long long>(bankAcct.deposit),
                                     static_cast<long long>(
                                         game::bank_debt(bankAcct)));
                }

                // Samosbor advances HERE — after controller_step, before
                // wander_step — for the three reasons in [samosbor.h]: the seal can
                // kill and must precede finalize_deaths by a whole tick; behaviour
                // systems must never read a stale phase; and anything spawned on a
                // transition needs physics in the same tick.
                {
                    const game::SamosborTransition tr_ =
                        game::samosbor_step(samosbor,
                                            static_cast<std::uint32_t>(
                                                kSimDt * 1000.0f + 0.5f),
                                            currentFloor, sbRng);
                    if (tr_.cycleEnded) ++samosborCycles;
                    // PRINT THE NUMBER EVERY RUN ([AGENTS.md] §Measure). The central
                    // crisis mechanic printed NOTHING to stderr — not a phase change,
                    // not a variant, not the count — so "did a samosbor happen in that
                    // run?" was unanswerable outside the HUD, and every claim about the
                    // clock (including the two silent defects fixed at the ride sites)
                    // had to be argued from the source instead of read off a log. One
                    // line per TRANSITION, not per tick: transitions are rare by design
                    // (>= 45 s apart at the floor), so this cannot flood.
                    if (tr_.warningBegan || tr_.activeBegan || tr_.activeEnded ||
                        tr_.cycleEnded) {
                        std::fprintf(stderr,
                                     "[samosbor] tick=%llu floor=%d phase=%u variant=%u "
                                     "count=%u cycles=%u %s%s%s%s\n",
                                     static_cast<unsigned long long>(simTick),
                                     currentFloor,
                                     static_cast<unsigned>(samosbor.phase),
                                     static_cast<unsigned>(samosbor.variant),
                                     static_cast<unsigned>(samosbor.count),
                                     static_cast<unsigned>(samosborCycles),
                                     tr_.warningBegan ? "WARNING " : "",
                                     tr_.activeBegan ? "ACTIVE " : "",
                                     tr_.activeEnded ? "ENDED " : "",
                                     tr_.cycleEnded ? "CYCLE " : "");
                    }
                    // The seal is ONE SHOT, not a per-tick drain. Modelled as a DoT a
                    // 15-minute samosbor at |z|=50 would deal 3600 damage instead of
                    // 4 — the correction that mattered most in the port.
                    if (tr_.sealed && reg.valid(player)) {
                        bool playerSheltered = false;
                        // МОГИЛА ДВЕРЕЙ (2026-08-28). Гермо-укрытий нет — новая дверь вернёт их своим законом.
                        if (!playerSheltered) {
                            const game::SamosborPressure sp =
                                game::samosbor_unsheltered_pressure(
                                    static_cast<game::SamosborVariant>(samosbor.variant));
                            const game::DamageResult dr_ = game::apply_damage(
                                reg, pool, player, sp.hpDamage,
                                game::DamageChannel::Kinetic, player);
                            samosborDamage =
                                static_cast<std::int16_t>(samosborDamage + dr_.applied);
                            if (auto* rpg = reg.try_get<game::RpgStats>(player)) {
                                if (sp.psiDamage > 0) {
                                    rpg->psi = rpg->psi > static_cast<std::uint16_t>(sp.psiDamage)
                                                   ? static_cast<std::uint16_t>(rpg->psi - sp.psiDamage)
                                                   : 0u;
                                }
                            }
                        }
                    }
                }
                // Exhaustion costs movement speed, not HP — three stacking HP
                // drains is a death spiral with no decision in it. Applied to the
                // live Controller each tick rather than baked into it, so recovering
                // sleep restores the speed with nothing to remember. [needs.h]
                // Status content layer: age slots, then fold move mult into the
                // Controller before controller_step's writers are overridden next
                // tick. Root forces moveSpeed 0 (Paupsina leading window).
                // Needs exhaustion and status multiply — both bite.
                if (reg.valid(player)) {
                    const std::uint32_t dtMs =
                        static_cast<std::uint32_t>(kSimDt * 1000.0f + 0.5f);
                    game::status_step(playerStatus, dtMs);
                    if (auto* ctl_ = reg.try_get<Controller>(player)) {
                        float sm = game::status_move_mult_e3(playerStatus) / 1000.0f;
                        if (game::status_is_rooted(playerStatus))
                            sm = 0.0f;
                        // ENCUMBRANCE joins the SAME chain as hunger, exhaustion
                        // and status rather than becoming a second writer of
                        // moveSpeed — one place folds every movement multiplier
                        // together, which is the only reason they cannot fight.
                        ctl_->moveSpeed = kPlayerWalkSpeed * needs.speedScale * sm *
                                          encumbrance.playerEffect.speedScale;
                        // AGIMV: AGI multiplies walk speed (linear +1%/pt).
                        if (const game::RpgStats* rs =
                                reg.try_get<game::RpgStats>(player)) {
                            ctl_->moveSpeed *=
                                game::agi_move_speed_mult_e3(*rs) / 1000.0f;
                        }
                    }
                    // Periodic proof trail while anything is up.
                    if (lastStatusLogTick != simTick && (simTick % 60u) == 0u) {
                        const bool any =
                            game::status_active(playerStatus,
                                                game::StatusId::ZhelemishSkin) ||
                            game::status_active(playerStatus,
                                                game::StatusId::PaupsinaWeb) ||
                            game::status_active(playerStatus,
                                                game::StatusId::SporeHaze) ||
                            game::status_active(playerStatus,
                                                game::StatusId::GovnyakRelief) ||
                            game::status_active(playerStatus,
                                                game::StatusId::GovnyakCough) ||
                            game::status_active(playerStatus,
                                                game::StatusId::GovnyakDebt);
                        if (any) {
                            lastStatusLogTick = simTick;
                            std::fprintf(
                                stderr,
                                "[status] tick move_e3=%u aim_e3=%u melee_e3=%u "
                                "rooted=%d zh=%u web=%u spore=%u\n",
                                game::status_move_mult_e3(playerStatus),
                                game::status_aim_mult_e3(playerStatus),
                                game::status_melee_mult_e3(playerStatus),
                                game::status_is_rooted(playerStatus) ? 1 : 0,
                                playerStatus.remainMs[static_cast<std::size_t>(
                                    game::StatusId::ZhelemishSkin)],
                                playerStatus.remainMs[static_cast<std::size_t>(
                                    game::StatusId::PaupsinaWeb)],
                                playerStatus.remainMs[static_cast<std::size_t>(
                                    game::StatusId::SporeHaze)]);
                        }
                    }
                }
                if (shotPath) {
                    if (shotOrbit && reg.valid(player)) {
                        auto& cam = reg.get<CameraTag>(player);
                        cam.yaw += 0.015f;
                    }
                    // attack stays held every tick (like LMB); interact is
                    // one-shot-per-tick like E. save/load fire ONCE after all
                    // --ride hops have landed so the snapshot is the deep floor,
                    // not the hub. shotFramesSeen is presented-frame count and
                    // lags sim ticks; rides fire at presented % 420 == 0.
                    if (shotAction == "rpgcmbt" && reg.valid(player)) {
                        // RPGCMBT-SHOT: force a loud sheet so scaled melee
                        // is visible in stderr + HUD (random_rpg is modest).
                        static bool rpgcmbtSheet = false;
                        if (!rpgcmbtSheet) {
                            game::RpgStats sheet = game::fresh_rpg(10);
                            sheet.attr[0] = 20;  // STR
                            sheet.attr[1] = 20;  // AGI
                            sheet.attr[2] = 5;   // INT
                            sheet.attrPoints = 3;
                            sheet.psi = game::max_psi(sheet);
                            reg.emplace_or_replace<game::RpgStats>(player,
                                                                   sheet);
                            // Credit STR max-HP onto the pool row.
                            if (const game::NpcRef* nr =
                                    reg.try_get<game::NpcRef>(player)) {
                                if (pool.valid(nr->id)) {
                                    const std::int16_t mh =
                                        static_cast<std::int16_t>(
                                            game::max_hp(sheet));
                                    pool.max_hp(nr->id) = mh;
                                    if (pool.hp(nr->id) < mh)
                                        pool.hp(nr->id) = mh;
                                }
                            }
                            rpgcmbtSheet = true;
                            std::fprintf(stderr,
                                         "[rpgcmbt] forced sheet "
                                         "lvl=%u str=%u agi=%u int=%u\n",
                                         sheet.level, sheet.attr[0],
                                         sheet.attr[1], sheet.attr[2]);
                        }
                        // Hold attack every tick (same as wall/attack).
                        attackHeld = true;
                    } else if (shotAction == "mag" && reg.valid(player)) {
                        // MAGSHOT: live proof that PlayerRanged.magCount survives
                        // elevator body-swap under --shot --ride. Unit pin owns the
                        // pure seam (test_elevator FOR1/MAG1); this stamps a
                        // distinctive partial mag + gun so the HUD gun line and
                        // stderr can show the same count after each hop.
                        static bool magForced = false;
                        static int magLastRideLog = -1;
                        static std::uint16_t magStamp = 7;
                        static game::ItemId magGun = game::kInvalidItem;
                        if (!magForced) {
                            game::ItemId gun = game::kInvalidItem;
                            for (game::ItemId i = 1; i <= game::kItemCount; ++i) {
                                if (const game::RangedDef* d =
                                        game::ranged_for_item(i)) {
                                    if (d->pellets == 1 && d->magazine >= 8 &&
                                        d->dmg >= 20) {
                                        gun = i;
                                        break;
                                    }
                                }
                            }
                            if (gun == game::kInvalidItem) {
                                std::fprintf(stderr, "[mag] FORCE FAIL no gun\n");
                                magForced = true;
                            } else if (const game::NpcRef* nr =
                                           reg.try_get<game::NpcRef>(player)) {
                                if (pool.valid(nr->id)) {
                                    const game::RangedDef& def =
                                        *game::ranged_for_item(gun);
                                    game::Inventory& inv = pool.inventory(nr->id);
                                    inv.slots[0] = game::ItemSlot{gun, 1};
                                    inv.slots[1] = game::ItemSlot{def.ammo, 30};
                                    game::PlayerRanged pr{};
                                    pr.hand[0].cooldownMs = 0;
                                    pr.hand[0].reloadMs = 0;
                                    pr.hand[0].magCount = magStamp;
                                    pr.hand[0].weapon = gun;
                                    pr.shots = 42;
                                    pr.hits = 13;
                                    reg.emplace_or_replace<game::PlayerRanged>(
                                        player, pr);
                                    magGun = gun;
                                    magForced = true;
                                    std::fprintf(stderr,
                                                 "[mag] FORCE gun=%u name=%s "
                                                 "mag=%u/%u shots=%u hits=%u\n",
                                                 static_cast<unsigned>(gun),
                                                 game::item_name(gun),
                                                 static_cast<unsigned>(pr.hand[0].magCount),
                                                 static_cast<unsigned>(def.magazine),
                                                 pr.shots, pr.hits);
                                }
                            }
                        }
                        // Log once per completed ride (and once at force with done=0).
                        if (magForced && shotRideDone != magLastRideLog) {
                            magLastRideLog = shotRideDone;
                            const game::PlayerRanged* pr =
                                reg.try_get<game::PlayerRanged>(player);
                            const unsigned mag =
                                pr ? static_cast<unsigned>(pr->hand[0].magCount)
                                   : 0u;
                            const unsigned wpn =
                                pr ? static_cast<unsigned>(pr->hand[0].weapon)
                                   : 0u;
                            const unsigned sh = pr ? pr->shots : 0u;
                            const unsigned hi = pr ? pr->hits : 0u;
                            const int ok =
                                (pr && pr->hand[0].magCount == magStamp &&
                                 pr->hand[0].weapon == magGun &&
                                 pr->shots == 42u &&
                                 pr->hits == 13u)
                                    ? 1
                                    : 0;
                            std::fprintf(stderr,
                                         "[mag] RIDE done=%d has=%d mag=%u "
                                         "weapon=%u shots=%u hits=%u ok=%d\n",
                                         shotRideDone, pr ? 1 : 0, mag, wpn, sh,
                                         hi, ok);
                        }
                    } else if (shotAction == "attack") {
                        attackHeld = true;
                    } else if (shotAction == "interact") {
                        interactWanted = true;
                    } else if (shotAction == "grenade" && reg.valid(player) &&
                               shotFramesSeen >= 30) {
                        // GRENSHOT — the live half of the grenade proof, and the one
                        // reading that cannot be argued with from a comment: the
                        // player throws AT HIS OWN FEET and the log has to show his
                        // own HP going down.
                        //
                        // Automates the stock and the aim only. The throw runs through
                        // the real `player_throw_step`, the flight and the blast
                        // through the real `projectile_step`, and the hole through the
                        // real `carve_sphere` — the [carve] COMBAT line a few hundred
                        // lines down prints it.
                        static bool grenForced = false;
                        static bool grenThrown = false;
                        static std::int16_t grenHpBefore = 0;
                        if (!grenForced) {
                            game::ItemId gid = game::kInvalidItem;
                            for (game::ItemId i = 1; i <= game::kItemCount; ++i)
                                if (const game::RangedDef* d =
                                        game::ranged_for_item(i))
                                    if (game::ranged_is_explosive(*d) &&
                                        game::ranged_is_thrown(i)) { gid = i; break; }
                            if (gid == game::kInvalidItem) {
                                std::fprintf(stderr, "[gren] FORCE FAIL no throwable\n");
                                grenForced = true;
                            } else if (const game::NpcRef* nrg =
                                           reg.try_get<game::NpcRef>(player)) {
                                if (pool.valid(nrg->id)) {
                                    const game::RangedDef& gd =
                                        *game::ranged_for_item(gid);
                                    pool.inventory(nrg->id).slots[0] =
                                        game::ItemSlot{gid, 3};
                                    grenForced = true;
                                    const game::PropDef& gp = game::prop_def(
                                        static_cast<game::PropId>(
                                            gd.thrownPropId));
                                    std::fprintf(
                                        stderr,
                                        "[gren] FORCE item=%u name=%s dmg=%d "
                                        "blast=%.1f m fuse=%.1f s (ВВ %u г)\n",
                                        static_cast<unsigned>(gid),
                                        game::item_name(gid),
                                        static_cast<int>(
                                            game::charge_dmg(gp.explosiveG)),
                                        game::charge_radius_m(gp.explosiveG),
                                        gd.fuseDs * 0.1f,
                                        static_cast<unsigned>(gp.explosiveG));
                                }
                            }
                        }
                        if (grenForced && !grenThrown) {
                            // Look down. "Кидай и прячься" without the second half.
                            auto& gcam = reg.get<CameraTag>(player);
                            gcam.pitch = -1.5f;
                            std::int16_t mx = 0;
                            game::entity_health(reg, pool, player, grenHpBefore, mx);
                            throwWanted = true;
                            grenThrown = true;
                            std::fprintf(stderr,
                                         "[gren] THROW at own feet, hp before=%d/%d\n",
                                         grenHpBefore, mx);
                        } else if (grenThrown) {
                            // One line per frame until the fuse ends it, so the drop
                            // is visible as a NUMBER and at a readable moment.
                            std::int16_t hp = 0, mx = 0;
                            static bool grenReported = false;
                            if (!grenReported &&
                                game::entity_health(reg, pool, player, hp, mx) &&
                                hp < grenHpBefore) {
                                grenReported = true;
                                std::fprintf(
                                    stderr,
                                    "[gren] OWN BLAST hp %d -> %d (took %d) — "
                                    "осколки бьют и владельца\n",
                                    grenHpBefore, hp,
                                    static_cast<int>(grenHpBefore - hp));
                            }
                        }
                    } else if (shotAction == "corp" && reg.valid(player) &&
                               shotFramesSeen >= 30) {
                        // CORPSHOT: face nearest live mob, hold attack
                        // (real player_melee_step), then once a Corpse is in
                        // loot reach press E (real loot_corpse_interact).
                        // Automates facing/phase only — no fake loot path.
                        const vec3 ppos = reg.get<Transform>(player).pos;
                        bool corpseNear = false;
                        for (auto cEnt :
                             reg.view<const game::Corpse, const Transform>()) {
                            if (reg.get<const Transform>(cEnt).layer !=
                                activeLayer)
                                continue;
                            const vec3& cpos =
                                reg.get<const Transform>(cEnt).pos;
                            if (wrap_dist2(ppos, cpos, kWorldExtent) <
                                2.2f * 2.2f) {
                                corpseNear = true;
                                break;
                            }
                        }
                        // One real E press after the kill. Holding interact every
                        // tick re-fires loot_corpse_interact on an empty searched
                        // corpse and floods stderr with TAKEN 0 ITEMS.
                        if (corpseNear && !shotActionConsumed) {
                            interactWanted = true;
                            std::fprintf(stderr,
                                         "[corp] corpse in reach — "
                                         "interact\n");
                            shotActionConsumed = true;
                        } else if (!corpseNear) {
                            Entity bestMob = entt::null;
                            float bestD2 = 1.0e12f;
                            vec3 bestPos{};
                            for (auto me :
                                 reg.view<const game::MobRef,
                                          const Transform>()) {
                                if (reg.all_of<game::Dead>(me)) continue;
                                const Transform& tr =
                                    reg.get<const Transform>(me);
                                if (tr.layer != activeLayer) continue;
                                const float d2 =
                                    wrap_dist2(ppos, tr.pos, kWorldExtent);
                                if (d2 < bestD2) {
                                    bestD2 = d2;
                                    bestMob = me;
                                    bestPos = tr.pos;
                                }
                            }
                            if (bestMob != entt::null) {
                                auto& cam = reg.get<CameraTag>(player);
                                const float dx = wrap_delta_f(
                                    ppos.x, bestPos.x, kWorldExtent);
                                const float dz = wrap_delta_f(
                                    ppos.z, bestPos.z, kWorldExtent);
                                cam.yaw = std::atan2(dx, dz);
                                cam.pitch = -0.15f;
                                if (bestD2 > 1.5f * 1.5f) {
                                    if (auto* ctl =
                                            reg.try_get<Controller>(player)) {
                                        const float len =
                                            std::sqrt(bestD2);
                                        if (len > 1e-3f) {
                                            ctl->wishDir = vec3{
                                                dx / len, 0.0f, dz / len};
                                        }
                                    }
                                }
                                attackHeld = true;
                                static int corpAtkLog = 0;
                                if ((corpAtkLog++ % 120) == 0) {
                                    std::fprintf(
                                        stderr,
                                        "[corp] attack mob d=%.2f "
                                        "floor=%d\n",
                                        std::sqrt(bestD2), currentFloor);
                                }
                            } else if ((simTick % 240u) == 0u) {
                                std::fprintf(stderr,
                                             "[corp] no live mob on layer "
                                             "(floor %d)\n",
                                             currentFloor);
                            }
                        }
                    } else if (shotAction == "wall" && reg.valid(player) &&
                               shotFramesSeen >= 30 && nav.ready()) {
                        // Face+walk owned by early block (post-input.apply,
                        // pre-controller_step). Here: hold melee + log only.
                        attackHeld = true;
                        static int wallLog = 0;
                        if ((wallLog++ % 120) == 0) {
                            const Transform& ptr = reg.get<Transform>(player);
                            const MacroGrid& g =
                                stack.layer(activeLayer).grid();
                            const float cx = ptr.pos.x;
                            const float cy = ptr.pos.y;
                            const float cz = ptr.pos.z;
                            const float eyeZ = cz + 0.7f;
                            float bestD2 = 1.0e12f;
                            for (int pass = 0; pass < 2 && bestD2 >= 1.0e12f;
                                 ++pass) {
                                const float sampleZ =
                                    pass == 0 ? eyeZ : (eyeZ - kCellSize);
                                const int gz =
                                    static_cast<int>(sampleZ / kCellSize);
                                if (gz < 0 || gz >= kMacroDim) continue;
                                for (int ox = -8; ox <= 8; ++ox) {
                                    for (int oy = -8; oy <= 8; ++oy) {
                                        if (ox == 0 && oy == 0) continue;
                                        const float px =
                                            cx + static_cast<float>(ox) *
                                                     kCellSize;
                                        const float py =
                                            cy + static_cast<float>(oy) *
                                                     kCellSize;
                                        const int gx = wrap_macro(
                                            static_cast<int>(px / kCellSize));
                                        const int gy = wrap_macro(
                                            static_cast<int>(py / kCellSize));
                                        if (g.cell(gx, gy, wrap_macro(gz)) ==
                                            kCellAir)
                                            continue;
                                        const float dx = wrap_delta_f(
                                            cx, px, kWorldExtent);
                                        const float dy = wrap_delta_f(
                                            cy, py, kWorldExtent);
                                        const float d2 = dx * dx + dy * dy;
                                        if (d2 < bestD2) bestD2 = d2;
                                    }
                                }
                            }
                            const bool fly =
                                reg.all_of<Controller>(player)
                                    ? reg.get<Controller>(player).fly
                                    : false;
                            std::fprintf(
                                stderr,
                                "[wall] melee toward solid d=%.2f "
                                "floor=%d baking=%d fly=%d\n",
                                bestD2 < 1.0e12f ? std::sqrt(bestD2)
                                                 : -1.0f,
                                currentFloor,
                                nav.baking() ? 1 : 0, fly ? 1 : 0);
                        }
                    } else if (!shotActionConsumed && shotAction == "carve" &&

                               shotFramesSeen >= 30 && nav.ready()) {
                        // One demolition charge ahead of the camera, once the
                        // nav bake has landed — the same request path the
                        // console `carve` row sets, so the screenshot
                        // exercises the real seam ([world/destruct.h]).
                        consoleCtx.carveRadius = 1.5f;
                        consoleCtx.carvePower = 0xFFFF;
                        shotActionConsumed = true;
                    } else if (!shotActionConsumed && shotAction == "status" &&

                               shotFramesSeen >= 30) {
                        // STATUS proof: land two authored rows so move_e3 drops
                        // below 1000 and rooted becomes true for Paupsina's
                        // leading window. Real status_apply path, not a mock.
                        game::status_apply(playerStatus,
                                           game::StatusId::ZhelemishSkin,
                                           /*useAlt=*/false);
                        game::status_apply(playerStatus,
                                           game::StatusId::PaupsinaWeb,
                                           /*useAlt=*/false);
                        std::fprintf(
                            stderr,
                            "[status] APPLY zh+web move_e3=%u rooted=%d "
                            "zh_ms=%u web_ms=%u\n",
                            game::status_move_mult_e3(playerStatus),
                            game::status_is_rooted(playerStatus) ? 1 : 0,
                            playerStatus.remainMs[static_cast<std::size_t>(
                                game::StatusId::ZhelemishSkin)],
                            playerStatus.remainMs[static_cast<std::size_t>(
                                game::StatusId::PaupsinaWeb)]);
                        shotActionConsumed = true;
                    } else if (!shotActionConsumed &&
                               (shotAction == "save" || shotAction == "load") &&
                               shotRideDone >= shotRide &&
                               shotFramesSeen >= 30) {
                        if (shotAction == "save") {
                            saveWanted = true;
                            shotActionConsumed = true;
                        } else {
                            // F9 отменяет бейк сам ([game/rebake.h]) — ждать
                            // нечего, loadWanted не застревает.
                            loadWanted = true;
                            shotActionConsumed = true;
                        }
                    }
                }
                // Patrol BEFORE wander, and the order is the arbitration: patrol
                // claims its bodies (MotionOwner::Ai) and wander's ai_owns_motion
                // guard then skips them — one Velocity writer per body per tick.
                // Runs on the same baked nav wander reads; while the bake is in
                // flight the flow is empty and patrol bodies wander like everyone.
                const auto profWanderT0 = prof_now();
                game::ai_patrol_step(reg, nav.coarse(), nav.fine(), activeLayer,
                                     kSimDt, &activeWorld.gravity());
                game::wander_step(reg, stack.layer(activeLayer).grid(), pool,
                                  nav.coarse(),
                                  nav.fine(), activeLayer, simTick,
                                  &activeWorld.gravity());
                prof_add(kProfWander, profWanderT0);

                // Шаги игрока БОЛЬШЕ НЕ ЗДЕСЬ. Их публикует encumbrance_step —
                // один закон на все тела, камера включительно (игрок = NPC), с
                // гейтом grounded: прыжок и полёт не топают. Этот блок был
                // особым игроцким паблишером без проверки земли — звук шагов
                // в воздухе, пойманный плейтестом владельца 2026-08-17, и
                // повод записать правило «звук — производная физики, не
                // ввода» в [AGENTS.md].

                // Sound overrides sight's absence: a mob with no visible prey that
                // heard something recently walks at the sound instead of at a random
                // lattice node. Purely additive on top of wander_step and it returns
                // before touching an entity when the field is quiet, which is almost
                // every tick. [investigate.h]
                // Добейк шаров акустики свежим шумам (G): один системный шаг,
                // писатели шума об акустике не знают. После него слух этого
                // тика отвечает по скелету — стены глушат.
                const auto profAcoustT0 = prof_now();
                game::noise_acoustics_step(*noiseAcoustics, noiseField,
                                           stack.layer(activeLayer),
                                           activeLayer);
                heardMobs = game::investigate_step(reg, noiseField, pool, activeLayer,
                                                   simTick, noiseAcoustics.get());
                prof_add(kProfAcoustics, profAcoustT0);

                // --- PER-TICK SPECIAL MONSTER TRAITS & ABILITIES ---
                for (auto me_ : reg.view<game::MobRef, Transform, Velocity>()) {
                    Transform& tr = reg.get<Transform>(me_);
                    if (tr.layer != activeLayer) continue;
                    game::MobRef& mr = reg.get<game::MobRef>(me_);
                    const auto kind = static_cast<game::MobKind>(mr.kind);

                    // 1. Wet Regeneration (Lotochnik, etc.)
                    const float regenRate = game::trait_wet_regen_hps(mr.kind);
                    if (regenRate > 0.0f && (simTick % 16 == 0)) {
                        const std::uint32_t* mediumData =
                            giga::medium_level_data(stack.layer(activeLayer));
                        if (game::pos_wet(mediumData, tr.pos)) {
                            mr.hp = std::min<std::int16_t>(mr.maxHp, mr.hp + static_cast<std::int16_t>(regenRate * 0.13f + 0.5f));

                        }
                    }

                    // 2. Lampoglaz Flash Blinding Ability
                    if (kind == game::MobKind::Lampoglaz) {
                        if ((simTick + entt::to_integral(me_)) % 250 == 0) {

                            game::NoiseProfile flashNoise{14.0f, 1800, 2, game::NoiseSource::Door};
                            game::noise_publish(noiseField, activeLayer, tr.pos, flashNoise, static_cast<std::uint32_t>(entt::to_integral(me_)));
                            if (reg.valid(player)) {
                                const vec3& ppos = reg.get<Transform>(player).pos;
                                if (wrap_dist2(tr.pos, ppos, kWorldExtent) <
                                    14.0f * 14.0f) {
                                    game::apply_slow(reg, player, 0.40f, 1200);
                                }
                            }
                        }
                    }

                    // 3. SporeCarpet / Meat-Spore Acid Cloud Hazard Pass
                    if (kind == game::MobKind::SporeCarpet) {
                        if ((simTick + entt::to_integral(me_)) % 40 == 0) {

                            if (reg.valid(player)) {
                                const vec3& ppos = reg.get<Transform>(player).pos;
                                if (wrap_dist2(tr.pos, ppos, kWorldExtent) <
                                    2.15f * 2.15f) {
                                    game::apply_damage(reg, pool, player, 4, game::DamageChannel::Fire, me_, &activeGrid);
                                    // Content layer: SporeHaze. Gate = ip4_gasmask
                                    // present in inventory (alt column shortens).
                                    bool hasGasmask = false;
                                    if (const auto* nr =
                                            reg.try_get<game::NpcRef>(player)) {
                                        if (pool.valid(nr->id)) {
                                            const game::Inventory& inv =
                                                pool.inventory(nr->id);
                                            const game::ItemId gate =
                                                game::status_def(
                                                    game::StatusId::SporeHaze)
                                                    .gateItem;
                                            if (gate != 0) {
                                                for (const auto& sl : inv.slots) {
                                                    if (sl.item == gate) {
                                                        hasGasmask = true;
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    game::status_apply(playerStatus,
                                                       game::StatusId::SporeHaze,
                                                       hasGasmask);
                                }
                            }
                        }
                    }

                    // 4. Stalker / TonkayaTen Cloaking Tint Modulation.
                    // The tell is LATERAL movement, so the vertical component comes
                    // off via the gravity vector rather than a fixed axis. With the
                    // old x^2+z^2 a Ten drifting along one real horizontal axis read
                    // as motionless and stayed cloaked — the player's counterplay
                    // (spot it while it moves) silently did not exist on that axis.
                    if (kind == game::MobKind::TonkayaTen || kind == game::MobKind::GlubinnayaTen) {
                        if (Renderable* rend = reg.try_get<Renderable>(me_)) {
                            const Velocity& vel = reg.get<Velocity>(me_);
                            const vec3 tg =
                                stack.layer(activeLayer).gravity().at(reg.get<Transform>(me_).pos);
                            const float tgLen = length(tg);
                            vec3 tlat = vel.v;
                            if (tgLen > 1e-6f) {
                                const vec3 tup = tg * (-1.0f / tgLen);
                                tlat = tlat - tup * dot(tlat, tup);
                            }
                            const float spd = std::sqrt(dot(tlat, tlat));
                            const float alpha = (spd > 0.5f) ? 0.85f : 0.15f;
                            rend->color = vec3{0.20f * alpha, 0.30f * alpha, 0.40f * alpha};

                        }
                    }


                }
                // NPC-vs-NPC: bodies holding a staggered fight licence steer at their
                // nearest enemy and swing when it is in reach. Placed AFTER wander_step
                // and investigate_step so it overrides both for the licensed handful —
                // the same override wander.cpp already performs internally on aggro —
                // and BEFORE physics_step so reach is tested against pre-integration
                // positions: a 1 cm error at a 1.35 m/s walk over one 8 ms step, three
                // orders of magnitude inside the 1.9 m unarmed reach.
                //
                // A feud can never kill a crowd body — damage to anyone but the camera
                // holder is floored at hp-1, because nothing in this game heals a
                // resident and a lethal feud would be a one-way population drain with
                // no counterplay. The camera holder IS killable: the player has
                // healing, resupply and possession-on-death. [faction_relations.h]
                feudHits += game::faction_feud_step(reg, pool, factionRel, activeLayer,
                                                    simTick, &activeWorld.gravity());
                // Slowed CAP enforcement: after every velocity writer
                // (controller / wander / investigate / feud), before integrate.
                // Was defined in combat.cpp and never called — dead path until now.
                const auto profPhysT0 = prof_now();
                game::slow_step(reg, activeLayer, kSimDt);
                physics_step(reg, stack, kSimDt);
                prof_add(kProfPhysics, profPhysT0);
                // Рагдолл-ядро: импульсный твердотел (RigidBody +
                // SelfIntegrating — physics_step такие тела пропускает).
                // До impact_damage_step, чтобы его Impact-репорты попали в тот
                // же универсальный закон урона. [markoaudit/plans/ragdoll.md]
                const auto profRigidT0 = prof_now();
                rigid_body_step(reg, stack, kSimDt);
                prof_add(kProfRigid, profRigidT0);
                // Жнец связей — одно правило смерти носителя (S20.3):
                // линк с умершей стороной уничтожается (живая разбужена),
                // сегмент без корня тоже; утечка линков при выгрузке этажа
                // закрыта по построению — связи умирают тиком после сторон.
                const auto profImpactT0 = prof_now();
                game::attachment_reaper_step(reg);
                // The universal impact law, straight after the sweep that wrote
                // the reports: damage = k*m*v^2/2 over Mass — fall damage and
                // prop crashes with no per-cause constants ([game/impact.h]).
                game::impact_damage_step(reg, pool, &particleBursts);
                prof_add(kProfImpact, profImpactT0);
                // prop_ragdoll_step умер (рагдолл-эпик, инкремент 6):
                // сорванные пропы — тела rigid_body_step выше.
                // НОВАЯ ДВЕРЬ: тоггл актором — единая интеракция E.
                // door_step не существует: полотно — настоящая материя,
                // физика/среды видят его без посредника.
                if (doorWanted) {
                    doorWanted = false;
                    // E исполняет РОВНО ПОКАЗАННОЕ: дверь работает, только
                    // если она и есть цель под прицелом ([game/focus.h]).
                    if (reg.valid(player) &&
                        g_focus.what == game::Focus::What::Portal &&
                        g_focus.portal < doors.list.size()) {
                        const vec3 dpos = reg.get<Transform>(player).pos;
                        const MaskGroup& fp = doors.list[g_focus.portal];
                        const bool wasClosed =
                            game::door_closed(stack.layer(activeLayer), fp);
                        if (wasClosed)
                            game::door_open(stack.layer(activeLayer), fp,
                                            doorDirty);
                        else
                            game::door_close(stack.layer(activeLayer), fp, reg,
                                             activeLayer, doorDirty);
                        {
                            game::NoiseProfile np{10.0f, 1200, 2,
                                                  game::NoiseSource::Door};
                            game::noise_publish(noiseField, activeLayer, dpos,
                                                np, 0);
                        }
                    }
                }

                // Universal destruction ([world/destruct.h]): the console/tools
                // PROPOSED a sphere; the sim disposes here, on its own clock.
                // No bake gate: the worker reads a snapshot, never the grid
                // ([game/rebake.h]), so a carve is legal mid-bake. Collision is
                // live off the mutated masks; every baked overlay's debt is
                // exactly carveResult.dirtyCells, and nav stays stale only
                // until the scheduler's next background swap.
                // СПАВН МАТЕРИИ (`neon [r]` / `glass [r]`): рождает шар
                // материала впереди камеры и гонит его тем же путём, что и
                // карв — зеркало мира, бейк светоматериалов, статик-таблица,
                // бейк видимости. `neon` существует ради проверки
                // стабильности слотов (рождать и убивать лампы по команде),
                // `glass` — прозрачности для света (light_transparent).
                // РЕПРО-СТЕНД РАСТЕКАНИЯ (GIGA_POUR=1): автоналив воды под
                // игроком на тике 200 и печать метрики изотропии по
                // квадрантам на тиках 600/1200/1800 — сверка растекания
                // числами между коммитами без участия владельца.
                static const char* kPourEnv = std::getenv("GIGA_POUR");
                if (kPourEnv) {
                    if (simTick == 200 && reg.valid(player)) {
                        const float pr =
                            static_cast<float>(std::atof(kPourEnv));
                        consoleCtx.paintRadius = pr > 0.0f ? pr : 1.0f;
                        // GIGA_POUR_MAT=<имя строки materials.csv> — материал
                        // стенда, дефолт water. Появился для замера ВОЗВРАТА
                        // ГАЗА без сна сред (вердикт владельца 2026-08-27
                        // «замер сначала»): GIGA_POUR=4 GIGA_POUR_MAT=toxic_gas
                        // — тот же стенд, та же метрика [medium], ноль новых
                        // механизмов.
                        consoleCtx.paintMat = kMatWater;
                        static const char* kPourMatEnv =
                            std::getenv("GIGA_POUR_MAT");
                        if (kPourMatEnv) {
                            const CellType pm = material_id_by_name(kPourMatEnv);
                            if (pm < kMatCount)
                                consoleCtx.paintMat = pm;
                            else
                                std::fprintf(stderr,
                                             "[pour-probe] unknown material "
                                             "'%s', water used\n",
                                             kPourMatEnv);
                        }
                        std::fprintf(stderr, "[pour-probe] pouring at tick 200\n");
                    }
                    if ((simTick == 600 || simTick == 1200 ||
                         simTick == 1800) && reg.valid(player)) {
                        // Скан CPU-канона по СУБВОКСЕЛЯМ относительно точки
                        // налива: кванты и дальность фронта по знаку смещения
                        // (тороидальная центрированная разность, 1024 суб/ось).
                        constexpr float kSubSize = kCellSize / 8.0f;
                        constexpr int kSubSpan = kMacroDim * 8;
                        const vec3 pp = reg.get<Transform>(player).pos;
                        const int psx = static_cast<int>(
                            std::floor(pp.x / kSubSize));
                        const int psy = static_cast<int>(
                            std::floor(pp.y / kSubSize));
                        const int pcx = wrap_macro(static_cast<int>(
                            std::floor(pp.x / kCellSize)));
                        const int pcy = wrap_macro(static_cast<int>(
                            std::floor(pp.y / kCellSize)));
                        const int pcz = wrap_macro(static_cast<int>(
                            std::floor(pp.z / kCellSize)));
                        World& pw = stack.layer(activeLayer);
                        const SubField<CellType>* pf =
                            pw.subfields().find<CellType>(kSubMaterialName);
                        auto sdiff = [](int a, int b) {
                            int d = (a - b) % kSubSpan;
                            if (d > kSubSpan / 2) d -= kSubSpan;
                            if (d < -kSubSpan / 2) d += kSubSpan;
                            return d;
                        };
                        long qXp = 0, qXn = 0, qYp = 0, qYn = 0;
                        int rXp = 0, rXn = 0, rYp = 0, rYn = 0;
                        for (int dz = -3; dz <= 3; ++dz)
                            for (int dy = -8; dy <= 8; ++dy)
                                for (int dx = -8; dx <= 8; ++dx) {
                                    const int cx = wrap_macro(pcx + dx);
                                    const int cy = wrap_macro(pcy + dy);
                                    const std::size_t ci = macro_index(
                                        cx, cy, wrap_macro(pcz + dz));
                                    const CellType* pg =
                                        pf ? pf->page(ci) : nullptr;
                                    if (!pg) continue;
                                    for (int b = 0; b < kSubVoxels; ++b) {
                                        if (pg[b] != kMatWater) continue;
                                        const int sx = sdiff(
                                            cx * 8 + (b & 7), psx);
                                        const int sy = sdiff(
                                            cy * 8 + ((b >> 3) & 7), psy);
                                        if (sx > 0) { qXp++; rXp = std::max(rXp, sx); }
                                        if (sx < 0) { qXn++; rXn = std::max(rXn, -sx); }
                                        if (sy > 0) { qYp++; rYp = std::max(rYp, sy); }
                                        if (sy < 0) { qYn++; rYn = std::max(rYn, -sy); }
                                    }
                                }
                        std::fprintf(
                            stderr,
                            "[pour-probe] tick %llu: quanta +x %ld -x %ld "
                            "+y %ld -y %ld | reach +x %d -x %d +y %d -y %d\n",
                            static_cast<unsigned long long>(simTick), qXp, qXn,
                            qYp, qYn, rXp, rXn, rYp, rYn);
                        // ДИАГНОЗ СУХИХ КЛЕТОК: карта воды по клеткам слоя
                        // налива + сигнатура каждой сухой клетки, граничащей
                        // с мокрой (тип/маска/страница/состав/газ) — ответ
                        // «кто запер клетку» без участия владельца.
                        // Доминирующая z-плоскость лужи (вода падает от
                        // точки налива вниз) — карта и диагноз строятся по ней.
                        int zHist[9] = {};
                        for (int dz = -5; dz <= 3; ++dz)
                            for (int dy = -8; dy <= 8; ++dy)
                                for (int dx = -8; dx <= 8; ++dx) {
                                    const std::size_t ci = macro_index(
                                        wrap_macro(pcx + dx),
                                        wrap_macro(pcy + dy),
                                        wrap_macro(pcz + dz));
                                    const CellType* pg =
                                        pf ? pf->page(ci) : nullptr;
                                    if (!pg) continue;
                                    for (int b = 0; b < kSubVoxels; ++b)
                                        if (pg[b] == kMatWater)
                                            ++zHist[dz + 5];
                                }
                        int poolDz = 0;
                        for (int z = 0; z < 9; ++z)
                            if (zHist[z] > zHist[poolDz + 5]) poolDz = z - 5;
                        const int poolCz = wrap_macro(pcz + poolDz);
                        std::fprintf(stderr, "[pour-map] pool plane dz %+d (%d quanta)\n",
                                     poolDz, zHist[poolDz + 5]);
                        int wq[17][17] = {};
                        for (int dy = -8; dy <= 8; ++dy)
                            for (int dx = -8; dx <= 8; ++dx) {
                                const std::size_t ci = macro_index(
                                    wrap_macro(pcx + dx),
                                    wrap_macro(pcy + dy), poolCz);
                                const CellType* pg =
                                    pf ? pf->page(ci) : nullptr;
                                if (!pg) continue;
                                for (int b = 0; b < kSubVoxels; ++b)
                                    if (pg[b] == kMatWater)
                                        ++wq[dy + 8][dx + 8];
                            }
                        for (int dy = 8; dy >= -8; --dy) {
                            char row[18];
                            for (int dx = -8; dx <= 8; ++dx) {
                                const int q = wq[dy + 8][dx + 8];
                                row[dx + 8] = q == 0 ? '.'
                                              : q < 10 ? char('0' + q)
                                              : q < 100 ? 'x' : 'X';
                            }
                            row[17] = 0;
                            std::fprintf(stderr, "[pour-map] %s\n", row);
                        }
                        int printed = 0;
                        for (int dy = -8; dy <= 8 && printed < 10; ++dy)
                            for (int dx = -8; dx <= 8 && printed < 10; ++dx) {
                                if (wq[dy + 8][dx + 8] != 0) continue;
                                bool frontier = false;
                                for (int k = 0; k < 4; ++k) {
                                    const int nx = dx + (k == 0) - (k == 1);
                                    const int ny = dy + (k == 2) - (k == 3);
                                    if (nx < -8 || nx > 8 || ny < -8 ||
                                        ny > 8)
                                        continue;
                                    if (wq[ny + 8][nx + 8] >= 8)
                                        frontier = true;
                                }
                                if (!frontier) continue;
                                const int cx = wrap_macro(pcx + dx);
                                const int cy = wrap_macro(pcy + dy);
                                const std::size_t ci =
                                    macro_index(cx, cy, poolCz);
                                const CellType base =
                                    pw.grid().cell(cx, cy, poolCz);
                                const SubMask& mk = pw.grid().masks()[ci];
                                int mbits = 0;
                                for (int wI = 0; wI < int(kSubMaskWords); ++wI)
                                    mbits += __builtin_popcountll(
                                        mk.words[wI]);
                                const CellType* pg =
                                    pf ? pf->page(ci) : nullptr;
                                int hist[4] = {};
                                CellType top[4] = {};
                                int nAtoms = 0;
                                if (pg)
                                    for (int b = 0; b < kSubVoxels; ++b) {
                                        if (pg[b] == kCellAir) continue;
                                        ++nAtoms;
                                        for (int h = 0; h < 4; ++h) {
                                            if (top[h] == pg[b]) {
                                                ++hist[h];
                                                break;
                                            }
                                            if (hist[h] == 0) {
                                                top[h] = pg[b];
                                                hist[h] = 1;
                                                break;
                                            }
                                        }
                                    }
                                // Граничная плоскость мокрого соседа в
                                // сторону сухой: вода/твердь на ней различают
                                // «замёрзший фронт» и легитимную стену.
                                int fw = 0, fs = 0;
                                {
                                    int bdx = 0, bdy = 0;
                                    for (int k = 0; k < 4; ++k) {
                                        const int nx = dx + (k == 0) - (k == 1);
                                        const int ny = dy + (k == 2) - (k == 3);
                                        if (nx < -8 || nx > 8 || ny < -8 ||
                                            ny > 8)
                                            continue;
                                        if (wq[ny + 8][nx + 8] >= 8) {
                                            bdx = nx; bdy = ny; break;
                                        }
                                    }
                                    const int wcx = wrap_macro(pcx + bdx);
                                    const int wcy = wrap_macro(pcy + bdy);
                                    const std::size_t wci =
                                        macro_index(wcx, wcy, poolCz);
                                    const CellType* wpg =
                                        pf ? pf->page(wci) : nullptr;
                                    const SubMask& wm =
                                        pw.grid().masks()[wci];
                                    // Плоскость соседа, обращённая К сухой.
                                    // Плоскость соседа, ОБРАЩЁННАЯ к
                                    // сухой: сосед в -x от сухой смотрит
                                    // на неё своей x==7.
                                    const int ax = bdx != dx ? 0 : 1;
                                    const int plane =
                                        (ax == 0 ? bdx < dx : bdy < dy)
                                            ? 7 : 0;
                                    for (int u = 0; u < 8; ++u)
                                        for (int v = 0; v < 8; ++v) {
                                            const int b2 =
                                                ax == 0
                                                    ? sub_bit(plane, u, v)
                                                    : sub_bit(u, plane, v);
                                            if (wpg &&
                                                wpg[b2] == kMatWater)
                                                ++fw;
                                            if (wm.test(b2)) ++fs;
                                        }
                                }
                                std::fprintf(
                                    stderr,
                                    "[pour-dry] d(%+d,%+d) base %s mask %d "
                                    "page %s atoms %d top %s:%d %s:%d | "
                                    "liq %.2f gas %.2f | seam seen %d lazy "
                                    "%d | wet-face water %d solid %d\n",
                                    dx, dy,
                                    kMatNames[static_cast<int>(base)], mbits,
                                    pg ? "yes" : "NO", nAtoms,
                                    hist[0] ? kMatNames[static_cast<int>(
                                                  top[0])]
                                            : "-",
                                    hist[0],
                                    hist[1] ? kMatNames[static_cast<int>(
                                                  top[1])]
                                            : "-",
                                    hist[1], liquid_frac_at(pw, ci),
                                    gas_frac_at(pw, ci),
                                    int(mediumPass.seam_seen(
                                        static_cast<std::uint32_t>(ci))),
                                    int(mediumPass.seam_lazy(
                                        static_cast<std::uint32_t>(ci))),
                                    fw, fs);
                                ++printed;
                            }
                    }
                }
                if (consoleCtx.paintRadius > 0.0f && reg.valid(player)) {
                    const float r = consoleCtx.paintRadius;
                    const CellType paintMat = consoleCtx.paintMat;
                    consoleCtx.paintRadius = 0.0f;
                    const vec3 ppos = reg.get<Transform>(player).pos;
                    const auto& camTag = reg.get<CameraTag>(player);
                    const vec3 fwd = camera_forward(camTag.yaw, camTag.pitch);
                    const float reach = 1.0f + r;
                    const vec3 c{ppos.x + fwd.x * reach, ppos.y + fwd.y * reach,
                                 ppos.z + fwd.z * reach};
                    World& w = stack.layer(activeLayer);
                    const float sv = kCellSize / kSubDim;
                    std::vector<std::uint32_t> painted;
                    const int span = static_cast<int>(std::ceil(r / sv));
                    const int bx = static_cast<int>(std::floor(c.x / sv));
                    const int by = static_cast<int>(std::floor(c.y / sv));
                    const int bz = static_cast<int>(std::floor(c.z / sv));
                    for (int dz = -span; dz <= span; ++dz)
                      for (int dy = -span; dy <= span; ++dy)
                        for (int dx = -span; dx <= span; ++dx) {
                            const float ox = (bx + dx + 0.5f) * sv - c.x;
                            const float oy = (by + dy + 0.5f) * sv - c.y;
                            const float oz = (bz + dz + 0.5f) * sv - c.z;
                            if (ox * ox + oy * oy + oz * oz > r * r) continue;
                            const int gx = bx + dx, gy = by + dy, gz = bz + dz;
                            const int cx = wrap_macro(
                                static_cast<int>(std::floor(
                                    static_cast<float>(gx) / kSubDim)));
                            const int cy = wrap_macro(
                                static_cast<int>(std::floor(
                                    static_cast<float>(gy) / kSubDim)));
                            const int cz = wrap_macro(
                                static_cast<int>(std::floor(
                                    static_cast<float>(gz) / kSubDim)));
                            const int sx = ((gx % kSubDim) + kSubDim) % kSubDim;
                            const int sy = ((gy % kSubDim) + kSubDim) % kSubDim;
                            const int sz = ((gz % kSubDim) + kSubDim) % kSubDim;
                            // УНИВЕРСАЛЬНЫЙ ПИСАТЕЛЬ (решение владельца
                            // 2026-08-24): сфера честно ПИШЕТ материал в
                            // истину — и точка. Бит SubMask — производный
                            // кэш предиката «твёрдое» (S16.1): у твёрдого
                            // ставится, у жидкости/газа СНИМАЕТСЯ. Отсюда
                            // `sphere air` = детерминированный шар воздуха —
                            // карв-кисть тем же законом, ноль особых путей.
                            if (material_phase(paintMat) == MatPhase::Solid)
                                w.grid().mask(cx, cy, cz).set(
                                    sub_bit(sx, sy, sz));
                            else
                                w.grid().mask(cx, cy, cz).clear(
                                    sub_bit(sx, sy, sz));
                            set_sub_material(w, cx, cy, cz, sx, sy, sz,
                                             paintMat);
                            painted.push_back(static_cast<std::uint32_t>(
                                macro_index(cx, cy, cz)));
                        }
                    // ОДИН ЗАКОН СВЯЗНОСТИ НА ВСЕХ ПИСАТЕЛЯХ (решение
                    // владельца 2026-08-24): нарисованный в воздухе твёрдый
                    // шар не висит — компонент записи проверяется от центра
                    // тем же детач-свипом, несвязанное конвертируется в
                    // рыхлого двойника и оседает автоматом. Лимит = атомы
                    // записи + запас: шар, слившийся со стеной, превышает
                    // его и стоит как записан.
                    if (material_phase(paintMat) == MatPhase::Solid &&
                        !painted.empty()) {
                        const int dcx = wrap_macro(static_cast<int>(
                            std::floor(static_cast<float>(bx) / kSubDim)));
                        const int dcy = wrap_macro(static_cast<int>(
                            std::floor(static_cast<float>(by) / kSubDim)));
                        const int dcz = wrap_macro(static_cast<int>(
                            std::floor(static_cast<float>(bz) / kSubDim)));
                        static CarveResult paintDetach;
                        if (detach_scan(w, dcx, dcy, dcz,
                                        ((bx % kSubDim) + kSubDim) % kSubDim,
                                        ((by % kSubDim) + kSubDim) % kSubDim,
                                        ((bz % kSubDim) + kSubDim) % kSubDim,
                                        carveScratch, paintDetach) > 0)
                            painted.insert(painted.end(),
                                           paintDetach.dirtyCells.begin(),
                                           paintDetach.dirtyCells.end());
                    }
                    std::sort(painted.begin(), painted.end());
                    painted.erase(std::unique(painted.begin(), painted.end()),
                                  painted.end());
                    if (!painted.empty()) {
                        voxelMirror.mark_dirty(painted.data(), painted.size());
                        // Писатель будит БЕЗУСЛОВНО (закон S16.1: писатели
                        // будят, автомат двигает): налитая вода потечёт, в
                        // шар воздуха стечёт материя соседей, лишние клетки
                        // мгновенно заснут. wake_cells сам будит и грани.
                        if (mediumPass.ready())
                            mediumPass.wake_cells(painted.data(),
                                                  painted.size(),
                                                  w, voxelMirror);
                        ++g_worldGen;
                        nav.patch_carved_cells(w.grid(), painted.data(),
                                               painted.size());
                        // Патч поля по нарисованным ячейкам — тот же путь, что
                        // у карва; полного скана этажа в кадре больше нет.
                        if (game::patch_emitter_field(w, g_emitterField,
                                                      painted.data(),
                                                      painted.size())) {
                            g_bakedFloorLights = game::bake_material_lights(
                                w, g_emitterField, g_emitterClusters);
                            rebuild_static_light_table(reg, activeLayer,
                                                       /*reset=*/false);
                            nav.set_light_table(g_staticLamps.data(),
                                                g_staticLamps.size(),
                                                gpu::kGridCellSlots,
                                                g_staticTableGen);
                        }
                        light_log("[paint] mat %u: %zu cells at "
                                  "(%.1f %.1f %.1f), table now %zu lamps\n",
                                  static_cast<unsigned>(paintMat),
                                  painted.size(), static_cast<double>(c.x),
                                  static_cast<double>(c.y),
                                  static_cast<double>(c.z),
                                  g_staticLamps.size());
                    }
                }
                // ЕДИНЫЙ ХВОСТ КАРВА (аудит 2026-08-25: жил ТРЕМЯ копиями —
                // консоль/бой/двери, копии уже разъехались). Всё, что должен
                // ЛЮБОЙ писатель геометрии после carve_sphere: свет-патч,
                // зеркало, пробуждение автомата (S16.5), диффузия,
                // нав-битсеты, частицы, якоря пропов, антураж. Вызывающий
                // добавляет только своё (шум взрыва, боевой лог).
                // СТОРОЖ ЗАРАСТАНИЯ (GIGA_REGROW_WATCH=1, баг владельца
                // 2026-08-26): кольцо последних выбитых атомов; в сим-тике
                // ниже проверяется «стал ли атом снова твёрдым» и КАКИМ
                // материалом — rubble_* = легитимная осадка крошки,
                // исходник = воскрешение; на первом воскрешении — полная
                // сверка зеркала CPU==GPU. Логи читает аудит, не владелец.
                {
                    static bool once = false;
                    if (!once) {
                        once = true;
                        const char* e = std::getenv("GIGA_REGROW_WATCH");
                        g_regrowWatch = e ? std::atoi(e) : 0;
                        if (g_regrowWatch < 0) g_regrowWatch = 0;
                    }
                }
                auto carve_settle = [&](std::uint32_t seed) {
                    auto ct0 = std::chrono::steady_clock::now();
                    // Патч поля по dirtyCells — он же детектор «задет ли
                    // свет» (субвоксельно честный). Кластеризация — только по
                    // светоячейкам поля, микросекунды вместо скана 128³.
                    const bool relight = game::patch_emitter_field(
                        stack.layer(activeLayer), g_emitterField,
                        carveResult.dirtyCells.data(),
                        carveResult.dirtyCells.size());
                    if (relight) {
                        g_bakedFloorLights = game::bake_material_lights(
                            stack.layer(activeLayer), g_emitterField,
                            g_emitterClusters);
                        // Кластеры пережиты с наследованием id — похудевший
                        // неон сохраняет слот, умерший целиком — надгробие.
                        rebuild_static_light_table(reg, activeLayer,
                                                   /*reset=*/false);
                        nav.set_light_table(g_staticLamps.data(),
                                            g_staticLamps.size(),
                                            gpu::kGridCellSlots,
                                            g_staticTableGen);
                    }
                    g_carveT.lightMatMs += carve_ms_since(ct0);
                    g_carveT.carved = true;
                    g_carveT.cells += carveResult.dirtyCells.size();
                    // Зеркало платит только dirty-клетки.
                    ct0 = std::chrono::steady_clock::now();
                    voxelMirror.mark_dirty(carveResult.dirtyCells.data(),
                                           carveResult.dirtyCells.size());
                    g_carveT.mirrorMarkMs += carve_ms_since(ct0);
                    // Карв — писатель грида (S16.5): разбудить задетые
                    // клетки — соседняя материя стечёт в свежую дыру.
                    if (mediumPass.ready())
                        mediumPass.wake_cells(carveResult.dirtyCells.data(),
                                              carveResult.dirtyCells.size(),
                                              stack.layer(activeLayer),
                                              voxelMirror);
                    ++g_worldGen; // поколение мутаций — планировщик доведёт
                    ct0 = std::chrono::steady_clock::now();
                    mark_diffusion_dirty(diffusionDriver,
                                         stack.layer(activeLayer).grid(),
                                         activeLayer, carveResult.dirtyCells);
                    g_carveT.diffMs += carve_ms_since(ct0);
                    // Долг живых битсетов проходимости — O(1) на клетку.
                    ct0 = std::chrono::steady_clock::now();
                    nav.patch_carved_cells(stack.layer(activeLayer).grid(),
                                           carveResult.dirtyCells.data(),
                                           carveResult.dirtyCells.size());
                    g_carveT.patchMs += carve_ms_since(ct0);
                    // Пыль и обломки, тонированные срезанным материалом.
                    ct0 = std::chrono::steady_clock::now();
                    spawn_carve_particles(verletPass, carveResult, seed);
                    g_carveT.partMs += carve_ms_since(ct0);
                    // Пропы на срезанных якорях падают ([jirnyak.md] §18).
                    ct0 = std::chrono::steady_clock::now();
                    if (game::anchor_validate_step(
                            reg, stack.layer(activeLayer), activeLayer, bus,
                            carveResult.dirtyCells, &particleBursts,
                            seed) > 0) {
                        propPassNeedsRebuild = true;
                    }
                    // Спящие тела над срезанной опорой просыпаются — долг
                    // писателя (S20.4): труп на плите падает вместе с ней,
                    // а не висит до первого толчка.
                    rigid_wake_dirty_cells(reg, activeLayer,
                                           carveResult.dirtyCells.data(),
                                           carveResult.dirtyCells.size());
                    g_carveT.anchorMs += carve_ms_since(ct0);
                    // Запечённое убранство отвечает тому же взрыву. Смерть
                    // публикуется ПОКАДРОВО (write_alive/write_pins), а не
                    // ре-аплоадом — тот телепортировал живой сим в rest (§28.4).
                    ct0 = std::chrono::steady_clock::now();
                    if (antourage_carve_step_here(carveResult.dirtyCells,
                                                  seed))
                        propPassNeedsRebuild = true;
                    g_carveT.antrMs += carve_ms_since(ct0);
                    if (g_regrowWatch > 0) {
                        constexpr std::size_t kRegrowCap = 8192;
                        if (g_regrowRing.size() < kRegrowCap)
                            g_regrowRing.resize(kRegrowCap, RegrowAtom{0, 0});
                        for (const CarvedVoxel& v : carveResult.destroyed) {
                            g_regrowRing[g_regrowHead] = RegrowAtom{
                                (v.cell << 9) | v.bit, v.mat};
                            g_regrowHead = (g_regrowHead + 1) % kRegrowCap;
                        }
                    }
                };
                if (g_regrowWatch >= 1 &&
                    (g_regrowWatch >= 2 || (simTick % 25u) == 0u) &&
                    activeLayer != kInvalidLayer)
                    regrow_check(stack.layer(activeLayer), voxelMirror,
                                 "сим", simTick);
                // РЕПРО-СТЕНД «дыра заросла» v2 — ПАРАМЕТРЫ ВЛАДЕЛЬЦА из
                // его лога (power 64, r 0.55, «шагающие» удары по чуть
                // сдвинутым точкам, этаж 0, z~137.9): GIGA_CARVE_PROBE=
                // "x,y,z" бьёт серию из 8 ударов и после КАЖДОГО проверяет,
                // не воскрес ли ЛЮБОЙ ранее выбитый атом (CPU) + сверка
                // зеркала в конце.
                static const char* kCarveProbeEnv =
                    std::getenv("GIGA_CARVE_PROBE");
                if (kCarveProbeEnv && activeLayer != kInvalidLayer) {
                    static vec3 probeP{};
                    static bool probeInit = false;
                    static std::vector<std::pair<std::uint32_t, CellType>>
                        holeAtoms;
                    if (!probeInit && simTick >= 250) {
                        probeInit = true;
                        float px = 0, py = 0, pz = 0;
                        if (std::sscanf(kCarveProbeEnv, "%f,%f,%f", &px, &py,
                                        &pz) == 3)
                            probeP = vec3{px, py, pz};
                        else if (reg.valid(player)) {
                            const vec3 pp = reg.get<Transform>(player).pos;
                            probeP = vec3{pp.x, pp.y, pp.z - 1.0f};
                        }
                    }
                    // Паттерн владельца: сдвиги ~0.3-0.9 м между ударами.
                    static const float kOff[8][2] = {
                        {0.0f, 0.0f},  {0.9f, 0.8f},  {0.8f, 0.5f},
                        {1.4f, 0.9f},  {2.2f, 0.8f},  {1.0f, 0.0f},
                        {0.3f, 0.4f},  {1.8f, 0.4f}};
                    const bool hitNow = probeInit && simTick >= 300 &&
                                        simTick < 300 + 8 * 60 &&
                                        ((simTick - 300) % 60u) == 0u;
                    if (hitNow) {
                        const auto hi = (simTick - 300) / 60u;
                        CarveOp op;
                        op.x = probeP.x + kOff[hi][0];
                        op.y = probeP.y + kOff[hi][1];
                        op.z = probeP.z;
                        op.radius = 0.55f;
                        op.power = 64;
                        op.seed = static_cast<std::uint32_t>(simTick);
                        const std::int32_t rem = carve_sphere(
                            stack.layer(activeLayer), op, carveScratch,
                            carveResult);
                        if (rem > 0) carve_settle(op.seed);
                        for (const CarvedVoxel& v : carveResult.destroyed)
                            holeAtoms.emplace_back((v.cell << 9) | v.bit,
                                                   v.mat);
                        std::fprintf(stderr,
                                     "[carve-probe] hit %llu at "
                                     "(%.1f,%.1f,%.1f) removed %d (det %zu, "
                                     "tracked %zu)\n",
                                     static_cast<unsigned long long>(hi),
                                     op.x, op.y, op.z, rem,
                                     carveResult.detached.size(),
                                     holeAtoms.size());
                    }
                    // Проверка ПОСЛЕ каждого удара (через 30 тиков) и в конце.
                    const bool checkNow = probeInit &&
                        ((simTick >= 330 && simTick < 850 &&
                          ((simTick - 330) % 60u) == 0u) ||
                         simTick == 1000);
                    if (checkNow && !holeAtoms.empty()) {
                        World& pw = stack.layer(activeLayer);
                        const SubField<CellType>* pf =
                            pw.subfields().find<CellType>(kSubMaterialName);
                        int solidAgain = 0, mobileNow = 0;
                        CellType firstMat = 0;
                        for (auto& [k, was] : holeAtoms) {
                            const std::size_t ci = k >> 9;
                            const int bit = static_cast<int>(k & 511u);
                            const CellType* pg = pf ? pf->page(ci) : nullptr;
                            CellType m = kCellAir;
                            if (pg) m = pg[bit];
                            else {
                                const CellType base = pw.grid().types()[ci];
                                const SubMask& mk = pw.grid().masks()[ci];
                                if (mk.test(bit)) m = base;
                                else if (mk.empty() &&
                                         material_is_medium(base))
                                    m = base;
                            }
                            if (m == kCellAir) continue;
                            if (material_is_medium(m)) ++mobileNow;
                            else {
                                ++solidAgain;
                                if (!firstMat) firstMat = m;
                            }
                        }
                        std::fprintf(stderr,
                                     "[carve-probe] tick %llu: %zu atoms -> "
                                     "mobile %d, SOLID AGAIN %d%s%s\n",
                                     static_cast<unsigned long long>(simTick),
                                     holeAtoms.size(), mobileNow, solidAgain,
                                     solidAgain ? " мат " : "",
                                     solidAgain
                                         ? kMatNames[static_cast<int>(
                                               firstMat)]
                                         : "");
                        if (simTick == 1000) {
                            const bool ok = voxelMirror.verify(
                                stack.layer(activeLayer));
                            std::fprintf(stderr,
                                         "[carve-probe] mirror verify: %s\n",
                                         ok ? "OK" : "DIVERGED");
                        }
                    }
                }
                if (consoleCtx.carveRadius > 0.0f && reg.valid(player)) {
                    const vec3 ppos = reg.get<Transform>(player).pos;
                    const auto& camTag = reg.get<CameraTag>(player);
                    const vec3 fwd = camera_forward(camTag.yaw, camTag.pitch);
                    const float reach = 1.0f + consoleCtx.carveRadius;
                    CarveOp op;
                    op.x = ppos.x + fwd.x * reach;
                    op.y = ppos.y + fwd.y * reach;
                    op.z = ppos.z + fwd.z * reach;
                    op.radius = consoleCtx.carveRadius;
                    op.power =
                        static_cast<std::uint16_t>(consoleCtx.carvePower);
                    // Seed = sim tick: the op replays bit-identically from the
                    // command stream, and the next swing is a fresh roll.
                    op.seed = static_cast<std::uint32_t>(simTick);
                    consoleCtx.carveRadius = 0.0f;
                    const auto ctSite = std::chrono::steady_clock::now();
                    const auto ct0 = std::chrono::steady_clock::now();
                    const std::int32_t removed =
                        carve_sphere(stack.layer(activeLayer), op,
                                     carveScratch, carveResult);
                    g_carveT.sphereMs += carve_ms_since(ct0);
                    if (removed > 0) {
                        carve_settle(op.seed);
                        // Взрыв — самое громкое после стрельбы: толпа слышит.
                        game::NoiseProfile np{18.0f, 2200, 4,
                                              game::NoiseSource::WeaponFire};
                        game::noise_publish(noiseField, activeLayer,
                                            vec3{op.x, op.y, op.z}, np, 0);
                        g_carveT.siteMs += carve_ms_since(ctSite);
                    }

                }
                if (interactWanted) {
                    interactWanted = false;
                    // ЦЕЛЬ РЕШАЕТ ФОКУС: если под прицелом дверь, её и
                    // работаем — ветки ниже ищут по БЛИЗОСТИ и раньше
                    // перехватывали E у самой двери (жалоба владельца).
                    if (reg.valid(player) &&
                        g_focus.what == game::Focus::What::Portal) {
                        interactWanted = false;
                    } else if (reg.valid(player)) {
                        const vec3 ppos = reg.get<Transform>(player).pos;
                        bool handled = false;

                        // 1. Труп: E открывает ЭКРАН обыска (двухсторонняя
                        // сетка, [inventory_ui.h]) вместо старого авто-лута
                        // всем скопом — что взять, решают руки, а не reach.
                        // loot_corpse_interact остался бэкендом харнесса
                        // (--shot corp) и тестов; путь игрока — заявки Take.
                        {
                            const game::InteractionHit corpseHit =
                                game::find_nearest_interactable(
                                    reg, player, game::Interactable::Kind::Corpse,
                        game::interact_def(game::InteractKind::Corpse).reachM);
                            if (corpseHit.hit &&
                                reg.all_of<game::Corpse>(corpseHit.entity)) {
                                handled = true;
                                lootEntity = corpseHit.entity;
                                lootIsCorpse = true;
                                lootIsBarter = false;
                                shell.window = UiWindow::Inventory;
                                input.set_mouselook(false);
                                SDL_SetWindowRelativeMouseMode(window, false);
                                // Ворошить тело слышно ([noise.h]).
                                game::NoiseProfile np{6.0f, 600, 1,
                                                      game::NoiseSource::Body};
                                game::noise_publish(noiseField, activeLayer,
                                                    ppos, np, 0);
                            }
                        }

                        // 1б. Ящик: E открывает тот же экран. Авто-высасывание
                        // по близости (loot_containers_step в тике) снято —
                        // ящик больше не пылесос, он ХРАНИЛИЩЕ: можно и брать,
                        // и класть ([container.h] condition — износ едет).
                        if (!handled) {
                            // Ящик — обычный Interactable (S14.1 B2): кастомный
                            // перебор по дистанции умер, ищет тот же
                            // find_nearest_interactable, что трупы и терминалы;
                            // reach — из interactables.csv.
                            const game::InteractionHit crateHit =
                                game::find_nearest_interactable(
                                    reg, player, game::Interactable::Kind::Crate,
                                    game::interact_def(game::InteractKind::Crate)
                                        .reachM);
                            Entity bestBox =
                                crateHit.hit &&
                                        reg.all_of<game::Container>(crateHit.entity)
                                    ? crateHit.entity
                                    : entt::null;
                            if (bestBox != entt::null) {
                                handled = true;
                                lootEntity = bestBox;
                                lootIsCorpse = false;
                                lootIsBarter = false;
                                shell.window = UiWindow::Inventory;
                                input.set_mouselook(false);
                                SDL_SetWindowRelativeMouseMode(window, false);
                                // Крышка слышна ([noise.h] kContainerRadius/
                                // TtlMs) — обыск по-прежнему не бесплатен.
                                game::NoiseProfile np{7.0f, 2200, 1,
                                                      game::NoiseSource::Container};
                                game::noise_publish(
                                    noiseField, activeLayer,
                                    reg.get<const Transform>(bestBox).pos, np, 0);
                            }
                        }

                        // 1в. Живой NPC: E открывает МЕНЮ взаимодействия
                        // ([conversation.md]) — разговор/задание/торг, игры
                        // придут строками таблицы. Ниже трупа и ящика по
                        // приоритету: мёртвое и запертое не убегает, живой
                        // собеседник подождёт клавишу.
                        if (!handled && activeLayer != kInvalidLayer) {
                            const game::InteractionHit npcHit =
                                game::find_nearest_interactable(
                                    reg, player, game::Interactable::Kind::Npc,
                                    game::interact_def(game::InteractKind::Npc)
                                        .reachM);
                            if (npcHit.hit &&
                                reg.all_of<game::NpcRef>(npcHit.entity)) {
                                const game::NpcId cid =
                                    reg.get<game::NpcRef>(npcHit.entity).id;
                                if (pool.valid(cid) && pool.alive(cid)) {
                                    handled = true;
                                    convEntity = npcHit.entity;
                                    convNpc = cid;
                                    convLine[0] = 0;
                                    convUi.sel = 0;
                                    shell.window = UiWindow::Conversation;
                                    input.set_mouselook(false);
                                    SDL_SetWindowRelativeMouseMode(window,
                                                                   false);
                                }
                            }
                        }

                        // 2. Terminal / ControlPanel — zero-heap nearest Interactable
                        // ([jirnyak.md] §18 interaction_step). No vector collect,
                        // no fake hit when nothing is in reach.
                        if (!handled && activeLayer != kInvalidLayer) {
                            // МОГИЛА ДВЕРЕЙ (2026-08-28): терминал больше не
                            // тумблер замков; его скан по близости умер вместе
                            // с ролью — окна ниже открывает ФОКУС (g_focus).
                        // 5c: КНОПКА ВЫЗОВА снаружи столба — «лифт приехал»,
                        // створка открывается (иллюзия приезда — следующий
                        // инкремент); ПАНЕЛЬ в кабине — меню этажей (E, как
                        // всё; клавиша L остаётся дев-дублёром).
                        // АКТИВАЦИЯ ССЫЛКОЙ (S18): кнопка несёт DoorRef
                        // на створку своего хаба — деривация хаба из
                        // позиции кнопки (fast_hub_near) умерла. Кнопка
                        // без ссылки — дефект обвеса, и он кричит.
                        if (!handled &&
                            g_focus.what == game::Focus::What::Entity &&
                            g_focus.kind == game::InteractKind::LiftCall) {
                            const auto* dr =
                                reg.try_get<game::DoorRef>(g_focus.entity);
                            if (dr && dr->group < doors.list.size()) {
                                game::door_open(stack.layer(activeLayer),
                                                doors.list[dr->group],
                                                doorDirty);
                                handled = true;
                                std::fprintf(stderr,
                                             "[lift] called — door group %u "
                                             "opens\n", dr->group);
                            } else {
                                std::fprintf(stderr,
                                             "[lift] LiftCall БЕЗ DoorRef — "
                                             "дефект обвеса\n");
                            }
                        }
                        // КРАФТ — ОТ ВЕРСТАКА (вердикт владельца): клавиша C
                        // снята, окно открывает интерактив терминала/верстака
                        // под прицелом.
                        if (!handled &&
                            g_focus.what == game::Focus::What::Entity &&
                            g_focus.kind == game::InteractKind::Terminal) {
                            shell.window = UiWindow::Craft;
                            input.set_mouselook(false);
                            SDL_SetWindowRelativeMouseMode(window, false);
                            handled = true;
                        }
                        if (!handled &&
                            g_focus.what == game::Focus::What::Entity &&
                            g_focus.kind == game::InteractKind::LiftPanel) {
                            shell.toggle(UiWindow::Elevator);
                            if (shell.window != UiWindow::None)
                                input.set_mouselook(false);
                            handled = true;
                        }

                        }

                        // 3. ElectricalShield sabotage — zero-heap nearest.
                        if (!handled && activeLayer != kInvalidLayer) {
                            game::InteractionHit shieldHit = game::find_nearest_interactable(
                                reg, player, game::Interactable::Kind::ElectricalShield, 3.5f);
                            if (shieldHit.hit) {
                                const vec3& sp = shieldHit.pos;
                                int scx = static_cast<int>(sp.x / kCellSize);
                                int scy = static_cast<int>(sp.y / kCellSize);
                                int scz = static_cast<int>(sp.z / kCellSize);
                                if (!powerGrid.is_shield_destroyed(scx, scy, scz)) {
                                    handled = true;
                                    powerGrid.destroy_shield(scx, scy, scz);
                                    std::snprintf(elevDiagLine, sizeof(elevDiagLine),
                                                  "POWER GRID SABOTAGE: ELECTRICAL SHIELD DESTROYED AT (%.1f, %.1f)",
                                                  sp.x, sp.z);
                                    elevDiagAt = simTick;

                                    game::NoiseProfile np{16.0f, 2500, 3, game::NoiseSource::Door};
                                    game::noise_publish(noiseField, activeLayer, sp, np, 0);
                                }
                            }
                        }

                        // ОБЛЕГЧЕНИЕ БОЛЬШЕ НЕ НА КЛАВИШЕ (вердикт
                        // владельца 2026-08-28: «писать надо, но не кнопкой»).
                        // Эта ветка стояла ПОСЛЕДНИМ fallback-ом клавиши E и
                        // ловила любое нажатие, которому не досталось цели —
                        // отсюда «жму E у двери, а персонаж мочится». Нужда
                        // остаётся ([needs.h] relieve_needs — живой API,
                        // потребитель придёт своим законом: туалет как
                        // интерактив или автоматическое облегчение по
                        // давлению).

                    }
                }
                if (possessWanted) {
                    possessWanted = false;
                    if (reg.valid(player)) {
                        const vec3 ppos = reg.get<Transform>(player).pos;
                        Entity newPlayer = possess_nearest_survivor(reg, pool, activeLayer, ppos, 8.0f);
                        if (newPlayer != entt::null) {
                            player = newPlayer;
                            // POSRPG: keep the run-local snapshots honest so a later
                            // death path / F5 save does not restore the pre-hop sheet
                            // or a stale kill tally. transfer_player_progression
                            // already stamped the components on the new body.
                            if (const auto* pm =
                                    reg.try_get<game::PlayerMelee>(player))
                                kills = pm->kills;
                            if (const auto* rs =
                                    reg.try_get<game::RpgStats>(player))
                                carriedRpg = *rs;
                            const vec3 newPos = reg.get<Transform>(player).pos;
                            const auto* nr = reg.try_get<game::NpcRef>(player);
                            const game::NpcId newId = nr ? nr->id : 0;
                            std::snprintf(elevDiagLine, sizeof(elevDiagLine),
                                          "MIND PROJECTION: POSSESSED RESIDENT BODY #%u AT (%.1f, %.1f)",
                                          newId, newPos.x, newPos.z);
                            elevDiagAt = simTick;

                            game::NoiseProfile np{15.0f, 1500, 3, game::NoiseSource::Door};
                            game::noise_publish(noiseField, activeLayer, newPos, np, 0);
                        }
                    }
                }
                // Melee resolves AFTER physics, so reach is tested against where
                // bodies actually ended up this step rather than where they
                // intended to go.
                // The player swings first on a tick, so trading blows is a trade
                // rather than a guaranteed loss to whoever the view yields first.
                // Left mouse routes by loadout: a gun shoots, a fist swings. One
                // button, because there is no weapon-selection UI yet and adding a
                // second bind for a system with no way to choose a weapon would be a
                // control for a choice the player cannot make.
                // Snapshot player HP before combat for damage-taken VFX.
                std::int16_t preHp = 0, preMax = 0;
                if (reg.valid(player))
                    game::entity_health(reg, pool, player, preHp, preMax);

                // ДВЕ РУКИ (two-hands.md): верб каждой руки решает ТИП
                // предмета в ней таблицами — ствол стреляет, метательное
                // бросается, пустая/холодная рука бьёт. Руки НЕЗАВИСИМЫ
                // (решение владельца: очередь с одной, граната с другой —
                // ствольный cooldownMs и throwCooldownMs раздельны).
                bool gunL = false, gunR = false;
                bool thrownL = false, thrownR = false;
                if (reg.valid(player))
                    if (const auto* nrg = reg.try_get<game::NpcRef>(player))
                        if (pool.valid(nrg->id)) {
                            const game::Equipped* peq =
                                reg.try_get<game::Equipped>(player);
                            if (peq)
                                for (int hr = 0; hr < 2; ++hr) {
                                    const game::ItemId hi =
                                        game::equipped_hand(
                                            pool.inventory(nrg->id), *peq,
                                            hr == 1);
                                    const bool gun =
                                        game::ranged_for_item(hi) != nullptr &&
                                        !game::ranged_is_thrown(hi);
                                    const bool thr =
                                        game::ranged_for_item(hi) != nullptr &&
                                        game::ranged_is_thrown(hi);
                                    (hr ? gunR : gunL) = gun;
                                    (hr ? thrownR : thrownL) = thr;
                                }
                        }
                // Рука несёт и делает то, чем экипирована: спуск руки с
                // метательным — бросок ЕЁ предмета (закон владельца,
                // приоритетов нет по построению). throwWanted остаётся
                // путём консоли/харнесса (скан сумки).
                const bool throwHandL =
                    thrownL && attackHeld && shell.playing();
                const bool throwHandR = thrownR && rmbHeld && shell.playing();
                // ПРОП ЗАНИМАЕТ РУКУ (two-hands.md): верб занятой руки —
                // «бросить несомое», по фронту нажатия её кнопки; та же
                // скорость 6 м/с, что у консольной команды carry.
                bool carriedL = false, carriedR = false;
                for (auto ce : reg.view<CarriedBy>()) {
                    const auto& cb = reg.get<CarriedBy>(ce);
                    if (cb.carrier != player) continue;
                    (cb.hand != 0 ? carriedR : carriedL) = true;
                }
                {
                    static bool prevAtk = false, prevRmb = false;
                    const bool atkEdge = attackHeld && !prevAtk;
                    const bool rmbEdge = rmbHeld && !prevRmb;
                    prevAtk = attackHeld;
                    prevRmb = rmbHeld;
                    if (shell.playing() && (carriedL || carriedR) &&
                        reg.valid(player)) {
                        const auto& pcam = reg.get<CameraTag>(player);
                        const vec3 pfwd =
                            camera_forward(pcam.yaw, pcam.pitch);
                        if (carriedL && atkEdge)
                            game::drop_carried(reg, player, pfwd, 6.0f, 0);
                        if (carriedR && rmbEdge)
                            game::drop_carried(reg, player, pfwd, 6.0f, 1);
                    }
                }
                // Пустая (без верб-предмета и без пропа) рука бьёт.
                const bool meleeWanted =
                    (attackHeld && !gunL && !thrownL && !carriedL) ||
                    (rmbHeld && !gunR && !thrownR && !carriedR);
                // Combat carves: clear, fill during melee/projectiles, dispose
                // same step. Nothing is dropped for a bake any more — the
                // worker holds a snapshot, not the grid ([game/rebake.h]).
                combatCarves.clear();
                // Счёт выстрелов живёт в PlayerRanged::shots — локальный
                // накопитель убит (К1-15), вызов остаётся: он стреляет.
                game::player_ranged_step(
                    reg, pool, activeLayer, attackHeld && shell.playing(),
                    rmbHeld && shell.playing(), kSimDt, simTick, &noiseField,
                    &playerStatus);
                // IMMEDIATELY AFTER the firearm step and never before it: the two
                // share `PlayerRanged::cooldownMs` (one pair of hands) and the step
                // above owns its single decrement ([combat.h] player_throw_step).
                // Consumed here rather than at the request site so the throw lands on
                // a sim tick like every other action, not on a frame.
                game::player_throw_step(reg, pool, activeLayer, throwHandL,
                                        throwHandR, throwWanted, simTick);
                throwWanted = false;
                const auto profCombatT0 = prof_now();
                game::player_melee_step(
                    reg, pool, bus, activeLayer, kSimDt,
                    // Бьёт рука без верб-предмета (two-hands.md): кнопка
                    // руки с гранатой/стволом кулаком не машет.
                    meleeWanted && shell.playing(), simTick,
                    &stack.layer(activeLayer).grid(), &combatCarves,
                    &playerStatus, &particleBursts,
                    &stack.layer(activeLayer).gravity());
                meleeHits += game::mob_attack_step(reg,
                                   stack.layer(activeLayer).grid(),
                                   pool, bus, activeLayer,
                                                   kSimDt, simTick,
                                                   &particleBursts,
                                   &stack.layer(activeLayer).gravity(),
                                   game::samosbor_active(samosbor));
                // Fire, acid and live grates bill EVERY embodied body, not just
                // monsters. Straight after the monster sweep so both pay on the
                // same tick and the same 1-in-16 cadence. [problems.md] §41
                game::hazard_step(reg, stack.layer(activeLayer).grid(), pool,
                                  activeLayer, simTick, &particleBursts,
                                  &stack.layer(activeLayer).gravity());
                // Shots resolve AFTER the pass that launched them, so a
                // projectile never lands on the frame it is fired.
                // Дельта PropDetached до/после: выстрел-в-проп внутри
                // projectile_step сносит и GpuHandoff-лампы (reg.destroy), и
                // якорные пропы целиком — без ребилда статичной шкуры PropPass
                // плафон разбитой лампы рисовался бы до следующего карва.
                const std::uint32_t propDetachedBeforeShots =
                    bus.cycle_count(game::EventType::PropDetached);
                meleeHits += game::projectile_step(
                    reg, pool, bus, stack, activeLayer, kSimDt, simTick,
                    &playerStatus, player, &combatCarves, &stainDirty,
                    &particleBursts, &noiseField);
                // Фитили проп-зарядов: граната — RagdollRoll-проп, её
                // детонацию решает charge_step тем же примитивом detonate()
                // и в те же очереди (carve/частицы/шум), что и снаряды.
                meleeHits += game::charge_step(reg, pool, stack, activeLayer,
                                               simTick, &combatCarves,
                                               &particleBursts, &noiseField);
                prof_add(kProfCombat, profCombatT0);
                if (bus.cycle_count(game::EventType::PropDetached) >
                    propDetachedBeforeShots)
                    propPassNeedsRebuild = true;
                // Drain combat carve proposals through the same carve_sphere
                // path the console uses.
                // Gated like every other debug channel (GIGA_*_DBG): the counters
                // are always kept, the line only prints when asked for.
                static const bool carveDbg =
                    std::getenv("GIGA_CARVE_DBG") != nullptr;
                if (carveDbg &&
                    (combatCarves.count > 0 || combatCarves.droppedFull > 0 ||
                     combatCarves.droppedDegenerate > 0 ||
                     combatCarves.clampedRadius > 0)) {
                    std::fprintf(stderr,
                                 "[carve] proposals=%u dropped_full=%u "
                                 "dropped_degen=%u clamped=%u\n",
                                 static_cast<unsigned>(combatCarves.count),
                                 static_cast<unsigned>(combatCarves.droppedFull),
                                 static_cast<unsigned>(combatCarves.droppedDegenerate),
                                 static_cast<unsigned>(combatCarves.clampedRadius));
                }
                if (combatCarves.count > 0) {
                    for (std::uint8_t ci = 0; ci < combatCarves.count; ++ci) {
                        const game::CarveProposal& pr = combatCarves.items[ci];
                        CarveOp op;
                        op.x = pr.x; op.y = pr.y; op.z = pr.z;
                        op.radius = pr.radius;
                        op.power = pr.power;
                        op.seed = pr.seed;
                        const auto ctSite = std::chrono::steady_clock::now();
                        const auto ct0 = std::chrono::steady_clock::now();
                        const std::int32_t removed =
                            carve_sphere(stack.layer(activeLayer), op,
                                         carveScratch, carveResult);
                        g_carveT.sphereMs += carve_ms_since(ct0);
                        if (removed > 0) {
                            carve_settle(pr.seed);
                            std::fprintf(stderr,
                                         "[carve] COMBAT removed=%d power=%u "
                                         "r=%.2f at (%.1f,%.1f,%.1f)\n",
                                         removed,
                                         static_cast<unsigned>(pr.power),
                                         pr.radius, pr.x, pr.y, pr.z);
                            g_carveT.siteMs += carve_ms_since(ctSite);
                        }
                    }
                    combatCarves.clear();
                }
                // Severed pipes drip on a slow clock: one drop per stump
                // roughly every 0.4 s ([game/particles.h] — the "якорь мёртв
                // → эмиттер" writer). Emitters are refilled at every prop
                // merge, so a re-carved or reloaded floor stays honest.
                if ((simTick % 50u) == 0u && !dripEmitters.empty() &&
                    verletPass.sim_ready()) {
                    static std::vector<gpu::GpuParticle> dripTmp;
                    dripTmp.clear();
                    const game::ParticleDef& dripDef =
                        game::particle_def(game::ParticleKind::Drip);
                    for (std::size_t i = 0; i < dripEmitters.size(); ++i)
                        pack_particles(dripTmp, dripEmitters[i],
                                       vec3{0.0f, 0.0f, -0.2f}, dripDef,
                                       vec3{dripDef.r, dripDef.g, dripDef.b}, 1,
                                       static_cast<std::uint32_t>(simTick) ^
                                           static_cast<std::uint32_t>(i));
                    verletPass.spawn_particles(dripTmp.data(),
                                       static_cast<std::uint32_t>(
                                           dripTmp.size()));
                }
                // Binary diagnostic, same law as GIGA_ANTOURAGE_DEBUG: a
                // fountain 3 m ahead of the camera answers "does the pool
                // render at all" without hunting for dust. The env VALUE picks
                // the CSV row (GIGA_PARTICLE_DBG=3 → sparks, =1 → debris...),
                // so every kind can be eyeballed in isolation.
                static const char* particleDbg =
                    std::getenv("GIGA_PARTICLE_DBG");
                if (particleDbg != nullptr && (simTick % 15u) == 0u &&
                    reg.valid(player)) {
                    int dk = std::atoi(particleDbg);
                    if (dk < 0 || dk >= game::kParticleKindCount)
                        dk = static_cast<int>(game::ParticleKind::Spark);
                    const auto& camT = reg.get<CameraTag>(player);
                    const vec3 fw = camera_forward(camT.yaw, camT.pitch);
                    const vec3 pp = reg.get<Transform>(player).pos;
                    particleBursts.push(
                        vec3{pp.x + fw.x * 3.0f, pp.y + fw.y * 3.0f,
                             pp.z + 1.2f + fw.z * 3.0f},
                        vec3{0.0f, 0.0f, 1.0f},
                        static_cast<game::ParticleKind>(dk), 12,
                        kMatElectricGrate, // debris/dust tint: loud yellow
                        static_cast<std::uint32_t>(simTick));
                }
                // Drain this tick's blood/spark proposals into the GPU pool.
                // Under GIGA_PARTICLE_PIN the queue is dropped instead: the
                // crowd bleeds nondeterministically and would poison the pin
                // hash — the pin's only writer is the synthetic burst below.
                if (gpu::particle_pin_active())
                    particleBursts.clear();
                else
                    drain_particle_bursts(verletPass, particleBursts);
                // GIGA_PARTICLE_PIN: one fixed-seed burst at the player spawn
                // point, injected exactly once — the deterministic input the
                // pin protocol hashes (markoaudit/plans/verlet-merge.md §6.1).
                static bool particlePinInjected = false;
                if (gpu::particle_pin_active() && !particlePinInjected &&
                    reg.valid(player)) {
                    particlePinInjected = true;
                    static std::vector<gpu::GpuParticle> pinTmp;
                    pinTmp.clear();
                    const vec3 pp = reg.get<Transform>(player).pos;
                    const auto& def = game::kParticleTable[static_cast<int>(
                        game::ParticleKind::Debris)];
                    pack_particles(pinTmp,
                                   vec3{pp.x, pp.y, pp.z + 1.2f},
                                   vec3{0.0f, 0.0f, 1.0f}, def,
                                   kMaterial[kMatElectricGrate], 64,
                                   0xC0FFEEu);
                    verletPass.spawn_particles(pinTmp.data(),
                                       static_cast<std::uint32_t>(
                                           pinTmp.size()));
                }




                // them and still before finalize_deaths: a monster's blow lands
                // first, and if that already killed you apply_damage refuses the
                // target, so you cannot be billed for starving after you are dead.
                // [needs.h]
                // Overhear the nearest body, at most once every kOverhearCooldownTicks.
                // Without the cooldown, standing in a crowd would replace the line
                // every frame and none of them would be readable — a flicker instead
                // of information. [rumour.h]
                // The crowd's own voice, on its own slower clock. It runs its OWN
                // nearest_speaker sweep rather than sharing the rumour one below: the
                // sweep is O(bodies on the layer) and fires at most once per 3 s, which
                // is far cheaper than entangling two channels that must not tick
                // together. [speech.h]
                if (simTick - speechAt >= game::kSpeechCooldownTicks) {
                    const game::NpcId talker = game::nearest_speaker(reg, activeLayer);
                    if (talker != game::kInvalidNpc) {
                        const game::SpeechContext sc =
                            game::speech_context(reg, pool, talker, samosbor.phase);
                        // The seed is the UTTERANCE COUNTER — the reference's
                        // `repeatIndex: Math.floor(time)`. Identity is already folded in
                        // by speech_line_index, so this is the only term that has to move
                        // for the same body to say something new.
                        speechLine = game::speech_say(
                            speechMem, pool, talker, sc,
                            static_cast<std::uint32_t>(simTick /
                                                       game::kSpeechCooldownTicks),
                            &speechSit);
                        speechAt = simTick;
                    }
                }
                if (simTick - rumourAt >= game::kOverhearCooldownTicks) {
                    const game::NpcId sp = game::nearest_speaker(reg, activeLayer);
                    if (sp != game::kInvalidNpc) {
                        // Pass the LIVE samosbor clock, not the five-argument shim.
                        // The shim substitutes a default-constructed SamosborState —
                        // phase Idle, count 0 — and four of the nine rumour kinds gate
                        // on exactly those fields, so Imminent (phase Warning), Variant
                        // (phase Active), Veteran (count > 0) and Lull (a clock that has
                        // ever been armed) were unreachable in play while being fully
                        // implemented, texted and unit-tested. `samosbor` is the same
                        // object speech_context reads a dozen lines above. [rumour.h]
                        const game::Rumour ru = game::rumour_for(
                            reg, pool, sp, activeLayer, currentFloor, samosbor);
                        if (game::rumour_text(ru, rumourLine, sizeof(rumourLine)))
                            rumourAt = simTick;
                        // The same body may also be hiring. One proximity sweep, two
                        // payloads — a contract is a thing you walk into, because there
                        // is no talk verb and building one to deliver a sentence would
                        // be the expensive way round. [contract.h]
                        const game::Contract off = game::contract_offer(
                            pool, sp, currentFloor, 0x9E37u);
                        if (off.giver != game::kInvalidNpc &&
                            game::contract_text(off, offerLine, sizeof(offerLine))) {
                            offer = off;
                        }
                        // The same body may also carry an authored quest. Seed
                        // 0xB4C3 is distinct from the contract seed (0x9E37) so the
                        // two hashes land in different equivalence classes and a body
                        // hired for a contract does not automatically offer a quest
                        // with the same random-chain outcome. [quest.h]
                        const game::QuestId qid = game::quest_offer(
                            pool, quests, sp, currentFloor, 0xB4C3u);
                        if (game::quest_valid(qid) &&
                            game::quest_offer_text(qid, questOfferLine,
                                                   sizeof(questOfferLine))) {
                            questOffer = qid;
                            questOfferGiver = sp;
                        }
                    }
                }
                // Амбиентная регенерация по виду комнаты умерла (rooms-object
                // F; S12.5 — потребление реальное, вернёт agent-goals).
                // ENCUMBRANCE before the needs clock, because it charges the same
                // sleep bar the clock then reads for its exhaustion penalty — a
                // load taxes you on the tick you carry it, not one tick later.
                const auto profNeedsT0 = prof_now();
                encumbrance = game::encumbrance_step(reg, pool, activeLayer, kSimDt,
                                                     simTick, &noiseField);
                needs = game::needs_step(reg, pool, activeLayer, kSimDt,
                                         &aiMem, simNow);
                prof_add(kProfNeeds, profNeedsT0);
                needsHpLost += needs.hpLost;
                // НЕВОЛЬНОЕ ОБЛЕГЧЕНИЕ ([needs.h]: давление лопнуло — клок
                // слил его, где застало). Лужа — тот же стейн, что канал P.
                // Социальная цена (свидетели чужой территории) придёт
                // системой свидетельства (CANON.md S19), не веткой здесь.
                if (needs.voidedPee && reg.valid(player)) {
                    const vec3 rp = reg.get<Transform>(player).pos;
                    stain_splat(stack.layer(activeLayer), rp,
                                vec3{0, 0, -1.0f}, 1.4f, /*rays=*/14,
                                kStainUrine,
                                static_cast<std::uint32_t>(simTick),
                                stainDirty);
                    std::fprintf(stderr,
                                 "[relief] невольно: мочевой лопнул\n");
                }
                // The other half of the acceptance trail. `bodies` says the clock is
                // no longer a one-body clock, `recovering` says rooms are actually
                // feeding people, and `crowdDead` is the number that would climb if
                // the ambient half were ever broken again — a silent morgue is the
                // failure mode this widening had to buy its way past ([needs.h]).
                // Cadence piggybacks on the [aimem] pulse a few hundred lines up,
                // which set `lastAimemLogTick` to `simTick` earlier in THIS tick, so
                // the two lines always describe the same frame.
                crowdDead += needs.crowdKilled;
                if (aiCfg.enabled && lastAimemLogTick == simTick)
                    std::fprintf(stderr,
                                 "[needs] tick=%llu bodies=%u recovering=%u "
                                 "crowd_dead_total=%u\n",
                                 static_cast<unsigned long long>(simTick),
                                 needs.bodies, needs.recovering, crowdDead);
                // Corpses pay out BEFORE they are destroyed. The gap between
                // "hp hit zero" and "gone" is precisely what the Dead tag exists
                // to create (combat.h defect 2) — the reference's P0 was culling
                // an entity before its loot hook ran.
                // Remember which pool row is the player BEFORE the death point,
                // because after it the entity is gone and the row is the only way
                // back to what was being carried.
                game::NpcId deadRow = game::kInvalidNpc;
                if (reg.valid(player))
                    if (const auto* nr0 = reg.try_get<game::NpcRef>(player))
                        deadRow = nr0->id;
                // The character sheet, for the same reason and at the same point:
                // after the death point there is no component left to read, and a
                // fresh body would otherwise arrive at level 1. `finalize_deaths`
                // may also LEVEL this up on the killing blow, so the snapshot is
                // taken before it runs and re-taken below when the body survives.
                if (reg.valid(player))
                    if (const auto* rs0 = reg.try_get<game::RpgStats>(player))
                        carriedRpg = *rs0;
                game::loot_dead_mobs(reg, activeLayer, currentFloor,
                                     static_cast<std::uint32_t>(simTick));
                // ONE death point per tick, after everything that can deal damage
                // (combat.h). Nothing else in the tree destroys a damaged entity.
                deaths += game::finalize_deaths(reg, pool, bus, simTick,
                                                &noiseField);
                // Ящики больше НЕ пылесосятся близостью: E открывает экран
                // обыска, забор — заявками Take ([inventory_ui.h]), и там же
                // ведутся loot/containerTake. loot_containers_step остался
                // тест-бэкендом ([container.h]) — из тика он выписан.
                const std::int32_t got =
                    game::pickup_step(reg, pool, bus, activeLayer, simTick);
                if (got != 0) {
                    (void)got; // ценность считает carried; got — для лога ниже
                    // Picking a vest up must actually protect you.
                    game::sync_armour(reg, pool, player);
                }
                // Extraction. The pad is the bank: stand on it and the haul
                // becomes permanently yours. Runs every tick, deposits nothing
                // almost every tick, and that is fine — it is a handful of slot
                // reads. [extraction.h]
                if (reg.valid(player)) {
                    const Transform& ptr_ = reg.get<Transform>(player);
                    if (game::on_extraction_pad(
                            stack.layer(activeLayer).grid(), ptr_.pos)) {
                        if (const auto* nrx = reg.try_get<game::NpcRef>(player))
                            if (pool.valid(nrx->id))
                                game::deposit_valuables(
                                    pool.inventory(nrx->id), ledger);
                    }
                }
                // Save and load. Both are world mutations, so they sit on the sim's
                // clock beside the other intent flags rather than in the event loop.
                if (saveWanted) {
                    saveWanted = false;
                    // The same one-law save the transition autosave uses:
                    // run.sav + the resident floor's own file. [save.h]
                    if (save_run_now())
                        std::snprintf(saveLine, sizeof(saveLine),
                                      "saved: floor %d, %u rub",
                                      currentFloor,
                                      static_cast<unsigned>(ledger.banked));
                    else {
                        char runPath[128];
                        run_save_path(runPath, sizeof runPath);
                        std::snprintf(saveLine, sizeof(saveLine),
                                      "SAVE FAILED: could not write %s", runPath);
                    }
                    saveLineAt = simTick;
                    // Headless --shot proof: HUD is invisible in captures
                    // without a human; stderr is the audit trail. [save.h]
                    std::fprintf(stderr, "[save] %s\n", saveLine);
                }
                // F9 full load: run + floor + cell + armour. APIs live in save.h;
                // this was the only call site that still did a partial field copy and
                // admitted it would not restore position. [save.h]
                if (loadWanted) {
                    // Загрузка = «по сути новая игра» (решение владельца): бейк
                    // в полёте ОТМЕНЯЕТСЯ (узловая гранулярность, join внутри
                    // begin_floor_nav мгновенный) — воркер владеет только
                    // снапшотом битсетов, миру он не опасен. [game/rebake.h]
                    nav.cancel();
                    // Лифтовая поездка в полёте — особый случай: Prebuild-
                    // задание неделимо (restore-чтение файла не опрашивает
                    // отмену), а его слот нужен самой загрузке (keepRadius=0
                    // => физических слоёв ровно два). Дождаться выхода
                    // воркера и вернуть слот; худший случай — секунды
                    // restore-чтения. «F9 во время бейка = отменить и
                    // грузить» — решение владельца (async-rebake.md §9).
                    if (liftRide != LiftRide::Idle) {
                        while (nav.baking()) {
                            nav.step(simTick, g_worldGen);
                            SDL_Delay(2);
                        }
                        (void)nav.take_prebuilt(); // мусор по контракту
                        streamer.prebuild_cancel();
                        liftRide = LiftRide::Idle;
                        // Запись воркера для отменённого этажа — сирота
                        // (~6 МБ на 15k пропов): прибытия не будет, а
                        // корректность держит erase-first в apply_floor_file
                        // (аудит F, жук №3). Чистим гигиены ради.
                        std::lock_guard<std::mutex> lk(g_restoreMx);
                        g_pendingRestore.clear();
                    }
                    // Загрузка читает floor-файлы — фоновый хвост обязан
                    // долететь до диска (5a).
                    flush_floor_write();
                    {
                        loadWanted = false;
                        char runPath[128];
                        run_save_path(runPath, sizeof runPath);
                        game::SaveState in;
                        game::SaveError err = game::SaveError::None;
                        if (!read_run(in, runPath, err)) {
                            // No file and a refused file need different words: one is a
                            // first run, the other is a save the build can no longer read.
                            if (err == game::SaveError::None)
                                std::snprintf(saveLine, sizeof(saveLine),
                                              "no save file (%s)", runPath);
                            else
                                std::snprintf(saveLine, sizeof(saveLine),
                                              "load refused: %s",
                                              game::save_error_text(err));
                        } else if (!spec_for_floor(in.player.floorNumber)) {
                            std::snprintf(saveLine, sizeof(saveLine),
                                          "load refused: floor %d is not registered",
                                          in.player.floorNumber);
                        } else {
                            // `ledger` and `contracts` are references INTO runState, so
                            // this one assignment republishes both without touching a
                            // use site.
                            runState = in;
                            const int savedFloor = runState.player.floorNumber;
                            const std::uint8_t scx = runState.player.cx;
                            const std::uint8_t scy = runState.player.cy;
                            const std::uint8_t scz = runState.player.cz;

                            // FULL WORLD RESTORE, boot-shaped ([save.h] v6): fold
                            // and evict the resident floor, blank the pool, load
                            // the saved SOCIETY, then build the saved floor and
                            // embody from the restored rows. No body survives the
                            // transition, so no body can hold a stale id — the
                            // same reason the main menu loads before anything is
                            // embodied.
                            streamer.unload(stack, registry, reg, pool,
                                            currentFloor);
                            pool.init();
                            if (!runState.poolBlob.empty() &&
                                pool.load_rows(runState.poolBlob.data(),
                                               runState.poolBlob.size())) {
                                // The macro clock and the society's attitudes
                                // come with it.
                                if (!runState.macroBlob.empty() &&
                                    !macroSim.load_state(
                                        runState.macroBlob.data(),
                                        runState.macroBlob.size()))
                                    std::fprintf(stderr,
                                                 "[load] macro blob refused; "
                                                 "clock restarts\n");
                                macroSim.set_floors_from(registry);
                                factionRel = runState.factions;
                            } else {
                                // A save without a society (or a refused blob):
                                // reseed from scratch and say so — the run state
                                // still loads.
                                std::fprintf(stderr,
                                             "[load] pool blob refused; "
                                             "reseeding society\n");
                                streamer.seed_all_modules(pool);
                            }
                            // The restored player ROW is the one that carries the
                            // NpcPlayer bit; the snapshot then reasserts the
                            // authoritative clock/bag/hp on top of it.
                            game::NpcId pid = game::kInvalidNpc;
                            for (game::NpcId i = 0; i < pool.count(); ++i)
                                if (pool.is_player(i) && pool.alive(i)) {
                                    pid = i;
                                    break;
                                }
                            const game::LoadResult lr = streamer.ensure_loaded(
                                stack, registry, reg, pool, savedFloor, pid);
                            currentFloor = savedFloor;
                            currentSpec = spec_for_floor(currentFloor);
                            const LayerId nl = lr.layer;
                            activeLayer = nl;
                            player = pid != game::kInvalidNpc
                                         ? game::embody_as_player(reg, pool, pid,
                                                                  nl)
                                         : lr.player;
                            if (pid != game::kInvalidNpc) {
                                game::apply_player_snapshot(pool, pid,
                                                            runState.player);
                                // Decisions BEFORE the armour sync, or the sync
                                // reads the fresh body's empty cells and strips
                                // the vest the save says is worn. [save.h] eq
                                reg.emplace_or_replace<game::Equipped>(
                                    player, runState.player.eq);
                                game::sync_armour(reg, pool, player);
                            }
                            // Version 7: stamp the sheet onto the body and the
                            // death-surviving carried snapshot, then restore the
                            // crafting bank. embody_as_player may have rolled a
                            // fresh sheet from the record — overwrite it. [save.h]
                            carriedRpg = runState.rpg;
                            if (reg.valid(player))
                                reg.emplace_or_replace<game::RpgStats>(
                                    player, runState.rpg);
                            crafting = runState.craft;
                            // Version 8 / SAVMAG: restore chambered mag (lazy)
                            // and the cumulative kill tally so F9 does not free
                            // the ammo already debited into the magazine, and
                            // does not zero the HUD kills line. [combat.h]
                            kills = runState.kills;
                            if (reg.valid(player)) {
                                if (runState.hasRanged)
                                    reg.emplace_or_replace<game::PlayerRanged>(
                                        player, runState.ranged);
                                if (runState.kills != 0u)
                                    reg.emplace_or_replace<game::PlayerMelee>(
                                        player, game::PlayerMelee{0, runState.kills});
                            }
                            // Version 9 / SAVSTAT: restore live status effects so
                            // F9 mid-haze keeps the same move/aim/melee mults.
                            // Local person-state — direct assignment. [status.h]
                            playerStatus = runState.status;
                            // Version 10 / SAVCLOCK: the samosbor clock is RESTORED,
                            // not re-armed. This line used to read
                            // `samosbor = samosbor_new_game(sbRng)` under the comment
                            // "per-floor clocks reset, same as any arrival" — but a
                            // load is not an arrival, it is a RESUMPTION, and the two
                            // want opposite things. Re-arming meant the standard save
                            // button cancelled the central crisis mechanic: a player
                            // caught mid-Active at |z| = 50 loaded into Idle with the
                            // per-run `count` back at 0, which also reset the fog
                            // roster `MobDef::minSamosbor` unlocks against.
                            // The fast-travel set is restored for the same reason:
                            // discovery is progress, not per-floor channel state.
                            samosbor = runState.samosbor;
                            fastTravel = runState.fastTravel;
                            // SAVBANK: часы процентов перезаводятся на ЖИВОЙ
                            // тик — сим-клок каждой сессии свой, а сохранённый
                            // тик в новой сессии — ложь ([save.h] v16).
                            bankAcct.lastInterestTick = simTick;
                            // Per-floor channels reset, same as any arrival — these
                            // ARE floor-scoped, unlike the two clocks above.
                            rumourLine[0] = 0;
                            rumourAt = 0;
                            game::noise_clear(noiseField);
                            // Тот же порядок прибытия, что у поездки (F9 —
                            // третий сайт того же закона): комнаты РАНЬШЕ
                            // сидеров (F9 объявлял их ПОСЛЕ сева ящиков —
                            // ящики селились по комнатам покинутого этажа),
                            // затем развилка сущностей (записи — из floor-
                            // файла, прочитанного restore-веткой
                            // ensure_loaded, НЕ из run.sav — v20).
                            game::rooms_declare(
                                floorRooms, currentFloor,
                                *spec_for_floor(currentFloor),
                                streamer.floor_seed_of(registry, currentFloor));
                            refresh_floor_mobs(reg, stack.layer(nl), currentFloor,
                                               nl);
                            arrivedRestored =
                                floor_entity_half(nl, currentFloor);
                            // Диффузия: F9 — единственный сайт прибытия, не
                            // звавший контрактную чистку ([diffusion.h]) —
                            // опасность покинутого этажа жила в клетках слота.
                            diffusion_driver_on_floor_built(
                                diffusionDriver, stack.layer(nl), nl);
                            game::rooms_supply_rebuild(floorRooms, reg, nl);
                            game::door_declare(doors, floorRooms, currentFloor,
                           *spec_for_floor(currentFloor),
                           streamer.floor_seed_of(registry, currentFloor));
                            if (!arrivedRestored) dress_lift_portals(nl);
                            begin_floor_nav(stack.layer(nl), currentFloor, nav);
                            if (propPass.ready()) {
                                merge_ecs_prop_meshes(reg, nl, propPass,
                                  streamer.antourage_at_layer(registry, nl),
                                  stack.layer(nl), &dripEmitters);
                upload_wires(verletPass, streamer.antourage_at_layer(registry, nl));
                upload_cloths(verletPass, streamer.antourage_at_layer(registry, nl));
                            }
                            voxelMirror.upload_all(stack.layer(nl));
                            if (mirrorVerify) voxelMirror.verify(stack.layer(nl));

                            game::PlacedCell placed{};
                            if (reg.valid(player)) {
                                placed = game::place_body_at_cell(
                                    reg, stack.layer(nl), player, scx, scy, scz);
                                aim_player(reg, player);
                            }

                            // Honest HUD: place slip / ok, with the society size.
                            if (!placed.ok) {
                                std::snprintf(
                                    saveLine, sizeof(saveLine),
                                    "loaded %u rub floor %d; place refused%s",
                                    static_cast<unsigned>(ledger.banked), currentFloor,
                                    arrivedRestored ? " (floor restored)" : "");
                            } else {
                                std::snprintf(
                                    saveLine, sizeof(saveLine),
                                    "loaded: floor %d @%u,%u,%u, %u rub, %u alive",
                                    currentFloor, static_cast<unsigned>(scx),
                                    static_cast<unsigned>(scy),
                                    static_cast<unsigned>(scz),
                                    static_cast<unsigned>(ledger.banked),
                                    static_cast<unsigned>(pool.alive()));
                            }
                        }
                        saveLineAt = simTick;
                        // Same headless proof trail as save. [save.h]
                        std::fprintf(stderr, "[load] %s\n", saveLine);
                    }
                }
                // (The pad shop is gone — [conversation.md]: trade is a deal
                // with a BODY, not a place. The pad keeps its one job, banking.)
                // CRAFTING. The extraction pad is the only bench in the game today, and
                // that is a measured limitation rather than a placeholder: 259 of the 446
                // recipes (22 `Any` + 237 Workbench) are reachable there, and the other
                // 187 (92 lathe / 77 lab / 18 net_terminal) wait on station placement in
                // floor_gen. Off the pad the player has bare hands, which satisfies the
                // 22 `Any` recipes and nothing else. Disassembly is workbench-only by the
                // reference's rule, so it is pad-only too. [craft.h]
                if ((craftWanted || scrapWanted) && reg.valid(player)) {
                    const Transform& ct = reg.get<Transform>(player);
                    // Zero-heap nearest Terminal (4 m = sqrt(16)). [jirnyak.md] §18
                    const bool nearTerm =
                        game::find_nearest_interactable(
                            reg, player, game::Interactable::Kind::Terminal,
                    game::interact_def(game::InteractKind::Terminal).reachM)
                            .hit;
                    const game::CraftStation bench =
                        game::on_extraction_pad(stack.layer(activeLayer).grid(), ct.pos)
                            ? game::CraftStation::Workbench
                            : (nearTerm ? game::CraftStation::NetTerminal : game::CraftStation::Any);
                    bool invChanged = false;
                    if (const auto* nrk = reg.try_get<game::NpcRef>(player))
                        if (pool.valid(nrk->id)) {
                            game::Inventory& ci = pool.inventory(nrk->id);
                            if (craftWanted) {

                                const game::LearnResult lr =
                                    game::craft_learn_from_carried(crafting, ci);
                                recipesLearned += lr.learned;
                                if (lr.consumed) invChanged = true;
                                if (lr.learned == 0) {
                                    // kInvalidItem is a safe argument here: craft_item
                                    // answers UnknownItem rather than indexing on it.
                                    const game::ItemId pick =
                                        game::craft_best_available(crafting, ci, bench);
                                    if (game::craft_item(crafting, ci, pick, bench).fail ==
                                        game::CraftFail::None) {
                                        ++crafted;
                                        invChanged = true;
                                    }
                                }
                            }
                            if (scrapWanted) {
                                const int slot = game::craft_scrap_slot(ci);
                                // rollKey is uint32_t and simTick is uint64_t, so the
                                // narrowing is explicit. Truncation is harmless and in
                                // fact wanted: this only salts the 50% schematic roll, so
                                // the low bits are the entropy and wrapping every ~4.3e9
                                // ticks (~1.1 sim years at 125 Hz) changes nothing.
                                if (game::craft_disassemble(
                                        crafting, ci, slot, bench,
                                        static_cast<std::uint32_t>(simTick))
                                        .fail == game::CraftFail::None) {
                                    ++scrapped;
                                    invChanged = true;
                                }
                            }
                        }
                    // combat.h: "call after anything that changes the inventory". Crafting
                    // a better vest changes what equipped_armour resolves to, so skipping
                    // this would leave the body wearing the old one.
                    if (invChanged) game::sync_armour(reg, pool, player);
                    craftWanted = false;
                    scrapWanted = false;
                }
                // Contracts advance and pay AFTER the extraction step, so a Fetch
                // job completes at the pad — the same moment the loop's own payoff
                // lands, which is what makes the errand feel like part of the trip
                // rather than a parallel accounting system. [contract.h]
                if (reg.valid(player))
                    if (const auto* nrc = reg.try_get<game::NpcRef>(player))
                        if (pool.valid(nrc->id)) {
                            // The character sheet rides in so a completed job can pay
                            // XP as well as roubles (manifest p.5). It is the LIVE
                            // component, not `carriedRpg`: `award_xp` may level the
                            // body up, and the refresh a few hundred lines below
                            // (`carriedRpg = *rsLive`) then carries that forward, so
                            // the order here is load-bearing rather than incidental.
                            // Absent sheet -> nullptr -> money only, exactly as before.
                            game::RpgStats* rsq = reg.try_get<game::RpgStats>(player);
                            contractPaid += game::contract_step(
                                contracts, pool, pool.inventory(nrc->id), ledger, rsq);
                            questPaid += game::quest_step(
                                quests, pool, pool.inventory(nrc->id), ledger,
                                static_cast<std::uint32_t>(kSimDt * 1000.0f + 0.5f),
                                rsq);
                        }
                // Eating and drinking sit beside healing and AFTER pickup_step, so a
                // ration picked up this tick can be eaten this tick. Both refuse a
                // full bar, so a mistimed press costs nothing; both also fill
                // pendingPee / pendingPoo, which is the ONLY producer the pressure
                // metering has. [needs.h]
                //
                // hpCost is routed through apply_damage rather than dropped:
                // `apply_consumable` deliberately does NOT touch HP and reports the
                // cost for the caller to bill ([needs.h]), clamped so bad food
                // floors at 1 HP. Discarding it would make risky food free, and a
                // gamble with no downside is not a gamble.
                if (eatWanted || drinkWanted) {
                    game::ConsumeResult cr{};
                    if (eatWanted) {
                        cr = game::use_best_food(reg, pool, bus, activeLayer,
                                                 simTick);
                        ateFood += cr.food;
                        eatWanted = false;
                    } else {
                        cr = game::use_best_drink(reg, pool, bus, activeLayer,
                                                  simTick);
                        drankWater += cr.water;
                        drinkWanted = false;
                    }
                    if (cr.used && cr.hpCost > 0 && reg.valid(player)) {
                        game::apply_damage(reg, pool, player, cr.hpCost,
                                           game::DamageChannel::Kinetic, player);
                        consumeHpCost += cr.hpCost;
                    }
                }
                if (healWanted) {
                    healed += game::use_best_heal(reg, pool, bus, activeLayer,
                                                  simTick);
                    healWanted = false;
                }
                // ОСОЗНАННОЕ ОБЛЕГЧЕНИЕ (P): полное опорожнение обеих
                // ёмкостей ([needs.h] relieve_needs), лужа — тем же
                // универсальным стейном, что кровь. Невольный канал
                // (давление на капе) — закон клока нужд, не клавиши.
                if (reliefWanted) {
                    reliefWanted = false;
                    if (reg.valid(player)) {
                        if (const auto* nrr = reg.try_get<game::NpcRef>(player);
                            nrr && pool.valid(nrr->id)) {
                            const game::ReliefResult rr = game::relieve_needs(
                                pool.needs(nrr->id), 100.0f, 100.0f);
                            if (rr.pee > 0.0f) {
                                const vec3 rp = reg.get<Transform>(player).pos;
                                stain_splat(stack.layer(activeLayer), rp,
                                            vec3{0, 0, -1.0f}, 1.4f,
                                            /*rays=*/14, kStainUrine,
                                            static_cast<std::uint32_t>(simTick),
                                            stainDirty);
                            }
                            if (rr.pee > 0.0f || rr.poo > 0.0f) {
                                std::fprintf(stderr,
                                             "[relief] осознанно: pee %.0f "
                                             "poo %.0f\n", rr.pee, rr.poo);
                                // ДЕЯНИЕ «сортир» (S19): облегчение — факт в
                                // шину; в уместной комнате потребитель сам
                                // занулит цену (S19.1.3), здесь ветки нет.
                                game::deed_publish(
                                    bus, game::kVerbToilet, player,
                                    game::kInvalidNpc,
                                    reg.get<Transform>(player).pos, simTick);
                            }
                        }
                    }
                }
                // The player is not exempt: if it died it no longer exists, and
                // everything below reads through it. Take another body now.
                if (!reg.valid(player)) {
                    // Bill the death before taking a new body. The dead pool row
                    // keeps its inventory forever (the pool never reclaims a slot),
                    // so those items are already gone in the only sense that
                    // matters — no living body can reach them. All that was missing
                    // was counting it. [extraction.h]
                    if (pool.valid(deadRow))
                        game::record_death(ledger, pool.inventory(deadRow));
                    // The PlayerMelee component dies with the body; the tally of
                    // what that person killed does not.
                    //
                    // Neither does the character sheet. `embody_as_player` rolls a
                    // fresh RpgStats from the new record — wrong across a DEATH
                    // (losing every level to a bad corridor is not the reference's
                    // rule) and wrong across voluntary possession too (POSRPG
                    // stamps via transfer_player_progression). Death cannot call
                    // that helper: the old body is already gone, so this reads the
                    // value saved off at the top of the death path (carriedRpg).
                    player = possess_a_survivor(reg, pool, activeLayer);
                    if (player == entt::null) { running = false; break; }
                    aim_player(reg, player);
                    reg.emplace_or_replace<game::PlayerMelee>(
                        player, game::PlayerMelee{0, kills});
                    reg.emplace_or_replace<game::RpgStats>(player, carriedRpg);
                } else if (const auto* rsLive = reg.try_get<game::RpgStats>(player)) {
                    // The body SURVIVED the tick. Refresh the snapshot, because
                    // finalize_deaths above may have just awarded XP and levelled it
                    // — without this, a level earned by the killing blow would be
                    // rolled back by the next death.
                    carriedRpg = *rsLive;
                }
                ++simTick;
                // THE MACRO CLOCK. kMacroPeriodTicks = kSimHz*2 = 250, which is
                // exactly 2.000 s at 125 Hz — kSimStepMs is exactly 8 ms, so the
                // period is lossless and cannot drift. Placed after ++simTick so the
                // first fire is tick 250 and not tick 0, before the world is embodied.
                // The coarse clock (tick_/dayTenths_) lives inside MacroSim, so main
                // holds no accumulator of its own.
                //
                // The live `factionRel` is lent, never copied: the social pass is the
                // only reader and it stays gated off while socialFormRatePerYear is 0
                // (that pass demands a 128 MiB rel_ column — see [npc_pool.h] — and
                // nothing renders the graph yet). Passing the real matrix now means
                // that when social is switched on it reads the one true source of
                // attitudes instead of a second, silently diverging copy. [macrosim.md]
                if (simTick % game::kMacroPeriodTicks == 0) {
                    macroStats = macroSim.step(pool, macroParams, &factionRel);
                    // The world lives whether or not anyone is looking, and this line
                    // is the proof: a headless run shows the population moving with no
                    // HUD and no window. One line per macro tick, so ~30/minute.
                    std::fprintf(stderr,
                                 "[macro] tick=%llu day=%.1f living=%u births=%u "
                                 "deaths=%u blocked=%u depart=%u arrive=%u "
                                 "transit=%u reserve=%u\n",
                                 static_cast<unsigned long long>(macroStats.tick),
                                 macroSim.day(), macroStats.living, macroStats.births,
                                 macroStats.deaths, macroStats.birthsBlocked,
                                 macroStats.departures, macroStats.arrivals,
                                 macroStats.inTransit, macroStats.reserveRemaining);
                }
                // Вода/газ: их двигает МИР-АВТОМАТ на GPU (S16, единственный
                // двигатель материи); мёртвый CPU fluid_step и его поле
                // вычищены 2026-08-24 — вода наливается генератором материей
                // и живёт правилом.
                simNow += kSimDt;
                simAccum -= kSimDt;
            }
            prof_add(kProfTick, profTickT0);
        }

        // --- render --------------------------------------------------------
        int fbw = 0, fbh = 0;
        SDL_GetWindowSizeInPixels(window, &fbw, &fbh);
        float aspect = fbh > 0 ? static_cast<float>(fbw) / fbh : 1.0f;
        const vec3 worldUp = (activeLayer != kInvalidLayer)
            ? stack.layer(activeLayer).gravity().up_vector()
            : vec3{0.0f, 0.0f, 1.0f};
        CameraMatrices camMat = compute_camera(reg, aspect, worldUp);

        hud.begin_frame();
        // Худ ИГРОКА ([hud_ui.h]) — таблица элементов по углам стекла. Только
        // в Playing: пауза показывает меню, заставка — ничего. Рисуется и при
        // открытом окне/консоли — стекло не гаснет от того, что поверх него
        // подняли аппаратуру.
        // Табличка интеракции — элемент худа ([hud_ui.h]); буфер живёт кадр
        // рендера, пока hud_ui_draw не отрисует строку.
        char interactBuf[96];
        if (shell.screen == AppScreen::Playing) {
            HudContext hctx;
            hctx.reg = &reg;
            hctx.pool = &pool;
            hctx.player = player;
            hctx.status = &playerStatus;
            hctx.samosbor = &samosbor;
            hctx.needsTick = &needs;
            hctx.tick = simTick;  // часы дома ([core/watch.h], S15)
            // ЕДИНАЯ ТАБЛИЧКА ([game/focus.h], решение владельца 2026-08-28):
            // под прицелом ровно одна цель, текст — из таблицы интерактивов
            // (или состояния двери), клавиша — из биндов. Жила отдельным
            // окном под showHud — флагом ДЕБАГ-панели: игрок с чистым худом
            // не видел «F» никогда. Теперь это элемент стекла.
            if (shell.playing() && reg.valid(player) &&
                activeLayer != kInvalidLayer) {
                if (const char* what = game::focus_prompt(
                        g_focus, stack.layer(activeLayer), doors)) {
                    std::snprintf(interactBuf, sizeof interactBuf, "[%s]  %s",
                                  bind_key("interact"), what);
                    hctx.interactPrompt = interactBuf;
                }
            }
            // Среда клетки под телом — из АГРЕГАТА автомата (S16.4): один
            // путь для HUD, дыхания и плавучести, спецсистем нет (S16.6).
            if (reg.valid(player) && activeLayer != kInvalidLayer) {
                const vec3& gp = reg.get<Transform>(player).pos;
                const std::uint32_t lvl = medium_level_at(
                    stack.layer(activeLayer),
                    macro_index(wrap_macro(static_cast<int>(
                                    std::floor(gp.x / kCellSize))),
                                wrap_macro(static_cast<int>(
                                    std::floor(gp.y / kCellSize))),
                                wrap_macro(static_cast<int>(
                                    std::floor(gp.z / kCellSize)))));
                hctx.gas.water = static_cast<std::uint16_t>(lvl & 0xFFFFu);
                hctx.gas.gas = static_cast<std::uint16_t>(lvl >> 16);
                hctx.gas.valid = true;
            }
            hud_ui_draw(hctx);
        }
        // Дебаг-панель — только в игре и паузе: поверх заставки и главного
        // меню ей не место (плейтест владельца: «меню всратое» — панель со
        // статами закрывала пол-экрана и титул).
        if (showHud && (shell.screen == AppScreen::Playing ||
                        shell.screen == AppScreen::Pause))
        {
            ImGui::SetNextWindowPos(ImVec2(10, 10), ImGuiCond_FirstUseEver);
            ImGui::Begin("gigahrush2");
            // Разрешение — рядом с FPS: вся по-пиксельная работа света
            // множится на эту площадь, и вопрос «в чём мы вообще рисуем» не
            // должен решаться скриншотом (macOS снимает их всегда в нативных
            // пикселях Retina, независимо от свапчейна).
            ImGui::Text("%.1f FPS (%.2f ms) @ %dx%d (%.1f Mpx)",
                        frameDt > 0 ? 1.0f / frameDt : 0.0f, frameDt * 1000.0f,
                        fbw, fbh, static_cast<float>(fbw) * fbh * 1e-6f);
#ifndef NDEBUG
            // A slow frame must never be mistaken for a code regression when it
            // is really an unoptimized tree (see the [build] line at launch).
            ImGui::TextColored(ImVec4(0.95f, 0.78f, 0.25f, 1.0f), "%s", kBuildKind);
#endif
            ImGui::Text("cpu record: cube %.2f ms | body %.2f ms", cubeMs, bodyMs);
            ImGui::Text("mirror: dirty %u | up %u cells %.1f KiB | pages %u%s",
                        voxelMirror.dirty_backlog(),
                        voxelMirror.last_flush_cells(),
                        static_cast<double>(voxelMirror.last_flush_bytes()) /
                            1024.0,
                        voxelMirror.pages_in_pool(),
                        voxelMirror.page_overflowed() ? " OVERFLOW" : "");
            // Real GPU time, per pass, from timestamp queries — NOT the frame
            // time above. The frame time is wall-clock around sim + crowd + HUD
            // + the FIFO present wait, so it sits pinned at the vsync period
            // whenever the machine keeps up and cannot see a change below the
            // cap. This line can: it is the GPU's own clock across each pass's
            // draws. Median of 31 frames, and two frames stale by construction
            // (gpu_timer.h). Read it before claiming a shader change is free.
            // Three decimals, not two: the body and HUD passes land in the single
            // microseconds, and printing those as "0.00" reads as "not measured"
            // — the exact false-confidence this whole module exists to remove.
            if (renderer.timer.supported()) {
                ImGui::Text("gpu: world %.3f | bodies %.3f | props %.3f | "
                            "sim %.3f | hud %.3f | frame %.3f ms",
                            renderer.timer.pass_ms(gpu::GpuPass::World),
                            renderer.timer.pass_ms(gpu::GpuPass::Bodies),
                            renderer.timer.pass_ms(gpu::GpuPass::Props),
                            renderer.timer.pass_ms(gpu::GpuPass::SimPhysics),
                            renderer.timer.pass_ms(gpu::GpuPass::Hud),
                            renderer.timer.frame_ms());
                // The median above is DESIGNED to hide spikes — it takes 16 slow frames
                // out of 31 to move it — so it cannot see a hitch. This line is the WORST
                // frame in the same window. A peak that moved while the median did not is
                // a stutter; both moving together is a real cost change. `drop` must stay
                // at 0: a growing value means every figure above is computed over a stale
                // window and none of them mean anything. [gpu_timer.h]
                ImGui::Text("gpu peak: world %.3f | bodies %.3f | props %.3f | "
                            "sim %.3f | hud %.3f | frame %.3f ms | drop %u",
                            renderer.timer.pass_ms_max(gpu::GpuPass::World),
                            renderer.timer.pass_ms_max(gpu::GpuPass::Bodies),
                            renderer.timer.pass_ms_max(gpu::GpuPass::Props),
                            renderer.timer.pass_ms_max(gpu::GpuPass::SimPhysics),
                            renderer.timer.pass_ms_max(gpu::GpuPass::Hud),
                            renderer.timer.frame_ms_max(), renderer.timer.dropped());
            } else {
                // Deliberately no longer "queue family writes no timestamps": supported()
                // is now ALSO false when the timer was switched off with GIGA_GPU_TIMER=0,
                // and blaming the queue family in that case would be a lie.
                ImGui::TextUnformatted(
                    "gpu: n/a (no timestamps, or GIGA_GPU_TIMER=0)");
            }
            // GUARDED, because `player` can legitimately be null HERE. When the
            // last living body on the layer dies, `possess_a_survivor` returns
            // null and the sim loop does `running = false; break;` — but that
            // `break` leaves the FIXED-STEP LOOP, not the frame, so execution
            // walks straight on into this HUD. Three unchecked `reg.get<>` on a
            // null entity followed: with -fno-exceptions and EnTT's asserts
            // compiled out in Release that is a raw out-of-bounds sparse-set
            // read, i.e. a crash at the exact moment a run ends. The other 48
            // uses of `player` in this file test validity; these did not.
            // [problems.md] §28.1
            if (reg.valid(player)) {
                const auto& tr = reg.get<Transform>(player);
                const auto& ctl = reg.get<Controller>(player);
                const auto& ga = reg.get<GravityAffected>(player);
                ImGui::Text("pos  %.1f %.1f %.1f (layer %u)", tr.pos.x, tr.pos.y,
                            tr.pos.z, tr.layer);
                ImGui::Text("mode %s%s", ctl.fly ? "fly" : "walk",
                            ga.grounded ? " (grounded)" : "");
            } else {
                ImGui::TextUnformatted("pos  -- (no body: run over)");
                ImGui::TextUnformatted("mode --");
            }
            ImGui::Text("props %u | cull %s",
                        propPass.last_draw_count(),
                        cullPass.ready() ? "GPU-ready" : "off");
            // Antourage — the binary "is it even there" line (owner's ask):
            // baked pipe legs/joints + wire chains on THIS floor, straight from
            // the resident bake. 0/0/0 = the bake did not run or was evicted.
            {
                const game::AntourageBake* hudAb =
                    streamer.antourage_at_layer(registry, activeLayer);
                ImGui::Text("antourage: %zu instances | %zu wires (gpu %u) | "
                            "%zu cloths (gpu %u)",
                            hudAb ? hudAb->instances.size() : 0,
                            hudAb ? hudAb->wires.size() : 0,
                            verletPass.chain_count(),
                            hudAb ? hudAb->cloths.size() : 0,
                            verletPass.sheet_count());
                ImGui::Text("particles: %u alive / %u spawned | %zu drip emitters",
                            verletPass.particle_alive_count(),
                            verletPass.particle_spawned_total(),
                            dripEmitters.size());
            }
            std::int16_t php = 0, pmax = 0;
            if (game::entity_health(reg, pool, player, php, pmax))
                if (pmax > 0) {
                    const float frac = static_cast<float>(php) /
                                       static_cast<float>(pmax);
                    // Service-equipment status bar: hard-edged phosphor-green fill
                    // (no glow), amber when critical, dark when dead. taste.md:
                    // important status gets its own bar, not an overlay drawn over
                    // the gameplay zone.
                    if (php <= 0)
                        ImGui::PushStyleColor(ImGuiCol_PlotHistogram,
                            ImVec4(0.30f, 0.05f, 0.05f, 1.00f)); // dead
                    else if (frac <= 0.25f)
                        ImGui::PushStyleColor(ImGuiCol_PlotHistogram,
                            ImVec4(0.95f, 0.78f, 0.25f, 1.00f)); // critical amber
                    else
                        ImGui::PushStyleColor(ImGuiCol_PlotHistogram,
                            ImVec4(0.349f, 0.949f, 0.400f, 1.00f)); // phosphor
                    ImGui::ProgressBar(frac, ImVec2(220.0f, 14.0f), "");
                    ImGui::PopStyleColor();
                    ImGui::SameLine();
                    ImGui::Text("HP %d / %d%s", php, pmax, php <= 0 ? "  DEAD" : "");
                }
            {
                const std::uint16_t mv = game::status_move_mult_e3(playerStatus);
                const bool rooted = game::status_is_rooted(playerStatus);
                if (mv != 1000 || rooted ||
                    game::status_active(playerStatus, game::StatusId::SporeHaze) ||
                    game::status_active(playerStatus, game::StatusId::ZhelemishSkin) ||
                    game::status_active(playerStatus, game::StatusId::PaupsinaWeb)) {
                    ImGui::Text("status move_e3=%u aim_e3=%u rooted=%d",
                                mv, game::status_aim_mult_e3(playerStatus),
                                rooted ? 1 : 0);
                }
            }
            if (reg.valid(player))
                if (const auto* pm = reg.try_get<game::PlayerMelee>(player))
                    kills = pm->kills;
            ImGui::Text("hits taken: %u | deaths: %u | kills: %u", meleeHits,
                        deaths, kills);
            // Character sheet. ASCII only, like every other printf/ImGui string in
            // this file — the Windows console is CP1251 and Cyrillic here mojibakes.
            if (reg.valid(player))
                if (const auto* rs = reg.try_get<game::RpgStats>(player)) {
                    const std::uint32_t need =
                        rs->level < game::kRpgLevelCap
                            ? game::xp_for_level(
                                  static_cast<std::uint8_t>(rs->level + 1))
                            : 0u;
                    if (need > 0)
                        ImGui::Text("LVL %u  XP %u / %u", rs->level, rs->xp, need);
                    else
                        ImGui::Text("LVL %u  (MAX)", rs->level);
                    ImGui::Text("STR %u  AGI %u  INT %u%s",
                                rs->attr[0], rs->attr[1], rs->attr[2],
                                rs->attrPoints > 0 ? "   [+pts]" : "");
                    ImGui::Text("PSI %u / %u", rs->psi, game::max_psi(*rs));
                }
            {
                std::int32_t carried = 0;
                int slots = 0;
                const game::NpcRef* nr = reg.valid(player)
                                             ? reg.try_get<game::NpcRef>(player)
                                             : nullptr;
                if (nr && pool.valid(nr->id)) {
                    const game::Inventory& inv = pool.inventory(nr->id);
                    carried = game::inventory_value(inv);
                    for (const auto& sl : inv.slots)
                        if (sl.item != 0) ++slots;

                    // The player's HUD shows the player's DECISION, not a scan:
                    // fists until `equip` says otherwise. [equip.h]
                    const game::Equipped* peq =
                        reg.try_get<game::Equipped>(player);
                    const game::ItemId wpn = game::equipped_melee(inv, peq);
                    const game::ItemId arm = game::equipped_armour(inv, peq);
                    const game::MeleeDef* md = game::melee_for_item(wpn);
                    if (!md) md = &game::unarmed_melee();
                    // The firearm, when there is one. Named separately from the
                    // melee line because they are different loadout slots, not two
                    // spellings of the same one.
                    if (const game::ItemId g_ = game::equipped_ranged(inv, peq)) {
                        const game::RangedDef* rd = game::ranged_for_item(g_);
                        const auto* prs = reg.try_get<game::PlayerRanged>(player);
                        if (rd)
                            ImGui::Text("gun: %s  %u x%u dmg  %u/%u mag  "
                                        "%u shots %u hits",
                                        game::item_name(g_), rd->dmg, rd->pellets,
                                        prs ? (prs->hand[0].weapon == g_
                                                   ? prs->hand[0].magCount
                                                   : prs->hand[1].magCount)
                                            : 0,
                                        rd->magazine,
                                        prs ? prs->shots : 0, prs ? prs->hits : 0);
                    }
                    {
                        // rs above is scoped to the character-sheet if; re-fetch
                        // here so melee HUD shows RPG-scaled damage (RPGCMBT).
                        std::uint16_t shownDmg = md->dmg;
                        if (const auto* rsHud =
                                reg.try_get<game::RpgStats>(player)) {
                            const std::int16_t scaled = game::melee_damage(
                                *rsHud, wpn,
                                static_cast<std::int16_t>(md->dmg));
                            shownDmg = static_cast<std::uint16_t>(
                                scaled > 1 ? scaled : std::int16_t{1});
                        }
                        ImGui::Text("weapon: %s (%u dmg) | armour: %s",
                                    wpn == game::kInvalidItem ? "fists"
                                                              : game::item_name(wpn),
                                    shownDmg,
                                arm == game::kInvalidItem ? "none"
                                                          : game::item_name(arm));
                    }
                }
                {
                    const float share = game::risk_share(ledger, carried);
                    ImGui::Text("BANKED %lld rub | at risk %d (%.0f%% of the run)",
                                static_cast<long long>(ledger.banked), carried,
                                share * 100.0f);
                    ImGui::Text("lost to death %lld | best haul %d | deepest %d (E%u)",
                                static_cast<long long>(ledger.lostToDeath),
                                ledger.bestHaul, ledger.deepestFloor,
                                ledger.deepestBand);
                }
                // Which body you are wearing, and whether the floor wants to eat
                // it. Printed because the mechanic is invisible otherwise: a cultist
                // simply is not attacked, and with no readout that looks like the
                // monsters are broken rather than like safety.
                if (nr && pool.valid(nr->id)) {
                    const auto f = static_cast<game::Faction>(
                        pool.faction(nr->id) % game::kFactionCount);
                    if (game::mob_hostile_to(pool, nr->id))
                        ImGui::Text("body: %s  (hunted)", game::faction_name(f));
                    else
                        ImGui::TextColored(ImVec4(0.29f, 0.75f, 0.57f, 1.0f),
                                           "body: %s  (monsters ignore you)",
                                           game::faction_name(f));
                }
                if (reg.valid(player)) {
                    const Transform& vt2 = reg.get<Transform>(player);
                    if (game::on_extraction_pad(stack.layer(activeLayer).grid(),
                                                vt2.pos))
                        ImGui::TextColored(ImVec4(0.29f, 0.75f, 0.57f, 1.0f),
                                           "PAD: banking");
                }
                {
                    int shut = 0, open = 0;
                    for (auto ce : reg.view<const game::Container, const Transform>()) {
                        if (reg.get<const Transform>(ce).layer != activeLayer) continue;
                        if (reg.get<const game::Container>(ce).opened) ++open;
                        else ++shut;
                    }
                    ImGui::Text("crates %d unopened / %d emptied | took %d rub",
                                shut, open, containerTake);
                }
                // Doors: built/shut/broken, plus how many bodies are leaning on one
                // right now. `pressing` is the number that makes a shut door read as
                // a consumable resource rather than a wall — you can watch it fall.
                // What the last save or load said, for ~6 s. A save that fails silently
                // is a save the player only finds out about by losing a run.
                if (saveLine[0] && simTick - saveLineAt < 6u * kSimHz)
                    ImGui::TextUnformatted(saveLine);
                ImGui::Text("loot %d rub (%d/%d slots) | healed %d | band E%u",
                            carried, slots, game::kInvSlots, healed,
                            game::economy_band(currentFloor));
                // CARRIED WEIGHT — the reader `ItemDef::massG` exists for. Slots
                // alone never said what a load-out COSTS: sixty rifle rounds and
                // sixty documents each occupy one slot and are 0.96 kg against
                // 1.5 kg of paper.
                //
                // The budget is THIS BODY's, not a constant: 64 kg + 4 kg per point
                // of Strength ([rpg.h] carry_capacity_g). Printed with the Str that
                // produced it, because a number that moves when you level up should
                // say why on the same line.
                if (reg.valid(player)) {
                    if (const auto* nr = reg.try_get<game::NpcRef>(player)) {
                        if (pool.valid(nr->id)) {
                            const std::uint32_t heldG =
                                game::inventory_mass_g(pool.inventory(nr->id));
                            // The sheet is an ECS component, not a pool column
                            // ([combat.h] "RpgStats: copy from -> to"), so a body
                            // with none reads as Str 0 rather than as no budget.
                            const game::RpgStats rs =
                                reg.all_of<game::RpgStats>(player)
                                    ? reg.get<game::RpgStats>(player)
                                    : game::RpgStats{};
                            const std::uint32_t capG = game::carry_capacity_g(rs);
                            const game::EncumbranceEffect& ee =
                                encumbrance.playerEffect;
                            // The CONSEQUENCES, not just the number. A HUD that
                            // says OVERLOADED and nothing else leaves the player
                            // guessing what it cost; these are the three live
                            // multipliers ([encumbrance.h]).
                            ImGui::Text(
                                "weight %.1f / %.0f kg (64 + 4 x STR %u) | "
                                "pace x%.2f | noise x%.2f%s",
                                static_cast<double>(heldG) / 1000.0,
                                static_cast<double>(capG) / 1000.0,
                                static_cast<unsigned>(
                                    rs.attr[static_cast<std::size_t>(game::Attr::Str)]),
                                static_cast<double>(ee.speedScale),
                                static_cast<double>(ee.noiseMult),
                                ee.overloaded ? "  OVERLOADED" : "");
                        }
                    }
                }
                // Crafting, on screen: C builds or reads, X strips. `bank` is the 8-axis
                // material vector summed, because eight numbers on the HUD would be noise
                // — the per-axis detail is what the craft menu is for when one exists.
                // Tier only rises by reading a blueprint, so it is the one number here
                // that reports progression rather than activity.
                std::uint32_t bankTotal = 0;
                for (std::size_t mi = 0; mi < game::kCraftMaterials; ++mi)
                    bankTotal += crafting.mat[mi];
                ImGui::Text("craft T%u | %u made / %u stripped / %u learned | %u units "
                            "banked  (C build, X strip)",
                            static_cast<unsigned>(crafting.tier), crafted, scrapped,
                            recipesLearned, bankTotal);
                // The macro society, on screen. `living` is the WHOLE cold population,
                // not the handful embodied on this floor, so this number moving is the
                // visible proof that the world runs on its own clock. It updates once
                // every kMacroPeriodTicks (2.000 s), so it deliberately does not track
                // the frame.
                ImGui::Text("society %u alive | +%u births / -%u deaths | %u in transit"
                            "%s",
                            macroStats.living, macroStats.births, macroStats.deaths,
                            macroStats.inTransit,
                            macroStats.birthsBlocked != 0
                                ? "  (RESERVE FLOOR: births refused)"
                                : "");
                ImGui::Text("day %.1f | macro tick %llu | feud hits %u | "
                            "relations %u kills / %u shifts",
                            macroSim.day(),
                            static_cast<unsigned long long>(macroStats.tick), feudHits,
                            relTick.kills, relTick.changes);
                // `ai/wander` — single-writer split: те двое не бывают
                // ненулевыми на одном теле в один тик (suite_utilai). Ветка
                // «off (dormant)» была недостижима (enabled константно true
                // с включения толпы) — врущий тернарник убит (К1-15). [ai.h]
                ImGui::Text("ai ON | %u seen / %u replan / %u switch | own ai %u / wander %u"
                            " | mem %u recall / %u filed / %u fled",
                            aiTick.considered,
                            aiTick.replanned, aiTick.switches, aiTick.aiOwned,
                            aiTick.wanderOwned, aiTick.recalled, aiTick.remembered,
                            aiTick.memoryFled);
            }
            // Nearest monster, by name. Doubles as the proof that the Cyrillic font
            // actually loaded: every one of the 69 names is Russian.
            {
                const char* threat = nullptr;
                float bestD2 = 1e30f;
                std::int16_t thp = 0, tmax = 0;
                if (reg.valid(player)) {
                    const vec3 me = reg.get<Transform>(player).pos;
                    for (auto me_ : reg.view<const game::MobRef, const Transform>()) {
                        const Transform& t = reg.get<const Transform>(me_);
                        if (t.layer != activeLayer) continue;
                        const float dx = wrap_delta_f(me.x, t.pos.x, kWorldExtent);
                        const float dy = wrap_delta_f(me.y, t.pos.y, kWorldExtent);
                        const float dz = wrap_delta_f(me.z, t.pos.z, kWorldExtent);
                        const float d2 = dx * dx + dy * dy + dz * dz;
                        if (d2 >= bestD2) continue;
                        bestD2 = d2;
                        const game::MobRef& m = reg.get<const game::MobRef>(me_);
                        threat = game::mob_name(static_cast<game::MobKind>(m.kind));
                        thp = m.hp;
                        tmax = m.maxHp;
                    }
                }
                if (threat)
                    ImGui::Text("nearest: %s  %d/%d hp  %.1f m", threat, thp, tmax,
                                std::sqrt(bestD2));
                else
                    ImGui::TextUnformatted("nearest: -");
            }
            // The loudest recent noise, and how far away it is. Without this the whole
            // system is invisible: a monster walking toward a gunshot looks exactly
            // like a monster wandering, and "a change nobody can see" is
            // indistinguishable from a no-op. Reported from the PLAYER's ear with no
            // hearing bonus and no severity floor, so it shows what is actually in the
            // field rather than what a monster would bother with. [noise.h]
            {
                float nd = 0.0f;
                const game::Noise* ln = reg.valid(player)
                    ? game::loudest_heard(noiseField, activeLayer,
                                          reg.get<Transform>(player).pos,
                                          /*hearingMult=*/1.0f, /*minSeverity=*/0,
                                          /*ignoreActor=*/0, &nd,
                                          noiseAcoustics.get())
                    : nullptr;
                if (ln)
                    ImGui::TextColored(ImVec4(0.98f, 0.79f, 0.55f, 1.0f),
                                       "NOISE %s sev%u  %.1f m of %.0f  %.2f s left"
                                       "  | %u live, %u investigating",
                                       game::noise_source_name(
                                           static_cast<game::NoiseSource>(ln->source)),
                                       ln->severity, nd, ln->radius,
                                       ln->ttlMs * 0.001f,
                                       static_cast<unsigned>(noiseField.live()),
                                       heardMobs);
                else
                    ImGui::Text("noise: - (%u live, %u dropped)",
                                static_cast<unsigned>(noiseField.live()),
                                noiseField.dropped);
            }
            {
                const auto ph = static_cast<game::SamosborPhase>(samosbor.phase);
                const float fogScale = samosbor_fog_scale(samosbor);
                const bool danger =
                    ph == game::SamosborPhase::Warning ||
                    ph == game::SamosborPhase::Active;
                // Red only for the two phases that actually threaten you. The colour
                // is reserved for danger ([faction.h]) and spending it on Idle would
                // spend it on nothing.
                if (danger)
                    ImGui::TextColored(ImVec4(0.90f, 0.31f, 0.36f, 1.0f),
                                       "SAMOSBOR %s  %s  %.0f%%  (%.1f s left)",
                                       game::samosbor_phase_name(ph),
                                       game::samosbor_variant_name(
                                           static_cast<game::SamosborVariant>(
                                               samosbor.variant)),
                                       game::samosbor_phase01(samosbor) * 100.0f,
                                       samosbor.phaseMs * 0.001f);
                else
                    // "to warning" is only true of Idle. In Aftermath phaseMs is the
                    // aftermath's own remainder and the warning is a whole cooldown
                    // away, so labelling both the same way printed a wrong number —
                    // caught by reading my own HUD in a screenshot, not by a test.
                    ImGui::Text("samosbor %s  (%.0f s %s)",
                                game::samosbor_phase_name(ph),
                                samosbor.phaseMs * 0.001f,
                                ph == game::SamosborPhase::Idle ? "to warning"
                                                                : "left");
                ImGui::Text("duty here %.1f%% | cycles %u | fog x%.2f | took %d hp",
                            game::samosbor_duty01(currentFloor) * 100.0f,
                            samosborCycles, fogScale, samosborDamage);
                if (elevDiagLine[0] && simTick - elevDiagAt < 8u * kSimHz)
                    ImGui::TextColored(ImVec4(0.35f, 0.85f, 1.0f, 1.0f), "%s", elevDiagLine);
                // Среда клетки под камерой — читатель агрегата автомата
                // ([world/medium.h], S16.4): кванты жидкости и газа.
                if (reg.valid(player) && activeLayer != kInvalidLayer) {
                    const vec3& gp = reg.get<Transform>(player).pos;
                    const std::uint32_t lvl = medium_level_at(
                        stack.layer(activeLayer),
                        macro_index(wrap_macro(static_cast<int>(
                                        std::floor(gp.x / kCellSize))),
                                    wrap_macro(static_cast<int>(
                                        std::floor(gp.y / kCellSize))),
                                    wrap_macro(static_cast<int>(
                                        std::floor(gp.z / kCellSize)))));
                    ImGui::Text("medium: water %u gas %u (кванты клетки)",
                                lvl & 0xFFFFu, lvl >> 16);
                }
            }
            {
                const game::Needs& nd = [&]() -> const game::Needs& {
                    static game::Needs blank{};
                    if (reg.valid(player))
                        if (const auto* nr_ = reg.try_get<game::NpcRef>(player))
                            if (pool.valid(nr_->id)) return pool.needs(nr_->id);
                    return blank;
                }();
                // Minutes, not percent: the decision this clock exists to force is
                // "do I have time for one more floor", and that is asked in minutes.
                const float toDmg = game::needs_seconds_to_damage(nd);
                const bool warn = needs.warned != 0 || needs.failed != 0;
                if (warn)
                    ImGui::TextColored(ImVec4(0.90f, 0.31f, 0.36f, 1.0f),
                                       "NEEDS food %.0f water %.0f sleep %.0f"
                                       "  | %.1f min to damage%s",
                                       nd.food, nd.water, nd.sleep, toDmg / 60.0f,
                                       needs.failed ? "  BLEEDING" : "");
                else
                    ImGui::Text("needs food %.0f water %.0f sleep %.0f"
                                "  | %.1f min to damage",
                                nd.food, nd.water, nd.sleep, toDmg / 60.0f);
                ImGui::Text("pressure pee %.0f poo %.0f | speed x%.2f | starved %d hp",
                            nd.pee, nd.poo, needs.speedScale, needsHpLost);
                // The PENDING queues, not just the bars: pee/poo have no autonomous
                // growth, so without the queue on screen the pressure numbers look
                // frozen when they are in fact many minutes of metering from 100.
                ImGui::Text("ate %.0f food %.0f water | pending pee %.0f poo %.0f | risky -%d hp",
                            ateFood, drankWater, nd.pendingPee, nd.pendingPoo,
                            consumeHpCost);
            }
            {
                int active = 0;
                for (int i = 0; i < game::kMaxContracts; ++i) {
                    const game::Contract& c = contracts.slot[i];
                    if (c.state != static_cast<std::uint8_t>(
                                      game::ContractState::Active))
                        continue;
                    ++active;
                    char line[200];
                    if (game::contract_text(c, line, sizeof(line)))
                        ImGui::Text("  job: %s  [%d/%d]", line,
                                    static_cast<int>(c.progress),
                                    static_cast<int>(c.target));
                }
                if (offerLine[0])
                    ImGui::TextColored(ImVec4(0.98f, 0.82f, 0.35f, 1.0f),
                                       "OFFER (E to take): %s", offerLine);
                if (questOfferLine[0])
                    ImGui::TextColored(ImVec4(0.70f, 0.98f, 0.60f, 1.0f),
                                       "QUEST (E to take): %s", questOfferLine);
                ImGui::Text("jobs %d active | %u done | %u failed | paid %d rub",
                            active, contracts.completed, contracts.failed,
                            contractPaid);
                // Active quests — each row reports title + progress + time left.
                const int qActive = game::quest_active_count(quests);
                if (qActive > 0) {
                    ImGui::Separator();
                    ImGui::Text("quests %d active | paid %d rub", qActive, questPaid);
                    for (int qi = 1; qi <= static_cast<int>(game::kQuestCount); ++qi) {
                        char qline[320];
                        const game::QuestId qid = static_cast<game::QuestId>(qi);
                        if (game::quest_line(quests, qid, qline, sizeof(qline)))
                            ImGui::TextColored(ImVec4(0.70f, 0.98f, 0.60f, 1.0f),
                                               "  quest: %s", qline);
                    }
                }
            }
            if (rumourLine[0])
                ImGui::TextColored(ImVec4(0.40f, 0.85f, 0.91f, 1.0f), "\"%s\"",
                                   rumourLine);
            // Tan, NOT rumour's cyan, and prefixed with the situation so the two channels
            // are distinguishable at a glance. #cca is the reference's own authored bark
            // colour, and keeping them different is what stops a murmur from reading as a
            // checkable fact. [speech.h]
            if (speechLine != nullptr)
                ImGui::TextColored(ImVec4(0.80f, 0.80f, 0.67f, 1.0f), "[%s] %s",
                                   game::speech_situation_name(speechSit), speechLine);
            ImGui::Text("nav: %s  (last bake %.0f + %.0f ms, async)",
                        nav.baking() ? "BAKING - crowd idle"
                                     : (nav.ready() ? "ready" : "none"),
                        nav.last_coarse_ms(), nav.last_fine_ms());
            ImGui::Text("mobs: %u live on this floor",
                        game::count_layer_mobs(reg, activeLayer));
            // `alive`, not `count`: count() is the high-water mark of slots ever
            // handed out and cannot decrease, so it was reporting a population that
            // never fell no matter how many died.
            ImGui::Text("bodies drawn: %u  (pop %u alive / %u ever / %u slots)",
                        bodyPass.last_instance_count(), pool.alive(), pool.count(),
                        pool.capacity());
            ImGui::Text("floor %d: %s (target pop %u)", currentFloor,
                        currentSpec ? currentSpec->name : "?",
                        currentSpec ? currentSpec->population : 64u);
            // The coarse society tick's last report ([macro_sim.h]).
            // `macroSim.tick()` is 0 until the first step
            // lands ~2 s in, so this reads "warming up" rather than a row of zeroes
            // that looks broken. births/deaths are this step's tallies; in-transit is
            // the live migration backlog; reserve is the birth headroom the pool will
            // never reclaim (the design-scale wall lives here, macro_sim.h banner).
            {
                if (macroSim.tick() == 0)
                    ImGui::Text("society: warming up (first macro tick at %.1f s)",
                                static_cast<float>(game::kMacroPeriodTicks) *
                                    kSimDt);
                else
                    ImGui::Text("society: %u living  +%u/-%u  %u in transit  "
                                "| reserve %u  (t%llu, day %.1f)",
                                macroStats.living, macroStats.births,
                                macroStats.deaths, macroStats.inTransit,
                                macroStats.reserveRemaining,
                                static_cast<unsigned long long>(macroStats.tick),
                                macroSim.day());
            }
            // `fly` — консольная команда без клавиши (решение владельца);
            // строка обязана говорить правду о том, где полёт живёт СЕЙЧАС.
            ImGui::TextUnformatted(
                "WASD move | mouse look | Tab toggle look | Space jump | "
                "~ console (fly) | Q door | G eat | T drink | F5/F9 save/load | [ / ] floor | Esc menu");
            ImGui::End();
        }

        // --- Interactive ImGui Crafting Workbench & Trader Windows ---
        // ── Debug console (~) ──────────────────────────────────────────
        // Context is refreshed every frame (player/floor move under it), the
        // window draws whenever open — paused or not — and a teleport request
        // is carried out at the top of the NEXT frame (see do_ride).
        if (showConsole) {
            refresh_console_ctx();
            DrawConsoleUI(&showConsole, &consoleFocus, consoleInput,
                          sizeof consoleInput, console, consoleCtx, consoleLog,
                          consoleHistory, consoleHistPos);
        }

        // ── Инвентарная сетка ([inventory.md]) ─────────────────────────
        // Виджет ЧИТАЕТ и возвращает заявку; применяем её здесь же, на тех же
        // примитивах, что консоль и ИИ ([equip.h]) — третьего пути к Equipped
        // не появляется.
        // Цель обыска живёт ровно пока открыто окно и жива сущность.
        if (shell.window != UiWindow::Inventory || !reg.valid(lootEntity)) {
            lootEntity = entt::null;
            lootIsBarter = false;
        }
        // Партнёр сделки обязан оставаться жив: труп торговца — уже труп,
        // его обыскивают, а не торгуются ([conversation.md]).
        if (lootIsBarter && (!pool.valid(convNpc) || !pool.alive(convNpc))) {
            lootEntity = entt::null;
            lootIsBarter = false;
        }
        if ((shell.window == UiWindow::Inventory) && reg.valid(player)) {
            if (const auto* nrInv = reg.try_get<game::NpcRef>(player);
                nrInv && pool.valid(nrInv->id)) {
                game::Inventory& pinv = pool.inventory(nrInv->id);
                game::Equipped& peq =
                    reg.get_or_emplace<game::Equipped>(player);
                InvUiPolicy policy{};  // self-режим: см. [inventory.md]
                policy.allowUse = false;  // послотовый Use придёт с примитивом

                // Вторая сторона: живые слоты цели. Держатель канонический
                // (B3): ящик отдаёт свои ItemSlot НАПРЯМУЮ, зеркало-копия
                // умерла вместе с POD-тройками.
                game::Container* boxC = nullptr;
                game::Corpse* corpseC = nullptr;
                game::Inventory* npcInv = nullptr;
                InvUiSide side{};
                game::BarterPreview bpv{};
                game::BarterTerms bterms{};
                const game::Equipped* npcEq = nullptr;
                if (lootEntity != entt::null && lootIsBarter) {
                    // Сделка ([conversation.md]): вторая сетка — ПУЛ-СТРОКА
                    // собеседника (его настоящая сумка), политика — deal.
                    npcInv = &pool.inventory(convNpc);
                    npcEq = reg.try_get<game::Equipped>(lootEntity);
                    side.title = "БАРТЕР";
                    side.slots = npcInv->slots;
                    side.count = game::kInvSlots;
                    bterms = game::barter_terms_for(
                        static_cast<game::Faction>(pool.faction(convNpc)));
                    bpv = game::barter_preview(pinv, &peq, *npcInv, npcEq,
                                               barterOwnMarks, barterOtherMarks,
                                               bterms);
                    if (!bpv.anyMarked) {
                        std::snprintf(dealLine, sizeof dealLine,
                                      "отметь, что берёшь и что даёшь");
                    } else if (bpv.equippedBlocked) {
                        std::snprintf(dealLine, sizeof dealLine,
                                      "надетое в сделку не идёт");
                    } else if (!bpv.covered) {
                        std::snprintf(
                            dealLine, sizeof dealLine,
                            "ВЗЯТЬ %lld | ДАТЬ %lld | %s не хватает %lld руб",
                            static_cast<long long>(bpv.takeCost),
                            static_cast<long long>(bpv.givePay),
                            bpv.cash > 0 ? "тебе" : "ему",
                            static_cast<long long>(
                                (bpv.cash > 0 ? bpv.cash : -bpv.cash) -
                                bpv.debtorRub));
                    } else {
                        std::snprintf(
                            dealLine, sizeof dealLine,
                            "ВЗЯТЬ %lld | ДАТЬ %lld | доплата %lld руб %s — "
                            "T подписать",
                            static_cast<long long>(bpv.takeCost),
                            static_cast<long long>(bpv.givePay),
                            static_cast<long long>(bpv.cash > 0 ? bpv.cash
                                                                : -bpv.cash),
                            bpv.cash >= 0 ? "с тебя" : "тебе");
                    }
                    policy.deal = true;
                    policy.ownMarks = barterOwnMarks;
                    policy.otherMarks = barterOtherMarks;
                    policy.dealLine = dealLine;
                    policy.dealOk = bpv.ok;
                } else if (lootEntity != entt::null) {
                    if (lootIsCorpse) {
                        // C: лут трупа — ТОТ ЖЕ Container, что у ящика; ветка
                        // отличается титулом и флагом searched. take/give идут
                        // общим box-путём — второго механизма нет (S11).
                        corpseC = reg.try_get<game::Corpse>(lootEntity);
                        boxC = reg.try_get<game::Container>(lootEntity);
                        if (boxC) {
                            side.title = "ТРУП";
                            side.slots = boxC->inv.slots;
                            side.count = game::kInvSlots;
                        }
                    } else {
                        boxC = reg.try_get<game::Container>(lootEntity);
                        if (boxC) {
                            switch (static_cast<game::ContainerKind>(
                                boxC->kind)) {
                                case game::ContainerKind::Safe:
                                    side.title = "СЕЙФ"; break;
                                case game::ContainerKind::WeaponCrate:
                                    side.title = "АРСЕНАЛ"; break;
                                case game::ContainerKind::RoomStash:
                                    side.title = "ТАЙНИК"; break;
                                default: side.title = "ЯЩИК"; break;
                            }
                            side.slots = boxC->inv.slots;
                            side.count = game::kInvSlots;
                        }
                    }
                }
                const bool twoSided = side.slots != nullptr;
                if (twoSided) policy.title = lootIsBarter ? "СДЕЛКА" : "ОБЫСК";

                // Один перенос ящик→сумка, все счётчики в одном месте:
                // и Take, и TakeAll ходят сюда, третьей копии закона нет.
                auto take_box_slot = [&](int i) {
                    if (!boxC) return;
                    game::ItemSlot& sl = boxC->inv.slots[i];
                    if (!game::item_valid(sl.item) || sl.count == 0) return;
                    const std::uint16_t unplaced = game::inventory_give(
                        pinv, sl.item, sl.count, sl.condition);
                    const std::uint16_t moved =
                        static_cast<std::uint16_t>(sl.count - unplaced);
                    if (moved == 0) return;  // сумка полна — остаток в ящике
                    // Ценность руками считает carried (живой инвентарь).
                    containerTake += game::item_def(sl.item).value * moved;
                    sl.count = unplaced;
                    if (sl.count == 0) sl = game::ItemSlot{};
                };
                // Пустая цель помечается ПОСЛЕ мутаций: opened — память карты
                // «здесь уже был» ([container.h]), searched — её труп-близнец.
                auto mark_if_empty = [&]() {
                    if (boxC && boxC->inv.empty()) {
                        if (corpseC) corpseC->searched = true;
                        else boxC->opened = true;
                    }
                };

                const InvUiRequest r = inventory_ui_draw(
                    invUi, policy, pinv, &peq,
                    game::inventory_mass_g(pinv),
                    game::carry_capacity_g(
                        reg.all_of<game::RpgStats>(player)
                            ? reg.get<game::RpgStats>(player)
                            : game::RpgStats{}),
                    twoSided ? &side : nullptr);
                switch (r.kind) {
                    // ── Deal-режим ([conversation.md], [barter.h]) ─────────
                    case InvUiRequest::Kind::MarkOwn:
                        if (lootIsBarter && r.slot < game::kInvSlots)
                            barterOwnMarks ^= (1ull << r.slot);
                        break;
                    case InvUiRequest::Kind::MarkOther:
                        if (lootIsBarter && r.slot < game::kInvSlots)
                            barterOtherMarks ^= (1ull << r.slot);
                        break;
                    case InvUiRequest::Kind::Commit: {
                        if (!lootIsBarter || !npcInv) break;
                        // Атомарно или никак: barter_commit сам перепроверяет
                        // маски и двигает обе сумки только целиком.
                        const game::BarterPreview done = game::barter_commit(
                            pinv, &peq, *npcInv, npcEq, barterOwnMarks,
                            barterOtherMarks, bterms);
                        if (done.ok) {
                            barterOwnMarks = 0;
                            barterOtherMarks = 0;
                            // Сумки обеих сторон изменились — броня обеих
                            // пересобирается из инвентаря ([combat.h] правило
                            // «после любого изменения сумки»).
                            game::sync_armour(reg, pool, player);
                            game::sync_armour(reg, pool, lootEntity);
                        }
                        break;
                    }
                    case InvUiRequest::Kind::Take: {
                        if (boxC && r.slot < game::kInvSlots)
                            take_box_slot(r.slot);
                        mark_if_empty();
                        game::sync_armour(reg, pool, player);
                        break;
                    }
                    case InvUiRequest::Kind::TakeAll: {
                        for (int i = 0; i < game::kInvSlots; ++i)
                            take_box_slot(i);
                        mark_if_empty();
                        game::sync_armour(reg, pool, player);
                        break;
                    }
                    case InvUiRequest::Kind::Give: {
                        game::ItemSlot& s = pinv.slots[r.slot];
                        if (!game::item_valid(s.item) || s.count == 0) break;
                        bool placed = false;
                        if (boxC) {
                            // B3: ручная двухфазка умерла — ЕДИНСТВЕННЫЙ
                            // примитив inventory_give (он же хранит закон
                            // «не смешивать износ»).
                            placed = game::inventory_give(boxC->inv, s.item, 1,
                                                          s.condition) == 0;
                        }
                        if (placed) {
                            if (--s.count == 0) s = game::ItemSlot{};
                            // Решение могло протухнуть вместе со слотом.
                            game::sync_armour(reg, pool, player);
                        }
                        break;
                    }
                    case InvUiRequest::Kind::Equip: {
                        // Адрес руки несёт заявка (two-hands.md): Weapon =
                        // ЛКМ, Tool = ПКМ; броня — по def, как раньше.
                        // Рука, занятая НЕСОМЫМ пропом, экипировку не берёт
                        // (эмерджентность владельца: проп занимает руку).
                        bool handBusy = false;
                        if (game::hand_accepts(r.eqSlot)) {
                            const std::uint8_t h =
                                r.eqSlot == game::EquipSlot::Tool ? 1u : 0u;
                            for (auto ce : reg.view<CarriedBy>()) {
                                const auto& cb = reg.get<CarriedBy>(ce);
                                if (cb.carrier == player && cb.hand == h)
                                    handBusy = true;
                            }
                        }
                        if (!handBusy &&
                            (game::hand_accepts(r.eqSlot)
                                 ? game::equip_hand(
                                       pinv, peq, r.slot,
                                       r.eqSlot == game::EquipSlot::Tool)
                                 : game::equip_item(pinv, peq, r.slot)))
                            game::sync_armour(reg, pool, player);
                        break;
                    }
                    case InvUiRequest::Kind::Unequip:
                        game::unequip_slot(peq, r.eqSlot);
                        game::sync_armour(reg, pool, player);
                        break;
                    case InvUiRequest::Kind::Drop: {
                        game::ItemSlot& s = pinv.slots[r.slot];
                        if (s.item != game::kInvalidItem && s.count > 0) {
                            // Один предмет из стека — на пол, с его износом
                            // ([loot.h] Pickup.condition). Тот же спавн, что
                            // у разлива трупа: Transform/AABB/Mass, физика
                            // общая.
                            const vec3 at = reg.get<Transform>(player).pos;
                            Entity pe = reg.create();
                            Transform ptr2;
                            ptr2.pos = vec3{at.x, at.y, at.z};
                            ptr2.layer = activeLayer;
                            reg.emplace<Transform>(pe, ptr2);
                            reg.emplace<Velocity>(pe);
                            reg.emplace<AABB>(pe, AABB{vec3{0.15f, 0.15f, 0.15f}});
                            reg.emplace<GravityAffected>(pe, GravityAffected{1.0f, false});
                            reg.emplace<Renderable>(pe,
                                Renderable{vec3{0.55f, 0.75f, 0.45f}});
                            game::Pickup pk;
                            pk.item = s.item;
                            pk.count = 1;
                            pk.condition = s.condition;
                            reg.emplace<game::Pickup>(pe, pk);
                            reg.emplace<Mass>(pe,
                                Mass{static_cast<float>(
                                         game::item_def(s.item).massG) *
                                     0.001f});
                            reg.emplace<game::Interactable>(
                                pe, game::Interactable{
                                        game::Interactable::Kind::Loot,
                                        game::kPickupReach, true});
                            if (--s.count == 0) s = game::ItemSlot{};
                            // Решение могло протухнуть вместе со слотом —
                            // строгое чтение это увидит; броню пересинхронизи-
                            // ровать надо сейчас.
                            game::sync_armour(reg, pool, player);
                        }
                        break;
                    }
                    case InvUiRequest::Kind::Repair: {
                        // Станция — та же тройка, что у крафт-окна: пад =
                        // верстак, терминал рядом = NetTerminal, иначе голые
                        // руки. Цену/станцию судит примитив; отказ — словами
                        // в консоль-лог, как крафт и делает. [craft.h]
                        const Transform& rct = reg.get<Transform>(player);
                        const bool nearTermR =
                            game::find_nearest_interactable(
                                reg, player,
                                game::Interactable::Kind::Terminal,
                                game::interact_def(game::InteractKind::Terminal)
                                    .reachM)
                                .hit;
                        const game::CraftStation benchR =
                            game::on_extraction_pad(
                                stack.layer(activeLayer).grid(), rct.pos)
                                ? game::CraftStation::Workbench
                                : (nearTermR ? game::CraftStation::NetTerminal
                                             : game::CraftStation::Any);
                        const game::RepairResult rr = game::craft_repair_item(
                            crafting, pinv, r.slot, benchR);
                        char line[128];
                        if (rr.ok)
                            std::snprintf(line, sizeof line,
                                          "repair: %s %u -> 255 (cost %u)",
                                          game::item_name(pinv.slots[r.slot].item),
                                          rr.conditionBefore, rr.costTotal);
                        else
                            std::snprintf(line, sizeof line, "repair: %s",
                                          game::craft_fail_text(rr.fail));
                        consoleLog.push_back(line);
                        // Починенная решённая броня держит больше — резисты
                        // масштабируются состоянием ([combat.cpp] sync_armour).
                        if (rr.ok) game::sync_armour(reg, pool, player);
                        break;
                    }
                    default:
                        // Use — послотовое использование придёт со своим
                        // примитивом; политика self-режима его пока не
                        // предлагает ([inventory_ui.h]).
                        break;
                }
            }
        }

        // DRAINED UNCONDITIONALLY, outside the console overlay.
        //
        // This used to sit INSIDE `if (showConsole)`, so a floor request only
        // ever landed while the console happened to be open. Every other console
        // request (`requestBits`) is drained unconditionally, and this one is the
        // channel `cmd_teleport` / `cmd_fasttravel` write to — which meant a
        // KeyBind row running `ft 14`, exactly the one-row extension
        // [ARCHITECTURE.md] advertises, did NOTHING when pressed. Worse, the
        // request was not dropped but LATCHED: it sat in the context and fired
        // the next time the player opened the console for some unrelated reason,
        // teleporting them mid-thought. Same for a pause-menu MenuItem, which
        // runs `exec_command` with the console shut. [problems.md] section 28.2
        if (consoleCtx.requestFloor != game::ConsoleContext::kNoRequest) {
            pendingTeleport = consoleCtx.requestFloor;
            pendingLandHub = consoleCtx.requestLandHub;
            consoleCtx.requestFloor = game::ConsoleContext::kNoRequest;
            consoleCtx.requestLandHub = -1;
        }

        if ((shell.window == UiWindow::Craft) && reg.valid(player)) {
            const Transform& ct = reg.get<Transform>(player);
            // Zero-heap nearest Terminal ([jirnyak.md] section 18) -- same reach as craft hot path.
            const bool nearTerm =
                game::find_nearest_interactable(
                    reg, player, game::Interactable::Kind::Terminal,
                    game::interact_def(game::InteractKind::Terminal).reachM)
                    .hit;
            const game::CraftStation bench =
                game::on_extraction_pad(stack.layer(activeLayer).grid(), ct.pos)
                    ? game::CraftStation::Workbench
                    : (nearTerm ? game::CraftStation::NetTerminal : game::CraftStation::Any);

            if (const auto* nrk = reg.try_get<game::NpcRef>(player)) {
                if (pool.valid(nrk->id)) {
                    bool craftOpen = true;  // мост к bool* закрывашки окна
                    DrawCraftingWindowUI(&craftOpen, crafting, pool.inventory(nrk->id), 
                                         bench, simTick, reg, player, pool, 
                                         crafted, scrapped, recipesLearned);
                    if (!craftOpen) shell.close_window();
                }
            }
        }

        // --- THE LIFT MENU --------------------------------------------------
        // The manifesto (p.4) asks for three KINDS of transition: a fixed
        // fast-travel grid, a procedural ride down, and a procedural ride up. It
        // spells that as three separate 4x4 sets of columns — 48 shafts. Owner's
        // decision 2026-08-12: keep ONE set and let the column offer all three,
        // which is what this window is. Owner's decision 2026-08-27
        // (elevators-2x2.md): lifts sit on the 2×2 SUBSET of the lattice — 4
        // cabins per floor; the other 12 columns stay geometry without a menu.
        //
        // That is not only cheaper to build, it is the only version that does not
        // move `kLatticeDim` — and `nav::kNodes == kLatticeCount == kLatticeDim^3`,
        // so 5 per axis would take the fine nav bake from 128 MiB to 250 MiB and
        // break the nav-cache wire pin (`kNavCoarseWire == 13056`, sized at 64
        // nodes). Three sets of columns would have needed a second lattice constant.
        //
        // EVERY ROW IS A CONSOLE LINE, exactly like the pause menu: `ride down`,
        // `ride up`, `ft <N>` all existed before this window and are unchanged by it.
        // The menu adds a PLACE TO CHOOSE, not a mechanism — so the console, a
        // keybind and this window cannot drift, and the deferred-request drain keeps
        // the ride out of the middle of a frame.
        if ((shell.window == UiWindow::Elevator) && reg.valid(player)) {
            const Transform& et = reg.get<Transform>(player);
            const int ecx = wrap_macro(static_cast<int>(et.pos.x / kCellSize));
            const int ecy = wrap_macro(static_cast<int>(et.pos.y / kCellSize));
            const int shaft = game::fast_hub_near(ecx, ecy);
            ImGui::SetNextWindowSize(ImVec2(360, 0), ImGuiCond_FirstUseEver);
            bool elevOpen = true;  // мост к bool* закрывашки окна
            if (ImGui::Begin("ЛИФТ / ELEVATOR", &elevOpen)) {
                if (shaft < 0) {
                    ImGui::TextColored(ImVec4(0.95f, 0.35f, 0.30f, 1.0f),
                                       "[NOT IN A LIFT]");
                    ImGui::TextWrapped(
                        "Встаньте в кабину лифта — 4 лифта на узлах 2x2 "
                        "(каждый второй узел решётки), одинаково на каждом "
                        "этаже.");
                } else {
                    ImGui::Text("ЛИФТ %d  |  ЭТАЖ %d", shaft, currentFloor);
                    const int cabin = game::fast_hub_at(ecx, ecy);
                    if (cabin < 0)
                        ImGui::TextDisabled(
                            "встаньте в кабину (центр шахты) для поездки");
                    // ПОСАДКА = ОТКРЫТИЕ (§24): встал в кабину с открытой
                    // панелью — этаж в сети. Раньше открывала только
                    // консольная ft, и свежая игра видела пустой список —
                    // бутстрап сети был мёртв (лог владельца 2026-08-27:
                    // ни одной поездки).
                    if (cabin >= 0) fastTravel.unlock(currentFloor);
                    ImGui::Separator();
                    refresh_console_ctx();
                    // 1 & 2 — соседние по номерам ДОСТУПНЫ ВСЕГДА (план,
                    // решение 2). Из кабины — честная лифтовая поездка
                    // (Prebuild + двери по закону); вне кабины — прежний
                    // дев-телепорт консолью.
                    if (ImGui::Button("ВНИЗ  /  DESCEND", ImVec2(-FLT_MIN, 0))) {
                        const int dst =
                            game::next_labelled_floor(registry, currentFloor, -1);
                        if (cabin >= 0 && dst != currentFloor) {
                            if (start_lift_ride(dst, cabin))
                                shell.close_window();
                        } else if (cabin < 0) {
                            exec_command("ride down");
                        }
                    }
                    if (ImGui::Button("ВВЕРХ /  ASCEND", ImVec2(-FLT_MIN, 0))) {
                        const int dst =
                            game::next_labelled_floor(registry, currentFloor, +1);
                        if (cabin >= 0 && dst != currentFloor) {
                            if (start_lift_ride(dst, cabin))
                                shell.close_window();
                        } else if (cabin < 0) {
                            exec_command("ride up");
                        }
                    }
                    ImGui::Separator();
                    // 3 — fast travel, and the list IS the unlock set. A floor the
                    // player has never boarded from is simply not here, so the gate
                    // and the UI cannot disagree about what is reachable.
                    ImGui::TextUnformatted("БЫСТРЫЙ ПЕРЕХОД / FAST TRAVEL");
                    int offered = 0;
                    for (int f = game::kMinFloor; f <= game::kMaxFloor; ++f) {
                        if (f == currentFloor) continue;
                        if (!fastTravel.unlocked(f)) continue;
                        if (registry.module_at(f) == game::kInvalidModule) continue;
                        char row[64];
                        std::snprintf(row, sizeof row, "ЭТАЖ %d##ft%d", f, f);
                        if (ImGui::Button(row, ImVec2(-FLT_MIN, 0))) {
                            // Диегетический путь один — кабина: поездка через
                            // Prebuild, двери ждут Fresh-свапа (закон дверей,
                            // elevators-2x2.md). Консольный `ft` остаётся
                            // дев-инструментом с прежним синхронным хитчем.
                            int hub = -1;
                            if (game::fast_travel_gate(fastTravel, registry,
                                                       currentFloor, f, ecx,
                                                       ecy, &hub) ==
                                game::FastTravelGate::Ok) {
                                // Посадка = открытие ЭТОГО этажа (§24) — тот
                                // же акт, что у консольной команды.
                                fastTravel.unlock(currentFloor);
                                if (start_lift_ride(f, hub))
                                    shell.close_window();
                            }
                        }
                        ++offered;
                    }
                    if (offered == 0)
                        ImGui::TextDisabled("нет открытых этажей — доберитесь пешком");
                }
            }
            ImGui::End();
            if (!elevOpen) shell.close_window();
        }

        // ── Разговор с NPC ([conversation.md]) ─────────────────────────
        // Меню опций; game-слой проецирует и толкует (conv_options /
        // conv_activate), окно только рисует и возвращает выбранный id.
        if (shell.window == UiWindow::Conversation) {
            // Собеседник обязан быть жив, телесен и в досягаемости — каждый
            // кадр, не только при открытии: он может умереть или уйти.
            bool convValid = reg.valid(convEntity) && pool.valid(convNpc) &&
                             pool.alive(convNpc) && reg.valid(player);
            if (convValid) {
                const vec3 pp = reg.get<Transform>(player).pos;
                const vec3 np = reg.get<Transform>(convEntity).pos;
                const float dx = wrap_delta_f(pp.x, np.x, kWorldExtent);
                const float dy = wrap_delta_f(pp.y, np.y, kWorldExtent);
                const float dz = wrap_delta_f(pp.z, np.z, kWorldExtent);
                const float reach =
                    game::interact_def(game::InteractKind::Npc).reachM + 1.0f;
                convValid = dx * dx + dy * dy + dz * dz <= reach * reach;
            }
            if (!convValid) {
                diceGame = game::DiceGame{};   // собеседник пропал — стол пуст
                bankCounterOpen = false;
                shell.close_window();
                input.set_mouselook(true);
                SDL_SetWindowRelativeMouseMode(window, true);
            } else if (bankCounterOpen) {
                // Стойка кассы вместо меню ([economy.h] teller): два числа,
                // три клавиши; глаголы клампят сами (сумка/счёт), UI слеп.
                if (const auto* nrb = reg.try_get<game::NpcRef>(player);
                    nrb && pool.valid(nrb->id)) {
                    game::Inventory& binv = pool.inventory(nrb->id);
                    std::int64_t cash = 0;
                    for (const auto& bs : binv.slots)
                        if (bs.item == game::kItemRuble) cash += bs.count;
                    char header[96];
                    std::snprintf(header, sizeof header, "%s",
                                  game::faction_name(static_cast<game::Faction>(
                                      pool.faction(convNpc))));
                    const BankUiRequest br = bank_ui_draw(
                        ledger.banked, cash, bankAcct.deposit,
                        game::bank_debt(bankAcct),
                        game::bank_credit_available(bankAcct), header);
                    if (br.depositAll) {
                        const std::int32_t in =
                            game::teller_deposit_cash(binv, ledger);
                        if (in > 0)
                            std::snprintf(convLine, sizeof convLine,
                                          "Принято на счёт: %d руб.", in);
                    }
                    if (br.withdraw) {
                        const std::int32_t out =
                            game::teller_withdraw_cash(binv, ledger, 1000);
                        if (out > 0)
                            std::snprintf(convLine, sizeof convLine,
                                          "Выдано наличкой: %d руб.", out);
                        else
                            std::snprintf(convLine, sizeof convLine,
                                          "Выдавать нечего либо некуда.");
                    }
                    // Срочный стол ([economy.h]): one-keypress формы, суммы
                    // судят сами глаголы (клампы по счёту/лимиту/принципалу).
                    if (br.toDeposit) {
                        const std::int32_t v =
                            game::bank_deposit_all(bankAcct, ledger, simTick);
                        std::snprintf(convLine, sizeof convLine,
                                      v > 0 ? "На вклад: %d руб."
                                            : "Вкладывать нечего.",
                                      v);
                    }
                    if (br.fromDeposit) {
                        const std::int32_t v =
                            game::bank_withdraw_all(bankAcct, ledger, simTick);
                        std::snprintf(convLine, sizeof convLine,
                                      v > 0 ? "Вклад закрыт: %d руб на счёт."
                                            : "Вклада нет.",
                                      v);
                    }
                    if (br.borrow) {
                        const std::int32_t v =
                            game::bank_borrow_max(bankAcct, ledger, simTick);
                        std::snprintf(convLine, sizeof convLine,
                                      v > 0 ? "Кредит выдан: %d руб на счёт."
                                            : "Лимит исчерпан.",
                                      v);
                    }
                    if (br.repay) {
                        const std::int32_t v =
                            game::bank_repay_all(bankAcct, ledger, simTick);
                        std::snprintf(convLine, sizeof convLine,
                                      v > 0 ? "Погашено: %d руб."
                                            : "Долга нет либо счёт пуст.",
                                      v);
                    }
                    if (br.close) bankCounterOpen = false;
                } else {
                    bankCounterOpen = false;
                }
            } else if (diceGame.active) {
                // Стол занят: панель партии ВМЕСТО меню, один читатель клавиш.
                char header[96];
                std::snprintf(header, sizeof header, "%s",
                              game::faction_name(static_cast<game::Faction>(
                                  pool.faction(convNpc))));
                const DiceUiRequest dr = dice_ui_draw(diceGame, header);
                if (dr.roll) game::dice_roll(diceGame, pool);
                if (dr.hold) game::dice_hold(diceGame, pool);
                if (dr.surrender) game::dice_surrender(diceGame, pool);
                if (dr.close) {
                    // Итог — репликой в меню, стол освобождается.
                    switch (diceGame.winner) {
                        case game::DiceWinner::Player:
                            std::snprintf(convLine, sizeof convLine,
                                          "Кости легли за тебя: +%d руб.",
                                          diceGame.paid);
                            break;
                        case game::DiceWinner::Npc:
                            std::snprintf(convLine, sizeof convLine,
                                          "Продул %d руб. Кости помнят.",
                                          diceGame.paid);
                            break;
                        default:
                            std::snprintf(convLine, sizeof convLine,
                                          "Ничья — деньги по карманам.");
                            break;
                    }
                    diceGame = game::DiceGame{};
                }
            } else {
                game::ConvContext cctx;
                cctx.reg = &reg;
                cctx.pool = &pool;
                cctx.player = player;
                cctx.npcBody = convEntity;
                cctx.npc = convNpc;
                cctx.book = &contracts;
                cctx.speech = &speechMem;
                cctx.seed = giga::hash2(convNpc, static_cast<std::uint32_t>(
                                                     simTick / kSimHz));
                game::ConvOption opts[game::kConvMaxOptions];
                const std::size_t nOpts =
                    game::conv_options(cctx, opts, game::kConvMaxOptions);
                char header[96];
                std::snprintf(header, sizeof header, "%s",
                              game::faction_name(static_cast<game::Faction>(
                                  pool.faction(convNpc))));
                const ConvUiRequest cr = conversation_ui_draw(
                    convUi, header, convLine[0] ? convLine : nullptr, opts,
                    nOpts);
                if (cr.optionId) {
                    const game::ConvAction act =
                        game::conv_activate(cctx, cr.optionId);
                    switch (act.kind) {
                        case game::ConvActionKind::Line:
                            std::snprintf(convLine, sizeof convLine, "%s",
                                          act.line ? act.line : "");
                            break;
                        case game::ConvActionKind::Bank:
                            bankCounterOpen = true;
                            break;
                        case game::ConvActionKind::Dice: {
                            // Сид — от сим-тика, НЕ от мирового сида: перезаход
                            // не должен читать следующий бросок ([dice.h]).
                            game::NpcId pidDice = game::kInvalidNpc;
                            if (const auto* nrd =
                                    reg.try_get<game::NpcRef>(player))
                                pidDice = nrd->id;
                            if (pidDice != game::kInvalidNpc &&
                                !game::dice_start(
                                    diceGame, pool, pidDice, convNpc,
                                    giga::hash2(
                                        static_cast<std::uint32_t>(simTick),
                                        convNpc)))
                                std::snprintf(convLine, sizeof convLine,
                                              "Кости не легли на стол.");
                            break;
                        }
                        case game::ConvActionKind::Barter:
                            // Тот же экран обыска, политика — сделка: вторая
                            // сетка = пул-строка собеседника, метки с нуля.
                            lootEntity = convEntity;
                            lootIsCorpse = false;
                            lootIsBarter = true;
                            barterOwnMarks = 0;
                            barterOtherMarks = 0;
                            shell.window = UiWindow::Inventory;
                            break;
                        case game::ConvActionKind::Close:
                            shell.close_window();
                            input.set_mouselook(true);
                            SDL_SetWindowRelativeMouseMode(window, true);
                            break;
                        default:
                            break;
                    }
                }
                if (cr.wantClose) {
                    shell.close_window();
                    input.set_mouselook(true);
                    SDL_SetWindowRelativeMouseMode(window, true);
                }
            }
        }

        // MAIN MENU — the boot screen. Extensible BY DATA like the pause menu:
        // each entry is a row, each sub-screen a page. The character-creation
        // screen ([npcs.md]: the player IS an NPC row, so creation is an editor
        // over the same char-sheet columns the pool serializes) plugs in as one
        // more page here when it lands. Labels are ASCII — the default ImGui
        // font ships no Cyrillic glyphs.
        if (shell.screen == AppScreen::Intro) {
            // Титульная заставка ([ui_shell.h]): фосфор на чёрном, сканлайны,
            // мигающая строка. Любой ввод (event loop) уводит в меню — здесь
            // только пиксели, ноль состояния.
            ImGuiIO& io = ImGui::GetIO();
            ImGui::SetNextWindowPos(ImVec2(0, 0), ImGuiCond_Always);
            ImGui::SetNextWindowSize(io.DisplaySize, ImGuiCond_Always);
            ImGui::Begin("##intro", nullptr,
                         ImGuiWindowFlags_NoDecoration |
                             ImGuiWindowFlags_NoBackground |
                             ImGuiWindowFlags_NoInputs);
            ImDrawList* idl = ImGui::GetWindowDrawList();
            idl->AddRectFilled(ImVec2(0, 0), io.DisplaySize,
                               IM_COL32(2, 8, 3, 255));
            for (float y = 0; y < io.DisplaySize.y; y += 4.0f)
                idl->AddRectFilled(ImVec2(0, y), ImVec2(io.DisplaySize.x, y + 1),
                                   IM_COL32(0, 0, 0, 60));
            // Пиксельная сборка «TENEVIK GAMES» ([intro_ui.h]) — палитра
            // красный/оранжевый/зелёный, у каждой клетки свой темп.
            const bool assembled = introFx.step_draw(
                idl, io.DisplaySize.x, io.DisplaySize.y, io.DeltaTime);
            const float cx = io.DisplaySize.x * 0.5f;
            if (assembled) {
                const char* sub = "экспериментальные независимые игры";
                const ImVec2 ss = ImGui::CalcTextSize(sub);
                idl->AddText(ImVec2(cx - ss.x * 0.5f, io.DisplaySize.y * 0.68f),
                             IM_COL32(60, 140, 66, 255), sub);
                static std::uint32_t introBlink = 0;
                if (((introBlink++) / 45u) % 2u == 0u) {
                    const char* hint = "[ нажмите любую клавишу ]";
                    const ImVec2 hs = ImGui::CalcTextSize(hint);
                    idl->AddText(
                        ImVec2(cx - hs.x * 0.5f, io.DisplaySize.y * 0.74f),
                        IM_COL32(89, 242, 102, 220), hint);
                }
            }
            ImGui::End();
        }
        if (shell.screen == AppScreen::Menu) {
            ImGuiIO& io = ImGui::GetIO();
            // Титул «ГИГАХРУЩ 2» из тех же клеток, что собирали логотип
            // студии — фоновым дроулистом, под окном меню, НА ЧЁРНОМ: без
            // подложки за титулом просвечивал живой мир и красные клетки
            // терялись (плейтест владельца). Та же подложка, что у интро.
            ImDrawList* mdl = ImGui::GetBackgroundDrawList();
            mdl->AddRectFilled(ImVec2(0, 0), io.DisplaySize,
                               IM_COL32(2, 8, 3, 255));
            for (float y = 0; y < io.DisplaySize.y; y += 4.0f)
                mdl->AddRectFilled(ImVec2(0, y), ImVec2(io.DisplaySize.x, y + 1),
                                   IM_COL32(0, 0, 0, 60));
            introFx.step_draw(mdl, io.DisplaySize.x, io.DisplaySize.y,
                              io.DeltaTime);
            ImGui::SetNextWindowPos(
                ImVec2(io.DisplaySize.x * 0.5f, io.DisplaySize.y * 0.5f),
                ImGuiCond_Always, ImVec2(0.5f, 0.5f));
            ImGui::Begin("##mainmenu", nullptr,
                         ImGuiWindowFlags_AlwaysAutoResize |
                             ImGuiWindowFlags_NoCollapse |
                             ImGuiWindowFlags_NoMove |
                             ImGuiWindowFlags_NoTitleBar |
                             ImGuiWindowFlags_NoSavedSettings);
            const ImVec2 btn(240.0f, 0.0f);
            if (shell.menuPage == 0) {
                // Титул теперь пиксельный, из клеток заставки ([intro_ui.h])
                // — ASCII-дубль в окне меню снят.
                ImGui::Separator();
                if (ImGui::Button("Новая игра", btn)) shell.menuPage = 2;
                if (ImGui::Button("Загрузить", btn)) shell.menuPage = 1;
                if (ImGui::Button("Настройки", btn)) shell.menuPage = 3;
                ImGui::Spacing();
                if (ImGui::Button("Выход", btn)) running = false;
            } else if (shell.menuPage == 1) {
                ImGui::TextUnformatted("Загрузить");
                ImGui::Separator();
                bool any = false;
                for (int s = 1; s <= kMaxSaveSlots; ++s) {
                    if (!slot_occupied(s)) continue;
                    any = true;
                    char label[32];
                    std::snprintf(label, sizeof label, "Слот %d", s);
                    if (ImGui::Button(label, btn)) {
                        // The load itself runs on the sim clock next frame —
                        // and BEFORE the player has touched anything, which is
                        // what makes the full v6 world restore safe.
                        g_saveSlot = s;
                        loadWanted = true;
                        menu_start_playing();
                    }
                }
                if (!any) ImGui::TextUnformatted("(сейвов пока нет)");
                ImGui::Spacing();
                if (ImGui::Button("Назад", btn)) shell.menuPage = 0;
            } else if (shell.menuPage == 2) {
                ImGui::TextUnformatted("Новая игра — выбери слот");
                ImGui::Separator();
                for (int s = 1; s <= kMaxSaveSlots; ++s) {
                    char label[64];
                    std::snprintf(label, sizeof label, "Слот %d%s", s,
                                  slot_occupied(s) ? "  (перезапись)" : "");
                    if (ImGui::Button(label, btn)) {
                        g_saveSlot = s;
                        // A new game clears its slot's directory: stale floor
                        // files from the previous run in this slot must not
                        // leak into a fresh one. Player-directed, labelled.
                        char dir[128];
                        slot_dir_path(dir, sizeof dir, s);
                        std::error_code ec;
                        std::filesystem::remove_all(dir, ec);
                        // ...и ПЕРЕСТРОИТЬ уже построенный этаж (аудит F,
                        // жук №2): бут восстановил этаж 0 из слота по
                        // умолчанию до всякого меню — без пересборки свежий
                        // ран начинался среди вылутанных ящиков, чужих
                        // трупов и обесточки покойника, и первый же leave
                        // вписал бы это в чистый слот.
                        rebuild_current_floor();
                        menu_start_playing();
                    }
                }
                ImGui::Spacing();
                if (ImGui::Button("Назад", btn)) shell.menuPage = 0;
            } else {
                ImGui::TextUnformatted("НАСТРОЙКИ");
                ImGui::Separator();
                // ТО ЖЕ окно вкладок, что в паузе ([settings_ui.h]) — один
                // код, два входа; заглушка «settings придут» снята.
                draw_settings_page();
                ImGui::Spacing();
                if (ImGui::Button("Назад", btn)) {
                    shell.menuPage = 0;
                    rebindCapture = -1;
                }
            }
            ImGui::End();
        }

        // Pause menu (Esc). Extensible BY DATA: a main-page item is a label plus
        // a console line, so the same row already works from the keyboard and
        // the typed console, and a future option is one table entry — never a
        // new handler. Page 1 is THE settings window ([settings_ui.h]) — the
        // same tabs the main menu shows; the old in-pause bind editor became
        // its Controls tab. Кириллица в ярлыках законна: шрифт несёт её
        // (имена мобов, худ) — старое «ASCII only» было правдой другого шрифта.
        if (shell.screen == AppScreen::Pause) {
            ImGuiIO& io = ImGui::GetIO();
            ImGui::SetNextWindowPos(
                ImVec2(io.DisplaySize.x * 0.5f, io.DisplaySize.y * 0.5f),
                ImGuiCond_Always, ImVec2(0.5f, 0.5f));
            ImGui::Begin("Menu", nullptr,
                         ImGuiWindowFlags_AlwaysAutoResize |
                             ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoMove |
                             ImGuiWindowFlags_NoTitleBar |
                             ImGuiWindowFlags_NoSavedSettings);
            const ImVec2 btn(220.0f, 0.0f);
            if (menuPage == 0) {
                ImGui::TextUnformatted("ПАУЗА");
                ImGui::Separator();
                struct MenuItem {
                    const char* label;
                    const char* command; // a console row — the menu adds nothing
                };
                static constexpr MenuItem kItems[] = {
                    {"Продолжить", "menu"},
                    {"Сохранить", "save"},
                    {"Загрузить", "load"},
                };
                refresh_console_ctx();
                for (const MenuItem& item : kItems)
                    if (ImGui::Button(item.label, btn)) exec_command(item.command);
                if (ImGui::Button("Настройки", btn)) menuPage = 1;
                ImGui::Spacing();
                if (ImGui::Button("Выйти", btn)) exec_command("quit");
            } else {
                ImGui::TextUnformatted("НАСТРОЙКИ");
                ImGui::Separator();
                draw_settings_page();
                ImGui::Spacing();
                if (ImGui::Button("Назад", btn)) {
                    menuPage = 0;
                    rebindCapture = -1;
                }
            }
            ImGui::End();
        }

        // CRT / VHS full-screen overlay: scanlines, phosphor wash and tube
        // vignette drawn on top of every ImGui window (and the 3D world through
        // the transparent background), per the Soviet служебный aesthetic
        // mandate ([jirnyak.md] §19/§8.6). Must be recorded after all HUD and
        // menu windows so it sits on top of them, and before ImGui::Render().
        hud.draw_crt_overlay();

        // Begin command recording & compute pass before graphics render pass
        // Дренаж дверных dirtyCells — ДО рендер-ветки (аудит 2026-08-21 №1:
        // блок жил внутри begin_frame_cmd, и при OUT_OF_DATE свапчейна —
        // ресайз, сворачивание — отрыв пропов и диффузионная грязь просто не
        // происходили: физика зависела от того, взялся ли кадр. Сим никогда
        // не зависит от рендера — закон AGENTS.md; mark_dirty зеркала — лишь
        // запись списка, командный буфер ей не нужен).
        // Voxel-mirror upkeep, outside the render pass: doors publish
        // their mask edits the same way carve does ([game/door.h]
        // dirtyCells) — drain once per frame, then record this frame's
        // dirty-cell copies.
        if (!doorDirty.empty()) {
            voxelMirror.mark_dirty(doorDirty.data(), doorDirty.size());
            nav.patch_carved_cells(stack.layer(activeLayer).grid(),
                                   doorDirty.data(), doorDirty.size());
            if (mediumPass.ready())
                mediumPass.wake_cells(doorDirty.data(), doorDirty.size(),
                                      stack.layer(activeLayer), voxelMirror);
            antourage_carve_step_here(doorDirty, 0xD00Du);
            // ДОЛГ ПИСАТЕЛЯ ОДИН И ПОЛНЫЙ (S20.4): дверь — писатель статики,
            // как карв. Раньше она рвала антураж, но НЕ пропы и не будила
            // тела — проп на атомах полотна висел после открытия, вопреки
            // контракту prop_system.h («whatever emptied these cells»).
            if (game::anchor_validate_step(reg, stack.layer(activeLayer),
                                           activeLayer, bus, doorDirty,
                                           &particleBursts, 0xD00Du) > 0)
                propPassNeedsRebuild = true;
            rigid_wake_dirty_cells(reg, activeLayer, doorDirty.data(),
                                   doorDirty.size());
            doorDirty.clear();
        }

        if (g_regrowWatch >= 2 && activeLayer != kInvalidLayer)
            regrow_check(stack.layer(activeLayer), voxelMirror, "двери",
                         simTick);

        // СИМ ВНЕ РЕНДЕР-СКОБКИ (аудит 2026-08-25, тот же класс, что дренаж
        // дверей выше): интеграция падающих ног антуража и часы истаивания
        // проводов/тканей обязаны идти и при OUT_OF_DATE свапчейна — иначе
        // ресайз/сворачивание окна замораживает физику. Внутри скобки
        // остаются только записи в GPU-буферы.
        if (!antourageFalling.empty() && activeLayer != kInvalidLayer) {
            game::antourage_detach_step(stack.layer(activeLayer),
                                        antourageFalling, frameDt);
            // propPassNeedsRebuild НЕ взводится: летящие куски эмитятся из
            // кэша слитых инстансов (К1-6), полная пересборка — только на
            // реальную смену набора.
        }
        static std::vector<std::uint8_t> wireAliveFrame;
        static std::vector<std::uint8_t> wirePinsFrame;
        static std::vector<std::uint8_t> clothAliveFrame;
        static std::vector<std::uint32_t> clothPinsFrame;
        wireAliveFrame.clear();
        wirePinsFrame.clear();
        clothAliveFrame.clear();
        clothPinsFrame.clear();
        if (verletPass.ready() && activeLayer != kInvalidLayer &&
            (verletPass.chain_count() > 0 || verletPass.sheet_count() > 0)) {
            if (const game::AntourageBake* ab =
                    streamer.antourage_at_layer(registry, activeLayer)) {
                const World& wg = stack.layer(activeLayer);
                if (verletPass.chain_count() > 0) {
                    // One probe, two answers: the live pin mask says which
                    // ends still hold, and "no pin left" starts the FALL. The
                    // chain keeps simulating unpinned for kAntourageFallSec,
                    // so it drops, lands (world_land in verlet_sim.comp) and
                    // only then stops being drawn ([antourage.md]).
                    // Сброс по смене (этаж, слой): смена этажа с тем же
                    // числом проводов наследовала чужие счётчики.
                    static game::FallClock wireFall;
                    static int wireFallFloor = INT_MIN;
                    static LayerId wireFallLayer = static_cast<LayerId>(~0u);
                    if (wireFallFloor != currentFloor ||
                        wireFallLayer != activeLayer ||
                        wireFall.left.size() != ab->wires.size()) {
                        wireFall.clear();
                        wireFallFloor = currentFloor;
                        wireFallLayer = activeLayer;
                    }
                    for (std::size_t wi = 0; wi < ab->wires.size(); ++wi) {
                        const std::uint8_t m =
                            game::wire_live_pins(wg, ab->wires[wi]);
                        wirePinsFrame.push_back(m);
                        wireAliveFrame.push_back(
                            wireFall.step(wi, m != 0u, frameDt) ? 1u : 0u);
                    }
                }
                if (verletPass.sheet_count() > 0) {
                    // Cloth: same aliveness law, same clock.
                    static game::FallClock clothFall;
                    static int clothFallFloor = INT_MIN;
                    static LayerId clothFallLayer = static_cast<LayerId>(~0u);
                    if (clothFallFloor != currentFloor ||
                        clothFallLayer != activeLayer ||
                        clothFall.left.size() != ab->cloths.size()) {
                        clothFall.clear();
                        clothFallFloor = currentFloor;
                        clothFallLayer = activeLayer;
                    }
                    for (std::size_t si = 0; si < ab->cloths.size(); ++si) {
                        const std::uint32_t m =
                            game::cloth_live_pins(wg, ab->cloths[si]);
                        clothPinsFrame.push_back(m);
                        clothAliveFrame.push_back(
                            clothFall.step(si, m != 0u, frameDt) ? 1u : 0u);
                    }
                }
            }
        }

        if (g_regrowWatch >= 2 && activeLayer != kInvalidLayer)
            regrow_check(stack.layer(activeLayer), voxelMirror,
                         "перед-рендером", simTick);
        g_frameMark.simMs = std::chrono::duration<float, std::milli>(
                                std::chrono::steady_clock::now() - g_frameT0)
                                .count();
        if (renderer.begin_frame_cmd(window)) {
            VkCommandBuffer cmd = renderer.current_cmd();
            // ВРЕМЯ ВИЗУАЛА — СИМ-ВРЕМЯ, не настенное (владелец 2026-08-20,
            // [CANON.md] S15, шаг 0 плана time-watch). Здесь стоял
            // `SDL_GetTicks()/1000`, и это был ЕДИНСТВЕННЫЙ вход настенных часов
            // в картинку: мерцание ламп на CPU ([game/flicker.h]), мерцание
            // плафонов и CRT на GPU (`torus.w` → [shaders/prop.frag]), дрожь
            // тумана самосбора. Три следствия того, что было:
            //   * мерцание НЕ замирало на паузе, хотя мир замирал;
            //   * два прогона с одинаковым `simTick` давали разную картинку,
            //     то есть свет было невозможно ни запинить, ни проверить;
            //   * фаза цикла (S15) выводится сдвигами из `simTick`, а свет жил
            //     в другом часовом поясе — программа щитка разъехалась бы с
            //     календарём, и это было бы видно как рассинхрон освещения.
            // Точность: float держит миллисекунду примерно до 4.6 часов
            // непрерывной игры — ровно столько же, сколько держал прежний
            // `SDL_GetTicks()/1000`, так что хуже не стало.
            float currentTimeSec = static_cast<float>(simTick) * kSimDt;

            // The timer bracket is OUTSIDE the ready() test on purpose, and so is
            // every other bracket this frame writes: collect() reads the whole
            // frame's query range in one call and VK_NOT_READY on ANY unwritten
            // query drops the ENTIRE sample ([gpu_timer.cpp]). A skipped pass must
            // therefore still write its pair — an adjacent begin/end reads as a
            // truthful 0.0 ms, not as a dead readout.
            renderer.timer.pass_begin(cmd, gpu::GpuPass::LightGrid);
            if (lightGrid.ready() && !skip_pass("lightgrid")) {
                // Свап бейка видимости (Fresh на входе этажа, Rebake фоном):
                // залить запечённые списки и поднять bakedGen — клетки,
                // запачканные ПОСЛЕ снапшота, остаются грязными сами
                // ([game/rebake.h] take_light_swap).
                if (nav.take_light_swap() && nav.light_vis().valid()) {
                    // Подозреваемый №2 хитча карва (carve-hitch.md): цена
                    // самого GPU-свапа. Кадр свапа ≠ кадр карва (фон), поэтому
                    // своя строка, не компонент [carve] total.
                    const auto ctSw = std::chrono::steady_clock::now();
                    lightGrid.upload_baked_grid(
                        nav.light_vis().cells.data(),
                        nav.light_vis().cells.size(),
                        static_cast<std::uint32_t>(nav.light_gen()));
                    // Полный бейк лёг — списки клеток больше не ссылаются на
                    // лампы, умершие до поколения СНАПШОТА этого бейка: их
                    // слоты можно отдавать новым лампам (см. вывод у
                    // g_slotDeadGen). Тег — СНАПШОТНЫЙ, не текущий (находка
                    // №2 аудита 2026-08-23): таблица могла смениться за время
                    // полёта бейка, и текущий тег переработал бы слот лампы,
                    // на которую легшие списки ещё ссылаются, — клетки
                    // светили бы чужой лампой до следующего полного бейка.
                    g_lightVisTableGen = nav.light_table_baked_tag();
                    light_log("[slots] full light bake landed at gen %u — dead "
                              "slots below it are now recyclable\n",
                              g_lightVisTableGen);
                    g_frameMark.lightSwapMs = carve_ms_since(ctSw);
                    std::fprintf(stderr,
                                 "[carve] light_swap upload %.2f ms (gen %llu)\n",
                                 static_cast<double>(g_frameMark.lightSwapMs),
                                 static_cast<unsigned long long>(nav.light_gen()));
                }
                // Свап дельта-патча (carve-hitch.md §3): на GPU едут ТОЛЬКО
                // изменённые клетки; ген поднимается и при пустом списке —
                // грязный шар обязан очиститься даже от карва в темноте.
                {
                    const std::vector<std::uint32_t>* patchCells = nullptr;
                    if (nav.take_light_patch(&patchCells) &&
                        nav.light_vis().valid()) {
                        const auto ctPt = std::chrono::steady_clock::now();
                        lightGrid.upload_baked_cells(
                            nav.light_vis().cells.data(),
                            nav.light_vis().cells.size(), patchCells->data(),
                            patchCells->size(),
                            static_cast<std::uint32_t>(nav.light_gen()));
                        std::fprintf(
                            stderr,
                            "[carve] light_patch upload %zu cells %.2f ms "
                            "(gen %llu)\n",
                            patchCells->size(), carve_ms_since(ctPt),
                            static_cast<unsigned long long>(nav.light_gen()));
                    }
                }
                const auto ctLg = std::chrono::steady_clock::now();
                // Полный пере-сбор ламп = 0.48-0.54 мс CPU (замер К5-E1,
                // 2026-08-26) — dirty-редизайн отложен с числом: придёт
                // естественно с программой щитка (S15.4), которая всё равно
                // переустроит «кто пишет интенсивности».
                collect_scene_lights(lightGrid, camMat.eye, currentTimeSec, samosbor, reg, activeLayer, &noiseField, &powerGrid, camMat.forward, worldUp, &pool, player);
                lightGrid.update_and_dispatch(cmd);
                if (g_carveT.carved) g_carveT.lgridMs = carve_ms_since(ctLg);
            }
            renderer.timer.pass_end(cmd, gpu::GpuPass::LightGrid);




            // (Интеграция падающих ног ушла ИЗ скобки в сим-хвост выше —
            // аудит 2026-08-25; здесь остался только репак скинов.)
            // Полный сбор — ТОЛЬКО на смену набора; кадры с летящими
            // кусками эмитят из кэша (К1-6: раньше 8 с после выстрела кадр
            // пересобирал всё с пробами сетки). Хвостовой кадр после
            // приземления последнего куска эмитит ещё раз — убрать его скин.
            {
                const bool fallingActive = !antourageFalling.empty();
                static bool fallingWasActive = false;
                if (propPassNeedsRebuild) {
                    const auto ctPs = std::chrono::steady_clock::now();
                    merge_ecs_prop_meshes(reg, activeLayer, propPass,
                                          streamer.antourage_at_layer(registry, activeLayer),
                                          stack.layer(activeLayer), &dripEmitters,
                                          &antourageFalling);
                    const float psMs = carve_ms_since(ctPs);
                    g_carveT.propSkinMs += psMs;
                    g_frameMark.propSkinMs += psMs;
                } else if (fallingActive || fallingWasActive) {
                    emit_prop_instances(propPass, &antourageFalling);
                }
                fallingWasActive = fallingActive;
            }
            // GIGA_NO_GPU_CULL=1 falls back to the CPU cull — the A/B switch
            // that separates "cull.comp corrupts instances" from every other
            // mesh-path suspect in one relaunch.
            static const bool noGpuCull = std::getenv("GIGA_NO_GPU_CULL") != nullptr;
            renderer.timer.pass_begin(cmd, gpu::GpuPass::Cull);
            if (!noGpuCull && cullPass.ready() && propPass.ready()) {
                propPass.set_use_gpu_culling(true);
                const mat4 vp = mat4_mul(camMat.proj, camMat.view);
                const uint32_t fIdx = renderer.currentFrame;
                const float fogEnd = kWorldExtent * 0.50f * samosbor_fog_scale(samosbor);
                const float torusPeriod = kWorldExtent;
                // ONE shared instance buffer, shapes as ranges
                // ([prop_pass.h] kRootPropInstances): upload cuts the ranges,
                // the culler gets each range by offset. GpuCullPass is the
                // only thing deciding what is drawn — PropPass stores
                // everything the floor submitted.
                propPass.upload_instances(fIdx);
                for (int s = 0; s < gpu::kPropShapeCount; ++s) {
                    uint32_t count = propPass.range_count(s);
                    if (count == 0) continue;
                    cullPass.record_cull(
                        cmd, vp, camMat.eye, fogEnd, torusPeriod,
                        propPass.instance_buffer(fIdx),
                        propPass.range_offset_bytes(s), count,
                        propPass.mesh(s).indexCount, 0, 0, 0,
                        propPass.culled_instance_buffer(fIdx),
                        propPass.range_offset_bytes(s),
                        propPass.indirect_cmd_buffer(s, fIdx));
                }
            } else if (propPass.ready()) {
                propPass.set_use_gpu_culling(false);
            }
            renderer.timer.pass_end(cmd, gpu::GpuPass::Cull);

            // Засев газа ВЫРЕЗАН (решение владельца 2026-08-25, стабилизация):
            // газ без фикспоинта держал 50k+ клеток вечно живыми — 8 мс GPU
            // + 5 мс CPU-шва (замер core-stabilization.md). Материал
            // toxic_gas жив строкой CSV (`sphere toxic_gas` руками); дизайн
            // сна сред — решение владельца перед возвратом газа.

            // Push bodies for the verlet passes: EVERY body on the active
            // layer (the same set BodyPass draws, PLUS the camera holder —
            // the player is an NPC with a camera, never a special case:
            // wires and curtains answer to the whole crowd identically).
            {
                static std::vector<vec4> pushBodies;
                pushBodies.clear();
                for (auto e :
                     reg.view<const Transform, const AABB, const Renderable>()) {
                    if (reg.all_of<StaticPropTag>(e)) continue;
                    const Transform& tr = reg.get<const Transform>(e);
                    if (tr.layer != activeLayer) continue;
                    pushBodies.push_back(
                        vec4{tr.pos.x, tr.pos.y, tr.pos.z, 0.9f});
                    if (pushBodies.size() >= gpu::kMaxPushBodies) {
                        // S11: переполнение вслух (кричит upload_bodies —
                        // здесь только не собираем лишнего).
                        break;
                    }
                }
                verletPass.upload_bodies(
                    pushBodies.data(),
                    static_cast<std::uint32_t>(pushBodies.size()));
            }

            // Wire verlet: aliveness from the LIVE grid (anchor probe), then
            // the compute step — recorded before the render pass like the cull.
            //
            // The SimPhysics span covers wire + cloth + particle compute, and the
            // particle step is pinned AFTER the mirror flush (see below), so the
            // nested VoxelFlush bracket is a SUB-span of this one by construction:
            // subtract it to isolate pure sim cost. It closes after the particle
            // record, unconditionally — see the LightGrid note on why every
            // bracket must write its pair each frame.
            renderer.timer.pass_begin(cmd, gpu::GpuPass::SimPhysics);
            // Реальный кадровый dt для GPU-симов (провода/ткань/частицы).
            // Раньше здесь стояло 1/60 ЗА КАДР: на 144 FPS антураж падал в
            // 2.4 раза быстрее, при том что FallClock строкой ниже уже жил по
            // frameDt — две метрики времени в одном блоке. Потолок — два
            // эталонных шага 60 Гц: верле помнит прошлую позицию, и хитч,
            // пропущенный в dt целиком, отдаётся взрывом констрейнтов. Газ
            // остаётся на 1/60 намеренно (см. его комментарий: поле фоновое).
            const float gpuSimDt = std::min(frameDt, 2.0f / 60.0f);
            if (verletPass.ready() && activeLayer != kInvalidLayer &&
                (verletPass.chain_count() > 0 || verletPass.sheet_count() > 0)) {
                // Живость и часы посчитаны ДО скобки (сим не зависит от
                // рендера) — здесь только запись в GPU-буферы.
                if (verletPass.chain_count() > 0 && !wirePinsFrame.empty()) {
                    const auto wireN =
                        static_cast<std::uint32_t>(wirePinsFrame.size());
                    verletPass.write_wire_alive(wireAliveFrame.data(), wireN);
                    verletPass.write_wire_pins(wirePinsFrame.data(), wireN);
                }
                if (verletPass.sheet_count() > 0 && !clothPinsFrame.empty()) {
                    const auto clothN =
                        static_cast<std::uint32_t>(clothPinsFrame.size());
                    verletPass.write_cloth_alive(clothAliveFrame.data(),
                                                 clothN);
                    verletPass.write_cloth_pins(clothPinsFrame.data(), clothN);
                }
            }

            if (!stainDirty.empty()) {
                // В7 (Автомат-2 инкр. 4): грязь — писатель, а запись
                // будит; прежде страница откатывалась зеркалом БЕЗ
                // пробуждения — GPU-состояние клетки затиралось молча.
                mediumPass.wake_cells(stainDirty.data(), stainDirty.size(),
                                      stack.layer(activeLayer), voxelMirror);
                voxelMirror.mark_dirty(stainDirty.data(), stainDirty.size());
                stainDirty.clear();
            }
            // МИР-АВТОМАТ: apply_readback и poll_activity ушли в НАЧАЛО
            // кадра (до сим-писателей); здесь остался только диспатч
            // подтиков после flush.
            // Дренаж очереди пробуждений — ДО flush: страницы фронтира
            // порции обязаны уехать на GPU этим же кадром, а инжект-буфер
            // порции съест record_substeps ниже. Остаток очереди честно
            // переносится (см. drain_wakes — прежний кап молча терял).
            mediumPass.drain_wakes(stack.layer(activeLayer), voxelMirror);
            renderer.timer.pass_begin(cmd, gpu::GpuPass::VoxelFlush);
            const auto ctVf = std::chrono::steady_clock::now();
            voxelMirror.flush(cmd, renderer.currentFrame,
                              stack.layer(activeLayer));
            g_carveT.flushMs = carve_ms_since(ctVf);
            renderer.timer.pass_end(cmd, gpu::GpuPass::VoxelFlush);

            // МИР-АВТОМАТ: подтики, назревшие по сим-часам (каждый 4-й
            // сим-тик), СРАЗУ после flush — писатели CPU легли, барьеры
            // внутри record_substeps упорядочат автомат до читателей кадра.
            if (mediumPass.ready()) {
                const std::uint64_t mediumTarget = simTick / 4;
                std::uint64_t owed = mediumTarget > mediumSubstepsDone
                                         ? mediumTarget - mediumSubstepsDone
                                         : 0;
                // Кап 8 подтиков/кадр: длинный фриз списывается вслух, а не
                // раскручивает спираль догоняния (материя в лагах идёт чуть
                // медленнее реального такта — честный компромисс).
                constexpr std::uint64_t kMediumMaxPerFrame = 8;
                if (owed > kMediumMaxPerFrame) {
                    std::fprintf(stderr,
                                 "[medium] dropping %llu substeps after a "
                                 "stall (cap %llu/frame)\n",
                                 static_cast<unsigned long long>(
                                     owed - kMediumMaxPerFrame),
                                 static_cast<unsigned long long>(
                                     kMediumMaxPerFrame));
                    mediumSubstepsDone = mediumTarget - kMediumMaxPerFrame;
                    owed = kMediumMaxPerFrame;
                }
                // Звать и при owed == 0: обратный шов (ридбек страниц живых
                // клеток) едет каждый кадр — хвост последнего подтика
                // доезжает в CPU-канон спокойным кадром.
                const CellStep md = regime_down(
                    stack.layer(activeLayer).gravity().regime);
                const auto ctMedR = std::chrono::steady_clock::now();
                mediumPass.record_substeps(
                    cmd, static_cast<std::uint32_t>(owed), md,
                    mediumSubstepsDone, stack.layer(activeLayer),
                    renderer.currentFrame, voxelMirror.flush_gen());
                g_mediumRecMs = carve_ms_since(ctMedR);
                mediumSubstepsDone += owed;
                // Числа каждый прогон (S11): раз в игровую секунду, пока
                // есть живая материя или переполнение.
                static std::uint64_t mediumLastLog = 0;
                static const bool kMediumDbg =
                    std::getenv("GIGA_MEDIUM_DBG") != nullptr;
                if (kMediumDbg &&
                    (mediumPass.live_count() > 0 || mediumPass.overflowed()) &&
                    simTick - mediumLastLog >= 125) {
                    mediumLastLog = simTick;
                    std::fprintf(
                        stderr,
                        "[medium] live %u cells (active %u), %u quanta (%.0f l), woken %u, "
                        "slept %u, lazy %u, listTot %u, fade %u, skip %u, substeps %llu | cpu ms: apply "
                        "%.2f rec %.2f%s\n",
                        mediumPass.live_count(), mediumPass.active_count(),
                        mediumPass.live_quanta(),
                        static_cast<double>(mediumPass.live_quanta()) * 15.6,
                        mediumPass.woken_total(), mediumPass.slept_total(),
                        mediumPass.lazy_total(), mediumPass.list_total(),
                        mediumPass.fade_total(), mediumPass.stale_skips(),
                        static_cast<unsigned long long>(mediumSubstepsDone),
                        static_cast<double>(g_mediumApplyMs),
                        static_cast<double>(g_mediumRecMs),
                        mediumPass.overflowed() ? " [WAKE CARRY]" : "");
                }
            }

            // Покомпонентная строка хитча карва — каждый карв, числом, а не
            // ощущением ([markoaudit/plans/carve-hitch.md] гейты). total =
            // карв-сайт + хвост кадра; unmeasured = site − Σ компонентов сайта
            // (если хитч там — меряли не то). lgrid/flush идут каждый кадр —
            // на кадре карва интересен их всплеск над фоновым уровнем.
            if (g_carveT.carved) {
                const float compSum = g_carveT.sphereMs + g_carveT.lightMatMs +
                                      g_carveT.mirrorMarkMs + g_carveT.diffMs +
                                      g_carveT.patchMs +
                                      g_carveT.partMs + g_carveT.anchorMs +
                                      g_carveT.antrMs;
                g_frameMark.carveMs = g_carveT.siteMs + g_carveT.propSkinMs +
                                      g_carveT.lgridMs + g_carveT.flushMs;
                std::fprintf(
                    stderr,
                    "[carve] total %.2f ms (%zu cells): light_mat %.2f, "
                    "prop_skin %.2f, mirror_mark %.2f, "
                    "mirror_flush %.2f, lgrid %.2f, sphere %.2f, diff %.2f, "
                    "patch %.2f, anchor %.2f, antr %.2f, part %.2f, "
                    "unmeasured %.2f\n",
                    static_cast<double>(g_carveT.siteMs + g_carveT.propSkinMs +
                                        g_carveT.lgridMs + g_carveT.flushMs),
                    g_carveT.cells, static_cast<double>(g_carveT.lightMatMs),
                    static_cast<double>(g_carveT.propSkinMs),
                    static_cast<double>(g_carveT.mirrorMarkMs),
                    static_cast<double>(g_carveT.flushMs),
                    static_cast<double>(g_carveT.lgridMs),
                    static_cast<double>(g_carveT.sphereMs),
                    static_cast<double>(g_carveT.diffMs),
                    static_cast<double>(g_carveT.patchMs),
                    static_cast<double>(g_carveT.anchorMs),
                    static_cast<double>(g_carveT.antrMs),
                    static_cast<double>(g_carveT.partMs),
                    static_cast<double>(g_carveT.siteMs - compSum));
            }
            g_carveT = CarveTiming{};

            // Particle sim AFTER the mirror flush: its barrier orders the
            // masks transfer before compute reads, so a particle collides
            // with THIS frame's carve holes, not last frame's walls.
            // Gravity is the layer's declared VECTOR — the flush above already
            // dereferences activeLayer, so it is valid here.
            // ЕДИНЫЙ верле-сим (антураж + частицы) — ПОСЛЕ flush зеркала:
            // теперь и антураж коллизит с дырами ЭТОГО кадра, не прошлого
            // (частицы жили так всегда; слияние подарило закон обоим).
            // GIGA_WIRE_NOSIM / GIGA_PARTICLE_NOSIM пасс читает сам.
            if (activeLayer != kInvalidLayer)
                verletPass.record_sim(
                    cmd, gpuSimDt,
                    stack.layer(activeLayer).gravity().global);
            renderer.timer.pass_end(cmd, gpu::GpuPass::SimPhysics);

            gpu::CubePush push{};
            push.viewProj = mat4_mul(camMat.proj, camMat.view);
            // Лейна sunDir СНЕСЕНА из CubePush (К5, 2026-08-25): солнце
            // вырезано в ноль решением владельца, последний читатель
            // (fill-inscatter тумана) стал тождественным нулём и удалён.
            // w = 0: лейна мертва с гибели налобника (S5). Ноль, а не мусор —
            // чтобы шейдер, случайно прочитавший её, не получил свет из воздуха.
            push.camPos = vec4{camMat.eye.x, camMat.eye.y, camMat.eye.z, 0.0f};
            const float fogScale = samosbor_fog_scale(samosbor);
            const float samosborPulse = std::clamp((1.0f - fogScale) / (1.0f - kSamosborFogSqueeze), 0.0f, 1.0f);
            // z = 0: бывший радиус налобника, мёртвая лейна (S5). Туман её
            // никогда не читал — только x/y, — поэтому обнуление безопасно.
            push.fog = vec4{kWorldExtent * 0.25f * fogScale,
                            kWorldExtent * 0.50f * fogScale,
                            0.0f, kAmbient};
            // The wrap period, so cube.vert can place each cell at its nearest
            // toroidal image itself. Instance origins are absolute, which is what
            // makes the cube pass's instance cache possible.
            push.torus = vec4{kWorldExtent, kAoDirect, samosborPulse, currentTimeSec};

            // ПОЛУРЕЗНЫЙ СВЕТОВОЙ ПОЛУПАСС — до главного рендер-пасса, тем же
            // пушем: весь световой цикл (лампы + теневые DDA-лучи) на
            // полразрешения, полный кадр возьмёт его билатерально
            // ([render/raymarch_pass.h] record_light, ddalight.md).
            renderer.timer.pass_begin(cmd, gpu::GpuPass::Light);
            if (!skip_pass("world"))
                raymarchPass.record_light(cmd, renderer.currentFrame, push,
                                          lightGrid.descriptor_set(),
                                          renderer.swap().extent);
            renderer.timer.pass_end(cmd, gpu::GpuPass::Light);

            renderer.timer.pass_begin(cmd, gpu::GpuPass::Raster);
            renderer.begin_pass(0.0f, 0.0f, 0.0f);
            // Each pass is bracketed by GPU timestamps as well as by the CPU
            // clock: the two answer different questions and need opposite fixes.
            // The CPU figure is time spent building instance data on this thread;
            // the GPU figure is what the hardware then spent rasterising it.
            std::uint64_t t0 = SDL_GetPerformanceCounter();
            renderer.timer.pass_begin(cmd, gpu::GpuPass::World);
            if (!skip_pass("world"))
                raymarchPass.record(cmd, renderer.currentFrame, push,
                                    lightGrid.descriptor_set());
            renderer.timer.pass_end(cmd, gpu::GpuPass::World);
            std::uint64_t t1 = SDL_GetPerformanceCounter();
            // Draw the embodied population on the active layer (shared depth).
            renderer.timer.pass_begin(cmd, gpu::GpuPass::Bodies);
            if (!skip_pass("bodies")) bodyPass.record(cmd, renderer.currentFrame, reg, activeLayer, push, lightGrid.descriptor_set(), voxelMirror.shadow_set());
            renderer.timer.pass_end(cmd, gpu::GpuPass::Bodies);
            // Props: GPU-instanced arbitrary-mesh pass, same depth buffer.
            renderer.timer.pass_begin(cmd, gpu::GpuPass::Props);
            if (propPass.ready() && !skip_pass("props"))
                propPass.record(cmd, renderer.currentFrame, push, lightGrid.descriptor_set(), voxelMirror.shadow_set());
            renderer.timer.pass_end(cmd, gpu::GpuPass::Props);


            renderer.timer.pass_begin(cmd, gpu::GpuPass::DrawPhysics);
            if (!skip_pass("physdraw")) {
            verletPass.record_draw_wires(cmd, push, lightGrid.descriptor_set());
            verletPass.record_draw_cloths(cmd, push, lightGrid.descriptor_set());
            // Particles LAST among world passes: alpha-blended sprites need
            // every opaque depth already written.
            verletPass.record_draw_shards(cmd, push,
                                          lightGrid.descriptor_set());
            verletPass.record_draw_particles(cmd, push,
                                             lightGrid.descriptor_set());
            }
            renderer.timer.pass_end(cmd, gpu::GpuPass::DrawPhysics);


            std::uint64_t t2 = SDL_GetPerformanceCounter();
            cubeMs = static_cast<float>((t1 - t0) / freq * 1000.0);
            bodyMs = static_cast<float>((t2 - t1) / freq * 1000.0);

            // «Тёмная адаптация» (порт форка e6b5e24b) УДАЛЕНА 2026-08-17.
            // Она была тем самым «подлетаешь к свету — и он тускнеет»
            // (репорт владельца со скринами, стабильно весь день): «яркость
            // сцены» считалась СУММОЙ ЛАМП В 16 М ОТ КАМЕРЫ ПО ДИСТАНЦИИ —
            // не по свету, попавшему в глаз, — и экспозиция глушила кадр до
            // 5x возле любого источника; лампа ЗА СТЕНОЙ душила так же, а на
            // плотном этаже у света всегда стояло максимальное удушение.
            // Свет обязан быть честным ([ddalight.md] закон №10); честная
            // адаптация глаза, если понадобится, — это GPU-редукция реальной
            // яркости кадра, осознанной системой, не суммой дистанций.
            // Сцена закрыта; CRT-треугольник в свопчейн; ImGui — поверх, резкий.
            renderer.begin_post_pass();
            // Скобка Raster закрывается ПОСЛЕ конца мирового пасса (он
            // завершён внутри begin_post_pass) — тайлер обязан дорисовать
            // его фрагменты до этого таймстемпа. Пост+CRT остаются в
            // «frame − Σ скобок».
            renderer.timer.pass_end(cmd, gpu::GpuPass::Raster);
            renderer.timer.pass_begin(cmd, gpu::GpuPass::Hud);
            hud.render(cmd);
            renderer.timer.pass_end(cmd, gpu::GpuPass::Hud);
            // Аудио-кадр: слушатель = тело с камерой, события — NoiseField,
            // опасность — danger-поле слоя. [audio/audio_system.h]
            if (reg.valid(player)) {
                const Transform& atr = reg.get<Transform>(player);
                const CameraTag* acam = reg.try_get<CameraTag>(player);
                const Field<float>* adanger =
                    stack.layer(activeLayer).fields().find<float>(kDangerField);
                audioSys.update(frameDt, atr.pos, acam ? acam->yaw : 0.0f,
                                acam ? acam->pitch : 0.0f,
                                stack.layer(activeLayer).grid(), adanger,
                                samosbor, bus, noiseField, 1.0f,
                                activeLayer);
            }
            renderer.end_frame(window);
            g_frameMark.renderMs =
                std::chrono::duration<float, std::milli>(
                    std::chrono::steady_clock::now() - g_frameT0)
                    .count() -
                g_frameMark.simMs;

            // --mirror-verify heartbeat: prove the incremental dirty path (not
            // just the wholesale uploads) against the CPU truth, ~every 5 s.
            if (mirrorVerify && (++mirrorFrame % 300u) == 0u)
                voxelMirror.verify(stack.layer(activeLayer));

            // --shot: count presented frames, then capture and quit. Counted here
            // rather than in the event loop so a skipped frame (swapchain out of
            // date, window minimised) does not count toward the budget — otherwise a
            // capture on a machine that drops frames would fire before the nav bake
            // and photograph a world with no crowd in it.
            if (shotPath) {
                ++shotFramesSeen;
                // --floor: one absolute hop through the console-teleport seam,
                // at the same cadence rides use (the nav bake needs its ~5 s).
                if (shotFloorWanted && shotFramesSeen % 420 == 0) {
                    shotFloorWanted = false;
                    pendingTeleport = shotFloor;
                }
                if (shotRideDone < shotRide && shotFramesSeen % 420 == 0) {
                    // One floor down every ~7 s: long enough for the async nav bake
                    // (measured 2.5 s + 2.4 s) to finish before the next ride.
                    game::NpcId pid = reg.valid(player)
                                          ? reg.get<game::NpcRef>(player).id
                                          : game::kInvalidNpc;
                    // Same capture as the keyboard ride path. Two travel sites;
                    // without this, --shot loot -> ride -> return refills crates.
                    // [save.h]
                    {
                        const LayerId leaveLayer =
                            reg.valid(player) ? reg.get<Transform>(player).layer
                                              : static_cast<LayerId>(0);
                        // Same departure floor-file write as the keyboard
                        // path — two travel sites, one law (v20: сущности
                        // едут в файл этажа). [save.h]
                        game::FloorEntityState leaveEnts;
                        game::gather_floor_entities(reg, leaveLayer,
                                                    currentFloor, leaveEnts,
                                                    &powerGrid);
                        write_floor_file_async(stack.layer(leaveLayer),
                                               currentFloor,
                                               std::move(leaveEnts),
                                               module_key_for(currentFloor));
                        // Same AIMEM leave release as do_ride. Two travel
                        // sites; a fix that touches only one proves nothing
                        // under --shot --ride. [ai.h]
                        {
                            const std::uint32_t released =
                                game::ai_release(reg, leaveLayer);
                            std::fprintf(stderr,
                                         "[aimem] LEAVE floor=%d layer=%u "
                                         "released=%u mem_rows=%u\n",
                                         currentFloor,
                                         static_cast<unsigned>(leaveLayer),
                                         released, aiMem.rows());
                        }
                    }
                    game::RideResult r = streamer.travel(
                        stack, registry, reg, pool, player, currentFloor, -1,
                        game::kArrivalCoord, pid);
                    if (r.moved) {
                        player = r.player;
                        currentFloor = r.floor;
                        game::record_floor(ledger, currentFloor);
                        // currentSpec was "(HUD only)" until door_build started reading
                        // it, and only the KEYBOARD ride path maintained it — so a
                        // --shot ride built floor -36's doors against floor 0's
                        // Residential spec and produced ZERO doors. Caught by running
                        // the game, not by a test: the HUD read "doors 0 built" on a
                        // floor where the keyboard path builds thousands.
                        //
                        // This is the two-travel-sites trap this file already warns
                        // about, hit again by promoting a display variable to a source
                        // of truth. Both sites now set it.
                        currentSpec = spec_for_floor(currentFloor);
                        // Same arrival law as the keyboard ride above, and it has to be
                        // the same call: this is the "two travel sites" trap the comment
                        // right above warns about, and the samosbor clock is one more
                        // thing both sites must set identically. [samosbor.h]
                        samosbor = game::samosbor_enter_floor(samosbor, currentFloor,
                                                              sbRng);
                        aim_player(reg, player);
                        LayerId nl = reg.get<Transform>(player).layer;
                        activeLayer = nl;
                        // Third thing both travel sites must do identically:
                        // the diffusion CONTRACT call ([diffusion.h]), or the
                        // recycled slot keeps the departed floor's danger.
                        diffusion_driver_on_floor_built(diffusionDriver,
                                                        stack.layer(nl), nl);
                        // Комнаты РАНЬШЕ сидеров: спавн паков селится в
                        // объявленных комнатах (mob_spawn читает reg.ctx).
                        game::rooms_declare(
                            floorRooms, currentFloor,
                            *spec_for_floor(currentFloor),
                            streamer.floor_seed_of(registry, currentFloor));
                        refresh_floor_mobs(reg, stack.layer(nl), currentFloor, nl);
                        // РАЗВИЛКА S20.6 — тот же закон, что у клавиатурной
                        // поездки: сидеры ИЛИ записи снимка, не оба. Второй
                        // travel-сайт; правка одного пути ничего не докажет
                        // под --shot. [save.h]
                        arrivedRestored = floor_entity_half(nl, currentFloor);
                        game::rooms_supply_rebuild(floorRooms, reg, nl);
                        game::door_declare(doors, floorRooms, currentFloor,
                           *spec_for_floor(currentFloor),
                           streamer.floor_seed_of(registry, currentFloor));
                        if (!arrivedRestored) dress_lift_portals(nl);
                        begin_floor_nav(stack.layer(nl), currentFloor, nav);
                        voxelMirror.upload_all(stack.layer(nl));
                        if (mirrorVerify) voxelMirror.verify(stack.layer(nl));
                        // Same transition autosave as the keyboard path.
                        save_run_now();
                        if (propPass.ready()) {
                            merge_ecs_prop_meshes(reg, nl, propPass,
                                  streamer.antourage_at_layer(registry, nl),
                                  stack.layer(nl), &dripEmitters);
                upload_wires(verletPass, streamer.antourage_at_layer(registry, nl));
                upload_cloths(verletPass, streamer.antourage_at_layer(registry, nl));
                        }
                        // Same clear as the keyboard ride path. There are TWO travel
                        // sites and the first fix only touched one, so a --shot
                        // capture kept reporting a rumour about the floor it started
                        // on. A duplicated code path is a duplicated bug; this is the
                        // second one and the reason to be suspicious of the shape.
                        rumourLine[0] = 0;
                        rumourAt = 0;
                        // A gunshot on the floor you just left must not be audible to
                        // the crowd on the one you arrived at. The streamer RECYCLES
                        // LayerId slots, so a surviving record would not merely be
                        // stale — it would match the new floor's layer id and be heard
                        // there. [noise.h]
                        game::noise_clear(noiseField);
                        // Same place_body_safely as the keyboard ride path. Two travel
                        // sites; a fix that touches only one leaves --shot soft-locked
                        // in a wall. [save.h]
                        game::place_body_safely(reg, stack.layer(nl), player);
                    }
                    ++shotRideDone;
                }
                // Two frames, because the copy is recorded INSIDE end_frame — the
                // only window in which the swapchain image legally belongs to the
                // application. Request on the target frame, save on the next.
                // [screenshot.h]
                if (shotFramesSeen == shotFrames) {
                    gpu::capture_request(device, renderer, shotCap);
                } else if (shotFramesSeen > shotFrames) {
                    const bool ok =
                        gpu::capture_save(device, renderer, shotCap, shotPath);
                    std::fprintf(stderr, "shot: %s -> %s (floor %d, %d frames)\n",
                                 ok ? "saved" : "FAILED", shotPath, currentFloor,
                                 shotFramesSeen);
                    // Полный пер-пассовый расклад GPU-кадра в stderr — HUD
                    // печатает только 5 пассов из 9 и недоступен харнессу.
                    // Медиана 31 кадра + пик, как в HUD ([gpu_timer.h]); это
                    // ЕДИНСТВЕННЫЙ машинно-снимаемый замер кадра — wall-clock
                    // FPS прибит FIFO-презентом и лжёт ниже всинка.
                    if (renderer.timer.supported()) {
                        static const char* kPassName[] = {
                            "lightgrid", "voxelflush", "cull", "sim",
                            "world",     "bodies",     "props", "drawphys",
                            "hud",       "light",      "raster"};
                        static_assert(sizeof(kPassName) / sizeof(kPassName[0]) ==
                                          gpu::kGpuPassCount,
                                      "имена пассов == enum");
                        // Скобки ВНУТРИ рендер-пасса (world..hud) на тайловом
                        // GPU меряют пустоту — фрагментная работа исполняется
                        // вся на vkCmdEndRenderPass ([gpu_timer.h] GpuPass).
                        // «world 0.002 мс при кадре 12.7» — не сломанный
                        // таймер, а свойство архитектуры; честные строки там —
                        // light/raster (целые пассы). Помечаем, чтобы свод
                        // нельзя было прочитать как «марш бесплатен».
                        const bool tiler =
#ifdef __APPLE__
                            true;
#else
                            false;
#endif
                        const bool inPass[gpu::kGpuPassCount] = {
                            false, false, false, false,  // lightgrid..sim
                            true,  true,  true,  true,   // world..drawphys
                            true,                        // hud
                            false, false};               // light, raster
                        for (std::uint32_t p = 0; p < gpu::kGpuPassCount; ++p)
                            std::fprintf(
                                stderr, "[gpu-shot] %-10s %8.3f ms  peak %8.3f%s\n",
                                kPassName[p],
                                renderer.timer.pass_ms(
                                    static_cast<gpu::GpuPass>(p)),
                                renderer.timer.pass_ms_max(
                                    static_cast<gpu::GpuPass>(p)),
                                (tiler && inPass[p])
                                    ? "  [in-pass: на тайлере работа в raster]"
                                    : "");
                        std::fprintf(stderr,
                                     "[gpu-shot] frame      %8.3f ms  peak %8.3f"
                                     "  drop %u\n",
                                     renderer.timer.frame_ms(),
                                     renderer.timer.frame_ms_max(),
                                     renderer.timer.dropped());
                    }
                    if (g_wallRing && g_wallSeen >= 64) {
                        float tmp[256];
                        const unsigned n = g_wallSeen < 256u ? g_wallSeen : 256u;
                        for (unsigned i = 0; i < n; ++i) tmp[i] = g_wallRing[i];
                        std::sort(tmp, tmp + n);
                        std::fprintf(stderr,
                                     "[cpu-shot] wall frame median %.3f ms  p90 "
                                     "%.3f  peak %.3f (over %u frames, "
                                     "first frame %.1f ms excluded)\n",
                                     tmp[n / 2], tmp[(n * 9) / 10], tmp[n - 1],
                                     n, g_wallFirstMs);
                    }
                    if (shotAction == "mag" && reg.valid(player)) {
                        const game::PlayerRanged* pr =
                            reg.try_get<game::PlayerRanged>(player);
                        std::fprintf(stderr,
                                     "[mag] FINAL has=%d mag=%u weapon=%u "
                                     "shots=%u hits=%u rideDone=%d\n",
                                     pr ? 1 : 0,
                                     pr ? static_cast<unsigned>(
                                              pr->hand[0].magCount)
                                        : 0u,
                                     pr ? static_cast<unsigned>(
                                              pr->hand[0].weapon)
                                        : 0u,
                                     pr ? pr->shots : 0u, pr ? pr->hits : 0u,
                                     shotRideDone);
                        if (pr && pr->hand[0].magCount == 7u && pr->shots == 42u &&
                            pr->hits == 13u)
                            std::fprintf(stderr, "[mag] PROOF=GREEN\n");
                        else
                            std::fprintf(stderr, "[mag] PROOF=RED\n");
                    }
                    if (renderer.timer.supported())
                        std::fprintf(stderr,
                                     "gpu-ms: world %.3f bodies %.3f props %.3f "
                                     "sim %.3f hud %.3f frame %.3f  (bodies %u)\n",
                                     renderer.timer.pass_ms(gpu::GpuPass::World),
                                     renderer.timer.pass_ms(gpu::GpuPass::Bodies),
                                     renderer.timer.pass_ms(gpu::GpuPass::Props),
                                     renderer.timer.pass_ms(gpu::GpuPass::SimPhysics),
                                     renderer.timer.pass_ms(gpu::GpuPass::Hud),
                                     renderer.timer.frame_ms(),
                                     bodyPass.last_instance_count());
                    // The peak beside the median, for the same reason the HUD carries
                    // both: an unattended capture that records only a median cannot
                    // distinguish "this got slower" from "this got spikier", and a
                    // non-zero drop count invalidates every median in the line above.
                    if (renderer.timer.supported())
                        std::fprintf(stderr,
                                     "gpu-ms-peak: world %.3f bodies %.3f props %.3f "
                                     "sim %.3f hud %.3f frame %.3f  (dropped %u)\n",
                                     renderer.timer.pass_ms_max(gpu::GpuPass::World),
                                     renderer.timer.pass_ms_max(gpu::GpuPass::Bodies),
                                     renderer.timer.pass_ms_max(gpu::GpuPass::Props),
                                     renderer.timer.pass_ms_max(gpu::GpuPass::SimPhysics),
                                     renderer.timer.pass_ms_max(gpu::GpuPass::Hud),
                                     renderer.timer.frame_ms_max(),
                                     renderer.timer.dropped());
                    if (!renderer.timer.supported())
                        std::fprintf(stderr,
                                     "gpu-ms: n/a (no timestamps, or "
                                     "GIGA_GPU_TIMER=0)\n");
                    running = false;
                }
            }
        }
    }

    // --- teardown (reverse order) -----------------------------------------
    hud.destroy();

    verletPass.destroy();
    mediumPass.destroy();
    cullPass.destroy();
    propPass.destroy();
    bodyPass.destroy();
    raymarchPass.destroy();
    voxelMirror.destroy();
    materialTex.destroy();
    lightGrid.destroy();
    renderer.destroy();
    device.destroy();
    // Аудио гасится ДО SDL_Quit: audioSys живёт на стеке main и её деструктор
    // сработал бы ПОСЛЕ return — SDL_DestroyAudioStream по мёртвому девайсу,
    // сегфолт на каждом выходе из игры (стек: ~AudioSystem →
    // SDL_UnbindAudioStreams → pthread_mutex_lock; крэши 01:39/03:44/05:04).
    audioSys.shutdown();
    SDL_DestroyWindow(window);
    SDL_Quit();
    return 0;
}
