// Faction relations — the ported base attitude matrix (faction.h, [macrosim.md] #10d).

#include "game/faction.h"

namespace giga::game {
namespace {

// Base inter-faction attitudes, ported verbatim from the reference
// (`../gigahrush`, src/data/relations.ts base seed). Row a = how faction a
// regards faction b; column order matches FactionId (Citizen..Player). The base
// is symmetric with a self-attitude of 100 on the diagonal, values spanning
// -50..100 — every relationship the society starts with lives in this table, not
// in code. Runtime events then nudge cells (faction.h nudge/nudge_mutual).
constexpr std::int8_t kBase[kFactionCount][kFactionCount] = {
    //              CIT  LIQ  CUL  SCI  WILD  PLR
    /* CITIZEN    */ { 100,  50,   0,  50, -50,  50 },
    /* LIQUIDATOR */ {  50, 100, -50,  50, -50,  50 },
    /* CULTIST    */ {   0, -50, 100, -20, -50,   0 },
    /* SCIENTIST  */ {  50,  50, -20, 100, -50,  50 },
    /* WILD       */ { -50, -50, -50, -50, 100, -50 },
    /* PLAYER     */ {  50,  50,   0,  50, -50, 100 },
};

} // namespace

FactionMatrix::FactionMatrix() { reset_to_base(); }

void FactionMatrix::reset_to_base() {
    for (int a = 0; a < kFactionCount; ++a)
        for (int b = 0; b < kFactionCount; ++b)
            m_[a * kFactionCount + b] = kBase[a][b];
}

} // namespace giga::game
