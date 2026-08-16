#include "game/macro_sim.h"

#include "game/npc_pool.h"
#include "core/rng.h"

#include "game/faction_relations.h"  // FactionRelations, rel_row, global_territory_war_manager
#include "game/floor_registry.h"     // kMinFloor / kMaxFloor / kFloorSlots
#include "game/population.h"         // height_for_age
#include "game/rumour.h"             // global_rumour_network

namespace giga::game {

namespace {

constexpr std::uint32_t kDaysPerYear = 365;
constexpr std::uint64_t kTenthsPerDay = 10;

constexpr std::uint32_t kSaltDeath        = 0x00d3a7bu;
constexpr std::uint32_t kSaltBirth        = 0x00b19b7u;
constexpr std::uint32_t kSaltParent       = 0x09a2e70u;
constexpr std::uint32_t kSaltBaby         = 0x0ba8100u;
constexpr std::uint32_t kSaltMigrate      = 0x0319a70u;
constexpr std::uint32_t kSaltDest         = 0x0de5700u;
constexpr std::uint32_t kSaltEta          = 0x0e7a411u;
constexpr std::uint32_t kSaltSocial       = 0x05c1a10u;
constexpr std::uint32_t kSaltSocialPeer   = 0x0bdd1e5u;
constexpr std::uint32_t kSaltSocialJitter = 0x0777e13u;

constexpr std::uint32_t kSocialCandidateTries = 8;
constexpr int kSocialSeedJitter = 40;
constexpr int kReservoir = 64;

float year_death_prob(int age, const MacroParams& p) {
    const int onset = static_cast<int>(p.mortalityOnset);
    const int ceiling = static_cast<int>(p.maxAge);
    if (age < onset) return 0.0f;
    if (ceiling <= onset) return p.mortalityPeak;
    const float span = static_cast<float>(ceiling - onset);
    const float t = static_cast<float>(age - onset) / span;
    return p.mortalityPeak * t * t;
}

int faction_affinity(const FactionRelations& fr, const NpcPool& pool, NpcId a,
                     NpcId b) {
    const std::uint8_t ra = rel_row(pool, a);
    const std::uint8_t rb = rel_row(pool, b);
    const int sum = static_cast<int>(fr.at(ra, rb)) + static_cast<int>(fr.at(rb, ra));
    return (sum + 2) >> 2;
}

bool form_edge(NpcPool& pool, const FactionRelations& fr, NpcId a, NpcId b,
               std::uint32_t jitterSalt, std::uint32_t& dropped) {
    std::array<Relationship, kRelSlots>& row = pool.relations(a);
    int aba = -1;
    int firstEmpty = -1;
    int firstStale = -1;
    int weakest = 0;
    int weakestMag = 0x7fffffff;
    for (int s = 0; s < kRelSlots; ++s) {
        const std::size_t si = static_cast<std::size_t>(s);
        if (row[si].target == kInvalidNpc) {
            if (firstEmpty < 0) firstEmpty = s;
            continue;
        }
        if (!social_edge_live(pool, row[si])) {
            if (aba < 0 && row[si].target == b) aba = s;
            if (firstStale < 0) firstStale = s;
            continue;
        }
        if (row[si].target == b) return false;
        const int mag = row[si].affinity < 0 ? -static_cast<int>(row[si].affinity)
                                             : static_cast<int>(row[si].affinity);
        if (mag < weakestMag) {
            weakestMag = mag;
            weakest = s;
        }
    }
    int pick = weakest;
    bool reclaim = false;
    if (aba >= 0)             { pick = aba;        reclaim = true; }
    else if (firstEmpty >= 0) { pick = firstEmpty; }
    else if (firstStale >= 0) { pick = firstStale; reclaim = true; }
    if (reclaim) ++dropped;
    const std::size_t slot = static_cast<std::size_t>(pick);

    const int base = faction_affinity(fr, pool, a, b);
    const std::uint32_t range = static_cast<std::uint32_t>(2 * kSocialSeedJitter + 1);
    const int jit =
        static_cast<int>(hash3(a, b, jitterSalt) % range) - kSocialSeedJitter;
    int val = base + jit;
    if (val < kSocialAffinityMin) val = kSocialAffinityMin;
    if (val > kSocialAffinityMax) val = kSocialAffinityMax;
    social_edge_set(row[slot], pool, b, static_cast<std::int16_t>(val));
    return true;
}

} // namespace

void MacroSim::init() {
    ageDays_.clear();
    ageDays_.shrink_to_fit();
    traveling_.clear();
    traveling_.shrink_to_fit();
    journeys_.clear();
    journeys_.shrink_to_fit();
    floors_.clear();
    floorIdx_.clear();
    migCursor_ = 0;
    socCursor_ = 0;
    latchedTarget_ = 0;
    tick_ = 0;
    dayTenths_ = 0;
    stats_ = MacroStats{};
}

void MacroSim::ensure_rows(std::uint32_t rows) {
    if (static_cast<std::uint32_t>(ageDays_.size()) >= rows) return;
    std::size_t next = ageDays_.empty() ? static_cast<std::size_t>(kNpcLazyChunk)
                                        : ageDays_.size() * 2u;
    if (next < static_cast<std::size_t>(rows)) next = static_cast<std::size_t>(rows);
    if (next > static_cast<std::size_t>(kNpcPoolSize))
        next = static_cast<std::size_t>(kNpcPoolSize);
    ageDays_.resize(next);
    traveling_.resize(next);
}

void MacroSim::set_floors(const std::int16_t* labels, std::uint32_t count) {
    static_assert(kFloorSlots == 255, "the label -> index map covers the legal range");
    static_assert(kFloorSlots <= 32767, "an index into floors_ must fit std::int16_t");
    floors_.clear();
    floorIdx_.assign(static_cast<std::size_t>(kFloorSlots), static_cast<std::int16_t>(-1));
    if (labels == nullptr) return;
    for (std::uint32_t i = 0; i < count; ++i) {
        const int f = static_cast<int>(labels[i]);
        if (f < kMinFloor || f > kMaxFloor) continue;
        const std::size_t slot = static_cast<std::size_t>(f - kMinFloor);
        if (floorIdx_[slot] >= 0) continue;
        floorIdx_[slot] = static_cast<std::int16_t>(floors_.size());
        floors_.push_back(static_cast<std::int16_t>(f));
    }
}

void MacroSim::set_floors_from(const FloorRegistry& reg) {
    std::int16_t labels[kFloorSlots] = {};
    std::uint32_t n = 0;
    for (int f = kMinFloor; f <= kMaxFloor; ++f) {
        if (reg.module_at(f) == kInvalidModule) continue;
        labels[n++] = static_cast<std::int16_t>(f);
    }
    set_floors(labels, n);
}

int MacroSim::floor_index(std::int16_t label) const {
    if (floorIdx_.empty()) return -1;
    const int n = static_cast<int>(label);
    if (n < kMinFloor || n > kMaxFloor) return -1;
    return static_cast<int>(floorIdx_[static_cast<std::size_t>(n - kMinFloor)]);
}

MacroStats MacroSim::step(NpcPool& pool, const MacroParams& params,
                          const FactionRelations* factions) {
    const std::uint32_t n = pool.count();
    ensure_rows(n);

    const int days = params.daysPerTick > 0 ? params.daysPerTick : 1;
    const float yearFrac =
        static_cast<float>(days) / static_cast<float>(kDaysPerYear);
    const std::uint32_t t32 = static_cast<std::uint32_t>(tick_);

    const std::uint32_t sDeath   = kSaltDeath ^ params.seed;
    const std::uint32_t sBirth   = kSaltBirth ^ params.seed;
    const std::uint32_t sParent  = kSaltParent ^ params.seed;
    const std::uint32_t sBaby    = kSaltBaby ^ params.seed;
    const std::uint32_t sMigrate = kSaltMigrate ^ params.seed;
    const std::uint32_t sDest    = kSaltDest ^ params.seed;
    const std::uint32_t sEta     = kSaltEta ^ params.seed;
    const std::uint32_t sSocial  = kSaltSocial ^ params.seed;
    const std::uint32_t sPeer    = kSaltSocialPeer ^ params.seed;

    if (latchedTarget_ == 0) latchedTarget_ = pool.alive();

    std::uint32_t living = 0;
    std::uint32_t deaths = 0;

    NpcId reservoir[kReservoir] = {};
    int fertile = 0;

    for (NpcId id = 0; id < n; ++id) {
        if (!pool.alive(id)) continue;
        if (pool.embodied(id)) {
            ++living;
            continue;
        }

        // Lethal health threshold check for cold records
        if (pool.hp(id) <= 0 && pool.max_hp(id) > 0) {
            pool.kill(id);
            ++deaths;
            continue;
        }

        std::uint32_t d = static_cast<std::uint32_t>(ageDays_[id]) +
                          static_cast<std::uint32_t>(days);
        int age = static_cast<int>(pool.age(id));
        const int maxAge = static_cast<int>(params.maxAge);
        while (d >= kDaysPerYear && age < maxAge) {
            d -= kDaysPerYear;
            ++age;
        }
        if (age >= maxAge) d = kDaysPerYear - 1;
        ageDays_[id] = static_cast<std::uint16_t>(d);
        pool.age(id) = static_cast<std::uint8_t>(age);

        if (age >= maxAge) {
            pool.kill(id);
            ++deaths;
            continue;
        }
        const float yp = year_death_prob(age, params);
        if (yp > 0.0f && rand01(hash3(id, t32, sDeath)) < yp * yearFrac) {
            pool.kill(id);
            ++deaths;
            continue;
        }

        ++living;

        if (age >= static_cast<int>(params.fertileLo) &&
            age <= static_cast<int>(params.fertileHi)) {
            if (fertile < kReservoir) {
                reservoir[fertile] = id;
            } else {
                const std::uint32_t j = hash3(id, t32, sParent) %
                                        static_cast<std::uint32_t>(fertile + 1);
                if (j < static_cast<std::uint32_t>(kReservoir)) reservoir[j] = id;
            }
            ++fertile;
        }
    }

    std::uint32_t births = 0;
    std::uint32_t blocked = 0;
    const std::uint32_t target =
        params.targetPopulation != 0u ? params.targetPopulation : latchedTarget_;
    const int nRes = fertile < kReservoir ? fertile : kReservoir;
    if (nRes > 0) {
        float expected = static_cast<float>(deaths);
        expected += static_cast<float>(living) * params.growthRatePerYear * yearFrac;
        if (target > living) {
            expected += static_cast<float>(target - living) *
                        params.recoverGainPerYear * yearFrac;
        }
        const float ceiling =
            static_cast<float>(deaths) +
            static_cast<float>(living) * params.maxGrowthPerYear * yearFrac;
        if (expected > ceiling) expected = ceiling;
        if (expected < 0.0f) expected = 0.0f;

        std::uint32_t whole = static_cast<std::uint32_t>(expected);
        const float frac = expected - static_cast<float>(whole);
        if (rand01(hash3(t32, 0u, sBirth)) < frac) ++whole;

        std::uint32_t room = pool.reserve_remaining();
        room = room > params.reserveFloor ? room - params.reserveFloor : 0u;
        if (whole > room) {
            blocked = whole - room;
            whole = room;
        }

        for (std::uint32_t k = 0; k < whole; ++k) {
            const std::uint32_t pick =
                hash3(t32, k + 1u, sParent) % static_cast<std::uint32_t>(nRes);
            const NpcId parent = reservoir[pick];
            const NpcId baby = pool.spawn();
            if (baby == kInvalidNpc) break;
            ensure_rows(baby + 1u);

            ageDays_[baby] = 0;
            if (baby < traveling_.size()) traveling_[baby] = 0;
            pool.age(baby) = 0;
            pool.sex(baby) = (hash3(t32, k, sBaby) & 1u) ? SexFemale : SexMale;
            pool.height_mm(baby) =
                height_for_age(static_cast<std::uint8_t>(0), hash3(baby, t32, sBaby));
            pool.set_floor(baby, pool.floor(parent));
            pool.cx(baby) = pool.cx(parent);
            pool.cy(baby) = pool.cy(parent);
            pool.cz(baby) = pool.cz(parent);
            pool.faction(baby) = pool.faction(parent);
            pool.max_hp(baby) = 100;
            pool.hp(baby) = 100;
            pool.level(baby) = static_cast<std::uint8_t>(1);
            ++births;
            ++living;
        }
    }

    const std::uint64_t tenths =
        static_cast<std::uint64_t>(days) * kTenthsPerDay;
    const std::uint64_t afterTenths = dayTenths_ + tenths;
    std::uint32_t departures = 0;
    std::uint32_t arrivals = 0;

    if (!journeys_.empty()) {
        std::size_t w = 0;
        for (std::size_t r = 0; r < journeys_.size(); ++r) {
            const Journey j = journeys_[r];
            if (j.etaTenths > afterTenths) {
                journeys_[w++] = j;
                continue;
            }
            traveling_[j.id] = 0;
            if (pool.alive(j.id) && pool.generation(j.id) == j.gen &&
                !pool.embodied(j.id)) {
                pool.set_floor(j.id, static_cast<std::int16_t>(j.toFloor));
                ++arrivals;
            }
        }
        journeys_.resize(w);
    }

    if (floors_.size() >= 2u && params.migrateRatePerYear > 0.0f) {
        const float departProb = params.migrateRatePerYear * yearFrac;
        const std::uint32_t total = pool.count();
        if (total > 0u) {
            std::uint32_t budget = params.migrateRecordsPerTick;
            if (budget > total) budget = total;
            const std::uint32_t inFlight =
                static_cast<std::uint32_t>(journeys_.size());
            const std::uint32_t room =
                params.maxJourneys > inFlight ? params.maxJourneys - inFlight : 0u;
            const std::uint32_t nFloors =
                static_cast<std::uint32_t>(floors_.size());

            NpcId id = migCursor_ % total;
            for (std::uint32_t k = 0; k < budget; ++k, id = (id + 1u) % total) {
                if (!pool.alive(id) || pool.embodied(id) || traveling_[id]) continue;
                if (departures >= room) continue;
                if (rand01(hash3(id, t32, sMigrate)) >= departProb) continue;

                const std::int16_t cur = pool.floor(id);
                const int ci = floor_index(cur);

                const std::uint32_t h = hash3(id, t32, sDest);
                std::int16_t dst = 0;
                int dz = 1;
                if (ci < 0) {
                    dst = floors_[h % nFloors];
                } else {
                    std::uint32_t d = h % (nFloors - 1u);
                    if (d >= static_cast<std::uint32_t>(ci)) ++d;
                    dst = floors_[d];
                    dz = static_cast<int>(dst) - static_cast<int>(cur);
                    if (dz < 0) dz = -dz;
                }

                const float jitter = 0.8f + rand01(hash3(id, t32, sEta)) * 0.55f;
                float travelDays = (params.travelBaseDays +
                                    params.travelPerFloorDays *
                                        static_cast<float>(dz)) * jitter;
                if (travelDays < 0.0f) travelDays = 0.0f;
                std::uint64_t travelTenths = static_cast<std::uint64_t>(
                    travelDays * static_cast<float>(kTenthsPerDay) + 0.5f);
                if (travelTenths == 0u) travelTenths = 1u;

                Journey j{};
                j.id = id;
                j.toFloor = dst;
                j.gen = pool.generation(id);
                j.etaTenths = afterTenths + travelTenths;
                journeys_.push_back(j);
                traveling_[id] = 1;
                ++departures;
            }
            migCursor_ = id;
        }
    }

    std::uint32_t socialEdges = 0;
    std::uint32_t socialStale = 0;
    std::uint32_t rumoursDiffused = 0;
    std::uint32_t territoryShifts = 0;

    if (factions != nullptr && params.socialFormRatePerYear > 0.0f &&
        params.socialRecordsPerTick > 0u) {
        const float formProb = params.socialFormRatePerYear * yearFrac;
        const std::uint32_t total = pool.count();
        if (total >= 2u) {
            std::uint32_t budget = params.socialRecordsPerTick;
            if (budget > total) budget = total;
            NpcId id = socCursor_ % total;
            for (std::uint32_t k = 0; k < budget; ++k, id = (id + 1u) % total) {
                if (!pool.alive(id) || pool.embodied(id)) continue;
                if (rand01(hash3(id, t32, sSocial)) >= formProb) continue;

                const std::int16_t label = pool.floor(id);

                const std::vector<NpcId>& bucket = pool.floor_bucket(label);
                if (bucket.size() < 2u) continue;

                NpcId peer = kInvalidNpc;
                const std::size_t bucketSize = bucket.size();
                for (std::uint32_t attempt = 0; attempt < kSocialCandidateTries;
                     ++attempt) {
                    const std::size_t idx = hash3(id, t32 + attempt, sPeer) % bucketSize;
                    const NpcId cand = bucket[idx];
                    if (cand == id) continue;
                    if (!pool.alive(cand) || pool.embodied(cand)) continue;
                    peer = cand;
                    break;
                }
                if (peer == kInvalidNpc) continue;

                if (form_edge(pool, *factions, id, peer,
                              kSaltSocialJitter ^ params.seed ^ t32, socialStale)) {
                    ++socialEdges;
                    // Propagate social network rumours between newly acquainted peers
                    if (global_rumour_network().share_rumours_between(pool, id, peer, 20, false, tick_)) {
                        ++rumoursDiffused;
                    }
                }
            }
            socCursor_ = id;
        }

        // Floor-level rumour diffusion and territory war progression
        for (std::int16_t fl : floors_) {
            rumoursDiffused += global_rumour_network().diffuse_step(pool, fl, tick_, 8);
            if (global_territory_war_manager().evaluate_territory_shift(pool, fl)) {
                ++territoryShifts;
            }
        }
        global_territory_war_manager().step(tick_, static_cast<std::uint32_t>(days));
    }

    ++tick_;
    dayTenths_ += tenths;
    stats_.living = living;
    stats_.deaths = deaths;
    stats_.births = births;
    stats_.birthsBlocked = blocked;
    stats_.departures = departures;
    stats_.arrivals = arrivals;
    stats_.inTransit = static_cast<std::uint32_t>(journeys_.size());
    stats_.socialEdges = socialEdges;
    stats_.socialStaleDropped = socialStale;
    stats_.rumoursDiffused = rumoursDiffused;
    stats_.territoryShifts = territoryShifts;
    stats_.reserveRemaining = pool.reserve_remaining();
    stats_.target = target;
    stats_.tick = tick_;
    stats_.dayTenths = dayTenths_;
    return stats_;
}

namespace {

void ms_u8(std::vector<std::uint8_t>& o, std::uint8_t v) { o.push_back(v); }
void ms_u16(std::vector<std::uint8_t>& o, std::uint16_t v) {
    o.push_back(static_cast<std::uint8_t>(v & 0xFFu));
    o.push_back(static_cast<std::uint8_t>((static_cast<std::uint32_t>(v) >> 8) & 0xFFu));
}
void ms_u32(std::vector<std::uint8_t>& o, std::uint32_t v) {
    for (int i = 0; i < 4; ++i)
        o.push_back(static_cast<std::uint8_t>((v >> (static_cast<std::uint32_t>(i) * 8u)) & 0xFFu));
}
void ms_u64(std::vector<std::uint8_t>& o, std::uint64_t v) {
    for (int i = 0; i < 8; ++i)
        o.push_back(static_cast<std::uint8_t>((v >> (static_cast<std::uint64_t>(i) * 8ull)) & 0xFFull));
}

struct MsReader {
    const std::uint8_t* p;
    std::size_t n;
    std::size_t at = 0;
    bool ok = true;
    std::uint8_t u8() {
        if (at >= n) { ok = false; return 0; }
        return p[at++];
    }
    std::uint16_t u16() {
        const std::uint32_t a = u8(), b = u8();
        return static_cast<std::uint16_t>(a | (b << 8));
    }
    std::uint32_t u32() {
        std::uint32_t v = 0;
        for (int i = 0; i < 4; ++i) v |= static_cast<std::uint32_t>(u8()) << (static_cast<std::uint32_t>(i) * 8u);
        return v;
    }
    std::uint64_t u64() {
        std::uint64_t v = 0;
        for (int i = 0; i < 8; ++i) v |= static_cast<std::uint64_t>(u8()) << (static_cast<std::uint64_t>(i) * 8ull);
        return v;
    }
};

} // namespace

void MacroSim::save_state(std::vector<std::uint8_t>& out) const {
    out.clear();
    ms_u64(out, tick_);
    ms_u64(out, dayTenths_);
    ms_u32(out, migCursor_);
    ms_u32(out, socCursor_);
    ms_u32(out, static_cast<std::uint32_t>(ageDays_.size()));
    for (std::uint16_t v : ageDays_) ms_u16(out, v);
    ms_u32(out, static_cast<std::uint32_t>(traveling_.size()));
    for (std::uint8_t v : traveling_) ms_u8(out, v);
    ms_u32(out, static_cast<std::uint32_t>(journeys_.size()));
    for (const Journey& j : journeys_) {
        ms_u32(out, j.id);
        ms_u16(out, static_cast<std::uint16_t>(j.toFloor));
        ms_u16(out, j.gen);
        ms_u64(out, j.etaTenths);
    }
}

bool MacroSim::load_state(const std::uint8_t* bytes, std::size_t n) {
    if (!bytes || n < 8 + 8 + 4 + 4 + 4) return false;
    MsReader r{bytes, n};
    const std::uint64_t tick = r.u64();
    const std::uint64_t dayTenths = r.u64();
    const std::uint32_t mig = r.u32();
    const std::uint32_t soc = r.u32();
    const std::uint32_t ages = r.u32();
    if (ages > kNpcPoolSize) return false;
    std::vector<std::uint16_t> ageDays(ages);
    for (std::uint32_t i = 0; i < ages; ++i) ageDays[i] = r.u16();
    const std::uint32_t trav = r.u32();
    if (!r.ok || trav > kNpcPoolSize) return false;
    std::vector<std::uint8_t> traveling(trav);
    for (std::uint32_t i = 0; i < trav; ++i) traveling[i] = r.u8();
    const std::uint32_t jn = r.u32();
    if (!r.ok || jn > kNpcPoolSize) return false;
    std::vector<Journey> journeys(jn);
    for (std::uint32_t i = 0; i < jn; ++i) {
        journeys[i].id = r.u32();
        journeys[i].toFloor = static_cast<std::int16_t>(r.u16());
        journeys[i].gen = r.u16();
        journeys[i].etaTenths = r.u64();
    }
    if (!r.ok || r.at != n) return false;
    tick_ = tick;
    dayTenths_ = dayTenths;
    migCursor_ = mig;
    socCursor_ = soc;
    ageDays_ = std::move(ageDays);
    traveling_ = std::move(traveling);
    journeys_ = std::move(journeys);
    stats_ = MacroStats{};
    return true;
}

} // namespace giga::game
