#include "game/rumour.h"

#include <cstdio>

#include "core/wrap.h"
#include "ecs/components.h"
#include "game/embody.h"     // NpcRef
#include "game/faction_relations.h"
#include "game/mob_spawn.h"  // MobRef
#include "game/samosbor.h"
#include "world/types.h"

namespace giga::game {

namespace {

std::uint32_t mix(std::uint32_t x) {
    x ^= x >> 16;
    x *= 0x7feb352du;
    x ^= x >> 15;
    x *= 0x846ca68bu;
    x ^= x >> 16;
    return x;
}

// Which kinds actually spawned on this layer. Counted from the live registry rather
// than re-derived from the spawn tables, because the point of a threat rumour is that
// it is true of THIS floor as it currently stands — a mob that was killed before you
// arrived should not be gossip.
std::uint16_t sample_live_mob_kind(const Registry& reg, LayerId layer,
                                   std::uint32_t roll, std::uint32_t& countOut) {
    std::uint32_t seen = 0;
    std::uint16_t pick = 0xFFFFu;
    // Reservoir sampling, one pass, no allocation: the kth candidate replaces the
    // current pick with probability 1/k, which yields a uniform choice without
    // knowing the count up front or storing the candidates.
    for (auto e : reg.view<const MobRef, const Transform>()) {
        if (reg.get<const Transform>(e).layer != layer) continue;
        ++seen;
        if (roll % seen == 0) pick = reg.get<const MobRef>(e).kind;
        roll = mix(roll);
    }
    countOut = seen;
    return pick;
}

} // namespace

// The dominant faction among embodied bodies on this layer.
//
// Body for body unchanged from the version that lived in the anonymous namespace above;
// only the linkage moved, so the Territory rumour keeps answering exactly what it did
// while `src/app/main.cpp` gains the ability to ask the same question. [rumour.h]
Faction dominant_faction(const Registry& reg, const NpcPool& pool, LayerId layer) {
    std::uint32_t tally[kFactionCount] = {};
    for (auto e : reg.view<const NpcRef, const Transform>()) {
        if (reg.get<const Transform>(e).layer != layer) continue;
        const NpcId id = reg.get<const NpcRef>(e).id;
        if (!const_cast<NpcPool&>(pool).valid(id)) continue;
        ++tally[body_row(pool, id)];
    }
    std::size_t best = 0;
    for (std::size_t i = 1; i < kFactionCount; ++i)
        if (tally[i] > tally[best]) best = i;
    return static_cast<Faction>(best);
}

NpcId nearest_speaker(const Registry& reg, LayerId layer) {
    // The listener.
    Entity ear = entt::null;
    vec3 earPos{0, 0, 0};
    for (auto e : reg.view<const CameraTag, const Transform>()) {
        const Transform& t = reg.get<const Transform>(e);
        if (t.layer != layer) continue;
        ear = e;
        earPos = t.pos;
        break;
    }
    if (ear == entt::null) return kInvalidNpc;

    NpcId best = kInvalidNpc;
    float bestD2 = kOverhearRange * kOverhearRange;
    for (auto e : reg.view<const NpcRef, const Transform>()) {
        if (e == ear) continue;                  // you do not overhear yourself
        const Transform& t = reg.get<const Transform>(e);
        if (t.layer != layer) continue;
        // Monsters are not embodied records and carry no NpcRef, so they cannot be
        // reached by this view at all — no explicit exclusion needed.
        const float dx = wrap_delta_f(earPos.x, t.pos.x, kWorldExtent);
        const float dy = wrap_delta_f(earPos.y, t.pos.y, kWorldExtent);
        const float dz = wrap_delta_f(earPos.z, t.pos.z, kWorldExtent);
        const float d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= bestD2) continue;
        bestD2 = d2;
        best = reg.get<const NpcRef>(e).id;
    }
    return best;
}

Rumour rumour_for(const Registry& reg, const NpcPool& pool, NpcId speaker,
                  LayerId layer, int floorZ) {
    Rumour r;
    if (!const_cast<NpcPool&>(pool).valid(speaker)) return r;

    // Deterministic in (speaker, floor): the same person always says the same thing
    // about the same floor. That is what makes a rumour read as something a body
    // KNOWS rather than as dice, and it means walking back to them repeats it.
    const std::uint32_t seed =
        mix(speaker * 0x9e3779b9u ^ static_cast<std::uint32_t>(floorZ * 2654435761u));

    // Which kind of thing this person talks about. Not uniform: a threat warning and
    // the fog schedule are the two most actionable, so they get the larger share.
    const std::uint32_t pick = seed % 100u;
    RumourKind kind;
    if (pick < 30) kind = RumourKind::Threat;
    else if (pick < 55) kind = RumourKind::Fog;
    else if (pick < 75) kind = RumourKind::Wealth;
    else if (pick < 90) kind = RumourKind::Territory;
    else kind = RumourKind::Depth;

    switch (kind) {
        case RumourKind::Threat: {
            std::uint32_t live = 0;
            const std::uint16_t k =
                sample_live_mob_kind(reg, layer, mix(seed ^ 0x11u), live);
            // Nothing alive to warn about: fall through to the fog, which is always
            // true. Emitting an empty threat line would be the one thing this system
            // must never do — say something false.
            if (k == 0xFFFFu || live == 0) {
                r.kind = RumourKind::Fog;
                r.value = static_cast<std::int32_t>(
                    samosbor_duty01(floorZ) * 1000.0f);
                r.valid = true;
                return r;
            }
            r.kind = RumourKind::Threat;
            r.subject = k;
            r.value = static_cast<std::int32_t>(live);
            r.valid = true;
            return r;
        }
        case RumourKind::Fog:
            r.kind = kind;
            // Per-mille, so the integer keeps a floor's 1.6% distinguishable from
            // another's 10.0% without carrying a float through a POD.
            r.value = static_cast<std::int32_t>(samosbor_duty01(floorZ) * 1000.0f);
            r.valid = true;
            return r;
        case RumourKind::Wealth:
            r.kind = kind;
            r.value = kLootValueCap[economy_band(floorZ)];
            r.valid = true;
            return r;
        case RumourKind::Territory:
            r.kind = kind;
            r.subject =
                static_cast<std::uint16_t>(dominant_faction(reg, pool, layer));
            r.valid = true;
            return r;
        case RumourKind::Depth:
        default:
            r.kind = RumourKind::Depth;
            // The speaker's own read on how deep is survivable, anchored on where the
            // duty cycle crosses half — which is a real threshold, not a mood.
            r.value = floorZ < 0 ? -34 : 34;
            r.valid = true;
            return r;
    }
}

bool rumour_text(const Rumour& r, char* out, std::size_t cap) {
    if (!r.valid || !out || cap < 160) return false;
    switch (r.kind) {
        case RumourKind::Threat:
            std::snprintf(out, cap,
                          "\xd0\xa2\xd1\x83\xd1\x82 \xd0\xb2\xd0\xbe\xd0\xb4\xd0\xb8"
                          "\xd1\x82\xd1\x81\xd1\x8f %s. \xd0\x98\xd1\x85 %d.",
                          mob_name(static_cast<MobKind>(r.subject)),
                          static_cast<int>(r.value));
            return true;
        case RumourKind::Fog: {
            // Three bands, because the useful information is "often / sometimes /
            // almost always" rather than a percentage nobody can act on.
            const char* how =
                r.value < 100
                    ? "\xd1\x80\xd0\xb5\xd0\xb4\xd0\xba\xd0\xbe"          // rarely
                    : (r.value < 500
                           ? "\xd1\x87\xd0\xb0\xd1\x81\xd1\x82\xd0\xbe"   // often
                           : "\xd0\xbf\xd0\xbe\xd1\x87\xd1\x82\xd0\xb8 "
                             "\xd0\xb2\xd1\x81\xd0\xb5\xd0\xb3\xd0\xb4\xd0\xb0");
            std::snprintf(out, cap,
                          "\xd0\xa1\xd0\xb0\xd0\xbc\xd0\xbe\xd1\x81\xd0\xb1\xd0\xbe"
                          "\xd1\x80 \xd0\xb7\xd0\xb4\xd0\xb5\xd1\x81\xd1\x8c %s "
                          "(%d.%d%%).",
                          how, static_cast<int>(r.value) / 10,
                          static_cast<int>(r.value) % 10);
            return true;
        }
        case RumourKind::Wealth:
            std::snprintf(out, cap,
                          "\xd0\xa5\xd0\xbe\xd1\x80\xd0\xbe\xd1\x88\xd0\xb5\xd0\xb5 "
                          "\xd0\xb7\xd0\xb4\xd0\xb5\xd1\x81\xd1\x8c \xd0\xb8\xd0\xb4"
                          "\xd1\x91\xd1\x82 \xd0\xb4\xd0\xbe %d \xd1\x80\xd1\x83\xd0"
                          "\xb1.",
                          static_cast<int>(r.value));
            return true;
        case RumourKind::Territory:
            std::snprintf(out, cap,
                          "\xd0\xad\xd1\x82\xd0\xbe\xd1\x82 \xd1\x8d\xd1\x82\xd0\xb0"
                          "\xd0\xb6 \xd0\xb4\xd0\xb5\xd1\x80\xd0\xb6\xd0\xb0\xd1\x82"
                          " %s.",
                          faction_name(static_cast<Faction>(r.subject)));
            return true;
        case RumourKind::Depth:
        default:
            std::snprintf(out, cap,
                          "\xd0\x93\xd0\xbb\xd1\x83\xd0\xb1\xd0\xb6\xd0\xb5 %d "
                          "\xd0\xbd\xd0\xb5 \xd0\xb2\xd0\xbe\xd0\xb7\xd0\xb2\xd1\x80"
                          "\xd0\xb0\xd1\x89\xd0\xb0\xd1\x8e\xd1\x82\xd1\x81\xd1\x8f.",
                          static_cast<int>(r.value));
            return true;
    }
}

} // namespace giga::game
