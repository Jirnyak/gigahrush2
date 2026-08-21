// Engine-core ECS components.
//
// These are the *universal* components the core needs to move things and view
// the world. They are all POD. A game adds its own components (health, faction,
// inventory) alongside these without touching the engine.
//
// Design pillar: the camera and the controller are components you attach to any
// entity. The "player" is not special — it is simply the entity that currently
// owns a CameraTag and a Controller. Hand those components to a bird, a bullet,
// or a debug free-cam and it just works.
#pragma once
#include <cstdint>

#include "core/math.h"
#include "ecs/registry.h" // Entity — JointLink ссылается на тела
#include "world/level_stack.h"

namespace giga {

// Position in world units, plus which level-stack layer (W) the entity is on.
struct Transform {
    vec3 pos{0, 0, 0};
    LayerId layer = 0;
};

struct Velocity {
    vec3 v{0, 0, 0};
};

// Axis-aligned bounding box, expressed as half-extents around Transform::pos.
struct AABB {
    vec3 half{0.4f, 0.4f, 0.9f};
};

// Mass in kilograms — THE universal physical context (owner, 2026-08-02). One
// number, two laws everywhere: E = m*v^2/2 and p = m*v. Fall damage, a thrown
// prop's punch, knockback and a ragdoll's swing are all the same arithmetic over
// this one component — never a per-system constant.
//
// FILLED FROM ONE UNIT. Every content table spells mass as `mass_g`, whole GRAMS
// in a uint32 — mobs.csv, props.csv and items.csv alike (2026-08-07; before that
// props meant grams and mobs meant kg x10 in the same 16 bits, which capped a
// prop at 65.5 kg while mob rows already carried 900). Debris comes from
// materials.csv density via `material_subvoxel_mass_kg`, and an NPC body from its
// stature via `body_mass_kg`.
//
// A BODY'S MASS INCLUDES WHAT IT CARRIES. `encumbrance_step` ([encumbrance.h])
// recomputes body + inventory, which is why a loaded fall hurts more and a loaded
// body is shifted less — through these two laws, with neither law changed.
struct Mass {
    float kg = 70.0f;
};

// The physics system's impact report: the collision speed the sweep KILLED this
// step (m/s over the axes that hit). Written by physics_step whenever it zeroes
// velocity components above a small threshold; consumed and REMOVED by the game
// layer's impact law (damage = k * m * v^2 / 2 over Mass). A POD seam, so L2
// physics never knows what HP is.
struct Impact {
    float speed = 0.0f;
};

// Marks an entity as subject to the layer's gravity field.
struct GravityAffected {
    float scale = 1.0f;   // multiplier on the gravity vector
    bool grounded = false; // set by the physics system each step
};

// Jump parameters + request. Set `wants_jump` from input; the physics system
// consumes it when grounded and applies `impulse` along -gravity.
struct Jump {
    float impulse = 5.0f;
    bool wants_jump = false;
};

// Attach to the entity that should drive the view. Only one is expected to be
// active; the camera system picks the first it finds.
struct CameraTag {
    float yaw = 0.0f;    // radians, around world +Z (up)
    float pitch = 0.0f;  // radians, clamped to +/- ~89 deg
    float fovY = 1.2f;   // radians
    vec3 eyeOffset{0, 0, 0.7f}; // eye relative to Transform::pos
};

// Attach to make an entity respond to input. The input layer writes movement
// intent here; the controller system turns it into velocity.
struct Controller {
    float moveSpeed = 6.0f;
    // Movement intent in the entity's local frame (forward/right/up), each in
    // [-1, 1]. Populated by the input layer every frame.
    vec3 wishDir{0, 0, 0};
    bool fly = false; // true = 6DoF free-cam; false = walk + gravity
};

// "Something else owns my motion — physics_step, keep out."
//
// **This closes a real double-integration bug.** `physics_step` iterates
// `<Transform, Velocity>` and integrates everything it finds. Projectiles carry both,
// and `projectile_step` ALSO integrates them — so every shot in the game moved twice per
// tick, at double speed AND double gravity. An audit measured a projectile authored at
// 30 m/s covering 6.000 m in 12 ticks where 3.000 m was intended: ratio exactly 2.00.
//
// A TAG in the core rather than a `Projectile` check inside physics_step, because
// `src/sim` may not include `src/game` ([AGENTS.md] layering). Anything that integrates
// its own motion carries this.
struct SelfIntegrating {};

// "Move me, but let me pass through everything" — debug/console noclip.
//
// physics_step still integrates velocity and wraps the torus for a carrier, but
// skips gravity, jumping and the swept-AABB collision entirely, so the body
// flies through walls instead of backing out of them. A TAG in the core for the
// same layering reason as SelfIntegrating: the console that toggles it lives in
// the game layer, and `src/sim` may not include `src/game`.
struct NoClip {};

// Cosmetic body colour for the render layer. Any entity that also carries a
// Transform + AABB is drawn by the body pass as one lit box, sized to the AABB
// half-extents and tinted by `color`. Purely a render skin: data flows
// sim -> render only, so the sim never reads this — adding or removing it
// changes pixels, never outcomes. The game sets the colour at embody time (e.g.
// by faction). Kept in the core so the render pass depends only on core
// components, never on the game layer.
struct Renderable {
    vec3 color{0.80f, 0.80f, 0.82f};
};

// Angular motion for ragdoll / tumbling props ([jirnyak.md] section 18).
//
// Lives in the CORE — not the game layer — for the same reason as
// SelfIntegrating / NoClip: `physics_step` (src/sim) must integrate them, and
// src/sim may not include src/game. The game attaches these on RagdollRoll
// detach; physics_step advances Rotation from AngularVelocity each substep.
//
// Rotation is Euler (radians, XYZ) for now: core/math.h has no quat type yet.
// A later pass can swap to quat without changing the attachment contract.
struct AngularVelocity {
    vec3 w{0.0f, 0.0f, 0.0f}; // rad/s
};

struct Rotation {
    vec3 euler{0.0f, 0.0f, 0.0f}; // radians, XYZ
};

// Импульсный твердотел — универсальное ядро физики пропов
// ([markoaudit/plans/ragdoll.md], решения владельца 2026-08-21: ОДНА модель на
// RagdollRoll и SimpleFall; масштаб — тысячи тел на этаже, поэтому сон —
// главный механизм: спящее тело интегратор пропускает целиком).
//
// Линейное состояние живёт в существующих Transform.pos / Velocity.v, чтобы
// рендер-пути (BodyPass) и швы (Impact) работали без изменений; здесь —
// ориентация, вращение и контактные параметры. Коллизия — СФЕРА против
// субвокселей (S2: локальный вопрос спрашивает атомы); любая форма — набор
// сфер, один шар — вырожденный случай (инкремент 1).
//
// Носитель ОБЯЗАН также нести SelfIntegrating: rigid_body_step — его
// интегратор, и без тега physics_step (свепт-AABB агентов) двигал бы тело
// вторым разом — та же двойная скорость, что была у снарядов.
//
// Контактные константы (invMass/invInertia/restitution/friction) — ВЫВОДЯТСЯ
// спавнером из материала и габарита (S11): масса = kMatDensity × объём,
// инерция сферы = 0.4·m·r². Ядро таблиц не читает — ест готовые числа.
struct RigidBody {
    quat q{};                    // ориентация (единичный кватернион)
    vec3 w{0.0f, 0.0f, 0.0f};    // угловая скорость, рад/с, мировой фрейм
    float radius = 0.3f;         // коллизионная сфера БЕЗ ContactForm; с ней —
                                 // радиус ограничивающей сферы (брод-фаза)
    float invMass = 1.0f;        // 1/кг
    float invInertia = 1.0f;     // 1/(кг·м²), скаляр (диагональный тензор —
                                 // инкремент 7, если скаляр виден глазами)
    float restitution = 0.3f;    // отскок 0..1 (порог в ядре гасит дребезг)
    float friction = 0.5f;       // Кулон μ — он же раскручивает качение
    std::uint8_t sleepTicks = 0; // подряд тихих тиков с контактом
    bool asleep = false;         // спит: v=w=0, интегратор пропускает;
                                 // будится записью Velocity извне и линком
    bool touchedTick = false;    // ТРАНЗИТ: был контакт с миром в этом тике
                                 // (пишет rigid_body_step, больше никто)
};

// Форма тела для солвера ([markoaudit/plans/ragdoll.md] фундамент, решения
// владельца 2026-08-21): словарь АВТОРА — сфера и бокс, словарь СОЛВЕРА —
// ТОЛЬКО сфера. Бокс раскладывается при спавне в контактные сферы (8 углов +
// 6 центров граней), жёстко сидящие в теле, — они дают честный момент и
// кувырок, а контактная процедура в ядре остаётся одна.
//
// Компонент РАЗРЕЖЕННЫЙ: нет ContactForm — тело есть одна сфера
// RigidBody.radius в центре (мяч, ноль лишней памяти на тысячах тел).
// 14 = 8 углов + 6 граней бокса — самый жирный примитив словаря.
inline constexpr int kMaxContactSpheres = 14;

struct ContactForm {
    std::uint8_t count = 0;
    vec3 off[kMaxContactSpheres]{};  // офсеты в ФРЕЙМЕ ТЕЛА
    float r[kMaxContactSpheres]{};   // радиусы контактных сфер
};

// Связь двух твердотел — ОТДЕЛЬНАЯ ЛИНК-СУЩНОСТЬ, не свойство формы
// ([markoaudit/plans/ragdoll.md] фундамент §8, решение владельца 2026-08-21):
// разрубание = destroy линк-сущности, связывание (верёвка, трос, сцепка) =
// create линка между ЛЮБЫМИ двумя телами. Ядро агностично: труп, люстра на
// тросе, два ящика верёвкой — одна механика.
//
// b == entt::null — якорь В МИРЕ: anchorB тогда мировая точка (подвес на
// крюк). rope — линк только ТЯНЕТ (dist > restLen), жёсткая штанга тянет и
// толкает. Решается импульсами в том же солвере, что контакты.
struct JointLink {
    Entity a = entt::null;
    Entity b = entt::null;            // entt::null = мировой якорь
    vec3 anchorA{0.0f, 0.0f, 0.0f};   // фрейм тела a
    vec3 anchorB{0.0f, 0.0f, 0.0f};   // фрейм тела b, либо мировая точка
    float restLen = 0.0f;             // покойная длина, м
    bool rope = false;                // true: только тянет
};

// Prop render-path filter tags ([jirnyak.md] section 18).
//
// Live in the CORE — not the game layer — for the same reason as CameraTag /
// Renderable: BodyPass (src/render) must filter StaticPropTag so static
// furniture is PropPass-only, and src/render may not include src/game. The
// game attaches these at spawn; on detach it swaps StaticPropTag ->
// DynamicBodyTag without destroying the entity. PropMeshTag marks entities
// that carry a GPU mesh skin payload (the payload itself stays in game).
struct StaticPropTag {};
struct DynamicBodyTag {};
struct PropMeshTag {};

} // namespace giga
