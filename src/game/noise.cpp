#include "game/noise.h"

#include <cmath>
#include <cstring>

#include "core/wrap.h"
#include "game/ranged_table.h"
#include "world/clearance.h" // face_clearance_at — газовый закон граней (G)
#include "world/types.h"
#include "world/world.h"

namespace giga::game {

namespace {

// Reference constants, cited so they can be checked without reopening the source
// (../gigahrush/src/systems/noise.ts and src/systems/ai/monster.ts).
constexpr float kWeaponBaseRadius = 9.0f;     // fallback formula's floor
constexpr float kWeaponDmgDivisor = 7.0f;
constexpr float kWeaponPelletCap = 8.0f;
constexpr float kWeaponRadiusCap = 24.0f;     // min(24, ...) in the formula
constexpr std::uint16_t kWeaponTtlMs = 2800;  // 2.8 s

// An explosion is heard four blast radii away — a 5 m grenade is audible at 20 m,
// which is inside the reference's 24 m cap for a firearm and outside its 13 m
// severity-3 band, so a detonation is the loudest thing on the floor without being
// audible across it. Longer-lived than a gunshot (4.0 s against 2.8) because the
// thing that draws a monster to a blast is the silence after it as much as the bang.
constexpr float kBlastRadiusMult = 4.0f;
constexpr float kBlastRadiusCap = 24.0f;
constexpr std::uint16_t kBlastTtlMs = 4000;

constexpr float kBodyRadius = 6.0f;
constexpr std::uint16_t kBodyTtlMs = 1600;

constexpr float kContainerRadius = 7.0f;      // the reference's plain-door profile
constexpr std::uint16_t kContainerTtlMs = 2200;

// The reference's scoring weights, from `findNoiseForActor`.
constexpr float kScoreSeverity = 10.0f;
constexpr float kScoreNearness = 8.0f;
constexpr float kScoreAgePerSec = 0.5f;

std::uint8_t clamp_severity(int s) {
    if (s < 0) return 0;
    if (s > static_cast<int>(kNoiseSeverityMax)) return kNoiseSeverityMax;
    return static_cast<std::uint8_t>(s);
}

} // namespace

std::uint32_t noise_publish(NoiseField& field, LayerId layer, const vec3& pos,
                            const NoiseProfile& p, std::uint32_t actor) {
    // A degenerate profile is refused rather than clamped up to something audible:
    // publishing "a sound with no loudness" is a caller bug, and inventing a radius
    // for it would hide that bug behind plausible behaviour.
    if (!(p.radius > 0.0f) || p.ttlMs == 0 || p.source == NoiseSource::None) {
        ++field.dropped;
        return 0;
    }
    // Layer ids past one byte are refused, not masked. See kNoiseLayerMax: aliasing
    // a floor onto (id % 256) would make a gunshot on one floor audible on another,
    // which is exactly the class of bug the LayerId-is-not-a-floor-number rule
    // exists to prevent.
    if (layer > kNoiseLayerMax) {
        ++field.dropped;
        return 0;
    }

    float radius = p.radius;
    if (radius > kNoiseRadiusCap) radius = kNoiseRadiusCap;
    if (radius < kNoiseRadiusMin) radius = kNoiseRadiusMin;
    const std::uint8_t sev = clamp_severity(p.severity);

    // Find a free slot, and while walking remember the weakest live one in case
    // there is none. One pass, not two.
    std::size_t free = kNoiseCap;
    std::size_t weakest = kNoiseCap;
    std::uint8_t weakestSev = 0xFFu;
    std::uint16_t weakestTtl = 0xFFFFu;
    for (std::size_t i = 0; i < kNoiseCap; ++i) {
        const Noise& s = field.slot[i];
        if (s.id == 0) {
            if (free == kNoiseCap) free = i;
            continue;
        }
        // Weakest = lowest severity, then least remaining life. Ties keep the
        // earlier slot, so eviction is deterministic and a test can pin it.
        if (s.severity < weakestSev ||
            (s.severity == weakestSev && s.ttlMs < weakestTtl)) {
            weakestSev = s.severity;
            weakestTtl = s.ttlMs;
            weakest = i;
        }
    }

    std::size_t at = free;
    if (at == kNoiseCap) {
        // Full. Evict the weakest — UNLESS the incoming noise is weaker still, in
        // which case refusing it is the honest answer. This is the whole reason the
        // policy differs from the event bus (see the header): a ring full of
        // footsteps must never swallow a rifle.
        if (weakest == kNoiseCap) {
            ++field.dropped;
            return 0;
        }
        if (sev < weakestSev ||
            (sev == weakestSev && p.ttlMs <= weakestTtl)) {
            ++field.dropped;
            return 0;
        }
        at = weakest;
        // The evicted slot was live, so liveCount is about to be re-incremented
        // for the replacement; net zero. Decrement here so the two paths converge.
        --field.liveCount;
    }

    Noise& n = field.slot[at];
    n.x = pos.x;
    n.y = pos.y;
    n.z = pos.z;
    n.radius = radius;
    n.id = field.nextId++;
    // nextId is monotonic and never reused, which is what lets a one-shot behaviour
    // store "the last id I reacted to". Wrapping past 2^32 would alias a brand-new
    // noise onto a remembered one; at one id per publish that is unreachable in a
    // session, but skipping 0 keeps "no noise" unambiguous forever.
    if (field.nextId == 0) field.nextId = 1;
    n.actor = actor;
    n.ttlMs = p.ttlMs;
    n.lifeMs = p.ttlMs;
    n.layer = static_cast<std::uint8_t>(layer);
    n.source = static_cast<std::uint8_t>(p.source);
    n.severity = sev;
    n.pad_ = 0;
    ++field.liveCount;
    return n.id;
}

std::uint32_t noise_step(NoiseField& field, std::uint32_t dtMs) {
    if (field.liveCount == 0) return 0;   // the common case, and it costs nothing
    const std::uint16_t d = dtMs > 0xFFFFu ? 0xFFFFu
                                           : static_cast<std::uint16_t>(dtMs);
    std::uint32_t expired = 0;
    for (Noise& s : field.slot) {
        if (s.id == 0) continue;
        if (s.ttlMs > d) {
            s.ttlMs = static_cast<std::uint16_t>(s.ttlMs - d);
            continue;
        }
        // Expired. The slot is zeroed rather than merely id-cleared so a stale
        // position can never be read back through a bug elsewhere.
        s = Noise{};
        ++expired;
        --field.liveCount;
    }
    return expired;
}

void noise_clear(NoiseField& field) {
    for (Noise& s : field.slot) s = Noise{};
    field.liveCount = 0;
    // nextId is deliberately NOT reset. Ids must stay unique across a floor change
    // or a consumer holding "the last id I reacted to" would match a fresh noise on
    // the new floor and silently skip it.
}

NoiseProfile weapon_fire_noise(const RangedDef& d) {
    float pellets = static_cast<float>(d.pellets);
    if (pellets > kWeaponPelletCap) pellets = kWeaponPelletCap;
    float radius = kWeaponBaseRadius +
                   static_cast<float>(d.dmg) / kWeaponDmgDivisor + pellets;
    if (radius > kWeaponRadiusCap) radius = kWeaponRadiusCap;

    // The reference's own banding. There is no `aoeRadius` and no `bfg` among the
    // 29 ProjType::Normal rows ([ranged_table.h] defers all 19 of those), so the
    // severity-5 and severity-4-by-area arms of its expression are unreachable here
    // and are not written out as dead branches.
    NoiseProfile p;
    p.radius = radius;
    p.ttlMs = kWeaponTtlMs;
    p.severity = radius >= 21.0f ? 4u : (radius >= 13.0f ? 3u : 2u);
    p.source = NoiseSource::WeaponFire;
    return p;
}

NoiseProfile blast_noise(float blastRadiusM) {
    float radius = blastRadiusM * kBlastRadiusMult;
    if (radius > kBlastRadiusCap) radius = kBlastRadiusCap;
    NoiseProfile p;
    p.radius = radius;
    p.ttlMs = kBlastTtlMs;
    // Severity 5, the top of the band — and the FIRST thing in the tree to use it.
    // `weapon_fire_noise` above records that the reference's severity-5 arm was
    // unreachable "because there is no aoeRadius among the 29 ProjType::Normal
    // rows". Row 30 has one, so the arm is reachable and this is it.
    p.severity = kNoiseSeverityMax;
    p.source = NoiseSource::Explosion;
    return p;
}

NoiseProfile body_fall_noise() {
    NoiseProfile p;
    p.radius = kBodyRadius;
    p.ttlMs = kBodyTtlMs;
    p.severity = 2;   // exactly the investigation threshold: worth one look
    p.source = NoiseSource::Body;
    return p;
}

NoiseProfile container_open_noise() {
    NoiseProfile p;
    p.radius = kContainerRadius;
    p.ttlMs = kContainerTtlMs;
    p.severity = 2;
    p.source = NoiseSource::Container;
    return p;
}

// ---------------------------------------------------------------------------
// Акустика на скелете (S20.1, инкремент G) — шар путевых дистанций
// ---------------------------------------------------------------------------

namespace {

inline std::size_t ball_index(int dx, int dy, int dz) {
    // Смещение от источника [-R, R] по каждой оси → плотный индекс шара.
    return (static_cast<std::size_t>(dz + kNoiseBallRadiusCells) *
                kNoiseBallDim +
            static_cast<std::size_t>(dy + kNoiseBallRadiusCells)) *
               kNoiseBallDim +
           static_cast<std::size_t>(dx + kNoiseBallRadiusCells);
}

// Ограниченный флуд одного шума: BFS по граням проходимости от клетки
// источника, газовый закон (clearance >= 1 — «звуку хватает щели», тот же
// один закон, что у сред и запаха). Дистанция — метры пути, шаг = 2 м.
void bake_ball(NoiseAcoustics& ac, const World& world, std::size_t slot,
               const Noise& n) {
    if (ac.dist.empty())
        ac.dist.assign(kNoiseCap * kNoiseBallCells, kNoiseUnreachable);
    std::uint8_t* d = ac.dist.data() + slot * kNoiseBallCells;
    std::memset(d, kNoiseUnreachable, kNoiseBallCells);

    const int sx = wrap_macro(static_cast<int>(n.x / kCellSize));
    const int sy = wrap_macro(static_cast<int>(n.y / kCellSize));
    const int sz = wrap_macro(static_cast<int>(n.z / kCellSize));
    ac.id[slot] = n.id;
    ac.srcX[slot] = static_cast<std::uint8_t>(sx);
    ac.srcY[slot] = static_cast<std::uint8_t>(sy);
    ac.srcZ[slot] = static_cast<std::uint8_t>(sz);

    // Предел флуда: radius × потолок остроты слуха, не дальше шара.
    float limitM = n.radius * kNoiseHearingMultCeil;
    if (limitM > kNoiseRadiusCap) limitM = kNoiseRadiusCap;
    const int limit = static_cast<int>(limitM); // метров, целых

    const MacroGrid& g = world.grid();
    ac.queue.clear();
    d[ball_index(0, 0, 0)] = 0;
    // Пакуем смещение в один int: (dz+R)<<12 | (dy+R)<<6 | (dx+R); 6 бит на
    // ось хватает (dim 49 < 64).
    auto pack = [](int dx, int dy, int dz) {
        return ((dz + kNoiseBallRadiusCells) << 12) |
               ((dy + kNoiseBallRadiusCells) << 6) |
               (dx + kNoiseBallRadiusCells);
    };
    ac.queue.push_back(pack(0, 0, 0));
    std::size_t head = 0;
    std::uint64_t visited = 1;
    while (head < ac.queue.size()) {
        const int p = ac.queue[head++];
        const int dx = (p & 63) - kNoiseBallRadiusCells;
        const int dy = ((p >> 6) & 63) - kNoiseBallRadiusCells;
        const int dz = ((p >> 12) & 63) - kNoiseBallRadiusCells;
        const int cur = d[ball_index(dx, dy, dz)];
        const int cand = cur + static_cast<int>(kCellSize); // шаг 2 м
        if (cand > limit) continue;
        const int x = wrap_macro(sx + dx);
        const int y = wrap_macro(sy + dy);
        const int z = wrap_macro(sz + dz);
        // 6 граней; проходимость плюс-грани хранит младшая клетка оси.
        struct Step { int ax, sxs, dxn, dyn, dzn; };
        const Step steps[6] = {
            {0, +1, dx + 1, dy, dz}, {0, -1, dx - 1, dy, dz},
            {1, +1, dx, dy + 1, dz}, {1, -1, dx, dy - 1, dz},
            {2, +1, dx, dy, dz + 1}, {2, -1, dx, dy, dz - 1},
        };
        for (const Step& s : steps) {
            if (s.dxn < -kNoiseBallRadiusCells || s.dxn > kNoiseBallRadiusCells ||
                s.dyn < -kNoiseBallRadiusCells || s.dyn > kNoiseBallRadiusCells ||
                s.dzn < -kNoiseBallRadiusCells || s.dzn > kNoiseBallRadiusCells)
                continue;
            std::uint8_t& slotD = d[ball_index(s.dxn, s.dyn, s.dzn)];
            if (slotD != kNoiseUnreachable) continue; // BFS: первый визит короче
            const bool plus = s.sxs > 0;
            const std::uint8_t clr =
                plus ? face_clearance_at(g, x, y, z, s.ax)
                     : face_clearance_at(g, s.ax == 0 ? wrap_macro(x - 1) : x,
                                         s.ax == 1 ? wrap_macro(y - 1) : y,
                                         s.ax == 2 ? wrap_macro(z - 1) : z,
                                         s.ax);
            if (clr < 1) continue; // глухо — стена держит звук
            slotD = static_cast<std::uint8_t>(cand);
            ac.queue.push_back(pack(s.dxn, s.dyn, s.dzn));
            ++visited;
        }
    }
    ++ac.bakes;
    ac.bakedCells += visited;
}

} // namespace

std::uint32_t noise_acoustics_step(NoiseAcoustics& ac, const NoiseField& field,
                                   const World& world, LayerId layer) {
    if (field.quiet()) return 0;
    if (layer > kNoiseLayerMax) return 0;
    std::uint32_t baked = 0;
    for (std::size_t i = 0; i < kNoiseCap; ++i) {
        const Noise& n = field.slot[i];
        if (n.id == 0) continue;
        if (n.layer != static_cast<std::uint8_t>(layer)) continue;
        if (ac.id[i] == n.id) continue; // шар уже есть
        bake_ball(ac, world, i, n);
        ++baked;
    }
    return baked;
}

const char* noise_source_name(NoiseSource s) {
    switch (s) {
        case NoiseSource::None:       return "-";
        case NoiseSource::WeaponFire: return "shot";
        case NoiseSource::Melee:      return "metal";
        case NoiseSource::Footstep:   return "steps";
        case NoiseSource::Door:       return "door";
        case NoiseSource::Container:  return "crate";
        case NoiseSource::Body:       return "body";
        case NoiseSource::Siren:      return "siren";
        case NoiseSource::Explosion:  return "blast";
        case NoiseSource::Decoy:      return "decoy";
        case NoiseSource::Count:      break;
    }
    return "?";
}

float noise_distance(const Noise& n, const vec3& pos,
                     const NoiseAcoustics* ac) {
    // ПУТЕВАЯ дистанция по скелету, когда у шума есть бейкнутый шар (G):
    // стены глушат, дыры пропускают. Поиск слота — линейный по 64 id
    // (дёшево); стухший id живого не совпадёт (монотонность).
    if (ac && !ac->dist.empty()) {
        for (std::size_t i = 0; i < kNoiseCap; ++i) {
            if (ac->id[i] != n.id || n.id == 0) continue;
            const int lx = wrap_macro(static_cast<int>(pos.x / kCellSize));
            const int ly = wrap_macro(static_cast<int>(pos.y / kCellSize));
            const int lz = wrap_macro(static_cast<int>(pos.z / kCellSize));
            const int dx = ((lx - ac->srcX[i] + kMacroDim / 2) &
                            (kMacroDim - 1)) - kMacroDim / 2;
            const int dy = ((ly - ac->srcY[i] + kMacroDim / 2) &
                            (kMacroDim - 1)) - kMacroDim / 2;
            const int dz = ((lz - ac->srcZ[i] + kMacroDim / 2) &
                            (kMacroDim - 1)) - kMacroDim / 2;
            if (dx < -kNoiseBallRadiusCells || dx > kNoiseBallRadiusCells ||
                dy < -kNoiseBallRadiusCells || dy > kNoiseBallRadiusCells ||
                dz < -kNoiseBallRadiusCells || dz > kNoiseBallRadiusCells)
                return 1e30f; // за шаром = за пределом флуда = не слышно
            const std::uint8_t d =
                ac->dist[i * kNoiseBallCells +
                         ((static_cast<std::size_t>(dz + kNoiseBallRadiusCells) *
                               kNoiseBallDim +
                           static_cast<std::size_t>(dy + kNoiseBallRadiusCells)) *
                              kNoiseBallDim +
                          static_cast<std::size_t>(dx + kNoiseBallRadiusCells))];
            if (d == kNoiseUnreachable) return 1e30f; // стены держат звук
            return static_cast<float>(d);
        }
        // Живой шум без шара (издан после шага бейка) — прямолинейный
        // запасной ответ до следующего тика.
    }
    // All three axes wrap ([AGENTS.md]: x/y/z wrap; W does not). The storey
    // stack is W, and W never enters this function — both points live on ONE
    // floor's 256 m torus, where "250 m overhead" IS 6 m away through the
    // seam. The earlier comment here argued the opposite from a "128-storey
    // column" that this field does not model, and the raw z made a sound just
    // across the z seam inaudible (markoaudit/systems/05-torus.md §1.4).
    const float dx = wrap_delta_f(pos.x, n.x, kWorldExtent);
    const float dy = wrap_delta_f(pos.y, n.y, kWorldExtent);
    const float dz = wrap_delta_f(pos.z, n.z, kWorldExtent);
    return std::sqrt(dx * dx + dy * dy + dz * dz);
}

bool noise_audible(const Noise& n, const vec3& pos, float hearingMult,
                   const NoiseAcoustics* ac) {
    if (n.id == 0) return false;
    const float r = n.radius * (hearingMult > 0.0f ? hearingMult : 1.0f);
    return noise_distance(n, pos, ac) <= r;
}

const Noise* loudest_heard(const NoiseField& field, LayerId layer, const vec3& pos,
                           float hearingMult, std::uint8_t minSeverity,
                           std::uint32_t ignoreActor, float* outDist,
                           const NoiseAcoustics* ac) {
    if (outDist) *outDist = 0.0f;
    if (field.quiet()) return nullptr;
    if (layer > kNoiseLayerMax) return nullptr;
    const std::uint8_t wantLayer = static_cast<std::uint8_t>(layer);
    const float mult = hearingMult > 0.0f ? hearingMult : 1.0f;

    const Noise* best = nullptr;
    float bestScore = 0.0f;
    float bestDist = 0.0f;
    for (const Noise& s : field.slot) {
        if (s.id == 0) continue;
        if (s.layer != wantLayer) continue;
        if (s.severity < minSeverity) continue;
        // Never your own. Guarded on ignoreActor != 0 because 0 means "no filter"
        // and entt::null truncates to a real integral value — a listener passing 0
        // must not accidentally match every anonymous noise.
        if (ignoreActor != 0 && s.actor == ignoreActor) continue;

        const float r = s.radius * mult;
        const float d = noise_distance(s, pos, ac);
        if (d > r) continue;

        // The reference's weighting, verbatim: severity dominates, nearness breaks
        // ties within a band, and age decays it so a fresh quiet sound can beat a
        // stale loud one. `nearness` is 1 at the source and 0 at the audible edge.
        const float nearness = 1.0f - d / (r > 0.1f ? r : 0.1f);
        const float ageSec =
            static_cast<float>(s.lifeMs - s.ttlMs) * 0.001f;
        const float score = static_cast<float>(s.severity) * kScoreSeverity +
                            nearness * kScoreNearness - ageSec * kScoreAgePerSec;
        if (best && score <= bestScore) continue;
        best = &s;
        bestScore = score;
        bestDist = d;
    }
    if (best && outDist) *outDist = bestDist;
    return best;
}

} // namespace giga::game
