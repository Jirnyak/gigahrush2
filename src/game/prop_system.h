#pragma once
#include <cstdint>
#include <vector>
#include <unordered_set>
#include <cmath>
#include "core/math.h"
#include "ecs/registry.h"
#include "ecs/components.h"
#include "game/event_bus.h"
#include "game/floor_spec.h" // DeviceBand — полосы устройств строки этажа
#include "game/interact_table.h"
#include "game/particles.h" // the burst a GpuHandoff prop owes the world
#include "game/prop_form_table.h" // FormId — форма составного тела
#include "game/prop_table.h"
#include "core/watch.h"   // watch_light_phase — фаза цикла для программы щитка (S15.4)
#include "world/anchor.h"  // SubVoxelAnchor — ЕДИНАЯ запись якоря (S20.2)
#include "world/surface.h" // SurfaceFace — ответ примитива поверхностей (S10)
#include "world/world.h"
#include "world/level_stack.h"


namespace giga::game {

enum class PropFallMode : std::uint8_t {
    SimpleFall,  // 1. Падение AABB на CPU (тяжелые щитки, терминалы)
    RagdollRoll, // 2. Вращение/кувыркание на CPU (лампы, ведра, стулья)
    GpuHandoff   // 3. Уничтожить сущность, осколки — всплеск в GPU-пул частиц
};

// Запись якоря переехала в движок ([world/anchor.h], D.1): одна и та же
// структура — ECS-компонент пропа, оба конца антуража, мировой линк цепи.
using giga::SubVoxelAnchor;

// Yaw настенного пропа ВЫВОДИТСЯ из грани якоря: размеры props.csv авторские
// для yaw-0 панели лицом по ±Y (width=X, thickness=Y), X-стена — четверть
// оборота. Z-грани (пол/потолок) поворота не диктуют — там yaw остаётся
// размещению. Единственный словарь «грань → поворот»; вывод по месту спавна —
// дефект (кнопка лифта стояла ребром: dress_lift_portals не передавал yaw).
// ГРАНИЦА ЧЕСТНОСТИ (названа вслух 2026-11-08, когда сеялки перешли на фрейм):
// ориентация пропа — ОДИН СКАЛЯР yaw ([PropMesh] ниже), и одним скаляром
// нельзя наклонить панель. Пока «вверх» совпадает с ±Z, этого довольно: щиток
// на X/Y-стене разворачивается верно. На Z-ГРАНИ (возможна при режиме Zero,
// где стеной служат все шесть) панель ляжет лицом по ±Y вместо настоящей
// нормали — ГЕОМЕТРИЯ выбрана по фрейму правильно, а выразить её поворот
// нечем. Лечится не здесь, а полной ориентацией в PropMesh (кватернион/грань)
// плюс поворотом в prop.frag — это решение владельца, не правка сеялки.
inline float prop_wall_yaw(std::uint8_t face) {
    return anchor_face_axis(face) == 0 ? 1.5707963267948966f : 0.0f;
}

// The KIND is a row of data/interactables.csv ([interact_table.h] — generated
// enum, so a new interactive is a CSV row, never an enum edit here). Поле
// reachM СНЕСЕНО 2026-11-07 вместе с колонками props.csv reach_mm и
// interactables.csv reach_m: оно стало write-only (шесть писателей, ноль
// читателей в проде) — досягаемость выводится из РОСТА смотрящего
// (body_reach, [game/embody.h]), цель reach не задаёт (решение владельца,
// лифт-лимб 1).
struct Interactable {
    using Kind = InteractKind;
    Kind kind;
    bool active = true;
};

// Filter tags live in ecs/components.h (core) so BodyPass can skip StaticPropTag
// without including the game layer. Re-export into game:: for existing call sites
// that write game::StaticPropTag / game::DynamicBodyTag / game::PropMeshTag.
using StaticPropTag  = giga::StaticPropTag;
using DynamicBodyTag = giga::DynamicBodyTag;
using PropMeshTag    = giga::PropMeshTag;


// GPU mesh skin payload for PropPass ([jirnyak.md] §18 — PropPass is a passive
// skin over reg.view<Transform, PropMeshTag>()). shape is the PropShape ordinal
// from render/prop_mesh.h; game never includes render headers — main maps
// shape -> gpu::PropShape when uploading instances.
struct PropMesh {
    std::uint8_t shape     = 0;
    float        yaw       = 0.0f;
    vec3         scale{1.0f, 1.0f, 1.0f}; // authored size (props.csv size_*_m)
    std::uint8_t matId     = 0;
    std::uint8_t emissive  = 0;
    std::uint8_t flags     = 0;
    std::uint8_t animPhase = 0;
};

// Свет пропа — испечён из его строки data/props.csv при спавне
// (light_radius_mm / light_intensity_e3 / light_cone_deg / flicker; цвет =
// цвет пропа). Вешается spawn_prop_from_id ТОЛЬКО когда строка светит;
// коллектор света ([main.cpp] collect_scene_lights) видит любой проп с этим
// компонентом — спец-случаев «лампочка» в коде нет ([ddalight.md]).
// flicker — FlickerProfile ([game/flicker.h]): та же чистая функция мерцания
// применяется к интенсивности света здесь и к emissive поверхности в
// prop.frag — плафон и свет синхронны по построению. Mains-профиль гаснет от
// power cut; прибор со своим питанием — нет. dropM — подвес: свет у нижней
// кромки арматуры (полвысоты меша), а не внутри неё.
// «Не в статик-таблице света»: проп, рождённый после постройки таблицы этажа,
// или сорванный в RagdollRoll — светит динамическим хвостом. Значение обязано
// совпадать с gpu::kNoLightSlot (game не видит render — static_assert на шве
// в app/main.cpp).
inline constexpr std::uint32_t kNoLightSlot = 0xFFFFFFFFu;

struct PropLight {
    vec3  color{1.0f, 1.0f, 1.0f};
    float radiusM   = 0.0f;
    float intensity = 0.0f;
    float dropM     = 0.0f;
    // Слот в статик-таблице света этажа (= id для бейка видимости
    // light_vis_bake); назначается при постройке таблицы в app.
    std::uint32_t slot = kNoLightSlot;
    std::uint8_t coneDeg = 0; // полуугол, 0 = омни
    std::uint8_t flicker = 0; // FlickerProfile ordinal
    // Кэш программы СВОЕГО щитка (ближайшего по тору; источник —
    // ShieldProgram, единственный писатель кэша — assign_lamp_shields).
    // Применяется только к mains — прибор со своим питанием фаз не знает,
    // ровно как power cut. Дефолт круглосуточный: этаж без щитков светит
    // как светил.
    std::uint8_t phaseLevels[4] = {100, 100, 100, 100};
    std::uint8_t phaseOffset = 0; // сдвиг в фазах 0..3
};

// ПРОГРАММА ЩИТКА (S15.4, посажена 2026-09-05): фаза цикла — параметр
// щитка; время ламп не трогает (S15.3 «часы ничего не толкают»). Уровни —
// проценты по четырём фазам watch_light_phase ([core/watch.h], сдвиг 17 =
// две вахты). Дефолт — круглосуточный полный: движок политики не навязывает
// (S10); фазы включаются ДАННЫМИ модуля — stamp_shield_programs выводит
// программу из declared-глаголов комнаты щитка (решение владельца
// 2026-09-05: «зависит от дизайна этажа в генераторе — могут быть щитки,
// которые светят круглосуточно»). Перештамповка на КАЖДОМ прибытии
// (generate И restore) — закон масок S18: декларация — чистая функция
// модульных данных, в сейв не едет.
struct ShieldProgram {
    std::uint8_t levels[4]   = {100, 100, 100, 100}; // % по фазам цикла
    std::uint8_t phaseOffset = 0;                    // сдвиг в фазах 0..3
};

// Уровень фазы на данном тике — ЧИСТАЯ функция (headless-тестируема).
inline float shield_phase_level(const std::uint8_t levels[4],
                                std::uint8_t phaseOffset,
                                std::uint64_t tick) {
    const int ph = (watch_light_phase(tick) + phaseOffset) & (kLightPhases - 1);
    return static_cast<float>(levels[ph]) * 0.01f;
}

// game/room.h — прямой include не нужен заголовку (prop_system.h включают
// почти все). `RoomId` объявить вперёд НЕЧЕМ (это `using` на u16), поэтому
// `room_stand_spots` ниже берёт голый u16 — тот же тип, что прячет псевдоним.
struct FloorRooms;
struct Room;

// Перештамповать программы всех щитков слоя из declared-глаголов их комнат:
// комната, где модуль объявил «спать» (declared[kVerbSleep] > 0), живёт
// жилым ритмом полный→рабочий→дежурный→тьма {100,60,25,0} (уровни —
// решение владельца 2026-08-20); щиток вне таких зон — круглосуточный.
// Возвращает число щитков. Зовётся на каждом прибытии ПОСЛЕ rooms_declare.
std::uint32_t stamp_shield_programs(Registry& reg, const FloorRooms* rooms,
                                    LayerId layer);

// Привязать каждую mains-лампу слоя к ближайшему щитку (тороидально) и
// скопировать его программу в кэш PropLight. Лампа без щитков на этаже
// остаётся круглосуточной. Возвращает число привязанных ламп.
std::uint32_t assign_lamp_shields(Registry& reg, LayerId layer);

// Headless POD mirror of gpu::PropInstance for tests / main upload.
// Collect only StaticPropTag entities (detached props go to BodyPass).
struct PropMeshInstance {
    std::uint8_t shape     = 0;
    vec3         origin{0.0f, 0.0f, 0.0f};
    float        yaw       = 0.0f;
    vec3         color{0.8f, 0.8f, 0.8f};
    vec3         scale{1.0f, 1.0f, 1.0f}; // authored size (props.csv size_*_m)
    std::uint8_t matId     = 0;
    std::uint8_t emissive  = 0;
    std::uint8_t flags     = 0;
    std::uint8_t animPhase = 0;
};

// AngularVelocity + Rotation live in ecs/components.h (core) so physics_step
// can integrate them without src/sim including src/game. [jirnyak.md] §18.

struct PendingDetachedProp {
    Entity entity;
    PropFallMode mode;
    vec3 pos;
    vec3 impulse;
    vec3 color;
    std::uint32_t meshKind;
};

// InteractionHit / find_nearest_interactable / interaction_step /
// prop_interact_step СНЕСЕНЫ 2026-11-07 (инкремент B лифт-лимба): прод звал
// их нулём мест (две отложки wired §52 это и фиксировали), жила пара только
// тестами, проверявшими сами символы — критерий сноса [purge-2026-09-30].
// Выбор цели интеракции — ЗАКОН ФОКУСА ([game/focus.h]): прицел + вывод
// досягаемости из роста (body_reach), дистанционного пути больше нет.

// ── Публичный API ───────────────────────────────────────────────────────────────

// Spawn a static anchored prop. `layer` is stamped on Transform so multi-layer
// streamer slots do not leak props across floors. `meshKind` is the PropShape
// ordinal stored on PropMesh (GPU skin). Optional `yaw`/`emissive`/`matId`/
// `animPhase` fill the rest of the PropPass instance payload.
// [jirnyak.md] §18.
// `gateAnchor=false` — ЕДИНСТВЕННО для пути восстановления снимка (S20.6):
// запись обязана родить сущность даже над мёртвым якорем, потому что судьбу
// решает якорная проба restore (закон 3 — честный детач), а не молчаливая
// потеря вещи. Любой другой писатель обязан оставить гейт: спавн и проба
// живости задают ОДИН вопрос.
Entity spawn_prop(Registry& reg, const World& world, const vec3& worldPos,
                  const SubVoxelAnchor& anchor, Interactable::Kind kind,
                  PropFallMode fallMode, const vec3& color, std::uint32_t meshKind,
                  LayerId layer = 0, float yaw = 0.0f,
                  std::uint8_t emissive = 0, std::uint8_t matId = 0,
                  std::uint8_t animPhase = 0, std::uint8_t flags = 0,
                  bool gateAnchor = true);

// Какой строкой props.csv рождён проп. Ставится только табличным спавном —
// проп без PropOf (тест-шар spawn_prop) не имеет строки и глаголов (S12.3).
struct PropOf {
    PropId id;
};

// Spawn from data/props.csv row (PropId). shape/fall/interact/color/emissive/
// matId/reach come from the generated table — call sites must not hardcode
// those. yaw/animPhase/flags stay procedural (placement). [jirnyak.md] §21.
Entity spawn_prop_from_id(Registry& reg, const World& world, const vec3& worldPos,
                          const SubVoxelAnchor& anchor, PropId id,
                          LayerId layer = 0, float yaw = 0.0f,
                          std::uint8_t animPhase = 0, std::uint8_t flags = 0,
                          bool gateAnchor = true);

// ГЛАГОЛ ДЕТАЧА для пути восстановления (S20.6 закон 3): тот же единственный
// детач, которым платят валидатор якорей и попадание снаряда, — снимает якорь,
// свапает StaticPropTag → DynamicBodyTag, собирает тело ядра по PropFallMode
// (GpuHandoff — честная смерть всплеском). Импульса нет — вещь просто ложится
// физикой, как труп при пересборке. `bursts` может быть null (headless).
void prop_detach(Registry& reg, Entity prop, EventBus& bus,
                 ParticleBurstQueue* bursts = nullptr, std::uint32_t seed = 0);


// Destroy every StaticPropTag prop on `layer` (terminals, shields, bulbs…).
// Call before reseeding a recycled LayerId slot — same contract as
// despawn_layer_mobs / refresh_floor_containers. NOT keyed on SubVoxelAnchor:
// containers carry an anchor and their own refresh cycle, and keying on the
// anchor wiped every crate at floor arrival (markoaudit-systems.md §1.2).
// [jirnyak.md] §18.
std::uint32_t clear_layer_props(Registry& reg, LayerId layer);

// ---------------------------------------------------------------------------
// ПОСТАНОВКА ВЕЩИ — ТРИ ГЛАГОЛА, ПО ОДНОМУ НА ОТНОШЕНИЕ К ОПОРЕ
// ---------------------------------------------------------------------------
// Решение владельца 2026-11-08: «у модуля должен быть контроль вплоть до
// решить: вот тут такой проп и интерактор — и это должно быть легко доступно
// модулю по желанию». До сегодня родить проп по СВОИМ координатам модуль не
// мог: рождение жило внутри трёх сеялок, которые сами выбирали клетку по
// полосам весов строки этажа, а наружу торчал только `spawn_prop_from_id` —
// дверь, требующая готового `SubVoxelAnchor` и позиции в метрах, то есть всей
// той арифметики поверхностей, которую сеялки держали в себе.
//
// ВЕЩЬ НАЗЫВАЕТ СВОЮ ОПОРУ: КЛЕТКУ И ЕЁ ГРАНЬ. Это единственный параметр
// места у всех трёх глаголов, и он же — то, во что вещь ЗАБИТА: карвом ушла
// опора — вещь падает (S20.2). `face` — упаковка [world/anchor.h]
// `anchor_face_pack(axis, dir)`, нормаль смотрит ОТ опоры К вещи; клетка
// передаётся НЕврапнутой (метры обязаны остаться смежными с клеткой — врап
// здесь родил бы призрак через шов тора; байты якоря врапает сам примитив
// поверхностей).
//
// ОТКАЗ — ЗНАЧЕНИЕ, А НЕ ИСКЛЮЧЕНИЕ: `entt::null` и ни одной сущности. Это и
// есть гейт, которого модуль хочет: назвал клетку мимо своей геометрии —
// получил честный отказ, который можно посчитать, а не вещь, висящую в
// воздухе (S2: «нет опоры — нет вещи»). ПРИЧИН ОТКАЗА ТРИ, и в возврате они
// неразличимы (если модулю понадобится их разводить — это отдельная форма
// возврата и решение владельца):
//   * грань не экспонирована (`columns == 0`) — названная опора не смотрит
//     в сторону вещи;
//   * строка не из таблицы (`!prop_valid`);
//   * материя под гранью НЕ ДЕРЖИТ НАГРУЗКИ (S20.5, `anchor_alive` внутри
//     `spawn_prop_from_id`): рубл и среда экспонированы, но вещь на них не
//     вешается.
//
// ЧЕГО ЗДЕСЬ НЕТ НАМЕРЕННО: свободного `yaw` у настенного и стоящего глагола.
// Поворот ВЫВОДИТСЯ из грани единственным словарём `prop_wall_yaw` выше, и
// второго ответа про ориентацию в дереве быть не должно. У подвеса поворот
// свободен ЧЕСТНО: у лампы нет стены, от которой его выводить, и сеялка
// плафонов уже крутит его хешем.
//
// Все три — ВТОРАЯ ПОЛОВИНА сеялок ниже, не копия: `seed_wall_interactables`,
// `seed_floor_standing_devices` и `seed_ceiling_lights` зовут ровно их, то
// есть полоса весов осталась УДОБСТВОМ (кто и с какой плотностью), а путь
// РОЖДЕНИЯ стал один (решение владельца: «стохастическая полоса становится
// вторым ВЫЗЫВАЮЩИМ того же примитива, а не вторым путём рождения»).

// ЗАПИСЬ ЯКОРЯ ИЗ ЗАПИСИ ПОВЕРХНОСТИ — обратное отображение `anchor_face_uv`
// ([world/anchor.h]: X-грань → (y,z), Y → (x,z), Z → (x,y)). Слой поверхности
// едет по ОСИ грани, представительная колонка (su,sv) — по её тангенсам.
//
// Выставлено наружу для модуля, который считает позицию САМ (авторские метры:
// «лампочка над входом, 0.3 м от фасада, на высоте перемычки») и потому не
// может воспользоваться тремя глаголами ниже. До 2026-11-08 такой модуль
// писал отображение руками — и `khrushi_module.cpp` писал его УСЛОВИЕМ ПО
// БУКВЕ ОСИ (`axis == 0 ? sf.layer : sf.su`), то есть повторял словарь движка
// в форме, которая верна для X/Y и молча неверна для Z.
SubVoxelAnchor anchor_from_surface(const SurfaceFace& sf);

// ПАНЕЛЬ ВИСИТ НА СТЕНЕ. `wallFace` — грань клетки-стены, смотрящая в клетку
// вещи; сама вещь садится по центру этой соседней клетки и сдвигается
// ЗАПОДЛИЧКУ к реальной поверхности стены (лепленая стена не кончается на
// границе клетки — «заподлицо с границей» вешало щиток в воздухе, скрин
// владельца 2026-08-20). Якорь — В КЛЕТКУ СТЕНЫ.
Entity place_prop_on_wall(Registry& reg, const World& world, LayerId layer,
                          int wallCx, int wallCy, int wallCz,
                          std::uint8_t wallFace, PropId id,
                          std::uint8_t animPhase = 0);

// ВЕЩЬ СТОИТ НА ПОЛУ СПИНОЙ К СТЕНЕ. `floorFace` — грань клетки-опоры,
// смотрящая «вверх» (вещь стоит в соседней по этой нормали клетке);
// `backFace` — грань стены за спиной, по ней же выводится поворот. Высота —
// от РЕАЛЬНОЙ поверхности опоры (решётчатый настил даёт просевшую честно),
// плюс полвысоты корпуса из строки props.csv. Якорь — В ПОЛ: вырезали пол
// под койкой — койка падает; стену рядом — стоит дальше.
//
// СТЕНА ЗА СПИНОЙ ОБЯЗАТЕЛЬНА, и это не упущение: не экспонирована — отказ.
// Вещь посреди комнаты («стол в середине зала») выразить нечем намеренно —
// у неё нет ни одного производителя сегодня, а параметр без производителя не
// заводится (тот же закон, по которому в actions.csv нет occupy). Появится
// модуль, который этого хочет, — приедет вместе с ним.
Entity place_prop_standing(Registry& reg, const World& world, LayerId layer,
                           int floorCx, int floorCy, int floorCz,
                           std::uint8_t floorFace, std::uint8_t backFace,
                           PropId id, std::uint8_t animPhase = 0);

// ВЕЩЬ ВИСИТ ПОД ОПОРОЙ, `dropM` метров ниже её реальной грани (подвес —
// шнур лампочки, крюк фонаря). `hangFace` — грань опоры, смотрящая в сторону
// вещи. По касательным осям — ЦЕНТР клетки опоры: форма «по
// представительной колонке» вешала плафон на ту стену, с которой колонка
// делила угол (тот же дефект, что сеялка стен лечила в 2026-08).
Entity place_prop_hanging(Registry& reg, const World& world, LayerId layer,
                          int supCx, int supCy, int supCz,
                          std::uint8_t hangFace, PropId id, float dropM,
                          float yaw = 0.0f, std::uint8_t animPhase = 0);

// ---------------------------------------------------------------------------
// МЕСТО ДЛЯ СТОЯЩЕЙ ВЕЩИ В ОБЪЯВЛЕННОЙ ЗОНЕ
// ---------------------------------------------------------------------------
// Тот же по СМЫСЛУ кандидатный вопрос, что у `seed_floor_standing_devices`
// («есть куда встать, снизу опора, сбоку стена»), заданный не про весь тор, а
// про ОДНУ комнату, которую назвал модуль. Механика, не политика: ЧТО
// поставить и в какой комнате решает строка модуля, здесь только «куда вещь
// физически встанет».
//
// ПО БУКВЕ ВОПРОС СТРОЖЕ, ЧЕМ У СЕЯЛКИ, и это сказано вслух, потому что
// раньше здесь стояло «тот же», а тот же он не был:
//   * клетка вещи — «не забита целиком» (атомы), а не «тип == воздух»
//     (замер: у сеялки этот тест выбрасывал 17 100 клеток квартир из 18 810);
//   * грань опоры и грань стены — ЭКСПОНИРОВАННОСТЬ (`columns > 0`), а не
//     «в соседней клетке есть материя»; сеялка по-прежнему спрашивает второе
//     и потому молча не ставит там, где годная грань была соседней
//     (НАЗВАННЫЙ ДОЛГ: привести сеялки сюда, это сдвинет их счёт);
//   * плюс принадлежность клетки ИМЕННО этой комнате (`room_at`) и проба
//     несущей способности (`anchor_alive`), которых у сеялки нет вовсе.
// Запись называет ОПОРУ, а не клетку вещи, — ровно то, что берёт
// `place_prop_standing`: место скармливается глаголу постановки как есть, без
// шага «а теперь отступи на клетку вверх» на стороне модуля.
struct StandSpot {
    std::int16_t cx = 0, cy = 0, cz = 0; // клетка ПОЛА, НЕврапнутая
    std::uint8_t floorFace = 0;          // её грань «вверх» (вещь — над ней)
    std::uint8_t backFace = 0;           // грань стены за спиной вещи
};

// Сколько мест примитив отдаёт за один обход комнаты. ВСЛУХ, а не молча: это
// потолок на то, сколько вещей модуль может поставить в ОДНУ комнату одним
// запросом, и он выведен из нужды — у самой оснащённой комнаты сегодня четыре
// строки мебели (`kKhrushiFurniture`), восемь даёт двойной запас, а восемь
// u32+запись на стеке не стоят аллокатора при тысячах комнат на этаж.
inline constexpr int kMaxStandSpots = 8;

// До `max` мест в комнате `id` (сверх `kMaxStandSpots` не отдаст), упорядоченных
// ХЕШЕМ (`salt`), а не обходом: «первая годная клетка» парковала бы всю мебель
// этажа в младший угол каждой комнаты и читалась бы решёткой — тот же довод, по
// которому плафон выбирает победителя блока минимумом хеша. Возвращает сколько
// ОТДАНО — то есть `min(нашлось, max, kMaxStandSpots)`, а не «сколько есть»:
// отличить «ровно max» от «больше max» вызывающий не может, и ему это не
// нужно — он просил столько, сколько ему надо. 0 = в комнате негде стоять
// (клетка забита, нет несущей опоры или нет стены).
//
// Клетка обязана принадлежать ИМЕННО этой комнате (`room_at`), а не только
// лежать в её боксе: при пересечении объявлений клетку забирает ПЕРВЫЙ
// объявивший (room.h), и мебель второго иначе уехала бы в чужую зону.
int room_stand_spots(const World& world, const FloorRooms& rooms,
                     std::uint16_t id, std::uint32_t salt, StandSpot* out,
                     int max);

// ГОДИТСЯ ЛИ ВЕЩЬ КОМНАТЕ — ПО ГЛАГОЛУ, А НЕ ПО «ВИДУ» (S12.2: вида комнаты
// нет, есть вектор глаголов). Годится, когда вещь несёт глагол, которым
// комната УЖЕ ЖИВЁТ: объявленное предложение (`Room::declared` — неразрушимая
// часть, работает с генерации) не слабее того, что добавит сама вещь
// (`kPropVerbs` — колонка verbs строки props.csv).
//
// ПОРОГ ВЫВЕДЕН, А НЕ НАЗНАЧЕН, и он содержательный: койка даёт `sleep 17`,
// спальня объявила 30 — койка её; зал объявил `sleep 10` (диван вполсилы) —
// койки в зале нет, потому что зал этим глаголом не ЖИВЁТ, он его лишь
// допускает. Стол даёт `eat 4`/`social 3` и встаёт и в кухню (eat 12), и в
// зал (social 12). Ни одного числа руками: обе стороны сравнения — строки
// данных.
bool prop_fits_room(PropId id, const Room& r);

// Seed wall-mounted devices by scanning MacroGrid with the deterministic
// spatial_hash wall rules (kSaltWall branch in the .cpp). АГНОСТИЧНЫЙ
// ПРИМИТИВ: ЧТО ставить и С КАКОЙ плотностью — полосы `bands` из строки
// этажа ([game/floor_spec.h] FloorSpec::wallDevices, решение владельца
// 2026-11-07 «политика расстановки в общем коде — дефект»); здесь только
// механика (кандидат у стены, заподлицо по surface, якорь в клетку стены).
// Полоса с per2000 == 0 пропускается. Returns count successfully spawned.
// «СТЕНА» — СЛОВО ФРЕЙМА: сосед по оси КАСАТЕЛЬНОЙ ПЛОСКОСТИ гравитации
// `world.gravity()`, а не фиксированно x/y (до 2026-11-08 шапка обещала
// изотропию, которой в теле не было). Режим Zero объявляет все шесть граней —
// по образцу bake_antourage; жребий при этом остаётся ОДИН на клетку, так что
// заказанная строкой этажа плотность не умножается на число фреймов.
// [jirnyak.md] §18 — sim must not read propPass.get_terminal_positions().
std::uint32_t seed_wall_interactables(Registry& reg, const World& world,
                                      LayerId layer, std::uint32_t seed,
                                      const DeviceBand* bands,
                                      std::size_t bandCount);

// НАПОЛЬНЫЕ СТАНЦИИ (владелец 2026-11-07: «станки в мир»): тот же агностичный
// примитив, что сеялка стен, но устройство СТОИТ НА ПОЛУ спиной к стене —
// опора снизу обязательна, позиция прижата к реальной поверхности стены
// (slide, как у панелей), якорь — в ПОЛ (вырезали пол — станок падает).
// Полосы — FloorSpec::floorDevices строки этажа; соль своя (kSaltFloorDevice),
// чтобы станок не коррелировал с панелью той же клетки. Returns count spawned.
// «ПОЛ» — СЛОВО ФРЕЙМА: грань, ПРОТИВОПОЛОЖНАЯ направлению гравитации в этой
// точке (`world.gravity()`), а не `z - 1`; «стена за спиной» — касательная
// плоскость ЭТОЙ опоры. Режим Zero объявляет все шесть граней (образец —
// bake_antourage): станок встаёт на ту, что первой окажется твёрдой, одним
// проходом и одним жребием на клетку.
std::uint32_t seed_floor_standing_devices(Registry& reg, const World& world,
                                          LayerId layer, std::uint32_t seed,
                                          const DeviceBand* bands,
                                          std::size_t bandCount);

// Seed ceiling lamps from MacroGrid ceiling rules (kSaltLight, твёрдая грань
// «вверх», одна лампа на блок pitch×pitch). АГНОСТИЧНЫЙ ПРИМИТИВ, как сеялки
// стен и пола: КАКОЙ плафон — полосы `mix` из строки этажа
// ([game/floor_spec.h] FloorSpec::ceilingLights). ВНИМАНИЕ: веса читаются как
// СМЕСЬ (знаменатель Σ весов), а не как плотность из 2000 — плотность здесь
// задаёт решётка блоков, выведенная из досягаемости плафона. Пустая смесь
// (nullptr / все нули) = ни одной лампы. Шаг решётки и headroom по-прежнему
// выведены из PropId::BareBulb как ЭТАЛОННОЙ фикстуры (не из полос: у
// FloodLamp радиус вдвое больше, pitch стал бы 16 вместо 8 и ламп стало бы
// вчетверо меньше).
// «ПОТОЛОК» — СЛОВО ФРЕЙМА: грань ПО направлению «вверх» гравитации
// `world.gravity()`, а не `z + 1`. Решётка блоков тоже фреймовая — pitch по
// касательным осям, один слой по вертикальной; при Zero касательны все три,
// и решётка становится изотропной pitch³ («этажей» в невесомости нет). Это и
// есть деление бюджета на число фреймов, которого требует [world/gravity.h].
// Лампа — СЦЕНОГРАФИЯ, не интерактив (чистка 2026-11-07: висячий промпт
// «LIGHT BULB» снят — ветки исполнения E не было никогда): свет и HUD читают
// PropLight/PropOf сущностей, выстрел — PropFallMode строки; propPass
// по-прежнему render-only. [jirnyak.md] §18 Sim→Render invariant.
std::uint32_t seed_ceiling_lights(Registry& reg, const World& world,
                                  LayerId layer, std::uint32_t seed,
                                  const DeviceBand* mix, std::size_t mixCount);

// Collect world positions of active Interactables of `kind` on `layer`.
// Replaces propPass.get_terminal_positions() / get_prop_positions for sim+HUD.
// Prefer interaction_step / find_nearest_interactable in the hot path — this
// helper is for callers that still need a flat list (craft proximity, HUD).
std::uint32_t collect_interactable_positions(const Registry& reg, LayerId layer,
                                             Interactable::Kind kind,
                                             std::vector<vec3>& out);

// Collect StaticPropTag + PropMesh + Transform (+ optional Renderable) into a
// flat instance list for PropPass upload. Detached DynamicBodyTag props are
// excluded (BodyPass owns them). [jirnyak.md] §18 PropPass passive skin.
// tick — для фазы щитка: плафон mains-лампы гаснет вместе со светом
// (S15.4 шаг 4, «свет И emissive синхронно»). Пересборка редкая — граница
// фазы раз в 17.5 мин поднимает propPassNeedsRebuild в app.
std::uint32_t collect_static_prop_mesh_instances(const Registry& reg, LayerId layer,
                                                 std::uint64_t tick,
                                                 std::vector<PropMeshInstance>& out);


// Немедленный перевод якорного пропа в живое тело рагдолл-ядра тем же
// законом, что отрыв карвом. Для RagdollRoll-строк расстановки: канон S3 —
// «катается, толкается», путь создания не меняет физику (владелец
// 2026-08-22: prop ball ≡ spawn_ball).
void prop_make_dynamic(Registry& reg, Entity prop, EventBus& bus);

// ГЛАГОЛ ЯКОРЕНИЯ (CANON S20.3): поставить связь — одна операция, доступная
// генерации И геймплею (крюк, сцепка, подвес, прицепить проп к пропу).
// Связь — линк-сущность (разруб = destroy); мировая сторона несёт ЕДИНУЮ
// запись якоря, и точка солвера ВЫВОДИТСЯ из неё здесь же — двум половинкам
// («vec3 для солвера + запись для пробы») больше нечем разойтись: писатель
// один. Снять — link_detach (будит стороны).
Entity link_attach_world(Registry& reg, Entity body, const vec3& anchorA,
                         const SubVoxelAnchor& a, float restLen, bool rope);
Entity link_attach(Registry& reg, Entity a, Entity b, const vec3& anchorA,
                   const vec3& anchorB, float restLen, bool rope);
void link_detach(Registry& reg, Entity link);

// ЖНЕЦ СВЯЗЕЙ — ОДНО правило смерти носителя (S20.3; раньше швов было три:
// CarriedBy чистил rigid-степ, линки молча вырождались в солвере и ТЕКЛИ
// при выгрузке этажа — у линк-сущности нет Transform, слоевые свипы её не
// видели, — сегменты чистил только сейв). Раз в тик: линк с умершей
// непустой стороной уничтожается (живая сторона разбужена), сегмент с
// умершим корнем уничтожается. Выгрузка этажа закрыта ПО ПОСТРОЕНИЮ:
// стороны несут Transform и умирают слоевым свипом — их связи умирают
// следующим тиком здесь. CarriedBy остаётся в rigid-степе (кинематика
// несомого решается там же тем же тиком). Возвращает число прибранного.
std::uint32_t attachment_reaper_step(Registry& reg);

// `source` — стрелявший, только для атрибуции килла заряда-от-урона
// (бочка: выстрел взводит ChargeArmed вместо детача; [combat.h] Charge).
bool check_projectile_prop_hits(Registry& reg, LayerId layer, const vec3& projPos,
                                const vec3& projVel,
                                float projHitRadius, EventBus& bus,
                                ParticleBurstQueue* bursts = nullptr,
                                std::uint32_t seed = 0,
                                Entity source = entt::null);

// Validate SubVoxelAnchor props against MacroGrid after geometry mutation.
// `dirtyCells` is CarveResult::dirtyCells / DoorSet::dirtyCells /
// судейские dirty — flat macro_index keys (uint32), NOT a packed xyz64.
// Returns how many props detached (StaticPropTag → DynamicBodyTag) so the
// caller can rebuild the static PropPass skin. [jirnyak.md] §18.
// `layer` — СЛОЙ ПИСАТЕЛЯ (S20.4: слой — часть ключа dirty-вопроса):
// пробы идут против `world` этого слоя, и якоря чужих резидентных этажей с
// совпавшим macro_index не трогаются — прежний бесслойный проход ронял
// проп этажа B карвом этажа A. Пропы идут через персистентные AnchorBins
// (точные бакеты dirty-клеток), не полным view (§59.2-семья).
// Optional `bursts`: the shared particle queue ([game/particles.h]). A
// GpuHandoff prop shatters into it instead of vanishing silently — pass it
// and the mode finally does what its name says.
std::uint32_t anchor_validate_step(Registry& reg, const World& world,
                                   LayerId layer, EventBus& bus,
                                   const std::vector<std::uint32_t>& dirtyCells,
                                   ParticleBurstQueue* bursts = nullptr,
                                   std::uint32_t seed = 0);


// prop_ragdoll_step УМЕР (инкремент 6 рагдолл-эпика, 2026-08-21): сорванный
// проп — тело рагдолл-ядра (rigid_body_step в src/sim/rigid.cpp), гашение,
// качение и сон живут там; отдельная косметика вращения не существует.

// ── Многосегментное тело (инкременты 8 и 11 рагдолл-эпика) ──────────────────
// Плоть — контактная пара живого тела: мяса упругости нет (звона не бывает),
// хват высокий — это одежда и кожа. Живёт здесь, потому что и смерть
// (combat.cpp), и загрузка сейва (save.cpp) собирают тело ОДНИМИ числами.
inline constexpr float kFleshRestitution = 0.05f;
inline constexpr float kFleshFriction = 0.8f;

// Сегмент чужого корня: сущность-сегмент И сущность-линк несут этот маркер,
// чтобы уборка корня (ребилд трупов при загрузке этажа) забирала всё тело.
struct BodySegment {
    Entity root = entt::null;
};

// Развернуть КОРЕНЬ в составное тело по строкам data/prop_forms.csv
// ([prop_form_table.h] — форма это ДАННЫЕ, решение владельца 2026-08-21).
// Первая строка формы пересобирает САМ корень (на нём остаются
// Container/Interactable/Corpse и сейв-идентичность), остальные рождают
// сегменты-сущности и связи. Ядро агностично: N тел + M линков, слово «труп»
// знает только вызывающий. Габариты и массы — доли `bodyHalf` и `totalKg`
// (S11: масштабируется телом, а не назначается). Сегменты наследуют скорость
// и тинт корня. `restitution`/`friction` — контактная пара материала тела
// (плоть у трупа). Возвращает число созданных сущностей (сегменты + линки).
std::uint32_t spawn_form_segments(Registry& reg, Entity root, FormId form,
                                  vec3 bodyHalf, float totalKg,
                                  float restitution, float friction);

// Убрать сегменты и линки, чьи корни в списке (вызвать ДО destroy корней).
void destroy_body_segments(Registry& reg, const std::vector<Entity>& roots);

// ── Переноска (инкремент 9) ─────────────────────────────────────────────────
// Один путь на всех носителей (S7: игрок = NPC): взять ближайшее тело в руки
// (CarriedBy — кинематика в ядре) и бросить с наследованием скорости носителя.
// `forward` — направление взгляда носителя (game знает камеру, ядро — нет).
// carry_nearest_body возвращает взятое тело или entt::null.
// ПРОП ЗАНИМАЕТ РУКУ (two-hands.md, эмерджентность владельца): freeHands —
// битмаска свободных рук носителя (bit0 = ЛКМ, bit1 = ПКМ), выводит КАЛЛЕР
// (свободна = ни экипировки, ни несомого; ядро Equipped не знает).
// 0 = обе заняты, взять нечем — отказ. Берёт младшей свободной.
Entity carry_nearest_body(Registry& reg, Entity carrier, const vec3& forward,
                          float reachM, std::uint8_t freeHands = 0x3);

// Бросить несомое: снять CarriedBy и добавить бросок `throwSpeed` вдоль
// `forward` поверх унаследованной скорости носителя. hand: 0/1 — только
// этой руки (кнопка руки бросает своё), -1 — всё (консольная команда).
// Возвращает число брошенных тел.
std::uint32_t drop_carried(Registry& reg, Entity carrier, const vec3& forward,
                           float throwSpeed, int hand = -1);

} // namespace giga::game
