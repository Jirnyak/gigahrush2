#include "game/prop_system.h"
#include "ecs/components.h"
#include "game/combat.h"          // Charge/ChargeArmed — проп-заряд от урона
#include "game/room_supply.h"     // живые хуки: проп встал += / умер −= (S12.4)
#include "sim/cell_bins.h"        // общий примитив клеточных бинов (§59.2)
#include "sim/rigid.h"            // rigid_attach_* — детач на рагдолл-ядро
#include "world/anchor.h"
#include "world/material_props.h" // kMatDensity/kMatHardness — масса и e/μ
#include "world/surface.h"
#include "world/macro_grid.h"
#include "world/materials.h"
#include "world/types.h"
#include "world/world.h"
#include <algorithm>
#include <vector>
#include <unordered_set>
#include <cstdio>
#include "core/wrap.h"
#include "core/rng.h"

namespace giga::game {

// Salt for wall-device placement rolls (inherited from the purged gpu::PropPlacer
// so historical placements stay put) — ECS interactables land on the same
// cells as the GPU cosmetic Terminal / ElectricalShield instances.
constexpr std::uint32_t kSaltWall = 0x33333333u;
// Salt for ceiling-light placement rolls (same inheritance as kSaltWall above).
constexpr std::uint32_t kSaltLight = 0x44444444u;

// LAMP PITCH AND HEADROOM DERIVE FROM THE FIXTURE'S OWN REACH, not from taste.
// props.csv gives BareBulb light_radius_mm; two numbers fall straight out of it:
//
//   pitch    — neighbouring pools must OVERLAP, so the spacing ceiling is two
//              radii: 24 m = 12 cells. The pitch also has to TILE THE TORUS —
//              128 is not divisible by 12, and a pitch that leaves a short last
//              block puts a triple-density stripe of lamps down x = 126..127 and
//              y = 126..127, running the whole wrap. That is precisely the seam
//              this engine exists to not have. So: the largest power-of-two
//              divisor of kMacroDim that still fits under two radii = 8 cells
//              (16 m), every pool overlapping its neighbour by 8 m.
//
//              The old rule was a flat 25% per-cell coin flip, which is not a
//              density at all — it is a density PER CEILING CELL, so a floor
//              with half a million ceilings (padic: 43 storeys of
//              full-footprint sandwich) asked for 123 000 lamps while a floor
//              that is mostly void (blame: 48 000 ceilings) asked for 12 000.
//              123 000 overflows kStagingLights (16384) seven times over — the
//              exact silent-truncation class already documented in
//              gpu_light_grid.h.
//   headroom — a ceiling lamp lights a place a body STANDS. If no surface lies
//              within the bulb's own reach below it, the "ceiling" is not a
//              room's ceiling. On the torus every axis wraps, so cell(x,y,z+1)
//              at z=127 reads cell z=0: on blame that is the underside of the
//              town's platform mass, and the whole open sky over the town came
//              back as one flat sheet of 1538 lamps at 255 m — 17% of the
//              floor's lamps in a single plane, hanging over the abyss. The
//              wrap is honest geometry; a light fixture 200 m over a street is
//              not a light fixture.
inline int lamp_light_radius_cells() {
    const int r = static_cast<int>(prop_def(PropId::BareBulb).lightRadiusMm /
                                   1000u / static_cast<unsigned>(kCellSize));
    return r > 0 ? r : 1;
}

inline int lamp_pitch_cells() {
    const int span = 2 * lamp_light_radius_cells(); // pools still overlap
    int pitch = 1;
    while (pitch * 2 <= span && (kMacroDim % (pitch * 2)) == 0) pitch *= 2;
    return pitch;
}

// NO LAMP-SPECIFIC COUNT CAP LIVES HERE, deliberately (owner, 2026-08-18). A
// lamp is a prop; the draw budget belongs to ALL props together, and capping one
// prop kind by hand is the road to capping every kind by hand. The two real
// ceilings both sit in render/ and are that layer's to enforce:
//
//   kMaxPropInstances = 4096 per SHAPE per frame (prop_pass.h) — the mesh. It
//     already drops the overflow, but by INSERTION ORDER and silently, so a
//     dense floor keeps the light and loses the fixture: measured on padic,
//     6661 CylinderZ and 6240 Box wanted, ~4700 glows with no bulb anywhere.
//     Same class as the light-staging bug gpu_light_grid.h already documents
//     ("резалось порядком создания (z снизу)"); the cure is the same one that
//     worked there — drop by distance/contribution, and say so out loud.
//
//   kStagingLights = 16384 (gpu_light_grid.h) — the light. Not the binding
//     constraint today: 12 552 emitters fit under it, which is exactly why the
//     glow was present while the bulb was not.
//
// And the frame cost is not the lamp count either: light collection culls at
// kFogRadius = kWorldExtent * 0.5 = 128 m on a torus whose per-axis wrap
// distance is also 128 m, so 66% of the WHOLE WORLD passes, and nothing tests
// occlusion — a bulb five storeys up behind ten slabs is sorted and binned
// every frame like one in your face.

constexpr float kHalfPi = 1.5707963267948966f;

// Map table ordinals (data/props.csv) onto the live enums. Unknown values
// fall back to safe defaults so a bad CSV row cannot crash the seeder.
static PropFallMode fall_mode_from_u8(std::uint8_t v) {
    switch (v) {
    case 1:  return PropFallMode::RagdollRoll;
    case 2:  return PropFallMode::GpuHandoff;
    default: return PropFallMode::SimpleFall;
    }
}

static Interactable::Kind interact_kind_from_u8(std::uint8_t v) {
    // The ordinal IS the generated table row ([interact_table.h], CSV order).
    // Out-of-range (255 = the generator's "None") still has to return SOME
    // enum value because spawn_prop emplaces Interactable unconditionally;
    // spawn_prop_from_id then REMOVES the component for 255. An earlier
    // version of this comment claimed call sites "check interact != 255" —
    // no such check ever existed, which is how a None-row prop would have
    // shipped as a lootable (the E-on-a-toilet bug, §1.3 of the audit, was
    // the same class: furniture rows carried Terminal because None had no
    // working path).
    return v < kInteractCount ? static_cast<Interactable::Kind>(v)
                              : Interactable::Kind::Loot;
}



static inline bool is_solid_cell(CellType type) {
    return type != kCellAir;
}

// Swap StaticPropTag -> DynamicBodyTag without destroying the entity
// ([jirnyak.md] §18 — PropPass/BodyPass filter, no recreate).
static void mark_dynamic(Registry& reg, Entity prop) {
    if (reg.all_of<StaticPropTag>(prop)) {
        reg.remove<StaticPropTag>(prop);
        // Сорванный проп перестаёт быть ОСНАЩЕНИЕМ комнаты (живой хук
        // supply, S12.4): сожгли диван — предложение вернулось к
        // объявленному, а не осталось врать.
        if (const auto* po = reg.try_get<PropOf>(prop))
            if (const auto* t = reg.try_get<Transform>(prop))
                supply_prop_at(reg, t->pos, po->id, -1);
    }
    reg.emplace_or_replace<DynamicBodyTag>(prop);
}

static void detach_single_prop(Registry& reg, Entity prop, PropFallMode mode,
                               const vec3& impulse, const vec3& pos, const vec3& color,
                               std::uint32_t meshKind, EventBus& bus,
                               ParticleBurstQueue* bursts, std::uint32_t seed)
{
    // Resolve skin payload from the live entity when the caller left zeros
    // (anchor_validate / projectile hit historically passed meshKind=0).
    vec3 col = color;
    if ((col.x == 0.0f && col.y == 0.0f && col.z == 0.0f) &&
        reg.all_of<Renderable>(prop)) {
        col = reg.get<Renderable>(prop).color;
    }
    std::uint32_t mk = meshKind;
    if (mk == 0u && reg.all_of<PropMesh>(prop))
        mk = static_cast<std::uint32_t>(reg.get<PropMesh>(prop).shape);

    // Always announce detach so render/GPU handoff and tests can observe it
    // ([jirnyak.md] section 18 PropDetached -- a/b/c = packed world pos).
    bus.publish(EventType::PropDetached,
                static_cast<std::uint32_t>(pos.x),
                static_cast<std::uint32_t>(pos.y),
                static_cast<std::uint32_t>(pos.z));

    if (mode == PropFallMode::GpuHandoff) {
        // The mode's whole promise: no CPU debris entity, the SHOW is GPU
        // particles. It used to keep only the first half and vanish silently —
        // the burst below is what makes the name true. Tinted by the prop's own
        // material row, exactly as a severed antourage piece is
        // ([game/antourage] antourage_carve_step).
        if (bursts != nullptr) {
            std::uint16_t matId = 0;
            if (reg.all_of<PropMesh>(prop))
                matId = reg.get<PropMesh>(prop).matId;
            // Burst direction rides the caller's impulse, which callers derive
            // from the layer's gravity vector — this function has no World and
            // must NOT invent an axis of its own ([AGENTS.md]: never assume -Z).
            // Falls back to +Z when the impulse is degenerate — the same last-resort
            // axis the SimpleFall branch below uses, so the two never disagree.
            const float iLen = length(impulse);
            const vec3 dir = iLen > 1e-6f ? impulse * (0.35f / iLen)
                                          : vec3{0.0f, 0.0f, 0.35f};
            bursts->push(pos, dir, ParticleKind::Debris, 6,
                         matId, seed ^ 0xD3B15u);
        }
        // Погибший GpuHandoff-проп покидает ОСНАЩЕНИЕ (живой хук supply,
        // S12.4) — тем же законом, что детач ниже (mark_dynamic).
        if (const auto* po = reg.try_get<PropOf>(prop))
            supply_prop_at(reg, pos, po->id, -1);
        reg.destroy(prop);
        return;
    }

    // Keep entity identity; drop anchor and flip the static/dynamic tag pair.
    if (reg.all_of<SubVoxelAnchor>(prop))
        reg.remove<SubVoxelAnchor>(prop);
    mark_dynamic(reg, prop);

    // Сорванный проп — тело РАГДОЛЛ-ЯДРА ([markoaudit/plans/ragdoll.md]
    // инкремент 6): интегратор — rigid_body_step (гравитация его; старые
    // GravityAffected + AngularVelocity-косметика умерли). Габарит — из
    // авторского размера строки props.csv (PropMesh.scale), масса — из
    // плотности материала × объём (S11).
    vec3 half{0.2f, 0.2f, 0.2f};
    std::uint8_t matId = 0;
    if (const auto* pm = reg.try_get<PropMesh>(prop)) {
        half = pm->scale * 0.5f;
        matId = pm->matId;
    } else if (const auto* box = reg.try_get<AABB>(prop)) {
        half = box->half;
    }
    // Пол плотности 200 кг/м³: бытовой предмет — не сплошной слиток
    // материала своей поверхности (лампа — жесть и стекло вокруг воздуха);
    // matId=0 (generic) дал бы ноль и бесконечную обратную массу.
    const float density =
        std::max(200.0f, matId < kMatCount ? kMatDensity[matId] : 200.0f);
    const float hardness = static_cast<float>(
        matId < kMatCount ? kMatHardness[matId] : 64);
    const float e_ = restitution_from_hardness(hardness);
    const float mu = friction_from_hardness(hardness);

    if (mode == PropFallMode::RagdollRoll) {
        // Roll: примерно равногабаритное тело (аспект ≤ 1.25 — мяч, ведро,
        // лампа-плафон) честнее и дешевле сферой; вытянутое (стул) —
        // боксом, иначе оно КАТИТСЯ, а должно кувыркаться.
        const float hMin = std::min({half.x, half.y, half.z});
        const float hMax = std::max({half.x, half.y, half.z});
        reg.emplace_or_replace<Velocity>(prop, Velocity{impulse});
        if (hMax <= hMin * 1.25f) {
            const float r = hMin;
            const float mass =
                density * (4.0f / 3.0f) * 3.14159265f * r * r * r;
            rigid_attach_sphere(reg, prop, r, mass, e_, mu);
        } else {
            const float mass =
                density * 8.0f * half.x * half.y * half.z;
            rigid_attach_box(reg, prop, half, mass, e_, mu);
        }
        // Стартовый кувырок от импульса отрыва — прежний авторский вектор.
        reg.get<RigidBody>(prop).w = vec3{impulse.z, impulse.x, 1.0f};
    } else {
        // SimpleFall: a small shove along the pull. Derived by negating the
        // caller's up-facing impulse instead of hardcoding -Z, for the same
        // reason as the burst above — this function never sees a World.
        const float iLen = length(impulse);
        const vec3 down =
            iLen > 1e-6f ? impulse * (-0.5f / iLen) : vec3{0.0f, 0.0f, -0.5f};
        reg.emplace_or_replace<Velocity>(prop, Velocity{down});
        const float mass = density * 8.0f * half.x * half.y * half.z;
        rigid_attach_box(reg, prop, half, mass, e_, mu);
    }

    // BodyPass needs AABB -- without it a detached prop is invisible.
    reg.emplace_or_replace<AABB>(prop, AABB{half});
}

void prop_detach(Registry& reg, Entity prop, EventBus& bus,
                 ParticleBurstQueue* bursts, std::uint32_t seed) {
    if (!reg.valid(prop)) return;
    const PropFallMode mode = reg.all_of<PropFallMode>(prop)
                                  ? reg.get<PropFallMode>(prop)
                                  : PropFallMode::SimpleFall;
    const vec3 pos = reg.all_of<Transform>(prop)
                         ? reg.get<Transform>(prop).pos
                         : vec3{};
    // Нулевой импульс: детач без удара (restore, закон 3) — тело просто
    // ложится физикой; ветки внутри честно берут свой запасной вектор.
    detach_single_prop(reg, prop, mode, vec3{}, pos, vec3{}, 0u, bus, bursts,
                       seed);
}

// §59.2: снаряд платил полный проход по ВСЕМ якорным пропам каждый тик ради
// брод-фейза «якорь в ±1 клетке» — 20 пуль × 12646 пропов × 125 Гц ≈ 32 млн
// итераций/с, худшая per-tick находка каталога. Контейнер и закон ключа —
// общий примитив [sim/cell_bins.h]; политика этого потребителя —
// ПЕРСИСТЕНТНОСТЬ: якорь неподвижен по построению, множество меняется только
// спавном/детачем/смертью. Живёт в reg.ctx(): состояние едет с реестром,
// глобала нет, тесты получают индекс даром. Грязнится сигналами EnTT на
// SubVoxelAnchor — emplace, remove и destroy сущности будят один флаг, и
// любой БУДУЩИЙ мутатор якоря платит тот же долг автоматически, без списка
// мест.
namespace {

struct AnchorBins {
    CellBins bins;
    bool dirty = true;
};

void mark_anchor_bins_dirty(Registry& reg, Entity) {
    if (AnchorBins* b = reg.ctx().find<AnchorBins>()) b->dirty = true;
}

AnchorBins& anchor_bins(Registry& reg) {
    if (AnchorBins* b = reg.ctx().find<AnchorBins>()) return *b;
    AnchorBins& b = reg.ctx().emplace<AnchorBins>();
    reg.on_construct<SubVoxelAnchor>().connect<&mark_anchor_bins_dirty>();
    reg.on_destroy<SubVoxelAnchor>().connect<&mark_anchor_bins_dirty>();
    return b;
}

void rebuild_anchor_bins(Registry& reg, AnchorBins& ab) {
    ab.bins.clear();
    auto view = reg.view<Transform, SubVoxelAnchor, PropFallMode>();
    for (auto entity : view) {
        const auto& a = view.get<SubVoxelAnchor>(entity);
        const auto& tr = view.get<Transform>(entity);
        ab.bins.add(cell_bin_key(tr.layer, a.cx, a.cy, a.cz), entity);
    }
    ab.bins.build();
    ab.dirty = false;
}

} // namespace

bool check_projectile_prop_hits(Registry& reg, LayerId layer, const vec3& projPos,
                                const vec3& projVel,
                                float projHitRadius, EventBus& bus,
                                ParticleBurstQueue* bursts, std::uint32_t seed,
                                Entity source)
{
    // Соседство ±1 клетки покрывает радиус попадания только пока он не
    // перерос клетку — контракт for_each_near ([sim/cell_bins.h]); заявлен
    // static_assert-ом у владельца константы (kProjHitRadius, combat.cpp).
    const float radiusSq = projHitRadius * projHitRadius;
    const int pcx = cell_coord(projPos.x);
    const int pcy = cell_coord(projPos.y);
    const int pcz = cell_coord(projPos.z);

    AnchorBins& ab = anchor_bins(reg);
    if (ab.dirty) rebuild_anchor_bins(reg, ab);

    Entity hitEntity = entt::null;
    PropFallMode hitMode = PropFallMode::SimpleFall;
    vec3 hitPos{0.0f, 0.0f, 0.0f};
    vec3 hitColor{0.8f, 0.8f, 0.8f};

    // 27 соседних бакетов вместо полного view — то же множество кандидатов,
    // что давал старый фильтр |wrap_delta(anchor, pc)| ≤ 1 по каждой оси;
    // узкая фаза (точная wrap-дистанция по позиции) не менялась. Ключ
    // слойный: проп чужого слоя больше не кандидат (латентный межслойный
    // хит по совпавшим xyz умер вместе со старым бесслойным фильтром).
    auto view = reg.view<Transform, SubVoxelAnchor, PropFallMode>();
    ab.bins.for_each_near(layer, pcx, pcy, pcz, [&](Entity entity) {
        if (hitEntity != entt::null) return; // первый найденный уже взят
        // Потеря компонента-соседа (Transform/PropFallMode) не грязнит
        // индекс якорей — страховка членством во view.
        if (!view.contains(entity)) return;

        const auto& tr = view.get<Transform>(entity);
        const float ddx = wrap_delta_f(projPos.x, tr.pos.x, kWorldExtent);
        const float ddy = wrap_delta_f(projPos.y, tr.pos.y, kWorldExtent);
        const float ddz = wrap_delta_f(projPos.z, tr.pos.z, kWorldExtent);

        if (ddx * ddx + ddy * ddy + ddz * ddz <= radiusSq) {
            hitEntity = entity;
            hitMode = view.get<PropFallMode>(entity);
            hitPos = tr.pos;
            hitColor = reg.all_of<Renderable>(entity)
                           ? reg.get<Renderable>(entity).color
                           : vec3{0.8f, 0.8f, 0.8f};
        }
    });

    if (hitEntity != entt::null) {
        // Заряд с триггером «от урона»: выстрел ВЗВОДИТ, а не срывает —
        // atTick=0 значит «уже пора», charge_step взорвёт этим же тиком.
        // Атрибуция килла — стрелявшему (source), не бочке.
        if (const Charge* c = reg.try_get<Charge>(hitEntity);
            c && static_cast<ChargeTrigger>(c->trigger) ==
                     ChargeTrigger::Damage &&
            !reg.all_of<ChargeArmed>(hitEntity)) {
            reg.emplace<ChargeArmed>(hitEntity, ChargeArmed{0u, source});
            return true;
        }
        vec3 impulse = normalize(projVel) * 3.0f + vec3{0.0f, 0.0f, 1.0f};
        detach_single_prop(reg, hitEntity, hitMode, impulse, hitPos, hitColor, 0,
                           bus, bursts, seed);
        return true;
    }
    return false;
}

Entity link_attach_world(Registry& reg, Entity body, const vec3& anchorA,
                         const SubVoxelAnchor& a, float restLen, bool rope) {
    if (!reg.valid(body)) return entt::null;
    Entity link = reg.create();
    JointLink jl;
    jl.a = body;
    jl.b = entt::null; // мировой якорь
    jl.anchorA = anchorA;
    // Точка солвера — ПРОИЗВОДНАЯ записи якоря: центр субвокселя точки
    // крепления, выдвинутый на полсубвокселя по нормали грани (подвес
    // висит НА поверхности опоры, не в её толще). Единственный писатель
    // пары — этот; запись остаётся источником правды для пробы живости.
    {
        const float sub = kCellSize / static_cast<float>(kSubDim); // 0.25 м
        vec3 p{(static_cast<float>(wrap_macro(a.cx)) * kSubDim +
                static_cast<float>(a.subX) + 0.5f) *
                   sub,
               (static_cast<float>(wrap_macro(a.cy)) * kSubDim +
                static_cast<float>(a.subY) + 0.5f) *
                   sub,
               (static_cast<float>(wrap_macro(a.cz)) * kSubDim +
                static_cast<float>(a.subZ) + 0.5f) *
                   sub};
        const int axis = anchor_face_axis(a.face);
        const float dir = static_cast<float>(anchor_face_dir(a.face));
        if (axis == 0) p.x += dir * 0.5f * sub;
        else if (axis == 1) p.y += dir * 0.5f * sub;
        else p.z += dir * 0.5f * sub;
        jl.anchorB = p;
    }
    jl.restLen = restLen;
    jl.rope = rope;
    reg.emplace<JointLink>(link, jl);
    reg.emplace<SubVoxelAnchor>(link, a); // карв рвёт подвес той же пробой
    return link;
}

Entity link_attach(Registry& reg, Entity a, Entity b, const vec3& anchorA,
                   const vec3& anchorB, float restLen, bool rope) {
    if (!reg.valid(a) || !reg.valid(b)) return entt::null;
    Entity link = reg.create();
    JointLink jl;
    jl.a = a;
    jl.b = b;
    jl.anchorA = anchorA;
    jl.anchorB = anchorB;
    jl.restLen = restLen;
    jl.rope = rope;
    reg.emplace<JointLink>(link, jl);
    return link;
}

namespace {
void wake_side(Registry& reg, Entity side) {
    if (side != entt::null && reg.valid(side) && reg.all_of<RigidBody>(side)) {
        auto& rb = reg.get<RigidBody>(side);
        rb.asleep = false;
        rb.sleepTicks = 0;
    }
}
} // namespace

void link_detach(Registry& reg, Entity link) {
    if (!reg.valid(link) || !reg.all_of<JointLink>(link)) return;
    const JointLink jl = reg.get<JointLink>(link);
    wake_side(reg, jl.a);
    wake_side(reg, jl.b);
    reg.destroy(link);
}

std::uint32_t attachment_reaper_step(Registry& reg) {
    static thread_local std::vector<Entity> doomed;
    doomed.clear();
    auto links = reg.view<JointLink>();
    for (auto le : links) {
        const JointLink& jl = links.get<JointLink>(le);
        const bool aDead = jl.a != entt::null && !reg.valid(jl.a);
        const bool bDead = jl.b != entt::null && !reg.valid(jl.b);
        const bool empty = jl.a == entt::null && jl.b == entt::null;
        if (aDead || bDead || empty) doomed.push_back(le);
    }
    for (Entity le : doomed) link_detach(reg, le);
    const std::uint32_t linksReaped =
        static_cast<std::uint32_t>(doomed.size());
    doomed.clear();
    auto segs = reg.view<BodySegment>();
    for (auto se : segs) {
        const Entity root = segs.get<BodySegment>(se).root;
        if (root == entt::null || !reg.valid(root)) doomed.push_back(se);
    }
    for (Entity se : doomed) {
        if (reg.valid(se)) reg.destroy(se);
    }
    return linksReaped + static_cast<std::uint32_t>(doomed.size());
}

void prop_make_dynamic(Registry& reg, Entity prop, EventBus& bus) {
    if (!reg.valid(prop) || !reg.all_of<Transform, PropFallMode>(prop)) return;
    const vec3 pos = reg.get<Transform>(prop).pos;
    const vec3 color = reg.all_of<Renderable>(prop)
                           ? reg.get<Renderable>(prop).color
                           : vec3{0.8f, 0.8f, 0.8f};
    detach_single_prop(reg, prop, reg.get<PropFallMode>(prop),
                       vec3{0.0f, 0.0f, 0.1f}, pos, color, 0, bus, nullptr, 1u);
}

std::uint32_t anchor_validate_step(Registry& reg, const World& world,
                                   LayerId layer, EventBus& bus,
                                   const std::vector<std::uint32_t>& dirtyCells,
                                   ParticleBurstQueue* bursts, std::uint32_t seed)
{
    if (dirtyCells.empty()) return 0;

    // dirtyCells are flat macro_index keys (CarveResult / DoorSet contract).
    static thread_local std::unordered_set<std::uint32_t> dirtySet;
    dirtySet.clear();
    dirtySet.insert(dirtyCells.begin(), dirtyCells.end());

    static thread_local std::vector<PendingDetachedProp> detached;
    detached.clear();

    // Пропы — через персистентные AnchorBins точными бакетами dirty-клеток
    // (§59.2-семья: полный view на каждый карв — тот же класс, что чинили
    // для снарядов). Ключ бина СЛОЙНЫЙ: якорь чужого резидентного этажа с
    // совпавшим macro_index не кандидат — прежний бесслойный проход ронял
    // проп этажа B карвом этажа A (S20.4: слой — часть ключа).
    AnchorBins& ab = anchor_bins(reg);
    if (ab.dirty) rebuild_anchor_bins(reg, ab);
    auto view = reg.view<Transform, SubVoxelAnchor, PropFallMode>();
    for (const std::uint32_t key : dirtySet) {
        if (key >= kMacroCells) continue;
        const int cx = static_cast<int>(key & 127u);
        const int cy = static_cast<int>((key >> 7) & 127u);
        const int cz = static_cast<int>(key >> 14);
        ab.bins.for_each_in(
            cell_bin_key(layer, cx, cy, cz), [&](Entity entity) {
                // Потеря компонента-соседа не грязнит индекс якорей —
                // страховка членством во view.
                if (!view.contains(entity)) return;
                const auto& anchor = view.get<SubVoxelAnchor>(entity);
                // Опора потеряна, когда умерла КОЛОНКА субвокселей у грани
                // крепления ([world/anchor.h] anchor_alive, окно 2×2 в точке
                // крепления) — тот же вопрос, что у антуража, второй пробы
                // больше нет (S11). Прежний тест одного бита из 512 врал в
                // обе стороны: потолок выкарвлен вокруг лампы, а её бит цел
                // — висит на игле; и жизнь вещи была привязана к точке,
                // которой игрок не видит (S2).
                const AnchorUV uv = anchor_face_uv(anchor.face, anchor.subX,
                                                   anchor.subY, anchor.subZ);
                if (anchor_alive(world, cx, cy, cz, anchor.face, uv.u, uv.v))
                    return;
                const auto& tr = view.get<Transform>(entity);
                vec3 col = reg.all_of<Renderable>(entity)
                               ? reg.get<Renderable>(entity).color
                               : vec3{0.8f, 0.8f, 0.8f};
                std::uint32_t mk = 0;
                if (reg.all_of<PropMesh>(entity))
                    mk = static_cast<std::uint32_t>(
                        reg.get<PropMesh>(entity).shape);
                // Направление отрыва = НОРМАЛЬ ГРАНИ крепления (от опоры к
                // вещи) — face наконец читается, как S10 и требовал; провис
                // дальше делает гравитация (S1: геометрия — фрейм, сила —
                // провис). Так уже жил антураж. Прежний толчок «против
                // гравитации» пинал потолочную лампу ВВЕРХ — в только что
                // выкарванный потолок.
                const int fAxis = anchor_face_axis(anchor.face);
                const float fDir =
                    static_cast<float>(anchor_face_dir(anchor.face));
                const vec3 n{fAxis == 0 ? fDir : 0.0f,
                             fAxis == 1 ? fDir : 0.0f,
                             fAxis == 2 ? fDir : 0.0f};
                detached.push_back({entity, view.get<PropFallMode>(entity),
                                    tr.pos, n, col, mk});
            });
    }

    for (std::size_t i = 0; i < detached.size(); ++i) {
        const auto& item = detached[i];
        detach_single_prop(reg, item.entity, item.mode, item.impulse, item.pos,
                           item.color, item.meshKind, bus, bursts,
                           seed ^ static_cast<std::uint32_t>(i) * 0x9E3779B9u);
    }

    // ЛИНКИ С МИРОВЫМ ЯКОРЕМ ([markoaudit/plans/ragdoll.md] §8, решение
    // владельца 2026-08-21: «линк к миру — через единую систему якорей»):
    // линк-сущность несёт SubVoxelAnchor рядом с JointLink, живость — ТА ЖЕ
    // проба anchor_alive, что у пропов выше и у антуража (S2: выкарвил
    // субвоксель — вещь отвалилась; теперь и ПОДВЕС отваливается). Опора
    // умерла → линк уничтожен, обе стороны разбужены — цепь/люстра падает.
    // Счётчик detached не трогаем: это контракт перестройки проп-скина.
    static thread_local std::vector<Entity> severedLinks;
    severedLinks.clear();
    auto linkView = reg.view<JointLink, SubVoxelAnchor>();
    for (auto le : linkView) {
        const auto& anchor = linkView.get<SubVoxelAnchor>(le);
        const int cx = wrap_macro(anchor.cx);
        const int cy = wrap_macro(anchor.cy);
        const int cz = wrap_macro(anchor.cz);
        const std::uint32_t key =
            static_cast<std::uint32_t>(macro_index(cx, cy, cz));
        if (!dirtySet.contains(key)) continue;
        // Слой линка — от его тел: своего Transform у линк-сущности нет
        // (долг S20.3 «линк со слоем»); до посадки E фильтруем по стороне.
        {
            const auto& jl0 = linkView.get<JointLink>(le);
            LayerId linkLayer = layer;
            for (Entity side : {jl0.a, jl0.b})
                if (side != entt::null && reg.valid(side) &&
                    reg.all_of<Transform>(side)) {
                    linkLayer = reg.get<Transform>(side).layer;
                    break;
                }
            if (linkLayer != layer) continue;
        }
        const AnchorUV uv =
            anchor_face_uv(anchor.face, anchor.subX, anchor.subY, anchor.subZ);
        if (anchor_alive(world, cx, cy, cz, anchor.face, uv.u, uv.v))
            continue;
        const auto& jl = linkView.get<JointLink>(le);
        for (Entity side : {jl.a, jl.b}) {
            if (side != entt::null && reg.valid(side) &&
                reg.all_of<RigidBody>(side)) {
                auto& rb = reg.get<RigidBody>(side);
                rb.asleep = false;
                rb.sleepTicks = 0;
            }
        }
        severedLinks.push_back(le);
    }
    for (Entity le : severedLinks) reg.destroy(le);

    return static_cast<std::uint32_t>(detached.size());
}


Entity spawn_prop(Registry& reg, const World& world, const vec3& worldPos,
                  const SubVoxelAnchor& anchor, Interactable::Kind kind,
                  PropFallMode fallMode, const vec3& color, std::uint32_t meshKind,
                  LayerId layer, float yaw, std::uint8_t emissive,
                  std::uint8_t matId, std::uint8_t animPhase, std::uint8_t flags,
                  bool gateAnchor)
{
    int cx = wrap_macro(anchor.cx);
    int cy = wrap_macro(anchor.cy);
    int cz = wrap_macro(anchor.cz);

    // Гейт спавна и проба живости обязаны задавать ОДИН вопрос (иначе вещь
    // спавнится и отваливается первым же карвом соседнего бита): колонка у
    // грани крепления, как в anchor_validate_step выше. Строго шире прежнего
    // побитового теста — всё, что спавнилось, спавнится. Обход гейта — только
    // путь записи снимка, который платит якорной пробой сам (шапка в .h).
    const AnchorUV uv =
        anchor_face_uv(anchor.face, anchor.subX, anchor.subY, anchor.subZ);
    if (gateAnchor &&
        !anchor_alive(world, cx, cy, cz, anchor.face, uv.u, uv.v)) {
        return entt::null;
    }

    Entity prop = reg.create();
    reg.emplace<Transform>(prop, worldPos, layer);
    reg.emplace<SubVoxelAnchor>(prop, SubVoxelAnchor{cx, cy, cz, anchor.subX,
                                                     anchor.subY, anchor.subZ,
                                                     anchor.face});
    reg.emplace<Interactable>(prop, kind, 2.5f, true);
    reg.emplace<PropFallMode>(prop, fallMode);
    reg.emplace<Renderable>(prop, color);
    // Static anchored + mesh-filter tags ([jirnyak.md] §18). Detach swaps
    // StaticPropTag -> DynamicBodyTag without destroying the entity.
    reg.emplace<StaticPropTag>(prop);
    reg.emplace<PropMeshTag>(prop);
    // PropMesh carries PropShape ordinal + instance payload for PropPass skin.
    PropMesh mesh{};
    mesh.shape     = static_cast<std::uint8_t>(meshKind);
    mesh.yaw       = yaw;
    mesh.matId     = matId;
    mesh.emissive  = emissive;
    mesh.flags     = flags;
    mesh.animPhase = animPhase;
    reg.emplace<PropMesh>(prop, mesh);

    return prop;
}

Entity spawn_prop_from_id(Registry& reg, const World& world, const vec3& worldPos,
                          const SubVoxelAnchor& anchor, PropId id,
                          LayerId layer, float yaw,
                          std::uint8_t animPhase, std::uint8_t flags,
                          bool gateAnchor)
{
    if (!prop_valid(id)) return entt::null;
    const PropDef& d = prop_def(id);
    Entity e = spawn_prop(reg, world, worldPos, anchor,
                          interact_kind_from_u8(d.interactKind),
                          fall_mode_from_u8(d.fallMode),
                          prop_color(d),
                          d.shape,
                          layer, yaw, d.emissive, d.matId, animPhase, flags,
                          gateAnchor);
    if (e == entt::null) return entt::null;
    // Строка таблицы на сущности: язык глаголов (S12.3) и любой будущий
    // потребитель словаря спрашивают, ЧЕМ проп является, — supply комнаты
    // (room_supply) читает kPropVerbs[id] через этот компонент.
    reg.emplace<PropOf>(e, PropOf{id});
    // Поставленный проп — ОСНАЩЕНИЕ комнаты (живой хук supply, S12.4).
    // На входе на этаж rebuild пересчитает с нуля — двойного счёта нет.
    supply_prop_at(reg, worldPos, id, +1);
    // Universal mass from the table ([ecs/components.h] Mass): a falling or
    // thrown prop hits with E = m*v^2/2 like everything else in the game.
    reg.emplace_or_replace<Mass>(e, Mass{static_cast<float>(d.massG) * 0.001f});
    // Строка-заряд ([combat.h] Charge): потенциал копируется на сущность.
    // С триггером damage выстрел ВЗВОДИТ такой проп вместо детача
    // (check_projectile_prop_hits ниже), детонацию решает charge_step.
    if (prop_is_charge(d))
        reg.emplace<Charge>(e, Charge{d.explosiveG, d.chargeTrigger, 0});
    // Authored size: the unit shape is scaled to the table's exact metres.
    if (auto* pm = reg.try_get<PropMesh>(e))
        pm->scale = vec3{static_cast<float>(d.sizeXMm) * 0.001f,
                         static_cast<float>(d.sizeYMm) * 0.001f,
                         static_cast<float>(d.sizeZMm) * 0.001f};
    // interact=None in props.csv (generator ordinal 255): the prop is scenery,
    // not a verb. spawn_prop emplaced a clamped Interactable above; take it off.
    if (d.interactKind == 255)
        reg.remove<Interactable>(e);
    // Table reachMm overrides the spawn_prop default (2.5 m).
    if (reg.all_of<Interactable>(e)) {
        auto& ia = reg.get<Interactable>(e);
        ia.reachM = static_cast<float>(d.reachMm) * 0.001f;
    }
    // Светящаяся строка таблицы = светящийся проп, кем бы он ни был. [ddalight.md]
    if (prop_emits_light(d)) {
        PropLight pl;
        pl.color     = prop_color(d);
        pl.radiusM   = static_cast<float>(d.lightRadiusMm) * 0.001f;
        pl.intensity = static_cast<float>(d.lightIntensityE3) * 0.001f;
        pl.dropM     = static_cast<float>(d.sizeZMm) * 0.0005f;
        pl.coneDeg   = d.lightConeDeg;
        pl.flicker   = d.flickerProfile;
        reg.emplace_or_replace<PropLight>(e, pl);
    }
    // Профиль мерцания едет в биты 0..2 PropMesh.flags → vFlags → prop.frag:
    // emissive поверхности мигает ТОЙ ЖЕ функцией, что свет ([game/flicker.h]).
    if (auto* pm = reg.try_get<PropMesh>(e))
        pm->flags = static_cast<std::uint8_t>((pm->flags & ~0x07u) |
                                              (d.flickerProfile & 0x07u));
    return e;
}


std::uint32_t clear_layer_props(Registry& reg, LayerId layer) {

    std::vector<Entity> old_;
    // StaticPropTag marks the floor roster (terminals, shields, padic bulbs) —
    // spawn_prop attaches it. The roster is NOT "whatever carries an anchor":
    // containers hold a SubVoxelAnchor too ([container.cpp] spawn) and never
    // the tag, and when this view keyed on the anchor it wiped every crate on
    // every floor at arrival, refresh_floor_props being called right after
    // refresh_floor_containers (markoaudit-systems.md §1.2 — 38 of 38 crates,
    // including ones just restored from the save). Detached ragdolls lose the
    // tag on detach and are left alone — they belong to the live sim.
    auto view = reg.view<const StaticPropTag, const SubVoxelAnchor, const Transform>();
    for (auto e : view) {
        if (view.get<const Transform>(e).layer == layer)
            old_.push_back(e);
    }
    for (Entity e : old_) reg.destroy(e);
    return static_cast<std::uint32_t>(old_.size());
}

std::uint32_t seed_wall_interactables(Registry& reg, const World& world,
                                      LayerId layer, std::uint32_t seed)
{
    const MacroGrid& grid = world.grid();
    std::uint32_t count = 0;
    constexpr float kCell = kCellSize;

    // WALL-MOUNTED devices, isotropically ([isotropy-law]): a candidate is ANY
    // air cell beside a wall — no floor-support requirement (the old PropPlacer
    // port demanded solid-below, which on the module geometry confined every
    // shield to one ankle-height row per storey). The device anchors INTO the
    // wall cell it hangs on and sits FLUSH against the wall face, centred in
    // the cell, at panel height.
    for (int z = 0; z < kMacroDim; ++z) {
        for (int y = 0; y < kMacroDim; ++y) {
            for (int x = 0; x < kMacroDim; ++x) {
                if (grid.cell(x, y, z) != kCellAir) continue;

                const bool solidWest  = is_solid_cell(grid.cell(x - 1, y, z));
                const bool solidEast  = is_solid_cell(grid.cell(x + 1, y, z));
                const bool solidNorth = is_solid_cell(grid.cell(x, y + 1, z));
                const bool solidSouth = is_solid_cell(grid.cell(x, y - 1, z));
                if (!(solidWest || solidEast || solidNorth || solidSouth)) continue;

                const std::uint32_t rngWall = giga::spatial_hash(x, y, z, seed ^ kSaltWall);
                const std::uint32_t wsel = rngWall % 2000;

                // Sparse bands: ~0.35% shields + ~0.2% terminals of eligible
                // wall cells ≈ a dozen devices per storey (the legacy
                // 10%+10% carpeted whole rooms with thousands).
                PropId pid;
                if (wsel < 7) {
                    pid = PropId::ElectricalShield;
                } else if (wsel < 11) {
                    pid = PropId::Terminal;
                } else {
                    continue;
                }
                const PropDef& d = prop_def(pid);
                const float thick = static_cast<float>(d.sizeYMm) * 0.001f;

                // The wall it hangs on: normal direction + flush offset.
                // Yaw выводится из грани якоря ниже (prop_wall_yaw) — один
                // словарь «грань → поворот» на всех настенных писателей.
                int wxd = 0, wyd = 0;
                if (solidWest)       { wxd = -1; }
                else if (solidEast)  { wxd = 1;  }
                else if (solidSouth) { wyd = -1; }
                else                 { wyd = 1;  }

                // ЗАПРОС ПОВЕРХНОСТЕЙ ([world/surface.h], S10): экспонирована
                // ли грань стены и где её реальная поверхность. Стены лепленые
                // — «заподлицо с границей клетки» вешало панель в воздухе
                // (скрин владельца 2026-08-20: парящий щиток); позиция, якорь
                // и проба живости выводятся из ОДНОЙ записи примитива.
                const std::uint8_t wallFace = anchor_face_pack(
                    wxd != 0 ? 0 : 1, wxd != 0 ? -wxd : -wyd);
                const SurfaceFace sf =
                    surface_face_at(grid, x + wxd, y + wyd, z, wallFace);
                if (sf.columns == 0) continue; // грань не экспонирована
                const float recess = static_cast<float>(
                    anchor_face_dir(wallFace) > 0 ? kSubDim - 1 - sf.layer
                                                  : sf.layer) * kVoxelSize;

                // Flush: slide the panel centre from the cell centre to the
                // REAL wall surface (recess deep), half thickness + a hair.
                const float slide = 1.0f - (0.5f * thick + 0.02f);
                const float wx = (static_cast<float>(x) + 0.5f) * kCell +
                                 static_cast<float>(wxd) * (slide + recess);
                const float wy = (static_cast<float>(y) + 0.5f) * kCell +
                                 static_cast<float>(wyd) * (slide + recess);
                const float wz = (static_cast<float>(z) + 0.5f) * kCell;

                // Anchor INTO the wall cell: the panel falls when its wall is
                // carved, not when some unrelated floor is.
                // Якорь — прямо из записи примитива: слой вдоль оси, (su,sv)
                // по тангенсам (обратное отображение anchor_face_uv).
                SubVoxelAnchor anchor;
                anchor.cx   = static_cast<std::uint8_t>(sf.cx);
                anchor.cy   = static_cast<std::uint8_t>(sf.cy);
                anchor.cz   = static_cast<std::uint8_t>(sf.cz);
                anchor.subX = static_cast<std::uint8_t>(wxd != 0 ? sf.layer : sf.su);
                anchor.subY = static_cast<std::uint8_t>(wxd != 0 ? sf.su : sf.layer);
                anchor.subZ = sf.sv;
                anchor.face = wallFace;

                const std::uint8_t anim = static_cast<std::uint8_t>(rngWall & 0xFFu);
                Entity e = spawn_prop_from_id(reg, world, vec3{wx, wy, wz}, anchor,
                                             pid, layer, prop_wall_yaw(wallFace),
                                             anim, /*flags*/0);
                if (e != entt::null) ++count;
            }
        }
    }
    return count;
}


std::uint32_t seed_ceiling_lights(Registry& reg, const World& world,
                                  LayerId layer, std::uint32_t seed)
{
    const MacroGrid& grid = world.grid();
    std::uint32_t count = 0;
    constexpr float kCell = kCellSize;

    const int pitch = lamp_pitch_cells();               // 8 cells = 16 m
    const int headroom = lamp_light_radius_cells();     // 6 cells = the bulb's own reach
    const int blocks = kMacroDim / pitch;               // exact tiling, no seam stripe

    // One lamp per (pitch x pitch x ceiling-level) block. The block's winner is
    // the candidate with the lowest hash score, so the pattern is even in
    // DENSITY but jittered in position — a raster "first valid cell wins" would
    // park every bulb on its block's low corner and read as a visible grid.
    struct Slot {
        std::uint32_t score;
        std::int16_t x, y;
        std::int8_t su, sv, layer; // запись примитива поверхностей; layer<0 = пусто
    };
    std::vector<Slot> best(static_cast<std::size_t>(blocks) * blocks * kMacroDim,
                           Slot{0xFFFFFFFFu, 0, 0, 0, 0, -1});

    for (int z = 0; z < kMacroDim; ++z) {
        for (int y = 0; y < kMacroDim; ++y) {
            for (int x = 0; x < kMacroDim; ++x) {
                if (grid.cell(x, y, z) != kCellAir) continue;

                const CellType above = grid.cell(x, y, z + 1);
                if (!is_solid_cell(above)) continue;

                // No lamps in doorway/niche cells: walls on BOTH opposite sides
                // means a lintel slot, and a bulb there floats in the opening.
                const bool nichX = is_solid_cell(grid.cell(x - 1, y, z)) &&
                                   is_solid_cell(grid.cell(x + 1, y, z));
                const bool nichY = is_solid_cell(grid.cell(x, y - 1, z)) &&
                                   is_solid_cell(grid.cell(x, y + 1, z));
                if (nichX || nichY) continue;

                // Hang from the REAL ceiling under-face — ЗАПРОС ПОВЕРХНОСТЕЙ
                // ([world/surface.h], S10): грань экспонирована? Ручной
                // lowest_layer_centre + добор точного бита умерли; дырявый
                // центр больше не отменяет лампу — представительная колонка
                // просто съезжает к ближайшей экспонированной.
                const SurfaceFace sfc = surface_face_at(
                    grid, x, y, z + 1, anchor_face_pack(2, -1));
                if (sfc.columns == 0) continue;

                // HEADROOM: some surface within the bulb's own reach below, or
                // this is not a room's ceiling — it is an overhang over a void
                // (or, at z = 127, the torus wrap onto the floor's base mass).
                bool standable = false;
                for (int d = 1; d <= headroom && !standable; ++d)
                    standable = !grid.mask(wrap_macro(x), wrap_macro(y),
                                           wrap_macro(z - d)).empty();
                if (!standable) continue;

                const std::uint32_t score =
                    giga::spatial_hash(x, y, z, seed ^ kSaltLight);
                Slot& slot = best[(static_cast<std::size_t>(z) * blocks +
                                   y / pitch) * blocks + x / pitch];
                if (score >= slot.score) continue;
                slot = Slot{score, static_cast<std::int16_t>(x),
                            static_cast<std::int16_t>(y),
                            static_cast<std::int8_t>(sfc.su),
                            static_cast<std::int8_t>(sfc.sv),
                            static_cast<std::int8_t>(sfc.layer)};
            }
        }
    }

    for (int z = 0; z < kMacroDim; ++z) {
        for (int by = 0; by < blocks; ++by) {
            for (int bx = 0; bx < blocks; ++bx) {
                const Slot& slot =
                    best[(static_cast<std::size_t>(z) * blocks + by) * blocks + bx];
                if (slot.layer < 0) continue;
                const int x = slot.x, y = slot.y;
                const int cz = wrap_macro(z + 1);
                const float faceM = (static_cast<float>(z) + 1.0f) * kCell +
                                    static_cast<float>(slot.layer) * (kCell / 8.0f);

                // Cell CENTRE — the corner form hung bulbs on whatever wall
                // shared the corner (the same bug the wall seeder had).
                const float wx = (static_cast<float>(x) + 0.5f) * kCell;
                const float wy = (static_cast<float>(y) + 0.5f) * kCell;
                const float wz = faceM - 0.14f;

                // Якорь — прямо из записи примитива: представительная
                // экспонированная колонка (su,sv) + её слой. Прежний добор
                // «точного солидного бита центра 2×2» умер вместе с побитовым
                // гейтом (колонковая проба anchor_alive спрашивает то же окно).
                SubVoxelAnchor anchor;
                anchor.cx   = x;
                anchor.cy   = y;
                anchor.cz   = cz;
                anchor.subX = static_cast<std::uint8_t>(slot.su);
                anchor.subY = static_cast<std::uint8_t>(slot.sv);
                anchor.subZ = static_cast<std::uint8_t>(slot.layer);
                anchor.face = anchor_face_pack(2, -1); // нижняя грань потолка

                // BareBulb vs FloodLamp choice stays procedural; skin from props.csv.
                const PropId pid =
                    (slot.score & 1u) ? PropId::BareBulb : PropId::FloodLamp;
                const float yaw = static_cast<float>(slot.score % 4u) * kHalfPi;
                const std::uint8_t anim =
                    static_cast<std::uint8_t>(slot.score & 0xFFu);

                Entity e = spawn_prop_from_id(reg, world, vec3{wx, wy, wz}, anchor,
                                             pid, layer, yaw, anim, /*flags*/0);
                if (e != entt::null) ++count;
            }
        }
    }
    return count;
}

std::uint32_t collect_interactable_positions(const Registry& reg, LayerId layer,
                                             Interactable::Kind kind,
                                             std::vector<vec3>& out)
{
    std::uint32_t n = 0;
    auto view = reg.view<const Transform, const Interactable>();
    for (auto e : view) {
        const auto& tr = view.get<const Transform>(e);
        if (tr.layer != layer) continue;
        const auto& ia = view.get<const Interactable>(e);
        if (!ia.active || ia.kind != kind) continue;
        out.push_back(tr.pos);
        ++n;
    }
    return n;
}

std::uint32_t collect_static_prop_mesh_instances(const Registry& reg, LayerId layer,
                                                 std::vector<PropMeshInstance>& out)
{
    std::uint32_t n = 0;
    // StaticPropTag filters out detached DynamicBodyTag props (BodyPass owns those).
    auto view = reg.view<const Transform, const PropMesh, const StaticPropTag>();
    for (auto e : view) {
        const auto& tr = view.get<const Transform>(e);
        if (tr.layer != layer) continue;
        const auto& mesh = view.get<const PropMesh>(e);
        PropMeshInstance inst{};
        inst.shape     = mesh.shape;
        inst.origin    = tr.pos;
        inst.yaw       = mesh.yaw;
        inst.scale     = mesh.scale;
        inst.matId     = mesh.matId;
        inst.emissive  = mesh.emissive;
        inst.flags     = mesh.flags;
        inst.animPhase = mesh.animPhase;
        if (reg.all_of<Renderable>(e))
            inst.color = reg.get<Renderable>(e).color;
        out.push_back(inst);
        ++n;
    }
    return n;
}


InteractionHit find_nearest_interactable(const Registry& reg, Entity player,
                                         Interactable::Kind kind, float reachM)
{
    InteractionHit hit{};
    if (!reg.valid(player) || !reg.all_of<Transform>(player)) return hit;

    const auto& ptr = reg.get<Transform>(player);
    const LayerId layer = ptr.layer;
    const vec3 ppos = ptr.pos;
    const float reachSq = reachM * reachM;
    float best = reachSq;

    auto view = reg.view<const Transform, const Interactable>();
    for (auto e : view) {
        // Never yourself: the player's own body is an Interactable too now
        // (Kind::Npc, [conversation.md]) and stands at distance zero.
        if (e == player) continue;
        const auto& tr = view.get<const Transform>(e);
        if (tr.layer != layer) continue;
        const auto& ia = view.get<const Interactable>(e);
        if (!ia.active || ia.kind != kind) continue;

        // wrap_dist2 — все три оси. Голый y здесь ослеплял 12 вызывающих
        // (двери/терминалы/щиты/NPC/контейнеры у y-шва) — последняя строка
        // базлайна гейта B, обнулён этим коммитом.
        const float d2 = wrap_dist2(ppos, tr.pos, kWorldExtent);
        if (d2 < best) {
            best = d2;
            hit.entity = e;
            hit.pos = tr.pos;
            hit.distSq = d2;
            hit.hit = true;
        }
    }
    return hit;
}

bool interaction_step(Registry& reg, Entity player, Interactable::Kind kind,
                      EventBus& bus, InteractionHit* outHit)
{
    (void)bus;
    const float reach = (reg.valid(player) && reg.all_of<Transform>(player))
                            ? 3.0f
                            : 0.0f;
    InteractionHit hit = find_nearest_interactable(reg, player, kind, reach);
    if (outHit) *outHit = hit;
    return hit.hit;
}


bool prop_interact_step(Registry& reg, Entity player, Interactable::Kind targetKind,
                        EventBus& bus) {
    return interaction_step(reg, player, targetKind, bus, nullptr);
}

std::uint32_t spawn_form_segments(Registry& reg, Entity root, FormId form,
                                  vec3 bodyHalf, float totalKg,
                                  float restitution, float friction) {
    if (!reg.valid(root) || !reg.all_of<Transform>(root)) return 0;
    const FormDef& def = form_def(form);
    if (def.count == 0) return 0;

    const Transform& rootTr = reg.get<Transform>(root);
    const vec3 basePos = rootTr.pos;
    const LayerId layer = rootTr.layer;
    const vec3 vel0 = reg.all_of<Velocity>(root)
                          ? reg.get<Velocity>(root).v
                          : vec3{0.0f, 0.0f, 0.0f};
    const vec3 tint = reg.all_of<Renderable>(root)
                          ? reg.get<Renderable>(root).color
                          : vec3{0.5f, 0.5f, 0.5f};

    // Доли строк — от габарита ЭТОГО тела (S11): ширина W задаёт поперечник,
    // рост H — вертикаль. Одна строка обслуживает ребёнка и громилу.
    const float W = bodyHalf.x * 2.0f;
    const float H = bodyHalf.z * 2.0f;
    auto seg_pos = [&](const FormSegDef& sd) {
        return basePos + vec3{sd.ox * W, sd.oy * W, sd.oz * H};
    };

    // Сегмент 0 — САМ корень: на нём лут, интеракция и сейв-идентичность.
    Entity made[kMaxFormSegs];
    const FormSegDef& rootSd = kFormSegs[def.first];
    {
        const vec3 half{rootSd.sx * W, rootSd.sy * W, rootSd.sz * H};
        reg.emplace_or_replace<AABB>(root, AABB{half});
        rigid_attach_box(reg, root, half, totalKg * rootSd.massFrac,
                         restitution, friction);
        made[0] = root;
    }

    std::uint32_t n = 0;
    for (std::uint16_t i = 1; i < def.count; ++i) {
        const FormSegDef& sd = kFormSegs[def.first + i];
        const vec3 pos = seg_pos(sd);
        Entity seg = reg.create();
        reg.emplace<Transform>(seg, Transform{pos, layer});
        reg.emplace<Velocity>(seg, Velocity{vel0});
        reg.emplace<Renderable>(seg, Renderable{tint});
        reg.emplace<DynamicBodyTag>(seg);
        reg.emplace<BodySegment>(seg, BodySegment{root});
        const float kg = totalKg * sd.massFrac;
        if (sd.prim == FormPrim::Sphere) {
            const float r = sd.sx * H;
            reg.emplace<AABB>(seg, AABB{vec3{r, r, r}});
            rigid_attach_sphere(reg, seg, r, kg, restitution, friction);
        } else {
            const vec3 half{sd.sx * W, sd.sy * W, sd.sz * H};
            reg.emplace<AABB>(seg, AABB{half});
            rigid_attach_box(reg, seg, half, kg, restitution, friction);
        }
        made[i] = seg;
        ++n;

        // Связь с родителем: восстановленная длина — фактическое расстояние
        // между центрами, так форма и есть покойная поза.
        const Entity parent =
            (sd.parent == kFormNoParent) ? root : made[sd.parent];
        Entity link = reg.create();
        JointLink jl;
        jl.a = seg;
        jl.b = parent;
        jl.restLen = length(wrap_delta3(
            pos, reg.get<Transform>(parent).pos, kWorldExtent));
        jl.rope = sd.rope != 0;
        reg.emplace<JointLink>(link, jl);
        reg.emplace<BodySegment>(link, BodySegment{root});
        ++n;
    }
    return n;
}


Entity carry_nearest_body(Registry& reg, Entity carrier, const vec3& forward,
                          float reachM, std::uint8_t freeHands) {
    if ((freeHands & 0x3u) == 0) return entt::null; // обе руки заняты
    if (!reg.valid(carrier) || !reg.all_of<Transform>(carrier))
        return entt::null;
    const Transform& ctr = reg.get<Transform>(carrier);
    const float reachSq = reachM * reachM;

    Entity best = entt::null;
    float bestD2 = reachSq;
    auto view = reg.view<RigidBody, Transform>();
    for (auto e : view) {
        if (e == carrier) continue;
        if (reg.all_of<CarriedBy>(e)) continue; // уже в чьих-то руках
        // Сегмент чужого тела не берётся сам — берётся его КОРЕНЬ, иначе
        // игрок таскал бы труп за голову, а таз оставался на полу.
        if (reg.all_of<BodySegment>(e)) continue;
        const Transform& tr = view.get<Transform>(e);
        if (tr.layer != ctr.layer) continue;
        const float d2 = wrap_dist2(ctr.pos, tr.pos, kWorldExtent);
        if (d2 < bestD2) {
            bestD2 = d2;
            best = e;
        }
    }
    if (best == entt::null) return entt::null;

    // Держим перед собой: вперёд на радиус тела плюс полшага, чуть выше
    // центра носителя — вывод из габаритов, не подобранное число.
    const float bodyR = reg.get<RigidBody>(best).radius;
    const float carrierR = reg.all_of<AABB>(carrier)
                               ? std::max(reg.get<AABB>(carrier).half.x,
                                          reg.get<AABB>(carrier).half.y)
                               : 0.4f;
    const vec3 fwd = normalize(forward);
    CarriedBy cb;
    cb.carrier = carrier;
    cb.offset = fwd * (carrierR + bodyR + 0.1f) + vec3{0.0f, 0.0f, 0.2f};
    cb.hand = (freeHands & 0x1u) != 0 ? 0u : 1u; // младшая свободная рука
    reg.emplace_or_replace<CarriedBy>(best, cb);
    return best;
}

std::uint32_t drop_carried(Registry& reg, Entity carrier, const vec3& forward,
                           float throwSpeed, int hand) {
    static thread_local std::vector<Entity> dropped;
    dropped.clear();
    auto view = reg.view<CarriedBy>();
    for (auto e : view) {
        const CarriedBy& cb = view.get<CarriedBy>(e);
        if (cb.carrier != carrier) continue;
        if (hand >= 0 && cb.hand != static_cast<std::uint8_t>(hand)) continue;
        dropped.push_back(e);
    }
    const vec3 fwd = normalize(forward);
    for (Entity e : dropped) {
        reg.remove<CarriedBy>(e);
        // Скорость носителя уже в теле (кинематический follow её зеркалит) —
        // бросок добавляется поверх, поэтому на бегу летит дальше.
        if (auto* vel = reg.try_get<Velocity>(e)) vel->v += fwd * throwSpeed;
        if (auto* rb = reg.try_get<RigidBody>(e)) {
            rb->asleep = false;
            rb->sleepTicks = 0;
        }
    }
    return static_cast<std::uint32_t>(dropped.size());
}

void destroy_body_segments(Registry& reg, const std::vector<Entity>& roots) {
    if (roots.empty()) return;
    static thread_local std::vector<Entity> doomed;
    doomed.clear();
    auto view = reg.view<BodySegment>();
    for (auto e : view) {
        const Entity root = view.get<BodySegment>(e).root;
        for (Entity r : roots) {
            if (r == root) {
                doomed.push_back(e);
                break;
            }
        }
    }
    for (Entity e : doomed) reg.destroy(e);
}

} // namespace giga::game
